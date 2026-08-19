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
      res.json({ ...require('./view').setupStatus(s), marginFloorRequested: requested });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/live/setups/:id/state', csrfGuard, (req, res) => {
    try {
      const to = String((req.body || {}).to || '');
      const s = reg.transition(req.params.id, to, 'owner', (req.body || {}).note);
      res.json({ ok: true, setup: summarize(s) });
    } catch (e) { res.status(errStatus(e)).json({ error: e.message }); }
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
      const rec = gl.greenlightFromRun(doc, String(b.target || 'declared'), { by: 'owner', why: b.why });
      res.json({ ok: true, greenlight: rec });
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
          channels[c] = { setupId: s.id, state: s.state, open, runEpochUtc: s.runEpochUtc || null };
        }
        return {
          id: g.id, createdUtc: g.createdUtc, campaign: g.campaign || null,
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
