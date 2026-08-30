#!/usr/bin/env bash
# uts-three-steps.sh -- READ-ONLY. What each of the three passes says about
# itself right now, and whether anything is actually running. Starts nothing.
set -uo pipefail
B=http://127.0.0.1:8094
D=/opt/ultimate-trading-system/data
date -u '+now %Y-%m-%d %H:%M:%S UTC'
systemctl show ultimate-trading-system -p ActiveEnterTimestamp --value | sed 's/^/service started /'
for f in "$D"/stagesets/s3-*.json; do
  [ -f "$f" ] || continue
  ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$f")
  echo "== $ID =="
  for ep in rename-settings drop-undeclared fill-in; do
    printf '  %-16s ' "$ep"
    curl -sf --max-time 25 "$B/api/stageset/$ID/$ep/status" || echo "(no answer)"
    echo
  done
  python3 -c "
import json
d=json.load(open('$f'))
pl=d.get('plan') or {}
print('  names held    ', len(pl.get('settingLabels') or []))
print('  recordsVersion', d.get('recordsVersion'))
print('  appends       ', d.get('appends'))
print('  drops         ', d.get('drops'))
"
done
echo "== is anything burning CPU =="
ps -o pid,etime,pcpu,rss,args -C node --sort=-pcpu 2>/dev/null | head -4
echo "== the records store =="
for dir in "$D"/batches/s3-*; do
  [ -d "$dir" ] || continue
  ls -la "$dir" | awk 'NR>1 {print "  "$5" "$9" "$6" "$7" "$8}'
done
echo "== last of the journal =="
journalctl -u ultimate-trading-system --since '90 min ago' --no-pager 2>/dev/null | tail -12
