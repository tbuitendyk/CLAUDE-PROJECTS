#!/usr/bin/env bash
# classifier-worker-selftest.sh -- prove the pool's threads really do sit at
# nice 19 on this box.
#
# host-health.sh showed no classifier thread at nice 19 and there was no way
# to tell whether the mechanism was broken, the deployment was stale, or ps
# was simply pointing at the wrong pid. This asks the workers themselves and
# reads the KERNEL's number for each thread out of procfs, rather than the
# value Node believes it requested.
set -euo pipefail
curl -sS http://127.0.0.1:8093/api/selftest/workers | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"configured pool size : {d['configuredSize']}\")
print(f\"workers booted       : {d['workersBooted']}   parallel={d['parallel']}\")
print(f\"distinct threads     : {d['distinctThreads']}  (must equal the reply count)\")
print(f\"nice readable        : {d['verifiable']}\")
for r in d['replies']:
    print(f\"   tid {r.get('tid')}  nice={r.get('nice')}  node-getPriority={r.get('priority')}\")
print()
if d['ok'] is True:
    print('PASS - every worker thread is at nice 19 and they are distinct threads.')
elif d['ok'] is None:
    print('INLINE FALLBACK - no worker threads booted; nothing to check.')
else:
    print('FAIL - workers are NOT all niced. The mail VM can be starved by a job.')
    raise SystemExit(1)
"
