#!/usr/bin/env bash
# pilot-unhalt.sh -- clear a stuck HALT on the box after its cause is resolved.
#
# A halt NEVER self-clears: a gate that fires says the instrument is unreliable,
# and auto-clearing would be the instrument marking its own homework. Recovery is
# deliberate, and this is the lever.
#
# WHAT IT DOES NOT DO: it does not start trading. Entries additionally require the
# ARM switch, which this never touches. Scheduled exits were never gated on the
# halt and have been running throughout.
#
# IT NO LONGER RUNS A CYCLE. The previous version ran one and justified it with
# "ARM absent so nothing opens" — a premise that stopped being true the moment
# the pilot went live, and a script that states a false safety premise is worse
# than one that states none. The box's own timer runs the next tick within
# minutes; if the halt's CAUSE is unfixed, that tick re-halts, which is the check
# working and the signal you want.
#
# THIS IS THE HAND LEVER, NOT THE OWNER'S. The owner clears a halt from the
# Trading tab; that path is SIGNED (HMAC over {unhalt,nonce,utc}) because
# clearing a halt removes a brake. This script runs --force, which skips that
# check and is journaled as unauthenticated. That is not a hole: anyone who can
# run this already has a shell on the box and could delete the flag by hand. It
# exists so a box whose secret was never provisioned is still recoverable.
#
# IT REACHES A PROFILE'S HALT TOO (2026-08-19). It used to clear ONLY the
# box-level flag, so once halts became per-profile there was no hand lever for
# the one kind of halt that actually fires — the same shape of lock-out this
# whole project is about. Pass a setup id to clear that profile's halt; pass
# nothing for the box-level one.
#
#   pilot-unhalt.sh                      clears the BOX-level halt
#   pilot-unhalt.sh setup-abc-123        clears THAT PROFILE's halt
set -uo pipefail
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
[ -f "$KEY" ] || { echo "no key at $KEY"; exit 1; }
SID="${1:-}"
case "$SID" in
  "") ;;
  *[!A-Za-z0-9._-]*) echo "refusing odd setup id: $SID"; exit 1;;
esac
SID="$SID" $SSH "$BOX" "SID='$SID' bash -s" <<'R'
if [ -n "${SID:-}" ]; then
  FLAG=~/pilot/HALT-setup-$SID
  WHAT="profile $SID"
  ARGS="--setup=$SID"
else
  FLAG=~/pilot/HALT
  WHAT="the box"
  ARGS=""
fi
echo "== before =="
echo "  halt on $WHAT: $([ -f "$FLAG" ] && cat "$FLAG" || echo 'not halted')"
echo "  ARM (master switch, untouched by this script): $([ -f ~/pilot/ARM ] && echo RUNNING || echo STOPPED)"
echo "== unhalt =="
# --force is journaled as UNAUTHENTICATED on purpose: the record must show this
# was a hand clear from a shell, not the owner's signed press from the screen.
python3 ~/mx_executor.py unhalt --source=operator --force $ARGS --reason=hand-clear-via-pilot-unhalt.sh
rc=$?
echo "  (exit $rc — 0 cleared or nothing was halted, 2 refused)"
echo "== after =="
echo "  halt on $WHAT: $([ -f "$FLAG" ] && echo 'STILL PRESENT' || echo cleared)"
echo "  ARM: $([ -f ~/pilot/ARM ] && echo RUNNING || echo STOPPED)"
echo "== the next scheduled tick decides whether it stays clear =="
systemctl list-timers pilot-exec.timer --no-pager 2>/dev/null | head -3 || true
R
