// A NAMED SET OF FILTER BOXES, KEPT ON THE BOX (3.180.0, owner order
// 2026-09-19: "have filters that we can apply to the choose early read late
// view, which probably should be something stored").
//
// What has to hold: a screen goes in and comes back the same; saving under a
// name that exists REPLACES rather than making a second of that name; a rename
// onto a name in use is refused by name; and nothing a screen holds can be
// anything but a box name against a value, because a screen is a decision the
// owner wrote down and a reader that guessed at it would be reading a
// different decision.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SETTINGS = path.join(__dirname, '..', 'data', 'settings.json');

// THE REAL FILE IS THE OWNER'S AND IS NEVER WRITTEN BY A TEST. Moved aside,
// the test runs against a clean one, and it is put back whatever happens --
// including when an assertion throws.
function onACleanFile(body) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  const had = fs.existsSync(SETTINGS);
  const keep = had ? fs.readFileSync(SETTINGS) : null;
  const parked = `${SETTINGS}.screenparked${process.pid}`;
  if (had) fs.renameSync(SETTINGS, parked);
  delete require.cache[require.resolve('../lib/coinsscreens')];
  try {
    return body(require('../lib/coinsscreens'));
  } finally {
    try { fs.unlinkSync(SETTINGS); } catch (_) { /* it may not have been written */ }
    if (had) fs.renameSync(parked, SETTINGS);
    else if (keep) fs.writeFileSync(SETTINGS, keep);
    delete require.cache[require.resolve('../lib/coinsscreens')];
  }
}

function aFreshBoxHasNoScreensAndSaysSoRatherThanOfferingOne() {
  onACleanFile((S) => {
    assert.deepStrictEqual(S.listScreens(), [], 'nothing ships built in — RULE FIVE, the owner makes them');
  });
}

function aScreenGoesInAndComesBackWithBothSetsOfBoxes() {
  onACleanFile((S) => {
    const walk = { minPer: '0.25', maxGood: '10', wholeOnly: 'yes' };
    const split = { minLead: '0', minLatePaid: '50', bothOnly: 'yes' };
    const out = S.saveScreen('  the   honest  cut ', walk, split);
    assert.strictEqual(out.saved.name, 'the honest cut', 'the name is trimmed and its runs of spaces closed up');
    assert.strictEqual(out.replaced, false, 'and it is a new one, not a replacement');
    const back = S.listScreens();
    assert.strictEqual(back.length, 1);
    assert.deepStrictEqual(back[0].walk, walk, 'Walk it forward’s boxes come back exactly');
    assert.deepStrictEqual(back[0].split, split, 'and Choose early, read late’s');
  });
}

function savingOverANameReplacesItRatherThanMakingASecondOfThatName() {
  onACleanFile((S) => {
    S.saveScreen('cut', { minPer: '0.25' }, {});
    const out = S.saveScreen('CUT', { minPer: '1.5' }, { minLead: '0' });
    assert.strictEqual(out.replaced, true, 'it says it replaced one, so the screen can say so too');
    const back = S.listScreens();
    assert.strictEqual(back.length, 1, 'one screen of that name, whatever case it was typed in');
    assert.strictEqual(back[0].walk.minPer, '1.5', 'and it holds what was just saved');
    assert.strictEqual(back[0].split.minLead, '0');
  });
}

function aBlankBoxIsNotKeptBecauseABlankBoxHidesNothing() {
  onACleanFile((S) => {
    S.saveScreen('cut', { minPer: '0.25', minTrades: '', coin: null }, {});
    assert.deepStrictEqual(S.listScreens()[0].walk, { minPer: '0.25' },
      'a blank box is the same as no box, so keeping one would only make the screen look stricter than it is');
  });
}

function aScreenIsBoxNamesAgainstValuesAndAnythingElseIsRefusedByName() {
  onACleanFile((S) => {
    assert.throws(() => S.saveScreen('', {}, {}), /needs a name/, 'a screen with no name is refused');
    assert.throws(() => S.saveScreen('x'.repeat(61), {}, {}), /at most 60/, 'and one with a name too long to read');
    assert.throws(() => S.saveScreen('cut', ['minPer'], {}), /set of box names and values/, 'a list is not a set of boxes');
    assert.throws(() => S.saveScreen('cut', { 'min per': '1' }, {}), /is not a box name/, 'and a key that is not a box name is named back');
    assert.throws(() => S.saveScreen('cut', { minPer: { a: 1 } }, {}), /not a value/, 'and a box holding an object');
    assert.deepStrictEqual(S.listScreens(), [], 'and none of those wrote anything');
  });
}

function renamingOntoANameAlreadyOnTheBoxIsRefusedRatherThanSilentlyMerging() {
  onACleanFile((S) => {
    S.saveScreen('one', { minPer: '1' }, {});
    S.saveScreen('two', { minPer: '2' }, {});
    assert.throws(() => S.renameScreen('one', 'TWO'), /already on this box/, 'two screens of one name is two rules wearing one name');
    assert.throws(() => S.renameScreen('three', 'four'), /no screen called/, 'and renaming one that is not there says so');
    const out = S.renameScreen('one', 'the first');
    assert.strictEqual(out.renamed, 'the first');
    assert.deepStrictEqual(out.screens.map((x) => x.name), ['the first', 'two'], 'the list comes back sorted by name');
    assert.strictEqual(out.screens[0].walk.minPer, '1', 'and the boxes rode across the rename untouched');
  });
}

function deletingOneLeavesTheRestAndSaysSoWhenThereIsNothingToDelete() {
  onACleanFile((S) => {
    S.saveScreen('one', { minPer: '1' }, {});
    S.saveScreen('two', { minPer: '2' }, {});
    assert.throws(() => S.deleteScreen('three'), /no screen called/);
    const out = S.deleteScreen('ONE');
    assert.strictEqual(out.deleted, 'ONE');
    assert.deepStrictEqual(out.screens.map((x) => x.name), ['two'], 'and only that one went');
  });
}

function aSettingsFileHoldingRubbishUnderTheKeyReadsAsNoScreensRatherThanThrowing() {
  onACleanFile((S) => {
    fs.writeFileSync(SETTINGS, JSON.stringify({ coins_screens: [null, 3, { name: '  ' }, { name: 'good' }] }));
    const back = S.listScreens();
    assert.deepStrictEqual(back.map((x) => x.name), ['good'], 'the readable one is read and the rest are left out');
    assert.deepStrictEqual(back[0].walk, {}, 'a screen with no boxes reads as no boxes, not as a fault');
  });
}

// A SAVED SCREEN SPEAKS TODAY'S VOCABULARY (3.193.0, RULE NINE). The box
// `shownPairsOnly` was retired when it turned out to keep tens of thousands of
// rows where the owner wanted twenty-four; `wholeOnly` replaced it. A screen
// saved before that carries the old name, and a reader that had to ask which
// era a record came from is the thing RULE NINE forbids -- so the record moves.
//
// THE INTENT CARRIES, NOT JUST THE KEY. A screen that said "narrow to what the
// reading shows" still says it. Dropping the box instead would silently widen
// a rule the owner wrote down.
//
// This test goes out with the repair it guards (RULE TEN).
function aScreenSavedUnderARetiredBoxNameIsBroughtUpToDate() {
  onACleanFile((S) => {
    const fs = require('fs');
    const file = require('path').join(__dirname, '..', 'data', 'settings.json');
    fs.writeFileSync(file, JSON.stringify({
      [S.KEY]: [
        { name: 'old one', walk: { minPer: '0.25', shownPairsOnly: 'yes' }, split: {} },
        { name: 'old two', walk: { shownPairsOnly: '' }, split: {} },
        { name: 'new one', walk: { wholeOnly: 'yes' }, split: {} },
      ],
    }, null, 1));
    const done = S.repairRetiredBoxNames();
    assert.strictEqual(done.changed, 2, 'both screens carrying the retired box are counted');
    const back = S.listScreens();
    const at = (n) => back.find((x) => x.name === n).walk;
    assert.deepStrictEqual(at('old one'), { minPer: '0.25', wholeOnly: 'yes' }, 'a ticked one keeps its intent under the new name');
    assert.deepStrictEqual(at('old two'), {}, 'an unticked one simply loses a box that no longer exists');
    assert.deepStrictEqual(at('new one'), { wholeOnly: 'yes' }, 'and a screen already in today\'s words is left alone');
    // AND IT IS IDEMPOTENT, so a restart cannot undo or double it
    assert.strictEqual(S.repairRetiredBoxNames().changed, 0, 'a second pass finds nothing to do');
  });
}

module.exports = {
  aScreenSavedUnderARetiredBoxNameIsBroughtUpToDate,
  aFreshBoxHasNoScreensAndSaysSoRatherThanOfferingOne,
  aScreenGoesInAndComesBackWithBothSetsOfBoxes,
  savingOverANameReplacesItRatherThanMakingASecondOfThatName,
  aBlankBoxIsNotKeptBecauseABlankBoxHidesNothing,
  aScreenIsBoxNamesAgainstValuesAndAnythingElseIsRefusedByName,
  renamingOntoANameAlreadyOnTheBoxIsRefusedRatherThanSilentlyMerging,
  deletingOneLeavesTheRestAndSaysSoWhenThereIsNothingToDelete,
  aSettingsFileHoldingRubbishUnderTheKeyReadsAsNoScreensRatherThanThrowing,
};
