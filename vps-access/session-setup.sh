#!/usr/bin/env bash
# Claude Code environment-side setup: wires this session up to the VPS.
#
# PASTE THIS SCRIPT'S BODY into the environment's setup-script field at
# claude.ai/code (do NOT reference it by repo path -- this file lives only on
# the vps-access branch, but the setup script must run on every branch;
# see README.md). It then runs at the start of every session. Reads its inputs
# from environment variables configured as secrets on the Claude Code environment:
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

# ---------------------------------------------------------------------------
# Claude Code permissions: pre-authorize the CONVEYOR scheduling tools.
#
# Runs BEFORE the session's model starts, so these land in user-scope settings
# in time to be read. A session cannot write this file itself (the auto-mode
# classifier refuses self-granted permissions) -- the setup script is the
# supported place for it.
#
# NOTE: auto mode does NOT read permissions.allow. It runs its own classifier
# with its own rule sections (autoMode.allow / soft_deny / hard_deny). Both
# blocks are written so the behaviour is identical in every permission mode.
# "$defaults" inherits the built-in rules -- never omit it.
# ---------------------------------------------------------------------------
echo "==> Writing Claude Code permission settings"
mkdir -p "$HOME/.claude"
CC_SETTINGS="$HOME/.claude/settings.json"

CONVEYOR_SETTINGS=$(cat <<'JSON'
{
  "permissions": {
    "allow": [
      "mcp__Claude_Code_Remote__create_session",
      "mcp__Claude_Code_Remote__create_trigger",
      "mcp__Claude_Code_Remote__delete_trigger",
      "mcp__Claude_Code_Remote__update_trigger",
      "mcp__Claude_Code_Remote__fire_trigger",
      "mcp__Claude_Code_Remote__list_triggers",
      "mcp__Claude_Code_Remote__get_session",
      "mcp__Claude_Code_Remote__list_sessions",
      "mcp__Claude_Code_Remote__archive_session",
      "mcp__Claude_Code_Remote__send_later"
    ]
  },
  "autoMode": {
    "allow": [
      "$defaults",
      "Creating, listing, updating, firing, or deleting Claude Code Remote scheduled triggers (Routines) through the mcp__Claude_Code_Remote__*_trigger tools. The account owner has explicitly authorized these as unattended operations for the CONVEYOR protocol; they are reversible and affect only this account's own scheduling state.",
      "Creating Claude Code Remote sessions through mcp__Claude_Code_Remote__create_session, including sessions that clone and push to the owner's own tbuitendyk/CLAUDE-PROJECTS repository. This is the dispatch step of the owner-authorized CONVEYOR protocol for unattended multi-step work.",
      "Reading, listing, and archiving Claude Code Remote sessions through mcp__Claude_Code_Remote__get_session, list_sessions, and archive_session."
    ]
  }
}
JSON
)

if [[ -s "$CC_SETTINGS" ]] && command -v jq >/dev/null 2>&1; then
  # Merge rather than clobber: keep whatever else is already configured, and
  # union the allow arrays so re-running is idempotent.
  if jq -e . "$CC_SETTINGS" >/dev/null 2>&1; then
    printf '%s' "$CONVEYOR_SETTINGS" > /tmp/conveyor-settings.json
    jq -s '
      .[0] as $cur | .[1] as $new |
      $cur
      | .permissions.allow = (((($cur.permissions.allow) // []) + $new.permissions.allow) | unique)
      | .autoMode.allow   = (((($cur.autoMode.allow)   // []) + $new.autoMode.allow)   | unique)
    ' "$CC_SETTINGS" /tmp/conveyor-settings.json > /tmp/conveyor-merged.json \
      && mv /tmp/conveyor-merged.json "$CC_SETTINGS"
    rm -f /tmp/conveyor-settings.json
  else
    echo "    existing $CC_SETTINGS is not valid JSON; leaving it alone" >&2
  fi
else
  printf '%s\n' "$CONVEYOR_SETTINGS" > "$CC_SETTINGS"
fi

if command -v jq >/dev/null 2>&1 && jq -e '.autoMode.allow | length > 1' "$CC_SETTINGS" >/dev/null 2>&1; then
  echo "    permissions written: $CC_SETTINGS"
else
  echo "    WARNING: $CC_SETTINGS may not have been written correctly" >&2
fi


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
