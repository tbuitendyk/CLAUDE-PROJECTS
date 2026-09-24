// The verdict on a Stage 4 record set (3.86.0, VERIFY-DESIGN.md sections 4, 7
// and 8). Two rails: every reading rule is DECLARED before its number exists
// and rides on the block; and the set is read as a whole, every survivor and
// never a page, with each survivor's own reading printed beside it and never
// gating the set. Each test name is the assertion a mutation guard aims at.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const stages = require('../lib/stages');
const V = require('../lib/funnelverify');
const F = require('../lib/funnel');

const ROOT = path.join(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SETS_DIR = path.join(ROOT, 'data', 'stagesets');

// A STAGE 3 SET ON DISK with a stage 2 parent carrying the sealed window, the
// four comparisons for its units, and the date ranges (3.85.0): two units, five
// settings on each. Unit 0: two `active` settings whose held-back money beats
// every one of their ten copies, three `directional` settings that lose with
// every copy losing too (so noise mostly loses on the board). Unit 1 is the
// same shape with the money halved, so a set cut on the blend has no unit.
async function fixture(opts = {}) {
  const rowstore = require('../lib/rowstore');
  const stamp = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const id = `s3-test-${stamp}-vf`;
  const parentId = `s2-test-${stamp}-vf`;
  fs.mkdirSync(SETS_DIR, { recursive: true });
  const units = [
    { u: 0, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-1d' },
    { u: 1, trade: 'BBB', ctx1: null, ctx2: null, size: 1, geometry: 'daily-1d' },
  ];
  const keys = units.map((u) => stages.unitKeyOf(u));
  // the stage 2 parent: its records carry the sealed window the cut reads
  fs.writeFileSync(path.join(SETS_DIR, `${parentId}.json`), JSON.stringify({
    id: parentId, stage: 2, seq: 999979, name: 'S2 #vf', status: 'done', createdAt: new Date().toISOString(),
    plan: { units: 2 }, params: { universe: ['AAA', 'BBB'], windowLayout: 'reserve61' },
  }));
  const pw = rowstore.writer(parentId, 'records');
  units.forEach((u, i) => pw.push({ u: u.u, carriedRank: i + 1, s1rank: i + 1, trade: u.trade, ctx1: u.ctx1, ctx2: u.ctx2,
    size: u.size, geometry: u.geometry, specs: [], bandPct: 2, scoreAll: 5 - i, score3: 4 - i,
    reserve: { chunks: 5, fromTs: 1735689600000 + i, toTs: 1736121600000 } }));
  await pw.close();
  const K = opts.copies == null ? 10 : opts.copies;
  const controlsAt = { alwaysLong: 3, alwaysShort: -4, alwaysLongTrades: 40, buyHold: 2, shortHold: -3 };
  const doc = {
    id, stage: 3, seq: 999980, name: 'S3 #vf', status: 'done', createdAt: new Date().toISOString(),
    plan: { units: 2, settings: 5 },
    params: { engineVersion: require('../package.json').version, nullN: K, keepN: K, windowLayout: 'reserve61', carry: 0, selected: null, fee: 0.00125 },
    boardNull: { captured: K > 0, kept: K },
    parent: { id: parentId, name: 'S2 #vf' },
    controls: { at: new Date().toISOString(), units: Object.fromEntries(keys.map((k) => [k, { 'all|41': { ...controlsAt }, 'all|65': { ...controlsAt }, 'all|89': { ...controlsAt } }])) },
    windows: { at: new Date().toISOString(), units: Object.fromEntries(keys.map((k) => [k, {
      layout: 'reserve61',
      train: { fromTs: 1704067200000, toTs: 1723312800000, chunks: 222 }, test: { fromTs: 1723248000000, toTs: 1727460000000, chunks: 48 },
      hold: { fromTs: 1727395200000, toTs: 1731607200000, chunks: 48 }, unread: { fromTs: 1735689600000, chunks: 5, seenToTs: 1736121600000 },
    }])) },
  };
  fs.writeFileSync(path.join(SETS_DIR, `${id}.json`), JSON.stringify(doc));
  const w = rowstore.writer(id, 'records');
  let si = 0;
  const settings = [['active', 41], ['active', 65], ['directional', 41], ['directional', 65], ['directional', 89]];
  for (const [g, t] of settings) {
    const label = `q1 ${g} t${t} · argmax auto 24/7`;
    for (const u of units) {
      const scale = u.u === 0 ? 1 : 0.5;
      const winner = g === 'active';
      const pnl = (winner ? 10 : -4) * scale;
      const held = (winner ? 5 : -2) * scale;
      const noiseTest = Array.from({ length: K }, (_, d) => (winner ? 9 - d * 0.1 : -3 - d * 0.1) * scale);
      const noiseHold = Array.from({ length: K }, (_, d) => (winner ? 4 - d * 0.1 : -1 - d * 0.1) * scale);
      w.push({ si, label, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
        entry: 'market', gate: g, dMult: 1.5, tHours: t, trailMult: null, armMult: null,
        agreeRule: 'share', agreeBar: 0.6, agreePct: null, agreeCopy: 'plain', agreeBoth: false, agreePersist: 0,
        rung: 3, members: 8, voices: 5, pnl, trades: 10,
        holdout: { pnl: held, trades: 4, stops: 1, vsAlwaysLong: held - 1 },
        beat: winner ? 8 : 1, pairs: 12, lead: winner ? 1.5 : -0.5,
        pnlThirds: [pnl / 3, pnl / 3, pnl / 3],
        ...(K ? { noiseTest, noiseHold } : {}),
        ...u });
    }
    si++;
  }
  await w.close();
  const t = await stages.buildTally(doc);
  const cleanup = () => {
    // the Stage 4 sets cut from this fixture carry the cut's own id, not the
    // stamp: they are found by their parent (148 were left behind before this)
    for (const f of fs.readdirSync(SETS_DIR)) {
      if (/^s4-.*\.json$/.test(f)) {
        let d = null;
        try { d = JSON.parse(fs.readFileSync(path.join(SETS_DIR, f), 'utf8')); } catch (_) { d = null; }
        if (d && d.parent && d.parent.id === id) { try { fs.rmSync(path.join(SETS_DIR, f), { force: true }); } catch (_) { /* fixture */ } }
      }
      if (f.includes(stamp)) { try { fs.rmSync(path.join(SETS_DIR, f), { force: true, recursive: true }); } catch (_) { /* fixture */ } }
    }
    try { fs.rmSync(stages.funnelRichDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
    try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
    try { fs.rmSync(rowstore.storeDir(parentId), { recursive: true, force: true }); } catch (_) { /* fixture */ }
  };
  return { id, parentId, doc, t, units, keys, stamp, cleanup };
}
const RULE = { allowed: { gate: ['active'] } };
// A RESERVE BOARD WRITTEN BY HAND for the fixture's five settings (3.148.0): the
// active ones make money on the reserve, the directional ones lose it, in
// figures that are not the held-back ones, so a reading off the board can be
// told from a reading off the records
function handBoard(K, scale = 1) {
  const rows = [];
  for (const [g, t] of [['active', 41], ['active', 65], ['directional', 41], ['directional', 65], ['directional', 89]]) {
    const winner = g === 'active';
    const money = (winner ? 7 : -3) * scale;
    rows.push({ si: rows.length, label: `q1 ${g} t${t} · argmax auto 24/7`, tHours: t, weekdaysOnly: false,
      avgHold: money, avgTrades: 4, avgVsLong: money - 1, noiseHold: Array.from({ length: K }, (_, d) => (winner ? 6 - d * 0.1 : -2 - d * 0.1) * scale),
      beat: winner ? 9 : 0, pairs: K, avgLead: winner ? 1.2 : -0.7, pnlThirds: [money / 3, money / 3, money / 3], stops: 1,
      ride: { maxDrawdown: -1, worstTrade: -2, bestTrade: 3, wins: 2, stops: 1, grossPerTrade: 1, pnlThirds: [money / 3, money / 3, money / 3] },
      test: { money: (winner ? 10 : -4) * scale, trades: 10 } });
  }
  const four = { alwaysLong: 3, alwaysShort: -4, buyHold: 2, shortHold: -3 };
  return { rows, controls: { 'all|41': { ...four }, 'all|65': { ...four }, 'all|89': { ...four } }, window: { fromTs: 1735689600000, toTs: 1736121600000, chunks: 5, seenToTs: 1736121600000, forecastHash: 'hand' },
    fee: 0.00125, nullN: K, keepN: K, forecasts: "the members' saved models", settings: 5, missing: [], failures: [], unitName: 'AAA daily-1d', proof: { checked: 5, of: 5 } };
}
async function cutOn(f, extra = {}) {
  return stages.cutFunnelSet(f.id, { rule: RULE, closing: { key: 'rule' }, unit: f.keys[0], steps: [{ n: 1, what: 'kept gate active' }], backSteps: [{ from: 2, to: 1, why: 'a look back' }], marks: [{ key: 'spike', step: 2, detail: 'tHours' }], barPct: 80, ...extra });
}
// the press on a stretch, started and polled until it lands; it writes a held
// set or a reserve set of the rule (3.147.0), and the answer names it
async function pressed(id, asked = {}, stretch = 'held') {
  stages.judgeStart(id, stretch, asked);
  for (let i = 0; i < 400; i++) {
    const st = stages.judgeStatus(id, stretch);
    if (st.error) throw new Error(st.error);
    if (st.result) return st.result;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error('the read did not land');
}
// the sets read from a rule on a stretch, newest first, and the block of the n-th newest
const setsOf = (id, stretch = 'held') => stages.judgeSetsOf(id, stretch);
const blockOf = (id, n = 0, stretch = 'held') => ((setsOf(id, stretch)[n] || {}).block);
const rewrite = (id, fn) => { const file = path.join(SETS_DIR, `${id}.json`); const d = JSON.parse(fs.readFileSync(file, 'utf8')); fn(d); fs.writeFileSync(file, JSON.stringify(d)); return d; };
// the read of the other units, started and polled until it lands
async function othersPressed(id, asked = {}) {
  stages.funnelOthersStart(id, asked);
  for (let i = 0; i < 400; i++) {
    const st = stages.funnelOthersStatus(id);
    if (st.error) throw new Error(st.error);
    if (st.result) return st.result;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error('the read of the other units did not land');
}
const settle = (statusOf) => new Promise((resolve) => {
  const tick = () => { const st = statusOf(); if (st.result || st.error || st.none) resolve(st); else setTimeout(tick, 25); };
  tick();
});
// the rows a copies read is made of, in the shape lib/stages.js hands them in
const rows = (n = 3, K = 10) => Array.from({ length: n }, (_, i) => ({
  si: i, label: `s${i}`, tHours: 41, weekdaysOnly: false, avgTest: 10 - i, avgHold: 5 - i * 0.5, avgTrades: 4, avgVsLong: 1, beat: 8, pairs: 12, avgLead: 1.2,
  noiseTest: Array.from({ length: K }, (_, d) => 8 - d * 0.1), noiseHold: Array.from({ length: K }, (_, d) => 4 - d * 0.1),
}));
// the four at the one hold length these rows use, as lib/stages.js controlsOf hands them in: the span, and the figures by key (3.146.0)
const CONTROLS = { known: true, keys: ['all|41'], of: 1, missing: 0, alwaysLong: { lo: 3, hi: 3 }, alwaysShort: { lo: -4, hi: -4 }, buyHold: { lo: 2, hi: 2 }, shortHold: { lo: -3, hi: -3 }, byKey: { 'all|41': { alwaysLong: 3, alwaysShort: -4, buyHold: 2, shortHold: -3 } } };

module.exports = {
  // THE RULES BLOCK IS WRITTEN BEFORE THE NUMBERS. In the press, the rules are
  // declared before the board is even loaded; on the block they are exactly what
  // declareRules said, and every reading takes them rather than a threshold of
  // its own.
  async theRulesBlockIsWrittenBeforeTheNumbers() {
    const s = src('lib/stages.js');
    const run = s.slice(s.indexOf('async function judgeRunOn('));
    assert.ok(run.indexOf('V.declareRules(') < run.indexOf('funnelVerifyJoin('), 'the rules must be declared before the board is read');
    assert.ok(run.indexOf('V.declareRules(') < run.indexOf('V.copiesRead('), 'and before the copies are read');
    const lib = src('lib/funnelverify.js');
    for (const fn of ['copiesRead', 'perSurvivor', 'sanity', 'lineA', 'lineB']) {
      assert.ok(new RegExp(`function ${fn}\\([^)]*rules`).test(lib), `${fn} must take the declared rules, never decide its own`);
    }
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      await pressed(doc.id, { barPct: 70, sanityPct: 40 });
      const block = blockOf(doc.id);
      assert.deepStrictEqual(block.rules, V.declareRules(doc.check, { barPct: 70, sanityPct: 40 }), 'the block carries exactly the declared rules');
      assert.strictEqual(block.copies.bar, block.rules.bar);
      assert.strictEqual(block.sanity.threshold, 40);
      for (const k of ['footing', 'comparisons', 'bar', 'sanity']) assert.ok(['DERIVED', 'GUESSED'].includes(block.rules.tags[k]), `${k} is tagged`);
    } finally { f.cleanup(); }
  },

  // THE HELD-BACK TWIN OF THE ACROSS LOOP GIVES THE ACROSS LOOP'S ANSWER when
  // it is handed test money: the same rows, the same means per copy, the same
  // count of copies beaten, the same lead. Worked by hand here, not by the loop
  // under test.
  theOwnCopiesReadMatchesTheAcrossReadOnAFixtureBoard() {
    const list = rows(3, 10);
    const rules = V.declareRules({ kind: 'scrambles', k: 10, barPct: 80 });
    const a = V.lineA(list, rules);
    const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
    const real = mean(list.map(F.money));
    const copies = Array.from({ length: 10 }, (_, d) => mean(list.map(F.moneyAt(d))));
    const beats = copies.filter((v) => F.beats(real, v)).length;
    assert.strictEqual(a.real, real);
    assert.deepStrictEqual(a.copyMeans, copies);
    assert.strictEqual(a.beats, beats);
    assert.strictEqual(a.lead, F.leadOf(real, copies));
    // and the held-back read is the same arithmetic on the held-back figures
    const c = V.copiesRead(list, rules);
    const realH = mean(list.map((r) => r.avgHold));
    const copiesH = Array.from({ length: 10 }, (_, d) => mean(list.map((r) => r.noiseHold[d])));
    assert.strictEqual(c.real, realH);
    assert.deepStrictEqual(c.copyMeans, copiesH);
    assert.strictEqual(c.beats, copiesH.filter((v) => F.beats(realH, v)).length);
    // and a read that beats half the copies is below a bar of eight, so it fails
    const half = rows(3, 10).map((r) => ({ ...r, noiseHold: r.noiseHold.map((v, d) => (d < 5 ? v : 9)) }));
    const short = V.copiesRead(half, rules);
    assert.deepStrictEqual({ beats: short.beats, bar: short.bar, pass: short.pass }, { beats: 5, bar: 8, pass: false });
  },

  async theBarIsTheSetsOwnUnlessChangedAndTheChangeIsStamped() {
    const own = V.declareRules({ kind: 'scrambles', k: 10, barPct: 70 });
    assert.deepStrictEqual({ barPct: own.barPct, bar: own.bar, changed: own.barChanged, tag: own.tags.bar }, { barPct: 70, bar: 7, changed: false, tag: 'DERIVED' });
    const asked = V.declareRules({ kind: 'scrambles', k: 10, barPct: 70 }, { barPct: 90 });
    assert.deepStrictEqual({ barPct: asked.barPct, bar: asked.bar, changed: asked.barChanged, tag: asked.tags.bar, own: asked.ownBarPct }, { barPct: 90, bar: 9, changed: true, tag: 'GUESSED', own: 70 });
    // an empty box means the set's own, never a default of the reader's
    assert.strictEqual(V.declareRules({ kind: 'scrambles', k: 10, barPct: 70 }, { barPct: '' }).barPct, 70);
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      await pressed(doc.id, {});
      await pressed(doc.id, { barPct: 50 });
      const [later, first] = setsOf(doc.id).map((x) => x.block);
      assert.strictEqual(first.rules.barChanged, false);
      assert.strictEqual(first.rules.barPct, 80);
      assert.deepStrictEqual({ barPct: later.rules.barPct, changed: later.rules.barChanged, tag: later.rules.tags.bar }, { barPct: 50, changed: true, tag: 'GUESSED' });
    } finally { f.cleanup(); }
  },

  async verifyRefusesWhenTheRuleNoLongerReplays() {
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      const d = stages.getSet(doc.id);
      d.survivors = d.survivors.slice(1);           // one survivor struck off the record
      d.counts.survivors = d.survivors.length;
      fs.writeFileSync(path.join(SETS_DIR, `${d.id}.json`), JSON.stringify(d));
      const dry = await stages.judgeDry(doc.id, 'held');
      assert.ok(/does not give back its own survivors/.test(dry.refused || ''), `the dry read says why: ${dry.refused}`);
      assert.strictEqual(dry.footing.ok, false);
      let threw = null;
      try { await pressed(doc.id); } catch (e) { threw = e.message; }
      assert.ok(/does not give back its own survivors/.test(threw || ''), 'and the press refuses in the same words');
      assert.strictEqual(setsOf(doc.id).length, 0, 'nothing was written');
    } finally { f.cleanup(); }
  },

  async verifyRefusesARuleWhoseKeysAreNotDialsOrTheTwoLimits() {
    const keys = V.ruleKeys({ ranges: { tHours: { min: 41, max: 65 } }, allowed: { gate: ['active'] }, floors: { maxDrawdown: { max: 90 }, avgTrades: { min: 3 } } });
    assert.deepStrictEqual({ ok: keys.ok, bad: keys.bad, trades: keys.readsHeldBackTrades }, { ok: true, bad: [], trades: true });
    const bad = V.ruleKeys({ ranges: { avgHold: { min: 0 } }, allowed: { label: ['x'] }, floors: { avgHold: { min: 0 } } });
    assert.deepStrictEqual(bad.bad, ['ranges.avgHold', 'allowed.label', 'floors.avgHold']);
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      const d = stages.getSet(doc.id);
      d.rule.floors = { avgHold: { min: -100 } };     // still replays; not a dial nor a limit
      fs.writeFileSync(path.join(SETS_DIR, `${d.id}.json`), JSON.stringify(d));
      const dry = await stages.judgeDry(doc.id, 'held');
      assert.ok(/not dials or the two limits \(floors\.avgHold\)/.test(dry.refused || ''), `says which key: ${dry.refused}`);
      let threw = null;
      try { await pressed(doc.id); } catch (e) { threw = e.message; }
      assert.ok(/not dials or the two limits/.test(threw || ''));
    } finally { f.cleanup(); }
  },

  // THE PRESS WAITS FOR THE BOX: a sweep, a stage run, a totalling and step 6's
  // press all refuse it through the same two readers every other launch uses.
  verifyRefusesWhileAStageRuns() {
    const s = src('lib/stages.js');
    const refusal = s.slice(s.indexOf('function judgeRefusalOf('), s.indexOf('async function priceSurvivorsOn('));
    assert.ok(/const busy = verifyBusy\(\);\s*\n\s*if \(busy\) return `\$\{busy\}/.test(refusal), 'the press must ask what is busy and refuse on it');
    const start = s.slice(s.indexOf('function judgeStart('), s.indexOf('function judgeStatus('));
    assert.ok(/const why = judgeRefusalOf\(doc, stretch, null\);\s*\n\s*if \(why\) throw new Error\(why\);/.test(start), 'and the press throws the refusal');
    const busy = s.slice(s.indexOf('const verifyBusy ='), s.indexOf('const verifyBusy =') + 200);
    assert.ok(/stageBusy\(\)/.test(busy), 'busy means a stage run, a totalling or a rebuild');
    const dry = s.slice(s.indexOf('async function judgeDry('), s.indexOf('function judgeSummaryOf('));
    assert.ok(/out\.refused = judgeRefusalOf\(doc, stretch, out\.footing\);/.test(dry), 'and the dry read says so before the button is pressed');
  },

  async theSurvivorsAreReadInFullNeverAPage() {
    const s = src('lib/stages.js');
    const join = s.slice(s.indexOf('async function funnelVerifyJoin('), s.indexOf('function sealedOnUnitOf('));
    assert.ok(!/\.slice\(from|per = 2000|clipped/.test(join), 'the join must never page the survivors');
    assert.ok(/const rows = wanted\.map\(/.test(join), 'every survivor on the record is read');
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      const r = await pressed(doc.id);
      const block = blockOf(doc.id);
      assert.strictEqual(doc.counts.survivors, 2);
      assert.strictEqual(block.read.of, 2);
      assert.strictEqual(block.survivors.rows.length, 2);
      assert.deepStrictEqual(block.survivors.rows.map((x) => x.label), doc.survivors.map((x) => x.label), 'in the record\'s own order');
      assert.strictEqual(r.look, 1);
    } finally { f.cleanup(); }
  },

  async heldBackReadAtIsWrittenOnceAndNeverChanged() {
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      assert.strictEqual(stages.getSet(doc.id).heldBackReadAt, null, 'the cut is not the stamped look');
      const dry = await stages.judgeDry(doc.id, 'held');
      assert.strictEqual(stages.getSet(doc.id).heldBackReadAt, null, 'nor is the dry read');
      assert.ok(dry.looks.unstamped >= 3, `the walk's looks are counted before any stamp: ${dry.looks.unstamped}`);
      await pressed(doc.id);
      const first = stages.getSet(doc.id).heldBackReadAt;
      assert.ok(first, 'the first press stamps it');
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      await pressed(doc.id);
      assert.strictEqual(stages.getSet(doc.id).heldBackReadAt, first, 'a later press leaves it exactly as it was');
      assert.strictEqual(blockOf(doc.id, 1).at, first, 'and it is the first held set\'s own time');
    } finally { f.cleanup(); }
  },

  // EVERY PRESS WRITES A SET (3.147.0): a held set of the rule, named after it,
  // numbered from the second, each with its one block; the first is untouched
  // by the second, and the rule carries no block of its own.
  async everyPressAppendsABlockAndOverwritesNone() {
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      const r1 = await pressed(doc.id);
      const first = setsOf(doc.id)[0];
      assert.deepStrictEqual({ kind: first.kind, stretch: first.stretch, from: first.from.id, number: first.number, name: first.name, id: r1.id }, { kind: 'held', stretch: 'held', from: doc.id, number: 1, name: `held set of ${doc.name}`, id: first.id });
      const one = JSON.parse(JSON.stringify(first.block));
      // a stop choice on the rule before the second press freezes into that set and never reaches the first
      const stop = { [doc.survivors[0].label]: { stopPct: 0.11, why: 'forced', at: '2026-09-15T00:00:00.000Z', by: 'owner' } };
      rewrite(doc.id, (d) => { d.stopChoices = stop; });
      await pressed(doc.id, { barPct: 60 });
      const list = setsOf(doc.id);
      assert.strictEqual(list.length, 2);
      assert.deepStrictEqual(list[1].block, one, 'the first set is untouched');
      assert.deepStrictEqual(list.map((x) => x.block.look), [2, 1], 'newest first, numbered');
      assert.deepStrictEqual(list.map((x) => x.name), [`held set of ${doc.name} #2`, `held set of ${doc.name}`]);
      assert.deepStrictEqual(list.map((x) => x.block.id), [`${list[0].id}-v1`, `${list[1].id}-v1`], 'one block a set');
      assert.strictEqual(list[0].block.looks.stamped, 1, 'the second press knows one stamped look came before it');
      assert.ok(!('verify' in stages.getSet(doc.id)), 'the rule carries no block');
      // the frozen copy: the rule, the survivors and the stop choices as they stood
      assert.deepStrictEqual({ rule: list[0].rule, survivors: list[0].survivors.map((x) => x.label), unit: list[0].unit, parent: list[0].parent.id, stops: list[0].stopChoices }, { rule: stages.getSet(doc.id).rule, survivors: doc.survivors.map((x) => x.label), unit: doc.unit, parent: f.id, stops: stop });
      assert.deepStrictEqual(list[1].stopChoices, {}, 'the first set froze what the rule carried at its own press');
      const dry = await stages.judgeDry(doc.id, 'held');
      assert.strictEqual(dry.sets.length, 2, 'the dry read hands every set back');
      assert.deepStrictEqual(dry.sets.map((x) => x.number), [2, 1]);
      const sum = stages.judgeSummaryOf(stages.getSet(doc.id));
      assert.deepStrictEqual({ sets: sum.held.sets, newest: sum.held.newest.name, pass: sum.held.newest.pass, stands: sum.held.stands, reserve: sum.reserve.sets, keeps: sum.keepsReserve }, { sets: 2, newest: list[0].name, pass: one.verdict.pass, stands: one.verdict.pass, reserve: 0, keeps: true }, 'the list summary is the newest set');
      // a frozen set takes no stop choice, and is not read again as a rule
      let threw = null;
      try { stages.setStopChoice(list[0].id, { pick: 'depth', stopPct: 0.1 }); } catch (e) { threw = e.message; }
      assert.ok(/frozen at the press/.test(threw), threw);
      threw = null;
      try { stages.judgeStart(list[0].id, 'held', {}); } catch (e) { threw = e.message; }
      assert.ok(/already read and frozen/.test(threw), threw);
    } finally { f.cleanup(); }
  },

  theVerdictCannotPassOnUnknownComparisons() {
    const list = rows(3, 10);
    const rules = V.declareRules({ kind: 'scrambles', k: 10, barPct: 80 });
    const known = V.heldBackRead(list, CONTROLS);
    assert.deepStrictEqual({ pass: known.pass, incomplete: known.incomplete, buy: known.comparisons.beatsBuyHold, short: known.comparisons.beatsShortHold }, { pass: true, incomplete: false, buy: true, short: true });
    const unknown = V.heldBackRead(list, { known: false, why: 'this record set kept nothing to beat for AAA|||daily-1d' });
    assert.deepStrictEqual({ pass: unknown.pass, incomplete: unknown.incomplete, why: unknown.comparisons.why }, { pass: false, incomplete: true, why: 'this record set kept nothing to beat for AAA|||daily-1d' });
    const copies = V.copiesRead(list, rules);
    assert.strictEqual(copies.pass, true, 'the copies pass on this table');
    const sane = V.sanity(rows(3, 10).map((r) => ({ ...r, noiseHold: r.noiseHold.map((v) => -v) })), list, rules);
    const block = V.buildBlock({ rules, footing: { ok: true, had: 3 }, looks: { unstamped: 3 }, read: unknown, copies, survivors: V.perSurvivor(list, rules), sanity: sane, lineA: V.lineA(list, rules), lineB: V.lineB(list, 3, rules) });
    assert.strictEqual(block.verdict.pass, false, 'unknown never passes');
    assert.ok(/the four comparisons are not known/.test(block.verdict.sentence));
    const withKnown = V.buildBlock({ ...block, read: known });
    assert.strictEqual(withKnown.verdict.pass, true, 'and the same block passes once they are known and beaten');
  },

  async theDealCountAndTheKeptCountArePrintedOnEveryVerdict() {
    const per = V.perSurvivor(rows(3, 10), V.declareRules({ kind: 'scrambles', k: 10, barPct: 80 }));
    assert.strictEqual(per.dealsOver, 12, 'the deals the stored figure is over');
    assert.strictEqual(per.kept, 10, 'and the copies kept, as two numbers');
    const ui = src('public/construct.js');
    assert.ok(/over \$\{s\.dealsOver == null \? '\?' : s\.dealsOver\} deal\(s\) a setting, \$\{s\.kept\} copies kept/.test(ui), 'the screen prints both, never one for the other');
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      await pressed(doc.id);
      const b = blockOf(doc.id);
      assert.deepStrictEqual({ deals: b.survivors.dealsOver, kept: b.survivors.kept }, { deals: 12, kept: 10 });
      assert.ok(/the finest claim 10 copies allow is 1 in 11/.test(b.verdict.sentence), 'the claim is over the copies kept');
    } finally { f.cleanup(); }
  },

  theTwoLeadDefinitionsAreNamedNeverMixed() {
    const per = V.perSurvivor(rows(3, 10), V.declareRules({ kind: 'scrambles', k: 10, barPct: 80 }));
    assert.ok(/population spread/.test(per.definitions.storedLead) && /sample spread/.test(per.definitions.lead), 'both definitions are named');
    assert.ok(/raw dollars/.test(per.definitions.storedBeat) && /cents/.test(per.definitions.beats), 'and both beat definitions');
    for (const r of per.rows) {
      assert.strictEqual(r.storedLead, 1.2, 'the stored lead is read as stored');
      assert.strictEqual(r.lead, F.leadOf(r.money, r.noiseHold || rows(1, 10)[0].noiseHold.map((v) => v)), 'the lead read here uses the sample spread');
    }
    assert.ok(per.medianStoredLead !== per.medianLead, 'the two medians are two numbers');
    const ui = src('public/construct.js');
    assert.ok(/median lead \$\{vFix\(s\.medianLead\)\} read here, \$\{vFix\(s\.medianStoredLead\)\} as stored/.test(ui), 'the screen names which is which');
    const lib = src('lib/funnelverify.js');
    assert.ok(!/storedLead \?\? |\?\? r\.lead|storedBeat \|\| .*beats/.test(lib), 'nothing falls back from one definition to the other');
  },

  aSurvivorWithNoFigureOnACopyIsCountedNotDropped() {
    const rules = V.declareRules({ kind: 'scrambles', k: 10, barPct: 80 });
    const list = rows(3, 10);
    list[1].noiseHold[3] = null;                       // one survivor, one copy missing
    list[2].noiseHold = null;                          // one survivor with no figure at all
    const c = V.copiesRead(list, rules);
    assert.strictEqual(c.copySurvivors[3], 1, 'copy 3 has one survivor with a figure');
    assert.strictEqual(c.copySurvivors[0], 2, 'the rest have two');
    assert.strictEqual(c.copiesShortOfSurvivors, 10, 'every copy is short of the three survivors, and says so');
    assert.strictEqual(c.survivorsWithNoFigure, 1);
    assert.strictEqual(c.copyMeans.length, 10, 'no copy is dropped');
    const per = V.perSurvivor(list, rules);
    assert.strictEqual(per.rows[2].copiesKept, 0);
    assert.strictEqual(per.rows[2].pass, false, 'a survivor with no copies cannot pass on its own');
    assert.strictEqual(per.rows[1].copiesKept, 9);
  },

  async theFeeRidesOnTheBlock() {
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      await pressed(doc.id);
      const b = blockOf(doc.id);
      assert.deepStrictEqual(b.fee, { feePerLeg: 0.00125, feeUnits: 'fraction' }, 'under the name every downstream reader looks for');
      assert.deepStrictEqual({ sealed: b.windows.sealed.intact, from: b.windows.sealed.fromTs, chunks: b.windows.sealed.chunks }, { sealed: true, from: 1735689600000, chunks: 5 });
      assert.deepStrictEqual(b.windows.unread, { fromTs: 1735689600000, chunks: 5, seenToTs: 1736121600000 }, 'the unread window rides with its start and no end');
      assert.strictEqual(b.windows.hold.chunks, 48);
      assert.strictEqual(b.release, require('../package.json').version);
      assert.deepStrictEqual(b.marks.map((m) => m.key), ['spike'], 'the marks the walk carried ride on the block');
    } finally { f.cleanup(); }
  },

  drawJudgePicksTheRuleFromTheServersListNeverTyped() {
    const ui = src('public/construct.js');
    const draw = ui.slice(ui.indexOf('async function drawJudge(stretch)'), ui.indexOf('async function vFollow('));
    assert.ok(/api\/funnel\/sets/.test(draw), 'the list comes from the server');
    assert.ok(/<select id="vSet"/.test(ui) && !/<input id="vSet"/.test(ui), 'and is a box to pick from, never to type in');
    assert.ok(/vRememberedSet\(sets, stretch\)/.test(draw), 'the choice is remembered the way every page remembers its state, per tab');
    assert.ok(/^async function drawHeld\(\) \{ return drawJudge\('held'\); \}$/m.test(ui) && /^async function drawReserve\(\) \{ return drawJudge\('reserve'\); \}$/m.test(ui), 'the two tabs are one renderer handed the stretch');
    // WHAT EACH BOX LISTS (VERIFY-DESIGN.md Part 9): Held every rule, Reserve only a rule whose layout keeps a reserve and whose newest held set passed, Greenlight the sets a press made
    assert.ok(ui.includes("  const rules = (sets || []).filter((x) => (x.kind || 'funnel') === 'funnel');\n  if (stretch === 'held') return rules;\n  return rules.filter((x) => x.judge && x.judge.keepsReserve && x.judge.held && x.judge.held.stands);"), 'Held lists every rule and Reserve only the rules that stand with a reserve to read');
    assert.ok(ui.includes(".filter((x) => x.kind === 'held' || x.kind === 'reserve');\n  const glChosen = glRememberedSet(glSets);"), 'Greenlight lists held sets and reserve sets, never a rule');
    assert.ok(/list\.length \? list\[0\]\.id : null/.test(ui), 'with nothing remembered it opens on the newest');
  },

  theSurvivorsTableOnVerifyHasNoHeldBackSort() {
    const ui = src('public/construct.js');
    const table = ui.slice(ui.indexOf('function vSurvivorsTableHtml('), ui.indexOf('function vBlockHtml('));
    assert.ok(!/fcSort\(|bSortBtn\(|bRankSortBtn\(|data-sort|onclick/.test(table), 'no sorter on the table: a sort is a look');
    assert.ok(/There is no sort on this table: a sort is a look\./.test(table), 'and it says so');
    for (const word of ['beat its own null set', 'null copies', 'lead', 'trades', 'vs always long $']) {
      assert.ok(table.includes(`>${word}</th>`), `the column is called ${word}, the Funnel's own word`);
    }
    // the money column is named after the stretch, as two whole phrases the word list reads whole on both tabs (3.147.0)
    assert.ok(table.includes(">${stretch === 'reserve' ? '<span>avg reserve $</span>' : '<span>avg held-back $</span>'}</th>"), 'the money column is called avg held-back $ on Held and avg reserve $ on Reserve');
  },

  async noVerdictSentenceNamesASourceFile() {
    const lib = src('lib/funnelverify.js');
    const strings = [...lib.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
    for (const t of strings) assert.ok(!/\blib\/|\btests?\/|\w+\.js\b/.test(t), `a sentence names a source file: ${t}`);
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      const r = await pressed(doc.id);
      assert.ok(!/\blib\/|\.js\b/.test(r.sentence), r.sentence);
      assert.ok(/^PASS: /.test(r.sentence), `this fixture passes: ${r.sentence}`);
      assert.ok(/What a pass buys: this window only\.$/.test(r.sentence));
    } finally { f.cleanup(); }
  },

  // OWNER DECISION 1: each survivor gets its own reading against its own
  // copies at the same bar, beside how many would pass by chance, and it never
  // gates the set.
  eachSurvivorGetsItsOwnVerdictAndItNeverGatesTheSet() {
    const rules = V.declareRules({ kind: 'scrambles', k: 10, barPct: 80 });
    const list = rows(3, 10);
    list[2].avgHold = -1;                              // one survivor loses on the held-back window
    const per = V.perSurvivor(list, rules);
    assert.deepStrictEqual(per.rows.map((r) => r.pass), [true, true, false]);
    assert.strictEqual(per.passing, 2);
    assert.ok(Math.abs(per.byChance - 3 * rules.chance) < 1e-12, 'beside how many would pass by chance');
    assert.ok(/not independent draws/.test(per.notIndependent));
    const heldBack = V.heldBackRead(list, CONTROLS);
    const copies = V.copiesRead(list, rules);
    const sane = { threshold: 50, board: { figures: 10, losing: 0.6 }, survivors: { figures: 30, losing: 0 }, known: true, ok: true };
    const base = { rules, footing: { ok: true, had: 3 }, looks: { unstamped: 3 }, read: heldBack, copies, survivors: per, sanity: sane, lineA: V.lineA(list, rules), lineB: V.lineB(list, 3, rules) };
    const a = V.buildBlock(base);
    const b = V.buildBlock({ ...base, survivors: { ...per, passing: 0, rows: per.rows.map((r) => ({ ...r, pass: false })) } });
    assert.strictEqual(a.verdict.pass, b.verdict.pass, 'the set verdict does not read the survivors\' own verdicts');
    assert.ok(/2 of 3 survivors clear the same bar/.test(a.verdict.sentence), 'but the sentence prints them');
  },

  // OWNER DECISION 6: the two extra lines are built and always printed,
  // information only, never a pass or fail.
  theTwoInformationLinesArePrintedAndNeverPassOrFail() {
    const rules = V.declareRules({ kind: 'scrambles', k: 10, barPct: 80 });
    const list = rows(3, 10);
    const a = V.lineA(list, rules);
    const b = V.lineB(list, 2, rules);
    for (const line of [a, b]) {
      assert.strictEqual(line.information, true);
      assert.ok(!('pass' in line), 'no pass on an information line');
      assert.ok(/never a pass or fail|what shopping alone/.test(line.why));
    }
    assert.strictEqual(b.n, 2);
    assert.strictEqual(b.real, (10 + 9) / 2, 'the best two by test money');
    const sane = { threshold: 50, board: { figures: 10, losing: 0.6 }, survivors: { figures: 30, losing: 0 }, known: true, ok: true };
    const base = { rules, footing: { ok: true, had: 3 }, looks: { unstamped: 3 }, read: V.heldBackRead(list, CONTROLS), copies: V.copiesRead(list, rules), survivors: V.perSurvivor(list, rules), sanity: sane, lineA: a, lineB: b };
    const x = V.buildBlock(base);
    const y = V.buildBlock({ ...base, lineA: { ...a, beats: 0, clears: false }, lineB: { ...b, beats: 0, clears: false } });
    assert.strictEqual(x.verdict.pass, y.verdict.pass, 'the verdict never reads them');
    const ui = src('public/construct.js');
    assert.ok(/Information only, never a pass or fail\./.test(ui), 'and the screen says so beside them');
  },

  // OWNER DECISION 7: a set cut on all units together is refused in words, with
  // what to do instead.
  async aBlendSetIsRefusedInWords() {
    const f = await fixture();
    try {
      const blend = await stages.cutFunnelSet(f.id, { rule: RULE, closing: { key: 'rule' }, unit: 'all' });
      assert.strictEqual(blend.unit, null);
      const dry = await stages.judgeDry(blend.id, 'held');
      assert.ok(/cut on all units together/.test(dry.refused) && /cut the rule on one unit on the Funnel/.test(dry.refused), dry.refused);
      let threw = null;
      try { stages.judgeStart(blend.id, 'held'); } catch (e) { threw = e.message; }
      assert.strictEqual(threw, dry.refused, 'the press refuses in the same words');
    } finally { f.cleanup(); }
  },

  // OWNER DECISION 8: the three dead panels went with the batch, their tests
  // re-aimed and their help entries removed; the sentences worth keeping stayed.
  theThreeDeadPanelsAreGoneAndTheirWordsWorthKeepingStayed() {
    const ui = src('public/construct.js');
    for (const t of ['Tool 1 — this row against its null runs', 'Rotation rounds — a SEPARATE instrument', 'Tool 2 — the board against its dealt-vote null boards', 'Read Tool 1 verdict', 'Fire rotation rounds on this run', 'scramble run']) {
      assert.ok(!ui.includes(t), `still on the page: ${t}`);
    }
    const help = src('public/help-content.js');
    for (const id of ['t1null', 't1run', 't1rounds', 't1fire']) assert.ok(!new RegExp(`\\b${id}:`).test(help), `the help still describes ${id}`);
    for (const id of ['vSet', 'vBarPct', 'vSanityPct', 'vRead']) assert.ok(new RegExp(`\\b${id}: \\{`).test(help), `the help does not describe ${id}`);
    for (const kept of ['sanity:', 'PASS — noise mostly loses, as fees demand.', 'FAIL — NOISE IS PROFITING: the simulation is broken; do not read the tests above.', 'What a pass buys:', 'this window only', 'a floor, never a measure of strength']) {
      assert.ok(ui.includes(kept), `gone from the page: ${kept}`);
    }
    const server = src('server.js');
    assert.ok(server.includes("app.get('/api/funnel/set/:id/judge/:stretch'") && server.includes("app.post('/api/funnel/set/:id/judge/:stretch'") && server.includes("app.get('/api/funnel/set/:id/judge/:stretch/status'"), 'the three doors exist, one for both stretches');
    assert.ok(server.includes('judge: stages.judgeSummaryOf(d, all),'), 'and the set list says what was read from each rule');
  },

  // A SET WITHOUT SCRAMBLED COPIES stamps an INCOMPLETE block that says so,
  // never a pass, and never a refusal: the footing and the held-back read are
  // still worth having on the record.
  async aSetWithoutScrambledCopiesStampsAnIncompleteBlock() {
    const f = await fixture({ copies: 0 });
    try {
      const doc = await cutOn(f);
      assert.strictEqual(doc.check.kind, 'halves');
      const r = await pressed(doc.id);
      const b = blockOf(doc.id);
      assert.strictEqual(b.rules.copies, 0);
      assert.strictEqual(b.copies.incomplete, true);
      assert.strictEqual(b.copies.pass, false);
      assert.strictEqual(b.sanity.known, false);
      assert.strictEqual(r.pass, false);
      assert.ok(/no scrambled copies of the held-back window were kept, so nothing was read against nothing/.test(r.sentence), r.sentence);
      assert.strictEqual(b.read.pass, true, 'the held-back read still stands on its own');
    } finally { f.cleanup(); }
  },

  // THE FIXTURE'S VERDICT, READ END TO END: the numbers a reader would work out
  // by hand from the rows on disk are the numbers on the block.
  async theVerdictOnTheFixtureIsWhatTheRowsSay() {
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      const dry = await stages.judgeDry(doc.id, 'held');
      assert.strictEqual(dry.refused, null, `nothing refuses: ${dry.refused}`);
      assert.deepStrictEqual({ same: dry.footing.same, had: dry.footing.had, gone: dry.footing.gone, keys: dry.footing.keys.ok, sealed: dry.footing.sealed.sealed, marks: dry.footing.marks }, { same: true, had: 2, gone: 0, keys: true, sealed: true, marks: 1 });
      assert.ok(!('read' in dry) && !('copies' in dry), 'the dry read hands back no held-back figure');
      assert.deepStrictEqual({ prices: dry.prices, heldAlone: dry.heldAlone, keeps: dry.reserve.keeps }, { prices: false, heldAlone: null, keeps: true }, 'a plain rule on a layout that keeps a reserve: held reads the records, and is not held alone');
      const r = await pressed(doc.id);
      const b = blockOf(doc.id);
      assert.deepStrictEqual({ stretch: b.stretch, forecasts: b.forecasts, window: b.window, priced: b.priced }, { stretch: 'held', forecasts: 'the stage 3 records as priced', window: null, priced: null }, 'a held read of a plain rule prices nothing');
      // unit 0's two active settings: held-back 5 each; copies 4, 3.9, ... 3.1 -- all beaten
      assert.strictEqual(b.read.real, 5);
      assert.deepStrictEqual({ beats: b.copies.beats, bar: b.copies.bar, pass: b.copies.pass }, { beats: 10, bar: 8, pass: true });
      assert.deepStrictEqual({ buy: b.read.comparisons.beatsBuyHold, short: b.read.comparisons.beatsShortHold, pass: b.read.pass }, { buy: true, short: true, pass: true });
      // the board: 20 winning figures, 30 losing -- noise mostly loses
      assert.deepStrictEqual({ figures: b.sanity.board.figures, losing: b.sanity.board.losing, ok: b.sanity.ok }, { figures: 50, losing: 0.6, ok: true });
      assert.deepStrictEqual({ passing: b.survivors.passing, positive: b.survivors.positive, of: b.survivors.survivors }, { passing: 2, positive: 2, of: 2 });
      assert.strictEqual(b.lineB.n, 2);
      assert.strictEqual(r.pass, true);
      assert.strictEqual(b.looks.unstamped, 3, 'one step, one step back, and the cut view');
      // 3.131.0: Boards keeps the held-back columns behind a tick, and Held says whether it has shown them
      assert.ok(b.looks.what.some((w) => /^Boards (showed|has not shown) the held-back columns of /.test(w)), b.looks.what.join(' | '));
    } finally { f.cleanup(); }
  },

  // WHAT THE INDEPENDENT REVIEW OF 3.86.0 FOUND (3.86.1). A blank box, read as
  // a number, reached the server as 0 and became a bar of ONE copy -- which a
  // forecast-free rule clears 99% of the time. A share below 1 is not an ask.
  aBlankBoxMeansTheSetsOwnBarNeverAOnePercentOne() {
    const check = { kind: 'scrambles', k: 80, barPct: 85 };
    const r0 = V.declareRules(check, { barPct: 0, sanityPct: '' });
    assert.deepStrictEqual({ barPct: r0.barPct, bar: r0.bar, changed: r0.barChanged, sanity: r0.sanityPct }, { barPct: 85, bar: 68, changed: false, sanity: 50 });
    const rNaN = V.declareRules(check, { barPct: 'x', sanityPct: 'y' });
    assert.deepStrictEqual({ barPct: rNaN.barPct, sanity: rNaN.sanityPct }, { barPct: 85, sanity: 50 });
    const r1 = V.declareRules(check, { barPct: 1, sanityPct: 0 });
    assert.deepStrictEqual({ barPct: r1.barPct, bar: r1.bar, changed: r1.barChanged, sanity: r1.sanityPct }, { barPct: 1, bar: 1, changed: true, sanity: 0 }, 'a typed 1 and a typed 0 are asks, and are stamped');
    const ui = src('public/construct.js');
    // one helper for every press on the tab (3.88.0), so the read of the other units sends the same box the same way
    assert.ok(/function vTyped\(id\) \{ const v = \$\(id\)\.value; return v === '' \? '' : Number\(v\); \}/.test(ui), 'the screen sends a blank box blank');
    assert.ok(/barPct: vTyped\('#vBarPct'\), sanityPct: vTyped\('#vSanityPct'\)/.test(ui));
  },

  // The footing replays the rule on the set's OWN copy of the rebuilt numbers.
  // The parent's shared file can lose a column the rule reads to a later pass;
  // a set that keeps its own copy still replays, and says the parent differs.
  async theFootingReplaysOnTheSetsOwnCopyOfTheNumbers() {
    const f = await fixture();
    try {
      const labels = [...new Set(require('../lib/rowstore').readAll(f.id, 'records').map((r) => r.label))];
      // the parent's numbers, written through the one writer (3.223.0): every
      // setting carries 50 on both coins and shapes
      stages.saveFunnelRich(f.id, new Map(labels.map((l) => [l, { label: l, units: f.units.map((u) => ({ ...u, rich: { test: { maxDrawdown: 50 } } })) }])));
      const doc = await cutOn(f, { rule: { allowed: { gate: ['active'] }, floors: { maxDrawdown: { max: 100 } } } });
      assert.strictEqual(doc.counts.survivors, 2);
      assert.deepStrictEqual(setsOf(doc.id), [], 'a new rule has no held set');
      assert.strictEqual(doc.rich[doc.survivors[0].label].maxDrawdown, 50, 'the set keeps its own copy of the number the rule reads');
      fs.rmSync(stages.funnelRichDir(f.id), { recursive: true, force: true });      // the parent's store goes: a re-total, a deletion
      const dry = await stages.judgeDry(doc.id, 'held');
      assert.strictEqual(dry.refused, null, `the set's own copy still replays: ${dry.refused}`);
      assert.deepStrictEqual({ same: dry.footing.same, onParent: dry.footing.sameOnParent, nowOnParent: dry.footing.nowOnParent }, { same: true, onParent: false, nowOnParent: 0 });
      assert.ok(/the parent's shared file gives 0 today/.test(dry.footing.parentFileDiffers), dry.footing.parentFileDiffers);
      const r = await pressed(doc.id);
      assert.strictEqual(r.look, 1, 'and the press stamps on the set\'s own copy');
    } finally { f.cleanup(); }
  },

  aSetWithoutCopiesSaysSanityIsNotKnownOnScreen() {
    const ui = src('public/construct.js');
    const block = ui.slice(ui.indexOf('function vBlockHtml('), ui.indexOf('function vSetPanelHtml('));
    const known = block.indexOf('sanity: ${sn.known ? `');
    const fail = block.indexOf('FAIL — NOISE IS PROFITING');
    const notKnown = block.indexOf('not known</b> - no scrambled figure to read');
    assert.ok(known >= 0 && fail > known && notKnown > fail, 'the loud failure sits inside the known branch, and a set without copies is told not known');
    assert.strictEqual(block.split('NOISE IS PROFITING').length - 1, 1, 'and it is said once, there');
  },

  theSentencePrintsNegativeMoneyTheWayThePageDoes() {
    const rules = V.declareRules({ kind: 'scrambles', k: 10, barPct: 80 });
    const list = rows(2, 10).map((r) => ({ ...r, avgHold: -2 }));
    const b = V.buildBlock({ rules, footing: { ok: true, had: 2 }, looks: { unstamped: 1 }, read: V.heldBackRead(list, CONTROLS), copies: V.copiesRead(list, rules), survivors: V.perSurvivor(list, rules), sanity: V.sanity(list, list, rules), lineA: V.lineA(list, rules), lineB: V.lineB(list, 2, rules) });
    assert.ok(/made -\$2\.00 a setting/.test(b.verdict.sentence), b.verdict.sentence);
    assert.ok(!/\$-/.test(b.verdict.sentence), 'never a sign after the dollar sign');
    assert.strictEqual(b.verdict.pass, false);
  },
  // ---- V6 and V7 (3.88.0): the rule on the other units, and the ride ----

  // THE OTHER UNITS ARE READ ON THE HELD-BACK WINDOW AND APPENDED, NEVER GATED.
  // The fixture's other unit is the same shape with the money halved, so the
  // rule keeps its two `active` settings there, they are positive and beat every
  // copy. Two presses append two readings; a verdict stamped after a reading
  // carries the newest reading's counts and names them, and its PASS is the
  // same as the verdict stamped before any reading existed.
  async theOtherUnitsAreReadOnTheHeldBackWindowAndAppendedNeverGated() {
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      assert.deepStrictEqual(stages.readingsIn(doc, 'held').others, [], 'a new rule starts with no reading of the other units');
      assert.deepStrictEqual(stages.readingsIn(doc, 'held').ride, [], 'and no ride');
      await pressed(doc.id);
      const before = blockOf(doc.id);
      assert.strictEqual(before.others, null, 'nothing read yet, so the block says so');
      assert.ok(/the other units not read when this was stamped/.test(before.verdict.sentence), before.verdict.sentence);
      const got = await othersPressed(doc.id, {});
      assert.deepStrictEqual({ positive: got.positive, of: got.of, clearBar: got.clearBar, keepsNothing: got.keepsNothing, mark: got.mark, look: got.look },
        { positive: 1, of: 1, clearBar: 1, keepsNothing: 0, mark: null, look: 1 });
      const r1 = stages.readingsIn(stages.getSet(doc.id), 'held').others[0];
      assert.strictEqual(r1.units.length, 1, 'the one other unit');
      assert.strictEqual(r1.stretch, 'held', 'the reading says which stretch it read');
      const u = r1.units[0];
      assert.strictEqual(u.unit, f.keys[1]);
      assert.deepStrictEqual({ survivors: u.survivors, of: u.of, copies: u.copies, beats: u.beats, clears: u.clears, keepsNothing: u.keepsNothing }, { survivors: 2, of: 5, copies: 10, beats: 10, clears: true, keepsNothing: false });
      assert.ok(Math.abs(u.real - 2.5) < 1e-9, `the halved held-back money, ${u.real}`);
      assert.strictEqual(u.bar, F.barOf({ k: 10, barPct: 80 }), "the set's own share resolved on that unit's copy count");
      assert.strictEqual(r1.rules.tags.bar, 'DERIVED');
      assert.strictEqual(r1.release, require('../package.json').version);
      // a second press, under a typed bar, is a second reading and the first stays
      await othersPressed(doc.id, { barPct: 50 });
      const list = stages.readingsIn(stages.getSet(doc.id), 'held').others;
      assert.strictEqual(list.length, 2, 'every press appends');
      assert.strictEqual(list[1].id, r1.id, 'and the first reading is still first');
      assert.deepStrictEqual({ pct: list[0].rules.barPct, tag: list[0].rules.tags.bar, look: list[0].look }, { pct: 50, tag: 'GUESSED', look: 2 });
      // the verdict stamped after it carries the newest reading and is not gated by it
      await pressed(doc.id);
      const after = blockOf(doc.id);
      assert.deepStrictEqual({ positive: after.others.positive, of: after.others.of, clearBar: after.others.clearBar, look: after.others.look }, { positive: 1, of: 1, clearBar: 1, look: 2 });
      assert.ok(/1 of 1 other units positive on the held-back window, 1 clear the bar/.test(after.verdict.sentence), after.verdict.sentence);
      assert.ok(/information only/.test(after.verdict.sentence), 'and says it is information');
      assert.strictEqual(after.verdict.pass, before.verdict.pass, 'the reading never moves the verdict');
      // the dry read hands the list back, newest first; and on Reserve the same press refuses in words until the reserve is priced for the other units
      const dry = await stages.judgeDry(doc.id, 'held');
      assert.strictEqual(dry.readings.others.length, 2);
      assert.strictEqual(dry.readings.others[0].look, 2);
      assert.strictEqual(dry.othersRefused, null);
      const dryR = await stages.judgeDry(doc.id, 'reserve');
      assert.deepStrictEqual(dryR.readings.others, [], 'the readings are kept per stretch');
      // 3.148.0: the other units are read off their own reserve boards, a unit not yet priced named in the reading; the dropped settings need this unit's board first
      assert.strictEqual(dryR.othersRefused, null, dryR.othersRefused);
      assert.ok(/reserve board of this unit is not priced yet — press Price the reserve board on Reserve first/.test(dryR.droppedRefused), dryR.droppedRefused);
    } finally { f.cleanup(); }
  },

  // A UNIT WHERE THE RULE KEEPS NOTHING IS NOT IN THE DENOMINATOR, and fewer than
  // half positive is a mark; both pure, worked by hand.
  aUnitWhereTheRuleKeepsNothingIsNotInTheDenominatorAndFewerThanHalfPositiveIsAMark() {
    const rules = V.declareRules({ kind: 'scrambles', k: 10, barPct: 80 });
    const none = V.othersUnitRead([], rules);
    assert.deepStrictEqual({ keepsNothing: none.keepsNothing, positive: none.positive, clears: none.clears, survivors: none.survivors }, { keepsNothing: true, positive: false, clears: false, survivors: 0 });
    // kept rows with no held-back figure keep nothing too
    const blank = V.othersUnitRead([{ label: 'x', avgHold: null, noiseHold: [1, 2, 3] }], rules);
    assert.strictEqual(blank.keepsNothing, true);
    // a unit with fewer copies than the set resolves the bar on its own count
    const few = V.othersUnitRead(rows(2, 5), rules);
    assert.deepStrictEqual({ copies: few.copies, bar: few.bar, positive: few.positive, clears: few.clears }, { copies: 5, bar: F.barOf({ k: 5, barPct: 80 }), positive: true, clears: true });
    const unit = (positive, clears, keepsNothing = false) => ({ positive, clears, keepsNothing });
    const s1 = V.othersSummary([unit(true, true), unit(false, false), unit(false, false), unit(false, false, true)]);
    assert.deepStrictEqual(s1, { positive: 1, of: 3, clearBar: 1, keepsNothing: 1, notPriced: 0, mark: 'fewer than half of the 3 other units are positive on the held-back window' });
    const s2 = V.othersSummary([unit(true, true), unit(true, false), unit(false, false)]);
    assert.deepStrictEqual({ positive: s2.positive, of: s2.of, clearBar: s2.clearBar, mark: s2.mark }, { positive: 2, of: 3, clearBar: 1, mark: null });
    // exactly half is not fewer than half
    const s3 = V.othersSummary([unit(true, true), unit(false, false)]);
    assert.strictEqual(s3.mark, null);
    // nothing usable: no mark, and the counts say why
    const s4 = V.othersSummary([unit(false, false, true)]);
    assert.deepStrictEqual(s4, { positive: 0, of: 0, clearBar: 0, keepsNothing: 1, notPriced: 0, mark: null });
    // a unit not yet priced on the reserve (3.148.0) is counted apart, never as keeping nothing, and never in the denominator
    const s5 = V.othersSummary([unit(true, true), { positive: false, clears: false, keepsNothing: true, notPriced: true }], 'reserve');
    assert.deepStrictEqual(s5, { positive: 1, of: 1, clearBar: 1, keepsNothing: 0, notPriced: 1, mark: null });
  },

  // THE SAME BOARDS, ONE READING AT A TIME. The Funnel's read of the other units
  // and Verify's read of them walk the same boards; each refuses while the other
  // is going, in words that name it, and the verdict press waits for the reading.
  async theOtherUnitsPressRefusesWhileTheFunnelReadsThemAndTheFunnelRefusesWhileTheyAreReadOnVerify() {
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      // the Funnel's read first: it yields on its first board, so it is still going here
      stages.funnelAcrossStart(f.id, { rule: RULE, unit: f.keys[0], barPct: 80 });
      let threw = null;
      try { stages.funnelOthersStart(doc.id, {}); } catch (e) { threw = e.message; }
      assert.ok(threw && /the Funnel is reading the other units/.test(threw), threw);
      const dry = await stages.judgeDry(doc.id, 'held');
      assert.ok(/the Funnel is reading the other units/.test(dry.othersRefused), dry.othersRefused);
      await settle(() => stages.funnelAcrossStatus(f.id));
      // then Held's read: the Funnel's refuses, and so does the verdict press
      stages.funnelOthersStart(doc.id, {});
      threw = null;
      try { stages.funnelAcrossStart(f.id, { rule: { allowed: { gate: ['directional'] } }, unit: f.keys[0], barPct: 80 }); } catch (e) { threw = e.message; }
      assert.ok(threw && /are being read on Held/.test(threw), threw);
      threw = null;
      try { stages.judgeStart(doc.id, 'held', {}); } catch (e) { threw = e.message; }
      assert.ok(threw && /are being read on Held/.test(threw), threw);
      threw = null;
      try { stages.funnelRideStart(doc.id, {}); } catch (e) { threw = e.message; }
      assert.ok(threw && /are being read on Held/.test(threw), threw);
      // pressing again for the same set while it reads is the same reading, not a second
      const again = stages.funnelOthersStart(doc.id, {});
      assert.strictEqual(again.running, true);
      await settle(() => stages.funnelOthersStatus(doc.id));
      assert.strictEqual(stages.readingsIn(stages.getSet(doc.id), 'held').others.length, 1, 'one reading, not two');
    } finally { f.cleanup(); }
  },

  // THE RIDE KEEPS THE HELD-BACK HALF BESIDE THE TEST HALF, for the set's own
  // unit only, with the release. The pricing pass itself is not run here (it
  // needs a stage 2 record store and the worker pool, as the Funnel's own press
  // does); what is tested is the taking of the answer, worked by hand, and the
  // press's shape read from the source: the ride prices ONE unit, and never
  // writes the parent's shared file.
  theRideKeepsTheHeldBackHalfBesideTheTestHalfForThisUnitOnly() {
    assert.deepStrictEqual(V.RIDE_FIELDS, stages.RICH_FIELDS, 'the ride keeps exactly the fields the rebuild produces');
    const keyOf = stages.unitKeyOf;
    const mk = (u, testR, holdR) => ({ ...u, pnl: 10, trades: 6, holdout: { pnl: -3, trades: 4, stops: 1 }, rich: { test: testR, hold: holdR } });
    const A = { trade: 'AAA', ctx1: null, ctx2: null, geometry: 'daily-1d' };
    const B = { trade: 'BBB', ctx1: null, ctx2: null, geometry: 'daily-1d' };
    const testR = { maxDrawdown: -5, worstTrade: -2, bestTrade: 4, wins: 3, stops: 1, grossPerTrade: 1.5, pnlThirds: [3, 3, 4] };
    const holdR = { maxDrawdown: -7, worstTrade: -4, bestTrade: 2, wins: 1, stops: 2, grossPerTrade: -0.5, pnlThirds: [-1, -1, -1] };
    const perSetting = new Map([
      ['s0', { label: 's0', units: [mk(B, { ...testR, maxDrawdown: -99 }, { ...holdR, maxDrawdown: -99 }), mk(A, testR, holdR)] }],
      ['s1', { label: 's1', units: [mk(B, testR, holdR)] }],
    ]);
    const ride = V.rideOf(perSetting, { unitKey: keyOf(A), keyOf, labels: ['s0', 's1'] });
    assert.deepStrictEqual(ride.missing, ['s1'], 'a survivor the pass did not price on this unit is named, never invented');
    assert.strictEqual(ride.rows.length, 1);
    const r = ride.rows[0];
    assert.strictEqual(r.label, 's0');
    assert.deepStrictEqual(r.read, { money: -3, trades: 4, ...holdR }, "the stretch's half is the worker's held-back half and the held-back money");
    assert.deepStrictEqual(r.test, { money: 10, trades: 6, ...testR }, 'beside the test half');
    // a unit with no held-back half keeps the shape with nothing in it
    const bare = V.rideOf(new Map([['s0', { label: 's0', units: [{ ...A, pnl: 1, trades: 1, holdout: null, rich: { test: testR, hold: null } }] }]]), { unitKey: keyOf(A), keyOf, labels: ['s0'] });
    assert.deepStrictEqual(bare.rows[0].read, { money: null, trades: null, maxDrawdown: null, worstTrade: null, bestTrade: null, wins: null, stops: null, grossPerTrade: null, pnlThirds: null });
    // the press, read from the source
    const lib = src('lib/stages.js');
    const start = lib.slice(lib.indexOf('function funnelRideStart(id, asked = {}) {'), lib.indexOf('function funnelRideStatus(id) {'));
    assert.ok(/rebuildRichFor\(parent, labels, \{ unit: doc\.unit,/.test(start), 'the ride prices this unit only');
    assert.ok(!/saveFunnelRich\(/.test(start), "the ride never writes the parent's shared file");
    assert.ok(!/fresh\.rich\s*=/.test(start), "and never the set's copy of the test numbers");
    assert.ok(/mine\.ride = \[rec, \.\.\.had\];/.test(start), 'every press appends, under the stretch it read');
    assert.ok(/release: ENGINE_VERSION/.test(start), 'stamped with the release that computed it');
    const rebuild = lib.slice(lib.indexOf('async function rebuildRichFor('), lib.indexOf('function s3Payload('));
    assert.ok(/if \(opts\.unit\) \{[\s\S]{0,400}unitKeyOf\(records\[i\]\) === String\(opts\.unit\)/.test(rebuild), 'the rebuild keeps only the unit asked for');
  },

  // THE RIDE IS A LOOK, AND THE NEXT VERDICT COUNTS IT. A ride written on the
  // set is counted on the looks line of the dry read and of every block stamped
  // after it; and a set with no survivors, or cut on all units together, is
  // refused in words before anything prices.
  async theRideIsALookAndTheNextVerdictCountsItAndTheRefusalsAreInWords() {
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      const dry0 = await stages.judgeDry(doc.id, 'held');
      assert.strictEqual(dry0.rideRefused, null, dry0.rideRefused);
      assert.strictEqual(dry0.looks.rides, 0);
      // a ride, as the press would write it, placed on the rule under the held stretch
      rewrite(doc.id, (on) => { on.readings = { held: { others: [], dropped: [], ride: [{ id: `${doc.id}-held-r1`, at: new Date().toISOString(), release: '3.88.0', look: 1, stretch: 'held', unit: doc.unit, settings: 2, missing: [], failures: [], fields: V.RIDE_FIELDS, rows: [] }] } }; });
      const dry = await stages.judgeDry(doc.id, 'held');
      assert.strictEqual(dry.readings.ride.length, 1);
      assert.strictEqual(dry.looks.rides, 1, 'the ride is a look');
      assert.ok(dry.looks.what.some((w) => /held-back ride was worked out 1 time\(s\)/.test(w)), dry.looks.what.join(' | '));
      await pressed(doc.id);
      const b = blockOf(doc.id);
      assert.strictEqual(b.looks.rides, 1, 'and the block stamped after it counts it');
      // a ride on the reserve window needs the rule to stand on the held-back window first, like the press
      const dryR = await stages.judgeDry(doc.id, 'reserve');
      assert.strictEqual(dryR.readings.ride.length, 0, 'the held ride is not a reserve ride');
      // with the standing, a plain rule's reserve ride still waits for the unit's reserve board (3.148.0)
      assert.strictEqual(dryR.rideRefused, b.verdict.pass ? stages.reserveBoardOf(stages.getSet(doc.id)).why : stages.NO_HELD_PASS);
      // refusals in words
      const blend = await stages.cutFunnelSet(f.id, { rule: RULE, closing: { key: 'rule' }, unit: 'all' });
      let threw = null;
      try { stages.funnelRideStart(blend.id, {}); } catch (e) { threw = e.message; }
      assert.ok(/cut on all units together/.test(threw), threw);
      const dryB = await stages.judgeDry(blend.id, 'held');
      assert.strictEqual(dryB.rideRefused, threw, 'the dry read says the same');
      assert.strictEqual(dryB.othersRefused, threw);
      const empty = await stages.cutFunnelSet(f.id, { rule: { allowed: { gate: ['nothing-of-the-kind'] } }, closing: { key: 'rule' }, unit: f.keys[0] });
      threw = null;
      try { stages.funnelRideStart(empty.id, {}); } catch (e) { threw = e.message; }
      assert.ok(/wrote down no settings/.test(threw), threw);
    } finally { f.cleanup(); }
  },

  // THE SCREEN: the two presses are drawn by top-level helpers the word list
  // can walk, the ride's table has no sort, and both routes are served.
  theTwoNewPressesAreOnHeldAndReserveWithTheirRoutes() {
    const ui = src('public/construct.js');
    for (const fn of ['vOthersHtml', 'vRideHtml', 'vOthersFollow', 'vRideFollow']) assert.ok(new RegExp(`^(async )?function ${fn}\\(`, 'm').test(ui), `${fn} must be a top-level helper`);
    // RE-AIMED 3.100.0: the dropped-settings panel (V8) was added between them.
    // The property is unchanged -- every panel is drawn under the sets -- so
    // the check is now per panel rather than on the two being adjacent; and
    // each is handed the stretch (3.147.0), so one helper draws it on both tabs.
    for (const fn of ['vOthersHtml', 'vDroppedHtml', 'vRideHtml']) {
      assert.ok(new RegExp(`\\$\\{${fn}\\(d, stretch\\)\\}`).test(ui), `${fn} is drawn under the sets, on both tabs`);
    }
    assert.ok(/id="vOthers"/.test(ui) && /id="vRide"/.test(ui), 'the two presses');
    assert.ok(/api\/funnel\/set\/\$\{encodeURIComponent\(chosen\)\}\/others`, \{ stretch, barPct: vTyped\('#vBarPct'\) \}/.test(ui), 'the read of the other units is sent under the same bar box as the verdict, on the stretch shown');
    assert.ok(/api\/funnel\/set\/\$\{encodeURIComponent\(id\)\}\/others\/status/.test(ui) && /api\/funnel\/set\/\$\{encodeURIComponent\(id\)\}\/ride\/status/.test(ui), 'both are polled');
    const ride = ui.slice(ui.indexOf('function vRideHtml('), ui.indexOf('async function drawHeld('));
    assert.ok(!/data-sort|bRankSortBtn|sortBtn/.test(ride), "the ride's table has no sort: a sort is a look");
    assert.ok(/The other units:/.test(ui), 'the block prints the other units when read');
    const srv = src('server.js');
    for (const r of ['/api/funnel/set/:id/others', '/api/funnel/set/:id/others/status', '/api/funnel/set/:id/ride', '/api/funnel/set/:id/ride/status']) assert.ok(srv.includes(`'${r}'`), `${r} is served`);
    assert.ok(/funnelOthersStart\(req\.params\.id, req\.body \|\| \{\}\)/.test(srv), 'the read takes the typed bar');
  },
  // ---- the press on Reserve (3.89.0 as the reserve grade; one door with Held since 3.147.0): the refusals, in words ----
  // The reserve is read only for a rule that stands on the held-back window:
  // its NEWEST held set passed under this release line. A FAIL, a PASS under
  // another first digit, a seal not intact and a set cut on all units together
  // are each refused in words, and the dry read says the same words the press
  // throws. The pricing itself is tests/test-unreadgrade.js's, on the
  // fabricated coins.
  async theReservePressRefusesInWordsBeforeAnythingPrices() {
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      assert.deepStrictEqual(setsOf(doc.id, 'reserve'), [], 'a new rule has no reserve set');
      // no held set yet: refused, and the dry read agrees
      let threw = null;
      try { stages.judgeStart(doc.id, 'reserve', {}); } catch (e) { threw = e.message; }
      assert.strictEqual(threw, stages.NO_HELD_PASS);
      assert.ok(/read the rule on Held first/.test(threw), 'and it says what to do');
      let dry = await stages.judgeDry(doc.id, 'reserve');
      assert.deepStrictEqual({ refused: dry.refused, standsOn: dry.standsOn, sets: dry.sets.length, keeps: dry.reserve.keeps, intact: dry.reserve.intact, prices: dry.prices }, { refused: stages.NO_HELD_PASS, standsOn: null, sets: 0, keeps: true, intact: true, prices: false });
      // a held set that FAILED is no standing
      await pressed(doc.id, { barPct: 100 });
      const held = setsOf(doc.id)[0];
      rewrite(held.id, (on) => { on.block.verdict.pass = false; });
      assert.strictEqual(stages.heldStandingOf(stages.getSet(doc.id)), null, 'a FAIL is no standing');
      // a PASS under another first digit is no standing; under this one it is
      rewrite(held.id, (on) => { on.block.verdict.pass = true; on.block.release = '2.99.0'; });
      assert.strictEqual(stages.heldStandingOf(stages.getSet(doc.id)), null, 'a PASS under another first digit is no standing');
      rewrite(held.id, (on) => { on.block.release = require('../package.json').version; });
      const standing = stages.heldStandingOf(stages.getSet(doc.id));
      assert.deepStrictEqual({ id: standing.id, name: standing.name, number: standing.number }, { id: held.id, name: held.name, number: 1 });
      dry = await stages.judgeDry(doc.id, 'reserve');
      // 3.148.0: with the standing, a plain rule waits for the unit's reserve board, and says which press prices it
      assert.strictEqual(dry.refused, stages.reserveBoardOf(stages.getSet(doc.id)).why, dry.refused);
      assert.ok(/reserve board of this unit is not priced yet — press Price the reserve board on Reserve first/.test(dry.refused), dry.refused);
      assert.deepStrictEqual({ priced: dry.board.priced, press: dry.board.press, boardRefused: dry.boardRefused, prices: dry.prices }, { priced: false, press: stages.BOARD_PRESS, boardRefused: null, prices: false });
      assert.deepStrictEqual({ id: dry.standsOn.id, name: dry.standsOn.name }, { id: held.id, name: held.name }, 'the dry read names the held set a reserve set would stand on');
      // the board written by hand beside the stage 3 set: the press reads it and prices nothing; sanity is over the whole board
      const K = 10;
      stages.writeReserveBoard(f.id, doc.unit, handBoard(K, 1));
      dry = await stages.judgeDry(doc.id, 'reserve');
      assert.deepStrictEqual({ refused: dry.refused, priced: dry.board.priced, pricings: dry.board.pricings, rows: dry.board.pricedRows, settings: dry.board.settings, boardLooks: dry.looks.boardPricings }, { refused: null, priced: true, pricings: 1, rows: 5, settings: 5, boardLooks: 1 });
      const started = stages.judgeStart(doc.id, 'reserve', {});
      assert.strictEqual(started.of, 0, 'a read off the board counts no pricing');
      for (let i = 0; i < 400 && !stages.judgeStatus(doc.id, 'reserve').result && !stages.judgeStatus(doc.id, 'reserve').error; i++) await new Promise((resolve) => { setTimeout(resolve, 25); });
      assert.strictEqual(stages.judgeStatus(doc.id, 'reserve').error, null);
      const rb = blockOf(doc.id, 0, 'reserve');
      assert.deepStrictEqual({ pricing: rb.board.pricing, real: rb.read.real, money: rb.priced.map((x) => x.money), over: rb.sanity.over, figures: rb.sanity.board.figures, copies: rb.copies.copies, chunks: rb.window.chunks, forecasts: rb.forecasts },
        { pricing: 1, real: 7, money: [7, 7], over: 'board', figures: 5 * K, copies: K, chunks: 5, forecasts: "the members' saved models, read off the reserve board of this unit" });
      assert.ok(/read off the reserve board of this unit, priced \d{4}-\d{2}-\d{2} \(pricing 1, 5 of 5 settings\)/.test(rb.verdict.sentence) && /this is reserve set 1 of the rule/.test(rb.verdict.sentence), rb.verdict.sentence);
      // H2.1: a second rule cut on the same unit reads the same board without pricing
      const doc2 = await cutOn(f, { name: `second rule ${f.stamp}` });
      await pressed(doc2.id, { barPct: 100 });
      rewrite(setsOf(doc2.id)[0].id, (on) => { on.block.verdict.pass = true; on.block.release = require('../package.json').version; });
      assert.strictEqual(stages.judgeStart(doc2.id, 'reserve', {}).of, 0);
      for (let i = 0; i < 400 && !stages.judgeStatus(doc2.id, 'reserve').result && !stages.judgeStatus(doc2.id, 'reserve').error; i++) await new Promise((resolve) => { setTimeout(resolve, 25); });
      assert.deepStrictEqual({ pricing: blockOf(doc2.id, 0, 'reserve').board.pricing, boards: fs.readdirSync(SETS_DIR).filter((x) => x.startsWith(`${f.id}-reserve-`)).length }, { pricing: 1, boards: 1 }, 'one board per unit, read by both rules');
      // a second pricing stamps a further pricing on the same file and keeps the first stamp
      stages.writeReserveBoard(f.id, doc.unit, handBoard(K, 1));
      assert.strictEqual(stages.readReserveBoard(f.id, doc.unit).pricings.length, 2);
      // H2.4: the dropped settings and the ride off the board; the other unit not yet priced is named, then read once its board lands
      const dropped = await stages.funnelDroppedStart(doc.id, { stretch: 'reserve' });
      assert.deepStrictEqual({ kept: dropped.kept.of, dropped: dropped.dropped.of, keptMean: dropped.kept.mean, droppedMean: dropped.dropped.mean, pricing: dropped.board.pricing }, { kept: 2, dropped: 3, keptMean: 7, droppedMean: -3, pricing: 2 });
      stages.funnelRideStart(doc.id, { stretch: 'reserve' });
      for (let i = 0; i < 400 && !stages.funnelRideStatus(doc.id).result && !stages.funnelRideStatus(doc.id).error; i++) await new Promise((resolve) => { setTimeout(resolve, 25); });
      const ride = stages.readingsIn(stages.getSet(doc.id), 'reserve').ride[0];
      assert.deepStrictEqual({ money: ride.rows.map((x) => x.read.money), drawdown: ride.rows[0].read.maxDrawdown, test: ride.rows[0].test.money, pricing: ride.board.pricing }, { money: [7, 7], drawdown: -1, test: 10, pricing: 2 });
      await othersPressed(doc.id, { stretch: 'reserve' });
      const o1 = stages.readingsIn(stages.getSet(doc.id), 'reserve').others[0];
      assert.deepStrictEqual({ of: o1.of, notPriced: o1.notPriced, named: o1.units[0].notPriced, why: o1.units[0].why }, { of: 0, notPriced: 1, named: true, why: `not priced on the reserve window yet — ${stages.BOARD_PRESS} prices it` });
      stages.writeReserveBoard(f.id, f.keys[1], handBoard(K, 0.5));
      await othersPressed(doc.id, { stretch: 'reserve' });
      const o2 = stages.readingsIn(stages.getSet(doc.id), 'reserve').others[0];
      assert.deepStrictEqual({ of: o2.of, positive: o2.positive, notPriced: o2.notPriced, real: o2.units[0].real }, { of: 1, positive: 1, notPriced: 0, real: 3.5 });
      // an older PASS behind a newer FAIL is a rule that was read again and did not stand
      await pressed(doc.id, { barPct: 100 });
      const newer = setsOf(doc.id)[0];
      rewrite(newer.id, (on) => { on.block.verdict.pass = false; });
      assert.strictEqual(stages.heldStandingOf(stages.getSet(doc.id)), null, 'the newest held set decides');
      rewrite(newer.id, (on) => { on.block.verdict.pass = true; });
      // the seal not intact: refused in words that name it
      rewrite(doc.id, (on) => { on.sealed = { units: [], why: 'a unit has no reserved window' }; });
      dry = await stages.judgeDry(doc.id, 'reserve');
      assert.ok(/sealed window is not intact/.test(dry.refused), dry.refused);
      threw = null;
      try { stages.judgeStart(doc.id, 'reserve', {}); } catch (e) { threw = e.message; }
      assert.strictEqual(threw, dry.refused);
      // a blend set: refused in the same words as the verdict
      const blend = await stages.cutFunnelSet(f.id, { rule: RULE, closing: { key: 'rule' }, unit: 'all' });
      threw = null;
      try { stages.judgeStart(blend.id, 'reserve', {}); } catch (e) { threw = e.message; }
      assert.ok(/cut on all units together/.test(threw), threw);
    } finally { f.cleanup(); }
  },
  // ---- the greenlight source of a Stage 4 record set (3.90.0) ----
  // Read off the set and its parents, never re-typed: refused without a verdict
  // that stood; with one, the unit, the survivors with their depth, the pick by
  // depth (every survivor at the middle under a rule of word dials, so the
  // first in the set's own order) or by name, an unknown name refused; and the
  // dry read says in words why this fixture's coin-on-its-own could not be
  // greenlighted.
  async theStage4GreenlightSourceIsReadOffTheSetAndRefusesWithoutAVerdictThatStood() {
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      // A RULE IS NEVER GREENLIGHTED (3.147.0): the set a press made is
      let threw = null;
      try { await stages.stage4GreenlightSource(doc.id, {}); } catch (e) { threw = e.message; }
      assert.ok(/a greenlight comes from a held set or a reserve set/.test(threw), threw);
      let dry = await stages.stage4GreenlightDry(doc.id);
      assert.deepStrictEqual({ gate: dry.gate, refused: dry.refused, survivors: dry.survivors.length }, { gate: null, refused: threw, survivors: 0 });
      // a held set that passed on a layout that keeps a reserve is read on Reserve, not greenlighted
      await pressed(doc.id, { barPct: 100 });
      const held = setsOf(doc.id)[0];
      rewrite(held.id, (on) => { on.block.verdict.pass = true; });
      threw = null;
      try { await stages.stage4GreenlightSource(held.id, {}); } catch (e) { threw = e.message; }
      assert.ok(/layout keeps a reserve — read it on Reserve/.test(threw), threw);
      assert.strictEqual(stages.gateOfSet(stages.getSet(held.id)), null);
      // held alone: the same set on a layout that keeps no reserve stands, and the source is read off it
      rewrite(f.id, (on) => { on.params.windowLayout = 'split70'; });
      const gate = stages.gateOfSet(stages.getSet(held.id));
      assert.deepStrictEqual({ id: gate.id, set: gate.set, kind: gate.kind, look: gate.look }, { id: held.block.id, set: held.id, kind: 'held', look: 1 });
      const src = await stages.stage4GreenlightSource(held.id, {});
      assert.deepStrictEqual({ set: src.set.id, kind: src.set.kind, from: src.set.from.id, stage: src.set.stage, gate: src.gate.id, parent: src.set.parent.id, stage2: src.set.stage2.id }, { set: held.id, kind: 'held', from: doc.id, stage: 4, gate: held.block.id, parent: f.id, stage2: f.parentId });
      // RE-AIMED 3.188.0: the unit now also says what it took from a walk set,
    // because the live path rebuilds the whole committee from the configuration
    // alone and cannot train such a member without its look-back and its band.
    // Empty is a unit that took nothing, which is what this fixture is.
    // 3.203.0: and which extras belong together, empty on a unit whose extras stand alone
    assert.deepStrictEqual(src.unit, { trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-1d', extras: [], plateaus: [] });
      assert.strictEqual(src.survivors.length, 2, 'every survivor, with its depth');
      assert.ok(src.survivors.every((x) => x.worst === 0), 'a rule of word dials puts every survivor at the middle');
      assert.deepStrictEqual({ by: src.pick.by, index: src.pick.index, label: src.pick.label, of: src.pick.of }, { by: 'depth', index: 0, label: src.survivors[0].label, of: 2 }, 'equal in depth: the first in the set\'s own order');
      assert.strictEqual(src.survivor.label, src.pick.label);
      assert.deepStrictEqual({ entry: src.survivor.entry, gate: src.survivor.gate, tHours: src.survivor.tHours, rule: src.survivor.agreeRule, pct: src.survivor.agreePct }, { entry: 'market', gate: 'active', tHours: 41, rule: 'share', pct: null });
      assert.strictEqual(src.survivor.bandPct, 2, 'an auto band resolves to the band the unit was priced at');
      assert.strictEqual(src.fee, 0.00125);
      // no stop or sizing on record on this fixture, so the tuned figures ride along as none (3.153.0)
      assert.deepStrictEqual(src.readings.held, { money: held.block.survivors.rows[0].money, trades: held.block.survivors.rows[0].trades, tuned: null }, 'the survivor\'s own held-back reading rides along, off the held set');
      assert.strictEqual(src.readings.reserve, null, 'no reserve set, no reserve reading');
      assert.deepStrictEqual(src.training.windowLayout, 'reserve61');
      // a named pick, and an unknown name refused
      const named = await stages.stage4GreenlightSource(held.id, { pick: src.survivors[1].label });
      assert.deepStrictEqual({ by: named.pick.by, index: named.pick.index, label: named.pick.label }, { by: 'named', index: 1, label: src.survivors[1].label });
      threw = null;
      try { await stages.stage4GreenlightSource(held.id, { pick: 'no such setting' }); } catch (e) { threw = e.message; }
      assert.ok(/is not one of this set's 2 survivors/.test(threw), threw);
      // the dry read: this fixture's coin is read on its own, and the words say so
      dry = await stages.stage4GreenlightDry(held.id);
      assert.ok(/a coin read on its own/.test(dry.refused), dry.refused);
      assert.deepStrictEqual({ size: dry.unitSize, depth: dry.depthPick.label, survivors: dry.survivors.length, kind: dry.kind, heldAlone: dry.heldAlone }, { size: 1, depth: src.pick.label, survivors: 2, kind: 'held', heldAlone: stages.HELD_ALONE });
      // a FAIL is refused in words, and so is a PASS under another release line
      rewrite(held.id, (on) => { on.block.verdict.pass = false; });
      assert.ok(/verdict is FAIL/.test(stages.gateRefusalOf(stages.getSet(held.id))));
      rewrite(held.id, (on) => { on.block.verdict.pass = true; on.block.release = '2.99.0'; });
      assert.ok(/another release line/.test(stages.gateRefusalOf(stages.getSet(held.id))));
      // and the blend set is refused in the same words as the verdict
      const blend = await stages.cutFunnelSet(f.id, { rule: RULE, closing: { key: 'rule' }, unit: 'all' });
      threw = null;
      try { await stages.stage4GreenlightSource(blend.id, {}); } catch (e) { threw = e.message; }
      assert.ok(/cut on all units together/.test(threw), threw);
    } finally { f.cleanup(); }
  },

  // ALL FOUR GATE (3.100.0, owner order 2026-09-09). Until then the two
  // one-trade comparisons decided pass or fail and the two every-period ones
  // were printed and ignored. Neither pair is harder in general -- the one-trade
  // pair carries almost no fee load, so it is the harder bar over a trending
  // window and the easier one over a chopping window -- so gating on one pair
  // let the difficulty of the bar move with the market. The rule must now beat
  // the BEST of the four.
  //
  // Watched failing: put GATED back to the two one-trade keys and
  // theRuleMustBeatTheBestOfTheFourNotOnePairOfThem fails on its second case,
  // where the rule beats both one-trade comparisons and loses to being short
  // every period.
  theRuleMustBeatTheBestOfTheFourNotOnePairOfThem() {
    const rows = [{ si: 0, label: 'one', tHours: 65, weekdaysOnly: false, avgHold: 10, avgTrades: 5, avgVsLong: 1 }];
    const four = (al, as, bh, sh) => ({
      known: true, keys: ['all|65'], of: 1, missing: 0,
      alwaysLong: { lo: al, hi: al }, alwaysShort: { lo: as, hi: as },
      buyHold: { lo: bh, hi: bh }, shortHold: { lo: sh, hi: sh },
      byKey: { 'all|65': { alwaysLong: al, alwaysShort: as, buyHold: bh, shortHold: sh } },
    });
    // beats all four: the best of them is buying and going away at 4
    const win = V.heldBackRead(rows, four(1, 2, 4, 3));
    assert.deepStrictEqual({ key: win.comparisons.best.key, hi: win.comparisons.best.hi }, { key: 'buyHold', hi: 4 });
    assert.strictEqual(win.comparisons.beatsBest, true);
    assert.strictEqual(win.pass, true, 'beating every one of the four stands');
    // THE CASE THE OLD GATE MISSED: both one-trade comparisons beaten, and
    // being short every period made more than the rule did. On one hold
    // length the survivor's own four ARE the set's four, so this reads the
    // same under the own-hold gate (3.146.0): all four, not one pair.
    const miss = V.heldBackRead(rows, four(1, 20, 4, 3));
    assert.strictEqual(miss.comparisons.beatsBuyHold, true, 'the old gate would have passed this');
    assert.strictEqual(miss.comparisons.beatsShortHold, true, 'and this');
    assert.strictEqual(miss.comparisons.beatsAlwaysShort, false, 'but being short every period made more');
    assert.strictEqual(miss.comparisons.best.key, 'alwaysShort');
    assert.deepStrictEqual({ pass: miss.pass, clearing: miss.own.clearing, beatsAlwaysShort: miss.own.rows[0].beats.alwaysShort }, { pass: false, clearing: 0, beatsAlwaysShort: false }, 'every one of the four decides, at the survivor\'s own hold length');
  },

  // EACH SURVIVOR AT ITS OWN HOLD LENGTH, AND THE BAR SHARE OF THEM IS THE
  // GATE (3.146.0, owner order 2026-09-15: "apples to apples instead of
  // letting 'against nothing' rule actually be 'against something', namely an
  // hindsight selection of the best of its set"; VERIFY-DESIGN.md Part 8).
  // The owner's 98-setting rule in miniature: being long every period is -$7
  // at a 41-hour hold and $340 at 161 hours, because a decision every day
  // with a 161-hour hold keeps nearly seven positions open at once. Held to
  // the $340 figure, an average of mostly short holds read FAIL while every
  // survivor beat the comparison priced at its own hold length.
  //
  // Watched failing: read every survivor against the worst-hold figures and
  // the two 41-hour survivors stop clearing; gate on at least one survivor
  // instead of the bar share and the three-of-four table passes.
  eachSurvivorIsReadAgainstTheFourAtItsOwnHoldLengthAndTheBarShareOfThemIsTheGate() {
    const rules = V.declareRules({ kind: 'scrambles', k: 80, barPct: 80 });
    const byKey = {
      'all|41': { alwaysLong: -7, alwaysShort: -162, buyHold: 51, shortHold: -51 },
      'all|161': { alwaysLong: 340, alwaysShort: -510, buyHold: 72, shortHold: -73 },
    };
    const controls = { known: true, keys: ['all|41', 'all|161'], of: 2, missing: 0, alwaysLong: { lo: -7, hi: 340 }, alwaysShort: { lo: -510, hi: -162 }, buyHold: { lo: 51, hi: 72 }, shortHold: { lo: -73, hi: -51 }, byKey };
    const row = (si, label, t, held) => ({ si, label, tHours: t, weekdaysOnly: false, avgHold: held, avgTrades: 200, avgVsLong: held - byKey[`all|${t}`].alwaysLong });
    // every survivor ahead of its own four: the old gate said FAIL (average 220 against the hindsight 340), this one PASS
    const all = V.heldBackRead([row(0, 'a', 41, 180), row(1, 'b', 41, 120), row(2, 'c', 161, 384), row(3, 'd', 161, 350)], controls, rules);
    assert.deepStrictEqual({ key: all.comparisons.best.key, hi: all.comparisons.best.hi, beatsBest: all.comparisons.beatsBest, real: all.real }, { key: 'alwaysLong', hi: 340, beatsBest: false, real: 258.5 }, 'the hindsight reading is still printed: the average behind the best of the four at the worst hold length');
    assert.deepStrictEqual({ pass: all.pass, clearing: all.own.clearing, bar: all.own.bar, barPct: all.own.barPct, keys: all.own.holdLengths, each: all.own.beatingEach }, { pass: true, clearing: 4, bar: 4, barPct: 80, keys: ['all|161', 'all|41'], each: { alwaysLong: 4, alwaysShort: 4, buyHold: 4, shortHold: 4 } }, 'four of four clear at their own hold length, and that is the gate');
    assert.deepStrictEqual(all.own.rows.map((r) => [r.label, r.key, r.clears]), [['a', 'all|41', true], ['b', 'all|41', true], ['c', 'all|161', true], ['d', 'all|161', true]]);
    // one 161-hour survivor behind its OWN being long every period: it does not clear, three of four is under the bar of four, FAIL
    const three = V.heldBackRead([row(0, 'a', 41, 180), row(1, 'b', 41, 120), row(2, 'c', 161, 384), row(3, 'd', 161, 300)], controls, rules);
    assert.deepStrictEqual({ pass: three.pass, clearing: three.own.clearing, bar: three.own.bar, d: three.own.rows[3].clears, dBeatsLong: three.own.rows[3].beats.alwaysLong }, { pass: false, clearing: 3, bar: 4, d: false, dBeatsLong: false }, 'a survivor is held to its own hold length, not to a shorter one');
    // the bar is a share: at 50% three of four clears
    const half = V.heldBackRead([row(0, 'a', 41, 180), row(1, 'b', 41, 120), row(2, 'c', 161, 384), row(3, 'd', 161, 300)], controls, V.declareRules({ kind: 'scrambles', k: 80, barPct: 50 }));
    assert.deepStrictEqual({ pass: half.pass, bar: half.own.bar }, { pass: true, bar: 2 });
    // a survivor whose hold length has no figure is counted, and never passes
    const gap = V.heldBackRead([row(0, 'a', 41, 180), { si: 1, label: 'e', tHours: 89, weekdaysOnly: false, avgHold: 500, avgTrades: 200, avgVsLong: 1 }], controls, rules);
    assert.deepStrictEqual({ pass: gap.pass, unknown: gap.own.unknown, incomplete: gap.incomplete, e: gap.own.rows[1].known }, { pass: false, unknown: 1, incomplete: true, e: false });
    // in the money is part of clearing: four negative comparisons are beaten by a loss, and that is not a pass
    const under = V.heldBackRead([{ si: 0, label: 'f', tHours: 41, weekdaysOnly: false, avgHold: -1, avgTrades: 5, avgVsLong: 6 }], { ...controls, keys: ['all|41'], byKey: { 'all|41': { alwaysLong: -7, alwaysShort: -9, buyHold: -2, shortHold: -3 } } }, rules);
    assert.deepStrictEqual({ pass: under.pass, clears: under.own.rows[0].clears, beatsAll: Object.values(under.own.rows[0].beats).every(Boolean) }, { pass: false, clears: false, beatsAll: true });
    // the key a survivor is read under is the one the four are kept under beside the set
    assert.strictEqual(V.ownKeyOf({ tHours: 41, weekdaysOnly: true }), 'wk|41');
    assert.strictEqual(V.ownKeyOf({ tHours: 161, weekdaysOnly: false }), 'all|161');
    const st = src('lib/stages.js');
    assert.ok(st.includes("const controlKeyOf = (r) => `${r && r.weekdaysOnly ? 'wk' : 'all'}|${Number(r && r.tHours)}`;") && st.includes('out.byKey[k] = one;'), 'the set keeps the four by the same key the verdict reads them under');
    // the sentence leads with the gate and prints the average as hindsight
    const b = V.buildBlock({ rules, footing: { ok: true, had: 4 }, looks: { unstamped: 1 }, read: all, copies: { copies: 80, beats: 80, bar: 64, barPct: 80, chance: 0.21, pass: true }, survivors: { survivors: 4, passing: 4, byChance: 0.8 }, sanity: { known: true, ok: true, board: { losing: 0.47 }, threshold: 45 } });
    assert.strictEqual(b.verdict.pass, true);
    assert.ok(/on the held-back window 4 of 4 survivors made money and beat each of the four comparisons at their own hold length, the bar being 4 \(80%\); averaged, the 4 survivors made \$258\.50 a setting, not beating the best of the four, which was being long every period at \$340\.00 at the worst hold length in use, a hindsight reading and never a gate/.test(b.verdict.sentence), b.verdict.sentence);
  },

  // A MISSING ONE OF THE FOUR IS UNKNOWN, AND UNKNOWN NEVER PASSES. Beating
  // three of four says nothing at all about the one nobody priced, so the best
  // of them cannot be named and there is no bar to clear.
  aMissingOneOfTheFourLeavesNoBestAndNothingPasses() {
    const rows = [{ si: 0, label: 'one', tHours: 65, weekdaysOnly: false, avgHold: 10, avgTrades: 5, avgVsLong: 1 }];
    const r = V.heldBackRead(rows, {
      known: true, keys: ['all|65'], of: 1, missing: 0,
      alwaysLong: { lo: 1, hi: 1 }, buyHold: { lo: 1, hi: 1 }, shortHold: { lo: 1, hi: 1 },
      byKey: { 'all|65': { alwaysLong: 1, alwaysShort: null, buyHold: 1, shortHold: 1 } },
    });
    assert.strictEqual(r.comparisons.best, null, 'three of four names no best');
    assert.strictEqual(r.comparisons.beatsBest, null);
    assert.strictEqual(r.pass, false, 'unknown never passes');
    assert.deepStrictEqual({ known: r.own.rows[0].known, clears: r.own.rows[0].clears, unknown: r.own.unknown }, { known: false, clears: false, unknown: 1 }, 'at its own hold length too, three of four is unknown');
    assert.ok(/best of them is unknown/.test(V.verdict({ read: r, footing: {}, copies: {}, survivors: {}, sanity: {} }).sentence),
      'and the sentence says so rather than printing three of four as though they were all of them');
  },

  // THE FOUR ARE A TABLE, NOT A SENTENCE (3.101.0, owner 2026-09-10: "the
  // perspective is flipping half way through the sentence"). One prose line
  // carried the survivors' figures and the four comparisons together, and the
  // subject changed silently in the middle of it: "199 survivors made $344.08"
  // is about the survivors, "being long every period $400.88 not beaten" is
  // about the comparison. "Not beaten" was passive with the doer left out, and
  // the dots separated facts and joined words inside a fact at the same time,
  // so the phrase had no reliable owner.
  //
  // Three things this holds. One panel builder, so the verdict and the reserve
  // grade cannot drift. The beaten column is derived from the figures rather
  // than read from a stored flag, so a block stamped under an older release
  // draws the same as one stamped today (RULE NINE). And an absent figure reads
  // "not known", never "no" -- conflating those was the bug that made a
  // comparison the rule beat by six hundred dollars print as "not beaten".
  //
  // Watched failing: read `beaten` off c.beatsAlwaysShort instead of deriving
  // it and an old block draws a beaten comparison as not beaten; drop the
  // missing check on `best` and three of four names a best.
  theFourComparisonsAreATableDerivedFromTheFiguresNotFromStoredFlags() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    assert.ok(/^function cmpRows\(real, c\)/m.test(ui), 'one place derives the four');
    assert.ok(/^function readPanel\(title, h, c, stretch\)/m.test(ui), 'one panel builder draws them');
    const uses = (ui.match(/readPanel\(`/g) || []).length;
    assert.strictEqual(uses, 1, 'the one block draws it, for both stretches, and nothing else writes its own');
    // 3.143.3 (owner: "do the same on verify" as the break between Tune's two tables): the panel's
    // second and third tables each sit a clear gap below the table above, never on its next line
    const hb = ui.slice(ui.indexOf('function readPanel(title, h, c, stretch) {'), ui.indexOf('\n}\n', ui.indexOf('function readPanel(title, h, c, stretch) {')));
    assert.strictEqual((hb.match(/<div class="scrollx"/g) || []).length, 4, 'the panel no longer draws four tables: the survivors, the four, the hindsight best of them, and each survivor at its own hold length (3.146.0)');
    assert.strictEqual((hb.match(/<div class="scrollx" style="margin-top:\.8rem"><table>/g) || []).length, 3, 'a table on the panel runs straight on from the one above it again, with no break between them');
    // THE GATE IS THE OWN-HOLD TABLE, the best of the four a hindsight reading (3.146.0)
    assert.ok(hb.indexOf('>best of the four<') < hb.indexOf('>survivors beating all four at their own hold length<'), 'the own-hold reading is not drawn under the hindsight one');
    assert.ok(/this read<\/th>[\s\S]*?\$\{o \? \(o\.pass \? '<b class="pos">STANDS<\/b>' : '<b class="neg">FAILS<\/b>'\)/.test(hb), 'STANDS or FAILS is not read off each survivor at its own hold length');
    assert.ok(!/t\.best\.beaten && h\.real > 0 \? '<b class="pos">STANDS<\/b>'/.test(hb), 'the hindsight best of the four still says STANDS');
    assert.ok(/information only, never a gate/.test(hb), 'the hindsight reading does not say it is information only');
    // the prose line and every part of it that flipped subject are gone
    assert.ok(!/against always long`/.test(ui), 'the against-always-long figure is off this line (owner, 2026-09-10)');
    assert.ok(!/beatsBuyHold \? 'beaten'/.test(ui), 'no screen marks a comparison from a stored flag');
    assert.ok(!/does not stand<\/b>'\}<\/p>/.test(ui), 'the stands / does not stand tail is gone with the sentence');
    // every column carries its subject in the heading
    // the money column is named after the stretch, as two whole phrases the word list reads whole on both tabs (3.147.0)
    assert.ok(ui.includes("'<span>reserve $ a setting</span>' : '<span>held-back $ a setting</span>'"), 'the table needs a "held-back $ a setting" heading on Held and a "reserve $ a setting" one on Reserve');
    for (const h of ['survivors', 'trades a setting', 'no figure',
      'comparison', 'it made', 'rule ahead by', 'beaten by rule',
      'best of the four', 'rule ahead by it', 'hindsight reading',
      'survivors beating all four at their own hold length', 'the bar', 'hold lengths in use', 'this read', 'all four at its own hold']) {
      assert.ok(new RegExp(`>${h}<`).test(ui), `the table needs a "${h}" heading`);
    }
    // and the three states are all reachable
    assert.ok(/not known<\/span>/.test(ui) && /'no figure'/.test(ui), 'an absent figure reads not known, never no');
  },

  // WHAT THE RULE DROPPED (V8, 3.100.0, VERIFY-DESIGN.md Part 7). A count of
  // survivors that clear a bar is unreadable without the same count for what
  // did not survive. The reading this defends is the one the failed set of
  // 2026-09-09 never got: 199 of 199 survivors positive on the held-back
  // window, and nobody ever asked what the other 2,553 did.
  //
  // Watched failing: make sideRead count every row rather than only the priced
  // ones and the shares stop being comparable; drop the two controls arguments
  // and read both sides against one set of comparisons, and the second case
  // below stops distinguishing the sides.
  theDroppedSettingsAreReadBesideTheKeptOnesAndSayWhetherThePickingDidAnything() {
    const rows = (n, at) => Array.from({ length: n }, (_, i) => ({ avgHold: at(i) }));
    const four = (v) => ({ known: true, alwaysLong: { lo: v, hi: v }, alwaysShort: { lo: v, hi: v }, buyHold: { lo: v, hi: v }, shortHold: { lo: v, hi: v } });
    // THE FAILURE WE LIVED: every setting positive, kept and dropped alike
    const flat = V.keptVsDropped(rows(199, () => 5), rows(2553, () => 4), four(1), four(1));
    assert.deepStrictEqual({ k: flat.keptShare, d: flat.droppedShare }, { k: 1, d: 1 });
    assert.strictEqual(flat.gapPositive, 0);
    assert.ok(/THE DROPPED DID AS WELL OR BETTER/.test(flat.sentence), flat.sentence);
    assert.ok(/never a gate/.test(flat.sentence), 'and it says it is never a gate');
    // what a picking that works looks like
    const real = V.keptVsDropped(rows(199, () => 50), rows(2553, () => -4), four(1), four(1));
    assert.strictEqual(real.droppedShare, 0);
    assert.ok(/clearly ahead/.test(real.sentence), real.sentence);
    // EACH SIDE AGAINST ITS OWN HOLD LENGTHS: the same money is beaten on one
    // side and not on the other when their comparisons differ
    const split = V.keptVsDropped(rows(2, () => 10), rows(2, () => 10), four(1), four(99));
    assert.strictEqual(split.keptBestShare, 1, 'the kept beat their own bar of 1');
    assert.strictEqual(split.droppedBestShare, 0, 'the dropped do not beat theirs of 99');
    // a row with no figure is counted and never quietly dropped
    const gap = V.keptVsDropped([{ avgHold: 5 }, { avgHold: null }], rows(2, () => 1), four(1), four(1));
    assert.deepStrictEqual({ of: gap.kept.of, priced: gap.kept.priced, noFigure: gap.kept.noFigure }, { of: 2, priced: 1, noFigure: 1 });
    // and a rule that kept everything says so rather than dividing by nothing
    assert.ok(/nothing it dropped to read against/.test(V.keptVsDropped(rows(3, () => 1), [], four(1), four(1)).sentence));
  },

  // THE PRESS IS ON VERIFY WITH ITS ROUTE, its box, and its refusal in words.
  theDroppedPressIsOnHeldAndReserveWithItsRouteAndItsBox() {
    const ui = src('public/construct.js');
    assert.ok(/^function vDroppedHtml\(/m.test(ui), 'a top-level helper draws it');
    assert.ok(/id="vDropped"/.test(ui) && /id="vDroppedN"/.test(ui), 'the press and the how-many box');
    // RULE FOUR: the box, its label and the button are one control and line up
    const block = ui.slice(ui.indexOf('function vDroppedHtml('), ui.indexOf('function vOthersHtml('));
    assert.ok(/class="row" style="align-items:center"/.test(block), 'the box and the button share a baseline');
    assert.ok(!/data-sort|sortBtn/.test(block), 'no sort on it');
    assert.ok(/api\/funnel\/set\/\$\{encodeURIComponent\(chosen\)\}\/dropped`, \{ stretch, sample: vTyped\('#vDroppedN'\) \}/.test(ui), 'the typed count is sent, on the stretch shown');
    const srv = src('server.js');
    assert.ok(srv.includes("'/api/funnel/set/:id/dropped'"), 'the route is served');
    assert.ok(/funnelDroppedStart\(req\.params\.id, req\.body \|\| \{\}\)/.test(srv), 'and it takes the typed count');
  },
};

// THE RESERVE BOARD (3.148.0, VERIFY-DESIGN.md Part 9 release 2): the board
// read onto rows takes the board's figures and nothing else; a file of another
// shape reads as absent; the panel, its three presses and their routes are on
// the page, and the press is named on the page exactly as the engine names it.
module.exports.theReserveBoardIsReadOntoRowsAndIsOnReserveWithItsPressesAndRoutes = function () {
  const SETS = path.join(__dirname, '..', 'data', 'stagesets');
  fs.mkdirSync(SETS, { recursive: true });
  const rows = [{ label: 'a', avgTest: 10, avgHold: 5, noiseHold: [1, 2], beat: 3, pairs: 2, avgLead: 1, avgTrades: 4, avgVsLong: 4, pnlThirds: [1, 1, 1] }, { label: 'b', avgTest: -4, avgHold: -2, noiseHold: [1, 2], beat: 1, pairs: 2, avgLead: -1, avgTrades: 3, avgVsLong: -3, pnlThirds: [1, 1, 1] }];
  const board = { rows: { a: { avgHold: 7, avgTrades: 6, avgVsLong: 6, noiseHold: [3, 4, 5], beat: 2, pairs: 3, avgLead: 0.5, pnlThirds: [2, 2, 3], stops: 1, ride: { maxDrawdown: -1 }, test: { money: 10, trades: 4 } } } };
  const on = stages.withReserveBoard(rows, board);
  assert.deepStrictEqual({ a: [on[0].avgHold, on[0].noiseHold, on[0].beat, on[0].pairs, on[0].avgLead, on[0].avgTrades, on[0].avgVsLong, on[0].pnlThirds, on[0].stops, on[0].onReserveBoard, on[0].avgTest], b: [on[1].avgHold, on[1].noiseHold, on[1].beat, on[1].onReserveBoard, on[1].avgTest] },
    { a: [7, [3, 4, 5], 2, 3, 0.5, 6, 6, [2, 2, 3], 1, true, 10], b: [null, null, null, false, -4] }, 'a row the board holds takes the board\'s reserve figures; a row it lacks reads as no figure, never as its held-back one; the test side is untouched');
  // a file of another shape reads as absent (RULE NINE)
  const tag = Date.now().toString(36);
  const pid = `s3-rb-${tag}`;
  try {
    fs.writeFileSync(stages.reserveBoardFile(pid, 'X|||daily-1d'), require('zlib').gzipSync(Buffer.from(JSON.stringify({ v: 99, rows: {}, pricings: [{ at: 'x' }] }))));
    assert.strictEqual(stages.readReserveBoard(pid, 'X|||daily-1d'), null);
    assert.strictEqual(stages.readReserveBoard(pid, 'Y|||daily-1d'), null, 'no file is no board');
  } finally { try { fs.rmSync(stages.reserveBoardFile(pid, 'X|||daily-1d'), { force: true }); } catch (_) { /* fixture */ } }
  // the page: the panel between the looks line and the press, on Reserve only; the three presses; the press named as the engine names it; the routes
  const ui = src('public/construct.js');
  assert.ok(/^function vBoardHtml\(/m.test(ui) && /^async function vBoardFollow\(/m.test(ui), 'top-level helpers');
  assert.ok(ui.includes("${vFootingHtml(d)}${vLooksHtml(d, stretch)}${vBoardHtml(d, stretch)}${vPressHtml(d, stretch)}"), 'the board panel sits under the looks line and above the press');
  assert.ok(ui.includes("if (stretch !== 'reserve' || !d.board) return '';"), 'Held draws no board: stage 3 priced its window');
  for (const id of ['vBoard', 'vBoardOthers', 'vBoardStop', 'vBoardMsg']) assert.ok(ui.includes(`id="${id}"`), `${id} is on the page`);
  assert.ok(ui.includes(`>${stages.BOARD_PRESS}</button>`), 'the press is named on the page exactly as the engine names it in its refusals');
  assert.strictEqual(stages.BOARD_PRESS, 'Price the reserve board');
  assert.ok(/api\/funnel\/set\/\$\{encodeURIComponent\(chosen\)\}\/reserve-board`, \{ which: 'unit' \}/.test(ui) && /\/reserve-board`, \{ which: 'others' \}/.test(ui) && /\/reserve-board\/stop`/.test(ui) && /\/reserve-board\/status`/.test(ui), 'the three presses and the poll');
  assert.ok(/Read off the reserve board of this unit:/.test(ui), 'a set says which board it was read off');
  const srv = src('server.js');
  for (const r of ['/api/funnel/set/:id/reserve-board', '/api/funnel/set/:id/reserve-board/status', '/api/funnel/set/:id/reserve-board/stop']) assert.ok(srv.includes(`'${r}'`), `${r} is served`);
  assert.ok(/reserveBoardStart\(req\.params\.id, req\.body \|\| \{\}\)/.test(srv), 'the press takes which');
};

// THE PICTURE THROUGH EVERY PERIOD (3.149.0, VERIFY-DESIGN.md Part 9 release
// 4): read off the held set, the reserve set and the records, priced by
// nothing; the four stretches named train, test, held and reserve; the same
// lines per survivor; the frozen stop choice rides on the greenlight source.
module.exports.thePictureIsReadOffTheSetsAndPricesNothing = async function () {
  const f = await fixture();
  try {
    const doc = await cutOn(f);
    await pressed(doc.id, { barPct: 100 });
    const held = setsOf(doc.id)[0];
    rewrite(held.id, (on) => { on.block.verdict.pass = true; on.block.release = require('../package.json').version; });
    stages.writeReserveBoard(f.id, doc.unit, handBoard(10, 1));
    await pressed(doc.id, {}, 'reserve');
    const rs = setsOf(doc.id, 'reserve')[0];
    const dry = await stages.stage4GreenlightDry(rs.id);
    const p = dry.picture;
    assert.deepStrictEqual(p.stretches, ['train', 'test', 'held', 'reserve']);
    assert.deepStrictEqual({ priced: p.priced, test: p.rule.test.money, held: p.rule.held.money, heldSet: p.rule.held.set, reserve: p.rule.reserve.money, reserveOf: p.rule.reserve.of, train: p.rule.train.why },
      { priced: false, test: 10, held: 5, heldSet: held.name, reserve: 7, reserveOf: 2, train: 'no capture on Tune yet — the training window is read off the capture' });
    assert.deepStrictEqual(p.survivors.map((x) => [x.label, x.test.money, x.held.money, x.reserve.money, x.train]), doc.survivors.map((x) => [x.label, 10, 5, 7, null]));
    assert.ok(p.rule.test.comparisons && 'known' in p.rule.test.comparisons, 'the four on the test window are read, or said to be unknown');
    // THE SHARE OF THE FOUR, THE STEPS AND THE DEVIANCE (3.247.0): the average share
    // of the four each survivor clears is the mean of its own shares, off the held
    // set's own read; every stage of a survivor's money that was not taken is null
    // (a dash on the page), never a copy of the stage before; and its deviance is
    // the depth the pick is made by
    const heldRows = (((held.block || {}).read || {}).own || {}).rows || [];
    const known = heldRows.filter((x) => x && x.known && x.beats);
    const share = known.length ? (100 * known.reduce((a, x) => a + V.GATED.filter((k) => x.beats[k] === true).length / V.GATED.length, 0)) / known.length : null;
    assert.strictEqual(p.rule.held.fourShare, share, 'the average share of the four on the held row');
    assert.ok(p.rule.test.fourShare === null || (p.rule.test.fourShare >= 0 && p.rule.test.fourShare <= 100), 'a share, or none when the four were not read');
    assert.deepStrictEqual(p.survivors.map((x) => [x.steps.test.beforeHistory && x.steps.test.beforeHistory.money, x.steps.test.afterHistory, x.steps.test.afterStop, x.steps.test.afterSizing, x.steps.train.beforeHistory, x.steps.held.afterHistory, x.halfLife]),
      doc.survivors.map(() => [10, null, null, null, null, null, null]), 'no History, no capture, no tuning: only the test and held figures as stage 3 priced them');
    assert.ok(p.survivors.every((x) => x.depth && x.depth.worst >= 0 && x.depth.worst <= 1 && x.depth.mean <= x.depth.worst + 1e-12), 'every survivor says how far it sits from the middle of the rule');
    const byDepth = p.survivors.find((x) => x.label === dry.depthPick.label);
    assert.deepStrictEqual([byDepth.depth.worst, byDepth.depth.mean], [dry.depthPick.worst, dry.depthPick.mean], 'the deviance shown is the depth the pick is made by');
    assert.ok(p.survivors.every((x) => x.test.clears === null || typeof x.test.clears === 'boolean'), 'each survivor\'s own test clears, or none');
    // a held set's picture says the reserve is read on Reserve
    const hd = await stages.stage4GreenlightDry(held.id);
    assert.ok(/read on Reserve/.test(hd.picture.rule.reserve.why), hd.picture.rule.reserve.why);
    // the frozen stop rides on the source, off the set (none chosen here)
    rewrite(rs.id, (on) => { on.block.verdict.pass = true; });
    const source = await stages.stage4GreenlightSource(rs.id, { pick: 'depth' });
    assert.ok('stop' in source && source.stop === null, 'the stop choice is carried, none chosen');
    // the page: the picture under the set, the stretches named, the drill-down drawn from the pick
    const ui = src('public/construct.js');
    assert.ok(/^function glPictureHtml\(/m.test(ui) && /^function glOneHtml\(/m.test(ui), 'top-level helpers');
    assert.ok(ui.includes('${glPictureHtml(d)}'), 'drawn under the chosen set');
    for (const w of ['<span>train</span>', '<span>test</span>', '<span>held</span>', '<span>reserve</span>', '<span>The picture through every period</span>']) assert.ok(ui.includes(w), `${w} is on the page`);
    // the pick draws the one survivor, and marks it in the table of every survivor (3.247.0)
    assert.ok(/pk\.addEventListener\('change', \(\) => \{ picked = pk\.value; drawRows\(\); drawOne\(\); \}\)/.test(ui), 'the pick draws the one survivor');
    // THE TABLE OF EVERY SURVIVOR (3.247.0) is drawn inside the picture, which is
    // drawn whether or not the set is refused; each row picks, each heading sorts
    const pic = ui.slice(ui.indexOf('function glPictureHtml('), ui.indexOf('function glRowsHtml('));
    assert.ok(pic.indexOf('<div class="gl-rows"></div>') >= 0 && pic.indexOf('<div class="gl-rows"></div>') < pic.indexOf('gl-one'), 'the table sits above the one survivor\'s lines, inside the picture');
    assert.ok(ui.indexOf('${glPictureHtml(d)}') < ui.indexOf("${d.refused ? '' : `<div class=\"row\" style=\"align-items:flex-end\">"), 'the picture is drawn before the refusal hides the pick box');
    const rowsFn = ui.slice(ui.indexOf('function glRowsHtml('), ui.indexOf('function glOneHtml('));
    for (const w of ["'deviance from centre, worst'", "'deviance from centre, average'", 'data-glpick=', 'data-glsort=']) assert.ok(rowsFn.includes(w), `${w} is in the table of every survivor`);
    const oneFn = ui.slice(ui.indexOf('function glOneHtml('), ui.indexOf('function glOneHtml(') + 6000);
    const cols = ['before History $', 'after History $', 'after stop $', 'after conviction sizing $'].map((w) => oneFn.indexOf(w));
    assert.ok(cols.every((i) => i > 0) && cols.every((i, k) => !k || i > cols[k - 1]), 'the one survivor\'s money in four columns, in the order each change is applied');
    assert.ok(pic.includes('average % of the four cleared') && pic.includes('The test stretch is without the History and Tune settings'), 'the picture carries the share column and says what the test row is without');
  } finally { f.cleanup(); }
};

// THE RESERVE IS THE SEALED WINDOW OR NOTHING (3.147.0, VERIFY-DESIGN.md Part
// 9). A 61/13/13/13 rule keeps a reserve -- the sealed window, readable while
// the seal is intact on the unit; a 70/15/15 rule keeps none and is held
// alone; a layout nobody recorded keeps none. The "everything after the
// held-back window" reading of 3.141.0 went with the release: a reserve nobody
// sealed is not a reserve. The press, the ride and the screen all read the one
// reader.
module.exports.theReserveIsTheSealedWindowOrNothing = function () {
  const SETS = path.join(__dirname, '..', 'data', 'stagesets');
  fs.mkdirSync(SETS, { recursive: true });
  const tag = Date.now().toString(36);
  const KEY = 'AAAUSDT|||daily-1d';
  const unit = { trade: 'AAAUSDT', ctx1: null, ctx2: null, geometry: 'daily-1d' };
  const write = (id, doc) => fs.writeFileSync(path.join(SETS, `${id}.json`), JSON.stringify(doc));
  const ids = [];
  const mk = (suffix, parent, doc) => {
    const p = `s3-hw-${tag}-${suffix}`; const c = `s4-hw-${tag}-${suffix}`;
    write(p, { id: p, stage: 3, params: parent.params || {}, windows: parent.windows || null });
    write(c, { id: c, stage: 4, kind: 'funnel', unit: KEY, parent: { id: p }, ...doc });
    ids.push(p, c);
    return stages.getSet(c);
  };
  try {
    // 70/15/15: no reserve, held alone, and said so
    const split = mk('split', { params: { windowLayout: 'split70' }, windows: { units: { [KEY]: { hold: { fromTs: 1000, toTs: 5000, chunks: 4 } } } } }, {});
    const w1 = stages.reserveOf(split);
    assert.deepStrictEqual(w1, { keeps: false, layout: 'split70', intact: false, fromTs: null, chunks: null, why: stages.HELD_ALONE }, `a 70/15/15 rule keeps a reserve: ${JSON.stringify(w1)}`);
    assert.strictEqual(stages.HELD_ALONE, 'held alone: this layout keeps no reserve');
    // 61/13/13/13: the sealed reserve, readable while the seal is intact
    const sealed = mk('sealed', { params: { windowLayout: 'reserve61' } }, { sealed: { units: [{ ...unit, reserve: { fromTs: 7000, chunks: 9 } }] } });
    const w3 = stages.reserveOf(sealed);
    assert.deepStrictEqual(w3, { keeps: true, layout: 'reserve61', intact: true, fromTs: 7000, chunks: 9, why: null }, JSON.stringify(w3));
    const broken = mk('broken', { params: { windowLayout: 'reserve61' } }, { sealed: { units: [{ ...unit, reserve: null }], why: 'the reserve was never cut' } });
    const w4 = stages.reserveOf(broken);
    assert.strictEqual(w4.intact, false);
    assert.ok(/sealed window is not intact on this unit/.test(w4.why), w4.why);
    // a layout nobody recorded keeps none
    const odd = mk('odd', { params: {} }, {});
    assert.deepStrictEqual({ keeps: stages.reserveOf(odd).keeps, why: stages.reserveOf(odd).why }, { keeps: false, why: stages.HELD_ALONE });
    // the listing says it on the rule, and Greenlight's gate reads it on a held set
    assert.deepStrictEqual({ alone: stages.judgeSummaryOf(split).heldAlone, keeps: stages.judgeSummaryOf(split).keepsReserve }, { alone: stages.HELD_ALONE, keeps: false });
    assert.deepStrictEqual({ alone: stages.judgeSummaryOf(sealed).heldAlone, keeps: stages.judgeSummaryOf(sealed).keepsReserve }, { alone: null, keeps: true });
  } finally { for (const id of ids) { try { fs.rmSync(path.join(SETS, `${id}.json`), { force: true }); } catch (_) { /* fixture */ } } }
  // THE PRESS and THE RIDE price a window they read off the one reader, and refuse in its words
  const s = src('lib/stages.js');
  const price = s.slice(s.indexOf('async function priceSurvivorsOn('), s.indexOf('function reserveLooksOf('));
  assert.ok(price.includes("if (stretch === 'reserve') {\n    const r = reserveOf(doc);\n    if (!r.keeps) throw new Error(HELD_ALONE);\n    if (!r.intact) throw new Error(r.why);\n    base.unread = { fromTs: r.fromTs };\n  }"),
    'the pricing reads a window it did not read off the record, or still asks for a seal');
  assert.ok(!/sealedOnUnitOf/.test(price), 'the pricing still reads the seal itself');
  for (const fn of ['judgeRefusalOf', 'rideRefusalOf']) {
    const body = s.slice(s.indexOf(`function ${fn}(`), s.indexOf('\n}\n', s.indexOf(`function ${fn}(`)));
    assert.ok(body.includes("if (stretch === 'reserve') {\n    const r = reserveOf(doc);\n    if (!r.keeps) return HELD_ALONE;\n    if (!r.intact) return r.why;\n    if (!heldStandingOf(doc)) return NO_HELD_PASS;\n"), `${fn} does not refuse the reserve through the one reader`);
  }
  assert.ok(!/kind: 'after'|everything after the held-back window/.test(s), 'the "everything after the held-back window" reading is still in the engine');
  // THE SCREEN: no share of the history typed into it; the layouts in the Sweep
  // screen's words; the reserve window said in its record's own terms
  const page = src('public/construct.js');
  const judge = page.slice(page.indexOf('const JUDGE_SET_KEY = {'), page.indexOf('async function drawHeld() {'));
  assert.ok(judge.length > 3000, 'the judge panel is not drawn by its own helpers');
  assert.ok(!/13%/.test(judge), 'a share of the history is still typed onto the panel');
  assert.ok(!/sealed 13/.test(judge) && !/the sealed \d/.test(judge), 'the screen still calls the reserve window the sealed something');
  assert.ok(judge.includes("return layout === 'reserve61' ? '61/13/13/13 (sealed exam)' : layout === 'split70' ? '70/15/15' : 'unrecorded';"),
    'the layouts are not named by the words the Sweep screen offers them under');
  assert.ok(judge.includes('return `reserve window from ${vDay(w.fromTs)} onward: the sealed reserve, cut away before anything trained') && judge.includes("if (!w.keeps) return `<span class=\"muted\">${esc(String(w.why || ''))}</span>`;"),
    'the window is not said in its own record\'s terms, or a rule with no reserve is not told so');
  assert.ok(!judge.includes('everything after the held-back window'), 'the screen still offers the reading that went');
};

// THE TABS READ IN PROCESSING ORDER (3.142.0, owner order 2026-09-15: "your
// whole order of processing is screwed up ... The history tab comes after the
// funnel tab. The verify tab is until the very end."; Held and Reserve in
// Verify's place since 3.147.0). So: History and Tune ask for no verdict, read
// none and print none; Reserve and Greenlight, after Held, still need the held
// set that stood.
module.exports.theTabsReadInProcessingOrderAndNoScreenBeforeHeldAsksForAVerdict = async function () {
  const f = await fixture();
  try {
    const doc = await cutOn(f);
    assert.deepStrictEqual(setsOf(doc.id), [], 'nothing on Held has been pressed');
    // the doors before Held open without one
    const hl = await stages.halfLifeDry(doc.id);
    assert.deepStrictEqual({ refused: hl.refused, judge: hl.layout.judge, verdictWords: 'gate' in hl || 'verdicts' in hl }, { refused: null, judge: 'test', verdictWords: false }, 'History asks for a verdict');
    const cap = await stages.tuneCaptureDry(doc.id);
    assert.deepStrictEqual({ refused: cap.refused, verdictWords: 'gate' in cap || 'verdicts' in cap }, { refused: null, verdictWords: false }, 'Tune asks for a verdict');
    // the doors after Held still wait for the held set that stood
    assert.strictEqual((await stages.judgeDry(doc.id, 'reserve')).refused, stages.NO_HELD_PASS, 'Reserve no longer needs the held set');
    let threw = null;
    try { await stages.stage4GreenlightSource(doc.id, { pick: 'depth' }); } catch (e) { threw = e.message; }
    assert.strictEqual(threw, stages.gateRefusalOf(stages.getSet(doc.id)), 'Greenlight no longer needs a set that passed');
    // the tab strip says the same order
    const page = src('public/construct.js');
    const tabs = /const TABS = \[([\s\S]*?)\];/.exec(page)[1].match(/\['([a-z]+)'/g).map((x) => x.slice(2, -1));
    assert.ok(tabs.indexOf('funnel') < tabs.indexOf('history') && tabs.indexOf('history') < tabs.indexOf('tune') && tabs.indexOf('tune') < tabs.indexOf('held') && tabs.indexOf('held') === tabs.indexOf('reserve') - 1 && tabs.indexOf('reserve') === tabs.indexOf('greenlight') - 1, `the tabs do not read Funnel, History, Tune, Held, Reserve, Greenlight: ${tabs.join(' ')}`);
    // the code behind them: no verdict gate before Held, and the gates after it intact
    const eng = src('lib/stages.js');
    const body = (name) => eng.slice(eng.indexOf(`function ${name}(`), eng.indexOf('\n}\n', eng.indexOf(`function ${name}(`)));
    for (const fn of ['halfLifeRefusalOf', 'halfLifeRunOn', 'buildHalfLifeSet', 'halfLifeDry', 'captureRefusalOf', 'tuneCaptureRun', 'tuneCaptureDry']) {
      assert.ok(!/heldStandingOf|gateOfSet|NO_HELD_PASS/.test(body(fn)), `${fn} asks for a verdict, and its screen comes before Held`);
    }
    for (const fn of ['judgeRefusalOf', 'judgeRunOn', 'stage4GreenlightSource']) {
      assert.ok(/heldStandingOf|gateOfSet|gateRefusalOf/.test(body(fn)), `${fn} no longer asks for the set that stood`);
    }
    // the screens: History draws the retrain panel and nothing else, Tune's capture names no verdict, Reserve is the same renderer as Held
    const history = page.slice(page.indexOf('// ---- History (the retrain run)'), page.indexOf('// ---- THE PER-TRADE CAPTURE OF A STAGE 4 RECORD SET, on Tune'));
    assert.ok(history.includes("  $('#view').innerHTML = hHalfLifePanelHtml(hSets, hChosen, hl);") && !/verdict|hGrade|unread|reserve grade/.test(history.replace(/\/\/[^\n]*/g, '')), 'History draws or names something of Held\'s');
    const tune = page.slice(page.indexOf('// ---- THE PER-TRADE CAPTURE OF A STAGE 4 RECORD SET, on Tune'), page.indexOf('function tnTargetRowHtml('));
    assert.ok(tune.length > 1000 && !/verdict|gate/.test(tune.replace(/\/\/[^\n]*/g, '')), 'Tune\'s capture panel still names a verdict');
    assert.ok(page.includes("  $('#view').innerHTML = `<div class=\"judge\" data-stretch=\"${stretch}\">${vSetPanelHtml(sets, chosen, d, stretch)}</div>`;") && page.includes("const d = chosen ? await apiOr(`api/funnel/set/${encodeURIComponent(chosen)}/judge/${stretch}`, null) : null;"), 'the two tabs do not draw one panel off one door');
    // and the help says so
    const help = src('public/help-content.js');
    const section = (key, next) => help.slice(help.indexOf(`\n  ${key}: {`), help.indexOf(`\n  ${next}: {`));
    assert.ok(!/reserve grade|unread window|verdict|hGrade/.test(section('history', 'tune')), 'History\'s help still describes the reserve grade or a verdict');
    assert.ok(help.includes('  held: JUDGE_HELP.held,\n  reserve: JUDGE_HELP.reserve,') && /vRead: \{/.test(help.slice(help.indexOf('const JUDGE_HELP ='), help.indexOf('window.HELP = {'))), 'Held and Reserve do not share one help');
    assert.ok(!/verdict/.test(section('tune', 'coins').slice(section('tune', 'coins').indexOf('tnSet: {'), section('tune', 'coins').indexOf('stopCustomPct: {'))), 'Tune\'s capture help still names a verdict');
  } finally { f.cleanup(); }
};

// THE FOOTING TELLS THE TRUTH (3.234.2, owner 2026-09-23, reading the footing
// line on Held: "what does this mean"). A 70/15/15 set keeps no reserve, so it
// has no sealed window: said as that, in the layout's own name, never as a unit
// its parent's records fail to name. The parent's release is read where a stage
// set stamps it, at the top of its own record, and a release that is not
// recorded is said as that, never as a first digit that differs. A Stage 4 set
// cut from here on records its parent's release from the same place.
module.exports.theFootingSaysNoSealedWindowOnAReservelessLayoutAndReadsTheParentsReleaseWhereItIsStamped = function () {
  const S4 = require('../lib/funnelset');
  // no sealed window on 70/15/15, and it is not a broken seal
  const split = stages.sealedOnUnitOf({ unit: 'BTCUSDT|ETCUSDT||daily-3d', sealed: { layout: 'split70', sealed: false, units: [], why: 'this set\'s window layout is split70' } });
  assert.deepStrictEqual([split.sealed, split.none], [false, true], 'a layout that keeps no reserve reads as a seal that is broken');
  assert.strictEqual(split.why, 'this set was built 70/15/15, which keeps no reserve window, so nothing is sealed');
  assert.ok(!/name no unit/.test(split.why), 'the parent\'s records are blamed for a layout that seals nothing');
  // on a layout that does seal, a unit missing from the record is still said as that
  const missing = stages.sealedOnUnitOf({ unit: 'AAA|||daily-1d', sealed: { layout: 'reserve61', sealed: true, units: [{ trade: 'BBB', ctx1: null, ctx2: null, geometry: 'daily-1d', reserve: { fromTs: 1, chunks: 9 } }] } });
  assert.ok(!missing.none && /its parent's records name no unit 'AAA\|\|\|daily-1d'/.test(missing.why), `a seal missing this unit is not said: ${missing.why}`);
  // THE RELEASES: the parent's own stamp, one first digit when all three agree
  const doc = { release: '3.233.0', rich: {}, check: {}, unit: 'AAA|||daily-1d', sealed: { layout: 'split70', units: [] }, marks: [], steps: [], backSteps: [], userRule: null };
  const join = { rule: S4.normaliseRule({ ranges: {}, allowed: {}, floors: {} }), parent: { engineVersion: '3.220.4', params: {} }, same: true, gone: 0, now: 1, had: 1, sameOnParent: true, nowOnParent: 1 };
  const f = stages.verifyFooting(doc, join);
  assert.deepStrictEqual([f.releases.parent, f.releases.unknown, f.releases.sameFirstDigit], ['3.220.4', [], true], `the parent's release is not read where a stage set stamps it: ${JSON.stringify(f.releases)}`);
  assert.ok(f.sealed.none, 'the footing does not carry that this layout seals nothing');
  // a parent that carries no stamp is not recorded, and is never a first digit that differs
  const g = stages.verifyFooting(doc, { ...join, parent: { params: { engineVersion: '9.9.9' } } });
  assert.deepStrictEqual([g.releases.parent, g.releases.unknown, g.releases.sameFirstDigit], [null, ['parent'], false], 'a release read out of the settings, or a missing one read as known');
  // a real difference is still a difference
  const h = stages.verifyFooting(doc, { ...join, parent: { engineVersion: '2.9.0', params: {} } });
  assert.deepStrictEqual([h.releases.unknown, h.releases.sameFirstDigit], [[], false]);
  // THE LINE ON THE SCREEN says each of those in words
  const page = src('public/construct.js');
  const at = page.indexOf('function vFootingHtml(d) {');
  // eslint-disable-next-line no-new-func
  const vFootingHtml = new Function('esc', 'vDay', `${page.slice(at, page.indexOf('\n}\n', at) + 3)}\nreturn vFootingHtml;`)((t) => String(t), () => 'a day');
  const line = (ff) => vFootingHtml({ footing: ff }).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  assert.ok(line(f).includes('· no sealed window - this set was built 70/15/15, which keeps no reserve window, so nothing is sealed'), `the line does not say there is no sealed window: ${line(f)}`);
  assert.ok(!line(f).includes('not intact'), 'a layout that seals nothing still reads as a seal not intact');
  assert.ok(line(f).includes('releases: set 3.233.0, parent 3.220.4, reader') && line(f).includes('(one first digit)'), `the releases do not read as one first digit: ${line(f)}`);
  assert.ok(line(g).includes('(the parent release is not recorded, so the first digits cannot be compared)') && !line(g).includes('the first digits differ'), `a release not recorded reads as a mismatch: ${line(g)}`);
  assert.ok(line(h).includes('(the first digits differ)'), 'a real difference is no longer said');
  // A STAGE 4 SET RECORDS ITS PARENT'S RELEASE FROM THE SAME PLACE
  const cut = S4.newFunnelSet({ id: 's4-x', seq: 1, name: 'x', parent: { id: 's3-x', name: 'S3 x', engineVersion: '3.220.4', params: {} }, release: '3.234.2' });
  assert.strictEqual(cut.parent.release, '3.220.4', 'a Stage 4 set records its parent\'s release from where no stage set stamps it');
};

// THE STAGE 4 RECORD SET BOX ON HELD AND RESERVE SHOWS EACH RULE BY ITS NAME
// AND NOTHING ELSE (3.234.5, owner order 2026-09-23: "it's a mile long with a
// bunch of stuff the software repeats onto the name that is not wanted").
module.exports.theHeldAndReserveSetBoxShowsEachRuleByItsNameAlone = function () {
  const page = src('public/construct.js');
  const at = page.indexOf('function vSetBoxHtml(list, chosen, stretch) {');
  const rp = page.indexOf('function rebuildPrefix(x) {');
  // eslint-disable-next-line no-new-func
  const vSetBoxHtml = new Function('esc', 'stretchPlain', `${page.slice(rp, page.indexOf('\n', rp) + 1)}${page.slice(at, page.indexOf('\n}\n', at) + 3)}\nreturn vSetBoxHtml;`)((t) => String(t), (x) => (x === 'reserve' ? 'reserve' : 'held-back'));
  const list = [
    { id: 's4-a', name: 'HALF LIFE TABLE: my own name', unitName: 'BNBUSDT alongside LTCUSDT daily-4d', counts: { survivors: 51 }, target: null, derived: { fromName: 'the set it came from' }, judge: { held: { newest: { number: 2, pass: true, at: '2026-09-23' }, stands: true } } },
    { id: 's4-b', name: 'a rule on BTC', unitName: 'BTCUSDT alongside ETCUSDT daily-3d', counts: { survivors: 70 }, target: 100, judge: null },
    // (3.235.0, owner 2026-09-23: "flag somehow all the data sets that need a rebuild. Maybe put a prefix on them")
    { id: 's4-c', name: 'an older rule', unitName: 'LTCUSDT alongside XRPUSDT daily-2d', counts: { survivors: 66 }, target: 100, judge: null, rebuild: { words: 'REBUILD REQUIRED', reasons: [{ key: 'stage4', why: 'x' }] } },
  ];
  for (const stretch of ['held', 'reserve']) {
    const options = [...vSetBoxHtml(list, 's4-a', stretch).matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
    assert.deepStrictEqual(options, [['s4-a', 'HALF LIFE TABLE: my own name'], ['s4-b', 'a rule on BTC'], ['s4-c', 'REBUILD REQUIRED - an older rule']], `a rule in the box on ${stretch} carries something after its name, or one that needs a rebuild does not say so in front of it: ${JSON.stringify(options)}`);
  }
  assert.ok(!/function vNewestWords\(/.test(page), 'the words that followed each name are still in the page with nothing to draw them');
};


// THE LOOSER CRITERIA AND THE AUTOMATIC PASS (3.246.0, owner order 2026-09-24):
// 2 or 3 of the four pass survivors that beat that many, only with a positive
// average on the window; 4 of 4 is as it always was; the automatic pass passes
// a positive average on its own, never a negative one, never without the footing
module.exports.twoOrThreeOfTheFourPassOnlyWithAPositiveAverageAndTheAutomaticPassPassesOnOne = function () {
  const k10 = { kind: 'scrambles', k: 10, barPct: 80 };
  const r4 = V.declareRules(k10, {});
  assert.deepStrictEqual([r4.ofFour, r4.needsPositive, r4.autoPass, r4.tags.comparisons], [4, false, false, 'DERIVED'], 'the rules are looser than 4 of 4 when nothing was asked');
  const r3 = V.declareRules(k10, { ofFour: 3, autoPass: true });
  assert.deepStrictEqual([r3.ofFour, r3.needsPositive, r3.autoPass, r3.tags.comparisons, r3.tags.autoPass], [3, true, true, 'GUESSED', 'GUESSED']);
  assert.deepStrictEqual([V.declareRules(k10, { ofFour: 7 }).ofFour, V.declareRules(k10, { ofFour: '2' }).ofFour, V.declareRules(k10, { autoPass: 'yes' }).autoPass], [4, 2, false], 'anything but 2 or 3 is 4, and only a tick is a tick');
  // the survivors beat three of the four here (always long at 10 is out of their reach), and two below
  const list = rows(3, 10);
  const three = { ...CONTROLS, alwaysLong: { lo: 10, hi: 10 }, byKey: { 'all|41': { ...CONTROLS.byKey['all|41'], alwaysLong: 10 } } };
  const two = { ...three, buyHold: { lo: 10, hi: 10 }, byKey: { 'all|41': { ...three.byKey['all|41'], buyHold: 10 } } };
  assert.strictEqual(V.heldBackRead(list, three, r4).pass, false, '4 of 4 passed survivors that beat three');
  assert.strictEqual(V.heldBackRead(list, three, V.declareRules(k10, { ofFour: 3 })).pass, true, '3 of 4 failed survivors that beat three');
  assert.strictEqual(V.heldBackRead(list, two, V.declareRules(k10, { ofFour: 3 })).pass, false, '3 of 4 passed survivors that beat two');
  assert.strictEqual(V.heldBackRead(list, two, V.declareRules(k10, { ofFour: 2 })).pass, true, '2 of 4 failed survivors that beat two');
  // one survivor deep in the red: two still clear the bar, and the negative average sinks the looser rule
  const sunk = list.map((r, i) => (i === 2 ? { ...r, avgHold: -40 } : r));
  const loose = V.heldBackRead(sunk, three, V.declareRules({ ...k10, barPct: 50 }, { ofFour: 3 }));
  assert.deepStrictEqual({ clearing: loose.own.clearing, bar: loose.own.bar, positive: loose.own.positiveAverage, pass: loose.pass }, { clearing: 2, bar: 2, positive: false, pass: false }, 'a looser rule passed on a negative average');
  // the automatic pass: these survivors fail 4 of 4 and noise profits here, so nothing else would pass them
  const rules = V.declareRules(k10, { autoPass: true });
  const base = { rules, footing: { ok: true, had: 3 }, looks: { unstamped: 3 }, read: V.heldBackRead(list, two, rules), copies: V.copiesRead(list, rules), survivors: V.perSurvivor(list, rules), sanity: V.sanity(list, list, rules), lineA: V.lineA(list, rules), lineB: V.lineB(list, 3, rules) };
  const auto = V.buildBlock(base);
  assert.strictEqual(auto.verdict.pass, true, 'the automatic pass did not pass a positive average');
  assert.ok(/automatic pass on a positive average on the held-back window was ticked/.test(auto.verdict.sentence), auto.verdict.sentence);
  assert.strictEqual(V.buildBlock({ ...base, rules: { ...rules, autoPass: false } }).verdict.pass, false, 'the same reading passed without the tick');
  assert.strictEqual(V.buildBlock({ ...base, footing: { ok: false, why: 'gone' } }).verdict.pass, false, 'the automatic pass passed with the footing down');
  const red = list.map((r) => ({ ...r, avgHold: -1 }));
  assert.strictEqual(V.buildBlock({ ...base, read: V.heldBackRead(red, two, rules) }).verdict.pass, false, 'the automatic pass passed a negative average');
  // the sentence says the looser rule and whether its average held
  const s3 = V.buildBlock({ ...base, rules: V.declareRules(k10, { ofFour: 3 }), read: V.heldBackRead(list, three, V.declareRules(k10, { ofFour: 3 })) }).verdict.sentence;
  assert.ok(/beat at least 3 of the four comparisons/.test(s3) && /3 of 4 requires the survivors' average on the held-back window to be positive, and it was/.test(s3), s3);
};

// HELD AND RESERVE KEEP WHAT WAS PUT IN (3.246.0): the four pass criteria open
// on what was typed, keep it as it is typed, and go with the press; a held or
// reserve set read again keeps its own
module.exports.heldAndReserveKeepThePassCriteriaTypedAndSendThem = function () {
  const page = src('public/construct.js');
  const press = page.slice(page.indexOf('function vPressHtml(d, stretch) {'), page.indexOf('function vLinesHtml(b) {'));
  assert.ok(press.includes('const m = vPassKept(stretch);'), 'the press row does not open on what was put in');
  assert.ok(press.includes('const bar = typed(m.barPct) ? m.barPct : (Number(r.barPct) || 80);') && press.includes('const sanity = typed(m.sanityPct) ? m.sanityPct : (Number(r.sanityPct) || 50);'), 'bar share % or noise must lose at least % goes back to the defaults');
  assert.ok(/>comparisons to beat<select id="vOfFour"><option value="2"[^>]*>2 of 4<\/option><option value="3"[^>]*>3 of 4<\/option><option value="4"[^>]*>4 of 4<\/option><\/select>/.test(press), 'the comparisons box does not offer 2 of 4, 3 of 4 and 4 of 4');
  assert.ok(press.includes("'<b>requires + held back $ avg</b>'") && press.includes("'automatic pass on + held back $ avg'"), 'the flag or the tick is missing on Held');
  assert.ok(press.includes("'<b>requires + reserve $ avg</b>'") && press.includes("'automatic pass on + reserve $ avg'"), 'the flag or the tick is missing on Reserve');
  const keep = page.slice(page.indexOf('function vPassKeep(stretch) {'), page.indexOf('function vPressHtml(d, stretch) {'));
  assert.ok(keep.includes('localStorage.setItem(vPassKey(stretch), JSON.stringify(kept))'), 'what was put in is not kept');
  assert.ok(page.includes("for (const id of ['vBarPct', 'vSanityPct', 'vOfFour', 'vAutoPass']) {") && page.includes('      vPassKeep(stretch);'), 'the four controls do not keep what is put in as it is put in');
  assert.ok(page.includes("const body = { barPct: vTyped('#vBarPct'), sanityPct: vTyped('#vSanityPct'), ofFour: Number($('#vOfFour').value), autoPass: !!$('#vAutoPass').checked };"), 'the press does not send the comparisons box and the tick');
  assert.ok(src('lib/stages.js').includes('ofFour: r.ofFour ?? null, autoPass: r.autoPass === true };'), 'a held or reserve set read again forgets its criteria');
  const help = src('public/help-content.js');
  assert.ok(help.includes('        vOfFour: {') && help.includes('        vAutoPass: {'), 'the two new controls have no help');
};
