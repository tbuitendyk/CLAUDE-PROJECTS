// IONOS panel driver over CDP to the long-lived headless Chromium.
// Default posture is read-only recon; write actions (fill/click on forms)
// are permitted ONLY for flows the owner explicitly pre-approved (e.g. the
// 2026-08-06 Web Hosting Plus setup: SFTP account, /site folder, domain
// assignment). Never touch the MyWebsite Now builder or live-domain DNS.
const { chromium } = require('playwright');
const fs = require('fs');

const S = '/tmp/claude-0/-home-user-CLAUDE-PROJECTS/a50b7a49-d0a7-5001-ae29-be3330f19c4b/scratchpad';
const OUT = `${S}/ionos-recon`;
const CREDS = JSON.parse(fs.readFileSync(`${S}/.uta-creds.json`, 'utf8'));
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

async function dump(page, tag, { fullPage = false, text = false } = {}) {
  try { await page.screenshot({ path: `${OUT}/${tag}.png`, fullPage }); } catch (e) { console.log('shot-err:', e.message.split('\n')[0]); }
  console.log('== URL:', page.url());
  console.log('== TITLE:', await page.title().catch(() => '?'));
  try {
    const els = await page.$$eval('input, button, a[role=button], [type=submit]', els =>
      els.filter(e => e.offsetWidth || e.offsetHeight).slice(0, 40).map(e => ({
        tag: e.tagName, type: e.type || '', name: e.name || '', id: e.id || '',
        ph: e.placeholder || '', text: (e.innerText || e.value || '').trim().slice(0, 60),
      })));
    console.log('== INTERACTIVE:', JSON.stringify(els));
  } catch (e) { console.log('els-err:', e.message.split('\n')[0]); }
  if (text) {
    const t = await page.evaluate(() => document.body.innerText.slice(0, 8000)).catch(() => '');
    console.log('== TEXT:', t);
  }
}

async function goRetry(page, url, tries = 3) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try { return await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); }
    catch (e) { last = e; console.log(`goto attempt ${i} failed:`, e.message.split('\n')[0]); await page.waitForTimeout(2000); }
  }
  throw last;
}

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(25000);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.setUserAgentOverride', { userAgent: UA, acceptLanguage: 'es-MX,es;q=0.9,en;q=0.8' });

  const step = process.argv[2] || 'landing';
  try {
    if (step === 'landing') {
      await goRetry(page, 'https://presence.ionos.mx/');
      await page.waitForTimeout(6000);
      await dump(page, '01-landing');
    } else if (step === 'fill-login') {
      const email = page.locator('input[type=email], input[name=username], input[id*=username i], input[autocomplete=username], input[type=text]').first();
      await email.waitFor({ state: 'visible', timeout: 20000 });
      await email.fill(CREDS.user);
      await page.waitForTimeout(800);
      let pw = page.locator('input[type=password]').first();
      if (!(await pw.isVisible().catch(() => false))) {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(4000);
        pw = page.locator('input[type=password]').first();
        await pw.waitFor({ state: 'visible', timeout: 20000 });
      }
      await pw.fill(CREDS.pass);
      await dump(page, '02-filled');
      await page.keyboard.press('Enter');
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(10000);
      await dump(page, '03-after-login', { text: true });
    } else if (step === 'token') {
      const tok = page.locator('input#token, input[name=token]').first();
      await tok.waitFor({ state: 'visible', timeout: 15000 });
      await tok.fill(process.argv[3]);
      await page.keyboard.press('Enter');
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(10000);
      await dump(page, '04-after-token', { text: true });
      // if a password step follows the email confirmation, complete it
      const pw = page.locator('input[type=password]').first();
      if (await pw.isVisible().catch(() => false)) {
        await pw.fill(CREDS.pass);
        await page.keyboard.press('Enter');
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(10000);
        await dump(page, '05-after-password', { text: true });
      }
    } else if (step === 'state') {
      await dump(page, `state-${Date.now() % 100000}`, { text: true });
    } else if (step === 'goto') {
      await goRetry(page, process.argv[3]);
      await page.waitForTimeout(7000);
      await dump(page, process.argv[4] || 'goto', { text: true });
    } else if (step === 'links') {
      const links = await page.$$eval('a[href]', as => as.filter(a => a.offsetWidth || a.offsetHeight)
        .map(a => ({ href: a.href, text: (a.innerText || '').trim().slice(0, 70) })).filter(l => l.text));
      console.log(JSON.stringify(links, null, 1));
    } else if (step === 'shot-full') {
      await dump(page, process.argv[3] || 'full', { fullPage: true });
    } else if (step === 'click-text') {
      // clicks a link/button by its visible text (navigation, or owner-approved form actions)
      const target = page.locator(`a:has-text("${process.argv[3]}"), button:has-text("${process.argv[3]}")`).first();
      await target.waitFor({ state: 'visible', timeout: 15000 });
      await target.click();
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(8000);
      await dump(page, process.argv[4] || 'after-click', { text: true });
    } else if (step === 'fill') {
      // fill <css-selector> <value> — owner-approved form flows only
      const el = page.locator(process.argv[3]).first();
      await el.waitFor({ state: 'visible', timeout: 15000 });
      await el.fill(process.argv[4]);
      console.log('filled', process.argv[3]);
    } else if (step === 'type') {
      // type <css-selector> <value> — clears then types with real key events (for pickier meters)
      const el = page.locator(process.argv[3]).first();
      await el.waitFor({ state: 'attached', timeout: 15000 });
      await el.click({ force: true }).catch(() => {});
      await el.fill('');
      await el.pressSequentially(process.argv[4], { delay: 40 });
      console.log('typed', process.argv[3]);
    } else if (step === 'js') {
      // js <expression> — evaluate in page, print JSON result (inspection/verification)
      const r = await page.evaluate(process.argv[3]);
      console.log(JSON.stringify(r));
    } else if (step === 'click') {
      // click <css-selector> [tag] — owner-approved form flows only
      const el = page.locator(process.argv[3]).first();
      await el.waitFor({ state: 'visible', timeout: 15000 });
      await el.click();
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(8000);
      await dump(page, process.argv[4] || 'after-click-sel', { text: true });
    }
  } catch (e) {
    console.log('ERROR:', e.message.split('\n').slice(0, 3).join(' | '));
    await dump(page, `err-${step}`);
  }
  await browser.close(); // disconnects CDP; browser keeps running
}
main();
