# QC register

Owner's rule, 2026-07-29: **every time a faulty or incomplete assumption is
caught, it becomes a permanent non-negotiable QC item.** Not a lesson to
remember — an item on this list, with a named place it is enforced.

The test of this document is simple: if an item is marked AUTOMATED, there is
a test or a tool that fails when the fault is reintroduced, and that failure
has been *observed*, not assumed. An item nobody has watched fail is not a
check. Items that cannot be automated are marked MANUAL and say who does what.

Why this exists in this form: every serious defect in this project has been an
**instrumentation** defect, not a maths defect. A broken sweep throws an error.
A broken measurement returns a number with the right units and a plausible
magnitude, and gets built on. Six of the entries below were caught only because
a number looked *encouraging*.

| # | The assumption | What was actually true | The standing check | Enforced in | Status |
|---|---|---|---|---|---|
| 1 | Settings sent to the API reach the sweep | `trailing` and `holdout` were dropped; every "trailing" run had trailing off | Every param the orchestrator reads must be forwarded by the endpoint | `everyBracketParamSurvivesTheApi` (test-bracket.js) | AUTOMATED — verified by deleting the forwarding |
| 2 | A run used the settings its launcher asked for | Only the launcher was checked, never the run | Read the construction back off the run document and compare to the census rows | `classifier-edge-read.sh` (`null construction:` line) | AUTOMATED |
| 3 | "edge > 0 about half the time" is the null | Measured null is ~54%, and it moves | Never assume a null; measure it, and print the measured value beside the result | `classifier-edge-read.sh` | AUTOMATED |
| 4 | Rotations are interchangeable draws of one statistic | Series-scope rotation moved the majority baseline 0.265→0.419, so draws were scored against different yardsticks | Rotate inside each window; hold the baseline fixed; record it per row | `labelShiftScope: 'window'`, `windowRotationHoldsTheBaseline...` (test-bracket.js) | AUTOMATED — verified by mutation |
| 5 | Draws that disagree can still be averaged | −2303's draws spanned 76.5 points and were nearly reported as a market result | Gate at 15 points; refuse to print the comparison when it fails | `classifier-edge-read.sh` GATE FAILED | AUTOMATED — observed failing on −2303 |
| 6 | Every unit in the census is participating | 15% of rotated units never trade, and are scored as wins on flat calls alone (2.4% in the real run) | Print participation, a mute column per draw, and active-only beside all-units | `classifier-edge-read.sh`, `classifier-census-diag.sh` | AUTOMATED |
| 7 | The binomial p-value measures significance | Scrambled data produced pooled p = 0.0047; units are correlated, so the test is invalid | **Never quote a binomial p as evidence.** The measured null is the only yardstick | this register + reader wording | MANUAL — see gap G1 |
| 8 | A screen read off the leaderboard is a census | The leaderboard is money-ranked and capped, so the read was P&L-selected | Census rows are recorded separately and never money-filtered | `doc.edgeCensus` (batch.js) | AUTOMATED |
| 9 | An unknown task kind is impossible | The pool's fallback picked by a two-way guess and would silently run the wrong function | Dispatch by name; unknown kinds are an error | `inlineDispatchRefusesUnknownKinds` (test-pool.js) | AUTOMATED — verified by mutation |
| 10 | The workers are niced because the code says so | Nothing could observe it; `ps` was ambiguous | Ask the workers and read the kernel's number from procfs | `/api/selftest/workers`, `classifier-worker-selftest.sh` | AUTOMATED — PASS observed on the box |
| 11 | `VBoxManage` VMState tells you if a guest is alive | Reported `poweroff` for a guest that was serving mail at that moment | Drop VMState; use the process plus a TCP reachability probe | `host-health.sh` | AUTOMATED |
| 12 | A service that fails to answer is a starved host | IMAP answered while SMTP timed out — it was one daemon, not the guest | Probe a second service on the same host before escalating | `mailvm-postfix-restart.sh` (escalates only if ssh fails) | AUTOMATED |
| 13 | A restart that reports "active" worked | Postfix reported active with nothing listening | Assert the ports, not the unit state | `mailvm-postfix-restart.sh` | AUTOMATED |
| 14 | A long remote command will finish inside the default timeout | A 2-minute cap killed a restart mid-flight and left mail down 3 minutes | Any guest command gets an explicit long timeout; restarts must be safe to re-run | `mailvm-postfix-restart.sh` | MANUAL — see gap G2 |
| 15 | Noticing a message is free | The poller consumed messages by reading them | Monitoring uses the read-only twin only | `claude-mail-recent.sh` vs `claude-mail-check.sh` | MANUAL — habit, see gap G3 |
| 16 | One watcher's marker is its own | Two watchers shared a marker; the first to finish suppressed the second's announcement | Marker is per-job | `watch.sh` | AUTOMATED |
| 17 | A job id passed to a script arrives | The deploy API forwards no arguments; older runs could not be read at all | Selection goes through a committed file | `reports/EDGE-JOB` | AUTOMATED |
| 18 | "The numbers are lost" | They were retrievable; the tooling just did not exist yet | Never report a gap in tooling as a fact about the world | this register | MANUAL — see gap G4 |
| 19 | A hypothesis flagged "cheap to check" will get checked | It did not, until the owner pushed | Anything flagged unverified is either checked in the same session or written down here as open | this register | MANUAL — see gap G5 |
| 21 | A pre-registered metric must never be changed, even once shown to be broken | Pre-registration exists to stop metric SHOPPING (keeping whichever measure flatters you). It does not require keeping a measure proven to count things that cannot express the quantity — that is stubbornness wearing rigour's clothes. Caught by the owner, 2026-07-29 | A metric may be corrected mid-stream **only** when: (a) the fault is argued from MECHANISM, not from the number improving; (b) the correction moves BOTH the real result and the null, not just the favourable one; (c) the old measure keeps being reported beside the new one. All three, stated at the time | this register | MANUAL |
| 20 | Acting on a hypothesis before gathering data is fine | A job was cancelled on a guess; the real cause was contention | Gather the cheap evidence first | `host-health.sh` exists so the question is cheap | MANUAL |

| 22 | A classification score is a trading score | `edge` grades flat calls, which place no trade. A setup with 1 committed call and 130 flat calls was graded almost entirely on the flats | Primary measure is pooled directional accuracy: of the periods where a direction was called, how often it was right | `classifier-census-diag.sh`, CYCLE6-READING-RULE | AUTOMATED (reported) / MANUAL (which measure governs) |
| 23 | Removing non-participants makes two arms comparable | It does not. Real run: 77.6% of setups made 21+ trades; scrambled: 59.8%. The arms still differ after the zero bucket is dropped | Check the whole activity distribution, not just zero; prefer per-decision pooling, which is robust to it | `classifier-census-diag.sh` call-count buckets | AUTOMATED |
| 24 | A unit-level headcount summarises the data | 170 yes/nos discard the 19,913 decisions underneath and inherit flat-call contamination. The headcount overstated the effect ~3x (5.8 pts vs 1.9 pts) | Report the per-decision metric beside any headcount | `classifier-census-diag.sh` | AUTOMATED |

| 25 | One exit code can serve two failures | `claude-mail-send.sh` returned 3 for both "message malformed" (never retry) and "transport failed" (always retry). Any automated caller would have to get one of them wrong | Malformed = 2/3, transport = 4. Distinct codes for opposite responses | `claude-mail-send.sh` | AUTOMATED |

## Open gaps — items not yet enforced by anything but discipline

These are listed because a MANUAL item with no owner is a lie.

- ~~**G1 — binomial p-values are still printed.**~~ CLOSED 2026-07-29. The
  column is renamed `naive*` and carries a footnote stating it is not a
  p-value, is not evidence, and that scrambled data scored 0.0047 on it.
  Item 7 is therefore AUTOMATED to the extent that the misleading label is
  gone; quoting it as evidence remains a judgement rule.
- **G2 — restarts are not proven idempotent.** Item 14's fix is a longer
  timeout, which reduces the chance of a truncated run rather than making a
  truncated run harmless.
- **G3 — nothing prevents the consuming poller being used.** Both scripts
  exist and only habit keeps the destructive one out of monitors.
- **G4 / G5 — no mechanism.** These are judgement rules. The only enforcement
  is that they are written here and get re-read.

## How an item gets added

When a faulty assumption is caught — by anyone, including by the owner asking
a question that turns out to have an uncomfortable answer — it is added here
in the same session, with its status honestly marked. An item added as
AUTOMATED must have had its check watched failing first.
