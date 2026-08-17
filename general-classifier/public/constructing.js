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

// theme — Constructing remembers its OWN setting (owner, 2026-08-17). It used to
// share the Trading page's key; each tab now keeps its own.
const root = document.documentElement;
root.setAttribute('data-theme', localStorage.getItem('cx-theme') || 'dark');
$('#themebtn').onclick = () => {
  const n = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', n); localStorage.setItem('cx-theme', n);
};

// CPU CAP — service-wide, shared by every job on the box. It lived only in the
// old app's topbar, so from this tab there was no way to see or change what the
// machine was allowed to spend (owner sweep, 2026-08-17).
const CPU_STEPS = [100, 90, 75, 50, 25, 10, 0];
let cpuPct = null;
let cpuThreads = 1;
function showCpu() {
  const b = $('#cpubtn');
  if (!b) return;
  b.textContent = cpuPct == null ? 'CPU —' : cpuThreads > 1 ? `CPU ${cpuPct}% x${cpuThreads}` : `CPU ${cpuPct}%`;
}
async function loadCpu() {
  try {
    const body = await api('api/cpu');
    cpuPct = body.pct; cpuThreads = body.threads || 1;
  } catch (_) { cpuPct = null; }
  showCpu();
}
if ($('#cpubtn')) {
  $('#cpubtn').onclick = async () => {
    const idx = CPU_STEPS.indexOf(cpuPct);
    const next = CPU_STEPS[(idx + 1) % CPU_STEPS.length];
    const out = await tryPost('api/cpu', { pct: next });
    if (out) { cpuPct = out.pct; cpuThreads = out.threads || 1; showCpu(); }
  };
  loadCpu();
}

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
      <label class="f">universe (blank = all 17 default pairs)<input id="swUni" placeholder="LTCUSDT,XRPUSDT,BCHUSDT" style="width:20rem"></label>
      <label class="c"><input type="checkbox" id="swSingles" checked> singles</label>
      <label class="c"><input type="checkbox" id="swDoubles" checked> doubles</label>
      <label class="c"><input type="checkbox" id="swTriples"> triples</label>
      <label class="c"><input type="checkbox" id="swAll" checked> all loaded data</label>
      <label class="f">start<input id="swStart" type="month"></label>
      <label class="f">end<input id="swEnd" type="month"></label>
    </div>
    <div class="row" style="margin-top:.5rem;align-items:flex-end">
      <label class="f">chunk shape<select id="swGeom"><option value="weekly-8d">Weekly 8-day</option><option value="daily-1d">Daily 1-day</option><option value="daily-2d">Daily 2-day</option><option value="daily-3d">Daily 3-day</option><option value="daily-4d" selected>Daily 4-day</option></select></label>
      <label class="c"><input type="checkbox" id="swPermGeom" checked> permute</label>
      <label class="f">decision<select id="swDec"><option>argmax</option><option>directional</option></select></label>
      <label class="c"><input type="checkbox" id="swPermDec" checked> permute</label>
      <label class="f">band % (or auto)<input id="swBand" value="auto" style="width:5rem"></label>
      <label class="c"><input type="checkbox" id="swPermBand" checked> permute</label>
      <label class="c"><input type="checkbox" id="swWeekdays"> 24/5</label>
      <label class="c"><input type="checkbox" id="swPermWk"> permute</label>
    </div>
    <div class="row" style="margin-top:.5rem;align-items:flex-end">
      <label class="f">window layout<select id="swLayout"><option value="split70" selected>70/15/15</option><option value="reserve61">61/13/13/13 (sealed exam)</option><option value="legacy80">legacy 80/20 (never evidence)</option></select></label>
      <label class="f">promote top K<input id="swK" type="number" value="25" min="1" max="50" style="width:4.5rem" title="the backend caps this at 50 (detailK); a larger number is silently reduced, so the box refuses it here instead"></label>
      <label class="f">null boards<input id="swNulls" type="number" value="0" min="0" max="24" style="width:4.5rem" title="companion boards with votes dealt onto random days; N boards = at best a 1-in-(N+1) claim; each costs a full sweep. The backend caps this at 24, so the box refuses more here rather than quietly running fewer"></label>
      <label class="f">min trades<input id="swMinTr" type="number" value="10" style="width:4.5rem"></label>
      <label class="c"><input type="checkbox" id="swTrail"> trailing plane</label>
    </div>
    <div class="row" style="margin-top:.5rem;align-items:flex-end;border-top:1px solid var(--line);padding-top:.55rem">
      <label class="c" title="REPLICATION MODE. Instead of judging each asset by its best-shopped cell, score ONE fixed configuration on every asset — declared before the run, so each asset costs a single look instead of the ~1,260 a menu sweep spends. That turns 'best of thousands on one asset' into a clean binomial across assets: no shopping tax, no branch correction. The menu still runs (the board is unchanged); this adds a separate replication table reporting the declared cell per asset. Agreement travels as an exact count per committee size — the 'agree' boxes (5/6 means 5 of a single coin's 6 members).">
        <input type="checkbox" id="swDecOn"> replication: also score one DECLARED config per asset</label>
      <label class="f" id="swDecEntryWrap" title="BREAKOUT opens the position when price reaches a rail at p(1±d). MARKET enters at the entry candle's open in the called direction with no rails, holds to t, and exits at the open: the general classifier's own trade, and exactly what the live paper books do. Market entry is directional by definition, so gate and d do not apply to it.">entry
        <select id="swDecEntry"><option value="breakout" selected>breakout</option><option value="market">market (classifier trade)</option></select></label>
      <label class="c" title="score EVERY entry style as its own declared config"><input type="checkbox" id="swPermDecEntry"> permute</label>
      <label class="f" id="swDecGateWrap">gate
        <select id="swDecGate"><option value="directional" selected>directional</option><option value="active">active</option><option value="always">always</option></select></label>
      <label class="c" id="swPermDecGateWrap" title="score EVERY gate as its own declared config"><input type="checkbox" id="swPermDecGate"> permute</label>
      <label class="f" id="swDecDWrap">d
        <select id="swDecD"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.5" selected>1.5×</option></select></label>
      <label class="c" id="swPermDecDWrap" title="score EVERY rail distance as its own declared config"><input type="checkbox" id="swPermDecD"> permute</label>
      <label class="f">t
        <select id="swDecT"><option value="17">17h</option><option value="41">41h</option><option value="65" selected>65h</option><option value="89">89h</option><option value="113">113h</option><option value="137">137h</option><option value="161">161h</option></select></label>
      <label class="c" title="score EVERY hold length as its own declared config"><input type="checkbox" id="swPermDecT"> permute</label>
      <label class="f" id="swDecTrailWrap" title="Declared trailing stop, band-relative. 'static' is the opposite-rail stop this lab has always used. Requires the trailing plane tick, since declared cells are read out of the promoted menu.">trail
        <select id="swDecTrail"><option value="" selected>static</option><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
      <label class="c" id="swPermDecTrailWrap" title="score EVERY trailing stop, static included, as its own declared config"><input type="checkbox" id="swPermDecTrail"> permute</label>
      <label class="f" id="swDecArmWrap" title="How far price must move in your favour before the trail starts. 0 trails from the first bar; 1× is close to move-to-breakeven-then-trail.">arm
        <select id="swDecArm"><option value="0" selected>0×</option><option value="0.5">0.5×</option><option value="1">1×</option></select></label>
      <label class="c" id="swPermDecArmWrap" title="score EVERY arm distance as its own declared config"><input type="checkbox" id="swPermDecArm"> permute</label>
      <label class="f" id="swDecQ6Wrap" title="How many of a SINGLE coin's 6 members must agree. A single-coin committee is 3 data views (everything / prices only / volume only) × 2 model types.">agree
        <select id="swDecQ6"><option value="1">1/6</option><option value="2" selected>2/6</option><option value="3">3/6</option><option value="4">4/6</option><option value="5">5/6</option><option value="6">6/6</option></select></label>
      <label class="f" id="swDecQ8Wrap" title="How many of a CONTEXT combo's 8 members must agree. Adding one or two context coins adds a fourth data view — how this coin moves against them — so those committees hold 8 members.">with contexts
        <select id="swDecQ8"><option value="1">1/8</option><option value="2">2/8</option><option value="3" selected>3/8</option><option value="4">4/8</option><option value="5">5/8</option><option value="6">6/8</option><option value="7">7/8</option><option value="8">8/8</option></select></label>
      <label class="c" title="score EVERY agreement level as its own declared config — this multiplies the set fastest"><input type="checkbox" id="swPermDecAgree"> permute</label>
      <span class="note" id="swDecCount"></span>
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
  // Market entry has no gate and no rail distance, and the server REJECTS both
  // rather than ignoring them — a silently ignored parameter is how a declared
  // config stops meaning what its author thought it meant. So hide the controls
  // whose values would be refused instead of leaving them on screen.
  const syncDecEntry = () => {
    const market = $('#swDecEntry').value === 'market';
    // A permute tick belongs to its box and must vanish WITH it. Left on their
    // own they were ticks for controls that were not on screen — a market entry
    // showed three orphans and a static stop a fourth (owner, 2026-08-17).
    const show = (id, on) => { const e = $(id); if (e) e.style.display = on ? '' : 'none'; };
    for (const [box, tick] of [['#swDecGateWrap', '#swPermDecGateWrap'],
      ['#swDecDWrap', '#swPermDecDWrap'], ['#swDecTrailWrap', '#swPermDecTrailWrap']]) {
      show(box, !market); show(tick, !market);
    }
    // arm means nothing without a trail
    const armOn = !market && !!$('#swDecTrail').value;
    show('#swDecArmWrap', armOn); show('#swPermDecArmWrap', armOn);
  };
  $('#swDecEntry').onchange = syncDecEntry;
  $('#swDecTrail').onchange = syncDecEntry;
  syncDecEntry();

  // Each agreement box exists only when the run will contain committees of that
  // size: 6 members for a single coin, 8 with context coins. GREY OUT, NEVER
  // HIDE (owner, 2026-07-31) — both boxes keep their place so the row keeps its
  // shape and the "agree" label keeps its context.
  const syncDecQuorum = () => {
    const off = (wrap, sel, disabled, why) => {
      $(sel).disabled = disabled;
      $(wrap).classList.toggle('ctl-off', disabled);
      $(wrap).title = disabled ? why : '';
    };
    off('#swDecQ6Wrap', '#swDecQ6', !$('#swSingles').checked,
      'this run has no single-coin committees — tick "singles" to set their agreement level');
    off('#swDecQ8Wrap', '#swDecQ8', !($('#swDoubles').checked || $('#swTriples').checked),
      'this run has no context committees — tick "doubles" or "triples" to set their agreement level');
  };
  ['#swSingles', '#swDoubles', '#swTriples'].forEach((id) => { $(id).addEventListener('change', syncDecQuorum); });
  syncDecQuorum();

  // HOW MANY CONFIGS THE TICKS DECLARE, before Start sweep. Every declared config
  // is scored on every asset, so the count multiplies the run — and the strongest
  // claim available shrinks as the search widens. A number you only discover from
  // a refusal message is a number you found too late.
  const MENUS = { entry: 2, gate: 3, dMult: 5, tHours: 7, trail: 5, arm: 3 };
  const syncDecCount = () => {
    const el = $('#swDecCount');
    if (!el) return;
    if (!$('#swDecOn').checked) { el.textContent = ''; return; }
    const market = $('#swDecEntry').value === 'market';
    let n = 1;
    if ($('#swPermDecEntry').checked) n *= MENUS.entry;
    if (!market) {
      if ($('#swPermDecGate').checked) n *= MENUS.gate;
      if ($('#swPermDecD').checked) n *= MENUS.dMult;
      if ($('#swPermDecTrail').checked) n *= MENUS.trail;
      if ($('#swPermDecArm').checked && $('#swDecTrail').value) n *= MENUS.arm;
    }
    if ($('#swPermDecT').checked) n *= MENUS.tHours;
    if ($('#swPermDecAgree').checked) {
      if ($('#swSingles').checked) n *= 6;
      if ($('#swDoubles').checked || $('#swTriples').checked) n *= 8;
    }
    el.innerHTML = n === 1
      ? 'one declared config — no shopping, the strongest reading available'
      : `<b>${n}</b> declared configs, each scored on every asset — roughly ${n}x the replication work. `
        + 'Permuting means you searched for it, so the honest end is the sealed slice (window layout 61/13/13/13, graded once in History).';
  };
  ['#swDecOn', '#swDecEntry', '#swDecTrail', '#swPermDecEntry', '#swPermDecGate', '#swPermDecD',
    '#swPermDecT', '#swPermDecTrail', '#swPermDecArm', '#swPermDecAgree', '#swSingles', '#swDoubles', '#swTriples']
    .forEach((id) => { if ($(id)) $(id).addEventListener('change', syncDecCount); });
  syncDecCount();

  $('#swStart2').onclick = async () => {
    const uni = $('#swUni').value.trim();
    const bandRaw = $('#swBand').value.trim().toLowerCase();
    const body = {
      universe: uni ? uni.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) : undefined,
      sizes: { singles: $('#swSingles').checked, doubles: $('#swDoubles').checked, triples: $('#swTriples').checked },
      // OMIT a blank month rather than sending "": the server rejects an empty
      // string with HTTP 400 "startMonth must be YYYY-MM", while an absent key
      // falls through to startBracketLab's own defaults. The month boxes ship
      // blank, so untick "all loaded data" and the old code could not launch.
      startMonth: $('#swStart').value || undefined, endMonth: $('#swEnd').value || undefined,
      allLoaded: $('#swAll').checked,
      permute: { geometry: $('#swPermGeom').checked, decision: $('#swPermDec').checked,
        band: $('#swPermBand').checked, weekdays: $('#swPermWk').checked },
      set: { geometry: $('#swGeom').value, decision: $('#swDec').value,
        band: bandRaw === 'auto' || bandRaw === '' ? 'auto' : Number(bandRaw), weekdaysOnly: $('#swWeekdays').checked },
      promoteK: Number($('#swK').value) || 25, minTrades: Number($('#swMinTr').value) || 10,
      trailing: $('#swTrail').checked, windowLayout: $('#swLayout').value,
      labelShiftReps: Number($('#swNulls').value) || 0, description: $('#swDesc').value.trim(),
    };
    // REPLICATION: one config declared BEFORE the run and scored on every asset,
    // so the claim is "it held on N of M assets" rather than "the best of ~1,260
    // cells looked good on one". Assembled to match what validateDeclared accepts
    // exactly — it throws on a parameter that cannot apply, rather than ignoring it.
    if ($('#swDecOn').checked) {
      const entry = $('#swDecEntry').value;
      const trailRaw = $('#swDecTrail').value;
      // a count per committee size, sent only for the sizes this run contains
      const qPart = {};
      if ($('#swSingles').checked) qPart.quorumSingles = Number($('#swDecQ6').value);
      if ($('#swDoubles').checked || $('#swTriples').checked) qPart.quorumContexts = Number($('#swDecQ8').value);
      const dp = {
        entry: $('#swPermDecEntry').checked, gate: $('#swPermDecGate').checked,
        dMult: $('#swPermDecD').checked, tHours: $('#swPermDecT').checked,
        trail: $('#swPermDecTrail').checked, arm: $('#swPermDecArm').checked,
        agree: $('#swPermDecAgree').checked,
      };
      if (Object.values(dp).some(Boolean)) body.declaredPermute = dp;
      body.declared = entry === 'market'
        ? { entry, tHours: Number($('#swDecT').value), ...qPart }
        : {
          entry,
          gate: $('#swDecGate').value,
          dMult: Number($('#swDecD').value),
          tHours: Number($('#swDecT').value),
          ...qPart,
          // armMult is refused unless a trail is declared, so send neither
          // rather than a meaningless pair
          ...(trailRaw ? { trailMult: Number(trailRaw), armMult: Number($('#swDecArm').value) } : {}),
        };
    }
    $('#swMsg').textContent = 'launching…';
    const out = await tryPost('api/bracketlab', body);
    // the endpoint returns { batchId } (server.js) — reading out.id gave a blank
    // run id on every launch, so the operator never saw which run they started
    $('#swMsg').textContent = out ? `launched ${out.batchId || ''} — progress below` : '';
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
  // SECOND RANKING (owner, 2026-08-17). "best cell" keeps meaning exactly what it
  // always has and the board's own order is untouched; this is an alternative
  // reading laid over the same rows, chosen run by run. Ranking by region width
  // sinks a lone spike — its neighbours are bad — and lifts a modest but wide one.
  const boardSort = localStorage.getItem('cx-boardsort') || 'board';
  if (boardSort === 'region') {
    leaders.sort((a, b) => ((b.region && b.region.size) || 0) - ((a.region && a.region.size) || 0)
      || (b.pnl || 0) - (a.pnl || 0));
  }
  const sel = getSelRow(doc);
  // VS NULLS, from the CENSUS. constructing.js read l.vsNulls, a field nothing
  // writes — the column had always shown "—" while looking like a measurement.
  // The board that works builds it from doc.edgeCensus, where the dealt-vote
  // copies record their held-back money (app.js:2419).
  const vnKey = (r) => `${r.trade}|${r.ctx1 || ''}|${r.ctx2 || ''}|${r.geometry}|${r.decision}`;
  const vnNulls = new Map();
  const vnReal = new Map();
  for (const r of ((doc && doc.edgeCensus) || [])) {
    if (r.holdPnl == null) continue;
    if (r.nullDealSeed != null) {
      if (!vnNulls.has(vnKey(r))) vnNulls.set(vnKey(r), []);
      vnNulls.get(vnKey(r)).push(r.holdPnl);
    } else if (!r.shiftFrac) vnReal.set(vnKey(r), r.holdPnl);
  }
  const hasDealNulls = vnNulls.size > 0;
  const vsNullsCell = (l) => {
    if (!hasDealNulls) return '<td class="muted" title="this run recorded no dealt-vote null copies, so there is nothing to compare against">—</td>';
    const real = vnReal.get(vnKey(l));
    const nulls = vnNulls.get(vnKey(l)) || [];
    if (real == null || !nulls.length) return '<td class="muted">—</td>';
    const beats = nulls.filter((v) => real > v).length;
    return `<td class="${beats === nulls.length ? 'pos' : ''}" title="how many of this row's dealt-vote null copies its HELD-BACK money beat. The register's only sanctioned yardstick (QC-7): the copies keep the committee's vote mix and destroy only the alignment with the market."><b>${beats}/${nulls.length}</b></td>`;
  };
  // Did this run hold anything back? If not, the board's money is the window the
  // settings were CHOSEN on and nothing judged it — the heading must say so
  // rather than promising a held-back judge that does not exist.
  const hasHold = ((doc && doc.leaders) || []).some((l) => l.holdout && l.holdout.pnl != null);
  const running = doc && doc.status === 'running';
  // ASSET PREDICTABILITY — pure census arithmetic, and the one reading on this
  // page that compares real against null across every asset at once.
  const assetSummary = (() => {
    if (!hasDealNulls) return '';
    const byAsset = new Map();
    for (const r of ((doc && doc.edgeCensus) || [])) {
      if (r.holdPnl == null || r.shiftFrac) continue;
      const asset = r.trade + (r.ctx1 ? '+' + r.ctx1 : '') + (r.ctx2 ? '+' + r.ctx2 : '');
      if (!byAsset.has(asset)) byAsset.set(asset, { real: [], nulls: [] });
      byAsset.get(asset)[r.nullDealSeed != null ? 'nulls' : 'real'].push(r.holdPnl);
    }
    const scored = [...byAsset.entries()]
      .filter(([, g]) => g.real.length && g.nulls.length)
      .map(([asset, g]) => {
        let won = 0;
        for (const rv of g.real) for (const nv of g.nulls) if (rv > nv) won++;
        return { asset, pct: (100 * won) / (g.real.length * g.nulls.length), nReal: g.real.length, nNull: g.nulls.length };
      })
      .sort((a, b) => b.pct - a.pct);
    if (!scored.length) return '';
    return `<div class="panel"><h3 style="margin-top:0">Asset predictability — best to worst</h3>
      <p class="note">KEY — for each asset: of all real-versus-null match-ups on HELD-BACK money, the share the real
        setups won. 100% means every real setup beat every null copy; 0% means every null copy beat every real setup;
        50% means the real setups are indistinguishable from dealt votes.
        ${running ? '<b>Counts grow until the sweep finishes — do not judge yet.</b>' : ''}</p>
      <div class="scrollx"><table><thead><tr><th>rank</th><th>asset</th>
        <th title="share of real-versus-null match-ups won on held-back money">predictability</th>
        <th title="real setups scored so far / null copies scored so far">real / null rows</th></tr></thead><tbody>
      ${scored.map((x, i) => `<tr><td>${i + 1}</td><td><b>${esc(x.asset)}</b></td>
        <td class="${x.pct >= 50 ? 'pos' : 'neg'}"><b>${x.pct.toFixed(1)}%</b></td>
        <td>${x.nReal} / ${x.nNull}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  })();
  // REPLICATION — the declared config scored on every asset. The run has always
  // recorded this; the tab never showed it (the tick's own tooltip promised a
  // table that did not exist here). Null copies also score the declared cell,
  // which is their job, but they must never enter the cross-asset count.
  const repBlock = (() => {
    const all = (doc && doc.replication) || [];
    // Null copies score the declared cell too — that is their job — but they must
    // never enter the cross-asset count (QC 72). Docs recorded BEFORE the tag
    // existed carry no nullDealSeed on any row, and filtering on it there keeps
    // everything, silently mixing null copies into the tally. On those docs the
    // board that works falls back to each asset's FIRST-recorded row, which is
    // the real copy (real copies are queued ahead of every null copy), and says
    // so on the page rather than presenting an inferred count as a measured one.
    const tagged = all.some((r) => 'nullDealSeed' in r);
    let rows;
    let inferredNote = '';
    if (tagged) {
      rows = all.filter((r) => r.nullDealSeed == null);
    } else {
      const realFailed = new Set(((doc && doc.failures) || [])
        .filter((f) => !/\|n\d+/.test(f.key || ''))
        .map((f) => String(f.key || '').split('|')[0].split('+')[0]));
      const seen = new Set();
      rows = all.filter((r) => {
        const k = `${r.trade}|${r.ctx1 || ''}|${r.ctx2 || ''}|${r.declaredLabel || ''}`;
        if (seen.has(k) || realFailed.has(r.trade)) return false;
        seen.add(k);
        return true;
      });
      inferredNote = `<p class="note"><b>Counts below are INFERRED, not measured.</b> This run recorded ${all.length}
        declared-cell rows without marking which copy scored them, so each asset's first-recorded row is taken as the
        real one — real copies are queued ahead of every null copy. ${all.length - rows.length} row(s) were excluded.
        ${realFailed.size ? `${realFailed.size} asset(s) whose real copy FAILED are dropped entirely rather than shown as a null copy.` : ''}</p>`;
    }
    if (!rows.length) return '';
    const groups = new Map();
    for (const r of rows) {
      const k = r.declaredLabel || 'declared config';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    // The chance of getting at least k of n right on coin flips. This IS the
    // reading replication produces: one look per asset, so the count across
    // assets owes no shopping tax and needs no correction.
    const binom = (k, n) => {
      if (!n) return null;
      const c = (nn, ii) => { let v = 1; for (let j = 0; j < ii; j++) v = (v * (nn - j)) / (j + 1); return v; };
      let acc = 0;
      for (let i = k; i <= n; i++) acc += c(n, i) * (0.5 ** n);
      return acc;
    };
    // Score each declared config on the HELD-BACK window — the once-only look —
    // never on the window the settings were chosen on.
    const scored = [...groups.entries()].map(([label, rs]) => {
      const hold = rs.filter((r) => r.holdout && r.holdout.pnl != null);
      const pos = hold.filter((r) => r.holdout.pnl > 0).length;
      const vsL = hold.filter((r) => r.holdout.vsAlwaysLong != null);
      const vsLPos = vsL.filter((r) => r.holdout.vsAlwaysLong > 0).length;
      const sum = hold.reduce((a, r) => a + (r.holdout.pnl || 0), 0);
      return { label, rs, hold, pos, vsL, vsLPos, sum, p: binom(pos, hold.length) };
    });
    // ORDERED BY VALUE: how unlikely the across-asset split is first (that is the
    // claim), then the share of assets that held up, then money. A config that
    // held on 9 of 10 assets outranks one that made more dollars on 2 of 10.
    scored.sort((a, b) => (a.p == null ? 1 : b.p == null ? -1 : a.p - b.p)
      || (b.pos / (b.hold.length || 1)) - (a.pos / (a.hold.length || 1))
      || b.sum - a.sum);
    const odds = (p) => (p == null ? '' : `1-in-${p > 0 ? Math.round(1 / p) : '∞'} by coin flip (p = ${p.toFixed(4)})`);
    const detail = (rs) => `<div class="scrollx"><table><thead><tr><th>asset</th><th>band</th><th>agree</th>
        <th title="the window the settings were chosen on — flattering by construction">test $</th>
        <th title="the once-only look on data no search touched — this is what the counts read">held-back $</th>
        <th title="held-back money minus the same execution forced long every period">vs always-long</th>
        <th>trades</th></tr></thead><tbody>
      ${rs.map((r) => `<tr><td>${esc(r.trade + (r.ctx1 ? ' + ' + r.ctx1 : '') + (r.ctx2 ? ' + ' + r.ctx2 : ''))}</td>
        <td>±${r.bandPct != null ? r.bandPct.toFixed(2) : '?'}%</td>
        <td>${r.quorum}/${r.members}</td>
        <td class="${(r.pnl || 0) >= 0 ? 'pos' : 'neg'}">${money(r.pnl)}</td>
        <td class="${r.holdout ? ((r.holdout.pnl || 0) >= 0 ? 'pos' : 'neg') : 'muted'}">${r.holdout ? money(r.holdout.pnl) : '—'}</td>
        <td class="${r.holdout && r.holdout.vsAlwaysLong != null ? (r.holdout.vsAlwaysLong >= 0 ? 'pos' : 'neg') : 'muted'}">${r.holdout && r.holdout.vsAlwaysLong != null ? money(r.holdout.vsAlwaysLong) : '—'}</td>
        <td>${r.trades ?? '—'}</td></tr>`).join('')}
      </tbody></table></div>`;

    // ONE declared config: the table on its own, exactly as it was. There is
    // nothing to choose between, so a ranked list would be furniture.
    if (scored.length === 1) {
      const g = scored[0];
      return `<div class="panel"><h3 style="margin-top:0">Replication — the declared config on every asset</h3>
        <p class="note">KEY — one FIXED configuration, named before the run, scored once on each asset. A single look
          apiece, so the count across assets owes no shopping tax and needs no correction: read the tally, never any
          single row. held-back $ is the once-only look on data no search touched and is what the tally counts;
          test $ is the window the settings were chosen on and flatters itself by construction.</p>
        ${inferredNote}
        <div><b>${esc(g.label)}</b></div>
        <div class="row" style="gap:1.4rem;margin:.3rem 0 .5rem">
          <span><span class="k">held-back positive</span> <b>${g.pos} / ${g.hold.length}</b>
            <span class="note">${odds(g.p)}</span></span>
          <span><span class="k">beat always-long</span> <b>${g.vsLPos} / ${g.vsL.length}</b></span>
        </div>
        ${detail(g.rs)}</div>`;
    }

    // MANY declared configs: the ranked list comes FIRST (owner, 2026-08-17).
    // One line per configuration, scrollable; open a line for its per-asset table.
    const listHtml = scored.map((g, i) => `<details style="border-bottom:1px solid var(--line)">
        <summary style="padding:.4rem .25rem;cursor:pointer">
          <span class="k" style="margin-right:.5rem">#${i + 1}</span><b>${esc(g.label)}</b>
          <span style="margin-left:.6rem">held up on <b>${g.pos}/${g.hold.length}</b> assets</span>
          <span class="note" style="margin-left:.5rem">${odds(g.p)}</span>
          <span class="note" style="margin-left:.5rem">· beat always-long ${g.vsLPos}/${g.vsL.length}</span>
          <span class="${g.sum >= 0 ? 'pos' : 'neg'}" style="margin-left:.5rem">${money(g.sum)} total held-back</span>
        </summary>
        <div style="padding:.3rem .25rem .8rem">${detail(g.rs)}</div>
      </details>`).join('');
    return `<div class="panel"><h3 style="margin-top:0">Replication — ${scored.length} declared configs, ranked</h3>
      <p class="note">KEY — each line is ONE declared configuration scored on every asset. Ranked by how unlikely its
        across-asset split is on coin flips, then by the share of assets that held up, then by money — because the claim
        replication makes is the COUNT across assets, never any single row. held up on: assets whose once-only held-back
        look made money. Open a line to see that configuration on every asset.
        These configurations were SEARCHED, not declared, so the honest end is the sealed slice: window layout
        61/13/13/13, graded once in the History section.</p>
      ${inferredNote}
      <div style="max-height:26rem;overflow-y:auto;border:1px solid var(--line);border-radius:6px">${listHtml}</div></div>`;
  })();
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
      <div class="panel"><div class="row" style="align-items:flex-start">
        <label class="f" style="flex:1">notes — why this run exists, what it showed, what it cost
          <textarea id="bNotes" rows="3" style="width:100%;font:inherit" ${doc.status === 'running' ? 'disabled' : ''}>${esc(doc.notes || '')}</textarea></label>
        <button id="bNotesSave" ${doc.status === 'running' ? 'disabled title="notes save after the run finishes — the engine refuses writes while it computes"' : ''}>save notes</button>
        <button id="bCopySettings" title="fill the Sweep form with THIS run's stored settings — universe, sizes, data range, chunk shape, decision, band, permutes, layout, null boards, trailing, min trades, promote K and the declared config. Nothing launches; the form is just set so a re-run is the same run. The description is NOT copied — a re-run states its own purpose.">copy settings into the form</button>
        <span id="bNotesMsg" class="note">${doc.notesEditedAt ? `last edited ${esc(String(doc.notesEditedAt).slice(0, 16))}` : ''}</span>
      </div></div>
      ${(() => {
        // THE RUN'S IDENTITY. plan is the units equation written so it equals
        // itself; dataManifest is the fingerprint of every candle file the run
        // read — two runs are data-comparable exactly when these match.
        const pl = doc.plan || null;
        const dm = doc.dataManifest || null;
        if (!pl && !dm) return '';
        return `<div class="panel"><h3 style="margin-top:0">What this run actually is</h3>
          ${pl ? `<p class="note"><b>Size:</b> ${pl.combos} combos × ${pl.branches} branch(es)${pl.nullBoards ? ` × ${pl.nullBoards + 1} boards (1 real + ${pl.nullBoards} null)` : ''}
            = <b>${pl.units}</b> units · ${pl.slimRuns ?? '—'} slim runs · ${pl.promoteRuns ?? '—'} promote runs.
            <span title="the multiplicity any null reading here must be read against: one lucky unit out of this many is not a finding">Every null claim on this page is against ${pl.units} units.</span></p>` : ''}
          ${dm ? `<p class="note"><b>Data fingerprint:</b> <code>${esc(String(dm.digest || dm.error || '—')).slice(0, 24)}</code>
            ${dm.coins != null ? `· ${dm.coins} coin(s), ${dm.files ?? '?'} file(s)` : ''}
            ${dm.utc ? `· stamped ${esc(String(dm.utc).slice(0, 16))}` : ''}
            <span title="taken at launch, over every candle file this run read. Two runs are data-comparable exactly when these match — a different fingerprint means the cache moved between the fire times.">(?)</span>
            ${dm.error ? ' <b class="warn">STAMP FAILED — this run cannot be proved comparable to any other</b>' : ''}</p>` : ''}
          </div>`;
      })()}
      ${(doc.failures && doc.failures.length) ? `<div class="panel"><b class="warn">${doc.failures.length} unit(s) FAILED</b>
        <p class="note">A failed unit is missing from every count on this page — the denominator is smaller than the run intended. First: <code>${esc(doc.failures[0].key || '')}</code> — ${esc(doc.failures[0].error || '')}</p>
        <details><summary>all failures</summary><pre>${esc(doc.failures.map((f) => `${f.key}: ${f.error}`).join('\n'))}</pre></details></div>` : ''}
      ${assetSummary}
      <div class="panel"><h3 style="margin-top:0">Survivor board — the promoted rows ${hasHold ? '(test window; held-back judges)' : '— NOTHING WAS HELD BACK'}</h3>
      ${hasHold ? '' : '<p class="note"><b>This run held nothing back.</b> Every dollar below is from the window the settings were CHOSEN on, so it flatters itself by construction and cannot say whether anything works out of sample. The null tools are unavailable for this run.</p>'}
      <p class="note">KEY — setup: traded + context coins; shape: chunk geometry · decision · band; cell: agreement/entry/hold;
        trades: entries in the test window; test $: profit-and-loss in dollars on the window the settings were CHOSEN on
        (flattering by construction); held-back $: the once-only look that matters; vs nulls: how many of the row's dealt-vote
        null copies its held-back money beat. Click a row to SELECT it — the selection drives Verify's Tool 1, Tune's scans
        and the Greenlight.</p>
      <div class="row" style="margin:.1rem 0 .5rem"><label class="f" style="flex:none">order by<select id="bSort">
        <option value="board" ${boardSort === 'board' ? 'selected' : ''}>best cell (the board's own ranking)</option>
        <option value="region" ${boardSort === 'region' ? 'selected' : ''}>widest region (neighbouring settings that all made money)</option>
      </select></label><span class="note">the rows are the same either way — only the order changes</span></div>
      <div class="scrollx"><table><thead><tr><th>setup</th><th>shape</th><th>cell</th><th>trades</th>
        <th>test $</th><th>held-back $</th><th>vs nulls</th>
        <th title="How many neighbouring settings around this row's best region ALL made money after fees. One step at a time on d, t and agreement; entry and gate are categories, so a region never crosses them. A lone winner scores 1 — noise gives spikes, structure gives regions.">region</th><th></th></tr></thead><tbody>
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
      ${vsNullsCell(l)}
      <td title="${l.region && l.region.centre ? esc(`middle of the region: q${l.region.centre.quorum} ${l.region.centre.entry === 'market' ? 'directional/market' : `${l.region.centre.gate}/breakout d${l.region.centre.dMult}x`} ${l.region.centre.tHours}h — ${l.region.cellsClearing} of ${l.region.cellsConsidered} settings cleared the bar (${l.region.bar})`) : 'not recorded — this run predates the region being measured'}">${l.region ? esc(String(l.region.size)) : '<span class="muted">—</span>'}</td>
      <td><button data-grid="${i}" title="every execution-menu permutation for this row, plateau view on top (test window only)">menu grid</button>
        <button data-inspect="${i}" title="open this setup: what each committee member saw, how they voted, and how alike they are. A MICROSCOPE, not a null test — it cannot tell you whether the setup works.">inspect</button></td>
      </tr>
      <tr><td colspan="9" style="text-align:left;padding:0 .45rem .3rem"><details><summary>everything recorded for this row, verbatim</summary>
        <pre>${esc(JSON.stringify(l, null, 1))}</pre></details></td></tr>`;
  }).join('') : '<tr><td colspan="9" class="empty">no promoted rows (still running, or nothing survived)</td></tr>'}
      </tbody></table></div>
      ${sel ? `<p class="note">selected: <b>${esc(sel.trade)}</b> ${esc(sel.geometry)} ${esc(sel.decision)} q${sel.quorum} ${sel.tHours}h — this selection feeds Verify · Tune · Greenlight</p>` : '<p class="note">no row selected yet</p>'}
      </div>
      ${repBlock}
      <div class="panel" id="gridOut"><span class="muted">Menu grid: press a row's button — every execution permutation for that row with the plateau view (one setting moved at a time) on top.</span></div>
      <div class="panel"><details><summary>the COMPLETE stored settings record for this run, verbatim (nothing invisible)</summary>
        <pre>${esc(JSON.stringify(doc.params || {}, null, 1))}</pre></details></div>`}
    </div>`;
  $('#bOpen').onclick = () => { pickedRun = $('#bPick').value || null; localStorage.setItem('cx-run', pickedRun || ''); pickedDoc = null; drawBoards(); };
  const nsave = $('#bNotesSave');
  if (nsave) nsave.onclick = async () => {
    // re-render from the RESPONSE: the stored value comes back truncated, and
    // the edited stamp is taken on the server, not here
    const out = await tryPost(`api/bracketlab/${encodeURIComponent(doc.id)}/notes`, { text: $('#bNotes').value });
    if (out) {
      $('#bNotes').value = out.notes || '';
      $('#bNotesMsg').textContent = `saved ${String(out.notesEditedAt || '').slice(0, 16)}`;
      if (pickedDoc) { pickedDoc.notes = out.notes; pickedDoc.notesEditedAt = out.notesEditedAt; }
    }
  };
  const csb = $('#bCopySettings');
  if (csb) csb.onclick = () => {
    const p = doc.params || {};
    const setV = (id, v) => { const e = $(id); if (e != null && v != null) e.value = v; };
    const setC = (id, v) => { const e = $(id); if (e) e.checked = !!v; };
    tab = 'sweep'; localStorage.setItem('cx-tab', tab);
    draw().then(() => {
      setV('#swUni', (p.universe || []).join(','));
      setC('#swSingles', p.sizes && p.sizes.singles); setC('#swDoubles', p.sizes && p.sizes.doubles);
      setC('#swTriples', p.sizes && p.sizes.triples); setC('#swAll', p.allLoaded);
      setV('#swStart', p.startMonth); setV('#swEnd', p.endMonth);
      setV('#swGeom', p.set && p.set.geometry); setV('#swDec', p.set && p.set.decision);
      setV('#swBand', p.set && (p.set.band === 'auto' ? 'auto' : p.set.band));
      setC('#swWeekdays', p.set && p.set.weekdaysOnly);
      setC('#swPermGeom', p.permute && p.permute.geometry); setC('#swPermDec', p.permute && p.permute.decision);
      setC('#swPermBand', p.permute && p.permute.band); setC('#swPermWk', p.permute && p.permute.weekdays);
      setV('#swLayout', p.windowLayout); setV('#swK', p.promoteK); setV('#swNulls', p.labelShiftReps);
      setV('#swMinTr', p.minTrades); setC('#swTrail', p.trailing);
      const d = p.declared;
      setC('#swDecOn', !!d);
      if (d) {
        setV('#swDecEntry', d.entry); setV('#swDecGate', d.gate); setV('#swDecD', d.dMult);
        setV('#swDecT', d.tHours); setV('#swDecTrail', d.trailMult == null ? '' : d.trailMult);
        setV('#swDecArm', d.armMult == null ? 0 : d.armMult);
        setV('#swDecQ6', d.quorumSingles); setV('#swDecQ8', d.quorumContexts);
      }
      const dp = p.declaredPermute || {};
      for (const [k, id] of [['entry', '#swPermDecEntry'], ['gate', '#swPermDecGate'], ['dMult', '#swPermDecD'],
        ['tHours', '#swPermDecT'], ['trail', '#swPermDecTrail'], ['arm', '#swPermDecArm'], ['agree', '#swPermDecAgree']]) setC(id, dp[k]);
      // intent never copies — a re-run states its own purpose
      setV('#swDesc', '');
      const m = $('#swMsg');
      if (m) m.textContent = `form filled from ${doc.id} — nothing launched. Say why this re-run exists, then Start sweep.`;
    });
  };
  if ($('#bSort')) {
    $('#bSort').onchange = () => { localStorage.setItem('cx-boardsort', $('#bSort').value); drawBoards(); };
  }
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
  // INSPECT — a microscope on one setup: what each member saw, how it voted, and
  // how alike the members are. It is NOT a null test and cannot say whether the
  // setup works; that caveat travels with the panel because the panel invites
  // exactly that misreading.
  $('#bBody').querySelectorAll('button[data-inspect]').forEach((b) => {
    b.onclick = async () => {
      const l = leaders[Number(b.dataset.inspect)];
      const file = censusFileFor(l);
      if (!file) { $('#gridOut').innerHTML = '<span class="warn">this row has no stored votes file (older run) — inspect needs the persisted committee votes</span>'; return; }
      $('#gridOut').innerHTML = '<span class="muted">opening the setup…</span>';
      const q = l.quorum ?? 1;
      const d = await api(`api/bracketlab/${encodeURIComponent(doc.id)}/inspect?file=${encodeURIComponent(file)}&quorum=${encodeURIComponent(q)}`).catch(() => null);
      if (!d || d.error) { $('#gridOut').innerHTML = `<span class="warn">${esc((d && d.error) || 'inspect failed')}</span>`; return; }
      const mem = d.members || [];
      const pw = d.pairwise || d.agreement || null;
      $('#gridOut').innerHTML = `<h3 style="margin-top:0">Inside a setup — a MICROSCOPE, not a null test</h3>
        <p class="note">${esc(d.meta ? `${d.meta.trade} · ${d.meta.geometry} · ${d.meta.decision}` : '')} at agreement ${esc(String(q))}.
          This panel shows what the committee is made of. It cannot tell you whether the setup works — only a null
          comparison can, and this is not one.</p>
        ${mem.length ? `<div class="scrollx"><table><thead><tr><th>member</th><th>view</th><th>model</th>
          <th title="share of periods this member called a direction rather than standing aside">participation</th>
          <th title="exact 3-class match rate of this member's calls on the search window">accuracy</th>
          <th title="accuracy minus the training-majority baseline — what the member adds over always guessing the commonest label">edge</th></tr></thead><tbody>
          ${mem.map((m, i) => `<tr><td>${i + 1}</td><td>${esc(String((m.spec && m.spec.view) || m.view || '—'))}</td>
            <td>${esc(String((m.spec && m.spec.model) || m.model || '—'))}</td>
            <td>${m.participation != null ? (100 * m.participation).toFixed(1) + '%' : '—'}</td>
            <td>${m.metrics && m.metrics.testAcc != null ? (100 * m.metrics.testAcc).toFixed(1) + '%' : '—'}</td>
            <td>${m.metrics && m.metrics.edge != null ? (100 * m.metrics.edge).toFixed(1) + ' pts' : '—'}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="note">no per-member detail in this dump</p>'}
        ${pw ? `<details><summary class="note" style="cursor:pointer">how alike the members are (pairwise agreement) — near-duplicates make an agreement count read higher than the number of independent opinions behind it</summary>
          <pre>${esc(JSON.stringify(pw, null, 1).slice(0, 8000))}</pre></details>` : ''}
        <details><summary class="note" style="cursor:pointer">the inspect record, verbatim</summary><pre>${esc(JSON.stringify(d, null, 1).slice(0, 20000))}</pre></details>`;
    };
  });
  $('#bBody').querySelectorAll('button[data-grid]').forEach((b) => {
    b.onclick = async () => {
      const l = leaders[Number(b.dataset.grid)];
      const file = censusFileFor(l);
      if (!file) { $('#gridOut').innerHTML = '<span class="warn">this row has no stored votes file (older run) — the grid needs the persisted committee votes</span>'; return; }
      $('#gridOut').innerHTML = '<span class="muted">re-scoring the full menu from the stored votes…</span>';
      try {
        const start = await post(`api/bracketlab/${encodeURIComponent(doc.id)}/menugrid`, { file });
        const d = await pollJob(start.jobId, (m) => { $('#gridOut').innerHTML = `<span class="muted">${esc(m)}</span>`; });
        const cells = (d.cells || []).slice().sort((a, b) => (b.pnl ?? -Infinity) - (a.pnl ?? -Infinity));
        // WHERE THE ROW SITS in its own menu, and the held-back comparison. Only
        // the AVERAGE held-back number is disclosed: per-cell held-back figures
        // would turn the graded window into another shopping window.
        const CF = ['quorum', 'gate', 'entry', 'dMult', 'tHours', 'trailMult', 'armMult'];
        const isCand = (c) => CF.every((k) => (c[k] ?? null) === (l[k] ?? null));
        const candIdx = cells.findIndex(isCand);
        const rankLine = candIdx >= 0
          ? `<p class="note"><b>Your cell sits at #${candIdx + 1} of ${cells.length.toLocaleString()}</b> in the table below (marked ▶).`
            + (d.holdAvg != null && l.holdout && l.holdout.pnl != null
              ? ` HELD-BACK comparison: your cell ${money(l.holdout.pnl)} against the average of the ${(d.holdCellCount || 0).toLocaleString()} setups that actually traded, ${money(d.holdAvg)} (${(100 * (d.holdPosShare || 0)).toFixed(0)}% of them positive; ${(d.holdAllCellCount || 0).toLocaleString()} cells in total — never-traded cells and duplicate always-gate copies are excluded so the average cannot be dragged toward zero by cells that did nothing). Every setup was scored once on the graded window but ONLY the average is disclosed: per-setup held-back numbers would let the graded window be shopped.`
              : '')
            + '</p>'
          : '';
        $('#gridOut').innerHTML = renderPlateau(cells, l) + rankLine + `<h3 style="margin-top:0">Menu grid — ${esc(l.trade)} ${esc(l.geometry)} (${cells.length.toLocaleString()} permutations, test window only)</h3>
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
      <button id="t1run" class="pri">Read Tool 1 verdict</button><span id="t1msg" class="note"></span></div>
      <div class="row" style="margin-top:.45rem;align-items:flex-end">
        <label class="f" title="each round replays the whole board on dealt votes — same committee, same machinery, the calendar alignment destroyed. N rounds is at best a 1-in-(N+1) claim, and each costs a full sweep.">null rounds to fire<input id="t1rounds" type="number" value="19" min="1" max="1000" style="width:5rem"></label>
        <button id="t1fire">Fire null runs on this run</button>
        <span id="t1fireMsg" class="note">— fires the rounds this tool then reads. They land on this run's own record.</span>
      </div><div id="t1out"></div>`
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
  const t1f = $('#t1fire');
  if (t1f) t1f.onclick = async () => {
    const rounds = Number($('#t1rounds').value) || 0;
    // the engine clamps a missing/zero/negative count to ONE — a finished-looking
    // null test with n=1, which is no test at all. Refuse it here instead.
    if (rounds < 1) { $('#t1fireMsg').textContent = 'a null test needs at least one round'; return; }
    if (!confirm(`Fire ${rounds} null round(s) on ${doc.id}?\n\nEach round replays the whole board on dealt votes and costs a full sweep. ${rounds} rounds is at best a 1-in-${rounds + 1} claim.`)) return;
    t1f.disabled = true;
    $('#t1fireMsg').textContent = 'launching…';
    const out = await tryPost(`api/bracketlab/${encodeURIComponent(doc.id)}/null`, { shifts: rounds });
    t1f.disabled = false;
    $('#t1fireMsg').textContent = out ? `${out.shifts} round(s) running — they land on this run's record` : '';
  };
  if (t1) t1.onclick = async () => {
    $('#t1msg').textContent = 'reading…';
    try {
      const d = await post('api/bracketlab/null-verdict', {
        realId: doc.id, nullId: $('#t1null').value.trim(),
        trade: sel.trade, geometry: sel.geometry, decision: sel.decision,
        windowLayout: (doc.params && doc.params.windowLayout) || undefined,
      });
      $('#t1out').innerHTML = renderNullVerdict(d);
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
      <label class="f" title="how fast older evidence stops counting. The server accepts these three keys and no others (lib/httwo.js HALF_LIVES); the tab used to offer 90d/180d/365d/730d and EVERY launch threw.">half-life<select id="ht2hl"><option value="12mo" selected>12mo</option><option value="24mo">24mo</option><option value="36mo">36mo</option></select></label>
      ${sel ? '<button id="ht2Run" class="pri">Launch paired age-dial run</button>' : '<span class="note">select a row on Boards first.</span>'}
      <span id="ht2Msg" class="note"></span>
    </div>
    <div class="row" style="margin-top:.4rem;align-items:flex-end">
      <button id="ht2ExamA" title="the late-rule fabricated pair: the instrument MUST find it. A miss means the age dial cannot see an effect that is provably there.">Run exam A (late-rule pair — must find)</button>
      <button id="ht2ExamB" title="the flat fabricated pair: the instrument MUST NOT find anything. A hit means it invents effects.">Run exam B (flat pair — must NOT find)</button>
      <span id="ht2Exams" class="note">exam status loading…</span>
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
      if (!d) { $('#htRead').innerHTML = 'unreadable'; return; }
      $('#htRead').innerHTML = d.kind === 'httwo' ? renderHtTwoRun(d) : renderHtRun(d, runs);
      wireHtRun(d, runs);
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
    $('#htMsg').textContent = out ? `launched ${out.batchId || ''} — appears under finished runs when done` : '';
  };
  // THE EXAM GATE. The age dial is an instrument, and an instrument that has not
  // been shown to find a planted effect AND to stay quiet on a flat one is not
  // yet evidence of anything. examStatus.ready is exactly "A passed and B did
  // not"; until then the real launcher says so rather than pretending.
  const exams = await api('api/httwo/exams').catch(() => null);
  const exEl = $('#ht2Exams');
  if (exEl) {
    exEl.innerHTML = !exams ? '<span class="muted">exam status unavailable</span>'
      : `<b class="${exams.ready ? 'pos' : 'warn'}">${exams.ready ? 'exams PASSED' : 'exams NOT passed'}</b>
         <span class="muted">engine ${esc(String(exams.engineVersion || '?'))}</span> — ${esc(String(exams.detail || ''))}`;
  }
  const ht2Run = $('#ht2Run');
  if (ht2Run) {
    if (exams && !exams.ready) {
      ht2Run.title = 'the exam pair has not passed on this engine version — a real age-dial run is not evidence until it has';
    }
    ht2Run.onclick = async () => {
      if (exams && !exams.ready
        && !confirm('The age-dial exams have NOT passed on this engine version.\n\nA real run launched now is not evidence of anything. Launch anyway?')) return;
      $('#ht2Msg').textContent = 'launching…';
      const out = await tryPost('api/httwo', { sourceBatchId: doc.id, halfLifeKey: $('#ht2hl').value });
      // /api/httwo answers { started, id, folds, windowDays } — NOT batchId
      $('#ht2Msg').textContent = out ? `launched ${out.id || ''}` : '';
    };
  }
  // examPair takes the FABRICATED PAIR SYMBOL, not 'A'/'B' — exam A is the
  // late-rule pair (the instrument must FIND it) and exam B the flat pair (it
  // must NOT). Sending 'A' would be refused as "examPair must be one of the
  // reserved fabricated pairs". Nothing else is sent: the half-life is not a
  // parameter of an exam, and the engine defaults it.
  for (const [btn, label, pair] of [['#ht2ExamA', 'A', 'PLANTEDLATEUSDT'], ['#ht2ExamB', 'B', 'PLANTEDUSDT']]) {
    const el = $(btn);
    if (!el) continue;
    el.onclick = async () => {
      el.disabled = true;
      const out = await tryPost('api/httwo', { examPair: pair });
      el.disabled = false;
      if (out) { $('#ht2Msg').textContent = `exam ${label} launched ${out.id || ''}`; drawHistory(); }
    };
  }
}




// THE NULL VERDICT, read rather than dumped. Constructing printed the raw JSON,
// truncated — every reading rule that makes the numbers mean anything lives in
// the Bracket lab's renderVerdict and was unreachable here (owner sweep,
// 2026-08-17). Ported from app.js:2108.
function renderNullVerdict(d) {
  if (!d) return '<span class="warn">no verdict</span>';
  const drawsTable = (t) => `<div class="scrollx" style="max-height:14rem;overflow-y:auto"><table>
    <thead><tr><th>null draw</th><th>value</th></tr></thead><tbody>
    ${t.draws.map((x) => `<tr><td>${typeof x.shift === 'number' ? x.shift.toFixed(3) : esc(String(x.shift))}${x.setup ? ' · ' + esc(String(x.setup).replace(/\|/g, ' ')) : ''}</td>
      <td class="${t.real > x.value ? 'pos' : 'neg'}">${money(x.value)}</td></tr>`).join('')}
    </tbody></table></div>`;
  const block = (title, t, what) => (t ? `
    <h3 style="margin-top:.6rem">${esc(title)} — <b class="${t.passes ? 'pos' : 'neg'}">${t.passes ? 'PASS' : 'FAIL'}</b> (beats ${t.beats}/${t.n})</h3>
    <p class="note">${esc(what)}
      KEY — <i>real</i>: held-back dollars on genuine data. <i>null draws</i>: the same quantity in worlds with nothing
      to predict. Beating all ${t.n} is the strongest claim ${t.n} draws allow (p floor ${t.pFloor ? t.pFloor.toFixed(3) : '—'})
      — a floor, never a measure of strength.</p>
    <p><b>real ${money(t.real)}</b>${(t.realBestSetup || t.setup) ? ` (${esc(String(t.setup || t.realBestSetup).replace(/\|/g, ' '))})` : ''}
      vs null draws: best ${money(Math.max(...t.draws.map((x) => x.value)))}, worst ${money(Math.min(...t.draws.map((x) => x.value)))}</p>
    ${drawsTable(t)}` : '');
  return `<p class="note">real: ${esc(String(d.realJob || ''))} · null boards: ${esc(String(d.nullJob || ''))}
      (${d.drawCount} draws, ${esc(String(d.construction || ''))})</p>
    ${d.paramMismatch ? `<p class="note"><b class="warn">SETTINGS MISMATCH:</b> the two jobs differ on
      ${d.paramMismatch.fields.map(esc).join(', ')} — ${esc(String(d.paramMismatch.note || ''))}</p>` : ''}
    ${block('Per-setup test', d.perSetup, 'Is this setup better than ITS OWN noise? Same setup, same machinery, dealt votes.')}
    ${block('Selection-aware test', d.selection, 'Is topping the board better than topping a NOISE board? Each null draw contributes its own best-of-board — this prices in that the winner was picked after looking.')}
    ${d.sanity ? `<p class="note">sanity: ${d.sanity.scrambleRows} null-draw setups, ${(100 * d.sanity.negativeShare).toFixed(1)}% losing money —
      ${d.sanity.ok ? '<b class="pos">PASS — noise mostly loses, as fees demand.</b>'
        : '<b class="neg">FAIL — NOISE IS PROFITING: the simulation is broken; do not read the tests above.</b>'}</p>` : ''}
    <p class="note"><b>What a pass buys:</b> this window only. It stops obvious chance results being frozen; the
      forward paper test after freezing is the real judge.</p>`;
}

// PLATEAU VIEW — one setting moved at a time, everything else pinned to the
// chosen cell. The menu grid button promised this in its own tooltip and the
// tab rendered none of it (owner sweep, 2026-08-17). It is the per-cell twin of
// the widest-region column: neighbours earning similar money means the pick is
// sturdy; the row alone earning while its neighbours collapse means one step
// away falls apart.
function renderPlateau(cells, cand) {
  if (!cand || !cells.length) return '';
  const FIELDS = ['quorum', 'gate', 'entry', 'dMult', 'tHours', 'trailMult', 'armMult'];
  const eq = (a, b) => (a ?? null) === (b ?? null);
  const isCand = (c) => FIELDS.every((k) => eq(c[k], cand[k]));
  const group = (skip, title, fmt, extraSame) => {
    const rows = cells.filter((c) => FIELDS.every((k) => k === skip || eq(c[k], cand[k])) && (!extraSame || extraSame(c)));
    if (rows.length < 2) return '';
    rows.sort((a, b) => ((a[skip] ?? -1) === (b[skip] ?? -1) ? ((a.armMult ?? -1) - (b.armMult ?? -1))
      : (typeof a[skip] === 'string' ? String(a[skip]).localeCompare(String(b[skip])) : (a[skip] ?? -1) - (b[skip] ?? -1))));
    return `<div style="display:inline-block;vertical-align:top;margin:0 .9rem .7rem 0">
      <table><thead><tr><th>${esc(title)}</th><th>test $</th><th>W/T</th></tr></thead><tbody>
      ${rows.map((c) => `<tr${isCand(c) ? ' class="selected"' : ''}><td>${isCand(c) ? '▶ ' : ''}${esc(fmt(c))}</td>
        <td class="${(c.pnl || 0) >= 0 ? 'pos' : 'neg'}">${money(c.pnl)}</td><td>${c.wins ?? '—'}/${c.trades ?? '—'}</td></tr>`).join('')}
      </tbody></table></div>`;
  };
  const blocks = [
    group('quorum', 'agreement', (c) => `${c.quorum}/${c.members}`),
    group('tHours', 'time limit', (c) => `${c.tHours}h`),
  ];
  if (cand.entry !== 'market') {
    blocks.push(group('dMult', 'trigger distance', (c) => `${c.dMult}×`));
    blocks.push(group('gate', 'gate', (c) => c.gate));
    // trailing axis: static plus each distance, arm pinned to the candidate's so
    // only ONE thing moves
    blocks.push(group('trailMult', 'trailing stop', (c) => (c.trailMult == null ? 'static' : `${c.trailMult}×`),
      (c) => (c.trailMult == null ? true : (c.armMult ?? 0) === (cand.armMult ?? 0))));
  }
  const body = blocks.filter(Boolean).join('');
  if (!body) return '';
  return `<h3 style="margin-top:0">Plateau view — one setting moved at a time, the rest held at your cell</h3>
    <p class="note">KEY — each small table changes exactly ONE setting; ▶ marks your cell. Neighbours earning similar
      money is a plateau and the pick is sturdy. Your row alone earning while its neighbours collapse is a needle —
      one step away it falls apart, so distrust it. Money is TEST-WINDOW money, dollars per $100, the same as the grid
      below. ${cand.entry === 'market' ? 'Market entry has no trigger distance, gate or trailing — only agreement and time limit can move.' : ''}</p>
    <div>${body}</div>`;
}

// ---- History: reading a finished tuning run ---------------------------------
// Ported from the Bracket lab's renderHtRun (app.js:3195). The Constructing tab
// used to answer "read" with the progress counters and a JSON dump — the dial
// board, the reading rules stamped before launch, the verdict and the sealed
// exam were all unreachable from this tab (owner sweep, 2026-08-17).
const HT_AGE_LABELS = { none: 'none (flat)', '6mo': '6mo half-life', '12mo': '12mo half-life',
  '24mo': '24mo half-life', '36mo': '36mo half-life' };

function renderHtRun(r, siblings = []) {
  const p = r.params || {};
  const head = `<h3 style="margin-top:0">${esc(r.id)} — ${esc(r.status)}`
    + `${r.status === 'running' && r.progress ? ' — ' + esc(r.progress) : ''}`
    + `${p.arm === 'null' ? ' <span class="badge">null draw</span>' : ''}`
    + `${p.mode === 'reserve-grade' ? ' <span class="badge">reserve grade</span>' : ''}</h3>`;

  // THE SEALED EXAM's own doc. Its verdict has TWO shapes and the second one
  // carries only { passed, sentence } — printing the rich fields on it renders
  // "undefined/undefined" (the Bracket lab does exactly that; this does not).
  if (p.mode === 'reserve-grade') {
    const v = r.verdict;
    if (!v) return `<div class="panel">${head}<p class="note">verdict appears when the grade completes</p></div>`;
    if (v.resolutionFloor == null) {
      return `<div class="panel">${head}<p class="note"><b>${esc(v.sentence || 'grade unusable')}</b></p></div>`;
    }
    return `<div class="panel">${head}
      <p class="note"><b>${esc(v.sentence)}</b></p>
      <p class="note">winner reserve <b>${money(v.winnerHoldPnl)}</b> · reference <b>${money(v.referenceHoldPnl)}</b> ·
        null draws at or above the winner: <b>${v.nullsAtOrAbove}/${v.nullDraws}</b> ·
        resolution floor ${esc(String(v.resolutionFloor))}
        <span title="the best claim this many draws can support — a floor, never a measure of strength">(?)</span></p>
      <p class="note">Every dollar here is HOLD money: the grade's test window is empty by construction, so a test
        figure would be structurally zero and meaningless.</p></div>`;
  }

  const rows = r.htRows || [];
  const excluded = new Set(r.excludedArms || []);
  const byArm = new Map();
  for (const row of rows) {
    if (row.refused || row.skipped) continue;
    const k = `${row.ageKey}|${row.retuneKey}`;
    const cur = byArm.get(k) || { test: 0, holds: {}, effMin: Infinity, splits: 0 };
    cur.test += row.testPnl || 0;
    cur.holds[row.split] = row.holdPnl;
    cur.effMin = Math.min(cur.effMin, row.effectiveDays ?? Infinity);
    cur.splits++;
    byArm.set(k, cur);
  }
  const ranked = [...byArm.entries()].filter(([k]) => !excluded.has(k)).sort((a, b) => b[1].test - a[1].test);
  const refKey = 'none|never';
  const winner = r.status === 'done' && ranked.length ? ranked[0][0] : null;
  const armRows = ranked.slice(0, 12).map(([k, v], i) => {
    const [age, ret] = k.split('|');
    // HOLDS ARE GRADED ONCE, NEVER SHOPPED: they stay sealed on screen until the
    // winner is declared, or the reader would be picking on them.
    const showHold = r.status === 'done' && (k === winner || k === refKey);
    const holdCells = showHold
      ? ['early', 'middle', 'late'].map((sp) => money(v.holds[sp] ?? 0)).join(' / ')
      : '<span class="muted">sealed until the winner is declared</span>';
    return `<tr><td>${i + 1}</td><td>${esc(HT_AGE_LABELS[age] || age)}</td><td>${esc(ret)}</td>
      <td>${money(v.test)}${v.splits < 3 ? ` <span class="muted">(${v.splits}/3 splits — partial, not comparable yet)</span>` : ''}</td>
      <td>${v.effMin === Infinity ? '—' : v.effMin.toFixed(0)}</td>
      <td>${k === refKey ? '<b>REFERENCE</b>' : ''}${k === winner ? ' <b class="pos">WINNER</b>' : ''}</td>
      <td>${holdCells}</td></tr>`;
  }).join('');

  const shaping = `<p class="note">Shaping numbers: training floor ${esc(String(p.trainingFloorDays ?? 180))} effective days (GUESSED) ·
    retune trade floor ${esc(String(p.minTradesPerLookbackWeek ?? '?'))} trades/lookback-week (GUESSED) ·
    window ${esc(String(p.windowDays ?? '?'))} days per test/hold · minimum training run-up 425 days (GUESSED) ·
    reserve61 splits are 60.9/13.05/13.05/13 exactly. Trailing is held fixed at the declared cell's setting through
    every retune.</p>`;
  const rules = p.readingRules ? `<details><summary class="note" style="cursor:pointer">The reading rules stamped into this run BEFORE it was launched (click)</summary>
    ${Object.entries(p.readingRules).map(([k, v]) => `<p class="note"><b>${esc(k)}</b> [${esc(v && v.label)}]: ${esc(v && v.text)}</p>`).join('')}</details>` : '';
  const excludedNote = excluded.size
    ? `<p class="note">Dial pairs excluded (failed a training floor on some split, so dropped from ALL splits): ${[...excluded].map(esc).join(', ')}</p>` : '';

  const myDraws = (siblings || []).filter((d) => (d.params || {}).replayOf === r.id && (d.params || {}).arm === 'null');
  const usedSeeds = myDraws.map((d) => Number(d.params.nullShiftSeed) || 0);
  const nextSeed = usedSeeds.reduce((a, b) => Math.max(a, b), 100) + 1;
  const readable = r.status === 'done' && p.arm !== 'null' && !p.mode;
  const verdictDiv = readable ? `<div id="htVerdict" class="note"><em>computing the stamped verdict…</em></div>` : '';
  const nullBtn = readable
    ? `<p class="note"><button data-ht-null="${esc(r.id)}" data-seed="${nextSeed}">Fire trail-replay null draw ${myDraws.length + 1} of 19 (seed ${nextSeed})</button>
       — each draw replays the full grid on dealt votes, inheriting only the calendar. 19 is the declared count
       (floor 1 in 20); the server refuses a repeated seed.</p>` : '';
  const gradeBtn = readable && p.reserveFromTs
    ? `<p class="note"><button data-ht-grade="${esc(r.id)}" class="pri">Run the reserve grade — one touch, final</button>
       — the winner's walk, the reference pass's walk and 19 null draws over the SEALED reserve, fired together,
       once, ever. This is the only look that slice will ever get.</p>`
    : (readable ? '<p class="note">No reserve exists for this setup (its board run predates the reserve layout) — the binding grade is the forward paper book.</p>' : '');

  return `<div class="panel">${head}${shaping}${rules}${excludedNote}
    <p class="note"><b>TABLE: the dial-pair board</b>${r.status === 'running' ? ' — FILLING LIVE as passes finish' : ''}.
      NAME: combined TEST money per dial pair (the picking read). KEY: age = the half-life setting; retune = cadence and
      lookback; test $ = net paper dollars per $100 book summed across the three test windows (picked on, flattering by
      construction) — a row marked partial has not finished all three splits, so its sum cannot be compared with complete
      rows; eff. days = the smallest effective training days any split saw; hold $ = the three hold windows
      early/middle/late, shown ONLY for the winner and the reference pass, because holds are graded once and never shopped.</p>
    <div class="scrollx"><table><thead><tr><th>#</th><th>age</th><th>retune</th><th>test $</th><th>eff. days</th><th></th><th>hold $ (e/m/l)</th></tr></thead>
      <tbody>${armRows || '<tr><td colspan="7" class="empty">rows appear as passes finish</td></tr>'}</tbody></table></div>
    ${verdictDiv}${nullBtn}${gradeBtn}</div>`;
}

// HT v2 (the age dial). Its verdict comes in three progressively richer shapes;
// the two short ones carry only `sentences`, so the rich fields are guarded.
function renderHtTwoRun(r) {
  const p = r.params || {};
  return `<div class="panel"><h3 style="margin-top:0">${esc(r.id)} — ${esc(r.status)}${r.status === 'running' && r.progress ? ' — ' + esc(r.progress) : ''}</h3>
    <p class="note">Age dial: half-life <b>${esc(String(p.halfLifeKey || '—'))}</b> against a flat reference, paired on the
      same folds. The reading is the paired difference across folds, never any single fold.</p>
    <div id="ht2Verdict" class="note"><em>computing the verdict…</em></div></div>`;
}

function renderHtTwoVerdict(v) {
  if (!v) return '<span class="muted">no verdict</span>';
  const lines = (v.sentences || []).map((x) => `<p class="note">${esc(x)}</p>`).join('');
  const rich = v.p != null || v.sum != null;
  return `<p><b class="${v.pass ? 'pos' : 'warn'}">${v.pass ? 'PASS' : 'NO EFFECT SHOWN'}</b>
      <span class="note">engine ${esc(String(v.engineVersion || '?'))}</span></p>${lines}
    ${rich ? `<p class="note">paired sum ${money(v.sum)} · sign-flip p ${v.p == null ? '—' : v.p.toFixed(4)} ·
      folds positive ${v.positiveFolds ?? '—'}/${v.folds ?? '—'}${v.carriedByOneFold ? ' · <b class="warn">carried by one fold</b>' : ''}</p>` : ''}`;
}

async function wireHtRun(d, runs) {
  const p = d.params || {};
  if (d.kind === 'httwo') {
    const el = $('#ht2Verdict');
    if (el) {
      const v = await api(`api/httwo/${encodeURIComponent(d.id)}/verdict`).catch(() => null);
      el.innerHTML = renderHtTwoVerdict(v);
    }
    return;
  }
  // the stamped verdict prints on the REAL run only — the server refuses it for
  // a null draw or a grade, and the grade's verdict is already on its own doc
  if (d.status === 'done' && p.arm !== 'null' && !p.mode) {
    const el = $('#htVerdict');
    if (el) {
      const v = await api(`api/historytuning/${encodeURIComponent(d.id)}/verdict`).catch(() => null);
      el.innerHTML = !v || v.error ? `<span class="muted">${esc((v && v.error) || 'no verdict')}</span>`
        : `<p><b class="${v.passed ? 'pos' : 'warn'}">${v.passed ? 'PASS' : 'NO'}</b> ${esc(v.sentence || '')}</p>
           <p class="note">winner <b>${esc(String(v.winner || '—'))}</b> · winner hold ${money(v.winnerHold)} ·
             reference hold ${money(v.referenceHold)}${v.nullDraws != null ? ` · null draws at or above: ${v.nullsAtOrAbove}/${v.nullDraws}` : ''}
             ${v.resolutionFloor ? ` · resolution floor ${esc(String(v.resolutionFloor))}` : ''}</p>`;
    }
  }
  const nb = document.querySelector('button[data-ht-null]');
  if (nb) {
    nb.onclick = async () => {
      nb.disabled = true;
      // this endpoint takes replayOf + nullShiftSeed — NOT sourceBatchId, and
      // NOT sourceHtRunId. Three endpoints in this panel, three different keys.
      const out = await tryPost('api/historytuning/null', {
        replayOf: nb.dataset.htNull, nullShiftSeed: Number(nb.dataset.seed),
      });
      nb.disabled = false;
      if (out) { alert(`null draw launched: ${out.batchId || ''} (${out.units || '?'} passes)`); drawHistory(); }
    };
  }
  const gb = document.querySelector('button[data-ht-grade]');
  if (gb) {
    gb.onclick = async () => {
      if (!confirm('Run the reserve grade?\n\nThis is the ONE look the sealed slice will ever get. It cannot be repeated for this run.')) return;
      gb.disabled = true;
      // takes sourceHtRunId — a HISTORY TUNING run id, not a board id
      const out = await tryPost('api/historytuning/reserve-grade', { sourceHtRunId: gb.dataset.htGrade });
      gb.disabled = false;
      if (out) { alert(`reserve grade launched: ${out.batchId || ''}`); drawHistory(); }
    };
  }
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
  // WHAT THE SCANS ARE AIMED AT. The tab could only ever target F1 or the
  // selected board row; the Bracket lab reads the saved forward books and lets
  // any of them be picked ("I thought I would be able to select from the saved
  // sweeps" — owner). Books already carrying a protective stop are not listed:
  // a breakout cell's opposite rail IS its stop, so tuning one is meaningless.
  const cand = await api('api/pilot/stop-candidates').catch(() => ({ candidates: [] }));
  const books = (cand && cand.candidates) || [];
  const savedTarget = localStorage.getItem('cx-scan-target') || '';
  const scanBody = savedTarget && savedTarget !== 'sel'
    ? { bookId: savedTarget }
    : (sel ? { runId: doc.id, target: 'best' } : { bookId: 'F1' });
  $('#view').innerHTML = `
  ${busy ? `<div class="panel warn">A heavy scan is running (${esc(String(busy))}) — one at a time; both launchers are disabled until it lands (scans run minutes and cannot be aborted mid-flight).</div>` : ''}
  <div class="panel">
    <h3 style="margin-top:0">Protective stop tuner — full-history, loses no winner</h3>
    <p class="note">Replays the frozen committee over ALL history and finds the tightest fixed stop that would not have
      clipped a single winner, plus the sacrifice curve (give up top winners → tighter stop → NET $). Scanning applies
      nothing. Target: ${target}.</p>
    <div class="row" style="margin-bottom:.4rem"><label class="f" title="what the scans below are aimed at. Books already carrying a protective stop are not listed — a breakout cell's opposite rail IS its stop, so tuning one is meaningless.">scan target<select id="tuneTarget">
      <option value="sel" ${savedTarget === 'sel' || !savedTarget ? 'selected' : ''}>${sel ? 'the row selected on Boards' : 'F1 (no board row selected)'}</option>
      ${books.map((b) => `<option value="${esc(b.id)}" ${savedTarget === b.id ? 'selected' : ''}>${esc(b.id)} — ${esc(b.combo && b.combo.trade || '')} ${b.cell && b.cell.tHours ? b.cell.tHours + 'h' : ''}</option>`).join('')}
    </select></label>
    <span class="note">${books.length} saved book(s) without a protective stop</span></div>
    <div class="row" style="margin-bottom:.4rem">
      <label class="f" title="apply a stop you chose yourself rather than one off the curve. The box is in percent; the engine stores a fraction.">or apply a custom stop<input id="stopCustomPct" type="number" step="0.5" min="0.1" max="99" placeholder="e.g. 25" style="width:5.5rem"> %</label>
      <button id="stopCustomApply">apply custom</button>
      <button id="stopClear" title="run with NO fixed stop. The position then rests on its scheduled exit alone.">No stop (clear)</button>
    </div>
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
  const tt = $('#tuneTarget');
  if (tt) tt.onchange = () => { localStorage.setItem('cx-scan-target', tt.value); drawTune(); };
  const applyStop = async (stopPct) => {
    const out = await tryPost('api/pilot/stop-apply', { stopPct });
    if (out) drawTune();
  };
  const cust = $('#stopCustomApply');
  if (cust) cust.onclick = () => {
    const v = Number($('#stopCustomPct').value);
    if (!Number.isFinite(v) || v <= 0 || v >= 100) { alert('a stop is a percent between 0 and 100'); return; }
    // the box is in PERCENT, the engine wants a FRACTION
    applyStop(v / 100);
  };
  const clr = $('#stopClear');
  if (clr) clr.onclick = () => {
    if (!confirm('Clear the protective stop?\n\nThe engine will run with NO fixed stop until one is applied again.')) return;
    applyStop(0);
  };
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
      <label class="f" style="flex:none">anchor<select id="glTarget" title="WHICH cell gets greenlighted. 'declared cell' is the one fixed before the run — no shopping. 'best cell' is the highest scorer, which is the best of ~1,260 tries and flatters itself. 'widest region' is the MIDDLE of the widest run of neighbouring settings that all made money — chosen by depth inside the region, never by its score, so the shopped peak cannot sneak back in."><option value="declared">declared cell</option><option value="best">best cell</option><option value="region">widest region</option></select></label>
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
