#!/usr/bin/env bash
# repair-trial1-basket.sh -- ONE-OFF (2026-07-21): "Bitso MAIN: Trial 1"
# (profile 5) shows basket 0.8000. Cause (probe-verified): deleting the
# zero-balance but 20%-TARGETED BCH row dropped its weight term from the
# basket sum (1.0 -> 0.8) and the 03:03 targets-set folded that corrupted
# level into basket_base. The profile has never traded: every targeted row
# sits at unit ratio 1, so the honest basket level is exactly 1.0.
# Repair = basket_base 0.8 -> 1.0, nothing else. Guarded and idempotent.
set -euo pipefail
cd /opt/semi-auto-balancer
node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');
const p = db.prepare('SELECT id, name, basket_base FROM profiles WHERE id = 5').get();
if (!p || !/Trial 1/.test(p.name)) { console.log('profile 5 is not Trial 1 — ABORTING'); process.exit(2); }
if (p.basket_base === 1) { console.log('basket_base already 1 — nothing to do'); process.exit(0); }
if (Math.abs(p.basket_base - 0.8) > 1e-9) { console.log(`basket_base is ${p.basket_base}, not the expected 0.8 — ABORTING`); process.exit(3); }
// Sanity: every targeted row must be at unit ratio 1 (never traded), so the
// repair provably restores the true level and cannot hide real performance.
const rows = db.prepare('SELECT symbol, target_pct, quantity, basket_units FROM assets WHERE profile_id = 5').all();
for (const a of rows) {
  const ratio = a.basket_units > 0 ? a.quantity / a.basket_units : 1;
  if (a.target_pct > 0 && Math.abs(ratio - 1) > 1e-9) {
    console.log(`${a.symbol} ratio ${ratio} != 1 — profile has activity, ABORTING`); process.exit(4);
  }
}
db.prepare('UPDATE profiles SET basket_base = 1 WHERE id = 5').run();
const after = db.prepare('SELECT basket_base FROM profiles WHERE id = 5').get();
console.log(`repaired: basket_base 0.8 -> ${after.basket_base}`);
const totalW = rows.reduce((s, a) => s + (a.target_pct || 0), 0);
console.log(`targets total ${totalW}% — basket now reads ${(after.basket_base * totalW / 100).toFixed(4)}`);
JS
