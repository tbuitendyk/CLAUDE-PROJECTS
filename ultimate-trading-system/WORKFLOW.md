# Construct, start to finish — the recommended workflow

Rewritten 2026-08-21 against the sections that actually render (THIS-RELEASE
point 16). The previous version walked through the Bracket lab, a screen that no
longer exists.

Every tool below says why it exists, how to use it, and when. It also says what
each one is NOT for, because most of the ways to fool yourself here involve
reading a tool as evidence of something it never measured.

**Money claims only ever come from the END of the chain, never the middle.**

The sections of **Construct** run in the order the work is done:

**Data · Sweep · Boards · Verify · History · Tune · Greenlight**

---

## Data — what the system has to work with

**WHY.** Every sweep, null run and tune reads the local candle cache, never the
exchange. A gap in the cache silently shrinks every window, and nothing
downstream will tell you.

**HOW.** The table headed **Data on server** lists each pair with its months and
range, and per row: **refresh to latest**, **trim…**, **purge…**. Below it,
**Download / refresh** takes a comma-separated list of new pairs over a month
range, with **Download** and **Global Refresh**.

**Trim and purge DELETE data.** The only way back is downloading again. Every
write refuses while a job is running.

**WHEN.** Once per new month, and before any run needing months or pairs you
have not loaded.

---

## Sweep — the wide pass

**WHY.** This tries the whole universe against the whole execution menu and
builds the board. Its output is a DIRECTION — promising rows — never a result.
Nothing from this step is evidence by itself.

**HOW.** Set the campaign name first, under **Campaign — the parent job**: every
run fired while it is set hangs off that job, which is what makes the evidence
chain traceable later. Then **Board sweep — wide to FIND (never a result)**:
pick the universe and the window layout, press **Start sweep**. **Stop jobs**
halts what is running. The launcher prints every setting that shapes the result.

**WHEN.** At the start of a hunt, and after any data or engine change that
invalidates the last board.

**NOT for.** Reading a winner off. The board is ranked; ranking is a claim, and
this step has not earned one yet.

---

## Boards — reading what came back

**WHY.** The board holds the rows and, per row, the drills that explain them.

**HOW.** **Asset predictability — best to worst** ranks the assets. Per row:
**menu grid**, **inspect**, **copy settings into the form**, **save notes**.
**What this run actually is** states the run's own settings back to you.

**Two things on this page are easy to misread:**

**Replication — the declared config on every asset.** One fixed configuration,
named before the run, scored once on every asset. This is the repeat-elsewhere
check, and the reading that counts is whether it beat its own null copies.
*It appears here, before Verify, because the sweep computes it — but it does not
become confirmation of anything until the row it belongs to has passed Verify.*
The document this replaced listed it as a later step; on screen it arrives
earlier. Both orderings are defensible and the screen's is the one to follow —
just do not read it as a verdict before the null work is done.

**Inside a setup — a MICROSCOPE, not a null test.** Each member's model, votes
and solo score. For diagnosing WHY a row behaves as it does. Nothing it shows is
out-of-sample and nothing it shows is evidence.

---

## Verify — how good does nothing look?

**WHY.** A board built on informationless votes still produces good-looking
rows; shopping alone does that. Until you have measured how good "nothing"
looks, a good-looking row means nothing.

**HOW.** Three things, in this order:

**Planted check — the instrument's calibration certificate.** A known pattern is
planted in a fabricated market and pushed through the real pipeline, which must
find it while the null versions destroy it. Press **Run the planted check**. The
reading rules are stamped before it runs. A pass holds for that engine version
only — a new release starts unchecked, and the null tools carry a warning until
it passes. **NOT for judging real setups**: the fabricated pair never enters a
real run, and the launcher refuses it.

**Tool 1 — this row against its null runs.** Prices the shopping done inside one
row. Press **Read Tool 1 verdict**.

**Tool 2 — the board against its dealt-vote null boards.** Prices having picked
the best of many.

Chance flatters a board in those two separate ways, so a row must pass both.

**Rotation rounds** also appear here, labelled **a SEPARATE instrument, retired
as evidence**. Read that label: it is kept for continuity and does not count.

**WHEN.** Before ANY row is quoted, promoted, tuned or greenlighted.

---

## History — does the age of the data matter?

**WHY.** A surviving setup was measured with fixed assumptions about how much
history counts. This tunes two time dials — how fast old training data loses
weight, and how often the trade variables are re-picked — per coin, per setup.
Optional, and only worth it on a row that already survived Verify.

**HOW.** **Launch History Tuning on this row**, or **Launch paired age-dial
run** for the newer paired-fold form. **Finished tuning runs** lists results;
**Plateau view — one setting moved at a time, the rest held at your cell** shows
whether a winner sits on a plateau or a knife edge. **Run exam A (late-rule pair
— must find)** and **Run exam B (flat pair — must NOT find)** are the calibration
pair for this instrument: A must find the plant, B must find nothing. Both must
behave before a tuning result means anything.

**Run the reserve grade — one touch, final** grades the winner on history sealed
before the run. One touch means one: it is a single verification event and
cannot be repeated for a better answer.

**WHEN.** Only on rows that passed Verify, and only when the setup earns the
deeper investment. Never mandatory.

---

## Tune — the protective stop and the bet size

**WHY.** This section had no entry in the previous document because it was built
after it was written. It decides two things that change what a configuration
does with real money.

**HOW.** **Protective stop tuner — full-history, loses no winner** sweeps stop
distances over the whole history. **Tune protective stop (full history)** runs
it; **apply custom** sets your own; **No stop (clear)** records a deliberate
choice of no stop rather than leaving a gap; **save the reason** stores why, in
your words, beside the number.

**Conviction sizing — bet more when more members agree?** asks whether agreement
predicts size. **Run conviction sweep (full history)**.

**Compare two runs — NOT a null test.** Lists every setting difference between
two stored runs. A money difference is attributable only when exactly ONE
setting differs. It answers "did this change help?" and nothing else.

**WHEN.** After Verify, before Greenlight.

**A caution this section needs.** Tuning a stop is one more selection on the
same history — another chance to shop. Treat a tuned stop as a claim that still
owes its null work, not as a free improvement.

---

## Greenlight — the decision that a config is fit to trade

**WHY.** The end of the chain. A greenlight is a decision, recorded with who
made it, when, why, the evidence chain behind it and the engine version it was
validated on.

**HOW.** **GREENLIGHT this config**. **Existing greenlights** lists what has
been greenlighted already.

**WHEN.** After Verify, and after History and Tune if they were used.

**What happens next.** The greenlighted configuration appears on the **Trade**
tab, on both sides — **Paper Books** and **Live Trading** — where it can be
activated. Paper is the control arm: a paper book that reports differently from
the live book is worthless as a comparison.

---

## The two standing rules over all of it

1. **Wide finds, narrow confirms.** Sweeps output directions. Only declared,
   one-variable, null-checked measurements output results.
2. **Every threshold is labelled derived or guessed, and every reading rule is
   committed before the numbers exist.** A rule written after seeing the number
   is not a rule.
