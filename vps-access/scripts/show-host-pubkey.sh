#!/usr/bin/env bash
# show-host-pubkey.sh -- print the host's SSH public key(s), to authorize on the mail VM.
set -uo pipefail
found=0
for k in /root/.ssh/id_ed25519.pub /root/.ssh/id_rsa.pub /root/.ssh/id_ecdsa.pub; do
  [ -f "$k" ] && { echo "# $k"; cat "$k"; found=1; }
done
[ "$found" = 1 ] || echo "(no public key found in /root/.ssh)"
