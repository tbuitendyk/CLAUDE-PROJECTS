#!/usr/bin/env bash
# WHAT THE FILTER ON TABLE 3.C KEEPS (owner, 2026-09-23: "look at the record
# set that is kept on 3.c and indicate if it's a good selection for funnel").
# For every stage 3 set carrying a stored filter on Table 3.C -- or the one set
# named -- the filter, whether the unit table it reads is fresh against the
# tables and the rebuilt numbers, how the kept rows compare with the dropped
# ones on the readings that separate garbage from something, and every kept
# row. Reads only; nothing is written.
# arg (optional): a set id, or a set id with a trial filter to lay on its unit
# table instead of the stored one: <set id>+<box>@<value>+<box>@<value>...
# (e.g. s3-x+minBoardBeats@8+minChunksAPart@40). The trial is read only here;
# the stored filter is never touched.
set -uo pipefail
ARG="${1:-}"
cd /opt/ultimate-trading-system || exit 1
node --max-old-space-size=600 -e '
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const UT = require("./lib/unittable");
const DIR = "data/stagesets";
const argParts = String(process.argv[1] || "").split("+");
const want = argParts[0] || "";
const trial = argParts.length > 1 ? Object.fromEntries(argParts.slice(1).map((p) => p.split("@"))) : null;
const safe = (id) => String(id).replace(/[^A-Za-z0-9._-]+/g, "_");
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (_) { return null; } };
function tallyHead(id) {
  return new Promise((resolve) => {
    const f = path.join(DIR, `${safe(id)}-tally.json.gz`);
    if (!fs.existsSync(f)) return resolve(null);
    const rs = fs.createReadStream(f); const gz = zlib.createGunzip();
    let acc = ""; let done = false;
    const finish = (v) => { if (done) return; done = true; rs.destroy(); gz.destroy(); resolve(v); };
    gz.on("data", (c) => { acc += c.toString("utf8"); const i = acc.indexOf("\n"); if (i >= 0) { try { finish(JSON.parse(acc.slice(0, i))); } catch (e) { finish({ error: e.message }); } } else if (acc.length > 65536) finish({ error: "no header line" }); });
    gz.on("error", (e) => finish({ error: e.message })); gz.on("end", () => finish(null));
    rs.pipe(gz);
  });
}
const f = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? "-" : Number(v).toFixed(d));
(async () => {
  const docs = fs.readdirSync(DIR).filter((n) => /^s3-[^.]+\.json$/.test(n)).map((n) => readJson(path.join(DIR, n))).filter((d) => d && d.stage === 3 && d.id);
  const pick = want ? docs.filter((d) => d.id === want) : docs.filter((d) => d.unitFilter && Object.keys(d.unitFilter).length);
  if (!pick.length) {
    console.log(want ? `no stage 3 set called ${want}` : "no stage 3 set carries a stored filter on Table 3.C. The sets and their unit tables:");
    for (const d of docs) { const t = readJson(path.join(DIR, `${safe(d.id)}.units.json`)); console.log(`   ${d.id}  ${d.name}  unit table: ${t ? `${t.units.length} rows built ${t.builtAt}` : "none"}  filter: ${JSON.stringify(d.unitFilter || null)}`); }
    return;
  }
  for (const d of pick) {
    console.log(`== ${d.name} (${d.id})`);
    console.log(`   filter on Table 3.C: ${JSON.stringify(d.unitFilter || {})}`);
    // does the deployed code accept it? A filter naming a box the table no
    // longer has is refused, and a refused filter stops Table 3.C and the Funnel
    try { UT.cleanFilter(d.unitFilter || {}); console.log("   the deployed code accepts this filter"); } catch (e) { console.log(`   THE DEPLOYED CODE REFUSES THIS FILTER: ${e.message}`); }
    const table = readJson(path.join(DIR, `${safe(d.id)}.units.json`));
    if (!table || !Array.isArray(table.units)) { console.log("   no unit table on disk yet"); continue; }
    // a table of an older shape is built again by the service the next time it is asked for
    if (table.v !== 2) { console.log(`   the unit table on disk is of an older shape (v${table.v}); the service builds it again the next time Boards or the Funnel asks for it`); continue; }
    const head = await tallyHead(d.id);
    const idx = readJson(path.join(DIR, `${safe(d.id)}.funnelrich`, "index.json"));
    const richAt = idx && idx.v === 5 ? idx.savedAt : null;
    console.log(`   unit table built ${table.builtAt} under ${table.release}; fresh against the tables: ${head && head.builtAt === table.tallyBuiltAt ? "yes" : `NO (${head && head.builtAt})`}; against the rebuilt numbers: ${(table.richSavedAt || null) === richAt ? "yes" : `NO (${richAt})`}`);
    const all = table.units;
    const storedKept = new Set(UT.applyFilter(all, d.unitFilter || {}).map((r) => r.unit));
    if (trial) console.log(`   TRIAL filter, read here only: ${JSON.stringify(trial)} (the stored filter keeps ${storedKept.size})`);
    const kept = UT.applyFilter(all, trial || d.unitFilter || {});
    const keptSet = new Set(kept.map((r) => r.unit));
    const dropped = all.filter((r) => !keptSet.has(r.unit));
    console.log(`   keeps ${kept.length} of ${all.length} coins and shapes`);
    const K = (rows, test) => rows.filter(test).length;
    const tests = [
      ["board beats copies at least 8", (r) => r.boardBeats != null && r.boardBeats >= 8],
      ["board beats copies at most 2", (r) => r.boardBeats != null && r.boardBeats <= 2],
      ["top 30 in the third $ above 0", (r) => r.top30Third != null && r.top30Third > 0],
      ["top 30 in the third $ blank", (r) => r.top30Third == null],
      ["first two -> third at least 0.3", (r) => r.h123 != null && r.h123 >= 0.3],
      ["beat the best of the four at least 50%", (r) => r.beatBestPct != null && r.beatBestPct >= 50],
      ["avg test $ above 0", (r) => r.avgTest != null && r.avgTest > 0],
      ["middle test $ above 0", (r) => r.midTest != null && r.midTest > 0],
      ["chunks a part at least 40", (r) => r.chunksAPart != null && r.chunksAPart >= 40],
      ["losing in all three parts over 40%", (r) => r.loseAllPct != null && r.loseAllPct > 40],
    ];
    console.log(`   how many of the kept / of the dropped:`);
    for (const [w, t] of tests) console.log(`     ${w.padEnd(36)} ${String(K(kept, t)).padStart(3)} of ${kept.length}   ${String(K(dropped, t)).padStart(3)} of ${dropped.length}`);
    const byThird = kept.slice().sort((a, b) => ((b.top30Third ?? -1e9) - (a.top30Third ?? -1e9)) || ((b.boardBeats ?? -1) - (a.boardBeats ?? -1)));
    const show = byThird.slice(0, 32);
    console.log(`   the kept rows, top 30 in the third $ first (${show.length} shown of ${kept.length}):`);
    if (trial) console.log(`   of the rows the trial keeps, ${kept.filter((r) => storedKept.has(r.unit)).length} are also kept by the stored filter; a * marks them`);
    console.log("     name | settings | in the money (share) | avg $ | avg no gate | $/trade | mid $ | best $ | parts in money % | all3% | losing in all three (share) | 1>2 2>3 1>3 12>3 | top30 3rd $ | board copies | beat best of four% | best vs long $ | mid trades | blocked% | chunks");
    for (const r of show) {
      console.log(`     ${trial && storedKept.has(r.unit) ? "*" : ""}${r.name} | ${r.settings} | ${r.inMoneyN ?? "-"} (${f(r.inMoneyPct)}) | ${f(r.avgTest, 2)} | ${f(r.avgTestNoGate, 2)} | ${f(r.perTrade, 2)} | ${f(r.midTest, 2)} | ${f(r.bestTest, 0)} | ${f(r.inMoney1, 0)}/${f(r.inMoney2, 0)}/${f(r.inMoney3, 0)} | ${f(r.allThreePct)} | ${r.loseAllN ?? "-"} (${f(r.loseAllPct, 0)}) | ${f(r.h12, 2)} ${f(r.h23, 2)} ${f(r.h13, 2)} ${f(r.h123, 2)} | ${f(r.top30Third, 2)} | ${r.boardBeats ?? "-"}/${r.copies ?? "-"} | ${f(r.beatBestPct, 1)} | ${f(r.bestVsLong, 0)} | ${f(r.midTrades, 0)} | ${f(r.fieldBlocked, 0)} | ${r.chunksAPart ?? "-"}`);
    }
  }
})().catch((e) => { console.log("probe failed:", e.message); process.exit(1); });
' "$ARG"
