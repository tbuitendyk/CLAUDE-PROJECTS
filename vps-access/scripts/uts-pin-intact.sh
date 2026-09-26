#!/usr/bin/env bash
# uts-pin-intact.sh <setId> -- READ-ONLY. Asks the DEPLOYED code the one question a
# start-again, a fill and a child launch all ask of a set's price files: are the
# files it was launched on still there, as they were then? (3.269.0: a file that
# has only gained hours since is.) Loads the price-file module alone -- never the
# set listing, which rewrites a running set's document from any other process on
# older releases -- as the service's own user. Also prints what the service said
# at start-up about stopped stage 1 sets. The only thing it may write is the
# service's own cache of file fingerprints, exactly as the service's check does.
set -uo pipefail
ID="${1:-}"
[ -n "$ID" ] || { echo "usage: <setId>"; exit 1; }
case "$ID" in *[!A-Za-z0-9._-]*) echo "bad set id"; exit 1;; esac
cd /opt/ultimate-trading-system || exit 1
echo "release $(node -p 'require("./package.json").version')"
sudo -u uts timeout 120 nice -n 19 node -e '
const fs = require("fs");
const id = process.argv[1];
const doc = JSON.parse(fs.readFileSync(`data/stagesets/${id}.json`, "utf8"));
console.log(`${id} "${doc.name}" status ${doc.status} · release ${doc.engineVersion} · ${(doc.perf || {}).unitsDone} of ${(doc.perf || {}).unitsTotal} units done`);
const m = require("./lib/manifest");
const t0 = Date.now();
const r = m.pinnedIntact(doc.dataManifest);
console.log(`price files: intact ${r.intact} · checked ${r.checked} · changed ${r.changed.length}${r.changed.length ? " (" + r.changed.slice(0, 5).join(", ") + ")" : ""} · gone ${r.gone.length}${r.why ? " · " + r.why : ""} · ${Date.now() - t0} ms`);
' "$ID"
echo "== what the service said at start-up"
journalctl -u ultimate-trading-system --since "-30 min" --no-pager -o cat 2>/dev/null | grep -E "stage 1 sets|stopped stage 1|listening on" | tail -5
