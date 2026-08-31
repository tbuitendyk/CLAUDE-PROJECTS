#!/usr/bin/env bash
# READ-ONLY. The Funnel tab renders nothing, and a blank screen carries no error
# to read. This asks the read route what it answers for the set on the box and
# prints the SHAPE of the answer rather than the whole of it, so the reply is
# readable: the top-level keys, and the keys of the reading each step returns.
#
# The set named here is already totalled, so nothing here starts work.
set -uo pipefail

PORT=8094
SET=s3-mte0oajo-1

ask() {
  curl -s -X POST -H 'Content-Type: application/json' --data "$1" \
    "http://127.0.0.1:${PORT}/api/funnel/${SET}/read"
}

echo "== step 1, the shape of the answer =="
ask '{"step":1}' | node -e '
let s = "";
process.stdin.on("data", (d) => { s += d; });
process.stdin.on("end", () => {
  let j;
  try { j = JSON.parse(s); } catch (e) { console.log("not JSON:", s.slice(0, 300)); return; }
  console.log("top-level keys:", Object.keys(j).join(", "));
  console.log("survivors:", j.survivors, "of", j.of, "| step:", j.step);
  console.log("ruleSentence:", JSON.stringify(j.ruleSentence));
  console.log("holdsAxis:", JSON.stringify(j.holdsAxis));
  const r = j.reading;
  console.log("reading is:", r === null ? "NULL" : typeof r);
  if (r && typeof r === "object") {
    console.log("reading keys:", Object.keys(r).join(", "));
    console.log("dials:", Array.isArray(r.dials) ? r.dials.length : "not an array");
    if (Array.isArray(r.dials) && r.dials[0]) console.log("first dial:", JSON.stringify(r.dials[0]).slice(0, 240));
    console.log("splitHalf:", JSON.stringify(r.splitHalf));
    console.log("lopsided:", JSON.stringify(r.lopsided));
    console.log("skipped:", Array.isArray(r.skipped) ? r.skipped.length : r.skipped);
  }
});'

echo
echo "== how long it takes, and how big the answer is =="
/usr/bin/time -f "  %e seconds" curl -s -o /tmp/funnel-read.json -w '  %{size_download} bytes\n' \
  -X POST -H 'Content-Type: application/json' --data '{"step":1}' \
  "http://127.0.0.1:${PORT}/api/funnel/${SET}/read" 2>&1 | tail -3

echo
echo "== the service log since the last restart =="
journalctl -u ultimate-trading-system --since "-40 min" --no-pager 2>/dev/null | tail -12 || echo "(no journal access)"
