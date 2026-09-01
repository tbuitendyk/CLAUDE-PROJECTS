#!/usr/bin/env bash
# READ-ONLY. Is the kept-scramble fill actually working, or stuck? The progress
# line only moves when a NEW unit starts pricing, so it is not evidence either
# way. The store it is writing beside is. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
D=data/batches/s3-mte0oajo-1__keptfill.rows
echo "== the store it is writing BESIDE (this is the real progress) =="
ls -la --time-style=full-iso "$D" 2>/dev/null || echo "  (nothing written beside yet -- still pricing the first unit)"
echo "  size now:"; du -sb "$D" 2>/dev/null || true
echo
echo "== ten seconds later, has it grown? =="
B1=$(du -sb "$D" 2>/dev/null | cut -f1); B1=${B1:-0}
sleep 10
B2=$(du -sb "$D" 2>/dev/null | cut -f1); B2=${B2:-0}
echo "  $B1 -> $B2  ($(( B2 - B1 )) bytes in 10s)"
echo
echo "== the original store, for scale =="
du -sb data/batches/s3-mte0oajo-1.rows 2>/dev/null
echo
echo "== how much machine it is taking =="
top -bn1 | grep -E '^%Cpu|node' | head -4
echo
echo "== what the document says =="
sudo -u uts python3 -c "
import json
d=json.load(open('data/stagesets/s3-mte0oajo-1.json'))
print(' status  :', d.get('status'))
print(' progress:', d.get('progress'))
p=d.get('perf') or {}
for k in ('workers','unitsDone','unitsTotal','cyclesDone','cyclesTotal','elapsedMs'):
    if k in p: print(f'  {k:<11}:', p[k])
"
