#!/usr/bin/env bash
# host-submission-banner.sh -- READ-ONLY: confirm Outlook's SEND path. Banner-
# grab submission 587 (STARTTLS, expects 220) direct vs public; connect-check
# 465/993 (implicit TLS, no plaintext banner expected). 15s timeout. No changes.
set -uo pipefail
probe() { # host port label expectbanner(y/n)
  local out
  out=$(timeout 15 bash -c "exec 3<>/dev/tcp/$1/$2 && head -c 100 <&3" 2>/dev/null)
  if [ -n "$out" ]; then echo "  $3 $1:$2 -> BANNER: $(printf '%s' "$out"|head -1|tr -d '\r')"
  elif timeout 5 bash -c "echo >/dev/tcp/$1/$2" 2>/dev/null; then echo "  $3 $1:$2 -> TCP connect OK (no plaintext banner${4:+ — expected for implicit-TLS})"
  else echo "  $3 $1:$2 -> no connect"; fi
}
echo "== submission 587 (STARTTLS — expects 220 greeting) =="
probe 192.168.56.129 587 direct
probe 74.208.226.14  587 public
echo "== 465 SMTPS + 993 IMAPS (implicit TLS — TCP connect is the pass signal) =="
probe 74.208.226.14  465 public tls
probe 74.208.226.14  993 public tls
echo "(read-only)"
