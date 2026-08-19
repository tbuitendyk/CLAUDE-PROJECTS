#!/usr/bin/env bash
# profile-set-freeze.sh -- ONE-OFF, DELETE AFTER USE (owner, 2026-08-19).
#
# The migration carried the profile's decisions but not the TRAINING CUTOFF they
# were computed at, so the reproduce-check recomputed every inherited decision
# against a different freeze, got different answers, and halted the profile at
# 07:08 with "decisions no longer reproduce". That is the brake doing precisely
# its job: the record and the engine genuinely disagreed.
#
# WHEN a rule's members train is a property of the DEPLOYMENT, not of the rule
# (lib/live/trainpolicy.js) — which is why it has to be carried across
# explicitly rather than riding along inside the config. It was not, and this
# supplies it: frozen at the cutoff the inherited decisions actually used,
# 1782863999000 = 2026-06-30T23:59:59Z, read off those records rather than typed.
#
# The halt is NOT cleared here. The mirror is re-run first, and it must come back
# clean on its own before anything is released — clearing a brake because you
# believe you fixed the cause, rather than because the check agrees, is the
# instrument marking its own homework.
set -uo pipefail
APPDIR=/opt/general-classifier
SETUP_ID="${SETUP_ID:-setup-mszpzts4-3577f3}"
cd "$APPDIR" || exit 1

echo "=============================================================="
echo " STEP 1 -- read the cutoff off the decisions themselves"
echo "=============================================================="
FREEZE=$(SETUP_ID="$SETUP_ID" node <<'JSEOF'
const fs = require('fs'), path = require('path');
const sid = process.env.SETUP_ID;
const f = path.join('/opt/general-classifier/data/live/decisions', sid + '.jsonl');
const seen = new Set();
for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  try { const d = JSON.parse(line); if (d.train_through) seen.add(d.train_through); } catch (_) {}
}
if (seen.size !== 1) {
  console.error(`  REFUSING: the inherited decisions do not agree on one cutoff: ${[...seen]}`);
  process.exit(1);
}
const v = [...seen][0];
process.stderr.write(`  every inherited decision used ${v} (${new Date(v).toISOString()})\n`);
process.stdout.write(String(v));
JSEOF
) || { echo "step 1 refused"; exit 1; }
[ -n "$FREEZE" ] || { echo "no cutoff read — stopping"; exit 1; }

echo "=============================================================="
echo " STEP 2 -- pin the profile to that cutoff"
echo "=============================================================="
SETUP_ID="$SETUP_ID" FREEZE="$FREEZE" node <<'JSEOF'
const reg = require('/opt/general-classifier/lib/live/setups');
const id = process.env.SETUP_ID;
const throughMs = Number(process.env.FREEZE);
const s = reg.updateSetup(id, { trainPolicy: { mode: 'frozen', throughMs } }, 'owner');
console.log(`  ${id} trainPolicy = ${JSON.stringify(s.trainPolicy)}`);
JSEOF
[ $? -eq 0 ] || { echo "step 2 failed"; exit 1; }

echo "=============================================================="
echo " STEP 3 -- re-run the reproduce-check and let IT decide"
echo "=============================================================="
node live-mirror.js || true
python3 - "$APPDIR/data/live/mirror.json" "$SETUP_ID" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print(f"  no mirror produced ({e})"); sys.exit(1)
r = next((x for x in (d.get("results") or []) if x.get("setup_id") == sys.argv[2]), None)
if not r:
    print("  the profile is not in the mirror results"); sys.exit(1)
print(f"  checked {r.get('checked')}  breaks {r.get('breaks')}  pending {r.get('pending')}")
for b in (r.get("results") or [])[:6]:
    if b.get("break"):
        print(f"    STILL BREAKING {b.get('chunk_start')}: {b.get('reason')}")
if r.get("breaks"):
    print("  the halt STANDS — the decisions still do not reproduce."); sys.exit(1)
print("  clean. The halt can now be cleared from the screen.")
PY
