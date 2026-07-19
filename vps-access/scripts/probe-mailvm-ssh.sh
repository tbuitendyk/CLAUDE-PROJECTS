#!/usr/bin/env bash
# probe-mailvm-ssh.sh -- check whether the host can SSH into the mail VM to read its logs (one-shot).
set -uo pipefail
VM=192.168.56.129
echo "=== ~/.ssh hints ==="
[ -f ~/.ssh/config ] && grep -iE 'host |192\.168\.56|mail' ~/.ssh/config | head || echo "(no relevant ~/.ssh/config lines)"
echo "known_hosts entries for $VM: $(grep -c "$VM" ~/.ssh/known_hosts 2>/dev/null || echo 0)"
echo "private keys present:"; ls ~/.ssh/id_* 2>/dev/null | grep -v '\.pub$' | sed 's/^/  /' || echo "  (none)"
echo
for u in root admin; do
  echo "=== try ssh $u@$VM (BatchMode, no password) ==="
  out=$(ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new "$u@$VM" \
        'echo CONNECT_OK; echo "whoami=$(id -un)"; (test -r /var/log/mail.log && echo LOG_READABLE || echo LOG_UNREADABLE)' 2>&1)
  echo "  rc=$? :"; echo "$out" | sed 's/^/  /'
done
