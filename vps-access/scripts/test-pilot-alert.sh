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

# ---- R6: the box-level alerter ignores per-profile (setup_id) events ----------------
# A per-profile ORDER_REJECT (ENTRY) carries a setup_id and belongs to the
# trading rail's OWN alerter — it must NOT page as a box-level incident.
J="$TMP/jr6.jsonl"; S="$TMP/sr6.json"
printf '{"event":"ORDER_REJECT","action":"ENTRY","setup_id":"s-x","ts":%s}\n' "$NOW" > "$J"
OUT="$(run "$J" "$S")"
echo "$OUT" | grep -q 'ORDER_REJECT' \
  && { bad "R6 per-profile incident wrongly paged on the box-level alerter"; echo "    out: $OUT"; } \
  || pass "R6 per-profile (setup_id) incident is ignored by the box-level alerter"

# A per-profile fill on a stopped box that holds no box-level position must NOT
# inflate the box-level open-position count into a spurious at_risk (which
# would fire dead_heartbeat).
J="$TMP/jr6b.jsonl"; S="$TMP/sr6b.json"
{ printf '{"event":"ARM_CLEAR","ts":%s}\n' "$NOW"
  printf '{"event":"ENTRY_FILL","chunk_start":"c1","setup_id":"s-x","side":"LONG","qty":0.2,"price":100,"ts":%s}\n' "$NOW"; } > "$J"
touch -d "40 minutes ago" "$J"
OUT="$(run "$J" "$S")"
echo "$OUT" | grep -q 'dead_heartbeat' \
  && { bad "R6 per-profile fill created a spurious box-level at_risk (dead_heartbeat)"; echo "    out: $OUT"; } \
  || pass "R6 per-profile fill does not inflate the box-level open-position count / at_risk"

# ---- A CONDITION STILL TRUE IS STILL NEWS (owner, 2026-10-30) -------------
# Conditions fired on TRANSITION only, so a halt pinged once and then went quiet
# for as long as it lasted. 2026-10-29: HALT_SET at 09:40:07Z paged once and then
# blocked every entry for fifteen hours in silence. A still-active condition must
# re-page on CONDITION_REPAGE_MIN, and must say it is a continuation rather than
# reading as a fresh fault.
#
# Watched failing 2026-10-30: with `repaged` dropped from the early-exit test,
# the third run below goes silent again -- the exact 2026-10-29 behaviour.
J="$TMP/jrp.jsonl"; S="$TMP/srp.json"
printf '{"event":"HALT_SET","source":"executor","reason":"cannot read account (http 0)","ts":%s}\n' "$((NOW-60))" > "$J"

OUT="$(run "$J" "$S")"
echo "$OUT" | grep -q 'halted' && pass "repage: a new halt pages the first time" \
  || { bad "repage: the first halt did not page at all"; echo "    out: $OUT"; }

# straight away again: inside the cooldown, so silence is correct
OUT="$(run "$J" "$S")"
echo "$OUT" | grep -q 'would send' \
  && { bad "repage: paged twice inside the cooldown (alert fatigue)"; echo "    out: $OUT"; } \
  || pass "repage: a second run inside the cooldown stays quiet"

# backdate the last-paged stamp past the cooldown; the halt is STILL set
python3 - "$S" <<'PX'
import json,sys,time
p=sys.argv[1]; d=json.load(open(p))
d["cond_paged_at"]={k: time.time()-7200 for k in d.get("cond_paged_at",{})}
json.dump(d,open(p,"w"))
PX
OUT="$(run "$J" "$S")"
if echo "$OUT" | grep -q 'still' && echo "$OUT" | grep -q 'halted'; then
  pass "repage: a halt still set past the cooldown pages again, marked as a continuation"
else bad "repage: a persistent halt went silent past the cooldown"; echo "    out: $OUT"; fi

echo "----"
[ "$fail" = 0 ] && { echo "ALL PASS"; exit 0; } || { echo "FAILURES"; exit 1; }
