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

const CONFIG = {
  combo: { trade: SYMS[0], ctx1: SYMS[1], ctx2: SYMS[2], size: 3 },
  branch: { geometry: 'daily-4d', decision: 'argmax', band: 0.4, weekdaysOnly: false },
  stage: 'slim',
  // read from the engine, never typed out: a reading added to the committee
  // must not leave a fixture behind (owner loop, 2026-08-28)
  members: require('../lib/bracketwork').specsFor(3, 'slim').map((x) => ({ model: x.model, view: x.view })),
  cell: { quorum: 1, entry: 'market', gate: 'directional', dMult: null, tHours: 137, trailMult: null, armMult: null },
  trainThrough: FREEZE,
  configVersion: 'zzzq-v1-test',
};
const SETUP = {
  id: 'sig-test-1', state: 'live', clipUsd: 10, stopPct: null,
  configSnapshot: CONFIG,
};

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
  assert.strictEqual(it.per_member.length, require('../lib/bracketwork').specsFor(3, 'slim').length);
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

module.exports.driftedRosterIsRefusedLoudly = async function () {
  const bad = { ...SETUP, configSnapshot: { ...CONFIG, members: CONFIG.members.slice(0, 3) } };
  let err = null;
  try { await signal.computeSignal(bad, 1786500000000); } catch (e) { err = e; }
  assert.ok(err && /specsFor/.test(err.message), `drifted committee must throw: ${err && err.message}`);
};

module.exports.zzz_cleanupFabricatedSymbols = function () {
  cleanup();
  for (const sym of SYMS) {
    const left = fs.readdirSync(CACHE).filter((f) => f.startsWith(`${sym}-1h-`));
    assert.strictEqual(left.length, 0, `no ${sym} files left behind`);
  }
};
