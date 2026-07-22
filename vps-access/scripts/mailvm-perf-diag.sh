#!/usr/bin/env bash
# mailvm-perf-diag.sh -- READ-ONLY performance diagnosis of the mail VM
# (HOMSMAIL03 / iRedMail at 192.168.56.129). Makes NO changes to host or guest.
#
# Answers: why does `ssh homsmail03` take ~1 min for a prompt, and is the
# guest resource-starved? Times the host->guest SSH (non-interactive vs a
# PTY login that runs the motd/login shell), then gathers load/RAM/swap,
# swap activity, top processes, disk, mail queue depth, iRedMail service
# health, the sshd login-path settings (UseDNS/GSSAPI -- the classic slow-
# prompt culprits), reverse-DNS timing, OOM kills, and recent mail.log /
# journal errors. Output kept well under the 8KB run-script cap.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
VM=192.168.56.129
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=12 root@$VM"

echo "===== SSH connect timing (host -> mail VM) ====="
for i in 1 2 3; do
  s=$EPOCHREALTIME; $SSH true 2>/dev/null; e=$EPOCHREALTIME
  awk -v s="$s" -v e="$e" -v i="$i" 'BEGIN{printf "  non-interactive #%d: %.2f s\n", i, e-s}'
done
s=$EPOCHREALTIME; $SSH -tt 'exit' >/dev/null 2>&1; e=$EPOCHREALTIME
awk -v s="$s" -v e="$e" 'BEGIN{printf "  PTY login (runs motd/login shell): %.2f s\n", e-s}'
echo "  (non-interactive slow => auth/DNS path; only-PTY slow => motd/PAM login path)"
echo

echo "===== in-guest health (single session) ====="
$SSH 'bash -s' <<'REMOTE' 2>&1
echo "-- uptime/load --"; uptime
echo "-- cpu count --"; nproc
echo "-- mem/swap --"; free -h
echo "-- swap activity (si/so near 0 = not thrashing) --"; vmstat 1 2 2>/dev/null | tail -1
echo "-- top 6 by RSS --"; ps -eo rss,pid,comm --sort=-rss 2>/dev/null | head -7 | awk '{printf "   %8s KB  %6s  %s\n",$1,$2,$3}'
echo "-- top 4 by CPU --"; ps -eo pcpu,pid,comm --sort=-pcpu 2>/dev/null | head -5 | awk '{printf "   %5s%%  %6s  %s\n",$1,$2,$3}'
echo "-- disk --"; df -h / /var /var/vmail 2>/dev/null | awk 'NR==1||/\/dev/'
echo "-- mail queue depth --"; postqueue -p 2>/dev/null | tail -1 || mailq 2>/dev/null | tail -1
echo "-- iRedMail service health --"
for s in postfix amavis clamav-daemon clamav-freshclam dovecot postgresql iredapd nginx php7.4-fpm php8.1-fpm sshd fail2ban; do
  st=$(systemctl is-active "$s" 2>/dev/null); [ "$st" = unknown ] && continue
  printf "   %-18s %s\n" "$s" "$st"
done
echo "-- failed units --"; systemctl --failed --no-legend --no-pager 2>/dev/null | head -6 || true
echo "-- sshd slow-prompt settings --"
grep -iE '^\s*(UseDNS|GSSAPIAuthentication)' /etc/ssh/sshd_config 2>/dev/null || echo "   (both at defaults -- UseDNS off, GSSAPIAuthentication may be yes)"
echo "-- reverse-DNS lookup timing from guest --"
s=$EPOCHREALTIME; getent hosts 192.168.56.1 >/dev/null 2>&1; e=$EPOCHREALTIME
awk -v s="$s" -v e="$e" 'BEGIN{printf "   rDNS 192.168.56.1: %.2f s\n", e-s}'
echo "-- OOM kills (this boot) --"; dmesg 2>/dev/null | grep -iE 'killed process|out of memory' | tail -3 || echo "   (none / dmesg not readable)"
echo "-- journal errors (this boot, last 6) --"; journalctl -p err -b --no-pager 2>/dev/null | tail -6 || echo "   (journal not readable)"
echo "-- mail.log recent problems (last 6) --"; grep -iE 'fatal|error|timeout|refused|connection lost|resource' /var/log/mail.log 2>/dev/null | tail -6 || echo "   (none)"
REMOTE
echo
echo "===== done (read-only; no changes made) ====="
