// Generalized signal producer (plan 2.2, NEXT-RELEASE point 5): the
// pilotsignal.js decision path PARAMETERIZED by a TradingSetup's
// configSnapshot instead of the hardcoded F1 book.
//
// PARITY BY CONSTRUCTION, then verified: this module deliberately mirrors
// lib/pilotsignal.js line for line where the logic is shared — same engine
// primitives (buildCombo/trainMembers/quorumCall), same splitFrozen freeze,
// same actionable/previewable window math, same entry-open rule (QC 109),
// same hash recipe, same guards (full-feature-window refusal, ENTRY_FRESH_H,
// no-intent-without-price). The golden parity gate (plan 2.3) then PROVES the
// F1 config through this module reproduces pilotsignal byte-for-byte on the
// real cache (scripts/live-parity-check.sh on the VPS) — construction is a
// design intent; only measurement makes it a fact.
//
// pilotsignal.js itself is UNTOUCHED (non-regression rule): the running F1
// pilot keeps executing on its own rails until the owner-decided cutover
// (which the owner has resolved as: keep both).
//
// NO AI anywhere in this path (NEXT-RELEASE point 2): deterministic math over
// exchange candles, exactly like the module it generalizes.

const crypto = require('crypto');
const { buildCombo, trainMembers, quorumCall, specsFor } = require('../bracketwork');
const bracketLib = require('../bracket');
const { scoreDiff } = require('../dataset');
const { splitFrozen } = require('../forwardbook');
const { validateConfig } = require('./configschema');

const HOUR_MS = 3600000;
const SIDE_MAP = { 1: 'LONG', '-1': 'SHORT', 0: 'FLAT' };
// Same freshness rule as pilotsignal: never chase an entry more than 3h old.
const ENTRY_FRESH_H = 3;

// Per-config frozen-roster check — the generalized twin of forwardbook's
// assertFrozenMembersMatchEngine: a config whose member list has drifted from
// what specsFor(size, stage) builds is QC 71's failure mode (plausible numbers,
// wrong experiment). Fail loudly before any decision.
function assertMembersMatchEngine(cfg) {
  const built = specsFor(cfg.combo.size, cfg.stage);
  const a = JSON.stringify(built.map((s) => ({ model: s.model, view: s.view })));
  const f = JSON.stringify(cfg.members.map((m) => ({ model: m.model, view: m.view })));
  if (a !== f) {
    throw new Error(`live signal: config committee no longer matches specsFor(${cfg.combo.size}, '${cfg.stage}')`
      + ` — frozen ${f} vs engine ${a}`);
  }
}

function cfgOf(setup) {
  const cfg = setup.configSnapshot;
  const v = validateConfig(cfg);
  if (!v.ok) throw new Error(`setup ${setup.id}: configSnapshot invalid: ${v.errors.join('; ')}`);
  assertMembersMatchEngine(cfg);
  return cfg;
}

// Identical recipe to pilotsignal.committeeCall, with the config's own
// quorum/band/symbol/freeze/version in place of F1's. The hash covers the
// decision machinery (not the price — the mirror's price check has its own
// tolerance), so machinery drift is provable per setup.
async function committeeCallFor(cfg, target, trainChunks, maps, geo, views, bandPct) {
  const members = await trainMembers(cfg.members, views, trainChunks, [target], cfg.branch, maps, geo);
  const perMember = members.map((m) => m.calls[0]);
  const call = quorumCall(members.map((m) => m.calls), 0, cfg.cell.quorum);
  const entryTs = target.startTs + (geo.entryOffsetH || 0) * HOUR_MS;
  const bar = maps.trade.get(entryTs);
  const priceAt = bar ? bar.open : null;
  const side = SIDE_MAP[String(call)] || 'FLAT';
  const inputHash = crypto.createHash('sha256')
    .update(JSON.stringify({
      chunk: target.startTs, perMember, quorum: cfg.cell.quorum, band: bandPct,
      side, symbol: cfg.combo.trade,
      train_through: cfg.trainThrough, config_version: cfg.configVersion,
    }))
    .digest('hex').slice(0, 16);
  return { call, perMember, side, priceAt, inputHash, entryTs };
}

// Shared preamble: build the combo, freeze-split, return the working pieces.
async function prepare(cfg) {
  const params = { allLoaded: true, feePerLeg: 0, includeUnlabeled: true };
  const { geo, maps, chunks } = await buildCombo(cfg.combo, cfg.branch, params);
  const bandPct = Math.abs(cfg.branch.band);
  for (const c of chunks) c.label = c.diffPct == null ? null : scoreDiff(c.diffPct / 100, bandPct / 100);
  const outcomeMs = (geo.exitOffsetH || 0) * 3600000;
  const { trainChunks } = splitFrozen(chunks, cfg.trainThrough, undefined, outcomeMs);
  if (!trainChunks.length) throw new Error('live signal: no training chunks at/before the freeze');
  const views = bracketLib.comboViews(cfg.combo.size, geo.featureHours / 24).views;
  return { geo, maps, chunks, bandPct, trainChunks, views };
}

// Window selectors — same math as pilotsignal (kept as pure functions there;
// re-exported here for the generalized geometry).
function actionableChunk(chunks, geo, tHours, now) {
  const entryMs = (geo.entryOffsetH || 0) * 3600000;
  const holdMs = tHours * 3600000;
  let best = null;
  for (const c of chunks) {
    const entryAt = c.startTs + entryMs;
    const exitAt = c.startTs + entryMs + holdMs;
    if (entryAt <= now && now < exitAt) {
      if (!best || c.startTs > best.startTs) best = c;
    }
  }
  return best;
}
function previewableChunk(chunks, geo, now) {
  const featureMs = geo.featureHours * 3600000;
  const entryMs = (geo.entryOffsetH || 0) * 3600000;
  let best = null;
  for (const c of chunks) {
    const featuresCloseAt = c.startTs + featureMs;
    const entryAt = c.startTs + entryMs;
    if (featuresCloseAt <= now && now < entryAt) {
      if (!best || c.startTs > best.startTs) best = c;
    }
  }
  return best;
}
function chooseEntryOpen(cachedOpen, liveOpen) {
  if (typeof cachedOpen === 'number' && cachedOpen > 0) return cachedOpen;
  if (typeof liveOpen === 'number' && liveOpen > 0) return liveOpen;
  return null;
}

// Refuse to decide unless every pair carries the window's last feature candle
// (identical guard to pilotsignal — a missed candle means WAIT, never a
// decision on a short window).
function missingFeatureCandle(target, geo, maps) {
  const lastFeatureTs = target.startTs + (geo.featureHours - 1) * HOUR_MS;
  for (const [name, m] of [['trade', maps.trade], ['ctx1', maps.ctx1], ['ctx2', maps.ctx2]]) {
    if (m && !m.get(lastFeatureTs)) return { name, lastFeatureTs };
  }
  return null;
}

// The live decision for ONE setup at `now`. Returns { ok, actionable, intent? }.
// Intent is SCHEMA 2: schema-1 fields (so the validation shape is a superset)
// plus setup_id and the setup's execution params — the executor cross-checks
// them against its own per-box allowlist (defense in depth; plan 3.1).
async function computeSignal(setup, now, opts = {}) {
  const cfg = cfgOf(setup);
  const { geo, maps, chunks, bandPct, trainChunks, views } = await prepare(cfg);

  const target = actionableChunk(chunks, geo, cfg.cell.tHours, now);
  if (!target) {
    return { ok: true, actionable: false,
      note: 'no chunk whose entry hour has arrived and whose hold is still open' };
  }
  const entryTs = target.startTs + (geo.entryOffsetH || 0) * HOUR_MS;
  const entryAgeH = (now - entryTs) / HOUR_MS;
  if (entryAgeH > ENTRY_FRESH_H) {
    return { ok: true, actionable: false,
      note: `newest entry was ${entryAgeH.toFixed(1)}h ago (> ${ENTRY_FRESH_H}h) — not chasing a stale entry; waiting for the next period` };
  }
  const miss = missingFeatureCandle(target, geo, maps);
  if (miss) {
    return { ok: true, actionable: false,
      note: `data not caught up: ${miss.name} is missing the decision's most-recent candle `
        + `(${new Date(miss.lastFeatureTs).toISOString()}) — refresh has not reached it; waiting` };
  }

  const { call, perMember, side, priceAt, inputHash } =
    await committeeCallFor(cfg, target, trainChunks, maps, geo, views, bandPct);

  let entryOpen = chooseEntryOpen(priceAt, null);
  if (call !== 0 && entryOpen == null && typeof opts.liveOpenFetcher === 'function') {
    let live = null;
    try {
      live = await opts.liveOpenFetcher(cfg.combo.trade, entryTs);
    } catch (e) {
      process.stderr.write(`live signal(${setup.id}): live entry-open fetch failed: ${e && e.message}\n`);
    }
    entryOpen = chooseEntryOpen(priceAt, live);
  }
  if (call !== 0 && entryOpen == null) {
    return { ok: true, actionable: false,
      note: `entry candle open (${new Date(entryTs).toISOString()}) not available from cache or live yet — waiting` };
  }

  return {
    ok: true,
    actionable: true,
    intent: {
      schema: 2,
      setup_id: setup.id,
      symbol: cfg.combo.trade,
      side,
      chunk_start: new Date(target.startTs).toISOString(),
      decision_price: entryOpen,
      input_hash: inputHash,
      per_member: perMember,
      quorum: cfg.cell.quorum,
      config_version: cfg.configVersion,
      train_through: cfg.trainThrough,
      band_pct: bandPct,
      // execution params from the setup (plan 3.1) — the box validates these
      // against its own allowlist entry for setup_id before acting.
      clip_usd: setup.clipUsd,
      hold_hours: cfg.cell.tHours,
      stop_pct: setup.stopPct ?? null,
      paper: setup.state === 'paper',
      ts: Math.floor(now / 1000),
      produced_utc: new Date(now).toISOString(),
    },
  };
}

// Archival recompute for the per-setup mirror (QC 110 semantics preserved:
// price_pending defers ONLY the price check while the entry candle is uncached).
async function computeSignalForChunk(setup, chunkStartMs) {
  const cfg = cfgOf(setup);
  const { geo, maps, chunks, bandPct, trainChunks, views } = await prepare(cfg);
  const target = chunks.find((c) => c.startTs === chunkStartMs);
  if (!target) {
    return { found: false, chunk_start: new Date(chunkStartMs).toISOString(),
      note: 'chunk not present in current data (its feature window is not complete in cache)' };
  }
  const miss = missingFeatureCandle(target, geo, maps);
  if (miss) {
    return { found: false, chunk_start: new Date(chunkStartMs).toISOString(),
      note: `current data missing ${miss.name} feature candle ${new Date(miss.lastFeatureTs).toISOString()} — cannot recompute yet` };
  }
  const { side, perMember, priceAt, inputHash } =
    await committeeCallFor(cfg, target, trainChunks, maps, geo, views, bandPct);
  return {
    found: true,
    price_pending: priceAt == null,
    chunk_start: new Date(target.startTs).toISOString(),
    side,
    per_member: perMember,
    decision_price: priceAt,
    input_hash: inputHash,
    quorum: cfg.cell.quorum,
    band_pct: bandPct,
    config_version: cfg.configVersion,
  };
}

// Decision preview per setup (same semantics as the F1 preview).
async function computePreview(setup, now) {
  const cfg = cfgOf(setup);
  const { geo, maps, chunks, bandPct, trainChunks, views } = await prepare(cfg);
  const target = previewableChunk(chunks, geo, now);
  if (!target) {
    return { available: false,
      note: 'no decision to preview — the next entry’s feature window has not closed yet' };
  }
  const entryAt = target.startTs + (geo.entryOffsetH || 0) * HOUR_MS;
  const miss = missingFeatureCandle(target, geo, maps);
  if (miss) {
    return { available: false,
      note: `feature window closed but ${miss.name}'s last candle is not cached yet — preview available shortly`,
      entry_utc: new Date(entryAt).toISOString() };
  }
  const { side, perMember } = await committeeCallFor(cfg, target, trainChunks, maps, geo, views, bandPct);
  return {
    available: true,
    setup_id: setup.id,
    side,
    per_member: perMember,
    quorum: cfg.cell.quorum,
    band_pct: bandPct,
    chunk_start: new Date(target.startTs).toISOString(),
    entry_utc: new Date(entryAt).toISOString(),
    computed_utc: new Date(now).toISOString(),
    config_version: cfg.configVersion,
  };
}

module.exports = {
  computeSignal, computeSignalForChunk, computePreview,
  actionableChunk, previewableChunk, chooseEntryOpen,
  assertMembersMatchEngine, committeeCallFor, ENTRY_FRESH_H,
};
