#!/usr/bin/env bash
# uts-coins-ticked.sh -- READ-ONLY. Exactly what the Coins screen is showing
# right now: the pass bar in force, every coin and shape that passes, whether
# it is ticked, and all of its numbers -- the check against the shuffles, the
# band, the share of decisions it calls, its edge, and its traits. Asks the
# service on its local port. Writes nothing, starts nothing.
set -uo pipefail
curl -s -m 120 -o /tmp/uts-coins-passers.json http://127.0.0.1:8094/api/coins/passers 2>/dev/null \
  || curl -s -m 120 -o /tmp/uts-coins-passers.json http://127.0.0.1:8094/api/coins/records
node -e '
const j = JSON.parse(require("fs").readFileSync("/tmp/uts-coins-passers.json", "utf8"));
const p = j.passers || j;
console.log(`pass bar ${p.bar} (default ${p.default}) · shuffles ${p.trials} · rows ${((p.rows)||[]).length}`);
const f = (v, d = 3) => (v == null ? "—" : (v > 0 ? "+" : "") + Number(v).toFixed(d));
for (const r of (p.rows || [])) {
  console.log(`${r.ticked ? "TICKED " : "  -    "} ${r.coin} ${r.shape}`);
  console.log(`          check ${r.check.asStrong}/${r.check.trials} shuffles as strong · band ${r.band} · calls ${r.called == null ? "—" : (100*r.called).toFixed(0)}% of decisions · judged on ${r.judged}`);
  console.log(`          edge per called trade ${f(r.edge)}% · per decision ${f(r.perDecision)}% · times chance ${f(r.ratio, 2)} · about ${r.tradesAMonth == null ? "—" : r.tradesAMonth.toFixed(1)} trades a month`);
  console.log(`          after a rising window ${r.lean ? r.lean.rising : "—"}, after a falling window ${r.lean ? r.lean.falling : "—"} · ${(r.traits||[]).join(" ")}`);
}
' 2>&1 | head -70
rm -f /tmp/uts-coins-passers.json
