// stagesignal.js -- THE LIVE PATH SPEAKING THE STAGE ENGINE'S AGREEMENT
// (3.91.0, VERIFY-DESIGN.md section 6; loop record step 7).
//
// For a stage-engine configuration (engine 'stages', minted from a Stage 4
// record set), the decision for one chunk is reached the way stage 3 reaches
// it, not the way the older engine counts votes:
//
//   * the members are trained the way stage 1 and stage 2 train them -- each
//     model on its own view through the same fitting, with the same weighing
//     of training days the set was trained under -- on the chunks whose
//     outcome has closed by the deployment's training instant, laid out as
//     stage 1 lays them out (the older share as training, a test slice after
//     it, a held-back slice unused); the seal is not cut away, because the
//     seal existed to leave data unread and a deployment reads everything
//     closed
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
const { splitAndLabel } = require('../bracketwork');
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
async function trainStageCommittee(cfg, closed, moments, views, fee) {
  // EACH EXTRA'S OWN ANSWERS, BESIDE THE UNIT'S (3.188.0). The splitter works
  // the extras' bands out here from the training stretch, exactly as stage 1
  // does -- the walk's number is a MULTIPLE of what the coin usually moves, and
  // the scale it multiplies is measured on the same stretch both sides. Give
  // live the percent stage 1 arrived at instead and the two would be marking
  // against different thresholds the moment the training window differed.
  const extras = Array.isArray(cfg.extras) ? cfg.extras : [];
  const split = splitAndLabel(closed, { ...cfg.branch, band: cfg.branch.band }, true, extras.map((e) => e.bandPct));
  const { trainChunks, testChunks, holdChunks } = split;
  const training = cfg.training || {};
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
  return { split, members, nTest, weightsSaid: sw.weightsSaid(training, weights, sw.weightReadingFor(training, trainChunks, fee)) };
}

// The committee's call for `target` under the configuration's own agreement.
async function stageCommitteeCallFor(cfg, target, closed, allChunks, maps, geo, views, freezeMs, fee) {
  const agr = agreementOf(cfg);
  const decision = cfg.branch.decision;
  // +hold reads the preceding moments: the chunks just before the target, in order
  const at = allChunks.findIndex((c) => c.startTs === target.startTs);
  if (at < 0) throw new Error('stage signal: the target chunk is not among the chunks built');
  const before = agr.persist ? allChunks.slice(Math.max(0, at - agr.persist), at) : [];
  const moments = [...before, target];
  const { split, members, nTest } = await trainStageCommittee(cfg, closed, moments, views, fee);
  // tau per member, tuned from the probe votes on the member's validation slice, as stage 3 tunes it
  const taus = members.map((m) => {
    const nSub = split.trainChunks.length - m.tauProbs.length;
    const valChunks = split.trainChunks.slice(nSub);
    return decision === 'directional' ? tuneTau(valChunks, m.tauProbs.map(committee.probsObj), maps.trade, geo, fee).tau : null;
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
  return { call: gatedCall, membersCall, perMember, side, priceAt, inputHash, entryTs, agreement: agr, level, members: members.length, testSlice: nTest, field };
}

module.exports = { stageCommitteeCallFor, trainStageCommittee, agreementOf, trainingWeightsFor };
