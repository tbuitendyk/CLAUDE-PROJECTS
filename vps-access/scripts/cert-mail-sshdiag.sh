#!/usr/bin/env bash
# cert-mail-sshdiag.sh -- READ-ONLY. Why does root@192.168.56.129 refuse us?
#
# The guest side checks out: our key is in /root/.ssh/authorized_keys intact,
# /root/.ssh is 700 and authorized_keys 600 root:root, sshd reports
# permitrootlogin=without-password and pubkeyauthentication=yes. So the guest
# should accept the key -- meaning the problem is on this side.
#
# Prime suspect: /root/.ssh/id_ed25519.pub may not correspond to the private
# key /root/.ssh/id_ed25519. The .pub is just a text file; if it was replaced
# or copied from elsewhere, we authorized a key we cannot prove ownership of.
# Derives the real public key from the private key and compares, then shows the
# verbose auth exchange.
set -uo pipefail
G=192.168.56.129
K=/root/.ssh/id_ed25519

echo "===== 1. does the .pub actually match the private key? ====="
if [ -f "$K" ]; then
  echo "-- derived FROM THE PRIVATE KEY (authoritative) --"
  ssh-keygen -y -f "$K" 2>&1 | sed 's/^/  /'
  echo "-- contents of the .pub file we published --"
  cut -d' ' -f1,2 "$K.pub" 2>/dev/null | sed 's/^/  /'
  d=$(ssh-keygen -y -f "$K" 2>/dev/null | cut -d' ' -f2)
  p=$(cut -d' ' -f2 "$K.pub" 2>/dev/null)
  if [ -n "$d" ] && [ "$d" = "$p" ]; then echo "  => MATCH"; else echo "  => MISMATCH - this is the bug"; fi
  echo "-- fingerprints --"
  ssh-keygen -lf "$K" 2>&1 | sed 's/^/  priv: /'
  ssh-keygen -lf "$K.pub" 2>&1 | sed 's/^/  pub : /'
  echo "-- private key perms (sshd/ssh refuse world-readable) --"
  ls -l "$K" "$K.pub" 2>&1 | sed 's/^/  /'
else
  echo "  $K MISSING"
fi

echo
echo "===== 2. other keys we could offer ====="
ls -l /root/.ssh/ 2>/dev/null | sed 's/^/  /'

echo
echo "===== 3. verbose auth exchange ====="
timeout 25 ssh -vvv -i "$K" -o BatchMode=yes -o StrictHostKeyChecking=no \
  -o ConnectTimeout=8 -o PreferredAuthentications=publickey \
  -o IdentitiesOnly=yes "root@$G" 'echo GOTIN' 2>&1 \
  | grep -iE "Offering|Server accepts|Authentications that can continue|denied|debug1: Trying private key|send_pubkey_test|Will attempt key|no mutual|banner|GOTIN|Authenticated" \
  | head -25 | sed 's/^/  /'

echo
echo "===== 4. as a control, does the guest accept ANY auth for root? ====="
timeout 15 ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=6 \
  "root@$G" 'echo X' 2>&1 | tail -2 | sed 's/^/  /'

echo
echo "DIAG COMPLETE -- nothing modified, no private key printed."
