#!/usr/bin/env bash
# pilot-entry-timers-check.sh -- READ-ONLY: confirm the two schedules that decide
# WHEN an entry can be filled are installed and due, on BOTH hosts.
#
# The VPS half is no longer a separate prime-at-01:00 timer: producing belongs to
# each profile's own tick now, and a profile states its own entry offset rather
# than inheriting a 01:00 frozen into a unit file. The box half is still an extra
# executor run just after the hour, which only tightens fill latency.
set -uo pipefail
BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
BOX_USER=admin
KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13-new.pem}"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"

echo "== VPS: live-tick (produce every trading profile's intent) =="
systemctl is-enabled live-tick.timer 2>/dev/null | sed 's/^/  enabled: /'
systemctl list-timers live-tick.timer --all 2>/dev/null | grep -i live-tick | sed 's/^/  /' || echo "  (not listed)"
for u in pilot-tick.timer pilot-tick-entry.timer; do
  if [ -f "/etc/systemd/system/$u" ]; then
    echo "  WARNING: retired unit $u is still on disk — re-run pilot-install.sh to remove it"
  fi
done

echo "== box: pilot-exec-entry (fill right after the intent lands) =="
$SSH "$BOX_USER@$BOX_HOST" 'bash -s' <<'BOX'
set -uo pipefail
systemctl is-enabled pilot-exec-entry.timer 2>/dev/null | sed 's/^/  enabled: /'
systemctl list-timers pilot-exec-entry.timer --all 2>/dev/null | grep -i pilot-exec-entry | sed 's/^/  /' || echo "  (not listed)"
echo "  master switch (ARM) now: $([ -f ~/pilot/ARM ] && echo 'ARMED — RUNNING' || echo STOPPED)"
BOX
echo "(read-only)"
