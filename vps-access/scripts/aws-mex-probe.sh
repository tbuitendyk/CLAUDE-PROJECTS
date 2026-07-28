#!/usr/bin/env bash
# aws-mex-probe.sh -- READ-ONLY: locate the AWS-Mexico SSH key on homsionos01,
# test SSH to the new box (HARD 30s cap so it can't hang), and gather facts to
# scope a Route 53 DDNS boot script: is it really EC2 (IMDS), region, its own
# public IPv4, IAM role, aws CLI, hosted zones. No changes to either box.
set -uo pipefail
HOST=78.12.190.144; RUSER=admin
echo "== locate key aws-mex-deb13.pem on homsionos01 =="
KEY=$(find /root /home /etc/deploy-control /root/claude-projects -maxdepth 5 -name 'aws-mex-deb13.pem' 2>/dev/null | head -1)
echo "  key: ${KEY:-NOT FOUND}"
echo "== existing scripts referencing the AWS box? =="
timeout 20 grep -rlsE 'aws-mex-deb13|78\.12\.190\.144' --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=cache /root/.ssh /etc/deploy-control /usr/local/sbin 2>/dev/null | head -5 | sed 's/^/  /' || true
[ -n "$KEY" ] || { echo "No key found -- tell me where aws-mex-deb13.pem lives."; exit 0; }
perm=$(stat -c '%a' "$KEY" 2>/dev/null); echo "  key perms: $perm $([ "$perm" = 600 ] || echo '(ssh wants 600)')"

echo "== reachability of $HOST:22 (5s) =="
if timeout 5 bash -c "echo >/dev/tcp/$HOST/22" 2>/dev/null; then echo "  tcp/22: OPEN"; else echo "  tcp/22: no connect (filtered/down)"; fi

echo "== SSH -> $RUSER@$HOST (hard 30s cap) =="
out=$(timeout 30 ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o PasswordAuthentication=no \
        -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "$RUSER@$HOST" 'bash -s' <<'R' 2>&1
echo "hostname: $(hostname 2>/dev/null)"
echo "os: $( . /etc/os-release 2>/dev/null; echo "$PRETTY_NAME" )"
TOK=$(curl -s -m3 -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 120" 2>/dev/null)
H=(); [ -n "$TOK" ] && H=(-H "X-aws-ec2-metadata-token: $TOK")
for f in instance-id placement/region public-ipv4 local-ipv4; do
  echo "imds $f: $(curl -s -m3 "${H[@]}" "http://169.254.169.254/latest/meta-data/$f" 2>/dev/null || echo '<none>')"
done
echo "iam-role: $(curl -s -m3 "${H[@]}" http://169.254.169.254/latest/meta-data/iam/security-credentials/ 2>/dev/null || echo '<none>')"
echo "aws cli: $(command -v aws 2>/dev/null || echo 'NOT installed')"
command -v aws >/dev/null 2>&1 && aws route53 list-hosted-zones --query 'HostedZones[].[Name,Id]' --output text 2>&1 | head -12 | sed 's/^/zone: /'
R
)
rc=$?
if   [ $rc -eq 124 ]; then echo "  SSH TIMED OUT (30s) -- TCP may be up but SSH not answering / unreachable."
elif [ $rc -ne 0 ];  then echo "  SSH failed (rc=$rc):"; echo "$out" | sed 's/^/  /'
else echo "$out" | sed 's/^/  /'; fi
echo "== done (read-only) =="
