#!/usr/bin/env bash
# mailvm-verify.sh -- ONE SSH, READ-ONLY: confirm the single-core tuning landed.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@192.168.56.129"
$SSH 'bash -s' <<'R' 2>&1
echo "load: $(cut -d' ' -f1-3 /proc/loadavg)   idle: $(vmstat 1 2 2>/dev/null | tail -1 | awk '{print $15"%"}')"
echo "netdata:   active=$(systemctl is-active netdata 2>/dev/null) enabled=$(systemctl is-enabled netdata 2>/dev/null)  procs=$(pgrep -fc 'netdata|ebpf.plugin|apps.plugin|go.d.plugin' 2>/dev/null || echo 0)"
echo "amavis:    active=$(systemctl is-active amavis 2>/dev/null)  \$max_servers=$(grep -rhoE '\$max_servers[[:space:]]*=[[:space:]]*[0-9]+' /etc/amavis/conf.d/ 2>/dev/null | grep -oE '[0-9]+' | tail -1)  amavisd_procs=$(ps -ef | grep -c '[a]mavisd')"
echo "clamonacc: active=$(systemctl is-active clamav-clamonacc 2>/dev/null) enabled=$(systemctl is-enabled clamav-clamonacc 2>/dev/null)"
echo "freshclam: $(grep -iE '^[[:space:]]*Checks' /etc/clamav/freshclam.conf 2>/dev/null | head -1)"
echo "services:"
for s in postfix dovecot postgresql amavis clamav-daemon iredapd nginx fail2ban; do
  printf "  %-16s %s\n" "$s" "$(systemctl is-active "$s" 2>/dev/null)"
done
echo "top 6 CPU: "; ps -eo pcpu,comm --sort=-pcpu 2>/dev/null | awk 'NR>1&&NR<=7{printf "  %5s%%  %s\n",$1,$2}'
echo "queue: $(postqueue -p 2>/dev/null | tail -1)"
R
