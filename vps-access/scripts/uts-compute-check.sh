#!/usr/bin/env bash
# uts-compute-check.sh -- READ-ONLY. Proves the Compute tab's plumbing on the
# box after a deploy: the loads reading, the roles and knobs, the two
# addresses, and that no action is taken by any of it. Changes nothing.
set -uo pipefail
FAIL=0
say() { printf '%s\n' "$*"; }

say "== the loads, from the small always-up program =="
if curl -sf --max-time 30 http://127.0.0.1:8095/api/compute -o /tmp/uts-cc.json; then
  python3 - <<'PY'
import json
d = json.load(open('/tmp/uts-cc.json'))
m = d['machine']
print(f"  machine: {m['processors']} processors, load {m['load']}, "
      f"{(m['memory'].get('availableBytes') or 0)/2**30:.1f} GB memory free, "
      f"{(m['disk'].get('freeBytes') or 0)/2**30:.0f} GB disk free")
for u in d['units']:
    ans = u.get('answers')
    a = '' if not ans else (f", answered in {ans['ms']} ms" if ans.get('answering') else f", DID NOT ANSWER ({ans.get('why')})")
    q = 'no ceiling' if u.get('quotaPct') is None else f"{u['quotaPct']}%"
    cpu = '—' if u.get('cpuPct') is None else f"{u['cpuPct']}%"
    print(f"  {u['unit']:34} {u['active']:8} using {cpu:>7} of {q:<10} "
          f"mem {(u.get('memoryBytes') or 0)/2**20:.0f} MB{a}")
PY
else
  say "  FAIL: it did not answer"; FAIL=1
fi

say "== the roles and knobs, from the trading service =="
if curl -sf --max-time 30 http://127.0.0.1:8094/api/compute-config -o /tmp/uts-cf.json; then
  python3 - <<'PY'
import json
d = json.load(open('/tmp/uts-cf.json'))
for r in d['rolesOffered']:
    cur = d['roles'][r['key']]
    print(f"  {r['label']:24} runs on {cur['inForce']}" + (f" (stored: {cur['stored']})" if cur['stored'] else ' (nothing stored: the default)'))
print(f"  platforms to point at: {[p['label'] for p in d['platforms']]}")
w = d['workers']
print(f"  workers {w['inForce']} in force (setting {w['setting']}, max {w['max']}), each worker's share {d['pct']}%")
PY
else
  say "  FAIL: the trading service did not answer"; FAIL=1
fi

say "== the Setup page, from both addresses =="
for U in http://127.0.0.1:8094/setup.html http://127.0.0.1:8095/setup.html http://127.0.0.1:8095/svc/api/compute; do
  printf '  %-42s ' "$U"
  curl -s -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\n' --max-time 40 "$U" || { echo 'no answer'; FAIL=1; }
done

say "== and the page really carries the Compute tab =="
if curl -sf --max-time 30 http://127.0.0.1:8094/setup.html | grep -q 'data-tab="compute"'; then
  say "  yes"
else
  say "  FAIL: the served page has no Compute tab"; FAIL=1
fi

[ "$FAIL" = 0 ] && say "EVERYTHING CHECKED OUT" || say "SOMETHING FAILED — see above"
exit "$FAIL"
