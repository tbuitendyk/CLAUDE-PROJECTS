#!/usr/bin/env bash
# hub-recover-lost.sh -- recover the message the broken parser dropped:
# restore the most recent processed.txt entry to UNSEEN (claude-mail-unconsume
# with N=1), stamp the interaction clock (an owner mail IS an interaction, and
# it puts the cycle in fast mode so it can run right now instead of waiting for
# the quarter-hour), run one fixed cycle, and show the routed result.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "== 1) restore the dropped message to unseen =="
bash "$HERE/claude-mail-unconsume.sh" 1
echo "== 2) stamp interaction clock (fast mode) =="
date +%s > /var/lib/claude-mail/last-sent
echo "== 3) run one hub cycle with the FIXED parser =="
/usr/local/sbin/claude-mail-hub-cycle.sh || true
tail -6 /var/lib/claude-mail/hub/log/hub.log | sed 's/^/  /'
echo "== 4) queues now =="
for d in /var/lib/claude-mail/hub/inbox/*/; do
  echo "  $(basename "$d"): $(ls "$d" 2>/dev/null | wc -l) queued"
done
