'use strict';
// engine/journal.js -- THE ENGINE'S RECORD OF EVERYTHING IT DID, append-only.
// One JSON line per event, numbered from 1, never rewritten. The engine's state
// after a restart is read back out of it, and the web box follows it line by
// line to draw Paper Books and Live Trading -- so what the screen shows is what
// was written down, nothing kept only in memory.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const KEEP = 5000;   // the newest lines kept in memory for a follower catching up

class Journal extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.n = 0;
    this.tail = [];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      for (const rec of this.readAll()) { this.n = Math.max(this.n, Number(rec.n) || 0); this.keep(rec); }
    }
  }

  *readAll() {
    if (!fs.existsSync(this.file)) return;
    const text = fs.readFileSync(this.file, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { yield JSON.parse(line); } catch (_) { /* a torn last line from a crash is skipped, never repaired */ }
    }
  }

  keep(rec) {
    this.tail.push(rec);
    if (this.tail.length > KEEP) this.tail.splice(0, this.tail.length - KEEP);
  }

  append(event, now = Date.now()) {
    this.n += 1;
    const rec = { n: this.n, ts: now, utc: new Date(now).toISOString(), ...event };
    fs.appendFileSync(this.file, `${JSON.stringify(rec)}\n`);
    this.keep(rec);
    this.emit('record', rec);
    return rec;
  }

  // every line numbered `from` or later, oldest first, at most `limit`
  since(from, limit = 1000) {
    const want = Math.max(1, Number(from) || 1);
    if (this.tail.length && this.tail[0].n <= want) return this.tail.filter((r) => r.n >= want).slice(0, limit);
    const out = [];
    for (const rec of this.readAll()) { if (rec.n >= want) out.push(rec); if (out.length >= limit) break; }
    return out;
  }
}

module.exports = { Journal };
