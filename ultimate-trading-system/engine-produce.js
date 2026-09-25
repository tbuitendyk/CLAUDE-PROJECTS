#!/usr/bin/env node
'use strict';
// engine-produce.js -- THE DECISIONS FOR SETUPS ON THE NEW TRADING ENGINE (loop
// of 2026-09-25, LOOP-2026-09-25-ENGINE.md).
//
// Run by the web service once a minute, as a child of its own, while a setup on
// an engine is in paper or live state: the committee is trained here, which
// takes time the service's pages must not wait on. What it does, step by step,
// is lib/live/engineproduce.js; this file only runs it against the real things
// and prints what it did.
// No AI anywhere: deterministic arithmetic over candles.
const { makeProducer, realDependencies } = require('./lib/live/engineproduce');

(async () => {
  const now = Date.now();
  const only = process.argv.includes('--setup') ? process.argv[process.argv.indexOf('--setup') + 1] : null;
  const out = await makeProducer(realDependencies()).run(now, only);
  process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exit(0);
})().catch((e) => { process.stderr.write(`engine-produce FAILED: ${e.message}\n`); process.exit(1); });
