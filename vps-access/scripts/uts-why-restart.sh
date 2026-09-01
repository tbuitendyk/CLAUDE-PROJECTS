#!/usr/bin/env bash
# READ-ONLY. Did the service die, and why? Changes nothing.
set -uo pipefail
echo "== uptime and restarts =="
systemctl show ultimate-trading-system -p ActiveEnterTimestamp -p NRestarts -p MemoryCurrent -p MemoryMax 2>/dev/null
echo
echo "== the last 30 lines of its journal =="
journalctl -u ultimate-trading-system -n 30 --no-pager 2>/dev/null | tail -30
echo
echo "== any kernel out-of-memory kills =="
dmesg -T 2>/dev/null | grep -i 'out of memory\|oom-kill\|Killed process' | tail -5 || echo "  (none visible)"
echo
echo "== the set document now =="
cd /opt/ultimate-trading-system && sudo -u uts python3 -c "
import json
d=json.load(open('data/stagesets/s3-mte0oajo-1.json'))
print(' status  :', d.get('status'))
print(' progress:', (d.get('progress') or '')[:180])
print(' keepN   :', (d.get('params') or {}).get('keepN'))
"
