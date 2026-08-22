// CAMPAIGN NAME (owner order, 2026-08-04): a high-level analysis name the
// owner sets once; every run launched while it is set carries it, so the
// saved-runs list shows at a glance which runs belong to the same cycle of
// tests. Stored on disk so it survives reloads and restarts; cleared by
// setting it empty.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'campaign.json');

// Letters, numbers, spaces, dashes, dots; trimmed; max 40 chars. Anything
// else is refused loudly — the name rides in ids' company and in every list.
function sanitizeCampaign(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return '';
  if (s.length > 40) throw new Error('campaign name: 40 characters at most');
  if (!/^[A-Za-z0-9 ._-]+$/.test(s)) {
    throw new Error('campaign name: letters, numbers, spaces, dots and dashes only');
  }
  return s;
}

function readFile() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch { return {}; }
}

function writeFile(obj) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, FILE);
}

function getCampaign() {
  const v = readFile().name;
  return typeof v === 'string' && v ? v : '';
}

// NAMES THE OWNER HAS DECLARED, kept because they cannot be worked out from
// anything else (owner, 2026-08-21). The catalogue below is COMPUTED from runs
// and greenlights, which is right for those and wrong for a name that has just
// been set: a brand new campaign owns nothing yet, so it appeared nowhere and
// the owner had to retype it until the first run existed.
//
// This is not the "second ledger that could drift" the tree avoids. There is no
// other record of a declared name to disagree with — that is exactly why it has
// to be stored.
function declaredNames() {
  const f = readFile();
  const v = Array.isArray(f.declared) ? f.declared.filter((x) => typeof x === 'string' && x) : [];
  // THE NAME THAT IS SET RIGHT NOW COUNTS, whether or not it was ever added to
  // the list. Two ways that happens, and the second is the one that bit:
  //
  //   * a campaign set before this list existed at all — the stored file has a
  //     name and no list, so a fix that only wrote the list on the next Set
  //     left the campaign already in use invisible. Which it did: the owner had
  //     set one, and the screen still counted zero.
  //   * a file edited by hand, or restored from a backup written by older code.
  //
  // Deriving it from the name in use costs nothing and needs no migration step
  // that somebody has to remember to run.
  const cur = typeof f.name === 'string' && f.name ? f.name : null;
  if (cur && !v.includes(cur)) v.push(cur);
  return v;
}

function setCampaign(raw) {
  const name = sanitizeCampaign(raw);
  const cur = readFile();
  const declared = declaredNames();
  if (name && !declared.includes(name)) declared.push(name);
  writeFile({ ...cur, name, declared, setAt: new Date().toISOString() });
  return name;
}

// CAMPAIGN AS A REAL PARENT (owner 2026-08-14; NEXT-RELEASE points 13/14/25).
// The tree is COMPUTED on read from records that already carry the campaign
// stamp — batch runs (doc.campaign, stamped at every launch since 2026-08-04)
// and greenlights — never from a second ledger that could drift (the
// forwardbook lesson: a recomputation cannot disagree with itself).
// Lineage: a run that derives from another carries its parent's id in params
// (sourceRunId for History Tuning, sourceRun for HT v2 etc.); those links are
// surfaced verbatim so branches that share an original sweep are connected by
// data, not naming discipline.
function campaignTree(name) {
  const runs = [];
  try {
    const { listBatches } = require('./batch');
    for (const row of listBatches()) {
      const p = row.params || {};
      if ((p.campaign || null) !== name) continue;
      runs.push({
        id: row.id, kind: row.kind || 'bracketlab', status: row.status,
        startedAt: row.startedAt || null, label: p.label || '',
        parentRunId: p.sourceRunId || p.srcId || null,
      });
    }
  } catch (_) { /* no batches dir yet */ }
  const greenlights = [];
  try {
    for (const g of require('./live/greenlight').listGreenlights()) {
      if ((g.campaign || null) !== name) continue;
      greenlights.push({ id: g.id, createdUtc: g.createdUtc, target: g.target,
        sourceRunId: (g.sourceRun && g.sourceRun.id) || null, revoked: !!g.revoked });
    }
  } catch (_) { /* live modules absent in some test contexts */ }
  runs.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  return { name, runs, greenlights };
}

// Every campaign name that appears on any run or greenlight, newest activity
// first — the selector for the Constructing Sweep section.
function listCampaignNames() {
  const seen = new Map(); // name -> newest activity stamp
  const note = (name, utc) => {
    if (!name) return;
    const cur = seen.get(name);
    if (!cur || String(utc) > cur) seen.set(name, String(utc || ''));
  };
  try {
    for (const row of require('./batch').listBatches()) note((row.params || {}).campaign, row.startedAt);
  } catch (_) { /* none */ }
  try {
    for (const g of require('./live/greenlight').listGreenlights()) note(g.campaign, g.createdUtc);
  } catch (_) { /* none */ }
  // A declared name with nothing under it yet sorts last rather than being
  // absent. It has no activity stamp, so '' puts it at the bottom.
  for (const n of declaredNames()) if (!seen.has(n)) seen.set(n, '');
  return [...seen.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([n]) => n);
}

// ---------------------------------------------------------------------------
// DELETING A CAMPAIGN, AND EVERYTHING UNDER IT (owner, 2026-08-21)
//
// A campaign is a parent: runs carry its name, greenlights carry its name, and
// setups are minted from those greenlights. Deleting the name alone would leave
// all of that behind, pointing at a campaign that no longer exists — records
// that lie about themselves, which is the fault class this system keeps finding.
//
// So the delete takes the whole chain, and it says exactly what that is FIRST.
// The count is not decoration: it is the only way the owner can tell a campaign
// with one abandoned sweep from one holding a season of work, and they are told
// before they answer, not after.
//
// THE ONE THING THAT STOPS IT is a setup that is actually deployed. Those hold
// or have held positions; removing the evidence a trading setup was minted from
// would leave money running against a record that is gone.

// What counts as "still deployed". The SAME list the rest of the system uses
// for that question rather than a second copy of it: draft is not deployed and
// retired is finished, everything between them is.
function activeStates() {
  try { return require('./live/pairs').ACTIVE_STATES; } catch (_) { return ['paper', 'live', 'stopped']; }
}

// Everything this campaign owns, counted by kind. Read-only.
function campaignContents(name) {
  const clean = sanitizeCampaign(name);
  if (!clean) throw new Error('name a campaign to look at');

  const runs = [];
  try {
    for (const row of require('./batch').listBatches()) {
      if (((row.params || {}).campaign || null) !== clean) continue;
      runs.push({ id: row.id, kind: row.kind || 'bracketlab', status: row.status });
    }
  } catch (_) { /* no batches yet */ }

  const greenlights = [];
  try {
    for (const g of require('./live/greenlight').listGreenlights()) {
      if ((g.campaign || null) !== clean) continue;
      greenlights.push({ id: g.id, revoked: !!g.revoked });
    }
  } catch (_) { /* live modules absent in some test contexts */ }

  // Setups are reached through the greenlight they were minted from.
  const glIds = new Set(greenlights.map((g) => g.id));
  const setups = [];
  try {
    for (const st of require('./live/setups').listSetups()) {
      if (!glIds.has(st.provenanceRef)) continue;
      setups.push({ id: st.id, name: st.name, state: st.state, channel: st.channel || null });
    }
  } catch (_) { /* live modules absent in some test contexts */ }

  const active = activeStates();
  const blocking = setups.filter((st) => active.includes(st.state));

  // Per-run stores that hang off a run id rather than off the campaign.
  const dirCount = (sub, id) => {
    try { return fs.readdirSync(path.join(__dirname, '..', 'data', sub, id)).length; } catch (_) { return 0; }
  };
  let modelFiles = 0;
  let tuningFiles = 0;
  for (const r of runs) { modelFiles += dirCount('models', r.id); tuningFiles += dirCount('ht', r.id); }

  return {
    name: clean,
    isCurrent: getCampaign() === clean,
    declaredOnly: !runs.length && !greenlights.length,
    runs, greenlights, setups, blocking,
    counts: {
      runs: runs.length,
      greenlights: greenlights.length,
      setups: setups.length,
      modelFiles,
      tuningFiles,
    },
    locked: blocking.length > 0,
  };
}

const rmDir = (p2) => { try { fs.rmSync(p2, { recursive: true, force: true }); } catch (_) { /* leave it */ } };
const rmFile = (p2) => { try { fs.unlinkSync(p2); } catch (_) { /* leave it */ } };

// Do it. Refuses while anything is still deployed; otherwise removes the whole
// chain and reports what actually went, counted as it went rather than
// predicted — a delete that reports the plan instead of the outcome is how you
// find out later that half of it failed silently.
function deleteCampaign(name) {
  const found = campaignContents(name);
  if (found.locked) {
    const err = new Error(`the campaign "${found.name}" is locked: `
      + `${found.blocking.length} setup(s) on the Trade tab are still deployed `
      + `(${found.blocking.map((s2) => `${s2.name || s2.id} — ${s2.state}`).join('; ')}). `
      + 'Retire them there first; nothing has been deleted.');
    err.code = 'CAMPAIGN_LOCKED';
    err.blocking = found.blocking;
    throw err;
  }

  const removed = { runs: 0, greenlights: 0, setups: 0, modelDirs: 0, tuningDirs: 0 };
  const dataDir = path.join(__dirname, '..', 'data');

  // Setups first: they point at the greenlights, so removing them last would
  // leave a window in which a setup names a greenlight that is already gone.
  for (const st of found.setups) {
    try {
      const reg = require('./live/setups');
      rmFile(path.join(reg.setupsDir(), `${st.id}.json`));
      removed.setups += 1;
    } catch (_) { /* counted only when it went */ }
  }
  for (const g of found.greenlights) {
    try {
      rmFile(path.join(require('./live/greenlight').glDir(), `${g.id}.json`));
      removed.greenlights += 1;
    } catch (_) { /* counted only when it went */ }
  }
  for (const r of found.runs) {
    rmDir(path.join(dataDir, 'models', r.id));
    removed.modelDirs += 1;
    rmDir(path.join(dataDir, 'ht', r.id));
    removed.tuningDirs += 1;
    rmFile(path.join(dataDir, 'batches', `${r.id}.json`));
    removed.runs += 1;
  }

  // The name itself, and the current selection if this was it.
  const cur = readFile();
  const declared = declaredNames().filter((n) => n !== found.name);
  const stillSet = cur.name === found.name ? '' : (cur.name || '');
  writeFile({ ...cur, name: stillSet, declared, setAt: new Date().toISOString() });

  return { name: found.name, removed, wasCurrent: found.isCurrent };
}

module.exports = {
  sanitizeCampaign, getCampaign, setCampaign, campaignTree, listCampaignNames,
  declaredNames, campaignContents, deleteCampaign,
};
