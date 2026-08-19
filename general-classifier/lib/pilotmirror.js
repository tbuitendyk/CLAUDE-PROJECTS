// pilotmirror.js -- the pilot's MIRROR CHECK (review findings 26 + 7).
//
// The pilot's entire premise is that every live fill has a 1:1 paper twin — the
// same frozen-F1 committee call the forward book would make. That claim was
// ADVERTISED (the UI names "mirror-breaks") but never COMPUTED. This module is
// the missing comparison: for each recorded live decision, it takes a fresh
// recompute of the F1 call for that same chunk (computeSignalForChunk, which
// reads CURRENT data) and asks "does it still reproduce what we traded on?"
//
// A break means the instrument is unreliable, not that the idea is wrong (the
// project's gate philosophy): the day-file data the live decision used was later
// revised, or the monthly bundle published different candles (finding 7), or the
// engine/config changed under us. Any of those makes the live book drift from
// its twin — so a break HALTS new entries until it is examined, exactly the
// "fix the instrument and measure again" rule.
//
// Pure and side-effect free except the tiny state helpers; the CLI wrapper
// (pilot-mirror.js) does the recompute and the halt. This split keeps the
// decision logic unit-testable without the engine or the network.
const fs = require('fs');
const path = require('path');

const DECISIONS_DIR = path.join(__dirname, '..', 'data', 'pilot', 'decisions');
const MIRROR_FILE = path.join(__dirname, '..', 'data', 'pilot', 'mirror.json');
// A finalized candle can still be revised by a hair; a decision-price move under
// this is treated as a benign revision, over it as a real divergence. GUESSED,
// deliberately tight — the fidelity metric the pilot measures is in this range.
// compareDecision and PRICE_TOL now live in lib/decisioncompare.js — the one
// integrity rule both rails use never belonged inside one config's module.
const { compareDecision, PRICE_TOL } = require('./decisioncompare');

function loadDecisions(dir = DECISIONS_DIR) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (_) { return []; }
  const out = [];
  for (const f of files) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch (_) { /* skip torn */ }
  }
  return out.sort((a, b) => String(a.chunk_start).localeCompare(String(b.chunk_start)));
}

// Persist the live decision at production time. Keyed by chunk_start so a re-ship
// within the same period overwrites rather than duplicates. This is the record
// the recompute is checked against — NOT a fresh read (finding 7).
function writeDecision(record, dir = DECISIONS_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  const key = String(record.chunk_start).replace(/[^0-9A-Za-z]/g, '').slice(0, 20) || 'na';
  const file = path.join(dir, `${key}.json`);
  const tmp = `${file}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(record));
  fs.renameSync(tmp, file);
  return file;
}

// STAND-DOWN records (owner 2026-08-13): FLAT calls ship no intent, so they used
// to leave no trace anywhere and the screen's daily history showed only trade
// days. They are recorded HERE, in their own directory — deliberately NOT in
// DECISIONS_DIR, because that store feeds the mirror whose breaks HALT the live
// box; a stand-down is display history, never a tradable decision twin, and
// must not be able to perturb the mirror. Keyed by chunk_start (idempotent).
const STANDDOWN_DIR = path.join(__dirname, '..', 'data', 'pilot', 'standdowns');
function writeStandDown(record, dir = STANDDOWN_DIR) {
  return writeDecision(record, dir);
}
function loadStandDowns(dir = STANDDOWN_DIR) {
  return loadDecisions(dir);
}

function writeMirror(result, file = MIRROR_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(result));
  fs.renameSync(tmp, file);
}

function readMirror(file = MIRROR_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

module.exports = {
  compareDecision, loadDecisions, writeDecision, writeMirror, readMirror,
  writeStandDown, loadStandDowns, STANDDOWN_DIR,
  DECISIONS_DIR, MIRROR_FILE, PRICE_TOL,
};
