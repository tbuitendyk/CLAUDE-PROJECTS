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
  // THE TEMPLATE: steps 1 and 2 in full; the road ahead named and still being written
  theAccountTemplateHasStepsOneAndTwoInFullAndTheRestStillBeingWritten() {
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
    assert.deepStrictEqual(later.map((s) => [s.title, s.writing]), [['The keys go to their platform', true], ['The platform reads the account', true], ['A setup trades from it', true], ['Real money on', true]]);
    // a checklist never takes a key: every choice is one of its options and every tick is on or off
    for (const st of as.TEMPLATE.steps) assert.ok(Object.keys(st).every((k) => ['id', 'title', 'guidance', 'choices', 'fields', 'ticks', 'writing'].includes(k)), `step ${st.id} holds nothing unexpected`);
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
      assert.deepStrictEqual(two.setup.steps[2].missing, ['this step is still being written'], 'step 3 is still being written and never done');
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
    assert.ok(!/tied to one address/.test(src) && (src.match(/tied to one or more addresses/g) || []).length === 2, 'the key line and the kept message say one or more addresses');
  },
};
