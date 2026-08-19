// pairs.js -- ONE answer to "which trading pairs does this system need?"
//
// WHY THIS EXISTS (owner, 2026-08-19). The answer was written out in four
// places: the data refresher and three separate checking scripts. Four copies
// of one rule is four chances to disagree, and they already had: one copy
// looked for the symbols in configSnapshot.members[], which carries {model,
// view} and no symbol at all. It matched nothing, fell back to the traded pair
// alone, and printed a healthy green line for one pair while the two context
// pairs the committee also reads went unwatched. That is the same defect as the
// hardcoded list it replaced, only quieter — a monitor reporting a subset as
// the whole is worse than no monitor, because it is believed.
//
// The pairs live in configSnapshot.combo as {trade, ctx1, ctx2}. That is what
// lib/live/signal.js reads to build a committee, so it is the only definition
// that can be right by construction.
//
// WHICH SETUPS COUNT. paper and live obviously. STOPPED too: stopping halts new
// entries but existing positions still run to their scheduled exits, and both
// the exit and the reproduce-check need current candles. Only draft (never
// traded) and retired (done) are skipped.
const ACTIVE_STATES = ['paper', 'live', 'stopped'];

// Pure: the pairs one setup needs. Exported so a caller can ask about a single
// setup without going through the registry.
function pairsForSetup(setup) {
  const out = new Set();
  if (!setup) return out;
  const combo = (setup.configSnapshot || {}).combo || {};
  for (const k of ['trade', 'ctx1', 'ctx2']) {
    if (typeof combo[k] === 'string' && combo[k]) out.add(combo[k]);
  }
  // The traded pair is also carried at the top level. Usually identical to
  // combo.trade; included because a setup whose snapshot is incomplete should
  // still get its traded pair refreshed rather than nothing.
  if (typeof setup.tradedPair === 'string' && setup.tradedPair) out.add(setup.tradedPair);
  return out;
}

// Every pair the given setups need, sorted for stable output.
function pairsForSetups(setups, states = ACTIVE_STATES) {
  const want = new Set();
  for (const s of setups || []) {
    if (states && !states.includes(s.state)) continue;
    for (const p of pairsForSetup(s)) want.add(p);
  }
  return [...want].sort();
}

// The registry's answer. Throws if the registry cannot be read — callers decide
// what an unreadable registry means for them, because the safe answer differs:
// the refresher should keep refreshing what it was, a status screen should say
// it does not know. Neither is served by a silent empty list.
function pairsInUse(states = ACTIVE_STATES) {
  const reg = require('./setups');
  return pairsForSetups(reg.listSetups(), states);
}

module.exports = { ACTIVE_STATES, pairsForSetup, pairsForSetups, pairsInUse };
