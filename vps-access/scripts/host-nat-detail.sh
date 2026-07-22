#!/usr/bin/env bash
# host-nat-detail.sh -- READ-ONLY: NAT-network port-forward target vs the guest's
# ACTUAL NAT-network IP, to pinpoint the mismatch that broke external mail after
# the headless restart. No changes.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
echo "== NAT networks + port-forward rules (host global config) =="
VBoxManage natnetwork list 2>&1 | sed 's/^/  /'
echo
echo "== HOMSMAIL03 nic2 (NAT network) config =="
VBoxManage showvminfo HOMSMAIL03 --machinereadable 2>/dev/null | grep -iE '^(nic2|nictype2|nat-network2|natnet2|macaddress2|cableconnected2)=' | sed 's/^/  /'
echo
echo "== guest interfaces + which IP is on the NAT nic (via host-only SSH) =="
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=12 root@192.168.56.129 \
  'ip -4 -brief addr show | grep -vE "lo|127\."; echo "routes:"; ip -4 route' 2>&1 | sed 's/^/  /'
echo "(read-only; no changes made)"
