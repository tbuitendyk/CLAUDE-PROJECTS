// rankhold.js -- DOES A WAY OF CHOOSING STILL PICK WINNERS ON TEST DATA IT WAS
// NOT RANKED ON? (SELECTION-DESIGN.md Part 4, 3.102.0.)
//
// The way of choosing is a procedure: rank every setting by its test money,
// keep the top of the list, apply some floors. Nothing measured whether that
// procedure holds up. You found out when the reserve was opened, by which point
// the answer was about one selection and the stretch was spent.
//
// So: rank the settings on one part of the test window, score them on another
// part, and ask whether the ranking held. Three answers, three meanings:
//
//   holds up      nothing has been ruled out. This is NOT evidence that the
//                 choosing works; it is the absence of a red flag.
//   unrelated     the choosing is picking at random, and nothing that comes out
//                 of it means anything however good the numbers look.
//   inverted      worse than useless. What is being selected for is actively
//                 wrong across the boundary.
//
// NOTHING HERE READS A FILE, A SET, OR THE HELD-BACK WINDOW. It takes the money
// each setting made in each third of the TEST window -- which the rebuilt
// numbers beside a stage 3 set already carry -- and returns arithmetic. Every
// function can be tested on a table typed into a test.
//
// WHY THIRDS AND NOT HALVES. The pricing already works the test window out in
// thirds for every setting, so three parts cost nothing where two would cost a
// pass. Thirds also give FOUR boundaries instead of one, which is what the
// design asked for: one answer is one boundary, and a spread across several is
// far harder to read as chance. The cost is that each part is a third of the
// window rather than a half, so a short test window runs out of trades sooner
// -- which is why the two floors below exist and why a coin and shape too thin
// for either of them reads as unreadable rather than as a number.
//
// TWO KINDS OF THIN, AND THEY ARE NOT THE SAME THING (owner, 2026-09-10).
//   `fewestRanked`  how many SETTINGS go into the ranking. A setting is one
//                   combination of entry, gate, d, t, trail and arm. Rank three
//                   of them against each other and the answer means nothing,
//                   whatever the window.
//   `fewestChunks`  how many CHUNKS are in each part of the test window -- how
//                   much history is behind each setting's figure. A weekly
//                   shape has about sixteen a part on today's data where a
//                   daily one has over a hundred, and the money in a sixteen-
//                   chunk part is a handful of trades.
// Neither guards the other, and the words do not borrow from each other: the
// first counts settings, the second counts chunks.
//
// THE THREE NUMBERS THE OWNER SETS NEVER CAUSE A RE-READ. Reading one board is
// seconds; every number below is arithmetic on readings already in hand. So the
// readings are worked out once, whole, and `withBar` is what the three numbers
// move. Nothing on a screen works out a pass for itself -- there is one place
// that decides it and this is it.

// A BLANK IS NOT A ZERO. The poll sends the bar in a query string, where an
// unset number arrives as an empty string -- and Number('') is 0, which is a
// real bar meaning "any order at all counts". Every reader of a number the
// owner may have left blank goes through here.
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// AVERAGE RANKS, so ties cannot decide anything. Two settings on the same money
// share the rank between them; without that, the order they happen to sit in
// the file would move the answer.
function ranksOf(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}

// HOW MUCH OF THE RANKING HELD, from -1 to 1. Ranks are compared, never the
// money, so one enormous figure cannot carry the answer: what is being asked is
// whether the ORDER survived, not whether the sizes did.
//   1   the same order on both parts
//   0   no relation at all
//  -1   exactly reversed
function rankHold(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;                       // two points always correlate perfectly
  const ra = ranksOf(a.slice(0, n));
  const rb = ranksOf(b.slice(0, n));
  const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let top = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i] - ma;
    const db = rb[i] - mb;
    top += da * db; sa += da * da; sb += db * db;
  }
  // EVERY SETTING ON THE SAME MONEY leaves no order to hold, and calling that
  // agreement would read as proof when it is the absence of any information.
  if (sa <= 0 || sb <= 0) return null;
  return top / Math.sqrt(sa * sb);
}

// THE FOUR BOUNDARIES THIRDS GIVE. Each is `rank on these parts, score on that
// one`, named the way the screen says it.
const BOUNDARIES = [
  { key: '1>2', on: [0], score: 1, word: 'first part ranks, second scores' },
  { key: '2>3', on: [1], score: 2, word: 'second part ranks, third scores' },
  { key: '1>3', on: [0], score: 2, word: 'first part ranks, third scores' },
  { key: '12>3', on: [0, 1], score: 2, word: 'first two parts rank, third scores' },
];

// One coin and shape's readings. `rows` are its settings, each with pnlThirds --
// the money it made in each part of the TEST window. A row without all three
// parts is counted and left out of the arithmetic, never guessed at.
// `chunksAPart` is how many chunks the smallest part of that unit's test window
// holds, read off what the run recorded; null when the run did not record it.
//
// EVERY BOUNDARY IS WORKED OUT HERE whatever the counts are. Deciding that a
// reading is too thin to trust is the owner's number and it lives in `withBar`,
// so moving it costs nothing and re-reads nothing.
function holdOfUnit(rows, chunksAPart = null) {
  const usable = (rows || []).filter((r) => {
    const t = r && r.pnlThirds;
    return Array.isArray(t) && t.length >= 3 && t.slice(0, 3).every((v) => num(v) != null);
  });
  const readings = BOUNDARIES.map((b) => {
    const on = usable.map((r) => b.on.reduce((s, i) => s + num(r.pnlThirds[i]), 0));
    const sc = usable.map((r) => num(r.pnlThirds[b.score]));
    return { ...b, hold: rankHold(on, sc) };
  });
  return {
    of: (rows || []).length,
    usable: usable.length,
    noThirds: (rows || []).length - usable.length,
    chunksAPart: num(chunksAPart),
    readings,
  };
}

// HOW MANY OF THE FOUR, clamped to what there are: a bar of five boundaries on
// four cannot be cleared by anything and would read as a fault in the numbers.
const howManyOf = (bar) => Math.min(BOUNDARIES.length, Math.max(1, Math.floor(num(bar && bar.onHowMany) == null ? BOUNDARIES.length : num(bar.onHowMany))));

// THE TWO FLOORS, each named for exactly what it counts. Below either one the
// readings are withheld, not shown greyed, because a number on screen is a
// number that gets read.
const fewestRankedOf = (bar) => Math.max(3, Math.floor(num(bar && bar.fewestRanked) == null ? 30 : num(bar.fewestRanked)));
const fewestChunksOf = (bar) => Math.max(0, Math.floor(num(bar && bar.fewestChunks) == null ? 40 : num(bar.fewestChunks)));
// WHY A COIN AND SHAPE CANNOT BE READ, or null when it can. One place, so the
// table and the pass can never disagree about which rows are readable.
function tooThin(hold, bar = {}) {
  const ranked = fewestRankedOf(bar);
  const chunks = fewestChunksOf(bar);
  if (!hold) return { why: 'nothing was read for this coin and shape', ranked, chunks };
  if (hold.usable < ranked) {
    return { why: `only ${hold.usable.toLocaleString()} setting(s) here carry all three parts, fewer than the ${ranked.toLocaleString()} you asked for`, ranked, chunks };
  }
  if (chunks > 0 && hold.chunksAPart == null) {
    return { why: 'this run did not record how long its test window was, so a floor on chunks a part cannot be applied', ranked, chunks };
  }
  if (chunks > 0 && hold.chunksAPart < chunks) {
    return { why: `each part of this test window holds ${Number(hold.chunksAPart).toLocaleString()} chunk(s), fewer than the ${chunks.toLocaleString()} you asked for`, ranked, chunks };
  }
  return null;
}

// DOES THIS COIN AND SHAPE CLEAR THE OWNER'S BAR? Two numbers they set, never a
// threshold decided here (RULE FIVE): how much of the ranking has to hold, and
// on how many of the four. `null` where nothing can be read -- unknown never
// passes, the same rule the verdict uses.
function clearsBar(hold, bar = {}) {
  const need = num(bar.atLeast);
  const onHowMany = howManyOf(bar);
  const thin = tooThin(hold, bar);
  const base = { need, onHowMany, fewestRanked: fewestRankedOf(bar), fewestChunks: fewestChunksOf(bar) };
  if (thin) return { pass: null, cleared: 0, known: 0, ...base, why: thin.why };
  const readings = (hold.readings || []).filter((r) => r.hold != null);
  if (!readings.length) return { pass: null, cleared: 0, known: 0, ...base, why: 'no boundary on this coin and shape could be read' };
  if (need == null) return { pass: null, cleared: 0, known: readings.length, ...base, need: null, why: 'no bar has been set' };
  const cleared = readings.filter((r) => r.hold >= need).length;
  // A BOUNDARY THAT COULD NOT BE READ IS NOT A BOUNDARY THAT PASSED. If fewer
  // than the asked-for number of boundaries have an answer at all, this cannot
  // clear a bar that counts them.
  if (readings.length < onHowMany) {
    return { pass: false, cleared, known: readings.length, ...base, why: `only ${readings.length} of the four boundaries could be read` };
  }
  return { pass: cleared >= onHowMany, cleared, known: readings.length, ...base, why: null };
}

// THE READINGS WITH THE OWNER'S THREE NUMBERS ON THEM. Takes rows already
// worked out by holdOfUnit, so moving a number re-reads nothing. Never sorted
// here -- the ordering is the screen's and the owner's.
function withBar(rows, bar = {}) {
  const units = (rows || []).map((r) => {
    const b = clearsBar(r, bar);
    const shown = tooThin(r, bar) ? (r.readings || []).map((x) => ({ ...x, hold: null })) : (r.readings || []);
    const got = shown.map((x) => x.hold).filter((v) => v != null);
    return {
      ...r,
      readings: shown,
      known: got.length,
      lowest: got.length ? Math.min(...got) : null,
      highest: got.length ? Math.max(...got) : null,
      bar: b,
    };
  });
  return {
    units,
    of: units.length,
    passing: units.filter((u) => u.bar.pass === true).length,
    failing: units.filter((u) => u.bar.pass === false).length,
    unreadable: units.filter((u) => u.bar.pass == null).length,
    bar: { atLeast: num(bar.atLeast), onHowMany: howManyOf(bar), fewestRanked: fewestRankedOf(bar), fewestChunks: fewestChunksOf(bar) },
    boundaries: BOUNDARIES.length,
  };
}

// The whole table from raw rows, in one call, for a caller that has both at
// once. Reading and barring are the same two steps either way.
function holdTable(units, bar = {}) {
  return withBar((units || []).map((u) => ({ unit: u.unit, name: u.name || u.unit, ...holdOfUnit(u.rows, u.chunksAPart) })), bar);
}

module.exports = { ranksOf, rankHold, holdOfUnit, clearsBar, withBar, holdTable, BOUNDARIES, tooThin, fewestRankedOf, fewestChunksOf, howManyOf };
