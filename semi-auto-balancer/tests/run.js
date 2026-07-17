#!/usr/bin/env node
// Test runner: executes each tests/test-*.js in its own process (fresh module
// cache + its own temp DB), reports pass/fail. `npm test` runs this.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const files = fs
  .readdirSync(dir)
  .filter((f) => /^test-.*\.js$/.test(f))
  .sort();

let failed = 0;
for (const f of files) {
  const res = spawnSync(process.execPath, [path.join(dir, f)], {
    stdio: 'inherit',
    timeout: 120_000,
  });
  if (res.status !== 0) {
    failed++;
    console.error(`\n✗ ${f} FAILED (exit ${res.status})`);
  } else {
    console.log(`✓ ${f}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${files.length} test file(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${files.length} test file(s) passed`);
