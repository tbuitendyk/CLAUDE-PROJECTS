// Attack 9 — the arithmetic that books the money.
//
// The scoring attack asks whether the measuring stick is honest. This asks the
// smaller and sharper question one level down: do the few functions that turn
// a decision into a dollar figure behave when handed something odd?
//
// These are tiny functions and they are the last thing between a stored record
// and a number on screen. Every case here was found by an independent
// attacking session and then reproduced by hand before being pinned.
const path = require('path');
const { finding } = require('./harness');

const ROOT = path.join(__dirname, '..', '..');

function run(ctx) {
  const found = [];
  const paper = require(path.join(ROOT, 'lib', 'paper.js'));
  const { median } = require(path.join(ROOT, 'lib', 'stats.js'));
  const { pnlAt, voteOf, superOf, directionalCall, NOTIONAL, REAL_FEE_PER_LEG } = paper;

  // Control first. Ordinary inputs must give the ordinary answer, or nothing
  // below means anything.
  // Compared with a tolerance, not exactly: 100 * (110/100 - 1) is
  // 10.000000000000009 in binary arithmetic, and demanding exactly 10 made the
  // control fail and stop the whole attack. That is the control working; it is
  // also the control being wrong.
  const control = pnlAt(1, 100, 110, 0);
  if (Math.abs(control - NOTIONAL * 0.1) > 1e-9) {
    found.push(finding('engine/instrument', 'this test itself',
      `a plain long from 100 to 110 with no fee came out as ${control} instead of ${NOTIONAL * 0.1}. Nothing below is trustworthy.`, { instrument: true }));
    return found;
  }
  ctx.note(`control passed: a long from 100 to 110 books ${control} on a ${NOTIONAL} clip`);

  // ---- 9a. which way is this trade facing? ---------------------------------

  // pnlAt asks `direction === 1`. Anything else — including the TEXT "1", which
  // is what a number becomes after a trip through a stored file — is priced as
  // the opposite direction rather than refused.
  const asNumber = pnlAt(1, 100, 110, 0);
  // Refusing is the pass. The attack itself used to call this bare, so once the
  // fix landed the attack crashed and reported ITSELF as broken rather than
  // reporting the fix — which the suite caught, because an attack that could
  // not run is never counted as a clean result.
  let asText = null;
  try { asText = pnlAt('1', 100, 110, 0); } catch (_) { asText = 'REFUSED'; }
  if (asText !== 'REFUSED' && asText !== asNumber) {
    found.push(finding('engine/direction', 'the function that prices a trade',
      `a LONG booked as the number 1 makes ${asNumber}, and the same trade booked as the text "1" makes ${asText}. A number that has been through a stored file comes back as text, and the same winning trade is then recorded as an equal and opposite loss. Nothing refuses it.`,
      { severe: true }));
  }
  for (const [label, dir] of [['the text "-1"', '-1'], ['true', true], ['null', null], ['not-a-number', NaN], ['the word "long"', 'long']]) {
    let v = null;
    try { v = pnlAt(dir, 100, 110, 0); } catch (_) { continue; } // refusing is right
    if (Number.isFinite(v) && v !== 0) {
      found.push(finding('engine/direction', 'the function that prices a trade',
        `a direction given as ${label} is priced as a real trade worth ${v} rather than being refused. Only the number 1 counts as a long; everything else that is not exactly 0 is treated as a short.`));
    }
  }

  // A trade entered at a price of zero.
  let zeroEntry = 'REFUSED';
  try { zeroEntry = pnlAt(1, 0, 110, 0); } catch (_) { /* refusing is right */ }
  if (zeroEntry !== 'REFUSED' && !Number.isFinite(zeroEntry)) {
    found.push(finding('engine/infinite', 'the function that prices a trade',
      `a trade entered at a price of zero books ${String(zeroEntry)} — an infinite profit, which will then outrank every genuine result it is compared against.`,
      { severe: true }));
  }

  // ---- 9b. the committee ----------------------------------------------------

  // voteOf counts into a fixed set of three buckets. A label outside that set
  // increments nothing, so it is not a vote against — it is not a vote at all.
  let stray = 'REFUSED';
  try { stray = voteOf([1, 1, -1, -1, 7]); } catch (_) { /* refusing is right */ }
  const without = voteOf([1, 1, -1, -1]);
  if (stray !== 'REFUSED' && stray !== without) {
    found.push(finding('engine/committee', 'the committee vote',
      `adding one unrecognised opinion to a tied committee changes the answer from ${without} to ${stray}. An opinion the code does not recognise should not be able to break a tie.`));
  }
  let strayThrew = false;
  try { voteOf([1, 'up', -1]); } catch (_) { strayThrew = true; }
  if (!strayThrew) {
    const r = voteOf([1, 'up', -1]);
    if (r !== 0) {
      found.push(finding('engine/committee', 'the committee vote',
        `a committee containing an opinion of "up" — which is not one of the three the code knows — returned ${r} rather than standing aside or refusing.`));
    }
  }

  // superOf with a quorum of zero: nobody has to agree.
  let emptyAtZero = 0;
  try { emptyAtZero = superOf([], 0); } catch (_) { emptyAtZero = 0; } // refusing is right
  if (emptyAtZero !== 0) {
    found.push(finding('engine/committee', 'the supermajority gate',
      `an EMPTY committee at a quorum of zero returns ${emptyAtZero} — a definite trading direction from nobody at all.`,
      { severe: true }));
  }

  // ---- 9c. the middle of a list --------------------------------------------

  // stats.js says an empty list returns null so that "not available" can be
  // told from a number. A list with a broken number in it makes no such promise.
  let withNan = 'REFUSED'; let reordered = 'REFUSED';
  try { withNan = median([1, 2, NaN, 4, 5]); } catch (_) { /* refusing is right */ }
  try { reordered = median([NaN, 1, 2, 4, 5]); } catch (_) { /* refusing is right */ }
  if (withNan === 'REFUSED' && reordered === 'REFUSED') {
    // both refused — the honest answer
  } else if (withNan !== reordered) {
    found.push(finding('engine/median', 'the middle value of a list',
      `the same five numbers, one of them broken, give a middle value of ${String(withNan)} in one order and ${String(reordered)} in another. The answer depends on the order the values happened to arrive in, and neither answer says anything is wrong.`));
  } else if (Number.isFinite(withNan)) {
    found.push(finding('engine/median', 'the middle value of a list',
      `a list containing a number that is not a number returns ${withNan} — an ordinary-looking answer that quietly ignores the broken value.`));
  }

  // ---- 9d. the fee, on two paths that must agree ---------------------------

  // The threshold that decides whether a directional trade is taken at all is
  // tuned by pricing a ladder of candidate thresholds. It prices them at the
  // paper fee, because it never passes a fee and the default takes over. The
  // live signal path declares a fee of zero. Reproduced by hand: on data whose
  // edge is near the fee, the two disagree about which threshold to use.
  const pipelineSrc = require('fs').readFileSync(path.join(ROOT, 'lib', 'pipeline.js'), 'utf8');
  const signalSrc = require('fs').readFileSync(path.join(ROOT, 'lib', 'live', 'signal.js'), 'utf8');
  const tuneTauBody = pipelineSrc.slice(pipelineSrc.indexOf('function tuneTau'), pipelineSrc.indexOf('function monthList'));
  const tunePricesWithoutFee = /pnlAt\([^)]*\)/.test(tuneTauBody)
    && !/pnlAt\([^)]*,[^)]*,[^)]*,[^)]*\)/.test(tuneTauBody);
  const liveFee = /feePerLeg:\s*([0-9.]+)/.exec(signalSrc);
  if (tunePricesWithoutFee && liveFee && Number(liveFee[1]) !== REAL_FEE_PER_LEG) {
    found.push(finding('engine/feemismatch', 'the threshold that gates every directional trade',
      `the threshold is chosen by pricing candidate thresholds at $${REAL_FEE_PER_LEG} a leg — it never passes a fee, so the paper default takes over — while the live signal path declares a fee of ${liveFee[1]}. The two are tuning and trading against different cost assumptions, and there is no way to tell the tuner otherwise. Confirmed by hand on data whose edge sits near the fee: the two pick different thresholds and trade a different number of periods.`,
      { severe: true }));
  }

  // ---- 9e. a decision out of nothing ---------------------------------------

  // directionalCall reads two named probabilities. If they are missing, the
  // comparison is between two undefined values.
  for (const [label, probs] of [
    ['an empty set of probabilities', {}],
    ['probabilities that are all missing', { '-1': undefined, 0: undefined, 1: undefined }],
    // A dead tie, written as text. The rule decides the DIRECTION with `>`,
    // which compares text as text, and the CONFIDENCE with Math.max, which
    // converts to numbers. So half of it reads "0.5" and "0.50" as equal and
    // the other half reads them as different, and a tie that must stand aside
    // becomes a definite trade.
    ['a dead tie written as text ("0.5" against "0.50")', { '-1': '0.5', 0: '0', 1: '0.50' }],
    ['probabilities that are not numbers', { '-1': NaN, 0: NaN, 1: NaN }],
  ]) {
    let call;
    try { call = directionalCall(probs, 0.5); } catch (_) { continue; }
    if (call !== 0) {
      found.push(finding('engine/decisionfromnothing', 'the rule that turns a forecast into a trade',
        `given ${label}, the rule returned a definite ${call === 1 ? 'LONG' : 'SHORT'} rather than standing aside. A trade would be placed on a forecast that does not exist.`,
        { severe: true }));
    }
  }

  return found;
}

module.exports = { name: 'the money arithmetic — the last step before a number on screen', run };
