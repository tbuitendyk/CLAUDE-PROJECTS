#!/usr/bin/env bash
# uts-mx-status.sh -- READ-ONLY. The trading box in Mexico City as it stands:
# whether real orders are switched on (LIVE in its env file, value only), whether
# the master switch is on (ARM), halts, the order program's timer, its derived
# state from the journal (`mx_executor.py status`, read-only by its own header),
# and the last lines of the journal. No writes, no orders, no keys printed.
set -uo pipefail
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new "$BOX" 'bash -s' <<'R'
echo "== switches =="
echo "  LIVE=$(grep -E '^LIVE=' ~/.executor-env 2>/dev/null | cut -d= -f2)"
echo "  ARM: $([ -f ~/pilot/ARM ] && echo PRESENT || echo absent)"
echo "  halts: $(ls ~/pilot 2>/dev/null | grep -i halt | tr '\n' ' ')"
echo "== timer =="
systemctl list-timers --all 2>/dev/null | grep -i -E 'pilot|exec' | sed 's/^/  /'
echo "== order program =="
echo "  sha256 $(sha256sum ~/mx_executor.py 2>/dev/null | cut -c1-16)"
echo "== status (read-only) =="
python3 ~/mx_executor.py status 2>&1 | head -60 | sed 's/^/  /'
echo "== journal tail =="
tail -8 ~/pilot/journal.jsonl 2>/dev/null | cut -c1-240 | sed 's/^/  /'
R
