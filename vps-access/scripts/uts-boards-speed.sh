#!/usr/bin/env bash
# uts-boards-speed.sh -- Does opening a run on Boards still freeze the machine?
#
# Boards used to ask for the replication table on every draw, and that table is
# totalled by reading every recorded row -- 49 million on this run, about ten
# minutes, on the one thread that serves every other page. So opening a run to
# press Resume run froze the whole site.
#
# This times the requests Boards actually makes when it draws, and then times an
# unrelated page DURING them, which is the part that matters: the freeze was
# never about Boards being slow, it was about everything else stopping.
#
# It also checks the one restart control answers. It does NOT press it.
set -uo pipefail
FAIL=0
B=http://127.0.0.1:8094
ID=$(curl -sf --max-time 20 "$B/api/batches" | python3 -c 'import json,sys;print((json.load(sys.stdin).get("batches") or [{}])[0].get("id",""))' 2>/dev/null)
[ -n "$ID" ] || { echo "no run to open"; exit 1; }
echo "opening $ID"

t() { curl -s -o /dev/null -w '%{time_total}' --max-time 120 "$1" 2>/dev/null || echo 999; }

echo "== what Boards asks for when it draws =="
for P in "/api/batches" "/api/batch/$ID" "/api/run-contents?id=$ID"; do
  printf '  %-46s %ss\n' "$P" "$(t "$B$P")"
done

echo "== and another page, at the same time =="
( curl -s -o /dev/null --max-time 120 "$B/api/batch/$ID" & ) 2>/dev/null
printf '  %-46s %ss\n' "/construct.html while Boards is loading" "$(t "$B/construct.html")"

echo "== the restart control (asked, not pressed) =="
curl -s --max-time 20 http://127.0.0.1:8095/api/state | python3 -c '
import json, sys
d = json.load(sys.stdin)
print(f"  {d[\"unit\"]}: {d[\"active\"]}, " + (f"answering in {d[\"ms\"]} ms" if d.get("answering") else f"NOT answering - {d.get(\"why\")}"))
' 2>/dev/null || { echo "  the control did not answer"; FAIL=1; }

echo "== the replication table is NOT asked for on a draw =="
echo "  (it is opened by hand now; asking for it here would cost the ten minutes"
echo "   this change exists to stop spending, so this does not ask)"
exit "$FAIL"
