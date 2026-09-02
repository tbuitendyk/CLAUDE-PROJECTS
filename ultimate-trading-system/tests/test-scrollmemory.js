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
    for (const fn of ['function bWireSort(', 'function bWireRankSort(']) {
      const start = src.indexOf(fn);
      const body = src.slice(start, src.indexOf('\n}\n', start));
      assert.ok(body.includes('if (out) drawBoardsHoldingPlace();'), `${fn} redraws holding the page where it is`);
      assert.ok(!body.includes('restoreScroll('), `${fn} must not restore from the memory the clamp can overwrite`);
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
