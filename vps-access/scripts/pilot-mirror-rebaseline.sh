#!/usr/bin/env bash
# pilot-mirror-rebaseline.sh -- ONE-OFF (owner, 2026-08-19).
#
# WHY THIS EXISTS, AND WHY IT IS NOT A FEATURE. The owner changed the live rule's
# band from a hand-transcribed 1.69 to the value the discovery run actually
# produced (1.6858050329831362). The mirror recomputes recorded decisions and
# compares them to what the engine computes NOW, so decisions taken under the old
# band stopped reproducing, the mirror broke, and the box halted. Nothing was
# wrong with the trades — the sides are unchanged — but the machinery genuinely
# moved, and the mirror is right to notice.
#
# Rules will not be swapped under a running engine again, so the mirror is NOT
# being taught to handle rule changes (owner: "we're not going to be nor needing
# code that allows rule flips while running. DON'T CODE IT THAT WAY"). This is a
# one-time correction of records left inconsistent by a one-time change.
#
# WHAT IT DOES: for each decision the mirror reports as a break, it rewrites the
# recorded votes/hash/band to what the engine computes now, and keeps the
# original values in `rebaselined_from` so nothing is erased. It touches only
# decisions already flagged as breaks, never a matching one.
#
# WHAT IT DOES NOT DO: it does not clear the halt, arm anything, place an order,
# or alter a position. It edits the display/verification record only.
set -uo pipefail
APPDIR=/opt/general-classifier
MIRROR="$APPDIR/data/pilot/mirror.json"
DEC="$APPDIR/data/pilot/decisions"

[ -f "$MIRROR" ] || { echo "no mirror.json — run the mirror first"; exit 1; }

python3 - "$MIRROR" "$DEC" <<'PYEOF'
import json, os, sys, glob, datetime
mirror_path, dec_dir = sys.argv[1], sys.argv[2]
m = json.load(open(mirror_path))
results = m.get("results") or []
breaks = [r for r in results if r.get("break")]
print("mirror says: checked " + str(m.get("checked")) + ", breaks " + str(m.get("breaks")))
if not breaks:
    print("nothing to re-baseline — no breaks."); raise SystemExit

now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
for r in breaks:
    cs = r.get("chunk_start")
    rec = r.get("recorded") or {}
    new = r.get("recomputed") or {}
    if not new:
        print("  " + str(cs) + ": no recomputed values — SKIPPED"); continue
    # find the decision file for this chunk
    hits = [f for f in glob.glob(os.path.join(dec_dir, "*.json"))
            if json.load(open(f)).get("chunk_start") == cs]
    if len(hits) != 1:
        print("  " + str(cs) + ": expected 1 decision file, found " + str(len(hits)) + " — SKIPPED"); continue
    path = hits[0]
    d = json.load(open(path))
    print("")
    print("  " + os.path.basename(path))
    print("    side       " + str(d.get("side")) + "  ->  " + str(new.get("side")) + ("   (UNCHANGED)" if d.get("side") == new.get("side") else "   *** SIDE CHANGES ***"))
    print("    per_member " + str(d.get("per_member")) + "  ->  " + str(new.get("per_member")))
    print("    input_hash " + str(d.get("input_hash")) + "  ->  " + str(new.get("input_hash")))
    # keep the original, so the change is auditable rather than erased
    d["rebaselined_from"] = {
        "utc": now,
        "why": "one-off: the live rule's band moved from the transcribed 1.69 to the "
               "discovery run's own 1.6858050329831362, so decisions taken under the "
               "old band could not reproduce",
        "side": d.get("side"), "per_member": d.get("per_member"),
        "input_hash": d.get("input_hash"), "band_pct": d.get("band_pct"),
    }
    d["side"] = new.get("side", d.get("side"))
    d["per_member"] = new.get("per_member", d.get("per_member"))
    d["input_hash"] = new.get("input_hash", d.get("input_hash"))
    tmp = path + ".tmp"
    with open(tmp, "w") as fh: json.dump(d, fh)
    os.replace(tmp, path)
    print("    written (original kept in rebaselined_from)")
print("")
print("re-baselined " + str(len(breaks)) + " decision(s). Re-run the mirror to confirm.")
PYEOF
echo "(the halt is NOT cleared by this script)"
