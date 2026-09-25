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
    // ENDED MEANS ENDED (3.220.2, a race the suite lost): the status flips to
    // done BEFORE the tables are totalled, and the set is the box's one heavy
    // job until they land -- so wait for the run to let go and the totalling
    // to finish, the way test-stages.js's untilEnded does
    if (doc && doc.status !== 'running' && stages.stageRunning() !== id) {
      const tally = stages.tallyRunPromise();
      if (tally) await tally.catch(() => {});
      return stages.getSet(id);
    }
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
// A FIELD FABRICATED FOR THE PLANTED COIN (3.235.0): one day each calendar
// day across the fabricated span, its sign, agreement and silence cycling so
// the gate blocks some calls, lets some through at x1 and x2 and some at the
// silent multiple -- every size the capture has to carry.
// `from` and `windowDays` move where the field starts and how long its window
// takes to fill (3.237.0): a field that fills partway through train.
function fabricatedField({ from = Date.UTC(2020, 11, 1), windowDays = 30 } = {}) {
  const fset = require('../lib/fieldset');
  const DAY = 24 * 3600 * 1000;
  const to = Date.UTC(2025, 1, 1);
  const cols = { ts: [], sign: [], agreement: [], size: [], certainty: [], speaking: [], evidence: [], full: [] };
  for (let t = from, i = 0; t <= to; t += DAY, i++) {
    cols.ts.push(t);
    cols.sign.push(i % 5 === 2 ? -1 : 1);
    cols.agreement.push([20, 40, 60, 90][i % 4]);
    cols.size.push(1);
    cols.certainty.push(null);
    cols.speaking.push(i % 9 === 4 ? 0 : 3);
    cols.evidence.push(4);
    cols.full.push(t - from >= windowDays * DAY ? 1 : 0);
  }
  const key = `${G.PLANT}|daily-1d`;
  const fullIdx = cols.full.indexOf(1);
  const pair = {
    key, coin: G.PLANT, geometry: 'daily-1d', standsFor: [], decisions: cols.ts.length, firstTs: from, lastTs: to,
    windowDays, capDays: windowDays, fullAt: fullIdx < 0 ? null : cols.ts[fullIdx], copies: 0,
    now: { ts: to, copies: 0, full: true, slidesAsGood: 0, scramblesAsGood: 0 },
    state: { ts: to, sign: 1, agreement: 60, size: 1, certainty: null, speaking: 3, evidence: 4, full: true, daysInWindow: 30, decisionsInWindow: 30, yardsticks: [1], pointsWithEvidence: { rising: 1, falling: 1, of: 2 } },
    range: { days: cols.ts.length, silentDays: 0, agreement: { lowest: 20, quarter: 40, median: 60, threeQuarters: 60, highest: 90 }, certainty: null },
    grid: [], readingToday: [], days: cols,
  };
  // built on each coin's own window, as the owner's field is: the dial's own number is then no pair's window
  const dials = { windowDays: 999, halfLifeDays: 10, floor: 0.1, bands: [50, 100], lookbackHours: [24], lookbackDays: [1], evidenceCap: 30, leastEvidence: 1, copies: 0, windowEachOwn: true };
  return fset.saveField({ asked: { name: 'zzz sized capture field' }, dials, cap: { days: windowDays, coin: G.PLANT }, collapse: [], pairs: [pair], startedAt: 1, finishedAt: 2, name: 'zzz sized capture field' });
}

async function chain(tag, s3extra = {}) {
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
      try { fs.rmSync(stages.funnelRichDir(id), { recursive: true, force: true }); } catch (_) { /* none */ }
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
  s3 = stages.startStage3({ ...G.STAGE3, ...s3extra, from: s2.id, exam: true, name: `${tag} S3` });
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
async function captured(c, asked = {}) {
  stages.tuneCaptureStart(c.cut.id, asked);
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
      assert.ok(file && file.v === stages.CAPTURE_V && stages.CAPTURE_V === 2, 'the capture file beside the set, of the shape that carries each trade\'s size');
      assert.deepStrictEqual({ captured: result.captured, times: result.times, missing: result.missing }, { captured: withVerdict.survivors.length, times: 1, missing: 0 }, 'every survivor is captured');
      assert.strictEqual(set.capture.v, stages.CAPTURE_V, 'the summary on the set says which shape it is');
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
            assert.strictEqual(e.size, 1, 'nothing sizes this setting, so every trade is at the standard size');
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
      // one row of the table at 0, the row of the survivor's first held-back trade, so the sizing leaves a trade out and the count read is the count it takes
      const capHold = capR.survivors.find((x) => x.label === depthLabel).entries.hold;
      const zeroAt = capHold.length ? capHold[0].agree : 1;
      const ladder = Array.from({ length: stages.getSet(c.cut.id).capture.members }, (_, i) => (i + 1 === zeroAt ? 0 : i + 1));
      const sz = stages.setSizingChoice(c.cut.id, { pick: 'depth', on: true, why: 'size by conviction', ladder });
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
      // THE SIZING ON THE RECORD IS READ, THE NULL SETS STAY AT SIZING 1 (3.250.0,
      // owner 2026-09-25: "I SAID THAT WE *USE* THE SIZING ON THE RECORD AND WE CAN
      // COMPARE WITH SIZING 1 ON THE NULL SETS"). 3.156.0 had left it out.
      assert.deepStrictEqual({ readInto: hrow.readInto, stops: ht.withAStop, sizings: ht.withASizing, into: ht.readInto }, { readInto: true, stops: 0, sizings: 1, into: 1 }, 'a sizing on record is read into the reading');
      assert.strictEqual(cents(readAt.money), cents(hrow.tunedUsd), 'the reading reads the survivor at its money under the sizing');
      assert.ok(Number.isFinite(hrow.taken) && hrow.taken <= hrow.trades && readAt.trades === hrow.taken, 'over the trades the sizing takes');
      assert.strictEqual(cents(hrow.plainUsd), cents(capR.survivors.find((x) => x.label === depthLabel).money.hold), "and the money without it is the record's own");
      assert.strictEqual(cents(hrow.stopUsd), cents(hrow.flatUsd), 'with no stop on record the stop money is the plain money');
      assert.ok(hrow.tunedUsd !== hrow.plainUsd && hrow.taken < hrow.trades, 'and the sizing changed the money and left out the trades of the row at 0');
      // the reading and the picture price at the record's own dollars (lib/paper.js NOTIONAL), not the scans' $10 clip
      const pw = mine.tuned.windows.held;
      assert.deepStrictEqual({ clip: ht.clipUsd, pictureClip: pic.rule.tunings.clipUsd, rowClip: hrow.clipUsd, scans: tw.held.trades }, { clip: 100, pictureClip: 100, rowClip: 100, scans: pw.trades }, 'one currency on the reading and the picture');
      assert.strictEqual(cents(hrow.tunedUsd), cents(pw.tunedUsd), 'tuned is what the picture works out for the same window');
      assert.strictEqual(hrow.trades, pw.trades, 'over the same captured trades');
      assert.strictEqual(hrow.differs, 0, "the capture's plain re-pricing is the reading to the cent");
      assert.ok(/read at its money under them/.test(ht.reads) && /the null sets are read at sizing 1, one clip a trade/.test(ht.reads), ht.reads);
      assert.strictEqual(stages.setSizingChoice(c.cut.id, { pick: 'depth', on: false, why: '' }).sizing, null, 'taken off again');
      assert.deepStrictEqual(await stages.tunedOfRule(stages.getSet(c.cut.id), [depthLabel]), {}, 'a survivor with no tuning on record is not worked out');
      // and a press with nothing on record prices nothing again, and says so
      stages.judgeStart(c.cut.id, 'held', { barPct: 100 });
      await settle(() => stages.judgeStatus(c.cut.id, 'held'), 'the held read with the tuning taken off');
      const plainBlock = newest(c.cut.id, 'held').block;
      const ht2 = plainBlock.tuned;
      assert.deepStrictEqual({ withATuning: ht2.withATuning, rows: ht2.rows.length, why: ht2.why, capture: ht2.capture }, { withATuning: 0, rows: 0, why: stages.TUNED_NONE, capture: null });
      // the sized read against the plain one: the null sets the same, the rule's money moved by the one survivor's sizing
      assert.deepStrictEqual(hs.block.copies.copyMeans, plainBlock.copies.copyMeans, 'the null sets are at sizing 1 whatever the survivors carry');
      const n = hs.block.survivors.rows.length;
      assert.strictEqual(cents(hs.block.copies.real - plainBlock.copies.real), cents((hrow.tunedUsd - hrow.plainUsd) / n), 'the rule\'s own money reads the sized survivor, and the rest at their own');
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
    assert.ok(/function setNameWords\(x\) \{/.test(ui) && ui.includes("return rebuildPrefix(x) + (String(x.name || '').includes(unit) ? esc(x.name) : `${esc(x.name)} · ${esc(unit)}`);"), 'the set boxes no longer say a set\'s coin and shape once');
    // (3.234.4 and 3.234.5, owner orders: the Stage 4 record set box under
    // Per-trade capture and the one on Held and Reserve show each set by its
    // name alone, so neither goes through the helper)
    assert.strictEqual((ui.match(/\$\{setNameWords\((x|b)\)\}/g) || []).length, 3, 'a set box prints the name and unit its own way again');
    assert.ok(!ui.slice(ui.indexOf('function vSetBoxHtml('), ui.indexOf('function vFootingHtml(')).includes('setNameWords('), 'the Held and Reserve set box adds the coin and shape after the name again');
    assert.ok(!ui.slice(ui.indexOf('function tnSetBoxHtml('), ui.indexOf('function tnCaptureBlockHtml(')).includes('setNameWords('), 'the capture set box adds the coin and shape after the name again');
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
    const tunePanel = ui.slice(ui.indexOf('Protective stop tuner — on the captured trades'), ui.indexOf('Conviction sizing — change order sizing based on member agreement'));
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

  // THE PASS PRICES ONLY WHAT IT KEEPS, AND KEEPS IT PER COIN AND SHAPE
  // (3.223.0, owner 2026-09-22 on a set of 4.7 million rows: "fix the Work out
  // the test history numbers to be able to work with a large data set like
  // this"). Run, not read, on the check's own chain: the pass asked for the
  // test window alone prices no held-back window and no null set, and its
  // test money is the record's own to the cent; the press over the whole set
  // lands one file per coin and shape in the folder, the index counts every
  // one as done, a unit's board reads its own numbers and the blend the
  // average; pressed again with nothing to do it leaves the store untouched.
  async thePassPricesOnlyTheTestWindowAndKeepsItPerCoinAndShape() {
    const c = await chain('rich');
    try {
      const doc = stages.getSet(c.s3);
      const t = stages.readTally(c.s3);
      const units = stages.unitsOfSet(t, c.s3);
      const board = await stages.loadUnitBoard(c.s3, t, c.plant);
      const labels = board.map((r) => r.label);
      assert.ok(labels.length > 0 && units.length >= 2, 'the chain holds a board on the planted coin and another unit');
      // the test window alone: no held-back figure, no null set, the test money the record's own
      // -- and THE WORKER THREADS ARE LET GO WHEN THE CALL ENDS (3.226.0): a
      // call used to leave its pool alive, so the pass leaked eight threads a
      // coin and shape until the service died at its memory cap
      const threadsAt = () => (fs.existsSync('/proc/self/task') ? fs.readdirSync('/proc/self/task').length : null);
      const settleThreads = () => new Promise((resolve) => { setTimeout(resolve, 800); });
      const threadsBefore = threadsAt();
      const lean = await stages.rebuildRichFor(doc, labels, { unit: c.plant, testOnly: true });
      assert.strictEqual(lean.failures.length, 0, JSON.stringify(lean.failures));
      const pnlOf = new Map(board.map((r) => [r.label, r.avgTest]));
      let checked = 0;
      for (const [label, e] of lean.perSetting) {
        const u = e.units.find((x) => stages.unitKeyOf(x) === c.plant);
        assert.ok(u, `${label} has no entry for the planted coin`);
        assert.strictEqual(u.holdout, null, `${label}: the test window alone still priced the held-back window`);
        assert.strictEqual(u.rich.hold, null, `${label}: the test window alone still carries held-back figures`);
        assert.strictEqual(u.rich.controls, null, 'the four held-back comparisons were priced');
        assert.ok(u.rich.test && Number.isFinite(Number(u.rich.test.maxDrawdown)), `${label}: no test figures`);
        assert.strictEqual(cents(u.pnl), cents(pnlOf.get(label)), `${label}: the test money is not the record's own`);
        checked++;
      }
      assert.strictEqual(checked, labels.length);
      assert.ok(lean.testControls[c.plant], 'the four things a rule has to beat on the test window still ride back');
      // and the full pricing, which the held-back ride asks for, still prices the held-back window
      const full = await stages.rebuildRichFor(doc, labels.slice(0, 2), { unit: c.plant });
      for (const e of full.perSetting.values()) {
        const u = e.units.find((x) => stages.unitKeyOf(x) === c.plant);
        assert.ok(u && u.holdout && Number.isFinite(Number(u.holdout.pnl)), 'the full pricing lost the held-back window');
      }
      await settleThreads();
      if (threadsBefore != null) assert.ok(threadsAt() <= threadsBefore + 1, `two calls left worker threads behind: ${threadsBefore} before, ${threadsAt()} after`);
      // THE WHOLE PASS (3.226.0): what is left is known at the press, off the
      // tables and the index, before any board is read; the coin and shape the
      // pass is on rides on the status and reaches the last; what was priced
      // is exactly what the press said was left; and the pass's one pool of
      // worker threads is let go at the end
      const pressedWhole = stages.funnelRichStart(c.s3, {});
      assert.ok(pressedWhole.of > 0 && pressedWhole.units === units.length, `the press does not know what is left off the tables: ${JSON.stringify([pressedWhole.of, pressedWhole.units])}`);
      assert.deepStrictEqual(pressedWhole.onUnit, { at: 1, of: units.length }, 'the status at the press does not say which coin and shape it is on');
      const whole = await settle(() => stages.funnelRichStatus(c.s3), 'the whole pass');
      assert.strictEqual((whole.failures || []).length, 0, JSON.stringify(whole.failures));
      assert.strictEqual(whole.units, units.length, 'the whole pass did not work every coin and shape');
      const wholeSt = stages.funnelRichStatus(c.s3);
      assert.deepStrictEqual(wholeSt.onUnit, { at: units.length, of: units.length }, 'the coin and shape on the status did not reach the last');
      assert.strictEqual(wholeSt.done, pressedWhole.of, 'what was priced is not what the press said was left');
      await settleThreads();
      if (threadsBefore != null) assert.ok(threadsAt() <= threadsBefore + 1, `the pass left worker threads behind: ${threadsBefore} before, ${threadsAt()} after`);
      // the store is cleared so the stop can be pressed on a pass with everything left
      fs.rmSync(stages.funnelRichDir(c.s3), { recursive: true, force: true });
      assert.strictEqual(stages.readFunnelRich(c.s3), null, 'the cleared store still reads');
      // THE PRESS AIMED AT ONE COIN AND SHAPE PRICES THAT ONE ALONE (3.136.0,
      // true since 3.236.1: until then the pass read the coin off the tables'
      // answer, which never names one, and priced every coin and shape)
      const aimed = stages.funnelRichStart(c.s3, { unit: c.plant });
      assert.strictEqual(aimed.unit, c.plant, `the press does not carry the coin and shape it was aimed at: ${JSON.stringify(aimed.unit)}`);
      const one = await settle(() => stages.funnelRichStatus(c.s3), 'the aimed pass');
      assert.strictEqual(one.units, 1, `the press aimed at one coin and shape of ${units.length} priced ${one.units}`);
      assert.strictEqual(fs.readdirSync(path.join(stages.funnelRichDir(c.s3), 'units')).length, 1, 'more than the coin and shape aimed at was written');
      assert.ok(Object.keys(stages.readFunnelRich(c.s3).unit(c.plant)).length > 0, 'the coin and shape aimed at was not written');
      fs.rmSync(stages.funnelRichDir(c.s3), { recursive: true, force: true });
      // THE STOP (3.224.0): asked for the moment the pass starts, it lands after
      // the first coin and shape -- that one is written, nothing further is
      // started, and the answer says where it stopped
      stages.funnelRichStart(c.s3, {});
      const ask = stages.funnelRichStop(c.s3);
      assert.strictEqual(ask.stopping, true, `the stop was refused: ${ask.why}`);
      assert.strictEqual(stages.funnelRichStatus(c.s3).stopping, true, 'the status does not say a stop is coming');
      const halted = await settle(() => stages.funnelRichStatus(c.s3), 'the stopped pass');
      assert.strictEqual(halted.stopped, true, 'the pass did not stop');
      assert.deepStrictEqual([halted.units, halted.of], [1, units.length], `the pass stopped after ${halted.units} of ${halted.of}, not after the first`);
      const part = stages.readFunnelRich(c.s3);
      assert.strictEqual(part.unitsDone, 1, 'the coin and shape being priced when the stop landed was not written');
      assert.strictEqual(fs.readdirSync(path.join(stages.funnelRichDir(c.s3), 'units')).length, 1, 'more than the one coin and shape was written');
      assert.strictEqual(stages.funnelRichStop(c.s3).stopping, false, 'a stop with nothing going claims to stop something');
      // THE PRESS AGAIN CARRIES ON: the rest, one file per coin and shape, every one done
      const pressed = stages.funnelRichStart(c.s3, {});
      assert.deepStrictEqual(pressed.onUnit, { at: 1, of: units.length - 1 }, 'the press after a stop does not count the coins and shapes still left');
      const out = await settle(() => stages.funnelRichStatus(c.s3), 'the pass');
      assert.strictEqual((out.failures || []).length, 0, JSON.stringify(out.failures));
      assert.strictEqual(out.stopped, false);
      assert.strictEqual(out.units, units.length - 1, 'the press after a stop priced what the stopped pass had already written');
      assert.ok(out.proof && out.proof.ran && out.proof.checked > 0 && out.proof.matched === out.proof.checked, `the proof failed: ${JSON.stringify(out.proof)}`);
      const dir = stages.funnelRichDir(c.s3);
      assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['blend.json', 'index.json', 'units'], 'the store is not the folder of index, sums and units');
      assert.strictEqual(fs.readdirSync(path.join(dir, 'units')).length, units.length, 'one file per coin and shape');
      const rich = stages.readFunnelRich(c.s3);
      assert.strictEqual(rich.unitsDone, units.length, 'the index does not count every coin and shape as done');
      assert.strictEqual(stages.richAllIn(rich), true, 'a finished prep does not read as finished');
      for (const u of units) {
        // eslint-disable-next-line no-await-in-loop
        const n = (await stages.loadUnitBoard(c.s3, t, u.key)).length;
        assert.strictEqual(rich.units[u.key].settings, n, `${u.key}: the index does not count the unit's settings`);
      }
      // a unit's board reads its own numbers, the blend the average
      const laid = stages.withFunnelRich(board, rich);
      const own = rich.unit(c.plant);
      assert.ok(laid.length && laid.every((r) => r.maxDrawdown === own[r.label].maxDrawdown), 'a unit board row reads something other than the unit\'s own number');
      const blend = stages.withFunnelRich(t.ranked.slice(0, 5), rich);
      assert.ok(blend.length && blend.every((r) => Number.isFinite(r.maxDrawdown)), 'the blend does not read the average once every coin and shape is in');
      // pressed again there is nothing to do, and the store is untouched
      const before = fs.readFileSync(path.join(dir, 'index.json'), 'utf8');
      stages.funnelRichStart(c.s3, {});
      const again = await settle(() => stages.funnelRichStatus(c.s3), 'the second pass');
      assert.strictEqual(again.nothingMissing, true, 'a second press priced what the store already carries');
      assert.strictEqual(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'), before, 'a press with nothing to do rewrote the store');
    } finally { c.cleanup(); }
  },
  // A SET WHOSE TRADES WERE JUST CAPTURED IS CHOSEN UNDER SCAN TARGET (3.233.1,
  // owner order 2026-09-23: "when trades have been captured on a stage 4 record
  // set on the tune tab the tuning targets dropdown must pick up the newly
  // created set automatically"). The block that decides it is lifted out of
  // drawTune and run against each way a capture can end: landed, still going,
  // failed, no answer from the service, and gone with nothing on record.
  async aSetWhoseTradesWereJustCapturedIsChosenUnderScanTarget() {
    const ui = src('public/construct.js');
    const lift = (head, end) => { const at = ui.indexOf(head); assert.ok(at > 0, `${head} is gone`); return ui.slice(at, ui.indexOf(end, at) + end.length); };
    const helpers = [lift('function tnCapturedGet() {', '\n'), lift('function tnCapturedSet(id) {', '\n}\n')].join('\n');
    const block = ui.slice(ui.indexOf('  const tnPending = tnCapturedGet();'), ui.indexOf("  const savedTarget = localStorage.getItem('cx-scan-target') || '';"));
    assert.ok(block.length > 50 && block.length < 1200, 'the block that chooses a captured set is not where drawTune resolves the scan target');
    const run = async (store, status, candidates) => {
      const localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      };
      const apiOr = async () => status;
      const known = new Set(candidates.map((id) => `s:${id}`));
      // eslint-disable-next-line no-new-func
      await new Function('localStorage', 'apiOr', 'known', `const TN_CAPTURED_KEY = 'cx-tune-captured';\n${helpers}\nreturn (async () => {\n${block}\n})();`)(localStorage, apiOr, known);
      return store;
    };
    const was = { 'cx-scan-target': 's:s4-old', 'cx-tune-captured': 's4-new' };
    // landed: chosen, and forgotten
    let got = await run({ ...was }, { running: false, result: { captured: 3 } }, ['s4-old', 's4-new']);
    assert.strictEqual(got['cx-scan-target'], 's:s4-new', 'a capture that landed does not choose its set under scan target');
    assert.ok(!('cx-tune-captured' in got), 'a capture that landed is remembered after its set was chosen');
    // still going: nothing moves, still remembered
    got = await run({ ...was }, { running: true }, ['s4-old']);
    assert.deepStrictEqual(got, was, 'a capture still going moved the scan target or was forgotten');
    // failed: forgotten, and the scan target stays where it was
    got = await run({ ...was }, { running: false, error: 'the prices are missing' }, ['s4-old', 's4-new']);
    assert.strictEqual(got['cx-scan-target'], 's:s4-old', 'a capture that failed moved the scan target');
    assert.ok(!('cx-tune-captured' in got), 'a capture that failed is remembered for ever');
    // no answer from the service: asked again on the next draw
    got = await run({ ...was }, null, ['s4-old', 's4-new']);
    assert.deepStrictEqual(got, was, 'no answer from the service moved the scan target or forgot the capture');
    // gone with nothing on record (the service restarted under a first capture): forgotten, nothing moves
    got = await run({ ...was }, { running: false, none: true }, ['s4-old']);
    assert.strictEqual(got['cx-scan-target'], 's:s4-old', 'a set with no capture on record was chosen under scan target');
    assert.ok(!('cx-tune-captured' in got));
    // THE PRESS REMEMBERS WHAT IT CAPTURED, and so does picking a capture back up
    assert.ok(ui.includes("    tnCapturedSet(tnChosen);   // chosen under scan target when it lands (3.233.1)\n    tnCaptureFollow(tnChosen, started.token);"),
      'the capture press does not remember which set it captured');
    assert.ok(ui.includes('if (tnd && tnd.running && tnb) { tnb.disabled = true; tnCapturedSet(tnChosen); tnCaptureFollow(tnChosen, tnd.running.token); }'),
      'a capture picked back up after a reload is not remembered, so its set is not chosen when it lands');
    // and the question the press asks says so
    assert.ok(ui.includes('When it lands the set is chosen in the scan target box.'), 'the press still says the set only appears in the scan target box');
  },
  // EACH SCAN'S RESULT IS KEPT WITH WHAT IT READ, AND A PANEL IS HANDED ONLY ITS
  // OWN (3.234.0, owner 2026-09-23: "when the scan target is selected it doesn't
  // properly update the conviction sizing section -- that's still stuck on an
  // old job"). On a Stage 4 set on disk with a capture record: kept under the
  // survivor and windows it read; by depth and naming the same survivor are one
  // target; another survivor, other windows or the other scan are told nothing
  // was run and are named the newest kept; a scan running is said only on its
  // own target; a new capture makes every kept result stale; the file goes
  // with the set.
  async theScansAreKeptPerTargetAndAPanelIsHandedOnlyItsOwn() {
    const id = `s4-test-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}-tsc`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const cap = { v: stages.CAPTURE_V, at: '2026-09-23T00:00:00.000Z', captured: 2, rows: [{ label: 'A', entry: 'market' }, { label: 'B', entry: 'market' }], pick: { label: 'A' } };
    const doc = { id, stage: 4, seq: 999961, name: 'S4 #tsc', kind: 'funnel', status: 'done', createdAt: new Date().toISOString(), exam: true, capture: cap };
    fs.mkdirSync(SETS_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(doc));
    try {
      const q = (pick, windows) => ({ setId: id, pick, windows });
      let got = stages.tuneScanFor(q('depth', ['test']), 'stop');
      assert.deepStrictEqual([got.status, got.last], ['idle', null], 'a set with nothing kept is handed something');
      const aim = stages.tuneScanAimOf(stages.captureTargetOf(q('depth', ['test', 'train'])));
      assert.deepStrictEqual(aim, { setId: id, survivor: 'A', windows: ['test', 'train'], captureAt: cap.at }, 'the target is not the survivor by depth resolves to, its windows and the capture it read');
      stages.saveTuneScan(aim, 'stop', { status: 'done', finishedUtc: '2026-09-23T01:00:00.000Z', curve: [1], perEntry: [{ entryTs: 1 }, { entryTs: 2 }] });
      got = stages.tuneScanFor(q('depth', ['train', 'test']), 'stop');
      assert.deepStrictEqual([got.status, got.curve], ['done', [1]], 'the result kept for what is chosen is not handed back');
      // WHAT THE PANEL DRAWS, NOT THE WHOLE KEPT RESULT (3.242.3): the per-trade
      // table stays on disk and is not handed out, or one scan on every survivor
      // of a big set is over the 8 MB ceiling and the panel reads as never run
      assert.strictEqual(got.perEntry, undefined, 'the per-trade table is handed to the panel, which never draws it');
      assert.strictEqual(stages.tuneScanFor(q('A', ['train', 'test']), 'stop').status, 'done', 'naming the survivor by depth resolves to is read as another target');
      // ANOTHER SURVIVOR, OTHER WINDOWS, THE OTHER SCAN: never handed this one
      got = stages.tuneScanFor(q('B', ['train', 'test']), 'stop');
      assert.deepStrictEqual([got.status, got.curve], ['idle', undefined], 'another survivor is handed this survivor\'s answer');
      assert.deepStrictEqual([got.last.survivor, got.last.windows], ['A', ['test', 'train']], 'the newest result kept on the set is not named');
      assert.strictEqual(stages.tuneScanFor(q('A', ['test']), 'stop').status, 'idle', 'other windows are handed this answer');
      got = stages.tuneScanFor(q('A', ['train', 'test']), 'conviction');
      assert.deepStrictEqual([got.status, got.last], ['idle', null], 'the conviction sizing panel is handed the stop tuner\'s answer');
      // A SCAN RUNNING IS SAID ONLY ON ITS OWN TARGET
      const running = { tool: 'stop', aim, bookId: 'S4 #tsc · A', startedUtc: '2026-09-23T03:00:00.000Z' };
      assert.strictEqual(stages.tuneScanFor(q('A', ['train', 'test']), 'stop', running).status, 'running');
      assert.strictEqual(stages.tuneScanFor(q('B', ['train', 'test']), 'stop', running).status, 'idle', 'a scan on one survivor reads as running on another');
      assert.strictEqual(stages.tuneScanFor(q('A', ['train', 'test']), 'conviction', running).status, 'idle', 'the stop scan reads as the conviction scan running');
      // A FAILURE IS KEPT UNDER ITS TARGET TOO
      stages.saveTuneScan({ ...aim, survivor: 'B' }, 'conviction', { status: 'error', error: 'no prices', finishedUtc: '2026-09-23T02:00:00.000Z' });
      got = stages.tuneScanFor(q('B', ['train', 'test']), 'conviction');
      assert.deepStrictEqual([got.status, got.error], ['error', 'no prices'], 'a failed scan is not kept under what it was run on');
      // A TARGET THAT CANNOT BE SCANNED ANSWERS IDLE WITH THE REASON, never another target's result
      got = stages.tuneScanFor(q('A', []), 'stop');
      assert.ok(got.status === 'idle' && /tick at least one window/.test(got.why || ''), `no window ticked is answered with something else: ${JSON.stringify(got)}`);
      assert.strictEqual(stages.tuneScanFor({ pick: 'depth', windows: ['test'] }, 'stop').status, 'idle', 'no set named is answered with a result');
      // A NEW CAPTURE: nothing read off the old one is handed out
      fs.writeFileSync(file, JSON.stringify({ ...doc, capture: { ...cap, at: '2026-09-24T00:00:00.000Z' } }));
      got = stages.tuneScanFor(q('depth', ['train', 'test']), 'stop');
      assert.deepStrictEqual([got.status, got.last], ['idle', null], 'a result read off a capture since replaced is handed out');
      // AND THE FILE GOES WITH THE SET
      assert.ok(fs.existsSync(stages.tuneScansFile(id)), 'the results are not kept beside the set');
      const look = stages.deleteSet(id);
      stages.deleteSet(id, look.confirmWith);
      assert.ok(!fs.existsSync(stages.tuneScansFile(id)), 'the scan results outlive their set');
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(stages.tuneScansFile(id), { force: true }); } catch (_) { /* fixture */ }
    }
  },

  // THE SIZING'S CONTROLS ARE IN THE CONVICTION SIZING PANEL, not in the
  // protective stop tuner (3.234.0, owner: "there's some bizarre mix of
  // conviction sizing stuff on the stop tuner"), laid out as the stop's are;
  // both panels are asked for the target chosen; and the message a scan press
  // gives with nothing to aim at says what is missing.
  theSizingControlsLiveInTheConvictionPanelAndBothPanelsAskForTheTargetChosen() {
    const ui = src('public/construct.js');
    const draw = ui.slice(ui.indexOf('async function drawTune('));
    const stopPanel = draw.slice(draw.indexOf('Protective stop tuner — on the captured trades, loses no winner'), draw.indexOf('Conviction sizing — change order sizing based on member agreement'));
    const convPanel = draw.slice(draw.indexOf('Conviction sizing — change order sizing based on member agreement'), draw.indexOf('function tnNotRunHtml('));
    for (const id of ['sizingWhy', 'sizingApply', 'sizingOff']) {
      assert.ok(!stopPanel.includes(`id="${id}"`), `${id} is still drawn in the protective stop tuner`);
      assert.ok(convPanel.includes(`id="${id}"`), `${id} is not drawn in the conviction sizing panel`);
    }
    assert.ok(!stopPanel.includes('sizing on record for') && convPanel.includes('sizing on record for'), 'the sizing on record is not said in its own panel');
    // laid out as the stop's: the reason box, its two buttons in a row of their own, what is on record, then the scan
    const at = (x) => convPanel.indexOf(x);
    assert.ok(at('id="sizingWhy"') < at('id="sizingApply"') && at('id="sizingApply"') < at('sizing on record for') && at('sizing on record for') < at('id="convRun"'),
      'the sizing panel is not laid out the way the stop tuner is');
    assert.ok(/<div class="row">\s*<button id="sizingApply"[^\n]*\n\s*<button id="sizingOff"/.test(convPanel), 'the two sizing buttons are not in a row of their own');
    // both panels asked for the target chosen, and a result for another said as not run
    assert.ok(draw.includes('apiOr(`api/pilot/stopsweep?${scanQ}`') && draw.includes('apiOr(`api/pilot/convictionsweep?${scanQ}`'), 'a panel is asked for something other than the target chosen');
    assert.ok(stopPanel.includes("isSet ? tnNotRunHtml(stop, 'Tune protective stop') : ''") && convPanel.includes("isSet ? tnNotRunHtml(conv, 'Run conviction sweep') : ''"), 'a panel with nothing run on the target chosen says nothing');
    const srv = src('server.js');
    assert.ok(srv.includes("app.get('/api/pilot/stopsweep', (req, res) => res.json(stages.tuneScanFor(scanQueryOf(req.query || {}), 'stop', heavyScanOn)));")
      && srv.includes("app.get('/api/pilot/convictionsweep', (req, res) => res.json(stages.tuneScanFor(scanQueryOf(req.query || {}), 'conviction', heavyScanOn)));"), 'the service answers with one result for the whole box');
    assert.ok(!/stop-sweep\.json[^\n]*writeFileSync|writeStopSweep|writeConvictionSweep/.test(srv), 'a scan still writes one result for the whole box');
    // the message with nothing to aim at says what is missing, in the screen's words
    assert.ok(draw.includes("alert('No scan target: no Stage 4 record set on this box has its trades captured yet. '"), 'the message with nothing to aim at is not the one that says what is missing');
    assert.ok(!/opposite rail|breakout cell/.test(draw), 'the message from the older engine is still on Tune');
  },
  // A SIZED SETTING'S CAPTURE ADDS UP TO ITS SET TO THE CENT (3.235.0, owner
  // order 2026-09-23: "all upstream processes use the correct resulting trade
  // sizes IN EVERY SINGLE TRADE INSTANCE"). Priced under the field's gate, the
  // capture holds only the trades the setting takes -- a blocked call is not
  // one -- each at the size its rung gave it, so on the test and held-back
  // windows its count is the record's trades and its money the record's money.
  // Before this release it held every call at size 1 and added up to nothing.
  async aSizedSettingsCaptureAddsUpToItsSetToTheCent() {
    const fset = require('../lib/fieldset');
    const field = fabricatedField();
    let c = null;
    try {
      c = await chain('tune sized capture test', { fieldId: field.id, fieldRead: 'agreement', fieldAgreeMin: '30', fieldRungs: '50:1,100:2', fieldSilent: '0.5' });
      // every train trade counted, as before the field completion box (3.237.0)
      const { file, set } = await captured(c, { fieldFillPct: 0 });
      assert.ok(file && file.v === stages.CAPTURE_V, 'the capture of the shape that carries each trade\'s size');
      const s3rows = rowstore.readAll(c.s3, 'records').filter((r) => r.trade === G.PLANT);
      const sizes = new Set();
      assert.ok(file.survivors.length > 0, 'something survived the rule to capture');
      for (const sv of file.survivors) {
        const row = s3rows.find((r) => r.label === sv.label);
        assert.ok(row, `the stage 3 record holds ${sv.label}`);
        assert.ok(row.field, `${sv.label} was priced under the field's gate`);
        const test = sv.entries.test;
        const hold = sv.entries.hold;
        assert.strictEqual(test.length, row.trades, `${sv.label}: the test entries are the trades the setting took, not every call`);
        assert.strictEqual(cents(test.reduce((a, e) => a + e.usd, 0)), cents(row.pnl), `${sv.label}: and their money at their sizes is the record's test money`);
        assert.strictEqual(hold.length, row.holdout.trades, `${sv.label}: the held-back entries likewise`);
        assert.strictEqual(cents(hold.reduce((a, e) => a + e.usd, 0)), cents(row.holdout.pnl), `${sv.label}: and their money is the record's held-back money`);
        for (const w of ['train', 'test', 'hold']) for (const e of sv.entries[w]) { assert.ok(e.size > 0, 'a trade taken has a size'); sizes.add(e.size); }
      }
      assert.ok(sizes.has(2) && sizes.has(0.5), `the rungs and the silent multiple reach the capture: ${[...sizes].join(', ')}`);
      assert.strictEqual(set.capture.v, stages.CAPTURE_V);
      assert.strictEqual(stages.rebuildOf(stages.getSet(c.cut.id)), null, 'a set cut and captured under this release needs no rebuild');
    } finally {
      if (c) c.cleanup();
      try { fset.deleteField(field.id, field.id); } catch (_) { /* never written */ }
    }
  },
  // THE FIELD COMPLETION BOX (3.237.0, owner 2026-09-23: "THE TRAIN AREA OF THE
  // HISTORY HAS NO *COMPLETELY INFORMED BY HISTORY* FIELD UNTIL THE NUMBER OF
  // DAYS HAVE BEEN SCANNED THAT CORRESPOND TO ITS SIZE", and "a compromise that
  // is willing to work with the field say at 25% or 33% completion"). A field
  // whose window fills partway through train: the panel's day counts and its
  // evidence estimate are worked out again here from the field's own days; a
  // capture asks for the completion and never assumes one; at 0% every train
  // trade counts, and higher completions leave out more -- each one written
  // down or counted as left out, test and held never cut, and at 100% none
  // before full since. Quorum by field gets its train calls from the field.
  async theFieldCompletionBoxCountsTrainTradesOnlyOnceTheFieldIsThatComplete() {
    const fset = require('../lib/fieldset');
    const F = require('../lib/field');
    const DAY = 24 * 3600 * 1000;
    const from = Date.UTC(2024, 0, 1);
    const W = 120;
    const field = fabricatedField({ from, windowDays: W });
    const sum = (x, w) => x.file.survivors.reduce((a, sv) => a + sv.entries[w].length, 0);
    const left = (x) => x.file.survivors.reduce((a, sv) => a + sv.trainLeftOut, 0);
    const fullAt = from + W * DAY;
    let c = null;
    try {
      c = await chain('tune field completion test', { fieldId: field.id, fieldRead: 'agreement', fieldAgreeMin: '30', fieldRungs: '50:1,100:2', fieldSilent: '0.5' });
      const dry = await stages.tuneCaptureDry(c.cut.id);
      const f = dry.fieldFill;
      assert.ok(f && f.rows && f.rows.length === 101, `the panel carries the field's completion for every whole percent: ${JSON.stringify(f && f.why)}`);
      assert.strictEqual(f.windowDays, W, 'the pair\'s own window');
      assert.strictEqual(f.fullAt, fullAt, 'and its full since');
      const train = stages.getSet(c.s3).windows.units[c.plant].train;
      const inTrain = [];
      for (let t = from; t <= Date.UTC(2025, 1, 1); t += DAY) if (t >= train.fromTs && t <= train.toTs) inTrain.push(t);
      const doneOf = (t) => Math.min(1, (t - from) / (W * DAY));
      for (const pct of [0, 25, 33, 50, 100]) {
        const r = f.rows[pct];
        assert.strictEqual(r.total, inTrain.length, `${pct}%: every field day in the train stretch is counted`);
        assert.strictEqual(r.building, inTrain.filter((t) => doneOf(t) < pct / 100).length, `${pct}%: the days building the field with no trading`);
        assert.strictEqual(r.full, inTrain.filter((t) => doneOf(t) >= 1).length, `${pct}%: the days with full evidence`);
        assert.strictEqual(r.building + r.partial + r.full, r.total, `${pct}%: the three kinds of day add up`);
        assert.ok(Math.abs(r.evidence - F.evidenceShareAt(pct / 100, W, 10, 0.1)) < 1e-12, `${pct}%: the evidence estimate is the field's own`);
      }
      assert.ok(f.rows[50].building > 0 && f.rows[50].partial > 0 && f.rows[50].full > 0, 'the fabricated train holds all three kinds of day at 50%');
      // the number is never assumed
      assert.throws(() => stages.tuneCaptureStart(c.cut.id, {}), /how complete the field must be before a train trade counts/);
      assert.throws(() => stages.tuneCaptureStart(c.cut.id, { fieldFillPct: 33.5 }), /whole number from 0 to 100/);
      const at = {};
      for (const pct of [0, 50, 100]) {
        // eslint-disable-next-line no-await-in-loop
        at[pct] = await captured(c, { fieldFillPct: pct });
        assert.strictEqual(at[pct].set.capture.fieldFill.pct, pct, `the capture records the completion it was taken at (${pct}%)`);
        assert.deepStrictEqual(at[pct].set.capture.fieldFill.days, f.rows[pct], `${pct}%: and the days it cost`);
        assert.strictEqual(at[pct].set.capture.fieldFill.trainLeftOut, left(at[pct]), `${pct}%: and how many train trades it left out`);
      }
      assert.strictEqual(left(at[0]), 0, 'at 0% no train trade is left out');
      assert.ok(sum(at[0], 'train') > 0, 'the fabricated survivors trade on train');
      for (const pct of [50, 100]) {
        assert.strictEqual(sum(at[pct], 'train') + left(at[pct]), sum(at[0], 'train'), `${pct}%: every train trade is written down or counted as left out`);
        for (const w of ['test', 'hold']) assert.strictEqual(sum(at[pct], w), sum(at[0], w), `${pct}%: ${w} is never cut by it`);
      }
      assert.ok(left(at[50]) > 0 && left(at[100]) > left(at[50]), `a higher completion leaves out more: ${left(at[50])}, then ${left(at[100])}`);
      for (const sv of at[100].file.survivors) for (const e of sv.entries.train) assert.ok(e.ts >= fullAt, 'at 100% every train trade is on a day the field was full');
      // a capture of a set that reads the field, with no completion on record, is taken again
      const doc = stages.getSet(c.cut.id);
      delete doc.capture.fieldFill;
      fs.writeFileSync(path.join(SETS_DIR, `${doc.id}.json`), JSON.stringify(doc));
      assert.ok(((stages.rebuildOf(stages.getSet(c.cut.id)) || {}).reasons || []).some((r) => r.key === 'capture'), 'a capture with no completion on record is flagged to be taken again');
      c.cleanup(); c = null;
      // QUORUM BY FIELD: its train calls are the field's own signs, so it trades on train at all
      c = await chain('tune field quorum test', { fieldId: field.id, agreeRule: 'field', fieldRead: 'agreement', fieldAgreeMin: '0', fieldRungs: '100:1', fieldSilent: '0' });
      const q0 = await captured(c, { fieldFillPct: 0 });
      assert.ok(q0.file.survivors.length > 0 && q0.file.survivors.every((sv) => /^field(\s|$)/.test(sv.label)), 'the survivors take the field as their quorum');
      assert.ok(sum(q0, 'train') > 0, 'quorum by field trades on train: its calls are the field\'s signs on the train days');
      const q100 = await captured(c, { fieldFillPct: 100 });
      assert.strictEqual(sum(q100, 'train') + left(q100), sum(q0, 'train'), 'and the completion cuts its train trades the same way');
      for (const sv of q100.file.survivors) for (const e of sv.entries.train) assert.ok(e.ts >= fullAt, 'none before full since at 100%');
      // the screen: the box above the press, its line following it without drawing the panel again, the number sent
      const ui = src('public/construct.js');
      const panel = ui.slice(ui.indexOf('function tnCapturePanelHtml('), ui.indexOf('\n}\n', ui.indexOf('function tnCapturePanelHtml(')));
      assert.ok(panel.indexOf('${d.fieldFill ? tnFillHtml(d) : \'\'}') > 0 && panel.indexOf('${d.fieldFill ? tnFillHtml(d) : \'\'}') < panel.indexOf('id="tnCapture"'), 'the box sits above Capture the trades of this set');
      assert.ok(ui.includes('field completion before a train trade counts, %<input id="tnFill" type="number" min="0" max="100" step="1"'), 'the box is labelled with what it is');
      assert.ok(ui.includes("spent building the field with no trading") && ui.includes('trading on partial field evidence') && ui.includes('with full evidence (full since'), 'the line says the three kinds of day in the owner\'s words');
      assert.ok(ui.includes("tnFillBox.oninput = () => { tnFillTyped = { id: tnd.id, v: tnFillBox.value }; $('#tnFillSay').innerHTML = tnFillSayHtml(tnd.fieldFill, tnFillBox.value); };"), 'typing moves the line and draws nothing else');
      assert.ok(ui.includes('const tnCaptureBody = () => (tnFillBox ? { fieldFillPct: tnFillPctOf(tnFillBox.value) } : {});'), 'the press sends the number typed');
      assert.ok((ui.match(/\/capture`, tnCaptureBody\(\)|\/capture`, body,/g) || []).length === 2, 'the press and the automatic retake both send it');
    } finally {
      if (c) c.cleanup();
      try { fset.deleteField(field.id, field.id); } catch (_) { /* never written */ }
    }
  },
  // DELETING A SET DELETES EVERYTHING IT OWNS (3.237.0, owner 2026-09-23: "fix
  // the code to delete what it should on every instance"): its capture, its
  // agreed file, a stage 3 set's test history numbers and reserve boards, the
  // retrained members of its half-life runs, and every copy a rebuild kept --
  // and never a file of a set whose id merely starts the same way.
  deletingASetDeletesEveryFileItOwns() {
    const a = 's4-zzdeletetest-1';
    const b = 's4-zzdeletetest-10';
    const owned = (id) => [`${id}-capture.json.gz`, `${id}-agreed.json.gz`, `${id}-reserve-AAA_daily-1d.json.gz`, `${id}-halflife-${id}-h1.json.gz`,
      `${id}.json.before-rebuild`, `${id}-capture.json.gz.before-rebuild`, `${id}-halflife-${id}-h1.json.gz.before-rebuild`, `${id}-tunescans.json`,
      `${id}.funnelrich.json`];
    try {
      for (const id of [a, b]) {
        fs.writeFileSync(path.join(SETS_DIR, `${id}.json`), JSON.stringify({ id, stage: 4, name: `zz delete test ${id}`, status: 'done', parent: { id: 's3-none' } }));
        for (const f of owned(id)) fs.writeFileSync(path.join(SETS_DIR, f), 'x');
        fs.mkdirSync(path.join(stages.funnelRichDir(id), 'units'), { recursive: true });
        fs.writeFileSync(path.join(stages.funnelRichDir(id), 'index.json'), '{}');
      }
      const out = stages.deleteSet(a, a);
      assert.ok(out.deleted, `the set is deleted: ${JSON.stringify(out)}`);
      for (const f of [`${a}.json`, ...owned(a)]) assert.ok(!fs.existsSync(path.join(SETS_DIR, f)), `${f} goes with the set`);
      assert.ok(!fs.existsSync(stages.funnelRichDir(a)), 'and its test history numbers');
      for (const f of [`${b}.json`, ...owned(b)]) assert.ok(fs.existsSync(path.join(SETS_DIR, f)), `${f}, another set's, stays`);
      assert.ok(fs.existsSync(stages.funnelRichDir(b)), 'and so do its test history numbers');
    } finally {
      for (const id of [a, b]) {
        for (const f of [`${id}.json`, ...owned(id)]) { try { fs.rmSync(path.join(SETS_DIR, f), { force: true }); } catch (_) { /* gone */ } }
        try { fs.rmSync(stages.funnelRichDir(id), { recursive: true, force: true }); } catch (_) { /* gone */ }
      }
    }
  },
  // A FLAGGED FAMILY IS REBUILT IN PLACE WHEN ONE OF IT IS OPENED (3.236.0,
  // owner 2026-09-23: "you need to go through those record sets that have
  // corrupt data on them and they have to be rebuilt ... rebuilding on first
  // open"). A rule cut from a sized stage 3 set, a held set read from it and a
  // half-life set built from it, all written under the release before every
  // trade was sized: opening the held set rebuilds the three -- the rule cut
  // again with its own rule, the held set read again under its number, the
  // half-life set built again from a run redone -- each under its own id and
  // name, each kept as it was beside it, and none flagged afterwards.
  async aFlaggedFamilyIsRebuiltInPlaceWhenOneOfItIsOpened() {
    const fset = require('../lib/fieldset');
    const HLmod = require('../lib/halflife');
    const field = fabricatedField();
    let c = null;
    const aside = [];
    // A RUN ON THE PLANTED COIN MAY IMPROVE NO RECORD (test-halflife.js says so
    // too), and a half-life set whose run improves nothing is left as it was
    // (D14) -- which would leave the rebuild of a half-life set, the part that
    // builds it again in place, never run here. So every table read in this
    // test has its first row won by the 12-month column when no row was won.
    const realRead = HLmod.readTable;
    HLmod.readTable = (rows, columns) => {
      const out = realRead(rows, columns);
      if (out.rows.length && !out.rows.some((r) => r.best && r.best !== HLmod.NONE)) out.rows[0].best = 'h12';
      return out;
    };
    try {
      c = await chain('tune rebuild family test', { fieldId: field.id, fieldRead: 'agreement', fieldAgreeMin: '30', fieldRungs: '50:1,100:2', fieldSilent: '0.5' });
      const rule = c.cut;
      // a held reading and a half-life set, the way the owner's screens make them
      stages.judgeStart(rule.id, 'held', { barPct: 100 });
      await settle(() => stages.judgeStatus(rule.id, 'held'), 'the held reading');
      const held = stages.judgeSetsOf(rule.id, 'held')[0];
      stages.halfLifeStart(rule.id, { months: [12] });
      await settle(() => stages.halfLifeStatus(rule.id), 'the half-life run');
      const run1 = stages.getSet(rule.id).halflife[0];
      // a run on the planted coin may improve no record (test-halflife.js says
      // so too); the set is then built off a table with its first row marked
      // won, so the rebuild of a half-life set is still driven
      let hl = null;
      try { hl = stages.buildHalfLifeSet(rule.id, { runId: run1.id, name: 'tune rebuild family test half-life' }); } catch (e) {
        const ruleFile = path.join(SETS_DIR, `${rule.id}.json`);
        const rd = JSON.parse(fs.readFileSync(ruleFile, 'utf8'));
        rd.halflife[0].rows[0].best = 'h12';
        fs.writeFileSync(ruleFile, JSON.stringify(rd));
        hl = stages.buildHalfLifeSet(rule.id, { runId: run1.id, name: 'tune rebuild family test half-life' });
      }
      c.made.push(hl.id);
      const family = [rule.id, held.id, hl.id];
      aside.push(...family);
      // written under the release before every trade was sized
      const before = {};
      for (const id of family) {
        const file = path.join(SETS_DIR, `${id}.json`);
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        d.release = '3.234.6';
        fs.writeFileSync(file, JSON.stringify(d));
        before[id] = d;
        assert.ok(((stages.rebuildOf(d) || {}).reasons || []).some((r) => r.key === 'stage4'), `${d.name} is flagged for its survivors`);
      }
      assert.deepStrictEqual(stages.rebuildChainOf(stages.getSet(held.id)).map((d) => d.id), family, 'opening the held set takes in the rule, its held set and the half-life set built from it, in that order');
      // opened: the whole family is rebuilt
      const started = stages.rebuildStart(held.id);
      assert.ok(started.running, `the rebuild starts: ${JSON.stringify(started)}`);
      assert.ok(stages.rebuildStatus(hl.id).running, 'every set of the family says the rebuild is going');
      assert.ok(stages.rebuildStatus('s4-not-in-this-family').none, 'a set outside it says nothing');
      assert.strictEqual(stages.rebuildStart(rule.id).running, true, 'opening another of the family while it goes starts nothing new');
      await stages.rebuildWait();
      const ended = stages.rebuildStatus(held.id);
      assert.ok(!ended.running && (ended.done || /could not be rebuilt/.test(ended.error || '')), `and each says how it ended: ${JSON.stringify(ended)}`);
      // the half-life set is built again, not left as it was
      const hlStopped = (stages.rebuildOf(stages.getSet(hl.id)) || {}).failed || null;
      assert.strictEqual(hlStopped, null, `the half-life set is built again from the run done again: ${hlStopped}`);
      for (const id of family) {
        const now = stages.getSet(id);
        const was = before[id];
        assert.strictEqual(now.name, was.name, `${was.name} keeps its name`);
        assert.strictEqual(now.release, require('../package.json').version, `${was.name} is written under this release`);
        assert.ok(now.rebuilt && now.rebuilt.fromRelease === '3.234.6', `${was.name} says it was rebuilt, and from what`);
        assert.strictEqual(stages.rebuildOf(now), null, `${was.name} is no longer flagged: ${JSON.stringify(stages.rebuildOf(now))}`);
        assert.ok(fs.existsSync(path.join(SETS_DIR, `${id}.json.before-rebuild`)), `${was.name} as it was is kept beside it`);
      }
      const r = stages.getSet(rule.id);
      assert.deepStrictEqual(r.survivors.map((x) => x.label).sort(), before[rule.id].survivors.map((x) => x.label).sort(), 'the rule, cut again on a board that has not moved, keeps the same survivors');
      const h = stages.getSet(held.id);
      assert.ok(h.number === before[held.id].number && h.block && h.block.at > before[held.id].block.at, 'the held set is read again under its own number');
      // the run on the survivors as they were went aside with the old rule, and
      // the run done again on the rule cut again is its first (D18)
      const runs = stages.getSet(rule.id).halflife;
      assert.ok(runs.length === 1 && runs[0].look === 1 && runs[0].at > run1.at, `the half-life run was done again on the rule, and is its only one: ${runs.length}`);
      assert.ok(fs.existsSync(`${stages.halfLifeFile(rule.id, run1.id)}.before-rebuild`), 'the retrained members of the run as it was are kept beside it');
      assert.ok(fs.existsSync(stages.halfLifeFile(rule.id, runs[0].id)), 'and the run done again has its own');
      const x = stages.getSet(hl.id);
      assert.strictEqual(x.derived.run, runs[0].id, 'the half-life set is built from the run done again');
      assert.ok(x.derived.at > before[hl.id].derived.at, 'which is newer than the one it was built from');
      assert.deepStrictEqual(x.derived.months, [12], 'at the half-lives its own run was ticked at');
      assert.ok(x.survivors.length >= 1 && x.survivors.every((sv) => sv.halfLife === 12), 'each record it keeps carries the half-life that won on it');
      assert.deepStrictEqual(x.rule, r.rule, 'and it carries the rule cut again');
      assert.strictEqual(x.counts.of, runs[0].rows.length, 'out of the rows of the table run again');
      // pressed by the screen once a visit, followed in place, never redrawn
      const ui = src('public/construct.js');
      const open = ui.slice(ui.indexOf('function rebuildOnOpen(id) {'), ui.indexOf('// THE RULES A TAB LISTS'));
      assert.ok(open.includes('if (rebuiltThisVisit.has(`stage4|${id}`)) return;'), 'the screen presses once a visit');
      assert.ok(open.includes('post(url, {})') && open.includes('api(url)'), 'it presses, then follows the rebuild');
      assert.ok(!/\bdraw[A-Z]\w*\(/.test(open), 'and never draws the screen again for it');
      const srv = src('server.js');
      assert.ok(srv.includes("app.post('/api/funnel/set/:id/rebuild-required'") && srv.includes("app.get('/api/funnel/set/:id/rebuild-required', (req, res) => res.json(stages.rebuildStatus(req.params.id)));"), 'the press and the follow each have their address');
    } finally {
      for (const id of aside) { try { fs.rmSync(path.join(SETS_DIR, `${id}.json.before-rebuild`), { force: true }); } catch (_) { /* none */ } }
      for (const f of (() => { try { return fs.readdirSync(SETS_DIR); } catch (_) { return []; } })()) {
        if (f.endsWith('.before-rebuild') && aside.some((id) => f.startsWith(id))) { try { fs.rmSync(path.join(SETS_DIR, f), { force: true }); } catch (_) { /* none */ } }
      }
      if (c) c.cleanup();
      try { fset.deleteField(field.id, field.id); } catch (_) { /* never written */ }
      HLmod.readTable = realRead;
    }
  },
  // A COMPLETE HALF-LIFE SET IS BUILT AGAIN AS THE COMPLETE (3.245.0): opened
  // when flagged, its run is done again and it keeps every row with a best,
  // the rows the unweighted column won carrying no half-life -- never the
  // cut's rows under the complete's name
  async aCompleteHalfLifeSetIsRebuiltAsTheComplete() {
    const fset = require('../lib/fieldset');
    const HLmod = require('../lib/halflife');
    // a sized stage 3 set, as the family test's: sets cut from it under the
    // release before every trade was sized are flagged for their survivors
    const field = fabricatedField();
    let c = null;
    const aside = [];
    // on every table read here the first row is won by the 12-month column and
    // the second by the unweighted one, so the cut and the complete differ
    const realRead = HLmod.readTable;
    HLmod.readTable = (rows, columns) => {
      const out = realRead(rows, columns);
      if (out.rows.length > 1) { out.rows[0].best = 'h12'; out.rows[1].best = HLmod.NONE; }
      return out;
    };
    try {
      c = await chain('tune rebuild complete test', { fieldId: field.id, fieldRead: 'agreement', fieldAgreeMin: '30', fieldRungs: '50:1,100:2', fieldSilent: '0.5' });
      const rule = c.cut;
      stages.halfLifeStart(rule.id, { months: [12] });
      await settle(() => stages.halfLifeStatus(rule.id), 'the half-life run');
      const run1 = stages.getSet(rule.id).halflife[0];
      assert.ok(run1.rows.length > 1, 'the fabricated table needs two rows');
      const all = stages.buildHalfLifeSet(rule.id, { runId: run1.id, name: 'tune rebuild complete test half-life', keep: 'complete' });
      c.made.push(all.id);
      const family = [rule.id, all.id];
      aside.push(...family);
      for (const id of family) {
        const file = path.join(SETS_DIR, `${id}.json`);
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        d.release = '3.234.6';
        fs.writeFileSync(file, JSON.stringify(d));
        assert.ok(((stages.rebuildOf(d) || {}).reasons || []).some((r) => r.key === 'stage4'), `${d.name} is flagged for its survivors`);
      }
      assert.deepStrictEqual(stages.rebuildChainOf(stages.getSet(all.id)).map((d) => d.id), family, 'opening the complete takes in the rule it was saved from');
      assert.ok(stages.rebuildStart(all.id).running, 'the rebuild does not start');
      await stages.rebuildWait();
      assert.strictEqual((stages.rebuildOf(stages.getSet(all.id)) || {}).failed || null, null, 'the complete was not built again');
      const x = stages.getSet(all.id);
      const table = stages.getSet(rule.id).halflife[0];
      // the run done again is the rule's first and so takes the first run's name; it is newer
      assert.ok(x.derived.run === table.id && table.at > run1.at && x.derived.at > run1.at, 'the complete is not built from the run done again');
      assert.strictEqual(x.derived.complete, true, 'the complete was rebuilt as the cut');
      assert.deepStrictEqual(x.survivors.map((sv) => sv.label), table.rows.filter((r) => r.best).map((r) => r.label), 'the complete rebuilt keeps other rows than every row with a best');
      const second = x.survivors.find((sv) => sv.label === table.rows[1].label);
      assert.deepStrictEqual({ halfLife: second.halfLife, unweighted: second.unweighted }, { halfLife: null, unweighted: true }, 'the row the unweighted column won carries a half-life after the rebuild');
      assert.ok(/each record at its best/.test(x.ruleSentence), x.ruleSentence);
    } finally {
      for (const f of (() => { try { return fs.readdirSync(SETS_DIR); } catch (_) { return []; } })()) {
        if (f.endsWith('.before-rebuild') && aside.some((id) => f.startsWith(id))) { try { fs.rmSync(path.join(SETS_DIR, f), { force: true }); } catch (_) { /* none */ } }
      }
      if (c) c.cleanup();
      try { fset.deleteField(field.id, field.id); } catch (_) { /* never written */ }
      HLmod.readTable = realRead;
    }
  },
  // BREAKOUT TRADES TAKE NO PROTECTIVE STOP YET, AND THE CONVICTION ROWS TAKE
  // YOUR NUMBERS (3.235.0, owner orders 2026-09-23: "when the tuning target is
  // selected, for a record set that has breakout trades ... disables the tune
  // protective stop feature ... protective stops are not tuned currently on
  // breakout trades"; "let me put in a number, any number I want, down each
  // row ... and then hit the recompute button ... that's going to trickle back
  // onto all the survivors").
  theStopIsHeldOnBreakoutTradesAndTheConvictionRowsTakeYourNumbers() {
    const ui = src('public/construct.js');
    const draw = ui.slice(ui.indexOf('async function drawTune()'), ui.indexOf('\n}\n', ui.indexOf('async function drawTune()')));
    const words = 'protective stops are not tuned currently on breakout trades';
    assert.strictEqual(stages.STOP_NOT_ON_BREAKOUT, words, 'the service refuses in the owner\'s words');
    assert.ok(draw.includes(`const stopBreakoutWords = '${words}';`), 'the screen says it in the same words');
    assert.ok(draw.includes("<button id=\"stopRun\" class=\"pri\" ${busy || stopBreakout ? 'disabled' : ''}>Tune protective stop</button>${stopBreakout ? `<span class=\"note warn\">${esc(stopBreakoutWords)}</span>` : ''}</div>"), 'the words sit beside Tune protective stop, in its own row, and hold it');
    assert.ok(/const stopHeld = busy \|\| !stopLabel \|\| stopBreakout;/.test(draw), 'No stop (clear) and Apply custom hold on breakout trades as well');
    assert.ok(/tnPickVal === 'all' \? \(chosen\.rows \|\| \[\]\)\.some\(isBreakout\) : isBreakout\(stopRow\)/.test(draw), 'all survivors holds the stop when any of them is breakout');
    // the service holds it too, before anything starts
    const doc = { capture: { v: stages.CAPTURE_V, rows: [{ label: 'm', entry: 'market' }, { label: 'b', entry: 'breakout' }] } };
    assert.strictEqual(stages.scanRefusalOf({ doc, pick: 'named', label: 'm' }, 'stop'), null, 'a market survivor is tuned');
    assert.strictEqual(stages.scanRefusalOf({ doc, pick: 'named', label: 'b' }, 'stop'), words, 'a breakout survivor is refused');
    assert.strictEqual(stages.scanRefusalOf({ doc, pick: 'all', label: null }, 'stop'), words, 'all survivors with a breakout one among them is refused');
    assert.strictEqual(stages.scanRefusalOf({ doc, pick: 'all', label: null }, 'conviction'), null, 'conviction sizing still runs on them');
    // your numbers: one per row, any number of zero or more
    assert.deepStrictEqual(stages.ladderAsked({}, 4), [1, 2, 3, 4], 'none typed: the declared ladder');
    assert.deepStrictEqual(stages.ladderAsked({ ladder: [0, 0, '0.5', 1.5] }, 4), [0, 0, 0.5, 1.5], 'yours, as numbers');
    const refuses = (ladder, part) => { let m = ''; try { stages.ladderAsked({ ladder }, 4); } catch (e) { m = e.message; } assert.ok(m.includes(part), `${JSON.stringify(ladder)}: ${m}`); };
    refuses([1, 2, 3], 'one multiplier for each agreement count');
    refuses([1, -1, 3, 4], 'zero or more');
    refuses([1, '', 3, 4], 'zero or more');
    // the rows carry a box each, Recompute prices what is typed, and Apply sends what was priced
    assert.ok(ui.includes('<input class="tnMult" type="number" min="0" step="any" data-agree="${b.agree}" value="${esc(String(b.multiplier))}"'), 'each row of the table carries its own multiplier box');
    assert.ok(ui.includes('<div class="row" style="margin-top:.4rem"><button id="convRecompute" ${busy ? \'disabled\' : \'\'}>Recompute</button><span id="convRecomputeMsg" class="note">'), 'Recompute sits in a row of its own with its message beside it');
    assert.ok(ui.includes("tryPost('api/pilot/convictionsweep', { ...scanBody, ladder })"), 'Recompute sends the numbers typed');
    assert.ok(ui.includes('...(on && pricedLadder ? { ladder: pricedLadder } : {})'), 'Apply sends the numbers the table was priced at');
    assert.ok(ui.includes("if (ap && !sizeHeld) { ap.disabled = !same;"), 'typed numbers not yet priced hold Apply');
    assert.ok(!ui.includes('the same p holds for the return on the amount traded'), 'the chance check still claims the money\'s p is the rate\'s, which sizes make untrue');
  },
  // REBUILD REQUIRED, AND ONLY WHERE IT IS (3.235.0, owner 2026-09-23: "flag
  // somehow all the data sets that need a rebuild. Maybe put a prefix on them").
  theFlagIsSaidInFrontOfTheNameAndOnlyForSetsWorkedOutAtTheStandardSize() {
    const ui = src('public/construct.js');
    assert.ok(ui.includes("function rebuildPrefix(x) { return x && x.rebuild ? 'REBUILD REQUIRED - ' : ''; }"), 'the words in front of the name, from what the service says');
    for (const f of ['function vSetBoxHtml(', 'function tnSetBoxHtml(', 'function fCutPickOption(', 'function setNameWords(']) {
      const at = ui.indexOf(f);
      assert.ok(at > 0 && ui.slice(at, ui.indexOf('\n}\n', at)).includes('rebuildPrefix('), `${f.slice(9, -1)} does not say REBUILD REQUIRED in front of a name`);
    }
    // the service: a stage 3 set with no sizing is never flagged; a capture of the old shape is
    assert.strictEqual(stages.rebuildOf({ stage: 3, id: 'zzz-none', params: {} }), null, 'nothing sizes it, so nothing changed for it');
    const old = stages.rebuildOf({ stage: 4, id: 'zzz-none', parent: { id: 'zzz-no-parent' }, release: '3.234.6', capture: { v: 1 } });
    assert.ok(old && old.words === 'REBUILD REQUIRED' && old.reasons.map((r) => r.key).join() === 'capture', `a capture of the old shape is flagged, and nothing else about a set whose parent is gone: ${JSON.stringify(old)}`);
    assert.strictEqual(stages.rebuildOf({ stage: 4, id: 'zzz-none', parent: { id: 'zzz-no-parent' }, release: '3.234.6', capture: { v: stages.CAPTURE_V } }), null, 'a capture of today\'s shape is not');
  },
  // THE STAGE 4 RECORD SET BOX UNDER PER-TRADE CAPTURE SHOWS EACH SET BY ITS
  // NAME AND NOTHING ELSE (3.234.4, owner order 2026-09-23: "it's suffixing
  // junk onto the name that ought not to be put there! just let the user name
  // things please!").
  theCaptureSetBoxShowsEachSetByItsNameAlone() {
    const ui = src('public/construct.js');
    const at = ui.indexOf('function tnSetBoxHtml(list, chosen) {');
    const rp = ui.indexOf('function rebuildPrefix(x) {');
    // eslint-disable-next-line no-new-func
    // the campaign tick and the delete beside every Stage 4 record set box (3.249.0) are their own helpers, stood in for here
    const tnSetBoxHtml = new Function('esc', 's4CampOn', 's4CampNow', 's4CampTickHtml', 's4DeleteRowHtml', `${ui.slice(rp, ui.indexOf('\n', rp) + 1)}${ui.slice(at, ui.indexOf('\n}\n', at) + 3)}\nreturn tnSetBoxHtml;`)((t) => String(t), () => false, { name: '' }, () => '', () => '');
    const list = [
      { id: 's4-a', name: 'HALF LIFE TABLE: my own name', unitName: 'BNBUSDT alongside LTCUSDT daily-4d', counts: { survivors: 51 }, derived: { fromName: 'the set it came from' } },
      { id: 's4-b', name: 'a rule on BTC', unitName: 'BTCUSDT alongside ETCUSDT daily-3d', counts: { survivors: 70 } },
      // (3.235.0, owner 2026-09-23: "flag somehow all the data sets that need a rebuild. Maybe put a prefix on them")
      { id: 's4-c', name: 'an older rule', unitName: 'LTCUSDT alongside XRPUSDT daily-2d', counts: { survivors: 140 }, rebuild: { words: 'REBUILD REQUIRED', reasons: [{ key: 'stage4', why: 'x' }] } },
    ];
    const html = tnSetBoxHtml(list, 's4-a');
    const options = [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
    assert.deepStrictEqual(options, [['s4-a', 'HALF LIFE TABLE: my own name'], ['s4-b', 'a rule on BTC'], ['s4-c', 'REBUILD REQUIRED - an older rule']], `a set in the box carries something after its name, or a set that needs a rebuild does not say so in front of it: ${JSON.stringify(options)}`);
  },

  // SAVED UNDER A NEW NAME (3.247.0, owner order 2026-09-24: "save stage 4
  // record sets with a new name so that the original can be tested too without
  // going back and removing stops and conviction size tuning"). The copy carries
  // the stop and the sizing only where ticked, its captured trades under its own
  // name, and the reads the data has had; the original is not touched; a held
  // set is refused, and so are a blank name and a taken one.
  async aSetSavedUnderANewNameCarriesWhatIsTickedAndTheLooksTheDataHasHad() {
    const c = await chain('tune copy test');
    const copies = [];
    try {
      await gated(c);
      await captured(c);
      const depth = stages.getSet(c.cut.id).capture.pick.label;
      stages.setStopChoice(c.cut.id, { pick: 'depth', stopPct: 0.25, why: 'a wide stop' });
      stages.setSizingChoice(c.cut.id, { pick: 'depth', on: true, why: 'size by conviction' });
      const file = path.join(SETS_DIR, `${c.cut.id}.json`);
      // what was done with the original: its held-back row shown on the Funnel, and a ride worked out on Held (3.251.4)
      stages.recordHeldBackLook(c.cut.id, ['rows']);
      const withRide = stages.getSet(c.cut.id);
      withRide.readings = { held: { others: [], dropped: [], ride: [{ id: `${c.cut.id}-held-r1`, at: new Date().toISOString(), look: 1 }] } };
      withRide.heldBackReadAt = withRide.heldBackReadAt || new Date().toISOString();
      fs.writeFileSync(file, JSON.stringify(withRide));
      const before = fs.readFileSync(file, 'utf8');
      const src0 = stages.getSet(c.cut.id);
      const heldReads = stages.judgeSetsOf(c.cut.id, 'held').length;
      assert.ok(heldReads >= 1, 'the rule has been read on the held-back window');
      // refused in words
      const refusal = (id, asked) => { try { stages.copyStage4Set(id, asked); } catch (e) { return e.message; } return null; };
      assert.ok(/name the copy/.test(refusal(c.cut.id, { name: '  ' })), 'a blank name');
      assert.ok(/already exists/.test(refusal(c.cut.id, { name: src0.name.toUpperCase() })), 'a name already taken, whatever its case');
      assert.ok(/a reading frozen at its press/.test(refusal(stages.judgeSetsOf(c.cut.id, 'held')[0].id, { name: `${src0.name} from held` })), 'a held set');
      assert.ok(/unknown Stage 4 record set/.test(refusal('s4-no-such-set', { name: `${src0.name} from nothing` })), 'no such set');
      const save = (tag, stops, sizing) => { const out = stages.copyStage4Set(c.cut.id, { name: `${src0.name} ${tag}`, stops, sizing }); copies.push(out.id); return { out, doc: stages.getSet(out.id) }; };
      const both = save('both', true, true);
      const stopsOnly = save('stop only', true, false);
      const sizingOnly = save('sizing only', false, true);
      const neither = save('neither', false, false);
      const picked = (d) => (d.stopChoices || {})[depth] || null;
      assert.deepStrictEqual([picked(both.doc).stopPct, picked(both.doc).why, picked(both.doc).sizing.on], [0.25, 'a wide stop', true], 'both ticked: the stop and the sizing');
      assert.deepStrictEqual([picked(stopsOnly.doc).stopPct, 'sizing' in picked(stopsOnly.doc)], [0.25, false], 'the stop alone');
      assert.deepStrictEqual(['stopPct' in picked(sizingOnly.doc), picked(sizingOnly.doc).sizing.on], [false, true], 'the sizing alone');
      assert.deepStrictEqual(neither.doc.stopChoices, {}, 'neither: no choice on record at all');
      assert.deepStrictEqual([both.out.stops, both.out.sizing, neither.out.stops, neither.out.sizing], [1, 1, 0, 0], 'the reply counts what was carried');
      // the same rule, survivors and numbers, under its own id and the name typed
      for (const { out, doc } of [both, neither]) {
        assert.ok(out.id !== c.cut.id && /^s4-/.test(out.id) && doc.name === out.name, 'its own id and the name typed');
        assert.deepStrictEqual([doc.rule, doc.survivors, doc.parent, doc.unit], [src0.rule, src0.survivors, src0.parent, src0.unit], 'the same rule and survivors on the same unit');
        assert.deepStrictEqual(doc.halflife, [], 'History\'s tables stay with the set they were run on');
        // THE COPY'S SCREENS SHOW WHAT WAS DONE WITH THE COPY (3.251.4, owner 2026-09-25: "why did the code leave
        // the old 'work out the held-back ride' section populated with previous data ... FIX THAT ON HELD AND RESERVE")
        assert.deepStrictEqual([doc.readings, doc.heldBackLooks, doc.heldBackReadAt, doc.reserveReadAt], [undefined, undefined, undefined, undefined], 'none of the readings, looks or first read of the set it was saved from');
        assert.deepStrictEqual({ id: doc.copiedFrom.id, name: doc.copiedFrom.name }, { id: c.cut.id, name: src0.name }, 'where it came from');
        // THE READS ARE THE FAMILY'S, counted where they stand (3.249.0), never a number written onto the copy
        assert.ok(!('looks' in doc.copiedFrom), 'no count of reads is written onto the copy');
        assert.strictEqual(stages.familyReadsOf(doc, 'held').stamped, heldReads, 'the held-back reads of the set it was saved from count on it');
        // its captured trades, under its own name
        const capC = stages.readCapture(out.id);
        assert.deepStrictEqual({ ...capC, id: null }, { ...stages.readCapture(c.cut.id), id: null }, 'the captured trades are the original\'s');
        assert.strictEqual(capC.id, out.id);
        assert.strictEqual(doc.capture.id, `${out.id}-c${Number(doc.capture.times) || 1}`);
      }
      // the original is not touched
      assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'the set it was saved from is byte for byte as it was');
      // the reads the data has had are counted on the copy: on its looks line, and in the look a press on it stamps
      const vdry = await stages.judgeDry(neither.out.id, 'held');
      assert.ok(vdry.looks.what.some((w) => w.includes(`${heldReads} held-back read(s) of ${src0.name}, saved from the same original`)), vdry.looks.what.join(' | '));
      assert.deepStrictEqual([vdry.looks.own, vdry.looks.family, vdry.looks.stamped], [0, heldReads, heldReads], 'none below, the original\'s counted');
      assert.deepStrictEqual([vdry.readings.ride.length, vdry.looks.rides], [0, 0], 'the copy shows no ride of its own, and says none was worked out below');
      assert.ok(vdry.looks.what.includes('the held-back ride was worked out 1 time(s) on Held on the sets saved from the same original, each a stamped look'), `the original's ride still counts as a look: ${vdry.looks.what.join(' | ')}`);
      assert.ok(vdry.looks.what.includes('the sets saved from the same original showed their held-back row on the Funnel 1 time(s), each a counted look'), `and the original's held-back row on the Funnel: ${vdry.looks.what.join(' | ')}`);
      assert.ok(vdry.looks.what.includes('the Stage 4 record set has not shown its held-back row on the Funnel since it went behind a tick'), 'the copy itself has not');
      stages.judgeStart(neither.out.id, 'held', { barPct: 100 });
      await settle(() => stages.judgeStatus(neither.out.id, 'held'), 'the held read of the copy');
      const hs = stages.judgeSetsOf(neither.out.id, 'held')[0];
      assert.strictEqual(hs.block.look, 1 + heldReads, 'the copy\'s first held-back read is stamped after the reads of the set it was saved from');
      // A READ OF A SIBLING COUNTS (3.249.0): the copy saved first sees the read of the copy saved after it
      assert.strictEqual(stages.familyReadsOf(stages.getSet(both.out.id), 'held').stamped, heldReads + 1, 'a held read of a set saved from the same original counts on every one of them');
      // a copy of a copy is the same family
      const again = stages.copyStage4Set(neither.out.id, { name: `${src0.name} again`, stops: false, sizing: false });
      copies.push(again.id);
      assert.strictEqual(stages.familyRootOf(stages.getSet(again.id)), c.cut.id, 'the family is named by the original');
      assert.strictEqual(stages.familyReadsOf(stages.getSet(again.id), 'held').stamped, heldReads + 1, 'the reads of the copy, and of the set it was saved from');
      // THE SIZING AS THE TAB SHOWS IT (3.249.0): the numbers the table was priced at, on the survivors it covers
      const members = stages.getSet(c.cut.id).capture.members;
      const ladder = Array.from({ length: members }, (_, i) => 0.5 + i / 10);
      const asTab = stages.copyStage4Set(c.cut.id, { name: `${src0.name} as the tab`, stops: false, sizing: true, ladder, pick: 'all', why: 'my own reason' });
      copies.push(asTab.id);
      const tabDoc = stages.getSet(asTab.id);
      const capLabels = stages.getSet(c.cut.id).capture.rows.map((r) => r.label);
      assert.ok(capLabels.length > 1 && capLabels.every((L) => JSON.stringify(((tabDoc.stopChoices[L] || {}).sizing || {}).ladder) === JSON.stringify(ladder)), 'every captured survivor carries the table\'s numbers');
      assert.deepStrictEqual([asTab.ladder, tabDoc.copiedFrom.ladder, asTab.sizing], [ladder, ladder, capLabels.length], 'the reply and the record say which numbers travelled');
      // THE REASON IS THE OWNER'S, NEVER THE SOFTWARE'S (3.251.2)
      assert.ok(capLabels.every((L) => tabDoc.stopChoices[L].sizing.why === 'my own reason'), 'every survivor carries the reason typed in the box, word for word');
      assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'and the set it was saved from is still not touched');
      const onePick = stages.copyStage4Set(c.cut.id, { name: `${src0.name} one survivor`, stops: false, sizing: true, ladder, pick: capLabels[1] });
      copies.push(onePick.id);
      const oneDoc = stages.getSet(onePick.id);
      assert.deepStrictEqual([oneDoc.stopChoices[capLabels[1]].sizing.ladder, oneDoc.stopChoices[depth].sizing.ladder], [ladder, src0.stopChoices[depth].sizing.ladder], 'the survivor the table covers carries its numbers, any other the sizing on record');
      assert.strictEqual(oneDoc.stopChoices[capLabels[1]].sizing.why, ((src0.stopChoices[capLabels[1]] || {}).sizing || {}).why || '', 'with nothing typed, the reason the owner gave that survivor, or none -- never words the software wrote');
      assert.ok(/give one multiplier for each agreement count/.test(refusal(c.cut.id, { name: `${src0.name} short`, sizing: true, ladder: [1], pick: 'all' })), 'a table of the wrong length is refused');
      // A COPY HAS ITS FAMILY'S SCANS ON THE SAME TRADES (3.251.1, owner 2026-09-25:
      // "the existing protective stop tuner and conviction sizing sections should be loaded with the selections and results")
      const q = (id) => ({ setId: id, pick: 'all', windows: ['train', 'test'] });
      const aimOf = (id) => stages.tuneScanAimOf(stages.captureTargetOf(q(id)));
      assert.strictEqual(stages.tuneScanFor(q(asTab.id), 'conviction').status, 'idle', 'nothing kept anywhere yet');
      stages.saveTuneScan(aimOf(c.cut.id), 'conviction', { status: 'done', finishedUtc: '2026-09-25T00:00:01Z', ladder: [1], marker: 'original' });
      const onCopy = stages.tuneScanFor(q(asTab.id), 'conviction');
      assert.deepStrictEqual([onCopy.status, onCopy.marker], ['done', 'original'], 'the copy is handed the scan its original read on the same trades');
      assert.strictEqual(stages.tuneScanFor({ ...q(asTab.id), windows: ['test'] }, 'conviction').last.survivor, 'all', 'and on other windows it is told what that scan read');
      stages.saveTuneScan(aimOf(asTab.id), 'conviction', { status: 'done', finishedUtc: '2026-09-25T00:00:02Z', ladder: [1], marker: 'own' });
      assert.strictEqual(stages.tuneScanFor(q(asTab.id), 'conviction').marker, 'own', 'its own scans come first');
      assert.strictEqual(stages.tuneScanFor(q(c.cut.id), 'conviction').marker, 'original', 'and the original keeps its own');
      // deleting a copy deletes its captured trades and leaves the original's
      stages.deleteSet(both.out.id, both.out.id);
      assert.ok(!fs.existsSync(stages.captureFile(both.out.id)) && fs.existsSync(stages.captureFile(c.cut.id)), 'the copy\'s capture goes with it');
      // REFUSED WHERE A DELETE WOULD LOSE EVIDENCE (3.249.0)
      const delRefusal = (id) => { try { stages.deleteSet(id); } catch (e) { return e.message; } return null; };
      const os = require('os');
      const gdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-del-gl-'));
      const prevG = process.env.GC_GREENLIGHTS_DIR;
      process.env.GC_GREENLIGHTS_DIR = gdir;
      try {
        const gl = { id: 'gl-deltest-1', createdUtc: new Date().toISOString(), seq: 1, name: 'a standing greenlight', sourceSet: { id: hs.id, name: hs.name }, revoked: false };
        fs.writeFileSync(path.join(gdir, 'gl-deltest-1.json'), JSON.stringify(gl));
        assert.ok(/greenlight a standing greenlight was written from .* and is still greenlighted/.test(delRefusal(neither.out.id) || ''), 'a rule whose held set a standing greenlight came from is kept');
        assert.ok(/still greenlighted/.test(delRefusal(hs.id) || ''), 'and so is that held set');
        fs.writeFileSync(path.join(gdir, 'gl-deltest-1.json'), JSON.stringify({ ...gl, revoked: true }));
        assert.strictEqual(stages.deleteSet(neither.out.id).preview, true, 'a greenlight nuked no longer holds it');
      } finally {
        if (prevG === undefined) delete process.env.GC_GREENLIGHTS_DIR; else process.env.GC_GREENLIGHTS_DIR = prevG;
        fs.rmSync(gdir, { recursive: true, force: true });
      }
      const fakeId = `s4-${Date.now().toString(36)}-deltest`;
      fs.writeFileSync(path.join(SETS_DIR, `${fakeId}.json`), JSON.stringify({ id: fakeId, seq: 0, stage: 4, kind: 'reserve', status: 'done', name: `reserve set of ${neither.doc.name}`, createdAt: new Date().toISOString(), from: { id: neither.out.id, name: neither.doc.name }, standsOn: { id: hs.id, name: hs.name }, parent: neither.doc.parent, block: { at: new Date().toISOString(), look: 1 } }));
      assert.ok(/stands on .* delete that reserve set first/.test(delRefusal(hs.id) || ''), 'a held set a reserve set stands on is kept');
      // A RULE TAKES ITS HELD AND RESERVE SETS WITH IT, AND THEIR LOOKS STAY (3.249.0)
      const look = stages.deleteSet(neither.out.id);
      assert.deepStrictEqual([look.preview, look.alsoDeletes.map((x) => x.id).sort(), look.readsKept, look.readsKeptOn], [true, [hs.id, fakeId].sort(), 2, src0.name], 'the preview names the held and reserve sets that go and where their looks are kept');
      stages.deleteSet(neither.out.id, neither.out.id);
      assert.ok(!stages.getSet(hs.id) && !stages.getSet(fakeId), 'the held and reserve sets read from it went with it');
      assert.strictEqual(stages.getSet(again.id).copiedFrom.id, c.cut.id, 'the set saved from the deleted copy now names the set that copy was saved from');
      const famAfter = stages.familyReadsOf(stages.getSet(again.id), 'held');
      assert.deepStrictEqual([famAfter.stamped, famAfter.gone.map((g) => g.id)], [heldReads + 1, [hs.id]], 'the deleted held set is still a look on the family');
      assert.deepStrictEqual(stages.familyReadsOf(stages.getSet(again.id), 'reserve').gone.map((g) => g.id), [fakeId], 'and the deleted reserve set a look on the reserve window');
      assert.strictEqual((stages.getSet(c.cut.id).deletedReads.held || []).length, 1, 'written onto the original, which stays');
      // A RENAME IS CARRIED WHERE OTHER SETS NAME IT, AND KEPT WHOLE (3.251.0)
      const renamed = `${src0.name} renamed ${'y'.repeat(90)}`;
      stages.setSetName(c.cut.id, renamed);
      assert.strictEqual(stages.getSet(c.cut.id).name, renamed, 'the name kept to its last character');
      assert.strictEqual(stages.getSet(again.id).copiedFrom.name, renamed, 'a set saved from it names it by its new name');
      assert.ok(stages.judgeSetsOf(c.cut.id, 'held').length && stages.judgeSetsOf(c.cut.id, 'held').every((h) => h.from.name === renamed), 'and so does every held set read from it');
      stages.setSetName(c.cut.id, src0.name);
    } finally {
      for (const id of copies.slice().reverse()) {
        for (const j of [...stages.judgeSetsOf(id, 'held'), ...stages.judgeSetsOf(id, 'reserve')]) { try { stages.deleteSet(j.id, j.id); } catch (_) { /* gone */ } }
        try { stages.deleteSet(id, id); } catch (_) { /* gone already */ }
      }
      c.cleanup();
    }
  },

  // THE ONE SURVIVOR'S STEPS, EACH OVER ITS OWN TRADES (3.247.2 and 3.247.3,
  // owner 2026-09-24: "the numbers in parenthesis match between AFTER HISTORY
  // and AFTER CONVICTION SIZING which doesn't make sense as the conviction
  // sizing reduced the number of trades", and "give the ACTUAL $ and trades ...
  // same for all the columns"). After the sizing, the trades a multiplier above
  // zero keeps; before History, for a survivor History retrained, its trades in
  // the capture of the set History started from; and a window the capture does
  // not hold is a dash after a tuning too, never $0.00.
  async theOneSurvivorsStepsAreEachOverTheirOwnTrades() {
    const HLmod = require('../lib/halflife');
    const zlib = require('zlib');
    const { multFor } = require('../lib/convictionsweep');
    const realRead = HLmod.readTable;
    // the first row of the table is won by the 12-month column, so History retrains one survivor
    HLmod.readTable = (rows, columns) => { const out = realRead(rows, columns); if (out.rows.length) out.rows[0].best = 'h12'; return out; };
    let c = null;
    try {
      c = await chain('tune steps test');
      await captured(c);
      const rule = c.cut;
      const members = stages.getSet(rule.id).capture.members;
      const depth = stages.getSet(rule.id).capture.pick.label;
      // sized only when every member agrees: every other trade is left out
      const top = Array.from({ length: members }, (_, i) => (i === members - 1 ? 1 : 0));
      stages.setSizingChoice(rule.id, { pick: 'depth', on: true, why: 'only when every member agrees', ladder: top });
      const cap = stages.readCapture(rule.id);
      const sv = cap.survivors.find((x) => x.label === depth);
      assert.ok(sv.entries.train.some((e) => multFor(top, e.agree) === 0), 'the fixture holds a trade the sizing leaves out, or the count below proves nothing');
      const tw = (await stages.tunedOfRule(stages.getSet(rule.id), [depth]))[depth].windows;
      const st = (await stages.pictureOf(stages.getSet(rule.id))).survivors.find((x) => x.label === depth).steps;
      for (const [w, k] of [['train', 'train'], ['test', 'test'], ['held', 'hold'], ['reserve', 'reserve']]) {
        const keeps = sv.entries[k].filter((e) => multFor(top, e.agree) > 0).length;
        assert.strictEqual(tw[w].taken, keeps, `${w}: the trades a multiplier above zero keeps`);
        assert.strictEqual(st[w].afterSizing.trades, keeps, `${w}: the one survivor shows the trades the sizing takes`);
        assert.strictEqual(st[w].afterStop, null, `${w}: no stop on record, no figure after a stop`);
      }
      const sum = (es) => ({ money: es.reduce((a, e) => a + e.usd, 0), trades: es.length });
      assert.deepStrictEqual(st.train.beforeHistory, sum(sv.entries.train), 'no History on this set: train before History is its own capture');
      // a window the capture does not hold is a dash after a tuning too
      const file = stages.captureFile(rule.id);
      const bytes = fs.readFileSync(file);
      try {
        fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify({ ...cap, reserve: null }))));
        const r2 = (await stages.pictureOf(stages.getSet(rule.id))).survivors.find((x) => x.label === depth).steps.reserve;
        assert.deepStrictEqual([r2.beforeHistory, r2.afterHistory, r2.afterStop, r2.afterSizing], [null, null, null, null], 'no reserve captured: a dash in every column of the reserve row');
      } finally { fs.writeFileSync(file, bytes); }
      // before History, for a survivor History retrained: its trades in the capture of the set History started from
      stages.halfLifeStart(rule.id, { months: [12] });
      await settle(() => stages.halfLifeStatus(rule.id), 'the half-life run');
      const run = stages.getSet(rule.id).halflife[0];
      const hl = stages.buildHalfLifeSet(rule.id, { runId: run.id, name: 'tune steps test half-life', keep: 'cut' });
      c.made.push(hl.id);
      stages.tuneCaptureStart(hl.id);
      await settle(() => stages.tuneCaptureStatus(hl.id), 'the half-life set\'s capture');
      const hlDoc = stages.getSet(hl.id);
      const retrained = hlDoc.survivors.find((x) => x.halfLife != null);
      assert.ok(retrained, 'a survivor History retrained');
      const unretrained = cap.survivors.find((x) => x.label === retrained.label);
      const again = stages.readCapture(hl.id).survivors.find((x) => x.label === retrained.label);
      const hst = (await stages.pictureOf(hlDoc)).survivors.find((x) => x.label === retrained.label).steps;
      assert.deepStrictEqual(hst.train.beforeHistory, sum(unretrained.entries.train), 'train before History: the set History started from, off its own capture');
      assert.deepStrictEqual(hst.train.afterHistory, sum(again.entries.train), 'train after History: the retrained forecasts, off the half-life set\'s own capture');
      // and a dash when the set History started from has no capture
      fs.renameSync(file, `${file}.aside`);
      try {
        const hst2 = (await stages.pictureOf(stages.getSet(hl.id))).survivors.find((x) => x.label === retrained.label).steps;
        assert.strictEqual(hst2.train.beforeHistory, null, 'no capture on the set History started from: a dash');
      } finally { fs.renameSync(`${file}.aside`, file); }
    } finally {
      HLmod.readTable = realRead;
      if (c) c.cleanup();
    }
  },

  // THE SAVE ON TUNE (3.247.0): its own panel after the conviction sizing; the
  // name box and its two ticks one control, bottom-aligned (RULE FOUR-A); the
  // press in a row of its own; every control with a help entry; the route served
  theSaveUnderANewNameIsItsOwnPanelLaidOutTheHouseWay() {
    const ui = src('public/construct.js');
    const fn = ui.slice(ui.indexOf('function tnCopyPanelHtml('), ui.indexOf('function tnSizingChoiceHtml('));
    assert.ok(fn.length > 0, 'a top-level helper draws it');
    assert.ok(ui.indexOf("${isSet ? tnCopyPanelHtml(chosen, busy, copySizingWords, copyNameInBox) : ''}") > ui.indexOf('Conviction sizing — change order sizing based on member agreement'), 'after the conviction sizing panel');
    const rows = [...fn.matchAll(/<div class="row"([^>]*)>([\s\S]*?)<\/div>/g)].map((m) => ({ attrs: m[1], body: m[2] }));
    const tickRow = rows.find((r) => r.body.includes('id="tnCopyName"'));
    assert.ok(tickRow && /align-items:flex-end/.test(tickRow.attrs), 'the name and the ticks bottom-align');
    assert.ok(tickRow.body.includes('id="tnCopyStops"') && tickRow.body.includes('id="tnCopySizing"') && !tickRow.body.includes('<button'), 'the two ticks beside the name, and no button with them');
    assert.ok(/<label class="c"[^>]*><input type="checkbox" id="tnCopyStops" checked>/.test(fn) && /<label class="c"[^>]*><input type="checkbox" id="tnCopySizing" checked>/.test(fn), 'the house tick, ticked to start: the set as it stands');
    assert.ok(/value="\$\{esc\(nameInBox == null \? cand\.name : nameInBox\)\}"/.test(tickRow.body) && !/maxlength/.test(tickRow.body), 'filled with the name in the box, or the set\'s own, and nothing cut');
    const btnRow = rows.find((r) => r.body.includes('id="tnCopy"'));
    assert.ok(btnRow && !btnRow.body.includes('<input'), 'the press in a row of its own');
    const help = src('public/help-content.js');
    for (const id of ['tnCopyName', 'tnCopyStops', 'tnCopySizing', 'tnCopy']) assert.ok(new RegExp(`\\n\\s+${id}: \\{`).test(help), `${id} has a help entry`);
    assert.ok(/api\/funnel\/set\/\$\{encodeURIComponent\(chosen\.id\)\}\/copy`, \{ name, stops, sizing, \.\.\.\(sizing && pricedLadder \? \{ ladder: pricedLadder, pick: tnPickVal, why: sizeWhy\(\) \} : \{\}\) \}/.test(ui), 'the press sends the name, the two ticks, and with the sizing ticked the numbers the table was priced at and the reason typed in the box');
    // WHAT THE SIZING TICK CARRIES IS SAID IN NUMBERS UNDER THE TICKS (3.249.0)
    const sayAt = fn.indexOf('id="tnCopySizingSay"');
    assert.ok(sayAt > fn.indexOf('id="tnCopySizing"') && sayAt < fn.indexOf('id="tnCopy"'), 'the line saying which multipliers travel sits under the ticks, above the press');
    assert.ok(/\$\{esc\(sizingWords \|\| ''\)\}/.test(fn), 'and it prints the words worked out on the tab');
    const srv = src('server.js');
    assert.ok(srv.includes("app.post('/api/funnel/set/:id/copy'") && /stages\.copyStage4Set\(req\.params\.id, req\.body \|\| \{\}\)/.test(srv), 'the route is served');
  },

  // APPLY RECORDS ONLY NUMBERS PRICED, AND TYPED NUMBERS OUTLIVE A REDRAW
  // (3.249.0, owner 2026-09-25: "the apply button in tune WAS used the first
  // time and it blew away the multiplier settings i had put on the records").
  // With no conviction table priced on what is chosen, Apply is held and says
  // why -- it used to write the declared ladder over whatever the survivors
  // carried. Numbers typed and not priced are put back after every redraw, and
  // the save under a new name waits for them as Apply does; the copy it makes
  // is the set chosen on Held.
  applyRecordsOnlyNumbersPricedAndTypedNumbersOutliveARedraw() {
    const ui = src('public/construct.js');
    const at = ui.indexOf('async function drawTune(');
    const tune = ui.slice(at, ui.indexOf('\nasync function ', at + 10));
    assert.ok(tune.includes('<button id="sizingApply" ${sizeHeld || !pricedLadder ? `disabled title="${esc(sizeHeldWhy || noTableWhy)}"`'), 'Apply is held with no table priced on what is chosen, and says why');
    assert.ok(tune.includes("${isSet && !sizeHeld && !pricedLadder ? `<div class=\"note\" style=\"margin-bottom:.4rem\">${esc(noTableWhy)}.</div>` : ''}"), 'and the reason is a line on the screen, not hover text alone');
    assert.ok(!/the declared ladder, one clip a member that agreed'\}/.test(tune) && tune.includes('if (szOn) szOn.onclick = () => { if (pricedLadder) sizing(true); };'), 'nothing falls back to the declared ladder');
    assert.ok(tune.indexOf('const pricedLadder = ') < tune.indexOf("$('#view').innerHTML"), 'the numbers priced are known before the page is drawn');
    // typed numbers kept for the same set, survivor and windows, and put back
    assert.ok(/const aimKey = isSet \? `\$\{chosen\.id\}\|\$\{tnPickVal\}\|\$\{tnWins\.join\(','\)\}` : '';/.test(tune), 'kept for what is chosen');
    assert.ok(tune.includes('tnTypedLadder = same || !aimKey ? null : { key: aimKey, raw: multBoxes().map((el) => el.value) };'), 'typing keeps them until they are priced');
    assert.ok(/if \(tnTypedLadder && tnTypedLadder\.key === aimKey && multBoxes\(\)\.length === tnTypedLadder\.raw\.length\) \{\s*multBoxes\(\)\.forEach\(\(el, i\) => \{ el\.value = tnTypedLadder\.raw\[i\]; \}\);\s*onTyped\(\);/.test(tune), 'a redraw puts them back and says they are not priced');
    assert.ok(/^let tnTypedLadder = null;/m.test(ui), 'held outside the draw, so a draw cannot forget them');
    // the save waits for them with the sizing ticked, and says which numbers travel
    assert.ok(tune.includes('const held = !!(pricedLadder && tick && tick.checked && !same);'), 'the save holds while the boxes are unpriced and the sizing is ticked');
    assert.ok(/tnCopyHold\(same\);/.test(tune), 'and follows every keystroke');
    // the copy is the set Held opens next
    assert.ok(tune.includes('try { localStorage.setItem(JUDGE_SET_KEY.held, s.id); } catch (_) { /* private window */ }'), 'the copy is the set chosen on Held');
    assert.ok(tune.includes('It is in the scan target box, and it is the set chosen on Held.'), 'and the line under the press says so, and no longer claims Reserve and Greenlight');
  },

  // WHAT A BOX HOLDS OUTLIVES A REDRAW, AND TAKING THE SIZING OFF LEAVES EVERY
  // ROW AT 1 (3.250.1, owner 2026-09-25: "if a reason is given for the sizing
  // then keep it in the box until either (a) a new conviction sizing is applied
  // or (b) take the sizing off is used or (c) a different record set is
  // displayed", "use of the take the sizing off button should set all units to
  // 1", and "if save under a new name is used then leave that name in the box").
  theReasonAndTheNameStayInTheirBoxesAndTakingTheSizingOffLeavesEveryRowAtOne() {
    const ui = src('public/construct.js');
    const at = ui.indexOf('async function drawTune(');
    const tune = ui.slice(at, ui.indexOf('\nasync function ', at + 10));
    assert.ok(/^let tnSizingWhyTyped = null;/m.test(ui) && /^let tnCopyNameTyped = null;/m.test(ui), 'held outside the draw, so a redraw cannot forget them');
    // the reason: typed stays; with nothing typed, the reason on record for what is chosen, all survivors included
    assert.ok(tune.includes('value="${esc(sizingWhyInBox)}"'), 'the reason box shows what is kept');
    assert.ok(tune.includes('const sizingWhyInBox = tnSizingWhyTyped ? tnSizingWhyTyped.text : whyOnRecord;'), 'what was typed, else the reason on record');
    assert.ok(/const whyOnRecord = rowsSized\.map\(sizingOf\)/.test(tune), 'the reason on record is read off every survivor chosen, so all survivors shows it too');
    assert.ok(tune.includes('swBox.oninput = () => { tnSizingWhyTyped = { set: chosen.id, text: swBox.value }; };'), 'typing keeps it');
    // (a) and (b): a press records it or takes the sizing off, and the kept text goes; (c) another set clears it
    const press = tune.slice(tune.indexOf('const sizing = async (on) => {'), tune.indexOf("const szOn = $('#sizingApply');"));
    assert.ok(press.indexOf('tnSizingWhyTyped = null;') > press.indexOf('if (!out) return;'), 'cleared only once the press is recorded');
    assert.ok(tune.includes('if (tnSizingWhyTyped && (!isSet || tnSizingWhyTyped.set !== chosen.id)) tnSizingWhyTyped = null;'), 'another set clears it');
    // taking the sizing off leaves every row at 1
    assert.ok(press.includes("if (!on && pricedLadder) tnTypedLadder = { key: aimKey, raw: pricedLadder.map(() => '1') };"), 'the multiplier boxes read 1 on every row after the sizing is taken off');
    assert.ok(tune.includes("'none — ×1 on every row, each trade at its own size alone'"), 'and the line under the presses says so');
    // the name: saved or typed, it stays; another set clears it
    assert.ok(tune.includes("const copyNameInBox = tnCopyNameTyped ? tnCopyNameTyped.name : (isSet ? chosen.name : '');") && tune.includes('tnCopyPanelHtml(chosen, busy, copySizingWords, copyNameInBox)'), 'the name box shows what is kept');
    assert.ok(tune.includes('cnBox.oninput = () => { tnCopyNameTyped = { set: chosen.id, name: cnBox.value }; };') && tune.includes('tnCopyNameTyped = { set: chosen.id, name };'), 'typed or saved, it is kept');
    assert.ok(tune.includes('if (tnCopyNameTyped && (!isSet || tnCopyNameTyped.set !== chosen.id)) tnCopyNameTyped = null;'), 'another set clears it');
  },

  // A SET COMES UP WITH ITS RESULTS (3.251.1, owner 2026-09-25: "when a stage 4
  // with scan target is selected on tune the existing protective stop tuner and
  // conviction sizing sections should be loaded with the selections and
  // results"): the first draw of a set under scan target, with nothing kept on
  // the survivor and windows remembered, takes the ones the newest kept result
  // read and draws again; a choice made after that is never changed back.
  aSetUnderScanTargetComesUpWithTheSurvivorAndWindowsItsResultsRead() {
    const ui = src('public/construct.js');
    const at = ui.indexOf('async function drawTune(');
    const tune = ui.slice(at, ui.indexOf('\nasync function ', at + 10));
    assert.ok(/^let tnLastTarget = null;/m.test(ui), 'the set drawn last is held outside the draw');
    const block = tune.slice(tune.indexOf('if (isSet && tnLastTarget !== chosen.id) {'), tune.indexOf('if (!isSet) tnLastTarget = null;'));
    assert.ok(block.length > 0 && block.indexOf('tnLastTarget = chosen.id;') > 0, 'only the first draw of a set, whichever way it came up');
    assert.ok(block.includes("const shown = [stop, conv].some((x) => x && ['done', 'running', 'error'].includes(x.status));"), 'and only when neither scan has something to show');
    assert.ok(block.includes("newest.survivor === 'all' ? 'all' : (newest.survivor === (chosen.pick || {}).label ? 'depth' : newest.survivor)"), 'the survivor the newest kept result read, by depth when that is who it was');
    assert.ok(block.includes('localStorage.setItem(TN_PICK_KEY, pick); localStorage.setItem(TN_WINDOWS_KEY, JSON.stringify(newest.windows || []));') && block.includes('return drawTune();'), 'set as the choice, and the tab drawn with it');
    assert.ok(/for \(const m of familyOf\(t\.doc\)\)/.test(src('lib/stages.js')), 'the service hands a copy the scans of its family on the same trades');
    // WITH THE SETTINGS SAVED ON IT (3.251.2, owner 2026-09-25: "load the half-life table with the settings that were saved on it")
    assert.ok(/^let tnLoadSavedFor = null;/m.test(ui) && block.includes('tnLoadSavedFor = chosen.id;'), 'a set come up is marked to load what is saved on it, through the redraw');
    const load = tune.slice(tune.indexOf('if (isSet && tnLoadSavedFor === chosen.id) {'), tune.indexOf('if (isSet && tnLoadSavedFor === chosen.id) {') + 600);
    assert.ok(load.includes('JSON.stringify(ladderOnRecord) !== JSON.stringify(pricedLadder)') && load.includes('raw: ladderOnRecord.map(String)'), 'the saved multipliers go in the boxes when the table was priced at others');
    assert.ok(tune.indexOf('const ladderOnRecord = ') < tune.indexOf('if (isSet && tnLoadSavedFor === chosen.id) {') && tune.indexOf('const pricedLadder = ') < tune.indexOf('if (isSet && tnLoadSavedFor === chosen.id) {'), 'once both are known');
    assert.ok(tune.includes("'these are the numbers saved on this set; the table was priced at others - press Recompute to price them'"), 'and the line under the table says which numbers they are');
  },
};
