// Attack 3 — the market data the whole system stands on.
//
// Every number this system produces is worked out from the candle files. If a
// candle file is short, gapped, duplicated, out of order, or full of prices
// that never happened, then every result downstream is wrong — and wrong in
// the worst possible way, because it still looks like a result.
//
// So the question for each spoiled file is only ever: DOES THE SYSTEM SAY
// SOMETHING. Refusing is right. Warning is right. Carrying on quietly with a
// shorter or dirtier series is the failure.
//
// This runs inside a throwaway copy of the code, because the folder the
// candle reader looks in is fixed in the code — it cannot be pointed
// elsewhere. Nothing here can see or touch the owner's real candles.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { finding } = require('./harness');

const HOUR = 3600000;

// One honest month of hourly candles, in the exact shape a real cache file has
// (read out of data/cache: {ts, open, high, low, close, quoteVolume}).
function month(year, mon, hours) {
  const start = Date.UTC(year, mon - 1, 1);
  const rows = [];
  for (let i = 0; i < hours; i++) {
    const p = 100 + Math.sin(i / 7) * 5;
    rows.push({ ts: start + i * HOUR, open: p, high: p + 1, low: p - 1, close: p + 0.5, quoteVolume: 1000 });
  }
  return rows;
}

const SPOILINGS = [
  { id: 'short', label: 'a month that stops a third of the way through', make: () => month(2024, 1, 240) },
  { id: 'gap', label: 'a month with a three-day hole in the middle', make: () => { const r = month(2024, 1, 744); return [...r.slice(0, 300), ...r.slice(372)]; } },
  { id: 'dupes', label: 'a month where every candle appears twice', make: () => { const r = month(2024, 1, 744); return r.flatMap((x) => [x, x]); } },
  { id: 'shuffled', label: 'a month whose candles are in the wrong order', make: () => { const r = month(2024, 1, 744); return [...r.slice(400), ...r.slice(0, 400)]; } },
  { id: 'empty', label: 'a month file containing an empty list', make: () => [] },
  { id: 'nulls', label: 'a month where a quarter of the candles are null', make: () => month(2024, 1, 744).map((r, i) => (i % 4 === 0 ? null : r)) },
  { id: 'nanprice', label: 'a month with prices that are not numbers', make: () => month(2024, 1, 744).map((r, i) => (i % 50 === 0 ? { ...r, close: 'n/a' } : r)) },
  { id: 'zeroprice', label: 'a month where some candles are priced at zero', make: () => month(2024, 1, 744).map((r, i) => (i % 50 === 0 ? { ...r, close: 0, open: 0, high: 0, low: 0 } : r)) },
  { id: 'negative', label: 'a month with negative prices', make: () => month(2024, 1, 744).map((r, i) => (i % 50 === 0 ? { ...r, close: -100 } : r)) },
  { id: 'lowabovehigh', label: 'a month where the low is above the high', make: () => month(2024, 1, 744).map((r, i) => (i % 50 === 0 ? { ...r, low: r.high + 10 } : r)) },
  { id: 'future', label: 'a month timestamped a hundred years from now', make: () => month(2124, 1, 744) },
  { id: 'notanarray', label: 'a month file holding an object instead of a list', make: () => ({ rows: month(2024, 1, 744) }) },
  { id: 'strings', label: 'a month where every price is text that looks like a number', make: () => month(2024, 1, 744).map((r) => ({ ...r, open: String(r.open), high: String(r.high), low: String(r.low), close: String(r.close) })) },
];

// The probe runs INSIDE the sandbox so it reads the sandbox's candle folder.
const PROBE = `
const path = require('path');
(async () => {
  const { loadSymbolAll } = require('./lib/pipeline');
  const out = {};
  try {
    const r = await loadSymbolAll('BTCUSDT', () => {});
    out.rows = Array.isArray(r.rows) ? r.rows.length : null;
    out.missing = r.missing || [];
    out.warned = Object.keys(r).filter((k) => !['rows', 'missing'].includes(k));
    // WHAT THE LOADER SAYS ABOUT THE CONDITION OF WHAT IT READ. Comparing only
    // the SHAPE of the reply could not tell "reports a summary that flags the
    // problem" from "reports nothing" — both look the same once the summary
    // field exists. This reads the content.
    out.quality = r.quality || null;
    try {
      const { seriesIsClean } = require('./lib/pipeline');
      out.saysClean = r.quality ? seriesIsClean(r.quality) : null;
    } catch (_) { out.saysClean = null; }
    const closes = (r.rows || []).map((x) => x && Number(x.close));
    out.badCloses = closes.filter((c) => !Number.isFinite(c)).length;
    out.negCloses = closes.filter((c) => Number.isFinite(c) && c <= 0).length;
    const ts = (r.rows || []).map((x) => x && x.ts);
    out.outOfOrder = ts.some((t, i) => i > 0 && !(t > ts[i - 1]));
    out.duplicateTs = new Set(ts).size !== ts.length;
  } catch (err) {
    out.refused = err.message;
  }
  process.stdout.write(JSON.stringify(out));
})();
`;

async function run(ctx) {
  const found = [];
  const { sandbox } = ctx;
  const cache = path.join(sandbox, 'data', 'cache');
  const probeFile = path.join(sandbox, '.adv-probe-candles.js');
  fs.writeFileSync(probeFile, PROBE);

  const probe = () => {
    const raw = execFileSync(process.execPath, [probeFile], { cwd: sandbox, encoding: 'utf8', timeout: 60000 });
    return JSON.parse(raw);
  };

  // Control first. An honest month must load as 744 candles. If it does not,
  // the fixture is wrong and every result below is noise.
  fs.rmSync(cache, { recursive: true, force: true });
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, 'BTCUSDT-1h-2024-01.json'), JSON.stringify(month(2024, 1, 744)));
  let control;
  try {
    control = probe();
  } catch (err) {
    found.push(finding('candles/instrument', 'this test itself', `the candle reader could not be run at all (${String(err.message).slice(0, 200)}) — nothing below was actually tested`, { instrument: true }));
    return found;
  }
  if (control.rows !== 744) {
    found.push(finding('candles/instrument', 'this test itself', `an honest month of 744 hourly candles loaded as ${JSON.stringify(control.rows)}. The spoiled-file results below are not trustworthy until that is fixed.`, { instrument: true }));
    return found;
  }
  // What an HONEST month reports is the baseline for "did it complain". The
  // first version of this counted any extra field as a complaint — and the
  // reader returns extra fields always, so every single spoiled file was
  // recorded as "flagged" and the attack found nothing. A test that cannot
  // fail is worse than no test, because it reads as a pass.
  const quietShape = JSON.stringify({ missing: control.missing || [], warned: (control.warned || []).slice().sort() });
  ctx.note(`control passed: an honest month loads as 744 candles, reporting ${quietShape}`);

  for (const s of SPOILINGS) {
    fs.rmSync(cache, { recursive: true, force: true });
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'BTCUSDT-1h-2024-01.json'), JSON.stringify(s.make()));
    let r;
    try {
      r = probe();
    } catch (err) {
      // The reader crashed outright. That is SAFE — nothing wrong was produced.
      ctx.note(`${s.label}: the reader stopped rather than carry on (safe)`);
      continue;
    }
    if (r.refused) {
      ctx.note(`${s.label}: refused — "${String(r.refused).slice(0, 80)}" (safe)`);
      continue;
    }
    // A complaint is anything the reader says that it does NOT also say about
    // an honest month.
    const shape = JSON.stringify({ missing: r.missing || [], warned: (r.warned || []).slice().sort() });
    // A complaint is: a different reply from the honest case, OR a condition
    // report that says this series is NOT clean. Either way the owner can be
    // told. Silence is the failure.
    if (shape !== quietShape || r.saysClean === false) {
      const how = r.saysClean === false
        ? `flagged in the condition report (${JSON.stringify(r.quality)})`
        : `flagged (${shape})`;
      ctx.note(`${s.label}: accepted but ${how} — acceptable`);
      continue;
    }
    // Accepted in silence. Now: is the result actually different from the truth?
    const detail = [];
    if (r.rows !== 744) detail.push(`${r.rows} candles instead of 744`);
    if (r.badCloses) detail.push(`${r.badCloses} prices that are not numbers`);
    if (r.negCloses) detail.push(`${r.negCloses} prices at or below zero`);
    if (r.outOfOrder) detail.push('candles out of time order');
    if (r.duplicateTs) detail.push('the same hour appearing more than once');
    if (!detail.length) continue; // spoiling made no difference to what was read
    found.push(finding('candles/silent', 'reading the market data',
      `${s.label} was loaded WITHOUT A WORD, giving ${detail.join(', ')}. Every rule tested against that month is then scored on data that is not what it appears to be, and the score comes back looking perfectly normal.`,
      { severe: true, spoiling: s.id }));
  }

  try { fs.unlinkSync(probeFile); } catch (_) { /* leave it */ }
  return found;
}

module.exports = { name: 'the market data — short, gapped and dirty candle files', run, SPOILINGS };
