// SETTING UP A TRADING ACCOUNT, STEP BY STEP (3.268.0, owner 2026-09-26: "we're
// going to follow the same build while setting-up pattern with a new account
// set-up on Binance"): the checklist kept on each trading account's record, its
// step 1 in full and the rest still being written, and the Account tab that draws
// it with the same code as a platform's checklist on the Compute tab.
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
  // THE TEMPLATE: step 1 in full; the road ahead named and still being written
  theAccountTemplateHasStepOneInFullAndTheRestStillBeingWritten() {
    const as = require('../lib/accountsetup');
    const [first, ...rest] = as.TEMPLATE.steps;
    assert.strictEqual(first.title, 'The exchange account');
    assert.deepStrictEqual(first.choices.map((c) => [c.id, c.label, c.options.map((o) => o.label)]), [
      ['kind', 'Which account', ['the main account', 'a sub-account']],
      ['margin', 'Margin', ['isolated — each coin pair its own pot', 'cross — one pot for the whole account']],
    ]);
    assert.deepStrictEqual(first.ticks.map((t) => t.label), ['The account exists on the exchange', 'Margin trading is switched on for it']);
    // THE POT (owner, 2026-09-26): one pair funded once in every account, each pot apart
    const words = JSON.stringify(first.guidance);
    for (const w of ['your main account, or one of its sub-accounts', 'its own money, its own borrowing and its own liquidation', 'The same pair can be funded once in every account you keep', 'two setups on the same pair need an account each', 'The whole account is one pot']) assert.ok(words.includes(w), `step 1 says ${w}`);
    assert.deepStrictEqual(rest.map((s) => [s.title, s.writing]), [['The API key', true], ['The keys go to their platform', true], ['The platform reads the account', true], ['A setup trades from it', true], ['Real money on', true]]);
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
      assert.deepStrictEqual(as.withSteps(acc.tradingAccount('binance-sub-1')).setup.steps[0].missing, ['tick "Margin trading is switched on for it"']);
      const done = as.setTick('binance-sub-1', 'account', 'margin', true);
      assert.deepStrictEqual(done.setup.steps.map((s) => [s.open, s.done]).slice(0, 3), [[true, true], [true, false], [false, false]], 'step 1 done opens step 2, which is still being written and never done');
      assert.deepStrictEqual(done.setup.steps[1].missing, ['this step is still being written']);
      // the record saved again keeps its checklist; the checklist taken away leaves the record
      acc.saveTradingAccount({ id: 'binance-sub-1', exchange: 'binance', note: 'LTC and BTC pots' });
      assert.deepStrictEqual(acc.tradingAccount('binance-sub-1').setup.choices, { kind: 'sub', margin: 'isolated' });
      assert.deepStrictEqual(as.remove('binance-sub-1'), { removed: 'binance-sub-1' });
      assert.ok(acc.tradingAccount('binance-sub-1') && !acc.tradingAccount('binance-sub-1').setup, 'the record stays, without its checklist');
      refused(() => as.setTick('binance-sub-1', 'account', 'exists', true), /has no setup: start one/);
      refused(() => as.setTick('nobody', 'account', 'exists', true), /no trading account called nobody/);
    });
  },

  // THE ACCOUNT TAB DRAWS IT: behind a button of its own at the top of Trading accounts,
  // with the same drawing as a platform's checklist, and nothing that asks for a key
  theAccountTabDrawsItWithThePlatformsChecklistCode() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8');
    const area = src.slice(src.indexOf('function asHtml('), src.indexOf('function wireAs('));
    assert.ok(/<button id="asToggle"[^>]*>' \+ \(aAsOpen \? '▾' : '▸'\) \+ ' Set up a trading account<\/button>/.test(area), 'one button opens and closes it');
    assert.ok(/checklistStepsHtml\('as', sel\.setup, aTr\.setupTemplate, null\)/.test(area), 'drawn by the same code as a platform\'s checklist');
    assert.ok(/checklistStepsHtml\('es', s, t,/.test(src), 'and the platform\'s checklist is drawn by it too');
    assert.ok(/<div class="row" style="margin-top:\.9rem"><button id="asDelete" class="danger"/.test(area) && /Set up another account<\/button>/.test(area), 'its own delete and another account, each in a row of its own');
    assert.ok(/'<div class="row" style="margin-top:\.5rem"><button id="asStart">Start its setup<\/button>/.test(src), 'Start its setup has a row of its own');
    const tr = src.slice(src.indexOf('function tradingAccountsHtml('), src.indexOf('function wireTradingAccounts('));
    assert.ok(tr.indexOf('+ asHtml()') > 0 && tr.indexOf('+ asHtml()') < tr.indexOf('tradingAccountCard'), 'at the top of Trading accounts, before the accounts');
    assert.ok(/data-' \+ kind \+ '-choice=/.test(src) && /querySelectorAll\('\[data-as-choice\]'\)/.test(src) && /querySelectorAll\('\[data-as-tick\]'\)/.test(src), 'its choices and ticks are wired to its own addresses');
    assert.ok(/postJson\('api\/account\/setups'/.test(src) && /'api\/account\/setups\/' \+ encodeURIComponent\(sel\.id\) \+ '\/' \+ what/.test(src), 'it asks the service');
  },
};
