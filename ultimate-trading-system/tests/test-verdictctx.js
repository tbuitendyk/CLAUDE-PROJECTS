// The null verdict could not be read for any multi-asset setup.
//
// lib/verdict.js keys a setup by trade|ctx1|ctx2|geometry|decision — it has done
// since the 2026-08-04 review, precisely so a singles+doubles run cannot score
// whichever same-family row happened to be stored first. The HTTP route built
// its `sel` from trade/geometry/decision only and dropped the two context
// fields, so every request arrived as the SINGLES key. Both the Bracket lab and
// the Constructing tab sent the contexts correctly; the server threw them away
// and answered "setup … not in this run's real rows".
//
// The live vocabulary only accepts three-asset combos, so this meant the check
// that says whether a result beats its own null was unreadable for every setup
// the project can actually trade. Found by the runtime harness on 2026-08-17.
//
// Watched failing 2026-08-17: deleting either ctx line from the route's `sel`
// fails theRouteForwardsTheContextPairs; removing ctx from keyOf in verdict.js
// fails aThreeAssetSetupIsFoundByItsOwnKey.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const { nullVerdict } = require('../lib/verdict');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// A census row is what both sides of the verdict are keyed on.
const row = (over) => ({
  trade: 'ZECUSDT', ctx1: 'BTCUSDT', ctx2: 'ETHUSDT',
  geometry: 'daily-3d', decision: 'argmax', windowLayout: 'reserve61',
  nullDealSeed: null, holdPnl: 0, ...over,
});

function doc(rows) { return { id: 'bracketlab-20260101-0000-t', params: { windowLayout: 'reserve61' }, edgeCensus: rows }; }

function aThreeAssetSetupIsFoundByItsOwnKey() {
  const d = doc([
    row({ holdPnl: 100 }),
    row({ nullDealSeed: 1, holdPnl: 10 }),
    row({ nullDealSeed: 2, holdPnl: 20 }),
  ]);
  const out = nullVerdict(d, d, {
    trade: 'ZECUSDT', ctx1: 'BTCUSDT', ctx2: 'ETHUSDT', geometry: 'daily-3d', decision: 'argmax',
  });
  assert(out.perSetup, 'the three-asset setup was not found in its own run');
  assert.strictEqual(out.perSetup.setup, 'ZECUSDT|BTCUSDT|ETHUSDT|daily-3d|argmax|reserve61');
  assert.strictEqual(out.perSetup.n, 2, 'both null draws must pair to the same setup');
  assert.strictEqual(out.perSetup.beats, 2);
}

// The contexts are not decoration: a singles row and a triples row on the same
// traded pair are DIFFERENT setups with different money, and asking without
// them must not quietly answer with the wrong one.
function askingWithoutTheContextsDoesNotMatchAThreeAssetRow() {
  const d = doc([row({ holdPnl: 100 }), row({ nullDealSeed: 1, holdPnl: 10 })]);
  let threw = null;
  try {
    nullVerdict(d, d, { trade: 'ZECUSDT', geometry: 'daily-3d', decision: 'argmax' });
  } catch (e) { threw = e.message; }
  assert(threw && /not in .*real rows/.test(threw),
    'a contextless request matched a three-asset row — the two are different setups');
}

// The route is the half that was broken. Pin it at source: `sel` must carry the
// context pairs through to lib/verdict.js.
function theRouteForwardsTheContextPairs() {
  const i = SERVER.indexOf("app.post('/api/bracketlab/null-verdict'");
  assert(i >= 0, 'the null-verdict route is gone');
  const block = SERVER.slice(i, SERVER.indexOf('\n});', i))
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert(/ctx1:\s*b\.ctx1/.test(block), 'the null-verdict route drops ctx1 — every request arrives as the singles key');
  assert(/ctx2:\s*b\.ctx2/.test(block), 'the null-verdict route drops ctx2 — every request arrives as the singles key');
}

// And the caller must send them. A route that forwards a field nobody sends is
// the same dead pipe from the other end.
function theConstructingTabSendsTheContextPairs() {
  const CX = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const i = CX.indexOf("post('api/bracketlab/null-verdict'");
  assert(i >= 0, 'the Constructing tab no longer reads the null verdict');
  const block = CX.slice(i, i + 500);
  assert(/ctx1:/.test(block) && /ctx2:/.test(block),
    'Tool 1 sends no contexts — it would ask for the singles key of a three-asset setup');
}

module.exports = {
  aThreeAssetSetupIsFoundByItsOwnKey,
  askingWithoutTheContextsDoesNotMatchAThreeAssetRow,
  theRouteForwardsTheContextPairs,
  theConstructingTabSendsTheContextPairs,
};
