#!/usr/bin/env bash
# classifier-moneyleader-detail.sh -- READ-ONLY: the exact construction of the
# three rows that cleared the declared money floor, including committee SIZE
# (slim rows carry 4 members, promoted 8 — a cell cannot be reproduced without
# knowing which).
set -uo pipefail
node -e '
const fs=require("fs");
const d=JSON.parse(fs.readFileSync("/opt/general-classifier/data/batches/bracketlab-20260805-193433-real.json","utf8"));
const want=(r)=>{const h=r.holdout;if(!h||h.pnl==null||!h.trades)return false;
  const legs=h.trades*2,gross=h.pnl+legs*0.125;return h.pnl>0 && gross/legs>=0.1875;};
for(const r of (d.leaders||[])){
  if(!want(r))continue;
  const h=r.holdout;
  console.log("---",[r.trade,r.ctx1,r.ctx2].filter(Boolean).join("+"));
  console.log("  stage:",r.stage,"| members:",r.members,"| quorum:",r.quorum,
    "| geometry:",r.geometry,"| decision:",r.decision,"| band:",(r.bandPct!=null?r.bandPct.toFixed(2)+"%":"n/a"));
  console.log("  cell: entry",r.entry,"| gate",r.gate,"| dMult",r.dMult,"| tHours",r.tHours,"| trail",r.trailMult);
  console.log("  search-window pnl $"+ (r.pnl!=null?r.pnl.toFixed(2):"n/a"),
    "| vsControl", r.vsControl!=null?("$"+r.vsControl.toFixed(2)):"n/a");
  console.log("  HELD-BACK: net $"+h.pnl.toFixed(2),"("+h.trades+"t,",h.wins,"wins,",h.periods,"periods)",
    "| alwaysLong $"+(h.holds?h.holds.alwaysLong.toFixed(2):"n/a"),
    "| alwaysShort $"+(h.holds&&h.holds.alwaysShort!=null?h.holds.alwaysShort.toFixed(2):"n/a"));
  console.log("  stamps:",JSON.stringify(r.windowStamps||"(none)"));
}
'
