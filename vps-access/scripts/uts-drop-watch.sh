#!/usr/bin/env bash
# uts-drop-watch.sh -- READ-ONLY. How the drop is getting on.
set -uo pipefail
B=http://127.0.0.1:8094
D=/opt/ultimate-trading-system/data
date -u '+now %Y-%m-%d %H:%M:%S UTC'
systemctl show ultimate-trading-system -p ActiveEnterTimestamp --value | sed 's/^/service started /'
for f in "$D"/stagesets/s3-*.json; do
  [ -f "$f" ] || continue
  ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$f")
  printf '  %-18s ' "$ID"
  curl -sf --max-time 60 "$B/api/stageset/$ID/drop-undeclared/status" || echo '(no answer)'
  echo
  python3 -c "
import json
d=json.load(open('$f'))
print('   names held', len((d.get('plan') or {}).get('settingLabels') or []), ' drops', d.get('drops'))"
done
ls -la /opt/ultimate-trading-system/data/batches/s3-*/ 2>/dev/null | awk '/records/{print "  "$5" "$9" "$6" "$7" "$8}'
ps -o pid,etime,pcpu,rss -C node --sort=-rss 2>/dev/null | head -2
