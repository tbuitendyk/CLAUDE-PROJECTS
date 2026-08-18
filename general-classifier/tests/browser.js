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
// data/batches has none, this refuses to run rather than pass vacuously.
//
// THE RUN MUST BE LIVE-EXECUTABLE, not merely finished (corrected 2026-08-18).
// The Trading VALUES and CONTROLS passes mint a throwaway config from it, and
// activation refuses anything the live executor cannot actually trade. The
// recipe here used to declare gate:active + entry:breakout on BTC/ETH/ZEC —
// every one of which is lab-only or unserved:
//   * the executor does MARKET entry only; breakout is lab-only
//   * the executor does the DIRECTIONAL gate only; active is lab-only
//   * dMult belongs to breakout rails; market entry refuses it outright
//   * execution target mx-1 serves LTCUSDT, so a BTC/ETH/ZEC trade pair is
//     refused on the symbol as well
// So following these instructions produced a run that could not mint, both
// passes SKIPPED, and — before skips became failures — the harness still
// printed a clean bill. The recipe below is live-executable end to end:
//
//   PORT=8199 node server.js &
//   curl -X POST localhost:8199/api/bracketlab -H 'Content-Type: application/json' -d '{
//     "universe":["LTCUSDT","BTCUSDT","ETHUSDT"], "sizes":{"triples":true},
//     "startMonth":"2024-01","endMonth":"2026-06",
//     "dMults":[1.0], "tHours":[41,89],
//     "gates":["directional"], "entries":["market"],
//     "declared":{"tHours":89,"gate":"directional","entry":"market","quorum":1},
//     "minTrades":1, "holdout":true, "edgeScreen":true, "labelShiftReps":2,
//     "windowLayout":"reserve61", "label":"uilive" }'
//
// (LTCUSDT leads the universe so the trade pair is one mx-1 serves; declared
// carries no dMult because market entry has no rails to scale.)

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.UI_TEST_PORT || 8199);
const BASE = `http://127.0.0.1:${PORT}`;

// The tab lists are the ones the pages themselves declare. Kept here explicitly
// rather than scraped, so a tab silently disappearing from a page is a failure
// here rather than an unnoticed omission.
const CONSTRUCTING_TABS = ['data', 'sweep', 'boards', 'verify', 'history', 'tune', 'greenlight', 'rules'];
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

function postJson(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let s = '';
      res.on('data', (d) => { s += d; });
      res.on('end', () => { try { resolve({ code: res.statusCode, body: JSON.parse(s) }); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(data); req.end();
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
  await everyPanelSaysSomething(page, add, where);
}

// EVERY PANEL EITHER SHOWS ROWS OR SAYS IT HAS NONE (added 2026-08-18).
//
// Value-fidelity is checked against the record on the boards tab and on the
// Trading money screens. The other Constructing tabs render from the run
// document and had no such check, and writing four bespoke record-matchers is
// how a test suite becomes more expensive than the thing it tests. This is the
// contract they all share instead, and it is the one that matters generically:
// a panel that renders NEITHER rows NOR an explicit empty state is a panel that
// silently dropped its content. The operator cannot tell that from "you have
// nothing", which is precisely the confusion the outage banner exists to stop —
// this closes the same hole one level down, at the individual panel.
//
// Integers only, no formatting, so there is nothing here to give a false alarm.
//
// Watched failing 2026-08-18: deleting the "none open" fallback row from the
// Trading Open-positions table made 2 of 65 views fail, naming the table by its
// own column headings (chunk/side/qty/entry) — the fault reported where it is,
// not merely that something was wrong somewhere.
async function everyPanelSaysSomething(page, add, where) {
  const blanks = await page.evaluate(() => {
    const out = [];
    for (const t of document.querySelectorAll('#view table')) {
      const body = t.querySelector('tbody');
      if (!body) continue;
      const rows = body.querySelectorAll('tr').length;
      if (rows > 0) continue;
      // no rows: the panel must say so somewhere it can be read
      const panel = t.closest('.panel') || t.parentElement;
      const said = /none|no |nothing|empty|not yet|—/i.test((panel && panel.textContent) || '');
      if (!said) {
        const head = Array.from(t.querySelectorAll('thead th'))
          .map((h) => h.textContent.trim()).filter(Boolean).slice(0, 4).join('/');
        out.push(head || '(unlabelled table)');
      }
    }
    return out;
  });
  for (const b of blanks) {
    add(`a table rendered zero rows and no empty state — ${where}, columns: ${b}. `
      + 'Silently blank and "you have nothing" look identical to the operator.');
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

// ---- value fidelity ---------------------------------------------------------
// Everything above asks whether the page BROKE. This asks whether it LIED: does
// the number on screen equal the number in the record? That is the class that
// matters most here — a broken page is obvious, a wrong number gets built on.
//
// Money is read back out of the rendered cells and compared numerically against
// the saved run, so a formatting change cannot make this pass or fail by itself,
// and a sign flip or a swapped column cannot pass at all.
const parseMoney = (t) => {
  const s = String(t).replace(/[$,\s]/g, '');
  if (!s || s === '—') return null;
  return Number(s);
};

async function verifyBoardNumbers(page, add, runId) {
  const doc = await getJson(`/api/batch/${encodeURIComponent(runId)}`);
  // The board renders every real row it holds, slim and promoted alike — the two
  // stages score the same combo on different work, so a check that assumed one
  // stage would flag the other as a mismatch. What must hold is that EVERY row
  // on screen corresponds exactly to some recorded row: same combo, same trades,
  // same money, same region. A swapped column, a sign flip, a stale render or a
  // number from a different run all break that; a legitimate second stage does
  // not.
  const expected = (doc.leaders || []).filter((l) => l.nullDealSeed == null);
  if (!expected.length) { add('the fixture run has no real leader rows — this check verified nothing'); return; }

  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#view tr.clickable'))
    .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim())));
  if (!rows.length) { add('the board rendered no rows for a run that has them'); return; }

  const comboOf = (l) => [l.trade, l.ctx1, l.ctx2].filter(Boolean).join(' + ');
  const near = (a, b) => a != null && b != null && Math.abs(a - b) < 0.005;
  let checked = 0;

  for (const cells of rows) {
    const combo = cells[0].replace(/\s+/g, ' ').trim();
    const candidates = expected.filter((l) => comboOf(l) === combo);
    if (!candidates.length) {
      add(`board row "${combo}" is on screen but no recorded row carries that combo`);
      continue;
    }
    checked++;
    const trades = cells[3] === '—' ? null : Number(cells[3]);
    const shownPnl = parseMoney(cells[4]);
    const shownHold = parseMoney(cells[5]);
    const shownRegion = cells[7] === '—' ? null : Number(cells[7]);

    const match = candidates.find((l) => (l.trades == null || l.trades === trades)
      && (l.pnl == null || near(shownPnl, l.pnl))
      && ((l.holdout ? l.holdout.pnl : null) == null ? true : near(shownHold, l.holdout.pnl))
      && ((l.region ? l.region.size : null) == null ? shownRegion == null : shownRegion === l.region.size));
    if (!match) {
      const c = candidates[0];
      add(`board row "${combo}" matches no recorded row — screen: trades ${trades}, test ${cells[4]}, `
        + `held-back ${cells[5]}, region ${cells[7]}; nearest record: trades ${c.trades}, `
        + `test ${c.pnl != null ? c.pnl.toFixed(2) : '—'}, held-back ${c.holdout ? c.holdout.pnl.toFixed(2) : '—'}, `
        + `region ${c.region ? c.region.size : '—'}`);
      continue;
    }
    // A held-back figure must never be the search figure wearing its label. They
    // are computed on different windows, and confusing them is the single
    // easiest way to publish a number that is not tradeable.
    const recHold = match.holdout ? match.holdout.pnl : null;
    if (recHold != null && match.pnl != null && recHold !== match.pnl
        && shownHold != null && Math.abs(shownHold - match.pnl) < 1e-9) {
      add(`board row "${combo}": the held-back column is showing the SEARCH figure`);
    }
  }
  if (!checked) add('no board row could be matched to the record — the check verified nothing');
}

// The Trading side's money screen, against the endpoint that feeds it. This is
// where real and paper money sit next to each other, so it is where a mix-up
// costs the most — a fictional figure read as a real one.
// BRANCH ISOLATION: the real-money side must not show a paper book (2026-08-18).
//
// This exists because the obvious check does NOT work on a one-book box. The
// Dashboard-totals check above compares the summed money against the per-setup
// records, and on data where the only book is a paper one, a total that wrongly
// includes both books is NUMERICALLY IDENTICAL to the correct one. I injected
// exactly the QC-149 fault (dropping the per-card book filter) and the totals
// check passed — a check whose fixture cannot distinguish the two cases is not
// a check, and counting it as coverage is how QC-159 happened.
//
// This one discriminates with the data actually present: with a paper book
// active and NO real channel, the real branch must show its empty state. If the
// branch filter regresses, the paper book's money renders under a real-money
// heading — which is the QC-149 danger in its most dangerous form, because a
// number under "live" is read as real money.
async function verifyRealBranchShowsNoPaperBook(page, add, paperSetupId) {
  const cfgs = await getJson('/api/live/configs').catch(() => null);
  if (!cfgs || !cfgs.configs) { add('the branch-isolation check could not read /api/live/configs'); return; }
  const realChannels = cfgs.configs.filter((g) => (g.channels || {}).real).length;
  const paperChannels = cfgs.configs.filter((g) => (g.channels || {}).paper).length;
  // The F1 pilot is a legitimate live-side row that carries NO channels.real —
  // it is the original hard-wired rail, not a greenlit channel. An earlier
  // version of this check asserted the live side was EMPTY and failed on F1,
  // which would have been a false alarm on the real-money screen: the worst kind,
  // because it trains the reader to dismiss this pass.
  // Read F1 from the SAME source the page does. It is not in /api/live/configs at
  // all — fetchConfigs() synthesises the row from /api/pilot and gives it a real
  // channel. Deriving it from the configs list said "no F1" while the screen was
  // showing one, and this check then failed on correct behaviour.
  const pilot = await getJson('/api/pilot').catch(() => null);
  const f1Present = !!(pilot && pilot.present !== false);
  // Only meaningful in the asymmetric case: paper books exist, real ones do not.
  if (!paperChannels || realChannels) return;

  const seen = await page.evaluate(() => ({
    text: (document.querySelector('#view') || {}).textContent || '',
    ids: [...document.querySelectorAll('#view [data-setup]')].map((e) => e.getAttribute('data-setup')),
    cards: document.querySelectorAll('#view .tile').length,
  }));
  if (paperSetupId && seen.ids.includes(paperSetupId)) {
    add(`the REAL-money Dashboard is showing the paper book ${paperSetupId} — `
      + 'its money would read as real money');
  }
  // The empty-state wording is only owed when there is genuinely nothing to show.
  // With F1 present the live side correctly lists it, so demanding "nothing on
  // the live side" would be asserting a falsehood.
  if (!f1Present && !/nothing on the live side/i.test(seen.text)) {
    add('the real branch holds no channel and no F1 pilot, but the Dashboard did not say so: '
      + `"${seen.text.trim().slice(0, 120)}"`);
  }
}

// THE DASHBOARD'S SUMMED MONEY (added 2026-08-18).
//
// verifyTradingNumbers checks ONE setup's tiles against ONE record. The
// Dashboard does something different and riskier: it SUMS realized, unrealized
// and open across every book on the branch you are looking at. A filtering slip
// is least visible in a sum — one wrong book folded into a total looks like a
// plausible number, where the same slip on a single setup's page would show a
// figure you could recognise as belonging to something else. QC-149 was exactly
// that class (real and paper counted together) and the Dashboard cards were one
// of the four sites that had it.
//
// The expected totals are recomputed from the SERVER's per-setup records, not
// from the page — so this is an independent second opinion on the page's own
// arithmetic and filtering, not a copy agreeing with itself (QC-148). The
// wrong-side assertion below is the load-bearing half: it fails when the total
// happens to equal what you would get by summing BOTH books.
async function verifyDashboardTotals(page, add, isPaper) {
  const cfgs = await getJson('/api/live/configs').catch(() => null);
  if (!cfgs || !cfgs.configs) { add('the Dashboard check could not read /api/live/configs'); return; }

  let wantR = 0, wantU = 0, wantOpen = 0;   // this branch only
  let bothR = 0, bothOpen = 0;              // both books, to catch an unfiltered sum
  let counted = 0;
  for (const g of cfgs.configs) {
    const ch = (g.channels || {})[isPaper ? 'paper' : 'real'];
    if (!ch || !ch.setupId) continue;
    const st = g.f1
      ? await getJson('/api/pilot').catch(() => null)
      : await getJson(`/api/live/setups/${encodeURIComponent(ch.setupId)}/status`).catch(() => null);
    if (!st) continue;
    counted++;
    const rp = g.f1 ? st.realizedPnl : (isPaper ? st.paperRealizedPnl : st.realizedPnl);
    const up = g.f1 ? st.unrealizedPnl : (isPaper ? st.paperUnrealizedPnl : st.unrealizedPnl);
    const all = st.openPositions || [];
    wantR += rp || 0;
    wantU += up || 0;
    wantOpen += all.filter((pp) => (g.f1 ? !pp.paper : (isPaper ? pp.paper : !pp.paper))).length;
    bothR += (st.realizedPnl || 0) + (st.paperRealizedPnl || 0);
    bothOpen += all.length;
  }
  if (!counted) return;   // nothing on this branch; the EMPTY pass covers that view

  // Scope to the SUMMARY grid. The per-config cards below it are also .tile and
  // also carry money, so an unscoped match would read a card and call it a total.
  const tiles = await page.evaluate(() => {
    const grid = document.querySelector('#view .grid');
    if (!grid) return null;
    const out = {};
    for (const t of grid.querySelectorAll('.tile')) {
      const k = t.querySelector('.k'); const v = t.querySelector('.v');
      if (k && v) out[k.textContent.trim()] = v.textContent.trim();
    }
    return out;
  });
  if (!tiles) { add('the Dashboard rendered no summary grid'); return; }
  const find = (re) => { const k = Object.keys(tiles).find((x) => re.test(x)); return k ? tiles[k] : null; };

  const check = (label, shown, want) => {
    const got = parseMoney(shown);
    if (got == null || Math.abs(got - want) > 0.005) {
      add(`Dashboard ${label} reads ${shown}, the per-setup records sum to ${want.toFixed(4)}`);
      return false;
    }
    return true;
  };
  check('realized total', find(/realized/i), wantR);
  check('unrealized total', find(/unrealized/i), wantU);

  const openShown = find(/open positions/i);
  if (openShown != null && Number(openShown) !== wantOpen) {
    add(`Dashboard open-positions reads ${openShown}, this branch holds ${wantOpen}`
      + ` (both books together would be ${bothOpen})`);
  }
  // The specific way this goes wrong: the total is right for the WRONG population.
  const shownR = parseMoney(find(/realized/i));
  if (shownR != null && Math.abs(bothR - wantR) > 1e-9 && Math.abs(shownR - bothR) < 0.005) {
    add(`the ${isPaper ? 'paper' : 'live'} Dashboard total is the sum of BOTH books `
      + `(${bothR.toFixed(4)}), not this branch's ${wantR.toFixed(4)}`);
  }
  if (openShown != null && bothOpen !== wantOpen && Number(openShown) === bothOpen) {
    add(`the ${isPaper ? 'paper' : 'live'} Dashboard is counting positions from both books`);
  }
  // SAY SO when the data cannot tell the two cases apart. With only one book on
  // the box, a wrongly-unfiltered total equals the correct one, so the two
  // wrong-side assertions above are vacuous — they pass without discriminating.
  // The ISOLATION pass is what covers that case here; this line stops anyone
  // reading a green "VALUES Trading / paper / dash" as proof of book separation.
  if (Math.abs(bothR - wantR) < 1e-9 && bothOpen === wantOpen) {
    console.error('NOTE (coverage limit)  Dashboard cross-book assertions are NON-DISCRIMINATING on '
      + 'this box: only one book exists, so a both-books total equals the right one. '
      + 'Book separation is covered by the ISOLATION pass below and, discriminatingly, by '
      + 'tests/test-dashtotals.js, which runs dashTotals against a setup holding BOTH books.');
  }
}

async function verifyTradingNumbers(page, add, setupId, isPaper) {
  const st = await getJson(`/api/live/setups/${encodeURIComponent(setupId)}/status`);
  const tiles = await page.evaluate(() => {
    const out = {};
    for (const t of document.querySelectorAll('#view .tile')) {
      const k = t.querySelector('.k');
      const v = t.querySelector('.v');
      if (k && v) out[k.textContent.trim()] = v.textContent.trim();
    }
    return out;
  });
  const find = (re) => {
    const k = Object.keys(tiles).find((x) => re.test(x));
    return k ? tiles[k] : null;
  };
  const expectMoney = (label, shownText, want) => {
    if (want == null) return;
    const got = parseMoney(shownText);
    if (got == null || Math.abs(got - want) > 0.005) {
      add(`${label} reads ${shownText}, the record says ${want.toFixed(4)}`);
    }
  };
  // The whole point: the side being shown must be the side being counted.
  expectMoney('realized tile', find(/realized/i), isPaper ? st.paperRealizedPnl : st.realizedPnl);
  expectMoney('unrealized tile', find(/unrealized/i), isPaper ? st.paperUnrealizedPnl : st.unrealizedPnl);

  const wrongSide = isPaper ? st.realizedPnl : st.paperRealizedPnl;
  const shownReal = parseMoney(find(/realized/i));
  const wantReal = isPaper ? st.paperRealizedPnl : st.realizedPnl;
  if (wrongSide != null && wantReal != null && wrongSide !== wantReal
      && shownReal != null && Math.abs(shownReal - wrongSide) < 1e-9) {
    add(`the ${isPaper ? 'paper' : 'live'} side is showing the OTHER book's realized money`);
  }

  const openWant = (st.openPositions || []).filter((p) => (isPaper ? !!p.paper : !p.paper)).length;
  const openShown = find(/open positions/i);
  if (openShown != null && Number(openShown) !== openWant) {
    add(`open-positions tile reads ${openShown}, this side holds ${openWant}`
      + ` (the record's merged list has ${(st.openPositions || []).length})`);
  }
  const rowCount = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll('#view .panel'));
    const p = panels.find((x) => /open positions/i.test((x.querySelector('.k') || {}).textContent || ''));
    return p ? p.querySelectorAll('tbody tr:not(:has(td.empty))').length : -1;
  });
  if (rowCount >= 0 && rowCount !== openWant) {
    add(`the open-positions table lists ${rowCount} row(s), this side holds ${openWant}`);
  }
}

// The control path: activate a channel, confirm the screen says so, deactivate,
// confirm it says so again. These buttons change what trades, so an unexercised
// one is the last place a silent no-op can hide — which is exactly what the
// master switch turned out to be.
// THE LAUNCH BUTTON AND THE STOP BUTTON (added 2026-08-18).
//
// Everything else in this harness deliberately does NOT press launchers: firing
// a real sweep on every run is not something a check may do. The consequence is
// that the two controls at the very top of the Constructing workflow — the one
// that STARTS a run and the one that STOPS it — had no runtime coverage at all,
// on either side. A launcher that builds a body the server refuses looks exactly
// like a working button until an operator presses it: the tab does not change,
// so there is nothing to see. That is QC-143's class, on the control with the
// longest feedback delay.
//
// Made safe by aborting immediately: the run is started with the page's OWN
// default form state (never a copy of it — a copy agrees with itself, QC-148),
// proved to have been accepted by reading back a real batch id, and then stopped
// through the page's own Stop button. The abort is ALSO asserted, because "Stop"
// silently failing is how a box ends up with a sweep nobody meant to leave
// running. Cleanup re-aborts unconditionally, so a fault mid-pass cannot leave
// a job behind.
async function verifyLaunchAndStop(page, add, dialogs) {
  const before = await getJson('/api/batches').catch(() => null);
  const idsBefore = new Set((Array.isArray(before) ? before : (before && before.batches) || []).map((b) => b.id || b));

  const btn = await page.$('#swStart2');
  if (!btn) { add('the sweep tab has no launch button (#swStart2)'); return; }
  const wired = await page.evaluate(() => { const b = document.querySelector('#swStart2'); return !!(b && b.onclick); });
  if (!wired) { add('the launch button has no handler — pressing it does nothing'); return; }

  dialogs.accept = true;
  try {
    await btn.click({ timeout: 5000 });
    // the launcher posts and then writes "launched <id>" into its own status line
    let msg = '';
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(500);
      msg = await page.evaluate(() => (document.querySelector('#swMsg') || {}).textContent || '');
      if (/launched\s+\S/.test(msg) || /FAILED/i.test(msg)) break;
    }
    if (!/launched\s+(\S+)/.test(msg)) {
      add(`the launch button did not start a run — the status line says "${msg.trim() || '(nothing)'}". `
        + 'A body the server refuses looks identical to a working button from the screen.');
      return;
    }
    const startedId = msg.match(/launched\s+(\S+)/)[1];
    // and the server must actually have it, not merely have echoed something
    const after = await getJson('/api/batches').catch(() => null);
    const idsAfter = (Array.isArray(after) ? after : (after && after.batches) || []).map((b) => b.id || b);
    if (!idsAfter.includes(startedId)) {
      add(`the page reported "launched ${startedId}" but the server does not list that run`);
    }
    if (idsAfter.length <= idsBefore.size) add('a launch was reported but no new run appeared on the server');

    // STOP: the page's own button, confirmation and all.
    const stop = await page.$('#swStop');
    if (!stop) { add('there is no Stop button for a running job (#swStop)'); return; }
    const seen = dialogs.seen;
    await stop.click({ timeout: 5000 });
    await page.waitForTimeout(1500);
    if (dialogs.seen === seen) add('Stop asked for no confirmation before killing a running job');
    const smsg = await page.evaluate(() => (document.querySelector('#swMsg') || {}).textContent || '');
    if (!/abort/i.test(smsg)) {
      add(`Stop did not acknowledge the abort — the status line says "${smsg.trim() || '(nothing)'}"`);
    }
  } finally {
    // belt and braces: never leave a sweep running because a check threw
    await postJson('/api/abort', {}).catch(() => {});
  }
}

async function verifyChannelControls(page, add, configId, dialogs) {
  const stateOf = async () => {
    const cfgs = await getJson('/api/live/configs');
    const c = (cfgs.configs || []).find((x) => x.id === configId);
    return c && c.channels && c.channels.paper ? c.channels.paper.state : null;
  };
  const before = await stateOf();
  if (before !== 'paper') { add(`the fixture config is not on paper before the test (state ${before})`); return; }

  const press = (label) => pressInRow(page, configId, label);

  // 1. CANCELLING must change nothing. A confirmation that does not actually
  //    protect is worse than none, because it teaches the operator to trust it.
  dialogs.accept = false;
  const seenBefore = dialogs.seen;
  const d1 = await press('^Deactivate$');
  if (d1 !== true) { add(`Deactivate is not clickable on this config's row (${d1})`); return; }
  if (dialogs.seen === seenBefore) add('Deactivate asked for no confirmation — it changes what trades');
  if (await stateOf() !== 'paper') add('CANCELLING the Deactivate confirmation still deactivated the channel');

  // 2. CONFIRMING must change the state, and the ROW must say so. Read the row's
  //    own status cell, not the page text — the page carries a legend spelling
  //    out the whole status vocabulary, and matching against that would report a
  //    fault on a correct screen.
  dialogs.accept = true;
  const d2 = await press('^Deactivate$');
  if (d2 !== true) { add(`the Deactivate button is not clickable on the second attempt (${d2})`); return; }
  const stopped = await stateOf();
  if (stopped === 'paper') add('Deactivate changed nothing — the channel is still on paper');
  const rowStatus = async () => page.evaluate((id) => {
    const tr = Array.from(document.querySelectorAll('#view tbody tr'))
      .find((r) => (r.textContent || '').includes(id));
    return tr ? (tr.children[4] || {}).textContent.trim() : null;
  }, configId);
  const after = await rowStatus();
  if (after === 'active paper') add(`the row still reads "active paper" after deactivating (state is ${stopped})`);
  if (after == null) add('the config row vanished from the list after deactivating');

  // 3. Re-activation. With positions still open this is CORRECTLY refused —
  //    re-activating resets the setup's displayed run and would hide them while
  //    the engine keeps managing them. Either outcome is right; what must hold is
  //    that a refusal's count RECONCILES with what the screen shows, which is
  //    exactly what did not hold before (it said 2 while the page showed 1).
  const st = await getJson(`/api/live/setups/${encodeURIComponent((await getJson('/api/live/configs')).configs
    .find((c) => c.id === configId).channels.paper.setupId)}/status`);
  const realOpen = (st.openPositions || []).filter((p) => !p.paper).length;
  const paperOpen = (st.openPositions || []).filter((p) => p.paper).length;
  let refusal = null;
  page.once('dialog', (d) => { refusal = d.message(); d.accept().catch(() => {}); });
  const a1 = await press('^Activate paper$');
  if (a1 !== true) { add(`Activate is not clickable after deactivating (${a1}) — the channel cannot be restarted`); return; }
  await page.waitForTimeout(1200);
  const back = await stateOf();
  if (realOpen + paperOpen === 0) {
    if (back !== 'paper') add(`Activate did not put a flat channel back on paper (state ${back})`);
  } else {
    if (back === 'paper') add('a channel with open positions was re-activated — its displayed run would hide them');
    const msg = refusal || '';
    if (!msg) add('re-activation was refused with no message the operator can read');
    else {
      if (realOpen && !new RegExp(`${realOpen} real`).test(msg)) {
        add(`the refusal does not name the ${realOpen} real position(s) the screen shows — got: ${msg.slice(0, 160)}`);
      }
      if (paperOpen && !new RegExp(`${paperOpen} paper`).test(msg)) {
        add(`the refusal does not name the ${paperOpen} paper position(s) the screen shows — got: ${msg.slice(0, 160)}`);
      }
      if (/\((\d+) open\)/.test(msg)) {
        add(`the refusal reports one merged count, which cannot be reconciled with a screen showing one side: ${msg.slice(0, 160)}`);
      }
    }
  }
  dialogs.accept = false;
}

// Click a button INSIDE the row belonging to one config. Searching the whole
// page finds the first button with that label, which on a list of several
// configs is very likely the wrong row's — that is how two throwaway fixtures
// ended up operating each other (2026-08-18).
async function pressInRow(page, configId, label) {
  const rows = await page.$$('#view tbody tr');
  for (const tr of rows) {
    const txt = (await tr.textContent()) || '';
    if (!txt.includes(configId)) continue;
    for (const b of await tr.$$('button')) {
      const t = ((await b.textContent()) || '').trim();
      if (!new RegExp(label, 'i').test(t)) continue;
      if (await b.isDisabled()) return 'disabled';
      await b.click({ timeout: 5000 });
      await page.waitForTimeout(1500);
      return true;
    }
    return false;
  }
  return 'no-row';
}

// THE REAL-MONEY CHANNEL. This is the path with the most at stake, and the
// answer turned out to be that it is deliberately CLOSED: real orders for a
// non-F1 config wait on per-setup sub-account key routing (open gap G8), and the
// executor enforces it independently by forcing every schema-2 intent to paper
// (QC-135). So the thing to verify is the BLOCK, not a way around it.
//
// Three independent layers, and this checks that none of them has quietly
// relaxed:
//   the screen   — the button is disabled and says why
//   the service  — a hand-crafted call is still refused without the setup's own
//                  sub-account key (QC-125), so the screen is not the only guard
//   the executor — S2_LIVE_ROUTING forces paper (covered in the executor's own
//                  tests; named here so the chain is written down in one place)
async function verifyRealChannelIsBlocked(page, add, configId) {
  const row = await page.evaluate((id) => {
    const tr = Array.from(document.querySelectorAll('#view tbody tr')).find((r) => (r.textContent || '').includes(id));
    if (!tr) return null;
    const btn = Array.from(tr.querySelectorAll('button')).find((b) => /activate real/i.test(b.textContent || ''));
    return btn ? { disabled: btn.disabled, title: btn.title || '' } : { missing: true };
  }, configId);

  if (!row) { add('the throwaway config is not listed on the Live Trading side'); return; }
  if (row.missing) { add('no "Activate real" button on this row — the control must be present and disabled, not absent'); return; }
  if (!row.disabled) {
    add('"Activate real" is ENABLED for a non-F1 config — real orders for these wait on per-setup key routing (G8)');
  }
  if (!/sub-account key routing|G8/i.test(row.title)) {
    add(`the disabled "Activate real" does not say why it is disabled — got: ${row.title.slice(0, 160)}`);
  }
  if (!/paper/i.test(row.title)) {
    add('the disabled button does not say the engine still books paper — a blocked control with no explanation reads as broken');
  }

  // The service must refuse independently. If the screen were the only guard, a
  // stale tab or a direct call would be enough to reach a live real channel.
  const out = await postJson(`/api/live/configs/${configId}/activate`, { channel: 'real' }).catch(() => null);
  if (!out) { add('the service did not answer a real-channel activation at all'); return; }
  if (out.code === 200) {
    add('the SERVICE accepted a real-channel activation that the screen blocks — the screen is the only guard');
    await postJson(`/api/live/configs/${configId}/deactivate`, { channel: 'real' }).catch(() => {});
    return;
  }
  const msg = JSON.stringify(out.body || '');
  if (!/keyRef|sub-account/i.test(msg)) {
    add(`the service refused without naming the missing sub-account key — the operator cannot act on it. Got: ${msg.slice(0, 200)}`);
  }
}

// THE REAL-MONEY CHANNEL. Going live for a NEW config is BLOCKED ON PURPOSE and
// this pass confirms the block rather than defeating it. The executor signs every
// order with the box's single key, so a real order from a generalized setup would
// land on F1's own wallet and borrow pool — register entries 125 and 135. Until
// per-setup key routing exists (open gap G8), schema-2 is paper-only and the
// button is disabled with that reason written on it.
//
// What must hold: the screen refuses, it SAYS WHY where a person can read it,
// and the server refuses independently. A block that lives only in the front end
// is not a block, it is a suggestion.
async function verifyRealChannelIsBlocked(page, add, configId) {
  const rowButton = async (label) => {
    const rows = await page.$$('#view tbody tr');
    for (const tr of rows) {
      const txt = (await tr.textContent()) || '';
      if (!txt.includes(configId)) continue;
      for (const b of await tr.$$('button')) {
        const t = ((await b.textContent()) || '').trim();
        if (new RegExp(label, 'i').test(t)) {
          return { disabled: await b.isDisabled(), title: await b.getAttribute('title') };
        }
      }
      return null;
    }
    return undefined;
  };

  const btn = await rowButton('^Activate real$');
  if (btn === undefined) { add(`config ${configId} has no row on the Live Trading side`); return; }
  if (btn === null) { add('the Live Trading row offers no "Activate real" control at all — the state is unreadable'); return; }
  if (!btn.disabled) {
    add('"Activate real" is ENABLED for a generalized config — a real order would sign with the box\'s single key '
      + 'and land on F1\'s own wallet and borrow pool (register 125/135); it is paper-only until per-setup key routing exists');
  }
  if (!btn.title || !/key routing|sub-account|paper/i.test(btn.title)) {
    add(`the disabled "Activate real" button does not say why — an operator sees a dead control and no reason. Title: ${JSON.stringify(btn.title)}`);
  }

  const out = await postJson(`/api/live/configs/${configId}/activate`, { channel: 'real' }).catch(() => null);
  if (!out) { add('the activate endpoint could not be reached to confirm the server-side refusal'); return; }
  if (out.code === 200) {
    add('the SERVER accepted a real activation the screen blocks — the block is front-end only');
    await postJson(`/api/live/configs/${configId}/deactivate`, { channel: 'real' }).catch(() => {});
    return;
  }
  const msg = JSON.stringify(out.body || '');
  if (!/keyRef|sub-account/i.test(msg)) {
    add(`the server refused without naming the missing sub-account key: ${msg.slice(0, 200)}`);
  }
  const c = (await getJson('/api/live/configs')).configs.find((x) => x.id === configId);
  if (c && c.channels && c.channels.real && c.channels.real.state === 'live') {
    add('a setup is LIVE after a refused activation');
  }
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
  // Cancel by default — a pass that clicks its way through the whole tab must
  // not be able to say yes to something. The CONTROLS pass flips this
  // deliberately, and checks BOTH answers.
  const dialogs = { accept: false, seen: 0 };
  page.on('dialog', (d) => { dialogs.seen++; (dialogs.accept ? d.accept() : d.dismiss()).catch(() => {}); });
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

    // A button with no handler is a button that does nothing when pressed, and
    // it looks identical to one that works. Both pages wire every control with
    // `el.onclick = …`, so a rendered button whose onclick is still null was
    // either never wired or wired to an id that is not on screen.
    const dead = await page.evaluate(() => Array.from(document.querySelectorAll('#view button'))
      .filter((b) => !b.onclick && !b.disabled && !b.closest('form'))
      .map((b) => (b.textContent || '').trim().slice(0, 40)));
    for (const d of dead) add(`the button "${d}" has no handler — pressing it does nothing`);

    // Every column heading must say what it holds (owner's standing rule). This
    // checks the RENDERED table, so a heading built at runtime cannot escape the
    // source-level test in tests/test-columnkeys.js.
    const bare = await page.evaluate(() => Array.from(document.querySelectorAll('#view th'))
      .filter((t) => t.textContent.trim() && !t.title.trim())
      .map((t) => t.textContent.trim().slice(0, 40)));
    for (const b of [...new Set(bare)]) add(`the column "${b}" carries no description`);

    if (spec.verify) await spec.verify(page, add, dialogs);
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
  // A paper book to read, and a SEPARATE throwaway config to operate.
  //
  // The controls pass deactivates what it touches, so pointing both at the same
  // config made the second run of this harness silently SKIP both passes — the
  // pass consumed the state it depended on, and a check that quietly stops
  // checking is the worst kind. VALUES reads an existing paper channel in
  // whatever state it is in; CONTROLS mints its own, exercises it, and nukes it.
  // FIXTURES THE HARNESS MINTS FOR ITSELF (rewritten 2026-08-18).
  //
  // These three passes are the ONLY coverage the Trading tab's money numbers and
  // its channel controls have. On 2026-08-18 all three SKIPPED on a clean box and
  // the harness still printed "all 45 tab views clean" — Trading value-fidelity
  // coverage was zero and the summary line said the opposite. Two causes:
  //
  //   1. The candidate list was built from runs that ALREADY had a greenlight,
  //      which is circular: with no greenlights on the box, nothing was tried —
  //      including the finished fixture run sitting right there with a promoted
  //      row. Candidates now come from FINISHED RUNS, fixture run first.
  //   2. VALUES required a paper channel to pre-exist. It now mints its own.
  //
  // Each pass gets its OWN throwaway, because the controls pass deactivates what
  // it touches and must not consume what another pass depends on (QC-152).
  const restore = [];
  const minted = [];

  // Candidate runs: the fixture run first (it is the one we know has data), then
  // every other finished run, then any run a greenlight points at. Asking the
  // server whether a row can be greenlighted is one call; INFERRING it is what
  // made the earlier version skip silently.
  async function candidateRuns() {
    const ids = [runId];
    try {
      const b = await getJson('/api/batches');
      const list = Array.isArray(b) ? b : (b.batches || []);
      for (const it of list) { const id = it.id || it; if (id && !ids.includes(id)) ids.push(id); }
    } catch (_) { /* fall through to greenlight-derived runs */ }
    try {
      const gls = await getJson('/api/live/greenlights');
      for (const g of gls.greenlights || []) {
        const id = g.sourceRun && g.sourceRun.id;
        if (id && !ids.includes(id)) ids.push(id);
      }
    } catch (_) { /* the list above is enough */ }
    return ids;
  }

  // Mint ONE throwaway config. Returns its id, or null when no run on this box
  // can produce one. `activatePaper` also opens its paper book so the money
  // screen has something real to read.
  //
  // It tries EVERY promoted row on every candidate run, not just the first. The
  // live-executability gate refuses a cell for several independent reasons (a
  // lab-only entry or gate, a pair no execution target serves), so the first row
  // failing says nothing about the second. The server's refusal is KEPT and
  // reported when nothing works — a mint that fails silently is what let the
  // Trading passes disappear, and "could not mint" without the reason is barely
  // better than the silence it replaced.
  let lastRefusal = null;
  async function mintThrowaway(why, activatePaper) {
    for (const rid of await candidateRuns()) {
      const doc = await getJson(`/api/batch/${encodeURIComponent(rid)}`).catch(() => null);
      if (!doc || !doc.leaders) continue;
      const rows = doc.leaders.filter((l) => l.stage === 'promoted' && l.nullDealSeed == null);
      for (const row of rows) {
        // Clicking board rows CHANGES a run's stored selection, so pin the row we
        // want and put the original back afterwards. A harness that leaves the box
        // in a different state behaves differently on its second run.
        const wasSelected = doc.selection && doc.selection.key;
        const sel = await postJson(`/api/bracketlab/${encodeURIComponent(rid)}/select`,
          { key: row.key, stage: 'promoted' }).catch(() => null);
        if (!sel || sel.code !== 200) continue;
        if (wasSelected && wasSelected !== row.key
            && !restore.some((r) => r.runId === rid)) restore.push({ runId: rid, key: wasSelected });
        // Try 'best' then 'declared': every promoted row has a best cell, while a
        // declared cell exists only when the run declared one — but the declared
        // cell is sometimes the executable one when the best cell is lab-only.
        for (const target of ['best', 'declared']) {
          const mint = await postJson('/api/live/greenlight', { runId: rid, target, why })
            .catch(() => null);
          if (!mint || mint.code !== 200 || !mint.body.greenlight) continue;
          const id = mint.body.greenlight.id;
          if (!activatePaper) { minted.push({ id, channel: null }); return id; }
          const act = await postJson(`/api/live/configs/${id}/activate`, { channel: 'paper', clipUsd: 10 })
            .catch(() => null);
          if (act && act.code === 200) { minted.push({ id, channel: 'paper' }); return id; }
          if (act && act.body && act.body.error) lastRefusal = `${row.key} (${target}): ${act.body.error}`;
          await postJson(`/api/live/configs/${id}/nuke`, {}).catch(() => {});  // not executable; next cell
        }
      }
    }
    return null;
  }

  // VALUES reads a paper book. Prefer one that already exists (a real book with
  // real trades is a stronger read than a fresh empty one); mint one only when
  // the box has none, so this pass can never silently vanish again.
  let paperSetup = null;
  let valuesConfig = null;
  try {
    const cfgs = await getJson('/api/live/configs');
    const withPaper = (cfgs.configs || []).filter((x) => x.channels && x.channels.paper);
    if (withPaper.length) paperSetup = withPaper[0].channels.paper.setupId;
  } catch (_) { /* reported below */ }
  if (!paperSetup) {
    valuesConfig = await mintThrowaway('throwaway paper book for the runtime value checks', true);
    if (valuesConfig) {
      const cfgs = await getJson('/api/live/configs').catch(() => ({ configs: [] }));
      const row = (cfgs.configs || []).find((c) => c.id === valuesConfig);
      paperSetup = row && row.channels && row.channels.paper && row.channels.paper.setupId;
    }
  }

  const controlsConfig = await mintThrowaway('throwaway config for the runtime control checks', true);
  // The REAL path gets its own, un-activated: the controls pass deactivates what
  // it touches and these two must not be able to interfere.
  const realConfig = await mintThrowaway('throwaway config for the real-channel path check', false);

  for (const r of restore) {
    await postJson(`/api/bracketlab/${encodeURIComponent(r.runId)}/select`, { key: r.key, stage: 'promoted' }).catch(() => {});
  }

  // A SKIPPED PASS IS A FAILURE (QC-152's named gap, closed 2026-08-18).
  // Previously each of these printed a note and the run still exited 0 with
  // "all N tab views clean" — a harness that quietly stops checking is worse
  // than no harness, and this is the exact failure it exists to prevent.
  // UI_ALLOW_SKIPS=1 waives it deliberately, out loud, for a box that genuinely
  // cannot mint (no finished run at all).
  const skipped = [];
  const why = lastRefusal ? `\n     the server's last refusal: ${lastRefusal}` : '';
  if (!paperSetup) skipped.push(`Trading VALUES — no paper book, and none could be minted${why}`);
  if (!controlsConfig) skipped.push(`Trading CONTROLS — no run on this box mints a live-executable config${why}`);
  if (!realConfig) skipped.push('Trading REAL-GATE — no throwaway config for the real-channel path');

  visits.push({
    label: 'VALUES     Constructing / boards',
    url: `${BASE}/constructing.html`,
    storage: { 'cx-tab': 'boards', 'cx-run': runId },
    verify: (page, add) => verifyBoardNumbers(page, add, runId),
  });
  for (const t of CONSTRUCTING_TABS) {
    visits.push({ label: `CLICKED    Constructing / ${t}`, url: `${BASE}/constructing.html`, storage: { 'cx-tab': t, 'cx-run': runId }, click: true });
  }
  for (const b of TRADING_BRANCHES) {
    for (const s of TRADING_SUBS) {
      visits.push({ label: `CLICKED    Trading / ${b} / ${s}`, url: `${BASE}/trading.html`, storage: { 'lt-branch': b, 'lt-sub': s }, click: true });
    }
  }
  if (paperSetup) {
    visits.push({
      label: 'VALUES     Trading / paper / detail',
      url: `${BASE}/trading.html`,
      storage: { 'lt-branch': 'paper', 'lt-sub': 'setups' },
      verify: async (page, add) => {
        // reach the detail page the way a person does: click the setup's row
        const rows = await page.$$('#view tr[data-id]');
        if (!rows.length) { add('the Setups list shows no rows for an active paper channel'); return; }
        await rows[0].click({ timeout: 5000 });
        await page.waitForTimeout(1500);
        await verifyTradingNumbers(page, add, paperSetup, true);
      },
    });
  }
  if (paperSetup) {
    visits.push({
      label: 'VALUES     Trading / paper / dash',
      url: `${BASE}/trading.html`,
      storage: { 'lt-branch': 'paper', 'lt-sub': 'dash' },
      verify: (page, add) => verifyDashboardTotals(page, add, true),
    });
  }
  if (paperSetup) {
    visits.push({
      label: 'ISOLATION  Trading / real / dash',
      url: `${BASE}/trading.html`,
      storage: { 'lt-branch': 'real', 'lt-sub': 'dash' },
      verify: (page, add) => verifyRealBranchShowsNoPaperBook(page, add, paperSetup),
    });
  }
  if (controlsConfig) {
    visits.push({
      label: 'CONTROLS   Trading / paper / configs',
      url: `${BASE}/trading.html`,
      storage: { 'lt-branch': 'paper', 'lt-sub': 'configs' },
      verify: (page, add, dialogs) => verifyChannelControls(page, add, controlsConfig, dialogs),
    });
  }

  if (realConfig) {
    visits.push({
      label: 'REAL-GATE  Trading / real / configs',
      url: `${BASE}/trading.html`,
      storage: { 'lt-branch': 'real', 'lt-sub': 'configs' },
      verify: (page, add) => verifyRealChannelIsBlocked(page, add, realConfig),
    });
  }

  // Pressed LAST of the Constructing passes: it starts a real (immediately
  // aborted) run, so nothing that reads run state should follow it.
  visits.push({
    label: 'LAUNCH     Constructing / sweep',
    url: `${BASE}/constructing.html`,
    storage: { 'cx-tab': 'sweep', 'cx-run': runId },
    verify: (page, add, dialogs) => verifyLaunchAndStop(page, add, dialogs),
  });

  // Light theme is a whole second palette; a token defined only in the dark
  // block renders as nothing at all, and nobody would see it in a dark run.
  //
  // It used to cover three views out of seventeen, chosen by nothing in
  // particular. A palette hole lives in whichever panel happens to use the
  // missing token, so sampling a third of the surface is sampling — every view
  // is now rendered in light as well as dark (2026-08-18).
  for (const t of CONSTRUCTING_TABS) {
    visits.push({ label: `LIGHT      Constructing / ${t}`, url: `${BASE}/constructing.html`, storage: { 'cx-tab': t, 'cx-run': runId, 'cx-theme': 'light' } });
  }
  for (const b of TRADING_BRANCHES) {
    for (const s of TRADING_SUBS) {
      visits.push({ label: `LIGHT      Trading / ${b} / ${s}`, url: `${BASE}/trading.html`, storage: { 'lt-branch': b, 'lt-sub': s, 'lt-theme': 'light' } });
    }
  }

  let bad = 0;
  for (const sk of skipped) {
    if (process.env.UI_ALLOW_SKIPS === '1') { console.error(`WAIVED SKIP  ${sk}`); continue; }
    bad++;
    console.error(`FAIL SKIPPED    ${sk}`);
    console.error('     A pass that does not run is not a pass. Set UI_ALLOW_SKIPS=1 to waive deliberately.');
  }
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

  // Clean up the throwaway config, and exercise Nuke while doing it — the last
  // control with no coverage. Nuke must REFUSE while a channel is still active
  // (dropping a config out from under a running book would strand it), and must
  // work once it is deactivated.
  // The VALUES book, when this harness minted it. Leaving it behind would make
  // the NEXT run take the "a paper channel already exists" branch and read a
  // book this harness created — state leaking between runs is how the earlier
  // version came to behave differently on its second invocation.
  if (valuesConfig) {
    await postJson(`/api/live/configs/${valuesConfig}/deactivate`, { channel: 'paper' }).catch(() => {});
    const gone = await postJson(`/api/live/configs/${valuesConfig}/nuke`, {}).catch(() => null);
    if (!gone || gone.code !== 200) {
      bad++;
      console.error('FAIL CLEANUP    Trading / values paper book');
      console.error(`     could not remove the minted paper book: ${gone ? JSON.stringify(gone.body) : 'no reply'}`);
    }
  }
  if (realConfig) {
    await postJson(`/api/live/configs/${realConfig}/deactivate`, { channel: 'real' }).catch(() => {});
    const gone = await postJson(`/api/live/configs/${realConfig}/nuke`, {}).catch(() => null);
    if (!gone || gone.code !== 200) {
      bad++;
      console.error('FAIL CLEANUP    Trading / real throwaway');
      console.error(`     could not remove the real-path config: ${gone ? JSON.stringify(gone.body) : 'no reply'}`);
    }
  }
  if (controlsConfig) {
    const problems = [];
    const early = await postJson(`/api/live/configs/${controlsConfig}/nuke`, {}).catch(() => null);
    if (early && early.code === 200) problems.push('Nuke removed a config whose paper channel was still active');
    else if (!early || !/deactivate/i.test(JSON.stringify(early.body || ''))) {
      problems.push(`Nuke refused an active config without saying to deactivate first: ${early ? JSON.stringify(early.body) : 'no reply'}`);
    }
    await postJson(`/api/live/configs/${controlsConfig}/deactivate`, { channel: 'paper' }).catch(() => null);
    const out = await postJson(`/api/live/configs/${controlsConfig}/nuke`, {}).catch(() => null);
    if (!out || out.code !== 200) {
      problems.push(`Nuke refused a deactivated config: ${out ? JSON.stringify(out.body) : 'no reply'}`);
    } else {
      const still = (await getJson('/api/live/configs').catch(() => ({ configs: [] })))
        .configs.some((c) => c.id === controlsConfig);
      if (still) problems.push('Nuke reported success but the config is still listed');
    }
    if (problems.length) {
      bad++;
      console.error('FAIL CLEANUP    Trading / nuke');
      for (const p2 of problems) console.error(`     ${p2}`);
    } else {
      console.log('ok   CLEANUP    Trading / nuke refuses an active config and removes a deactivated one');
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
