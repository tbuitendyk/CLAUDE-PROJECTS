# Additional member training: what the walk finds, carried into Sweep

The owner's design, spoken on 2026-09-19 and written down here so it is not lost
with the conversation. **Nothing in it is built and nothing will be until the
owner says so, part by part.** The phrase in the title is theirs and it is
already on their screen: the promoted box under `Candidates for Sweep` reads
"selections may feed units into STAGE 1 and 2 ADDITIONAL MEMBER TRAINING".

Three kinds of thing are in this file and they are kept apart on purpose:

- **What the owner designed.** Sections A to F. Recorded as given.
- **What I found in the code.** Marked FOUND, with the file it was read in.
  These are findings, not decisions.
- **What I proposed.** Marked PROPOSED. The owner has not agreed to these unless
  a section says they have.

**Two false starts are recorded at the end**, because both were mine and both
would have produced the wrong system. Whoever picks this up should read them
before proposing anything.

---

## A. The unit does not change

A row promoted out of `Walk it forward` is **one unit — a coin and a chunk
shape** — exactly as a row that passed a reading is today. There is no unit per
look-back, no unit per band, and no permutation of settings. Four promoted rows
are four units.

That unit keeps **everything it has today, untouched**: the same members on the
coin's own numbers, over the chunk shape's own window, labelled with the sweep's
own `band %` (or `auto`).

**Then one more member is added.** That member is trained on the new
information the walk found. Nothing existing is altered to make room for it.

## B. What the extra member reads (owner's choice, 2026-09-19)

The same **kinds** of numbers the other members get — how much it moved in each
quarter of the span, how much overall, how jumpy, the trend and whether it is
speeding up, the biggest fall and rise — but **measured over the walk's
look-back** instead of over the chunk shape's own window. **The plain move over
that look-back is included as one of those numbers**, because that is the exact
thing the walk tested.

Why this and not just the one number: one number is almost nothing to train on,
and a member given only it would mostly repeat what the walk already said.

FOUND (`lib/features.js`, `assetCompressed`): every number a member reads today
is computed over the chunk shape's own feature hours — 24 for `daily-1d`, 72 for
`daily-3d`. **Nothing any member sees reaches further back than that.** A
432-hour look-back is eighteen times further back than anything a `daily-1d`
unit can currently see. That is why this is new information and not a
rearrangement of what is already there.

FOUND (`lib/bracket.js`, `comboViews` / `trainMember`): a member is handed a
subset of column positions into one shared vector. A new look-back is therefore
**new columns**, not a new subset. The work is in the chunk builder, not in the
committee code.

PROPOSED: the extra blocks are appended **after** the existing columns, so no
column position that exists today moves.

## C. What the extra member is labelled with (owner's correction, 2026-09-19)

**The walk's band**, together with the walk's look-back. The two travel together
because that is the pair the walk tested.

The band applies to **the new member only**. The existing members keep the
unit's own band and are not touched.

FOUND (`lib/dataset.js`, `scoreDiff`): a label is one of three — up, down, or
sit out — decided by whether the move cleared the band. FOUND
(`lib/bracketwork.js`, `splitAndLabel`): today one band produces one label per
chunk, shared by the whole committee.

PROPOSED: **label sets keyed by band.** The chunks and their numbers are
identical; only the three-way answer differs. So a label set is built once per
distinct band and each member records which one it was marked against. This is
cheap — the same comparison over figures already computed, with no re-extraction.

## D. The committee is a list, and it grows by adding to the list

Owner, 2026-09-19: *"Code it in such a way that if we add another voting member
in the future, having to do with more information related to even longer term
trends, for example, then we can add another voting member when we need to."*

PROPOSED shape:

- A unit carries **a list of extras**. An extra is a look-back, a band, and
  where it came from.
- A member spec becomes `{ model, view, from }`, where `from` names which set of
  numbers it reads: the coin's own window, or one of the unit's extras.
- The committee is `base + extras.flatMap(...)`. A second extra — a longer-term
  trend — is **one more entry in the list**. Nothing branches on whether an
  extra exists.

## E. Each member is scored against its own labels (owner's choice, 2026-09-19)

Pool only for the **vote**. Score each member against the labels it was actually
trained on.

FOUND (`lib/stagework.js`, `forecastScore`): today every member's answer is
pooled into one and that pooled answer is read against a single set of labels.
A member trained on a wider band puts more weight on sit-out; pooled in, it
drags the pooled answer that way on every chunk and is then marked against
labels where fewer chunks are sit-out. It would lose points **for being asked a
different question**, not only for being wrong.

FOUND: the **money** is unaffected either way. Trades are trades, and test and
held are priced on trades, not on labels.

## F. THE EXTRA MEMBER MUST NOT BE BIASED TOWARD SITTING OUT

Owner's requirement, 2026-09-19, in their words: the signal we train on *"needs
to not be biased ... towards sitting out. It can't be causing a failure to vote,
and the success looks like sitting out scenario."*

**The hazard.** The walk's bands run wide. A wide band makes sit out the
majority answer. A member trained on a mostly-sit-out target learns that saying
nothing is the safe answer, stops voting — and then **scores well, because
saying nothing is right most of the time**. A member that has learned to be
silent would look like a member that has learned something.

Four things stand against it. Three already exist; all four have a requirement
attached, because existing is not the same as measured.

**F1 — the training already leans against it, up to a point.**
FOUND (`lib/bracket.js`, `trainMember`): each label is weighted by
`rows ÷ (labels present × rows carrying that label)`, capped at **20×**
(`CLASS_WEIGHT_CAP`). At 92% sit out, up and down are each weighted about 8×, so
the cap does not bind. At a more lopsided band it would, and the lean would stop
growing while the imbalance kept going.
**Requirement: record per member the realised weights and whether the cap bound,
and show it.** A member trained at the cap must be visible, not assumed.

**F2 — a member that always says the same thing cannot beat its own null set.
This is the strongest protection and it already exists.**
FOUND (`lib/stagework.js`, `forecastScore` with an `order`, and `dealOrder`):
the null keeps the same forecasts and the same labels and destroys **only the
pairing between them**. A near-constant member therefore scores the same
shuffled as unshuffled, and beats none of its deals. Silence earns nothing.
**Requirement: the extra member gets its OWN score and its OWN null, dealt
against its own labels.** Today the score is pooled across the whole committee,
so a quiet member hides inside it and the protection does not reach it. Section
E is what makes this transfer — **without per-member scoring, F2 does not
apply to the new member at all.** This is the single most important line in
this document.

**F3 — score it on the calls it made, not on every chunk.**
A member right about sit out 95% of the time has said nothing.
**Requirement: record and show, per member, how often it spoke — called up or
down — and how it did when it spoke**, separately from its score over
everything. Two numbers, not one.

**F4 — a floor on how often it speaks.**
**Requirement: a member that speaks fewer than a stated number of times on test
has not earned a vote, and the screen says so rather than counting it
silently.** The number is typed by the owner, never a constant in code (RULE
FIVE).
NOT VERIFIED: whether every path that would consume a promoted unit applies any
trade floor today. FOUND (`lib/bracket.js`, `bestCell(rows, minTrades)`) that a
floor exists on the settings search, and Boards has a `fewest trades` box, but I
have not traced that they cover this path.

**The other direction, secondary.** The new member must also not be *penalised*
merely for being asked a different question. Pooling its answers against the
unit's labels would do exactly that. Section E fixes it.

---

## G. Member counts and the agreement

Owner, 2026-09-19: different member counts are *"not an issue ... just like we
have different member voting counts involved with doubles and triples. This is
just another combination."* And: **runs do not mix sources.** A run is all old
units or all new ones, so within a run the count is uniform for a given combo
size — the same shape doubles and triples already have.

Counts today, FOUND (`lib/bracketwork.js` `slimViewsFor`, `lib/stagework.js`
`s1UnitTask` and the stage 2 task): one member per slice of the numbers —
**4 slices for a single coin, 5 with one or two coins alongside** — all `logreg`
at stage 1, the same slices again as `boost` at stage 2. So a single-coin unit
trains 4 at stage 1 and 4 at stage 2; with an extra it is 5 and 5.

PROPOSED:

- **Committee size is read off the record, never computed from the combo size.**
- FOUND (`lib/bracketwork.js`, `declaredQuorumFor`): it already clamps to the
  real member count, but when the combo size is not passed it guesses single
  from `members <= 6`. **That guess has to go.** The comment above it says
  committees are 6 and 8; the code's real counts are 8 and 10, so the comment is
  already stale and should be corrected in the same change.
- **Declare the agreement as a share, not a count**, on any run whose committee
  size differs from the last. A count would silently mean two different things.

## H. What it touches, in the order I would build it

1. The chunk builder takes a span, so the extra columns can be built. (The work.)
2. Label sets keyed by band.
3. The member spec gains `from`; the committee becomes base + extras.
4. Per-member score and per-member null (E, and therefore F2).
5. Per-member "how often it spoke" and the floor (F3, F4).
6. The unit carries its extras; a promoted row fills them from `whole look-back`
   and `whole band`.
7. The three-way choice on stage 1, replacing the tick `only what is ticked on
   Coins`. PROPOSED labels, reusing what is on screen: `ignore what is on Coins`
   / `what is ticked under coins and shapes that pass` / `what is ticked from a
   walk set`.
8. Whatever shows all of this on screen — a unit's member count, what each extra
   reads, F1's weights, F3's two numbers. RULE ELEVEN clause 3: if it is stored,
   show it.

**7 must not ship before 3 and 6.** Until the unit carries its extras, options 2
and 3 of that choice do the same thing, and three buttons promising a
distinction the engine does not make is RULE ELEVEN clause 6.

## I. The release number

PROPOSED: I expect this to be a **second-digit** move, not a first. A record
already stores its own member list, so existing sets keep reading, and a stage
only refuses a parent across a **first**-digit change. Adding label sets beside
the existing `labels.test` rather than replacing it keeps that true.

**This must be verified against what is actually on the box before it is
committed to.** If it is wrong it costs the owner every chain, and that is their
call to make, not a session's (RULE ONE-C).

## J. Not verified

- F4: whether any path consuming a promoted unit applies a trade floor today.
- I: the release digit.
- Whether anything besides `declaredQuorumFor` computes a member count from the
  combo size rather than reading the record.

## K. Two false starts, both mine

Recorded so nobody repeats them.

**A unit per setting.** I read "the new selections are used for training" and
built a design where each promoted look-back and band became its own unit, then
costed it at up to 38,080 members. The owner: *"Who said anything about permuting
a bunch of settings from the walk forward? That's your idea."* The right answer
was one unit per promoted row and one extra member on it — 4 to 8 new members
for four units. The screen already said so and I argued past it.

**Refusing a mixed committee.** I claimed a committee cannot hold members trained
against different labels because it would be "voting on two different
questions". For the vote that is simply false: each member casts a call, the
calls are counted, and a member trained on a wider band is just quieter. What is
real is narrower — the pooled score, which section E addresses.
