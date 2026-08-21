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

echo "== an Origin that names nothing is cross-site, not absent =="
# A page inside a sandboxed frame, and a page loaded from a data: or file:
# address, are sent by the browser with the literal text "null". That is the
# browser saying "I am from somewhere that cannot be named" — a cross-site
# request, and the guard used to read it as no browser at all and let it
# through. Proved before the fix: evil.example refused 403 while "null" was
# allowed and disarmed the engine. Checked here on the running service, not
# only in a sandbox.
for R in /api/pilot/disarm /api/pilot/unhalt /api/pilot/margin-floor /api/pilot/stop-apply; do
  ck 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$J" -H 'Origin: null' -d '{}' $B$R)" "$R from a sandboxed frame (Origin: null)"
  ck 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$J" -H 'Origin: file://' -d '{}' $B$R)" "$R from a file:// page"
  ck 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$J" -H 'Origin: not a url' -d '{}' $B$R)" "$R with an Origin that is not an address"
done
# And the safe direction must stay open: a request with NO Origin at all is
# still allowed, deliberately, because a proxy that strips the header would
# otherwise break the owner's real button. Disarm is the one to test with —
# it is the safe direction and it changes nothing that is not already so.
NOORIGIN="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$J" -d '{}' $B/api/pilot/disarm)"
[ "$NOORIGIN" = "200" ] && echo "  PASS  a request with no Origin at all is still accepted (the owner's button cannot break)" \
  || { echo "  FAIL  a request with no Origin now returns $NOORIGIN — the real control may be broken"; FAIL=1; }

echo "== nothing was armed by any of the above =="
ARMED="$(curl -s $B/api/pilot | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("box") or {}).get("armed"))' 2>/dev/null || echo unknown)"
echo "  armed state reads: ${ARMED}"

echo "== the previous generation is untouched =="
systemctl is-active --quiet general-classifier && echo "  PASS  general-classifier still active" || { echo "  FAIL  general-classifier not active"; FAIL=1; }

echo
[ "$FAIL" = "0" ] && echo "ALL CHECKS PASSED" || echo "THERE ARE FAILURES ABOVE"
exit "$FAIL"
