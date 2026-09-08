#!/usr/bin/env node
// THE STAGE ENGINE'S OWN PLANTED CHECK, RUN BY HAND (3.87.0). The same press
// the button on Verify makes, from a terminal: it fabricates the two coins,
// runs the three stages, cuts and reads a Stage 4 set on each, grades the five
// gates, writes one record in data/stage-gate/ and deletes everything else it
// made. Minutes. Exit 0 on PASS, 1 on FAIL or a failure to run.
//   node tests/adversarial/stage-gate.js
const stages = require('../../lib/stages');

(async () => {
  const first = stages.stageGateStart();
  console.log(`started ${first.run ? first.run.id : '?'} under release ${first.release}`);
  let last = '';
  for (;;) {
    const s = stages.stageGateStatus();
    const step = s.run ? s.run.step : '';
    if (step !== last) { console.log(`  ${new Date().toISOString().slice(11, 19)} ${step}`); last = step; }
    if (s.state !== 'RUNNING') {
      if (s.run && s.run.error) { console.error(`\nSTAGE-ENGINE CHECK FAILED TO RUN: ${s.run.error}`); process.exit(1); }
      console.log(`\n${s.state} (${s.last ? Math.round((s.last.elapsedMs || 0) / 1000) : '?'} s)`);
      for (const t of (s.last && s.last.sentences) || []) console.log(`  ${t}`);
      console.log(`  a fair coin clears the bar by chance about 1 in ${s.last && s.last.copies ? s.last.copies + 1 : '?'} times`);
      process.exit(s.state === 'PASS' ? 0 : 1);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
})().catch((err) => { console.error(`\nSTAGE-ENGINE CHECK FAILED TO START: ${err.message}`); process.exit(1); });
