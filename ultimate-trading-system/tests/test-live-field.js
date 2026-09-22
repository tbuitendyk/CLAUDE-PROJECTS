// THE FIELD ON THE LIVE PATH (FIELD-DESIGN.md section H, 3.213.0).
//
// A survivor priced under the field's gate on stage 3 is traded only with the
// field it was priced against. The greenlight door carries the field's dials
// and the gate into the configuration and refuses a set whose field cannot
// be read; the schema refuses a configuration whose field cannot be rebuilt;
// and at every decision the live path rebuilds the field from closed history
// with the lab's own engine, reads it on the decision's own day and gates the
// members' call -- a blocked call is no call, a placed one carries the rung's
// multiple into the clip. What the field said rides in the intent, the hash,
// the recompute, the decision record and the row on both books.
//
// The live decisions run on a fully fabricated three-coin combo with zero
// network and zero real-symbol cache contact, the way test-live-signal.js
// does; the symbols are this file's own reserved fakes and the cleanup
// removes exactly those files.
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mulberry32 } = require('../lib/rng');
const { buildCombo } = require('../lib/bracketwork');

process.env.GC_SETUPS_DIR = process.env.GC_SETUPS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'gc-field-'));
process.env.GC_GREENLIGHTS_DIR = process.env.GC_GREENLIGHTS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'gc-field-gl-'));

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'data', 'cache');
const SYMS = ['ZZZFAUSDT', 'ZZZFBUSDT', 'ZZZFCUSDT'];
const HOUR = 3600000;
const T0 = Date.UTC(2026, 0, 1);
const DAYS = 220;
const FREEZE = Date.UTC(2026, 5, 30, 23, 59, 59);

// the field's build dials and the gate, as a stage 3 record carries them
const DIALS = { windowDays: 60, halfLifeDays: 20, floor: 0.05, bands: [0.4, 0.8], lookbackHours: [24, 48, 72, 96], evidenceCap: 10, leastEvidence: 1, copies: 8 };
const GATE = { read: 'agreement', agreeMin: 0, certMin: null, rule: 'both', signOnly: false, rungs: '100:2', silent: 1 };

function writeFabricated(sym, seed) {
  const rng = mulberry32(seed);
  let price = 100;
  const byMonth = new Map();
  for (let h = 0; h < DAYS * 24; h++) {
    const ts = T0 + h * HOUR;
    const drift = (rng() - 0.5) * 0.01;
    const open = price;
    const close = Math.max(1, price * (1 + drift));
    const high = Math.max(open, close) * (1 + rng() * 0.004);
    const low = Math.min(open, close) * (1 - rng() * 0.004);
    price = close;
    const d = new Date(ts);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push({ ts, open, high, low, close, quoteVolume: 1000 + rng() * 500 });
  }
  fs.mkdirSync(CACHE, { recursive: true });
  for (const [month, rows] of byMonth) {
    fs.writeFileSync(path.join(CACHE, `${sym}-1h-${month}.json`), JSON.stringify(rows));
  }
}
function cleanup() {
  for (const sym of SYMS) {
    for (const f of fs.readdirSync(CACHE)) {
      if (f.startsWith(`${sym}-1h-`)) fs.rmSync(path.join(CACHE, f), { force: true });
    }
  }
}

const MEMBERS = [{ model: 'logreg', view: 'full' }, { model: 'logreg', view: 'prices' }, { model: 'logreg', view: 'volume' }, { model: 'logreg', view: 'pricevol' }, { model: 'logreg', view: 'cross' },
  { model: 'boost', view: 'full' }, { model: 'boost', view: 'prices' }, { model: 'boost', view: 'volume' }, { model: 'boost', view: 'pricevol' }, { model: 'boost', view: 'cross' }];
// the same members, the same agreement, the same version: the ONLY difference
// between the two configurations is the field, so the hash can prove it rides
const PLAIN_CONFIG = {
  engine: 'stages',
  combo: { trade: SYMS[0], ctx1: SYMS[1], ctx2: SYMS[2], size: 3 },
  branch: { geometry: 'daily-4d', decision: 'argmax', band: 0.4, weekdaysOnly: false },
  stage: 'stages',
  members: MEMBERS,
  cell: { quorum: null, entry: 'market', gate: 'directional', dMult: null, tHours: 137, trailMult: null, armMult: null },
  agreement: { rule: 'count', bar: 'all', pct: 50, copy: 98, both: false, persist: 0, rung: 5, members: 10, voices: null },
  training: { trainOn: 'direction', weightCap: null, windowLayout: 'reserve61', startMonth: '2026-01', endMonth: '2026-08', allLoaded: false, nullN: 9 },
  configVersion: 'zzzf-field-v1-test',
};
const FIELD_CONFIG = { ...PLAIN_CONFIG, field: { id: 'F-test', name: 'a test field', dials: DIALS, gate: GATE } };
const PLAIN_SETUP = { id: 'field-test-plain', state: 'live', clipUsd: 10, stopPct: null, configSnapshot: PLAIN_CONFIG, trainPolicy: { mode: 'frozen', throughMs: FREEZE } };
const FIELD_SETUP = { ...PLAIN_SETUP, id: 'field-test-gated', configSnapshot: FIELD_CONFIG };

let planted = false;
let comboCache = null;
async function withData() {
  if (!planted) { SYMS.forEach((s, i) => writeFabricated(s, 4321 + i)); planted = true; }
  if (!comboCache) {
    comboCache = await buildCombo(PLAIN_CONFIG.combo, PLAIN_CONFIG.branch, { allLoaded: true, feePerLeg: 0, includeUnlabeled: true });
  }
  return comboCache;
}

// ---- THE GREENLIGHT DOOR ----
module.exports.aSurvivorPricedUnderTheFieldIsTradedOnlyWithItsField = function () {
  const gl = require('../lib/live/greenlight');
  const { validateConfig } = require('../lib/live/configschema');
  const { aStage4Source } = require('./fixtures-setup');
  const gate = { read: 'certainty', agreeMin: null, certMin: 55, rule: 'both', signOnly: false, rungs: '70:1, 100:2', silent: 1 };
  const dials = { windowDays: 400, halfLifeDays: 90, floor: 0.05, bands: [0.4, 0.8, 1.2], lookbackHours: [24, 72, 168], evidenceCap: 20, leastEvidence: 2, copies: 20 };
  // the survivor as a stage 3 record carries it: the gate and its numbers
  const priced = (over) => aStage4Source({ survivor: { ...aStage4Source().survivor, field: { ...gate, test: { placed: 1 }, hold: null } }, ...over });
  // no field beside the set: refused in words, never traded at size 1
  assert.match(gl.stage4Refusal(priced({ field: null })), /priced under the field's gate, and the stage 3 set carries no field for it — the live path cannot rebuild what was priced/);
  // the series frozen beside the set gone: the set's own words for it
  const gone = { id: 'F-3', name: 'x', error: 'the field F-3 frozen beside S3 #9 cannot be read for LTCUSDT daily-4d' };
  assert.match(gl.stage4Refusal(priced({ field: gone })), /the field F-3 frozen beside S3 #9 cannot be read for LTCUSDT daily-4d — the live path cannot rebuild/);
  assert.throws(() => gl.configFromStage4(priced({ field: gone })), /cannot rebuild what was priced/);
  // with the field: the configuration carries the field named, this pair's
  // own dials, and the gate exactly as the survivor was priced under it
  const src = priced({ field: { id: 'F-3', name: 'x', pairKey: 'LTCUSDT|daily-4d', dials } });
  assert.strictEqual(gl.stage4Refusal(src), null);
  const cfg = gl.configFromStage4(src);
  assert.deepStrictEqual(cfg.field, { id: 'F-3', name: 'x', dials, gate: { read: 'certainty', agreeMin: null, certMin: 55, rule: 'both', signOnly: false, rungs: '70:1, 100:2', silent: 1 } });
  assert.strictEqual(validateConfig(cfg).ok, true, validateConfig(cfg).errors.join('; '));
  // a survivor priced without one carries none, and a field beside the set
  // does not attach itself to a survivor that was not priced under it
  assert.strictEqual(gl.configFromStage4(aStage4Source({ field: { id: 'F-3', name: 'x', dials } })).field, null);
  assert.strictEqual(gl.configFromStage4(aStage4Source()).field, null);
};

// ---- THE SCHEMA ----
module.exports.theSchemaRefusesAFieldThatCannotBeRebuilt = function () {
  const { validateConfig } = require('../lib/live/configschema');
  const { aSetupConfig } = require('./fixtures-setup');
  const good = aSetupConfig({ field: { id: 'F-1', name: null, dials: DIALS, gate: GATE } });
  assert.strictEqual(validateConfig(good).ok, true, validateConfig(good).errors.join('; '));
  assert.strictEqual(validateConfig(aSetupConfig({ field: null })).ok, true, 'no field is every configuration written before it');
  const bad = (field, re) => {
    const v = validateConfig({ ...good, field });
    assert.strictEqual(v.ok, false, `expected a refusal for ${JSON.stringify(field).slice(0, 80)}`);
    assert.ok(v.errors.some((e) => re.test(e)), `expected ${re} among: ${v.errors.join('; ')}`);
  };
  bad('F-1', /^field: must be an object or absent/);
  bad({ ...good.field, id: '' }, /^field\.id: must name the field/);
  bad({ ...good.field, dials: { ...DIALS, windowDays: 0 } }, /^field\.dials: window, days must be at least 1/);
  bad({ ...good.field, dials: { ...DIALS, lookbackHours: [] } }, /^field\.dials: look-backs is empty/);
  bad({ ...good.field, gate: { ...GATE, rungs: '' } }, /^field\.gate: size rungs is empty/);
  bad({ ...good.field, gate: { ...GATE, read: 'mood' } }, /^field\.gate: "mood" is not a way to read the field/);
  bad({ ...good.field, gate: { ...GATE, agreeMin: 101 } }, /^field\.gate: agreement minimum: a read is 0 to 100/);
  bad({ ...good.field, gate: { ...GATE, rule: 'most' } }, /^field\.gate: "most" is not a way to combine the minimums/);
};

// ---- THE DECISION ----
module.exports.theFieldGatesTheCallAndSizesTheClipOnBothBooksAndTheRecomputeMatches = async function () {
  const signal = require('../lib/live/signal');
  const { validateConfig } = require('../lib/live/configschema');
  assert.strictEqual(validateConfig(FIELD_CONFIG).ok, true, validateConfig(FIELD_CONFIG).errors.join('; '));
  const { geo, maps, chunks } = await withData();
  const entryMs = (geo.entryOffsetH || 0) * HOUR;
  const targets = chunks.filter((c) => maps.trade.get(c.startTs + entryMs) && c.startTs > FREEZE)
    .sort((a, b) => a.startTs - b.startTs);
  assert.ok(targets.length > 10, `need post-freeze chunks with cached entry bars, got ${targets.length}`);
  let placed = null; let blocked = null; let noCall = null;
  for (const t of targets.slice(0, 40)) {
    const now = t.startTs + entryMs + 60000;
    const plain = await signal.computeSignal(PLAIN_SETUP, now);
    const gated = await signal.computeSignal(FIELD_SETUP, now);
    assert.ok(plain.ok && plain.actionable, `plain: ${JSON.stringify(plain).slice(0, 200)}`);
    assert.ok(gated.ok && gated.actionable, `gated: ${JSON.stringify(gated).slice(0, 200)}`);
    const f = gated.intent.field;
    assert.ok(f && f.id === 'F-test' && f.read === 'agreement', `the intent carries what the field said: ${JSON.stringify(f)}`);
    assert.ok([-1, 0, 1].includes(f.sign) && typeof f.why === 'string' && Number.isFinite(f.size), JSON.stringify(f));
    assert.strictEqual(plain.intent.field, null, 'a configuration priced without a field carries none');
    assert.deepStrictEqual(gated.intent.per_member, plain.intent.per_member, 'the members vote the same with or without the field');
    assert.deepStrictEqual(gated.intent.agreement, plain.intent.agreement, 'and their agreement reads the same');
    assert.strictEqual(plain.intent.clip_usd, 10, 'no field, the standard clip');
    if (plain.intent.side === 'FLAT') {
      // nothing to gate
      assert.strictEqual(gated.intent.side, 'FLAT');
      assert.strictEqual(f.why, 'no call');
      assert.strictEqual(f.size, 0);
      assert.strictEqual(gated.intent.clip_usd, 10);
      noCall = noCall || { t, gated };
    } else if (f.size > 0) {
      // placed: the members' own call, at the rung's multiple of the clip
      assert.strictEqual(gated.intent.side, plain.intent.side, 'a placed call is the members\' own');
      assert.ok(/^sized: agreement \d+ on the rung ×2$/.test(f.why) || f.why === 'silent', f.why);
      assert.strictEqual(f.size, f.why === 'silent' ? 1 : 2, f.why);
      assert.strictEqual(gated.intent.clip_usd, Math.round(10 * f.size * 100) / 100, 'the clip is the standard clip times the rung');
      assert.notStrictEqual(gated.intent.input_hash, plain.intent.input_hash, 'what the field said rides in the hash');
      placed = placed || { t, gated, plain };
    } else {
      // blocked: no call, the standard clip untouched
      assert.strictEqual(gated.intent.side, 'FLAT', `a blocked call is no call: ${f.why}`);
      assert.match(f.why, /^blocked by sign$/, 'with the minimum at 0 only the sign can block');
      assert.strictEqual(gated.intent.clip_usd, 10);
      blocked = blocked || { t, gated, plain };
    }
    if (placed && blocked) break;
  }
  assert.ok(placed, 'no decision in forty was placed under the gate');
  assert.ok(blocked, 'no decision in forty was blocked by the field\'s sign');
  for (const one of [placed, blocked]) {
    // the recompute of the same chunk says the same, field for field
    const re = await signal.computeSignalForChunk(FIELD_SETUP, one.t.startTs);
    assert.ok(re.found);
    assert.strictEqual(re.side, one.gated.intent.side);
    assert.strictEqual(re.input_hash, one.gated.intent.input_hash);
    assert.deepStrictEqual(re.field, one.gated.intent.field);
    // and Paper Books reads exactly what Live Trading reads (RULE TWO)
    const paper = await signal.computeSignal({ ...FIELD_SETUP, state: 'paper' }, one.t.startTs + entryMs + 60000);
    assert.ok(paper.ok && paper.actionable);
    assert.strictEqual(paper.intent.paper, true);
    assert.deepStrictEqual(paper.intent.field, one.gated.intent.field);
    assert.strictEqual(paper.intent.side, one.gated.intent.side);
    assert.strictEqual(paper.intent.clip_usd, one.gated.intent.clip_usd);
  }
  // the preview speaks the field too
  const pv = await signal.computePreview(FIELD_SETUP, placed.t.startTs + geo.featureHours * HOUR + 60000);
  assert.ok(pv.available, JSON.stringify(pv).slice(0, 200));
  assert.deepStrictEqual(pv.field, placed.gated.intent.field);
  assert.strictEqual(pv.side, placed.gated.intent.side);
  // the day the field was read is the decision's own day, and it was full
  assert.strictEqual(placed.gated.intent.field.day, new Date(placed.gated.intent.field.day).toISOString());
  assert.strictEqual(placed.gated.intent.field.full, true, 'sixty days of window inside two hundred of history');
};

// ---- THE BOX'S CEILING ----
module.exports.theBoxCeilingIsTheClipTimesTheLargestMultipleTheGateCanGive = function () {
  const { largestMultipleOf } = require('../lib/fieldlive');
  assert.strictEqual(largestMultipleOf(null), 1, 'no field, the clip itself');
  assert.strictEqual(largestMultipleOf({ id: 'F-1' }), 1);
  assert.strictEqual(largestMultipleOf({ gate: { rungs: '70:1, 100:2', silent: 1 } }), 2);
  assert.strictEqual(largestMultipleOf({ gate: { rungs: '60:0.5, 80:1, 100:1.5', silent: 3 } }), 3, 'a silent multiple above every rung is the ceiling');
  assert.strictEqual(largestMultipleOf({ gate: { rungs: '100:0.5', silent: 0.5 } }), 1, 'never below the clip itself');
  // the allowlist the box pins every intent against is written from it
  const src = fs.readFileSync(path.join(ROOT, 'live-produce.js'), 'utf8');
  assert.ok(src.includes("      max_clip_usd: Math.round(s.clipUsd * require('./lib/fieldlive').largestMultipleOf((s.configSnapshot || {}).field) * 100) / 100,"),
    'the allowlist ceiling is the clip times the largest multiple the gate can give');
  assert.ok(src.includes('              field: out.intent.field || null,\n              clip_usd: out.intent.clip_usd,'),
    'the decision record carries what the field said and the clip it gave');
};

// ---- THE ROW ON BOTH BOOKS ----
module.exports.theDecisionRowCarriesWhatTheFieldSaidOnBothBooks = function () {
  const view = require('../lib/live/view');
  const said = { id: 'F-1', read: 'agreement', sign: 1, agreement: 71.5, certainty: 60, speaking: 6, day: '2026-07-05T00:00:00.000Z', full: true, size: 2, why: 'sized: agreement 72 on the rung ×2' };
  const held = { ...said, sign: -1, size: 0, why: 'blocked by sign' };
  const out = view.deriveSetup([
    { event: 'INTENT_SEEN', setup_id: 's1', chunk_start: '2026-07-01T00:00:00.000Z', utc: '2026-07-05T01:00:00.000Z', side: 'LONG', per_member: [1, 1, -1], field: said },
    { event: 'INTENT_SEEN', setup_id: 's1', chunk_start: '2026-06-30T00:00:00.000Z', utc: '2026-07-04T01:00:00.000Z', side: 'LONG', per_member: [1, 1, -1] },
  ], 's1', [
    { chunk_start: '2026-07-02T00:00:00.000Z', produced_utc: '2026-07-06T01:00:00.000Z', side: 'FLAT', per_member: [1, 1, 1], field: held },
  ]);
  const row = (cs) => out.decisions.find((d) => d.chunk_start === cs);
  assert.deepStrictEqual(row('2026-07-01T00:00:00.000Z').field, said, 'the journal\'s decision carries what the field said');
  assert.deepStrictEqual(row('2026-07-02T00:00:00.000Z').field, held, 'and so does a decision from the profile\'s own log');
  assert.strictEqual(row('2026-06-30T00:00:00.000Z').field, null, 'a decision made without a field carries none');
  // the page draws it through the ONE decision table both books share
  const page = fs.readFileSync(path.join(ROOT, 'public', 'trade.html'), 'utf8');
  assert.strictEqual(page.split('Daily decision history').length - 1, 1, 'one decision table, drawn for both books');
  assert.ok(page.includes("${th('field','field','text-align:left')}"), 'the field heading, described');
  assert.ok(page.includes("${th('outcome','outcome','text-align:left')}") && !page.includes("th('outcome','fate'"), 'the outcome heading, described: its hover is keyed to the column key');
  assert.ok(/^  field:'what the coin’s own decision field said on this decision and what its gate made of the call\./m.test(page), 'its description in the column key');
  assert.ok(page.includes('const f=dec.field;'), 'the cell reads the row\'s field');
  assert.ok(page.includes('<td colspan="6" class="empty">no decisions recorded yet</td>'), 'the empty row spans the six columns');
  assert.ok(page.includes('<b>field</b> = what the coin’s decision field said and what its gate made of the call'), 'the legend names it');
  // and the anatomy says what the field does to the call
  const an = require('../lib/live/anatomy');
  const { aSetupConfig } = require('./fixtures-setup');
  const words = an.describeAnatomy(aSetupConfig({ field: { id: 'F-1', name: 'the test field', dials: DIALS, gate: GATE } }), {});
  const step = words.pipeline.find((s) => /^4b\. THE FIELD/.test(s));
  assert.ok(step, 'the pipeline has the field\'s step');
  assert.ok(/F-1, the test field/.test(step) && /window of 60 days, half-life 20 days/.test(step) && /BLOCKED when its agreement is below 0/.test(step) && /\(100:2,/.test(step) && /trades at 1× the clip/.test(step), step);
  const plain = an.describeAnatomy(aSetupConfig(), {});
  assert.ok(!plain.pipeline.some((s) => /THE FIELD/.test(s)), 'no field, no step');
};

// ---- THE LAST DAY (owner, 2026-09-21: "why does this show 09/19 as the last
// day") -- with candles through 23:00 on the 20th the field must reach the
// decision taken on the 20th, whose chunk has not closed, on Coins and on the
// live path alike. 3.212.1 asked the reader to keep unclosed decisions and the
// reader dropped every one of them, because the chunk builder hands an
// unclosed chunk over without its prices and the reader skipped on that.
module.exports.theFieldReachesTheLastDecisionTheCandlesReach = function () {
  const wm = require('../lib/windowmove');
  const fieldrun = require('../lib/fieldrun');
  const fieldlive = require('../lib/fieldlive');
  const { GEOMETRIES } = require('../lib/dataset');
  const map = new Map();
  const T0 = Date.UTC(2026, 6, 23);                       // sixty days of candles ...
  const lastCandle = Date.UTC(2026, 8, 20, 23);           // ... through 23:00 UTC on 2026-09-20
  for (let h = 0; h < 60 * 24; h++) {
    const ts = T0 + h * HOUR;
    const p = 100 + Math.sin(h / 7) * 3 + Math.cos(h / 31) * 2;
    map.set(ts, { ts, open: p, high: p + 1, low: p - 1, close: p + 0.2, quoteVolume: 1000 });
  }
  assert.strictEqual([...map.keys()].pop(), lastCandle);
  const decisionOn20th = Date.UTC(2026, 8, 20, 1);
  const dials = { windowDays: 30, halfLifeDays: 10, floor: 0.05, bands: [0.5, 1], lookbackHours: [24, 48], evidenceCap: 10, leastEvidence: 1, copies: 4 };
  for (const [geometry, lastStart] of [['daily-3d', Date.UTC(2026, 8, 17)], ['daily-4d', Date.UTC(2026, 8, 16)]]) {
    const geo = GEOMETRIES[geometry];
    const closed = wm.windowMoves(map, geometry, [24], {});
    const kept = wm.windowMoves(map, geometry, [24], { keepUnclosed: true });
    // the walk and stage 3 read closed outcomes only, exactly as they always did
    assert.ok(closed.ts[closed.ts.length - 1] + geo.exitOffsetH * HOUR <= lastCandle, `${geometry}: closed only`);
    assert.ok(closed.out.every((o) => o != null));
    // the field reads every decision the candles reach: the newest is the one
    // decided at 01:00 on the 20th, whose exit is days away
    assert.strictEqual(kept.ts[kept.ts.length - 1], lastStart, `${geometry}: the last decision is the last whose decision candle is on file`);
    assert.strictEqual(wm.decisionAt(map, lastStart, geo).ts, decisionOn20th);
    assert.ok(kept.periods > closed.periods, `${geometry}: the unclosed decisions are kept`);
    assert.strictEqual(kept.out.filter((o) => o == null).length, kept.periods - closed.periods, 'unclosed means no outcome, never an invented one');
    assert.deepStrictEqual(kept.out.slice(0, closed.periods), closed.out, 'the closed decisions read exactly as before');
    assert.deepStrictEqual(kept.ts.slice(0, closed.periods), closed.ts);
    // through the build's own input (what Coins builds and shows as last day)
    const input = fieldrun.inputFor(map, geometry, [24, 48], { keepUnclosed: true });
    assert.strictEqual(input.decisionTs[input.decisionTs.length - 1], decisionOn20th, `${geometry}: the build reaches the 20th`);
    assert.ok(input.closeTs[input.closeTs.length - 1] > lastCandle, 'and knows its chunk has not closed');
    // and on the live path, deciding that very chunk: the field has a day for it
    const got = fieldlive.fieldAtDecision(map, geometry, dials, GATE, lastStart, 1, 'x');
    assert.strictEqual(got.day, decisionOn20th, `${geometry}: the live path reads the field on the day it is deciding`);
    assert.strictEqual(got.lastDay, decisionOn20th);
    assert.strictEqual(got.full, true, 'thirty days of window inside sixty of candles');
    assert.ok(!/no day/.test(got.why), got.why);
  }
};

// ---- THE FIELD AS THE CALL (3.221.0, FIELD-DESIGN.md section N; owner: "use
// the coin field as a completely independent trade trigger") -- under quorum
// by field the live path's call is the field's own sign at the moment decided,
// read exactly as the gate reads it; the members are trained and recorded
// beside it; the schema and the decision both refuse a setup under the rule
// that names no field; Trade and the anatomy say what the rule does.
module.exports.theFieldsOwnSignIsTheCallUnderQuorumByField = async function () {
  const fieldlive = require('../lib/fieldlive');
  const agreement = require('../lib/agreement');
  const wm = require('../lib/windowmove');
  const { validateConfig } = require('../lib/live/configschema');
  const an = require('../lib/live/anatomy');
  const signal = require('../lib/live/signal');
  // the sign at each of several moments is the sign the gate reads at each one
  const map = new Map();
  const start = Date.UTC(2026, 6, 23);
  for (let h = 0; h < 60 * 24; h++) {
    const ts = start + h * HOUR;
    const p = 100 + Math.sin(h / 7) * 3 + Math.cos(h / 31) * 2;
    map.set(ts, { ts, open: p, high: p + 1, low: p - 1, close: p + 0.2, quoteVolume: 1000 });
  }
  const dials = { windowDays: 30, halfLifeDays: 10, floor: 0.05, bands: [0.5, 1], lookbackHours: [24, 48], evidenceCap: 10, leastEvidence: 1, copies: 4 };
  const starts = wm.windowMoves(map, 'daily-3d', [24], { keepUnclosed: true }).ts.slice(-12);
  const signs = fieldlive.fieldSignsAt(map, 'daily-3d', dials, starts, 'x');
  assert.strictEqual(signs.length, 12, 'one sign per moment, in order');
  let spoke = 0;
  starts.forEach((startTs, i) => {
    const one = fieldlive.fieldAtDecision(map, 'daily-3d', dials, GATE, startTs, 1, 'x');
    const expect = one.day != null && one.speaking && (one.sign === 1 || one.sign === -1) ? one.sign : 0;
    assert.strictEqual(signs[i], expect, `moment ${i}: the sign taken as the call must be the sign the gate reads`);
    if (expect) spoke++;
  });
  assert.ok(spoke > 0, 'the fixture is wrong if the field speaks on none of the last twelve days');
  assert.deepStrictEqual(fieldlive.fieldSignsAt(map, 'daily-3d', dials, [start - 24 * HOUR], 'x'), [0], 'a moment the field has no day for is no call');
  assert.deepStrictEqual(agreement.agreementStream({ calls: [], fieldSigns: signs }, 'field', null, {}), signs, 'the stream the live path reads is the engine\'s own');
  // the schema: a configuration under the rule carries a field, or it is refused
  const underField = (cfg) => ({ ...cfg, agreement: { ...cfg.agreement, rule: 'field', bar: null, pct: null } });
  assert.strictEqual(validateConfig(underField(FIELD_CONFIG)).ok, true, validateConfig(underField(FIELD_CONFIG)).errors.join('; '));
  const noField = validateConfig(underField(PLAIN_CONFIG));
  assert.strictEqual(noField.ok, false, 'a configuration under quorum by field with no field passed the schema');
  assert.ok(noField.errors.some((e) => e === 'agreement.rule: field reads the field alone, and this configuration names no field'), noField.errors.join('; '));
  // the anatomy says what the rule does, in the engine's own words
  const step = an.describeAnatomy(underField(FIELD_CONFIG), {}).pipeline.find((s) => /^4\. COMMITTEE/.test(s));
  assert.ok(/the field alone: on every day the field speaks, its sign is the call and the members are not read; no bar: the field's own sign is the call, and the members are not read/.test(step), step);
  // and Trade prints no bar for it, on both books through the one function
  const page = fs.readFileSync(path.join(ROOT, 'public', 'trade.html'), 'utf8');
  assert.ok(page.includes("const bar=(a.rule==='trained'||a.rule==='field')?'no bar':"), 'the setup detail prints a bar for a rule that reads none');
  // THE DECISION on the fabricated combo: the call is the field's own sign,
  // the members are recorded beside it, the gate sizes it, and the recompute
  // and Paper Books read the same
  const { geo, maps, chunks } = await withData();
  const entryMs = (geo.entryOffsetH || 0) * HOUR;
  const targets = chunks.filter((c) => maps.trade.get(c.startTs + entryMs) && c.startTs > FREEZE).sort((a, b) => a.startTs - b.startTs);
  const setup = { ...FIELD_SETUP, id: 'field-test-rule', configSnapshot: underField(FIELD_CONFIG) };
  let placed = null;
  for (const t of targets.slice(0, 40)) {
    const got = await signal.computeSignal(setup, t.startTs + entryMs + 60000);
    assert.ok(got.ok && got.actionable, JSON.stringify(got).slice(0, 200));
    const f = got.intent.field;
    assert.ok(Array.isArray(got.intent.per_member) && got.intent.per_member.length === MEMBERS.length, 'the members still vote and are recorded beside the field');
    assert.notStrictEqual(f.why, 'blocked by sign', 'the field cannot disagree with its own sign');
    if (f.sign === 1 || f.sign === -1) {
      assert.ok(f.size > 0, `with the minimum at 0 the field's own call is sized, never blocked: ${JSON.stringify(f)}`);
      assert.strictEqual(got.intent.side, f.sign === 1 ? 'LONG' : 'SHORT', `the call is the field's own sign: ${JSON.stringify(f)}`);
      placed = { t, got };
      break;
    }
    assert.strictEqual(got.intent.side, 'FLAT', `no sign, no call: ${JSON.stringify(f)}`);
    assert.strictEqual(f.why, 'no call');
  }
  assert.ok(placed, 'no decision in forty was placed under the field\'s own sign');
  const re = await signal.computeSignalForChunk(setup, placed.t.startTs);
  assert.ok(re.found);
  assert.strictEqual(re.side, placed.got.intent.side);
  assert.strictEqual(re.input_hash, placed.got.intent.input_hash);
  const paper = await signal.computeSignal({ ...setup, state: 'paper' }, placed.t.startTs + entryMs + 60000);
  assert.ok(paper.ok && paper.actionable);
  assert.strictEqual(paper.intent.side, placed.got.intent.side, 'Paper Books reads what Live Trading reads (RULE TWO)');
  assert.deepStrictEqual(paper.intent.field, placed.got.intent.field);
  // a setup under the rule with no field is refused, never decided by the members
  let bare;
  try {
    bare = await signal.computeSignal({ ...PLAIN_SETUP, id: 'field-test-rule-bare', configSnapshot: underField(PLAIN_CONFIG) }, targets[0].startTs + entryMs + 60000);
  } catch (err) { bare = { ok: false, error: err.message }; }
  assert.ok(!(bare.ok && bare.actionable) && /names no field/.test(JSON.stringify(bare)), JSON.stringify(bare).slice(0, 300));
};

module.exports.zzz_cleanupFabricatedSymbols = function () {
  cleanup();
  for (const sym of SYMS) {
    const left = fs.readdirSync(CACHE).filter((f) => f.startsWith(`${sym}-1h-`));
    assert.strictEqual(left.length, 0, `no ${sym} files left behind`);
  }
};
