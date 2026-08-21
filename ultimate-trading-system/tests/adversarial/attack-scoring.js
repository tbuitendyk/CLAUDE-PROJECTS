// Attack 8 — the system's own measuring stick.
//
// Everything else in this suite attacks the code. This attacks the SCORE — the
// arithmetic that decides whether a rule is any good. It is the one place
// where being wrong does not look like being wrong at all, because the output
// of a broken measurement is a perfectly ordinary-looking number.
//
// Four questions, taken from how a measurement usually fails:
//
//   1. Could this score be got with NO SKILL AT ALL? A caller that always says
//      the same thing, or flips a coin, must not come out looking like it
//      found something.
//   2. Can it see a thing that is definitely there? A caller that knows the
//      answer must score well. A measuring stick that cannot detect a real
//      effect is not cautious, it is blind — and it will report every real
//      rule as worthless.
//   3. Does it report a headline number off a handful of cases without saying
//      how few?
//   4. What does it do when the two things being compared are not comparable —
//      fewer answers than questions, an empty test, one class only?
const path = require('path');
const { finding } = require('./harness');

const ROOT = path.join(__dirname, '..', '..');

// A fixed, seeded stream so a run means the same thing tomorrow.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function labels(n, r, skew = [0.34, 0.33, 0.33]) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = r();
    out.push(u < skew[0] ? -1 : (u < skew[0] + skew[1] ? 0 : 1));
  }
  return out;
}

function run(ctx) {
  const found = [];
  const { classifierMetrics } = require(path.join(ROOT, 'lib', 'metrics.js'));

  // ---- control: can it see an effect that is definitely there? -------------

  const r0 = rng(11);
  const train = labels(600, r0);
  const test = labels(400, r0);
  const perfect = classifierMetrics(train, test, test.slice());
  if (!perfect || perfect.testAcc !== 1 || !(perfect.edge > 0)) {
    found.push(finding('score/blind', 'the scoring arithmetic',
      `a caller that gets every single answer right scored ${JSON.stringify(perfect && { testAcc: perfect.testAcc, edge: perfect.edge })}. A measuring stick that cannot see a perfect result cannot see a real one either, and everything else measured below is meaningless.`,
      { instrument: true }));
    return found;
  }
  ctx.note(`control passed: a caller that is right every time scores an edge of ${perfect.edge.toFixed(3)}`);

  // ---- 1. no skill at all ---------------------------------------------------

  // Always saying the commonest answer is the definition of no skill.
  const counts = { '-1': 0, 0: 0, 1: 0 };
  train.forEach((v) => { counts[v] += 1; });
  const majority = Number(Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a)));
  const lazy = classifierMetrics(train, test, test.map(() => majority));
  if (lazy.edge > 0.001) {
    found.push(finding('score/noskill', 'the scoring arithmetic',
      `always answering the commonest outcome — which takes no skill whatsoever — scores an edge of ${lazy.edge.toFixed(4)} above zero. A rule that does nothing would pass a test set at that level.`,
      { severe: true }));
  } else {
    ctx.note(`no-skill check passed: always answering the commonest outcome scores an edge of ${lazy.edge.toFixed(4)}`);
  }

  // Flipping a coin, many times over, must average out to nothing.
  const edges = [];
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(seed * 7919);
    const tr = labels(600, r);
    const te = labels(400, r);
    const coin = te.map(() => [-1, 0, 1][Math.floor(r() * 3)]);
    edges.push(classifierMetrics(tr, te, coin).edge);
  }
  const mean = edges.reduce((a, b) => a + b, 0) / edges.length;
  const positive = edges.filter((e) => e > 0).length;
  ctx.note(`coin-flip check: over 60 runs the average edge is ${mean.toFixed(4)}, positive in ${positive} of 60`);
  if (mean > 0.02) {
    found.push(finding('score/noskill', 'the scoring arithmetic',
      `flipping a coin scores an average edge of ${mean.toFixed(4)} over 60 runs, positive in ${positive} of them. The score rewards guessing, so a rule that has found nothing can still look like it has.`,
      { severe: true }));
  }

  // ---- 3. a headline number off almost nothing ------------------------------

  // One directional call, and it happens to be right.
  const oneCall = test.map((v, i) => (i === 0 ? test[0] : 0));
  const thin = classifierMetrics(train, test, oneCall);
  if (thin.directionalHitRate === 1 && thin.directionalCalls === 1) {
    ctx.note('a single lucky call is reported as a 100% hit rate, but the call count rides alongside it');
    // Only a finding if the count is NOT reported — a screen can show one
    // without the other, but the number itself carries its own sample size.
    if (!('directionalCalls' in thin)) {
      found.push(finding('score/thin', 'the scoring arithmetic',
        'a hit rate is reported with no count beside it, so one lucky call reads as a 100% record.',
        { severe: true }));
    }
  }

  // ---- 4. things that are not comparable ------------------------------------

  const notComparable = [
    {
      label: 'fewer answers than there are questions',
      calls: test.slice(0, 50),
      why: 'the missing answers are counted as wrong rather than as missing, so a run that only half finished is scored as a run that did badly. Those two mean completely different things.',
    },
    { label: 'no answers at all', calls: [] , why: 'a run that produced nothing is scored as a run that got everything wrong.' },
    { label: 'more answers than questions', calls: [...test, ...test], why: 'the extra answers are ignored without a word, so a caller misaligned with the test data scores as though it were aligned.' },
    { label: 'answers that are not one of the three outcomes', calls: test.map(() => 7), why: 'a value the system does not recognise is treated as an ordinary wrong answer instead of being refused.' },
    { label: 'answers that are text', calls: test.map(() => '1'), why: 'the text "1" and the number 1 are never equal, so a caller whose answers arrived as text scores zero and looks like a rule that does not work.' },
  ];
  for (const nc of notComparable) {
    let m;
    try { m = classifierMetrics(train, test, nc.calls); } catch (_) { continue; } // refusing is right
    if (!m) continue; // returning nothing is also right
    found.push(finding('score/notcomparable', 'the scoring arithmetic',
      `given ${nc.label}, the score came back as an ordinary result (accuracy ${Number(m.testAcc).toFixed(3)}, edge ${Number(m.edge).toFixed(3)}) rather than being refused. ${nc.why}`,
      { severe: true }));
  }

  // A test set holding only one outcome. There is nothing to be right about.
  const flat = new Array(400).fill(1);
  const m2 = classifierMetrics(train, flat, flat.slice());
  if (m2 && m2.testAcc === 1 && !(m2.edge > 0)) {
    ctx.note('a test set holding only one outcome scores a perfect accuracy but no edge, which is the honest answer');
  } else if (m2 && m2.edge > 0) {
    // The code does carry an honest companion figure. Say so — a finding that
    // leaves out the guard that already exists overstates the danger and sends
    // whoever reads it looking for a fix that is half already written.
    const honest = m2.hindsightEdge;
    found.push(finding('score/degenerate', 'the scoring arithmetic',
      `a test period in which every outcome is the same scores an edge of ${m2.edge.toFixed(3)} — a perfect discovery, in a period where there was nothing to discover. It happens because the yardstick is the commonest outcome in the TRAINING data, and in a quiet period the test data may hold none of it. The honest figure sitting right beside it is ${Number(honest).toFixed(3)}, so the arithmetic already knows; it is the headline number that misleads.`,
      { severe: true }));
  }

  // An empty test set.
  const m3 = classifierMetrics(train, [], []);
  if (m3 !== null) {
    found.push(finding('score/degenerate', 'the scoring arithmetic',
      `scoring against no test data at all returned ${JSON.stringify(m3).slice(0, 120)} instead of nothing. A result computed from an empty set is the emptiest kind of plausible wrong answer.`,
      { severe: true }));
  } else {
    ctx.note('an empty test set returns nothing rather than a score');
  }

  return found;
}

module.exports = { name: "the measuring stick — could this score be got with no skill at all?", run };
