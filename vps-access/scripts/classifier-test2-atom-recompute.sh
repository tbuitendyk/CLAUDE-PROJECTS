#!/usr/bin/env bash
# classifier-test2-atom-recompute.sh -- TEST 2 of the interlaced-instrument
# verification (owner, 2026-07-31): recompute ATOM daily-1d argmax's
# interlaced-arm held-back money INDEPENDENTLY of the engine.
#
# Inputs: the L14 saved member file (votes per held-back period) and the raw
# monthly candle JSONs. Everything else -- majority vote, trade arithmetic,
# gap handling -- is reimplemented below in Python from the written spec,
# sharing not one line with the Node engine.
#
# DECLARED PASS: money matches the census to the cent; trade and win counts
# match exactly.
set -uo pipefail
python3 <<'EOF'
import json, glob, sys

ROOT = "/opt/general-classifier/data"
JOB = "bracketlab-20260730-2306-l14-both-layouts"
HOUR = 3_600_000

# --- the engine's answer, straight from the stored job record ---------------
doc = json.load(open(f"{ROOT}/batches/{JOB}.json"))
row = next(r for r in doc["edgeCensus"]
           if r["trade"] == "ATOMUSDT" and r["geometry"] == "daily-1d"
           and r["decision"] == "argmax" and r.get("windowLayout") == "interlaced"
           and not r.get("shiftFrac"))
print(f'engine says: ${row["holdPnl"]:+.2f} over {row["holdTrades"]} trades, {row["holdWins"]} wins '
      f'(cell {row["cellEntry"]}/{row["cellGate"]}/t{row["cellTHours"]}h q{row["cellQuorum"]})')
assert row["cellEntry"] == "market" and row["cellQuorum"] == 1, "this checker implements the market/q1 cell only"
T_HOURS = row["cellTHours"]

# --- the saved votes --------------------------------------------------------
files = glob.glob(f"{ROOT}/models/{JOB}/ATOMUSDT*daily-1d*argmax*interlaced-real.json")
assert len(files) == 1, files
dump = json.load(open(files[0]))
votes = dump["votes"]["hold"]; starts = dump["startTs"]["hold"]
assert len(votes) == 6, f"expected 6 members, got {len(votes)}"
n = len(starts)
print(f"saved file: {files[0].split('/')[-1]} -- 6 members, {n} held-back periods")

# --- candles, read raw and forward-filled per the spec (gaps <=3h filled at
# --- the previous close; longer gaps stay missing) --------------------------
candles = {}
for f in glob.glob(f"{ROOT}/cache/ATOMUSDT-1h-*.json"):
    for r in json.load(open(f)):
        candles[r["ts"]] = (r["open"], r["close"])
ts_sorted = sorted(candles)
for a, b in zip(ts_sorted, ts_sorted[1:]):
    gap = (b - a) // HOUR - 1
    if 1 <= gap <= 3:
        pc = candles[a][1]
        for h in range(1, gap + 1):
            candles[a + h * HOUR] = (pc, pc)
print(f"candles: {len(candles):,} hourly (after gap fill)")

# --- fresh arithmetic -------------------------------------------------------
pnl = 0.0; trades = 0; wins = 0; unpriced = 0; flats = 0
for i in range(n):
    up = sum(1 for m in votes if m[i] == 1)
    dn = sum(1 for m in votes if m[i] == -1)
    if up == dn:
        flats += 1
        continue
    d = 1 if up > dn else -1
    entry_ts = starts[i] + 25 * HOUR
    if entry_ts not in candles:
        unpriced += 1
        continue
    exit_open = None
    for h in range(0, 4):
        c = candles.get(entry_ts + T_HOURS * HOUR + h * HOUR)
        if c: exit_open = c[0]; break
    if exit_open is None:
        unpriced += 1
        continue
    entry_open = candles[entry_ts][0]
    v = (100.0 * (exit_open / entry_open - 1.0)) * d - 0.25
    pnl += v; trades += 1
    if v > 0: wins += 1

print(f"recomputed:  ${pnl:+.2f} over {trades} trades, {wins} wins ({flats} stood aside, {unpriced} unpriced)")
ok_p = abs(pnl - row["holdPnl"]) < 0.01
ok_t = trades == row["holdTrades"]
ok_w = wins == row["holdWins"]
print(f'  {"ok  " if ok_p else "FAIL"} money matches to the cent (diff ${pnl - row["holdPnl"]:+.4f})')
print(f'  {"ok  " if ok_t else "FAIL"} trade count matches ({trades} vs {row["holdTrades"]})')
print(f'  {"ok  " if ok_w else "FAIL"} win count matches ({wins} vs {row["holdWins"]})')
print("\nTEST 2 PASS" if (ok_p and ok_t and ok_w) else "\nTEST 2 FAIL")
sys.exit(0 if (ok_p and ok_t and ok_w) else 1)
EOF
