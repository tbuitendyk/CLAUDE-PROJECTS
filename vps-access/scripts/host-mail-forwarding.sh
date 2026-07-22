#!/usr/bin/env bash
# host-mail-forwarding.sh -- HOST-side READ-ONLY: how do external mail ports
# reach the mail VM (192.168.56.129), and is that path intact after the VM was
# restarted headless? Checks DNAT rules, host listeners/proxies, VBox NAT
# port-forwarding, and host->guest reachability. No changes.
set -uo pipefail
GUEST=192.168.56.129
echo "== host public interfaces =="
ip -4 -brief addr 2>/dev/null | sed 's/^/  /'
echo "== NAT table DNAT/forward rules mentioning the guest or mail ports =="
iptables -t nat -S 2>/dev/null | grep -iE "$GUEST|dport (25|110|143|465|587|993|995)\b" | sed 's/^/  /' || echo "  (NO nat rules for guest/mail ports)"
echo "== filter FORWARD rules mentioning the guest =="
iptables -S FORWARD 2>/dev/null | grep -E "$GUEST" | sed 's/^/  /' || echo "  (none)"
echo "== is the HOST listening on mail ports (proxy/stream forward)? =="
ss -ltnp 2>/dev/null | grep -E ':(25|110|143|465|587|993|995) ' | sed 's/^/  /' || echo "  (host not listening on mail ports)"
echo "== VBox NAT port-forwarding rules configured on HOMSMAIL03 =="
VBoxManage showvminfo HOMSMAIL03 --machinereadable 2>/dev/null | grep -iE 'Forwarding|^nic[0-9]=|^natnet' | sed 's/^/  /' || echo "  (none / VM not visible in this context)"
echo "== host -> guest mail-port reachability =="
for p in 25 587 465 993 143; do timeout 3 bash -c "echo >/dev/tcp/$GUEST/$p" 2>/dev/null && echo "  guest:$p OPEN" || echo "  guest:$p closed"; done
echo "== ip_forward =="
sysctl net.ipv4.ip_forward 2>/dev/null | sed 's/^/  /'
echo "(read-only; no changes made)"
