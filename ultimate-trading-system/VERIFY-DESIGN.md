# Verify, re-pointed at a Stage 4 record set

Design proposal, 2026-09-07. Nothing here is built. Every item waits for its own `GO NOW!`.

How names are written: a label in double quotes is on a screen today, quoted character for character from `SCREEN-WORDS.md`, with the tab named where it is not obvious. A label marked (proposed) is on no screen yet and may not be spoken of as one until it is deployed, fingerprinted and the word list regenerated. Where a name from the code cannot be avoided it is in code font and explained in plain words at that spot.

How this was checked: I read the code, ran five read-only probe scripts against the box (the set listing, its heading, its recorded steps, the record-set inventory, and the rule replayed on its board), and then ran a review pass of 39 independent readers, designers, judges and refuters over the code. Two claims I had made were corrected by that pass and are corrected here.

## Summary

The 199 records on the Funnel tab are one **Stage 4 record set**: a rule, the 199 settings it keeps on one coin and shape, and the record of how the rule was found. The set and its parent already hold almost everything a held-back verdict needs, including 80 scrambled copies of every setting's held-back money that nothing reads today. What is missing is the verdict itself, written under rules declared before the numbers, and an honest count of how often the held-back window was already looked at.

The Verify tab was built for the old sweep. Three of its four panels wait for a chosen row of an old-sweep run that no screen can set any more, so they draw dead. The one that works, the planted check, certifies the old sweep engine, not the three-stage engine that priced these 199 settings.

The proposal: Verify reads a Stage 4 record set as a whole, never one row. On a press it stamps one verdict on the set: the survivors' held-back money against the same settings' held-back money on the 80 scrambled copies, against the four simpler things the Funnel already prints (buying the coin and going away, shorting it and going away, being long every period, being short every period), a sanity line that noise must lose, and the marks the walk carried. It prints what it does not price. Then it says plainly which of History, Tune and Greenlight can take the set next, and which cannot without engine work.

---

## 1. What the 199-record set holds today

Read off the box on 2026-09-07. The set is `s4-mtqq96dh-1`, named "199 setting rule for Funnel - S3 #1b - LTCUSDT alongside XLMUSDT and ATOMUSDT daily-4d".

**Where it came from.** Cut at 04:15 UTC under release 3.80.1 from S3 #1b (launched at 23:06 UTC the day before). The board it was walked on is one coin and shape: LTCUSDT read alongside XLMUSDT and ATOMUSDT on the daily-4d chunk shape. That board holds 2,752 settings. The parent set resolves 300 such boards. Applied to the board today the rule still keeps exactly the same 199 (checked at the cut and again by the probe).

**The rule ("Final Rule:").** tHours (t) 60 to 161; agreePct (share) 10 to 90; agreeCopy 90; agreePersist 0; decision argmax or directional; weekdaysOnly (24/5) false; entry market; gate directional; agreeRule (quorum by) voices; agreeBar (quorum bar) all or own; agreeBoth false; worst losing streak at most 85 dollars; at least 104 trades. No top-N cut; the closing was "accept what the rule gives". The set also carries the rule the owner built before step 5 replaced it ("User Rule:"); the two are printed on the Stage 4 view.

**How it was found.** 14 recorded choices, 5 steps back (2 to 1 four times, 3 to 1 once). Four marks the walk was carried past: the leading dial was not evenly swept; two dials interact (share x quorum by) and the single-dial ranges were kept anyway; "accepted 182 of 299 other units positive; 151 clear the bar"; the region was joined across dials whose values are words. Each recorded step's own survivor count is empty on this set, because the page never sends it.

**The check it was read under.** 80 scrambled copies of the table. "bold when a value beats at least" 85%, which is 68 of the 80; by chance about 16% of values would clear that.

**What each of the 199 rows carries.** On the Stage 4 view: "avg test $" and "avg held-back $"; "worst losing streak $", "biggest single loss $", "best single trade $", "trades won", "stopped out", "gross per trade $" and "money by third" on the test window (the numbers a sweep does not keep, rebuilt at step 6, and kept on the set as its own copy for all 199); "trades", "vs always long $", "beat its own null set", "null copies" and "lead" on the held-back window.

**What each row carries that no screen prints.** For every setting, the money it made in each of the 80 scrambled copies, on the test window and separately on the held-back window. In the code these are `noiseTest` and `noiseHold`, dollars rounded to the cent. The held-back ones are the raw material for a held-back verdict. Nothing in the code reads them for any verdict today; the review pass confirmed there is no reader of `noiseHold` at all.

**What the set carries about its window.** The sealed window is intact on this unit: the final 13% of the coin's history was cut away before anything trained, and the set records where it starts (its end is not recorded, a known gap). The four simpler things a rule has to beat, for this coin at each hold length, sit on the parent set and the Funnel prints them against the survivors.

**What it lacks to move on.**

1. **No verdict.** The heading on the Stage 4 view says the held-back window "is opened once, at the cut, on what survives, and avg held-back $ in the table is that one look". Nothing stamps that look: the field for it (`heldBackReadAt`) is created empty and never written. No reading rule was declared for the 199 held-back figures and no pass or fail is recorded.
2. **An honest count of looks.** The number a held-back verdict reads, the survivors' average held-back money, was printed on the Funnel at every step and every step back of this walk (the line beginning "On the held-back window," that says what the surviving settings made a setting), so at least 20 times before the cut. Boards also offers a sort on "avg held-back $" and a filter on held-back money over the whole stage 3 board. And the rule's floor of at least 104 trades read a held-back trade count, because "trades" on the board is the held-back count. So "opened once, at the cut" is not true of this set, and the record must say what was seen rather than claim a first look. The test that forbids the Funnel from reading held-back money scans only `lib/funnel.js`; the line that prints it lives elsewhere.
3. **The held-back scrambles are unread** (above).
4. **No calibration for the engine that made it.** The planted check on Verify fires the old sweep. The three-stage engine has its own known-answer exam (`tests/adversarial/stages-endtoend.js`), run by hand from a terminal in about a minute, reachable from no screen and recorded nowhere a set can point at.
5. **Two numbers not yet read.** How many scrambled deals "beat its own null set" counts over (the "null copies" figure on one survivor says it; it may be more than the 80 kept), and whether S3 #1b carries the four comparisons for this unit (written at stage 3 launch since 3.70.0; the Funnel heading shows them if so). Both are one read-only look each.
6. **The fee is not where a later reader looks.** Stage sets store the fee as `params.fee`; the helper every downstream reader uses looks for `feePerLeg` and silently falls back to the default when it is absent. Any pricing from this set today would use the wrong fee with no error.
7. **Nothing downstream can read the set.** History, Tune and Greenlight all wait for the old sweep's chosen row (section 6).

---

## 2. The Verify tab today, panel by panel

The tab learns which run to read from a browser memory slot (`cx-run`) that no code writes, and which row from that run's own chosen row, which only an endpoint no screen calls can set. So for everything the engine writes now, three panels are empty.

| Panel heading (as drawn) | Needs | Today | Worth for a Stage 4 set |
|---|---|---|---|
| "Planted check — the instrument's calibration certificate", with "current:", "Run the planted check", "Last gate (", "full gate record" | Nothing selected | Works. Regenerates a fabricated pair and fires the OLD sweep through its null pipeline; PASS belongs to the exact release. | The idea is essential and its per-release record is the pattern for the new verdict. The instrument it certifies is the wrong one for these records. **Keep; add a stage-engine check beside it** (step V0); reword what it certifies (its own decision). |
| "Tool 1 — this row against its null runs", with "scramble run" and "Read Tool 1 verdict" | A chosen row and a run with scrambled draws | Dead: prints "select a row on the Boards section first". | Its two questions are the right ones: the row against its own scrambled worlds, and the best of the board against the best of each scrambled board, with "a floor, never a measure of strength". **Keep the questions, lifted from a row to the rule** (V3, and the optional bound in V6). The panel prints a control that does not exist; retiring it is its own decision. |
| "Rotation rounds — a SEPARATE instrument, retired as evidence" | A chosen row | Dead. | Retired by the register already. **Retire the panel**, after a read-only count of old runs still carrying its rounds. |
| "Tool 2 — the board against its dealt-vote null boards" | An open run | "open a run on Boards first." Dead even with a run: the rows it reads have their scrambled copies dropped on the way in. | Its reading, "how many of its null copies (same setup, votes dealt onto random days) its HELD-BACK money beats", is already on every stage 3 record as "beat its own null set" of "null copies". **Keep as the per-setting drill-down** (V4). |

Worth keeping verbatim in any redesign: "sanity:" with "PASS — noise mostly loses, as fees demand." and "FAIL — NOISE IS PROFITING: the simulation is broken; do not read the tests above.", the sentence "What a pass buys: this window only. It stops obvious chance results being frozen; the forward paper test after freezing is the real judge." and the words "a floor, never a measure of strength". Some strings the tab renders (two sub-headings inside the Tool 1 verdict and its column names) are on no list, because the word collector does not see strings passed as function arguments; they have no name on screen for this document and a new panel must not be built the same way.

The Help tab's text for Verify says "Checks on the machinery itself, not on any particular result" (a quotation of the help file, not a control). A verdict on a Stage 4 set is a particular result, so that text is rewritten, not extended: the tab becomes the machinery check first (V0) and the set's verdict second.

---

## 3. How a Stage 4 set is linked into Verify

**The unit of verification is the set, not a row.** The Funnel writes a rule "because a rule can be checked against scrambled data and a single row cannot". Verifying one of the 199 rows on its own is the shopping the Funnel was built to stop. So Verify reads the whole set; single rows are a drill-down inside it and never pass or fail.

**How the owner picks the set.** A box at the top of Verify, "Stage 4 record set" (proposed on Verify; the same words are the Funnel's box), filled from the existing set list (`/api/funnel/sets`, which exists and no page calls). Every Stage 4 set on the box, newest first, named as on Funnel, each showing its coin and shape, survivors of target, and whether a verdict is stamped. Never typed. It opens on the set the Funnel is showing, remembered the way every page remembers its state.

**Reading versus stamping.** Opening the panel draws the record (V1) and the marks, and nothing held-back. The held-back numbers appear only when the owner presses "Read the rule against nothing on the held-back window" (proposed), and that press is the stamped look. This is what makes looks countable. The press is refused in a sentence while a stage run, totalling or rebuild is going, and when the rule no longer gives back its own survivors.

**Whole set, or a subset.** The set is verified as cut. A narrower set is cut on the Funnel with "new rule" and verified on its own. Verify never edits a rule.

**Single rows as a drill-down.** The 199 are listed under the verdict with their stored held-back figures under the Funnel's column words "beat its own null set", "null copies" and "lead" (proposed on Verify), and "avg held-back $". The table is not sortable by held-back money on Verify: a sort is a look.

**Blend sets.** A set cut on "all units together" (the blended board of 137,760 rows) reads far more rows. The press for it is started and polled, the shape the cut already has, rather than refused; the four comparisons are kept per coin and shape only, so on a blend set V2's comparison line prints the reason it is not known, as the Funnel does.

---

## 4. The verification steps

Every reading rule is written onto the set before its number is computed, and each is tagged DERIVED (follows from the set's own record) or GUESSED (a chosen threshold), the way the planted check already stamps its rules. Money is dollars at the engine's one stake.

### V0. The instrument: a planted check for the engine that priced this set (new, engine work)

- **Question.** Can the three-stage engine, at this release, find a rule that is provably there, profit on it on the held-back window, beat holding, have its scrambled copies destroy it, and stay quiet on a fair coin, through stage 1, stage 2, stage 3 and a declared rule cut into a Stage 4 set?
- **Reads.** Nothing on any real set. Two fabricated coins from the planted check's own generator (one with the plant alive the whole span, one a fair coin with the rule never on), exactly as the hand-run exam builds them; stage 1, stage 2, a small stage 3 block with scrambles kept, then a rule DECLARED in the exam's own parameters before launch, cut on each coin, then steps V2 to V5 below on both sets.
- **Reading rule (declared).** G1: the planted coin's rule makes held-back money. G2: it beats holding the coin. G3: it beats at least the bar's share of its scrambled copies. G4: the fair coin's rule does NOT clear G3. G5: no unit failures and every survivor carries all its copies. All five, or FAIL. The false-fail chance of G4 is printed: with too few copies a fair coin clears a bar by chance too often (9 copies at 85% is one time in five), so the copy count is chosen for a small chance and both are shown.
- **Prices.** Whether the whole path the owner uses can see a real signal and does not invent one.
- **Does not price.** Any real set; the exam's declared rule is not the 199 set's rule, and the sentence says so.
- **Recorded.** A gate record per release in its own directory (not beside the old sweep's records, whose newest-first scan would shadow it). PASS belongs to the exact release. A Stage 4 verdict records which gate stood. Until this exists the verdict prints "no stage-engine check exists on this box" (proposed wording).
- **Cost.** About a minute for the two coins on the hand-run exam; started and polled; refuses while a sweep or stage run is going. Needs the stage 1 launcher to refuse fabricated symbols and the exam's sets to be kept off Boards, neither of which exists today.

### V1. The record's own footing (read, no pricing)

- **Reads.** The set: rule, survivors, check, marks with step and detail, steps, back-steps, closing, "User Rule:" beside "Final Rule:", warnings, the release it was cut under beside the box's release (first digit compared, the way a stage compares a parent), the sealed state on this unit. The parent's board today: does the rule still give back exactly these survivors, and are any gone. The planted check state, with what it certifies.
- **Rule (DERIVED).** Read no money unless the rule reproduces its own survivors today and none are gone. Refuse if the rule's keys are anything other than dials plus the two rebuilt-number limits (worst losing streak, trades); this is what guarantees that a scrambled copy keeps the same survivors, and the review pass found the code does not enforce it, so the verdict must. If the set kept no scrambled copies, say so and skip V3, V5 and V6.
- **Stamped.** A footing block: same, now, had, gone; check kind, copies and bar; sealed; marks count and keys; steps and back-steps; whether the User Rule differs from the Final Rule; the three releases (set, parent, reader) and whether they share a first digit; the planted check state and the sentence "certifies the old sweep pipeline" (proposed) until V0 exists.

### V2. The held-back read, stamped, with its looks counted

- **Question.** On the days nothing in the walk priced, what did the 199 settings make, and how many times had that number already been on a screen?
- **Reads.** "avg held-back $", "trades" and "vs always long $" per survivor, from the full list of survivors joined to the board (never from the screen's page of rows, which clips at 2,000). The four comparisons for this coin at the survivors' own hold lengths, compared at the worst of them, exactly as the Funnel prints them. Steps and back-steps for the look count.
- **Rule (DERIVED from the Funnel's own marks).** The survivors made money on the held-back window and beat buying the coin and going away and shorting it and going away. Being long every period and being short every period are printed as the window's direction and are not gated, because a scrambled copy is paid by the same drift. If the parent kept no comparisons for this unit, the reason is printed and the verdict is INCOMPLETE; it never passes on an unknown.
- **Prices.** Whether the rule's settings carried into days the search never priced on, and whether a simpler thing did better.
- **Does not price.** Chance (V3). And it is not a first look: the stamp says "first stamped look" (proposed) and prints the count of earlier unstamped looks as "at least N" (proposed; steps plus back-steps plus the cut view), that Boards offered a sort and a filter on the column, and that one floor of the rule read the held-back trade count.
- **Stamped.** The numbers, the four comparisons copied onto the set, `heldBackReadAt` on the first stamped press only and never changed, and a look count that rises on every later press.

### V3. The rule on a noise board: the survivors against their own scrambled copies on the held-back window (the verdict)

- **Question.** How good does nothing look, for these 199 settings, on the held-back window?
- **Reads.** Per survivor, the 80 held-back scrambled figures (`noiseHold`, no name on screen: the money the same setting made on the held-back days with its forecasts dealt onto random days). The copy count K is the set's own (80). The bar share is the set's own ("bold when a value beats at least" 85%) unless the owner changes it in a box "bar share %" (proposed); a changed share is stamped.
- **Arithmetic.** For each copy d: the mean over survivors of `noiseHold[d]`. Count the copies the real mean beats by at least a cent (`beats`), the bar (`barOf`), the chance line (`chanceOf`), and the lead (`leadOf`: the real minus the copies' mean, over their sample spread). These four functions exist in `lib/funnel.js`. The loop itself is NEW code: the Funnel's across-units reader is hard-wired to test money and takes no other reader, so a held-back twin of it has to be written and tested, not reused. A survivor with no figure on a copy is counted and printed, never silently dropped; a copy with fewer survivors than the rest is printed as such.
- **Rule (DERIVED from the set's check).** PASS when the real mean beats at least the bar of the copies (68 of 80 on this set) and the real mean is positive. Printed with it every time (proposed wording, ending in the tab's own words): "a forecast-free rule clears this about 16% of the time; the finest claim 80 copies allow is 1 in 81, a floor, never a measure of strength". The lead is printed, never a threshold.
- **Prices.** With the survivors fixed, whether their real-day forecasts carry money that dealing them onto other days destroys, on the held-back window. Because the rule reads no money and carries no cut (checked in V1), every scrambled copy keeps the same 199 settings, so copy d is one dealt world for the whole rule.
- **Does not price.** The choosing of the 199. The walk chose ranges by reading the test window against its scrambles over 14 steps and 5 steps back; the held-back window is out of sample for that apart from the looks counted in V2. Pricing the search itself would need the whole walk replayed on each scrambled test board, which needs the automatic walk (FUNNEL-DESIGN section 15) that is not built. The verdict prints this sentence, not as an option. Also: copy d on the test window and copy d on the held-back window are different shuffles, so the two are never paired on one line.
- **If the set carries a top-N cut** ("take the top N by a column"): the copy must take its own top N by its own scrambled test money before its held-back figures are read (`nullCopy` with a top cut), like against like.
- **Stamped.** real, the 80 copy means (copied onto the set so the verdict survives the parent's deletion), beats, bar, share, chance, lead with its definition named, K, PASS or FAIL.

### V4. Every setting against its own noise (breadth, report only)

- **Reads.** Per survivor: "beat its own null set", "null copies", "lead", the sign of "avg held-back $", and "vs always long $".
- **Arithmetic.** Share of head-to-heads won over all survivors; how many survivors beat at least the bar's share of their own copies, beside how many would by chance; how many are positive; how many beat always-long; the median lead. No pricing.
- **Rule.** Report only. Printed with it every time: the deal count these figures are over (which may exceed the 80 kept) and the kept count, as two numbers; that the stored "beat its own null set" compares raw dollars over all deals while V3 compares cents over the 80 kept, so the two can differ; and that the stored "lead" uses the population spread and reads 0 with no spread, while V3's uses the sample spread. The two are never mixed on one line. Never a pass or fail: the 199 share one coin, one window and the same deals, so they are not 199 independent draws.
- **Also printed.** "money by third" on the test window, already on the set: how many survivors made money in each third, as a consistency line at no cost.
- **Stamped.** The counts and both definitions.

### V5. Sanity: noise must lose

- **Reads.** Every `noiseHold` figure over the whole unit board and over the survivors.
- **Arithmetic.** Share below zero, the rule Verify's sanity line already uses.
- **Rule (GUESSED).** Ok when the board-wide share losing exceeds the box "noise must lose at least %" (proposed), default 50, exposed and stamped. Read beside V2's direction line: on a window that pays one direction the copies are paid too and this can fail honestly, and the sentence says so. FAIL still voids V3, in the tab's existing words.
- **Stamped.** The shares, the threshold, ok.

### V6. Does it hold elsewhere, on the held-back window (pressed, polled)

- **Question.** The same rule on each of the other 299 boards: does it make held-back money, and does it beat those boards' own scrambled copies?
- **Reads.** Each other board, the rule, its survivors' held-back money and held-back scrambles. Step 4 of the Funnel does this on the test window ("read the other units"); this is the same read with the held-back fields, and, like V3, it is new code beside the existing loop.
- **Rule.** Printed as two counts, how many of the 299 are positive and how many clear the bar (proposed wording, matching the mark the walk already records: "accepted 182 of 299 other units positive; 151 clear the bar"), beside the walk's own test-window counts. Informational; a mark when fewer than half are positive.
- **Cost.** About five seconds a board on this box, so about 25 minutes for 299. Started and polled, one at a time, the shape "read the other units" already has.
- **Optional, off by default, owner's call.** Two report-only lines: the same rule read on the test window against its scrambles (frozen, never a gate, because the rule was chosen against those very copies); and a bound on top-N shopping (the best 199 by test money on the real board against the best 199 by scrambled test money on each copy, like against like). Neither is ever a FAIL.

### V7. The ride on the held-back window (optional, prices)

- **Question.** What did the held-back window look like from inside: worst losing streak, biggest single loss, trades won, stopped out, gross per trade, money by third?
- **Reads.** These are worked out by the same press that fills "work out the missing numbers", which already computes them for the held-back window and throws that half away (only the test half is kept).
- **Change.** Keep the held-back half beside the test half on the set's own copy, for this set's survivors on this unit only, and stamp the release that computed them (the set's copy has no release stamp today, though FUNNEL-DESIGN section 7 asks for one).
- **Cost.** The step 6 press restricted to one unit: 199 settings, minutes.

### The verdict

One sentence assembled from the stored numbers only, no free text: which gate stood (V0), the held-back read with its looks and comparisons (V2), beats N of 80 with the bar, the chance and the floor (V3), the breadth counts (V4), sanity (V5), and, when read, the other boards (V6). PASS means V1 stood, V2 passed on both comparisons, V3 passed, V5 passed. "What a pass buys: this window only." The marks the walk carried are printed under it, every time. Each press appends a new block; nothing is overwritten; the first stamped block is the verdict and later ones are printed as look 2, look 3 (proposed wording) and never replace it.

---

## 5. What is written back onto the Stage 4 record

A `verify` list on the set, one block per press, newest first. Each block: id, time, the reader's release, the look number, the rules as declared (bar share and bar, sanity share, the two comparisons gated, tagged DERIVED or GUESSED), footing (V1), looks (V2), the held-back read and the four comparisons (V2), the copies read (V3), breadth (V4), sanity (V5), other boards (V6) when read, the fee copied as `feePerLeg` with `feeUnits: 'fraction'` so the helper every downstream reader uses finds it, the windows (held-back, and the sealed reserve's start and chunk count), and PASS or FAIL. `heldBackReadAt` is written on the first stamped press, never changed. The set list gains a one-line summary per set from the first block.

**Sets already on disk (RULE NINE).** There is one. A missing `verify` list and an empty one mean the same to every reader, so no special code for old records is needed and none is written. The only real question is `heldBackReadAt` on the one existing set: leave it empty until the first stamped press and print "unstamped looks: at least 20" (proposed wording; recommended, because the column was on screen at every step and the cut), or stamp the cut's date by a one-off pass. FUNNEL-DESIGN section 7 promised the cut was the first read; the code shows it was not. That is the owner's call, and delete-and-recut is the other option.

---

## 6. What this hands to History, Tune and Greenlight

**Handed down**, keyed by set id and block id: the rule and its sentence and the User Rule; the survivors with their dial rows; the held-back read with its copies and bar; the four comparisons; sanity; the marks; the look count; the fee; the windows; the releases. Nothing downstream needs the old sweep's chosen row again. A later door refuses in words without a block whose verdict is PASS on the same release line.

The Funnel heading already says "Verify, History, Tune and Greenlight are where a survivor is graded, and they start from what is on this screen". Today none of the three can. Plainly:

**Greenlight.** "GREENLIGHT this config" builds its frozen configuration from the old sweep's chosen row and demands a unit of three coins and an integer agreement count. This unit is three coins, market entry, directional gate, no trailing stop or arm, so it is the live executor's shape in every respect but one: the 199 settings agree by rule (quorum by voices, share 10 to 90, quorum bar all or own), which no integer expresses. Needed: a Stage 4 source for the door (set id, block id, and one survivor label, the only place one survivor is ever chosen), the agreement setting carried in the configuration, and the live signal path speaking the stage engine's agreement (`lib/agreement.js`) instead of counting votes. **How one of 199 is chosen without shopping**: by depth inside the rule, the setting nearest the middle of every range, never by money (the same idea as "widest region" on the "anchor" box, chosen by how surrounded it is), or the owner's named pick recorded as a pick with a mark. Both are recorded on the greenlight. Engine work, second digit, and real money stays the owner's switch (RULE SIX). On the Trade tab both "Paper Books" and "Live Trading" show the same new fields (RULE TWO).

**Tune.** "Protective stop tuner — full-history, loses no winner" and "Run conviction sweep (full history)" take a book with a training cutoff and an integer agreement count, built from a saved sweep run. A market-entry survivor is the shape they accept, but they need the same agreement vocabulary as Greenlight and per-trade detail the set does not hold. FUNNEL-DESIGN section 8 names the route: per-trade capture is a Stage 4 job, the same rebuild as "work out the missing numbers" one level deeper, affordable for 199 settings. "Compare two runs — NOT a null test" keeps reading old runs; a Stage 4 compare (pairs of survivors differing in exactly one dial) is a different, cheap tool inside the block, for later.

**History.** "Launch History Tuning on this row" and "Launch paired age-dial run" retrain forecasts through the old engine and need a finished old-sweep run. They cannot run on a stage setting as it was measured. A stage-engine age dial would be a new instrument; retire them for stage sets or rebuild, owner's decision.

**The one-touch reserve grade.** "Run the reserve grade" grades an old-engine History Tuning winner on the sealed window. For a Stage 4 set the ingredients exist: the fitted forecasts are stored per unit, the sealed chunks are rebuildable from the set's parameters, the survivors' settings and the four comparisons can be priced on them with the stage 3 pricing path, and a new dealt slice for the sealed window gives it scrambled copies. What does not exist: forecasts on the sealed chunks (they were cut away before anything trained, so predicting on them is new pricing) and the launcher. It refuses unless a verdict block is PASS and the sealed window is intact, counts its looks the way the existing grade does, and belongs on History beside the existing button. Minutes to run, second digit, owner decision.

Order, if all of it is wanted: Verify first (nothing downstream exists without the block), then the reserve grade, then the Greenlight vocabulary, then the live path. Tune is optional.

---

## 7. Build order, digits, tests, cost

**Before any build, two read-only looks at the box** (no code): "null copies" and the kept count on one survivor row of S3 #1b; whether S3 #1b carries the four comparisons for this unit.

**The Verify batch, one commit, release 3.81.0 to 3.82.0** (second digit: new behaviour, new controls, new fields; no record on disk stops being readable; no first-digit move, which would refuse every chain on the box).

| Item | Files |
|---|---|
| Pure arithmetic for V3, V4, V5 and the verdict sentences; reuses `beats`, `barOf`, `chanceOf`, `leadOf`; no reading of files | new `lib/funnelverify.js` |
| The stamping read: loads the set and parent, reads every survivor (never the 2,000-row page), refuses on busy, on non-replay, on a rule with non-dial keys; appends the block; writes `heldBackReadAt` once. A dry read that writes nothing (the existing set reader stamps two fields on first open; the dry read must bypass those or say they are present). New sets get `verify: []`. | `lib/stages.js` beside the Stage 4 rows reader; `lib/funnelset.js` |
| One GET (dry read) and one POST (compute and stamp, started and polled) under `/api/funnel/set/:id/`; the set list gains the summary | `server.js` beside the Funnel routes |
| Verify: the new panel drawn by top-level helpers called from the tab's renderer (so their words reach the word list through the helper walk), the set box, the two share boxes, the press, the survivors table without a held-back sort. Rows use the page's `.row` and `<label class="f">` pattern (RULE FOUR). | `public/construct.js` |
| Help: the Verify intro rewritten; one entry per new control; no file names, no dates | `public/help-content.js` |
| `package.json` 3.82.0 in the same commit | `package.json` |

**Tests to add** in `tests/test-funnelverify.js`, appended to the hardcoded list in `tests/run.js` or it never runs. Each name is the assertion a mutation guard aims at (RULE EIGHT): `theRulesBlockIsWrittenBeforeTheNumbers`; `theOwnCopiesReadMatchesTheAcrossReadOnAFixtureBoard`; `theBarIsTheSetsOwnUnlessChangedAndTheChangeIsStamped`; `verifyRefusesWhenTheRuleNoLongerReplays`; `verifyRefusesARuleWhoseKeysAreNotDialsOrTheTwoLimits`; `verifyRefusesWhileAStageRuns`; `theSurvivorsAreReadInFullNeverAPage`; `heldBackReadAtIsWrittenOnceAndNeverChanged`; `everyPressAppendsABlockAndOverwritesNone`; `theVerdictCannotPassOnUnknownComparisons`; `theDealCountAndTheKeptCountArePrintedOnEveryVerdict`; `theTwoLeadDefinitionsAreNamedNeverMixed`; `aSurvivorWithNoFigureOnACopyIsCountedNotDropped`; `theFeeRidesOnTheBlock`; `drawVerifyPicksTheSetFromTheServersListNeverTyped` (source scan); `theSurvivorsTableOnVerifyHasNoHeldBackSort` (source scan); `noVerdictSentenceNamesASourceFile`. Ladder: `node --check`, the one test, the one file, `npm test`, then the mutation harness filtered to `funnelverify`.

**After deploy:** `vps-access/scripts/uts-served-fingerprint.sh`, then `node tests/sweep-words.js --write`, commit `SCREEN-WORDS.md`. Only then may a proposed label be named as on screen. The new release makes the planted check read NOT CHECKED; the owner presses "Run the planted check".

**Cost.** V1 to V5: arithmetic over 199 x 80 and 2,752 x 80 figures, under a second, no pricing on the box; a blend set is minutes, polled. Build: one session for the batch above. Nothing can be pressed while S3 #1c runs; the panel says what is running.

**Separate tasks, each its own `GO NOW!`:**

1. Retire the three dead panels and the sentences that name a control that does not exist. Re-aim in the same commit the tests that pin them (`tests/test-uicontracts.js`, `tests/test-verifytune.js`, `tests/test-verdictctx.js`) and remove their help entries. Keep the old runs' verdict-sources endpoint: Tune's "run A" and "run B" pickers read it. Count old runs still carrying rotation rounds first.
2. Reword the planted check panel and its help entry to say which engine it certifies (third digit).
3. V0, the stage-engine check as a button with its own gate records (second digit; engine work; the owner presses it).
4. V6 and V7 (second digit each).
5. The Funnel page sending each step's survivor count, so the recorded steps stop carrying empty counts (third digit).
6. The downstream doors in section 6, each its own decision.

---

## 8. Decisions taken (owner, 2026-09-07, one question at a time)

Each item below is the owner's answer, recorded as given, with the one line that says what it changes in the sections above. Where the answer differs from what section 4 or 7 proposed, this section wins.

1. **The unit of verification: the set, AND each survivor too.** The set verdict (V3) is the gate. Each of the 199 also gets its own pass or fail against its own scrambled copies at the same bar, printed beside how many would pass by chance, because the 199 share one coin, one window and the same deals and are not independent draws. *Changes V4 from report-only to a per-survivor verdict, never a gate on the set.* A survivor's own verdict never picks it at Greenlight; the pick stays by depth or by a named pick (section 6).
2. **The look count on the existing set: leave the stamp empty, print the count.** `heldBackReadAt` stays empty until the first press on Verify. The verdict prints "unstamped looks: at least 20" (proposed wording) and names what looked: every step and step back, the sort and filter on Boards, the trades floor. *Confirms section 5 as written; no one-off pass.*
3. **The held-back line during the walk: keep it.** The line beginning "On the held-back window," stays on the Funnel at every step; every verdict counts each draw of it as a look. *Confirms V2 as written.*
4. **The bar for the verdict: the set's own 85%, changeable and stamped.** Verify opens on the share the set was cut under, in the box "bar share %" (proposed); a change is written onto the verdict. *Confirms V3 as written.*
5. **The sanity share: 50%, GUESSED, changeable and stamped.** In the box "noise must lose at least %" (proposed). *Confirms V5 as written.*
6. **The two extra lines: built and always printed, information only.** Line A, the rule read on the test window against its own scrambled copies, which always looks good because the rule was chosen against them; line B, the bound on top-N shopping. Both printed on every verdict, each marked as information only, never a pass or fail. *Moves both lines out of V6 and into the Verify batch: neither needs the other boards, both read the set's own board.*
7. **Blend sets: refused, in words.** A set cut on "all units together" is refused on Verify with the reason and what to do instead: cut the rule on one coin and shape and verify that. *Replaces the started-and-polled path in section 3.*
8. **The dead panels: retired in the same batch as the new verdict.** "Tool 1 — this row against its null runs", "Rotation rounds — a SEPARATE instrument, retired as evidence" and "Tool 2 — the board against its dealt-vote null boards" go in the Verify batch, with the tests that pin them re-aimed in the same commit, their help entries removed, and a read-only count of old runs still carrying rotation rounds taken first. The old runs' verdict-sources endpoint stays: Tune's "run A" and "run B" pickers read it. *Folds separate task 1 into the batch.*
9. **V0, the stage-engine check: wanted, its own task after the batch.** A button on Verify beside "Run the planted check", its own per-release gate record in its own directory, started and polled, refusing while a sweep or stage run is going. The copy count is chosen so the printed wrong-fail chance is under 5%, and the exam prints that chance beside its verdict. *Confirms V0 and separate task 3.*
10. **Downstream: all four wanted, in this order, each its own task.** (a) The reserve grade on History for a Stage 4 set. (b) Greenlight speaking the rule's agreement, with one survivor chosen by depth or by a named pick, both recorded. (c) The live path speaking the same agreement: built and tested inside a loop, switched on only by the owner, never inside any loop (RULE SIX). (d) Tune's per-trade capture. And **History Tuning with the age dial: rebuilt for the three-stage engine** as a new instrument with its own pair of calibration exams, its own design document first, after (a) to (d). *Confirms section 6's order; the age dial is not retired.*
11. **Release: 3.82.0** for the Verify batch, second digit. Nothing on disk stops being readable; the first digit does not move.
12. **The unread 13% has a start and no end** (owner, 2026-09-07: "future runs that look at the last /13 should use all available data -- so if more data has become available it must be automatically included in the final /13 sealed chunk"). Every stage stores the actual date ranges it used (3.85.0): training, test, held-back, and the unread window's start. Anything that reads the unread window reads from that start to the newest candle the box holds on the day, never to a fixed end and never pinned: the pin covers what a chain was launched on, and the unread window is everything after it. *Binds V5 and the reserve grade of item 10(a).*
13. **Release for the Verify batch: renumbered**, because 3.82.0 to 3.85.0 shipped first (the pause and start-again, the pin, the date ranges). The batch takes the next second-digit release when it is built.

**What the batch now holds** (section 7 table, amended by the above): V1 to V5 with V4 as per-survivor verdicts; the two lines from item 6; blend refusal; the three dead panels retired with their tests re-aimed and help removed; the set box, the two share boxes, the press, the survivors table without a held-back sort; Help rewritten; 3.82.0 in the same commit. Then, each its own task, in order: V0; V6 and V7; the Funnel page sending each step's survivor count; the reserve grade; the Greenlight agreement; the live path; Tune's per-trade capture; the age dial's design document.

**Before any build**, unchanged: the two read-only looks at the box named at the top of section 7.

---

Nothing here is built. Every item waits for `GO NOW!` for that batch — or `LOOP NOW!` to process the entire document without interruption. A loop over this document starts only once section 8 is answered, because a loop may not decide for the owner; and what RULE SIX always stops still stops, so nothing that arms real money (section 6, the live path) is switched on inside it.
