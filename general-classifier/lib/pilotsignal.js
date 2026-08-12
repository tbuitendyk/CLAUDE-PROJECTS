// pilotsignal.js -- compute the CURRENT F1 committee call and emit a live
// order-intent, deterministically, with NO AI anywhere (PILOT-F1.md sections 2, 4).
//
// This is the VPS half of the pilot. It reuses the frozen-engine primitives
// EXACTLY as lib/forwardbook.js does -- same combo, same members trained once
// through 2026-06-30, same quorum -- so a live fill has a 1:1 paper twin. It is
// a NEW module and edits nothing in the engine (PILOT-F1.md section 7).
//
// The difference from the forward book: the book scores chunks whose full label
// window has COMPLETED. A live signal needs the opposite end -- the most recent
// chunk whose ENTRY hour has just arrived but whose outcome is still in the
// future. That is the decision the executor must act on now, and it is exactly
// the one the book cannot yet score.
//
// Output is an intent object (schema 1) for mx_executor.py. It carries a
// DIRECTION and the decision price, never a quantity: the executor owns sizing,
// so a bad intent can only ever point a fixed $10 clip the wrong way, not
// resize it (PILOT-F1.md section 3).

const crypto = require('crypto');
const { buildCombo, trainMembers, quorumCall } = require('./bracketwork');
const bracketLib = require('./bracket');
const { scoreDiff } = require('./dataset');
const {
  BOOKS, TRAIN_THROUGH, splitFrozen, assertFrozenMembersMatchEngine,
} = require('./forwardbook');

const F1 = BOOKS.find((b) => b.id === 'F1');

// Bump on ANY change to the F1 live mechanics (members, band, quorum, geometry,
// decision rule, feature layout). It rides in the input_hash so a code/config
// drift that changes the live call is provable after the fact: the archival
// recompute produces a different hash and the mirror check breaks (finding 26/7).
const CONFIG_VERSION = 'f1-v1-2026-08-11';

const HOUR_MS = 3600000;
const SIDE_MAP = { 1: 'LONG', '-1': 'SHORT', 0: 'FLAT' };

// Run the frozen F1 committee on a SINGLE target chunk and return its call,
// per-member votes, entry price, and the (widened) input hash. Shared by the
// live producer (computeSignal) and the archival recompute (computeSignalForChunk)
// so the mirror check compares like with like — the very same code path that
// decided the live trade is the one re-run against fresh data.
async function committeeCall(target, trainChunks, maps, geo, views, bandPct) {
  const members = await trainMembers(F1.members, views, trainChunks, [target], F1.branch, maps, geo);
  const perMember = members.map((m) => m.calls[0]);
  const call = quorumCall(members.map((m) => m.calls), 0, F1.cell.quorum);
  const entryTs = target.startTs + (geo.entryOffsetH || 0) * HOUR_MS;
  const bar = maps.trade.get(entryTs);
  const priceAt = bar ? bar.open : null;
  const side = SIDE_MAP[String(call)] || 'FLAT';
  // input hash (finding 26): pins the chunk, votes, quorum, band, side, symbol,
  // train cutoff and config version, so any drift in the DECISION MACHINERY is
  // provable after the fact — the recompute's hash differs and the mirror breaks
  // on it (re-review: the hash tripwire is now a real break, not informational).
  // decision_price is deliberately NOT hashed: it has its own tolerance-based
  // check in the mirror, so a benign finalized-candle price revision must not
  // trip this config-drift hash.
  const inputHash = crypto.createHash('sha256')
    .update(JSON.stringify({
      chunk: target.startTs, perMember, quorum: F1.cell.quorum, band: bandPct,
      side, symbol: F1.combo.trade,
      train_through: TRAIN_THROUGH, config_version: CONFIG_VERSION,
    }))
    .digest('hex').slice(0, 16);
  return { call, perMember, side, priceAt, inputHash, entryTs };
}

// A chunk is ACTIONABLE now if its entry hour has arrived (start + entryOffsetH
// in the past) but its trade has not yet closed (start + tHours in the future).
// The executor's concurrency/dedup guards mean emitting for every actionable
// chunk is safe, but the live decision is the NEWEST such chunk: that is the
// position being opened this hour. Older actionable chunks are already open.
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

// A chunk is PREVIEWABLE when its feature window has CLOSED (start + featureHours
// in the past — so the committee call is fully determined) but its entry hour has
// NOT arrived yet (start + entryOffsetH in the future). That is the position we
// PLAN to open at the upcoming entry hour: the direction is knowable ~1h ahead
// because only the entry PRICE waits for the entry candle, not the decision. For
// daily-4d this window is 00:00→01:00 UTC each day; outside it there is nothing to
// preview. Returns the nearest such chunk, or null.
function previewableChunk(chunks, geo, now) {
  const featureMs = geo.featureHours * 3600000;
  const entryMs = (geo.entryOffsetH || 0) * 3600000;
  let best = null;
  for (const c of chunks) {
    const featuresCloseAt = c.startTs + featureMs; // last feature candle has closed by here
    const entryAt = c.startTs + entryMs;
    if (featuresCloseAt <= now && now < entryAt) {
      if (!best || c.startTs > best.startTs) best = c;
    }
  }
  return best;
}

// The entry price is the entry candle's OPEN: prefer the CLOSED-cache value (the
// canonical, finalized candle); fall back to a live-fetched open only when the
// candle has not closed yet. Both are the same immutable open, so preferring the
// cache when present keeps a decision reproducible from disk alone. Returns null
// when neither is a real positive price (the caller then WAITS). Pure/testable.
function chooseEntryOpen(cachedOpen, liveOpen) {
  if (typeof cachedOpen === 'number' && cachedOpen > 0) return cachedOpen;
  if (typeof liveOpen === 'number' && liveOpen > 0) return liveOpen;
  return null;
}

// Compute the committee call for a SINGLE target chunk. trainMembers evaluates
// members on the chunks handed to it as the "forward" set, so we pass just the
// target: this yields that chunk's per-member calls under the frozen weights.
async function computeSignal(now, opts = {}) {
  assertFrozenMembersMatchEngine();
  const fee = 0; // fees are the executor's real-world business; the signal is fee-agnostic
  // includeUnlabeled: the live decision is on the CURRENT chunk, whose outcome
  // window has not completed — without this the newest available chunk is ~6
  // days old (waiting for its label) and we would enter as it should be closing.
  const params = { allLoaded: true, feePerLeg: fee, includeUnlabeled: true };
  const { geo, maps, chunks } = await buildCombo(F1.combo, F1.branch, params);

  const bandPct = Math.abs(F1.branch.band);
  // Label only chunks whose outcome is known; the current (target) chunk has
  // diffPct == null and is used for prediction, where its label is never read.
  for (const c of chunks) c.label = c.diffPct == null ? null : scoreDiff(c.diffPct / 100, bandPct / 100);

  const outcomeMs = (geo.exitOffsetH || 0) * 3600000;
  const { trainChunks } = splitFrozen(chunks, TRAIN_THROUGH, opts.scoreFrom, outcomeMs);
  if (!trainChunks.length) throw new Error('pilotsignal: no training chunks at/before freeze');

  const target = actionableChunk(chunks, geo, F1.cell.tHours, now);
  if (!target) {
    return { ok: true, actionable: false,
      note: 'no chunk whose entry hour has arrived and whose hold is still open' };
  }
  // Only enter NEAR the real entry hour. The tick runs hourly, so a chunk is
  // picked up within ~1h of its +97h entry; if its entry is already hours old
  // (e.g. the owner arms mid-day, or a tick was missed), do NOT chase a stale
  // mid-hold entry — wait for the next period. This keeps live fills aligned
  // with the paper book's entry-hour open instead of drifting in late.
  const ENTRY_FRESH_H = 3;
  const entryTs = target.startTs + (geo.entryOffsetH || 0) * HOUR_MS;
  const entryAgeH = (now - entryTs) / HOUR_MS;
  if (entryAgeH > ENTRY_FRESH_H) {
    return { ok: true, actionable: false,
      note: `newest entry was ${entryAgeH.toFixed(1)}h ago (> ${ENTRY_FRESH_H}h) — not chasing a stale entry; waiting for the next period` };
  }

  // DECIDE ON THE FULL 96h WINDOW, INCLUDING ITS MOST-RECENT CANDLE (owner,
  // 2026-08-11) — the decision must use exactly the data training used. The
  // chunk only exists if its 96h run is complete (candleRun), but make the
  // guarantee explicit and refuse rather than decide on a window the refresh
  // has not caught up to: require every pair to carry the last feature candle
  // (startTs + featureHours-1h). A missed candle means "wait", never a decision
  // on a short or stale window.
  const lastFeatureTs = target.startTs + (geo.featureHours - 1) * HOUR_MS;
  for (const [name, m] of [['trade', maps.trade], ['ctx1', maps.ctx1], ['ctx2', maps.ctx2]]) {
    if (m && !m.get(lastFeatureTs)) {
      return { ok: true, actionable: false,
        note: `data not caught up: ${name} is missing the decision's most-recent candle `
          + `(${new Date(lastFeatureTs).toISOString()}) — refresh has not reached it; waiting` };
    }
  }

  const views = bracketLib.comboViews(F1.combo.size, geo.featureHours / 24).views;
  // decision price: the trade pair's OPEN at the entry hour, read from the same
  // map the market simulator reads (bracket.js simMarket: `const p = ref.open`
  // at entryTs = startTs + entryOffsetH). Matching field and timestamp exactly
  // is what makes the executor's fill-vs-decision deviation meaningful.
  const { call, perMember, side, priceAt, inputHash } =
    await committeeCall(target, trainChunks, maps, geo, views, bandPct);
  // ENTRY PRICE = the entry candle's OPEN, exactly as the trained model and the
  // forward book use it (bracket.js simMarket: ref.open at entryTs). Prefer the
  // closed-cache value; but the tick that first sees the entry hour runs ~5 min
  // INTO the entry candle, which has not closed, so the cache does not hold it yet.
  // Rather than wait a full hour for it to close (which pushed the live fill ~1h
  // past the trained entry — owner, 2026-08-11), read the OPEN live from the
  // exchange: a candle's open is FINAL the instant the hour begins, so the live
  // value equals the value the closed candle will carry. Only the OPEN is read;
  // the still-forming high/low/close are never used (features stay closed-only, so
  // the "forming candle is out-of-distribution" rule holds). The live source is the
  // same one that later writes the cached day-file (recentKlines), so the mirror's
  // decision_price recompute matches. If NEITHER cache nor live yields a real open,
  // WAIT — never ship an intent without a decision price (review finding 8).
  let entryOpen = chooseEntryOpen(priceAt, null);
  if (call !== 0 && entryOpen == null && typeof opts.liveOpenFetcher === 'function') {
    let live = null;
    try {
      live = await opts.liveOpenFetcher(F1.combo.trade, entryTs);
    } catch (e) {
      process.stderr.write('pilotsignal: live entry-open fetch failed: ' + (e && e.message) + '\n');
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
      schema: 1,
      symbol: F1.combo.trade,
      side,
      chunk_start: new Date(target.startTs).toISOString(),
      decision_price: entryOpen,
      input_hash: inputHash,
      per_member: perMember,
      quorum: F1.cell.quorum,
      config_version: CONFIG_VERSION,
      train_through: TRAIN_THROUGH,
      band_pct: bandPct,
      ts: Math.floor(now / 1000),
      produced_utc: new Date(now).toISOString(),
    },
  };
}

// ARCHIVAL RECOMPUTE for the mirror check (finding 26). Re-run the F1 committee
// for a SPECIFIC chunk_start against CURRENT data, with no freshness/actionable
// gating, and return the decision fields. The mirror check compares this to what
// the live decision recorded: if the day-file data has since been revised or the
// monthly bundle published different candles (finding 7), or the engine changed,
// the recomputed side / votes / hash diverge and the pilot is halted.
async function computeSignalForChunk(chunkStartMs, opts = {}) {
  assertFrozenMembersMatchEngine();
  const params = { allLoaded: true, feePerLeg: 0, includeUnlabeled: true };
  const { geo, maps, chunks } = await buildCombo(F1.combo, F1.branch, params);
  const bandPct = Math.abs(F1.branch.band);
  for (const c of chunks) c.label = c.diffPct == null ? null : scoreDiff(c.diffPct / 100, bandPct / 100);
  const outcomeMs = (geo.exitOffsetH || 0) * 3600000;
  const { trainChunks } = splitFrozen(chunks, TRAIN_THROUGH, opts.scoreFrom, outcomeMs);
  if (!trainChunks.length) throw new Error('pilotsignal: no training chunks at/before freeze');

  const target = chunks.find((c) => c.startTs === chunkStartMs);
  if (!target) {
    return { found: false, chunk_start: new Date(chunkStartMs).toISOString(),
      note: 'chunk not present in current data (its 96h feature window is not complete in cache)' };
  }
  // guard: every pair must carry the last feature candle, exactly as the live
  // producer required — a recompute on a short window would be a false break.
  const lastFeatureTs = target.startTs + (geo.featureHours - 1) * HOUR_MS;
  for (const [name, m] of [['trade', maps.trade], ['ctx1', maps.ctx1], ['ctx2', maps.ctx2]]) {
    if (m && !m.get(lastFeatureTs)) {
      return { found: false, chunk_start: new Date(chunkStartMs).toISOString(),
        note: `current data missing ${name} feature candle ${new Date(lastFeatureTs).toISOString()} — cannot recompute yet` };
    }
  }
  const views = bracketLib.comboViews(F1.combo.size, geo.featureHours / 24).views;
  const { side, perMember, priceAt, inputHash } =
    await committeeCall(target, trainChunks, maps, geo, views, bandPct);
  return {
    found: true,
    // The live producer now records the decision at the entry candle's OPEN, ~1h
    // BEFORE that candle closes and lands in the cache. So a recompute in that
    // window finds the chunk and full feature set but cannot yet read the +97h
    // entry bar — priceAt is null. That is benign timing, NOT a divergence: flag it
    // price_pending so the mirror defers ONLY the price check (side/votes/hash are
    // fully verified) instead of reading real-vs-null as a break (2026-08-12 review).
    price_pending: priceAt == null,
    chunk_start: new Date(target.startTs).toISOString(),
    side,
    per_member: perMember,
    decision_price: priceAt,
    input_hash: inputHash,
    quorum: F1.cell.quorum,
    band_pct: bandPct,
    config_version: CONFIG_VERSION,
  };
}

// DECISION PREVIEW (owner 2026-08-12): compute the committee call for the chunk we
// PLAN to enter at the upcoming entry hour, as soon as its feature window has closed
// — ~1h before entry. Uses the SAME committeeCall path as the live entry, so the
// preview is byte-identical to the decision that will execute (the features are
// frozen once the window closes; only the entry PRICE waits for the entry candle).
// Read-only: records NO mirror decision and ships NO intent. Returns { available,
// side, per_member, entry_utc, ... } or { available:false, note } outside the window.
async function computePreview(now, opts = {}) {
  assertFrozenMembersMatchEngine();
  const params = { allLoaded: true, feePerLeg: 0, includeUnlabeled: true };
  const { geo, maps, chunks } = await buildCombo(F1.combo, F1.branch, params);
  const bandPct = Math.abs(F1.branch.band);
  for (const c of chunks) c.label = c.diffPct == null ? null : scoreDiff(c.diffPct / 100, bandPct / 100);
  const outcomeMs = (geo.exitOffsetH || 0) * 3600000;
  const { trainChunks } = splitFrozen(chunks, TRAIN_THROUGH, opts.scoreFrom, outcomeMs);
  if (!trainChunks.length) throw new Error('pilotsignal: no training chunks at/before freeze');

  const target = previewableChunk(chunks, geo, now);
  if (!target) {
    return { available: false,
      note: 'no decision to preview — the next entry’s 96h feature window has not closed yet' };
  }
  const entryAt = target.startTs + (geo.entryOffsetH || 0) * HOUR_MS;
  // the window has closed, but the last feature candle caches a few minutes after
  // its close — say "shortly" rather than compute on a short window (false signal).
  const lastFeatureTs = target.startTs + (geo.featureHours - 1) * HOUR_MS;
  for (const [name, m] of [['trade', maps.trade], ['ctx1', maps.ctx1], ['ctx2', maps.ctx2]]) {
    if (m && !m.get(lastFeatureTs)) {
      return { available: false,
        note: `feature window closed but ${name}'s last candle is not cached yet — preview available shortly`,
        entry_utc: new Date(entryAt).toISOString() };
    }
  }
  const views = bracketLib.comboViews(F1.combo.size, geo.featureHours / 24).views;
  const { side, perMember } = await committeeCall(target, trainChunks, maps, geo, views, bandPct);
  return {
    available: true,
    side,                        // 'LONG' | 'SHORT' | 'FLAT' — the PLAN for entry_utc
    per_member: perMember,
    quorum: F1.cell.quorum,
    band_pct: bandPct,
    chunk_start: new Date(target.startTs).toISOString(),
    entry_utc: new Date(entryAt).toISOString(),
    computed_utc: new Date(now).toISOString(),
    config_version: CONFIG_VERSION,
  };
}

module.exports = { computeSignal, computeSignalForChunk, computePreview, actionableChunk, previewableChunk, chooseEntryOpen, F1, CONFIG_VERSION };
