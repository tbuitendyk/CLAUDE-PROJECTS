#!/usr/bin/env bash
# mail-channel-status.sh -- health check of the claude@ mail channel:
# (1) is anything ON THE HOST polling it (cron/timer), or do sessions poll?
# (2) is the mailvm ssh-agent (log-verification dependency) alive?
# (3) run claude-mail-check.sh live and show the result.
set -uo pipefail
echo "== host-side pollers? (cron/systemd mentioning claude-mail) =="
grep -rsl 'claude-mail' /etc/cron.d /etc/cron.*/ /var/spool/cron 2>/dev/null | sed 's/^/  /' || echo "  (no cron entries -- polling is session-driven)"
systemctl list-timers --all --no-pager 2>/dev/null | grep -i claude | sed 's/^/  /' || true
echo "== mailvm ssh-agent (needed for the SASL verification step) =="
echo "  service: $(systemctl is-active mailvm-ssh-agent.service 2>/dev/null)"
SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock ssh-add -l 2>&1 | head -2 | sed 's/^/  /'
echo "== state dir =="
ls -l /var/lib/claude-mail/ 2>/dev/null | sed 's/^/  /' || echo "  (missing)"
echo
echo "================ live run: claude-mail-check.sh ================"
bash "$(dirname "$0")/claude-mail-check.sh"
