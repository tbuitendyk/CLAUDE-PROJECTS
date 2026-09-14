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
- **B8** The link-cut check (S7) is worked out once, when a coin is read, and
  stored on the record: record shape 8, fifty deals per shape, seeded so the
  same coin gives the same answer. It costs fifty analyses per shape and
  would not survive a draw; it depends on no band. Every reading on the box
  is shape 7 and reads as such until the owner presses the read again.

The next six were taken AFTER the first review came back (section C), each
one a fault found in the instrument by hunting it before its numbers were
believed. The success rules in section A stand; these change how the rules
are carried out, and every one is pinned by hand in the tests.

- **B9** A band where both learned leans are the blind one is not a hole. The
  colour-seeing trader makes every call the blind one makes, so the edge is
  exactly nothing and so is its chance: the band reads 0, the screen says
  `the colour changes no call`, and it breaks a run like any reading under
  the bar. About half of all rows at band 50 had been holes for this reason.
- **B10** Chance's spread is the spread of EVERY outcome on the judging
  stretch, called or sat out — the null the link cut deals from, and it does
  not shrink with the band. Read over the two or three decisions a wide band
  still calls on a short weekly row it came out near zero, and one dealt
  ratio read 1264×.
- **B11** A band with no reading stays a hole after smoothing. Before, a hole
  took its neighbours' average and a run spanned two of them: five points
  wide on three readings.
- **B12** What a plateau is worth is its strength against the dealt ones.
  Strength is width times height — the run's points times their mean
  smoothed ratio. The record keeps every dealt plateau's strength and the
  screen says how many were at least as strong as the real one. The bar of 1
  across 31 bands still names a plateau in about a quarter of the deals (up
  to half on the weekly rows), so the count of any plateau says little on its
  own; the screen carries it only when there is no real plateau to weigh.
- **B13** The deal stays inside each part of the three-part layout, and a
  dealt series has an overlap factor of 1. The B4 check (made for the first
  time in this loop, B14) showed the whole-history deal giving one coin a
  judging stretch a third as wild as its real one and another half again as
  wild, and the 41-hour holds' dealt ratios a third too narrow because the
  shape's overlap was applied to outcomes that share no hours.
- **B14** The review script deals exactly as the product deals and prints the
  spread of the dealt ratios at every fiftieth band, which should be about 1
  if the closed form of chance is right. B4 promised this check; it had not
  been made until the second review.

## C. What the review found

Three passes over all 18 coins on the box, read-only, from the branch's own
lib (B7): the first with the instrument as pre-registered, the second after
B9–B12, the third after B13. The numbers below are the third pass
(`vps-access/scripts/uts-coins-signal.sh`, 40 deals per shape in the script;
the product stores 50). Every reading on the box is record shape 7, taken
2026-09-13 16:11, band 50.

**The instrument, hunted.** The first pass was not believed, and five faults
came out of reading it (B9–B13). What the third pass says about the
instrument itself:

- **The closed form of chance is right.** The spread of the dealt ratios
  (B14) is 0.91 on `Weekly 8-day`, 0.94 on `Daily 1-day`, 0.87 on
  `Daily 2-day`, 0.95 on `Daily 3-day`, 0.96 on `Daily 4-day` (medians over
  every fiftieth band with fifteen or more deals; quartiles about 0.8 to
  1.1). A little under 1, so chance is if anything slightly overstated and
  the ratios slightly modest.
- **What a plateau is worth, on its own, is not much.** With the link cut the
  bar of 1 still names a plateau in 7 of 40 deals on a typical shape (a
  quarter of rows are at 10 of 40 or worse). That is why the screen carries
  the strength count (B12): the number to read is `one at least this strong
  in F of 50`, not whether the word plateau appears.
- **The two-way edge rewards a lean flip on a drifting coin.** ZEC's deals
  name a plateau in 23 to 28 of 40 on three shapes; XRP's `Daily 1-day` and
  `Daily 2-day` in 21 to 23. On those coins train's drift (down) disagrees
  with the judging stretch's (up), so any deal that flips one colour's lean
  to long on train wins on test and held whatever the colours carry. The
  check catches it — ZEC's `Daily 4-day` plateau reads `at least this strong
  in 23 of 40`, which is to say worthless — but it is a weakness of S3's
  sign-based lean and it is written to section E as a candidate for a later
  loop, not changed here (S3 was pre-registered and the owner read the
  by-hand review it came from).
- **`the colour changes no call` is the reading at band 50 on 43 of 90
  rows.** Both learned leans are the blind one: on train the drift decides
  more than the colour does. Read beside the traits: a coin can be
  `reverting` (a rise is more often followed by a fall) and still show no
  two-way edge, because on train going short after either colour paid better
  than going long after a falling one.
- **The direction trait reads `reverting` on 78 of 90 rows.** It is the sign
  of train's gap in points and nothing else, so a gap of −1 point reads the
  same as one of −9. The table under the bar shows the gap; the word does
  not carry its size. Whether the shared opening price between a window and
  its outcome adds a mechanical share to that count was not checked in this
  loop (section E).
- **Section A's S4 example was wrong in one number.** The overlap factor on
  `Daily 3-day` and `Daily 4-day` is 1.83, not "above 2": both hold 41 hours
  on a 24-hour step (`lib/dataset.js`), so k = 1 + 2·17/41. The rule is the
  formula and the test reads the hours; only the example was typed wrong.

**Against the expected outcomes** (written before the review ran):

- LTC `Daily 3-day`: plateau 70–220, 16 bands, mean 1.46×, sweet spot 140 at
  1.35×, `reverting steady both`, at least this strong in 0 of 40. **As
  expected**, and the strongest reading on the box.
- LTC `Daily 4-day`: plateau 190–210, 3 bands, mean 1.70×, sweet spot 200,
  `reverting steady often`, at least this strong in 7 of 40. **Direction and
  holding as expected; the plateau is thin** and a deal matches it about one
  time in six. At band 50 the colour changes no call.
- LTC `Daily 1-day`: `fading`, no plateau. **As expected.**
- ZEC: `Daily 1-day`, `Daily 2-day`, `Daily 3-day` no plateau — **as
  expected**; `Daily 4-day` names 240–260 and the check says 23 of 40, so
  nothing. The carrier `much` shows only on `Weekly 8-day` — **as expected**.
- `Weekly 8-day`: 15 of 18 coins find no plateau — **mostly nothing, as
  expected**. LTC's weekly 190–210 is matched by 12 of 40 deals (nothing).
  BCH and DOT are news, below.

**News** (not pre-registered; findings, not decisions):

- ATOM `Daily 2-day`: plateau 140–240, 11 bands, mean 1.46×, sweet spot 190,
  `reverting steady often`, at least this strong in **0 of 40**. The second
  strongest reading on the box.
- BCH `Weekly 8-day`: 90–210, 13 bands, mean 2.08×, sweet spot 150,
  `reverting mixed`, 1 of 40 — on about 105 judging decisions, with holding
  `mixed`.
- BCH `Daily 1-day`: 230–300, 8 bands, mean 1.72×, sweet spot 260, `reverting
  steady often`, 1 of 40 — at the top of the grid, where the band calls few
  decisions; the line now says how many (D).
- DOT `Weekly 8-day`: 0–120, 13 bands, mean 1.16×, sweet spot 60, `reverting
  steady both`, 1 of 40 — wide and low.
- ETH `Daily 4-day`: 240–300, 7 bands, mean 1.16×, `trending mixed`, 3 of 40
  — the only `trending` plateau; at the top of the grid.
- XLM `Daily 2-day`: 40–60, 3 bands, 6 of 40 — thin. XRP `Daily 2-day`:
  60–80, 15 of 40 — nothing.
- Everything else: no band beats chance for three steps together. On BNB,
  DOGE, LINK, TRX and UNI the daily shapes read `reverting steady often` with
  no two-way edge at any band — the history leans one way after a rise, and a
  sign-following trader cannot use it because train's drift swamps the
  colour.

## D. What was built

Release **3.127.0** (second digit: new behaviour on the screen and record
shape 8), then **3.127.1** (third digit: the sweet spot's line says what share
of the history its band still calls — a reading at band 260 is an edge on the
few decisions that moved that far), then **3.127.2** (third digit: every
sentence on the line sits in a template that carries a tag, and the eight
trait words have one home in `lib/coinsignal.js` that the word-list generator
reads — because the list regenerated after the 3.127.1 deploy had holes: the
trait words, `the colour changes no call`, `no ratio`, `% called` and both
link-cut sentences were on the owner's screen and on no list, the exact fault
RULE ONE-A was written to end). Commits 90749fc, 94c9736, 80a51ef, 778488d
and the 3.127.2 commit on the session branch; 3.127.0 was never deployed on
its own.

- `lib/coinsignal.js` — the arithmetic, pure, no I/O: the grid (B1); the
  overlap factor read off the shape's hours (S4); the leans and the two-way
  edge (S3, B9, B10); one band's reading; smoothing and the plateau (S5,
  B11); the traits (S6); the whole reading of one shape (`signalSummary`);
  the deal within parts and the false-alarm count with strengths (S7, B12,
  B13); `linkCutWorth`.
- `lib/coinsrun.js` — record shape 8; at read time each shape's link-cut
  check is stored (B8); the records reply carries `signal` per shape, read at
  the band the box holds, with the check's worth against the real plateau.
- `public/construct.js` — under each bar's heading, one line: the reading at
  the sweet spot with the plateau's width and mean (or the sentence that no
  band beats chance for three steps together), the traits as one-word marks,
  the reading at the band the box is set to, the link-cut count, and the
  sweep as one bar per band with the plateau and its middle marked. No new
  control (S9). `public/construct.html` — its styles, on the heading's size
  and baseline (RULE FOUR).
- `tests/test-coinsignal.js` — eight tests, one per rule of section A, with
  B9–B13 pinned by hand. `tests/test-coinsrun.js` — the check on the record;
  the signal served at the box's band. `tests/ui-coins.js` — the screen
  pressed for real: a line under every bar, a band and a ratio or the
  sentence, the box's band, the check, one bar per band, every trait one of
  the eight words, `luck` nowhere. Fourteen mutation guards in
  `tests/mutate-servicecontrol.js`, each naming the test that reads the line
  it breaks (RULE EIGHT).
- `.claude/vps-run.sh` takes an optional argument (B6);
  `vps-access/scripts/uts-coins-signal.sh` on the vps-access branch is the
  read-only review, one coin per call, from the branch's own lib (B7, B14).

## E. Parked

- Sweep's dual member voting mode — unchanged from LOOP-2026-09-13-COINS.md E.
- **A lean with the drift taken out.** S3 learns each colour's lean as the
  sign of its summed outcome on train, so on a coin whose train fell and
  whose test and held rose, any flip to long wins for reasons that have
  nothing to do with the colour (C). A lean read against train's own average
  — long after the colour whose outcomes beat the rest, short after the
  other — would not have that weakness, and would give a reading where the
  screen now says `the colour changes no call`. It changes a pre-registered
  rule the owner read the by-hand review of, so it is theirs to call.
- **The direction trait carries no size.** `reverting` on 78 of 90 rows is
  the sign of a gap that may be −1 point or −9. Whether the word should need
  the gap to beat its own chance, and whether the shared opening price
  between window and outcome adds a mechanical share, are both unchecked.

## F. What reached the environment

- **The vps-access branch** (the read-only door): `scripts/uts-coins-signal.sh`
  in three versions (a77a91b, c59c838, 24dcb69). READ-ONLY throughout: it
  fetches this branch's `lib/` into `/tmp/uts-signal-src` on the box, reads a
  coin's record off disk, and writes nothing under `/opt`. Three passes over
  all 18 coins, one coin per call.
- **The box, 2026-09-13 16:52 UTC**: deployed b122ba9 (3.126.1) → 778488d
  (3.127.1); `healthz OK on 127.0.0.1:8094`; the service restarted once. The
  box was idle (`busy: none`) before the deploy.
- **The box, 2026-09-13 ~17:10 UTC**: deployed 778488d → 2ab96d1 (3.127.2);
  `healthz OK`; one more restart; idle before it.
- **`SERVED.json`** captured after each deploy; **`SCREEN-WORDS.md`**
  regenerated from the served commit each time. After the second, the Coins
  list carries every word on the new line and the eight trait words under
  "Values the screen shows as data"; `tests/test-sweepwords.js` green.
- **Guards**: every guard on `lib/coinsignal.js` and `lib/coinsrun.js` was
  deleted in turn and the suite caught every one — run after each deploy,
  never gating it (RULE EIGHT).
- **Not touched**: the band on the box (still 50), every record under
  `data/coins/` (all 18 still record shape 7 — the owner presses
  `Read these coins` to bring them to shape 8), Sweep, the members, anything
  trading.

**What the owner will see on Coins**: every coin named as written under an
older record shape until it is read again, exactly as after 3.124.0. One
press of `Read these coins` with the box blank reads all 18; the link-cut
check adds fifty analyses per shape, about a second a coin.

## G. After the loop — owner GO NOW! 2026-09-14 (3.128.0)

The loop ended at 3.127.2. The owner then pressed the read (23:15 to 23:17
UTC, all 18 coins written), saw `THIS SCREEN IS INCOMPLETE.` with
`2 read(s) failed`, and ordered three things, plus one rule change, on one
`GO NOW!`: *"build the tick, the green line and the worker fix -- we want to
favour bands that still trade"*. Second digit: a new control.

- **B15 — the sweet spot favours bands that still trade.** S5's "middle of the
  run" is replaced, on the owner's order: the sweet spot is the band inside
  the plateau with the most edge per decision (edge per called trade times
  the share called), smoothed three wide, the lower band on a tie. The
  plateau itself, its strength and the link-cut count are unchanged; the
  middle is still carried on the reply. With no per-decision edge to read
  (the tests' bare ratio lists) the middle is still used.
- **B16 — the read hands control back between deals, rather than moving to a
  worker thread.** The banner's cause (C-2, below): the read runs inside the
  service and never yielded — `loadSymbolAll` awaits a synchronous file read,
  so the whole 118-second run held the event loop, and the front door times
  a request out at 60 seconds. A worker thread was proposed and is the
  textbook answer, but the runner's tests fake a coin's prices by replacing
  `pipeline.loadSymbolAll` in the process, which a worker cannot see; moving
  the read out of the process meant rewriting those tests around on-disk
  fixtures, more change and more risk for the same outcome on the screen.
  Instead the link-cut check yields to the event loop after every deal
  (about 35 ms), so an ask waits for one deal and not for the read. Measured
  in the test: the longest gap during a 1500-decision read stays under a
  quarter of the read. The read is not faster; the service just answers
  while it runs. If the owner wants the read off the service's thread, that
  is a separate piece of work.
- **B17 — the tick has the band's home and door.** `coins_band_auto` beside
  `coins_sit_out_band` in `data/settings.json`, set through `api/coins/band`
  like the band, read back inside the records reply. Each served shape says
  which band it is drawn at and why: `{ value, source: 'sweet spot' | 'typed'
  }`. The tick changes what Coins draws and nothing else, because nothing in
  `lib/` reads the band today (below).
- **B18 — green means the sweet spot's edge is above 1.0× chance**, exactly
  as the owner said; the link-cut count prints inside the green, so a green
  line can still read `one at least this strong in 28 of 50`.

**C-2. What the banner was.** Three read-only asks of the box
(`uts-coins-status.sh`, `uts-svc-answering.sh`, `uts-svc-route.sh`): the read
ran 23:15:33 to 23:17:31 UTC and wrote all 18 coins, none failed; the
service was up throughout and answered the status ask in 2 ms afterwards;
the records reply comes back whole, 3.9 MB in 2.5 s; the front door proxies
`/uts/` with default timeouts (60 s). So the two failed reads were the
screen's status poll and its redraw, both waiting behind a read that never
yielded. Not a crash, not a bad record.

**Reached the environment**: deployed 2ab96d1 → 6913a48 (3.128.0),
`healthz OK`, the box idle before it; `SERVED.json` captured and the word
lists regenerated from it (the Coins list gains `each shape at its own sweet
spot` and `(its own sweet spot)`); every guard on the signal module, the
runner and the screen deleted in turn and caught. The records on the box are
untouched: they are shape 8 and read as they are.

## H. The passers — owner GO NOW! 2026-09-14 (3.129.0)

The owner, after reading the five rows at 0 to 1 of 50 (a count I had
mis-stated as four, having dropped BCH `Weekly 8-day` without saying so):
*"there should be a summary section at the top of the coins page ... that
lists the coin/shape combos that pass at 0 to 2 null sets confirmations ...
then on sweep there should also be a check box that selects the custom group
of passers."* Built as COINS.md section 10 describes. Decisions:

- **B19 — the bar is a box, not a constant.** "0 to 2" is the owner's
  number; typed into code it would be a choice taken away invisibly (RULE
  FIVE). Default 2, one home beside the band.
- **B20 — a passer is ticked until un-ticked.** The store holds the rows the
  owner turned OFF, so a coin and shape that passes after the next read is
  ticked by default and the owner sees it, rather than silently absent from
  Sweep's runs.
- **B21 — the pairs are written on the set.** A launch with the tick on reads
  the ticked pairs off Coins at that moment and records them; a set
  relaunched from its own record uses the pairs as written, never what Coins
  says later.
- **B22 — each pair builds its own units at its own shape.** Five pairs
  across four shapes is one launch of five units (singles), not five coins
  times four shapes.

**Reached the environment**: deployed 6913a48 → febac61 (3.129.0),
`healthz OK`, the box idle before it; `SERVED.json` captured and the word
lists regenerated from it (the Coins list gains `coins and shapes that pass`,
its column headings and `no coin and shape passes at this bar`; the Sweep
list gains `only the coins and shapes ticked on Coins`); every guard on the
passers deleted in turn and caught. The records on the box are untouched;
the bar reads its default of 2 and every passer is ticked until the owner
un-ticks it.

**A sentence on the screen that is not true**, found while wiring the tick
and left standing (RULE ZERO): the Coins note and the band box's hover say
Sweep trains with this same number. Nothing in `lib/` reads
`coins_sit_out_band` (grep, 2026-09-14). That is the parked dual member
voting mode (E). The owner decides whether the sentence goes or the mode
gets built.

## I. The confirmation overlay — owner GO NOW! 2026-09-14 (3.130.0)

Pre-registered as COINS.md section 11 before any number existed; the owner's
order: *"we need to be able to determine that categorically easily by what we
see on screen."* Second digit: a new control and new behaviour.

- **I1 — the lean is read at pricing time, on the unit's own candles.** A unit
  whose coin and chunk shape pass on Coins is handed the passer's band and
  its two leans (after `rising`, after `falling`); the worker reads every
  chunk's window colour by the Coins arithmetic itself (`windowMoves`,
  `readingsUnderBand` in `lib/coins.js`) at that band and at Coins' own
  yardstick — the coin's median window move on the Coins record, carried on
  the lean — so a window is the same colour here as on Coins whatever range
  the run loaded (found hunting the instrument: the reserve grade prices the
  held-back window on a map of that window alone, whose median is not the
  coin's). Only the band, the yardstick and the two leans are written on the
  set (`confirmLeans`), so a set continued or rebuilt reads them off its own
  record whatever Coins says later.
- **I2 — three runs of the one simulator, and the money added back up.**
  Confirmed, unconfirmed and no-lean calls are priced as three call lists
  over the same periods, scaled per kind and summed. That is exact because a
  period's trade is priced on its own candles and nothing carries between
  periods; held on a fixture through the worker's own window pricer: `sized`
  ×1/×1 is the plain money to a cent, ×2/×1 adds exactly the confirmed money
  once more, `confirmed only` takes exactly the unconfirmed money and trades
  away. No new simulator, and `off` is byte for byte what every run before
  this release priced.
- **I3 — confirm is in the fold key only on a unit with a lean.** On any
  other unit the three values place the same orders and fold into the first,
  the way 24/5 folds on a weekly unit; the count says so before the launch
  and a test holds count and fold equal with and without leans.
- **I4 — the count reads the leans whatever the dial says.** The screen greys
  the dial off the count; a count that only looked when the dial was already
  on could never let it be switched on. The passers reply is memoised on the
  settings file's and the record files' names and mtimes, so the cost line
  does not pay seconds per box change.
- **I5 — the rich figures are read at size 1 over the trades actually
  taken.** Drawdown, wins and thirds come from one plain pass over the calls
  that survived the split (a kind priced at ×0 leaves that pass too); money
  and trade count come from the split. The kept scrambles and the null-set
  deals go through the same split and skip the rich pass, as before.
- **I6 — the printed word is the test window's.** Every row with a lean
  stores its six numbers for the test window and, where priced, the held-back
  window. The word beside a setting on `Table 3.A` and beside a coin on
  `Table 3.B` is decided from the TEST six numbers summed over the rows,
  because the word sorts the table and nothing may order a table by the
  held-back window. The held-back six numbers are summed per setting and per
  coin as well and ride on the tally (`hlp`), with no word printed from them
  yet — a held-back verdict, if the owner wants one on the screen, is a
  separate ask.
- **I7 — the verdict sorts in its written order.** `adds nothing` < `just
  leverage` < `adds value` < `better signal`, best first on one click, rows
  with no word last; never alphabetically, which would put `better signal`
  before `just leverage`.
- **I8 — Greenlight refuses a survivor priced past `off`.** The live path
  reads no lean off Coins, so a survivor priced `sized` or `confirmed only`
  would be traded at size 1 as though that were its record. Refused in
  words, tested, until the live path can read the lean. Not in section 11;
  a consequence of the dial that could not be left silent.
- **I9 — Tune's per-trade capture does not carry the lean (parked).** It
  prices each entry on its own at size 1; a Stage 4 set built from a `sized`
  setting is re-priced on Tune at size 1. Said here, left for the owner.
- **I10 — the tables rebuild once.** `TALLY_V` moves to 7, so every stage 3
  set's tables are rebuilt in the background the next time Boards opens them
  (announced on the screen, as every retotal is). The records themselves are
  untouched: an older record reads `confirm` as `off` with no lean and no
  word, which is exactly what it was priced as.
- **I12 — the window arithmetic moved to its own module, unchanged.** The
  worker may not reach `lib/coins.js` (through the vocabulary it would reach
  the orchestrator, and `test-pool.js` holds the worker's whole require tree
  to that), so `windowMoves`, `medianAbsMove` and `readingsUnderBand` moved
  verbatim to `lib/windowmove.js`; Coins re-exports them under the names
  every caller already reads. One home, no copy.
- **I11 — the Funnel reads `confirm` as one more dial.** A rule can name it,
  and a Stage 4 set built under such a rule keeps only the rows at that
  value; the board rows carry it (`off` on every record from before). Verify,
  History and the rest read the rows as they are.

**Reached the environment**: deployed febac61 → f67a193 (3.130.0),
`healthz OK`, the box idle before it; `SERVED.json` captured and the word
lists regenerated from it (the Sweep list gains `Confirmation`, `confirm`,
`confirmed ×`, `unconfirmed ×` and the choices `confirmed only` and `sized`;
the Boards list gains `confirm`, `verdict`, `sized` and the four words `adds
nothing`, `just leverage`, `adds value`, `better signal`; the Funnel's dial
list gains `confirm`). Eighteen guards on this release: sixteen deleted in
turn and caught on the first pass; two were aimed at lines that had moved
after they were written (the passers' lean gained its yardstick; the ticked
passers read the memoised list) and were re-aimed and caught on the rerun.
The records on the box are untouched; every stage 3 set's tables rebuild
once, in the background, when Boards next opens them (I10).

**Two things found beside the work and left standing (RULE ZERO).** Two
older guards on `theStageThreeCountIsTheLaunchsFoldWithoutTheSettings`
(3.46.3 and 3.52.0) point at the count's key line as it read before 3.72.0
put the hold hours into it, so they have been aimed at nothing since then;
re-aiming them is a two-string edit in `tests/mutate-servicecontrol.js`,
awaiting a yes. And `tests/ui-funnel.js` fails at its first wait (the step 1
table never draws in the harness) on the previous commit exactly as on this
one, so it is not this release's; not touched.

**Hunted on the instrument, before the owner sees a number.** (a) A trade
at twice the size being exactly twice the money rests on the fee being a
share of the position — it is (`lib/paper.js`, per leg), and the fixture
holds it. (b) The verdict compares sized money against size-1 money on the
same trades, so a lean that never fires (every call a no-lean call) yields
no word rather than `adds nothing`; a row with confirmed or unconfirmed
trades and a tie in money reads `adds nothing`, the same money is not more
money (test). (c) `better signal` demands the confirmed trades beat BOTH
other kinds per trade; with no no-lean trades at all, beating the
unconfirmed is enough, and with no unconfirmed trades the confirmed cannot
be shown better than them, so `adds value` is the most such a row can say
(tests). (d) The word is categorical and carries no chance rate of its own;
the null set beside every row still says whether either money beats chance.

## J. The forecast score says what it is out of — owner GO NOW! 2026-09-14 (3.130.1)

The owner, on being told how `forecast score` is worked out: *"would not the
forecast score number require knowledge of the number of trades in the test
stretch? Otherwise, how can we know the accuracy based on a single number."*
It would, and the screen did not show it. The order: no new column; in the
same cell, the sum, a slash, the denominator, and a percentage in brackets;
computed on the fly from what the record already holds.

- **J1 — the count was on every record and on no row.** Stage 1 writes
  `counts.test` on each record; the table now serves it as `testChunks`.
- **J2 — the cell reads `180.0 / 200 (90.0%)`.** The share is the sum
  divided by the count: the average sureness placed on what happened, 100%
  always sure and always right, 33.3% a third on everything. A record with
  no count prints the sum alone; a share is never made up.
- **J3 — the sort is unchanged**: the column still sorts by the sum, said
  in its hover. Sorting by the share is a one-line change, awaiting a yes.
- **J4 — stage 2's two forecast score columns are untouched.** They have
  the same reading and the same fix; not in this order.

## K. The ceiling box and its column name each other — owner GO NOW! 2026-09-14 (3.130.2)

The owner asked whether `the most one trade may count for` on Sweep and
`biggest before the ceiling` on Boards were the same thing, and why neither
named the other. They are the two ends of one thing: the box sets the
ceiling on how many ordinary trades the biggest may count for when weighing
by money; the column reports, per unit, the biggest trade's count before
the ceiling held it down and how many trades were held at it. The column's
hover said "the ceiling you set", the box's help said "the limit", and the
launch's refusal for a bad value called the box "the most one week may
count for" — a name on no screen. All three now use the other's label as
the screen draws it, on both tables that draw the column. The names
themselves are unchanged; whether the two should share one name is the
owner's call.

## L. The stage headings compare the tick — owner GO NOW! 2026-09-14 (3.130.3)

The owner's stage 2 heading stayed red after S1-Pasers#1's stage 2 finished.
The heading colours the provenance chain, not the run: the set named in
`from stage 1 record set` is held up to the stage 1 boxes above. A set
launched with `only the coins and shapes ticked on Coins` read the Coins
list, not `trade coins` and `chunk shape` (greyed and unread under the
tick), so holding those boxes up to it read as a mismatch whatever was
typed. A defect of 3.129.0. Now the tick is compared as a box of its own,
on against on; with both on, the pairs ticked on Coins now are held up to
the pairs the set recorded (named coin and chunk shape as the screen names
them); the two greyed boxes are left out for such a set. The pairs ticked
now ride on the same answer the headings already read the downloaded coins
off, memoised on the record files.


## M. The held-back window behind a tick; the trade floor reads test trades; confirm shown whole — owner GO NOW! 2026-09-14 (3.131.0)

The owner's reading: the held-back window's numbers were on Boards for anyone
to sort and filter by, which is a look the design says happens once, on
Verify. Three orders, one release.

- **M1 — Boards keeps the held-back columns behind `show the held-back
  window`**, one tick above `Table 3.A`, off on every visit to Boards and not
  remembered. Off: the six held-back columns of `Table 3.A`, the five of
  `Table 3.B` and the six of the records under a row are not drawn; a saved
  sort on one of them is set aside and the line under the tick says so; a
  floor typed in one of their boxes is not applied; and none of those numbers
  leaves the service, so the page cannot draw what it is not sent. On: they
  are drawn, and the tick writes one dated look on the stage 3 record set,
  whichever of the three were open. Verify counts those looks in its own line
  the way it counts a scan on Tune: "Boards showed the held-back columns of
  NAME N time(s), each a counted look". That line replaces Verify's old
  standing caveat that Boards offers a sort and a filter on the held-back
  money, which the tick has made untrue. A tick whose look fails to write
  draws nothing.
- **M2 — the Funnel's trade floor reads test trades.** Step 6's ladder and
  the box `fewest test trades` read the test-window count now, and the
  numbered steps name the box as it is. The ladder's yearly footing was
  already the test window, so the count and its footing now agree; before, a
  held-back count sat on a test-window footing. A rule cut before 3.131.0
  keeps its held-back floor readable, its sentence says "held-back trades at
  least N", and Verify still counts it as a look. Found on the way: a board
  read on all units together takes its rows from the totalled tables, which
  carried the held-back trade count and no test count, so the new floor would
  have dropped every row there; the totalled rows now carry the test-window
  trade count per coin, averaged. History's reserve reading
  is the next tab; Tune is already behind its own tick; Verify reads the
  window by design. None of the three touched.
- **M3 — confirm is shown whole.** `confirm` prints `off` where it was off,
  not a dash. The six numbers a verdict rests on (money and count of the
  confirmed, the unconfirmed and the no-lean trades, the money at size 1, and
  the money under the row's own value of confirm) print under the word on
  `Table 3.A`, `Table 3.B` and the records under a row, not only in a hover.
  `Table 3.B` gains a `confirm` column; the records under a row gain
  `confirm` and `verdict`, and `held-back verdict` behind the tick.
- **M4 — a fault found on the way and fixed here: one coin row per value of
  confirm.** `Table 3.B` keyed a coin row on setting, coin, alongside and
  chunk shape only, so the off record and the sized record of one short
  setting were summed under one row and judged by the first record's
  multipliers; the six numbers under a word could belong to two values of
  confirm at once. The key carries confirm now. The tally version moves, so
  every stage 3 set's tables rebuild once when next opened.
- **M5 — reported by the owner during this build, not touched (RULE ZERO):**
  picking a record set on Boards scrolls the page to the top; and the `Data
  fingerprint` line counts alongside coins as coins. Both are answered in the
  report with the fix each would take.

## N. A one-unit set can be walked from Home; the bar box named for what it is — owner GO NOW! 2026-09-14 (3.131.1)

The owner's Funnel sat at Home with every control dead after the test
history numbers were worked out. Read from the code, not the data: since
3.108.0 the only way to open a walk from Home is `Walk this one` on a row
of the ranking table, and the row for the coin and shape the page held as
current printed `this walk` whether or not a walk was open. A set with one
coin and shape therefore had no `Walk this one` anywhere, the `coin` and
`chunk shape` boxes had nothing else to pick, and the `Stage 4 record set`
box was already on `new rule`. A dead end of the design meeting a one-unit
set. Now a row reads `this walk` only while a walk is actually open on it;
at Home, and with a Stage 4 record set showing, every row offers
`Walk this one`.

The box `how much must hold` is now `order must agree by at least`, and its
hover and help entry say what the number is: the settings put in order by
their money on one part of the test window and again on another, how far
the two orders agree from -1 to 1, what 1.00, 0.00 and below zero mean, and
that a coin and shape clears the bar when its number reaches this on as many
of the four boundaries as `on how many of the four` asks for. Third digit:
a fix and a wording change.

Not touched: the rebuild's progress line and the Boards jump (task #95), and
two older guards that skip since 3.131.0 rewrote their lines.

## O. A pick on Boards holds its box still; the rebuild in parts with an honest count — owner GO NOW! 2026-09-14 (3.132.0)

- **O1 — Boards.** Picking in the `record set` box under `Stage 1`, `Stage 2`
  or `Stage 3`, the put-away press beside it and the delete all redrew the tab
  and restored the tab's remembered place. Wrong twice over: the redraw
  empties the page first, the browser clamps the scroll to the top of that
  short page and the clamp is recorded as the owner's place; and a stage 3
  pick opens all three sections, so everything above the box grows and even
  the right old place no longer sits at it. The pressed control is pegged now
  the way `Table 3.B` pegs its heading row: where the box sits before the
  redraw is where it sits after. The other presses on Boards that restore
  from memory (notes, filters, page turns) are not in this order and are
  untouched.
- **O2 — the rebuild.** `Work out the test history numbers` handed one unit
  to one worker and moved a count of units under the word settings, so the
  owner's one-unit set said nothing for the whole run and kept one core of
  eight busy. Each unit is now cut into parts the way a stage 3 run cuts its
  units, every part its own payload, the count moving as parts land and
  counting settings over every unit; a set of more than one coin and shape
  says "across N coins and shapes" on the line. The cut arithmetic is one
  function, `partSlices`; the stage 3 run keeps its own copy of the same
  arithmetic, untouched by this order. Second digit: new behaviour.

## P. A paused run can be deleted from where it is chosen — owner GO NOW! 2026-09-14 (3.133.0)

The stage 3 section on Sweep already offers a paused run in `from stage 2
record set`, to be started again with `Start stage 3`. There was no way to
delete one there; a paused run could only go through `Delete record set…`
on Boards. `Delete record set…` now sits beside `Start stage 3`, live
exactly while a paused run is chosen in that box, and it deletes that run
through the same two steps as Boards: the service says what would go, the
owner types the record set id back. The boxes then refill off the list the
poll reads and the count line is asked again. Boards, the Funnel's Stage 4
heading and Sweep now delete through ONE flow; the two earlier copies had
already drifted on one detail. Second digit: a new control.

## Q. The step 6 press works out only the coin and shape the walk is on — owner GO NOW! 2026-09-14 (3.134.0)

The owner walked one coin and shape and `Work out the test history numbers`
priced all fifteen, because 3.102.0 made the whole-set prep the only mode.
The 3.102.0 objection was to pricing a rule's survivors, whose slice moved
with every walk; a whole board of one coin and shape is the board the walk
reads, and it has no such problem. Now the press on step 6 (and its copy in
a step 6 refusal) works out the coin and shape the walk is on and nothing
else; the press beside `Worth walking?` works out every coin and shape,
because `Read the ranking` needs all of them. Each copy says which, and
each is dead when its own scope has nothing left.

For that to be safe the shared file changed shape (fourth): a pass over
one coin and shape tops up its own entry under each setting and leaves the
other units' numbers where they were, a setting's averages are worked out
again over every unit the file holds, and the file says how many coins and
shapes the set has. A unit's board reads its own numbers or nothing (it used
to borrow the cross-unit average, so a coin and shape could pass a limit on
the strength of the others); the blend reads the average only once every
unit is in the file. A third-shape file reads as absent and is rebuilt, a
coin and shape at a time as each is walked. The owner allowed the deploy to
kill their running whole-set rebuild; it finished on its own before the
deploy went out, and the third-shape file it wrote reads as absent under this
release, so that whole-set pass bought nothing that survives.

## R. The Setup page can always be reloaded to start the engine — owner GO NOW! 2026-09-14 (3.135.0)

The owner stopped the engine from the `Compute` tab on `Setup` to end a
whole-set rebuild, left the page, and could not reload it: the page had been
served by the engine itself at `…/setup.html`, so with the engine stopped
the reload got nothing back. The small always-up program has served the
same page at `…/svc/setup.html` since 2026-08-25 for exactly this moment,
and nothing on any screen sent the owner there (RULE FIVE: a way back that
only the code knows about is no way back).

Now the page tells its two addresses apart from where it was loaded, asks
each program at its own absolute address whichever it was loaded from (the
`Version` tab and the sweep knobs used to fail from the surviving address,
because they asked the always-up program for the engine's answers), and once
the always-up program has answered it moves the address bar onto that
program's copy of itself — no reload, nothing on screen changes, the next
reload is what changes. The `Setup` link on Construct and Trade and the
stage-engine marker go straight to that address. Second digit: new
behaviour. The one-line alternative — the website's own routing serving
`/uts/setup.html` from the always-up program — lives on the website branch
and is the owner's to order; it would make the moving unnecessary but it is
not this branch's to change.

## S. The press follows what is chosen under coin; the way back survives the engine — owner GO NOW! 2026-09-14 (3.136.0)

Two orders in one sitting. "make the press follow the coin chooser": with a
coin picked under `coin`, the only `Work out the test history numbers` on
the set's home was the one beside `Worth walking?`, and 3.134.0 had made
that copy price every coin and shape whatever the chooser showed. The owner
pressed it and got all fifteen, twice, and killed the engine to stop it.
Now every copy of the press is one press: it prices the board on screen,
the coin and shape chosen under `coin` or every one for `all units
together`, and its line says which. `Read the ranking` needed no change: it
reads what carries the numbers and says how many settings were left out.

"it should not be possible to kill the engine such that we can't turn it
back on": the 3.135.0 answer moved the address bar once the page had loaded,
which is no answer for a fresh tab typed to the usual address. The website's
routing (website branch, deploy-website-reload.sh) now serves `/uts/setup.html`
and the front door `/uts/` from the always-up program on 8095, never from
the engine they start and stop, behind the same site password. The address
move and the `svc/setup.html` links went with it; the page keeps only the
resolver that lets one file ask each program at its own absolute address
from either home. Second digit.

The website deploy also showed the box's live vhost carried
`include /etc/nginx/snippets/acme-challenge.conf;` in both ssl server blocks
(added on the box 2026-09-08) and the branch did not, so the first deploy
dropped them. Put into the branch and deployed again the same minute; the
box is back to what it had plus the two routes, and the branch now matches
the box.

## T. A page older than the box is refused and reloads itself — owner GO NOW! 2026-09-14 (3.137.0)

The owner pressed `Work out the test history numbers` again on 3.136.0 and
got "2,100 of 103,028 settings across 15 coins and shapes". The box was
asked, not the page: a read-only probe (`uts-rebuild-asked.sh`, vps-access)
printed the running rebuild's status — `unit: None`, fifteen coins and
shapes — and its token's stamp, 22:02:28, 88 seconds after the 3.136.0
engine came back at 22:01:04. The 3.136.0 page always names a board. The
press came from a page loaded before the deploy, whose copy beside `Worth
walking?` still sent nothing. Twice before this evening "reload Construct"
was given as advice; advice is not a mechanism.

Now the engine stamps every page it serves with its release (a meta line in
the head, put there by the same door that stamps the script markers), every
ask from Construct and Trade carries the stamp back, an ask stamped with
another release is refused with one answer before any route, and the page
reloads itself on that answer. An ask with no stamp — a script, a probe,
the always-up program's copy of Setup — is never refused. Second digit.

The whole-set rebuild that was running was cut short by the deploy, at the
owner's word ("just deploy over top already").
