#!/usr/bin/env bash
# uts-stop-my-probe.sh -- Stops the read-only timing probes THIS SESSION
# started, and nothing else, then reports what the box and the trading service
# are doing. Restarts no service, changes no data, changes no configuration.
#
# Why it kills by pattern rather than by one recorded pid: the first probe was
# started inline as `node -e '...'`. The connection to it timed out after ten
# minutes; the PROCESS did not, and went on holding a processor for another
# twelve while the owner's page returned 504s. A probe outliving the call that
# started it is the fault here, and one recorded pid would not have caught it.
#
# WHAT IT WILL NEVER KILL: the trading service. Every candidate is checked for
# `server.js` first and skipped if it is there.
set -uo pipefail
KILLED=0
for P in $(pgrep -f 'uts-replication-time-inner|lib/replication' 2>/dev/null); do
  ARGS=$(tr '\0' ' ' < "/proc/$P/cmdline" 2>/dev/null)
  case "$ARGS" in
    *server.js*)   echo "  leaving pid $P alone: it is the trading service"; continue;;
    *uts-replication-time-inner*|*'require("./lib/replication")'*|*"require('./lib/replication')"*) ;;
    *) echo "  leaving pid $P alone: not one of this session's probes"; continue;;
  esac
  kill "$P" 2>/dev/null && { echo "stopped a timing probe (pid $P)"; KILLED=$((KILLED+1)); }
done
sleep 2
for P in $(pgrep -f 'uts-replication-time-inner|lib/replication' 2>/dev/null); do
  ARGS=$(tr '\0' ' ' < "/proc/$P/cmdline" 2>/dev/null)
  case "$ARGS" in *server.js*) continue;; esac
  kill -9 "$P" 2>/dev/null && echo "  had to force pid $P"
done
[ "$KILLED" = 0 ] && echo "no timing probe was running"
echo
echo "== load now =="
uptime
ps -eo pid,pcpu,etime,args --sort=-pcpu 2>/dev/null | head -6 | cut -c1-120
echo
echo "== the trading service =="
systemctl is-active ultimate-trading-system 2>/dev/null
echo "  up since: $(systemctl show -p ActiveEnterTimestamp --value ultimate-trading-system 2>/dev/null)"
echo
echo "== does it answer, and how fast (it listens on 127.0.0.1:8094) =="
for PATHQ in /uts/construct.html /api/health /api/batches; do
  printf '  %-22s -> ' "$PATHQ"
  curl -s -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\n' --max-time 25 "http://127.0.0.1:8094$PATHQ" 2>&1 || echo "no answer in 25s"
done
echo
echo "== what the service has been asked for lately =="
journalctl -u ultimate-trading-system -n 15 --no-pager 2>/dev/null | cut -c1-150
