// Shared test scaffolding: temp DB per test process + tiny assert helpers.
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb(name) {
  const file = path.join(os.tmpdir(), `sab-test-${name}-${process.pid}.sqlite`);
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(file + suffix); } catch {}
  }
  process.env.DB_PATH = file;
  return file;
}

let count = 0;
function ok(cond, msg) {
  count++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok: ${msg}`);
}

function approx(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
}

module.exports = { freshDb, ok, approx };
