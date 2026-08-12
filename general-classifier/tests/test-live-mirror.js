// Per-setup mirror (plan 6.1): decision-record loading + break/pending
// classification, with an injected recompute so no engine or data is needed.
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-live-dec-'));
process.env.GC_LIVE_DECISIONS = DIR;
const mirror = require('../lib/live/mirror');

function writeDecisions(setupId, records) {
  fs.writeFileSync(path.join(DIR, `${setupId}.jsonl`),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
const rec = (over = {}) => ({
  chunk_start: '2026-08-07T00:00:00.000Z', side: 'LONG', per_member: [0, 0, 1, 0],
  quorum: 1, band_pct: 1.69, decision_price: 45.55, input_hash: 'h1',
  config_version: 'v1', window_complete: true, ...over,
});

module.exports.loadKeepsLastRecordPerChunk = function () {
  writeDecisions('s1', [
    rec({ side: 'LONG', decision_price: 10 }),
    rec({ side: 'SHORT', decision_price: 20 }),   // re-ship same chunk -> this wins
    rec({ chunk_start: '2026-08-08T00:00:00.000Z', side: 'LONG' }),
  ]);
  const d = mirror.loadDecisions('s1');
  assert.strictEqual(d.length, 2, 'one entry per chunk');
  assert.strictEqual(d[0].side, 'SHORT', 'last write for the chunk wins');
};

module.exports.matchingRecomputeIsClean = async function () {
  writeDecisions('s2', [rec()]);
  const r = await mirror.checkSetup({ id: 's2' }, {
    recompute: async () => ({ found: true, price_pending: false, side: 'LONG',
      per_member: [0, 0, 1, 0], decision_price: 45.55, input_hash: 'h1' }),
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.checked, 1);
  assert.strictEqual(r.breaks, 0);
};

module.exports.sideOrHashDivergenceIsABreak = async function () {
  writeDecisions('s3', [rec()]);
  const flipped = await mirror.checkSetup({ id: 's3' }, {
    recompute: async () => ({ found: true, price_pending: false, side: 'SHORT',
      per_member: [0, 0, -1, 0], decision_price: 45.55, input_hash: 'h1' }),
  });
  assert.strictEqual(flipped.ok, false);
  assert.strictEqual(flipped.breaks, 1);
  assert.ok(/side/.test(flipped.details[0].reason));

  writeDecisions('s3b', [rec()]);
  const drift = await mirror.checkSetup({ id: 's3b' }, {
    recompute: async () => ({ found: true, price_pending: false, side: 'LONG',
      per_member: [0, 0, 1, 0], decision_price: 45.55, input_hash: 'h2' }),  // hash drift
  });
  assert.strictEqual(drift.breaks, 1);
  assert.ok(/input_hash|drift/.test(drift.details[0].reason));
};

module.exports.pricePendingDefersInsteadOfBreaking = async function () {
  writeDecisions('s4', [rec()]);
  const r = await mirror.checkSetup({ id: 's4' }, {
    recompute: async () => ({ found: true, price_pending: true, side: 'LONG',
      per_member: [0, 0, 1, 0], decision_price: null, input_hash: 'h1' }),
  });
  assert.strictEqual(r.breaks, 0, 'pending price is not a break (QC 110)');
};

module.exports.vanishedWindowUnderACompletedDecisionBreaks = async function () {
  writeDecisions('s5', [rec({ window_complete: true })]);
  const r = await mirror.checkSetup({ id: 's5' }, {
    recompute: async () => ({ found: false, note: 'chunk not present in current data' }),
  });
  assert.strictEqual(r.breaks, 1, 'a completed decision whose data vanished is a break (finding 7)');
  assert.ok(/vanished/.test(r.details[0].reason));
};

module.exports.recomputeErrorIsHandledNotThrown = async function () {
  writeDecisions('s6', [rec()]);
  const r = await mirror.checkSetup({ id: 's6' }, {
    recompute: async () => { throw new Error('engine boom'); },
  });
  // a completed decision that can't be recomputed reads as a break (data-side
  // failure under a completed window), never an unhandled throw
  assert.strictEqual(r.checked, 1);
  assert.ok(r.breaks + r.pending === 1);
};

module.exports.noDecisionsIsAnEmptyCleanResult = async function () {
  const r = await mirror.checkSetup({ id: 'never' }, { recompute: async () => ({ found: true }) });
  assert.strictEqual(r.checked, 0);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.breaks, 0);
};

module.exports.mirrorWindowCoversTheHoldNotJustNewestTen = async function () {
  // R17: the recompute window covers the whole hold (ceil(tHours/24)+10), so a
  // decision whose position could still be open is re-verified — not capped at 10.
  const records = [];
  for (let i = 1; i <= 15; i++) {
    records.push(rec({ chunk_start: `2026-08-${String(i).padStart(2, '0')}T00:00:00.000Z` }));
  }
  writeDecisions('s-hold', records);
  const setup = { id: 's-hold', configSnapshot: { cell: { tHours: 137 } } };  // holdChunks=6 -> n=16
  const r = await mirror.checkSetup(setup, {
    recompute: async () => ({ found: true, price_pending: false, side: 'LONG',
      per_member: [0, 0, 1, 0], input_hash: 'h1', decision_price: 45.55 }),
  });
  assert.strictEqual(r.checked, 15, 'all 15 decisions checked (hold window > 10), not capped at 10');
  assert.strictEqual(r.breaks, 0);
};
