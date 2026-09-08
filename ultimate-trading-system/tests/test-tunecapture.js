// THE PER-TRADE CAPTURE OF A STAGE 4 RECORD SET, for Tune (3.92.0,
// VERIFY-DESIGN.md section 6 and section 9 step 8). The stage engine is run
// on the two fabricated coins the stage-engine check uses, the declared rule
// cut into a Stage 4 set on the planted coin, the verdict pressed, and then the
// trades are captured and the two scans on Tune run on them. Seconds, the same
// launches the check makes.
//
// PARITY IS THE GATE: the captured held-back entries' money sums to the stage 3
// record's held-back money to the cent and counts its trades; the test entries
// likewise; and the agreement count on every held-back entry is a recount from
// the members' own calls through the shared definition.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const stages = require('../lib/stages');
const sw = require('../lib/stagework');
const G = require('../lib/stagegate');
const Pl = require('../lib/planted');
const rowstore = require('../lib/rowstore');

// ONE YEAR IS ENOUGH FOR THE PLUMBING, and it is a fifth of the cost. The
// check itself builds four years (lib/stagegate.js SPAN, owner order
// 2026-09-08) because stage 1 starves on one; this file exercises the doors
// and the arithmetic, not the calibration, so it declares its own year and
// its own launch months rather than riding the check's.
const SPAN = { fromMonth: '2024-01', toDate: '2024-12-31' };
const S1 = { ...G.STAGE1, startMonth: SPAN.fromMonth, endMonth: SPAN.toDate.slice(0, 7) };
const ROOT = path.join(__dirname, '..');
const SETS_DIR = path.join(ROOT, 'data', 'stagesets');
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const cents = (v) => Math.round(Number(v) * 100);

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
  Pl.generateFabricated(SPAN, G.PLANT, G.SEEDS[G.PLANT], 0);
  Pl.generateFabricated(SPAN, G.FAIR, G.SEEDS[G.FAIR], 1);
  const s1 = stages.startStage1({ ...S1, exam: true, name: `${tag} S1` });
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
      try { fs.rmSync(stages.captureFile(id), { force: true }); } catch (_) { /* none */ }
    }
    const { CACHE_DIR } = require('../lib/binance');
    let files = [];
    try { files = fs.readdirSync(CACHE_DIR); } catch (_) { files = []; }
    for (const f of files) {
      if (G.SYMBOLS.some((sym) => f.startsWith(`${sym}-1h-`))) { try { fs.rmSync(path.join(CACHE_DIR, f), { force: true }); } catch (_) { /* best effort */ } }
    }
  };
  return { s1: s1.id, s2: s2.id, s3: s3.id, cut, plant, made, cleanup };
}
// the verdict pressed, and the gate opened by hand when the engine's own verdict
// on the plant fails (decision 76): the refusal is the real one, the capture is what is under test
async function gated(c) {
  stages.funnelVerifyStart(c.cut.id, { barPct: 100 });
  await settle(() => stages.funnelVerifyStatus(c.cut.id), 'the verdict');
  const withVerdict = stages.getSet(c.cut.id);
  if (!withVerdict.verify[0].verdict.pass) {
    const file = path.join(SETS_DIR, `${c.cut.id}.json`);
    const on = JSON.parse(fs.readFileSync(file, 'utf8'));
    on.verify[0].verdict.pass = true;
    fs.writeFileSync(file, JSON.stringify(on));
  }
  return stages.getSet(c.cut.id);
}
async function captured(c) {
  stages.tuneCaptureStart(c.cut.id);
  const r = await settle(() => stages.tuneCaptureStatus(c.cut.id), 'the capture');
  return { result: r, file: stages.readCapture(c.cut.id), set: stages.getSet(c.cut.id) };
}

module.exports = {
  // REFUSED UNTIL A VERDICT PASSED, then captured: every survivor of the right
  // shape, on three windows, held to the record to the cent.
  async theCaptureIsTheStageThreeRecordsOwnTradesToTheCent() {
    const c = await chain('tune capture test');
    try {
      // 1. refused in words before the verdict, and the dry read says the same
      let threw = null;
      try { stages.tuneCaptureStart(c.cut.id); } catch (e) { threw = e.message; }
      assert.strictEqual(threw, stages.UNREAD_NO_PASS, 'no verdict, no capture');
      let dry = await stages.tuneCaptureDry(c.cut.id);
      assert.deepStrictEqual({ refused: dry.refused, capture: dry.capture, looks: dry.looks }, { refused: stages.UNREAD_NO_PASS, capture: null, looks: 0 });
      // a scan aimed at a set without a capture refuses and says what to press
      threw = null;
      try { stages.captureTargetOf({ setId: c.cut.id, windows: ['test'] }); } catch (e) { threw = e.message; }
      assert.ok(threw && threw.includes(stages.CAPTURE_NOT_YET), threw);
      // a blend set refuses in the verdict's words
      const blend = await stages.cutFunnelSet(c.s3, { rule: G.RULE, closing: { key: 'rule' }, unit: 'all', exam: true, name: 'tune capture blend' });
      c.made.push(blend.id);
      dry = await stages.tuneCaptureDry(blend.id);
      assert.ok(/cut on all units together/.test(dry.refused), dry.refused);
      const withVerdict = await gated(c);
      dry = await stages.tuneCaptureDry(c.cut.id);
      assert.strictEqual(dry.refused, null, dry.refused);
      // 2. the capture
      const { result, file, set } = await captured(c);
      assert.ok(file && file.v === 1, 'the capture file beside the set');
      assert.deepStrictEqual({ captured: result.captured, times: result.times, notCaptured: result.notCaptured, missing: result.missing }, { captured: withVerdict.survivors.length, times: 1, notCaptured: 0, missing: 0 }, 'every survivor enters at market here, so every one is captured');
      assert.strictEqual(set.capture.id, `${c.cut.id}-c1`);
      assert.strictEqual(set.capture.release, require('../package.json').version);
      assert.strictEqual(set.capture.gate.id, withVerdict.verify[0].id, 'the verdict that stood is on the capture');
      assert.deepStrictEqual(set.capture.reads, [], 'no scan has read it yet');
      assert.ok(set.capture.pick && set.capture.pick.by === 'depth' && file.survivors.some((s) => s.label === set.capture.pick.label), 'a survivor by depth among the captured');
      // 3. PARITY: the stage 3 record, to the cent, on both windows
      const s3rows = rowstore.readAll(c.s3, 'records').filter((r) => r.trade === G.PLANT);
      assert.strictEqual(file.survivors.length, withVerdict.survivors.length);
      for (const sv of file.survivors) {
        const row = s3rows.find((r) => r.label === sv.label);
        assert.ok(row, `the stage 3 record holds ${sv.label}`);
        const hold = sv.entries.hold;
        const test = sv.entries.test;
        assert.strictEqual(cents(hold.reduce((a, e) => a + e.usd, 0)), cents(row.holdout.pnl), `${sv.label}: the held-back entries' money is the record's held-back money`);
        assert.strictEqual(hold.length, row.holdout.trades, `${sv.label}: and their count is the record's trade count`);
        assert.strictEqual(cents(test.reduce((a, e) => a + e.usd, 0)), cents(row.pnl), `${sv.label}: the test entries' money is the record's test money`);
        assert.strictEqual(test.length, row.trades, `${sv.label}: and their count is the record's trade count`);
        assert.ok(sv.entries.train.length > 0, `${sv.label}: the members forecast their own training window`);
        for (const w of ['train', 'test', 'hold']) {
          const list = sv.entries[w];
          for (let i = 1; i < list.length; i++) assert.ok(list[i].ts > list[i - 1].ts, `${w} entries are in time order`);
          for (const e of list) {
            assert.ok(e.side === 'LONG' || e.side === 'SHORT', 'a side');
            assert.ok(Number.isInteger(e.agree) && e.agree >= 1 && e.agree <= sv.members, `agree ${e.agree} is a count of members`);
            assert.ok(Number.isFinite(e.usd), 'money');
          }
        }
        assert.deepStrictEqual(set.capture.rows.find((r) => r.label === sv.label).entries, { train: sv.entries.train.length, test: test.length, hold: hold.length }, 'the summary counts the file');
      }
      // 4. the agreement count is a recount from the members' own calls through the shared definition
      const committee = require('../lib/committee');
      const { tuneTau } = require('../lib/pipeline');
      const rec2 = rowstore.readAll(c.s2, 'records').find((r) => r.trade === G.PLANT);
      const votes = rowstore.readBlocks(c.s2, 'votes', Array.from({ length: rec2.blocks.votes[1] - rec2.blocks.votes[0] }, (_, i) => rec2.blocks.votes[0] + i)).map((x) => x.row).filter((r) => r.u === rec2.u);
      const tauRows = rowstore.readBlocks(c.s2, 'tau', Array.from({ length: rec2.blocks.tau[1] - rec2.blocks.tau[0] }, (_, i) => rec2.blocks.tau[0] + i)).map((x) => x.row).filter((r) => r.u === rec2.u);
      const testVotes = votes.filter((v) => v.w === 0);
      const holdVotes = votes.filter((v) => v.w === 1);
      const p1 = { windowLayout: S1.windowLayout, allLoaded: false, startMonth: S1.startMonth, endMonth: S1.endMonth, trainOn: S1.trainOn, weightCap: sw.WEIGHT_CAP_DEFAULT, pinnedFiles: null };
      const combo = { trade: G.PLANT, ctx1: null, ctx2: null, size: 1 };
      const { geo, maps, split } = await sw.unitChunks(combo, S1.geometry, p1);
      const fee = G.STAGE3.fee;
      const taus = rec2.specs.map((_, mi) => {
        const probe = (tauRows.find((t) => t.mi === mi) || {}).probs || [];
        const nSub = split.trainChunks.length - probe.length;
        return tuneTau(split.trainChunks.slice(nSub), probe.map(committee.probsObj), maps.trade, geo, fee).tau;
      });
      const C = committee.committeeOn({ specs: rec2.specs.map((sp) => ({ model: sp.model, view: sp.view })), memberProbsTest: rec2.specs.map((_, mi) => testVotes.map((v) => v.m[mi])), taus });
      const holdProbs = rec2.specs.map((_, mi) => holdVotes.map((v) => v.m[mi]));
      let checked = 0;
      for (const sv of file.survivors) {
        const row = s3rows.find((r) => r.label === sv.label);
        const agr = sw.agrOf(row);
        const stream = C.streamOf(row.decision, agr, holdProbs);
        const per = committee.callsOf(holdProbs, row.decision, taus);
        const byTs = new Map(split.holdChunks.map((ch, i) => [ch.startTs + (geo.entryOffsetH || 0) * 3600000, i]));
        for (const e of sv.entries.hold) {
          const i = byTs.get(e.ts);
          assert.ok(i != null, `${sv.label}: a held-back entry at ${new Date(e.ts).toISOString()} is a held-back chunk's entry hour`);
          const call = stream[i];
          assert.strictEqual(e.side, call === 1 ? 'LONG' : 'SHORT', `${sv.label}: the side is the rule's call at that hour`);
          let agree = 0;
          for (const m of per) if (m[i] === call) agree++;
          assert.strictEqual(e.agree, agree, `${sv.label}: agree at ${new Date(e.ts).toISOString()} is a recount from the members' own calls`);
          checked++;
        }
      }
      assert.ok(checked > 0, 'some held-back entries were recounted');
      // 4b. THE TUNER PRICES THE SAME TRADE AS THE SIMULATOR DID: the tuner's own
      // walk of an entry (open to open at the hold length, the fee both ways)
      // gives the captured money to the cent, so a stop is tuned on the book
      // the record was priced on and not on a neighbour of it
      const { entryOutcome } = require('../lib/stoptuner');
      const { NOTIONAL } = require('../lib/paper');
      let priced = 0;
      for (const sv of file.survivors) {
        for (const w of ['train', 'test', 'hold']) {
          for (const e of sv.entries[w]) {
            const o = entryOutcome(e.ts, e.side, maps.trade, sv.tHours, fee);
            assert.ok(o.priced, `${sv.label}: the tuner prices the captured ${w} entry at ${new Date(e.ts).toISOString()}`);
            assert.strictEqual(cents(o.netPct * NOTIONAL), cents(e.usd), `${sv.label}: the tuner's money for the ${w} entry at ${new Date(e.ts).toISOString()} is the simulator's (${o.netPct * NOTIONAL} vs ${e.usd})`);
            priced++;
          }
        }
      }
      assert.ok(priced > 0, 'entries were priced by the tuner');
      // 5. a second capture replaces the first and says so
      const again = await captured(c);
      assert.strictEqual(again.result.times, 2);
      assert.strictEqual(again.set.capture.id, `${c.cut.id}-c2`);
      assert.deepStrictEqual(again.file.survivors.map((s) => s.entries.hold.length), file.survivors.map((s) => s.entries.hold.length), 'the same set captures the same trades');
    } finally { c.cleanup(); }
  },

  // THE TWO SCANS ON THE CAPTURED ENTRIES: the tuner and the ladder read only
  // the windows ticked, and only a read of the held-back entries is a look.
  async theTwoScansRunOnTheCapturedEntriesAndOnlyAHeldBackReadIsALook() {
    const c = await chain('tune scans test');
    try {
      await gated(c);
      const { file, set } = await captured(c);
      const depth = set.capture.pick.label;
      const sv = file.survivors.find((s) => s.label === depth);
      const trainTest = sv.entries.train.length + sv.entries.test.length;
      // the stop tuner on training + test: not a look
      const s1 = await stages.tuneOnCapture({ setId: c.cut.id, pick: 'depth', windows: ['train', 'test'] }, 'stop');
      assert.deepStrictEqual({ kind: s1.target.kind, survivor: s1.target.survivor, pick: s1.target.pick, windows: s1.target.windows, entries: s1.target.entries, look: s1.target.look, applies: s1.appliesToLiveRule },
        { kind: 'stage4', survivor: depth, pick: 'depth', windows: ['train', 'test'], entries: trainTest, look: null, applies: false });
      assert.strictEqual(s1.counts.priced, trainTest, 'every captured entry on those windows is priced by the tuner: the population is the simulator\'s');
      assert.strictEqual(s1.counts.winners + s1.counts.losers, trainTest);
      assert.ok(s1.stopPct == null || (s1.stopPct >= 0 && s1.stopPct < 1), 'a stop is a fraction, or none when no winner constrains it');
      assert.ok(Array.isArray(s1.curve), 'the sacrifice curve');
      assert.strictEqual(s1.setup.holdHours, sv.tHours, 'priced at the survivor\'s own hold length');
      let now = stages.getSet(c.cut.id);
      assert.deepStrictEqual(now.capture.reads.map((r) => [r.tool, r.survivor, r.windows, r.look]), [['stop', depth, ['train', 'test'], null]], 'the scan is recorded, and it is not a look');
      // the stop tuner on the held-back entries alone: look 1
      const s2 = await stages.tuneOnCapture({ setId: c.cut.id, pick: 'depth', windows: ['hold'] }, 'stop');
      assert.deepStrictEqual({ entries: s2.target.entries, look: s2.target.look, priced: s2.counts.priced }, { entries: sv.entries.hold.length, look: 1, priced: sv.entries.hold.length });
      // the ladder on all three, named survivor: look 2, rungs one to the member count
      const s3 = await stages.tuneOnCapture({ setId: c.cut.id, pick: depth, windows: ['hold', 'train', 'test'] }, 'conviction');
      assert.deepStrictEqual({ pick: s3.target.pick, windows: s3.target.windows, look: s3.target.look, entries: s3.entries, rungs: s3.ladder, members: s3.setup.members },
        { pick: 'named', windows: ['train', 'test', 'hold'], look: 2, entries: trainTest + sv.entries.hold.length, rungs: Array.from({ length: file.members }, (_, i) => i + 1), members: file.members });
      assert.strictEqual(s3.buckets.length, file.members);
      assert.strictEqual(s3.holdHours, sv.tHours);
      assert.ok(typeof s3.verdict === 'string' && s3.verdict.length, 'the ladder says what it found');
      now = stages.getSet(c.cut.id);
      assert.deepStrictEqual(now.capture.reads.map((r) => [r.tool, r.look]), [['conviction', 2], ['stop', 1], ['stop', null]], 'newest first, looks counted only for held-back reads');
      const dry = await stages.tuneCaptureDry(c.cut.id);
      assert.strictEqual(dry.looks, 2);
      // Verify counts those looks too
      const vdry = await stages.funnelVerifyDry(c.cut.id);
      assert.strictEqual(vdry.looks.tuneReads, 2, 'the looks line on Verify counts the held-back reads on Tune');
      assert.ok(vdry.looks.what.some((w) => /a scan on Tune read the captured held-back trades 2 time\(s\)/.test(w)), vdry.looks.what.join(' | '));
      // the scan target list never offers an exam set (this chain is one), and the
      // summary it would offer carries what the picker needs
      assert.ok(!stages.captureCandidates().some((x) => x.id === c.cut.id), 'an exam set is never offered as a scan target');
      assert.deepStrictEqual({ captured: dry.capture.captured, pick: dry.capture.pick.label, rows: dry.capture.rows.length, entries: dry.capture.entries.hold > 0 }, { captured: file.survivors.length, pick: depth, rows: file.survivors.length, entries: true });
      // refusals, in words, before anything loads
      let threw = null;
      try { stages.captureTargetOf({ setId: c.cut.id, pick: 'depth', windows: [] }); } catch (e) { threw = e.message; }
      assert.ok(/tick at least one window/.test(threw), threw);
      threw = null;
      try { stages.captureTargetOf({ setId: c.cut.id, pick: 'no such survivor', windows: ['test'] }); } catch (e) { threw = e.message; }
      assert.ok(/'no such survivor' is not one of the \d+ captured survivors/.test(threw), threw);
      threw = null;
      try { stages.captureTargetOf({ setId: c.cut.id, pick: 'depth', windows: ['unread'] }); } catch (e) { threw = e.message; }
      assert.ok(/no window called 'unread'/.test(threw), threw);
      // a re-capture keeps the looks already counted
      stages.tuneCaptureStart(c.cut.id);
      await settle(() => stages.tuneCaptureStatus(c.cut.id), 'the second capture');
      now = stages.getSet(c.cut.id);
      assert.strictEqual(now.capture.reads.length, 3, 'the reads stay across a re-capture');
    } finally { c.cleanup(); }
  },

  // THE SCREEN AND THE ROUTES: the panel and the target row are drawn by
  // top-level helpers the word list can walk, the scans carry the windows, and
  // a scan aimed at a set never applies anything.
  theCaptureIsOnTuneWithItsRoutesAndTheScansCarryTheWindows() {
    const ui = src('public/construct.js');
    for (const fn of ['tnCapturePanelHtml', 'tnCaptureBlockHtml', 'tnTargetRowHtml', 'tnTargetLineHtml', 'tnSetBoxHtml', 'tnCaptureFollow']) assert.ok(new RegExp(`^(async )?function ${fn}\\(`, 'm').test(ui), `${fn} must be a top-level helper`);
    assert.ok(/\$\{tnCapturePanelHtml\(tnSets, tnChosen, tnd\)\}/.test(ui), 'the panel is drawn on Tune');
    assert.ok(/\$\{isSet \? tnTargetRowHtml\(chosen, tnPickVal, tnWins\) : ''\}/.test(ui), 'the survivor and the windows are drawn under the scan target');
    for (const id of ['tnSet', 'tnCapture', 'tnPick', 'tnWinTrain', 'tnWinTest', 'tnWinHold']) assert.ok(ui.includes(`id="${id}"`), `${id} is on the screen`);
    assert.ok(/: isSet \? \{ setId: chosen\.id, pick: tnPickVal, windows: tnWins \}/.test(ui), 'a scan on a set sends the set, the survivor and the windows');
    assert.ok(/api\/funnel\/set\/\$\{encodeURIComponent\(id\)\}\/capture\/status/.test(ui), 'the capture is polled');
    assert.ok(/tick at least one window for the scan to read: training, test or held-back/.test(ui), 'no window ticked is refused on the page in the server\'s words');
    const srv = src('server.js');
    for (const r of ['/api/funnel/set/:id/capture', '/api/funnel/set/:id/capture/status']) assert.ok(srv.includes(`'${r}'`), `${r} is served`);
    assert.strictEqual((srv.match(/if \(req\.body && req\.body\.setId\) return captureScan\(req, res, '(stop|conviction)'/g) || []).length, 2, 'both scans branch to the capture');
    assert.ok(/for \(const c of stages\.captureCandidates\(\)\) candidates\.push\(c\)/.test(srv), 'the scan target list offers the sets');
    const st = src('lib/stages.js');
    assert.ok(/appliesToLiveRule: false,\n  \};\n\}/.test(st), 'nothing from a Stage 4 record set is ever applied');
  },
};
