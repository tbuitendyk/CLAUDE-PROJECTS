#!/usr/bin/env bash
# classifier-verdict-check.sh -- READ-ONLY: prove on the BOX that the null
# verdict can actually be read for a multi-asset setup.
#
# Why a live call and not a grep: the fault was in the HTTP route, which dropped
# ctx1/ctx2 out of the selection it handed to lib/verdict.js. The front end sent
# them correctly and the library keyed on them correctly; only the wire between
# them was cut, and no grep over either end can see that. The one thing that
# answers it is asking the deployed service.
#
# This picks a real three-asset setup out of a saved run on the box and asks for
# its verdict. A pass is a perSetup block naming the FULL combo. A failure looks
# like "setup ZECUSDT|||... not in this run's real rows" — the singles key,
# which is what a dropped context produces.
set -uo pipefail
B=http://127.0.0.1:8093

node -e '
const http = require("http");
const B = "127.0.0.1", P = 8093;
const get = (p) => new Promise((res, rej) => {
  http.get({ host: B, port: P, path: p }, (r) => { let s = ""; r.on("data", (d) => { s += d; }); r.on("end", () => { try { res(JSON.parse(s)); } catch (e) { rej(new Error(p + ": " + s.slice(0, 200))); } }); }).on("error", rej);
});
const post = (p, body) => new Promise((res, rej) => {
  const b = JSON.stringify(body);
  const r = http.request({ host: B, port: P, path: p, method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(b) } }, (x) => {
    let s = ""; x.on("data", (d) => { s += d; }); x.on("end", () => { try { res({ code: x.statusCode, body: JSON.parse(s) }); } catch (e) { rej(new Error(s.slice(0, 200))); } });
  });
  r.on("error", rej); r.write(b); r.end();
});

(async () => {
  const vs = await get("/api/bracketlab/verdict-sources");
  const src = (vs.sources || []).filter((s) => s.realRows > 0 && s.scrambleDraws > 0);
  if (!src.length) { console.log("SKIP: no run on this box carries both real rows and null draws"); process.exit(0); }

  let checked = 0, failed = 0;
  for (const s of src.slice(0, 4)) {
    const doc = await get("/api/batch/" + encodeURIComponent(s.id));
    // a real (unscrambled) census row that carries context pairs — the case the
    // route used to break, and the only shape the live vocabulary accepts
    const row = (doc.edgeCensus || []).find((r) => r.nullDealSeed == null && !r.shiftFrac && r.holdPnl != null && r.ctx1);
    if (!row) continue;
    checked++;
    const combo = [row.trade, row.ctx1, row.ctx2].filter(Boolean).join("+");
    const out = await post("/api/bracketlab/null-verdict", {
      realId: s.id, nullId: s.id,
      trade: row.trade, ctx1: row.ctx1 || null, ctx2: row.ctx2 || null,
      geometry: row.geometry, decision: row.decision,
      ...(row.layoutArm ? { windowLayout: row.layoutArm } : {}),
    });
    if (out.code !== 200 || !out.body.perSetup) {
      failed++;
      console.log(`  FAIL ${s.id} ${combo}: ${out.body.error || "no perSetup block"}`);
      continue;
    }
    const k = out.body.perSetup.setup;
    const ok = k.includes(row.ctx1);
    if (!ok) { failed++; console.log(`  FAIL ${s.id} ${combo}: verdict came back keyed as ${k} — the contexts were dropped`); continue; }
    console.log(`  OK   ${s.id} ${combo}: ${k} — beats ${out.body.perSetup.beats}/${out.body.perSetup.n} null draws`);
  }

  if (!checked) { console.log("SKIP: no multi-asset row on this box to test with"); process.exit(0); }
  console.log(failed ? `\n${failed} of ${checked} multi-asset verdict(s) FAILED` : `\nall ${checked} multi-asset verdict(s) read correctly`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log("ERROR: " + e.message); process.exit(2); });
'
