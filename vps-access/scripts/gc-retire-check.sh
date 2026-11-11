#!/usr/bin/env bash
# gc-retire-check.sh -- READ-ONLY: what is left of the previous product (the
# general classifier, /opt/general-classifier, port 8093) on this box, and does
# anything else lean on it? Written 2026-11-11 for the owner's order to remove
# it (UTS to-do 29). Reads only: no deletes, no stops, no config changes.
set -uo pipefail
echo "== units, timers and unit files naming it =="
systemctl list-units --all --no-pager --plain 2>/dev/null | grep -Ei 'classif|pilot|8093' | cut -c1-120
systemctl list-timers --all --no-pager 2>/dev/null | grep -Ei 'classif|pilot' | cut -c1-160
ls -1 /etc/systemd/system 2>/dev/null | grep -Ei 'classif|pilot'
echo "== unit files that point into /opt/general-classifier =="
grep -rlE '/opt/general-classifier|deploy-general-classifier' /etc/systemd/system /lib/systemd/system 2>/dev/null
echo "== listening on 8093 =="
ss -ltnp 2>/dev/null | grep ':8093 ' | cut -c1-160 || true
echo "== processes running from it =="
ps -eo pid,etimes,rss,args 2>/dev/null | grep -E '/opt/general-classifier|deploy-general-classifier' | grep -v grep | cut -c1-160
echo "== web config naming it =="
grep -rnE '8093|general-classifier|classifier' /etc/nginx 2>/dev/null | cut -c1-200
echo "== cron naming it =="
grep -rnE 'classif|pilot' /etc/cron.d /etc/crontab /var/spool/cron 2>/dev/null | cut -c1-200
echo "== the folders and their size =="
for d in /opt/general-classifier /root/deploy-general-classifier /home/*/deploy-general-classifier; do
  [ -e "$d" ] && echo "$(timeout 60 du -sh "$d" 2>/dev/null | cut -f1)  $d"
done
ls -la /opt/general-classifier 2>/dev/null | head -30
echo "== anything that may still hold a position or an armed switch =="
find /opt/general-classifier -maxdepth 3 \( -iname '*pilot*' -o -iname '*live*' -o -iname '*arm*' -o -iname '*halt*' \) 2>/dev/null | head -20
echo "== other /opt folders (for context) =="
ls -1 /opt 2>/dev/null
echo "== disk =="
df -h / 2>/dev/null | tail -1
