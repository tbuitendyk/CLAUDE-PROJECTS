#!/usr/bin/env bash
# uts-manifest-diff.sh -- READ-ONLY. The start-again refused with "the price
# files changed since S3 #1c was written (LTCUSDT)". Which LTCUSDT file differs
# between the stamp taken at the launch and the stamp taken at the refusal, by
# how many bytes, when it was last written, and what on this box writes candle
# files at all.
set -uo pipefail
APP=/opt/ultimate-trading-system
SET=s3-mtqr9ps2-3
echo "== LTCUSDT files on disk (newest first) =="
ls -lt --time-style=full-iso "$APP/data/cache/" | grep LTCUSDT | head -8
echo "== every price file written in the last 3 hours =="
find "$APP/data/cache" -type f -mmin -180 -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' | sort | tail -25
echo "== the launch stamp vs the refusal stamp, LTCUSDT =="
node -e '
const fs = require("fs"); const path = require("path");
const dir = "'"$APP"'/data/manifests";
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { return null; } };
const a = rd("'"$SET"'.json"), b = rd("'"$SET"'-continue.json");
console.log("   launch stamp:  " + (a ? a.at : "MISSING"));
console.log("   refusal stamp: " + (b ? b.at : "MISSING"));
if (!a || !b) process.exit(0);
const da = (a.detail || {}).LTCUSDT, db = (b.detail || {}).LTCUSDT;
const show = (d) => Array.isArray(d) ? d : (d && d.files) ? d.files : d;
const fa = show(da), fb = show(db);
const key = (x) => x.file || x.name || x.path || JSON.stringify(x).slice(0, 60);
const ma = new Map((Array.isArray(fa) ? fa : []).map((x) => [key(x), x]));
const mb = new Map((Array.isArray(fb) ? fb : []).map((x) => [key(x), x]));
for (const k of new Set([...ma.keys(), ...mb.keys()])) {
  const x = ma.get(k), y = mb.get(k);
  const same = x && y && JSON.stringify(x) === JSON.stringify(y);
  if (same) continue;
  console.log("   DIFFERS " + k);
  console.log("      launch : " + JSON.stringify(x));
  console.log("      refusal: " + JSON.stringify(y));
}
if (!Array.isArray(fa)) console.log("   (detail shape) launch: " + JSON.stringify(da).slice(0, 300));
if (!Array.isArray(fb)) console.log("   (detail shape) refusal: " + JSON.stringify(db).slice(0, 300));
// every symbol that differs, not just the one named
const all = new Set([...Object.keys(a.detail || {}), ...Object.keys(b.detail || {})]);
const diff = [...all].filter((s) => JSON.stringify((a.detail || {})[s]) !== JSON.stringify((b.detail || {})[s]));
console.log("   symbols whose detail differs: " + (diff.length ? diff.join(", ") : "none"));
'
echo "== the hash cache entries for LTCUSDT =="
node -e '
const fs = require("fs");
let h = null; for (const f of ["'"$APP"'/data/manifests/hashes.json", "'"$APP"'/data/price-hashes.json", "'"$APP"'/data/cache/.hashes.json"]) { try { h = JSON.parse(fs.readFileSync(f, "utf8")); console.log("   " + f); break; } catch (e) {} }
if (!h) { console.log("   (no hash cache file found at the guessed paths)"); process.exit(0); }
const keys = Object.keys(h).filter((k) => k.includes("LTCUSDT"));
for (const k of keys.slice(0, 8)) console.log("   " + k + " -> " + JSON.stringify(h[k]).slice(0, 160));
'
echo "== the run's own window =="
node -e '
const d = require("'"$APP"'/data/stagesets/'"$SET"'.json");
console.log("   params: " + JSON.stringify({ startMonth: (d.params||{}).startMonth, endMonth: (d.params||{}).endMonth, allLoaded: (d.params||{}).allLoaded }));
const p = require("'"$APP"'/data/stagesets/" + ((d.parent||{}).id) + ".json");
console.log("   parent params: " + JSON.stringify({ startMonth: (p.params||{}).startMonth, endMonth: (p.params||{}).endMonth, allLoaded: (p.params||{}).allLoaded, windowLayout: (p.params||{}).windowLayout }));
'
echo "== what writes candle files here =="
grep -rl "cache" /etc/cron.d /etc/cron.daily /etc/cron.hourly /var/spool/cron/crontabs 2>/dev/null | head; systemctl list-timers --all 2>/dev/null | head -8
echo "== service log lines about LTCUSDT or candles since 20:30 =="
journalctl -u ultimate-trading-system --since "2026-09-07 20:30" --no-pager 2>/dev/null | grep -i -E "LTCUSDT|candle|download|refresh|fetch" | tail -12
echo "== the other service, does it write into this cache? =="
systemctl show general-classifier -p ExecStart --value 2>/dev/null | head -c 300; echo
grep -rn "ultimate-trading-system/data/cache\|/data/cache" /etc/systemd/system/general-classifier.service /opt/general-classifier/*.env /etc/general-classifier/* 2>/dev/null | head -5
