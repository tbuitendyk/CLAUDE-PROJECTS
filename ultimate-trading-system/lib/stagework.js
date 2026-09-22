// Pure task functions for the three-stage system (Sweep / Boards) — the
// unit of work either the main thread or a worker executes identically, in
// the same mould as bracketwork.js and under the same rule: every function
// here is deterministic given its descriptor, touches no shared state, and
// returns a plain object.
//
// WHAT THE STAGES ARE (owner's design, approved on the drawings it was worked
// out on, 2026-08-27):
//
//   Stage 1  trains each unit's slim members once (logreg per view), KEEPS
//            EVERY VOTE the members cast on the test and held-back windows,
//            and ranks the units by one fixed, settings-free rule: did the
//            pooled votes beat their own null set — the same votes with the
//            calendar shuffled away — at plain forecasting on the test
//            window. No trade box, no fee, no choice anywhere in the rank.
//   Stage 2  trains ONLY the boost members, only for carried units; the
//            logreg members are reused, votes and all.
//   Stage 3  never trains: it prices any block of settings straight from the
//            kept votes — decision, band, 24/5, agree, entry, gate, d, t,
//            trail, arm and the fee are all applied here, as arithmetic.
//
// The training and pricing steps call the SAME engine functions today's
// screens' numbers come from (logreg/boost fits, tuneTau, quorumCall,
// simCell, holdControls) — reimplementing any of them would let the two
// worlds' numbers quietly disagree.
const bracketLib = require('./bracket');
const {
  buildCombo, splitAndLabel, splitAndLabelPass, splitBounds, quorumCall, declaredQuorumFor,
  reserveChunks,
  markExtraGates,
} = require('./bracketwork');
const agreement = require('./agreement');
// THE ONE DEFINITION OF A COMMITTEE'S CALL (3.91.0): calls from votes, the
// committee's shape on its test slice, what is enough, the stream. Shared with
// the live path, so a greenlighted rule trades as stage 3 priced it.
const committee = require('./committee');
const crypto = require('crypto');
const { standardizeFit, standardizeApply, tuneAndTrain, trainSoftmax, predict: predictLogreg } = require('./logreg');
const { trainBoost, predictBoost } = require('./boost');
const { NOTIONAL, feeRate } = require('./paper');
const confirmLib = require('./confirm');
const windowLib = require('./windowmove');
const fieldGate = require('./fieldgate');
const { tuneTau } = require('./pipeline');
const { directionalCall } = require('./paper');
const { mulberry32 } = require('./rng');
// Deterministic in (seed, unit, fold, member, slice): reruns are byte-identical,
// and different seeds give independent draws. The engine's own rng, kept here
// since the walk-forward module it came from was retired with the older sweep
// path (3.97.0).
function nullRng(seed, unitKey, foldIdx, memberIdx, slice) {
  let h = (Number(seed) >>> 0) || 1;
  const s = `${unitKey}|${foldIdx}|${memberIdx}|${slice}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761) >>> 0;
  return mulberry32(h);
}

// Sureness spreads are stored as [down, nowhere, up] arrays, 4 decimal
// places — enough that argmax and every threshold on the tau menu read the
// stored number and the live number identically, small enough to keep
// millions of rows on disk without regret.
const q4 = (x) => Math.round(x * 10000) / 10000;
// KEPT SCRAMBLE MONEY IS STORED TO THE CENT (FUNNEL-DESIGN.md 4.5). One stored
// row measures 623 characters and a raw double is 18 of them, most of which are
// noise that gzip cannot find any repetition in. These figures are only ever
// averaged, curved, gridded and searched for a region -- a cent is far below any
// difference that could change a reading. Ten kept at cents is about +22% on the
// store; the same ten raw would be +61%.
const cents = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const probsArr = (p) => [q4(p['-1']), q4(p[0]), q4(p[1])];
const probsObj = (a) => ({ '-1': a[0], 0: a[1], 1: a[2] });

// The stored spread back into a call, exactly the way the engine reads a
// live prediction: argmax scans [-1, 0, 1] and strict `>` keeps the first of
// a tie, matching predictLogreg/predictBoost; directional goes through the
// same directionalCall every live path uses.
const CLASSES = [-1, 0, 1];
function callFromProbs(a, decision, tau) {
  if (decision === 'directional') return directionalCall(probsObj(a), tau);
  let best = 0;
  for (let k = 1; k < 3; k++) if (a[k] > a[best]) best = k;
  return CLASSES[best];
}

// Pool the members' spreads for one chunk: the committee's collective lean,
// a plain mean per outcome. Used only by the stage 1 ordering rule.
function pooledAt(memberProbs, i) {
  let d = 0; let n = 0; let u = 0;
  for (const m of memberProbs) { d += m[i][0]; n += m[i][1]; u += m[i][2]; }
  const c = memberProbs.length;
  return [d / c, n / c, u / c];
}

// THE FIXED ORDERING RULE (owner order, 2026-08-27: "offer an alternative
// objective methodology not requiring guessing at settings combinations").
// The forecast score adds up the sureness the pooled vote placed on what
// actually happened, chunk after chunk, over the given index order. Knowing
// something scores high, guessing scores middling, confident-and-wrong
// scores worst. No trade settings exist anywhere in it.
function forecastScore(memberProbs, labels, order = null) {
  let s = 0;
  const n = labels.length;
  for (let i = 0; i < n; i++) {
    const at = order ? order[i] : i;
    const p = pooledAt(memberProbs, at);
    s += p[labels[i] + 1];
  }
  return s;
}

// One shuffle order for a slice — the SAME order applied to every member
// (QC 81: dealing members independently destroys their agreement as well as
// the calendar, and the null must destroy the calendar alone). Built with
// the engine's own nullRng so a set's deals are reproducible from its seed.
function dealOrder(seed, unitKey, slice, n) {
  const rng = nullRng(seed, unitKey, 0, 0, slice);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  return order;
}

// The deals' own middle and spread. lead is (real - mean) / spread, which is
// one equation with two unknowns — so from a stored lead neither the noise
// average nor its width can be recovered, and "beat 661 of 800" can never
// become an effect size in dollars. Two numbers, no extra pricing.
function shapeOf(vals) {
  if (!vals.length) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const varr = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
  return { mean, spread: Math.sqrt(varr), n: vals.length };
}

// lead over null set: how far above the null set's typical score the real
// one sits, against the null set's own spread. Population spread; a spread
// of zero reads 0, never infinity (decision record #6).
// EACH MEMBER ON THE QUESTION IT WAS ACTUALLY ASKED (3.183.0,
// ADDITIONAL-MEMBER-DESIGN.md sections E and F).
//
// THIS IS WHAT MAKES THE SIT-OUT PROTECTION REACH THE EXTRA MEMBER, and it is
// the load-bearing line of the whole design. A member whose forecasts barely
// move scores the same shuffled as unshuffled, because the null keeps the same
// forecasts and the same answers and destroys only the pairing -- so it beats
// none of its deals and silence earns nothing. That protection already existed,
// but the score was POOLED across the committee, and a quiet member hid inside
// the pool. Dealt its own null against its own answers, it cannot.
//
// AND HOW OFTEN IT SPOKE, beside it. A member right about sitting out on 95 of
// 100 chunks has said nothing, and one number cannot tell that apart from a
// member that spoke and was right. Two numbers can.
const { argmaxCall } = require('./agreement');
function memberReadings({ members, specs, testChunks, seed, unitKey, nullN, tag }) {
  return members.map((m, mi) => {
    const at = specs[mi] ? specs[mi].at : null;
    // WHERE THIS MEMBER IS READ (3.202.0). A member the unit was always going
    // to have is read on the test window, as it always was. A member added
    // from a walk set is read on ITS OWN rest of the history -- everything
    // after the share it trained on -- which is the whole point of giving it a
    // split of its own: fifteen percent of the history opened its gate on six
    // decisions, and six decisions read nothing. `own` is what trainGatedMember
    // hands back for such a member; a member without it is read where it
    // always was.
    const own = m.own && Array.isArray(m.own.chunks) ? m.own : null;
    const rows = own ? own.chunks : testChunks;
    const votes = own ? own.probs : m.probs;
    const n = rows.length;
    const labels = rows.map((c) => (at == null ? c.label : c.altLabels[at]));
    // A FORCED SIT OUT IS NOT A FORECAST (3.201.0). An extra's gate shuts it on
    // most chunks, and both its answer and its call are `sit out` there -- so
    // scoring those would hand it every one of them right while its shuffled
    // copies, which do not know where the gate shut, get them wrong. It would
    // beat its own null set on moments it was never asked about.
    //
    // So the forecast SCORE is read on the moments it was allowed to speak on.
    // `spoke` and `chunks` below stay over every chunk, because how often it
    // acts out of all decisions is the rate, and that is the number being held
    // against the walk.
    const open = at == null ? rows.map((_, i) => i)
      : rows.map((c, i) => ((c.extraOn && c.extraOn[at]) ? i : -1)).filter((i) => i >= 0);
    const onLabels = open.map((i) => labels[i]);
    const probs = [open.map((i) => votes[i])];
    const score = forecastScore(probs, onLabels);
    const nulls = [];
    for (let d = 0; d < nullN; d++) nulls.push(forecastScore(probs, onLabels, dealOrder(seed, unitKey, `${tag}m${mi}#${d}`, open.length)));
    let beat = 0;
    for (const s of nulls) if (score > s) beat++;
    let spoke = 0;
    let rightWhenSpoke = 0;
    for (let i = 0; i < n; i++) {
      // ITS OWN CALL, THROUGH THE ENGINE'S OWN RULE. The first version of this
      // hand-rolled a fourth definition of "which way is this member leaning"
      // and disagreed with the other three on ties, which is exactly how a
      // measurement comes to contradict the vote it is meant to describe.
      // argmaxCall is the one the engine votes with.
      const call = argmaxCall(votes[i]);
      if (!call) continue;
      spoke++;
      if (call === labels[i]) rightWhenSpoke++;
    }
    return {
      // NOTE what `spoke` is and is not: it is how often THIS member leaned up
      // or down on its own, at argmax. It is NOT how often its vote changed
      // what the committee did -- the committee trades on a pooled direction
      // and under its own decision, and a member can lean all day without
      // moving it. Two different questions; this answers the first.
      from: specs[mi] ? (specs[mi].from || 'own') : 'own',
      score, beat, deals: nullN, lead: leadOver(score, nulls),
      spoke, chunks: n, rightWhenSpoke,
      // AND WHAT STRETCH THAT READING COVERS, so the screen can say it rather
      // than leave the owner to guess which window six decisions came out of
      // (RULE ELEVEN clause 3). For an extra, the share it trained on and how
      // many decisions its gate opened there ride along too: that count is the
      // one held against the floor a direction can be learned from.
      read: n ? { fromTs: rows[0].startTs, toTs: rows[n - 1].startTs, chunks: n, share: own ? own.share : null } : null,
      trained: own ? { chunks: own.trainedOn, of: own.ofChunks } : null,
      // and why it never speaks, when it could not be trained (3.203.0)
      silent: m.silent || (m.saved && m.saved.kind === 'silent' ? m.saved.why : null),
    };
  });
}
// WHICH EXTRAS BELONG TOGETHER, checked against the extras they index (3.203.0).
// A plateau naming an extra the unit does not carry is refused: the record it
// would write could not be read back.
function plateausOf(p, extras) {
  const plats = Array.isArray(p && p.plateaus) ? p.plateaus : [];
  const n = (extras || []).length;
  return plats.map((f, j) => {
    const members = Array.isArray(f && f.members) ? f.members.map(Number) : [];
    const centre = Number(f && f.centre);
    if (!members.length || members.some((i) => !Number.isInteger(i) || i < 0 || i >= n) || !members.includes(centre)) {
      throw new Error(`plateau ${j + 1} names extras this unit does not carry (${JSON.stringify(f)}, ${n} extra(s))`);
    }
    return { ...f, centre, members };
  });
}
// how a member that is too thin to train is handled: a plateau's centre refuses
// the unit, a neighbour goes silent; a lone extra is its own centre
const whenThinFor = (spec, plateaus) => (spec.at != null && plateaus.length && !plateaus.some((f) => f.centre === spec.at) ? 'silent' : 'refuse');

// HOW MANY EXTRA BLOCKS A COMMITTEE WAS BUILT WITH, read off its own members
// (3.183.0). Never recomputed from the combo size: that is the assumption this
// design exists to remove, and a record that says what it holds cannot drift
// from what it holds.
const extrasInMembers = (members) => (members || []).reduce(
  (n, m) => Math.max(n, m && m.spec && m.spec.at != null ? m.spec.at + 1 : 0), 0);

function leadOver(real, nullScores) {
  if (!nullScores.length) return null;
  const mean = nullScores.reduce((a, b) => a + b, 0) / nullScores.length;
  const varr = nullScores.reduce((a, b) => a + (b - mean) * (b - mean), 0) / nullScores.length;
  const sd = Math.sqrt(varr);
  // NO SPREAD, NO LEAD -- tested at the scale of the numbers, not against an
  // exact zero. Six copies of 4.40 average to a number a hair off 4.40 in
  // floating point, so their spread came out as 1e-16 rather than 0 and the
  // lead as a whole ±1 (found 2026-09-02 by the tuning-slice money's tie test).
  if (!(sd > 1e-9 * Math.max(1, Math.abs(mean)))) return 0;
  return (real - mean) / sd;
}

// ---- member training, plain fit ---------------------------------------------
//
// The same fitting steps trainMember runs for an argmax member — same lambda
// ladder, same scaler, same boost probe for the round count — but what comes
// back is the member's SURENESS per chunk, kept, plus the probe's votes on
// the validation slice (what tau tuning reads at stage 3) and the fitted
// model. No decision, no class weights, no tau here: decision is stage 3's
// business (decision record #1).
// ---- TUNING-SLICE MONEY (3.46.0, owner order 2026-09-02) -----------------------
//
// WHY THIS EXISTS. The forecast score ranks a unit by the sureness its votes
// placed on what happened, every chunk counted once, the flat class included.
// Measured on the box (2026-09-02, 25 units): that order ran AGAINST the money
// the same votes made on the test window (rank correlation -0.61), because a
// vote can be right on the small days and wrong on the few big ones, and the
// score cannot tell. Money can. But money on the TEST window is the Funnel's
// window, and ranking on it would hand the Funnel units already chosen for
// beating that window's shuffles. So the money is read on the TUNING SLICE:
// the last quarter of the training window, which the fit never saw and which
// tau has always been tuned on. The probe votes on it are already stored
// (tauProbs); pricing them costs one pass of arithmetic per copy.
//
// WHAT IS PRICED. One call per chunk: buy when the members lean up, sell when
// they lean down, nothing on an exact tie -- no flat class, so a unit is paid
// for direction on the days that pay, weighted by how far the price moved.
// Held from the entry hour to the exit hour of the label window, through
// simMarket at the fee declared on Sweep -- the same arithmetic stage 3 uses
// for market entry, so the number means what a stage 3 number means.
const TUNING_TAG = 's1val';
// the lean of the members named in `use`, at each chunk: up minus down
function directionCalls(memberProbs, use, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let up = 0;
    let down = 0;
    for (const mi of use) {
      const pr = memberProbs[mi][i];
      up += pr[2];
      down += pr[0];
    }
    out[i] = up > down ? 1 : (down > up ? -1 : 0);
  }
  return out;
}
// THE TUNING SLICE IS SIZED FROM THE VOTES ON IT, never re-derived: the probe
// votes are the last nVal chunks of the training window (trainProbMember), and
// a member whose votes disagree in length with the others is refused rather
// than silently cut to fit.
function tuningSliceOf(trainChunks, tauProbs) {
  const nVal = (tauProbs[0] || []).length;
  if (!nVal) throw new Error('no votes on the tuning slice — nothing to price');
  for (const t of tauProbs) {
    if ((t || []).length !== nVal) {
      throw new Error(`the members' tuning-slice votes disagree in length (${nVal} against ${(t || []).length})`);
    }
  }
  if (nVal > trainChunks.length) throw new Error('more tuning-slice votes than training chunks — the stores do not describe these chunks');
  return trainChunks.slice(trainChunks.length - nVal);
}
function directionMoney(chunks, calls, tradeMap, geo, fee) {
  if (!Number.isFinite(fee) || fee < 0) {
    throw new TypeError(`directionMoney: fee % each way is required — got ${JSON.stringify(fee)}`);
  }
  return bracketLib.simMarket(chunks, calls, tradeMap, geo, { tHours: geo.exitOffsetH - geo.entryOffsetH, feePerLeg: fee });
}
// The real money beside its null set: the same calls dealt onto other days of
// the same slice, one seeded order per copy (dealOrder), and every copy's
// money written down in cents -- it is free arithmetic and the tables read it.
function moneyAgainstNull({ chunks, calls, tradeMap, geo, fee, seed, unitKey, nullN, tag = TUNING_TAG }) {
  const real = directionMoney(chunks, calls, tradeMap, geo, fee);
  const money = cents(real.pnl);
  const nullMoney = [];
  for (let d = 0; d < nullN; d++) {
    const order = dealOrder(seed, unitKey, `${tag}#${d}`, chunks.length);
    nullMoney.push(cents(directionMoney(chunks, order.map((k) => calls[k]), tradeMap, geo, fee).pnl));
  }
  let beat = 0;
  for (const m of nullMoney) if (money > m) beat++;
  return { money, trades: real.trades, chunks: chunks.length, nullMoney, beat, pairs: nullN, lead: leadOver(money, nullMoney) };
}

// ---- TRAINING BY WHAT WAS ACTUALLY AT STAKE (3.69.0, owner order) -----------
//
// ONE CHUNK IS ONE DECISION AND ONE TRADE (said in these words after the owner
// asked, 3.70.1: "that is per trade, not per week"). A chunk is a week on the
// weekly shape and a day on the daily ones; either way the forecast makes
// exactly one call on it and that call is at most one trade. So weighing a
// chunk IS weighing a trade, and the screen says trade, which is the word that
// is true on every shape.
//
// Every training trade used to count the same. One where the price moved 0.6%
// and one where it moved 14% were a single lesson each -- "up" -- because the
// label throws the size away (dataset.js scoreDiff). So a forecast right nine
// times on crumbs and wrong once on a landslide trained as a GOOD forecast and
// lost money. That is the fault the owner named, and this is the answer to it.
//
// A TRADE IS WORTH WHAT ITS DECISION IS WORTH: the gap between the best it
// could do and the worst it could do, in dollars on the same stake the rest of
// the system prices at.
//
//   the move, in dollars      m    = NOTIONAL x |diff| / 100
//   the round trip, in dollars trip = NOTIONAL x 2 x the fee rate
//   best  = max(0, m - trip)      call it right, or stand aside on a crumb
//   worst = -(m + trip)           call it backwards
//   stake = best - worst
//
// On a trade that moved, that comes to about twice the move: the fees are paid
// whichever way you call it, so they cancel out of the gap. On one that barely
// moved it comes to the round trip: staying out earns nothing and taking it the
// wrong way wastes the fees, and THAT is what teaches the forecast when to stay
// out. The owner chose this over weighing by what a right call earns alone
// (3.70.1), which would have given a trade too small to cover its fees a weight
// of zero -- and a forecast that never learns to stay out takes every crumb and
// bleeds the fees. So nothing gets a weight of zero and no floor has to be
// invented: the arithmetic of the trade sets it.
//
// TAKEN FROM THE TRAINING CHUNKS ONLY, never the test or the held-back window,
// the same discipline the band already follows.
//
// NORMALISED so the average weight is 1, which leaves the strength of the
// regularisation meaning what it meant, and lets a run with this off and a run
// with it on be told apart by the setting rather than by a scale factor.
//
// AND CAPPED, because one 40% move can otherwise outweigh fifty ordinary trades
// and a fit to one trade is not a fit. `capMult` is how many ordinary trades the
// biggest may count for. Clipping after the normalising pulls the average a
// little under 1; that is a uniform scale on the whole objective and changes
// nothing, and the strength is chosen against the same weighted objective
// anyway. 0 turns the cap off.
const WEIGHT_CAP_DEFAULT = 10;
// The launch's answer to "weigh each trade by the money it was worth", read the
// same way in both stages. Anything but the word for money is direction only,
// which is what every set before 3.69.0 was trained under.
const TRAIN_ON = ['direction', 'money'];
const trainOnOf = (p) => (TRAIN_ON.includes((p || {}).trainOn) ? p.trainOn : 'direction');
const capOf = (p) => {
  const v = Number((p || {}).weightCap);
  return Number.isFinite(v) && v >= 0 ? v : WEIGHT_CAP_DEFAULT;
};
function weightsFor(p, trainChunks, fee) {
  return trainOnOf(p) === 'money' ? moneyWeights(trainChunks, fee, capOf(p)) : null;
}
// WHAT THE UNIT WAS ACTUALLY TRAINED UNDER, written onto its record. A setting
// that was asked for and could not be honoured -- no chunk with a move on it,
// so nothing to weigh by -- must not read as though it was.
// WHAT THE UNIT WAS TRAINED UNDER, AND HOW HARD THE CEILING HAD TO WORK.
//
// The two numbers the owner asked for (2026-09-12): "that number should be
// exposed, both the maximum that we're dealing with perhaps in a chunk of data
// so that we can evaluate really how much it should be toned down."
//
// `biggestBeforeCap` is the one that was missing and it is the one that answers
// the question. The first version reported the largest of the weights AFTER the
// ceiling had already clipped them, so at a ceiling of 5 it read 5 or less
// whatever the data held, and could never say how far anything was being toned
// down. `atCeiling` is the other half: one chunk clipped is not four hundred.
//
// `biggestKept` is the old `biggest` under a name that says which one it is.
// Renamed rather than reused, because a record that means two different things
// under one key is the fault RULE NINE exists to stop.
function weightsSaid(p, weights, reading = null) {
  const asked = trainOnOf(p);
  if (asked !== 'money') return { by: 'direction' };
  if (!weights) return { by: 'direction', asked: 'money', why: 'no training trade carried a move to weigh by' };
  let hi = 0;
  for (const w of weights) if (w > hi) hi = w;
  const out = { by: 'money', cap: capOf(p), biggestKept: Math.round(hi * 100) / 100, of: weights.length };
  if (reading) {
    out.biggestBeforeCap = Math.round(reading.biggestBeforeCap * 100) / 100;
    out.atCeiling = reading.atCeiling;
  }
  return out;
}

// THE STAKE EACH CHUNK CARRIES, and the average of them. One definition, read
// by both the weights and the reading of those weights, so the two can never
// describe different arithmetic.
function moneyStakes(chunks, feePerLeg, who = 'moneyStakes') {
  const list = Array.isArray(chunks) ? chunks : [];
  if (!list.length) return null;
  const trip = NOTIONAL * 2 * feeRate(feePerLeg, who);
  const stakes = list.map((c) => {
    const d = Number(c && c.diffPct);
    // a chunk with no move on the record teaches nothing about size; it is
    // still worth the fees a wrong call would waste
    const m = Number.isFinite(d) ? (NOTIONAL * Math.abs(d)) / 100 : 0;
    return Math.max(0, m - trip) + m + trip;
  });
  const total = stakes.reduce((a2, b2) => a2 + b2, 0);
  if (!(total > 0)) return null;                       // nothing to weigh by
  return { stakes, avg: total / stakes.length };
}
const capFrom = (capMult) => (Number.isFinite(Number(capMult)) && Number(capMult) > 0 ? Number(capMult) : Infinity);
function moneyWeights(chunks, feePerLeg, capMult = WEIGHT_CAP_DEFAULT) {
  const s = moneyStakes(chunks, feePerLeg, 'moneyWeights');
  if (!s) return null;
  const cap = capFrom(capMult);
  return s.stakes.map((x) => Math.min(cap, x / s.avg));
}
// HOW BIG THE BIGGEST WOULD HAVE BEEN, and how many the ceiling held down. Read
// off the same stakes the weights are built from, never off the weights
// themselves -- reading it off the weights is exactly how the first version came
// to report a number that could never exceed the ceiling.
function moneyWeightReading(chunks, feePerLeg, capMult = WEIGHT_CAP_DEFAULT) {
  const s = moneyStakes(chunks, feePerLeg, 'moneyWeightReading');
  if (!s) return null;
  const cap = capFrom(capMult);
  let hi = 0;
  let at = 0;
  for (const x of s.stakes) {
    const raw = x / s.avg;
    if (raw > hi) hi = raw;
    if (raw >= cap) at++;
  }
  return { biggestBeforeCap: hi, atCeiling: at, of: s.stakes.length, cap: Number.isFinite(cap) ? cap : null };
}
// The reading for a launch, or null when it is not training by money at all.
function weightReadingFor(p, trainChunks, fee) {
  return trainOnOf(p) === 'money' ? moneyWeightReading(trainChunks, fee, capOf(p)) : null;
}

// AN EXTRA MEMBER IS A GATE AND A DIRECTION, AND ONLY THE DIRECTION IS LEARNED
// (3.201.0, owner order: "I want the training to be tuned properly to be able to
// make decisions at the same rate and accuracy as the history walk procedure").
//
// The walk does not LEARN its gate. It computes one: is the look-back move
// bigger than the yardstick times the band. Then it acts in the direction the
// history leans. A threshold and two signs.
//
// We were asking a fitted member to rediscover that threshold from twenty
// compressed columns, on answers that are sit out on all but a few percent of
// chunks -- and a fit can be right on 97 of every 100 by never speaking at all.
// It took that deal, spoke once in 441, and no amount of tuning changes it:
// the gate is a comparison, not something there is anything to learn.
//
// So the rule is split the way the walk splits it.
//
//   THE GATE IS APPLIED, NEVER LEARNED. A chunk that does not clear gets a
//   forced sit out -- not a prediction. The member's rate is then the gate's
//   rate BY CONSTRUCTION, which is the whole of "the same rate".
//
//   THE MEMBER TRAINS ONLY ON WHAT IT IS ALLOWED TO ANSWER. It never sees the
//   chunks it is meant to sit out, so its answers there are the unit's own and
//   roughly balanced: a real question instead of a silent one. It also puts
//   `weigh each trade by the money it was worth` back beside the answers --
//   those weights come off the outcome, and with the gate on the look-back a
//   heavy chunk could otherwise be teaching silence.
//
//   WHAT IT LEARNS IS THE DIRECTION, the job the walk's two signs do, with
//   twenty columns rather than two sums. That is the only part worth learning
//   and the only part where it can beat the walk instead of merely matching it.
const gateOf = (spec) => (spec && spec.at != null
  ? (c) => !!(c && c.extraOn && c.extraOn[spec.at])
  : null);
// a sit out the member did not choose: certain, and read as 0 by argmaxCall
const SAT_OUT = [0, 1, 0];
// TRAINED ON WHAT IT MAY ANSWER, GATED ON WHAT IT MAY SAY. The weights are cut
// exactly as the rows are, or the fit is graded against a different objective
// than it was trained on.
//
// AND IT TRAINS ON ITS OWN SHARE OF THE WHOLE HISTORY (3.202.0, owner order:
// "We're making an exception ... for walk sets ... That gets trained fifty
// fifty or ... sixty forty using the entire history swath"). The window
// layout cuts the history for every member the unit was always going to have,
// and it is not touched: 70/15/15 and 61/13/13/13 still mean what they mean.
// But a member added from a walk set had its look-back and band SET on the
// first half of this same history and CONFIRMED on the second, by the walk --
// there is nothing left for a small test slice to choose, and on the box that
// slice opened its gate on six decisions, which reads nothing.
//
// So such a member takes everything the layout leaves unsealed -- train, test
// and held-back together, in order -- and trains on the first `share` percent
// of it. The system's test and held-back windows lie inside the rest, so its
// VOTES there are still votes on chunks it never trained on, and it votes in
// the committee exactly as before. What is new is where it is READ: on the
// whole of that rest (`own`), not on the test slice alone.
//
// Three things stay exactly where they were, on purpose:
//   * the tuning slice: the last quarter of the SYSTEM training window, every
//     member's same slice, because the tuning-slice money pools them all
//   * the probe that votes on that slice fits only on rows that start BEFORE
//     it (probeRows), because a member trained on 60% of the history has rows
//     inside a slice that starts at 52.5% of it
//   * the sealed reserve: this cuts what the layout leaves, never what it seals
//
// AND A MEMBER TOO THIN TO TRAIN IS EITHER REFUSED OR SILENT (3.203.0). The
// nine around a promoted row include bands a step higher than the one the walk
// liked, and a band a step higher opens the gate a step less often -- often
// enough to fall under the floor a direction can be learned from. The CENTRE
// of a plateau is what the owner promoted, so a centre that cannot be trained
// still refuses the unit, as one extra always has. A NEIGHBOUR that cannot be
// trained becomes a SILENT member: it sits out on every decision, its record
// says why, and the plateau it belongs to is read as that many fewer voices.
// `whenThin` is 'refuse' unless the caller says 'silent'.
async function trainGatedMember({ spec, viewIdx, trainChunks, testChunks = [], holdChunks = [], predictChunks, weights = null, weightsOf = null, labelOf, share = null, whenThin = 'refuse' }) {
  const gate = gateOf(spec);
  if (!gate) return trainProbMember({ model: spec.model, viewIdx, trainChunks, predictChunks, weights, labelOf });
  const own = ownSplitOf({ trainChunks, testChunks, holdChunks, share, at: spec.at });
  const keep = own.train.map((c, k) => (gate(c) ? k : -1)).filter((k) => k >= 0);
  // THE TUNING SLICE IS EVERY MEMBER'S SAME SLICE (3.201.1). It is the last
  // quarter of the WHOLE training window -- worked out here exactly as
  // trainProbMember works it out for a member handed all of it -- because the
  // tuning-slice money pools every member together, and a member voting on a
  // different stretch would be added into a total about somewhere else.
  const nVal = Math.max(3, Math.round(trainChunks.length * 0.25));
  const tune = trainChunks.slice(trainChunks.length - nVal);
  // and the probe that votes on it may fit only on rows that start before it
  const tuneFrom = tune.length ? tune[0].startTs : Infinity;
  const probeRows = keep.filter((k) => own.train[k].startTs < tuneFrom).length;
  let thin = null;
  if (keep.length < MIN_TRAIN_GATED) {
    thin = `extra ${spec.at + 1} clears its band on only ${keep.length} of the ${own.train.length} chunks in the first ${own.share}% of the history — too few to learn a direction from. `
      + 'A lower band on the walk row would open the gate more often.';
  } else if (Math.min(keep.length - Math.max(3, Math.round(keep.length * 0.25)), probeRows) < MIN_PROBE_ROWS) {
    thin = `extra ${spec.at + 1} clears its band on only ${probeRows} chunk(s) before the tuning slice — too few to fit the probe that votes on it`;
  }
  if (thin) {
    if (whenThin !== 'silent') throw new Error(thin);
    return silentMember({ spec, own, predictChunks, tune, why: thin, trained: keep.length });
  }
  // THE WEIGHTS ARE READ OFF THE ROWS IT TRAINS ON, the way every member's
  // are, and cut exactly as the rows are cut. A caller has to say HOW to weigh
  // rows, not hand over weights for a window this member does not train on.
  if (typeof weightsOf !== 'function') throw new Error('an extra member needs weightsOf: how to weigh whatever rows its split gives it');
  const ownWeights = weightsOf(own.train);
  if (Array.isArray(ownWeights) && ownWeights.length !== own.train.length) {
    throw new Error(`weightsOf gave ${ownWeights.length} weights for ${own.train.length} chunks`);
  }
  const m = await trainProbMember({
    model: spec.model,
    viewIdx,
    trainChunks: keep.map((k) => own.train[k]),
    predictChunks,
    weights: Array.isArray(ownWeights) ? keep.map((k) => ownWeights[k]) : ownWeights,
    // ...and on those chunks it is asked THE UNIT'S OWN question
    labelOf,
    tuneChunks: tune,
    probeRows,
  });
  // AND THE GATE SHUTS BOTH SETS OF VOTES, not only the predictions. A vote the
  // member was never allowed to make is a sit out on the tuning slice for the
  // same reason it is one on the test window.
  const shut = (rows, probs) => (Array.isArray(probs)
    ? probs.map((p, k) => (gate(rows[k]) ? p : SAT_OUT))
    : probs);
  return {
    ...m,
    probs: shut(predictChunks, m.probs),
    tauProbs: shut(tune, m.tauProbs),
    // its own reading: the fitted model's votes on the rest of the history,
    // gated the same way
    own: { ...ownReadingOf({ saved: m.saved, spec, viewIdx, trainChunks, testChunks, holdChunks, share }), trainedOn: keep.length, ofChunks: own.train.length },
  };
}
// A MEMBER THAT SITS OUT ON EVERY DECISION BECAUSE IT COULD NOT BE TRAINED
// (3.203.0). It is a real member with a real record: its saved model is of
// kind 'silent' and says why, every forecast it is asked for is a sit out, and
// everything that reads members -- the committee, the tuning-slice money, the
// unread window, the live rebuild -- reads it without a branch, because a sit
// out is a vote it already knows how to count.
function silentMember({ spec, own, predictChunks, tune, why, trained }) {
  const sit = (rows) => rows.map(() => SAT_OUT.slice());
  return {
    saved: { kind: 'silent', why },
    picked: 'not trained',
    probs: sit(predictChunks),
    tauProbs: sit(tune),
    nSub: null,
    silent: why,
    own: { chunks: own.read, probs: sit(own.read), share: own.share, trainedOn: trained, ofChunks: own.train.length },
  };
}
// HOW AN EXTRA MEMBER'S HISTORY IS CUT (3.202.0): everything the layout leaves
// unsealed, in order, the first `share` percent to train on and the rest to be
// read on. Refused, never defaulted, when the share is missing: a member
// trained on a share nobody chose would be a record that cannot say how it was
// made (RULE NINE), and the launch always records one.
function ownSplitOf({ trainChunks, testChunks = [], holdChunks = [], share, at }) {
  const pct = Number(share);
  if (!(pct > 0 && pct < 100)) {
    throw new Error(`extra ${(at ?? 0) + 1} has no split to train on — the launch did not say how much of the history a member added from a walk set trains on`);
  }
  const swath = [...trainChunks, ...testChunks, ...holdChunks];
  const nOwn = Math.round(swath.length * pct / 100);
  // THE SYSTEM'S TEST AND HELD-BACK WINDOWS MUST LIE IN WHAT THIS MEMBER NEVER
  // TRAINED ON, or its votes there are votes on its own lessons. The shares on
  // offer stop well before either layout's test window; this says so rather
  // than assuming it, so a share added tomorrow cannot quietly cross the line.
  if (testChunks.length && nOwn > trainChunks.length) {
    throw new Error(`the split for extra members trains on the first ${pct}% of the history, which reaches ${nOwn - trainChunks.length} chunk(s) into the test window — it has to stop before the window layout's own test window starts`);
  }
  const train = swath.slice(0, nOwn);
  const read = swath.slice(nOwn);
  if (!read.length) throw new Error(`the split for extra members leaves nothing to read extra ${(at ?? 0) + 1} on`);
  return { swath, train, read, share: pct, nOwn };
}
// A MEMBER'S OWN READING, from its saved model (3.202.0): its votes on the rest
// of the history under its split, gated exactly as its committee votes are.
// Stage 2 reads its parent's extra members through this from THEIR saved
// models, so both halves of a committee are read on the same stretch.
function ownReadingOf({ saved, spec, viewIdx, trainChunks, testChunks, holdChunks, share }) {
  const gate = gateOf(spec);
  if (!gate) throw new Error('only a member added from a walk set has a reading of its own');
  const own = ownSplitOf({ trainChunks, testChunks, holdChunks, share, at: spec.at });
  const probs = forecastRows(saved, viewIdx, own.read).map((pr, k) => (gate(own.read[k]) ? pr : SAT_OUT));
  return { chunks: own.read, probs, share: own.share };
}
// FEWER THAN THIS AND THERE IS NOTHING TO FIT. The splitter's own floor for a
// training stretch, used here for the same reason.
const MIN_TRAIN_GATED = require('./pipeline').MIN_CHUNKS;
// AND THE FEWEST ROWS A PROBE HAS EVER BEEN FITTED ON: what a member at that
// floor leaves its probe once the tuning quarter is taken off. Derived, not
// typed, so it cannot drift from the floor above.
const MIN_PROBE_ROWS = MIN_TRAIN_GATED - Math.max(3, Math.round(MIN_TRAIN_GATED * 0.25));

// AND THE TUNING SLICE CAN BE NAMED FROM OUTSIDE (3.201.1). It is the last
// quarter of the training rows handed in, which is right for every member that
// is handed the whole training window -- and wrong for one that is handed only
// the rows its gate opens. Such a member's slice came out a different LENGTH
// from everyone else's (tuningSliceOf refused: "468 against 11") and, matched,
// would have been different CHUNKS: gated moments scattered through history
// rather than the last quarter of the window the money is pooled over.
//
// `tuneChunks` names the rows to vote on instead. Left unset it is what it
// always was, so nothing that existed before this reads differently.
//
// AND HOW MANY OF THE TRAINING ROWS THE PROBE MAY FIT ON (3.202.0). It is the
// first three quarters of them, as it always was -- and no further than
// `probeRows` says, because a member trained on its own share of the whole
// history has rows that run past the start of the tuning slice every member
// votes on, and a probe graded on rows it was fitted to is not a probe. Left
// unset it is what it always was.
async function trainProbMember({ model, viewIdx, trainChunks, predictChunks, weights = null, labelOf = null, tuneChunks = null, probeRows = null }) {
  // WHICH ANSWERS THIS MEMBER IS MARKED AGAINST (3.183.0). A base member is
  // marked against the unit's own band, as it always has been; an extra member
  // against its own. Left unset it is the unit's, so nothing that existed
  // before this reads differently.
  const answer = labelOf || ((c) => c.label);
  const Xtr = trainChunks.map((c) => viewIdx.map((i) => c.x[i]));
  const ytr = trainChunks.map(answer);
  const Xte = predictChunks.map((c) => viewIdx.map((i) => c.x[i]));
  const nVal = Math.max(3, Math.round(Xtr.length * 0.25));
  const nSub = probeRows == null ? Xtr.length - nVal : Math.min(Xtr.length - nVal, Math.max(0, Math.floor(Number(probeRows))));
  if (nSub < MIN_PROBE_ROWS) {
    throw new Error(`only ${nSub} training chunk(s) start before the tuning slice — too few to fit the probe that votes on it`);
  }
  // the rows the probe votes on for the tuning slice: the last quarter of the
  // training rows unless the caller names another set
  const Xtu = tuneChunks ? tuneChunks.map((c) => viewIdx.map((i) => c.x[i])) : null;
  let saved;
  let picked;
  let probs;
  let tauProbs;
  // THE WEIGHTS ARE SLICED EXACTLY AS THE ROWS ARE (3.69.0). The probe fit sees
  // the first nSub rows and is graded on the rest, so it takes the same two
  // pieces of the weights -- a weighted fit graded on an unweighted yardstick
  // would choose its stopping point against a different objective than it was
  // trained on, which is the one mistake lib/boost.js's own note warns about.
  const wAll = Array.isArray(weights) && weights.length === Xtr.length ? weights : null;
  if (Array.isArray(weights) && !wAll) {
    throw new Error(`training weights are ${weights.length} long and there are ${Xtr.length} training chunks`);
  }
  const wSub = wAll ? wAll.slice(0, nSub) : null;
  const wVal = wAll ? wAll.slice(nSub) : null;
  if (model === 'logreg') {
    const scaler = standardizeFit(Xtr);
    const Ztr = standardizeApply(Xtr, scaler);
    const Zte = standardizeApply(Xte, scaler);
    const { model: m, chosenLambda } = await tuneAndTrain(Ztr, ytr, { onProgress: () => {}, exampleWeights: wAll });
    saved = { kind: 'logreg', lambda: chosenLambda, f: m.f, W: Array.from(m.W),
      mean: Array.from(scaler.mean), std: Array.from(scaler.std) };
    picked = `lambda=${chosenLambda}`;
    probs = Zte.map((z) => probsArr(predictLogreg(m, z).probs));
    const probe = await trainSoftmax(Ztr.slice(0, nSub), ytr.slice(0, nSub), chosenLambda, { weights: wSub });
    tauProbs = [];
    if (Xtu) {
      for (const z of standardizeApply(Xtu, scaler)) tauProbs.push(probsArr(predictLogreg(probe, z).probs));
    } else {
      for (let i = nSub; i < Ztr.length; i++) tauProbs.push(probsArr(predictLogreg(probe, Ztr[i]).probs));
    }
  } else {
    const probe = await trainBoost(Xtr.slice(0, nSub), ytr.slice(0, nSub), {
      Xval: Xtr.slice(nSub), yval: ytr.slice(nSub), weights: wSub, valWeights: wVal,
    });
    tauProbs = [];
    if (Xtu) {
      for (const x of Xtu) tauProbs.push(probsArr(predictBoost(probe, x).probs));
    } else {
      for (let i = nSub; i < Xtr.length; i++) tauProbs.push(probsArr(predictBoost(probe, Xtr[i]).probs));
    }
    const m = await trainBoost(Xtr, ytr, { rounds: probe.bestRound, weights: wAll });
    saved = { kind: 'boost', rounds: m.bestRound, priors: m.priors, trees: m.trees };
    picked = `rounds=${m.bestRound}`;
    probs = Xte.map((x) => probsArr(predictBoost(m, x).probs));
  }
  return { saved, picked, probs, tauProbs, nSub };
}

// Shared unit plumbing: chunks built and split exactly as the sweep engine
// builds them, under the stages' fixed training branch — auto band, 24/7,
// argmax-style labels (decision record #2). The reserve layout seals its
// final 13% before the split, same as unitTask.
// THE PIN A TASK CARRIES IS THE PATH OF ITS SET'S STAMP DETAIL (3.84.0),
// read once per worker and kept: the list of files the run was launched on.
const pinCache = new Map();
function pinnedFilesFor(pin) {
  if (!pin || typeof pin !== 'string') return null;
  if (pinCache.has(pin)) return pinCache.get(pin);
  const got = require('./pin').pinnedFilesOf({ detailFile: pin });
  pinCache.set(pin, got);
  if (pinCache.size > 8) pinCache.delete(pinCache.keys().next().value);
  return got;
}
// THE SHAPE OF ONE PASS, WORKED OUT WITHOUT TOUCHING A CANDLE (3.111.0,
// VERIFY-DESIGN.md Part 1). Its own function for three reasons: the screen
// prints the whole plan BEFORE anything is run, a test can walk every pass of a
// real history and prove none of them reaches whatever is sealed, and the
// arithmetic then lives in one place instead of once in the engine and again in
// whatever draws it.
//
// IT IS HANDED WHAT IS LEFT AFTER THE SET'S OWN LAYOUT HAS SEALED WHATEVER IT
// SEALS (3.111.1), so nothing here knows a reserve exists. A 61/13/13/13 set
// and a 70/15/15 set walk identical code from this point on, and a layout added
// later needs no entry here at all.
//
// The room is cut into TWICE AS MANY PARTS AS THERE ARE PASSES, so the first
// pass trains on half of it and each later pass gains one judging width: pass k
// learns on the first (of + k - 1) parts and is judged on the next. The LAST
// pass's judging stretch absorbs the remainder.
//
// THE PART IS FLOORED, NOT ROUNDED, and that is the whole reason this is
// arithmetic somebody can check: rounded, the fifth pass of a 2,315-chunk room
// ended four chunks past the end of it. Floored, the last one ends exactly on
// the boundary.
//
// The train-to-test ratio is the engine's own, read out of splitBounds rather
// than typed, so a pass splits its history the way every other reading of the
// unit splits it -- and that ratio is 70:15 inside the pool on BOTH layouts,
// which is why this needs no layout of its own. A pass has no held-back slice:
// its JUDGING stretch takes that slot, which is what lets everything downstream
// price it without knowing a pass happened.
function passGeometry(room, ofRaw, kRaw) {
  const of = Math.max(2, Math.floor(Number(ofRaw) || 0));
  const k = Math.max(1, Math.min(of, Math.floor(Number(kRaw) || 0)));
  const n = Math.max(0, Math.floor(Number(room) || 0));
  const part = Math.floor(n / (of * 2));
  const before = part * (of + k - 1);
  const judge = k === of ? n - before : part;
  const r = splitBounds(1000, true);                        // the engine's own 70:15, never typed
  const nTrain = Math.round(before * (r.nTrain / (r.nTrain + r.nTest)));
  return {
    of, k, room: n, part, before, judge, nTrain,
    nTest: before - nTrain,
    endsAt: before + judge,                                 // the last chunk of the room this pass may read
  };
}

async function unitChunks(combo, geometry, p) {
  const branch = { geometry, decision: 'argmax', band: 'auto', weekdaysOnly: false };
  // THE UNIT'S EXTRAS (3.183.0). A list, so a second one is an entry and not a
  // branch. Each is a look-back in hours and a band, both declared by the walk.
  const extras = p.extras || [];
  const { geo, maps, chunks, tooEarly } = await buildCombo(combo, branch, {
    allLoaded: !!p.allLoaded, startMonth: p.startMonth, endMonth: p.endMonth,
    pinnedFiles: p.pinnedFiles || null, extras,
  });
  let workChunks = chunks;
  let reserve = null;
  // a window runs from its first chunk's first hour to the last hour its last
  // chunk's trade can reach
  const reachOf = (c) => c.startTs + geo.exitOffsetH * 3600000;
  if (p.windowLayout === 'reserve61') {
    const nReserve = reserveChunks(workChunks.length);
    const sealed = workChunks.slice(workChunks.length - nReserve);
    reserve = { chunks: nReserve, fromTs: sealed[0].startTs, toTs: reachOf(sealed[sealed.length - 1]) };
    workChunks = workChunks.slice(0, workChunks.length - nReserve);
  }
  // (The 72% retrain layout of 3.94.0, which reached through the held-back
  // slice and judged on the Reserve, went in 3.142.0: the History retrain run
  // uses the set's own layout, and since 3.144.0 is judged on the Test window
  // with the held-back slice never priced, so no layout without a held-back
  // slice exists any more and none is needed.)
  // ONE PASS OF THE FIVE (3.111.0, VERIFY-DESIGN.md Part 1). The sealed
  // reserve comes off exactly as reserve61 seals it, and appears in no pass.
  //
  // WHAT IS LEFT IS CUT INTO TWICE AS MANY PARTS AS THERE ARE PASSES, so the
  // first pass learns on half the history and each later pass gains exactly one
  // judging width: pass k learns on the first (of + k - 1) parts and is judged
  // on the next one. The LAST pass's judge absorbs the remainder.
  //
  // THE PART IS FLOORED, NOT ROUNDED, and that is the whole reason this reads
  // the way it does: rounded, the fifth pass of a 2,315-chunk history ended four
  // chunks INSIDE the seal -- the one thing this part promises never to touch.
  // Floored, the last judge ends exactly on the boundary.
  //
  // The train-to-test ratio is the engine's own, read out of splitBounds rather
  // than typed here, so a pass splits its history the way every other reading
  // of this unit splits it. A pass has no held-back slice of its own: its
  // JUDGING stretch takes that slot, which is what lets everything downstream
  // price it without knowing a pass happened.
  // ONE PASS OF THE FIVE (3.111.0, VERIFY-DESIGN.md Part 1).
  //
  // A PASS IS NOT A LAYOUT, IT IS A MODIFIER ON ONE (3.111.1). Whatever the set
  // was built on has already sealed what it seals, a few lines above -- 13% for
  // a 61/13/13/13 set, nothing at all for a 70/15/15 one -- so the passes cut
  // what is left, and this code never asks which happened. That is why it needs
  // no layout name of its own, why a layout added later works without being
  // listed here, and why the 13% stays written once in this function.
  let passCut = null;
  if (p.pass) {
    passCut = passGeometry(workChunks.length, p.pass.of, p.pass.k);
    workChunks = workChunks.slice(0, passCut.endsAt);       // nothing beyond this pass's own judge
  }
  // every layout keeps a held-back slice (the 80/20 layout, which kept none, went 2026-09-08),
  // except the retrain layout, whose judge is the Reserve
  const extraBands = extras.map((e) => e.bandPct);
  const split = passCut
    ? splitAndLabelPass(workChunks, branch, passCut.nTrain, passCut.judge, extraBands)
    : splitAndLabel(workChunks, branch, true, extraBands);
  // THE ACTUAL DATE RANGES EVERY RUN USED (3.85.0, owner order 2026-09-07: "on
  // all s1/2/3 sweep runs the three actual date ranges for 70/15/15 and
  // 61/13/13 should be stored"). Written on every stage 1 and 2 record and,
  // per unit, beside every stage 3 set. THE UNREAD WINDOW HAS A START AND NO
  // END: it runs from where the seal began to whatever data exists when it is
  // finally read ("future runs that look at the last /13 should use all
  // available data"); seenToTs is only how far the data reached on the day.
  const span = (list) => (list && list.length ? { fromTs: list[0].startTs, toTs: reachOf(list[list.length - 1]), chunks: list.length } : null);
  const windows = {
    layout: p.windowLayout || null,
    train: span(split.trainChunks), test: span(split.testChunks), hold: span(split.holdChunks),
    unread: reserve ? { fromTs: reserve.fromTs, chunks: reserve.chunks, seenToTs: reserve.toTs } : null,
    // WHICH PASS THIS IS, AND WHERE ITS JUDGE SAT (3.111.0). The screen prints
    // chunk counts and dates per pass, and it must print the ones the pass
    // actually used rather than the ones a table predicted.
    pass: passCut ? { ...passCut, room: passCut.before + passCut.judge } : null,
  };
  return { geo, maps, split, reserve, windows, extras, tooEarly: tooEarly || 0 };
}

const viewsFor = (combo, geo, nExtras = 0) => bracketLib.comboViews(combo.size, geo.featureHours / 24, nExtras).views;

// Every number simCell hands back, minus the two the record already stores.
// A window's money is unreadable without the count of periods behind it and
// without how much of it rests on a within-bar ordering nobody can know
// (the older runner's note on cellAmbiguous: "Meaningless to report money without it").
function richOf(r) {
  if (!r) return null;
  return {
    wins: r.wins ?? null,
    stops: r.stops ?? null,
    ambiguous: r.ambiguous ?? null,
    trailAmbiguous: r.trailAmbiguous ?? 0,
    unpriced: r.unpriced ?? null,
    grossPerTrade: r.grossPerTrade ?? null,
    maxDrawdown: r.maxDrawdown ?? null,
    worstTrade: r.worstTrade ?? null,
    bestTrade: r.bestTrade ?? null,
    pnlThirds: r.pnlThirds || null,
  };
}

// WHAT STAGE 3 ACTUALLY STORES (ruling 4: stage 3 does not grow). The pricing
// returns everything on one path so a rebuild and a fresh run can never
// disagree; this is the one place that decides what reaches disk. Both writers
// go through it, and a test pins the key set — a field added outside `rich`
// would otherwise be spread straight into 5.2 million records by both of them.
function storedRecordOf(row) {
  const { rich, ...rest } = row;
  return rest;
}

// THE KEPT FIGURES ALREADY ON A RECORD, WITH THE NEW ONES ADDED AFTER THEM. A
// top-up hands back positions from..keep-1; the record holds 0..from-1. The
// result is always exactly `keep` long: a record holding fewer than `from`
// figures is padded with nulls up to `from` and the caller counts it, because
// a set that claims to keep `from` and holds less on a row is a fact worth
// reporting, never a reason to stop a rewrite that keeps every row.
function appendKept(existing, from, fresh) {
  const head = Array.isArray(existing) ? existing.slice(0, from) : [];
  let padded = 0;
  while (head.length < from) { head.push(null); padded++; }
  return { arr: head.concat(Array.isArray(fresh) ? fresh : []), padded };
}

// ---- TASK: one stage 1 unit ----------------------------------------------------
//
// Train the slim members (logreg per view), keep every test/held-back vote,
// score the unit under the fixed rule, deal the null set from the kept votes
// and read beat / lead. Returns everything the orchestrator writes.
async function s1UnitTask(task) {
  const { combo, geometry, seed, unitKey, nullN, fee } = task;
  const p = { ...task.params, pinnedFiles: pinnedFilesFor(task.pin) };
  const { geo, maps, split, reserve, windows, extras, tooEarly } = await unitChunks(combo, geometry, p);
  const { trainChunks, testChunks, holdChunks, bandPct, extraBandPcts } = split;
  const plateaus = plateausOf(p, extras);
  const views = viewsFor(combo, geo, extras.length);
  const predictChunks = holdChunks.length ? [...testChunks, ...holdChunks] : testChunks;
  const specs = require('./bracketwork').memberSpecs('logreg', combo.size, extras.length);
  // WHAT EACH TRAINING WEEK IS WORTH (3.69.0, owner order). Off unless the
  // launch asked for it, and off is what every set before this was trained
  // under -- so a set says how it was trained rather than leaving it to be
  // guessed at from the release it was made under.
  const weights = weightsFor(p, trainChunks, fee);
  const weightReading = weightReadingFor(p, trainChunks, fee);
  const members = [];
  for (const spec of specs) {
    // the gate is applied and the direction is learned (3.201.0). labelOf stays
    // null: on the chunks it may answer, an extra is asked the unit's own
    // question, which is what the walk's two signs answer.
    // AN EXTRA TRAINS ON ITS OWN SHARE OF THE WHOLE HISTORY (3.202.0), so it
    // is handed all three windows and told how to weigh whatever that gives it.
    const m = await trainGatedMember({
      spec, viewIdx: views[spec.view], trainChunks, testChunks, holdChunks, predictChunks, weights,
      weightsOf: (rows) => weightsFor(p, rows, fee), share: p.extraTrainShare, labelOf: null,
      whenThin: whenThinFor(spec, plateaus),
    });
    members.push({ spec, ...m });
  }
  const testLabels = testChunks.map((c) => c.label);
  // THE COMMITTEE'S OWN SCORE POOLS ONLY THE MEMBERS MARKED AGAINST ITS OWN
  // BAND (3.183.0). Pooling in a member asked a different question would drag
  // this number and make it mean something new, and it has to stay comparable
  // with every set already on the box. The extra member is read on its own,
  // just below, and it still VOTES -- pooling is for the score, not the vote.
  const testProbs = members.filter((_, i) => specs[i].at == null).map((m) => m.probs.slice(0, testChunks.length));
  const score = forecastScore(testProbs, testLabels);
  const nullScores = [];
  for (let d = 0; d < nullN; d++) {
    const order = dealOrder(seed, unitKey, `s1#${d}`, testChunks.length);
    nullScores.push(forecastScore(testProbs, testLabels, order));
  }
  let beat = 0;
  for (const s of nullScores) if (score > s) beat++;
  // THE TUNING-SLICE MONEY, beside the score (3.46.0): the probe votes priced
  // on the slice they were cast on, against the same null set.
  const tauProbs = members.map((m) => m.tauProbs);
  const slice = tuningSliceOf(trainChunks, tauProbs);
  const tuning = moneyAgainstNull({
    chunks: slice, calls: directionCalls(tauProbs, tauProbs.map((_, i) => i), slice.length),
    tradeMap: maps.trade, geo, fee, seed, unitKey, nullN,
  });
  return {
    bandPct,
    reserve,
    windows,
    counts: {
      train: trainChunks.length,
      test: testChunks.length,
      hold: holdChunks.length,
      nSub: members.length ? trainChunks.length - members[0].tauProbs.length : null,
    },
    members: members.map((m) => ({
      spec: m.spec, picked: m.picked, saved: m.saved, tauProbs: m.tauProbs,
      probs: m.probs,
    })),
    ts: {
      test: testChunks.map((c) => c.startTs),
      hold: holdChunks.map((c) => c.startTs),
    },
    labels: { test: testLabels, hold: holdChunks.map((c) => c.label) },
    score, nullScores, beat, pairs: nullN, lead: leadOver(score, nullScores),
    // WHAT THE UNIT WAS BUILT WITH, and each member read on its own question
    // (3.183.0). perMember is what makes a quiet member visible: its own score,
    // its own deals, and how often it actually spoke.
    extras, extraBandPcts, tooEarly,
    // and which extras belong together around a promoted row (3.203.0)
    plateaus,
    perMember: memberReadings({ members, specs, testChunks, seed, unitKey, nullN, tag: 's1' }),
    tuning,
    trainedOn: weightsSaid(p, weights, weightReading),
  };
}

// ---- TASK: one stage 2 unit ----------------------------------------------------
//
// Train ONLY the boost members for one carried unit; the logreg members'
// votes arrive in the payload from the stage 1 record set and are never
// retrained. Returns the boost members plus the unit's forecast score with
// the stage 1 members alone and with every member pooled.
async function s2UnitTask(task) {
  const { combo, geometry, s1, seed, unitKey, nullN, fee } = task;
  const p = { ...task.params, pinnedFiles: pinnedFilesFor(task.pin) };
  const { geo, maps, split, windows, extras, tooEarly } = await unitChunks(combo, geometry, p);
  const { trainChunks, testChunks, holdChunks } = split;
  // The stage 1 votes must be describing THESE chunks. Refuse a unit whose
  // stored timestamps disagree with the rebuild — a manifest mismatch should
  // make this impossible, but refusing beats guessing (decision record #14).
  const ts = testChunks.map((c) => c.startTs);
  const tsH = holdChunks.map((c) => c.startTs);
  if (ts.length !== s1.ts.test.length || ts.some((t, i) => t !== s1.ts.test[i])
    || tsH.length !== s1.ts.hold.length || tsH.some((t, i) => t !== s1.ts.hold[i])) {
    throw new Error('stage 1 votes do not line up with the rebuilt chunks — the price files changed underneath the set');
  }
  const plateaus = plateausOf(p, extras);
  const views = viewsFor(combo, geo, extras.length);
  const predictChunks = holdChunks.length ? [...testChunks, ...holdChunks] : testChunks;
  const specs = require('./bracketwork').memberSpecs('boost', combo.size, extras.length);
  // THE SAME WEIGHTING THE STAGE 1 HALF OF THIS COMMITTEE WAS TRAINED UNDER
  // (3.69.0). A stage 2 set copies its parent's settings at launch, so this
  // cannot differ -- half a committee trained on direction and half on money
  // would be two different committees wearing one name.
  const weights = weightsFor(p, trainChunks, fee);
  const weightReading = weightReadingFor(p, trainChunks, fee);
  const members = [];
  for (const spec of specs) {
    // the gate is applied and the direction is learned (3.201.0). labelOf stays
    // null: on the chunks it may answer, an extra is asked the unit's own
    // question, which is what the walk's two signs answer.
    // AN EXTRA TRAINS ON ITS OWN SHARE OF THE WHOLE HISTORY (3.202.0), the
    // parent's share, so both halves of the committee are cut the same way.
    const m = await trainGatedMember({
      spec, viewIdx: views[spec.view], trainChunks, testChunks, holdChunks, predictChunks, weights,
      weightsOf: (rows) => weightsFor(p, rows, fee), share: p.extraTrainShare, labelOf: null,
      whenThin: whenThinFor(spec, plateaus),
    });
    members.push({ spec, ...m });
  }
  const testLabels = testChunks.map((c) => c.label);
  const s1Test = s1.probs.map((mp) => mp.slice(0, testChunks.length));
  const boostTest = members.map((m) => m.probs.slice(0, testChunks.length));
  // THE POOLED SCORES POOL ONLY THE MEMBERS MARKED AGAINST THIS UNIT'S OWN BAND
  // (3.183.0). An extra member answers a different question, so pooling it in
  // would change what these two numbers mean and they have to stay comparable
  // with every set already on the box. Base members come first and extras are
  // appended, in both lists and in the same order, because memberSpecs builds
  // them that way and the child rebuilds with its parent's extras -- so the
  // extras are the last nx of each. Read on their own, just below. They still
  // VOTE: pooling is for the score, not for the vote.
  const nx = extras.length;
  const own = (arr) => (nx ? arr.slice(0, arr.length - nx) : arr);
  const score3 = forecastScore(own(s1Test), testLabels);
  const scoreAll = forecastScore([...own(s1Test), ...own(boostTest)], testLabels);
  // THE MERGED MEMBERS FACE THE PARENT'S NULL SET (3.46.0): the same deals the
  // stage 1 members were read against -- the parent's seed, the same unit, the
  // same tag, the same test length -- so 'beat its own null set' on the stage 2
  // table describes every member on the row, BOOST included. Before this the
  // stage 2 record copied the stage 1 numbers and the BOOST members never
  // faced a null set at all.
  const allTest = [...own(s1Test), ...own(boostTest)];
  const nullScores = [];
  for (let d = 0; d < nullN; d++) {
    const order = dealOrder(seed, unitKey, `s1#${d}`, testChunks.length);
    nullScores.push(forecastScore(allTest, testLabels, order));
  }
  let beat = 0;
  for (const s of nullScores) if (scoreAll > s) beat++;
  // and the tuning-slice money: the stage 1 members alone, which must come out
  // exactly as the parent recorded it, and every member pooled
  const tauAll = [...s1.tauProbs, ...members.map((m) => m.tauProbs)];
  const slice = tuningSliceOf(trainChunks, tauAll);
  const idx = (n) => Array.from({ length: n }, (_, i) => i);
  const priced = (use) => moneyAgainstNull({
    chunks: slice, calls: directionCalls(tauAll, use, slice.length), tradeMap: maps.trade, geo, fee, seed, unitKey, nullN,
  });
  const tuning3 = priced(idx(s1.tauProbs.length));
  const tuning = priced(idx(tauAll.length));
  return {
    members: members.map((m) => ({ spec: m.spec, picked: m.picked, saved: m.saved, tauProbs: m.tauProbs, probs: m.probs })),
    score3, scoreAll, helped: scoreAll - score3,
    beat, pairs: nullN, lead: leadOver(scoreAll, nullScores), nullScores,
    extras, extraBandPcts: split.extraBandPcts, tooEarly: tooEarly || 0,
    // EVERY MEMBER READ ON ITS OWN, BOTH HALVES (3.195.0, owner order: "the
    // logreg member votings get stored. the boost member votings get stored.
    // just identify the problem and do it right").
    //
    // This read only the members THIS stage trained -- the BOOST half. The
    // record's specs are the merged list, the parent's LOGREG half first and
    // this stage's after it, so a list covering only the second half would have
    // been read against the first: every BOOST reading shown against a LOGREG
    // member's name. Wrong numbers, silently, which is worse than the blank
    // columns that were there before.
    //
    // So both halves are read here, in the merged order, against the same test
    // chunks and each with its own deals. The parent's numbers are NOT copied
    // across: they were taken at stage 1 against stage 1's deals, and half a
    // column measured one way beside half measured another is not a column.
    // That is the same call the record already makes for beat, pairs and lead.
    //
    // The parent's probs and specs both ride in on the payload; without the
    // specs there is no way to know which answers a parent member was marked
    // against, and an extra member is marked against different ones.
    perMember: memberReadings({
      // THE PARENT'S EXTRA MEMBERS ARE READ ON THEIR OWN STRETCH TOO (3.202.0),
      // from the saved models the parent wrote, so a LOGREG extra and the BOOST
      // extra beside it are read on the same decisions. Read on the test slice
      // alone, half the column would be about a different stretch from the
      // other half, which is not a column.
      members: [...s1.probs.map((pr, mi) => {
        const sp = (s1.specs || [])[mi] || {};
        if (sp.at == null) return { probs: pr };
        const saved = (s1.saved || [])[mi];
        if (!saved) throw new Error(`the parent's record carries no saved model for extra ${sp.at + 1}, so it cannot be read on its own stretch`);
        return { probs: pr, saved, own: ownReadingOf({ saved, spec: sp, viewIdx: views[sp.view], trainChunks, testChunks, holdChunks, share: p.extraTrainShare }) };
      }), ...members],
      specs: [...(s1.specs || []), ...specs],
      testChunks,
      seed,
      unitKey,
      nullN,
      tag: 's2',
    }),
    tuning3, tuning,
    trainedOn: weightsSaid(p, weights, weightReading),
    windows,
    plateaus,
  };
}

// ---- TASK: one stage 3 unit ----------------------------------------------------
//
// Price every setting of the declared block for one unit, from the kept
// votes: derive each member's calls under the setting's decision (tau tuned
// from the stored probe votes at THIS run's fee), pool them at the agree
// count, mask 24/5 by chunk start time, and run the same simCell /
// holdControls the sweep engine prices with. The null set deals the kept
// votes once per draw — the same deals for every setting in the block.

// WHAT A REALISED AGREEMENT IS KEYED BY, in one place because two things
// read it: the pass that computes it, and the totalling that folds it onto
// every record. It depends on the unit and on the way of asking, and on
// NOTHING about the trade shape — which is why 329,280 settings on ten units
// need 600 numbers rather than 3.3 million.
// A SETTING'S QUORUM, in one shape, read from the setting itself. It reads
// exactly what is stored and translates nothing: a record set written before
// the bar became a dial is migrated to say so (RULE NINE), never interpreted.
const agrOf = (st) => ({
  rule: st.agreeRule || 'count',
  // A WAY OF WEIGHING THAT READS NO BAR KEEPS NOTHING WHERE THE BAR GOES.
  // Defaulting these to 'all' and 50 here would put a bar and a share back on
  // a setting that was written with neither, so the row would report numbers
  // the rule never looked at -- and the cache key would stop telling two
  // genuinely different settings apart the day a second no-bar rule exists.
  bar: agreement.READS_NO_BAR.has(st.agreeRule || 'count') ? null : (st.agreeBar === 'own' ? 'own' : 'all'),
  pct: agreement.READS_NO_BAR.has(st.agreeRule || 'count') ? null : (Number(st.agreePct) || 50),
  // how alike two members must be to count as one voice. Only the voices way
  // of weighing reads it, but it is part of the quorum's identity all the same
  // — a key that left it out would hand one setting's cached calls to another.
  copy: Number(st.agreeCopy) || agreement.COPY_DEFAULT,
  both: !!st.agreeBoth,
  persist: Math.max(0, Math.floor(Number(st.agreePersist) || 0)),
  // the plateau share (3.205.0): nothing on a run without plateaus, and part
  // of the quorum's identity on one with them
  plateau: st.plateauPct == null ? null : Number(st.plateauPct),
});
// THE KEY GROWS A SEGMENT ONLY WHERE A PLATEAU SHARE EXISTS (3.205.0), so every
// key written on disk before plateaus reads exactly as it did (RULE NINE: the
// agreed maps of every stage 3 set on the box are keyed by this).
const agreedKey = (decision, agr) => `${decision}|${agr.rule}|${agr.bar}|${agr.pct}|${agr.copy}|${agr.both ? 1 : 0}|${agr.persist}${agr.plateau == null ? '' : '|plateau' + agr.plateau}`;
// THE SAME KEY, BUILT THE SAME WAY. These were two expressions that had to
// agree and did not: one went through agrOf and one read the fields raw, so a
// row whose stored name differed from its resolved one missed its answer
// entirely. One of them is now the other.
const agreedKeyOfRecord = (r) => agreedKey(r.decision, agrOf(r));

// ---- THE UNREAD WINDOW, FORECAST BY THE SAVED MODELS (3.89.0, the reserve grade) ----
//
// The sealed 13% was cut away before anything trained, so no vote exists on it.
// Nothing is retrained: each member's saved model -- the stage 2 set keeps
// them, a straight-line model with its scaler or a boosted one with its trees
// -- is applied to the unread chunks' readings on the member's own view, and
// the probabilities are rounded exactly as the stored votes are, so a saved
// model applied to the test chunks gives the stored votes back (the test holds
// that equal).
// READ BACK AGAINST THE VECTOR IT WAS TRAINED ON (3.183.0). A member that reads
// an extra block needs the views built with that block present, or its column
// positions point at nothing. A spec with no `from`, or `from: 'own'`, is a base
// member and nothing changes for it.
function predictMember(saved, spec, chunks, combo, geo, nExtras = 0) {
  const views = viewsFor(combo, geo, nExtras);
  const viewIdx = views[(spec || {}).view || 'full'];
  if (!viewIdx) throw new Error(`no view called '${(spec || {}).view}' on this unit`);
  if (!saved || !saved.kind) throw new Error('a member without a saved model cannot forecast the unread window');
  return forecastRows(saved, viewIdx, chunks);
}
// the same forecast, on a slice already looked up (3.202.0): what a saved
// model says about each chunk, through the one arithmetic both callers share
function forecastRows(saved, viewIdx, chunks) {
  if (!saved || !saved.kind) throw new Error('a member without a saved model cannot forecast');
  // a member that could not be trained sits out on everything (3.203.0)
  if (saved.kind === 'silent') return chunks.map(() => SAT_OUT.slice());
  const X = chunks.map((c) => viewIdx.map((i) => c.x[i]));
  if (saved.kind === 'logreg') {
    const Z = standardizeApply(X, { mean: saved.mean, std: saved.std });
    return Z.map((z) => probsArr(predictLogreg({ W: saved.W, f: saved.f }, z).probs));
  }
  if (saved.kind === 'boost') return X.map((x) => probsArr(predictBoost({ priors: saved.priors, trees: saved.trees }, x).probs));
  throw new Error(`a saved model of kind '${saved.kind}' cannot forecast`);
}
// THE UNREAD WINDOW HAS A START AND NO END (decision 12): from where the seal
// began to whatever the box holds on the day. The pin covers what the chain
// was launched on; the unread window is everything after it, so it is built
// from the box's files as they are now, and only chunks whose whole trade
// fits inside what the box holds are kept (the chunk builder drops the rest).
// WHAT THE UNREAD WINDOW WAS PRICED ON, provably: the members' forecasts on
// that slice, hashed, so a grade carries which votes it read and a re-run
// with the saved models can be held to it (and so a test can tell forecasts
// from the saved models apart from stale votes on another window -- a guard
// found that nothing else could).
function forecastHashOf(probsPerMember) {
  return crypto.createHash('sha256').update(JSON.stringify(probsPerMember)).digest('hex').slice(0, 24);
}
// THE PRICES A CAPTURE IS PRICED ON AGAIN (3.92.0): the same files the chain
// was launched on, through the pin, so a tool run on Tune walks the candles the
// entries were captured from and nothing newer.
async function tradeMapFor(combo, geometry, params, pin) {
  const { geo, maps } = await unitChunks(combo, geometry, { ...(params || {}), pinnedFiles: pinnedFilesFor(pin) });
  return { geo, maps };
}
// WITH THE UNIT'S EXTRAS (3.206.1): the blocks are built so a member added
// from a walk set has its columns to read, and each extra's gate is marked on
// every chunk from the whole history behind it, exactly as stage 1 marks it,
// so the forecasts on the unread window can be shut where the gate is shut.
async function unreadChunksFor(combo, geometry, fromTs, extras = []) {
  const branch = { geometry, decision: 'argmax', band: 'auto', weekdaysOnly: false };
  const { geo, maps, chunks } = await buildCombo(combo, branch, { allLoaded: true, pinnedFiles: null, extras: Array.isArray(extras) ? extras : [] });
  if (Array.isArray(extras) && extras.length) markExtraGates(chunks, extras.map((e) => e.bandPct));
  const reachOf = (c) => c.startTs + geo.exitOffsetH * 3600000;
  const mine = chunks.filter((c) => c.startTs >= fromTs);
  let seenToTs = -Infinity;
  for (const ts of maps.trade.keys()) if (ts > seenToTs) seenToTs = ts;
  return { geo, maps, chunks: mine, toTs: mine.length ? reachOf(mine[mine.length - 1]) : null, seenToTs: Number.isFinite(seenToTs) ? seenToTs : null };
}

async function s3UnitTask(task) {
  const { combo, geometry, unit, settings, fee, nullN, seed, unitKey, agreedOnly = false } = task;
  const p = { ...task.params, pinnedFiles: pinnedFilesFor(task.pin) };
  // EVERY SETTING CARRIES ITS OWN PLACE IN THE BLOCK (3.52.0). A unit prices
  // only the settings that place different orders on it, so its list is not
  // the block and a position in the list says nothing; the record files under
  // the setting's block number, which rides on the setting itself.
  for (const st of (task.settings || [])) {
    if (!Number.isInteger(st.si) || st.si < 0) throw new Error(`the setting "${st.label}" was handed to a unit without its place in the block`);
  }
  // HOW MANY OF THE SCRAMBLES TO WRITE DOWN (owner order, 2026-08-31: "keep 10").
  // Never more than there are: a set swept with 4 scrambles cannot keep 10, and
  // silently keeping 4 while the set document claims 10 is how a reader ends up
  // averaging over an array shorter than it was told.
  const keep = Math.max(0, Math.min(Math.floor(Number(task.keepN) || 0), agreedOnly ? 0 : nullN));
  // A TOP-UP PRICES ONLY THE SCRAMBLES THE RECORDS DO NOT HOLD (owner order,
  // 2026-09-02: "a PROPER design would ADD the missing rows, not subject the
  // user to 6 hours of waiting again"). Scramble d is a pure function of the
  // set's id, so positions 0..from-1 already on disk are exactly what this
  // would price again; the loops below start at `from` and the row's arrays
  // hold positions from..keep-1 only. A fresh run has from = 0.
  const from = Math.max(0, Math.min(Math.floor(Number(task.keepFrom) || 0), keep));
  // THE BACKFILL MODE (owner order, 2026-08-31: "backfill included"). A set
  // priced before the kept scrambles existed can have them, because the
  // scrambles are a pure function of the set's id -- seedOf is a hash of the
  // name and the shuffle is a seeded Fisher-Yates, so scramble N is identical
  // every time, forever.
  //
  // It prices ONLY what is missing: the real test money as a proof that this is
  // still the same run, and the kept scrambles on both windows. It does NOT
  // re-price the real held-back money, the four hold controls, or the whole
  // null set -- those are already on disk and re-doing them would turn a
  // two-hour fill into a twelve-hour re-run.
  const noiseOnly = !!task.noiseOnly;
  const { geo, maps, split, windows, extras } = await unitChunks(combo, geometry, p);
  const { trainChunks, testChunks } = split;
  let { holdChunks } = split;
  const tsT = testChunks.map((c) => c.startTs);
  if (tsT.length !== unit.ts.test.length || tsT.some((t, i) => t !== unit.ts.test[i])) {
    throw new Error('stage 2 votes do not line up with the rebuilt chunks — the price files changed underneath the set');
  }
  // THE UNREAD WINDOW IN THE HELD-BACK WINDOW'S PLACE (3.89.0, the reserve
  // grade on a Stage 4 record set). Everything below prices the "hold" slice
  // exactly as stage 3 prices the held-back window -- the same calls, the same
  // deals drawn from the set's seed, the same four comparisons, the same rich
  // figures -- so the unread window is priced on the one path and cannot
  // disagree with it. Only three things change: which chunks the slice holds,
  // whose prices they are read from, and where the members' votes on them
  // come from (the saved models, since no vote was ever cast there). The test
  // slice, the committee's shape and every tau are untouched.
  let memberProbs = unit.probs;                         // per member: test+hold arrays
  let holdTrade = maps.trade;
  let holdMaps = maps;
  let dealSlice = 's3-hold';
  let unread = null;
  // THE TEST WINDOW ALONE (3.144.0, the retrain run on History; owner order
  // 2026-09-15: "not work with the held set. We'll keep it secret until
  // verify or tune"). With this flag the task holds no held-back chunks at
  // all, so every held-back figure below -- the money, the four comparisons,
  // the deals, the beat, the lead, the noise twins, the rich block -- is never
  // priced, not priced and dropped. The members' votes on the held-back slice
  // ride in unit.probs untouched and nothing here reads past the test slice.
  // It cannot be asked together with the unread window or the capture: both
  // of those ARE the held-back window's place.
  if (task.testOnly) {
    if (task.unread || task.capture) throw new Error('a pricing of the test window alone holds no held-back window, so it can neither grade the unread window nor capture trades');
    holdChunks = [];
  }
  // 3.150.0 (VERIFY-DESIGN.md Part 9 release 3, H3.2): the capture may be handed the
  // unread window too -- the hold slice below is then the reserve window, and the
  // entries it writes down are the reserve window's trades
  if (task.unread) {
    const got = await unreadChunksFor(combo, geometry, task.unread.fromTs, extras);
    if (got.chunks.length < 2) {
      throw new Error(`the unread window holds ${got.chunks.length} whole chunk(s) from ${new Date(task.unread.fromTs).toISOString().slice(0, 10)} to what the box holds — nothing to grade`);
    }
    holdChunks = got.chunks;
    holdTrade = got.maps.trade;
    holdMaps = got.maps;
    dealSlice = 's4-unread';
    const forecasts = (unit.members || []).map((m, mi) => {
      if (!m.saved) throw new Error(`member ${mi} carries no saved model, so it cannot forecast the unread window`);
      const f = predictMember(m.saved, m.spec, holdChunks, combo, geo, extrasInMembers(unit.members));
      // AN EXTRA'S GATE SHUTS ITS FORECASTS HERE TOO (3.206.1), as it shut its
      // votes on every window the set priced: a member that speaks only when
      // its look-back move clears its band cannot speak everywhere on the one
      // window nobody had read.
      const gate = gateOf(m.spec || {});
      return gate ? f.map((pr, k) => (gate(holdChunks[k]) ? pr : SAT_OUT.slice())) : f;
    });
    memberProbs = forecasts.map((f, mi) => [...unit.probs[mi].slice(0, testChunks.length), ...f]);
    // hashed from the votes the slice is PRICED on, never from the forecasts
    // alone: the two are one and the same only while nothing swaps them
    unread = { fromTs: task.unread.fromTs, toTs: got.toTs, chunks: holdChunks.length, seenToTs: got.seenToTs, forecastHash: forecastHashOf(memberProbs.map((mp) => mp.slice(testChunks.length))) };
  }
  // 24/5 mask: which test/hold positions start on a weekday the chunk
  // builder itself would keep. Read from the builder, not re-derived.
  const wkKeep = new Set(
    bracketLib.buildComboChunks(holdMaps, geometry, true).chunks.map((c) => c.startTs),
  );
  const maskIdx = (chunksArr) => chunksArr.map((c, i) => (wkKeep.has(c.startTs) ? i : -1)).filter((i) => i >= 0);
  const wkTest = maskIdx(testChunks);
  const wkHold = maskIdx(holdChunks);

  const nTest = testChunks.length;
  const takeSlice = (mp, idxs, offset) => idxs.map((i) => mp[offset + i]);

  // tau per member, tuned once per run fee from the stored probe votes on the
  // member's validation slice — the same tuneTau menu the engine has always
  // used (decision record #1).
  const taus = unit.members.map((m) => {
    const nSub = trainChunks.length - m.tauProbs.length;
    const valChunks = trainChunks.slice(nSub);
    if (valChunks.length !== m.tauProbs.length) {
      throw new Error('stored tau votes do not line up with the rebuilt validation slice');
    }
    return tuneTau(valChunks, m.tauProbs.map(probsObj), maps.trade, geo, fee).tau;
  });

  // Deal orders, shared by every setting (decision record #7): per slice so
  // a one-directional held-back window cannot pay the real arm for its lean.
  const deals = [];
  for (let d = 0; d < (agreedOnly ? 0 : nullN); d++) {
    deals.push({
      test: dealOrder(seed, unitKey, `s3-test#${d}`, testChunks.length),
      hold: dealOrder(seed, unitKey, `${dealSlice}#${d}`, holdChunks.length),
    });
  }

  // THE COMMITTEE, SHAPED ON ITS TEST SLICE, through the one definition both
  // this task and the live path call (lib/committee.js): calls from votes,
  // independent voices, each way of weighing's own bar, what is enough, the
  // stream. A null-set deal shuffles every member by the SAME order, so the
  // committee's own structure is untouched by it -- the shape is worked out
  // once from the real test slice and is correct for the deals too.
  // WITH ITS PLATEAUS FOLDED (3.205.0): each plateau is one voter per kind, at
  // the share each setting asks for, and a member marked silent on its spec is
  // left out of the fold as it was left out of the training.
  const speaking = new Set((unit.members || []).map((m, mi) => (m.spec && m.spec.silent ? -1 : mi)).filter((mi) => mi >= 0));
  const C = committee.committeeOn({ specs: (unit.members || []).map((m) => m.spec || {}), memberProbsTest: memberProbs.map((mp) => mp.slice(0, nTest)), taus, plateaus: unit.plateaus || [], speaking });
  const { models, families } = C;
  // The members' strengths, sliced and dealt exactly as their calls are, so
  // a rule that reads how strongly they lean sees the same moments in the
  // same order as a rule that only counts them.
  const probCache = new Map();
  const probsFor = (dealIdx, slice) => {
    const key = `${dealIdx}|${slice}`;
    if (probCache.has(key)) return probCache.get(key);
    const offset = slice === 'hold' ? nTest : 0;
    const len = slice === 'hold' ? holdChunks.length : nTest;
    const out = memberProbs.map((mp) => {
      const arr = new Array(len);
      for (let i = 0; i < len; i++) arr[i] = mp[offset + i];
      if (dealIdx >= 0) { const order = deals[dealIdx][slice]; return order.map((k) => arr[k]); }
      return arr;
    });
    probCache.set(key, out);
    return out;
  };
  // Calls per (decision, arm, slice), derived once and cached; quorum streams
  // per (calls, agree) likewise. Settings sharing a stream share the work.
  // THE VOTERS' CALLS AND LEANS, folded through the committee's own definition
  // at the plateau share a setting asks for (nothing to fold on a run without
  // plateaus, and then these are the members' own)
  const foldCache = new Map();
  const foldFor = (decision, dealIdx, slice, share) => {
    const key = `${decision}|${dealIdx}|${slice}|${share == null ? '' : share}`;
    if (foldCache.has(key)) return foldCache.get(key);
    const out = C.foldOf(probsFor(dealIdx, slice), decision, share);
    foldCache.set(key, out);
    return out;
  };
  const callsFor = (decision, dealIdx, slice, share = null) => foldFor(decision, dealIdx, slice, share).calls;
  const voicesFor = (decision, copy, share = null) => C.voicesFor(decision, copy, share);
  const denomFor = (agr, decision) => C.denomFor(agr, decision);
  const levelFor = (agr, decision) => C.levelFor(agr, decision);
  // The votes and the extras a rule reads, built once per way of asking.
  // Pulled out of streamFor so the agreement REACHED can be read off exactly
  // the same votes the rule read, rather than off a second copy that could
  // drift from it.
  const ctxCache = new Map();
  const ctxFor = (decision, agr, dealIdx, slice) => {
    const key = `${decision}|${agr.rule}|${agr.copy}|${agr.plateau == null ? '' : agr.plateau}|${dealIdx}|${slice}`;
    if (ctxCache.has(key)) return ctxCache.get(key);
    const f = foldFor(decision, dealIdx, slice, agr.plateau);
    const ctx = {
      calls: f.calls, models, families,
      probs: agreement.READS_LEANS.has(agr.rule) ? f.probs : null,
      weights: agr.rule === 'voices' ? voicesFor(decision, agr.copy, agr.plateau).weights : null,
    };
    ctxCache.set(key, ctx);
    return ctx;
  };

  const streamCache = new Map();
  const streamFor = (decision, agr, dealIdx, slice) => {
    // KEYED BY EVERY DIAL, THROUGH THE ONE DEFINITION OF WHAT A QUORUM IS.
    // This listed the dials by hand and the bar was added without it, so two
    // settings that differ only in their bar shared one cached stream: the
    // second was priced with the first's calls. Half of a swept grid would
    // have been a silent copy of the other half. Building the key from
    // agreedKey means a dial cannot be added to a quorum without arriving
    // here too.
    const key = `${agreedKey(decision, agr)}|${dealIdx}|${slice}`;
    if (streamCache.has(key)) return streamCache.get(key);
    const ctx = ctxFor(decision, agr, dealIdx, slice);
    const s = agreement.agreementStream(ctx, agr.rule, levelFor(agr, decision), { bothModels: agr.both, persist: agr.persist });
    streamCache.set(key, s);
    return s;
  };

  // HOW MUCH ACTUALLY AGREED, averaged over the moments this way of asking
  // spoke on the test slice, as a share of whatever the rule counts. Measured
  // on the TEST slice only, through the shared definition; cached per way of
  // asking, because which moments speak does not depend on the trade shape.
  const agreedCache = new Map();
  const agreedFor = (decision, agr) => {
    const key = agreedKey(decision, agr);
    if (agreedCache.has(key)) return agreedCache.get(key);
    const out = C.agreedOn(decision, agr);
    agreedCache.set(key, out);
    return out;
  };
  const pick = (arr, idxs) => idxs.map((i) => arr[i]);
  // THE CONFIRMATION OVERLAY (COINS.md section 11, 3.130.0). A unit handed a
  // lean reads every chunk's window colour at its sweet spot band by the same
  // arithmetic Coins uses (lib/windowmove.js), on the same candles this unit is
  // priced on, and the lean says which way a trade should go after each
  // colour. Against it a call is confirmed, unconfirmed or has no lean, and
  // the three kinds are priced by the one simulator each on their own so the
  // money can be scaled per kind and added back up: a trade at twice the size
  // is exactly twice the money, fees included, because the fee is a share of
  // the position. The rich figures (drawdown, wins, thirds) are read at size 1
  // from one pass over the trades actually taken.
  // THE LEAN IS A LIST OF ROWS (3.206.0): one for a unit whose coin and shape
  // pass on Coins, and every row of its plateau for a unit promoted from a
  // walk set -- each read at its own look-back and band against its own
  // yardstick, then folded at the setting's plateau share the way the vote is.
  const leanRows = task.lean ? (Array.isArray(task.lean.rows) ? task.lean.rows : [task.lean]) : [];
  const rowSignsFor = (chunksArr, tradeMap) => {
    if (!leanRows.length || !chunksArr.length) return null;
    // THE ROWS' OWN LOOK-BACKS (3.171.0, owner order). windowMoves has taken a
    // list of look-backs since 2026-09-17; every distinct one the rows name is
    // asked for at once. `own` IS A REAL VALUE here, not a missing one: it is
    // the shape's own span, which is exactly what wm.move is.
    const backOf = (row) => (row.lookback == null || row.lookback === 'own' ? null : Number(row.lookback));
    const backs = [...new Set(leanRows.map(backOf).filter((h) => h))];
    const wm = windowLib.windowMoves(tradeMap, geometry, backs);
    const at = new Map();
    for (let i = 0; i < wm.ts.length; i++) at.set(wm.ts[i], i);
    const idx = chunksArr.map((c) => at.get(c.startTs));
    return leanRows.map((row) => {
      const back = backOf(row);
      // A LOOK-BACK THE CANDLES CANNOT REACH IS NOT GUESSED. windowMoves leaves
      // a null where a decision has no candle that far behind it, and a whole
      // column of nulls means this unit cannot be read at that distance -- so
      // it falls back to the shape's own span.
      const series = back && wm.moves && Array.isArray(wm.moves[String(back)])
        && wm.moves[String(back)].some((v) => v != null) ? wm.moves[String(back)] : wm.move;
      const { reading } = windowLib.readingsUnderBand(series, row.band, row.yardstick);
      return confirmLib.leanSigns(idx.map((i) => (i == null ? 's' : reading[i])), row);
    });
  };
  const rowSignsTest = rowSignsFor(testChunks, maps.trade);
  const rowSignsHold = rowSignsFor(holdChunks, holdTrade);
  // the unit's lean on a window at a plateau share, folded once per share
  const foldedLean = new Map();
  const leanFor = (slice, share) => {
    const rows = slice === 'hold' ? rowSignsHold : rowSignsTest;
    if (!rows) return null;
    const pct = rows.length > 1 ? (share == null ? 50 : Number(share)) : 100;
    const key = `${slice}|${pct}`;
    if (!foldedLean.has(key)) foldedLean.set(key, confirmLib.foldLeanSigns(rows, pct));
    return foldedLean.get(key);
  };
  // price a window under a setting: plain when the setting is off or the unit
  // has no lean; split three ways otherwise. `wantRich` adds the one pass at
  // size 1 the rich figures are read from.
  const priceLean = (cell, chunksArr, idxs, callsAll, tradeMap, signsAll, st, bandPct, wantRich) => priceLeanWindow(
    cell, pick(chunksArr, idxs), pick(callsAll, idxs), tradeMap, geo, bandPct, fee, signsAll ? pick(signsAll, idxs) : null, st, wantRich,
  );
  // THE FIELD ON THIS UNIT (FIELD-DESIGN.md section F): the per-day series
  // the launch froze beside the set, and every chunk's decision instant on
  // each window -- the instant lib/windowmove.js takes the decision at, so a
  // chunk reads the field day it was built on. A unit the field has no pair
  // for prices plain, and every value of the gate is one setting on it.
  const fieldDays = task.field && task.field.days ? fieldGate.daysFromColumns(task.field.days) : null;
  const decisionTsOf = (chunksArr, tradeMap) => chunksArr.map((c) => windowLib.decisionAt(tradeMap, c.startTs, geo).ts);
  const fieldTsTest = fieldDays ? decisionTsOf(testChunks, maps.trade) : null;
  const fieldTsHold = fieldDays && holdChunks.length ? decisionTsOf(holdChunks, holdTrade) : null;
  const priceField = (cell, chunksArr, idxs, callsAll, tradeMap, tsAll, gate, bandPct, wantRich) => priceFieldWindow(
    pick(callsAll, idxs), pick(tsAll, idxs), fieldDays, gate,
    (list) => bracketLib.simCell(cell, pick(chunksArr, idxs), list, tradeMap, geo, bandPct, fee), wantRich,
  );
  // THE PER-TRADE CAPTURE (3.92.0, Tune on a Stage 4 record set; VERIFY-DESIGN.md
  // section 9 step 8). The two tools on Tune take a LIST of entries -- the hour,
  // the side, how many members called that side -- and price them themselves;
  // the record holds money per window and never the trades. When asked, every
  // moment the rule spoke is written down here, on three slices: the test and
  // held-back slices from the stored votes on the real calendar (deal -1, the
  // same streams the pricing above reads), and the training slice from the
  // members forecasting their OWN training chunks with their saved models --
  // in-sample on purpose, as the older tools read it: a protective stop wants
  // the deepest a winner ever dipped over all data. The committee's shape and
  // every tau stay the test slice's. Each entry carries the one simulator's own
  // money for that trade, priced on that chunk alone, so the population is
  // exactly the simulator's (an invented entry candle or a missing exit drops
  // out here as it does there) and the list can be held to the record to the
  // cent. Only a market entry with no trailing stop is captured: those are the
  // only trades the two tools price.
  const wkTrain = maskIdx(trainChunks);
  let trainProbsMemo = null;
  const trainProbs = () => {
    if (trainProbsMemo) return trainProbsMemo;
    trainProbsMemo = (unit.members || []).map((m, mi) => {
      if (!m.saved) throw new Error(`member ${mi} carries no saved model, so it cannot forecast its own training window`);
      return predictMember(m.saved, m.spec, trainChunks, combo, geo, extrasInMembers(unit.members));
    });
    return trainProbsMemo;
  };
  const trainStreamCache = new Map();
  const trainCallsCache = new Map();
  const trainStreamFor = (decision, agr) => {
    const key = agreedKey(decision, agr);
    if (!trainStreamCache.has(key)) trainStreamCache.set(key, C.streamOf(decision, agr, trainProbs()));
    return trainStreamCache.get(key);
  };
  // the voters' calls on the training slice, folded at the setting's plateau
  // share like every other slice's (3.205.0)
  const trainCallsFor = (decision, share = null) => {
    const key = `${decision}|${share == null ? '' : share}`;
    if (!trainCallsCache.has(key)) trainCallsCache.set(key, C.foldOf(trainProbs(), decision, share).calls);
    return trainCallsCache.get(key);
  };
  const captureOf = (st, agr, cell, bandPct, weekdaysOnly) => {
    const idxOf = (chunksArr, wk) => (weekdaysOnly ? wk : chunksArr.map((_, i) => i));
    const slices = [
      ['train', trainChunks, idxOf(trainChunks, wkTrain), maps.trade, () => trainStreamFor(st.decision, agr), () => trainCallsFor(st.decision, agr.plateau)],
      ['test', testChunks, idxOf(testChunks, wkTest), maps.trade, () => streamFor(st.decision, agr, -1, 'test'), () => callsFor(st.decision, -1, 'test', agr.plateau)],
      ['hold', holdChunks, idxOf(holdChunks, wkHold), holdTrade, () => streamFor(st.decision, agr, -1, 'hold'), () => callsFor(st.decision, -1, 'hold', agr.plateau)],
    ];
    const out = {};
    for (const [name, chunksArr, idxs, tradeMap, streamOfSlice, memberCallsOfSlice] of slices) {
      const list = [];
      if (chunksArr.length) {
        const stream = streamOfSlice();
        const per = memberCallsOfSlice();
        for (const i of idxs) {
          const call = stream[i];
          if (call !== 1 && call !== -1) continue;
          // the one simulator, on this chunk alone: its money, and whether it took the trade at all
          const one = bracketLib.simCell(cell, [chunksArr[i]], [call], tradeMap, geo, bandPct, fee);
          if (one.trades !== 1) continue;
          let agree = 0;
          for (const m of per) if (m[i] === call) agree++;
          list.push({ ts: chunksArr[i].startTs + (geo.entryOffsetH || 0) * 3600000, side: call === 1 ? 'LONG' : 'SHORT', agree, usd: one.pnl });
        }
      }
      out[name] = list;
    }
    return out;
  };
  const captureShapeOk = (st) => st.entry === 'market' && (st.trailMult ?? null) == null;
  const holdCtlCache = new Map();
  const holdControlsFor = (chunksArr, idxs, tHours, cacheKey) => {
    const key = `${cacheKey}|${tHours}`;
    if (holdCtlCache.has(key)) return holdCtlCache.get(key);
    const h = bracketLib.holdControls(pick(chunksArr, idxs), holdTrade, geo, tHours, fee);
    holdCtlCache.set(key, h);
    return h;
  };
  // THE SAME FOUR ON THE TEST WINDOW (3.107.0, owner order 2026-09-10: build
  // them on the Funnel "in place of the held-back window info we are
  // removing"). Until now the four existed only against held-back money, so
  // the one question that settles whether money came from the forecast or from
  // the coin's direction could not be asked until the held-back window had
  // been opened -- which is after the choosing is done.
  //
  // ONLY WHEN ASKED. Four more simulations per unit and per hold length is real
  // work on a nine-hour launch and nothing on a launch reads them, so the
  // caller has to ask: the rebuild does, the launch does not.
  const testCtlCache = new Map();
  const testControlsFor = (chunksArr, idxs, tHours, cacheKey) => {
    const key = `${cacheKey}|${tHours}`;
    if (testCtlCache.has(key)) return testCtlCache.get(key);
    const h = bracketLib.holdControls(pick(chunksArr, idxs), holdTrade, geo, tHours, fee);
    testCtlCache.set(key, h);
    return h;
  };

  // Every distinct way of asking in this block, each answered once.
  const agreedMapFor = (list) => {
    const out = {};
    for (const st of list) {
      const agr = agrOf(st);
      const key = agreedKey(st.decision, agr);
      if (out[key]) continue;
      out[key] = agreedFor(st.decision, agr);
    }
    return out;
  };
  // THE BACKFILL DOOR (owner order, 2026-08-29). A set priced before this was
  // measured can still have it: the votes are on its stage 2 parent and the
  // answer never depended on the trade shape. This rebuilds the same unit and
  // walks the same streams, and prices nothing at all.
  if (agreedOnly) return { agreed: agreedMapFor(settings), counts: { test: testChunks.length, hold: holdChunks.length } };

  const rows = [];
  for (let si = 0; si < settings.length; si++) {
    const st = settings[si];
    const stream = st;                                   // decision / band / weekdaysOnly ride on the setting
    const bandPct = stream.band === 'auto' ? unit.bandPct : Math.abs(Number(stream.band));
    const tIdx = stream.weekdaysOnly ? wkTest : testChunks.map((_, i) => i);
    const hIdx = stream.weekdaysOnly ? wkHold : holdChunks.map((_, i) => i);
    const agr = agrOf(st);
    // t IS RESOLVED AGAINST THIS UNIT, HERE, ONCE (3.72.0). A setting asking
    // for the chunk's own hold length means 60 hours on a weekly unit and 17
    // or 41 on a daily one, and this is the only place that knows which unit
    // is being priced. Every use below reads this number -- the trade, the
    // four hold controls it is measured against, and the figure the record
    // keeps -- so none of them can be priced at one hold and reported at
    // another. An explicit number passes through untouched.
    const tHours = bracketLib.tHoursOn(st.tHours, geometry);
    const cell = { entry: st.entry, gate: st.gate, dMult: st.dMult, tHours, trailMult: st.trailMult ?? null, armMult: st.armMult ?? null };
    const testCallsAll = streamFor(stream.decision, agr, -1, 'test');
    // THE GATE TAKES THE LEAN'S PLACE on a setting that carries one and a unit
    // the field covers; the launch refuses confirm and the field together
    const gated = !!(st.field && fieldDays);
    const priceOn = (chunksArr, idxs, calls, tradeMap, slice, wantRich) => (gated
      ? priceField(cell, chunksArr, idxs, calls, tradeMap, slice === 'hold' ? fieldTsHold : fieldTsTest, st.field, bandPct, wantRich)
      : priceLean(cell, chunksArr, idxs, calls, tradeMap, leanFor(slice, st.plateauPct), st, bandPct, wantRich));
    const tPriced = priceOn(testChunks, tIdx, testCallsAll, maps.trade, 'test', true);
    const tRes = tPriced.res;
    // THE KEPT SCRAMBLES ON THE TEST WINDOW (FUNNEL-DESIGN.md 4.5). Together
    // these build a complete second copy of Table 3.A and Table 3.B out of
    // luck alone, so every reading the Funnel takes on the real table can be
    // taken again where nothing is real.
    //
    // THIS IS WHERE THE COST IS, and the design had it backwards. Nothing has
    // ever scrambled the test window -- every call above passes deal index -1,
    // the real calendar -- so each of these is a pricing that did not happen
    // before. The held-back ones further down are free by comparison: the beat
    // loop already prices them and throws the money away.
    //
    // The Funnel reads TEST money on purpose (FUNNEL-DESIGN.md 2, 10) so the
    // held-back window stays sealed until step 7. A noise twin drawn from the
    // held-back window would open the seal to decide what to look at, which is
    // the one thing the whole design exists to prevent.
    const noiseTest = [];
    for (let d = from; d < keep; d++) {
      const dt = streamFor(stream.decision, agr, d, 'test');
      const dRes = priceOn(testChunks, tIdx, dt, maps.trade, 'test', false).res;
      noiseTest.push(cents(dRes.pnl));
    }
    // THE KEPT SCRAMBLES ON THE HELD-BACK WINDOW. In a normal run these cost
    // nothing: the beat loop below prices them anyway and drops the money the
    // moment the count is taken. In a backfill there is no beat loop, so they
    // are priced here and are half of what the fill costs.
    const noiseHold = [];
    if (noiseOnly) {
      for (let d = from; d < keep && holdChunks.length; d++) {
        const dh = streamFor(stream.decision, agr, d, 'hold');
        noiseHold.push(cents(priceOn(holdChunks, hIdx, dh, holdTrade, 'hold', false).res.pnl));
      }
      // The label rides along so the merge joins on a name, never on a position.
      // Setting indexes are per block and two blocks both start at zero.
      rows.push({ si: st.si, label: st.label, pnl: tRes.pnl, noiseTest, noiseHold: holdChunks.length ? noiseHold : null });
      continue;
    }
    let holdout = null;
    let beat = 0;
    let lead = null;
    let holdRich = null;
    let dealShape = null;
    let controls = null;
    let holdLean = null;
    let holdField = null;
    if (holdChunks.length) {
      const holdCallsAll = streamFor(stream.decision, agr, -1, 'hold');
      const hPriced = priceOn(holdChunks, hIdx, holdCallsAll, holdTrade, 'hold', true);
      const hRes = hPriced.res;
      if (hPriced.parts) holdLean = { parts: hPriced.parts, size: hPriced.size };
      if (hPriced.field) holdField = hPriced.field;
      const hc = holdControlsFor(holdChunks, hIdx, tHours, stream.weekdaysOnly ? 'wk' : 'all');
      holdout = {
        pnl: hRes.pnl, trades: hRes.trades, stops: hRes.stops,
        vsAlwaysLong: hRes.pnl - hc.alwaysLong,
      };
      holdRich = richOf(hRes);
      // ALL FOUR CONTROLS, NOT ONE. lib/bracket.js:344 — "you did not find a
      // strategy, you found an asset that went up ... put long-and-hold and
      // short-and-hold on the same window and make the strategy beat them."
      // They are cached per unit and per t, so this is three subtractions.
      controls = {
        alwaysLong: hc.alwaysLong ?? null,
        alwaysShort: hc.alwaysShort ?? null,
        buyHold: hc.buyHold ?? null,
        shortHold: hc.shortHold ?? null,
        vsAlwaysShort: hc.alwaysShort == null ? null : hRes.pnl - hc.alwaysShort,
        vsBuyHold: hc.buyHold == null ? null : hRes.pnl - hc.buyHold,
        vsShortHold: hc.shortHold == null ? null : hRes.pnl - hc.shortHold,
      };
      const dealPnls = [];
      for (let d = 0; d < nullN; d++) {
        const dh = streamFor(stream.decision, agr, d, 'hold');
        const dRes = priceOn(holdChunks, hIdx, dh, holdTrade, 'hold', false).res;
        dealPnls.push(dRes.pnl);
        // FREE, unlike the test ones above: this pricing happens either way to
        // work out beat, and today its money is dropped the moment the count is
        // taken. Step 7 and Verify's board null want it.
        if (d >= from && d < keep) noiseHold.push(cents(dRes.pnl));
        if (hRes.pnl > dRes.pnl) beat++;
      }
      // the same one rule stage 1 reads by (decision record #6): how far the
      // real held-back money sits above the deals' typical, against their spread
      lead = leadOver(hRes.pnl, dealPnls);
      dealShape = shapeOf(dealPnls);
    }
    const captured = task.capture && captureShapeOk(st) ? captureOf(st, agr, cell, bandPct, !!stream.weekdaysOnly) : null;
    // and the four on the TEST window, once per unit and hold length, only when
    // the caller asked for them (3.107.0)
    if (task.wantTestControls && testChunks.length) testControlsFor(testChunks, tIdx, tHours, stream.weekdaysOnly ? 'wk' : 'all');
    rows.push({
      si: st.si,
      label: st.label,
      decision: stream.decision,
      bandMode: stream.band === 'auto' ? 'auto' : Number(stream.band),
      weekdaysOnly: !!stream.weekdaysOnly,
      bandPct,
      // THE RECORD KEEPS THE HOLD IT WAS ACTUALLY PRICED AT, never the word
      // that asked for it -- the same way it keeps bandPct beside bandMode. So
      // the t column, the t filters and the Funnel's t dial go on reading
      // plain hours, and no record already on disk changes shape (RULE NINE).
      // Which setting asked for it is on the setting's own name.
      entry: st.entry, gate: st.gate, dMult: st.dMult ?? null, tHours,
      trailMult: st.trailMult ?? null, armMult: st.armMult ?? null,
      agreeRule: agr.rule, agreeBar: agr.bar, agreePct: agr.pct, agreeCopy: agr.copy,
      agreeBoth: agr.both, agreePersist: agr.persist,
      // THE PLATEAU SHARE IS ON THE RECORD (3.206.2). It is part of the way of
      // asking -- agreedKey ends in it -- and the record is what the totalling
      // keys its answer back with, so a record without it looked its answer up
      // under a name the answer was never filed under: every record on a
      // walk-set chain missed, and share that agreed was a dash on all three
      // tables with no note, because the answers were there. null on a setting
      // without a plateau, which keeps every key written before plateaus
      // exactly as it was (RULE NINE).
      plateauPct: agr.plateau,
      rung: levelFor(agr, stream.decision),
      members: memberProbs.length, voices: voicesFor(stream.decision, agr.copy).voices,
      pnl: tRes.pnl, trades: tRes.trades,
      holdout,
      // THE CONFIRMATION OVERLAY (3.130.0): the dial's value on every row; the
      // six numbers and the verdict per window on a row priced with a lean
      confirm: st.confirm || 'off',
      lean: tPriced.parts ? {
        kx: tPriced.kx, ux: tPriced.ux,
        test: partsCents(tPriced.parts), testSize: tPriced.size,
        hold: holdLean ? partsCents(holdLean.parts) : null, holdSize: holdLean ? holdLean.size : null,
      } : null,
      verdict: tPriced.parts ? {
        test: confirmLib.verdictOf(tPriced.parts, tPriced.kx, tPriced.ux, tPriced.zx),
        hold: holdLean ? confirmLib.verdictOf(holdLean.parts, tPriced.kx, tPriced.ux, tPriced.zx) : null,
      } : null,
      // THE FIELD'S GATE (FIELD-DESIGN.md section F): the gate this row was
      // priced under and its numbers per window; null on a row without one,
      // which keeps every record written before the field exactly as it was
      field: tPriced.field ? {
        ...fieldGate.gateRecord(st.field),
        test: fieldGate.totalsCents(tPriced.field), hold: holdField ? fieldGate.totalsCents(holdField) : null,
      } : null,
      fieldVerdict: tPriced.field ? {
        test: fieldGate.verdictOf(tPriced.field), hold: holdField ? fieldGate.verdictOf(holdField) : null,
      } : null,
      beat, pairs: holdChunks.length ? nullN : 0, lead,
      // ALWAYS PRESENT, null when nothing was kept. The row store's columns
      // only ever grow and a row written before a growth reads back short, so
      // a column that appears halfway through a run would split one set into
      // two shapes -- the two-vocabularies-on-disk fault RULE NINE forbids.
      noiseTest: keep ? noiseTest : null,
      noiseHold: keep && holdChunks.length ? noiseHold : null,
      // EVERYTHING THE PRICING ALREADY WORKED OUT AND USED TO THROW AWAY
      // (FUNNEL-DESIGN.md section 4.2). It is computed on the one path, so a
      // rebuild and a fresh run cannot disagree — and it is NOT stored: both
      // writers project it away through storedRecordOf, because stage 3's job
      // is to price the grid and these are analysis inputs (ruling 4).
      rich: {
        test: richOf(tRes),
        hold: holdRich,
        controls,
        dealShape,
        periods: {
          test: testChunks.length,
          hold: holdChunks.length,
          testPriced: tIdx.length,
          holdPriced: hIdx.length,
        },
        // the per-trade capture (3.92.0), only when asked and only for a shape the tools price
        capture: captured,
      },
    });
  }
  // THE FOUR THINGS A RULE HAS TO BEAT, KEPT BESIDE THE SET (3.70.0, owner
  // order 2026-09-05). They were worked out here already and thrown away with
  // the rest of the analysis block, so nothing on any screen ever showed them.
  //
  // They belong beside the set and not on 329,280 records, because they do not
  // depend on the setting at all: being long every period, being short every
  // period, buying and holding, and shorting and holding are properties of the
  // UNIT's held-back window and the horizon. That is exactly what this cache
  // already holds, keyed the way it was filled -- 24/7 or 24/5, and the hold
  // length -- so handing it back costs nothing.
  const controls = {};
  for (const [k, v] of holdCtlCache) controls[k] = v;
  // and the same four read on the TEST window, empty unless the caller asked
  const testControls = {};
  for (const [k, v] of testCtlCache) testControls[k] = v;
  return {
    rows, agreed: agreedMapFor(settings), controls, testControls, windows,
    counts: { test: testChunks.length, hold: holdChunks.length },
    // set only when the unread window was priced in the held-back window's place (3.89.0)
    unread,
  };
}

// ---- the stage 3 tally, foldable and shardable --------------------------------
//
// ONE folding rule for the stage 3 tables, expressed once and used by both
// the single-pass build and the sharded build (owner order, 2026-08-27:
// "yes" to multithreading the totalling). Sums are commutative, the block
// sets are unions, and the finishing sort happens after the merge — so the
// sharded answer is the single-pass answer, and a test holds the two equal.
// THE KEPT SCRAMBLES ARE SUMMED ELEMENTWISE, and index order is load-bearing:
// scramble 3 of one setting shares its calendar with scramble 3 of every other
// setting on the same unit, which is the only reason a whole all-luck copy of
// the tables means anything. Adding position 3 to position 4 would silently
// average across different calendars and still look like a number.
//
// ONE DEFINITION, used by the fold, by the shard merge and by the drain,
// because those three have to agree and three hand-written index loops is
// three chances to disagree.
function addNoiseRow(into, key, arr) {
  if (!Array.isArray(arr) || !arr.length) return;
  let sums = into[key];
  if (!sums) { sums = new Array(arr.length).fill(0); into[key] = sums; into[key + 'N'] = 0; }
  const n = Math.min(sums.length, arr.length);
  for (let i = 0; i < n; i++) if (arr[i] != null) sums[i] += arr[i];
  into[key + 'N'] += 1;
}
function mergeNoise(into, key, addSums, addN) {
  if (!Array.isArray(addSums) || !addSums.length) return;
  let sums = into[key];
  if (!sums) { sums = new Array(addSums.length).fill(0); into[key] = sums; into[key + 'N'] = 0; }
  const n = Math.min(sums.length, addSums.length);
  for (let i = 0; i < n; i++) sums[i] += addSums[i];
  into[key + 'N'] += addN || 0;
}
// The mean per scramble across a list of cells. Returns null rather than an
// array of nulls when nothing was kept, so a reader tests one thing.
function meanNoise(cells, key) {
  let width = 0;
  for (const c of cells) if (c[key] && c[key].length > width) width = c[key].length;
  if (!width) return null;
  const out = new Array(width).fill(0);
  const seen = new Array(width).fill(0);
  for (const c of cells) {
    const sums = c[key]; const n = c[key + 'N'] || 0;
    if (!sums || !n) continue;
    for (let i = 0; i < Math.min(width, sums.length); i++) { out[i] += sums[i] / n; seen[i]++; }
  }
  for (let i = 0; i < width; i++) out[i] = seen[i] ? Math.round((out[i] / seen[i]) * 100) / 100 : null;
  return out;
}
function newTallyAcc() {
  // agreedHit / agreedMiss (3.206.2): how many records found their answer in
  // the kept agreement table and how many looked and found nothing. A table
  // that is there and that NO record finds is keyed differently from the
  // records, and the totalling says so instead of leaving a dash.
  return { perSetting: new Map(), perCoin: new Map(), rows: 0, agreedHit: 0, agreedMiss: 0 };
}
function tallyFold(acc, r, blockIdx, agreedAt = null) {
  // What the members ACTUALLY did, looked up by the unit and the way of
  // asking. It is not on the record: 329,280 settings on ten units share 600
  // answers between them, so it is kept once per answer and joined here.
  const agreed = agreedAt ? agreedAt[`${r.u}|${agreedKeyOfRecord(r)}`] : null;
  if (agreedAt) { if (agreed) acc.agreedHit++; else acc.agreedMiss++; }
  let s = acc.perSetting.get(r.si);
  if (!s) {
    s = { si: r.si, label: r.label,
      decision: r.decision, bandMode: r.bandMode, weekdaysOnly: r.weekdaysOnly,
      entry: r.entry, gate: r.gate, dMult: r.dMult, tHours: r.tHours, trailMult: r.trailMult, armMult: r.armMult,
      // null, never undefined: undefined vanishes through the worker boundary
      // and the sharded fold would then disagree with the single-pass one on a
      // field neither of them actually used
      agreeRule: r.agreeRule ?? null, agreeBar: r.agreeBar ?? null, agreePct: r.agreePct ?? null,
      agreeCopy: r.agreeCopy ?? null,
      agreeBoth: r.agreeBoth ?? null, agreePersist: r.agreePersist ?? null,
      // the plateau share the setting was priced under (3.206.2): quorum by on
      // the ranked table and the Funnel's dial read it off this row
      plateauPct: r.plateauPct ?? null,
      members: r.members ?? null,
      perCoin: new Map() };
    acc.perSetting.set(r.si, s);
  }
  // the confirm dial and its multipliers ride the setting; the six numbers of
  // the overlay are summed per coin (3.130.0)
  if (s.confirm === undefined) { s.confirm = r.confirm ?? 'off'; s.kx = r.lean ? r.lean.kx : null; s.ux = r.lean ? r.lean.ux : null; }
  // the field's gate rides the setting too (FIELD-DESIGN.md section F)
  // the WHOLE gate, both bars (3.220.3): this copied a one-bar shape the
  // record stopped carrying at 3.218.0, so the ranked row's gate had no bars
  if (s.field === undefined) s.field = r.field ? fieldGate.gateRecord(r.field) : null;
  let c = s.perCoin.get(r.trade);
  if (!c) { c = { test: 0, testN: 0, ttr: 0, ttrN: 0, hold: 0, holdN: 0, trades: 0, vsl: 0, vsln: 0, beat: 0, pairs: 0, ld: 0, ldN: 0, rung: 0, rungN: 0, voices: 0, voicesN: 0, agr: 0, agrN: 0 }; s.perCoin.set(r.trade, c); }
  c.test += r.pnl || 0; c.testN++;
  // the test-window trade count (3.131.0): what the Funnel's trade floor reads
  // on a board read on all units together, whose rows are these totals
  if (r.trades != null) { c.ttr += Number(r.trades) || 0; c.ttrN++; }
  if (r.lean) { c.lp = confirmLib.addParts(c.lp || null, r.lean.test); if (r.lean.hold) c.hlp = confirmLib.addParts(c.hlp || null, r.lean.hold); }
  if (r.field && r.field.test) { c.fp = fieldGate.addTotals(c.fp || null, r.field.test); if (r.field.hold) c.fhp = fieldGate.addTotals(c.fhp || null, r.field.hold); }
  if (r.rung != null) { c.rung += r.rung; c.rungN++; }
  if (r.voices != null) { c.voices += r.voices; c.voicesN++; }
  // records priced before this measurement existed simply have no value here,
  // and a column with no value reads as absent rather than as zero
  if (agreed && agreed.agreed != null) { c.agr += agreed.agreed; c.agrN++; }
  if (r.holdout && r.holdout.pnl != null) {
    c.hold += r.holdout.pnl; c.holdN++;
    c.trades += r.holdout.trades || 0;
    if (r.holdout.vsAlwaysLong != null) { c.vsl += r.holdout.vsAlwaysLong; c.vsln++; }
  }
  c.beat += r.beat || 0; c.pairs += r.pairs || 0;
  if (r.lead != null) { c.ld += r.lead; c.ldN++; }
  addNoiseRow(c, 'nt', r.noiseTest);
  addNoiseRow(c, 'nh', r.noiseHold);

  const cellLabel = r.label.split(' · ')[0];
  // THE CONFIRM DIAL IS PART OF THE COIN ROW'S KEY (3.131.0): the short
  // setting factors out decision, band and 24/5 -- and it factored out confirm
  // too, so one coin row summed the same six numbers once per value and
  // judged them by whichever value's multipliers came first. One row per
  // value now, each with its own six numbers and its own word.
  const confirm = r.confirm || 'off';
  // AND THE FIELD'S GATE IS PART OF IT TOO (FIELD-DESIGN.md section F), for
  // the same reason: one coin row per value, each with its own numbers
  const fieldLabel = r.field ? fieldGate.gateLabel(r.field) : '';
  const ck = `${cellLabel}|${r.trade}|${r.ctx1 || ''}|${r.ctx2 || ''}|${r.geometry}|${confirm}|${fieldLabel}`;
  let k = acc.perCoin.get(ck);
  if (!k) {
    k = { cellLabel, trade: r.trade, ctx1: r.ctx1, ctx2: r.ctx2, geometry: r.geometry, confirm, fieldLabel,
      field: r.field ? fieldGate.gateRecord(r.field) : null,
      beat: 0, pairs: 0, test: 0, testN: 0, ttr: 0, ttrN: 0, hold: 0, holdN: 0, trades: 0, tradesN: 0, vsl: 0, vsln: 0,
      agr: 0, agrN: 0, rows: 0, b: new Set() };
    acc.perCoin.set(ck, k);
  }
  k.rows++;
  if (agreed && agreed.agreed != null) { k.agr += agreed.agreed; k.agrN++; }
  k.beat += r.beat || 0; k.pairs += r.pairs || 0;
  k.test += r.pnl || 0; k.testN++;
  // the test-window trade count per coin row (3.207.0): what avg test trades
  // on the every-coin table reads
  if (r.trades != null) { k.ttr += Number(r.trades) || 0; k.ttrN++; }
  if (r.lean) { k.lp = confirmLib.addParts(k.lp || null, r.lean.test); if (r.lean.hold) k.hlp = confirmLib.addParts(k.hlp || null, r.lean.hold); if (k.kx == null) { k.kx = r.lean.kx; k.ux = r.lean.ux; } }
  if (r.field && r.field.test) { k.fp = fieldGate.addTotals(k.fp || null, r.field.test); if (r.field.hold) k.fhp = fieldGate.addTotals(k.fhp || null, r.field.hold); }
  if (r.holdout && r.holdout.pnl != null) {
    k.hold += r.holdout.pnl; k.holdN++;
    k.trades += r.holdout.trades || 0; k.tradesN++;
    if (r.holdout.vsAlwaysLong != null) { k.vsl += r.holdout.vsAlwaysLong; k.vsln++; }
  }
  addNoiseRow(k, 'nt', r.noiseTest);
  addNoiseRow(k, 'nh', r.noiseHold);
  k.b.add(blockIdx);
  acc.rows++;
}
// Across-thread shapes: Maps and Sets do not survive the worker boundary, so
// a shard hands back plain arrays and the merge folds them into the same
// accumulator shape the single pass builds.
// ONE WINDOW PRICED UNDER THE LEAN (3.130.0, COINS.md section 11). Plain when
// the setting is off or the unit has no lean -- byte for byte what every run
// before this release priced. Otherwise the calls are split three ways
// (confirmed, unconfirmed, no lean), each part is priced by the one simulator
// on its own, and the money is scaled per part and added back up. `wantRich`
// adds the one pass at size 1 over the trades actually taken, which the rich
// figures (drawdown, wins, thirds) are read from; the noise copies skip it.
function priceLeanWindow(cell, ch, calls, tradeMap, geo, bandPct, fee, signs, st, wantRich) {
  const confirm = (st && st.confirm) || 'off';
  if (!signs || confirm === 'off') return { res: bracketLib.simCell(cell, ch, calls, tradeMap, geo, bandPct, fee), parts: null };
  const { c, u, z } = confirmLib.splitCalls(calls, signs);
  const rc = bracketLib.simCell(cell, ch, c, tradeMap, geo, bandPct, fee);
  const ru = bracketLib.simCell(cell, ch, u, tradeMap, geo, bandPct, fee);
  const rz = bracketLib.simCell(cell, ch, z, tradeMap, geo, bandPct, fee);
  const parts = { c: { pnl: rc.pnl, n: rc.trades }, u: { pnl: ru.pnl, n: ru.trades }, z: { pnl: rz.pnl, n: rz.trades } };
  const { kx, ux, zx } = confirmLib.multipliersOf(confirm, st.kx, st.ux);
  const g = confirmLib.combine(parts, kx, ux, zx);
  let res = { pnl: g.pnl, trades: g.trades, stops: (rc.stops || 0) + (ru.stops || 0) + (rz.stops || 0) };
  if (wantRich) {
    // a part priced at size 0 was not taken: it leaves the rich pass too
    // (3.206.0: the no-lean part as well, under strictly confirmed)
    const taken = calls.map((v, i) => {
      if (signs[i] === 0) return zx === 0 ? 0 : v;
      return (ux === 0 && signs[i] !== v) ? 0 : ((kx === 0 && signs[i] === v) ? 0 : v);
    });
    res = { ...bracketLib.simCell(cell, ch, taken, tradeMap, geo, bandPct, fee), pnl: g.pnl, trades: g.trades };
  }
  return { res, parts, size: g.size, kx, ux, zx };
}
// ONE WINDOW PRICED UNDER THE FIELD'S GATE (FIELD-DESIGN.md section F). The
// calls are sized by the gate on their own decision days, grouped by their
// multiple and each group priced by the one simulator on its own; the blocked
// calls priced once at size 1 beside them so the verdict can say whether
// blocking them paid. `sim(list)` is the simulator over this window's chunks.
function priceFieldWindow(calls, decisionTs, days, gate, sim, wantRich) {
  const sz = fieldGate.sizesFor(days, decisionTs, calls, gate);
  const g = fieldGate.priceGated(calls, sz.sizes, sim);
  let res = { pnl: g.pnl, trades: g.trades, stops: g.stops };
  if (wantRich) res = { ...sim(g.taken), pnl: g.pnl, trades: g.trades };
  return {
    res, parts: null,
    field: {
      pnl: g.pnl, trades: g.trades, size: g.size, at1: g.at1, blockedAt1: g.blockedAt1, blockedN: g.blockedN,
      placed: sz.placed, blockedSign: sz.blockedSign, blockedMin: sz.blockedMin, silent: sz.silent, readSum: sz.readSum, readN: sz.readN,
    },
  };
}
// the parts of a window, to the cent, so a row stores what a reader can add
function partsCents(parts) {
  const cents = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
  return { c: { pnl: cents(parts.c.pnl), n: parts.c.n }, u: { pnl: cents(parts.u.pnl), n: parts.u.n }, z: { pnl: cents(parts.z.pnl), n: parts.z.n } };
}
// THE VERDICT OVER MANY UNITS (3.130.0): the same six numbers, summed over the
// cells, judged by the one rule; null where no cell carried a lean or the
// setting is off
function leanSumOf(cells) {
  let acc = null;
  for (const c of cells) if (c && c.lp) acc = confirmLib.addParts(acc, c.lp);
  return acc;
}
function verdictOfCells(cells, st) {
  if (!st || !st.confirm || st.confirm === 'off') return null;
  const sum = leanSumOf(cells);
  return sum ? confirmLib.verdictOf(sum, st.kx ?? confirmLib.DEFAULT_KX, st.ux ?? confirmLib.DEFAULT_UX, confirmLib.multipliersOf(st.confirm, st.kx, st.ux).zx) : null;
}
// THE FIELD'S NUMBERS OVER MANY CELLS, and its verdict by the one rule
function fieldSumOf(cells, which = 'fp') {
  let acc = null;
  for (const c of cells) if (c && c[which]) acc = fieldGate.mergeTotals(acc, c[which]);
  return acc;
}
function verdictOfCoin(k) {
  if (!k || !k.lp) return null;
  // the no-lean multiplier follows the value of confirm the coin was priced under (3.206.0)
  return confirmLib.verdictOf(k.lp, k.kx ?? confirmLib.DEFAULT_KX, k.ux ?? confirmLib.DEFAULT_UX, confirmLib.multipliersOf(k.confirm || 'off', k.kx, k.ux).zx);
}
function serializeTallyAcc(acc) {
  return {
    rows: acc.rows, agreedHit: acc.agreedHit || 0, agreedMiss: acc.agreedMiss || 0,
    perSetting: [...acc.perSetting.values()].map((s) => ({ ...s, perCoin: [...s.perCoin.entries()] })),
    perCoin: [...acc.perCoin.entries()].map(([ck, k]) => [ck, { ...k, b: [...k.b] }]),
  };
}
function mergeTallyAcc(acc, part) {
  acc.rows += part.rows;
  acc.agreedHit += part.agreedHit || 0; acc.agreedMiss += part.agreedMiss || 0;
  for (const ps of part.perSetting) {
    let s = acc.perSetting.get(ps.si);
    if (!s) { s = { ...ps, perCoin: new Map() }; delete s.perCoin; s.perCoin = new Map(); acc.perSetting.set(ps.si, s); }
    for (const [trade, add] of ps.perCoin) {
      let c = s.perCoin.get(trade);
      if (!c) { c = { test: 0, testN: 0, ttr: 0, ttrN: 0, hold: 0, holdN: 0, trades: 0, vsl: 0, vsln: 0, beat: 0, pairs: 0, ld: 0, ldN: 0, rung: 0, rungN: 0, voices: 0, voicesN: 0, agr: 0, agrN: 0 }; s.perCoin.set(trade, c); }
      c.test += add.test; c.testN += add.testN; c.hold += add.hold; c.holdN += add.holdN;
      c.ttr += add.ttr || 0; c.ttrN += add.ttrN || 0;
      c.trades += add.trades; c.vsl += add.vsl; c.vsln += add.vsln;
      c.beat += add.beat; c.pairs += add.pairs;
      c.ld += add.ld || 0; c.ldN += add.ldN || 0;
      c.rung += add.rung || 0; c.rungN += add.rungN || 0;
      c.voices += add.voices || 0; c.voicesN += add.voicesN || 0;
      c.agr += add.agr || 0; c.agrN += add.agrN || 0;
      mergeNoise(c, 'nt', add.nt, add.ntN); mergeNoise(c, 'nh', add.nh, add.nhN);
      if (add.lp) c.lp = confirmLib.addParts(c.lp || null, add.lp);
      if (add.hlp) c.hlp = confirmLib.addParts(c.hlp || null, add.hlp);
      if (add.fp) c.fp = fieldGate.mergeTotals(c.fp || null, add.fp);
      if (add.fhp) c.fhp = fieldGate.mergeTotals(c.fhp || null, add.fhp);
    }
    if (s.confirm === undefined && ps.confirm !== undefined) { s.confirm = ps.confirm; s.kx = ps.kx; s.ux = ps.ux; }
    if (s.field === undefined && ps.field !== undefined) s.field = ps.field;
  }
  for (const [ck, add] of part.perCoin) {
    let k = acc.perCoin.get(ck);
    if (!k) {
      k = { cellLabel: add.cellLabel, trade: add.trade, ctx1: add.ctx1, ctx2: add.ctx2, geometry: add.geometry, confirm: add.confirm || 'off',
        fieldLabel: add.fieldLabel || '', field: add.field || null,
        beat: 0, pairs: 0, test: 0, testN: 0, ttr: 0, ttrN: 0, hold: 0, holdN: 0, trades: 0, tradesN: 0, vsl: 0, vsln: 0,
        agr: 0, agrN: 0, rows: 0, b: new Set() };
      acc.perCoin.set(ck, k);
    }
    k.rows += add.rows;
    k.beat += add.beat; k.pairs += add.pairs;
    k.test += add.test || 0; k.testN += add.testN || 0;
    k.ttr += add.ttr || 0; k.ttrN += add.ttrN || 0;
    if (add.lp) k.lp = confirmLib.addParts(k.lp || null, add.lp);
    if (add.hlp) k.hlp = confirmLib.addParts(k.hlp || null, add.hlp);
    if (add.fp) k.fp = fieldGate.mergeTotals(k.fp || null, add.fp);
    if (add.fhp) k.fhp = fieldGate.mergeTotals(k.fhp || null, add.fhp);
    if (k.kx == null && add.kx != null) { k.kx = add.kx; k.ux = add.ux; }
    k.hold += add.hold; k.holdN += add.holdN;
    k.trades += add.trades; k.tradesN += add.tradesN;
    k.vsl += add.vsl; k.vsln += add.vsln;
    mergeNoise(k, 'nt', add.nt, add.ntN); mergeNoise(k, 'nh', add.nh, add.nhN);
    k.agr += add.agr || 0; k.agrN += add.agrN || 0;
    for (const b of add.b) k.b.add(b);
  }
  return acc;
}
// TASK: fold one shard of the records store — a list of whole blocks, each
// read exactly once, each row tagged with the block it came from.
async function s3TallyShardTask({ id, blocks, agreedAt = null }) {
  const rowstore = require('./rowstore');
  const acc = newTallyAcc();
  for (const bIdx of blocks) {
    for (const got of rowstore.readBlocks(id, 'records', [bIdx])) tallyFold(acc, got.row, bIdx, agreedAt);
  }
  return serializeTallyAcc(acc);
}

// S2_ORDERINGS lived here until 2026-08-27: the owner replaced the two-way
// order by with sorts picked on the tables themselves and saved on the set
// (lib/stages.js SORT_KEYS) — the carry reads the saved sort, so a separate
// launch-side ordering menu was a second answer to the same question. The
// export outlived the control by one deploy (the word-list generator
// compiles the SERVED commit's vocabulary, which asked for it at load) and
// came out once the box served a vocabulary without it.

module.exports = {
  passGeometry,
  s1UnitTask, s2UnitTask, s3UnitTask, s3TallyShardTask, richOf, storedRecordOf, shapeOf, appendKept, priceLeanWindow, priceFieldWindow, leanSumOf, fieldSumOf, verdictOfCells, verdictOfCoin, partsCents,
  moneyWeights, moneyStakes, moneyWeightReading, weightsFor, weightReadingFor, weightsSaid, trainOnOf, capOf, TRAIN_ON, WEIGHT_CAP_DEFAULT,
  agreedKey, agreedKeyOfRecord, agrOf,
  newTallyAcc, tallyFold, serializeTallyAcc, mergeTallyAcc,
  addNoiseRow, mergeNoise, meanNoise, cents,
  // the arithmetic, exported so the tests can pencil it
  forecastScore, pooledAt, leadOver, dealOrder, callFromProbs, trainProbMember, trainGatedMember, gateOf, ownSplitOf, ownReadingOf, forecastRows, memberReadings, plateausOf, whenThinFor, silentMember, unitChunks, predictMember, unreadChunksFor, forecastHashOf, tradeMapFor,
  directionCalls, tuningSliceOf, directionMoney, moneyAgainstNull, TUNING_TAG,
  probsArr, probsObj,
};
