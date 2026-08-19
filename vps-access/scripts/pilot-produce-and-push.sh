#!/usr/bin/env bash
# pilot-produce-and-push.sh -- VPS timer step: compute the current F1 intent
# and ship it to the Mexico box. Deterministic, no AI (PILOT-F1.md section 4).
#
# Flow: run pilot-produce.js inside the deployed classifier -> if it yields an
# actionable intent, write it to a temp file and scp it into the box's
# ~/pilot/intents/ where the executor will validate and act on it.
#
# Idempotent by construction: the intent's chunk_start keys the executor's
# dedup, so re-running within the same period ships the same intent and the
# executor ignores the duplicate. Ships NOTHING when nothing is actionable.
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

[ "$ARM_ONLY" = 1 ] || [ -f "$APPDIR/pilot-produce.js" ] || { echo "no pilot-produce.js in $APPDIR"; exit 1; }

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

# MIRROR-BREAK DEAD-MAN (re-review liveness): if the drift detector has found a
# confirmed break (mirror.json breaks>=1), the live book has diverged from its
# paper twin and the instrument is unreliable. STOP re-stamping ARM — carry an
# unconditional disarm (utc='-' so the box watermark is NOT advanced), which
# drops the box's master switch at once and, because the keepalive ceases, keeps
# it down via the dead-man. Re-arming then requires a deliberate fresh START from
# the owner (the standing arm-request goes stale within the freshness window) —
# a drift break must never auto-re-arm. A mirror ERROR (ok:false, breaks:0) is a
# separate, already-paged alert and does NOT force disarm, to avoid churning the
# switch on a transient detector hiccup.
MIRROR="$APPDIR/data/pilot/mirror.json"
if [ "$want" = "1" ] && [ -f "$MIRROR" ]; then
  brk=$(python3 - "$MIRROR" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    print("1" if int(d.get("breaks", 0)) >= 1 else "0")
except Exception:
    print("0")
PY
)
  if [ "$brk" = "1" ]; then
    echo "== MIRROR BREAK detected — forcing DISARM (dead-man); re-arm needs a fresh owner START =="
    want=0; nonce='-'; utc='-'; hmac='-'
  fi
fi

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
[ "$ARM_ONLY" = 1 ] && exit 0

echo "== produce F1 intent =="
OUT=$(cd "$APPDIR" && node pilot-produce.js 2>&1)
rc=$?
if [ $rc -ne 0 ]; then echo "producer failed:"; echo "$OUT" | sed 's/^/  /'; exit 1; fi

# actionable? (pure text checks; jq is not assumed present on the VPS)
if printf '%s' "$OUT" | grep -q '"actionable":false'; then
  echo "nothing actionable this run (no chunk whose entry has arrived)"; exit 0
fi
if ! printf '%s' "$OUT" | grep -q '"intent"'; then
  echo "no intent in producer output:"; echo "$OUT" | sed 's/^/  /'; exit 1
fi

# extract just the intent object (producer wraps it as {ok,actionable,intent:{...}})
INTENT=$(printf '%s' "$OUT" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['intent']))")
side=$(printf '%s' "$INTENT" | python3 -c "import sys,json; print(json.load(sys.stdin)['side'])")
chunk=$(printf '%s' "$INTENT" | python3 -c "import sys,json; print(json.load(sys.stdin)['chunk_start'])")
echo "  intent: side=$side chunk=$chunk"

if [ "$side" = "FLAT" ]; then
  echo "committee is FLAT this period — no position to open, nothing shipped"; exit 0
fi

TMP=$(mktemp)
printf '%s\n' "$INTENT" > "$TMP"
echo "== ship to box intents/ =="
$SSH "$BOX_USER@$BOX_HOST" 'mkdir -p ~/pilot/intents' || { echo "ssh mkdir failed"; rm -f "$TMP"; exit 1; }
scp -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    "$TMP" "$BOX_USER@$BOX_HOST:~/pilot/intents/intent-$STAMP.json"
rc=$?
rm -f "$TMP"
[ $rc -eq 0 ] && echo "shipped intent-$STAMP.json" || { echo "scp failed"; exit 1; }
