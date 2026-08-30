#!/usr/bin/env bash
# uts-tally-watch.sh -- READ-ONLY. Are the tables being rebuilt, and is the
# memory holding? Reads; changes nothing.
set -uo pipefail
B=http://127.0.0.1:8094
D=/opt/ultimate-trading-system/data
date -u '+now %Y-%m-%d %H:%M:%S UTC'
for f in "$D"/stagesets/s3-*.json; do
  [ -f "$f" ] || continue
  ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$f")
  echo "== $ID =="
  for n in "$ID-tally.json.gz" "$ID-agreed.json.gz"; do
    p="$D/stagesets/$n"
    if [ -f "$p" ]; then stat -c "   %-42n %10s bytes  %y" "$p"; else echo "   $n  (not there yet)"; fi
  done
  echo "   what the ranked table says about itself:"
  curl -sf --max-time 120 "$B/api/stageset/$ID/ranked?from=0&n=1" \
    | python3 -c "
import json,sys
d=json.load(sys.stdin)
for k in ('totalling','waiting','failed'):
    if d.get(k): print('     %s: %s' % (k, str(d[k])[:160]))
if d.get('total') is not None: print('     rows in the table:', format(d.get('of',0), ','))
" || echo "     (no answer within two minutes — it is busy)"
done
free -m | sed -n 2p | sed 's/^/  /'
ps -o pid,etime,pcpu,rss -C node --sort=-rss 2>/dev/null | head -2
