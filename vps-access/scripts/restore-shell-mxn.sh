#!/usr/bin/env bash
# restore-shell-mxn.sh -- ONE-OFF remediation (2026-07-21): restore the
# 15,000 MXN erased when the MXN asset row was deleted from "Bitso MAIN:
# Trial 1" (carve-mrtnnvke had moved it there; the pre-guard DELETE endpoint
# dropped the row without returning the balance). Records a +15,000 MXN flow
# on the SHELL (profile 6, asset 16) through the app's own /flow endpoint so
# the basket/value-index splices apply exactly as a UI deposit would.
# Idempotence guard: refuses to run if a restore-note flow already exists.
set -euo pipefail
cd /opt/semi-auto-balancer

NOTE="restore: 15,000 MXN erased by asset delete on Trial 1 (carve-mrtnnvke) — returned to unallocated pool"

node <<JS
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');
const hit = db.prepare("SELECT id FROM flows WHERE profile_id = 6 AND note LIKE 'restore: 15,000 MXN erased%'").get();
if (hit) { console.log('ALREADY RESTORED (flow #' + hit.id + ') — refusing to double-apply'); process.exit(2); }
JS

# shellcheck disable=SC1091
set -a; source /etc/semi-auto-balancer/env; set +a
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT
curl -sS -c "$JAR" -X POST http://127.0.0.1:8092/api/login \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"${APP_PASSWORD:-}\"}" >/dev/null

curl -sS -b "$JAR" -X POST http://127.0.0.1:8092/api/profiles/6/flow \
  -H 'Content-Type: application/json' \
  -d "{\"deltas\":[{\"asset_id\":16,\"delta\":15000}],\"note\":\"$NOTE\"}"
echo

echo "-- balances after --"
node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');
for (const p of db.prepare('SELECT id, name FROM profiles WHERE exchange_account_id = 2 ORDER BY is_shell DESC, created_at').all()) {
  const m = db.prepare("SELECT quantity FROM assets WHERE profile_id = ? AND symbol = 'mxn'").get(p.id);
  console.log(`p${p.id} "${p.name}": mxn=${m ? m.quantity : '(no row)'}`);
}
const f = db.prepare('SELECT id, ts, deltas, note FROM flows WHERE profile_id = 6 ORDER BY id DESC LIMIT 1').get();
console.log('latest shell flow:', JSON.stringify(f));
JS
