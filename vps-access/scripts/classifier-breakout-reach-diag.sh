#!/usr/bin/env bash
# classifier-breakout-reach-diag.sh -- READ-ONLY. Tests the declared hypothesis
# for F2/F3's ten-fold participation collapse: their breakout entry needs a move
# of dMult x band (1.5 x 1.61% = 2.415%) before it triggers, and the band is
# FROZEN. If forward volatility is lower than the training era, the trigger is
# simply out of reach and the books stand aside — a limitation of any frozen
# breakout book, not a property of these two.
# Compares |period move| in the training era against the forward window, and
# how often each clears the trigger. F1 (market entry, no distance) is shown
# alongside as the control that should NOT be affected.
set -uo pipefail
node -e '
const { GEOMETRIES } = require("/opt/general-classifier/lib/dataset");
const { buildCombo } = require("/opt/general-classifier/lib/bracketwork");
const fb = require("/opt/general-classifier/lib/forwardbook");
(async () => {
  const pct = (a) => (100 * a).toFixed(1) + "%";
  for (const book of fb.BOOKS) {
    const { geo, chunks } = await buildCombo(book.combo, book.branch, { allLoaded: true });
    const outcomeMs = (geo.exitOffsetH || 0) * 3600000;
    const { trainChunks, fwdChunks } = fb.splitFrozen(chunks, fb.TRAIN_THROUGH, fb.SCORE_FROM, outcomeMs);
    const trig = book.cell.dMult == null ? null : book.cell.dMult * Math.abs(book.branch.band);
    const mag = (cs) => cs.map((c) => Math.abs(c.diffPct)).sort((a, b) => a - b);
    const tm = mag(trainChunks), fm = mag(fwdChunks);
    const med = (a) => (a.length ? a[Math.floor(a.length / 2)] : NaN);
    const over = (a, t) => (t == null || !a.length ? null : a.filter((x) => x >= t).length / a.length);
    // Recent training era, for a fairer comparison than the whole 8 years.
    const recent = tm.length > 400 ? mag(trainChunks.slice(-400)) : tm;
    console.log("== " + book.id + " " + book.combo.trade + " " + book.branch.geometry
      + " | entry " + book.cell.entry + (trig == null ? " (no distance to reach)" : " | trigger " + trig.toFixed(3) + "% move"));
    console.log("   median |move|:  training " + med(tm).toFixed(2) + "%   last-400 training " + med(recent).toFixed(2)
      + "%   FORWARD " + med(fm).toFixed(2) + "%   (" + fwdChunks.length + " forward periods)");
    if (trig != null) {
      console.log("   share of periods clearing the trigger:  training " + pct(over(tm, trig))
        + "   last-400 " + pct(over(recent, trig)) + "   FORWARD " + pct(over(fm, trig)));
    } else {
      console.log("   market entry: every period with a call trades, so participation cannot collapse this way");
    }
  }
})().catch((e) => { console.log("ERROR:", e.message); });
'
