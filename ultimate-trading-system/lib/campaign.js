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

function getCampaign() {
  try {
    const v = JSON.parse(fs.readFileSync(FILE, 'utf8')).name;
    return typeof v === 'string' && v ? v : '';
  } catch {
    return '';
  }
}

function setCampaign(raw) {
  const name = sanitizeCampaign(raw);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify({ name, setAt: new Date().toISOString() }));
  fs.renameSync(tmp, FILE);
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
  return [...seen.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([n]) => n);
}

module.exports = { sanitizeCampaign, getCampaign, setCampaign, campaignTree, listCampaignNames };
