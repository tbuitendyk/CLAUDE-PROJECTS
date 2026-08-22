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

  // A THIN FROZEN STRIP UNDER THE TABS (owner order, 2026-08-22): so that
  // scrolling content does not come up and touch the bottom edge of the tabs.
  //
  // This test exists because the first attempt got it three times too big and
  // nothing caught it. The strip is padding on the frozen block, which cannot
  // collapse; the tab strip gives up its own bottom margin INSIDE the frozen
  // block so the strip is the padding and nothing else; and the content below
  // takes that margin back so the page at rest is unchanged. Those three
  // numbers have to add up, and this is the check that they do.
  //
  // Measured in Chromium at 16px/rem: .3rem = 4.80px against a 28.78px tab on
  // Construct (16.7%) and a 31.38px tab on Trade (15.3%) — both inside the
  // 15-20% the owner asked for. Setup is not in this list: its frozen block
  // holds the site line only, it has no tab strip of its own, and a strip
  // there would push its page down for nothing.
  async theTabsHaveAFrozenStripUnderThem() {
    const rem = (v) => Math.round(parseFloat(v) * 16 * 100) / 100;
    for (const p of ['construct.html', 'trade.html']) {
      const css = read(p);

      const pad = /\.pagetop \{[^}]*padding:\s*([^;}]+)/.exec(css);
      assert.ok(pad, `${p}: the frozen block has no padding at all`);
      const parts = pad[1].trim().split(/\s+/);
      assert.equal(parts.length, 3,
        `${p}: the frozen block's padding needs three values so the bottom one can differ `
        + 'from the top one — the strip is that third value');
      const strip = rem(parts[2]);
      assert.ok(strip >= 4 && strip <= 6,
        `${p}: the frozen strip is ${strip}px — the owner asked for 15-20% of a tab, `
        + 'which is 4.3-5.8px against the ~29px tabs these pages draw');

      // Without this the tab strip's own bottom margin stops collapsing and
      // joins the frozen block, which is exactly how the first attempt came
      // out at 50% of a tab.
      const give = /\.pagetop \.tabs \{[^}]*margin-bottom:\s*0/.test(css);
      assert.ok(give,
        `${p}: the tabs keep their bottom margin inside the frozen block, so the strip is `
        + 'the padding PLUS that margin — several times the size the owner asked for');

      const tabs = /\n\s*\.tabs \{[^}]*margin:\s*([^;}]+)/.exec(css);
      assert.ok(tabs, `${p}: no .tabs rule to read the original spacing from`);
      const tabsBottom = rem(tabs[1].trim().split(/\s+/)[2]);

      const back = /\.pagetop \+ #view \{[^}]*margin-top:\s*([^;}]+)/.exec(css);
      assert.ok(back,
        `${p}: the content below the frozen block does not take back the margin the tabs gave `
        + 'up, so everything on the page sits higher than it did');
      const given = rem(back[1]);

      assert.equal(Math.round((given + strip) * 100) / 100, tabsBottom,
        `${p}: strip ${strip}px + content margin ${given}px must equal the ${tabsBottom}px the `
        + 'tabs used to carry, or the page at rest no longer looks the way it did');
    }
  },

  // Setup has no tab strip inside its frozen block, so it gets no strip. If
  // one is ever added there, this is the test to change on purpose.
  async setupIsDeliberatelyLeftWithoutAStrip() {
    const css = read('setup.html');
    const pad = /\.pagetop \{[^}]*padding:\s*([^;}]+)/.exec(css);
    assert.ok(pad, 'setup.html: the frozen block has no padding at all');
    const bottom = pad[1].trim().split(/\s+/)[2];
    assert.equal(parseFloat(bottom) || 0, 0,
      `setup.html grew a ${bottom} frozen strip, but its frozen block holds the site line only `
      + '— the strip would push the whole page down and sit under nothing the owner asked about');
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
