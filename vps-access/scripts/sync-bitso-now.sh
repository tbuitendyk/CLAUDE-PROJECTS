#!/usr/bin/env bash
# sync-bitso-now.sh -- trigger a real account sync + poll on the Bitso master
# (profile 6) through the app's own Sync & poll endpoint, then print the
# reconciliation outcome and the group balances. Read-only apart from what
# sync itself legitimately does.
set -euo pipefail
cd /opt/semi-auto-balancer
APP_PASSWORD=$(grep -E '^APP_PASSWORD=' /etc/semi-auto-balancer/env | head -1 | cut -d= -f2- || true)
LOGIN_JSON=$(PW="$APP_PASSWORD" python3 -c 'import json,os; print(json.dumps({"password": os.environ.get("PW","")}))')
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT
curl -sS -c "$JAR" -X POST http://127.0.0.1:8092/api/login -H 'Content-Type: application/json' -d "$LOGIN_JSON" >/dev/null
echo "-- Sync & poll on the master --"
curl -sS -m 90 -b "$JAR" -X POST http://127.0.0.1:8092/api/profiles/6/poll -H 'Content-Type: application/json' -d '{}' | head -c 400
echo
echo "-- account sync note --"
node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');
const a = db.prepare('SELECT last_sync_at, last_sync_status, last_sync_note FROM exchange_accounts WHERE id = 2').get();
console.log('status:', a.last_sync_status, '@', new Date(a.last_sync_at).toISOString());
try {
  const n = JSON.parse(a.last_sync_note || 'null');
  console.log(JSON.stringify(n, null, 1).slice(0, 1500));
} catch { console.log(a.last_sync_note); }
for (const pid of [6, 5]) {
  const p = db.prepare('SELECT name FROM profiles WHERE id = ?').get(pid);
  const rows = db.prepare('SELECT symbol, quantity FROM assets WHERE profile_id = ? ORDER BY id').all(pid);
  console.log(`p${pid} "${p.name}": ` + rows.map((x) => `${x.symbol}=${x.quantity}`).join(' '));
}
for (const t of db.prepare('SELECT id, kind, profile_id, note FROM txn_log WHERE account_id = 2 ORDER BY id DESC LIMIT 6').all()) {
  console.log(`txn #${t.id} p${t.profile_id} ${t.kind}: ${String(t.note).slice(0, 110)}`);
}
JS
