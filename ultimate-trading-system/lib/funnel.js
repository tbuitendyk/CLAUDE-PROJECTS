// funnel.js -- the readings the Funnel tab walks, as pure functions over rows.
//
// WHY THIS EXISTS. Stage 3 prices a fully enumerated grid -- the owner's last
// set was 524,832 settings -- and nothing carries out of it. The only route from
// that grid to a candidate was a person sorting a table and picking a row, which
// is the fluke-finding machine: the best of half a million tries looks good even
// when nothing is there. See FUNNEL-DESIGN.md.
//
// WHAT MAKES THESE READINGS HONEST, and impossible on the old board: the grid is
// FULL FACTORIAL. Every setting was priced, not just a search winner, so
// grouping the rows by any one dial averages evenly over all the others. A
// search-based board cannot do any of this, because its rows are a biased
// sample of its own menu.
//
// EVERY FUNCTION HERE READS TEST MONEY. The held-back window is opened once, at
// the end, on what survives -- lib/bracketwork.js: "Select on search, judge on
// holdout, and never let money pick the rung you then evaluate as a predictor."
// Today the eyeball selection happens on held-back numbers, which spends them.
//
// EVERY READING COMES WITH A SPLIT-HALF. It answers "would the other half of my
// data have told me this?", needs no null set and no extra capture, and is the
// only comparison available on any set written so far -- no stage 3 set stores
// the per-deal money a noise board would need. It tests whether a reading is
// STABLE, never whether the effect is real, and the tab must say so.

// WHICH DIALS HAVE AN ORDER. Not a curation of what the owner may look at --
// every dial on the record is here -- but a statement of which ones have a
// "next value along" and can therefore have a SHAPE. Reading a hill off entry
// or gate would be meaningless: 'market' is not next to 'breakout'.
const ORDERED_DIALS = ['dMult', 'tHours', 'trailMult', 'armMult', 'bandMode', 'agreePct', 'agreeCopy', 'agreePersist'];
const CATEGORICAL_DIALS = ['decision', 'weekdaysOnly', 'entry', 'gate', 'agreeRule', 'agreeBar', 'agreeBoth'];
const ALL_DIALS = [...ORDERED_DIALS, ...CATEGORICAL_DIALS];

// The money every step reads. Named once so there is exactly one place that
// decides the funnel is looking at the test window.
const TEST_MONEY = 'avgTest';
const money = (r) => {
  const v = r == null ? null : r[TEST_MONEY];
  return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
};
// A SCRAMBLED COPY IS READ, NEVER BUILT (2026-09-02, the service died twice
// out of memory the first time the Funnel was opened on the filled set: ten
// copies of 524,832 rows at once). The money a row made on kept scramble d is
// already on the row; this hands back a reader for it, and every reading
// below takes an optional reader in place of the real money. No row is ever
// copied to read the check.
const moneyAt = (d) => {
  const i = Math.max(0, Math.floor(Number(d) || 0));
  return (r) => {
    const v = r && Array.isArray(r.noiseTest) ? r.noiseTest[i] : null;
    return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
  };
};

// A value as a grouping key. null is its OWN group -- "this dial does not apply
// to this setting" is a fact about the setting, not a missing number, and
// folding it in with the others would hide it.
const keyOf = (v) => (v == null ? 'none' : String(v));

// Ordered dials sort numerically. bandMode is 'auto' or a percentage, and auto
// sits last whichever way the axis points -- the same rule the saved sort uses.
function sortedValues(dial, keys) {
  if (!ORDERED_DIALS.includes(dial)) return keys.slice().sort();
  return keys.slice().sort((a, b) => {
    const na = a === 'auto' || a === 'none' ? Infinity : Number(a);
    const nb = b === 'auto' || b === 'none' ? Infinity : Number(b);
    if (Number.isNaN(na) || Number.isNaN(nb)) return String(a).localeCompare(String(b));
    if (na === nb) return String(a).localeCompare(String(b));
    return na - nb;
  });
}

// ---- the halves -------------------------------------------------------------
//
// SEEDED AND ORDER-INDEPENDENT. A shuffle would split the same set differently
// depending on the order the rows were read in, so two reads of one set could
// disagree about whether a dial was stable. The half a setting lands in is a
// pure function of its own name and the seed, so it cannot move.
function hash32(s) {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function splitHalf(rows, seed) {
  const a = [];
  const b = [];
  for (const r of rows) (hash32(`${seed}|${r.label}`) % 2 === 0 ? a : b).push(r);
  return [a, b];
}

// ---- step 1: which dials move the result at all ------------------------------

// The groups a dial cuts the rows into, with each group's money.
function groupsFor(rows, dial, moneyOf = money) {
  const by = new Map();
  for (const r of rows) {
    const v = moneyOf(r);
    if (v == null) continue;
    const k = keyOf(r[dial]);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(v);
  }
  return by;
}

// MOVEMENT: how far apart this dial's values sit, against how much the result
// varies anyway. A ratio with no magnitude beside it is unreadable, so the
// dollar range travels with it.
//
// A dial the run swept only ONE value of has no movement to measure, and is
// reported as unmeasurable rather than as flat -- flat is a finding, "there was
// nothing to compare" is not, and the two must never print the same.
function movement(rows, dial, moneyOf = money) {
  const by = groupsFor(rows, dial, moneyOf);
  const keys = sortedValues(dial, [...by.keys()]);
  const n = [...by.values()].reduce((a, g) => a + g.length, 0);
  const base = {
    dial, ordered: ORDERED_DIALS.includes(dial), values: keys, n,
    groups: [], m: null, range: null, within: null, between: null, why: null,
  };
  if (keys.length < 2) {
    // one value LEFT: swept at one value, or fixed by the rule already -- either
    // way there is no shape to read here, and the next move is another dial
    return { ...base, why: keys.length ? 'only one value of this dial is left on this board, so there is no shape to read - pick another dial' : 'no priced settings' };
  }
  const groups = keys.map((k) => {
    const g = by.get(k);
    return { value: k, n: g.length, mean: g.reduce((a, c) => a + c, 0) / g.length };
  });
  const grand = groups.reduce((a, g) => a + g.mean * g.n, 0) / n;
  const between = Math.sqrt(groups.reduce((a, g) => a + g.n * ((g.mean - grand) ** 2), 0) / n);
  let ss = 0;
  for (const g of groups) for (const v of by.get(g.value)) ss += (v - g.mean) ** 2;
  const within = Math.sqrt(ss / n);
  const means = groups.map((g) => g.mean);
  return {
    ...base,
    groups,
    grand,
    between,
    within,
    // A dial that separates the money with nothing left scattered inside its
    // groups would divide by zero. That is a perfect separation, not an error,
    // and it reads as the largest movement there is.
    m: within > 0 ? between / within : (between > 0 ? Infinity : 0),
    range: Math.max(...means) - Math.min(...means),
    // IS THIS MARGINAL EVEN HONEST? Everything above rests on the grid being
    // full factorial: group by one dial and the others average out evenly. They
    // only average out evenly if each value of this dial was swept against the
    // SAME spread of everything else. When a run did not permute a dial across
    // the whole board -- a carry cut, a fold, a unit that failed -- the groups
    // come back different sizes, and then this dial's movement is partly some
    // other dial's movement wearing its name.
    //
    // Found by attacking the reading rather than by it going wrong: nothing on
    // screen would have shown it, because a confounded marginal looks exactly
    // like a real one.
    balance: balanceOf(groups),
  };
}

// 1 when every value of the dial was swept the same number of times, falling
// towards 0 as they diverge. A reading below the bar is not refused -- it is
// still the best available -- but it must be SAID, because the whole claim of
// step 1 is that the other dials averaged out.
function balanceOf(groups) {
  const ns = groups.map((g) => g.n);
  const lo = Math.min(...ns);
  const hi = Math.max(...ns);
  return {
    even: hi > 0 ? lo / hi : 0,
    smallest: lo,
    largest: hi,
    // two thirds is the bar and it is GUESSED, not derived: it is the point at
    // which the smallest group is thin enough that its mean carries visibly
    // more scatter than the largest one's.
    balanced: hi > 0 && lo / hi >= 2 / 3,
  };
}

// Every dial, ordered by movement, with the same reading on each half.
//
// AGREEMENT AT THE TOP IS THE GATE. If the two halves do not pick the same
// leading dials, nothing below step 1 means anything, and the tab must say so
// rather than letting the walk carry on looking productive.
function step1(rows, opts = {}) {
  const seed = opts.seed || 'funnel';
  const top = opts.top == null ? 3 : Math.max(1, Math.floor(opts.top));
  const rank = (rs) => ALL_DIALS
    .map((d) => movement(rs, d))
    .filter((x) => x.m != null)
    .sort((a, b) => (b.m - a.m) || a.dial.localeCompare(b.dial));
  // one pass over the dials, kept: the unmeasurable ones and the measured ones
  // come out of the same read rather than the board being walked twice
  const measured = ALL_DIALS.map((d) => movement(rows, d));
  const all = measured.filter((x) => x.m != null).sort((a, b) => (b.m - a.m) || a.dial.localeCompare(b.dial));
  const [ha, hb] = splitHalf(rows, seed);
  const ra = rank(ha).slice(0, top).map((x) => x.dial);
  const rb = rank(hb).slice(0, top).map((x) => x.dial);
  const shared = ra.filter((d) => rb.includes(d));
  const comparable = ra.length > 0 && rb.length > 0;
  const skipped = measured.filter((x) => x.m == null).map((x) => ({ dial: x.dial, why: x.why }));
  const lopsided = all.filter((x) => x.balance && !x.balance.balanced).map((x) => x.dial);
  return {
    dials: all,
    skipped,
    // dials whose values were not swept evenly, so their marginal is partly
    // another dial's -- named, never dropped
    lopsided,
    splitHalf: {
      a: ra,
      b: rb,
      shared,
      // Half of the leaders in common is the bar. Below it the two halves are
      // pointing at different dials, which is what noise looks like.
      agrees: comparable && shared.length >= Math.ceil(Math.min(ra.length, rb.length) / 2),
      sizes: [ha.length, hb.length],
      why: comparable ? null : 'a half held no priced settings, so the halves cannot be compared',
    },
    // Filled in only when the parent set carries a board-wide noise reading.
    // Left null and NAMED as absent by the tab -- a blank column reads as
    // "nothing to report", which is the opposite of the truth.
    noiseTwin: null,
  };
}

// ---- step 2: the shape of a dial ---------------------------------------------

// Mechanical, so two people reading the same curve call it the same thing.
// A SPIKE is the shape luck makes: one value far clear of its neighbours with
// everything else flat. A hill or a ramp is a relationship.
function shapeClass(groups, within) {
  if (!groups || groups.length < 2) return 'single';
  const means = groups.map((g) => g.mean);
  const spread = Math.max(...means) - Math.min(...means);
  if (!(within > 0)) return spread > 0 ? 'monotone' : 'flat';
  if (spread < within) return 'flat';
  const best = means.indexOf(Math.max(...means));
  const rest = means.filter((_, i) => i !== best);
  const restSpread = rest.length ? Math.max(...rest) - Math.min(...rest) : 0;
  const neighbours = [means[best - 1], means[best + 1]].filter((v) => v != null);
  // A lone value far clear of a flat rest is a spike wherever it sits. Luck
  // does not care whether the value it landed on is at the edge of the menu.
  if (neighbours.length && means[best] - Math.max(...neighbours) > 2 * within && restSpread < within) return 'spike';
  let up = 0;
  let down = 0;
  for (let i = 1; i < means.length; i++) {
    const d = means[i] - means[i - 1];
    if (d > within / 2) up++;
    else if (d < -within / 2) down++;
  }
  if ((up && !down) || (down && !up)) return 'monotone';
  const worst = means.indexOf(Math.min(...means));
  const interior = (i) => i > 0 && i < means.length - 1;
  if (interior(best) && means[best] > means[best - 1] && means[best] > means[best + 1]) return 'hill';
  if (interior(worst) && means[worst] < means[worst - 1] && means[worst] < means[worst + 1]) return 'valley';
  return 'ragged';
}

function step2(rows, dial, opts = {}) {
  const seed = opts.seed || 'funnel';
  const whole = movement(rows, dial);
  if (whole.m == null) {
    return { dial, ordered: whole.ordered, groups: [], shape: null, splitHalf: null, noiseTwin: null, why: whole.why };
  }
  const [ha, hb] = splitHalf(rows, seed);
  const a = movement(ha, dial);
  const b = movement(hb, dial);
  const sa = a.m == null ? null : shapeClass(a.groups, a.within);
  const sb = b.m == null ? null : shapeClass(b.groups, b.within);
  return {
    dial,
    ordered: whole.ordered,
    groups: whole.groups,
    within: whole.within,
    range: whole.range,
    shape: shapeClass(whole.groups, whole.within),
    splitHalf: { a: sa, b: sb, agrees: sa != null && sa === sb },
    noiseTwin: null,
    why: null,
  };
}

// ---- step 3: do two dials interact -------------------------------------------
//
// THE THIN-SQUARE FLOOR. Some squares hold thousands of settings and some hold
// two. A square built from two tells you nothing, but it looks exactly like the
// others -- and it will often be the best-looking square on the grid, because
// small groups swing further. Below the floor a square is MARKED thin and keeps
// its count; it is never silently dropped, because a hole in a grid reads as
// "nothing here" rather than "not enough to say".
function step3(rows, dialA, dialB, opts = {}) {
  const floor = opts.floor == null ? 0 : Math.max(0, Math.floor(opts.floor));
  const moneyOf = typeof opts.moneyOf === 'function' ? opts.moneyOf : money;
  const cells = new Map();
  for (const r of rows) {
    const v = moneyOf(r);
    if (v == null) continue;
    const k = `${keyOf(r[dialA])}|${keyOf(r[dialB])}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(v);
  }
  const aVals = sortedValues(dialA, [...new Set(rows.map((r) => keyOf(r[dialA])))]);
  const bVals = sortedValues(dialB, [...new Set(rows.map((r) => keyOf(r[dialB])))]);
  const grid = [];
  for (const a of aVals) {
    for (const b of bVals) {
      const g = cells.get(`${a}|${b}`) || [];
      grid.push({
        a,
        b,
        n: g.length,
        mean: g.length ? g.reduce((x, c) => x + c, 0) / g.length : null,
        thin: g.length < floor,
      });
    }
  }
  return {
    dialA, dialB, aVals, bVals, grid, floor,
    squares: grid.length,
    thin: grid.filter((c) => c.thin).length,
  };
}

// WHAT EACH FLOOR WOULD COST, so the owner picks knowing rather than blind.
// Choosing a threshold with no idea what it throws away is what the whole tab
// exists to end, and that applies to the tab's own thresholds first.
function floorCost(out, choices) {
  const list = Array.isArray(choices) && choices.length ? choices : [1, 5, 10, 20, 50, 100];
  return list.map((f) => ({
    floor: f,
    keeps: out.grid.filter((c) => c.n >= f).length,
    of: out.grid.length,
  }));
}

// ---- step 4: does it hold when what you did NOT choose changes ----------------
//
// THE AXIS IS CHOSEN FROM WHAT THE SET ACTUALLY HOLDS, in this priority order,
// and the reading always NAMES which one it used. On a single-coin probe there
// are no coins to compare across, so it falls through -- and saying which
// weaker check it made is the whole point of falling through rather than
// skipping. It never prints "1 of 1 positive".
const HOLDS_AXES = ['coins', 'shapes', 'thirds', 'dials'];

// slices: [{ key, n, mean }]
function holdsAcross(slices, axis, opts = {}) {
  const floor = opts.floor == null ? 0 : Math.max(0, Math.floor(opts.floor));
  const all = Array.isArray(slices) ? slices : [];
  const usable = all.filter((s) => s && s.mean != null && s.n >= floor);
  const thin = all.filter((s) => s && s.n < floor);
  const base = { axis, slices: all, usable: usable.length, thin: thin.length, of: usable.length };
  if (usable.length < 2) {
    return {
      ...base,
      positive: null,
      worst: null,
      // ONE SLICE IS NOT A COMPARISON. Reporting "1 of 1 positive" would read
      // as a pass, and it is not a reading at all.
      why: usable.length === 1
        ? 'one slice is not a comparison -- this axis cannot say whether the region holds anywhere else'
        : 'no slice has enough settings behind it to read',
    };
  }
  return {
    ...base,
    positive: usable.filter((s) => s.mean > 0).length,
    worst: usable.reduce((w, s) => (w == null || s.mean < w.mean ? s : w), null),
    why: null,
  };
}

// Which axis this set can actually be read across, and why not the ones above
// it. `have` states what the set holds: { coins, shapes, thirds, freeDials }.
function holdsAxisFor(have) {
  const h = have || {};
  const reasons = [];
  if ((h.coins || 0) > 1) return { axis: 'coins', weaker: false, passedOver: reasons };
  reasons.push({ axis: 'coins', why: `this set holds ${h.coins || 0} coin(s) -- there is nothing to compare across` });
  if ((h.shapes || 0) > 1) return { axis: 'shapes', weaker: true, passedOver: reasons };
  reasons.push({ axis: 'shapes', why: `this set holds ${h.shapes || 0} chunk shape(s)` });
  if (h.thirds) return { axis: 'thirds', weaker: true, passedOver: reasons };
  reasons.push({ axis: 'thirds', why: 'the money in each third of the window has not been rebuilt for these settings yet' });
  if ((h.freeDials || 0) > 0) return { axis: 'dials', weaker: true, passedOver: reasons };
  reasons.push({ axis: 'dials', why: 'the rule has fixed every dial, so nothing is left to vary' });
  return { axis: null, weaker: true, passedOver: reasons };
}

// ---- the check, and what it recommends (Funnel design §16.2) -------------------
//
// ONE MECHANISM FOR THE CHECK AND THE RECOMMENDATION, and it is the one §3
// already names: scrambled copies of the table when the set kept them, the two
// halves of the settings when it did not. Nothing here adds a third. A value,
// a square or a slice COUNTS when the real reading beats the check's reading in
// SIGN -- above the scrambled copy on every kept copy, or above the half's own
// average on both halves -- and the recommendation is the widest run of
// neighbouring things that count. No margin, no multiple, no threshold: the
// only figure on the screen is how many copies there were.
//
// `check` is { k } -- k kept scrambles, each read off the rows by position
// with moneyAt(d) -- or { seed } when there are none. Nothing is copied.

const checkKindOf = (check) => (check && Number(check.k) > 0 ? 'scrambles' : 'halves');

// BEATS MEANS BEATS BY AT LEAST A CENT (2026-09-02). The kept figures are
// stored in cents and the real money is not, so an `always` setting -- whose
// scrambled copies are its own money to the cent -- read as beating all ten
// or none of them on a difference of a hundred-trillionth. Equal is not a
// win. Every comparison against the check goes through this.
const cents = (v) => Math.round(Number(v) * 100);
const beats = (real, other) => real != null && other != null && cents(real) > cents(other);

// THE BAR (owner order, 2026-09-02; A SHARE, owner order 2026-09-04: "make the
// box a percentage of the null tables beat"): a value counts when it beats AT
// LEAST the bar's worth of the K scrambled copies, not every one of them. The
// owner's point: the money comes from the combination of settings, and a
// single value's average is diluted by every combination of the other dials,
// so "all K" on one value asks too much of a diluted number. The bar is set
// on the screen AS A SHARE OF THE COPIES, because a count written when sets
// kept ten copies (eight of ten) silently became eight of twenty on a set
// that kept twenty -- a weaker bar than anyone chose. The share is resolved to
// a count per set, ROUNDED UP: at least 80% of 20 copies is 16, of 10 is 8, of
// 19 is 16, because "at least this share" is the smallest count not below it;
// never below 1 and never above K. A count handed in under the old name is
// ignored, never read as a share. What a bar buys is printed beside it: with
// no forecast at all the real figure is one more draw among K + 1, so it
// clears a bar of `bar` about (K + 1 - bar) / (K + 1) of the time -- 9% at
// all ten, 27% at eight of ten, 24% at sixteen of twenty, 55% at five of ten.
const DEFAULT_BAR_PCT = 80;
const barPctOf = (check) => {
  const asked = (check || {}).barPct;
  const want = asked == null || asked === '' ? DEFAULT_BAR_PCT : Math.floor(Number(asked));
  return Math.max(1, Math.min(100, Number.isFinite(want) ? want : DEFAULT_BAR_PCT));
};
const barOf = (check) => {
  const K = Math.max(0, Math.floor(Number((check || {}).k) || 0));
  if (!K) return 0;
  // K * pct is a whole number, so the quotient is exact whenever it is whole
  // and the ceiling is the true one
  const want = Math.ceil((K * barPctOf(check)) / 100);
  return Math.max(1, Math.min(K, want));
};
const chanceOf = (bar, K) => (K > 0 && bar >= 1 && bar <= K ? (K + 1 - bar) / (K + 1) : null);
// HOW FAR AHEAD, not only how often: the real figure against the copies'
// average, in units of the copies' own spread. Seven wins by a mile and seven
// wins by a cent should not read the same. Null with fewer than two copies or
// no spread at all (copies equal to the cent, as a forecast-free setting's are).
const leadOf = (real, copies) => {
  const c = (copies || []).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  if (real == null || c.length < 2) return null;
  const mean = c.reduce((a, v) => a + v, 0) / c.length;
  const sd = Math.sqrt(c.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (c.length - 1));
  return sd > 0 ? (Number(real) - mean) / sd : null;
};

// mean money per value of a dial, keyed by value
function meansBy(rows, dial, moneyOf = money) {
  const by = groupsFor(rows, dial, moneyOf);
  const out = new Map();
  for (const [k, vals] of by) out.set(k, { n: vals.length, mean: vals.reduce((a, c) => a + c, 0) / vals.length });
  return out;
}
const grandOf = (rows, moneyOf = money) => {
  let s = 0; let n = 0;
  for (const r of rows) { const v = moneyOf(r); if (v != null) { s += v; n++; } }
  return n ? s / n : null;
};

// Every value of a dial with its real reading, the check's reading, and whether
// it counts. Ordered dials come back in axis order.
function countsFor(rows, dial, check, opts = {}) {
  const kind = checkKindOf(check);
  const real = meansBy(rows, dial);
  const keys = sortedValues(dial, [...real.keys()]);
  const out = [];
  if (kind === 'scrambles') {
    const K = Math.floor(Number(check.k));
    const bar = barOf(check);
    const copies = Array.from({ length: K }, (_, d) => meansBy(rows, dial, moneyAt(d)));
    for (const k of keys) {
      const r = real.get(k);
      const cm = copies.map((m) => (m.get(k) ? m.get(k).mean : null));
      const beaten = cm.filter((v) => beats(r.mean, v)).length;
      const counts = cm.length > 0 && beaten >= bar;
      out.push({ value: k, n: r.n, mean: r.mean, check: cm, beaten, lead: leadOf(r.mean, cm), counts });
    }
    return { dial, kind, k: K, bar, values: out };
  }
  const seed = (check && check.seed) || opts.seed || 'funnel';
  const [ha, hb] = splitHalf(rows, seed);
  const ma = meansBy(ha, dial); const mb = meansBy(hb, dial);
  const ga = grandOf(ha); const gb = grandOf(hb);
  for (const k of keys) {
    const r = real.get(k);
    const a = ma.get(k) ? ma.get(k).mean : null;
    const b = mb.get(k) ? mb.get(k).mean : null;
    const beaten = (beats(a, ga) ? 1 : 0) + (beats(b, gb) ? 1 : 0);
    const counts = beaten === 2;                 // both halves, always: two is the whole check
    out.push({ value: k, n: r.n, mean: r.mean, check: [a, b], beaten, lead: null, counts });
  }
  return { dial, kind, k: 0, bar: 2, values: out };
}

// The widest run of neighbouring values that count. Ordered dials give a range
// over their numeric values; a word-valued dial gives the list of values that
// count. Ties go to the earliest run, so the same rows give the same answer.
function recommendRange(rows, dial, check, opts = {}) {
  const c = countsFor(rows, dial, check, opts);
  const ordered = ORDERED_DIALS.includes(dial);
  if (!ordered) {
    const values = c.values.filter((v) => v.counts).map((v) => v.value);
    return { ...c, ordered, recommend: values.length ? { values } : null,
      why: values.length ? null : 'no value beats the check' };
  }
  const numeric = c.values.filter((v) => Number.isFinite(Number(v.value)) && v.value !== 'auto' && v.value !== 'none');
  let best = null;
  let run = [];
  const close = () => { if (run.length && (!best || run.length > best.length)) best = run; run = []; };
  for (const v of numeric) { if (v.counts) run.push(v); else close(); }
  close();
  return {
    ...c, ordered,
    // n, not values: `values` is the LIST a word-valued dial recommends, and a
    // count under the same name broke the page the first time it met one
    recommend: best ? { min: Number(best[0].value), max: Number(best[best.length - 1].value), n: best.length } : null,
    why: best ? null : 'no value beats the check',
  };
}

// The largest rectangle of squares that count and are not thin (step 3). A
// square counts on the same terms as a value: above the scrambled copy's
// square on every copy, or above each half's own grid average on both halves.
// `grids` are step3() outputs: the real one and one per check copy (or the two
// halves). Brute force over every rectangle -- a grid is a few hundred squares.
function recommendBlock(real, checkGrids, kind, opts = {}) {
  const A = real.aVals || []; const B = real.bVals || [];
  // the same bar as a value's: a square counts when it beats at least `bar`
  // of the copies' squares; the halves are both, as ever
  const bar = kind === 'halves' ? checkGrids.length : barOf({ k: checkGrids.length, barPct: opts.barPct });
  const at = (g, a, b) => (g.grid || []).find((x) => x.a === a && x.b === b) || null;
  const gridGrand = (g) => {
    let s = 0; let n = 0;
    for (const x of (g.grid || [])) if (x.mean != null) { s += x.mean * x.n; n += x.n; }
    return n ? s / n : null;
  };
  const grands = kind === 'halves' ? checkGrids.map(gridGrand) : null;
  const counts = new Map();
  // HOW MANY COPIES EACH SQUARE BEATS, and how far ahead it sits (3.56.0):
  // worked out here, where the squares are already being judged, so the screen
  // shows the same numbers the bold came from rather than a second arithmetic.
  const beaten = new Map();
  const leads = new Map();
  for (const a of A) {
    for (const b of B) {
      const x = at(real, a, b);
      let ok = !!x && x.mean != null && !x.thin && checkGrids.length > 0;
      let won = 0;
      const copies = [];
      if (x && x.mean != null) {
        for (let i = 0; i < checkGrids.length; i++) {
          const y = at(checkGrids[i], a, b);
          if (!y || y.mean == null) continue;
          copies.push(y.mean);
          if (kind === 'halves' ? beats(y.mean, grands[i]) : beats(x.mean, y.mean)) won++;
        }
        beaten.set(`${a}|${b}`, { won, of: copies.length });
        leads.set(`${a}|${b}`, kind === 'halves' ? null : leadOf(x.mean, copies));
      }
      if (ok) ok = won >= bar;
      counts.set(`${a}|${b}`, ok);
    }
  }
  // THE BIGGEST RECTANGLE OF SQUARES THAT COUNT, AND A TIE IS BROKEN BY THE
  // CHECK (3.56.0, owner order: "break ties by the check, not by luck"). Two
  // rectangles of the same size used to be settled by whichever the loops met
  // first, which is an accident of the dials' order. The one whose squares sit
  // further ahead of their copies wins instead -- the lead, averaged over the
  // rectangle. Money is NOT read here and must not be: the recommendation
  // comes from the check alone, and what a block is worth is PRINTED beside it
  // so the owner chooses with their eyes open (FUNNEL-DESIGN.md 4.5).
  const leadOver = (a0, a1, b0, b1) => {
    const vals = [];
    for (let i = a0; i <= a1; i++) for (let j = b0; j <= b1; j++) { const v = leads.get(`${A[i]}|${B[j]}`); if (v != null && Number.isFinite(v)) vals.push(v); }
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  let best = null;
  for (let a0 = 0; a0 < A.length; a0++) {
    for (let a1 = a0; a1 < A.length; a1++) {
      for (let b0 = 0; b0 < B.length; b0++) {
        for (let b1 = b0; b1 < B.length; b1++) {
          let all = true;
          for (let i = a0; i <= a1 && all; i++) for (let j = b0; j <= b1 && all; j++) if (!counts.get(`${A[i]}|${B[j]}`)) all = false;
          if (!all) continue;
          const n = (a1 - a0 + 1) * (b1 - b0 + 1);
          if (best && n < best.squares) continue;
          const lead = leadOver(a0, a1, b0, b1);
          if (!best || n > best.squares || (lead != null && (best.lead == null || lead > best.lead))) best = { a0, a1, b0, b1, squares: n, lead };
        }
      }
    }
  }
  const squares = [...counts.entries()].filter(([, v]) => v).map(([k]) => k);
  const beatenOut = {};
  for (const [k, v] of beaten) beatenOut[k] = v;
  if (!best) return { counting: squares, beaten: beatenOut, block: null, why: 'no square beats the check' };
  return {
    counting: squares,
    beaten: beatenOut,
    block: { a: { from: A[best.a0], to: A[best.a1] }, b: { from: B[best.b0], to: B[best.b1] }, squares: best.squares, lead: best.lead },
    why: null,
  };
}

// WHAT EACH LIMIT WOULD KEEP (step 6). Thresholds are read off the survivors
// themselves -- their lowest, quarter, middle, three-quarter and highest values
// -- so the ladder is always in the range the owner can actually choose in.
// `dir` is 'max' for a ceiling (worst losing streak) and 'min' for a floor.
function ladderFor(rows, field, dir) {
  const vals = rows.map((r) => Number(r[field])).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!vals.length) return { field, dir, of: rows.length, measured: 0, rungs: [] };
  const q = (p) => vals[Math.min(vals.length - 1, Math.max(0, Math.round((vals.length - 1) * p)))];
  const at = [...new Set([q(0), q(0.25), q(0.5), q(0.75), q(1)])];
  return {
    field, dir, of: rows.length, measured: vals.length,
    rungs: at.map((t) => ({ at: t, keeps: vals.filter((v) => (dir === 'max' ? v <= t : v >= t)).length })),
  };
}

// ---- WHICH CROSSES ARE WORTH READING (§18, owner order 2026-09-04) ----------
//
// Step 3 asks whether two dials interact. Until now the only guidance on WHICH
// two was that the pickers defaulted to step 1's top two. This reads every pair
// still worth gridding and keeps the ones that say something.
//
// Nothing here is new arithmetic. A pair is kept when recommendBlock finds a
// block at all -- at least one square beating the bar's worth of the copies --
// AND that block does not span every value of both dials, which is the same
// test funnelRead already uses for the `the two dials interact` mark. A block
// spanning both axes says nothing the two single-dial ranges do not.
//
// IT MAY NEVER RANK BY MONEY (§15.2). Money is never compared between pairs;
// each square is compared against its own scrambled selves and nothing else.
const between = (list, x, y) => {
  const i = list.indexOf(x); const j = list.indexOf(y);
  if (i < 0 || j < 0) return [];
  return list.slice(Math.min(i, j), Math.max(i, j) + 1);
};
function blockSpans(blk, g) {
  const spansA = blk.a.from === g.aVals[0] && blk.a.to === g.aVals[g.aVals.length - 1];
  const spansB = blk.b.from === g.bVals[0] && blk.b.to === g.bVals[g.bVals.length - 1];
  // TWO TESTS, AND THE LIST WANTS THE STRICT ONE. `interact` is the loose test
  // the step 3 mark has always used: the block does not cover the whole grid.
  // `joint` is the one §18 needs: the block is strictly inside on BOTH axes.
  //
  // The difference is not academic (found by testing the list on a fixture
  // where one dial is flat, 2026-09-04). A block spanning one axis whole says
  // only "the other dial has a good range" -- which is a single-dial range at
  // step 2 and nothing more. Only a block bounded on both axes says the good
  // part of each dial sits at particular values of the other, which is the
  // whole reason to grid two dials together.
  return { spansA, spansB, interact: !(spansA && spansB), joint: !spansA && !spansB };
}
// A DIAL IS ELIGIBLE when the settings that survive hold two or more of its
// values. One value is not a grid axis, and a dial the rule has pinned has
// exactly one -- which is why the list shortens as the rule narrows (§18.3).
function eligibleDials(rows) {
  return ALL_DIALS.filter((d) => {
    const seen = new Set();
    for (const r of rows || []) { seen.add(keyOf(r[d])); if (seen.size > 1) return true; }
    return false;
  });
}
// WHAT THE READING WILL COST, BEFORE IT IS STARTED (§18.5). Measured on the
// owner's own board, 2026-09-04: one pair -- the real grid and all twenty kept
// scrambled copies -- took 688ms over 1,904 surviving settings. That is the
// rate below, and it is a FIRST estimate only: once the first pair has been
// read the screen re-works the rest from the time that pair actually took, so
// a box slower or faster than this one corrects itself instead of lying twice.
const MS_PER_ROW_PER_GRID = 688 / (1904 * 21);
function crossesOffer(rows, opts = {}) {
  const list = rows || [];
  const k = list.length && Array.isArray(list[0].noiseTest) ? list[0].noiseTest.length : 0;
  const dials = eligibleDials(list);
  const pairs = (dials.length * (dials.length - 1)) / 2;
  const msEach = list.length * (k + 1) * MS_PER_ROW_PER_GRID;
  return { rows: list.length, k, kind: k ? 'scrambles' : 'halves', dials, pairs, msEach, msAll: msEach * pairs, floor: opts.floor == null ? 0 : opts.floor };
}
// THE SERVICE MUST STAY ANSWERABLE WHILE THIS RUNS. A hundred pairs over a
// hundred thousand settings is minutes of arithmetic, and a synchronous loop
// that long stops every other screen dead. It yields between pairs, the same
// way a unit's board yields between blocks.
async function crossesWorthReading(rows, opts = {}, note = null) {
  const floor = opts.floor == null ? 0 : Math.max(0, Math.floor(Number(opts.floor) || 0));
  const seed = opts.seed || 'funnel';
  const k = rows.length && Array.isArray(rows[0].noiseTest) ? rows[0].noiseTest.length : 0;
  const kind = k ? 'scrambles' : 'halves';
  const [ha, hb] = kind === 'halves' ? splitHalf(rows, seed) : [null, null];
  // A DIAL IS ELIGIBLE when the survivors hold two or more of its values. One
  // value is not a grid axis, and a dial the rule has pinned has exactly one --
  // which is why the list shortens as the rule narrows (§18.3).
  const free = eligibleDials(rows);
  const pairs = [];
  for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) pairs.push([free[i], free[j]]);
  const crosses = [];
  let read = 0;
  for (const [a, b] of pairs) {
    const g = step3(rows, a, b, { floor });
    const readers = kind === 'scrambles'
      ? Array.from({ length: k }, (_, d) => [rows, moneyAt(d)])
      : [[ha, money], [hb, money]];
    const checkGrids = readers.map(([x, m]) => step3(x, a, b, { floor, moneyOf: m }));
    const rec = recommendBlock(g, checkGrids, kind, { barPct: opts.barPct });
    read++;
    if (note) note(read, pairs.length);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setImmediate(resolve); });
    const blk = rec && rec.block;
    if (!blk) continue;                       // no square in this grid counts
    const sp = blockSpans(blk, g);
    if (!sp.joint) continue;                  // says nothing the two ranges do not
    // THE SCORE, over the squares INSIDE the block and no others: how many of
    // the copies they beat, of how many comparisons there were.
    let won = 0;
    let of = 0;
    for (const av of between(g.aVals, blk.a.from, blk.a.to)) {
      for (const bv of between(g.bVals, blk.b.from, blk.b.to)) {
        const bt = (rec.beaten || {})[`${av}|${bv}`];
        if (bt) { won += Number(bt.won) || 0; of += Number(bt.of) || 0; }
      }
    }
    crosses.push({
      a, b, block: { a: blk.a, b: blk.b }, squares: blk.squares, ofSquares: (g.grid || []).length,
      won, of, share: of ? won / of : null, lead: blk.lead == null ? null : blk.lead,
      spansA: sp.spansA, spansB: sp.spansB,
    });
  }
  crosses.sort((x, y) => ((y.share ?? -1) - (x.share ?? -1))
    || (y.squares - x.squares)
    || ((y.lead ?? -Infinity) - (x.lead ?? -Infinity))
    || `${x.a}|${x.b}`.localeCompare(`${y.a}|${y.b}`));
  return { kind, k, floor, dials: free, pairs: pairs.length, read, crosses };
}

module.exports = {
  ORDERED_DIALS, CATEGORICAL_DIALS, ALL_DIALS, HOLDS_AXES, TEST_MONEY,
  money, moneyAt, beats, cents, DEFAULT_BAR_PCT, barPctOf, barOf, chanceOf, leadOf, keyOf, sortedValues, hash32, splitHalf,
  groupsFor, movement, balanceOf, step1, shapeClass, step2, step3, floorCost,
  holdsAcross, holdsAxisFor,
  checkKindOf, countsFor, recommendRange, recommendBlock, ladderFor,
  crossesWorthReading, crossesOffer, eligibleDials, blockSpans,
};
