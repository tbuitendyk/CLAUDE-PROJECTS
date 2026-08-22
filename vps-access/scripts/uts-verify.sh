#!/usr/bin/env bash
# uts-verify.sh -- prove the delivered thing, on the box, without guessing.
# Read-only: curls and systemctl status. Changes nothing.
set -uo pipefail
FAIL=0
ok(){ echo "  PASS  $1"; }
no(){ echo "  FAIL  $1"; FAIL=1; }

echo "== the previous generation is untouched =="
systemctl is-active --quiet general-classifier && ok "general-classifier: active" || no "general-classifier: NOT active"
curl -sf -o /dev/null http://127.0.0.1:8093/api/healthz && ok "8093 answers healthz" || no "8093 does NOT answer healthz"
[ -d /opt/general-classifier ] && ok "/opt/general-classifier still present" || no "/opt/general-classifier missing"

echo "== the new service =="
systemctl is-active --quiet ultimate-trading-system && ok "ultimate-trading-system: active" || no "ultimate-trading-system: NOT active"
curl -sf -o /dev/null http://127.0.0.1:8094/api/healthz && ok "8094 answers healthz" || no "8094 does NOT answer healthz"

echo "== the front door is the Setup tab =="
ROOT_HTML="$(curl -s http://127.0.0.1:8094/)"
echo "$ROOT_HTML" | grep -q '<title>Setup</title>' && ok "/ serves the Setup page" || no "/ does not serve Setup"
echo "$ROOT_HTML" | grep -q 'class="toptab on" href="setup.html">Setup<'   && ok "Setup tab present and marked current" || no "Setup tab not marked current"
echo "$ROOT_HTML" | grep -q 'class="toptab" href="construct.html">Construct<' && ok "Construct tab present" || no "Construct tab missing"
echo "$ROOT_HTML" | grep -q 'class="toptab" href="trade.html">Trade<'         && ok "Trade tab present" || no "Trade tab missing"
echo "$ROOT_HTML" | grep -q 'This page is deliberately empty' && ok "Setup page is blank as specified" || no "Setup page is not the blank one"

echo "== the other two tabs, with their functionality =="
for p in construct trade; do
  H="$(curl -s "http://127.0.0.1:8094/${p}.html")"
  echo "$H" | grep -q 'class="toptab' && ok "${p}.html carries the tab strip" || no "${p}.html has no tab strip"
done
curl -s http://127.0.0.1:8094/construct.html | grep -q '<title>Construct</title>' && ok "Construct titled Construct" || no "Construct title wrong"
curl -s http://127.0.0.1:8094/trade.html    | grep -q '<title>Trade</title>'     && ok "Trade titled Trade" || no "Trade title wrong"
CJ_CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8094/construct.js)"
CJ_SIZE="$(curl -s http://127.0.0.1:8094/construct.js | wc -c)"
[ "$CJ_CODE" = "200" ] && [ "$CJ_SIZE" -gt 100000 ] && ok "construct.js served (${CJ_CODE}, ${CJ_SIZE} bytes)" || no "construct.js: status ${CJ_CODE}, ${CJ_SIZE} bytes"
echo "  note: on disk -> $(ls -l /opt/ultimate-trading-system/public/ 2>/dev/null | tr -s ' ' | cut -d' ' -f5,9 | tr '\n' ' ')"

echo "== the choice lists the Construct page draws from =="
# Every dropdown on the Construct page is now drawn from this one answer
# (RULE FIVE, 2026-08-21). If it does not reply, every one of them draws
# "(choices unavailable)" and the page is unusable — so it is checked here
# rather than discovered at the screen.
VOC="$(curl -s -o /tmp/uts-voc.json -w '%{http_code}' http://127.0.0.1:8094/api/vocabulary)"
if [ "$VOC" = "200" ]; then
  N="$(python3 -c 'import json;d=json.load(open("/tmp/uts-voc.json"));print(len(d))' 2>/dev/null || echo 0)"
  [ "$N" -ge 13 ] && echo "  PASS  api/vocabulary serves $N choice lists" \
    || { echo "  FAIL  api/vocabulary serves only $N choice lists"; FAIL=1; }
  # The one that was actually missing from the screen before this existed.
  python3 -c 'import json,sys;d=json.load(open("/tmp/uts-voc.json"));sys.exit(0 if any(o["value"]=="161" for o in d.get("tHours",[])) else 1)' \
    && echo "  PASS  the 161-hour hold the engine implements is offered" \
    || { echo "  FAIL  the 161-hour hold is missing from the list again"; FAIL=1; }
else
  echo "  FAIL  api/vocabulary -> $VOC (every dropdown on Construct would be empty)"; FAIL=1
fi
rm -f /tmp/uts-voc.json

echo "== the Help tab =="
# Added 2026-08-21. The Help tab needs three things served, and it is the one
# page whose whole job is to explain the others — a silent failure there leaves
# the owner exactly where they were before it existed.
H="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8094/help-content.js)"
[ "$H" = "200" ] && ok "help-content.js served" || { echo "  FAIL  help-content.js -> $H"; FAIL=1; }
C="$(curl -s -o /tmp/uts-ctl.json -w '%{http_code}' http://127.0.0.1:8094/api/screen-controls)"
if [ "$C" = "200" ]; then
  N="$(python3 -c 'import json;d=json.load(open("/tmp/uts-ctl.json"));print(sum(len(t["controls"]) for t in d.values()))' 2>/dev/null || echo 0)"
  [ "$N" -ge 70 ] && ok "api/screen-controls lists $N controls" \
    || { echo "  FAIL  api/screen-controls lists only $N controls"; FAIL=1; }
else
  echo "  FAIL  api/screen-controls -> $C (the Help tab cannot tell what to describe)"; FAIL=1
fi
rm -f /tmp/uts-ctl.json
# Matched on the tab's own function name rather than a quoted pair: the quoting
# inside this heredoc did not survive, so this reported "no Help tab" while the
# tab was right there. A check that cries wolf about a working feature is worse
# than no check — it was the only FAIL on the board and it was its own fault.
curl -s http://127.0.0.1:8094/construct.js | grep -q "drawHelp" \
  && ok "Help is a tab on the Construct page" || { echo "  FAIL  no Help tab"; FAIL=1; }
# And the marker that decides whether a browser sees any of this must be built
# from the file, not from a version number nobody bumps. Without it a deploy
# never reaches a browser that already has the page — which is what hid the
# Help tab from the owner on the day it shipped.
curl -s http://127.0.0.1:8094/construct.html | grep -qE 'construct[.]js[?]v=[0-9a-f]{12}' \
  && ok "scripts are stamped with their own contents (a deploy reaches the browser)" \
  || { echo "  FAIL  construct.js is not content-stamped — a returning browser keeps the old copy"; FAIL=1; }

echo "== the departed screens are gone =="
for u in index.html app.js help.html api/tracker api/books api/dogebook api/rotations; do
  c="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8094/$u")"
  [ "$c" = "404" ] && ok "$u -> 404" || no "$u -> $c (expected 404)"
done

echo "== the surviving endpoints answer =="
for u in api/cpu api/data-state api/batches api/campaigns api/live/setups api/live/greenlights api/live/configs api/live/catalog api/planted-gate/status; do
  c="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8094/$u")"
  [ "$c" = "200" ] && ok "$u -> 200" || no "$u -> $c (expected 200)"
done

echo "== nothing came across from the previous project =="
# CHANGED 2026-08-21. This used to assert that data/live, data/campaigns and
# data/batches were EMPTY, to prove the migration inherited nothing. That was
# true at the migration and only then. The moment the owner used the system it
# went red — and it did, on the first calibration check — and it would have
# stayed red forever after. A deploy check that is permanently red is one
# nobody reads, and a real failure hides inside it.
#
# The guarantee worth keeping is not "empty". It is "nothing from the DEPARTED
# parts of the old project is here". That stays true however much the owner
# uses the system, and goes red only for something genuinely wrong.
CACHE="$(find /opt/ultimate-trading-system/data/cache -type f 2>/dev/null | wc -l)"
[ "$CACHE" -gt 0 ] && ok "candle cache carried across: ${CACHE} files" || no "no candle cache"

# The stores that belonged to the screens this release removed. Any of these
# appearing means something inherited, or something re-created them.
for d in books dogebook tracker rotations wf; do
  if [ -e "/opt/ultimate-trading-system/data/$d" ]; then
    no "data/$d exists — that belongs to a part of the old project this release removed"
  else
    ok "no data/$d (the departed screens left nothing behind)"
  fi
done

# What the system has built for itself since. Reported, never asserted: these
# grow with ordinary use and there is no number here that is right or wrong.
echo "  what this system holds now:"
for d in batches models ht live manifests pilot; do
  n="$(find "/opt/ultimate-trading-system/data/$d" -type f 2>/dev/null | wc -l)"
  printf "    %-12s %s file(s)\n" "$d" "$n"
done
echo "  note: data/ holds -> $(ls /opt/ultimate-trading-system/data 2>/dev/null | tr '\n' ' ')"

echo "== the portal tile =="
grep -q 'href="/uts/"' /var/www/www.buitendyk.ca/index.html && ok "tile links to /uts/" || no "no tile on the portal"
grep -q 'Ultimate Trading System' /var/www/www.buitendyk.ca/index.html && ok "tile is named Ultimate Trading System" || no "tile name missing"
grep -q 'href="/classifier/"' /var/www/www.buitendyk.ca/index.html && ok "the classifier tile is still there" || no "the classifier tile vanished"
for loc in uts classifier balancer semibalancer dubber; do
  c="$(curl -s -o /dev/null -w '%{http_code}' -k "https://127.0.0.1:4432/${loc}/" -H 'Host: www.buitendyk.ca')"
  { [ "$c" = "401" ] || [ "$c" = "200" ]; } && ok "/${loc}/ through nginx -> ${c}" || no "/${loc}/ through nginx -> ${c}"
done

echo
[ "$FAIL" = "0" ] && echo "ALL CHECKS PASSED" || echo "THERE ARE FAILURES ABOVE"
exit "$FAIL"
