// THE CHOICES RECOVERY, OFF THE ANSWERING THREAD (owner order, 2026-08-26).
//
// Naming the records of a run recorded before rows carried their choices
// means reading every replication row once — minutes on the owner's run.
// This worker does that one job: match the rows against the census records
// in write order (lib/choices.js, the only definition of the matching), save
// the spans beside the rows, exit.
//
// At the kindest priority the box offers, same as the totals worker: the
// pages and any running sweep always win the scheduler over this.
const { parentPort, workerData } = require('worker_threads');
try { require('./threadnice').threadNice(); } catch (_) { /* priority is a kindness, not a need */ }

const choices = require('./choices');

try {
  const out = choices.buildAndSaveUnits(workerData.runId, (scanned) => {
    parentPort.postMessage({ scanned });
  });
  parentPort.postMessage({ done: true, spans: out ? out.spans.length : 0 });
} catch (err) {
  parentPort.postMessage({ error: err.message || String(err) });
  process.exit(1);
}
