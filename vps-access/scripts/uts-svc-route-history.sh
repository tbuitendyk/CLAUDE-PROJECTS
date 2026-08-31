#!/usr/bin/env bash
# READ-ONLY. Did the /uts/svc/ location exist and get overwritten? The
# service-control installer edits sites-enabled/www.buitendyk.ca.conf IN PLACE
# and backs it up first, so its own backups are the evidence. Changes nothing.
set -uo pipefail
C=/etc/nginx/sites-enabled/www.buitendyk.ca.conf
echo "== the live config =="
ls -la --time-style=full-iso "$C" 2>/dev/null
readlink -f "$C" 2>/dev/null | sed 's/^/  resolves to /'
grep -c 'location /uts/svc/' "$C" 2>/dev/null | sed 's/^/  uts\/svc blocks in it now: /'
echo
echo "== what sites-available holds (what a website deploy installs) =="
ls -la --time-style=full-iso /etc/nginx/sites-available/www.buitendyk.ca.conf 2>/dev/null
grep -c 'location /uts/svc/' /etc/nginx/sites-available/www.buitendyk.ca.conf 2>/dev/null | sed 's/^/  uts\/svc blocks in it now: /'
echo
echo "== the installer's own backups, oldest first =="
ls -la --time-style=full-iso /etc/nginx/sites-enabled/*.before-svc.* /etc/nginx/sites-available/*.before-svc.* 2>/dev/null || echo "  (none)"
for f in /etc/nginx/sites-enabled/*.before-svc.* /etc/nginx/sites-available/*.before-svc.*; do
  [ -f "$f" ] && echo "  $f -> uts/svc blocks: $(grep -c 'location /uts/svc/' "$f" 2>/dev/null)"
done
echo
echo "== any other copy on the box that still has the block =="
grep -rl 'location /uts/svc/' /etc/nginx/ 2>/dev/null | head -5 || echo "  (none anywhere under /etc/nginx)"
echo
echo "== does /safe-encryption/ appear in the live config? (did last night's deploy land here) =="
grep -c 'safe-encryption' "$C" 2>/dev/null | sed 's/^/  safe-encryption mentions: /'
