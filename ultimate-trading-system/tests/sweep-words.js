#!/usr/bin/env node
// EVERY WORD ON THE SWEEP TAB, TAKEN OUT OF THE CODE THAT DRAWS IT.
//
// Owner order, 2026-08-21: the words on the screen are the ONLY words that may
// be used to talk about that screen. This produces that list mechanically, so
// it is what the page really says rather than what anybody remembers it saying
// - which is the whole failure it exists to stop.
//
//   node tests/sweep-words.js            print the list
//   node tests/sweep-words.js --write    regenerate SWEEP-WORDS.md
//
// It reads drawSweep() in public/construct.js - the function that renders the
// Sweep tab - plus the choice lists the page draws its dropdowns from, and
// pulls out the text a person can actually read: control labels, button text,
// headings, dropdown options, tick labels, and the sentences on the page.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
// One reader for which screens exist and what each one draws (lib/screencontrols.js).
const { tabs, drawBody } = require('../lib/screencontrols');

// EVERY TAB, not just one (owner order, 2026-08-21). Each has its own renderer
// and its own words, and a list for one screen leaves every other screen a place
// where a name can still be invented.
//
// Read out of TABS in public/construct.js rather than typed, so a tab added
// tomorrow gets a list without anybody remembering.

const drawSweepBody = () => drawBody('drawSweep');

// FINDING THE END OF THINGS, PROPERLY (owner, 2026-08-22).
//
// Both walkers below used to count braces and nothing else. A brace inside a
// quoted string — `'{'`, or a class name, or a sentence with one in it — put
// the count out, and everything from there to the next stray closing brace
// disappeared. What disappeared was PAGE TEXT: 87 of the 221 labels plainly
// visible between tags were absent from the lists this file generates, the
// Boards "order by" choices among them. A closed word list with holes in it is
// worse than no list, because the rule that leans on it says the list is the
// authority.
//
// So quotes are now skipped whole, and a template literal nested inside an
// interpolation is followed through its own interpolations. Anything still
// lost is caught by theWordListSeesEveryVisibleLabel in test-sweepwords.js.

// COMMENTS ARE CODE TOO, and they are full of apostrophes. Skipping quotes but
// not comments made it worse, not better: a `//` line saying "the board's own
// ranking" opened a string at that apostrophe which then ran on past the next
// backtick, and the whole Boards template vanished from the list. Returns the
// position after the comment, or the same position when there is none.
function skipComment(src, i) {
  if (src[i] === '/' && src[i + 1] === '/') {
    let j = i + 2;
    while (j < src.length && src[j] !== '\n') j++;
    return j;
  }
  if (src[i] === '/' && src[i + 1] === '*') {
    const end = src.indexOf('*/', i + 2);
    return end < 0 ? src.length : end + 2;
  }
  return i;
}

// From just past an opening quote to just past its closing one.
function endOfQuote(src, i, q) {
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === q) return i + 1;
    i++;
  }
  return i;
}

// From just inside a `${` to just past its matching `}`.
function endOfInterpolation(src, i) {
  let depth = 1;
  while (i < src.length && depth) {
    const ch = src[i];
    if (ch === '\\') { i += 2; continue; }
    { const j = skipComment(src, i); if (j !== i) { i = j; continue; } }
    if (ch === "'" || ch === '"') { i = endOfQuote(src, i + 1, ch); continue; }
    if (ch === '`') { i = endOfTemplate(src, i + 1); continue; }
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') { depth--; i++; continue; }
    i++;
  }
  return i;
}

// From just past an opening backtick to just past its closing one. A nested
// template can hold its own interpolations, which can hold another template.
function endOfTemplate(src, i) {
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === '$' && src[i + 1] === '{') { i = endOfInterpolation(src, i + 2); continue; }
    if (src[i] === '`') return i + 1;
    i++;
  }
  return i;
}

// ONLY THE HTML TEMPLATES, not the whole function. drawSweep() also holds the
// button handlers, and treating those as text put `const el = $('#swDecCount');`
// on the list of things a control is called. Backtick strings that contain a
// tag are the page; everything else in there is machinery.
//
// Quoted strings in the machinery are skipped, so a backtick inside one cannot
// be mistaken for the start of a template.
function htmlTemplates(body) {
  const out = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '\\') { i += 2; continue; }
    { const j = skipComment(body, i); if (j !== i) { i = j; continue; } }
    if (ch === "'" || ch === '"') { i = endOfQuote(body, i + 1, ch); continue; }
    if (ch === '`') {
      const end = endOfTemplate(body, i + 1) - 1;   // index of the closing backtick
      const lit = body.slice(i + 1, end);
      if (/<\/?[a-z][a-z0-9]*[\s>]/i.test(lit)) out.push(lit);
      i = end + 1;
      continue;
    }
    i++;
  }
  return out;
}

// Interpolations NEST, and a regex cannot follow that. A regex left fragments
// like `found.blocking.map` and `lines.length` in the word list — code offered
// as vocabulary the owner could supposedly see, in the very file that exists to
// stop exactly that.
// AN INTERPOLATION IS NOT ALL MACHINERY (owner, 2026-08-22). This used to throw
// away everything inside `${...}` on the grounds that it is code. Most of it is.
// But every conditional section of every screen in this codebase is written as
//
//     ${doc ? `<div class="panel">…the page…</div>` : ''}
//
// so the page itself lives inside those braces, and dropping them dropped the
// page. On the Boards tab the WHOLE body is one such interpolation: 87 of the
// 221 plainly visible labels across the seven screens were missing from these
// lists, and the rule that says the list is the only allowed vocabulary was
// leaning on them.
//
// So the code goes and the page stays: a template literal or a quoted string
// holding a tag is page text, at any depth, and is kept.
function stripInterpolations(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src[i] === '$' && src[i + 1] === '{') {
      const end = endOfInterpolation(src, i + 2);
      out += `  ${pageTextInside(src.slice(i + 2, Math.max(i + 2, end - 1)))}\n`;
      i = end;
    } else { out += src[i]; i++; }
  }
  return out;
}

// The page hiding in one interpolation's code. Strings and templates that carry
// a tag are kept and walked again — a nested template can hold interpolations of
// its own, which can hold more page.
function pageTextInside(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '\\') { i += 2; continue; }
    { const j = skipComment(code, i); if (j !== i) { i = j; continue; } }
    if (ch === "'" || ch === '"') {
      const e = endOfQuote(code, i + 1, ch);
      const lit = code.slice(i + 1, Math.max(i + 1, e - 1));
      if (/<\/?[a-z][a-z0-9]*[\s>]/i.test(lit)) out += `\n${lit}`;
      i = e;
      continue;
    }
    if (ch === '`') {
      const e = endOfTemplate(code, i + 1);
      const lit = code.slice(i + 1, Math.max(i + 1, e - 1));
      if (/<\/?[a-z][a-z0-9]*[\s>]/i.test(lit)) out += `\n${stripInterpolations(lit)}`;
      i = e;
      continue;
    }
    i++;
  }
  return out;
}

// Strip the things a person never reads: comments, tooltips, ids, classes,
// styles, and the code inside interpolations.
function readableText(src) {
  let s = src;
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = stripInterpolations(s);
  s = s.replace(/\b(title|style|class|id|placeholder|value|type|min|max|colspan|data-[\w-]+)="[^"]*"/g, ' ');
  s = s.replace(/<[^>]*>/g, '\n');
  return s;
}

function phrases(text) {
  const out = [];
  for (let line of text.split('\n')) {
    line = line.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
    line = line.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (!/[A-Za-z]/.test(line)) continue;
    if (/^[^A-Za-z]*$/.test(line)) continue;
    out.push(line);
  }
  return out;
}

// The dropdown choices come from the system, not from the page, so they are
// collected from there - otherwise the list would be missing every option the
// owner can actually pick.
function optionWords(body) {
  const names = [...new Set([...body.matchAll(/vocabOptions\(\s*'([^']+)'/g)].map((m) => m[1]))];
  const v = require(path.join(ROOT, 'lib', 'vocabulary')).vocabulary();
  const out = [];
  for (const n of names) for (const o of (v[n] || [])) out.push(o.label);
  return out;
}

function collect(fnName = 'drawSweep') {
  const body = drawBody(fnName);
  const said = phrases(htmlTemplates(body).map(readableText).join('\n'));
  const opts = optionWords(body);

  // Split into what a control is CALLED and what the page SAYS. The first is
  // the vocabulary that matters most: those are the things the owner clicks.
  const controls = [];
  const prose = [];
  for (const p of said) {
    if (p.length <= 34 && !/[.!]/.test(p)) controls.push(p); else prose.push(p);
  }

  const words = new Set();
  for (const p of [...said, ...opts]) {
    for (const w of p.split(/[^A-Za-z0-9%/.\-]+/)) {
      if (w && /[A-Za-z]/.test(w) && w.length > 1) words.add(w);
    }
  }
  return {
    controls: [...new Set(controls)].sort((a, b) => a.localeCompare(b)),
    options: [...new Set(opts)].sort((a, b) => a.localeCompare(b)),
    prose: [...new Set(prose)],
    words: [...words].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
  };
}

module.exports = { collect, drawSweepBody, drawBody, tabs, htmlTemplates, readableText, stripInterpolations };

if (require.main === module) {
  const all = tabs().map((t) => {
    let got = null;
    try { got = collect(t.fn); } catch (err) { got = { error: err.message }; }
    return { ...t, got };
  });

  if (!process.argv.includes('--write')) {
    console.log(JSON.stringify(all, null, 1));
  } else {
    const out = ['# The words on every screen of the Construct page',
      '',
      'GENERATED - do not edit by hand. Rebuild with:',
      '',
      '```',
      'node tests/sweep-words.js --write',
      '```',
      '',
      'Owner order, 2026-08-21: **these are the only words that may be used to',
      'talk about anything on these screens.** Not a style preference - a',
      'fabricated label sends the owner hunting for a control that was never',
      'there, and it makes every other statement suspect.',
      '',
      'Taken out of the function that draws each tab in `public/construct.js`,',
      'and out of the choice lists the page fills its dropdowns from. Tooltips',
      'are deliberately excluded: hover text is not a name, and using it as one',
      'is the same fault wearing a disguise.',
      '',
      '## The tabs',
      '',
      ...tabs().map((t) => `- **${t.label}**`),
      '',
      'Read from `TABS` in `public/construct.js`.',
      ''];

    for (const t of all) {
      out.push(`---`, '', `# ${t.label}`, '');
      if (t.got.error) { out.push(`_could not be read: ${t.got.error}_`, ''); continue; }
      const g = t.got;
      out.push(`## What the controls are called (${g.controls.length})`, '');
      out.push(...(g.controls.length ? g.controls.map((c) => '- `' + c + '`') : ['_none_']));
      out.push('', `## What the dropdowns offer (${g.options.length})`, '');
      out.push(...(g.options.length ? g.options.map((o) => '- `' + o + '`') : ['_none_']));
      out.push('', `## Sentences the page prints (${g.prose.length})`, '');
      out.push(...(g.prose.length ? g.prose.map((x) => '- ' + x) : ['_none_']));
      out.push('', `## Every word, flat (${g.words.length})`, '', '```', g.words.join(' '), '```', '');
    }
    fs.writeFileSync(path.join(ROOT, 'SCREEN-WORDS.md'), out.join('\n') + '\n');
    try { fs.unlinkSync(path.join(ROOT, 'SWEEP-WORDS.md')); } catch (_) { /* already gone */ }
    const tot = all.filter((t) => !t.got.error);
    console.log(`SCREEN-WORDS.md written: ${tot.length} tab(s), `
      + `${tot.reduce((n, t) => n + t.got.controls.length, 0)} control labels, `
      + `${tot.reduce((n, t) => n + t.got.options.length, 0)} options`);
    for (const t of all) if (t.got.error) console.log(`  ! ${t.label}: ${t.got.error}`);
  }
}
