#!/usr/bin/env bash
# host-natdaemon-health.sh -- READ-ONLY: is the VBoxNetNAT daemon (public-IP ->
# guest forwarder) wedged? Checks FD count vs limit (leak => accepts but can't
# forward), age, CPU/mem, and recent vbox messages in the host journal. No changes.
set -uo pipefail
PID=$(pgrep -x VBoxNetNAT | head -1)
echo "VBoxNetNAT pid: ${PID:-NOT RUNNING}"
[ -n "$PID" ] || exit 0
echo "started: $(ps -o lstart= -p "$PID")   elapsed: $(ps -o etime= -p "$PID" | tr -d ' ')"
nfd=$(ls "/proc/$PID/fd" 2>/dev/null | wc -l)
lim=$(awk '/Max open files/{print $4}' "/proc/$PID/limits" 2>/dev/null)
echo "open FDs: $nfd   soft limit: $lim"
awk -v n="$nfd" -v l="$lim" 'BEGIN{ if (l>0 && n>=l-8) print "  ==> AT/NEAR FD LIMIT -- daemon cannot open new guest-side sockets (accepts but cannot forward)"; else print "  ==> fd headroom OK ("n" of "l")" }'
echo "-- fd types (top 5) --"
ls -l "/proc/$PID/fd" 2>/dev/null | awk '{print $NF}' | sed 's/[0-9]//g' | sort | uniq -c | sort -rn | head -5 | sed 's/^/  /'
echo "-- proc state --"
ps -o pcpu=,pmem=,rss=,stat= -p "$PID" | awk '{printf "  cpu=%s%% mem=%s%% rss=%sKB stat=%s\n",$1,$2,$3,$4}'
echo "-- host journal, vbox/NAT messages since 16:30 today (last 10) --"
journalctl --since "16:30" --no-pager 2>/dev/null | grep -iE 'vbox|natnet' | tail -10 | sed 's/^/  /' || echo "  (none)"
echo "(read-only; no changes made)"
