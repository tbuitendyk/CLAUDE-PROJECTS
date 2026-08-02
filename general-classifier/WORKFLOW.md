# The Bracket lab, start to finish — the recommended workflow

Owner-ordered document (2026-08-03): the way the lab is meant to be
used, in plain language, one step at a time. Every tool states why it
exists, how to use it, and when. This is also the copy the interface
carries after the coming build — each section below becomes the
description shown next to its tool on the page.

## The one-line map

Load data → board sweep → null boards → two reads → (optional)
History Tuning → replication → paper book. Money claims only ever
come from the END of the chain, never the middle.

## Step 1 — Load data (Research tab)

WHY: everything downstream reads from the local cache; a gap in the
cache silently shrinks every window.
HOW: set the month range, press Load Data. The guard refuses while a
job is running.
WHEN: once per new month, or before any run that needs months you
have not loaded yet.

## Step 2 — The board sweep

WHY: the wide pass. It tries every setup (coin × chunk shape ×
decision style) against the whole execution menu and builds the
survivor board. Its output is a DIRECTION — promising rows — never a
result. Nothing from this step is evidence by itself.
HOW: pick the universe, the window layout (80/20, or 70/15/15, or
70/15/15-with-reserve = 61/13/13/13 if History Tuning may follow),
and press start. The launcher prints every setting that shapes the
result, the training floor check, and the reserve length if one
exists.
WHEN: at the start of any new hunt, or after data or engine changes
that invalidate old boards.

## Step 3 — Null boards

WHY: a board built on informationless votes still produces
good-looking rows (shopping alone does that). The null boards measure
HOW good "nothing" looks, so the real board can be judged against it.
HOW: fire the declared number of null-board runs (same sweep, votes
replaced by each member's real vote mix dealt onto random days). The
launcher states the number of null boards and the finest claim that
number allows, before anything runs.
WHEN: after every board sweep you intend to select from — no
selection without them. The pipeline itself must have passed its
planted check first (see Tools below).

## Step 4 — The two reads

WHY: chance flatters a board in two separate ways — inside one row
(the menu shopping) and across the board (picking the best of 170).
One read each; a row must pass both to be called a survivor worth
anything.
HOW: on the finished board, run "This row against its null runs"
(fine-grained, hundreds of draws, prices in-row shopping) and "The
board against the null boards" (prices the selection). Both print
their reading rule and their resolution before they run.
WHEN: before ANY row is quoted, promoted, tuned, or booked.

## Step 5 — History Tuning (OPTIONAL second pass)

WHY: a surviving setup was measured with fixed assumptions about how
much history matters. This step tunes the two time dials (age
half-life for member training; retune cadence for the trade
variables) to strengthen a proven setup — per coin, per setup.
HOW: select one survivor row (70/15/15 structure, vote-using gate —
the control activates only then), press History Tuning. The grid,
the reference pass, live progress, and the decision trail are
automatic. The winner's grade: the sealed reserve if the original
run carried one, else clean older history with the paper book as
the binding word.
WHEN: only on rows that passed Step 4, and only when you decide the
setup deserves the deeper investment. Never mandatory.

## Step 6 — Replication

WHY: one measurement never crowns a candidate (register rule). A
tuned or untuned winner must repeat its behavior somewhere it was
not selected: other periods, other coins, declared in advance.
HOW: replication mode — the declared configuration scored everywhere
with zero shopping freedom. One button, no menu.
WHEN: after Step 4 (or 5), before any real-money conversation.

## Step 7 — The paper book

WHY: the only test with no lookback of any kind — pre-registered
rules trading forward on data nobody has seen. The end of the chain;
the only place "it works" can be earned.
HOW: declare the book (rules, quorum, horizon, floors) from the
verified configuration; the tracker runs it untouched.
WHEN: the final step, always.

## The tools around the chain (and when they are NOT for)

- **Planted check** — WHY: an instrument must be calibrated before
  its readings count. Plants a known fake pattern; the real pipeline
  must find it, the null construction must destroy it. WHEN: before
  trusting any rebuilt or modified null tool; after any engine change
  touching members or nulls. NOT for judging real setups.
- **Compare two runs** — WHY: A/B questions need paired reading with
  the differences named. Lists every setting difference between two
  stored runs; money differences are stamped attributable only when
  exactly ONE setting differs (the one-variable rule as a tool).
  WHEN: any "did this change help?" question. NOT a null test.
- **Inside a setup (inspect)** — WHY: a microscope for one row's
  committee: each member's model, votes, solo score. WHEN: diagnosing
  WHY a row behaves as it does. NOT evidence of anything; nothing it
  shows is out-of-sample.
- **Training floor** — WHY: starved members return plausible numbers.
  Every launch, of anything, refuses loudly below the floor and
  prints its effective training days.

## The two standing rules over all of it

1. Wide finds, narrow confirms: sweeps output directions; only
   declared, one-variable, null-checked measurements output results.
2. Every threshold is labeled DERIVED or GUESSED; every reading rule
   is committed before the numbers exist.
