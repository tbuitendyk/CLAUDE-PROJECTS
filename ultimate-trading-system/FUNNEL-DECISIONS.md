# Funnel build — decision record

One line per non-obvious choice, committed with the work it belongs to
(RULE SIX). The design itself is `FUNNEL-DESIGN.md`; this is only the choices
made while building it that the design did not already settle.

## Step 1 — plateau axes from the caller

1. **The axis lists DEFAULT to the library's own constants** rather than becoming
   required arguments. The old sweep calls `widestRegion(allCells, {minTrades})`
   and had to keep working byte-identically; making the axes mandatory would have
   forced a change at a call site this work has no business touching.
2. **The centre is built from the axis lists, not typed out.** With the defaults
   that produces exactly the key set it has always produced, which is what lets
   `lib/live/greenlight.js:74` go on spreading it over the row unchanged.
3. **A dial named on BOTH lists throws.** It would slice the space and be walked
   along it at the same time — nonsense that returns a plausible number.
4. **The reading carries the axes it was cut on.** A region size is meaningless
   without knowing what "next to" meant, and the whole point of this step is that
   it is no longer a constant.
5. **A bad axis list is refused, not coerced.** A string, an empty list or a list
   with a hole in it would each cut a region on axes nobody chose.
