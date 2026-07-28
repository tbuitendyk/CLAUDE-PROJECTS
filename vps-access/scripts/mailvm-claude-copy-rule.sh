#!/usr/bin/env bash
# mailvm-claude-copy-rule.sh -- owner request (verified mail, 2026-07-28
# 20:00Z): file a COPY of every message from claude@ to theodore@ into
# theodore's existing "INBOX/Claude HOMS Worker" folder.
#
# Personal Sieve, not the global sieve_before file. theodore@ has no personal
# script today, so this is a clean slate with no merging of require lines and
# no blast radius beyond one mailbox — a syntax error in the GLOBAL script
# would be evaluated for every delivery on the server.
#
# The folder name is taken from what Dovecot already reports rather than
# assumed: this namespace separates with "/", and "INBOX/Claude HOMS Worker"
# already exists, so nothing is created and nothing is renamed.
#
# :copy keeps the message in INBOX as well — a COPY was asked for, not a move.
#
# COMPILE BEFORE ACTIVATING. An uncompilable script is logged and skipped by
# Dovecot rather than bouncing mail, but it would silently mean "no rule", so
# sievec has to pass before the file is left in place; on failure the previous
# state is restored.
#
# Idempotent: safe to re-run.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 root@192.168.56.129 'bash -s' <<'R' 2>&1
set -uo pipefail
USER_ADDR=theodore@homeandofficemicro.com
FOLDER="INBOX/Claude HOMS Worker"
HOME_DIR=$(doveadm user -f home "$USER_ADDR" 2>/dev/null)
[ -n "$HOME_DIR" ] || { echo "FAILED: cannot resolve home for $USER_ADDR"; exit 1; }
SIEVE_DIR="$HOME_DIR/sieve"
SIEVE="$SIEVE_DIR/dovecot.sieve"

# Confirm the destination exists; refuse rather than invent a folder.
if ! doveadm mailbox list -u "$USER_ADDR" 2>/dev/null | grep -qxF "$FOLDER"; then
  echo "FAILED: mailbox '$FOLDER' does not exist for $USER_ADDR — not creating one"
  exit 1
fi

mkdir -p "$SIEVE_DIR"
[ -f "$SIEVE" ] && cp -a "$SIEVE" "${SIEVE}.bak-$(date +%Y%m%d%H%M%S)"

cat > "${SIEVE}.new" <<'SIEVE_EOF'
require ["fileinto", "copy", "mailbox", "envelope"];

# --- claude worker copy (managed by mailvm-claude-copy-rule.sh) ---
# A COPY of everything the worker sends here, filed for review. :copy leaves
# the original in INBOX; without it this would silently divert the mail.
if allof (
  address :is :all "from" "claude@homeandofficemicro.com",
  envelope :is "to" "theodore@homeandofficemicro.com"
) {
  fileinto :copy "INBOX/Claude HOMS Worker";
}
# --- end claude worker copy ---
SIEVE_EOF

if ! sievec "${SIEVE}.new" 2>&1 | sed 's/^/  sievec: /'; then
  echo "FAILED: sieve did not compile — leaving the previous state untouched"
  rm -f "${SIEVE}.new" "${SIEVE}.new.svbin"
  exit 1
fi
mv "${SIEVE}.new" "$SIEVE"
rm -f "${SIEVE}.new.svbin"
sievec "$SIEVE" 2>&1 | sed 's/^/  sievec: /'
OWNER=$(stat -c '%U:%G' "$HOME_DIR")
chown -R "$OWNER" "$SIEVE_DIR"
chmod 600 "$SIEVE" 2>/dev/null

echo "installed: $SIEVE  (owner $OWNER)"
echo "--- active rule ---"
sed 's/^/  /' "$SIEVE"
echo "--- folder check ---"
doveadm mailbox status -u "$USER_ADDR" messages "$FOLDER" 2>/dev/null | sed 's/^/  /'
R
