// EVERY CHOICE THE INTERFACE OFFERS COMES FROM THE SYSTEM (RULE FIVE).
//
// Thirteen dropdowns on the Construct page each carried their own list, typed
// into the page. Two consequences, both proved before this was changed:
//
//   * The engine implements a holding time of 161 hours and the page's list
//     stopped at 137. An option the system provides could not be reached.
//   * Committee agreement of 7/8 and 8/8 were missing the same way.
//
// What this pins: no dropdown carries its own list, every list the page asks
// for exists, and the lists the engine defines are served COMPLETE — because
// serving a subset is the fault, and a subset looks exactly like a full list.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const { vocabulary } = require('../lib/vocabulary');
const bracket = require('../lib/bracket');
const { GEOMETRIES } = require('../lib/dataset');

const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');

module.exports = {
  // The page must not keep a second copy of anything.
  async noDropdownCarriesItsOwnList() {
    const offenders = [];
    for (const m of PAGE.matchAll(/<select id="([\w-]+)"[\s\S]{0,1200}?<\/select>/g)) {
      const block = m[0];
      if (/vocabOptions\(/.test(block)) continue;
      if (/\$\{/.test(block)) continue; // built from live data, not a fixed list
      if (/<option/.test(block)) offenders.push(m[1]);
    }
    assert.deepStrictEqual(offenders, [],
      `these dropdowns still carry a list written into the page: ${offenders.join(', ')}`);
  },

  // A control asking for a list nobody publishes draws an empty control.
  async everyListThePageAsksForExists() {
    const v = vocabulary();
    const asked = [...new Set([...PAGE.matchAll(/vocabOptions\(\s*'([^']+)'/g)].map((m) => m[1]))];
    assert.ok(asked.length >= 13, `only ${asked.length} dropdowns are drawn from the system's lists`);
    for (const name of asked) {
      assert.ok(Array.isArray(v[name]) && v[name].length,
        `a control asks for the choice list "${name}" and the system publishes no such list`);
    }
  },

  // THE ONE THAT MATTERS. A list served short is the original fault.
  async theEngineSLaddersAreServedComplete() {
    const v = vocabulary();
    const served = (name) => v[name].map((o) => o.value);
    assert.deepStrictEqual(served('tHours'), bracket.T_HOURS.map(String),
      'the holding-time list does not match the engine\'s. It stopped at 137h while the engine implements 161h.');
    assert.deepStrictEqual(served('dMult'), bracket.D_MULTS.map(String),
      'the rail-distance list does not match the engine\'s');
    assert.deepStrictEqual(served('armMult'), bracket.ARM_MULTS.map(String),
      'the arm-distance list does not match the engine\'s');
    assert.deepStrictEqual(served('gate'), bracket.GATES.map(String),
      'the sweep gate list does not match the simulator\'s — note it is WIDER than the live one on purpose');
    assert.deepStrictEqual(served('geometry'), Object.keys(GEOMETRIES),
      'the chunk-shape list does not match the geometries the engine implements');
  },

  // 'static' is the absence of a trailing stop, so it is not in the engine's
  // ladder of multiples and must still be offered.
  async theTrailingListKeepsItsStaticChoiceAndTheEngineSMultiples() {
    const served = vocabulary().trailMult.map((o) => o.value);
    assert.strictEqual(served[0], '', 'the trailing-stop list lost its "static" choice');
    assert.deepStrictEqual(served.slice(1), bracket.TRAIL_MULTS.map(String),
      'the trailing-stop multiples do not match the engine\'s');
  },

  // Every entry needs a value AND something to read, or a control draws blanks.
  async everyChoiceHasAValueAndSomethingToRead() {
    for (const [name, list] of Object.entries(vocabulary())) {
      assert.ok(Array.isArray(list) && list.length, `the choice list "${name}" is empty`);
      list.forEach((o, i) => {
        assert.strictEqual(typeof o.value, 'string', `${name}[${i}] has no value`);
        assert.ok(typeof o.label === 'string' && o.label.length, `${name}[${i}] has nothing to read on screen`);
      });
    }
  },

  // A label read out of the key, so a geometry added to the engine reads
  // properly on screen without anybody writing a name for it.
  async chunkShapesReadAsWordsNotKeys() {
    const g = vocabulary().geometry;
    const weekly = g.find((o) => o.value === 'weekly-8d');
    assert.ok(weekly && weekly.label === 'Weekly 8-day',
      `the chunk shapes read as raw keys on screen: ${JSON.stringify(g.map((o) => o.label))}`);
  },
};
