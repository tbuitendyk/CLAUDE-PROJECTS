#!/usr/bin/env bash
# ht-api-probe.sh -- read-only: do the UI's own endpoints survive the new
# History Tuning doc? Prints status codes + first bytes of each.
set -uo pipefail
for u in "api/batches" "api/batch/historytuning-20260804-204431-historytuning"; do
  echo "== GET $u =="
  curl -s -o /tmp/probe-body -w "http %{http_code}\n" "http://127.0.0.1:8093/$u"
  head -c 500 /tmp/probe-body; echo; echo
done
