#!/usr/bin/env bash
# pilot-provision-arm-secret.sh -- provision the SHARED arm secret to BOTH the
# VPS classifier UI (/etc/general-classifier/env, read by server.js) and the
# Mexico box (~/.executor-env, read by mx_executor.py), so the screen can SIGN a
# START/STOP and the box can VERIFY it (re-review B1 fail-safe arm).
#
# The secret is generated in place with openssl, chmod 600 on both hosts, and is
# NEVER printed, logged, or committed — only a truncated sha256 fingerprint is
# shown, to prove the two sides carry the SAME value. It transits to the box as a
# chmod-600 temp file over scp (encrypted), never as a command argument.
#
# Idempotent: if the VPS already has a secret it is REUSED (copied to the box),
# so re-running never rotates the key or breaks an armed session.
set -uo pipefail
BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
BOX_USER=admin
KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13-new.pem}"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
ENVF=/etc/general-classifier/env

[ -f "$KEY" ] || { echo "no key at $KEY"; exit 1; }
[ -f "$ENVF" ] || { echo "no $ENVF (classifier not deployed?)"; exit 1; }

umask 077
if grep -q '^PILOT_ARM_SECRET=' "$ENVF"; then
  SECRET=$(grep '^PILOT_ARM_SECRET=' "$ENVF" | head -1 | cut -d= -f2-)
  echo "== VPS: reusing existing arm secret =="
else
  SECRET=$(openssl rand -hex 32)
  printf 'PILOT_ARM_SECRET=%s\n' "$SECRET" >> "$ENVF"
  chmod 600 "$ENVF"
  echo "== VPS: generated a new arm secret =="
fi
FP=$(printf '%s' "$SECRET" | sha256sum | cut -c1-16)

echo "== restart classifier so the UI process picks up the secret =="
systemctl restart general-classifier.service && sleep 1
echo "  service: $(systemctl is-active general-classifier.service 2>/dev/null)"

echo "== provision the SAME secret to the box (chmod-600 file over scp) =="
TMP=$(mktemp); chmod 600 "$TMP"; printf '%s' "$SECRET" > "$TMP"
scp -q -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    "$TMP" "$BOX_USER@$BOX_HOST:~/.arm-secret.tmp"
rc=$?; rm -f "$TMP"
[ $rc -eq 0 ] || { echo "  scp failed"; exit 1; }

$SSH "$BOX_USER@$BOX_HOST" 'bash -s' <<'BOX'
set -uo pipefail
S=$(cat ~/.arm-secret.tmp); rm -f ~/.arm-secret.tmp
umask 077; touch ~/.executor-env; chmod 600 ~/.executor-env
grep -v '^PILOT_ARM_SECRET=' ~/.executor-env > ~/.executor-env.tmp 2>/dev/null || true
printf 'PILOT_ARM_SECRET=%s\n' "$S" >> ~/.executor-env.tmp
mv ~/.executor-env.tmp ~/.executor-env; chmod 600 ~/.executor-env
BOXFP=$(grep '^PILOT_ARM_SECRET=' ~/.executor-env | head -1 | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-16)
echo "  box arm-secret fingerprint: $BOXFP"
echo "  box env perms: $(stat -c %a ~/.executor-env)  keys: $(grep -cE '^(BINANCE_KEY|BINANCE_SECRET|LIVE|PILOT_ARM_SECRET)=' ~/.executor-env)/4"
BOX

echo "== VPS arm-secret fingerprint: $FP =="
echo "== the two fingerprints above MUST match =="
