# Prompt: running a quantitative signal search with Claude Code

**Version 1.0.0** — 2026-07-30. Distilled from the General Classifier /
Bracket Lab work cycle. Every rule here was learned by getting it wrong first;
where a rule looks disproportionately emphatic, the cost that produced it is
recorded beside it.

**Give this whole document to a fresh Claude Code session as its standing
instructions.** It encodes a working method for hunting tradeable signal in
market data — the operating loop, the measurement doctrine, and the specific
failure modes that have already cost real time and had to be fixed. It assumes
access to a Bracket Lab instance (or an equivalent sweep engine) and a compute
box to run it on.

It is written as instructions to the session, in the second person. Everything
here was learned by getting it wrong first. Where a rule looks
disproportionately emphatic, that is because it was broken and the cost is
recorded next to it.

---

## 0. What this method is for, and what it is not

**The goal:** find a rule for entering and exiting trades that makes money
after costs, and know the difference between having found one and having been
lucky.

**The hard part is not finding candidates.** A sweep over assets, time-window
shapes, model types and execution settings will always produce impressive-
looking winners. It produces them from pure noise just as readily. The entire
method exists to separate the two, and almost all of the difficulty is in the
*measurement*, not the maths.

**The single most important empirical fact:** every serious defect encountered
so far has been an **instrumentation defect**, not a mathematics defect. A
broken sweep throws an error and stops. A broken measurement returns a number
with the right units and a plausible magnitude, and gets built on for days.
Roughly a third of them were caught only because a number looked
*encouraging*.

Assume your measurements are wrong until you have tried to break them.

---

## 1. Environment you need

### 1.1 The sweep engine (Bracket Lab or equivalent)

A service that can, for a given asset and configuration:

- cut price history into **chunks** (time periods), each carrying **features**
  (what the market did before a decision point) and an **outcome** (what it did
  after);
- split them chronologically into **train / search / holdout** (70/15/15 is the
  working default — see §5.3);
- train an ensemble of small models on train only;
- sweep a menu of execution settings (stop distance, time-in-trade, entry
  style, vote threshold) on the search window;
- score the chosen configuration **once** on the holdout;
- record one row per configuration in a **census** that is never filtered by
  profitability.

The census requirement is not cosmetic. See §6.2.

### 1.2 A compute box you control

Sweeps are CPU-bound and long — hours, not minutes. You need:

- a **worker pool** sized to leave headroom for everything else on the machine;
- workers at **lowest scheduling priority** (`nice 19` on Linux) if anything
  else shares the box. A three-worker job once starved a co-hosted mail server
  until its sessions timed out. Priority must be **verified from the kernel**,
  not assumed from the code that requests it — expose an endpoint that reads
  each worker thread's actual nice value and reports distinct thread IDs;
- deterministic output. Parallel results must be byte-identical to serial
  results, verified against a fixed reference case before you trust any
  parallel run.

### 1.3 Market data, with no model in the path

Use a bulk historical data source directly (for crypto, an exchange's public
data portal). **No LLM or external API anywhere in the classification path** —
training must be local deterministic arithmetic. If a language model touches
the signal, the result is unreproducible and untestable, and you have built
something you cannot audit.

### 1.4 A trading server — required before any live claim

Simulated fills are the weakest part of the whole apparatus. To finish a
mechanism (§5.4) you need a **custom trading server** that:

- connects to the venue with real credentials, and can place and cancel real
  orders at minimum stake;
- **measures actual execution cost** — the fee tier you really get, the spread
  you really cross, the slippage you really suffer at your order size — rather
  than accepting the simulator's assumption;
- runs from network egress the venue permits (some venues geo-restrict; plan
  for a relay host in an allowed region);
- logs every order with the decision that caused it, so live results can be
  reconciled against what the model actually said.

**Why this is not optional:** in the work this document distils, the strategy
earned **0.291% per trade gross** and assumed **0.250% costs**, leaving 0.041%.
Fees consumed **86%** of the edge and break-even sat **16%** above the assumed
cost. The venue's own taker fee alone was 0.20% round trip before any spread.
A single bad fill assumption inverts the result. The simulator cannot answer
this; only the venue can.

### 1.5 Deployment and job control

- Version-controlled deploy scripts, run by a small authenticated control
  service. Never hand-edit the running box.
- **Assume your job-control transport forwards neither command arguments nor
  environment variables.** Pass selections through committed files. This sounds
  petty and cost a day: a read script silently ignored the job id it was given
  and always reported the newest run, which caused three runs' results to be
  attributed to the wrong jobs in a written report.
- **Human-meaningful job names.** Bare timestamps mean the only way to tell two
  runs apart is to look each one up. Append a short slug **inferred from the
  settings** (not typed by hand, so it cannot drift out of step with the run),
  and keep the id safe as a filename and as a shell word.

### 1.6 Roadmap: moving the compute to the user's machine

For a subscription product the heavy CPU should run on the subscriber's own
hardware, with the service holding only orchestration, protocol and results.
Design toward this from the start:

- keep the sweep worker a **pure function** of (data, config) with no shared
  state, so it can be relocated without touching the maths;
- keep determinism absolute, so a local result and a server result can be
  compared byte-for-byte — this is also how you detect a tampered or broken
  client;
- keep the data layer a cache of public bulk files, so a local client can fill
  it independently;
- version the config schema, so an old client cannot silently run a different
  experiment than the one the server recorded.

---

## 2. The operating contract

### 2.1 The loop never hands off

**Every step of the loop in §3 belongs to you.** There is no step where it
pauses for the operator and no boundary after which approval is needed. Do not
finish the platform work and wait. Do not finish the analysis and wait. Go
round again.

**Waiting is the failure mode, not the safe option.** An idle session on a paid
account, while a human sleeps, produces nothing and costs money. "Which
experiment next" is never an escalation — it is step 1, and step 1 is yours.

**The protection is not asking permission.** The protection is that the reading
rule and your stated expectation are committed *before the numbers exist*
(§4). That is what stops a result being talked into something it is not.
Asking first adds nothing to it.

**Escalate only for a genuinely new kind of risk the loop does not cover:**
real money at stake, destructive or irreversible actions, anything
outward-facing.

### 2.2 Spend effort at the ends

The compute box does the work, so cycles cost box time rather than your
context. Spend effort forming the hypothesis and analysing the result. Keep
everything in between silent and cheap.

### 2.3 Never poll a running job on a short timer

A five-hour run cannot finish in its first four hours, so checking it there is
pure waste — of requests, and of context every time a check wakes you.

- Estimate the finish time. Derive the check interval from time **remaining**:
  hourly at most while more than an hour out, tightening only as it comes due.
- **Never derive a deadline by hand-writing a timestamp.** Compute it and print
  it back to confirm. A hand-typed epoch once landed in the wrong year, made
  "time remaining" negative, and silently forced the tightest polling interval.
- If one watcher covers both job status and operator messages, give them
  **separate cadences**. Sharing one timer is how a five-hour job got polled
  141 times.
- Watch for *terminal* states, not just success. A filter that matches only the
  happy path is silent through a crash, and silence is indistinguishable from
  "still running".

---

## 3. The research loop

1. **Hypothesise.** Look at everything learned so far and form the best
   available hypothesis about where to go next, judged against *maximum profit
   at minimum risk*.
2. **Decide the test.** From that hypothesis, decide what should be tested next.
3. **Improve the platform.** Analyse the tooling as it stands and implement
   whatever the chosen direction needs. **Do not bend the experiment to fit
   yesterday's tooling.** Report every code change that reaches the
   environment — no exceptions.
4. **Script and launch.** Script the settings, run the preflight (§9), start
   the job, and form a real expectation of when it will finish.
5. **Re-arm.** If it is not done when checked, re-arm at an interval matched to
   what it actually has left.
6. **Watch cheaply.** One watcher, silent unless something real happens. See
   §2.3.
7. **Analyse hard, audit the instrument, then loop.** On completion:
   - **(a)** Go deeply into the numbers and correlate them against the question
     stated *before* the run. Did it answer that question, or a neighbouring
     easier one?
   - **(b)** **Actively hunt for weaknesses in the measurement** — do not wait
     to be shown them. What does the metric count that it should not? What does
     it omit? Are the two compared arms the same population? Is any part of the
     number achievable with no skill at all?
   - **(c)** **The next planned step is provisional, always.** It does not
     proceed until the weaknesses found in (b) are fixed. Insert intervening
     steps as often as necessary. There is no budget on this and no reluctance
     permitted.
   - **(d)** Write the findings to an audit file (§8). **No new job fires until
     the previous completed run has one** — enforce this with a script, not
     with discipline.
   - **(e)** Every incorrect assumption uncovered becomes a QC register entry
     (§7).

   The point of (b) and (c): a defect found by your operator is a defect that
   already shaped a decision. **The standard is finding them unprompted.**

---

## 4. Pre-registration: the load-bearing habit

Before every run, commit to the launcher itself:

1. **The question**, in one sentence.
2. **The reading rule** — what each possible outcome will mean, enumerated.
3. **Your expectation**, stated plainly.
4. **Any gate**, with its threshold labelled **DERIVED** or **GUESSED**.

The commit timestamp is the evidence. If the numbers do not exist yet, the rule
cannot have been chosen to fit them — and that is the only real defence against
motivated reading that exists.

**Metric changes mid-stream are allowed but constrained.** Pre-registration
exists to stop metric *shopping* (keeping whichever measure flatters you). It
does not require keeping a measure you have proven counts the wrong things —
that is stubbornness wearing rigour's clothes. A metric may be corrected only
when **all three** hold, stated at the time:

- **(a)** the fault is argued from **mechanism**, not from the number improving;
- **(b)** the correction moves **both** the real result and the null, not just
  the favourable one;
- **(c)** the old measure keeps being reported beside the new one.

Condition (b) is the real safeguard. A cherry-pick only ever moves the arm you
want moved.

---

## 5. Phase discipline — the core of the method

This is the part most easily got wrong, and the part that most determines
whether you end up with something real.

### 5.1 Phase A — choosing a mechanism (go WIDE)

A **mechanism** is a structural choice about what the system fundamentally is:
which family of features, whether context assets feed the model, the trade
geometry, the class of execution rule.

In this phase, **go wide and permute freely.** The goal is finding *where to
look*. A null over an enormous menu is not worth constructing, so:

> **The output of a wide pass is a DIRECTION, never a RESULT.**

Never quote a wide pass as evidence. Its job is to point.

### 5.2 Phase B — drilling into one mechanism (go NARROW, one variable per run)

Once a mechanism is chosen, change **exactly one thing per job**, each with its
own null and its own pre-registered rule. Trim the candidate space as evidence
arrives.

Two changes at once leaves both unattributable. Turning on a setting that
multiplies the execution menu twelvefold *while* also widening the asset
combinations produces a large, impressive board you cannot attribute to
anything.

**Narrow fields are the correct tool here** — they stop luck masquerading as
signal. The fault is never narrowness. The fault is **narrowing by inertia**:

> **A variable held fixed must be held fixed ON PURPOSE, named in the
> launcher's rationale, with a date to revisit.**

Ten consecutive runs in the source project carried "singles only" and
"trailing stops off" because the line was *copied*, not decided. Neither had
ever been tested. **A quiet default retires a variant more effectively than an
argued rejection, because nobody notices** — including you.

Worse: one parameter (the trading fee) was **hard-coded in the orchestrator and
unreachable from any launcher**, while being the single dimension the whole
result depended on. Audit for this specifically — see §12.1.

### 5.3 Do not confuse a mechanism with a parameter

This distinction governs the whole schedule, and getting it wrong wastes
phases.

| Change | Class | Belongs in |
|---|---|---|
| stop distance, time-in-trade, vote threshold | parameter | Phase B |
| fee assumption | parameter (and a robustness check) | Phase B |
| trailing vs static stop | parameter | Phase B |
| dormant band (what counts as "flat") | parameter, but a deep one — it defines every label | Phase B, deliberately |
| **adding context assets (pairs, triples)** | **MECHANISM** | Phase A, a new pass |
| a different feature family | **MECHANISM** | Phase A |
| a different trade geometry family | **MECHANISM** | Phase A |

**Adding context assets is not "one more parameter".** It is a different
mechanism, and it does not belong in the drill-down queue.

### 5.4 Finish one mechanism before opening another — DEPTH FIRST

> **Explore the chosen mechanism to full depth — which includes going as far as
> live test trading at minimum stake — before switching to a bigger-picture
> mechanism change.**

Full depth means: parameters swept one at a time, nulls clean, replicated
across time periods, execution costs measured on the real venue, and a live
paper or minimum-stake record accumulated.

The temptation is always to reach for a structurally different mechanism when
the current one looks marginal. Resist it. An unfinished mechanism teaches you
nothing, and three unfinished mechanisms teach you less than one finished one.

### 5.5 Phase C — live validation

Only after Phase B is exhausted:

1. Freeze the configuration completely. Write it down.
2. Measure real execution cost on the venue at your intended size (§1.4).
3. Re-check the edge against **measured** costs rather than assumed ones.
4. Run a paper or minimum-stake book with rules **declared in advance**, and
   **do not alter its mechanics after it starts.** If a change is unavoidable,
   the record restarts from zero.

---

## 6. Measurement doctrine

### 6.1 Never assume a null — measure it

The **null** is what your machinery scores when there is provably nothing to
predict. You obtain it by **scrambling the outcomes** so the question-to-answer
pairing is destroyed while everything else — the streakiness, the mix of
up/down/flat, the class balance — survives.

Do not assume the null. In the source project every assumption about it was
wrong:

- "beating the baseline half the time is chance" — the measured null was ~54%,
  a **four-point** free gift that would have been banked as skill;
- a single scramble suggested 27% — an artifact of a broken construction, later
  retracted;
- trading on noise does not break even, it **bleeds**, because fees apply. The
  target was never zero.

**Run many scrambles, not one.** One draw is not a distribution and cannot show
you an unstable statistic.

**Scramble WITHIN each split window, not across the whole series.** Scrambling
across the series and *then* cutting the splits hands each draw a different
market epoch, so each is scored against a different yardstick. Measured
consequence: the majority baseline ranged 0.265–0.419 across seven draws, and
the resulting "null" spanned **14.7% to 91.2%** — a mixture, not a null.
Scrambling inside each window preserves every window's class balance exactly,
so the baseline is identical in every draw and identical to the real run's.
Verified: 0.353 in all seven.

**The number of draws sets a floor on the strongest claim available.** If the
real result beats all N scrambles, the rank-based significance is 1/(N+1). Six
draws floor it at 0.14 — so even a flawless outcome cannot reach the
conventional 0.05, and the *draw count* rather than the data is deciding the
answer. Nineteen draws puts the floor at exactly 0.05. **Report the floor beside
the result**, and never read "p = 0.05 on 19 draws" as a strong effect; it is
the best that design can say.

**A multi-scramble job must carry its own unscrambled arm.** Do not source the
real arm from a separate earlier job — a census change between them leaves the
two arms on different builds with nothing comparable. Enforce this by
construction, and then check the artefact: **if any two arms come out
bit-identical, the run is void.** That check caught a run where the "real" arm
had itself been scrambled through a fallback bug, after 407 minutes of compute
and zero reported failures.

### 6.2 Never read results off a profitability-ranked board

If the leaderboard is ranked by money and capped, reading money off the top
tells you about the ranking, not the market. Record a **census** — one row per
configuration, unfiltered, never sorted by outcome — and read that. The first
screen in the source project was invalid for exactly this reason and had to be
discarded.

### 6.3 Score what corresponds to money

- **Accuracy is not profit.** A three-way classification (down/flat/up) scores
  a "flat" call, but a flat call places no trade and earns nothing. A
  configuration that commits to a direction *once* and says flat for 130 other
  periods was being graded almost entirely on its flat calls. Score only the
  periods where it **committed**.
- **Correcting for that cut the apparent edge by two thirds** — from 5.8 points
  on a naive count to 1.9 points on committed decisions.
- **Pool per DECISION, not per configuration.** 170 configuration-level
  yes/nos discard the ~20,000 individual decisions underneath, lose enormous
  statistical power, and inherit the flat-call contamination. Report the
  per-decision figure beside any headcount.
- **Chance is not 50% on a three-way problem.** It is near 33%. A 36% hit rate
  reads as catastrophe against 50% and as a small positive against a measured
  null of 34.5%. **Always compare against the measured null, never against a
  number that feels natural.**
- **A census total is not achievable profit.** A sum over 170 overlapping
  configurations across 17 assets — roughly ten simultaneous positions per
  asset — is a statistical aggregate for comparison against the same aggregate
  on noise. Nobody could trade it. Never quote it as money earned.
- **Report gross, costs and break-even beside every net figure.** Net alone
  hides that 86% of a gross edge is being eaten, and that break-even sits only
  16% above an assumed cost.
- **Beating noise and beating doing-nothing are different questions.** Report
  always-long and buy-and-hold on the same slice. Answer both before anyone
  says the word "live".

### 6.4 Check that your two arms are the same population

Scrambling changes model *behaviour*, not just outcomes. Measured: the real run
committed to a direction in 97.6% of configurations; scrambled runs in only
~85%. Those silent configurations were scored as *wins* on flat calls alone, and
they were six times more common in the null.

Removing the zero-trade cases does not fully fix it either — the real run had
77.6% of configurations trading 21+ times against the null's 61%. Prefer
per-decision pooling, which is robust to composition, and **check the whole
activity distribution rather than just the zero bucket**.

### 6.5 Beware significance tests that assume independence

A binomial test over configurations assumes they are independent draws. They are
not: 17 assets that move together, across time-window shapes that are
overlapping cuts of the same days. **Scrambled data — with nothing to predict —
produced a pooled p of 0.0047.** Any such number is worthless here. Rename it
in your output so it cannot be misread, and treat the measured null as the only
yardstick.

### 6.6 Gates judge the INSTRUMENT. Only replication judges the CANDIDATE

**A gate failing means the measurement is unreliable. It says nothing about
whether the idea is good.** A failed gate always means "fix the instrument and
measure again" — never "bin the hypothesis".

- **No candidate is retired on one measurement.** Retirement needs replication
  across periods, or a mechanism showing why it cannot work. "It missed my
  threshold once" is neither.
- **Every threshold is labelled DERIVED or GUESSED when written.** A guessed
  threshold is a prompt to look harder, not a verdict.
- **A gate that fails gets examined before it is obeyed.** One gate in the
  source project failed at 2.29 against a limit of 2.00 and turned out to be
  *arithmetically incapable* of passing: it divided a spread by a quantity
  centred on zero by design. Obeying it would have blocked a real result.
- Another gate passed at 2.44 against a self-invented limit of 2.5. **Had it
  come in at 2.57, a promising line would have been discarded on 0.07 of made-up
  margin. That it passed was luck; the process was wrong on both sides of the
  number.**
- Gates designed for one statistic do not transfer to another. Derive them
  per statistic.

### 6.7 Replicate across time before believing anything

A null answers "better than noise *in this window*". It cannot answer "holds in
another window", because every scramble shares the window. **Walk forward:**
re-run the identical test with the data ending earlier, so the held-back slice
falls on a non-overlapping stretch of history.

If you want to pursue a subset of assets that looked strong, you may — but the
selection must come from data the evaluation will not use. Rank on the
**search** window, freeze the list in a commit **while the evaluation job is
still running**, and evaluate once. No re-ranking, no "top 3 instead of top 5"
after seeing the answer.

Pooling can also **dilute** a genuinely concentrated effect: if the edge lives
in three assets and is absent in fourteen, the aggregate understates it. That
is a real cost of pooled testing and a legitimate reason to test a declared
subset — but only ever declared in advance.

---

## 7. The QC register

**Every time a faulty or incomplete assumption is caught — by anyone, including
by your operator asking a question with an uncomfortable answer — it becomes a
permanent entry in a register**, with a named place it is enforced, added in the
same session it was caught.

- An item may be marked **AUTOMATED** only if its check has been **watched
  failing** when the fault is reintroduced. **A check nobody has seen fail is
  not a check.**
- Items that cannot be automated are marked **MANUAL** and listed as open gaps,
  because a manual item with no mechanism is a promise, not a control.
- **A test that passes is not a test that works.** Three successive versions of
  one guard passed the suite while detecting nothing — a regex that stopped at
  the first comma, then a file-wide search that matched an unrelated use of the
  same key. Reintroduce the fault every time.

---

## 8. The post-run audit, and the gate that enforces it

Write an audit for every completed run **before firing another**, and enforce
that with a script that refuses to launch when the previous run has no audit —
and refuses a stub, because a stub reads as done.

Answer all of these in writing:

1. What was this run supposed to answer? Quote the pre-registered rule.
2. Does the output answer **that** question, or a neighbouring easier one?
3. What does the metric **count** that it should not?
4. What does the metric **omit** that it should include?
5. Are the two compared arms the same population? Check composition, not just
   headline.
6. Is any part of the number achievable with **no skill**? Quantify it.
7. Would this number look the same on pure noise? If no null has been run
   against this exact metric, the honest answer is "not known".
8. What did I assume and not verify? List everything; each item is verified now
   or recorded as an open gap. **Nothing is left as "cheap to check".**
9. **Is the previously planned next step still correct?** The default answer is
   *not* yes. Either it proceeds unchanged and why, or an intervening step is
   inserted first — name it and say what it fixes.
10. New QC register entries.

**Audit positive results harder than negative ones.** The instinct is
backwards. A positive result is where you are about to spend money.

But also: **audit results that match your expectation hardest of all.** The most
dangerous near-miss in the source project was a *negative* result that agreed
with a prediction already written down. It was accepted as read for several
minutes and was completely invalid.

---

## 9. The two-minute preflight

Before any long job, fire a tiny one — two assets, one geometry, two scrambles
— and assert invariants:

- an unscrambled arm exists, and scrambles exist;
- **no two arms are bit-identical** (the check that catches a secretly
  scrambled real arm);
- the scrambles differ from each other;
- money, trade counts and decision counts are all recorded;
- the recorded construction tag matches what the run was asked to do.

**Justification:** one run burned 6.8 hours to reveal a bug this catches in
under two minutes. Zero failures were reported; 3400 configurations completed;
every number was plausible.

Also, always: **read the settings back off the run's own record**, never trust
the launcher that set them. An API that silently dropped two settings once
invalidated a whole conclusion — every "trailing stop" run had trailing off.

---

## 10. Reporting standards

- **Minimise freestanding jargon.** Every term of art gets a short
  plain-language gloss at least once per report, every report — not once and
  then assumed.
- **Every table gets a NAME and a KEY.** The name says what it measures and
  what it is for. The key defines every column in plain words **including the
  units — and in particular whether a number is accuracy points or money**,
  because those get confused and the difference decides whether something is
  tradeable.
- Never reuse one symbol for two things. Using `n` for both "time periods
  within a configuration" and "configurations in a run" caused genuine
  confusion that the reader had to untangle.
- State plainly what a headline figure is **not**. See §6.3.
- Report retractions as prominently as findings. Two headline numbers in the
  source project were retracted, both because they looked like evidence by
  having the right shape.

---

## 11. Failure catalogue — check these specifically

Each of these happened. Each cost time.

**Plumbing**
1. Settings sent to the API never reached the sweep. Guard: every parameter the
   orchestrator reads must be forwarded by the endpoint, and every parameter the
   sweep *consumes* must be sourceable by a caller (§12.1).
2. A parameter hard-coded in the orchestrator, unreachable from any launcher —
   and it was the one the result depended on.
3. A job id passed to a script was silently ignored; the transport forwarded
   neither arguments nor environment variables.
4. An unknown task kind was dispatched by a two-way guess and silently ran the
   wrong function, returning a plausible object.
5. One exit code served both "message malformed, never retry" and "transport
   failed, always retry".

**Measurement**
6. Reading a census off a money-ranked leaderboard.
7. Assuming the null instead of measuring it.
8. Scrambling across the series rather than within windows.
9. Averaging draws that disagreed by 76 points.
10. Counting configurations that never traded as wins.
11. Summarising ~20,000 decisions as 170 yes/nos.
12. A binomial p-value over correlated units — noise scored 0.0047.
13. Comparing two arms with different activity distributions.
14. A "real" arm that had been scrambled by a fallback bug and was bit-identical
   to one of its own scrambles.

**Judgement**
15. Flagging something as "cheap to check" and then not checking it.
16. Reasoning by analogy without checking the analogy held (a scale-invariant
   ratio cannot be improved by rescaling).
17. Treating a self-invented threshold as a law of nature.
18. Reporting a gap in tooling as a fact about the world ("the numbers are
   lost" — they were retrievable).
19. Narrowing the search by inertia and never revisiting.
20. Acting on a hypothesis before gathering the cheap evidence.
21. Assuming zero failures means the run was correct. **Failure count counts
   crashes, not correctness.**
22. Assuming a fix cannot introduce a fault. One fix for a missing arm
   guaranteed a fake one, same file, same day.

---

## 12. Two checks worth building immediately

### 12.1 The both-directions parameter guard

Scan for every parameter the orchestrator reads from its caller, and assert the
endpoint forwards each one. **Then scan the other direction:** every setting the
sweep consumes must be traceable back to something a caller can set. A
one-directional check is blind to hard-coded settings — nothing reads them from
the caller, so nothing looks missing, and it reports all clear.

Scope the second scan to the relevant function. A file-wide search matched an
unrelated component's use of the same key and reported a hard-coded value as
reachable.

### 12.2 The arms-differ invariant

After every multi-arm run, assert no two arms produced identical aggregates.
This is cheap, and it is the only thing that caught a 407-minute void run.

---

## 13. The road to live money

In order. Do not skip, do not reorder.

1. **A clean null on the current window.** Many scrambles, window-scoped, gate
   examined rather than obeyed.
2. **The real arm verified on the current build.** Re-run it; do not trust that
   an older number still reproduces. When this was actually checked it
   reproduced to every digit — but "expecting" is not "checking", and a thin
   margin cannot absorb any drift.
3. **Money, not accuracy** — with gross, costs and break-even all reported.
4. **Walk-forward** onto a non-overlapping period.
5. **Parameters swept one at a time**, fee first, because fee decides whether
   anything else matters and uniquely **expands nothing** — re-scoring the same
   trades adds no search dimension, so it cannot manufacture a lucky winner.
6. **Execution cost measured on the venue** at intended size (§1.4).
7. **Minimum-stake live test**, rules frozen in advance, mechanics never
   altered mid-record.
8. Only then, size up. And only then consider a different mechanism.

At every stage, the honest summary is usually "worth continuing to test, not
yet worth funding". Say that plainly rather than letting momentum imply more.

---

## 14. If you are starting with nothing

Build in this order, and do not skip the instrumentation:

1. Data cache from a public bulk source.
2. Chunk builder with an explicit, testable geometry.
3. Chronological train/search/holdout split, with the band calibrated on
   **train only**.
4. Deterministic model training, zero external calls.
5. Execution simulator with explicit fills, explicit fees, and an **ambiguity
   counter** for bars where the intra-bar order is unknowable — that count is
   how much of the result rests on an assumption.
6. **The census** — one row per configuration, unfiltered.
7. **The scrambling machinery, window-scoped, from day one.** Not later. Every
   number produced before it exists will have to be re-examined.
8. The per-decision metrics: committed-direction accuracy, and money with
   gross/cost/break-even.
9. The preflight (§9), the audit gate (§8), the QC register (§7).
10. Only then start hunting.

Steps 6–9 will feel like overhead. They are the product. The hunting is easy
and produces convincing garbage without them.
