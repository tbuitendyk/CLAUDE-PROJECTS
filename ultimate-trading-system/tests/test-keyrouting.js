// SAVING THE ROUTING MUST NOT DESTROY THE SUB-ACCOUNT KEY (found 2026-08-21), AND THE KEY IS PICKED, NOT
// TYPED (3.282.0, owner 2026-09-27: the sub-account key "must be a drop down list box also with selections
// that can be selected", and "After setting a Sub-account key THAT ACCOUNT SELECTION MUST BE SHOWN ON THE
// SETUP").
//
// The old fault: an edit box was filled with a presence marker -- the word "set" -- and pressing "Save
// routing" wrote that word over the setup's real sub-account reference, which then pointed at a sub-account
// that does not exist while every screen read "Key: set". It was guarded by never sending the reference to
// the page at all. Now the reference is the name of a trading account on the Account tab, it is shown, and
// it is chosen from a list that holds only real account names -- so nothing can be saved over it that is not
// an account. What is pinned here: presence still has a name that says presence; the control is a list of
// the accounts; an unchanged pick changes nothing; clearing stays its own deliberate act; and the service
// takes only an account on record.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const ROUTES = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'routes.js'), 'utf8');
const TRADE = fs.readFileSync(path.join(ROOT, 'public', 'trade.html'), 'utf8');

module.exports = {
  // No field named keyRef may carry anything but the reference itself.
  async presenceIsReportedUnderANameThatSaysPresence() {
    assert.ok(/hasKeyRef: Boolean\(s\.keyRef\)/.test(ROUTES),
      'the list no longer reports the key as a presence flag');
    assert.ok(!/keyRef: s\.keyRef \? 'set' : null/.test(ROUTES),
      'a field called keyRef is carrying the word "set" again — an edit box filled from it will save that over the real reference');
  },

  // The key is chosen from the trading accounts on record, and the one set is the one shown selected.
  async theKeyIsPickedFromTheAccountsNeverTyped() {
    assert.ok(!/<input id="keyIn"/.test(TRADE), 'the sub-account key is a typed box again');
    assert.ok(/<select id="keyIn" style="min-width:14rem">\$\{accountOptions\(accts,s\.keyRef,null\)\}<\/select>/.test(TRADE), 'the sub-account key is not the list of trading accounts');
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const opts = new Function('esc', `${TRADE.slice(TRADE.indexOf('function accountOptions('), TRADE.indexOf('\n}', TRADE.indexOf('function accountOptions(')) + 2)}; return accountOptions;`)(esc);
    const accts = { accounts: [{ id: 'acct-a' }, { id: 'acct-b' }] };
    assert.strictEqual(opts(accts, 'acct-b', null), '<option value="acct-a" >acct-a</option><option value="acct-b" selected>acct-b</option>', 'the accounts, the one set selected');
    assert.strictEqual(opts(accts, null, null), '<option value="" selected disabled hidden>pick a trading account</option><option value="acct-a" >acct-a</option><option value="acct-b" >acct-b</option>', 'none set: a prompt, and only accounts to pick');
    assert.ok(opts(accts, 'old-typed', null).startsWith('<option value="old-typed" selected>old-typed (not an account on the Account tab)</option>'), 'a stored reference that is no account is shown as such, never hidden');
    assert.strictEqual(opts(accts, null, 'no trading account'), '<option value="" selected>no trading account</option><option value="acct-a" >acct-a</option><option value="acct-b" >acct-b</option>', 'where none is allowed, it is a choice');
  },

  // An unchanged pick changes nothing.
  async anUnchangedPickLeavesTheKeyAlone() {
    assert.ok(/const keyRef=clearKey\?null:\(pickedKey&&pickedKey!==s\.keyRef\?pickedKey:undefined\);/.test(TRADE),
      'the save sends a key the owner did not change');
    assert.ok(/if\(keyRef!==undefined\) body\.keyRef=keyRef;/.test(TRADE),
      'the save sends a key even when the owner picked none — silence is being treated as an instruction');
    assert.ok(/if\(!executionTargetRef\)\{ \$\('#routeMsg'\)\.innerHTML='<span class="neg">pick a trading platform in Execution target first<\/span>'; return; \}/.test(TRADE), 'a platform must be picked before the routing is saved');
  },

  // The service takes only an account on record, and only a trading platform.
  async theServiceTakesOnlyWhatTheListsHold() {
    assert.ok(/if \(b\.keyRef != null\) \{\n        const accounts = require\('\.\.\/account'\)\.tradingAccounts\(\)\.map\(\(a\) => a\.id\);\n        if \(!accounts\.includes\(b\.keyRef\)\)/.test(ROUTES), 'the service takes a key that names no trading account');
    assert.ok(/if \('executionTargetRef' in b\) \{\n        const engines = require\('\.\/targets'\)\.listEngines\(\);\n        if \(!engines\.some\(\(t\) => t\.id === b\.executionTargetRef\)\)/.test(ROUTES), 'the service takes an execution target that is no trading platform');
  },

  // And clearing must still be possible, deliberately.
  async clearingIsStillPossibleAndDeliberate() {
    assert.ok(/id="keyClear"/.test(TRADE),
      'there is no way to clear the sub-account key — the fix removed a control instead of making it explicit');
  },
};
