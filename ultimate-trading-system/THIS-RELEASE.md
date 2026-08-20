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
is now reached by the control labelled **Trading**, and "Live Trading" is the
name of one of the two branches inside it.

---

## 2. Alternate exchange platforms

*Carried from NEXT-RELEASE point 7 (owner, 2026-08-12).*

Owner (2026-08-12):

> A possible future update to the factored-out application: selecting
> ALTERNATE exchange/trading platforms, making the subscription available to
> Americans and Canadians (Binance is unavailable/restricted there).

`[feasibility]` Verified 2026-08-19: one small module stands where an
exchange adapter would go, and Binance is the only implementation. Nothing
else in the live code reaches an exchange directly, so the seam is real and
a second venue is an addition rather than surgery.

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

`[feasibility]` Verified 2026-08-19: no such page exists.

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
sections of **Constructing** run in flow order: **Data**, **Sweep**,
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
endpoints. Neither **Constructing** nor **Trading** mentions it anywhere —
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

`[feasibility]` Verified 2026-08-19: two help pages exist, and both serve
screens this release is retiring. Neither **Constructing** nor **Trading**
links to help at all.

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

## 14. This is the UTS — everything that is not Constructing or Trading is out

*Owner, 2026-08-19.*

Owner (2026-08-19):

> What we are building here is the UTS. The previous tabs on the previous
> system that are not Constructing and Trading — go. All the code, all the
> back end, all the dependencies with those tabs, all the files connected to
> those, drop them all in archive. They are no longer part of our project.

`[feasibility]` The three controls that go are labelled **Research**,
**Bracket lab** and **Paper books**. The two that stay are **Constructing**
and **Trading**.

This is a tracing job, not a file move, for two reasons.

**Some of the back end is shared.** Constructing runs its sweeps, its
training, its data loading and its calibration check through modules the
Bracket lab also used. Archiving those takes Constructing down with them.
The rule has to be: anything reached only by a departing screen goes,
anything reached by Constructing or Trading stays — traced module by module
and proved before a single file moves, not judged by name.

**The strip carrying the tab names lives on one of the departing pages.**
The page that Research and Bracket lab sit on is also the page that renders
the row of controls leading to Constructing and Trading, and it is what the
site serves at its address. Removing it leaves nothing at the front door. So
this point needs a decision about what the system opens to. Not a blocker,
but the plan has to answer it.

The test suite is in the same position: a large share of it tests the
departing screens. Those tests leave with them, and the runner's list
shrinks to match.

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

## 16. Rewrite the workflow document against the Constructing sections

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
| The paper book | **Greenlight**, then the **Trading** tab |

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
surviving screen: neither **Constructing** nor **Trading** links to help at
all. The rewrite is worth doing on its own merits, but it feeds point 12
rather than closing it.
