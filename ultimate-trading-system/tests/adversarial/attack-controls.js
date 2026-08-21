// Attack 7 — the controls, and what they let the owner choose.
//
// Two questions, both about whether the screens tell the truth about what the
// system can do.
//
// FIRST: does every address a page calls actually exist? A button wired to an
// address the server does not answer looks completely normal until it is
// pressed. It then does nothing, or shows a failure with no explanation, and
// the owner has no way to tell that from the operation having failed for a
// real reason.
//
// SECOND (RULE FIVE): does any control offer the owner a list of choices that
// was written into the page rather than come from the system? A hardcoded list
// takes a decision away invisibly — the owner can only pick what somebody
// typed into the code, and there is nothing on screen to say so.
const fs = require('fs');
const path = require('path');
const { finding } = require('./harness');

const ROOT = path.join(__dirname, '..', '..');
const PAGES = {
  'the Trade page': path.join(ROOT, 'public', 'trade.html'),
  'the Construct page': path.join(ROOT, 'public', 'construct.js'),
  'the Setup page': path.join(ROOT, 'public', 'setup.html'),
  'the Construct page frame': path.join(ROOT, 'public', 'construct.html'),
};

// The server's addresses, read out of the code the same way the front-door
// attack reads them.
function serverRoutes() {
  const { discoverRoutes } = require('./attack-http');
  return discoverRoutes().map((r) => ({ ...r, re: new RegExp(`^${r.path.replace(/:[A-Za-z]+/g, '[^/]+').replace(/\//g, '\\/')}$`) }));
}

// Every address a page asks for, INCLUDING the ones it builds by joining
// pieces together — those are exactly the ones the existing endpoint check
// skips, so they are the ones most likely to have gone stale.
function pageCalls(src) {
  const calls = [];
  // Match on the ADDRESS, not on the name of the function asking for it. The
  // first version listed the helper names it knew about — and missed `api(...)`,
  // which is how most of these pages ask for things. Fifteen addresses came
  // back where there are more than thirty; the test said so about itself, which
  // is the only reason it was caught.
  for (const m of src.matchAll(/([`'"])((?:\/)?api\/[^`'"\s]*)\1/g)) {
    const raw = m[2];
    // Turn ${...} into a stand-in so it can be matched against :id addresses.
    const normalised = `/${raw.replace(/^\//, '').replace(/\$\{[^}]*\}/g, 'X')}`.replace(/\?.*$/, '');
    // An address ending in a slash is one the page finishes by sticking
    // something on the end with `+`. What follows cannot be read from here, so
    // it is checked as a beginning rather than reported as a dead address —
    // reporting it as dead was a false alarm the first time this ran.
    calls.push({ raw, normalised, joined: raw.includes('${') || raw.endsWith('/'), prefix: raw.endsWith('/') });
  }
  return calls;
}

function run(ctx) {
  const found = [];
  const routes = serverRoutes();
  let totalCalls = 0; let joinedCalls = 0;

  for (const [page, file] of Object.entries(PAGES)) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const calls = pageCalls(src);
    totalCalls += calls.length;
    joinedCalls += calls.filter((c) => c.joined).length;
    const dead = [];
    for (const c of calls) {
      const hit = c.prefix
        ? routes.some((r) => r.path.startsWith(c.normalised))
        : routes.some((r) => r.re.test(c.normalised));
      if (!hit) dead.push(c);
    }
    if (dead.length) {
      found.push(finding('controls/deadaddress', page,
        `${dead.length} control(s) on this page call an address the server does not answer: ${[...new Set(dead.map((d) => d.raw))].slice(0, 6).join(', ')}. Pressing one of these looks exactly like the operation failing for a real reason.`,
        { severe: true }));
    }
  }
  ctx.note(`${totalCalls} addresses called from the pages, ${joinedCalls} of them built by joining pieces together (the ones the ordinary endpoint check skips)`);
  if (totalCalls < 20) {
    found.push(finding('controls/instrument', 'this test itself',
      `only ${totalCalls} addresses were found across all four pages, which is far fewer than these screens really call — the pattern is not matching how the pages ask for things`,
      { instrument: true }));
  }

  // ---- RULE FIVE: choices written into the page ----------------------------

  // The lists the SYSTEM already knows. When a dropdown's values match one of
  // these, the page is keeping a second copy of something the server already
  // publishes — and the two can drift, so a choice added to the system never
  // appears on screen.
  const known = {};
  try {
    known['the geometries the system implements'] = new Set(Object.keys(require(path.join(ROOT, 'lib', 'dataset.js')).GEOMETRIES));
  } catch (_) { /* leave it out rather than guess */ }
  try {
    const schema = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'configschema.js'), 'utf8');
    for (const [label, name] of [['decision rules', 'DECISIONS'], ['entry styles', 'ENTRIES'], ['gates', 'GATES'], ['stages', 'STAGES']]) {
      const m = new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]`).exec(schema);
      if (m) known[`the ${label} the system accepts`] = new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    }
  } catch (_) { /* leave it out rather than guess */ }

  for (const [page, file] of Object.entries(PAGES)) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');

    // A dropdown whose options are literal text rather than drawn from what the
    // system holds.
    const hardcoded = [];
    for (const m of src.matchAll(/<select\b[\s\S]{0,900}?<\/select>/g)) {
      const block = m[0];
      const literalOptions = [...block.matchAll(/<option[^>]*>([^<$][^<]*)</g)].map((o) => o[1].trim()).filter(Boolean);
      if (literalOptions.length >= 2 && !/\$\{/.test(block)) {
        const id = (/\bid=["']([\w-]+)["']/.exec(block) || [])[1] || 'an unnamed dropdown';
        const values = [...block.matchAll(/<option[^>]*\bvalue=["']([^"']*)["']/g)].map((o) => o[1]);
        let duplicates = null; let missing = [];
        for (const [label, set] of Object.entries(known)) {
          if (values.length && values.every((v) => set.has(v))) {
            duplicates = label;
            missing = [...set].filter((v) => !values.includes(v));
            break;
          }
        }
        hardcoded.push({ id, options: literalOptions.slice(0, 6), duplicates, missing });
      }
    }
    for (const h of hardcoded) {
      const extra = h.duplicates
        ? ` The system already holds this list — it is ${h.duplicates} — so the page is keeping a second copy that can drift from it${h.missing.length ? `, and it has already drifted: ${h.missing.join(', ')} ${h.missing.length === 1 ? 'is' : 'are'} accepted by the system but not offered here` : ''}.`
        : '';
      found.push(finding('controls/rulefive', page,
        `the dropdown "${h.id}" offers a list written into the page — ${h.options.join(', ')}. The owner can only pick what somebody typed into the code, and nothing on screen says so (RULE FIVE).${extra}`,
        { soft: !h.duplicates, severe: Boolean(h.duplicates && h.missing.length) }));
    }
  }

  return found;
}

module.exports = { name: 'the controls — dead addresses, and choices written into the page', run };
