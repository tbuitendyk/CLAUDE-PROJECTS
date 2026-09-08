#!/usr/bin/env bash
# uts-older-data-delete.sh -- DELETES the retired sweep engine's data (owner
# order, 2026-09-08: "get rid of everything related to the obsolete engine",
# GO NOW!). Exactly these, and nothing else:
#   data/batches/bracketlab-*        its run documents and row stores
#   data/gate-records/               the planted check's records
#   data/models/                     its saved models
#   data/cache/PLANTEDUSDT-*, PLANTEDLATEUSDT-*   its two fabricated coins
#   data/manifests/PLANTEDUSDT.json, PLANTEDLATEUSDT.json
#   data/run-rates.json*             its run-rate file
#   /tmp/uts-*                        stale outputs of its scripts
#   /var/log/uts-rows-squash.log      the log of its one-off row conversion
# The stage engine's sets (s1-/s2-/s3-/s4-) and the stage-engine check's own
# coins (PLANTEDSTAGEAUSDT, PLANTEDSTAGEBUSDT) are never touched. Refuses
# while the box is busy. Prints what went and what stayed.
set -uo pipefail
D=/opt/ultimate-trading-system/data
busy=$(curl -sS -m 20 http://127.0.0.1:8094/api/stage-gate/status | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d={};try{d=JSON.parse(r)}catch(e){console.log("unknown");return}console.log(("blockedBy" in d)?(d.blockedBy||"none"):"unknown")})')
[ "$busy" = "none" ] || { echo "REFUSING: busy = $busy. Nothing deleted."; exit 3; }
before=$(du -sh "$D" | cut -f1)
gone=0
rm_it() { for x in "$@"; do [ -e "$x" ] || continue; sz=$(du -sh "$x" | cut -f1); rm -rf -- "$x" && echo "  gone  $sz  ${x#$D/}" && gone=$((gone+1)); done; }
echo "== deleting =="
rm_it "$D"/batches/bracketlab-*
rm_it "$D"/gate-records "$D"/models
rm_it "$D"/cache/PLANTEDUSDT-1h-*.json "$D"/cache/PLANTEDLATEUSDT-1h-*.json
rm_it "$D"/manifests/PLANTEDUSDT.json "$D"/manifests/PLANTEDLATEUSDT.json
rm_it "$D"/run-rates.json "$D"/run-rates.json.tmp*
rm_it /tmp/uts-* /var/log/uts-rows-squash.log
echo "  $gone entries deleted; data was $before, now $(du -sh "$D" | cut -f1)"
echo "== what remains in data/batches that is not a stage set's store =="
ls -1 "$D"/batches | grep -vE '^s[1-4]-' | sed 's/^/  /' || true
echo "== survived: stagesets $(ls -1 "$D"/stagesets | wc -l) files, stage stores $(ls -1d "$D"/batches/s[1-4]-* 2>/dev/null | wc -l), check coins $(ls -1 "$D"/cache/PLANTEDSTAGE*-1h-*.json 2>/dev/null | wc -l) files =="
