// THE COINS SCREEN, PRESSED FOR REAL (3.119.0).
//
// WHY THIS EXISTS. The tab shipped without ever having been run: nineteen unit
// tests were green while the runner could not read a single coin. The end-to-end
// runner test next door covers that half. This covers the other half -- that the
// screen draws at all, and that the things the adversarial pass found wrong on it
// are right when a browser really presses them.
//
// It answers the three Coins reads itself, so nothing depends on what is cached
// on the machine, and it writes nothing.
//   node tests/ui-coins.js
//
// NOT an npm script, deliberately. package.json counts as a product file to the
// release check (RULE ONE-C), so adding a one-line alias for a browser check
// would move the release number -- and moving it makes the planted check read
// NOT CHECKED, which costs the owner a re-run for nothing. Folding the alias in
// alongside the next real change is a one-liner; it is in the loop record.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.UI_TEST_PORT || 8201);

const DEFAULTS = { target: 6, from: 1, to: 30, step: 0.5, cap: 20, driftParts: 8, weekdaysOnly: false };
const parts = (names) => names.map((n, i) => ({ part: n, from: i * 50, to: i * 50 + 49, periods: 50 }));
function reading(layout, names, { reached = true, worst = 0.3 } = {}) {
  const p = parts(names);
  return {
    layout,
    periods: names.length * 50,
    parts: p,
    searchedOver: { from: 0, to: 99, parts: ['train', 'test'], turnsTheSearchCounted: 6, turnsOnceLaterDataIsSeen: 6 },
    search: reached
      ? { asked: 6, reached: true, pct: 12.5, turns: 7, overshot: true, walk: [{ pct: 11, turns: 9 }, { pct: 12.5, turns: 7 }, { pct: 14, turns: 4 }] }
      : { asked: 60, reached: false, pct: null, turns: null, overshot: false, best: { pct: 14, turns: 4 }, walk: [{ pct: 14, turns: 4 }] },
    split: p.map((q, i) => ({ part: q.part, from: q.from, to: q.to, rising: i === 3 ? 0.995 : 0.55, falling: i === 3 ? 0.005 : 0.45, balance: i === 3 ? 0.005 : 0.45, periods: 50 })),
    weight: { cap: 20, mean: 1, capped: 3, reachedMean: true, needCap: null, why: null, over: 'train', periods: 50 },
    typed: reached ? { pct: 12.5, turns: 7, stretches: 8 } : null,
    medians: reached ? { rising: 12, falling: 9 } : null,
    perPart: reached ? p.map((q, i) => ({
      part: q.part, from: q.from, to: q.to, periods: 50, turns: 2 - (i > 1 ? 1 : 0),
      stretches: {
        rising: { full: i === 2 ? 1 : 2, stubs: 1, stubLength: 6, median: 12, count: 2.5 },
        falling: { full: i === 2 ? 0 : 2, stubs: 0, stubLength: 0, median: 9, count: 2 },
      },
      stubs: 1,
    })) : null,
    why: reached ? undefined : 'no percentage between 1% and 30% gives 60 change(s) of direction on this coin — the most any of them gives is 4, at 14%',
  };
}
const FOUR = ['train', 'test', 'held', 'reserve'];
const THREE = ['train', 'test', 'held'];
function record(coin, { worst, drift, months, target, read = true }) {
  return {
    v: 2, coin, geometry: 'daily-4d', periods: 200, read,
    why: read ? null : `${coin} has no cached prices on this box — download them on Data first`,
    provenance: { release: '3.119.0', capturedAt: '2026-09-11T09:00:00Z', fromTs: Date.UTC(2024, 0, 1), toTs: Date.UTC(2026, 5, 1), cachedMonths: months, candles: 12000 },
    params: { ...DEFAULTS, target },
    traditional: read ? {
      whole: { rising: 0.52, falling: 0.48, balance: 0.48, periods: 200 },
      worstTailSlice: worst == null ? { balance: null, from: null, to: null, width: null, widths: [] } : { balance: worst, from: 10, to: 35, width: 26, widths: [{ width: 26 }, { width: 30 }] },
      drift: { drift, parts: [], wanted: 8 },
      periods: 200,
    } : null,
    readings: read ? { reserve61: reading('reserve61', FOUR), split70: reading('split70', THREE) } : {},
  };
}
const RECORDS = [
  record('AAAUSDT', { worst: 0.45, drift: 0.02, months: 17, target: 6 }),
  record('BBBUSDT', { worst: 0.00, drift: 0.31, months: 17, target: 6 }),
  record('CCCUSDT', { worst: null, drift: null, months: 17, target: 6 }),
  record('DDDUSDT', { worst: 0.20, drift: 0.11, months: 12, target: 20 }),
  record('EEEUSDT', { worst: null, drift: null, months: 4, target: 6, read: false }),
];
const UNREADABLE = [{ coin: 'FFFUSDT', file: 'FFFUSDT__daily-4d.json', why: 'this reading was written under record shape 1 and this release reads shape 2 — read the coin again to replace it' }];

const DATA_STATE = { symbols: [
  { symbol: 'AAAUSDT', months: 17, from: '2024-01', to: '2026-05' },
  { symbol: 'BBBUSDT', months: 17, from: '2024-01', to: '2026-05' },
  { symbol: 'CCCUSDT', months: 17, from: '2024-01', to: '2026-05' },
  { symbol: 'DDDUSDT', months: 19, from: '2024-01', to: '2026-07' },   // grown since DDD was read
] };

function requirePlaywright() {
  for (const p of ['playwright', path.join(ROOT, 'node_modules', 'playwright')]) { try { return require(p); } catch (_) { /* next */ } }
  throw new Error('playwright is not installed');
}

(async () => {
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const { chromium } = requirePlaywright();
  const exe = process.env.PLAYWRIGHT_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('dialog', async (d) => { errors.push(`dialog: ${d.message()}`); await d.dismiss(); });

  let runStatus = { running: false, started: null, done: 0, of: 0, wrote: [], couldNotRead: [], note: null, error: null, finishedAt: null, stopped: false, stoppedAt: null, params: null };
  let stopPresses = 0;
  let started = null;
  await page.route('**/api/coins/records**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    geometry: 'daily-4d', records: RECORDS, unreadable: UNREADABLE, defaults: DEFAULTS,
    layouts: ['split70', 'reserve61'], recordVersion: 2, rareSideWeighting: false,
  }) }));
  await page.route('**/api/coins/run', (route) => {
    if (route.request().method() === 'POST') { started = JSON.parse(route.request().postData() || '{}'); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ started: true, of: 5 }) }); }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(runStatus) });
  });
  await page.route('**/api/coins/stop', (route) => {
    stopPresses++;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ stopping: false, why: 'nothing is running to stop' }) });
  });
  await page.route('**/api/data-state', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(DATA_STATE) }));

  await page.addInitScript(() => { localStorage.setItem('cx-tab', 'coins'); localStorage.removeItem('cx-coins'); });
  await page.goto(`http://127.0.0.1:${PORT}/construct.html`, { waitUntil: 'domcontentloaded' });
  const fails = [];
  const expect = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  await page.waitForSelector('#cRun', { timeout: 15000 });
  // textContent, NOT innerText: this page upper-cases some of its own text in
  // the stylesheet, and innerText hands back what the eye sees rather than what
  // the code wrote. Matching against the rendered case would pin the stylesheet
  // rather than the wording.
  const text = async () => page.locator('#view').textContent();

  expect(/Coins/.test(await page.locator('#view h3').first().textContent()), 'the screen draws');
  const body = await text();
  for (const coin of ['AAAUSDT', 'BBBUSDT', 'CCCUSDT', 'DDDUSDT', 'EEEUSDT']) {
    expect(body.includes(coin), `${coin} is on the screen`);
  }
  expect(/FFFUSDT/.test(body) && /record shape 1/.test(body), 'a record this release cannot read is named, not dropped');
  expect(!/nothing read yet/.test(body), 'with records on the screen it does not say nothing was read');
  expect(/thin side gets no help at all/i.test(body), 'the screen says plainly that a rare side is not weighted up');
  expect(!/rescued by weighting|thinner than weighting/.test(body), 'the screen still promises weighting that the trainer never does');
  expect(/more month\(s\) cached since/.test(body), 'the coin whose history has grown since reads as behind');
  expect(/not what the boxes above say/.test(body), 'the row read at other values says so');
  expect(/release 3\.119\.0/.test(body), 'each row names the release that took it');

  // THE ORDERINGS. Worst first where low is bad, largest first where high is,
  // and a coin that could not be measured last under both.
  const order = async (v) => {
    await page.selectOption('#cOrder', v);
    await page.waitForTimeout(250);
    return page.locator('#view table tbody tr:not(.s4hold) td:first-child b').allTextContents();
  };
  const byTail = await order('tail');
  expect(byTail.length === 5, `every coin is a row, got ${byTail.length}: ${byTail.join(',')}`);
  expect(byTail[0] === 'BBBUSDT', `worst tail slice puts the one-way coin first, got ${byTail[0]}`);
  expect(byTail.slice(-2).sort().join(',') === 'CCCUSDT,EEEUSDT', `and the unmeasured ones last, got ${byTail.join(',')}`);
  expect(byTail.indexOf('CCCUSDT') > byTail.indexOf('DDDUSDT'), 'a coin with no reading never outranks one with a bad reading');
  const byDrift = await order('drift');
  expect(byDrift[0] === 'BBBUSDT', `drift puts the largest first, got ${byDrift[0]}`);
  expect(byDrift.indexOf('CCCUSDT') > byDrift.indexOf('AAAUSDT'), 'and not-measured is last on drift too');

  // THE TYPE NOTE names the type, and does not fire when both appear twice.
  await page.selectOption('#cOrder', 'coin');
  await page.waitForTimeout(250);
  const after = await text();
  expect(/no whole falling stretch/.test(after) || /one whole falling stretch/.test(after),
    'the note about a type appearing once or not at all says which type');
  expect(!/a type appears only once/.test(after), 'the old sentence that fired at zero is gone');
  expect(/train .*periods/i.test(after), 'each part of the history reports its periods');

  // WHAT IS TYPED SURVIVES A REDRAW. This is the one that used to be wiped
  // twice a second while the owner was still typing.
  await page.fill('#cCoins', 'LTCUSDT,XRPUSDT');
  await page.fill('#cTarget', '11');
  await page.check('#cWk');
  await page.selectOption('#cLayout', 'split70');
  await page.waitForTimeout(400);
  expect(await page.inputValue('#cCoins') === 'LTCUSDT,XRPUSDT', 'the coin box keeps what was typed across a redraw');
  expect(await page.inputValue('#cTarget') === '11', 'the number boxes keep what was typed across a redraw');
  expect(await page.isChecked('#cWk'), 'the 24/5 tick keeps what was set across a redraw');

  // STOP ANSWERS. The route replies with a reason and the page must show it.
  runStatus = { ...runStatus, running: true, started: '2026-09-12T06:00:00Z', done: 2, of: 5, note: 'AAAUSDT: reading its cached prices' };
  // A REDRAW IS PROVOKED BY PRESSING SOMETHING, not by reaching into the page:
  // `draw` is not on the window and a test that calls it would be testing a
  // door the owner does not have.
  await page.selectOption('#cOrder', 'periods');
  await page.waitForSelector('#cStop', { timeout: 5000 });
  expect(await page.locator('#cRun').isDisabled(), 'the read button is off while a reading runs');
  expect(await page.locator('#cCoins').isDisabled(), 'and so are the boxes, rather than inviting typing that is thrown away');
  await page.locator('#cStop').click();
  await page.waitForTimeout(300);
  expect(stopPresses === 1, 'the stop press reached the service');
  expect(/nothing is running to stop/.test(await page.locator('#cOut').textContent()), 'and its answer is shown rather than swallowed');

  // A STOPPED RUN READS AS STOPPED.
  runStatus = { ...runStatus, running: false, done: 2, finishedAt: '2026-09-12T06:05:00Z', stopped: true, stoppedAt: 2, wrote: ['AAAUSDT', 'BBBUSDT'], couldNotRead: [] };
  await page.selectOption('#cOrder', 'coin');
  await page.waitForTimeout(400);
  expect(/stopped after 2 of 5/.test(await page.locator('#cOut').textContent()),
    `a stopped run says so and where it got to, got: ${await page.locator('#cOut').textContent()}`);

  expect(errors.length === 0, `no error on the page (${errors.join('; ') || 'none'})`);
  await browser.close();
  srv.kill();
  console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nall coins screen checks passed');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
