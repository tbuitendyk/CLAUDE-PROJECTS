#!/usr/bin/env bash
# test-live-alert.sh -- DRYRUN fixture harness for live-alert.sh (plan 6.2).
# Same discipline as test-pilot-alert.sh: fixtures in a temp dir, DRYRUN so no
# SMTP, every rule watched deciding. Exits non-zero on any failed expectation.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
J="$T/journal.jsonl"; M="$T/mirror.json"; S="$T/state.json"
NOW=$(python3 -c 'import time; print(time.time())')

fail() { echo "FAIL: $1"; exit 1; }
run() {
  LIVE_ALERT_DRYRUN=1 LIVE_MIRROR_FILE="$M" LIVE_ALERT_STATE="$S" \
    bash "$HERE/live-alert.sh" "$J"
}

# fixtures: schema-2 FIXED_STOP + allowlist refusal + schema-1 noise (ignored),
# and a mirror break for another setup.
cat > "$J" <<EOF
{"event":"FIXED_STOP","setup_id":"s-a","chunk_start":"c1","stop_pct":0.05,"ts":$NOW}
{"event":"INTENT_INVALID","setup_id":"s-b","problems":["clip_cap"],"ts":$NOW}
{"event":"FIXED_STOP","chunk_start":"c9","ts":$NOW}
{"event":"KILL_PRICE_DRIFT","chunk_start":"c8","ts":$NOW}
EOF
cat > "$M" <<EOF
{"utc":"x","setups":1,"breaks":1,"results":[{"setup_id":"s-c","ok":false,"checked":3,"breaks":1,"pending":0,"details":[{"chunk_start":"c2","reason":"side LONG -> SHORT"}]}]}
EOF

out=$(run)
echo "$out" | grep -q "s-a: FIXED_STOP" || fail "s-a FIXED_STOP should page"
echo "$out" | grep -q "s-b: intent refused (clip_cap)" || fail "s-b allowlist refusal should page"
echo "$out" | grep -q "s-c: MIRROR BREAK" || fail "s-c mirror break should page"
echo "$out" | grep -q "DRYRUN would send" || fail "should compose a send"
# schema-1 events must NOT page here (pilot-alert's rail)
echo "$out" | grep -q "c9\|c8" && fail "schema-1 events must be ignored by live-alert"
echo "PASS 1: three per-setup pages composed, schema-1 ignored"

# cooldown: an immediate second run pages nothing
out2=$(run)
echo "$out2" | grep -q "nothing to page" || fail "cooldown should suppress the immediate repeat"
echo "PASS 2: cooldown suppresses the repeat"

# empty world: no journal, no mirror -> nothing
rm -f "$J" "$M" "$S"
out3=$(run)
echo "$out3" | grep -q "nothing to page" || fail "empty world should page nothing"
echo "PASS 3: empty world silent"

# R13: an incident 2h old, already paged at its own ts (the watermark). It must
# NOT re-page even though the 1h cooldown has long expired — the old timer-only
# logic re-paged the same incident every cooldown for the whole 26h window.
J2="$T/j-r13.jsonl"; S2="$T/s-r13.json"; M2="$T/m-r13.json"
TOLD=$(python3 -c "print(int($NOW-7200))")   # 2h ago; cooldown is 1h
printf '{"event":"FIXED_STOP","setup_id":"s-w","chunk_start":"c1","ts":%s}\n' "$TOLD" > "$J2"
echo "{\"s-w|FIXED_STOP\": $TOLD}" > "$S2"    # already paged at that incident's ts
r13=$(LIVE_ALERT_DRYRUN=1 LIVE_MIRROR_FILE="$M2" LIVE_ALERT_STATE="$S2" bash "$HERE/live-alert.sh" "$J2")
echo "$r13" | grep -q "nothing to page" \
  || fail "R13 a 2h-old already-paged incident must NOT re-page though the cooldown expired"
# a genuinely NEWER occurrence (later ts) re-pages
printf '{"event":"FIXED_STOP","setup_id":"s-w","chunk_start":"c2","ts":%s}\n' "$(python3 -c "print(int($NOW))")" >> "$J2"
r13c=$(LIVE_ALERT_DRYRUN=1 LIVE_MIRROR_FILE="$M2" LIVE_ALERT_STATE="$S2" bash "$HERE/live-alert.sh" "$J2")
echo "$r13c" | grep -q "s-w: FIXED_STOP" || fail "R13 a newer occurrence must re-page"
echo "PASS 4: a stale already-paged incident does not re-page; a newer one does (R13)"

# R12: a STALE mirror.json (writer stalled) pages, so its silence is visible
J3="$T/j-r12.jsonl"; S3="$T/s-r12.json"; M3="$T/m-r12.json"
: > "$J3"
echo '{"results":[]}' > "$M3"
python3 -c "import os,time; os.utime('$M3', (time.time()-4*3600, time.time()-4*3600))"
r12=$(LIVE_ALERT_DRYRUN=1 LIVE_MIRROR_FILE="$M3" LIVE_ALERT_STATE="$S3" bash "$HERE/live-alert.sh" "$J3")
echo "$r12" | grep -qi "mirror stale" || fail "R12 stale mirror.json should page"
echo "PASS 5: stale mirror.json pages (R12)"

echo "ALL live-alert fixture checks PASS"
