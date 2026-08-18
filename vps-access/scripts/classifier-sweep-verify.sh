#!/usr/bin/env bash
# classifier-sweep-verify.sh -- READ-ONLY: confirm the DEPLOYED Constructing
# Sweep form carries the backend's value vocabulary. Greps the asset the app
# actually serves on 127.0.0.1:8093, not the Basic-Auth'd public URL.
set -uo pipefail
# STRIP LINE COMMENTS before grepping. A comment recording a fixed defect names
# the old expression, so a must-be-GONE check matches its own documentation and
# reports the bug as still present (seen 2026-08-17 on s.verdict). A verifier
# that cries wolf gets ignored, which is worse than not having it.
JS=$(curl -sS -m 15 http://127.0.0.1:8093/constructing.js | sed 's|^[[:space:]]*//.*$||')
# the page markup is a SEPARATE file — a control in the HTML is invisible to a
# grep over the JS, which is exactly how this check reported cpubtn missing when
# it was deployed and working (2026-08-17)
JS="$JS
$(curl -sS -m 15 http://127.0.0.1:8093/constructing.html)" 
echo "bytes: ${#JS}"
echo "== must be PRESENT =="
for p in "s.state || 'NOT CHECKED'" 'gatePoll' 'nullShare' 'CONTEXT, NOT EVIDENCE' 'only sanctioned yardstick' 'renderHtRun' 'renderPlateau' 'renderNullVerdict' 'data-ht-grade' 'data-inspect' 'id="bNotes"' 'id="t1fire"' 'id="tuneTarget"' 'id="cpubtn"' 'Asset predictability' 'vsNullsCell' 'value="12mo"' 'NOTHING WAS HELD BACK' 'unit(s) FAILED' 'INFERRED, not measured' 'cx-theme' 'id="swPermDecArmWrap"' 'declared configs, ranked' 'id="swPermDecAgree"' 'declaredPermute' 'id="swDecCount"' 'Replication — the declared config' 'value="region">widest region' 'id="bSort"' 'l.region.size' 'id="swDecOn"' 'id="swDecQ8"' 'quorumContexts' 'declared.entry\|body.declared' 'value="split70"' 'value="reserve61"' 'value="legacy80"' 'value="weekly-8d"' \
         'max="50"' 'max="24"' 'all 17 default pairs' "value || undefined" \
         '<select id="t1null"' '<select id="cmpA"' '<select id="cmpB"' 'verdict-sources' 'scrambleDraws > 0' 'realRows > 0' 'comboOf' 'ctx1: sel.ctx1' 'THIS SCREEN IS INCOMPLETE' 'apiOr' 'cxCampPick' 'Promise.resolve(section)'; do
  c=$(printf '%s' "$JS" | grep -c -- "$p")
  printf '  %-28s %s\n' "$p" "$([ "$c" -gt 0 ] && echo "OK ($c)" || echo 'MISSING')"
done
echo "== must be GONE =="
for p in 's.verdict || s.status' 'const binom =' 'lt-theme' 'over the 500 cap' 'value="70/15/15"' 'value="61/13/13/13"' 'value="legacy"><' 'blank = all cached' \
         '<input id="t1null"' '<input id="cmpA"' '<input id="cmpB"' "if (tab === 'data') drawData()"; do
  c=$(printf '%s' "$JS" | grep -c -- "$p")
  printf '  %-28s %s\n' "$p" "$([ "$c" -eq 0 ] && echo 'OK (gone)' || echo "STILL PRESENT ($c)")"
done
echo "(read-only)"
