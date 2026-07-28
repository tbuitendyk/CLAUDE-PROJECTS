#!/usr/bin/env bash
# mailvm-sieve-probe.sh -- READ-ONLY: how does this Dovecot name folders, and
# where does theodore@'s Sieve script live? Needed before writing a filter into
# a production mailbox: the folder separator decides whether the target is
# "INBOX.Claude HOMS Worker" or "INBOX/Claude HOMS Worker", and guessing wrong
# creates a stray folder rather than the one asked for.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@192.168.56.129 'bash -s' <<'R' 2>&1
echo "== namespace / separator =="
doveconf -n 2>/dev/null | grep -A6 "^namespace" | sed 's/^/  /'
echo
echo "== mail_location / sieve settings =="
doveconf -n 2>/dev/null | grep -E "mail_location|sieve|managesieve" | sed 's/^/  /'
echo
echo "== theodore@ home + existing folders =="
TH=$(doveadm user -f home theodore@homeandofficemicro.com 2>/dev/null)
echo "  home: ${TH:-unknown}"
[ -n "$TH" ] && ls -1 "$TH" 2>/dev/null | head -20 | sed 's/^/    /'
echo "  mailboxes:"
doveadm mailbox list -u theodore@homeandofficemicro.com 2>/dev/null | sed 's/^/    /' | head -25
echo
echo "== existing sieve for theodore@ =="
[ -n "$TH" ] && ls -la "$TH"/sieve* "$TH"/.dovecot.sieve 2>/dev/null | sed 's/^/  /' || echo "  none found"
R
