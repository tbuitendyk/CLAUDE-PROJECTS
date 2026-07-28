#!/usr/bin/env bash
# mailvm-claude-archive-backfill.sh -- owner request (verified mail,
# 2026-07-28 21:05Z): duplicate what is already in "INBOX/Claude HOMS Worker"
# into "Archive" on theodore@'s mailbox, server-side.
#
# IDEMPOTENT BY MESSAGE-ID, not by a marker file. A plain `doveadm copy ... ALL`
# would duplicate every message on a second run, and this is the owner's live
# mailbox — a script that quietly doubles their mail when re-run is a trap. So:
# read the Message-IDs on both sides and copy only what is genuinely absent.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 root@192.168.56.129 'bash -s' <<'R' 2>&1
set -uo pipefail
U=theodore@homeandofficemicro.com
SRC="INBOX/Claude HOMS Worker"
DST="Archive"

ids_in() {
  doveadm fetch -u "$U" hdr.message-id mailbox "$1" all 2>/dev/null \
    | sed -n 's/^[Mm]essage-[Ii][Dd]: *//p' | tr -d ' \r' | sed 's/^<//; s/>$//' | grep -v '^$' | sort -u
}

before_src=$(doveadm mailbox status -u "$U" messages "$SRC" 2>/dev/null)
before_dst=$(doveadm mailbox status -u "$U" messages "$DST" 2>/dev/null)
echo "before: $before_src | $before_dst"

SRC_IDS=$(ids_in "$SRC")
DST_IDS=$(ids_in "$DST")
[ -n "$SRC_IDS" ] || { echo "source folder has no messages — nothing to do"; exit 0; }

copied=0; skipped=0
while IFS= read -r mid; do
  [ -n "$mid" ] || continue
  if printf '%s\n' "$DST_IDS" | grep -qxF "$mid"; then
    skipped=$((skipped+1)); continue
  fi
  if doveadm copy -u "$U" "$DST" mailbox "$SRC" header Message-ID "$mid" 2>&1 | sed 's/^/  doveadm: /'; then
    copied=$((copied+1))
  else
    echo "  WARN: copy failed for $mid"
  fi
done <<< "$SRC_IDS"

echo "copied=$copied already-present=$skipped"
echo "after : $(doveadm mailbox status -u "$U" messages "$SRC" 2>/dev/null) | $(doveadm mailbox status -u "$U" messages "$DST" 2>/dev/null)"
R
