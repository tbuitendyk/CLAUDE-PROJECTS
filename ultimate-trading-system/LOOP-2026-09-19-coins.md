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

## Decisions — parts 3, 4 and 5

- **One tick list, touched from two tables.** Choose early, read late's ticks
  keep no list of their own; they tick the row up on Walk it forward, which is
  where a promotion has always been read from. `cPickEcho` puts every tick box
  in the page back in step and rewrites the three lines that count them WITHOUT
  a repaint, because a tick that redraws the table throws away the owner's
  place on every press.
- **The jump leaves every other filter box alone.** It sets the two that name
  the pair and empties the two that name one row of it. Wiping the rest to make
  a jump land would be the software deciding what the owner may look at.
- **The jump lands on the page that holds the marked row, and says where the
  other one is.** First version always went to page one; pressed it and counted
  the marks on screen, which came back nought — a pair runs to hundreds of rows
  and a page holds a hundred. It now computes the page and names where each of
  the two marked rows sits.
- **Promote goes in ONE request.** Tick every row shown can tick thousands, and
  the old press sent one HTTP request per row against a file of tens of
  megabytes. `setPickedMany` checks every key before writing any — half a list
  applied and the rest refused leaves nobody able to say what happened.
- **Tick every row shown reaches every SHOWN row, not the page.** The filter
  boxes decide what a press reaches; the press has no opinion. It promotes
  nothing: the list stays editable and Promote the ticked rows is still its own
  press.
- **Choose early, read late's table got the taller box too** — it is now a
  selection surface as much as Walk it forward is, so it gets the same shape.
- Ugly-factor fixes found by rendering and reading: the jump button wrapped to
  three lines and made every row three lines tall (now one line, `nowrap`); a
  chunk shape broke at its hyphen in some rows and not others; a marked row
  drew its accent bar on all twenty cells instead of one.
