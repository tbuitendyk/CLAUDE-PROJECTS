#!/usr/bin/env node
// live-mirror.js -- run the per-setup mirror (IMPLEMENTATION-PLAN 6.1/6.2)
// over every paper/live setup and write data/live/mirror.json: per-setup
// break/pending counts the alerting + UI read. Read-only over data; a BREAK
// is surfaced here and acted on by the control plane (disarm that setup),
// never by this process.
const fs = require('fs');
const path = require('path');
const reg = require('./lib/live/setups');
const mirror = require('./lib/live/mirror');

const OUT = path.join(__dirname, 'data', 'live', 'mirror.json');

(async () => {
  try {
    const now = Date.now();
    // R17: also mirror STOPPED setups — stopping halts new entries but existing
    // positions still exit, so their decisions must keep being re-verified for
    // drift; only draft (never traded) and retired (done) are skipped.
    const active = reg.listSetups().filter((s) => ['paper', 'live', 'stopped'].includes(s.state));
    const results = [];
    for (const s of active) {
      try {
        results.push(await mirror.checkSetup(s, { nowMs: now }));
      } catch (e) {
        results.push({ setup_id: s.id, ok: false, checked: 0, breaks: 0, pending: 0,
          error: e.message, utc: new Date(now).toISOString() });
      }
    }
    const agg = {
      utc: new Date(now).toISOString(),
      setups: results.length,
      breaks: results.reduce((n, r) => n + (r.breaks || 0), 0),
      errors: results.filter((r) => r.error).length,
      results,
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const tmp = `${OUT}.tmp${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(agg, null, 1));
    fs.renameSync(tmp, OUT);
    process.stdout.write(JSON.stringify({ ok: true, setups: agg.setups, breaks: agg.breaks, errors: agg.errors }) + '\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write('live-mirror FAILED: ' + err.message + '\n');
    process.exit(1);
  }
})();
