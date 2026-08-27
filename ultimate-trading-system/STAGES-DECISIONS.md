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

## Parked (found while building; not in the loop)

- Should the old Sweep launcher refuse to start while a stage job runs? (5)
- A delete control for record sets with parent protection. (10)
- Multithreading the stage 3 aggregation pass, if the tally build proves slow
  on the box.
