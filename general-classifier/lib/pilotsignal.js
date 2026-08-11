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
  // input hash WIDENED (finding 26): beyond {chunk, votes, quorum, band} it now
  // pins side, symbol, the decision price, the train cutoff and a config version,
  // so any drift in those is provable after the fact — the recompute's hash will
  // differ. decision_price is rounded so float noise cannot spuriously break it.
  const inputHash = crypto.createHash('sha256')
    .update(JSON.stringify({
      chunk: target.startTs, perMember, quorum: F1.cell.quorum, band: bandPct,
      side, symbol: F1.combo.trade,
      decision_price: priceAt == null ? null : Math.round(priceAt * 1e8) / 1e8,
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
  // Never ship an actionable intent without a real decision price: the executor
  // checks the fill against it, and a null would either crash or drop the intent
  // to .bad while the paper twin still books the trade — a silent divergence
  // (review finding 8). If the entry bar is not present, wait.
  if (call !== 0 && priceAt == null) {
    return { ok: true, actionable: false,
      note: `entry bar (${new Date(entryTs).toISOString()}) not present yet — no decision price; waiting` };
  }

  return {
    ok: true,
    actionable: true,
    intent: {
      schema: 1,
      symbol: F1.combo.trade,
      side,
      chunk_start: new Date(target.startTs).toISOString(),
      decision_price: priceAt,
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

module.exports = { computeSignal, computeSignalForChunk, actionableChunk, F1, CONFIG_VERSION };
