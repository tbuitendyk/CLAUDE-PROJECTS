// Attack 4 — the screens.
//
// The screens are where a wrong number stops being a bug and becomes a
// decision. This attack does three things:
//
//   * takes the REAL formatting helpers out of the shipped pages and feeds
//     them the values a broken record produces, to see what the owner would
//     actually read;
//   * checks the two pages agree with each other, because a figure formatted
//     one way on one screen and another way on the other means one of them is
//     lying and there is no way to tell which;
//   * checks every place the Trade page asks "is this the paper side or the
//     live side", because that is the one remaining way Paper Books and Live
//     Trading can drift apart (RULE TWO).
//
// Nothing here opens a browser. The helpers are lifted out of the page source
// by name and run for real, the same way tests/test-dashtotals.js does — a
// copy of the code would only ever agree with itself.
const fs = require('fs');
const path = require('path');
const { finding } = require('./harness');

const ROOT = path.join(__dirname, '..', '..');
const PAGES = {
  'the Trade page': path.join(ROOT, 'public', 'trade.html'),
  'the Construct page': path.join(ROOT, 'public', 'construct.js'),
};

// Lift a one-line top-level helper: `const money = (v) => ...;`
function liftArrow(src, name) {
  const re = new RegExp(`^const ${name}\\s*=\\s*(\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`, 'm');
  const m = re.exec(src);
  if (!m) return null;
  // Take from the `=` to the end of the statement, matching brackets so a
  // multi-line arrow body comes across whole.
  let i = src.indexOf('=', m.index) + 1;
  let depth = 0; let j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) break;
  }
  const body = src.slice(i, j).trim();
  try {
    // eslint-disable-next-line no-new-func
    return new Function(`return (${body});`)();
  } catch (_) { return null; }
}

// What a broken record actually hands a formatter.
const NASTY = [
  ['nothing at all', undefined],
  ['a blank', null],
  ['not-a-number', NaN],
  ['infinity', Infinity],
  ['minus infinity', -Infinity],
  ['an empty piece of text', ''],
  ['a word', 'abc'],
  ['a number written as text', '12.5'],
  ['an object', { usd: 1 }],
  ['a list', [1, 2]],
  ['true', true],
];

// What counts as a lie depends on the helper's job. A money formatter printing
// "NaN" is a lie; a text escaper printing the characters N-a-N is doing exactly
// what it was asked. Judging both by one rule was the first version of this and
// it buried the real finding under eight that were not.
const NUMBER_LIE = /NaN|Infinity|undefined|\[object Object\]/;
const TEXT_LIE = /undefined|\[object Object\]/;
function judge(helper, out) {
  if (/^—$/.test(out)) return false;
  return helper === 'esc' ? TEXT_LIE.test(out) : NUMBER_LIE.test(out);
}

function run(ctx) {
  const found = [];
  const src = {};
  for (const [label, file] of Object.entries(PAGES)) src[label] = fs.readFileSync(file, 'utf8');

  // ---- 4a. the formatters, fed what a broken record produces ---------------

  const HELPERS = ['money', 'esc'];
  const outputs = {}; // helper -> page -> input label -> rendered text

  for (const helper of HELPERS) {
    outputs[helper] = {};
    for (const [page, text] of Object.entries(src)) {
      const fn = liftArrow(text, helper);
      if (!fn) continue;
      outputs[helper][page] = {};
      for (const [label, v] of NASTY) {
        let out;
        try { out = String(fn(v)); } catch (err) { out = `THREW: ${err.message}`; }
        outputs[helper][page][label] = out;
        if (out.startsWith('THREW:')) {
          found.push(finding('ui/throws', `${page} — the "${helper}" formatter`,
            `given ${label}, the formatter stopped with an error. Whatever panel it was drawing goes blank, with nothing on screen to say why.`));
        } else if (judge(helper, out)) {
          found.push(finding('ui/screenlie', `${page} — the "${helper}" formatter`,
            `given ${label}, the owner would read "${out}" on screen. That is the code failing to work something out, printed where a figure belongs.`,
            { severe: helper === 'money' }));
        }
      }
    }
  }

  // ---- 4b. the two pages must not disagree ---------------------------------

  for (const helper of HELPERS) {
    const pages = Object.keys(outputs[helper] || {});
    if (pages.length < 2) continue;
    const [a, b] = pages;
    const differ = NASTY.map(([label]) => label)
      .filter((label) => outputs[helper][a][label] !== outputs[helper][b][label]);
    if (differ.length) {
      const examples = differ.slice(0, 3)
        .map((label) => `given ${label}, ${a} shows "${outputs[helper][a][label]}" and ${b} shows "${outputs[helper][b][label]}"`);
      found.push(finding('ui/disagree', `the "${helper}" formatter, on both pages`,
        `the two pages format the same value differently in ${differ.length} of ${NASTY.length} cases: ${examples.join('; ')}. Two screens describing the same system that disagree leave no way to tell which one is right.`,
        { severe: true }));
    }
  }

  // ---- 4c. owner text printed onto the screen without being made safe ------

  for (const [page, text] of Object.entries(src)) {
    if (!/\besc\s*[=(]/.test(text)) continue;
    const lines = text.split('\n');
    const raw = [];
    lines.forEach((line, i) => {
      if (!/innerHTML|insertAdjacentHTML/.test(line) && !/^\s*[`<]/.test(line)) return;
      // ${expr} that is not esc(...), not a number helper, not a plain literal
      for (const m of line.matchAll(/\$\{([^}]{1,120})\}/g)) {
        const e = m[1].trim();
        // Templates nest. A naive match stops at the first closing brace and
        // hands back half an expression, which then matches on a word that is
        // not really there. Anything that is not a whole, simple expression is
        // skipped rather than guessed at.
        if (/[`${]/.test(e)) continue;
        // Only the fields the OWNER typed: a name they gave a config, the
        // reason they wrote down. Earlier versions matched on any occurrence of
        // those words and reported column headings called "why", which is not
        // owner text at all.
        if (!/\.(name|why|note|reason|comment)\b/.test(e)) continue;
        if (/^(esc|escapeHtml)\s*\(/.test(e)) continue;
        raw.push({ line: i + 1, e });
      }
    });
    if (raw.length) {
      found.push(finding('ui/rawtext', page,
        `${raw.length} place(s) print stored text straight onto the screen without first making it safe — for example line ${raw[0].line}: \${${raw[0].e}}. A config named with a piece of markup would be rendered as markup rather than shown as the name the owner typed.`,
        { soft: true, places: raw.slice(0, 8) }));
    }
  }

  // ---- 4d. buttons with nothing behind them --------------------------------

  for (const [page, text] of Object.entries(src)) {
    const ids = [...text.matchAll(/<button[^>]*\bid=["']([\w-]+)["']/g)].map((m) => m[1]);
    // "Wired up" means the id is named somewhere other than in the tag that
    // draws it. The first version looked for one specific calling style and
    // reported two working buttons as dead — they are wired through a list of
    // selectors, which that pattern could not see.
    const dead = ids.filter((id) => {
      const hits = [...text.matchAll(new RegExp(`\\b${id}\\b`, 'g'))].length;
      return hits <= 1;
    });
    if (dead.length) {
      found.push(finding('ui/deadbutton', page,
        `${dead.length} button(s) are drawn on screen with nothing wired to them — pressing them does nothing at all and gives no sign of that: ${dead.join(', ')}.`));
    }
  }

  // ---- 4e. RULE TWO — where Paper Books and Live Trading can drift apart ---

  const trade = src['the Trade page'];
  const points = [];
  trade.split('\n').forEach((line, i) => {
    if (/branch\s*===\s*'paper'|\bisPaper\b|\bisP\b\s*[?=]/.test(line)) points.push({ line: i + 1, text: line.trim() });
  });
  ctx.note(`RULE TWO: ${points.length} place(s) on the Trade page ask which side is showing`);

  // An address or a control that exists on ONE side only is the drift the rule
  // is about.
  const oneSided = points.filter((p) => /post\(|fetch\(|api\//.test(p.text));
  for (const p of oneSided) {
    found.push(finding('ui/ruletwo', `the Trade page, line ${p.line}`,
      `this line decides which side is showing AND reaches the server in the same breath: ${p.text.slice(0, 140)}. That is the exact shape in which Paper Books and Live Trading come to do different things without anyone deciding they should.`,
      { soft: true }));
  }

  // The count is pinned so a NEW divergence point cannot be added unnoticed.
  // The number of divergence points as READ AND ACCEPTED. This is not a target
  // — it is a tripwire. A new one appearing is not necessarily wrong, but it is
  // necessarily something that has to be looked at.
  //
  // Moved from 25 to 27 on 2026-08-21, and the two new ones were read before
  // the number was changed. Both are in dashTotals, reading the raw stored
  // figure so an unreadable one can be counted: `isPaper ? st.paperRealizedPnl
  // : st.realizedPnl` and the same for unrealized. Each side reads its own
  // field, both feed one shared counter, and neither changes behaviour — a
  // deliberate difference of the kind RULE TWO allows when it is said out loud.
  // Bumping this number without reading what moved it would make the tripwire
  // worthless.
  //
  // Moved from 27 to 28 on 2026-08-23, and the one that moved it was read
  // first. It is in the fee tiles: `isP ? 'paper — no venue fee' : ...`. A
  // paper book pays no venue fee, so there is no figure to show and it says so
  // rather than printing a zero that would read as a measurement. The MODELLED
  // fee beside it is drawn identically on both sides — deliberately, because
  // that is the number the two books must be compared on, and a paper book
  // priced differently from the live one beside it is worthless as a control.
  // tests/test-profilefee.js pins exactly that split, so a second branch test
  // creeping into that block fails a test rather than only moving this count.
  const PINNED = 28;
  if (points.length > PINNED) {
    found.push(finding('ui/ruletwo-new', 'the Trade page',
      `there are now ${points.length} places that ask whether this is the paper side or the live side, up from the ${PINNED} that were reviewed and accepted. Every one of them is a way the two screens can come to disagree, so the new one(s) need looking at: lines ${points.map((p) => p.line).join(', ')}.`));
  }
  ctx.note(`RULE TWO divergence lines: ${points.map((p) => p.line).join(', ')}`);

  return found;
}

module.exports = { name: 'the screens — what the owner would actually read', run, liftArrow };
