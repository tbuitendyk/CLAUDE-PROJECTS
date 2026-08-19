#!/usr/bin/env node
// register-f1-setup.js (IMPLEMENTATION-PLAN 9.1) -- register the running F1
// pilot as setup 'f1-pilot' in the Live Trading registry, state DRAFT.
//
// DRAFT ON PURPOSE: draft setups never produce intents and never enter the
// allowlist, so this cannot double-trade F1 — it only makes the pilot VISIBLE
// on the Live Trading tab next to future setups. The flip to PAPER (the
// byte-identical parallel run, plan 10.4) is a separate deliberate step after
// the executor deploy; the flip to LIVE is the owner-decided cutover (10.5:
// keep both — so possibly never).
//
// Idempotent: refuses if f1-pilot already exists.
const reg = require('../lib/live/setups');
const { BOOKS, TRAIN_THROUGH } = require('../lib/forwardbook');
const { CONFIG_VERSION } = require('../lib/pilotsignal');

const F1 = BOOKS.find((b) => b.id === 'F1');
if (reg.getSetup('f1-pilot')) {
  console.log('f1-pilot already registered — nothing to do');
  process.exit(0);
}
const setup = reg.createSetup({
  id: 'f1-pilot',
  name: 'F1 pilot (LTCUSDT) — running on the original rails',
  ownerId: 'owner',
  configSnapshot: {
    combo: { ...F1.combo },
    branch: { ...F1.branch },
    stage: F1.stage,
    members: F1.members.map((m) => ({ model: m.model, view: m.view })),
    cell: { ...F1.cell },
    trainThrough: TRAIN_THROUGH,
    configVersion: CONFIG_VERSION,   // the SAME version string the live pilot hashes with
  },
  provenanceRef: null,               // pre-dates the greenlight machinery; provenance
                                     // lives in vps-access reports/FORWARD-BOOKS.md
  clipUsd: 10,
  stopPct: null,
  executionTargetRef: 'mx-1',
  by: 'owner',
});
console.log(`registered ${setup.id} state=${setup.state} (draft: visible, inert — the pilot keeps its own rails)`);
