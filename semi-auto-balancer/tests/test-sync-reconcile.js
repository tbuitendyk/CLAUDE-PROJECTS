// Phase 1.5 reconciliation engine: trades apply with NO splice (the basket
// moves — the harvest registering), detected deposits/withdrawals wait as
// pending confirmations and splice exactly on confirm, venue balances are
// ground truth (dust snaps, real residuals surface, never silently applied),
// dedup by venue trade id, and applied trades re-arm notifications.
process.env.EXCHANGE_MARKET_DATA = 'off';
const { freshDb, ok, approx } = require('./helpers');
freshDb('sync');

const pricing = require('../lib/pricing');
let PRICES = { tether: 1, bitcoin: 50000 };
pricing.fetchUsdPrices = async () => PRICES;

const db = require('../lib/db');
const bal = require('../lib/balancer');
const sync = require('../lib/sync');

function profileRow(pid = 1) {
  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(pid);
}
function assetBySym(sym, pid = 1) {
  return db.prepare('SELECT * FROM assets WHERE profile_id = ? AND symbol = ?').get(pid, sym);
}
function basketNow(pid = 1) {
  const p = profileRow(pid);
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(pid);
  return bal.computeBasket(assets, p.basket_base);
}
function valueIndexNow(pid = 1) {
  const p = profileRow(pid);
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(pid);
  const iu = bal.indexUsdFor(assets, PRICES);
  const totalRel = assets.reduce((s, a) => {
    const pr = bal.priceAsset(a, iu, PRICES);
    return s + (pr ? a.quantity * pr.rel : 0);
  }, 0);
  return bal.computeValueIndex(p, totalRel);
}

// Stubbed venue client: the sync engine sees exactly this venue state.
const VENUE = { balances: [], trades: [], flows: [] };
const client = {
  venue: 'test',
  fetchBalances: async () => VENUE.balances,
  fetchTradesSince: async (since) => VENUE.trades.filter((t) => t.ts > since),
  fetchFlowsSince: async (since) => VENUE.flows.filter((f) => f.ts > since),
};

(async () => {
  const now = Date.now();
  db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('P', 10, 15, 0)").run();
  const add = db.prepare(
    'INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index, basket_units) VALUES (1, ?, ?, ?, ?, ?, ?)'
  );
  add.run('tether', 'usdt', 5000, 50, 1, 5000);
  add.run('bitcoin', 'btc', 0.1, 50, 0, 0.1);
  await bal.pollProfiles({ force: true }); // anchor value index at 1.0

  const account = sync.createAccount(1, 'kraken', 'test-key', 'test-secret');
  ok(account.last_trade_ts > 0, 'watermarks start at link time (no history replay)');
  // Rewind watermarks so the test fixtures (timestamped "now-ish") are seen.
  db.prepare('UPDATE exchange_accounts SET last_trade_ts = 1, last_ledger_ts = 1 WHERE id = ?').run(account.id);
  db.prepare("UPDATE profiles SET notify_state = 'notified', notify_state_at = ? WHERE id = 1").run(now);

  // --- A: a fill syncs in — quantities update, NO splice, re-armed ---
  VENUE.trades = [
    {
      id: 'T1', ts: now - 60_000, pair: 'XBT/USD', side: 'buy', price: 50000,
      cost: 1000, fee: 2.6, feeCurrency: 'usd', feePct: 0.26,
      deltas: [ { code: 'btc', delta: 0.02 }, { code: 'usdt', delta: -1002.6 } ],
      raw: {},
    },
  ];
  VENUE.balances = [ { code: 'btc', amount: 0.12 }, { code: 'usdt', amount: 3997.4 } ];
  const s1 = await sync.syncAccount(account.id, { client });
  ok(s1.tradesApplied === 1, 'one trade applied');
  ok(approx(assetBySym('btc').quantity, 0.12), 'btc quantity updated from the fill');
  ok(approx(assetBySym('usdt').quantity, 3997.4), 'usdt quantity nets cost + fee');
  ok(s1.unexplained.length === 0, 'balances fully explained by the trade');
  ok(db.prepare('SELECT COUNT(*) n FROM flows').get().n === 0, 'trades do NOT create flow splices');
  const basketAfterTrade = basketNow();
  ok(basketAfterTrade !== 1 && basketAfterTrade < 1, `trade moves the basket (fee drag: ${basketAfterTrade.toFixed(6)})`);
  ok(profileRow().notify_state === 'armed', 'applied fills re-arm notifications');
  ok(s1.feeObserved && approx(s1.feeObserved.feePct, 0.26) && s1.feeObserved.trades === 1, 'observed fee calibrated from the real fill');

  // --- B: replaying the same venue state is a no-op (watermark + dedup) ---
  const s2 = await sync.syncAccount(account.id, { client });
  ok(s2.tradesApplied === 0, 'same trade never applies twice');
  ok(approx(assetBySym('btc').quantity, 0.12), 'quantities unchanged on replay');

  // Force-replay past the watermark too: the UNIQUE(account, trade id) guard.
  db.prepare('UPDATE exchange_accounts SET last_trade_ts = 1 WHERE id = ?').run(account.id);
  const s2b = await sync.syncAccount(account.id, { client });
  ok(s2b.tradesApplied === 0, 'venue trade id dedup holds even if the watermark rewinds');

  // --- C: a deposit is detected -> pending (no quantity change), then
  // confirming applies the exact-amount splice at the venue timestamp ---
  const depositTs = now - 30_000;
  VENUE.flows = [ { id: 'L1', ts: depositTs, kind: 'deposit', code: 'btc', amount: 0.05, raw: {} } ];
  VENUE.balances = [ { code: 'btc', amount: 0.17 }, { code: 'usdt', amount: 3997.4 } ];
  const s3 = await sync.syncAccount(account.id, { client });
  ok(s3.newPendingFlows === 1, 'deposit detected as a pending flow');
  ok(approx(assetBySym('btc').quantity, 0.12), 'pending flow does NOT touch quantities');
  ok(s3.unexplained.length === 0, 'pending flow explains the balance diff (no unexplained residual)');

  const pending = db.prepare("SELECT * FROM pending_flows WHERE status = 'pending'").get();
  const basketBefore = basketNow();
  const viBefore = valueIndexNow();
  await sync.applyPendingFlow(pending.id);
  ok(approx(assetBySym('btc').quantity, 0.17), 'confirm applies the exact amount');
  ok(approx(basketNow(), basketBefore, 1e-9), 'basket continuous across the confirmed deposit (splice)');
  ok(approx(valueIndexNow(), viBefore, 1e-9), 'value index continuous across the confirmed deposit');
  const flowRow = db.prepare('SELECT * FROM flows ORDER BY id DESC LIMIT 1').get();
  ok(flowRow && flowRow.ts === depositTs, 'flow recorded with the venue\'s real timestamp');
  ok(db.prepare('SELECT status FROM pending_flows WHERE id = ?').get(pending.id).status === 'applied', 'pending flow marked applied');

  // --- D: an unexplained residual surfaces and is NOT applied ---
  VENUE.balances = [ { code: 'btc', amount: 0.3 }, { code: 'usdt', amount: 3997.4 } ];
  const s4 = await sync.syncAccount(account.id, { client });
  ok(s4.unexplained.length === 1 && s4.unexplained[0].symbol === 'btc', 'residual beyond tolerance surfaces as unexplained');
  ok(approx(assetBySym('btc').quantity, 0.17), 'unexplained residual is never silently applied');

  // --- E: dust inside tolerance snaps to the venue balance (ground truth) ---
  VENUE.balances = [ { code: 'btc', amount: 0.17000000234 }, { code: 'usdt', amount: 3997.4 } ];
  const s5 = await sync.syncAccount(account.id, { client });
  ok(s5.unexplained.length === 0 && s5.snapped.length === 1, 'dust residual snaps silently');
  ok(approx(assetBySym('btc').quantity, 0.17000000234, 1e-12), 'quantity snapped to the venue balance');

  // --- E2: float-noise residuals (< 1e-9) are ignored, not snapped ---
  VENUE.balances = [ { code: 'btc', amount: 0.17000000234 + 1e-13 }, { code: 'usdt', amount: 3997.4 } ];
  const s5b = await sync.syncAccount(account.id, { client });
  ok(s5b.snapped.length === 0 && s5b.unexplained.length === 0, 'sub-noise residual neither snaps nor surfaces');
  ok(assetBySym('btc').quantity === 0.17000000234, 'sub-noise residual leaves the stored quantity untouched');
  VENUE.balances = [ { code: 'btc', amount: 0.17000000234 }, { code: 'usdt', amount: 3997.4 } ];

  // --- F: venue currencies with no matching asset are reported, not guessed ---
  VENUE.balances = [ { code: 'btc', amount: 0.17000000234 }, { code: 'usdt', amount: 3997.4 }, { code: 'eth', amount: 1.5 } ];
  const s6 = await sync.syncAccount(account.id, { client });
  ok(s6.unmapped.includes('eth'), 'unmapped venue balance surfaces by code');

  // --- G: auto_flows applies detections immediately once trusted ---
  db.prepare('UPDATE exchange_accounts SET auto_flows = 1 WHERE id = ?').run(account.id);
  VENUE.flows.push({ id: 'L2', ts: now - 10_000, kind: 'withdrawal', code: 'usdt', amount: -500, raw: {} });
  VENUE.balances = [ { code: 'btc', amount: 0.17000000234 }, { code: 'usdt', amount: 3497.4 }, { code: 'eth', amount: 1.5 } ];
  const s7 = await sync.syncAccount(account.id, { client });
  ok(s7.autoAppliedFlows === 1, 'trusted account auto-applies the detected flow');
  ok(approx(assetBySym('usdt').quantity, 3497.4), 'withdrawal applied to the quantity');
  ok(profileRow().notify_state === 'armed', 'auto-applied flow re-arms too');

  // --- H: fresh profile (no value anchor, all quantities 0) adopts the
  // venue balances as its starting baseline instead of flagging the whole
  // account unexplained ---
  db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('Fresh', 10, 15, 0)").run();
  db.prepare(
    "INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index, basket_units) VALUES (2, 'tether', 'usdt', 0, 0, 1, 0), (2, 'bitcoin', 'btc', 0, 0, 0, 0)"
  ).run();
  const account2 = sync.createAccount(2, 'kraken', 'k2', 's2');
  const venue2 = { balances: [ { code: 'usdt', amount: 2500 }, { code: 'btc', amount: 0.08 } ], trades: [], flows: [] };
  const client2 = {
    venue: 'test',
    fetchBalances: async () => venue2.balances,
    fetchTradesSince: async () => venue2.trades,
    fetchFlowsSince: async () => venue2.flows,
  };
  const s8 = await sync.syncAccount(account2.id, { client: client2 });
  ok(s8.adopted.length === 2 && s8.unexplained.length === 0, 'fresh profile adopts venue balances (nothing unexplained)');
  ok(approx(assetBySym('btc', 2).quantity, 0.08) && approx(assetBySym('usdt', 2).quantity, 2500), 'starting quantities set from the venue');

  // A second sync has nothing left to adopt: balances reconcile normally.
  const s9 = await sync.syncAccount(account2.id, { client: client2 });
  ok(s9.adopted.length === 0 && s9.unexplained.length === 0, 'second sync reconciles normally (no re-adoption)');

  // --- I: assets added AFTER the first sync adopt too — per asset, through
  // the flow splice, so the value index never counts them as gains ---
  await bal.pollProfiles({ force: true, profileId: 2 }); // anchor the value index
  const viAnchored = valueIndexNow(2);
  ok(approx(viAnchored, 1, 1e-6), 'value index anchored after adoption');
  db.prepare(
    "INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index, basket_units) VALUES (2, 'fiat:mxn', 'mxn', 0, 0, 0, 0)"
  ).run();
  PRICES = { tether: 1, bitcoin: 50000, 'fiat:mxn': 0.055 };
  venue2.balances = [ { code: 'usdt', amount: 2500 }, { code: 'btc', amount: 0.08 }, { code: 'mxn', amount: 40000 } ];
  const s10 = await sync.syncAccount(account2.id, { client: client2 });
  ok(s10.adopted.length === 1 && s10.adopted[0].symbol === 'mxn', 'later-added asset adopts its venue balance');
  ok(approx(assetBySym('mxn', 2).quantity, 40000), 'adopted quantity lands');
  ok(s10.unexplained.length === 0, 'nothing unexplained after per-asset adoption');
  ok(approx(valueIndexNow(2), viAnchored, 1e-9), 'value index continuous across adoption (tracked via flow splice, not gains)');
  const adoptionFlow = db.prepare("SELECT * FROM flows WHERE profile_id = 2 ORDER BY id DESC LIMIT 1").get();
  ok(adoptionFlow && adoptionFlow.note.includes('baseline adoption'), 'adoption recorded as a flow');

  // --- J: a key without history permissions degrades gracefully — balances
  // still reconcile/adopt, the missing capability is reported, and the sync
  // does NOT hard-fail (Bitso gates reading fills behind its trading scope) ---
  const client3 = {
    venue: 'test',
    fetchBalances: async () => venue2.balances,
    fetchTradesSince: async () => {
      throw new Error('Bitso: API key has no permission to execute this method');
    },
    fetchFlowsSince: async () => {
      throw new Error('Bitso: API key has no permission to execute this method');
    },
  };
  const s11 = await sync.syncAccount(account2.id, { client: client3 });
  ok(s11.capability.trades !== 'ok' && s11.capability.flows !== 'ok', 'missing permissions reported per endpoint');
  ok(s11.unexplained.length === 0, 'balances still reconcile on a limited key');
  const acct2After = db.prepare('SELECT * FROM exchange_accounts WHERE id = ?').get(account2.id);
  ok(acct2After.last_sync_status === 'ok', 'limited sync completes instead of hard-failing');
  ok(JSON.parse(acct2After.last_sync_note).capability.trades.includes('no permission'), 'capability gap persisted for the UI warning');

  console.log('sync reconciliation tests pass');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
