// FOUR FILTERS IS ONE WAIT, NOT FOUR (owner order, 2026-08-30: "instead of
// triggering a minute long operation refresh on every lost focus of a settings
// field ... the button becomes necessary to apply the settings of all of the
// fields at once").
//
// A filter used to go on the moment its box lost focus. On the owner's record
// set that is minutes each, so setting four filters meant sitting through three
// tables nobody asked to see. What has to be right, and each of which fails by
// doing nothing visible:
//
//   * the button and the tick box are on EVERY filtered table, not the two the
//     complaint happened to name;
//   * leaving a box, with the tick box clear, starts no work at all;
//   * the button is asleep until the boxes say something different from what
//     is applied — and asleep AGAIN if the old value is typed back, which is a
//     comparison against what is applied, never a "something was touched" flag;
//   * applying puts on exactly what the boxes say, so emptying a box clears it.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const JS = () => fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
const HTML = () => fs.readFileSync(path.join(ROOT, 'public', 'construct.html'), 'utf8');

// The tables that carry filters, READ from the calls rather than typed, so a
// table added tomorrow is covered without anybody remembering to add it here.
const gridKeys = (src) => [...new Set([...src.matchAll(/bFilterGrid\('([A-Z0-9]+)'/g)].map((m) => m[1]))];

// Pulled out of the source and run for real: a regex can say the comparison is
// written, only running it can say it answers correctly.
function theComparison() {
  const src = JS();
  const from = src.indexOf('const bSameFilters = (a, b) => {');
  assert.ok(from > 0, 'nothing compares the boxes to what is applied');
  const text = src.slice(from, src.indexOf('\n};\n', from) + 4);
  // eslint-disable-next-line no-eval
  return eval(`${text}; bSameFilters`);
}

module.exports = {
  async everyFilteredTableCanBePutOnInOneGo() {
    const src = JS();
    const keys = gridKeys(src);
    assert.ok(keys.length >= 4, `expected the four filtered tables, found ${keys.length}: ${keys}`);
    const grid = src.slice(src.indexOf('function bFilterGrid('), src.indexOf('function bWireFilters('));
    assert.ok(/data-bapply="\$\{key\}"/.test(grid),
      'a filtered table has no way to put its boxes on in one go, so every box is its own wait');
    assert.ok(/data-bauto="\$\{key\}"/.test(grid),
      'there is no way to turn the one-at-a-time behaviour back on');
    assert.ok(/>Apply settings</.test(grid) && />\s*auto-apply settings</.test(grid),
      'the two controls are not named on the screen');
    // KEYED PER TABLE. One shared name and Stage 1's button would put Stage 3's
    // boxes on — and the two are read from different halves of the page.
    assert.ok(/bAuto\(key\)/.test(grid),
      'the tick box is not remembered per table, so one table\'s choice speaks for all four');
  },

  async theButtonIsAsleepUntilThereIsSomethingToPutOn() {
    const src = JS();
    const grid = src.slice(src.indexOf('function bFilterGrid('), src.indexOf('function bWireFilters('));
    assert.ok(/data-bapply="\$\{key\}" disabled/.test(grid),
      'the button is drawn awake, so it invites a press that would redraw the table for no change');
    const st = src.slice(src.indexOf('function bApplyState('), src.indexOf('function bApplyFilters('));
    assert.ok(/bSameFilters\(bBoxesNow\(root, key\), bFilters\(key\)\)/.test(st),
      'the button is not comparing the boxes against what is applied — so typing a value back to '
      + 'what it already was would leave the button awake with nothing to do');
    assert.ok(/bAuto\(key\) \|\|/.test(st),
      'the button stays pressable while auto-apply settings is on, where it can only repeat work');
  },

  // The comparison itself, run rather than read.
  async typingTheOldValueBackIsNotAChange() {
    const same = theComparison();
    assert.strictEqual(same({}, {}), true, 'two empty sets of filters differ');
    assert.strictEqual(same({ a: '5' }, { a: '5' }), true, 'the same filter reads as changed');
    assert.strictEqual(same({ a: 5 }, { a: '5' }), true,
      'a box holds text and the store may hold a number — the same filter must not read as changed');
    assert.strictEqual(same({ a: '5' }, { a: '6' }), false, 'a changed filter reads as unchanged');
    assert.strictEqual(same({ a: '5' }, {}), false, 'a filter added reads as unchanged');
    assert.strictEqual(same({}, { a: '5' }), false, 'a filter emptied reads as unchanged');
    assert.strictEqual(same({ a: '5', b: '1' }, { a: '5', c: '1' }), false,
      'two different filters of the same count read as the same');
  },

  async leavingABoxStartsNoWorkUnlessAutoApplyIsTicked() {
    const src = JS();
    const wire = src.slice(src.indexOf('function bWireFilters('), src.indexOf('function bWireFilters(') + 1600);
    // the set goes along since 3.78.0 -- the stage 2 filters save on it,
    // because the stage 3 carry reads them -- but WHEN it applies is untouched
    assert.ok(/el\.onchange = \(\) => \{ if \(bAuto\(key\)\) bApplyFilters\(root, key, doc\); else bApplyState\(root, key\); \};/.test(wire),
      'leaving a box still puts its filter on whatever the tick box says, which is the minutes-per-box '
      + 'behaviour the button exists to end');
    assert.ok(/el\.oninput = \(\) => \{ if \(!bAuto\(key\)\) bApplyState\(root, key\); \};/.test(wire),
      'the button only reconsiders when a box is LEFT, so it cannot wake on the first keystroke or '
      + 'sleep again the moment the old value is typed back');
  },

  async applyingPutsOnExactlyWhatTheBoxesSay() {
    const src = JS();
    const set = src.slice(src.indexOf('function bSetFilters('), src.indexOf('const bAuto ='));
    assert.ok(/all\[key\] = \{ \.\.\.next \};/.test(set),
      'applying MERGES over what was already applied, so a box the owner emptied keeps filtering the '
      + 'table and nothing on screen says why');
    const ap = src.slice(src.indexOf('async function bApplyFilters('), src.indexOf('async function bApplyFilters(') + 700);
    assert.ok(/const next = bBoxesNow\(root, key\);\n  bSetFilters\(key, next\);/.test(ap),
      'applying does not read the boxes, so it puts on something other than what is on screen');
    // AND THE STAGE 2 FILTERS REACH THE RECORD SET (3.78.0, owner order: "the
    // carry from table 2 must NOT ignore filters!"). Every other table's
    // filters are a view; these decide what a stage 3 launch prices, so a
    // launch has to be able to read them.
    // AND THE STAGE 1 TABLE'S TOO (3.220.0, owner order: the stage 1 filters
    // carry fix), for the stage 2 carry, by the same rule
    assert.ok(/\(key === 'S1' \|\| key === 'S2'\) && doc && doc\.id/.test(ap) && /\/filters`, \{ filters: next \}/.test(ap),
      'the stage 1 or stage 2 filters stay in the browser, so the carry goes on taking the top of a table the owner is not looking at');
    assert.ok(/from\$\{key\}`\]: 0/.test(ap),
      'applying leaves the table on the page it was on, which can be past the end of a smaller result');
  },

  async tickingAutoApplyPutsOnWhatIsAlreadyTyped() {
    const src = JS();
    const cb = src.slice(src.indexOf("querySelectorAll('[data-bauto]')"), src.indexOf("querySelectorAll('[data-bauto]')") + 700);
    assert.ok(/bSaveAuto\(key, cb\.checked\)/.test(cb), 'the tick box is not remembered');
    assert.ok(/if \(cb\.checked && !bSameFilters\(bBoxesNow\(root, key\), bFilters\(key\)\)\) bApplyFilters/.test(cb),
      'ticking auto-apply settings leaves anything already typed unapplied in a box whose button has '
      + 'just been greyed out — it looks applied and is not');
  },

  // The page fades every disabled button whole. On this one the owner wants
  // only the words to go quiet, so the control still reads as a control that
  // is waiting rather than one that is not there.
  async theGhostedButtonKeepsItsOutline() {
    const html = HTML();
    const rule = html.match(/\.filters \.frow button\[disabled\] \{[^}]*\}/);
    assert.ok(rule, 'the apply settings button has no look of its own while it is asleep');
    assert.ok(/opacity:1/.test(rule[0]),
      'the whole button still fades, outline and all — the page fades every disabled button at the '
      + 'top of the stylesheet, and this one has to say otherwise');
    assert.ok(/color:var\(--muted\)/.test(rule[0]),
      'the words do not go quiet, so nothing on the button shows it is asleep');
  },

  // ONE STAGE AT A TIME, ON ITS OWN SUB TAB (3.238.0, owner order 2026-09-23:
  // "Boards gets 3 sub tabs: Stage 1, Stage 2, Stage 3"). Only the stage picked
  // is drawn, the pick is remembered, and with none yet the deepest stage
  // picked opens; Show in 3.B, pressed on Table 3.A, lands on Table 3.B's own
  // sub tab or its answer would be drawn nowhere.
  async boardsDrawsOneStageAtATimeOnItsOwnSubTab() {
    const src = JS();
    const draw = src.slice(src.indexOf('async function drawBoards()'), src.indexOf('async function bDrawTable('));
    assert.ok(draw.includes("const stab = B_T3.includes(view.stab) ? (fold[3] && s3sel ? view.stab : 3) : [1, 2, 3].includes(Number(view.stab)) ? Number(view.stab) : deepest;"),
      'the stage sub tab is not remembered, or a first visit does not open on the deepest stage picked');
    for (const n of [1, 2, 3]) {
      assert.ok(draw.includes(`<div class="tab\${stabOn(${n})}" data-bstab="${n}">Stage ${n}</div>`), `there is no sub tab for Stage ${n}`);
      const gate = draw.indexOf(`\${stab !== ${n} ? '' : \`<div class="panel">`);
      const pick = draw.indexOf(`id="bPick${n}"`);
      assert.ok(gate > 0 && pick > gate && pick - gate < 400, `Stage ${n}'s section is drawn whichever sub tab is picked`);
    }
    assert.ok(draw.includes("bSaveView({ stab: n });\n      bRedrawPeggedTo(`[data-bstab=\"${n}\"]`);"), 'a sub tab press is not remembered, or it moves the page');
    const pin = src.slice(src.indexOf("querySelectorAll('[data-bpin3b]')"), src.indexOf("querySelectorAll('[data-bpin3b]')") + 2200);
    assert.ok(pin.includes("stab: '3B',"), 'Show in 3.B does not land on the Table 3.B tab, so its answer is drawn nowhere');
    const b3 = src.slice(src.indexOf('async function bDrawStage3('));
    // THE TABLE TABS JOIN THE STAGE STRIP, only while Stage 3 or one of them is
    // picked (3.239.0), and a table tab draws its table alone (3.239.1)
    assert.ok(draw.includes('const onS3 = (stab === 3 || B_T3.includes(stab)) && fold[3] && !!s3sel;'), 'the table tabs do not know when Stage 3 or a table is picked, or stay while Stage 3 is put away');
    // PUTTING A STAGE AWAY PUTS EVERY STAGE UNDER IT AWAY (3.240.0); Open opens its own
    // PUT AWAY LETS GO OF THE RECORD SET AND OF EVERY ONE UNDER IT (3.241.2); the stages above are written down as shown
    assert.ok(draw.includes("} else if (selOf[sN]) {") && draw.includes("if (k < sN) patch[`s${k}`] = selOf[k];\n          else { patch[`s${k}`] = null; patch[`p${k}`] = undefined; patch[`fold${k}`] = false; }"),
      'Put away on a Boards stage does not empty its record set box and the boxes under it');
    // THE SAME RULES AS SWEEP (3.241.3): a stage under one with nothing picked or put away is greyed
    assert.ok(draw.includes('const upEmpty = { 1: false, 2: !s1sel || !fold[1], 3: !s1sel || !s2sel || !fold[1] || !fold[2] };'),
      'a Boards stage under one with nothing picked is not greyed');
    for (const n of [1, 2, 3]) assert.ok(draw.includes(`<select id="bPick${n}" style="min-width:26rem"\${pickOff(${n}) ? ' disabled' : ''}>`), `the stage ${n} record set box is not greyed with nothing picked above it`);
    // ...and it is greyed and live WITH ITS OPEN (3.241.5, owner order 2026-09-24:
    // "the same goes for the open button on boards"), not until Open is pressed
    assert.ok(draw.includes('const pickOff = (n) => upEmpty[n];'), 'a stage\'s record set box is greyed while its Open is live');
    assert.ok(draw.includes("upEmpty[stage] ? 'disabled class=\"ctl-off\"' : ''"), 'the Open and the box no longer share one rule');
    // a stage under an empty one is put away, so filling the one above opens nothing (3.241.4)
    assert.ok(draw.includes("for (const k of [2, 3]) if (upEmpty[k] && fold[k]) { fold[k] = false; bSaveView({ [`fold${k}`]: false }); }"),
      'picking a set above opens the stage under it');
    assert.ok(draw.includes("if (!s1sel && !s2sel && !s3sel && view.s1 === undefined && view.s2 === undefined && view.s3 === undefined) {"),
      'boxes emptied by Put away are filled again with the newest set on the next draw');
    assert.ok(draw.includes("bSaveView(fold[sN] ? Object.fromEntries([1, 2, 3].filter((k) => k >= sN).map((k) => [`fold${k}`, false])) : { [`fold${sN}`]: true });"),
      'putting a stage away leaves the stages under it open, or Open opens more than its own stage');
    assert.ok(draw.includes("${!onS3 ? '' : `<div class=\"tab tab-gap${t3On('3A')}\" data-bt3tab=\"3A\">Table 3.A</div>"),
      'the table tabs are not on the Stage strip, or they show under Stage 1 and Stage 2, or Table 3.A is not set apart from Stage 3');
    assert.ok(draw.includes("${B_T3.includes(stab) ? '<div id=\"bT3\"></div>' : ''}"), 'a table tab draws the Stage 3 section above its table');
    assert.ok(draw.includes("await bDrawTable(doc3, view, '#bT3');"), 'a table tab does not draw the picked stage 3 set\'s table');
    assert.ok(/\.tab\.tab-gap \{ margin-left:/.test(HTML()), 'the space before Table 3.A styles against a class the stylesheet does not have');
    assert.ok(draw.includes("bSaveView({ stab: k });\n      if (was && $('#bT3') && bDrawn[3]) bRepaintTable(3, { peg: '#bStageTabs' });\n      else bRedrawPeggedTo(`[data-bt3tab=\"${k}\"]`);"),
      'a table tab press is not remembered, or it moves the page');
    // THE STAGE 3 TAB STOPS AT Check this set and asks for no table (3.239.1)
    assert.ok(b3.includes("${t3 ? '' : `<h3 style=\"margin-top:0\">${swHead}</h3>\n    ${bCheckLine("), 'the Stage 3 tab does not end at Check this set');
    assert.ok(b3.includes("t3 ? apiOr(`api/stageset/${doc.id}/ranked?${rankQs}`, null) : null,"), 'the Stage 3 tab asks for a table it does not draw');
    // each table tab starts with its title line
    for (const t of ['Table 3.A: Settings, ranked', 'Table 3.B: Every coin of every setting', 'Table 3.C: Every unit']) {
      assert.ok(src.includes(`<p class="t3head" style="margin-top:0"><b>${t}</b>`), `${t} does not start its tab`);
    }
    assert.ok(b3.includes("document.querySelectorAll('[data-bt3tab]').forEach((el) => el.classList.toggle('on', el.dataset.bt3tab === t3));"),
      'the strip is not marked with the table the stage 3 draw drew, so Show in 3.B leaves Table 3.A marked');
    assert.ok(!b3.slice(0, b3.indexOf('\nasync function ') > 0 ? b3.indexOf('\nasync function ') : undefined).includes('id="bT3Tabs"'), 'a second strip of table tabs is still drawn inside Stage 3');
  },

  // EACH STAGE 3 TABLE ON ITS OWN SUB TAB (3.238.0). They used to share one
  // panel with a break drawn between them; now only the table whose sub tab
  // is picked is drawn at all, so no heading can read as a note under another.
  async theStageThreeTablesAreEachOnTheirOwnSubTab() {
    const src = JS();
    const html = HTML();
    const heads = [['3A', 'Table 3.A: Settings, ranked'], ['3B', 'Table 3.B: Every coin of every setting']];
    for (const [k, words] of heads) {
      const i = src.indexOf(words);
      assert.ok(i > 0, `the Table ${k} heading is not where this expects it`);
      assert.ok(/class="t3head"/.test(src.slice(i - 40, i)),
        `the Table ${k} heading is the same size as the notes around it, so it does not read as the name of a table`);
      const gate = src.lastIndexOf(`\${t3 !== '${k}' ? '' :`, i);
      assert.ok(gate > 0 && i - gate < 400, `Table ${k} is drawn whichever sub tab is picked`);
    }
    assert.ok(src.includes("${t3 !== '3C' ? '' : bUnitsSection(doc, units, view)}"), 'Table 3.C is drawn whichever sub tab is picked');
    for (const k of ['3A', '3B', '3C']) {
      assert.ok(src.includes(`data-bt3tab="${k}">Table ${k[0]}.${k[1]}</div>`), `there is no sub tab for Table ${k}`);
    }
    assert.ok(/\.t3head \{ font-size:1\.05rem;/.test(html), 'the table headings have no size of their own');
    assert.ok(!/t3break/.test(src), 'a break between tables that are never on the screen together is still drawn');
  },
};
