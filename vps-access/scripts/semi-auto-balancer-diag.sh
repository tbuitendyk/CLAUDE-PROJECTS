#!/usr/bin/env bash
# semi-auto-balancer-diag.sh -- read-only diagnostics for the semi-auto
# balancer (Phase 1.5 exchange sync): linked accounts with masked keys and
# the last sync's per-endpoint capability note, pending flows, recent synced
# trades/flows, and per-profile asset state. Mirrors balancer-diag.sh for
# the old system. Never prints API secrets. Runs as root via run-script.
set -euo pipefail

echo "== semi-auto-balancer service =="
systemctl --no-pager --lines 0 status semi-auto-balancer | head -5 || true
echo
echo "== sync-related log lines (last 24h) =="
journalctl -u semi-auto-balancer --since "24 hours ago" --no-pager 2>/dev/null \
  | grep -iE 'sync|adopt|flow|kraken|bitso|error|failed' | tail -n 30 || echo "(none)"
echo

cd /opt/semi-auto-balancer
node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');

console.log('== exchange accounts ==');
const accounts = db.prepare(
  'SELECT id, profile_id, venue, api_key, enabled, auto_flows, sync_minutes, last_trade_ts, last_ledger_ts, last_sync_at, last_sync_status, last_sync_note FROM exchange_accounts'
).all();
for (const a of accounts) {
  let note = null;
  try { note = JSON.parse(a.last_sync_note || 'null'); } catch { note = a.last_sync_note; }
  console.log(JSON.stringify({
    id: a.id, profile_id: a.profile_id, venue: a.venue,
    api_key: '...' + String(a.api_key).slice(-4),
    enabled: a.enabled, auto_flows: a.auto_flows, sync_minutes: a.sync_minutes,
    last_sync_at: a.last_sync_at ? new Date(a.last_sync_at).toISOString() : null,
    last_sync_status: a.last_sync_status,
    note,
    watermarks: {
      trade: new Date(a.last_trade_ts).toISOString(),
      ledger: new Date(a.last_ledger_ts).toISOString(),
    },
  }, null, 1));
}

console.log('== pending flows (latest 10) ==');
for (const f of db.prepare('SELECT id, profile_id, ts, kind, code, amount, status FROM pending_flows ORDER BY ts DESC LIMIT 10').all()) {
  console.log(JSON.stringify({ ...f, ts: new Date(f.ts).toISOString() }));
}

console.log('== synced trades (latest 5) ==');
for (const t of db.prepare('SELECT account_id, ts, pair, side, price, cost, fee, fee_pct FROM exchange_trades ORDER BY ts DESC LIMIT 5').all()) {
  console.log(new Date(t.ts).toISOString(), `acct=${t.account_id}`, t.pair, t.side,
    `price=${t.price} cost=${t.cost} fee=${t.fee} fee_pct=${t.fee_pct}`);
}

console.log('== flows (latest 5) ==');
for (const f of db.prepare('SELECT profile_id, ts, deltas, note FROM flows ORDER BY ts DESC LIMIT 5').all()) {
  console.log(new Date(f.ts).toISOString(), `profile=${f.profile_id}`, f.deltas, '|', f.note || '');
}

console.log('== profiles ==');
for (const p of db.prepare('SELECT id, name, notify_state, threshold_pct, value_started_at FROM profiles').all()) {
  const assets = db.prepare('SELECT symbol, quantity, target_pct, is_index FROM assets WHERE profile_id = ? ORDER BY id').all(p.id);
  console.log(JSON.stringify({
    id: p.id, name: p.name, notify_state: p.notify_state, threshold_pct: p.threshold_pct,
    value_started_at: p.value_started_at ? new Date(p.value_started_at).toISOString() : null,
    assets,
  }));
}
JS
