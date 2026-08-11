#!/usr/bin/env bash
# test-pilot-arm-fields.sh -- watched-failing test for CONTROL BUG 1 (2026-08-11).
# Proves pilot-arm-fields.sh refuses to pass any off-shape / injection-bearing
# arm request into the master-switch reconcile: an armed:true request with a
# malicious token degrades to a fail-safe disarm ('0 - - -'), while a genuine
# well-formed arm passes through unchanged.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUT="$HERE/pilot-arm-fields.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0

# canonical-shape tokens the server actually mints
GOOD_NONCE="0123456789abcdef01"                                              # 18 hex
GOOD_HMAC="$(printf 'a%.0s' {1..64})"                                        # 64 hex
GOOD_UTC="2026-08-11T12:34:56.789Z"                                         # ISO-8601 UTC

writereq() { printf '%s' "$2" > "$TMP/req.json"; }
run()      { bash "$SUT" "$TMP/req.json"; }

expect() { # <label> <expected-line>
  local label="$1" want="$2" got
  got="$(run)"
  if [ "$got" = "$want" ]; then
    echo "ok   - $label"
  else
    echo "FAIL - $label"
    echo "        expected: [$want]"
    echo "        got:      [$got]"
    fail=1
  fi
}

# 1) a genuine, well-formed arm passes through unchanged
writereq _ "{\"armed\":true,\"nonce\":\"$GOOD_NONCE\",\"utc\":\"$GOOD_UTC\",\"hmac\":\"$GOOD_HMAC\"}"
expect "well-formed arm passes through" "1 $GOOD_NONCE $GOOD_UTC $GOOD_HMAC"

# 2) INJECTION: hmac carrying a shell break-out must NOT reach the reconcile
writereq _ "{\"armed\":true,\"nonce\":\"$GOOD_NONCE\",\"utc\":\"$GOOD_UTC\",\"hmac\":\"x'; touch $TMP/pwned; echo '\"}"
expect "injection in hmac -> fail-safe disarm" "0 - - -"
[ -e "$TMP/pwned" ] && { echo "FAIL - injection payload executed (pwned marker present)"; fail=1; }

# 3) injection in nonce
writereq _ "{\"armed\":true,\"nonce\":\"\$(reboot)\",\"utc\":\"$GOOD_UTC\",\"hmac\":\"$GOOD_HMAC\"}"
expect "injection in nonce -> fail-safe disarm" "0 - - -"

# 4) off-shape utc (not ISO) -> disarm
writereq _ "{\"armed\":true,\"nonce\":\"$GOOD_NONCE\",\"utc\":\"whenever\",\"hmac\":\"$GOOD_HMAC\"}"
expect "off-shape utc -> fail-safe disarm" "0 - - -"

# 5) short hmac (63 hex) -> disarm
writereq _ "{\"armed\":true,\"nonce\":\"$GOOD_NONCE\",\"utc\":\"$GOOD_UTC\",\"hmac\":\"$(printf 'a%.0s' {1..63})\"}"
expect "truncated hmac -> fail-safe disarm" "0 - - -"

# 6) a DISARM request needs no tokens and is emitted as-is (unconditional on box)
writereq _ "{\"armed\":false}"
expect "disarm request -> 0 - - -" "0 - - -"

# 6b) RE-REVIEW BLOCKER: a clean-parsing armed:false request CARRYING a malicious
# token must NOT pass it through — the disarm path is interpolated into the box's
# remote shell just like the arm path, so it must emit sentinels, not raw fields.
writereq _ "{\"armed\":false,\"nonce\":\"';reboot;'\"}"
expect "disarm with injection payload -> fail-safe sentinels" "0 - - -"

# 7) missing file -> fail-safe disarm
rm -f "$TMP/req.json"
got="$(bash "$SUT" "$TMP/req.json")"
[ "$got" = "0 - - -" ] && echo "ok   - missing request -> fail-safe disarm" \
  || { echo "FAIL - missing request: got [$got]"; fail=1; }

echo "----"
[ "$fail" = 0 ] && { echo "ALL PASS"; exit 0; } || { echo "FAILURES"; exit 1; }
