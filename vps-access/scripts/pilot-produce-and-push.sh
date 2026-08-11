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
want=0; nonce='-'; utc='-'; hmac='-'
if [ -f "$REQ" ]; then
  # carry the whole authenticated request (nonce/utc/hmac) to the box, not just
  # armed:true — the box validates the HMAC and the freshness+nonce edge before
  # honoring it (findings 12/15).
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
) || { want=0; nonce='-'; utc='-'; hmac='-'; }
fi

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

# Carry the owner's CHOSEN protective stop to the box (owner 2026-08-11). Running
# the scan applies NOTHING; the owner chooses a value (or none) which the classifier
# writes to data/pilot/fixed-stop.json. This carries that choice into the box's
# ~/.executor-env: a positive value sets FIXED_STOP_PCT; no value (or a cleared
# choice) REMOVES it so the box runs with no stop. Idempotent — the box env is
# rewritten only on a real change. A risk parameter, never an authorization to
# trade: it opens nothing, and it is carried regardless of arm/mirror state.
FIXEDSTOP="$APPDIR/data/pilot/fixed-stop.json"
DESIRED_STOP=$(python3 - "$FIXEDSTOP" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    v = d.get("stopPct")
    print(f"{float(v):.6f}" if isinstance(v, (int, float)) and v > 0 else "")
except Exception:
    print("")
PY
)
echo "== carry fixed stop -> box: ${DESIRED_STOP:-<none: no stop>} =="
$SSH "$BOX_USER@$BOX_HOST" "DESIRED='$DESIRED_STOP' bash -s" 2>&1 <<'RSTOP' | sed 's/^/  /' || echo "  (box unreachable; stop carry retried next sync)"
ENV=~/.executor-env
cur=$(grep -E '^FIXED_STOP_PCT=' "$ENV" 2>/dev/null | tail -1 | cut -d= -f2)
if [ -z "$DESIRED" ]; then
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
