#!/usr/bin/env bash
# semi-auto-diag.sh -- READ-ONLY diagnostics for the SEMI-AUTO balancer
# (port 8092, /opt/semi-auto-balancer). Three views: recent service-log
# error lines with the last stack trace, each exchange account's last sync
# status + reconcile note (unmapped/unexplained/adopted/perCode), and the
# raw asset rows of every profile (symbol/coingecko/qty/is_index) so a
# NULL-symbol or miswired row is visible at a glance. Touches nothing.
set -euo pipefail

echo "== semi-auto-balancer service =="
systemctl --no-pager --lines 0 status semi-auto-balancer | head -4 || true
echo
echo "== error-ish log lines (last 48h, newest last) =="
journalctl -u semi-auto-balancer --since "48 hours ago" --no-pager 2>/dev/null \
  | grep -iE 'error|typeerror|toupper|undefined|failed' | tail -n 25 || echo "(none)"
echo
echo "== last stack trace (last 48h) =="
journalctl -u semi-auto-balancer --since "48 hours ago" --no-pager 2>/dev/null \
  | grep -A 14 'TypeError' | tail -n 32 || echo "(none)"
echo

cd /opt/semi-auto-balancer
node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');
const iso = (ts) => (ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 16) : '?');

for (const a of db.prepare('SELECT id, venue, enabled, auto_flows, last_sync_at, last_sync_status, last_sync_note FROM exchange_accounts').all()) {
  console.log(`== account ${a.id} (${a.venue}) enabled=${a.enabled} auto_flows=${a.auto_flows} lastSync=${iso(a.last_sync_at)} status=${a.last_sync_status}`);
  try {
    const n = JSON.parse(a.last_sync_note || '{}');
    console.log(' unmapped:    ' + JSON.stringify(n.unmapped || []));
    console.log(' unexplained: ' + JSON.stringify(n.unexplained || []));
    console.log(' adopted:     ' + JSON.stringify(n.adopted || []));
    console.log(' perCode:     ' + JSON.stringify(n.perCode || []));
  } catch (e) {
    console.log(' note parse fail: ' + e.message);
  }
}

const pf = db.prepare("SELECT status, COUNT(*) c FROM pending_flows GROUP BY status").all();
console.log('\n== pending_flows by status: ' + JSON.stringify(pf));
const aq = db.prepare("SELECT status, COUNT(*) c FROM attribution_queue GROUP BY status").all();
console.log('== attribution_queue by status: ' + JSON.stringify(aq));
console.log('\n== asset rows (every profile, raw) ==');
for (const p of db.prepare('SELECT id, name, is_shell, exchange_account_id FROM profiles ORDER BY id').all()) {
  console.log(`profile ${p.id} "${p.name}"${p.is_shell ? ' [SHELL]' : ''} acct=${p.exchange_account_id}`);
  for (const r of db.prepare('SELECT id, symbol, coingecko_id, quantity, target_pct, is_index FROM assets WHERE profile_id = ? ORDER BY id').all(p.id)) {
    console.log(`  #${r.id} sym=${JSON.stringify(r.symbol)} cg=${JSON.stringify(r.coingecko_id)} qty=${r.quantity} tgt=${r.target_pct} idx=${r.is_index}`);
  }
}
JS
