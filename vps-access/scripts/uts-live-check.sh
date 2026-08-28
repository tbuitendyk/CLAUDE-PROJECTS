#!/usr/bin/env bash
# READ-ONLY: is anything actually trading or tracking on this box? Decides
# whether a change to the measurements can touch a live path.
set -euo pipefail
cd /opt/ultimate-trading-system
echo "== data/live =="
find data/live -maxdepth 2 -type f | head -20
echo "count: $(find data/live -type f 2>/dev/null | wc -l)"
echo "== books / pilot =="
ls -la data/pilot 2>/dev/null | head -10 || echo "no data/pilot"
find data -maxdepth 1 -type d | sed 's/^/  /'
echo "== any book files =="
find data -name '*book*' -o -name '*paper*' 2>/dev/null | head -10 || true
