// GREENLIGHT + SHUTTLE (plan phase 4; NEXT-RELEASE points 4, 13, 18).
//
// A greenlight is the owner's decision that a configuration is fit to trade,
// recorded with WHO/WHEN/WHY, the exact frozen config, the engine version,
// and the provenance chain (campaign -> record sets -> the survivor). The
// shuttle then mints a Live Trading setup (draft) from the greenlight's
// IMMUTABLE snapshot — "no hand-built live configs": the only door into the
// setups registry is this one.
//
// The one door in is the Stage 4 record set (3.90.0): the set, the verdict
// that stood, one survivor, and the agreement exactly as that survivor
// carries it — never a re-typed cell.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateConfig } = require('./configschema');
const { feeFracOf } = require('../paper');
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

// ---- THE STAGE 4 DOOR (3.90.0, VERIFY-DESIGN.md section 6) --------------------------
//
// A greenlight minted from a Stage 4 record set: the set, the verdict block
// that stood, ONE survivor -- chosen by depth inside the rule or named by the
// owner, both recorded -- and the agreement exactly as that survivor carries
// it, which no integer quorum expresses. `src` is what lib/stages.js hands
// over (stage4GreenlightSource): everything is read off the set and its
// parents, never re-typed. Nothing here trades: the shuttle refuses a
// stage-engine configuration until the live path speaks its agreement.
const EXECUTOR_SHAPE = (cell) => {
  const why = [];
  if (cell.entry !== 'market') why.push(`its entry is ${cell.entry}, and the live executor only does market entry`);
  if (cell.gate !== 'directional') why.push(`its gate is ${cell.gate}, and the live executor only does the directional gate`);
  if (cell.trailMult != null) why.push('it carries a trailing stop, which the live executor does not have');
  if (cell.armMult != null) why.push('it carries an arm, which the live executor does not have');
  return why;
};
// why this source could not be greenlighted, in words, or null
function stage4Refusal(src) {
  if (!src || !src.gate) return 'no verdict on this set is PASS under this release line — read the rule against nothing on Verify first';
  const u = src.unit || {};
  if (u.size !== 3) {
    return `this set's unit is ${u.size === 1 ? 'a coin read on its own' : `a coin read alongside ${u.size - 1} other`}, and the live vocabulary carries only a coin read alongside two others — a single-coin unit cannot be greenlighted until the executor takes one`;
  }
  const sv = src.survivor || {};
  const why = EXECUTOR_SHAPE({ entry: sv.entry, gate: sv.gate, trailMult: sv.trailMult ?? null, armMult: sv.armMult ?? null });
  if (why.length) return `the survivor cannot be traded as it was priced: ${why.join('; ')}`;
  if (!Array.isArray(src.members) || !src.members.length) return 'the stage 2 set names no members for this unit, so nothing could be trained the same way';
  if (!Number.isFinite(sv.bandPct) || sv.bandPct <= 0) return 'the band this survivor was priced at is not on the record, so it cannot be frozen';
  return null;
}
function configFromStage4(src) {
  const why = stage4Refusal(src);
  if (why) throw new Error(why);
  const sv = src.survivor;
  const u = src.unit;
  const cfg = {
    engine: 'stages',
    combo: { trade: u.trade, ctx1: u.ctx1 ?? null, ctx2: u.ctx2 ?? null, size: u.size },
    branch: { geometry: u.geometry, decision: sv.decision, band: Number(sv.bandPct), weekdaysOnly: !!sv.weekdaysOnly },
    stage: 'stages',
    members: src.members.map((m) => ({ model: m.model, view: m.view })),
    cell: {
      quorum: null, entry: sv.entry, gate: sv.gate,
      dMult: sv.dMult ?? null, tHours: sv.tHours,
      trailMult: sv.trailMult ?? null, armMult: sv.armMult ?? null,
    },
    // THE AGREEMENT AS THE SURVIVOR CARRIES IT, in the agreement library's own words
    agreement: {
      rule: sv.agreeRule, bar: sv.agreeBar, pct: sv.agreePct ?? null, copy: sv.agreeCopy,
      both: !!sv.agreeBoth, persist: Number.isInteger(sv.agreePersist) ? sv.agreePersist : 0,
      rung: sv.avgRung ?? null, members: sv.members ?? src.members.length, voices: sv.avgVoices ?? null,
    },
    // how the members were trained, so the live path can train the same way
    training: { ...(src.training || {}) },
    configVersion: `${src.set.id}/${src.gate.id}/${src.pick.by}@${new Date().toISOString().slice(0, 10)}`,
  };
  const v = validateConfig(cfg);
  if (!v.ok) throw new Error(`constructed config failed the shared vocabulary: ${v.errors.join('; ')}`);
  return cfg;
}
function greenlightFromStage4(src, { by = 'owner', why, name } = {}) {
  if (!src || !src.set || src.set.stage !== 4) throw new Error('a Stage 4 greenlight comes from a Stage 4 record set');
  if (typeof why !== 'string' || !why.trim()) throw new Error('a greenlight needs a WHY — record the reasoning that cleared it');
  const cfg = configFromStage4(src);
  fs.mkdirSync(glDir(), { recursive: true });
  const id = `gl-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const rd = src.readings || {};
  const record = {
    id,
    createdUtc: new Date().toISOString(),
    seq: __mintSeq++,
    by,
    name: validName(name),
    why: why.trim(),
    engineVersion: ENGINE_VERSION,
    target: 'stage4',
    campaign: src.set.campaign || null,
    // the chain: the set, the block that stood, the stage 3 set and its stage 2 parent
    sourceSet: {
      id: src.set.id, name: src.set.name, release: src.set.release || null,
      unit: src.set.unit, unitName: src.set.unitName || null, ruleSentence: src.set.ruleSentence || null,
      survivors: src.pick.of, block: src.gate,
      parent: src.set.parent || null, stage2: src.set.stage2 || null,
    },
    // kept under the name every reader of a greenlight already looks for
    sourceRun: { id: (src.set.parent || {}).id || null, kind: 'stage3', startedAt: null, finishedAt: null, dataManifest: null, feePerLeg: Number.isFinite(src.fee) ? src.fee : null },
    // WHICH SURVIVOR, AND HOW IT WAS CHOSEN: by depth, or named -- both recorded
    pick: { by: src.pick.by, label: src.pick.label, si: src.pick.si ?? null, worst: src.pick.worst, mean: src.pick.mean, per: src.pick.per || null, of: src.pick.of },
    rowSummary: {
      pnl: src.survivor.avgTest ?? null, trades: null,
      holdout: rd.heldBack ? { pnl: rd.heldBack.money ?? null, trades: rd.heldBack.trades ?? null } : null,
      unread: rd.unread ? { pnl: rd.unread.money ?? null, trades: rd.unread.trades ?? null, look: rd.unread.look ?? null } : null,
    },
    configSnapshot: cfg,
    shuttledSetupIds: [],
  };
  atomicWrite(fileFor(id), record);
  return record;
}

// The owner's LABELS, editable for the life of the config. Deliberately narrow:
// `name` and `why` describe the config and changing them changes nothing about
// what it trades. `campaign` is NOT here and never will be — it is a reference to
// the line of work the sweeps are collected under, shared by every config that
// came out of it, so editing it from one config's screen would either move that
// config to a different campaign or rename the campaign for everything under it.
// Neither is a rename. Everything else on a greenlight is evidence and is frozen.
function validName(name) {
  // A NAME IS TEXT THE OWNER TYPED. This coerced whatever it was given, so an
  // object became the name "[object Object]" and a number became "7" — neither
  // of which anyone typed, and both of which then appeared on screen as though
  // they had (found 2026-08-21).
  if (typeof name !== 'string') {
    throw new Error(`a config's name must be text — got ${JSON.stringify(name)}. `
      + 'It used to be converted, so a name nobody typed could end up on screen.');
  }
  const n = name.trim();
  if (!n) throw new Error('a config needs a NAME — something you will recognise on screen');
  if (n.length > 60) throw new Error('name: 60 characters or fewer');
  return n;
}

function relabel(id, { name, why, by = 'owner' } = {}) {
  const g = getGreenlight(id);
  if (!g) throw new Error(`no greenlight ${id}`);
  const next = { ...g };
  if (name !== undefined) next.name = validName(name);
  if (why !== undefined) {
    const w = String(why == null ? '' : why).trim();
    if (!w) throw new Error('why cannot be blanked — it is the reasoning that cleared this config');
    next.why = w;
  }
  if (name === undefined && why === undefined) return g;
  next.relabelHistory = [...(g.relabelHistory || []),
    { utc: new Date().toISOString(), by,
      ...(name !== undefined ? { name: g.name ?? null } : {}),
      ...(why !== undefined ? { why: g.why } : {}) }];
  atomicWrite(fileFor(id), next);

  // THE NAME REACHES EVERY DEPLOYMENT OF THIS CONFIG (owner, 2026-08-19: "is
  // there a reason the name i give to a config under greenlights is still not
  // propagating to setups and setup detail and live?").
  //
  // A setup takes a COPY of the name when it is shuttled from the greenlight,
  // and nothing updated that copy. So a rename landed on the one screen where
  // the name matters least and left the screens showing what is actually
  // trading on the old one — three screens, three names for one thing. Renaming
  // is not renaming if the thing holding the money keeps the old label.
  //
  // Only the NAME propagates. `why` is the reasoning that cleared the config
  // and belongs to the greenlight; a deployment does not carry it. `campaign`
  // is a foreign key and is not relabelable at all.
  if (name !== undefined) {
    const renamed = [];
    try {
      const reg = require('./setups');
      for (const st of reg.listSetups()) {
        if (st.provenanceRef !== id) continue;
        if (st.name === next.name) continue;
        // updateSetup validates and journals; name is in its MUTABLE set.
        reg.updateSetup(st.id, { name: next.name }, by);
        renamed.push(st.id);
      }
    } catch (e) {
      // A propagation failure must be VISIBLE, not swallowed into a rename that
      // reports success while two screens still show the old name.
      const err = new Error(`the config was renamed but its deployment(s) were not: ${e.message}`);
      err.status = 500;
      throw err;
    }
    next.renamedSetups = renamed;
  }
  return next;
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
function shuttle(greenlightId, { name, clipUsd, stopPct = null, feePerLeg, by = 'owner', channel = null, trainPolicy = null } = {}) {
  const gl = getGreenlight(greenlightId);
  if (!gl) { const e = new Error(`no such greenlight ${greenlightId}`); e.code = 'NOT_FOUND'; throw e; }
  if (gl.revoked) { const e = new Error('this config was nuked back to not-greenlighted'); e.code = 'REVOKED'; throw e; }
  // A stage-engine configuration shuttles like any other since 3.91.0: the
  // live path speaks its agreement. The draft it makes trades nothing until
  // the owner's Activate press on the Trade tab (RULE SIX: never inside a loop).
  const setup = reg.createSetup({
    name: name || `${gl.configSnapshot.combo.trade} ${gl.target} (${gl.sourceRun.id})`,
    ownerId: by,
    configSnapshot: gl.configSnapshot,
    provenanceRef: gl.id,
    channel,
    clipUsd,
    trainPolicy,
    stopPct,
    // The fee the board was found under, unless the owner names another. A
    // profile that trades at a different cost than its evidence was scored at
    // is not trading the thing that was greenlighted, so this defaults rather
    // than being left for somebody to remember.
    feePerLeg: Number.isFinite(feePerLeg) ? feePerLeg : ((gl.sourceRun || {}).feePerLeg ?? null),
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
  relabel, validName,
  getGreenlight, listGreenlights, shuttle, revoke, glDir,
  greenlightFromStage4, configFromStage4, stage4Refusal,
};
