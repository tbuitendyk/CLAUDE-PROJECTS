#!/usr/bin/env bash
# uts-coins-status.sh -- READ-ONLY. What the Coins screen would be told right
# now: the run status (running? done? what could not be read?), the records
# on disk (release, record shape, when read, which shapes carry the link-cut
# check), and whether the records reply comes back whole and how long it
# takes. Asks the service on its local port; touches nothing.
set -uo pipefail
echo "== the run, as the screen polls it =="
curl -s -m 60 -w '\n(took %{time_total}s, HTTP %{http_code})\n' http://127.0.0.1:8094/api/coins/run | head -c 1500
echo
echo "== the records reply, as the screen asks for it =="
T0=$(date +%s.%N)
curl -s -m 120 -o /tmp/uts-coins-records.json -w 'HTTP %{http_code}, %{size_download} bytes, %{time_total}s\n' http://127.0.0.1:8094/api/coins/records
node -e '
const j = JSON.parse(require("fs").readFileSync("/tmp/uts-coins-records.json", "utf8"));
console.log(`recordVersion ${j.recordVersion} · band ${j.band && j.band.value} · downloaded ${j.downloaded} · records ${(j.records || []).length} · unreadable ${(j.unreadable || []).length}`);
for (const u of (j.unreadable || [])) console.log(`  unreadable: ${u.coin} — ${String(u.why).slice(0, 110)}`);
for (const r of (j.records || [])) {
  const p = r.provenance || {};
  const sh = Object.entries(r.shapes || {}).map(([k, s]) => {
    if (!(s.periods > 0)) return `${k}:none`;
    const g = s.signal; if (!g) return `${k}:NO-SIGNAL`;
    return `${k}:${s.periods}${g.plateau ? ` plateau@${g.sweetSpot && g.sweetSpot.band}` : ""}${g.linkCut ? ` cut ${g.linkCut.asStrong == null ? g.linkCut.found : g.linkCut.asStrong}/${g.linkCut.trials}` : " NO-CUT"}`;
  }).join(" · ");
  console.log(`${r.coin} · ${r.read ? "read" : "NOT read: " + r.why} · release ${p.release} · ${String(p.capturedAt || "").slice(0, 16)} · ${sh}`);
}
' 2>&1 | head -60
rm -f /tmp/uts-coins-records.json
