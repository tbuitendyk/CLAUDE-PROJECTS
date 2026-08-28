#!/usr/bin/env bash
# READ-ONLY: the exact selections the stage 3 launch recorded, and the exact
# store sizes it produced. Ground truth for the should-vs-is audit.
set -euo pipefail
cd /opt/ultimate-trading-system
node - <<'JS'
const fs = require('fs');
const rowstore = require('./lib/rowstore');
const d3 = JSON.parse(fs.readFileSync('data/stagesets/s3-mtb7gy7e-1.json', 'utf8'));
const p = d3.params || {};
console.log('== S3 #1, the recorded selections ==');
console.log('cell:', JSON.stringify(p.cell));
console.log('cellPermute:', JSON.stringify(p.cellPermute));
console.log('decision:', JSON.stringify(p.decision), 'permuteDecision:', !!p.permuteDecision);
console.log('band:', JSON.stringify(p.band), 'permuteBand:', !!p.permuteBand);
console.log('weekdaysOnly:', JSON.stringify(p.weekdaysOnly), 'permuteWeekdays:', !!p.permuteWeekdays);
console.log('nullN:', p.nullN, 'fee:', p.fee, 'carry:', p.carry);
console.log('plan: units', (d3.plan || {}).units, 'settings', (d3.plan || {}).settings);
console.log('records rows in the store:', rowstore.count(d3.id, 'records'));
JS
