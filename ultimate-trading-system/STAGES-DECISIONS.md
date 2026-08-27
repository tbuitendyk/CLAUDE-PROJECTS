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

## Recorded intent, no action taken

Owner, 2026-08-27: "once I've confirmed that the new 3 stage sweep and
boards works properly we'll be removing the 4 redundant tabs." Nothing is
removed until that confirmation and its own GO.
