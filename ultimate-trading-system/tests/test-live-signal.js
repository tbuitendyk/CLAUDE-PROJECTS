// Generalized signal producer (plan 2.2) on a fully fabricated 3-symbol combo:
// full-flow behavior with zero network and zero real-symbol cache contact.
// Symbols are reserved fakes (ZZZQ*) that can never collide with a real pair;
// cleanup removes exactly those files. The REAL golden parity gate (plan 2.3)
// runs on the VPS against the live cache via live-parity.js — this file covers
// the behavior the parity gate cannot (window edges, fetcher path, guards).
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mulberry32 } = require('../lib/rng');
const { buildCombo } = require('../lib/bracketwork');

process.env.GC_SETUPS_DIR = process.env.GC_SETUPS_DIR
  || fs.mkdtempSync(path.join(os.tmpdir(), 'gc-signal-'));
const signal = require('../lib/live/signal');

const CACHE = path.join(__dirname, '..', 'data', 'cache');
const SYMS = ['ZZZQAUSDT', 'ZZZQBUSDT', 'ZZZQCUSDT'];
const HOUR = 3600000;
const T0 = Date.UTC(2026, 0, 1);          // 2026-01-01
const DAYS = 220;                          // ~215 daily-4d chunks
const FREEZE = Date.UTC(2026, 5, 30, 23, 59, 59); // matches F1's freeze shape

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

let planted = false;
let chunksCache = null;
async function withData() {
  if (!planted) { SYMS.forEach((s, i) => writeFabricated(s, 1234 + i)); planted = true; }
  if (!chunksCache) {
    const { geo, maps, chunks } = await buildCombo(CONFIG.combo, CONFIG.branch,
      { allLoaded: true, feePerLeg: 0, includeUnlabeled: true });
    chunksCache = { geo, maps, chunks };
  }
  return chunksCache;
}

// Pick a chunk whose entry bar IS in the fabricated cache (mid-history) and
// one whose entry bar is NOT (right at the end of the span).
async function pickTargets() {
  const { geo, maps, chunks } = await withData();
  const entryMs = (geo.entryOffsetH || 0) * HOUR;
  const cached = chunks.filter((c) => maps.trade.get(c.startTs + entryMs)
    && c.startTs > FREEZE);                        // after the freeze = live era
  const uncached = chunks.filter((c) => !maps.trade.get(c.startTs + entryMs)
    && maps.trade.get(c.startTs + (geo.featureHours - 1) * HOUR));
  return { geo, cached, uncached };
}

module.exports.actionableIntentCarriesSchema2AndTheCachedEntryOpen = async function () {
  const { geo, cached } = await pickTargets();
  assert.ok(cached.length > 5, `need post-freeze chunks with cached entry bars, got ${cached.length}`);
  const t = cached[Math.floor(cached.length / 2)];
  const now = t.startTs + (geo.entryOffsetH * HOUR) + 5 * 60000; // entry + 5 min
  const out = await signal.computeSignal(SETUP, now);
  assert.ok(out.ok && out.actionable, `expected actionable, got ${JSON.stringify(out).slice(0, 200)}`);
  const it = out.intent;
  assert.strictEqual(it.schema, 2);
  assert.strictEqual(it.setup_id, 'sig-test-1');
  assert.strictEqual(it.symbol, SYMS[0]);
  assert.strictEqual(it.clip_usd, 10);
  assert.strictEqual(it.hold_hours, 137);
  assert.strictEqual(it.paper, false);
  assert.ok(['LONG', 'SHORT', 'FLAT'].includes(it.side));
  assert.strictEqual(it.chunk_start, new Date(t.startTs).toISOString());
  const { maps } = await withData();
  const bar = maps.trade.get(t.startTs + geo.entryOffsetH * HOUR);
  assert.strictEqual(it.decision_price, bar.open, 'decision price = entry candle OPEN from cache');
  assert.strictEqual(it.per_member.length, STAGE_CONFIG.members.length);
};

module.exports.decisionsAreDeterministicAndHashPinsTheMachinery = async function () {
  const { geo, cached } = await pickTargets();
  const t = cached[Math.floor(cached.length / 2)];
  const now = t.startTs + geo.entryOffsetH * HOUR + 60000;
  const a = await signal.computeSignal(SETUP, now);
  const b = await signal.computeSignal(SETUP, now);
  assert.deepStrictEqual(a.intent, b.intent, 'same inputs, byte-identical intent');
  // config_version participates in the hash: a machinery bump is provable
  const bumped = { ...SETUP, configSnapshot: { ...CONFIG, configVersion: 'zzzq-v2-test' } };
  const c = await signal.computeSignal(bumped, now);
  assert.notStrictEqual(c.intent.input_hash, a.intent.input_hash, 'version bump changes the hash');
  assert.strictEqual(c.intent.side, a.intent.side, 'but not the decision itself');
};

module.exports.recomputeMatchesTheLiveDecisionFieldForField = async function () {
  // The property the per-setup mirror depends on (QC 110 semantics): the
  // archival recompute of the SAME chunk reproduces the live decision exactly.
  const { geo, cached } = await pickTargets();
  const t = cached[Math.floor(cached.length / 2) + 1];
  const now = t.startTs + geo.entryOffsetH * HOUR + 60000;
  const live = await signal.computeSignal(SETUP, now);
  const re = await signal.computeSignalForChunk(SETUP, t.startTs);
  assert.ok(re.found);
  assert.strictEqual(re.price_pending, false, 'entry bar cached -> no pending');
  assert.strictEqual(re.side, live.intent.side);
  assert.deepStrictEqual(re.per_member, live.intent.per_member);
  assert.strictEqual(re.input_hash, live.intent.input_hash);
  assert.strictEqual(re.decision_price, live.intent.decision_price);
};

module.exports.uncachedEntryBarUsesTheLiveOpenFetcherOrWaits = async function () {
  const { geo, uncached } = await pickTargets();
  assert.ok(uncached.length, 'span end must yield chunks with uncached entry bars');
  const t = uncached[uncached.length - 1];
  const now = t.startTs + geo.entryOffsetH * HOUR + 5 * 60000;
  // without a fetcher: FLAT ships without price; a directional call WAITS
  const bare = await signal.computeSignal(SETUP, now);
  if (bare.actionable && bare.intent.side !== 'FLAT') {
    assert.ok(false, `directional intent shipped without any price source: ${JSON.stringify(bare.intent)}`);
  }
  // with a fetcher: the live open becomes the decision price (QC 109 pattern)
  let asked = null;
  const out = await signal.computeSignal(SETUP, now, {
    liveOpenFetcher: async (sym, ts) => { asked = { sym, ts }; return 123.45; },
  });
  assert.ok(out.actionable, `with fetcher expected actionable: ${JSON.stringify(out).slice(0, 160)}`);
  if (out.intent.side !== 'FLAT') {
    assert.deepStrictEqual(asked, { sym: SYMS[0], ts: t.startTs + geo.entryOffsetH * HOUR });
    assert.strictEqual(out.intent.decision_price, 123.45);
  }
  // recompute now flags price_pending (mirror defers ONLY the price check)
  const re = await signal.computeSignalForChunk(SETUP, t.startTs);
  assert.ok(re.found && re.price_pending === true, 'uncached entry bar -> price_pending');
};

module.exports.staleEntryIsNeverChased = async function () {
  const { geo, cached } = await pickTargets();
  const t = cached[Math.floor(cached.length / 2)];
  const now = t.startTs + geo.entryOffsetH * HOUR + (signal.ENTRY_FRESH_H + 1) * HOUR;
  const out = await signal.computeSignal(SETUP, now);
  // Either a NEWER chunk is actionable (fine) or this one is refused as stale;
  // what must NEVER happen is acting on the stale target itself.
  if (out.actionable) {
    assert.notStrictEqual(out.intent.chunk_start, new Date(t.startTs).toISOString(),
      'a >3h-old entry must not be chased');
  } else {
    assert.ok(/stale|waiting|no chunk/.test(out.note), out.note);
  }
};

module.exports.previewAppearsInTheWindowBetweenCloseAndEntry = async function () {
  const { geo, cached } = await pickTargets();
  const t = cached[Math.floor(cached.length / 2) + 2];
  const inWindow = t.startTs + geo.featureHours * HOUR + 10 * 60000; // close + 10 min
  const pv = await signal.computePreview(SETUP, inWindow);
  assert.ok(pv.available, JSON.stringify(pv).slice(0, 160));
  assert.strictEqual(pv.setup_id, 'sig-test-1');
  assert.strictEqual(pv.chunk_start, new Date(t.startTs).toISOString());
  assert.strictEqual(pv.entry_utc, new Date(t.startTs + geo.entryOffsetH * HOUR).toISOString());
  // the previewed side equals the decision the entry will execute
  const re = await signal.computeSignalForChunk(SETUP, t.startTs);
  assert.strictEqual(pv.side, re.side, 'preview side == executed side (features frozen at close)');
};

module.exports.paperSetupsProduceIntentsFlaggedPaper = async function () {
  const { geo, cached } = await pickTargets();
  const t = cached[Math.floor(cached.length / 2)];
  const now = t.startTs + geo.entryOffsetH * HOUR + 60000;
  const paper = { ...SETUP, state: 'paper' };
  const out = await signal.computeSignal(paper, now);
  assert.ok(out.actionable);
  assert.strictEqual(out.intent.paper, true, 'paper state rides in the intent');
};


module.exports.zzz_cleanupFabricatedSymbols = function () {
  cleanup();
  for (const sym of SYMS) {
    const left = fs.readdirSync(CACHE).filter((f) => f.startsWith(`${sym}-1h-`));
    assert.strictEqual(left.length, 0, `no ${sym} files left behind`);
  }
};

// ---- THE STAGE ENGINE'S AGREEMENT ON THE LIVE PATH (3.91.0) ----
// The same fabricated combo, decided by a stage-engine configuration: the
// members trained the stages' way, the call by the configuration's own
// agreement, an intent that carries every vote and the agreement and no
// integer quorum, the recompute equal to the live decision field for field.
const STAGE_CONFIG = {
  engine: 'stages',
  combo: { trade: SYMS[0], ctx1: SYMS[1], ctx2: SYMS[2], size: 3 },
  branch: { geometry: 'daily-4d', decision: 'argmax', band: 0.4, weekdaysOnly: false },
  stage: 'stages',
  members: [{ model: 'logreg', view: 'full' }, { model: 'logreg', view: 'prices' }, { model: 'logreg', view: 'volume' }, { model: 'logreg', view: 'pricevol' }, { model: 'logreg', view: 'cross' },
    { model: 'boost', view: 'full' }, { model: 'boost', view: 'prices' }, { model: 'boost', view: 'volume' }, { model: 'boost', view: 'pricevol' }, { model: 'boost', view: 'cross' }],
  cell: { quorum: null, entry: 'market', gate: 'directional', dMult: null, tHours: 137, trailMult: null, armMult: null },
  agreement: { rule: 'count', bar: 'all', pct: 50, copy: 98, both: false, persist: 0, rung: 5, members: 10, voices: null },
  training: { trainOn: 'direction', weightCap: null, windowLayout: 'reserve61', startMonth: '2026-01', endMonth: '2026-08', allLoaded: false, nullN: 9 },
  configVersion: 'zzzq-stages-v1-test',
};
const STAGE_SETUP = { id: 'sig-test-stages', state: 'paper', clipUsd: 10, stopPct: null, configSnapshot: STAGE_CONFIG, trainPolicy: { mode: 'frozen', throughMs: FREEZE } };
// THE ONE ENGINE (3.97.0): the older engine's tests ran the same live path on a
// configuration of its shape; that shape cannot exist any more, so they run on
// the stage-engine configuration, under the older names.
const CONFIG = { ...STAGE_CONFIG, configVersion: 'zzzq-v1-test' };
const SETUP = { ...STAGE_SETUP, id: 'sig-test-1', state: 'live', configSnapshot: CONFIG };

module.exports.aStageEngineConfigurationDecidesByItsOwnAgreementAndTheRecomputeMatches = async function () {
  const { validateConfig, liveExecutable } = require('../lib/live/configschema');
  assert.strictEqual(validateConfig(STAGE_CONFIG).ok, true, validateConfig(STAGE_CONFIG).errors.join('; '));
  assert.strictEqual(liveExecutable(STAGE_CONFIG).ok, true, liveExecutable(STAGE_CONFIG).errors.join('; '));
  const { geo, cached } = await pickTargets();
  const t = cached[Math.floor(cached.length / 2)];
  const now = t.startTs + (geo.entryOffsetH * HOUR) + 5 * 60000;
  const out = await signal.computeSignal(STAGE_SETUP, now);
  assert.ok(out.ok && out.actionable, `expected actionable, got ${JSON.stringify(out).slice(0, 300)}`);
  const it = out.intent;
  assert.strictEqual(it.schema, 2);
  assert.strictEqual(it.per_member.length, 10, 'every member of the stage configuration voted');
  assert.ok(it.per_member.every((v) => v === 1 || v === -1 || v === 0));
  assert.strictEqual(it.quorum, null, 'no integer quorum is invented for it');
  assert.deepStrictEqual({ rule: it.agreement.rule, pct: it.agreement.pct, bar: it.agreement.bar, both: it.agreement.both, persist: it.agreement.persist }, { rule: 'count', pct: 50, bar: 'all', both: false, persist: 0 }, 'the intent carries the agreement it decided by');
  assert.ok(['LONG', 'SHORT', 'FLAT'].includes(it.side));
  // the call IS the rule's own reading of the votes: count at 50% of ten is five
  const up = it.per_member.filter((v) => v === 1).length;
  const dn = it.per_member.filter((v) => v === -1).length;
  const expect = up === dn ? 'FLAT' : (Math.max(up, dn) >= 5 ? (up > dn ? 'LONG' : 'SHORT') : 'FLAT');
  assert.strictEqual(it.side, expect, `count at 50% of 10: ${up} up, ${dn} down`);
  assert.strictEqual(it.paper, true);
  // the recompute of the same chunk is the same decision, field for field
  const re = await signal.computeSignalForChunk(STAGE_SETUP, t.startTs);
  assert.ok(re.found);
  assert.strictEqual(re.side, it.side);
  assert.deepStrictEqual(re.per_member, it.per_member);
  assert.strictEqual(re.input_hash, it.input_hash);
  assert.deepStrictEqual(re.agreement, it.agreement);
  // the preview speaks the same agreement
  const pv = await signal.computePreview(STAGE_SETUP, t.startTs + geo.featureHours * HOUR + 60000);
  assert.ok(pv.available, JSON.stringify(pv).slice(0, 200));
  assert.strictEqual(pv.agreement.rule, 'count');
  // +hold reads the moment before the target and never after it: the held
  // decision is the target's own call only when the same call stood the
  // moment before, else stand aside -- pencilled from the two plain decisions
  const held = { ...STAGE_SETUP, configSnapshot: { ...STAGE_CONFIG, agreement: { ...STAGE_CONFIG.agreement, persist: 1 }, configVersion: 'zzzq-stages-hold' } };
  const out2 = await signal.computeSignal(held, now);
  assert.ok(out2.ok && out2.actionable);
  assert.strictEqual(out2.intent.agreement.persist, 1);
  const { chunks } = await withData();
  const ordered = chunks.slice().sort((a, b) => a.startTs - b.startTs);
  const at = ordered.findIndex((c) => c.startTs === t.startTs);
  const prev = await signal.computeSignalForChunk(STAGE_SETUP, ordered[at - 1].startTs);
  assert.ok(prev.found, 'the moment before is a chunk of its own');
  const expectHeld = (it.side !== 'FLAT' && prev.side === it.side) ? it.side : 'FLAT';
  assert.strictEqual(out2.intent.side, expectHeld, `+hold 1: target ${it.side}, the moment before ${prev.side}`);
};
