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
const signal = require('../lib/coinsignal');
const HOUR = 3600000;
// a synthetic shape record: n decisions, a day apart, moves that swing so every
// colour appears and the bar has several runs
function shapeRec(n, { start = Date.UTC(2024, 0, 1), swing = 3 } = {}) {
  const ts = []; const move = []; const out = [];
  for (let i = 0; i < n; i++) {
    ts.push(start + i * 24 * HOUR);
    move.push(Number((Math.sin(i / 9) * swing + (i % 7 === 0 ? 0 : 0.3)).toFixed(4)));
    // the trade tends to follow the window, so the gap is plainly not zero
    out.push(Number((Math.sin(i / 9) * 0.8 + Math.cos(i / 3) * 0.5).toFixed(4)));
  }
  return { periods: n, span: { fromTs: ts[0], toTs: ts[n - 1] }, skipped: 0, ts, move, out };
}
function record(coin, { read = true, months = 17, n = 300, why = null } = {}) {
  const shapes = {};
  if (read) {
    for (const s of SHAPES) {
      const raw = shapeRec(s.every === 'week' ? Math.round(n / 7) : n);
      const sum = shapeSummary(raw, 50, LAYOUTS);
      // the signal reading as the service serves it (3.127.0): the sweep from
      // the module, and a stored link-cut check with seven dealt plateaus
      sum.signal = signal.signalSummary(raw, s.key, LAYOUTS, 50);
      sum.signal.linkCut = signal.linkCutWorth(sum.signal.plateau, { trials: 50, found: 7, strengths: [3.1, 3.4, 4.0, 3.3, 5.2, 3.0, 3.6] });
      // the band each shape is drawn at (3.128.0): the service says which; one
      // shape on this fixture is served at its own sweet spot so the wording shows
      sum.band = s.key === 'daily-3d' && sum.signal.sweetSpot ? { value: sum.signal.sweetSpot.band, source: 'sweet spot' } : { value: 50, source: 'typed' };
      shapes[s.key] = sum;
    }
  }
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
// THE PASSERS AS THE SERVICE SERVES THEM (3.129.0): two rows, one un-ticked
const passRow = (coin, geometry, asStrong, ticked) => {
  const sh = SHAPES.find((s) => s.key === geometry);
  return { coin, geometry, shape: sh.label, check: { asStrong, trials: 50 }, band: 170, called: 0.29, edge: 1.262, perDecision: 0.362, ratio: 1.96, judged: 201, lean: { rising: -1, falling: 1 }, traits: ['reverting', 'steady', 'often'], tradesAMonth: 8.8, ticked };
};
const UNREADABLE = [{ coin: 'FFFUSDT', file: 'FFFUSDT.json', why: 'this reading was written under record shape 6 and this release reads shape 8 — read the coin again to replace it', release: '3.124.0' }];
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
  let auto = false;
  let bandPosts = [];
  let autoPosts = [];
  let passBar = 2;
  let passPosts = [];
  const passRows = () => [passRow('AAAUSDT', 'daily-3d', 0, true), passRow('DDDUSDT', 'daily-2d', 1, false)].filter((r) => r.check.asStrong <= passBar);
  let stopPresses = 0;
  let started = null;
  let recordsFetches = 0;
  await page.route('**/api/coins/records**', (route) => { recordsFetches++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    shapes: SHAPES, layouts: LAYOUTS, band: { value: band, default: 50, home: 'data/settings.json', auto },
    downloaded: 18, records: RECORDS, unreadable, recordVersion: 8,
    passers: { bar: passBar, default: 2, trials: 50, rows: passRows() },
  }) }); });
  let cleanPresses = 0;
  let unreadable = UNREADABLE;
  await page.route('**/api/coins/cleanup', (route) => {
    cleanPresses++; unreadable = [];
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ removed: ['FFFUSDT.json'], failed: [] }) });
  });
  await page.route('**/api/coins/passers', (route) => {
    const b = JSON.parse(route.request().postData() || '{}'); passPosts.push(b);
    if ('bar' in b) passBar = Number(b.bar);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ bar: passBar, off: [] }) });
  });
  await page.route('**/api/coins/band', (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if ('band' in b) { bandPosts.push(b.band); band = Number(b.band); }
    if ('auto' in b) { autoPosts.push(b.auto); auto = b.auto === true; }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ band, auto }) });
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

  // THE BASKET IS THE FIRST THING ON THE SCREEN (the owner's design, 3.172.0):
  // Candidates for Sweep, then Read these coins, then How each coin reads.
  const headings = await page.evaluate(() => [...document.querySelectorAll('#view > .panel > h3')].map((h) => h.textContent.trim()));
  expect(headings.slice(0, 3).join(' | ') === 'Candidates for Sweep | Read these coins | How each coin reads',
    `the screen draws in the design's order, got ${headings.join(' | ')}`);
  const body = await text();

  // THE BASKET, THE READING AND THE PICTURE HOLD THESE CONTROLS AND NO OTHERS.
  // Scoped to everything ABOVE Walk it forward, because this assertion is about
  // the reading's own controls. It named six and had been failing since the walk
  // arrived on the tab with fourteen of its own plus the look-backs box -- a
  // hardcoded roll-call of the whole screen goes stale every time the screen
  // grows, which is how a test ends up red and unread. The walk's own controls
  // are checked in tests/test-coinscan.js, which reads them out of the source.
  const SCOPE = '#view > .panel input, #view > .panel select, #view > .panel button, #view > .panel textarea';
  const controls = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => e.id).filter(Boolean), SCOPE);
  expect(controls.sort().join(',') === ['cAuto', 'cBacks', 'cBand', 'cClean', 'cCoins', 'cPassBar', 'cRun'].join(','),
    `the reading's three boxes, the button, the band, its tick and the bar, plus the cleanup while there is something to remove, and nothing else: ${controls.join(', ')}`);
  const unnamed = await page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => !e.id).map((e) => e.className), SCOPE);
  expect(unnamed.length === 2 && unnamed.every((c) => c === 'cpass'), `the only controls without a name are the passers' row ticks: ${JSON.stringify(unnamed)}`);
  // THE PASSERS' TABLE sits after the controls and before the first coin, with its numbers
  const passers = await page.evaluate(() => {
    const t = document.querySelector('table.cpassers');
    const panel = t && t.closest('.panel');
    return {
      heads: t ? [...t.querySelectorAll('th')].map((e) => e.textContent) : [],
      rows: t ? [...t.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map((d) => d.textContent.trim())) : [],
      ticks: t ? [...t.querySelectorAll('input.cpass')].map((e) => e.checked) : [],
      sentence: panel ? [...panel.querySelectorAll('p.note')].map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim() : null,
      heading: panel ? panel.querySelector('h3').textContent.trim() : null,
      boxname: panel ? (panel.querySelector('.passbox .passname') || {}).textContent : null,
      beforeFirstCoin: panel ? (panel.compareDocumentPosition(document.querySelector('.panel.ccoin')) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 : false,
      beforeTheReading: panel ? (panel.compareDocumentPosition(document.querySelector('#cRun')) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 : false,
    };
  });
  expect(passers.heads.join('|') === '|coin|chunk shape|check|sweet spot band|called|edge per called trade|per decision|edge over chance|after rising|after falling|traits|judged|trades a month', `the table names every column, got ${passers.heads.join('|')}`);
  expect(passers.rows.length === 2 && passers.rows[0].slice(1, 9).join('|') === `AAAUSDT|${SHAPES.find((s) => s.key === 'daily-3d').label}|0 of 50|170|29%|+1.26%|+0.362%|1.96×`, `the first row carries the numbers at its sweet spot, got ${passers.rows[0].join('|')}`);
  expect(passers.rows[0][9] === 'down' && passers.rows[0][10] === 'up' && passers.rows[0][12] === '201' && passers.rows[0][13] === '8.8', `the leans, the judged count and trades a month, got ${passers.rows[0].slice(9).join('|')}`);
  expect(passers.ticks.join(',') === 'true,false', `the ticks show what the service holds, got ${passers.ticks.join(',')}`);
  expect(/coins and shapes that pass/.test(passers.sentence) && /of 50 deals/.test(passers.sentence)
    && /Sweep runs the ticked rows when only what is ticked on Coins is on over there/.test(passers.sentence),
    `the sentence, got ${passers.sentence}`);
  expect(passers.heading === 'Candidates for Sweep' && /from Read these coins/.test(passers.boxname || ''),
    `the table sits in a named box inside Candidates for Sweep, got ${passers.heading} / ${passers.boxname}`);
  expect(passers.beforeFirstCoin && passers.beforeTheReading, 'the basket is above the reading and above the first coin');
  expect(await page.inputValue('#cPassBar') === '2', 'the bar box shows the number the service holds');
  expect(/each shape at its own best sit-out band/.test(body), 'the tick is labelled for the thing it picks');
  expect(await page.isChecked('#cAuto') === false, 'the tick shows what the service holds: off');
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
    above: [...s.querySelectorAll('.clay.above .cpart span:first-child')].map((e) => e.textContent),
    below: [...s.querySelectorAll('.clay.below .cpart span:first-child')].map((e) => e.textContent),
    datesAbove: [...s.querySelectorAll('.clay.above .cpart .cdate')].map((e) => e.textContent),
    datesBelow: [...s.querySelectorAll('.clay.below .cpart .cdate')].map((e) => e.textContent),
    widthsAbove: [...s.querySelectorAll('.clay.above .cpart')].map((e) => e.style.width),
    testShade: getComputedStyle(s.querySelector('.clay.above .cpart.test')).backgroundColor,
    trainShade: getComputedStyle(s.querySelector('.clay.above .cpart.train')).backgroundColor,
  })));
  expect(strips.length === 2 * SHAPES.length, 'a block per bar');
  expect(strips.every((s) => s.above.join(',') === 'train,test,held'), `above every bar: train, test, held — got ${JSON.stringify(strips[0].above)}`);
  expect(strips.every((s) => s.below.join(',') === 'train,test,held,reserve'), `below every bar: train, test, held, reserve — got ${JSON.stringify(strips[0].below)}`);
  expect(strips.every((s) => s.widthsAbove.every((w) => /^\d+(\.\d+)?%$/.test(w))), 'each division box is sized as a share of the decisions');
  // EVERY BOX SAYS THE DAY ITS PART STARTS, and the first one is the bar's first day
  const day = /^\d{4}-\d\d-\d\d$/;
  expect(strips.every((s) => s.datesAbove.length === 3 && s.datesAbove.every((d) => day.test(d))), `three start dates above, got ${JSON.stringify(strips[0].datesAbove)}`);
  expect(strips.every((s) => s.datesBelow.length === 4 && s.datesBelow.every((d) => day.test(d))), `four start dates below, got ${JSON.stringify(strips[0].datesBelow)}`);
  expect(strips.every((s) => s.datesAbove[0] === '2024-01-01' && s.datesBelow[0] === '2024-01-01'), 'train starts where the bar starts');
  expect(strips.every((s) => s.datesAbove[1] > s.datesAbove[0] && s.datesAbove[2] > s.datesAbove[1]), 'the dates run forward along the bar');
  expect(strips.every((s) => s.datesBelow[3] >= s.datesAbove[2]), 'the reserve starts no earlier than held under the other division');
  // THE TEST BOX ABOVE IS SHADED (owner, 2026-09-13), and train is not
  expect(strips.every((s) => s.testShade !== s.trainShade && !/rgba\(0, 0, 0, 0\)|transparent/.test(s.testShade)), `the test box above is shaded: test ${strips[0].testShade}, train ${strips[0].trainShade}`);
  const sumW = strips[0].widthsAbove.reduce((a, w) => a + parseFloat(w), 0);
  expect(Math.abs(sumW - 100) < 0.05, `the division boxes span the bar exactly, got ${sumW}%`);
  expect(/70\/15\/15/.test(body) && /61\/13\/13\/13 \(sealed exam\)/.test(body), 'both layouts are named on the screen as Sweep names them');
  // the numbers: per part, rising / falling / sit out / changes, under both layouts
  const tables = await page.evaluate(() => [...document.querySelectorAll('.cshape')].map((s) => {
    const t = s.querySelector('table.cgap');
    return {
      heads: t ? [...t.querySelectorAll('th')].map((e) => e.textContent) : [],
      rows: t ? [...t.querySelectorAll('tbody tr:not(.cgrp)')].map((r) => [...r.querySelectorAll('td')].map((d) => d.textContent)) : [],
      groups: t ? [...t.querySelectorAll('tbody tr.cgrp td')].map((e) => e.textContent) : [],
      head: s.querySelector('.chead').textContent,
    };
  }));
  expect(tables.every((t) => t.heads.join('|') === 'part|starts|decisions|rising|falling|sit out|thin side|changes|run|up after rising|up after falling|gap (points)|move after rising|move after falling|gap (move)'), `the table names every column, got ${tables[0].heads.join('|')}`);
  expect(tables.every((t) => t.rows.length === 1 + 3 + 4 && t.rows[0][0] === 'whole'), `eight rows a bar: the whole, then three parts, then four; got ${tables[0].rows.map((r) => r[0]).join(',')}`);
  expect(tables.every((t) => t.groups.join('|') === '70/15/15|61/13/13/13 (sealed exam)'), 'the two divisions head their rows, as Sweep names them');
  expect(tables.every((t) => t.rows.every((r) => day.test(r[1]))), 'every row says the day its part starts');
  expect(tables.every((t) => t.rows.every((r) => Number(r[3]) + Number(r[4]) + Number(r[5]) === Number(r[2]))), 'rising + falling + sit out = decisions on every row');
  expect(tables.every((t) => t.rows.every((r) => /^\d+ (rising|falling)$/.test(r[6]))), `the thin side names its side, got ${tables[0].rows[0][6]}`);
  expect(tables.every((t) => t.rows.every((r) => /^\d+\.\d$/.test(r[8]))), `the run is decisions per change, got ${tables[0].rows[0][8]}`);
  // a part with nothing on one side prints — for that side and for the gap, never a number
  const share = /^(\d+\.\d%|—)$/; const pts = /^([-+]\d+\.\d pts|—)$/; const mv = /^([-+]\d+\.\d\d%|—)$/;
  expect(tables.every((t) => t.rows.every((r) => share.test(r[9]) && share.test(r[10]) && pts.test(r[11]))), `the gap in shares, got ${tables[0].rows[0].slice(9, 12).join(' | ')}`);
  expect(tables.every((t) => t.rows.every((r) => mv.test(r[12]) && mv.test(r[13]) && mv.test(r[14]))), `the gap in moves, got ${tables[0].rows[0].slice(12).join(' | ')}`);
  expect(tables.every((t) => t.rows.every((r) => (r[11] === '—') === (r[9] === '—' || r[10] === '—'))), 'the gap is blank exactly when one side is empty');
  expect(tables[0].rows[0].slice(9, 15).every((c) => c !== '—'), `the whole bar has both sides, got ${tables[0].rows[0].slice(9, 15).join(' | ')}`);
  expect(tables.some((t) => t.rows.some((r) => r[11] !== '+0.0 pts')), 'on this fixture the gap is plainly not zero somewhere');
  expect(tables.every((t) => /window moves from [-+][\d.]+% to [-+][\d.]+%/.test(t.head) && /median [\d.]+%/.test(t.head) && /sit out under ±[\d.]+%/.test(t.head)), 'the heading carries the range, the median and the band as a move');
  // THE SIGNAL LINE UNDER EVERY BAR'S HEADING (3.127.0): the reading, its
  // one-word traits, the band the box is set to, the instrument's own check,
  // and the sweep as one bar per band.
  const sigs = await page.evaluate(() => [...document.querySelectorAll('.cshape')].map((s) => {
    const e = s.querySelector('.csig');
    return { text: e ? e.textContent.replace(/\s+/g, ' ').trim() : null, bars: e ? e.querySelectorAll('.csw').length : 0, traits: e ? [...e.querySelectorAll('.ctrait')].map((t) => t.textContent) : [] };
  }));
  expect(sigs.length === 2 * SHAPES.length && sigs.every((s) => s.text && /^signal /.test(s.text)), `a signal line under every bar, and it says so first: ${JSON.stringify(sigs[0])}`);
  expect(sigs.every((s) => /× chance at band \d+, \d+% called · plateau \d+–\d+, \d+ bands, mean [\d.]+×/.test(s.text) || /no band beats chance for three steps together/.test(s.text)), `each line names a band, a ratio and the share called, or says no band beats chance: ${sigs[0].text}`);
  expect(sigs.every((s) => / at band \d+: (the colour changes no call|no ratio|[-+]?[\d.]+× chance)/.test(s.text)), `each line reads the band its shape is drawn at: ${sigs[0].text}`);
  const sweetCount = RECORDS.filter((r) => r.read).reduce((n, r) => n + Object.values(r.shapes).filter((sh) => sh.band && sh.band.source === 'sweet spot').length, 0);
  expect(sweetCount >= 1 && sigs.filter((s) => / at band 50: /.test(s.text)).length === sigs.length - sweetCount && sigs.filter((s) => / at band (?!50: )\d+: /.test(s.text)).length === sweetCount, `the ${sweetCount} shape(s) served at their own sweet spot read that band; every other reads the typed 50`);
  expect(sigs.every((s) => / with the link cut, (a plateau in \d+ of 50|one at least this strong in \d+ of 50)/.test(s.text)), `each line carries the instrument's own check: ${sigs[0].text}`);
  expect(sigs.every((s) => s.bars === signal.bandGrid().length), `the sweep is one bar per band, ${signal.bandGrid().length} of them, got ${sigs[0].bars}`);
  expect(sigs.every((s) => s.traits.every((t) => ['reverting', 'trending', 'steady', 'fading', 'mixed', 'often', 'much', 'both'].includes(t))), `every trait is one of the eight words, got ${JSON.stringify(sigs[0].traits)}`);
  expect(sigs.some((s) => /× chance at band \d+, \d+% called · plateau/.test(s.text) && s.traits.length >= 2 && / one at least this strong in \d+ of 50/.test(s.text)), `on this fixture at least one bar finds a plateau, names its traits and weighs it against the deals: ${sigs.map((s) => s.text).join(' | ')}`);
  expect(!/luck/i.test(body), 'the word luck is nowhere on the screen');
  // THE LINE GOES GREEN when the sweet spot beats chance, and only then
  const greens = await page.evaluate(() => [...document.querySelectorAll('.cshape .csig')].map((e) => ({ on: e.classList.contains('on'), plateau: /· plateau \d+–\d+/.test(e.textContent), colour: getComputedStyle(e).color })));
  expect(greens.some((g) => g.on), 'on this fixture at least one line is green');
  expect(greens.every((g) => g.on === g.plateau), `green exactly where a plateau is named: ${JSON.stringify(greens.map((g) => [g.on, g.plateau]))}`);
  expect(greens.filter((g) => g.on).every((g) => g.colour === 'rgb(26, 156, 58)'), `the green is the rising green, got ${greens.find((g) => g.on).colour}`);
  // THE HEADING SAYS WHICH BAND EACH SHAPE IS DRAWN AT, and whether it is the shape's own sweet spot
  const heads = await page.evaluate(() => [...document.querySelectorAll('.cshape .chead')].map((e) => e.textContent.replace(/\s+/g, ' ')));
  expect(heads.every((h) => / · band \d+/.test(h)), `every heading names the band in use: ${heads[0]}`);
  expect(heads.some((h) => /\(its own sweet spot\)/.test(h)) && heads.some((h) => / · band 50(?! \(its own)/.test(h)), 'one shape is drawn at its own sweet spot and says so; the others at the typed band');
  expect(/AAAUSDT.*release 3\.124\.0/.test(body), 'each coin names the release that read it');
  expect(/DDDUSDT.*more month\(s\) cached since/.test(body), 'the coin whose history has grown since reads as behind');
  expect(!/AAAUSDT[^]*?more month\(s\) cached since[^]*?DDDUSDT/.test(body), 'and the one that has not does not');
  expect(/FFFUSDT/.test(body) && /record shape 6/.test(body), 'a file this release cannot draw is named, not dropped');
  // THE CLEANUP THE OWNER CAN REACH: offered beside the note, removes what it
  // names, and goes away with the note once there is nothing left to remove.
  expect(/removes exactly the 1 file\(s\) named above and nothing else/.test(body), 'the control says what it removes');
  await page.locator('#cClean').click();
  await page.waitForTimeout(500);
  expect(cleanPresses === 1, 'the press reached the service');
  expect(await page.locator('#cClean').count() === 0, 'with nothing left to remove the control is gone');
  expect(!/cannot draw/.test(await text()), 'and so is the note');

  // THE HOVER NAMES THE DECISION UNDER THE POINTER.
  const cv = page.locator('canvas.cbar').first();
  const box = await cv.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.waitForTimeout(100);
  const title = await cv.getAttribute('title');
  expect(/^\d{4}-\d\d-\d\d · window move [-+][\d.]+% · (rising|falling|sit out) · trade [-+][\d.]+%$/.test(title || ''), `the hover names the day, the move, the reading and the trade, got ${JSON.stringify(title)}`);

  // THE BAND IS SET THE MOMENT IT CHANGES, AND THE BARS REDRAW.
  const fetchesBefore = recordsFetches;
  await page.fill('#cBand', '80');
  await page.locator('#cBand').press('Tab');
  await page.waitForTimeout(500);
  expect(bandPosts.length === 1 && String(bandPosts[0]) === '80', `the new band reached the service once, got ${JSON.stringify(bandPosts)}`);
  expect(recordsFetches > fetchesBefore, 'and the bars were asked for again');
  expect(await page.inputValue('#cBand') === '80', 'the box shows what the service now holds');

  // THE TICK IS SET THE MOMENT IT CHANGES, AND THE BARS REDRAW.
  const fetchesBeforeTick = recordsFetches;
  await page.locator('#cAuto').check();
  await page.waitForTimeout(500);
  expect(autoPosts.length === 1 && autoPosts[0] === true, `the tick reached the service once, as on: ${JSON.stringify(autoPosts)}`);
  expect(bandPosts.length === 1, 'and the band was not sent again with it');
  expect(recordsFetches > fetchesBeforeTick, 'and the bars were asked for again');
  expect(await page.isChecked('#cAuto') === true, 'the tick shows what the service now holds: on');

  // THE BAR AND A ROW'S TICK ARE SET THE MOMENT THEY CHANGE, AND THE LIST REDRAWS.
  await page.fill('#cPassBar', '0');
  await page.locator('#cPassBar').press('Tab');
  await page.waitForTimeout(500);
  expect(passPosts.length === 1 && passPosts[0].bar === 0, `the bar reached the service once, got ${JSON.stringify(passPosts)}`);
  expect(await page.evaluate(() => document.querySelectorAll('table.cpassers tbody tr').length) === 1, 'at bar 0 only the 0-of-50 row is listed');
  await page.locator('input.cpass').first().uncheck();
  await page.waitForTimeout(500);
  expect(passPosts.length === 2 && passPosts[1].coin === 'AAAUSDT' && passPosts[1].shape === 'daily-3d' && passPosts[1].ticked === false, `the row's tick reached the service with its coin and shape, got ${JSON.stringify(passPosts[1])}`);

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
