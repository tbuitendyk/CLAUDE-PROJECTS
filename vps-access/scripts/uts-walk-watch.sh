#!/usr/bin/env bash
# uts-walk-watch.sh -- READ-ONLY. How far the walk has got, and the busy share.
set -uo pipefail
curl -s -m 120 -o /tmp/uts-wt.json http://127.0.0.1:8094/api/coins/walk
node -e '
const j=JSON.parse(require("fs").readFileSync("/tmp/uts-wt.json","utf8"));
const el=j.startedAt?((j.finishedAt||Date.now())-j.startedAt)/1000:0;
const rate=el>0?j.done/el:0;
const left=rate>0&&j.of>j.done?(j.of-j.done)/rate:null;
console.log(`running:${j.running} ${j.done} of ${j.of} · ${el.toFixed(0)}s elapsed · ${rate.toFixed(1)}/s`
 + (left!=null?` · about ${Math.round(left/60)} min left`:"")
 + ` · workers ${j.workers} · cpu ${j.cpu&&j.cpu.busy!=null?Math.round(j.cpu.busy*100)+"% of "+j.cpu.cores:"?"}`
 + (j.error?` · ERROR ${j.error}`:"") + (j.finishedAt?` · finished ${new Date(j.finishedAt).toISOString()}`:""));
' 2>&1 | head -5
rm -f /tmp/uts-wt.json
