#!/usr/bin/env bash
# aws-mex-probe.sh -- READ-ONLY: locate the AWS-Mexico SSH key on homsionos01,
# test SSH to the new box, and gather facts to scope a Route 53 DDNS boot
# script: is it really EC2 (IMDS), region, its own public IPv4, IAM role,
# aws CLI, and which hosted zones it can see. No changes to either box.
set -uo pipefail
HOST=78.12.190.144; RUSER=admin
echo "== locate key aws-mex-deb13.pem on homsionos01 =="
KEY=$(find /root /home /etc/deploy-control /root/claude-projects -maxdepth 5 -name 'aws-mex-deb13.pem' 2>/dev/null | head -1)
echo "  key: ${KEY:-NOT FOUND}"
echo "== existing scripts referencing the AWS box? =="
grep -rlsE 'aws-mex-deb13|78\.12\.190\.144' /root /etc/deploy-control /usr/local 2>/dev/null | head -5 | sed 's/^/  /' || true
[ -n "$KEY" ] || { echo "No key found -- tell me where aws-mex-deb13.pem lives and I'll retry."; exit 0; }
perm=$(stat -c '%a' "$KEY" 2>/dev/null); echo "  key perms: $perm $([ "$perm" = 600 ] || echo '(ssh wants 600)')"

echo "== SSH -> $RUSER@$HOST =="
SSH="ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o PasswordAuthentication=no -o StrictHostKeyChecking=accept-new -o ConnectTimeout=12"
$SSH "$RUSER@$HOST" 'bash -s' <<'R' 2>&1 | sed 's/^/  /'
echo "hostname: $(hostname 2>/dev/null)"
echo "os: $( . /etc/os-release 2>/dev/null; echo "$PRETTY_NAME" )"
echo "-- IMDS: really EC2? --"
TOK=$(curl -s -m3 -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 120" 2>/dev/null)
H=(); [ -n "$TOK" ] && H=(-H "X-aws-ec2-metadata-token: $TOK")
for f in instance-id placement/region public-ipv4 local-ipv4; do
  echo "  $f: $(curl -s -m3 "${H[@]}" "http://169.254.169.254/latest/meta-data/$f" 2>/dev/null || echo '<none>')"
done
echo "  iam-role: $(curl -s -m3 "${H[@]}" http://169.254.169.254/latest/meta-data/iam/security-credentials/ 2>/dev/null || echo '<none>')"
echo "-- aws cli + route53 --"
echo "  aws cli: $(command -v aws 2>/dev/null || echo 'NOT installed')"
if command -v aws >/dev/null 2>&1; then
  aws route53 list-hosted-zones --query 'HostedZones[].[Name,Id]' --output text 2>&1 | head -12 | sed 's/^/    zone: /'
fi
R
echo "== done (read-only) =="
