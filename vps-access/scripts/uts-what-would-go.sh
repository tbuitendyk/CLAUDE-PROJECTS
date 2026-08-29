#!/usr/bin/env bash
# READ-ONLY: what a clean-out would actually reclaim, and what must survive it.
set -euo pipefail
cd /opt/ultimate-trading-system
echo "== campaigns declared =="
python3 -c "
import json
try:
    d=json.load(open('data/campaign.json'))
    print(' current:', d.get('name'))
    print(' declared:', d.get('declared'))
except Exception as e:
    print(' no campaign file:', e)
"
echo "== what each thing costs on disk =="
du -sh data/batches 2>/dev/null | sed 's/^/  record sets + runs (data\/batches): /'
du -sh data/stagesets 2>/dev/null | sed 's/^/  set documents + tables:            /'
du -sh data/models 2>/dev/null | sed 's/^/  saved models:                      /'
du -sh data/cache 2>/dev/null | sed 's/^/  PRICE HISTORY (must survive):      /'
echo "== per record set =="
for d in data/batches/*.rows; do
  [ -d "$d" ] || continue
  printf '  %-28s %s\n' "$(basename "$d")" "$(du -sh "$d" | cut -f1)"
done
echo "== free space =="
df -h /opt | tail -1 | awk '{print "  used "$3" of "$2", "$4" free"}'
