#!/usr/bin/env bash
# live-produce-and-push.sh -- THE tick step that trades. Runs the producer over
# every profile in paper or live state, then ships their intents AND the derived
# allowlist to the Mexico box, carries the owner's per-profile halt clears, and
# halts any profile whose decisions have stopped reproducing.
#
# Ships NOTHING while no profile is in paper/live state: drafts never produce,
# and the box stays fail-closed on an empty allowlist.
#
# Its sibling pilot-produce-and-push.sh no longer produces anything — despite the
# name it carries only BOX-LEVEL state (START/STOP, protective stop, margin
# floor), which outlives any one profile.
set -uo pipefail

APPDIR="${APPDIR:-/opt/general-classifier}"
BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
BOX_USER=admin
KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13-new.pem}"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"

[ -f "$KEY" ] || { echo "no key at $KEY"; exit 1; }
[ -f "$APPDIR/live-produce.js" ] || { echo "live-produce.js not deployed"; exit 1; }

echo "== produce (all paper/live setups) =="
OUT=$(cd "$APPDIR" && PILOT_SOCKS="${PILOT_SOCKS:-127.0.0.1:1080}" node live-produce.js 2>&1)
rc=$?
echo "$OUT" | tail -3 | sed 's/^/  /'
[ $rc -ne 0 ] && { echo "producer failed"; exit 1; }

SCP="scp -q -i $KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

# R14: carry the allowlist ATOMICALLY (scp to a dot-temp, then mv on the box) so
# the box's fail-closed reader can never load a half-written allowlist. And track
# the result: if the carry FAILED we must NOT ship intents this tick — a fresh
# intent acting against a STALE box allowlist (the box keeps its previous list on
# failure) is exactly what the allowlist exists to prevent. Intents wait in the
# outbox and retry next tick, when the allowlist and the intents can go together.
echo "== carry the allowlist (fail-closed twin on the box), atomically =="
ALLOW="$APPDIR/data/live/setups-allow.json"
allow_ok=1
if [ -f "$ALLOW" ]; then
  if $SCP "$ALLOW" "$BOX_USER@$BOX_HOST:~/pilot/.setups-allow.json.tmp" \
     && $SSH "$BOX_USER@$BOX_HOST" 'mv ~/pilot/.setups-allow.json.tmp ~/pilot/setups-allow.json'; then
    echo "  allowlist carried (atomic)"
  else
    allow_ok=0
    echo "  allowlist carry FAILED — NOT shipping intents this tick (box keeps its previous list)"
  fi
else
  # FAIL-CLOSED (independent review 2026-08-12): a MISSING local allowlist is not
  # "nothing to carry" — it means this tick carried NO fresh list, so shipping
  # intents would act against whatever STALE list the box still holds, exactly what
  # R14 exists to prevent. Withhold intents until a real allowlist is produced.
  allow_ok=0
  echo "  no local allowlist at $ALLOW — NOT shipping intents this tick (fail-closed)"
fi

# THE PER-PROFILE UNHALT CARRY IS NOT HERE ANY MORE (owner, 2026-08-19:
# "I've been pressing the button to clear the halt state").
#
# It used to live in this script, which runs ONCE AN HOUR on live-tick.timer.
# The box accepts an unhalt request for 900 seconds. So a request could only
# ever be honoured if the owner happened to press within the ~7 minutes before
# the tick; press at any other time and it arrived 20, 40, 55 minutes old and
# was refused as stale. Proven in the box journal: UNHALT_STALE_REQUEST at
# 08:08:08 with age_s 2567 — 43 minutes — against a 900-second window.
#
# The box-level clear never had this problem because it is carried by
# pilot-produce-and-push.sh on pilot-sync.timer every 5 minutes, comfortably
# inside the window. The per-profile clear was simply put in the wrong script
# and inherited a cadence that cannot satisfy the rule it has to satisfy.
# It now rides the same 5-minute carry as its box-level twin.
#
# The ordering note that used to live here — carry clears BEFORE the break
# check below, so a just-cleared profile is not immediately re-halted — still
# holds and is now stronger: a clear lands within 5 minutes, so by the time this
# hourly tick recomputes the reproduce-check, the clear is already in place. If
# the check still finds a break it re-halts, which is the check working.

# ---- THE REPRODUCE-CHECK IS A BRAKE, NOT A NEWSLETTER -----------------------
# A mirror break means a decision this profile ACTED ON no longer recomputes to
# the same call from the same data: the record and the engine disagree, so the
# next call cannot be trusted either. On the built-in pilot that force-disarms
# the box. For a profile it only ever sent an email — the profile carried on
# trading on a record that no longer reproduced. Same detector, no brake.
#
# Now a broken profile is HALTED on the box, which stops its NEW ENTRIES only;
# its open positions keep their scheduled exits, exactly like every other halt
# here. It does not self-clear — the owner clears it once the cause is
# understood — because a gate that clears itself is the instrument marking its
# own homework.
MIRROR="$APPDIR/data/live/mirror.json"
if [ -f "$MIRROR" ]; then
  BROKEN=$(python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
for r in (d.get("results") or []):
    if r.get("breaks"):
        sid = r.get("setup_id")
        if isinstance(sid, str) and sid:
            print(sid)
' "$MIRROR" 2>/dev/null)
  for sid in $BROKEN; do
    case "$sid" in *[!A-Za-z0-9._-]*) echo "  refusing odd setup id: $sid"; continue;; esac
    echo "  MIRROR BREAK on $sid — halting that profile's new entries"
    $SSH "$BOX_USER@$BOX_HOST" \
      "python3 ~/mx_executor.py halt --source=mirror --setup='$sid' --reason='decisions no longer reproduce'" \
      2>&1 | sed 's/^/    /' || echo "    (box unreachable; retried next tick)"
  done
fi

echo "== ship intents =="
OUTBOX="$APPDIR/data/live/outbox"
shopt -s nullglob
shipped=0
if [ "$allow_ok" -eq 1 ]; then
  for f in "$OUTBOX"/intent2-*.json; do
    base=$(basename "$f")
    # ATOMIC: land under a dot-temp name (the executor's intent loop matches only
    # *.json, so the temp is invisible) then mv into place on the box.
    if $SCP "$f" "$BOX_USER@$BOX_HOST:~/pilot/intents/.$base.tmp" \
       && $SSH "$BOX_USER@$BOX_HOST" "mv ~/pilot/intents/.$base.tmp ~/pilot/intents/$base"; then
      mv "$f" "$f.shipped"
      shipped=$((shipped+1))
    else
      echo "  ship FAILED for $base (kept in outbox; retried next tick)"
    fi
  done
fi
echo "  shipped $shipped intent(s)"

# R15: terminal-state files (shipped intents locally; .done/.dup/.bad on the box)
# are inert once written but accumulate forever. Sweep those older than 7 days so
# the outbox and the box's intents dir stay bounded. Only touches ALREADY-terminal
# files — never a live .json intent, never a decision log — so it cannot affect
# trading. Best-effort: a failed sweep is not a tick failure.
echo "== housekeeping: prune terminal-state files older than 7 days =="
find "$OUTBOX" -maxdepth 1 -type f -name 'intent2-*.json.shipped' -mtime +7 -delete 2>/dev/null || true
$SSH "$BOX_USER@$BOX_HOST" \
  'find ~/pilot/intents -maxdepth 1 -type f \( -name "*.done" -o -name "*.dup" -o -name "*.bad" \) -mtime +7 -delete 2>/dev/null || true' \
  2>/dev/null || echo "  (box prune skipped — box unreachable this tick)"
