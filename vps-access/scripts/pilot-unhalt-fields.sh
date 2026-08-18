#!/usr/bin/env bash
# pilot-unhalt-fields.sh -- decide whether the owner's unhalt-request.json should
# be carried to the box on THIS sync. Emits "1 <nonce> <utc> <hmac>" to carry,
# "0 - - -" otherwise.
#
# WHY THIS EXISTS: a halt never self-clears — a gate that fires says the
# instrument is unreliable, and auto-clearing would be the instrument marking its
# own homework. But the Trading tab now offers the owner a "clear the halt"
# button, and the request it writes sits on disk. Two rules keep that from
# becoming auto-clearing by the back door:
#
#   CONSUME-ONCE  the nonce must differ from the last one carried, or the same
#                 request would re-clear the halt on every sync forever.
#   FRESH         the request must be minted within the last 15 minutes, or a
#                 file left on disk would clear a halt that fired days later.
#
# Neither can arm anything: unhalt does not touch the master switch, so the worst
# a carried request does is let an ALREADY-ARMED box resume entries once its halt
# cause is fixed. If the cause is not fixed, the next reconcile tick re-halts.
#
# THE SIGNATURE IS THE REAL GATE (2026-08-18). The two rules above are applied
# on the VPS, so they bind only a well-behaved control plane. The HMAC the
# classifier mints over {unhalt,nonce,utc} is what the BOX checks, and the box
# re-applies freshness and replay itself against its own baseline. This script
# shape-gates the signature and forwards it; it does not verify it, and it is
# NOT the thing standing between a forged request and a cleared brake.
#
# Same shape discipline as pilot-arm-fields.sh: these fields are interpolated
# into a remote shell, so anything off-shape degrades to "do not carry".
#
# Usage: pilot-unhalt-fields.sh <unhalt-request.json> <unhalt-carried.json>
set -uo pipefail
skip() { printf '0 - - -\n'; exit 0; }

REQ="${1:-}"; SEEN="${2:-}"
[ -n "$REQ" ] && [ -f "$REQ" ] || skip

read -r nonce utc sig < <(python3 - "$REQ" <<'PYEOF'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    n = str(d.get("nonce") or "-")
    u = str(d.get("utc") or "-")
    h = str(d.get("hmac") or "-")
    print(n, u, h)
except Exception:
    print("-", "-", "-")
PYEOF
) || skip

printf '%s' "$nonce" | grep -qE '^[0-9a-f]{18}$' || skip
printf '%s' "$utc" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$' || skip
# An UNSIGNED request is refused HERE rather than sent for the box to refuse.
# The classifier omits the hmac only when PILOT_ARM_SECRET is unset on the VPS;
# carrying it anyway would put a guaranteed-rejected request on the wire and
# burn its consume-once slot for nothing.
printf '%s' "$sig" | grep -qE '^[0-9a-f]{64}$' || skip

# already carried? then this request is spent.
if [ -n "$SEEN" ] && [ -f "$SEEN" ]; then
  prev=$(python3 -c 'import json,sys
try: print(json.load(open(sys.argv[1])).get("nonce") or "-")
except Exception: print("-")' "$SEEN" 2>/dev/null || echo -)
  [ "$prev" = "$nonce" ] && skip
fi

# fresh? (two-sided: a future-dated stamp is refused too, as the arm path does)
fresh=$(python3 -c 'import calendar,sys,time
try:
    age = time.time() - calendar.timegm(time.strptime(sys.argv[1][:19], "%Y-%m-%dT%H:%M:%S"))
    print(1 if -300 <= age <= 900 else 0)
except Exception: print(0)' "$utc" 2>/dev/null || echo 0)
[ "$fresh" = "1" ] || skip

printf '1 %s %s %s\n' "$nonce" "$utc" "$sig"
