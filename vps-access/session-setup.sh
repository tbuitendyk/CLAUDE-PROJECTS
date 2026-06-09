#!/usr/bin/env bash
# Claude Code environment-side setup: wires this session up to the VPS.
#
# Run automatically at session start (add `bash vps-access/session-setup.sh`
# to the environment's setup script at claude.ai/code), or manually at any
# time. Reads its inputs from environment variables configured as secrets on
# the Claude Code environment:
#
#   VPS_SSH_PRIVATE_KEY_B64   (required) base64 of the claude-deploy private
#                             key: `base64 -w0 claude_deploy_key`
#   VPS_SSH_HOST_KEY          (recommended) the VPS host-key line from
#                             `ssh-keyscan -t ed25519 <host>` -- pins the
#                             server identity so a MITM'd first connection
#                             can't impersonate it
#   VPS_SSH_HOST              (optional) defaults to
#                             homsionos01.homeandofficemicro.com
#
# After this runs, the VPS is reachable as plain `ssh vps`, e.g.:
#   ssh vps 'journalctl -u youtube-dubber -n 50'
#   ssh vps 'sudo claude-deploy status'
set -euo pipefail

HOST="${VPS_SSH_HOST:-homsionos01.homeandofficemicro.com}"
KEY_FILE="$HOME/.ssh/vps_claude_deploy"

if [[ -z "${VPS_SSH_PRIVATE_KEY_B64:-}" ]]; then
  echo "VPS_SSH_PRIVATE_KEY_B64 is not set -- add it as a secret on the" >&2
  echo "Claude Code environment (see vps-access/README.md). Skipping VPS setup." >&2
  exit 0   # don't fail the whole session over an optional integration
fi

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"

base64 -d <<<"$VPS_SSH_PRIVATE_KEY_B64" > "$KEY_FILE"
chmod 600 "$KEY_FILE"

if [[ -n "${VPS_SSH_HOST_KEY:-}" ]]; then
  # Pinned host key from the environment secrets: the trustworthy path.
  if ! grep -qF "$VPS_SSH_HOST_KEY" "$HOME/.ssh/known_hosts" 2>/dev/null; then
    printf '%s\n' "$VPS_SSH_HOST_KEY" >> "$HOME/.ssh/known_hosts"
  fi
else
  # Fallback: trust-on-first-scan. Fine day to day, but set VPS_SSH_HOST_KEY.
  echo "WARNING: VPS_SSH_HOST_KEY not set; falling back to ssh-keyscan." >&2
  ssh-keyscan -t ed25519 "$HOST" >> "$HOME/.ssh/known_hosts" 2>/dev/null || {
    echo "ssh-keyscan failed -- check the environment's network policy allows SSH." >&2
    exit 1
  }
fi
chmod 600 "$HOME/.ssh/known_hosts"

# A stable alias so every session uses identical, predictable invocations.
touch "$HOME/.ssh/config"
if ! grep -q '^Host vps$' "$HOME/.ssh/config"; then
  cat >> "$HOME/.ssh/config" <<EOF
Host vps
    HostName ${HOST}
    User claude-deploy
    IdentityFile ${KEY_FILE}
    IdentitiesOnly yes
    StrictHostKeyChecking yes
    ConnectTimeout 15
EOF
fi
chmod 600 "$HOME/.ssh/config"

echo "==> Testing the connection"
if ssh -o BatchMode=yes vps 'echo "Connected to $(hostname -f) as $(whoami)"'; then
  echo "==> VPS access ready: use 'ssh vps <command>'"
else
  echo "Connection failed. Checklist:" >&2
  echo "  - Did setup-claude-access.sh run on the VPS with the matching public key?" >&2
  echo "  - Does the environment's network policy allow outbound SSH (port 22)?" >&2
  echo "  - Is VPS_SSH_HOST_KEY current? (Re-run ssh-keyscan if the host was rebuilt.)" >&2
  exit 1
fi
