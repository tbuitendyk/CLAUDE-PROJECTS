#!/usr/bin/env bash
# uts-set-backup.sh <setId> -- COPIES ONE RECORD SET, AND EVERYTHING IT READS, BESIDE
# THE LIVE DATA, THEN PROVES THE COPY BYTE FOR BYTE. Changes nothing it copies.
#
# Written for the salvage of S1-ALL-20260926 (owner, 2026-09-26: "a solid design
# must be planned that does not risk the work done thus far"): before new code is
# deployed over a stopped set, the set is copied so that any fault in that code
# costs a copy back, never the work.
#
# What is copied, into data/backups/<setId>-<UTC stamp>/ under the same relative
# paths it has under data/:
#   stagesets/<id>.json            the set's document
#   batches/<id>.rows/             every file of its record store
#   manifests/<id>*.json           the record of which price files it was launched on
#   cache/<each pinned file>       every price file that record names, as it is now
#
# REFUSES: a set whose document says it is running (its files are still being
# written); a backup folder that already exists (never overwritten). Reads at the
# lowest CPU and disk priority. Loads none of the service's code and asks it nothing.
set -uo pipefail
ID="${1:-}"
[ -n "$ID" ] || { echo "usage: <setId>"; exit 1; }
case "$ID" in *[!A-Za-z0-9._-]*) echo "bad set id"; exit 1;; esac
D=/opt/ultimate-trading-system/data
DOC="$D/stagesets/$ID.json"
[ -f "$DOC" ] || { echo "no set document $DOC"; exit 1; }
exec nice -n 19 ionice -c3 python3 - "$D" "$ID" <<'PY'
import json, os, sys, shutil, hashlib, datetime
D, sid = sys.argv[1], sys.argv[2]
doc = json.load(open(os.path.join(D, 'stagesets', sid + '.json')))
if doc.get('status') == 'running':
    print(f"REFUSED: {sid} says it is running -- its files are still being written"); sys.exit(1)
stamp = datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
dest = os.path.join(D, 'backups', f'{sid}-{stamp}')
if os.path.exists(dest):
    print(f'REFUSED: {dest} already exists'); sys.exit(1)

rel = [os.path.join('stagesets', sid + '.json')]
store = os.path.join('batches', sid + '.rows')
if os.path.isdir(os.path.join(D, store)):
    rel += [os.path.join(store, f) for f in sorted(os.listdir(os.path.join(D, store)))]
dm = doc.get('dataManifest') or {}
det = None
if dm.get('detailFile') and '..' not in dm['detailFile']:
    rel.append(dm['detailFile'])
    det = json.load(open(os.path.join(D, dm['detailFile'])))
pinned = 0
if det and det.get('detail'):
    for lst in det['detail'].values():
        for x in lst or []:
            if x and x.get('file') and '/' not in x['file']:
                rel.append(os.path.join('cache', x['file'])); pinned += 1

def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''): h.update(chunk)
    return h.hexdigest()

os.makedirs(dest)
total = 0; missing = []
for r in rel:
    src = os.path.join(D, r)
    if not os.path.exists(src): missing.append(r); continue
    dst = os.path.join(dest, r)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    total += os.path.getsize(dst)
# THE PROOF: every copied file hashes to its original, read again after the copy
bad = [r for r in rel if r not in missing and sha(os.path.join(D, r)) != sha(os.path.join(dest, r))]
print(f'copied {len(rel) - len(missing)} file(s), {total / 1048576:.1f} MB, into {dest}')
print(f'  the document, {len([r for r in rel if r.startswith("batches")])} store file(s), the price-file record, and {pinned} pinned price file(s)')
print(f'  not found to copy: {len(missing)}' + (f' -- {missing[:5]}' if missing else ''))
print(f'  copies that do not hash to their original: {len(bad)}' + (f' -- {bad[:5]}' if bad else ''))
print('VERDICT: ' + ('the copy is whole' if not bad and not missing else 'THE COPY IS NOT WHOLE -- do not rely on it'))
PY
