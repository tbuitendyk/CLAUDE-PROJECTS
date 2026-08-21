# The fixing loop — 2026-08-21

Granted by the owner: `LOOP NOW!` — "Make intelligent decisions to fix all of
the defects you found this past round."

## Written down BEFORE any of it was attempted

This is here because RULE SIX says what makes a long loop safe is not the
permission, it is committing to the success rule before the numbers exist. If
the measure is written afterwards it can be talked into agreeing with whatever
happened.

### How "fixed" will be measured

The standing suite already holds 81 findings, each with a fingerprint recorded
before any of this work started. That list is the yardstick, and it was written
by the attacks rather than by me:

```
npm run test:adversarial
```

- A finding that is fixed moves to **"no longer found"** on its own.
- A finding that is NOT fixed stays in **"already known"**.
- Anything a fix breaks appears as **NEW** and fails the run.

So the target is: the "no longer found" list grows, the "already known" list
shrinks, and **NEW stays empty**. I cannot quietly redefine success, because
the finding text and its fingerprint were fixed in `baseline.json` before I
started.

The 67 findings of the independent attack are measured differently — they were
never in my baseline. For each one I act on, the check is a **new test that
fails before the change and passes after**, and I say which. For each one I do
not act on, a written reason.

### The two hard limits I am keeping, loop or no loop

- **Nothing gets armed and nothing already trading changes behaviour.** RULE
  SIX allows building and testing this code and never allows switching it on.
  The new system holds no live setups at all (`data/live` is empty on the box,
  confirmed by the verification script), and the previous generation on port
  8093 — which does hold the owner's real trading and paper books — is not
  touched by anything here.
- **Nothing irreversible.** No history rewriting, no deleting the owner's data,
  no credential changes.

### The order of work, hardest consequence first

1. **The live-money door.** The cross-site guard letting a forged request
   through when it says it came from "null".
2. **Records that lie about themselves.** Setups read back with no checking; a
   state nobody recognises hiding a live channel; two files claiming one id; a
   record's own id used to build a file path.
3. **Money figures that are wrong rather than absent.** The journal dropping
   torn lines in silence; books reporting blanks and broken numbers; the
   Dashboard total gluing text together.
4. **Market data used without a word about its condition.** Invented candles
   becoming entry prices; empty month files counting as cached forever; gaps
   and duplicates passing unremarked.
5. **The arithmetic at the end.** Trade direction, an entry price of zero, the
   committee, the middle of a list, the fee the threshold is tuned at.
6. **The measuring stick.** Refusing comparisons that are not comparable.
7. **What the interface lets the owner choose (RULE FIVE).** Lists written into
   the page that the system already holds.

### Rules that constrain every one of these

- **RULE TWO** — anything that changes Live Trading changes Paper Books
  identically. Every `branch === 'paper'` and `isPaper` point gets checked in
  the same session as the change, and a difference that must exist is said out
  loud.
- **RULE FIVE** — a fix may not add a new list of choices baked into the code.
  Where a choice exists, it comes from the system and reaches the screen.
- **RULE FOUR** — any control added lines up with its section before it ships.
- **RULE SEVEN** — nothing added reaches an artificial intelligence. The suite
  checks this on every run.

### What I expect to happen, recorded now

I expect to close most of section 5 and the blockers of section 6, and to park
the largest RULE FIVE items — driving thirteen dropdowns from the system is a
build, not a repair, and it changes what the owner sees on screen. I expect at
least one fix to break something and be caught by the suite. If none does, I
should be suspicious of the suite rather than pleased with myself.

## The record of what was actually done

Filled in as the loop runs. Every non-obvious choice gets a line.
