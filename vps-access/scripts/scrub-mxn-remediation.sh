#!/usr/bin/env bash
# scrub-mxn-remediation.sh -- ONE-OFF (2026-07-21, final step of the 15k-MXN
# incident): remove the two REMEDIATION detour entries from the ledger — the
# phantom +15,000 "restore" flow on the shell and the second master→Trial 1
# carve (ref carve-mru2zt3k, txn pair + its two flow rows + their basket_events
# splice rows). Quantities are stored totals and are NOT touched: they are
# already correct (shell 100k / Production 50k / Trial 1 15k). After this the
# ledger folds to the true history again: baseline adoption → 100k carve to
# the master → 15k carve to Trial 1 (carve-mrtnnvke).
# Guarded: aborts unless the rows found match exactly what the incident wrote.
set -euo pipefail
cd /opt/semi-auto-balancer

node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');

const restoreFlows = db.prepare("SELECT * FROM flows WHERE profile_id = 6 AND note LIKE 'restore: 15,000 MXN erased%'").all();
const carveFlows = db.prepare("SELECT * FROM flows WHERE note LIKE '%carve-mru2zt3k%'").all();
const carveTxns = db.prepare("SELECT * FROM txn_log WHERE ref = 'carve-mru2zt3k'").all();

if (restoreFlows.length !== 1 || carveFlows.length !== 2 || carveTxns.length !== 2) {
  console.log(`unexpected row counts — restoreFlows=${restoreFlows.length} carveFlows=${carveFlows.length} carveTxns=${carveTxns.length}; ABORTING, nothing touched`);
  process.exit(2);
}

const q = (pid) => (db.prepare("SELECT quantity FROM assets WHERE profile_id = ? AND symbol = 'mxn'").get(pid) || {}).quantity;
const before = { shell: q(6), prod: q(2), trial: q(5) };
if (!(before.shell === 100000 && before.trial === 15000)) {
  console.log(`balances not in the expected end state (shell=${before.shell} trial=${before.trial}); ABORTING`);
  process.exit(3);
}

const doomedFlowIds = [...restoreFlows, ...carveFlows].map((f) => f.id);
const flowTs = [...restoreFlows, ...carveFlows].map((f) => f.ts);
// The basket_events splice rows recordFlow wrote alongside those flows: kind
// 'flow', same profile, within ±5s of the flow timestamps. Never more than 3.
const beRows = db.prepare("SELECT * FROM basket_events WHERE kind = 'flow' AND profile_id IN (5,6)").all()
  .filter((b) => flowTs.some((t) => Math.abs(b.ts - t) < 5000));
if (beRows.length > 3) { console.log(`matched ${beRows.length} basket_events (>3); ABORTING`); process.exit(4); }

const tx = db.transaction(() => {
  for (const id of doomedFlowIds) db.prepare('DELETE FROM flows WHERE id = ?').run(id);
  for (const t of carveTxns) db.prepare('DELETE FROM txn_log WHERE id = ?').run(t.id);
  for (const b of beRows) db.prepare('DELETE FROM basket_events WHERE id = ?').run(b.id);
});
tx();
console.log(`scrubbed: flows [${doomedFlowIds.join(',')}], txn_log [${carveTxns.map(t=>t.id).join(',')}], basket_events [${beRows.map(b=>b.id).join(',')}]`);

const after = { shell: q(6), prod: q(2), trial: q(5) };
console.log('balances untouched:', JSON.stringify(after));
console.log('-- remaining txn log (account 2) --');
for (const t of db.prepare('SELECT id, kind, profile_id, ref, note FROM txn_log WHERE account_id = 2 ORDER BY id').all()) {
  console.log(`#${t.id} p${t.profile_id} ${t.kind} ${t.ref || ''}: ${t.note}`);
}
console.log('-- remaining flows (profiles 2,5,6) --');
for (const f of db.prepare('SELECT id, profile_id, deltas, note FROM flows WHERE profile_id IN (2,5,6) ORDER BY id').all()) {
  console.log(`#${f.id} p${f.profile_id} ${f.deltas} | ${f.note || ''}`);
}
JS
