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
//   npm run test:ui:coins        (or: node tests/ui-coins.js)
//
// The alias was held back when this file was written: package.json counts as a
// product file to the release check (RULE ONE-C), so adding it on its own would
// have moved the release number for a browser check and made the planted check
// read NOT CHECKED, costing the owner a re-run for nothing. It is folded in
// here, alongside a release that was moving anyway.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.UI_TEST_PORT || 8201);

const DEFAULTS = { target: 6, from: 1, to: 30, step: 0.5, cap: 20, driftParts: 8, shuffles: 200 };
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
// whether either untuned number tells this coin apart from a coin with no
// trend, in the shape lib/coins.js really returns -- `low`/`high` are the range
// the shuffles cover and `value` is this coin's own answer
const tells = (value, low, high) => ({ canTell: true, value, low, high, of: 200, why: null });
const tellsNot = (value, low, high, name) => ({
  canTell: false, value, low, high, of: 200,
  why: `${name} does not tell this coin apart from a coin with no trend at all. Shuffle its own 200 periods into `
    + `200 different orders -- the same coin with its trend taken away -- and they score between ${low} and ${high}.`,
});
const tellsNothingAtAll = (name) => ({ canTell: false, of: 0, low: null, high: null, value: null,
  why: `${name} could not be worked out over 200 periods at all` });
// THE THREE HOLDS THE SCREEN NOW DRAWS A ROW EACH FOR (3.122.0). Shaped exactly
// as lib/dataset.js holdTypes() hands them back, because a fixture that
// invented its own shape is how the last dead mark shipped unnoticed.
const HOLDS = [
  { key: '17h', hours: 17, every: 'day', at: '01:00', startsPerWeek: 7 },
  { key: '41h', hours: 41, every: 'day', at: '01:00', startsPerWeek: 7 },
  { key: '60h', hours: 60, every: 'week', at: 'Tuesday 03:00', startsPerWeek: 1 },
];
function holdOf(h, { worst, drift, periods, read = true, canTell = null }) {
  return {
    hold: h,
    periods,
    read,
    why: read ? null : `offers no complete ${h.hours}-hour trades from the prices cached on this box`,
    span: { fromTs: Date.UTC(2024, 0, 1), toTs: Date.UTC(2026, 5, 1) },
    traditional: read ? {
      whole: { rising: 0.52, falling: 0.48, balance: 0.48, periods },
      worstTailSlice: worst == null ? { balance: null, from: null, to: null, width: null, widths: [] } : { balance: worst, from: 10, to: 35, width: 26, widths: [{ width: 26 }, { width: 30 }] },
      drift: { drift, parts: [], wanted: 8 },
      canTell: canTell || { worstTailSlice: tells(worst, 0.1, 0.4), drift: tells(drift, 0.005, 0.05), periods, shuffles: 200 },
      periods,
    } : null,
    readings: read ? { reserve61: reading('reserve61', FOUR), split70: reading('split70', THREE) } : {},
  };
}
function record(coin, { worst, drift, months, target, read = true, canTell = null }) {
  const holds = {};
  // the weekly hold really does offer far fewer trades, which is the whole
  // reason the three rows are not three copies of one reading
  for (const h of HOLDS) holds[h.key] = holdOf(h, { worst, drift, periods: h.hours === 60 ? 40 : 200, read, canTell });
  return {
    v: 4, coin, read,
    why: read ? null : `${coin} has no cached prices on this box — download them on Data first`,
    provenance: { release: '3.119.0', capturedAt: '2026-09-11T09:00:00Z', cachedMonths: months, candles: 12000 },
    params: { ...DEFAULTS, target },
    holds: read ? holds : {},
  };
}
const RECORDS = [
  record('AAAUSDT', { worst: 0.45, drift: 0.02, months: 17, target: 6 }),
  // ONE COIN WHERE ONE OF THE TWO NUMBERS SAYS NOTHING AND THE OTHER DOES. The
  // mark has to land on that one cell and on no other -- a fixture where every
  // number can tell something exercises nothing, which is what this file did.
  record('BBBUSDT', { worst: 0.00, drift: 0.31, months: 17, target: 6,
    canTell: { worstTailSlice: tellsNot(0.0, 0.02, 0.31, 'the worst tail slice'), drift: tells(0.31, 0.005, 0.05), periods: 200, shuffles: 200 } }),
  // and one where neither could be worked out at all
  record('CCCUSDT', { worst: null, drift: null, months: 17, target: 6,
    canTell: { worstTailSlice: tellsNothingAtAll('the worst tail slice'), drift: tellsNothingAtAll('the drift'), periods: 200, shuffles: 200 } }),
  record('DDDUSDT', { worst: 0.20, drift: 0.11, months: 12, target: 20 }),
  record('EEEUSDT', { worst: null, drift: null, months: 4, target: 6, read: false }),
];
const UNREADABLE = [{ coin: 'FFFUSDT', file: 'FFFUSDT__daily-4d.json', why: 'this reading was written under record shape 3 and this release reads shape 4 — read the coin again to replace it' }];

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
    layouts: ['split70', 'reserve61'], recordVersion: 4, rareSideWeighting: false, holds: HOLDS,
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
  expect(/FFFUSDT/.test(body) && /record shape 3/.test(body), 'a record this release cannot read is named, not dropped');
  expect(!/nothing read yet/.test(body), 'with records on the screen it does not say nothing was read');
  expect(/thin side gets no help at all/i.test(body), 'the screen says plainly that a rare side is not weighted up');
  expect(!/rescued by weighting|thinner than weighting/.test(body), 'the screen still promises weighting that the trainer never does');
  expect(/more month\(s\) cached since/.test(body), 'the coin whose history has grown since reads as behind');
  // ONE ROW, NOT FIVE. Every row said this while the fixture was missing a
  // setting the page compares -- the assertion passed and proved nothing.
  expect((body.match(/not what the boxes above say/g) || []).length === 3,
    `exactly one coin was read at other values, and it has a row per hold — got ${(body.match(/not what the boxes above say/g) || []).length}`);
  // once per ROW, because every one of that coin's rows is a reading taken
  // before the newer history arrived -- sorted by drift you may only be looking
  // at one of them, and it is behind too
  expect((body.match(/more month\(s\) cached since/g) || []).length === 3,
    'the behind mark must ride every row of the coin that is behind');
  expect(/1 of these coins was read before more history/.test(body),
    'and the line at the top counts COINS, not rows — one coin behind is one, not three');
  expect(/release 3\.119\.0/.test(body), 'each row names the release that took it');

  // THE ORDERINGS. Worst first where low is bad, largest first where high is,
  // and a coin that could not be measured last under both.
  const order = async (v) => {
    await page.selectOption('#cOrder', v);
    await page.waitForTimeout(250);
    return page.locator('#view table tbody tr:not(.s4hold) td:first-child b').allTextContents();
  };
  const byTail = await order('tail');
  // FOUR READ COINS AT THREE HOLDS EACH, plus the one with no prices at all
  expect(byTail.length === 13, `every coin gets a row per hold, got ${byTail.length}: ${byTail.join(',')}`);
  expect(byTail[0] === 'BBBUSDT', `worst tail slice puts the one-way coin first, got ${byTail[0]}`);
  expect(byTail[byTail.length - 1] === 'EEEUSDT', `and the coin with nothing read last, got ${byTail.join(',')}`);
  expect(byTail.lastIndexOf('CCCUSDT') > byTail.lastIndexOf('DDDUSDT'), 'a coin with no reading never outranks one with a bad reading');
  const byDrift = await order('drift');
  expect(byDrift[0] === 'BBBUSDT', `drift puts the largest first, got ${byDrift[0]}`);
  expect(byDrift.lastIndexOf('CCCUSDT') > byDrift.lastIndexOf('AAAUSDT'), 'and not-measured is last on drift too');
  // AND THE THREE HOLDS ARE ALL DRAWN, with no control asked for to get them
  const byHold = await page.locator('#view table tbody tr:not(.s4hold) td:nth-child(2)').allTextContents();
  for (const want of ['17h', '41h', '60h']) {
    expect(byHold.some((c) => c.includes(want)), `${want} trades are never drawn: ${byHold.join(' | ')}`);
  }
  expect(byHold.filter((c) => c.includes('Tuesday')).length >= 1, 'the weekly hold never says when it starts');
  expect(byHold.filter((c) => c.includes('01:00')).length >= 2, 'the daily holds never say when they start');

  // THE TYPE NOTE names the type, and does not fire when both appear twice.
  await page.selectOption('#cOrder', 'coin');
  await page.waitForTimeout(250);
  const after = await text();
  expect(/no whole falling stretch/.test(after) || /one whole falling stretch/.test(after),
    'the note about a type appearing once or not at all says which type');
  expect(!/a type appears only once/.test(after), 'the old sentence that fired at zero is gone');
  expect(/train .*periods/i.test(after), 'each part of the history reports its periods');

  // THE MARK LANDS ON THE ONE CELL THAT EARNED IT. BBB's worst tail slice says
  // nothing its own shuffles do not, its drift does; CCC could work out
  // neither. Read cell by cell, because a mark on the whole row, or on every
  // row, reads the same in the page text and means nothing.
  const cellsOf = (coin) => page.evaluate((c) => {
    const rows = [...document.querySelectorAll('#view table tbody tr')];
    const tr = rows.find((r) => r.querySelector('td b') && r.querySelector('td b').textContent === c);
    return tr ? [...tr.querySelectorAll('td')].map((td) => td.textContent) : null;
  }, coin);
  const MARK = 'cannot tell';
  const bbb = await cellsOf('BBBUSDT');
  expect(!!bbb && bbb[6].includes(MARK), `the worst tail slice BBBUSDT cannot trust is not marked, got ${bbb && bbb[6]}`);
  expect(!!bbb && !bbb[7].includes(MARK), `BBBUSDT's drift CAN tell something and is marked anyway, got ${bbb && bbb[7]}`);
  const aaa = await cellsOf('AAAUSDT');
  expect(!!aaa && !aaa[6].includes(MARK) && !aaa[7].includes(MARK), 'AAAUSDT can tell on both numbers and is marked anyway');
  const ccc = await cellsOf('CCCUSDT');
  expect(!!ccc && ccc[6].includes(MARK) && ccc[7].includes(MARK), 'CCCUSDT could work out neither number and neither is marked');
  // three holds a coin, so the mark lands three times per cell that earned it
  expect((after.match(/cannot tell/g) || []).length === 9,
    `nine marked cells across the read coins, got ${(after.match(/cannot tell/g) || []).length}`);
  // and the reason rides with it, or there is nothing to look into
  const why = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#view table tbody tr')];
    const tr = rows.find((r) => r.querySelector('td b') && r.querySelector('td b').textContent === 'BBBUSDT');
    const m = tr && [...tr.querySelectorAll('td')][6].querySelector('span[title]');
    return m ? m.getAttribute('title') : '';
  });
  expect(/does not tell this coin apart/.test(why), `the mark carries no reason, got ${JSON.stringify(why)}`);
  // the shuffle count is on the screen beside the rest of what the read used
  expect(/200 shuffles/.test(after), 'the row does not say how many shuffles the reading was taken at');
  expect(!/\? shuffles/.test(after), 'a row is drawing a literal question mark where the shuffle count belongs');

  // WHAT IS TYPED SURVIVES A REDRAW. This is the one that used to be wiped
  // twice a second while the owner was still typing.
  await page.fill('#cCoins', 'LTCUSDT,XRPUSDT');
  await page.fill('#cTarget', '11');
  await page.selectOption('#cLayout', 'split70');
  await page.waitForTimeout(400);
  expect(await page.inputValue('#cCoins') === 'LTCUSDT,XRPUSDT', 'the coin box keeps what was typed across a redraw');
  expect(await page.inputValue('#cTarget') === '11', 'the number boxes keep what was typed across a redraw');
  // AND THE TWO TREATMENT CONTROLS ARE GONE (owner order, 2026-09-13)
  expect(await page.locator('#cGeom').count() === 0, 'the chunk shape box is still on Coins');
  expect(await page.locator('#cWk').count() === 0, 'the 24/5 tick is still on Coins');
  expect(!/all 17 /.test(body), 'a coin count is typed into the coins label');

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
