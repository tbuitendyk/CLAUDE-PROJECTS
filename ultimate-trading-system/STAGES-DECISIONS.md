# Decision record — the working three-stage system (Sweep3 / Boards3)

Owner order, 2026-08-27: "Make Sweep3 and Boards3 ... these are the functional
versions fully backed by the new data schema and processing. for now leave the
original Sweep, Sweep2, Boards, Boards2 in place. write it. adversarial
review. deploy ... LOOP NOW!"

The loop covers exactly that body of work. The approved design is the served
Sweep2/Boards2 drawings plus the decisions the owner made while marking them
up (settings-free stage 1 ordering; null set naming; fee at stage 3; carry by
the against-null-set results; coins in the money). This file records every
non-obvious choice made while building it, one line each, committed with the
work — the owner reviews decisions in the morning, not at 3am.

## Decisions

1. **Members are trained once, with the plain fit.** Stage 1 (logreg) and
   stage 2 (boost) train each member the way today's engine trains an argmax
   member: no directional class weights, no tau. What is kept is the member's
   sureness spread per chunk. `directional` at stage 3 is a threshold on that
   kept sureness — tau tuned by the same `tuneTau` menu the engine has always
   used, from the member's stored probe votes on its validation slice, priced
   at the stage-3 fee. This differs from today's directional member, which is
   a separately-fitted model with balanced class weights. Deliberate: the
   drawing promised decision-as-arithmetic, and one member = one learned
   forecast, with decision deciding how sure is sure enough.
2. **Members train under the auto band, on 24/7 chunks, labels argmax-style.**
   Stage 3's band box re-prices the rails (d, trail, arm distances) only; the
   auto band each unit trained at is recorded on its record and is what
   `auto` means at stage 3 for that unit. Stage 3's 24/5 masks chunks (by
   start time, using the same weekday rule the engine's chunk builder
   applies) rather than retraining. Today decision/band/24-5 multiply the
   trained branches; under the stages they price, not train — that is the
   design's whole point, and it is why a unit is coin × alongside × chunk
   shape and nothing else.
3. **Votes kept = test window + held-back window sureness spreads** (4
   decimal places), plus each member's probe votes on its validation slice
   (what tau tuning reads), plus the fitted models. Learning-window votes are
   NOT kept — nothing downstream reads them. The stage 1 walkthrough given in
   chat said "learning, test and held-back alike"; the store keeps less than
   that because keeping more would serve nothing. Flagged to the owner.
4. **A stage 2 record set is self-contained**: it copies its parent's logreg
   votes, tau votes and models beside the new boost ones, so stage 3 reads
   exactly one parent. Costs a little disk, removes a class of half-present
   parents.
5. **One heavy job at a time, stage-side only.** A stage run refuses to start
   while a sweep is running or another stage run is going. The OLD launcher
   does not know about stage jobs — making it refuse would change the
   existing system's behaviour, which is outside this loop. PARKED for the
   owner: should the old Sweep also refuse while a stage job runs?
6. **lead over null set = (real − mean(null scores)) / spread(null scores)**,
   population spread; a spread of zero reads as 0, not as infinite.
7. **Deals reuse the engine's null machinery**: `nullRng`, one shuffle order
   applied to every member together (QC 81), per slice. Seed = the record
   set's own id, so a set's deals are reproducible from its name alone. Stage
   3 varies deals by slice key `hold#<n>` and shares the same deals across
   every setting in the block, so any two settings' shares are comparable.
8. **Stage 3's null-set reading mirrors today's replication reading**: the
   real arm's held-back money vs each deal's held-back money, per record;
   beat/pairs summed per coin exactly as the every-coin table does today.
9. **Set ids** are `s1-...`/`s2-...`/`s3-...` slugs; each carries a per-stage
   sequence number and shows as `S1 #7`. Stores live in the same rowstore the
   runs use (`data/batches/<id>.rows/`), set documents in `data/stagesets/`.
10. **No delete for record sets in v1.** The rails say a parent named by a
    child must refuse deletion; with no delete surface at all, nothing can be
    deleted from the interface. PARKED: a delete control with the
    parent-protection rule, when the owner wants it.
11. **Cost lines report computed counts** (units, trainings, pricing sims) and
    never promise wall-clock times. A 2,772-setting block against 1,000 units
    with 19 deals is honest arithmetic but it is ~100M bracket walks, and the
    screen says the count, not "minutes".
12. **The ranked stage 3 table aggregates per coin first**, then averages
    over coins; `coins in the money` counts coins whose own held-back average
    is positive. Averaging over units directly would let a coin with many
    units outvote the others silently.
13. **Weekly chunk shapes under a 24/5 setting**: the mask is a no-op there
    (weekly chunks always span weekends), so for weekly units the 24/5=yes
    and 24/5=no variants of a setting read identically. They stay two
    settings in the block — pricing them is honest duplication, and skipping
    one would make the block's count depend on which units are in the set.
14. **Vote alignment is asserted, never assumed**: stage 3 rebuilds chunks
    deterministically and refuses a unit whose stored vote timestamps do not
    match the rebuilt chunk start times exactly (over and above the manifest
    check at launch).
15. **Sweep3/Boards3 persist their view** (picked record set, floors, sort,
    open records) and scroll from birth, the same standing rule as every
    other page.

16. **The word-list generator now loads the dropdown choices from the served
    commit** instead of refusing whenever `lib/vocabulary.js` differs from
    it. The old refusal made every legitimate choice-list addition
    un-deployable under "suite green before deploy" — the refusal fired from
    the moment of the edit until the deploy it was blocking. Loading the
    served commit's own text closes the drift window the refusal existed to
    flag, and `--repo` still reads the working tree and says so.
17. **`generateFabricated` is exported from lib/planted.js** so the
    adversarial exam can fabricate coins with a known answer using the
    planted check's own generator.
18. **What the adversarial exam caught, and what it proved.** First run used
    the four-day chunk shape against the plant's one-day rule: the members
    flattened to the prior, every null-set deal tied the real arm, and
    strict-beat honestly read ~0/9 for BOTH coins — the instrument refusing
    to be impressed by flat votes, which is the desired failure mode (a unit
    cannot buy rank with more members or flatter votes). Recalibrated to the
    plant's own daily-1d (the same shape the planted gate trains), the chain
    reads exactly as designed: planted coin beat 9/9, lead ×6.4; fair coin
    0/9, lead −2.2; carry keeps the order; stage 2 holds 6 members per
    single; stage 3 prices both decisions from the same kept votes, every
    record carries its held-back reading and its null-set share, and every
    read path answers. tests/adversarial/stages-endtoend.js re-runs the whole
    exam on demand and cleans up after itself.
19. **Six mutation guards** prove the new rails bite: the manifest refusal,
    the pooled-mean rule, the zero-spread lead, the per-coin-first ranked
    averages, the stored-vote tie scan, and the ordering validation.

## The parked items, answered (owner, 2026-08-27: "no, yes yes")

- **No** — the old Sweep launcher stays unaware of stage runs. Left exactly
  as it was; only the stage side refuses.
- **Yes** — the delete control exists: `Delete record set…` on Boards3,
  two-step with the set's id typed back, refused by name for a set another
  set names as its parent and refused outright while any stage run is going
  (a run may be reading its parent at that moment).
- **Yes** — the stage 3 totalling is multithreaded: one fold rule
  (lib/stagework.js), sharded across the worker pool by whole blocks when a
  store is big enough, merged commutatively; a test holds the sharded answer
  equal to the single pass and a mutation guard proves the test bites.

## The campaign and the run head, shared (owner GO, 2026-08-27: "code the
## campaign interface and back-end on Sweep3 EXACTLY as per the one on Sweep
## ... the same structure at the top of Boards3 as we have with Boards")

20. **One panel, two screens — by one function, not by two copies.** The
    campaign panel is one markup function and one wiring function drawn on
    Sweep and on Sweep3; the opened run's head (the campaign note beside the
    picker, the description panel, the notes box, "What this run actually
    is") is one set of functions drawn on Boards and on Boards3. Shared code
    survives deleting the four redundant tabs and cannot drift — the same
    reason the Trade page draws its two branches from one path. The word
    list and the control reader follow named top-level helpers one level
    deep, so both screens' lists stay true.
21. **Every stage launch stamps the campaign in use at THAT launch.** A
    stage 2 or 3 launched under a different campaign than its parent carries
    its own — the same rule every sweep launch follows (batch stamps the
    current campaign at fire time).
22. **The campaign's tree, contents and delete cover record sets.** Tree
    rows ride in the same table as the runs, kind `stage N`, parent link to
    the set the launch read. The delete goes children-first (stage 3, then
    2, then 1), refuses up front while a stage run is being written, and
    REPORTS any set left behind — a foreign campaign's child naming it as
    parent — by name, rather than half-lying about what went.
23. **Record sets take notes exactly like runs**: refused while the set is
    being written, capped at the same 20,000 characters, stamped
    server-side. `POST /api/stageset/:id/notes`, `stages.setSetNotes`.
24. **The settings-copy button on Boards was NOT carried to Boards3.** The
    owner named the campaign note, the description, the notes and "What this
    run actually is"; a control that fills the Sweep3 stage boxes from a
    record set is its own design question and waits for its own order.
25. **The delete summary and preview on the campaign panel now count
    `record sets`** on both screens that draw it — the panel is shared, so
    Sweep shows the line too. A count line appears only when it is not zero.

## Saved sorts steer the carry (owner GO, 2026-08-27: "apply sort ordering
## arbitrarily to the stage 1 and stage 2 tables ... save the selected sort
## order ... the carry forward functions just pick up on the selected and
## saved sort order ... get rid of the order by on stage 2")

26. **The sort lives ON the record set, not in the browser.** Up to three
    priorities, clicked on the columns (first press high-to-low for numbers
    and A-to-Z for words, second press flips, third puts it away), saved via
    `POST /api/stageset/:id/sort` — because the next stage's carry reads it,
    it has to live where the launch can see it. Refused while the set is
    being written; a key not on the stage's closed list (lib/stages.js
    SORT_KEYS) is refused by name. Missing values sort last either way, and
    the stage's own base order breaks every remaining tie, so a saved sort
    is still a TOTAL order.
27. **The carry takes the parent's table in its saved order** — stage 2 from
    a stage 1 set, stage 3's carry forward from a stage 2 set — and the
    record set's parent line names what was used (`sortedBy`, printed in the
    chain line), "the fixed rule" / all-members score when nothing is saved.
    The end-to-end exam proves it on a real launch: lead low-to-high hands a
    carry of 1 the FAIR coin.
28. **order by is gone from the stage 2 box, and refused if an old caller
    still sends it** — a silently ignored parameter is how a declared launch
    stops meaning what its author thought. `S2_ORDERINGS` stays exported for
    exactly one deploy (the word-list generator compiles the SERVED commit's
    vocabulary, which still asks for it at load); it comes out in the
    post-deploy commit.

## The screens hold their state and show their provenance (owner GO, 2026-08-27 evening)

29. **Sweep3 remembers itself.** Every box and tick is remembered on every
    change and written back on every draw (the Sweep form's own rule); a
    launch and a settings copy remember what they set. The progress line
    carries cycles done of total, percent, time left and time in; stage 3
    narrates its long kept-votes read. The three start buttons sleep while
    any stage run is going.
30. **The section titles carry the provenance, judged live.** Stage 1's
    title is judged against the stage 1 record set the stage 2 box names;
    stage 2's against the stage 2 set the stage 3 box names; stage 3 anchors
    the chain. Green when a section shows the provenance of the section
    below it, red at the point of break, green again the moment the boxes
    are set back. The stage 1 reading needs a stage 1 set's launch settings
    on its listing row, so publicParams now carries universe, geometries,
    allLoaded and the months; a blank universe box compares through
    `defaultPairs`, served from the same list the launches read.
31. **Boards3 is three provenance-linked sections.** One per stage, pickers
    stage-filtered, each with its own Delete record set…; a stage 3 pick
    fills the stage 2 and stage 1 sections with its parents, a stage 2 pick
    fills its stage 1 parent, a parent pick puts the child selections away;
    folds are remembered, and a fresh child pick opens its whole chain. The
    description shows per section (bold); the notes box and the settings
    copy ride the DEEPEST selection — one notes box per page, because the
    shared notes controls carry literal ids the control reader and Help tab
    must see. The six new section controls carry literal ids for the same
    reason.

## The tables total themselves, and memory is part of the design (owner GO,
## 2026-08-27 night — after the first 177,408-setting totalling died out of
## memory at 15:26 and left S3 #1 stranded without its tables)

32. **A finished set whose tables are missing totals itself when opened.**
    The stage 3 table endpoints kick the totalling in the background and
    answer with its progress (parts done of total, shown with a percent on
    Boards3, asked again every few seconds); one totalling at a time, it
    waits while a run is going, a failure is recorded on the set and said
    on the screen — never retried blind — and launches and deletes refuse
    while a totalling is reading the store.
33. **Sharding is memory-gated.** Every tally lane's accumulator carries
    every setting the store holds, so sharding a 177,408-setting block
    duplicated a huge accumulator dozens of times — that is what died. The
    totalling shards only up to SHARD_SETTINGS_LIMIT (5,000 — the drawing's
    own worked example is 2,772) and runs inline above it; the tally file
    is written streaming, entry by entry, instead of stringifying the whole
    thing as a second copy at the worst moment. The run tail reports
    "totalling the tables: N of M parts" as it goes, on Sweep3's own line.
34. **Every Boards3 section carries its own settings copy.** Three literal
    controls, one per stage header, working folded or open; the notes box
    stays one per page on the deepest selection.

## The budget gate (owner GO, 2026-08-27 night: "detect ... warn, flag,
## stop, give meaningful messages ... if they select too large of a dataset")

35. **Every heavy start does its memory and disk arithmetic first.** The
    plan-first design means the deciding numbers exist before anything
    runs: the stage 3 cost line says the verdict as you set the block
    (plain when it fits, a warning when tight, "start stage 3 will refuse:
    …" in red when it cannot fit), the launch refuses over-budget blocks
    with the same words, the totalling and its rebuild refuse the same way
    (recorded on the set and said on the screen), and the cost line and the
    refusal share ONE arithmetic served by the engine. The heap model is
    calibrated on the 177,408 × 17 block (reads "tight"); the disk figure
    is held against a real store by a test. Stage 1's disk gate is PARKED:
    its store size depends on chunk counts not known before the data is
    read.
36. **A death leaves a note.** At boot the service asks the separate
    control program what the machine recorded about its last stop
    (oom-kill, an abort mid-work, a signal), and any set stranded
    mid-write is marked with that reason in plain words — never a silent
    restart.
37. **The second out-of-memory death, and the fix.** The reshaped fold fit
    the 177,408-setting block — and then building the finished tables ON
    TOP of the still-whole accumulator doubled the footprint and died. The
    accumulator is now drained as the tables are built: each entry deleted
    the moment its row exists, so the peak is one copy plus flat rows.

38. **Apply holds the page still** (owner order, 2026-08-27: "the page must
    not move ... the top line of column headings exactly pegged"). The
    every-coin table's Apply measures where its heading line sits in the
    window, redraws, and scrolls the difference away — the headings stay
    exactly where the eye left them, whatever the new rows did to the
    page's length. The scroll memory is held shut around the nudge (the
    page moving itself never writes it) and then told the pegged place.
39. **The ranked table sorts by one picked column** (owner order,
    2026-08-27: "only a single column to select by is sufficient"). Same
    door as the stage 1/2 sorts — picked on the column, saved on the
    record set, the whole list ordered before the page is cut — but capped
    at ONE on stage 3, and picking another column replaces the pick.
    Nothing carries out of stage 3, so the sort is only how the table
    reads, and its buttons promise exactly that.
40. **The every-coin table shows avg test $, and the tally has a shape
    number.** The per-coin fold now carries the test-window money, and the
    tally records shape v2. A tally of an older shape READS AS ABSENT —
    never served with dashes where the new column belongs — so opening one
    walks in through the rebuild-on-read door and re-totals it from the
    kept records, progress on screen, budget-gated as always. The one
    existing big set re-totals itself once, on first open after deploy.

41. **The third out-of-memory death, one hour after #40 shipped — and the
    fix.** The shape check made readTally re-parse the WHOLE stale tally
    (hundreds of MB inflated) on every ask, remembering nothing; the
    screens ask two endpoints every four seconds; the re-total held its
    "tight" accumulator beside them, and the service died at the heap
    limit inside JSON.parse within a minute of the kick. Two belts now:
    the verdict on a file — stale or served — is REMEMBERED against its
    stat, so one parse decides and a stat answers until the file itself
    changes; and a totalling in flight answers before any file is touched,
    in ensureTally and in readTally both, because the file it is replacing
    is not there to be read. Proved by parse-counting tests and guards on
    both lines. The budget gate never saw this because the gate prices the
    fold, not a parse storm the reader itself was causing.

42. **A setting's name carries only the agreement bars its units hold**
    (owner order, 2026-08-27: "GET RID OF THE +1/8 PART AS ON SINGLES
    THERE'S NO WITH CONTEXTS AT ALL"). The launch reads the units the
    carry actually takes — a mixed parent cut to its top can leave one
    kind — and a bar no priced unit can use is not declared, not
    multiplied by permute agree, and never named in any setting. The cost
    line's counter resolves the same records the launch prices, so screen
    and run stay one number; on a singles-only block with permute agree
    this is also 8× fewer settings, because the inapplicable rungs no
    longer exist. Already-recorded sets keep the names they ran under —
    stored records are never rewritten; re-running stage 3 yields the
    clean table.

43. **The every-coin table sorts on one click and never moves the page.**
    Every column heading carries a button: one click sorts the whole set by
    it its natural way (best first, or A to Z), a second click turns the
    order; the sort by box and the buttons set the same order. And EVERY
    redraw of this table — Apply, a column sort, a records open/close, a
    page turn — goes through the one peg (b3RedrawPeggedToCoinHead), so the
    line of column headings stays exactly where the eye left it. The
    ranked table's own pager keeps the old restore rule — no order covers
    it, and pegging it uninvited is scope the owner did not ask for.

44. **The measurement block was rebuilt (owner loop, 2026-08-28).** Measured
    first, on the owner's own coins: at Daily 1-day a coin on its own had 13
    numbers of which 2 were frozen forever and 3 held one fact — which is why
    six members voted as three voices there. Five rules now hold at every
    chunk shape with no special case: count in hours, never days; every
    window strictly smaller than the chunk; ratios only; zero-volume hours
    legal; one formula everywhere. The width is the same at every shape (21
    per asset, 5 cross) where it used to grow with the days. Gone: the
    day-by-day returns, the last-24-hours return (an exact copy of the last
    day at EVERY shape), the two day-based volume numbers. New: four quarter
    returns, three volume numbers over hours, three that use price AND volume
    together, and three price numbers measured as the most independent of the
    candidates. `total_ret` is exactly the quarters compounded — proved to
    sixteen decimal places — which is why it was only ever a FAULT at Daily
    1-day, where it became an exact duplicate.
45. **Four families, named by hand, and the fourth reading.** Every number
    belongs to exactly one family (price / volume / pricevol / cross), listed
    by exact name — the old classifier guessed from spelling and filed a
    VOLATILITY comparison as volume for years. The families partition the
    block; "everything" is their union and is NOT an independent line of
    evidence, which the voices measurement now says out loud. A coin judged
    on its own has 8 members, one read alongside others 10.
46. **Agreement is five rules, not one count.** count (bit-identical to the
    old rule, proved, so results either side stay comparable), conviction,
    voices, families, unusual — with both-kinds and hold modifiers. The dial
    is a SHARE of the committee, so one number means the same thing at 8
    members or 32 and no committee size appears in a setting's name again.
    Shares landing on the same rung for every unit in a run are one setting,
    resolved at launch against the actual units.
47. **Independent voices, measured and recorded.** Members calling the same
    way almost always are one voice however differently they were built,
    measured on the test slice only. Recorded at stage 1 and stage 2 and
    shown beside the member count, so a reading that adds members without
    adding voices is visible instead of invisible. On the end-to-end exam at
    Daily 1-day — the shape that used to give 6 members and 3 voices — the
    rebuilt committee gives **8 members and 8 voices**, better than the 5 the
    loop plan committed to in advance.
48. **Old sets are refused, never mixed, never deleted.** Every set is
    stamped with its measurement block; a parent from an older one is refused
    by name with what to do instead. The owner deletes them with the control
    that already exists.
49. **The twelve interface demands.** Filters above every table in one
    aligned grid, refused by name at the service if unknown, applied before
    the page is cut, with a line owning up to what was held back; a fold per
    table; every column sortable with its priority number; the obsolete
    ordering box and its Apply removed from the every-coin table because
    columns now order it and filters ask again on change; hover text on every
    filter and column.

50. **Eight tabs, one Sweep, one Boards** (owner order, 2026-08-28: "get rid
    of the Sweep, Sweep2, Boards, and Boards2 tabs. make the existing
    'Sweep3' just 'Sweep' and the existing 'Boards3' just 'Boards'. fix
    *EVERY* reference in the code to those obsolete items"). The two earlier
    working screens and the two drawings the design was worked out on are
    gone; the three-stage pair carries their names. Internal names went with
    them — `s3*` control ids are `sw*`, `b3*` helpers and data attributes are
    `b*`, and the help sections, the word lists' tab list and the mutation
    guards all follow the code rather than a memory of it.
51. **Tests re-aimed where the duty survived, removed with a reason where it
    did not.** Fifty-one checks were failing on names that no longer existed.
    Each was decided one at a time, never by deleting the failure: the
    paging bar now runs against `bPager` and is EXECUTED rather than grepped;
    the cost line's one-place-per-request rule now runs against
    `swBlockParams` and `stage3Declared`; the permute ticks, the declared
    menus, the uncapped boxes, the group hide/show, the notes panel, the
    records column order and the background-totalling report all point at the
    surviving screens. Where the subject is genuinely gone — the menu grid and
    its plateau reading, the inspect panel, the ranked replication list, the
    two drawings, the null-boards cost report, the per-size agreement counts —
    the check is removed with a line saying what it held and why nothing can
    replace it. `tests/test-prototypes.js` is deleted outright.
52. **Three things the deletion broke or exposed, and what was done.** The
    theme button on Construct had lost its wiring with the deleted screens and
    did nothing; it is put back and now has a mutation guard. Four mutation
    guards had gone stale earlier and were testing nothing — the harness
    reported them as SKIPs; all four are re-anchored, and two tests they
    pointed at were too weak to notice the damage even so (the stage 3 count
    fell back to a coin on its own and satisfied a `>=`; the paging bar was
    read for words instead of run) — both are strengthened.
53. **What the deletion left with no way in, reported not fixed.** The old
    run system is now headless: nothing sets the picked run any more, so
    Verify, History, Tune and Greenlight read whatever a browser last stored
    and a fresh browser gets nothing; `/api/sweep`, `/api/run/delete`,
    `/api/run/resume`, `/api/run-contents`, `/api/resume-contents` and
    `/api/sweep-estimate` are reachable by no screen. Removing the subsystem
    or giving the surviving tabs a picker are both real changes and both are
    the owner's to call.

54. **Release 3.0.0, and the number can no longer stand still** (owner order,
    2026-08-29: "YOU *ALWAYS* MAKE RELEASE NUMBER UPDATES — no more of this
    adding code willy nilly and not updating the release numbers"). It had
    stood at 2.0.0 for nine days and 193 commits. The first digit moved
    because record sets written before today are refused by today's engine —
    that is what a first-digit change means here, and it matches what the
    number is used for. Checked before setting it: no record sets on disk and
    nothing trading, so the bump stranded nothing. `tests/test-release.js`
    now finds the commit where the number last moved and fails if anything in
    `lib/`, `public/`, `server.js`, `service-control/` or the top-level
    scripts has changed since without it moving — committed or still in the
    working tree. RULE ONE-C in CLAUDE.md carries the rule; the test is what
    makes it a guarantee rather than a resolution.

55. **The chain refuses on the first digit alone** (owner decision,
    2026-08-29, chosen over stranding two finished record sets). The parent
    refusal compared the whole release string, so any difference at all
    refused — and a patch that fixed a tab which would not draw would have
    thrown away a finished stage 1 and stage 2. RULE ONE-C already defines the
    first digit as exactly this question: "anything that makes yesterday's
    records refuse". So that is what is compared. The measurement block check
    is untouched and still runs first, an unreadable stamp still falls back to
    the strict whole-string rule, and every set still stores its full release
    so a chain says which one wrote each link.

## Parked, needing the owner

- **Forward books F1-F3** are frozen experiments on measurement block 2.
  Re-freezing them against the new engine would silently make each a
  different experiment, so they declare their block and are reported as
  awaiting a deliberate restart. The drift guard still bites at full strength
  for any book on the current block.
- **The owner's existing S1/S2/S3 record sets** are on the old block and will
  be refused as parents. Nothing of theirs was deleted.

- **The picked run has no picker.** Verify, History, Tune and Greenlight all
  read a saved run that only the deleted Boards could choose. Decision 53.
- **A blank fee box buys a free run.** The three-stage Sweep sends
  `Number('') / 100` — zero — and stage 3 accepts a fee of zero, so clearing
  that box flatters every number it produces. The old Sweep sent nothing and
  fell back to the lab rate. One line, and it waits for a GO.
- **The start buttons lose their hover four seconds in.** `swProgress` wakes
  them with `title = ''`, and the poll re-runs every four seconds with no
  re-wire after it, so the authored descriptions go blank and stay blank. One
  line — remember the authored title and put it back.
- **The planted check now reads NOT CHECKED on 3.0.0.** It passed on 2.0.0 at
  02:01 on 2026-08-29 and that run took 46 seconds; the PASS belongs to the
  release that earned it, so the new release starts clean. `Run the planted
  check` on Verify is the owner's button, not a session's.
- **Two names still carry the old product's initials.** The live setup stamp is
  `gc-<version>/setup-1/config-1` in `lib/live/version.js`, and
  `package-lock.json` still calls itself `general-classifier` at version 1.0.0.
  Changing the first alters what every stored setup's stamp compares against;
  changing the second is lockfile churn. Both are the owner's to authorise.

## Recorded intent, no action taken

Owner, 2026-08-27: "once I've confirmed that the new 3 stage sweep and
boards works properly we'll be removing the 4 redundant tabs." Confirmed and
carried out 2026-08-28 under its own GO — decision 50.
56. **The `always` gate is gone, and the records follow it** (3.44.0, owner
    order 2026-09-02: "strip always entirely, migrate the set, second digit,
    and FIX the existing data sets so they can still be used"). The engine's
    gate list is `active` and `directional`; a gate it does not have is
    refused by name, never priced as another. A stage 3 set priced before
    this holds settings whose gate ignored the forecast: the first time it is
    opened, those settings are dropped through the same pass as `drop the
    settings the block does not declare` -- written beside, verified, swapped,
    renumbered -- the tables are put aside and totalled again, and the set is
    stamped with the gates its records hold (`gates`) so it is never asked
    again. Announced on the screen in the totalling's own place and words.
    New sets carry the stamp from launch. The tie machinery that only
    `always` needed (a shuffle comparison that could only tie) went with it.
    Second digit, because the remaining records keep their meaning and the
    migration exists (RULE NINE).
57. **Stages 1 and 2 read money on the tuning slice, against one null set**
    (3.46.0, owner order 2026-09-02: "GO NOW!" on the ordered plan). Measured
    first, read-only, before anything was built: across the 25 units of the
    owner's stage 1 set, the fixed rule's order ran against the money the same
    votes made on the test window (rank correlation -0.56; `forecast score`
    alone -0.61), because the score counts every day once and rewards calling
    flat, while money is made on the few big days. Money on the last quarter
    of the training window -- the tuning slice, which the fit never saw and
    which tau has always been tuned on -- ordered the units WITH test-window
    money (+0.50 all members, +0.64 stage 1 members alone). Its top ten held
    six of the ten best on the test window; the fixed rule's held one. So:
    each stage 1 unit's probe votes on the tuning slice are priced one buy or
    sell per chunk in the direction they lean, held from the entry hour to the
    exit hour through `simMarket` at a `fee % each way` now declared on the
    stage 1 panel, and read against the same null set the score is read
    against (`s1val#d` orders, every copy's money kept in cents -- free
    arithmetic, so no second box). The fixed rule is unchanged; the new
    columns are sortable, and the carry follows the sort saved on the table.
    The test window is not read for any of it, so the Funnel's chance line
    keeps its meaning. Stage 2 stops copying the stage 1 numbers: it deals the
    parent's null set again (parent seed, same tags) for every member, BOOST
    included, and reads the stage 1 members' tuning-slice money again, which
    must equal the parent's to the cent or the unit is refused. Existing stage
    1 and 2 sets are behind until `fill in the tuning-slice money` is pressed
    on Boards, with a fee typed there (RULE NINE: written beside, checked,
    swapped; no reader learns the old shape). Stage 3 and the Funnel are
    untouched. The training weights (days weighted by the size of their move)
    stay deferred and unauthorised. Second digit.
58. **The stage titles on Sweep go red on the section whose own box breaks
    the chain** (3.46.2, owner order 2026-09-02: "why is Stage 2 red on my
    Sweep page ... should be GREEN and Stage 3 should be red"). Amends #30.
    Each title is judged by its own `from ... record set` box against the
    section above it: Stage 2 by the stage 1 set its box names against the
    stage 1 boxes; Stage 3 by the stage 2 set its box names against the
    stage 1 set the stage 2 box names and `carry forward (0 = all)`. Stage 1
    is the root and stays green. Before this the judgement sat one section
    up, so a stage 3 box still naming an older stage 2 set painted Stage 2
    red -- the section above the break -- and Stage 3 green. In the same
    release, the Boards boxes (owner order, same day: "why is Stage 3 on
    boards offering me a pick of S3 #1 which is not related"): each `record
    set` box offers only the sets that came out of what is picked above it,
    walked through the parent links -- the stage 2 box the picked stage 1
    set's children, the stage 3 box the picked stage 2 set's; with nothing
    picked above, every set of the stage; an empty box says nothing came out
    of that set yet. Third digit.

59. **The stage 3 count is worked out without building the settings**
    (3.46.3, owner order 2026-09-02: "the count is not known right now — HTTP
    504 ... we need a longer timeout or other fix"). Measured on the box: the
    count took 8.6 s for a 352,128-setting block -- 5.6 s building every
    setting with its label, 2.8 s keying them all again for the fold -- on the
    service's one thread, and every box change asks again, so a few changes in
    a row queued past the gateway's minute. The block is a cross product,
    decision x band x 24/5 x trade shape x agreement, and the fold merges only
    settings that share everything but their resolved geometry; so the kept
    count is that product with the bands replaced, per group of shapes
    sharing entry, gate and t, by how many distinct geometries the group's
    shapes resolve to across the bands. `countDeclared` does that on a few
    hundred shapes through `shapeRepsFor`, the very pass the launch's fold
    reads, and a test holds the two equal on blocks that fold for every
    reason a block can. The launch still builds and folds. The gateway's
    timeout is untouched. Third digit.
60. **`start stage 3` answers at once; the settings are built behind it**
    (3.47.0, owner order 2026-09-02: the press would "go away and do nothing
    for a minute before crashing without a message" -- and the run had in
    fact started). Two costs sat in front of the answer: every candle file of
    the universe read whole and hashed, twice, for the price-file check and
    the set's own stamp; and the whole block built and folded. Now a file's
    hash is kept beside its size and modified time, in memory and in a side
    file the manifest never lists, so an unchanged file is never read again;
    and the launch gates on `countDeclared`, answers with the set's name, and
    builds the settings under "writing the plan", stopping the run before any
    pricing if they disagree with the count. The browser no longer says
    "nothing changed" on a gateway give-up; it says the service may still be
    working and where to look. Third digit.
61. **Stage 3 prices in parts, not units** (3.47.0, owner order 2026-09-02:
    "we're running 1.75M settings with 36.7M pricings and we're getting
    about 1 cpu worth of effort and no status updates ... i'd rather restart
    than wait days running one processor"). The pool was handed one payload
    per unit, so a one-unit run kept one worker busy and three idle, and the
    line said nothing until the unit landed. Each unit's settings are now cut
    into enough parts to feed every worker several times over -- four per
    worker -- each part carrying its place in the block (`siFrom`) so its
    records file under the same setting numbers they always did; the votes
    are read once per unit and shared by its parts; the realised agreements
    from every part are merged by key; a unit counts as finished when all its
    parts have landed and fails once, whichever part failed first. Progress
    counts parts as they land, with the units and the pricings beside it.
    Existing record sets are unchanged in shape: a unit's blocks were never
    contiguous by contract, and the tally collects them by index. Second
    digit, with #60.
62. **A box nothing in the block reads is ghosted** (3.48.0, owner order
    2026-09-03: "ghost arm and one voice at"). `arm` is read only by a stop
    that follows the price, and a `static` stop is priced without one -- the
    block was never multiplied by it and Boards already showed a dash -- so
    with `trail` on `static` and its `permute` unticked the box and its tick
    changed nothing and looked as if they did. `one voice at` is the same
    under any `quorum by` but `voices`. Both are now greyed and held, never
    hidden, exactly the way `carry forward (0 = all)` is held under `Selected
    records`: the row keeps its shape and the value comes back the moment the
    box it waits on changes. Hiding stays for a box that cannot exist at all
    (`market` has no rails). Second digit.
63. **The launch's answer is run, not read** (3.48.1, owner report
    2026-09-03: pressing `start stage 3` said "nothing changed settings is
    not defined" -- and the run had started). #60 moved the built block into
    the background part and left the answer line reading it by name, so every
    press started a run and then told the browser it had failed. The answer
    now reports the count the gates read and the plan was written with; the
    background part is already held equal to it. The tests that let it
    through read the source and check its shape; none pressed the button. One
    now does: it launches against a small stage 2 parent, reads the answer,
    and waits for the run behind it to end -- incomplete, with its one unit's
    failure written on the set, because the fixture coin has no price files.
    Deployed after the owner's run landed, at their word. Third digit.
64. **The name is the owner's** (3.49.0, owner order 2026-09-03: "that's my
    job to name these things and you haven't given me a control ... previous
    bombs due to issues with your previous code shouldn't mess up my run
    nomenclature"). A set was named by code at launch, "S3 #" plus one more
    than the highest number on disk, so a run my code ended still used up a
    number, and there was no box for the name and no way to change it after.
    A RULE FIVE fault. Now: a `name` box beside `description` on each stage
    of Sweep, its greyed suggestion the next free name from the service (an
    empty box takes it); and on Boards a `name` box with a `rename` button on
    every open section, asleep while the set is being written, exactly as the
    notes are. Names are unique across every set on disk, whatever its stage,
    because the pickers offer sets by name -- a duplicate is refused by name
    at launch and at rename. A rename carries into every set that names the
    renamed one as its parent, stage 2, 3 and 4 alike (RULE NINE), and is
    refused while the set being written names it as parent, because that run
    rewrites its own document as it goes. The counter is still kept on every
    set for its id; the name no longer depends on it. Second digit.
65. **The sealed window rides on stage 2 records, and a set written without
    it is filled in from its parent** (3.51.0, owner order 2026-09-04: "fix
    and deploy the no sealed window deficiency"). The Funnel said "5 of 5
    units carry no sealed window" on every stage 3 set: stage 2 carried the
    bounds into each unit's stores and never onto the record the Funnel
    reads (#28 said it did). Read on the box: S2 #2's 25 records carried
    none, S1 #2's 25 carried all. Now the stage 2 record carries them, and a
    stage 2 set on disk without them is filled in from its stage 1 parent by
    unit (RULE NINE: beside, verified, swapped), announced by the Funnel's
    read and run once in the background; the cut waits for it rather than
    writing "no sealed window" onto a Stage 4 set. A parent that carries no
    bounds itself -- S1 #1, written before the bounds existed -- cannot fill
    its child, and the set says so by name: re-running that chain is the
    owner's call. Second digit: a record field and a fill.
66. **A unit holds only the settings that place different orders on it, and
    24/5 is ghosted when no unit being priced has a weekday version** (3.52.0,
    owner order 2026-09-04: "OBVIOUSLY the system should not permute 24/5 on
    any weekly shape. Ever. ... two changes are NECESSARY: ghost 24/5 and its
    permute when no daily shape is being priced, the way arm is ghosted under
    static; AND fold duplicates per unit"). The fold was across every unit: a
    setting was dropped only if it priced the same trade on ALL of them, so
    XRPUSDT weekly-8d held both values of 24/5 as two records of one trade
    -- 275,520 settings where 137,760 differ -- and the Funnel read the
    doubles as evidence. Now the fold is per unit: a unit keeps the first of
    each set of settings that place the same orders ON IT (the same resolved
    geometry, the same effective 24/5 -- a shape with no weekday version
    reads both values alike -- and the same everything else), units hold
    different counts, the plan says what each holds (`unitSettings`,
    `pricings`), the parts, the kept-scramble fill, the missing-settings
    pricing, the drop and the audit all read that, and the cost line and the
    disk gate read the sum of what the units hold rather than settings ×
    units. A set on disk priced before this is folded per unit in the tally
    slot the first time it is read (RULE NINE: beside, verified, swapped,
    tables re-totalled); one whose block cannot be rebuilt today is stamped
    with what its records hold and says the fold did not run. On Sweep, 24/5
    and its permute are ghosted, never hidden, when the count says no unit
    being priced has a weekday version. And the count line beside keep these
    values on the Funnel follows the ticks as they change (owner, same day:
    "why when i uncheck the 'true' checkbox on the weekdaysOnly dial does
    the record count not change?"). Second digit: a record field, a
    migration and a control's behaviour.
    Places are matched by NAME between a set and the block rebuilt today,
    because a set that had settings filled in holds the block's names with
    the new ones at the end; and neither a drop nor an append stamps a set
    the fold has not reached, or the stamp would stop the fold from running.
    Two limits, stated rather than hidden: a blended row on Boards averages
    the units that hold the setting, so a 24/5 row rests on the daily units
    alone while its 24/7 twin rests on all of them (the coins column says how
    many); and dropping a setting that a unit kept in place of its folded
    twin leaves that twin unpriced on that unit -- the check on Boards says
    so ("every unit holds exactly the settings that place different orders
    on it"), and the fix is the missing-settings fill, not a silent repair.
67. **A set behind on the per-unit fold is not served its old tables**
    (3.52.1, found on the box the same day #66 shipped). The fold runs in
    the tally slot, and a set that already has tables never reaches that
    slot, so S3 #2 was served as it stood after the 3.52.0 deploy and its
    weekly unit stayed doubled. The tables' reader now refuses a set behind
    on the fold, the same door the 3.44.0 strip uses, so every screen falls
    through to the slot that folds it and totals it again. Third digit.
68. **A stage 3 run can be paused and started again, and the run that was
    going when this shipped can be paused from outside** (3.82.0, owner order
    2026-09-07: "build the debug code injection and save the state and memory
    ... write the code that allows the continuation" and "a pause button ...
    an entry written to the stage 3 sweep drop down list as in a paused record
    set which can then be selected for start again perhaps using the existing
    start button"). What a run holds in memory and nowhere else -- the unit
    order, the agreements and the four comparisons per unit -- is written to a
    checkpoint as the pricing begins, once a minute, on a pause and on a
    failure, and dropped when the run lands. The checkpoint lives in
    `data/stagesets/checkpoints/`, in a folder of its own: beside the set it
    was read by the list as a second, headless copy of the set (the rehearsal
    found it). A stopped stage 3 run that kept one reads as `paused`, not
    `cancelled`, because the word says what can be done with it; stage 1 and
    2 still cancel. Started again, a run prices only what its store lacks --
    the same block, on the same price files, on the same units, or it refuses
    by sentence -- and a torn last block the index never claimed is cut off
    first. A unit whose rows are all on disk but whose agreements or
    comparisons never reached the checkpoint (they come back with the pricing
    and from nowhere else, and a checkpoint can be a minute behind) gets them
    back by pricing ONE setting per missing answer with its row thrown away,
    never the whole unit again. The screen: the control on the running line
    reads `pause` on a stage 3 run and `stop` on the others; a paused run is
    an entry in the stage 3 section's box, everything below the box is
    ghosted while it is chosen, and `start stage 3` starts it again. The
    rehearsal proves a paused run, a run killed outright and a run paused
    through the debugger all land equal to the run that was never stopped on
    everything that does not depend on the deals. Second digit: new
    behaviour and a new control.
    `tools/capture-stage3.js` serves ONE run, the one on 3.81.0 code that
    keeps no checkpoint: it opens Node's debugger on the service with
    SIGUSR1, breaks on the next part to land, writes the same checkpoint out
    of the paused frame's own variables, asks the run to stop, and lets the
    process go; the workers keep pricing through the second it is held.
    RULE TEN: it, its test and its help go the day that run has been started
    again. Two things the rehearsal taught, both written into the tool: a
    paused frame sees an outer variable only if some inner function refers to
    it (cancelStage is only ever exported and was invisible; activeSet and
    activePool are referred to by every launch and are not), and the tool
    must attach BEFORE the first part lands to be sure of a run this small.
    The rehearsal itself needs two worker threads -- with none, the pricing
    runs on the one thread that would answer the pause, and nothing gets a
    turn until the run ends -- and sets that in the pool's settings file for
    its own duration when the box it runs on has fewer, putting it back
    exactly as it was.
69. **The start-again answers at once, and every start says so on the press**
    (3.83.0, owner report 2026-09-07: "i did the start stage 3 on the paused
    set and it just timed out ... you need to fix the start stage buttons on
    sweep to ghost as soon as a button is pressed AND not start a time-out
    that complains after one minute -- you need to give a status of
    'starting...' or something like that at the top"). The run had in fact
    started: reading 2.18 million rows back to learn what was on disk took
    over a minute inside the request, and the gateway for the screens keeps
    its default sixty seconds on purpose ("no long-lived requests"), so the
    press came back as a failure while the run went on. The split is now the
    launch's own (3.47.0): everything that can refuse in an instant still
    refuses in the answer -- the set, its checkpoint, one heavy job at a time,
    the parent, the price files, the units -- and the slow part happens after
    the answer, on the running line: the block is rebuilt, the store is read
    four blocks at a time with the loop let go in between so the screens keep
    answering, and the work list is built. A refusal found there (a block
    that no longer rebuilds, a duplicate row) puts the set back exactly as it
    was with the sentence on its own line; the pause control pressed during
    the reading leaves it paused. The answer carries only what is known at
    once (id, name, units); what was kept and what is priced again is written
    on the set when the reading is done, which is where the screen and the
    tests now read it. The tool's mark on the 3.81 run is dropped the moment
    it is started again.
    On the screen: all three start buttons sleep the moment any one is
    pressed, the status line at the top reads starting… before the box has
    answered, and a gateway that gives up is not a dialog -- the line says the
    box has not answered yet and the poll follows it for up to two minutes.
    The poll no longer wakes the buttons under a press the box has not
    answered. Second digit: the start-again's behaviour and the screen's.
    Found and left as a report, not fixed: the closed word list cannot see a
    label written as a bare quoted string inside an interpolation or assigned
    straight to a line -- `pause`, `stop`, `nothing is running` and now the
    starting… lines are on the screen and on no list, and the two-way check
    reads through the same reader, so it cannot see the hole either.
70. **A run reads the price files it was launched on** (3.84.0, owner report
    2026-09-07: "when i picked start stage 3 i got this immediately: FAILED
    -- nothing changed. the price files changed since S3 #1c was written
    (LTCUSDT) ... that is false. fix it"). It was true of the files and false
    of the prices. The service's own refresh, sixty seconds after the 3.82.0
    boot, consolidated August 2026 into a month bundle for every coin;
    LTCUSDT's August had been day files when the run was launched, so its
    file list moved. Its candles did not -- except seventeen hours on
    2026-08-20, eleven months inside every unit's sealed window, that the day
    files had never held. Three findings, in order of weight:
    (a) the check fingerprinted files, so it could not tell packaging from
    prices; (b) the sealed window is cut by COUNT at pricing time, never at
    the boundary the record stores, so a hole filled deep inside it adds
    chunks and can move the boundary for every unit that reads the coin --
    the seal is a fixed date only within one launch; (c) a run that goes on
    for forty hours reads whatever is on disk when each unit comes up, so the
    refresh could put two histories inside one run -- and did: the first
    start-again slipped in before the refresh reached LTCUSDT, so units 88 to
    90 were priced on the filled August while 1 to 87 were not.
    The fix closes (a) and (c) with one rule: the per-file detail the stamp
    already writes beside every set is the run's pin. The loader reads those
    files and no others -- the month bundle when one is pinned, else the
    pinned day files -- and a bundle that appears, a day that gets filled or
    a new day of data is not that run's. The start-again, the unit fill and
    the chain check ask only whether the pinned files are still there with
    the same bytes, and name the files that changed or went; a child launch
    is stamped over its parent's pinned files, so a chain reads one history
    by construction and the next start stage 3 from S2 #1 is not refused
    either. Sets stamped before this carry the same detail files, so nothing
    on disk is migrated; a set never stamped reads what is on disk, as it
    always did. (b) is REPORTED, not fixed: pinning makes the seal a fixed
    date within a chain, but across chains the boundary still slides as the
    cache grows, and the "13% never seen" holds only for what a chain was
    launched on. That is the owner's call. Second digit.
    **3.84.1, found on the box the hour 3.84.0 shipped.** S3 #1c's own stamp
    named one coin, LTCUSDT, while every one of its units read sixteen more
    alongside it: its launch had fallen back to the parent's trade coin (the
    3.77.1 fault, on the stamp rather than the check), so a pin over its own
    record left sixteen coins reading whatever was on disk. Two changes: a
    child is stamped over every coin its parent was stamped over, its unit
    list only when the parent has no pin; and a start-again widens a narrow
    pin to the parent's files -- its own files win for the coins it names,
    the launch's own detail file stays where it was, and the record says
    what was added. For S3 #1c that means the remaining 210 units read S2
    #1's files for those sixteen coins; units 1 to 90 read what was on disk
    at their time, which may have run a few days past the parent's files.
    That is the best record there is, and it is written down. Third digit.
71. **The pause tool is gone; every run stores the date ranges it used; the
    unread window has a start and no end** (3.85.0, owner order 2026-09-07:
    "delete the pause tool. also, on all s1/2/3 sweep runs the three actual
    date ranges for 70/15/15 and 61/13/13 should be stored. in the case of
    61/13/13/13 future runs that look at the last /13 should use all
    available data -- so if more data has become available it must be
    automatically included in the final /13 sealed chunk").
    The tool went whole (RULE TEN): the file, its two tests, its guard, the
    test fixture's inspector plumbing, its box scripts. One line stays until
    S3 #1c has been started again: the start-again drops the tool's mark
    from that set's document. The unit chunking now returns the windows it
    cut -- training, test, held-back, each from its first chunk's first hour
    to the last hour its last chunk's trade can reach, with the chunk count;
    and the unread window's start, its chunk count, and only how far the
    data reached that day (seenToTs), never an end. Stage 1 and 2 write them
    on every record; stage 3 keeps them per unit beside the set, in the
    checkpoint too, and a start-again brings them back for a unit that lacks
    them by pricing one setting again, as it does the agreements. Whatever
    reads the unread window reads from its start to the newest candle the
    box holds on the day (sealedFromUnits, windowsOfSet): the pin covers what
    a chain was launched on, and the unread window is everything after it.
    On screen: every run's header on Boards carries a Date ranges line, and
    the Funnel's sealed line says where the unread window runs. A set
    written before this has its date ranges worked out from its own pinned
    files the first time a screen reads it -- in the workers, one set at a
    time, never while a run is going, stage 1 and 2 records rewritten beside
    and swapped once the count matches -- and the block that does it is
    deleted the day every set on the box has been through it; windowsMissing
    counts what is left. Second digit: new stored fields and a new line on
    the screen.

72. **The date-range fill is deleted, the day it served every set** (3.85.1,
    RULE TEN; owner `LOOP NOW!` 2026-09-07: "start with writing any date ranges
    that are missing from record sets"). The fill from #71 ran once on the box
    through the set route, one set at a time: S1 #1, S2 #1, S3 #1a and S3 #1b,
    2,100 units. Measured after: 2,100 of 2,100 unread windows equal to the
    run's own sealed window, chunk for chunk; every pin intact; 0 sets left.
    So the block goes whole: the fill, its status and count, the busy clauses,
    the route's fill field, the screen's fill wording, the worker task, its
    rehearsal and helpers. What stays is the run's own writing of the ranges
    (every stage, every record) and the start-again's recovery of a unit that
    lacks them by pricing one setting again -- S3 #1c, paused under 3.84.1,
    still needs that. Once S3 #1c has been started again, that branch and the
    `pausedBy` line are spent as well; parked for the owner. Third digit:
    nothing new on any screen, nothing on disk changes shape.


73. **The verdict on a Stage 4 record set, and the three dead panels retired**
    (3.86.0, owner `LOOP NOW!` 2026-09-07, VERIFY-DESIGN.md sections 4, 7 and
    8). Verify reads a Stage 4 record set as a whole, never one row. The dry
    read draws the record's footing and hands back no held-back figure; the
    press is the stamped look. It declares its rules before any number exists
    (the set's own bar share resolved to a count, DERIVED, or a typed share,
    GUESSED; noise must lose at least a typed share of the board's scrambled
    held-back figures, default 50, GUESSED; buying the coin and going away and
    shorting it and going away must be beaten, DERIVED; unknown never passes),
    reads every survivor joined to its parent's board and never a page, and
    stamps one block: footing, looks counted (steps, steps back, the cut view;
    Boards' sort and filter; a floor on trades), the held-back read against the
    four comparisons, the survivors against their own copies' means on the
    held-back window with the chance rate and the 1-in-(K+1) floor, each
    survivor's own reading beside how many would pass by chance (never a gate),
    sanity, the two information lines (the rule on the test window against its
    own copies; the bound on top-N shopping), the fee as `feePerLeg` with
    `feeUnits: 'fraction'`, the windows, the marks, and one sentence from the
    stored numbers. Every press appends a block, newest first, nothing
    overwritten; `heldBackReadAt` is written on the first press only. A blend
    set is refused in words; a set without scrambled copies stamps an
    INCOMPLETE block. Tool 1, the rotation rounds and Tool 2 are gone from the
    screen with their renderers and help entries (0 runs on the box carried
    rotation rounds); the null-verdict route stays for the old runs. The
    planted check panel says it certifies the older sweep path. Second digit.

74. **What the independent review of 3.86.0 found, fixed** (3.86.1, loop,
    2026-09-08). A blank "bar share %" box reached the server as 0 and became a
    bar of one copy, which a forecast-free rule clears 99% of the time: the box
    is now sent blank when blank, and a share below 1 is not an ask, it is the
    set's own. The footing replayed the rule on the parent's shared file alone,
    so a parent that had lost a column the rule reads refused a set whose own
    copy still replayed: it replays on the set's own copy now, asks the parent
    too, and reports both. A set without scrambled copies was told noise was
    profiting: the sanity line says not known. A new set starts with an empty
    verify list. Negative money in the sentence prints the way the page prints
    it. Third digit.

75. **The stage engine's own planted check** (3.87.0, loop, VERIFY-DESIGN.md
    V0 and decision 9; loop record step 2). A button on Verify beside the
    planted check runs the same question through the engine the owner uses:
    two fabricated coins from the planted check's own generator (the plant
    alive the whole span; a fair coin), stage 1, stage 2, a small stage 3 with
    a null set of 20 and every copy kept, a rule declared before anything is
    launched (a range on the hold length the block permutes, no cut) cut into
    a Stage 4 set on each coin, the verdict read on both at the exam's own bar
    of all 20 copies, five gates: G1 held-back money, G2 beats buying and going
    away, G3 beats every copy, G4 the fair coin does not, G5 nothing failed and
    every survivor carries every copy. The bar is all the copies because an 85%
    bar is cleared by a fair coin more than 5% of the time at any copy count;
    all of 20 is 1 in 21, printed with every verdict. Records in their own
    directory; PASS belongs to the exact release. The exam's sets are marked
    and kept off every screen's list, and deleted when it lands; its coins are
    reserved and stage 1 refuses them unless the exam launches them. Everything
    refuses while it runs and it refuses while anything runs. A Stage 4 verdict
    records which stage gate stood, printed beside the planted check, never a
    gate on the set. Second digit.

76. **The stage engine fails its own planted check, and the loop leaves that
    for the owner** (2026-09-08, loop; the full bisection is in
    VERIFY-DESIGN.md section 9, step 2). A trader who follows yesterday's
    close-versus-open on the fabricated plant makes +$48 on the exam's test
    window and +$43 on its held-back window; the engine's own chunks, labels
    and simulator reproduce that to the cent; stage 1's members forecast the
    same window weakly (only the `prices` view beats chance) and make +$25;
    stage 3's committee loses under every agreement rule tried. G1 to G3
    fail, G4 and G5 stand. The check ships and says so on Verify; the engine
    is not changed inside the loop (RULE SIX). What the owner may want to
    know first: which view sees the plant and which do not, and whether the
    committee's agreement is what turns a weak edge into a loss.
    *Later the same night, read-only, on four years of the made-up history
    instead of one:* three of the four readings find the plant (67–73% right
    on the days they speak), volume alone is at chance as it should be, and
    the whole engine PASSES — the planted rule makes +$105 a setting held
    back, beats 20 of 20 copies; the fair coin fails. The engine is not
    broken; the check's one-year span starved it. Lengthening the check's
    declared span is parked for the owner (VERIFY-DESIGN.md section 9, step 2).

77. **The rule on the other units and the held-back ride, on Verify** (3.88.0,
    loop, VERIFY-DESIGN.md V6 and V7, section 9 step 3). Two presses under the
    verdict, both information and never a gate. The first walks the same boards
    the Funnel's "read the other units" walks, with the held-back fields: each
    other unit's figure is the mean held-back money of the settings the set's
    rule keeps there, read against that unit's own scrambled copies at the
    verdict's declared bar resolved for that unit's copy count; a unit where the
    rule keeps nothing is printed as such and left out of the denominator; two
    counts, and a mark when fewer than half are positive. Every press appends a
    reading; a verdict stamped after one carries the newest reading's counts and
    its sentence says them. The second is the missing-numbers pass aimed at this
    set's survivors on this set's unit only, keeping the held-back half the
    worker already computes beside the test half, stamped with the release.
    *Why its own record and not the set's copy of the test numbers:* that copy's
    shape is what every Stage 4 set on the box is read by, and reshaping it is a
    migration of every set (RULE NINE) that a loop may not decide. *Why the
    parent's shared file is not written:* the shared file's writer replaces a
    setting's per-unit table with the units just priced, so a one-unit rebuild
    written there would take the other units' numbers away. *The ride is a
    look:* it prints held-back numbers per survivor, so every verdict stamped
    after it counts it. *One reading at a time:* the Funnel's read of the other
    units, Verify's, the verdict press and the ride each refuse while another is
    going, in words that name it. The pricing pass is not exercised end to end by
    the suite, as the Funnel's own press is not; the taking of its answer is.

78. **Every recorded step of the walk carries the survivor count the page had
    in hand** (3.88.1, loop, VERIFY-DESIGN.md separate task 5, section 9 step
    4). The record always kept a place for it and the page never filled it.
    Each step and step back is recorded through one counted helper inside the
    walk's wiring, reading the survivors off the read the screen was drawn
    from — the number printed as "N settings survive" — never re-read and
    never worked out on the page. *Unknown is null, never 0:* a step recorded
    with no read in hand says so, because a zero reads as a rule that kept
    nothing. *The halves and the noise twin are left empty:* the read carries
    no survivor count on them, and a page that invented one would be the fault
    this release ends. Third digit: a field the record already had, filled.

79. **The reserve grade on a Stage 4 record set, on History** (3.89.0, loop,
    VERIFY-DESIGN.md section 6 and section 9 step 5). The unread window — the
    sealed 13% cut away before anything trained, from where the seal began to
    whatever the box holds today — priced for the set's survivors on the set's
    own unit and read by the verdict's four rules on that window. *How it is
    priced:* through the stage 3 pricing task itself, with the unread window
    standing in the held-back window's place (three things change inside the
    task: which chunks the slice holds, whose prices they are read from, and
    where the votes on them come from), so the unread window cannot be priced
    differently from the held-back one. *Where the votes come from:* nothing is
    retrained; each member's saved model is applied to the unread chunks on the
    member's own view, and a test holds that the saved model applied to the
    test chunks gives the stored votes back, digit for digit. *The committee's
    shape and every tau* come from the test slice, as stage 3 takes them.
    *The gate:* a verdict that PASSED under the reader's first digit, or the
    press refuses in words; a FAIL, or a PASS under another first digit, opens
    nothing. *Looks:* every grade is appended and numbered; the first is the
    only look at unseen data and every later sentence says so. *Sanity* is read
    over the survivors' copies only, and says so, because the whole board is
    not priced on this window. *The test opens the gate by hand* after proving
    the refusal for real: the engine's own verdict on the plant fails today
    (#76), and the pricing path is what the test is for. Second digit.

80. **Greenlight from a Stage 4 record set: the rule's agreement frozen, one
    survivor by depth or by name** (3.90.0, loop, VERIFY-DESIGN.md section 6,
    section 9 step 6). A second door on Greenlight: a Stage 4 set whose verdict
    stood (the same gate the reserve grade uses), one survivor, a name and a
    why. *One survivor without shopping:* by depth — the setting nearest the
    middle of every range of the rule, a word dial putting everyone at the
    middle, ties to the smallest mean and then the set's own order — or named
    by the owner; both recorded with the distance. Money never enters the
    choice. *What is frozen:* the unit, the shape, the decision, the resolved
    band, the members exactly as the stage 2 set trained them, the trade shape
    as priced, and the AGREEMENT as the survivor carries it (the way of
    weighing, the bar, the share, the copy share, +both and +hold), where the
    old integer quorum stood — the vocabulary grew a named engine for it.
    *Nothing trades from it:* the shuttle refuses a stage-engine configuration
    in words, and the live door refuses it too, until the live path speaks that
    agreement (step 7); real money stays the owner's switch (RULE SIX). *Refused
    in words:* a coin read on its own (the live vocabulary carries three-coin
    units only), a survivor whose entry, gate, stop or arm the executor cannot
    carry, a set with no members named, no band on the record. *Both sides of
    Trade* print the agreement through the one drawing path, and an old
    configuration keeps printing its quorum. Second digit.

81. **The live path speaks the stage engine's agreement; one definition of a
    committee's call, shared** (3.91.0, loop, VERIFY-DESIGN.md section 6,
    section 9 step 7). *One definition:* the pieces that turn votes into a call
    — calls from probabilities, the committee's shape on its test slice
    (independent voices, each way of weighing's own bar), what is enough, the
    stream with +both and +hold — moved out of the stage 3 task into
    `lib/committee.js`, and the task calls them; the four-year engine run
    reprices to the cent before and after. *The live path:* a stage-engine
    configuration trains its members the way stage 1 and 2 train them, on the
    chunks closed by the deployment's training instant laid out as stage 1
    lays them out (the seal not cut away: a deployment reads everything
    closed), shapes the committee and every tau on that test slice, forecasts
    the target and the +hold moments before it, and calls through the shared
    definition. *Parity, the gate:* on the fabricated chain the shared
    definition's calls on the held-back slice, fed to the same simulator on the
    same chunks, reproduce the stage 3 record's held-back money to the cent;
    only with that test green was the door opened. *The switch stays the
    owner's:* the two refusals from #80 are lifted, so a stage-engine
    configuration shuttles into a draft and passes the live door like the older
    engine's — and a draft trades nothing; the Activate press on the Trade tab
    is the switch, Paper Books first, and nothing inside a loop presses it
    (RULE SIX). *The record:* an intent carries every member's vote and the
    agreement, no integer quorum (the box's executor requires none); the
    anatomy panel says the agreement in the agreement library's own words.
    Second digit.

82. **Tune's per-trade capture for a Stage 4 record set** (3.92.0, loop,
    VERIFY-DESIGN.md section 6, section 9 step 8). *The gap:* the two scans on
    Tune take a list of entries and price them themselves; a Stage 4 set holds
    money per window and never the trades. *The capture:* the same pricing pass
    as the reserve grade with a flag (`task.capture`), for every survivor that
    enters at market with no trailing stop — the only shape the two scans
    price — every moment the rule spoke on the test and held-back slices (the
    stored votes, the real calendar) and on the training slice (the members
    forecasting their own training chunks from their saved models, in-sample
    on purpose, as the older tools read it); each entry carries the hour, the
    side, how many members called that side, and the one simulator's own money
    for that trade priced on that chunk alone, so the population is exactly
    the simulator's. Entries live in a file beside the set; the set holds the
    summary; a second press replaces the first. *Parity, the gate:* on the
    fabricated chain every survivor's held-back entries sum to the record's
    held-back money to the cent and count its trades, the test entries
    likewise, and every agreement count is a recount from the members' own
    calls through the shared definition. *The scans:* the scan target offers
    each set with a capture, one survivor beside it (by depth among the
    captured, or named) and three ticks for the windows read (training and
    test by default; held-back not); the tuner and the ladder run on those
    entries at the survivor's own hold length and the set's fee, on the prices
    the chain was launched on; nothing is applied from a set. *Looks:* a scan
    that reads the held-back entries is a counted look, stamped on the capture
    and counted on Verify's looks line; training and test reads are not. *The
    unread window is never captured.* Second digit.

83. **The stage-engine check builds four years of fabricated prices** (3.92.1,
    owner order 2026-09-08: "make the stage-engine check build four years GO
    NOW!"). On one year the daily shape kept 220 training chunks after the
    seal and the two slices were cut away and stage 1 could not learn the
    plant: the check failed on its own starvation, not on the engine (the
    loop's four-year diagnosis passed every gate on 888 training chunks,
    VERIFY-DESIGN.md section 9 step 2). The span is now 2021-01 to
    2024-12-31; the months stage 1 is launched on are read off the span so
    the two cannot drift; the record carries the span it was built on and the
    last check on Verify says it. The two chain tests keep a one-year span of
    their own, declared in the test: they exercise the doors and the
    arithmetic, not the calibration, and four years would cost the suite
    twenty minutes for nothing. Third digit. The new release makes the check
    read NOT CHECKED; the owner presses it.

84. **The 80/20 window layout removed from stage 1** (3.93.0, loop H1, owner
    order 2026-09-08: "get rid of the option and clean up any code specific to
    it"; "there are no sets with 80/20"). The Sweep's window layout box offers
    70/15/15 and 61/13/13/13; a launch asking for the old name is refused by
    name with the reason (it kept no held-back slice, so nothing cut from it
    could be verified); the chunk split always keeps a held-back slice. The
    older engine (lib/batch.js) keeps reading its own records, which carry the
    name. Second digit: a control is gone.

85. **The History half-life run** (3.94.0, loop H2, AGEDIAL-DESIGN.md, owner
    design 2026-09-08: "4.h IS the same 199 records retrained"). On History,
    under the reserve grade, for the set chosen there: tick any of 12, 18, 24,
    30, 36, 48 months and press once; the set's forecasts (both kinds, the
    stage 2 record's members) are retrained once per ticked half-life with
    each training chunk's weight `0.5^(age/H)` multiplied into the set's own
    training weights, on the retrain layout (a 61/13/13/13 set: the first 72%
    of history trains, the next 15% tests, no held-back slice, the Reserve
    judges; a 70/15/15 set: its own 70/15, the Held window judges); the same
    settings are priced again through the stage 3 task at the unit's original
    band, beside the unweighted column priced in the same pass from the set's
    own votes and models. One table: a money column per half-life shortest to
    longest, the unweighted last, best per row in green (a half-life wins only
    by at least a cent; a tie goes to the unweighted side; equal half-lives to
    the shorter), rows won and averages under it. A starved half-life is
    refused for its column in the floor's words; a Reserve column whose read
    reached a different end than the unweighted one is refused too. The
    retrained members are kept beside the set per run, per half-life. Every
    press is a counted look, appended, never overwritten; "Run the reserve
    grade on this set" is untouched. Second digit.

86. **The 4.h set, and the half-life carried forward** (3.95.0, loop H3,
    AGEDIAL-DESIGN.md). Under the newest half-life table on History, a name
    box and a button build a record set from every row a half-life won, each
    record carrying the half-life that won on it; rows the unweighted column
    won are left out; a table nothing improved on refuses. The set is a Stage
    4 record set document like any cut, marked as built from its source and
    its run, on the same unit and parent with the source's rule and check. It
    stands on its source's PASS (the gate of a built set is its source's) and
    is refused in words, pointing at the source, wherever its own numbers
    would mislead: Verify's press and dry read, the other units, the ride, the
    reserve grade, another half-life run; the Funnel's own list and the set
    boxes on Verify and History leave it out; Tune and Greenlight offer it
    named by its source. Tune's capture reads each record's retrained members
    from the run file beside the source, on the retrain layout, and the
    captured test entries reprice the table's own test money at that half-life
    to the cent. A greenlight from one of its records carries
    `training.halfLife` (days) and the months; the shared vocabulary accepts it
    only on a stage-engine configuration; the live path multiplies the same
    age weight into its training through the one definition; the anatomy and
    the Trade rows say it on both Paper Books and Live Trading through the one
    path. Second digit.

87. **The planted check and the stage-engine check live on Setup, under
    Version** (3.96.0, loop H4, owner order 2026-09-08: "move the Planted
    check box and it's two sections/controls to a new tab under Setup called
    Version that comes after Compute -- the 'not checked' marker will take us
    to the new tab of course for running the checks"). The panel moves whole
    — the same words but for two sentences that pointed at Verify's own
    screen, the same two presses, the same sleeping button with its reason,
    the same last-verdict lines and full records — to a tab of its own on the
    Setup page after Compute, drawn by that page's own self-contained code so
    it is there when the trading service is not, and says so when the service
    did not answer instead of reading NOT CHECKED. The tab re-reads both
    checks every five seconds while it is open and redraws only when a
    reading changed, so a running check's step line moves and an idle tab
    stays still. Verify loses the panel and keeps everything under it; the
    marker beside "planted check:" at the top of every Construct screen opens
    Setup on Version instead of Verify. Setup has no Help tab, so the two help
    entries go with the panel and their words are carried on the presses'
    hover text and in the panel's own paragraphs; Verify's opening section
    says where the checks went. Second digit.

