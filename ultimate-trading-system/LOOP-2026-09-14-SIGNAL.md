# Loop record — the signal reading on Coins, per coin per shape

Owner, 2026-09-14: *"LOOP NOW! on everything: data load and review from the
server, deep analysis of the types of strengths of signals that can be
ascertained from the set-ups, coding of the analysis procedure and its
reporting per coin per shape, all of that analysis wrapped in sit-out band
sweeps (one per coin and shape) that find the sweet spot for the signal,
focusing of course on middle-of-plateau not spikes ... keep working until it's
deployed -- if there are decisions to make, then make your best decision and
report AFTER if we need to revisit any of them."*

And before it: *"build a scoring mechanism into the current code which
basically BY CODE determines what you stated ... a general metric about
'aptness to coin history signal' for each coin"*, then *"the analysis ... based
on each shape within each coin"*, then *"We're not gonna have a thousand
controls on this screen ... you're just going to be given a coin or group of
coins, and you're gonna perform the read."*

**What the loop covers**: the review of every coin on the box; the analysis
arithmetic (`lib/coinsignal.js`); its reporting per coin per shape on Coins,
computed on the existing press with no new control; the band sweep per coin
and shape; tests, guards, deploy, served record, word lists. **Not covered**:
Sweep's dual member voting mode (still parked from LOOP-2026-09-13-COINS.md
E); any change to what a record holds beyond what the analysis needs.

Every non-obvious choice is one line in section B. Every change that reached
the environment is in section F. Section A was written before any number
existed.

## A. The success rules, written before the numbers existed

The tests in `tests/test-coinsignal.js` check these and nothing else.

- **S1 — one list in, one answer out.** The analysis of one shape of one coin
  reads only the record's window moves and outcomes and the engine's own
  split; nothing else, nothing stored, nothing read from the candles again.
- **S2 — the band sweep.** Bands from 0 to 300 in steps of 10, one home for
  the grid, served to the screen. At every band: the share of decisions
  called (not sit out); the gap both ways per part under each layout; and the
  two-way edge over chance on the judging stretch.
- **S3 — the two-way edge, defined once.** On the `70/15/15` train part, a
  trader who sees the colour learns one lean per colour (the sign of the
  summed outcome after rising windows, and after falling ones); a trader who
  does not learns one lean for everything (the sign of the total). Both trade
  every called decision of test and held, skipping sit out. The edge is what
  the colour-seeing one keeps per called trade beyond the blind one. Chance
  is the usual size of that number when the colours carry nothing: the
  outcomes' spread over the called decisions, times the square root of the
  overlap factor, times `sqrt(((dr−d1)²·nr + (df−d1)²·nf)) / N`. The ratio is
  edge over chance. A train part with no decision of one colour has no lean
  for it and no ratio.
- **S4 — the overlap factor.** Trades open at the same time share their
  outcome, so chance is widened by `k = 1 + 2·max(0, hold − step)/hold`,
  read off the shape's own hours. On `Daily 1-day` and `Weekly 8-day` k is 1;
  on `Daily 4-day` it is above 2.
- **S5 — the plateau, not the spike.** The ratio across the grid is smoothed
  three points wide. A plateau is the longest run of at least three
  consecutive grid points whose smoothed ratio is at least 1 — beats chance —
  and, between runs of equal length, the one with the higher mean. The sweet
  spot is the middle point of that run (the lower middle when the run is
  even). No plateau means no band beats chance for three steps together, and
  the screen says so rather than naming a band.
- **S6 — the traits, at the sweet spot** (or at the band the box is set to
  when there is no plateau), each one word:
  - direction: `reverting` when the gap in points on the `70/15/15` train
    part is negative (up more often after a falling window), `trending` when
    positive, none when zero or unreadable;
  - holding: over the parts in time order under both layouts, `steady` when
    every part's gap sign is train's, `fading` when the parts that disagree
    are all at the end, `mixed` otherwise; a part with no gap (one colour
    missing) is skipped, not counted against;
  - carrier: `often` when the gap in points holds and the gap in move does
    not, `much` the other way round, `both` when both hold, none when neither.
- **S7 — the instrument is checked against itself.** With the link between
  window and outcome cut — the outcomes dealt into a different order while the
  readings stay — the analysis must find a plateau rarely. The review measures
  how rarely, per shape, on the real coins, before the screen says anything.
- **S8 — nothing refuses a coin.** Every shape of every coin gets a line: a
  band and a ratio, or a sentence saying no band beats chance. No cut-off is
  typed anywhere; the only bar is 1, which is chance's own definition.
- **S9 — computed on the press, no new control.** The analysis rides on the
  records reply and is drawn per shape; the three controls stay as they are.
- **S10 — the words on the screen are read off the served screen** and
  regenerated into the word list after the deploy; `luck` appears nowhere.

## Expected outcomes, written before the review ran

From the by-hand review of LTC and ZEC (2026-09-13): LTC `Daily 3-day` and
`Daily 4-day` find a plateau, ratio 1 to 2, `reverting` and `steady`; LTC
`Daily 1-day` reads `fading`; ZEC's daily shapes find no plateau and, where a
carrier shows, it is `much`; `Weekly 8-day` rows mostly find nothing, their
parts being 57 to 66 decisions. Anything else is news and goes in section C.

## B. Decisions taken inside the loop

- **B1** The band grid is 0..300 by 10: the by-hand review used 0..300 and
  the plateau rule needs steps fine enough that three consecutive points is a
  plateau and not the whole axis. One home, served.
- **B2** The bar for a plateau is 1 — edge equal to chance's own size. It is
  the only threshold and it is chance's definition, not a number to argue
  with. The record says plainly that 1 is a one-spread event and the review
  measures the false-alarm rate (S7) so the owner knows what a plateau is
  worth.
- **B3** Three consecutive grid points is the least a plateau can be. One
  point above the bar is a spike by the owner's own word; two is ambiguous
  and is not called a plateau.
- **B4** Chance is the closed form from the by-hand review, with the overlap
  factor, rather than shuffles: it costs nothing per band, and S7 checks it
  against real shuffles once, in the review.
- **B5** The judging stretch for the edge is test + held under `70/15/15`,
  as the by-hand review did and the owner read. The sealed layout's parts
  are read for the holding trait only; the reserve is not what the edge is
  judged on.
- **B6** `.claude/vps-run.sh` gains an optional second argument, forwarded
  as the endpoint's `arg`, which the endpoint has accepted all along; the
  review script takes one coin at a time because the endpoint hands a
  session 8 KB of output.
- **B7** The review script fetches this branch's `lib/` into a scratch
  directory on the box and requires the analysis from there, so the review
  and the product run ONE copy of the arithmetic — never a second copy typed
  into the script.

## C. What the review found

(filled as the review runs)

## D. What was built

(filled as it lands)

## E. Parked

- Sweep's dual member voting mode — unchanged from LOOP-2026-09-13-COINS.md E.

## F. What reached the environment

(filled as it lands)
