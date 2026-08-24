#!/usr/bin/env bash
# uts-page-check.sh -- READ-ONLY. Does everything come back, and how fast, asked
# of each service directly and then through nginx the way a browser asks.
# Deliberately fetches nothing that streams the recorded rows, so the check
# cannot itself be the thing that blocks the box. Changes nothing.
set -uo pipefail

echo "== straight at each service =="
check() { printf '  %-44s ' "$2"; curl -s -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\n' --max-time 25 "$1" || echo 'no answer in 25s'; }
check http://127.0.0.1:8094/construct.html      "the trading service, its own page"
check http://127.0.0.1:8094/api/batches         "the trading service, its runs"
check http://127.0.0.1:8095/api/services        "the service control"
check http://127.0.0.1:8095/construct.html      "the service control, serving the page"
check http://127.0.0.1:8095/svc/api/services    "the service control, second address"

echo "== through nginx, the way the browser asks =="
echo "  (the site asks for a password, so 401 here is the password working, not a fault)"
for P in /uts/construct.html /uts/svc/api/services /uts/svc/construct.html; do
  check "https://www.buitendyk.ca$P" "$P"
done

echo "== what the control says about the parts holding an address =="
curl -s --max-time 25 http://127.0.0.1:8095/api/services -o /tmp/uts-svc-snapshot.json || {
  echo "  (the control did not answer)"; exit 0; }
python3 - <<'PY'
import json
d = json.load(open('/tmp/uts-svc-snapshot.json'))
for u in d['units']:
    if not u['ports']:
        continue
    parts = []
    for a in u['answers']:
        parts.append(f"answered in {a['ms']} ms" if a.get('answered') else f"NO ANSWER - {a.get('why')}")
    print(f"  {u['unit']:34} {u['active']:9} ports {u['ports']}  {'; '.join(parts) or 'not asked'}")
s = d['servedBy']
print(f"  answered by {s['unit']} on {s['port']}, up {s['upSeconds']}s")
PY
