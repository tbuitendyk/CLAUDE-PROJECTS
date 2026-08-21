# Known faults — found, not fixed

Things found in the system that were **not** repaired, and why. Written in plain
language on purpose: this is a list you should be able to act on without
reading any code.

Everything here was proved, not guessed — each item was checked against the
running system before it went on the list.

---

## MOST OF THIS FILE IS NOW HISTORY (2026-08-21)

You asked for the defects found this round to be fixed, and they were. Of the
**81 findings** the standing suite held, **78 are fixed** and 3 are decisions
rather than defects. **All 7 blockers** the independent attack rated are fixed.

Sections 5 and 6 below are kept as the record of what was found and what it
meant, because the reasoning is worth having. Each one now carries its state.
The live list — what is still standing and why — is always:

```
npm run test:adversarial
```

**What is still standing, all three by choice:**

- **A name may contain markup or a line break.** Left accepted on purpose: you
  may type any character you like into a name, and refusing them takes a choice
  away for no benefit. It is safe because both screens turn a name into plain
  text before drawing it, and the suite checks that on every run. It stays on
  the list because the safety depends entirely on that continuing to hold.
- **The two screens format money differently** — signed to four places on the
  trading screen, dollars to two on Construct. The broken halves are fixed:
  neither will print a nonsense value as money any more. What is left is
  presentation you read every day, and changing it is your call.

**And three things about the box's own data, which are observations rather than
faults in the code** — the code now reports all of them, which is what was
missing (see section 5j).

Last reviewed 2026-08-21, after a full audit of the tree, the first runs of
the adversarial suite (section 5) and a separate independent attack (section 6).

---

## 1. Two live-money controls — FIXED 2026-08-21

Both are repaired and deployed. Kept here, struck through, until you have seen
them working; then they come off.

~~**The master switch armed on an empty request.**~~ It now refuses anything
that does not explicitly say yes. The **START engine** button sends that yes,
and was changed in the same breath so the real control still works. **STOP** was
not touched — stopping must never be harder than starting.

~~**The stop control had no cross-site guard**~~ — it now has the same one its
twin has always had.

~~**An empty request was recorded as "you chose no stop".**~~ Clearing the stop
must now be said out loud. **No stop (clear)** already says it, so both real
buttons work unchanged; only silence is refused.

Checked against a running server, not just by reading: an empty request, no
request body at all, and a request saying `false` are all refused; the real
press succeeds; clearing with an explicit null succeeds; a cross-site attempt is
refused.

**ONE THING I DID NOT CHANGE, deliberately.** The cross-site guard still lets
through a request that does not say where it came from. That is on purpose and
was tested for on purpose — a proxy that strips those headers would otherwise
break your real button. A browser always says where it came from, so a genuine
attack from another website is still blocked. What that gap allows is a script
on the server reaching the control, and what stops that now is that the control
demands an explicit instruction. If you want the gap closed as well, that is a
separate decision with a real cost: it can break the button.

**STILL OPEN ON THE OLD SYSTEM.** The system that is actually trading runs from
a different branch and did not receive this fix. It still arms on an empty
request. Applying it there means changing a running trading system, which needs
its own go-ahead.

---

## 2. Things the system does that no screen lets you see or control

Your standing rule is that everything the system can do must be reachable from
the interface. These are the places it is not. None of them is broken — each one
works, and you simply cannot get at it.

**How the members are trained.** Each configuration can either freeze its
training at a fixed date or keep retraining as new results land. The code calls
this the deployment decision. There is no control for it anywhere, and nothing
sets it. *(The panel that displays it was reading the wrong place and could
never show a value; that part is fixed.)*

**How many positions a configuration may hold at once.** Worked out by a formula
in code. The execution machine enforces it. Nothing shows it and nothing sets it.

**The next decision, before it happens.** Every producer run works out the
committee's forthcoming call and how each member voted, and writes it down.
Nothing serves it and no screen shows it.

**Whether you have the data a setup needs.** The system keeps a statement of
every candle month the active setups depend on, checks what is actually present,
and can re-download what is missing. Both halves answer, and no screen asks. So
a setup can be missing data with nothing anywhere saying so. *You already ruled
this one should be exposed, in the Data section — it is point 10 of your list.*

**Clearing a halt at the machine level.** Pressing it writes a request. Nothing
reads that request back, so you cannot tell whether it was picked up. This is the
same fault that was already fixed once for the per-setup halt.

**Changing a setup's state, including retiring it.** The whole state machine —
and the reason you write when you move a setup between states — is reachable
over the wire and by no screen.

**Deleting a draft setup.** No page in the app ever issues a delete of any kind,
so a setup created and never run can only be removed by hand.

**What the sweep searches.** The grid of execution settings a search explores can
be set over the wire, and the launch page never sends it. So what gets searched
is decided by constants in the code rather than by you.

**How many processor threads a heavy sweep uses.** Read from a settings file that
no control writes. Only the pace of each worker is adjustable from the screen.

**The fingerprint that decides whether two runs are comparable.** Recorded for
every run, named on screen as the thing that decides it — and no route can serve
the detail, so you cannot open it.

**The greenlight-to-setup door exists twice** — once over the wire with no
control, once inside the program. Only the second one is used.

---

## 3. Decisions waiting on you

**The exchange adapter.** There is a complete, working piece of code whose job is
to sit between this system and an exchange, so that adding a second exchange
later is an addition rather than a rewrite. Nothing routes through it — the live
code still talks to Binance directly. So the separation it promises does not
exist yet. Either wire it in (small, contained, but it changes how the trading
side fetches data) or delete it and stop claiming the separation is there.

**The forward-book scorer.** About a hundred lines that score a pre-registered
forward book. Nothing calls it and no screen shows its results. The books it
scores no longer exist on this system. Delete it, or decide it is a capability
worth reconnecting.

**One endpoint kept on trust.** A route that answers "which pairs does this
system need" has no caller in this repository, but its own comment says checking
scripts elsewhere read it. That could not be verified from here. It was kept.

**Minute-by-minute confirmation is gone.** The code that re-checked a result
against minute data was deleted: no screen reached it, and it called a function
that no longer exists, so it would have failed after doing the expensive part.
Worth knowing because it was the only thing that bounded a particular
uncertainty — when a price bar touches both your target and your stop, nothing
in hourly data says which came first. If that matters later, it needs building
properly rather than restoring.

---

## 4. Smaller things

**The two screens remember light and dark separately.** Construct and Trade store
the choice under different names, so switching on one and moving to the other
flips it back. Setup deliberately shares Construct's.

**One module has no tests.** The code that renders the anatomy block on the Trade
screen — what the committee is and how it is put together — has no coverage at
all.

**The endpoint check misses some addresses.** The test that claims to probe every
address the Trade screen calls silently skips any the page builds by joining
pieces together, so three are never checked.

**A test no longer matches its name.** One called "both reserved pairs are
refused everywhere" lost two of its three checks when the code they tested was
removed. It now proves one thing and claims three.

**Two fabricated pairs came across with the candles.** The data carried over to
the new system includes the two made-up pairs the calibration check uses. They
are generated, not downloaded, so strictly they should not have travelled.
Harmless — the check regenerates them.

---

## 5. What the adversarial suite found — 58 items, ALL BUT THREE NOW FIXED

A standing test now attacks the system on purpose: `npm run test:adversarial`.
It asks the opposite question to the ordinary tests — not *does this work*, but
**given something broken, what does the system show you?** A refusal is a pass.
A crash is a pass. What fails is an ordinary-looking answer worked out from
something that should have been refused, because that is the only kind of fault
that reaches a trading decision without anyone noticing.

None of this is repaired. Every one of them needs a decision from you first,
and finding a fault is not permission to change it. The full list with the
reason each is on hold is in `tests/adversarial/baseline.json`; the suite passes
while only these come back and fails the moment something new appears.

**The good news first, because it is real.** 3,142 hostile requests were fired
at all 71 addresses the system answers on, twice over — once against an empty
system and once against one holding real candles, a real setup and a real
journal — empty requests, wrong types, names
four thousand characters long, paths trying to climb out of the folder, broken
JSON, bodies bigger than the stated limit. Not one produced a crash, a leaked
file path, or a made-up number. Oversized bodies were refused. Nothing could
poison the running program. **Zero findings on the front door.** Separately:
nothing in the shipped code can reach an artificial intelligence of any kind,
nothing reaches any outside address except the public market-data service,
nothing rolls dice in a path that decides anything, training the same model on
the same data twice gives the identical answer to the last digit, and paper
money is never folded into the real total. **The data actually on disk is
clean** — every stored file parses, all 13 candle months hold the full number of
hours with no holes, no duplicated hours, no impossible prices. And **no control
on any screen calls an address the server does not answer**, including the 25
addresses the pages build by joining pieces together, which the ordinary
endpoint check skips.

### 5a. The market data is read without any check at all — 9 items

**This is the most serious group, and it is the foundation everything else
stands on.** A month of candles that is short, has a hole in it, has every
candle twice, is in the wrong order, is empty, has prices that are not numbers,
has prices of zero, or has negative prices is loaded **without a word**. A rule
tested against that month gets scored on data that is not what it appears to be,
and the score comes back looking perfectly normal.

Worked example: a month that stops a third of the way through loaded as 240
hourly candles where 744 were expected. Nothing said so.

What a fix looks like: the Data section reports what it actually has, month by
month — how many candles, how many missing, how many unusable — and a sweep
refuses to run on a month that fails. Both of those change what you see and
what the system will let you do, which is why they are your call.

### 5b. A crash mid-write silently shrinks your books — 2 items

A trading journal with one line cut in half — exactly what a crash while writing
leaves behind — is read as though that line was never there. Nothing anywhere
says a record was lost. Money made, money lost, and the number of trades are all
then confidently wrong, and look exactly like correct answers.

A journal file containing nothing readable at all is reported as **present with
no events** — which on screen is indistinguishable from a book that has genuinely
never traded.

### 5c. Money figures the screen cannot work out — 12 items

When a stored record carries something that is not a number where money belongs,
three different things happen and none of them is right:

- The book reports the money made or lost as **blank**. On screen a blank reads
  as "nothing traded", not as "this figure could not be worked out".
- Some figures come through as **NaN** or **Infinity** and are printed on screen
  exactly like that.
- The Dashboard headline total is worse: a profit stored as the text `"5"`
  instead of the number 5 produces a top-line total of **"05"** — two figures
  stuck together as text rather than added up.

What a fix looks like: one decision from you about what a screen shows when a
figure cannot be worked out — a dash, a word, a marked-broken row — and then the
same answer everywhere.

### 5d. The two screens format money differently — 1 item

Given the same unusable value, the Construct page shows `—` and the Trade page
shows `NaN`. **In 9 of the 11 cases tested, the two pages disagree.** Two screens
describing the same system that disagree leave no way to tell which one is
right. Construct's version looks like the correct one, but which to keep is
yours to say.

### 5e. Names and configurations accepted too loosely — 5 items

A name that is an object is quietly turned into the text `[object Object]` and
accepted; a name that is a number becomes the text of that number. You never
typed either, and both appear on screen as though you did. A traded symbol given
as a number is accepted as a valid symbol. Names containing markup or line
breaks are stored unchanged — currently harmless, because both pages make text
safe before drawing it, but only for as long as that stays true.

### 5g. Thirteen dropdowns offer a list written into the page — 13 items

Every one of these lets you pick only from what somebody typed into the code.
Nothing on screen says so, and there is no way to add to any of them from the
interface:

`swGeom` (chunk shape) · `swDec` · `swLayout` · `swDecEntry` · `swDecGate` ·
`swDecD` · `swDecT` · `swDecTrail` · `swDecArm` · `swDecQ6` · `swDecQ8` ·
`ht2hl` · `glTarget`

Two of them are worse than the rest, because **the system already holds the
list and the page keeps its own copy**: the chunk-shape dropdown duplicates the
geometries the system implements, and the entry-style dropdown duplicates the
entry styles the system accepts. Add one to the system and the screen will never
show it.

This is RULE FIVE — what appears in the interface is yours to decide, and a list
baked into the code takes that decision away without saying so. Not changed,
because deciding what those lists should contain and where they should come from
is exactly the decision the rule reserves for you.

### 5h. The measuring stick itself — 6 items

The score is the arithmetic that decides whether a rule is any good, so a fault
here does not look like a fault. It looks like a rule that works.

**The important part passed, and it matters.** Always answering the commonest
outcome — which takes no skill at all — scores an edge of exactly zero. Flipping
a coin, over sixty separate runs, averages an edge of zero and comes out
positive in exactly 30 of 60. A caller that is right every time scores a clear
positive edge, so the measurement can see a real effect rather than being blind
to everything. Those three together are most of what one wants from a
measuring stick.

**What it does badly is anything that is not a fair comparison:**

- **Fewer answers than questions.** A run that only half finished is scored as a
  run that did badly — accuracy 0.125 rather than a refusal. Those two mean
  completely different things and the score cannot tell them apart.
- **No answers at all** is scored as getting everything wrong.
- **More answers than questions.** The extra ones are dropped without a word, so
  a caller misaligned with the test data scores as though it were aligned — in
  the test above, a perfect 1.000.
- **Answers that are not one of the three outcomes**, or that arrived as text
  rather than as numbers, are counted as ordinary wrong answers. A rule whose
  answers came through in the wrong form scores zero and reads as a rule that
  does not work.
- **A quiet period scores as a perfect discovery.** If every outcome in the test
  period is the same, the edge comes out at 1.000 — a perfect find, in a period
  where there was nothing to find. It happens because the yardstick is the
  commonest outcome in the *training* data, and a quiet test period may hold
  none of it. The honest figure already sits right beside it in the same result
  (0.000), so the arithmetic knows; it is the headline number that misleads.

### 5i. A version stamp nothing reads back — 2 items

Every stored setup is written with a note of which record-shape it was made
under, and the same for its configuration. The point of that note is that a
later version of the code can notice a record it does not fully understand.

**Nothing anywhere reads it back.** A record written by an older or a newer
version of the system is treated as though it were current, silently. Today
there is only one version so nothing is wrong yet; the moment the shape changes,
old records start being read as though they meant what new ones mean.

What a fix looks like: decide what should happen when the system meets a record
from another version — refuse it, show it on screen as needing attention, or
bring it up to date — and then do that. Which of those it should be is a
decision about what you see, so it is yours.

### 5j. What the box's own data looks like — 3 items, checked on the machine

The checks above run against a working copy holding 13 candle files. The box
holds **2,712**, and those are the ones every number the system reports is
actually computed from. The read-only check has now been run against them
directly. It writes nothing, and proves that rather than claiming it: every file
under `data/` is fingerprinted by path, size and modification time before and
after, and the two came back identical.

**The data is in better shape than the raw numbers first suggested.** 20
symbols, 2,697 hourly months. Every file parses. No duplicated hours, no
candles out of order, no prices that are not numbers, none at or below zero,
none with a low above its high, no torn journals.

What there is:

- **286 months are missing hours from the middle of a pair's history.** Small
  amounts — mostly 1 to 11 hours out of a 720- or 744-hour month, worst case 32.
  These look like ordinary exchange outages, present in the data as published
  rather than damage done here. **Nothing anywhere says so.** A sweep over one of
  those months is scored as though the month were complete.
- **292 months have a break in the middle** — the same files, seen from the
  other side: they are short *because* of the break.
- **15 files hold one-minute candles that nothing can read.** The download code
  takes an interval and no caller ever passes anything but the hourly default,
  so these were fetched by something that is no longer here. They sit on disk
  and no screen can show you they exist (RULE FIVE).

**A number I first got wrong, and how.** The check originally reported 304 short
months, which reads as an alarm. Twenty of those were each a pair's *first*
cached month — short because the pair had not started trading yet, which is not
a fault at all. The check now works out the first and last month per symbol and
leaves them out, and reports how many hours are missing rather than only that
some are. 286 is the real number.

### 5k. Three places the suite deliberately does not reach

Said out loud so the coverage claim stays honest:

- The two addresses that download market data from the internet are **not**
  attacked. Firing junk at them would either pull real files down or hang on the
  network, and neither tells us anything.
- The front-door sweep runs twice — once against an empty system, once against
  one holding real candles, a real setup and a real journal. Even then only **4
  of 23** plain addresses had more to say on the second pass, so most addresses
  are still being asked about records that do not exist. That ground is covered
  by the other attacks, which call the code directly rather than through an
  address.
- Nothing here opens a browser. The screens are checked by running their real
  formatting helpers and by reading the code that draws them — not by looking at
  a rendered page.

---

## 6. A second, independent attack — 67 more, all 7 blockers now fixed

Everything in section 5 came from the standing suite I wrote. A separate
attacking session went at the same system without my harness, 73 attackers over
four hours, and reproduced 67 findings under challenge — including 7 it rated
as blockers. It reached places my suite did not, because it attacked the
arithmetic and the engine internals with knowledge of what the numbers are
supposed to mean, rather than only feeding them rubbish from outside.

**FIXED 2026-08-21** (owner direction): all seven blockers, plus the
cross-site guard, the threshold-tuner's fee, the money arithmetic, and the
record checking. What remains of the 67 is the medium and low findings; each is
still described in full in the record named at the end of this section.

**What I checked myself before writing this down.** I did not take these on
trust. I reproduced the two most serious in this session, by hand:

- **The cross-site guard on the live-money controls lets a forged request
  through** when it carries the word "null" where the sending page's address
  should be. I read the code, then ran it: a request claiming to come from
  `https://evil.example` is correctly refused with a 403, and the identical
  request claiming to come from "null" is **allowed**, and disarms the engine.
  So are "file://" and an address that is not an address. A page inside a
  sandboxed frame, or one opened from a `data:` or `file:` address, sends
  exactly that — so this is a positively cross-site request that the guard was
  built to stop and does not.

  **This corrects something already written in section 1 of this file.** That
  note says the remaining gap is a request that does not say where it came
  from, and reasons that "a browser always says where it came from". A browser
  in a sandboxed frame *does* say — it says "null" — and the guard treats
  saying "null" as not saying at all. The decision recorded there was made on a
  premise that turns out to be wrong, which is why it is worth revisiting.

- **The threshold that decides whether a directional trade happens at all is
  tuned against the wrong trading cost.** The tuner prices its candidate
  thresholds at 12.5 cents a leg — it never passes a cost, so the paper default
  takes over — while the live signal path declares a cost of zero. There is no
  way to tell the tuner otherwise; it takes no such argument. I built a set of
  periods whose edge sits near that cost and ran it: the two assumptions pick
  **different thresholds** (0.55 against 0.50) and trade a **different number of
  periods** (38 against 45). On data with a strong edge they agree, so this
  bites exactly where the edge is thin — which is where it matters.

Eleven of these are now pinned in my standing suite as permanent tests, so they
cannot come back unnoticed once they are dealt with. The rest are recorded here.

### The seven rated blockers — ALL FIXED

1. **Nothing checks a stored setup when it is read back.** 16 of 18 deliberately
   broken setup files read back as valid, and the list the box trades from is
   built straight out of them.
2. **A setup whose state is a word the system does not know disappears from the
   Trading tab while its real-money channel stays live** — and its Deactivate
   control refuses, saying the channel is not active.
3. **Two files claiming the same setup.** The screen reads one, the box's
   trading list reads the other, and stopping that setup stops only one of them.
4. **A hole of one to three hours in the candles is invented, and the invented
   price becomes a trade's entry price.** A test that fabricated a three-hour
   outage turned a $0.25 loss into a $5.75 profit at a price that never traded.
   Both runs report the same 181 chunks and report nothing missing.
5. **A month file holding an empty list counts as a cached month forever.** It
   contributes no candles, is never reported missing by either loading path, and
   can never be repaired — and the downloader itself writes that file if the
   published format ever changes.
6. **"Save routing" overwrites the setup's real sub-account key with the literal
   word "set"** — the placeholder text from the box on screen. Every screen then
   reads "Key: set" in green and the setup stays eligible to trade, pointing at
   a sub-account that does not exist.
7. **The threshold that gates every directional trade is tuned at the wrong
   cost** (verified above).

### All 67, by where they were found

#### The front door — 9

- **high** — CSRF guard on the live-money controls fails OPEN for Origin: null (sandboxed-iframe / data: URL forgery)
- **high** — purge accepts impossible / reversed keep-ranges and silently wipes the entire cache
- **medium** — margin-floor (live liquidation guard) accepts arrays and hex strings as the risk number
- **medium** — clipUsd (per-trade dollar notional) has no upper bound and accepts arrays
- **medium** — stop-apply accepts an array as the live protective-stop fraction
- **medium** — inspect quorum is unbounded above the committee size and answers impossible questions with '0 trades'
- **medium** — keyRef set to whitespace reports 'set' on every screen but the live gate treats it as missing
- **low** — greenlight and relabel accept non-string names, storing '[object Object]' / 'x,y' / 'true' and propagating them to money-holding setups
- **low** — campaign name accepts numbers and booleans (coerced to string)

#### The shape of stored records — 15

- **blocker** — The setups registry has no reader-side validation at all — 16 of 18 hostile files read back as valid setups, and the box allowlist is built straight from them
- **blocker** — A state value outside STATES hides a LIVE real-money channel from the Trading tab and makes its Deactivate control refuse
- **blocker** — Two files claiming one id: the screen reads one record and the box's allowlist reads the other, and stopping the id stops only one of them
- **high** — The record's OWN id field is used to build filesystem paths after only the URL parameter was validated — arbitrary .json write and unlink, answered HTTP 200 ok:true
- **high** — branch.geometry accepts any Object.prototype key — the setup is created, armed to LIVE, and its screen describes a strategy of "undefinedh" windows and "NaN numbers"
- **high** — A record whose id disagrees with its filename is listed and allowlisted for real trading, but every control on it answers 404
- **high** — POST /api/live/setups/:id/config writes any trainPolicy value without validation — the deployment's training freeze can be set to something the reader then refuses or silently ignores, on a LIVE setup
- **high** — A live setup whose file becomes unparseable vanishes from every list with no error anywhere — and pairs.js documents the opposite behaviour
- **medium** — getBatch rebuilds the summary on read, swallows the TypeError, and returns null — a saved run that lists in the picker but reads as "does not exist"
- **medium** — The execution-target registry is unvalidated and fails OPEN: any non-array `symbols` makes the box serve every symbol, and a numeric entry passes the gate
- **medium** — The `schema` field is written on every setup and never read anywhere — a record from a future schema version is consumed as if it were current
- **medium** — clipUsd on a LIVE setup has no bounds beyond finite-and-positive — 5e-324 and 1e308 are both accepted and become the box's max_clip_usd
- **medium** — Greenlight readers accept scalars, empty objects, a missing WHY, a missing snapshot and an unknown anchor — and the shuttle mints a live-trading draft from a greenlight whose target is 'whatever-i-like'
- **low** — validatePolicy puts no upper bound on a frozen trainPolicy's throughMs — a deployment can be labelled "frozen" while training through the year 5138
- **low** — getCampaign returns campaign names that setCampaign refuses, and a non-string campaign name reaches the campaign selector list

#### The market data — 12

- **blocker** — A 1-3 hour hole is invented into candles and becomes a trade's entry price — the fabricated money is indistinguishable from real money
- **blocker** — A month bundle holding `[]` is counted as a cached month, contributes zero candles, is never reported missing by either load path, and can never be repaired — and the downloader itself produces that file on any CSV format change
- **high** — Every non-finite feature is silently replaced by exactly 0 — a broken price makes volatility, trend and correlation read as a perfectly calm, perfectly uncorrelated market
- **high** — A corrupt month bundle costs a whole month in "all loaded data" mode with no report of any kind, while every coverage number still counts it
- **high** — A month file holding another month's candles reports 720 candles that do not exist — the count the owner reads is higher than the number of distinct hours loaded
- **high** — Timestamps not on the hour load in full and are counted in full, but are invisible to the chunker — 4368 candles produce 149 chunks instead of 181
- **high** — Duplicate timestamps: which of two conflicting prices becomes the truth is decided by the order they happen to sit in the file
- **medium** — Month numbers 00 and 13 are accepted from disk and served by /api/data-state as the data range — the typed input is validated, the on-disk input is not
- **medium** — A stray out-of-range month file makes the chunker consider 1,827 starts and drop 1,645 of them — and the count is discarded, so the run reports the same 181 chunks either way
- **medium** — Inside a day-file month, a torn or empty day file is skipped by design — 24 hours vanish with no missing report and unchanged coverage
- **medium** — String prices are silently coerced through the label path but corrupt the range feature to 0, and are stored as strings in the chunk record
- **low** — A price of 1e308 passes straight through as a finite feature value of 9.7e+305

#### The screens — 15

- **blocker** — "Save routing" overwrites the setup's real sub-account key reference with the literal string "set"
- **high** — One journal pnl written as a string nulls the whole book's realized P&L; the screen reads "—" above a table of banked trades
- **high** — An unparseable heartbeat timestamp silently suppresses the "EXECUTOR SILENT" banner — a dead box renders as a healthy one
- **high** — Dashboard "Realized (all live)" prints the sum of the books it could read and calls it the sum of every book
- **high** — stopCell renders "NaN%" and "Infinity%" in green with "applied to every order" — the exact reassurance its own comment says it stopped giving
- **medium** — Paper Books never shows "EXECUTOR SILENT" or the box HALT banner — an undeclared difference between the two sides
- **medium** — dashTotals turns its accumulators into strings on the first string input: two $10 books total +1010.0000
- **medium** — An open position missing side and qty renders the literal word "undefined" in both columns, and the unknown direction is coloured red (SHORT)
- **medium** — A whitespace-only sub-account key reads as "Key: set" in green on Setup detail while Greenlights says the config has no sub-account
- **medium** — A failed 30-second auto-redraw leaves the previous render's money on screen, and the banner that appears only warns about panels that look empty
- **medium** — The Setups table and the Setup detail tile render a zero or below-fee protective stop as a plain percentage, contradicting stopCell on the same page
- **low** — Two columns on the Daily decision history carry the wrong description or none at all — TH.outcome and TH.call are defined and wired to nothing
- **low** — Duplicate entryUtc key in TH: the Open positions "entry" heading silently shows the decision-history description, with a hardcoded 97h
- **low** — The fee-per-leg comparison has a tooltip and a passing test but no tile — the number the server computes never reaches the screen
- **low** — Dashboard cards label each book by its generated id, not the name the owner gave it

#### The engine arithmetic — 16

- **blocker** — tuneTau prices its ladder at a hard-wired $0.125/leg while the live path declares feePerLeg: 0 — the two disagree and the tau that gates every directional trade is wrong
- **high** — predictBoost returns a normal-looking probability triple summing to 1 from an all-NaN or completely EMPTY feature vector
- **high** — logreg predict and predictMember return a definite SHORT from a NaN feature or from a feature vector shorter than the model, and silently ignore extra features on a longer one
- **high** — A zero entry price yields pnl: Infinity counted as a real trade, and bestCell then selects that cell over the genuine winner
- **high** — A chunk whose label-window price is zero is LABELLED from a division by zero instead of being dropped
- **high** — scoreDiff labels an exactly flat move as DOWN at a zero band, and a NaN band behaves identically to a zero band with no error
- **medium** — features.js silently rewrites every non-finite feature to exactly 0, so one bad candle reports zero volatility and zero trend beside a 100% drawdown
- **medium** — median is order-dependent and returns a plausible number when the list contains a NaN, contradicting its own header
- **medium** — balancedBandPct is order-dependent with a NaN present and can itself return NaN, which then makes every chunk directional
- **medium** — bestCell ignores the minimum-trade floor when it is undefined or NaN, and will return a cell whose net is NaN
- **medium** — trainMember emits boost calls from 2 training chunks, with the declared 75/25 split silently turned into 1/1 by negative-index slicing
- **medium** — pearson returns 1.0000000000000002 for a series against a scaled copy of itself, and the four cross features bypass the finiteness guard the per-asset features get
- **low** — pnlAt prices any direction that is not exactly the number 1 as a SHORT, so a string '1' from a JSON round trip books a 100% gain as a 100% loss
- **low** — voteOf silently discards any label that is not -1/0/1, letting a minority carry the committee; superOf at quorum 0 returns LONG from an empty committee
- **low** — An all-NaN accuracy ladder makes tuneAndTrain silently return the weakest lambda, and an empty validation set makes trainBoost return a one-tree stump
- **low** — Cached candle JSON is re-read with no revalidation, so parseKlineCsv's non-positive-price guard protects only the download path

The full detail for every one — the attack, what was observed, what was
expected instead, and how to reproduce it — is kept with the suite at
`tests/adversarial/independent-attack-2026-08-21.json`. Several entries there
carry a `correction` field where the attacker re-checked its own claim and
narrowed it; those corrections are part of the record and worth reading before
acting on the entry above them.

---

## How this file is meant to work

Anything found and not fixed goes here, in plain language, with enough detail to
act on. Fixed items come off it. If something here turns out to be wrong, say so
and it comes off too — a list nobody trusts is worse than no list.
