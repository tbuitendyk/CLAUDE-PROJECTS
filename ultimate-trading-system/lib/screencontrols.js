// EVERY CONTROL ON EVERY CONSTRUCT SCREEN, taken out of the code that draws it.
//
// THIS LIVES IN lib/ BECAUSE THE HELP TAB DEPENDS ON IT. It started in tests/,
// and the Help tab asking the server for it meant production code reaching into
// the test folder — which broke the moment it ran anywhere the tests were not
// installed. Caught by the throwaway sandbox the adversarial suite builds,
// which copies lib/ and public/ and nothing else.
//
// The word list finds every PHRASE. This finds every CONTROL: each box, tick,
// dropdown and button the owner can actually touch, with the words next to it.
// That is what the Help tab has to explain, one entry each, with nothing left
// out — so the list has to come from the page rather than from anyone's memory
// of the page.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');

// WHICH SOURCE. On the box this file sits beside the very construct.js the
// service is serving, so reading its own copy is exactly right and is what the
// Help tab needs. In the repository it is not: between a commit and its deploy
// the working tree describes a screen nobody can see yet, and the word list —
// which is the ONLY vocabulary permitted about a screen — was generated from
// it. So the reading functions take an optional source, and the word list
// generator passes the source the box is actually serving (owner order,
// 2026-08-22). The default is unchanged, so nothing else moves.
function srcOf(src) { return typeof src === 'string' && src ? src : SRC; }

// WHICH SCREENS EXIST, read from the code rather than listed here, so one added
// tomorrow is covered without anybody remembering.
function tabs(src) {
  const S = srcOf(src);
  const m = /const TABS = \[([\s\S]*?)\];/.exec(S);
  if (!m) throw new Error('TABS is gone - the screens cannot be read');
  return [...m[1].matchAll(/\['([^']+)',\s*'([^']+)'\]/g)]
    .map(([, key, label]) => ({ key, label, fn: `draw${key[0].toUpperCase()}${key.slice(1)}` }));
}

// One screen's renderer, brace-matched, so nothing from another leaks in.
// The braced body of a named function, from its opening { to its matching }.
function bodyOf(S, start) {
  let i = S.indexOf('{', start);
  const from = i;
  let depth = 0;
  for (; i < S.length; i++) {
    if (S[i] === '{') depth++;
    else if (S[i] === '}') { depth--; if (depth === 0) break; }
  }
  return S.slice(from, i + 1);
}

// A SCREEN IS ITS RENDERER PLUS WHAT ITS RENDERER DRAWS WITH (2026-08-23).
//
// This read one function and stopped there. It was right while every screen
// built its own markup inline — and it went wrong the moment a control was
// shared. The paging bar is drawn on four tables by one helper, so its words
// (first, prev, next, last, rows per page) were on the owner's screen and on no
// list, which under RULE ONE-A means they could not be said to the owner at
// all. A list with holes is worse than no list, because the rule makes the list
// the authority.
//
// So a renderer's helpers are followed. Deliberately narrow, because
// over-collecting is the opposite failure — it would authorise words from a
// screen the owner is not looking at:
//   * only functions defined at the TOP LEVEL of the same file
//   * only where the body actually calls them by name
//   * only if the helper's own body contains markup, so pure arithmetic
//     helpers add nothing
//   * each one once, and only one level deep
function helperBodies(S, body) {
  const out = [];
  const defined = new Map();
  for (const m of S.matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm)) {
    defined.set(m[1], m.index);
  }
  for (const m of S.matchAll(/^const ([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>/gm)) {
    if (!defined.has(m[1])) defined.set(m[1], m.index);
  }
  const seen = new Set();
  for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (seen.has(name) || !defined.has(name)) continue;
    seen.add(name);
    const b = bodyOf(S, defined.get(name));
    // Markup, not arithmetic: a helper that draws nothing has no words on it.
    if (/<[a-z]/i.test(b)) out.push(b);
  }
  return out;
}

function drawBody(fnName, src) {
  const S = srcOf(src);
  const start = S.indexOf(`async function ${fnName}()`);
  if (start < 0) throw new Error(`${fnName}() is gone - that screen cannot be read`);
  const body = bodyOf(S, start);
  return [body, ...helperBodies(S, body)].join('\n');
}

// The words immediately before a control, which is what the owner reads as its
// name. Labels wrap their control, so this looks backwards from the tag.
function labelBefore(body, at) {
  const before = body.slice(Math.max(0, at - 400), at);
  const lastTagEnd = before.lastIndexOf('>');
  if (lastTagEnd < 0) return '';
  let text = before.slice(lastTagEnd + 1);
  // A label like `<label class="f">chunk shape<select ...>` puts its words
  // directly before the tag. A button puts them after, handled by the caller.
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function controlsIn(body) {
  const out = [];
  const re = /<(select|input|button|textarea)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const [tag, kind, attrs] = [m[0], m[1], m[2]];
    const id = (/\bid="([\w-]+)"/.exec(attrs) || [])[1];
    if (!id) continue;                                   // unnamed: not addressable
    const type = (/\btype="([\w-]+)"/.exec(attrs) || [])[1] || (kind === 'select' ? 'select' : 'text');
    let label = labelBefore(body, m.index);
    if (kind === 'button') {
      const close = body.indexOf('</button>', m.index);
      label = close > 0 ? body.slice(m.index + tag.length, close).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
    }
    // A tick's words come AFTER it: <input type="checkbox" id="x"> permute
    if (type === 'checkbox' || type === 'radio') {
      const after = body.slice(m.index + tag.length, m.index + tag.length + 120);
      const upto = after.indexOf('<');
      label = after.slice(0, upto < 0 ? 60 : upto).replace(/\s+/g, ' ').trim() || label;
    }
    const hover = (/\btitle="([^"]*)"/.exec(attrs) || [])[1] || '';
    const asks = (/vocabOptions\(\s*'([^']+)'/.exec(body.slice(m.index, m.index + 260)) || [])[1] || null;
    out.push({ id, kind, type, label, hover, choices: asks });
  }
  return out;
}

function byTab(src) {
  const map = {};
  for (const t of tabs(src)) {
    let body = '';
    try { body = drawBody(t.fn, src); } catch (_) { body = ''; }
    const seen = new Set();
    map[t.key] = { label: t.label, controls: controlsIn(body).filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id); return true;
    }) };
  }
  return map;
}

module.exports = { byTab, controlsIn, tabs, drawBody };

if (require.main === module) {
  const map = byTab();
  let n = 0;
  for (const [key, t] of Object.entries(map)) {
    console.log(`== ${t.label} (${t.controls.length})`);
    for (const c of t.controls) {
      n++;
      console.log(`   ${c.id.padEnd(18)} ${c.type.padEnd(9)} ${JSON.stringify(c.label).slice(0, 46).padEnd(48)}${c.hover ? 'has hover' : 'NO HOVER'}`);
    }
  }
  console.log(`\n${n} controls in total`);
}
