#!/usr/bin/env bash
# uts-reptotals-check.sh -- proves the replication totals on the box, through
# the REAL path: ask the table, watch the background build it kicks off, and —
# the whole point — time an unrelated page WHILE the build reads 49 million
# rows. Read-only for the run's rows; the build writes only its totals file,
# which is what it is for.
set -uo pipefail
B=http://127.0.0.1:8094
ID=$(curl -sf --max-time 20 "$B/api/batches" | python3 -c 'import json,sys;print((json.load(sys.stdin).get("batches") or [{}])[0].get("id",""))')
[ -n "$ID" ] || { echo "no run"; exit 1; }
echo "run $ID"

ask() { curl -sf --max-time 30 "$B/api/batch/$ID/replication?offset=0&limit=5" -o /tmp/uts-rt.json && python3 - <<'PY'
import json
d = json.load(open('/tmp/uts-rt.json'))
t = d.get('totals') or {}
if d.get('building'):
    print(f"BUILDING scanned={d.get('scanned',0)} of={d.get('of',0)}")
elif t.get('upToDate'):
    print(f"FRESH configs={d.get('configs')} rows={d.get('total')} top={d['scored'][0]['label'] if d.get('scored') else '(none)'}")
else:
    print(f"BEHIND asOf={t.get('asOfRows')} of={d.get('total')}")
if d.get('buildError'):
    print('BUILD ERROR:', d['buildError'])
PY
}

echo "== first ask (must return at once, never freeze) =="
T0=$(date +%s%N)
OUT=$(ask) || { echo "FAIL: the table endpoint did not answer"; exit 1; }
T1=$(date +%s%N)
echo "  $OUT"
echo "  answered in $(( (T1 - T0) / 1000000 )) ms"

if echo "$OUT" | grep -q '^FRESH'; then
  echo "== totals already fresh — timing three more asks =="
  for i in 1 2 3; do T0=$(date +%s%N); ask >/dev/null; T1=$(date +%s%N); echo "  ask $i: $(( (T1-T0)/1000000 )) ms"; done
  echo "EVERYTHING CHECKED OUT"
  exit 0
fi

echo "== while it builds: does everything else keep answering? =="
DEAD=0
for i in $(seq 1 80); do
  S=$(curl -s -o /dev/null -w '%{http_code}:%{time_total}' --max-time 10 "$B/construct.html" || echo "000:10")
  CODE=${S%%:*}; T=${S##*:}
  [ "$CODE" = 200 ] || DEAD=$((DEAD+1))
  if [ $((i % 8)) -eq 0 ]; then echo "  page $CODE in ${T}s · $(ask)"; fi
  P=$(ask)
  echo "$P" | grep -q '^FRESH' && { echo "  build finished: $P"; break; }
  echo "$P" | grep -q 'BUILD ERROR' && { echo "  FAIL: $P"; exit 1; }
  sleep 10
done
[ "$DEAD" = 0 ] && echo "  the pages answered every one of the checks while it built" \
                || { echo "  FAIL: the pages went quiet $DEAD time(s) during the build"; exit 1; }

echo "== and now it is instant =="
for i in 1 2 3; do T0=$(date +%s%N); OUT=$(ask); T1=$(date +%s%N); echo "  ask $i: $(( (T1-T0)/1000000 )) ms · $OUT"; done
echo "$OUT" | grep -q '^FRESH' && echo "EVERYTHING CHECKED OUT" || { echo "still not fresh — run this again to keep watching"; exit 2; }
