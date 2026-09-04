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
// THE STAGE 4 RECORD SETS OF THIS COIN AND SHAPE (3.58.0). Empty until the
// second half of the run turns them on, so the first half proves the other half
// of the owner's order: with none cut, the seven steps are what is drawn.
let CUTS = [];
const CUT = { id: 's4-ui-1', seq: 1, name: 'S4 #1 - XRPUSDT weekly-8d', createdAt: '2026-09-04T10:00:00Z',
  survivors: 116, target: 400,
  // the rule this set wrote, in the same words the walk says its own: it is how
  // `new rule` knows the walk on hand is the one that was already cut (3.59.0)
  ruleSentence: 'gate is directional' };
function cutRows(q) {
  const rows = [];
  for (let i = 0; i < 40; i++) {          // enough to overflow the box and prove it scrolls
    rows.push({ si: i, label: `q1 directional t${65 + i * 24} · argmax auto 24/7`, tHours: 65 + i * 24, gate: 'directional',
      avgTest: 8.4 - i, avgHold: 2.1 - i * 0.5, avgTrades: 24 - i, avgVsLong: 1.2, beat: 19, pairs: 20, avgLead: 2.1,
      maxDrawdown: 12 + i, worstTrade: -3.2, bestTrade: 9.1, wins: 14, stops: 3, grossPerTrade: 0.42,
      pnlThirds: [2, 3, 3.4], members: 8, avgRung: 3, avgVoices: 5 });
  }
  const on = ['label', 'tHours', 'avgTest', 'avgHold', 'avgTrades', 'avgVsLong', 'beat', 'pairs', 'avgLead',
    'maxDrawdown', 'worstTrade', 'bestTrade', 'wins', 'stops', 'grossPerTrade', 'pnlThirds', 'members', 'avgRung', 'avgVoices'];
  return {
    set: { ...CUT, unit: UNIT, unitName: 'XRPUSDT weekly-8d', parent: { id: SET, name: 'S3 #ui' }, release: '3.58.0',
      rule: {}, ruleSentence: 'tHours 65 to 137; gate is directional', nameEditedAt: null,
      closing: { key: 'rule', label: 'accept what the rule gives', detail: null },
      warnings: [], check: { kind: 'scrambles', k: 20, barPct: 90, bar: 18, chance: 0.14 },
      steps: 21, backSteps: 5, marks: [], replayChecked: { same: true },
      // the rule the OWNER built, before step 5 replaced it (3.61.0)
      userSentence: 'tHours 65 to 137; gate is directional; agreeBar is all or own',
      userSurvivors: 4820, userStamped: true },
    of: 137760, sealedOn: { sealed: true, of: 1, missing: 0, why: null },
    record: { same: true, now: 116, had: 116, gone: 0 },
    varying: ['tHours'], fixed: { gate: 'directional', decision: 'argmax' },
    has: Object.fromEntries(on.map((k) => [k, true])),
    total: 116, from: 0, per: 2000, clipped: 0,
    sort: q.get('sort') || 'avgTest', dir: q.get('dir') || 'desc', rows,
  };
}
function reply(body) {
  const rule = body.rule || {};
  const gateFixed = Array.isArray((rule.allowed || {}).gate);
  const base = {
    step: body.step, set: { id: SET, name: 'S3 #ui', noiseTwin: { available: true, kept: 20 }, keptScrambles: 20, sealed: { sealed: true, units: [{}] } },
    unit: UNIT, unitName: 'XRPUSDT weekly-8d', units: [{ key: UNIT, name: 'XRPUSDT weekly-8d' }],
    survivors: gateFixed ? 141120 : 275520, of: 275520, target: body.target || null,
    check: { kind: 'scrambles', k: 20, barPct: 75, bar: 15, chance: 0.28 },
    conditions: {}, ruleSentence: gateFixed ? 'gate is directional' : 'nothing yet',
    cuts: CUTS,
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
  // step 3 with two dials named: a small grid with two scrambled copies, so
  // both check grids can be read off the page (3.54.0)
  if (body.step === 3 && body.dialA && body.dialB) {
    const cell = (a, b, mean, n) => ({ a, b, mean, n, thin: false });
    const A = ['all', 'own']; const B = ['10', '20'];
    return { ...base, reading: {
      dialA: body.dialA, dialB: body.dialB, aVals: A, bVals: B, thin: 0, squares: 4, floorCost: [{ floor: 1, keeps: 4, of: 4 }],
      grid: [cell('all', '10', 5, 100), cell('all', '20', 3, 100), cell('own', '10', 7, 100), cell('own', '20', 4, 100)],
      checkGrids: [{ grid: [cell('all', '10', 1, 100), cell('all', '20', 2, 100), cell('own', '10', 3, 100), cell('own', '20', 4, 100)] },
        { grid: [cell('all', '10', 3, 100), cell('all', '20', 0, 100), cell('own', '10', 1, 100), cell('own', '20', 6, 100)] }],
      noise: { kind: 'scrambles' },
      block: { counting: ['all|10', 'own|10'], beaten: { 'all|10': { won: 2, of: 2 }, 'all|20': { won: 1, of: 2 }, 'own|10': { won: 2, of: 2 }, 'own|20': { won: 0, of: 2 } },
        block: { a: { from: 'all', to: 'own' }, b: { from: '10', to: '10' }, squares: 2, lead: 1.4 } },
    } };
  }
  if (body.step === 3) return { ...base, reading: {} };
  // step 6: the numbers a sweep does not keep, with the exposure the two
  // limits are limits on (3.57.0)
  if (body.step === 6) {
    const day = 86400000; const from = Date.UTC(2025, 5, 2);
    return { ...base, rebuilt: true, reading: { rebuilt: true,
      exposure: { stake: 100, coins: 2, units: 2, mostAtOnce: 700, holdHours: 137,
        perUnit: [{ name: 'XRPUSDT weekly-8d', geometry: 'weekly-8d', stepHours: 168, atOnce: 1, mostAtOnce: 100 },
          { name: 'BTCUSDT daily-4d', geometry: 'daily-4d', stepHours: 24, atOnce: 6, mostAtOnce: 600 }],
        window: { fromTs: from, toTs: from + 140 * day, days: 140, weeks: 20, perYearFactor: 365.25 / 140 }, why: null },
      ladders: { maxDrawdown: { field: 'maxDrawdown', dir: 'max', of: 40, measured: 40, rungs: [{ at: 12, keeps: 10 }, { at: 30, keeps: 40 }] },
        avgTrades: { field: 'avgTrades', dir: 'min', of: 40, measured: 40, rungs: [{ at: 6, keeps: 40 }, { at: 20, keeps: 12 }] } } } };
  }
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
  // A REAL DESKTOP WINDOW. The default 1280x720 is shorter than this screen's
  // own heading, so the box can only ever start below the fold there and
  // "does it end inside the window" is unanswerable (3.60.0).
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('dialog', async (d) => { errors.push(`dialog: ${d.message()}`); await d.dismiss(); });
  const posted = [];                       // every read the page asked for, so what it wrote into the rule can be checked
  const rowsAsked = [];                    // every ask for a Stage 4 set's rows, so sorting and paging can be checked
  const renamed = [];                      // the one write this screen is allowed to make
  await page.route('**/api/stageset/*/name', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    renamed.push({ url: route.request().url(), name: body.name });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ name: body.name, nameEditedAt: '2026-09-04T12:00:00Z' }) });
  });
  await page.route('**/api/funnel/**', async (route) => {
    const req = route.request();
    if (req.url().endsWith('/read')) { const body = JSON.parse(req.postData() || '{}'); posted.push(body); return route.fulfill({ contentType: 'application/json', body: JSON.stringify(reply(body)) }); }
    if (/\/rows(\?|$)/.test(req.url())) {
      const q = new URL(req.url()).searchParams;
      rowsAsked.push(Object.fromEntries(q));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(cutRows(q)) });
    }
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
  // every clause under The rule so far has its own remove (3.55.0)
  const clauseText = await page.locator('ul.frule').innerText().catch(() => '');
  expect(/dMult \(d\) 0\.5 or more or none/.test(clauseText) && /gate is directional/.test(clauseText), `the rule box lists each clause: ${clauseText.replace(/\n/g, ' | ')}`);
  const beforeRm = posted.length;
  await page.locator('[data-frm="ranges|dMult"]').click();
  await page.waitForTimeout(800);
  const afterRm = posted.slice(beforeRm).map((b) => (b.rule || {}).ranges || {}).pop();
  expect(afterRm && !('dMult' in afterRm), `remove drops that clause and only that clause: ${JSON.stringify(posted.slice(beforeRm).map((b) => b.rule).pop())}`);
  expect(/gate is directional/.test(await page.locator('#view').innerText()), 'the other clause stays');
  await page.locator('[data-fstep="3"]').click().catch(() => {});
  await page.waitForSelector('#fA', { timeout: 15000 }).catch(() => {});
  const aWords = await page.locator('#fA option').allTextContents().catch(() => []);
  expect(aWords.includes('dMult (d)') && aWords.includes('agreePct (share)'), `the first dial box on step 3 names its dials with their Sweep labels: ${aWords.join(' | ')}`);
  // name two dials and read the grid: both check grids are on the page, the
  // second averaging the copies (3.54.0)
  await page.locator('#fA').selectOption('agreeBar');
  await page.locator('#fB').selectOption('agreePct');
  await page.locator('#fGrid').click().catch(() => {});
  await page.waitForSelector('[data-fcell]', { timeout: 15000 }).catch(() => {});
  const gridText = await page.locator('#view').innerText();
  expect(/The check - the highest scrambled average in each square/.test(gridText), 'the highest-scrambled-average grid is on the page');
  expect(gridText.indexOf('The check - the average scrambled average in each square') > gridText.indexOf('The check - the highest scrambled average in each square'), 'the average-scrambled-average grid follows it');
  const tables = await page.locator('#view table').allInnerTexts();
  const avgTable = tables.find((t) => /^all\s+2\.00\s+1\.00/m.test(t) || /all\t2\.00\t1\.00/.test(t)) || null;
  const highTable = tables.find((t) => /all\t3\.00\t2\.00/.test(t) || /^all\s+3\.00\s+2\.00/m.test(t)) || null;
  expect(!!highTable, `the highest grid reads all: 3.00, 2.00 (the higher of the two copies)${highTable ? '' : `: ${JSON.stringify(tables)}`}`);
  expect(!!avgTable, `the average grid reads all: 2.00, 1.00 (the mean of the two copies)${avgTable ? '' : `: ${JSON.stringify(tables)}`}`);
  // every square says how many copies it beats, and each block says what it is
  // worth (3.56.0)
  expect(/beats 2 of 2/.test(gridText) && /beats 0 of 2/.test(gridText), `every square carries its count of copies beaten: ${gridText.slice(0, 400)}`);
  expect(/Recommended block: [^]*avg test 6\.00 over 200 settings/.test(gridText), `the outlined block says what it is worth: ${gridText.slice(gridText.indexOf('Recommended block'), gridText.indexOf('Recommended block') + 200)}`);
  // the three tables line up: same class, same column count, fixed layout (3.55.0)
  const gridTables = await page.locator('#view table.fgrid').count();
  expect(gridTables === 3, `the grid and its two checks are drawn as three lined-up tables: ${gridTables}`);
  const widths = await page.locator('#view table.fgrid').evaluateAll((ts) => ts.map((t) => [...t.querySelectorAll('thead th')].map((th) => Math.round(th.getBoundingClientRect().width)).join(',')));
  expect(widths.length === 3 && widths[0] === widths[1] && widths[1] === widths[2], `every column is the same width in all three tables: ${widths.join(' / ')}`);
  // step 6 says what its two limits are limits on (3.57.0)
  await page.locator('[data-fstep="6"]').click().catch(() => {});
  await page.waitForSelector('#fDD', { timeout: 15000 }).catch(() => {});
  const six = await page.locator('#view').innerText();
  expect(/Every trade stakes \$100/.test(six), `step 6 says what a trade stakes: ${six.slice(0, 200)}`);
  expect(/BTCUSDT daily-4d starts one every 24 hours, so up to 6 can be open at once - \$600/.test(six),
    `step 6 says how many can be open at once on a daily unit: ${six.slice(six.indexOf('With the longest hold'), six.indexOf('With the longest hold') + 300)}`);
  expect(/XRPUSDT weekly-8d starts one every 168 hours, so up to 1 can be open at once - \$100/.test(six), 'and one at a time on a weekly unit');
  expect(/Across this reading that is \$700 on the table at once/.test(six), 'step 6 says what can be on the table across the reading');
  expect(!/holds one position at a time/.test(six), 'the false one-at-a-time sentence is gone');
  expect(/The trades are counted over 2025-06-02 to 2025-10-20/.test(six), `step 6 names the window: ${six.slice(six.indexOf('The trades are counted'), six.indexOf('The trades are counted') + 160)}`);
  expect(/20 weeks, or 140 days/.test(six), 'step 6 says how long the window is');
  expect(/at least 20\.00 \(about 52 a year\) keeps 12/.test(six), `the trades ladder is put on a yearly footing: ${six.slice(six.indexOf('trades - what'), six.indexOf('trades - what') + 200)}`);
  expect(/at most 12\.00 keeps 10/.test(six) && !/at most 12\.00 \(about/.test(six), 'the dollar ladder is drawn, and must not be read as a rate');
  expect(/Press work out the missing numbers FIRST/.test(six), 'step 6 says which button to press first');
  // pressing it asks for the survivors of the rule, not for an empty list (3.57.1)
  let asked = null;
  await page.route('**/api/funnel/*/rebuild', async (route) => {
    asked = JSON.parse(route.request().postData() || '{}');
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ settings: 12, units: 2, failures: [], proof: { ran: true, checked: 12, mismatches: [] }, kept: 12 }) });
  });
  await page.locator('#fRebuild').click();
  await page.waitForTimeout(800);
  expect(asked !== null && !Array.isArray(asked.labels), `the press names the rule rather than an empty list: ${JSON.stringify(asked)}`);
  expect(asked !== null && !!asked.rule, `the press carries the rule: ${JSON.stringify(asked)}`);
  expect(/all 12 match what the sweep stored/.test(await page.locator('#view').innerText()), 'the answer is reported beside the button');
  expect(!/NOT checked against the sweep/.test(await page.locator('#view').innerText()), 'a checked rebuild must not read as unchecked');
  // ---- THE STAGE 4 RECORD SETS OF THIS COIN AND SHAPE (3.58.0) ----
  // everything above ran with NONE cut, which is the other half of the owner's
  // order: with no Stage 4 record set on this coin and shape, the seven steps
  // are what is drawn, automatically
  expect(await page.locator('[data-fstep="1"]').count() === 1, 'with no Stage 4 record set cut, the seven steps are on screen');
  expect(await page.locator('#fCutPick').count() === 1, 'the Stage 4 record set box is at the top whether or not anything has been cut');
  expect(await page.locator('#fCutPick option').count() === 1
    && (await page.locator('#fCutPick option').allTextContents())[0] === 'new rule',
    `with nothing cut the box offers new rule and nothing else: ${JSON.stringify(await page.locator('#fCutPick option').allTextContents())}`);
  expect((await page.locator('#fTitleName').innerText()).trim() === 'new rule', 'the bold name says what is selected while the steps are being walked');
  expect(await page.locator('#fUnit').count() === 1, 'the coin and shape box is at the top, once');
  CUTS = [CUT];
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#fCutPick', { timeout: 15000 });
  expect(await page.locator('[data-fstep="1"]').count() === 0, 'showing a Stage 4 record set, the seven step buttons are gone');
  expect(await page.locator('#fCutName').count() === 1 && await page.locator('#fCutRename').count() === 1,
    'the heading is display only except for the rename control');
  const cutText = await page.locator('#view').innerText();
  expect(/S3 #ui - XRPUSDT weekly-8d - 116 of 137,760 settings/.test(cutText), `the heading names the set, the coin and shape and the counts: ${cutText.slice(0, 200)}`);
  expect(/Final Rule:\s*\n?\s*tHours \(t\) 65 to 137; gate is directional/.test(cutText.replace(/\n+/g, '\n')),
    `the final rule follows its own label with its dials named: ${cutText.slice(cutText.indexOf('Final Rule:'), cutText.indexOf('Final Rule:') + 140)}`);
  expect(/116 of 137,760 settings survive and the target is 400/.test(cutText), 'the survive line is on the heading');
  expect(/bold when a value beats at least 90% of the 20 copies - that is 18 of them - by chance about 14% of values would/.test(cutText),
    'the rule build settings line is on the heading');
  expect(/The sealed window is intact on XRPUSDT weekly-8d/.test(cutText),
    `the sealed line is on the heading and names the unit: ${cutText.slice(cutText.indexOf('The sealed'), cutText.indexOf('The sealed') + 130)}`);
  expect(/Step 7 - declare and cut: accept what the rule gives/.test(cutText), 'the last step and the closing are on the heading');
  expect(/21 choice\(s\) recorded on the way, 5 step\(s\) back/.test(cutText), 'how the walk went is on the heading');
  expect(/S4 #1 - XRPUSDT weekly-8d/.test(cutText), "the Stage 4 record set's own name is the bold name at the top");
  expect(/The rules below were built on test money/.test(cutText), 'the frame speaks of both rules on the heading');
  expect(/User Rule:/.test(cutText) && /Final Rule:/.test(cutText), 'the heading carries both rules by name');
  expect(cutText.indexOf('User Rule:') < cutText.indexOf('Final Rule:'), 'the rule the owner built comes before the one that replaced it');
  expect(/tHours \(t\) 65 to 137; gate is directional; agreeBar \(quorum bar\) is all or own/.test(cutText),
    `the owner's own rule is on the heading with its dials named: ${cutText.slice(cutText.indexOf('User Rule:'), cutText.indexOf('User Rule:') + 220)}`);
  expect(/4,820 of 137,760 settings survive/.test(cutText), 'the count the owner\'s rule kept is not on the heading');
  expect(/Recovered from this walk/.test(cutText), 'a rule recovered from the recorded steps does not say so');
  // and the lines the owner asked to be specific to THIS set are
  expect(/XRPUSDT weekly-8d's own table was scrambled 20 times/.test(cutText),
    `the scrambled-copies line names this unit and its own count: ${cutText.slice(cutText.indexOf('How every step'), cutText.indexOf('How every step') + 200)}`);
  expect(/The sealed window is intact on XRPUSDT weekly-8d/.test(cutText), 'the sealed line names the unit it is about');
  expect((await page.locator('#fTitleName').innerText()).trim() === 'S4 #1 - XRPUSDT weekly-8d',
    'the bold name at the top is the Stage 4 record set showing');
  expect(await page.locator('#fUnit').count() === 1 && await page.locator('#fCutPick').count() === 1,
    'the two selectors are drawn once each, in the title section');
  // the table: three rows a setting, the two stacked rows named on the row
  const tags = await page.locator('#view td.s4tag').allTextContents();
  expect(tags.length === 80 && tags[0].trim() === 'test' && tags[1].trim() === 'hold',
    `each of the forty settings is a what-it-is row plus a test row and a hold row: ${tags.length} tag(s)`);
  expect(/gate \(gate\) directional; decision \(decision\) argmax/.test(cutText) || /gate directional; decision argmax/.test(cutText),
    `a dial the rule pinned is said once above the table: ${cutText.slice(cutText.indexOf('Every one of these'), cutText.indexOf('Every one of these') + 200)}`);
  expect(await page.locator('#view [data-bpage]').count() === 0 && await page.locator('#view [data-bpageto]').count() === 0,
    'the page selector is back under a box that scrolls, which is space the rows need');
  expect(/All 116 of them are in the box below/.test(cutText), 'the screen does not say every setting is in the box');
  const heads = await page.locator('#view thead tr').first().innerText();
  expect(/avg test \$/i.test(heads) && /avg held-back \$/i.test(heads) && /worst losing streak \$/i.test(heads),
    `every heading carries both names: ${heads.replace(/\n/g, ' | ')}`);
  // NO SIDEWAYS SCROLL BAR, measured rather than assumed (owner order)
  const wide = await page.locator('#view').evaluate((el) => {
    const over = [...el.querySelectorAll('*')].filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => `${n.tagName}.${n.className}`);
    return { page: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, over };
  });
  expect(!wide.page && !wide.over.length, `nothing on this screen scrolls sideways: ${JSON.stringify(wide)}`);
  // AND THE ROWS HAVE THEIR OWN BOX, SIZED TO THE WINDOW, WITH THE HEADING
  // ALWAYS AT ITS TOP (3.60.0, owner order) -- measured, not assumed
  const boxed = await page.locator('#fCutRows').evaluate((box) => {
    const th = box.querySelector('thead th');
    const panel = box.closest('.panel') || box.parentElement;
    const under = panel.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom
      + (parseFloat(getComputedStyle(panel).marginBottom) || 0);
    box.scrollTop = box.scrollHeight;                 // all the way down
    const b = box.getBoundingClientRect();
    return {
      position: getComputedStyle(th).position,
      overflowY: getComputedStyle(box).overflowY,
      scrolls: box.scrollHeight > box.clientHeight + 1,
      scrolled: box.scrollTop > 0,
      fitsWindow: b.bottom <= window.innerHeight + 1,
      // and, when it does not, that it CAN be brought fully into view: its
      // height plus what sits under it inside the panel fits a whole window
      fitsScrolled: b.height + under + 24 <= window.innerHeight + 1,
      roomBelow: Math.round(window.innerHeight - b.top - under - 8),
      share: Math.round(window.innerHeight * 0.45),
      height: Math.round(b.height),
      headTop: Math.round(th.getBoundingClientRect().top - b.top),
    };
  });
  expect(boxed.overflowY === 'auto' && boxed.scrolls && boxed.scrolled,
    `the rows have their own scroll bar and it scrolls: ${JSON.stringify(boxed)}`);
  // it either ends inside the window where it stands, or it is a size worth
  // scrolling to -- and either way a whole one fits in the window once scrolled
  expect(boxed.fitsScrolled, `the box can be brought fully into view: ${JSON.stringify(boxed)}`);
  expect(boxed.height >= Math.min(boxed.roomBelow, boxed.share),
    `the box uses the room the browser measured: ${JSON.stringify(boxed)}`);
  expect(boxed.height > 200, `the box height came from the room measured, not from the floor: ${JSON.stringify(boxed)}`);
  // ABOUT EIGHT COMPLETE SETTINGS AT ONCE (owner order, 2026-09-04: it was
  // showing four). Counted, not estimated: the box's own height less its
  // heading, over the height of one setting's three rows.
  const fits = await page.locator('#fCutRows').evaluate((box) => {
    const rows = [...box.querySelectorAll('tbody tr')];
    const per = rows.slice(0, 3).reduce((a, r) => a + r.getBoundingClientRect().height, 0);
    const head = box.querySelector('thead tr').getBoundingClientRect().height;
    return { per: Math.round(per), head: Math.round(head), box: Math.round(box.getBoundingClientRect().height),
      settings: Math.floor((box.getBoundingClientRect().height - head) / per) };
  });
  expect(fits.settings >= 8, `about eight complete settings are readable at once: ${JSON.stringify(fits)}`);
  expect(boxed.position === 'sticky' && boxed.headTop <= 1,
    `the heading is still at the top of the box after scrolling to the bottom: ${JSON.stringify(boxed)}`);
  expect(/is shopping the held-back window/.test(cutText), 'the screen says what sorting by the held-back column costs');
  // sorting asks the service for the whole set in that order, never the page
  const beforeSort = rowsAsked.length;
  await page.locator('[data-fcsort="avgHold"]').click();
  await page.waitForTimeout(600);
  const sorted = rowsAsked.slice(beforeSort).pop();
  expect(!!sorted && sorted.sort === 'avgHold' && sorted.dir === 'desc' && sorted.from === undefined,
    `pressing a column sorts the whole set by it, high to low, and asks for no page: ${JSON.stringify(sorted)}`);
  await page.locator('[data-fcsort="avgHold"]').click();
  await page.waitForTimeout(600);
  expect((rowsAsked.pop() || {}).dir === 'asc', 'pressing it again flips the order');
  // the paging bar moves a page and keeps the order
  // the rename is the one thing on this screen that writes
  const rowsBefore = rowsAsked.length;
  await page.locator('#fCutName').fill('the XRP weekly rule');
  await page.locator('#fCutRename').click();
  await page.waitForTimeout(800);
  expect(renamed.length === 1 && /\/api\/stageset\/s4-ui-1\/name$/.test(renamed[0].url) && renamed[0].name === 'the XRP weekly rule',
    `rename posts the new name to the record sets' own name door: ${JSON.stringify(renamed)}`);
  expect((await page.locator('#fTitleName').innerText()).trim() === 'the XRP weekly rule',
    `the bold name at the top changes on the spot: ${await page.locator('#fTitleName').innerText()}`);
  expect((await page.locator('#fCutPick option').allTextContents())[0] === 'the XRP weekly rule',
    'the Stage 4 record set box still offers the old name');
  expect(rowsAsked.length === rowsBefore, 'the rename re-read the whole board, which is seconds of waiting for a name change');
  // and new rule puts the seven steps back
  await page.locator('#fCutPick').selectOption('new');
  await page.waitForSelector('[data-fstep="1"]', { timeout: 15000 });
  expect(await page.locator('[data-fstep="1"]').count() === 1, 'choosing new rule starts the steps again for this coin and shape');
  // AND IT STARTS AT STEP 1. The walk on hand was the one this set was cut
  // from, and it was left on step 6; a new rule is a new rule (owner order).
  expect(/Step 1/.test(await heading()), `new rule starts at step 1, not where the finished walk was left: ${await heading()}`);
  const lastRead = posted[posted.length - 1] || {};
  expect(lastRead.step === 1 && JSON.stringify((lastRead.rule || {}).allowed || {}) === '{}',
    `and it starts with an empty rule: ${JSON.stringify(lastRead)}`);
  expect(await page.locator('#fCutPick').count() === 1, 'and the drop-down stays on the heading, so a set already cut is one press away');
  expect(await page.locator('#fCutPick option').count() === 2, 'the drop-down still offers the set and new rule');
  expect(errors.length === 0, `no page errors and no dialogs${errors.length ? `: ${errors.join('; ')}` : ''}`);
  await browser.close();
  srv.kill();
  console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nthe Funnel, pressed for real: all passed');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.log('HARNESS FAILED:', e.message); process.exit(1); });
