#!/usr/bin/env bash
# live-mirror-read.sh -- READ-ONLY: the reproduce-check's current verdict for
# every trading profile, and the decision records it is comparing. Writes
# nothing, clears nothing, halts nothing.
#
# "Reproduce-check" in plain words: take a decision this profile already acted
# on, recompute it now from the same inputs, and see whether the same call comes
# back. A BREAK means the record and the engine disagree, so the next call
# cannot be trusted either — the tick halts that profile's NEW entries (its open
# positions keep their scheduled exits) until the owner clears it.
#
# Replaces the reader for the retired single-config rail, which pointed at
# data/pilot/mirror.json — a file nothing writes any more, so it printed "(none)"
# and looked like a clean bill of health.
set -uo pipefail
APPDIR=/opt/general-classifier

echo "== reproduce-check verdict (data/live/mirror.json) =="
python3 - "$APPDIR/data/live/mirror.json" <<'PYEOF'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print("  (no verdict file yet: %s)" % e); raise SystemExit
print("  as of %s | profiles %s | breaks %s | errors %s"
      % (d.get("utc"), d.get("setups"), d.get("breaks"), d.get("errors")))
for r in (d.get("results") or []):
    print("")
    print("  profile %s" % r.get("setup_id"))
    for k in ("ok", "checked", "breaks", "pending", "foreign", "error"):
        if k in r and r.get(k) not in (None, ""):
            print("    %s = %s" % (k, r.get(k)))
    if r.get("foreignVersions"):
        # records written by an engine version this profile did not produce —
        # counted apart on purpose, because "a different engine wrote it" is not
        # the same finding as "this engine no longer agrees with itself".
        print("    foreign engine versions = %s" % ", ".join(r["foreignVersions"]))
    for b in (r.get("breakDetail") or [])[:5]:
        print("    BREAK %s" % json.dumps(b)[:300])
PYEOF

echo
echo "== decision records, per profile =="
# One append-only JSONL per profile: data/live/decisions/<profile-id>.jsonl.
# The check keeps the LAST record per feature window, so a re-ship inside a
# period is one entry, not two.
python3 - "$APPDIR/data/live/setups" "$APPDIR/data/live/decisions" <<'PYEOF'
import json, os, sys
root, ddir = sys.argv[1], sys.argv[2]
try:
    setups = sorted(f for f in os.listdir(root) if f.endswith(".json"))
except Exception as e:
    print("  cannot list %s: %s" % (root, e)); raise SystemExit
if not setups:
    print("  (no profiles)")
for f in setups:
    try:
        s = json.load(open(os.path.join(root, f)))
    except Exception as e:
        print("  %s: unreadable %s" % (f, e)); continue
    sid = s.get("id") or f[:-5]
    print("")
    print("  %s  %r  state=%s  pair=%s" % (sid, s.get("name"), s.get("state"), s.get("tradedPair")))
    jf = os.path.join(ddir, sid + ".jsonl")
    try:
        lines = [l for l in open(jf).read().split("\n") if l.strip()]
    except Exception:
        print("    (no decision records at %s)" % jf); continue
    by = {}
    bad = 0
    for l in lines:
        try:
            r = json.loads(l); by[r.get("chunk_start")] = r
        except Exception:
            bad += 1
    print("    %d record(s)%s" % (len(by), (" (+%d torn line(s))" % bad) if bad else ""))
    for k in sorted(by, key=lambda x: str(x)):
        r = by[k]
        bits = []
        for kk in ("chunk_start", "side", "quorum", "band_pct", "decision_price",
                   "input_hash", "config_version", "train_through"):
            if kk in r: bits.append("%s=%s" % (kk, r[kk]))
        print("    " + " | ".join(bits))
        if "per_member" in r: print("      per_member = %s" % (r["per_member"],))
PYEOF
echo "(read-only)"
