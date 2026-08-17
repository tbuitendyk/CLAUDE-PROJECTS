#!/usr/bin/env bash
# classifier-sweep-verify.sh -- READ-ONLY: confirm the DEPLOYED Constructing
# Sweep form carries the backend's value vocabulary. Greps the asset the app
# actually serves on 127.0.0.1:8093, not the Basic-Auth'd public URL.
set -uo pipefail
JS=$(curl -sS -m 15 http://127.0.0.1:8093/constructing.js)
# the page markup is a SEPARATE file — a control in the HTML is invisible to a
# grep over the JS, which is exactly how this check reported cpubtn missing when
# it was deployed and working (2026-08-17)
JS="$JS
$(curl -sS -m 15 http://127.0.0.1:8093/constructing.html)" 
echo "bytes: ${#JS}"
echo "== must be PRESENT =="
for p in 'renderHtRun' 'renderPlateau' 'renderNullVerdict' 'data-ht-grade' 'data-inspect' 'id="bNotes"' 'id="t1fire"' 'id="tuneTarget"' 'id="cpubtn"' 'Asset predictability' 'vsNullsCell' 'value="12mo"' 'NOTHING WAS HELD BACK' 'unit(s) FAILED' 'INFERRED, not measured' 'cx-theme' 'id="swPermDecArmWrap"' 'declared configs, ranked' 'id="swPermDecAgree"' 'declaredPermute' 'id="swDecCount"' 'Replication — the declared config' 'value="region">widest region' 'id="bSort"' 'l.region.size' 'id="swDecOn"' 'id="swDecQ8"' 'quorumContexts' 'declared.entry\|body.declared' 'value="split70"' 'value="reserve61"' 'value="legacy80"' 'value="weekly-8d"' \
         'max="50"' 'max="24"' 'all 17 default pairs' "value || undefined"; do
  c=$(printf '%s' "$JS" | grep -c -- "$p")
  printf '  %-28s %s\n' "$p" "$([ "$c" -gt 0 ] && echo "OK ($c)" || echo 'MISSING')"
done
echo "== must be GONE =="
for p in 'lt-theme' 'over the 500 cap' 'value="70/15/15"' 'value="61/13/13/13"' 'value="legacy"><' 'blank = all cached'; do
  c=$(printf '%s' "$JS" | grep -c -- "$p")
  printf '  %-28s %s\n' "$p" "$([ "$c" -eq 0 ] && echo 'OK (gone)' || echo "STILL PRESENT ($c)")"
done
echo "(read-only)"
