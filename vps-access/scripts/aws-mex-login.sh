#!/usr/bin/env bash
# aws-mex-login.sh -- minimal SSH login test to the AWS-Mexico box, hard-killed
# so it cannot hang. Identifies the box only (no IMDS/aws-cli calls). READ-ONLY.
set -uo pipefail
KEY=/root/.ssh/aws-mex-deb13.pem
HOST=78.12.190.144; RUSER=admin
echo "== SSH login (hard 25s cap) =="
timeout -k 5 25 ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o PasswordAuthentication=no \
  -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "$RUSER@$HOST" \
  'echo LOGIN_OK; hostname; grep PRETTY_NAME= /etc/os-release; echo "user=$(id -un)"; uname -sr; echo "curl=$(command -v curl || echo no)"; echo "aws=$(command -v aws || echo no)"' 2>&1
echo "ssh_rc=$? (124=timed out)"
