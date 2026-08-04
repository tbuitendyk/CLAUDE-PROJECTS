#!/usr/bin/env bash
# who-wrote-the-day-files.sh -- read-only: identify the process that writes
# day files without the owner pressing anything. Prints (1) every cache file
# written in the last 36h across ALL symbols, grouped by minute so the actor's
# schedule is visible; (2) the service journal lines around those minutes;
# (3) which paper books are live (their ticks fetch candles for their pairs).
set -uo pipefail
cd /opt/general-classifier
echo "== 1. every cache file written in the last 36h (grouped) =="
find data/cache -name '*.json' -newermt '-36 hours' -printf '%TY-%Tm-%TdT%TH:%TM  %f\n' | sort | head -60
echo
echo "== 2. journal: auto-refresh + tick lines, last 36h =="
journalctl -u general-classifier --since '-36 hours' --no-pager 2>/dev/null | grep -iE 'auto-refresh|tick|refresh' | tail -30 || echo "(journal unavailable)"
echo
echo "== 3. live paper books and their pairs =="
python3 - <<'EOF'
import json, glob
for f in sorted(glob.glob('data/books/book-*.json')):
    try:
        d = json.load(open(f))
        print(f"  {d.get('id','?'):40s} status={d.get('status'):9s} pair={d.get('config',{}).get('pair')} vs {d.get('config',{}).get('compareSymbol')}")
    except Exception as e:
        print(f"  {f}: unreadable ({e})")
print("  (tracker book: DOTUSDT+AVAXUSDT vs BTCUSDT; DOGE book: DOGEUSDT vs BTCUSDT — module pairs, always ticking)")
EOF
