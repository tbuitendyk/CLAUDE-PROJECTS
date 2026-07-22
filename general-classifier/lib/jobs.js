const crypto = require('crypto');

// Minimal in-memory async job runner. A full run (downloads + training) can
// outlast a proxy timeout, so the endpoint starts a job and returns an id;
// the UI polls GET /api/jobs/:id. Results live until the process restarts —
// this is an analysis tool, not a system of record.

const jobs = new Map();
const KEEP = 20;

function startJob(fn) {
  const id = crypto.randomBytes(8).toString('hex');
  const job = { id, status: 'running', progress: '', result: null, error: null, startedAt: Date.now() };
  jobs.set(id, job);
  const setProgress = (text) => {
    job.progress = String(text);
  };
  (async () => {
    try {
      job.result = await fn(setProgress);
      job.status = 'done';
    } catch (err) {
      job.error = err.message || String(err);
      job.status = 'error';
    }
    while (jobs.size > KEEP) jobs.delete(jobs.keys().next().value);
  })();
  return id;
}

function getJob(id) {
  return jobs.get(id) || null;
}

module.exports = { startJob, getJob };
