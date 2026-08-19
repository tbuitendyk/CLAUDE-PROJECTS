#!/usr/bin/env bash
# pilot-produce-and-push.sh -- VPS timer step: carry the owner's BOX-LEVEL
# settings to the Mexico box. Deterministic, no AI.
#
# Despite the name (kept so the installed timer keeps working), this no longer
# produces or pushes anything: it carries the owner's START/STOP to the box and
# re-stamps the dead-man keepalive, carries the protective stop, and carries the
# margin floor. All three belong to the MACHINE and outlive any one config.
#
# Idempotent by construction: every carry below rewrites the box only on a real
# change, so running it every five minutes costs nothing and a missed run simply
# catches up on the next one.
set -uo pipefail

APPDIR="${APPDIR:-/opt/general-classifier}"    # deployed classifier root
BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
BOX_USER=admin
KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13-new.pem}"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

[ -f "$KEY" ] || { echo "no key at $KEY"; exit 1; }

ARM_ONLY=0
[ "${1:-}" = "--arm-only" ] && ARM_ONLY=1

# ---- reconcile the owner's MASTER SWITCH to the box ----------------------
# The screen's START/STOP button writes data/pilot/arm-request.json on the VPS.
# We carry that intent to the box every run. When armed, this re-stamps the box
# ARM file (dead-man keepalive). Two fail-safe rules (review findings 13-14):
#   * a MISSING request file means DISARM, never "leave as-is" — absence must
#     not fail open to a still-armed box.
#   * if armed:true but the box is UNREACHABLE, we simply stop re-stamping; the
#     box's dead-man then self-disarms within ARM_MAX_AGE_S. So even a swallowed
#     SSH error cannot leave the box trading.
REQ="$APPDIR/data/pilot/arm-request.json"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Parse AND shape-validate the request in one place (pilot-arm-fields.sh). It
# carries the whole authenticated request (nonce/utc/hmac) to the box — the box
# validates the HMAC and the freshness+nonce edge before honoring it (findings
# 12/15) — but ONLY after the fields pass a strict shape gate here, because they
# are interpolated into the remote shell that toggles the LIVE box's master
# switch (CONTROL BUG 1, 2026-08-11 e2e review). Any off-shape/tampered/missing
# request degrades to a fail-safe disarm ('0 - - -'); it can never arm or inject.
want=0; nonce='-'; utc='-'; hmac='-'
read -r want nonce utc hmac < <(bash "$HERE/pilot-arm-fields.sh" "$REQ") \
  || { want=0; nonce='-'; utc='-'; hmac='-'; }

# WHERE THE DRIFT BRAKE WENT (2026-08-19). This step used to read the retired
# single-config rail's mirror.json and, on a confirmed break, force the MACHINE
# to disarm. That file has no writer any more, so the block had quietly become a
# no-op that still read like a live safety interlock — the worst state for a
# brake to be in, because the next person to check finds the code and believes
# it. It is deleted rather than repointed, on purpose:
#
#   * The brake now lives per PROFILE. live-produce-and-push.sh halts the exact
#     profile whose decisions stopped reproducing (mx_executor.py halt --setup),
#     which blocks its NEW entries while its open positions keep their scheduled
#     exits. Profiles that still reproduce keep trading.
#   * Disarming the whole machine on one profile's drift would now be collateral
#     damage, and it would also overrule the owner's own switch from a script.
#   * A halt does not self-clear; the owner lifts it once the cause is understood.
#
# So the master switch below carries the owner's START/STOP and nothing else
# overrides it. If a machine-wide kill is ever wanted again it needs a stated
# rule about which profile's break justifies stopping the others — that rule
# does not exist yet, and inventing one here is how the last one got hardcoded.

mode=$([ "$want" = "1" ] && echo arm || echo disarm)
echo "== master switch: reconcile -> $mode =="
$SSH "$BOX_USER@$BOX_HOST" \
  "python3 ~/mx_executor.py $mode --source=owner --nonce='$nonce' --utc='$utc' --hmac='$hmac'" \
  2>&1 | sed 's/^/  /' || echo "  (box unreachable; if armed, dead-man self-disarms — fail-safe)"

# ---- carry an UNHALT request (owner, 2026-08-18) --------------------------
# A halt never self-clears, and clearing one used to need shell access to the
# box — so from the owner's screen a halt was a dead end. The Trading tab writes
# data/pilot/unhalt-request.json; pilot-unhalt-fields.sh decides whether to carry
# it (consume-once + fresh + shape-gated, see that script), and only then does
# the box clear its own flag. This never arms: entries still require the master
# switch, and an unfixed cause re-halts on the next reconcile tick.
UNREQ="$APPDIR/data/pilot/unhalt-request.json"
UNSEEN="$APPDIR/data/pilot/unhalt-carried.json"
# A MISSING helper must be LOUD, not silent. The read below fails closed either
# way, but "the owner pressed the button and nothing whatsoever happened" is the
# worst possible presentation of a fail-safe: it looks like the button is broken
# and gives no thread to pull. pilot-install.sh installs this helper beside us;
# if it is absent, say so where it will be read (2026-08-18 — the same omission
# the arm-fields/stop-state helpers hit on 2026-08-11).
if [ ! -f "$HERE/pilot-unhalt-fields.sh" ]; then
  echo "!! pilot-unhalt-fields.sh MISSING from $HERE — the Trading tab's"
  echo "   'Clear the halt' button cannot reach the box. Re-run pilot-install.sh."
  un_go=0; un_nonce='-'; un_utc='-'; un_sig='-'
else
  read -r un_go un_nonce un_utc un_sig \
    < <(bash "$HERE/pilot-unhalt-fields.sh" "$UNREQ" "$UNSEEN") \
    || { un_go=0; un_nonce='-'; un_utc='-'; un_sig='-'; }
fi
if [ "$un_go" = "1" ]; then
  echo "== owner requested UNHALT (nonce $un_nonce) — carrying to the box =="
  # The SIGNED triple goes to the box, which verifies the HMAC over
  # {unhalt,nonce,utc} against PILOT_ARM_SECRET and re-applies freshness and
  # replay itself. Clearing a halt removes a brake, so it is authenticated like
  # ARM — unlike DISARM, which is a kill switch and must work unsigned.
  if $SSH "$BOX_USER@$BOX_HOST" \
       "python3 ~/mx_executor.py unhalt --source=owner --nonce='$un_nonce' --utc='$un_utc' --hmac='$un_sig' --reason='cleared by the owner from the Trading tab'" \
       2>&1 | sed 's/^/  /'; then
    printf '{"nonce":"%s","carriedAt":"%s"}' "$un_nonce" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$UNSEEN"
  else
    echo "  (box unreachable; the request is NOT marked carried and retries next sync)"
  fi
fi

# ---- carry the owner's PER-PROFILE unhalt requests (owner, 2026-08-19) ----
# Moved here from the hourly tick. The box accepts an unhalt request for 900
# seconds; the hourly carrier delivered them 20-55 minutes old and the box
# refused every one as stale, so "Clear the halt" did nothing and said nothing.
# This script runs every 5 minutes, which is what the freshness rule needs.
#
# A REFUSAL IS NOT A DELIVERY. The old carry deleted the request whenever the
# ssh call exited 0 — and the executor exited 0 even when it refused, so each
# press was consumed by its own failure and left no trace. Now the executor
# exits 2 on refusal and the request is moved to <id>.refused.json carrying the
# reason, which the screen reads back to the owner. An unreachable box leaves
# the request in place to retry.
UNHALT_DIR="$APPDIR/data/live/unhalt"
if [ -d "$UNHALT_DIR" ]; then
  for uf in "$UNHALT_DIR"/*.json; do
    [ -e "$uf" ] || continue
    case "$uf" in *.refused.json) continue;; esac
    read -r U_SID U_NONCE U_UTC U_HMAC < <(python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
print(d.get("setup_id",""), d.get("nonce",""), d.get("utc",""), d.get("hmac",""))
' "$uf" 2>/dev/null)
    [ -n "${U_SID:-}" ] || { echo "  unreadable unhalt request $(basename "$uf") — left in place"; continue; }
    case "$U_SID" in *[!A-Za-z0-9._-]*) echo "  refusing odd setup id in $(basename "$uf")"; continue;; esac
    echo "== carrying unhalt request for $U_SID =="
    OUT=$($SSH "$BOX_USER@$BOX_HOST" \
      "python3 ~/mx_executor.py unhalt --source=owner --setup='$U_SID' --nonce='$U_NONCE' --utc='$U_UTC' --hmac='$U_HMAC' --reason=owner-cleared-from-the-screen" 2>&1)
    rc=$?
    echo "$OUT" | sed 's/^/    /'
    if [ $rc -eq 0 ]; then
      rm -f "$uf" "$UNHALT_DIR/$U_SID.refused.json"
    elif [ $rc -eq 2 ]; then
      # The box considered it and said no. Retrying cannot help a stale or
      # badly-signed request, so consume it — but record WHY, where the screen
      # can find it, instead of dropping it silently as the old carry did.
      python3 -c '
import json, sys, datetime
sid, reason, dest = sys.argv[1], sys.argv[2], sys.argv[3]
json.dump({"setup_id": sid, "refused_utc": datetime.datetime.now(datetime.timezone.utc)
           .strftime("%Y-%m-%dT%H:%M:%SZ"), "reason": reason.strip()[:400]}, open(dest, "w"))
' "$U_SID" "$OUT" "$UNHALT_DIR/$U_SID.refused.json" 2>/dev/null || true
      rm -f "$uf"
      echo "    the box REFUSED this clear — recorded for the screen; pressing again mints a fresh request"
    else
      echo "    (box unreachable; the request stays and retries next sync)"
    fi
  done
fi

# Carry the owner's CHOSEN protective stop to the box (owner 2026-08-11). Running
# the scan applies NOTHING; the owner chooses a value (or none) which the classifier
# writes to data/pilot/fixed-stop.json. This carries that choice into the box's
# ~/.executor-env: a positive value sets FIXED_STOP_PCT; no value (or a cleared
# choice) REMOVES it so the box runs with no stop. Idempotent — the box env is
# rewritten only on a real change. A risk parameter, never an authorization to
# trade: it opens nothing, and it is carried regardless of arm/mirror state.
FIXEDSTOP="$APPDIR/data/pilot/fixed-stop.json"
# THREE distinct states, never conflated (CONTROL BUG 3/4, 2026-08-11 e2e review):
#   SET <v>  file parses, stopPct is a valid live stop (>= 0.5% floor, < 1). Emit
#            it at FULL precision — the old .6f truncated a sub-1e-6 value to a
#            fake "0.000000" that the box read as NO stop.
#   CLEAR    file absent, or stopPct is null / <= 0. This is the owner INTENDING
#            no stop, so clearing the box is correct.
#   ERROR    file is PRESENT but unreadable/invalid, or carries a positive-but-
#            off-shape value (below the 0.5% noise floor, or >= 1). A corrupt file
#            must NEVER be read as "clear the stop" — a disk glitch would then
#            silently strip a protective stop the owner set. On ERROR we touch
#            NOTHING on the box (retain the current stop) and surface loudly.
STOP_STATE=$(bash "$HERE/pilot-stop-state.sh" "$FIXEDSTOP")
kind=${STOP_STATE%% *}
val=${STOP_STATE#* }
[ "$kind" = "$val" ] && val=""           # CLEAR/ERROR carry no value; SET carries one
ERRFLAG="$APPDIR/data/pilot/stop-carry-error.json"
if [ "$kind" = "ERROR" ]; then
  echo "== fixed-stop.json PRESENT but UNREADABLE/OFF-SHAPE — NOT touching the box stop"
  echo "   (retaining whatever the box currently runs); surfacing for the owner =="
  python3 - "$ERRFLAG" "$FIXEDSTOP" <<'PY' 2>/dev/null || true
import json, sys, time
open(sys.argv[1], "w").write(json.dumps({
    "kind": "STOP_CARRY_ERROR",
    "file": sys.argv[2],
    "note": "fixed-stop.json is present but unreadable or off-shape; box stop left unchanged",
    "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}))
PY
else
  # healthy carry -> clear any stale error flag so the surfaced incident resolves
  rm -f "$ERRFLAG" 2>/dev/null || true
  [ "$kind" = "SET" ] && echo "== carry fixed stop -> box: $val ==" \
                      || echo "== carry fixed stop -> box: <none: no stop> =="
  $SSH "$BOX_USER@$BOX_HOST" "STATE='$kind' DESIRED='$val' bash -s" 2>&1 <<'RSTOP' | sed 's/^/  /' || echo "  (box unreachable; stop carry retried next sync)"
ENV=~/.executor-env
cur=$(grep -E '^FIXED_STOP_PCT=' "$ENV" 2>/dev/null | tail -1 | cut -d= -f2)
if [ "$STATE" = "CLEAR" ]; then
  if [ -n "$cur" ]; then
    tmp=$(mktemp); grep -vE '^FIXED_STOP_PCT=' "$ENV" 2>/dev/null > "$tmp" || true
    chmod 600 "$tmp"; mv "$tmp" "$ENV"
    echo "stop CLEARED (was $cur) — box now runs with NO stop"
  else
    echo "no stop set (as intended)"
  fi
elif [ "$cur" = "$DESIRED" ]; then
  echo "stop already set to $DESIRED"
else
  tmp=$(mktemp); grep -vE '^FIXED_STOP_PCT=' "$ENV" 2>/dev/null > "$tmp" || true
  echo "FIXED_STOP_PCT=$DESIRED" >> "$tmp"
  chmod 600 "$tmp"; mv "$tmp" "$ENV"
  echo "stop updated: ${cur:-<unset>} -> $DESIRED"
fi
RSTOP
fi

# ---- carry the owner's MARGIN FLOOR to the box -------------------------------
# Margin level is collateral/debt on the isolated wallet: the distance to a forced
# liquidation. Nothing in this system read it until 2026-08-19, so a borrow-to-short
# engine had no brake on it at all. The owner sets the floor on the Trading screen,
# which writes data/pilot/margin-floor.json; this carries it into MARGIN_FLOOR in
# the box env, exactly as the stop above is carried. Absent / null / <= 0 means NO
# floor, and the variable is REMOVED rather than zeroed — a threshold nobody chose
# must never start braking, and a stale one must never linger.
MFJSON="$APPDIR/data/pilot/margin-floor.json"
MFVAL=$(node -e '
try {
  const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const v = Number(d.floor);
  process.stdout.write(Number.isFinite(v) && v > 0 ? String(v) : "");
} catch (_) { process.stdout.write(""); }
' "$MFJSON" 2>/dev/null)
[ -n "$MFVAL" ] && echo "== carry margin floor -> box: $MFVAL ==" \
                || echo "== carry margin floor -> box: <none: no floor> =="
$SSH "$BOX_USER@$BOX_HOST" "DESIRED='$MFVAL' bash -s" 2>&1 <<'RMARGIN' | sed 's/^/  /' || echo "  (box unreachable; margin-floor carry retried next sync)"
ENV=~/.executor-env
cur=$(grep -E '^MARGIN_FLOOR=' "$ENV" 2>/dev/null | tail -1 | cut -d= -f2)
if [ -z "$DESIRED" ]; then
  if [ -n "$cur" ]; then
    tmp=$(mktemp); grep -vE '^MARGIN_FLOOR=' "$ENV" 2>/dev/null > "$tmp" || true
    chmod 600 "$tmp"; mv "$tmp" "$ENV"
    echo "margin floor CLEARED (was $cur) — box now runs with NO floor"
  else
    echo "no margin floor set (as intended)"
  fi
elif [ "$cur" = "$DESIRED" ]; then
  echo "margin floor already set to $DESIRED"
else
  tmp=$(mktemp); grep -vE '^MARGIN_FLOOR=' "$ENV" 2>/dev/null > "$tmp" || true
  echo "MARGIN_FLOOR=$DESIRED" >> "$tmp"
  chmod 600 "$tmp"; mv "$tmp" "$ENV"
  echo "margin floor updated: ${cur:-<unset>} -> $DESIRED"
fi
RMARGIN

# In --arm-only mode (the frequent sync) we stop here: no data refresh, no
# signal produced. The hourly tick does the produce+push.
# THE PRODUCER HALF IS GONE (2026-08-19). Everything below this point used to
# compute the hardcoded config's intent and ship it. That config is retired and
# its producer deleted; profiles produce through live-produce-and-push.sh. What
# remains above is BOX-LEVEL and outlives any config: the owner's START/STOP
# carried to the box with its dead-man keepalive, the protective stop, and the
# margin floor. Killing this script would disarm the box within minutes.
#
# --arm-only is now the only mode; the flag is still accepted so the installed
# timer keeps working unchanged.
exit 0
