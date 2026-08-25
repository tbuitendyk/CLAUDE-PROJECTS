// THE TOTALS PASS, OFF THE ANSWERING THREAD (owner order, 2026-08-25).
//
// Reading every replication row of a big run takes minutes. Done on the main
// thread it froze every page — that was the outage. This worker does that one
// job: stream the rows through the shared tally (lib/replication.js, the only
// definition of the arithmetic), save the result beside the rows, exit.
//
// At the kindest priority the box offers, same as the sweep's own workers: the
// pages and any running sweep always win the scheduler over this.
const { parentPort, workerData } = require('worker_threads');
try { require('./threadnice').threadNice(); } catch (_) { /* priority is a kindness, not a need */ }

const replication = require('./replication');

try {
  const totals = replication.buildAndSaveTotals(workerData.runId, (scanned) => {
    parentPort.postMessage({ scanned });
  });
  parentPort.postMessage({ done: true, rowsSeen: totals.rowsSeen });
} catch (err) {
  parentPort.postMessage({ error: err.message || String(err) });
  process.exit(1);
}
