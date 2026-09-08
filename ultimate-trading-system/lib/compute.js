// WHERE EACH PART OF THE SYSTEM RUNS (owner design, 2026-08-25).
//
// The owner's words: the Setup page gets a Compute tab, "where a future user
// would do the config work of pointing at a sweep processor platform, a trade
// decision engine platform, and the trading platform", with CPU control per
// resource and the starting, stopping and restarting of the services beside it.
//
// This file is the small, honest core of that: which ROLES exist, which
// PLATFORMS exist, and which platform each role points at. Three rules:
//
//   * THE PLATFORM LIST COMES FROM HERE, NEVER FROM THE PAGE (RULE FIVE). The
//     page fills its dropdowns from what this reports. Today exactly one
//     platform exists — this machine. When a separate sweep runner is built and
//     registered, it appears in this list and every dropdown grows on its own.
//
//   * A STORED CHOICE IS READ, OR IT IS A LIE. Every launch of the three-stage
//     engine checks where "sweep processor" "runs on" before starting and
//     refuses, naming the platform as the dropdown shows it, if it points
//     somewhere this box cannot reach yet. A setting nothing reads would sit
//     on the screen looking like control.
//
//   * THE TRADING PLATFORM IS NOT DUPLICATED HERE. Each trading setup already
//     names its own execution target, per profile, on the Trade page — the
//     owner ordered that per-profile split and it is where the real control
//     lives. The Compute tab says so and points there, rather than growing a
//     second copy that could disagree with the first.
//
// The choices live in data/settings.json beside the two CPU settings that were
// already there (worker_threads, service_cpu_pct), because they are the same
// kind of thing: how this installation spends its machine.
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');

// The one platform that exists today. An id, not a hostname: what it means is
// "the machine this service is running on", wherever that is.
const LOCAL = 'this-machine';

// The two roles whose platform is chosen HERE. The trading platform is chosen
// per trading setup on the Trade page (executionTargetRef) — see the header.
const ROLES = [
  { key: 'sweep', label: 'sweep processor' },
  { key: 'decisions', label: 'trade decision engine' },
];

function platforms() {
  // Registration of remote platforms is the future sweep-runner's job; it will
  // add itself here. Until then the list is one entry long, and that is the
  // truth rather than a placeholder.
  return [{ id: LOCAL, label: 'this machine' }];
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (_) { return {}; }
}

function roles() {
  const stored = (readSettings().compute_roles || {});
  const out = {};
  const known = new Set(platforms().map((p) => p.id));
  for (const r of ROLES) {
    // A stored platform that no longer exists falls back to this machine and
    // says nothing silently — config() reports what was stored AND what is in
    // force, so a fallback is visible rather than quiet.
    out[r.key] = { stored: stored[r.key] ?? null, inForce: known.has(stored[r.key]) ? stored[r.key] : LOCAL };
  }
  return out;
}

function config() {
  return { roles: roles(), platforms: platforms(), rolesOffered: ROLES };
}

function setRole(key, platformId) {
  if (!ROLES.some((r) => r.key === key)) {
    throw new Error(`"${key}" is not a role chosen here — the roles are ${ROLES.map((r) => r.key).join(', ')}`);
  }
  if (!platforms().some((p) => p.id === platformId)) {
    throw new Error(`"${platformId}" is not a platform this system knows. `
      + `Available: ${platforms().map((p) => `${p.id} (${p.label})`).join(', ')}`);
  }
  const settings = readSettings();
  settings.compute_roles = { ...(settings.compute_roles || {}), [key]: platformId };
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  // Atomic for the same reason throttle.js is: worker threads and the pool read
  // this file live, and a torn read must never be possible.
  const tmp = `${SETTINGS_FILE}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 1));
  fs.renameSync(tmp, SETTINGS_FILE);
  return roles()[key];
}

// THE CHECK THAT MAKES THE SETTING REAL. Read by every launch of the three-
// stage engine (lib/stages.js: the launches' shared gate, the stage-engine
// check's status, and the worker pool itself as the backstop): a run may only
// start here while "sweep processor" "runs on" this machine. When a remote
// runner exists this is where dispatching branches; until then the dropdown
// offers only this machine, and a hand-edited settings file naming a platform
// that is not registered falls back to this machine visibly (stored and
// in-force are reported apart) rather than refusing. The answer is written in
// the Compute tab's own words, and the platform is named as its dropdown shows
// it, never by its id.
function sweepRunsHereOr() {
  const r = roles().sweep;
  if (r.inForce === LOCAL) return null;
  const label = (platforms().find((p) => p.id === r.inForce) || {}).label || r.inForce;
  return `"sweep processor" runs on "${label}", and this service can only run sweeps on this machine. `
    + 'Set it back to "this machine" on the Compute tab of the Setup page.';
}

module.exports = { config, roles, setRole, sweepRunsHereOr, platforms, ROLES, LOCAL };
