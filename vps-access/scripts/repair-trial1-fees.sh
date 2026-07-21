#!/usr/bin/env bash
# repair-trial1-fees.sh -- ONE-OFF (2026-07-21), final step: remove the four
# fee slivers the rewind clamp left on Trial 1 (virtual excess vs venue:
# near 0.08612826, bch 0.00310248, paxg 0.00011316, trx 1.88315621 — exactly
# the reconcile residuals). Applied as a single recorded flow (spliced, so
# the value index reads no fake loss), then a fresh sync must show ZERO
# unexplained residuals. Guarded on the exact expected quantities.
set -euo pipefail
cd /opt/semi-auto-balancer

node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');
const expect = { bch: 0.86179951, near: 72.54883578, paxg: 0.03143418, trx: 523.0989483 };
for (const [sym, q] of Object.entries(expect)) {
  const a = db.prepare('SELECT quantity FROM assets WHERE profile_id = 5 AND symbol = ?').get(sym);
  if (!a || Math.abs(a.quantity - q) > 1e-9) {
    console.log(`${sym} is ${a && a.quantity}, expected ${q} — already corrected or changed; ABORTING`);
    process.exit(2);
  }
}
console.log('preconditions verified');
JS

APP_PASSWORD=$(grep -E '^APP_PASSWORD=' /etc/semi-auto-balancer/env | head -1 | cut -d= -f2- || true)
LOGIN_JSON=$(PW="$APP_PASSWORD" python3 -c 'import json,os; print(json.dumps({"password": os.environ.get("PW","")}))')
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT
curl -sS -c "$JAR" -X POST http://127.0.0.1:8092/api/login -H 'Content-Type: application/json' -d "$LOGIN_JSON" >/dev/null

echo "-- correction flow on Trial 1 (asset ids: bch 24, trx 25, near 26, paxg 19) --"
curl -sS -b "$JAR" -X POST http://127.0.0.1:8092/api/profiles/5/flow \
  -H 'Content-Type: application/json' \
  -d '{"deltas":[{"asset_id":24,"delta":-0.00310248},{"asset_id":26,"delta":-0.08612826},{"asset_id":19,"delta":-0.00011316},{"asset_id":25,"delta":-1.88315621}],"note":"correction: rewind clamp residue (trade fees) — aligns virtual books to venue balances"}' | head -c 200
echo

echo "-- re-sync + verify --"
curl -sS -m 90 -b "$JAR" -X POST http://127.0.0.1:8092/api/profiles/6/poll -H 'Content-Type: application/json' -d '{}' >/dev/null
node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');
const a = db.prepare('SELECT last_sync_status, last_sync_note FROM exchange_accounts WHERE id = 2').get();
const n = JSON.parse(a.last_sync_note || '{}');
console.log('sync status:', a.last_sync_status);
console.log('unexplained residuals:', JSON.stringify(n.unexplained || []));
const rows = db.prepare('SELECT symbol, quantity FROM assets WHERE profile_id = 5 ORDER BY id').all();
console.log('Trial 1: ' + rows.map((x) => `${x.symbol}=${x.quantity}`).join(' '));
JS
