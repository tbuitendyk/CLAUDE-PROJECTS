#!/usr/bin/env bash
# classifier-batch-dump.sh -- print every saved General Classifier pair-screen
# batch document (raw JSON, one per line prefixed with its filename) from
# /opt/general-classifier/data/batches/. For offline analysis of past screens.
set -euo pipefail
DIR=/opt/general-classifier/data/batches
if [[ ! -d "$DIR" ]]; then
  echo "no batches directory"
  exit 0
fi
for f in "$DIR"/*.json; do
  [[ -e "$f" ]] || { echo "no batch files"; exit 0; }
  echo "=== $(basename "$f") ==="
  cat "$f"
  echo
done
