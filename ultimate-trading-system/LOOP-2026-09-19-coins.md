# Long loop, 2026-09-19 — making the Coins selection usable

Granted by the owner with `LOOP NOW!`: "full GO on your 6 part plan to make this
stuff useful ... BUILD ALL AND FINAL DEPLOY WITHOUT DEFERRING TO MORE QUESTIONS.
You're going to make RATIONAL and CONSISTENT screens with UGLY FACTOR = 0."

The six parts are the ones proposed in that conversation. Every non-obvious
choice inside them is recorded here.

## Decisions

- **Both filter rows run three name-and-box pairs to a line** (`.filters.three`),
  not the single column `.filters` gives. Rendered and read first: fifteen boxes
  in one column is fifteen lines of form against a thousand pixels of empty
  panel. Boards keeps the plain grid — only the two rows on Coins carry the
  class, because only they are this long.
- **`overflow-wrap:anywhere` became `break-word` on `table.cgap`.** `anywhere`
  lets a column shrink to one character, and at seventeen columns the screen
  drew `+10.72 0%`, `WINDOW S` and `PERCENTIL E`. A figure broken between its
  digits is not a figure. Measured after the change: no box on the screen needs
  a sideways bar and the page does not scroll sideways.
- **The line under each table named its sort by the internal key** — "sorted by
  latePerTrade high to low". Not a word the owner can see. Two maps now carry
  the heading each sortable column shows, checked both ways against the source.
  Found by reading the rendering, not by a test.
- **The row under the cursor lights up** rather than zebra stripes: an opened
  row puts its window strip between two data rows, and stripes would then
  alternate wrongly.
- **`Clear the sort` moved out of the press row** into the filter button row, so
  `Choose early, read late` is a button alone with its own message beside it
  (RULE FOUR-A) and the four filter-row words match Walk it forward's exactly.
- **The filter row sits under the two paragraphs that describe the reading**,
  immediately above the table it screens (RULE ELEVEN clause 4).

## Parked

Nothing yet.
