# Post-run audit — job walkforward-20260731-145820-wf1

Engine 1.27.0 (planted-calibrated PASS, all six criteria, same day).
136/136 units scored, 0 failures, 0 thin setups. Reading rules R1-R5 were
committed in scripts/classifier-wf1-launch.sh BEFORE the run fired.

---

## 1. What was this run supposed to answer?

As written in the launcher before launch: "WF1's job is a map: where, if
anywhere, does re-picked machinery keep beating its own drift control
across eras — and each member's per-slice held-back edge is banked as raw
material for the per-coin calibration ledger. WF1 selects nothing
tradeable."

## 2. Does the output answer THAT question, or a neighbouring easier one?

It answers the map question, but the board's SORT tries to answer a
neighbouring one. The rank key is median fold holdout money (R1's
quantity); the question asked is about beating the drift control (R2's
quantity). Sorted by R1, the top of the board is dominated by setups R2
rejects: ETCUSDT daily-4d argmax ranks #2 (median +$10.87) while LOSING
to always-long by $677; BNBUSDT daily-3d argmax ranks #15 while losing to
always-long by $2,571. The setups that actually answer the stated
question — positive median AND positive skill-vs-drift — are 7 of 136:
DOT daily-4d argmax (+$11.55 med, +$1,951 vsL), AVAX daily-4d argmax
(+$8.75, +$1,158), DOT daily-2d argmax (+$2.87, +$2,037), BCH daily-4d
directional (+$2.00, +$1,316), AVAX daily-2d directional (+$1.73, +$860),
AVAX daily-1d directional (+$1.49, +$609), BCH daily-3d directional
(+$1.37, +$718). Three coins: DOT, AVAX, BCH — all in setups where the
machinery mostly earned by LOSING LESS than holding through declines.

## 3. What does the metric COUNT that it should not?

Median fold money counts market drift as if it were skill. In folds where
the coin rose, a long-leaning pick banks the rise; 15 of the 22
R1-"supported" setups fail R2, meaning most of what R1's headline counts
is the tide, not the trader (the same failure mode as QC 54's vsHold,
anticipated here by declaring R2 in advance — the rule worked; the sort
did not respect it).

## 4. What does the metric OMIT that it should include?

- Fee headroom (QC 37): fold money is net of $0.125/leg but the
  gross-vs-fee split is not surfaced per setup; break-even cost is
  unreported. Open: the fold detail files carry trades, so this is
  computable without a re-run.
- Uncertainty on the median: with 30-47 folds a median's sign can flip on
  a handful of folds; no interval is printed.

## 5. Are the two compared arms the same population?

The drift control is computed on exactly the fold's hold slice with the
same timeout horizon, so setup-vs-control is same-population by
construction (contiguous slices, valid per QC 54). Across SETUPS the
usual caveat stands and is printed on the board: one coin's eight setups
re-cut the same days (QC 36/47) — the per-coin table treats a coin as one
evidence unit (R3): 11 of 17 coins carry at least one R1 setup; LINK,
LTC, UNI, ZEC, XRP, SOL carry none in any of their eight cuts.

## 6. Is any part of the reported number achievable with NO skill?

Yes — that is precisely what R2 measures, and most R1 rows are largely
explained by it. Also structural: with ~30-45 folds per setup and 136
setups, some positive medians arise by chance alone. Not yet quantified
(see 7).

## 7. Would this number look the same on pure noise?

NOT KNOWN — and this is WF1's largest open flank. The walk-forward
instrument has a known-answer calibration (planted coins, PASS) but no
NULL DISTRIBUTION on real market data: nothing yet says how many of 136
setups would clear R1+R2 if member calls carried no information. The
board note says "nothing here has faced its noise comparison yet"
honestly, but the comparison instrument itself does not exist for
walk-forward. Until it does, even the 7 R1+R2 setups are unquotable as
findings.

## 8. What did I assume and not verify?

- Assumed the pool's per-unit determinism carries over from the planted
  check (single-process) to the 8-worker run. Not re-verified on WF1
  itself; the planted D1 criterion covered the code path but not the
  worker scheduling. Open gap, cheap to close by re-running one unit and
  comparing to its detail file — queued into the null-instrument work.
- Assumed 8 weeks step/hold from the design doc remain right; WF1's own
  data (assembly transfer horizons) has not yet been read against that.
- Fee sensitivity unprobed (see 4).

## 9. Is the previously planned next step STILL correct?

The loosely planned next steps were the per-coin calibration ledger and
drill-downs nominated by R5. NEITHER proceeds yet. Two intervening steps
are inserted first, per 2 and 7:

a) WALK-FORWARD NULL: build the zero-skill baseline arm — same fold
   harness, member calls replaced by an information-free control (design
   to be declared in its own launcher, calibrated on the planted coins
   first: the null arm must destroy WFSIG's edge). No selection off WF1
   until the null count of R1+R2 survivors is measured.
b) RANK KEY FIX: the board and reader sort by median fold money; the
   stated question is drift-adjusted. Add median of per-fold
   (hold money − always-long money) as the rank key, declared before the
   null run reads anything. Reporting change only; no re-run needed.

R5 note for later: BCH directional across three adjacent shapes
(2d/3d/4d, all positive median, 3d/4d positive vsL) is the cleanest
family candidate for a one-variable drill AFTER the null baseline exists.

## 10. New QC-REGISTER entries

None forced: the drift-domination was caught by a rule declared in
advance (R2 working as designed), and the missing-null gap was stated on
the board before the run. Both are recorded here as open instrument work
(9a, 9b) rather than as caught-wrong assumptions. The worker-determinism
gap in 8 folds into 9a's calibration.
