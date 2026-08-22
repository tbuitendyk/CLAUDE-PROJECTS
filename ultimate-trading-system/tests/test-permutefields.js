// WHAT THE RUN WILL SCORE DECIDES WHAT IS ON SCREEN (owner, 2026-08-22).
//
// The owner asked: "shouldn't the gate, d, trail, and arm all appear when
// entry is permuted?" Yes, and two things were wrong.
//
//   1. The row decided what to show from the entry dropdown ALONE. Tick permute
//      beside entry with the box reading market and gate, d, trail and arm all
//      vanished — while breakout was going into the run and needed every one of
//      them. The page then sent none, and Start sweep came back refused naming
//      "gate", a control that was not on screen to set. Nothing ran.
//
//   2. arm was hidden whenever the trail box was blank. Tick permute beside
//      trail and four moving-stop configs were scored at arm 0x — a value
//      chosen in code, never shown, never the owner's. That is RULE FIVE: no
//      operational setting the operator cannot see and originate.
//
// One rule now decides both visibility and what is sent, and it is stated in
// terms of the RUN: rails ride whenever breakout is in it, an arm rides
// whenever a moving stop is in it. These tests hold the page and the server to
// the same rule, and check the count the row prints against the set the server
// really builds.
//
// Watched failing 2026-08-22: reverting syncDecEntry to `=== 'market'` fails
// theRowShowsEveryBoxTheRunWillUse; reverting the launch body fails
// everyVisibleBoxIsSent; restoring the flat product in syncDecCount fails
// thePrintedCountIsTheSetTheServerBuilds; and dropping the armMult carry in
// expandDeclared fails aPermutedTrailUsesTheArmTheOperatorSet.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const batch = require('../lib/batch');
const bracketLib = require('../lib/bracket');

const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
const GRID = {
  entries: bracketLib.ENTRIES.slice(),
  gates: bracketLib.GATES.slice(),
  dMults: bracketLib.D_MULTS.slice(),
  tHours: bracketLib.T_HOURS.slice(),
  trailMults: bracketLib.TRAIL_MULTS.slice(),
  armMults: bracketLib.ARM_MULTS.slice(),
};

// ---------------------------------------------------------------------------
// The page's own code, run against a stubbed screen. Slicing the shipped source
// rather than restating it is the point: a formula copied into a test only ever
// proves the copy.
function sliceOut(from, to, what) {
  const a = PAGE.indexOf(from);
  assert.ok(a > 0, `${what}: cannot find the start of it in construct.js — the test needs updating`);
  const b = PAGE.indexOf(to, a);
  assert.ok(b > a, `${what}: cannot find the end of it in construct.js — the test needs updating`);
  return PAGE.slice(a, b);
}

// A control stub. Booleans are ticks, strings are dropdowns. Anything the code
// reads that the state does not name is a mistake in the test, not a default.
function screen(state) {
  return (sel) => {
    const id = sel.replace('#', '');
    if (id === 'swDecCount') return { textContent: '', innerHTML: '' };
    if (!Object.prototype.hasOwnProperty.call(state, id)) {
      throw new Error(`the page reads #${id} and the test does not model it`);
    }
    const v = state[id];
    return typeof v === 'boolean' ? { checked: v, value: '' } : { checked: true, value: String(v) };
  };
}

// The menus and the arithmetic, taken separately so the slice never straddles
// half of syncDecEntry's own function wrapper.
const MENUS_SRC = sliceOut('const MENUS = {', '\n  const syncDecCount', 'the declared-config menu sizes');
const COUNT_SRC = sliceOut('    const permEntry = ', '    el.innerHTML = n === 1', 'the declared-config count');
function countOnScreen(state) {
  return new Function('$', `${MENUS_SRC}\n${COUNT_SRC}\n return n;`)(screen(state));
}

const BODY_SRC = sliceOut('      const rails = entry !== ', '\n      };', 'the declared request body');
function declaredSent(state) {
  const qPart = { quorumSingles: Number(state.swDecQ6) };
  const dp = {
    entry: state.swPermDecEntry, gate: state.swPermDecGate, dMult: state.swPermDecD,
    tHours: state.swPermDecT, trail: state.swPermDecTrail, arm: state.swPermDecArm,
    agree: state.swPermDecAgree,
  };
  const body = {};
  new Function('$', 'entry', 'trailRaw', 'dp', 'qPart', 'body', `${BODY_SRC}\n      };`)(
    screen(state), state.swDecEntry, state.swDecTrail, dp, qPart, body,
  );
  return { declared: body.declared, permute: dp };
}

// The visibility rule, run out of the shipped function for the same reason.
const VIS_SRC = sliceOut('  const syncDecEntry = () => {', '\n  };', 'the replication row visibility rule');
function visibleGroups(state) {
  const shown = {};
  const $ = (sel) => {
    const id = sel.replace('#', '');
    if (id.startsWith('swGrp')) {
      return { get style() { return { set display(v) { shown[id] = v !== 'none'; }, get display() { return ''; } }; } };
    }
    return screen(state)(sel);
  };
  new Function('$', `${VIS_SRC}\n  };\n syncDecEntry();`)($);
  return shown;
}

const BASE_STATE = {
  swDecOn: true,
  swDecEntry: 'breakout', swDecGate: 'always', swDecD: '1', swDecT: '41',
  swDecTrail: '', swDecArm: '0', swDecQ6: '4', swDecQ8: '3',
  swSingles: true, swDoubles: false, swTriples: false,
  swPermDecEntry: false, swPermDecGate: false, swPermDecD: false, swPermDecT: false,
  swPermDecTrail: false, swPermDecArm: false, swPermDecAgree: false,
};
const st = (over) => ({ ...BASE_STATE, ...over });

module.exports = {
  // ------------------------------------------------------------------ screen
  // The defect the owner found. Permuting entry puts breakout in the run, so
  // every box a breakout cell needs has to be on screen to be set.
  theRowShowsEveryBoxTheRunWillUse() {
    // market on its own: no rails, exactly as before
    let v = visibleGroups(st({ swDecEntry: 'market' }));
    for (const g of ['swGrpGate', 'swGrpD', 'swGrpTrail', 'swGrpArm']) {
      assert.strictEqual(v[g], false, `${g} must stay hidden for a plain market entry`);
    }
    // market WITH entry permuted: breakout is in the run, so the rails are too
    v = visibleGroups(st({ swDecEntry: 'market', swPermDecEntry: true }));
    for (const g of ['swGrpGate', 'swGrpD', 'swGrpTrail']) {
      assert.strictEqual(v[g], true,
        `${g} is hidden while entry is permuted — breakout cells need it and the operator cannot set it`);
    }
  },

  // arm belongs to a MOVING stop, and permuting trail creates moving stops out
  // of a box that reads static.
  theArmBoxAppearsWheneverAMovingStopIsInTheRun() {
    assert.strictEqual(visibleGroups(st({}))['swGrpArm'], false,
      'a static stop has no arm distance to set');
    assert.strictEqual(visibleGroups(st({ swDecTrail: '1' }))['swGrpArm'], true,
      'a declared moving stop needs its arm distance on screen');
    assert.strictEqual(visibleGroups(st({ swPermDecTrail: true }))['swGrpArm'], true,
      'permuting trail puts moving stops in the run — their arm distance must be settable');
  },

  // A box on screen that the launch never sends is a control that does nothing.
  everyVisibleBoxIsSent() {
    const cases = [
      st({ swDecEntry: 'market', swPermDecEntry: true, swDecTrail: '1', swDecArm: '0.5' }),
      st({ swPermDecTrail: true, swDecArm: '1' }),
      st({ swDecTrail: '2', swDecArm: '0.5' }),
      st({ swDecEntry: 'market' }),
    ];
    for (const state of cases) {
      const vis = visibleGroups(state);
      const { declared } = declaredSent(state);
      const pairs = [['swGrpGate', 'gate'], ['swGrpD', 'dMult'], ['swGrpArm', 'armMult']];
      for (const [grp, key] of pairs) {
        if (vis[grp]) {
          assert.ok(declared[key] !== undefined,
            `${grp} is on screen but ${key} never reaches the run — the operator sets a control that does nothing`);
        } else {
          assert.strictEqual(declared[key], undefined,
            `${key} is sent while ${grp} is off screen — a value the operator cannot see is deciding the run`);
        }
      }
    }
  },

  // ------------------------------------------------------------------ server
  // A market base carrying rails is legal WHEN entry is permuted: the rails
  // belong to the breakout members, and the market member drops them.
  aPermutedEntryScoresBothShapesFromTheBoxesOnScreen() {
    const state = st({ swDecEntry: 'market', swPermDecEntry: true, swDecTrail: '1', swDecArm: '0.5' });
    const { declared, permute } = declaredSent(state);
    const set = batch.expandDeclared(declared, permute, GRID);
    const market = set.filter((c) => c.entry === 'market');
    const breakout = set.filter((c) => c.entry === 'breakout');
    assert.strictEqual(market.length, 1, 'the market cell is scored');
    assert.strictEqual(breakout.length, 1, 'and so is the breakout cell');
    assert.strictEqual(market[0].dMult, null, 'market has no rail distance');
    assert.strictEqual(breakout[0].gate, 'always', "the breakout cell uses the operator's gate");
    assert.strictEqual(breakout[0].dMult, 1, "…and the operator's rail distance");
    assert.strictEqual(breakout[0].trailMult, 1, '…and the stop they set');
    assert.strictEqual(breakout[0].armMult, 0.5, '…and the arm they set');
  },

  // The RULE FIVE one: the arm used must be the arm on screen, never a number
  // the code picked.
  aPermutedTrailUsesTheArmTheOperatorSet() {
    const state = st({ swPermDecTrail: true, swDecArm: '1' });
    const { declared, permute } = declaredSent(state);
    const set = batch.expandDeclared(declared, permute, GRID);
    const moving = set.filter((c) => c.trailMult != null);
    assert.ok(moving.length === bracketLib.TRAIL_MULTS.length, 'every moving stop is scored');
    for (const c of moving) {
      assert.strictEqual(c.armMult, 1,
        `scored at arm ${c.armMult} — the operator set 1, so this is a value nobody chose`);
    }
    assert.ok(set.some((c) => c.trailMult == null), 'and the static stop stays in the set');
  },

  // An arm no member of the set could ever use is still refused, not ignored.
  anArmNothingCanUseIsStillRefused() {
    assert.throws(
      () => batch.expandDeclared(
        { entry: 'breakout', gate: 'always', dMult: 1, tHours: 41, armMult: 1, quorumSingles: 4 },
        { gate: true }, GRID,
      ),
      /armMult is meaningless without/,
    );
  },

  // The guard that stops a run spending hours to fill an empty table has to
  // read the whole set: permuting trail builds trail members off a base with
  // none, and a base-only check waved every one of them through.
  aTrailAnywhereInTheSetNeedsTrailingTickedOn() {
    assert.throws(
      () => batch.startBracketLab({
        universe: ['AAAUSDT'], sizes: { singles: true }, windowLayout: 'split70',
        trailing: false,
        declared: {
          entry: 'breakout', gate: bracketLib.GATES[0], dMult: bracketLib.D_MULTS[0],
          tHours: bracketLib.T_HOURS[0], quorum: 4,
        },
        declaredPermute: { trail: true },
      }),
      /trailing stops ticked on/,
    );
  },

  // ------------------------------------------------------------------- count
  // The number printed before Start sweep must be the number the run scores.
  // It multiplies the whole job, so an understatement is an unplanned bill and
  // an overstatement scares the operator off a run they could afford.
  thePrintedCountIsTheSetTheServerBuilds() {
    const bools = ['swPermDecEntry', 'swPermDecGate', 'swPermDecD', 'swPermDecTrail', 'swPermDecArm'];
    const cases = [];
    for (let mask = 0; mask < (1 << bools.length); mask++) {
      for (const entry of ['breakout', 'market']) {
        for (const trail of ['', '1']) {
          const over = { swDecEntry: entry, swDecTrail: trail };
          bools.forEach((b, i) => { over[b] = !!(mask & (1 << i)); });
          cases.push(st(over));
        }
      }
    }
    let checked = 0;
    for (const state of cases) {
      const { declared, permute } = declaredSent(state);
      const built = batch.expandDeclared(declared, permute, GRID).length;
      const printed = countOnScreen(state);
      assert.strictEqual(printed, built,
        `the row prints ${printed} declared configs and the run builds ${built}: `
        + `entry=${state.swDecEntry} trail="${state.swDecTrail}" `
        + bools.filter((b) => state[b]).join('+'));
      checked++;
    }
    assert.strictEqual(checked, 128, 'every combination of the five ticks is checked');
  },

  // The horizon and the agreement counts multiply whatever the rails come to,
  // for both entry styles — so they are checked on top of the matrix above.
  theHorizonAndAgreementMultiplyBothEntryStyles() {
    for (const over of [{ swPermDecT: true }, { swPermDecAgree: true },
      { swPermDecT: true, swPermDecAgree: true, swPermDecEntry: true, swPermDecTrail: true }]) {
      const state = st(over);
      const { declared, permute } = declaredSent(state);
      assert.strictEqual(countOnScreen(state), batch.expandDeclared(declared, permute, GRID).length,
        `the printed count disagrees with the set for ${Object.keys(over).join('+')}`);
    }
  },
};
