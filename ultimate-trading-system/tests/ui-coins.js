// THE COINS SCREEN, PRESSED FOR REAL (COINS.md Part one; 3.124.0).
//
// The unit tests next door check the arithmetic and the plumbing. This checks
// the other half -- that the screen draws what the design says and nothing it
// says has gone: three controls, five bars a coin, the two divisions marked on
// every bar, the counts beside them, the hover on a bar, and that the band is
// set the moment it changes.
//
// It answers the Coins reads itself, so nothing depends on what is cached on
// the machine, and it writes nothing.
//   npm run test:ui:coins        (or: node tests/ui-coins.js)
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.UI_TEST_PORT || 8201);

// THE FIVE SHAPES AND TWO LAYOUTS, SHAPED EXACTLY AS THE SERVICE HANDS THEM
// BACK -- read from the modules rather than typed, because a fixture that
// invented its own shape is how a dead mark once shipped unnoticed.
const SHAPES = require('../lib/coins').shapes();
const LAYOUTS = require('../lib/coinsrun').layouts();
const { shapeSummary } = require('../lib/coins');
const HOUR = 3600000;
// a synthetic shape record: n decisions, a day apart, moves that swing so every
// colour appears and the bar has several runs
function shapeRec(n, { start = Date.UTC(2024, 0, 1), swing = 3 } = {}) {
  const ts = []; const move = [];
  for (let i = 0; i < n; i++) { ts.push(start + i * 24 * HOUR); move.push(Number((Math.sin(i / 9) * swing + (i % 7 === 0 ? 0 : 0.3)).toFixed(4))); }
  return { periods: n, span: { fromTs: ts[0], toTs: ts[n - 1] }, skipped: 0, ts, move };
}
function record(coin, { read = true, months = 17, n = 300, why = null } = {}) {
  const shapes = {};
  if (read) for (const s of SHAPES) shapes[s.key] = shapeSummary(shapeRec(s.every === 'week' ? Math.round(n / 7) : n), 50, LAYOUTS);
  return {
    coin, read, why: read ? null : (why || `${coin} has no cached prices on this box — download them on Data first`),
    provenance: { release: '3.124.0', capturedAt: '2026-09-13T09:00:00Z', cachedMonths: months, candles: 12000 },
    shapes,
  };
}
const RECORDS = [
  record('AAAUSDT'),
  record('DDDUSDT', { months: 12 }),
  record('EEEUSDT', { read: false, months: 4 }),
];
const UNREADABLE = [{ coin: 'FFFUSDT', file: 'FFFUSDT.json', why: 'this reading was written under record shape 5 and this release reads shape 6 — read the coin again to replace it', release: '3.123.0' }];
const DATA_STATE = { symbols: [
  { symbol: 'AAAUSDT', months: 17, from: '2024-01', to: '2026-05' },
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
  let band = 50;
  let bandPosts = [];
  let stopPresses = 0;
  let started = null;
  let recordsFetches = 0;
  await page.route('**/api/coins/records**', (route) => { recordsFetches++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    shapes: SHAPES, layouts: LAYOUTS, band: { value: band, default: 50, home: 'data/settings.json' },
    downloaded: 18, records: RECORDS, unreadable: UNREADABLE, recordVersion: 6,
  }) }); });
  await page.route('**/api/coins/band', (route) => {
    const b = JSON.parse(route.request().postData() || '{}'); bandPosts.push(b.band); band = Number(b.band);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ band }) });
  });
  await page.route('**/api/coins/run', (route) => {
    if (route.request().method() === 'POST') { started = JSON.parse(route.request().postData() || '{}'); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ started: true, of: 3 }) }); }
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
  await page.waitForTimeout(300);
  // textContent, NOT innerText: the stylesheet upper-cases the part names.
  const text = async () => page.locator('#view').textContent();

  expect(/Coins/.test(await page.locator('#view h3').first().textContent()), 'the screen draws');
  const body = await text();

  // THREE CONTROLS AND NOTHING ELSE.
  const controls = await page.evaluate(() => [...document.querySelectorAll('#view input, #view select, #view button, #view textarea')].map((e) => e.id));
  expect(controls.sort().join(',') === ['cBand', 'cCoins', 'cRun'].join(','), `three controls and nothing else, got: ${controls.join(', ')}`);
  for (const gone of ['cTarget', 'cFrom', 'cTo', 'cStep', 'cCap', 'cDrift', 'cShuf', 'cLayout', 'cOrder', 'cGeom', 'cWk']) {
    expect(await page.locator(`#${gone}`).count() === 0, `${gone} is gone from the screen`);
  }
  expect(/all 18 downloaded/.test(body), 'the coin box says how many are downloaded, from the service');
  expect(await page.inputValue('#cBand') === '50', `the band box shows the number the service holds, got ${await page.inputValue('#cBand')}`);
  for (const word of ['drift', 'shuffles', 'fall-back', 'changes of direction', 'most one-sided', 'trade length', 'cannot tell', 'weight ceiling']) {
    expect(!new RegExp(word, 'i').test(body), `the old design's word '${word}' is off the screen`);
  }

  // FIVE BARS A COIN, ONE PER SHAPE, EACH WITH ITS DIVISIONS AND ITS NUMBERS.
  for (const coin of ['AAAUSDT', 'DDDUSDT', 'EEEUSDT']) expect(body.includes(coin), `${coin} is on the screen`);
  const bars = await page.evaluate(() => [...document.querySelectorAll('canvas.cbar')].map((c) => `${c.dataset.coin}:${c.dataset.shape}`));
  expect(bars.length === 2 * SHAPES.length, `two read coins × ${SHAPES.length} shapes = ${2 * SHAPES.length} bars, got ${bars.length}`);
  for (const s of SHAPES) {
    expect(bars.includes(`AAAUSDT:${s.key}`), `AAAUSDT has a bar for ${s.label}`);
    expect(body.includes(s.label), `the bar is named ${s.label}, as Sweep names the shape`);
  }
  expect(!bars.some((b) => b.startsWith('EEEUSDT')), 'a coin that could not be read has no bars');
  expect(/EEEUSDT.*no cached prices/.test(body), 'and says why');
  // painted: every bar has real width and its pixels are not all the track colour
  const painted = await page.evaluate(() => [...document.querySelectorAll('canvas.cbar')].map((c) => {
    const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, 1).data;
    const colours = new Set(); for (let i = 0; i < d.length; i += 4) colours.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return { w: c.width, colours: colours.size };
  }));
  expect(painted.every((p) => p.w > 200), `every bar is drawn at the panel's width, got ${painted.map((p) => p.w).join(',')}`);
  expect(painted.every((p) => p.colours >= 3), `every bar shows all three colours, got ${painted.map((p) => p.colours).join(',')}`);
  // the two divisions, above and below, with the part names in order
  const strips = await page.evaluate(() => [...document.querySelectorAll('.cshape')].map((s) => ({
    above: [...s.querySelectorAll('.clay.above .cpart span')].map((e) => e.textContent),
    below: [...s.querySelectorAll('.clay.below .cpart span')].map((e) => e.textContent),
    widthsAbove: [...s.querySelectorAll('.clay.above .cpart')].map((e) => e.style.width),
  })));
  expect(strips.length === 2 * SHAPES.length, 'a block per bar');
  expect(strips.every((s) => s.above.join(',') === 'train,test,held'), `above every bar: train, test, held — got ${JSON.stringify(strips[0].above)}`);
  expect(strips.every((s) => s.below.join(',') === 'train,test,held,reserve'), `below every bar: train, test, held, reserve — got ${JSON.stringify(strips[0].below)}`);
  expect(strips.every((s) => s.widthsAbove.every((w) => /^\d+(\.\d+)?%$/.test(w))), 'each division box is sized as a share of the decisions');
  const sumW = strips[0].widthsAbove.reduce((a, w) => a + parseFloat(w), 0);
  expect(Math.abs(sumW - 100) < 0.05, `the division boxes span the bar exactly, got ${sumW}%`);
  expect(/70\/15\/15/.test(body) && /61\/13\/13\/13 \(sealed exam\)/.test(body), 'both layouts are named on the screen as Sweep names them');
  // the numbers: per part, rising / falling / sit out / changes, under both layouts
  const nums = await page.evaluate(() => [...document.querySelectorAll('.cshape')].map((s) => [...s.querySelectorAll('.cnums')].map((e) => e.textContent)));
  expect(nums.every((n) => n.length === 3), 'three number lines under every bar: the whole, then one per layout');
  expect(nums.every((n) => /\d+ rising/.test(n[0]) && /\d+ falling/.test(n[0]) && /\d+ sit out/.test(n[0]) && /\d+ changes/.test(n[0])), 'the whole-bar line counts all three readings and the changes');
  expect(nums.every((n) => /window moves from [-+][\d.]+% to [-+][\d.]+%/.test(n[0]) && /median [\d.]+%/.test(n[0]) && /sit out under ±[\d.]+%/.test(n[0])), 'and the range, the median and the band as a move');
  expect(nums.every((n) => (n[1].match(/rising/g) || []).length === 3 && (n[2].match(/rising/g) || []).length === 4), 'three parts counted under 70/15/15 and four under 61/13/13/13');
  expect(/AAAUSDT.*release 3\.124\.0/.test(body), 'each coin names the release that read it');
  expect(/DDDUSDT.*more month\(s\) cached since/.test(body), 'the coin whose history has grown since reads as behind');
  expect(!/AAAUSDT[^]*?more month\(s\) cached since[^]*?DDDUSDT/.test(body), 'and the one that has not does not');
  expect(/FFFUSDT/.test(body) && /record shape 5/.test(body), 'a file this release cannot draw is named, not dropped');

  // THE HOVER NAMES THE DECISION UNDER THE POINTER.
  const cv = page.locator('canvas.cbar').first();
  const box = await cv.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.waitForTimeout(100);
  const title = await cv.getAttribute('title');
  expect(/^\d{4}-\d\d-\d\d · window move [-+][\d.]+% · (rising|falling|sit out)$/.test(title || ''), `the hover names the day, the move and the reading, got ${JSON.stringify(title)}`);

  // THE BAND IS SET THE MOMENT IT CHANGES, AND THE BARS REDRAW.
  const fetchesBefore = recordsFetches;
  await page.fill('#cBand', '80');
  await page.locator('#cBand').press('Tab');
  await page.waitForTimeout(500);
  expect(bandPosts.length === 1 && String(bandPosts[0]) === '80', `the new band reached the service once, got ${JSON.stringify(bandPosts)}`);
  expect(recordsFetches > fetchesBefore, 'and the bars were asked for again');
  expect(await page.inputValue('#cBand') === '80', 'the box shows what the service now holds');

  // WHAT IS TYPED SURVIVES A REDRAW.
  await page.fill('#cCoins', 'LTCUSDT,XRPUSDT');
  await page.fill('#cBand', '60');
  await page.locator('#cBand').press('Tab');
  await page.waitForTimeout(400);
  expect(await page.inputValue('#cCoins') === 'LTCUSDT,XRPUSDT', 'the coin box keeps what was typed across a redraw');

  // READ SENDS THE COINS TYPED, AND NOTHING ELSE.
  await page.locator('#cRun').click();
  await page.waitForTimeout(300);
  expect(!!started && started.coins === 'LTCUSDT,XRPUSDT' && Object.keys(started).join(',') === 'coins', `the read carries the coins and nothing else, got ${JSON.stringify(started)}`);

  // WHILE A READING RUNS the read button and the coin box are off, the band is
  // not (it is not part of a reading), and Stop answers.
  runStatus = { ...runStatus, running: true, started: '2026-09-13T06:00:00Z', done: 1, of: 3, note: 'AAAUSDT: Daily 4-day' };
  await page.fill('#cBand', '70');
  await page.locator('#cBand').press('Tab');
  await page.waitForSelector('#cStop', { timeout: 5000 });
  expect(await page.locator('#cRun').isDisabled(), 'the read button is off while a reading runs');
  expect(await page.locator('#cCoins').isDisabled(), 'and so is the coin box');
  expect(!(await page.locator('#cBand').isDisabled()), 'the band is still live: it is not part of a reading');
  expect(/reading — 1 of 3 done: AAAUSDT: Daily 4-day/.test(await page.locator('#cOut').textContent()), 'the status says where the reading is');
  await page.locator('#cStop').click();
  await page.waitForTimeout(300);
  expect(stopPresses === 1, 'the stop press reached the service');
  expect(/nothing is running to stop/.test(await page.locator('#cOut').textContent()), 'and its answer is shown rather than swallowed');

  // A STOPPED RUN READS AS STOPPED.
  runStatus = { ...runStatus, running: false, done: 1, finishedAt: '2026-09-13T06:05:00Z', stopped: true, stoppedAt: 1, wrote: ['AAAUSDT'], couldNotRead: [] };
  await page.fill('#cBand', '50');
  await page.locator('#cBand').press('Tab');
  await page.waitForTimeout(500);
  expect(/stopped after 1 of 3/.test(await page.locator('#cOut').textContent()),
    `a stopped run says so and where it got to, got: ${await page.locator('#cOut').textContent()}`);

  expect(errors.length === 0, `no error on the page (${errors.join('; ') || 'none'})`);
  await browser.close();
  srv.kill();
  console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nall coins screen checks passed');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
