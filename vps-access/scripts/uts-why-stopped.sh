#!/usr/bin/env bash
# uts-why-stopped.sh -- READ-ONLY. Why the Ultimate Trading System service last
# stopped, and what limits it is running under.
#
# Written 2026-08-22 after the owner's first wide sweep died at 316 of 123,624
# units with no message on screen. A run that vanishes with no reason given is
# indistinguishable from one that was never started, and the operator has no
# way to tell which. This script exists so that question has an answer that
# does not depend on anyone remembering what happened.
#
# Changes nothing. Reads the journal, the unit's resource limits, the kernel
# ring buffer for out-of-memory kills, and how much memory the box has.
set -uo pipefail
U=ultimate-trading-system

echo "== how the unit is limited =="
systemctl show "$U" -p MemoryMax -p MemoryHigh -p LimitNOFILE -p Restart -p RestartUSec \
  -p OOMPolicy -p TasksMax --no-pager | sed 's/^/  /'
echo "  MemoryMax in bytes above; 'infinity' means no limit"

echo
echo "== current state =="
systemctl show "$U" -p ActiveState -p SubState -p ActiveEnterTimestamp -p NRestarts \
  -p ExecMainStatus -p ExecMainCode -p MemoryCurrent -p MemoryPeak --no-pager | sed 's/^/  /'

echo
echo "== the box's own memory =="
free -m | sed 's/^/  /'
echo "  cpus: $(nproc)"

echo
echo "== kernel out-of-memory kills (whole boot) =="
if dmesg -T 2>/dev/null | grep -iE "out of memory|oom-kill|killed process" | tail -20 | sed 's/^/  /'; then :; fi
dmesg -T 2>/dev/null | grep -icE "out of memory|oom-kill|killed process" | sed 's/^/  total matching kernel lines: /'

echo
echo "== the service journal, last 2 hours, stops and starts only =="
journalctl -u "$U" --since "-2h" --no-pager 2>/dev/null \
  | grep -iE "started|stopped|stopping|killed|failed|oom|memory|scheduled restart|main process|signal|exit" \
  | tail -40 | sed 's/^/  /'

echo
echo "== everything the service said in the 3 minutes around its last start =="
START="$(systemctl show "$U" -p ActiveEnterTimestamp --value)"
echo "  last start: ${START:-unknown}"
if [ -n "${START:-}" ]; then
  journalctl -u "$U" --since "$(date -d "$START - 3 minutes" '+%Y-%m-%d %H:%M:%S' 2>/dev/null)" \
    --until "$(date -d "$START + 1 minute" '+%Y-%m-%d %H:%M:%S' 2>/dev/null)" \
    --no-pager 2>/dev/null | tail -60 | sed 's/^/  /'
fi

# THE IMPORTANT LINES GO LAST. Only the last ~8 KB reaches the session, and the
# first run of this script lost every limit it printed to a wall of stack trace.
echo
echo "=============================== THE FACTS ==============================="
free -m | sed 's/^/  /'
echo "  cpus: $(nproc)"
systemctl show "$U" -p MemoryMax -p MemoryHigh -p MemoryPeak -p NRestarts --no-pager | sed 's/^/  /'
echo -n "  node heap ceiling this service runs with: "
grep -o '\-\-max-old-space-size=[0-9]*' /etc/systemd/system/"$U".service 2>/dev/null \
  || grep -o 'NODE_OPTIONS=.*' /etc/systemd/system/"$U".service /etc/"$U"/env 2>/dev/null \
  || echo "(not set — node's own default, about 1 GB on 64-bit)"
echo -n "  last fatal reason: "
journalctl -u "$U" --since "-6h" --no-pager 2>/dev/null | grep -iE "FATAL ERROR|out of memory|oom-kill" | tail -1 | sed 's/.*node\[[0-9]*\]: //' || echo "(none in the last 6 hours)"
