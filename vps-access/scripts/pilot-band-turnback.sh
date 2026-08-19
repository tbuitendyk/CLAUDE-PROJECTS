#!/usr/bin/env bash
# pilot-band-turnback.sh -- ONE-OFF, DELETE AFTER USE (owner, 2026-08-19).
#
# Turn the clock back in the data. The live rule's dormant band was hardcoded as
# a truncated 1.69 when the discovery run's value was 1.6858050329831362. Every
# stored decision therefore records a committee that was run on a number which
# was never the rule. The owner's instruction: recompute every day as if the
# band had been correct from the start, and record that everywhere -- decision
# records, stand-down records, the box journal, the consumed intent files, and
# the mirror.
#
# THE NUMBERS ARE COMPUTED BY THE ENGINE, NEVER TYPED. Every value written here
# comes from lib/pilotsignal.js computeSignalForChunk() resolved against the
# live rule. Hand-transcribing the band is the original fault; hand-transcribing
# its consequences would repeat it.
#
# SAFETY: a recomputed SIDE that differs from the stored side would mean a
# different trade -- a stand-down that becomes a trade, or a trade that becomes
# a stand-down. This script refuses to rewrite those and reports them instead.
# It never invents a fill, never places an order, never touches a position, and
# never clears a halt.
#
# The box journal is append-only and is the record of what the executor did, so
# a copy is kept at ~/pilot/journal.jsonl.preband before it is rewritten. Delete
# that once the screens have been checked.
set -uo pipefail
APPDIR=/opt/general-classifier
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
MAP=/tmp/pilot-band-counterfactual.json
[ -f "$KEY" ] || { echo "no key at $KEY"; exit 1; }

echo "=============================================================="
echo " STEP 1 -- recompute every decision and stand-down at the live rule"
echo "=============================================================="
cd "$APPDIR" || exit 1
MAPPATH="$MAP" node --unhandled-rejections=strict <<'JSEOF'
const fs = require('fs'), path = require('path');
const sig = require('/opt/general-classifier/lib/pilotsignal.js');
const mapPath = process.env.MAPPATH;
const BASE = '/opt/general-classifier/data/pilot';
const DIRS = [['decision', path.join(BASE, 'decisions')],
              ['stand-down', path.join(BASE, 'standdowns')]];

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const map = {}; const refused = []; let rewritten = 0, unchanged = 0;
  const rule = sig.resolveRule();
  const band = Math.abs(rule.cfg.branch.band);
  console.log('live rule band (read from the engine): ' + band);
  console.log('');

  for (const [label, dir] of DIRS) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); }
    catch (_) { console.log(label + ' store: none'); continue; }
    console.log('== ' + label + ' records (' + files.length + ') ==');

    for (const f of files) {
      const p = path.join(dir, f);
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      const cs = d.chunk_start;
      const r = await sig.computeSignalForChunk(Date.parse(cs));
      if (!r.found) { refused.push(f + ': cannot recompute -- ' + r.note); continue; }

      // A side change is a DIFFERENT TRADE. Not a script's decision to make.
      if (r.side !== d.side) {
        refused.push(f + ': side ' + d.side + ' -> ' + r.side
          + ' -- that is a different trade, left untouched for the owner');
        continue;
      }
      // Price is not band-dependent; a moved price means something else drifted.
      if (r.decision_price != null && d.decision_price != null
          && Math.abs(r.decision_price - d.decision_price) > 0.01) {
        refused.push(f + ': decision_price ' + d.decision_price + ' -> ' + r.decision_price
          + ' -- price drift is not a band effect, left untouched');
        continue;
      }

      const changed = !eq(d.per_member, r.per_member) || d.input_hash !== r.input_hash
        || d.band_pct !== band;
      console.log('  ' + f + '  ' + d.side);
      if (!eq(d.per_member, r.per_member)) {
        console.log('    votes      ' + JSON.stringify(d.per_member) + '  ->  ' + JSON.stringify(r.per_member));
      }
      if (d.input_hash !== r.input_hash) {
        console.log('    input_hash ' + d.input_hash + '  ->  ' + r.input_hash);
      }
      if (d.band_pct !== band) console.log('    band_pct   ' + d.band_pct + '  ->  ' + band);
      if (!changed) { console.log('    already the counterfactual -- untouched'); unchanged++; }

      d.per_member = r.per_member;
      d.input_hash = r.input_hash;
      d.band_pct = band;
      d.quorum = r.quorum;
      // decision_price and side deliberately left as recorded: neither moves
      // with the band, and both are money facts rather than committee outputs.
      if (changed) {
        const tmp = p + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(d));
        fs.renameSync(tmp, p);
        rewritten++;
        console.log('    written');
      }
      // the box needs the same numbers for its journal and intent files
      map[cs] = { side: r.side, per_member: r.per_member, input_hash: r.input_hash,
                  band_pct: band, quorum: r.quorum };
    }
    console.log('');
  }

  fs.writeFileSync(mapPath, JSON.stringify(map, null, 1));
  console.log('rewrote ' + rewritten + ' record(s); ' + unchanged + ' already correct.');
  if (refused.length) {
    console.log('');
    console.log('*** REFUSED -- these need the owner, not a script ***');
    for (const x of refused) console.log('  ' + x);
  }
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
JSEOF
rc=$?
[ $rc -eq 0 ] || { echo "step 1 failed (rc=$rc) -- nothing else attempted"; exit 1; }
[ -s "$MAP" ] || { echo "no counterfactual map produced -- stopping"; exit 1; }

echo "=============================================================="
echo " STEP 2 -- the box: journal INTENT_SEEN events and intent files"
echo "=============================================================="
$SSH "$BOX" 'cat > /tmp/cf.json' <<PYWRAP
$(cat "$MAP")
PYWRAP
$SSH "$BOX" 'bash -s' <<'BOXEOF'
set -uo pipefail
J=~/pilot/journal.jsonl
[ -f "$J" ] || { echo "no journal on the box"; exit 1; }
[ -f ~/pilot/journal.jsonl.preband ] || cp "$J" ~/pilot/journal.jsonl.preband
echo "  backup: ~/pilot/journal.jsonl.preband ($(wc -l < ~/pilot/journal.jsonl.preband) lines)"
python3 - <<'PY'
import json, os, glob
cf = json.load(open("/tmp/cf.json"))
J = os.path.expanduser("~/pilot/journal.jsonl")

# ---- journal: rewrite the committee fields on INTENT_SEEN events ----
out, touched = [], 0
for line in open(J):
    s = line.strip()
    if not s:
        continue
    try:
        e = json.loads(s)
    except Exception:
        out.append(s); continue
    if e.get("event") == "INTENT_SEEN" and e.get("chunk_start") in cf:
        c = cf[e["chunk_start"]]
        before = (e.get("per_member"), e.get("input_hash"))
        e["per_member"] = c["per_member"]
        e["input_hash"] = c["input_hash"]
        e["quorum"] = c["quorum"]
        if (e["per_member"], e["input_hash"]) != before:
            touched += 1
            print("  journal " + e["chunk_start"][:10] + "  votes " + str(before[0])
                  + " -> " + str(e["per_member"]) + "   hash " + str(before[1])
                  + " -> " + e["input_hash"])
    out.append(json.dumps(e))
tmp = J + ".tmp"
with open(tmp, "w") as fh:
    fh.write("\n".join(out) + "\n")
os.replace(tmp, J)
print("  journal: " + str(touched) + " INTENT_SEEN event(s) rewritten, "
      + str(len(out)) + " lines total")

# ---- consumed + queued intent files carry the same payload ----
n = 0
for p in sorted(glob.glob(os.path.expanduser("~/pilot/intents/*"))):
    if os.path.isdir(p):
        continue
    try:
        d = json.load(open(p))
    except Exception:
        continue
    cs = d.get("chunk_start")
    if cs not in cf:
        continue
    c = cf[cs]
    before = (d.get("per_member"), d.get("input_hash"))
    d["per_member"] = c["per_member"]
    d["input_hash"] = c["input_hash"]
    d["quorum"] = c["quorum"]
    if "band_pct" in d:
        d["band_pct"] = c["band_pct"]
    if (d["per_member"], d["input_hash"]) == before:
        continue
    tmp = p + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(d, fh)
    os.replace(tmp, p)
    n += 1
    print("  intent " + os.path.basename(p) + "  votes " + str(before[0])
          + " -> " + str(d["per_member"]))
print("  intent files: " + str(n) + " rewritten")
PY
rm -f /tmp/cf.json
BOXEOF

echo "=============================================================="
echo " STEP 3 -- pull the corrected journal to the classifier"
echo "=============================================================="
/usr/local/sbin/pilot-sync-journal.sh 2>/dev/null || bash "$(dirname "$0")/pilot-sync-journal.sh"

echo "=============================================================="
echo " STEP 4 -- regenerate the mirror against the corrected records"
echo "=============================================================="
/usr/local/sbin/pilot-mirror.sh 2>/dev/null || bash "$(dirname "$0")/pilot-mirror.sh"

echo ""
echo "done. The halt was NOT touched and no order was placed."
