#!/usr/bin/env bash
# probe-mailvm-agent.sh -- read-only diagnosis of the mailvm ssh-agent + askpass (no restart).
set -uo pipefail
SOCK=/run/mailvm-ssh-agent.sock
echo "=== service state ==="
systemctl is-active mailvm-ssh-agent.service 2>&1 || true
systemctl --no-pager status mailvm-ssh-agent.service 2>&1 | tail -6
echo "=== keys in agent ==="
SSH_AUTH_SOCK="$SOCK" ssh-add -l 2>&1 || true
echo "=== which passphrase var is set in env ==="
grep -oE '^MAILVM_KEY_PASSPHRASE(_B64)?=' /etc/deploy-control/env 2>/dev/null || echo "(none)"
echo "=== askpass output byte-length (NOT the value) ==="
if [ -x /usr/local/sbin/mailvm-askpass.sh ]; then
  n=$(/usr/local/sbin/mailvm-askpass.sh 2>/dev/null | wc -c); echo "askpass emits $n bytes"
else
  echo "(askpass helper missing)"
fi
echo "=== does the private key decrypt with the askpass passphrase? ==="
if /usr/local/sbin/mailvm-askpass.sh 2>/dev/null | { read -r P; ssh-keygen -y -f /root/.ssh/id_ed25519 -P "$P" >/dev/null 2>&1 && echo "YES -- passphrase is correct" || echo "NO -- decoded passphrase is wrong/empty"; }; then :; fi
