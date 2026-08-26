// THE RECOVERED CHOICES (owner order, 2026-08-26: "you need to record that
// information for each row. i'm sure it can be recovered").
//
// The recovery matches the replication rows against the run's census records
// in the order both were written. What these tests pin, in order of how much
// it would cost to lose:
//
//   * ORDER IS THE INFORMATION. Two units on the same coin at the same fixed
//     band agree on every field the rows carry — only their position says
//     which was the vote and which the argmax. The fixture builds exactly
//     that collision and demands the right names on both.
//   * a census record whose unit wrote no rows is skipped, not misassigned;
//   * a span nothing matches goes UNNAMED and consumes nothing;
//   * two spans in one coin-and-copy group claiming the same choices are
//     BOTH stripped — the run scored each combination once, so a duplicate
//     is a proven misalignment, never a coin flip;
//   * the records endpoint serves the recovered names, says they were
//     recovered, and kicks the recovery when it has not run yet.
const { assert } = require('./helpers');
const rowstore = require('../lib/rowstore');
const choices = require('../lib/choices');
const replication = require('../lib/replication');

const censusRow = (over) => ({
  trade: 'AAAUSDT', ctx1: '', ctx2: '', geometry: 'daily-3d',
  decision: 'argmax', bandPct: 3, bandMode: 3, weekdaysOnly: false,
  nullDealSeed: null, key: 'k?', holdPnl: 1,
  ...over,
});
const repRow = (label, over) => ({
  declaredLabel: label,
  nullDealSeed: null,
  trade: 'AAAUSDT', ctx1: '', ctx2: '', geometry: 'daily-3d', bandPct: 3,
  holdout: { pnl: 10, trades: 4, vsAlwaysLong: 1 },
  ...over,
});

// The shared fixture: U1 and U2 are the collision (same coin, same fixed
// band, same copy tag — different decision); U3 wrote no rows; U4 differs
// only in 24/5; U5 is a dealt copy.
function writeFixture(runId) {
  const c = rowstore.writer(runId, 'census');
  c.push(censusRow({ key: 'k1' }));
  c.push(censusRow({ decision: 'vote', key: 'k2' }));
  c.push(censusRow({ trade: 'BBBUSDT', bandPct: 5, bandMode: 5, key: 'k3' }));
  c.push(censusRow({ weekdaysOnly: true, key: 'k4' }));
  c.push(censusRow({ decision: 'vote', nullDealSeed: 1, key: 'k5' }));
  c.close();
  const w = rowstore.writer(runId, 'replication');
  w.push(repRow('q1'));                                   // U1
  w.push(repRow('q2'));
  w.push(repRow('q1', { holdout: { pnl: 20, trades: 6, vsAlwaysLong: 2 } }));   // U2 — label repeats: new unit
  w.push(repRow('q2'));
  w.push(repRow('q1', { holdout: { pnl: 30, trades: 8, vsAlwaysLong: 3 } }));   // U4 (U3 wrote nothing)
  w.push(repRow('q1', { nullDealSeed: 1, holdout: { pnl: 5, trades: 2, vsAlwaysLong: 0 } }));  // U5, a copy
  w.close();
}

module.exports = {
  theOrderNamesWhatNoFieldCan() {
    const runId = `cho-order-${process.pid}`;
    try {
      writeFixture(runId);
      const out = choices.buildAndSaveUnits(runId);
      assert.strictEqual(out.spans.length, 4, 'four units wrote rows');
      assert.deepStrictEqual(out.spans.map((s) => s.k), ['k1', 'k2', 'k4', 'k5'],
        'the spans must claim their census records in write order');
      assert.strictEqual(out.spans[0].d, 'argmax');
      assert.strictEqual(out.spans[1].d, 'vote',
        'U1 and U2 agree on every recorded field — only the order can say the second was the vote');
      assert.strictEqual(out.spans[2].w, true, 'the 24/5 choice travels');
      assert.strictEqual(out.named, 4);
      assert.strictEqual(out.unnamed, 0);
      assert.strictEqual(out.censusSkipped, 1, 'the unit that wrote no rows is skipped, not misassigned');
      assert.strictEqual(out.cleared, 0);
      // span geometry: positions and lengths cover the rows exactly
      assert.deepStrictEqual(out.spans.map((s) => [s.at, s.n]), [[0, 2], [2, 2], [4, 1], [5, 1]]);
      // and the lookup finds the covering span
      assert.strictEqual(choices.namesAt(out, 3).k, 'k2');
      assert.strictEqual(choices.namesAt(out, 99), null, 'past the last row is nothing, not the last span');
    } finally {
      rowstore.remove(runId);
    }
  },

  aSpanNothingMatchesGoesUnnamedAndConsumesNothing() {
    const runId = `cho-unm-${process.pid}`;
    try {
      const c = rowstore.writer(runId, 'census');
      c.push(censusRow({ key: 'k1' }));
      c.close();
      const w = rowstore.writer(runId, 'replication');
      w.push(repRow('q1', { trade: 'ZZZUSDT' }));   // no census record anywhere
      w.push(repRow('q1'));                          // this one is k1's
      w.close();
      const out = choices.buildAndSaveUnits(runId);
      assert.strictEqual(out.unnamed, 1, 'the strange span is unnamed, honestly');
      assert.strictEqual(out.spans[0].d, null);
      assert.strictEqual(out.spans[1].k, 'k1', 'the pointer did not move for the unnamed span');
    } finally {
      rowstore.remove(runId);
    }
  },

  duplicateClaimsInOneGroupAreBothStripped() {
    const runId = `cho-dup-${process.pid}`;
    try {
      // A census stream that repeats the same choices for one coin — which a
      // real run never writes, so matching it proves a misalignment.
      const c = rowstore.writer(runId, 'census');
      c.push(censusRow({ key: 'k1' }));
      c.push(censusRow({ key: 'k2' }));   // same choices, same group
      c.close();
      const w = rowstore.writer(runId, 'replication');
      w.push(repRow('q1'));
      w.push(repRow('q1', { holdout: { pnl: 9, trades: 1, vsAlwaysLong: 0 } }));
      w.close();
      const out = choices.buildAndSaveUnits(runId);
      assert.strictEqual(out.cleared, 2, 'both claimants lose the name — neither keeps a guess');
      assert.ok(out.spans.every((s) => s.d == null));
      assert.strictEqual(out.named, 0);
      assert.strictEqual(out.unnamed, 2);
    } finally {
      rowstore.remove(runId);
    }
  },

  theRecordsServeTheRecoveredNamesAndSaySo() {
    const runId = `cho-serve-${process.pid}`;
    try {
      writeFixture(runId);
      replication.buildAndSaveTotals(runId);
      choices.buildAndSaveUnits(runId);
      const doc = { id: runId, status: 'done', leaders: [] };
      const got = replication.coinRows(doc, { label: 'q1', trade: 'AAAUSDT', geometry: 'daily-3d' });
      assert.strictEqual(got.rows.length, 3, 'three real records of q1 on this coin');
      assert.deepStrictEqual(got.rows.map((r) => r.decision), ['argmax', 'vote', 'argmax'],
        'the middle record is the vote — a fact only the write order carries');
      assert.deepStrictEqual(got.rows.map((r) => r.weekdaysOnly), [false, false, true]);
      assert.strictEqual(got.namesFrom, 'recovered', 'the screen is told these names were recovered, not written');
      assert.strictEqual(got.unnamedRecords, 0);
    } finally {
      rowstore.remove(runId);
    }
  },

  askingForRecordsKicksTheRecoveryWhenThereIsNone() {
    const runId = `cho-kick-${process.pid}`;
    try {
      writeFixture(runId);
      replication.buildAndSaveTotals(runId);
      const doc = { id: runId, status: 'done', leaders: [] };
      const got = replication.coinRows(doc, { label: 'q1', trade: 'AAAUSDT', geometry: 'daily-3d' });
      assert.ok(got.recovery && got.recovery.going === true,
        'no recovered names exist yet — the ask must start the recovery and say so');
      assert.strictEqual(got.namesFrom, null, 'and nothing is served as named meanwhile');
    } finally {
      rowstore.remove(runId);
    }
  },

  rowsThatCarryTheirOwnNamesNeverTouchTheRecovery() {
    const runId = `cho-inline-${process.pid}`;
    try {
      const w = rowstore.writer(runId, 'replication');
      w.push(repRow('q1', { decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, key: 'kk' }));
      w.close();
      replication.buildAndSaveTotals(runId);
      const doc = { id: runId, status: 'done', leaders: [] };
      const got = replication.coinRows(doc, { label: 'q1', trade: 'AAAUSDT', geometry: 'daily-3d' });
      assert.strictEqual(got.namesFrom, 'rows', 'a run recorded from 2026-08-26 names its own records');
      assert.strictEqual(choices.buildState(runId), null, 'and no recovery was started for it');
    } finally {
      rowstore.remove(runId);
    }
  },
};
