#!/usr/bin/env bash
# sab-bitso-repair.sh -- semi-auto balancer, Bitso MAIN group (account 2):
# show the books, and apply the 2026-10 repairs THROUGH THE APP'S OWN LOCAL
# API (127.0.0.1:8092 -- the very endpoints the UI buttons call), so every
# change is logged in the app's transaction log and rewindable there.
# The DB is opened READ-ONLY here; this script never writes it directly.
#
# Modes (arg; default "status"):
#   status           READ-ONLY. Profiles + index levels, inbox, pending flows,
#                    reconcile flags, transaction log since 2026-09-20.
#   smoke            READ-ONLY. GETs every data endpoint the UI loads, for
#                    every profile/account, and reports anything not 200.
#   cashout-preview  READ-ONLY. Plan for re-booking Production's 2026-10-05
#                    SELL BTC/MXN order as a cash-out (money taken out, not a
#                    trading loss).
#   cashout-apply    CHANGES: applies that re-booking (refused if already done).
#   trial1-preview   READ-ONLY. Plan for the 2026-09-23 repair: Production's
#                    BTC buys spent Trial 1's 140.27 USDC, but it was booked
#                    as a Trial 1 trading loss.
#   trial1-apply     CHANGES: rewind that Trial 1 loss entry, carve 140.27 USDC
#                    Trial 1 -> Production, resolve -140.27 USDC on Production
#                    as a missed trade leg (stops if any precondition fails).
#   assign-<queueId>-<profileId>   CHANGES: the inbox's Assign button.
set -euo pipefail
MODE="${1:-status}"
if [[ ! "$MODE" =~ ^(status|smoke|cashout-preview|cashout-apply|trial1-preview|trial1-apply|assign-[0-9]+-[0-9]+)$ ]]; then
  echo "unknown mode: $MODE" >&2
  exit 2
fi
cd /opt/semi-auto-balancer
MODE="$MODE" node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite', { readonly: true });
const API = 'http://127.0.0.1:8092/api';
const ACCOUNT = 2;
const MODE = process.env.MODE;
const d = (ts) => (ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 16) : '?');
const n = (v, k = 4) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(k));
const call = async (method, path, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: r.status, body: json };
};
const must = (r, what) => {
  if (r.status !== 200) throw new Error(`${what} failed (${r.status}): ${r.body.error || JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
};

// The group, verified by name/shape so a re-numbered DB can't be repaired blind.
const profiles = db.prepare('SELECT * FROM profiles WHERE exchange_account_id = ? ORDER BY is_shell, id').all(ACCOUNT);
const byName = (re) => profiles.find((p) => re.test(p.name));
const PROD = byName(/Production/);
const TRIAL = byName(/Trial 1/);
const SHELL = profiles.find((p) => p.is_shell);
if (!PROD || !TRIAL || !SHELL) throw new Error('Bitso MAIN group not as expected (Production / Trial 1 / master)');
const nameOf = (id) => (profiles.find((p) => p.id === id) || { name: `p${id}` }).name.replace('Bitso MAIN', 'BM');

const levels = async (p) => {
  const t = must(await call('GET', `/profiles/${p.id}/state`), `state ${p.id}`).totals || {};
  return `basket=${n(t.basket)} value=${n(t.valueIndex)} (${n(t.growthPct, 2)}% since ${d(t.valueStartedAt)}) total=${n(t.totalRel, 2)} ${t.indexLabel}`;
};

(async () => {
  if (MODE === 'status') {
    for (const p of profiles) {
      const assets = db.prepare('SELECT symbol, quantity, target_pct, is_index FROM assets WHERE profile_id = ? ORDER BY id').all(p.id);
      console.log(`p${p.id} ${nameOf(p.id)}${p.is_shell ? ' [master]' : ''}: ` +
        assets.map((a) => `${a.symbol}${a.is_index ? '⚓' : ''}=${+a.quantity.toFixed(8)}@${a.target_pct}%`).join(' '));
      if (!p.is_shell) console.log(`   ${await levels(p)}`);
    }
    const acct = db.prepare('SELECT last_sync_at, last_sync_status, last_sync_note FROM exchange_accounts WHERE id = ?').get(ACCOUNT);
    const note = JSON.parse(acct.last_sync_note || '{}');
    console.log(`sync ${d(acct.last_sync_at)} ${acct.last_sync_status} · flags: ${JSON.stringify(note.unexplained || [])}`);
    console.log('-- inbox (pending fills) --');
    for (const q of db.prepare("SELECT * FROM attribution_queue WHERE account_id = ? AND status = 'pending' ORDER BY ts").all(ACCOUNT)) {
      console.log(`q${q.id} ${d(q.ts)} ${q.side} ${q.pair} ${q.deltas} → suggest ${nameOf(q.suggested_profile_id)} | ${q.reason}`);
    }
    console.log('-- pending flows --');
    for (const f of db.prepare("SELECT * FROM pending_flows WHERE account_id = ? AND status = 'pending'").all(ACCOUNT)) {
      console.log(`f${f.id} ${d(f.ts)} ${f.kind} ${f.amount} ${f.code} → ${nameOf(f.profile_id)}${f.hold_reason ? ' HELD: ' + f.hold_reason : ''}`);
    }
    console.log('-- txn log since 2026-09-20 (oldest first) --');
    for (const t of db.prepare('SELECT * FROM txn_log WHERE account_id = ? AND ts >= ? ORDER BY id').all(ACCOUNT, Date.UTC(2026, 8, 20))) {
      const flag = t.rewound_by ? ` [REWOUND by #${t.rewound_by}]` : '';
      console.log(`#${t.id} ${d(t.ts)} ${nameOf(t.profile_id)} ${t.kind} | ${String(t.note).slice(0, 110)}${flag}`);
    }
    return;
  }

  if (MODE === 'smoke') {
    const paths = ['/session', '/profiles', '/diagnostics', '/jobs', '/settings/cpu', '/telegram/status', '/ladder/status', '/ladder/monitors', '/ladder/latest'];
    for (const p of db.prepare('SELECT id FROM profiles').all()) {
      paths.push(`/profiles/${p.id}/state`);
    }
    for (const a of db.prepare('SELECT id FROM exchange_accounts').all()) {
      const pids = db.prepare('SELECT id FROM profiles WHERE exchange_account_id = ?').all(a.id).map((r) => r.id);
      for (const pid of pids) paths.push(`/accounts/${a.id}/subaccounts?viewProfileId=${pid}`);
      if (pids.length > 1) paths.push(`/accounts/${a.id}/subaccounts?viewProfileId=${pids[0]}&summary=1`);
      paths.push(`/accounts/${a.id}/txnlog?limit=5`);
    }
    let bad = 0;
    for (const p of paths) {
      const r = await call('GET', p);
      const err = r.body && (r.body.error || r.body.summaryError);
      if (r.status !== 200 || err) bad++;
      console.log(`${r.status} ${p}${err ? '  ERROR: ' + err : ''}`);
    }
    console.log(`smoke: ${paths.length - bad}/${paths.length} endpoints clean`);
    return;
  }

  if (MODE.startsWith('cashout-')) {
    const row = db
      .prepare(
        `SELECT t.id FROM txn_log t JOIN exchange_trades e ON e.account_id = t.account_id AND e.venue_trade_id = t.ref
          WHERE t.account_id = ? AND t.profile_id = ? AND t.kind LIKE 'trade-%' AND t.rewound_by IS NULL
            AND lower(e.side) = 'sell' AND lower(replace(e.pair, '/', '_')) = 'btc_mxn' AND e.ts >= ? AND e.ts < ?
          ORDER BY t.id LIMIT 1`
      )
      .get(ACCOUNT, PROD.id, Date.UTC(2026, 9, 5), Date.UTC(2026, 9, 6));
    if (!row) throw new Error("no un-rewound Oct 5 SELL BTC/MXN fill found on Production");
    const apply = MODE === 'cashout-apply';
    const plan = must(await call('POST', `/txnlog/${row.id}/funding`, apply ? {} : { preview: true }), 're-booking');
    console.log(`${apply ? 'APPLIED' : 'PREVIEW'}: ${plan.fills.length} fill(s) on "${plan.profileName}" re-booked as a ${plan.what}`);
    for (const f of plan.fills) console.log(`  #${f.id}${f.legacy ? ' (reconstructed from snapshots)' : ''} ${f.note}`);
    console.log(`  currency basket: ${n(plan.basket.now)} -> ${n(plan.basket.after)}   (x${n(plan.basket.factor, 6)})`);
    console.log(`  value index:     ${n(plan.value.now)} -> ${n(plan.value.after)}   (x${n(plan.value.factor, 6)})`);
    if (apply) console.log(`  now: ${await levels(PROD)}`);
    return;
  }

  if (MODE.startsWith('trial1-')) {
    const entry = db
      .prepare(
        `SELECT * FROM txn_log WHERE account_id = ? AND profile_id = ? AND kind = 'residual-trade'
            AND ref = 'residual:usdc' AND rewound_by IS NULL ORDER BY id`
      )
      .all(ACCOUNT, TRIAL.id)
      .find((t) => JSON.parse(t.deltas || '[]').some((x) => Math.abs(x.delta + 140.27) < 1e-6));
    if (!entry) throw new Error('Trial 1 −140.27 USDC trade-loss entry not found (already repaired?)');
    const usdcOf = (pid) => db.prepare("SELECT * FROM assets WHERE profile_id = ? AND coingecko_id = 'usd-coin'").get(pid);
    const tU = usdcOf(TRIAL.id);
    const pU = usdcOf(PROD.id);
    if (!tU || !pU) throw new Error('USDC rows missing on Trial 1 / Production');
    console.log(`found #${entry.id} ${d(entry.ts)}: ${entry.note}`);
    console.log(`Trial 1 USDC ${tU.quantity} · Production USDC ${pU.quantity}`);
    console.log(`Trial 1:    ${await levels(TRIAL)}`);
    console.log(`Production: ${await levels(PROD)}`);
    if (MODE === 'trial1-preview') {
      console.log('PLAN: 1) rewind it (Trial 1 gets the 140.27 back on its books)  2) carve 140.27 USDC Trial 1 -> Production');
      console.log('      3) resolve -140.27 USDC on Production as a missed trade leg (Production spent it on BTC)');
      return;
    }
    must(await call('POST', `/txnlog/${entry.id}/rewind`, {}), 'step 1 rewind');
    console.log('step 1 ok: rewound');
    must(await call('POST', `/accounts/${ACCOUNT}/carve`, { fromProfileId: TRIAL.id, toProfileId: PROD.id, items: [{ asset_id: tU.id, qty: 140.27 }] }), 'step 2 carve');
    console.log('step 2 ok: carved 140.27 USDC Trial 1 -> Production');
    must(await call('POST', `/accounts/${ACCOUNT}/resolve-residual`, { profileId: PROD.id, code: 'usdc', amount: -140.27, kind: 'trade' }), 'step 3 resolve');
    console.log('step 3 ok: resolved -140.27 USDC on Production');
    console.log(`Trial 1 now:    ${await levels(TRIAL)}`);
    console.log(`Production now: ${await levels(PROD)}`);
    return;
  }

  const m = MODE.match(/^assign-(\d+)-(\d+)$/);
  if (m) {
    const q = db.prepare("SELECT * FROM attribution_queue WHERE id = ? AND account_id = ? AND status = 'pending'").get(Number(m[1]), ACCOUNT);
    if (!q) throw new Error(`inbox item q${m[1]} not pending on this account`);
    if (!profiles.some((p) => p.id === Number(m[2]))) throw new Error(`profile ${m[2]} is not in the Bitso group`);
    must(await call('POST', `/attribution/${q.id}/assign`, { profileId: Number(m[2]) }), 'assign');
    console.log(`assigned q${q.id} (${q.side} ${q.pair} ${q.deltas}) -> ${nameOf(Number(m[2]))}`);
  }
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
JS
