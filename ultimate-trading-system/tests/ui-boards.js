// THE BOARDS TABLES HOLD STILL UNDER THEIR OWN CONTROLS, PRESSED FOR REAL
// (3.222.1; owner 2026-09-21: "why when i apply filters to the stage 2 table
// does the screen jump? can't you fix ALL of these or are you wanting me to
// report Every Single One that isn't coded properly?").
//
// The unit tests next door read the source. This presses the screen: a stage
// 3 record set is written straight into the box's own store, wide enough that
// Table 3.A and Table 3.B both page; a server is started on a spare port; a
// browser scrolls down to the tables and presses each control that belongs to
// them -- the page turns, the column sorts, a floor with Apply settings, Clear
// filters, and the section's own put-away -- reading where the page sits
// before and after each press. A press that moves the page by more than a
// couple of pixels fails, because that is exactly what the owner saw.
//
// It writes the fixture set under data/stagesets and removes it afterwards.
//   npm run test:ui:boards        (or: node tests/ui-boards.js)
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.UI_TEST_PORT || 8202);
const stages = require('../lib/stages');
const rowstore = require('../lib/rowstore');
const SETS_DIR = path.join(ROOT, 'data', 'stagesets');

function requirePlaywright() {
  for (const p of ['playwright', path.join(ROOT, 'node_modules', 'playwright')]) { try { return require(p); } catch (_) { /* next */ } }
  throw new Error('playwright is not installed');
}

// A FINISHED STAGE 3 SET WIDE ENOUGH TO PAGE: 120 settings on three coins, so
// Table 3.A holds 120 rows (two pages of 100) and Table 3.B 360 (four pages).
// The rows carry what the tally reads, shaped as tests/test-fieldstage.js
// shapes them, with the money varied so a sort visibly reorders.
const id = `s3-ui-${Date.now().toString(36)}-bd`;
const file = path.join(SETS_DIR, `${id}.json`);
const SETTINGS = 120;
const COINS = ['AAA', 'BBB', 'CCC'];
function writeFixture() {
  const doc = {
    id, stage: 3, seq: 999975, name: 'S3 #ui-boards', status: 'done', createdAt: new Date().toISOString(),
    plan: { units: COINS.length, settings: SETTINGS }, params: { nullN: 9 },
    recordsVersion: stages.RECORDS_V,
  };
  fs.mkdirSync(SETS_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(doc));
  const w = rowstore.writer(id, 'records');
  for (let si = 0; si < SETTINGS; si++) {
    const pct = 50 + (si % 5) * 10;
    const t = 41 + (si % 24) * 4;
    COINS.forEach((trade, u) => {
      const pnl = Math.round(((si * 7919) % 97) - 48 + u * 3);
      w.push({
        si, label: `count ${pct}% market t${t}h · argmax auto 24/7`,
        decision: 'argmax', bandMode: 'auto', weekdaysOnly: false,
        bandPct: 2, entry: 'market', gate: 'directional', dMult: null, tHours: t, trailMult: null, armMult: null,
        agreeRule: 'count', agreePct: pct, agreeBoth: false, agreePersist: 0,
        rung: 6, members: 8, voices: 8, pnl, trades: 4 + (si % 9),
        holdout: { pnl: Math.round(pnl / 2), trades: 3, stops: 1, vsAlwaysLong: 2 },
        beat: 5, pairs: 9, lead: ((si * 31) % 11) / 10, u, trade, ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
        confirm: 'off', field: null, fieldVerdict: null,
      });
    });
  }
  w.close();
  return doc;
}
function cleanup() {
  for (const f of [file, path.join(SETS_DIR, `${id}-tally.json.gz`), path.join(SETS_DIR, `${id}-agreed.json.gz`)]) {
    try { fs.rmSync(f, { force: true }); } catch (_) { /* gone */ }
  }
  try { rowstore.remove(id); } catch (_) { /* gone */ }
}

(async () => {
  const doc = writeFixture();
  await stages.buildTally(doc);
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const { chromium } = requirePlaywright();
  const exe = process.env.PLAYWRIGHT_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('dialog', async (d) => { errors.push(`dialog: ${d.message()}`); await d.dismiss(); });
  const fails = [];
  const expect = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  try {
    await page.addInitScript(() => { localStorage.setItem('cx-tab', 'boards'); localStorage.removeItem('cx-boards-view'); localStorage.removeItem('cx-scroll'); });
    await page.goto(`http://127.0.0.1:${PORT}/construct.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-bcoinhead]', { timeout: 30000 });
    await page.waitForTimeout(500);
    const settled = async () => {
      await page.waitForFunction(() => { const w = document.querySelector('#waitbox'); return !w || w.hidden; }, null, { timeout: 30000 });
      await page.waitForTimeout(450);   // the two frames the repaint waits for, and the put-back
    };
    const scrollY = () => page.evaluate(() => window.scrollY);
    const t3text = () => page.evaluate(() => document.querySelector('#bT3').textContent.replace(/\s+/g, ' '));
    const topOf = (sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top, sel);
    const scrollSo = async (sel, atTop) => {
      await page.evaluate(([s, a]) => { window.scrollTo(0, window.scrollY + document.querySelector(s).getBoundingClientRect().top - a); }, [sel, atTop]);
      await page.waitForTimeout(250);
    };
    // the page is long enough to move on: both tables stand and both page
    const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight * 2);
    expect(tall, 'the fixture makes a page long enough to be scrolled');
    const pageOf = async (key) => `${await page.inputValue(`#bT3 [data-bpageto="${key}"]`)} of ${await page.getAttribute(`#bT3 [data-bpageto="${key}"]`, 'data-bpages')}`;
    expect((await pageOf('S3R')) === '1 of 2' && (await pageOf('S3C')) === '1 of 4', `both tables page: ${await pageOf('S3R')}, ${await pageOf('S3C')}`);

    // A PRESS HOLDS THE PAGE STILL: read where the page sits before and after
    const press = async (what, sel, opts = {}) => {
      const el = opts.hasText ? page.locator(sel, { hasText: opts.hasText }).first() : page.locator(sel).first();
      // the control is brought onto the screen FIRST, so the click itself
      // cannot scroll to it and be read as the page moving
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      // WHAT MUST HOLD STILL IS THE CONTROL UNDER THE POINTER. On a page turn
      // to a shorter last page the table shrinks above its pager, so the page's
      // own height changes and the pager can only stay under the pointer if the
      // window scrolls with it; reading window.scrollY alone would call that a
      // jump. So the pressed control is found again after the redraw and its
      // place on the screen is what is compared.
      const before = await scrollY();
      const beforeTop = (await el.boundingBox()).y;
      const beforeText = await t3text();
      const sample = (when) => page.evaluate((w) => {
        const m = document.querySelector('#bT3'); const h = document.querySelector('[data-bcoinhead]');
        return `${w}: y=${Math.round(window.scrollY)} doc=${document.documentElement.scrollHeight} mountTop=${m ? Math.round(m.getBoundingClientRect().top + window.scrollY) : '-'} mountH=${m ? Math.round(m.getBoundingClientRect().height) : '-'} headTop=${h ? Math.round(h.getBoundingClientRect().top + window.scrollY) : '-'}`;
      }, when);
      const log = [];
      if (process.env.UI_DEBUG) log.push(await sample('before'));
      await el.click();
      if (process.env.UI_DEBUG) { for (const ms of [0, 80, 200, 400, 800, 1500]) { await page.waitForTimeout(ms); log.push(await sample(`+${ms}`)); } }
      await settled();
      if (process.env.UI_DEBUG) { log.push(await sample('settled')); console.log(`    ${what}\n      ${log.join('\n      ')}`); }
      const after = await scrollY();
      const afterText = await t3text();
      const again = opts.hasText ? page.locator(sel, { hasText: opts.hasText }).first() : page.locator(sel).first();
      const afterTop = (await again.boundingBox()).y;
      expect(Math.abs(afterTop - beforeTop) <= 2, `${what}: the control stays under the pointer (at ${beforeTop.toFixed(0)} -> ${afterTop.toFixed(0)}; the window ${before.toFixed(0)} -> ${after.toFixed(0)})`);
      if (opts.changes) expect(afterText !== beforeText, `${what}: the table changed under the press`);
      return { before, after };
    };
    // Table 3.A: scrolled so its pager is well down the screen, turn the page, sort a column
    await scrollSo('#bT3 [data-bpage^="S3R:"]', 600);
    await press('Table 3.A Next', '#bT3 button[data-bpage^="S3R:"]', { hasText: 'Next', changes: true });
    expect((await pageOf('S3R')) === '2 of 2', `Table 3.A turned to its second page: ${await pageOf('S3R')}`);
    await press('Table 3.A Prev', '#bT3 button[data-bpage^="S3R:"]', { hasText: 'Prev', changes: true });
    await press('Table 3.A column sort', '#bT3 [data-branksort]', { changes: true });
    // Table 3.B: scrolled so its heading line sits a third of the way down
    await scrollSo('[data-bcoinhead]', 300);
    await press('Table 3.B Next', '#bT3 button[data-bpage^="S3C:"]', { hasText: 'Next', changes: true });
    expect((await pageOf('S3C')) === '2 of 4', `Table 3.B turned to its second page: ${await pageOf('S3C')}`);
    await press('Table 3.B column sort', '#bT3 [data-bcoinsort]', { changes: true });
    // a floor typed and put on with Apply settings, then Clear filters
    const box = page.locator('#bT3 [data-bfilter="S3C:minTestTrades"]');
    expect(await box.count() === 1, 'Table 3.B has its test trades floor');
    await box.fill('9');
    await box.dispatchEvent('input');
    await page.waitForTimeout(150);
    expect(!(await page.locator('#bT3 [data-bapply="S3C"]').isDisabled()), 'Apply settings wakes when a box changes');
    await press('Table 3.B Apply settings', '#bT3 [data-bapply="S3C"]', { changes: true });
    await press('Table 3.B Clear filters', '#bT3 [data-bfilterclear="S3C"]', { changes: true });
    // SHOW IN 3.B opens every coin's records, and CLOSE ALL RECORDS closes them again (3.231.0)
    expect(await page.locator('#bT3 [data-brecclose="S3C"]').isDisabled(), 'Close all records is dead while nothing is open');
    // Show in 3.B brings Table 3.B onto the screen on purpose, so it is pressed
    // plainly rather than held to the stays-under-the-pointer rule
    await scrollSo('#bT3 [data-bpin3b]', 300);
    await page.locator('#bT3 [data-bpin3b]').first().click();
    await settled();
    const openRows = () => page.evaluate(() => document.querySelectorAll('#bT3 tr[data-bkey] + tr:not([data-bkey])').length);
    expect((await openRows()) > 0, `Show in 3.B opened the coins' records (${await openRows()} open)`);
    expect(!(await page.locator('#bT3 [data-brecclose="S3C"]').isDisabled()), 'Close all records wakes once rows are open');
    await scrollSo('#bT3 [data-brecclose="S3C"]', 300);
    await press('Close all records', '#bT3 [data-brecclose="S3C"]', { changes: true });
    expect((await openRows()) === 0, `Close all records closed every open row (${await openRows()} still open)`);
    expect(await page.locator('#bT3 [data-brecclose="S3C"]').isDisabled(), 'and it is dead again');
    expect((await page.locator('#bT3 [data-bunpin3b]').count()) === 1, 'the pinned setting and Revert filters are left as they were: closing the rows is not reverting the filters');
    // and Table 3.A's floor the same way
    await scrollSo('#bT3 [data-bapply="S3R"]', 500);
    const rbox = page.locator('#bT3 input[data-bfilter^="S3R:"][type="number"]').first();
    await rbox.fill('1');
    await rbox.dispatchEvent('input');
    await page.waitForTimeout(150);
    await press('Table 3.A Apply settings', '#bT3 [data-bapply="S3R"]');
    await press('Table 3.A Clear filters', '#bT3 [data-bfilterclear="S3R"]');
    // THE SECTION'S OWN PUT-AWAY redraws the page and holds its button still
    // (a put-away page is short, so the button can only be held as still as the
    // page's own length allows: it must stay on the screen, and come back to
    // exactly where it was once the table is open again)
    await scrollSo('[data-bfold="3"]', 200);
    const foldTop = await topOf('[data-bfold="3"]');
    await page.locator('[data-bfold="3"]').click();
    await settled();
    const putAwayTop = await topOf('[data-bfold="3"]');
    expect(putAwayTop >= 0 && putAwayTop < 900, `put away: the button stays on the screen (${foldTop.toFixed(0)} -> ${putAwayTop.toFixed(0)})`);
    await page.locator('[data-bfold="3"]').click();
    await settled();
    expect(Math.abs((await topOf('[data-bfold="3"]')) - putAwayTop) <= 2, `open again: the button stays under the pointer (${putAwayTop.toFixed(0)} -> ${(await topOf('[data-bfold="3"]')).toFixed(0)})`);
    expect(await page.locator('[data-bcoinhead]').count() === 1, 'the table is back after opening');
    expect(errors.length === 0, `no page errors or dialogs: ${errors.join(' | ')}`);
  } catch (err) {
    fails.push(`threw: ${err.stack || err}`);
    console.log(`FAIL threw: ${err.message}`);
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
    cleanup();
  }
  console.log(fails.length ? `\n${fails.length} press(es) moved the page or failed` : '\nevery press left the page where it was');
  process.exit(fails.length ? 1 : 0);
})();
