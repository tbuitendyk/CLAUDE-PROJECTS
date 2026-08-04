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
    // Never evict a RUNNING job (D3, review 2026-08-04): eviction blinded
    // anyJobRunning() and orphaned live pollers.
    if (jobs.size > KEEP) {
      for (const [id2, j2] of jobs) {
        if (jobs.size <= KEEP) break;
        if (j2.status !== 'running') jobs.delete(id2);
      }
    }
  })();
  return id;
}

function getJob(id) {
  return jobs.get(id) || null;
}

// True while any download/refresh/analysis job is in flight. Exists because
// batchRunning() sees only batches — the planted-check gate fired during a
// running Global Refresh whose tail then rewrote the fabricated pair under
// the gate sweep's workers (adversarial review, 2026-08-03, MAJOR).
function anyJobRunning() {
  for (const j of jobs.values()) if (j.status === 'running') return j.id;
  return null;
}

module.exports = { startJob, getJob, anyJobRunning };
