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

# doveadm prints the FIELD NAME first, so a line reads
#   hdr.message-id: Message-ID: <abc@host>
# An anchored ^Message-ID: match therefore never fires — which is exactly why
# the first run reported "no messages" against a folder holding eight. Pull
# the angle-bracketed token instead; that is stable whatever the prefix.
ids_in() {
  doveadm fetch -u "$U" hdr.message-id mailbox "$1" all 2>/dev/null \
    | grep -o "<[^>]*@[^>]*>" | tr -d "<>" | grep -v "^$" | sort -u
}

before_src=$(doveadm mailbox status -u "$U" messages "$SRC" 2>/dev/null)
before_dst=$(doveadm mailbox status -u "$U" messages "$DST" 2>/dev/null)
echo "before: $before_src | $before_dst"

SRC_IDS=$(ids_in "$SRC")
DST_IDS=$(ids_in "$DST")
SRC_N=$(printf '%s\n' "$SRC_IDS" | grep -c . || true)
echo "message-ids read: source=$SRC_N dest=$(printf '%s\n' "$DST_IDS" | grep -c . || true)"
if [ "$SRC_N" -eq 0 ]; then
  echo "FAILED: could not read any message-ids from '$SRC' — refusing to report success."
  echo "  raw sample:"; doveadm fetch -u "$U" hdr.message-id mailbox "$SRC" all 2>&1 | head -4 | sed "s/^/    /"
  exit 1
fi

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
