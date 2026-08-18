// make-ui-fixture.js -- create the run the runtime harness needs to exercise the
// TRADING tab, on a box that does not have one.  Usage: node tests/make-ui-fixture.js
//
// WHY THIS EXISTS. tests/browser.js has three passes that are the ONLY coverage
// the Trading tab's money numbers and channel controls have: VALUES (every tile
// must match the status endpoint), CONTROLS (cancel changes nothing, confirm
// does) and REAL-GATE (the real channel is refused and says why). All three need
// a config that can legally open a PAPER book, and the live-executability gate
// (lib/live/configschema.js) grants that only for a cell that is:
//
//   * MARKET entry          — breakout is lab-only
//   * DIRECTIONAL gate      — 'active' is lab-only
//   * no dMult              — that belongs to breakout entry
//   * a pair an execution target serves — today target 'mx-1' serves LTCUSDT
//
// On 2026-08-18 this box's only run was a ZEC/BTC/ETH breakout sweep, so no
// config could ever activate, all three passes SKIPPED, and the harness still
// printed "all 45 tab views clean". Trading value-fidelity coverage was zero and
// the summary line said the opposite. The harness now FAILS on a skipped pass;
// this script is how you give it what it needs instead of waiving.
//
// It downloads LTCUSDT hourly klines from Binance's public bulk portal (the same
// source and cache shape the app uses — no API keys, no AI, per the project's
// hard constraint) for whatever months the box already holds for BTCUSDT, then
// runs a small MARKET-ONLY triple sweep. The LTCUSDT-led promoted row it leaves
// behind is what the harness mints its throwaway configs from.
//
// It is a FIXTURE BUILDER, not a research run: the sweep is deliberately tiny and
// its numbers are never read as evidence of anything.
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'data', 'cache');
const PAIR = 'LTCUSDT';
const PORT = 8300 + (process.pid % 200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function monthsHeldFor(sym) {
  return fs.readdirSync(CACHE)
    .filter((f) => f.startsWith(`${sym}-1h-`) && /\d{4}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(`${sym}-1h-`, '').replace('.json', ''))
    .sort();
}

function fetchMonth(m) {
  const out = path.join(CACHE, `${PAIR}-1h-${m}.json`);
  if (fs.existsSync(out)) return 'cached';
  const url = `https://data.binance.vision/data/spot/monthly/klines/${PAIR}/1h/${PAIR}-1h-${m}.zip`;
  const zip = path.join(require('os').tmpdir(), `${PAIR}-${m}.zip`);
  try {
    execFileSync('curl', ['-sS', '-m', '90', '-o', zip, url], { stdio: 'ignore' });
    const csv = execFileSync('unzip', ['-p', zip], { maxBuffer: 64 * 1024 * 1024 }).toString();
    const rows = csv.trim().split('\n').filter(Boolean).map((l) => {
      const c = l.split(',');
      const ts = Number(c[0]);
      return { ts: ts > 1e14 ? Math.floor(ts / 1000) : ts,
               open: +c[1], high: +c[2], low: +c[3], close: +c[4], quoteVolume: +c[7] };
    });
    // A month that parsed to nonsense must not be written: a cache file with NaN
    // opens would poison every sweep that touched it, and silently.
    if (!rows.length || !Number.isFinite(rows[0].open)) return 'bad-parse';
    fs.writeFileSync(out, JSON.stringify(rows));
    return 'fetched';
  } catch (_) {
    return 'failed';
  } finally {
    try { fs.unlinkSync(zip); } catch (_) { /* nothing to clean */ }
  }
}

const J = async (method, p, body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, method === 'POST'
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }
    : {});
  return { code: r.status, body: await r.json().catch(() => null) };
};

(async () => {
  const months = monthsHeldFor('BTCUSDT');
  if (!months.length) {
    console.error('no BTCUSDT months in data/cache — this box has no data to build a fixture against.');
    process.exit(1);
  }
  console.log(`${PAIR}: ensuring ${months.length} month(s) ${months[0]} -> ${months[months.length - 1]}`);
  const tally = {};
  for (const m of months) { const r = fetchMonth(m); tally[r] = (tally[r] || 0) + 1; }
  console.log('  ' + Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(' '));
  if (!monthsHeldFor(PAIR).length) { console.error(`could not cache any ${PAIR} data`); process.exit(1); }

  const srv = spawn(process.execPath, ['server.js'],
    { env: { ...process.env, PORT: String(PORT) }, cwd: ROOT, stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/api/healthz`); if (r.ok) break; } catch (_) { /* starting */ }
      await sleep(500);
    }
    const launch = await J('POST', '/api/bracketlab', {
      universe: [PAIR, 'BTCUSDT', 'ETHUSDT'],
      sizes: { triples: true },
      entries: ['market'],          // market cells are directional-only -> the executable shape
      allLoaded: true,
      promoteK: 3,
      minTrades: 5,
      windowLayout: 'split70',
      set: { geometry: 'daily-3d', decision: 'argmax', band: 'auto' },
      label: 'ui-harness-ltc-market',
      description: 'fixture for tests/browser.js — a live-executable LTCUSDT row so the '
        + 'Trading VALUES/CONTROLS/REAL-GATE passes can run. Not evidence of anything.',
    });
    if (launch.code !== 200 || !launch.body.batchId) {
      console.error('launch refused:', JSON.stringify(launch.body));
      process.exit(1);
    }
    const id = launch.body.batchId;
    console.log('sweep:', id);
    let doc = null;
    for (let i = 0; i < 170; i++) {
      await sleep(5000);
      doc = (await J('GET', `/api/batch/${encodeURIComponent(id)}`)).body;
      const st = doc && (doc.state || doc.status);
      if (st && /done|finished|complete|error|failed/i.test(st)) break;
    }
    const promoted = ((doc && doc.leaders) || []).filter((l) => l.stage === 'promoted' && l.nullDealSeed == null);
    const led = promoted.filter((l) => String(l.key).startsWith(`${PAIR}|`));
    for (const l of promoted) console.log(`  promoted: ${l.key}`);
    if (!led.length) {
      console.error(`\nthe sweep finished but promoted no ${PAIR}-led row, so the harness still cannot mint.`);
      process.exit(1);
    }
    // Prove the fixture actually does its job rather than assuming it: mint a
    // config off it and activate paper, exactly as the harness will, then remove
    // it. Reporting "fixture ready" without this check is how the original
    // problem was allowed to persist unseen.
    const sel = await J('POST', `/api/bracketlab/${encodeURIComponent(id)}/select`,
      { key: led[0].key, stage: 'promoted' });
    if (sel.code !== 200) { console.error('could not select the row:', JSON.stringify(sel.body)); process.exit(1); }
    const gl = await J('POST', '/api/live/greenlight', { runId: id, target: 'best', why: 'fixture self-check' });
    const cid = gl.body && gl.body.greenlight && gl.body.greenlight.id;
    if (!cid) { console.error('could not greenlight:', JSON.stringify(gl.body)); process.exit(1); }
    const act = await J('POST', `/api/live/configs/${cid}/activate`, { channel: 'paper', clipUsd: 10 });
    await J('POST', `/api/live/configs/${cid}/deactivate`, { channel: 'paper' });
    await J('POST', `/api/live/configs/${cid}/nuke`, {});
    if (act.code !== 200) {
      console.error('\nthe fixture row still cannot open a paper book:', JSON.stringify(act.body));
      process.exit(1);
    }
    console.log(`\nfixture ready — ${led[0].key} opens a paper book. Run: npm run test:ui`);
  } finally {
    srv.kill('SIGKILL');
  }
})();
