#!/usr/bin/env bash
# uts-store-size.sh -- READ-ONLY. How big each record set's store is, and how
# many rows carry the retired rule name. Reads; changes nothing.
set -uo pipefail
D=/opt/ultimate-trading-system/data
echo "== record stores on disk =="
du -sh "$D"/rowstore/* 2>/dev/null | sort -h | tail -10 || echo "  (no rowstore)"
echo
echo "== free space =="
df -h "$D" | tail -1
echo
echo "== set documents and their stage 3 params =="
for f in "$D"/stagesets/s3-*.json; do
  [ -e "$f" ] || continue
  python3 -c "
import json,sys
d=json.load(open('$f'))
p=d.get('params') or {}
pl=d.get('plan') or {}
labs=pl.get('settingLabels') or []
old=[l for l in labs if l.startswith('unusual ')]
print(f\"  {d.get('id')}  settings {pl.get('settings')}  units {pl.get('units')}\")
print(f\"    params agreeRule={p.get('agreeRule')!r} agreeBar={p.get('agreeBar')!r} permuteRule={p.get('agreePermuteRule')}\")
print(f\"    settingLabels: {len(labs)} stored, {len(old)} start with the retired name\")
"
done
