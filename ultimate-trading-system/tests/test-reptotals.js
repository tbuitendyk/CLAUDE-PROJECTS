// THE SAVED TALLY SAYS EXACTLY WHAT THE FULL READ SAID (owner order,
// 2026-08-25: "do the running tallies now").
//
// The replication table used to be totalled by reading every recorded row on
// request, on the thread that answers every page — ten minutes of nothing
// answering on the owner's run. Now the tally is built once, off that thread,
// and saved beside the rows. What these tests protect:
//
//   * ONE definition. The numbers come out of tallyOver wherever they are
//     asked for; the expected values here are worked out BY HAND on a fixture
//     small enough to check with a pencil, so the definition itself is pinned,
//     not merely two copies compared to each other.
//   * A saved tally is served only for the rows it covers. Behind is said out
//     loud, never worn as finished.
//   * The build runs off the answering thread and lands the same numbers.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { assert } = require('./helpers');

const replication = require('../lib/replication');

// Three assets, two configurations, held-back money chosen so every count
// below can be checked by hand. Real rows carry nullDealSeed null, copies 1-2.
const row = (label, trade, seed, holdPnl, vsL, trades) => ({
  declaredLabel: label,
  trade,
  ctx1: '',
  ctx2: '',
  geometry: 'daily-3d',
  nullDealSeed: seed,
  holdout: holdPnl == null ? null : { pnl: holdPnl, vsAlwaysLong: vsL ?? null, trades: trades ?? null },
});
// Order matters to nothing but the pairing bookkeeping: copies of q1/A arrive
// BEFORE its real row on purpose, so the pending path is exercised.
const FIXTURE = [
  row('q1', 'AAAUSDT', 1, 5),           // copy before its real: pending path
  row('q1', 'AAAUSDT', 2, 15),          // copy that beats the real
  row('q1', 'AAAUSDT', null, 10, 3, 4), // real: beats 5, loses to 15 -> 1/2
  row('q1', 'BBBUSDT', null, -4, -1, 2),// real, negative
  row('q1', 'BBBUSDT', 1, -6),          // copy after real: -4 > -6 -> 2/3 total
  row('q1', 'CCCUSDT', null, null),     // real with no held-back money at all
  row('q2', 'AAAUSDT', null, 7, 2, 6),  // q2: one real, one copy, real wins
  row('q2', 'AAAUSDT', 1, 6, null, 99), // a copy's trades must never enter the averages
];
// Hand-worked truth for q1: assets 3, holdCount 2 (CCC has no money), pos 1,
// sum 6, vsL 2 counted 1 positive, nullPairs 3, nullBeat 2.
// q2: assets 1, holdCount 1, pos 1, sum 7, pairs 1, beat 1 -> share 1.0, so q2
// sorts FIRST (higher measured-null share than q1's 2/3).
// Averages, per coin (owner order, 2026-08-25): q1 on AAA holds 1 row of $10
// and 4 trades; q1 on BBB one row of -$4 and 2 trades; q1 on CCC recorded no
// held-back money so its averages are honestly absent; q2 on AAA $7 and 6
// trades — the copy's 99 trades belong to the pairing, never the averages.

function tallyFixture(rows) {
  return replication.tallyOver((fn) => { for (const r of rows) if (fn(r) === false) return; });
}

module.exports = {
  theTallyMatchesThePencil() {
    const t = tallyFixture(FIXTURE);
    assert.strictEqual(t.tagged, true);
    assert.strictEqual(t.rowsSeen, 8);
    const scored = replication.renderScored(t, []);
    assert.deepStrictEqual(scored.map((g) => g.label), ['q2', 'q1'],
      'the measured null leads the order: a 1/1 beats a 2/3');
    const q1 = scored.find((g) => g.label === 'q1');
    assert.strictEqual(q1.assets, 3, 'CCC has no money but is still an asset the config was scored on');
    assert.strictEqual(q1.holdCount, 2);
    assert.strictEqual(q1.pos, 1);
    assert.strictEqual(q1.sum, 6);
    assert.strictEqual(q1.vsLCount, 2);
    assert.strictEqual(q1.vsLPos, 1);
    assert.strictEqual(q1.nullPairs, 3, 'a copy arriving before its real row still pairs');
    assert.strictEqual(q1.nullBeat, 2);
    const q2 = scored.find((g) => g.label === 'q2');
    assert.strictEqual(q2.nullPairs, 1);
    assert.strictEqual(q2.nullBeat, 1);
  },

  // THE PER-COIN SCORE (owner order, 2026-08-25: "we need to add the per-coin
  // score... easily viewable and sortable FROM THE ENTIRE DATA SET"). Same
  // pencil, sliced by coin: q1 on AAA is 1 beat of 2 pairs, q1 on BBB is 1 of
  // 1, and the whole-configuration figures must be exactly the sums of these —
  // one set of counts, sliced twice, or the two views could disagree.
  thePerCoinScoreMatchesThePencilAndSumsToTheConfiguration() {
    const t = tallyFixture(FIXTURE);
    const flat = replication.coinsFrom(t, {});
    const at = (label, trade) => flat.rows.find((r) => r.label === label && r.trade === trade);
    assert.deepStrictEqual(
      { beat: at('q1', 'AAAUSDT').beat, pairs: at('q1', 'AAAUSDT').pairs },
      { beat: 1, pairs: 2 }, 'q1 on AAA: real 10 beats the 5, loses to the 15');
    assert.deepStrictEqual(
      { beat: at('q1', 'BBBUSDT').beat, pairs: at('q1', 'BBBUSDT').pairs },
      { beat: 1, pairs: 1 }, 'q1 on BBB: real -4 beats the -6');
    assert.strictEqual(at('q1', 'CCCUSDT').pairs, 0, 'no money on CCC, no head-to-heads');
    assert.strictEqual(at('q1', 'CCCUSDT').share, null, 'and no share is invented for it');
    assert.strictEqual(at('q2', 'AAAUSDT').share, 1, 'q2 on AAA won its only head-to-head');
    // the whole-configuration line is the sum of its coins, exactly
    const q1 = replication.renderScored(t, []).find((g) => g.label === 'q1');
    const q1coins = flat.rows.filter((r) => r.label === 'q1');
    assert.strictEqual(q1.nullBeat, q1coins.reduce((n, r) => n + r.beat, 0));
    assert.strictEqual(q1.nullPairs, q1coins.reduce((n, r) => n + r.pairs, 0));
    assert.strictEqual(q1.sum, q1coins.reduce((n, r) => n + r.sum, 0));
    // the default order: share first, more comparisons breaking ties, and a
    // row with no head-to-heads at the bottom rather than sorted as zero
    assert.deepStrictEqual(flat.rows.map((r) => `${r.label}|${r.trade}`),
      ['q2|AAAUSDT', 'q1|BBBUSDT', 'q1|AAAUSDT', 'q1|CCCUSDT'],
      'share desc, then comparisons, the un-measured row last');
  },

  // THE AVERAGES (owner order, 2026-08-25: "change the held-back column to
  // avg held-back so we're dividing by 16 or 8 and the info becomes useful.
  // show also the avg trades"). The divisor is the rows that recorded a
  // held-back number, a copy's trades never enter, and a coin that recorded
  // no held-back money averages to nothing rather than to zero.
  theAveragesMatchThePencil() {
    const t = tallyFixture(FIXTURE);
    const flat = replication.coinsFrom(t, {});
    const at = (label, trade) => flat.rows.find((r) => r.label === label && r.trade === trade);
    assert.strictEqual(at('q1', 'AAAUSDT').avgHold, 10, 'one row of $10: the average IS the row');
    assert.strictEqual(at('q1', 'AAAUSDT').avgTrades, 4);
    assert.strictEqual(at('q1', 'BBBUSDT').avgHold, -4);
    assert.strictEqual(at('q1', 'BBBUSDT').avgTrades, 2);
    assert.strictEqual(at('q1', 'CCCUSDT').avgHold, null, 'no held-back money, no invented average');
    assert.strictEqual(at('q1', 'CCCUSDT').avgTrades, null);
    assert.strictEqual(at('q2', 'AAAUSDT').avgHold, 7);
    assert.strictEqual(at('q2', 'AAAUSDT').avgTrades, 6, "the copy's 99 trades stayed out of the average");
    // the money order leads on the AVERAGE, so a 16-row coin cannot outrank an
    // 8-row coin just by having more rows to sum
    assert.deepStrictEqual(replication.coinsFrom(t, { sort: 'money' }).rows.map((r) => `${r.label}|${r.trade}`),
      ['q1|AAAUSDT', 'q2|AAAUSDT', 'q1|BBBUSDT', 'q1|CCCUSDT'],
      'avg held-back descending, the un-measured row last');
    // A DIVISOR OF TWO, because on the fixture above every coin holds exactly
    // one row — there the average EQUALS the sum, and a deleted division
    // would pass every assert while serving 16-row sums as averages. Two real
    // rows of the same configuration on the same coin (which is precisely
    // what the 16-rows case is) pin the division itself.
    const two = tallyFixture([...FIXTURE, row('q2', 'AAAUSDT', null, 3, 1, 2)]);
    const q2two = replication.coinsFrom(two, {}).rows.find((r) => r.label === 'q2' && r.trade === 'AAAUSDT');
    assert.strictEqual(q2two.rows, 2);
    assert.strictEqual(q2two.sum, 10, 'the sum still travels with the row');
    assert.strictEqual(q2two.avgHold, 5, '(7 + 3) / 2 — the average divides, it does not sum');
    assert.strictEqual(q2two.avgTrades, 4, '(6 + 2) / 2');
  },

  // THE RECORDS BEHIND ONE COIN ROW (owner order, 2026-08-25: "allow an
  // open-records-below arrow that expands to the detail records"). The saved
  // tally remembers WHICH blocks of the store hold each coin's real rows, and
  // coinRows() unpacks exactly those — never a walk over the whole store,
  // which is the ten-minute freeze this file exists to prevent.
  theRecordsBehindACoinRowComeFromOnlyItsBlocks() {
    const rowstore = require('../lib/rowstore');
    const runId = `tot-blk-${process.pid}`;
    const w = rowstore.writer(runId, 'replication');
    // Two blocks by hand: q1's rows in the first, q2's in the second. The q2
    // real row carries the named choices a run records from 2026-08-26, so
    // the roundtrip store -> block read -> screen payload is proved whole.
    for (const r of FIXTURE.slice(0, 6)) w.push(r);
    w.flush();
    w.push({ ...FIXTURE[6], decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, key: 'AAAUSDT|||daily-3d|argmax|auto|24-7' });
    w.push(FIXTURE[7]);
    w.close();
    try {
      const blocks = rowstore.blocksOf(runId, 'replication');
      assert.strictEqual(blocks.length, 2, 'the fixture did not land as two blocks — the test is not testing targeting');
      const totals = replication.buildAndSaveTotals(runId);
      const q2a = totals.groups.find((g) => g.label === 'q2').assets['AAAUSDT|||daily-3d'];
      assert.deepStrictEqual(q2a.b, [1], "q2's one real row lives in the second block, and the save knows it");
      assert.strictEqual(q2a.at, undefined, 'row positions never reach the saved file — blocks do');
      assert.strictEqual(q2a.t, 6, 'the held-back trades travel with the tally');
      const q1a = totals.groups.find((g) => g.label === 'q1').assets['AAAUSDT|||daily-3d'];
      assert.deepStrictEqual(q1a.b, [0]);
      // readBlocks itself: the named block's rows, decoded exactly.
      const second = rowstore.readBlocks(runId, 'replication', [1]);
      assert.strictEqual(second.length, 2, 'the second block holds the two q2 rows');
      assert.strictEqual(second[0].holdout.pnl, 7, 'rows decode with their nulls and nesting intact');
      assert.strictEqual(second[0].nullDealSeed, null, 'a written null reads back as null, not as missing');
      // coinRows reads ONLY the blocks the save names, through ONE readBlocks
      // call — never page() or each(), whose per-call sidecar parse is what
      // cost three seconds for sixteen records on the box.
      const doc = { id: runId, status: 'done', leaders: [] };
      const asked = [];
      const realRead = rowstore.readBlocks;
      const realPage = rowstore.page;
      const realEach = rowstore.each;
      rowstore.readBlocks = (id, name, indexes) => { asked.push(indexes); return realRead(id, name, indexes); };
      rowstore.page = () => { throw new Error('coinRows went through page()'); };
      rowstore.each = () => { throw new Error('coinRows walked the store'); };
      let got;
      try {
        got = replication.coinRows(doc, { label: 'q2', trade: 'AAAUSDT', geometry: 'daily-3d' });
      } finally {
        rowstore.readBlocks = realRead;
        rowstore.page = realPage;
        rowstore.each = realEach;
      }
      assert.deepStrictEqual(asked, [[1]],
        'the records were not read from exactly the one block that holds them');
      assert.strictEqual(got.indexed, true);
      assert.strictEqual(got.rows.length, 1, 'one real row — the copy beside it stays machinery');
      assert.strictEqual(got.rows[0].holdout.pnl, 7);
      // the named choices ride the record all the way to the screen's payload
      // (owner order, 2026-08-26: "knowing the actual choices is essential")
      assert.strictEqual(got.rows[0].decision, 'argmax');
      assert.strictEqual(got.rows[0].bandMode, 'auto');
      assert.strictEqual(got.rows[0].weekdaysOnly, false, 'false is a recorded choice, not a missing one');
      // a real row with no held-back money is still a record the reader gets
      const ccc = replication.coinRows(doc, { label: 'q1', trade: 'CCCUSDT', geometry: 'daily-3d' });
      assert.strictEqual(ccc.rows.length, 1);
      assert.strictEqual(ccc.rows[0].holdout, null);
      // and a coin the run never scored answers empty rather than erroring
      assert.strictEqual(replication.coinRows(doc, { label: 'q9', trade: 'ZZZUSDT', geometry: 'daily-3d' }).rows.length, 0);
    } finally {
      rowstore.remove(runId);
    }
  },

  // A save from before the averages and the record index (v2) draws nothing
  // here as fresh: the coin view reports the rebuild and the records say why
  // they cannot be fetched yet, rather than either wearing a v3 face.
  aV2SaveRebuildsForTheAveragesAndTheRecords() {
    const rowstore = require('../lib/rowstore');
    const runId = `tot-v2-${process.pid}`;
    const w = rowstore.writer(runId, 'replication');
    for (const r of FIXTURE) w.push(r);
    w.close();
    try {
      const doc = { id: runId, status: 'done', leaders: [] };
      replication.writeTotals(runId, {
        v: 2, builtAt: new Date().toISOString(), tagged: true, dropped: 0, rowsSeen: 8,
        groups: [{ label: 'q2', vsLCount: 1, vsLPos: 1, realsTotal: 1, assets: { 'AAAUSDT|||daily-3d': { n: 1, hold: 1, pos: 1, sum: 7, beat: 1, pairs: 1 } } }],
      });
      const flat = replication.coins(doc, {});
      assert.ok(!(flat.totals && flat.totals.upToDate === true),
        'a save from before the averages was served to the coin view as fresh');
      const rec = replication.coinRows(doc, { label: 'q2', trade: 'AAAUSDT', geometry: 'daily-3d' });
      assert.strictEqual(rec.indexed, false, 'records fetched off a save that carries no record index');
      assert.ok(rec.why, 'and the screen is told why, not just refused');
      // the whole-configuration table above still serves the old save while
      // the rebuild goes — nothing regresses
      const table = replication.rank(doc, {});
      assert.strictEqual(table.totals.upToDate, true);
    } finally {
      rowstore.remove(runId);
    }
  },

  // THE PARSED TALLY IS HELD, NOT RE-PARSED (owner order, 2026-08-26: "do the
  // totals cache"). Every ask used to parse the 235,620-entry file again on
  // the answering thread. The slot serves the same parsed object while the
  // file is unchanged, drops it the moment the file changes — however it
  // changed, this thread or the build worker — and holds ONE run only.
  theTotalsAreParsedOnceAndNeverServedStale() {
    const rowstore = require('../lib/rowstore');
    const runA = `tot-cch-a-${process.pid}`;
    const runB = `tot-cch-b-${process.pid}`;
    try {
      const t = tallyFixture(FIXTURE);
      replication.writeTotals(runA, t);
      const first = replication.readTotals(runA);
      assert.strictEqual(replication.readTotals(runA), first,
        'two asks of an unchanged file returned different objects — every ask is paying the parse again');
      // a write that does NOT go through this thread's writeTotals — the
      // build worker's write looks exactly like this — must be picked up
      const changed = { ...t, rowsSeen: 9999 };
      const fs2 = require('fs');
      fs2.writeFileSync(replication.totalsFile(runA), JSON.stringify(changed));
      assert.strictEqual(replication.readTotals(runA).rowsSeen, 9999,
        'the file changed on disk and the slot served yesterday\'s tally over it');
      // one slot: asking for another run evicts, and the first still answers
      // correctly afterwards — from a fresh parse, not from memory
      replication.writeTotals(runB, { ...t, rowsSeen: 8 });
      assert.strictEqual(replication.readTotals(runB).rowsSeen, 8);
      assert.strictEqual(replication.readTotals(runA).rowsSeen, 9999,
        'after eviction the first run must answer from its file, whole');
      // ...and that re-parse refills the slot: the next ask serves the same
      // object, or reading is paying the parse on every ask again
      assert.strictEqual(replication.readTotals(runA), replication.readTotals(runA),
        'a re-parse after eviction was not held — every ask parses again');
      // and a run whose file is gone answers null, dropping anything held
      rowstore.remove(runA);
      assert.strictEqual(replication.readTotals(runA), null);
    } finally {
      rowstore.remove(runA);
      rowstore.remove(runB);
    }
  },

  // The floor hides nothing silently, and the ordering is made over the whole
  // set before the page is cut — page two continues page one's order.
  theFloorSaysWhatItRemovedAndPagesContinueOneOrder() {
    const t = tallyFixture(FIXTURE);
    const floored = replication.coinsFrom(t, { minPairs: 2 });
    assert.strictEqual(floored.rows.length, 1, 'only q1 on AAA has two or more head-to-heads');
    assert.strictEqual(floored.narrowedOut, 3, 'the floor says how many rows it removed');
    const p1 = replication.coinsFrom(t, { offset: 0, limit: 2 });
    const p2 = replication.coinsFrom(t, { offset: 2, limit: 2 });
    // Against the KNOWN order, not against another call of the same function —
    // compared to itself this passed with the sort deleted outright, because
    // both sides were equally unsorted (caught by the mutation harness,
    // 2026-08-25).
    assert.deepStrictEqual(
      [...p1.rows, ...p2.rows].map((r) => `${r.label}|${r.trade}`),
      ['q2|AAAUSDT', 'q1|BBBUSDT', 'q1|AAAUSDT', 'q1|CCCUSDT'],
      'two pages, one ordering — the sort happens over everything before the cut');
    assert.strictEqual(p1.page.total, 4, 'a page never hides how many rows there really are');
    // and an unknown sort name falls back to the default rather than throwing
    assert.strictEqual(replication.coinsFrom(t, { sort: 'nonsense' }).sort, 'share');
  },

  // A tally saved before the per-coin score exists (v1) can still draw the
  // whole-configuration table, but the per-coin view treats it as behind and
  // rebuilds — served fresh it would show every coin as having no score.
  aTallyFromBeforeThePerCoinScoreRebuildsForTheCoinView() {
    const rowstore = require('../lib/rowstore');
    const runId = `tot-v1-${process.pid}`;
    const w = rowstore.writer(runId, 'replication');
    for (const r of FIXTURE) w.push(r);
    w.close();
    try {
      const doc = { id: runId, status: 'done', leaders: [] };
      replication.writeTotals(runId, {
        v: 1, builtAt: new Date().toISOString(), tagged: true, dropped: 0, rowsSeen: 8,
        groups: [{ label: 'q1', holdCount: 2, pos: 1, vsLCount: 2, vsLPos: 1, sum: 6, assetRows: { 'AAAUSDT|||daily-3d': 1, 'BBBUSDT|||daily-3d': 1, 'CCCUSDT|||daily-3d': 1 }, nullBeat: 2, nullPairs: 3, realsTotal: 3 },
          { label: 'q2', holdCount: 1, pos: 1, vsLCount: 1, vsLPos: 1, sum: 7, assetRows: { 'AAAUSDT|||daily-3d': 1 }, nullBeat: 1, nullPairs: 1, realsTotal: 1 }],
      });
      const table = replication.rank(doc, {});
      assert.strictEqual(table.totals.upToDate, true, 'the old save still draws the table it always drew');
      assert.strictEqual(table.scored[0].label, 'q2');
      const flat = replication.coins(doc, {});
      assert.ok(flat.building || flat.totals === undefined || flat.totals.upToDate !== true,
        `the per-coin view served a save that predates the per-coin score as fresh: ${JSON.stringify(flat).slice(0, 200)}`);
      assert.deepStrictEqual(flat.rows, [], 'no per-coin rows exist in a v1 save to serve');
      // once rebuilt, the view fills in
      replication.buildAndSaveTotals(runId);
      const after = replication.coins(doc, {});
      assert.strictEqual(after.totals.upToDate, true);
      assert.strictEqual(after.rows.length, 4);
    } finally {
      rowstore.remove(runId);
    }
  },

  // Widths join in at reading time from the CURRENT leader rows — they sharpen
  // while a run goes, so baking them into a saved tally would freeze them.
  theWidthsComeFromTheLeadersAtReadingTimeNotFromTheSave() {
    const t = tallyFixture(FIXTURE);
    const before = replication.renderScored(t, []);
    assert.strictEqual(before[1].region, null, 'no leader rows: no width, honestly');
    const leaders = [
      { nullDealSeed: null, trade: 'AAAUSDT', ctx1: '', ctx2: '', geometry: 'daily-3d', region: { size: 8 } },
      { nullDealSeed: null, trade: 'BBBUSDT', ctx1: '', ctx2: '', geometry: 'daily-3d', region: { size: 4 } },
    ];
    const after = replication.renderScored(t, leaders);
    const q1 = after.find((g) => g.label === 'q1');
    // q1 has one real row on each of AAA (8) and BBB (4) and one on CCC (no
    // width recorded): (8 + 4) / 2 = 6.
    assert.strictEqual(q1.region, 6, 'the width is the mean over real rows whose asset has one');
    // ...and the SAME save renders differently as the leaders sharpen, which is
    // the property that lets the tally be saved at all.
    const sharper = replication.renderScored(t, [{ ...leaders[0], region: { size: 20 } }, leaders[1]]);
    assert.strictEqual(sharper.find((g) => g.label === 'q1').region, 12);
  },

  // An untagged run (recorded before the copy tag) keeps its inferred-count
  // rule: first recorded row per asset·config is the real one, the rest drop.
  theUntaggedRuleStillHolds() {
    const untagged = FIXTURE.map(({ nullDealSeed, ...r }) => r);
    const t = tallyFixture(untagged);
    assert.strictEqual(t.tagged, false);
    assert.strictEqual(t.dropped, 4, 'the later rows of a seen asset+config drop, counted — AAA drops 2, BBB 1, q2s AAA 1');
    const q1 = replication.renderScored(t, []).find((g) => g.label === 'q1');
    assert.strictEqual(q1.nullPairs, 0, 'an untagged run can never claim a measured null');
  },

  // rank() over a docful of rows (a run recorded before the rows moved to
  // disk) goes through the SAME definition and comes back complete and fresh.
  async rankOnALegacyDocMatchesTheTally() {
    const doc = { id: 'no-such-run-on-disk', status: 'done', leaders: [], replication: FIXTURE };
    const out = replication.rank(doc, {});
    assert.strictEqual(out.total, 8);
    assert.strictEqual(out.configs, 2);
    assert.strictEqual(out.totals.upToDate, true);
    assert.deepStrictEqual(out.scored.map((g) => g.label), ['q2', 'q1']);
  },

  // The saved tally is served ONLY for the rows it covers. A save that is
  // behind comes back marked behind, with the build reported — never worn as
  // the finished table.
  async aSaveThatIsBehindSaysSoAndAFreshOneServesInstantly() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uts-tot-'));
    const realStoreDir = require('../lib/rowstore').storeDir;
    // Point the store at a scratch run without touching the real data folder.
    const rowstore = require('../lib/rowstore');
    const runId = `tot-test-${process.pid}`;
    const w = rowstore.writer(runId, 'replication');
    for (const r of FIXTURE) w.push(r);
    w.close();
    try {
      const doc = { id: runId, status: 'done', leaders: [], rowCounts: { replication: 8 } };
      // Fresh save: rank serves it instantly and says so.
      const totals = replication.buildAndSaveTotals(runId);
      assert.strictEqual(totals.rowsSeen, 8);
      const fresh = replication.rank(doc, {});
      assert.strictEqual(fresh.totals.upToDate, true);
      assert.deepStrictEqual(fresh.scored.map((g) => g.label), ['q2', 'q1']);
      // The run writes on: the save is now behind, and the reply says which
      // rows it covers instead of pretending.
      const w2 = rowstore.writer(runId, 'replication');
      w2.push(row('q1', 'AAAUSDT', 3, 25));
      w2.close();
      const behind = replication.rank({ ...doc, status: 'running' }, {});
      assert.strictEqual(behind.totals.upToDate, false, 'a save behind the rows was served as finished');
      assert.strictEqual(behind.totals.asOfRows, 8);
      assert.strictEqual(behind.total, 9, 'the true row count still travels');
      // ...and after a rebuild it is whole again, with the new copy paired in.
      const rebuilt = replication.buildAndSaveTotals(runId);
      assert.strictEqual(rebuilt.rowsSeen, 9);
      const again = replication.rank(doc, {});
      assert.strictEqual(again.totals.upToDate, true);
      const q1 = again.scored.find((g) => g.label === 'q1');
      assert.strictEqual(q1.nullPairs, 4, 'the late copy pairs against the real row it belongs to');
      assert.strictEqual(q1.nullBeat, 2, 'a copy at 25 is not beaten by a real at 10');
    } finally {
      rowstore.remove(runId);
      fs.rmSync(dir, { recursive: true, force: true });
      void realStoreDir;
    }
  },

  // THE RECORDED ROW NAMES ITS CHOICES (owner order, 2026-08-26: "if i'm
  // looking at a table to understand what settings appear to generate signal
  // ... knowing the actual choices is essential"). The write site had the
  // decision, band and 24/5 choices in hand and never wrote them, so the
  // records behind a coin were anonymous. Pinned at the write site, and the
  // screen must say plainly when an older run's rows do not carry them.
  theRecordedRowNamesItsChoices() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'batch.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
    const at = src.indexOf('rows.replication.push');
    const push = src.slice(at, src.indexOf('vsBuyHold', at));
    assert.ok(/decision: l\.decision \?\? null/.test(push)
      && /bandMode: l\.bandMode \?\? null/.test(push)
      && /weekdaysOnly: l\.weekdaysOnly \?\? null/.test(push)
      && /key: l\.key \?\? null/.test(push),
      'a recorded replication row no longer names the choices that made it');
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
    assert.ok(/>decision<\/th>/.test(page) && />24\/5<\/th>/.test(page),
      'the records table no longer shows the decision and 24/5 columns');
    assert.ok(/recorded before records carried their decision, band and 24\/5 choices/.test(page),
      'an older run\'s anonymous records are no longer said out loud — a dash with no reason reads as data');
  },

  // The full pass belongs OFF the thread that answers pages: the worker file
  // exists, goes through the shared build, and the run's completion fires it.
  theBuildRunsOffTheAnsweringThreadAndFiresAtCompletion() {
    const worker = fs.readFileSync(path.join(__dirname, '..', 'lib', 'replication-worker.js'), 'utf8');
    assert.ok(/buildAndSaveTotals/.test(worker), 'the worker no longer goes through the shared build');
    assert.ok(/threadNice/.test(worker), 'the build no longer runs at the kindest priority');
    const batch = fs.readFileSync(path.join(__dirname, '..', 'lib', 'batch.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
    assert.ok(/startTotals\(doc\.id\)/.test(batch),
      'a finishing run no longer totals itself — the first open pays the minutes instead');
    const rep = fs.readFileSync(path.join(__dirname, '..', 'lib', 'replication.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
    assert.ok(/new Worker\(path\.join\(__dirname, 'replication-worker\.js'\)/.test(rep),
      'startTotals no longer builds in a worker — the pass is back on the answering thread');
    // and the page keeps everything answering while it waits
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
    assert.ok(/got\.building/.test(page) && /setTimeout\(askRep, 15000\)/.test(page),
      'the Boards box no longer reports the background build and re-asks');
  },
};
