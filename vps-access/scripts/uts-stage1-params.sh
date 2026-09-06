#!/usr/bin/env bash
# READ-ONLY. What every stage 1 record set on the box actually recorded in its
# params -- the exact fields the Sweep stage headings are judged against.
set -euo pipefail
APP=/opt/ultimate-trading-system
node -e '
const fs = require("fs");
const dir = "/opt/ultimate-trading-system/data/stagesets";
for (const f of fs.readdirSync(dir).filter((x) => /^s[12]-.*\.json$/.test(x)).sort()) {
  let d; try { d = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8")); } catch (e) { console.log(f, "unreadable"); continue; }
  const p = d.params || {};
  console.log("== " + f + "  stage " + d.stage + "  " + d.name + "  " + d.status);
  console.log("   engineVersion " + d.engineVersion);
  for (const k of ["universe","compare","sizes","geometries","windowLayout","trainOn","weightCap","nullN","fee","allLoaded","startMonth","endMonth","campaign","carry","from"]) {
    if (k in p) console.log("   " + k + " = " + JSON.stringify(p[k]));
  }
  if (d.parent) console.log("   parent = " + JSON.stringify(d.parent));
}
'
