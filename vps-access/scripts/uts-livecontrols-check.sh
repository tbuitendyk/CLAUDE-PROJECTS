#!/usr/bin/env bash
# uts-livecontrols-check.sh -- prove the two live-money controls behave, on the
# deployed system. Sends only requests that must be REFUSED, plus one read-only
# check. It never sends an arming request that could succeed.
set -uo pipefail
B=http://127.0.0.1:8094
J='Content-Type: application/json'
FAIL=0
ck(){ local want="$1" got="$2" what="$3"; if [ "$got" = "$want" ]; then echo "  PASS  $what (HTTP $got)"; else echo "  FAIL  $what — wanted $want, got $got"; FAIL=1; fi; }

# THE BODIES MUST BE VALID JSON. The first version of this script escaped the
# quotes, so every request was malformed and got a 400 from the JSON parser
# before it ever reached the control being tested — four checks passed for
# entirely the wrong reason. Prove the payloads parse before trusting anything.
for body in '{}' '{"armed":false}' '{"armed":"true"}' '{"stopPct":0.02}'; do
  echo "$body" | python3 -m json.tool >/dev/null 2>&1 || { echo "  FAIL  test payload is not valid JSON: $body"; FAIL=1; }
done

echo "== the master switch refuses anything that is not an explicit yes =="
ck 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$J" -d '{}' $B/api/pilot/arm)"                "an empty request"
ck 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/pilot/arm)"                                 "no request body at all"
ck 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$J" -d '{"armed":false}' $B/api/pilot/arm)"  "a request saying false"
ck 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$J" -d '{"armed":"true"}' $B/api/pilot/arm)" "the word true rather than the value"
echo "  (an actual arming request is deliberately NOT sent by this check)"

echo "== the protective stop refuses silence, and refuses another site =="
ck 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$J" -d '{}' $B/api/pilot/stop-apply)"          "an empty request"
ck 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$J" -H 'Origin: https://evil.example.com' -d '{"stopPct":0.02}' $B/api/pilot/stop-apply)" "a request from another site"

echo "== nothing was armed by any of the above =="
ARMED="$(curl -s $B/api/pilot | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("box") or {}).get("armed"))' 2>/dev/null || echo unknown)"
echo "  armed state reads: ${ARMED}"

echo "== the previous generation is untouched =="
systemctl is-active --quiet general-classifier && echo "  PASS  general-classifier still active" || { echo "  FAIL  general-classifier not active"; FAIL=1; }

echo
[ "$FAIL" = "0" ] && echo "ALL CHECKS PASSED" || echo "THERE ARE FAILURES ABOVE"
exit "$FAIL"
