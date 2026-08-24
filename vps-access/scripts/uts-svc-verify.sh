#!/usr/bin/env bash
# uts-svc-verify.sh -- proves the service control does the one thing it exists
# for: keep working when the trading service is not.
#
# IT BRIEFLY STOPS THE TRADING SERVICE and starts it again, THROUGH THE CONTROL
# ITSELF, so what is proved is the real path and not a description of it. It
# refuses to start if a sweep is going. Whatever happens, the last thing it does
# is make sure the trading service is back up -- by systemctl directly, not
# through the control, so a broken control cannot leave it down.
#
# Nothing else is touched. No data is written.
set -uo pipefail
FAIL=0
say() { printf '%s\n' "$*"; }
chk() { # chk <what> <expected-code> <url>
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$3" 2>/dev/null)
  if [ "$code" = "$2" ]; then say "  ok    $1 ($code)"; else say "  FAIL  $1 — got $code, wanted $2"; FAIL=1; fi
}

say "== nothing may be going =="
if curl -sf --max-time 20 http://127.0.0.1:8094/api/batches 2>/dev/null | grep -q '"running":[^n]'; then
  say "REFUSING: a run is going. Nothing has been touched."; exit 1
fi
say "  ok    no run is going"

say "== with the trading service UP =="
chk "the trading service answers"        200 http://127.0.0.1:8094/construct.html
chk "the control answers"                200 http://127.0.0.1:8095/api/services
chk "the control serves the pages too"   200 http://127.0.0.1:8095/construct.html
chk "and from the second address"        200 http://127.0.0.1:8095/svc/api/services

say "== stopping the trading service THROUGH the control =="
OUT=$(curl -s --max-time 60 -X POST http://127.0.0.1:8095/api/service \
  -H 'Content-Type: application/json' \
  -d '{"unit":"ultimate-trading-system.service","action":"stop","confirm":"ultimate-trading-system.service"}')
say "  $OUT"
sleep 2

say "== with the trading service DOWN — this is the whole point =="
chk "the trading service is gone, as expected"  000 http://127.0.0.1:8094/construct.html
chk "the control still answers"                 200 http://127.0.0.1:8095/api/services
chk "and still serves the pages"                200 http://127.0.0.1:8095/construct.html
if curl -s --max-time 25 http://127.0.0.1:8095/api/services | grep -q '"unit":"ultimate-trading-system.service"'; then
  STATE=$(curl -s --max-time 25 http://127.0.0.1:8095/api/services \
    | python3 -c 'import json,sys;d=json.load(sys.stdin);u=[x for x in d["units"] if x["unit"]=="ultimate-trading-system.service"][0];print(u["active"],u["sub"],u["answers"])' 2>/dev/null)
  say "  ok    and it reports it: $STATE"
else
  say "  FAIL  the control could not report on the service it just stopped"; FAIL=1
fi

say "== starting it again THROUGH the control =="
OUT=$(curl -s --max-time 60 -X POST http://127.0.0.1:8095/api/service \
  -H 'Content-Type: application/json' \
  -d '{"unit":"ultimate-trading-system.service","action":"start","confirm":"ultimate-trading-system.service"}')
say "  $OUT"
sleep 3
chk "the trading service is back"        200 http://127.0.0.1:8094/construct.html

say "== the refusals, asked for real =="
for U in nginx.service ssh.service uts-service-control.service deploy-control.service; do
  R=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 -X POST http://127.0.0.1:8095/api/service \
    -H 'Content-Type: application/json' -d "{\"unit\":\"$U\",\"action\":\"stop\",\"confirm\":\"$U\"}")
  if [ "$R" = "409" ]; then say "  ok    stopping $U refused (409)"; else say "  FAIL  stopping $U answered $R, and it is still running: $(systemctl is-active "$U")"; FAIL=1; fi
done
R=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 -X POST http://127.0.0.1:8095/api/service \
  -H 'Content-Type: application/json' -d '{"unit":"ultimate-trading-system.service","action":"stop","confirm":"wrong"}')
if [ "$R" = "400" ]; then say "  ok    a request that does not name it twice is refused (400)"; else say "  FAIL  naming it once answered $R"; FAIL=1; fi

# WHATEVER HAPPENED ABOVE, the trading service goes back up -- by systemctl
# directly, so a control that has broken cannot leave it down.
say "== putting things back, without the control =="
systemctl start ultimate-trading-system 2>/dev/null
sleep 2
for U in ultimate-trading-system general-classifier nginx uts-service-control ssh; do
  printf '  %-26s %s\n' "$U" "$(systemctl is-active "$U" 2>/dev/null)"
done
chk "the trading service answers again"  200 http://127.0.0.1:8094/construct.html

say ""
[ "$FAIL" = 0 ] && say "EVERYTHING CHECKED OUT" || say "SOMETHING FAILED — read the FAIL lines above"
exit "$FAIL"
