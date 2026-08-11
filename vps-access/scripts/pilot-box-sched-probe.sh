#!/usr/bin/env bash
# READ-ONLY: what scheduler can we use on the Mexico box?
set -uo pipefail
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new "$BOX" 'bash -s' <<'R'
echo "crontab bin: $(command -v crontab || echo MISSING)"
echo "cron svc:    $(systemctl is-active cron 2>/dev/null || systemctl is-active crond 2>/dev/null || echo none)"
echo "systemctl:   $(command -v systemctl || echo MISSING)"
echo "user systemd: $(systemctl --user is-system-running 2>&1 | head -1)"
echo "linger:      $(loginctl show-user admin 2>/dev/null | grep -i linger || echo '?')"
echo "sudo -n:     $(sudo -n true 2>&1 && echo 'passwordless-yes' || echo 'no')"
echo "crontab -l:  $(crontab -l 2>&1 | head -2)"
R
