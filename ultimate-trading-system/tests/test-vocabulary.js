// Retired vocabulary must stay retired (owner, repeatedly; GLOSSARY.md).
// "luck" in any form is banned from user-facing text — the null-run
// vocabulary is the only sanctioned way to talk about informationless
// comparisons. Authorized as manifest item 7 of the owner's build order.
// Watched failing 2026-08-03: 4 live hits on the then-deployed page plus
// one in the design ledger, all since fixed.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const SCAN = [
  'public/setup.html',
  'public/construct.html',
  'public/construct.js',
  'public/trade.html',
  'WORKFLOW.md',
  'DESIGN-HISTORY-TUNING.md',
  // error strings in these reach the owner through HTTP 400s
  'lib/batch.js',
  'lib/historytuning.js',
  'lib/history.js',
  'lib/compare.js',
  'lib/verdict.js',
  'lib/planted.js',
];
const BANNED = /\bluck\w*\b/i;

module.exports = {
  async retiredWordsStayOutOfUserFacingText() {
    const hits = [];
    for (const rel of SCAN) {
      const file = path.join(ROOT, rel);
      // A VANISHED TARGET IS A FAILURE, not a skip. This used to `continue`, so
      // deleting a scanned file quietly shrank what the guard protected and the
      // suite stayed green — which is exactly how this check came to be
      // watching four files that no longer existed (audit, 2026-08-21).
      assert.ok(fs.existsSync(file), `${rel} is on the scan list but is not in the tree`);
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (BANNED.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 90)}`);
      });
    }
    assert.strictEqual(hits.length, 0, `retired vocabulary found:\n${hits.join('\n')}`);
  },
};
