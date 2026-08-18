#!/usr/bin/env bash
# classifier-campaigns.sh -- READ-ONLY: why the campaign-name list on the Sweep
# section holds what it holds. Prints the current campaign, every distinct name
# the service would offer, and how many saved runs and greenlights carry each —
# plus how many carry NO campaign at all, which is the usual answer to "why is
# there only one".
set -uo pipefail
curl -sS -m 15 http://127.0.0.1:8093/api/campaign; echo
curl -sS -m 15 http://127.0.0.1:8093/api/campaigns; echo
echo "== per-name counts over saved runs and greenlights =="
curl -sS -m 20 http://127.0.0.1:8093/api/batches | python3 -c '
import sys, json, collections
j = json.load(sys.stdin)
rows = j.get("batches", [])
c = collections.Counter()
for r in rows:
    name = (r.get("params") or {}).get("campaign")
    c["(none)" if not name else name] += 1
print(f"saved runs: {len(rows)}")
for k, v in c.most_common():
    print(f"  {v:4d}  {k}")
'
