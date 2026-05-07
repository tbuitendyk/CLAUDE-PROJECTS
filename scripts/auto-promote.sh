#!/usr/bin/env bash
# auto-promote.sh - scan the Postfix deferred queue, find recipient domains
# whose MX is on Microsoft 365, and append them to the Brevo transport map.
#
# Designed to run from cron (every 15 minutes is the default in install.sh).
# Idempotent: skips domains already in the transport map.

set -euo pipefail

TRANSPORT_DST="/etc/postfix/transport_brevo"
RELAY="relay:[smtp-relay.brevo.com]:587"
O365_MX_PATTERN='\.mail\.protection\.outlook\.com\.?$'

die() { echo "ERROR: $*" >&2; exit 1; }
log() { echo "[$(date -Iseconds)] [auto-promote] $*"; }

[ "$(id -u)" = "0" ] || die "must run as root"
command -v dig         >/dev/null || die "dig not found - apt install dnsutils"
command -v postqueue   >/dev/null || die "postqueue not found"
command -v postmap     >/dev/null || die "postmap not found"
[ -f "${TRANSPORT_DST}" ] || die "${TRANSPORT_DST} not found - run install.sh first"

# Pull all recipient addresses from queued (mostly deferred) messages.
# postqueue -j outputs one JSON document per queued message. We try jq first
# for robustness, fall back to a simple awk parser of `postqueue -p` text.
extract_recipient_domains() {
    if command -v jq >/dev/null; then
        postqueue -j 2>/dev/null \
            | jq -r '(.recipients // [])[].address' 2>/dev/null \
            | awk -F@ 'NF==2 {print tolower($2)}' \
            | sort -u
    else
        # `postqueue -p` lists recipients indented under each message; parse
        # any line that's a bare email address.
        postqueue -p 2>/dev/null \
            | awk '/^[[:space:]]+[^[:space:]]+@[^[:space:]]+[[:space:]]*$/ {
                       gsub(/^[[:space:]]+|[[:space:]]+$/, "");
                       n = split($0, parts, "@");
                       if (n == 2) print tolower(parts[2])
                   }' \
            | sort -u
    fi
}

added=0

while read -r domain; do
    [ -n "${domain}" ] || continue

    # Skip if already in the transport map (exact or subdomain wildcard).
    if grep -qiE "^[[:space:]]*\.?${domain//./\\.}[[:space:]]" "${TRANSPORT_DST}"; then
        continue
    fi

    mx="$(dig +short +time=3 +tries=1 MX "${domain}" 2>/dev/null \
            | sort -n | awk '{print tolower($2)}' | head -1)"

    if [ -z "${mx}" ]; then
        continue
    fi

    if echo "${mx}" | grep -qE "${O365_MX_PATTERN}"; then
        ts="$(date -Iseconds)"
        printf '%-25s %s   # auto %s\n' "${domain}" "${RELAY}" "${ts}" >> "${TRANSPORT_DST}"
        log "promoted ${domain} (MX=${mx})"
        added=$((added + 1))
    fi
done < <(extract_recipient_domains)

if [ "${added}" -gt 0 ]; then
    postmap "${TRANSPORT_DST}"
    if systemctl is-active --quiet postfix; then
        postfix reload
        # Try the deferred queue again now that the routing has changed.
        postqueue -f
    fi
    log "promoted ${added} domain(s); flushed deferred queue"
fi
