// HTTP surface for the Live Trading tab (plan step 1.3). Mounted by server.js
// with ONE line so the module boundary holds (plan 0.1). Every state- or
// config-changing endpoint takes the same CSRF guard as the pilot's arm/disarm
// (QC 115), and every endpoint here gets an over-the-wire test (QC 114).
//
// Deliberately ABSENT: a create endpoint. Setups are minted ONLY by the
// greenlight shuttle (NEXT-RELEASE point 4 — "no hand-built live configs"),
// which arrives with plan phase 4 and enforces greenlight state at creation.
const fs = require('fs');
const path = require('path');
const reg = require('./setups');

function errStatus(e) {
  switch (e.code) {
    case 'NOT_FOUND': return 404;
    case 'BAD_TRANSITION': case 'IMMUTABLE': case 'BAD_SETUP': case 'BAD_CONFIG': case 'NOT_DRAFT':
    case 'NOT_LIVE_EXECUTABLE': case 'BAD_CHANNEL': case 'NOT_ACTIVE': return 400;
    case 'EXISTS': case 'ALREADY_ACTIVE': case 'CHANNEL_ACTIVE': case 'DEACTIVATING': case 'REVOKED': return 409;
    default: return 500;
  }
}

// Summary shape for the pager: enough to render the list without the full
// snapshot payload per row.
function summarize(s) {
  return {
    id: s.id, name: s.name, state: s.state, tradedPair: s.tradedPair,
    clipUsd: s.clipUsd, stopPct: s.stopPct, engineVersion: s.engineVersion,
    keyRef: s.keyRef ? 'set' : null,           // presence only — never the value
    executionTargetRef: s.executionTargetRef,
    createdUtc: s.createdUtc,
  };
}

function installLiveRoutes(app, { csrfGuard }) {
  app.get('/api/live/setups', (req, res) => {
    try { res.json({ setups: reg.listSetups().map(summarize) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // How this profile decides, described from its OWN config. Only one config in
  // the system could ever explain itself on screen, because the describer looked
  // its book up by a hardcoded id. Every profile answers now.
  app.get('/api/live/setups/:id/anatomy', (req, res) => {
    const s = reg.getSetup(req.params.id);
    if (!s) return res.status(404).json({ error: `no such setup ${req.params.id}` });
    try {
      const a = require('./anatomy');
      let freezeMs = null;
      try { freezeMs = require('./trainpolicy').resolveFreeze(s).throughMs; } catch (_) { freezeMs = null; }
      const opts = { clipUsd: s.clipUsd, stopPct: s.stopPct, freezeMs };
      res.json({
        config: a.describeConfig(s.configSnapshot, opts),
        anatomy: a.describeAnatomy(s.configSnapshot, opts),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/live/setups/:id', (req, res) => {
    const s = reg.getSetup(req.params.id);
    if (!s) return res.status(404).json({ error: `no such setup ${req.params.id}` });
    // full record, but keyRef reduced to presence — the value is a reference
    // name, still not for casual display (key hygiene habit).
    res.json({ ...s, keyRef: s.keyRef ? 'set' : null });
  });

  // Per-setup live book + execution fidelity, derived from the synced box
  // journal (plan phase 6). Read-only.
  app.get('/api/live/setups/:id/status', (req, res) => {
    const s = reg.getSetup(req.params.id);
    if (!s) return res.status(404).json({ error: `no such setup ${req.params.id}` });
    try {
      // The margin floor is a BOX-level fact — one isolated wallet backs every
      // real setup — so the setup screens report the same requested-vs-enforced
      // pair the LIVE screen does. Without it, saving a floor would look like
      // nothing happened here while LIVE showed it pending (RULE TWO).
      let requested = null;
      try {
        requested = JSON.parse(fs.readFileSync(
          path.join(__dirname, '..', '..', 'data', 'pilot', 'margin-floor.json'), 'utf8')).floor ?? null;
      } catch (_) { /* no floor saved yet — a state, not an error */ }
      // WHAT HAPPENED TO THE LAST "Clear the halt" PRESS (owner, 2026-08-19:
      // "I've been pressing the button to clear the halt state"). The press
      // wrote a request and then vanished into the control plane: if the box
      // refused it, nothing anywhere said so, and the owner pressed again. Both
      // states are reported now — still waiting to be carried, or considered and
      // refused, with the box's own reason.
      const unhaltDir = path.join(__dirname, '..', '..', 'data', 'live', 'unhalt');
      let unhaltPending = false;
      let unhaltRefused = null;
      try {
        const req = JSON.parse(fs.readFileSync(path.join(unhaltDir, `${s.id}.json`), 'utf8'));
        unhaltPending = !!req.utc;
      } catch (_) { /* none waiting — a state, not an error */ }
      try {
        unhaltRefused = JSON.parse(fs.readFileSync(path.join(unhaltDir, `${s.id}.refused.json`), 'utf8'));
      } catch (_) { /* none refused */ }
      // THE REPRODUCE-CHECK. live-mirror.js re-runs every setup's recorded
      // decisions against fresh data and writes the result here. Nothing read
      // it, so the screen's reproduce-check line said "not run yet" forever and
      // the MIRROR BREAK banner could never appear — a check that runs, finds a
      // break, and cannot tell anyone is worse than no check, because silence
      // reads as "clean" (found by audit, 2026-08-21).
      let mirror = null;
      try {
        const agg = JSON.parse(fs.readFileSync(
          path.join(__dirname, '..', '..', 'data', 'live', 'mirror.json'), 'utf8'));
        mirror = (agg.results || []).find((r) => r.setup_id === s.id) || null;
      } catch (_) { /* never run, or unreadable — the screen says "not run yet" */ }

      res.json({ ...require('./view').setupStatus(s), marginFloorRequested: requested,
        unhaltPending, unhaltRefused, mirror });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/live/setups/:id/state', csrfGuard, (req, res) => {
    try {
      const to = String((req.body || {}).to || '');
      const s = reg.transition(req.params.id, to, 'owner', (req.body || {}).note);
      res.json({ ok: true, setup: summarize(s) });
    } catch (e) { res.status(errStatus(e)).json({ error: e.message }); }
  });

  // CLEAR THIS PROFILE'S HALT. Same shape as the box-level one: the classifier
  // only WRITES A SIGNED REQUEST — it places no orders and never touches the box.
  // The control plane carries it on its next sync and the box verifies the
  // signature before lifting anything. The setup id rides inside the signed
  // payload, so a request minted for one profile cannot lift another's halt.
  app.post('/api/live/setups/:id/unhalt', csrfGuard, (req, res) => {
    const s = reg.getSetup(req.params.id);
    if (!s) return res.status(404).json({ error: `no such setup ${req.params.id}` });
    try {
      const crypto = require('crypto');
      const dir = path.join(__dirname, '..', '..', 'data', 'live', 'unhalt');
      fs.mkdirSync(dir, { recursive: true });
      const nonce = crypto.randomBytes(9).toString('hex');
      const utc = new Date().toISOString();
      const rec = { setup_id: s.id, by: 'owner', utc, nonce };
      const secret = process.env.PILOT_ARM_SECRET || '';
      if (secret) {
        rec.hmac = crypto.createHmac('sha256', secret)
          .update(`unhalt|${s.id}|${nonce}|${utc}`).digest('hex');
      }
      const f = path.join(dir, `${s.id}.json`);
      fs.writeFileSync(`${f}.tmp`, JSON.stringify(rec));
      fs.renameSync(`${f}.tmp`, f);
      // A NEW press supersedes an old refusal. Leaving the marker would show
      // the owner a refusal next to their fresh request and give them no way to
      // tell which one the screen is talking about.
      try { fs.unlinkSync(path.join(dir, `${s.id}.refused.json`)); } catch (_) { /* none */ }
      res.json({ ok: true, request: { setup_id: s.id, utc, nonce, authenticated: !!secret } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/live/setups/:id/config', csrfGuard, (req, res) => {
    try {
      const s = reg.updateSetup(req.params.id, req.body || {}, 'owner');
      res.json({ ok: true, setup: summarize(s) });
    } catch (e) { res.status(errStatus(e)).json({ error: e.message }); }
  });

  app.delete('/api/live/setups/:id', csrfGuard, (req, res) => {
    try { reg.deleteDraft(req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(errStatus(e)).json({ error: e.message }); }
  });

  // ---- data catalog + repair (plan phase 7) -------------------------------
  // The execution targets, so the Setup detail can OFFER them instead of asking
  // for a typed id. The Trading tab told the operator a live setup needs its own
  // sub-account key and which box must serve the pair, and then gave no control
  // for either — a screen that states a requirement it provides no way to meet
  // (found 2026-08-18 while covering the real-channel path).
  app.get('/api/live/targets', (req, res) => {
    try {
      const t = require('./targets').listTargets();
      res.json({
        targets: Object.values(t).map((x) => ({
          id: x.id, kind: x.kind, note: x.note || '', symbols: x.symbols || null,
        })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/live/catalog', (req, res) => {
    try { res.json(require('./catalog').buildCatalog()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/live/catalog/repair', csrfGuard, async (req, res) => {
    try { res.json(await require('./catalog').repair()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- greenlight + shuttle (plan phase 4) --------------------------------
  const gl = require('./greenlight');

  app.get('/api/live/greenlights', (req, res) => {
    try { res.json({ greenlights: gl.listGreenlights() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Greenlight the SELECTED row of a saved bracket-lab run. why is required —
  // the decision record is the point.
  app.post('/api/live/greenlight', csrfGuard, (req, res) => {
    try {
      const b = req.body || {};
      const doc = require('../batch').getBatch(String(b.runId || ''));
      if (!doc) return res.status(404).json({ error: `no saved run ${b.runId}` });
      // name is required: a config the owner cannot recognise on screen is not
      // usable, and the generated id is a key rather than a label.
      const rec = gl.greenlightFromRun(doc, String(b.target || 'declared'),
        { by: 'owner', why: b.why, name: b.name });
      res.json({ ok: true, greenlight: rec });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Rename a config and restate its reasoning. Labels only — nothing here can
  // change what the config trades, and campaign is not offered at all (it is a
  // reference to the line of work, shared by every config that came out of it).
  app.post('/api/live/greenlight/:id/relabel', csrfGuard, (req, res) => {
    try {
      const b = req.body || {};
      const patch = {};
      if (b.name !== undefined) patch.name = b.name;
      if (b.why !== undefined) patch.why = b.why;
      res.json({ ok: true, greenlight: gl.relabel(req.params.id, { ...patch, by: 'owner' }) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // The shuttle button: greenlight -> new DRAFT setup on the Live Trading tab.
  app.post('/api/live/shuttle', csrfGuard, (req, res) => {
    try {
      const b = req.body || {};
      const out = gl.shuttle(String(b.greenlightId || ''), {
        name: b.name, clipUsd: Number(b.clipUsd), stopPct: b.stopPct ?? null, by: 'owner',
      });
      res.json({ ok: true, greenlightId: out.greenlight.id, setup: summarize(out.setup) });
    } catch (e) { res.status(errStatus(e)).json({ error: e.message }); }
  });

  // ---- dual-channel configs (owner 2026-08-14; NEXT-RELEASE point 25) -----
  // The Trading tab's entity: every non-nuked greenlight, with its paper/real
  // channel states and the owner's status-line vocabulary.
  const ch = require('./channels');
  const view = require('./view');

  app.get('/api/live/configs', (req, res) => {
    try {
      const configs = gl.listGreenlights().filter((g) => !g.revoked).map((g) => {
        const chans = ch.channelSetups(g.id);
        const parts = [];
        const channels = {};
        for (const c of ['real', 'paper']) {
          const s = chans[c];
          if (!s) { channels[c] = null; continue; }
          // The status's openPositions is a MERGED array with a per-row paper
          // flag; counting it whole gave the paper channel the real channel's
          // open positions and vice versa, on a setup that legally holds both
          // (audit 2026-08-17). Count this channel's own book.
          let open = 0;
          try {
            open = (view.setupStatus(s).openPositions || [])
              .filter((p) => (c === 'paper' ? !!p.paper : !p.paper)).length;
          } catch (_) { open = 0; }
          parts.push({ channel: c, state: s.state, open });
          channels[c] = { setupId: s.id, state: s.state, open, runEpochUtc: s.runEpochUtc || null,
            // Whether this channel could go REAL: presence only, never the value.
            // The screen used to grey out 'Activate real' for every config except
            // the built-in one, which told the owner nothing about what to DO. It
            // now reflects the gate the registry actually enforces — a real
            // channel needs the profile's own sub-account.
            keyRefSet: !!(s.keyRef && String(s.keyRef).trim()) };
        }
        return {
          id: g.id, name: g.name || null, createdUtc: g.createdUtc, campaign: g.campaign || null,
          pair: g.configSnapshot?.combo?.trade || null, target: g.target,
          why: g.why || '', engineVersion: g.engineVersion || null,
          status: ch.statusLine(parts), channels,
        };
      });
      res.json({ configs });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/live/configs/:id/activate', csrfGuard, (req, res) => {
    try {
      const b = req.body || {};
      const s = ch.activate(String(req.params.id), String(b.channel || ''), {
        clipUsd: b.clipUsd != null ? Number(b.clipUsd) : undefined, name: b.name,
      });
      res.json({ ok: true, setup: summarize(s) });
    } catch (e) { res.status(errStatus(e)).json({ error: e.message }); }
  });

  app.post('/api/live/configs/:id/deactivate', csrfGuard, (req, res) => {
    try {
      const s = ch.deactivate(String(req.params.id), String((req.body || {}).channel || ''));
      res.json({ ok: true, setup: summarize(s) });
    } catch (e) { res.status(errStatus(e)).json({ error: e.message }); }
  });

  // NUKE: back to not-greenlighted. Gone from these lists; saved sweeps untouched.
  app.post('/api/live/configs/:id/nuke', csrfGuard, (req, res) => {
    try { res.json({ ok: true, greenlight: gl.revoke(String(req.params.id)) }); }
    catch (e) { res.status(errStatus(e)).json({ error: e.message }); }
  });
}

module.exports = { installLiveRoutes, summarize };
