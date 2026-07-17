// Phase 1.5 venue normalization: Kraken asset-code/pair/trade/ledger mapping
// and Bitso trade/flow mapping into the app's normalized shapes. Pure
// functions with injected metadata — no network.
process.env.EXCHANGE_MARKET_DATA = 'off';
const { freshDb, ok, approx } = require('./helpers');
freshDb('normalize');

const kraken = require('../lib/exchanges/kraken');
const bitso = require('../lib/exchanges/bitso');

kraken._setMetaForTest(
  { XXBT: 'XBT', ZUSD: 'USD', XETH: 'ETH', USDT: 'USDT' },
  {
    XXBTZUSD: { base: 'XXBT', quote: 'ZUSD', wsname: 'XBT/USD', altname: 'XBTUSD' },
    USDTZUSD: { base: 'USDT', quote: 'ZUSD', wsname: 'USDT/USD', altname: 'USDTUSD' },
  }
);

// --- Kraken balance-code normalization ---
ok(kraken.normalizeCode('XXBT') === 'btc', 'XXBT -> btc (altname + alias)');
ok(kraken.normalizeCode('ZUSD') === 'usd', 'ZUSD -> usd');
ok(kraken.normalizeCode('XBT.F') === 'btc', 'earn sub-balance XBT.F -> btc');
ok(kraken.normalizeCode('ETH2.S') === 'eth', 'staked ETH2.S -> eth');
ok(kraken.normalizeCode('USDT') === 'usdt', 'USDT passes through');

// --- Kraken trade -> deltas (fee charged in the quote currency) ---
const buy = kraken.normalizeTrade('T1', {
  pair: 'XXBTZUSD', time: 1720000000.123, type: 'buy',
  price: '50000', cost: '1000', fee: '2.6', vol: '0.02',
});
ok(buy.ts === 1720000000123, 'trade time (float seconds) -> ms');
ok(buy.pair === 'XBT/USD' && buy.side === 'buy', 'pair resolves to wsname');
const bBase = buy.deltas.find((d) => d.code === 'btc');
const bQuote = buy.deltas.find((d) => d.code === 'usd');
ok(approx(bBase.delta, 0.02), 'buy: base +vol');
ok(approx(bQuote.delta, -1002.6), 'buy: quote -cost -fee');
ok(approx(buy.feePct, 0.26), 'feePct = fee/cost');

const sell = kraken.normalizeTrade('T2', {
  pair: 'XBTUSD', time: 1720000001, type: 'sell',
  price: '50000', cost: '1000', fee: '2.6', vol: '0.02',
});
ok(approx(sell.deltas.find((d) => d.code === 'btc').delta, -0.02), 'sell: base -vol');
ok(approx(sell.deltas.find((d) => d.code === 'usd').delta, 997.4), 'sell: quote +cost -fee');
ok(sell.pair === 'XBT/USD', 'altname pair (XBTUSD) also resolves');

// --- Kraken ledger flow (amount signed by venue; fee nets out) ---
const wd = kraken.normalizeLedgerFlow('L1', {
  time: 1720000002, type: 'withdrawal', asset: 'XXBT', amount: '-0.5', fee: '0.0001',
});
ok(wd.code === 'btc' && approx(wd.amount, -0.5001), 'withdrawal: amount - fee, normalized code');
const dep = kraken.normalizeLedgerFlow('L2', {
  time: 1720000003, type: 'deposit', asset: 'ZUSD', amount: '1000', fee: '0',
});
ok(dep.code === 'usd' && approx(dep.amount, 1000) && dep.kind === 'deposit', 'deposit maps straight through');

// --- Bitso trade -> deltas (major/minor arrive signed; fee separate) ---
const bt = bitso.normalizeTrade({
  book: 'btc_mxn', major: '0.02', minor: '-20000', price: '1000000',
  fees_amount: '0.0001', fees_currency: 'btc', side: 'buy',
  created_at: '2026-07-01T00:00:00+00:00', tid: 123,
});
ok(bt.id === '123' && bt.ts === Date.parse('2026-07-01T00:00:00+00:00'), 'tid + created_at normalized');
ok(approx(bt.deltas.find((d) => d.code === 'mxn').delta, -20000), 'minor delta passes through signed');
const btcDeltas = bt.deltas.filter((d) => d.code === 'btc');
ok(approx(btcDeltas.reduce((s, d) => s + d.delta, 0), 0.0199), 'major + separate fee delta net out');
ok(approx(bt.feePct, 0.5), 'fee in base currency -> % of major');

const bs = bitso.normalizeTrade({
  book: 'btc_mxn', major: '-0.02', minor: '20000', price: '1000000',
  fees_amount: '130', fees_currency: 'mxn', side: 'sell',
  created_at: '2026-07-01T01:00:00+00:00', tid: 124,
});
ok(approx(bs.feePct, 0.65), 'fee in quote currency -> % of minor');

// --- Bitso fundings/withdrawals ---
const bd = bitso.normalizeFlow('deposit', { fid: 'f1', currency: 'MXN', amount: '5000', created_at: '2026-07-02T00:00:00+00:00' });
ok(bd.id === 'f1' && bd.code === 'mxn' && approx(bd.amount, 5000), 'funding -> +amount');
const bw = bitso.normalizeFlow('withdrawal', { wid: 'w1', currency: 'btc', amount: '0.25', created_at: '2026-07-02T01:00:00+00:00' });
ok(bw.id === 'w1' && approx(bw.amount, -0.25), 'withdrawal -> -amount');

console.log('exchange normalization tests pass');
