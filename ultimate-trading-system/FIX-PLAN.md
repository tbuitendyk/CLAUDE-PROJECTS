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

### Against the measure written above

Started at **81 standing findings**. Ended at **3**, and all three are decisions
with the reason recorded rather than defects left alone. **Nothing appeared as
NEW at any point** — no fix broke something the suite could see. All 515
ordinary tests pass. Seven new test files pin the contracts these fixes create,
so none of it can quietly come undone.

Of the independent attack's 67, **all seven blockers are fixed**.

### The decisions worth recording

- **The cross-site guard now tells PRESENT-AND-UNNAMEABLE from ABSENT.** An
  Origin of "null" is a browser saying it is somewhere that cannot be named,
  which is exactly what the guard exists for. An absent header still fails open,
  deliberately, for the reason already on record: a proxy that strips it would
  break the owner's real button. Verified on the running service, both
  directions.
- **A broken stored record is kept and named, not dropped.** The first attempt
  filtered them out of the list, which is the same fault in the other direction
  — a setup whose configuration stops validating would silently disappear. An
  existing rename test caught it.
- **Nothing unsound trades**, enforced at the single door into a trading state
  rather than at each reader.
- **Which trading cost is correct was NOT decided here.** The tuner and its
  caller can simply no longer disagree by accident: the fee is required at every
  level and each caller passes the one it already prices its own simulation at.
  Choosing the number is a question about how the system is meant to trade.
- **The data checker reports; it does not refuse.** Refusing is a decision about
  what the owner may run.
- **The choice lists are served complete but are NOT owner-editable.** They are
  a pre-registered menu, and letting it be widened after a disappointing result
  is how a finding gets shopped for. RULE FIVE asks that the owner can see and
  choose from everything the system provides — which serving the complete list
  does and the page was not doing.
- **The trading screen's money format was left alone** and the finding left
  standing. The broken halves are fixed; the format is what the owner reads.
- **An empty sub-account key box means leave it alone**, with clearing as its
  own act — the same rule the protective stop already follows.

### What I got wrong, and what caught it

I expected at least one fix to break something and said so before starting. Six
did, and every one was caught:

- A control case demanded a long from 100 to 110 book exactly 10; binary
  arithmetic gives 10.000000000000009. The control worked and was wrong.
- Filtering broken records out of the list — caught by an existing rename test.
- Defaulting the fee inside the member trainer, which is the same silent
  disagreement moved up one level and would have read as a fix.
- Passing the fee three lines before the line that computes it.
- Writing the greenlight anchor's value as 'widest' from its label instead of
  reading it. It is 'region'. An existing test caught it — which is the whole
  reason a name is read rather than inferred.
- Pre-filling the sub-account key box from the detail answer, not having read
  that the reference is deliberately never sent to the browser. The test that
  pins that promise failed, which is how I learnt the intent instead of guessing.

And one that hid a real fault rather than causing one: I verified an
infinite quantity was fixed by printing JSON, and `JSON.stringify` turns
Infinity into null. I read a live Infinity as a fixed value and reported it
working. The suite's own walker, which inspects the object rather than its
printed form, saw through it. Third time this session a check of mine failed in
the convenient direction.

Two attacks also had to be taught the difference between a fix and a fault: the
candle attack was comparing the SHAPE of a reply and could not see a condition
report added to both sides, and the engine attack crashed on code that now
correctly refuses and reported itself broken. An attack that cannot run is never
counted as a pass, which is why both were noticed.

### Left standing, deliberately

The three above, plus the medium and low findings of the independent attack.
Those are described in full in
`tests/adversarial/independent-attack-2026-08-21.json` and were not part of what
the blockers and highs made urgent.
