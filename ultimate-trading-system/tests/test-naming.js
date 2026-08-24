// A NAME THE OWNER GIVES REACHES EVERY SCREEN THAT SHOWS THE THING
// (owner, 2026-08-19: "is there a reason the name i give to a config under
// greenlights is still not propagating to setups and setup detail and live?").
//
// It did not, for two separate reasons that looked like one symptom:
//   * a setup takes a COPY of the name when it is shuttled from the greenlight,
//     and relabel() wrote only the greenlight — so Setups and Setup detail kept
//     the old label;
//   * the LIVE banner rendered the raw generated id and never a name at all, so
//     no amount of renaming could ever change it.
//
// Three screens, three names for one config, while it held real money.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'trade.html'), 'utf8');

function withTempDirs(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-naming-'));
  const prevG = process.env.GC_GREENLIGHTS_DIR;
  const prevS = process.env.GC_SETUPS_DIR;
  process.env.GC_GREENLIGHTS_DIR = path.join(base, 'gl');
  process.env.GC_SETUPS_DIR = path.join(base, 'setups');
  fs.mkdirSync(process.env.GC_GREENLIGHTS_DIR, { recursive: true });
  fs.mkdirSync(process.env.GC_SETUPS_DIR, { recursive: true });
  try { return fn(base); } finally {
    if (prevG === undefined) delete process.env.GC_GREENLIGHTS_DIR; else process.env.GC_GREENLIGHTS_DIR = prevG;
    if (prevS === undefined) delete process.env.GC_SETUPS_DIR; else process.env.GC_SETUPS_DIR = prevS;
    fs.rmSync(base, { recursive: true, force: true });
  }
}

function renamingTheConfigRenamesItsDeployments() {
  withTempDirs(() => {
    const gl = require(path.join(ROOT, 'lib', 'live', 'greenlight'));
    const reg = require(path.join(ROOT, 'lib', 'live', 'setups'));
    const id = 'gl-name-prop';
    fs.writeFileSync(path.join(process.env.GC_GREENLIGHTS_DIR, `${id}.json`),
      JSON.stringify({ id, name: 'old label', why: 'because', campaign: 'c1', configSnapshot: {} }));
    fs.writeFileSync(path.join(process.env.GC_SETUPS_DIR, 'setup-derived.json'), JSON.stringify({
      id: 'setup-derived', ownerId: 'owner', name: 'old label', state: 'live', clipUsd: 10,
      tradedPair: 'LTCUSDT', provenanceRef: id, configSnapshot: {}, stateHistory: [],
    }));
    // a setup from a DIFFERENT config must not be touched
    fs.writeFileSync(path.join(process.env.GC_SETUPS_DIR, 'setup-other.json'), JSON.stringify({
      id: 'setup-other', ownerId: 'owner', name: 'someone else', state: 'live', clipUsd: 10,
      tradedPair: 'XRPUSDT', provenanceRef: 'gl-different', configSnapshot: {}, stateHistory: [],
    }));

    gl.relabel(id, { name: 'USER CONTROLLED LTC TRADE' });
    assert.strictEqual(reg.getSetup('setup-derived').name, 'USER CONTROLLED LTC TRADE',
      'the deployment kept the old name — Setups and Setup detail still show it while it trades');
    assert.strictEqual(reg.getSetup('setup-other').name, 'someone else',
      'the rename leaked onto a config it was not for');
  });
}

function whyAndCampaignDoNotPropagate() {
  withTempDirs(() => {
    const gl = require(path.join(ROOT, 'lib', 'live', 'greenlight'));
    const reg = require(path.join(ROOT, 'lib', 'live', 'setups'));
    const id = 'gl-why-only';
    fs.writeFileSync(path.join(process.env.GC_GREENLIGHTS_DIR, `${id}.json`),
      JSON.stringify({ id, name: 'keep me', why: 'first reason', campaign: 'c1', configSnapshot: {} }));
    fs.writeFileSync(path.join(process.env.GC_SETUPS_DIR, 'setup-w.json'), JSON.stringify({
      id: 'setup-w', ownerId: 'owner', name: 'keep me', state: 'stopped', clipUsd: 10,
      tradedPair: 'LTCUSDT', provenanceRef: id, configSnapshot: {}, stateHistory: [],
    }));
    gl.relabel(id, { why: 'a better reason' });
    const s = reg.getSetup('setup-w');
    assert.strictEqual(s.name, 'keep me', 'editing only the why renamed the deployment');
    assert.strictEqual(s.why, undefined,
      'the reasoning that cleared a config was copied onto a deployment, which does not carry it');
  });
}

function theLiveScreenShowsTheNameNotOnlyTheGeneratedId() {
  assert.ok(/<b>\$\{esc\(g\.name\|\|g\.id\)\}<\/b>/.test(HTML),
    'the LIVE banner renders the generated id by construction, so renaming can never change it');
  assert.ok(/\$\{g\.name\?` <span class="muted">· \$\{esc\(g\.id\)\}<\/span>`:''\}/.test(HTML),
    'the id vanished entirely — it is still what the logs and the box use, so it must stay visible');
}

// ---- the wallet line -------------------------------------------------------

function theWalletShowsThePositionNotTheSpendableBalance() {
  // "0.000000 LTC on the live page. we're not net 0 on ltc" — it rendered the
  // FREE balance, which on a borrow-to-short engine is zero by construction.
  assert.ok(!/wb\.ltcFree/.test(HTML),
    'the wallet line still shows the FREE balance, which is 0 whenever the engine is short');
  assert.ok(/const walletCell=/.test(HTML), 'the wallet cell is gone');
  const cell = HTML.match(/const walletCell=[\s\S]*?\n\};/)[0];
  // Specifically: the QUANTITY RENDERED must come from net. Matching "wb.baseNet"
  // anywhere in the cell was too loose — it also appears in the null-guard, so
  // swapping the displayed value back to the free balance left the test green.
  assert.ok(/const bn=wb\.baseNet\b/.test(cell),
    'the displayed quantity is not the NET position — on a borrow-to-short engine the free '
    + 'balance is 0 by construction, so the screen would read "flat" while holding a short');
  assert.ok(/short — borrowed/.test(cell),
    'a negative balance is not labelled as a short, so a minus sign carries the whole meaning');
  assert.ok(/wb\.baseAsset\|\|'base'/.test(cell),
    'the asset ticker is hardcoded again — this screen serves whatever pair a profile trades');
}

function theViewNamesBalancesByRoleNotByTicker() {
  // Strip comments: the note explaining WHY the old names are gone necessarily
  // names them, and a test that cannot tell prose from code fails on its own
  // documentation.
  const bv = fs.readFileSync(path.join(ROOT, 'lib', 'boxview.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/ltcFree|ltcNet|usdtFree|usdtNet/.test(bv),
    'the box view names one pair\'s tickers in fields that describe whatever the wallet holds');
  assert.ok(/baseNet: n\(e\.base_net\)/.test(bv) && /quoteAsset: e\.quote_asset/.test(bv),
    'the view does not carry the role-named balances and their asset names');
}

// ---- a zero stop is no stop ------------------------------------------------

function aZeroProtectiveStopIsNotShownAsHealthy() {
  const cell = HTML.match(/const stopCell=[\s\S]*?\n\};/)[0];
  assert.ok(/v<=0/.test(cell) && /that is NO stop/.test(cell),
    'a 0.00% stop still takes the healthy branch — green, and "applied to every order", for no protection');
  // TWO THRESHOLDS, TOLD APART (2026-08-23). This used to require one check at
  // the literal 0.005 and described it as "below the round-trip fee" — but
  // 0.005 is TWICE the round trip, so a 0.4% stop, which clears the round trip
  // comfortably, was reported to the owner as a guaranteed loss. They mean
  // different things and the screen has to say which is which:
  //   below the round trip  a trigger cannot win; the fees exceed the move
  //   below the floor       it fires on ordinary hourly noise
  assert.ok(/v<trip/.test(cell),
    'a stop below what it costs to trade in and out is shown as protective, but triggering it is a '
    + 'guaranteed loss');
  assert.ok(/v<floor/.test(cell),
    'a stop above the round trip but below the floor is shown as healthy — it will stop out on noise');
  assert.ok(/guaranteed loss/.test(cell) && /hourly noise/.test(cell),
    'the two warnings say the same thing, so the owner cannot tell which problem they have');
  // Comments stripped: the note explaining why this changed necessarily quotes
  // the wording that is gone, and a check that cannot tell prose from code
  // fails on its own documentation.
  const cellCode = cell.replace(/\/\/[^\n]*/g, '');
  assert.ok(!/0\.005/.test(cellCode) && !/0\.25% round-trip/.test(cellCode),
    'the stop cell writes the floor down again — it follows the trading fee now, and a copy on the '
    + 'screen is right only until the fee moves');
  assert.ok(/trip==null\|\|floor==null/.test(cellCode),
    'the cell judges a stop even when it was not told what trading costs — a verdict from a guessed '
    + 'threshold is worse than no verdict');
  assert.ok(!/\$\{b\.fixedStopPct!=null\?`<span class="pos">/.test(HTML),
    'the old null-only test is back, so zero reads as protected again');
}

// ---- the retired screen stays retired --------------------------------------

function theRetiredPilotScreenIsGone() {
  assert.ok(!fs.existsSync(path.join(ROOT, 'public', 'pilot.html')),
    'public/pilot.html is back. It is the retired single-config screen; it is served next to the '
    + 'real one and shows stale numbers from fields nothing writes any more');
  assert.ok(!fs.existsSync(path.join(ROOT, 'public', 'livetrade.html')),
    'public/livetrade.html is back');
}

// NARROWING THE GATE MUST NOT DISARM IT. The live-executability gate stops a
// trading setup being re-pointed at a box that cannot serve it, or stripped of
// the sub-account that keeps its borrow pool separate. Scoping it to routing
// changes fixes the rename; it must not weaken the case it exists for.
function repointingATradingSetupIsStillRefused() {
  withTempDirs(() => {
    const reg = require(path.join(ROOT, 'lib', 'live', 'setups'));
    fs.writeFileSync(path.join(process.env.GC_SETUPS_DIR, 'setup-live.json'), JSON.stringify({
      id: 'setup-live', ownerId: 'owner', name: 'trading', state: 'live', clipUsd: 10,
      tradedPair: 'LTCUSDT', provenanceRef: 'gl-x', keyRef: 'mx-ltc-1',
      executionTargetRef: 'mx-1', configSnapshot: {}, stateHistory: [],
    }));
    // stripping the sub-account off a LIVE setup is the isolation hazard
    assert.throws(() => reg.updateSetup('setup-live', { keyRef: null }),
      /keyRef|sub-account/i,
      'a live setup can be stripped of its own sub-account, so its borrow pool '
      + 'mingles with another setup and the per-setup P&L stops meaning anything');
    // the rename beside it must still go through
    const out = reg.updateSetup('setup-live', { name: 'renamed while trading' });
    assert.strictEqual(out.name, 'renamed while trading',
      'renaming a trading setup is refused again — a label cannot affect routing');
  });
}

// LIVE PAGES ACROSS EVERY RUNNING CONFIG (#39). It rendered one — whichever was
// selected elsewhere, or the first that happened to have a channel — with nothing
// saying others existed. Invisible with one config; with two it silently hides a
// book holding money.
function theLiveViewCanReachEveryRunningConfig() {
  assert.ok(/const running=configs\.filter\(x=>chanOf\(x\)\)/.test(HTML),
    'the LIVE view does not enumerate the configs running on this side');
  assert.ok(/id="liveWhich"/.test(HTML), 'there is no control to switch between running configs');
  assert.ok(/running\.length>1/.test(HTML),
    'the picker is drawn unconditionally or never — it belongs when there is more than one');
  assert.ok(/esc\(x\.name\|\|x\.id\)/.test(HTML),
    'the picker lists generated ids rather than the names the owner gave');
  assert.ok(/lw\.onchange=\(\)=>\{ selectedConfig=lw\.value; drawLive\(\); \}/.test(HTML),
    'the picker is rendered but changing it does nothing');
}

// A CHOSEN "no stop" IS NOT A FORGOTTEN ONE (owner, 2026-08-19: "leave it with
// no stop", after a full-history scan showed every level net negative). The
// engine is identical either way; the record must not be, or a decision taken
// against seven years of evidence reads as an oversight nobody got to.
function aChosenNoStopReadsDifferentlyFromAnUnsetOne() {
  const cell = HTML.match(/const stopCell=[\s\S]*?\n\};/)[0];
  assert.ok(/choice&&choice\.chosen/.test(cell),
    'the screen cannot tell a recorded choice of none from never having chosen');
  assert.ok(/no choice has been recorded/.test(cell),
    'an unset stop no longer says that no choice was recorded, so a gap reads as a decision');
  assert.ok(/none — your choice/.test(cell),
    'a recorded choice of none is not shown as a choice');
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(/fixedStopChoice: readFixedStop\(\)/.test(server),
    'the screen is never sent the recorded choice, so it cannot show one');
  assert.ok(/return \{ stopPct: null, chosen: false, why: null \};/.test(server),
    'a missing choice file no longer reports chosen:false, so never-chosen looks chosen');
  assert.ok(/typeof req\.body\.why === 'string'/.test(server),
    'the apply endpoint discards the reasoning, so only the number survives');
}

module.exports = {
  aChosenNoStopReadsDifferentlyFromAnUnsetOne,
  theLiveViewCanReachEveryRunningConfig,
  repointingATradingSetupIsStillRefused,
  renamingTheConfigRenamesItsDeployments,
  whyAndCampaignDoNotPropagate,
  theLiveScreenShowsTheNameNotOnlyTheGeneratedId,
  theWalletShowsThePositionNotTheSpendableBalance,
  theViewNamesBalancesByRoleNotByTicker,
  aZeroProtectiveStopIsNotShownAsHealthy,
  theRetiredPilotScreenIsGone,
};
