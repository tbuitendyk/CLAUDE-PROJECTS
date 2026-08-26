# THIS RELEASE — the owner's points

Working document for the Ultimate Trading System build-out.

**How this file works.** The owner dictates points; they are recorded here
word for word, numbered, and dated. Numbers are never reused and never
renumbered. Nothing here is a build order: no code is written until the owner
gives the explicit go for a named batch (CLAUDE.md RULE THREE).

Feasibility remarks are the session's, marked `[feasibility]`, and are kept
visibly separate from the owner's words. Status statements in them were
verified by reading the code on the date shown, not carried over from an
earlier plan.

**A note on two names.** Point 17 renamed the screens: what the owner's earlier
words call **Constructing** and **Trading** are now labelled **Construct** and
**Trade**. Quoted owner text is left exactly as it was said; everything written
by the session uses the current labels. **Paper Books** and **Live Trading** are
the two branches inside Trade and did not change.

Points 1-13 were carried over by owner instruction (2026-08-19) from the
release notes now in `ARCHIVE/NEXT-RELEASE.md`, which is closed. Their
original numbering is cited for traceability. Points 14 onward are new.

---

## 1. Exchange API key capture

*Carried from NEXT-RELEASE point 3 (owner, 2026-08-12). Owner narrowed the
carry-over to the key-capture part only, 2026-08-19: the rest of point 3 —
per-setup configurability and the separable execution engine — is built.*

Owner (2026-08-12):

> Whatever is developed for the Live Trading tab must not require any AI
> intervention to operate. The app WILL capture exchange API keys (owner
> acknowledges the reservation about keys co-located with other functions).
> Design so the trading box can be SPLIT OUT as a separate function,
> configurable in the software one way or the other. **Everything must be
> configurable per trading setup on the Live Trading tab.**

`[feasibility]` Verified 2026-08-19: a setup record already carries a key
reference name, and every path that sends a setup to the browser sends
presence only — "set" or nothing, never the value. What does not exist is any
control for putting a key in. There is no screen, no field, no endpoint that
accepts one.

This point cannot be designed apart from point 6. If keys are stored in a
form we cannot read, then the thing the interface captures is not the key
itself but a package the user's own machine can open. Capture and custody are
one design, and point 6 sets the rule the capture screen has to obey.

Note on naming: the owner's words above say "the Live Trading tab". That tab
is now reached by the control labelled **Trade** (renamed under point 17), and
"Live Trading" is the name of one of the two branches inside it.

---

## 2. Alternate exchange platforms

*Carried from NEXT-RELEASE point 7 (owner, 2026-08-12).*

Owner (2026-08-12):

> A possible future update to the factored-out application: selecting
> ALTERNATE exchange/trading platforms, making the subscription available to
> Americans and Canadians (Binance is unavailable/restricted there).

`[feasibility]` Verified 2026-08-19, and CORRECTED the same day after a closer
read: `lib/live/exchange.js` exists and is a complete Binance adapter, but
**nothing routes through it.** The live code still calls the Binance module
directly. So the seam is written, not wired: a second venue today would mean
changing every call site, which is what the seam was meant to prevent.

The first sentence of this note previously said the seam was real. It is not
yet, and the correction matters because that claim is what would make a
second venue look cheap when it is not. Wiring the live rail through the
adapter is small, contained work — and it is a change to how the trading side
fetches data, so it waits for the owner rather than riding along with a
clean-up.

The work a second venue actually needs is not the data side — hourly candle
geometry is the same everywhere — but the trading side: each venue has its
own fee schedule, its own minimum order sizes and price increments, its own
order types, and its own rules for borrowing to sell short. Those differences
have to live inside the adapter and be visible to the user, because a
configuration validated at one venue's costs does not automatically hold at
another's.

---

## 3. Setup and settings page

*Carried from NEXT-RELEASE point 8 (owner, 2026-08-12).*

Owner (2026-08-12):

> The subscription application will have a setup page for trading account
> settings, possibly API keys, email addresses, etc. — whatever is relevant
> to using the software.

`[feasibility]` Verified 2026-08-19: no such page existed.

UPDATE 2026-08-21: a **Setup** page now exists and is the front door — point 17
built the tab and left it deliberately empty. This point is what fills it.

Worth settling early: the split between this page and point 1. Account-level
things belong here — who the user is, where alerts are sent, defaults. Things
belonging to one trading configuration — its key, its trade size, its
execution machine — belong with that configuration. Deciding the line once
keeps the same setting from appearing in two places with two values.

---

## 4. Compute placement — subscriber machine by default, configurable per function

*Carried from NEXT-RELEASE point 9 (owner, 2026-08-12).*

Owner (2026-08-12):

> - CPU for setup discovery, sweeps, null checks, AND trading itself defaults
>   to the SUBSCRIBER'S LOCAL machine. The interface stays web-based on a
>   server we host/rent; engine components are offloaded by default to
>   subscriber CPU.
> - Our own use of the current software keeps running compute on the VPS.
> - The client will be able to select processing options per function — e.g.
>   local system for crunching permutations, a hosted system for live trading,
>   perhaps a separate hosted VPS to manage trades.
> - All of this must be configurable in the final app; what we build NOW must
>   be at least COMPATIBLE with that split even if not directly supporting it.

`[feasibility]` Verified 2026-08-19: there is a registry of execution targets
with exactly one kind of transport — the control plane reaching out to a
machine we operate. The messages it carries are already plain files with no
transport assumptions baked in, which is the part that matters.

The one constraint to honour from here on: a subscriber's home machine cannot
accept incoming connections. Anything built assuming we can reach out and
touch the worker will have to be rebuilt. The worker has to dial out to us.
Building against messages rather than against reachability keeps every
placement option open, and costs nothing now.

Second consequence, worth stating because it is a benefit and not a cost: if
the trading engine runs on the user's own machine, their exchange key never
has to leave it. That is the strongest possible form of point 6.

---

## 5. Subscriber database, login page, per-user tool set

*Carried from NEXT-RELEASE point 10 (owner, 2026-08-12).*

Owner (2026-08-12):

> The ultimate system will have a subscriber database, a login front page, and
> then access to the tool set and the user's own configurations.

`[feasibility]` Verified 2026-08-19: not built. Every record created by the
live code already carries an owner stamp, so the eventual move to real
accounts is a matter of filling that field in rather than reshaping the data.

The whole surface is currently behind one shared password at the web-server
level. Real accounts mean sessions, password handling, and every read and
write checked against who is asking — which is a different security posture
from a single trusted operator, and should be designed as such rather than
grafted on.

---

## 6. Key custody — we cannot read the keys, and we never trade from our own machines

*Carried from NEXT-RELEASE point 11 (owner, 2026-08-12).*

Owner (2026-08-12):

> - Trading will NEVER be performed from our own facilities.
> - Provide a guided interface for the user to: generate API keys for Binance
>   SUB-ACCOUNTS, and generate a PRIVATE KEY of their own with which their API
>   keys are encrypted before storage on our server.
> - Encrypted API keys live in our database; WE CANNOT decrypt them — no
>   access, by construction.
> - The trading engine — wherever the user configures it (their local machine
>   or a hosted VPS of theirs) — holds that private key and decrypts the API
>   key for use on the trading machine.

`[feasibility]` Verified 2026-08-19: not built. Setups carry a reference name
to a key; nothing stores, encrypts or transmits a key.

The design is sound and standard: our store holds only scrambled text, and
the only place a usable key ever exists is the machine the user runs the
engine on. It resolves the tension in point 1 completely.

Two things the design round has to face plainly. First, losing the private
key is unrecoverable by construction — there is no reset, only starting over
with fresh exchange keys, and the interface has to say so before the user
commits rather than after. Second, the guided walk-through should check the
key it is given actually has the restrictions claimed — trading allowed,
withdrawals not — rather than trusting the user to have ticked the right
boxes.

---

## 7. Show the provenance tree

*Carried from NEXT-RELEASE point 13 (owner, 2026-08-12). Owner narrowed the
carry-over, 2026-08-19: the recording of provenance is built; displaying it
is not.*

Owner (2026-08-12):

> - The Bracket Lab must record EVERY candidate config's full provenance.
> - Job names get organized logically, building on the existing prefix field
>   at the top of the Bracket Lab (the "campaign" field): a GENERAL job name,
>   and then everything run while narrowing toward a candidate — the sweeps,
>   the null checks, the history tuning, whatever else — all lives UNDER that
>   same single job.
> - That provenance is stored with the final result.

`[feasibility]` Verified 2026-08-19: the campaign record exists, runs attach
to it, and a greenlight snapshot carries the chain of evidence with it. None
of that is drawn anywhere the owner can look at it.

So the evidence for why a configuration is trusted exists but is unreadable
without opening files on the server. That is the same fault as point 10 and
it is what Rule Five forbids. The data model is ready; this is a display job.

---

## 8. Show the branching

*Carried from NEXT-RELEASE point 14 (owner, 2026-08-12). Owner narrowed the
carry-over, 2026-08-19: the guided flow is built; branch visualisation is
not.*

Owner (2026-08-12):

> - The sub-tab layout under the UTS Bracket Lab should correspond to the
>   TYPICAL FLOW of narrowing down jobs, so users understand the process as a
>   sequence of steps.
> - Branching is allowed: multiple candidates can share the same starting
>   point and branch out at selections indicating good plateaus, good null
>   sweeps, etc.
> - Net: the Bracket Lab interface is a GUIDED interface that takes the user
>   through the steps.

`[feasibility]` Verified 2026-08-19: the guided sequence is built — the
sections of **Construct** run in flow order: **Data**, **Sweep**,
**Boards**, **Verify**, **History**, **Tune**, **Greenlight**. What is
missing is any picture of the branching: several candidates growing from one
starting point, and where each one split off.

This shares its data with point 7 — one tree, drawn once, read two ways. They
should be designed together and probably built together.

---

## 9. Alerts — setting them up and generating them

*Carried from NEXT-RELEASE point 16 (owner, 2026-08-12). Owner narrowed the
carry-over, 2026-08-19: the other rails are built; alerting is not.*

Owner (2026-08-12):

> Mirror check with auto-disarm, dead-man arm keepalive, intent staleness
> gate, chunk dedup, drift backstop, loss-limit halt, incident alerts to the
> user's email — everything the F1 pilot runs on, generalized to every setup.

`[feasibility]` Verified 2026-08-19: the recheck-and-disarm mechanism exists,
and halting and clearing a halt exist. Nothing in this project sends a
message anywhere. There is no mail code, no alert code, no destination.

Two halves to build, and they are different jobs. Generating an alert is
deciding what deserves one and what it says. Setting it up is the user
telling the system where to send it and what they want to hear about — which
by Rule Five has to be a control on screen, not a value in a file.

One thing that needs the owner's ruling early: whether an alert can be
trusted to arrive. An alert that silently fails is worse than none, because
silence then reads as "nothing wrong". Whatever is built should be able to
prove it is still working when nothing is happening.

---

## 10. The data catalogue — should this be exposed?

*Carried from NEXT-RELEASE point 19 (owner, 2026-08-12). Carried as an OPEN
QUESTION by owner instruction, 2026-08-19.*

Owner (2026-08-12), original point:

> Each user's worker pulls candles directly from the exchange's public
> channel; we never redistribute market data (cleaner legally, no bottleneck
> on us).

Owner amendment (2026-08-12):

> local data is fine, but it must be MANAGED:
> - A **catalog/library under the user's profile that WE control** — a
>   server-side manifest of what data the user's system is supposed to have
>   (pairs, ranges, files/checksums).
> - A **known path** to the user's local data on whatever machine runs the
>   engine — the worker registers where its data lives; never an unknowable
>   scatter.
> - **Missing-data detection and repair:** if the user deletes files locally,
>   the system flags the data as MISSING against the catalog and can REBUILD
>   it (re-download from the exchange's public channel) rather than failing
>   on file-not-found errors.

**Owner question, 2026-08-19: should this be exposed?** — awaiting the
owner's ruling.

`[feasibility]` Verified 2026-08-19: the catalogue is built and working
underneath. It knows what data the system needs, checks what is actually
present, and can re-download what is missing. It is reachable by two
endpoints. Neither **Construct** nor **Trade** mentions it anywhere —
the word does not appear on either screen.

So the state today is: a working feature the owner cannot see, operate or
know the result of. Under Rule Five that is not a gap in polish, it is a
defect.

On the question itself, the session's view, offered as advice and not as a
decision: yes, and the reason is not tidiness. When a run refuses to start or
returns less than expected, missing data is one of the few explanations that
is both common and completely invisible. Without a screen the owner cannot
tell "the system found nothing" from "the system had nothing to look at" —
and those two lead to opposite conclusions about a candidate.

**Owner ruling (2026-08-19) — expose the catalogue in the Data section.**

> expose the catalogue in the Data section

The open question above is closed. The section is the one headed **Data on
server** and **Download / refresh**, under **Data** in **Construct**.

`[feasibility]` on the ruling. Both endpoints already exist — one reads the
required-versus-present comparison, one runs the repair — and the repair
re-fetches through the same downloading the buttons on that section already
do. So this is a screen, not new machinery.

Not a second table. The whole value is a row for something that SHOULD be
there and is not, and today an absent pair simply has no row — which looks
identical to a complete list. The existing table gains a status column and
gains rows for what is missing.

Two things read out of the catalogue code on 2026-08-19, and the second one
has to be settled before the screen is designed.

**It counts only pairs belonging to configurations that are actively
running.** With point 15's fresh start there are none, so the screen
correctly reports nothing required, and goes on saying that until something
is activated.

**It defines what a pair should cover as "from the earliest month already
held, through the current month."** That catches a month going missing out of
the middle of what was there. It cannot catch data never downloaded in the
first place, because a pair with nothing cached has no earliest month to
start from.

That second fact is a mismatch with where the ruling puts it. **Data** is the
section the owner opens before a sweep, so the question it looks like it
answers is "do I have what this run needs?" — and the catalogue as built
answers "has anything I had gone missing?" Both are worth having. They are
different questions, and a screen showing one while appearing to show the
other is how a run gets read as a dead candidate when it was a short shelf.

---

## 11. Subscription pricing

*Carried from NEXT-RELEASE point 21 (owner, 2026-08-12).*

Owner (2026-08-12) — DECIDED DIRECTION:

> - **Trial:** two weeks, everything unlocked, PLUS a permanent free
>   paper-only tier. Free users cost near-zero (compute is subscriber-local,
>   point 9; they fetch their own data, point 19); the paper book performing
>   over time is the conversion funnel, and "subscribe to go live" is the
>   conversion moment.
> - **NOT tied to trade size.** Two structural reasons: (a) unverifiable —
>   the engine and keys live on the user's machine (points 9/11), so size
>   would be self-reported and spoofable, and auditing it would contradict
>   the zero-knowledge privacy posture; (b) posture — flat software
>   subscription keeps the clean "we sell tools" position for US/Canada entry
>   (point 7), while volume-linked pricing has adviser-adjacent optics
>   (lawyer check before ever revisiting) and an incentive-alignment problem.
> - **Tier on what the control plane can see and enforce:** number of
>   concurrent LIVE setups, number of parallel lab campaigns/branches, later
>   multi-exchange access. Sketch: Free (paper only) -> Base (1-2 live
>   setups) -> Trader (~5) -> Pro (unlimited + alternate exchanges when they
>   land).
> - Selling point that falls out: "we can't see how big you trade, and we
>   don't charge you for it."

*(Point references inside the owner's text above are to the old numbering in
`ARCHIVE/NEXT-RELEASE.md`: old 9 is now point 4, old 19 is now point 10, old
11 is now point 6, old 7 is now point 2.)*

`[feasibility]` Nothing built; this is a recorded decision, not a work item
yet. It becomes buildable only after point 5, since tiers cannot be counted
or enforced without accounts.

The one thing this decision quietly requires: the limits chosen — live setups
running, campaigns in parallel — must be things the hosted side can actually
see and refuse. Anything happening only on the user's machine cannot be
counted, which is the same fact that rules out pricing on trade size.

---

## 12. Thorough help system

*Carried from NEXT-RELEASE point 22 (owner, 2026-08-12).*

Owner (2026-08-12):

> A very thorough help system throughout — screenshots and examples
> everywhere, tooltips on everything.

`[feasibility]` Verified 2026-08-19: two help pages existed, both serving
screens this release retired. UPDATE 2026-08-21: both were deleted with those
screens, so there is now no help anywhere in the system, and neither
**Construct** nor **Trade** links to any.

The material to build it from is largely already written, in the method and
workflow documents — the "why this exists, how to use it, when" text for each
tool. What was never done is putting it beside the tool it describes.

One caution learned here: a screenshot goes stale the moment the screen
changes, and a stale picture is worse than none because it is believed.
Anything pictorial should be drawn from the page rather than captured of it,
so it cannot silently diverge.

---

## 13. Guided server selection, setup and verification

*Carried from NEXT-RELEASE point 23 (owner, 2026-08-12).*

Owner (2026-08-12):

> Because the product asks users to distribute engine functionality to
> configurable back ends, the system must provide guided VPS selection and
> setup — pointing users at sensible options (e.g. an AWS server in Mexico,
> or an IONOS VPS in Mexico) — with direct in-product support for performing
> that setup AND verifying it works.

`[feasibility]` Verified 2026-08-19: not built. The execution-target registry
is where it would attach.

The verification half is the half that carries the weight, and it should be
designed first. After a user sets a machine up, the system should run a
visible check and report a plain pass or fail on each item: can this machine
reach the exchange from where it sits, is its clock right, can it write where
the data goes, can it open the key, can it talk to us. Region matters and is
not a detail — exchange access is decided by geography, which is the whole
reason the current trading machine sits where it does.

---

## 14. This is the UTS — everything that is not Construct or Trade is out

*Owner, 2026-08-19.*

Owner (2026-08-19):

> What we are building here is the UTS. The previous tabs on the previous
> system that are not Constructing and Trading — go. All the code, all the
> back end, all the dependencies with those tabs, all the files connected to
> those, drop them all in archive. They are no longer part of our project.

`[feasibility]` The three controls that go are labelled **Research**,
**Bracket lab** and **Paper books**. The two that stay are **Construct**
and **Trade**.

This is a tracing job, not a file move, for two reasons.

**Some of the back end is shared.** Construct runs its sweeps, its
training, its data loading and its calibration check through modules the
Bracket lab also used. Archiving those takes Construct down with them.
The rule has to be: anything reached only by a departing screen goes,
anything reached by Construct or Trade stays — traced module by module
and proved before a single file moves, not judged by name.

**The strip carrying the tab names lives on one of the departing pages.**
The page that Research and Bracket lab sit on is also the page that renders
the row of controls leading to Construct and Trade, and it is what the
site serves at its address. Removing it leaves nothing at the front door. So
this point needs a decision about what the system opens to. Not a blocker,
but the plan has to answer it.

The test suite is in the same position: a large share of it tests the
departing screens. Those tests leave with them, and the runner's list
shrinks to match.

**Owner ruling (2026-08-19) — the front door is the Setup tab.**

> the front door is the Setup tab

That closes the open question above. The address the site serves is the Setup
page (point 17), and the strip of tab names moves there.

One consequence, read out of the two surviving pages on 2026-08-19: neither
carries a tab strip of its own. **Construct** and **Trade** each return
to the rest of the system through a breadcrumb and a control labelled
**Back**, and both point at the page being removed. So the strip is not
merely moved — it has to appear on all three pages, or Construct and Trade
become dead ends the moment the old page goes.

---

## 15. Fresh system, no inherited data — candle files kept

*Owner, 2026-08-19.*

Owner (2026-08-19):

> All data associated with searches and trading that came over from the
> general classifier goes. This is a fresh buildout of the new system with no
> data in the back. The downloaded candle files are kept; everything else
> goes.

Owner clarification (2026-08-19): the currently deployed server keeps running
the old system untouched — the live trading setup and the paper book setup
both continue there. Nothing in this point affects them.

`[feasibility]` Clean. Three facts worth having on record.

None of this data is in the repository. It lives only in a folder on a server,
which the repository deliberately ignores. So this is done on a machine, not
by moving files on the branch.

The candle files sit apart from run records, greenlights, setups and journals,
so keeping them while clearing everything else is a clean split rather than a
filtered delete.

Keeping the candles is what makes the fresh start quick. Re-downloading every
month of hourly data for every pair from the exchange's public download portal
is automatic but slow, and nothing can run until enough of it is back.

---

## 16. Rewrite the workflow document against the Construct sections

*Owner, 2026-08-19.*

Owner (2026-08-19):

> Rewrite `WORKFLOW.md` against the Constructing sections.

`[feasibility]` Each of the document's seven steps was traced to the section
that actually renders it, verified 2026-08-19:

| Workflow step | Section |
|---|---|
| Load data | **Data** |
| The board sweep | **Sweep** |
| Null boards, and the two reads | **Verify** |
| Replication | **Boards** |
| History Tuning | **History** |
| The paper book | **Greenlight**, then the **Trade** tab |

Two things the rewrite surfaces, and neither is a matter of wording.

**The order disagrees with the screen.** The document places replication at
step 6, after the null boards and the two reads. On screen it is read under
**Boards**, which comes before **Verify**. The guided flow and the written
method therefore put the same step in two different places in the chain, and
one of them is telling the user the wrong sequence. Which one is right is a
question about the method, not about the document, and it has to be answered
before the rewrite can be finished.

**One section has no step at all.** **Tune** — the protective stop, conviction
sizing, and the comparison of two runs — does not appear in the workflow. It
was built after the document was written. It needs its own why / how / when
entry, and a place in the chain has to be decided for it.

One further note. The document states in its opening that it is the copy the
interface carries beside each tool. That has never been true of either
surviving screen: neither **Construct** nor **Trade** links to help at
all. The rewrite is worth doing on its own merits, but it feeds point 12
rather than closing it.

---

## 17. A Setup tab in front, and shorter names for the other two

*Owner, 2026-08-19.*

Owner (2026-08-19):

> New tab in front of Constructing called Setup. Constructing tab becomes
> Construct. Trading tab becomes Trade.

Owner clarifications, same day:

> Setup is point 3, but this point just makes a new blank page.

> YOU WILL RENAME ALL THE UNDERLYING FILES BOOKMARKS ARE IRRELEVANT.

> do the front door decision first

So the tab order becomes **Setup · Construct · Trade**. The Setup tab is the
container that point 3 later fills; this point delivers the tab and an empty
page, nothing more.

`[feasibility]` Every place these words render was read on 2026-08-19 before
this note was written.

**What the rename touches on screen.** The two tab controls and the hover text
on each. The browser-tab title and the page heading on each of the two pages.
And two lines of help text inside the Trading page that tell the owner where a
greenlight is minted and where a configuration is activated.

**What must NOT change, and is the trap in this point.** **Live Trading** is
the name of one of the two branches INSIDE that tab, not the name of the tab.
A rename applied to the word "Trading" would swallow it, and **Paper Books**
sits beside it. Both branch labels stay exactly as they are. The tab is being
renamed; the branches are not.

**The underlying files, renamed as instructed.** `constructing.html` and
`constructing.js` become `construct.html` and `construct.js`; `trading.html`
becomes `trade.html`; a new `setup.html` is created. Nine references follow
them: the two links in the tab strip, the script tag on the Construct page,
one cross-link from Construct to Trade, and five test files that read those
pages by path — two of which read the shipped source directly to check that
what the screen shows matches what the code does.

**Sequenced behind point 14, by owner instruction.** The strip that carries
the tab names is rendered by one of the three pages point 14 removes, and it
is what the site serves at its address. The front-door decision in point 14
is therefore taken first; the strip is then built once, carrying all three
names. Building it before that decision means building it twice.

**Owner ruling (2026-08-19): the front door is the Setup tab.** Point 14's
open question is closed, so this point is no longer waiting on it. Setup is
what the site's address serves, and it carries the strip — which by the
reading recorded under point 14 must also appear on Construct and Trade,
since neither has one today and both navigate back to a page that is going.

Until point 3 fills it, the first screen the owner sees is a working strip
above an empty page. That is the intended state, not an oversight.

---

## 18. Seven more places the code says no to the owner

*Owner, 2026-08-23.*

Owner:

> your going to fix this: "The code refuses a second reserve grade on the same
> run."
>
> this is my system. it doesn't refuse what i want.
>
> understand?

and then:

> fix 8 and 9. GO NOW! without deploy of course. the other 7 put in as a new
> point in our THIS-RELEASE markdown document

**Where this came from.** The reserve grade threw on any second grade of the
same run. The owner ruled that out: how many times their own sealed slice gets
read is their call. That fix is done (commit "The sealed slice can be read
again — it counts instead of refusing") — the code counts the looks and says
which one it is in six places instead of preventing the second one.

The session then swept the rest of the code for the same shape and found nine
more. Two are done. **The seven below are recorded, not built. Nothing has
been changed on any of them.**

**The two already done, for the record**, since they were numbered in the same
sweep and are cited by number in the conversation:

- **(8)** `promote top K` was silently reduced to 50. Now it goes through as
  typed.
- **(9)** the board was fixed at 50 rows and set nowhere. It is a box called
  `board rows` now, with no ceiling and its cost printed beside it.

Both are in the commit "The board keeps what the owner says it keeps".

---

### The seven, in the order they were swept

Each names what refuses, where, and what the refusal costs the owner. None has
a decision attached yet.

**18.1 — An eight-week minimum on the sealed slice.**
`lib/batch.js`, in the sweep launcher. A run using the `61/13/13/13 (sealed
exam)` layout over a date range whose sealed slice would come to fewer than
eight weeks is refused outright: *"refused: the sealed reserve would be ~N
weeks — below the 8-week minimum (GUESSED). Load more history."* The message
says the eight is a guess. A guessed number that cannot be overridden is a wall
built out of somebody's opinion. Note it only applies when a month range is
given — a run with `all loaded data` ticked skips the check entirely, so the
rule is already inconsistent about when it applies.

**18.2 — A protective stop tighter than 0.5% is refused, in two places.**
`lib/live/setups.js` (validating a trading profile) and `server.js` (the
stop-apply request). Both quote the same 0.5% floor and the same reason: a
tighter stop fires on noise rather than on real moves. The floor is derived
from the round-trip trading fee — twice 0.25% — so with the fee now settable
per profile (2026-08-23) the floor no longer follows the thing it was derived
from. Two questions here, not one: whether the owner may go below it at all,
and whether it should move with the profile's own fee.

**18.3 — A setup that already has a stop cannot have one tuned.**
`lib/stopsweep.js`. Refuses with *"already has a protective stop … stop tuning
does not apply"*. The reasoning is that a breakout cell already stops at the
far rail and a trailing cell already has a moving stop, so there is nothing to
tune. That is an argument for saying so, not for blocking the scan.

**18.4 — `Tune` refuses a row that uses the `always` gate.**
`lib/batch.js`, twice — once in the History Tuning launcher, once in the paired
launcher. *"activation refused: this row uses the always gate — it enters
regardless of votes, so both tuning dials would act on nothing (owner ruling,
2026-08-02)."* **This one is the owner's own earlier ruling**, cited in the
code. It is listed for completeness rather than as an oversight; keeping it may
well be the answer.

**18.5 — `Tune` refuses the `weekly-8d` chunk shape.**
`lib/batch.js`, same two launchers. The training-days arithmetic was built for
day-stepping chunks, and weekly chunks step seven days, so the floor would be
judged in units seven times too small. The number really would be wrong. But
the honest answer to a number that would be wrong is to mark it wrong and show
it, not to bar the door — the same principle the reserve-grade fix applied.

**18.6 — `Tune` refuses a source run that is not 70/15/15-shaped.**
`lib/batch.js`. Marked in the code as an **ACTIVATION RULE (owner)**: only
`split70` or `61/13/13/13 (sealed exam)` runs may be tuned, because anything
older has no hold window. Another one that is the owner's own rule; recorded so
it is visible rather than because it looks wrong.

**18.7 — The age dial will not run until the instrument exams pass.**
`lib/batch.js`, in the paired launcher: *"refused (R4): …"*. A quality gate on
the owner — the instrument must have passed its own known-answer exams before
this tool will run at all. It is the same shape as the planted check gating
null readings, and the same question applies: should it stop the owner, or
should it stamp the result as taken on an unchecked instrument?

---

### `[feasibility]` What the pattern is, and what a fix looks like

Every one of the seven has the same three-part shape, and the reserve-grade fix
is the worked example of how to take it apart:

1. **The reason is usually real.** In 18.5 the number genuinely would be seven
   times out. In 18.2 a 0.1% stop genuinely does fire on noise. None of these
   were invented.
2. **The reason is about what the ANSWER MEANS, not about who decides.** That
   distinction is the whole of it. A number that means less is still the
   owner's to compute.
3. **So the fix is the same each time:** stop refusing, start recording. The
   run carries what was overridden, the reading rule stamped before anything
   computes says so, the finished verdict says so in its own sentence, and the
   screen says so both before the button and after the run. Nothing is
   prevented; nothing can later be read back as though the condition had been
   met.

Two of the seven — 18.4 and 18.6 — are the owner's own earlier rulings quoted
in the code. Those are not defects and are listed only so the owner can see
every wall in one place and decide which ones stay.

**18.2's second defect is now fixed** (owner order, same day: *"fix the stop
floor so it follows the profile fee"*). The floor was the literal `0.005` in two
files while both comments called it derived from the round-trip fee. It is
derived now — `lib/paper.js` owns it as twice the round trip, so a profile
paying 0.3% a leg gets a 1.2% floor instead of being told 0.5% was safe when its
round trip alone is 0.6%. At the lab rate it comes out at exactly 0.005, so
nothing moved for a profile that has not set its own fee.

**What is still open in 18.2 is the original question, untouched: whether the
owner may go BELOW the floor at all.** It still refuses. Only the number
changed, not who decides it.

No code has been written for any of the seven.

## 19. Compute: the split of compute from the pages, and how far it has got

The owner's design (2026-08-25): compute resources and trading resources go to
user-selected platforms; the Setup page gets a Compute tab where a future user
points a sweep processor platform, a trade decision engine platform, and the
trading platform, with CPU control per resource, starting/stopping/restarting
of the associated services beside it, and a load reading refreshed about every
thirty seconds, under its own independently selectable theme.

**Shipped in this release:**

1. The Compute tab, as designed. Roles and platform lists come from the
   service, never from the page (RULE FIVE); today one platform exists — this
   machine — and the list grows server-side when a runner is registered. The
   sweep launcher READS the sweep role and refuses an unreachable platform by
   name, so the stored choice is enforced, not decorative.
2. CPU control per resource: the worker count and each worker's share were
   already live settings (data/settings.json, honoured at launch and within
   seconds respectively); the tab exposes both, plus a hard per-service
   processor ceiling applied through systemd by the separate always-up control,
   which also does start/stop/restart and the half-second-sampled load reading.
3. The service restart moved here from Boards, where it lived for one day.

**Shipped later the same day, in the owner's loop:**

1. **The tallies.** One definition of the table's arithmetic (tallyOver), a
   full pass run only in a worker thread at the kindest priority, the result
   saved beside the rows with the row count it covers, rebuilt automatically
   when a run finishes and in the background on first open for anything older.
   A saved tally behind the rows is served marked "as of N rows", never as
   finished. Decision on the record: a saved result rebuilt off the answering
   thread, not per-row live state — exact null pairing holds every copy's
   value, 46 million on the owner's run, and that does not belong inside a
   1.8 GB heap beside a running sweep for the same numbers a few minutes
   sooner.

2. **The averages and the records (owner order, 2026-08-25: "change the
   held-back column to avg held-back … show also the avg trades … allow an
   open-records-below arrow").** The every-coin table's money column now
   averages over the rows that recorded a held-back result instead of summing
   them — so a 16-row coin and an 8-row coin read alike — with avg trades
   beside it, and every row carries a records button that unfolds the 8 or 16
   rows themselves underneath. What makes the button affordable: the saved
   tally (now v3) remembers, per coin, WHICH squashed blocks of the store hold
   its real rows, so opening one row unpacks only those blocks — never the
   whole store, whose full walk is the ten-minute freeze the tallies were
   built to end. A v2 save keeps drawing the whole-configuration table while
   its background rebuild brings the averages and the index.

3. **The records name their choices, the tally is held parsed, and the
   titles sit on the baseline (owner orders, 2026-08-26).** A replication row
   now records the decision, band and 24/5 choices that made it (they were in
   hand at the write site and never written) plus the unit's key — so the
   records behind a coin say WHICH settings scored, which is the entire point
   of reading them. Rows recorded before this do not carry the choices and
   the screen says so plainly instead of guessing. The parsed saved tally is
   held in one memory slot guarded by the file's stamp and size — every ask
   was re-parsing a 235,620-entry file on the answering thread — and the
   records button reads its named blocks by exact byte range. The page
   titles and the check's flag now sit on the text baseline beside the
   release and time text, on all three pages.

4. **The existing run's records get their choices back (owner, 2026-08-26:
   "you need to record that information for each row. i'm sure it can be
   recovered" — the owner was right, and an earlier answer claiming
   otherwise had checked only field matching and stated the dead end as an
   impossibility).** The recovery key is WRITE ORDER: one loop appended a
   unit's census record and then its replication rows into two append-only
   files, so both hold the same units in the same order, and lockstep
   matching names every record — including the fixed-band variants that
   agree on every recorded field and can only be told apart by position.
   The names live in a small sidecar of unit spans beside the rows (the
   rows stay byte-identical); it builds in the background off the answering
   thread, kicked by the first press of a records button; a span is named
   only by a census record matching every shared field, skips are bounded,
   duplicate claims within a coin-and-copy group strip every claimant, and
   all counts are saved and shown. The records say their names were
   recovered, not written.

**Parked, with reasons — not dropped:**

1. **The per-configuration row table (detail()).** Opening one configuration's
   rows under a line of the replication table still walks every recorded row
   on the answering thread — the same class of fault as the one the tallies
   fixed, needing a by-label index beside the rows. Its own piece of work.
   (The per-COIN case is now solved by the v3 block index; the per-
   configuration case still needs its own, since one configuration's rows
   touch nearly every block.)
2. **The sweep runner as its own service.** The job contract (settings +
   price-file fingerprint in, rows + progress back, interface owns the record)
   is agreed; the Compute tab is its front end and already speaks in those
   terms. Building it is its own body of work.

## 20. The planted check failed a healthy engine — the reader was blind, not the pipeline

Owner, 2026-08-25: "check what's going on with the failed planted check";
2026-08-26: "fix all GO NOW!"

**What happened.** The gate run of 2026-08-25 was a clean pass on its stored
rows: the real board made +$293.92 on the held-back window, every one of its
four dealt-vote copies lost money, it beat always-long by more than $400, and
no unit failed. The verdict said `UNREADABLE: ... has no real (unscrambled)
money rows`, and UNREADABLE counts as FAIL — correctly, for a run that truly
cannot be read; wrongly here, because the rows were there all along.

**Why.** When the big collections moved to the row store (2026-08-22), a
finished run's document stopped carrying its rows — readers go through a
store-aware layer. Two of the planted check's readers never did: the
completion-time record (saveBatch hands the live document straight over) and
the status readout's re-read of runs still on disk (a raw file parse). Both
saw a document with row counts and no rows. The delete path was the only one
that read properly, which is exactly backwards — the verdict was taken
correctly only at the moment the rows were being destroyed.

**The fix, three layers, each pinned by test and mutation guard:**

1. `gateVerdict` materialises the rows from the store whenever the document
   has none. Every caller now reads the same board however it came by the
   document. (A gate run is one pair and a handful of boards — this is never
   the ten-million-row materialisation the lazy getters exist to avoid.)
2. The kept record carries the reader's version. A record written by the
   blind reader is retaken on the next occasion `recordGate` runs — while the
   rows still exist. A record whose run is deleted is NEVER retaken, whatever
   wrote it: its rows are gone, and retaking it could only manufacture the
   UNREADABLE the kept record exists to outlive.
3. The boot sweep retakes stale-reader records at service start, so the
   wrong FAIL heals on deploy rather than lying in wait for a notes edit.

**What did not need doing:** no re-run. The run on disk is the evidence; once
the reader could see it, the same rows produced the PASS they always were.
