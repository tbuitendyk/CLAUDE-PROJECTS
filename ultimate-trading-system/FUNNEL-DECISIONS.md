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
75. **There is no `always` gate** (3.44.0, owner order 2026-09-02: "strip
    always entirely"). It placed both price levels every day whatever the
    forecast said, read the vote once and never used it. As a third of every
    board it pulled the real money and the shuffled money together on every
    dial, and its own shuffle comparisons could only tie. Measured before the
    change: with it left out, DOGEUSDT daily-1d's money went negative on every
    dial (it had been carrying the coin's own rise into every average), and
    on BCHUSDT daily-4d a cluster of values rose to 8 and 9 of 10. The gate
    list is `active` and `directional`; a set priced with `always` is brought
    up to date the first time it is opened (STAGES-DECISIONS.md).
76. **The bar is the owner's, and what it buys is printed beside it** (3.45.0,
    owner order 2026-09-02). "Beats every copy" was never a high bar for one
    value -- 9% of forecast-free values clear it -- and lowering it to five of
    ten would bold half the screen. So the bar is a control, default eight of
    ten, with the chance rate beside it and the board's honesty line on step
    1; and step 2 prints how far ahead each value sits, not only how often.
    The cut writes the bar on the set. FUNNEL-DESIGN.md §18.
77. **The bar is a share of the copies, resolved to a count per set**
    (3.50.0, owner order 2026-09-04: "make the box a percentage of the null
    tables beat"). #76's default of eight was a count written for sets that
    kept ten copies; on S3 #2, which kept twenty, it silently meant eight of
    twenty, and the page said 62% of forecast-free values would clear it. The
    owner had asked, before the twenty-copy set existed, whether the box
    would "default to 16 or what" -- it did not. The box is now a percentage,
    default 80, worked out as a count on each set and rounded up (80% of 20
    is 16, of 19 is 16, of 3 is 3), with the count and the chance printed
    beside it; a count handed in under the old name is ignored, never read as
    a share, and a walk saved in the browser under the old count drops it
    for the default. The Stage 4 set records both the share and the count.
    Found while sweeping every use: the across was kept per rule only, so
    the same rule asked again under another bar was answered from the old
    reading; it is keyed on the bar now, on the box and on the page. No
    Stage 4 set exists on the box, so nothing on disk is migrated. Second
    digit: the control's meaning changed and the record gained a field.
78. **The bar and the target stay where they are left, for the whole set**
    (3.50.1, owner order 2026-09-04: "i put it on 75% and every single
    selection you set it back to 80%"). A walk is saved per coin and shape,
    so switching units loaded a walk that had never seen the bar and fell
    back to the default, and every unit was read twice. Both are remembered
    once per set; a unit's walk takes them from there. Third digit.
79. **Step 2 keeps its dial box, and a count is not a list** (3.51.1, owner
    report 2026-09-04: "it's like the interface is broken and was never
    tested"). Two faults, both met on XRP after keeping gate = directional.
    A reason on step 2 ("only one value ... was swept" -- wrong too: the rule
    had fixed it) replaced the whole step, dial box included, so the next
    dial could only be reached by going back. Then `narrow this one` on t
    did nothing: a range recommendation carried its count under `values`,
    the page took it for a list, the draw threw before it painted, and the
    page stayed on step 1 in silence. The reason now says what is true and
    what to do; step 2 always draws its box; the count is `n`; the page takes
    a list only from a list. Neither fault could be seen by the tests, which
    read the source and never pressed anything. tests/ui-funnel.js now
    drives the Funnel in a browser with the box's own answer for t (kept as
    a fixture) and presses the buttons the owner pressed; it is run by hand
    (`npm run test:ui:funnel`) because it needs a browser. Third digit.

80. **A dial carries its Sweep name everywhere the Funnel shows it** (3.52.0,
    owner order 2026-09-04: "you must give me the actual FULL NAMES OF THESE
    DIALS IN ALL OF THE CONTROLS ... you've neglected to add to ALL OF THE
    DROP DOWNS AND INTERFACES IN THE FUNNEL"). The step 1 table named a dial
    with its Sweep label in brackets (#71) and nothing else did: the `dial`
    box on step 2, `first dial` and `second dial` on step 3, the rule
    sentence at the top and the notes the walk keeps all printed the bare
    key, so the owner read `dMult` in one place and `dMult (d)` in another
    and had to guess they were one thing. Now one helper names a dial, the
    dial boxes draw the engine's list through it (RULE FIVE: the list is
    still the engine's), the rule sentence is read through it before it is
    shown, and every note and mark uses it. A key that is its own Sweep
    label (gate, entry, decision) is written once, never "gate (gate)".
    Pressed in the browser harness. Ships inside 3.52.0.
81. **Step 3 says how to walk it, and the owner's block is green** (3.52.1,
    owner order 2026-09-04: "you need to have plain steps to walk this step
    3 ... MAKE THE USER SELECTED BLOCK SHADED LIGHT GREEN ... make the text
    area 'Your block: ...' BOLD DARK GREEN so it's obvious what's going on").
    The step drew its controls and a one-line note and left the owner to
    guess what `read the grid` was for and how a block of their own is
    chosen. Now seven numbered steps sit above the controls, before the grid
    is read and after, each naming the control as it is drawn and saying
    what pressing it does: the two dial boxes, `thin below` (a box holding
    fewer settings than the number is greyed out with its count in brackets
    and can never be bold or part of a block), `read the grid` (builds the
    grid; a dial box re-reads by itself, a new thin below number needs the
    button), `keep this block` for the outlined block, and the two clicks
    that make a block of the owner's own. The boxes of that block are shaded
    green and the line saying which values it covers is bold in dark green,
    in both themes. Third digit: wording and colour.
82. **A range can keep the settings that have no value for the dial**
    (3.53.0, owner order 2026-09-04: "with step 2 - the shape of a dial with
    dMult selected, how can the range 0.5-none be selected (i.e., everything
    except 0.25)?"). It could not. The rule has held "or none" since the cut
    was built (`also: ['none']` on a range, printed "or none" in the
    sentence), and no control on step 2 set it, so a range on d silently
    dropped every market setting, which carries no d. A RULE FIVE fault. Now
    a tick, `also keep none`, sits beside `to` whenever the table has a none
    row; it is written into the rule as "or none", the count beside the
    button follows it, and the walk's note says it. Pressed in the browser
    harness: the tick appears for d and not for t, the count moves, and the
    rule the page sends carries it. Second digit: a new control.
83. **Step 3 shows the average scrambled average beside the highest**
    (3.54.0, owner order 2026-09-04: "what i want is a second check box,
    after the highest scrambled average check box. exact same formatting but
    it should show 'average scrambled average check box'"). The one check
    grid printed, per square, the best of the scrambled copies: what the
    square would have to beat to beat all of them, a harsher yardstick than
    the bar bold is decided at, so a bold square could sit below the number
    beside it. A second grid now follows it, drawn through the same table
    helper on the same squares, with the average of the copies' averages.
    Read together: the highest says how far chance reached at its best, the
    average says where chance sits. Neither is the bar; the bar is a count,
    and the square is bold on that count. Drawn only when there are copies;
    with the two halves there is nothing to average. Pressed in the browser
    harness on a canned grid with two copies. Second digit: a new element.
84. **read the other units shows what it read; every clause has its own
    remove; the step 3 tables line up** (3.55.0, owner, 2026-09-04: "looks
    like the 'read the other units' button doesn't do anything"; "fix the
    rule so that the irrelevant bit about false on 24/5 is entirely removed
    so that it's not used on the daily units"; "line up those two check
    tables and draw the cell boundaries"). Three things. (1) Since 3.50.0 a
    reading of the other units is kept under the rule AND the bar (#77), and
    step 4 still looked for it under the rule alone, so the reading ran on
    the box and the page never showed it: the button read as dead. The test
    written for #77 pinned every other place and missed these two lines;
    both are pinned now. (2) A clause on a dial that has one value on the
    unit the walk is on could not be taken out: step 2 offers its boxes only
    for a dial with two or more values there, and after the fold 24/5 has
    one on a weekly unit, so "weekdaysOnly is false" -- a way round the
    doubled records that the fold made pointless -- sat in the rule and
    halved every daily unit it was applied to. Under The rule so far each
    clause is now listed with its own `remove`, recorded in the walk's notes
    like every other change; removing that clause leaves the daily units
    with both values of 24/5. (3) The grid and its two check tables are
    drawn with fixed, equal columns on one width and every cell bounded, so
    a square sits under the same square in all three. Second digit: a new
    control and a fix.
85. **A tie between blocks is broken by the check, what each block is worth
    is printed beside it, and every square says how many copies it beats**
    (3.56.0, owner order 2026-09-04: "OK on your three items"). (1) Two
    rectangles of bold squares of the same size were settled by whichever
    the loops met first, which is an accident of the order the dials'
    values happen to be in. The one whose squares sit further ahead of
    their scrambled copies wins now -- the lead, averaged over the
    rectangle -- and a bigger rectangle still beats a smaller one whatever
    the leads say. Money is read nowhere in the recommendation and a test
    holds that: the recommendation comes from the check alone, which is
    what stops the walk from shopping (FUNNEL-DESIGN.md 4.5). (2) What a
    block is worth IS printed, beside the outlined block and beside the
    owner's own: its average test money weighted by the settings in each
    square, and the settings it holds. Shown, never obeyed. (3) Every
    square of the grid now carries "beats N of K" under its money, from the
    same pass that decided bold, in the words step 2 already uses -- so the
    grid, the bold, and the two check tables say one thing. Second digit.
86. **Step 6 says what its two limits are limits ON** (3.57.0, owner order
    2026-09-04: "more context is needed to set the worst losing streak
    allowed and fewest trades. how much are we trading per trade? how much
    can be on the table at once maximum? that's a context for size of loss
    that would be acceptable. fewest trades? over what time period? ... i'm
    ok with 20 trades in a year. or 5 in three months. but not 5 in a year";
    and "should i be hitting the work out the missing numbers NOW or is that
    something that is done AFTER supplying those other two fields. there's a
    serious lack of information and instructions on that step 6").
    The step offered two boxes and no way to know what either meant. A
    dollar limit means nothing without the stake; a trade count means
    nothing without the stretch of history it was counted over. Now, above
    the boxes: every trade stakes the engine's own position size, so every
    dollar figure on the walk is dollars at that stake; a coin holds one
    position at a time, so that is the most that can be on the table for one
    coin, and that times the coins of this reading if every one is in a
    trade at once; and the window the trades were counted over, by date and
    in weeks, with what a count over it comes to a year -- beside the box
    and beside every rung of the trades ladder. The window is DERIVED from
    the sealed bounds the records already carry (3.51.0) and the split the
    run used: the sealed part is the last 13% of the whole, the held-back
    part the last 15% of what is left, and the test window the 15% before
    that, stepped by the unit's own chunk length. A set whose bounds cannot
    be read says so instead of inventing a window. Five numbered steps say
    to press `work out the missing numbers` FIRST -- nothing below can be
    read until it has run, and pressing it changes no rule and no record.
    Second digit: the answer carries a new block and the step draws it.
87. **`work out the missing numbers` asks for the survivors of the rule**
    (3.57.1, owner report 2026-09-04: pressing it answered "failed -- nothing
    changed. nothing was asked for"). The press sent an empty list of setting
    names, and the service refuses an empty ask, so the button had never once
    worked -- and step 6 cannot be walked at all until it does, because both
    its limits are read off numbers only it produces. Two tests covered this
    step and neither pressed the button; the browser harness now does. The
    press names the RULE, the unit and the bar, the same three things every
    other read on the walk sends, and the survivors are worked out in the
    service through `applyRule` -- the one function that applies a rule -- so
    what is rebuilt is exactly what the count at the top of the walk is
    counting. A rule that keeps nothing says so in those words; a set whose
    tables are still being worked out says that instead of failing. Third
    digit: a fix.

    And the same release corrected what 3.57.0 had just put on that screen
    (owner, same day: "'A coin holds one position at a time, so $100 is the
    most that can be on the table for one coin' ... which is of course not
    true. in the case of the weekly shape it's true"). Right: a unit opens a
    position at the start of a chunk and holds it for the hold, so positions
    OVERLAP whenever the hold outruns the gap between starts. A weekly shape
    steps 168 hours and holds at most 161, so it does hold one at a time --
    which is why the wrong sentence looked right on the unit being read. A
    daily shape steps 24, so a 137-hour hold leaves six open at once, six
    stakes on that coin. The most on the table is now worked out per unit
    from the unit's own step and the longest hold the rule still allows, and
    added up over the units of the reading; the screen says it per unit,
    because a weekly unit and a daily one differ by six times.
88. **The rebuild checks itself against what the sweep stored** (3.57.2,
    owner question 2026-09-04: what does "done for 192 setting(s) - NOT
    checked against the sweep (the caller supplied nothing to check against)"
    mean). It meant the work was done and the safety check on it was not.
    Every rebuilt setting has its average test money re-worked, and comparing
    that against the money the sweep stored is what says the two runs are the
    same world -- different price data or a changed engine shows up there and
    nowhere else. The comparison only ever ran when the CALLER supplied the
    stored figures, and the page holds none, so it never ran once. The
    service holds them: the board rows it already reads to work out who the
    survivors are carry each setting's stored money, so they travel back with
    the names and the route uses them unless the caller sent its own. An
    unchecked rebuild is now only what it always claimed to be -- one with
    genuinely nothing to check against -- and it still says so rather than
    looking checked. Third digit: a fix.
89. **The proof compares the figure the board actually holds, and counts what
    it found** (3.57.3, owner report 2026-09-04: "20 setting(s) came back
    different from what the sweep stored - this is not the same run"). It was
    the same run, and both faults were in the check 3.57.2 had just added.
    First: on a unit's board the stored money is THAT UNIT'S, while the
    rebuild's own figure is the average over every unit of the set -- read off
    the box, 120,291 of 137,760 settings differ between the two, so the
    comparison could only ever disagree. The route now names the board the
    figures were read on and the proof takes that unit's own rebuilt money,
    which the rebuild already keeps; on `all units together` it takes the
    average, which is right there and nowhere else. A setting the rebuild
    priced on other units but not this one is counted and said, never treated
    as a disagreement. Second: the list of disagreements stops at 20 and the
    screen printed its length, so "20 setting(s)" meant "at least 20" -- the
    true count travels now and the screen reads "N of M setting(s) came back
    different". Third digit: a fix to a fix.
90. **The Funnel shows the Stage 4 record sets of the coin and shape on
    screen** (3.58.0, owner order 2026-09-04: "for the given selected coin and
    shape at the top of Funnel ... there's an option to view the one or more
    Stage 4 record sets that have been generated"). Cutting a set used to be
    the last thing that happened to it: it was written, it was listed on other
    screens, and the Funnel went straight back to step 1 as though nothing had
    been decided. Now a coin and shape with nothing cut from it opens on the
    seven steps exactly as before, and one with sets cut from it opens on the
    newest of them: the rule-building heading is replaced by a drop-down of
    those sets plus `new rule`, the step buttons and the rule box are gone, and
    the heading becomes the record of that set - its rule, its target size, the
    bar it was read under, its scrambled copies, its sealed window, the closing
    it ended on, how many choices and how many steps back the walk took, and
    every mark. Underneath it, the settings it kept, one row each, sortable and
    paged.

    Six decisions inside it:

    * **The sets travel on the Funnel read**, matched on the parent AND the
      unit. One read, one truth about which sets belong to the board on screen.
      A set cut on one coin and shape is never offered on another.
    * **Membership comes from the RECORD, never from re-applying the rule.** A
      set is a decision, not a query: re-deriving it would show today's answer
      under yesterday's name. The rule IS re-applied once and the answer
      REPORTED - a set whose rule no longer reproduces its own survivors says
      so on the screen, and a survivor no longer on the board is shown marked
      rather than dropped.
    * **The numbers are the same board the walk read** - the unit's records
      with the rebuilt numbers laid on. The figures on this screen and the
      figures the rule was built on cannot be two readings.
    * **A dial the rule pinned gets no column.** It is the same on every row,
      so it is said once above the table. Only dials that still vary get one.
    * **The held-back money IS on the table**, and the screen says what reading
      down it costs. The mock-up's line "Every money figure on this screen is
      test money" would have been FALSE with that column there, so it was
      replaced by one that names which column is which and says that sorting by
      the held-back one and taking the best is shopping the single look the
      whole design protects. The alternative - leaving the column off - would
      have been me curating what the owner may see, which RULE FIVE forbids,
      and Verify, History, Tune and Greenlight all start from it.
    * **The drop-down is on BOTH headings.** Put on the Stage 4 heading alone it
      made the walk a one-way door: `new rule` chosen, and no control left on
      screen to get back to a set already cut. Writing a set now leaves the walk
      on screen too, or pressing a step button straight after a cut would have
      left it.
    * **Nothing on the screen writes except the rename**, and a test counts the
      writes so it stays that way.

    Two things found while building it and NOT built: the four benchmark
    comparisons a record carries (against holding the coin long, holding it
    short, always long, always short) and the test-window trade count are on
    the records and are not carried onto the board, so they cannot be shown
    here without growing every board read; and step 6's `fewest trades` limits
    on HELD-BACK trades while the sentence above it describes the test window.
    Both are reported to the owner, neither is touched. Second digit: new
    behaviour and three new controls.
