#!/usr/bin/env bash
# hub-status.sh -- READ-ONLY: mail-hub health at a glance. Registry, default
# route, cadence state, queue depths, credential/dependency audit (the
# "couldn't find credentials / no rights" class of failure shows up here),
# and the recent hub log.
set -uo pipefail
HUB=/var/lib/claude-mail/hub
STATE=/var/lib/claude-mail
ENVFILE=/etc/deploy-control/env
now=$(date +%s)

echo "== hub =="
echo "  enabled: $([ -f "$HUB/ENABLED" ] && echo YES || echo NO)"
echo "  cron: $(ls /etc/cron.d/claude-mail-hub 2>/dev/null || echo MISSING)   cron svc: $(systemctl is-active cron 2>/dev/null)"
echo "  installed cycle: $(ls -l /usr/local/sbin/claude-mail-hub-cycle.sh 2>/dev/null | awk '{print $NF, "("$5" bytes)"}' || echo MISSING)"
echo "== registry =="
ls -1 "$HUB/registry" 2>/dev/null | sed 's/^/  /' || echo "  (none)"
echo "  default route: $(cat "$HUB/default-route" 2>/dev/null || echo '(unset)')"
echo "== cadence =="
li=$(cat "$STATE/last-sent" 2>/dev/null || echo 0); case "$li" in (*[!0-9]*|"") li=0;; esac
lp=$(cat "$HUB/last-cycle" 2>/dev/null || echo 0); case "$lp" in (*[!0-9]*|"") lp=0;; esac
echo "  last interaction: $(( (now-li) ))s ago -> mode: $([ $((now-li)) -lt 1200 ] && echo 'FAST (1-min polls)' || echo 'normal (15-min polls)')"
echo "  last poll: $(( (now-lp) ))s ago"
echo "== queues =="
for d in "$HUB"/inbox/*/; do
  [ -d "$d" ] || continue
  n=$(ls "$d" 2>/dev/null | wc -l); dn=$(ls "$HUB/delivered/$(basename "$d")" 2>/dev/null | wc -l)
  echo "  $(basename "$d"): queued=$n delivered=$dn"
done
echo "== dependency audit =="
echo "  env file: $(stat -c '%a %U:%G' "$ENVFILE" 2>/dev/null || echo MISSING)"
grep -q '^CLAUDE_MAIL_PASSWORD=..*' "$ENVFILE" 2>/dev/null && echo "  CLAUDE_MAIL_PASSWORD: present" || echo "  CLAUDE_MAIL_PASSWORD: MISSING"
echo "  mailvm ssh-agent: $(systemctl is-active mailvm-ssh-agent.service 2>/dev/null); keys: $(SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock ssh-add -l 2>&1 | head -1)"
echo "  guest imap 993: $(timeout 5 bash -c 'echo >/dev/tcp/192.168.56.129/993' 2>/dev/null && echo reachable || echo UNREACHABLE)"
echo "  checkout: $(cd /root/claude-projects 2>/dev/null && git rev-parse --short HEAD 2>/dev/null || echo MISSING)"
echo "== hub log (last 15) =="
tail -15 "$HUB/log/hub.log" 2>/dev/null | sed 's/^/  /' || echo "  (empty)"
