# GLOSSARY v3 — phases first, every term tagged (owner-ordered, 2026-08-01)

RULES OF THIS DOCUMENT
1. One term per thing, forever. New terms are defined here BEFORE first
   use anywhere. Renames require the owner's approval.
2. THE ESTABLISHED WORD ALWAYS WINS: a term already used in emails,
   tables or screens is never rebranded ("null" stays "null" — the
   one-day-old "luck committee" is retired, not the two-week-old word).
3. Every term is tagged with the phase of system use it belongs to.

## HOW THE SYSTEM IS USED — THE FIVE PHASES

| Phase | Name | What happens |
|---|---|---|
| 1 | GATHER | coin history downloaded from Binance into the box's store |
| 2 | LAUNCH | choose coins / chunk lengths / voting styles (= the 136 setups) and fire the run via a committed launcher carrying the reading rules |
| 3 | WALK | unattended compute, per setup, fold by fold; sub-phases per fold: 3a TRAIN -> 3b PICK -> 3c SCORE |
| 4 | JUDGE | finished numbers read against the yardsticks through the pre-committed reading rules |
| 5 | DECIDE | audit, register entries, owner's call on what happens next |

## Phase 1 — GATHER
| Term | Phase | Means exactly |
|---|---|---|
| candle | 1 | one hour of raw market data for one coin (open/high/low/close price + volume); the atom everything is built from |
| the cache | 1 | the box's store of candles; write-protected while any run computes |

## Phase 2 — LAUNCH
| Term | Phase | Means exactly |
|---|---|---|
| walk-forward | 2-4 | the name of the current fold method: training only ever moves forward through history (train -> pick on the test window -> score on the holdout window -> slide forward). Lives on the BRACKET LAB tab as the default choice of the fold-method dropdown (owner reorganization 2026-08-01); the retired single-split layouts sit in the same dropdown's sweep option |
| setup | 2 defined, 3 executed | one coin + one chunk length + one voting style; the unit of testing; 136 exist |
| voting style | 2 chosen, 3b acts | how members turn readings into votes: most-likely-wins (up/down/flat compete; flat = no trade) or direction-hunter (up vs down; abstains when unsure) |
| launcher | 2 | the committed script that fires a run, carrying the phase-4 reading rules written before any result exists |

**training floor** (phase 2, LAUNCH) — the minimum number of effective
training days a pass must have before it is allowed to run. A pass below
the training floor refuses at launch and prints its effective number
instead of producing a result. First value GUESSED until probe results
let us derive it. ("Effective training days" = the weight-adjusted amount
of training data the members really saw — equals calendar days when no
age discount is applied, shrinks as the discount strengthens.)

**dial pair** (History Tuning) — one age setting combined with one
retune setting; the grid is 35 dial pairs.

**null board** (phase 4, JUDGE) — a companion board from the same sweep
whose members trained on real data but had each member's votes dealt
onto random days (register 66). Powers the board-against-null-board
reading. Set the count on the sweep form; N boards can never claim
finer than 1 in N+1.

**null draw / trail-replay null draw** (History Tuning) — one full
replay of a History Tuning run's grid and calendar on dealt votes,
each draw picking its own winners. Declared count 19 (floor 1 in 20);
repeated seeds refuse.

**reserve grade** (History Tuning) — the one-touch final exam on the
sealed reserve: the winner's walk + the reference pass's walk + the 19
null draws, fired together, once, ever. A failed reserve is a dead
end, never a hint.

**History Tuning** (phase 5, DECIDE; optional second pass) — the
Bracket lab feature that tunes the two time dials on ONE selected
survivor: the age half-life (member training) and the retune cadence
(the five trade variables re-picked every R weeks). Design ledger:
DESIGN-HISTORY-TUNING.md.

**pass** (History Tuning) — one complete run-through of the selected
setup under one dial setting (one half-life x one retune setting).
The grid is 35 passes per split.

**split** (History Tuning) — one train/test/hold placement through
history. Three splits (early/middle/late), expanding training, six
disjoint test/hold windows. NEVER called a fold — fold stays reserved
for the retired walk-forward instrument's step.

**reference pass** — the pass with both dials off: members trained
once with no age discount, trade variables picked once and never
retuned. The untuned baseline that makes "did tuning beat not tuning"
answerable.

**retune** — the re-picking of the five trade variables on recent
data every R weeks. The ONLY word for this ("re-vote" is retired).

**decision trail** — the machine-readable record of every retrain and
retune a pass performed (dates, lookbacks, candidates scored, winners
picked). No trail, no null, no claim.

**reading rule** — the pass/fail sentence stored in the run's record
BEFORE it fires; the results page prints its verdict through it. It
binds the instrument and the session, never the owner.

## Phase 3 — WALK (per setup, fold by fold)
| Term | Phase | Means exactly |
|---|---|---|
| fold | 3 | one step of the walk: 3a train -> 3b pick -> 3c score, slide 8 weeks, repeat; ~25-45 per setup |
| chunk | 3a/3b | a bite of history (1-4 days of candles) a member reads and votes on; windows are made of chunks |
| train window | 3a | all history before the fold; the only thing members learn from |
| member | 3a built, 3b votes | one of six models: three data views (prices / volume / everything) x two learner types (straight-line / flexible) |
| committee | 3a/3b | the six members, retrained fresh every fold |
| test window | 3b | the next 8 weeks; votes are cast here and the menu auditions here |
| vote | 3b | one member's call on one chunk: up, down, or stand aside |
| agreement level | 3b | 1-6: how many members must concur before a trade slot is traded (= trade dial 5) |
| trade slot | 3b/3c | each chunk's built-in trade opportunity: fixed entry moment right after it + the horizon the trade runs in |
| trade dial | 3b | one of exactly five settings turning agreed votes into orders: 1 entry method (market = enter at once in the voted direction; breakout = tripwires above/below, enter on a cross), 2 gate (which tripwires armed: directional = voted side only; active = vote required, both armed, price picks side; always = both armed every slot, votes ignored - the vote-free floor), 3 tripwire distance (multiple of the coin's typical move; untouched tripwire doubles as emergency exit), 4 time limit (max hours open), 5 agreement level |
| dial combination | 3b | one complete choice of all five dials |
| the menu | 3b | all possible dial combinations (a few thousand) |
| the pick | 3b | per fold: the menu auditions on the test window; best-paying dial combination with at least 5 trades is frozen |
| holdout window | 3c | the 8 weeks after the test window, never seen before; the frozen pick trades it once; the only money that counts |

## Phase 4 — JUDGE
| Term | Phase | Means exactly |
|---|---|---|
| board | 4 | the results table, one row per setup, holdout money only |
| always-long line | 4 (computed in 3c) | the tide gauge: going long every trade slot on the same windows; context only, judges nothing |
| null run | 4 (computed as its own phase-3 walk) | the whole system re-run with each member's real vote mix DEALT onto random days per fold (register 66, owner-designed) - zero date knowledge by construction, everything else identical; THE yardstick: real results must beat the null runs'. The earlier slide-off-dates construction leaked knowledge at small offsets and is superseded |
| reading rule | 4 | a pass/fail sentence committed in the launcher before the run fired; results are read only through these |

## The gate between phases

| Term | Phase | Means exactly |
|---|---|---|
| planted check | gate before 4 | fabricated coins with KNOWN answers (a planted pattern, a pattern that dies mid-history, pure noise) run through the real machinery; every engine release must pass all its declared criteria — including proving a null run destroys the planted pattern — before any real run may be read |

## Phase 5 — DECIDE
| Term | Phase | Means exactly |
|---|---|---|
| audit | 5 | the written post-run examination (ten fixed questions) hunting flaws in the measurement; no new run until the last run has one |
| register | 5 | the numbered list of every trap ever caught (65 entries), each with its permanent check |

## Retired words — never use again

- re-vote → retune
- arm (History Tuning context) → pass / reference pass
- arm (as a side of any comparison or two-layout run) → side. (The
  trailing-stop "arm" distance on the sweep form is a different,
  legitimate widget term and stays.)
- fold (for History Tuning placements) → split
recipe / trade recipe, cell -> dial combination
experiment -> setup
stretch, slice -> window
quorum -> agreement level (owner-facing text)
luck committee, null arm, luck test, luck run, luck arm, luck yardstick, luck draw -> null run
fake-coin gate, fake-coin test -> planted check
("luck"/"chance" as ordinary descriptive words inside a sentence are fine;
MINTING NAMES with them is what is forbidden)
