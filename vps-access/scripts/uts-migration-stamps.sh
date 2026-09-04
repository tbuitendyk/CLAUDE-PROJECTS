#!/usr/bin/env bash
# READ-ONLY. For every record set on the box: which one-off migrations have
# been applied to it, read off the stamps each left on the set document --
# the 3.44.0 gate strip (gates), the 3.46.0 stage 1/2 re-rank, the 3.51.0
# sealed-window fill (stage 2), the 3.52.0 per-unit fold (unitSettings /
# foldedPerUnit), and the records/tally versions. Set documents only; no
# tables, no Funnel, nothing started. Nothing written.
set -uo pipefail
curl -sS -m 25 http://127.0.0.1:8094/api/stagesets | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const d=JSON.parse(r);for(const s of (d.sets||[])){const p=s.plan||{};
 console.log(`${s.name.padEnd(8)} stage ${s.stage} ${s.id.padEnd(16)} status ${s.status} engine ${s.engineVersion||(s.params||{}).engineVersion||"-"} recordsVersion ${s.recordsVersion??"-"}`);
 console.log(`         gates ${JSON.stringify(s.gates??null)}  unitSettings ${Array.isArray(p.unitSettings)?"yes ("+p.unitSettings.length+" units, pricings "+p.pricings+")":"no"}  foldedPerUnit ${JSON.stringify(p.foldedPerUnit||null)}`);
 console.log(`         sealed ${JSON.stringify(s.sealed||s.sealedFill||null)}  rerank ${JSON.stringify(s.rerank||s.reranked||s.rankedBy||null)}  tallyError ${s.tallyError||null}  keys ${Object.keys(s).join(",")}`);}})'
