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
# Fetch to a FILE and check the byte count against the declared length before
# grepping. A partial body greps as "ABSENT" and reads exactly like a stale
# deploy — which is how this check first reported three fixes missing from a file
# that was byte-identical to the one just shipped. A verifier that cries wolf
# gets ignored, which is worse than not having one.
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
DECLARED=$(curl -sS -m 20 -D - -o "$TMP" "$B/constructing.js" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-length"{print $2}')
GOT=$(wc -c < "$TMP")
echo "  bytes: declared ${DECLARED:-?} / received $GOT"
if [ -n "$DECLARED" ] && [ "$DECLARED" != "$GOT" ]; then
  echo "  SHORT READ — the checks below would be meaningless; not run."
else
  for m in 'cxCampPick' 'rankDeclaredConfigs' 'renderRotationRounds' 'const COL = {'; do
    if grep -qF -- "$m" "$TMP"; then printf '  %-24s present\n' "$m"; else printf '  %-24s ABSENT\n' "$m"; fi
  done
fi
echo "(read-only)"
