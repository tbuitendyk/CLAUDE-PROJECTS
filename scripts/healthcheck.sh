#!/usr/bin/env bash
# healthcheck.sh - send a small test message and verify it left via the relay.
#
# Usage:
#   bash scripts/healthcheck.sh recipient@outlook.com
#   FROM=postmaster@example.com bash scripts/healthcheck.sh recipient@outlook.com
#
# The recipient should be a Microsoft-hosted address (or in your transport map)
# so you actually exercise the Brevo path. The script tails /var/log/mail.log
# briefly and reports whether the message was queued for the Brevo relay.

set -euo pipefail

die() { echo "ERROR: $*" >&2; exit 1; }
log() { echo "[healthcheck] $*"; }

recipient="${1:-}"
[ -n "${recipient}" ] || die "usage: $0 <recipient@example.com>"

from="${FROM:-postmaster@$(hostname -d 2>/dev/null || hostname)}"
subject="smtp-forwarder healthcheck $(date -Iseconds)"
mail_log="${MAIL_LOG:-/var/log/mail.log}"

command -v sendmail >/dev/null || die "sendmail not found - is Postfix installed?"
[ -r "${mail_log}" ] || log "warning: cannot read ${mail_log}; skipping log scan"

log "sending test message: from=${from} to=${recipient}"

queue_id="$(printf 'From: %s\nTo: %s\nSubject: %s\n\nThis is a test from claude-3-alternate-smtp-forwarder.\n' \
                   "${from}" "${recipient}" "${subject}" \
            | sendmail -i -f "${from}" -- "${recipient}" 2>&1 || true)"

# `sendmail -t` doesn't print the queue id; we have to grep it from the log.
# Wait briefly for Postfix to write the log line.
sleep 2

if [ -r "${mail_log}" ]; then
    log "tailing ${mail_log} for the Brevo relay handoff..."
    matched=0
    for _ in 1 2 3 4 5; do
        if tail -n 200 "${mail_log}" \
            | grep -F "to=<${recipient}>" \
            | grep -F "smtp-relay.brevo.com" \
            | tail -n 1; then
            matched=1
            break
        fi
        sleep 2
    done
    if [ "${matched}" -eq 0 ]; then
        log "did NOT see a Brevo relay handoff for ${recipient} in ${mail_log}."
        log "possible causes:"
        log "  - recipient domain isn't in /etc/postfix/transport_brevo"
        log "  - SASL auth failed (look for 'authentication failed' in the log)"
        log "  - Postfix hasn't been reloaded since installing"
        exit 1
    fi
    log "OK - message handed off to Brevo."
else
    log "skipping log check; verify manually: tail -f ${mail_log}"
fi
