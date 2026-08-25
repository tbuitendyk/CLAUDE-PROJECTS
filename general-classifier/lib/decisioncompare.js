// compareDecision -- does a recorded decision still reproduce?
//
// The one comparison rule both rails use, and the reason a profile can be
// trusted to notice its own drift. It knows nothing about any particular book:
// it takes a recorded decision and a fresh recompute and says match, PENDING
// (the recompute could not run yet) or BREAK (they genuinely disagree).
//
// It lived in the mirror module belonging to one hardcoded config, so the
// generalized rail had to import its integrity check from the very thing being
// retired. Nothing about the logic changed in moving it.

const PRICE_TOL = 0.005;

// Compare ONE recorded live decision to its fresh recompute. Never throws; a
// recompute that could not run yet (data not caught up) is PENDING, not a break.
function compareDecision(recorded, recomputed) {
  if (!recomputed || recomputed.found === false) {
    // A recorded decision had a COMPLETE feature window at production time
    // (window_complete). If the recompute now cannot find that window, the data
    // it rode has VANISHED/regressed under it — a real divergence, not benign
    // 'pending' (re-review). Only a record without the flag (legacy/unknown)
    // stays pending.
    if (recorded.window_complete) {
      const note = (recomputed && recomputed.note) || 'recompute found no data';
      return { chunk_start: recorded.chunk_start, ok: false, break: true,
        reason: `data vanished under a completed decision — ${note}`,
        recorded: { side: recorded.side, per_member: recorded.per_member, input_hash: recorded.input_hash },
        recomputed: null };
    }
    return { chunk_start: recorded.chunk_start, ok: true, break: false, pending: true,
      reason: (recomputed && recomputed.note) || 'no recompute available' };
  }
  const reasons = [];
  if (recorded.side !== recomputed.side) {
    reasons.push(`side ${recorded.side} -> ${recomputed.side}`);
  }
  const rv = Array.isArray(recorded.per_member) ? recorded.per_member : [];
  const cv = Array.isArray(recomputed.per_member) ? recomputed.per_member : [];
  if (rv.length !== cv.length || rv.some((v, i) => v !== cv[i])) {
    reasons.push(`votes [${rv}] -> [${cv}]`);
  }
  const rp = recorded.decision_price;
  const cp = recomputed.decision_price;
  let priceUnrecorded = false;   // the record never claimed a price (a stand-down)
  if (recomputed.price_pending) {
    // The entry candle (+97h) has not closed/cached yet, so the recompute cannot
    // read its open — the live producer records the decision at that open ~1h
    // before the candle caches (2026-08-12). This is benign timing, NOT a
    // divergence: DEFER the price check to a later tick. Side/votes/hash above are
    // fully verified, and once the candle caches (price_pending clears) the normal
    // PRICE_TOL check applies. This does not weaken finding-7: a VANISHED feature
    // window still returns found:false and breaks via the block at the top.
  } else if (rp == null && recorded.side === 'FLAT') {
    // A STAND-DOWN IS WRITTEN DOWN THE MOMENT IT IS DECIDED, PRICELESS
    // (owner, 2026-08-25: "the software used to give the stand down immediately").
    //
    // The committee knows its vote just after 00:00 UTC. The entry price is the
    // open of a candle an hour later, so requiring one before writing the record
    // meant a declined day sat invisible for that whole hour — the owner watching
    // an empty decision history for a call the machine had already made.
    //
    // A FLAT record carries no price BECAUSE NO TRADE HAPPENS: there is nothing
    // to fill, nothing to price, and the record makes no claim about a price.
    // Comparing a claim that was never made is not integrity checking, it is
    // manufacturing drift. Side, votes and the input hash — which is what a
    // stand-down actually asserts — are still fully checked below.
    //
    // NARROW ON PURPOSE. This skip applies ONLY to a recorded FLAT. A LONG or
    // SHORT record with no price is still a divergence and still breaks: that
    // record DOES claim a fill price, and its absence is the fault QC 169 exists
    // to catch. Priceless non-FLAT records cannot be written by live-produce.js
    // either — the gate there keeps the price requirement for anything that
    // trades — so this branch is unreachable for them by two independent means.
    priceUnrecorded = true;
  } else if (rp != null && cp != null && rp !== 0) {
    const dev = Math.abs(cp - rp) / Math.abs(rp);
    if (dev > PRICE_TOL) reasons.push(`decision_price ${rp} -> ${cp} (${(dev * 100).toFixed(2)}%)`);
  } else if ((rp == null) !== (cp == null)) {
    reasons.push(`decision_price ${rp} -> ${cp}`);
  }
  // the input hash covers the DECISION MACHINERY (chunk, votes, quorum, band,
  // side, symbol, train cutoff, config version) but NOT the price. An unexplained
  // hash divergence therefore means a config/engine drift changed a covered field
  // — a REAL break now, not merely informational (re-review). Price is checked
  // separately above with its tolerance, so a benign price revision won't trip it.
  const hashDiff = !!(recorded.input_hash && recomputed.input_hash
    && recorded.input_hash !== recomputed.input_hash);
  if (hashDiff) reasons.push(`input_hash ${recorded.input_hash} -> ${recomputed.input_hash} (config/engine drift)`);
  const isBreak = reasons.length > 0;
  return {
    chunk_start: recorded.chunk_start,
    ok: !isBreak,
    break: isBreak,
    hash_diff: hashDiff,
    // Surfaced, not silent: a check that quietly skips a field reads exactly like
    // a check that passed it.
    price_unrecorded: priceUnrecorded,
    reason: isBreak ? reasons.join('; ') : 'match',
    recorded: { side: recorded.side, per_member: rv, decision_price: rp, input_hash: recorded.input_hash },
    recomputed: { side: recomputed.side, per_member: cv, decision_price: cp, input_hash: recomputed.input_hash },
  };
}

module.exports = { compareDecision, PRICE_TOL };
