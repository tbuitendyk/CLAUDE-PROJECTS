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
