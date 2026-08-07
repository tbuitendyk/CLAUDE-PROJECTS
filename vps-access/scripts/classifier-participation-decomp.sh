#!/usr/bin/env bash
# classifier-participation-decomp.sh -- READ-ONLY. The frozen-trigger
# hypothesis was REFUTED (the trigger still clears in 46% of forward periods,
# which cannot explain 2-3 trades). This decomposes where participation is
# actually lost: does the COMMITTEE stand aside, or does the committee call but
# execution never fire? Those are different faults with different fixes.
set -uo pipefail
node -e '
const bracketLib = require("/opt/general-classifier/lib/bracket");
const { scoreDiff } = require("/opt/general-classifier/lib/dataset");
const { buildCombo, trainMembers, quorumCall } = require("/opt/general-classifier/lib/bracketwork");
const fb = require("/opt/general-classifier/lib/forwardbook");
(async () => {
  for (const book of fb.BOOKS) {
    const { geo, maps, chunks } = await buildCombo(book.combo, book.branch, { allLoaded: true });
    const bandPct = Math.abs(book.branch.band);
    for (const c of chunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);
    const outcomeMs = (geo.exitOffsetH || 0) * 3600000;
    const { trainChunks, fwdChunks } = fb.splitFrozen(chunks, fb.TRAIN_THROUGH, fb.SCORE_FROM, outcomeMs);
    const views = bracketLib.comboViews(book.combo.size, geo.featureHours / 24).views;
    const members = await trainMembers(book.members, views, trainChunks, fwdChunks, book.branch, maps, geo);
    const mc = members.map((m) => m.calls);
    const calls = fwdChunks.map((_, i) => quorumCall(mc, i, book.cell.quorum));
    const nonZero = calls.filter((c) => c !== 0).length;
    // Per-member: how often does each member call a direction at all?
    const memberActive = mc.map((c) => c.filter((v) => v !== 0).length);
    const res = bracketLib.simCell(book.cell, fwdChunks, calls, maps.trade, geo, bandPct, 0.125);
    console.log("== " + book.id + " " + book.combo.trade + " (" + book.cell.entry + ", " + book.members.length + " members, quorum " + book.cell.quorum + ")");
    console.log("   forward periods          : " + fwdChunks.length);
    console.log("   committee called a side  : " + nonZero + "  (" + (100*nonZero/fwdChunks.length).toFixed(0) + "% of periods)");
    console.log("   trades executed          : " + (res.trades || 0));
    console.log("   per-member directional   : " + memberActive.map((n) => n + "/" + fwdChunks.length).join("  "));
    console.log("   -> lost at the committee : " + (fwdChunks.length - nonZero) + " periods | lost at execution: " + (nonZero - (res.trades || 0)));
  }
})().catch((e) => { console.log("ERROR:", e.message); });
'
