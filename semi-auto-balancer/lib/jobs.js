const crypto = require('crypto');
const db = require('./db');

// Minimal async job runner (Phase 0). Analysis work (threshold sweeps,
// scanner runs) takes minutes — longer than proxy timeouts — so endpoints
// start a job and return an id; the UI polls GET /api/jobs/:id. Live status
// is in-memory; FINISHED results are also persisted to analysis_results so a
// deploy/restart doesn't discard a completed run (the UI reports an unknown
// id as "result expired — re-run").

const jobs = new Map(); // id -> {id, kind, profileId, status, progress, result, error, startedAt}

function startJob(kind, profileId, fn) {
  const id = crypto.randomBytes(8).toString('hex');
  const job = {
    id,
    kind,
    profileId: profileId == null ? null : Number(profileId),
    status: 'running',
    progress: '',
    result: null,
    error: null,
    startedAt: Date.now(),
  };
  jobs.set(id, job);

  // pct (0-100) is optional; long jobs report it so the UI can render a
  // real progress bar instead of a spinner of faith.
  const setProgress = (text, pct) => {
    job.progress = String(text);
    if (Number.isFinite(pct)) job.progressPct = Math.max(0, Math.min(100, pct));
  };

  (async () => {
    try {
      const { result, params } = await fn(setProgress);
      job.result = result;
      job.status = 'done';
      db.prepare(
        'INSERT INTO analysis_results (profile_id, kind, created_at, params, result) VALUES (?, ?, ?, ?, ?)'
      ).run(job.profileId, kind, Date.now(), JSON.stringify(params ?? null), JSON.stringify(result ?? null));
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
      console.error(`Job ${kind}/${id} failed:`, err.message);
    }
  })();

  return id;
}

function getJob(id) {
  return jobs.get(id) || null;
}

// Most recent persisted result of a kind for a profile (survives restarts).
// profileId null = profile-independent jobs (e.g. the Ladder Lab): stored
// with a NULL profile_id, which the FK on profiles(id) permits.
function latestResult(profileId, kind) {
  const row =
    profileId == null
      ? db
          .prepare(
            'SELECT * FROM analysis_results WHERE profile_id IS NULL AND kind = ? ORDER BY created_at DESC LIMIT 1'
          )
          .get(kind)
      : db
          .prepare(
            'SELECT * FROM analysis_results WHERE profile_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1'
          )
          .get(profileId, kind);
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    createdAt: row.created_at,
    params: row.params ? JSON.parse(row.params) : null,
    result: row.result ? JSON.parse(row.result) : null,
  };
}

module.exports = { startJob, getJob, latestResult };
