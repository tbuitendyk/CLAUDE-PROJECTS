// THE MOST REPEATED DEFECT IN THIS REPO: a screen reads a field off a reply and
// the producer of that reply has never written it. It renders as "—", or as a
// permanently-false badge, or as a clause that never prints — always looking
// like a measurement, never being one. It has now happened at least nine times:
//
//   l.vsNulls          board column, dead                       (2026-08-17)
//   s.verdict/s.status planted check, NOT CHECKED forever       (2026-08-17)
//   #ht2hl values      age-dial launcher, every launch threw    (2026-08-16)
//   declaredPermute    forwarded by the form, dropped by route  (2026-08-17)
//   ctx1 / ctx2        null verdict unreadable for any triple   (2026-08-17)
//   v.passed           History Tuning could never say PASS      (2026-08-17)
//   dm.digest/coins/files/utc   data fingerprint blank          (2026-08-17)
//   m.participation / m.metrics inspect columns all "—"         (2026-08-17)
//   pl.nullBoards      run-size equation off by 20x             (2026-08-17)
//
// Every one was found by a person reading two files side by side. This checks
// the pairing mechanically: for each reply the page consumes, take the field
// names the page READS and the field names the producer WRITES, and fail on any
// name that only one side knows about.
//
// Watched failing 2026-08-17: restoring v.passed, dm.digest, m.participation or
// pl.nullBoards each fails its own pair.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
// Strip BOTH comment styles. A // filter alone is not enough here: these pages
// carry <!-- --> comments inside their template strings, and a comment that
// names the dead field it replaced makes a must-be-gone check match its own
// documentation. That has now bitten this repo three times (s.verdict, the
// sweep verifier, and dm.overallDigest while writing this very file).
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const CX = read('public/constructing.js');

// Pull `<v>.<name>` reads out of a slice of page source.
function fieldsRead(src, varName) {
  return [...new Set([...src.matchAll(new RegExp(`\\b${varName}\\.(\\w+)`, 'g'))].map((m) => m[1]))];
}

// Pull the TOP-LEVEL keys out of an object literal. Depth matters: the manifest
// nests { files, bytes, digest } inside `symbols`, and a flat scan therefore
// reported dm.digest and dm.files as written when they exist only per symbol —
// which is exactly the fault this file is here to catch, so the check has to be
// sharper than the bug.
function keysWritten(src) {
  const keys = new Set();
  let depth = 0;
  const re = /([{}])|(\w+)\s*(:|,)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1] === '{') { depth++; continue; }
    if (m[1] === '}') { depth--; continue; }
    if (depth <= 1) keys.add(m[2]);
  }
  return keys;
}

// Slice a source between two anchors, failing loudly if either moved.
function between(src, from, to, label) {
  const i = src.indexOf(from);
  assert(i >= 0, `${label}: anchor "${from}" is gone — this pairing needs re-aiming, not deleting`);
  const j = src.indexOf(to, i + from.length);
  assert(j > i, `${label}: closing anchor "${to}" is gone`);
  return src.slice(i, j);
}

const PAIRS = [
  {
    label: 'History Tuning verdict',
    reader: () => between(CX, 'api/historytuning/', '</p>`;', 'HT verdict reader'),
    varName: 'v',
    writer: () => between(read('server.js'), 'holdPassed, drawCount', '});', 'HT verdict route')
      + between(read('server.js'), 'res.json({\n      winner: winKey', '});', 'HT verdict route head'),
    // `error` is the catch branch's own shape, not part of the success reply
    allowExtra: ['error'],
  },
  {
    label: 'data fingerprint',
    reader: () => between(CX, '<b>Data fingerprint:</b>', '</p>`', 'fingerprint reader'),
    varName: 'dm',
    writer: () => between(read('lib/manifest.js'), 'return {\n      at: new Date', '\n    };', 'manifest return'),
    // the catch branch's own shape, and the one path that already worked
    allowExtra: ['error'],
  },
  {
    label: 'inspect members',
    reader: () => between(CX, 'mem.map((m, i) =>', '</tr>`;', 'inspect member reader'),
    varName: 'm',
    writer: () => between(read('lib/inspect.js'), 'const members = specs.map', '}));', 'inspect members'),
    allowExtra: [],
  },
  {
    label: 'run-size plan',
    reader: () => between(CX, '<b>Size:</b>', '</p>`', 'plan reader'),
    varName: 'pl',
    writer: () => between(read('lib/batch.js'), 'plan: { branches:', '},', 'plan literal'),
    allowExtra: [],
  },
];

function everyFieldAScreenReadsIsAFieldItsProducerWrites() {
  const problems = [];
  for (const p of PAIRS) {
    const readerSrc = p.reader();
    const written = keysWritten(p.writer());
    for (const f of fieldsRead(readerSrc, p.varName)) {
      if (p.allowExtra.includes(f)) continue;
      if (!written.has(f)) {
        problems.push(`${p.label}: the screen reads ${p.varName}.${f}, which its producer never writes`);
      }
    }
  }
  assert.deepStrictEqual(problems, [], problems.join('\n     '));
}

// The fingerprint reader uses derived reads (Object.keys/values) rather than
// top-level fields, so pin the three names it does depend on explicitly —
// otherwise the pairing above could pass on a reader that reads nothing.
function theFingerprintReadsTheThreeNamesTheManifestActuallyWrites() {
  const src = between(CX, '<b>Data fingerprint:</b>', '</p>`', 'fingerprint reader');
  for (const f of ['overallDigest', 'symbols', 'at']) {
    assert(new RegExp(`dm\\.${f}\\b`).test(src),
      `the data fingerprint no longer reads dm.${f} — that is a name lib/manifest.js writes`);
  }
  for (const dead of ['digest', 'coins', 'files', 'utc']) {
    assert(!new RegExp(`dm\\.${dead}\\b`).test(src),
      `the data fingerprint reads dm.${dead} again — nothing writes it, so the panel renders blank`);
  }
}

// The verdict needs BOTH declared rules, and "no draws yet" is not a failure.
function theHistoryTuningBadgeNeedsBothRulesAndHasAPendingState() {
  const src = between(CX, 'api/historytuning/', '</p>`;', 'HT verdict reader');
  assert(/v\.holdPassed\s*&&\s*v\.nullPassed/.test(src),
    'the badge must require BOTH the hold rule and the null rule — the sentence already says so');
  assert(/PENDING/.test(src),
    'with no null draws yet there is no claim to make; calling that NO retires a candidate on a measurement that has not happened');
  assert(!/v\.passed\b/.test(src), 'v.passed is back — the endpoint has never returned it');
}

module.exports = {
  everyFieldAScreenReadsIsAFieldItsProducerWrites,
  theFingerprintReadsTheThreeNamesTheManifestActuallyWrites,
  theHistoryTuningBadgeNeedsBothRulesAndHasAPendingState,
};
