# Post-run audit — bracketlab-20260807-022033-triples-confirm-a-ltc-xrp-bch

Confirm run A: LTC+XRP+BCH family (60 triples over 6 prospect coins),
daily-4d argmax, ONE declared cell (market entry / direction gate / no
rails, 161h, 1-of-8), split70, 9 null-deal draws. 600/600 units, 0
failures, 176.9 min. Rules R1-R4 stamped in the launcher before launch.

## 1. R1 (the verdict): PASS — 9/9
Candidate (LTC-led, the discovery winner's ordering), declared cell,
HOLD window, skill = pnl minus always-long control:
  real  +$670.85   nulls $305.70 .. $506.17 (all nine below real)
Real beats ALL 9 draws -> p at the floor, 0.10 (DERIVED from draw count).
The construction is fair on the sit-out question: null deals keep each
member's real vote MIX (same trade frequency, same ability to stand
aside), so the +$165 margin over the best draw is alignment information,
not the option not to be long.

## 2. Weaknesses hunted (7b), in order of importance
- RAW HOLD MONEY IS NEARLY ZERO: the candidate made +$13.03 net over
  310 hold trades. The +$670 "skill" is almost entirely always-long
  LOSING $657 on the hold window. Real-vs-null stays a fair comparison
  (both arms enjoy the crash-avoidance), but as a TRADE this made no
  money on unseen data yet. Nobody funds a book on "lost less".
- R2 SATURATED: 60/60 triples positive-skill in the real arm AND in
  every null draw. The vs-long baseline makes everything look skilled
  (QC 64's lesson, visible again). R2 as declared carried no verdict;
  it now also carries no information. Run B's launcher upgrades it
  (declared before B fires): count of triples whose real skill beats
  all 9 of their OWN null draws — null-relative, not long-relative.
- Neighbour orderings (XRP-led +$354, BCH-led +$301 raw hold money)
  outperformed the candidate's raw money. Noted only; chasing them
  would be re-shopping (they were not the discovery winner).
- p-floor 0.10 is weak by construction (9 draws). More draws next time
  costs linear compute; 19 draws would floor at 0.05. GUESSED trade-off,
  revisit at run B read.

## 3. Standing per R3
Survived once. NOT promoted past "replicate before anything real".
Next: run B (DOGE+ADA+DOT on its native daily-3d directional branch,
same declared cell) — fired immediately after this audit per the gate.

## QC register
Nothing newly caught; QC 64's vs-long saturation re-observed in R2 and
handled by the declared R2 upgrade in run B.
