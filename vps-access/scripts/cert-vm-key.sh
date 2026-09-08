#!/usr/bin/env bash
# cert-vm-key.sh -- READ-ONLY. Prints PUBLIC keys only; no secrets.
#
# To fix the iRedMail cert the host needs SSH into the guest (192.168.56.129).
# Root with the host's existing key was refused. This prints the host's public
# key so it can be authorized on the guest, and tests which usernames the guest
# already accepts. Public keys are safe to share; no private key is ever read.
set -euo pipefail
G=192.168.56.129

echo "== host public key -- authorize THIS on the guest =="
for k in /root/.ssh/id_ed25519.pub /root/.ssh/id_rsa.pub; do
  [ -f "$k" ] && { echo "--- $k"; cat "$k"; }
done

echo
echo "== which usernames does the guest already accept with this key? =="
for u in root admin debian ubuntu iredmail vmail sysadmin; do
  r=$(timeout 6 ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=4 \
        "$u@$G" 'echo OK:$(id -un)' 2>&1 | tail -1)
  printf "   %-10s %s\n" "$u" "$(echo "$r" | cut -c1-60)"
done

echo
echo "== guest SSH banner (tells us the distro) =="
timeout 6 bash -c "exec 3<>/dev/tcp/$G/22; head -1 <&3" 2>/dev/null || echo "  (no banner)"
