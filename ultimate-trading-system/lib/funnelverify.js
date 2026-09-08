// funnelverify.js -- the verdict on a Stage 4 record set, as pure arithmetic
// over its survivors' rows (VERIFY-DESIGN.md, sections 4 and 8; 3.86.0).
//
// NOTHING HERE READS A FILE OR A SET. lib/stages.js hands in the rows and the
// comparisons and writes back what this hands out, so every number on a verdict
// can be re-derived from the block alone, and every function here can be
// tested on a table typed into a test.
//
// EVERY READING RULE IS DECLARED BEFORE ITS NUMBER EXISTS. declareRules() is
// called first, its answer rides on the block as `rules`, and every reading
// below takes that object rather than deciding a threshold of its own. Each
// rule is tagged DERIVED (it follows from the set's own record) or GUESSED (a
// chosen threshold), the way the stage-engine check stamps its own.
//
// THE UNIT OF VERIFICATION IS THE SET, never one row: a rule can be read on a
// noise board and a single row cannot (owner decision 1, 2026-09-07). Each
// survivor also gets its own reading against its own copies, printed beside
// how many would pass by chance, and that reading never gates the set.

const F = require('./funnel');

const HELD = 'avgHold';                          // held-back money on a board row
const LIMITS = ['maxDrawdown', 'avgTrades'];      // the two rebuilt-number limits step 6 can write
const DEFAULT_SANITY_PCT = 50;
const GATED = ['buyHold', 'shortHold'];           // the two comparisons a rule has to beat (its own marks)
const NOT_GATED = ['alwaysLong', 'alwaysShort'];  // printed as the window's direction, never a gate

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const mean = (xs) => {
  const c = (xs || []).filter((v) => v != null);
  return c.length ? c.reduce((a, v) => a + v, 0) / c.length : null;
};
const median = (xs) => {
  const c = (xs || []).filter((v) => v != null).sort((a, b) => a - b);
  if (!c.length) return null;
  const m = c.length >> 1;
  return c.length % 2 ? c[m] : (c[m - 1] + c[m]) / 2;
};

// ---- the rules, declared first ---------------------------------------------------
function declareRules(check, asked = {}) {
  const K = Math.max(0, Math.floor(Number((check || {}).k) || 0));
  const own = F.barPctOf(check);
  // A BLANK BOX IS NOT AN ASK. A box read as a number hands in 0, and 0 is not
  // a share anyone typed: it means the set's own, never a bar of one copy
  // (review, 2026-09-08). Only a share of 1 to 100 replaces the set's own.
  const askedBar = asked.barPct == null || asked.barPct === '' ? null : Math.floor(Number(asked.barPct));
  const barPct = askedBar != null && Number.isFinite(askedBar) && askedBar >= 1 ? Math.min(100, askedBar) : own;
  const barChanged = barPct !== own;
  const bar = K ? F.barOf({ k: K, barPct }) : 0;
  // the sanity share: a typed 0 to 100 is kept as typed (0 is a threshold
  // somebody chose, and it is printed GUESSED like any other); blank or
  // unreadable means the default
  const askedS = asked.sanityPct == null || asked.sanityPct === '' ? null : Number(asked.sanityPct);
  const sanityPct = askedS != null && Number.isFinite(askedS) && askedS >= 0 ? Math.min(100, askedS) : DEFAULT_SANITY_PCT;
  return {
    copies: K,
    barPct, ownBarPct: own, barChanged, bar, chance: K ? F.chanceOf(bar, K) : null,
    sanityPct,
    gated: GATED.slice(), notGated: NOT_GATED.slice(),
    limits: LIMITS.slice(),
    tags: {
      footing: 'DERIVED', comparisons: 'DERIVED',
      bar: barChanged ? 'GUESSED' : 'DERIVED',
      sanity: 'GUESSED',
    },
  };
}

// ---- V1: what a rule may carry ------------------------------------------------------
// Ranges and allowed values on dials, and floors on the two rebuilt-number
// limits, and nothing else. That is what guarantees a scrambled copy keeps the
// same survivors: none of those keys reads the money. A top-N cut is allowed
// because the copy takes its own top N by its own scrambled money (nullCopy).
function ruleKeys(rule) {
  const R = rule || {};
  const bad = [];
  for (const k of Object.keys(R.ranges || {})) if (!F.ALL_DIALS.includes(k)) bad.push(`ranges.${k}`);
  for (const k of Object.keys(R.allowed || {})) if (!F.ALL_DIALS.includes(k)) bad.push(`allowed.${k}`);
  for (const k of Object.keys(R.floors || {})) if (!LIMITS.includes(k)) bad.push(`floors.${k}`);
  return {
    ok: !bad.length,
    bad,
    readsHeldBackTrades: Object.keys(R.floors || {}).includes('avgTrades'),
    cut: R.cut ? { column: R.cut.column, n: R.cut.n } : null,
  };
}

// ---- V2: the held-back read, against the four comparisons ---------------------------
// `controls` is what lib/stages.js's controlsOf hands back for this unit at the
// survivors' own hold lengths: { known, why, keys, of, missing, alwaysLong:
// {lo,hi}, alwaysShort, buyHold, shortHold }. Beaten means beaten at the worst
// of the hold lengths in use, by at least a cent, like the Funnel's own line.
function heldBackRead(rows, controls) {
  const held = (rows || []).map((r) => num(r[HELD]));
  const of = held.filter((v) => v != null).length;
  const real = mean(held);
  const c = controls || { known: false, why: 'no comparisons were handed in' };
  const comparisons = {
    known: !!c.known, why: c.known ? null : (c.why || null),
    keys: c.keys || null, of: c.of ?? null, missing: c.missing ?? null,
  };
  for (const k of [...GATED, ...NOT_GATED]) comparisons[k] = c.known && c[k] ? { lo: c[k].lo, hi: c[k].hi } : null;
  comparisons.beatsBuyHold = c.known && real != null && comparisons.buyHold ? F.beats(real, comparisons.buyHold.hi) : null;
  comparisons.beatsShortHold = c.known && real != null && comparisons.shortHold ? F.beats(real, comparisons.shortHold.hi) : null;
  const positive = real != null && real > 0;
  return {
    real, of, missing: (rows || []).length - of,
    trades: mean((rows || []).map((r) => num(r.avgTrades))),
    vsLong: mean((rows || []).map((r) => num(r.avgVsLong))),
    positive,
    comparisons,
    // unknown never passes: a gate on a number nobody has is not a gate
    pass: comparisons.known && positive && comparisons.beatsBuyHold === true && comparisons.beatsShortHold === true,
    incomplete: !comparisons.known,
  };
}

// ---- V3: the survivors against their own scrambled copies, on the held-back window ----
// For each copy d, the mean over survivors of the money the same setting made
// on the held-back days with its forecasts dealt onto random days (noiseHold[d]).
// A survivor with no figure on a copy is COUNTED and printed, never silently
// dropped; a copy with fewer survivors than the rest is printed as such.
// `copyRowsAt(d)`, when given, names the rows copy d keeps -- a rule with a
// top-N cut lets each copy take its own top N by its own scrambled test money.
function copiesRead(rows, rules, copyRowsAt = null) {
  const K = rules.copies;
  const list = rows || [];
  const real = mean(list.map((r) => num(r[HELD])));
  const copyMeans = [];
  const counted = [];
  for (let d = 0; d < K; d++) {
    const mine = copyRowsAt ? copyRowsAt(d) : list;
    const vals = (mine || []).map((r) => (Array.isArray(r.noiseHold) ? num(r.noiseHold[d]) : null)).filter((v) => v != null);
    copyMeans.push(vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null);
    counted.push(vals.length);
  }
  const beats = copyMeans.filter((v) => F.beats(real, v)).length;
  const noFigure = list.filter((r) => !Array.isArray(r.noiseHold) || !r.noiseHold.some((v) => num(v) != null)).length;
  const short = counted.filter((n) => n < list.length).length;
  const pass = K > 0 && real != null && real > 0 && beats >= rules.bar;
  return {
    copies: K, real, copyMeans, copySurvivors: counted,
    beats, bar: rules.bar, barPct: rules.barPct, chance: rules.chance, floor: K ? 1 / (K + 1) : null,
    lead: F.leadOf(real, copyMeans),
    leadDefinition: "the real figure minus the copies' mean, over the copies' sample spread",
    survivorsWithNoFigure: noFigure, copiesShortOfSurvivors: short,
    pass, incomplete: K === 0,
  };
}

// ---- V4: every survivor against its own copies -- a reading each, never a gate ----
function perSurvivor(rows, rules) {
  const K = rules.copies;
  const bar = rules.bar;
  const list = (rows || []).map((r) => {
    const held = num(r[HELD]);
    const copies = Array.isArray(r.noiseHold) ? r.noiseHold.map(num) : [];
    const kept = copies.filter((v) => v != null).length;
    const beats = copies.filter((v) => F.beats(held, v)).length;
    return {
      si: r.si, label: r.label, held, trades: num(r.avgTrades), vsLong: num(r.avgVsLong),
      storedBeat: num(r.beat), storedPairs: num(r.pairs), storedLead: num(r.avgLead),
      copiesKept: kept, beats, lead: F.leadOf(held, copies),
      pass: K > 0 && kept > 0 && held != null && held > 0 && beats >= bar,
      thirds: Array.isArray(r.pnlThirds) ? r.pnlThirds.map(num) : null,
    };
  });
  const n = list.length;
  const deals = list.map((x) => x.storedPairs).filter((v) => v != null);
  const sumBeat = list.reduce((a, x) => a + (x.storedBeat || 0), 0);
  const sumPairs = list.reduce((a, x) => a + (x.storedPairs || 0), 0);
  const thirds = [0, 1, 2].map((i) => list.filter((x) => x.thirds && x.thirds[i] != null && x.thirds[i] > 0).length);
  const withThirds = list.filter((x) => x.thirds && x.thirds.some((v) => v != null)).length;
  return {
    survivors: n,
    passing: list.filter((x) => x.pass).length,
    byChance: rules.chance == null ? null : n * rules.chance,
    chanceEach: rules.chance,
    positive: list.filter((x) => x.held != null && x.held > 0).length,
    beatsAlwaysLong: list.filter((x) => x.vsLong != null && x.vsLong > 0).length,
    headToHeadsWon: sumPairs ? sumBeat / sumPairs : null,
    dealsOver: deals.length ? Math.max(...deals) : null,
    kept: K,
    medianStoredLead: median(list.map((x) => x.storedLead)),
    medianLead: median(list.map((x) => x.lead)),
    moneyByThird: withThirds ? { of: withThirds, positive: thirds } : null,
    definitions: {
      storedBeat: 'beat its own null set, as stored on the record: raw dollars over every deal, which may be more than the copies kept',
      beats: 'beats, read here: cents over the copies kept, the same reading the set verdict makes',
      storedLead: 'lead, as stored on the record: over the population spread, and 0 with no spread',
      lead: 'lead, read here: over the sample spread, and none with fewer than two copies',
    },
    notIndependent: 'the survivors share one coin, one window and the same deals, so they are not independent draws',
    rows: list,
  };
}

// ---- V5: sanity -- noise must lose ---------------------------------------------------
function sanity(boardRows, survivorRows, rules) {
  const share = (rows) => {
    let n = 0;
    let neg = 0;
    for (const r of rows || []) {
      for (const v of (Array.isArray(r.noiseHold) ? r.noiseHold : [])) {
        const x = num(v);
        if (x == null) continue;
        n++;
        if (x < 0) neg++;
      }
    }
    return { figures: n, losing: n ? neg / n : null };
  };
  const board = share(boardRows);
  const survivors = share(survivorRows);
  return {
    threshold: rules.sanityPct,
    board, survivors,
    known: board.losing != null,
    ok: board.losing != null && board.losing * 100 > rules.sanityPct,
  };
}

// ---- line A (information only): the rule on the test window against its own copies ----
function lineA(rows, rules, copyRowsAt = null) {
  const list = rows || [];
  const real = mean(list.map(F.money));
  const K = rules.copies;
  const copyMeans = Array.from({ length: K }, (_, d) => mean((copyRowsAt ? copyRowsAt(d) : list).map(F.moneyAt(d))));
  const beats = copyMeans.filter((v) => F.beats(real, v)).length;
  return {
    information: true, real, copies: K, copyMeans, beats, bar: rules.bar, clears: K > 0 && beats >= rules.bar,
    lead: F.leadOf(real, copyMeans),
    why: 'the rule was chosen against these very copies, so this always looks good; printed, never a pass or fail',
  };
}

// ---- line B (information only): the bound on top-N shopping --------------------------
// The best N by test money on the real board against the best N by scrambled
// test money on each copy, like against like: what shopping alone would find.
function lineB(boardRows, n, rules) {
  const N = Math.max(0, Math.floor(Number(n) || 0));
  const K = rules.copies;
  const board = boardRows || [];
  const topMean = (moneyOf) => {
    const vals = board.map(moneyOf).filter((v) => v != null).sort((a, b) => b - a).slice(0, N);
    return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
  };
  const real = topMean(F.money);
  const copyMeans = Array.from({ length: K }, (_, d) => topMean(F.moneyAt(d)));
  const beats = copyMeans.filter((v) => F.beats(real, v)).length;
  return {
    information: true, n: N, of: board.length, real, copies: K, copyMeans, beats, bar: rules.bar,
    clears: K > 0 && beats >= rules.bar, lead: F.leadOf(real, copyMeans),
    why: `the best ${N} by test money on the real board against the best ${N} by scrambled test money on each copy: what shopping alone would have found`,
  };
}

// ---- V6: the rule on the OTHER units, held-back window -- two counts, never a gate ----
// One unit's reading: the rows the set's rule keeps on that unit's board, read
// exactly as the set's own copies are (copiesRead), with the bar resolved
// against THAT unit's copy count at the declared share. A unit where the rule
// keeps nothing, or where what it keeps carries no held-back figure, is
// "keeps nothing": printed, and never in the denominator.
function othersUnitRead(kept, rules, copyRowsAt = null) {
  const list = kept || [];
  const K = list.length && Array.isArray(list[0].noiseHold) ? list[0].noiseHold.length : 0;
  const bar = K ? F.barOf({ k: K, barPct: rules.barPct }) : 0;
  const read = copiesRead(list, { copies: K, bar, barPct: rules.barPct, chance: K ? F.chanceOf(bar, K) : null }, copyRowsAt);
  const keepsNothing = !list.length || read.real == null;
  return {
    survivors: list.length, real: read.real,
    positive: !keepsNothing && read.real > 0,
    copies: K, bar, beats: read.beats,
    clears: !keepsNothing && read.pass === true,
    lead: read.lead,
    keepsNothing, survivorsWithNoFigure: read.survivorsWithNoFigure,
  };
}
// the two counts, beside the walk's own test-window mark; a mark when fewer
// than half of the units that keep something are positive
function othersSummary(units) {
  const usable = (units || []).filter((u) => !u.keepsNothing);
  const of = usable.length;
  const positive = usable.filter((u) => u.positive).length;
  const clearBar = usable.filter((u) => u.clears).length;
  const keepsNothing = (units || []).length - of;
  const mark = of > 0 && positive < of / 2 ? `fewer than half of the ${of} other units are positive on the held-back window` : null;
  return { positive, of, clearBar, keepsNothing, mark };
}

// ---- V7: the ride, the held-back half kept beside the test half ----------------------
// `perSetting` is what the rebuild hands back (label -> { units: [{ trade, ctx1,
// ctx2, geometry, pnl, trades, holdout, rich: { test, hold } }] }); `keyOf`
// names a unit the way the board does, and only the set's own unit is kept.
const RIDE_FIELDS = ['maxDrawdown', 'worstTrade', 'bestTrade', 'wins', 'stops', 'grossPerTrade'];
function rideOf(perSetting, { unitKey, keyOf, labels }) {
  const rows = [];
  const missing = [];
  const half = (r, moneyV, tradesV) => {
    const o = { money: num(moneyV), trades: num(tradesV) };
    for (const f of RIDE_FIELDS) o[f] = r ? num(r[f]) : null;
    o.pnlThirds = r && Array.isArray(r.pnlThirds) ? r.pnlThirds.map(num) : null;
    return o;
  };
  for (const label of labels || []) {
    const e = perSetting && typeof perSetting.get === 'function' ? perSetting.get(label) : (perSetting || {})[label];
    const u = e && (e.units || []).find((x) => keyOf(x) === unitKey);
    if (!u) { missing.push(label); continue; }
    rows.push({
      label,
      hold: half(u.rich && u.rich.hold, (u.holdout || {}).pnl, (u.holdout || {}).trades),
      test: half(u.rich && u.rich.test, u.pnl, u.trades),
    });
  }
  return { rows, missing };
}

// ---- the verdict sentence, from stored numbers only ---------------------------------
// the way the page prints money: the sign before the dollar sign
const money = (v) => (v == null ? 'no figure' : `${Number(v) < 0 ? '-' : ''}$${Math.abs(Number(v)).toFixed(2)}`);
const pct = (v) => (v == null ? '?' : `${Math.round(100 * v)}%`);
function verdict(block) {
  const b = block;
  const parts = [];
  // the instrument first: the stage-engine check, the release's one check (the
  // planted check that opened this sentence went with the older engine, 3.97.0)
  const sg = b.stageGate || null;
  if (sg) parts.push(sg.state === 'PASS' ? `the stage-engine check stood (release ${sg.release || 'unrecorded'})` : `no stage-engine check stood (${sg.state || 'NOT CHECKED'})`);
  const f = b.footing || {};
  parts.push(f.ok ? `the rule gives back its own ${f.had} survivors today` : `the footing did not stand (${f.why || 'unstated'})`);
  const h = b.heldBack || {};
  const c = h.comparisons || {};
  parts.push(`on the held-back window the ${h.of ?? 0} survivors made ${money(h.real)} a setting`
    + (c.known
      ? `, ${c.beatsBuyHold ? 'beating' : 'not beating'} buying the coin and going away and ${c.beatsShortHold ? 'beating' : 'not beating'} shorting it and going away`
      : `, and the four comparisons are not known (${c.why || 'unstated'})`)
    + `, after at least ${(b.looks || {}).unstamped ?? 0} unstamped looks`);
  const cp = b.copies || {};
  if (cp.incomplete) parts.push('the set kept no scrambled copies, so nothing was read against nothing');
  else parts.push(`against its own ${cp.copies} scrambled copies it beats ${cp.beats}, the bar being ${cp.bar} (${cp.barPct}%); a forecast-free rule clears that about ${pct(cp.chance)} of the time, and the finest claim ${cp.copies} copies allow is 1 in ${cp.copies + 1}, a floor, never a measure of strength`);
  const s = b.survivors || {};
  parts.push(`${s.passing ?? 0} of ${s.survivors ?? 0} survivors clear the same bar on their own copies, about ${s.byChance == null ? '?' : s.byChance.toFixed(1)} would by chance`);
  const sn = b.sanity || {};
  parts.push(sn.known ? `sanity: ${pct(sn.board.losing)} of the board's scrambled held-back figures lose money, the threshold being ${sn.threshold}%, ${sn.ok ? 'PASS' : 'FAIL'}` : 'sanity: not known');
  // the other units (V6), when read: two counts, information, never a gate
  const o = b.others || null;
  parts.push(o
    ? `on the other units, read ${String(o.at || '').slice(0, 16)}: ${o.positive} of ${o.of} other units positive on the held-back window, ${o.clearBar} clear the bar${o.keepsNothing ? `, ${o.keepsNothing} keep nothing` : ''}${o.mark ? ` (${o.mark})` : ''}, information only`
    : 'the other units not read when this was stamped');
  const pass = !!(f.ok && h.pass && cp.pass && sn.ok);
  return { pass, sentence: `${pass ? 'PASS' : 'FAIL'}: ${parts.join('; ')}. What a pass buys: this window only.` };
}

// ---- the reserve grade on the unread window (3.89.0): the verdict's four, on that window ----
const day = (ts) => (ts == null ? '?' : new Date(Number(ts)).toISOString().slice(0, 10));
function unreadVerdict(block) {
  const b = block;
  const parts = [];
  const g = b.gate || {};
  parts.push(g.id ? `the verdict ${g.id} stood (PASS under release ${g.release || '?'})` : 'no verdict stood');
  const w = b.window || {};
  parts.push(`the unread window from ${day(w.fromTs)} holds ${w.chunks ?? 0} whole chunks, the box's data reaching ${day(w.seenToTs)}`);
  const look = Number(b.look) || 1;
  parts.push(look > 1
    ? `look ${look}: this window had been read ${look - 1} time(s) before, so it is no longer data nothing has seen and the floor below is the best case, not the strength`
    : 'look 1: the first look at data nothing in the system has seen');
  const f = b.footing || {};
  parts.push(f.ok ? `the rule gives back its own ${f.had} survivors today` : `the footing did not stand (${f.why || 'unstated'})`);
  const h = b.read || {};
  const c = h.comparisons || {};
  parts.push(`on the unread window the ${h.of ?? 0} survivors made ${money(h.real)} a setting`
    + (c.known
      ? `, ${c.beatsBuyHold ? 'beating' : 'not beating'} buying the coin and going away and ${c.beatsShortHold ? 'beating' : 'not beating'} shorting it and going away`
      : `, and the four comparisons are not known (${c.why || 'unstated'})`));
  const cp = b.copies || {};
  if (cp.incomplete) parts.push('no scrambled copies were priced, so nothing was read against nothing');
  else parts.push(`against ${cp.copies} scrambled copies of that window it beats ${cp.beats}, the bar being ${cp.bar} (${cp.barPct}%); a forecast-free rule clears that about ${pct(cp.chance)} of the time, and the finest claim ${cp.copies} copies allow is 1 in ${cp.copies + 1}, a floor, never a measure of strength`);
  const sv = b.survivors || {};
  parts.push(`${sv.passing ?? 0} of ${sv.survivors ?? 0} survivors clear the same bar on their own copies, about ${sv.byChance == null ? '?' : sv.byChance.toFixed(1)} would by chance`);
  const sn = b.sanity || {};
  parts.push(sn.known ? `sanity, over the survivors' copies only: ${pct(sn.board.losing)} of the scrambled unread figures lose money, the threshold being ${sn.threshold}%, ${sn.ok ? 'PASS' : 'FAIL'}` : 'sanity: not known');
  const pass = !!(f.ok && h.pass && cp.pass && sn.ok);
  return { pass, sentence: `${pass ? 'PASS' : 'FAIL'}: ${parts.join('; ')}. What a pass buys: this window, and only the first look at it was unseen.` };
}
// input: { id, at, release, look, rules, gate, footing, window, read, copies, survivors, sanity, controls, fee, missing, failures }
function buildUnreadBlock(input) {
  const b = { ...input };
  b.verdict = unreadVerdict(b);
  return b;
}

// ---- the block, assembled -------------------------------------------------------------
// input: { id, at, release, look, rules, stageGate, footing, looks, heldBack,
//          copies, survivors, sanity, lineA, lineB, others, fee, windows, marks }
function buildBlock(input) {
  const b = { ...input };
  b.verdict = verdict(b);
  return b;
}

module.exports = {
  HELD, LIMITS, GATED, NOT_GATED, DEFAULT_SANITY_PCT,
  declareRules, ruleKeys, heldBackRead, copiesRead, perSurvivor, sanity, lineA, lineB, verdict, buildBlock,
  othersUnitRead, othersSummary, RIDE_FIELDS, rideOf,
  unreadVerdict, buildUnreadBlock,
  mean, median,
};
