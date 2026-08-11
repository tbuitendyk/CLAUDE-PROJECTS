#!/usr/bin/env bash
# test-pilot-alert.sh -- watched-failing tests for the 2026-08-11 e2e review OBS
# gaps in pilot-alert.sh. Uses the script's own PILOT_ALERT_DRYRUN=1 path (detect +
# compose + persist, never SMTP) against fixture journals. No network.
#
#   GAP-1  stale_sync fires on staleness ALONE (not gated on a possibly-frozen at_risk)
#   GAP-3a a cooldown-suppressed incident does NOT advance the watermark (so a
#          distinct later occurrence is delayed, never swallowed)
#   GAP-3b ORDER_REJECT ENTRY vs EXIT are DISTINCT incident kinds
#   GAP-4  arm-refusal events (ARM_HMAC_INVALID etc.) page as incidents
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUT="$HERE/pilot-alert.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
NOW=$(date +%s)
fail=0
pass() { echo "ok   - $1"; }
bad()  { echo "FAIL - $1"; fail=1; }

run() { # <journal> <state>  -> prints dryrun stdout
  PILOT_ALERT_DRYRUN=1 PILOT_ALERT_STATE="$2" PILOT_MAIL_ENVFILE="$TMP/noenv" \
    bash "$SUT" "$1" 2>&1
}

# ---- GAP-4: an arm refusal must page -------------------------------------
J="$TMP/j4.jsonl"; S="$TMP/s4.json"
printf '{"event":"ARM_HMAC_INVALID","ts":%s}\n' "$NOW" > "$J"
OUT="$(run "$J" "$S")"
echo "$OUT" | grep -q 'ARM_HMAC_INVALID' && pass "GAP-4 arm-refusal (ARM_HMAC_INVALID) pages" \
  || { bad "GAP-4 arm-refusal not paged"; echo "    out: $OUT"; }

# ---- GAP-3b: ENTRY vs EXIT rejects are distinct kinds --------------------
J="$TMP/j3b.jsonl"; S="$TMP/s3b.json"
{ printf '{"event":"ORDER_REJECT","action":"ENTRY","ts":%s}\n' "$((NOW-10))"
  printf '{"event":"ORDER_REJECT","action":"EXIT","ts":%s}\n'  "$NOW"; } > "$J"
OUT="$(run "$J" "$S")"
if echo "$OUT" | grep -q 'ORDER_REJECT_ENTRY' && echo "$OUT" | grep -q 'ORDER_REJECT_EXIT'; then
  pass "GAP-3b ENTRY and EXIT rejects both page as distinct kinds"
else bad "GAP-3b ENTRY/EXIT rejects not both distinct"; echo "    out: $OUT"; fi

# a SWEEP reject is still ignored (not a trading incident)
J="$TMP/j3s.jsonl"; S="$TMP/s3s.json"
printf '{"event":"ORDER_REJECT","action":"SWEEP","ts":%s}\n' "$NOW" > "$J"
OUT="$(run "$J" "$S")"
echo "$OUT" | grep -q 'ORDER_REJECT' && { bad "GAP-3b SWEEP reject wrongly paged"; echo "    out: $OUT"; } \
  || pass "GAP-3b housekeeping SWEEP reject is ignored"

# ---- GAP-1: stale_sync fires on staleness alone (box stopped, flat) -------
J="$TMP/j1.jsonl"; S="$TMP/s1.json"
printf '{"event":"RUN_STATUS","armed":false,"halted":false,"ts":%s}\n' "$((NOW-2400))" > "$J"
touch -d "40 minutes ago" "$J"
OUT="$(run "$J" "$S")"
echo "$OUT" | grep -q 'stale_sync' && pass "GAP-1 stale_sync fires though at_risk is false (stopped/flat)" \
  || { bad "GAP-1 stale_sync suppressed on a stopped box"; echo "    out: $OUT"; }

# ---- GAP-3a: a cooldown-suppressed incident does NOT advance the watermark
J="$TMP/j3a.jsonl"; S="$TMP/s3a.json"
printf '{"event":"EXIT_OVERDUE","ts":%s}\n' "$NOW" > "$J"     # distinct, later occurrence
# pre-craft state: this kind was paged just now (within the 60-min cooldown), with an
# OLD watermark. The suppressed run must leave the watermark at the OLD value.
python3 - "$S" "$((NOW-100))" "$NOW" <<'PY'
import json, sys
open(sys.argv[1], "w").write(json.dumps({
    "keys": [], "inc_wm": {"EXIT_OVERDUE": int(sys.argv[2])},
    "inc_paged_at": {"EXIT_OVERDUE": int(sys.argv[3])}}))
PY
OUT="$(run "$J" "$S")"
WM=$(python3 -c "import json,sys; print(json.load(open('$S'))['inc_wm'].get('EXIT_OVERDUE'))")
if echo "$OUT" | grep -q 'would send'; then bad "GAP-3a paged despite active cooldown"; echo "    out: $OUT"
elif [ "$WM" = "$((NOW-100))" ]; then pass "GAP-3a cooldown-suppressed incident left the watermark un-advanced ($WM)"
else bad "GAP-3a watermark advanced to $WM under cooldown (should stay $((NOW-100))) — a later occurrence would be swallowed"; fi

echo "----"
[ "$fail" = 0 ] && { echo "ALL PASS"; exit 0; } || { echo "FAILURES"; exit 1; }
