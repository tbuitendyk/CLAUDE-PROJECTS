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
const GATE = { read: 'agreement', minimum: 0, signOnly: false, rungs: '100:2', silent: 1 };

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
  const gate = { read: 'certainty', minimum: 55, signOnly: false, rungs: '70:1, 100:2', silent: 1 };
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
  assert.deepStrictEqual(cfg.field, { id: 'F-3', name: 'x', dials, gate: { read: 'certainty', minimum: 55, signOnly: false, rungs: '70:1, 100:2', silent: 1 } });
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
  bad({ ...good.field, gate: { ...GATE, minimum: 101 } }, /^field\.gate: minimum: a read is 0 to 100/);
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

module.exports.zzz_cleanupFabricatedSymbols = function () {
  cleanup();
  for (const sym of SYMS) {
    const left = fs.readdirSync(CACHE).filter((f) => f.startsWith(`${sym}-1h-`));
    assert.strictEqual(left.length, 0, `no ${sym} files left behind`);
  }
};
