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

// ONE BLOCK, TWO STRETCHES (3.147.0, VERIFY-DESIGN.md Part 9). The same
// judgement is read on the held-back window and on the reserve window, and the
// block it stamps has one shape on both: the stretch reading is `read`, the
// survivors' money is `money`, and what only a pricing produces (the window,
// the rows priced, the survivors not priced) is present when there was one.
// `stretch` on the block says which window it is about, and that is the only
// thing the sentence changes on.
const STRETCH_WORDS = { held: 'the held-back window', reserve: 'the reserve window' };

const HELD = 'avgHold';                          // the stretch's money on a row, in the held-back column's place
const LIMITS = ['maxDrawdown', 'avgTrades', 'testTrades'];      // the rebuilt-number limits step 6 can write; avgTrades is the held-back count older rules read, testTrades the test count (3.131.0)
const DEFAULT_SANITY_PCT = 50;
// ALL FOUR GATE (3.100.0, owner order 2026-09-09). Until then the two
// one-trade comparisons gated and the two every-period ones were printed as
// "the window's direction and never a gate". Neither pair is the harder bar in
// general: the one-trade pair carries almost no fee load, so it is harder over
// a trending window and easier over a chopping one, while the every-period pair
// pays a round trip on every period and is usually the easier bar in a trend
// (lib/bracket.js says so in as many words). Gating on whichever pair happens
// to be there means the difficulty of the bar moves with the market and nobody
// chose that. Gating on the BEST of the four does not: a rule with a fixed
// direction lean matches the window about half the time by luck, and beating
// the best of the four is beating that luck.
//
// EACH SURVIVOR AGAINST THE FOUR AT ITS OWN HOLD LENGTH (3.146.0, owner order
// 2026-09-15: "apples to apples instead of letting 'against nothing' rule
// actually be 'against something', namely an hindsight selection of the best
// of its set"; VERIFY-DESIGN.md Part 8). Until then the AVERAGE of every
// survivor was held to the best of the four read at the WORST hold length any
// survivor used. Being long every period grows with the hold length, because
// a decision every day with a 161-hour hold keeps nearly seven positions open
// at once, so on a rule whose plateau spans 41 to 161 hours a basket of
// mostly short holds was being measured against the one comparison priced at
// seven times their exposure: 98 of 98 survivors beat being long every period
// at their own hold length and the set read FAIL. Now each survivor is read
// against the four at its own hold length -- in the money, and ahead of every
// one of them by at least a cent -- and the set passes when the bar share of
// its survivors do, the same share the copies bar is declared at. The best of
// the four at the worst hold length is still printed, as the hindsight
// reading it is, and never gates.
const GATED = ['alwaysLong', 'alwaysShort', 'buyHold', 'shortHold'];
// which hold length a survivor was priced at, said the way the four are kept
// beside the set (lib/stages.js controlKeyOf): 24/7 or 24/5, and the hours
const ownKeyOf = (r) => `${r && r.weekdaysOnly ? 'wk' : 'all'}|${Number(r && r.tHours)}`;
// the name of each comparison's own "was it beaten" key, said once
const BEATS_KEY = { alwaysLong: 'beatsAlwaysLong', alwaysShort: 'beatsAlwaysShort', buyHold: 'beatsBuyHold', shortHold: 'beatsShortHold' };
// what each one is called ON THE SCREEN, so a sentence written here and a line
// drawn on Verify cannot drift apart. Read out of SCREEN-WORDS.md, 2026-09-09.
const COMPARISON_WORDS = {
  alwaysLong: 'being long every period',
  alwaysShort: 'being short every period',
  buyHold: 'buying the coin and going away',
  shortHold: 'shorting it and going away',
};

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
  // THE LOOSER CRITERIA (3.246.0, owner order 2026-09-24): how many of the four
  // comparisons each survivor has to beat -- 2, 3, or 4 as it always was --
  // with the survivors' average on the window required to be positive
  // whenever it is fewer than 4; and an automatic pass on a positive average
  // on the window, ticked or not. Anything but 2 or 3 is 4.
  const ofFour = [2, 3].includes(Math.floor(Number(asked.ofFour))) ? Math.floor(Number(asked.ofFour)) : 4;
  const autoPass = asked.autoPass === true || asked.autoPass === 'true';
  return {
    copies: K,
    barPct, ownBarPct: own, barChanged, bar, chance: K ? F.chanceOf(bar, K) : null,
    sanityPct,
    ofFour, needsPositive: ofFour < 4, autoPass,
    gated: GATED.slice(),
    limits: LIMITS.slice(),
    tags: {
      footing: 'DERIVED', comparisons: ofFour < 4 ? 'GUESSED' : 'DERIVED',
      bar: barChanged ? 'GUESSED' : 'DERIVED',
      sanity: 'GUESSED',
      autoPass: autoPass ? 'GUESSED' : null,
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
function heldBackRead(rows, controls, rules = null) {
  const held = (rows || []).map((r) => num(r[HELD]));
  const of = held.filter((v) => v != null).length;
  const real = mean(held);
  const c = controls || { known: false, why: 'no comparisons were handed in' };
  const comparisons = {
    known: !!c.known, why: c.known ? null : (c.why || null),
    keys: c.keys || null, of: c.of ?? null, missing: c.missing ?? null,
  };
  for (const k of GATED) comparisons[k] = c.known && c[k] ? { lo: c[k].lo, hi: c[k].hi } : null;
  for (const k of GATED) {
    comparisons[BEATS_KEY[k]] = c.known && real != null && comparisons[k] ? F.beats(real, comparisons[k].hi) : null;
  }
  // THE BEST OF THE FOUR, named so the screen does not have to work it out by
  // eye across four figures. Read at each comparison's own worst hold length
  // (`hi`), the same figure each of the four is beaten against on its own.
  const knownFour = GATED.filter((k) => comparisons[k] != null);
  comparisons.best = knownFour.length === GATED.length
    ? knownFour.map((k) => ({ key: k, hi: comparisons[k].hi })).reduce((a, b) => (b.hi > a.hi ? b : a))
    : null;
  // unknown never passes, and a missing one of the four is unknown: beating
  // three of four says nothing about the one nobody priced
  comparisons.beatsBest = comparisons.best != null && real != null ? F.beats(real, comparisons.best.hi) : null;
  const positive = real != null && real > 0;
  // EACH SURVIVOR AGAINST THE FOUR AT ITS OWN HOLD LENGTH (3.146.0): the four
  // are kept per hold length beside the set (controls.byKey); a survivor whose
  // hold length has no figure is counted and never passes. The bar is the same
  // share the copies bar was declared at, resolved on the survivor count.
  const barPct = rules && rules.barPct != null && Number.isFinite(Number(rules.barPct)) ? Number(rules.barPct) : F.barPctOf({});
  // how many of the four each survivor must beat (3.246.0); 4 when the rules say nothing looser
  const ofFour = rules && [2, 3].includes(Number(rules.ofFour)) ? Number(rules.ofFour) : 4;
  const byKey = c.known && c.byKey ? c.byKey : null;
  const ownRows = (rows || []).map((r) => {
    const held = num(r[HELD]);
    const key = ownKeyOf(r);
    const four = byKey ? byKey[key] || null : null;
    const beats = {};
    let known = !!four;
    for (const k of GATED) {
      const v = four ? num(four[k]) : null;
      if (v == null) { known = false; beats[k] = null; } else beats[k] = F.beats(held, v);
    }
    const inMoney = held != null && held > 0;
    const beaten = GATED.filter((k) => beats[k] === true).length;
    const clears = known && inMoney && beaten >= ofFour;
    return { si: r.si, label: r.label, key, held, positive: inMoney, four: four ? { ...four } : null, beats, beaten, known, clears };
  });
  const n = ownRows.length;
  const knownN = ownRows.filter((x) => x.known).length;
  const clearing = ownRows.filter((x) => x.clears).length;
  const ownBar = n ? Math.max(1, Math.min(n, Math.ceil((n * barPct) / 100))) : 0;
  const own = {
    survivors: n, known: knownN, unknown: n - knownN, clearing, bar: ownBar, barPct,
    holdLengths: [...new Set(ownRows.map((x) => x.key))].sort(),
    beatingEach: Object.fromEntries(GATED.map((k) => [k, ownRows.filter((x) => x.beats[k] === true).length])),
    positive: ownRows.filter((x) => x.positive).length,
    rows: ownRows,
    ofFour, needsPositive: ofFour < 4, positiveAverage: real != null && real > 0,
    // fewer than 4 of the four needs the survivors' average on the window positive too
    pass: comparisons.known && n > 0 && knownN === n && clearing >= ownBar && (ofFour >= 4 || (real != null && real > 0)),
    definition: ofFour >= 4
      ? 'each survivor against the four at its own hold length: in the money and ahead of every one of them by at least a cent; the set passes when the bar share of its survivors do'
      : `each survivor against the four at its own hold length: in the money and ahead of at least ${ofFour} of them by at least a cent; the set passes when the bar share of its survivors do and the survivors' average on the window is positive`,
  };
  return {
    real, of, missing: (rows || []).length - of,
    trades: mean((rows || []).map((r) => num(r.avgTrades))),
    vsLong: mean((rows || []).map((r) => num(r.avgVsLong))),
    positive,
    // the span across hold lengths and the best of the four at the worst of
    // them: printed, a hindsight reading, never a gate since 3.146.0
    comparisons,
    own,
    // unknown never passes: a gate on a number nobody has is not a gate
    pass: own.pass,
    incomplete: !comparisons.known || n === 0 || knownN < n,
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
      si: r.si, label: r.label, money: held, trades: num(r.avgTrades), vsLong: num(r.avgVsLong),
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
    positive: list.filter((x) => x.money != null && x.money > 0).length,
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
// `over` says what the board share was read over: the whole board's copies on
// a held read, or the survivors' own copies when only those were priced.
function sanity(boardRows, survivorRows, rules, over = 'board') {
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
    board, survivors, over,
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
function othersSummary(units, stretch = 'held') {
  const usable = (units || []).filter((u) => !u.keepsNothing);
  const of = usable.length;
  const positive = usable.filter((u) => u.positive).length;
  const clearBar = usable.filter((u) => u.clears).length;
  // a unit not yet priced on the reserve (3.148.0) is named and counted apart from one where the rule keeps nothing
  const notPriced = (units || []).filter((u) => u.notPriced).length;
  const keepsNothing = (units || []).length - of - notPriced;
  const mark = of > 0 && positive < of / 2 ? `fewer than half of the ${of} other units are positive on ${STRETCH_WORDS[stretch] || STRETCH_WORDS.held}` : null;
  return { positive, of, clearBar, keepsNothing, notPriced, mark };
}

// ---- V7: the ride, the stretch's half kept beside the test half ----------------------
// `perSetting` is what the rebuild hands back (label -> { units: [{ trade, ctx1,
// ctx2, geometry, pnl, trades, holdout, rich: { test, hold } }] }); `keyOf`
// names a unit the way the board does, and only the set's own unit is kept.
// The half priced in the held-back column's place is `read`: the held-back
// window on a held ride, the reserve window on a reserve one (3.147.0).
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
      read: half(u.rich && u.rich.hold, (u.holdout || {}).pnl, (u.holdout || {}).trades),
      test: half(u.rich && u.rich.test, u.pnl, u.trades),
    });
  }
  return { rows, missing };
}

// ---- V8: what the settings the rule did NOT keep did on the same window (3.100.0) ----
//
// A count of survivors that cleared a bar is unreadable without the same count
// for what did not survive. If nearly every setting on the board was positive
// on the held-back window, then "all of the survivors positive" says the window
// rose. It says nothing whatever about the picking, and the survivors are the
// top of a pile that was all doing well rather than a selection.
//
// EACH SIDE IS READ AGAINST THE FOUR AT ITS OWN HOLD LENGTHS, never the other
// side's. A setting the rule dropped may hold for a length no survivor uses,
// and beating a bar priced for somebody else's hold length is not beating
// anything. The caller builds one set of comparisons per side for that reason.
//
// INFORMATION ONLY. This never gates a set. It is a reading about the choosing,
// not about the rule, and Part 5 of VERIFY-DESIGN.md is where gating on it
// would be argued.
function sideRead(rows, controls) {
  const list = rows || [];
  const held = list.map((r) => num(r[HELD]));
  const priced = held.filter((v) => v != null);
  const c = controls || { known: false };
  let best = null;
  if (c.known) {
    const four = GATED.map((k) => (c[k] ? { key: k, hi: c[k].hi } : null));
    best = four.every(Boolean) ? four.reduce((a, b) => (b.hi > a.hi ? b : a)) : null;
  }
  return {
    of: list.length,
    priced: priced.length,
    noFigure: list.length - priced.length,
    positive: priced.filter((v) => v > 0).length,
    mean: mean(held),
    median: median(held),
    best,
    beatingBest: best ? priced.filter((v) => F.beats(v, best.hi)).length : null,
    why: c.known ? null : (c.why || 'the four comparisons are not known for these settings'),
  };
}
const shareOf = (side) => (side && side.priced ? side.positive / side.priced : null);
const bestShareOf = (side) => (side && side.priced && side.beatingBest != null ? side.beatingBest / side.priced : null);
function keptVsDropped(kept, dropped, keptControls, droppedControls, sample = null) {
  const a = sideRead(kept, keptControls);
  const b = sideRead(dropped, droppedControls);
  const gap = (x, y) => (x != null && y != null ? x - y : null);
  const out = {
    kept: a, dropped: b, sample,
    keptShare: shareOf(a), droppedShare: shareOf(b),
    keptBestShare: bestShareOf(a), droppedBestShare: bestShareOf(b),
    gapPositive: gap(shareOf(a), shareOf(b)),
    gapBest: gap(bestShareOf(a), bestShareOf(b)),
  };
  out.sentence = keptVsDroppedSentence(out);
  return out;
}
const asPct = (v) => (v == null ? '?' : `${Math.round(100 * v)}%`);
function keptVsDroppedSentence(o) {
  const a = o.kept;
  const b = o.dropped;
  if (!b.of) return 'the rule kept every setting on this board, so there is nothing it dropped to read against';
  const parts = [];
  parts.push(`the rule kept ${a.of} settings and dropped ${b.of}`
    + (o.sample && o.sample.read < b.of ? `, of which ${o.sample.read} were read` : ''));
  parts.push(`positive on the held-back window: ${asPct(o.keptShare)} of the kept, ${asPct(o.droppedShare)} of the dropped`);
  if (o.keptBestShare != null && o.droppedBestShare != null) {
    parts.push(`beating the best of the four at their own hold lengths: ${asPct(o.keptBestShare)} of the kept, ${asPct(o.droppedBestShare)} of the dropped`);
  } else {
    parts.push(`the four comparisons are not known for one side or the other (${a.why || b.why || 'unstated'}), so only the positive counts can be read`);
  }
  // the reading itself, said plainly, and it is never a gate
  const g = o.gapPositive;
  if (g == null) parts.push('nothing can be said about the picking from this');
  else if (g <= 0) parts.push('THE DROPPED DID AS WELL OR BETTER: on this window the picking added nothing, and the kept settings are the top of a pile that was all doing the same');
  else if (g < 0.1) parts.push('the kept are barely ahead of the dropped, so most of what the survivors show is the window rather than the picking');
  else parts.push('the kept are clearly ahead of the dropped, which is the first sign that the picking is doing something');
  return `${parts.join('; ')}. Information only, never a gate.`;
}

// ---- the verdict sentence, from stored numbers only ---------------------------------
// the way the page prints money: the sign before the dollar sign
const money = (v) => (v == null ? 'no figure' : `${Number(v) < 0 ? '-' : ''}$${Math.abs(Number(v)).toFixed(2)}`);
const pct = (v) => (v == null ? '?' : `${Math.round(100 * v)}%`);
// ALL FOUR GATE, so the sentence says which of them was the one to beat and
// whether it was beaten -- not four clauses the reader has to compare by eye.
// A missing one of the four means the best is unknown, and unknown never passes.
function bestPhrase(c) {
  if (!c || !c.best) return 'and one of the four comparisons has no figure, so the best of them is unknown and nothing here passes';
  const word = COMPARISON_WORDS[c.best.key] || c.best.key;
  return `${c.beatsBest ? 'beating' : 'not beating'} the best of the four, which was ${word} at ${money(c.best.hi)}`;
}
// THE HELD-BACK CLAUSE: each survivor at its own hold length is the gate
// (3.146.0); the average and the hindsight best of the four are printed after
// it. A block stamped before the own-hold reading existed carries no `own`
// and reads as it was written.
function ownPhrase(where, h, c) {
  const o = h.own || null;
  const avg = `the ${h.of ?? 0} survivors made ${money(h.real)} a setting`
    + (c.known ? `, ${bestPhrase(c)} at the worst hold length in use` : `, and the four comparisons are not known (${c.why || 'unstated'})`);
  if (!o) return `on ${where} ${avg}`;
  const loose = o.ofFour != null && o.ofFour < 4;
  return `on ${where} ${o.clearing} of ${o.survivors} survivors made money and beat ${loose ? `at least ${o.ofFour} of the four comparisons` : 'each of the four comparisons'} at their own hold length, the bar being ${o.bar} (${o.barPct}%)`
    + (o.unknown ? `, ${o.unknown} with no figure at their hold length, which never passes` : '')
    + (loose ? `; ${o.ofFour} of 4 requires the survivors' average on ${where} to be positive, and it ${o.positiveAverage ? 'was' : 'was not'}` : '')
    + `; averaged, ${avg}${c.known ? ', a hindsight reading and never a gate' : ''}`;
}
function verdict(block) {
  const b = block;
  const stretch = b.stretch === 'reserve' ? 'reserve' : 'held';
  const where = STRETCH_WORDS[stretch];
  const parts = [];
  // the instrument first: the stage-engine check, the release's one check (the
  // planted check that opened this sentence went with the older engine, 3.97.0)
  const sg = b.stageGate || null;
  if (sg) parts.push(sg.state === 'PASS' ? `the stage-engine check stood (release ${sg.release || 'unrecorded'})` : `no stage-engine check stood (${sg.state || 'NOT CHECKED'})`);
  // A RESERVE SET STANDS ON A HELD SET THAT PASSED, and says which
  if (stretch === 'reserve') {
    const so = b.standsOn || null;
    parts.push(so ? `it stands on ${so.name || so.id}, which passed on the held-back window under release ${so.release || '?'}` : 'it stands on no held set that passed');
  }
  // a pricing says what it priced: the window, and which forecasts
  const w = b.window || null;
  if (w) parts.push(`${where} from ${day(w.fromTs)} holds ${w.chunks ?? 0} whole chunks, the box's data reaching ${day(w.seenToTs)}`);
  if (b.forecasts) parts.push(`priced with ${b.forecasts}`);
  const look = Number(b.look) || 1;
  if (stretch === 'reserve') {
    // A SET READ OFF THE UNIT'S RESERVE BOARD (3.148.0): the board's first
    // pricing was the one look at data nothing had seen, and this set says
    // which pricing it read; a set that priced its own survivors counts its
    // own looks, as before
    const bd = b.board || null;
    if (bd) {
      parts.push(`read off the reserve board of this unit, priced ${day(Date.parse(bd.at))} (pricing ${bd.pricing}, ${bd.pricedRows} of ${bd.settings} settings); that board's first pricing on ${day(Date.parse(bd.firstAt))} was the one look at data nothing in the system had seen, and this is reserve set ${look} of the rule`);
    } else {
      parts.push(look > 1
        ? `look ${look}: this window had been read ${look - 1} time(s) before, so it is no longer data nothing has seen and the floor below is the best case, not the strength`
        : 'look 1: the first look at data nothing in the system has seen');
    }
  }
  const f = b.footing || {};
  parts.push(f.ok ? `the rule gives back its own ${f.had} survivors today` : `the footing did not stand (${f.why || 'unstated'})`);
  const h = b.read || {};
  const c = h.comparisons || {};
  parts.push(ownPhrase(where, h, c) + (stretch === 'held' ? `, after at least ${(b.looks || {}).unstamped ?? 0} unstamped looks` : ''));
  const cp = b.copies || {};
  if (cp.incomplete) parts.push(`no scrambled copies of ${where} were kept, so nothing was read against nothing`);
  else parts.push(`against ${cp.copies} scrambled copies of ${where} it beats ${cp.beats}, the bar being ${cp.bar} (${cp.barPct}%); a forecast-free rule clears that about ${pct(cp.chance)} of the time, and the finest claim ${cp.copies} copies allow is 1 in ${cp.copies + 1}, a floor, never a measure of strength`);
  const s = b.survivors || {};
  parts.push(`${s.passing ?? 0} of ${s.survivors ?? 0} survivors clear the same bar on their own copies, about ${s.byChance == null ? '?' : s.byChance.toFixed(1)} would by chance`);
  const sn = b.sanity || {};
  parts.push(sn.known
    ? `sanity${sn.over === 'survivors' ? ", over the survivors' copies only" : ''}: ${pct(sn.board.losing)} of the scrambled figures on ${where} lose money, the threshold being ${sn.threshold}%, ${sn.ok ? 'PASS' : 'FAIL'}`
    : 'sanity: not known');
  // the other units (V6), when read: two counts, information, never a gate
  const o = b.others || null;
  parts.push(o
    ? `on the other units, read ${String(o.at || '').slice(0, 16)}: ${o.positive} of ${o.of} other units positive on ${where}, ${o.clearBar} clear the bar${o.keepsNothing ? `, ${o.keepsNothing} keep nothing` : ''}${o.notPriced ? `, ${o.notPriced} not priced on the reserve yet` : ''}${o.mark ? ` (${o.mark})` : ''}, information only`
    : 'the other units not read when this was stamped');
  // THE AUTOMATIC PASS (3.246.0, owner order 2026-09-24): ticked, a positive
  // average on the window passes the set on its own, with the footing standing;
  // everything above is still read and printed, and none of it can stop it
  const auto = !!(b.rules || {}).autoPass;
  const positiveAverage = h.real != null && h.real > 0;
  if (auto) parts.push(`automatic pass on a positive average on ${where} was ticked, and the survivors' average there ${positiveAverage ? `was ${money(h.real)}, positive, so the set passes on that alone` : `was ${money(h.real)}, not positive, so it does not pass on that`}${f.ok ? '' : ' — but the footing did not stand, and nothing passes without it'}`);
  const pass = auto ? !!(f.ok && positiveAverage) : !!(f.ok && h.pass && cp.pass && sn.ok);
  const buys = stretch === 'held' ? 'this window only' : 'this window, and only the first look at it was unseen';
  return { pass, sentence: `${pass ? 'PASS' : 'FAIL'}: ${parts.join('; ')}. What a pass buys: ${buys}.` };
}
const day = (ts) => (ts == null ? '?' : new Date(Number(ts)).toISOString().slice(0, 10));

// ---- the block, assembled -------------------------------------------------------------
// input: { id, at, release, look, stretch, rules, stageGate, footing, looks, read,
//          copies, survivors, sanity, lineA, lineB, others, fee, windows, marks,
//          standsOn, window, priced, missing, forecasts }
function buildBlock(input) {
  const b = { ...input };
  b.stretch = b.stretch === 'reserve' ? 'reserve' : 'held';
  b.verdict = verdict(b);
  return b;
}

module.exports = {
  HELD, LIMITS, GATED, BEATS_KEY, DEFAULT_SANITY_PCT, ownKeyOf,
  declareRules, ruleKeys, heldBackRead, copiesRead, perSurvivor, sanity, lineA, lineB, verdict, buildBlock,
  othersUnitRead, othersSummary, RIDE_FIELDS, rideOf,
  sideRead, keptVsDropped, keptVsDroppedSentence,
  STRETCH_WORDS,
  mean, median,
};
