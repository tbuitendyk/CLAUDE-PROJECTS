// Shared helpers: headed Chromium on the virtual display, a visible cursor, eased mouse moves,
// a CSS "camera" (zoom toward a point) and eased scrolling. Everything shown is the live app.
const { chromium } = require('playwright');

const CURSOR_JS = `(() => {
  if (window.__curInit) return; window.__curInit = true;
  const mk = () => {
    if (document.getElementById('__cur')) return;
    const st = document.createElement('style');
    st.textContent = '#__cur{position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;will-change:transform;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}' +
      '.__rip{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2px solid rgba(255,196,64,.95);background:rgba(255,196,64,.18);z-index:2147483646;pointer-events:none;animation:__rip .55s ease-out forwards}' +
      '@keyframes __rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.25);opacity:0}}';
    document.documentElement.appendChild(st);
    const c = document.createElement('div'); c.id = '__cur';
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M5 3 L5 22 L10 17.5 L13.6 25.2 L17 23.6 L13.4 16 L20 16 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    let p = {x: 960, y: 540}; try { p = JSON.parse(sessionStorage.getItem('__cur')) || p; } catch (e) {}
    c.style.transform = 'translate(' + (p.x - 5) + 'px,' + (p.y - 3) + 'px)';
  };
  const place = (x, y) => { const c = document.getElementById('__cur'); if (c) c.style.transform = 'translate(' + (x - 5) + 'px,' + (y - 3) + 'px)'; try { sessionStorage.setItem('__cur', JSON.stringify({x, y})); } catch (e) {} };
  addEventListener('mousemove', e => place(e.clientX, e.clientY), true);
  addEventListener('mousedown', e => { const r = document.createElement('div'); r.className = '__rip'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 700); }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mk); else mk();
})();`;

async function launch(display) {
  const browser = await chromium.launch({
    headless: false,
    proxy: { server: process.env.HTTPS_PROXY },
    env: { ...process.env, DISPLAY: display },
    args: ['--kiosk', '--window-position=0,0', '--window-size=1920,1080', '--hide-scrollbars', '--disable-infobars', '--force-color-profile=srgb', '--force-device-scale-factor=1'],
  });
  const ctx = await browser.newContext({ viewport: null, colorScheme: 'dark' });
  await ctx.addInitScript(CURSOR_JS);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
  await page.waitForTimeout(800);
  return { browser, ctx, page, cdp, windowId };
}

function makeActions(page, log) {
  let cur = { x: 960, y: 540 };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  async function moveTo(x, y, dur = 550) {
    const from = { ...cur }; const t0 = Date.now();
    for (;;) {
      const k = Math.min(1, (Date.now() - t0) / dur); const e = ease(k);
      await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      if (k >= 1) break; await sleep(12);
    }
    cur = { x, y };
  }
  async function box(sel) {
    const loc = typeof sel === 'string' ? page.locator(sel).first() : sel;
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    return loc.boundingBox();
  }
  const state = { busyUntil: 0 };
  const idle = async () => { while (Date.now() < state.busyUntil) await sleep(30); };
  async function press() { await sleep(140); await page.mouse.down(); await sleep(90); await page.mouse.up(); }
  // A click "beside" something: refused if the point is on any control.
  async function clickAt(x, y, dur) {
    await idle(); await moveTo(x, y, dur);
    const hit = await page.evaluate(([x, y]) => { const h = document.elementFromPoint(x, y); const c = h && h.closest('button,a,input,select,label,textarea,.tab,.toptab,[onclick]'); return c ? (c.innerText || c.tagName).slice(0, 40) : null; }, [x, y]);
    if (hit) { log && log('REFUSED click beside: control under cursor', hit); return false; }
    await press(); return true;
  }
  // A click on a control: only pressed if that control is what is actually under the cursor.
  async function click(sel, { dur = 550, dx = 0.5, dy = 0.5, name } = {}) {
    const loc = typeof sel === 'string' ? page.locator(sel).first() : sel;
    for (let tries = 0; tries < 4; tries++) {
      await idle();
      const b = await box(loc); const x = b.x + b.width * dx, y = b.y + b.height * dy;
      await moveTo(x, y, tries ? 250 : dur);
      const ok = await loc.evaluate((el, [x, y]) => { const h = document.elementFromPoint(x, y); return !!h && (el === h || el.contains(h)); }, [x, y]);
      if (ok) { await press(); return true; }
      await sleep(300);
    }
    log && log('REFUSED click: target not under cursor', name || String(sel));
    return false;
  }
  async function hover(sel, { dur = 600, dx = 0.5, dy = 0.5 } = {}) { await idle(); const b = await box(sel); await moveTo(b.x + b.width * dx, b.y + b.height * dy, dur); }
  // Camera: scale the page about a viewport point; the cursor sits outside <body> so it is not scaled.
  async function camera(scale, px = 960, py = 540, dur = 1600) {
    await page.evaluate(([s, px, py, d]) => {
      const b = document.body; const r = b.getBoundingClientRect();
      const m = b.style.transform && b.style.transform !== 'none' ? b.__org : null;
      const ox = m ? m.x : px - r.left, oy = m ? m.y : py - r.top;
      if (!m || s === 1) { b.__org = { x: px - r.left, y: py - r.top }; }
      b.style.transformOrigin = (m && s === 1 ? m.x : px - r.left) + 'px ' + (m && s === 1 ? m.y : py - r.top) + 'px';
      b.style.transition = 'transform ' + d + 'ms cubic-bezier(.45,.05,.25,1)';
      b.style.willChange = 'transform';
      b.style.transform = s === 1 ? 'none' : 'scale(' + s + ')';
    }, [scale, px, py, dur]);
  }
  async function cameraToBox(sel, scale, dur = 1600, fx = 0.5, fy = 0.5) {
    const b = await box(sel); await camera(scale, b.x + b.width * fx, b.y + b.height * fy, dur);
  }
  async function scrollTo(y, dur = 1400) {
    await page.evaluate(([y, d]) => new Promise(res => {
      const y0 = scrollY, t0 = performance.now(); const e = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const f = now => { const k = Math.min(1, (now - t0) / d); scrollTo(0, y0 + (y - y0) * e(k)); k < 1 ? requestAnimationFrame(f) : res(); };
      requestAnimationFrame(f);
    }), [y, dur]);
  }
  async function scrollToEl(sel, offset = 120, dur = 1400) {
    const y = await page.locator(sel).first().evaluate((el, off) => el.getBoundingClientRect().top + scrollY - off, offset);
    await scrollTo(Math.max(0, y), dur);
  }
  return { state, idle, moveTo, click, clickAt, hover, camera, cameraToBox, scrollTo, scrollToEl, box, sleep, get cur() { return cur; }, set cur(v) { cur = v; } };
}

async function signIn(page) {
  await page.goto('https://ultimate-trading-system.com/signin.html', { waitUntil: 'networkidle' });
  if (page.url().includes('signin')) {
    // The account to film is given at run time, never kept here: UTS_EMAIL and UTS_PASSWORD.
    if (!process.env.UTS_EMAIL || !process.env.UTS_PASSWORD) throw new Error('set UTS_EMAIL and UTS_PASSWORD');
    await page.fill('#siEmail', process.env.UTS_EMAIL);
    await page.fill('#siPw', process.env.UTS_PASSWORD);
    await page.click('#vSignin button[type=submit]');
    await page.waitForURL(/setup\.html/, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
  }
}

module.exports = { launch, makeActions, signIn };
