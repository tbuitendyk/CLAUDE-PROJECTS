#!/usr/bin/env bash
# READ-ONLY. Every Stage 4 set whose name starts with a given word (default
# HALF): its capture record on Tune (when, how many survivors captured, why
# the rest were not), whether the capture press would refuse it and why, the
# capture the service is running now, and the service log lines about starts
# and captures over the last few hours. Nothing written, nothing started.
set -uo pipefail
PFX="${1:-HALF}"
case "$PFX" in *[!A-Za-z0-9._-]*) echo "usage: uts-capture-probe.sh <name prefix>" >&2; exit 2 ;; esac
cd /opt/ultimate-trading-system
PFX="$PFX" node -e '
const s=require("./lib/stages");
const docs=s.listSets().filter((x)=>x.stage===4).map((x)=>s.getSet(x.id)).filter((d)=>d&&String(d.name||"").startsWith(process.env.PFX));
console.log(`sets named ${process.env.PFX}...: ${docs.length}`);
for (const d of docs) {
  const c=d.capture||null;
  console.log(`- ${String(d.name).slice(0,90)} (${d.id}) kind ${d.kind} derived ${d.derived?d.derived.from+" run "+d.derived.run:"no"} unit ${d.unit||"all units together"} survivors ${(d.survivors||[]).length} created ${String(d.createdAt).slice(0,16)}`);
  console.log(`   capture: ${c?`at ${String(c.at).slice(0,16)} captured ${c.captured} of ${c.survivors} rows ${(c.rows||[]).length} not captured ${(c.notCaptured||[]).length}${(c.notCaptured||[]).length?" e.g. "+JSON.stringify((c.notCaptured||[])[0]):""}`:"none on record"}`);
  let why=null; try { why=s.captureRefusalOf?s.captureRefusalOf(d):"(refusal reader not exported)"; } catch(e){ why="threw: "+e.message; }
  console.log(`   the press would refuse: ${why||"no"}`);
  const st=s.tuneCaptureStatus(d.id);
  console.log(`   capture running now: ${st.none?"none":JSON.stringify({running:st.running,error:st.error,done:st.done,of:st.of})}`);
}'
echo "== service log, starts and capture lines, last 4 hours =="
journalctl -u ultimate-trading-system --since "4 hours ago" --no-pager 2>/dev/null | grep -iE "Started|Stopping|capture|error" | tail -25
