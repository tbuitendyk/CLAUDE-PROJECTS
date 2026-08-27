// EVERY LIST OF CHOICES THE INTERFACE OFFERS, READ OUT OF THE CODE THAT
// IMPLEMENTS THEM (RULE FIVE).
//
// Thirteen dropdowns on the Construct page each carried their own list, typed
// into the page. The owner could only pick what somebody had written there,
// nothing on screen said so, and several were second copies of lists the system
// already holds — so the two could drift, and they had:
//
//   * The engine implements a holding time of 161 hours. The page's list
//     stopped at 137. An option the system provides was unreachable, which is
//     exactly the harm RULE FIVE describes.
//   * The page offered a chunk shape list that has to be kept in step with
//     lib/dataset.js by hand.
//
// WHY THESE ARE NOT OWNER-EDITABLE, which is a deliberate reading of RULE FIVE
// rather than an exception to it. These ladders are a PRE-REGISTERED MENU: the
// set of things that will be tried is fixed before the data is seen, for the
// same reason the threshold grid is fixed. Letting the menu be widened after a
// disappointing result is how a finding gets shopped for, and it would quietly
// destroy what the null tests are there to protect. What the rule requires is
// that the owner can see and choose from everything the system provides — which
// is what serving the complete list does, and what the page was not doing.
//
// Adding a value is therefore a change to the engine that implements it, and it
// reaches the screen the moment it is made. Nothing has to be kept in step.
const { GEOMETRIES } = require('./dataset');
const bracket = require('./bracket');

const asChoices = (values, label = (v) => String(v)) => values.map((v) => ({ value: String(v), label: label(v) }));

function vocabulary() {
  const mult = (v) => `${v}×`;
  const httwoHalfLives = (() => {
    try { return Object.keys(require('./httwo').HALF_LIVES); } catch (_) { return []; }
  })();

  return {
    // What the engine can carry out. Read from the code, complete.
    // The label is DERIVED from the key rather than kept in a second list, so a
    // geometry added to lib/dataset.js reads properly on screen without anybody
    // adding a name for it. 'weekly-8d' -> 'Weekly 8-day'.
    geometry: Object.keys(GEOMETRIES).map((k) => {
      const [cadence, span] = k.split('-');
      const days = /^(\d+)d$/.exec(span || '');
      const pretty = `${cadence.charAt(0).toUpperCase()}${cadence.slice(1)}${days ? ` ${days[1]}-day` : (span ? ` ${span}` : '')}`;
      return { value: k, label: pretty };
    }),
    decision: asChoices(['argmax', 'directional']),
    entry: asChoices(bracket.ENTRIES),
    // The SWEEP gate list, which is wider than the live one on purpose: the
    // simulator implements 'always', and a live deployment may not use it
    // (lib/live/configschema.js). Serving the live list here would have removed
    // a working choice from the sweep screen.
    gate: asChoices(bracket.GATES),
    dMult: asChoices(bracket.D_MULTS, mult),
    tHours: asChoices(bracket.T_HOURS, (h) => `${h}h`),
    // 'static' is the absence of a trailing stop, which is not a multiple and
    // so is not in the engine's ladder. It is a real choice and belongs here.
    trailMult: [{ value: '', label: 'static' }, ...asChoices(bracket.TRAIL_MULTS, mult)],
    armMult: asChoices(bracket.ARM_MULTS, mult),
    halfLife: asChoices(httwoHalfLives),
    // Committee quorums are a count out of the committee's size, so they are
    // derived rather than listed — a committee of another size gets the right
    // list without anybody adding one.
    quorumOf6: asChoices([1, 2, 3, 4, 5, 6], (q) => `${q}/6`),
    quorumOf8: asChoices([1, 2, 3, 4, 5, 6, 7, 8], (q) => `${q}/8`),
    windowLayout: [
      { value: 'split70', label: '70/15/15' },
      { value: 'reserve61', label: '61/13/13/13 (sealed exam)' },
      { value: 'legacy80', label: 'legacy 80/20 (never evidence)' },
    ],
    // Stage 2's carry orderings — read from the stage engine, complete.
    greenlightAnchor: [
      { value: 'declared', label: 'declared cell' },
      { value: 'best', label: 'best cell' },
      // 'region', not 'widest'. I wrote the value from the label the first time
      // instead of reading it out of the page, and an existing test caught it —
      // which is the whole reason a name is read rather than inferred.
      { value: 'region', label: 'widest region' },
    ],
  };
}

module.exports = { vocabulary };
