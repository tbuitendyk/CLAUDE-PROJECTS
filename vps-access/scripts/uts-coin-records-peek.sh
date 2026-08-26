#!/usr/bin/env bash
# uts-coin-records-peek.sh -- READ-ONLY. Prove the records button's path end
# to end on the box: take the top row of the every-coin view, ask for its
# records, and time the answer. Reads only the blocks the saved tally names.
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
curl -sf --max-time 30 "$B/api/batch/$ID/replication-coins?sort=share&minPairs=100&offset=0&limit=1" -o /tmp/uts-cr1.json \
  || { echo "the every-coin endpoint did not answer"; exit 1; }
Q=$(python3 <<'PY'
import json, urllib.parse
d = json.load(open("/tmp/uts-cr1.json"))
t = d.get("totals") or {}
if t.get("upToDate") and d.get("rows"):
    r = d["rows"][0]
    print(urllib.parse.urlencode({k: r.get(k) or "" for k in ("label", "trade", "ctx1", "ctx2", "geometry")}))
PY
)
if [ -z "$Q" ]; then
  python3 <<'PY'
import json
d = json.load(open("/tmp/uts-cr1.json"))
scanned = d.get("scanned", 0)
of = d.get("of", 0)
print("not fresh yet: building=%s scanned=%s of %s" % (d.get("building"), format(scanned, ","), format(of, ",")))
if d.get("buildError"):
    print("BUILD ERROR:", d["buildError"])
PY
  exit 0
fi
python3 <<'PY'
import json
r = json.load(open("/tmp/uts-cr1.json"))["rows"][0]
ah = r.get("avgHold")
at = r.get("avgTrades")
ah = "-" if ah is None else "$%.2f" % ah
at = "-" if at is None else "%.1f" % at
print("top row: %s on %s %s - share %.1f%% (%s/%s), avg held-back %s, avg trades %s, rows %s"
      % (r["label"], r["trade"], r["geometry"], r["share"] * 100, r["beat"], r["pairs"], ah, at, r["rows"]))
PY
T0=$(date +%s%N)
curl -sf --max-time 30 "$B/api/batch/$ID/replication-coin-rows?$Q" -o /tmp/uts-cr2.json \
  || { echo "the records endpoint did not answer"; exit 1; }
T1=$(date +%s%N)
python3 - "$(( (T1 - T0) / 1000000 ))" <<'PY'
import json, sys
d = json.load(open('/tmp/uts-cr2.json'))
if d.get('indexed') is False:
    print("records not reachable:", d.get('why'))
else:
    print("records: %s row(s) in %s ms  namesFrom=%s  unnamed=%s" % (d.get('shown'), sys.argv[1], d.get('namesFrom'), d.get('unnamedRecords')))
    rec = d.get('recovery')
    if rec:
        print("recovery: going=%s  %s of %s rows" % (rec.get('going'), format(rec.get('scanned', 0), ','), format(rec.get('of', 0), ',')))
        if rec.get('error'):
            print("RECOVERY ERROR:", rec['error'])
    for r in (d.get('rows') or [])[:20]:
        h = r.get('holdout') or {}
        w = r.get('weekdaysOnly')
        bc = r.get('beatCopies'); cp = r.get('copyPairs')
        share = '-' if bc is None or not cp else ('%.1f%% (%s/%s)' % (bc * 100.0 / cp, bc, cp))
        print("  %-7s band=%-5s 24/5=%-4s  band %s%%  beatCopies %-18s held-back $%.2f/%st"
              % (r.get('decision') or '-', r.get('bandMode') if r.get('bandMode') is not None else '-',
                 '-' if w is None else ('yes' if w else 'no'),
                 r.get('bandPct'), share, (h.get('pnl') or 0), h.get('trades')))
PY
printf 'an unrelated page during this: '
curl -s -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\n' --max-time 15 "$B/construct.html" || echo 'no answer in 15s'
