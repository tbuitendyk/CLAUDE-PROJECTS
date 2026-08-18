#!/usr/bin/env bash
# classifier-asset-check.sh -- READ-ONLY: is the JavaScript the browser will
# actually FETCH the JavaScript we just deployed?
#
# The page loads its script as constructing.js?v=1 — a FIXED query string. The
# browser caches by full URL, so that marker never changing means a returning
# browser can keep serving the copy it cached days ago no matter how many times
# we deploy. "Deployed" and "what the owner is looking at" are then two different
# things, and every fix reads as not-applied.
#
# Prints the version marker in the HTML, the caching headers the service sends
# for the script, and whether a few recent changes are present in the file being
# served right now.
set -uo pipefail
B=http://127.0.0.1:8093
echo "== the marker the page asks for =="
curl -sS -m 15 "$B/constructing.html" | grep -o 'constructing\.js?[^"]*' || echo "  (no query marker)"
curl -sS -m 15 "$B/trading.html" | grep -o 'trading[^"]*\.js?[^"]*' || echo "  (trading has no external script)"
echo "== caching headers on the script =="
curl -sS -m 15 -D - -o /dev/null "$B/constructing.js" | grep -iE '^(etag|last-modified|cache-control|content-length)' || true
echo "== markers present in the file being served NOW =="
JS=$(curl -sS -m 20 "$B/constructing.js")
for m in 'cxCampPick' 'rankDeclaredConfigs' 'renderRotationRounds' 'const COL = {'; do
  printf '  %-24s %s\n' "$m" "$(printf '%s' "$JS" | grep -qF -- "$m" && echo present || echo ABSENT)"
done
echo "(read-only)"
