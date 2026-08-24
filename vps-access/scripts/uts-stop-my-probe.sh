#!/usr/bin/env bash
# uts-stop-my-probe.sh -- Stops the read-only timing probe THIS SESSION started
# (uts-replication-time-inner.js) and nothing else, then reports what the box
# and the trading service are doing. It touches no data, restarts no service and
# changes no configuration.
#
# Why: the probe walks fifty million rows to measure what the Replication table
# costs to draw. It is read-only, but it is not free -- it holds a processor,
# and the owner is seeing the page time out.
set -uo pipefail
P=$(pgrep -f 'uts-replication-time-inner' | head -1)
if [ -n "${P:-}" ]; then
  kill "$P" 2>/dev/null && echo "stopped the timing probe (pid $P)"
  sleep 2
  pgrep -f 'uts-replication-time-inner' >/dev/null 2>&1 && { kill -9 "$P" 2>/dev/null; echo "  (had to force it)"; }
else
  echo "the timing probe is not running"
fi
echo
echo "== load =="
uptime
echo
echo "== the busiest things on the box =="
ps -eo pid,pcpu,pmem,etime,args --sort=-pcpu 2>/dev/null | head -8 | cut -c1-150
echo
echo "== the trading service =="
systemctl is-active ultimate-trading-system 2>/dev/null || systemctl list-units --type=service 2>/dev/null | grep -i -E 'trading|uts' | head -5
systemctl status ultimate-trading-system --no-pager -n 0 2>/dev/null | head -8
echo
echo "== does it answer, and how fast =="
for U in http://127.0.0.1:8090/ http://127.0.0.1:3000/ ; do
  printf '  %s -> ' "$U"
  curl -s -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\n' --max-time 12 "$U" 2>&1 || echo "no answer"
done
echo
echo "== which port it is actually on =="
ss -lntp 2>/dev/null | grep -i node | head -5
echo
echo "== last lines the service logged =="
journalctl -u ultimate-trading-system -n 12 --no-pager 2>/dev/null | cut -c1-160
