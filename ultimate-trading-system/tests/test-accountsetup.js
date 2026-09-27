// SETTING UP A TRADING ACCOUNT, STEP BY STEP (3.268.0, owner 2026-09-26: "we're
// going to follow the same build while setting-up pattern with a new account
// set-up on Binance"): the checklist kept on each trading account's record, its
// step 1 in full and the rest still being written, and the Account tab that draws
// it with the same code as a platform's checklist on the Compute tab. Step 2 (3.273.0,
// owner 2026-09-27: "code step 2"): the key, made to the rules the platform keeps a
// key by.
const { assert } = require('./helpers');
const fs = require('fs');
const path = require('path');

const SETTINGS = path.join(__dirname, '..', 'data', 'settings.json');
const refused = (fn, rx) => { let err = null; try { fn(); } catch (e) { err = e; } assert.ok(err && rx.test(err.message), `refused in words matching ${rx}: ${err && err.message}`); return err; };

// THE REAL FILE IS THE OWNER'S AND IS NEVER WRITTEN BY A TEST (as tests/test-account.js)
function onACleanFile(body) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  const had = fs.existsSync(SETTINGS);
  const parked = `${SETTINGS}.testparked${process.pid}`;
  if (had) fs.renameSync(SETTINGS, parked);
  for (const m of ['../lib/account', '../lib/accountsetup']) delete require.cache[require.resolve(m)];
  try {
    return body(require('../lib/accountsetup'), require('../lib/account'));
  } finally {
    try { fs.unlinkSync(SETTINGS); } catch (_) { /* it may not have been written */ }
    if (had) fs.renameSync(parked, SETTINGS);
    for (const m of ['../lib/account', '../lib/accountsetup']) delete require.cache[require.resolve(m)];
  }
}

module.exports = {
  // THE TEMPLATE: every step written (steps 3 to 6 in 3.275.0)
  theAccountTemplateHasEveryStepWritten() {
    const as = require('../lib/accountsetup');
    const [first, ...rest] = as.TEMPLATE.steps;
    assert.strictEqual(first.title, 'The exchange account');
    assert.deepStrictEqual(first.choices.map((c) => [c.id, c.label, c.options.map((o) => o.label)]), [
      ['kind', 'Which account', ['the main account', 'a sub-account']],
      ['margin', 'Margin', ['isolated — each coin pair its own pot', 'cross — one pot for the whole account']],
    ]);
    assert.deepStrictEqual(first.ticks.map((t) => t.label), ['The account exists on the exchange', 'Margin trading is switched on for it']);
    // WHAT THE EXCHANGE CALLS THE SUB-ACCOUNT (3.274.0): one line, 200 characters, asked for a sub-account only
    assert.deepStrictEqual(first.fields.map((f) => [f.id, f.label, f.when, f.after, f.max]), [['subIds', 'Exchange\'s sub-account identifier(s)', { kind: 'sub' }, 'kind', 200]]);
    // THE POT (owner, 2026-09-26): one pair funded once in every account, each pot apart
    const words = JSON.stringify(first.guidance);
    for (const w of ['your main account, or one of its sub-accounts', 'its own money, its own borrowing and its own liquidation', 'The same pair can be funded once in every account you keep', 'two setups on the same pair need an account each', 'The whole account is one pot']) assert.ok(words.includes(w), `step 1 says ${w}`);
    // STEP 2, THE KEY: one choice, four ticks, and the words that say what the key must be
    const [second, ...later] = rest;
    assert.strictEqual(second.title, 'The API key');
    assert.ok(!second.writing, 'step 2 is written');
    assert.deepStrictEqual(second.choices.map((c) => [c.id, c.label, c.options.map((o) => o.label)]), [
      ['address', 'Where it may trade from', ['tied to one or more addresses — the machine(s) the trading platform runs on', 'open to any address']],
    ]);
    assert.deepStrictEqual(second.ticks.map((t) => t.label), ['The key is made for this account, as an API key and a secret key', 'It can trade and borrow on margin',
      'It cannot withdraw money or transfer it to another account', 'Where it may trade from is set on the exchange as chosen above']);
    const two = JSON.stringify(second.guidance);
    for (const w of ['an API key and a secret key', 'it cannot sign with the other kind', 'shows the secret key only once', 'borrow on margin: without borrowing it cannot open a short',
      'withdrawals, and transfers to other accounts', 'Make the key for the sub-account itself', 'the public address of each machine the trading platform runs on',
      'never to take money out of it']) assert.ok(two.includes(w), `step 2 says ${w}`);
    // each block the address choice shows, and both while it is unmade, as step 1 does for margin
    assert.deepStrictEqual(second.guidance.filter((b) => b.when && b.when.address).map((b) => [b.heading, b.when.address, b.ifUnset]), [['Tied to one or more addresses', 'tied', true], ['Open to any address', 'any', true]]);
    // STEPS 3 TO 6: each done by what the system sees for itself, and a tick only where the owner alone can check
    assert.deepStrictEqual(later.map((s) => [s.id, s.title, !!s.writing, s.needs, (s.ticks || []).map((t) => t.label)]), [
      ['keys', 'The keys go to their platform', false, ['keys'], ['The fingerprint of the platform\'s lock matched the one its machine printed']],
      ['reads', 'The platform reads the account', false, ['checked'], []],
      ['setup', 'A setup trades from it', false, ['named'], []],
      ['money', 'Real money on', false, ['live'], ['The pot holds only what the setups trading from it may lose']],
    ]);
    const rest4 = JSON.stringify(later);
    for (const w of ['tick each trading platform that should hold them', 'the command that prints the machine\'s own copy on that machine', 'press Send the keys to the ticked platforms',
      'ask the exchange what the key may do, before it keeps them', 'In this release it does not read how much is in the pot', 'this release has no reading of the cross rate',
      'its Sub-account key holds this account\'s name', 'in the setup\'s Setup detail, and kept with Save', 'press Activate real for its config on Greenlights',
      'In this release the trading platform places no real orders', 'this step cannot be done']) assert.ok(rest4.includes(w), `steps 3 to 6 say ${w}`);
    // a checklist never takes a key: every choice is one of its options and every tick is on or off
    for (const st of as.TEMPLATE.steps) assert.ok(Object.keys(st).every((k) => ['id', 'title', 'guidance', 'choices', 'fields', 'ticks', 'needs', 'panel', 'writing'].includes(k)), `step ${st.id} holds nothing unexpected`);
    assert.strictEqual(later[0].panel, 'locks', 'step 3 draws each platform\'s lock');
    assert.ok(as.TEMPLATE.steps.every((st) => !st.writing), 'no step is still being written');
    for (const st of as.TEMPLATE.steps) for (const n of st.needs || []) assert.strictEqual(typeof as.NEEDS[n], 'function', `step ${st.id} needs ${n}, which nothing answers`);
    // the one box of text there is asks for no key, and says so
    assert.ok(/never a key or a password/.test(first.fields[0].note) && !/api ?key|secret/i.test(first.fields[0].label), 'the identifiers box invites no key');
    // THE EXCHANGE IS THE OWNER'S CHOICE: Binance at most an example; and never a key asked for or kept
    const all = JSON.stringify(as.TEMPLATE.steps);
    for (const m of all.match(/[^.]*Binance[^.]*/g) || []) assert.ok(/for example/.test(m), `Binance named only as an example: ${m}`);
    assert.ok(!/api ?key[^s]|secret/i.test(JSON.stringify(first)), 'step 1 asks for no key');
  },

  // ONE PER ACCOUNT, kept on its record: started under a new name (which makes the
  // record) or an existing one; each step opens only when the one before is done
  aChecklistIsKeptOnItsAccountAndOpensStepByStep() {
    onACleanFile((as, acc) => {
      const a = as.start('binance-sub-1', 'binance');
      assert.deepStrictEqual([a.id, a.exchange, a.setup.steps.map((s) => [s.open, s.done])], ['binance-sub-1', 'binance', [[true, false], [false, false], [false, false], [false, false], [false, false], [false, false]]]);
      assert.ok(acc.tradingAccount('binance-sub-1'), 'a name no record had makes the record');
      refused(() => as.start('binance-sub-1', 'binance'), /already a setup for the trading account binance-sub-1 — one per account/);
      refused(() => as.start('no spaces', 'binance'), /letters, digits, dot, dash and underscore/);
      refused(() => as.start('x2', 'nowhere'), /is not an exchange this system knows/);
      // an account saved by hand first takes a checklist under its own name
      acc.saveTradingAccount({ id: 'main', exchange: 'binance', note: 'the main account' });
      assert.strictEqual(as.start('main', 'binance').note, 'the main account');
      // step 1
      refused(() => as.setTick('binance-sub-1', 'key', 'x', true), /^step 2 opens when step 1 is done$/);
      refused(() => as.setChoice('binance-sub-1', 'account', 'margin', 'sideways'), /margin: one of isolated/);
      refused(() => as.setTick('binance-sub-1', 'account', 'nope', true), /has no tick nope/);
      as.setChoice('binance-sub-1', 'account', 'kind', 'sub');
      as.setChoice('binance-sub-1', 'account', 'margin', 'isolated');
      as.setTick('binance-sub-1', 'account', 'exists', true);
      assert.deepStrictEqual(as.withSteps(acc.tradingAccount('binance-sub-1')).setup.steps[0].missing, ['fill in "Exchange\'s sub-account identifier(s)"', 'tick "Margin trading is switched on for it"']);
      as.setTick('binance-sub-1', 'account', 'margin', true);
      // A SUB-ACCOUNT IS NOT DONE UNTIL WHAT THE EXCHANGE CALLS IT IS SAVED (3.274.0)
      assert.deepStrictEqual(as.withSteps(acc.tradingAccount('binance-sub-1')).setup.steps.map((s) => s.open).slice(0, 2), [true, false], 'step 2 stays shut while the box is empty');
      refused(() => as.setField('binance-sub-1', 'account', 'subIds', 'x'.repeat(201)), /^Exchange's sub-account identifier\(s\): at most 200 characters — this is 201$/);
      refused(() => as.setField('binance-sub-1', 'account', 'nope', 'x'), /has no box nope/);
      refused(() => as.setField('binance-sub-1', 'key', 'subIds', 'x'), /^step 2 opens when step 1 is done$/);
      assert.strictEqual(as.setField('binance-sub-1', 'account', 'subIds', '   ').setup.steps[0].done, false, 'blanks are not an identifier');
      const done = as.setField('binance-sub-1', 'account', 'subIds', '  4417-2209 \n me+sub1@example.com  ');
      assert.strictEqual(done.setup.fields.subIds, '4417-2209   me+sub1@example.com', 'one line: kept as typed, trimmed, a line break made a space');
      assert.deepStrictEqual(done.setup.steps.map((s) => [s.open, s.done]).slice(0, 3), [[true, true], [true, false], [false, false]], 'step 1 done opens step 2');
      assert.deepStrictEqual(done.setup.steps[1].missing, ['choose where it may trade from', 'tick "The key is made for this account, as an API key and a secret key"',
        'tick "It can trade and borrow on margin"', 'tick "It cannot withdraw money or transfer it to another account"', 'tick "Where it may trade from is set on the exchange as chosen above"']);
      // step 2
      refused(() => as.setChoice('binance-sub-1', 'key', 'address', 'everywhere'), /^where it may trade from: one of tied to one or more addresses — the machine\(s\) the trading platform runs on, open to any address$/);
      refused(() => as.setChoice('binance-sub-1', 'key', 'margin', 'cross'), /asks no choice margin/);
      as.setChoice('binance-sub-1', 'key', 'address', 'tied');
      for (const t of ['made', 'can', 'cannot']) as.setTick('binance-sub-1', 'key', t, true);
      let two = as.setTick('binance-sub-1', 'key', 'where', true);
      assert.deepStrictEqual(two.setup.steps.map((s) => [s.open, s.done]).slice(0, 4), [[true, true], [true, true], [true, false], [false, false]], 'step 2 done opens step 3');
      assert.deepStrictEqual(two.setup.steps[2].missing, ['not known here: the trading platforms and the setups were not asked', 'tick "The fingerprint of the platform\'s lock matched the one its machine printed"'],
        'step 3 claims nothing without the platforms having been asked');
      // THE TICK ABOUT THE CHOICE GOES WHEN THE CHOICE CHANGES; the others stay
      two = as.setChoice('binance-sub-1', 'key', 'address', 'any');
      assert.deepStrictEqual(two.setup.ticks.key, { made: true, can: true, cannot: true }, 'only the tick about where it may trade from is cleared');
      assert.deepStrictEqual(two.setup.steps[1].missing, ['tick "Where it may trade from is set on the exchange as chosen above"']);
      two = as.setChoice('binance-sub-1', 'key', 'address', 'any');
      as.setTick('binance-sub-1', 'key', 'where', true);
      assert.strictEqual(as.setChoice('binance-sub-1', 'key', 'address', 'any').setup.ticks.key.where, true, 'choosing the same again clears nothing');
      // a step 1 choice that changes clears nothing of step 2
      assert.deepStrictEqual(as.setChoice('binance-sub-1', 'account', 'margin', 'cross').setup.ticks.key, { made: true, can: true, cannot: true, where: true });
      as.setChoice('binance-sub-1', 'account', 'margin', 'isolated');
      // the main account is never asked, and what a sub-account saved stays hidden, not lost
      as.start('solo', 'binance');
      as.setChoice('solo', 'account', 'kind', 'main');
      refused(() => as.setField('solo', 'account', 'subIds', 'x'), /^Exchange's sub-account identifier\(s\) is asked only when which account is a sub-account$/);
      assert.ok(!as.withSteps(acc.tradingAccount('solo')).setup.steps[0].missing.some((m) => /identifier/.test(m)), 'the main account is not asked for it');
      as.setChoice('binance-sub-1', 'account', 'kind', 'main');
      assert.strictEqual(as.withSteps(acc.tradingAccount('binance-sub-1')).setup.fields.subIds, '4417-2209   me+sub1@example.com', 'choosing the main account keeps what was saved');
      as.setChoice('binance-sub-1', 'account', 'kind', 'sub');
      // the record saved again keeps its checklist; the checklist taken away leaves the record
      acc.saveTradingAccount({ id: 'binance-sub-1', exchange: 'binance', note: 'LTC and BTC pots' });
      assert.deepStrictEqual(acc.tradingAccount('binance-sub-1').setup.choices, { kind: 'sub', margin: 'isolated', address: 'any' });
      assert.deepStrictEqual(acc.tradingAccount('binance-sub-1').setup.fields, { subIds: '4417-2209   me+sub1@example.com' });
      assert.deepStrictEqual(as.remove('binance-sub-1'), { removed: 'binance-sub-1' });
      assert.ok(acc.tradingAccount('binance-sub-1') && !acc.tradingAccount('binance-sub-1').setup, 'the record stays, without its checklist');
      refused(() => as.setTick('binance-sub-1', 'account', 'exists', true), /has no setup: start one/);
      refused(() => as.setTick('nobody', 'account', 'exists', true), /no trading account called nobody/);
    });
  },

  // STEP 2 ASKS FOR THE KEY THE PLATFORM WILL KEEP: the key the step describes passes
  // the platform's own check, each thing the check refuses is something the step
  // says to leave off or switch on, and the tick it names is the tick on the key form
  stepTwoAsksForTheKeyThePlatformWillKeep() {
    const { keyVerdict } = require('../engine/venues/binance-account');
    const step = require('../lib/accountsetup').TEMPLATE.steps.find((s) => s.id === 'key');
    const words = JSON.stringify(step);
    const asked = { enableWithdrawals: false, enableInternalTransfer: false, permitsUniversalTransfer: false, enableSpotAndMarginTrading: true, enableMargin: true };
    assert.strictEqual(keyVerdict({ ...asked, ipRestrict: true }).ok, true, 'a key tied to one or more addresses, as step 2 describes it, is kept');
    assert.strictEqual(keyVerdict({ ...asked, ipRestrict: false }, { anyAddress: true }).ok, true, 'and so is one open to any address, with the tick');
    assert.strictEqual(keyVerdict({ ...asked, ipRestrict: false }).ok, false, 'but not without the tick, which is why step 2 says to tick it');
    // every refusal of the check has its words in the step
    const cover = [['enableWithdrawals', true, 'withdrawals'], ['enableInternalTransfer', true, 'transfers to other accounts'], ['permitsUniversalTransfer', true, 'transfers to other accounts'],
      ['enableSpotAndMarginTrading', false, 'Allow the key to trade'], ['enableMargin', false, 'to borrow on margin']];
    for (const [k, bad, w] of cover) {
      assert.strictEqual(keyVerdict({ ...asked, ipRestrict: true, [k]: bad }).ok, false, `the platform refuses a key with ${k} ${bad}`);
      assert.ok(words.includes(w), `and step 2 says ${w}`);
    }
    // the tick it quotes is the key form's own, word for word
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8');
    const quoted = /Tick "([^"]+)" when the keys are sent/.exec(step.guidance.flatMap((b) => b.paras).join(' '));
    assert.ok(quoted && src.includes('<input type="checkbox" id="takAny"> ' + quoted[1] + '</label>'), `step 2 quotes a tick the key form does not have: ${quoted && quoted[1]}`);
    // and the kind of key is the one the key store signs with: a secret key, HMAC
    assert.ok(/createHmac\('sha256', secret\)/.test(fs.readFileSync(path.join(__dirname, '..', 'engine', 'keystore.js'), 'utf8')), 'the key store no longer signs with a secret key, so step 2 asks for the wrong kind');
  },

  // STEPS 3 TO 6 ARE DONE BY WHAT THE SYSTEM SEES (3.275.0): the keys on a platform,
  // the exchange's answer about them, a setup naming the account, a setup on real
  // money -- and step 6 cannot be done while the platform places no real orders
  stepsThreeToSixAreDoneByWhatTheSystemSees() {
    const as = require('../lib/accountsetup');
    const acct = { id: 'binance-sub-1', exchange: 'binance', setup: {
      choices: { kind: 'sub', margin: 'cross', address: 'tied' }, fields: { subIds: '4417' },
      ticks: { account: { exists: true, margin: true }, key: { made: true, can: true, cannot: true, where: true }, keys: { fingerprint: true }, money: { pot: true } } } };
    const none = { platforms: ['box-1'], unanswered: [], keysOn: [], checkedOn: [], named: 0, live: 0, realOn: [] };
    const at = (facts) => as.withSteps(acct, facts).setup.steps;
    let st = at(none);
    assert.deepStrictEqual(st.map((x) => [x.open, x.done]), [[true, true], [true, true], [true, false], [false, false], [false, false], [false, false]]);
    assert.deepStrictEqual(st[2].said, [{ ok: false, text: 'the keys are not on any trading platform: press Enter the keys on this account\'s record below' }]);
    assert.strictEqual(at({ ...none, platforms: [] })[2].said[0].text, 'there is no trading platform yet: one is set up on the Compute tab');
    assert.strictEqual(at({ ...none, unanswered: ['box-1'] })[2].said[0].text, 'the keys are not on any trading platform that answered (box-1 did not): press Enter the keys on this account\'s record below');
    // keys on the platform, kept without the exchange asked: step 3 done, step 4 not
    st = at({ ...none, keysOn: ['box-1'] });
    assert.deepStrictEqual([st[2].done, st[3].done, st[3].said[0].text], [true, false, 'the exchange has not answered about the keys on box-1: press Check the keys again on this account\'s record below']);
    // REFUSED BY THE EXCHANGE (3.279.0): said, with what to do, and never hidden by another platform's answer
    assert.deepStrictEqual([at({ ...none, keysOn: ['box-1'], refusedOn: ['box-1'] })[3].done, at({ ...none, keysOn: ['box-1'], refusedOn: ['box-1'] })[3].said[0].text],
      [false, 'the exchange refused the keys kept on box-1: put the key or its addresses right on the exchange, then press Check the keys again on this account\'s record below']);
    st = at({ ...none, platforms: ['box-1', 'box-2'], keysOn: ['box-1', 'box-2'], checkedOn: ['box-1'], refusedOn: ['box-2'] });
    assert.deepStrictEqual([st[3].done, st[3].said[0].text], [false, 'the exchange refused the keys kept on box-2 (it answered box-1): put the key or its addresses right on the exchange, then press Check the keys again on this account\'s record below'], 'one platform answering does not hide another refused');
    // the exchange answered: step 4 done; no setup names the account yet
    st = at({ ...none, keysOn: ['box-1'], checkedOn: ['box-1'] });
    assert.deepStrictEqual([st[3].done, st[4].done, st[4].said[0].text], [true, false, 'no setup names this account yet: type binance-sub-1 into Sub-account key on a setup\'s Setup detail, on the Trade tab, and press Save']);
    // a setup names it: step 5 done; step 6 cannot be done while real orders are off everywhere
    st = at({ ...none, keysOn: ['box-1'], checkedOn: ['box-1'], named: 1 });
    assert.deepStrictEqual([st[4].done, st[4].said[0].text, st[5].open, st[5].done], [true, '1 setup names this account in Sub-account key', true, false]);
    assert.strictEqual(st[5].said[0].text, 'real orders are switched off on box-1: this release of the platform places no real orders');
    assert.strictEqual(at({ ...none, keysOn: ['box-1'], checkedOn: ['box-1'], named: 2, realOn: ['box-1'] })[5].said[0].text, 'no setup trading from this account is on real money: press Activate real for it on Live Trading');
    st = at({ ...none, keysOn: ['box-1'], checkedOn: ['box-1'], named: 2, live: 1, realOn: ['box-1'] });
    assert.deepStrictEqual([st[5].done, st[5].said[0].text], [true, '1 setup trading from this account is on real money']);
    // THE WORDS OF STEP 6 ARE HELD TO THE PLATFORM: the day it can place real orders, this fails and the step is written again
    const main = fs.readFileSync(path.join(__dirname, '..', 'engine', 'main.js'), 'utf8');
    assert.ok(/realOrders: 'off'/.test(main) && /this platform has no live exchange module yet/.test(main) && !/venues: \{[^}]*live/.test(main),
      'the platform can now place real orders, so step 6 no longer tells the truth: write it again');
    // and step 4's words about what the platform reads are held to what it reads
    const acctSrc = fs.readFileSync(path.join(__dirname, '..', 'engine', 'venues', 'binance-account.js'), 'utf8');
    const runner = fs.readFileSync(path.join(__dirname, '..', 'engine', 'runner.js'), 'utf8');
    assert.ok(/isIsolated: 'TRUE'/.test(acctSrc.slice(acctSrc.indexOf('async hourlyRate('), acctSrc.indexOf('async isolatedWallet('))) && !/isolatedWallet\(/.test(runner),
      'the platform now reads the cross rate or the pot, so step 4 no longer tells the truth: write it again');
  },

  // KEYS TO AND FROM ANY NUMBER OF PLATFORMS, AND STEP 3 SHOWS EVERY LOCK (3.277.0, owner
  // 2026-09-27: "this section must be coded to work properly with ONE or TWO or MORE trading
  // platforms when adding/removing/changing keys"; and of step 3, "how is the user supposed to
  // know this seeing nothing was displayed about it")
  keysGoToAndComeOffAnyNumberOfPlatformsAndStepThreeShowsTheLocks() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8');
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const cardSrc = src.slice(src.indexOf('function keyStanding(acctId, g) {'), src.indexOf('function tradingAccountsHtml() {'));
    const acct = { id: 'sub-1', exchange: 'binance', note: '' };
    const E = (id, name, extra = {}) => ({ id, name, system: 'linux', ...extra });
    const held = (at) => ({ answers: true, keys: [{ account: 'sub-1', present: true, addedAt: at, tied: true }], lock: { publicKey: 'p' }, lockHere: `fp-${at.slice(11, 13)}` });
    const none = (fp) => ({ answers: true, keys: [], lock: { publicKey: 'p' }, lockHere: fp });
    const card = (aTr, open = null, mode = null, ticks = {}, out = {}) => new Function('esc', 'aTr', 'aTrKeys', 'aTrKeysMode', 'aTrKeysTicks', 'aTrKeysOut', `${cardSrc}; return tradingAccountCard;`)(esc, aTr, open, mode, ticks, out)(acct);
    const base = { offered: [{ id: 'binance', label: 'Binance' }] };
    // ONE PLATFORM, NO KEYS: Enter the keys, nothing to remove
    const one = { ...base, engines: [E('box-1', 'Platform One')], keys: { 'box-1': none('fp-a') } };
    let html = card(one);
    assert.ok(/<button data-takeys="sub-1">Enter the keys<\/button>/.test(html) && !/data-tarm=/.test(html) && !/data-tacheck=/.test(html), 'one platform without keys: Enter the keys, and nothing to remove or check');
    // TWO PLATFORMS, KEYS ON ONE: Change the keys and Remove the keys; the send form ticks both,
    // saying what sending does on each, each with its own lock
    const two = { ...base, engines: [E('box-1', 'Platform One'), E('box-2', 'Platform Two', { system: 'windows' })], keys: { 'box-1': held('2026-09-27T01:00:00Z'), 'box-2': none('fp-b') } };
    html = card(two);
    assert.ok(/<button data-takeys="sub-1">Change the keys<\/button><button data-tacheck="sub-1" title="[^"]*">Check the keys again<\/button><button data-tarm="sub-1" class="danger"/.test(html), 'once a platform holds them: Change the keys, Check the keys again and Remove the keys');
    assert.strictEqual((html.match(/data-takeys=|data-tacheck=|data-tarm=/g) || []).length, 3, 'one set of buttons for the account, however many platforms');
    html = card(two, 'sub-1', 'send');
    assert.ok(/data-tatick="box-1" checked> Platform One<\/label><span class="note">holds keys entered 2026-09-27 01:00 UTC — these replace them<\/span><span class="note">the fingerprint of its lock <b>fp-01<\/b><\/span>/.test(html), 'the platform holding keys is ticked, and says they are replaced, with its lock');
    assert.ok(/data-tatick="box-2" checked> Platform Two<\/label><span class="note">holds none — these are added<\/span><span class="note">the fingerprint of its lock <b>fp-b<\/b><\/span>/.test(html), 'the one holding none is ticked too, and says they are added');
    assert.ok(/<button id="takSend" class="pri">Send the keys to the ticked platforms<\/button><button id="takCancel">Do not send<\/button>/.test(html), 'one press sends to every ticked platform');
    assert.ok(/data-tatick="box-2">/.test(card(two, 'sub-1', 'send', { 'box-2': false })), 'a tick taken off stays off across the redraw');
    // THREE PLATFORMS: keys on two, the third silent -- the remove form ticks the two, says why not the third
    const three = { ...base, engines: [E('box-1', 'Platform One'), E('box-2', 'Platform Two'), E('box-3', 'Platform Three'), E('box-4', 'Platform Four')],
      keys: { 'box-1': held('2026-09-27T01:00:00Z'), 'box-2': held('2026-09-27T02:00:00Z'), 'box-3': { answers: false, why: 'no word from it' }, 'box-4': { answers: true, keys: [] } } };
    html = card(three, 'sub-1', 'remove');
    assert.ok(/data-tatick="box-1" checked> Platform One<\/label><span class="note">keys entered 2026-09-27 01:00 UTC<\/span>/.test(html) && /data-tatick="box-2" checked> Platform Two/.test(html), 'every platform holding the keys is offered, ticked');
    assert.ok(!/data-tatick="box-3"/.test(html) && /Platform Three — did not answer, so whether it holds keys cannot be told, and nothing can be removed from it now/.test(html), 'a silent platform is named, not offered');
    assert.ok(!/data-tatick="box-4"/.test(html), 'a platform holding none is not offered for removal');
    assert.ok(/<button id="takRemove" class="danger">Remove the keys from the ticked platforms<\/button><button id="takCancel">Do not remove<\/button>/.test(html), 'one press removes from every ticked platform');
    html = card(three, 'sub-1', 'send');
    assert.ok(/Platform Three — did not answer, so nothing can be sent to it now \(no word from it\)/.test(html) && /Platform Four — has not said what its lock is, so no keys can be locked for it/.test(html) && !/data-tatick="box-(3|4)"/.test(html),
      'a platform that cannot take keys is named with why, and cannot be ticked');
    assert.ok(!/data-takeys=/.test(card({ ...base, engines: [E('box-3', 'Platform Three')], keys: { 'box-3': { answers: false, why: 'x' } } })), 'no platform can take keys: nothing offers to enter them');
    assert.ok(/<div id="taOut_sub-1" class="note" style="margin-top:\.3rem">Platform One: removed<\/div>/.test(card(two, null, null, {}, { 'sub-1': 'Platform One: removed' })), 'the answer of the last send or remove stays under the account, one line per platform');
    // THE PRESSES DO WHAT THE FORM SAYS: every ticked platform, each its own lock, each its own answer
    assert.ok(/const targets = tickedOf\(acct, \(st\) => st\.lockable\);/.test(src) && /const targets = tickedOf\(acct, \(st\) => !!st\.mine\);/.test(src), 'the send and the remove go to every ticked platform the form could tick');
    assert.ok(/for \(const g of targets\) \{\n      const st = keyStanding\(acct, g\);\n      try \{\n        \/\/ LOCKED HERE, SEPARATELY FOR EACH PLATFORM, WITH ITS OWN LOCK/.test(src), 'each platform\'s keys are locked with that platform\'s own lock');
    assert.ok(/await postJson\('api\/account\/trading\/' \+ encodeURIComponent\(acct\) \+ '\/keys', \{ engine: g\.id, remove: true \}\)/.test(src), 'each ticked platform is asked to remove them');
    // STEP 3's LOCKS: each fingerprint as worked out here, and the command for that machine
    const aTr = {
      engines: [{ id: 'box-1', name: 'Platform One', isDefault: true, system: 'linux' }, { id: 'box-2', name: 'Platform Two', system: 'windows' }, { id: 'box-3', name: 'Platform Three', system: null }],
      keys: { 'box-1': { answers: true, keys: [], lockHere: '0a1b2c3d4e5f60718293' }, 'box-2': { answers: true, keys: [], lockHere: 'ffeeddccbbaa99887766' }, 'box-3': { answers: false, why: 'no word from it' } },
    };
    const lockSrc = src.slice(src.indexOf('const LOCK_CMD = {'), src.indexOf('function asHtml() {'));
    const locks = new Function('esc', 'aTr', `${lockSrc}; return { asLocksHtml, LOCK_CMD };`)(esc, aTr);
    const lockHtml = locks.asLocksHtml();
    assert.ok(/<span class="k">Platform One<\/span><span class="note">the fingerprint of its lock, worked out in this browser:<\/span> <b>0a1b2c3d4e5f60718293<\/b>/.test(lockHtml), 'each platform\'s fingerprint is on the step');
    assert.ok(lockHtml.includes(esc("sudo sed -n 's/.*\"lock\":\"\\([^\"]*\\)\".*/\\1\\n/p' /var/lib/uts-engine-box-1/link-status.json")), 'a Linux machine is given its command, the fingerprint on a line of its own');
    assert.ok(lockHtml.includes(esc('(Get-Content "$env:ProgramData\\uts-engine-box-2\\link-status.json" | ConvertFrom-Json).lock')) && /in PowerShell, as administrator/.test(lockHtml), 'a Windows machine its own');
    assert.ok(/this system does not know that machine&#39;s operating system yet/.test(lockHtml) && /the platform did not answer/.test(lockHtml), 'and a machine whose system is not known says so, as does one that did not answer');
    // THE COMMANDS ARE HELD TO THE INSTALL SCRIPTS: where each keeps the file, and how Linux reads it
    const inst = (f) => fs.readFileSync(path.join(__dirname, '..', 'engine', 'install', f), 'utf8');
    const lin = inst('linux.sh');
    assert.ok(lin.includes('NAME="uts-engine-$SHORT"') && lin.includes('DATA="/var/lib/$NAME"') && lin.includes(`sed -n 's/.*"lock":"\\([^"]*\\)".*/\\1/p' "$DATA/link-status.json"`), 'the Linux install keeps its lock somewhere else now: step 3\'s command must follow');
    assert.ok(inst('mac.sh').includes('DATA="/usr/local/var/$NAME"') && locks.LOCK_CMD.mac('x').endsWith('/usr/local/var/uts-engine-x/link-status.json; echo'), 'the Mac install moved its record, or its fingerprint runs into the prompt');
    assert.ok(inst('windows.ps1').includes('$name = "uts-engine-$Short"') && inst('windows.ps1').includes('$data = Join-Path $env:ProgramData $name'), 'the Windows install moved its record');
    assert.ok(/fs\.writeFileSync\(t, JSON\.stringify\(\{ \.\.\.this\.state, lock: this\.lock \? this\.lock\.info\(\)\.fingerprint : null \}\)/.test(fs.readFileSync(path.join(__dirname, '..', 'engine', 'link.js'), 'utf8')), 'the platform no longer writes its lock\'s fingerprint where the command reads it');
    assert.ok(/system: \(\{ linux: 'linux', darwin: 'mac', win32: 'windows' \}\)\[\(t\.machine \|\| \{\}\)\.platform\] \|\| null/.test(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')), 'the Account tab is told each platform\'s system');
  },

  // THE ACCOUNT TAB DRAWS IT: behind a button of its own at the top of Trading accounts,
  // with the same drawing as a platform's checklist, and nothing that asks for a key
  theAccountTabDrawsItWithThePlatformsChecklistCode() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8');
    const area = src.slice(src.indexOf('function asHtml('), src.indexOf('function wireAs('));
    assert.ok(/<button id="asToggle"[^>]*>' \+ \(aAsOpen \? '▾' : '▸'\) \+ ' Set up a trading account<\/button>/.test(area), 'one button opens and closes it');
    assert.ok(/checklistStepsHtml\('as', sel\.setup, aTr\.setupTemplate, \(x, step\) => \(step\.panel === 'locks' \? asLocksHtml\(\) : ''\)\)/.test(area), 'drawn by the same code as a platform\'s checklist, with step 3\'s locks in its panel');
    assert.ok(/checklistStepsHtml\('es', s, t,/.test(src), 'and the platform\'s checklist is drawn by it too');
    assert.ok(/<div class="row" style="margin-top:\.9rem"><button id="asDelete" class="danger"/.test(area) && /Set up another account<\/button>/.test(area), 'its own delete and another account, each in a row of its own');
    assert.ok(/'<div class="row" style="margin-top:\.5rem"><button id="asStart">Start its setup<\/button>/.test(src), 'Start its setup has a row of its own');
    const tr = src.slice(src.indexOf('function tradingAccountsHtml('), src.indexOf('function wireTradingAccounts('));
    assert.ok(tr.indexOf('+ asHtml()') > 0 && tr.indexOf('+ asHtml()') < tr.indexOf('tradingAccountCard'), 'at the top of Trading accounts, before the accounts');
    assert.ok(/data-' \+ kind \+ '-choice=/.test(src) && /querySelectorAll\('\[data-as-choice\]'\)/.test(src) && /querySelectorAll\('\[data-as-tick\]'\)/.test(src), 'its choices and ticks are wired to its own addresses');
    assert.ok(/postJson\('api\/account\/setups'/.test(src) && /'api\/account\/setups\/' \+ encodeURIComponent\(sel\.id\) \+ '\/' \+ what/.test(src), 'it asks the service');
    // THE IDENTIFIERS BOX (3.274.0), drawn by the shared code: right after the choice that
    // asks it, only while it is asked, its save a button in a row of its own
    const a = src.indexOf('function checklistStepsHtml(');
    const b = src.indexOf('\nfunction esSetupHtml(', a);
    const draw = new Function('esc', 'ckFieldTyped', 'ckFieldMsg', `${src.slice(a, b)}; return checklistStepsHtml;`)((x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'), { as: {}, es: {} }, { as: {}, es: {} });
    const t = require('../lib/accountsetup').TEMPLATE;
    const setup = (kind, fields) => ({ choices: { kind }, ticks: {}, fields, steps: t.steps.map((_, i) => ({ open: i === 0, done: false })) });
    const sub = draw('as', setup('sub', { subIds: '4417 · me@x' }), t, null);
    const box = /<div class="row" style="margin-top:\.45rem"><label class="c" style="flex-wrap:wrap; max-width:100%"><span class="muted" style="font-size:\.8rem">Exchange's sub-account identifier\(s\)<\/span><input data-as-field="account\|subIds" maxlength="200" value="4417 · me@x"/;
    assert.ok(box.test(sub), 'the box is drawn with what was saved in it, and takes 200 characters');
    assert.ok(sub.indexOf('data-as-field=') > sub.indexOf('value="sub"') && sub.indexOf('data-as-field=') < sub.indexOf('Margin</span>'), 'right after Which account, before Margin');
    assert.ok(/<div class="row" style="margin-top:\.3rem"><button data-as-fieldsave="account\|subIds">Save the sub-account identifier\(s\)<\/button><span class="note">/.test(sub), 'its save is a button in a row of its own, with its answer beside it');
    assert.ok(!/data-as-field=/.test(draw('as', setup('main', { subIds: 'kept' }), t, null)), 'the main account is not asked for it');
    // what is typed and not saved yet survives the redraw, and says so
    const typedDraw = new Function('esc', 'ckFieldTyped', 'ckFieldMsg', `${src.slice(a, b)}; return checklistStepsHtml;`)((x) => String(x), { as: { 'account|subIds': 'typed, not saved' }, es: {} }, { as: {}, es: {} });
    const typedHtml = typedDraw('as', setup('sub', { subIds: '4417' }), t, null);
    assert.ok(/value="typed, not saved"/.test(typedHtml) && /Save the sub-account identifier\(s\)<\/button><span class="note">not saved yet<\/span>/.test(typedHtml), 'what is typed is lost on the redraw, or not said to be unsaved');
    assert.ok(/querySelectorAll\('\[data-as-fieldsave\]'\)/.test(src) && /'\/field', \{ step, field, value: box\.value \}/.test(src), 'the save sends the box to the service');
    assert.ok(/if \(req\.params\.what === 'field'\) return res\.json\(\{ ok: true, setup: as\.setField\(/.test(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')), 'the service takes it');
    assert.ok(/'<span class="note">sub-account: ' \+ esc\(a\.setup\.fields\.subIds\) \+ '<\/span>'/.test(src), 'the account\'s card shows what the exchange calls the sub-account');
    assert.ok(!/tied to one address/.test(src) && (src.match(/tied to one or more addresses/g) || []).length === 3, 'the key line, the kept message and the check\'s answer say one or more addresses');
    // WHAT THE SYSTEM SEES FOR ITSELF (3.275.0) is said on the step, met or not
    const seen = { choices: { kind: 'sub', address: 'tied' }, ticks: {}, fields: {}, steps: t.steps.map((st, i) => ({ open: i === 2, done: false, said: i === 2 ? [{ ok: true, text: 'the keys are on box-1' }] : i === 3 ? [{ ok: false, text: 'x' }] : [] })) };
    const seenHtml = draw('as', seen, t, null);
    assert.ok(/<div class="row" style="margin-top:\.35rem"><span class="pos" style="font-size:\.82rem">✓ the keys are on box-1<\/span><\/div>/.test(seenHtml), 'a need that is met is said on its step');
    assert.ok(/class="warn"[^>]*>x</.test(draw('as', { ...seen, steps: seen.steps.map((st, i) => ({ ...st, open: i <= 3 })) }, t, null)), 'and one that is not, in the warning colour');
    // and the service gathers it for every account it lists
    const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(srv.includes('accounts: acc.tradingAccounts().map((a) => as.withSteps(a, factsFor(a.id)))') && /h\.health\.realOrders === 'on'/.test(srv) && /x\.keyRef === acctId && x\.state !== 'retired'/.test(srv), 'the Account tab\'s reading gathers what the checklist sees');
  },
};
