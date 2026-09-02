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

## Step 2 — the sealed window and the board-noise stamp

6. **The sealed window needed no migration and no new stored field.** The design
   said stage 3 must stamp it and a migration must backfill it. Both were wrong:
   stage 1 already writes `reserve` on every record and stage 2 copies it
   forward, and a stage 3 set's units ARE its parent's records. Verified against
   a real record on this box — `s1-mtdzekjr-9` carries
   `{"chunks":50,"fromTs":1780790400000}`. It is a read.
7. **It resolves through `stage3UnitsFor` with the set's own stored carry**,
   which is the same resolver and the same argument the launch used — so it
   cannot return a different set of units than the ones that were priced. A
   re-derivation from `unitChunks` would agree only while the price files have
   not moved.
8. **A partly sealed set is not sealed.** One unit without a reserve means the
   one-touch grade covers fewer coins than the board, so the verdict is false
   and names the count rather than reporting a seal with a footnote.
9. **The board-noise stamp's wording carries no era.** "Predates X" would tell a
   reader there are two kinds of set, which is the same defect wearing a
   sentence. One wording that is true of a set written today and one written in
   July, and a test that fails on date-flavoured words.
10. **The stamp refuses while a stage job is going** rather than writing beside a
    running writer, and says it refused rather than reporting nothing to do.
11. **The pure parts are split out** (`sealedFromUnits`, `needsBoardNullStamp`)
    so the verdicts are testable without writing anything into the owner's
    record store.

## Step 3a — every trade settles through one book

12. **One settle point, not seven.** The money was accumulated at seven separate
    sites — six in `simBracket`'s rail walk and time exit, one in `simMarket`.
    Each new number would have had to be added at all seven with nothing to
    catch the one that was missed, which is precisely how the numbers went
    missing in the first place. A test pins the count at seven and forbids any
    bare `pnl +=` outside the book.
13. **Three of those seven never counted a win.** Correct — a both-rails bar is
    priced at its worst case and that is always a loss — but correct by
    arithmetic nobody had written down. Routing them through the book makes it a
    rule instead of a coincidence, and changes no number.
14. **Drawdown is measured from zero, not from the first trade.** The book starts
    flat. A run that opens with a £7 loss is £7 down, not level.
15. **Nothing traded is not zero-everything.** `worstTrade` and `bestTrade` come
    back `null` when no trade happened, because a worst trade that never
    occurred must not read as a break-even one.
16. **The thirds are cut on the PERIOD index, not the trade index.** A window
    whose money all arrived in its first month has to read that way; cutting by
    trade would spread them evenly and destroy the one reading a single-coin
    probe depends on.
17. **The pricing returns everything on ONE path and `storedRecordOf` decides
    what reaches disk.** The alternative — a flag that makes the pass return
    more when asked — is two code paths that can drift. Both writers now project
    through it, because a spread at either would have put the analysis block on
    5.2 million records.

## Step 5 — the funnel readings (taken before steps 3b and 4)

18. **Order changed, deliberately.** The build order put the rebuild path and the
    Stage 4 record before the readings. The readings are the part that either
    works or does not, they are pure, and they need neither — so they were built
    and proved first. RULE SIX puts ordering inside an approved step in the
    session's hands; this is it, recorded.
19. **The split is a hash of the setting's NAME, not a shuffle.** A shuffle
    splits the same set differently depending on the order the rows arrived in,
    so two reads of one set could disagree about whether a dial is stable. Seeded
    and order-independent, and a test reverses the rows to prove it.
20. **`m` is a ratio and it never travels alone.** The dollar range goes with it,
    because a ratio with no magnitude beside it cannot be read.
21. **A dial swept at one value is "unmeasurable", never "flat".** Flat is a
    finding. Nothing to compare is not. Printing them the same tells the owner a
    dial was tested when it never was.
22. **THE MARGINALS ARE ONLY HONEST ON A BALANCED GRID, and nothing was going to
    say when they were not.** The whole claim of step 1 is that grouping by one
    dial averages the others out — which holds only if every value of that dial
    was swept against the same spread of everything else. A carry cut, a fold or
    a failed unit breaks that, and a confounded marginal looks exactly like a
    real one. `balanceOf` reports it and step 1 names the lopsided dials. Found
    by attacking the reading, not by it going wrong.
23. **A value far clear of a flat menu is a spike wherever it sits**, including
    at the end of the axis. Luck does not care where on the menu it landed, and
    an end-spike read as "monotone" is a fluke wearing the word for a trend.
24. **A thin square is MARKED, never dropped.** A hole in a grid reads as
    "nothing here"; the truth is "not enough to say", and the count says which.
25. **The noise twin is `null` and explicitly present**, not omitted. A blank
    column reads as "nothing to report", which is the opposite of the truth.
26. **The source guard strips comments before scanning.** The first cut fired on
    the comment quoting bracketwork's "judge on holdout" rule — the very line
    explaining why the guard exists. A guard that cannot tell a quotation from a
    field read teaches whoever hits it to loosen it.

## Step 4 — the Stage 4 record

27. **What is preserved is the RULE, not the row.** A row picked off a board
    cannot be null-tested; a rule can, because the same rule applies to a noise
    board. That is why this is a record set with a rule on it and not a selected-
    row flag — and why the broken selection path is being replaced rather than
    repaired.
28. **One function applies the rule, at cut time and at replay time.** Two
    applications that could drift is the whole reason a replay is worth testing,
    so there is only one.
29. **A text value on an ordered dial (`auto` band) is kept only when the rule
    names it.** Coerced to NaN it would silently drop every setting on that arm,
    and a whole arm going missing is invisible on a count.
30. **A floor refuses a number that is not there.** Treating a missing drawdown
    as zero would let exactly the rows nobody has measured through the one step
    that exists to cut on measurement.
31. **Going back is recorded.** A funnel walked forward once and one walked back
    four times have seen different amounts of the board; only one of them admits
    it, and the reserve grade can only count what was written down.
32. **All three closings are offered and the costliest names itself as shopping.**
    Withholding it would remove the owner's choice invisibly.
33. **Nothing is trimmed on its own.** Overshooting the target is a warning, not
    an automatic cut — the target is a guide from step 1, never a knife.

## Step 3b — the rebuild

34. **THE PROOF IS KEYED BY LABEL, NOT BY SETTING INDEX**, and getting that wrong
    is the worst bug this build could have shipped. `si` comes back per BLOCK —
    the worker numbers the settings it was handed from zero — so a proof keyed by
    it would line setting 0 of the rebuild up with setting 0 of the whole board.
    Every one would "match", not one of them would be the same setting, and the
    output would read as a clean proof. Caught by writing the smoke test before
    believing the code. A test now pins the failure shape.
35. **A setting the proof could not check is COUNTED**, not skipped. "Checked 3
    of 40" and "checked 40 of 40" are different claims and must not print alike.
36. **An unproved rebuild is allowed and must never look proved.** `ran: false`
    with a reason, so the tab can say there was no proof rather than showing a
    blank where a tick would go.
37. **It refuses while a stage job is going** — a rebuild reads the same units a
    run does, so it waits rather than competing for them. `stageRunning()`, not
    `launchRefusal()`: that one lives in batch.js and my first cut called it
    from a file that has never had it.

## Step 6a — the server contract

38. **ONE read route, not one per step.** A route per step would apply the rule
    in several places, and the survivor count the owner reads on step 2 and the
    one the cut writes would be free to become two different numbers.
39. **The cut checks its own replay BEFORE saving**, rather than asserting it in
    a test and hoping in production. A set whose rule does not reproduce its own
    survivors is a story about a decision, not the decision, and it refuses.
40. **The proof travels with the rebuild's answer**, not as something the screen
    can forget to ask for.
41. **Stage 4 docs carry `seq` and `status`.** Found by reading `listSets`:
    `seqFor` counts the highest `seq` it finds, so a set without one leaves it
    stuck at 1 and every Funnel set after the first would be minted "#1" — two
    records with one name.
42. **A read with no tally answers the way the tables do**, so the screen starts
    a totalling rather than reporting an empty board.

## Step 6b — the tab

43. **The set comes from Boards' own state (`bView().s3`), not a key of this
    tab's own.** My first cut invented `cx-set3`. Two places remembering which
    set is open is how the owner ends up reading one set's numbers under
    another set's name — the RULE ONE failure, in code rather than prose.
44. **The dial list and the closing list come from the shared vocabulary**,
    generated from `funnel.ALL_DIALS`. A list typed into the page can quietly
    disagree with the record, and then a dial the owner cannot pick is a dial
    they cannot know exists (RULE FIVE).
45. **The step dispatcher was inlined into the renderer.** A helper that draws
    nothing itself is a dead end to the screen reader, and correctly so — the
    alternative drags pure arithmetic onto word lists. `fBody` drew nothing, so
    fifteen controls were described on the Help tab and, to every check, on no
    screen at all.
46. **Nothing on this tab shows held-back money.** Not a preference: showing it
    during the walk re-opens the exact hole the design closes.

## Two traps worth naming, both hit while building the tab

47. **`$` in a `String.replace` replacement is a pattern, not a character.**
    A replacement containing `avg test $` followed by a quote re-inserted the
    whole rest of the file. Every scripted edit now uses a replacer function.
48. **Two NUL bytes reached `lib/funnel.js`** as the separator in a grid-square
    key. The code worked — the same character wrote the key and read it back —
    and every test passed. What broke was everything that reads source AS TEXT:
    grep called the file binary, and the word list generator and every
    source-scanning guard read source. A file they cannot read is a file whose
    controls silently stop being checked. `noSourceFileCarriesAControlCharacter`
    now walks every source file in the project.

## Step 6c — the tab is written the way every other screen is

49. **THE TAB'S MARKUP WAS INVISIBLE TO THE WORD LIST, and that is the whole
    point of the word list.** The first cut built its HTML by concatenating
    single-quoted strings. Every other screen on the page uses template
    literals, and the generator reads HTML TEMPLATES — so the generated list
    came back saying the Funnel has ZERO controls when it has seventeen. The
    suite went green either way: the both-ways check reads through the same
    reader, so neither direction could see the hole, exactly as RULE ONE-A's own
    history describes. A list with holes is worse than no list, because the rule
    makes the list the authority. Rewritten in the page's own style, which is
    also what RULE FOUR asks for: match the pattern, do not add a second
    convention beside it.

## Step 7 — the closing choices are wired (3.38.0, 2026-09-01)

50. **The closing reaches the rule now, not just the record.** `how to reach
    the target` was read at cut time, written onto the set, and dropped before
    the arithmetic: `take the top N by a column (this is shopping)` and
    `tighten the ranges toward the middle` both produced what `accept what the
    rule gives` produced. One function, `ruleWithClosing`, turns a closing into
    a rule, and both the read and the cut call it, so the count on screen and
    the count in the written set come from the same arithmetic.
51. **The cut is part of the rule, not a trim afterwards.** That is what lets a
    scrambled copy be handed the same rule and take its own top N — the
    comparison the tab exists for. It also means the set's replay check covers
    the cut.
52. **Only `avg test $` may be shopped by** (owner order, 2026-09-01: "restrict
    it to columns the null copy has"). A scrambled copy is the real table with
    its money swapped; every other column on it is still the real one, so
    taking the top N by one of those sorts the copy by real numbers and hands
    back the same rows. Held-back money is excluded on purpose — sorting by it
    at the cut opens the sealed window to decide what to keep. The list on the
    screen is read from `TOP_COLUMNS`, never typed beside it.
53. **A scrambled copy is built from every setting, then filtered.** It was
    built from the rows the rule had already kept — rows chosen on real money —
    so the copy was asked only what the real table's picks made by luck. With a
    cut in the rule that compares the best N against the same N. `nullCopy`
    swaps the money first and applies the rule second.
54. **Tightening stops honestly.** It narrows each ranged dial inward from both
    ends, one swept value at a time, and never narrows a range below two
    values. It can land under the target (a step gives up a whole swept value)
    or stop above it, and it says which in the reply the cut returns.

## §16 — the guided walk is built (3.39.0, 2026-09-02)

55. **The four open questions were answered by the session, not the owner, to
    keep the build moving, and each is a one-line change if they choose
    otherwise.** (1) Coin exclusion at step 4 is NOT built — a coin is a unit,
    not a dial, and a new kind of clause needs the Stage 4 readers to honour
    it. (2) The block on step 3 replaces what the rule held for both dials.
    (3) Marks are recorded silently when the walk moves past a step with the
    condition present, and when a step's own control is used; step 4 has an
    explicit accept because acceptance IS the decision there. (4) A value or
    square counts only if it beats EVERY kept copy; K is printed.
56. **The scrambled copy the readings use is the survivors with their money
    swapped, not every setting filtered again.** Before step 7 the rule carries
    no cut, and ranges, allowed values and the rebuilt-number limits never read
    the money, so the two constructions land on the same rows — proved in
    `theFunnelReadBuildsItsScrambledCopiesFromEverySettingNotTheSurvivors`,
    which also proves they differ once a cut is present. The read keeps ONE
    line that chooses: `nullCopy(all, rule, d)` under a cut, `swapMoney(rows,
    d)` otherwise. Ten copies of 524,832 settings on every redraw was the cost
    of doing it the other way.
57. **The rebuilt numbers are kept in a sidecar beside the set** —
    `<id>.funnelrich.json`, keyed by setting label, one number per setting
    averaged across its units. They used to leave with the rebuild's reply and
    nothing held them, so a limit on `worst losing streak allowed` refused
    every row: no row carried one. That is the fourth defect found this round.
    Stage 3 still does not grow (ruling 4); the sidecar is derived and is
    rebuilt by pressing the button again, never migrated (RULE NINE). The same
    numbers make the thirds axis on step 4 real for the first time.
58. **With the halves as the check, step 1 greys nothing.** A dial counts under
    scrambles when it beats every copy; the halves' check at step 1 is the
    agreement of the two orderings, which the page already prints. Greying on
    "in the top three of both halves" would have been a threshold nobody chose.
59. **The count line on step 2 is worked out on the page from the table it
    sits under** — the settings each value carries, summed inside the boxes'
    range — so it follows the boxes as they are typed without a round trip.
    It is exact for a range on one dial over the current survivors, which is
    what the step is.
60. **The word is gone from every rendered string in `public/construct.js`**
    (owner: "burn that into your behavior"). The documents' older sections and
    the code names in tests still carry it; that purge waits for the owner's
    tiers.

## 3.39.1 — the first test run's findings (2026-09-02)

61. **A scrambled copy is READ, never built.** 3.39.0 built ten copies of the
    survivors to draw the check, and on step 1 the survivors are the whole
    board: five million objects, two heap deaths in two minutes the first
    time the owner opened the tab. Every reading now takes a money reader and
    `moneyAt(d)` reads kept scramble d off the row. The proof that this is
    the same arithmetic as a swapped copy is a test, not a comment. Decision
    56 is superseded: `swapMoney` stays as a tested helper and the read no
    longer calls it.
62. **A top-up prices only the scrambles the records do not hold** (owner:
    "if this data is really by-byte determinate then a PROPER design would
    ADD the missing rows, not subject the user to 6 hours of waiting again").
    The task starts at `keepFrom`, the figures file holds only the added
    positions and says where it starts, and the rewrite appends after what
    each row holds. A row holding fewer than the set claimed is padded with
    blanks and counted on the set as a warning — reported, never a reason to
    stop a rewrite that keeps every row.
63. **The fill box starts on what the set keeps and asks before going above
    it**, with the cost of only the added scrambles. At that number the fill
    refuses on its own, as it always did.
64. **A poll redraw on Boards leaves the owner's place alone.** Restoring a
    remembered position on each four-second redraw is what put them back at
    the top; the redraw now holds the memory shut and moves nothing.
65. **No template literal nested inside an interpolation on a screen.** The
    word-list reader cannot see through one, and it showed the owner a bare
    `r.positive` as if it were a label. The sentence is built first.

66. **Step 1's bold is step 2's test rolled up, never movement against the
    check** (3.40.0, owner 2026-09-02: "the tool IS FAILING. why would you
    attract a view to a set-up that varies from the null set IN THE WRONG
    DIRECTION? don't justify failure"). On the first run `gate` was bold
    because the real forecast made two of its three values lose more than a
    shuffle — the piles moved apart the wrong way — and step 2 found nothing
    to keep. A dial is bold only when at least one of its values makes more
    money than that same value on every scrambled copy; the `check` column
    prints how many do. The session defended the old reading before it read
    it properly; that is recorded here so it is not done again.

67. **One rule per coin-and-shape unit — ten, not five, not one** (owner order,
    2026-09-02). The blended board destroyed the per-coin signal: XRPUSDT's
    `active` beats every scrambled copy and the blend showed nothing to keep.
    The unit's board is its records, not Table 3.B, because that table folds
    the eight decision/band variants of a setting into one row and a walk on
    it would be blind to two dials. One unit's board is held at a time. The
    blend stays reachable as `all units together` and is walked on by nobody
    by default. FUNNEL-DESIGN.md §17.
68. **Beats means beats by a cent** (3.40.1). Kept figures are cents; the real
    money is not; `always` read as beating all ten or none of ten on a
    hundred-trillionth. The tables' own `beat the kept null money` has the
    same fault and waits on a totals rebuild.
69. **The walk opens on the set's first unit** (3.41.0). Nothing chosen is the
    first unit; the blend is chosen by name, `all units together`. The read
    and the cut resolve the board through one function, so the board walked
    and the board cut cannot differ. §17.2.
70. **A unit's board row carries the blended row's measures, from the one
    record** (3.41.0): `avgVsLong`, `avgLead`, `avgRung`, `avgVoices`,
    `coinsInMoney` beside the money and the kept figures. `avgAgreed` is not
    carried -- it is joined from the agreed sidecar by the totalling, and a
    board is read from the records alone. Said here so nobody reads its
    absence as a fault.
71. **The rebuilt-numbers file moved to version 2** (3.41.0), per unit beside
    the average. An older file reads as absent and the rebuild is offered
    again -- derived, so rebuilt, never translated (RULE NINE). §17.3a.
72. **Reading the other units lays the rebuilt numbers on per unit** (3.41.0),
    because a rule with a limit on the worst losing streak would otherwise
    keep nothing on every other board and report every one as empty.
74. **The units are listed in the stage 2 table's order** (3.43.0, owner
    decision 2026-09-02). The list followed the order the units happened to
    finish pricing, reshuffled by which totalling part finished first. It is
    now the parent's stage 2 table as Boards shows it -- its saved sort, or
    forecast score with all members when none is saved -- so the first unit
    of a set is that table's top row, and re-sorting the table reorders the
    list on the next read.
73. **Reading the other units is started and polled, never one request**
    (3.41.0). Nine boards at five or six seconds each is about a minute, and
    the web server in front allows a request sixty seconds: answered in one
    reply, the first press on the owner's set would have been a gateway
    time-out. One reading at a time; the result is kept for the rule it was
    read for.
