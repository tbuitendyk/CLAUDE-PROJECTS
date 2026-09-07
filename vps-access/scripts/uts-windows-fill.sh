#!/usr/bin/env bash
# uts-windows-fill.sh -- starts the 3.85.0 date-range fill for each finished
# record set that still lacks its date ranges, through the same route a screen
# read would use, one set at a time, and waits for it. Owner order 2026-09-07
# (LOOP NOW!): "start with writing any date ranges that are missing from record
# sets". It stops after a short wait and says what
# is left; run it again to continue. (150 s a pass: the session's own proxy cuts a
# silent answer off well before the runner's 900 s.) It changes nothing itself: the box's own
# fill writes the records, beside and swapped (RULE NINE).
set -uo pipefail
API=http://127.0.0.1:8094/api
DEADLINE=$(( $(date +%s) + 150 ))
ids=$(curl -sf --max-time 30 "$API/stagesets" | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const d=JSON.parse(r);console.error("   running: "+(d.running||"nothing"));for(const s of (d.sets||[]).slice().sort((a,b)=>(a.stage-b.stage)||String(a.name).localeCompare(String(b.name)))) if([1,2,3].includes(s.stage)&&["done","incomplete"].includes(s.status)) console.log(s.id)})')
for id in $ids; do
  last=""
  beat=0
  while :; do
    out=$(curl -sf --max-time 120 "$API/stageset/$id") || { echo "   $id: the route did not answer"; break; }
    line=$(printf '%s' "$out" | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const d=JSON.parse(r);const w=d.windows||{};const f=d.windowsFill||{};console.log((d.set||{}).name+": "+w.known+" of "+w.units+" units · "+JSON.stringify(f))})')
    now=$(date +%s)
    if [ "$line" != "$last" ] || [ $((now - beat)) -ge 120 ]; then echo "   $(date -u +%H:%M:%S) $line"; last="$line"; beat=$now; fi
    case "$line" in *'{"ready":true}'*|*'"failed"'*|*'"none"'*) break;; esac
    if [ "$now" -gt "$DEADLINE" ]; then echo "== time is up for this run; run it again to continue =="; exit 0; fi
    sleep 15
  done
done
echo "== every finished set now has its date ranges, or says why not =="
