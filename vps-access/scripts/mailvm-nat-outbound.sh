#!/usr/bin/env bash
# mailvm-nat-outbound.sh -- READ-ONLY: does the guest's NAT-network path work
# outbound? Distinguishes a fully-dead NAT path (needs context-correct restart)
# from inbound-forward-only breakage. No changes.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=12 root@192.168.56.129 'bash -s' <<'R' 2>&1
echo "ping NAT gateway 10.0.2.1:"; ping -c2 -W2 10.0.2.1 2>&1 | tail -2 | sed 's/^/  /'
echo "ping 8.8.8.8 (outbound via NAT):"; ping -c2 -W2 8.8.8.8 2>&1 | tail -2 | sed 's/^/  /'
echo "DNS + HTTPS outbound:"; timeout 10 curl -sS -m 8 -o /dev/null -w '  https www.google.com -> http=%{http_code} time=%{time_total}s\n' https://www.google.com 2>&1 || echo "  curl FAILED (no outbound)"
R
