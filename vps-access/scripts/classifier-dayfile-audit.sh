#!/usr/bin/env bash
# classifier-dayfile-audit.sh -- read-only: per-asset count of 2026-07 and
# 2026-08 day files on disk, with any missing July days NAMED. 31 July files
# + 2 August files (as of Aug 3) = complete.
set -uo pipefail
cd /opt/general-classifier/data/cache
for sym in ETHUSDT BNBUSDT XRPUSDT ADAUSDT SOLUSDT DOGEUSDT LTCUSDT LINKUSDT DOTUSDT AVAXUSDT TRXUSDT XLMUSDT ETCUSDT ATOMUSDT BCHUSDT UNIUSDT ZECUSDT; do
  j=$(ls ${sym}-1h-2026-07-*.json 2>/dev/null | wc -l)
  a=$(ls ${sym}-1h-2026-08-*.json 2>/dev/null | wc -l)
  miss=""
  for d in $(seq -w 1 31); do
    [[ -f "${sym}-1h-2026-07-${d}.json" ]] || miss="$miss 07-$d"
  done
  echo "$sym: july $j/31, august $a  ${miss:+MISSING:$miss}"
done
