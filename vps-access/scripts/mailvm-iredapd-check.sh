#!/usr/bin/env bash
# mailvm-iredapd-check.sh -- READ-ONLY: why is iredapd (policy daemon on
# 127.0.0.1:7777, checked by postfix on SEND) stuck "activating"? No changes.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@192.168.56.129 'bash -s' <<'R' 2>&1
echo "load: $(cut -d' ' -f1-3 /proc/loadavg)   up: $(cut -d. -f1 /proc/uptime)s"
echo "iredapd: active=$(systemctl is-active iredapd 2>/dev/null) sub=$(systemctl show -p SubState --value iredapd 2>/dev/null)"
echo "listening on 7777: $(ss -ltnH 2>/dev/null | grep -c ':7777')"
echo "-- unit type/timeout --"; systemctl show -p Type,TimeoutStartUSec,ExecStart iredapd 2>/dev/null | sed 's/^/  /'
echo "-- iredapd journal (last 12) --"; journalctl -u iredapd --no-pager -n 12 2>&1 | sed 's/^/  /'
echo "queue: $(postqueue -p 2>/dev/null | tail -1)"
R
