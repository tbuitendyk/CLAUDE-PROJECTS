// coins.js -- COINS: vetting a coin's history before anything is trained
// (COINS.md; owner LOOP NOW! 2026-09-12).
//
// NOTHING HERE TRAINS ANYTHING AND NOTHING HERE REFUSES A COIN. Every function
// below produces a number to be shown. The owner, 2026-09-12: "We're not even
// blocking coins with this anyways. We're only reporting." A function that
// returns a pass or a fail has misunderstood the tab.
//
// A price series here is one price per period, in period order. That is what a
// chunk store already is -- c1, the price a trade would open at -- so the
// boundaries snap to period boundaries for free (COINS.md section 3) and
// nothing has to round anything to a calendar.

// ---- the typing -------------------------------------------------------------

// HOW A TURN IS FOUND (COINS.md section 3): walk forward keeping the running
// high; when price has fallen back from that high by more than pctBack, the
// high is where the rising stretch ended and the falling one began. Mirrored
// for the other direction.
//
// IT IS A RETURN, NEVER A PRICE LEVEL. The fall is measured against the
// extreme it is retracing from, so a 10% move counts the same at $50 and at
// $5,000 -- which is what stops a model learning this price level rather than
// what a falling market looks like.
//
// The two comparisons are deliberately asymmetric in their base: a fall is
// (high - p) / high and a rise is (p - low) / low. Each is measured from the
// extreme it is retracing, which is the only base that means anything.
function typeStretches(prices, pctBack) {
  const n = Array.isArray(prices) ? prices.length : 0;
  const pct = Number(pctBack);
  if (!(pct > 0)) throw new Error('the fall-back percentage must be above zero');
  if (n < 2) return { pct, turns: [], stretches: n ? [{ from: 0, to: 0, type: 'rising' }] : [] };

  const frac = pct / 100;
  const turns = [];
  const stretches = [];
  let dir = null;                 // 'rising' | 'falling', unknown until price moves
  let hi = prices[0]; let hiIdx = 0;
  let lo = prices[0]; let loIdx = 0;
  let start = 0;                  // where the stretch in progress began

  // A turn CLOSES the stretch in progress at the extreme, and opens the next
  // one there. The extreme belongs to the stretch that ended at it, so the
  // next stretch starts on the following period and no period is in two.
  const close = (at, type) => {
    if (at < start) return false;              // cannot close behind the start
    stretches.push({ from: start, to: at, type });
    turns.push(at);
    start = at + 1;
    return true;
  };

  for (let i = 1; i < n; i++) {
    const p = prices[i];
    if (p > hi) { hi = p; hiIdx = i; }
    if (p < lo) { lo = p; loIdx = i; }
    const fellBack = hi > 0 && (hi - p) / hi >= frac;
    const roseBack = lo > 0 && (p - lo) / lo >= frac;
    if (dir !== 'falling' && fellBack && hiIdx >= start) {
      // THE FIRST TRIGGER ONLY SETS THE DIRECTION WHEN THE EXTREME IS THE
      // START ITSELF. Found by the pre-registered check C1.3, which a
      // one-way rising path failed: with no direction yet, the rise away from
      // the opening price fired the OTHER branch and closed a falling stretch
      // that had never existed, inventing a turn at index 0 on a path that
      // never turns. Nothing was in progress before the first period, so
      // there is nothing there to close.
      if (dir === null && hiIdx === start) { dir = 'falling'; lo = p; loIdx = i; hi = p; hiIdx = i; }
      else if (close(hiIdx, 'rising')) {
        dir = 'falling';
        lo = p; loIdx = i;
        hi = p; hiIdx = i;
      }
    } else if (dir !== 'rising' && roseBack && loIdx >= start) {
      if (dir === null && loIdx === start) { dir = 'rising'; hi = p; hiIdx = i; lo = p; loIdx = i; }
      else if (close(loIdx, 'falling')) {
        dir = 'rising';
        hi = p; hiIdx = i;
        lo = p; loIdx = i;
      }
    }
  }

  // THE TAIL, AND WHY IT IS NEVER UNCLASSIFIED (COINS.md section 3: two types
  // only, no third bucket). Whatever is left after the last turn is one
  // stretch. Its type is the direction in progress; when price never moved far
  // enough for a direction to exist at all, it is whichever way the span
  // finished, so a flat coin still gets a type rather than a hole.
  if (start <= n - 1) {
    const type = dir || (prices[n - 1] >= prices[start] ? 'rising' : 'falling');
    stretches.push({ from: start, to: n - 1, type });
  }
  return { pct, turns, stretches };
}

// ---- the search for the percentage, per coin --------------------------------

// THE PERCENTAGE IS NOT FIXED ACROSS COINS (COINS.md section 4). What is set is
// how many changes of direction are wanted; each coin gets whatever percentage
// delivers that.
//
// THE WALK IS EXHAUSTIVE ON PURPOSE, never a bisection. The count does NOT
// simply rise as the percentage falls -- an earlier turn moves where later ones
// land -- so anything that assumes a staircase will land on the wrong rung. The
// walk is cheap and its shape, per coin, is what the screen draws.
//
// THE RULE (owner's decision, 2026-09-12): take the LARGEST percentage that
// gives AT LEAST the number asked for. Largest keeps the stretches clean;
// at-least means never coming up short.
function searchFallback(prices, opts = {}) {
  const target = Math.max(1, Math.floor(Number(opts.target) || 0));
  const from = Number(opts.from) > 0 ? Number(opts.from) : 1;
  const to = Number(opts.to) > 0 ? Number(opts.to) : 40;
  const step = Number(opts.step) > 0 ? Number(opts.step) : 0.5;
  if (to < from) throw new Error(`the percentage range runs backwards (${from} to ${to})`);

  const walk = [];
  const places = Math.max(0, Math.min(6, String(step).split('.')[1] ? String(step).split('.')[1].length : 0));
  for (let k = 0; ; k++) {
    const pct = Number((from + k * step).toFixed(places + 3));
    if (pct > to + 1e-9) break;
    const r = typeStretches(prices, pct);
    walk.push({ pct, turns: r.turns.length, stretches: r.stretches.length });
  }
  if (!walk.length) throw new Error('the percentage range holds no values to try');

  // Largest percentage reaching the target. The walk is in ascending order, so
  // the last one that reaches it is the largest.
  let picked = null;
  for (const w of walk) if (w.turns >= target) picked = w;

  if (picked) {
    return {
      asked: target,
      reached: true,
      pct: picked.pct,
      turns: picked.turns,
      // THE COUNT MOVES IN WHOLE STEPS and can jump straight past the target,
      // so what was delivered is reported beside what was asked. A coin that
      // overshot says so rather than looking like it landed exactly.
      overshot: picked.turns > target,
      walk,
    };
  }

  // NOTHING REACHED IT. Say so, and report the best the walk found -- never
  // hand back the smallest percentage as though it had worked (pre-registered
  // success rule C1.4).
  let best = walk[0];
  for (const w of walk) if (w.turns > best.turns || (w.turns === best.turns && w.pct > best.pct)) best = w;
  return {
    asked: target,
    reached: false,
    pct: null,
    turns: null,
    overshot: false,
    best: { pct: best.pct, turns: best.turns },
    why: `no percentage between ${from}% and ${to}% gives ${target} change(s) of direction on this coin — the most any of them gives is ${best.turns}, at ${best.pct}%`,
    walk,
  };
}

module.exports = { typeStretches, searchFallback };
