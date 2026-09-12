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

const HOUR_MS = 3600000;
const SIDE_MAP = { 1: 'LONG', '-1': 'SHORT', 0: 'FLAT' };

// the way of weighing as the configuration carries it, in the shape stage 3 reads
function agreementOf(cfg) {
  const a = (cfg && cfg.agreement) || {};
  return {
    rule: a.rule, bar: a.bar ?? null, pct: a.pct ?? null,
    copy: a.copy ?? committee.COPY_DEFAULT, both: !!a.both, persist: Math.max(0, Math.floor(Number(a.persist) || 0)),
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
  const split = splitAndLabel(closed, { ...cfg.branch, band: cfg.branch.band }, true);
  const { trainChunks, testChunks } = split;
  const training = cfg.training || {};
  const weights = trainingWeightsFor(training, trainChunks, fee);
  const predictChunks = [...testChunks, ...moments];
  const members = [];
  for (const spec of cfg.members) {
    // eslint-disable-next-line no-await-in-loop
    const m = await sw.trainProbMember({ model: spec.model, viewIdx: views[spec.view], trainChunks, predictChunks, weights });
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
  const C = committee.committeeOn({ specs, memberProbsTest: members.map((m) => m.probs.slice(0, nTest)), taus });
  const momentProbs = members.map((m) => m.probs.slice(nTest));
  const stream = C.streamOf(decision, agr, momentProbs);
  const call = stream[stream.length - 1] || 0;
  const perMember = committee.callsOf(momentProbs, decision, taus).map((calls) => calls[calls.length - 1]);
  const entryTs = target.startTs + (geo.entryOffsetH || 0) * HOUR_MS;
  const bar = maps.trade.get(entryTs);
  const priceAt = bar ? bar.open : null;
  const side = SIDE_MAP[String(call)] || 'FLAT';
  const level = C.levelFor(agr, decision);
  const inputHash = crypto.createHash('sha256')
    .update(JSON.stringify({
      chunk: target.startTs, perMember, agreement: agr, level, band: Math.abs(cfg.branch.band),
      side, symbol: cfg.combo.trade, train_through: freezeMs, config_version: cfg.configVersion, engine: 'stages',
    }))
    .digest('hex').slice(0, 16);
  return { call, perMember, side, priceAt, inputHash, entryTs, agreement: agr, level, members: members.length, testSlice: nTest };
}

module.exports = { stageCommitteeCallFor, trainStageCommittee, agreementOf, trainingWeightsFor };
