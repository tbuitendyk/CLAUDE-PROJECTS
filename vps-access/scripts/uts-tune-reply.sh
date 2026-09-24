#!/usr/bin/env bash
# uts-tune-reply.sh -- READ-ONLY. The two Tune panels' asks exactly as the screen
# sends them, through the service's own port: status, size and the start of the
# answer. Changes nothing.
#   usage: uts-tune-reply.sh <stage 4 set id>   (all survivors, test and train)
set -uo pipefail
ID="${1:-s4-muez4cwv-29}"
for tool in stopsweep convictionsweep; do
  echo "== $tool"
  curl -s -o /tmp/uts-tune.json -w 'HTTP %{http_code} · %{size_download} bytes\n' "http://127.0.0.1:8094/api/pilot/${tool}?setId=${ID}&pick=all&windows=test,train"
  head -c 240 /tmp/uts-tune.json; echo
done
