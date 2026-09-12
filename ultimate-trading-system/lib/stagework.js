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
  buildCombo, splitAndLabel, splitAndLabelAt, splitAndLabelPass, splitBounds, quorumCall, declaredQuorumFor,
  reserveChunks,
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

async function trainProbMember({ model, viewIdx, trainChunks, predictChunks, weights = null }) {
  const Xtr = trainChunks.map((c) => viewIdx.map((i) => c.x[i]));
  const ytr = trainChunks.map((c) => c.label);
  const Xte = predictChunks.map((c) => viewIdx.map((i) => c.x[i]));
  const nVal = Math.max(3, Math.round(Xtr.length * 0.25));
  const nSub = Xtr.length - nVal;
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
    for (let i = nSub; i < Ztr.length; i++) tauProbs.push(probsArr(predictLogreg(probe, Ztr[i]).probs));
  } else {
    const probe = await trainBoost(Xtr.slice(0, nSub), ytr.slice(0, nSub), {
      Xval: Xtr.slice(nSub), yval: ytr.slice(nSub), weights: wSub, valWeights: wVal,
    });
    tauProbs = [];
    for (let i = nSub; i < Xtr.length; i++) tauProbs.push(probsArr(predictBoost(probe, Xtr[i]).probs));
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
  const { geo, maps, chunks } = await buildCombo(combo, branch, {
    allLoaded: !!p.allLoaded, startMonth: p.startMonth, endMonth: p.endMonth,
    pinnedFiles: p.pinnedFiles || null,
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
  // THE RETRAIN LAYOUT (3.94.0, the History half-life run, AGEDIAL-DESIGN.md):
  // the final 13% sealed exactly as the sealed layout seals it, then the first
  // 72% of ALL history as training and the rest before the seal as the test
  // slice, with no held-back slice -- the retraining reaches through it on
  // purpose, and the Reserve is the judge. Never offered on Sweep.
  let retrainTrain = null;
  if (p.windowLayout === 'retrain72') {
    const nAll = workChunks.length;
    const nReserve = reserveChunks(nAll);
    const sealed = workChunks.slice(nAll - nReserve);
    reserve = { chunks: nReserve, fromTs: sealed[0].startTs, toTs: reachOf(sealed[sealed.length - 1]) };
    workChunks = workChunks.slice(0, nAll - nReserve);
    retrainTrain = Math.round(nAll * 0.72);
  }
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
  const split = passCut ? splitAndLabelPass(workChunks, branch, passCut.nTrain, passCut.judge)
    : retrainTrain != null ? splitAndLabelAt(workChunks, branch, retrainTrain) : splitAndLabel(workChunks, branch, true);
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
  return { geo, maps, split, reserve, windows };
}

const viewsFor = (combo, geo) => bracketLib.comboViews(combo.size, geo.featureHours / 24).views;

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
  const { geo, maps, split, reserve, windows } = await unitChunks(combo, geometry, p);
  const { trainChunks, testChunks, holdChunks, bandPct } = split;
  const views = viewsFor(combo, geo);
  const predictChunks = holdChunks.length ? [...testChunks, ...holdChunks] : testChunks;
  const specs = require('./bracketwork').slimViewsFor(combo.size).map((view) => ({ model: 'logreg', view }));
  // WHAT EACH TRAINING WEEK IS WORTH (3.69.0, owner order). Off unless the
  // launch asked for it, and off is what every set before this was trained
  // under -- so a set says how it was trained rather than leaving it to be
  // guessed at from the release it was made under.
  const weights = weightsFor(p, trainChunks, fee);
  const weightReading = weightReadingFor(p, trainChunks, fee);
  const members = [];
  for (const spec of specs) {
    const m = await trainProbMember({ model: spec.model, viewIdx: views[spec.view], trainChunks, predictChunks, weights });
    members.push({ spec, ...m });
  }
  const testLabels = testChunks.map((c) => c.label);
  const testProbs = members.map((m) => m.probs.slice(0, testChunks.length));
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
  const { geo, maps, split, windows } = await unitChunks(combo, geometry, p);
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
  const views = viewsFor(combo, geo);
  const predictChunks = holdChunks.length ? [...testChunks, ...holdChunks] : testChunks;
  const specs = require('./bracketwork').slimViewsFor(combo.size).map((view) => ({ model: 'boost', view }));
  // THE SAME WEIGHTING THE STAGE 1 HALF OF THIS COMMITTEE WAS TRAINED UNDER
  // (3.69.0). A stage 2 set copies its parent's settings at launch, so this
  // cannot differ -- half a committee trained on direction and half on money
  // would be two different committees wearing one name.
  const weights = weightsFor(p, trainChunks, fee);
  const weightReading = weightReadingFor(p, trainChunks, fee);
  const members = [];
  for (const spec of specs) {
    const m = await trainProbMember({ model: spec.model, viewIdx: views[spec.view], trainChunks, predictChunks, weights });
    members.push({ spec, ...m });
  }
  const testLabels = testChunks.map((c) => c.label);
  const s1Test = s1.probs.map((mp) => mp.slice(0, testChunks.length));
  const boostTest = members.map((m) => m.probs.slice(0, testChunks.length));
  const score3 = forecastScore(s1Test, testLabels);
  const scoreAll = forecastScore([...s1Test, ...boostTest], testLabels);
  // THE MERGED MEMBERS FACE THE PARENT'S NULL SET (3.46.0): the same deals the
  // stage 1 members were read against -- the parent's seed, the same unit, the
  // same tag, the same test length -- so 'beat its own null set' on the stage 2
  // table describes every member on the row, BOOST included. Before this the
  // stage 2 record copied the stage 1 numbers and the BOOST members never
  // faced a null set at all.
  const allTest = [...s1Test, ...boostTest];
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
    tuning3, tuning,
    trainedOn: weightsSaid(p, weights, weightReading),
    windows,
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
});
const agreedKey = (decision, agr) => `${decision}|${agr.rule}|${agr.bar}|${agr.pct}|${agr.copy}|${agr.both ? 1 : 0}|${agr.persist}`;
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
function predictMember(saved, spec, chunks, combo, geo) {
  const views = viewsFor(combo, geo);
  const viewIdx = views[(spec || {}).view || 'full'];
  if (!viewIdx) throw new Error(`no view called '${(spec || {}).view}' on this unit`);
  const X = chunks.map((c) => viewIdx.map((i) => c.x[i]));
  if (!saved || !saved.kind) throw new Error('a member without a saved model cannot forecast the unread window');
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
async function unreadChunksFor(combo, geometry, fromTs) {
  const branch = { geometry, decision: 'argmax', band: 'auto', weekdaysOnly: false };
  const { geo, maps, chunks } = await buildCombo(combo, branch, { allLoaded: true, pinnedFiles: null });
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
  const { geo, maps, split, windows } = await unitChunks(combo, geometry, p);
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
  if (task.unread && task.capture) throw new Error('the per-trade capture never reads the unread window: that window is the reserve grade\'s alone');
  if (task.unread) {
    const got = await unreadChunksFor(combo, geometry, task.unread.fromTs);
    if (got.chunks.length < 2) {
      throw new Error(`the unread window holds ${got.chunks.length} whole chunk(s) from ${new Date(task.unread.fromTs).toISOString().slice(0, 10)} to what the box holds — nothing to grade`);
    }
    holdChunks = got.chunks;
    holdTrade = got.maps.trade;
    holdMaps = got.maps;
    dealSlice = 's4-unread';
    const forecasts = (unit.members || []).map((m, mi) => {
      if (!m.saved) throw new Error(`member ${mi} carries no saved model, so it cannot forecast the unread window`);
      return predictMember(m.saved, m.spec, holdChunks, combo, geo);
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
  const C = committee.committeeOn({ specs: (unit.members || []).map((m) => m.spec || {}), memberProbsTest: memberProbs.map((mp) => mp.slice(0, nTest)), taus });
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
  const callCache = new Map();
  const callsFor = (decision, dealIdx, slice) => {
    const key = `${decision}|${dealIdx}|${slice}`;
    if (callCache.has(key)) return callCache.get(key);
    const out = committee.callsOf(probsFor(dealIdx, slice), decision, taus);
    callCache.set(key, out);
    return out;
  };
  const voicesFor = (decision, copy) => C.voicesFor(decision, copy);
  const denomFor = (agr, decision) => C.denomFor(agr, decision);
  const levelFor = (agr, decision) => C.levelFor(agr, decision);
  // The votes and the extras a rule reads, built once per way of asking.
  // Pulled out of streamFor so the agreement REACHED can be read off exactly
  // the same votes the rule read, rather than off a second copy that could
  // drift from it.
  const ctxCache = new Map();
  const ctxFor = (decision, agr, dealIdx, slice) => {
    const key = `${decision}|${agr.rule}|${agr.copy}|${dealIdx}|${slice}`;
    if (ctxCache.has(key)) return ctxCache.get(key);
    const ctx = {
      calls: callsFor(decision, dealIdx, slice), models, families,
      probs: agreement.READS_LEANS.has(agr.rule) ? probsFor(dealIdx, slice) : null,
      weights: agr.rule === 'voices' ? voicesFor(decision, agr.copy).weights : null,
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
      return predictMember(m.saved, m.spec, trainChunks, combo, geo);
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
  const trainCallsFor = (decision) => {
    if (!trainCallsCache.has(decision)) trainCallsCache.set(decision, committee.callsOf(trainProbs(), decision, taus));
    return trainCallsCache.get(decision);
  };
  const captureOf = (st, agr, cell, bandPct, weekdaysOnly) => {
    const idxOf = (chunksArr, wk) => (weekdaysOnly ? wk : chunksArr.map((_, i) => i));
    const slices = [
      ['train', trainChunks, idxOf(trainChunks, wkTrain), maps.trade, () => trainStreamFor(st.decision, agr), () => trainCallsFor(st.decision)],
      ['test', testChunks, idxOf(testChunks, wkTest), maps.trade, () => streamFor(st.decision, agr, -1, 'test'), () => callsFor(st.decision, -1, 'test')],
      ['hold', holdChunks, idxOf(holdChunks, wkHold), holdTrade, () => streamFor(st.decision, agr, -1, 'hold'), () => callsFor(st.decision, -1, 'hold')],
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
    const tRes = bracketLib.simCell(cell, pick(testChunks, tIdx), pick(testCallsAll, tIdx), maps.trade, geo, bandPct, fee);
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
      const dRes = bracketLib.simCell(cell, pick(testChunks, tIdx), pick(dt, tIdx), maps.trade, geo, bandPct, fee);
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
        noiseHold.push(cents(bracketLib.simCell(cell, pick(holdChunks, hIdx), pick(dh, hIdx), holdTrade, geo, bandPct, fee).pnl));
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
    if (holdChunks.length) {
      const holdCallsAll = streamFor(stream.decision, agr, -1, 'hold');
      const hRes = bracketLib.simCell(cell, pick(holdChunks, hIdx), pick(holdCallsAll, hIdx), holdTrade, geo, bandPct, fee);
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
        const dRes = bracketLib.simCell(cell, pick(holdChunks, hIdx), pick(dh, hIdx), holdTrade, geo, bandPct, fee);
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
      rung: levelFor(agr, stream.decision),
      members: memberProbs.length, voices: voicesFor(stream.decision, agr.copy).voices,
      pnl: tRes.pnl, trades: tRes.trades,
      holdout,
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
  return { perSetting: new Map(), perCoin: new Map(), rows: 0 };
}
function tallyFold(acc, r, blockIdx, agreedAt = null) {
  // What the members ACTUALLY did, looked up by the unit and the way of
  // asking. It is not on the record: 329,280 settings on ten units share 600
  // answers between them, so it is kept once per answer and joined here.
  const agreed = agreedAt ? agreedAt[`${r.u}|${agreedKeyOfRecord(r)}`] : null;
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
      members: r.members ?? null,
      perCoin: new Map() };
    acc.perSetting.set(r.si, s);
  }
  let c = s.perCoin.get(r.trade);
  if (!c) { c = { test: 0, testN: 0, hold: 0, holdN: 0, trades: 0, vsl: 0, vsln: 0, beat: 0, pairs: 0, ld: 0, ldN: 0, rung: 0, rungN: 0, voices: 0, voicesN: 0, agr: 0, agrN: 0 }; s.perCoin.set(r.trade, c); }
  c.test += r.pnl || 0; c.testN++;
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
  const ck = `${cellLabel}|${r.trade}|${r.ctx1 || ''}|${r.ctx2 || ''}|${r.geometry}`;
  let k = acc.perCoin.get(ck);
  if (!k) {
    k = { cellLabel, trade: r.trade, ctx1: r.ctx1, ctx2: r.ctx2, geometry: r.geometry,
      beat: 0, pairs: 0, test: 0, testN: 0, hold: 0, holdN: 0, trades: 0, tradesN: 0, vsl: 0, vsln: 0,
      agr: 0, agrN: 0, rows: 0, b: new Set() };
    acc.perCoin.set(ck, k);
  }
  k.rows++;
  if (agreed && agreed.agreed != null) { k.agr += agreed.agreed; k.agrN++; }
  k.beat += r.beat || 0; k.pairs += r.pairs || 0;
  k.test += r.pnl || 0; k.testN++;
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
function serializeTallyAcc(acc) {
  return {
    rows: acc.rows,
    perSetting: [...acc.perSetting.values()].map((s) => ({ ...s, perCoin: [...s.perCoin.entries()] })),
    perCoin: [...acc.perCoin.entries()].map(([ck, k]) => [ck, { ...k, b: [...k.b] }]),
  };
}
function mergeTallyAcc(acc, part) {
  acc.rows += part.rows;
  for (const ps of part.perSetting) {
    let s = acc.perSetting.get(ps.si);
    if (!s) { s = { ...ps, perCoin: new Map() }; delete s.perCoin; s.perCoin = new Map(); acc.perSetting.set(ps.si, s); }
    for (const [trade, add] of ps.perCoin) {
      let c = s.perCoin.get(trade);
      if (!c) { c = { test: 0, testN: 0, hold: 0, holdN: 0, trades: 0, vsl: 0, vsln: 0, beat: 0, pairs: 0, ld: 0, ldN: 0, rung: 0, rungN: 0, voices: 0, voicesN: 0, agr: 0, agrN: 0 }; s.perCoin.set(trade, c); }
      c.test += add.test; c.testN += add.testN; c.hold += add.hold; c.holdN += add.holdN;
      c.trades += add.trades; c.vsl += add.vsl; c.vsln += add.vsln;
      c.beat += add.beat; c.pairs += add.pairs;
      c.ld += add.ld || 0; c.ldN += add.ldN || 0;
      c.rung += add.rung || 0; c.rungN += add.rungN || 0;
      c.voices += add.voices || 0; c.voicesN += add.voicesN || 0;
      c.agr += add.agr || 0; c.agrN += add.agrN || 0;
      mergeNoise(c, 'nt', add.nt, add.ntN); mergeNoise(c, 'nh', add.nh, add.nhN);
    }
  }
  for (const [ck, add] of part.perCoin) {
    let k = acc.perCoin.get(ck);
    if (!k) {
      k = { cellLabel: add.cellLabel, trade: add.trade, ctx1: add.ctx1, ctx2: add.ctx2, geometry: add.geometry,
        beat: 0, pairs: 0, test: 0, testN: 0, hold: 0, holdN: 0, trades: 0, tradesN: 0, vsl: 0, vsln: 0,
        agr: 0, agrN: 0, rows: 0, b: new Set() };
      acc.perCoin.set(ck, k);
    }
    k.rows += add.rows;
    k.beat += add.beat; k.pairs += add.pairs;
    k.test += add.test || 0; k.testN += add.testN || 0;
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
  s1UnitTask, s2UnitTask, s3UnitTask, s3TallyShardTask, richOf, storedRecordOf, shapeOf, appendKept,
  moneyWeights, moneyStakes, moneyWeightReading, weightsFor, weightReadingFor, weightsSaid, trainOnOf, capOf, TRAIN_ON, WEIGHT_CAP_DEFAULT,
  agreedKey, agreedKeyOfRecord, agrOf,
  newTallyAcc, tallyFold, serializeTallyAcc, mergeTallyAcc,
  addNoiseRow, mergeNoise, meanNoise, cents,
  // the arithmetic, exported so the tests can pencil it
  forecastScore, pooledAt, leadOver, dealOrder, callFromProbs, trainProbMember, unitChunks, predictMember, unreadChunksFor, forecastHashOf, tradeMapFor,
  directionCalls, tuningSliceOf, directionMoney, moneyAgainstNull, TUNING_TAG,
  probsArr, probsObj,
};
