#!/usr/bin/env bash
# profile-migrate.sh -- ONE-OFF, DELETE AFTER USE (owner, 2026-08-19).
#
# Move the running book off the hardcoded config and onto the owner's own
# profile, gl-mszdonx9-e5a595 — the greenlight built from the identical book
# (LTCUSDT vs XRPUSDT/BCHUSDT, daily-4d argmax, band 1.6858050329831362, q1
# market/directional, 137h hold, 4 members). Everything moves: the decision
# records, the stand-downs, and the two open shorts.
#
# ORDER MATTERS, and it is the whole reason this is a script rather than four
# commands. An exit is routed by the wallet recorded ON THE POSITION:
#   - no profile stamped  -> the shared client (what the two shorts use today)
#   - a profile stamped   -> that profile's own sub-account
#   - profile stamped, no credentials on the box -> the executor REFUSES to exit
#     it, rather than sell from an account that does not hold the asset.
# So the credentials must exist BEFORE the positions are stamped. Stamp first and
# both shorts would be parked instead of closed. Every step below verifies before
# the next one runs, and the script stops rather than continuing on a surprise.
#
# It places no orders, opens nothing, closes nothing, and clears no halt.
set -uo pipefail
APPDIR=/opt/general-classifier
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
GLID=gl-mszdonx9-e5a595
KEYREF=mx-ltc-1
[ -f "$KEY" ] || { echo "no key at $KEY"; exit 1; }

echo "=============================================================="
echo " STEP 1 -- create the profile from the owner's greenlight"
echo "=============================================================="
cd "$APPDIR" || exit 1
SETUP_ID=$(GLID="$GLID" KEYREF="$KEYREF" node <<'JSEOF'
const gl = require('/opt/general-classifier/lib/live/greenlight');
const reg = require('/opt/general-classifier/lib/live/setups');
const glid = process.env.GLID, keyRef = process.env.KEYREF;
const g = gl.getGreenlight(glid);
if (!g) { console.error(`no greenlight ${glid}`); process.exit(1); }

// Already shuttled? Reuse it — this script must be safe to run twice.
const existing = reg.listSetups().find((s) => s.provenanceRef === glid && s.state !== 'retired');
let s = existing;
if (!s) {
  // The NAME is a placeholder the owner overwrites with the Rename control on
  // Trading | Greenlights. Deliberately not a plausible-sounding label invented
  // for them — that is the exact complaint this whole job exists to answer.
  const out = gl.shuttle(glid, {
    name: 'UNNAMED — rename me',
    clipUsd: 10,                 // the clip the running book actually trades
    stopPct: null,               // the box reports fixed_stop_pct 0.0 today
    by: 'owner',
    channel: 'real',
  });
  s = out.setup;
}
// its own sub-account, and the box that serves this pair
s = reg.updateSetup(s.id, { keyRef, executionTargetRef: 'mx-1' }, 'owner');
process.stderr.write(`  profile ${s.id} state=${s.state} keyRef=${s.keyRef} clip=$${s.clipUsd}\n`);
process.stdout.write(s.id);
JSEOF
) || { echo "step 1 failed — nothing else attempted"; exit 1; }
[ -n "$SETUP_ID" ] || { echo "no setup id produced — stopping"; exit 1; }
echo "  setup id: $SETUP_ID"

echo "=============================================================="
echo " STEP 2 -- give the profile the wallet that already holds the shorts"
echo "=============================================================="
# Same account, inherited. Nothing is shared once the hardcoded config is gone,
# which is precisely why this is now the profile's OWN sub-account rather than a
# pooled one. The secret is copied on the box and never leaves it.
$SSH "$BOX" "KEYREF='$KEYREF' bash -s" <<'BOXEOF'
set -uo pipefail
ENV=~/.executor-env
PREF="KEY_$(printf '%s' "$KEYREF" | tr -c '[:alnum:]' '_' | tr '[:lower:]' '[:upper:]')_"
if grep -q "^${PREF}BINANCE_KEY=" "$ENV" 2>/dev/null; then
  echo "  ${PREF}BINANCE_KEY already provisioned"
else
  K=$(grep -E '^BINANCE_KEY=' "$ENV" | tail -1 | cut -d= -f2-)
  S=$(grep -E '^BINANCE_SECRET=' "$ENV" | tail -1 | cut -d= -f2-)
  if [ -z "$K" ] || [ -z "$S" ]; then
    echo "  REFUSING: no existing BINANCE_KEY/SECRET to inherit"; exit 1
  fi
  tmp=$(mktemp); cat "$ENV" > "$tmp"
  printf '%sBINANCE_KEY=%s\n%sBINANCE_SECRET=%s\n' "$PREF" "$K" "$PREF" "$S" >> "$tmp"
  chmod 600 "$tmp"; mv "$tmp" "$ENV"
  echo "  provisioned ${PREF}BINANCE_KEY / ${PREF}BINANCE_SECRET (inherited)"
fi
BOXEOF
[ $? -eq 0 ] || { echo "step 2 failed — NOTHING has been stamped, the shorts are untouched"; exit 1; }

echo "=============================================================="
echo " STEP 3 -- prove the profile's client resolves BEFORE anything moves"
echo "=============================================================="
$SSH "$BOX" "KEYREF='$KEYREF' python3 - <<'PY'
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location('mx', os.path.expanduser('~/mx_executor.py'))
mx = importlib.util.module_from_spec(spec); spec.loader.exec_module(mx)
kr = os.environ['KEYREF']
k, s = mx.credentials_for(kr)
if not k:
    print(f'  REFUSING: no credentials resolve for keyRef {kr}'); sys.exit(1)
c = mx.client_for(kr, 'LTCUSDT')
if c is None:
    print(f'  REFUSING: no client for {kr}'); sys.exit(1)
print(f'  client for {kr} resolves: symbol={c.symbol} base={c.base_asset} live={c.live}')
code, acct = c.isolated_account()
if code != 200:
    print(f'  REFUSING: the profile cannot read its own wallet (http {code})'); sys.exit(1)
a = acct['assets'][0]
print(f\"  its wallet: base net {a['baseAsset']['netAsset']} quote net {a['quoteAsset']['netAsset']}\")
PY"
[ $? -eq 0 ] || { echo "step 3 failed — NOTHING has been stamped, the shorts are untouched"; exit 1; }

echo "=============================================================="
echo " STEP 4 -- move every record under the profile"
echo "=============================================================="
$SSH "$BOX" "SID='$SETUP_ID' KEYREF='$KEYREF' bash -s" <<'BOXEOF'
set -uo pipefail
J=~/pilot/journal.jsonl
[ -f "$J" ] || { echo "  no journal on the box"; exit 1; }
# The journal is append-only and is the record of everything the executor did.
# A copy before the rewrite; delete it once the screens have been checked.
[ -f ~/pilot/journal.jsonl.premigrate ] || cp "$J" ~/pilot/journal.jsonl.premigrate
echo "  backup: ~/pilot/journal.jsonl.premigrate ($(wc -l < ~/pilot/journal.jsonl.premigrate) lines)"
python3 - <<'PY'
import json, os
sid = os.environ['SID']; keyref = os.environ['KEYREF']
J = os.path.expanduser('~/pilot/journal.jsonl')

# Which events describe THIS book's trading life. Box-level events (RUN_STATUS,
# BALANCE, CLOCK_SYNC, ARM_*, PNL_MTM, RECONCILE_*) describe the machine, not a
# profile, and are deliberately left alone.
MOVE = {"INTENT_SEEN", "ENTRY_ATTEMPT", "ORDER_SENT", "ORDER_ACK", "ENTRY_FILL",
        "EXIT_FILL", "ENTRY_SKIPPED", "EXIT_SKIPPED", "EXIT_OVERDUE",
        "INTENT_DUPLICATE", "INTENT_STALE", "INTENT_INVALID", "ORDER_REJECT",
        "ORDER_UNKNOWN", "ENTRY_GAVE_UP", "FIXED_STOP", "MIRROR_BREAK"}

out, moved, open_moved = [], 0, 0
for line in open(J):
    t = line.strip()
    if not t:
        continue
    try:
        e = json.loads(t)
    except Exception:
        out.append(t); continue
    # only untagged (hardcoded-config) trading events move; anything already
    # carrying a setup_id belongs to some other profile and is left alone
    if e.get("event") in MOVE and e.get("setup_id") is None:
        e["setup_id"] = sid
        if e["event"] == "ENTRY_FILL":
            # the wallet this position exits through, and its pair
            e["key_ref"] = keyref
            e["symbol"] = "LTCUSDT"
            e.setdefault("hold_hours", 137)
            open_moved += 1
        moved += 1
    out.append(json.dumps(e))

tmp = J + ".tmp"
with open(tmp, "w") as fh:
    fh.write("\n".join(out) + "\n")
os.replace(tmp, J)
print(f"  journal: {moved} event(s) moved under {sid}, of which {open_moved} entry fill(s)")
PY
BOXEOF
[ $? -eq 0 ] || { echo "step 4 failed on the box"; exit 1; }

echo "=============================================================="
echo " STEP 4b -- carry the decision record into the profile's own log"
echo "=============================================================="
# The reproduce-check reads a profile's decisions from one append-only JSONL per
# profile; the old rail kept one JSON file per chunk. Same fields, different
# shape, so this CONVERTS rather than copies — otherwise the profile's check
# would find no history and report nothing to verify, which on a screen reads
# identically to "nothing wrong".
SETUP_ID="$SETUP_ID" node <<'JSEOF'
const fs = require('fs'), path = require('path');
const sid = process.env.SETUP_ID;
const BASE = '/opt/general-classifier/data';
const out = path.join(BASE, 'live', 'decisions', sid + '.jsonl');
fs.mkdirSync(path.dirname(out), { recursive: true });
const seen = new Set();
try {
  for (const line of fs.readFileSync(out, 'utf8').split('\n')) {
    if (line.trim()) { try { seen.add(JSON.parse(line).chunk_start); } catch (_) {} }
  }
} catch (_) { /* first run */ }
let n = 0;
for (const sub of ['decisions', 'standdowns']) {
  const dir = path.join(BASE, 'pilot', sub);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch (_) { continue; }
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (seen.has(d.chunk_start)) continue;   // idempotent: safe to run twice
    fs.appendFileSync(out, JSON.stringify(d) + '\n');
    seen.add(d.chunk_start);
    n++;
  }
}
process.stderr.write('  carried ' + n + ' decision record(s) into ' + path.basename(out) + '\n');
JSEOF

echo "=============================================================="
echo " STEP 5 -- prove every open position still has a reachable exit"
echo "=============================================================="
$SSH "$BOX" "python3 - <<'PY'
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location('mx', os.path.expanduser('~/mx_executor.py'))
mx = importlib.util.module_from_spec(spec); spec.loader.exec_module(mx)
st = mx.derive(mx.journal_events())
bad = []
for k, p in (st.get('open') or {}).items():
    kr = p.get('key_ref')
    who = 'shared client' if not kr else kr
    ok = True if not kr else (mx.client_for(kr, p.get('symbol') or 'LTCUSDT') is not None)
    print(f\"  {k}: {p['side']} qty {p['qty']} exits via {who} -> {'REACHABLE' if ok else 'NO CLIENT'}\")
    if not ok:
        bad.append(k)
if bad:
    print('  *** REFUSED: these positions have no reachable exit: ' + ', '.join(bad)); sys.exit(1)
print('  every open position can be exited')
PY"
rc=$?
echo ""
if [ $rc -eq 0 ]; then
  echo "done. No order was placed, nothing was opened or closed, no halt was touched."
  echo "Setup id: $SETUP_ID  (name it on Trading | Greenlights with Rename)"
else
  echo "STEP 5 FAILED — an open position cannot be exited. Investigate before the next tick."
  exit 1
fi
