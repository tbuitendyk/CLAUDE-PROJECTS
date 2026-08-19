// DATA CATALOG + REPAIR (IMPLEMENTATION-PLAN phase 7; NEXT-RELEASE point 19).
//
// A catalog is the server-controlled statement of what market data a worker's
// system is SUPPOSED to hold, derived from its active setups (every pair a
// paper/live setup references, from the pair's earliest available month to
// now). Comparing the local candle cache against the catalog turns "did the
// user delete something?" into a MISSING/PRESENT list, and repair re-fetches
// exactly what is missing from the exchange's public channel — so a deleted
// month is a rebuild, not a file-not-found crash.
//
// This is the CURRENT-release, single-node form: catalog + local cache on the
// same box (ours, the VPS). The point-19 subscriber-worker form (worker
// registers its own data path, pulls its own candles) is the same manifest
// with a remote store — the interface here (required vs present -> repair) is
// what carries forward.
const path = require('path');
const binance = require('../binance');
const reg = require('./setups');

// The months a pair must cover: from its earliest cached month (its data
// origin on this box) through the current month. A setup cannot reference a
// pair with no data at all — that is a data-provisioning problem surfaced as
// an empty required list with a note, not a silent pass.
function monthsBetween(fromMonth, toMonth) {
  const out = [];
  let [y, m] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function currentMonthUtc(nowMs) {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// The set of pairs any active setup needs (trade + both contexts).
function requiredPairs(setups) {
  const pairs = new Set();
  for (const s of setups) {
    if (s.state !== 'paper' && s.state !== 'live') continue;
    const c = s.configSnapshot && s.configSnapshot.combo;
    if (!c) continue;
    for (const k of ['trade', 'ctx1', 'ctx2']) if (c[k]) pairs.add(c[k]);
  }
  return [...pairs].sort();
}

// Build the catalog: per required pair, the months it should cover and which
// of those are actually present on disk (in either storage form). Deterministic
// given (setups, cache, now).
function buildCatalog(nowMs = Date.now(), setups = null) {
  const active = (setups || reg.listSetups());
  const pairs = requiredPairs(active);
  const nowMonth = currentMonthUtc(nowMs);
  const entries = pairs.map((sym) => {
    const covered = binance.coveredMonths(sym);
    if (!covered.length) {
      return { symbol: sym, origin: null, required: [], present: [], missing: [],
        note: 'no data on this box for this pair — provision it before the setup can run' };
    }
    const required = monthsBetween(covered[0], nowMonth);
    const presentSet = new Set(covered);
    const present = required.filter((m) => presentSet.has(m));
    const missing = required.filter((m) => !presentSet.has(m));
    return { symbol: sym, origin: covered[0], required, present, missing };
  });
  return {
    builtUtc: new Date(nowMs).toISOString(),
    pairs: pairs.length,
    ok: entries.every((e) => e.missing.length === 0 && (e.required.length > 0 || e.note == null)),
    entries,
  };
}

// Repair: for each catalog entry, re-fetch the missing months from the public
// channel (monthlyKlines writes the bundle into the cache as a side effect;
// the CURRENT partial month is served by day files and cannot be bundled, so
// it is never "missing"). Returns what it fetched and what it could not, and
// re-reads the catalog so the caller sees the post-repair state. NEVER deletes.
async function repair(nowMs = Date.now(), opts = {}) {
  const cat = buildCatalog(nowMs, opts.setups);
  const nowMonth = currentMonthUtc(nowMs);
  const fetched = []; const failed = [];
  for (const e of cat.entries) {
    for (const month of e.missing) {
      if (month === nowMonth) continue; // partial current month: day-file territory
      const [y, m] = month.split('-').map(Number);
      try {
        await binance.monthlyKlines(e.symbol, y, m); // writes the bundle to cache
        fetched.push(`${e.symbol} ${month}`);
      } catch (err) {
        failed.push({ target: `${e.symbol} ${month}`, error: (err && err.message) || String(err) });
      }
    }
  }
  return { fetched, failed, catalog: buildCatalog(nowMs, opts.setups) };
}

module.exports = { buildCatalog, repair, requiredPairs, monthsBetween, currentMonthUtc };
