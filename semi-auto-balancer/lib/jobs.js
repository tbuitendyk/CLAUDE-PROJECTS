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
  // Cancellation is COOPERATIVE: cancelJob() sets a flag, and the next
  // setProgress call throws it out of the job fn — every long-running job
  // (compose, tune, ladder) reports progress frequently, so cancel lands
  // within seconds without the search code knowing cancellation exists.
  const setProgress = (text, pct) => {
    if (job.cancelRequested) {
      const e = new Error('cancelled by user');
      e.cancelled = true;
      throw e;
    }
    job.progress = String(text);
    if (Number.isFinite(pct)) job.progressPct = Math.max(0, Math.min(100, pct));
  };

  // Cooperative PAUSE: job code awaits this gate at its yield points; while
  // pauseRequested it parks (holding its place — nothing is lost), waking
  // ~150ms after resume. Cancel-while-paused releases the gate so the next
  // setProgress can throw the cancellation as usual.
  const pauseGate = async () => {
    while (job.pauseRequested && !job.cancelRequested) {
      job.paused = true;
      await new Promise((r) => setTimeout(r, 150));
    }
    job.paused = false;
  };
  // Deploy-surviving pause: when the job parks, its loop hands the gate a
  // full state snapshot which is PERSISTED — pause → deploy → resume works
  // because the checkpoint outlives the process. One per (kind, profile);
  // re-pause replaces it; completion deletes it.
  pauseGate.pending = () => Boolean(job.pauseRequested && !job.cancelRequested);
  pauseGate.cancelPending = () => Boolean(job.cancelRequested);
  pauseGate.saveCheckpoint = (state) => {
    db.prepare(
      'INSERT OR REPLACE INTO job_checkpoints (kind, profile_id, created_at, progress, progress_pct, state) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(kind, job.profileId, Date.now(), job.progress || '', job.progressPct ?? null, JSON.stringify(state));
    job.checkpointed = true;
  };

  const dropCheckpoint = () => {
    try {
      if (job.profileId == null) db.prepare('DELETE FROM job_checkpoints WHERE kind = ? AND profile_id IS NULL').run(kind);
      else db.prepare('DELETE FROM job_checkpoints WHERE kind = ? AND profile_id = ?').run(kind, job.profileId);
    } catch { /* best-effort */ }
  };

  (async () => {
    try {
      const { result, params } = await fn(setProgress, pauseGate);
      job.result = result;
      job.status = 'done';
      db.prepare(
        'INSERT INTO analysis_results (profile_id, kind, created_at, params, result) VALUES (?, ?, ?, ?, ?)'
      ).run(job.profileId, kind, Date.now(), JSON.stringify(params ?? null), JSON.stringify(result ?? null));
      dropCheckpoint(); // finished — the persisted result supersedes it
    } catch (err) {
      if (err.cancelled || job.cancelRequested) {
        job.status = 'cancelled';
        job.error = 'cancelled by user';
        dropCheckpoint(); // an explicit cancel discards the paused state too
        console.log(`Job ${kind}/${id} cancelled by user`);
      } else {
        // A FAILED job keeps its checkpoint — a resume can retry after the
        // cause (e.g. a data hiccup) clears.
        job.status = 'failed';
        job.error = err.message;
        console.error(`Job ${kind}/${id} failed:`, err.message);
      }
    }
  })();

  return id;
}

// Request cancellation of a running job. Returns what happened: a finished
// or unknown job cannot be cancelled (honest feedback beats a silent no-op).
function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return { ok: false, reason: 'unknown job id (expired or never existed)' };
  if (job.status !== 'running') return { ok: false, reason: `job already ${job.status}` };
  job.cancelRequested = true;
  return { ok: true };
}

// Pause/resume a running job (cooperative, same contract as cancel). A
// finished or unknown job refuses honestly.
function pauseJob(id, paused) {
  const job = jobs.get(id);
  if (!job) return { ok: false, reason: 'unknown job id (expired or never existed)' };
  if (job.status !== 'running') return { ok: false, reason: `job already ${job.status}` };
  job.pauseRequested = Boolean(paused);
  return { ok: true, paused: job.pauseRequested };
}

function getJob(id) {
  return jobs.get(id) || null;
}

// Snapshot of every RUNNING job (light fields — no result payloads). Live
// status is in-memory only, so without this a page reload silently orphans
// the progress display while the search keeps burning CPU server-side; a
// reloaded page calls this to rediscover and re-attach to running jobs.
function activeJobs() {
  return [...jobs.values()]
    .filter((j) => j.status === 'running')
    .map((j) => ({
      id: j.id,
      kind: j.kind,
      profileId: j.profileId,
      progress: j.progress,
      progressPct: j.progressPct ?? null,
      paused: Boolean(j.pauseRequested),
      startedAt: j.startedAt,
    }));
}

// Persisted paused-search checkpoints (they outlive restarts — that is the
// point). Light listing for the UI; getCheckpoint returns the full state.
function listCheckpoints() {
  return db
    .prepare('SELECT id, kind, profile_id, created_at, progress, progress_pct FROM job_checkpoints ORDER BY created_at DESC')
    .all()
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      profileId: r.profile_id,
      createdAt: r.created_at,
      progress: r.progress,
      progressPct: r.progress_pct,
    }));
}

function getCheckpoint(id) {
  const r = db.prepare('SELECT * FROM job_checkpoints WHERE id = ?').get(id);
  if (!r) return null;
  return { id: r.id, kind: r.kind, profileId: r.profile_id, createdAt: r.created_at, state: JSON.parse(r.state) };
}

function deleteCheckpoint(id) {
  return db.prepare('DELETE FROM job_checkpoints WHERE id = ?').run(id).changes > 0;
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

module.exports = {
  startJob,
  getJob,
  cancelJob,
  pauseJob,
  activeJobs,
  latestResult,
  listCheckpoints,
  getCheckpoint,
  deleteCheckpoint,
};
