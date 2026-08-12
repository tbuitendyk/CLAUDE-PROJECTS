#!/usr/bin/env bash
# pilot-intent-check.sh -- READ-ONLY: is today's F1 entry intent staged on the box
# and still actionable, so that arming will open it? Shows the VPS decision preview,
# the intents queued on the box (name + side + chunk + decision_price + age), and
# whether any have been consumed (.done/.dup/.bad). No writes, no orders.
set -uo pipefail
BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
BOX_USER=admin
KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13-new.pem}"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
APP=/opt/general-classifier

echo "== VPS: decision preview (today's plan) =="
PV="$APP/data/pilot/preview.json"
[ -f "$PV" ] && python3 -c "import json;d=json.load(open('$PV'));print('  ',json.dumps({k:d.get(k) for k in ('available','side','quorum','per_member','entry_utc','chunk_start','written_utc','note')}))" || echo "  (no preview.json)"

echo "== box: staged intents =="
$SSH "$BOX_USER@$BOX_HOST" 'bash -s' <<'BOX'
set -uo pipefail
D=~/pilot/intents
echo "  queued (.json, awaiting the box):"
shopt -s nullglob
found=0
for f in "$D"/*.json; do
  found=1
  python3 - "$f" <<PY
import json,sys,os,time
f=sys.argv[1]; d=json.load(open(f))
age=int(time.time()-d.get("ts",0))
print("    %-28s side=%-5s chunk=%s price=%s age=%ss%s" % (
  os.path.basename(f), d.get("side"), d.get("chunk_start"),
  d.get("decision_price"), age, "  [STALE >1800s]" if age>1800 else ""))
PY
done
[ "$found" = 0 ] && echo "    (none queued)"
echo "  recently consumed:"
ls -1t "$D"/*.done "$D"/*.dup "$D"/*.bad 2>/dev/null | head -4 | sed 's#.*/#    #' || echo "    (none)"
BOX
echo "(read-only)"
