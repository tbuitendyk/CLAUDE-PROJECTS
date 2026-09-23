// TABLE 3.C: EVERY UNIT, DRAWN AND PRESSED FOR REAL (3.230.0, owner order
// 2026-09-22: one row per coin and shape, one line each, filter and
// single-column sort on every reading, the filter stored on the record set
// and read by the Funnel).
//
// The unit tests next door read the source and the arithmetic. This presses
// the screen: a stage 3 record set is written into the box's own store (three
// coins and shapes, one priced under a gate, two with the rebuilt numbers), a
// server is started on a spare port, and a browser opens Boards on it, waits
// for the table to be worked out in the background, reads its shape -- one
// line a row, every heading with a sort mark, a filter box per column, the
// table no wider than its panel -- presses a sort, applies a floor, reads the
// filter back off the record set, opens the Funnel and reads what its coin box
// offers under that filter, and clears the filter again. Screenshots of the
// table at two widths land in the scratchpad named on UI_SHOTS, for a reader.
//
// It writes the fixture set under data/stagesets and removes it afterwards.
//   node tests/ui-units.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.UI_TEST_PORT || 8206);
const stages = require('../lib/stages');
const rowstore = require('../lib/rowstore');
const SETS_DIR = path.join(ROOT, 'data', 'stagesets');
const SHOTS = process.env.UI_SHOTS || null;

function requirePlaywright() {
  for (const p of ['playwright', path.join(ROOT, 'node_modules', 'playwright')]) { try { return require(p); } catch (_) { /* next */ } }
  throw new Error('playwright is not installed');
}

const id = `s3-ui-${Date.now().toString(36)}-u3c`;
const file = path.join(SETS_DIR, `${id}.json`);
const SETTINGS = 40;
const UNITS = [
  { u: 0, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-1d' },
  { u: 1, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-2d' },
  { u: 2, trade: 'BBB', ctx1: 'AAA', ctx2: null, size: 2, geometry: 'daily-1d' },
  { u: 3, trade: 'CCC', ctx1: 'AAA', ctx2: 'BBB', size: 3, geometry: 'weekly-8d' },
];
const keys = UNITS.map((u) => stages.unitKeyOf(u));
function writeFixture() {
  const doc = {
    id, stage: 3, seq: 999976, name: 'S3 #ui-units', status: 'done', createdAt: new Date().toISOString(),
    plan: { units: UNITS.length, settings: SETTINGS }, params: { engineVersion: require('../package.json').version, nullN: 10, keepN: 10 },
    boardNull: { captured: true, kept: 10 }, recordsVersion: stages.RECORDS_V,
    windows: { units: Object.fromEntries(keys.map((k, i) => [k, { test: { chunks: i === 3 ? 48 : 360 } }])) },
  };
  fs.mkdirSync(SETS_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(doc));
  const gate = { read: 'certainty', agreeMin: 40, certMin: 70, rule: 'both', signOnly: false, rungs: '70:0.75,80:1', silent: 1 };
  const w = rowstore.writer(id, 'records');
  const per = new Map();
  for (let si = 0; si < SETTINGS; si++) {
    const pct = 50 + (si % 5) * 10;
    const t = 41 + (si % 6) * 24;
    const label = `count ${pct}% market t${t}h · argmax auto 24/7`;
    const entry = { label, units: [] };
    UNITS.forEach((u) => {
      const pnl = Math.round((((si * 7919) % 97) - 48 + u.u * 9) * 100) / 100;
      const placed = 4 + (si % 9);
      w.push({
        si, label, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false,
        bandPct: 2, entry: 'market', gate: 'directional', dMult: null, tHours: t, trailMult: null, armMult: null,
        agreeRule: 'count', agreePct: pct, agreeBoth: false, agreePersist: 0,
        rung: 6, members: 8, voices: 8, pnl, trades: placed,
        holdout: { pnl: Math.round(pnl / 2), trades: 3, stops: 1, vsAlwaysLong: 2 },
        beat: 5, pairs: 9, lead: ((si * 31) % 11) / 10,
        noiseTest: Array.from({ length: 10 }, (_, d) => pnl - 3 + d * 0.7), noiseHold: Array.from({ length: 10 }, () => pnl / 2),
        confirm: 'off',
        field: u.u === 0 ? { ...gate, test: { pnl, trades: placed, size: placed, at1: pnl - 2, blockedAt1: -1.5, blockedN: 2, placed, blockedSign: 1, blockedMin: 1, silent: 0, readSum: 70 * placed, readN: placed }, hold: null } : null,
        fieldVerdict: null,
        ...u,
      });
      if (u.u < 2) entry.units.push({ ...u, rich: { test: { maxDrawdown: 20 + (si % 7) * 5, wins: Math.floor(placed / 2), pnlThirds: [pnl / 3 + 1, pnl / 3, pnl / 3 - 1 + u.u] } } });
    });
    per.set(label, entry);
  }
  w.close();
  return { doc, per };
}
function cleanup() {
  for (const f of [file, path.join(SETS_DIR, `${id}-tally.json.gz`), path.join(SETS_DIR, `${id}-agreed.json.gz`), stages.unitsFile(id)]) {
    try { fs.rmSync(f, { force: true }); } catch (_) { /* gone */ }
  }
  try { fs.rmSync(stages.funnelRichDir(id), { recursive: true, force: true }); } catch (_) { /* gone */ }
  try { rowstore.remove(id); } catch (_) { /* gone */ }
}

(async () => {
  const { doc, per } = writeFixture();
  await stages.buildTally(doc);
  stages.saveFunnelRich(id, per, { [keys[0]]: { 'all|41': { alwaysLong: 3, alwaysShort: -3, buyHold: 4, shortHold: -4 } } });
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const { chromium } = requirePlaywright();
  const exe = process.env.PLAYWRIGHT_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const errors = [];
  const fails = [];
  const expect = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  try {
    for (const width of [1920, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
      page.on('dialog', async (d) => { errors.push(`dialog: ${d.message()}`); await d.dismiss(); });
      // ONCE PER PAGE, not on every reload: the Funnel step below sets the tab
      // itself and reloads, and a start-up script that ran again would put it
      // straight back on Boards
      await page.addInitScript((setId) => {
        if (localStorage.getItem('ui-units-started')) return;
        localStorage.setItem('ui-units-started', '1');
        localStorage.setItem('cx-tab', 'boards');
        localStorage.setItem('cx-boards-view', JSON.stringify({ s3: setId, fold1: true, fold2: true, fold3: true }));
        localStorage.removeItem('cx-scroll');
      }, id);
      await page.goto(`http://127.0.0.1:${PORT}/construct.html`, { waitUntil: 'domcontentloaded' });
      // the table is worked out in the background and the page asks again until it lands
      await page.waitForSelector('[data-bunithead]', { timeout: 90000 });
      await page.waitForTimeout(600);
      const shape = await page.evaluate(() => {
        const head = document.querySelector('[data-bunithead]');
        const table = head.closest('table');
        const panel = table.closest('.panel');
        const scroller = table.closest('.scrollx');
        const ths = [...head.querySelectorAll('th')];
        const trs = [...table.querySelectorAll('tbody tr')];
        const one = trs[0] ? trs[0].querySelector('td') : null;
        const lineH = one ? parseFloat(getComputedStyle(one).lineHeight) : 0;
        const boxes = [...document.querySelectorAll('[data-bfilter^="S3U:"]')];
        const grid = boxes[0] ? boxes[0].closest('.filters') : null;
        const stats = grid ? grid.querySelectorAll('.fstat').length : 0;
        return {
          cols: ths.length,
          headings: ths.map((th) => th.textContent.replace(/[·↓↑]/g, '').trim()),
          sortMarks: ths.filter((th) => th.querySelector('.bsort button')).length,
          rows: trs.length,
          rowHeights: trs.map((tr) => Math.round(tr.getBoundingClientRect().height)),
          lineH,
          tableW: Math.round(table.getBoundingClientRect().width),
          panelW: Math.round(panel.getBoundingClientRect().width),
          scrollerW: scroller ? Math.round(scroller.clientWidth) : null,
          boxes: boxes.length,
          stats,
          firstCell: one ? one.textContent.trim() : null,
          cells: trs[0] ? [...trs[0].querySelectorAll('td')].map((td) => td.textContent.trim()) : [],
        };
      });
      console.log(`  ${width}px: ${shape.cols} columns, ${shape.rows} rows, table ${shape.tableW}px in a ${shape.panelW}px panel, row heights ${[...new Set(shape.rowHeights)].join('/')}px, line ${shape.lineH}px`);
      console.log(`  first row: ${shape.cells.join(' | ')}`);
      expect(shape.cols === 27, `the table has the name column and 26 readings (${shape.cols})`);
      expect(shape.sortMarks === 27, `every heading carries a sort mark (${shape.sortMarks} of ${shape.cols})`);
      expect(shape.headings.includes('settings in the money over the whole test window') && shape.headings.includes('losing in all three parts') && shape.headings.includes('beat the best of the four, %') && !shape.headings.includes('best 30 beat copies'),
        `the headings are the owner's: ${shape.headings.join(' | ')}`);
      expect(/^\d[\d,]* \d+\.\d%$/.test(shape.cells[2]), `settings in the money over the whole test window prints the count and the share: ${shape.cells[2]}`);
      expect(shape.rows === UNITS.length, `one row per coin and shape (${shape.rows})`);
      const tallest = Math.max(...shape.rowHeights);
      // a one-line row on these tables is 24px; two lines would be 40 or more
      expect(tallest <= 32, `every row is one line (tallest ${tallest}px)`);
      expect(shape.boxes === 26 && shape.stats === 26 * 4, `a filter box per reading with its four numbers (${shape.boxes} boxes, ${shape.stats} numbers)`);
      expect(shape.firstCell === 'AAA Daily 1-day' || /^AAA /.test(shape.firstCell), `the name cell names the coin and the shape on one line: ${shape.firstCell}`);
      expect(shape.cells[3] && shape.cells[4] && shape.cells[3] !== shape.cells[4], `the gated coin reads different money with and without the gate: ${shape.cells[3]} / ${shape.cells[4]}`);
      if (width === 1920) expect(shape.tableW <= shape.panelW, `at ${width} the table fits its panel (${shape.tableW} of ${shape.panelW}px)`);
      else console.log(`  at ${width} the table is ${shape.tableW}px in a ${shape.panelW}px panel${shape.tableW > shape.panelW ? ' - it scrolls sideways inside its own box' : ''}`);
      if (SHOTS) {
        const sec = await page.$('[data-bunithead]');
        await sec.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        const box = await page.evaluate(() => {
          const head = document.querySelector('[data-bunithead]');
          const grid = document.querySelector('[data-bfilter^="S3U:"]').closest('.filters');
          const top = grid.getBoundingClientRect().top - 60;
          const bottom = head.closest('table').getBoundingClientRect().bottom + 60;
          return { top: Math.max(0, top + window.scrollY), height: bottom - top };
        });
        await page.screenshot({ path: path.join(SHOTS, `units-${width}.png`), fullPage: true, clip: { x: 0, y: box.top, width, height: Math.min(box.height, 1400) } });
        console.log(`  screenshot: ${path.join(SHOTS, `units-${width}.png`)}`);
      }
      if (width === 1920) {
        // A SORT REORDERS THE ROWS and holds the page still
        const order = () => page.evaluate(() => [...document.querySelectorAll('[data-bunithead]')[0].closest('table').querySelectorAll('tbody tr td:first-child')].map((td) => td.textContent.trim()));
        const before = await order();
        const btn = page.locator('[data-bunitsort="avgTest"]').first();
        await btn.scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const y0 = await page.evaluate(() => window.scrollY);
        await btn.click();
        await page.waitForFunction(() => { const w = document.querySelector('#waitbox'); return !w || w.hidden; }, null, { timeout: 30000 });
        await page.waitForTimeout(500);
        const after = await order();
        const y1 = await page.evaluate(() => window.scrollY);
        expect(JSON.stringify(after) !== JSON.stringify(before), `one click on avg test $ reorders the rows: ${after.join(', ')}`);
        expect(Math.abs(y1 - y0) < 3, `the sort holds the page still (${y0} -> ${y1})`);
        // A FLOOR, APPLIED, SAVES ON THE RECORD SET AND CUTS THE TABLE
        const box = page.locator('[data-bfilter="S3U:minAvgTest"]');
        await box.scrollIntoViewIfNeeded();
        await box.fill('0');
        await page.locator('[data-bapply="S3U"]').click();
        await page.waitForFunction(() => { const w = document.querySelector('#waitbox'); return !w || w.hidden; }, null, { timeout: 30000 });
        await page.waitForTimeout(600);
        const saved = stages.getSet(id).unitFilter;
        expect(saved && saved.minAvgTest === '0', `Apply settings saves the floor on the record set: ${JSON.stringify(saved)}`);
        const cut = await order();
        const kept = stages.keptUnitKeys(id, stages.readTally(id));
        expect(cut.length === kept.kept.size && cut.length < UNITS.length, `the table shows the ${kept.kept.size} coins and shapes the floor keeps (${cut.length} rows)`);
        const shown = await page.evaluate(() => (document.querySelector('[data-bunithead]').closest('.panel').textContent.match(/\d+ of \d+ rows — the rest are held back by the filters above\./) || [])[0] || '');
        expect(/rows — the rest are held back/.test(shown), `the line under the table owns up to the cut: ${shown}`);
        // THE FUNNEL READS THE FILTER: its coin box offers only the kept coins, and says so
        await page.evaluate(() => { localStorage.setItem('cx-tab', 'funnel'); });
        await page.reload({ waitUntil: 'domcontentloaded' });
        try {
          await page.waitForSelector('#fUnit', { timeout: 60000 });
        } catch (err) {
          const text = await page.evaluate(() => (document.querySelector('#view') || document.body).innerText.slice(0, 1200));
          throw new Error(`the Funnel never drew its coin box under the filter. Errors so far: ${errors.join(' | ') || 'none'}. The screen says: ${text}`);
        }
        await page.waitForTimeout(800);
        const offered = await page.evaluate(() => [...document.querySelectorAll('#fUnit option')].map((o) => o.textContent));
        const keptCoins = new Set([...kept.kept].map((k) => k.split('|')[0]));
        expect(offered.length === keptCoins.size + 1 && offered.slice(1).every((c) => keptCoins.has(c)), `the coin box offers all units together and the kept coins alone: ${offered.join(', ')}`);
        const note = await page.evaluate(() => (document.body.textContent.replace(/\s+/g, ' ').match(/the filter on Table 3\.C keeps \d+ of \d+ coins and shapes/) || [])[0] || '');
        expect(/keeps \d+ of 4 coins and shapes/.test(note), `the line under the coin box says what the filter keeps: ${note}`);
        if (SHOTS) {
          await page.screenshot({ path: path.join(SHOTS, `funnel-filtered-${width}.png`), fullPage: false });
          console.log(`  screenshot: ${path.join(SHOTS, `funnel-filtered-${width}.png`)}`);
        }
        // CLEAR FILTERS PUTS EVERY COIN AND SHAPE BACK, on the set too
        await page.evaluate(() => { localStorage.setItem('cx-tab', 'boards'); });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-bunithead]', { timeout: 90000 });
        const clear = page.locator('[data-bfilterclear="S3U"]');
        await clear.scrollIntoViewIfNeeded();
        await clear.click();
        await page.waitForFunction(() => { const w = document.querySelector('#waitbox'); return !w || w.hidden; }, null, { timeout: 30000 });
        await page.waitForTimeout(600);
        expect(stages.getSet(id).unitFilter == null, `Clear filters clears the record set's filter too: ${JSON.stringify(stages.getSet(id).unitFilter)}`);
        expect((await order()).length === UNITS.length, 'and every coin and shape is back');
      }
      await page.close();
    }
  } finally {
    await browser.close();
    srv.kill();
    cleanup();
  }
  for (const e of errors) console.log(`FAIL ${e}`);
  if (errors.length) fails.push(...errors);
  console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nall checks passed');
  process.exit(fails.length ? 1 : 0);
})().catch((err) => { console.error(err); cleanup(); process.exit(1); });
