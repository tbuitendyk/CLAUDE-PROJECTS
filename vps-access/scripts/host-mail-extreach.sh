#!/usr/bin/env bash
# host-mail-extreach.sh -- HOST-side READ-ONLY: does the PUBLIC-IP mail
# forwarding actually reach the guest end-to-end? Connects to 74.208.226.14 on
# the plaintext-greeting mail ports and reads the banner. A banner means
# VBoxNetNAT -> guest works; connect-but-silent means the forward accepts but
# can't reach the guest (the failure mode after a context change). No changes.
set -uo pipefail
PUB=74.208.226.14
probe() { # $1 port  $2 label  $3 expect-banner(yes/no)
  local out
  out=$(timeout 7 bash -c "exec 3<>/dev/tcp/$PUB/$1 && { head -c 150 <&3; }" 2>/dev/null)
  if [ -n "$out" ]; then
    echo "  $2/$1: BANNER -> $(printf '%s' "$out" | head -1 | tr -d '\r')"
  elif timeout 4 bash -c "echo >/dev/tcp/$PUB/$1" 2>/dev/null; then
    echo "  $2/$1: connects but NO banner (forward accepts, guest not answering) <-- suspicious"
  else
    echo "  $2/$1: no connect"
  fi
}
echo "== end-to-end reach to public $PUB (through VBoxNetNAT) =="
probe 25  SMTP
probe 587 submission
probe 143 IMAP
probe 110 POP3
probe 993 IMAPS
echo "  (993 is implicit-TLS: no plaintext banner expected; a clean connect there is fine)"
echo "(read-only; no changes made)"
