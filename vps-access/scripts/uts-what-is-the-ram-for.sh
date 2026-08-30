#!/usr/bin/env bash
# uts-what-is-the-ram-for.sh -- READ-ONLY. What is actually using this box's
# memory, what is reclaimable, and what could be given to the trading service
# without inviting the kernel to kill something else. Reads; changes nothing.
set -uo pipefail
echo "== the whole box =="
free -m | sed 's/^/  /'
echo
echo "== the twelve biggest processes by resident memory =="
ps -eo rss,vsz,pcpu,etime,user,args --sort=-rss 2>/dev/null | head -13 \
  | awk 'NR==1{printf "  %8s %8s %5s %-12s %-10s %s\n","RSS_MB","VSZ_MB","CPU","ELAPSED","USER","COMMAND"; next}
         {printf "  %8.0f %8.0f %5s %-12s %-10s %s\n", $1/1024, $2/1024, $3, $4, $5, substr($0, index($0,$6), 70)}'
echo
echo "== memory by service (systemd) =="
systemctl list-units --type=service --state=running --no-legend --no-pager 2>/dev/null | awk '{print $1}' | while read -r u; do
  m=$(systemctl show "$u" -p MemoryCurrent --value 2>/dev/null)
  [ -n "$m" ] && [ "$m" != "[not set]" ] && [ "$m" -gt 52428800 ] 2>/dev/null \
    && printf "  %-42s %6.0f MB   high %-8s max %-8s\n" "$u" "$((m/1048576))" \
       "$(systemctl show "$u" -p MemoryHigh --value)" "$(systemctl show "$u" -p MemoryMax --value)"
done
echo
echo "== the trading service's own unit, as installed =="
grep -E "max-old-space-size|MemoryHigh|MemoryMax|CPUQuota|CPUWeight" /etc/systemd/system/ultimate-trading-system.service 2>/dev/null | sed 's/^/  /'
echo "  drop-ins:"; ls -la /etc/systemd/system/ultimate-trading-system.service.d/ 2>/dev/null | sed 's/^/    /'
for f in /etc/systemd/system/ultimate-trading-system.service.d/*.conf; do
  [ -f "$f" ] && { echo "    -- $f"; sed 's/^/      /' "$f"; }
done
echo
echo "== what the kernel thinks is reclaimable =="
grep -E "^(MemTotal|MemFree|MemAvailable|Cached|SwapTotal|SwapFree|Committed_AS|CommitLimit|Dirty)" /proc/meminfo | sed 's/^/  /'
echo
echo "== any out-of-memory kills, ever =="
dmesg -T 2>/dev/null | grep -i "out of memory\|oom-kill\|Killed process" | tail -8 || echo "  (dmesg not readable from here)"
journalctl --since '3 days ago' --no-pager 2>/dev/null | grep -i "oom-kill\|Out of memory" | tail -8 || true
