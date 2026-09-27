// trainpolicy.js -- WHEN a rule's members are trained, kept separate from WHAT
// the rule trades (owner, 2026-08-19).
//
// THE CONFLATION THIS UNDOES. A trading rule is: this pair against these two
// contexts, this geometry and decision, this band, this committee shape, this
// cell. That is complete. It says nothing about training history and does not
// need to — the owner's question was exactly this: "we're not greenlighting
// history data, we're greenlighting a set of configs which are independent of
// the training history window".
//
// The rule shape carried `trainThrough` anyway, inherited wholesale from
// three set-ups that were written into the product (removed 2026-08-28) and
// for which freeze-at-a-date WAS intrinsic: they existed to be out-of-sample
// evidence, so "trained once through a date, never retrained" was their whole
// point. configschema copied the vocabulary, greenlight then had
// to populate the field, and populated it by GUESSING from the run's fire time
// — a date that is neither the rule's business nor deliberately chosen.
//
// So the freeze moves to where the decision actually is: putting a rule to
// WORK. The same rule can be deployed frozen (its live record is then a genuine
// forward test) or rolling (it retrains as data arrives, which is what you
// usually want from a trading rule). That is a property of the deployment, not
// of the rule, and it is now named rather than inferred.
//
//   construct { mode: 'construct' }         train on exactly the prices Construct
//                                           kept with the set, cut exactly as it
//                                           cut them (3.283.0): the members held
//                                           measured, and nothing newer.
//   frozen   { mode: 'frozen', throughMs }  train once through a NAMED instant
//                                           and never past it. For a rule whose
//                                           live record doubles as its evidence.
//   rolling  { mode: 'rolling' }            train through everything whose
//                                           outcome has closed by now.
// Frozen and rolling keep no held-back stretch (3.283.0): all of it trains,
// or the newest 15% is the test stretch when the rule reads one
// (lib/bracketwork.js splitAndLabelBook).
const MODES = ['construct', 'frozen', 'rolling'];

function validatePolicy(p) {
  const errors = [];
  if (!p || typeof p !== 'object') return ['trainPolicy: required — a deployment must say when its members train'];
  if (!MODES.includes(p.mode)) errors.push(`trainPolicy.mode: must be one of ${MODES.join('|')}`);
  if (p.mode === 'frozen' && (!Number.isInteger(p.throughMs) || p.throughMs <= 0)) {
    errors.push('trainPolicy.throughMs: a frozen deployment must name the instant it is frozen at (ms epoch)');
  }
  if ((p.mode === 'rolling' || p.mode === 'construct') && p.throughMs != null) {
    errors.push(`trainPolicy.throughMs: meaningless for a ${p.mode} deployment — ${p.mode === 'rolling' ? 'it trains through the latest closed outcome' : 'it trains on the history Construct kept, to the hour it ended'}`);
  }
  return errors;
}

// Resolve the instant to train through, for one deployment.
//
// LEGACY IS HANDLED OUT LOUD, NOT SILENTLY. Setups minted before this split
// carry the freeze inside their configSnapshot, where it no longer belongs.
// They keep working — nothing paper-trading is disturbed — but the result is
// flagged `legacy` so the screens can say so and the old shape cannot quietly
// become permanent. A silent fallback is how a field you removed lives forever.
function resolveFreeze(setup, now = Date.now()) {
  const p = setup && setup.trainPolicy;
  if (p && p.mode === 'rolling') return { mode: 'rolling', throughMs: now, legacy: false };
  // the instant is Construct's own, known only once its history is read (lib/live/signal.js prepare)
  if (p && p.mode === 'construct') return { mode: 'construct', throughMs: null, legacy: false };
  if (p && p.mode === 'frozen') {
    if (!Number.isInteger(p.throughMs) || p.throughMs <= 0) {
      throw new Error(`setup ${setup.id}: frozen trainPolicy carries no valid throughMs`);
    }
    return { mode: 'frozen', throughMs: p.throughMs, legacy: false };
  }
  const inherited = setup && setup.configSnapshot && setup.configSnapshot.trainThrough;
  if (Number.isInteger(inherited) && inherited > 0) {
    return { mode: 'frozen', throughMs: inherited, legacy: true };
  }
  throw new Error(`setup ${(setup && setup.id) || '?'}: no training policy, and no legacy freeze to fall back on `
    + '— activate it with a trainPolicy saying construct, frozen (at a named instant) or rolling');
}

// WHY "as trained by Construct" CANNOT BE USED, in words, or null when it can
// (3.283.0): it trains on the greenlight's record of the history Construct
// trained on, so a setup whose greenlight is gone or carries none has nothing
// to train on. One answer for the Save that picks it and the decision that
// trains by it.
function constructRefusal(greenlight) {
  if (!greenlight) return 'the greenlight this setup came from is not on the box';
  if (!greenlight.construct) return 'its greenlight carries no record of the history Construct trained on';
  return greenlight.construct.lost || null;
}

module.exports = { MODES, validatePolicy, resolveFreeze, constructRefusal };
