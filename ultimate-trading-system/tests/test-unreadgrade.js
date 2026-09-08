// THE RESERVE GRADE ON A STAGE 4 RECORD SET, priced for real (3.89.0,
// VERIFY-DESIGN.md section 6 and section 9 step 5). The stage engine is run
// on the two fabricated coins the stage-engine check uses -- stage 1, stage 2,
// a small stage 3, the declared rule cut into a Stage 4 set on the planted
// coin, the verdict pressed -- and then the grade is pressed on the unread
// window. Seconds, the same launches the check makes. The refusals in words
// are tests/test-funnelverify.js's; this file is the pricing.
//
// Watched failing while writing it: pricing the held-back window in the
// unread window's place gives every survivor a figure and the wrong window;
// forecasting with the stored votes instead of the saved models reaches past
// the end of the votes and prices nothing.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const stages = require('../lib/stages');
const sw = require('../lib/stagework');
const G = require('../lib/stagegate');
const Pl = require('../lib/planted');
const rowstore = require('../lib/rowstore');

const ROOT = path.join(__dirname, '..');
const SETS_DIR = path.join(ROOT, 'data', 'stagesets');

async function waitSet(id, label, ms = 10 * 60 * 1000) {
  const t0 = Date.now();
  for (;;) {
    const doc = stages.getSet(id);
    if (doc && doc.status !== 'running') return doc;
    if (Date.now() - t0 > ms) throw new Error(`${label} did not finish`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 250); });
  }
}
async function settle(statusOf, label) {
  for (let i = 0; i < 2400; i++) {
    const st = statusOf();
    if (st.error) throw new Error(`${label}: ${st.error}`);
    if (st.result) return st.result;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
  throw new Error(`${label} did not land`);
}
// the same launches the stage-engine check makes, on the same two coins
async function chain(tag) {
  const made = [];
  Pl.generateFabricated(G.SPAN, G.PLANT, G.SEEDS[G.PLANT], 0);
  Pl.generateFabricated(G.SPAN, G.FAIR, G.SEEDS[G.FAIR], 1);
  const s1 = stages.startStage1({ ...G.STAGE1, exam: true, name: `${tag} S1` });
  made.push(s1.id);
  const d1 = await waitSet(s1.id, 'stage 1');
  if (d1.status !== 'done') throw new Error(`stage 1 ended ${d1.status}: ${JSON.stringify(d1.failures || [])}`);
  const s2 = stages.startStage2({ ...G.STAGE2, from: s1.id, exam: true, name: `${tag} S2` });
  made.push(s2.id);
  const d2 = await waitSet(s2.id, 'stage 2');
  if (d2.status !== 'done') throw new Error(`stage 2 ended ${d2.status}: ${JSON.stringify(d2.failures || [])}`);
  const s3 = stages.startStage3({ ...G.STAGE3, from: s2.id, exam: true, name: `${tag} S3` });
  made.push(s3.id);
  const d3 = await waitSet(s3.id, 'stage 3');
  if (d3.status !== 'done') throw new Error(`stage 3 ended ${d3.status}: ${JSON.stringify(d3.failures || [])}`);
  const t = stages.readTally(s3.id) || await stages.buildTally(stages.getSet(s3.id));
  const units = stages.unitsOfSet(t, s3.id);
  const plant = (units.find((u) => u.trade === G.PLANT) || {}).key;
  if (!plant) throw new Error('the stage 3 set does not hold the planted coin');
  const cut = await stages.cutFunnelSet(s3.id, { rule: G.RULE, closing: { key: 'rule' }, unit: plant, barPct: 100, exam: true, name: `${tag} planted` });
  made.push(cut.id);
  const cleanup = () => {
    for (const id of made.slice().reverse()) {
      try { stages.deleteSet(id, id); } catch (_) { /* never written */ }
      try { fs.rmSync(stages.funnelRichFile(id), { force: true }); } catch (_) { /* none */ }
      try { fs.rmSync(path.join(SETS_DIR, `${id}-agreed.json.gz`), { force: true }); } catch (_) { /* none */ }
    }
    const { CACHE_DIR } = require('../lib/binance');
    let files = [];
    try { files = fs.readdirSync(CACHE_DIR); } catch (_) { files = []; }
    for (const f of files) {
      if (G.SYMBOLS.some((sym) => f.startsWith(`${sym}-1h-`))) { try { fs.rmSync(path.join(CACHE_DIR, f), { force: true }); } catch (_) { /* best effort */ } }
    }
  };
  return { s1: s1.id, s2: s2.id, s3: s3.id, cut, plant, cleanup };
}

module.exports = {
  // THE SAVED MODELS GIVE THE STORED VOTES BACK, AND THE UNREAD WINDOW IS
  // PRICED WITH THEM. Then the grade: refused until a verdict PASSED (the
  // engine's own verdict on the plant fails today, decision 76, so the gate is
  // opened by hand -- the refusal is the real one, the pricing path is what
  // is under test); the first look reads the sealed window from where the seal
  // began with every copy priced and the four comparisons known; the second
  // press is look 2, appended, and its sentence says the window had been read.
  async theReserveGradePricesTheUnreadWindowWithTheSavedForecastsAndCountsItsLooks() {
    const c = await chain('unread-grade test');
    try {
      // 1. the saved model applied to the test chunks IS the stored vote
      const rec = rowstore.readAll(c.s2, 'records').find((r) => r.trade === G.PLANT);
      assert.ok(rec, 'the stage 2 set holds the planted coin');
      const votesRows = rowstore.readBlocks(c.s2, 'votes', Array.from({ length: rec.blocks.votes[1] - rec.blocks.votes[0] }, (_, i) => rec.blocks.votes[0] + i)).map((x) => x.row).filter((r) => r.u === rec.u);
      const modelRows = rowstore.readBlocks(c.s2, 'models', Array.from({ length: rec.blocks.models[1] - rec.blocks.models[0] }, (_, i) => rec.blocks.models[0] + i)).map((x) => x.row).filter((r) => r.u === rec.u);
      assert.ok(modelRows.length >= 2, `saved models per member (${modelRows.length})`);
      const p1 = { windowLayout: G.STAGE1.windowLayout, allLoaded: false, startMonth: G.STAGE1.startMonth, endMonth: G.STAGE1.endMonth, trainOn: G.STAGE1.trainOn, weightCap: sw.WEIGHT_CAP_DEFAULT, pinnedFiles: null };
      const combo = { trade: G.PLANT, ctx1: null, ctx2: null, size: 1 };
      const { geo, split, reserve } = await sw.unitChunks(combo, G.STAGE1.geometry, p1);
      const testVotes = votesRows.filter((v) => v.w === 0);
      assert.strictEqual(testVotes.length, split.testChunks.length, 'the stored test votes line up with the rebuilt test chunks');
      for (const m of modelRows) {
        const spec = rec.specs[m.mi];
        const again = sw.predictMember(m.saved, { model: m.model, view: m.view }, split.testChunks, combo, geo);
        const stored = testVotes.map((v) => v.m[m.mi]);
        assert.deepStrictEqual(again, stored, `member ${m.mi} (${spec.model} ${spec.view}): the saved model gives the stored votes back on the test chunks`);
      }
      // 2. the unread chunks: from the seal's start, whole trades only
      const un = await sw.unreadChunksFor(combo, G.STAGE1.geometry, reserve.fromTs);
      assert.ok(un.chunks.length >= 2, `the unread window holds ${un.chunks.length} chunks`);
      assert.ok(un.chunks.every((ch) => ch.startTs >= reserve.fromTs), 'nothing before the seal');
      assert.strictEqual(un.chunks[0].startTs, reserve.fromTs, 'and it starts where the seal began');
      assert.ok(un.seenToTs >= un.toTs, "the box's data reaches at least the last trade's exit");
      // 3. refused until a verdict PASSED, for real
      const set = stages.getSet(c.cut.id);
      assert.strictEqual(set.unit, c.plant);
      stages.funnelVerifyStart(c.cut.id, { barPct: 100 });
      await settle(() => stages.funnelVerifyStatus(c.cut.id), 'the verdict');
      const withVerdict = stages.getSet(c.cut.id);
      assert.strictEqual(withVerdict.verify.length, 1);
      const dry0 = await stages.unreadGradeDry(c.cut.id);
      if (!withVerdict.verify[0].verdict.pass) {
        assert.strictEqual(dry0.refused, stages.UNREAD_NO_PASS, 'a FAIL verdict is no gate');
        // the gate opened by hand: the engine's own verdict on the plant fails today (decision 76)
        const file = path.join(SETS_DIR, `${c.cut.id}.json`);
        const on = JSON.parse(fs.readFileSync(file, 'utf8'));
        on.verify[0].verdict.pass = true;
        fs.writeFileSync(file, JSON.stringify(on));
      }
      const dry1 = await stages.unreadGradeDry(c.cut.id);
      assert.strictEqual(dry1.refused, null, dry1.refused);
      assert.deepStrictEqual({ looks: dry1.looks, intact: dry1.sealed.intact, from: dry1.sealed.fromTs }, { looks: 0, intact: true, from: reserve.fromTs });
      // 4. the first look
      stages.unreadGradeStart(c.cut.id, {});
      const r1 = await settle(() => stages.unreadGradeStatus(c.cut.id), 'the grade');
      assert.strictEqual(r1.look, 1);
      const g1 = stages.getSet(c.cut.id).unread[0];
      const K = G.STAGE3.keepN;
      assert.deepStrictEqual({ from: g1.window.fromTs, chunks: g1.window.chunks, look: g1.look, gateId: g1.gate.id, release: g1.release },
        { from: reserve.fromTs, chunks: un.chunks.length, look: 1, gateId: withVerdict.verify[0].id, release: require('../package.json').version });
      assert.strictEqual(g1.rows.length, withVerdict.survivors.length, 'every survivor, never a page');
      assert.deepStrictEqual(g1.missing, [], 'every survivor was priced');
      for (const r of g1.rows) {
        assert.ok(r.money != null && Number.isFinite(r.money), `${r.label} has unread money`);
        assert.ok(r.trades != null, `${r.label} has a trade count`);
      }
      assert.deepStrictEqual({ copies: g1.copies.copies, bar: g1.copies.bar, short: g1.copies.copiesShortOfSurvivors, noFigure: g1.copies.survivorsWithNoFigure }, { copies: K, bar: K, short: 0, noFigure: 0 }, 'every copy priced for every survivor, at the bar of all of them');
      assert.strictEqual(g1.read.comparisons.known, true, 'the four comparisons are known on the unread window');
      assert.strictEqual(g1.read.of, g1.rows.length);
      assert.ok(g1.survivors.rows.every((x) => x.copiesKept === K), 'each survivor carries every copy');
      assert.strictEqual(g1.sanity.known, true);
      assert.ok(/look 1: the first look at data nothing in the system has seen/.test(g1.verdict.sentence), g1.verdict.sentence);
      assert.ok(/the unread window from \d{4}-\d{2}-\d{2} holds \d+ whole chunks/.test(g1.verdict.sentence), g1.verdict.sentence);
      assert.strictEqual(g1.verdict.pass, !!(g1.footing.ok && g1.read.pass && g1.copies.pass && g1.sanity.ok), 'PASS is exactly the four rules');
      assert.deepStrictEqual(g1.rules.tags, { footing: 'DERIVED', comparisons: 'DERIVED', bar: 'DERIVED', sanity: 'GUESSED' });
      // the unread money is not the held-back money wearing another name
      const held = withVerdict.verify[0].survivors.rows.map((x) => x.held);
      const unreadMoney = g1.rows.map((x) => x.money);
      assert.ok(held.some((v, i) => Math.abs(v - unreadMoney[i]) > 0.005), 'the unread window is a different window from the held-back one');
      // 5. the second look, appended, and it says so
      stages.unreadGradeStart(c.cut.id, { barPct: 50 });
      const r2 = await settle(() => stages.unreadGradeStatus(c.cut.id), 'the second grade');
      assert.strictEqual(r2.look, 2);
      const list = stages.getSet(c.cut.id).unread;
      assert.strictEqual(list.length, 2, 'every press appends');
      assert.strictEqual(list[1].id, g1.id, 'and the first look is still first');
      assert.ok(/look 2: this window had been read 1 time\(s\) before/.test(list[0].verdict.sentence), list[0].verdict.sentence);
      assert.deepStrictEqual({ pct: list[0].rules.barPct, tag: list[0].rules.tags.bar }, { pct: 50, tag: 'GUESSED' });
      assert.deepStrictEqual(list[0].rows.map((x) => x.money), unreadMoney, 'the same window prices the same, look after look');
      const dry2 = await stages.unreadGradeDry(c.cut.id);
      assert.strictEqual(dry2.looks, 2);
    } finally { c.cleanup(); }
  },
};
