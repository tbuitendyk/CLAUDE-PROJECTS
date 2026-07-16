#!/usr/bin/env bash
# set-support-pw.sh <base64-password>   (one-shot; deleted after use)
#
# Decode base64 $1 and store it as SUPPORT_SMTP_PASSWORD in
# /etc/deploy-control/env, preserving the other entries. The plaintext password
# is never in this file or in git -- it arrives base64-encoded as the argument.
set -euo pipefail
enc="${1:-}"
ENVFILE=/etc/deploy-control/env
[[ -n "$enc" ]] || { echo "usage: set-support-pw.sh <base64-password>" >&2; exit 1; }
[[ -f "$ENVFILE" ]] || { echo "missing $ENVFILE" >&2; exit 1; }
pw="$(printf '%s' "$enc" | base64 -d 2>/dev/null)" || { echo "bad base64 arg" >&2; exit 1; }
[[ -n "$pw" ]] || { echo "empty decoded password" >&2; exit 1; }
tmp="$(mktemp)"
grep -v '^SUPPORT_SMTP_PASSWORD=' "$ENVFILE" > "$tmp" || true
printf 'SUPPORT_SMTP_PASSWORD=%s\n' "$pw" >> "$tmp"
install -o root -g claude-deploy -m 640 "$tmp" "$ENVFILE"
rm -f "$tmp"
echo "SUPPORT_SMTP_PASSWORD written to $ENVFILE (decoded length=${#pw})"
