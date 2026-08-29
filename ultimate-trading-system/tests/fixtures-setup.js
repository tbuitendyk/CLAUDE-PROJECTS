// TEST DATA ONLY.
//
// Four tests need a plausible saved profile to work on — a combination of
// coins, a chunk shape, a committee and a cell. They used to borrow one from
// lib/forwardbook.js, which held three trade set-ups written into the product
// itself. The owner's rule is that nothing is ever baked into the code and
// everything the system does is originated by them through the interface, so
// that file is gone (2026-08-28) and its fixtures live here instead.
//
// Nothing in this file is reachable from the running system. It is not a
// default, not a suggestion, and not a starting point: it is scaffolding for
// tests, and the product neither reads it nor knows it exists.
const { specsFor } = require('../lib/bracketwork');

// An arbitrary cutoff, chosen only so the freeze arithmetic has a date to
// work with: 2026-08-11T00:00:00Z.
const A_CUTOFF_MS = Date.UTC(2026, 7, 11);

// One config snapshot of the shape lib/live/configschema.js validates. The
// committee is read from the engine rather than typed, so a reading added to
// the system cannot leave this fixture describing a committee that no longer
// exists.
function aSetupConfig(over = {}) {
  return {
    combo: { trade: 'LTCUSDT', ctx1: 'XRPUSDT', ctx2: 'BCHUSDT', size: 3 },
    branch: { geometry: 'daily-4d', decision: 'argmax', band: 1.69, weekdaysOnly: false },
    stage: 'slim',
    members: specsFor(3, 'slim').map((s) => ({ model: s.model, view: s.view })),
    cell: { quorum: 1, entry: 'market', gate: 'directional', dMult: null, tHours: 137, trailMult: null, armMult: null },
    ...over,
  };
}

module.exports = { A_CUTOFF_MS, aSetupConfig };
