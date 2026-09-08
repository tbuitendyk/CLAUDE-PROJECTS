#!/usr/bin/env bash
# cert-vm-probe.sh -- READ-ONLY. Changes nothing.
#
# Chosen plan: the mail VM owns public :80 (VBoxNetNAT), so the host can never
# answer HTTP-01. We will add ONE location block in the guest's nginx proxying
# /.well-known/acme-challenge/ back to the host on vboxnet0 (192.168.56.1),
# then move the host's 4 certs from authenticator=manual to webroot.
#
# Before writing anything, this establishes HOW to reach the guest and what its
# nginx looks like. Order of preference: SSH with an existing key (cleanest),
# then VBoxManage guestcontrol (needs guest credentials).
set -euo pipefail

hr(){ echo; echo "===== $* ====="; }
G=192.168.56.129

hr "1. VirtualBox inventory"
command -v VBoxManage >/dev/null 2>&1 && echo "  VBoxManage: $(command -v VBoxManage)" || echo "  VBoxManage NOT on PATH"
VBoxManage list runningvms 2>/dev/null | cut -c1-100 || echo "  (cannot list vms)"
echo "-- NAT port-forwards (which host ports go to the guest) --"
for vm in $(VBoxManage list runningvms 2>/dev/null | sed 's/.*{\(.*\)}/\1/'); do
  echo "  vm $vm:"
  VBoxManage showvminfo "$vm" --machinereadable 2>/dev/null \
    | grep -iE "Forwarding|natnet|name=" | cut -c1-110 | head -12 || true
done

hr "2. SSH reachability to the guest"
if timeout 5 bash -c "</dev/tcp/$G/22" 2>/dev/null; then
  echo "  :22 open"
  timeout 8 ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=5 \
    root@$G 'echo "  SSH OK as $(id -un) on $(hostname)"' 2>&1 | head -5 || echo "  key-based SSH as root failed"
  ls -1 /root/.ssh/ 2>/dev/null | sed 's/^/    key: /' | head -8 || true
else
  echo "  :22 closed/filtered"
fi

hr "3. guestcontrol availability (needs guest additions + credentials)"
for vm in $(VBoxManage list runningvms 2>/dev/null | sed 's/.*{\(.*\)}/\1/'); do
  VBoxManage guestproperty get "$vm" /VirtualBox/GuestAdd/Version 2>&1 | cut -c1-80 | sed 's/^/  /' || true
done

hr "4. what the guest serves on :80 (from the host, read-only)"
timeout 8 curl -sS -i --max-time 6 "http://$G/.well-known/acme-challenge/probe" 2>&1 | head -12 || true
echo "-- with a public Host header (how LE will actually arrive) --"
timeout 8 curl -sS -o /dev/null -w "  www.buitendyk.ca via guest:80 -> %{http_code} redirect=%{redirect_url}\n" \
  -H "Host: www.buitendyk.ca" --max-time 6 "http://$G/.well-known/acme-challenge/probe" 2>&1 | head -3 || true

hr "5. host side: is there a free port on vboxnet0 for the challenge responder?"
ip -4 addr show vboxnet0 2>/dev/null | grep inet | sed 's/^/  /' || echo "  no vboxnet0"
for p in 8080 8404 8888; do
  ss -ltn 2>/dev/null | grep -q ":$p " && echo "  :$p IN USE" || echo "  :$p free"
done

hr "6. existing webroot + acme state on host"
ls -ld /var/www/letsencrypt 2>/dev/null || echo "  /var/www/letsencrypt does not exist yet"
grep -rl "acme-challenge" /etc/nginx/ 2>/dev/null | head || echo "  no acme-challenge block in host nginx"

echo
echo "PROBE COMPLETE -- nothing was modified."
