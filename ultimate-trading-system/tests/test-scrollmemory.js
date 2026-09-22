// COMING BACK TO A TAB PUTS YOU WHERE YOU LEFT IT (owner, 2026-08-21).
//
// Every tab shared one scroll position — the browser's — so switching away and
// back put you at the top. On a long tab that means finding your place again
// every single time.
//
// Three things have to be right or it does not work, and each fails silently
// rather than visibly, which is why they are all pinned here.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const CONSTRUCT = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
const TRADE = fs.readFileSync(path.join(ROOT, 'public', 'trade.html'), 'utf8');

module.exports = {
  async bothPagesRememberAndRestore() {
    for (const [name, src] of [['the Construct page', CONSTRUCT], ['the Trade page', TRADE]]) {
      assert.ok(/function rememberScroll\(/.test(src), `${name} does not remember where you were`);
      assert.ok(/function restoreScroll\(/.test(src), `${name} does not put you back`);
      assert.ok(/window\.scrollTo\(0, ?y\)/.test(src), `${name} never actually scrolls anywhere`);
    }
  },

  // Leaving a tab is the only moment the old position can still be read.
  async thePositionIsSavedBEFORELeavingTheTab() {
    const c = CONSTRUCT.slice(CONSTRUCT.indexOf("$('#tabs').querySelectorAll"), CONSTRUCT.indexOf('// ---- release strip'));
    assert.ok(c.indexOf('rememberScroll(tab)') < c.indexOf('tab = t.dataset.k'),
      'the Construct page saves the position AFTER switching tabs, so it saves it against the wrong tab');
    const t = TRADE.slice(TRADE.indexOf("$('#subTabs').querySelectorAll"), TRADE.indexOf("$('#subTabs').querySelectorAll") + 400);
    assert.ok(t.indexOf('rememberScroll(branch,sub)') < t.indexOf('sub=t.dataset.k'),
      'the Trade page saves the position AFTER switching, so it saves it against the wrong tab');
  },

  // Scrolling before the browser has laid the new content out scrolls a page
  // that is still short, and quietly lands nowhere near the right place.
  async itWaitsForTheContentToBeLaidOutFirst() {
    for (const [name, src] of [['the Construct page', CONSTRUCT], ['the Trade page', TRADE]]) {
      assert.ok(/requestAnimationFrame\(\s*\(\)\s*=>\s*requestAnimationFrame\(/.test(src),
        `${name} restores the position before the new content has been laid out, so it lands in the wrong place`);
    }
  },

  // Each tab needs its own place, or they all share one again under a new name.
  async everyTabKeepsItsOwnPlace() {
    assert.ok(/const scrollKeyFor = \(t\) => `cx-scroll-\$\{t\}`/.test(CONSTRUCT),
      'the Construct page does not key the position by tab');
    // On Trade, BOTH strips: Paper Books and Live Trading each keep their own
    // place on each sub-tab, and identically (RULE TWO).
    assert.ok(/const scrollKeyFor=\(b,sb\)=>`lt-scroll-\$\{b\}-\$\{sb\}`/.test(TRADE),
      'the Trade page does not key the position by side AND sub-tab, so the two sides would share one');
  },

  // The 30-second refresh must not yank the page while it is being read.
  async theAutomaticRedrawDoesNotMoveThePage() {
    const tick = TRADE.slice(TRADE.indexOf('setInterval(()=>{ if(sub==='), TRADE.indexOf('setInterval(()=>{ if(sub===') + 120);
    assert.ok(!/restoreScroll/.test(tick),
      'the 30-second redraw restores the scroll position — it is a refresh of what is on screen, not a navigation, and moving the view would make it unreadable while it is being read');
  },

  // THE COLUMN SORTERS ON BOARDS LEAVE THE PAGE WHERE IT IS (owner order,
  // 2026-09-02: "don't reposition the windows when column sorters are used on
  // the Boards tab"). A sort press redraws the whole page; the remembered
  // place can be overwritten by the clamp while a long redraw has the page
  // short, so a restore from memory landed higher than the owner was. The
  // sorters take the height BEFORE the redraw and put it back exactly there.
  // A PICK ON BOARDS HOLDS ITS OWN BOX STILL (3.132.0, owner report 2026-09-14:
  // "when a stage 3 record set is selected on Boards the page jumps up and
  // does not return to the stage 3 record set selector"). The pick redrew the
  // tab and restored the remembered place, which the clamp had overwritten and
  // which no longer sat at the box once the three sections opened above it.
  // The pressed control is pegged instead, the way the coin table's head is.
  async aPickOnBoardsHoldsItsOwnBoxStill() {
    const src = CONSTRUCT_NOW();
    const at = src.indexOf('async function bRedrawPeggedTo(selector) {');
    assert.ok(at > 0, 'there is no pegged redraw for a pressed control');
    const helper = src.slice(at, src.indexOf('\n}\n', at));
    const before = helper.indexOf('const pegTop = el ? el.getBoundingClientRect().top : null;');
    const draw = helper.indexOf('await drawBoards();');
    const after = helper.indexOf('window.scrollBy(0, again.getBoundingClientRect().top - pegTop);');
    assert.ok(before > 0 && draw > before && after > draw, 'the box is not measured before the redraw and put back after it');
    assert.ok(helper.includes('rememberScroll(tab);'), 'the pegged place is not remembered, so the next restore lands elsewhere');
    assert.ok(helper.indexOf('holdScrollMemory();') > 0 && helper.indexOf('holdScrollMemory();') < after, 'the memory is not held while the page moves itself');
    // the three presses on the stage sections go through it, each pegged to its own control
    const presses = src.slice(src.indexOf("  for (const stage of [1, 2, 3]) {\n    const pick = $(`#bPick${stage}`);"), src.indexOf('  // Each open section renders its set'));
    assert.ok(presses.length > 200, 'the stage section presses are not where they were');
    assert.strictEqual(presses.split("bRedrawPeggedTo(`#bPick${stage}`);").length - 1, 2, 'the pick and the delete do not both hold the record set box still');
    assert.ok(presses.includes('bRedrawPeggedTo(`[data-bfold="${sN}"]`);'), 'a put away or open on a section does not hold its button still');
    assert.ok(!presses.includes('drawBoards().then(() => restoreScroll(tab))'), 'a press on a stage section still restores from the memory the clamp can overwrite');
  },

  async theColumnSortersOnBoardsLeaveThePageWhereItIs() {
    const src = CONSTRUCT_NOW();
    const at = src.indexOf('async function drawBoardsHoldingPlace()');
    assert.ok(at > 0, 'the holding redraw exists');
    const helper = src.slice(at, at + 500);
    assert.ok(helper.indexOf('const y = window.scrollY;') > 0 && helper.indexOf('const y = window.scrollY;') < helper.indexOf('await drawBoards();'),
      'the place is taken BEFORE the redraw replaces anything');
    assert.ok(/window\.scrollTo\(0, y\)/.test(helper) && helper.indexOf('window.scrollTo(0, y)') > helper.indexOf('await drawBoards();'),
      'and the page is put back at exactly that height afterwards');
    assert.ok(/holdScrollMemory\(\);/.test(helper) && /rememberScroll\(tab\);/.test(helper),
      'the memory is held shut around the move and told the place afterwards');
    assert.ok(/requestAnimationFrame\(\(\) => requestAnimationFrame\(/.test(helper), 'it waits for the new content to be laid out first');
    // since 3.222.1 a sort repaints its own table in place rather than the whole page held still
    for (const [fn, call] of [['function bWireSort(', 'if (out) bRepaintTable(doc.stage);'], ['function bWireRankSort(', 'if (out) bRepaintTable(3);']]) {
      const start = src.indexOf(fn);
      const body = src.slice(start, src.indexOf('\n}\n', start));
      assert.ok(body.includes(call), `${fn} repaints its own table where it stands`);
      assert.ok(!body.includes('restoreScroll(') && !body.includes('drawBoards('), `${fn} must not redraw the whole page`);
    }
  },

  // EVERY TABLE CONTROL ON BOARDS REPAINTS ITS OWN TABLE IN PLACE (3.222.1,
  // owner 2026-09-21: "why when i apply filters to the stage 2 table does the
  // screen jump? can't you fix ALL of these or are you wanting me to report
  // Every Single One that isn't coded properly?"). A whole-page redraw empties
  // the page for a moment, and the browser's clamp to the short page is a
  // scroll the memory could not tell from the owner's. Now a table's controls
  // read the set again and redraw only its own mount, through the one
  // bDrawTable that drawBoards draws with, holding the table's top edge (or
  // Table 3.B's heading line) still; the whole-page draw stays for what
  // changes the page. Pressed for real in tests/ui-boards.js.
  async everyTableControlOnBoardsRepaintsItsOwnTableInPlace() {
    const src = CONSTRUCT_NOW();
    const at = src.indexOf('async function bRepaintTable(stage, opts = {}) {');
    assert.ok(at > 0, 'the in-place repaint exists');
    const helper = src.slice(at, src.indexOf('\n}\n', at));
    const peg = helper.indexOf('const pegTop = document.querySelector(pegSel).getBoundingClientRect().top;');
    const draw = helper.indexOf('await bDrawTable(doc, bView(), mountId);');
    const back = helper.indexOf('window.scrollBy(0, again.getBoundingClientRect().top - pegTop);');
    assert.ok(peg > 0 && draw > peg && back > draw, 'the peg is not measured before the table is redrawn and put back after it');
    assert.ok(helper.indexOf('holdScrollMemory();') > 0 && helper.indexOf('holdScrollMemory();') < back && helper.includes('rememberScroll(tab);'),
      'the memory is not held shut across the move and told the place afterwards');
    assert.ok(/requestAnimationFrame\(\(\) => requestAnimationFrame\(/.test(helper), 'it waits for the new rows to be laid out first');
    assert.ok(helper.includes('if (!$(mountId) || !id) return drawBoardsHoldingPlace();'), 'a repaint with no table standing must fall back to the whole page held in place');
    assert.ok(helper.includes("if (!doc || (doc.status !== 'done' && doc.status !== 'incomplete')) return drawBoardsHoldingPlace();"),
      'a set that stopped being finished under its table changes its section, so the page is what redraws');
    assert.ok(helper.includes('window.scrollBy(0, to.getBoundingClientRect().top - 180);'), 'Show in 3.B no longer brings Table 3.B onto the screen');
    // ONE table drawer for the page draw and the repaint
    const tbl = src.indexOf('async function bDrawTable(doc, view, mount) {');
    assert.ok(tbl > 0, 'the one table drawer is gone');
    const drawer = src.slice(tbl, src.indexOf('\n}\n', tbl));
    assert.ok(drawer.includes('if (doc.stage === 1) await bDrawStage1(doc, incomplete, view, mount);')
      && drawer.includes('else if (doc.stage === 2) await bDrawStage2(doc, incomplete, view, mount);')
      && drawer.includes('else await bDrawStage3(doc, incomplete, view, mount);'), 'the drawer does not draw all three stages');
    const boards = src.slice(src.indexOf('async function drawBoards() {'), tbl);
    assert.ok(boards.includes('bDrawn[stage] = doc.id;\n    await bDrawTable(doc, view, `#bT${stage}`);'),
      'drawBoards does not draw its tables through the one drawer, or does not say which set stands on each mount');
    assert.ok(boards.includes('bDrawn[stage] = null;   // until a finished set'), 'a mount with no finished set under it still claims one');
    // the every-few-seconds ask repaints the stage 3 table alone while it stands
    assert.ok(src.includes("return ($('#bT3') && bDrawn[3] ? bRepaintTable(3) : drawBoards()).then(() => holdScrollMemory());"),
      'the every-few-seconds ask redraws the whole page under a standing table');
    assert.ok(src.includes('bRepaintTable = waitWrap(bRepaintTable);'), 'a repaint shows no wait box');
    // EVERY control that belongs to a table goes through it, and none of the old redraws remain
    for (const gone of ['bRedrawPeggedToCoinHead', 'bRedrawScrolledToCoinHead', 'drawBoards().then(() => restoreScroll(tab))']) {
      assert.ok(!src.includes(gone), `a table control still redraws the whole page: ${gone}`);
    }
    const sites = [
      ['bRepaintTable(bStageOfKey(key), { peg: `[data-bpage^="${key}:"]` });', 'the page turns of every table, pegged to the pager under the pointer'],
      ['if (out) bRepaintTable(doc.stage);\n    };\n  });\n}\n\n// THE RANKED TABLE SORTS BY ONE PICKED COLUMN', 'the stage 1 and 2 column sorts'],
      ['if (out) bRepaintTable(3);\n    };\n  });\n}\n\n// A REDRAW THAT LEAVES THE PAGE WHERE IT IS', "Table 3.A's column sorts"],
      ["bSaveView({ coins: { ...cq, sort: key, flip: active ? !cq.flip : false, offset: 0 } });\n      bRepaintTable(3, { peg: '[data-bcoinhead]' });", "Table 3.B's column sorts"],
      ["  bRepaintTable(bStageOfKey(key), key === 'S3C' ? { peg: '[data-bcoinhead]' } : {});\n}\n// spec: [id, name shown, kind, tooltip, options?]", 'Apply settings and auto-apply settings'],
      ["bSaveView({ filters: all, s3cBeforePin: null, s3cPin: null, openS3: [], coins: { ...(bView().coins || {}), offset: 0 } });\n      bRepaintTable(3, { peg: '[data-bcoinhead]' });", 'Revert filters'],
      ["await tryPost(`api/stageset/${encodeURIComponent(doc.id)}/filters`, { filters: {} });\n      bRepaintTable(bStageOfKey(key), key === 'S3C' ? { peg: '[data-bcoinhead]' } : {});", 'Clear filters'],
      ['bSaveView({ tables: all });\n      bRepaintTable(bStageOfKey(key));', "a table's own arrow"],
      ["bRepaintTable(3, { scrollTo: '[data-bcoinhead]' });\n    };\n  });\n  const hb = $(mount).querySelector('#bHeldBack');", 'Show in 3.B'],
      ["if (!r) { bHeldBack = false; hb.checked = false; return; }\n      }\n      bRepaintTable(3, { peg: '[data-bcoinhead]' });", 'show the held-back window'],
      ["bSaveView({ openS3: [...keys] });\n      bRepaintTable(3, { peg: '[data-bcoinhead]' });", 'the records buttons'],
      ['bSaveView({ checked: { id, res } });\n      bRepaintTable(3);', 'Check this set'],
      ["said.textContent = 'every unit is back — reopening'; bRepaintTable(1); return;", 'the stage 1 put-back'],
    ];
    for (const [text, what] of sites) assert.ok(src.includes(text), `${what} does not repaint in place`);
    for (const tail of ['fill-in/stop', 'undo-append', 'drop-undeclared', 'fill-in']) {
      assert.ok(src.includes(`/${tail}\`, {}); } catch (err) { alert(err.message); }\n      bRepaintTable(3);`), `${tail} does not repaint in place`);
    }
  },
};


// THE CLAMP NEVER OVERWRITES THE MEMORY (owner order, 2026-08-26: "the
// opened table stays open, but the scroll location is lost. fix that
// throughout"). A page scrolling ITSELF — a restore onto content not yet
// rebuilt, a redraw that shrinks the page for a moment — lands clamped, and
// the clamp fires a scroll event that wrote the clamped place over the real
// one. Every programmatic move now holds the memory shut; only the owner's
// own scrolling writes it. Both pages, same machinery.
module.exports.theClampNeverOverwritesTheMemory = async function () {
  const { assert: a } = require('./helpers');
  for (const [name, src] of [['the Construct page', CONSTRUCT_NOW()], ['the Trade page', TRADE_NOW()]]) {
    a.ok(/function holdScrollMemory\(\)/.test(src), `${name} has no hold on its scroll memory`);
    const restore = src.slice(src.indexOf('function restoreScroll'), src.indexOf('function restoreScroll') + 900);
    a.ok(/holdScrollMemory\(\);/.test(restore),
      `${name}'s restore does not hold the memory — the clamped landing overwrites the place it was restoring to`);
    a.ok(/scrollMemoryHeldUntil\) return;/.test(src),
      `${name}'s listener writes the memory even while the page is moving itself`);
  }
  const cx = CONSTRUCT_NOW();
  a.ok(/holdScrollMemory\(\); const r = await fn\(/.test(cx),
    'a redraw on the Construct page no longer holds the memory while the page height moves under it');
};
function CONSTRUCT_NOW() {
  return require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'construct.js'), 'utf8');
}
function TRADE_NOW() {
  return require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'trade.html'), 'utf8');
}
