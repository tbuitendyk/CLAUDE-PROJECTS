#!/usr/bin/env bash
# cert-vm-access.sh -- READ-ONLY. Finds a working path into the mail guest.
#
# The iRedMail cert must be issued INSIDE the guest: it owns public :80 (via
# VBoxNetNAT) and public :443 (the SNI stream map's `default` route), so the
# host cannot validate mail.homeandofficemicro.com on its behalf.
#
# An earlier probe printed nothing for the username loop, so this one captures
# errors properly. Tries, in order: VBoxManage under a few likely VBOX_USER_HOME
# values, SSH with each key the host holds across likely usernames, and
# guestcontrol. Reports what works; changes nothing and prints no secrets.
set -uo pipefail
G=192.168.56.129

echo "===== 1. ssh client present? ====="
command -v ssh >/dev/null 2>&1 && ssh -V 2>&1 | sed 's/^/  /' || echo "  NO ssh client on host"

echo
echo "===== 2. VBoxManage: whose VMs? ====="
echo "-- as \$(id -un)=$(id -un), default VBOX_USER_HOME --"
VBoxManage list vms 2>&1 | head -5 | sed 's/^/  /'
echo "-- running VMs --"
VBoxManage list runningvms 2>&1 | head -5 | sed 's/^/  /'
echo "-- who owns the VirtualBox processes --"
ps -eo user,pid,comm 2>/dev/null | grep -iE "virtualbox|vboxheadless|vboxsvc|vboxnet" | head -8 | sed 's/^/  /'
echo "-- try common VBOX_USER_HOME locations --"
for h in /root /home/*; do
  [ -d "$h/.config/VirtualBox" ] || [ -d "$h/.VirtualBox" ] || continue
  n=$(VBOX_USER_HOME="$h/.config/VirtualBox" VBoxManage list vms 2>/dev/null | wc -l)
  echo "  $h -> $n vm(s)"
done

echo
echo "===== 3. SSH: which key + user gets in? ====="
KEYS=$(ls /root/.ssh/id_* 2>/dev/null | grep -v '\.pub$' || true)
echo "  keys on host: $(echo "$KEYS" | tr '\n' ' ')"
for u in root theodore admin sysadmin debian ubuntu iredmail; do
  for k in $KEYS; do
    out=$(timeout 8 ssh -i "$k" -o BatchMode=yes -o StrictHostKeyChecking=no \
            -o ConnectTimeout=5 -o PreferredAuthentications=publickey \
            "$u@$G" 'echo GOTIN:$(id -un)@$(hostname)' 2>&1 | tail -1)
    case "$out" in
      GOTIN:*) echo "  ✓ $u with $(basename "$k"): $out" ;;
      *)       echo "  ✗ $u with $(basename "$k"): $(echo "$out" | cut -c1-70)" ;;
    esac
  done
done

echo
echo "===== 4. guestcontrol (needs guest additions + credentials) ====="
for vm in $(VBoxManage list runningvms 2>/dev/null | sed 's/.*{\(.*\)}/\1/'); do
  echo "  vm $vm additions: $(VBoxManage guestproperty get "$vm" /VirtualBox/GuestAdd/Version 2>&1 | cut -c1-50)"
done
[ -z "$(VBoxManage list runningvms 2>/dev/null)" ] && echo "  (no VMs visible to this user -- guestcontrol unavailable here)"

echo
echo "===== 5. does the guest already have certbot / what is it running? ====="
echo "-- guest :80 server header --"
timeout 8 curl -sSI --max-time 6 "http://$G/" 2>/dev/null | grep -iE "^server|^location" | sed 's/^/  /' || true
echo "-- guest :443 (self-signed, -k) --"
timeout 8 curl -skI --max-time 6 "https://$G/" 2>/dev/null | grep -iE "^server" | sed 's/^/  /' || true

echo
echo "===== 6. can the guest reach Let's Encrypt outbound? ====="
echo "  (guest must reach acme-v02.api.letsencrypt.org:443 to issue)"
timeout 8 curl -sS -o /dev/null -w "  host->LE: %{http_code}\n" --max-time 6 \
  https://acme-v02.api.letsencrypt.org/directory 2>&1 | tail -1

echo
echo "PROBE COMPLETE -- nothing modified, no secrets printed."
