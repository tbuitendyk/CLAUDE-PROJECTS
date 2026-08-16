// Constructing — the UTS-shape successor to the Bracket lab (NEXT-RELEASE
// point 25). Same back-end APIs, flow-ordered sections, token theme. The old
// Bracket lab page is frozen; this page is where construction happens now.
/* eslint-disable no-alert */
(() => {
const $ = (s, r = document) => r.querySelector(s);
const api = (p) => fetch(p).then((r) => r.json());
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const money = (v) => (v == null || !Number.isFinite(Number(v)) ? '—'
  : `${v < 0 ? '-' : ''}$${Math.abs(Number(v)).toFixed(2)}`);
async function post(p, body) {
  const r = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
const tryPost = async (p, body) => { try { return await post(p, body); } catch (e) { alert('FAILED — nothing changed.\n\n' + e.message); return null; } };

// theme (shared key with the Trading page so the pair always matches)
const root = document.documentElement;
root.setAttribute('data-theme', localStorage.getItem('lt-theme') || 'dark');
$('#themebtn').onclick = () => {
  const n = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', n); localStorage.setItem('lt-theme', n);
};

// ---- navigation ------------------------------------------------------------
const TABS = [['data', 'Data'], ['sweep', 'Sweep'], ['boards', 'Boards'], ['verify', 'Verify'],
  ['history', 'History'], ['tune', 'Tune'], ['greenlight', 'Greenlight']];
let tab = localStorage.getItem('cx-tab') || 'sweep';
// the working selection: a saved run + its selected row ride across sections
let pickedRun = localStorage.getItem('cx-run') || null;
let pickedDoc = null; // cached doc for pickedRun

function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<div class="tab ${k === tab ? 'on' : ''}" data-k="${k}">${l}</div>`).join('');
  $('#tabs').querySelectorAll('.tab').forEach((t) => { t.onclick = () => { tab = t.dataset.k; localStorage.setItem('cx-tab', tab); draw(); }; });
}

// ---- release strip (persistent; clickable badge -> Verify) ------------------
async function renderStrip() {
  let s = null;
  try { s = await api('api/planted-gate/status'); } catch (_) { s = null; }
  const el = $('#strip');
  if (!s) { el.innerHTML = 'release <span class="muted">—</span>'; return; }
  const st = s.verdict || s.status || 'NOT CHECKED';
  const cls = /pass/i.test(st) ? 'b-pass' : /fail/i.test(st) ? 'b-fail' : 'b-warn';
  el.innerHTML = `release ${esc(s.engineVersion || s.version || '')} · planted check:
    <span class="badge ${cls}" id="stripBadge" title="the instrument's calibration certificate — click for the runner and full verdict (Verify section)">${esc(String(st).toUpperCase())}</span>`;
  const b = $('#stripBadge');
  if (b) b.onclick = () => { tab = 'verify'; localStorage.setItem('cx-tab', tab); draw(); };
}

// ---- Data --------------------------------------------------------------------
async function pollJob(jobId, note) {
  for (;;) {
    const j = await api(`api/jobs/${encodeURIComponent(jobId)}`);
    if (j.status === 'done') return j.result;
    if (j.status === 'error') throw new Error(j.error || 'job failed');
    if (note) note(j.progress || j.message || j.status);
    await new Promise((r) => setTimeout(r, 1500));
  }
}
async function drawData() {
  const d = await api('api/data-state').catch(() => null);
  const rows = (d && d.symbols) || [];
  $('#view').innerHTML = `<div class="panel">
    <h3 style="margin-top:0">Data on server</h3>
    <p class="note">Every sweep, null board and tune reads this cache, never the exchange — a gap here silently
      shrinks every window. Refresh re-fetches from the newest cached month (it may have been partial) through the
      current month. Trim keeps only a range, deleting the rest. Purge deletes the whole asset. Every write refuses
      while a job runs; purge and trim DELETE data — the only way back is downloading again.</p>
    <div class="scrollx" id="dataTbl">${rows.length ? `<table><thead><tr>
      <th>pair</th><th>months</th><th>from</th><th>to</th><th style="text-align:left">manage</th></tr></thead><tbody>
      ${rows.map((r) => (r.symbol === 'PLANTEDUSDT' ? `
        <tr><td>${esc(r.symbol)} <span class="note">fabricated planted-check pair — mirrors real data's span, never downloaded</span></td>
          <td>${r.months ?? '—'}</td><td>${esc(r.from || '—')}</td><td>${esc(r.to || '—')}</td>
          <td style="text-align:left"><button type="button" class="ds-refresh" data-sym="${esc(r.symbol)}">regenerate to span</button>
            <button type="button" class="ds-purge" data-sym="${esc(r.symbol)}">purge…</button></td></tr>` : `
        <tr><td>${esc(r.symbol)}</td><td>${r.months ?? '—'}</td><td>${esc(r.from || '—')}</td><td>${esc(r.to || '—')}</td>
          <td style="text-align:left"><button type="button" class="ds-refresh" data-sym="${esc(r.symbol)}">refresh to latest</button>
            <button type="button" class="ds-trim" data-sym="${esc(r.symbol)}" data-from="${esc(r.from || '')}" data-to="${esc(r.to || '')}">trim…</button>
            <button type="button" class="ds-purge" data-sym="${esc(r.symbol)}">purge…</button></td></tr>`)).join('')}</tbody></table>`
    : `<p class="note">nothing cached yet — download below</p>`}</div>
    <h3>Download / refresh</h3>
    <div class="row" style="align-items:flex-end">
      <label class="f">download new pair(s), comma-sep<input id="dlPairs" placeholder="LTCUSDT,XRPUSDT" style="width:16rem"></label>
      <label class="f">from<input id="dlStart" type="month"></label>
      <label class="f">to<input id="dlEnd" type="month"></label>
      <button id="dlBtn" class="pri">Download</button>
      <button id="dlRefreshAll" title="Every cached pair: fetch from its newest cached month through the current month">Global Refresh</button>
    </div>
    <div id="dlOut" class="note"></div></div>`;
  const dsStatus = (m) => { const e = $('#dlOut'); if (e) e.textContent = m; };
  const dsCall = async (url, body, confirmMsg) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    try {
      const out = await post(url, body);
      if (out.jobId) {
        dsStatus('working…');
        const result = await pollJob(out.jobId, dsStatus);
        dsStatus(result && typeof result === 'object'
          ? 'done — ' + Object.entries(result).map(([sym, r]) => `${sym}: ${r.regenerated ? 'regenerated' : `${r.candles || 0} candles`}`).join(' · ')
          : 'done');
      } else {
        dsStatus(out.purged != null ? `${out.purged} cached file(s) deleted` : 'done');
      }
      drawData();
    } catch (e) { dsStatus(`failed: ${e.message}`); }
  };
  $('#view').querySelectorAll('.ds-refresh').forEach((b) => { b.onclick = () => dsCall('api/data/refresh', { symbol: b.dataset.sym }); });
  $('#view').querySelectorAll('.ds-purge').forEach((b) => {
    b.onclick = () => dsCall('api/data/purge', { symbol: b.dataset.sym },
      `DELETE every cached month of ${b.dataset.sym}? The only way back is downloading again.`);
  });
  $('#view').querySelectorAll('.ds-trim').forEach((b) => {
    b.onclick = () => {
      const keepFrom = prompt(`${b.dataset.sym}: keep FROM month (YYYY-MM). Cached: ${b.dataset.from} to ${b.dataset.to}. Months BEFORE this are deleted.`, b.dataset.from);
      if (!keepFrom) return;
      const keepTo = prompt(`${b.dataset.sym}: keep TO month (YYYY-MM). Months AFTER this are deleted.`, b.dataset.to);
      if (!keepTo) return;
      dsCall('api/data/purge', { symbol: b.dataset.sym, keepFrom, keepTo }, `${b.dataset.sym}: DELETE everything outside ${keepFrom}..${keepTo}?`);
    };
  });
  $('#dlBtn').onclick = () => {
    const pairs = $('#dlPairs').value.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    if (!pairs.length) { alert('name at least one pair'); return; }
    if (!$('#dlStart').value || !$('#dlEnd').value) { alert('pick both months'); return; }
    dsCall('api/data/download', { symbols: pairs, startMonth: $('#dlStart').value, endMonth: $('#dlEnd').value });
  };
  $('#dlRefreshAll').onclick = () => dsCall('api/data/refresh', {});
}

// ---- Sweep --------------------------------------------------------------------
async function drawSweep() {
  const [camp, names, batches] = await Promise.all([
    api('api/campaign').catch(() => ({ name: '' })),
    api('api/campaigns').catch(() => ({ names: [] })),
    api('api/batches').catch(() => ({ batches: [] })),
  ]);
  const running = (batches.batches || batches || []).find((b) => b.status === 'running');
  $('#view').innerHTML = `<div class="panel">
    <h3 style="margin-top:0">Campaign — the parent job (pt 13)</h3>
    <p class="note">Every run launched while a campaign is set attaches to it: sweeps, null rounds, tuning passes,
      scans. The campaign's whole chain travels with any greenlight minted from it.</p>
    <div class="row" style="align-items:flex-end">
      <label class="f">campaign name<input id="cxCamp" value="${esc(camp.name || '')}" list="campNames" style="width:18rem"></label>
      <datalist id="campNames">${(names.names || []).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <button id="campSet">Set</button>
      <button id="campTree">View tree</button>
    </div>
    <div id="campOut"></div></div>
  <div class="panel">
    <h3 style="margin-top:0">Board sweep — wide to FIND (never a result)</h3>
    <div class="row" style="align-items:flex-end">
      <label class="f">universe (blank = all cached)<input id="swUni" placeholder="LTCUSDT,XRPUSDT,BCHUSDT" style="width:20rem"></label>
      <label class="c"><input type="checkbox" id="swSingles" checked> singles</label>
      <label class="c"><input type="checkbox" id="swDoubles" checked> doubles</label>
      <label class="c"><input type="checkbox" id="swTriples"> triples</label>
      <label class="c"><input type="checkbox" id="swAll" checked> all loaded data</label>
      <label class="f">start<input id="swStart" type="month"></label>
      <label class="f">end<input id="swEnd" type="month"></label>
    </div>
    <div class="row" style="margin-top:.5rem;align-items:flex-end">
      <label class="f">chunk shape<select id="swGeom"><option>daily-4d</option><option>daily-3d</option><option>daily-2d</option><option>daily-1d</option></select></label>
      <label class="c"><input type="checkbox" id="swPermGeom" checked> permute</label>
      <label class="f">decision<select id="swDec"><option>argmax</option><option>directional</option></select></label>
      <label class="c"><input type="checkbox" id="swPermDec" checked> permute</label>
      <label class="f">band % (or auto)<input id="swBand" value="auto" style="width:5rem"></label>
      <label class="c"><input type="checkbox" id="swPermBand" checked> permute</label>
      <label class="c"><input type="checkbox" id="swWeekdays"> 24/5</label>
      <label class="c"><input type="checkbox" id="swPermWk"> permute</label>
    </div>
    <div class="row" style="margin-top:.5rem;align-items:flex-end">
      <label class="f">window layout<select id="swLayout"><option value="70/15/15">70/15/15</option><option value="61/13/13/13">61/13/13/13 (sealed exam)</option><option value="legacy">legacy 80/20 (never evidence)</option></select></label>
      <label class="f">promote top K<input id="swK" type="number" value="25" style="width:4.5rem"></label>
      <label class="f">null boards<input id="swNulls" type="number" value="0" style="width:4.5rem" title="companion boards with votes dealt onto random days; N boards = at best a 1-in-(N+1) claim; each costs a full sweep"></label>
      <label class="f">min trades<input id="swMinTr" type="number" value="10" style="width:4.5rem"></label>
      <label class="c"><input type="checkbox" id="swTrail"> trailing plane</label>
    </div>
    <div class="row" style="margin-top:.5rem">
      <label class="f" style="flex:1">description — why this run exists (rides in the job heading forever)
        <input id="swDesc" style="width:100%"></label>
    </div>
    <div class="row" style="margin-top:.6rem">
      <button id="swStart2" class="pri">Start sweep</button>
      <button id="swStop" class="danger" title="aborts the running batch job. Heavy SCANS (stop/conviction) are minutes-scale and run to completion — the Tune section shows which is running.">Stop jobs</button>
      <span id="swMsg" class="note"></span>
    </div></div>
  <div class="panel" id="swProg">${running ? '' : '<span class="muted">No job running.</span>'}</div>`;
  $('#campSet').onclick = async () => { const out = await tryPost('api/campaign', { name: $('#cxCamp').value }); if (out) drawSweep(); };
  $('#campTree').onclick = async () => {
    const name = $('#cxCamp').value.trim(); if (!name) { alert('name a campaign'); return; }
    const t = await api(`api/campaign-tree?name=${encodeURIComponent(name)}`).catch(() => null);
    $('#campOut').innerHTML = t ? `<h3>Campaign “${esc(t.name)}” — runs &amp; greenlights</h3>
      <table><thead><tr><th>run</th><th>kind</th><th>status</th><th>started</th><th style="text-align:left">derives from</th></tr></thead><tbody>
      ${(t.runs || []).map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.kind)}</td><td>${esc(r.status)}</td>
        <td>${esc((r.startedAt || '').slice(0, 16))}</td><td style="text-align:left" class="muted">${esc(r.parentRunId || '—')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">no runs yet</td></tr>'}
      </tbody></table>
      ${(t.greenlights || []).length ? `<p class="note">greenlights: ${t.greenlights.map((g) => `${esc(g.id)}${g.revoked ? ' (nuked)' : ''}`).join(' · ')}</p>` : ''}` : '<p class="note">tree unavailable</p>';
  };
  $('#swStart2').onclick = async () => {
    const uni = $('#swUni').value.trim();
    const bandRaw = $('#swBand').value.trim().toLowerCase();
    const body = {
      universe: uni ? uni.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) : undefined,
      sizes: { singles: $('#swSingles').checked, doubles: $('#swDoubles').checked, triples: $('#swTriples').checked },
      startMonth: $('#swStart').value, endMonth: $('#swEnd').value, allLoaded: $('#swAll').checked,
      permute: { geometry: $('#swPermGeom').checked, decision: $('#swPermDec').checked,
        band: $('#swPermBand').checked, weekdays: $('#swPermWk').checked },
      set: { geometry: $('#swGeom').value, decision: $('#swDec').value,
        band: bandRaw === 'auto' || bandRaw === '' ? 'auto' : Number(bandRaw), weekdaysOnly: $('#swWeekdays').checked },
      promoteK: Number($('#swK').value) || 25, minTrades: Number($('#swMinTr').value) || 10,
      trailing: $('#swTrail').checked, windowLayout: $('#swLayout').value,
      labelShiftReps: Number($('#swNulls').value) || 0, description: $('#swDesc').value.trim(),
    };
    $('#swMsg').textContent = 'launching…';
    const out = await tryPost('api/bracketlab', body);
    $('#swMsg').textContent = out ? `launched ${out.id || ''} — progress below` : '';
    pollProgress();
  };
  $('#swStop').onclick = async () => {
    if (!confirm('Stop the running batch job?')) return;
    const out = await tryPost('api/abort', {}); if (out) $('#swMsg').textContent = 'abort requested';
  };
  if (running) pollProgress();
  async function pollProgress() {
    const bl = await api('api/batches').catch(() => null);
    const run = ((bl && (bl.batches || bl)) || []).find((b) => b.status === 'running');
    const el = $('#swProg'); if (!el) return;
    if (!run) { el.innerHTML = '<span class="muted">No job running.</span>'; return; }
    const doc = await api(`api/batch/${encodeURIComponent(run.id)}`).catch(() => null);
    const perf = (doc && doc.perf) || {};
    el.innerHTML = `<h3 style="margin-top:0">Running: ${esc(run.id)}</h3>
      <div class="grid">
        <div class="tile"><div class="k">Phase</div><div class="v">${esc(perf.phase || '—')}</div></div>
        <div class="tile"><div class="k">Units</div><div class="v">${perf.unitsDone ?? 0} / ${perf.unitsTotal ?? '—'}</div></div>
        <div class="tile"><div class="k">Trainings</div><div class="v">${perf.runsDone ?? 0} / ${perf.runsTotal ?? '—'}</div></div>
        <div class="tile"><div class="k">Rate</div><div class="v">${perf.ratePerMin ? perf.ratePerMin.toFixed(1) + '/min' : '—'}</div></div>
        <div class="tile"><div class="k">ETA</div><div class="v">${perf.etaMs ? Math.round(perf.etaMs / 60000) + ' min' : '—'}</div></div>
      </div>`;
    if (tab === 'sweep') setTimeout(pollProgress, 5000);
  }
}

// ---- Boards -------------------------------------------------------------------
async function loadPicked() {
  if (!pickedRun) return null;
  if (pickedDoc && pickedDoc.id === pickedRun) return pickedDoc;
  pickedDoc = await api(`api/batch/${encodeURIComponent(pickedRun)}`).catch(() => null);
  return pickedDoc;
}
const selKey = 'cx-selrow';
function getSelRow(doc) {
  // the run's OWN stored selection (set via Select on a row) is authoritative;
  // the local pick is display state until the server confirms
  return doc && doc.selection ? doc.selection : null;
}
async function drawBoards() {
  const bl = await api('api/batches').catch(() => ({ }));
  const list = (bl.batches || bl || []).filter((b) => b.kind === 'bracketlab' || b.kind === 'screen' || b.kind === 'walkforward' || b.kind === 'historytuning' || b.kind === 'httwo');
  const doc = await loadPicked();
  const leaders = doc ? (doc.leaders || []).filter((l) => l.nullDealSeed == null) : [];
  const sel = getSelRow(doc);
  $('#view').innerHTML = `<div class="panel"><div class="row" style="align-items:flex-end">
      <label class="f">saved runs<select id="bPick" style="min-width:22rem">
        <option value="">— pick a run —</option>
        ${list.map((b) => `<option value="${esc(b.id)}" ${b.id === pickedRun ? 'selected' : ''}>${esc(b.id)} (${esc(b.status)})</option>`).join('')}
      </select></label>
      <button id="bOpen">Open</button>
      ${doc ? `<span class="note">campaign: ${esc((doc.params && doc.params.campaign) || '—')} · ${esc(doc.status)} · ${(doc.params && doc.params.windowLayout) || ''}</span>` : ''}
    </div></div>
    <div id="bBody">${!doc ? '<div class="panel empty">Open a run to see its board.</div>' : `
      ${doc.params && doc.params.description ? `<div class="panel note">${esc(doc.params.description)}</div>` : ''}
      <div class="panel"><h3 style="margin-top:0">Survivor board — the promoted rows (test window; held-back judges)</h3>
      <p class="note">KEY — setup: traded + context coins; shape: chunk geometry · decision · band; cell: agreement/entry/hold;
        trades: entries in the test window; test $: profit-and-loss in dollars on the window the settings were CHOSEN on
        (flattering by construction); held-back $: the once-only look that matters; vs nulls: how many of the row's dealt-vote
        null copies its held-back money beat. Click a row to SELECT it — the selection drives Verify's Tool 1, Tune's scans
        and the Greenlight.</p>
      <div class="scrollx"><table><thead><tr><th>setup</th><th>shape</th><th>cell</th><th>trades</th>
        <th>test $</th><th>held-back $</th><th>vs nulls</th><th></th></tr></thead><tbody>
      ${leaders.length ? leaders.map((l, i) => {
    const isSel = sel && sel.trade === l.trade && sel.geometry === l.geometry && sel.decision === l.decision
      && sel.quorum === l.quorum && sel.tHours === l.tHours && (sel.ctx1 || '') === (l.ctx1 || '');
    return `<tr class="clickable ${isSel ? 'selected' : ''}" data-i="${i}">
      <td>${esc(l.trade)}${l.ctx1 ? ` <span class="muted">+ ${esc(l.ctx1)}${l.ctx2 ? ' + ' + esc(l.ctx2) : ''}</span>` : ''}</td>
      <td>${esc(l.geometry)} · ${esc(l.decision)} · ±${l.bandPct ?? l.band ?? '—'}%</td>
      <td>q${l.quorum} · ${l.entry === 'market' ? 'directional/market' : `${esc(l.gate)}/breakout d${l.dMult}×`} · ${l.tHours}h${l.trailMult != null ? ` · trail ${l.trailMult}×` : ''}</td>
      <td>${l.trades ?? '—'}</td>
      <td class="${(l.pnl || 0) >= 0 ? 'pos' : 'neg'}">${money(l.pnl)}</td>
      <td class="${l.holdout ? ((l.holdout.pnl || 0) >= 0 ? 'pos' : 'neg') : 'muted'}">${l.holdout ? money(l.holdout.pnl) : '—'}</td>
      <td>${l.vsNulls != null ? esc(String(l.vsNulls)) : '—'}</td>
      <td><button data-grid="${i}" title="every execution-menu permutation for this row, plateau view on top (test window only)">menu grid</button></td>
      </tr>
      <tr><td colspan="8" style="text-align:left;padding:0 .45rem .3rem"><details><summary>everything recorded for this row, verbatim</summary>
        <pre>${esc(JSON.stringify(l, null, 1))}</pre></details></td></tr>`;
  }).join('') : '<tr><td colspan="8" class="empty">no promoted rows (still running, or nothing survived)</td></tr>'}
      </tbody></table></div>
      ${sel ? `<p class="note">selected: <b>${esc(sel.trade)}</b> ${esc(sel.geometry)} ${esc(sel.decision)} q${sel.quorum} ${sel.tHours}h — this selection feeds Verify · Tune · Greenlight</p>` : '<p class="note">no row selected yet</p>'}
      </div>
      <div class="panel" id="gridOut"><span class="muted">Menu grid: press a row's button — every execution permutation for that row with the plateau view (one setting moved at a time) on top.</span></div>
      <div class="panel"><details><summary>the COMPLETE stored settings record for this run, verbatim (nothing invisible)</summary>
        <pre>${esc(JSON.stringify(doc.params || {}, null, 1))}</pre></details></div>`}
    </div>`;
  $('#bOpen').onclick = () => { pickedRun = $('#bPick').value || null; localStorage.setItem('cx-run', pickedRun || ''); pickedDoc = null; drawBoards(); };
  if (!doc) return;
  $('#bBody').querySelectorAll('tr[data-i]').forEach((tr) => {
    tr.onclick = async (ev) => {
      if (ev.target.tagName === 'BUTTON' || ev.target.tagName === 'SUMMARY') return;
      const l = leaders[Number(tr.dataset.i)];
      // record the selection on the RUN (the same anchor confirm/greenlight use)
      const out = await tryPost(`api/bracketlab/${encodeURIComponent(doc.id)}/select`, l);
      pickedDoc = null; if (out) drawBoards();
    };
  });
  const censusFileFor = (l) => {
    const cr = (doc.edgeCensus || []).find((r) => r.nullDealSeed == null && !r.shiftFrac
      && r.trade === l.trade && (r.ctx1 || '') === (l.ctx1 || '') && (r.ctx2 || '') === (l.ctx2 || '')
      && r.geometry === l.geometry && r.decision === l.decision);
    return cr && cr.modelFile ? cr.modelFile.split('/').pop() : null;
  };
  $('#bBody').querySelectorAll('button[data-grid]').forEach((b) => {
    b.onclick = async () => {
      const l = leaders[Number(b.dataset.grid)];
      const file = censusFileFor(l);
      if (!file) { $('#gridOut').innerHTML = '<span class="warn">this row has no stored votes file (older run) — the grid needs the persisted committee votes</span>'; return; }
      $('#gridOut').innerHTML = '<span class="muted">re-scoring the full menu from the stored votes…</span>';
      try {
        const start = await post(`api/bracketlab/${encodeURIComponent(doc.id)}/menugrid`, { file });
        const d = await pollJob(start.jobId, (m) => { $('#gridOut').innerHTML = `<span class="muted">${esc(m)}</span>`; });
        const cells = d.cells || [];
        $('#gridOut').innerHTML = `<h3 style="margin-top:0">Menu grid — ${esc(l.trade)} ${esc(l.geometry)} (${cells.length.toLocaleString()} permutations, test window only)</h3>
          <div class="scrollx"><table><thead><tr><th>cell</th><th>trades</th><th>test $</th></tr></thead><tbody>
          ${cells.slice(0, 400).map((c) => `<tr><td>q${c.quorum} · ${c.entry === 'market' ? 'market' : `${esc(c.gate)} d${c.dMult}×`} · ${c.tHours}h${c.trailMult != null ? ` · trail ${c.trailMult}×` : ''}</td>
            <td>${c.trades ?? '—'}</td><td class="${(c.pnl || 0) >= 0 ? 'pos' : 'neg'}">${money(c.pnl)}</td></tr>`).join('')}
          </tbody></table></div>${cells.length > 400 ? `<p class="note">showing 400 of ${cells.length}</p>` : ''}`;
      } catch (e) { $('#gridOut').innerHTML = `<span class="warn">menu grid failed: ${esc(e.message)}</span>`; }
    };
  });
}

// ---- Verify -------------------------------------------------------------------
async function drawVerify() {
  const doc = await loadPicked();
  const sel = getSelRow(doc);
  const gate = await api('api/planted-gate/status').catch(() => null);
  $('#view').innerHTML = `<div class="panel">
    <h3 style="margin-top:0">Planted check — the instrument's calibration certificate</h3>
    <p class="note">Regenerates a fabricated pair carrying a KNOWN planted rule and fires it through the full sweep +
      null pipeline. PASS = the board found the plant, profited, beat always-long, and every null board destroyed it.
      A pass belongs to the engine version that earned it; a new release starts NOT CHECKED.</p>
    <div class="row"><span>current: <b>${esc((gate && (gate.verdict || gate.status)) || 'NOT CHECKED')}</b>
      ${gate && gate.engineVersion ? `<span class="muted">(engine ${esc(gate.engineVersion)})</span>` : ''}</span>
      <button id="pgRun" class="pri">Run the planted check</button><span id="pgMsg" class="note"></span></div>
    ${gate ? `<details style="margin-top:.4rem"><summary>full gate record</summary><pre>${esc(JSON.stringify(gate, null, 1))}</pre></details>` : ''}
  </div>
  <div class="panel">
    <h3 style="margin-top:0">Tool 1 — this row against its null runs</h3>
    <p class="note">Compares the picked REAL run against a SCRAMBLE run (a sweep launched with scrambled labels): each
      scrambled world re-shops the whole menu in the same test window, and its best find must beat the selected row.
      Launch scramble runs from Sweep; read the verdict here. ALWAYS VISIBLE — a gate failing judges the INSTRUMENT,
      never retires the candidate on one number.</p>
    ${sel ? `<div class="row" style="align-items:flex-end">
      <span class="note">selected: <b>${esc(sel.trade)}</b> ${esc(sel.geometry)} q${sel.quorum} ${sel.tHours}h</span>
      <label class="f">scramble run id<input id="t1null" style="width:22rem" placeholder="bracketlab-…-null"></label>
      <button id="t1run" class="pri">Read Tool 1 verdict</button><span id="t1msg" class="note"></span></div><div id="t1out"></div>`
    : '<button disabled title="select a row on Boards first">Read Tool 1 verdict</button> <span class="note">— select a row on the Boards section first; this tool is per-row.</span>'}
  </div>
  <div class="panel">
    <h3 style="margin-top:0">Tool 2 — the board against its dealt-vote null boards</h3>
    <p class="note">For each promoted row: how many of its null copies (same setup, votes dealt onto random days) its
      HELD-BACK money beats. With N null boards the finest honest claim is 1 in N+1. Computed from the run's own stored
      null rows — needs a sweep launched with null boards &gt; 0.</p>
    ${doc ? `<div id="t2out">${renderTool2(doc)}</div>` : '<span class="note">open a run on Boards first.</span>'}
  </div>`;
  function renderTool2(dd) {
    const all = dd.leaders || [];
    const nulls = all.filter((l) => l.nullDealSeed != null);
    if (!nulls.length) return '<span class="muted">this run carries no dealt-vote null boards (launch the sweep with null boards &gt; 0).</span>';
    const key = (l) => `${l.trade}|${l.ctx1 || ''}|${l.ctx2 || ''}|${l.geometry}|${l.decision}`;
    const byKey = new Map();
    for (const n of nulls) { const k = key(n); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(n); }
    const reals = all.filter((l) => l.nullDealSeed == null && byKey.has(key(l)));
    return `<table><thead><tr><th>setup</th><th>held-back $</th><th>null copies</th><th>beaten</th><th>claim</th></tr></thead><tbody>
      ${reals.map((l) => {
    const ns = byKey.get(key(l)); const mine = l.holdout ? l.holdout.pnl : null;
    const beaten = mine == null ? null : ns.filter((n) => (n.holdout ? n.holdout.pnl : -Infinity) < mine).length;
    return `<tr><td>${esc(l.trade)} ${esc(l.geometry)} ${esc(l.decision)}</td>
      <td class="${(mine || 0) >= 0 ? 'pos' : 'neg'}">${money(mine)}</td><td>${ns.length}</td>
      <td>${beaten == null ? '—' : `${beaten}/${ns.length}`}</td>
      <td class="muted">${beaten == null ? '—' : `at best 1 in ${ns.length + 1}`}</td></tr>`;
  }).join('')}</tbody></table>`;
  }
  $('#pgRun').onclick = async () => {
    if (!confirm('Run the planted check? Fires a full real sweep on the fabricated pair (minutes).')) return;
    $('#pgMsg').textContent = 'running…';
    const out = await tryPost('api/planted-gate', {});
    $('#pgMsg').textContent = out ? 'started — the strip badge and this section update when it lands' : '';
  };
  const t1 = $('#t1run');
  if (t1) t1.onclick = async () => {
    $('#t1msg').textContent = 'reading…';
    try {
      const d = await post('api/bracketlab/null-verdict', {
        realId: doc.id, nullId: $('#t1null').value.trim(),
        trade: sel.trade, geometry: sel.geometry, decision: sel.decision,
        windowLayout: (doc.params && doc.params.windowLayout) || undefined,
      });
      $('#t1out').innerHTML = `<pre>${esc(JSON.stringify(d, null, 1).slice(0, 12000))}</pre>`;
      $('#t1msg').textContent = '';
    } catch (e) { $('#t1msg').textContent = e.message; }
  };
}

// ---- History (History Tuning + HT v2 age dial) ---------------------------------
async function drawHistory() {
  const doc = await loadPicked();
  const sel = getSelRow(doc);
  $('#view').innerHTML = `<div class="panel">
    <h3 style="margin-top:0">History Tuning — change ONE variable (training-history length) and price the effect</h3>
    <p class="note">One variable per run, declared before it fires (the confirm discipline): the same frozen trading
      cell, trained on windows of different depth, priced on the same folds. The reading rule is stamped at launch.</p>
    ${sel ? `<div class="row">
        <span class="note">selected row: <b>${esc(sel.trade)}</b> ${esc(sel.geometry)} q${sel.quorum} ${sel.tHours}h</span>
        <button id="htRun" class="pri">Launch History Tuning on this row</button><span id="htMsg" class="note"></span></div>`
    : '<span class="note">select a row on Boards first — History Tuning drills the selected candidate.</span>'}
    <div id="htOut"></div>
  </div>
  <div class="panel">
    <h3 style="margin-top:0">Age dial (HT v2) — one declared half-life vs the reference, paired folds</h3>
    <p class="note">PLAIN WORDS: instead of cutting history off, the age dial DOWN-WEIGHTS old days smoothly. One
      half-life (how many days back a sample's influence falls to half) is declared, then priced against the
      no-dial reference on ~20 paired folds — same folds, same frozen trading cell, so the ONLY difference is the
      dial. The table's verdict is the paired money difference, fold by fold.</p>
    <div class="row" style="align-items:flex-end">
      <label class="f">half-life<select id="ht2hl"><option>90d</option><option>180d</option><option>365d</option><option>730d</option></select></label>
      ${sel ? '<button id="ht2Run" class="pri">Launch paired age-dial run</button>' : '<span class="note">select a row on Boards first.</span>'}
      <span id="ht2Msg" class="note"></span>
    </div>
    <div id="ht2Out"></div>
  </div>
  <div class="panel"><h3 style="margin-top:0">Finished tuning runs</h3><div id="htList"><span class="muted">loading…</span></div></div>`;
  const list = await api('api/batches').catch(() => ({}));
  const runs = (list.batches || list || []).filter((b) => b.kind === 'historytuning' || b.kind === 'httwo').slice(0, 12);
  $('#htList').innerHTML = runs.length ? `<table><thead><tr><th>run</th><th>kind</th><th>status</th><th>started</th><th></th></tr></thead><tbody>
    ${runs.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.kind)}</td><td>${esc(r.status)}</td><td>${esc((r.startedAt || '').slice(0, 16))}</td>
      <td><button data-open="${esc(r.id)}">read</button></td></tr>`).join('')}</tbody></table><div id="htRead"></div>`
    : '<span class="muted">none yet</span>';
  $('#htList').querySelectorAll('button[data-open]').forEach((b) => {
    b.onclick = async () => {
      const d = await api(`api/batch/${encodeURIComponent(b.dataset.open)}`).catch(() => null);
      $('#htRead').innerHTML = d ? `<h3>${esc(d.id)}</h3>
        <p class="note">reading rules (stamped BEFORE launch): ${esc(JSON.stringify(d.params && d.params.readingRules || '—'))}</p>
        <details open><summary>result record, verbatim</summary><pre>${esc(JSON.stringify(d.result || d.summary || d.perf || d, null, 1).slice(0, 20000))}</pre></details>` : 'unreadable';
    };
  });
  const htRun = $('#htRun');
  if (htRun) htRun.onclick = async () => {
    $('#htMsg').textContent = 'launching…';
    const out = await tryPost('api/historytuning', {
      sourceBatchId: doc.id,
      windowStamps: sel.windowStamps || null,
      combo: { trade: sel.trade, ctx1: sel.ctx1 || null, ctx2: sel.ctx2 || null, size: sel.size || 1 },
      branch: { geometry: sel.geometry, decision: sel.decision,
        band: sel.bandMode === 'auto' || !sel.bandMode ? 'auto' : sel.bandPct, weekdaysOnly: !!sel.weekdaysOnly },
      declaredCell: { quorum: sel.quorum, gate: sel.gate, entry: sel.entry || 'breakout', dMult: sel.dMult,
        tHours: sel.tHours, trailMult: sel.trailMult ?? null, armMult: sel.armMult ?? null, bandPct: sel.bandPct },
    });
    $('#htMsg').textContent = out ? `launched ${out.id || ''} — appears under finished runs when done` : '';
  };
  const ht2Run = $('#ht2Run');
  if (ht2Run) ht2Run.onclick = async () => {
    $('#ht2Msg').textContent = 'launching…';
    const out = await tryPost('api/httwo', { sourceBatchId: doc.id, halfLifeKey: $('#ht2hl').value });
    $('#ht2Msg').textContent = out ? `launched ${out.id || ''}` : '';
  };
}

// ---- Tune (stop tuner · conviction sizing · compare) ----------------------------
async function drawTune() {
  const doc = await loadPicked();
  const sel = getSelRow(doc);
  const [scan, stop, conv, applied] = await Promise.all([
    api('api/pilot/heavyscan').catch(() => ({ running: false })),
    api('api/pilot/stopsweep').catch(() => ({ status: 'idle' })),
    api('api/pilot/convictionsweep').catch(() => ({ status: 'idle' })),
    api('api/pilot/fixed-stop').catch(() => ({ stopPct: null })),
  ]);
  const busy = scan.running;
  const pct = (v) => (v == null ? '—' : (v * 100).toFixed(2) + '%');
  const usd = (v) => money(v);
  const target = sel ? `the selected row (<b>${esc(sel.trade)}</b> ${esc(sel.geometry)} q${sel.quorum} ${sel.tHours}h of ${esc(doc.id)})` : 'F1 (the registry pilot)';
  const scanBody = sel ? { runId: doc.id, target: 'best' } : { bookId: 'F1' };
  $('#view').innerHTML = `
  ${busy ? `<div class="panel warn">A heavy scan is running (${esc(String(busy))}) — one at a time; both launchers are disabled until it lands (scans run minutes and cannot be aborted mid-flight).</div>` : ''}
  <div class="panel">
    <h3 style="margin-top:0">Protective stop tuner — full-history, loses no winner</h3>
    <p class="note">Replays the frozen committee over ALL history and finds the tightest fixed stop that would not have
      clipped a single winner, plus the sacrifice curve (give up top winners → tighter stop → NET $). Scanning applies
      nothing. Target: ${target}.</p>
    <div class="row"><button id="stopRun" class="pri" ${busy ? 'disabled' : ''}>Tune protective stop (full history)</button>
      <span class="note">currently applied to F1: ${applied.stopPct != null ? `<span class="pos">${pct(applied.stopPct)}</span>` : 'none'}</span></div>
    <div id="stopOut">${stop.status === 'done' ? renderStopResult(stop) : stop.status === 'running' ? '<p class="note">running…</p>' : stop.status === 'error' ? `<p class="warn">last scan failed: ${esc(stop.error || '')}</p>` : ''}</div>
  </div>
  <div class="panel">
    <h3 style="margin-top:0">Conviction sizing — bet more when more members agree?</h3>
    <p class="note">Prices the DECLARED clip ladder (multiplier = winning-side vote count) as a pure $ overlay on the
      same full-history replay, against a shuffled-assignment chance check and exposure-honest metrics.
      Target: ${target}.</p>
    <div class="row"><button id="convRun" class="pri" ${busy ? 'disabled' : ''}>Run conviction sweep (full history)</button></div>
    <div id="convOut">${conv.status === 'done' ? renderConvResult(conv) : conv.status === 'running' ? '<p class="note">running…</p>' : conv.status === 'error' ? `<p class="warn">last sweep failed: ${esc(conv.error || '')}</p>` : ''}</div>
  </div>
  <div class="panel">
    <h3 style="margin-top:0">Compare two runs — NOT a null test</h3>
    <div class="row" style="align-items:flex-end">
      <label class="f">run A<input id="cmpA" style="width:20rem" value="${esc(pickedRun || '')}"></label>
      <label class="f">run B<input id="cmpB" style="width:20rem"></label>
      <button id="cmpGo">Compare</button></div>
    <div id="cmpOut"></div>
  </div>`;
  function renderStopResult(s) {
    const cc = s.counts || {};
    return `<p><b>${esc(s.bookId)}</b>: tightest no-winner-lost stop <span class="pos">${pct(s.stopPct)}</span> —
      ${cc.winners || 0} winners / ${cc.losers || 0} losers over ${cc.priced || 0} entries.</p>
      <div class="scrollx"><table><thead><tr><th>give up top winners</th><th>stop</th><th>winners cut</th><th>winner $ given up</th><th>losers cut</th><th>loss-side $</th><th>NET $</th><th></th></tr></thead><tbody>
      ${(s.curve || []).map((c) => `<tr><td>${c.sacrificeTopWinners}</td><td>${pct(c.stopPct)}</td><td>${c.winnersForfeited}</td>
        <td class="neg">${usd(-Math.abs(c.winnerProfitForfeitedUsd || 0))}</td><td>${c.losersCut}</td>
        <td class="${(c.loserPnlDeltaUsd || 0) >= 0 ? 'pos' : 'neg'}">${usd(c.loserPnlDeltaUsd)}</td>
        <td class="${(c.netPnlDeltaUsd || 0) >= 0 ? 'pos' : 'neg'}"><b>${usd(c.netPnlDeltaUsd)}</b></td>
        <td>${s.bookId === 'F1' ? `<button data-stop="${c.stopPct}">apply to F1</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="note">NET = winner $ given up + loss-side $ vs no stop; positive means the stop helps. Apply buttons exist
        only for F1 (the running engine); for a lab row the number informs the greenlight instead.</p>`;
  }
  function renderConvResult(c) {
    const n = c.null || {};
    return `<p><b>${esc(c.bookId)}</b> over ${c.entries} priced entries: flat ${usd(c.flatUsd)} vs ladder <b>${usd(c.ladderUsd)}</b>
      — uplift <b class="${(c.upliftUsd || 0) >= 0 ? 'pos' : 'neg'}">${usd(c.upliftUsd)}</b>.</p>
      <div class="scrollx"><table><thead><tr><th>agreement</th><th>mult</th><th>trades</th><th>wins</th><th>win %</th><th>flat $</th><th>ladder $</th></tr></thead><tbody>
      ${(c.buckets || []).map((b) => `<tr><td>${b.agree} of ${(c.setup && c.setup.members) || 4}${b.thin ? ' ⚠' : ''}</td>
        <td>${b.multiplier}x</td><td>${b.n}</td><td>${b.winners}</td>
        <td>${b.n ? ((100 * b.winners) / b.n).toFixed(1) + '%' : '—'}</td>
        <td>${usd(b.flatUsd)}</td><td><b>${usd(b.ladderUsd)}</b></td></tr>`).join('')}
      </tbody></table></div>
      <p class="note"><b>Chance check:</b> ${c.shuffles} shuffled deals, mean uplift ${usd(n.mean)}, p=${n.pNull}.
      <b>Exposure:</b> per-$ ${c.flatPerDollar} → ${c.ladderPerDollar}; worst trade ${usd(c.worstTradeUsd)};
      drawdown ${usd(c.maxDrawdownUsd)}; peak concurrent ${usd(c.peakConcurrentUsd)} (flat ${usd(c.peakConcurrentFlatUsd)}).
      <b>Verdict:</b> ${esc(c.verdict || '')}</p>`;
  }
  $('#stopRun').onclick = async () => {
    if (!confirm('Run the full-history stop scan? (minutes; one heavy scan at a time)')) return;
    const out = await tryPost('api/pilot/stopsweep', scanBody); if (out) setTimeout(drawTune, 1500);
  };
  $('#convRun').onclick = async () => {
    if (!confirm('Run the full-history conviction sweep? (minutes; one heavy scan at a time)')) return;
    const out = await tryPost('api/pilot/convictionsweep', scanBody); if (out) setTimeout(drawTune, 1500);
  };
  $('#view').querySelectorAll('button[data-stop]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm(`Apply a ${(Number(b.dataset.stop) * 100).toFixed(2)}% protective stop to the LIVE F1 engine?`)) return;
      const out = await tryPost('api/pilot/stop-apply', { stopPct: Number(b.dataset.stop) }); if (out) drawTune();
    };
  });
  $('#cmpGo').onclick = async () => {
    try {
      const d = await post('api/bracketlab/compare', { a: $('#cmpA').value.trim(), b: $('#cmpB').value.trim() });
      $('#cmpOut').innerHTML = `<pre>${esc(JSON.stringify(d, null, 1).slice(0, 20000))}</pre>`;
    } catch (e) { $('#cmpOut').innerHTML = `<span class="warn">${esc(e.message)}</span>`; }
  };
  if (stop.status === 'running' || conv.status === 'running') setTimeout(() => { if (tab === 'tune') drawTune(); }, 4000);
}

// ---- Greenlight -----------------------------------------------------------------
async function drawGreenlight() {
  const doc = await loadPicked();
  const sel = getSelRow(doc);
  const gls = await api('api/live/greenlights').catch(() => ({ greenlights: [] }));
  $('#view').innerHTML = `<div class="panel">
    <h3 style="margin-top:0">Greenlight — the decision that a config is fit to trade</h3>
    <p class="note">Records WHO/WHEN/WHY with the exact frozen config, engine version, and the campaign's whole
      evidentiary chain. The config then appears on the Trading tab (both sides) for activation. Only greenlighted
      configs ever trade — no hand-built live configs, ever.</p>
    ${sel ? `<div class="row" style="align-items:flex-end">
      <span class="note" style="flex:1 1 auto;min-width:0">selected: <b>${esc(sel.trade)}</b> ${esc(sel.geometry)} ${esc(sel.decision)} q${sel.quorum} ${sel.tHours}h
        — test ${money(sel.pnl)}${sel.holdout ? ` · held-back ${money(sel.holdout.pnl)}` : ''}</span>
      <label class="f" style="flex:none">anchor<select id="glTarget"><option value="declared">declared cell</option><option value="best">best cell</option></select></label>
    </div>
    <div class="row" style="margin-top:.4rem;align-items:flex-end">
      <label class="f" style="flex:1">why — the decision record (required)<input id="glWhy" style="width:100%"
        placeholder="e.g. money screen + Tool 2 null + held-back all cleared; stop scanned; conviction priced"></label>
      <button id="glGo" class="pri">GREENLIGHT this config</button></div>`
    : '<span class="note">select a row on Boards first — a greenlight is minted from the selected row.</span>'}
  </div>
  <div class="panel"><h3 style="margin-top:0">Existing greenlights</h3>
    <table><thead><tr><th>id</th><th>pair</th><th>campaign</th><th style="text-align:left">why</th><th>minted</th><th>state</th></tr></thead><tbody>
    ${(gls.greenlights || []).map((g) => `<tr><td>${esc(g.id)}</td><td>${esc(g.configSnapshot?.combo?.trade || '—')}</td>
      <td class="muted">${esc(g.campaign || '—')}</td><td style="text-align:left" class="muted">${esc((g.why || '').slice(0, 90))}</td>
      <td>${esc((g.createdUtc || '').slice(0, 16))}</td><td>${g.revoked ? '<span class="warn">nuked</span>' : '<span class="pos">greenlighted</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">none yet</td></tr>'}
    </tbody></table>
    <p class="note">activation, deactivation and nuking live on the <a href="trading.html">Trading tab</a>.</p></div>`;
  const go = $('#glGo');
  if (go) go.onclick = async () => {
    const why = $('#glWhy').value.trim();
    if (!why) { alert('why is required — the decision record is the point.'); return; }
    if (!confirm(`Greenlight ${sel.trade} ${sel.geometry} (${$('#glTarget').value} cell)?`)) return;
    const out = await tryPost('api/live/greenlight', { runId: doc.id, target: $('#glTarget').value, why });
    if (out) { alert(`Greenlighted: ${out.greenlight.id}\n\nIt is now on the Trading tab, both sides.`); drawGreenlight(); }
  };
}

function draw() {
  renderTabs(); renderStrip();
  if (tab === 'data') drawData();
  else if (tab === 'sweep') drawSweep();
  else if (tab === 'boards') drawBoards();
  else if (tab === 'verify') drawVerify();
  else if (tab === 'history') drawHistory();
  else if (tab === 'tune') drawTune();
  else drawGreenlight();
}
function tickClock() { $('#utcClock').textContent = new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC'; }
tickClock(); setInterval(tickClock, 1000);
draw();
})();
