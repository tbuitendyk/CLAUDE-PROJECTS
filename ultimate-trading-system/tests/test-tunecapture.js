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
const Pl = require('../lib/fabricated');
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
  // WHAT A FAILED LAUNCH MADE IS REMOVED BEFORE THE THROW: a set left behind
  // collides on its name with the next run of this very test.
  const cleanup = () => {
    // a held or reserve set pressed from this chain names the STAGE 3 set as
    // its parent, not the rule, and it is not in `made`: children first, or
    // the stage 3 set refuses to go and the whole chain is left behind
    for (const d of stages.listFunnelSets()) {
      const of = (x) => made.includes((d[x] || {}).id);
      if ((d.kind || 'funnel') !== 'funnel' && (of('from') || of('parent'))) { try { stages.deleteSet(d.id, d.id); } catch (_) { /* never written */ } }
    }
    for (const id of made.slice().reverse()) {
      try { stages.deleteSet(id, id); } catch (_) { /* never written */ }
      try { fs.rmSync(stages.funnelRichFile(id), { force: true }); } catch (_) { /* none */ }
      try { fs.rmSync(path.join(SETS_DIR, `${id}-agreed.json.gz`), { force: true }); } catch (_) { /* none */ }
      try { fs.rmSync(stages.captureFile(id), { force: true }); } catch (_) { /* none */ }
      for (const f of fs.readdirSync(SETS_DIR)) if (f.startsWith(`${id}-halflife-`)) { try { fs.rmSync(path.join(SETS_DIR, f), { force: true }); } catch (_) { /* none */ } }
    }
    const { CACHE_DIR } = require('../lib/binance');
    let files = [];
    try { files = fs.readdirSync(CACHE_DIR); } catch (_) { files = []; }
    for (const f of files) {
      if (G.SYMBOLS.some((sym) => f.startsWith(`${sym}-1h-`))) { try { fs.rmSync(path.join(CACHE_DIR, f), { force: true }); } catch (_) { /* best effort */ } }
    }
  };
  let s1;
  let s2;
  let s3;
  let cut;
  let plant;
  try {
  Pl.generateFabricated(SPAN, G.PLANT, G.SEEDS[G.PLANT], 0);
  Pl.generateFabricated(SPAN, G.FAIR, G.SEEDS[G.FAIR], 1);
  s1 = stages.startStage1({ ...S1, exam: true, name: `${tag} S1` });
  made.push(s1.id);
  const d1 = await waitSet(s1.id, 'stage 1');
  if (d1.status !== 'done') throw new Error(`stage 1 ended ${d1.status}: ${JSON.stringify(d1.failures || [])}`);
  s2 = stages.startStage2({ ...G.STAGE2, from: s1.id, exam: true, name: `${tag} S2` });
  made.push(s2.id);
  const d2 = await waitSet(s2.id, 'stage 2');
  if (d2.status !== 'done') throw new Error(`stage 2 ended ${d2.status}: ${JSON.stringify(d2.failures || [])}`);
  s3 = stages.startStage3({ ...G.STAGE3, from: s2.id, exam: true, name: `${tag} S3` });
  made.push(s3.id);
  const d3 = await waitSet(s3.id, 'stage 3');
  if (d3.status !== 'done') throw new Error(`stage 3 ended ${d3.status}: ${JSON.stringify(d3.failures || [])}`);
  const t = stages.readTally(s3.id) || await stages.buildTally(stages.getSet(s3.id));
  const units = stages.unitsOfSet(t, s3.id);
  plant = (units.find((u) => u.trade === G.PLANT) || {}).key;
  if (!plant) throw new Error('the stage 3 set does not hold the planted coin');
  cut = await stages.cutFunnelSet(s3.id, { rule: G.RULE, closing: { key: 'rule' }, unit: plant, barPct: 100, exam: true, name: `${tag} planted` });
  made.push(cut.id);
  } catch (err) { cleanup(); throw err; }
  return { s1: s1.id, s2: s2.id, s3: s3.id, cut, plant, made, cleanup };
}
// the verdict pressed, and the gate opened by hand when the engine's own verdict
// on the plant fails (decision 76): the refusal is the real one, the capture is what is under test
async function gated(c) {
  stages.judgeStart(c.cut.id, 'held', { barPct: 100 });
  await settle(() => stages.judgeStatus(c.cut.id, 'held'), 'the verdict');
  const held = stages.judgeSetsOf(c.cut.id, 'held')[0];
  if (!held.block.verdict.pass) {
    const file = path.join(SETS_DIR, `${held.id}.json`);
    const on = JSON.parse(fs.readFileSync(file, 'utf8'));
    on.block.verdict.pass = true;
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
  // NO VERDICT ASKED FOR (3.142.0: Tune comes before Verify), then captured:
  // every survivor of the right shape, on three windows, held to the record
  // to the cent.
  async theCaptureIsTheStageThreeRecordsOwnTradesToTheCent() {
    const c = await chain('tune capture test');
    try {
      // 1. nothing on Held has been pressed, and the capture is not refused for it
      assert.deepStrictEqual(stages.judgeSetsOf(c.cut.id, 'held'), []);
      let dry = await stages.tuneCaptureDry(c.cut.id);
      assert.deepStrictEqual({ refused: dry.refused, capture: dry.capture, looks: dry.looks, verdictOnTheScreen: 'gate' in dry || 'verdicts' in dry }, { refused: null, capture: null, looks: 0, verdictOnTheScreen: false });
      // a scan aimed at a set without a capture refuses and says what to press
      let threw = null;
      try { stages.captureTargetOf({ setId: c.cut.id, windows: ['test'] }); } catch (e) { threw = e.message; }
      assert.ok(threw && threw.includes(stages.CAPTURE_NOT_YET), threw);
      // a blend set refuses in the verdict's words
      const blend = await stages.cutFunnelSet(c.s3, { rule: G.RULE, closing: { key: 'rule' }, unit: 'all', exam: true, name: 'tune capture blend' });
      c.made.push(blend.id);
      dry = await stages.tuneCaptureDry(blend.id);
      assert.ok(/cut on all units together/.test(dry.refused), dry.refused);
      const withVerdict = stages.getSet(c.cut.id);   // no verdict pressed: the name is kept for the parity lines below
      dry = await stages.tuneCaptureDry(c.cut.id);
      assert.strictEqual(dry.refused, null, dry.refused);
      // 2. the capture
      const { result, file, set } = await captured(c);
      assert.ok(file && file.v === 1, 'the capture file beside the set');
      assert.deepStrictEqual({ captured: result.captured, times: result.times, notCaptured: result.notCaptured, missing: result.missing }, { captured: withVerdict.survivors.length, times: 1, notCaptured: 0, missing: 0 }, 'every survivor enters at market here, so every one is captured');
      assert.strictEqual(set.capture.id, `${c.cut.id}-c1`);
      assert.strictEqual(set.capture.release, require('../package.json').version);
      assert.ok(!('gate' in set.capture) && !('gate' in file), 'no verdict rides on the capture');
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
        assert.deepStrictEqual(set.capture.rows.find((r) => r.label === sv.label).entries, { train: sv.entries.train.length, test: test.length, hold: hold.length, reserve: (sv.entries.reserve || []).length }, 'the summary counts the file, the reserve window too (3.150.0)');
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
      // Held counts those looks too
      const vdry = await stages.judgeDry(c.cut.id, 'held');
      assert.strictEqual(vdry.looks.tuneReads, 2, 'the looks line on Held counts the held-back reads on Tune');
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
      assert.ok(/no window called 'unread'/.test(threw) && /reserve/.test(threw), threw);
      // THE RESERVE WINDOW (3.150.0, H3.2): the chain's layout keeps one, so the capture wrote its trades down, and a scan that reads them is a look on the reserve
      const capR = stages.readCapture(c.cut.id);
      assert.ok(capR.reserve && capR.reserve.captured && capR.reserve.window && capR.reserve.window.chunks >= 2, JSON.stringify(capR.reserve));
      assert.ok(capR.survivors.every((x) => Array.isArray(x.entries.reserve)), 'every captured survivor carries its reserve entries');
      assert.strictEqual(stages.getSet(c.cut.id).capture.entries.reserve, capR.survivors.reduce((a, x) => a + x.entries.reserve.length, 0));
      const sR = await stages.tuneOnCapture({ setId: c.cut.id, pick: 'all', windows: ['reserve'] }, 'stop');
      assert.deepStrictEqual({ reserveLook: sR.target.reserveLook, look: sR.target.look, words: sR.target.windowWords }, { reserveLook: 1, look: null, words: ['reserve'] });
      const dryR = await stages.judgeDry(c.cut.id, 'reserve');
      assert.strictEqual((dryR.looks || {}).tuneReads, 1, 'the reserve read on Tune is a look the reserve counts');
      // THE SIZING APPLIED (3.151.0): a choice on the survivor beside its stop; the picture works its money out with and without it, off the capture
      const depthLabel = stages.getSet(c.cut.id).capture.pick.label;
      const sz = stages.setSizingChoice(c.cut.id, { pick: 'depth', on: true, why: 'size by conviction' });
      assert.deepStrictEqual({ survivor: sz.survivor, on: sz.sizing.on, ladder: sz.sizing.ladder.length, clip: sz.sizing.clipUsd }, { survivor: depthLabel, on: true, ladder: stages.getSet(c.cut.id).capture.members, clip: 100 });
      const tuned = await stages.tunedOfRule(stages.getSet(c.cut.id), [depthLabel]);
      const tw = tuned[depthLabel].windows;
      assert.ok(['train', 'test', 'held', 'reserve'].every((w) => tw[w] && Number.isFinite(tw[w].flatUsd) && Number.isFinite(tw[w].tunedUsd)), JSON.stringify(tw));
      assert.strictEqual(tw.reserve.trades, capR.survivors.find((x) => x.label === depthLabel).entries.reserve.length, 'the reserve window is read off the capture too');
      const pic = await stages.pictureOf(stages.getSet(c.cut.id));
      const mine = pic.survivors.find((x) => x.label === depthLabel);
      assert.deepStrictEqual({ sizing: mine.tunings.sizing, stopSaid: mine.tunings.stopSaid, tunedOn: !!mine.tuned, n: pic.rule.tunings.survivorsWithATuning }, { sizing: true, stopSaid: false, tunedOn: true, n: 1 });
      // THE READING APPLIES THEM (3.153.0, owner order 2026-09-15): a held press with the
      // sizing on record reads the survivor at its money under the sizing, off the
      // capture in the record's own dollars, and keeps its money without it beside
      const newest = (id, stretch) => stages.judgeSetsOf(id, stretch).reduce((a, x) => (!a || x.number > a.number ? x : a), null);
      stages.judgeStart(c.cut.id, 'held', { barPct: 100 });
      await settle(() => stages.judgeStatus(c.cut.id, 'held'), 'the held read with a tuning');
      const hs = newest(c.cut.id, 'held');
      const ht = hs.block.tuned;
      const hrow = (ht.rows || []).find((x) => x.label === depthLabel) || null;
      assert.deepStrictEqual({ window: ht.window, of: ht.of, withATuning: ht.withATuning, priced: ht.priced, why: ht.why, captured: !!(ht.capture && ht.capture.at), sizing: !!(hrow && hrow.sizing && hrow.sizing.on), stop: hrow ? hrow.stop : undefined, frozen: hs.stopChoices[depthLabel].sizing.on },
        { window: 'held', of: hs.block.survivors.rows.length, withATuning: 1, priced: 1, why: null, captured: true, sizing: true, stop: null, frozen: true });
      const readAt = hs.block.survivors.rows.find((x) => x.label === depthLabel);
      // 3.156.0: a sizing and no stop leaves the reading PLAIN -- the sizing bets up to one
      // clip a member and everything it would be compared with bets one, so it is recorded,
      // never substituted
      assert.deepStrictEqual({ readInto: hrow.readInto, stops: ht.withAStop, into: ht.readInto }, { readInto: false, stops: 0, into: 0 }, 'a sizing is read into nothing');
      assert.strictEqual(cents(readAt.money), cents(hrow.plainUsd), 'the reading reads the survivor at its own money');
      assert.strictEqual(cents(hrow.plainUsd), cents(capR.survivors.find((x) => x.label === depthLabel).money.hold), "which is the record's own");
      assert.strictEqual(cents(hrow.stopUsd), cents(hrow.flatUsd), 'with no stop on record the stop money is the plain money');
      assert.ok(hrow.tunedUsd !== hrow.plainUsd && hrow.clipsPerTrade > 1, 'and the sizing is worked out beside it, at more than one clip a trade');
      // the reading and the picture price at the record's own dollars (lib/paper.js NOTIONAL), not the scans' $10 clip
      const pw = mine.tuned.windows.held;
      assert.deepStrictEqual({ clip: ht.clipUsd, pictureClip: pic.rule.tunings.clipUsd, rowClip: hrow.clipUsd, scans: tw.held.trades }, { clip: 100, pictureClip: 100, rowClip: 100, scans: pw.trades }, 'one currency on the reading and the picture');
      assert.strictEqual(cents(hrow.tunedUsd), cents(pw.tunedUsd), 'tuned is what the picture works out for the same window');
      assert.strictEqual(hrow.trades, pw.trades, 'over the same captured trades');
      assert.strictEqual(hrow.differs, 0, "the capture's plain re-pricing is the reading to the cent");
      assert.ok(/read at its money under that stop/.test(ht.reads) && /the sizing is never in the money column/.test(ht.reads), ht.reads);
      assert.strictEqual(stages.setSizingChoice(c.cut.id, { pick: 'depth', on: false, why: '' }).sizing, null, 'taken off again');
      assert.deepStrictEqual(await stages.tunedOfRule(stages.getSet(c.cut.id), [depthLabel]), {}, 'a survivor with no tuning on record is not worked out');
      // and a press with nothing on record prices nothing again, and says so
      stages.judgeStart(c.cut.id, 'held', { barPct: 100 });
      await settle(() => stages.judgeStatus(c.cut.id, 'held'), 'the held read with the tuning taken off');
      const ht2 = newest(c.cut.id, 'held').block.tuned;
      assert.deepStrictEqual({ withATuning: ht2.withATuning, rows: ht2.rows.length, why: ht2.why, capture: ht2.capture }, { withATuning: 0, rows: 0, why: stages.TUNED_NONE, capture: null });
      // a re-capture keeps the looks already counted
      stages.tuneCaptureStart(c.cut.id);
      await settle(() => stages.tuneCaptureStatus(c.cut.id), 'the second capture');
      now = stages.getSet(c.cut.id);
      assert.strictEqual(now.capture.reads.length, 4, 'the reads stay across a re-capture (three of the held-back window, one of the reserve since 3.150.0)');
      // ALL SURVIVORS AT ONCE (3.143.0, owner order): every captured survivor's
      // trades pooled, each at its own hold length; the whole table in one scan
      const cap2 = stages.readCapture(c.cut.id);
      const total = (w) => cap2.survivors.reduce((a, s) => a + w.reduce((b, k) => b + s.entries[k].length, 0), 0);
      const s4 = await stages.tuneOnCapture({ setId: c.cut.id, pick: 'all', windows: ['train', 'test'] }, 'stop');
      assert.deepStrictEqual({ pick: s4.target.pick, survivor: s4.target.survivor, survivors: s4.target.survivors, entries: s4.target.entries, priced: s4.counts.priced, look: s4.target.look, hold: s4.setup.holdHours, bookId: s4.setup.id },
        { pick: 'all', survivor: `all ${cap2.survivors.length} survivors`, survivors: cap2.survivors.length, entries: total(['train', 'test']), priced: total(['train', 'test']), look: null, hold: null, bookId: `${stages.getSet(c.cut.id).name} · all survivors` },
        'the whole table is read, every entry priced at its own hold length, and no one hold length is claimed');
      assert.ok(s4.counts.priced > sv.entries.train.length + sv.entries.test.length || cap2.survivors.length === 1, 'all survivors read no more than one did');
      // EACH TRADE AT ITS OWN HOLD LENGTH, provably: the pool holds the by-depth
      // survivor's own entries, so it cannot have fewer winners or fewer losers
      // than that survivor's own scan had; a pool priced at no hold at all reads
      // every entry as a fee-only loser and fails this (a guard found the count
      // of priced entries could not tell)
      assert.ok(s1.counts.winners > 0, 'the by-depth survivor won nothing on train + test, so this check has no teeth');
      assert.ok(s4.counts.winners >= s1.counts.winners && s4.counts.losers >= s1.counts.losers, `the pool (${s4.counts.winners} winners, ${s4.counts.losers} losers) holds fewer than the one survivor did (${s1.counts.winners}, ${s1.counts.losers}), so the trades were not priced at their own hold lengths`);
      const s5 = await stages.tuneOnCapture({ setId: c.cut.id, pick: 'all', windows: ['hold'] }, 'conviction');
      assert.deepStrictEqual({ pick: s5.target.pick, entries: s5.entries + s5.unpricedEntries, look: s5.target.look, hold: s5.holdHours }, { pick: 'all', entries: total(['hold']), look: 3, hold: null }, 'the ladder reads the whole table too, and a held-back read is still a look');
      now = stages.getSet(c.cut.id);
      assert.deepStrictEqual(now.capture.reads.slice(0, 2).map((r) => [r.tool, r.survivor, r.look]), [['conviction', `all ${cap2.survivors.length} survivors`, 3], ['stop', `all ${cap2.survivors.length} survivors`, null]], 'the reads name all survivors');
      threw = null;
      try { stages.captureTargetOf({ setId: c.cut.id, pick: 'all', windows: [] }); } catch (e) { threw = e.message; }
      assert.ok(/tick at least one window/.test(threw), threw);
      // THE STOP FORCED ONTO A SURVIVOR AS ONE ROW OF THE TABLE (3.145.0, owner
      // order 2026-09-15): recorded on the set per survivor with the reason,
      // priced by the tuner's own arithmetic at that number on the same
      // entries, the no-stop choice the baseline row; applied nowhere.
      const { NOTIONAL } = require('../lib/paper');
      assert.strictEqual(s1.chosenStop, null, 'no stop was on record, yet the scan carried a chosen row');
      assert.strictEqual(s4.chosenStop, null, 'all survivors is not a survivor, yet the scan carried a chosen row');
      const entriesUsd = [...sv.entries.train, ...sv.entries.test].reduce((a, e) => a + e.usd, 0);
      assert.ok(Math.abs(s1.noStopUsd * (NOTIONAL / s1.clipUsd) - entriesUsd) < 0.1, `the money with no stop (${s1.noStopUsd} at the $${s1.clipUsd} clip) is not the captured entries' own money (${entriesUsd} at $${NOTIONAL})`);
      // the curve's own tightest stop, forced by depth: recorded with the reason, carried on the
      // scan with its row, and the curve itself untouched. (The row is not held to the curve's
      // first row: the curve prices its stop unrounded, the record keeps six decimals, and a
      // winner sitting exactly on the tightest stop can fall either side of that rounding.)
      const k0 = s1.curve[0];
      const rec = stages.setStopChoice(c.cut.id, { pick: 'depth', stopPct: k0.stopPct, why: 'the curve\'s own top row, forced' });
      assert.deepStrictEqual({ survivor: rec.survivor, stopPct: rec.stopPct, why: rec.why, by: rec.by }, { survivor: depth, stopPct: k0.stopPct, why: 'the curve\'s own top row, forced', by: 'owner' });
      const s6 = await stages.tuneOnCapture({ setId: c.cut.id, pick: 'depth', windows: ['train', 'test'] }, 'stop');
      assert.deepStrictEqual({ survivor: s6.chosenStop.survivor, stopPct: s6.chosenStop.stopPct, why: s6.chosenStop.why, by: s6.chosenStop.by, rowStop: s6.chosenStop.row.stopPct, rowKeys: Object.keys(s6.chosenStop.row).sort() },
        { survivor: depth, stopPct: k0.stopPct, why: 'the curve\'s own top row, forced', by: 'owner', rowStop: k0.stopPct, rowKeys: Object.keys(k0).filter((k) => k !== 'sacrificeTopWinners').sort() }, 'the forced stop is not carried on the scan as a row of the table\'s own shape');
      assert.ok(s6.chosenStop.row.winnersForfeited <= 1 && s6.chosenStop.row.losersCut >= k0.losersCut, 'at the curve\'s own tightest stop the row cuts more than the winner on the boundary');
      assert.deepStrictEqual(s6.curve, s1.curve, 'a stop on record changes the curve');
      // a stop of the owner's own between the curve's points, named survivor: the row is a
      // recount from the per-entry table, strict at the boundary, and it cuts the deepest winner
      const S = k0.stopPct / 2;
      stages.setStopChoice(c.cut.id, { pick: depth, stopPct: S, why: 'half the tightest' });
      const s7 = await stages.tuneOnCapture({ setId: c.cut.id, pick: depth, windows: ['train', 'test'] }, 'stop');
      const cutAt = s7.perEntry.filter((p) => p.maePct > S);
      const wcut = cutAt.filter((p) => p.winner);
      const lcut = cutAt.filter((p) => !p.winner);
      assert.ok(wcut.length >= 1, 'half the tightest stop cuts the deepest winner, or this check has no teeth');
      const stoppedNet = -S - 2 * s7.feePerLeg;
      const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 0.011, `${what}: ${a} vs ${b}`);
      assert.deepStrictEqual({ stopPct: s7.chosenStop.row.stopPct, winnersForfeited: s7.chosenStop.row.winnersForfeited, losersCut: s7.chosenStop.row.losersCut }, { stopPct: Math.round(S * 1e6) / 1e6, winnersForfeited: wcut.length, losersCut: lcut.length }, 'the counts at the owner\'s stop are not a strict recount of the per-entry table');
      near(s7.chosenStop.row.winnerProfitForfeitedUsd, wcut.reduce((a, p) => a + p.netPct * s7.clipUsd, 0), 'winner $ given up');
      near(s7.chosenStop.row.loserPnlDeltaUsd, lcut.reduce((a, p) => a + (stoppedNet - p.netPct) * s7.clipUsd, 0), 'loss-side $');
      near(s7.chosenStop.row.netPnlDeltaUsd, cutAt.reduce((a, p) => a + (stoppedNet - p.netPct) * s7.clipUsd, 0), 'NET $');
      // cleared on purpose: the baseline row, and the record says it was chosen
      const cleared = stages.setStopChoice(c.cut.id, { pick: 'depth', stopPct: null, why: 'none, on purpose' });
      assert.deepStrictEqual({ stopPct: cleared.stopPct, why: cleared.why }, { stopPct: null, why: 'none, on purpose' });
      const s8 = await stages.tuneOnCapture({ setId: c.cut.id, pick: 'depth', windows: ['train', 'test'] }, 'stop');
      assert.deepStrictEqual(s8.chosenStop.row, { stopPct: null, winnersForfeited: 0, winnerProfitForfeitedUsd: 0, losersCut: 0, loserPnlDeltaUsd: 0, netPnlDeltaUsd: 0 }, 'no stop is not the baseline row');
      assert.deepStrictEqual({ stopPct: s8.chosenStop.stopPct, why: s8.chosenStop.why }, { stopPct: null, why: 'none, on purpose' });
      // refused in words: all survivors, a stop under the floor, nothing said, a zero, an unknown survivor
      for (const [asked, re] of [
        [{ pick: 'all', stopPct: 0.2 }, /a stop is forced onto one survivor/],
        [{ pick: 'depth', stopPct: 0.0001 }, /below the .* floor/],
        [{ pick: 'depth' }, /must be given explicitly/],
        [{ pick: 'depth', stopPct: 0 }, /positive fraction/],
        [{ pick: 'depth', stopPct: 1.5 }, /refusing a value >= 1/],
        [{ pick: 'no such survivor', stopPct: 0.2 }, /is not one of the \d+ captured survivors/],
      ]) {
        threw = null;
        try { stages.setStopChoice(c.cut.id, asked); } catch (e) { threw = e.message; }
        assert.ok(re.test(threw), `${JSON.stringify(asked)}: ${threw}`);
      }
      assert.strictEqual(stages.stopChoiceOf(stages.getSet(c.cut.id), depth).why, 'none, on purpose', 'a refused request moved the record');
      // the record lives on the set, not in the capture: a re-capture keeps it
      stages.tuneCaptureStart(c.cut.id);
      await settle(() => stages.tuneCaptureStatus(c.cut.id), 'the third capture');
      assert.deepStrictEqual({ stopPct: stages.stopChoiceOf(stages.getSet(c.cut.id), depth).stopPct, why: stages.stopChoiceOf(stages.getSet(c.cut.id), depth).why }, { stopPct: null, why: 'none, on purpose' }, 'the choice on record did not survive a re-capture');
    } finally { c.cleanup(); }
  },

  // THE SCREEN AND THE ROUTES: the panel and the target row are drawn by
  // top-level helpers the word list can walk, the scans carry the windows, and
  // a scan aimed at a set never applies anything.
  theCaptureIsOnTuneWithItsRoutesAndTheScansCarryTheWindows() {
    const ui = src('public/construct.js');
    for (const fn of ['tnCapturePanelHtml', 'tnCaptureBlockHtml', 'tnTargetRowHtml', 'tnTargetLineHtml', 'tnSetBoxHtml', 'tnCaptureFollow']) assert.ok(new RegExp(`^(async )?function ${fn}\\(`, 'm').test(ui), `${fn} must be a top-level helper`);
    assert.ok(/\$\{tnCapturePanelHtml\(tnSets, tnChosen, tnd\)\}/.test(ui), 'the panel is drawn on Tune');
    // FIRST ON THE SCREEN (3.142.1, owner order): the capture feeds the scans, so it is drawn before them
    const drawn = ui.slice(ui.indexOf('async function drawTune('));
    assert.ok(drawn.indexOf('${tnCapturePanelHtml(tnSets, tnChosen, tnd)}') < drawn.indexOf('Protective stop tuner — on the captured trades'), 'the capture panel is not the first panel on Tune');
    assert.ok(!/scans above|scan target box above/.test(ui) && /The two scans below/.test(ui), 'the capture panel still says the scans are above it');
    // A CAPTIONED FIELD BESIDE A BUTTON LINES UP AT THE BOTTOM (3.142.1, owner order: "line-up the
    // 'Save the reason' button with the 'your reason for this choice' field"): the row carries
    // align-items:flex-end, as every such row on History and Verify does, so the button sits on the
    // field's own line and not between the caption and the field
    for (const field of ['your reason for this choice', 'apply a stop you chose yourself', 'what the two scans below are aimed at']) {
      const at = ui.indexOf(field);
      const rowStart = ui.lastIndexOf('<div class="row"', at);
      const rowTag = ui.slice(rowStart, ui.indexOf('>', rowStart) + 1);
      assert.ok(/align-items:flex-end/.test(rowTag), `the row holding "${field}" does not line its button up with the field: ${rowTag}`);
    }
    // THE SET'S COIN AND SHAPE ARE SAID ONCE (3.142.3): every set box prints the name through the one
    // helper, which adds the unit only when the name does not already carry it, with one separator
    assert.ok(/function setNameWords\(x\) \{/.test(ui) && ui.includes("return String(x.name || '').includes(unit) ? esc(x.name) : `${esc(x.name)} · ${esc(unit)}`;"), 'the set boxes no longer say a set\'s coin and shape once');
    assert.strictEqual((ui.match(/\$\{setNameWords\((x|b)\)\}/g) || []).length, 5, 'a set box prints the name and unit its own way again');
    assert.ok(!/\$\{esc\(x\.name\)\} · \$\{esc\(x\.unitName/.test(ui) && !/\$\{esc\(b\.name\)\} — /.test(ui), 'a set box still prints the unit beside the name itself');
    // THE UNIT LIVES IN THE CAPTION (3.142.2, owner: "why is the alignment of this stuff so ugly?"): a captioned
    // field is a column, so text after its box lands on a line of its own. The page's pattern is Verify's
    // "bar share %": the unit in the caption, nothing after the box.
    assert.ok(ui.includes('or apply a custom stop %<input id="stopCustomPct"') && !/<input id="stopCustomPct"[^>]*>\s*%/.test(ui), 'the custom stop\'s % sits after its box again, on a line of its own');
    // (a tick box with its words after it is a different shape and is left alone here)
    for (const m of ui.matchAll(/<label class="f"[^>]*>[^<]*<input(?![^>]*type="checkbox")[^>]*>([^<]*)<\/label>/g)) {
      assert.strictEqual(m[1].trim(), '', `a captioned field carries text after its box, which the column puts on its own line: "${m[1].trim()}"`);
    }
    assert.ok(/\$\{isSet \? tnTargetRowHtml\(chosen, tnPickVal, tnWins\) : ''\}/.test(ui), 'the survivor and the windows are drawn under the scan target');
    // THE TUNING TARGETS SECTION (3.143.0, owner order): the scan target, the survivor and the
    // windows apply to both scans, so they sit in a section of their own between the capture
    // and the two scans; the survivor box is called "survivor" and offers all survivors
    const drawn2 = ui.slice(ui.indexOf('async function drawTune('));
    const at = (needle) => { const i = drawn2.indexOf(needle); assert.ok(i >= 0, `not drawn on Tune: ${needle}`); return i; };
    assert.ok(at('${tnCapturePanelHtml(tnSets, tnChosen, tnd)}') < at('<h3 style="margin-top:0">Tuning targets</h3>') && at('<h3 style="margin-top:0">Tuning targets</h3>') < at('id="tuneTarget"') && at('id="tuneTarget"') < at("${isSet ? tnTargetRowHtml(chosen, tnPickVal, tnWins) : ''}") && at("${isSet ? tnTargetRowHtml(chosen, tnPickVal, tnWins) : ''}") < at('Protective stop tuner — on the captured trades'),
      'the Tuning targets section is not between the capture and the two scans, or does not hold the target, the survivor and the windows');
    assert.ok(ui.includes('>survivor<select id="tnPick">') && !ui.includes('one survivor<select id="tnPick">'), 'the survivor box on Tune is not called "survivor"');
    assert.ok(/<option value="all" \$\{pick === 'all' \? 'selected' : ''\}>all survivors - /.test(ui), 'the survivor box does not offer all survivors');
    assert.ok(ui.includes("  if (want === 'all' && (cand.rows || []).length) return 'all';"), 'a remembered choice of all survivors is not kept');
    // THE RETURN ON THE AMOUNT TRADED (3.143.0, owner order): the sweep's headline says it flat
    // against ladder, in points, and the table has it per level of agreement
    // 3.143.1: as a small table at the top, flat / ladder / ladder over flat by money, amount traded and return
    const conv = ui.slice(ui.indexOf('function renderConvResult(c) {'), ui.indexOf('\n  }\n', ui.indexOf('function renderConvResult(c) {')));
    for (const cell of ['<th title="the money the captured trades made at this sizing">money $</th>', 'amount traded $</th>', 'return on the amount traded</th>', '<tr><td>flat</td>', '<tr><td>ladder</td>', '<tr><td>ladder over flat</td>', '${rate(c.flatReturnPct)}', '${rate(c.ladderReturnPct)}', "${signed(c.upliftReturnPts, 'points')}", "${signed(c.upliftUsd, '$')}"]) {
      assert.ok(conv.includes(cell), `the conviction sweep's summary table lacks: ${cell}`);
    }
    assert.ok(conv.indexOf('<tr><td>flat</td>') < conv.indexOf("cth('agreement','agreement')"), 'the summary table is not at the top of the row set');
    // 3.143.2 (owner: "there should be a bit of a break between the sizing table and the agreement table"):
    // the per-level table sits a clear gap below the summary table instead of running straight on from it
    assert.ok(conv.includes('</tbody></table></div>\n      <div class="scrollx" style="margin-top:.8rem"><table><thead><tr>${cth(\'agreement\',\'agreement\')}'), 'the agreement table runs straight on from the summary table again, with no break between them');
    assert.ok(!/return on the amount traded: flat \$\{/.test(conv), 'the summary is still crunched into a sentence');
    assert.ok(ui.includes("cth('return % on $ traded','returnPct')"), 'the per-level return column is gone');
    for (const id of ['tnSet', 'tnCapture', 'tnPick', 'tnWinTrain', 'tnWinTest', 'tnWinHold']) assert.ok(ui.includes(`id="${id}"`), `${id} is on the screen`);
    assert.ok(/const scanBody = isSet \? \{ setId: chosen\.id, pick: tnPickVal, windows: tnWins \} : null/.test(ui), 'a scan on a set sends the set, the survivor and the windows');
    assert.ok(/api\/funnel\/set\/\$\{encodeURIComponent\(id\)\}\/capture\/status/.test(ui), 'the capture is polled');
    assert.ok(/tick at least one window for the scan to read: training, test or held-back/.test(ui), 'no window ticked is refused on the page in the server\'s words');
    const srv = src('server.js');
    for (const r of ['/api/funnel/set/:id/capture', '/api/funnel/set/:id/capture/status']) assert.ok(srv.includes(`'${r}'`), `${r} is served`);
    assert.strictEqual((srv.match(/if \(req\.body && req\.body\.setId\) return captureScan\(req, res, '(stop|conviction)'/g) || []).length, 2, 'both scans branch to the capture');
    assert.ok(/for \(const c of stages\.captureCandidates\(\)\) candidates\.push\(c\)/.test(srv), 'the scan target list offers the sets');
    const st = src('lib/stages.js');
    assert.ok(/appliesToLiveRule: false,\n  \};\n\}/.test(st), 'nothing from a Stage 4 record set is ever applied');
    // THE STOP FORCED ONTO A SURVIVOR (3.145.0, owner order: "a pop-up message when setting a custom stop % about
    // applying to the 'live' system which is obviously not true"): the presses record the stop on the survivor
    // picked and scan it as one row; nothing on the panel claims to write a live engine or a trading machine
    const tunePanel = ui.slice(ui.indexOf('Protective stop tuner — on the captured trades'), ui.indexOf('Conviction sizing — bet more when more members agree?'));
    assert.ok(!/LIVE engine|live rule|live engine|risk parameter|F1's|lab rate/.test(tunePanel), 'the stop panel still claims to write a live engine');
    assert.ok(!/stop-apply|fixed-stop|data-stop|LIVE engine|currently applied on the trading machine|Apply to the live rule/.test(ui), 'the page still writes, reads or names the older pilot stop');
    assert.ok(/Force a \$\{v\.toFixed\(2\)\}% protective stop onto the survivor \$\{stopLabel\} of \$\{chosen\.name\}\?/.test(ui), 'the apply prompt does not name the survivor');
    assert.ok(/Clear the protective stop from the survivor \$\{stopLabel\} of \$\{chosen\.name\}\?/.test(ui), 'the clear prompt does not name the survivor');
    assert.ok(ui.includes('/stop-choice`, { pick: tnPickVal, stopPct, why: stopWhy(), scan, windows: tnWins }'), 'the choice is not sent with the survivor, the reason, the scan and the windows');
    assert.ok(/applyStop\(v \/ 100\)/.test(ui) && /applyStop\(null\)/.test(ui), 'the apply and the clear no longer send a fraction and an explicit null');
    assert.ok(ui.includes('const mineRow = mine && mine.row ?') && ui.includes('${mineRow}${(s.curve || []).map((c) => `<tr><td>${c.sacrificeTopWinners}</td>${rowCells(c)}</tr>`).join(\'\')}'), 'the stop on record is not drawn as the first row of the table');
    assert.ok(ui.includes("tnPickVal === 'all' ? 'a stop is forced onto one survivor — pick one under Tuning targets, not all survivors'"), 'all survivors is not refused for a forced stop on the page');
    assert.ok(ui.includes('const floorPct = isSet && chosen.floorPct != null ? chosen.floorPct : 0.005;'), 'the floor is not the chosen set\'s own');
    assert.ok(srv.includes("app.post('/api/funnel/set/:id/stop-choice'") && srv.includes("if (scan && heavyScanRunning) return res.status(409)"), 'the stop choice is not served, or is recorded while a scan runs');
    assert.ok(/chosenStop: chosen \? \{ survivor: t\.label, stopPct: chosen\.stopPct/.test(st), 'the scan does not carry the survivor\'s stop as a row');
    // the panel's presses are held, in words, when nothing can be forced onto
    assert.ok(ui.includes('<button id="stopCustomApply" ${stopHeld ? `disabled title="${esc(stopHeldWhy)}"`') && ui.includes('<button id="stopClear" ${stopHeld ? `disabled title="${esc(stopHeldWhy)}"`'), 'the presses are not held when no survivor is picked');
  },
};
