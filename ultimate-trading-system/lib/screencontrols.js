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

// WHICH SCREENS EXIST, read from the code rather than listed here, so one added
// tomorrow is covered without anybody remembering.
function tabs() {
  const m = /const TABS = \[([\s\S]*?)\];/.exec(SRC);
  if (!m) throw new Error('TABS is gone - the screens cannot be read');
  return [...m[1].matchAll(/\['([^']+)',\s*'([^']+)'\]/g)]
    .map(([, key, label]) => ({ key, label, fn: `draw${key[0].toUpperCase()}${key.slice(1)}` }));
}

// One screen's renderer, brace-matched, so nothing from another leaks in.
function drawBody(fnName) {
  const start = SRC.indexOf(`async function ${fnName}()`);
  if (start < 0) throw new Error(`${fnName}() is gone - that screen cannot be read`);
  let i = SRC.indexOf('{', start);
  const from = i;
  let depth = 0;
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(from, i + 1);
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

function byTab() {
  const map = {};
  for (const t of tabs()) {
    let body = '';
    try { body = drawBody(t.fn); } catch (_) { body = ''; }
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
