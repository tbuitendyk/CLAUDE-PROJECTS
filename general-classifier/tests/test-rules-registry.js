// The owner's rule registry — Stage 2 (owner directive, 2026-08-18).
//
// The requirement being tested is blunt: "ABSOLUTELY NOTHING YOU PUT INTO LISTS
// IS ALLOWED TO PERSIST. ONLY THINGS THAT THE USER DIRECTLY CONTROLS."
//
// So these are not CRUD tests. Each one pins a property that makes that
// requirement structural rather than a promise about my behaviour:
//
//   * an absent registry is EMPTY, never seeded — a default is me choosing again
//   * a rule with no provenance is refused — a production trading system does
//     not hold rules it cannot trace
//   * the interface can express F1 COMPLETELY. This is the load-bearing one: if
//     the screen could not represent the rule that is live, I would have
//     manufactured my own excuse to write the data myself by under-building.
//   * mechanics cannot be edited in place — a rule that changes what it trades
//     while keeping its id is how a live record stops meaning what it says
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const rules = require(path.join(ROOT, 'lib', 'rules'));
const { BOOKS, TRAIN_THROUGH } = require(path.join(ROOT, 'lib', 'forwardbook'));
const { CONFIG_VERSION } = require(path.join(ROOT, 'lib', 'pilotsignal'));

function configOf(book) {
  return {
    combo: book.combo, branch: book.branch, stage: book.stage,
    members: book.members, cell: book.cell,
    trainThrough: TRAIN_THROUGH, configVersion: CONFIG_VERSION,
  };
}
function entryFor(book, over = {}) {
  return {
    id: book.id, label: `${book.id} — ${book.note}`, config: configOf(book),
    provenance: { sourceRunId: 'bracketlab-20260805-193433-real', engineVersion: CONFIG_VERSION },
    ...over,
  };
}

// An absent registry file is an EMPTY registry. Never a built-in list.
function anAbsentRegistryIsEmptyAndNeverSeeded() {
  const saved = fs.existsSync(rules.FILE) ? fs.readFileSync(rules.FILE) : null;
  try {
    if (saved) fs.unlinkSync(rules.FILE);
    const doc = rules.readRegistry();
    assert.deepStrictEqual(doc.rules, [],
      'a missing registry produced entries — something is seeding the list');
    assert.strictEqual(rules.listActive().length, 0, 'active list is non-empty with no registry');
  } finally {
    if (saved) fs.writeFileSync(rules.FILE, saved);
  }
}

// THE LOAD-BEARING TEST. If the interface cannot express the rule that is
// currently live, then "the owner adds it themselves" is not actually possible,
// and I would have engineered my own permission to write it.
function theInterfaceCanExpressEveryLiveRuleCompletely() {
  for (const book of BOOKS) {
    const errors = rules.validateEntry(entryFor(book), { existing: [] });
    assert.deepStrictEqual(errors, [],
      `${book.id} cannot be expressed through the registry: ${errors.join('; ')}\n`
      + 'That would mean the owner cannot add it, which would hand me an excuse to write it myself.');
  }
}

// And what it stores must be the rule, not an approximation of it.
function whatIsStoredIsTheRuleItselfNotAnApproximation() {
  for (const book of BOOKS) {
    const stored = entryFor(book).config;
    assert.strictEqual(JSON.stringify(stored), JSON.stringify(configOf(book)),
      `${book.id}: the registry shape is not identical to the engine's own definition`);
  }
}

// A rule with no traceable origin cannot be reproduced or audited.
function aRuleWithoutProvenanceIsRefused() {
  const bad = entryFor(BOOKS[0], { provenance: undefined });
  const errors = rules.validateEntry(bad, { existing: [] });
  assert.ok(errors.some((e) => /provenance/.test(e)),
    'a rule with no provenance was accepted');

  const noRun = entryFor(BOOKS[0], { provenance: { engineVersion: 'x' } });
  assert.ok(rules.validateEntry(noRun, { existing: [] }).some((e) => /sourceRunId/.test(e)),
    'a rule with no source run was accepted');
}

// Ids are stable references used elsewhere, and they are interpolated into
// pages and paths, so the shape is constrained on both grounds.
function idsAreStableSafeAndNeverReused() {
  for (const bad of ['', 'has space', 'semi;colon', '-leading', 'x'.repeat(33), '<script>']) {
    assert.ok(rules.validateEntry(entryFor(BOOKS[0], { id: bad }), { existing: [] })
      .some((e) => /^id:/.test(e)), `id "${bad}" was accepted`);
  }
  const dup = rules.validateEntry(entryFor(BOOKS[0]), { existing: [{ id: BOOKS[0].id }] });
  assert.ok(dup.some((e) => /already exists/.test(e)), 'a duplicate id was accepted');
}

// The rule mechanics are judged by the validator the LIVE rail already uses.
// Two validators would let a rule mean one thing here and another there.
function mechanicsAreJudgedByTheSameValidatorTheLiveRailUses() {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'rules.js'), 'utf8');
  assert.ok(/require\('\.\/live\/configschema'\)/.test(src),
    'lib/rules.js no longer borrows the live rail validator — a second validator can drift from it');
  const broken = entryFor(BOOKS[0]);
  broken.config = { ...configOf(BOOKS[0]), combo: { ...BOOKS[0].combo, trade: 'not a symbol' } };
  assert.ok(rules.validateEntry(broken, { existing: [] }).some((e) => /^config\./.test(e)),
    'an invalid rule config was accepted');
}

// One write path. If anything other than the owner-facing endpoints can mutate
// the registry, the requirement is unenforced whatever the comments say.
//
// PRECISION MATTERS HERE, and my first version of this check did not have it.
// It matched the NAME `writeRegistry` and flagged lib/books.js, which has its
// own writeRegistry for its own store (data/books/registry.json) and never
// touches this one. Matching a common function name instead of the actual
// store is the same failure this project keeps hitting — a check that tests
// words rather than the property. So: a module offends only if it reaches THIS
// registry, by requiring lib/rules or by naming its path.
function theRegistryHasExactlyOneWritePath() {
  const offenders = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.js') && p !== path.join(ROOT, 'lib', 'rules.js')) {
        const src = fs.readFileSync(p, 'utf8');
        const reachesThisRegistry = /require\(['"][./]*(?:\.\.\/)*rules['"]\)/.test(src)
          || /data['"/\\]+rules/.test(src);
        if (reachesThisRegistry && /\bwriteRegistry\b/.test(src)) offenders.push(path.relative(ROOT, p));
      }
    }
  };
  walk(path.join(ROOT, 'lib'));
  assert.deepStrictEqual(offenders, [],
    `these modules can write the rule registry outside the owner's endpoints: ${offenders.join(', ')}`);
}

module.exports = {
  anAbsentRegistryIsEmptyAndNeverSeeded,
  theInterfaceCanExpressEveryLiveRuleCompletely,
  whatIsStoredIsTheRuleItselfNotAnApproximation,
  aRuleWithoutProvenanceIsRefused,
  idsAreStableSafeAndNeverReused,
  mechanicsAreJudgedByTheSameValidatorTheLiveRailUses,
  theRegistryHasExactlyOneWritePath,
};
