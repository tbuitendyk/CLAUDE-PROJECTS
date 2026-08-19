// ONE definition of "which pairs does this system need" (owner, 2026-08-19).
//
// It had four: the refresher and three checking scripts. They had already
// disagreed — one looked in configSnapshot.members[], which carries {model,
// view} and no symbol, so it matched nothing, fell back to the traded pair
// alone, and printed a healthy line for one pair while the two context pairs
// the committee also reads went unwatched. A monitor that reports a subset as
// the whole is worse than no monitor, because it is believed.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pairs = require(path.join(ROOT, 'lib', 'live', 'pairs'));

function theContextPairsAreIncludedNotJustTheTradedOne() {
  const got = pairs.pairsForSetups([{
    state: 'live', tradedPair: 'LTCUSDT',
    configSnapshot: { combo: { trade: 'LTCUSDT', ctx1: 'XRPUSDT', ctx2: 'BCHUSDT' } },
  }]);
  assert.deepStrictEqual(got, ['BCHUSDT', 'LTCUSDT', 'XRPUSDT'],
    'the context pairs are dropped — the committee reads them, so their candles must stay current');
}

function membersCarryNoSymbolSoTheyAreNotTheSource() {
  // The exact shape of the defect: a snapshot with members but no combo must
  // yield only what is genuinely known, never a confident single-pair answer
  // dressed up as the whole set.
  const got = pairs.pairsForSetups([{
    state: 'live', tradedPair: 'LTCUSDT',
    configSnapshot: { members: [{ model: 'logreg', view: 'full' }, { model: 'logreg', view: 'cross' }] },
  }]);
  assert.deepStrictEqual(got, ['LTCUSDT'], 'members[] must never be mined for symbols — they have none');
}

function stoppedSetupsStillNeedTheirData() {
  // Stopping halts NEW entries; open positions still run to their exits, and
  // the reproduce-check still recomputes. Both need current candles.
  const of = (state) => pairs.pairsForSetups([{ state, configSnapshot: { combo: { trade: 'AAA' } } }]);
  assert.deepStrictEqual(of('stopped'), ['AAA'], 'a stopped setup stops being refreshed while it still holds positions');
  assert.deepStrictEqual(of('paper'), ['AAA'], 'a paper setup is not refreshed');
  assert.deepStrictEqual(of('draft'), [], 'a draft that never traded is being refreshed for nothing');
  assert.deepStrictEqual(of('retired'), [], 'a retired setup is still being refreshed');
}

function thereIsExactlyOneDefinitionOfTheQuestion() {
  // The refresher must ASK, not re-derive.
  const refresh = fs.readFileSync(path.join(ROOT, 'pilot-refresh.js'), 'utf8');
  assert.ok(/require\('\.\/lib\/live\/pairs'\)/.test(refresh),
    'pilot-refresh.js no longer uses the shared helper');
  const code = refresh.replace(/\/\/[^\n]*/g, '');
  assert.ok(!/ctx1/.test(code),
    'pilot-refresh.js re-derives the pair list itself again — that is the fourth copy coming back');
  // and the shell scripts must be able to ask over HTTP
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(/app\.get\('\/api\/live\/pairs'/.test(server),
    'there is no endpoint for the checking scripts to ask, so they will re-derive it');
}

function anUnreadableRegistryIsNotAnEmptyList() {
  // "no pairs" reads to every caller as "nothing needs watching". An error must
  // stay an error.
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const handler = server.match(/app\.get\('\/api\/live\/pairs'[\s\S]{0,700}?\n\}\);/)[0];
  assert.ok(/res\.status\(500\)/.test(handler),
    'the pairs endpoint swallows a registry failure into a 200, so a broken registry reads as "nothing to watch"');
}

module.exports = {
  theContextPairsAreIncludedNotJustTheTradedOne,
  membersCarryNoSymbolSoTheyAreNotTheSource,
  stoppedSetupsStillNeedTheirData,
  thereIsExactlyOneDefinitionOfTheQuestion,
  anUnreadableRegistryIsNotAnEmptyList,
};
