# F1 plateau check (2026-08-07) — search window only

Question: is F1 (1-of-4, market, 137h) a plateau or a knife-edge spike? A spike
is the signature of a setting fitted to noise. Selects nothing; held-back and
forward windows untouched.

## Result: PLATEAU by the declared rule
F1 $859.11 (253 trades). Neighbours: 113h $726.79, 161h $772.18, 2-of-4 $710.06
— all profitable, all within 3x. Whole grid: 28 of 28 cells profitable.

## But the test was WEAK, and I should say so rather than bank the pass
My rule required a majority of neighbours to be (a) profitable and (b) within
3x. With 28 of 28 cells profitable on this window, condition (a) was guaranteed
before the run — it could not discriminate. Condition (b) did the only real
work, and it passed comfortably. So the PLATEAU verdict is honest but carries
much less weight than a passed gate normally would. Same failure mode as a gate
that cannot fail: it tells you the instrument agreed with itself.

That 28-of-28 is itself the QC 64 lesson resurfacing: when every setting on the
menu makes money, the window is flattering everything and "profitable" stops
carrying information. The search window was simply kind to this coin.

## What the grid DOES say, which is more useful than the verdict
- TRADE COUNT IS CONSTANT ACROSS HOLD LENGTH within each agreement level (253
  at every tHours for 1-of-4; 193 for 2-of-4; 125 for 3-of-4; 44 for 4-of-4).
  Market entry takes every committee call, so hold length changes only WHEN a
  position closes, never which ones are opened. The tHours dimension is
  therefore an exit-timing knob, not a selection knob.
- MONEY RISES MONOTONICALLY WITH HOLD LENGTH to 137h, then dips at 161h, in
  EVERY row. A clean single-peaked curve, identical in shape across all four
  agreement levels. That is consistent with the setup capturing directional
  drift over roughly five to six days rather than any sharp timing effect.
- F1 SITS AT THE PEAK of its row. Not a knife-edge — its neighbours are close —
  but the top of a hill nonetheless, and picking the top of a hill still
  inflates the estimate relative to the hill's average. The row's mean is about
  $528 against F1's $859.

## The number that outranks the whole exercise
Same cell, three windows:
  search (selection)      $859.11
  held-back               $158.32
  forward (retrained)      $27.43   over 13 trades
Money falls by roughly 5x at each step outward. The plateau result says the
cell is not a knife-edge artifact; it says nothing against that decay, which
remains the central fact about F1.

## A stronger plateau test, for next time
Absolute profitability on a kind window cannot discriminate. A useful version
compares the SHAPE of the surface across windows: if the peak sits at the same
place on search and held-back data, the geometry is real; if the peak moves,
the setting is fitted. That costs one held-back scoring of the grid, which
spends the held-back window across 28 cells — so it is worth doing ONCE,
deliberately, and only if the owner accepts that cost. Not run today.
