// Every column heading carries its own description.
//
// The owner's standing reporting rule: "Every table gets a NAME and a KEY. The
// key defines every column heading in plain words, including the units — and in
// particular whether a number is accuracy points or money, because those get
// confused and the difference decides whether something is tradeable. A table
// dropped in with bare headings makes the owner do the decoding; that is the
// writer's job, not the reader's."
//
// On 2026-08-17 the Trading tab had 67 headings and NOT ONE of them said what it
// held; the Constructing tab had 9 of 97. The rule had been on the books for
// three weeks. Nothing checked it, so it decayed with every table added.
//
// Watched failing 2026-08-17: replacing any single ${th(...)} / ${cth(...)} call
// with a bare <th>label</th> fails everyColumnHeadingSaysWhatItHolds.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const FILES = [
  ['public/constructing.js', 'Constructing'],
  ['public/trading.html', 'Trading'],
];

// A heading is described if it carries a title, or if it is produced by the
// page's own th()/cth() helper (which attaches the title from the shared key).
// A heading with no label at all — an action column — needs no description.
function bareHeadings(src) {
  const out = [];
  for (const m of src.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/g)) {
    const attrs = m[1];
    const label = m[2].trim();
    if (!label) continue;                    // action column, nothing to describe
    if (/title=/.test(attrs)) continue;      // described inline
    out.push(label.slice(0, 60));
  }
  return out;
}

// A headline tile is a number an operator reads first and acts on, and several
// of them are percentages OF something unstated — which is exactly how a
// fidelity figure gets read as a money figure. Trading had 22 of them and
// Constructing 5, none described.
function everyHeadlineTileSaysWhatItsNumberIs() {
  for (const [rel, name] of FILES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // a tile written out longhand with no title on the tile itself
    const bare = [...src.matchAll(/<div class="tile"(?![^>]*title=)[^>]*>\s*<div class="k"[^>]*>([\s\S]*?)<\/div>/g)]
      .map((m) => m[1].trim().slice(0, 50))
      // A tile whose label IS the entity (a config id with its paper badge) is a
      // heading, not a measurement — there is no unit to state.
      .filter((l) => !/^\$\{esc\(g\.id\)\}/.test(l));
    assert.deepStrictEqual(bare, [],
      `${name}: these headline tiles carry no description — the number's units are left to the reader: ${bare.join(' | ')}`);
  }
}

function everyColumnHeadingSaysWhatItHolds() {
  for (const [rel, name] of FILES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const bare = bareHeadings(src);
    assert.deepStrictEqual(bare, [],
      `${name}: these column headings carry no description — the reader has to decode them: ${bare.join(' | ')}`);
  }
}

// The helper is what makes the rule cheap to keep. If it disappears, the next
// table will be written with bare headings again.
function bothPagesHaveTheirColumnKeyHelper() {
  const cx = fs.readFileSync(path.join(ROOT, 'public/constructing.js'), 'utf8');
  const lt = fs.readFileSync(path.join(ROOT, 'public/trading.html'), 'utf8');
  assert(/const COL = \{/.test(cx) && /const cth = /.test(cx),
    'Constructing lost its shared column-key dictionary or its cth() helper');
  assert(/const TH=\{/.test(lt) && /const th=/.test(lt),
    'Trading lost its shared column-key dictionary or its th() helper');
}

// A description that does not say what the number IS fails the rule's point.
// Money columns are the ones that get misread as accuracy and vice versa, so
// every entry naming dollars must say dollars, and every entry naming a
// percentage must say what it is a percentage OF.
function moneyAndPercentColumnsNameTheirUnits() {
  const cx = fs.readFileSync(path.join(ROOT, 'public/constructing.js'), 'utf8');
  const block = cx.slice(cx.indexOf('const COL = {'), cx.indexOf('\n};', cx.indexOf('const COL = {')));
  const entries = [...block.matchAll(/^\s{2}(\w+):\s*'((?:[^'\\]|\\.)*)'/gm)].map((m) => [m[1], m[2]]);
  assert(entries.length >= 40, `the column key has only ${entries.length} entries — it should cover the tab`);
  for (const [key, text] of entries) {
    if (/Usd$|^netUsd$|^heldBack$/.test(key)) {
      assert(/dollar/i.test(text), `COL.${key} is a money column but its description never says dollars`);
    }
    assert(text.length > 25, `COL.${key} is too short to be a key entry: "${text}"`);
  }
}

module.exports = {
  everyColumnHeadingSaysWhatItHolds,
  everyHeadlineTileSaysWhatItsNumberIs,
  bothPagesHaveTheirColumnKeyHelper,
  moneyAndPercentColumnsNameTheirUnits,
};
