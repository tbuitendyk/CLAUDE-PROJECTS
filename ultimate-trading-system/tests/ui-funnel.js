// THE FUNNEL, PRESSED FOR REAL (3.51.1). The unit tests read the source; this
// drives the page in a browser against canned service answers -- and, for the
// step that broke, the box's own answer for t on XRP -- and presses what the
// owner pressed: narrow gate, keep directional, back to step 1, narrow t.
// Needs a browser: `npm run test:ui:funnel`. Starts the service on a spare
// port with this checkout's data and never writes anything.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.UI_TEST_PORT || 8199);
const SET = 's3-ui-funnel';
const UNIT = 'XRPUSDT|||weekly-8d';
const REAL_THOURS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'funnel-step2-thours.json'), 'utf8'));
const dials = ['gate', 'tHours', 'dMult', 'entry'];
function reply(body) {
  const rule = body.rule || {};
  const gateFixed = Array.isArray((rule.allowed || {}).gate);
  const base = {
    step: body.step, set: { id: SET, name: 'S3 #ui', noiseTwin: { available: true, kept: 20 }, keptScrambles: 20, sealed: { sealed: true, units: [{}] } },
    unit: UNIT, unitName: 'XRPUSDT weekly-8d', units: [{ key: UNIT, name: 'XRPUSDT weekly-8d' }],
    survivors: gateFixed ? 141120 : 275520, of: 275520, target: body.target || null,
    check: { kind: 'scrambles', k: 20, barPct: 75, bar: 15, chance: 0.28 },
    conditions: {}, ruleSentence: gateFixed ? 'gate is directional' : 'nothing yet',
  };
  if (body.step === 1) {
    return { ...base, reading: { dials: dials.map((d, i) => ({ dial: d, m: 0.5 - i * 0.1, range: 10 - i, values: [1, 2, 3], balance: { even: 1, balanced: true } })),
      counts: { gate: true, tHours: true, dMult: false, entry: true }, beating: Object.fromEntries(dials.map((d) => [d, { n: 1, of: 3 }])),
      honesty: { clear: 10, of: 46, byChance: 13 }, splitHalf: { a: ['gate', 'tHours'], b: ['gate', 'tHours'], agrees: true }, lopsided: [], skipped: [] } };
  }
  if (body.step === 2) {
    const dial = body.dial || null;
    if (dial === 'gate' && gateFixed) return { ...base, reading: { why: 'only one value of this dial is left on this board, so there is no shape to read - pick another dial' } };
    if (dial === 'gate') return { ...base, reading: { groups: [{ value: 'active', n: 100 }, { value: 'directional', n: 175 }], shape: 'flat', splitHalf: { a: 'flat', b: 'flat', agrees: true },
      rec: { dial: 'gate', kind: 'scrambles', ordered: false, values: [{ value: 'active', counts: false, check: [1, 2], beaten: 0 }, { value: 'directional', counts: true, check: [1, 2], beaten: 2 }], recommend: { values: ['directional'] } } } };
    if (dial === 'tHours') return { ...REAL_THOURS, set: { ...REAL_THOURS.set, id: SET, name: 'S3 #ui' } };
    // d: a dial some settings have no value for (market entries), so step 2
    // offers the also keep none tick (3.53.0)
    if (dial === 'dMult') {
      const groups = [{ value: '0.25', n: 40, mean: -1 }, { value: '0.5', n: 40, mean: 2 }, { value: '1', n: 40, mean: 3 }, { value: '2', n: 40, mean: 2.5 }, { value: 'none', n: 15, mean: 1 }];
      return { ...base, reading: { groups, shape: 'hill', splitHalf: { a: 'hill', b: 'hill', agrees: true },
        rec: { dial: 'dMult', kind: 'scrambles', ordered: true, values: groups.map((g) => ({ value: g.value, counts: g.value !== '0.25', check: [0, 1], beaten: g.value !== '0.25' ? 2 : 0, lead: 1 })), recommend: { min: 0.5, max: 2, n: 120 } } } };
    }
    return { ...base, reading: { why: 'pick a dial' } };
  }
  // step 3 before the grid is read: the two dial boxes and the read button
  if (body.step === 3) return { ...base, reading: {} };
  return { ...base, reading: { why: 'not canned' } };
}
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
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('dialog', async (d) => { errors.push(`dialog: ${d.message()}`); await d.dismiss(); });
  const posted = [];                       // every read the page asked for, so what it wrote into the rule can be checked
  await page.route('**/api/funnel/**', async (route) => {
    const req = route.request();
    if (req.url().endsWith('/read')) { const body = JSON.parse(req.postData() || '{}'); posted.push(body); return route.fulfill({ contentType: 'application/json', body: JSON.stringify(reply(body)) }); }
    return route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await page.addInitScript(({ set }) => { localStorage.setItem('cx-tab', 'funnel'); localStorage.setItem('cx-boards-view', JSON.stringify({ s3: set })); }, { set: SET });
  await page.goto(`http://127.0.0.1:${PORT}/construct.html`, { waitUntil: 'domcontentloaded' });
  const fails = [];
  const expect = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const heading = async () => (await page.locator('#view h3').allTextContents()).join(' | ');
  await page.waitForSelector('[data-fnarrow]', { timeout: 15000 });
  expect(/Step 1/.test(await heading()), 'the walk opens on step 1');
  await page.locator('[data-fnarrow="gate"]').click();
  await page.waitForSelector('#fKeepValues', { timeout: 15000 });
  expect(await page.locator('#fDial').count() === 1, 'narrow this one on gate opens step 2 with the dial box');
  // every dial in the box carries its Sweep name (3.52.0)
  const dialWords = await page.locator('#fDial option').allTextContents();
  expect(dialWords.includes('tHours (t)') && dialWords.includes('dMult (d)') && dialWords.includes('gate'), `the dial box names its dials with their Sweep labels: ${dialWords.join(' | ')}`);
  // the count line follows the ticks (3.52.0): directional alone keeps 175,
  // both keep 275, none keeps 0
  const keeps = async () => (await page.locator('#fKeepCount').innerText()).trim();
  await page.locator('[data-fval="directional"]').check();
  await page.locator('[data-fval="active"]').check();
  expect(/^keeps 275 of 275/.test(await keeps()), `ticking active too moves the count to both values: ${await keeps()}`);
  await page.locator('[data-fval="active"]').uncheck();
  expect(/^keeps 175 of 275/.test(await keeps()), `unticking it moves the count back: ${await keeps()}`);
  await page.locator('#fKeepValues').click();
  await page.waitForTimeout(800);
  expect(/Step 2/.test(await heading()) && await page.locator('#fDial').count() === 1, 'after keep these values, step 2 still has its dial box');
  expect(/pick another dial/.test(await page.locator('#view').innerText()), 'and says the dial is fixed and what to do');
  await page.locator('[data-fstep="1"]').click();
  await page.waitForSelector('[data-fnarrow="tHours"]', { timeout: 15000 });
  await page.locator('[data-fnarrow="tHours"]').click();
  await page.waitForSelector('#fAddRange', { timeout: 15000 }).catch(() => {});
  expect(/Step 2/.test(await heading()) && await page.locator('#fAddRange').count() === 1, "narrow this one on t opens step 2 with the box's own answer, range boxes and all");
  expect(/gate is directional/.test(await page.locator('#view').innerText()), 'the rule sentence reads gate once, not "gate (gate)"');
  expect(await page.locator('#fAlsoNone').count() === 0, 't has no none row, so no also keep none tick');
  // d has a none row: the tick is there, the count follows it, and pressing
  // add this range writes "or none" into the rule (3.53.0)
  await page.locator('[data-fstep="1"]').click();
  await page.waitForSelector('[data-fnarrow="dMult"]', { timeout: 15000 });
  await page.locator('[data-fnarrow="dMult"]').click();
  await page.waitForSelector('#fAlsoNone', { timeout: 15000 }).catch(() => {});
  expect(await page.locator('#fAlsoNone').count() === 1, 'd has a none row, so step 2 offers also keep none');
  const keepsD = async () => (await page.locator('#fKeepCount').innerText()).trim();
  expect(/^keeps 120 of 175/.test(await keepsD()), `the recommended range 0.5 to 2 keeps 120: ${await keepsD()}`);
  await page.locator('#fAlsoNone').check();
  expect(/^keeps 135 of 175/.test(await keepsD()), `ticking also keep none adds the 15 with no d: ${await keepsD()}`);
  await page.locator('#fMax').fill('');
  await page.locator('#fMax').dispatchEvent('input');
  expect(/^keeps 135 of 175/.test(await keepsD()), `0.5 or more, or none, keeps everything but 0.25: ${await keepsD()}`);
  const before = posted.length;
  await page.locator('#fAddRange').click();
  await page.waitForTimeout(800);
  const wrote = posted.slice(before).map((b) => ((b.rule || {}).ranges || {}).dMult).filter(Boolean).pop();
  expect(JSON.stringify(wrote) === JSON.stringify({ min: 0.5, max: null, also: ['none'] }), `the rule carries 0.5 or more, or none: ${JSON.stringify(wrote)}`);
  await page.locator('[data-fstep="3"]').click().catch(() => {});
  await page.waitForSelector('#fA', { timeout: 15000 }).catch(() => {});
  const aWords = await page.locator('#fA option').allTextContents().catch(() => []);
  expect(aWords.includes('dMult (d)') && aWords.includes('agreePct (share)'), `the first dial box on step 3 names its dials with their Sweep labels: ${aWords.join(' | ')}`);
  expect(errors.length === 0, `no page errors and no dialogs${errors.length ? `: ${errors.join('; ')}` : ''}`);
  await browser.close();
  srv.kill();
  console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nthe Funnel, pressed for real: all passed');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.log('HARNESS FAILED:', e.message); process.exit(1); });
