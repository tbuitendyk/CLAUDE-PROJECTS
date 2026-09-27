// stagesignal.js -- THE LIVE PATH SPEAKING THE STAGE ENGINE'S AGREEMENT
// (3.91.0, VERIFY-DESIGN.md section 6; loop record step 7).
//
// For a stage-engine configuration (engine 'stages', minted from a Stage 4
// record set), the decision for one chunk is reached the way stage 3 reaches
// it, not the way the older engine counts votes:
//
//   * the members are trained the way stage 1 and stage 2 train them -- each
//     model on its own view through the same fitting, with the same weighing
//     of training days the set was trained under, on answers marked with the
//     band worked out from the training stretch as stage 1 marks them -- on
//     the chunks the deployment's training policy names (3.283.0): for "as
//     trained by Construct" the prices Construct kept, cut as Construct cut
//     them (train, test, a held-back stretch never read); for frozen at and
//     rolling everything closed by the training instant, with no held-back
//     stretch -- all of it trains, or the newest 15% is the test stretch when
//     the rule reads one (voices, or a bar of its own history)
//   * the committee's own shape and every member's tau are worked out on that
//     test slice, exactly as stage 3 works them out, through the ONE
//     definition both share (lib/committee.js)
//   * the target chunk's votes come from the fitted models, and the call is
//     the agreement rule's own call on that moment -- the way of weighing, the
//     bar, the share, the copy share, +both and +hold as the configuration
//     carries them. +hold needs the preceding moments, so those chunks are
//     forecast too and the stream is read at its end.
//
// NO AI anywhere in this path: deterministic arithmetic over candles, like
// everything it sits beside.
const crypto = require('crypto');
const { splitAndLabel, splitAndLabelBook, buildCombo, splitBounds, reserveChunks } = require('../bracketwork');
const sw = require('../stagework');
const { tuneTau } = require('../pipeline');
const committee = require('../committee');
const agreement = require('../agreement');

const HOUR_MS = 3600000;
const SIDE_MAP = { 1: 'LONG', '-1': 'SHORT', 0: 'FLAT' };

// the way of weighing as the configuration carries it, in the shape stage 3 reads
function agreementOf(cfg) {
  const a = (cfg && cfg.agreement) || {};
  return {
    rule: a.rule, bar: a.bar ?? null, pct: a.pct ?? null,
    copy: a.copy ?? committee.COPY_DEFAULT, both: !!a.both, persist: Math.max(0, Math.floor(Number(a.persist) || 0)),
    // the plateau share (3.205.0): nothing on a unit without plateaus
    plateau: a.plateau == null ? null : Number(a.plateau),
  };
}

// Train the configuration's members on the closed chunks and shape the
// committee on the test slice; forecast the moments asked for.
//   closed   chunks whose outcome has closed by the training instant, in order
//   moments  the chunks to forecast (the +hold run and the target), in order
// THE WEIGHTS A DEPLOYMENT TRAINS WITH: the set's own weighing, and, when the
// record carries a half-life (3.95.0), the same age weight the History run
// multiplied in -- each training chunk halving every H days of age from the
// last training chunk -- through the one definition in lib/halflife.js.
function trainingWeightsFor(training, trainChunks, fee) {
  const h = Number((training || {}).halfLife);
  if (Number.isFinite(h) && h > 0) return require('../halflife').halfLifeWeights(training, trainChunks, fee, h).weights;
  return sw.weightsFor(training, trainChunks, fee);
}
// THE HISTORY CONSTRUCT TRAINED ON, REBUILT (3.283.0): its chunks from the
// prices it kept with the set -- read through the fingerprints it recorded,
// never from the box -- exactly as stage 1 built them (lib/stagework.js
// unitChunks: every day of the week, no chunk without an outcome), its sealed
// reserve cut off when the layout sealed one. Before a member is trained the
// cut is held to the stretches Construct wrote down: a history that does not
// cut where Construct's did is refused, never trained on.
async function constructHistoryChunks(cfg, construct) {
  const coins = ((construct || {}).hours || {}).coins;
  if (!coins || !Object.keys(coins).length) throw new Error('"as trained by Construct" has no kept prices to train on');
  const extras = Array.isArray(cfg.extras) ? cfg.extras : [];
  const branch = { geometry: cfg.branch.geometry, decision: 'argmax', band: 'auto', weekdaysOnly: false };
  const { geo, maps, chunks } = await buildCombo(cfg.combo, branch, { hours: coins, extras });
  const closed = ((cfg.training || {}).windowLayout === 'reserve61') ? chunks.slice(0, chunks.length - reserveChunks(chunks.length)) : chunks;
  const { nTrain, nTest, nHold } = splitBounds(closed.length, true);
  const reach = (c) => c.startTs + (geo.exitOffsetH || 0) * HOUR_MS;
  const iso = (ts) => new Date(ts).toISOString().slice(0, 10);
  const w = construct.windows;
  if (w && w.train && w.test && w.hold) {
    const got = { train: nTrain, test: nTest, held: nHold, from: closed[0].startTs, trainTo: reach(closed[nTrain - 1]) };
    const want = { train: w.train.chunks, test: w.test.chunks, held: w.hold.chunks, from: w.train.fromTs, trainTo: w.train.toTs };
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      throw new Error(`the history rebuilt from the prices Construct kept does not cut where Construct cut it (train ${got.train}, test ${got.test}, held ${got.held} periods from ${iso(got.from)}; Construct wrote down ${want.train}, ${want.test}, ${want.held} from ${iso(want.from)}) — refused rather than trained on another history`);
    }
  }
  return { closed, maps, geo, trainEndTs: reach(closed[nTrain - 1]) };
}

// A RULE THAT READS A TEST STRETCH (3.283.0): voices measures there which
// members vote as one, and a bar of its own history is set there; nothing else
// the committee does reads it
function readsTestStretch(cfg) {
  const a = (cfg && cfg.agreement) || {};
  return a.rule === 'voices' || a.bar === 'own';
}
// `mode` is the deployment's training policy; a caller that names none is cut
// as Construct cut, which is what every caller did before 3.283.0
async function trainStageCommittee(cfg, closed, moments, views, fee, mode = 'construct') {
  // EACH EXTRA'S OWN ANSWERS, BESIDE THE UNIT'S (3.188.0). The splitter works
  // the extras' bands out here from the training stretch, exactly as stage 1
  // does -- the walk's number is a MULTIPLE of what the coin usually moves, and
  // the scale it multiplies is measured on the same stretch both sides. Give
  // live the percent stage 1 arrived at instead and the two would be marking
  // against different thresholds the moment the training window differed.
  const extras = Array.isArray(cfg.extras) ? cfg.extras : [];
  // AND THE UNIT'S OWN ANSWERS THE SAME WAY (3.283.0): every stage that trains a
  // member marks what it learns with the band worked out from its training
  // stretch (lib/stagework.js unitChunks, band 'auto'); the configuration's band
  // only places the trades. Marked with the configuration's band, the book's
  // members learned from other answers than Construct's did.
  const branch = { ...cfg.branch, band: 'auto' };
  const bands = extras.map((e) => e.bandPct);
  const split = mode === 'construct'
    ? splitAndLabel(closed, branch, true, bands)
    : splitAndLabelBook(closed, branch, readsTestStretch(cfg), bands);
  const { trainChunks, testChunks, holdChunks } = split;
  const training = cfg.training || {};
  const started = Date.now();
  const weights = trainingWeightsFor(training, trainChunks, fee);
  const predictChunks = [...testChunks, ...moments];
  // the plateaus the extras belong to (3.203.0): a plateau's centre that is too
  // thin to train refuses, a neighbour goes silent -- as the set was priced
  const plateaus = Array.isArray(cfg.plateaus) ? cfg.plateaus : [];
  const members = [];
  for (const spec of cfg.members) {
    // AND EACH MEMBER IS MARKED ON THE QUESTION IT WAS ASKED. A member added
    // from a walk set is marked against that walk's band; every other member
    // against the unit's own, which is what `c.label` already holds. Marking
    // them all alike would throw away the one thing the walk found.
    const at = spec.at == null ? null : Number(spec.at);
    const viewIdx = views[spec.view];
    if (!viewIdx) throw new Error(`live signal: this unit has no slice called '${spec.view}' for a member to read`);
    // THE GATE IS APPLIED HERE TOO, AND THE SAME WAY (3.201.0). Live rebuilds
    // the whole committee from the configuration, so a member built here has to
    // be the member the sweep priced -- trained on the chunks its band opens
    // and forced to sit out on the rest. Built any other way the live committee
    // would speak at a different rate from the one the evidence is about, which
    // is the one thing a rebuild must never do.
    //
    // AND ON ITS OWN SHARE OF THE WHOLE CLOSED HISTORY (3.202.0): the split the
    // set was trained under rides in the configuration's training block, and
    // the rows it gives the member are weighed the same way the set weighed
    // them. The sweep's member, rebuilt, and nothing else.
    // eslint-disable-next-line no-await-in-loop
    const m = await sw.trainGatedMember({
      spec: { model: spec.model, at }, viewIdx, trainChunks, testChunks, holdChunks, predictChunks, weights,
      weightsOf: (rows) => trainingWeightsFor(training, rows, fee), share: training.extraTrainShare, labelOf: null,
      whenThin: sw.whenThinFor({ at }, plateaus),
    });
    members.push({ spec, ...m });
  }
  const nTest = testChunks.length;
  const trainMs = Date.now() - started;
  // WHAT WAS TRAINED, AS A FINGERPRINT (3.283.0, owner 2026-09-27): every
  // member's fitted model exactly as it came out. A frozen book's members are
  // rebuilt at every decision and must come out the same every time; this is
  // what shows that they did.
  const membersFp = crypto.createHash('sha256')
    .update(JSON.stringify(members.map((m) => ({ model: m.spec.model, view: m.spec.view, at: m.spec.at ?? null, saved: m.saved ?? null }))))
    .digest('hex').slice(0, 16);
  return { split, members, nTest, trainMs, membersFp, weightsSaid: sw.weightsSaid(training, weights, sw.weightReadingFor(training, trainChunks, fee)) };
}

// The committee's call for `target` under the configuration's own agreement.
//   opts.mode    the deployment's training policy (lib/live/trainpolicy.js);
//                none named is cut as Construct cut, as before 3.283.0
//   opts.tauFee  the fee each member's own bar is tuned at: stage 3's, for "as
//                trained by Construct"; the book's own otherwise
//   opts.tauMap  the prices that bar is tuned on: the ones Construct kept, for
//                "as trained by Construct"
async function stageCommitteeCallFor(cfg, target, closed, allChunks, maps, geo, views, freezeMs, fee, opts = {}) {
  const agr = agreementOf(cfg);
  const decision = cfg.branch.decision;
  const mode = opts.mode || 'construct';
  // +hold reads the preceding moments: the chunks just before the target, in order
  const at = allChunks.findIndex((c) => c.startTs === target.startTs);
  if (at < 0) throw new Error('stage signal: the target chunk is not among the chunks built');
  const before = agr.persist ? allChunks.slice(Math.max(0, at - agr.persist), at) : [];
  const moments = [...before, target];
  const { split, members, nTest, trainMs, membersFp } = await trainStageCommittee(cfg, closed, moments, views, fee, mode);
  // tau per member, tuned from the probe votes on the member's validation slice, as stage 3 tunes it
  const tauFee = opts.tauFee ?? fee;
  const tauMap = opts.tauMap || maps.trade;
  const taus = members.map((m) => {
    const nSub = split.trainChunks.length - m.tauProbs.length;
    const valChunks = split.trainChunks.slice(nSub);
    return decision === 'directional' ? tuneTau(valChunks, m.tauProbs.map(committee.probsObj), tauMap, geo, tauFee).tau : null;
  });
  const specs = members.map((m) => m.spec);
  // WITH ITS PLATEAUS FOLDED, exactly as stage 3 folded them (3.205.0): one
  // voter per plateau per kind at the configuration's own share, a member
  // that could not be trained left out of the fold
  const speaking = new Set(members.map((m, mi) => (m.saved && m.saved.kind === 'silent' ? -1 : mi)).filter((mi) => mi >= 0));
  const C = committee.committeeOn({ specs, memberProbsTest: members.map((m) => m.probs.slice(0, nTest)), taus, plateaus: cfg.plateaus || [], speaking });
  const momentProbs = members.map((m) => m.probs.slice(nTest));
  // THE FIELD AS THE CALL (3.221.0): under quorum by field the members are
  // trained and their votes recorded as ever, but the call is the field's own
  // sign at this decision, read exactly as stage 3 read it, and +hold reads
  // the field at the moments before. A setup under this rule that names no
  // field is refused, never quietly decided by the members.
  let stream;
  let membersCall;
  if (agr.rule === 'field') {
    if (!(cfg.field && cfg.field.gate)) throw new Error('stage signal: quorum by field reads the field alone, and this setup names no field');
    const signs = require('../fieldlive').fieldSignsAt(maps.trade, cfg.branch.geometry, cfg.field.dials, moments.map((m) => m.startTs), `${cfg.combo.trade}|${cfg.branch.geometry}`);
    stream = agreement.agreementStream({ calls: [], fieldSigns: signs }, 'field', null, { persist: agr.persist });
    membersCall = null;
  } else {
    stream = C.streamOf(decision, agr, momentProbs);
    membersCall = stream[stream.length - 1] || 0;
  }
  const call = stream[stream.length - 1] || 0;
  const perMember = committee.callsOf(momentProbs, decision, taus).map((calls) => calls[calls.length - 1]);
  const entryTs = target.startTs + (geo.entryOffsetH || 0) * HOUR_MS;
  const bar = maps.trade.get(entryTs);
  const priceAt = bar ? bar.open : null;
  // THE FIELD'S GATE OVER THE CALL (FIELD-DESIGN.md section H): the field is
  // rebuilt from the closed history the members trained on and read at this
  // decision's own instant, exactly as stage 3 read it on the day; a blocked
  // call is no call, a placed one carries its size for the clip. Everything
  // the field said rides in the hash, so the recompute can prove the gate.
  let field = null;
  let gatedCall = call;
  if (cfg.field && cfg.field.gate) {
    const got = require('../fieldlive').fieldAtDecision(maps.trade, cfg.branch.geometry, cfg.field.dials, cfg.field.gate, target.startTs, call, `${cfg.combo.trade}|${cfg.branch.geometry}`);
    field = {
      id: cfg.field.id, read: got.read, sign: got.sign, agreement: got.agreement == null ? null : Number(got.agreement.toFixed(2)),
      certainty: got.certainty == null ? null : Number(got.certainty.toFixed(2)), speaking: got.speaking,
      day: got.day == null ? null : new Date(got.day).toISOString(), full: got.full, size: got.size, why: got.why,
    };
    if (call !== 0 && !(got.size > 0)) gatedCall = 0;
  }
  const side = SIDE_MAP[String(gatedCall)] || 'FLAT';
  const level = C.levelFor(agr, decision);
  const inputHash = crypto.createHash('sha256')
    .update(JSON.stringify({
      chunk: target.startTs, perMember, agreement: agr, level, band: Math.abs(cfg.branch.band),
      side, symbol: cfg.combo.trade, train_through: freezeMs, config_version: cfg.configVersion, engine: 'stages',
      ...(field ? { field: { sign: field.sign, agreement: field.agreement, certainty: field.certainty, size: field.size, why: field.why } } : {}),
    }))
    .digest('hex').slice(0, 16);
  // WHAT THE MEMBERS WERE TRAINED ON, AND HOW (3.283.0): the policy, the
  // stretches it cut and the dates the training stretch ran, what came out as a
  // fingerprint, and how long the training took -- written beside the decision
  const { trainChunks: tr, holdChunks: held } = split;
  const trainedOn = {
    mode, periods: closed.length, train: tr.length, test: nTest, held: held.length,
    fromUtc: new Date(tr[0].startTs).toISOString(), toUtc: new Date(tr[tr.length - 1].startTs).toISOString(),
    // the dormant band worked out on that training stretch, the answers were marked with
    bandPct: Number.isFinite(split.bandPct) ? split.bandPct : null,
  };
  // each member's own forecast at the moment decided, beside its vote
  const memberProbs = momentProbs.map((p) => p[p.length - 1]);
  return { call: gatedCall, membersCall, perMember, memberProbs, side, priceAt, inputHash, entryTs, agreement: agr, level, members: members.length, testSlice: nTest, field, membersFp, trainMs, trainedOn };
}

module.exports = { stageCommitteeCallFor, trainStageCommittee, agreementOf, trainingWeightsFor, readsTestStretch, constructHistoryChunks };
