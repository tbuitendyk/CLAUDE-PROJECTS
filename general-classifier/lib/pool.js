// Worker pool for the long CPU-bound jobs (bracket sweeps, null replays).
//
// The host has 8 logical CPUs and the service used one. Every heavy job in this
// codebase is a stream of INDEPENDENT tasks — a null replay is N rotations
// that share nothing, a sweep is N combo x branch units that share nothing —
// so the win is available without touching the math.
//
// SAFETY PROPERTIES, in order of importance:
//   1. DETERMINISM. Tasks are pure (see bracketwork.js) and results are keyed
//      by rotation index / unit identity, never by arrival order. The
//      orchestrator sorts with a total order (value, then key) so ties cannot
//      resolve differently run to run. Parallel output is byte-identical to
//      serial output — verified against the DOT row 9 fixture before use.
//   2. KILL SWITCH. abort() terminates every worker immediately, which is
//      harder and faster than a cooperative flag and matches what "Stop jobs"
//      has always promised. Completed tasks keep their results.
//   3. CPU CAP. Needs no plumbing: throttle.js reads data/settings.json every
//      ~3s, so each worker honours a live cap change on its own. Total
//      machine usage is poolSize x pct — the cap governs each worker's duty
//      cycle exactly as it always governed the single thread's.
//   4. FALLBACK. size<=1, or any worker failing to boot, silently runs tasks
//      inline on the main thread. The service must never be LESS reliable
//      because of an optimization.
const os = require('os');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const work = require('./bracketwork');
const { threadNice } = require('./threadnice');

// Task kinds runnable on THIS thread when the pool has no workers. Must stay
// in step with TASKS in worker.js — the self-test below asserts that.
// NOTE: worker.js is deliberately NOT required here; it renices its own thread
// to 19 at load, which on the main thread would cripple the web server.
const INLINE = {
  unit: work.unitTask,
  nullRotation: work.nullRotationTask,
  wfUnit: require('./walkforward').wfUnitTask,
  ping: async () => ({ priority: os.getPriority(), pid: process.pid, ...threadNice() }),
};

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');

// Sizing, from the actual box: 8 logical CPUs (AMD EPYC-Milan, 4 physical
// cores x SMT2). The owner's budget for them, and it is the right one:
//   1  HOMSBUS02   (VirtualBox guest, 1 vCPU)
//   1  HOMSMAIL03  (VirtualBox guest, 1 vCPU — and its sshd saturates on it,
//                   which is why it is so easy to starve)
//   1  the host itself
//   1  the services already running here
//   4  left for this pool
// Hence RESERVED = 4 and a cap of 4. Overridable in data/settings.json
// (worker_threads) so the pool can be retuned without a deploy.
//
// Headroom is NOT the only protection: workers also run at nice 19 (see
// worker.js) so a 1-vCPU guest wins the scheduler regardless of how many
// threads are busy. Sizing and priority are belt and braces, deliberately.
const RESERVED_CPUS = 4;
const MAX_WORKERS = 4;

function configuredSize() {
  let cfg = null;
  try {
    cfg = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')).worker_threads;
  } catch {
    /* no settings yet */
  }
  const cores = Math.max(1, os.cpus().length);
  const n = Number(cfg);
  if (Number.isFinite(n) && n >= 1) return Math.min(Math.floor(n), cores);
  return Math.max(1, Math.min(cores - RESERVED_CPUS, MAX_WORKERS));
}

class Pool {
  constructor(size) {
    this.size = size;
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.pending = new Map();
    this.nextId = 1;
    this.stopped = false;
    this._keepAlive = null;
    if (size > 1) {
      for (let i = 0; i < size; i++) {
        try {
          const w = new Worker(path.join(__dirname, 'worker.js'));
          w.on('message', (msg) => this._onMessage(w, msg));
          w.on('error', (err) => this._onWorkerError(w, err));
          // A hard thread exit (OOM kill, process.exit inside the worker)
          // emits ONLY 'exit' — no 'error'. Without this handler that lane
          // would stall forever with no progress and no failure recorded.
          w.on('exit', (code) => {
            if (this.stopped) return; // our own terminate(), nothing to fail
            this._onWorkerError(w, new Error(`worker exited (code ${code})`));
          });
          this.workers.push(w);
          this.idle.push(w);
        } catch {
          /* fall back to inline for this slot */
        }
      }
    }
  }

  get parallel() {
    return this.workers.length > 1;
  }

  _onMessage(w, msg) {
    const entry = this.pending.get(msg.id);
    this.pending.delete(msg.id);
    this.idle.push(w);
    this._drain();
    this._refresh();
    if (!entry) return;
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error));
  }

  _onWorkerError(w, err) {
    // A dead worker must not strand its task: fail it loudly so the
    // orchestrator records it like any other failed unit.
    for (const [id, entry] of this.pending) {
      if (entry.worker === w) {
        this.pending.delete(id);
        entry.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
    this.workers = this.workers.filter((x) => x !== w);
    this.idle = this.idle.filter((x) => x !== w);
  }

  // Keep the event loop alive exactly while work is outstanding. Without
  // this a standalone harness (the determinism fixture!) can exit early and
  // look like it passed.
  _refresh() {
    if (this.pending.size > 0 && !this._keepAlive) {
      this._keepAlive = setInterval(() => {}, 1 << 30);
    } else if (this.pending.size === 0 && this._keepAlive) {
      clearInterval(this._keepAlive);
      this._keepAlive = null;
    }
  }

  _drain() {
    while (this.queue.length && this.idle.length && !this.stopped) {
      const task = this.queue.shift();
      const w = this.idle.shift();
      this.pending.set(task.id, { ...task, worker: w });
      w.postMessage({ id: task.id, kind: task.kind, payload: task.payload });
    }
    this._refresh();
  }

  run(kind, payload) {
    if (this.stopped) return Promise.reject(new Error('pool stopped'));
    if (!this.parallel) {
      // Inline fallback — identical code path, just on this thread.
      //
      // Dispatch by NAME, not by a two-way guess. The old form mapped every
      // non-'unit' kind onto nullRotationTask, so a new task kind would have
      // run the wrong function and returned a plausible object instead of
      // failing. An unknown kind must be an error here, exactly as it is in
      // the worker.
      const fn = INLINE[kind];
      if (!fn) return Promise.reject(new Error(`unknown task kind: ${kind}`));
      return Promise.resolve(fn(payload));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.queue.push({ id, kind, payload, resolve, reject });
      this._drain();
    });
  }

  // Run tasks with bounded concurrency, preserving INPUT order in the output
  // array. Order-preserving results are what let the orchestrator stay
  // deterministic without caring which worker finished first.
  async map(kind, payloads, onSettled) {
    const out = new Array(payloads.length);
    let next = 0;
    const lanes = Math.max(1, Math.min(this.parallel ? this.workers.length : 1, payloads.length));
    const runLane = async () => {
      while (!this.stopped) {
        const i = next++;
        if (i >= payloads.length) return;
        try {
          out[i] = { ok: true, value: await this.run(kind, payloads[i]) };
        } catch (err) {
          out[i] = { ok: false, error: err && err.message ? err.message : String(err) };
        }
        if (onSettled) {
          try {
            await onSettled(out[i], i, payloads[i]);
          } catch {
            /* reporting must never kill the run */
          }
        }
      }
    };
    await Promise.all(Array.from({ length: lanes }, runLane));
    return out;
  }

  abort() {
    this.stopped = true;
    this.queue.length = 0;
    for (const [, entry] of this.pending) entry.reject(new Error('cancelled by owner'));
    this.pending.clear();
    for (const w of this.workers) {
      try {
        w.terminate();
      } catch {
        /* already gone */
      }
    }
    this.workers = [];
    this.idle = [];
    if (this._keepAlive) {
      clearInterval(this._keepAlive);
      this._keepAlive = null;
    }
  }
}

function createPool(size) {
  return new Pool(size == null ? configuredSize() : size);
}

module.exports = { createPool, configuredSize, Pool };
