#!/usr/bin/env bash
# READ-ONLY. Why did the service restart? The unit's restart count and result,
# and its journal around the restart, with the request lines filtered out.
# Changes nothing.
set -uo pipefail
U=ultimate-trading-system.service
echo "== $U =="
systemctl show -p MainPID,NRestarts,Result,ExecMainStartTimestamp,ExecMainExitTimestampMonotonic,ActiveEnterTimestamp,MemoryCurrent,MemoryMax,CPUQuotaPerSecUSec "$U" --no-pager 2>/dev/null
echo "== journal since 01:30 UTC (requests filtered) =="
journalctl -u "$U" --since "2026-09-02 01:30:00 UTC" --no-pager -o short-iso 2>/dev/null | grep -v -E "GET /|POST /|healthz" | tail -70 | cut -c1-260
echo "== kernel oom lines, if any =="
journalctl -k --since "2026-09-02 01:30:00 UTC" --no-pager 2>/dev/null | grep -i -E "oom|killed process|out of memory" | tail -5
