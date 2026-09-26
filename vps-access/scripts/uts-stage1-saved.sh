#!/usr/bin/env bash
# uts-stage1-saved.sh -- READ-ONLY. Is a stage 1 record set's work on disk, whole
# and readable, unit by unit? (owner, 2026-09-26: "verify with 100% certainty
# that stage 1 is saving the work done so far".)
#
#   arg (optional): a set id. Without one it reads the stage 1 set whose document
#   says it is running, or else the newest stage 1 set.
#
# WHAT IT DOES NOT DO, ON PURPOSE:
#   * it loads none of the service's code. A second copy of the service's set
#     listing, in its own process, marks any running set as broken off and
#     rewrites its document (lib/stages.js listSets), and several scripts on this
#     branch do exactly that;
#   * it asks the service nothing -- the listing it would ask was not answering
#     inside 30 seconds when this was written, and the job needs the service;
#   * it writes nothing, anywhere: files are opened for reading only;
#   * it runs at the lowest processor and disk priority, one block in memory at a
#     time, so the job keeps the machine.
#
# WHAT IT CHECKS, every unit, not a sample:
#   the set document (what it planned, how far it says it is, what it failed);
#   each of the four stores the units write (votes, tau, models, records): the
#   index beside it, and every block the index names, unpacked and read row by row
#   the way the service reads them; every record is the unit its plan says it is,
#   no unit twice, and the blocks it points at in the other three stores exist and
#   hold that unit's rows and nobody else's; and the price files it was launched
#   on: still there, and unchanged since the launch.
set -uo pipefail
D=/opt/ultimate-trading-system/data
echo "now $(date -u +%Y-%m-%dT%H:%M:%SZ) · service up since $(systemctl show ultimate-trading-system -p ActiveEnterTimestamp --value) · restarts $(systemctl show ultimate-trading-system -p NRestarts --value)"
exec nice -n 19 ionice -c3 python3 - "$D" "${1:-}" <<'PY'
import json, os, sys, glob, gzip, zlib, hashlib, datetime

D, want = sys.argv[1], sys.argv[2]
SETS = os.path.join(D, 'stagesets')

def iso(s):
    try: return datetime.datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp()
    except Exception: return None
def when(t):
    return datetime.datetime.utcfromtimestamp(t).strftime('%Y-%m-%dT%H:%M:%SZ') if t else '?'

# ---- which set ---------------------------------------------------------------
if want:
    path = os.path.join(SETS, want + '.json')
else:
    cands = sorted(glob.glob(os.path.join(SETS, 's1-*.json')), key=os.path.getmtime, reverse=True)
    path = None
    for f in cands[:12]:
        try:
            with open(f) as fh: d = json.load(fh)
        except Exception: continue
        if d.get('status') == 'running': path = f; break
    if not path and cands: path = cands[0]
if not path or not os.path.exists(path):
    print('no stage 1 set document found' + (f' for {want}' if want else '')); sys.exit(0)
with open(path) as fh: doc = json.load(fh)
sid = doc.get('id')
st = os.stat(path)
plan = doc.get('plan') or {}
ulist = plan.get('unitList') or []
perf = doc.get('perf') or {}
p = doc.get('params') or {}
fails = doc.get('failures') or []
print(f"\n== the set: {sid} \"{doc.get('name')}\" stage {doc.get('stage')}")
print(f"   status {doc.get('status')} · created {doc.get('createdAt')} · document last written {when(st.st_mtime)} ({st.st_size/1048576:.1f} MB)")
print(f"   release {doc.get('engineVersion')} · measurement block {doc.get('measurements')} · seed {'yes' if doc.get('seed') is not None else 'NO'}")
print(f"   progress: {str(doc.get('progress') or '')[:180]}")
ext = sum(1 for u in ulist if (u.get('extras') or []))
print(f"   plan: {plan.get('units')} units, unit list on the document: {len(ulist)} ({ext} carry extra members)")
print(f"   params: source {p.get('coinsSource')} · plain units {p.get('plainUnits')} · all loaded {p.get('allLoaded')} · layout {p.get('windowLayout')} · train on {p.get('trainOn')} · null set {p.get('nullN')} · fee {p.get('fee')} · campaign {p.get('campaign')!r}")
ud = perf.get('unitsDone') or 0
print(f"   perf: {ud} of {perf.get('unitsTotal')} units done (successes and failures) · workers {perf.get('workers')} · trainings {perf.get('cyclesDone')}/{perf.get('cyclesTotal')}")
el = perf.get('elapsedMs') or 0
if ud and el:
    w = perf.get('workers') or 1
    print(f"   pace: {ud / (el / 3600000):.1f} units/hour · {el * w / ud / 60000:.1f} minutes per unit on each worker · {el/3600000:.1f} h in · about {(perf.get('etaMs') or 0)/3600000:.1f} h left by its own estimate")
order = []
for i, u in enumerate(ulist):
    if not order or order[-1][0] != u.get('trade'): order.append([u.get('trade'), i, 0])
    order[-1][2] += 1
print('   trade coins in plan order (first unit number, units): ' + ', '.join(f"{t} {i}{'*' if i <= ud < i + n else ''}" for t, i, n in order) + '   (* = being worked now)')
print(f"   failures recorded: {len(fails)}" + (f" -- first: {json.dumps(fails[0])[:160]}" if fails else ''))

# ---- the four stores -----------------------------------------------------------
S = os.path.join(D, 'batches', sid.replace('/', '_') + '.rows')
print(f"\n== the stores, in {S}")
if not os.path.isdir(S):
    print('   NO STORE DIRECTORY'); sys.exit(0)
tot = 0
for f in sorted(os.listdir(S)):
    s2 = os.stat(os.path.join(S, f)); tot += s2.st_size
    print(f"   {f:<34} {s2.st_size/1048576:9.2f} MB  last written {when(s2.st_mtime)}")
print(f"   all files: {tot/1048576:.1f} MB")

def store(name):
    plain = os.path.join(S, name + '.jsonl')
    gz = plain + '.gz'
    f = plain if os.path.exists(plain) and os.path.getsize(plain) > 0 else gz
    try:
        with open(f + '.meta.json') as fh: meta = json.load(fh)
    except Exception as e:
        meta = None
    return f, meta

def blocks_of(f, meta):
    """every block the index names, unpacked, as lists of row dicts, one at a time"""
    with open(f, 'rb') as fh:
        for bi, b in enumerate(meta.get('blocks') or []):
            fh.seek(b['at']); raw = fh.read(b['bytes'])
            try: text = gzip.decompress(raw).decode('utf-8')
            except Exception as e:
                yield bi, b, None, f'unpack failed: {e}'; continue
            cols = None; rows = []
            for line in text.split('\n'):
                if not line: continue
                if line[0] == '{':
                    try: cols = json.loads(line)['cols']
                    except Exception: pass
                    continue
                if not cols: continue
                try: arr = json.loads(line)
                except Exception: continue
                rows.append({c: (arr[i] if i < len(arr) else None) for i, c in enumerate(cols)})
            yield bi, b, rows, None

f, meta = store('records')
recs = []
if not meta or not meta.get('squashed'):
    print('   records: NO INDEX -- nothing can be read back'); sys.exit(0)
bl = meta.get('blocks') or []
last = bl[-1] if bl else None
size = os.path.getsize(f)
bad = 0
for bi, b, rows, err in blocks_of(f, meta):
    if err: bad += 1; problems.append(f'records block {bi}: {err}'); continue
    for r in rows:
        recs.append({
            'bi': bi, 'u': r.get('u'), 'unit': (r.get('trade'), r.get('ctx1') or '', r.get('ctx2') or '', r.get('geometry')),
            'blocks': r.get('blocks') or {}, 'score': r.get('score'), 'beat': r.get('beat'),
            'specs': len(r.get('specs') or []), 'perMember': r.get('perMember') is not None,
            'extras': len(r.get('extras') or []),
        })
print(f"   records: index {meta.get('rows')} rows in {len(bl)} blocks · read back {len(recs)} · unreadable blocks {bad} · bytes past the last indexed block {size - ((last['at'] + last['bytes']) if last else 0)}")


owner = {}      # store -> list of the one unit each block holds (None when mixed or empty)
problems = []
for name in ('votes', 'tau', 'models'):
    f, meta = store(name)
    if not meta or not meta.get('squashed'):
        print(f"   {name}: {'no index' if not meta else 'plain, not in blocks'} -- NOT CHECKED"); owner[name] = None; continue
    bl = meta.get('blocks') or []
    last = bl[-1] if bl else None
    end = (last['at'] + last['bytes']) if last else 0
    size = os.path.getsize(f)
    own = []; nrows = 0; bad = 0
    for bi, b, rows, err in blocks_of(f, meta):
        if err: bad += 1; own.append(None); problems.append(f'{name} block {bi}: {err}'); continue
        if len(rows) != b['rows']: problems.append(f"{name} block {bi}: index says {b['rows']} rows, holds {len(rows)}")
        nrows += len(rows)
        us = {r.get('u') for r in rows}
        own.append(next(iter(us)) if len(us) == 1 else None)
    owner[name] = own
    print(f"   {name}: index {meta.get('rows')} rows in {len(bl)} blocks · read back {nrows} rows · unreadable blocks {bad} · bytes past the last indexed block {size - end}")

# ---- every record, against the plan and the other three stores ------------------
print('\n== every record')
seen = {}
for r in recs:
    seen.setdefault(r['u'], []).append(r['bi'])
dups = {u: b for u, b in seen.items() if len(b) > 1}
outside = [r['u'] for r in recs if not isinstance(r['u'], int) or not (0 <= r['u'] < len(ulist))]
wrong = []
for r in recs:
    if isinstance(r['u'], int) and 0 <= r['u'] < len(ulist):
        x = ulist[r['u']]
        if (x.get('trade'), x.get('ctx1') or '', x.get('ctx2') or '', x.get('geometry')) != r['unit']: wrong.append(r['u'])
print(f"   {len(recs)} records · {len(seen)} different units · the same unit twice: {len(dups)} · a number outside the plan: {len(outside)} · not the unit its plan number says: {len(wrong)}")
nomiss = [r['u'] for r in recs if r['score'] is None or r['beat'] is None or not r['specs']]
print(f"   records missing their score, beat or members: {len(nomiss)} · records carrying each member's own reading: {sum(1 for r in recs if r['perMember'])} · carrying extra members: {sum(1 for r in recs if r['extras'])}")
for name in ('votes', 'tau', 'models'):
    own = owner.get(name)
    if own is None: continue
    past = []; empty = []; foreign = []; spans = []
    for r in recs:
        rg = r['blocks'].get(name)
        if not (isinstance(rg, list) and len(rg) == 2): empty.append(r['u']); continue
        a, b = rg
        if b > len(own): past.append(r['u']); continue
        if b <= a: empty.append(r['u']); continue
        if any(own[i] != r['u'] for i in range(a, b)): foreign.append(r['u'])
        spans.append((a, b))
    spans.sort()
    overlap = sum(1 for i in range(1, len(spans)) if spans[i][0] < spans[i - 1][1])
    claimed = sum(b - a for a, b in spans)
    print(f"   {name}: records pointing past what is on disk {len(past)} · pointing at nothing {len(empty)} · pointing at another unit's rows {len(foreign)} · overlapping {overlap} · blocks no record points at {len(own) - claimed}")
    if past: problems.append(f'{name}: units {past[:8]} point past the index')
    if foreign: problems.append(f'{name}: units {foreign[:8]} point at rows that are not theirs')
expect = ud - len(fails)
print(f"   the document says {ud} done and {len(fails)} failed, so {expect} records are due; {len(recs)} are on disk"
      + ('' if len(recs) == expect else f" -- a difference of {len(recs) - expect} (the last unit's blocks are packed after the document is written, so 1 either way while it runs is the writer at work)"))
if recs:
    newest = max(recs, key=lambda r: r['bi'])
    print(f"   the last record on disk is unit {newest['u']} {'/'.join(x for x in newest['unit'] if x)}; index last written {when(os.path.getmtime(f + '.meta.json'))}")

# ---- the price files it was launched on -----------------------------------------
print('\n== the price files it was launched on')
dm = doc.get('dataManifest') or {}
t0 = iso(dm.get('at')) or iso(doc.get('createdAt'))
det = None
if dm.get('detailFile') and '..' not in dm['detailFile']:
    try:
        with open(os.path.join(D, dm['detailFile'])) as fh: det = json.load(fh)
    except Exception as e:
        print(f'   the record of which files it read could not be opened: {e}')
if det and det.get('detail'):
    n = 0; gone = []; changed = []; touched = 0; prefix = []
    for sym, lst in det['detail'].items():
        for x in lst or []:
            if not x or not x.get('file') or not x.get('sha256'): continue
            n += 1
            fp = os.path.join(D, 'cache', x['file'])
            try: s3 = os.stat(fp)
            except FileNotFoundError: gone.append(x['file']); continue
            same = s3.st_size == x.get('bytes')
            if same and not (t0 and s3.st_mtime > t0): continue
            with open(fp, 'rb') as fh: raw = fh.read()
            if same and hashlib.sha256(raw).hexdigest() == x['sha256']: touched += 1; continue
            changed.append(x['file'])
            # WHAT THE LAUNCH READ, PROVED FROM WHAT IS THERE NOW: a day file only ever
            # gains finished hours at its end, so the launch's file should be this file's
            # first (launch bytes - 1) bytes closed with ']' -- and its fingerprint says so or not
            L = x.get('bytes') or 0
            proof = 'no'
            if 2 < L <= len(raw) and raw[L - 2:L] == b'},':
                pre = raw[:L - 1] + b']'
                if hashlib.sha256(pre).hexdigest() == x['sha256']:
                    rows_then = json.loads(pre); rows_now = json.loads(raw)
                    proof = f"YES -- the launch held its first {len(rows_then)} hours (to {when(rows_then[-1]['ts'] / 1000)}); it now holds {len(rows_now)} (to {when(rows_now[-1]['ts'] / 1000)})"
            prefix.append(f"{x['file']}: last written {when(s3.st_mtime)}; launch data recoverable exactly: {proof}")
    print(f"   {n} files across {len(det['detail'])} coins, stamped {dm.get('at')} · gone {len(gone)} · changed {len(changed)} · rewritten since with the same bytes {touched}")
    if gone: print(f"   gone: {', '.join(gone[:6])}")
    for line in prefix[:6]: print('   ' + line)
elif not dm:
    print('   the set carries no record of its price files')

# ---- room ---------------------------------------------------------------------------
v = os.statvfs(D)
print(f"\n== room: {v.f_bavail * v.f_frsize / (1 << 30):.1f} GB free on the disk that holds the data; the stores take {tot / (1 << 30):.2f} GB")
print('\n== VERDICT: ' + ('every block the indexes name was read back, and nothing above is wrong' if not problems and not dups and not outside and not wrong and not nomiss else 'PROBLEMS: ' + '; '.join(problems[:8] + ([f'{len(dups)} unit(s) twice'] if dups else []) + ([f'{len(wrong)} record(s) not their plan unit'] if wrong else []))))
PY
