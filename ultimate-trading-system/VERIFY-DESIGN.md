# Verify: what was built, and what is still to come

**Restructured 2026-09-12** (owner `GO NOW!`), when the tabs were put in the
order the work is actually done in — `Data · Coins · Sweep · Boards · Funnel ·
History · Tune · Verify · Greenlight · Help`. This is now the one document for
the **Verify** tab, in two halves.

**PART ONE — WHAT WAS BUILT** is sections 1 to 9 below. It was written as a
proposal on 2026-09-07 and then built: 3.86.0 through 3.92.0 under the owner's
`LOOP NOW!` of that night, plus 3.86.1, 3.89.1 and 3.92.1. **It is written in
the future tense throughout because it was written before the work, so read it
as the record of what shipped, not as a plan for what might.** Section 9 is the
step-by-step record, and where the built thing differs from the proposal it
says so there.

**PART TWO — WHAT IS STILL TO COME** is Parts 1, 2, 5, 6, 7 and 8, moved here
whole from `SELECTION-DESIGN.md` on the same day. **Their numbers did not
change**, so every pointer to "Part N" in the code, the tests and the other
documents still means the same part; only the file moved. Parts 2 and 7 are
marked BUILT in their own headings. Parts 1, 5, 6 and 8 are not built.

**Two things are deliberately NOT repeated here**, because one copy of each is
the only way they stay true:

- **THE HISTORY BUDGET RULE**, in `SELECTION-DESIGN.md`. It governs every part
  in both documents — which stretch of history may be spent on what, and how
  often. Read it before any part below.
- **The vocabulary table**, also in `SELECTION-DESIGN.md` under "Read the words
  first". Every word used here is on it.

**Parts 3 and 4 stayed in `SELECTION-DESIGN.md`**, because they belong to
**Boards** and the **Funnel** — the screens where choosing happens — not here.

How names are written: a label in double quotes is on a screen today, quoted character for character from `SCREEN-WORDS.md`, with the tab named where it is not obvious. A label marked (proposed) is on no screen yet and may not be spoken of as one until it is deployed, fingerprinted and the word list regenerated. Where a name from the code cannot be avoided it is in code font and explained in plain words at that spot.

How this was checked: I read the code, ran five read-only probe scripts against the box (the set listing, its heading, its recorded steps, the record-set inventory, and the rule replayed on its board), and then ran a review pass of 39 independent readers, designers, judges and refuters over the code. Two claims I had made were corrected by that pass and are corrected here.

---

# PART ONE — WHAT WAS BUILT (3.86.0 to 3.92.0)

*Written 2026-09-07 as a proposal, in the future tense, and built that night
and the following days. Section 9 records each step as it landed.*

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
- **Reads.** Each other board, the rule, its survivors' held-back money and held-back scrambles. Step 4 of the Funnel does this on the test window ("Read the other units"); this is the same read with the held-back fields, and, like V3, it is new code beside the existing loop.
- **Rule.** Printed as two counts, how many of the 299 are positive and how many clear the bar (proposed wording, matching the mark the walk already records: "accepted 182 of 299 other units positive; 151 clear the bar"), beside the walk's own test-window counts. Informational; a mark when fewer than half are positive.
- **Cost.** About five seconds a board on this box, so about 25 minutes for 299. Started and polled, one at a time, the shape "Read the other units" already has.
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

## 9. Loop record (owner `LOOP NOW!`, 2026-09-07 23:20 UTC)

The owner's words: "start with writing any date ranges that are missing from record sets ... then go with (b) the batch and the follow-on tasks. DO IT ALL. LOOP NOW!" Scope: step 0 below, then the Verify batch (3.86.0), then, each its own release, V0; V6 and V7; the Funnel page sending each step's survivor count; the reserve grade; the Greenlight agreement; the live path built and never switched on; Tune's per-trade capture; the age dial's design document. Every rule below is written before its number exists. Decisions taken inside the loop are one line each, here. Anything RULE SIX stops, stops.

### Step 0 — the date ranges the finished sets lacked (done 23:34 UTC)

- **Rule, written first.** Every finished set on the box reads as many units with date ranges as it has units; the unread window the fill works out today starts where the run's own sealed window started, chunk for chunk, on every record (equal on all of them proves the fill and the pinned files at once); every set's pinned files intact; record counts unchanged; the count of sets still lacking ranges reads 0.
- **Outcome.** S1 #1 600 of 600, S2 #1 600 of 600, S3 #1a 600 of 600, S3 #1b 300 of 300: 2,100 of 2,100 unread windows equal to the run's seal, 0 different; pinned files intact on all five sets (2,662 or 170 files each); 0 sets left. S3 #1c (paused) has none and gets them on its start-again, one setting per done unit; it was never the fill's to touch. Done through the set route, the same read a screen makes (`vps-access/scripts/uts-windows-fill.sh`); checked by `uts-windows-check.sh`. Both read-only for the session; the box's own fill wrote the records, beside and swapped.
- **Instrument hunted.** The fill chunked from the set's own pin without first asking whether the pin was intact; had a pinned file changed, the ranges written would have been today's, not the run's. Caught after the fact by the equality above (2,100 of 2,100), so nothing was written wrong. Moot now: the block has served every set on the box, measured, and goes in 3.85.1 (RULE TEN).
- **Decision (loop).** 3.85.1 deletes the fill whole: the block, the worker task, the route's fill field, the screen's fill wording, the test and its helpers. The start-again's own recovery of a unit's ranges (one setting priced again) stays: it is the start-again's logic, S3 #1c still needs it, and it is covered by its own rehearsal. Parked for the owner: once S3 #1c has been started again, that branch and the `pausedBy` line are spent too, and go together.

### Step 0a — 3.85.1 deployed (23:41 UTC)

- **Fault, mine.** The deploy chain was written as three calls in a row, and the first (the busy check) came back as a proxy error instead of an answer; the chain went on and deployed anyway. Nothing was running (S3 #1c was paused, and still is, at 117 of 3,360 parts), so nothing was interrupted; but the rule "deploys inside the loop wait for the box to be free" was not enforced by anything. From here every deploy is two separate calls, and the second is made only on the words `busy: none`.
- **Outcome.** The box serves e6395c7 (3.85.1); word lists regenerated from it.

### Step 1 — the Verify batch, 3.86.0 (rules written before any number)

- **The reading rules, as they will be coded.** Bar: the set's own share of its copies (`check.barPct`, 85 on the owner's set), resolved to a count the way the Funnel resolves it (68 of 80), DERIVED; a share typed into "bar share %" (proposed) replaces it and is tagged GUESSED on the block. Sanity: the share of every held-back scrambled figure over the whole unit board that is below zero must EXCEED "noise must lose at least %" (proposed), default 50, GUESSED. Comparisons gated: buying the coin and going away and shorting it and going away, at the worst of the hold lengths the survivors use, DERIVED from the walk's own marks; unknown never passes. The set verdict: the survivors' mean held-back money is positive and beats at least the bar of the copies' means, by at least a cent. Each survivor: its own held-back money positive and beating at least the same bar of its own copies, printed beside the count chance would pass, never a gate. Footing: the rule replays its own survivors today with none gone, and its keys are dials plus the two rebuilt-number limits (`maxDrawdown`, `avgTrades`); otherwise the press is refused. PASS on the set means footing, comparisons, copies and sanity all stood. A set without scrambled copies stamps an INCOMPLETE block that says so.
- **Expected outcome: none recorded.** The owner presses the read; the number is whatever the arithmetic returns. Nothing here predicts it.
- **Outcome of the build (2026-09-08).** lib/funnelverify.js (pure), the read and the press in lib/stages.js, three routes, the Verify screen rewritten (the three dead panels gone), the help rewritten; 23 tests in tests/test-funnelverify.js, three test files re-aimed, one select-contract list taught the new box; the whole suite green (1,043 checks); five mutation guards, every one caught. An independent review of the arithmetic, the field shapes and the screen was run over the committed code and found five things, none in the tests' path: a blank "bar share %" box became a bar of one copy (a real gate defect); the footing replayed on the parent's shared file rather than the set's own copy (a false refusal); a set without copies was told noise was profiting; new sets lacked the empty verify list the design names; negative money in the sentence printed "$-2.00". All five fixed in 3.86.1 before anything reached the box, each with its own test. **Deployed** 2026-09-08 00:21 UTC: the box serves 8e26910 (3.86.1); word lists regenerated from it, so the verdict panel's words are on the Verify list from here. The owner presses the read; nothing in the loop presses it on the owner's set.
- **Read-only look before the build (decision 8).** Runs on the box: 18, all planted-check runs, 0 carrying rotation rounds. Retiring that panel loses nothing on this box.
- **Decisions (loop).** The dry read loads the board (it must, to say whether the rule replays) and hands back no held-back figure; the press is the stamped look. The old runs' null-verdict route stays served (Tune's pickers and three unit tests read that library); only the screen's call goes. The planted check panel keeps its words; the footing block prints "certifies the old sweep pipeline" beside its state. Copy means and per-survivor readings ride on the block so a verdict survives its parent's deletion.

### Step 2 — V0, the stage-engine check, 3.87.0 (rules written before any number)

- **The exam, declared.** Two fabricated coins from the planted check's own generator: one with the plant alive the whole span, one a fair coin with the rule never on. Stage 1, stage 2, a small stage 3 with a null set of 20 and all 20 copies kept, then one rule DECLARED in the exam's own parameters before anything is launched (the two `active`-gate settings of the block, no cut) cut into a Stage 4 set on each coin, then the verdict's own readings (V2 to V5) on both sets.
- **Gates.** G1: the planted coin's rule makes held-back money. G2: it beats buying the coin and going away. G3: it beats at least the bar of its scrambled copies. G4: the fair coin's rule does NOT clear G3. G5: no unit failed and every survivor carries every copy. All five, or FAIL.
- **The wrong-fail chance of G4, worked out first.** A fair coin clears a bar of `bar` of K copies by chance about (K + 1 − bar) / (K + 1) of the time: at 85% of 80 copies that is 16%, and no copy count brings an 85% bar under 5%. So the exam declares its bar as ALL of 20 copies, which a fair coin clears about 1 in 21 times (4.8%), and prints that chance beside its verdict. Decision (loop): the exam's bar is its own and is printed as such; it is not the owner's 85%.
- **Where it lives.** Its own record per run in `data/stage-gate/`, keyed to the release that earned it; PASS belongs to the exact release; a Stage 4 verdict records which stage gate stood beside the planted check. Started and polled; refuses while a sweep, a stage run, a totalling or a rebuild is going. The exam's sets carry `exam: true` and are kept off every set list a screen draws from; stage 1 refuses a fabricated symbol unless the exam itself is launching it (the old launcher's own rule, mirrored).
- **Expected outcome: none recorded** for the owner's box beyond what the hand-run exam already proves on this branch (the planted coin outranks the fair coin). Second digit.
- **First real run (00:27 UTC, 4 s): FAIL on G1 to G3 — the exam grading its own declaration.** The declared rule kept hold lengths of 41 to 89 hours; the plant is next-day-follows-today, and on the daily-1d shape the chunk's own hold is 17 hours (entry at hour 25, exit at 42), so every survivor rode into days the forecast never spoke of and lost $15.64 a setting. G4 and G5 stood. Corrected BEFORE any number of it is trusted: the rule keeps the 17-hour hold across both decisions (the block permutes the decision as well, so the rule keeps two survivors). Instrument hunted: the record now carries each survivor's own held-back money, so a FAIL names the setting.
- **Second real run (00:30 UTC, 4 s): FAIL on G1 to G3 again, and this time it is the engine.** The planted coin's two survivors made −$16.57 and −$20.89 on the held-back window (44 and 48 trades) and beat 17 and 16 of their 20 copies; G4 and G5 stood. Bisected the same evening, every step through the engine's own code: (1) the fabricated coin does carry the plant — a trader that goes long when yesterday's close beat its open and short otherwise, entered at hour 25 and out at hour 42, makes +$230 over the year on a $100 stake after fees, +$48 on the exam's test window and +$43 on its held-back window, right 74% and 77% of the time; (2) the engine's own chunks, labels and simulator agree with that trader to the cent (+$48.48 on the test window handed the same calls), so the chunks, the hours and the money arithmetic are right; (3) stage 1's four members, trained the engine's way, forecast weakly — their probabilities sit near 0.36/0.34/0.30 — and only the `prices` view is right more often than chance (24 of 35 labelled test chunks, +$35.51); the `full` and `volume` views are right 13 of 35 and lose $44.66 and $36.54; together the four make +$25.07 on the test window where following the label makes +$83.79; stage 1 still ranks the coin 9 of 9 against its null set, because a dealt-day score is a low bar; (4) stage 2 adds four boost members and the forecast score falls (16.44 to 16.10); (5) stage 3's committee, under every agreement rule tried (count at 25, 50 and 100%, voices, trained, families; market and breakout entries; each decision alone), loses on the test window (−$35 at count 50%) and on the held-back window (−$17), except all-eight-agree, which trades seven times for +$3.57. **The three-stage engine, as it stands, cannot turn a planted 70% next-day rule into money at stage 3.** That is what V0 exists to say, and it says it; it is not the loop's to fix (RULE SIX: discovered work is written down and parked). Parked for the owner, with this diagnosis: the members are weak on a plant a one-line trader reads; the committee dilutes what little they carry.
- **Read-only diagnosis, later the same night (2026-09-08 ~02:30 UTC), on FOUR years of the same made-up history instead of one (2021-01 to 2024-12: 888 training days, 191 test, 191 held-back), through the same launches the check makes and changing no product file.** Stage 1's forecasts find the plant: on the days they name a direction, the readings of prices alone are right 67% (test) and 73% (held-back), prices with volume 69% and 69%, prices and volume together 67% and 56%, and volume alone 51% and 40% — chance, as it should be, because no rule was planted in volume. The one-line rule (the sign of the chunk's own total return) is right 69% on the same days, and that number is the feature most tied to the label (0.38). So "two forecasts worse than chance" was the noise of a 35-day test window, not a defect. Then stage 2, stage 3 and the verdict on the same four years: **the planted coin's rule made +$105.20 a setting on the held-back window, beat buying the coin and going away and shorting it and going away, beat 20 of 20 scrambled copies, sanity 80% losing (PASS); the fair coin's rule lost $26.74, beat 10 of 20, sanity 49% (FAIL).** That is G1 to G4 as the check wants them. **The engine is not broken; the check starved it**: one year of daily chunks gives about 220 training days and a 35-day test window, and the members cannot fit a 70% rule on that. What is parked for the owner: the check's declared span (`SPAN` in `lib/stagegate.js`, 2024 only) should be four years, which makes the check take longer (minutes, not seconds) and is a change to shipped code. Stage 1's own ranking still cannot tell the plant from the fair coin (both beat 9 of 9 on the long span; a dealt-day score is a low bar) — the older finding stands.
- **Decision (loop).** V0 ships with the honest FAIL. The record carries stage 1's own reading of both coins and the label-following trader's money on the same windows, so the gap is on the screen and not only in this file. Everything downstream in the loop is built as ordered, and every verdict it stamps will print "no stage-engine check stood" until the engine passes its own check.

- **Shipped** fca12d3 (2026-09-08 00:45 UTC) on both branches; the three guards caught. **Deploy parked, not the loop's to fix.** The runner the box is reached through sits behind a certificate that expired at 00:35 UTC that day, fourteen minutes before the deploy; it is renewed by hand every ninety days (the deploy notes' quarterly chore) and that is outside the loop's channels (RULE SIX). The box serves 8e26910 (3.86.1) until it is renewed, and every release the loop builds queues behind it. Nothing on the box was touched.

### Step 3 — V6 and V7, 3.88.0 (rules written before any number)

- **V6, the reading rules, as they will be coded.** The set's own rule, exactly as the footing replays it, applied to each OTHER unit's board of the same stage 3 set, with the parent's rebuilt numbers laid on per unit as the Funnel's read of the other units does, on the held-back window: a unit's figure is the mean held-back money of the settings the rule keeps there; positive when above zero; clears when that figure beats at least the bar of the same settings' mean held-back money on each of the unit's scrambled copies, by at least a cent, the bar being the verdict's own declared bar (the set's share, or the typed share, tagged the same way) resolved against that unit's copy count; a unit where the rule keeps no setting, or where what it keeps carries no held-back figure, is counted "keeps nothing" and is not in the denominator; a rule with a top-N cut lets each copy take its own top N on that unit, as the verdict does. Printed as two counts beside the walk's own test-window mark: "N of M other units positive; K clear the bar". A mark, never a gate, when fewer than half of M are positive. Read one unit at a time, started and polled; every press appends a reading and none is overwritten; a verdict block stamped after a reading carries the newest reading's counts and its sentence says them. It refuses while a sweep, a stage run, a totalling, a rebuild, the Funnel's own read of the other units or another Verify press is going, and those refuse while it runs.
- **V7, the ride, as it will be coded.** The same pass that works out the missing numbers, restricted to this set's survivors on this set's unit only, keeping the held-back half the worker already computes beside the test half: the largest drawdown, the worst and best single trade, trades won, stopped out, gross per trade and money by third, per survivor, with the release that computed them and the time. Written onto the set as its own record — never into the set's existing copy of the test numbers, whose shape every set on the box is read by, and never into the parent's shared file, where a one-unit rebuild would replace the other units' numbers. Every press appends and none is overwritten. It is a look at the held-back window and is counted as one on every verdict stamped after it. Never a gate.
- **Expected outcome: none recorded.** The owner presses both; the numbers are whatever the arithmetic returns.
- **Release.** 3.88.0, second digit: new behaviour and two new controls; nothing on disk stops being readable.
- **Found on the way, parked (RULE SIX).** The design says the two held-back counts print "beside the walk's own test-window counts". They cannot: the Funnel's read of the other units lives in the page's own memory of the walk and is not carried onto the Stage 4 set at the cut — the Funnel's line "records 'accepted N of M other units positive; K clear the bar' as a mark on the set" names a mark no cut writes (no mark text in `lib/funnelset.js` carries those counts, and the cut reads nothing called across out of the walk's state). So the panel prints the held-back counts alone, and says so in the record. Carrying the accepted test-window reading onto the set at the cut is a change to the Funnel's cut and waits for the owner.
- **Found on the way, parked (RULE SIX).** A stage launch does not refuse while the missing numbers are being worked out: `claimOrRefuse` in `lib/stages.js` asks about the exam, a sweep, a stage run and a totalling, and not about a rebuild, while the comment above `stageBusy` says every launch is covered. The rebuild refuses when a stage is going, so the gap is one-way — a stage can start under a rebuild (and now under a ride) and fight it for the workers. The fix is one line in `claimOrRefuse` (refuse on `richBusy()`); it touches the launches, so it waits for the owner.

- **Outcome of the build (2026-09-08 01:05 UTC).** lib/funnelverify.js gained the two pure readings and the taking of the ride; lib/stages.js the two presses, started and polled, with the mutual refusals; four routes; two panels under the blocks on Verify and the other-units line on every block; help. Six tests, one scan re-aimed; the whole suite green (1,064 checks); five guards, every one caught. Committed fddd2a7 on both branches. **Deploy parked** behind the certificate (step 2).

### Step 4 — the Funnel page sends each step's survivor count, 3.88.1 (rules written before any number)

- **What is sent, as it will be coded.** Every step the walk records already has a place for the count (`recordStep` keeps `survivors`, and the reserve grade counts what was written down); the page never filled it, so every recorded step on the owner's set carries an empty count. From here each recorded step carries `survivors`: the number of settings the rule so far keeps on the walked board at the moment the step is recorded, exactly the number the page prints as "N settings survive" from the read it has in hand — never re-read, never recomputed on the page. A step recorded from a read that has no count (none in hand) carries `null`, never 0: an unknown is not a zero. Each step back carries the same count under `survivors` for the step it left. The two other places on a step (`splitHalf`, `noiseTwin`) are left as they are: the walk's read carries no survivor count on the halves or the twin, and inventing one on the page is the fault this step exists to end.
- **What it is for.** The reserve grade (step 5) counts looks; a step's own count is what lets it say how far the board was narrowed at each look. Nothing here reads the held-back window.
- **Expected outcome: none recorded.** Counts are whatever the read said.
- **Release.** 3.88.1, third digit: a field the record already had, filled.
- **Outcome of the build (2026-09-08 01:25 UTC).** Committed 0ac1670 on both branches; the whole suite green (1,065 checks); the browser-driven Funnel test pressed the walk for real and passed; two guards. Deploy parked behind the certificate (step 2).
- **Instrument hunted.** The first cut renamed every step-recording call inside the walk's wiring to the counted helper with one blanket replacement, and the replacement rewrote the helper's own definition into a call to itself — an endless loop on the first choice of every walk, on every browser, and no unit test runs that code. The scan written for this step caught it before anything ran ("every step goes through the counted helper" failed on the helper's own line), and two older scans that pinned the old call lines were re-aimed at the helper in the same commit. The browser-driven Funnel test is the only thing that presses those lines for real; it is hand-run.

### Step 5 — the reserve grade on History for a Stage 4 record set, 3.89.0 (rules written before any number)

- **The window.** The set's own unit only. The unread window runs from the seal's start recorded on the set's unit (the parent's date ranges, `unread.fromTs`, the same start the sealed check reads) to the newest hourly candle the box holds for the coin on the day it is pressed (decision 12: a start and no end), reading the box's files as they are now for that stretch and the files the chain was launched on for everything before it; only chunks whose whole trade fits inside what the box holds are priced. The stored votes must line up with the rebuilt test chunks to the timestamp, the same check stage 3 makes, or the grade refuses: a set whose price files moved underneath it is not the same set.
- **The forecasts.** Nothing is retrained. Each member's saved model — the stage 2 parent keeps them, a straight-line model with its scaler or a boosted one with its trees — is applied to the unread chunks' readings on the member's own view. The committee's own shape (its independent voices and each way of weighing's own bar) and each member's tau are worked out on the test slice from the stored votes exactly as stage 3 works them out, and the unread window is never read for them.
- **What is priced.** Every survivor of the set, never a page, at the hold length stage 3 priced it at, through the same simulator: its money on the unread window; K scrambled copies, K being the set's own copy count, each a dealt order of the unread slice drawn from the set's seed as stage 3 draws its deals; the four comparisons on the unread window at that survivor's hold length; and, for information, its trades, stops and the same rich figures the ride keeps.
- **The reading rules, declared before any number, the verdict's four on this window.** Footing: the rule replays its own survivors today on the set's own copy, or the grade refuses. The survivors' mean unread money is positive and beats buying the coin and going away and shorting it and going away at the worst hold length in use, by at least a cent (DERIVED; unknown never passes). It beats at least the bar of the K copy means, the bar being the set's own share resolved on K (DERIVED), or a typed share tagged GUESSED. Sanity: more than the sanity share (50, GUESSED) of the survivors' scrambled unread figures are below zero — stated as read over the survivors' copies only, because the whole board is not priced on this window. Each survivor's own reading is printed and never a gate. PASS means all four stood; the chance a forecast-free rule clears the bar is printed beside it.
- **Refusals, in words, before anything prices.** No block on the set whose verdict is PASS under the same first digit as the reader; the sealed window not intact on the unit; a set cut on all units together; the stage 3 parent or its stage 2 parent gone; fewer than two whole chunks on the unread window; any heavy job going. Nothing about how many times it is pressed: it counts.
- **Looks.** Every grade of a set's unread window is stamped with which look it is, appended on the set newest first and never overwritten; the first look reads data nothing in the system has seen, and the sentence of every later look says the slice had been read before. The Funnel and Verify never touched this window (it was cut away before anything trained), so before the first grade its look count is zero.
- **Where.** History, in a panel of its own beside the existing grade: the set box filled from the server's list, the footing (which verdict block stood, the sealed window, where the unread window starts and how far the box's data reaches today, the looks so far), the press, and the grades stamped, newest first, each with its sentence, its four readings and its survivors. Started and polled. Help entries for every control.
- **Expected outcome: none recorded.** The owner presses it; the number is whatever the arithmetic returns. Nothing in the loop presses it on the owner's set.
- **Release.** 3.89.0, second digit: new behaviour, new controls, new fields; nothing on disk stops being readable.
- **Outcome of the build (2026-09-08 01:55 UTC).** The pricing rides inside the stage 3 task with the unread window in the held-back window's place; the members forecast it from their saved models; the service's dry read, press and status; three routes; the panel on History; help. tests/test-unreadgrade.js runs the whole chain on the two fabricated coins and passed on its first run: the saved models give the stored votes back digit for digit, the unread window starts where the seal began and holds whole trades only, the refusal is real, the first look prices every copy for every survivor with the four comparisons known, and the second look is appended and says the window had been read. The whole suite ran with one failure, a scan that counts the places the kept scrambles are written and found the reader's new mapping; re-aimed at the sixth place with its reason. Committed 995abe2 on both branches. **Instrument hunted, by a guard (3.89.1).** Five of the six guards were caught; the sixth was not: with the members' stale held-back votes standing in for forecasts on the unread window, every check in the end-to-end test still passed — the held-back window holds 48 votes and the unread window 47 chunks, so the wrong votes were numbers and the test could not tell them from forecasts. The grade now carries a hash of the members' forecasts on the unread slice, and the test recomputes it from the saved models on the same chunks; the guard is caught. Deploy parked behind the certificate (step 2).
- **Found on the way, parked (RULE SIX).** The word list's walk brace-matches a helper's body from where the helper is defined, so a brace-less one-line helper (`const vDay = (ts) => …`) defined just above another screen's renderer reads as that renderer's body, and the walk drags that screen's controls onto whichever list called the one-liner. It surfaced when History called Verify's three formatters and the help check put "Run the stage-engine check" on History. The History panel got formatters of its own, written with braces; the walk itself is left as it is, because it is the rule's instrument and changing what it admits is the owner's call.

### Step 6 — Greenlight speaks the rule's agreement; one survivor by depth or by a named pick, 3.90.0 (rules written before any number)

- **The door.** A second way to mint a greenlight, from a Stage 4 record set: the set (from the server's list), the verdict block that stood (the newest PASS under the reader's first digit, the same gate the reserve grade uses), one survivor, a name and a why. It refuses in words without such a block, on a set cut on all units together, and on a unit the live executor's vocabulary cannot carry (a coin read on its own, or a survivor whose entry is not market, whose gate is not directional, or that carries a trailing stop or an arm). Nothing here trades: a greenlight is a decision recorded, and the shuttle that puts one to work refuses a stage-engine configuration in words until the live path speaks its agreement (step 7), and real money stays the owner's switch (RULE SIX).
- **How one of the survivors is chosen without shopping.** By DEPTH inside the rule, never by money: for each dial the rule holds a range on, a survivor's distance from the middle of that range is measured over the range's width (0 at the middle, 1 at either edge); for a dial the rule holds a list of words on, every survivor is at the middle; the survivor with the smallest worst distance across the ranged dials is the pick, and among equals the one nearest the middle on average, and among those the first in the set's own order, so the pick is a function of the rule and the survivors alone. Or the owner's NAMED pick, one of the survivors by its own name, recorded as a pick with a mark. Both ways are recorded on the greenlight: which way, the survivor, and its distance.
- **What the configuration carries.** The unit's coin and its two companions, the shape, the decision, the resolved band and 24/7 or 24/5, the members exactly as the stage 2 set trained them (model and view for each), the trade shape (market, directional, the hold length as priced), and the AGREEMENT as the survivor carries it: the way of weighing, whether the bar is all or the committee's own, the share, the copy share, +both and +hold — validated against the agreement library's own lists, where the old integer quorum used to be. The engine is named on it (`stages`), with the stage 1 training choices the members were trained under, so the live path can train the same way. Provenance: the set, the block, the stage 3 set and its stage 2 parent, the survivor's own held-back and unread readings when they exist, the fee the set was priced under.
- **Where it shows.** Greenlight: a panel of its own under the existing one. Trade: the frozen configuration's rows print the agreement in the survivor's words on both "Paper Books" and "Live Trading" through the one drawing path (RULE TWO), and an old configuration keeps printing its quorum.
- **Expected outcome: none recorded.** The owner mints; the depth pick is whatever the arithmetic returns.
- **Release.** 3.90.0, second digit: a new door, new fields on a greenlight; the configuration vocabulary grows without any existing greenlight or setup on disk stopping being readable.
- **Outcome of the build (2026-09-08 ~03:00 UTC).** The vocabulary (`lib/live/configschema.js`) names the engine and validates the agreement against the agreement library's own lists; the door (`lib/live/greenlight.js`), the source read off the set (`lib/stages.js`), the depth pick (`lib/funnelset.js`), a route branch and a dry route, the panel on Greenlight, the agreement rows on Trade through the one path, help. Tests: the library (a survivor's agreement frozen, no quorum invented; ten refusals; the shuttle and the live door refuse; an old configuration untouched), the depth pick (never money; ties; word dials; a range of no width), the source on the fixture (refused without a verdict; the unit, survivors with depth, the pick by depth and by name; the dry read's words). Four guards.

### Step 7 — the live path speaks the stage engine's agreement, built and tested, never switched on, 3.91.0 (rules written before any number)

- **What the live path does today.** For a deployment it rebuilds the coin's chunks from the box's files, trains the older engine's committee through the deployment's training instant, forecasts the one chunk whose entry hour has arrived, counts the members' votes against the integer quorum, and writes an intent the box's executor places. A stage-engine configuration (step 6) carries no integer quorum, and the live door refuses it.
- **What it will do for a stage-engine configuration, as it will be coded.** Train the members the way stage 1 and stage 2 train them: each model on its own view through the same fitting (a straight-line model with its scaler, a boosted one with its trees), with the same weighing of training days the set was trained under, on the chunks whose outcome has closed by the deployment's training instant, laid out as stage 1 lays them out — the older share as training, a test slice after it — and the sealed part not cut away, because the seal existed to leave data unread and a deployment reads everything closed. The committee's own shape (its independent voices, and each way of weighing's own bar) and every member's tau are worked out on that test slice exactly as stage 3 works them out. Then the target chunk's votes come from the fitted models, and the call is the agreement rule's own call on that moment — the way of weighing, the bar, the share, the copy share, +both and +hold as the configuration carries them — through the ONE definition of a committee's call, shared with stage 3 rather than written again: the stage 3 task's closures for calls, voices, bar and stream move into a module both paths call, and the stage 3 numbers do not change (the suite holds them; the fabricated chain reprices to the cent).
- **Parity, declared as the gate on lifting the refusal.** On the fabricated chain, the live module's calls for the held-back chunks, computed from the stage 2 set's stored votes, fed to the same simulator on the same chunks, reproduce the stage 3 record's held-back money for the survivor to the cent. Only when that test passes does the live door accept a stage-engine configuration, and then it accepts it only as far as the older engine's: the owner's Activate press on the Trade tab is the switch, on Paper Books first, and nothing in the loop presses it (RULE SIX). The shuttle's refusal from step 6 is lifted with the door's.
- **The record.** The intent carries the eight members' votes, the agreement as the configuration carries it, and no integer quorum; the box's executor reads what it is given and requires no quorum. The mirror recomputes through the same path. The anatomy panel on Trade describes the agreement in the survivor's words instead of a quorum, on both sides through the one path (RULE TWO).
- **Expected outcome: none recorded.** The parity test either holds or it does not; the loop reports which.
- **Release.** 3.91.0, second digit: new behaviour on the live path; nothing on disk stops being readable.
- **Outcome of the build (2026-09-08 ~03:40 UTC).** `lib/committee.js` holds the one definition; the stage 3 task calls it (its per-slice caches kept, its own closures gone), and the four-year engine run reprices to the cent before and after the move. `lib/live/stagesignal.js` trains and decides the stages' way; `lib/live/signal.js` decides by the engine the configuration speaks for, for the live decision, the recompute and the preview alike; the intent carries the votes and the agreement; the anatomy panel says it in words. **Parity held on its first run:** every survivor of the fabricated chain's Stage 4 set reprices to the cent and to the trade through the shared definition, and the live path decides one held-back chunk on the planted coin deterministically. On the fabricated three-coin combo a stage-engine configuration produces an intent with every vote and the agreement and no quorum, the recompute matches field for field, and +hold reads only the moment before. The two refusals from step 6 lifted; a shuttle makes a draft and nothing else. Tests: a new file for the shared definition (four), the parity test, the live signal test, the greenlight test flipped, one scan re-aimed at both places that build a quorum. Four guards.

### Step 8 — Tune's per-trade capture for a Stage 4 record set, 3.92.0 (rules written before any number)

- **What Tune does today.** "Tune protective stop (full history)" and "Run conviction sweep (full history)" replay a saved setup's or a saved run's committee over its whole history through the older engine and price the entries themselves: the stop tuner walks each entry's hold on the hourly candles for the deepest move against it, the conviction sweep prices each entry open-to-open at the hold length and sizes it by how many members agreed. Both take the entries as a list: the entry hour and the side, and for the ladder how many members called that side. A Stage 4 survivor has none of that on disk: the set holds money per window, never the trades.
- **The capture, as it will be coded.** A job on the set's own unit, the same pricing pass as the reserve grade with a flag: for every survivor that enters at market with no trailing stop (the only shape the two tools price), the committee's real calls on the test slice and the held-back slice (from the stored votes, the real calendar, no deal) and on the training slice (the members forecasting their own training chunks from the saved models, in-sample on purpose, as the older tools do: a protective stop wants the deepest a winner ever dipped over all data). Each moment the rule spoke is recorded as the entry hour, the side, how many members called that side, which window, and the simulator's own money for that one trade, priced by the one simulator on that chunk alone, so the population is exactly the simulator's (an invented entry candle or a missing exit drops out here as it does there) and can be held to the record. Survivors of another shape are listed as not captured, with the reason in words. The capture is a function of the set and its votes, so a second press gives the same table: it replaces the first and says when it was taken. The entries live in a file beside the set (a survivor can carry a thousand of them); the set holds the summary. The unread window is never captured: it is the reserve grade's alone.
- **Parity, declared as the gate on offering it.** On the fabricated chain, for every survivor: the captured held-back entries' money sums to the stage 3 record's held-back money to the cent and their count is the record's trade count; the captured test entries likewise against the record's test money; and the agreement count on every held-back entry equals a recount from the members' own calls through the shared definition. Only with that test green is the capture offered on the screen.
- **The tools on a capture.** The scan target on Tune offers each Stage 4 set that carries a capture; beside it one survivor (by depth, the same pick Greenlight makes, or named) and three ticks for which windows feed the tool: training, test, held-back. Defaults: training and test ticked, held-back not. The stop tuner runs on the chosen entries through the same tuner the older path uses, at the survivor's own hold length and the set's fee; the ladder likewise, its rungs one to the member count. Nothing is applied: for a Stage 4 target the apply buttons are not offered, and no number here changes the set, a greenlight or anything live.
- **Looks.** A tool run that reads the held-back entries is a look at the held-back window: it is stamped on the capture (which tool, which survivor, which windows, look N), counted on Verify's looks line, and the line beside the result says so. Runs on the training and test entries are not looks: those windows were read to choose the rule.
- **Refusals, in words, before anything prices.** No verdict block on the set whose verdict is PASS under the reader's first digit (the same gate as the reserve grade and Greenlight); a set cut on all units together; the stage 3 or stage 2 parent gone; no survivor that enters at market without a trailing stop; any heavy job going. A tool run on a set without a capture refuses and says to capture first; a named survivor not captured refuses by name; no window ticked refuses.
- **Where.** Tune, a panel of its own under the existing ones: the set box (from the server's list), the footing (which verdict stood, survivors, how many enter at market, the capture on record and its looks), the press, started and polled. The scan target box grows the set entries, with the survivor box and the three ticks beside it. Help entries for every control.
- **Expected outcome: none recorded.** The tuner's stop and the ladder's uplift are whatever the arithmetic returns on the owner's set; nothing in the loop presses either on the owner's box.
- **Release.** 3.92.0, second digit: new behaviour, new controls, a new file beside a set and a new field on it; nothing on disk stops being readable.
- **Outcome of the build (2026-09-08 ~05:10 UTC).** The capture rides inside the stage 3 task with a flag (`lib/stagework.js`), the job and the scans on a capture in `lib/stages.js`, the routes and the scan branch under the same mutex in `server.js`, the panel and the target row on Tune, help. **Parity held on its first run:** every survivor's held-back entries sum to the record's held-back money to the cent and count its trades, the test entries likewise, and every agreement count is a recount from the members' own calls. **Instrument hunted on the way:** the tuner walks each entry itself, so a second check was added before the suite ran — the tuner's own money for every captured entry equals the simulator's to the cent, on all three windows — and it held: a stop is tuned on the book the record was priced on. One check re-aimed after its first run: the scan target list leaves exam sets out by design, and the fabricated set is one. Tests: tests/test-tunecapture.js (three), registered in run.js. Four guards.

### Step 9 — the age dial's design document for the three-stage engine (written, nothing built)

- **What was asked.** Decision 10: "History Tuning with the age dial: rebuilt for the three-stage engine as a new instrument with its own pair of calibration exams, its own design document first, after (a) to (d)."
- **What was written (2026-09-08 ~05:40 UTC).** `AGEDIAL-DESIGN.md`: the dial as one half-life multiplied into stage 1's existing training weights and carried to stage 2 by itself, the floor refusing before anything trains; the pair as two chains (the owner's reference chain and a dial chain launched from its saved parameters), read on the held-back window with one delta per coin-and-shape unit under the declared rule, through the sign-flip null and the concentration rule the older instrument already declares; two exams on fabricated coins (late-rule coins the dial must find, whole-span coins it must not) under the current release line; where it lives on Sweep, Boards, History and Verify; build order in three second-digit steps; and eight decisions the owner has to make before any build order. The older panel on History stays, as the owner decided. Nothing in it is built.

### Where the loop ended (2026-09-08 02:45 UTC)

- **Every named step is done:** 0 and 0a, the Verify batch (3.86.0, 3.86.1), V0 (3.87.0), V6 and V7 (3.88.0), the survivor counts (3.88.1), the reserve grade (3.89.0, 3.89.1), Greenlight's agreement (3.90.0), the live path (3.91.0), Tune's capture (3.92.0), and the age dial's design document. Each is committed on both branches with its tests, its guards caught, and its decision record.
- **Deploys are parked, and stay parked.** The box serves 8e26910 (3.86.1). At 02:40 UTC the runner's own certificate, read through the proxy tunnel, was still the one that expired at 00:35 UTC (a first read at 02:37 UTC saw a fresh certificate and was wrong: it was the sandbox's egress gateway's, not the runner's). The gated chain asked the box and refused on no answer, as it is built to. Once the owner renews the certificate the chain is: the gated deploy on `busy: none`, the fingerprint into `SERVED.json`, the word lists, the narrow tests, the record commit. Until then no label named in steps 2 to 8 is on the owner's screen, and the word lists do not carry them.
- **Parked findings for the owner:** ~~lengthening the stage-engine check's span (step 2)~~ — ordered and done, 3.92.1 (decision 83); the walk's across counts (step 3); the word list's brace-less-helper quirk (step 5); the stage launches not refusing during a rebuild or a ride; tasks #47 and #54. Nothing in the loop pressed a verdict, a grade, a capture, a scan or an activation on the owner's box.

*That closing line said "Nothing here is built. Every item waits for `GO NOW!`" — true on 2026-09-07 and false ever since. Everything in PART ONE was built and every deploy in the parked chain above has since gone out. The one thing that is still true is the last clause, and it is permanent: nothing that arms real money (section 6, the live path) is switched on inside a loop, or outside one, without the owner. PART TWO below is where the unbuilt work now lives.*

---

# PART TWO — WHAT IS STILL TO COME

Six parts, moved here whole from `SELECTION-DESIGN.md` on 2026-09-12, with
their numbers unchanged. They are in number order, not build order.

| Part | State |
|---|---|
| 1 — judge on several stretches, not one | the engine is built and reachable from no screen; the screen is next |
| 2 — the bar is the best of all four comparisons | BUILT, 3.100.0 and 3.101.0 |
| 5 — set the bar for the whole search | blocked |
| 6 — write down the claim before the stretch is opened | blocked |
| 7 — what the settings you threw away did on held-back | BUILT, 3.100.0 |
| 8 — judge the thing you would trade | not built |

**Parts 3 and 4 are not here.** They belong to **Boards** and the **Funnel**
and are written in `SELECTION-DESIGN.md`, along with the doctrine every part
below has to obey.

---

# Part 1 — judge on several stretches, not one, on Verify

> **Reshaped 2026-09-09 by the owner, and the reshaping is the good part.** My
> version re-ran the whole sweep five times and I said the cost was the thing
> most likely to sink it. The owner's version runs on the ONE `unit` the
> **Funnel** already narrowed to — one coin, its companions and one shape. That
> is a fraction of a full stage 1 sweep, which trains every combination in the
> universe. The blocker I put here has largely gone with it.

> **BUILDING, 2026-09-11.** The owner: "i don't care about timing retraining for
> the Part 1 as some kind of blocker. just queue up part 1 next" — so the timing
> measurement is withdrawn as a blocker and the cost is discovered by building
> it. And the open question this part raised is ANSWERED by the owner: **a
> pass's judging stretch is NOT a counted look.** Five stretches never opened
> before are five fresh rolls, not five spends of the one look; the single
> verdict's held-back read stays the counted one.

### 1.0 The rule this is judged by, written before any of it was built

Written first and on purpose, so that no number produced later can be talked
into being a success (RULE SIX's discipline, which is worth keeping whether or
not a loop is running).

**Done means all six, and any one of them failing means not done:**

1. **Five passes on ONE coin and shape, and the reserve in none of them.** A
   test asserts no pass's judging stretch overlaps the reserve, on real stored
   ranges — not on a comment saying it does not.
2. **Every score is against the copy count the ORIGINAL run used at that
   stage**, read off the set, never typed. A test changes a stored count and
   watches the reading move; if it does not move, the count is not being read.
3. **One retrain per pass, shared by both sides.** The settings the rule kept
   and the sample it dropped are priced against the SAME retrained forecasts.
   If the retrain happens twice per pass, the control is not free and the part
   is built wrong.
4. **No pass stamps a counted look.** A test runs the passes and asserts the
   set's held-back-read stamp is exactly what it was before. This is the
   owner's ruling and it is the one thing here that cannot be got back if it
   ships wrong.
5. **The block draws ABOVE the single verdict.** A weaker number read first
   becomes the number that is remembered.
6. **Green suite, a Help entry for every new control the Help tab can see,
   every new rendered label on the word list regenerated from what the box
   serves, a deploy whose health check passes, and a mutation guard for each of
   1 to 5** — because a behaviour with no guard is a behaviour that reverts
   quietly.

### 1.0a What I expect to go wrong, written before looking

- **The retrain may not take an arbitrary boundary.** If stage 1's stretch
  layout is fixed in the engine rather than passed in, then sliding it is a
  change to the engine and not a new caller — a much bigger release than one
  Verify block, and it would put every record set on the box in question. If
  that is what the code says, the honest move is to PARK the sliding boundary,
  say so, and put it to the owner (RULE ZERO) rather than change the engine
  unasked.
- **The copies almost certainly cannot be carried between passes**, because a
  copy set is keyed to the window it was built on. So the cost is five times
  (retrain + copies + pricing), which may be hours. It has to be a started and
  polled job with real progress, never a held request — the same contract the
  other Verify reads already use.
- **"The bare unit at stage 1" may have no number today.** If no single stored
  figure means that, one has to be chosen. That is a small choice inside an
  approved step, so it is mine to make and to record here — but it must be
  built from something already stored, never from a new measurement invented to
  make the level scoreable.
- **Twenty copies give a resolution of one part in twenty**, so a pass can only
  be stated in steps of five percent. Keeping the original counts is right for
  comparability and it is still coarse. Saying "cleared four of five passes" off
  a five-percent grid is a coarser claim than it sounds.

### 1.0b What the code actually says, read before building

Six readers mapped the engine and six adversarial checkers tried to refute
them: 184 facts confirmed, 51 claims thrown out. What survived, and what it
changes:

**The sliding boundary is nearly free, but not quite free.**
`splitAndLabelAt(chunks, branch, nTrain)` already takes the training length
from its caller and is already in production for the History retrain. What it
does NOT give is a third stretch: it returns `holdChunks: []`, and it labels
only the chunks handed to it. So a pass is built by slicing the chunk list into
"everything before the judge" and "the judge", calling `splitAndLabelAt` on the
first, and labelling the judge with the band that call RETURNS. The band comes
from the training slice and never from the judge — that is not a nicety, it is
the difference between a judgement and a rehearsal. `unitChunks` decides the
layout internally from two literal names, so this is one added branch there,
additive, changing no existing layout.

**The copies need no new builder.** `keepN` and `keepFrom` beside the payload
give each pass its copies on that pass's own stretches, the way the noise top-up
already does. Independent draws per pass come from the TAG `dealOrder` already
takes as an argument — a new tag per pass, not a new random source.

**Levels 1 and 2 have no stored number to read, as §1.0a feared.** What exists
to re-derive is the forecast score, and every one of its five call sites scores
on TEST labels — there is no hold-stretch scorer. So the level is the forecast
score on that pass's judge labels: the same arithmetic, new labels, nothing
invented.

**The cost is much larger than the first reading said, and it is worth saying
out loud.** One boost member is ten seconds when the fitting stops early and
about 134 when it keeps improving; a triple-coin unit's committee is 10 to 22
minutes of fitting at full CPU, not the 43 seconds a noise-floor measurement
suggested. Five passes is therefore roughly **one to two hours** of retraining
alone, before any pricing, and a triple-coin unit reloads its candle maps every
pass because the cache is four deep and never hits for three coins. This has to
be a started-and-polled job with real progress, and the owner should know the
figure even though they have ruled the measurement is not a blocker.

**Where it goes:** `public/construct.js:2044`, between the press row and the
verdict blocks — which satisfies "above the single verdict" without pushing the
set picker down. The watcher to copy is the one the ride uses, paired with a
progress-bearing status door; the verdict's own watcher carries no progress and
is the wrong shape. Eleven tests scan Verify's source, one of them pinning three
substrings in order, so they move with this.

### 1.0c THE FAULT IN THIS PART'S OWN TABLE, found before building it

The five-pass table above is wrong in two ways, and both were found by working
its arithmetic back against the engine rather than by being told.

**One: it reaches into the reserve.** The table takes the judging width as
`round(non-reserve / 10)` = 232, and pass 5 then ends at chunk 2319 of 2315
non-reserve chunks — four chunks inside the sealed reserve this part promises in
its own words never to touch. Taking the width as `floor` gives 231 and letting
the last judge absorb the remainder ends it exactly on the boundary. Fixed here.

**Two, and it is the one that matters: every judging stretch is already spoken
for.** The owner's sets are `reserve61`, which seals 13% and then splits the
rest 70/15/15 — which is where the name 61/13/13/13 comes from. For the owner's
set that puts the original run's fitting and tuning on chunks 1 to 1968, its
held stretch at 1969 to 2315, and the reserve beyond. Against that:

| pass | judges | of that, inside the already-spent held stretch | inside what the original run chose the dials on |
|---|---|---|---|
| 1 | 1156-1386 | 0 | all 231 |
| 2 | 1387-1617 | 0 | all 231 |
| 3 | 1618-1848 | 0 | all 231 |
| 4 | 1849-2079 | 111 | 120 |
| 5 | 2080-2315 | all 236 | 0 |

**So the owner's ruling that a judging stretch is not a counted look holds for
passes 1 to 3 and fails for 4 and 5 on its own stated grounds.** Pass 5's
judging stretch IS the held stretch the single verdict already read. It is not a
stretch never opened before.

**What this does to each level.** Levels 1 and 2 are clean on all five passes:
each pass retrains, so its judge is genuinely unseen by THAT pass's forecasts,
and there are no dials to contaminate. That is the half this document says
cannot be answered today, and it works. Level 3 is not out-of-sample on any
pass: retraining the forecasts does not de-contaminate the DIALS, which were
chosen knowing chunks 1 to 1968 — inside passes 1 to 4's judges — while pass 5
judges them on a window already spent. §1's own assumption that "cleared it five
times is a claim about the dials" is right and does not go far enough: the dials
were picked inside four of the five stretches they are being judged on.

**What is built because of it:** every pass's row prints how much of its judging
stretch fell inside the selection window and how much was the already-spent held
stretch, and the level-3 line says plainly that it is not an out-of-sample
reading. A five-pass record that reads as five confirmations when it is none is
the exact fault this document exists to prevent, and a screen that knows the
number and does not say it is worse than one that never worked it out.

**Left for the owner** (and not decided by a session): whether level 3 earns its
compute at all, given it cannot be out-of-sample, or whether the kept-against-
dropped difference should carry that question instead — where the contamination
falls on both sides equally and the gap still means something.

## The problem

A single held-back stretch is one roll of the dice. Whatever that stretch
happened to do dominates the answer, and nothing separates a setting that works
from a setting that suited that stretch. Once opened it is spent — a second look
at the same stretch is not a second roll.

## What is on Verify today

Read out of the word list generated from what the box serves. Three blocks.

**The verdict.** "The verdict on a `Stage 4 record set`". Pressed with
`Read the rule against nothing on the held-back window`. Two boxes set it:
`bar share %` and `noise must lose at least %`. It reads what the `survivors`
made on the held-back window against four comparisons, of which two gate —
`buying the coin and going away` and `shorting it and going away` — while
`being long every period` and `being short every period` are shown and, in the
page's own words, "the window's direction and never a gate". Around it sit
`Rules declared before the numbers:`, `Looks at the held-back window before any
stamp:`, `Every survivor against its own copies:` with its by-chance count, the
`sanity:` line on the scrambled copies, and `Line A` and `Line B, the bound on
shopping`.

**The other units.** `Read the rule on the other units' held-back windows` runs
the same rule on every other coin-and-shape `unit` of the stage 3 set this was
cut from, each on its own held-back window against its own copies. Two counts,
information only, never a gate. About five seconds a `unit`.

**The ride.** `Work out the held-back ride` gives, per survivor,
`largest drawdown $`, `worst trade $`, `best trade $`, `trades won`,
`stopped out`, `gross per trade $` and `money by third`, beside the same on the
test window. Information only, and every press is a counted look.

Two things worth noticing before adding anything. Verify already refuses to sort
its tables, and says why: "There is no sort on this table: a sort is a look."
That is Part 3's principle, already applied here. And
`Rules declared before the numbers:` is already Part 6 in embryo.

## The change, as an added block on Verify

Take the one `unit` the **Funnel** worked on. Retrain it five times with the
boundary sliding forward, and score three things on each pass against the same
copy counts the original run used at each stage. Nothing touches the reserve.

For the owner's set the passes divide the coin's history like this. The reserve
stays sealed at 346 chunks and appears in no pass.

| pass | train | test | judge |
|---|---|---|---|
| 1 | 954 | 205 | 232 |
| 2 | 1,145 | 246 | 232 |
| 3 | 1,336 | 287 | 232 |
| 4 | 1,527 | 328 | 232 |
| 5 | 1,719 | 368 | 232 |

Train and test do exactly what they do now. The judge column is that pass's
held-back stretch, opened only after the choosing is finished.

**Scored on each pass, at three levels:**

1. the bare `unit` at stage 1, against that stage's own copy count
2. the bare `unit` at stage 2, against that stage's own copy count
3. the `survivors` at stage 3, against that stage's own copy count

Splitting one and two from three splits a question that is currently answered as
one number: do the forecasts still work on data they never saw, and separately,
do the trade settings still work. Today you cannot tell which half failed.

**And the control, which is nearly free.** The **Funnel** kept 199 settings of
2,752 for this set. Put a sample of the other 2,553 through the same five
passes. The expensive part is retraining the `unit`, and the kept and the
rejected share those same trained forecasts, so adding the rejected ones is only
more pricing against models already paid for. If the rejected do as well as the
`survivors` across five passes, the picking added nothing and the 199 are just
the top of a pile that was all doing well, not a selection.

The same control has a much cheaper form that needs none of this built, on the
held-back stretch that already exists. That is Part 7, and it should be built
first.

## What gets ADDED to Verify

**Controls.**

- One press to run the passes. It needs a name and I am not going to invent one
  here; the existing presses on the page are phrased as instructions, which is
  the pattern to follow.
- A box for how many passes.
- A box for how many rejected settings to sample, with none as a legal value.
- Nothing else. The copy counts are read from the stages the set was built by,
  never typed, so they cannot drift from what the original run used.

**Results.** One table, one row per pass, showing the train, test and judge
chunk counts and dates for that pass, then for each of the three levels: what
was made, what the copies made, and `beats N of K`. Under it, a single line:
cleared on how many of the passes. Beside each survivor figure, the same figure
for the rejected sample.

## What gets REMOVED

Nothing. I looked for something and there isn't anything.

The single verdict stays, because it is what History's reserve grade is keyed to
and because it is the one reading on the real held-back stretch.
`The rule on the other units` stays, because it answers a different question:
the same rule elsewhere, one window each, rather than this `unit` across five.
The ride stays.

**One thing should move rather than go.** The five-pass record is stronger
evidence than the single verdict, so it should sit above it on the page. A
weaker number read first becomes the number people remember.

## What it needs from the other parts

Part 2, because a record of clearing a soft bar is a record of nothing. And it
needs one question answered that I cannot answer: **is each pass's judging
stretch a counted look?** Each one is a stretch never opened before, so the
natural reading is no. That has to be decided rather than assumed, and it
belongs with Part 6.

## What I am assuming

- **That five retrains of one `unit` is affordable.** Far more likely than my
  version, but still unmeasured. One retrain of this `unit` is the number to get.
- **That claiming the same six dials is the same claim on every pass.** Each
  pass retrains, so the forecasts behind a setting on pass five are not those
  behind it on pass one. "Cleared it five times" is a claim about the dials.
  That is probably what you want, since the dials are what carries forward, but
  it should be said rather than assumed.
- **That the copy counts hold up at five passes.** Twenty copies gives a
  resolution of one part in twenty, so a pass can only be stated in steps of
  five percent. Keeping them as the original run had them is right for
  comparability. It is still coarse and worth knowing.

## What it costs

Five retrains of one `unit`, plus five sets of scrambled copies, plus pricing
the kept and the sampled rejected settings on each pass. The copies have to be
rebuilt per pass from that pass's own stretches and cannot be carried over.

This is far cheaper than the version I first wrote, and it is the only part of
this document whose cost I still cannot put a number on.

# Part 2 — make the bar the best of all four comparisons

> **BUILT AND DEPLOYED, 3.100.0 (the gate) and 3.101.0 (the table).** The gate
> is the best of all four. The four are shown on **Verify** as a table with a
> heading on every column, replacing the prose line that carried them, after the
> owner found that line flipping its subject halfway through. Nothing below is
> outstanding.
>
> **This part was wrong in the first draft and I told the owner the wrong thing
> in conversation before writing it.** I said the money gate was buying the coin
> and going away, and that this was a soft one-sided bar. It is not one-sided.
> What the code actually requires is all three of: money above zero, beats
> `buying the coin and going away`, and beats `shorting it and going away`.
> That is already a best-of-two bar, and it already rules out a fixed direction
> lean against the one-trade pair. The rest of this part is rewritten against
> what is really there.

## The problem

The gate today uses the two one-trade comparisons. Those carry almost no dealing
costs, because they are one trade over the whole stretch. The code's own note on
them says this makes them the **harder** bar over a trending stretch and the
easier one over a chopping stretch.

The two every-period comparisons — `always long` and its short version — pay a
round trip on every single period. Over a long stretch that is a very large cost
load, so they are usually the **easier** bar in a trending stretch.

So neither pair is harder in general. Each is harder in different conditions,
and the pair used today is chosen without reference to which condition holds.
That is the real fault: **the bar's difficulty moves with the market and nobody
decided that it should.**

## The change

Gate on the best of all four, plus zero:

- `always long`
- its short version
- `buying the coin and going away`
- `shorting it and going away`
- and being in the money at all

A setting passes only by beating the highest of them. This is strictly harder
than today and strictly harder than what the first draft proposed, and it does
not depend on guessing which condition the stretch was in.

## What it needs from the other parts

Part 1, and this is the important one. Taking the best of four removes exactly
one advantage: the advantage a setting gets from having leaned the way the
stretch happened to go. It does nothing about ordinary luck — a setting that
traded rarely and caught a few big moves still clears it. Only judging on
several stretches turns that into something you can see.

## What I am assuming

- **That a fixed direction lean is worth this much attention.** It is what bit
  us. It is not the only way to look good without being good.
- **That the four are comparable enough to take a maximum over.** They are not
  built alike. The every-period pair opens a position on every period regardless
  of what the setting did, so they do **not** trade the same number of times as
  the setting — the first draft said they did, and that was wrong. Taking a
  maximum over four things measured on different trade counts needs a reason,
  and the reason I would give is that each answers "could this have been got
  without the forecasts", which is the question the gate is for.
- **That the scrambled copies do not already cover this.** They may partly. They
  deal the same calls onto other days, so a setting that is long nearly always
  looks similar on every copy, which means the copies bar already penalises a
  flat direction lean to some degree. How much, I have not measured.
- **That a maximum is the right shape, rather than a margin read against
  something.** A stronger version is to measure the margin over the best of the
  four in units of how much that stretch moved about, so the bar means the same
  thing in a calm stretch and a wild one. That is more work and I think it is
  better. It is worth deciding which.

## What gets ADDED to Verify

Almost nothing, because the four figures are already on the page. Verify prints
`buying the coin and going away` and `shorting it and going away` as the two
that gate, and says of the other two, in its own words, that
`being long every period` and `being short every period` "are the window's
direction and never a gate".

So the addition is one line: **did the rule beat the best of the four**, stated
plainly rather than left for the eye to work out across four figures. And that
line becomes what decides pass or fail, replacing the two that decide today.

Nothing is removed. All four figures stay printed exactly as they are.

## What it costs

Small. All four are already computed and stored, for every `setting`, not only
for the `survivors`. This is a change to which number decides pass or fail, and
which is only shown.

---

# Part 5 — set the bar for the whole search, not one setting at a time

> **Blocker.** This part rests entirely on one figure being fit for a purpose it
> was not built for, and the code says twice that it is not. Until that is
> settled, building this would refuse real work on a wrong number, which is
> worse than the note it replaces.

## The problem

If you try a great many settings and each has some chance of clearing its bar by
luck, a good number clear it by luck. A count of survivors means nothing until
you know how many would have survived with no skill at all.

**What exists today, exactly.** **Verify** prints a line of the form "N of M
survivors clear the same bar on their own copies, about X would by chance". That
line is about settings that have **already been selected**, measured against
their own scrambled copies, and the same line ends by saying it is never a gate.
The code says the same thing in its own comment.

So the figure that exists is not the figure this part needs. What is needed is:
of everything that was **tried**, how many would clear by luck. That is a
different question about a different population.

## The change

Two things, neither of which can be made until the blocker above is resolved.

1. **Refuse rather than note.** If the count that cleared is not clearly above
   what luck would give, the set does not go forward — with both numbers side by
   side, and no way to read past it.
2. **Count everything that was tried, not just the last step.** Every step you
   keep the best of is another go at `shopping`, and they add up. A count of
   tries has to carry forward through the whole **Funnel**.

## What it needs from the other parts

Part 6, and this is a genuine problem with the part as written. Whatever number
counts as "clearly above" has to be set by the owner, and a threshold typed
while both counts are on screen is a bar chosen knowing what will clear it —
exactly what Part 6 exists to stop. So the threshold has to be registered under
Part 6 before the counts are visible, or this part is a speed bump rather than a
gate and should be argued for on that basis.

## What I am assuming

- **That the tries are independent.** They are not. Settings share dials, coins
  and stretches, and the code already says so about the survivors. A raw count
  of tries fed into a luck figure that assumes independence overstates the luck.
  What is wanted is an effective count, or a bound, not a raw one.
- **That the count of tries is knowable across the whole Funnel.** Each step
  knows what it started with, but nothing carries that from one step to the
  next today, so it would have to be added.

## What it costs

Small once the blocker is answered: carrying a running count from step to step,
and one refusal.

---

# Part 6 — write down the claim before the stretch is opened

> **Blocker.** Everything in this part rests on the claim being written at the
> same moment the look is counted. Today a look is not an event — the count is
> worked out afterwards from the steps the **Funnel** stored. So making a look
> into a thing that happens, and can carry a claim, is the first piece of work,
> not a detail.

## The problem

**The claim is written after the answer is known.** Which figure, which
comparison, what bar — all of it can be settled once the numbers are visible.
No single choice is dishonest. Together they mean the bar was chosen knowing
what would clear it, and such a bar is not evidence.

**The thing judged is not the thing traded.** A figure averaged across two
hundred survivors describes holding all two hundred at once, which nobody is
going to do. If one of them goes live, the average said nothing about it.

## The change

Before the held-back stretch is opened, the system records:

- which setting, or which named group of settings, is claimed
- which figure decides it
- which comparison it must beat
- what the bar is
- how many settings were tried to get here

**The claim written before the stretch was opened is the one that is judged.**
A later one is written beside it, marked as written after the fact, and cannot
replace it. Both stay visible.

And what is judged is what is traded. One setting going live is named up front
and judged alone. A group traded together is judged on the money the group would
have made, not on the average of the settings in it.

## What it needs from the other parts

Part 5 depends on this. Part 1 raises the unanswered question of whether each
judging stretch is a look, which this part has to answer.

## What I am assuming

- **That you are usually claiming one setting or a named group.** The case in
  front of us is not that — it is two hundred survivors chosen after the fact,
  and this part as written does not cover it. Either a bar for
  choosing-after-the-fact gets designed here, or this part is honestly labelled
  as being for a future way of working and the current way stays uncovered. I
  have not designed that bar and it is the largest hole in this document.
- **That recording the claim is quick to use.** If it is a form to fill in
  before every look it will be resented and worked around. It should be filled
  in from what the **Funnel** already knows, with the owner confirming.

## What it costs

Not small, because of the blocker. Making a look an event that happens, rather
than a number worked out afterwards, is the real work. Less than the first draft
implied, though: **Verify already prints `Rules declared before the numbers:`**,
so the place to hang a claim exists and what is missing is the binding of it to
the moment of looking. Attaching a claim to it
after that is easy.

---

# Part 7 — what the settings you threw away did on held

> **BUILT AND DEPLOYED, 3.100.0.** `Read what the rule dropped` is on
> **Verify**, with the how-many box and both sides in one table. Nothing below
> is outstanding except the question of whether it should ever gate, which is
> Part 5's and still blocked.
>
> **The cheapest thing in this document, and it needs nothing else built
> first.** No retraining, no extra passes, no new arithmetic. Every figure it
> reads is already sitting in the record set.

## The problem

For the set this document was written after, the **Funnel** kept 199 settings
out of 2,752. All 199 were positive on the held-back stretch, against about 32
expected to clear their own bar by chance. That reads as overwhelming evidence.

It is only evidence if the 2,553 that were thrown away did worse. Nobody has
ever asked. If nearly all 2,752 were positive on that stretch, then 199 of 199
says the stretch rose. It says nothing whatever about the picking, and the 199
are just the top of a pile that was all doing well.

This is general. Any count of `survivors` that clear a bar is unreadable without
the same count for what did not survive.

## The change

One block on Verify, behind its own press, information only.

The sharpest form is a single comparison:

- of all 2,752 settings, how many were positive on held
- of the 199 `survivors`, how many were positive on held

Beside it, the same two counts against the best of the four comparisons rather
than against zero, since Part 2 makes that the bar that matters.

If the two shares are close, the picking added nothing. If the `survivors` pull
clearly ahead, that is the first direct evidence that the choosing does
something.

## What gets ADDED to Verify

**Controls.** One press. A box for how many of the non-kept settings to read,
with all of them as a legal value, since reading them is cheap.

**Results.** Two rows, kept and not kept, each with the count of settings, how
many were positive on held, how many beat the best of the four, and the average.
Under them one line saying how far apart the two rows are.

## What gets REMOVED

Nothing.

## What it needs from the other parts

Part 2, for the "beat the best of the four" column to mean anything. And it runs
into Part 5's unresolved question — whether a result this damning should refuse
the set rather than merely print. Build it printing. Decide gating when Part 5's
blocker is answered.

## What I am assuming

- **That every setting has its held figures stored, not just the `survivors`.**
  The stage 3 pricing computes held money and all four comparisons per setting,
  so this should hold. Whether all 2,752 of this set's settings actually carry
  them is a read of the record set away and should be checked before building.
- **That reading them is affordable.** It is a read of stored rows, no pricing,
  so it should be fast. Unmeasured on a set this size.
- **That comparing two averages is the right reading.** Where the `survivors`
  sit inside the whole spread may say more than the gap between two averages. I
  would show both.

## The risk, and it is real

This is a read of the held-back stretch, so it must sit behind a counted press
like everything else that touches it. It cannot change a choosing that has
already happened. It can change the NEXT one, if the answer sends you back to
walk the **Funnel** again knowing it. No screen can prevent that, and it is the
owner's to weigh.

---

# Part 8 — judge the thing you would trade, not the average of everything kept

> **Owner, 2026-09-11, on reading a FAIL:** "when 18 actual settings selections
> within a rule pass ALL 5 and then you mark it FAIL?!? — get real! we need to
> keep that code and make the pass/fail rational."
>
> **THIS IS DONE BEFORE PART 1 IS FINISHED**, because Part 1 carries the same
> fault in its own scoring, and because it changes a number that is on the
> owner's screen today.

## The problem

**The verdict decides PASS or FAIL on the average of every setting the rule
kept.** Two lines of `lib/funnelverify.js` do it:

```
const real = mean(...)                              // the mean over ALL survivors
pass: comparisons.known && positive && comparisons.beatsBest === true
```

On the owner's own set, read 2026-09-11: **98 of 98 survivors made money on the
held stretch, 18 of 98 beat all four comparisons — and the set reads FAIL**,
because the average of the 98 does not clear.

Two faults, stacked:

**One: it judges a basket nobody will ever hold.** A figure averaged across 98
settings describes buying all 98 at once in equal size. Nobody is going to do
that. One setting goes live, or a named handful does. Part 6 already says this
in as many words — "the thing judged is not the thing traded" — and nobody
connected it to the gate that prints FAIL.

**Two: the bar is picked after the fact.** `beatsBest` is the maximum of the
four comparisons. Knowing in advance which of being long every period, being
short every period, buying the coin and going away or shorting it and going
away is the one to be on IS a forecast, and the hardest one. Beating each of
the four on its own is a claim somebody could have made beforehand; beating the
best of them is not. (Owner's correction, 2026-09-11: "there were 4 'no
forecast' set-ups ... picking the right one in advance IS a forecast".)

**And Part 1 repeats the first fault.** Its own results line says "cleared on
how many of the passes", which is a sentence about the set rather than about
anything tradeable. "The set cleared 4 of 5" means nothing. "18 settings cleared
all 3 passes, here they are" means something.

## The change

1. **Count per setting, never the average.** How many survivors made money, how
   many beat each of the four, how many beat all four — with the settings that
   did so named, not just counted.
2. **The gate is about a tradeable thing.** A set passes when at least one
   survivor clears every bar on its own, and the screen says which. Whether a
   named setting or a named group is the claim is Part 6's business; until Part
   6 exists, "at least one clears everything, and here it is" is the honest
   version and it is a far better gate than the average.
3. **The average stays on the screen, labelled as what it is** — what holding
   every survivor in equal size would have made. It is a real number for a
   question somebody might ask; it is not the verdict.
4. **The four are reported separately, and the best-of-four is marked as the
   hindsight reading it is.** Both are worth printing. Only one of them is a
   bar a person could have aimed at.
5. **Part 1's five-pass block follows the same rule**: a row per pass, and the
   summary counts SETTINGS that cleared every pass, never passes that the set
   cleared. **Part 1 applies this itself and does not wait for the rest of
   Part 8** — the rule costs nothing to obey when the block is written for the
   first time.

## What gets REMOVED

Nothing. The one-off reading of the held stretch stays exactly as it is — it is
the one reading on the real held stretch, it is what History's reserve grade is
keyed to, and the owner has said plainly to keep it. What changes is the
sentence the verdict draws from it.

## What it needs from the other parts

Part 6 would say WHICH setting or group is claimed, which is the fully honest
version of point 2. This part does not wait for it: "at least one survivor
clears everything on its own" is already a stricter and more meaningful gate
than the average, and it can ship first.

## What I am assuming

- **That at least one clearing survivor is the right default gate.** It is the
  weakest honest claim, and on a set of a hundred it will pass often. It is an
  improvement on the average because it is about something real, not because it
  is harder. If the owner wants a harder one — a minimum count, or a share — it
  is a number they set, and under Part 6 it should be set before the counts are
  visible.
- **That naming the clearing settings does not become a shopping list.** It
  might. A list of the settings that cleared, read after the held stretch is
  open, is the held stretch being shopped — which the screen already warns
  about for its own table. The same warning belongs here.

## What it costs

**Small, and smaller than it looks.** Every number this needs is already worked
out per setting: V4 already reads every survivor against its own copies and is
already information-only, and the four comparisons are already stored per hold
length. Nothing new is measured. What changes is which numbers the verdict
sentence is built from — reporting, not arithmetic.

---

