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

**A sentence on the screen that is not true**, found while wiring the tick
and left standing (RULE ZERO): the Coins note and the band box's hover say
Sweep trains with this same number. Nothing in `lib/` reads
`coins_sit_out_band` (grep, 2026-09-14). That is the parked dual member
voting mode (E). The owner decides whether the sentence goes or the mode
gets built.
