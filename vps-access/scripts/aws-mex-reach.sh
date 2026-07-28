#!/usr/bin/env bash
# aws-mex-reach.sh -- READ-ONLY, hard-bounded: is aws-mex-deb13.pem present, and
# is 78.12.190.144 actually reachable from homsionos01? Uses timeout -k so a
# black-holed connect can't hang the run. No changes.
set -uo pipefail
HOST=78.12.190.144
echo "key: $(find /root /home /etc/deploy-control -maxdepth 5 -name 'aws-mex-deb13.pem' 2>/dev/null | head -1 || echo NOT-FOUND)"
echo -n "ping (2x, 3s): "; ping -c2 -W3 "$HOST" 2>&1 | tail -1
echo -n "tcp/22 (hard 6s): "
r=$(timeout -k 2 6 bash -c "exec 3<>/dev/tcp/$HOST/22 && echo OPEN" 2>/dev/null); echo "${r:-HANG-or-refused}"
echo -n "tcp/443 (hard 6s): "
r=$(timeout -k 2 6 bash -c "exec 3<>/dev/tcp/$HOST/443 && echo OPEN" 2>/dev/null); echo "${r:-HANG-or-refused}"
echo "outbound sanity (can the box reach the internet at all?): tcp/443 to 1.1.1.1"
r=$(timeout -k 2 6 bash -c "exec 3<>/dev/tcp/1.1.1.1/443 && echo OPEN" 2>/dev/null); echo "  1.1.1.1:443 -> ${r:-blocked}"
echo done
