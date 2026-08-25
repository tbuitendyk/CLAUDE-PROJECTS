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
# ONLY ONE OF THESE IS A FAULT. An earlier version of this printed NO ANSWER
# against ssh, the mail service and the tunnel -- the same mistake the screen
# itself made, one level out. A diagnostic that cries wolf is a diagnostic
# nobody reads on the day it is right.
import json

WORDS = {
    'spoke': 'alive, does not serve pages',
    'closed': 'alive, does not serve pages',
    'refused': 'NOTHING LISTENING',
    'silent': 'TOOK THE CONNECTION AND SAID NOTHING  <-- this is the fault',
}
d = json.load(open('/tmp/uts-svc-snapshot.json'))
wrong = 0
for u in d['units']:
    if not u['ports']:
        continue
    parts = []
    for a in u['answers']:
        if a.get('answered'):
            parts.append(f"answered in {a['ms']} ms")
        else:
            parts.append(WORDS.get(a.get('state'), a.get('why') or 'unknown'))
            if a.get('wrong'):
                wrong += 1
    print(f"  {u['unit']:34} {u['active']:9} ports {u['ports']}  {'; '.join(parts) or 'not asked'}")
s = d['servedBy']
print(f"  answered by {s['unit']} on {s['port']}, up {s['upSeconds']}s")
print(f"  {wrong} thing(s) actually wrong" if wrong else '  nothing is wrong')
PY
