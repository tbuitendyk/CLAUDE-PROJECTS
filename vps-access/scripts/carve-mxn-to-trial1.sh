#!/usr/bin/env bash
# carve-mxn-to-trial1.sh -- ONE-OFF (2026-07-21, step 2 of the 15k-MXN
# remediation): the restore landed the 15,000 MXN on the SHELL, but the txn
# log says it was carved into "Bitso MAIN: Trial 1" (carve-mrtnnvke) and
# never left — Trial 1 is where it belongs. Move it master → Trial 1 through
# the app's own carve endpoint so it's logged and rewindable like any carve.
# Idempotence guard: refuses if Trial 1 already holds MXN.
set -euo pipefail
cd /opt/semi-auto-balancer

node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');
const t = db.prepare("SELECT quantity FROM assets WHERE profile_id = 5 AND symbol = 'mxn'").get();
if (t && t.quantity > 0) { console.log(`Trial 1 already holds ${t.quantity} MXN — refusing to double-apply`); process.exit(2); }
const s = db.prepare("SELECT id, quantity FROM assets WHERE profile_id = 6 AND symbol = 'mxn'").get();
if (!s || s.quantity < 15000) { console.log(`shell MXN is ${s ? s.quantity : 'missing'} — expected >= 15000; aborting`); process.exit(3); }
console.log(`pre: shell mxn asset #${s.id} qty=${s.quantity}`);
JS

APP_PASSWORD=$(grep -E '^APP_PASSWORD=' /etc/semi-auto-balancer/env | head -1 | cut -d= -f2- || true)
LOGIN_JSON=$(PW="$APP_PASSWORD" python3 -c 'import json,os; print(json.dumps({"password": os.environ.get("PW","")}))')
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT
curl -sS -c "$JAR" -X POST http://127.0.0.1:8092/api/login \
  -H 'Content-Type: application/json' -d "$LOGIN_JSON" >/dev/null

# Shell's MXN asset id is 16 (probe-verified); carveOut validates it anyway.
curl -sS -b "$JAR" -X POST http://127.0.0.1:8092/api/accounts/2/carve \
  -H 'Content-Type: application/json' \
  -d '{"fromProfileId":6,"toProfileId":5,"items":[{"asset_id":16,"qty":15000}]}'
echo

echo "-- balances after --"
node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');
for (const p of db.prepare('SELECT id, name FROM profiles WHERE exchange_account_id = 2 ORDER BY is_shell DESC, created_at').all()) {
  const m = db.prepare("SELECT quantity FROM assets WHERE profile_id = ? AND symbol = 'mxn'").get(p.id);
  console.log(`p${p.id} "${p.name}": mxn=${m ? m.quantity : '(no row)'}`);
}
for (const t of db.prepare('SELECT id, kind, profile_id, note FROM txn_log WHERE account_id = 2 ORDER BY id DESC LIMIT 2').all()) {
  console.log(`txn #${t.id} p${t.profile_id} ${t.kind}: ${t.note}`);
}
JS
