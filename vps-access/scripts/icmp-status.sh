#!/usr/bin/env bash
# icmp-status.sh -- READ-ONLY: what is the host's ICMP posture? Reports kernel
# sysctls, firewall rules touching icmp, and rate limits. Changes nothing.
set -uo pipefail
echo "== kernel sysctls =="
for k in net.ipv4.icmp_echo_ignore_all net.ipv4.icmp_echo_ignore_broadcasts \
         net.ipv4.icmp_ratelimit net.ipv4.icmp_ratemask; do
  printf "   %-40s = %s\n" "$k" "$(sysctl -n $k 2>/dev/null || echo '?')"
done
echo "   (icmp_echo_ignore_all: 0 = replies to ping, 1 = silent)"
echo
echo "== iptables INPUT policy + any icmp rules =="
echo "   INPUT policy: $(iptables -S INPUT 2>/dev/null | head -1)"
iptables -S 2>/dev/null | grep -i icmp | sed 's/^/   /' || echo "   (no explicit icmp rules)"
echo
echo "== INPUT chain summary (first 15 rules, packet counts) =="
iptables -L INPUT -n -v --line-numbers 2>/dev/null | head -17 | sed 's/^/   /'
echo
echo "== nft ruleset mentioning icmp (if nftables in use) =="
nft list ruleset 2>/dev/null | grep -i icmp | head -8 | sed 's/^/   /' || echo "   (nftables not in use / no icmp rules)"
echo
echo "== persisted sysctl files mentioning icmp =="
grep -rns icmp /etc/sysctl.conf /etc/sysctl.d/ 2>/dev/null | sed 's/^/   /' || echo "   (none)"
echo "(read-only; nothing changed)"
