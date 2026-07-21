#!/usr/bin/env bash
# subaccount-probe.sh -- read-only Phase 6 (virtual sub-accounts) diagnostics:
# linked profiles + asset quantities, the append-only txn log, flows, pending
# flows and the attribution queue for every exchange account. Built to answer
# "where did balance X go" questions; output stays inside the 8KB cap.
set -euo pipefail
cd /opt/semi-auto-balancer
node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');
const d = (ts) => (ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 16) : '?');

for (const acct of db.prepare('SELECT id, venue FROM exchange_accounts').all()) {
  console.log(`== account ${acct.id} (${acct.venue}) ==`);
  const profs = db.prepare('SELECT id, name, is_shell FROM profiles WHERE exchange_account_id = ? ORDER BY is_shell DESC, created_at').all(acct.id);
  for (const p of profs) {
    const assets = db.prepare('SELECT symbol, quantity, target_pct, is_index FROM assets WHERE profile_id = ? ORDER BY id').all(p.id);
    console.log(`profile ${p.id} "${p.name}"${p.is_shell ? ' [SHELL]' : ''}: ` +
      assets.map((a) => `${a.symbol}${a.is_index ? '⚓' : ''}=${a.quantity}`).join(' '));
  }
  console.log('-- txn log (newest first, up to 25) --');
  for (const t of db.prepare('SELECT * FROM txn_log WHERE account_id = ? ORDER BY id DESC LIMIT 25').all(acct.id)) {
    console.log(`#${t.id} ${d(t.ts)} p${t.profile_id} ${t.kind}${t.ref ? ' ref=' + t.ref : ''} ` +
      `${t.deltas || ''} | ${t.note}${t.rewound_of ? ' (rewind of #' + t.rewound_of + ')' : ''}${t.rewound_by ? ' [REWOUND by #' + t.rewound_by + ']' : ''}`);
  }
  console.log('-- pending flows (up to 10) --');
  for (const f of db.prepare('SELECT * FROM pending_flows WHERE account_id = ? ORDER BY ts DESC LIMIT 10').all(acct.id)) {
    console.log(`#${f.id} ${d(f.ts)} p${f.profile_id} ${f.kind} ${f.code} ${f.amount} status=${f.status} ref=${f.venue_ref}`);
  }
  console.log('-- attribution queue (up to 10) --');
  for (const q of db.prepare('SELECT * FROM attribution_queue WHERE account_id = ? ORDER BY ts DESC LIMIT 10').all(acct.id)) {
    console.log(`#${q.id} ${d(q.ts)} ${q.kind} ${q.pair || ''} ${q.side || ''} ${q.deltas} status=${q.status} -> p${q.assigned_profile_id ?? q.suggested_profile_id ?? '?'}`);
  }
  // Manual flows (deposits/withdrawals/carves recorded per profile).
  console.log('-- profile flows (newest first, up to 15 across the group) --');
  const ids = profs.map((p) => p.id);
  if (ids.length) {
    for (const f of db.prepare(`SELECT * FROM flows WHERE profile_id IN (${ids.join(',')}) ORDER BY ts DESC LIMIT 15`).all()) {
      console.log(`#${f.id} ${d(f.ts)} p${f.profile_id} ${f.deltas} | ${f.note || ''}`);
    }
  }
}
JS
