// Worker-thread entry point. Deliberately thin: it owns no policy and no
// state beyond the per-thread symbol cache inside bracketwork.js. Every task
// is a pure function call; every result goes straight back to the main
// thread, which remains the ONLY place batch docs are mutated.
//
// The CPU cap needs no plumbing here: throttle.js reads data/settings.json
// (re-checked every ~3s), so a worker picks up a live cap change on its own.
// The kill switch is handled by the pool terminating workers outright, which
// is both immediate and simpler than trying to share an abort epoch across
// threads.
const { parentPort } = require('worker_threads');
const work = require('./bracketwork');

const TASKS = {
  unit: work.unitTask,
  nullRotation: work.nullRotationTask,
};

parentPort.on('message', async (msg) => {
  const { id, kind, payload } = msg;
  try {
    const fn = TASKS[kind];
    if (!fn) throw new Error(`unknown task kind "${kind}"`);
    const result = await fn(payload);
    parentPort.postMessage({ id, ok: true, result });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
  }
});
