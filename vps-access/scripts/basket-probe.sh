#!/usr/bin/env bash
# basket-probe.sh -- read-only: basket/value chain state for the Bitso group
# profiles (basket_base, value_base/snap/started, per-asset targets/quantities/
# basket_units, recent basket_events and snapshots). Diagnosing the Trial 1
# basket=0.8000 lock-in.
set -euo pipefail
cd /opt/semi-auto-balancer
node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');
const d = (ts) => (ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 16) : null);
for (const pid of [1, 6, 2, 5]) {
  const p = db.prepare('SELECT id, name, basket_base, basket_started_at, value_base, value_snap_rel, value_started_at FROM profiles WHERE id = ?').get(pid);
  console.log(`\n== p${p.id} "${p.name}" ==`);
  console.log(`basket_base=${p.basket_base} basket_started=${d(p.basket_started_at)} value_base=${p.value_base} value_snap_rel=${p.value_snap_rel} value_started=${d(p.value_started_at)}`);
  for (const a of db.prepare('SELECT id, symbol, target_pct, quantity, basket_units, is_index FROM assets WHERE profile_id = ? ORDER BY id').all(pid)) {
    console.log(`  asset#${a.id} ${a.symbol}${a.is_index ? '⚓' : ''} target=${a.target_pct}% qty=${a.quantity} units=${a.basket_units}`);
  }
  for (const b of db.prepare('SELECT id, ts, kind, basket, value_index, note FROM basket_events WHERE profile_id = ? ORDER BY id DESC LIMIT 5').all(pid)) {
    console.log(`  event#${b.id} ${d(b.ts)} ${b.kind} basket=${b.basket} value=${b.value_index} | ${b.note || ''}`);
  }
  const s = db.prepare('SELECT ts, total_rel, basket, value_index FROM profile_snapshots WHERE profile_id = ? ORDER BY ts DESC LIMIT 2').all(pid);
  for (const r of s) console.log(`  snap ${d(r.ts)} total_rel=${r.total_rel} basket=${r.basket} value=${r.value_index}`);
}
JS
