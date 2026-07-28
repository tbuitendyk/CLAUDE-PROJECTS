#!/usr/bin/env bash
# mx-host-quickcheck.sh -- fast, hard-bounded reconnaissance of the Mexico
# host: is the key present, is port 22 open, what is the IP's real
# geolocation. Every step has a short timeout so this can never hang.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/mx-endpoint.sh"
IP="${MX_HOST}"
echo "== key present? =="
ls -l /root/aws-mex-deb13.pem /root/.ssh/aws-mex-deb13.pem 2>/dev/null || echo "  not in /root or /root/.ssh"
timeout 20 find /root /home /etc/deploy-control -maxdepth 3 -name '*.pem' 2>/dev/null | head -5 || true
echo "== port 22 open? (5s) =="
timeout 6 bash -c "</dev/tcp/${IP}/22" 2>/dev/null && echo "  22 OPEN" || echo "  22 CLOSED/filtered"
echo "== port 443 on that host? (5s) =="
timeout 6 bash -c "</dev/tcp/${IP}/443" 2>/dev/null && echo "  443 OPEN" || echo "  443 closed"
echo "== what IS this IP? =="
timeout 15 curl -s "http://ip-api.com/json/${IP}?fields=status,country,regionName,city,isp,org,as" || echo "  lookup failed"
echo
timeout 15 curl -s "https://ipinfo.io/${IP}/json" | head -c 300 || true
echo
