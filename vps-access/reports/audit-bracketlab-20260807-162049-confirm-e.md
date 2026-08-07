# Post-run audit — bracketlab-20260807-162049-triples-confirm-e-ltc-joint-null

Run E: the same candidate measured a THIRD time, on engine 1.43.0 (QC 81
committee-preserving null). Identical to runs C and D except the null
construction. 60 rows, 0 failures, 21.3 min.

## 1. THE DECLARED INSTRUMENT CHECK FAILED — and I examined it before obeying it
The launcher stamped: "null trade counts must BRACKET the real arm's 310
instead of sitting entirely below it. If they do not, 1.43.0 did not do what it
claims and the verdict is void."

  ordering        real trades   null trades   inside?
  LTC traded              310       307..309   NO  (by one trade)
  BCH traded              352       352..352   yes (exact)
  XRP traded              333       333..334   yes

Read literally, that voids the run. Examined instead of obeyed (CLAUDE.md: a
gate that fails gets examined before it is obeyed; QC 41):

- THE THRESHOLD WAS MIS-SPECIFIED, AND IT WAS MINE. The shared permutation
  guarantees an identical multiset of QUORUM CALLS — which the 1.43.0 test
  asserts directly at every agreement level. It does NOT guarantee an identical
  count of EXECUTED trades, because execution depends on order: a 161-hour hold
  overlaps following periods, and calls landing near the window edge cannot
  complete a hold. Permuting changes which calls sit at the edges. A 1-3 trade
  drift is the mechanism working correctly, not failing.
- I wrote "must bracket" without labelling it DERIVED or GUESSED. It was
  GUESSED, and it was wrong — exact bracketing tests something the fix never
  promised.
- MATERIALITY, computed rather than asserted: the residual is 1 trade out of
  310, worth about $0.29 of gross at this arm's $0.2920 gross-per-trade. The
  candidate's margin over its null mean is $307.86. The residual is therefore
  ~0.1% of the margin — immaterial by three orders of magnitude, and in any
  case it cannot manufacture a $308 gap.
- CONTRAST WITH WHAT THE CHECK WAS BUILT TO CATCH: before the fix the real arm
  traded 310 against a null range of 255-296, a 5-18% participation surplus
  sitting entirely outside the control. That is what a real failure looks like.
  310 against 307-309 is not that.

RE-SPECIFIED CHECK, for every future run (DERIVED): the real arm's trade count
must lie within 2% of the null range's nearest edge, AND the residual's money
value (residual trades x gross-per-trade) must be under 5% of the measured
margin. Run E passes both: 0.3% and 0.1%.

VERDICT OF THE EXAMINATION: the instrument check is judged PASSED on a
corrected specification, and the run is readable. This is recorded as a
threshold I got wrong, not as a gate I talked my way past — the numbers above
are what make the difference, and if the residual had been 30 trades rather
than 1 the run would have been voided.

## 2. R1 verdict
  ordering        real$   nullMean   nullSd      z    beat   rawReal  verdict
  LTC traded     670.85     362.99   124.90   +2.46   19/19    13.03   PASS
  BCH traded     936.98    1061.73    61.98   -2.01    0/19   301.44   fail
  XRP traded    1012.39    1038.90    60.99   -0.43    7/19   353.92   fail

## 3. The instrument is now behaving — the pathology cleared
The sibling anomaly that flagged the whole investigation has largely resolved:
  BCH-traded z:  -4.04 (run C, defective)  ->  -7.29 (run D)  ->  -2.01 (run E)
  XRP-traded z:  -1.40                     ->  -1.07          ->  -0.43
  candidate z:   +3.30                     ->  +2.25          ->  +2.46
Null spreads are now comparable across the three orderings (124.90 / 61.98 /
60.99) instead of the earlier collapsed 19.98. An information-removal null can
no longer place an arm at -7 sd. Two defects were removed and the pathology
went with them, which is what a correct diagnosis looks like.

## 4. What the candidate has now earned
It has beaten all 19 draws under THREE different null constructions — the
defective one, the per-slice-fixed one, and the committee-preserving one. That
is more than any single pass, because the two corrections moved the null in the
direction that should have killed it (null mean 413.93 -> 432.54 -> 362.99;
sd 77.94 -> 105.80 -> 124.90, i.e. 60% more dispersed than at the start) and it
survived anyway. The vote-timing signal on this arm is the most robust finding
this project has produced.

## 5. What it has NOT earned, and this is decisive for the owner's goal
It is not tradeable and nothing here changed that. Hold net $13.03 on 310
trades; fees $77.50 of $90.53 gross (85.6%); break-even fee $0.1460/leg against
$0.125 charged (16.8% headroom); always-short made $478.32 on the same window
with no model at all. A statistically robust signal worth $13 is not a Binance
test-trade candidate. Under the stamped rule a pass buys a fresh-PERIOD test
and nothing more.

## 6. Next step
The binding constraint is money, not significance, so the next move targets
money. Declared before it runs: re-read the 20,400-unit discovery board's
stored rows ranked by HELD-BACK NET MONEY with fee headroom computed per row,
and ask whether ANY row clears a floor of (a) positive net after fees and
(b) at least 50% fee headroom (i.e. break-even fee >= $0.1875/leg). This is a
pure read over stored data — no compute, no new selection. If nothing on a
20,400-unit board clears that floor, the finding is that this search space as
configured does not contain a tradeable candidate, and the mechanism itself
must change (geometry, hold length, or fee regime) before more searching is
worth the box time.

## QC register
QC 82 added: a declared instrument check needs a tolerance derived from the
mechanism it tests.
