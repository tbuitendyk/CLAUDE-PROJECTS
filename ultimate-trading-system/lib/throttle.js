const fs = require('fs');
const path = require('path');

// Service-wide cooperative CPU cap, same design as the semi-auto balancer's
// lib/throttle.js: one setting governs every heavy loop (training, boosting,
// batch screens). The yielder re-reads the setting at its yield points
// (cached a few seconds), so changing it in the UI takes effect on RUNNING
// work within seconds — no restart, no kill. Duty cycle: ~90ms of work, then
// a sleep sized so the loop uses ≈pct of a core. Timing-only: results are
// byte-identical at any setting. Setting persists in data/settings.json
// (this service has no database).

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');
const WORK_MS = 90;
const CPU_MIN = 0; // 0 = OFF: heavy loops park in place until turned back up
const CPU_MAX = 100;
const CPU_DEFAULT = 90;
const CACHE_MS = 3000;

let cache = { v: null, at: 0 };

function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(CPU_MAX, Math.max(CPU_MIN, Math.round(n)));
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// the share as the owner set it on the Compute tab
function askedCpuPct() {
  if (Date.now() - cache.at > CACHE_MS) {
    const v = clampPct(readSettings().service_cpu_pct);
    cache = { v: v == null ? CPU_DEFAULT : v, at: Date.now() };
  }
  return cache.v;
}

// WORKERS x SHARE STAYS UNDER THE SERVICE'S OWN CEILING (3.270.0, owner order
// 2026-09-26: "the design should throttle the max allowable workers x
// percentage to < allowed"). The ceiling is `allowed` on the Compute tab: the
// most processor the machine lets this whole service have, set there with Set
// the ceiling. When the workers together reach it, the machine pauses EVERY
// thread of the service until the next tenth of a second -- the one answering
// pages included -- so the ceiling, not the share, ends up deciding the pace.
// So each worker's share is held to the largest whole percent at which the
// workers together stay under it; the share as set is kept and shown beside
// what is held. Timing only: results are identical at any share.
//
// Read from the machine's own record of the ceiling (cgroup v2, `cpu.max`,
// "quota period" in microseconds, or "max" for none), which is what Set the
// ceiling writes through systemd and what the machine enforces -- re-read every
// few seconds like the share, so a new ceiling reaches running work on its own.
// A service that cannot read its ceiling holds nothing, and says so.
let ceilingFiles = { proc: '/proc/self/cgroup', root: '/sys/fs/cgroup' };
let ceilingCache = { v: null, at: 0 };
function readAllowedPct(files = ceilingFiles) {
  try {
    const line = fs.readFileSync(files.proc, 'utf8').split('\n').find((l) => l.startsWith('0::'));
    if (!line) return null;
    const rel = line.slice(3).trim();
    if (!rel.startsWith('/') || rel.includes('..')) return null;
    const [q, per] = fs.readFileSync(path.join(files.root, rel, 'cpu.max'), 'utf8').trim().split(/\s+/);
    const quota = Number(q);
    const period = Number(per);
    if (q === 'max' || !(quota > 0) || !(period > 0)) return null;
    return Math.round((quota / period) * 100);
  } catch {
    return null;
  }
}
function allowedPct() {
  if (Date.now() - ceilingCache.at > CACHE_MS) ceilingCache = { v: readAllowedPct(), at: Date.now() };
  return ceilingCache.v;
}
// the largest whole share at which `workers` of them stay strictly under the
// ceiling, never above the share as set; no ceiling, nothing held
function heldPct(pct, workers, allowed) {
  const n = Math.floor(Number(workers));
  if (!(Number(allowed) > 0) || !(n >= 1)) return pct;
  return Math.max(0, Math.min(pct, Math.ceil(Number(allowed) / n) - 1));
}
// how many workers share the ceiling: a worker knows the pool it was started
// in; anywhere else it is the count the next job starts with
function workersNow() {
  const wt = require('worker_threads');
  if (!wt.isMainThread && wt.workerData && Number(wt.workerData.poolSize) >= 1) return Number(wt.workerData.poolSize);
  try { return require('./pool').configuredSize(); } catch { return 1; }
}
// what running work honours: the share as set, held under the ceiling. Asked
// at every yield point, so it is worked out once every few seconds, like the
// two readings it is made of.
let heldCache = { v: null, at: 0 };
function currentCpuPct() {
  if (Date.now() - heldCache.at > CACHE_MS) heldCache = { v: heldPct(askedCpuPct(), workersNow(), allowedPct()), at: Date.now() };
  return heldCache.v;
}

function setCpuPct(v) {
  const pct = clampPct(v);
  if (pct == null) throw new Error('cpu pct must be a number between 0 and 100');
  const settings = readSettings();
  settings.service_cpu_pct = pct;
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  // ATOMIC: worker threads poll this file every ~3s. A torn read yields
  // clampPct(undefined) -> null -> CPU_DEFAULT, i.e. the owner presses OFF
  // and a worker keeps running at 90%. rename() removes the window.
  const tmp = `${SETTINGS_FILE}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 1));
  fs.renameSync(tmp, SETTINGS_FILE);
  cache = { v: pct, at: Date.now() };
  heldCache = { v: null, at: 0 };
  return pct;
}

// Test hook: drop the cache so the next currentCpuPct() re-reads the file.
function refresh() {
  cache = { v: cache.v, at: 0 };
  ceilingCache = { v: ceilingCache.v, at: 0 };
  heldCache = { v: null, at: 0 };
}
// Test hook: read the ceiling from these files instead of the machine's;
// returns what was in use
function useCeilingFiles(files) {
  const was = ceilingFiles;
  ceilingFiles = files;
  ceilingCache = { v: null, at: 0 };
  heldCache = { v: null, at: 0 };
  return was;
}

// Cooperative kill switch: bumping the epoch makes every yielder created
// BEFORE the bump throw 'cancelled by owner' at its next yield point —
// including loops parked at CPU OFF. Work started after the bump captures
// the new epoch and runs normally.
let abortEpoch = 0;

function abortHeavyWork() {
  abortEpoch += 1;
  return abortEpoch;
}

function currentAbortEpoch() {
  return abortEpoch;
}

function throwIfAbortedSince(epoch) {
  if (abortEpoch !== epoch) throw new Error('cancelled by owner');
}

// The cooperative yielder every heavy loop awaits at its yield points.
// At 100% it degrades to a bare setImmediate (identical to the old
// behavior); at OFF it parks in place, waking every 250ms to re-check.
function makeYielder() {
  let busyStart = Date.now();
  const epoch = abortEpoch;
  return async () => {
    throwIfAbortedSince(epoch);
    while (currentCpuPct() <= 0) {
      throwIfAbortedSince(epoch);
      await new Promise((r) => setTimeout(r, 250));
      busyStart = Date.now(); // parked time is not busy time
    }
    const pct = currentCpuPct();
    const busyMs = Date.now() - busyStart;
    if (pct < 100 && busyMs >= WORK_MS) {
      // Sleep proportional to the time ACTUALLY spent busy, not to the
      // nominal WORK_MS. Deriving it from the constant made any un-yielded
      // quantum longer than 90ms inflate the duty cycle (measured: 25 ->
      // 42%, 90 -> 106% of a core). This makes the cap mean what it says at
      // any yield granularity — and with N workers the aggregate is N x pct.
      const sleepMs = Math.round((busyMs * (100 - pct)) / pct);
      await new Promise((r) => setTimeout(r, sleepMs));
      busyStart = Date.now();
    } else {
      await new Promise((r) => setImmediate(r));
      if (busyMs >= WORK_MS) busyStart = Date.now();
    }
    throwIfAbortedSince(epoch);
  };
}

module.exports = {
  makeYielder,
  currentCpuPct,
  askedCpuPct,
  allowedPct,
  heldPct,
  workersNow,
  readAllowedPct,
  useCeilingFiles,
  setCpuPct,
  refresh,
  abortHeavyWork,
  currentAbortEpoch,
  throwIfAbortedSince,
  CPU_MIN,
  CPU_MAX,
  CPU_DEFAULT,
};
