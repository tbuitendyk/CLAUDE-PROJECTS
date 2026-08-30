#!/usr/bin/env bash
# uts-what-crashed.sh -- READ-ONLY. The lines around the abort, and what the
# service is doing now. Longer curl waits, because a busy service answers late
# rather than not at all. Starts nothing.
set -uo pipefail
B=http://127.0.0.1:8094
D=/opt/ultimate-trading-system/data
echo "== the abort, and the twenty lines before it =="
journalctl -u ultimate-trading-system --since '120 min ago' --no-pager 2>/dev/null \
  | grep -nE 'FATAL|heap|Allocation failed|out of memory|Mark-Compact|ABRT|Started Ultimate|Stopping Ultimate' | tail -30
echo
echo "== the first lines of the crash report =="
journalctl -u ultimate-trading-system --since '120 min ago' --no-pager 2>/dev/null \
  | grep -B 2 -A 6 'FATAL ERROR' | head -40
echo
echo "== what it is doing NOW (waiting up to two minutes each) =="
for f in "$D"/stagesets/s3-*.json; do
  [ -f "$f" ] || continue
  ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$f")
  for ep in fill-in drop-undeclared rename-settings; do
    printf '  %-16s ' "$ep"
    curl -sf --max-time 120 "$B/api/stageset/$ID/$ep/status" || echo "(still no answer after two minutes)"
    echo
  done
done
echo
echo "== memory =="
free -m | sed 's/^/  /'
ps -o pid,etime,pcpu,rss,args -C node --sort=-rss 2>/dev/null | head -3
