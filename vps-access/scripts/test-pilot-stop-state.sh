#!/usr/bin/env bash
# test-pilot-stop-state.sh -- watched-failing test for CONTROL BUG 3/4 (2026-08-11).
# The load-bearing property: a PRESENT-but-corrupt fixed-stop.json must classify as
# ERROR (caller retains the box stop), NEVER as CLEAR (which would silently strip a
# protective stop). Also: full-precision SET (no .6f truncation-to-zero), and a
# genuine null/absent still CLEARs.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUT="$HERE/pilot-stop-state.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
F="$TMP/fixed-stop.json"
fail=0

expect() { # <label> <json-or-__ABSENT__> <expected>
  local label="$1" body="$2" want="$3" got
  if [ "$body" = "__ABSENT__" ]; then rm -f "$F"; else printf '%s' "$body" > "$F"; fi
  got="$(bash "$SUT" "$F")"
  if [ "$got" = "$want" ]; then echo "ok   - $label"
  else echo "FAIL - $label"; echo "        expected: [$want]"; echo "        got:      [$got]"; fail=1; fi
}

# valid live stop -> SET at full precision
expect "valid 0.349 -> SET full precision" '{"stopPct":0.349}'          "SET 0.3490000000"
# a tiny-but-representable value at the floor -> SET, NOT truncated to zero
expect "0.005 floor -> SET (not zero)"      '{"stopPct":0.005}'          "SET 0.0050000000"
# THE money bug: corrupt JSON must be ERROR (retain), never CLEAR
expect "corrupt JSON -> ERROR (retain)"     '{"stopPct":0.34,,,'         "ERROR"
expect "empty file -> ERROR (retain)"       ''                          "ERROR"
expect "non-object JSON -> ERROR (retain)"  '"just a string"'           "ERROR"
# below the 0.5% noise floor is off-shape -> ERROR, do NOT clear
expect "below floor 0.001 -> ERROR"         '{"stopPct":0.001}'          "ERROR"
expect ">=1 -> ERROR"                       '{"stopPct":1.5}'            "ERROR"
expect "bool stopPct -> ERROR"              '{"stopPct":true}'           "ERROR"
# genuine no-stop intents -> CLEAR
expect "null stopPct -> CLEAR"              '{"stopPct":null}'           "CLEAR"
expect "absent key -> CLEAR"                '{"by":"owner"}'             "CLEAR"
expect "zero stopPct -> CLEAR"              '{"stopPct":0}'              "CLEAR"
expect "absent file -> CLEAR"               '__ABSENT__'                "CLEAR"

echo "----"
[ "$fail" = 0 ] && { echo "ALL PASS"; exit 0; } || { echo "FAILURES"; exit 1; }
