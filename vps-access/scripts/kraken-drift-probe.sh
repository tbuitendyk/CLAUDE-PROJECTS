#!/usr/bin/env bash
# kraken-drift-probe.sh -- READ-ONLY: explain the growing Kraken residuals
# (pol/sc/usd). Pulls the venue's OWN ledger (ALL types) + TradesHistory since
# mid-July and compares, per asset, what the venue says changed vs what the
# app applied (exchange_trades + flows). The per-type ledger breakdown names
# the leak: fee-in-base trades, convert (spend/receive), transfers, sweeps.
# Queries only -- writes nothing anywhere.
set -euo pipefail
cd /opt/semi-auto-balancer
node <<'JS'
(async () => {
  const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');
  const kraken = require('./lib/exchanges/kraken');
  const acct = db.prepare("SELECT * FROM exchange_accounts WHERE venue = 'kraken'").get();
  const client = kraken.makeClient({ apiKey: acct.api_key, apiSecret: acct.api_secret });

  const SINCE = Date.UTC(2026, 6, 17); // Jul 17 baseline adoption
  const WATCH = new Set(['pol', 'sc', 'usd', 'fil', 'qtum', 'doge', 'xrp', 'btc']);

  // --- venue ledger, ALL types (privateCall via a throwaway trade fetch is
  // not enough -- call Ledgers directly through the client's own machinery by
  // reaching into makeClient? Not exported; re-sign here with the same creds.
  const crypto = require('crypto');
  let lastNonce = 0;
  async function priv(method, params = {}) {
    const path = `/0/private/${method}`;
    let nonce = Date.now() * 1000;
    if (nonce <= lastNonce) nonce = lastNonce + 1;
    lastNonce = nonce;
    const post = new URLSearchParams({ nonce: String(nonce) });
    for (const [k, v] of Object.entries(params)) if (v != null) post.set(k, String(v));
    const body = post.toString();
    const sha = crypto.createHash('sha256').update(String(nonce) + body).digest();
    const sig = crypto.createHmac('sha512', Buffer.from(acct.api_secret, 'base64'))
      .update(Buffer.concat([Buffer.from(path, 'utf8'), sha])).digest('base64');
    const res = await fetch(`https://api.kraken.com${path}`, {
      method: 'POST',
      headers: { 'API-Key': acct.api_key, 'API-Sign': sig, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const j = await res.json();
    if (j.error && j.error.length) throw new Error(`${method}: ${j.error.join('; ')}`);
    return j.result || {};
  }
  async function pageAll(method, params, key) {
    const all = [];
    let ofs = 0;
    for (;;) {
      const r = await priv(method, { ...params, ofs });
      const e = Object.entries(r[key] || {});
      all.push(...e);
      ofs += e.length;
      if (e.length === 0 || ofs >= Number(r.count || 0) || ofs > 5000) break;
    }
    return all;
  }

  const ledger = await pageAll('Ledgers', { start: SINCE / 1000 }, 'ledger');
  // per-asset per-type net (amount - fee = true balance effect)
  const byAssetType = new Map();
  const oddRows = [];
  for (const [lid, e] of ledger) {
    const code = kraken.normalizeCode(e.asset);
    const net = Number(e.amount) - Number(e.fee || 0);
    const k = `${code}|${e.type}${e.subtype ? '/' + e.subtype : ''}`;
    byAssetType.set(k, (byAssetType.get(k) || 0) + net);
    if (!['trade', 'deposit', 'withdrawal'].includes(e.type) && oddRows.length < 12) {
      oddRows.push(`${lid} ${new Date(e.time * 1000).toISOString().slice(0, 16)} ${e.type}${e.subtype ? '/' + e.subtype : ''} ${e.asset} amt=${e.amount} fee=${e.fee} ref=${e.refid}`);
    }
  }
  console.log(`== ledger entries since Jul 17: ${ledger.length} ==`);
  const assets = [...new Set([...byAssetType.keys()].map((k) => k.split('|')[0]))].sort();
  for (const a of assets) {
    if (!WATCH.has(a)) continue;
    const parts = [...byAssetType.entries()].filter(([k]) => k.startsWith(a + '|'))
      .map(([k, v]) => `${k.split('|')[1]}=${+v.toFixed(8)}`).join(' ');
    console.log(`  ${a}: ${parts}`);
  }
  console.log('-- non-trade/deposit/withdrawal ledger rows (up to 12) --');
  for (const r of oddRows) console.log('  ' + r);
  if (!oddRows.length) console.log('  (none)');

  // --- what the app APPLIED since Jul 17 (DB truth) ---
  const applied = new Map();
  for (const t of db.prepare('SELECT deltas FROM exchange_trades WHERE account_id = ? AND ts > ?').all(acct.id, SINCE)) {
    for (const d of JSON.parse(t.deltas)) applied.set(d.code, (applied.get(d.code) || 0) + d.delta);
  }
  const trailCount = db.prepare('SELECT COUNT(*) c FROM exchange_trades WHERE account_id = ? AND ts > ?').get(acct.id, SINCE).c;
  // TradesHistory as the venue reports it, through the app's own normalizer
  const venueTrades = await client.fetchTradesSince(SINCE);
  const venueNet = new Map();
  for (const t of venueTrades) for (const d of t.deltas) venueNet.set(d.code, (venueNet.get(d.code) || 0) + d.delta);
  const dbIds = new Set(db.prepare('SELECT venue_trade_id FROM exchange_trades WHERE account_id = ?').all(acct.id).map((r) => r.venue_trade_id));
  const missing = venueTrades.filter((t) => !dbIds.has(t.id));
  console.log(`\n== trades: venue=${venueTrades.length} db-applied=${trailCount} missing-from-db=${missing.length} ==`);
  for (const t of missing.slice(0, 8)) console.log(`  MISSING ${t.id} ${new Date(t.ts).toISOString().slice(0, 16)} ${t.pair} ${t.side} vol-deltas=${JSON.stringify(t.deltas)}`);

  console.log('\n== per-asset: ledger-trade-net vs TradesHistory-normalized net (fee-model check) ==');
  for (const a of ['pol', 'sc', 'usd', 'fil']) {
    const ledgerTrade = [...byAssetType.entries()].filter(([k]) => k.startsWith(a + '|trade')).reduce((s, [, v]) => s + v, 0);
    const th = venueNet.get(a) || 0;
    const ap = applied.get(a) || 0;
    console.log(`  ${a}: ledger=${+ledgerTrade.toFixed(8)}  normalized-TradesHistory=${+th.toFixed(8)}  db-applied=${+ap.toFixed(8)}  (ledger-vs-normalized diff=${+(ledgerTrade - th).toFixed(8)})`);
  }
  process.exit(0);
})().catch((e) => { console.error('probe failed:', e.message); process.exit(1); });
JS
