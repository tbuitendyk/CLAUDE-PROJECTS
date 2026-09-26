#!/usr/bin/env bash
# uts-price-record-backup.sh -- COPIES EVERY RECORD SET'S DOCUMENT, AND THE PRICE-
# FILE RECORD EACH ONE NAMES, BESIDE THE LIVE DATA, THEN PROVES THE COPY BYTE FOR
# BYTE. Changes nothing it copies.
#
# Written for 3.271.0 (owner, 2026-09-26: "FIX the data dates by the exact dates
# every coin HAD at the time of starting sweep 1"). At its first start the new
# release rewrites every stage 1, 2 and 3 set's document -- its price record
# becomes the hours it read, kept beside it -- and deletes the old detail files
# under data/manifests. The record stores are not touched. Taken just before the
# deploy, this copy is what puts every document and detail file back exactly as
# they were if anything about that goes wrong.
#
# Into data/backups/price-records-<UTC stamp>/, under the same relative paths:
#   stagesets/<id>.json          every set document (not the record stores)
#   manifests/<detail>.json      every detail file a set document names
# REFUSES a backup folder that already exists. Lowest CPU and disk priority.
# Loads none of the service's code and asks it nothing.
set -uo pipefail
D=/opt/ultimate-trading-system/data
exec nice -n 19 ionice -c3 python3 - "$D" <<'PY'
import json, os, sys, glob, shutil, hashlib, datetime
D = sys.argv[1]
stamp = datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
dest = os.path.join(D, 'backups', f'price-records-{stamp}')
if os.path.exists(dest): print(f'REFUSED: {dest} already exists'); sys.exit(1)
rel = []
for p in sorted(glob.glob(os.path.join(D, 'stagesets', '*.json'))):
    name = os.path.basename(p)
    if '.' in name[:-5]: continue            # a sidecar, not a set document
    rel.append(os.path.join('stagesets', name))
    try: d = json.load(open(p))
    except Exception: continue
    det = ((d or {}).get('dataManifest') or {}).get('detailFile')
    if isinstance(det, str) and '..' not in det and not det.startswith('/'): rel.append(det)
rel = sorted(set(rel))
def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''): h.update(chunk)
    return h.hexdigest()
os.makedirs(dest)
missing = []; total = 0
for r in rel:
    src = os.path.join(D, r)
    if not os.path.exists(src): missing.append(r); continue
    dst = os.path.join(dest, r)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst); total += os.path.getsize(dst)
bad = [r for r in rel if r not in missing and sha(os.path.join(D, r)) != sha(os.path.join(dest, r))]
docs = len([r for r in rel if r.startswith('stagesets')])
print(f'copied {len(rel) - len(missing)} file(s), {total / 1048576:.1f} MB, into {dest}')
print(f'  {docs} set document(s) and {len(rel) - docs} detail file(s) they name')
print(f'  not found to copy: {len(missing)}' + (f' -- {missing[:5]}' if missing else ''))
print(f'  copies that do not hash to their original: {len(bad)}' + (f' -- {bad[:5]}' if bad else ''))
print('VERDICT: ' + ('the copy is whole' if not bad and not missing else 'THE COPY IS NOT WHOLE -- do not rely on it'))
PY
