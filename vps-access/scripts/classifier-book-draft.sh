#!/usr/bin/env bash
# classifier-book-draft.sh -- create a DRAFT hunter paper book (A2 joint
# ticket, VERDICTS.md) for UNIUSDT or AVAXUSDT. Drafts train nothing and
# freeze nothing; "Declare & initialize" is a separate, deliberate step.
# The two configs are version-controlled here so the declaration inputs are
# auditable. Usage: run-script classifier-book-draft.sh <UNIUSDT|AVAXUSDT>
set -euo pipefail
PAIR="${1:-}"
if [[ "$PAIR" != "UNIUSDT" && "$PAIR" != "AVAXUSDT" ]]; then
  echo "usage: run-script classifier-book-draft.sh <UNIUSDT|AVAXUSDT>" >&2
  exit 1
fi
PAIR="$PAIR" python3 - <<'EOF'
import json, os, time, urllib.request

pair = os.environ["PAIR"]
notes = {
    "UNIUSDT": (
        "A2 joint ticket (VERDICTS.md). H1 hunter +/-5% daily-3d gate pass; "
        "deep null consensus-20260726-0038: vote P&L exceed 2.6% of 1000 "
        "shifts. Ticket rides on AVAX replication (1% of 832, "
        "consensus-20260726-1448), not this pair's own 2.6%. Primary rule: "
        "vote. Min-activity floor: <10 vote trades at horizon = inconclusive, "
        "extend once by 90 periods, then close."
    ),
    "AVAXUSDT": (
        "A2 joint ticket (VERDICTS.md). H1 hunter +/-5% daily-3d gate pass; "
        "deep null consensus-20260726-1448 (owner-adjudicated at 833/1000 "
        "shifts): vote P&L exceed 1% of 832. Primary rule: vote. "
        "Min-activity floor: <10 vote trades at horizon = inconclusive, "
        "extend once by 90 periods, then close."
    ),
}[pair]

body = {
    "pair": pair,
    "compareSymbol": "BTCUSDT",
    "geometry": "daily-3d",
    "band": 5,
    "decision": "directional",
    "startMonth": "2019-01",
    "cutoff": "2026-07-01",
    "horizonPeriods": 180,
    "rules": ["vote", "q5", "q6", "q7", "q8"],
    "notes": notes,
}
print("config:", json.dumps(body))
req = urllib.request.Request("http://127.0.0.1:8093/api/books",
                             data=json.dumps(body).encode(),
                             headers={"Content-Type": "application/json"})
job = json.load(urllib.request.urlopen(req))
print("job:", job)
jid = job["jobId"]
for _ in range(150):
    time.sleep(2)
    st = json.load(urllib.request.urlopen(f"http://127.0.0.1:8093/api/jobs/{jid}"))
    if st.get("status") in ("done", "error"):
        print("job status:", st.get("status"), st.get("error") or "")
        break
    print("  ...", st.get("progress", ""))
books = json.load(urllib.request.urlopen("http://127.0.0.1:8093/api/books"))
for b in books if isinstance(books, list) else books.get("books", []):
    line = f"{b.get('id')} status={b.get('status')} pair={(b.get('config') or {}).get('pair')}"
    cfg = b.get("config") or {}
    line += f" decision={cfg.get('decision')} band={cfg.get('band')} horizon={cfg.get('horizonPeriods')}"
    print(line)
EOF
