#!/usr/bin/env bash
# cert-mail-genkey.sh -- creates a dedicated automation keypair on THIS host.
# Idempotent: reuses the key if it already exists.
#
# Why: /root/.ssh/id_ed25519 is passphrase-protected. The diagnostic showed
#   Load key "/root/.ssh/id_ed25519": incorrect passphrase supplied
#   debug1: Server accepts key: ... SHA256:/fHoQO7fiemYHd8WsEaxapZJE+...
#   Permission denied (publickey,password)
# "Server accepts key" means the guest DID recognise the key as authorized --
# the install was correct. Authentication still failed because an unattended
# script cannot supply the passphrase.
#
# Stripping the passphrase from an existing key would weaken a credential used
# elsewhere. Instead this mints a separate passphrase-less key used ONLY for
# host -> mail-guest automation, so its blast radius is exactly that one path.
#
# Prints the PUBLIC key with a from= restriction so it only works from the
# host's vboxnet0 address. No private key is ever printed.
set -euo pipefail

K=/root/.ssh/id_mailcert

if [ -f "$K" ]; then
  echo "== key already exists -- reusing =="
else
  echo "== generating dedicated automation key =="
  ssh-keygen -t ed25519 -N "" -f "$K" -C "mailcert-automation root@$(hostname -s)" >/dev/null
  echo "   created $K"
fi
chmod 600 "$K"; chmod 644 "$K.pub"

echo
echo "-- fingerprint --"
ssh-keygen -lf "$K.pub" | sed 's/^/   /'

echo
echo "== AUTHORIZE THIS LINE ON THE MAIL GUEST =="
echo "   (from= limits it to the host's vboxnet0 address, so the key is"
echo "    useless from anywhere else even if it leaked)"
echo
echo "from=\"192.168.56.1\" $(cat "$K.pub")"
echo
echo "== verify current reachability =="
if timeout 10 ssh -i "$K" -o BatchMode=yes -o StrictHostKeyChecking=no \
     -o ConnectTimeout=6 -o IdentitiesOnly=yes root@192.168.56.129 \
     'echo "   ALREADY IN as $(id -un)@$(hostname -f)"' 2>/dev/null; then
  echo "   -> guest already accepts this key; nothing further needed"
else
  echo "   not yet authorized on the guest (expected on first run)"
fi
