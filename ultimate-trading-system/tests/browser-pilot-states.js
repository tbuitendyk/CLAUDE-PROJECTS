// THE PILOT STATES THE FIXTURE BOX NEVER PRODUCES (added 2026-08-18).
//
// tests/browser.js carried an honest limit: it runs against a build box, so it
// proved the software behaves, not that it behaves on the shapes the LIVE box
// serves. Rather than ship the owner's live money into a scratch container to
// look at, the deployed service was asked (read-only, via
// vps-access/scripts/classifier-capture-live.sh) to describe its SHAPES. The
// comparison named the gap exactly:
//
//                       live box      fixture box
//     pilot armed       true          false
//     open positions    1 SHORT       0
//     incidents         30            0
//     closed trades     1             0
//     HALTED + reason   (not today)   never, on either box
//
// So four states the browser had never rendered — and one that NEITHER box has,
// which matters most: the halt banner. That banner carries the "Clear the halt"
// button shipped this same morning, and no browser had ever drawn it. A control
// added for an emergency, only reachable during that emergency, is exactly the
// one that must not be first exercised during the emergency.
//
// This builds each state as a synthetic pilot journal, drives the real page at
// it, and puts the original journal back. No live data is copied; the shapes
// come from the digest, the numbers are invented.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const JOURNAL = path.join(ROOT, 'data', 'pilot', 'journal.jsonl');
const PORT = 8207;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowS = Math.floor(Date.now() / 1000);

const line = (o) => JSON.stringify({ ts: o.ts || nowS, utc: o.utc || new Date().toISOString(), ...o });

// An armed pilot holding one open SHORT, with incidents and a closed trade —
// the live box's ordinary working state.
function journalWorking() {
  const rows = [
    { event: 'ARM_SET', source: 'owner', armed: true },
    { event: 'ENTRY_FILL', chunk_start: '2026-08-14T00:00:00.000Z', side: 'SHORT',
      qty: 0.224, price: 44.57, fee_quote: 0.00998, exit_due_ts: nowS + 400000 },
    { event: 'EXIT_FILL', chunk_start: '2026-08-07T00:00:00.000Z', side: 'LONG',
      qty: 0.2, price: 46.1, fee_quote: 0.01, pnl_quote: -0.2573 },
    { event: 'PNL_MTM', realized: -0.2573, mark_to_market: -0.21, price: 44.34 },
  ];
  // a spread of incident kinds, because the panel renders each differently and
  // a live box carries dozens
  for (let i = 0; i < 12; i++) {
    rows.push({ event: i % 3 === 0 ? 'ORDER_REJECT' : (i % 3 === 1 ? 'RECONCILE_MISMATCH' : 'INTENT_STALE'),
      source: 'executor', reason: `synthetic incident ${i}`, ts: nowS - (i + 1) * 600 });
  }
  rows.push({ event: 'RUN_STATUS', armed: true, halted: false, open: 1, realized: -0.2573, live: true });
  rows.push({ event: 'BALANCE', base_net: '-0.22188636', base_free: '0', quote_free: '209.55' });
  return rows.map(line).join('\n') + '\n';
}

// The same box, HALTED, with a reason — the state the halt banner and its
// "Clear the halt" button exist for, and the one no box has ever rendered.
function journalHalted() {
  return journalWorking()
    + line({ event: 'HALT_SET', source: 'executor',
             reason: 'reconcile mismatch: borrow 0.221886 below journal shorts 0.224000' }) + '\n';
}


// A box EARLY IN ITS LIFE: the journal exists but carries almost nothing. This
// is a real live shape — a freshly provisioned box, or one whose journal was
// rotated — and it is the shape that finds unguarded property access, because
// every optional field is absent at once. The two states above are both
// "populated"; neither exercises a sparse record.
function journalSparse() {
  return line({ event: 'RUN_STATUS', armed: false, halted: false, open: 0, live: true }) + '\n';
}


// THE JOURNAL ARRIVES OVER A WIRE. It is scp'd from the box by a timer, so a
// truncated transfer or a partial write is not hypothetical — a half-written
// last line is the ordinary result of catching a sync mid-flight. This project
// has already been bitten twice by partial reads (the deploy verifier that
// reported shipped code MISSING, QC-155). A page that throws on a torn journal
// would black out the live screen at exactly the moment the operator went
// looking for why the sync was late.
function journalTorn() {
  return journalWorking() + '{"ts":1787000000,"utc":"2026-08-18T05:00:00Z","event":"ENTRY_F';
}

// And the empty file: present, readable, zero bytes. Distinct from "absent",
// which the code already handles ("the pilot has not reported yet").
function journalEmpty() { return ''; }

async function getJson(p) {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error(`${p} -> HTTP ${r.status}`);
  return r.json();
}

async function main() {
  let pw;
  try { pw = require('playwright'); } catch (_) {
    console.error('playwright not resolvable — set NODE_PATH=/opt/node22/lib/node_modules');
    process.exit(2);
  }

  const had = fs.existsSync(JOURNAL);
  const backup = had ? fs.readFileSync(JOURNAL) : null;
  fs.mkdirSync(path.dirname(JOURNAL), { recursive: true });

  let bad = 0;
  const browser = await pw.chromium.launch();
  try {
    for (const state of [
      { name: 'WORKING  armed, 1 open SHORT, incidents, a closed trade', journal: journalWorking(), halted: false },
      { name: 'HALTED   the banner and its Clear-the-halt button', journal: journalHalted(), halted: true },
      { name: 'SPARSE   a box early in its life — every optional field absent', journal: journalSparse(),
        halted: false, sparse: true },
      { name: 'TORN     a journal caught mid-sync, last line half-written', journal: journalTorn(),
        halted: false, torn: true },
      { name: 'EMPTY    the journal file exists and is zero bytes', journal: journalEmpty(),
        halted: false, sparse: true },
    ]) {
      fs.writeFileSync(JOURNAL, state.journal);
      const srv = spawn(process.execPath, ['server.js'],
        { env: { ...process.env, PORT: String(PORT) }, cwd: ROOT, stdio: 'ignore' });
      const faults = [];
      try {
        for (let i = 0; i < 60; i++) {
          try { const r = await fetch(`${BASE}/api/healthz`); if (r.ok) break; } catch (_) { /* starting */ }
          await sleep(500);
        }
        // the server must actually be in the state we think it is, or the page
        // check below is verifying nothing
        const pilot = await getJson('/api/pilot');
        if (!!pilot.halted !== state.halted) {
          faults.push(`the fixture did not take: /api/pilot reports halted=${pilot.halted}, expected ${state.halted}`);
        }
        if (state.halted && !pilot.haltReason) faults.push('halted, but no haltReason was published — the banner cannot name the cause');
        if (state.torn && (pilot.openPositions || []).length !== 1) {
          faults.push('a torn last line lost the COMPLETE records before it: '
            + `${(pilot.openPositions || []).length} open positions, expected 1. A half-written line `
            + 'must cost only itself.');
        }
        if (!state.halted && !state.sparse && !state.torn && (pilot.openPositions || []).length !== 1) {
          faults.push(`expected 1 open position in the working fixture, got ${(pilot.openPositions || []).length}`);
        }
        if (!state.sparse && !state.torn && (pilot.incidents || []).length < 5) {
          faults.push(`expected a spread of incidents, got ${(pilot.incidents || []).length}`);
        }

        const page = await browser.newPage();
        page.on('console', (m) => { if (m.type() === 'error') faults.push(`console error: ${m.text()}`); });
        page.on('pageerror', (e) => faults.push(`uncaught: ${e.message}`));
        page.on('requestfailed', (r) => faults.push(`failed request: ${r.url()}`));
        page.on('response', (r) => { if (r.status() >= 400) faults.push(`HTTP ${r.status()} ${r.url()}`); });
        page.on('dialog', (d) => d.dismiss().catch(() => {}));

        await page.addInitScript(() => {
          localStorage.setItem('lt-branch', 'real');
          localStorage.setItem('lt-sub', 'live');
        });
        await page.goto(`${BASE}/trade.html`, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000);

        const seen = await page.evaluate(() => ({
          text: (document.querySelector('#view') || document.body).textContent || '',
          unhalt: !!document.querySelector('#btnUnhalt'),
          unhaltWired: !!(document.querySelector('#btnUnhalt') || {}).onclick,
          // Query the ELEMENT, never document.body.textContent: this page's whole
          // script is an inline <script> in the body, so textContent includes the
          // source code — and the banner's own source matched, making this fire
          // on every healthy run. A check that reads a page's source as if it
          // were its output is the same class as QC-163.
          // ...and match the OUTAGE banner specifically. It shares the class
          // 'banner halted' with the HALT banner, so a class selector reports a
          // halted box as a failed read — which is how this check first "found"
          // an outage in the state it exists to verify.
          incomplete: !!document.querySelector('#view [data-role="incomplete"]'),
          banner: ((document.querySelector('#view [data-role="incomplete"]') || {}).textContent || '').slice(0, 260),
        }));

        // nothing half-rendered, on any of these states
        for (const junk of ['undefined', 'NaN', '[object Object]', 'Infinity']) {
          if (seen.text.includes(junk)) faults.push(`"${junk}" is visible on the page`);
        }
        if (seen.incomplete) faults.push('the outage banner fired on a healthy fixture: ' + seen.banner.replace(/\s+/g,' ').slice(0,260));

        if (state.halted) {
          if (!seen.unhalt) faults.push('HALTED, but the page offers no "Clear the halt" button — a halt is a dead end from the screen');
          if (seen.unhalt && !seen.unhaltWired) faults.push('the "Clear the halt" button exists but has no handler — pressing it does nothing');
          if (!/halt/i.test(seen.text)) faults.push('HALTED, but the screen never says so');
          if (!/reconcile mismatch/i.test(seen.text)) {
            faults.push('the halt banner does not show the recorded reason — clearing blind is the mistake the confirmation exists to prevent');
          }
        } else if (seen.unhalt) {
          faults.push('a "Clear the halt" button is offered while the box is NOT halted');
        }
        await page.close();
      } catch (e) {
        faults.push(`threw: ${e.message}`);
      } finally {
        srv.kill('SIGKILL');
        await sleep(300);
      }

      if (faults.length) {
        bad++;
        console.error(`FAIL ${state.name}`);
        for (const f of faults) console.error(`     ${f}`);
      } else {
        console.log(`ok   ${state.name}`);
      }
    }
  } finally {
    await browser.close();
    // ALWAYS put the box back as it was found
    if (backup != null) fs.writeFileSync(JOURNAL, backup);
    else { try { fs.unlinkSync(JOURNAL); } catch (_) { /* nothing to remove */ } }
  }

  console.log(bad === 0 ? '\nall pilot states clean' : `\n${bad} pilot state(s) have faults`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
