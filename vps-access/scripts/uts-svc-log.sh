#!/usr/bin/env bash
# READ-ONLY. Why did the service restart? The unit's restart count and result,
# and the last lines of its journal around the restart. Changes nothing.
set -uo pipefail
echo "== units =="; systemctl list-units --no-pager --plain 'uts*' 2>/dev/null | head -8
for u in $(systemctl list-units --no-pager --plain 'uts*' 2>/dev/null | awk '/\.service/{print $1}'); do
  echo "== $u =="
  systemctl show -p MainPID,NRestarts,Result,ExecMainStartTimestamp,ActiveEnterTimestamp,MemoryCurrent,MemoryMax "$u" --no-pager 2>/dev/null
done
MAIN=$(systemctl list-units --no-pager --plain 'uts*' 2>/dev/null | awk '/\.service/ && !/control/{print $1; exit}')
echo "== journal for ${MAIN:-?} since 01:30 UTC =="
journalctl -u "${MAIN:-uts}" --since "2026-09-02 01:30:00 UTC" --no-pager -o short-iso 2>/dev/null | grep -v -i "GET /api\|POST /api\|healthz" | tail -60
echo "== kernel oom lines, if any =="
journalctl -k --since "2026-09-02 01:30:00 UTC" --no-pager 2>/dev/null | grep -i -E "oom|killed process" | tail -5
