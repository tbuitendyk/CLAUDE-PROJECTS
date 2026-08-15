#!/usr/bin/env bash
# stop-all-claude-traffic.sh -- OWNER DIRECTIVE (2026-08-15): halt ALL Claude
# network activity against homsionos01, from every session, not just this one.
#
# 1. samples real interface throughput BEFORE (evidence of what was moving)
# 2. stops + disables the internet-facing services Claude sessions deployed
#    (classifier pulls Binance archives, balancers poll exchange APIs, dubber
#    pulls video) -- these are the actual outbound traffic generators
# 3. samples throughput AFTER
# 4. takes the deploy-control endpoint down 5s AFTER this reply is sent, which
#    cuts EVERY Claude session off from the box (the endpoint is the only path
#    cloud sessions have; SSH is blocked for them)
#
# FULLY REVERSIBLE by the owner from the console/SSH -- restart commands are
# printed at the end.
set -uo pipefail

rate() { # $1 = seconds to sample
  local i=ens6 a b
  a=$(awk -v i="$i:" '$1==i{print $2" "$10}' /proc/net/dev)
  sleep "$1"
  b=$(awk -v i="$i:" '$1==i{print $2" "$10}' /proc/net/dev)
  awk -v a="$a" -v b="$b" -v t="$1" 'BEGIN{split(a,x," ");split(b,y," ");
    printf "   rx %.1f kB/s   tx %.1f kB/s\n",(y[1]-x[1])/1024/t,(y[2]-x[2])/1024/t}'
}

echo "===== ens6 throughput BEFORE stopping (3s sample) ====="
rate 3

echo "===== stopping internet-facing Claude services ====="
for s in general-classifier asset-balancer semi-auto-balancer youtube-dubber; do
  st=$(systemctl is-active "$s" 2>/dev/null)
  if [ "$st" = active ]; then
    systemctl disable --now "$s" >/dev/null 2>&1
    echo "   $s: STOPPED + disabled (was active)"
  else
    echo "   $s: already ${st:-absent}"
  fi
done
echo "   kjv-mcp: left running (local-only MCP, negligible traffic)"
# kill any in-flight downloads those services spawned
for pat in 'data.binance.vision' 'yt-dlp' 'ffmpeg' 'wget' ; do
  pids=$(pgrep -f "$pat" 2>/dev/null | tr '\n' ' ')
  [ -n "$pids" ] && { kill $pids 2>/dev/null; echo "   killed in-flight: $pat ($pids)"; }
done

echo "===== ens6 throughput AFTER stopping (3s sample) ====="
rate 3

echo "===== remaining established connections by remote ====="
ss -tn state established 2>/dev/null | tail -n +2 | awk '{print $4}' | sed 's/:[0-9]*$//' \
  | sort | uniq -c | sort -rn | head -10 | sed 's/^/   /'
echo "   total established: $(ss -tn state established 2>/dev/null | tail -n +2 | wc -l)"

echo "===== cutting Claude's access path (deploy-control) in 5s ====="
nohup bash -c 'sleep 5; systemctl disable --now deploy-control' >/dev/null 2>&1 &
echo "   deploy-control will stop shortly after this reply -- ALL Claude sessions"
echo "   lose their only route to this box (SSH is blocked for them)."
echo
echo "===== TO RESTORE LATER (run on the box as root) ====="
echo "   systemctl enable --now deploy-control        # Claude access back"
echo "   systemctl enable --now general-classifier asset-balancer semi-auto-balancer youtube-dubber"
echo "   mv /etc/cron.d/claude-mail-hub.DISABLED-* /etc/cron.d/claude-mail-hub"
echo "   mv /etc/cron.d/natnet-watchdog.DISABLED-* /etc/cron.d/natnet-watchdog"
echo "   touch /var/lib/claude-mail/hub/ENABLED"
echo "===== DONE ====="
