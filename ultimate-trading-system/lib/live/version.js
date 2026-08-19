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
const ENGINE_VERSION = `gc-${pkg.version}/setup-${SETUP_SCHEMA_VERSION}/config-${CONFIG_SCHEMA_VERSION}`;

module.exports = { ENGINE_VERSION, SETUP_SCHEMA_VERSION, CONFIG_SCHEMA_VERSION };
