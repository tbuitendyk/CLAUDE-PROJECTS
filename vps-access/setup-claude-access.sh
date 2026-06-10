#!/usr/bin/env bash
# One-time VPS-side setup: scoped SSH access for Claude Code sessions.
#
# Usage (as root, on the VPS):
#   sudo bash setup-claude-access.sh "ssh-ed25519 AAAA... claude-deploy@claude-code"
#
# What it does:
#   1. Creates a dedicated 'claude-deploy' user (no password login, key-only).
#   2. Installs the given SSH public key for that user.
#   3. Adds the user to the systemd-journal group so it can READ service logs
#      (journalctl) without any sudo at all.
#   4. Installs /usr/local/sbin/claude-deploy -- a single root-owned helper
#      script with a fixed menu of deploy/status actions -- and a sudoers
#      rule allowing claude-deploy to run ONLY that helper as root.
#      Nothing else on the box can be touched with elevated rights.
#   5. Hardens sshd for this user only (key-only auth, no forwarding).
#      Global ssh settings are not modified.
#
# Re-running is safe: every step is idempotent.
set -euo pipefail

DEPLOY_USER="claude-deploy"
REPO_DIR="/root/claude-projects"
HELPER="/usr/local/sbin/claude-deploy"
SUDOERS_FILE="/etc/sudoers.d/claude-deploy"
SSHD_DROPIN="/etc/ssh/sshd_config.d/claude-deploy.conf"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (e.g. sudo bash $0 \"<public key>\")" >&2
  exit 1
fi

PUBKEY="${1:-}"
if [[ -z "$PUBKEY" ]]; then
  echo "Usage: sudo bash $0 \"ssh-ed25519 AAAA... comment\"" >&2
  echo "(Generate the pair with: ssh-keygen -t ed25519 -f claude_deploy_key -N '')" >&2
  exit 1
fi
if ! grep -qE '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-[a-z0-9-]+) ' <<<"$PUBKEY"; then
  echo "That doesn't look like an SSH public key line. Pass the .pub contents, quoted." >&2
  exit 1
fi
if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "Expected the repo checkout at $REPO_DIR -- edit REPO_DIR in this script if it moved." >&2
  exit 1
fi

echo "==> Creating user ${DEPLOY_USER} (if missing)"
if ! id "$DEPLOY_USER" &>/dev/null; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi
# Lock the password: SSH key is the only way in.
passwd -l "$DEPLOY_USER" >/dev/null

echo "==> Granting read access to service logs (systemd-journal group)"
usermod -aG systemd-journal "$DEPLOY_USER"

echo "==> Installing the SSH public key"
DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
printf '%s\n' "$PUBKEY" > "$DEPLOY_HOME/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/.ssh/authorized_keys"
chmod 600 "$DEPLOY_HOME/.ssh/authorized_keys"

echo "==> Installing the scoped deploy helper at ${HELPER}"
cat > "$HELPER" <<'HELPER_EOF'
#!/usr/bin/env bash
# The ONLY command claude-deploy may run as root (via sudo). A fixed menu of
# deploy/status actions for the claude-projects monorepo -- nothing
# open-ended. Keep it that way: every new capability added here widens what
# a Claude session can do with root on this production box.
set -euo pipefail

REPO_DIR="/root/claude-projects"

# Each product project lives on its own branch; a deploy syncs to that branch
# before running its installer, so deploys are single-call and always current.
BRANCH_WEBSITE="website"
BRANCH_DUBBER="dubber"

usage() {
  cat >&2 <<USAGE
Usage: sudo claude-deploy <command>

  sync <branch>     fetch <branch> from origin and hard-reset the checkout
                    at ${REPO_DIR} to match it (discards local changes)
  deploy-website    sync the '${BRANCH_WEBSITE}' branch, then run
                    www.buitendyk.ca/deploy/install.sh
  deploy-dubber     sync the '${BRANCH_DUBBER}' branch, then run
                    youtube-spanish-dubber/deploy/install.sh
  restart-dubber    restart the youtube-dubber service (also the way to
                    kill a RUNNING dub job; queued jobs cancel via the UI)
  status            checkout branch/commit + service health (dubber, nginx)
USAGE
  exit 1
}

# Fetch a branch and hard-reset the deploy checkout to it. Shared by `sync`
# (any validated branch) and by the deploy actions (their own fixed branch),
# so a deploy always runs the latest of the correct branch in one call.
sync_to() {
  local branch="$1"
  cd "$REPO_DIR"
  git fetch origin "$branch"
  git checkout -f -B "$branch" "origin/$branch"
  git reset --hard "origin/$branch"
  echo "Now at ${branch}: $(git log --oneline -1)"
}

cmd="${1:-}"
case "$cmd" in
  sync)
    branch="${2:-}"
    [[ -n "$branch" ]] || usage
    # Branch names come from a Claude session: validate hard before they
    # touch a git command line.
    if [[ ! "$branch" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]]; then
      echo "Refusing suspicious branch name: $branch" >&2
      exit 1
    fi
    sync_to "$branch"
    ;;
  deploy-website)
    sync_to "$BRANCH_WEBSITE"
    bash "$REPO_DIR/www.buitendyk.ca/deploy/install.sh"
    ;;
  deploy-dubber)
    sync_to "$BRANCH_DUBBER"
    bash "$REPO_DIR/youtube-spanish-dubber/deploy/install.sh"
    ;;
  restart-dubber)
    systemctl restart youtube-dubber
    sleep 1
    systemctl status youtube-dubber --no-pager | head -8
    ;;
  status)
    if [[ -d "$REPO_DIR/.git" ]]; then
      echo "checkout: $(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null) @ $(git -C "$REPO_DIR" log --oneline -1 2>/dev/null)"
      echo "---"
    fi
    systemctl status youtube-dubber --no-pager | head -8 || true
    echo "---"
    systemctl status nginx --no-pager | head -5 || true
    echo "---"
    nginx -t
    ;;
  *)
    usage
    ;;
esac
HELPER_EOF
chown root:root "$HELPER"
chmod 755 "$HELPER"

echo "==> Installing the sudoers rule (helper script only)"
printf '%s ALL=(root) NOPASSWD: %s\n' "$DEPLOY_USER" "$HELPER" > "${SUDOERS_FILE}.tmp"
chmod 440 "${SUDOERS_FILE}.tmp"
if visudo -cf "${SUDOERS_FILE}.tmp"; then
  mv "${SUDOERS_FILE}.tmp" "$SUDOERS_FILE"
else
  rm -f "${SUDOERS_FILE}.tmp"
  echo "sudoers validation failed -- rule NOT installed" >&2
  exit 1
fi

echo "==> Hardening sshd for ${DEPLOY_USER} only"
SSHD_BLOCK="$(cat <<EOF
Match User ${DEPLOY_USER}
    PasswordAuthentication no
    X11Forwarding no
    AllowAgentForwarding no
    AllowTcpForwarding no
    PermitTunnel no
EOF
)"
if grep -qE '^\s*Include\s+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config 2>/dev/null; then
  mkdir -p /etc/ssh/sshd_config.d
  printf '%s\n' "$SSHD_BLOCK" > "$SSHD_DROPIN"
elif ! grep -q "Match User ${DEPLOY_USER}" /etc/ssh/sshd_config; then
  # No Include support in this sshd_config: append (Match blocks must come last).
  printf '\n%s\n' "$SSHD_BLOCK" >> /etc/ssh/sshd_config
fi
# Never reload a broken config -- that's how you lock yourself out.
sshd -t
systemctl reload ssh || systemctl reload sshd

cat <<EOF

==============================================================================
Done. Summary of what ${DEPLOY_USER} can now do:

  - SSH in with the key you provided (password login disabled)
  - Read service logs:        journalctl -u youtube-dubber -n 100
  - Read anything world-readable (like any unprivileged user)
  - Exactly five root actions, via:  sudo claude-deploy <command>
      sync <branch> | deploy-website | deploy-dubber | restart-dubber | status
  - Nothing else with elevated rights. Mail, certs, databases, other sites:
    untouchable.

Test it from another terminal BEFORE closing this root session:
  ssh -i <private-key-file> ${DEPLOY_USER}@$(hostname -f) 'sudo claude-deploy status'

Next: configure the Claude Code environment -- see vps-access/README.md.
==============================================================================
EOF
