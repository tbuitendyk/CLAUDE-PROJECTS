// Phase 0: job runner persistence + CoinGecko monthly call ledger.
const { freshDb, ok } = require('./helpers');
freshDb('jobs');

const db = require('../lib/db');
const cg = require('../lib/cg');
const { startJob, getJob, activeJobs, latestResult } = require('../lib/jobs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // --- ledger counts every request, success or not ---
  global.fetch = async () => ({ ok: true, json: async () => ({ fine: true }) });
  await cg.getJson('/ping');
  ok(cg.monthlyCalls() === 1, 'ledger counts a successful call');
  global.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  await cg.getJson('/ping').catch(() => {});
  ok(cg.monthlyCalls() === 2, 'ledger counts an errored call too (quota is billed either way)');

  // --- profiles get cost-model defaults ---
  db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('P', 10, 15, 0)").run();
  const p = db.prepare('SELECT fee_pct, spread_pct FROM profiles WHERE id = 1').get();
  ok(p.fee_pct === 0.38 && p.spread_pct === 0.1, 'fee/spread defaults (0.38 / 0.10)');

  // --- job runner: status transitions + persisted result ---
  const id = startJob('tune-threshold', 1, async (setProgress) => {
    setProgress('working');
    await sleep(50);
    return { result: { best: 7.5 }, params: { targets: 'abc' } };
  });
  ok(getJob(id).status === 'running', 'job starts running');
  await sleep(200);
  const done = getJob(id);
  ok(done.status === 'done' && done.result.best === 7.5, 'job completes with result');

  const persisted = latestResult(1, 'tune-threshold');
  ok(persisted && persisted.result.best === 7.5 && persisted.params.targets === 'abc', 'finished result persisted to analysis_results (survives restart)');

  // --- failing job reports, does not persist ---
  const bad = startJob('tune-threshold', 1, async () => {
    throw new Error('nope');
  });
  await sleep(100);
  ok(getJob(bad).status === 'failed' && getJob(bad).error === 'nope', 'failed job carries its error');
  ok(getJob('deadbeef') === null, 'unknown job id -> null (UI: result expired)');

  // --- cooperative cancel: flagged job aborts at its next setProgress ---
  const { cancelJob } = require('../lib/jobs');
  let progressCalls = 0;
  const slow = startJob('compose', 1, async (setProgress) => {
    for (let i = 0; i < 100; i++) {
      await sleep(20);
      setProgress(`step ${i}`, i);
      progressCalls++;
    }
    return { result: { never: true }, params: {} };
  });
  await sleep(60);

  // --- activeJobs: running jobs discoverable (reload re-attach), light
  // fields only, finished/failed jobs absent ---
  {
    const act = activeJobs();
    ok(act.length === 1 && act[0].id === slow, 'activeJobs lists exactly the running job');
    const a = act[0];
    ok(a.kind === 'compose' && a.profileId === 1 && /^step /.test(a.progress) && Number.isFinite(a.progressPct), 'active entry carries kind/profile/progress/pct');
    ok(!('result' in a) && !('error' in a), 'active entries ship no result payloads');
  }

  const c = cancelJob(slow);
  ok(c.ok === true, 'cancel accepted for a running job');
  await sleep(120);
  const cj = getJob(slow);
  ok(cj.status === 'cancelled' && cj.error === 'cancelled by user', `cancelled job reports honestly (${cj.status})`);
  ok(progressCalls < 100, `job aborted mid-loop at progress call ${progressCalls}`);
  ok(latestResult(1, 'compose') === null, 'cancelled job persists nothing');
  const again = cancelJob(slow);
  ok(again.ok === false && /already cancelled/.test(again.reason), 'double-cancel refused with the reason');
  ok(cancelJob('deadbeef').ok === false, 'cancelling an unknown job refused');
  ok(activeJobs().length === 0, 'activeJobs empty once everything has ended');

  console.log('jobs + ledger tests pass');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
