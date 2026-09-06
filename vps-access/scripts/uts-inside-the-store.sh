#!/usr/bin/env bash
# uts-inside-the-store.sh -- READ-ONLY. Exactly which store files a record set
# still has, and their sizes. Changes nothing.
set -uo pipefail
D=/opt/ultimate-trading-system/data
for id in s1-mto5o106-3 s1-mtkpwna0-2 s2-mtkq55cv-2; do
  echo "== $id =="
  ls -la $D/batches/$id.rows/ 2>/dev/null || echo "(no store directory)"
  du -sh $D/batches/$id.rows 2>/dev/null
  echo ""
done
echo "== anything else this set left behind =="
ls -la $D/models/ 2>/dev/null | head -40
