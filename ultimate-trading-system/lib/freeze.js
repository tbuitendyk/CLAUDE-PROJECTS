// splitFrozen -- divide chunks into what a model may TRAIN on and what it is
// SCORED on, given a cutoff.
//
// This is pure chunk arithmetic: it knows nothing about any particular
// pair or rule. It used to live in a module that ALSO held three trade
// set-ups written into the product, so every part of the generalized rail
// that needed this primitive had to import from the very module that wanted
// deleting — the coupling that made "delete the one-off" look impossible.
// Splitting it out is what made the deletion possible; the set-ups were
// removed on 2026-08-28 by owner order. Nothing about the
// function changed in moving it; only where it lives.


// The frozen split, as a pure function so it can be tested without market data
// — the first version keyed on a chunk field (endTs) that does not exist, which
// silently matched nothing and was caught only by the guard below. Chunks carry
// startTs only, so a period's span is inferred from the spacing between them.
//
// A training period must END at or before the cutoff, not merely start before
// it: a period that straddles the cutoff has its outcome in forward territory,
// which is exactly the leak this freeze exists to prevent.
// outcomeMs is how long after a period STARTS its trade is finished — for
// daily-4d that is exitOffsetH = 138h, nearly six days, while periods step
// every 24h. Using the STEP as if it were the SPAN (the first version did)
// leaves training periods whose outcome lands inside the scoring window, which
// is the leak the freeze exists to prevent. It was ~5 periods of 2397 here:
// small, but small is not the same as declared.
// The cutoffs are REQUIRED. They used to default to one config's dates, so any
// caller that forgot them silently got that config's freeze applied to entirely
// different data — a hidden hardcoding that produced a confident answer rather
// than an error. Whoever splits must say where they are splitting.
function splitFrozen(chunks, trainThrough, scoreFrom, outcomeMs = 0) {
  if (!Number.isFinite(trainThrough)) {
    throw new Error('splitFrozen: trainThrough is required — a training cutoff must be '
      + "stated by the caller, never inherited from some other book's dates");
  }
  // scoreFrom is OPTIONAL and means "also give me the forward-scored chunks".
  // The live rail never scores forward — it trains and then decides on today —
  // so it passes none and gets an empty fwdChunks, which is the truth rather
  // than a borrowed date that would quietly define a scoring window nobody asked
  // for.
  const scoring = Number.isFinite(scoreFrom);
  if (chunks.length < 2) return { trainChunks: chunks.slice(), fwdChunks: [], periodMs: null, outcomeMs };
  const gaps = [];
  for (let i = 1; i < chunks.length; i++) gaps.push(chunks[i].startTs - chunks[i - 1].startTs);
  gaps.sort((a, b) => a - b);
  const periodMs = gaps[Math.floor(gaps.length / 2)]; // median spacing: robust to listing gaps
  const span = Math.max(periodMs, outcomeMs);
  return {
    periodMs,
    outcomeMs,
    span,
    trainChunks: chunks.filter((c) => c.startTs + span <= trainThrough),
    fwdChunks: scoring ? chunks.filter((c) => c.startTs >= scoreFrom) : [],
  };
}

module.exports = { splitFrozen };
