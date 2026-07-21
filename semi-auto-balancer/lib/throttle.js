const db = require('./db');

// Service-wide cooperative CPU cap. One setting (settings.service_cpu_pct,
// default 90) governs every heavy loop — comp-lab searches, the sensitivity
// tuner, Ladder Lab sweeps. The yielder re-reads the setting at its yield
// points (cached a few seconds), so changing it in the UI takes effect on
// RUNNING work within seconds — no restart, no kill. Duty cycle: ~90ms of
// work, then a real sleep sized so the loop uses ≈pct of a core. Timing-only
// everywhere it is used: sampling order and seeds are untouched, results are
// byte-identical at any setting.

const WORK_MS = 90;
const CPU_MIN = 25;
const CPU_MAX = 100;
const CPU_DEFAULT = 90;
const CACHE_MS = 3000;

let cache = { v: CPU_DEFAULT, at: 0 };

function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(CPU_MAX, Math.max(CPU_MIN, Math.round(n)));
}

function currentCpuPct() {
  if (Date.now() - cache.at > CACHE_MS) {
    let v = CPU_DEFAULT;
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'service_cpu_pct'").get();
      if (row) v = clampPct(row.value) ?? CPU_DEFAULT;
    } catch {
      /* settings unavailable — run at the default */
    }
    cache = { v, at: Date.now() };
  }
  return cache.v;
}

function setCpuPct(v) {
  const pct = clampPct(v);
  if (pct == null) throw new Error('cpu pct must be a number between 25 and 100');
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('service_cpu_pct', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(String(pct));
  cache = { v: pct, at: Date.now() };
  return pct;
}

// Drop the cache so the next currentCpuPct() re-reads (tests, and the POST
// endpoint after a write).
function refresh() {
  cache = { v: cache.v, at: 0 };
}

// The cooperative yielder every heavy loop runs through. Optional pauseGate
// (the job runner's) makes ⏸ Pause park the loop at the next yield and
// persist the checkpoint snapFn provides — see lib/jobs.js.
function makeYielder(pauseGate = null) {
  let lastSleep = Date.now();
  let checkpointedThisPause = false;
  return async (snapFn) => {
    if (pauseGate) {
      if (pauseGate.pending && pauseGate.pending() && !checkpointedThisPause && snapFn && pauseGate.saveCheckpoint) {
        try {
          pauseGate.saveCheckpoint(snapFn());
          checkpointedThisPause = true;
        } catch {
          /* checkpointing is best-effort; the in-memory pause still works */
        }
      }
      await pauseGate();
      if (!(pauseGate.pending && pauseGate.pending())) checkpointedThisPause = false;
    }
    const pct = currentCpuPct();
    const sleepMs = pct >= 100 ? 0 : Math.round((WORK_MS * (100 - pct)) / pct);
    if (sleepMs > 0 && Date.now() - lastSleep >= WORK_MS) {
      lastSleep = Date.now() + sleepMs;
      await new Promise((r) => setTimeout(r, sleepMs));
    } else {
      await new Promise((r) => setImmediate(r));
    }
  };
}

module.exports = { makeYielder, currentCpuPct, setCpuPct, refresh, CPU_MIN, CPU_MAX, CPU_DEFAULT };
