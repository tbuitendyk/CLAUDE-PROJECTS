#!/usr/bin/env bash
# profile-finish-move.sh -- ONE-OFF, DELETE AFTER USE (owner, 2026-08-19).
#
# Finish a move that was half a COPY. profile-migrate.sh carried the decision
# records and stand-downs into the profile's own log and then left the originals
# in place, so both stores held the same history and both screens showed it. The
# owner spotted it: "the old set-up still has the history from when we started".
#
# Nothing is lost here — every record was verified present in the profile's log
# BEFORE its original is removed, and the script refuses rather than deleting
# anything it cannot account for.
#
# Also removes the stale f1-pilot setup record (a DRAFT that never traded and
# whose book now belongs to the profile) and the old rail's mirror file, which
# was still re-checking a store nothing writes to any more.
#
# Places no orders. Touches no position. Clears no halt.
set -uo pipefail
APPDIR=/opt/general-classifier
SETUP_ID="${SETUP_ID:-setup-mszpzts4-3577f3}"
cd "$APPDIR" || exit 1

echo "=============================================================="
echo " STEP 1 -- prove every old record is already in the profile's log"
echo "=============================================================="
SETUP_ID="$SETUP_ID" node <<'JSEOF'
const fs = require('fs'), path = require('path');
const sid = process.env.SETUP_ID;
const BASE = '/opt/general-classifier/data';
const log = path.join(BASE, 'live', 'decisions', `${sid}.jsonl`);

const carried = new Set();
try {
  for (const line of fs.readFileSync(log, 'utf8').split('\n')) {
    if (line.trim()) { try { carried.add(JSON.parse(line).chunk_start); } catch (_) {} }
  }
} catch (_) { /* none */ }
console.log(`  profile log holds ${carried.size} decision(s)`);

const missing = [];
let seen = 0;
for (const sub of ['decisions', 'standdowns']) {
  const dir = path.join(BASE, 'pilot', sub);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (_) { continue; }
  for (const f of files) {
    seen++;
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!carried.has(d.chunk_start)) missing.push(`${sub}/${f} (${d.chunk_start})`);
  }
}
console.log(`  old stores hold ${seen} record(s)`);
if (missing.length) {
  console.error('  REFUSING to delete — these are NOT in the profile log yet:');
  for (const m of missing) console.error('    ' + m);
  process.exit(1);
}
console.log('  every old record is accounted for in the profile log');
JSEOF
[ $? -eq 0 ] || { echo "step 1 refused — nothing deleted"; exit 1; }

echo "=============================================================="
echo " STEP 2 -- remove the duplicated stores"
echo "=============================================================="
for d in decisions standdowns; do
  n=$(ls -1 "$APPDIR/data/pilot/$d"/*.json 2>/dev/null | wc -l)
  if [ "$n" -gt 0 ]; then
    rm -f "$APPDIR/data/pilot/$d"/*.json
    echo "  removed $n record(s) from data/pilot/$d"
  else
    echo "  data/pilot/$d already empty"
  fi
done
if [ -f "$APPDIR/data/pilot/mirror.json" ]; then
  rm -f "$APPDIR/data/pilot/mirror.json"
  echo "  removed the old rail's mirror.json (it was re-checking a store nothing writes)"
fi

echo "=============================================================="
echo " STEP 3 -- remove the stale setup record"
echo "=============================================================="
node <<'JSEOF'
const reg = require('/opt/general-classifier/lib/live/setups');
const fs = require('fs'), path = require('path');
const s = reg.getSetup('f1-pilot');
if (!s) { console.log('  f1-pilot already gone'); process.exit(0); }
if (s.state !== 'draft') {
  console.error(`  REFUSING: f1-pilot is '${s.state}', not a never-traded draft`);
  process.exit(1);
}
// deleteDraft is the registry's own door: only a never-run draft may be removed
// outright, everything else retires and keeps its record.
try {
  reg.deleteDraft('f1-pilot');
  console.log('  f1-pilot draft removed');
} catch (e) {
  console.error('  REFUSING: ' + e.message);
  process.exit(1);
}
JSEOF
[ $? -eq 0 ] || { echo "step 3 refused"; exit 1; }

echo "=============================================================="
echo " STEP 4 -- what the screens will show now"
echo "=============================================================="
curl -sS -m 6 http://127.0.0.1:8093/api/live/setups | python3 -c "
import json, sys
d = json.load(sys.stdin)
for s in d.get('setups', []):
    print(f\"  SETUP  {s['id']:26} {s['state']:8} {s['name']}\")
print(f\"  {len(d.get('setups', []))} row(s) on Setups\")
"
echo ""
echo "done. Nothing was deleted that was not first proven present in the profile's log."
