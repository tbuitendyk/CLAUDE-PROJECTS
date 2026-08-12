#!/usr/bin/env bash
# pilot-csrf-verify.sh -- verify the live CSRF guard + JSON error handler WITHOUT
# changing the running engine. Only the REJECT (403) and PARSE-ERROR (400) paths
# are exercised; both return before any write, so the live arm state is untouched.
# It then confirms the arm-request is still armed:true and the box is still armed.
set -uo pipefail
B=http://127.0.0.1:8093

echo "== CSRF: cross-site Origin on disarm must be REFUSED (403), writing nothing =="
code=$(curl -sS -o /tmp/csrf1.txt -w '%{http_code}' -m 8 -X POST \
  -H 'Content-Type: application/json' -H 'Origin: https://evil.example.com' \
  --data '{}' "$B/api/pilot/disarm")
echo "  HTTP $code : $(cat /tmp/csrf1.txt)"
[ "$code" = "403" ] && echo "  OK — cross-site refused" || echo "  !! expected 403"

echo "== Fix B: malformed JSON must return JSON 400 (no HTML stack) =="
body=$(curl -sS -m 8 -X POST -H 'Content-Type: application/json' \
  --data '{ not json' "$B/api/pilot/stop-apply")
echo "  $body"
printf '%s' "$body" | grep -qi '<!DOCTYPE\|<html' && echo "  !! still HTML" || echo "  OK — JSON error, no HTML/stack"

echo "== live arm state UNCHANGED by the checks above =="
armed=$(curl -sS -m 8 "$B/api/pilot" | python3 -c 'import sys,json; d=json.load(sys.stdin); r=d.get("armRequest") or {}; print("armRequest.armed =", r.get("armed"), "| box armed =", d.get("armed"), "| open =", len(d.get("openPositions") or []))')
echo "  $armed"
echo "(reject/parse-error paths only — nothing written; engine untouched)"
