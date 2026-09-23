// The Boards screen's surfaces.
//
// CUT BACK 2026-08-28 (owner order: "get rid of the Sweep, Sweep2, Boards, and
// Boards2 tabs. make the existing 'Sweep3' just 'Sweep' and the existing
// 'Boards3' just 'Boards'"). This file used to hold fourteen checks. Twelve of
// them named things that were only ever on the deleted Boards — the menu grid
// and its plateau reading, the inspect panel, the ranked replication list and
// its heading, the six source lines, the open-records state, the remembered
// board view, the four floors, copy-settings into the old Sweep form, the run
// identity line and the asset predictability summary. Their subject is gone, so
// they are gone with it, listed here so the removal is a record and not a
// silence. What remains is what the surviving screens still do.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');

module.exports = {
  // THE TIE WORDING WENT WITH THE ALWAYS GATE (2026-09-02). Only a setting
  // that ignored the forecast could tie every shuffle comparison; with no such
  // gate there is nothing to mark, and a column that could still be marked
  // would be marking a gate the engine does not have.
  theTablesNoLongerSpeakOfTies() {
    assert.ok(!/nullTies|B_TIED|tied\b/.test(UI.slice(UI.indexOf('const bDash'), UI.indexOf('const bCoin'))), 'the dash carries no tie story');
    assert.ok(UI.includes('function bShare(share, beat, pairs) {'), 'the share column takes no tie mark');
    assert.ok(UI.includes('const bLead = (v) => (v == null ? bDash() :'), 'nor does the lead column');
    const stagesSrc = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.ok(!/nullSetHonest|nullTies|nullSetCanBeat/.test(stagesSrc), 'nothing in the tables empties a number for a gate that no longer exists');
  },

  // A TICK ON THE LEFT OF EVERY RECORD (owner order, 2026-09-02). It names the
  // record by its own number on the set -- never by its place in a sort or
  // on a page, which change -- and the ticks save on the record set the
  // moment they change, the way a column sort does.
  theStageTwoTableOffersATickOnEveryRecordThatSavesOnTheSet() {
    const body = UI.slice(UI.indexOf('async function bDrawStage2('), UI.indexOf('\nasync function bDrawStage3('));
    // btdN0 is the first-column cell that never wraps (3.72.0): on the stage 1
    // and stage 2 tables a row is one line, so a column can be read down
    assert.ok(body.includes('<td ${btdN0}><input type="checkbox" data-bpick="S2:${r.u}"${picked.has(r.u) ? \' checked\' : \'\'}'),
      'every record carries a tick named by its record number, drawn ticked when the set says so');
    assert.ok(body.includes('<input type="checkbox" data-bpickpage="S2"'), 'the heading tick picks or clears the page');
    assert.ok(body.includes('<button data-bpickclear="S2"'), 'and every pick can be cleared at once');
    assert.ok(body.includes('<b data-bpickcount="S2">${picked.size.toLocaleString()}</b> picked on this record set'), 'the count of picks is on the screen');
    assert.ok(body.includes("const picked = new Set((t && t.picked) || []);"), 'the ticks are drawn from the picks the set serves with its table');
    // counted, never typed: a typed colspan goes stale the moment a column is
    // added, which is what happened at 3.121.0
    const heads = (body.match(/<th /g) || []).length;
    const span = /colspan="(\d+)" class="empty"/.exec(body);
    assert.ok(span, 'the empty row has no colspan at all');
    assert.strictEqual(Number(span[1]), heads, `the empty row spans ${span && span[1]} of ${heads} columns`);
    assert.ok(body.includes('bWirePicks(doc, mount, t);'), 'the ticks are wired');
    const wire = UI.slice(UI.indexOf('function bWirePicks('), UI.indexOf('\nasync function bDrawStage3('));
    assert.ok(wire.includes("await tryPost(`api/stageset/${encodeURIComponent(doc.id)}/picked`, { picked: [...next] });"),
      'a change saves the whole list on the record set');
    assert.ok(wire.includes('if (!(await save(next))) cb.checked = !cb.checked;'), 'a save that fails puts the tick back');
  },

  // THE NAME IS THE OWNER'S, on every open section (owner order, 2026-09-03).
  // Drawn and held asleep exactly as the notes are: literal ids, three copies
  // that must not drift, wired to the set's own rename address, and the button
  // says why it sleeps while the set is being written.
  theNameIsTheOwnersOnEveryOpenSection() {
    for (const n of [1, 2, 3]) {
      for (const id of [`bName${n}`, `bRename${n}`, `bNameMsg${n}`]) {
        assert.ok(UI.includes(`id="${id}"`), `the stage ${n} section is missing ${id}`);
      }
    }
    const bodyOf = (n) => {
      const at = UI.indexOf(`function namePanel${n}(doc) {`);
      assert.ok(at > 0, `namePanel${n} is gone`);
      return UI.slice(at, UI.indexOf('\n}', at))
        .split(`namePanel${n}`).join('namePanel#')
        .split(`bRename${n}`).join('bRename#')
        .split(`bNameMsg${n}`).join('bNameMsg#')
        .split(`bName${n}`).join('bName#');
    };
    assert.strictEqual(bodyOf(2), bodyOf(1), 'the stage 2 name box has drifted from the stage 1 one');
    assert.strictEqual(bodyOf(3), bodyOf(1), 'the stage 3 name box has drifted from the stage 1 one');
    assert.ok(bodyOf(1).includes('<div class="row" style="align-items:flex-end">'), 'the box and its button do not line up along their bottom edge');
    assert.ok(/tryPost\(url, \{ name: box\.value \}\)/.test(UI), 'the rename posts the single field the endpoint reads');
    assert.ok(UI.includes("    wireRename(`api/stageset/${encodeURIComponent(doc.id)}/name`, String(stage));"),
      'Boards does not wire the rename to its own record set\'s name address');
    assert.ok(UI.includes("${stage === 1 ? namePanel1(doc) : stage === 2 ? namePanel2(doc) : namePanel3(doc)}${stage === 1 ? notesPanel1(doc)"),
      'the name box is not drawn above the notes on every open section');
    assert.ok(/the name changes after the run finishes/.test(UI), 'the button must say WHY it is asleep while the set is being written');
    assert.ok(/drawBoardsHoldingPlace\(\);\n    \}\n  \};\n\}\nfunction wireNotesSave/.test(UI),
      'a rename must redraw Boards where it stands, because every picker and heading shows the name');
  },

  // The notes box and its save are drawn and wired by ONE pair of functions
  // (notesPanelHtml / wireNotesSave). Only one screen carries them now, but the
  // properties are the ones that were always the point.
  notesAreReadableWritableAndRefusedWhileTheRunComputes() {
    // ONE BOX PER OPEN SECTION, each with a LITERAL id (2026-08-29). It used to
    // be drawn on the deepest selection only, so a stage 3 record set took the
    // box away from the two sections above it. The ids are literal because
    // lib/screencontrols.js reads them out of the source — an id built at
    // runtime is a control the owner can see and the word list cannot name.
    for (const n of [1, 2, 3]) {
      for (const id of [`bNotes${n}`, `bNotesSave${n}`, `bNotesMsg${n}`]) {
        assert.ok(UI.includes(`id="${id}"`), `the stage ${n} section is missing ${id}`);
      }
    }
    // AND THE THREE MUST NOT DRIFT. Three copies of one control is how one of
    // them quietly stops matching the others.
    const bodyOf = (n) => {
      const at = UI.indexOf(`function notesPanel${n}(doc) {`);
      assert.ok(at > 0, `notesPanel${n} is gone`);
      // ONLY the id suffixes are normalised. Replacing the bare digit everywhere
      // also rewrote .slice(0, 16) differently for n=1 than for n=2, which made
      // this fail on three boxes that were in fact identical.
      return UI.slice(at, UI.indexOf('\n}', at))
        .split(`notesPanel${n}`).join('notesPanel#')
        .split(`bNotesSave${n}`).join('bNotesSave#')
        .split(`bNotesMsg${n}`).join('bNotesMsg#')
        .split(`bNotes${n}`).join('bNotes#');
    };
    assert.strictEqual(bodyOf(2), bodyOf(1), 'the stage 2 notes box has drifted from the stage 1 one');
    assert.strictEqual(bodyOf(3), bodyOf(1), 'the stage 3 notes box has drifted from the stage 1 one');
    assert.ok(/tryPost\(saveUrl, \{ text: box\.value \}\)/.test(UI),
      'saved with the single field the endpoint reads');
    assert.ok(/wireNotesSave\(`api\/stageset\/\$\{encodeURIComponent\(doc\.id\)\}\/notes`/.test(UI),
      'the Boards screen must wire the save to its own record set\'s notes address');
    assert.ok(/const off = doc\.status === 'running';/.test(UI)
      && /\$\{off \? 'disabled' : ''\}/.test(UI),
    'the engine refuses writes while a run computes, so the box must say so rather than failing on save');
    assert.ok(/notes save after the run finishes/.test(UI),
      'and the button must say WHY it is asleep, not just be dead');
    assert.ok(/out\.notes \|\| ''/.test(UI),
      're-render from the RESPONSE: the stored value comes back truncated');
  },

  // THE BUTTON THAT PUTS BACK THE UNITS A RUN LOST (3.73.0, owner order
  // 2026-09-06). It only exists on a stage 1 set that is short, it never
  // launches anything on its own, and the reason it cannot be pressed is the
  // SERVICE's sentence printed word for word -- a second copy of those reasons
  // on this page would be a second answer to one question.
  theShortStageOneSetOffersToPutItsMissingUnitsBack() {
    assert.ok(UI.includes('<button id="bFillUnits" data-bfillunits="${esc(doc.id)}">Put the missing units back</button>'),
      'a short stage 1 set carries the control');
    const at = UI.indexOf('async function bWireFillUnits(doc) {');
    assert.ok(at > 0, 'and it is wired');
    const fn = UI.slice(at, UI.indexOf('\n}\n', at));
    assert.ok(fn.includes('`api/stageset/${encodeURIComponent(doc.id)}/fill-units`'), 'it posts to the set it is drawn on');
    assert.ok(fn.includes('await tryPost(path, {})'), 'and it sends nothing else — the choices come off the set, never off this page');
    assert.ok(!/swT|swBand|swDec|swAllData|swStart|swEnd/.test(fn),
      'it must never read a box on Sweep: a unit trained on a different window would be ranked against the rest with nothing able to tell them apart');
    assert.ok(fn.includes('if (st && st.why) { btn.disabled = true;'),
      'a set that cannot be filled says why BEFORE it is pressed, not after');
    assert.ok(fn.includes('esc(st.why)') && !fn.includes('measurement block'),
      'the reason is the service own sentence, printed, never a second copy of the rules on this page');
    assert.ok(UI.includes("if (doc.stage === 1 && doc.status === 'incomplete') bWireFillUnits(doc);"),
      'wired only on a stage 1 set that is actually short');
  },


  // A STAGE 4 RECORD SET CAN BE DELETED (owner order, 2026-09-06: "there's no
  // way to delete s4 data" and "s1/2/3 wont delete cause 4 exists").
  //
  // Boards drew Delete record set… for stages 1, 2 and 3 because those are the
  // sections it has. A stage 4 set is drawn on the Funnel and nowhere else, so
  // it had no delete anywhere -- and a set another set was cut from refuses to
  // be deleted while that set is still there, so ONE undeletable stage 4 set
  // made its stage 3, stage 2 and stage 1 parents undeletable too. The whole
  // chain was walled in behind a missing button.
  theStageFourRecordSetCanBeDeletedFromTheScreenItLivesOn() {
    assert.ok(UI.includes('<button id="fCutDelete" class="danger"'), 'the Stage 4 heading carries a delete');
    const at = UI.indexOf('function fWireCut(d, st, cd) {');
    assert.ok(at > 0, 'and it is wired');
    const fn = UI.slice(at, UI.indexOf('\n}\n', at));
    const wire = fn.indexOf("const dl = $('#fCutDelete');");
    const bail = fn.indexOf('if (!cd) return;');
    assert.ok(wire > 0 && bail > 0 && wire < bail,
      'it must be wired BEFORE the early return: a set that will not open is the one most likely to want deleting');
    // it asks first, and it takes the id typed back -- the same two steps the
    // stage 1, 2 and 3 deletes take, because this removes just as much
    // 3.133.0: through the one flow Boards and Sweep use, which previews first
    // and refuses anything but the record set id typed back
    assert.ok(fn.includes('const done = await deleteSetFlow(st.cut);'), 'it does not go through the one delete flow');
    const flow = UI.slice(UI.indexOf('async function deleteSetFlow(id) {'), UI.indexOf('\n}\n', UI.indexOf('async function deleteSetFlow(id) {')));
    assert.ok(flow.includes("await tryPost(`api/stageset/${encodeURIComponent(id)}/delete`, {})"), 'it previews first');
    assert.ok(flow.includes("if (typed.trim() !== look.confirmWith) { alert('That is not the record set id — nothing was deleted.'); return null; }"),
      'and refuses anything but the record set id typed back');
    // ...and it only ever deletes the set that is CHOSEN, never the walk
    assert.ok(fn.includes('if (dl && st.cut && st.cut !== F_NEW)'),
      'nothing is offered to delete while the screen is on new rule — there is no set there to delete');
    assert.ok(UI.includes('<button id="fCutDelete" class="danger" ${chosen ? \'\' : \'disabled\'}'),
      'and the control is dead on screen rather than silently doing nothing');
  },

  // THE COINS A ROW IS READ ALONGSIDE, UNDER coin + chunk shape (3.79.0; named
  // on the column in 3.79.1; that name settled as alongside in 3.79.2 --
  // owner order 2026-09-07:
  // "on table 3 b you need to at '+ ASSOCIATED COINS' under the 'COIN + CHUNK
  // SHAPE' column in cases of selections with doubles or triples").
  //
  // This is not decoration. That table's rows are ALREADY split on the coins a
  // row is read against -- keyOf joins cellLabel, trade, ctx1, ctx2 and
  // geometry -- but the cell printed only the traded coin and the chunk shape.
  // So one coin judged on its own and the same coin read against two others
  // were two DIFFERENT rows carrying IDENTICAL text, with different money on
  // them and nothing on screen to say which was which.
  theEveryCoinTableNamesTheCoinsARowIsReadAgainst() {
    const lift = (head) => {
      const at = UI.indexOf(head);
      assert.ok(at > 0, `${head} is gone`);
      return UI.slice(at, UI.indexOf('\n};\n', at) + 3);
    };
    // the page's own escaper, lifted with it -- a coin name arrives from the
    // record and is printed, so it goes through the same guard every other
    // printed name does
    // eslint-disable-next-line no-eval
    const bAlso = eval(`(() => { ${lift('const esc = (t) => {')}\n${lift('const bAlso = (r) => {')}\nreturn bAlso; })()`);

    assert.strictEqual(bAlso({ trade: 'LTCUSDT' }), '',
      'a coin judged on its own is read against nothing, so it gets no second line');
    assert.strictEqual(bAlso({ trade: 'LTCUSDT', ctx1: 'BTCUSDT' }), '<div class="muted">+ BTCUSDT</div>',
      'a coin read alongside one other names that one');
    assert.strictEqual(bAlso({ trade: 'LTCUSDT', ctx1: 'BTCUSDT', ctx2: 'ETHUSDT' }),
      '<div class="muted">+ BTCUSDT + ETHUSDT</div>',
      'a coin read alongside two others names both');
    assert.ok(bAlso({ trade: 'LTCUSDT', ctx1: '<b>' }).includes('&lt;b>'),
      'and what it prints goes through the page escaper');

    // THE COLUMN SAYS SO, IN THE OWNER'S OWN WORDS (3.79.1). 3.79.0 put the
    // coins in the cell and left the heading naming only two of the three
    // things under it, which is not what was asked for.
    assert.ok(UI.includes(">coin + chunk shape + alongside${bCoinSortBtn(view, 'coin', '\u2191')}</th>"),
      'the column no longer names the coins the row is read alongside');
    // ONE NAME FOR ONE THING (3.79.2, owner: "FINE, call it ALONGSIDE then").
    // The two tables above head this same content alongside; a third word for
    // it on the third table is the drift that makes the owner check which
    // screen they are on before they can read a row.
    // the comments still quote the owner's order word for word -- that is the
    // record of why this column reads the way it does. What must not carry a
    // second name is anything that RENDERS, so the scan drops comment lines.
    const rendered = UI.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/associated coins/i.test(rendered), 'a second name for alongside is back on the screen');

    // AND THE CELL ACTUALLY PRINTS THEM. The line below is the one the owner reads.
    assert.ok(UI.includes('<td ${btd}>${bCoin(r)} <span class="muted">${esc(bGeo(r.geometry))}</span>${bAlso(r)}</td>'),
      'the coin + chunk shape + alongside cell of Table 3.B no longer prints the coins the row is read against');

    // AND THE TWO TABLES ABOVE IT DO NOT. They carry their own alongside
    // column beside the coin, and printing the same coins twice on one row is
    // exactly what the owner had removed from them on 2026-09-06.
    const above = UI.slice(UI.indexOf('async function bDrawStage1('), UI.indexOf('async function bDrawStage3('));
    assert.ok(above.length > 1000, 'the stage 1 and stage 2 draws were not found');
    assert.ok(!above.includes('bAlso('),
      'the stage 1 and stage 2 tables have an alongside column of their own — a second copy in the coin cell is the waste that was cut');
    assert.strictEqual((above.match(/>alongside\$\{bSortBtn/g) || []).length, 2,
      'both of those tables still head that column alongside');
  },

};

// EVERY CONTROL CARRIES ITS HELP AS HOVER TEXT (owner order, 2026-08-26:
// "where's the tool tip on the decision drop down in Sweep? missing tool
// tips on many (most?) of the controls"). The hover is wired from the Help
// tab's entries — which test-help.js forces to exist for every control — so
// a control cannot be hoverless, and the words cannot drift from the Help
// tab's. A hand-written title in the template wins over the wired one.
//
// THE TAB LIST IS READ FROM THE CODE, not typed here (2026-08-28). It was
// typed, and the day four screens were deleted this check went on demanding
// hovers for screens that no longer existed while it could not have noticed a
// NEW screen wired to nothing. Reading TABS catches both.
module.exports.everyControlsHelpBecomesItsHover = function () {
  const { assert: a } = require('./helpers');
  const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
  a.ok(/function hoverFromHelp\(key\)/.test(src), 'the wiring function is gone');
  a.ok(/if \(!el\.title\) el\.title = text;/.test(src),
    'a hand-written title no longer wins — the sharper in-place warnings get overwritten');
  a.ok(/if \(lab && !lab\.title\) lab\.title = text;/.test(src),
    'the caption around a control no longer carries the hover');
  const keys = require('../lib/screencontrols').tabs().map((t) => t.key).filter((k) => k !== 'help');
  a.ok(keys.length >= 7, `only ${keys.length} screens were read out of TABS — the list cannot be right`);
  for (const key of keys) {
    a.ok(new RegExp(`hoverFromHelp\\('${key}'\\)`).test(src), `the ${key} draw no longer wires its hovers`);
  }
};

// THE BOARDS TABLES ARE DESIGNED, NOT ACCUMULATED (3.228.0, owner 2026-09-22,
// a photograph of Table 3.A: "enumerate all the things wrong with this
// layout ... make it right"). One unbreakable line of field figures under the
// verdict word set the width of the whole table and pushed a third of its
// columns off a 1920-wide screen; the field gate beside it was crushed into
// five lines with its sizing printed as the name's shorthand; two columns were
// called verdict; the sort marks wrapped under narrow headings; the counts and
// the money on one line were formatted two ways; the button row under the
// filters started at the names' edge, not the boxes'. Read from the source,
// and run where a function can be run.
module.exports.theBoardsFieldAndVerdictCellsWrapInsteadOfWideningTheTable = function () {
  const { assert: a } = require('./helpers');
  const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'construct.html'), 'utf8');
  const lift = (head, end) => { const at = src.indexOf(head); a.ok(at > 0, `${head} is gone`); return src.slice(at, src.indexOf(end, at) + end.length); };
  for (const fn of ['function bFieldNumbers(t) {', 'function bLeanNumbers(parts, confirm, kx, ux) {']) {
    const body = lift(fn, '\n}\n');
    a.ok(!/<div[^>]*white-space:nowrap/.test(body), `${fn} still prints its figures as one line that may not wrap`);
    a.ok(body.includes('class="muted bnums'), `${fn} does not print its figures in the shared block`);
  }
  a.ok(/td \.bwords \{[^}]*max-width:\s*19rem/.test(css) && /td \.bwords \{[^}]*text-align:\s*left/.test(css), 'the words-over-numbers block is not held to a width, or is not left-aligned');
  a.ok(/td \.bnums \{[^}]*white-space:\s*normal/.test(css), 'the figures under a word may not wrap');
  // the sizing in words, run: the shorthand becomes "up to READ ×MULTIPLE" per rung, and stays on the hover
  const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const money = (v) => `${Number(v) < 0 ? '-' : ''}$${Math.abs(Number(v)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const { bFieldGate, bFieldNumbers } = new Function('esc', 'money', `${lift('function bFieldGate(r) {', '\n}\n')}\n${lift('function bFieldNumbers(t) {', '\n}\n')}\nreturn { bFieldGate, bFieldNumbers };`)(esc, money);
  const cell = bFieldGate({ label: 'count 50% market t41h · argmax auto 24/7 · field agreement≥40 & certainty≥70 sized by certainty ×70:0.75,80:1,90:1.25,100:1.5 silent×1' });
  a.ok(cell.includes('agreement≥40 &amp; certainty≥70'), `the bars are not on the cell: ${cell}`);
  a.ok(cell.includes('sized by certainty: <span style="white-space:nowrap">up to 70 ×0.75</span>, <span style="white-space:nowrap">up to 80 ×1</span>, <span style="white-space:nowrap">up to 90 ×1.25</span>, <span style="white-space:nowrap">up to 100 ×1.5</span>, <span style="white-space:nowrap">silent ×1</span>'),
    `the sizing is not said in words: ${cell}`);
  a.ok(cell.includes('title="sized by certainty ×70:0.75,80:1,90:1.25,100:1.5 silent×1"'), 'the shorthand is not kept on the hover');
  a.strictEqual(bFieldGate({ label: 'count 50% market t41h · argmax auto 24/7' }), '<span class="muted">none</span>');
  const nums = bFieldNumbers({ placed: 3955, blockedSign: 6312, blockedMin: 5999, silent: 0, pnl: 2891.75, size: 4852.3, at1: 1968.71, blockedAt1: -2535.65 });
  a.ok(nums.includes('class="muted bnums bgrid"') && nums.includes('<span>placed 3,955</span><span>sized $2,891.75</span>') && nums.includes('<span>over size 4,852.3 in all</span>')
    && nums.includes('<span>silent 0</span><span>blocked at size 1 -$2,535.65</span>') && !nums.includes('$-'),
    `the figures are not two short columns with every number formatted the one way: ${nums}`);
  a.ok(/td \.bgrid \{ display:grid; grid-template-columns:max-content max-content/.test(css), 'the figures block is not laid out as two columns');
  // money on the page carries thousands separators, as every count already did
  const moneyFn = new Function(`${lift('const money = (v) => {', '\n};\n')}\nreturn money;`)();
  a.strictEqual(moneyFn(2891.75), '$2,891.75'); a.strictEqual(moneyFn(-2535.65), '-$2,535.65'); a.strictEqual(moneyFn(27.674), '$27.67'); a.strictEqual(moneyFn(null), '—');
  // two columns called verdict: the confirm's says whose it is, on both tables
  a.ok(src.includes(">confirm verdict${bRankSortBtn(doc, 'verdict', 'desc')}</th>") && src.includes(">confirm verdict${bCoinSortBtn(view, 'verdict', '↓')}</th>"), 'a column is still called just verdict beside field verdict');
  // the sort mark is glued to the heading's last word
  a.ok(src.includes('return `<span class="bsort"><button data-branksort=') && src.includes('return `<span class="bsort"><button data-bcoinsort=') && /th \.bsort \{ display:block; min-height:1\.15rem/.test(css), 'the sort mark is not on its own line under every heading');
  a.ok(src.includes(">#${bNoSort}</th>") && src.includes(">show in 3.B${bNoSort}</th>"), 'a heading that does not sort has no blank line, so its words sit a line lower than the others');
  // a tall row reads from its top
  a.ok(src.includes(`const btd = 'style="padding:.25rem .3rem;vertical-align:top"';`), 'cells of a tall row are not top-aligned');
  // the button row under the filters starts where the boxes start
  a.ok(/\.filters \.frow \{ grid-column:2 \/ -1;/.test(css), 'the filter buttons start under the names instead of under the boxes');
};

// SHOW IN 3.B OPENS EVERY ROW'S RECORDS ON PURPOSE, AND CLOSE ALL RECORDS IS
// THE WAY BACK (3.231.0, owner 2026-09-23: "the way you've got it coded now
// it's like punishment for using the button"). One button in a row of its own
// above the table with its count beside it, dead while nothing is open, that
// empties the open list and repaints the table where it stands.
module.exports.showInThreeBOpensEveryRowAndCloseAllRecordsClosesThemAgain = function () {
  const { assert: a } = require('./helpers');
  const body = UI.slice(UI.indexOf('async function bDrawStage3('));
  const row = body.slice(body.indexOf('<button data-brecclose="S3C"'), body.indexOf('<div class="scrollx"><table style="border-collapse:collapse"><thead><tr data-bcoinhead'));
  a.ok(row.length > 0 && row.length < 900, 'Close all records is not drawn just above Table 3.B');
  a.ok(row.includes(`<button data-brecclose="S3C"\${openKeys.size ? '' : ' disabled'}`), 'the button is not dead while nothing is open');
  a.ok(row.includes('>Close all records</button>'), 'the button is not named Close all records');
  a.ok(row.includes("row(s) have their records open` : 'no records are open'"), 'the count beside the button does not say how many rows are open');
  // its own row, with no field in it (RULE FOUR-A), and the button first
  const start = body.lastIndexOf('<div class="row">', body.indexOf('<button data-brecclose="S3C"'));
  a.ok(start > 0 && !body.slice(start, body.indexOf('<button data-brecclose="S3C"')).includes('<label'), 'the button shares a row with a field');
  // the press empties the open list and holds the page on the rows' own peg
  const wire = body.slice(body.indexOf("querySelectorAll('[data-brecclose]')"), body.indexOf("querySelectorAll('[data-brecclose]')") + 400);
  a.ok(wire.includes('bSaveView({ openS3: [] });') && wire.includes("bRepaintTable(3, { peg: '[data-bcoinhead]' });"), 'the press does not close every row and repaint in place');
  // and Show in 3.B still opens them all -- the press is the way back, not a change to the door
  a.ok(body.includes("openS3: 'all',                 // every coin's records, opened"), 'Show in 3.B no longer opens every coin\'s records');
  const help = fs.readFileSync(path.join(ROOT, 'public', 'help-content.js'), 'utf8');
  a.ok(help.includes("'Every coin opens its own records separately, so a setting priced on many coins takes a moment. Close all '")
    && help.includes("+ 'records, in the row above the table, closes every open row again at once.'"), 'the Help tab does not say how to close them again');
};

