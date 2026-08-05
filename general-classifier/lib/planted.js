// THE PLANTED CHECK, as a button (owner order, 2026-08-03): a fabricated
// pair with a KNOWN signal pushed through the REAL sweep pipeline — same
// front door, same launcher, same workers, same null boards, same board
// reader. The instrument measures a known answer before its readings on the
// market count. QC 56 is the standing rule; this file is its through-pipeline
// half (the automated half lives in tests/test-planted.js and runs on every
// build).
//
// CALLER, NOT COPY. Nothing here re-implements the sweep. This module only:
//   1. writes the fabricated pair's candles into the ordinary data cache
//      (so the pipeline reads it exactly like a real pair), and
//   2. reads the finished gate run through the ordinary board reader
//      (lib/verdict.js) and applies the reading rules stamped at launch.
//
// The candle construction is the third-generation generator from
// tools/walkforward-planted-check.js (endpoint-pinned random walks; the
// planted rule is "the day after an up day follows it 70% of the time",
// with ZERO drift, so always-long earns nothing but fees). That generator
// has passed its known-answer criteria on the walk-forward harness
// (QC 56, PASS 2026-07-31).
const fs = require('fs');
const path = require('path');
const { mulberry32 } = require('./interlace');
const { cacheState, cachedMonths, HOUR_MS } = require('./binance');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
let tmpSeq = 0;

// The reserved symbol. It never enters a real run (the launcher refuses it),
// is never downloaded from Binance (the data endpoints regenerate it
// instead), and every gate run sweeps exactly this one pair.
const PLANTED_SYMBOL = 'PLANTEDUSDT';

// SECOND reserved pair (HT v2 exams, DESIGN-HT2.md): identical construction
// except the planted rule is OFF for the first ~2/3 of the span and switches
// ON for the final third. An age-weighted trainer has a KNOWN advantage
// here and a known non-advantage on the stationary pair — together they are
// the paired instrument's entrance exam (QC 56).
const PLANTED_LATE_SYMBOL = 'PLANTEDLATEUSDT';
const PLANTED_SYMBOLS = [PLANTED_SYMBOL, PLANTED_LATE_SYMBOL];
const isPlanted = (s) => PLANTED_SYMBOLS.includes(s);

// Fixed generator seed: the gate is a per-engine-version calibration, so two
// gate runs on the same engine and the same data span must see the same
// fabricated market.
const PLANTED_SEED = 41;
const PLANTED_LATE_SEED = 43;
const PLANTED_LATE_RULE_ON_FRAC = 2 / 3; // rule silent before this fraction of days

// READING RULES, stamped into the gate run's params at launch — written
// before the numbers exist, like every reading rule (owner spec).
const GATE_RULES = {
  G1: 'find and profit: the real board\'s best held-back money is positive [DERIVED: a 70%-follow rule pays in every era]',
  G2: 'beats always-long: that same row\'s held-back money exceeds holding the pair long [DERIVED: the fabricated pair has zero drift, so holding earns nothing but fees]',
  G3: 'the null boards destroy it: EVERY null board\'s best held-back money is below a quarter of the real board\'s, and every DECLARED board is present [direction DERIVED: dealt votes cannot carry the planted rule; the 1/4 factor GUESSED, mirrors the automated check\'s margin]',
  G4: 'no unit failures recorded in the gate run [DERIVED: a calibration with missing pieces proves nothing]',
};

// ---- candle generation (ported from tools/walkforward-planted-check.js) ---

function bridge(fromP, toP, steps, sigma, rng) {
  const raw = [Math.log(fromP)];
  for (let i = 1; i <= steps; i++) raw.push(raw[i - 1] + (rng() + rng() + rng() - 1.5) * sigma);
  const err = Math.log(toP) - raw[steps];
  return Array.from({ length: steps + 1 }, (_, i) => Math.exp(raw[i] + (err * i) / steps));
}

function dayCandles(pOpen, trendPct, outcomePct, rng) {
  const p18 = pOpen * (1 + outcomePct / 100);
  const p24 = pOpen * (1 + trendPct / 100);
  const SIG = 0.011;
  const seg1 = bridge(pOpen, p18, 17, SIG, rng);
  const seg2 = bridge(p18, p24, 6, SIG, rng);
  const closes = [pOpen, ...seg1.slice(1), ...seg2.slice(1)];
  const rows = [];
  let prev = pOpen;
  for (let h = 0; h < 24; h++) {
    const open = prev;
    const close = closes[h + 1] ?? p24;
    rows.push({
      open, close,
      high: Math.max(open, close) * (1 + 0.001 + rng() * 0.004),
      low: Math.min(open, close) * (1 - 0.001 - rng() * 0.004),
      vol: 1e6 * (1 + 0.1 * (rng() - 0.5)),
    });
    prev = close;
  }
  return rows;
}

// ---- span: the fabricated pair always covers the real data's extent -------

// Oldest first month and newest covered date across the REAL cached pairs
// (owner order: "as recent as the most recent data we've got loaded and as
// old as the oldest"). Null when nothing real is cached — a gate without
// real data has nothing to calibrate for.
function plantedSpan() {
  const real = cacheState().filter((s) => !isPlanted(s.symbol));
  if (!real.length) return null;
  let fromMonth = null;
  let toDate = null;
  const endOfMonth = (mm) => {
    const [y, m] = mm.split('-').map(Number);
    return `${mm}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  };
  for (const s of real) {
    if (fromMonth === null || s.from < fromMonth) fromMonth = s.from;
    // Coverage ends at the LATER of: the newest day-file date, or the last
    // day of the newest BUNDLE month. cacheState's `to` alone understates
    // when stale day files linger inside the newest bundled month (its
    // '2026-07-15' hides the bundle's July 31 — review 2026-08-03). A
    // month's end-of-month only counts when a bundle actually covers it.
    const candidates = [s.to.length > 7 ? s.to : endOfMonth(s.to)];
    const bundles = cachedMonths(s.symbol);
    if (bundles.length) candidates.push(endOfMonth(bundles[bundles.length - 1]));
    for (const end of candidates) {
      if (toDate === null || end > toDate) toDate = end;
    }
  }
  return { fromMonth, toDate };
}

// Regenerate a fabricated pair over a span: delete every existing file for
// that symbol, then write monthly files (the last one partial when the span
// ends mid-month). Deterministic for a given span: fixed seed, zero drift.
// ruleOnFrac = the fraction of days BEFORE which the planted rule is silent
// (0 = the stationary pair, byte-identical to the pre-refactor generator:
// the rule-off branch draws nothing extra from the rng when never taken).
function generateFabricated(span, symbol, seed, ruleOnFrac) {
  if (!span || !span.fromMonth || !span.toDate) {
    throw new Error('the planted pair needs real cached data to copy its date span from — load data first');
  }
  const [fy, fm] = span.fromMonth.split('-').map(Number);
  const t0 = Date.UTC(fy, fm - 1, 1);
  const [ty, tm, td] = span.toDate.split('-').map(Number);
  const endDay = Date.UTC(ty, tm - 1, td);
  const days = Math.floor((endDay - t0) / (24 * HOUR_MS)) + 1;
  if (!(days >= 1)) throw new Error(`planted span is empty (${span.fromMonth} .. ${span.toDate})`);
  const ruleOnDay = Math.floor(days * ruleOnFrac);

  const rng = mulberry32(seed);
  // Trend days come in shuffled 20-day blocks of ten ups and ten downs, so
  // the up/down mix is balanced in every era (zero drift by construction).
  const trends = [];
  for (let b = 0; b < Math.ceil(days / 20); b++) {
    const block = Array.from({ length: 20 }, (_, i) => (i < 10 ? 1 : -1));
    for (let i = block.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [block[i], block[j]] = [block[j], block[i]];
    }
    trends.push(...block);
  }
  const magOf = () => 0.8 + rng() * 3.4;
  let price = 100;
  const byMonth = new Map();
  for (let d = 0; d < days; d++) {
    const prevTrend = d === 0 ? 1 : trends[d - 1];
    const follow = rng() < 0.7 ? 1 : -1; // THE PLANT: next day follows today, 70%
    // Before the rule switches on, the outcome direction is a fresh coin —
    // no relation to yesterday. The extra rng() lives INSIDE the branch so a
    // ruleOnFrac of 0 (the stationary pair) draws exactly the pre-refactor
    // stream and reproduces its bytes.
    const dir = d >= ruleOnDay ? prevTrend * follow : (rng() < 0.5 ? 1 : -1);
    const outcomePct = dir * magOf();
    const trendPct = trends[d] > 0 ? 1.5 : (1 / 1.015 - 1) * 100;
    const rows = dayCandles(price, trendPct, outcomePct, rng);
    for (let h = 0; h < 24; h++) {
      const ts = t0 + (d * 24 + h) * HOUR_MS;
      const dt = new Date(ts);
      const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push({ ts, open: rows[h].open, high: rows[h].high, low: rows[h].low, close: rows[h].close, quoteVolume: rows[h].vol });
    }
    price = rows[23].close;
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  // Old planted files first: a span that SHRANK (real data trimmed) must not
  // leave stale months behind, or the fabricated pair outlives the real data
  // it is supposed to mirror.
  for (const f of fs.readdirSync(CACHE_DIR)) {
    if (f.startsWith(`${symbol}-1h-`)) {
      try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch { /* recount below */ }
    }
  }
  let written = 0;
  for (const [month, rows] of byMonth) {
    const file = path.join(CACHE_DIR, `${symbol}-1h-${month}.json`);
    // pid alone is NOT unique here: two regenerations in one process (a data
    // job's tail and a gate press) would share temp names and rename() could
    // throw mid-write. A per-call counter keeps every writer distinct.
    const tmp = `${file}.tmp${process.pid}-${++tmpSeq}`;
    fs.writeFileSync(tmp, JSON.stringify(rows));
    fs.renameSync(tmp, file);
    written++;
  }
  return { symbol, fromMonth: span.fromMonth, toDate: span.toDate, days, months: written, seed, ruleOnDay: ruleOnFrac > 0 ? ruleOnDay : null };
}

// The stationary pair (the planted check's subject) — rule alive the whole way.
function generatePlanted(span) {
  return generateFabricated(span, PLANTED_SYMBOL, PLANTED_SEED, 0);
}

// The late-rule pair (HT v2 exam A's subject) — rule on for the final third.
function generatePlantedLate(span) {
  return generateFabricated(span, PLANTED_LATE_SYMBOL, PLANTED_LATE_SEED, PLANTED_LATE_RULE_ON_FRAC);
}

// True when the fabricated pair currently has cache files — the data
// endpoints regenerate it after every real refresh/download ONLY if it
// exists (a box that never ran the gate carries no fabricated data).
function plantedExists(symbol = PLANTED_SYMBOL) {
  try {
    return fs.readdirSync(CACHE_DIR).some((f) => f.startsWith(`${symbol}-1h-`));
  } catch {
    return false;
  }
}

// ---- the gate run's launch parameters --------------------------------------

// One fixed recipe, stamped with the reading rules. Singles on the fabricated
// pair, daily-1d (the planted rule is a day-to-day rule), argmax, 70/15/15,
// four null boards (the gate's claim is the 1/4 margin rule, not the rank
// floor, so four draws suffice and keep the run short).
function gateParams() {
  return {
    universe: [PLANTED_SYMBOL],
    sizes: { singles: true },
    allLoaded: true,
    permute: {},
    set: { geometry: 'daily-1d', decision: 'argmax', band: 'auto', weekdaysOnly: false },
    windowLayout: 'split70',
    labelShiftReps: 4,
    labelShiftScope: 'window',
    minTrades: 10,
    promoteK: 25,
    plantedGate: true,
    plantedRules: GATE_RULES,
    label: 'planted-gate',
    description: 'PLANTED CHECK — fabricated pair with a known signal through the real pipeline; '
      + 'null-tool readings count only while the running engine holds a PASS from this gate',
  };
}

// ---- reading the finished gate run -----------------------------------------

// Apply the stamped rules to a finished gate doc. Pure arithmetic on the
// stored board — the same rows and the same reader (lib/verdict.js) the
// owner's Tool 2 uses.
function gateVerdict(doc) {
  const { nullVerdict, realRows } = require('./verdict');
  const out = { id: doc.id, engineVersion: doc.params?.engineVersion || 'unknown', pass: false, checks: [], sentences: [] };
  if (doc.status !== 'done') {
    out.sentences.push(`gate run ${doc.id} is ${doc.status} — no verdict until it finishes`);
    return out;
  }
  let v;
  try {
    v = nullVerdict(doc, doc, null);
  } catch (err) {
    out.sentences.push(`UNREADABLE: ${err.message}`);
    return out;
  }
  const real = realRows(doc);
  const best = real.reduce((a, r) => (r.holdPnl > a.holdPnl ? r : a));
  const money = (x) => `${x < 0 ? '-' : '+'}$${Math.abs(x).toFixed(2)}`;

  const g1 = best.holdPnl > 0;
  out.checks.push({ rule: 'G1', text: GATE_RULES.G1, pass: g1 });
  out.sentences.push(`${g1 ? 'ok  ' : 'FAIL'} G1: real board best held-back money ${money(best.holdPnl)}`);

  const g2 = best.holdAlwaysLong != null && best.holdPnl > best.holdAlwaysLong;
  out.checks.push({ rule: 'G2', text: GATE_RULES.G2, pass: g2 });
  out.sentences.push(best.holdAlwaysLong == null
    ? 'FAIL G2: the always-long comparison is missing from the stored row — unreadable counts as failed'
    : `${g2 ? 'ok  ' : 'FAIL'} G2: beats always-long by ${money(best.holdPnl - best.holdAlwaysLong)} (long alone ${money(best.holdAlwaysLong)})`);

  const draws = v.selection ? v.selection.draws : [];
  const limit = best.holdPnl / 4;
  const offenders = draws.filter((d) => d.value >= limit);
  // "EVERY null board" means every DECLARED board: a board that vanished
  // (all its rows skipped) shrinks the population silently, which reads as
  // a pass earned on fewer draws than stamped (review 2026-08-03). The
  // stamped count is in the run's own parameters.
  const declared = Number(doc.params?.labelShiftReps) || 0;
  const g3 = draws.length > 0 && draws.length === declared && offenders.length === 0 && g1;
  out.checks.push({ rule: 'G3', text: GATE_RULES.G3, pass: g3 });
  out.sentences.push(draws.length === 0
    ? 'FAIL G3: no null boards in the gate run — the rule cannot be applied'
    : draws.length !== declared
      ? `FAIL G3: ${draws.length} null boards scored but ${declared} were declared — a shrunken population is not the stamped rule`
      : `${g3 ? 'ok  ' : 'FAIL'} G3: ${draws.length} null boards, best of each ${draws.map((d) => money(d.value)).join(', ')} against the quarter-line ${money(limit)}`
        + (offenders.length ? ` — ${offenders.length} at or above it` : ''));

  // A calibration run with recorded unit failures is not a calibration:
  // whatever failed might be exactly the piece being calibrated.
  const failures = Array.isArray(doc.failures) ? doc.failures.length : 0;
  out.checks.push({ rule: 'G4', text: GATE_RULES.G4, pass: failures === 0 });
  out.sentences.push(failures === 0
    ? 'ok   G4: no unit failures recorded'
    : `FAIL G4: ${failures} failure(s) recorded in the gate run — fix the cause and re-run the check`);

  out.pass = out.checks.every((c) => c.pass);
  out.sentences.push(out.pass
    ? `PLANTED CHECK PASS on engine ${out.engineVersion}: the pipeline found the planted rule, profited on it, beat holding, and every null board destroyed it.`
    : `PLANTED CHECK FAIL on engine ${out.engineVersion}: do not lean on null-tool readings from this engine until the cause is found and the gate passes.`);
  return out;
}

// The status the interface strip shows: latest gate run vs the RUNNING
// engine version. PASS carries only while the versions match — a new release
// starts NOT CHECKED (owner: "you'll need to update the code behind that
// button every time you make a new release" — this is how the record keeps
// us honest about it).
function gateStatus(currentVersion, batchesDir) {
  const dir = batchesDir || path.join(__dirname, '..', 'data', 'batches');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f.includes('planted-gate'));
  } catch { files = []; }
  const docs = [];
  const unreadable = [];
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (d && d.kind === 'bracketlab' && d.params && d.params.plantedGate) docs.push(d);
    } catch {
      // An unreadable gate record must not be SKIPPED into silence — the
      // filename carries the timestamp, so if it is newer than every
      // readable record, an older PASS would otherwise shadow whatever
      // this one said (review 2026-08-03).
      unreadable.push(f);
    }
  }
  docs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const running = docs.find((d) => d.status === 'running') || null;
  const latestDone = docs.find((d) => d.status === 'done') || null;
  const out = {
    engineVersion: currentVersion,
    state: 'NOT CHECKED',
    detail: `engine ${currentVersion} has no passing planted check yet`,
    running: running ? running.id : null,
    lastGate: null,
  };
  const newestUnreadable = unreadable.sort().pop() || null;
  if (newestUnreadable && (!latestDone || newestUnreadable > `${latestDone.id}.json`)) {
    out.state = 'NOT CHECKED';
    out.detail = `the newest gate record (${newestUnreadable}) is unreadable — no verdict stands until a fresh gate runs`;
    out.unreadable = unreadable;
    return out;
  }
  if (latestDone) {
    const verdict = gateVerdict(latestDone);
    out.lastGate = {
      id: latestDone.id,
      engineVersion: verdict.engineVersion,
      finishedAt: latestDone.finishedAt,
      pass: verdict.pass,
      sentences: verdict.sentences,
    };
    if (verdict.engineVersion === currentVersion) {
      out.state = verdict.pass ? 'PASS' : 'FAIL';
      out.detail = verdict.pass
        ? `planted check PASS on this engine (${currentVersion}, gate ${latestDone.id})`
        : `planted check FAIL on this engine (${currentVersion}, gate ${latestDone.id}) — null-tool readings do not count`;
    } else {
      out.detail = `engine ${currentVersion} not checked — last gate ran on engine ${verdict.engineVersion} (${verdict.pass ? 'PASS' : 'FAIL'})`;
    }
  }
  return out;
}

module.exports = {
  PLANTED_SYMBOL, PLANTED_LATE_SYMBOL, PLANTED_SYMBOLS, isPlanted,
  PLANTED_SEED, PLANTED_LATE_SEED, PLANTED_LATE_RULE_ON_FRAC,
  GATE_RULES, plantedSpan, generatePlanted, generatePlantedLate, plantedExists,
  gateParams, gateVerdict, gateStatus,
};
