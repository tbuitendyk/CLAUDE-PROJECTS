#!/usr/bin/env bash
# uts-older-data-inventory.sh -- READ-ONLY. What the retired sweep engine
# (gone in 3.97.0) left on this box: its run documents and row stores under
# data/batches, its planted-check records, its saved models, its two
# fabricated coins' price files and manifests, its run-rate file, and the
# stale outputs its scripts left in /tmp. The stage engine's own sets
# (s1-/s2-/s3-/s4-) are listed only so their survival can be checked.
# Changes nothing.
set -uo pipefail
D=/opt/ultimate-trading-system/data
echo "== data/batches by prefix (entries, size) =="
cd "$D/batches" 2>/dev/null && ls -1 | sed -E 's/^([A-Za-z0-9]+)-.*/\1/' | sort | uniq -c | sort -rn | while read -r n p; do
  sz=$(du -shc "$p"-* 2>/dev/null | tail -1 | cut -f1); echo "  $p  $n entries  $sz"
done
echo "== the retired engine's run documents and stores =="
ls -1d "$D"/batches/bracketlab-* 2>/dev/null | wc -l | sed 's/^/  bracketlab-* entries: /'
du -shc "$D"/batches/bracketlab-* 2>/dev/null | tail -1 | sed 's/^/  bracketlab-* total: /'
for d in gate-records models; do
  [ -d "$D/$d" ] && echo "  data/$d: $(find "$D/$d" -type f | wc -l) files, $(du -sh "$D/$d" | cut -f1)" || echo "  data/$d: absent"
done
for s in PLANTEDUSDT PLANTEDLATEUSDT; do
  n=$(ls -1 "$D"/cache/$s-1h-*.json 2>/dev/null | wc -l); echo "  cache $s: $n files $(du -shc "$D"/cache/$s-1h-*.json 2>/dev/null | tail -1 | cut -f1)"
  [ -f "$D/manifests/$s.json" ] && echo "  manifest $s.json: present" || echo "  manifest $s.json: absent"
done
echo "  the stage-engine check's own coins (kept): $(ls -1 "$D"/cache/PLANTEDSTAGE*-1h-*.json 2>/dev/null | wc -l) files"
ls -la "$D"/run-rates.json* 2>/dev/null | sed 's/^/  /' || true
echo "  /tmp/uts-* stale outputs: $(ls -1 /tmp/uts-* 2>/dev/null | wc -l)"
[ -f /var/log/uts-rows-squash.log ] && echo "  /var/log/uts-rows-squash.log: $(du -sh /var/log/uts-rows-squash.log | cut -f1)" || echo "  /var/log/uts-rows-squash.log: absent"
echo "== the stage engine's sets, which must survive =="
echo "  data/stagesets: $(ls -1 "$D"/stagesets 2>/dev/null | wc -l) files, $(du -sh "$D"/stagesets 2>/dev/null | cut -f1)"
echo "  data/batches s1-/s2-/s3-/s4- stores: $(ls -1d "$D"/batches/s[1-4]-* 2>/dev/null | wc -l)"
echo "== disk =="; df -h / | tail -1
