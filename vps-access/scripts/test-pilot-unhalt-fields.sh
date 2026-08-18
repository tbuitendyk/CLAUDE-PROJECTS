#!/usr/bin/env bash
# test-pilot-unhalt-fields.sh -- watched-failing test for the unhalt carry
# (2026-08-18). Proves pilot-unhalt-fields.sh only ever emits a carry line for a
# request that is well-formed, SIGNED, fresh and not already spent — and that
# everything else degrades to the fail-safe '0 - - -', which leaves the halt on.
#
# The stakes: this decides whether a brake gets removed. Every refusal below is
# a case where the halt must STAY.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUT="$HERE/pilot-unhalt-fields.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0

GOOD_NONCE="0123456789abcdef01"                     # 18 hex, as the server mints
GOOD_HMAC="$(printf 'a%.0s' {1..64})"               # 64 hex
NOW_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OLD_UTC="$(date -u -d '2 hours ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
           || date -u -v-2H +%Y-%m-%dT%H:%M:%SZ)"
FUTURE_UTC="$(date -u -d '1 hour' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
              || date -u -v+1H +%Y-%m-%dT%H:%M:%SZ)"

writereq() { printf '%s' "$1" > "$TMP/req.json"; }
writeseen() { printf '%s' "$1" > "$TMP/seen.json"; }
run() { bash "$SUT" "$TMP/req.json" "$TMP/seen.json"; }

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

rm -f "$TMP/seen.json"

# 1) the happy path: signed, fresh, unspent -> carried, fields intact
writereq "{\"nonce\":\"$GOOD_NONCE\",\"utc\":\"$NOW_UTC\",\"hmac\":\"$GOOD_HMAC\"}"
expect "signed + fresh + unspent is carried" "1 $GOOD_NONCE $NOW_UTC $GOOD_HMAC"

# 2) UNSIGNED: the classifier omits the hmac when no secret is set on the VPS.
#    Carrying it would burn the consume-once slot on a guaranteed rejection.
writereq "{\"nonce\":\"$GOOD_NONCE\",\"utc\":\"$NOW_UTC\"}"
expect "an unsigned request is refused" "0 - - -"

# 3) INJECTION: these fields are interpolated into a remote shell.
writereq "{\"nonce\":\"$GOOD_NONCE\",\"utc\":\"$NOW_UTC\",\"hmac\":\"x'; touch $TMP/pwned; echo '\"}"
expect "hmac carrying a shell break-out is refused" "0 - - -"
writereq "{\"nonce\":\"a'; touch $TMP/pwned2; echo '\",\"utc\":\"$NOW_UTC\",\"hmac\":\"$GOOD_HMAC\"}"
expect "nonce carrying a shell break-out is refused" "0 - - -"
for p in "$TMP/pwned" "$TMP/pwned2"; do
  [ -e "$p" ] && { echo "FAIL - injection EXECUTED ($p exists)"; fail=1; }
done

# 4) STALE: a request left on disk must not clear a halt that fired later
writereq "{\"nonce\":\"$GOOD_NONCE\",\"utc\":\"$OLD_UTC\",\"hmac\":\"$GOOD_HMAC\"}"
expect "a stale request is refused" "0 - - -"

# 5) FUTURE-DATED: refused two-sided, as the arm path is
writereq "{\"nonce\":\"$GOOD_NONCE\",\"utc\":\"$FUTURE_UTC\",\"hmac\":\"$GOOD_HMAC\"}"
expect "a future-dated request is refused" "0 - - -"

# 6) CONSUME-ONCE: the same nonce must not be carried twice, or every sync
#    forever would re-clear the halt.
writereq "{\"nonce\":\"$GOOD_NONCE\",\"utc\":\"$NOW_UTC\",\"hmac\":\"$GOOD_HMAC\"}"
writeseen "{\"nonce\":\"$GOOD_NONCE\",\"carriedAt\":\"$NOW_UTC\"}"
expect "an already-carried nonce is refused" "0 - - -"

# 7) ...but a NEW nonce after that one is spent is carried again
NEW_NONCE="fedcba987654321010"
writereq "{\"nonce\":\"$NEW_NONCE\",\"utc\":\"$NOW_UTC\",\"hmac\":\"$GOOD_HMAC\"}"
expect "a new nonce after a spent one is carried" "1 $NEW_NONCE $NOW_UTC $GOOD_HMAC"

# 8) garbage / absent input degrades to refuse, never to a crash or a carry
rm -f "$TMP/seen.json"
writereq "not json at all"
expect "unparseable request is refused" "0 - - -"
rm -f "$TMP/req.json"
expect "a missing request file is refused" "0 - - -"

echo
[ "$fail" = 0 ] && echo "ALL PASS" || echo "FAILURES PRESENT"
exit "$fail"
