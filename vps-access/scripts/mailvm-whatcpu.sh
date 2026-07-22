#!/usr/bin/env bash
# mailvm-whatcpu.sh -- ONE SSH, READ-ONLY: what is consuming the single core?
# Distinguishes a transient post-boot warm-up (freshclam/clamd DB load,
# sa-update, cron) from steady-state amavis/clamav/spamd load. No changes.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@192.168.56.129"
$SSH 'bash -s' <<'R' 2>&1
echo "load: $(cut -d' ' -f1-3 /proc/loadavg)   up: $(cut -d. -f1 /proc/uptime)s"
echo "-- top 8 by CPU --"
ps -eo pcpu,pid,etimes,comm --sort=-pcpu 2>/dev/null | head -9 \
  | awk 'NR==1{printf "   %5s %6s %8s  %s\n","%CPU","PID","ELAPS","COMMAND"} NR>1{printf "   %5s %6s %7ss  %s\n",$1,$2,$3,$4}'
echo "-- clamav-freshclam recent log --"
journalctl -u clamav-freshclam --no-pager -n 3 2>/dev/null | sed 's/^/   /' || echo "   (n/a)"
echo "-- warm-up / scan jobs running --"
ps -eo pid,args 2>/dev/null | grep -iE 'sa-update|freshclam|clamscan|sa-compile|rkhunter|chkrootkit|logrotate|unattended|apt|spamd' | grep -v grep | cut -c1-96 | sed 's/^/   /' || echo "   (none)"
echo "-- R (runnable) + D (uninterruptible/io) task comms --"
ps -eo state,comm --no-headers 2>/dev/null | awk '$1 ~ /^[RD]/{print $1,$2}' | sort | uniq -c | sort -rn | head -8 | sed 's/^/   /'
echo "-- cpu vs io split (vmstat: us sy id wa) --"
vmstat 1 2 2>/dev/null | tail -1 | awk '{printf "   user=%s%% sys=%s%% idle=%s%% iowait=%s%%\n",$13,$14,$15,$16}'
R
