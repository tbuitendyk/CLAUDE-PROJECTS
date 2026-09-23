# Long loop, 2026-09-23 — every trade at its real size

Granted with `LOOP NOW!`: "middle number LOOP NOW! until it's fully deployed",
for the plan agreed in the conversation of 2026-09-23. The release moves its
middle number (owner's answer to first-or-middle), never its first.

## The owner's rule this loop serves

"the new system spec that allows creation of stage 3 data sets with SIZED trades
by the coin history field gate REQUIRES that all upstream processes use the
correct resulting trade sizes IN EVERY SINGLE TRADE INSTANCE, SIMULATED OR REAL."
And: "if you've given me code that doesn't size properly fix it all."
And: "sizing multiplies through" (the conviction ladder goes on top of a trade's
own size). And: the four comparisons stay at the standard $100 trade -- "that
intelligence on the sizing is part of what we're testing against the standard
trade so no you do not need to adjust it."

## Approved steps

1. Every trade priced at its real size everywhere it is priced: the figures
   stage 3 works out (drawdown, worst and best trade, money per trade, money by
   thirds), Table 3.C, `worst losing streak allowed`, `Worth walking?`, Held,
   Reserve, the capture, Protective stop tuner, Conviction sizing, and the money
   Held and Greenlight work out from a capture. Live trading already sizes each
   order (lib/live/signal.js) and is not touched.
2. The capture takes `breakout` survivors and leaves out the trades the coin
   history field gate stops; each trade carries its real size.
3. `Tune protective stop`, `No stop (clear)` and `Apply custom` disabled for
   `breakout` trades, with "protective stops are not tuned currently on
   breakout trades" beside the button; the service refuses the same.
4. Conviction sizing: a multiplier box on each row of the agreement table (any
   number, 0 turns the row off), a `Recompute` button, one table pooling every
   survivor when all survivors are chosen, and `Apply the conviction sizing`
   putting the numbers on every survivor in the table. Each trade's money is its
   own size times the row's number.
5. REBUILD REQUIRED in front of the name of every set that needs a rebuild,
   wherever it is listed; the stored name untouched. Rebuilt on first open, one
   heavy job at a time, each waiting for what it stands on. Looks taken on the
   garbage data go to zero ("the garbage data does not contribute to looks").

## Success rules, written before any number exists

- S1. A setting with no sizing (no field named, confirm off) prices
  bit-identically before and after: every stored field and every detailed figure.
- S2. A sized setting's stored totals (money, trades, the field's totals, the
  lean's parts) are bit-identical to before; its detailed figures are those of
  its own trades at their real sizes -- the drawdown of the running sum of sized
  trade money, the worst and best sized trade, the sized money in each third,
  and money per trade = (money + the round trip on the sum of sizes) / trades.
- S3. A capture adds up to its set: for every captured survivor, on test and
  held-back, the number of entries equals the trades the set recorded and the
  entries' money equals the set's money to the cent. On the box, the survivor
  that captured 156 test trades against a recorded 119 captures 119.
- S4. A survivor whose trades are all size 1 gives today's numbers exactly in
  Protective stop tuner, Conviction sizing and the tunings Held and Greenlight
  show. A sized survivor's `flat $` equals its captured money on the same
  windows.
- S5. On `breakout` trades Conviction sizing prices each trade from the money
  the simulator made on it; Protective stop is refused in words by the service
  and disabled on the screen.
- S6. Recompute with the multipliers 1, 2, 3 ... gives exactly the result the
  scan gives today; a row at 0 adds no money and no amount traded.
- S7. Apply with all survivors chosen writes the numbers on every captured
  survivor; `Take the sizing off` takes them off every one.
- S8. Flagged on the box after deploy, and nothing else: the stage 3 set whose
  test history numbers were worked out before sizing
  (S3-Doubles-CFA-70/15/15 - cert70 - #1-field b), the 8 Stage 4 sets cut from
  it, and every Stage 4 set holding a capture of the old form.

- S9. (3.236.0, written before its test ran) Opening one flagged set of a
  family rebuilds every flagged set in it; each keeps its id and its name, is
  written under the new release with a stamp saying what it was rebuilt from,
  keeps its old document beside it, and is no longer flagged.
- S10. A rule cut again on a board that has not moved keeps exactly the same
  survivors; a held set is read again under its own number; a half-life set is
  built from a run done again at the same half-lives.

No prediction is made about which way any survivor's money moves when sized;
the rebuild may keep more or fewer survivors, and that is read, not guessed.

## Decisions

- D1. Two releases, deploy-first: 3.235.0 carries steps 1-4, the flags, and
  rebuild-on-open for the test history numbers and the captures; the next
  release carries rebuild-on-open for the Stage 4 sets (cut again in place with
  the set's own rule, read again, built again), which is the largest and
  riskiest part and does not hold the rest back.
- D2. The size goes into the simulator's one settling place (newBook.take), so
  every figure the book produces is sized by construction; a call with no sizes
  passed multiplies by 1, which leaves every unsized result bit-identical (S1).
- D3. Stored totals keep their own arithmetic (the gate's size groups, the
  lean's parts); only the detailed figures are read from the sized pass. That
  keeps S2's bit-identical totals and changes nothing already on disk in the
  stage 3 records, so no stage 3 set is rewritten.
- D4. The test history numbers move to version 6: the older shape reads as
  absent (the existing RULE NINE pattern for this derived file) and the pass
  rebuilds them.
- D5. The capture moves to version 2 and every entry carries its size; a
  capture of the old form is flagged and rebuilt on first open, and the rebuild
  starts its list of scans and its looks at zero. Every capture on the box had
  zero looks when this was written (probe uts-capture-counts.sh, 2026-09-23), so
  no look is lost.
- D6. `Apply the conviction sizing` sends the multipliers the table on screen was
  priced at, never the boxes as typed; numbers typed and not yet priced hold the
  press and the line beside `Recompute` says so. What is applied is always what
  was priced.
- D7. `Run conviction sweep` starts from the multipliers on record when every
  survivor it reads carries the same ones, so the boxes open on what is recorded;
  otherwise the declared ladder.
- D8. With sizes, a shuffle no longer keeps the amount traded fixed, so the
  sentence "the same p holds for the return on the amount traded" stopped being
  true. The return on the amount traded now gets its own chance check
  (pNullReturn) and the line prints both.
- D9. Rebuild on first open happens once per visit to the page: a refusal is
  said in its own words and never pressed over and over. 3.235.0 rebuilds the
  captures (on Tune, when the set is chosen in the capture panel) and the test
  history numbers (on the Funnel, for the board on screen). The Stage 4 sets are
  flagged and say why; their rebuild is the next release (D1).
- D10. Two captures on the box were right but of the old form (their survivors
  size nothing): their sets are flagged as S8 foresaw and are captured again on
  open, which costs a minute each and loses no look (both had none).
- D11. The conviction result names the survivor's own entry; it was hard-coded
  as a market entry whatever the survivor was.

- D12. (3.236.0) Opening any flagged Stage 4 set rebuilds its whole family, in
  the order it stands: the rule, the held and reserve sets read from it, then
  each half-life set built from it and the sets read from that. No reading is
  left standing on a rule cut again under it. A set that cannot be rebuilt says
  why on its own line; what stands on it is skipped; the rest carry on.
- D13. The rule is cut again with the rule it recorded -- the closed rule, its
  floors included -- on the board it was cut from, read the way its own screens
  read it: its coin and shape's records, under the record it keeps of what the
  filter kept when it was cut, never under today's filter (a set is a record of
  a decision and does not move when the filter does). The closing is not
  re-derived. (Corrected before the deploy: the first draft read the board
  through today's filter, and for a set cut on all units together that would
  have read the first coin and shape's board instead of the blend.)
- D14. A half-life set is built again from a run redone on the rule cut again,
  at the half-lives its own run was ticked at. If no record improves on the new
  table the set is left as it was and says why.
- D15. A held or reserve set is read again under its own number, at the share
  and the sanity bar the reading it replaces was read at; the count of looks is
  unchanged (the old reading's look is replaced, not added to).
- D16. Every rebuilt set keeps its id and its name; its document as it was is
  kept beside it (<id>.json.before-rebuild) and its capture file is moved aside
  with the same ending; its capture summary is marked to be taken again, so the
  next time it is chosen on Tune it is captured again.
- D17. The rebuild's press has its own address, rebuild-required: the address
  rebuild was already the Funnel's press that works out a Stage 4 set's own
  numbers again.
- D18. A rule cut again keeps no half-life table read on its survivors as they
  were: those tables go aside with the old document, their retrained members'
  files are moved aside with the same ending, and the run done again is the
  rule's first (look 1), so the garbage runs do not count and a run done again
  never writes over a kept one.
- D19. The test history numbers are counted done for the set's coin and shape
  the way the screen counts them; if they are not, the pass is pressed and a
  pass that runs to its end is what the board reads. A stop pressed on it stops
  the rebuild, in words, and opening the set again carries on. A coin and shape
  today's filter puts out of the pass cannot have its numbers worked out, so
  that set says why and is left as it was.
- D20. One family at a time: a flagged set opened while another family is being
  rebuilt waits its turn and starts when that one ends, without being opened
  again. Its line on the screen follows the rebuild where it stands (asked every
  20 seconds) and the screen is never drawn again for it; when it ends the line
  says to choose the set again to see it.
- D21. A set cut on all units together is not rebuilt: none stood on sized
  trades when this was written (probe uts-rebuild-family.sh: all 8 flagged
  Stage 4 sets are on one coin and shape each), and new sets are never flagged.
  One would say so and be left as it was.
- D9, corrected. The Funnel's rebuild of the test history numbers asks for the
  board on screen, but the pass prices every coin and shape the filter keeps
  whatever it is asked for (found in this loop, below, not fixed in it). On the
  box that is all 86 coins and shapes of S3-Doubles-CFA-70/15/15 - cert70 -
  #1-field b -- which is the rebuild that stage 3 set's own flag asks for, but it
  is long, and every Stage 4 rebuild waits on it the first time.

## Verified before the deploy

- S1, S2: tests/test-bracket.js `everyTradeSettlesAtItsOwnSize`, test-confirm.js
  `theRichFiguresOfASizedSettingAreItsTradesAtTheirSizes`, test-fieldgate.js
  `theRichFiguresUnderTheGateAreTheTradesAtTheirSizes` -- every size 1 is
  bit-identical, sized figures are the trades at their sizes, totals unchanged.
- S3: test-tunecapture.js `aSizedSettingsCaptureAddsUpToItsSetToTheCent` -- a
  stage 3 chain priced under a fabricated field: every captured survivor's test
  and held-back trades match the record's count and money to the cent, with
  sizes 0.5, 1 and 2 all present. The unsized chain test still passes.
- S4-S7: test-convictionsweep.js `eachTradeAtItsOwnSizeTheLadderOnTop`,
  test-stoptuner.js `eachEntryAtItsOwnSize`, test-tunecapture.js
  `theStopIsHeldOnBreakoutTradesAndTheConvictionRowsTakeYourNumbers`.
- The Tune screen drawn in a browser with fabricated answers and read: the stop
  held with the owner's words beside it, a box on each row, Recompute in its own
  row, Apply held while typed numbers are unpriced, REBUILD REQUIRED in front of
  the flagged set's name in both boxes.

## Verified for 3.235.0 and 3.236.0 (the checking done after each deploy)

- 3.235.0 deployed (7007324), then the suite: two tests pinned 3.234's shapes
  and failed; fixed test-only (2cf807c). The box then flagged 11 sets and
  nothing else, as S8 foresaw.
- S9, S10: test-tunecapture.js `aFlaggedFamilyIsRebuiltInPlaceWhenOneOfItIsOpened`
  -- a rule cut from a sized stage 3 set, a held set read from it and a
  half-life set built from it, all stamped with the release before sizing:
  opening the held set rebuilds all three under their own ids and names, each
  kept as it was beside it and none flagged afterwards; the rule keeps the same
  survivors on a board that has not moved; the held set is read again under
  its own number; the half-life run is done again on the rule, is its only run,
  and the old run's retrained members are kept aside; the half-life set is
  built again in place from that run, each record it keeps carrying the
  half-life that won on it. Every set of the family says the rebuild is going
  while it goes, and says how it ended.
- Hunting the instrument: the first version of that test passed without ever
  building a half-life set again -- on the planted coin the run done again
  improved no record, so the set was left as it was (D14, and it said why,
  which is the refusal working). The test now makes the first row of every
  table it reads won by the 12-month column when no row was won, so the part
  that builds the set again in place is run and checked.
- Guards: the ten on the family rebuild and the four left from 3.235.0 were
  each broken in turn and every one was caught.
- The flag line drawn in a browser on Tune with fabricated answers and read:
  the reasons, then "rebuilding now: ..." in the same line, one press made, no
  dialog, the screen not drawn again.
- A capture pressed on a set still waiting for its rebuild is refused while the
  rebuild keeps the box busy; one taken in a gap between two steps is of the
  survivors as they were, and is marked to be taken again when the set is
  rebuilt, with no look on it counted. Left as it is.
- 3.236.0 deployed (477c97e): the whole suite after it, 1202 passed, none
  failed. The box flags the same 11 sets after the deploy (nothing is rebuilt
  until it is opened).

## Found, not in this loop (left for the owner)

- The press beside Work out the test history numbers prices every coin and
  shape the filter on Table 3.C keeps, whatever coin is chosen. In
  lib/stages.js funnelRichStart, the coin it is aimed at is read from `state`,
  but inside the pass `state` is a second name for the answer ensureTally gives
  (3.103.1), which never names a coin -- so 3.136.0's "make the press follow the
  coin chooser" has never taken effect. The fix is one word (rename the inner
  one). tests/test-funnel.js pins the line's text and could not see it.

- A setting whose quorum is the field alone captures no training entries: the
  committee's training stream is built without the field's signs. Its test and
  held-back entries are right.
- Deleting a Stage 4 set leaves its capture file behind: the 12-survivor
  capture of 15 September belongs to a set that is gone.
- The word list misses words Tune shows: the progress line beside `Capture the
  trades of this set` and the conviction table's headings are drawn by helpers
  the generator does not walk.
