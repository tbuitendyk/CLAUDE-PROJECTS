#!/usr/bin/env bash
# alert-probe.sh -- read-only: notification-path forensics for one profile
# (arg = profile id, default 5): notify_state + timestamps, poll cadence from
# snapshots, alert_log tail, current alloc_alerts, asset freeze flags.
set -euo pipefail
PID="${1:-5}"
cd /opt/semi-auto-balancer
PID="$PID" node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');
const pid = Number(process.env.PID);
const d = (ts) => (ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 19) : null);
const p = db.prepare('SELECT * FROM profiles WHERE id = ?').get(pid);
console.log(`p${pid} "${p.name}" enabled=${p.enabled} alerts_enabled=${p.alerts_enabled} poll_minutes=${p.poll_minutes}`);
console.log(`notify_state=${p.notify_state} since ${d(p.notify_state_at)} · last_polled ${d(p.last_polled_at)}`);
console.log(`recipients=${p.recipients}`);
console.log('-- snapshots (poll cadence, newest 12) --');
for (const s of db.prepare('SELECT ts FROM profile_snapshots WHERE profile_id = ? ORDER BY ts DESC LIMIT 12').all(pid)) {
  console.log('  poll @', d(s.ts));
}
console.log('-- alert_log (newest 12) --');
for (const a of db.prepare('SELECT ts, message, emailed FROM alert_log WHERE profile_id = ? ORDER BY ts DESC LIMIT 12').all(pid)) {
  console.log(`  ${d(a.ts)} emailed=${a.emailed} | ${String(a.message).slice(0, 140)}`);
}
console.log('-- active alloc_alerts --');
for (const r of db.prepare('SELECT aa.asset_id, aa.triggered_at, aa.drift_rel_pct, a.symbol FROM alloc_alerts aa JOIN assets a ON a.id = aa.asset_id WHERE a.profile_id = ?').all(pid)) {
  console.log(`  ${r.symbol} drift=${r.drift_rel_pct} @ ${d(r.triggered_at)}`);
}
console.log('-- asset flags --');
for (const a of db.prepare('SELECT symbol, target_pct, quantity, buy_frozen, freeze_override, frozen_at FROM assets WHERE profile_id = ?').all(pid)) {
  console.log(`  ${a.symbol} target=${a.target_pct} qty=${a.quantity} frozen=${a.buy_frozen}${a.freeze_override ? ' (override)' : ''} ${a.frozen_at ? 'frozen_at ' + d(a.frozen_at) : ''}`);
}
JS
