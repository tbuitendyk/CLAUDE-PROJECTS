// Renders the end card (frame by frame, so the text reveals land exactly on the spoken words)
// and the six lower-third captions (transparent PNGs). Plain typography only.
// Usage: node cards.js <out-dir> <p7Start> <p8Start> <totalSeconds>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [OUT, P7S, P8S, TOTAL] = [path.resolve(process.argv[2]), +process.argv[3], +process.argv[4], +process.argv[5]];
const VOICE = path.resolve(__dirname, '../work/voice');
const w7 = JSON.parse(fs.readFileSync(`${VOICE}/P7.words.json`));
const wt = w => P7S + w7.find(x => x.w.toLowerCase() === w).t;
const FPS = 30;

const CAPTIONS = ['Trust, or check.', 'Tested against "nothing" · held · reserve', 'Greenlight = frozen evidence', 'Paper first', 'Your keys, your machine', 'Deterministic · guided'];

const FONT = `@font-face{font-family:I;src:url(file:///usr/share/fonts/opentype/inter/Inter-Regular.otf)}
@font-face{font-family:I;font-weight:500;src:url(file:///usr/share/fonts/opentype/inter/Inter-Medium.otf)}
@font-face{font-family:I;font-weight:600;src:url(file:///usr/share/fonts/opentype/inter/Inter-SemiBold.otf)}
@font-face{font-family:I;font-weight:700;src:url(file:///usr/share/fonts/opentype/inter/Inter-Bold.otf)}`;

const END_HTML = (t1, t2, t3, tu) => `<!doctype html><html><head><meta charset="utf-8"><style>${FONT}
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0e1116;font-family:I,sans-serif}
.bg{position:absolute;inset:0;background:radial-gradient(1200px 700px at 50% 42%,#18202b 0%,#0e1116 70%)}
.stack{position:absolute;left:0;right:0;top:300px;text-align:center}
.l{font-weight:600;font-size:86px;letter-spacing:-1.5px;line-height:1.22;color:#d6dce5;opacity:0;transform:translateY(18px)}
.l3{color:#fff}
.rule{width:0;height:2px;margin:46px auto 40px;background:#9db4d0;opacity:.55}
.url{font-weight:700;font-size:50px;letter-spacing:-.5px;color:#d6dce5;opacity:0;transform:translateY(10px)}
.url span{color:#9db4d0}
</style></head><body><div class="bg"></div><div class="stack">
<div class="l" id="a">Find a trading rule.</div><div class="l" id="b">Prove it isn't luck.</div><div class="l l3" id="c">Run it forward.</div>
<div class="rule" id="r"></div><div class="url" id="u">ultimate-trading-system<span>.com</span></div></div>
<script>
const ease='cubic-bezier(.2,.7,.2,1)';
const up=(id,at,d=650)=>document.getElementById(id).animate([{opacity:0,transform:'translateY(18px)'},{opacity:1,transform:'translateY(0)'}],{duration:d,delay:at*1000,fill:'both',easing:ease});
up('a',${t1});up('b',${t2});up('c',${t3});up('u',${tu},800);
document.getElementById('r').animate([{width:'0px'},{width:'340px'}],{duration:900,delay:${tu - 0.25}*1000,fill:'both',easing:ease});
document.getAnimations().forEach(a=>a.pause());
window.seek=t=>document.getAnimations().forEach(a=>a.currentTime=t*1000);
</script></body></html>`;

const CAP_HTML = text => `<!doctype html><html><head><meta charset="utf-8"><style>${FONT}
html,body{margin:0;background:transparent}
.cap{display:inline-flex;align-items:center;gap:16px;padding:15px 26px 15px 20px;margin:10px;border-radius:12px;
background:rgba(12,15,20,.80);box-shadow:0 6px 24px rgba(0,0,0,.35);border:1px solid rgba(157,180,208,.22);
font-family:I,sans-serif;font-weight:500;font-size:30px;letter-spacing:-.2px;color:#eef2f7;white-space:nowrap}
.bar{width:4px;height:30px;border-radius:2px;background:#9db4d0}
</style></head><body><div class="cap"><div class="bar"></div><div>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div></div></body></html>`;

(async () => {
  fs.mkdirSync(path.join(OUT, 'endframes'), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  for (let i = 0; i < CAPTIONS.length; i++) {
    await page.setContent(CAP_HTML(CAPTIONS[i]), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.cap').screenshot({ path: path.join(OUT, `cap${i + 1}.png`), omitBackground: true });
    // the screenshot is of the pill only; keep a margin for the shadow by capturing the body box around it
  }

  await page.setContent(END_HTML(wt('find') - 0.12, wt('prove') - 0.12, wt('run') - 0.12, P8S - 0.05), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const n = Math.round(TOTAL * FPS);
  for (let f = 0; f < n; f++) {
    await page.evaluate(t => window.seek(t), f / FPS);
    await page.screenshot({ path: path.join(OUT, 'endframes', String(f).padStart(4, '0') + '.png') });
  }
  console.log('end card frames', n);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
