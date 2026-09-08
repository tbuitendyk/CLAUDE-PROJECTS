#!/usr/bin/env bash
# cert-mail-audit.sh -- READ-ONLY. Inspects the mail guest over SSH.
#
# The host key is now authorized for root@192.168.56.129 (HOMSMAIL03), so the
# iRedMail cert can finally be issued inside the guest, where it belongs: the
# guest owns public :80 (VBoxNetNAT forward) and public :443 (the SNI stream
# map's `default` route) for mail.homeandofficemicro.com.
#
# Uses the dedicated passphrase-less key /root/.ssh/id_mailcert; the default
# id_ed25519 is passphrase-protected and unusable unattended.
#
# Before issuing anything this establishes: certbot availability, the real
# nginx layout and where ssl_certificate is set, how :80 handles the ACME path
# (the guest 301s everything to https today, so the challenge may need serving
# from its :443 vhost the same way the host does), the current iRedMail cert
# paths, and what Postfix/Dovecot point at.
set -uo pipefail
G=192.168.56.129
K=/root/.ssh/id_mailcert
S="ssh -i $K -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=8 root@$G"

echo "===== 0. access ====="
$S 'echo "  in as $(id -un)@$(hostname -f)  |  $(cat /etc/debian_version 2>/dev/null || uname -sr)"' 2>&1 | tail -2
$S true 2>/dev/null || { echo "  SSH FAILED -- aborting"; exit 1; }

echo
echo "===== 1. certbot in the guest ====="
$S 'command -v certbot >/dev/null && certbot --version 2>&1 || echo "  certbot NOT installed"' 2>&1 | sed 's/^/  /'
$S 'ls /etc/letsencrypt/live/ 2>/dev/null || echo "  no /etc/letsencrypt/live"' 2>&1 | sed 's/^/  /'
$S 'ls /etc/letsencrypt/renewal/*.conf 2>/dev/null | head || echo "  no renewal confs"' 2>&1 | sed 's/^/  /'

echo
echo "===== 2. nginx: files and ssl_certificate ====="
$S 'nginx -v 2>&1; echo "-- loaded files --"; nginx -T 2>/dev/null | grep "^# configuration file" | cut -c1-100' 2>&1 | sed 's/^/  /'
echo "-- where ssl_certificate is set --"
$S 'grep -rn "ssl_certificate" /etc/nginx/ 2>/dev/null | grep -v "^Binary" | cut -c1-130 | head -12' 2>&1 | sed 's/^/  /'

echo
echo "===== 3. how :80 handles the ACME path ====="
$S 'nginx -T 2>/dev/null | grep -nE "listen[[:space:]]+80|return[[:space:]]+30|acme-challenge|server_name|root " | cut -c1-110 | head -30' 2>&1 | sed 's/^/  /'

echo
echo "===== 4. current cert + what services point at ====="
$S 'ls -l /etc/ssl/certs/iRedMail.crt /etc/ssl/private/iRedMail.key 2>&1' 2>&1 | sed 's/^/  /'
$S 'postconf -h smtpd_tls_cert_file smtpd_tls_key_file 2>/dev/null' 2>&1 | sed 's/^/  postfix: /'
$S 'grep -rhE "^\s*ssl_cert|^\s*ssl_key" /etc/dovecot/ 2>/dev/null | head -4' 2>&1 | sed 's/^/  dovecot: /'

echo
echo "===== 5. webroot candidates in the guest ====="
$S 'ls -ld /var/www/html /var/www/letsencrypt /opt/www 2>/dev/null' 2>&1 | sed 's/^/  /'

echo
echo "===== 6. can the guest reach the ACME API? ====="
$S 'curl -sS -o /dev/null -w "  guest->LE: %{http_code}\n" --max-time 10 https://acme-v02.api.letsencrypt.org/directory 2>&1 | tail -1' 2>&1 | sed 's/^/  /'

echo
echo "AUDIT COMPLETE -- nothing modified."
