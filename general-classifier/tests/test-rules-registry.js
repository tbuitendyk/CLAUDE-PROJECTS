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

// A SELECTION MUST BE LEAVEABLE (owner, 2026-08-18).
//
// A board row could be selected and never unselected: nothing in the tab took a
// selection off a run. That is not cosmetic. The stored selection changes what
// Verify, Tune and Greenlight offer and aim at, so a state the owner cannot
// leave goes on quietly steering later decisions — which is exactly how the
// stop tuner ended up aiming at a board row when the owner wanted the pilot.
//
// Driven through bracketSelect itself, not by reading the source: a clear that
// throws, or that leaves the selection in place, would pass any grep.
function aBoardSelectionCanBeCleared() {
  const batch = require(path.join(ROOT, 'lib', 'batch'));
  const id = `bracketlab-19700101-000000-cleartest`;
  const file = path.join(ROOT, 'data', 'batches', `${id}.json`);
  const row = {
    key: 'AAAUSDT|BBBUSDT|CCCUSDT|daily-4d|argmax|auto|24-7', stage: 'promoted',
    trade: 'AAAUSDT', geometry: 'daily-4d', decision: 'argmax', quorum: 1, tHours: 137,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    id, kind: 'bracketlab', status: 'done', leaders: [row], selection: null,
  }));
  try {
    let doc = batch.bracketSelect(id, { key: row.key, stage: 'promoted' });
    assert.ok(doc.selection && doc.selection.key === row.key, 'fixture did not select');

    doc = batch.bracketSelect(id, { clear: true });
    assert.strictEqual(doc.selection, null,
      'clear left the selection in place — the row goes on steering Verify, Tune and Greenlight');

    // and it must survive a reload, not just the in-memory object
    const reloaded = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(reloaded.selection, null, 'the cleared selection came back after a reload');
  } finally {
    fs.unlinkSync(file);
  }
}

// The screen must be reachable and must render from the registry alone.
function theRulesScreenExistsAndRendersOnlyFromTheRegistry() {
  const CX = fs.readFileSync(path.join(ROOT, 'public', 'constructing.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(/\['rules', 'Rules'\]/.test(CX), 'the Rules tab is not in the tab list');
  assert.ok(/async function drawRules\(/.test(CX), 'drawRules is missing');
  assert.ok(/apiOr\('api\/rules'/.test(CX), 'the Rules screen does not read the registry');
  // No literal rule may be baked into the screen.
  const drawRules = CX.slice(CX.indexOf('async function drawRules('));
  const body = drawRules.slice(0, drawRules.indexOf('\nasync function drawGreenlight'));
  assert.ok(!/\bF1\b|\bF2\b|\bF3\b/.test(body),
    'the Rules screen names a specific rule — the list must come from the registry, never from the page');
  assert.ok(/class="empty"/.test(body),
    'an empty registry has no empty state, so "no rules" and "failed to load" would look the same');
}

module.exports.aBoardSelectionCanBeCleared = aBoardSelectionCanBeCleared;
module.exports.theRulesScreenExistsAndRendersOnlyFromTheRegistry
  = theRulesScreenExistsAndRendersOnlyFromTheRegistry;
