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

// The renderer, brace-matched, so nothing from another tab leaks in.
function drawSweepBody() {
  const start = SRC.indexOf('async function drawSweep()');
  if (start < 0) throw new Error('drawSweep() is gone - this list cannot be built');
  let i = SRC.indexOf('{', start);
  const from = i;
  let depth = 0;
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(from, i + 1);
}

// ONLY THE HTML TEMPLATES, not the whole function. drawSweep() also holds the
// button handlers, and treating those as text put `const el = $('#swDecCount');`
// on the list of things a control is called. Backtick strings that contain a
// tag are the page; everything else in there is machinery.
function htmlTemplates(body) {
  const out = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] === '`') {
      let j = i + 1;
      let depth = 0;
      for (; j < body.length; j++) {
        if (body[j] === '\\') { j++; continue; }
        if (body[j] === '$' && body[j + 1] === '{') { depth++; j++; continue; }
        if (body[j] === '}' && depth) { depth--; continue; }
        if (body[j] === '`' && !depth) break;
      }
      const lit = body.slice(i + 1, j);
      if (/<\/?[a-z][a-z0-9]*[\s>]/i.test(lit)) out.push(lit);
      i = j + 1;
    } else i++;
  }
  return out;
}

// Strip the things a person never reads: comments, tooltips, ids, classes,
// styles, and the code inside interpolations.
function readableText(src) {
  let s = src;
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/\$\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '  ');
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

function collect() {
  const body = drawSweepBody();
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

module.exports = { collect, drawSweepBody };

if (require.main === module) {
  const got = collect();
  if (!process.argv.includes('--write')) {
    console.log(JSON.stringify(got, null, 1));
  } else {
    const md = [
      '# The words on the Sweep tab',
      '',
      'GENERATED - do not edit by hand. Rebuild with:',
      '',
      '```',
      'node tests/sweep-words.js --write',
      '```',
      '',
      'Owner order, 2026-08-21: **these are the only words that may be used to',
      'talk about anything on this screen.** Not a style preference - a fabricated',
      'label sends the owner hunting for a control that was never there, and it',
      'makes every other statement suspect.',
      '',
      'Taken out of `drawSweep()` in `public/construct.js` - the function that',
      'draws the tab - and out of the choice lists the page fills its dropdowns',
      'from. Tooltips are deliberately excluded: hover text is not a name.',
      '',
      '## The tab',
      '',
      'It is called **Sweep**. Read from `TABS` in `public/construct.js`.',
      '',
      '## What the controls are called (' + got.controls.length + ')',
      '',
      'Anything the owner reads beside a box, a tick or a button.',
      '',
      ...got.controls.map((c) => '- `' + c + '`'),
      '',
      '## What the dropdowns offer (' + got.options.length + ')',
      '',
      ...got.options.map((o) => '- `' + o + '`'),
      '',
      '## Sentences the page prints (' + got.prose.length + ')',
      '',
      ...got.prose.map((p) => '- ' + p),
      '',
      '## Every word, flat (' + got.words.length + ')',
      '',
      'For checking one word quickly.',
      '',
      '```',
      got.words.join(' '),
      '```',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(ROOT, 'SWEEP-WORDS.md'), md + '\n');
    console.log('SWEEP-WORDS.md written: ' + got.controls.length + ' control labels, '
      + got.options.length + ' options, ' + got.prose.length + ' sentences, ' + got.words.length + ' words');
  }
}
