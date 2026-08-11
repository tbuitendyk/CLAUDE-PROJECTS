#!/usr/bin/env bash
# pilot-arm-fields.sh -- parse + SHAPE-VALIDATE the owner's arm-request.json and
# emit a SAFE `want nonce utc hmac` tuple for the master-switch reconcile.
#
# WHY THIS EXISTS (control-plane hardening, 2026-08-11 e2e review, CONTROL BUG 1):
# the three token fields are interpolated into the remote shell that toggles the
# LIVE trading box's master switch. ssh flattens its command into one string the
# remote shell re-parses, so a value carrying a quote/semicolon/backtick could
# break out and run arbitrary commands ON THE TRADING BOX. The fields are minted
# server-side as fixed-shape tokens (nonce = 18 hex, hmac = 64 hex, utc =
# ISO-8601 UTC), so anything off-shape is corruption or tampering.
#
# FAIL-SAFE RULE: if the request says armed:true but ANY field is off-shape (or
# the file is missing/unparseable), we DO NOT arm — we emit a DISARM tuple
# ('0 - - -'). A disarm is unconditional on the box and ignores the tokens, so a
# disarm never needs validation and can never be turned into an injection.
#
# Usage: pilot-arm-fields.sh <arm-request.json>
#   stdout: one line, "want nonce utc hmac" (want is 1 only for a VALID arm).
#   A missing/unreadable/off-shape arm always degrades to "0 - - -".
set -uo pipefail

disarm() { printf '0 - - -\n'; exit 0; }

REQ="${1:-}"
[ -n "$REQ" ] && [ -f "$REQ" ] || disarm

read -r want nonce utc hmac < <(python3 - "$REQ" <<'PY'
import json, sys
def s(v):
    return str(v) if v not in (None, "") else "-"
try:
    d = json.load(open(sys.argv[1]))
    print(("1" if d.get("armed") else "0"), s(d.get("nonce")), s(d.get("utc")), s(d.get("hmac")))
except Exception:
    print("0", "-", "-", "-")
PY
) || disarm

# Only an ARM carries authorization tokens into the remote shell, so only an ARM
# is gated. A stray space/newline inside a field also lands here: `read` mis-splits
# it, the pieces fail the strict patterns, and we degrade to disarm (fail-safe).
if [ "$want" = "1" ]; then
  printf '%s' "$nonce" | grep -qE '^[0-9a-f]{18}$' || disarm
  printf '%s' "$hmac"  | grep -qE '^[0-9a-f]{64}$' || disarm
  printf '%s' "$utc"   | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$' || disarm
fi

printf '%s %s %s %s\n' "$want" "$nonce" "$utc" "$hmac"
