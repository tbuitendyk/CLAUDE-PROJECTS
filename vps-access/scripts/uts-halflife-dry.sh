#!/usr/bin/env bash
# uts-halflife-dry.sh [set-id] -- READ-ONLY. History's own dry read of the
# retrain run for one Stage 4 record set, or for every one on the box: the
# refusal text the screen prints beside "Retrain at the ticked half-lives",
# the set's window layout as the engine read it, and the runs so far. Changes
# nothing; the same GET the page makes when History is opened.
set -uo pipefail
B=http://127.0.0.1:8094
ids="${1:-}"
if [ -z "$ids" ]; then
  ids=$(curl -sf --max-time 25 "$B/api/funnel/sets" | python3 -c 'import json,sys; print(" ".join(s["id"] for s in (json.load(sys.stdin).get("sets") or [])))')
fi
for id in $ids; do
  curl -sf --max-time 25 "$B/api/funnel/set/$id/halflife" | python3 -c '
import json,sys
d=json.load(sys.stdin)
print(d.get("id"), "|", d.get("name"), "|", d.get("unitName"))
print("  windowLayout:", d.get("windowLayout"), "| layout:", json.dumps(d.get("layout")), "| layoutWhy:", d.get("layoutWhy"))
print("  survivors:", d.get("survivors"), "| runs:", d.get("looks"), "| running:", json.dumps(d.get("running")))
print("  refused:", d.get("refused"))' || echo "$id: the dry read did not answer"
done
echo "== what the engine says is busy =="
curl -sf --max-time 25 "$B/api/stagesets" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("running:", d.get("running")); print("sets:", len(d.get("sets") or []))' || true
