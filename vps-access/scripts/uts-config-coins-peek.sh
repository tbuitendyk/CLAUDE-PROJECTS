#!/usr/bin/env bash
# uts-config-coins-peek.sh -- READ-ONLY. What an opened ranked line now asks:
# one configuration's coins from the saved tally, timed. Changes nothing.
set -uo pipefail
B=http://127.0.0.1:8094
ID=$(curl -sf --max-time 20 "$B/api/batches" | python3 -c '
import json, sys, urllib.request
ids = [b.get("id") for b in (json.load(sys.stdin).get("batches") or []) if b.get("id")]
best, most = "", -1
for i in ids[:10]:
    try:
        d = json.load(urllib.request.urlopen("http://127.0.0.1:8094/api/batch/" + i, timeout=15))
        doc = d.get("batch") or d
        n = ((doc.get("rowCounts") or {}).get("replication")) or 0
    except Exception:
        n = 0
    if n > most: best, most = i, n
print(best)')
[ -n "$ID" ] || { echo "no run"; exit 1; }
echo "run: $ID"
curl -sf --max-time 30 "$B/api/batch/$ID/replication?offset=0&limit=1" -o /tmp/uts-cc0.json \
  || { echo "the ranked list endpoint did not answer"; exit 1; }
LABEL=$(python3 -c '
import json
d = json.load(open("/tmp/uts-cc0.json"))
rows = d.get("scored") or []
print(rows[0]["label"] if rows else "")')
if [ -z "$LABEL" ]; then
  python3 -c '
import json
d = json.load(open("/tmp/uts-cc0.json"))
print("no ranked rows yet: building=%s scanned=%s of %s" % (d.get("building"), format(d.get("scanned",0),","), format(d.get("of",0),",")))'
  exit 0
fi
echo "top configuration: $LABEL"
T0=$(date +%s%N)
curl -sf --max-time 30 -G "$B/api/batch/$ID/replication-coins" \
  --data-urlencode "label=$LABEL" --data-urlencode "offset=0" --data-urlencode "limit=5" -o /tmp/uts-cc1.json \
  || { echo "the coins-by-label ask did not answer"; exit 1; }
T1=$(date +%s%N)
python3 - "$(( (T1 - T0) / 1000000 ))" <<'PY'
import json, sys
d = json.load(open('/tmp/uts-cc1.json'))
t = d.get('totals') or {}
if d.get('building') and not (d.get('rows') or []):
    print("totalling: %s of %s rows" % (format(d.get('scanned',0),','), format(d.get('of',0),',')))
else:
    pg = d.get('page') or {}
    print("answered in %s ms: %s coin(s) for this configuration, %s shown, fresh=%s" %
          (sys.argv[1], pg.get('total'), pg.get('shown'), t.get('upToDate')))
    for r in (d.get('rows') or []):
        av = r.get('avgVsLong')
        print("  %s %s  share %.1f%% (%s/%s)  avg held-back $%.2f  avg trades %.1f  avg vsL %s  rows %s" %
              (r.get('trade'), r.get('geometry'), (r.get('share') or 0) * 100, r.get('beat'), r.get('pairs'),
               r.get('avgHold') or 0, r.get('avgTrades') or 0,
               '-' if av is None else '$%.2f' % av, r.get('rows')))
PY
printf 'an unrelated page during this: '
curl -s -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\n' --max-time 15 "$B/construct.html" || echo 'no answer in 15s'
