#!/usr/bin/env bash
# uts-coins-table.sh -- READ-ONLY. What the Coins screen shows for one coin,
# as text: per chunk shape, the table under the bar (the whole bar, then every
# part under each window layout), under the sit-out band as it is set on the
# box right now. Nothing is read again and nothing is written; it asks the
# same route the screen asks and prints what the screen prints.
#   uts-coins-table.sh LTCUSDT      one coin
#   uts-coins-table.sh              every coin (may exceed what reaches a session)
set -uo pipefail
COIN="${1:-}"
curl -s --max-time 60 -H 'Accept-Encoding: identity' http://127.0.0.1:8094/api/coins/records \
| COIN="$COIN" node -e '
let raw = ""; process.stdin.on("data", (c) => raw += c).on("end", () => {
  let d; try { d = JSON.parse(raw); } catch (e) { console.log("no answer from the service"); return; }
  const want = String(process.env.COIN || "").toUpperCase();
  const f = (v, n = 2) => (v == null ? "—" : Number(v).toFixed(n));
  const mv = (v) => (v == null ? "—" : (v > 0 ? "+" : "") + Number(v).toFixed(2));
  const sh = (v) => (v == null ? "—" : (v * 100).toFixed(1));
  const pts = (v) => (v == null ? "—" : (v > 0 ? "+" : "") + (v * 100).toFixed(1));
  const day = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : "—");
  console.log(`band ${d.band.value} (default ${d.band.default}) · layouts ${d.layouts.join(" then ")} · ${d.records.length} coin(s) on disk` + (d.unreadable.length ? ` · ${d.unreadable.length} undrawable` : ""));
  for (const r of d.records) {
    if (want && r.coin !== want) continue;
    console.log(`\n== ${r.coin} · read ${String(r.provenance.capturedAt).slice(0, 16)} · release ${r.provenance.release} · ${r.provenance.candles} candles${r.read ? "" : " · NOT READ: " + r.why}`);
    for (const s of d.shapes) {
      const x = r.shapes[s.key];
      if (!x || !x.periods) { console.log(`-- ${s.label}: ${x && x.why || "not read"}`); continue; }
      const ts = [x.t0]; for (const dt of x.dt) ts.push(ts[ts.length - 1] + dt * 3600000);
      console.log(`-- ${s.label} · ${x.periods} decisions ${day(x.span.fromTs)}..${day(x.span.toTs)} · moves ${mv(x.range.largestFall)}..${mv(x.range.largestRise)} · median ${f(x.yardstick)} · sit out under ±${f(x.threshold)}`);
      console.log("   part     starts      n    r    f    s thin        chg   run  upR   upF   gapP  mvR    mvF    gapM");
      const row = (name, p) => {
        const g = p.gap || {}; const R = g.afterRising || {}; const F = g.afterFalling || {};
        console.log(`   ${name.padEnd(8)} ${day(ts[p.from])} ${String(p.decisions).padStart(4)} ${String(p.rising).padStart(4)} ${String(p.falling).padStart(4)} ${String(p.sitOut).padStart(4)} ${(g.thinSide ? g.thinSide.n + " " + g.thinSide.which[0] : "—").padEnd(11)} ${String(p.changes).padStart(4)} ${f(p.run, 1).padStart(5)} ${sh(R.shareUp).padStart(5)} ${sh(F.shareUp).padStart(5)} ${pts(g.gapShare).padStart(6)} ${mv(R.meanOut).padStart(6)} ${mv(F.meanOut).padStart(6)} ${mv(g.gapMove).padStart(6)}`);
      };
      row("whole", { ...x.whole, from: 0 });
      for (const lay of d.layouts) {
        const L = x.layouts[lay];
        if (!L || L.why) { console.log(`   ${lay}: ${L && L.why || "—"}`); continue; }
        console.log(`   [${lay}]`);
        for (const p of L.parts) row(p.name, p);
      }
    }
  }
});'
