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

function currentCpuPct() {
  if (Date.now() - cache.at > CACHE_MS) {
    const v = clampPct(readSettings().service_cpu_pct);
    cache = { v: v == null ? CPU_DEFAULT : v, at: Date.now() };
  }
  return cache.v;
}

function setCpuPct(v) {
  const pct = clampPct(v);
  if (pct == null) throw new Error('cpu pct must be a number between 0 and 100');
  const settings = readSettings();
  settings.service_cpu_pct = pct;
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 1));
  cache = { v: pct, at: Date.now() };
  return pct;
}

// Test hook: drop the cache so the next currentCpuPct() re-reads the file.
function refresh() {
  cache = { v: cache.v, at: 0 };
}

// The cooperative yielder every heavy loop awaits at its yield points.
// At 100% it degrades to a bare setImmediate (identical to the old
// behavior); at OFF it parks in place, waking every 250ms to re-check.
function makeYielder() {
  let lastSleep = Date.now();
  return async () => {
    while (currentCpuPct() <= 0) {
      await new Promise((r) => setTimeout(r, 250));
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
