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

  const views = bracketLib.comboViews(F1.combo.size, geo.featureHours / 24).views;
  const members = await trainMembers(F1.members, views, trainChunks, [target], F1.branch, maps, geo);
  const memberCalls = members.map((m) => m.calls);
  const call = quorumCall(memberCalls, 0, F1.cell.quorum); // +1 long, -1 short, 0 flat

  // decision price: the trade pair's OPEN at the entry hour, read from the same
  // map the market simulator reads (bracket.js simMarket: `const p = ref.open`
  // at entryTs = startTs + entryOffsetH). Matching field and timestamp exactly
  // is what makes the executor's fill-vs-decision deviation meaningful.
  const HOUR_MS = 3600000;
  const entryTs = target.startTs + (geo.entryOffsetH || 0) * HOUR_MS;
  const bar = maps.trade.get(entryTs);
  const priceAt = bar ? bar.open : null;

  const perMember = memberCalls.map((c) => c[0]);
  // input hash: the chunk id + the exact per-member votes + quorum, so the
  // archival recomputation can prove the live decision matched (mirror check).
  const inputHash = crypto.createHash('sha256')
    .update(JSON.stringify({ chunk: target.startTs, perMember, quorum: F1.cell.quorum, band: bandPct }))
    .digest('hex').slice(0, 16);

  const sideMap = { 1: 'LONG', '-1': 'SHORT', 0: 'FLAT' };
  return {
    ok: true,
    actionable: true,
    intent: {
      schema: 1,
      symbol: F1.combo.trade,
      side: sideMap[String(call)] || 'FLAT',
      chunk_start: new Date(target.startTs).toISOString(),
      decision_price: priceAt,
      input_hash: inputHash,
      per_member: perMember,
      quorum: F1.cell.quorum,
      ts: Math.floor(now / 1000),
      produced_utc: new Date(now).toISOString(),
    },
  };
}

module.exports = { computeSignal, actionableChunk, F1 };
