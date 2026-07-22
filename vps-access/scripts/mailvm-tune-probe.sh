#!/usr/bin/env bash
# mailvm-tune-probe.sh -- READ-ONLY: gather the knobs that matter for tuning
# iRedMail down to a SINGLE vCPU (multi-core guests are not available on this
# IONOS host). Reports amavis max_servers + live worker count, ClamAV/freshclam
# config + memory, SpamAssassin/cron spikers, fail2ban load, inbound abuse
# volume, postfix rate limits, and current steady-state load. Makes no changes.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 root@192.168.56.129"
$SSH 'bash -s' <<'R' 2>&1
echo "== load / uptime (steady-state check) =="; uptime
echo "== amavis max_servers (config) =="
grep -rhsnE '^[[:space:]]*\$max_servers' /etc/amavis* 2>/dev/null | sed 's/^/  /' || true
grep -rlsE '\$max_servers' /etc/amavis* 2>/dev/null | sed 's/^/  set in: /' || echo "  (\$max_servers not set anywhere -> amavisd default 2)"
echo "== amavis processes running now =="; ps -ef 2>/dev/null | grep -c '[a]mavisd'
echo "== clamd / freshclam memory (KB) =="
ps -eo rss,comm --sort=-rss 2>/dev/null | grep -iE 'clamd|freshclam' | awk '{printf "  %8s  %s\n",$1,$2}'
echo "== freshclam update frequency =="
grep -iE '^[[:space:]]*Checks' /etc/clamav/freshclam.conf 2>/dev/null | sed 's/^/  /' || echo "  Checks not set -> default 24/day"
echo "== clamd concurrency knobs =="
grep -iE '^[[:space:]]*(MaxThreads|MaxQueue|ConcurrentDatabaseReload|MaxScanSize)' /etc/clamav/clamd.conf 2>/dev/null | sed 's/^/  /' || echo "  (all defaults)"
echo "== spamassassin service + sa/clam cron =="
systemctl is-active spamassassin spamd amavis clamav-daemon clamav-freshclam 2>/dev/null | paste -sd' '
ls /etc/cron.d /etc/cron.daily /etc/cron.hourly 2>/dev/null | grep -iE 'sa-|spam|amavis|clam|rkhunter|chkrootkit|mlmmj' | sed 's/^/  /' || echo "  (no obvious sa/clam/scan cron)"
echo "== top 6 by CPU right now =="
ps -eo pcpu,rss,comm --sort=-pcpu 2>/dev/null | head -7 | awk 'NR>1{printf "  %5s%%  %8sKB  %s\n",$1,$2,$3}'
echo "== fail2ban jails =="
fail2ban-client status 2>/dev/null | grep -i 'jail list' | sed 's/^/  /' || echo "  (fail2ban-client n/a)"
echo "== inbound abuse: 'timeout after CONNECT' count in last 3000 mail.log lines =="
tail -3000 /var/log/mail.log 2>/dev/null | grep -c 'timeout after CONNECT'
echo "== postfix connection rate limits =="
postconf -h smtpd_client_connection_count_limit smtpd_client_connection_rate_limit anvil_rate_time_unit default_process_limit 2>/dev/null | paste -sd' '
R
echo "(read-only; no changes made)"
