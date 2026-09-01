#!/usr/bin/env bash
# READ-ONLY. When each part of a unit lands, and what the machine is doing
# between them. The gaps ARE the lane imbalance, measured rather than guessed.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
LAST=""
END=$(( $(date +%s) + 470 ))
while [ "$(date +%s)" -lt "$END" ]; do
  read -r NOW LINE <<< "$(sudo -u uts python3 -c "
import json
d=json.load(open('data/stagesets/s3-mte0oajo-1.json'))
p=d.get('perf') or {}
print(p.get('elapsedMs') or 0, (d.get('progress') or '').replace(chr(10),' '))
" 2>/dev/null)"
  if [ "$LINE" != "$LAST" ]; then
    CPU=$(top -bn1 | awk '/ node/ && $1+0>900000 {print $9; exit}')
    printf '%7.1f min  cpu %6s%%  %s\n' "$(echo "$NOW/60000" | bc -l)" "${CPU:-?}" "$LINE"
    LAST="$LINE"
  fi
  sleep 4
done
echo "-- watch window closed --"
