# Two sides: what runs on our machine, and what runs on the user's

The owner's design for the subscription product, spoken on 2026-09-28 and
written down here so it is not lost with the conversation. **Nothing in it is
built and nothing will be until the owner says so, part by part.** The order
that produced this file was "write this architecture up as a design doc ... GO
NOW!" — a record, no code, no deploy.

Three kinds of thing are in this file and they are kept apart on purpose:

- **What the owner designed.** Section A, recorded as given, in their words.
- **What I found in the code.** Marked FOUND, with the file or the box reading
  it came from, all of it read on 2026-09-28. These are findings, not decisions.
- **What I proposed.** Marked PROPOSED. The owner has not agreed to any of it
  unless a section says they have.

---

## A. What the owner designed

Said over four messages on 2026-09-28, after three readings of mine that got it
wrong. The wrong readings are recorded in section I, because each one is a thing
a later session could get wrong the same way.

1. "OUR site lives on OUR facilities" — the dedicated server below.
2. "the users must choose their own servers for all SWEEP, DECISION, and TRADE
   activity".
3. "ALL of the heavy CPU related to those activities runs on the users' locally
   configured resources".
4. "but ALL of the functionality that the user is interacting with lives on our
   facilities".
5. "we are going to be splitting up the system such as OUR server feeds down the
   CPU heavy tasks to processes that run on user facilities -- that includes
   everything related to trade monitoring -- when the user opens OUR page it
   shows them THEIR configurations being monitored and decided on THEIR decision
   engine".
6. "same with Construct tasks -- their basic metadata associated with THEIR
   set-ups live on OUR server but the heavy CPU and large dataset storage lives
   on THEIR facilities".
7. "we have nothing to do with THEIR trading platform other than storing the
   metadata and assisting the users' with THEIR set-up via OUR interfaces".
8. **The storage line, in the owner's own words**: "we DO NOT store users' stage
   1,2,3,4 data at all. promoted trading rules yes, probably. all metadata to
   maintain complete control of the environment, definitely".

**The website** carries the promotional material, the new subscriber sign-up
pages, and video-based help content demonstrating every feature. **The core
functionality** is trial and paid user accounts, access to all of the
user-specific interfaces — almost all of what is on screen now, with few
exceptions if any — and admin-only functionality for user account and
subscription actions.

**The planned machine**: IONOS Dedicated Server AR6-32 SSD with Debian 13, 6
cores, 32 GB RAM, 2 × 480 GB SATA SSD, its own IP address.

**Said after the first draft of this file, answering two of its open questions
and giving the reason for the timing:**

9. "promoted trading rules are ours".
10. "polling cadence should be part of the admin-only interface".
11. "the reason i am talking about this now is at this stage the project will be
    moving to the new server for further dev and rollout" — so the machine in
    point 8's spec is not only the production target, it is where the work
    happens from here.

---

## B. The line: what we hold, and what we never hold

This is the section to read first, and the one everything else has to obey.

| | Where it lives | Why |
|---|---|---|
| Stage 1, 2, 3 and 4 record sets | **Theirs, only.** Never ours. | Owner, point 8: "we DO NOT store users' stage 1,2,3,4 data at all." |
| The row stores under them — votes, tau, models, records | **Theirs, only.** | They are the record sets. |
| The price history a sweep reads | **Theirs.** | It is the large dataset of point 6. |
| Promoted trading rules | **Ours.** Settled 2026-09-28: "promoted trading rules are ours". | A promoted rule is a coin, a chunk shape, a look-back and a band — chosen, not computed from prices, so it is metadata by the test below. |
| Every piece of metadata | **Ours, definitely.** | Owner, point 8: "all metadata to maintain complete control of the environment, definitely." |
| Accounts, subscriptions, billing, admin | **Ours.** | They are the product. |
| Exchange keys | **Theirs, and not even readable by us.** | See section H — this is already true today. |

**PROPOSED — what "metadata" means, so the line can be enforced rather than
argued.** A thing is metadata if it is something the owner of the account
*chose* or something the system needs to *find and drive* their facilities. A
thing is record-set data if it was *computed from prices*. On that test:

- metadata: the account, the subscription, which facilities they have and how to
  reach them, a set's name, description and the settings it was launched with,
  which stage it is, its parent, its status, how far it got, when it started and
  finished, what it was launched under (release, measurement block), their
  trading account records and checklists, their greenlights' identities, their
  setups' configurations, and their choices on every screen;
- not metadata, and therefore never ours: units, settings, votes, tau votes,
  saved models, records, tallies, captures, boards, funnel rows, held and
  reserve verdicts, and anything priced from them.

**A set's identity is ours; a set's contents are theirs.** That one sentence is
the whole rule, and every design question below is settled by applying it.

---

## C. FOUND: this pattern already runs, in miniature

The split is not new machinery. One third of it has been running since
2026-09-25 and the owner has been trading paper on it.

- **The engine calls out; nothing connects in.** `engine/main.js` says it in its
  own words — "THE ENGINE CALLS OUT (engine/link.js): nothing listens on this
  machine at all". The trading platform in Mexico City opens a connection to the
  web server and keeps it open. The web server never dials the engine.
- **The web server mirrors what it is told, and draws from the mirror.**
  `lib/live/enginelink.js` holds a mirror per platform (`mirrorFor(t)`), keeps
  its last health, and follows its stream. D9 of `LOOP-2026-09-25-ENGINE.md`:
  "The web box follows each engine's stream and writes each line again in the
  Trade tab's own words, so a setup on the engine and a setup on the old order
  program are drawn by the one path, on both books."
- **The engine is installed by the user, on their machine, by a command the
  interface gives them.** `engine/install/linux.sh`: its own folder, its own
  system user that cannot log in, its own systemd unit, `MemoryMax=300M`,
  `CPUQuota=50%`, `Nice=5`. Nothing on our side can sign in to that machine.
- **What the user presses is on our screens.** The platform's record, its
  install command and its checklist are on Setup's `Compute` tab; the trading
  account and its keys are on Setup's `Account` tab.

**So the shape the owner describes is proven for the trading platform.** What
is being asked for is the same shape for the decision engine and for Sweep and
Construct.

---

## D. FOUND: what is on our disk today, and what the split removes

Read off the box on 2026-09-28: `/opt/ultimate-trading-system/data` is **5.7 GB
for one user** — 65 record sets, one campaign, an owner still exploring. The
three largest single files are **1.37 GB, 0.37 GB and 0.35 GB**, and all three
are row stores under `data/batches/<set id>.rows/`.

That 5.7 GB is exactly what section B says we never hold. **The split takes
essentially all of our per-user storage away**, and what is left — a set's
identity, its settings, its status, its progress — is kilobytes.

**FOUND, and this is the work the split actually is.** Today the screens read
those files *directly off local disk*: `lib/stages.js` holds `SETS_DIR` and
`listSets()`, which reads and parses every set document on the machine it runs
on, and Boards, Funnel, Tune, Held and Reserve are all built from the row stores
beside them. Sweep, Boards, Funnel, History, Tune, Held, Reserve and Greenlight
are therefore *not* screens that merely display metadata today: they compute
from the record sets under them. Moving them to the owner's design means moving
that computation down to the user's facility and bringing back only what the
screen draws. **That is the largest piece of work in this document**, and it is
not a deployment change.

---

## E. PROPOSED: how work goes down and answers come back

Nothing here is agreed. It is written so there is something concrete to argue
with.

**One door per facility, and the facility opens it.** Each of a user's three
facilities calls out to our server and keeps the connection open, exactly as the
trading platform does now. Our server never needs to reach into a user's
network, the user opens no ports, and a facility behind a home router works
without configuration. This is not a new idea; it is what already runs.

**Our server sends work down; the facility sends events up.** A press on our
screen becomes a task on the user's facility — start a stage 1, price a stage 3,
take a decision, place an order. The facility answers with events as they
happen, which we write into the screen's own words, as the Trade tab already
does for the engine.

**What comes up is what a screen draws, and no more.** A Boards table is
thousands of rows; it is computed on their facility and sent up as the page
of rows the screen is showing, not as the set. When they page or sort, we ask
again. This is what keeps section B true under pressure — the moment we keep a
whole table "so the page is fast", we are storing their record set in a
different shape.

**A facility is the authority on its own data; our server is the authority on
identity.** If the two disagree about what exists, the facility wins on
contents, we win on names, status and who owns it.

---

## F. PROPOSED: what our server has to be good at, and what it does not

**Not CPU.** Every heavy thing left the building: the sweeps, the pricing, the
decisions, the orders. What remains is serving pages, holding small records, and
marshalling traffic.

What actually decides whether the machine is right:

1. **Concurrent long-lived connections.** Up to three facilities per user, plus
   their browser. At N users that is 3N open connections doing almost nothing.
   The limits are file descriptors and the event loop, not memory — so this
   should be a cluster of Node processes across the cores from the start, not
   one process. Cheap to design in, expensive to retrofit.
2. **Bandwidth.** Video help content plus every facility's event stream. This is
   the one line to check with IONOS: the traffic allowance, and whether it
   throttles past a cap.
3. **Uptime.** Our server is the entire product surface. **A virtue of this
   design, worth stating plainly: if our server is down, their trading keeps
   running on their own facility** — the decision engine decides and the trading
   platform trades without us. But nobody can see it, change it, sign up or sign
   in.
4. **Backups, off the machine.** What is left on our disk is small and
   irreplaceable: accounts, subscriptions, and the identities and settings of
   every user's sets. Small enough to back up often; important enough that the
   two mirrored disks in one chassis are redundancy, not backup.
5. **Security posture.** Our server becomes the identity and payment store,
   which makes it the highest-value thing we own. It does **not** hold exchange
   keys (section H), and it does not hold anybody's record sets. Both of those
   are worth saying out loud in the promotional material.

---

## G. PROPOSED: the planned machine, against that list

**6 cores, 32 GB RAM, 2 × 480 GB SATA SSD, Debian 13, its own IP.**

- **Suitable, with room to spare.** For a site, an accounts store and a
  dispatcher, this is generous rather than tight.
- **Disk.** With section B held to, per-user storage is kilobytes. Video is the
  only large item and it is bounded. Confirm whether IONOS gives 480 GB mirrored
  or 960 unmirrored — it is a 2× difference, and mirrored is the right choice
  for a paid service.
- **SATA rather than NVMe** is fine once the gigabyte files are not ours. It
  would not have been fine if they were.
- **RAM.** 32 GB is far more than the records need; it is headroom for
  connections and for the mirrors of section E.
- **One IP is enough.** It is not related to the exchange's address restriction:
  that applies to the machine the *trading platform* runs on, which is theirs.
- **Debian 13** ships a different Node major than the current box's 20.x, which
  `deploy/install.sh` assumes. A check before the first install, not a blocker.
- **Growth.** Because almost nothing per-user is stored here, a second machine
  behind a balancer is a later migration rather than a redesign. Worth keeping
  the accounts store separable from the app for that reason.

---

## H. What does not change

- **RULE SEVEN holds, and becomes a product guarantee.** No AI anywhere in what
  ships, on our side or theirs. Every number a subscriber sees is reproducible
  from deterministic code and market data alone.
- **RULE FIVE holds.** Everything a user can do, they originate from our
  interfaces. Nothing is a script somebody remembers to run, and nothing about a
  user's facilities lives only in code.
- **Keys stay theirs, and we cannot read them.** This is already true and is not
  a promise to build: keys are locked in the browser with the engine's own
  public half (`engine/lock.js`), pass through the web server without being
  kept — `server.js` says "The body is read here and handed on; it is not
  written anywhere" — and are stored encrypted on the user's own machine by
  `engine/keystore.js`, which never hands one back. **The commercial product
  should say this plainly**, because it is unusual and it is already built.
- **RULE TWO holds.** Paper Books and Live Trading stay one path.

---

## I. Decided since the first draft

**Promoted trading rules are ours** (owner, 2026-09-28). Section B's table is
corrected. They pass the test in that section: a promoted rule is a coin, a
chunk shape, a look-back and a band that a walk found — chosen and named, not
computed from prices. It is the one thing we keep that came out of a record set,
and it is kept because it is the thing a user trades from, not the working that
produced it.

**The polling cadence belongs to the admin-only interface** (owner,
2026-09-28). It stops being a number in the page and becomes a setting we can
change per deployment without a release — which is RULE FIVE pointed at
ourselves rather than at the subscriber. FOUND, so the numbers it replaces are
on the record: while a sweep runs the Sweep screen asks every **4 seconds**
(`setInterval(swProgress, 4000)` in `public/construct.js`), and the Trade tab's
live view every **3 seconds** when an engine is live (`public/trade.html`).

**PROPOSED, and not agreed**: making the cadence a setting answers how often we
ask, and it does not answer whether asking is the right shape at all. A facility
that pushes when something changes costs one message per change; polling costs a
message per user per interval whether anything happened or not. The admin
setting is worth having either way — it is the brake — but it should not be
mistaken for the fix.

---

## J. Not decided, and three readings that were wrong

**Not decided, and the owner should decide them before the work starts:**

1. **How the browser reaches a facility.** Redirected to it, or proxied through
   our server. Redirect means every facility needs its own name and certificate;
   proxy means our server is in the path for every page even though it computes
   none of them. This drives DNS, TLS and the bandwidth line.
2. **How much of a screen's answer we may keep.** Section E says only what the
   page draws. The moment that becomes "and keep it so it is fast", section B is
   broken quietly.

**Three readings of mine that were wrong**, written down because they are the
natural wrong answers and a later session will reach for them:

- That the user's record sets would land on our server, making disk the
  constraint. They do not. The owner had already said so and I analysed it
  anyway.
- That our server would read their record sets over a link to draw the screens.
  It does not: the computation moves too, not just the storage.
- That our server would be a front door that hands the user off to their own
  facility's interface. It is not: **all of the functionality the user
  interacts with is on our machine**. The interfaces are ours; only the cycles
  and the data are theirs.
