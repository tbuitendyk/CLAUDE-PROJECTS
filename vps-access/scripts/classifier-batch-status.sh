#!/usr/bin/env bash
# classifier-batch-status.sh -- compact status of the latest General
# Classifier pair-screen batch: id, status, progress, runs done/total, and
# the ranked summary so far. Safe to run any time.
set -euo pipefail
latest=$(curl -sS http://127.0.0.1:8093/api/batches | python3 -c "import json,sys; b=json.load(sys.stdin)['batches']; print(b[0]['id'] if b else '')")
if [[ -z "$latest" ]]; then
  echo "no batches found"
  exit 0
fi
curl -sS "http://127.0.0.1:8093/api/batch/$latest" | python3 -c "
import json, sys
d = json.load(sys.stdin)
done = sum(1 for r in d['runs'] if r['status'] in ('done', 'error'))
print(f\"id={d['id']} status={d['status']} runs={done}/{len(d['runs'])} progress={d.get('progress','')[:70]}\")
s = d.get('summary')
if s:
    print(f\"positiveEdge={s['positiveEdge']} of {s['done']} done, {len(s['failed'])} failed\")
    for i, r in enumerate(s['ranked'], 1):
        print(f\"{i:2d}. {r['trade']:>10s} {r['model']:6s} acc={r['testAcc']:.3f} maj={r['majorityBaseline']:.3f} edge={r['edge']:+.3f} balAcc={r['balancedAcc'] if r['balancedAcc'] is None else round(r['balancedAcc'],3)} dir={r['directionalHits']}/{r['directionalCalls']} train={r['trainAcc']:.3f} {r['chosen']}\")
    for f in s['failed']:
        print(f\"FAILED {f['trade']}/{f['model']}: {f['error']}\")
"
