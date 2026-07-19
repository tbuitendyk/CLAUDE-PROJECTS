#!/usr/bin/env bash
# probe-mailvm-ssh.sh -- diagnose host->mail-VM SSH: host key fingerprint + verbose auth exchange.
set -uo pipefail
VM=192.168.56.129
echo "=== host key fingerprint (this must appear in the VM's authorized_keys) ==="
ssh-keygen -lf /root/.ssh/id_ed25519.pub
echo
echo "=== ssh -vvv root@$VM (which key is offered, and the server's verdict) ==="
ssh -vvv -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new \
    root@"$VM" 'echo CONNECTED_OK; id -un; test -r /var/log/mail.log && echo LOG_READABLE' 2>&1 \
  | grep -iE 'Offering public key|Authentications that can continue|Server accepts key|Permission denied|Authenticated to|CONNECTED_OK|LOG_READABLE' \
  | head -20
