// Worker-thread entry point. Deliberately thin: it owns no policy and no
// state beyond the per-thread symbol cache inside bracketwork.js. Every task
// is a pure function call; every result goes straight back to the main
// thread, which remains the ONLY place batch docs are mutated.
//
// The CPU cap needs no plumbing here: throttle.js reads data/settings.json
// (re-checked every ~3s), so a worker picks up a live cap change on its own.
// The kill switch is handled by the pool terminating workers outright, which
// is both immediate and simpler than trying to share an abort epoch across
// threads.
const os = require('os');
const { parentPort } = require('worker_threads');
const work = require('./bracketwork');
const { threadNice } = require('./threadnice');

// NICE THE WORKER TO THE FLOOR. This box also hosts the owner's mail VM, and
// a 3-worker job made its SMTP sessions time out — connect succeeded (that is
// the guest kernel) but the daemon could not answer inside 25s. Mail came back
// a few minutes after the job stopped. Nothing about the CPU cap prevents
// this: the cap is a duty cycle, so the workers still contend at full priority
// during every busy slice.
//
// nice 19 costs essentially nothing when the box is otherwise idle — the
// scheduler still hands a lone niced thread the whole core — but it yields
// instantly to anything interactive. On Linux nice is per-thread and
// setpriority(PRIO_PROCESS, 0) applies to the calling thread, so this renices
// THIS worker and not the main process serving the web UI. Lowering priority
// never needs privilege; the try/catch is for platforms that refuse anyway.
try {
  os.setPriority(0, os.constants.priority.PRIORITY_LOW);
} catch {
  /* keep working at normal priority rather than failing to start */
}

const TASKS = {
  unit: work.unitTask,
  nullRotation: work.nullRotationTask,
  // Introspection, so the nice level above is a testable property rather than
  // a comment nobody can check.
  //
  // os.getPriority() alone is a weak witness: it would agree with the comment
  // even on a platform that silently ignored the request. So also read the
  // KERNEL's own number for this thread out of procfs (field 19 of
  // /proc/self/task/<tid>/stat, 1-indexed, counted after the comm field so a
  // process name containing spaces or ')' cannot shift it). Where procfs is
  // absent, nice comes back null and the caller reports "unverifiable"
  // instead of a false pass.
  ping: async () => ({ priority: os.getPriority(), pid: process.pid, ...threadNice() }),
};

parentPort.on('message', async (msg) => {
  const { id, kind, payload } = msg;
  try {
    const fn = TASKS[kind];
    if (!fn) throw new Error(`unknown task kind "${kind}"`);
    const result = await fn(payload);
    parentPort.postMessage({ id, ok: true, result });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
  }
});
