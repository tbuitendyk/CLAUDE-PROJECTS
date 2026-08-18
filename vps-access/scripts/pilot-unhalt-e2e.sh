#!/usr/bin/env bash
# pilot-unhalt-e2e.sh -- prove the Trading tab's "Clear the halt" button really
# clears a halt on the box, end to end, through every link in the actual chain:
#
#   classifier POST /api/pilot/unhalt   (what the button does)
#     -> data/pilot/unhalt-request.json (signed: HMAC over {unhalt,nonce,utc})
#     -> pilot-unhalt-fields.sh         (shape + fresh + consume-once)
#     -> pilot-produce-and-push.sh      (what the 5-min sync does)
#     -> mx_executor.py unhalt          (verifies the signature, clears the flag)
#
# It sets a CLEARLY-LABELLED TEST HALT first, because a mechanism that has only
# ever been tested against "not halted; nothing to clear" has not been tested.
#
# WHY THIS IS SAFE ON THE LIVE BOX:
#   * a halt blocks only NEW entries; scheduled exits were never gated on it.
#   * F1 opens entries at the frozen 01:00 UTC hour only, so a halt held for a
#     minute mid-afternoon has nothing to block.
#   * the script ALWAYS force-clears at the end if the button path did not, and
#     says so loudly. It cannot leave the box halted and quiet.
# It never touches the master switch, and it places no orders.
set -uo pipefail
B=http://127.0.0.1:8093
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
APPDIR=/opt/general-classifier
fail=0

boxhalt() { $SSH "$BOX" '[ -f ~/pilot/HALT ] && cat ~/pilot/HALT || echo NOT-HALTED'; }

echo "== 0. preconditions =="
echo "  halt before: $(boxhalt)"
echo "  helper installed: $([ -f /usr/local/sbin/pilot-unhalt-fields.sh ] && echo YES || echo 'NO — the button cannot work')"
[ -f /usr/local/sbin/pilot-unhalt-fields.sh ] || fail=1
pre=$(boxhalt)
if [ "$pre" != "NOT-HALTED" ]; then
  echo "  !! the box is ALREADY halted for a real reason — not running a test halt on top."
  echo "     Investigate that halt first (classifier-halt-forensics.sh)."
  exit 1
fi

echo
echo "== 1. set a clearly-labelled TEST halt on the box =="
$SSH "$BOX" "python3 ~/mx_executor.py halt --source=e2e-test --reason='E2E TEST HALT — pilot-unhalt-e2e.sh, cleared within seconds'" 2>&1 | sed 's/^/  /'
echo "  halt now: $(boxhalt)"

echo
echo "== 2. press the button (POST /api/pilot/unhalt, exactly what the screen does) =="
curl -sS -m 10 -X POST -H 'Content-Type: application/json' --data '{}' "$B/api/pilot/unhalt" | sed 's/^/  /'
echo
echo "  request written:"
python3 -c 'import json;d=json.load(open("'"$APPDIR"'/data/pilot/unhalt-request.json"));print("    nonce",d.get("nonce"),"| utc",d.get("utc"),"| signed:",bool(d.get("hmac")))' 2>&1 | sed 's/^/  /'

echo
echo "== 3. run the sync that carries it (same call the 5-min timer makes) =="
/usr/local/sbin/pilot-produce-and-push.sh --arm-only 2>&1 | sed 's/^/  /'

echo
echo "== 4. did the box clear it? =="
after=$(boxhalt)
echo "  halt after: $after"
if [ "$after" = "NOT-HALTED" ]; then
  echo "  PASS — the button cleared a real halt end to end."
else
  echo "  FAIL — the halt survived the button path."
  fail=1
fi
echo "  journal:"
$SSH "$BOX" "grep -E 'HALT_SET|HALT_CLEAR|UNHALT_' ~/pilot/journal.jsonl | tail -4" 2>&1 | sed 's/^/    /'

echo
echo "== 5. REPLAY: the spent request must NOT clear a second halt =="
$SSH "$BOX" "python3 ~/mx_executor.py halt --source=e2e-test --reason='E2E TEST HALT 2 — replay check'" >/dev/null 2>&1
/usr/local/sbin/pilot-produce-and-push.sh --arm-only 2>&1 | grep -i unhalt | sed 's/^/  /' || echo "  (carry correctly said nothing — the request is spent)"
rep=$(boxhalt)
if [ "$rep" = "NOT-HALTED" ]; then
  echo "  FAIL — a spent request re-cleared a later halt."
  fail=1
else
  echo "  PASS — the second halt stands; a spent request cannot re-clear."
fi

echo
echo "== 6. CLEANUP (always) — clear the test halt by hand =="
$SSH "$BOX" "python3 ~/mx_executor.py unhalt --source=e2e-test --force --reason='clearing the e2e TEST halt'" 2>&1 | sed 's/^/  /'
final=$(boxhalt)
echo "  final halt state: $final"
if [ "$final" != "NOT-HALTED" ]; then
  echo "  !!!! THE BOX IS STILL HALTED AND THIS SCRIPT COULD NOT CLEAR IT — ACT NOW"
  fail=1
fi
echo "  master switch (never touched by this script): $($SSH "$BOX" '[ -f ~/pilot/ARM ] && echo RUNNING || echo STOPPED')"

echo
[ "$fail" = 0 ] && echo "E2E RESULT: ALL PASS" || echo "E2E RESULT: FAILURES PRESENT"
exit "$fail"
