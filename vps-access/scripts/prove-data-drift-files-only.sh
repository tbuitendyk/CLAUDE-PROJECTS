#!/usr/bin/env bash
# prove-data-drift-files-only.sh -- read-only, SHORT: both fire times, then
# every UNIUSDT/LTCUSDT cache file written after 0611 fired. Nothing else,
# so the deploy API's output cap cannot eat the evidence.
set -euo pipefail
cd /opt/general-classifier
python3 - <<'EOF'
import json, glob, os, datetime
def load(pat):
    f = sorted(glob.glob(f'data/batches/*{pat}*.json'))
    return json.load(open(f[0]))
a = load('20260803-0611-null9-census'); b = load('20260804-0733-null9-census')
t_a = a.get('startedAt') or a.get('createdAt'); t_b = b.get('startedAt') or b.get('createdAt')
print(f"0611 fired {t_a}")
print(f"0733 fired {t_b}")
cut = datetime.datetime.fromisoformat(t_a.replace('Z','+00:00')).timestamp()
for sym in ('UNIUSDT','LTCUSDT'):
    hits = [(f, os.stat(f)) for f in sorted(glob.glob(f'data/cache/{sym}*')) if os.stat(f).st_mtime > cut]
    print(f"{sym}: {len(hits)} cache file(s) new/rewritten after 0611 fired:")
    for f, st in hits[:8]:
        print(f"   {os.path.basename(f):40s} {st.st_size:>10,} bytes  {datetime.datetime.utcfromtimestamp(st.st_mtime).isoformat()}Z")
EOF
