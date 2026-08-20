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
curl -s http://127.0.0.1:8094/construct.js  | head -c 200 | grep -q . && ok "construct.js served" || no "construct.js not served"

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

echo "== this system starts from zero use, with the candles kept =="
CACHE="$(find /opt/ultimate-trading-system/data/cache -type f 2>/dev/null | wc -l)"
[ "$CACHE" -gt 0 ] && ok "candle cache carried across: ${CACHE} files" || no "no candle cache"
for d in live campaigns batches; do
  n="$(find "/opt/ultimate-trading-system/data/$d" -type f 2>/dev/null | wc -l)"
  [ "$n" = "0" ] && ok "data/$d is empty (nothing inherited)" || no "data/$d holds $n file(s)"
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
