#!/usr/bin/env bash
# Issues a Let's Encrypt cert for docs.homeandofficemicro.com via DNS-01.
# Interactive: certbot will print a TXT record to drop on _acme-challenge.docs
# Run as root on the host.

set -euo pipefail

EMAIL="${LE_EMAIL:-admin@homeandofficemicro.com}"

certbot certonly \
  --manual \
  --preferred-challenges dns \
  --agree-tos \
  --no-eff-email \
  -m "$EMAIL" \
  -d docs.homeandofficemicro.com

echo "Cert installed at /etc/letsencrypt/live/docs.homeandofficemicro.com/"
