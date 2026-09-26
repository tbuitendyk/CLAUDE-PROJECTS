#!/usr/bin/env bash
# uts-hours-survey.sh -- READ-ONLY. Before the price record changes from "the
# files a run was launched on" to "the hours each coin held at launch, kept with
# the set" (owner, 2026-09-26: "FIX the data dates by the exact dates every coin
# HAD at the time of starting sweep 1"), count what every record set on the box
# would need: which sets carry a price record, which of those can still be read
# exactly as launched, and how much disk the kept hours would take.
#
# After 3.271.0 it also reports the sets that keep their hours, and proves every
# kept copy against the fingerprint its set recorded.
#
# WHAT IT DOES NOT DO, ON PURPOSE: it loads none of the service's code (a second
# copy of the set listing in its own process has rewritten a running set's
# document before); it asks the service nothing; it writes nothing; it runs at
# the lowest processor and disk priority.
#
# For every pinned file it applies the 3.269.0 rule exactly: a file the size it
# was is hashed whole; a longer one is read up to the size it had at launch, cut
# at the end of an hour and closed with ']', and that is hashed; anything else is
# changed. Each distinct (file, size, fingerprint) is hashed once.
set -uo pipefail
D=/opt/ultimate-trading-system/data
exec nice -n 19 ionice -c3 python3 - "$D" <<'PY'
import json, os, sys, glob, hashlib, re, zlib, collections
D = sys.argv[1]
SETS = os.path.join(D, 'stagesets'); CACHE = os.path.join(D, 'cache')

def sha(b): return hashlib.sha256(b).hexdigest()
memo = {}
def launch_state(f, n, want):
    k = (f, n, want)
    if k in memo: return memo[k]
    p = os.path.join(CACHE, f)
    try: raw = open(p, 'rb').read()
    except FileNotFoundError: memo[k] = ('gone', None); return memo[k]
    if n is None or len(raw) == n: buf = raw
    elif len(raw) < n: memo[k] = ('changed', None); return memo[k]
    elif n < 2 or raw[n-2:n] != b'},': memo[k] = ('changed', None); return memo[k]
    else: buf = raw[:n-1] + b']'
    memo[k] = ('ok' if sha(buf) == want else 'changed', None)   # the bytes are not kept: memory stays small
    return memo[k]
def launch_bytes(f, n):
    raw = open(os.path.join(CACHE, f), 'rb').read()
    return raw if n is None or len(raw) == n else raw[:n-1] + b']'

MONTH = re.compile(r'^([A-Z0-9]+)-1h-(\d{4}-\d{2})\.json$')
DAY = re.compile(r'^([A-Z0-9]+)-1h-(\d{4}-\d{2})-\d{2}\.json$')

docs = []
for p in sorted(glob.glob(os.path.join(SETS, '*.json'))):
    try: d = json.load(open(p))
    except Exception: continue
    if not isinstance(d, dict) or 'stage' not in d: continue
    docs.append(d)

by_stage = collections.Counter(d.get('stage') for d in docs)
print('record sets by stage: ' + ', '.join(f'stage {k}: {v}' for k, v in sorted(by_stage.items(), key=lambda x: str(x[0]))))

kinds = collections.Counter(); bad = []; snaps = {}; per_set_bytes = {}
refs = collections.Counter()
for d in docs:
    st = d.get('stage'); dm = d.get('dataManifest')
    if st not in (1, 2, 3):
        kinds[f'stage {st}: no price record of its own (reads its parent)' if not dm else f'stage {st}: carries a price record'] += 1
        if not dm: continue
    if not dm: kinds['no price record'] += 1; bad.append((d, 'no price record')); continue
    if dm.get('error'): kinds['price record failed at launch'] += 1; bad.append((d, 'record failed: ' + str(dm['error'])[:80])); continue
    rel = dm.get('detailFile')
    if not rel or '..' in rel: kinds['no detail file named'] += 1; bad.append((d, 'no detail file named')); continue
    refs[rel] += 1
    try: det = json.load(open(os.path.join(D, rel)))
    except Exception: kinds['detail file unreadable or gone'] += 1; bad.append((d, f'detail {rel} unreadable or gone')); continue
    detail = det.get('detail') or {}
    gone = []; changed = []; ok = 0; setbytes = 0
    for sym, lst in detail.items():
        lst = [x for x in (lst or []) if x and isinstance(x.get('file'), str) and x.get('sha256')]
        # what the loader reads: the month bundle when one is pinned, else that month's day files
        months = collections.defaultdict(lambda: {'bundle': None, 'days': []})
        for x in lst:
            m = MONTH.match(x['file'])
            if m: months[m.group(2)]['bundle'] = x; continue
            m = DAY.match(x['file'])
            if m: months[m.group(2)]['days'].append(x)
        sig = []
        for x in lst:
            s, buf = launch_state(x['file'], x.get('bytes'), x['sha256'])
            if s == 'gone': gone.append(x['file'])
            elif s == 'changed': changed.append(x['file'])
            else: ok += 1
        for mm in sorted(months):
            e = months[mm]
            for x in ([e['bundle']] if e['bundle'] else sorted(e['days'], key=lambda y: y['file'])):
                sig.append((x['file'], x.get('bytes'), x['sha256']))
                setbytes += x.get('bytes') or 0
        key = (sym, tuple(sig))
        if key not in snaps: snaps[key] = sum((b or 0) for _, b, _ in sig)
    per_set_bytes[d['id']] = setbytes
    if gone or changed:
        kinds['price files moved since launch'] += 1
        bad.append((d, f'{len(changed)} changed, {len(gone)} gone of {ok+len(changed)+len(gone)}' + (f' (e.g. {(changed+gone)[0]})' if changed or gone else '')))
    else:
        kinds['every pinned file reads as at launch'] += 1

print('price records:')
for k, v in kinds.most_common(): print(f'  {v:4d}  {k}')
print(f'sets that cannot be read exactly as launched: {len(bad)}')
for d, why in bad[:40]:
    print(f"  {d.get('id')}  stage {d.get('stage')}  {d.get('status')}  {str(d.get('name') or '')[:40]!r}  created {str(d.get('createdAt') or '')[:16]}  -- {why}")
if len(bad) > 40: print(f'  ... and {len(bad)-40} more')

# THE KEPT HOURS: one copy per coin per distinct launch content, shared by every set that read it
raw_total = sum(snaps.values())
coins = collections.Counter(k[0] for k in snaps)
print(f'kept hours, one per coin per distinct launch content: {len(snaps)} (over {len(coins)} coins), {raw_total/1048576:.0f} MB as the cache holds them')
# measure the compression on a real sample: the largest distinct content, packed as the kept file would be
if snaps:
    (sym, sig), _ = max(snaps.items(), key=lambda kv: kv[1])
    rows = []
    for f, n, w in sig:
        if memo.get((f, n, w), ('',))[0] != 'ok': continue
        try: rows.extend(json.loads(launch_bytes(f, n)))
        except Exception: pass
    text = json.dumps(rows, separators=(',', ':')).encode()
    packed = zlib.compress(text, 6)
    ratio = len(packed) / max(1, len(text))
    print(f'  sample {sym}: {len(rows)} hours, {len(text)/1048576:.1f} MB as text, {len(packed)/1048576:.1f} MB packed ({ratio*100:.0f}%)')
    print(f'  so all of them packed: about {raw_total*ratio/1048576:.0f} MB')
# AFTER 3.271.0: the sets that keep their hours, every copy proved against the
# fingerprint its set recorded (the copies are gzip of the hours as JSON text)
import gzip
kept_sets = [d for d in docs if isinstance(d.get('hours'), dict)]
lost = [d for d in kept_sets if d['hours'].get('lost')]
copies = {}
for d in kept_sets:
    for sym, e in ((d['hours'].get('coins') or {}).items()):
        if isinstance(e, dict) and e.get('file'): copies[e['file']] = (sym, e.get('sha256'))
bad_copies = []
for f, (sym, want) in sorted(copies.items()):
    try:
        text = gzip.open(os.path.join(D, f), 'rb').read()
        if hashlib.sha256(text).hexdigest() != want: bad_copies.append(f + ' (does not match)')
    except FileNotFoundError: bad_copies.append(f + ' (gone)')
    except Exception as e: bad_copies.append(f'{f} ({e})')
still_old = [d for d in docs if d.get('stage') in (1, 2, 3) and d.get('dataManifest')]
size = sum(os.path.getsize(os.path.join(D, f)) for f in copies if os.path.exists(os.path.join(D, f)))
try: on_disk = sorted('hours/' + f for f in os.listdir(os.path.join(D, 'hours')) if f.endswith('.json.gz'))
except FileNotFoundError: on_disk = []
orphans = [f for f in on_disk if f not in copies]
print(f'kept copies on disk: {len(on_disk)}; named by no set: {len(orphans)}' + (f' -- {orphans[:5]}' if orphans else ''))
print(f'sets that keep their hours: {len(kept_sets) - len(lost)}; say they could not: {len(lost)}; still carry the old record: {len(still_old)}')
for d in lost[:10]: print(f"  lost: {d.get('id')} {str(d.get('name') or '')[:40]!r} -- {str(d['hours']['lost'])[:160]}")
print(f'kept copies named by a set: {len(copies)}, {size/1048576:.0f} MB on disk; not whole: {len(bad_copies)}' + (f' -- {bad_copies[:5]}' if bad_copies else ''))
mf = glob.glob(os.path.join(D, 'manifests', '*.json'))
print(f'detail files in manifests/: {len(mf)}, named by a set: {len(refs)}, named by none: {len([m for m in mf if os.path.relpath(m, D) not in refs])}')
st = os.statvfs(D); print(f'free on the data disk: {st.f_bavail*st.f_frsize/1073741824:.0f} GB')
PY
