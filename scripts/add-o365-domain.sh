#!/usr/bin/env bash
# add-o365-domain.sh - add a recipient domain to the Brevo transport map IF
# its MX record is hosted on Microsoft 365 (mail.protection.outlook.com).
#
# Usage:
#   sudo bash scripts/add-o365-domain.sh customer-domain.example
#   sudo bash scripts/add-o365-domain.sh --force customer-domain.example
#
# --force skips the MX check (useful for adding a domain you already know is
# Microsoft-hosted but whose MX records haven't propagated yet).

set -euo pipefail

TRANSPORT_DST="/etc/postfix/transport_brevo"
RELAY="relay:[smtp-relay.brevo.com]:587"
O365_MX_PATTERN='\.mail\.protection\.outlook\.com\.?$'

die() { echo "ERROR: $*" >&2; exit 1; }
log() { echo "[add-o365] $*"; }

[ "$(id -u)" = "0" ] || die "must run as root (use sudo)"
command -v dig     >/dev/null || die "dig not found - apt install dnsutils"
command -v postmap >/dev/null || die "postmap not found - is Postfix installed?"
[ -f "${TRANSPORT_DST}" ] || die "${TRANSPORT_DST} not found - run scripts/install.sh first"

force=0
if [ "${1:-}" = "--force" ]; then
    force=1
    shift
fi

domain="${1:-}"
[ -n "${domain}" ] || die "usage: $0 [--force] <domain>"
domain="${domain,,}"

# already present?
if grep -qiE "^[[:space:]]*\.?${domain//./\\.}[[:space:]]" "${TRANSPORT_DST}"; then
    log "${domain} already in ${TRANSPORT_DST} - nothing to do"
    exit 0
fi

if [ "${force}" -eq 0 ]; then
    mx="$(dig +short MX "${domain}" | sort -n | awk '{print tolower($2)}' | head -1)"
    if [ -z "${mx}" ]; then
        die "no MX records for ${domain}; use --force if you're sure it's on O365"
    fi
    log "primary MX for ${domain}: ${mx}"
    if ! echo "${mx}" | grep -qE "${O365_MX_PATTERN}"; then
        die "${mx} is not Microsoft 365; not adding. Use --force to override."
    fi
    log "MX matches O365 pattern; adding."
else
    log "skipping MX check (--force)."
fi

ts="$(date -Iseconds)"
printf '%-25s %s   # auto %s\n' "${domain}" "${RELAY}" "${ts}" >> "${TRANSPORT_DST}"
postmap "${TRANSPORT_DST}"

if systemctl is-active --quiet postfix; then
    postfix reload
fi

log "added ${domain} -> ${RELAY}"
