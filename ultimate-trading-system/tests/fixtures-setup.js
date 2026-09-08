// TEST DATA ONLY.
//
// The live tests need a plausible saved profile to work on — a combination of
// coins, a chunk shape, a committee and a cell. They used to borrow one from
// lib/forwardbook.js, which held three trade set-ups written into the product
// itself. The owner's rule is that nothing is ever baked into the code and
// everything the system does is originated by them through the interface, so
// that file is gone (2026-08-28) and its fixtures live here instead.
//
// Since the older sweep engine was retired (3.97.0) a configuration is always
// a stage-engine one, so the fixture is built THROUGH the one door a real
// greenlight comes through: a synthetic Stage 4 source shaped like what
// lib/stages.js hands over, turned into a configuration by
// lib/live/greenlight.js itself — never a shape typed here that the product
// might have moved away from.
//
// Nothing in this file is reachable from the running system. It is not a
// default, not a suggestion, and not a starting point: it is scaffolding for
// tests, and the product neither reads it nor knows it exists.

// An arbitrary cutoff, chosen only so the freeze arithmetic has a date to
// work with: 2026-08-11T00:00:00Z.
const A_CUTOFF_MS = Date.UTC(2026, 7, 11);

// A synthetic source shaped like what lib/stages.js hands the greenlight door:
// a three-coin unit, a survivor with the agreement it carries, the members as
// the stage 2 set trained them, the verdict block that stood.
function aStage4Source(over = {}) {
  return {
    set: { id: 's4-test-1', stage: 4, name: 'S4 #1 - LTCUSDT daily-4d', release: '3.90.0', unit: 'LTCUSDT|XRPUSDT|BCHUSDT|daily-4d', unitName: 'LTCUSDT + XRPUSDT + BCHUSDT daily-4d', ruleSentence: 'gate is directional; t is 41h to 89h', counts: { survivors: 3 }, parent: { id: 's3-test-1', name: 'S3 #1' }, stage2: { id: 's2-test-1', name: 'S2 #1' }, campaign: 'ltc-drill' },
    gate: { id: 's4-test-1-v1', at: '2026-09-08T00:00:00.000Z', release: '3.90.0', look: 1 },
    unit: { trade: 'LTCUSDT', ctx1: 'XRPUSDT', ctx2: 'BCHUSDT', size: 3, geometry: 'daily-4d' },
    survivor: { si: 4, label: 'count 50% market t65h · argmax auto 24/7', decision: 'argmax', bandMode: 'auto', bandPct: 1.69, weekdaysOnly: false, entry: 'market', gate: 'directional', dMult: null, tHours: 137, trailMult: null, armMult: null, agreeRule: 'count', agreeBar: 'all', agreePct: 50, agreeCopy: 98, agreeBoth: false, agreePersist: 0, members: 8, avgRung: 4, avgVoices: 5, avgTest: 12.5, avgHold: 4.2 },
    pick: { by: 'depth', index: 1, si: 4, label: 'count 50% market t65h · argmax auto 24/7', worst: 0, mean: 0, per: { tHours: 0 }, of: 3 },
    survivors: [],
    members: [{ model: 'logreg', view: 'full' }, { model: 'logreg', view: 'prices' }, { model: 'logreg', view: 'volume' }, { model: 'logreg', view: 'pricevol' }, { model: 'boost', view: 'full' }, { model: 'boost', view: 'prices' }, { model: 'boost', view: 'volume' }, { model: 'boost', view: 'pricevol' }],
    training: { trainOn: 'direction', weightCap: null, windowLayout: 'reserve61', startMonth: '2023-01', endMonth: '2026-06', allLoaded: false, nullN: 9 },
    fee: 0.00125,
    readings: { heldBack: { money: 4.2, trades: 12 }, unread: { money: 1.1, trades: 6, look: 1 } },
    ...over,
  };
}

// One configuration snapshot of the shape lib/live/configschema.js validates,
// made by the product's own door from the source above.
function aSetupConfig(over = {}) {
  const { configFromStage4 } = require('../lib/live/greenlight');
  return { ...configFromStage4(aStage4Source()), configVersion: 'test/v1', ...over };
}

module.exports = { A_CUTOFF_MS, aStage4Source, aSetupConfig };
