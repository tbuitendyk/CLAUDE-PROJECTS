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

## Phase 5 — DECIDE
| Term | Phase | Means exactly |
|---|---|---|
| audit | 5 | the written post-run examination (ten fixed questions) hunting flaws in the measurement; no new run until the last run has one |
| register | 5 | the numbered list of every trap ever caught (65 entries), each with its permanent check |

## Retired words — never use again
recipe / trade recipe, cell -> dial combination
experiment -> setup
stretch, slice -> window
quorum -> agreement level (owner-facing text)
luck committee, null arm -> null run
