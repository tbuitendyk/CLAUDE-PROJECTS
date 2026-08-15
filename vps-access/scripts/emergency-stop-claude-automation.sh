#!/usr/bin/env bash
# emergency-stop-claude-automation.sh -- OWNER EMERGENCY STOP (2026-08-13).
# Halts every RECURRING automation this (vps-access) session installed on the
# host, then reports what is still consuming the box so the owner can decide
# about anything else. Reversible: hub-setup.sh and setup-natnet-watchdog.sh
# reinstall their pieces.
#
# Stops: mail-hub cron cycle (was every minute), NAT watchdog (every 15 min).
# Does NOT touch: other projects' deployed services (balancer, classifier,
# dubber, kjv-mcp) -- those are reported, not stopped, because stopping
# production services needs explicit sign-off.
set -uo pipefail

echo "===== STOPPING vps-access AUTOMATION ====="
# 1. mail hub: flag first (cycle exits instantly without it), then cron entry
if [ -f /var/lib/claude-mail/hub/ENABLED ]; then
  rm -f /var/lib/claude-mail/hub/ENABLED && echo "  hub: ENABLED flag removed (cycle now exits immediately)"
else
  echo "  hub: flag already absent"
fi
for f in /etc/cron.d/claude-mail-hub /etc/cron.d/natnet-watchdog; do
  if [ -f "$f" ]; then mv "$f" "$f.DISABLED-$(date +%Y%m%d-%H%M%S)" && echo "  cron: $(basename "$f") disabled"; fi
done
# 2. kill anything of ours in flight
for pat in claude-mail-hub-cycle natnet-watchdog hub-fetch.sh claude-mail-check.sh mailvm- ; do
  pids=$(pgrep -f "$pat" 2>/dev/null | tr '\n' ' ')
  [ -n "$pids" ] && { kill $pids 2>/dev/null; echo "  killed in-flight: $pat ($pids)"; }
done
systemctl reload cron 2>/dev/null || systemctl restart cron 2>/dev/null || true
echo "  cron reloaded"

echo
echo "===== VERIFY: no vps-access automation left ====="
echo "  cron.d claude/nat entries: $(ls /etc/cron.d/ 2>/dev/null | grep -icE 'claude|natnet' ) active (want 0)"
echo "  hub enabled: $([ -f /var/lib/claude-mail/hub/ENABLED ] && echo YES || echo NO)"
echo "  our procs: $(pgrep -fc 'claude-mail|natnet-watchdog|hub-' 2>/dev/null || echo 0)"

echo
echo "===== BOX STATE (for your decision on everything else) ====="
echo "-- load / mem --"; uptime; free -h | head -2
echo "-- top 8 CPU --"
ps -eo pcpu,rss,user,comm --sort=-pcpu 2>/dev/null | head -9 | awk 'NR>1{printf "   %5s%% %8sKB %-10s %s\n",$1,$2,$3,$4}'
echo "-- established TCP connections: $(ss -tn state established 2>/dev/null | tail -n +2 | wc -l) --"
echo "-- connection count by process (top 8) --"
ss -tnp state established 2>/dev/null | grep -oE 'users:\(\("[^"]+"' | sed 's/.*(("//' | sort | uniq -c | sort -rn | head -8 | sed 's/^/   /'
echo "-- remote endpoints with most connections (top 8) --"
ss -tn state established 2>/dev/null | tail -n +2 | awk '{print $4}' | sed 's/:[0-9]*$//' | sort | uniq -c | sort -rn | head -8 | sed 's/^/   /'
echo "-- all cron.d entries still present --"
ls /etc/cron.d/ 2>/dev/null | sed 's/^/   /'
echo "-- claude-related systemd services --"
systemctl list-units --type=service --state=running --no-legend --no-pager 2>/dev/null \
  | grep -iE 'balancer|classifier|dubber|kjv|deploy-control|mailvm' | awk '{print "   "$1}'
echo "===== DONE (vps-access automation stopped) ====="
