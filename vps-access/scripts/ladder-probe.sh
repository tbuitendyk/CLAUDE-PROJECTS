#!/usr/bin/env bash
# ladder-probe.sh -- Ladder Lab live verification via the semi-auto balancer's
# LOCAL API (127.0.0.1:8092). One-shot modes so each run stays inside the
# deploy-control stdout cap; poll running jobs with job-status.sh.
#
# Usage via run-script, arg =
#   status      -> data coverage + latest-sweep presence + page assets served
#   load        -> start the deep BTC history load job (prints jobId)
#   sweep       -> start the FULL 78,732-config sweep (prints jobId)
#   sweep-fast  -> start the fast pass (every 3rd config)
#   latest      -> compact sanity-checked summary of the persisted result
set -euo pipefail
BASE="http://127.0.0.1:8092"
MODE="${1:-status}"

case "$MODE" in
  status)
    echo "== /api/ladder/status =="
    curl -sS -m 15 "$BASE/api/ladder/status" | python3 -c '
import datetime, json, sys
d = json.load(sys.stdin)
dd = d.get("data") or {}
def day(ms):
    if not ms:
        return "?"
    return datetime.datetime.utcfromtimestamp(ms / 1000).strftime("%Y-%m-%d")
rows = dd.get("rows")
span = day(dd.get("from")) + " -> " + day(dd.get("to"))
print("btc daily rows:", rows, " span:", span)
print("gridSize:", d.get("gridSize"), " hasResult:", d.get("hasResult"), " lastSweepAt:", d.get("lastSweepAt"))'
    echo "== page assets =="
    for f in ladder.html ladder.js; do
      code=$(curl -sS -o /dev/null -w '%{http_code}' -m 10 "$BASE/$f")
      echo "GET /$f -> $code"
    done
    ;;
  load)
    curl -sS -m 30 -X POST "$BASE/api/ladder/load-data" -H 'Content-Type: application/json' -d '{}'
    echo
    ;;
  sweep|sweep-fast)
    FAST=false; [[ "$MODE" == "sweep-fast" ]] && FAST=true
    curl -sS -m 30 -X POST "$BASE/api/ladder/sweep" -H 'Content-Type: application/json' -d "{\"fast\":$FAST}"
    echo
    ;;
  latest)
    curl -sS -m 30 "$BASE/api/ladder/latest" | python3 -c '
import json, math, sys
d = json.load(sys.stdin)
r = d.get("result")
if not r:
    print("NO RESULT PERSISTED")
    sys.exit(0)
bad = []
def fin(x):
    return isinstance(x, (int, float)) and math.isfinite(x)
w = r["window"]
g = r["grid"]
print("sweep created:", d.get("createdAt"), " fast:", g.get("fast"), " configs:", g.get("totalConfigs"))
print("window: %d bars, %.1fy, price %.0f -> %.0f, ath %.0f" % (w["bars"], w["years"], w["priceFrom"], w["priceTo"], w["ath"]))
picks = r.get("picks") or []
print("picks:", len(picks), " plateaus:", len(r.get("plateaus") or []), " baselines:", len(r.get("baselines") or []))
for i, p in enumerate(picks):
    nums = [p.get(k) for k in ("cagrPct", "maxDDPct", "mar", "robustScore")]
    if not all(fin(x) for x in nums):
        bad.append("pick %d non-finite metrics" % i)
    if not p.get("reasoning"):
        bad.append("pick %d missing reasoning" % i)
    sc = p.get("scenarios") or {}
    pw = sc.get("probWeightedMedian")
    if not fin(pw):
        bad.append("pick %d bad probWeightedMedian" % i)
        pw = float("nan")
    for k, v in (sc.get("byArchetype") or {}).items():
        if not all(fin(v.get(q)) for q in ("median", "p10", "p90")):
            bad.append("pick %d arch %s non-finite" % (i, k))
    print("  #%d [%s] cagr %.1f%% dd %.0f%% mar %.2f pw-med %.0f%%" % (i + 1, p.get("tier"), p["cagrPct"], p["maxDDPct"], p["mar"], pw))
sc = r.get("scenarios") or {}
archs = sc.get("archetypes") or []
psum = sum(a.get("probability", 0) for a in archs)
print("archetypes:", len(archs), " prob sum: %.4f" % psum)
if len(archs) != 8:
    bad.append("archetype count != 8")
if abs(psum - 1) > 1e-6:
    bad.append("probabilities do not sum to 1")
if "holdout" not in (r.get("caveat") or ""):
    bad.append("caveat missing")
if bad:
    print("SANITY FAILURES:")
    for b in bad:
        print("  -", b)
    sys.exit(1)
print("SANITY: all checks passed")'
    ;;
  picks)
    curl -sS -m 30 "$BASE/api/ladder/latest" | python3 -c '
import json, sys
d = json.load(sys.stdin)
r = d.get("result")
if not r:
    print("NO RESULT PERSISTED")
    sys.exit(0)
print("plateauThreshold (0.8 x best robust):", round(r.get("plateauThreshold", 0), 4))
for pl in r.get("plateaus") or []:
    print("plateau #%d: %d members, ranges:" % (pl["rank"] + 1, pl["size"]))
    for k, v in pl["ranges"].items():
        print("   %s: %s .. %s" % (k, v[0], v[1]))
    b = pl["best"]
    print("   best member: cagr %.1f%% dd %.0f%% mar %.2f cfg %s" % (b["cagrPct"], b["maxDDPct"], b["mar"], json.dumps(b["config"])))
for i, p in enumerate(r.get("picks") or []):
    print("pick #%d [%s] plateauRank=%s plateauSize=%s robust=%.3f mar=%.3f dd=%.0f%%" % (
        i + 1, p.get("tier"), p.get("plateauRank"), p.get("plateauSize"), p["robustScore"], p["mar"], p["maxDDPct"]))
    print("   cfg %s" % json.dumps(p["config"]))'
    ;;
  *)
    echo "usage: run-script ladder-probe.sh status|load|sweep|sweep-fast|latest|picks" >&2
    exit 1
    ;;
esac
