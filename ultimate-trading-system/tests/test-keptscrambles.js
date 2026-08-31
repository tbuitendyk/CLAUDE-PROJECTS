// THE KEPT SCRAMBLES — a whole second copy of Table 3.A and Table 3.B made of
// luck, so every reading the Funnel takes can be taken twice (FUNNEL-DESIGN.md
// section 4.5; owner order 2026-08-31, "keep 10, do all of it, backfill
// included").
//
// What is NOT covered here, said plainly rather than left to be discovered:
// there is no headless fixture for a whole stage 3 unit, so nothing below
// prices anything. The arithmetic of the fold, the merge, the drain and the
// launch refusal are exercised for real; that the test window is scrambled at
// all is a source scan, and it is marked as one.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sw = require('../lib/stagework');
const stages = require('../lib/stages');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stagework.js'), 'utf8');

const rowsWithNoise = (keep) => {
  const rows = [];
  for (let i = 0; i < 12; i++) {
    rows.push({
      si: i % 3, label: `q2/6 x t${i}h · argmax auto 24/7`, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false,
      entry: 'breakout', gate: 'directional', dMult: 1.5, tHours: 17, trailMult: null, armMult: null,
      members: 6, pnl: i, trades: 1,
      holdout: { pnl: i - 5, trades: 2, stops: 0, vsAlwaysLong: i - 6 },
      beat: i % 10, pairs: 9, lead: (i - 4) / 2,
      trade: i % 2 ? 'AAA' : 'BBB', ctx1: null, ctx2: null, geometry: 'daily-1d',
      // position matters: scramble 0 is always small, scramble 2 always large,
      // so a fold that added the wrong index could not come out right by luck
      noiseTest: keep ? Array.from({ length: keep }, (_, d) => i + d * 100) : null,
      noiseHold: keep ? Array.from({ length: keep }, (_, d) => -i - d * 100) : null,
    });
  }
  return rows;
};

module.exports = {
  // Scramble 3 of one setting shares its calendar with scramble 3 of every
  // other setting on the unit. That is the only reason an all-luck copy of the
  // table means anything, so position must survive the fold, the worker
  // boundary and the merge — not just the totals.
  theKeptScramblesKeepTheirPositionThroughTheShardedFold() {
    const rows = rowsWithNoise(3);
    const one = sw.newTallyAcc();
    rows.forEach((r, i) => sw.tallyFold(one, r, Math.floor(i / 4)));
    const merged = sw.newTallyAcc();
    for (let shard = 0; shard < 3; shard++) {
      const part = sw.newTallyAcc();
      rows.slice(shard * 4, shard * 4 + 4).forEach((r) => sw.tallyFold(part, r, shard));
      sw.mergeTallyAcc(merged, JSON.parse(JSON.stringify(sw.serializeTallyAcc(part))));
    }
    const norm = (acc) => {
      const o = sw.serializeTallyAcc(acc);
      o.perSetting.sort((a, b) => a.si - b.si);
      for (const st of o.perSetting) st.perCoin.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      o.perCoin.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      for (const [, k] of o.perCoin) k.b.sort((x, y) => x - y);
      return o;
    };
    assert.deepStrictEqual(norm(merged), norm(one), 'the sharded fold must be the single-pass fold, exactly');
    // and the positions are 100 apart, as they were built, not pooled into one
    const cell = [...one.perSetting.values()][0].perCoin.values().next().value;
    assert.strictEqual(cell.nt.length, 3, 'three kept scrambles must stay three columns');
    const means = sw.meanNoise([cell], 'nt');
    assert.ok(means[1] - means[0] === 100 && means[2] - means[1] === 100,
      `each scramble must average on its own: got ${JSON.stringify(means)}`);
  },

  // A set priced before the column existed has no value here, and a column
  // with no value reads as ABSENT. Zero is a number a reader would plot.
  aSetWithNothingKeptReadsAsAbsentNotZero() {
    const acc = sw.newTallyAcc();
    rowsWithNoise(0).forEach((r, i) => sw.tallyFold(acc, r, i));
    for (const st of acc.perSetting.values()) {
      for (const c of st.perCoin.values()) {
        assert.strictEqual(sw.meanNoise([c], 'nt'), null, 'nothing kept must read as null, never as 0');
        assert.strictEqual(sw.meanNoise([c], 'nh'), null, 'nothing kept must read as null, never as 0');
      }
    }
  },

  // Both tables are views over the same rows, so both must gain the column or
  // one of them silently has no all-luck twin.
  bothStageThreeTablesCarryTheKeptScrambles() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
    // TWO of each, one per table. Counted rather than merely found, because
    // "it is in the file somewhere" is exactly how the second table gets
    // forgotten while the check still passes.
    // Two drains, one per table, plus the fill which writes the two stored
    // columns onto the rows it rewrites. noisePairs is not stored on a row --
    // the tally counts it from the array it just read -- so it stays at two.
    for (const [field, want] of [['noiseTest:', 3], ['noiseHold:', 3], ['noisePairs:', 2]]) {
      const n = src.split(field).length - 1;
      assert.strictEqual(n, want, `${field} is written in ${n} place(s), expected ${want} — `
        + 'either a table was forgotten or a second writer appeared that nothing keeps in step');
    }
    // beatNoise also names itself in the sort table and the share-field table,
    // so the two drains are found by the money each of them compares against
    assert.ok(src.includes('avgTest > v'), 'Table 3.A must count what its real test money beat');
    assert.ok(src.includes('kTest > v'), 'Table 3.B must count what its real test money beat');
    assert.ok(src.includes("beatNoise: 'share'"), 'the new column must be rankable on Table 3.A');
    assert.ok(src.includes("'beatnoise'"), 'the new column must be rankable on Table 3.B');
    assert.ok(src.includes("beatNoiseMin: ['_beatNoisePct', 'min']"), 'Table 3.A must offer a floor on it');
    assert.ok(src.includes("minBeatNoise: ['_beatNoisePct', 'min']"), 'Table 3.B must offer a floor on it');
  },

  // A document that says ten and rows that carry four is a set every later
  // reader has to distrust, and the reader that averages the short array will
  // not notice. So it refuses at launch, in a sentence that names both numbers.
  theLaunchRefusesToKeepMoreScramblesThanItMakes() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
    assert.ok(src.includes('if (keepN > nullN) {'), 'the launch must compare what is kept against what is made');
    assert.ok(src.includes('there are only as many scrambles to keep as the null set has'),
      'the refusal must say why, not just fail');
    assert.ok(src.includes('keepN: agreedOnly ? 0 :'),
      'every payload must take the kept count from the set document, so a fill-in prices as the first rows did');
  },

  // THE THING THE DESIGN HAD BACKWARDS. Nothing has ever scrambled the test
  // window — every test call passed deal index -1, the real calendar — and the
  // Funnel reads test money on purpose, so the held-back window stays sealed
  // until step 7. A twin drawn from the held-back window would open the seal
  // to decide what to look at. SOURCE SCAN: there is no headless fixture for a
  // stage 3 unit, so this reads the code rather than pricing anything.
  theTestWindowIsActuallyScrambled() {
    assert.ok(SRC.includes("streamFor(stream.decision, agr, d, 'test')"),
      'the kept scrambles must be priced on the TEST window with a real deal index');
    assert.ok(SRC.includes("if (d < keep) noiseHold.push(cents(dRes.pnl))"),
      'the held-back scrambles are already priced to work out beat — keeping them must cost no pricing');
  },

  // 623 characters a row, and a raw double is 18 of them made mostly of noise
  // that gzip finds no repetition in. These figures are only averaged, curved,
  // gridded and searched for a region.
  keptScrambleMoneyIsStoredToTheCent() {
    assert.strictEqual(sw.cents(-66.03468938636131), -66.03);
    assert.strictEqual(sw.cents(0), 0);
    assert.strictEqual(sw.cents(null), null);
    assert.strictEqual(sw.cents(Infinity), null, 'a figure that is not finite must not be written down as one');
    assert.strictEqual(sw.cents(NaN), null);
  },

  // A run that keeps ten and stamps "none" would fill every column and still
  // tell the Funnel there is nothing to compare against. Both the launch and
  // the fill must write the shape the Funnel actually asks.
  whatWasKeptIsStampedInTheShapeTheFunnelReads() {
    assert.deepStrictEqual(stages.noiseTwinOf({ boardNull: { captured: true, kept: 10, why: null } }),
      { available: true, why: null }, 'a set that kept scrambles must read as having a comparison');
    const none = stages.noiseTwinOf({ boardNull: { captured: false, kept: 0, why: 'kept none' } });
    assert.strictEqual(none.available, false);
    assert.ok(none.why, 'the absence must be named, never left blank');
    assert.throws(() => stages.noiseTwinOf({}), /no board-wide noise stamp/,
      'a set with no stamp must say so rather than read as "no comparison"');
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
    assert.ok(src.includes('boardNull: keepN > 0'), 'the launch must stamp what the run kept');
    assert.ok(src.includes("doc.boardNull = { captured: true, kept: keep"), 'the fill must stamp what it filled in');
  },

  // Six readings, one mechanism: every one of them is "run this on a table",
  // and a kept scramble IS a table. If the Funnel ever grew a second way of
  // building the comparison, the two would drift.
  theFunnelRunsTheSameReadingOnTheAllLuckCopy() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
    assert.ok(src.includes('const luckBoard = (d) => rows.map((r) => ({ ...r, avgTest:'),
      'the all-luck copy must be the same rows with the money swapped, not a separate calculation');
    for (const call of ['F.step1(luckBoard(0)', 'F.step2(luckBoard(0)', 'F.step3(luckBoard(0)', 'region(luckBoard(d))']) {
      assert.ok(src.includes(call), `${call} — that reading has no all-luck twin`);
    }
    // step 5 is the one that uses ALL of them, because "wider than all ten" is
    // the claim the count on Sweep is bought for
    assert.ok(src.includes('used: keptN'), 'the region reading must use every kept scramble, not one');
  },

  // RULE NINE: migrate beside, verify, then swap. Every block index already
  // recorded -- the per-unit ranges and the per-coin block lists in the totals
  // -- must still point where it did, so the block shape is checked too.
  theFillSwapsOnlyAfterTheRowsAndTheBlocksBothMatch() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
    const swapAt = src.indexOf('fs.renameSync(src, dst)');
    assert.ok(swapAt > 0, 'the fill must swap the store into place');
    const before = src.slice(0, swapAt);
    assert.ok(before.includes('nothing is swapped'), 'it must refuse rather than swap a store that does not match');
    assert.ok(before.lastIndexOf('before !== after') > 0, 'the row count must be checked before the swap');
    assert.ok(before.lastIndexOf('sameShape') > 0, 'the block boundaries must be checked before the swap');
    assert.ok(before.lastIndexOf('> 0.01') > 0, 'the fill must prove itself against the money already stored');
    // and everything derived is deleted, never translated
    assert.ok(src.slice(swapAt).includes('fs.rmSync(tallyFile(id)'), 'the totals must be rebuilt, not migrated');
  },

  // A BUG THIS NEARLY SHIPPED WITH. The first draft of the fill walked the
  // store by a per-unit block range read off `rec.blocks.records` -- but those
  // records come from the PARENT set, so that range described the parent's
  // votes, not this set's rows. Stage 3 records no per-unit range at all:
  // every other reader of this store takes the unit from the row's own `u`.
  theFillTakesTheUnitFromTheRowAndNotFromTheParentsBlockRanges() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
    const fill = src.slice(src.indexOf('async function startKeptScrambleFill'));
    const body = fill.slice(0, fill.indexOf('\nasync function ', 1) + 1 || undefined);
    assert.ok(body.includes('const u = x.row.u;'), 'the fill must take each row\'s unit from the row');
    assert.ok(!/rec\.blocks\s*&&\s*rec\.blocks\.records/.test(body),
      'the fill must not read a per-unit block range off the parent\'s records — stage 3 does not record one');
    assert.ok(body.includes('appears again after the walk moved past it'),
      'if the store is ever not in unit order the fill must say so, not silently re-price or mis-join');
  },

  // The tally's shape changed, so every totals file on disk must be rebuilt
  // rather than read (RULE NINE: derived files are deleted and rebuilt).
  theTallyVersionMovedWithItsShape() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
    const m = src.match(/const TALLY_V = (\d+);/);
    assert.ok(m, 'the tally must carry a version');
    assert.ok(Number(m[1]) >= 6, `the tally gained two columns, so its version must have moved: found ${m[1]}`);
    assert.ok(typeof stages.readTally === 'function', 'the tally reader must still exist');
  },
};
