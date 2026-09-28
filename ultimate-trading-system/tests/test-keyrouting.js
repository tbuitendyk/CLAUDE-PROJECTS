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
// the accounts; an unchanged pick changes nothing; clearing is picking "no trading account", on Paper Books
// only, as Activate offers it (3.287.0, owner order 2026-09-28: the "clear the key" box went); and the
// service takes only an account on record.
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
    assert.ok(/<select id="keyIn" style="min-width:14rem">\$\{accountOptions\(accts,s\.keyRef,branch==='real'\?null:'no trading account'\)\}<\/select>/.test(TRADE), 'the sub-account key is not the list of trading accounts, with the choices Activate offers');
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
    assert.ok(/const keyRef=pickedKey===\(s\.keyRef\|\|''\)\?undefined:\(pickedKey\|\|null\);/.test(TRADE),
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

  // SAVED ON SETUP DETAIL ONCE A RUN (3.287.0, owner order 2026-09-28: "they become display only on the
  // setup detail tabs only after they've been saved there the first time"). The lists and the button while
  // the book runs and Save routing is unused in this run; words after it, and on a stopped book. The rule is
  // the service's, served beside the record; the routing goes round its one door; the press says it is the
  // only one before it is made.
  async theRoutingIsSavedOnSetupDetailOnceARun() {
    assert.ok(/\$\{\(s\.state==='paper'\|\|s\.state==='live'\)&&!s\.routingSaved\?`<div class="row"/.test(TRADE),
      'the routing lists are drawn after Save routing was used in this run, or on a stopped book');
    assert.ok(/routingSaved: reg\.routingSavedThisRun\(s\)/.test(ROUTES), 'the service no longer says whether Save routing was used in this run');
    assert.ok(/let s = Object\.keys\(routing\)\.length \? reg\.saveRouting\(req\.params\.id, routing, 'owner'\) : null;/.test(ROUTES),
      'the routing is saved round its one door, so the once-a-run rule and the held plans are skipped');
    assert.ok(/if\(!confirm\('Save routing can be used once each time this book is started\./.test(TRADE), 'the one press is made without saying it is the only one');
    assert.ok(/stay with the book for its run: Save routing on Setup detail can change them once/.test(TRADE), 'Activate no longer says the routing is fixed for the run');
  },

  // CLEARING IS PICKING "no trading account", AND ONLY ON PAPER BOOKS (3.287.0, owner order 2026-09-28:
  // 'the "clear the key" box probably isn't needed at all'). The box went; the choice it made is one of the
  // list's own, exactly as Activate offers it, and a live book -- which must keep its own key -- has none.
  async clearingIsPickingNoTradingAccountOnPaperOnly() {
    assert.ok(!/id="keyClear"/.test(TRADE) && !/clear the key/.test(TRADE), 'the "clear the key" box is back');
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const opts = new Function('esc', `${TRADE.slice(TRADE.indexOf('function accountOptions('), TRADE.indexOf('\n}', TRADE.indexOf('function accountOptions(')) + 2)}; return accountOptions;`)(esc);
    const accts = { accounts: [{ id: 'acct-a' }] };
    const noneWords = (branch) => (branch === 'real' ? null : 'no trading account');
    assert.ok(opts(accts, 'acct-a', noneWords('paper')).includes('<option value="" >no trading account</option>'), 'Paper Books offer no trading account');
    assert.ok(!opts(accts, 'acct-a', noneWords('real')).includes('no trading account'), 'Live Trading offers a book no way to drop its key');
  },
};
