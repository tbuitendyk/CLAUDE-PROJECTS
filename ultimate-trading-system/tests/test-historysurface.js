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
const UI = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
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
    // the engine really does answer with two shapes
    assert.ok(/GRADE UNUSABLE/.test(BATCH), 'the engine still emits the short shape this guards');
  },

  // THE SEALED SLICE CAN BE READ AGAIN, AND EVERY READING SAYS WHICH ONE IT IS
  // (owner order, 2026-08-23: "this is my system. it doesn't refuse what i
  // want.").
  //
  // This used to be pinned the other way round: the test required the screen to
  // say the slice would only ever be read once, and the engine threw on a second
  // grade. The owner's ruling removes the refusal. What replaces it is not
  // nothing — a second look genuinely does not mean what the first meant, so the
  // system's job is to COUNT and SAY, every time, in every place the answer can
  // be read from. That is what this now guards.
  theSealedSliceCanBeReadAgainAndEveryReadingSaysWhichOneItIs() {
    // 1. Nothing refuses. Comments are stripped first: the explanation of why
    // this changed necessarily quotes the wording that is gone, and a check
    // that cannot tell prose from code fails on its own documentation.
    const code = (src) => src.replace(/\/\/[^\n]*/g, '');
    const uiCode = code(UI);
    const batchCode = code(BATCH);
    assert.ok(!/one verification event, ever/.test(batchCode),
      'the engine still refuses a second grade — the owner decides how many times their own slice is read');
    assert.ok(!/only look that slice will ever get|once, ever|one touch, final/.test(uiCode),
      'the screen still tells the owner the slice can only be read once, which is no longer true');
    assert.ok(!/cannot be repeated/.test(uiCode),
      'the confirmation box still says the grade cannot be repeated');

    // 2. It counts, and the count is stamped on the run itself.
    assert.ok(/function reserveGradesFor\(/.test(BATCH),
      'nothing enumerates the looks a slice has already had, so nothing can number the next one');
    assert.ok(/reserveLook: look/.test(BATCH), 'the run does not record which look it is');
    assert.ok(/priorReserveLooks: priorLooks/.test(BATCH),
      'the run does not carry what the earlier looks said, so a verdict read later cannot be placed');

    // 3. The stamped reading rule and the finished verdict BOTH say it. A
    // stored verdict gets read back by somebody without the parameters in
    // front of them, and a later look that reads like a first one is a
    // stronger claim than was earned.
    assert.ok(/LOOK \$\{look\} OF THIS SLICE/.test(BATCH),
      'the reading rule stamped before the grade computes does not say which look it is');
    // Defining the note is not using it. The first version of this check only
    // looked for the name and passed with the note computed and thrown away —
    // which is precisely the failure it is here to stop, a stored verdict that
    // reads like a first look.
    assert.ok(/\)\s*\+ lookNote,/.test(batchCode),
      'the finished verdict sentence does not append the look note, so a second reading reads like a first');
    // TWO places, and the count is the check: one on the run's own parameters
    // and one on the verdict record. Testing for the text alone passed with
    // either of them deleted, because the other still matched.
    const stamps = (batchCode.match(/reserveLook: look,?/g) || []).length;
    assert.strictEqual(stamps, 2,
      `the look number is stamped in ${stamps} place(s); it belongs on BOTH the run's parameters and its verdict, `
      + 'so a verdict read on its own still says which look produced it');

    // 4. The screen says it before the button is pressed, not only after.
    assert.ok(/This slice has been read \$\{myLooks\.length\} time\(s\) already/.test(UI),
      'the screen does not say how many times the slice has been read before offering to read it again');
    assert.ok(/data-look="\$\{nextLook\}"/.test(UI),
      'the button does not carry which look it would be, so the confirmation cannot state it');
    assert.ok(/look \$\{look\}\?/.test(UI) || /look \$\{look\} \?/.test(UI),
      'the confirmation box does not name the look number it is about to take');
  },
};
