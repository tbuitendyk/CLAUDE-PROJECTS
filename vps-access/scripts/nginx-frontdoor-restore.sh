#!/usr/bin/env bash
# nginx-frontdoor-restore.sh -- ROLL-BACK of nginx-frontdoor-apply.sh: puts the
# web-server files back exactly as the last apply found them, and reloads.
#
# The site copies on the website, vps-access, docs-web and kjv-bible-mcp
# branches were changed to match the new front door (` proxy_protocol` on each
# site's listen line). After this roll-back, revert those commits too, or the
# next deploy of that site puts the line back and the site stops answering.
set -uo pipefail
L=/root/nginx-frontdoor-backup/latest
[ -f "$L/restore.sh" ] || { echo "no backup to restore from -- nothing changed"; exit 1; }
systemctl stop nginx-frontdoor-deadman.timer >/dev/null 2>&1
echo "== restoring from $(readlink -f "$L") =="
bash "$L/restore.sh" || exit 1
sleep 2
echo "== every site's front page through the front door, now =="
for h in kjv.buitendyk.ca vp.buitendyk.ca bible.buitendyk.ca docs.homeandofficemicro.com buitendyk.ca www.buitendyk.ca deploy.buitendyk.ca mail.homeandofficemicro.com; do
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$h:443:127.0.0.1" "https://$h/"); rc=$?
  echo "$h $c/$rc"
done
echo "NOW revert the proxy_protocol commits on the website, vps-access, docs-web and kjv-bible-mcp branches (see the note at the top of this script)."
