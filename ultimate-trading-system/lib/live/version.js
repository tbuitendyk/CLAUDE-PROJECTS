// Engine/schema version identifiers for the Live Trading machinery.
//
// ENGINE_VERSION rides in every setup's provenance (NEXT-RELEASE point 18): a
// greenlight is evidence about THAT engine's arithmetic, so the version is
// recorded at greenlight/shuttle time and a later engine upgrade can flag the
// setup for re-validation instead of silently changing what its config means.
const pkg = require('../../package.json');

const SETUP_SCHEMA_VERSION = 1;   // TradingSetup record shape (lib/live/setups.js)
const CONFIG_SCHEMA_VERSION = 1;  // lab-config vocabulary  (lib/live/configschema.js)

// package version + schema versions: bumps whenever either moves.
//
// THE PREFIX IS THE PRODUCT'S OWN NAME (owner order, 2026-08-29: "fix that gc-
// prefix"). It said `gc-` — the initials of general-classifier, the folder this
// was renamed out of on 2026-08-19 — so every setup and every greenlight has
// been stamping itself with a product that no longer exists, and the Trade
// page's Engine version row was showing it. Safe to change and checked before
// changing: this string is WRITTEN onto a setup and a greenlight and DISPLAYED,
// and it is compared nowhere — the three places that do compare an engine
// version (lib/stages.js, lib/planted.js, lib/httwo.js) all read the bare
// package version, not this. Nothing was stored under the old prefix either;
// the box held no setups when this changed.
const ENGINE_VERSION = `uts-${pkg.version}/setup-${SETUP_SCHEMA_VERSION}/config-${CONFIG_SCHEMA_VERSION}`;

module.exports = { ENGINE_VERSION, SETUP_SCHEMA_VERSION, CONFIG_SCHEMA_VERSION };
