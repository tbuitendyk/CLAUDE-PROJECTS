#!/usr/bin/env bash
# aws-mex-awsinfo.sh -- READ-ONLY, hard-bounded: region/instance/public-IP from
# IMDS, IAM role, and whether the box can already reach Route 53 (which zones).
# AWS_METADATA_* + timeout -k keep the SDK from stalling. No changes.
set -uo pipefail
KEY=/root/.ssh/aws-mex-deb13.pem; HOST=78.12.190.144; RUSER=admin
timeout -k 5 45 ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o PasswordAuthentication=no \
  -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "$RUSER@$HOST" 'bash -s' <<'R' 2>&1
export AWS_METADATA_SERVICE_TIMEOUT=2 AWS_METADATA_SERVICE_NUM_ATTEMPTS=1 AWS_MAX_ATTEMPTS=2
TOK=$(curl -s -m3 -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 120" 2>/dev/null)
H=(); [ -n "$TOK" ] && H=(-H "X-aws-ec2-metadata-token: $TOK")
md(){ curl -s -m3 "${H[@]}" "http://169.254.169.254/latest/meta-data/$1" 2>/dev/null; }
echo "region:       $(md placement/region)"
echo "az:           $(md placement/availability-zone)"
echo "instance-id:  $(md instance-id)"
echo "public-ipv4:  $(md public-ipv4)   (user said 78.12.190.144)"
echo "iam-role:     $(md iam/security-credentials/ || echo none)"
echo "-- aws identity (bounded 15s) --"
timeout -k 3 15 aws sts get-caller-identity --output text 2>&1 | head -3
echo "-- route53 hosted zones (bounded 15s) --"
timeout -k 3 15 aws route53 list-hosted-zones --query 'HostedZones[].[Name,Id]' --output text 2>&1 | head -12
R
echo "ssh_rc=$? (124=timed out)"
