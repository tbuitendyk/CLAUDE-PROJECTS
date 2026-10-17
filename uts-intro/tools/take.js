// One continuous take of the walkthrough, recorded from the virtual display.
// Every action is scheduled against the narration: A[k] is when paragraph k's audio starts
// (seconds after T0), W(k, word) is when that word is spoken.
// Usage: node take.js <out-dir>   (writes raw.mkv + timeline.json there)
const { launch, makeActions, signIn } = require('./lib.js');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(process.argv[2] || 'take');
fs.mkdirSync(OUT, { recursive: true });
const VOICE = path.resolve(__dirname, '../work/voice');
const dur = p => +execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 ${VOICE}/P${p}.mp3`).toString();
const words = p => JSON.parse(fs.readFileSync(`${VOICE}/P${p}.words.json`));
const D = {}, WD = {};
for (let p = 1; p <= 8; p++) { D[p] = dur(p); WD[p] = words(p); }

// Paragraph start times (seconds after T0). Gaps after each paragraph leave room for the clicks.
const A = {};
A[1] = 1.2;
A[2] = A[1] + D[1] + 1.9;
A[3] = A[2] + D[2] + 0.9;
A[4] = A[3] + D[3] + 0.8;
A[5] = A[4] + D[4] + 2.4;
A[6] = A[5] + D[5] + 0.8;
function W(p, w, n = 1) {
  let k = 0;
  for (const x of WD[p]) if (x.w.toLowerCase().replace(/[^a-z']/g, '') === w.toLowerCase() && ++k === n) return A[p] + x.t;
  throw new Error(`word ${w} #${n} not in P${p}`);
}

const events = [];
let T0 = 0;
const now = () => Date.now() / 1000 - T0;
const log = (label, extra) => { const e = { t: +now().toFixed(3), label, ...(extra || {}) }; events.push(e); console.log(e.t.toFixed(2).padStart(7), label, extra ? JSON.stringify(extra) : ''); };
async function at(t, label, fn) {
  const wait = t - now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait * 1000));
  else if (wait < -0.3) log('LATE ' + label, { by: +(-wait).toFixed(2) });
  log(label, { planned: +t.toFixed(2) });
  if (fn) await fn();
}

(async () => {
  const { browser, page } = await launch(':99');
  const a = makeActions(page, (m, x) => log(m + ' ' + x));
  const q = s => page.locator(s).first();
  const txt = (re, exact) => page.getByText(re, exact ? { exact: true } : undefined).first();
  const settle = async (loc, ms = 15000) => { await loc.waitFor({ state: 'visible', timeout: ms }); };

  // Camera helpers that work on untransformed coordinates.
  await page.addInitScript(() => {
    window.__cam = { tx: 0, ty: 0, s: 1 };
  });
  const camInstall = () => page.evaluate(() => {
    if (window.__camTo) return;
    window.__cam = window.__cam || { tx: 0, ty: 0, s: 1 };
    const origin = () => { const h = document.documentElement.getBoundingClientRect(); return { x: h.left, y: h.top }; };
    window.__untr = (x, y) => { const c = window.__cam, o = origin(); return { x: o.x + (x - o.x - c.tx) / c.s, y: o.y + (y - o.y - c.ty) / c.s }; };
    window.__camTo = (px, py, s, d, qx, qy) => {
      const o = origin(), W = innerWidth;
      qx = qx == null ? px : qx; qy = qy == null ? py : qy;
      let tx = qx - o.x - s * (px - o.x), ty = qy - o.y - s * (py - o.y);
      tx = Math.min(-o.x, Math.max(W - s * W - o.x, tx));
      ty = Math.min(-o.y, ty);
      if (s === 1) { tx = 0; ty = 0; }
      const b = document.body;
      b.style.transformOrigin = '0 0';
      b.style.transition = `transform ${d}ms cubic-bezier(.45,.05,.2,1)`;
      b.style.transform = s === 1 ? 'translate(0px,0px) scale(1)' : `translate(${tx}px,${ty}px) scale(${s})`;
      window.__cam = { tx, ty, s };
    };
  });
  // Zoom so that the point (fx,fy) of the element lands at (qx,qy) on screen (default: stays put).
  async function camEl(loc, s, d = 1800, fx = 0.5, fy = 0.5, qx, qy) {
    await camInstall();
    const b = await loc.boundingBox();
    await page.evaluate(([x, y, s, d, qx, qy]) => { const u = window.__untr(x, y); window.__camTo(u.x, u.y, s, d, qx, qy); }, [b.x + b.width * fx, b.y + b.height * fy, s, d, qx, qy]);
    a.state.busyUntil = Date.now() + d + 60;
  }
  async function camReset(d = 1200) { await camInstall(); await page.evaluate(d => window.__camTo(960, 540, 1, d), d); a.state.busyUntil = Date.now() + d + 60; }

  // ---- before the take: signed in, on Setup > Accounts with the page guidance card up.
  await signIn(page);
  await settle(txt('Trading accounts', true));
  await page.waitForTimeout(3000);
  const startState = await page.evaluate(() => ({ guided: document.querySelector('#guidedbtn').innerText, theme: document.documentElement.getAttribute('data-theme'), url: location.href, card: !!document.querySelector('#guideVeil') && getComputedStyle(document.querySelector('#guideVeil')).display !== 'none' }));
  console.log('start state', startState);
  await a.moveTo(1560, 930, 10);

  // ---- start recording
  const ff = spawn('ffmpeg', ['-hide_banner', '-y', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '30', '-video_size', '1920x1080', '-i', ':99+0,0',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '8', '-pix_fmt', 'yuv444p', path.join(OUT, 'raw.mkv')], { stdio: ['pipe', 'ignore', 'pipe'] });
  let ffStart = null, ffErr = '';
  ff.stderr.on('data', d => { ffErr += d; const m = /start: ([0-9.]+)/.exec(ffErr); if (m && !ffStart) ffStart = +m[1]; });
  while (!ffStart) await new Promise(r => setTimeout(r, 50));
  T0 = Date.now() / 1000 + 0.8;
  console.log('ffmpeg start', ffStart, 'T0', T0, 'offset', (T0 - ffStart).toFixed(3));

  try {
    // P1 — Setup > Accounts with the card; dismiss it beside the card, then switch page guidance off.
    await at(A[1], 'P1 audio');
    await at(W(1, 'this') - 0.2, 'P1 cursor drifts beside the card', () => a.moveTo(1440, 860, 1100));
    await at(A[1] + D[1] - 0.15, 'P1 click beside card', () => a.clickAt(1440, 860, 200));
    await at(A[1] + D[1] + 0.55, 'P1 Guided off', () => a.click('#guidedbtn', { dur: 800 }));

    // P2 — Construct > Data, zoom on MONTHS/FROM; Sweep, Boards, Funnel; Held; Reserve.
    await at(A[2] - 0.15, 'P2 audio + Construct', () => a.click('.toptab:text-is("Construct")', { dur: 500 }));
    await settle(q('.tab:text-is("Data")'));
    await at(A[2] + 1.45, 'P2 Data', () => a.click('.tab:text-is("Data")', { dur: 650 }));
    await settle(txt('BCHUSDT', true));
    await camInstall();
    const months = page.locator('th').filter({ hasText: /^\s*months\s*$/i }).first();
    const from = page.locator('th').filter({ hasText: /^\s*from\s*$/i }).first();
    await at(W(2, 'price') - 0.3, 'P2 zoom MONTHS/FROM', async () => {
      const bm = await months.boundingBox(), bf = await from.boundingBox();
      const rows = await page.locator('tbody tr').count();
      const lastRow = await page.locator('tbody tr').nth(Math.max(0, rows - 1)).boundingBox();
      const cx = (bm.x + bf.x + bf.width) / 2, cy = (bm.y + lastRow.y + lastRow.height) / 2;
      await page.evaluate(([x, y]) => { const u = window.__untr(x, y); window.__camTo(u.x, u.y, 1.85, 3200, 960, 560); }, [cx, cy]); a.state.busyUntil = Date.now() + 3260;
      await a.moveTo(cx + 40, cy + 120, 1600);
    });
    await at(W(2, 'data') - 0.2, 'P2 zoom out', () => camReset(1100));
    await at(W(2, 'so') - 0.25, 'P2 Sweep', () => a.click('.tab:text-is("Sweep")', { dur: 650 }));
    await at(W(2, 'copies') - 0.2, 'P2 Boards', () => a.click('.tab:text-is("Boards")', { dur: 550 }));
    await at(W(2, 'good', 2) - 0.4, 'P2 Funnel', () => a.click('.tab:text-is("Funnel")', { dur: 550 }));
    await at(W(2, 'held') - 0.75, 'P2 Held', () => a.click('.tab:text-is("Held")', { dur: 600 }));
    await at(W(2, 'reserve') - 0.75, 'P2 Reserve', () => a.click('.tab:text-is("Reserve")', { dur: 500 }));
    await at(W(2, 'measured') - 0.2, 'P2 zoom on the Reserve description', async () => {
      const p = txt(/four simpler things/);
      await settle(p);
      await camEl(p, 1.4, 2400, 0.0, 0.5, 40, 430);
      await a.moveTo(760, 640, 1500);
    });
    await at(A[3] - 0.9, 'P2 zoom out', () => camReset(650));

    // P3 — Greenlight; its heading and description; then the release on the status line.
    await at(A[3] - 0.05, 'P3 audio + Greenlight', () => a.click('.tab:text-is("Greenlight")', { dur: 600 }));
    await at(W(3, 'greenlight') + 0.1, 'P3 zoom on Greenlight description', async () => {
      const h = txt(/Greenlight — the decision that a config is fit to trade/);
      await settle(h);
      await camEl(h, 1.75, 2400, 0.0, 1.0, 240, 330);
    });
    await at(W(3, 'release') - 0.9, 'P3 zoom on the release', async () => {
      const r = txt(/Release \d+\.\d+\.\d+/);
      await camEl(r, 2.5, 1700, 0.5, 0.5, 960, 210);
      const b = await r.boundingBox();
      await a.moveTo(b.x + b.width * 0.62, b.y + b.height + 40, 900);
    });
    await at(W(3, 'faith') + 0.2, 'P3 zoom out', () => camReset(1100));

    // P4 — Trade > Paper Books; the trial notice and "No greenlighted configs yet"; hover Live Trading.
    await at(A[4] - 0.1, 'P4 audio + Trade', () => a.click('.toptab:text-is("Trade")', { dur: 650 }));
    await settle(txt(/No greenlighted configs yet/));
    await at(W(4, 'paper') + 0.2, 'P4 zoom on notice', async () => { await camInstall(); await camEl(txt(/FREE TRIAL/), 1.45, 2200, 0.0, 0.5, 60, 330); });
    await at(W(4, 'live') - 1.3, 'P4 zoom out', () => camReset(1000));
    await at(W(4, 'live') - 0.4, 'P4 hover Live Trading', () => a.hover('.tab:text-is("Live Trading")', { dur: 900 }));
    await at(A[4] + D[4] + 0.1, 'Setup', () => a.click('.toptab:text-is("Setup")', { dur: 900 }));
    await settle(q('.tab:text-is("Compute")'));
    await at(A[4] + D[4] + 1.35, 'Theme to light (Setup)', () => a.click('#themebtn', { dur: 750 }));

    // P5 — Setup > Compute (Where each part runs, The sweep processor), then Accounts > Trading accounts.
    await at(A[5] - 0.15, 'P5 audio + Compute', () => a.click('.tab:text-is("Compute")', { dur: 900 }));
    await settle(txt('Where each part runs', true));
    await at(W(5, 'your', 2) - 0.1, 'P5 scroll to Where each part runs', () => a.scrollToEl('text="Where each part runs"', 150, 1300));
    await at(W(5, 'encrypted') + 0.2, 'P5 scroll to The sweep processor', async () => {
      await a.scrollToEl('text="The sweep processor"', 360, 1500);
      const c = txt('connected', true);
      if (await c.isVisible().catch(() => false)) { const b = await c.boundingBox(); await a.moveTo(b.x - 30, b.y + b.height + 34, 1100); }
    });
    await at(W(5, 'server') - 0.9, 'P5 Accounts', async () => { await a.scrollTo(0, 700); await a.click('.tab:text-is("Accounts")', { dur: 700 }); });
    await at(W(5, 'nothing') + 0.1, 'P5 zoom on Trading accounts', async () => {
      const h = txt('Trading accounts', true); await settle(h); await camEl(h, 1.55, 2200, 0.0, 0.5, 120, 470);
    });
    await at(A[6] - 0.7, 'P5 zoom out', () => camReset(700));

    // P6 — Profile: font larger twice, page guidance back on, then the Compute guided workflow from the start.
    await at(A[6] - 0.05, 'P6 audio + Profile', () => a.click('.tab:text-is("Profile")', { dur: 700 }));
    await settle(q('#pfLookBigger'));
    await at(W(6, 'plain') - 0.3, 'P6 Enlarge font 1', () => a.click('#pfLookBigger', { dur: 900 }));
    await at(W(6, 'data') - 0.2, 'P6 Enlarge font 2', () => a.click('#pfLookBigger', { dur: 250 }));
    await at(W(6, 'same') + 0.1, 'P6 scroll to Guidance', () => a.scrollToEl('text="Guidance"', 215, 1000));
    await at(W(6, 'time', 1) + 0.15, 'P6 zoom on Guidance', () => camEl(txt('Guidance', true), 1.5, 1000, 0.0, 0.0, 60, 150));
    await at(W(6, 'guided') - 0.55, 'P6 Guided on', () => a.click('#pfGuided', { dur: 650 }));
    await at(W(6, 'control') + 0.1, 'P6 dismiss card if shown', async () => {
      const veil = await q('#guideVeil').isVisible().catch(() => false);
      log('card shown after Guided on: ' + veil);
      if (veil) await a.clickAt(1700, 980, 700);
    });
    await at(W(6, 'time', 2) - 0.6, 'P6 point at the workflow', () => a.hover('#pfWf', { dur: 700, dx: 0.32 }));
    await at(A[6] + D[6] + 0.5, 'P6 Start fresh', () => a.click('label.c:has-text("Start fresh")', { dur: 650, dx: 0.1 }));
    await at(A[6] + D[6] + 1.3, 'P6 Activate', () => a.click('#pfWfGo', { dur: 450 }));
    await at(A[6] + D[6] + 2.1, 'P6 zoom out', () => camReset(650));
    await at(A[6] + D[6] + 2.8, 'P6 Open', () => a.click('#pfWfOpen', { dur: 450 }));
    const next = page.getByRole('button', { name: 'Next', exact: true }).first();
    await settle(next);
    await at(A[6] + D[6] + 4.1, 'P6 zoom on the step box', async () => { await camEl(next, 1.3, 1500, 0.5, -3.0, 960, 450); });
    await at(A[6] + D[6] + 5.8, 'P6 Next', () => a.click(next, { dur: 700 }));
    await at(A[6] + D[6] + 7.5, 'P6 pull back', () => camReset(1500));
    await at(A[6] + D[6] + 9.7, 'END');
  } catch (e) {
    log('ERROR ' + e.message.split('\n')[0]);
    console.error(e);
  }

  ff.stdin.write('q');
  await new Promise(r => ff.on('close', r));
  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify({ ffStart, T0, offset: T0 - ffStart, A, D, events, startState }, null, 1));

  // ---- put the account back: page guidance on, font 100%, dark theme, workflow where it was; then sign out.
  try {
    await page.evaluate(() => { document.body.style.transform = ''; });
    for (let k = 0; k < 6 && await q('#guideVeil').isVisible().catch(() => false); k++) { await page.mouse.click(1700, 1000); await page.waitForTimeout(700); }
    if (!(await page.url()).includes('setup.html')) await page.goto('https://ultimate-trading-system.com/setup.html', { waitUntil: 'networkidle' });
    for (let k = 0; k < 6 && await q('#guideVeil').isVisible().catch(() => false); k++) { await page.mouse.click(1700, 1000); await page.waitForTimeout(700); }
    await q('.tab:text-is("Profile")').click(); await page.waitForTimeout(1500);
    for (let k = 0; k < 6 && await q('#guideVeil').isVisible().catch(() => false); k++) { await page.mouse.click(1700, 1000); await page.waitForTimeout(700); }
    for (let k = 0; k < 10; k++) {
      const fs_ = await page.evaluate(() => (document.body.innerText.match(/FONT SIZE\s*(\d+)%/) || [])[1]);
      if (+fs_ === 100) break;
      await q(+fs_ > 100 ? '#pfLookSmaller' : '#pfLookBigger').click(); await page.waitForTimeout(900);
    }
    if (!(await q('#guidedbtn').getAttribute('class')).includes(' on')) { await q('#pfGuided').click(); await page.waitForTimeout(1200); }
    if ((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) !== 'dark') { await q('#themebtn').click(); await page.waitForTimeout(800); }
    const after = await page.evaluate(() => ({ font: (document.body.innerText.match(/FONT SIZE\s*\d+%/) || [])[0], guided: document.querySelector('#guidedbtn').innerText, theme: document.documentElement.getAttribute('data-theme'), wf: (document.body.innerText.match(/Active:[^\n]*/) || [])[0], release: (document.body.innerText.match(/Release \d+\.\d+\.\d+/) || [])[0] }));
    console.log('restored', after);
    fs.writeFileSync(path.join(OUT, 'restored.json'), JSON.stringify(after, null, 1));
    await q('#signoutbtn').click(); await page.waitForTimeout(2500);
    console.log('signed out ->', page.url());
  } catch (e) { console.error('RESTORE FAILED', e); }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
