// Attack 1 — the front door.
//
// Every address the system answers on, hit with the things a browser would
// never send: nothing at all, the wrong shape, the wrong type, a number where
// a name goes, a name three hundred thousand characters long, a path that
// tries to climb out of the folder, a body that is not really JSON.
//
// The list of addresses is READ OUT OF THE CODE each run, not typed here. A
// new address added tomorrow is attacked tomorrow without anyone remembering
// to add it — which is the whole point of a standing test rather than a
// one-off review.
const fs = require('fs');
const path = require('path');
const { request, looksFabricated, leaksInternals, finding } = require('./harness');

const ROOT = path.join(__dirname, '..', '..');

// Two addresses reach the public internet to fetch market data. Firing junk at
// them would either download real files into the sandbox or hang on the
// network, and neither tells us anything. They are left out ON PURPOSE and
// said out loud here so the coverage claim stays honest.
const NOT_ATTACKED = new Set(['/api/data/download', '/api/data/refresh']);

function discoverRoutes() {
  const files = ['server.js', path.join('lib', 'live', 'routes.js')];
  const routes = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const re = /app\.(get|post|delete|put)\(\s*(\[[^\]]*\]|'[^']*')/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const method = m[1].toUpperCase();
      const raw = m[2];
      const paths = raw.startsWith('[')
        ? [...raw.matchAll(/'([^']*)'/g)].map((x) => x[1])
        : [raw.slice(1, -1)];
      for (const p of paths) routes.push({ method, path: p, source: rel });
    }
  }
  return routes;
}

// Values put where an :id goes. Each one is a way of asking "do you check?".
const HOSTILE_IDS = [
  { label: 'climbing out of the folder', v: '../../../../etc/passwd' },
  { label: 'climbing out, url-encoded', v: '..%2f..%2f..%2f..%2fetc%2fpasswd' },
  { label: 'a script tag', v: '<script>alert(1)</script>' },
  { label: 'a null byte', v: 'a%00b' },
  { label: 'a dot', v: '.' },
  { label: 'four thousand characters', v: 'x'.repeat(4000) },
  { label: 'an absolute path', v: '%2fetc%2fpasswd' },
];

// Bodies. Sent to every POST regardless of what that address expects, because
// the question is never "does the right shape work" — it is "what happens to
// the wrong one".
function hostileBodies() {
  return [
    { label: 'no body at all', body: undefined },
    { label: 'an empty object', body: {} },
    { label: 'the word null', body: 'null', ct: 'application/json' },
    { label: 'a bare array', body: [] },
    { label: 'a bare string', body: '"hello"', ct: 'application/json' },
    { label: 'a bare number', body: '123', ct: 'application/json' },
    { label: 'broken JSON', body: '{"a":', ct: 'application/json' },
    { label: 'JSON sent as plain text', body: '{"a":1}', ct: 'text/plain' },
    { label: 'JSON sent as a form post', body: 'a=1&b=2', ct: 'application/x-www-form-urlencoded' },
    { label: 'every field the wrong type', body: { id: [1], name: 42, n: 'seven', count: {}, pct: 'half', enabled: 'yes', armed: 'true', stopPct: '0.02' } },
    { label: 'numbers at the edge of what exists', body: { n: 1e308, count: -1, pct: 1e-320, size: Number.MAX_SAFE_INTEGER + 2 } },
    { label: 'an attempt to poison every object in the program', body: { __proto__: { utsPolluted: true }, id: 'x' }, pollution: true },
    { label: 'an attempt to poison via constructor', body: JSON.parse('{"constructor":{"prototype":{"utsPolluted2":true}}}') },
    { label: 'a body bigger than the stated limit', body: JSON.stringify({ blob: 'x'.repeat(400000) }), ct: 'application/json', big: true },
    { label: 'nested four hundred deep', body: (() => { let o = {}; const top = o; for (let i = 0; i < 400; i++) { o.n = {}; o = o.n; } return top; })() },
  ];
}

function withId(p, v) { return p.replace(/:[A-Za-z]+/g, v); }

// The sweep, run once against a given server. `label` says which system it
// was — an empty one or a seeded one — so a finding names the state it needs.
async function sweep(server, label, found, ctx) {
  // Count what was actually sent and what came back. A sweep that finds
  // nothing and a sweep that never happened look identical in a report, so the
  // suite prints the tally every run and refuses to call it coverage without
  // one.
  const tally = { sent: 0, byStatus: {}, bodySize: {} };
  const routes = discoverRoutes();

  const judge = (res, where, sent) => {
    tally.sent += 1;
    tally.byStatus[res && res.status] = (tally.byStatus[res && res.status] || 0) + 1;
    if (!server.alive()) {
      found.push(finding('http/died', where, `on ${label}, sending ${sent} killed the service outright — the whole system goes down, not just this request`));
      return;
    }
    const fab = looksFabricated(res);
    if (fab) found.push(finding('http/fabricated', where, `on ${label}, sending ${sent} was ACCEPTED and answered: ${fab}`));
    const leak = leaksInternals(res);
    if (leak) found.push(finding('http/leak', where, `on ${label}, sending ${sent} made the answer show the machine's insides: ${leak}`));
    if (res.status >= 500) {
      found.push(finding('http/500', where, `on ${label}, sending ${sent} produced an unhandled failure (${res.status}) instead of a plain refusal — the screen will show a blank or a raw error`, { soft: true }));
    }
    if (/root:x:0:0|\/bin\/(ba)?sh\b/.test(res.text || '')) {
      found.push(finding('http/traversal', where, `on ${label}, sending ${sent} returned the contents of a file from outside the system's own folder`, { severe: true }));
    }
  };

  for (const r of routes) {
    if (NOT_ATTACKED.has(r.path)) continue;
    if (r.path === '/' || r.path.endsWith('.html')) continue; // pages, covered by the interface attack

    const hasParam = /:[A-Za-z]+/.test(r.path);
    const targets = hasParam ? HOSTILE_IDS.map((h) => ({ p: withId(r.path, h.v), label: h.label })) : [{ p: r.path, label: null }];

    for (const t of targets) {
      const where = `${r.method} ${r.path}`;
      if (r.method === 'GET' || r.method === 'DELETE') {
        let res;
        try {
          res = await request(server.port, r.method, t.p, undefined, { timeout: 15000 });
        } catch (err) {
          found.push(finding('http/noanswer', where, `asking with ${t.label || 'nothing unusual'} produced no answer at all (${err.message})`));
          continue;
        }
        judge(res, where, t.label ? `an address containing ${t.label}` : 'an ordinary request');
        // How much this address had to say. Used only to prove the seeded pass
        // is reaching code the empty pass could not.
        if (!hasParam) tally.bodySize[where] = (res.text || '').length;
      } else {
        for (const b of hostileBodies()) {
          let res;
          try {
            res = await request(server.port, r.method, t.p, b.body, { contentType: b.ct, timeout: 15000 });
          } catch (err) {
            found.push(finding('http/noanswer', where, `sending ${b.label} produced no answer at all (${err.message})`));
            continue;
          }
          const sent = t.label ? `${b.label} to an address containing ${t.label}` : b.label;
          judge(res, where, sent);
          if (b.big && res.status === 200) {
            found.push(finding('http/nolimit', where, `a body larger than the 256kb the code says it accepts was taken anyway — the stated limit is not enforced here`));
          }
        }
      }
    }
  }

  // Did any of that poison the running program? A poisoned program answers
  // normally and is wrong everywhere at once, which is the worst failure shape
  // there is.
  const after = await request(server.port, 'GET', '/api/healthz');
  if (after.json && (after.json.utsPolluted || after.json.utsPolluted2)) {
    found.push(finding('http/polluted', 'the whole service', 'a request managed to add a field to every object in the running program at once — every answer the system gives after that is suspect', { severe: true }));
  }
  if (!server.alive()) {
    found.push(finding('http/dead', 'the whole service', `the service is no longer running after the sweep; it exited with ${JSON.stringify(server.exited())}`, { severe: true }));
  }

  ctx.note(`${label}: ${tally.sent} hostile requests sent; answers: ${Object.entries(tally.byStatus).sort().map(([k, v]) => `${k}×${v}`).join(' ')}`);
  if (tally.sent < 100) {
    found.push(finding('http/instrument', 'this test itself', `only ${tally.sent} requests were sent across ${routes.length} addresses on ${label} — the sweep is not reaching what it claims to reach`, { instrument: true }));
  }
  if (!Object.keys(tally.byStatus).some((k) => Number(k) >= 400 && Number(k) < 500)) {
    found.push(finding('http/instrument', 'this test itself', 'not one hostile request was refused with a 4xx. Either every address accepts anything, or the requests are not arriving — and this test cannot tell which, so it is reporting itself as broken rather than as a pass.', { instrument: true }));
  }

  // Methods nobody should be able to use.
  for (const m of ['TRACE', 'CONNECT', 'PATCH']) {
    try {
      const res = await request(server.port, m, '/api/healthz', undefined, { timeout: 5000 });
      if (res.status === 200 && m === 'TRACE') {
        found.push(finding('http/trace', 'the whole service', 'the service answers TRACE, which echoes a request back and is a known way to read headers that were not meant to be readable'));
      }
    } catch (_) { /* refusing is right */ }
  }

  return tally;
}

async function run(ctx) {
  const found = [];
  const routes = discoverRoutes();
  ctx.note(`${routes.length} addresses read out of the code; ${NOT_ATTACKED.size} left out on purpose (they reach the internet): ${[...NOT_ATTACKED].join(', ')}`);

  // TWICE. An empty system answers "nothing here" to a third of everything
  // asked of it, and an address that never reaches its own working has not
  // really been attacked. The second pass runs against a system holding real
  // candles, a real setup and a real journal, all written through the system's
  // own code.
  const emptyTally = await sweep(ctx.servers.empty, 'an empty system', found, ctx);
  const seededTally = await sweep(ctx.servers.seeded, 'a system holding data', found, ctx);

  // Prove the seeding did something. If the same number of addresses still say
  // "nothing here", the second pass added no coverage and saying otherwise
  // would be a false claim.
  // The first version of this counted "nothing here" replies. That number is
  // dominated by the deliberately invalid addresses the sweep sends on purpose,
  // so it did not move and the check reported a failure that was really its own
  // mistake. What actually shows the seeded pass reaching further is how much
  // MORE each plain address has to say once the system holds something.
  const richer = Object.keys(seededTally.bodySize)
    .filter((k) => (seededTally.bodySize[k] || 0) > (emptyTally.bodySize[k] || 0));
  ctx.note(`${richer.length} of ${Object.keys(seededTally.bodySize).length} plain addresses answered with more once the system held data`);
  if (!richer.length) {
    found.push(finding('http/instrument', 'this test itself',
      'seeding the system with real candles, a real setup and a real journal made no address answer with any more than it did when the system was empty. The second pass is not reaching code the first did not, so the extra coverage it claims is not real.',
      { instrument: true }));
  }

  return found;
}

module.exports = { name: 'the front door — every address, hostile input', run, discoverRoutes, NOT_ATTACKED };
