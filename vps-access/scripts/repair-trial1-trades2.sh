#!/usr/bin/env bash
# repair-trial1-trades2.sh -- ONE-OFF (2026-07-21), step 2: the six fills sit
# in the attribution inbox with their FULL original deltas (USD legs
# included). Add the USD row to Trial 1 (correct body field this time), then
# assign queue #1 (USD/MXN conversion, funds the USD) followed by #2-#6 (the
# five buys, which debit it). Guarded on queue state; assign refuses
# non-pending rows so this cannot double-apply.
set -euo pipefail
cd /opt/semi-auto-balancer

node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');
const rows = db.prepare("SELECT id, status FROM attribution_queue WHERE account_id = 2 ORDER BY id").all();
const pending = rows.filter((r) => r.status === 'pending').map((r) => r.id);
if (JSON.stringify(pending) !== JSON.stringify([1, 2, 3, 4, 5, 6])) {
  console.log(`pending queue is [${pending}] — expected [1..6]; ABORTING`); process.exit(2);
}
console.log('preconditions verified: 6 pending fills');
JS

APP_PASSWORD=$(grep -E '^APP_PASSWORD=' /etc/semi-auto-balancer/env | head -1 | cut -d= -f2- || true)
LOGIN_JSON=$(PW="$APP_PASSWORD" python3 -c 'import json,os; print(json.dumps({"password": os.environ.get("PW","")}))')
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT
curl -sS -c "$JAR" -X POST http://127.0.0.1:8092/api/login -H 'Content-Type: application/json' -d "$LOGIN_JSON" >/dev/null

echo "-- add USD (fiat:usd) row to Trial 1 --"
curl -sS -b "$JAR" -X POST http://127.0.0.1:8092/api/profiles/5/assets \
  -H 'Content-Type: application/json' -d '{"coingecko_id":"fiat:usd","symbol":"usd","quantity":0}' | head -c 160
echo
for qid in 1 2 3 4 5 6; do
  echo "-- assign queue #$qid -> Trial 1 --"
  curl -sS -b "$JAR" -X POST "http://127.0.0.1:8092/api/attribution/$qid/assign" \
    -H 'Content-Type: application/json' -d '{"profileId":5}' | head -c 200
  echo
done

echo "-- balances after --"
node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');
for (const pid of [6, 2, 5]) {
  const p = db.prepare('SELECT name FROM profiles WHERE id = ?').get(pid);
  const rows = db.prepare('SELECT symbol, quantity FROM assets WHERE profile_id = ? ORDER BY id').all(pid);
  console.log(`p${pid} "${p.name}": ` + rows.map((a) => `${a.symbol}=${a.quantity}`).join(' '));
}
const vm = db.prepare("SELECT SUM(quantity) s FROM assets a JOIN profiles p ON p.id = a.profile_id WHERE p.exchange_account_id = 2 AND a.symbol = 'mxn'").get();
console.log('virtual MXN total:', vm.s, '(physical: 150000.00484184 — must match)');
const q = db.prepare("SELECT COUNT(*) n FROM attribution_queue WHERE account_id = 2 AND status = 'pending'").get();
console.log('pending inbox items:', q.n, '(must be 0)');
JS
