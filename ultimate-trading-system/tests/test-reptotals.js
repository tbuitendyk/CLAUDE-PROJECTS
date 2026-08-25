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
const row = (label, trade, seed, holdPnl, vsL) => ({
  declaredLabel: label,
  trade,
  ctx1: '',
  ctx2: '',
  geometry: 'daily-3d',
  nullDealSeed: seed,
  holdout: holdPnl == null ? null : { pnl: holdPnl, vsAlwaysLong: vsL ?? null },
});
// Order matters to nothing but the pairing bookkeeping: copies of q1/A arrive
// BEFORE its real row on purpose, so the pending path is exercised.
const FIXTURE = [
  row('q1', 'AAAUSDT', 1, 5),        // copy before its real: pending path
  row('q1', 'AAAUSDT', 2, 15),       // copy that beats the real
  row('q1', 'AAAUSDT', null, 10, 3), // real: beats 5, loses to 15 -> 1/2
  row('q1', 'BBBUSDT', null, -4, -1),// real, negative
  row('q1', 'BBBUSDT', 1, -6),       // copy after real: -4 > -6 -> 2/3 total
  row('q1', 'CCCUSDT', null, null),  // real with no held-back money at all
  row('q2', 'AAAUSDT', null, 7, 2),  // q2: one real, one copy, real wins
  row('q2', 'AAAUSDT', 1, 6),
];
// Hand-worked truth for q1: assets 3, holdCount 2 (CCC has no money), pos 1,
// sum 6, vsL 2 counted 1 positive, nullPairs 3, nullBeat 2.
// q2: assets 1, holdCount 1, pos 1, sum 7, pairs 1, beat 1 -> share 1.0, so q2
// sorts FIRST (higher measured-null share than q1's 2/3).

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
