#!/usr/bin/env bash
# probe-host-key.sh -- is /root/.ssh/id_ed25519 passphrase-protected (usable unattended)?
set -uo pipefail
K=/root/.ssh/id_ed25519
echo "key: $K"
if ssh-keygen -y -f "$K" -P '' >/tmp/hk.$$ 2>/dev/null; then
  echo "PASSPHRASE: none -- key IS usable unattended (so the failure is something else)"
  echo "fingerprint from private key: $(ssh-keygen -lf /tmp/hk.$$)"
else
  echo "PASSPHRASE: SET -- BatchMode can't sign with it. This is why auth fails after 'Server accepts key'."
fi
rm -f /tmp/hk.$$
