#!/usr/bin/env bash
# uts-running-progress.sh -- READ-ONLY. The stage run going right now: how far
# it is by the service's own progress line, what its document records, and what
# it has written to disk so far (record store blocks, sizes, last write).
set -uo pipefail
B=http://127.0.0.1:8094
D=/opt/ultimate-trading-system/data
echo "== the service's own progress line =="
curl -sf --max-time 30 "$B/api/stagesets" | python3 -c "
import json,sys,datetime,time
d=json.load(sys.stdin)
r=d.get('running')
if not r: print('   nothing running'); raise SystemExit
print('   ' + json.dumps(r, indent=None)[:1500])
p=r.get('progress') or r.get('perf') or r
"
echo "== the document on disk =="
python3 - <<'PY'
import json,glob,os,time,datetime
D='/opt/ultimate-trading-system/data'
docs=[json.load(open(f)) for f in glob.glob(D+'/stagesets/s3-*.json')]
run=[d for d in docs if d.get('status')=='running']
for d in run:
    keep={k:d.get(k) for k in ['id','name','stage','status','createdAt','startedAt','finishedAt','parent','perf','progress','cancelRequested']}
    p=d.get('params') or {}
    keep['params']={k:p.get(k) for k in ['nullN','keepN','fee','windowLayout','engineVersion','recordsToPrice','carry','selected'] if k in p}
    keep['plan']={k:(d.get('plan') or {}).get(k) for k in ['units','settings','parts'] if k in (d.get('plan') or {})}
    print('   ' + json.dumps(keep, default=str)[:2500])
    sid=d['id']
    print('== what it has written so far ==')
    for root in [D+'/stagesets/'+sid, D+'/rowstore/'+sid, D+'/records/'+sid]:
        if os.path.isdir(root):
            tot=0; newest=0; n=0
            for dp,_,fs in os.walk(root):
                for f in fs:
                    st=os.stat(os.path.join(dp,f)); tot+=st.st_size; n+=1; newest=max(newest,st.st_mtime)
            print('   %s: %d file(s), %.1f MB, last write %s' % (root, n, tot/1048576, datetime.datetime.utcfromtimestamp(newest).strftime('%Y-%m-%d %H:%M:%S')+'Z'))
    cands=[x for x in glob.glob(D+'/**/*'+sid+'*', recursive=True)]
    print('   paths carrying its id: ' + ', '.join(sorted(set(os.path.relpath(c,D) for c in cands))[:12]))
PY
echo "== the box =="
uptime
echo "   service since: $(systemctl show ultimate-trading-system -p ActiveEnterTimestamp --value)"
