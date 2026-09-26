// The trading accounts' keys on the new engine (LOOP-2026-09-25-ENGINE.md,
// item 7, S8), the reads the engine makes with them (stage C), and what they
// change for Paper Books: the account's own fee on every fill and the rate
// Binance quotes it for borrowing on every hour of a short.
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { KeyStore } = require('../engine/keystore');
const { BinanceAccount, keyVerdict } = require('../engine/venues/binance-account');

const API_KEY = 'vmPUZE6mv9SD5VNHk4HlWFsOr6aKE2zvsw0MuIgwCIPy6utIco14y7Ju91duEh8A';
const SECRET = 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'engine-keys-'));
const store = (dir, lines = []) => new KeyStore({ dir: path.join(dir, 'keys'), masterFile: path.join(dir, 'keystore.key'), record: (l) => lines.push(l), now: () => Date.UTC(2026, 8, 25, 9) }).open();

// a stand-in for Binance: checks the signature and the key header as Binance
// would, and answers what the test says it answers
function fakeBinance(answers, seen = []) {
  return async (method, url, opts = {}) => {
    const u = new URL(url);
    seen.push({ method, path: u.pathname, header: (opts.headers || {})['X-MBX-APIKEY'] || null, query: u.search });
    if (u.pathname === '/api/v3/time') return { status: 200, json: { serverTime: Date.UTC(2026, 8, 25, 9) + 1500 }, ms: 3 };
    const q = u.search.slice(1);
    const i = q.lastIndexOf('&signature=');
    const good = crypto.createHmac('sha256', SECRET).update(q.slice(0, i)).digest('hex');
    if (i < 0 || q.slice(i + 11) !== good || (opts.headers || {})['X-MBX-APIKEY'] !== API_KEY) return { status: 401, json: { code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' }, ms: 5 };
    const a = answers[u.pathname];
    return a ? { status: 200, json: typeof a === 'function' ? a(u.searchParams) : a, ms: 7 } : { status: 404, json: { code: -1, msg: 'no such path' }, ms: 2 };
  };
}

module.exports = {
  // S8: ENCRYPTED AT REST, NEVER HANDED BACK. The file on disk holds neither half
  // of the key; the list says present or missing and when; a file copied under
  // another account's name does not open; the store's own key is readable by the
  // engine's user alone, and one that others can read is refused.
  theKeysAreStoredEncryptedAndNeverHandedBack() {
    const dir = tmp();
    const lines = [];
    try {
      const ks = store(dir, lines);
      assert.strictEqual(fs.statSync(path.join(dir, 'keystore.key')).mode & 0o777, 0o600, 'the store\'s own key is the engine user\'s alone');
      const got = ks.put('ltc-1', { apiKey: API_KEY, secret: SECRET });
      assert.deepStrictEqual(got, { account: 'ltc-1', present: true, addedAt: '2026-09-25T09:00:00.000Z', anyAddress: false, tied: null });
      const onDisk = fs.readFileSync(path.join(dir, 'keys', 'ltc-1.key'), 'utf8');
      assert.ok(!onDisk.includes(API_KEY) && !onDisk.includes(SECRET), 'neither half of the key is on disk as it was typed');
      assert.strictEqual(fs.statSync(path.join(dir, 'keys', 'ltc-1.key')).mode & 0o777, 0o600);
      assert.deepStrictEqual(ks.list(), [{ account: 'ltc-1', present: true, addedAt: '2026-09-25T09:00:00.000Z', anyAddress: false, tied: null }]);
      // the owner's choice about addresses, and what the exchange said, kept beside the keys
      assert.deepStrictEqual(ks.put('ltc-open', { apiKey: API_KEY, secret: SECRET }, { anyAddress: true, tied: false }), { account: 'ltc-open', present: true, addedAt: '2026-09-25T09:00:00.000Z', anyAddress: true, tied: false });
      ks.remove('ltc-open');
      assert.deepStrictEqual(ks.describe('other'), { account: 'other', present: false });
      // the secret signs here and never leaves: the signature is the one Binance expects
      const sg = ks.signer('ltc-1', 'a read');
      assert.strictEqual(sg.header(), API_KEY);
      assert.strictEqual(sg.sign('symbol=LTCUSDT&timestamp=1'), crypto.createHmac('sha256', SECRET).update('symbol=LTCUSDT&timestamp=1').digest('hex'));
      assert.ok(!Object.values(sg).some((v) => v === SECRET), 'the signer holds no field with the secret in it');
      // every use written down, and no line carries either half
      assert.deepStrictEqual(lines.map((l) => [l.what, l.account]), [['entered', 'ltc-1'], ['entered', 'ltc-open'], ['removed', 'ltc-open'], ['used', 'ltc-1']]);
      assert.ok(!JSON.stringify(lines).includes(API_KEY) && !JSON.stringify(lines).includes(SECRET), 'no record carries the key');
      // a file copied under another account's name does not open
      fs.copyFileSync(path.join(dir, 'keys', 'ltc-1.key'), path.join(dir, 'keys', 'thief.key'));
      let threw = null;
      try { ks.signer('thief', 'a read'); } catch (e) { threw = e; }
      assert.ok(threw, 'a key file under another account\'s name does not open');
      // replaced, then removed
      ks.put('ltc-1', { apiKey: API_KEY, secret: SECRET });
      assert.strictEqual(lines[lines.length - 1].what, 'replaced');
      assert.deepStrictEqual(ks.remove('ltc-1'), { account: 'ltc-1', present: false });
      assert.strictEqual(fs.existsSync(path.join(dir, 'keys', 'ltc-1.key')), false);
      // refused in words
      const bad = (fn, re) => { let e = null; try { fn(); } catch (x) { e = x; } assert.ok(e && re.test(e.message), e && e.message); };
      bad(() => ks.put('../escape', { apiKey: API_KEY, secret: SECRET }), /a trading account is named with/);
      bad(() => ks.put('ltc-1', { apiKey: API_KEY }), /both halves of the key are needed/);
      bad(() => ks.signer('ltc-1', 'x'), /no keys are stored for the trading account ltc-1/);
      // a store whose own key other users can read is refused
      fs.chmodSync(path.join(dir, 'keystore.key'), 0o644);
      bad(() => store(dir), /can be read by other users on this machine/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  },

  // THE READS, signed as Binance checks them: the fee, the hourly borrowing rate,
  // the isolated wallet, the open orders, what the key may do -- and a refusal
  // in Binance's own words
  async theAccountReadsAreSignedAndAnsweredInBinancesWords() {
    const dir = tmp();
    try {
      const ks = store(dir);
      ks.put('ltc-1', { apiKey: API_KEY, secret: SECRET });
      const seen = [];
      const request = fakeBinance({
        '/sapi/v1/asset/tradeFee': [{ symbol: 'LTCUSDT', makerCommission: '0.001', takerCommission: '0.001' }],
        '/sapi/v1/margin/next-hourly-interest-rate': [{ asset: 'LTC', nextHourlyInterestRate: '0.00000842' }],
        '/sapi/v1/margin/isolated/account': { assets: [{ symbol: 'LTCUSDT', baseAsset: { asset: 'LTC', free: '1.2', locked: '0', borrowed: '0.5', interest: '0.0001', netAsset: '0.6999' }, quoteAsset: { asset: 'USDT', free: '80', locked: '5', borrowed: '0', interest: '0', netAsset: '85' }, marginLevel: '3.2', tradeEnabled: true }] },
        '/sapi/v1/margin/openOrders': [],
        '/sapi/v1/account/apiRestrictions': { ipRestrict: true, enableWithdrawals: false, enableInternalTransfer: false, permitsUniversalTransfer: false, enableMargin: true, enableSpotAndMarginTrading: true, enableReading: true },
      }, seen);
      const acc = new BinanceAccount({ signer: ks.signer('ltc-1', 'reads'), request, now: () => Date.UTC(2026, 8, 25, 9) });
      assert.deepStrictEqual((await acc.syncClock()).offsetMs, 1500, 'the clock is set to Binance\'s before anything is signed');
      const fee = await acc.fee('LTCUSDT');
      assert.deepStrictEqual([fee.ok, fee.maker, fee.taker], [true, 0.001, 0.001]);
      const rate = await acc.hourlyRate('LTC');
      assert.deepStrictEqual([rate.ok, rate.rate], [true, 0.00000842]);
      const w = await acc.isolatedWallet('LTCUSDT');
      assert.deepStrictEqual([w.base.borrowed, w.quote.locked, w.marginLevel], [0.5, 5, 3.2]);
      assert.deepStrictEqual((await acc.openOrders('LTCUSDT')).orders, []);
      const rs = await acc.restrictions();
      assert.deepStrictEqual(keyVerdict(rs), { ok: true, refusals: [], tied: true });
      assert.ok(seen.filter((x) => x.path !== '/api/v3/time').every((x) => x.method === 'GET' && x.header === API_KEY), 'every read is a GET carrying the public half');
      assert.ok(seen.every((x) => !x.query.includes(SECRET)), 'the secret never travels');
      assert.ok(/timestamp=1790326801500/.test(seen[1].query), 'signed on Binance\'s clock');
      // a key Binance refuses: its words, not a guess
      const wrong = new BinanceAccount({ signer: { header: () => 'another', sign: () => 'bad' }, request, now: () => Date.UTC(2026, 8, 25, 9) });
      const no = await wrong.fee('LTCUSDT');
      assert.deepStrictEqual([no.ok, no.why], [false, 'Binance answered 401 (-2015): Invalid API-key, IP, or permissions for action.']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  },

  // ITEM 7: a key the engine keeps can trade and borrow and can move no money
  aKeyThatCanMoveMoneyOrIsNotLockedIsRefusedInWords() {
    const good = { ipRestrict: true, enableWithdrawals: false, enableInternalTransfer: false, permitsUniversalTransfer: false, enableMargin: true, enableSpotAndMarginTrading: true };
    assert.deepStrictEqual(keyVerdict(good), { ok: true, refusals: [], tied: true });
    assert.deepStrictEqual(keyVerdict({ ...good, enableWithdrawals: true, ipRestrict: false }).refusals, ['it allows withdrawals', 'it is open to any address, and "these keys may trade from any address" was not ticked']);
    // TIED TO ONE ADDRESS IS THE OWNER'S CHOICE (owner, 2026-09-25): ticked, a key open to any address is kept
    assert.deepStrictEqual(keyVerdict({ ...good, ipRestrict: false }, { anyAddress: true }), { ok: true, refusals: [], tied: false });
    // and the tick never excuses a key that can move money
    assert.deepStrictEqual(keyVerdict({ ...good, ipRestrict: false, enableWithdrawals: true }, { anyAddress: true }).refusals, ['it allows withdrawals']);
    assert.deepStrictEqual(keyVerdict({ ...good, enableMargin: false }).refusals, ['it cannot borrow on margin, so it cannot open a short']);
    assert.deepStrictEqual(keyVerdict({ ...good, enableSpotAndMarginTrading: false, enableInternalTransfer: true, permitsUniversalTransfer: true }).refusals, ['it allows transfers between accounts', 'it allows universal transfers', 'it cannot trade']);
  },

  // THE KEYS THROUGH THE ENGINE (owner, 2026-09-25): they arrive locked in the
  // browser with this engine's lock and only locked; they are asked of the
  // exchange BEFORE they are kept, so a refused key is never written down; no
  // answer ever carries them
  async theEngineTakesKeysAndNeverAnswersWithThem() {
    const { makeServer } = require('../engine/api');
    const { Journal } = require('../engine/journal');
    const { Lock } = require('../engine/lock');
    const { lockKeys } = require('../public/keylock');
    const dir = tmp();
    const journal = new Journal(path.join(dir, 'journal.jsonl'));
    const ks = new KeyStore({ dir: path.join(dir, 'keys'), masterFile: path.join(dir, 'keystore.key'), record: (l) => journal.append(l) }).open();
    const lock = new Lock(path.join(dir, 'lock.json')).open();
    let verdict = { checked: true, ok: true, refusals: [], tied: true };
    const asked = [];
    const server = makeServer({ runner: { view: () => [] }, journal, health: () => ({ ok: true }), keystore: ks, lock, checkKey: async (account, pair, opts) => { asked.push([account, pair.apiKey === API_KEY, ks.describe(account).present, opts.anyAddress]); return verdict; } });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const target = { localPort: server.address().port };
    const link = require('../lib/live/enginelink');
    const pub = lock.info().publicKey;
    try {
      const put = await link.call(target, 'POST', '/keys/ltc-1', { locked: await lockKeys(pub, 'ltc-1', API_KEY, SECRET) });
      assert.ok(put.ok && put.json.present === true && put.json.checked === true && put.json.tied === true, JSON.stringify(put.json));
      assert.deepStrictEqual(asked[0], ['ltc-1', true, false, false], 'the exchange is asked before the keys are kept');
      const listed = await link.call(target, 'GET', '/keys');
      assert.deepStrictEqual(listed.json.keys.map((k) => [k.account, k.present]), [['ltc-1', true]]);
      assert.deepStrictEqual(listed.json.lock, lock.info(), 'the engine says what its lock is: the public half and its fingerprint');
      assert.ok(![JSON.stringify(put.json), JSON.stringify(listed.json)].some((t) => t.includes(API_KEY) || t.includes(SECRET)), 'no answer carries the key');
      // unlocked, they are refused: nothing on the way may be able to read them
      const plain = await link.call(target, 'POST', '/keys/ltc-9', { apiKey: API_KEY, secret: SECRET });
      assert.deepStrictEqual([plain.status, plain.json.error], [400, 'keys are taken only locked with this engine\'s lock: nothing on the way here may be able to read them']);
      // locked for one account, they do not open under another's name
      const swapped = await link.call(target, 'POST', '/keys/ltc-8', { locked: await lockKeys(pub, 'ltc-1', API_KEY, SECRET) });
      assert.deepStrictEqual([swapped.status, /could not be opened by this engine/.test(swapped.json.error)], [400, true]);
      // locked with another engine's lock, they do not open here
      const other = new Lock(path.join(dir, 'other-lock.json')).open();
      const elsewhere = await link.call(target, 'POST', '/keys/ltc-7', { locked: await lockKeys(other.info().publicKey, 'ltc-7', API_KEY, SECRET) });
      assert.deepStrictEqual(elsewhere.status, 400);
      verdict = { checked: true, ok: false, refusals: ['it allows withdrawals'], tied: true };
      const refused = await link.call(target, 'POST', '/keys/ltc-2', { locked: await lockKeys(pub, 'ltc-2', API_KEY, SECRET) });
      assert.deepStrictEqual([refused.status, refused.json.error], [400, 'the keys were not kept: it allows withdrawals']);
      assert.deepStrictEqual(ks.describe('ltc-2'), { account: 'ltc-2', present: false }, 'a key that can move money is not kept');
      // the owner's tick travels with the keys to the check and is kept beside them
      verdict = { checked: true, ok: true, refusals: [], tied: false };
      const open = await link.call(target, 'POST', '/keys/ltc-5', { locked: await lockKeys(pub, 'ltc-5', API_KEY, SECRET), anyAddress: true });
      assert.deepStrictEqual([open.json.present, open.json.anyAddress, open.json.tied, asked[asked.length - 1][3]], [true, true, false, true]);
      verdict = { checked: false, why: 'Binance did not answer: timeout' };
      const unchecked = await link.call(target, 'POST', '/keys/ltc-3', { locked: await lockKeys(pub, 'ltc-3', API_KEY, SECRET) });
      assert.deepStrictEqual([unchecked.json.present, unchecked.json.checked, unchecked.json.why], [true, false, 'Binance did not answer: timeout'], 'kept, and said to be unchecked');
      const bad = await link.call(target, 'POST', '/keys/ltc-4', { locked: await lockKeys(pub, 'ltc-4', 'short', SECRET) });
      assert.deepStrictEqual([bad.status, bad.json.error], [400, 'both halves of the key are needed, each 16 to 256 characters with no spaces']);
      const gone = await link.call(target, 'POST', '/keys/ltc-1/delete', {});
      assert.deepStrictEqual(gone.json, { account: 'ltc-1', present: false });
      const rec = fs.readFileSync(path.join(dir, 'journal.jsonl'), 'utf8');
      assert.ok(/"what":"entered"/.test(rec) && /"what":"removed"/.test(rec), 'every entry and removal is written down');
      assert.ok(!rec.split('\n').filter(Boolean).map((l) => JSON.parse(l)).some((l) => l.what === 'entered' && l.account === 'ltc-2'), 'a refused key is never entered: it was never kept');
      assert.ok(!rec.includes(SECRET) && !rec.includes(API_KEY), 'the engine\'s record never holds the key');
    } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  },

  // THE LOCK IS THE ENGINE'S ALONE (3.266.0): made once, readable by the engine's
  // user only, refused when others can read it; its private half is never in
  // anything it hands out
  theLockIsTheEnginesAloneAndNeverLeaves() {
    const { Lock } = require('../engine/lock');
    const dir = tmp();
    try {
      const f = path.join(dir, 'lock.json');
      const l = new Lock(f).open();
      assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
      const priv = JSON.parse(fs.readFileSync(f, 'utf8')).privateKey;
      assert.ok(!JSON.stringify(l.info()).includes(priv), 'what the lock says of itself holds no private half');
      assert.deepStrictEqual(new Lock(f).open().info(), l.info(), 'made once: opened again, the same lock');
      fs.chmodSync(f, 0o644);
      assert.throws(() => new Lock(f).open(), /can be read by other users on this machine; it is refused/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  },

  // ITEM 5 AND D7 ON PAPER: a plan whose trading account has keys pays that
  // account's own fee on every fill and owes, on every hour of a short, the rate
  // Binance quotes that account; a plan without pays the setup's fee and its
  // borrowing is written down unpriced -- never guessed
  async aPaperPlanPaysItsAccountsFeeAndBorrowingRate() {
    const { Journal } = require('../engine/journal');
    const { Runner } = require('../engine/runner');
    const { SimulatedExchange } = require('../engine/venues/simulated');
    const dir = tmp();
    const H = 3600000;
    const t0 = Date.UTC(2026, 8, 26, 1);
    let now = t0;
    const market = {
      followed: new Set(), follow(x) { market.followed = new Set(x); },
      book: () => ({ bids: [[69.9, 50]], asks: [[70, 50]], ts: now }), trade: () => ({ price: 69.9, ts: now }),
      filtersOf: async () => ({ tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 5, baseAsset: 'LTC', quoteAsset: 'USDT' }),
      hourOpenOf: async () => null, minutes: async () => [], status: () => ({ connected: true }),
    };
    const reader = { venue: 'Binance', syncClock: async () => ({ ok: true }), fee: async () => ({ ok: true, maker: 0.00075, taker: 0.00075 }), hourlyRate: async (asset) => ({ ok: true, asset, rate: 0.00001 }) };
    const journal = new Journal(path.join(dir, 'journal.jsonl'));
    const runner = new Runner({ journal, market, venues: { simulated: new SimulatedExchange({ market, feePerLeg: 0.002, now: () => now }) }, accounts: (a) => { if (a !== 'ltc-1') { const e = new Error(`no keys are stored for the trading account ${a}`); e.code = 'NO_KEYS'; throw e; } return reader; }, now: () => now });
    const plan = (id, account) => ({ planId: id, setupId: 's', account, mode: 'simulated', symbol: 'LTCUSDT', entryTs: t0, call: -1, cell: { entry: 'market', gate: 'directional', dMult: null, tHours: 65, trailMult: null, armMult: null }, bandPct: 5, size: { quoteUsd: 100 }, feePerLeg: 0.00125 });
    try {
      runner.addPlan(plan('with-keys', 'ltc-1'));
      runner.addPlan(plan('no-account', null));
      runner.addPlan(plan('no-keys', 'ltc-9'));
      await new Promise((r) => setTimeout(r, 30));   // the account's facts, read as the plan arrives
      runner.onKline({ symbol: 'LTCUSDT', openTime: t0, open: 70 });
      for (let i = 0; i < 50 && ['with-keys', 'no-account', 'no-keys'].some((id) => runner.plans.get(id).state.phase !== 'open'); i++) await new Promise((r) => setTimeout(r, 20));
      const fillOf = (id) => runner.plans.get(id).ledger.entry;
      now = t0 + 2 * H + 1000;
      runner.tick();
      await new Promise((r) => setTimeout(r, 50));
      now = t0 + 3 * H + 1000;
      runner.tick();
      await new Promise((r) => setTimeout(r, 50));
      const e1 = fillOf('with-keys');
      const e2 = fillOf('no-account');
      assert.strictEqual(e2.against.feeSource, 'the setup');
      assert.ok(Math.abs(e2.feeUsd - e2.price * e2.qty * 0.00125) < 1e-12, 'no account: the setup\'s fee');
      assert.strictEqual(e1.against.feeSource, 'Binance, the taker fee quoted to ltc-1');
      assert.ok(Math.abs(e1.feeUsd - e1.price * e1.qty * 0.00075) < 1e-12, 'the account\'s own fee, read before the entry');
      assert.strictEqual(fillOf('no-keys').against.feeSource, 'the setup', 'no keys: the setup\'s fee');
      const ledger = runner.plans.get('with-keys').ledger;
      const priced = ledger.interestHours.filter((h) => h.rate != null);
      assert.ok(priced.length >= 1 && priced.every((h) => h.rate === 0.00001 && /Binance, the hourly rate quoted to ltc-1/.test(h.source)), JSON.stringify(ledger.interestHours));
      assert.ok(runner.plans.get('no-account').ledger.interestHours.every((h) => h.rate == null), 'no account: each hour unpriced');
      assert.ok(runner.plans.get('no-keys').ledger.interestHours.every((h) => h.rate == null), 'no keys: each hour unpriced');
      const facts = [...journal.readAll()].filter((l) => l.type === 'account');
      assert.ok(facts.some((l) => l.account === 'ltc-9' && /no keys are stored for the trading account ltc-9/.test(l.why)), 'the missing key is said, in words');
      assert.ok(facts.some((l) => l.account === 'ltc-1' && l.fee && l.fee.taker === 0.00075 && l.rate && l.rate.rate === 0.00001));
      // the next order on the account with keys pays the account's taker fee
      const fee = runner.feeOf(runner.plans.get('with-keys').plan);
      assert.deepStrictEqual(fee, { feePerLeg: 0.00075, source: 'Binance, the taker fee quoted to ltc-1' });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  },
};
