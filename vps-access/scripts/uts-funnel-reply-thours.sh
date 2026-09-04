#!/usr/bin/env bash
# READ-ONLY. The Funnel's step 2 answer for tHours on XRPUSDT weekly-8d under
# the owner's rule, exactly as the page receives it, gzipped and base64'd so it
# fits the runner's output cap. Nothing written.
set -uo pipefail
S=${1:-s3-mtl42g1m-3}; U="XRPUSDT|||weekly-8d"
R='{"ranges":{},"allowed":{"gate":["directional"]},"floors":{}}'
out=$(curl -sS -m 200 -H 'content-type: application/json' -d "{\"step\":2,\"dial\":\"tHours\",\"unit\":\"$U\",\"rule\":$R,\"target\":200,\"barPct\":75,\"closing\":{\"key\":\"rule\"}}" "http://127.0.0.1:8094/api/funnel/$S/read")
echo "bytes $(echo -n "$out" | wc -c)"
echo "BEGIN"; echo -n "$out" | gzip -9 | base64 -w0; echo; echo "END"
