#!/usr/bin/env bash
# uts-why-fetch-failed.sh -- READ-ONLY. A stage 1 unit only reaches the network
# when a month of candles it needs is not in the cache. This says which coins
# the failed units used, what month range the run asked for, what the cache
# holds for those coins now, and what the service log said at the time.
set -uo pipefail
cd /opt/ultimate-trading-system || { echo "no app dir"; exit 1; }
node -e '
const st = require("./lib/stages");
const b = require("./lib/binance");
for (const s of (st.listSets() || [])) {
  if (!s || !s.id) continue;
  let d = null; try { d = st.getSet(s.id); } catch (e) { continue; }
  if (!d || !Array.isArray(d.failures) || !d.failures.length) continue;
  const p = d.params || {};
  console.log("=== " + d.name + " (" + d.id + ")  months " + (p.startMonth||"?") + " .. " + (p.endMonth||"?") + "  allLoaded=" + p.allLoaded);
  const coins = new Set();
  for (const f of d.failures) for (const c of String(f.unit).split("|")) if (/USDT$/.test(c)) coins.add(c);
  console.log("    coins in the failed units: " + [...coins].join(", "));
  for (const c of [...coins].sort()) {
    let months = [];
    try { months = b.coveredMonths(c) || []; } catch (e) { months = ["(" + e.message + ")"]; }
    console.log("      " + c.padEnd(10) + months.length + " month(s) cached  " + (months[0]||"-") + " .. " + (months[months.length-1]||"-"));
  }
  console.log("");
}
'
echo "== the service log around the failures =="
journalctl -u uts --since "36 hours ago" --no-pager 2>/dev/null \
  | grep -iE "fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|binance data|getaddrinfo|socket hang up" \
  | tail -40 || echo "(no matching log lines)"
