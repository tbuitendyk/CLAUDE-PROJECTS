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

## Found, not in this loop (left for the owner)

- A setting whose quorum is the field alone captures no training entries: the
  committee's training stream is built without the field's signs. Its test and
  held-back entries are right.
- Deleting a Stage 4 set leaves its capture file behind: the 12-survivor
  capture of 15 September belongs to a set that is gone.
- The word list misses words Tune shows: the progress line beside `Capture the
  trades of this set` and the conviction table's headings are drawn by helpers
  the generator does not walk.
