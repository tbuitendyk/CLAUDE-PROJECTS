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
// lib/forwardbook.js where freeze-at-a-date IS intrinsic: those books exist to
// be out-of-sample evidence, so "trained once through 30 June, never retrained"
// is their whole point. configschema copied the vocabulary, greenlight then had
// to populate the field, and populated it by GUESSING from the run's fire time
// — a date that is neither the rule's business nor deliberately chosen.
//
// So the freeze moves to where the decision actually is: putting a rule to
// WORK. The same rule can be deployed frozen (its live record is then a genuine
// forward test) or rolling (it retrains as data arrives, which is what you
// usually want from a trading rule). That is a property of the deployment, not
// of the rule, and it is now named rather than inferred.
//
//   frozen   { mode: 'frozen', throughMs }  train once through a NAMED instant
//                                           and never past it. For a rule whose
//                                           live record doubles as its evidence.
//   rolling  { mode: 'rolling' }            train through everything whose
//                                           outcome has closed by now.
const MODES = ['frozen', 'rolling'];

function validatePolicy(p) {
  const errors = [];
  if (!p || typeof p !== 'object') return ['trainPolicy: required — a deployment must say when its members train'];
  if (!MODES.includes(p.mode)) errors.push(`trainPolicy.mode: must be one of ${MODES.join('|')}`);
  if (p.mode === 'frozen' && (!Number.isInteger(p.throughMs) || p.throughMs <= 0)) {
    errors.push('trainPolicy.throughMs: a frozen deployment must name the instant it is frozen at (ms epoch)');
  }
  if (p.mode === 'rolling' && p.throughMs != null) {
    errors.push('trainPolicy.throughMs: meaningless for a rolling deployment — it trains through the latest closed outcome');
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
    + '— activate it with a trainPolicy saying frozen (at a named instant) or rolling');
}

module.exports = { MODES, validatePolicy, resolveFreeze };
