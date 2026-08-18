// pilot-intent-baseline.js -- STAGE 1 of moving F1's definition out of code.
//
// WHY THIS EXISTS. F1 — the rule the live pilot trades with real money — has
// its definition written into lib/forwardbook.js as a literal, and
// lib/pilotsignal.js reads it from there at module load. A trading engine whose
// whole purpose is to DISCOVER rules cannot have its rules live in source, and
// moving them to data means changing the code path that feeds a live, armed
// engine holding an open position.
//
// So the ruler gets built before the cut. This captures exactly what the
// CURRENT code produces, period by period, as a golden record. Any later change
// that claims to be behaviour-neutral has to reproduce this file byte for byte,
// or it is not behaviour-neutral and does not ship.
//
// WHAT IT CAPTURES. For each historical chunk it records the full decision the
// engine would make: side, per-member calls, quorum, band, symbol, the entry
// and exit timestamps, prices, and the input hash. That is the whole intent
// surface — if any of it moved, the box would trade differently.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not touch the box, the journal, the
// arm state or the deployed service. It reads cached candles and computes. It
// writes one file under tests/baseline/ and nothing else.
//
// DETERMINISM IS PART OF THE CHECK. A golden record that varies between runs
// proves nothing, so `--verify` re-runs and compares to the stored file. The
// first thing this harness must demonstrate is that it agrees with ITSELF.
//
// Usage:
//   node tests/pilot-intent-baseline.js --capture   write the golden record
//   node tests/pilot-intent-baseline.js --verify    recompute and compare
const fs = require('fs');
const path = require('path');
const signal = require('../lib/pilotsignal');

const OUT_DIR = path.join(__dirname, 'baseline');
const OUT_FILE = path.join(OUT_DIR, 'f1-intents.json');

// How far back to sample. F1 trains through 2026-06-30 and scores from
// 2026-07-01, so the interesting periods are the forward ones — but the
// committee call is defined over the whole cached range and a definition swap
// must not move ANY of them, so the window is deliberately wider than the
// live record.
const FROM_MS = Date.UTC(2025, 0, 1);
const TO_MS = Date.UTC(2026, 7, 1);
const STEP_MS = 24 * 3600 * 1000;      // F1's geometry is daily-4d

// Fields that are genuinely time-of-run rather than decision content. A golden
// record that includes them would fail on the clock rather than on behaviour,
// which is the classic way a comparison harness becomes noise and gets ignored.
const VOLATILE = new Set(['producedUtc', 'producedTs', 'now', 'nowMs', 'elapsedMs']);

function stable(v) {
  // Deterministic serialization: key order must not depend on insertion order,
  // or a refactor that builds the same object differently would read as a
  // behaviour change.
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (VOLATILE.has(k)) continue;
      out[k] = stable(v[k]);
    }
    return out;
  }
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
  return v;
}

async function collect() {
  const rows = [];
  let errors = 0;
  for (let ts = FROM_MS; ts <= TO_MS; ts += STEP_MS) {
    let rec;
    try {
      rec = await signal.computeSignalForChunk(ts, {});
    } catch (e) {
      errors++;
      rec = { error: String((e && e.message) || e) };
    }
    // Chunks with no complete feature window are a legitimate outcome, not a
    // gap to paper over — record them as they come back.
    rows.push({ chunkMs: ts, chunkUtc: new Date(ts).toISOString(), out: stable(rec) });
  }
  return { rows, errors };
}

function describeDefinition() {
  // The definition itself is part of the baseline. If a later change claims to
  // load the SAME rule from data, this is what it has to match.
  const F1 = signal.F1;
  return stable({
    id: F1.id, combo: F1.combo, branch: F1.branch, stage: F1.stage,
    members: F1.members, cell: F1.cell, configVersion: signal.CONFIG_VERSION,
  });
}

(async () => {
  const mode = process.argv.includes('--verify') ? 'verify'
    : process.argv.includes('--capture') ? 'capture' : null;
  if (!mode) {
    console.error('usage: pilot-intent-baseline.js --capture | --verify');
    process.exit(2);
  }

  const { rows, errors } = await collect();
  const decided = rows.filter((r) => r.out && r.out.side && r.out.side !== 0).length;
  const payload = { definition: describeDefinition(), rows };
  const text = JSON.stringify(payload, null, 1);

  console.log(`periods sampled : ${rows.length}`);
  console.log(`with a side     : ${decided}`);
  console.log(`compute errors  : ${errors}`);

  if (mode === 'capture') {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, text);
    console.log(`\nbaseline written: ${path.relative(process.cwd(), OUT_FILE)} (${text.length} bytes)`);
    console.log('run again with --verify to prove it reproduces.');
    return;
  }

  if (!fs.existsSync(OUT_FILE)) {
    console.error(`\nno baseline at ${OUT_FILE} — run --capture first`);
    process.exit(2);
  }
  const want = fs.readFileSync(OUT_FILE, 'utf8');
  if (want === text) {
    console.log('\nMATCHES the baseline byte for byte.');
    return;
  }
  // Say WHERE it diverged. "They differ" is not an actionable finding.
  const a = JSON.parse(want);
  const diffs = [];
  if (JSON.stringify(a.definition) !== JSON.stringify(payload.definition)) {
    diffs.push('the DEFINITION itself changed');
  }
  const byChunk = new Map(a.rows.map((r) => [r.chunkMs, JSON.stringify(r.out)]));
  for (const r of payload.rows) {
    const prev = byChunk.get(r.chunkMs);
    const now = JSON.stringify(r.out);
    if (prev === undefined) diffs.push(`${r.chunkUtc}: period absent from the baseline`);
    else if (prev !== now) diffs.push(`${r.chunkUtc}: decision changed`);
    if (diffs.length >= 15) break;
  }
  console.error(`\nDIVERGED from the baseline — ${diffs.length >= 15 ? 'first 15' : diffs.length} difference(s):`);
  for (const d of diffs) console.error(`  ${d}`);
  process.exit(1);
})();
