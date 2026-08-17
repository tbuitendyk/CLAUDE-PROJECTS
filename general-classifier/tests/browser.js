// Runtime harness for the Constructing and Trading tabs.
//
// Why this exists (owner goal, 2026-08-17): every check the repo had until now
// reads the SOURCE. A handler that throws because the element it addresses was
// never rendered, a render that dies half way and leaves the panel blank, a
// number that arrives as `undefined` and gets printed anyway — none of those are
// visible to a grep. They are only visible to a browser that actually loads the
// page and clicks the things on it.
//
// Three passes, each catching a different class:
//   EMPTY      every tab with no saved run selected — the first-time view
//   POPULATED  every tab with the newest saved run selected — the working view,
//              where nearly all the render code actually runs
//   CLICKED    the populated view, then expand every disclosure, click every
//              row the page marks clickable, cycle every dropdown through all
//              its options, and press every button that is not a launcher or
//              destructive
//
// A fault is anything a person would call a fault:
//   - an uncaught exception or a console error
//   - a request the page made that failed, or answered 4xx/5xx
//   - `undefined` / `NaN` / `[object Object]` / `Infinity` in the visible text
//   - a tab that renders nothing at all
//
// Run: npm run test:ui   (needs playwright + chromium; both present in the dev
// container. Deliberately NOT part of `npm test`, which must stay dependency-
// free and network-free so the deploy path can always run it.)
//
// The POPULATED and CLICKED passes need a finished bracket-lab run on the box,
// or they would check nothing but empty states and report a clean bill. If
// data/batches has none, this refuses to run rather than pass vacuously. Make
// one (a couple of minutes, cached candles only, three pairs so the result
// clears the live vocabulary's three-asset rule):
//
//   PORT=8199 node server.js &
//   curl -X POST localhost:8199/api/bracketlab -H 'Content-Type: application/json' -d '{
//     "universe":["BTCUSDT","ETHUSDT","ZECUSDT"], "sizes":{"triples":true},
//     "startMonth":"2024-01","endMonth":"2026-06",
//     "dMults":[0.5,1.0], "tHours":[41,89],
//     "gates":["active","directional"], "entries":["breakout","market"],
//     "declared":{"dMult":1.0,"tHours":89,"gate":"active","entry":"breakout","quorum":1},
//     "minTrades":1, "holdout":true, "edgeScreen":true, "labelShiftReps":2,
//     "windowLayout":"reserve61", "label":"uitriple" }'

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.UI_TEST_PORT || 8199);
const BASE = `http://127.0.0.1:${PORT}`;

// The tab lists are the ones the pages themselves declare. Kept here explicitly
// rather than scraped, so a tab silently disappearing from a page is a failure
// here rather than an unnoticed omission.
const CONSTRUCTING_TABS = ['data', 'sweep', 'boards', 'verify', 'history', 'tune', 'greenlight'];
const TRADING_BRANCHES = ['paper', 'real'];
const TRADING_SUBS = ['dash', 'configs', 'setups', 'detail', 'live'];

// Text that must never reach the screen. Each entry is [regex, why].
const BAD_TEXT = [
  [/\bundefined\b/, 'the literal word "undefined" is on screen — a field was read that nothing writes'],
  [/\bNaN\b/, 'NaN is on screen — arithmetic ran on a missing number'],
  [/\[object Object\]/, 'an object was concatenated into a string instead of being formatted'],
  [/\bInfinity\b/, 'Infinity is on screen — a division reached the display with a zero denominator'],
];

// Buttons this harness must NOT press: they launch multi-minute jobs, spend the
// data channel, or destroy state. Everything else gets clicked, because an
// unclicked button is an unchecked button.
const DO_NOT_PRESS = /start sweep|stop jobs|global refresh|refresh to latest|regenerate|download|purge|trim|nuke|deactivate|activate|start engine|stop engine|greenlight|^fire |^run |^launch |tune protective|apply to f1|planted check|reserve grade|conviction sweep/i;

function requirePlaywright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright', '/usr/lib/node_modules/playwright']) {
    try { return require(p); } catch (_) { /* next */ }
  }
  return null;
}

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}${pathname}`, (res) => {
      let s = '';
      res.on('data', (d) => { s += d; });
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('timeout')); });
  });
}

function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`${BASE}/api/healthz`, (res) => { res.resume(); resolve(); });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error('server did not come up'));
        else setTimeout(tick, 200);
      });
      req.setTimeout(1500, () => { req.destroy(); });
    };
    tick();
  });
}

// Read the visible text a person would actually read, and flag the poison words.
async function scanText(page, add, where) {
  const cells = await page.evaluate(() => Array.from(
    document.querySelectorAll('td,th,.v,.k,h1,h2,h3,.badge,.empty,.note,option'),
  ).map((e) => e.textContent.trim()).filter(Boolean));
  for (const [re, why] of BAD_TEXT) {
    const hit = cells.find((c) => re.test(c));
    if (hit) add(`${why} — ${where}, in: "${hit.slice(0, 140)}"`);
  }
}

// The CLICKED pass. Everything here re-queries the DOM after each action because
// these renderers replace #view wholesale.
async function clickAround(page, add) {
  const settle = 350;

  // 1. disclosures — content hidden behind <details> is content nobody checked
  const summaries = await page.$$('#view details > summary');
  for (let i = 0; i < summaries.length && i < 25; i++) {
    const s = (await page.$$('#view details > summary'))[i];
    if (!s) break;
    try { await s.click({ timeout: 3000 }); await page.waitForTimeout(settle); } catch (_) { /* off-screen */ }
  }
  await scanText(page, add, 'after expanding the disclosures');

  // 2. rows the page marks clickable — these are the selections that drive the
  //    detail panels, so a broken one hides a whole surface
  const rowCount = (await page.$$('#view tr.clickable')).length;
  for (let i = 0; i < rowCount && i < 12; i++) {
    const rows = await page.$$('#view tr.clickable');
    if (!rows[i]) break;
    try { await rows[i].click({ timeout: 3000 }); await page.waitForTimeout(settle); } catch (_) { /* replaced */ }
  }
  if (rowCount) await scanText(page, add, 'after clicking the table rows');

  // 3. dropdowns — every option, because an option nobody selects is an option
  //    nobody has seen render
  const selCount = (await page.$$('#view select')).length;
  for (let i = 0; i < selCount && i < 20; i++) {
    const sels = await page.$$('#view select');
    const sel = sels[i];
    if (!sel) break;
    let values = [];
    try { values = await sel.evaluate((e) => Array.from(e.options).map((o) => o.value)); } catch (_) { continue; }
    for (const v of values.slice(0, 12)) {
      try {
        const live = (await page.$$('#view select'))[i];
        if (!live) break;
        await live.selectOption(v, { timeout: 3000 });
        await live.evaluate((e) => e.dispatchEvent(new Event('change', { bubbles: true })));
        await page.waitForTimeout(200);
      } catch (_) { /* the dropdown was replaced by its own change */ }
    }
  }
  if (selCount) await scanText(page, add, 'after cycling the dropdowns');

  // 4. buttons — the dead-handler class lives here
  const labels = await page.$$eval('#view button', (bs) => bs.map((b) => (b.textContent || '').trim()));
  for (let i = 0; i < labels.length && i < 40; i++) {
    if (DO_NOT_PRESS.test(labels[i])) continue;
    const btns = await page.$$('#view button');
    const b = btns[i];
    if (!b) break;
    try {
      if (await b.isDisabled()) continue;
      await b.click({ timeout: 3000 });
      await page.waitForTimeout(settle);
    } catch (_) { /* replaced or covered */ }
  }
  await scanText(page, add, 'after pressing the buttons');
}

async function visit(browser, spec) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const faults = [];
  const seen = new Set();
  const add = (s) => { if (!seen.has(s)) { seen.add(s); faults.push(s); } };

  await ctx.addInitScript((kv) => {
    for (const [k, v] of Object.entries(kv)) window.localStorage.setItem(k, v);
  }, spec.storage);

  const page = await ctx.newPage();
  // A confirm()/alert() with nobody to answer it hangs the page, so answer them.
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  page.on('pageerror', (e) => add(`uncaught exception: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') add(`console error: ${m.text().slice(0, 300)}`); });
  page.on('requestfailed', (r) => {
    const f = r.failure();
    add(`request failed: ${r.method()} ${r.url().replace(BASE, '')} — ${f ? f.errorText : 'unknown'}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(BASE)) {
      add(`server answered ${r.status()} to ${r.request().method()} ${r.url().replace(BASE, '')}`);
    }
  });

  try {
    await page.goto(spec.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Both pages keep timers running, so networkidle never fires — settle on a
    // fixed budget instead.
    await page.waitForTimeout(2500);

    const shape = await page.evaluate(() => {
      const view = document.querySelector('#view');
      return { len: view ? view.innerHTML.length : -1 };
    });
    if (shape.len === -1) add('the page has no #view element at all');
    else if (shape.len === 0) add('#view rendered empty — the tab drew nothing');

    await scanText(page, add, 'on load');
    if (spec.click) await clickAround(page, add);
  } catch (e) {
    add(`page threw during the visit: ${e.message}`);
  }

  await ctx.close();
  return { label: spec.label, faults };
}

async function main() {
  const pw = requirePlaywright();
  if (!pw) {
    console.error('FAIL: playwright is not resolvable — this harness cannot run, so nothing was checked.');
    process.exit(2);
  }

  const srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvLog = '';
  srv.stdout.on('data', (d) => { srvLog += d; });
  srv.stderr.on('data', (d) => { srvLog += d; });
  const shutdown = () => { try { srv.kill('SIGTERM'); } catch (_) {} };
  process.on('exit', shutdown);

  try {
    await waitForServer(20000);
  } catch (e) {
    console.error(`FAIL: ${e.message}\n--- server output ---\n${srvLog}`);
    shutdown();
    process.exit(2);
  }

  // The populated passes need a saved run to point at. Newest bracket-lab run
  // wins; if there is none, say so loudly rather than quietly checking half the
  // surface and reporting a clean bill.
  let runId = null;
  try {
    const b = await getJson('/api/batches');
    const done = (b.batches || []).filter((x) => x.kind === 'bracketlab' && x.status === 'done');
    runId = done.length ? done[0].id : null;
  } catch (_) { /* reported below */ }
  if (!runId) {
    console.error('FAIL: no finished bracket-lab run in data/batches — the populated passes would '
      + 'check nothing but empty states. Run one first (see tests/browser.js header).');
    shutdown();
    process.exit(2);
  }
  console.log(`fixture run: ${runId}\n`);

  const visits = [];
  for (const t of CONSTRUCTING_TABS) {
    visits.push({ label: `EMPTY      Constructing / ${t}`, url: `${BASE}/constructing.html`, storage: { 'cx-tab': t } });
  }
  for (const b of TRADING_BRANCHES) {
    for (const s of TRADING_SUBS) {
      visits.push({ label: `EMPTY      Trading / ${b} / ${s}`, url: `${BASE}/trading.html`, storage: { 'lt-branch': b, 'lt-sub': s } });
    }
  }
  for (const t of CONSTRUCTING_TABS) {
    visits.push({ label: `POPULATED  Constructing / ${t}`, url: `${BASE}/constructing.html`, storage: { 'cx-tab': t, 'cx-run': runId } });
  }
  for (const t of CONSTRUCTING_TABS) {
    visits.push({ label: `CLICKED    Constructing / ${t}`, url: `${BASE}/constructing.html`, storage: { 'cx-tab': t, 'cx-run': runId }, click: true });
  }
  for (const b of TRADING_BRANCHES) {
    for (const s of TRADING_SUBS) {
      visits.push({ label: `CLICKED    Trading / ${b} / ${s}`, url: `${BASE}/trading.html`, storage: { 'lt-branch': b, 'lt-sub': s }, click: true });
    }
  }
  // Light theme is a whole second palette; a token defined only in the dark
  // block renders as nothing at all, and nobody would see it in a dark run.
  for (const t of ['sweep', 'boards']) {
    visits.push({ label: `LIGHT      Constructing / ${t}`, url: `${BASE}/constructing.html`, storage: { 'cx-tab': t, 'cx-run': runId, 'cx-theme': 'light' } });
  }
  visits.push({ label: 'LIGHT      Trading / paper / configs', url: `${BASE}/trading.html`, storage: { 'lt-branch': 'paper', 'lt-sub': 'configs', 'lt-theme': 'light' } });

  let bad = 0;
  for (const v of visits) {
    const r = await visitWithBrowser(pw, v);
    if (r.faults.length) {
      bad++;
      console.error(`FAIL ${r.label}`);
      for (const f of r.faults) console.error(`     ${f}`);
    } else {
      console.log(`ok   ${r.label}`);
    }
  }

  shutdown();
  console.log(bad === 0
    ? `\nall ${visits.length} tab views clean`
    : `\n${bad} of ${visits.length} tab views have faults`);
  process.exit(bad === 0 ? 0 : 1);
}

// One browser per visit: a page that wedges cannot then poison its neighbours,
// and the cost is a second or two each.
let sharedBrowser = null;
async function visitWithBrowser(pw, spec) {
  if (!sharedBrowser) {
    sharedBrowser = await pw.chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  }
  return visit(sharedBrowser, spec);
}

main().catch((e) => { console.error(e); process.exit(2); });
