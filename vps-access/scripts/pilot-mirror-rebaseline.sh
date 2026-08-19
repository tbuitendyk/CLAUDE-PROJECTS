#!/usr/bin/env bash
# pilot-mirror-rebaseline.sh -- ONE-OFF, DELETE AFTER USE (owner, 2026-08-19).
#
# The live rule's dormant band was written into a source file by hand as 1.69,
# a rounded transcription of the value the discovery run actually produced
# (1.6858050329831362). The owner replaced it with the real value: "that's what
# the band should have looked like from the very start."
#
# The band rides inside each decision's input_hash. So decisions recorded before
# the correction carry a hash computed from a number that was never the rule —
# and the mirror, which recomputes decisions against the running rule, correctly
# refuses to reproduce them. Nothing about the trading is affected: the sides,
# the votes and the entry prices are identical under either band. Only the
# recorded band, and the hash derived from it, are wrong.
#
# THIS SCRIPT FIXES DATA, NOT BEHAVIOUR. It leaves each decision reading exactly
# as it would have read had the correct band been in place from day one. It adds
# no field, keeps no repair marker, and removes the `rebaselined_from` marker an
# earlier version of this script left behind — production data carries the
# record, not the history of its repair. That history lives in git and in the
# change email.
#
# The band is READ FROM THE RUNNING RULE, never typed in here. Typing the number
# by hand is the exact mistake being corrected; doing it again to fix it would
# be absurd.
#
# WHAT IT DOES NOT DO: it does not clear the halt, arm anything, place an order,
# alter a position, or change any side, vote or price.
set -uo pipefail
APPDIR=/opt/general-classifier
MIRROR="$APPDIR/data/pilot/mirror.json"
DEC="$APPDIR/data/pilot/decisions"

[ -f "$MIRROR" ] || { echo "no mirror.json — run the mirror first"; exit 1; }

# The truth, straight out of the engine's own rule resolution.
BAND=$(cd "$APPDIR" && node -e 'process.stdout.write(String(require("./lib/pilotrule").resolveRule().cfg.branch.band))') || {
  echo "could not read the live rule's band — aborting rather than guessing"; exit 1; }
echo "live rule band = $BAND"

python3 - "$MIRROR" "$DEC" "$BAND" <<'PYEOF'
import json, os, sys, glob
mirror_path, dec_dir, band = sys.argv[1], sys.argv[2], float(sys.argv[3])
m = json.load(open(mirror_path))

# The mirror's recomputed hash, per chunk, for the ones it says do not reproduce.
fresh = {r.get("chunk_start"): (r.get("recomputed") or {}).get("input_hash")
         for r in (m.get("results") or []) if r.get("break") and r.get("hash_diff")}
print("mirror: checked " + str(m.get("checked")) + ", breaks " + str(m.get("breaks")))

changed = 0
for path in sorted(glob.glob(os.path.join(dec_dir, "*.json"))):
    d = json.load(open(path))
    cs = d.get("chunk_start")
    before_band, before_hash = d.get("band_pct"), d.get("input_hash")
    new_hash = fresh.get(cs)

    edits = []
    if before_band != band:
        d["band_pct"] = band
        edits.append("band_pct " + str(before_band) + " -> " + str(band))
    if new_hash and new_hash != before_hash:
        d["input_hash"] = new_hash
        edits.append("input_hash " + str(before_hash) + " -> " + str(new_hash))
    if "rebaselined_from" in d:
        del d["rebaselined_from"]
        edits.append("dropped the rebaselined_from repair marker")

    print("")
    print("  " + os.path.basename(path) + "   side " + str(d.get("side"))
          + "  votes " + str(d.get("per_member")) + "  price " + str(d.get("decision_price")))
    if not edits:
        print("    already correct — untouched")
        continue
    for e in edits:
        print("    " + e)
    # side, per_member and decision_price are never written here: the band change
    # does not move them, and this script has no business touching a trade record.
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(d, fh)
    os.replace(tmp, path)
    changed += 1
    print("    written")

print("")
print("corrected " + str(changed) + " decision file(s). Re-run the mirror to confirm.")
PYEOF
echo "(the halt is NOT cleared by this script)"
