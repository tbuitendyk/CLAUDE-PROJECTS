#!/usr/bin/env bash
# repair-trial1-trades.sh -- ONE-OFF (2026-07-21): the Trial 1 purchase run.
# What happened: BUY USD/MXN (txn #9) was attributed to the SHELL (nobody
# "held" USD) and its +USD leg was DROPPED (no usd asset row anywhere); the
# five crypto buys (txns #10-#14) T1'd to Trial 1 but their -USD payment
# legs were dropped the same way. Net: Trial 1 kept a phantom 15,000 MXN,
# the shell paid for Trial 1's purchases, and the USD proceeds live on
# nobody's books.
# Repair uses the app's own designed machinery over HTTP (rewind re-queues
# each fill with its ORIGINAL full venue deltas; reassign applies them all):
#   1. add a USD (fiat:usd) asset row to Trial 1 so USD legs have a home
#   2. reassign txn #9 shell -> Trial 1  (funds Trial's USD, returns 15k MXN
#      to the shell, debits Trial's phantom 15k)
#   3. reassign txns #10-#14 to Trial 1  (re-applies WITH the -USD legs)
# Guarded: verifies the exact expected txn rows before acting; idempotent
# (rewound rows can't rewind twice).
set -euo pipefail
cd /opt/semi-auto-balancer

node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');
const t9 = db.prepare("SELECT * FROM txn_log WHERE id = 9").get();
if (!t9 || t9.kind !== 'trade-auto-t1' || t9.profile_id !== 6 || t9.rewound_by) {
  console.log('txn #9 is not the un-rewound shell conversion — ABORTING'); process.exit(2);
}
for (const id of [10, 11, 12, 13, 14]) {
  const t = db.prepare('SELECT * FROM txn_log WHERE id = ?').get(id);
  if (!t || t.kind !== 'trade-auto-t1' || t.profile_id !== 5 || t.rewound_by) {
    console.log(`txn #${id} is not an un-rewound Trial 1 buy — ABORTING`); process.exit(3);
  }
}
const m = db.prepare("SELECT quantity FROM assets WHERE profile_id = 5 AND symbol = 'mxn'").get();
if (!m || m.quantity !== 15000) { console.log(`Trial 1 mxn is ${m && m.quantity}, expected 15000 — ABORTING`); process.exit(4); }
console.log('preconditions verified');
JS

APP_PASSWORD=$(grep -E '^APP_PASSWORD=' /etc/semi-auto-balancer/env | head -1 | cut -d= -f2- || true)
LOGIN_JSON=$(PW="$APP_PASSWORD" python3 -c 'import json,os; print(json.dumps({"password": os.environ.get("PW","")}))')
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT
curl -sS -c "$JAR" -X POST http://127.0.0.1:8092/api/login -H 'Content-Type: application/json' -d "$LOGIN_JSON" >/dev/null

echo "-- add USD row to Trial 1 (idempotent: 'already in profile' is fine) --"
curl -sS -b "$JAR" -X POST http://127.0.0.1:8092/api/profiles/5/assets \
  -H 'Content-Type: application/json' -d '{"id":"fiat:usd","symbol":"usd","quantity":0}' | head -c 200
echo

echo "-- reassign #9 (USD/MXN conversion) shell -> Trial 1 --"
curl -sS -b "$JAR" -X POST http://127.0.0.1:8092/api/txnlog/9/reassign \
  -H 'Content-Type: application/json' -d '{"profileId":5}' | head -c 300
echo
for id in 10 11 12 13 14; do
  echo "-- reassign #$id -> Trial 1 (re-applies with the -USD leg) --"
  curl -sS -b "$JAR" -X POST "http://127.0.0.1:8092/api/txnlog/$id/reassign" \
    -H 'Content-Type: application/json' -d '{"profileId":5}' | head -c 300
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
console.log('virtual MXN total:', vm.s, '(physical after the 15k spend: 150000.00484184)');
JS
