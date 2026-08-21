# Known faults — found, not fixed

Things found in the system that were **not** repaired, and why. Written in plain
language on purpose: this is a list you should be able to act on without
reading any code.

Everything here was proved, not guessed — each item was checked against the
running system before it went on the list.

Last reviewed 2026-08-21, after a full audit of the tree.

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

## How this file is meant to work

Anything found and not fixed goes here, in plain language, with enough detail to
act on. Fixed items come off it. If something here turns out to be wrong, say so
and it comes off too — a list nobody trusts is worse than no list.
