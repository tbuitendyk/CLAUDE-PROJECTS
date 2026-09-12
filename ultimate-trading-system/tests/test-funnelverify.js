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
    try { fs.rmSync(stages.funnelRichFile(id), { force: true }); } catch (_) { /* fixture */ }
    try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
    try { fs.rmSync(rowstore.storeDir(parentId), { recursive: true, force: true }); } catch (_) { /* fixture */ }
  };
  return { id, parentId, doc, t, units, keys, stamp, cleanup };
}
const RULE = { allowed: { gate: ['active'] } };
async function cutOn(f, extra = {}) {
  return stages.cutFunnelSet(f.id, { rule: RULE, closing: { key: 'rule' }, unit: f.keys[0], steps: [{ n: 1, what: 'kept gate active' }], backSteps: [{ from: 2, to: 1, why: 'a look back' }], marks: [{ key: 'spike', step: 2, detail: 'tHours' }], barPct: 80, ...extra });
}
// the press, started and polled until it lands
async function pressed(id, asked = {}) {
  stages.funnelVerifyStart(id, asked);
  for (let i = 0; i < 400; i++) {
    const st = stages.funnelVerifyStatus(id);
    if (st.error) throw new Error(st.error);
    if (st.result) return st.result;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error('the read did not land');
}
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
  si: i, label: `s${i}`, avgTest: 10 - i, avgHold: 5 - i * 0.5, avgTrades: 4, avgVsLong: 1, beat: 8, pairs: 12, avgLead: 1.2,
  noiseTest: Array.from({ length: K }, (_, d) => 8 - d * 0.1), noiseHold: Array.from({ length: K }, (_, d) => 4 - d * 0.1),
}));
const CONTROLS = { known: true, keys: ['all|41'], of: 1, missing: 0, alwaysLong: { lo: 3, hi: 3 }, alwaysShort: { lo: -4, hi: -4 }, buyHold: { lo: 2, hi: 2 }, shortHold: { lo: -3, hi: -3 } };

module.exports = {
  // THE RULES BLOCK IS WRITTEN BEFORE THE NUMBERS. In the press, the rules are
  // declared before the board is even loaded; on the block they are exactly what
  // declareRules said, and every reading takes them rather than a threshold of
  // its own.
  async theRulesBlockIsWrittenBeforeTheNumbers() {
    const s = src('lib/stages.js');
    const run = s.slice(s.indexOf('async function funnelVerifyRun('));
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
      const block = stages.getSet(doc.id).verify[0];
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
      const [later, first] = stages.getSet(doc.id).verify;
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
      const dry = await stages.funnelVerifyDry(doc.id);
      assert.ok(/does not give back its own survivors/.test(dry.refused || ''), `the dry read says why: ${dry.refused}`);
      assert.strictEqual(dry.footing.ok, false);
      let threw = null;
      try { await pressed(doc.id); } catch (e) { threw = e.message; }
      assert.ok(/does not give back its own survivors/.test(threw || ''), 'and the press refuses in the same words');
      assert.strictEqual((stages.getSet(doc.id).verify || []).length, 0, 'nothing was stamped');
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
      const dry = await stages.funnelVerifyDry(doc.id);
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
    const start = s.slice(s.indexOf('function funnelVerifyStart('), s.indexOf('function verifySummaryOf('));
    assert.ok(/const busy = verifyBusy\(\);\s*\n\s*if \(busy\) throw new Error/.test(start), 'the press must ask what is busy and refuse on it');
    const busy = s.slice(s.indexOf('const verifyBusy ='), s.indexOf('const verifyBusy =') + 200);
    assert.ok(/stageBusy\(\)/.test(busy), 'busy means a stage run, a totalling or a rebuild');
    const dry = s.slice(s.indexOf('async function funnelVerifyDry('), s.indexOf('async function funnelVerifyRun('));
    assert.ok(/const busy = verifyBusy\(\);/.test(dry) && /out\.refused = `\$\{busy\}/.test(dry), 'and the dry read says so before the button is pressed');
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
      const block = stages.getSet(doc.id).verify[0];
      assert.strictEqual(doc.counts.survivors, 2);
      assert.strictEqual(block.heldBack.of, 2);
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
      const dry = await stages.funnelVerifyDry(doc.id);
      assert.strictEqual(stages.getSet(doc.id).heldBackReadAt, null, 'nor is the dry read');
      assert.ok(dry.looks.unstamped >= 3, `the walk's looks are counted before any stamp: ${dry.looks.unstamped}`);
      await pressed(doc.id);
      const first = stages.getSet(doc.id).heldBackReadAt;
      assert.ok(first, 'the first press stamps it');
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      await pressed(doc.id);
      assert.strictEqual(stages.getSet(doc.id).heldBackReadAt, first, 'a later press leaves it exactly as it was');
      assert.strictEqual(stages.getSet(doc.id).verify[1].at, first, 'and it is the first block\'s own time');
    } finally { f.cleanup(); }
  },

  async everyPressAppendsABlockAndOverwritesNone() {
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      await pressed(doc.id);
      const one = JSON.parse(JSON.stringify(stages.getSet(doc.id).verify[0]));
      await pressed(doc.id, { barPct: 60 });
      const list = stages.getSet(doc.id).verify;
      assert.strictEqual(list.length, 2);
      assert.deepStrictEqual(list[1], one, 'the first block is untouched');
      assert.deepStrictEqual(list.map((b) => b.look), [2, 1], 'newest first, numbered');
      assert.deepStrictEqual(list.map((b) => b.id), [`${doc.id}-v2`, `${doc.id}-v1`]);
      assert.strictEqual(list[0].looks.stamped, 1, 'the second press knows one stamped look came before it');
      const dry = await stages.funnelVerifyDry(doc.id);
      assert.strictEqual(dry.blocks.length, 2, 'the dry read hands every block back');
      assert.deepStrictEqual(stages.verifySummaryOf(stages.getSet(doc.id)), { blocks: 2, at: one.at, pass: one.verdict.pass, release: one.release }, 'the list summary is the first block, the verdict');
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
    const block = V.buildBlock({ rules, footing: { ok: true, had: 3 }, looks: { unstamped: 3 }, heldBack: unknown, copies, survivors: V.perSurvivor(list, rules), sanity: sane, lineA: V.lineA(list, rules), lineB: V.lineB(list, 3, rules) });
    assert.strictEqual(block.verdict.pass, false, 'unknown never passes');
    assert.ok(/the four comparisons are not known/.test(block.verdict.sentence));
    const withKnown = V.buildBlock({ ...block, heldBack: known });
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
      const b = stages.getSet(doc.id).verify[0];
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
      assert.strictEqual(r.lead, F.leadOf(r.held, r.noiseHold || rows(1, 10)[0].noiseHold.map((v) => v)), 'the lead read here uses the sample spread');
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
      const b = stages.getSet(doc.id).verify[0];
      assert.deepStrictEqual(b.fee, { feePerLeg: 0.00125, feeUnits: 'fraction' }, 'under the name every downstream reader looks for');
      assert.deepStrictEqual({ sealed: b.windows.sealed.intact, from: b.windows.sealed.fromTs, chunks: b.windows.sealed.chunks }, { sealed: true, from: 1735689600000, chunks: 5 });
      assert.deepStrictEqual(b.windows.unread, { fromTs: 1735689600000, chunks: 5, seenToTs: 1736121600000 }, 'the unread window rides with its start and no end');
      assert.strictEqual(b.windows.hold.chunks, 48);
      assert.strictEqual(b.release, require('../package.json').version);
      assert.deepStrictEqual(b.marks.map((m) => m.key), ['spike'], 'the marks the walk carried ride on the block');
    } finally { f.cleanup(); }
  },

  drawVerifyPicksTheSetFromTheServersListNeverTyped() {
    const ui = src('public/construct.js');
    const draw = ui.slice(ui.indexOf('async function drawVerify()'), ui.indexOf('async function vFollow('));
    assert.ok(/api\/funnel\/sets/.test(draw), 'the list comes from the server');
    assert.ok(/<select id="vSet"/.test(ui) && !/<input id="vSet"/.test(ui), 'and is a box to pick from, never to type in');
    assert.ok(/vRememberedSet\(sets\)/.test(draw), 'the choice is remembered the way every page remembers its state');
    assert.ok(/list\.length \? list\[0\]\.id : null/.test(ui), 'with nothing remembered it opens on the newest');
  },

  theSurvivorsTableOnVerifyHasNoHeldBackSort() {
    const ui = src('public/construct.js');
    const table = ui.slice(ui.indexOf('function vSurvivorsTableHtml('), ui.indexOf('function vBlockHtml('));
    assert.ok(!/fcSort\(|bSortBtn\(|bRankSortBtn\(|data-sort|onclick/.test(table), 'no sorter on the table: a sort is a look');
    assert.ok(/There is no sort on this table: a sort is a look\./.test(table), 'and it says so');
    for (const word of ['avg held-back $', 'beat its own null set', 'null copies', 'lead', 'trades', 'vs always long $']) {
      assert.ok(table.includes(`>${word}</th>`), `the column is called ${word}, the Funnel's own word`);
    }
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
    const base = { rules, footing: { ok: true, had: 3 }, looks: { unstamped: 3 }, heldBack, copies, survivors: per, sanity: sane, lineA: V.lineA(list, rules), lineB: V.lineB(list, 3, rules) };
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
    const base = { rules, footing: { ok: true, had: 3 }, looks: { unstamped: 3 }, heldBack: V.heldBackRead(list, CONTROLS), copies: V.copiesRead(list, rules), survivors: V.perSurvivor(list, rules), sanity: sane, lineA: a, lineB: b };
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
      const dry = await stages.funnelVerifyDry(blend.id);
      assert.ok(/cut on all units together/.test(dry.refused) && /cut the rule on one unit on the Funnel/.test(dry.refused), dry.refused);
      let threw = null;
      try { stages.funnelVerifyStart(blend.id); } catch (e) { threw = e.message; }
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
    assert.ok(server.includes("app.get('/api/funnel/set/:id/verify'") && server.includes("app.post('/api/funnel/set/:id/verify'") && server.includes("app.get('/api/funnel/set/:id/verify/status'"), 'the three new doors exist');
    assert.ok(server.includes('verify: stages.verifySummaryOf(d),'), 'and the set list says whether a verdict is stamped');
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
      const b = stages.getSet(doc.id).verify[0];
      assert.strictEqual(b.rules.copies, 0);
      assert.strictEqual(b.copies.incomplete, true);
      assert.strictEqual(b.copies.pass, false);
      assert.strictEqual(b.sanity.known, false);
      assert.strictEqual(r.pass, false);
      assert.ok(/kept no scrambled copies, so nothing was read against nothing/.test(r.sentence), r.sentence);
      assert.strictEqual(b.heldBack.pass, true, 'the held-back read still stands on its own');
    } finally { f.cleanup(); }
  },

  // THE FIXTURE'S VERDICT, READ END TO END: the numbers a reader would work out
  // by hand from the rows on disk are the numbers on the block.
  async theVerdictOnTheFixtureIsWhatTheRowsSay() {
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      const dry = await stages.funnelVerifyDry(doc.id);
      assert.strictEqual(dry.refused, null, `nothing refuses: ${dry.refused}`);
      assert.deepStrictEqual({ same: dry.footing.same, had: dry.footing.had, gone: dry.footing.gone, keys: dry.footing.keys.ok, sealed: dry.footing.sealed.sealed, marks: dry.footing.marks }, { same: true, had: 2, gone: 0, keys: true, sealed: true, marks: 1 });
      assert.ok(!('heldBack' in dry) && !('copies' in dry), 'the dry read hands back no held-back figure');
      const r = await pressed(doc.id);
      const b = stages.getSet(doc.id).verify[0];
      // unit 0's two active settings: held-back 5 each; copies 4, 3.9, ... 3.1 -- all beaten
      assert.strictEqual(b.heldBack.real, 5);
      assert.deepStrictEqual({ beats: b.copies.beats, bar: b.copies.bar, pass: b.copies.pass }, { beats: 10, bar: 8, pass: true });
      assert.deepStrictEqual({ buy: b.heldBack.comparisons.beatsBuyHold, short: b.heldBack.comparisons.beatsShortHold, pass: b.heldBack.pass }, { buy: true, short: true, pass: true });
      // the board: 20 winning figures, 30 losing -- noise mostly loses
      assert.deepStrictEqual({ figures: b.sanity.board.figures, losing: b.sanity.board.losing, ok: b.sanity.ok }, { figures: 50, losing: 0.6, ok: true });
      assert.deepStrictEqual({ passing: b.survivors.passing, positive: b.survivors.positive, of: b.survivors.survivors }, { passing: 2, positive: 2, of: 2 });
      assert.strictEqual(b.lineB.n, 2);
      assert.strictEqual(r.pass, true);
      assert.strictEqual(b.looks.unstamped, 3, 'one step, one step back, and the cut view');
      assert.ok(b.looks.what.some((w) => /Boards offers a sort and a filter/.test(w)));
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
      const settings = {};
      for (const l of labels) settings[l] = { maxDrawdown: 50, units: { [f.keys[0]]: { maxDrawdown: 50 }, [f.keys[1]]: { maxDrawdown: 50 } } };
      fs.writeFileSync(stages.funnelRichFile(f.id), JSON.stringify({ v: stages.FUNNEL_RICH_V, savedAt: new Date().toISOString(), release: 'test', settings }));
      const doc = await cutOn(f, { rule: { allowed: { gate: ['active'] }, floors: { maxDrawdown: { max: 100 } } } });
      assert.strictEqual(doc.counts.survivors, 2);
      assert.deepStrictEqual(stages.getSet(doc.id).verify, [], 'a new set starts with an empty verify list');
      assert.strictEqual(doc.rich[doc.survivors[0].label].maxDrawdown, 50, 'the set keeps its own copy of the number the rule reads');
      fs.rmSync(stages.funnelRichFile(f.id), { force: true });      // the parent's file goes: a re-total, a deletion
      const dry = await stages.funnelVerifyDry(doc.id);
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
    const b = V.buildBlock({ rules, footing: { ok: true, had: 2 }, looks: { unstamped: 1 }, heldBack: V.heldBackRead(list, CONTROLS), copies: V.copiesRead(list, rules), survivors: V.perSurvivor(list, rules), sanity: V.sanity(list, list, rules), lineA: V.lineA(list, rules), lineB: V.lineB(list, 2, rules) });
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
      assert.deepStrictEqual(doc.others, [], 'a new set starts with no reading of the other units');
      assert.deepStrictEqual(doc.ride, [], 'and no ride');
      await pressed(doc.id);
      const before = stages.getSet(doc.id).verify[0];
      assert.strictEqual(before.others, null, 'nothing read yet, so the block says so');
      assert.ok(/the other units not read when this was stamped/.test(before.verdict.sentence), before.verdict.sentence);
      const got = await othersPressed(doc.id, {});
      assert.deepStrictEqual({ positive: got.positive, of: got.of, clearBar: got.clearBar, keepsNothing: got.keepsNothing, mark: got.mark, look: got.look },
        { positive: 1, of: 1, clearBar: 1, keepsNothing: 0, mark: null, look: 1 });
      const r1 = stages.getSet(doc.id).others[0];
      assert.strictEqual(r1.units.length, 1, 'the one other unit');
      const u = r1.units[0];
      assert.strictEqual(u.unit, f.keys[1]);
      assert.deepStrictEqual({ survivors: u.survivors, of: u.of, copies: u.copies, beats: u.beats, clears: u.clears, keepsNothing: u.keepsNothing }, { survivors: 2, of: 5, copies: 10, beats: 10, clears: true, keepsNothing: false });
      assert.ok(Math.abs(u.real - 2.5) < 1e-9, `the halved held-back money, ${u.real}`);
      assert.strictEqual(u.bar, F.barOf({ k: 10, barPct: 80 }), "the set's own share resolved on that unit's copy count");
      assert.strictEqual(r1.rules.tags.bar, 'DERIVED');
      assert.strictEqual(r1.release, require('../package.json').version);
      // a second press, under a typed bar, is a second reading and the first stays
      await othersPressed(doc.id, { barPct: 50 });
      const list = stages.getSet(doc.id).others;
      assert.strictEqual(list.length, 2, 'every press appends');
      assert.strictEqual(list[1].id, r1.id, 'and the first reading is still first');
      assert.deepStrictEqual({ pct: list[0].rules.barPct, tag: list[0].rules.tags.bar, look: list[0].look }, { pct: 50, tag: 'GUESSED', look: 2 });
      // the verdict stamped after it carries the newest reading and is not gated by it
      await pressed(doc.id);
      const after = stages.getSet(doc.id).verify[0];
      assert.deepStrictEqual({ positive: after.others.positive, of: after.others.of, clearBar: after.others.clearBar, look: after.others.look }, { positive: 1, of: 1, clearBar: 1, look: 2 });
      assert.ok(/1 of 1 other units positive on the held-back window, 1 clear the bar/.test(after.verdict.sentence), after.verdict.sentence);
      assert.ok(/information only/.test(after.verdict.sentence), 'and says it is information');
      assert.strictEqual(after.verdict.pass, before.verdict.pass, 'the reading never moves the verdict');
      // the dry read hands the list back, newest first
      const dry = await stages.funnelVerifyDry(doc.id);
      assert.strictEqual(dry.others.length, 2);
      assert.strictEqual(dry.others[0].look, 2);
      assert.strictEqual(dry.othersRefused, null);
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
    assert.deepStrictEqual(s1, { positive: 1, of: 3, clearBar: 1, keepsNothing: 1, mark: 'fewer than half of the 3 other units are positive on the held-back window' });
    const s2 = V.othersSummary([unit(true, true), unit(true, false), unit(false, false)]);
    assert.deepStrictEqual({ positive: s2.positive, of: s2.of, clearBar: s2.clearBar, mark: s2.mark }, { positive: 2, of: 3, clearBar: 1, mark: null });
    // exactly half is not fewer than half
    const s3 = V.othersSummary([unit(true, true), unit(false, false)]);
    assert.strictEqual(s3.mark, null);
    // nothing usable: no mark, and the counts say why
    const s4 = V.othersSummary([unit(false, false, true)]);
    assert.deepStrictEqual(s4, { positive: 0, of: 0, clearBar: 0, keepsNothing: 1, mark: null });
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
      const dry = await stages.funnelVerifyDry(doc.id);
      assert.ok(/the Funnel is reading the other units/.test(dry.othersRefused), dry.othersRefused);
      await settle(() => stages.funnelAcrossStatus(f.id));
      // then Verify's read: the Funnel's refuses, and so does the verdict press
      stages.funnelOthersStart(doc.id, {});
      threw = null;
      try { stages.funnelAcrossStart(f.id, { rule: { allowed: { gate: ['directional'] } }, unit: f.keys[0], barPct: 80 }); } catch (e) { threw = e.message; }
      assert.ok(threw && /are being read on Verify/.test(threw), threw);
      threw = null;
      try { stages.funnelVerifyStart(doc.id, {}); } catch (e) { threw = e.message; }
      assert.ok(threw && /are being read on Verify/.test(threw), threw);
      threw = null;
      try { stages.funnelRideStart(doc.id); } catch (e) { threw = e.message; }
      assert.ok(threw && /are being read on Verify/.test(threw), threw);
      // pressing again for the same set while it reads is the same reading, not a second
      const again = stages.funnelOthersStart(doc.id, {});
      assert.strictEqual(again.running, true);
      await settle(() => stages.funnelOthersStatus(doc.id));
      assert.strictEqual(stages.getSet(doc.id).others.length, 1, 'one reading, not two');
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
    assert.deepStrictEqual(r.hold, { money: -3, trades: 4, ...holdR }, "the held-back half is the worker's held-back half and the held-back money");
    assert.deepStrictEqual(r.test, { money: 10, trades: 6, ...testR }, 'beside the test half');
    // a unit with no held-back half keeps the shape with nothing in it
    const bare = V.rideOf(new Map([['s0', { label: 's0', units: [{ ...A, pnl: 1, trades: 1, holdout: null, rich: { test: testR, hold: null } }] }]]), { unitKey: keyOf(A), keyOf, labels: ['s0'] });
    assert.deepStrictEqual(bare.rows[0].hold, { money: null, trades: null, maxDrawdown: null, worstTrade: null, bestTrade: null, wins: null, stops: null, grossPerTrade: null, pnlThirds: null });
    // the press, read from the source
    const lib = src('lib/stages.js');
    const start = lib.slice(lib.indexOf('function funnelRideStart(id) {'), lib.indexOf('function funnelRideStatus(id) {'));
    assert.ok(/rebuildRichFor\(parent, labels, \{ unit: doc\.unit,/.test(start), 'the ride prices this unit only');
    assert.ok(!/saveFunnelRich\(/.test(start), "the ride never writes the parent's shared file");
    assert.ok(!/fresh\.rich\s*=/.test(start), "and never the set's copy of the test numbers");
    assert.ok(/fresh\.ride = \[rec, \.\.\.had\];/.test(start), 'every press appends');
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
      const dry0 = await stages.funnelVerifyDry(doc.id);
      assert.strictEqual(dry0.rideRefused, null, dry0.rideRefused);
      assert.strictEqual(dry0.looks.rides, 0);
      // a ride, as the press would write it, placed on the set
      const file = path.join(SETS_DIR, `${doc.id}.json`);
      const on = JSON.parse(fs.readFileSync(file, 'utf8'));
      on.ride = [{ id: `${doc.id}-r1`, at: new Date().toISOString(), release: '3.88.0', look: 1, unit: doc.unit, settings: 2, missing: [], failures: [], fields: V.RIDE_FIELDS, rows: [] }];
      fs.writeFileSync(file, JSON.stringify(on));
      const dry = await stages.funnelVerifyDry(doc.id);
      assert.strictEqual(dry.ride.length, 1);
      assert.strictEqual(dry.looks.rides, 1, 'the ride is a look');
      assert.ok(dry.looks.what.some((w) => /held-back ride was worked out 1 time\(s\)/.test(w)), dry.looks.what.join(' | '));
      await pressed(doc.id);
      const b = stages.getSet(doc.id).verify[0];
      assert.strictEqual(b.looks.rides, 1, 'and the block stamped after it counts it');
      // refusals in words
      const blend = await stages.cutFunnelSet(f.id, { rule: RULE, closing: { key: 'rule' }, unit: 'all' });
      let threw = null;
      try { stages.funnelRideStart(blend.id); } catch (e) { threw = e.message; }
      assert.ok(/cut on all units together/.test(threw), threw);
      const dryB = await stages.funnelVerifyDry(blend.id);
      assert.strictEqual(dryB.rideRefused, threw, 'the dry read says the same');
      assert.strictEqual(dryB.othersRefused, threw);
      const empty = await stages.cutFunnelSet(f.id, { rule: { allowed: { gate: ['nothing-of-the-kind'] } }, closing: { key: 'rule' }, unit: f.keys[0] });
      threw = null;
      try { stages.funnelRideStart(empty.id); } catch (e) { threw = e.message; }
      assert.ok(/wrote down no settings/.test(threw), threw);
    } finally { f.cleanup(); }
  },

  // THE SCREEN: the two presses are drawn by top-level helpers the word list
  // can walk, the ride's table has no sort, and both routes are served.
  theTwoNewPressesAreOnVerifyWithTheirRoutes() {
    const ui = src('public/construct.js');
    for (const fn of ['vOthersHtml', 'vRideHtml', 'vOthersFollow', 'vRideFollow']) assert.ok(new RegExp(`^(async )?function ${fn}\\(`, 'm').test(ui), `${fn} must be a top-level helper`);
    // RE-AIMED 3.100.0: the dropped-settings panel (V8) was added between them.
    // The property is unchanged -- every panel is drawn under the blocks -- so
    // the check is now per panel rather than on the two being adjacent.
    for (const fn of ['vOthersHtml', 'vDroppedHtml', 'vRideHtml']) {
      assert.ok(new RegExp(`\\$\\{${fn}\\(d\\)\\}`).test(ui), `${fn} is drawn under the blocks`);
    }
    assert.ok(/id="vOthers"/.test(ui) && /id="vRide"/.test(ui), 'the two presses');
    assert.ok(/api\/funnel\/set\/\$\{encodeURIComponent\(chosen\)\}\/others`, \{ barPct: vTyped\('#vBarPct'\) \}/.test(ui), 'the read of the other units is sent under the same bar box as the verdict');
    assert.ok(/api\/funnel\/set\/\$\{encodeURIComponent\(id\)\}\/others\/status/.test(ui) && /api\/funnel\/set\/\$\{encodeURIComponent\(id\)\}\/ride\/status/.test(ui), 'both are polled');
    const ride = ui.slice(ui.indexOf('function vRideHtml('), ui.indexOf('async function drawVerify('));
    assert.ok(!/data-sort|bRankSortBtn|sortBtn/.test(ride), "the ride's table has no sort: a sort is a look");
    assert.ok(/The other units:/.test(ui), 'the block prints the other units when read');
    const srv = src('server.js');
    for (const r of ['/api/funnel/set/:id/others', '/api/funnel/set/:id/others/status', '/api/funnel/set/:id/ride', '/api/funnel/set/:id/ride/status']) assert.ok(srv.includes(`'${r}'`), `${r} is served`);
    assert.ok(/funnelOthersStart\(req\.params\.id, req\.body \|\| \{\}\)/.test(srv), 'the read takes the typed bar');
  },
  // ---- the reserve grade on a Stage 4 record set (3.89.0): the refusals, in words ----
  // A later door refuses without a verdict block that PASSED under this release
  // line, on a set cut on all units together, and with the seal not intact; the
  // dry read says the same words the press throws. The pricing itself is
  // tests/test-unreadgrade.js's, on the fabricated coins.
  async theReserveGradeRefusesInWordsBeforeAnythingPrices() {
    const f = await fixture();
    try {
      const doc = await cutOn(f);
      assert.deepStrictEqual(doc.unread, [], 'a new set starts with no grade');
      // no verdict yet: refused, and the dry read agrees
      let threw = null;
      try { stages.unreadGradeStart(doc.id, {}); } catch (e) { threw = e.message; }
      assert.strictEqual(threw, stages.UNREAD_NO_PASS);
      assert.ok(/read the rule against nothing on Verify first/.test(threw), 'and it says what to do');
      let dry = await stages.unreadGradeDry(doc.id);
      assert.deepStrictEqual({ refused: dry.refused, gate: dry.gate, looks: dry.looks, intact: dry.sealed.intact }, { refused: stages.UNREAD_NO_PASS, gate: null, looks: 0, intact: true });
      // a verdict that FAILED is no gate either
      await pressed(doc.id, { barPct: 100 });
      const file = path.join(SETS_DIR, `${doc.id}.json`);
      let on = JSON.parse(fs.readFileSync(file, 'utf8'));
      on.verify[0].verdict.pass = false;
      fs.writeFileSync(file, JSON.stringify(on));
      assert.strictEqual(stages.unreadGateOf(stages.getSet(doc.id)), null, 'a FAIL is not a gate');
      // a PASS under another first digit is no gate; under this one it is
      on = JSON.parse(fs.readFileSync(file, 'utf8'));
      on.verify[0].verdict.pass = true;
      on.verify[0].release = '2.99.0';
      fs.writeFileSync(file, JSON.stringify(on));
      assert.strictEqual(stages.unreadGateOf(stages.getSet(doc.id)), null, 'a PASS under another first digit is not a gate');
      on.verify[0].release = require('../package.json').version;
      fs.writeFileSync(file, JSON.stringify(on));
      const gate = stages.unreadGateOf(stages.getSet(doc.id));
      assert.deepStrictEqual({ id: gate.id, look: gate.look }, { id: on.verify[0].id, look: 1 });
      dry = await stages.unreadGradeDry(doc.id);
      assert.strictEqual(dry.refused, null, dry.refused);
      // the seal not intact: refused in words that name it
      on.sealed = { units: [], why: 'a unit has no reserved window' };
      fs.writeFileSync(file, JSON.stringify(on));
      dry = await stages.unreadGradeDry(doc.id);
      assert.ok(/sealed window is not intact/.test(dry.refused), dry.refused);
      threw = null;
      try { stages.unreadGradeStart(doc.id, {}); } catch (e) { threw = e.message; }
      assert.strictEqual(threw, dry.refused);
      // a blend set: refused in the same words as the verdict
      const blend = await stages.cutFunnelSet(f.id, { rule: RULE, closing: { key: 'rule' }, unit: 'all' });
      threw = null;
      try { stages.unreadGradeStart(blend.id, {}); } catch (e) { threw = e.message; }
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
      let threw = null;
      try { await stages.stage4GreenlightSource(doc.id, {}); } catch (e) { threw = e.message; }
      assert.strictEqual(threw, stages.UNREAD_NO_PASS);
      let dry = await stages.stage4GreenlightDry(doc.id);
      assert.deepStrictEqual({ gate: dry.gate, refused: dry.refused, survivors: dry.survivors.length }, { gate: null, refused: stages.UNREAD_NO_PASS, survivors: 0 });
      // the gate opened by hand, as the reserve grade's tests open it
      await pressed(doc.id, { barPct: 100 });
      const file = path.join(SETS_DIR, `${doc.id}.json`);
      const on = JSON.parse(fs.readFileSync(file, 'utf8'));
      on.verify[0].verdict.pass = true;
      fs.writeFileSync(file, JSON.stringify(on));
      const src = await stages.stage4GreenlightSource(doc.id, {});
      assert.deepStrictEqual({ set: src.set.id, stage: src.set.stage, gate: src.gate.id, parent: src.set.parent.id, stage2: src.set.stage2.id }, { set: doc.id, stage: 4, gate: on.verify[0].id, parent: f.id, stage2: f.parentId });
      assert.deepStrictEqual(src.unit, { trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-1d' });
      assert.strictEqual(src.survivors.length, 2, 'every survivor, with its depth');
      assert.ok(src.survivors.every((x) => x.worst === 0), 'a rule of word dials puts every survivor at the middle');
      assert.deepStrictEqual({ by: src.pick.by, index: src.pick.index, label: src.pick.label, of: src.pick.of }, { by: 'depth', index: 0, label: src.survivors[0].label, of: 2 }, 'equal in depth: the first in the set\'s own order');
      assert.strictEqual(src.survivor.label, src.pick.label);
      assert.deepStrictEqual({ entry: src.survivor.entry, gate: src.survivor.gate, tHours: src.survivor.tHours, rule: src.survivor.agreeRule, pct: src.survivor.agreePct }, { entry: 'market', gate: 'active', tHours: 41, rule: 'share', pct: null });
      assert.strictEqual(src.survivor.bandPct, 2, 'an auto band resolves to the band the unit was priced at');
      assert.strictEqual(src.fee, 0.00125);
      assert.deepStrictEqual(src.readings.heldBack, { money: on.verify[0].survivors.rows[0].held, trades: on.verify[0].survivors.rows[0].trades }, 'the survivor\'s own held-back reading rides along');
      assert.strictEqual(src.readings.unread, null, 'no grade yet, no unread reading');
      assert.deepStrictEqual(src.training.windowLayout, 'reserve61');
      // a named pick, and an unknown name refused
      const named = await stages.stage4GreenlightSource(doc.id, { pick: src.survivors[1].label });
      assert.deepStrictEqual({ by: named.pick.by, index: named.pick.index, label: named.pick.label }, { by: 'named', index: 1, label: src.survivors[1].label });
      threw = null;
      try { await stages.stage4GreenlightSource(doc.id, { pick: 'no such setting' }); } catch (e) { threw = e.message; }
      assert.ok(/is not one of this set's 2 survivors/.test(threw), threw);
      // the dry read: this fixture's coin is read on its own, and the words say so
      dry = await stages.stage4GreenlightDry(doc.id);
      assert.ok(/a coin read on its own/.test(dry.refused), dry.refused);
      assert.deepStrictEqual({ size: dry.unitSize, depth: dry.depthPick.label, survivors: dry.survivors.length }, { size: 1, depth: src.pick.label, survivors: 2 });
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
    const rows = [{ avgHold: 10, avgTrades: 5, avgVsLong: 1 }];
    const four = (al, as, bh, sh) => ({
      known: true, keys: ['all|65'], of: 1, missing: 0,
      alwaysLong: { lo: al, hi: al }, alwaysShort: { lo: as, hi: as },
      buyHold: { lo: bh, hi: bh }, shortHold: { lo: sh, hi: sh },
    });
    // beats all four: the best of them is buying and going away at 4
    const win = V.heldBackRead(rows, four(1, 2, 4, 3));
    assert.deepStrictEqual({ key: win.comparisons.best.key, hi: win.comparisons.best.hi }, { key: 'buyHold', hi: 4 });
    assert.strictEqual(win.comparisons.beatsBest, true);
    assert.strictEqual(win.pass, true, 'beating every one of the four stands');
    // THE CASE THE OLD GATE MISSED: both one-trade comparisons beaten, and
    // being short every period made more than the rule did.
    const miss = V.heldBackRead(rows, four(1, 20, 4, 3));
    assert.strictEqual(miss.comparisons.beatsBuyHold, true, 'the old gate would have passed this');
    assert.strictEqual(miss.comparisons.beatsShortHold, true, 'and this');
    assert.strictEqual(miss.comparisons.beatsAlwaysShort, false, 'but being short every period made more');
    assert.strictEqual(miss.comparisons.best.key, 'alwaysShort');
    assert.strictEqual(miss.pass, false, 'the best of the four is what decides');
  },

  // A MISSING ONE OF THE FOUR IS UNKNOWN, AND UNKNOWN NEVER PASSES. Beating
  // three of four says nothing at all about the one nobody priced, so the best
  // of them cannot be named and there is no bar to clear.
  aMissingOneOfTheFourLeavesNoBestAndNothingPasses() {
    const rows = [{ avgHold: 10, avgTrades: 5, avgVsLong: 1 }];
    const r = V.heldBackRead(rows, {
      known: true, keys: ['all|65'], of: 1, missing: 0,
      alwaysLong: { lo: 1, hi: 1 }, buyHold: { lo: 1, hi: 1 }, shortHold: { lo: 1, hi: 1 },
    });
    assert.strictEqual(r.comparisons.best, null, 'three of four names no best');
    assert.strictEqual(r.comparisons.beatsBest, null);
    assert.strictEqual(r.pass, false, 'unknown never passes');
    assert.ok(/best of them is unknown/.test(V.verdict({ heldBack: r, footing: {}, copies: {}, survivors: {}, sanity: {} }).sentence),
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
    assert.ok(/^function heldBackPanel\(title, h, c\)/m.test(ui), 'one panel builder draws them');
    const uses = (ui.match(/heldBackPanel\('/g) || []).length;
    assert.strictEqual(uses, 2, 'the verdict and the reserve grade both use it, and nothing else writes its own');
    // the prose line and every part of it that flipped subject are gone
    assert.ok(!/against always long`/.test(ui), 'the against-always-long figure is off this line (owner, 2026-09-10)');
    assert.ok(!/beatsBuyHold \? 'beaten'/.test(ui), 'no screen marks a comparison from a stored flag');
    assert.ok(!/does not stand<\/b>'\}<\/p>/.test(ui), 'the stands / does not stand tail is gone with the sentence');
    // every column carries its subject in the heading
    for (const h of ['survivors', 'held-back \\$ a setting', 'trades a setting', 'no figure',
      'comparison', 'it made', 'rule ahead by', 'beaten by rule',
      'best of the four', 'rule ahead by it', 'this read']) {
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
  theDroppedPressIsOnVerifyWithItsRouteAndItsBox() {
    const ui = src('public/construct.js');
    assert.ok(/^function vDroppedHtml\(/m.test(ui), 'a top-level helper draws it');
    assert.ok(/id="vDropped"/.test(ui) && /id="vDroppedN"/.test(ui), 'the press and the how-many box');
    // RULE FOUR: the box, its label and the button are one control and line up
    const block = ui.slice(ui.indexOf('function vDroppedHtml('), ui.indexOf('function vOthersHtml('));
    assert.ok(/class="row" style="align-items:center"/.test(block), 'the box and the button share a baseline');
    assert.ok(!/data-sort|sortBtn/.test(block), 'no sort on it');
    assert.ok(/api\/funnel\/set\/\$\{encodeURIComponent\(chosen\)\}\/dropped`, \{ sample: vTyped\('#vDroppedN'\) \}/.test(ui), 'the typed count is sent');
    const srv = src('server.js');
    assert.ok(srv.includes("'/api/funnel/set/:id/dropped'"), 'the route is served');
    assert.ok(/funnelDroppedStart\(req\.params\.id, req\.body \|\| \{\}\)/.test(srv), 'and it takes the typed count');
  },
};
