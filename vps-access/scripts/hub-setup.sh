#!/usr/bin/env bash
# hub-setup.sh -- install/refresh the mail hub on the host. Idempotent; re-run
# after changing hub-cycle-core.sh (the cron copy is installed from the synced
# checkout). Order matters: everything is in place BEFORE the ENABLED flag is
# touched, because the flag also flips claude-mail-check.sh legacy callers over
# to hub delegation.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HUB=/var/lib/claude-mail/hub

mkdir -p "$HUB"/{registry,inbox,delivered,log}

# the gatekeeper cycle, run by cron every minute (self-gates to 15min/1min)
install -m 700 "$HERE/hub-cycle-core.sh" /usr/local/sbin/claude-mail-hub-cycle.sh
cat > /etc/cron.d/claude-mail-hub <<'CRON'
# mail-hub gatekeeper (see vps-access/HUB-PROTOCOL.md). Gates itself:
# polls every 15 min, every 1 min for 20 min after any mail interaction.
* * * * * root /usr/local/sbin/claude-mail-hub-cycle.sh >/dev/null 2>&1
CRON
chmod 644 /etc/cron.d/claude-mail-hub

# founding registrations: the hub session (vps-access) is the DEFAULT route --
# unaddressed owner mail lands with the gatekeeper, who passes it on
# (hub-reroute.sh). Legacy direct pollers stay pinned to general-classifier.
bash "$HERE/hub-register.sh" general-classifier
bash "$HERE/hub-register.sh" vps-access/default
echo general-classifier > "$HUB/legacy-route"

touch "$HUB/ENABLED"
echo "hub ENABLED."
echo
echo "== immediate first cycle =="
/usr/local/sbin/claude-mail-hub-cycle.sh || true
tail -8 "$HUB/log/hub.log" 2>/dev/null | sed 's/^/  /'
echo
bash "$HERE/hub-status.sh"
