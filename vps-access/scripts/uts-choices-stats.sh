#!/usr/bin/env bash
# uts-choices-stats.sh -- READ-ONLY. The recovered-choices sidecar's own
# counts: how many unit spans were named, how many could not be, how many
# census records were passed over, how many claims were stripped as
# misalignments. Changes nothing.
set -uo pipefail
WD=$(systemctl show -p WorkingDirectory --value ultimate-trading-system 2>/dev/null || echo /opt/ultimate-trading-system)
for f in "$WD"/data/batches/*.rows/replication.units.json; do
  [ -f "$f" ] || continue
  python3 - "$f" <<'PY'
import json, sys
f = sys.argv[1]
d = json.load(open(f))
print(f.split('/data/batches/')[-1])
print("  built:", d.get('builtAt'), " rows:", format(d.get('rowsSeen', 0), ','))
print("  spans named: %s   unnamed: %s   census records skipped: %s   claims stripped: %s"
      % (format(d.get('named', 0), ','), format(d.get('unnamed', 0), ','),
         format(d.get('censusSkipped', 0), ','), format(d.get('cleared', 0), ',')))
PY
done
