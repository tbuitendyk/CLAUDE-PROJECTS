// HTTP surface for the Live Trading tab (plan step 1.3). Mounted by server.js
// with ONE line so the module boundary holds (plan 0.1). Every state- or
// config-changing endpoint takes the same CSRF guard as the pilot's arm/disarm
// (QC 115), and every endpoint here gets an over-the-wire test (QC 114).
//
// Deliberately ABSENT: a create endpoint. Setups are minted ONLY by the
// greenlight shuttle (NEXT-RELEASE point 4 — "no hand-built live configs"),
// which arrives with plan phase 4 and enforces greenlight state at creation.
const reg = require('./setups');

function errStatus(e) {
  switch (e.code) {
    case 'NOT_FOUND': return 404;
    case 'BAD_TRANSITION': case 'IMMUTABLE': case 'BAD_SETUP': case 'BAD_CONFIG': case 'NOT_DRAFT': return 400;
    case 'EXISTS': return 409;
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
    try { res.json(require('./view').setupStatus(s)); }
    catch (e) { res.status(500).json({ error: e.message }); }
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
}

module.exports = { installLiveRoutes, summarize };
