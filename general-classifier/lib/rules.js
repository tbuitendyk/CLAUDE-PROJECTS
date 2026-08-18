// rules.js -- the OWNER'S rule registry. Stage 2 of taking trading rules out of
// source code.
//
// WHY THIS EXISTS (owner, 2026-08-18). A trading engine built to discover rules
// cannot keep its rules in a source file. F1 — the rule the live pilot trades
// real money with — is a literal in lib/forwardbook.js, which means changing
// what the engine trades requires editing code, which means it requires me.
// That is a dependency on the wrong party, built into a production system.
//
// THE RULE THIS MODULE ENFORCES: entries come from the owner, through the
// interface, and from nowhere else.
//   * NO SEED, NO DEFAULTS. A missing or empty registry is an empty registry.
//     It never falls back to a built-in list, because a built-in list is
//     exactly the thing being removed. A fresh box shows nothing and says so.
//   * ONE WRITE PATH. writeRegistry is the only mutator, and the only callers
//     are the owner-facing endpoints. Nothing computes an entry into existence.
//   * PROVENANCE IS MANDATORY. An entry records where it came from — the run
//     that produced it, the campaign, the engine version, when, and by whom.
//     An entry that cannot say where it came from does not belong in a
//     production trading system, so it is refused at write time.
//
// VALIDATION IS BORROWED, NOT REINVENTED. lib/live/configschema.js already
// validates exactly this shape — its own header says it is "the same object
// lib/forwardbook.js freezes". Writing a second validator here would let the
// two drift, and a rule that passes one and fails the other is precisely the
// silent divergence this project keeps getting bitten by.
const fs = require('fs');
const path = require('path');
const { validateConfig } = require('./live/configschema');

const DIR = path.join(__dirname, '..', 'data', 'rules');
const FILE = path.join(DIR, 'registry.json');

// Shape of a stored entry:
//   id          owner-chosen, stable, used by anything that references the rule
//   label       owner-chosen display text; renaming never changes the id
//   config      the validated configSnapshot (combo/branch/stage/members/cell/
//               trainThrough/configVersion) — the engine vocabulary, unchanged
//   provenance  { sourceRunId, campaign, engineVersion, selectionKey, note }
//   createdUtc / createdBy   who put it here and when
//   order       owner-controlled position in the list
//   retiredUtc  set when retired; retired entries stay visible in history but
//               are not offered as targets

function readRegistry() {
  // A missing file is an EMPTY registry, never a seeded one. This is the whole
  // point: nothing exists until the owner puts it there.
  try {
    const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!doc || !Array.isArray(doc.rules)) return { rules: [] };
    return { rules: doc.rules };
  } catch (_) {
    return { rules: [] };
  }
}

// The ONLY mutator. Callers: the owner-facing endpoints in server.js. Anything
// else calling this is the defect the registry exists to prevent.
function writeRegistry(doc) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ rules: doc.rules }, null, 1));
  fs.renameSync(tmp, FILE);
  return readRegistry();
}

// Active = offered as a target. Retired entries are kept so the record of what
// once ran is not erased, but they are not choices.
function listActive() {
  return readRegistry().rules
    .filter((r) => !r.retiredUtc)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function findRule(id) {
  return readRegistry().rules.find((r) => r.id === id) || null;
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

// Every refusal below is a production trading system declining to hold a rule
// it cannot describe. None of them are style checks.
function validateEntry(entry, { existing = [] } = {}) {
  const errors = [];
  if (!entry || typeof entry !== 'object') return ['entry: must be an object'];

  if (!ID_RE.test(String(entry.id || ''))) {
    errors.push('id: 1-32 chars, letters/digits then letters/digits/_/- (it is referenced elsewhere, so it must be stable and safe to interpolate)');
  } else if (existing.some((r) => r.id === entry.id)) {
    errors.push(`id: "${entry.id}" already exists — ids are stable references and are never reused`);
  }
  if (typeof entry.label !== 'string' || !entry.label.trim()) {
    errors.push('label: required — the list is read by a person, so every row says what it is');
  }

  // PROVENANCE. A rule with no traceable origin cannot be reproduced or
  // audited, and this system exists to make results reproducible.
  const p = entry.provenance;
  if (!p || typeof p !== 'object') {
    errors.push('provenance: required — a rule must say where it came from');
  } else {
    if (typeof p.sourceRunId !== 'string' || !p.sourceRunId.trim()) {
      errors.push('provenance.sourceRunId: required — which run produced this rule');
    }
    if (typeof p.engineVersion !== 'string' || !p.engineVersion.trim()) {
      errors.push('provenance.engineVersion: required — the arithmetic this rule was found with');
    }
  }

  // The rule mechanics themselves, judged by the ONE validator the live rail
  // already uses. Reusing it is what stops a rule meaning two different things.
  const v = validateConfig(entry.config);
  if (!v.ok) for (const e of v.errors) errors.push(`config.${e}`);

  return errors;
}

module.exports = {
  readRegistry, writeRegistry, listActive, findRule, validateEntry, FILE, ID_RE,
};
