#!/usr/bin/env bash
# uts-rotation-count.sh -- READ-ONLY. How many old sweep runs on the box still
# carry rotation rounds (doc.nullTest), before the Verify panel that showed
# them is retired (VERIFY-DESIGN.md decision 8). Prints each with its status.
set -uo pipefail
APP=/opt/ultimate-trading-system
node -e '
  const fs = require("fs"), path = require("path");
  const dir = path.join("'"$APP"'", "data", "batches");
  let files = []; try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")); } catch (e) { console.log("no batches dir: " + e.message); process.exit(0); }
  let runs = 0, withRounds = 0, gates = 0;
  for (const f of files) {
    let d; try { d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (_) { continue; }
    if (!d || typeof d !== "object") continue;
    runs++;
    if (d.params && d.params.plantedGate) gates++;
    if (d.nullTest) { withRounds++; console.log("   " + (d.id || f) + ": " + (d.nullTest.status || "?") + ", " + (d.nullTest.shifts ?? 0) + " round(s), run status " + (d.status || "?")); }
  }
  console.log("runs on disk " + runs + " · carrying rotation rounds " + withRounds + " · planted-gate runs " + gates);
'
