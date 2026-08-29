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
- **The engine version has not moved since 2026-08-20** (2.0.0, 190 commits
  ago). It is not a badge: a planted check or age-dial exam PASS belongs to
  the version that earned it, so bumping it puts both back to NOT CHECKED
  until they are re-run. Today's measurement block change is a real argument
  for bumping it. The cost is the re-run; the call is the owner's.

## Recorded intent, no action taken

Owner, 2026-08-27: "once I've confirmed that the new 3 stage sweep and
boards works properly we'll be removing the 4 redundant tabs." Confirmed and
carried out 2026-08-28 under its own GO — decision 50.
