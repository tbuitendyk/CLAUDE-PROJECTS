// CAMPAIGN NAME (owner order, 2026-08-04): a high-level analysis name the
// owner sets once; every record set launched while it is set carries it, so
// the campaign tree shows at a glance which sets belong to the same cycle of
// tests. Stored on disk so it survives reloads and restarts; cleared by
// setting it empty.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'campaign.json');

// Letters, numbers, spaces, dashes, dots; trimmed; max 60 chars (owner order,
// 2026-08-27, up from 40). Anything else is refused loudly — the name rides
// in ids' company and in every list.
function sanitizeCampaign(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return '';
  if (s.length > 60) throw new Error('campaign name: 60 characters at most');
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
// anything else (owner, 2026-08-21). The catalogue below is COMPUTED from
// record sets and greenlights, which is right for those and wrong for a name
// that has just been set: a brand new campaign owns nothing yet, so it appeared
// nowhere and the owner had to retype it until the first set existed.
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
// stamp — the stage record sets (params.campaign, stamped at every launch)
// and greenlights — never from a second ledger that could drift (the
// lesson of the removed research books: a recomputation cannot disagree
// with itself). Lineage: a set carries the id of the set its launch read
// from, so a 1 → 2 → 3 chain is connected by data, not naming discipline.
// (The older sweep engine's runs rode in this list until it was retired,
// 3.97.0; the list keeps its `runs` key.)
function campaignTree(name) {
  const runs = [];
  const greenlights = [];
  try {
    for (const g of require('./live/greenlight').listGreenlights()) {
      if ((g.campaign || null) !== name) continue;
      greenlights.push({ id: g.id, createdUtc: g.createdUtc, target: g.target,
        sourceRunId: (g.sourceRun && g.sourceRun.id) || null, revoked: !!g.revoked });
    }
  } catch (_) { /* live modules absent in some test contexts */ }
  // Stage record sets carry the stamp (2026-08-27); the parent link is the
  // record set the launch read from, so a 1 → 2 → 3 chain reads as one.
  try {
    for (const s of require('./stages').listSets()) {
      if (((s.params || {}).campaign || null) !== name) continue;
      runs.push({
        id: s.id, kind: `stage ${s.stage}`, status: s.status,
        startedAt: s.createdAt || null, label: s.desc || '',
        parentRunId: (s.parent && s.parent.id) || null,
      });
    }
  } catch (_) { /* stage modules absent in some test contexts */ }
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
    for (const g of require('./live/greenlight').listGreenlights()) note(g.campaign, g.createdUtc);
  } catch (_) { /* none */ }
  // Stage record sets are activity too (2026-08-27) — a campaign holding only
  // record sets must not vanish from the picker, and a stage launch is as
  // recent as any sweep.
  try {
    for (const s of require('./stages').listSets()) note((s.params || {}).campaign, s.createdAt);
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

  // Stage record sets stamped with this campaign (2026-08-27), counted like
  // everything else — the owner is told what they hold BEFORE being asked.
  //
  // AND EVERY SET THAT CAME OUT OF THEM, whether it carries the campaign name
  // or not (owner order, 2026-09-06: "can't delete stuff. fix that").
  //
  // A set another set names as its parent refuses to be deleted, and a set
  // written under no campaign — a Stage 4 set cut from a stage 3 table, say —
  // is not stamped with one. So a campaign whose stage 3 set had children
  // could not be deleted AT ALL: the stage 3 set refused because of them, the
  // stage 2 set refused because of the stage 3 set, the stage 1 set refused
  // because of the stage 2 set, and the screen listed three record sets it
  // was about to remove and then removed none of them. That is what the owner
  // met.
  //
  // The descendants belong to this campaign's work whatever they are stamped
  // with, so they are collected here, LISTED like everything else, and removed
  // deepest first. Nothing is deleted that the owner was not shown.
  const stageSets = [];
  try {
    const all = require('./stages').listSets();
    const own = all.filter((s) => ((s.params || {}).campaign || null) === clean);
    const byParent = new Map();
    for (const s of all) {
      const pid = (s.parent || {}).id || null;
      if (!pid) continue;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(s);
    }
    const seen = new Set();
    // INHERITED IS WHAT THE SET IS, NOT HOW THE WALK REACHED IT. A stage 2 set
    // stamped with this campaign is reached as a child of its stage 1 set, and
    // marking it from the traversal told the owner it "carries no campaign
    // name of its own" -- which is false, and would have read as the delete
    // reaching outside the campaign when it was not.
    const walk = (s) => {
      if (seen.has(s.id)) return;
      seen.add(s.id);
      stageSets.push({
        id: s.id, name: s.name, stage: s.stage, status: s.status,
        inherited: ((s.params || {}).campaign || null) !== clean,
      });
      for (const kid of (byParent.get(s.id) || [])) {
        // A CHILD STAMPED WITH ANOTHER CAMPAIGN IS NOT THIS CAMPAIGN'S TO
        // TAKE. It belongs to somebody else's work, and deleting it here
        // would reach outside what the owner asked for. The walk stops at it
        // — the parent then refuses, is left behind, and the delete NAMES the
        // child that protected it, which is what it has always done.
        //
        // A child carrying NO campaign is the case this walk exists for: a
        // Stage 4 set cut from this chain is stamped with nothing, and it has
        // to go before its parent can.
        const kc = (kid.params || {}).campaign || null;
        if (kc !== null && kc !== clean) continue;
        walk(kid);
      }
    };
    for (const s of own) walk(s);
  } catch (_) { /* stage modules absent in some test contexts */ }

  const active = activeStates();
  const blocking = setups.filter((st) => active.includes(st.state));

  return {
    name: clean,
    isCurrent: getCampaign() === clean,
    declaredOnly: !greenlights.length && !stageSets.length,
    greenlights, setups, blocking, stageSets,
    counts: {
      greenlights: greenlights.length,
      setups: setups.length,
      stageSets: stageSets.length,
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

  // THE OTHER THING THAT STOPS IT (2026-08-27): a stage run being written.
  // Record sets refuse deletion while one is going (a run may be reading its
  // parent at that moment), so the whole campaign delete refuses UP FRONT
  // rather than removing half a chain and then hitting the same wall.
  if (found.stageSets.length) {
    let going = null;
    try { going = require('./stages').stageRunning(); } catch (_) { going = null; }
    if (going) {
      throw new Error(`the campaign "${found.name}" holds ${found.stageSets.length} record set(s) and a stage run `
        + `(${going}) is being written right now — record sets are never deleted while one is going. `
        + 'Wait for it to finish or stop it on the Sweep tab; nothing has been deleted.');
    }
  }

  const removed = { greenlights: 0, setups: 0, stageSets: 0 };

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

  // Stage record sets go DEEPEST FIRST, because a set another set names as its
  // parent refuses deletion (lib/stages.js). Sorting on the stage number does
  // that for a 1 → 2 → 3 chain and used to be the whole rule; it is not enough
  // once the list carries the sets that came OUT of those, which sit at stage
  // 4 and above and have to go before their parents. A refusal that still
  // fires leaves that set behind and SAYS SO — a delete that half-lies about
  // what went is the fault class this file keeps naming.
  const leftBehind = [];
  for (const s of [...found.stageSets].sort((a, b) => b.stage - a.stage)) {
    try {
      require('./stages').deleteSet(s.id, s.id);
      removed.stageSets += 1;
    } catch (err) { leftBehind.push(`${s.name || s.id}: ${err.message}`); }
  }

  // The name itself, and the current selection if this was it.
  const cur = readFile();
  const declared = declaredNames().filter((n) => n !== found.name);
  const stillSet = cur.name === found.name ? '' : (cur.name || '');
  writeFile({ ...cur, name: stillSet, declared, setAt: new Date().toISOString() });

  return { name: found.name, removed, leftBehind, wasCurrent: found.isCurrent };
}

module.exports = {
  sanitizeCampaign, getCampaign, setCampaign, campaignTree, listCampaignNames,
  declaredNames, campaignContents, deleteCampaign,
};
