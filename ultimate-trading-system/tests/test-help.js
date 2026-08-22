// THE HELP TAB MUST DESCRIBE EVERY CONTROL, IN WORDS THAT ARE ON THE SCREEN
// (owner order, 2026-08-21).
//
// "make a useful help tab ... WITH SIMULATED STATIC SCREEN ELEMENTS AND
// *EVERYTHING* and i mean EVERYTHING described in plain language".
//
// Two ways a help page rots, and both are worse than having none:
//
//   * it falls behind. A control is added and nothing describes it, and the
//     page still looks complete because there is no gap where the missing
//     entry would be.
//   * it is written in the same words the owner could not understand in the
//     first place, which reads like help and is not.
//
// Both are checked here, so neither can happen quietly.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const { byTab } = require('../lib/screencontrols');

const ROOT = path.join(__dirname, '..');

function help() {
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  new Function('window', fs.readFileSync(path.join(ROOT, 'public', 'help-content.js'), 'utf8'))(sandbox);
  return sandbox.HELP;
}

// Words that are on some screen, plus the ones no explanation could avoid.
function allowedWords() {
  const { collect, tabs } = require('./sweep-words');
  const ok = new Set();
  for (const t of tabs()) for (const w of collect(t.fn).words) ok.add(w.toLowerCase());
  return ok;
}

// The four that appear on NO screen. An explanation containing one of these is
// the original fault wearing a help page.
const NEVER = ['logreg', 'boost', 'combo', 'slim'];

module.exports = {
  // Nothing left out, ever.
  async everyControlOnEveryScreenIsDescribed() {
    const H = help();
    const missing = [];
    for (const [key, t] of Object.entries(byTab())) {
      if (key === 'help') continue;                 // the Help tab describes the others
      const entries = (H[key] && H[key].controls) || {};
      for (const c of t.controls) if (!entries[c.id]) missing.push(`${t.label}: ${c.id} (${c.label})`);
    }
    assert.deepStrictEqual(missing, [],
      `these controls have no description on the Help tab:\n  ${missing.join('\n  ')}`);
  },

  // And nothing described that is not there — a stale entry is a lie about the
  // screen, the same fault the other way round.
  async nothingIsDescribedThatDoesNotExist() {
    const H = help();
    const map = byTab();
    const stale = [];
    for (const [key, section] of Object.entries(H)) {
      const real = new Set(((map[key] || {}).controls || []).map((c) => c.id));
      for (const id of Object.keys(section.controls || {})) {
        if (!real.has(id)) stale.push(`${section.title}: ${id}`);
      }
    }
    assert.deepStrictEqual(stale, [],
      `the Help tab describes controls that are not on any screen: ${stale.join(', ')}`);
  },

  // Every screen gets an opening line saying what it is for.
  async everyScreenSaysWhatItIsFor() {
    const H = help();
    for (const [key, t] of Object.entries(byTab())) {
      if (key === 'help') continue;
      assert.ok(H[key] && H[key].intro && H[key].intro.length > 40,
        `the ${t.label} screen has no plain-language description of what it is for`);
    }
  },

  // The one that stops it becoming more of the same.
  async noDescriptionUsesAWordThatIsOnNoScreen() {
    const H = help();
    const offenders = [];
    for (const section of Object.values(H)) {
      const texts = [section.intro || ''];
      for (const e of Object.values(section.controls || {})) texts.push(e.what || '', e.more || '');
      for (const text of texts) {
        for (const bad of NEVER) {
          if (new RegExp(`\\b${bad}\\b`, 'i').test(text)) offenders.push(`${section.title}: "${bad}"`);
        }
      }
    }
    assert.deepStrictEqual(offenders, [],
      `the Help tab explains things using words that appear on no screen: ${offenders.join(', ')}`);
  },

  // The pictures must be dead. A help page that looks operable is one somebody
  // will try to operate.
  async everyPictureOfAControlIsDisabled() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const fn = ui.slice(ui.indexOf('function helpReplica('), ui.indexOf('let HELPVOCAB'));
    assert.ok(fn.length > 100, 'the Help tab no longer draws pictures of the controls');
    assert.ok(/const dead = 'disabled/.test(fn), 'the copies are not disabled');
    for (const shape of ['checkbox', 'button', 'select']) {
      assert.ok(new RegExp(`${shape}[\\s\\S]{0,220}\\$\\{dead\\}`).test(fn),
        `the ${shape} copy on the Help tab is not disabled — it can be operated`);
    }
    assert.ok(!/id="/.test(fn), 'a copy on the Help tab carries an id, so it could be mistaken for the real control');
  },

  // It has to be reachable, and last.
  async theHelpTabIsTheLastOne() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const m = /const TABS = \[([\s\S]*?)\];/.exec(ui);
    const names = [...m[1].matchAll(/\['([^']+)'/g)].map((x) => x[1]);
    assert.strictEqual(names[names.length - 1], 'help', `Help is not the last tab: ${names.join(', ')}`);
    assert.ok(/: drawHelp\(\)/.test(ui), 'nothing draws the Help tab');
    // FAR RIGHT means the right-hand EDGE, not merely last in the row. Last put
    // it beside Greenlight, looking like the step after it.
    assert.ok(/k === 'help' \? ' tab-far' : ''/.test(ui),
      'the Help tab is no longer pushed to the far right — being last only puts it beside Greenlight');
    const css = fs.readFileSync(path.join(ROOT, 'public', 'construct.html'), 'utf8');
    assert.ok(/\.tab\.tab-far \{[^}]*margin-left:\s*auto/.test(css),
      'the rule that pushes Help to the right-hand edge is gone, so the class does nothing');
  },
};
