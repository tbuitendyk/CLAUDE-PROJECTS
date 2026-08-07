#!/usr/bin/env bash
# classifier-triples-confirm-b.sh -- CONFIRM run B (fired after run A's
# audit, per the gate). Candidate: DOGEUSDT+ADAUSDT+DOTUSDT on its native
# discovery branch daily-3d directional. Same 6-coin universe, same
# declared cell as run A (market entry, 161h, 1-of-8), split70, 9 nulls.
#
# READING RULES (stamped before launch):
#  R1: DOGE-led DOGE+ADA+DOT declared-cell HOLD skill (pnl minus
#      always-long) beats ALL 9 of its null draws (p-floor 1/10).
#  R2 (context, UPGRADED from run A's saturated version, declared here
#      before the run): count of the 60 triples whose real skill beats
#      all 9 of their OWN null draws. Null-relative, not long-relative.
#  R3/R4: as run A (no retirement on one fail, no promotion past
#      "replicate" on one pass; thin prints as thin, draws quoted).
#  Alongside R1, the audit MUST print raw hold money beside skill —
#  run A's lesson: skill can be large while money is zero.
set -euo pipefail
curl -sS -X POST http://127.0.0.1:8093/api/bracketlab \
  -H "Content-Type: application/json" \
  -d '{
    "universe": ["LTCUSDT","XRPUSDT","BCHUSDT","DOGEUSDT","ADAUSDT","DOTUSDT"],
    "sizes": {"singles": false, "doubles": false, "triples": true},
    "allLoaded": true,
    "permute": {"geometry": false, "decision": false, "band": false, "weekdays": false},
    "set": {"geometry": "daily-3d", "decision": "directional", "band": "auto", "weekdaysOnly": false},
    "declared": {"entry": "market", "tHours": 161, "quorumContexts": 1},
    "windowLayout": "split70",
    "labelShiftReps": 9,
    "promoteK": 50,
    "minTrades": 10,
    "label": "triples-confirm-b-doge-ada-dot"
  }'
echo
