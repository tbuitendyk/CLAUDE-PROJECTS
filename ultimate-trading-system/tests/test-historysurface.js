// The History section's launchers and reader, ported from the Bracket lab.
//
// THE TRAP THIS FILE EXISTS FOR: three endpoints in this one panel take three
// DIFFERENT id keys for what looks like the same thing —
//   /api/historytuning              sourceBatchId   (a BOARD run id)
//   /api/historytuning/null         replayOf        (a TUNING run id) + nullShiftSeed
//   /api/historytuning/reserve-grade sourceHtRunId  (a TUNING run id)
// and a fourth, /api/httwo, takes examPair as a fabricated PAIR SYMBOL, not
// 'A'/'B'. Pattern-matching the neighbour is how each of these ships broken;
// I got examPair wrong first time and the contract caught it.
//
// Watched failing 2026-08-17: swapping any id key for a sibling's, or sending
// examPair 'A', fails the matching check below.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'constructing.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const BATCH = fs.readFileSync(path.join(ROOT, 'lib', 'batch.js'), 'utf8');

// the body object literal the tab posts to a given endpoint
function postedBody(endpoint) {
  const at = UI.indexOf(`tryPost('${endpoint}'`);
  if (at < 0) return null;
  return UI.slice(at, at + 500);
}

module.exports = {
  eachHistoryLauncherSendsTheIdKeyItsEndpointReads() {
    const CASES = [
      { ep: 'api/historytuning', key: 'sourceBatchId', wrong: ['replayOf', 'sourceHtRunId'] },
      { ep: 'api/historytuning/null', key: 'replayOf', wrong: ['sourceBatchId', 'sourceHtRunId'] },
      { ep: 'api/historytuning/reserve-grade', key: 'sourceHtRunId', wrong: ['sourceBatchId', 'replayOf'] },
    ];
    for (const c of CASES) {
      const body = postedBody(c.ep);
      assert.ok(body, `the tab must call ${c.ep}`);
      assert.ok(new RegExp(`\\b${c.key}\\b`).test(body),
        `${c.ep} reads ${c.key} — the tab must send it`);
      for (const w of c.wrong) {
        assert.ok(!new RegExp(`\\b${w}\\s*:`).test(body),
          `${c.ep} must NOT send ${w} — that is a sibling endpoint's key`);
      }
      // and the key must still be READ somewhere — some handlers name it, others
      // forward the whole body and the engine reads it. Either counts; neither
      // reading it means the contract moved and the launcher is posting to air.
      assert.ok(new RegExp(`\\b${c.key}\\b`).test(SERVER) || new RegExp(`params\\.${c.key}\\b`).test(BATCH),
        `nothing reads ${c.key} any more — ${c.ep} would ignore what the tab sends`);
    }
  },

  theNullDrawSendsASeedAndTheServerRefusesRepeats() {
    const body = postedBody('api/historytuning/null');
    assert.ok(/nullShiftSeed/.test(body), 'a null draw must carry its seed');
    assert.ok(/data-seed/.test(UI), 'and the seed must come from the button, computed from seeds already used');
  },

  theExamsSendFabricatedPairSymbolsNotLetters() {
    const { PLANTED_SYMBOLS } = require('../lib/planted');
    const at = UI.indexOf("'#ht2ExamA'");
    assert.ok(at > 0, 'the age-dial exams must be launchable');
    const block = UI.slice(at, at + 700);
    for (const sym of PLANTED_SYMBOLS) {
      assert.ok(block.includes(sym), `exam launch must name the fabricated pair ${sym}`);
    }
    assert.ok(!/examPair: pair, halfLifeKey/.test(block),
      "an exam takes no half-life — it is not a parameter of an exam");
    assert.ok(!/\['#ht2ExamA', 'A'\], \['#ht2ExamB', 'B'\]/.test(block),
      "examPair must be a pair SYMBOL; 'A'/'B' is refused by the engine");
  },

  theRealAgeDialRunIsGatedOnTheExams() {
    assert.ok(/api\/httwo\/exams/.test(UI), 'the tab must read the exam status');
    assert.ok(/exams && !exams\.ready/.test(UI),
      'and must say so before a real run — an instrument that has not passed its exams is not evidence');
  },

  // The reader must show the run, not its progress counters.
  theFinishedRunReaderShowsTheDialBoardNotADump() {
    assert.ok(/function renderHtRun/.test(UI), 'the dial-pair board must be rendered');
    assert.ok(/sealed until the winner is declared/.test(UI),
      'holds are graded once and stay sealed on screen until the winner is declared');
    assert.ok(/readingRules/.test(UI), 'the rules stamped before launch must be readable');
    assert.ok(/partial, not comparable yet/.test(UI),
      'a dial pair that has not finished all three splits must say its sum is not comparable');
    assert.ok(/GUESSED/.test(UI), 'the shaping numbers must carry their GUESSED labels');
  },

  // The grade's verdict has two shapes and the short one lacks the rich fields.
  theReserveGradeVerdictGuardsItsShortShape() {
    assert.ok(/mode === 'reserve-grade'/.test(UI), 'a grade doc must be recognised');
    assert.ok(/v\.resolutionFloor == null/.test(UI),
      'the unusable-grade shape carries only { passed, sentence } — printing the rich fields renders undefined');
    assert.ok(/only look that slice will ever get|once, ever/.test(UI),
      'the one-touch nature of the sealed slice must be stated where it is fired');
    // the engine really does answer with two shapes
    assert.ok(/GRADE UNUSABLE/.test(BATCH), 'the engine still emits the short shape this guards');
  },
};
