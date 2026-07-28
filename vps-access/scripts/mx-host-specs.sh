#!/usr/bin/env bash
# mx-host-specs.sh -- read-only: what is the AWS Querétaro box actually made
# of? Instance size decides whether the classifier could ever live there, and
# guessing "it's free tier so probably 2 vCPU" is not a basis for a migration
# decision.
set -uo pipefail
KEY=/root/.ssh/aws-mex-deb13.pem
HOST=admin@78.12.190.144
ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "$HOST" 'bash -s' <<'R' 2>&1
echo "instance : $(curl -s --max-time 3 http://169.254.169.254/latest/meta-data/instance-type 2>/dev/null || echo '?')"
echo "cpus     : $(nproc)"
lscpu 2>/dev/null | grep -E "^(Model name|CPU\(s\)|Thread\(s\) per core):" | sed 's/^/           /'
echo "memory   :"; free -m | sed -n '1,3p' | sed 's/^/           /'
echo "disk     :"; df -h / | sed 's/^/           /'
echo "load     : $(cut -d' ' -f1-3 /proc/loadavg)   up $(cut -d. -f1 /proc/uptime)s"
echo "node     : $(command -v node >/dev/null && node -v || echo 'not installed')"
R
