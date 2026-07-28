#!/usr/bin/env bash
# mailvm-schedule-restart.sh -- install (or refresh) the systemd timer that
# restarts the HOMSMAIL03 guest daily at 09:00 UTC.
#
# Idempotent: safe to re-run after every deploy. It rewrites the unit files
# from the copies in this branch, so the schedule is version-controlled rather
# than living only in someone's crontab.
#
# A systemd timer rather than cron, for three reasons that matter here:
#   * OnCalendar takes an explicit timezone, so 09:00 UTC means 09:00 UTC
#     whatever the host is set to and whatever DST does.
#   * Persistent=true runs a missed restart once the box comes back, instead
#     of silently skipping the day.
#   * `systemctl status mailvm-restart` and `journalctl -u mailvm-restart`
#     give the run history for free.
#
# To stop it:   systemctl disable --now mailvm-restart.timer
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET=/usr/local/sbin/mailvm-restart.sh

echo "==> Installing the restart script to ${TARGET}"
install -o root -g root -m 750 "${REPO_DIR}/vps-access/scripts/mailvm-restart.sh" "$TARGET"

echo "==> Writing the service unit"
cat > /etc/systemd/system/mailvm-restart.service <<UNIT
[Unit]
Description=Daily graceful restart of the HOMSMAIL03 mail guest
Documentation=https://github.com/tbuitendyk/CLAUDE-PROJECTS vps-access/scripts/mailvm-restart.sh
After=network-online.target

[Service]
Type=oneshot
ExecStart=${TARGET}
# The script talks to the guest over the shared agent socket.
Environment=SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
# A restart that fails must be visible, not retried into a loop.
TimeoutStartSec=600
UNIT

echo "==> Writing the timer unit (09:00 UTC daily)"
cat > /etc/systemd/system/mailvm-restart.timer <<'UNIT'
[Unit]
Description=Restart the HOMSMAIL03 mail guest every day at 09:00 UTC

[Timer]
OnCalendar=*-*-* 09:00:00 UTC
# Run a missed restart on the next boot rather than skipping the day.
Persistent=true
# Zero jitter: the owner picked this hour deliberately.
RandomizedDelaySec=0
Unit=mailvm-restart.service

[Install]
WantedBy=timers.target
UNIT

echo "==> Enabling"
systemctl daemon-reload
systemctl enable --now mailvm-restart.timer
touch /var/log/mailvm-restart.log
chmod 640 /var/log/mailvm-restart.log

echo
echo "==> Timer state"
systemctl --no-pager status mailvm-restart.timer 2>&1 | head -8
echo
systemctl list-timers --all mailvm-restart.timer --no-pager 2>&1 | head -4
echo
echo "Installed. Next run is shown above; nothing was restarted just now."
echo "Dry-run it any time with:  run-script mailvm-restart-now.sh"
