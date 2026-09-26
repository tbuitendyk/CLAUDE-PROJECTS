#!/usr/bin/env bash
# uts-storage-census.sh -- READ-ONLY. What the trading service's data folder
# holds, and which of it belongs to nothing any more: every top-level folder's
# size; in the record sets' folder, every file kind and whether the set it is
# named after still exists; in the record stores' folder the same; the price-file
# records no set names; kept hours no set reads; files half-written by a restart;
# the stage-engine check's own sets. Written before building "The sweep
# processor" on Compute (owner, 2026-09-26), so its reclaim is built from what is
# really on the box. Loads none of the service's code, asks it nothing, writes
# nothing, lowest priority.
set -uo pipefail
exec nice -n 19 ionice -c3 python3 - /opt/ultimate-trading-system/data <<'PY'
import os, sys, json, re, time, collections
D = sys.argv[1]
def du(p):
    if os.path.isfile(p): return os.path.getsize(p), 1
    t = n = 0
    for root, dirs, files in os.walk(p):
        for f in files:
            try: t += os.path.getsize(os.path.join(root, f)); n += 1
            except OSError: pass
    return t, n
mb = lambda b: f'{b/1048576:,.1f} MB'
print('== top level')
tot = 0
for name in sorted(os.listdir(D)):
    b, n = du(os.path.join(D, name)); tot += b
    print(f'  {name:28s} {mb(b):>14s}  {n:>7,d} files')
print(f'  {"(all)":28s} {mb(tot):>14s}')
st = os.statvfs(D); print(f'  free on the disk: {st.f_bavail*st.f_frsize/1073741824:.1f} GB of {st.f_blocks*st.f_frsize/1073741824:.1f} GB')

S = os.path.join(D, 'stagesets')
names = os.listdir(S)
docs = {}
for f in names:
    if f.endswith('.json') and '.' not in f[:-5]:
        try: d = json.load(open(os.path.join(S, f)))
        except Exception: continue
        if isinstance(d, dict) and 'stage' in d: docs[f[:-5]] = d
ids = sorted(docs, key=len, reverse=True)
def owner(f):
    for i in ids:
        if f.startswith(i + '-') or f.startswith(i + '.'): return i
    return None
kinds = collections.defaultdict(lambda: [0, 0, 0, 0])   # count, bytes, orphan count, orphan bytes
def kind(f):
    for pat, k in [(r'\.json\.tmp', 'half-written (.tmp)'), (r'-tally\.json\.gz$', '-tally'), (r'-agreed\.json\.gz$', '-agreed'), (r'-field\.json\.gz$', '-field'),
                   (r'\.units\.json$', '.units'), (r'\.funnelrich$', '.funnelrich/'), (r'\.funnelrich\.json$', '.funnelrich.json'), (r'-capture\.json\.gz$', '-capture'),
                   (r'-tunescans\.json$', '-tunescans'), (r'-halflife-', '-halflife-*'), (r'-reserve-', '-reserve-*'), (r'\.before-rebuild$', '.before-rebuild')]:
        if re.search(pat, f): return k
    return 'other'
print('== record sets folder (stagesets)')
print(f'  set documents: {len(docs)}  by stage: {dict(collections.Counter(d.get("stage") for d in docs.values()))}  check sets: {sum(1 for d in docs.values() if d.get("exam"))}')
others = []
now = time.time()
for f in names:
    p = os.path.join(S, f)
    if f[:-5] in docs and f.endswith('.json'): continue
    if f == 'checkpoints': continue
    k = kind(f); b, _ = du(p)
    o = owner(f)
    kinds[k][0] += 1; kinds[k][1] += b
    if not o: kinds[k][2] += 1; kinds[k][3] += b
    if k == 'other': others.append(f)
for k, (n, b, on, ob) in sorted(kinds.items()):
    print(f'  {k:20s} {n:6d} files {mb(b):>12s}   named after no set: {on:5d} {mb(ob):>12s}')
print(f'  kinds not recognised: {others[:15]}')
cp = os.path.join(S, 'checkpoints')
if os.path.isdir(cp):
    c = os.listdir(cp); orph = [f for f in c if f[:-5] not in docs]
    print(f'  checkpoints: {len(c)}, of sets that are gone: {len(orph)}')

B = os.path.join(D, 'batches')
bk = collections.defaultdict(lambda: [0, 0, 0, 0]); bo = []
for f in os.listdir(B):
    p = os.path.join(B, f); b, _ = du(p)
    if f.endswith('.rows'): k = 'store (.rows)'; i = f[:-5]
    elif f.endswith('__keptfigs'): k = '__keptfigs'; i = f[:-len('__keptfigs')]
    elif '__keptfill' in f: k = '__keptfill'; i = f.split('__keptfill')[0]
    else: k = 'other'; i = None; bo.append(f)
    bk[k][0] += 1; bk[k][1] += b
    if i is not None and i not in docs: bk[k][2] += 1; bk[k][3] += b
print('== record stores folder (batches)')
for k, (n, b, on, ob) in sorted(bk.items()):
    print(f'  {k:20s} {n:6d} {mb(b):>12s}   of sets that are gone: {on:5d} {mb(ob):>12s}')
print(f'  other entries: {len(bo)} e.g. {bo[:8]}')

named = set(((d.get('dataManifest') or {}).get('detailFile')) for d in docs.values()) - {None}
M = os.path.join(D, 'manifests'); mf = os.listdir(M) if os.path.isdir(M) else []
mb_un = sum(os.path.getsize(os.path.join(M, f)) for f in mf if 'manifests/' + f not in named)
print(f'== price-file records (manifests): {len(mf)}, named by no set: {len([f for f in mf if "manifests/" + f not in named])} ({mb(mb_un)})')
keptn = set()
for d in docs.values():
    for e in (((d.get('hours') or {}).get('coins')) or {}).values():
        if isinstance(e, dict) and e.get('file'): keptn.add(e['file'])
H = os.path.join(D, 'hours'); hf = os.listdir(H) if os.path.isdir(H) else []
print(f'== kept hours: {len(hf)} files, named by no set: {len([f for f in hf if "hours/" + f not in keptn])}')
tmp = []
for root, dirs, files in os.walk(D):
    if '/backups' in root: continue
    for f in files:
        if re.search(r'\.tmp\d', f):
            p = os.path.join(root, f)
            try: tmp.append((now - os.path.getmtime(p), os.path.getsize(p), os.path.relpath(p, D)))
            except OSError: pass
old = [t for t in tmp if t[0] > 3600]
print(f'== half-written files anywhere: {len(tmp)} ({mb(sum(t[1] for t in tmp))}); over an hour old: {len(old)} ({mb(sum(t[1] for t in old))}) e.g. {[t[2] for t in old[:4]]}')
ex = [d for d in docs.values() if d.get('exam')]
exb = 0
for d in ex:
    exb += du(os.path.join(S, d['id'] + '.json'))[0] + du(os.path.join(B, d['id'] + '.rows'))[0]
print(f'== stage-engine check sets left: {len(ex)} ({mb(exb)}): ' + ', '.join(f"{d['id']} s{d.get('stage')} {d.get('status')}" for d in ex[:12]))
BK = os.path.join(D, 'backups')
if os.path.isdir(BK):
    print('== backups')
    for f in sorted(os.listdir(BK)):
        b, n = du(os.path.join(BK, f)); print(f'  {f:48s} {mb(b):>12s} {n:6d} files')
PY
