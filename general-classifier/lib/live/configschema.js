// The ONE parameter vocabulary (NEXT-RELEASE point 5, plan step 2.1).
//
// A live trading job's configSnapshot is EXACTLY the book/lab shape the engine
// primitives already consume — the same object lib/forwardbook.js freezes and
// lib/bracketwork.js (buildCombo/trainMembers/quorumCall) + lib/bracket.js
// (simCell) execute. Nothing is translated between lab and live: a greenlighted
// config means the same thing live BECAUSE it is the same object driving the
// same functions. This module only VALIDATES that shape — it never reinterprets
// a field (the QC-register instrumentation lesson: reinterpretation is where a
// greenlight silently stops meaning what it meant).
//
// Vocabulary (from forwardbook.BOOKS + bracketwork/bracket usage):
//   combo    { trade, ctx1, ctx2, size }        pairs + committee width class
//   branch   { geometry, decision, band, weekdaysOnly }
//   stage    'slim' | 'promoted'                which member roster specsFor builds
//   members  [{ model, view }, ...]             frozen roster (cross-checked vs stage)
//   cell     { quorum, entry, gate, dMult, tHours, trailMult, armMult }
//   trainThrough  ms epoch — the training freeze; members are trained ONCE
//                 through this date and never retrained live.
//   configVersion string — bumped on ANY change to the mechanics; rides in the
//                 intent input_hash so drift is provable (pilotsignal pattern).

const { GEOMETRIES } = require('../dataset');

const SYMBOL_RE = /^[A-Z0-9]{5,12}$/;
const MODELS = new Set(['logreg', 'boost']);
const VIEWS = new Set(['full', 'prices', 'volume', 'cross']);
const DECISIONS = new Set(['argmax', 'directional']);
const ENTRIES = new Set(['market', 'breakout']);
const GATES = new Set(['directional', 'active']);
const STAGES = new Set(['slim', 'promoted']);

function fail(errors, msg) { errors.push(msg); }

// Validate a configSnapshot. Returns { ok, errors } — never throws, so callers
// can surface every problem at once instead of fixing them one 400 at a time.
function validateConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') return { ok: false, errors: ['config must be an object'] };

  const combo = cfg.combo || {};
  for (const k of ['trade', 'ctx1', 'ctx2']) {
    if (!SYMBOL_RE.test(String(combo[k] || ''))) fail(errors, `combo.${k}: not a valid symbol`);
  }
  if (combo.size !== 3) fail(errors, 'combo.size: only size-3 combos are in the vocabulary');

  const br = cfg.branch || {};
  if (!GEOMETRIES[br.geometry]) fail(errors, `branch.geometry: unknown geometry '${br.geometry}'`);
  if (!DECISIONS.has(br.decision)) fail(errors, `branch.decision: must be one of ${[...DECISIONS]}`);
  if (!Number.isFinite(br.band) || br.band <= 0 || br.band >= 50) {
    fail(errors, 'branch.band: must be a finite dormant-band percent in (0, 50)');
  }
  if (typeof br.weekdaysOnly !== 'boolean') fail(errors, 'branch.weekdaysOnly: must be boolean');

  if (!STAGES.has(cfg.stage)) fail(errors, `stage: must be one of ${[...STAGES]}`);

  if (!Array.isArray(cfg.members) || cfg.members.length === 0) {
    fail(errors, 'members: must be a non-empty array of {model, view}');
  } else {
    cfg.members.forEach((m, i) => {
      if (!m || !MODELS.has(m.model)) fail(errors, `members[${i}].model: must be one of ${[...MODELS]}`);
      if (!m || !VIEWS.has(m.view)) fail(errors, `members[${i}].view: must be one of ${[...VIEWS]}`);
    });
  }

  const cell = cfg.cell || {};
  if (!Number.isInteger(cell.quorum) || cell.quorum < 1) fail(errors, 'cell.quorum: must be integer >= 1');
  if (Array.isArray(cfg.members) && Number.isInteger(cell.quorum) && cell.quorum > cfg.members.length) {
    fail(errors, `cell.quorum: ${cell.quorum} exceeds committee size ${cfg.members.length}`);
  }
  if (!ENTRIES.has(cell.entry)) fail(errors, `cell.entry: must be one of ${[...ENTRIES]}`);
  if (!GATES.has(cell.gate)) fail(errors, `cell.gate: must be one of ${[...GATES]}`);
  if (!Number.isFinite(cell.tHours) || cell.tHours <= 0 || cell.tHours > 24 * 30) {
    fail(errors, 'cell.tHours: must be a positive hold in hours (<= 720)');
  }
  for (const k of ['dMult', 'trailMult', 'armMult']) {
    const v = cell[k];
    if (v != null && (!Number.isFinite(v) || v <= 0)) fail(errors, `cell.${k}: must be null or a positive number`);
  }
  if (cell.entry === 'breakout' && cell.dMult == null) {
    fail(errors, 'cell.dMult: required for breakout entry');
  }

  if (!Number.isInteger(cfg.trainThrough) || cfg.trainThrough <= 0) {
    fail(errors, 'trainThrough: must be a ms-epoch training freeze');
  }
  if (typeof cfg.configVersion !== 'string' || !cfg.configVersion.trim()) {
    fail(errors, 'configVersion: must be a non-empty string');
  }

  return { ok: errors.length === 0, errors };
}

module.exports = { validateConfig, SYMBOL_RE };
