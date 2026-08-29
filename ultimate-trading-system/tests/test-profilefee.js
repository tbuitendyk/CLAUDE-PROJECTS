// THE TRADING FEE BELONGS TO THE PROFILE (owner order, 2026-08-23).
//
// "we're going to need to have a trading fee percentage that can be set per
// trading profile. And, of course, the trading profiles might be on Binance,
// might be on other servers. So for each configuration where the software is
// actually trading, and for that matter, where we're training and searching
// with sweeps, we need to be able to set that percentage. It needs to be
// exposed. And, of course, the live trading is gonna get it from the server,
// but it does need to be per configuration."
//
// Four things have to hold, and each is a separate way this could be wrong:
//   1. a profile carries its own rate, editable, and refuses a silly one;
//   2. a profile that has never been set says so instead of presenting the lab
//      rate as somebody's decision;
//   3. the rate follows the evidence — a profile shuttled from a greenlight
//      starts at the cost its board was actually found under, because a profile
//      trading at a different cost is not trading what was greenlighted;
//   4. it is on the screens (RULE FIVE) — a setting only reachable through a
//      hand-written request is not exposed.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { assert } = require('./helpers');
const { FEE_PER_LEG, MAX_FEE_PER_LEG } = require('../lib/paper');

const ROOT = path.join(__dirname, '..');
const CONSTRUCT = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
const TRADE = fs.readFileSync(path.join(ROOT, 'public', 'trade.html'), 'utf8');

// A whole config snapshot the shared vocabulary accepts, built from the SAME
// source the engine freezes so it cannot drift from the real shape. Taken from
// tests/test-live-setups.js, where it is already the canonical fixture.
function snapshot() {
  const { A_CUTOFF_MS, aSetupConfig } = require('./fixtures-setup');
  const F1 = aSetupConfig();
  return {
    combo: { ...F1.combo },
    branch: { ...F1.branch },
    stage: F1.stage,
    members: F1.members.map((m) => ({ ...m })),
    cell: { ...F1.cell },
    trainThrough: A_CUTOFF_MS,
    configVersion: 'profile-fee-test',
  };
}

function withRegistry(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profilefee-'));
  const prev = process.env.GC_SETUPS_DIR;
  process.env.GC_SETUPS_DIR = dir;
  delete require.cache[require.resolve('../lib/live/setups')];
  const reg = require('../lib/live/setups');
  try { return fn(reg); } finally {
    if (prev === undefined) delete process.env.GC_SETUPS_DIR; else process.env.GC_SETUPS_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
    delete require.cache[require.resolve('../lib/live/setups')];
  }
}

module.exports = {
  // 1. Its own rate, and it can be changed without touching the frozen rule.
  async aProfileCarriesItsOwnFeeAndItCanBeChanged() {
    withRegistry((reg) => {
      const s = reg.createSetup({
        id: 'fee-a', name: 'venue A', ownerId: 'owner', configSnapshot: snapshot(),
        clipUsd: 10, feePerLeg: 0.001,
      });
      assert.strictEqual(reg.setupFee(s), 0.001, 'the profile must price at what it was given');
      assert.strictEqual(reg.feeIsInherited(s), false, 'and that is a choice, not an inheritance');
      const after = reg.updateSetup('fee-a', { feePerLeg: 0.0004 });
      assert.strictEqual(reg.setupFee(after), 0.0004, 'the fee is operational and editable');
      // The rule it runs is untouched by the edit — the whole point of the
      // fee being operational rather than part of the frozen snapshot.
      assert.deepStrictEqual(after.configSnapshot, s.configSnapshot,
        'editing what it costs must not touch what it trades');
    });
  },

  // Two profiles, same rule, different venues, different cost. This is the
  // case the owner named, so it is the case that gets a test.
  async twoProfilesOnTheSameRuleMayCostDifferentAmounts() {
    withRegistry((reg) => {
      const cfg = snapshot();
      const a = reg.createSetup({ id: 'venue-a', name: 'A', ownerId: 'o', configSnapshot: cfg, clipUsd: 10, feePerLeg: 0.001 });
      const b = reg.createSetup({ id: 'venue-b', name: 'B', ownerId: 'o', configSnapshot: cfg, clipUsd: 10, feePerLeg: 0.0026 });
      assert.notStrictEqual(reg.setupFee(a), reg.setupFee(b),
        'the same rule on two venues must be allowed to cost two different amounts');
      assert.deepStrictEqual(a.configSnapshot, b.configSnapshot, 'and it is still the same rule');
    });
  },

  // A fee nobody could mean is refused, in the units the box on screen uses.
  async aFeeNobodyCouldMeanIsRefused() {
    withRegistry((reg) => {
      for (const bad of [MAX_FEE_PER_LEG, 0.125, 1, -0.001]) {
        let err = null;
        try {
          reg.createSetup({ id: `bad-${String(bad).replace(/[^a-z0-9]/gi, '')}x`, name: 'bad', ownerId: 'o',
            configSnapshot: snapshot(), clipUsd: 10, feePerLeg: bad });
        } catch (e) { err = e; }
        assert.ok(err, `a fee of ${bad} a leg was accepted`);
        assert.ok(/feePerLeg/.test(err.message), `refused for the wrong reason: ${err.message}`);
      }
      // and the ceiling message talks in percents, because the box does
      let err = null;
      try {
        reg.createSetup({ id: 'bad-pct', name: 'bad', ownerId: 'o', configSnapshot: snapshot(), clipUsd: 10, feePerLeg: 0.2 });
      } catch (e) { err = e; }
      assert.ok(/%/.test(err.message), `the refusal must be in percents, the units on the screen: ${err.message}`);
    });
  },

  // 2. Never set is not the same as set to the default, and the record says which.
  async aProfileThatWasNeverSetSaysItInheritedTheRate() {
    withRegistry((reg) => {
      const s = reg.createSetup({ id: 'fee-none', name: 'no fee', ownerId: 'o', configSnapshot: snapshot(), clipUsd: 10 });
      assert.strictEqual(s.feePerLeg, null, 'nothing was chosen, so nothing is stored');
      assert.strictEqual(reg.setupFee(s), FEE_PER_LEG, 'it prices at the lab rate, which is what it was always priced at');
      assert.strictEqual(reg.feeIsInherited(s), true, 'and the screen can say that is inherited, not chosen');
      // A record written before any of this existed reads the same way.
      assert.strictEqual(reg.setupFee({ id: 'legacy' }), FEE_PER_LEG);
      assert.strictEqual(reg.feeIsInherited({ id: 'legacy' }), true);
    });
  },

  // 3. The rate follows the evidence, from the run through the greenlight to
  // the profile — so a live book is priced at what its board was found under
  // unless the owner deliberately changes it.
  async theRateFollowsTheEvidenceFromTheRunToTheProfile() {
    const gl = require('../lib/live/greenlight');
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'greenlight.js'), 'utf8');
    assert.ok(/feePerLeg: feeFracOf\(doc\.params\)/.test(src),
      'the greenlight does not record the fee its board was found under, so a profile made from it '
      + 'has nothing to inherit and the live arithmetic silently parts company with the evidence');
    assert.ok(/feePerLeg: Number\.isFinite\(feePerLeg\) \? feePerLeg : \(\(gl\.sourceRun \|\| \{\}\)\.feePerLeg \?\? null\)/.test(src),
      'the shuttle does not carry the evidence rate onto the new profile');
    assert.strictEqual(typeof gl.shuttle, 'function');
  },

  // 4. THE LIVE PATH PRICES AT THE PROFILE'S RATE, not zero and not nothing.
  //
  // It was hard-coded to feePerLeg: 0 and, worse, handed trainMembers no fee
  // argument at all — so a directional committee, whose threshold is chosen BY
  // pricing candidates against the cost of trading, was trained with the fee
  // undefined. lib/bracket.js refuses that outright.
  async theLiveDecisionIsPricedAtTheProfilesOwnRate() {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'signal.js'), 'utf8');
    assert.ok(!/feePerLeg:\s*0\b/.test(src),
      'the live path still prices its own decisions as if trading were free');
    assert.ok(/const fee = setupFee\(setup\)/.test(src),
      'the live path does not take its fee from the profile');
    assert.ok(/feePerLeg: fee/.test(src), 'and does not pass it to the build');
    assert.ok(/trainMembers\([^)]*geo, feePerLeg\)/.test(src),
      'trainMembers is still called without a fee, so a directional committee cannot be trained at all');
    const calls = src.match(/committeeCallFor\(cfg, target, trainChunks, maps, geo, views, bandPct, freeze\.throughMs, fee\)/g) || [];
    assert.strictEqual(calls.length, 3, `all three live callers must pass the fee; ${calls.length} do`);
  },

  // 5. THE SWEEP CAN SET IT TOO — "for that matter, where we're training and
  // searching with sweeps".
  // RE-AIMED 2026-08-28 at the surviving screen. The old Sweep sent the fee on
  // its launch body; the three-stage Sweep sends it on the stage 3 launch,
  // which is the first place a trade is priced at all.
  async theSweepCanBePricedFromTheScreen() {
    assert.ok(/id="swFee"/.test(CONSTRUCT), 'the Sweep section has no box for what a trade costs');
    assert.ok(/fee: Number\(\$\('#swFee'\)\.value\) \/ 100/.test(CONSTRUCT),
      'the Sweep section has the box but does not send it, or sends a percent where a fraction belongs');
    // ...and the engine must refuse a cost it cannot price a trade at, rather
    // than running free and flattering every number on the page.
    const stages = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.ok(/if \(!Number\.isFinite\(fee\) \|\| fee < 0 \|\| fee > 0\.05\)/.test(stages),
      'stage 3 no longer checks the fee it was handed');
    //
    // A GAP, RECORDED RATHER THAN ASSERTED AWAY (found 2026-08-28, reported to
    // the owner, not fixed — it is not part of the rename that was authorised).
    // The old Sweep sent `undefined` for an EMPTY fee box so the engine fell
    // back to the lab rate. The three-stage Sweep sends Number('') / 100, which
    // is 0, and the check above lets 0 through — so clearing that box buys a
    // free run whose every number is flattered. The box carries a default and
    // has to be deliberately emptied, which is why this is a gap and not a
    // live fault, but it is the exact mistake the deleted assertion existed to
    // stop. The fix is the owner's to authorise.
  },

  // 6. RULE FIVE: it is on the screens, not only in the request body.
  async everyPlaceThatTradesShowsAndSetsIt() {
    assert.ok(/id="feeIn"/.test(TRADE), 'a trading profile cannot be priced from its own screen');
    assert.ok(/body\.feePerLeg=Number\(feeRaw\)\/100/.test(TRADE),
      'the box on the profile screen does not reach the record, or sends percent where a fraction belongs');
    assert.ok(/tile\('Fee','feeModel'/.test(TRADE), 'the profile does not show what it is priced at');
    assert.ok(/tile\('Fee paid','feeReal'/.test(TRADE),
      'the fee the venue actually charged is still computed and thrown away — "the live trading is gonna '
      + 'get it from the server" is the half of this the owner asked for by name');
    assert.ok(/th\('fee','fee'\)/.test(TRADE), 'the list of profiles does not show what each one costs');
  },

  // THE PROTECTIVE-STOP FLOOR FOLLOWS THIS PROFILE'S FEE (owner order,
  // 2026-08-23: "fix the stop floor so it follows the profile fee").
  //
  // It was the literal 0.005 in two files, and both comments called it DERIVED
  // from the round-trip fee — true until the fee became per-profile. A venue
  // charging 0.3% a leg has a 0.6% round trip, so a 0.5% stop there loses money
  // every time it fires, and the old floor called that safe.
  //
  // The same stop, accepted on one profile and refused on another, is the whole
  // of it. Nothing in the suite checked this until a deliberate break showed
  // the floor could be pinned back to the lab rate with everything still green.
  async theStopFloorMovesWithTheProfilesOwnFee() {
    withRegistry((reg) => {
      const mk = (id, over) => {
        try {
          reg.createSetup({ id, name: id, ownerId: 'o', configSnapshot: snapshot(), clipUsd: 10, ...over });
          return null;
        } catch (e) { return e.message; }
      };
      // 0.6% stop. At the lab rate (0.125% a leg) the floor is 0.5%, so it is fine.
      assert.strictEqual(mk('floor-cheap', { stopPct: 0.006 }), null,
        'a 0.6% stop is above the lab-rate floor of 0.5% and must be accepted');
      // The same 0.6% stop on a venue charging 0.3% a leg is exactly its round
      // trip — a trigger there cannot win — and the floor is twice that.
      const dear = mk('floor-dear', { feePerLeg: 0.003, stopPct: 0.006 });
      assert.ok(dear, 'a 0.6% stop was accepted on a profile whose round trip IS 0.6% — a trigger cannot win');
      assert.ok(/1\.200% floor/.test(dear), `the refusal must name THIS profile's floor; got: ${dear}`);
      assert.ok(/0\.600%/.test(dear) && /0\.300% each way/.test(dear),
        'the refusal must show the round trip and the fee it came from, or the owner cannot check it');
      assert.strictEqual(mk('floor-dear-ok', { feePerLeg: 0.003, stopPct: 0.015 }), null,
        'a 1.5% stop clears that profile\'s 1.2% floor and must be accepted');
      // And it moves DOWN as well as up: a cheap venue must not be held to a
      // floor built for an expensive one.
      assert.strictEqual(mk('floor-tiny', { feePerLeg: 0.0002, stopPct: 0.002 }), null,
        'a 0.2% stop on a venue charging 0.02% a leg was refused against somebody else\'s floor');
    });
  },

  // A fee that is itself out of range must not turn the validator into a throw:
  // its job is to gather every problem and return them together.
  async anImpossibleFeeReportsItselfRatherThanBreakingTheStopCheck() {
    withRegistry((reg) => {
      let err = null;
      try {
        reg.createSetup({ id: 'floor-absurd', name: 'x', ownerId: 'o', configSnapshot: snapshot(),
          clipUsd: 10, feePerLeg: 0.2, stopPct: 0.006 });
      } catch (e) { err = e; }
      assert.ok(err, 'a 20%-a-leg fee was accepted');
      assert.ok(/feePerLeg/.test(err.message),
        `the fee is the problem and must be what is reported; got: ${err.message}`);
      assert.strictEqual(err.code, 'BAD_SETUP',
        'deriving a floor from an impossible fee threw instead of collecting the error');
    });
  },

  // RULE TWO: Paper Books and Live Trading are drawn by one path, so the fee
  // cannot appear on one and not the other. The only difference allowed is the
  // deliberate one: a paper book pays no venue fee, and says so.
  async paperAndLiveShowTheFeeIdentically() {
    // Exactly the block that draws the two fee tiles — found by its own
    // markers, not by a guessed number of characters either side.
    const a = TRADE.indexOf('// FEE MODELLED AGAINST FEE PAID');
    assert.ok(a > 0, 'the fee tiles are gone from the profile screen');
    const b = TRADE.indexOf("})()}", a);
    const block = TRADE.slice(a, b);
    const branchTests = (block.match(/\bisP\b/g) || []).length;
    assert.strictEqual(branchTests, 2,
      'the fee tiles branch on paper-versus-live in more places than the one that is deliberate: whether a '
      + `paid fee exists at all. Found ${branchTests} uses of the paper test in that block, which is where `
      + 'the two screens quietly stop matching (RULE TWO)');
    assert.ok(/paper — no venue fee/.test(block),
      'a paper book shows a paid-fee number it cannot have, instead of saying it has none');
    assert.ok(!/isP/.test(block.slice(block.indexOf("tile('Fee','feeModel'"), block.indexOf("tile('Fee paid'"))),
      'the MODELLED fee is drawn differently for a paper book than for a live one — it is the same number '
      + 'either way, and a paper book that prices differently from the live one beside it is worthless as a '
      + 'comparison');
  },
};
