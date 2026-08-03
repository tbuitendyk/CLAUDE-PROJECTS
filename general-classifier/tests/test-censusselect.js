// Selecting a row the capped leader list lost (QC 69 style: drive the real
// entry point against a fake doc on disk). Null copies used to eat the 50
// leader slots, crowding real setups off the stored board; the display now
// rebuilds from the census, so selection must work for census-backed rows.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const batch = require('../lib/batch');

const BATCH_DIR = path.join(__dirname, '..', 'data', 'batches');

function docWithCensusOnlyRow(id, params) {
  fs.mkdirSync(BATCH_DIR, { recursive: true });
  const doc = {
    id, kind: 'bracketlab', status: 'done', startedAt: new Date().toISOString(),
    params: {
      windowLayout: 'split70', minTrades: 10, labelShiftReps: 9,
      set: { geometry: 'daily-1d', decision: 'argmax', band: 'auto', weekdaysOnly: false },
      permute: { geometry: true, decision: true }, ...params,
    },
    leaders: [], // the real row was crowded out by null copies before the cap fix
    edgeCensus: [{
      trade: 'LTCUSDT', ctx1: null, ctx2: null, geometry: 'daily-1d', decision: 'argmax',
      nullDealSeed: null, shiftFrac: null, windowLayout: 'split70', bandPct: 1.4,
      cellQuorum: 3, cellGate: 'directional', cellEntry: 'breakout', cellDMult: 1, cellTHours: 41,
      cellTrailMult: null, cellArmMult: null, members: 6,
      searchPnl: 40, searchTrades: 20, holdPnl: 25, holdTrades: 14,
    }],
  };
  fs.writeFileSync(path.join(BATCH_DIR, `${id}.json`), JSON.stringify(doc));
  return doc;
}

module.exports = {
  async aCensusBackedRowCanBeSelected() {
    const id = 'bracketlab-20990101-0007-cs1';
    try {
      docWithCensusOnlyRow(id, {});
      const doc = batch.bracketSelect(id, { key: 'census|LTCUSDT|||daily-1d|argmax', stage: 'promoted' });
      assert.strictEqual(doc.selection.trade, 'LTCUSDT');
      assert.strictEqual(doc.selection.quorum, 3);
      assert.strictEqual(doc.selection.gate, 'directional');
      assert.strictEqual(doc.selection.bandMode, 'auto');
      assert.strictEqual(doc.selection.weekdaysOnly, false);
      assert.strictEqual(doc.selection.pnl, 40);
    } finally {
      fs.rmSync(path.join(BATCH_DIR, `${id}.json`), { force: true });
    }
  },
  async aPermutedBandWithoutAStoredBranchRefuses() {
    const id = 'bracketlab-20990101-0008-cs2';
    try {
      docWithCensusOnlyRow(id, { permute: { band: true } });
      let err = null;
      try { batch.bracketSelect(id, { key: 'census|LTCUSDT|||daily-1d|argmax', stage: 'promoted' }); } catch (e) { err = e; }
      assert.ok(err, 'must refuse');
      assert.ok(/band/.test(err.message), `wrong refusal: ${err.message}`);
    } finally {
      fs.rmSync(path.join(BATCH_DIR, `${id}.json`), { force: true });
    }
  },
};
