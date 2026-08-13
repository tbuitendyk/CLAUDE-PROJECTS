// GREENLIGHT + SHUTTLE (plan phase 4; NEXT-RELEASE points 4, 13, 18).
//
// A greenlight is the owner's decision that a lab-selected configuration is
// fit to trade, recorded with WHO/WHEN/WHY, the exact frozen config, the
// engine version, and the provenance chain (campaign -> runs -> selected
// row). The shuttle then mints a Live Trading setup (draft) from the
// greenlight's IMMUTABLE snapshot — "no hand-built live configs": the only
// door into the setups registry is this one.
//
// The config is constructed from the SAME row anchor the lab's own confirm
// step uses (doc.selection, target 'declared'|'best'), so what gets
// greenlighted is exactly what the lab measured — never a re-typed cell.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { specsFor } = require('../bracketwork');
const { validateConfig } = require('./configschema');
const { ENGINE_VERSION } = require('./version');
const reg = require('./setups');

const DEFAULT_GL_DIR = path.join(__dirname, '..', '..', 'data', 'live', 'greenlights');
function glDir() { return process.env.GC_GREENLIGHTS_DIR || DEFAULT_GL_DIR; }
function fileFor(id) { return path.join(glDir(), `${id}.json`); }
function atomicWrite(file, obj) {
  const tmp = `${file}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, file);
}

// createdUtc is millisecond-resolution, so two greenlights minted inside the
// same millisecond (tests, or two rapid programmatic mints) tie on it and the
// list order would fall through to filesystem readdir order — i.e. undefined.
// This per-process monotonic counter breaks that tie by true creation order so
// "newest first" is deterministic. Cross-process the millisecond timestamp
// dominates (real greenlights are minted seconds apart), and the counter only
// disambiguates same-ms same-process mints, where it is exactly right.
let __mintSeq = 0;

// stage from what the row actually ran: committee width is a function of
// (size, stage), so it inverts cleanly — and ambiguity refuses rather than
// guesses (a guessed stage would train a different committee than the lab's).
function stageFromMembers(size, memberCount) {
  const slim = specsFor(size, 'slim').length;
  const promoted = specsFor(size, 'promoted').length;
  if (memberCount === slim) return 'slim';
  if (memberCount === promoted) return 'promoted';
  throw new Error(`cannot derive stage: ${memberCount} members fits neither slim(${slim}) nor promoted(${promoted}) for size ${size}`);
}

// Build the frozen configSnapshot from a saved lab doc + its selected row.
// Every refusal here is a provenance gap the greenlight must not paper over.
function configFromSelection(doc, target) {
  const row = doc.selection;
  if (!row) throw new Error('this run has no selected row — select a leader in the lab first');
  let sel = row;
  if (target === 'declared') {
    if (!row.declaredCell) throw new Error('this row carries no declared cell — was the run started with a declared config?');
    sel = { ...row, ...row.declaredCell };
  } else if (target !== 'best') {
    throw new Error("greenlight target must be 'best' or 'declared'");
  }

  // The band must be the RESOLVED number the run traded at, never 'auto' — an
  // adaptive band re-derived later would relabel the world the members were
  // trained against (forwardbook: theBandIsFrozenNotAuto).
  const bandPct = Number.isFinite(sel.bandPct) ? sel.bandPct
    : (Number.isFinite(row.bandPct) ? row.bandPct : null);
  if (!Number.isFinite(bandPct) || bandPct <= 0) {
    throw new Error('cannot freeze the band: the selected row carries no resolved bandPct number');
  }

  const size = sel.size;
  const members = sel.members ?? row.members;
  if (!Number.isInteger(members)) throw new Error('selected row carries no committee size (members)');
  const stage = stageFromMembers(size, members);

  // trainThrough = the last instant the SELECTING run could see (forwardbook
  // rule): the run read the cache as of its own fire time, and the cache only
  // ever holds closed candles, so the fire time IS the data horizon.
  const fired = Date.parse(doc.startedAt || doc.finishedAt || '');
  if (!Number.isFinite(fired)) throw new Error('run carries no startedAt — cannot place the training freeze');

  const cfg = {
    combo: { trade: sel.trade, ctx1: sel.ctx1 ?? null, ctx2: sel.ctx2 ?? null, size },
    branch: {
      geometry: sel.geometry, decision: sel.decision,
      band: bandPct, weekdaysOnly: !!sel.weekdaysOnly,
    },
    stage,
    members: specsFor(size, stage).map((s) => ({ model: s.model, view: s.view })),
    cell: {
      quorum: sel.quorum, entry: sel.entry || 'breakout', gate: sel.gate,
      dMult: sel.dMult ?? null, tHours: sel.tHours,
      trailMult: sel.trailMult ?? null, armMult: sel.armMult ?? null,
    },
    trainThrough: fired,
    configVersion: `${doc.id}/${target}@${new Date().toISOString().slice(0, 10)}`,
  };
  const v = validateConfig(cfg);
  if (!v.ok) throw new Error(`constructed config failed the shared vocabulary: ${v.errors.join('; ')}`);
  return { cfg, sel };
}

// Record a greenlight. `doc` is the saved lab doc (injected by the route via
// batch.getBatch; injectable directly in tests). why is REQUIRED — a
// greenlight without a reason is not a decision, it is a click.
function greenlightFromRun(doc, target, { by = 'owner', why } = {}) {
  if (!doc || doc.kind !== 'bracketlab') throw new Error('greenlights come from saved bracket-lab runs');
  if (typeof why !== 'string' || !why.trim()) throw new Error('a greenlight needs a WHY — record the reasoning that cleared it');
  const { cfg, sel } = configFromSelection(doc, target);
  fs.mkdirSync(glDir(), { recursive: true });
  const id = `gl-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const record = {
    id,
    createdUtc: new Date().toISOString(),
    seq: __mintSeq++,                       // creation-order tiebreak for same-ms mints
    by,
    why: why.trim(),
    engineVersion: ENGINE_VERSION,          // point 18: the arithmetic this evidence is about
    target,
    campaign: doc.campaign || (doc.params && doc.params.campaign) || null,   // point 13: the parent job
    sourceRun: {
      id: doc.id, kind: doc.kind,
      startedAt: doc.startedAt || null, finishedAt: doc.finishedAt || null,
      dataManifest: doc.dataManifest || null,   // QC 77: exactly which candles the evidence read
    },
    rowSummary: {
      pnl: sel.pnl ?? null, trades: sel.trades ?? null,
      holdout: sel.holdout ? { pnl: sel.holdout.pnl ?? null, trades: sel.holdout.trades ?? null } : null,
    },
    configSnapshot: cfg,
    shuttledSetupIds: [],
  };
  atomicWrite(fileFor(id), record);
  return record;
}

function getGreenlight(id) {
  if (!/^gl-[a-z0-9-]+$/.test(String(id || ''))) return null;
  try { return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')); } catch (_) { return null; }
}

function listGreenlights() {
  try {
    return fs.readdirSync(glDir())
      .filter((f) => f.endsWith('.json'))
      .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(glDir(), f), 'utf8')); } catch (_) { return null; } })
      .filter(Boolean)
      .sort((a, b) => {
        const t = String(b.createdUtc).localeCompare(String(a.createdUtc));
        if (t !== 0) return t;
        return (b.seq || 0) - (a.seq || 0);   // same-ms tie -> true creation order
      });
  } catch (_) { return []; }
}

// THE SHUTTLE (point 4): greenlight -> new draft setup, snapshot + provenance
// riding along. The greenlight record keeps the reverse link.
function shuttle(greenlightId, { name, clipUsd, stopPct = null, by = 'owner', channel = null } = {}) {
  const gl = getGreenlight(greenlightId);
  if (!gl) { const e = new Error(`no such greenlight ${greenlightId}`); e.code = 'NOT_FOUND'; throw e; }
  if (gl.revoked) { const e = new Error('this config was nuked back to not-greenlighted'); e.code = 'REVOKED'; throw e; }
  const setup = reg.createSetup({
    name: name || `${gl.configSnapshot.combo.trade} ${gl.target} (${gl.sourceRun.id})`,
    ownerId: by,
    configSnapshot: gl.configSnapshot,
    provenanceRef: gl.id,
    channel,
    clipUsd,
    stopPct,
    by,
  });
  const next = { ...gl, shuttledSetupIds: [...(gl.shuttledSetupIds || []), setup.id] };
  atomicWrite(fileFor(gl.id), next);
  return { greenlight: next, setup };
}

// NUKE (owner, 2026-08-14): return a config to not-greenlighted. It vanishes
// from the Trading lists; the saved sweeps it came from are untouched. Refused
// while any channel is still active or winding down — a config with running
// money (or a paper book mid-flight) must be deactivated and closed out first.
function revoke(greenlightId, { by = 'owner' } = {}) {
  const gl = getGreenlight(greenlightId);
  if (!gl) { const e = new Error(`no such greenlight ${greenlightId}`); e.code = 'NOT_FOUND'; throw e; }
  const busy = reg.listSetups().filter((s) => s.provenanceRef === greenlightId
    && (s.state === 'paper' || s.state === 'live' || s.state === 'stopped'));
  const active = busy.filter((s) => s.state !== 'stopped');
  if (active.length) {
    const e = new Error(`deactivate first: ${active.map((s) => `${s.channel || s.id} is ${s.state}`).join(', ')}`);
    e.code = 'CHANNEL_ACTIVE';
    throw e;
  }
  // a STOPPED channel still winding down (open positions exiting on schedule)
  // blocks the nuke too — tracking continues until everything is closed out.
  // A missing/unreadable journal means nothing ever traded: flat.
  for (const s of busy) {
    let open = 0;
    try { open = (require('./view').setupStatus(s).openPositions || []).length; } catch (_) { open = 0; }
    if (open > 0) {
      const e = new Error(`${s.channel || s.id} is still deactivating (${open} open position${open > 1 ? 's' : ''}) — wait for close-out`);
      e.code = 'CHANNEL_ACTIVE';
      throw e;
    }
  }
  // stopped-and-flat channels retire with the nuke (their frozen records remain
  // on disk and in the journal; they just leave the working lists)
  for (const s of busy) reg.transition(s.id, 'retired', by, 'config nuked');
  const next = { ...gl, revoked: { utc: new Date().toISOString(), by } };
  atomicWrite(fileFor(gl.id), next);
  return next;
}

module.exports = {
  greenlightFromRun, getGreenlight, listGreenlights, shuttle, revoke,
  configFromSelection, stageFromMembers, glDir,
};
