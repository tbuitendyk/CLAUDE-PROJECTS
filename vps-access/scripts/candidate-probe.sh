#!/usr/bin/env bash
# candidate-probe.sh -- read-only: trace ONE coin through the composition
# candidate pipeline on the live box (does NOT touch the service). Answers
# "why isn't <coin> in the search?" — is it in topCandidates, is it
# venue-tradable, and how deep is its cached/fetched daily history.
#
# Usage via run-script:  arg = "<coingecko_id>@<symbol>"
#   e.g. "pax-gold@paxg"
set -euo pipefail
ARG="${1:-}"
if [[ -z "$ARG" || "$ARG" != *@* ]]; then
  echo "usage: run-script candidate-probe.sh <coingecko_id>@<symbol>  (e.g. pax-gold@paxg)" >&2
  exit 1
fi
ID="${ARG%@*}"
SYM="${ARG#*@}"
cd /opt/semi-auto-balancer
PROBE_ID="$ID" PROBE_SYM="$SYM" node <<'JS'
const id = process.env.PROBE_ID, sym = process.env.PROBE_SYM;
(async () => {
  const { topCandidates } = require('./lib/candidates');
  const { getDailyHistory } = require('./lib/history');
  const bitso = require('./lib/exchanges/bitso');

  let top = [];
  try { top = await topCandidates({ count: 40 }); } catch (e) { console.log('topCandidates ERR:', e.message); }
  const hit = top.find((c) => c.id === id || c.symbol === sym);
  console.log(`topCandidates(40): ${top.length} coins · ${sym} present=${!!hit}${hit ? ' (rank ' + hit.rank + ', id ' + hit.id + ')' : ''}`);
  console.log('  pool symbols:', top.map((c) => c.symbol).join(', '));

  try {
    const books = await bitso.availableBooks();
    const bases = new Set(books.map((b) => String(b).split('_')[0]));
    console.log(`bitso tradable(${sym}) = ${bases.has(sym)} · matching books:`, books.filter((b) => b.includes(sym)).join(', ') || 'none');
  } catch (e) { console.log('bitso books ERR:', e.message); }

  try {
    const rows = await getDailyHistory(id, 1460, sym);
    const f = rows[0], l = rows[rows.length - 1];
    const span = f && l ? Math.round((l.ts - f.ts) / 86400000) : 0;
    console.log(`getDailyHistory(${id}, 1460, ${sym}): ${rows.length} rows, ${f ? new Date(f.ts).toISOString().slice(0, 10) : '-'} -> ${l ? new Date(l.ts).toISOString().slice(0, 10) : '-'} (${span}d span)`);
    // Value sanity: quarterly samples + biggest single-day jump — a corrupt or
    // source-mixed series (unit flips, inversions) shows up here immediately.
    const day = (ts) => new Date(ts).toISOString().slice(0, 10);
    const step = Math.max(1, Math.floor(rows.length / 16));
    console.log('  samples:', rows.filter((_, i) => i % step === 0 || i === rows.length - 1).map((r) => `${day(r.ts)}=${r.usd_price}`).join(' '));
    let worst = null;
    for (let i = 1; i < rows.length; i++) {
      const ratio = rows[i].usd_price / rows[i - 1].usd_price;
      if (!worst || Math.abs(Math.log(ratio)) > Math.abs(Math.log(worst.ratio))) worst = { ratio, at: rows[i].ts, from: rows[i - 1].usd_price, to: rows[i].usd_price };
    }
    if (worst) console.log(`  biggest 1d jump: ×${worst.ratio.toFixed(4)} on ${day(worst.at)} (${worst.from} -> ${worst.to})`);
    console.log(`  window return: ${(((l.usd_price / f.usd_price) - 1) * 100).toFixed(1)}%`);
  } catch (e) { console.log('getDailyHistory ERR:', e.message); }
})();
JS

# Second phase: rebuild the composition pipeline's bars for profile 2 (Bitso)
# and print the focus asset's in-sample first/last — the exact numbers the
# terminal-decliner screen sees.
PROBE_ID="$ID" PROBE_SYM="$SYM" node <<'JS2'
const id = process.env.PROBE_ID, sym = process.env.PROBE_SYM;
(async () => {
  const db = require('./lib/db');
  const { candidateSeries } = require('./lib/candidates');
  const { getDailyHistory } = require('./lib/history');
  const compose = require('./lib/compose');
  const profile = db.prepare('SELECT * FROM profiles WHERE id = 2').get();
  if (!profile) return console.log('no profile 2');
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = 2').all();
  const tether = assets.find((a) => a.is_index);
  const days = 1460, nowMs = Date.now(), DAY = 86400000;
  const universe = [{ id, symbol: sym, held: false }];
  const seriesById = await candidateSeries(universe, days, {});
  seriesById.set(tether.coingecko_id, await getDailyHistory(tether.coingecko_id, days));
  const earliests = universe.map((c) => (seriesById.get(c.id) || [])[0]).filter(Boolean).map((r) => r.ts);
  let ws = compose.chooseWindowStart(earliests, nowMs - days * DAY, nowMs);
  const tr = seriesById.get(tether.coingecko_id) || [];
  if (tr.length) ws = Math.max(ws, tr[0].ts);
  const trimmed = new Map();
  for (const [k, rows] of seriesById) trimmed.set(k, rows.filter((r) => r.ts >= ws));
  const { bars, covered } = compose.buildBars(trimmed, [tether.coingecko_id, id]);
  console.log(`bars=${bars.length} covered=${covered.join(',')}`);
  const inSample = bars.slice(0, bars.length - Math.max(30, Math.floor(bars.length * 0.2)));
  let first = null, last = null;
  for (const b of inSample) { const p = b.usd[id]; if (p > 0) { if (first == null) first = p; last = p; } }
  console.log(`in-sample ${sym}: first=${first} last=${last} ownReturn=${first && last ? (((last / first) - 1) * 100).toFixed(1) : '?'}%`);
  const d10 = (ts) => new Date(ts).toISOString().slice(0, 10);
  const step = Math.max(1, Math.floor(inSample.length / 10));
  console.log('  bar samples:', inSample.filter((_, i) => i % step === 0).map((b) => `${d10(b.ts)}=${b.usd[id]}`).join(' '));
})();
JS2
