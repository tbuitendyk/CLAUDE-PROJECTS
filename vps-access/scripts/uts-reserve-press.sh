#!/usr/bin/env bash
# uts-reserve-press.sh -- PRESSES the reserve grade on the one Stage 4 record
# set on this box (owner order, 2026-09-08: "run the reserve data through those
# one hundred and ninety nine setups ... give me the dollars"). This SPENDS A
# LOOK at the sealed window and appends a grade that is never overwritten.
# Refuses if there is more than one Stage 4 set, if the set refuses, or if a
# grade is already running. Polls until it lands or the call runs out of time;
# uts-reserve-dollars.sh prints the result either way.
set -uo pipefail
B=http://127.0.0.1:8094
curl -sf --max-time 25 "$B/api/stagesets" -o /tmp/uts-rp-sets.json || { echo "the record-set list did not answer"; exit 1; }
IDS=$(python3 -c 'import json;print(" ".join(s["id"] for s in (json.load(open("/tmp/uts-rp-sets.json")).get("sets") or []) if s.get("stage")==4))')
N=$(printf '%s' "$IDS" | wc -w)
if [ "$N" -ne 1 ]; then echo "REFUSING: expected exactly one Stage 4 record set, found $N ($IDS)"; exit 3; fi
ID=$IDS
curl -sf --max-time 90 "$B/api/funnel/set/$ID/unread" -o /tmp/uts-rp-dry.json || { echo "the dry read did not answer"; exit 1; }
WHY=$(python3 -c 'import json;print(json.load(open("/tmp/uts-rp-dry.json")).get("refused") or "")')
if [ -n "$WHY" ]; then echo "REFUSING: $WHY"; exit 3; fi
LOOKS=$(python3 -c 'import json;print(json.load(open("/tmp/uts-rp-dry.json")).get("looks") or 0)')
echo "pressing the reserve grade on $ID -- look $((LOOKS + 1))"
curl -sS --max-time 60 -X POST -H 'Content-Type: application/json' -d '{}' "$B/api/funnel/set/$ID/unread" -o /tmp/uts-rp-start.json
python3 -c 'import json;d=json.load(open("/tmp/uts-rp-start.json"));print("  started:", json.dumps({k:d.get(k) for k in ("running","token","done","of","error")}))'
for i in $(seq 1 100); do
  sleep 5
  curl -sf --max-time 30 "$B/api/funnel/set/$ID/unread/status" -o /tmp/uts-rp-st.json || continue
  python3 - <<'PY'
import json
d = json.load(open('/tmp/uts-rp-st.json'))
if d.get('error'): print('  FAILED:', d['error']); raise SystemExit(9)
if d.get('result'): print('  landed:', json.dumps(d['result'])); raise SystemExit(8)
print('  running... %s/%s, box load %s' % (d.get('done'), d.get('of'), (d.get('cpu') or {}).get('pct', '?')))
PY
  rc=$?
  [ $rc -eq 8 ] && { echo "done -- read the dollars with uts-reserve-dollars.sh"; exit 0; }
  [ $rc -eq 9 ] && exit 9
done
echo "still running after the poll window -- run uts-reserve-dollars.sh when it lands"
