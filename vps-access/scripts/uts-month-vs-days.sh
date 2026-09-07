#!/usr/bin/env bash
# uts-month-vs-days.sh -- READ-ONLY. Does LTCUSDT's new August 2026 month file
# hold exactly the candles its August day files hold? Candle by candle.
set -uo pipefail
APP=/opt/ultimate-trading-system
node -e '
const fs = require("fs"); const path = require("path");
const dir = "'"$APP"'/data/cache";
const load = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const shape = (x) => Array.isArray(x) ? "array[" + x.length + "] first=" + JSON.stringify(x[0]).slice(0, 120) : "object keys=" + Object.keys(x).slice(0, 8).join(",");
const month = load("LTCUSDT-1h-2026-08.json");
console.log("month file: " + shape(month));
const rows = (x) => Array.isArray(x) ? x : (x.candles || x.rows || x.data || []);
const key = (c) => Array.isArray(c) ? String(c[0]) : String(c.t ?? c.openTime ?? c.time ?? c.ts);
const val = (c) => JSON.stringify(Array.isArray(c) ? c.slice(0, 6) : [c.o ?? c.open, c.h ?? c.high, c.l ?? c.low, c.c ?? c.close, c.v ?? c.volume]);
const M = new Map(rows(month).map((c) => [key(c), val(c)]));
const days = fs.readdirSync(dir).filter((f) => /^LTCUSDT-1h-2026-08-\d\d\.json$/.test(f)).sort();
console.log("day files: " + days.length + " (" + days[0] + " .. " + days[days.length - 1] + ")");
let same = 0, differ = 0, onlyDays = 0; const examples = [];
const D = new Map();
for (const f of days) for (const c of rows(load(f))) D.set(key(c), val(c));
for (const [k, v] of D) { if (!M.has(k)) { onlyDays++; if (examples.length < 3) examples.push("only in days: " + k); } else if (M.get(k) === v) same++; else { differ++; if (examples.length < 3) examples.push("differs at " + k + ": days " + v + " month " + M.get(k)); } }
let onlyMonth = 0; for (const k of M.keys()) if (!D.has(k)) { onlyMonth++; if (examples.length < 6) examples.push("only in month: " + k + " (" + new Date(Number(k)).toISOString() + ")"); }
console.log("candles in the day files: " + D.size + " · in the month file: " + M.size);
console.log("identical: " + same + " · differing: " + differ + " · only in day files: " + onlyDays + " · only in month file: " + onlyMonth);
for (const e of examples) console.log("   " + e);
'
echo "== the same for one coin whose August month file already existed at the launch (ETHUSDT) =="
ls -la --time-style=full-iso "$APP/data/cache/" | grep -E "ETHUSDT-1h-2026-08(\.json|-0[1-3])" | head -5
