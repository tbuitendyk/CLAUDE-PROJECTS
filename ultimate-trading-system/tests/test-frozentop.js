// THE TOP OF EVERY PAGE STAYS PUT (owner, 2026-08-21).
//
// The tabs scrolled away with everything else, so switching to another one
// meant scrolling back to the top first. On the Help tab, which is long, that
// is a long way — and the Help tab is exactly where somebody is most likely to
// want to go straight back to what they were doing.
//
// What is frozen: the site line, the page title, the line saying what the page
// is for, and the tab strips. On Trade that means BOTH strips, which is also
// what RULE TWO wants — the two sides are treated identically because they are
// in the same frozen block rather than each handled separately.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const PAGES = ['construct.html', 'trade.html', 'setup.html'];

const read = (p) => fs.readFileSync(path.join(ROOT, 'public', p), 'utf8');

// The frozen block, brace-matched by counting divs.
function pagetop(html) {
  const at = html.indexOf('<div class="pagetop">');
  if (at < 0) return null;
  let depth = 0;
  for (let i = at; i < html.length; i++) {
    if (html.startsWith('<div', i)) depth++;
    else if (html.startsWith('</div>', i)) { depth--; if (depth === 0) return html.slice(at, i + 6); }
  }
  return null;
}

module.exports = {
  async everyPageHasAFrozenTop() {
    for (const p of PAGES) {
      assert.ok(pagetop(read(p)), `${p} has no frozen top — its tabs scroll away`);
    }
  },

  // Sticky is the whole point; the rest is what stops it looking broken.
  async theFrozenTopIsActuallyStuckAndOpaque() {
    for (const p of PAGES) {
      const css = read(p);
      const rule = /\.pagetop \{([^}]*)\}/.exec(css);
      assert.ok(rule, `${p} has the frozen block but no rule to freeze it`);
      const body = rule[1];
      assert.ok(/position:\s*sticky/.test(body), `${p}: the top is not sticky, so it scrolls away anyway`);
      assert.ok(/top:\s*0/.test(body), `${p}: sticky with no top offset never sticks`);
      assert.ok(/background:/.test(body),
        `${p}: the frozen top has no background, so the page will scroll visibly underneath it`);
      assert.ok(/z-index:/.test(body),
        `${p}: the frozen top has no stacking order, so content can scroll over the top of it`);
      assert.ok(/margin:\s*-/.test(body),
        `${p}: without the negative margin the page's own padding lets content show past the frozen block at the edges`);
    }
  },

  // The tabs are the reason it exists.
  async theTabStripsAreInsideTheFrozenPart() {
    const strips = {
      'construct.html': ['id="tabs"'],
      'trade.html': ['id="branchTabs"', 'id="subTabs"'],
      'setup.html': ['class="toptabs"'],
    };
    for (const [p, ids] of Object.entries(strips)) {
      const top = pagetop(read(p));
      for (const id of ids) {
        assert.ok(top.includes(id),
          `${p}: ${id} is outside the frozen top, so it still scrolls away`);
      }
    }
  },

  // Every page must be able to reach every other page from anywhere on it.
  async theTopNavigationIsFrozenOnAllThree() {
    for (const p of PAGES) {
      const top = pagetop(read(p));
      assert.ok(top.includes('class="toptabs"'),
        `${p}: the Setup / Construct / Trade strip scrolls away`);
    }
  },

  // The content must NOT be inside it, or nothing scrolls at all.
  async theContentIsNotFrozenWithIt() {
    for (const p of ['construct.html', 'trade.html']) {
      const top = pagetop(read(p));
      assert.ok(!top.includes('id="view"'),
        `${p}: the content is inside the frozen block, so the page cannot scroll`);
    }
  },
};
