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
// 'logreg' and 'boost' left this list on 2026-08-26 (owner order): they ARE
// on a screen — the model column of the panel the inspect button opens — and
// the agree help now names them there on purpose. Declaring them unusable
// here while the owner can read them in a column was the slim fault again.
const NEVER = ['combo', 'slim'];

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

  // A LIST OF CONTROLS IS NOT AN EXPLANATION. It says what each button does and
  // never says what the screen is doing — the owner asked what a sweep actually
  // performs and the page had no answer anywhere.
  async everyScreenExplainsWhatItActuallyDoes() {
    const H = help();
    for (const [key, t] of Object.entries(byTab())) {
      if (key === 'help') continue;
      const how = (H[key] || {}).how;
      assert.ok(Array.isArray(how) && how.length,
        `the ${t.label} screen lists its controls but never explains what the screen does`);
      for (const [heading, body] of how) {
        assert.ok(heading && heading.length > 8, `${t.label}: an overview section has no heading`);
        assert.ok(body && body.length > 150,
          `${t.label}: the overview section "${heading}" is too short to explain anything`);
      }
    }
  },

  // The one the owner asked for by name. RE-AIMED 2026-08-28: the old Sweep's
  // two passes and its null boards are gone with that screen, and the thing a
  // reader now has to be told before pressing anything is what each of the
  // three stages does, what it writes, and what carries between them.
  async theSweepOverviewExplainsEveryStageAndWhatCarriesBetweenThem() {
    const how = help().sweep.how.map(([h, b]) => `${h}\n${b}`).join('\n');
    for (const [thing, why] of [
      ['Stage 1', 'it never says what the first stage does'],
      ['Stage 2', 'it never says what the second stage does'],
      ['Stage 3', 'it never says what the third stage does'],
      ['record set', 'it never says what a stage writes'],
      ['parent', 'it never says how one stage finds the one it reads'],
      ['null set', 'it never says what the shuffled companions do'],
      ['carr', 'it never says what travels from one stage to the next'],
    ]) {
      assert.ok(how.includes(thing), `the Sweep overview does not mention ${thing} — ${why}`);
    }
    assert.ok(/nothing retrains/.test(how),
      'the Sweep overview does not say that stage 3 prices without training — which is the part that makes '
      + 'asking a different block tomorrow cheap, and the reason the stages are split at all');
    assert.ok(/refuse/.test(how),
      'the Sweep overview never says a launch can refuse, so a refusal reads as a fault rather than the guard it is');
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
  // WHAT A PAYING READER MUST NEVER MEET (owner order, 2026-08-29: "that kind
  // of historical comment about errors in the code or corrections made and
  // references to how things used to work is out of place in all tool tips and
  // help content ... expunge all references to irrelevant details that we
  // obviously would not want in a production system for subscription access").
  //
  // Two hovers had it: one said what the count on it used to be and when it was
  // corrected, the other named a source file and recounted a launch bug. Both
  // read as a changelog leaking through the screen. Help says what a control
  // does NOW and how to use it NOW; the reasoning behind a change belongs in
  // the code and in the commit, where the people who need it look.
  //
  // Checked on the help entries AND on the hovers the page renders, because
  // they are two different files and only one of them was caught by eye.
  async noProductionTextRecountsItsOwnHistoryOrNamesTheCode() {
    const H = help();
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const BANNED = [
      [/\b20\d{2}-\d{2}-\d{2}\b/, 'a date — the screen is not a changelog'],
      [/\bused to\b|\bit said\b|\bwas wrong\b|\buntil 20\d\d\b|\bpreviously\b|\bearlier version\b/i,
        'an account of how it used to behave'],
      [/\bowner order\b|\bcorrected\b|\baudit\b|\bQC[- ]?\d/i, 'an internal note about why it changed'],
      [/\blib\/|\btests?\/|\w+\.js\b/, 'a source file'],
    ];
    const bad = [];
    const check = (where, text) => {
      if (!text) return;
      for (const [re, why] of BANNED) if (re.test(text)) bad.push(`${where}: ${why} — "${String(text).replace(/\s+/g, ' ').slice(0, 110)}"`);
    };
    for (const [key, sec] of Object.entries(H)) {
      check(`${key}.intro`, sec.intro);
      (sec.how || []).forEach(([, body], i) => check(`${key}.how[${i}]`, body));
      for (const [id, e] of Object.entries(sec.controls || {})) { check(`${key}.${id}.what`, e.what); check(`${key}.${id}.more`, e.more); }
    }
    for (const m of ui.matchAll(/title="((?:[^"\\]|\\.)*)"/g)) check('a hover on the page', m[1]);
    assert.deepStrictEqual(bad, [],
      `production text is telling the reader about the code instead of the control:\n  ${bad.join('\n  ')}`);
  },

};
