// A REDRAW SAYS IT IS HAPPENING (owner order, 2026-08-30: "going back and forth
// between the Sweep and Boards tabs and even picking new sets of filters on the
// 3.A and 3.B tables is taking a long time to redraw ... we need to add
// something to the interface that tells the user to wait").
//
// Until a redraw lands, the OLD page is still on screen unchanged, so a press
// that worked and a press that did nothing look identical. Every one of the
// four things below fails SILENTLY and leaves that exactly as it was, or worse
// — a box that never clears is a page the owner cannot use at all.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const JS = () => fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
const HTML = () => fs.readFileSync(path.join(ROOT, 'public', 'construct.html'), 'utf8');

// The renderers draw() hands the screen to. READ from the dispatcher rather
// than typed here, so a tab added tomorrow is covered without anybody
// remembering to add it — and a tab added tomorrow WITHOUT the wrap fails.
function renderersInTheDispatcher(src) {
  const from = src.indexOf('function draw() {');
  assert.ok(from > 0, 'construct.js has no draw() to dispatch anything');
  const body = src.slice(from, src.indexOf('\n}\n', from));
  return [...new Set([...body.matchAll(/\b(draw[A-Z][A-Za-z]*)\(\)/g)].map((m) => m[1]))];
}

module.exports = {
  async everyRendererTheTabStripCanReachIsWrapped() {
    const src = JS();
    const missing = renderersInTheDispatcher(src)
      .filter((fn) => !new RegExp(`^${fn} = waitWrap\\(${fn}\\);$`, 'm').test(src));
    assert.deepStrictEqual(missing, [],
      'these renderers can be put on screen and never raise the wait box, so those redraws look '
      + `like nothing happened: ${missing.join(', ')}`);
  },

  // A renderer that throws is a real case — draw() carries a whole arm for it.
  // Without finally, one throw leaves the screen covered until a reload.
  async aRendererThatThrowsStillClearsTheBox() {
    const src = JS();
    const w = src.slice(src.indexOf('const waitWrap ='), src.indexOf('const waitWrap =') + 260);
    assert.ok(/finally \{/.test(w),
      'the wait box is cleared on the success path only, so a renderer that throws leaves the box '
      + 'over the page for good');
  },

  // Two draws can be in the air at once — a pager press landing while a filter
  // redraw is still reading. A flag would let the first one to finish take the
  // box away from the second.
  async twoOverlappingRedrawsDoNotUncoverEachOther() {
    const src = JS();
    assert.ok(/if \(waitDepth\+\+ > 0\) return;/.test(src),
      'the wait box is a flag, not a count: two overlapping redraws and the first to finish takes '
      + 'the box away while the second is still working');
    assert.ok(/if \(--waitDepth > 0\) return;/.test(src),
      'the wait box is cleared without checking whether another redraw still needs it');
  },

  // Hours of a box appearing every four seconds is not information.
  async theEveryFewSecondsAskDoesNotFlashTheBox() {
    const src = JS();
    const polls = [...src.matchAll(/bTallyPoll = setTimeout\([^\n]*\n?/g)].map((m) => m[0]);
    assert.ok(polls.length >= 2, `expected the totalling and filling-in asks, found ${polls.length}`);
    const loud = polls.filter((p) => /drawBoards\(\)/.test(p));
    assert.deepStrictEqual(loud, [],
      'the ask that repeats every four seconds while a set is working raises the wait box each '
      + 'time, so the page flashes a box at the owner for as long as the work runs');
  },

  // An id selector beats [hidden], so display:flex would pin the box on screen
  // for ever. It is one line and nothing on the page would say it was missing.
  async theBoxIsOnThePageAndCanActuallyBeHidden() {
    const html = HTML();
    assert.ok(/<div id="waitbox" hidden>/.test(html),
      'there is no wait box on the page, so nothing the code shows can appear');
    assert.ok(/#waitbox\[hidden\] \{ display:none; \}/.test(html),
      'the wait box sets display on an id, which beats [hidden] — so once shown it can never be '
      + 'hidden again and the page is unusable');
    assert.ok(html.indexOf('#waitbox[hidden]') > html.indexOf('#waitbox {'),
      'the [hidden] rule is written before the rule it has to beat, so the later one wins and the '
      + 'box stays on screen');
  },
};
