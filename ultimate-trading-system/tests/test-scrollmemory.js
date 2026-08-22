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
};
