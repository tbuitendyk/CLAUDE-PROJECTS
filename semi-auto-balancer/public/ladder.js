// Ladder Lab frontend (Phase L). Talks to /api/ladder/* on the same origin;
// relative URLs so it works at the root and behind the stripping proxy.
'use strict';

const $ = (sel) => document.querySelector(sel);

async function api(path, opts = {}) {
  const res = await fetch(`api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

// ---- formatting helpers -----------------------------------------------------
const fmtDate = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : '?');
const pct = (x, d = 1) => (x == null || !isFinite(x) ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(d)}%`);
const pctPlain = (x, d = 1) => (x == null || !isFinite(x) ? '—' : `${x.toFixed(d)}%`);
const num = (x, d = 2) => (x == null || !isFinite(x) ? '—' : x.toFixed(d));
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Compact human rendering of a plateau's parameter ranges.
const DIM_LABELS = {
  entryStart: (lo, hi) => `1st buy ${lo === hi ? `−${lo}%` : `−${lo}…−${hi}%`}`,
  entrySpacing: (lo, hi) => `step ${lo === hi ? lo : `${lo}–${hi}`}%`,
  entryCount: (lo, hi) => `×${lo === hi ? lo : `${lo}–${hi}`} rungs`,
  buyFrac: (lo, hi) => `buy ${lo === hi ? Math.round(lo * 100) : `${Math.round(lo * 100)}–${Math.round(hi * 100)}`}%`,
  exitStart: (lo, hi) => `1st sell ${lo === hi ? `${lo.toFixed(2)}×` : `${lo.toFixed(2)}–${hi.toFixed(2)}×`} ATH`,
  exitSpacing: (lo, hi) => `step ${lo === hi ? lo.toFixed(2) : `${lo.toFixed(2)}–${hi.toFixed(2)}`}×`,
  exitCount: (lo, hi) => `×${lo === hi ? lo : `${lo}–${hi}`} rungs`,
  sellFrac: (lo, hi) => `sell ${lo === hi ? Math.round(lo * 100) : `${Math.round(lo * 100)}–${Math.round(hi * 100)}`}%`,
  reservePct: (lo, hi) => `reserve ${lo === hi ? lo : `${lo}–${hi}`}%`,
  dcaMonthlyPct: (lo, hi) => `DCA ${lo === hi ? lo : `${lo}–${hi}`}%/mo`,
};
function rangesLabel(ranges) {
  const order = ['entryStart', 'entrySpacing', 'entryCount', 'buyFrac', 'exitStart', 'exitSpacing', 'exitCount', 'sellFrac', 'reservePct', 'dcaMonthlyPct'];
  return order
    .filter((d) => ranges[d])
    .map((d) => DIM_LABELS[d](ranges[d][0], ranges[d][1]))
    .join(' · ');
}

const tierChip = (tier) => (tier ? `<span class="tier-chip">${esc(tier)}</span>` : '');

// ---- data / status ----------------------------------------------------------
async function refreshStatus() {
  try {
    const st = await api('/ladder/status');
    const d = st.data || {};
    if (d.rows > 0) {
      const yrs = d.from && d.to ? ((d.to - d.from) / 86400000 / 365).toFixed(1) : '?';
      $('#l-data').textContent =
        `${d.rows.toLocaleString()} daily BTC/USD bars cached: ${fmtDate(d.from)} → ${fmtDate(d.to)} (${yrs} years). ` +
        (d.rows < 1000 ? 'Too thin for a sweep — load full history first.' : 'Ready to sweep.');
    } else {
      $('#l-data').textContent = 'No BTC daily history cached yet — load it first.';
    }
    $('#l-run').disabled = !(d.rows >= 1000);
    const gs = st.gridSize ? st.gridSize.toLocaleString() : '?';
    $('#l-grid-desc').innerHTML = $('#l-grid-desc').innerHTML.replace(/in the grid/, `in the ${gs}-configuration grid`);
    return st;
  } catch (err) {
    $('#l-data').textContent = `status check failed: ${err.message}`;
    return null;
  }
}

// ---- job polling ------------------------------------------------------------
function pollJob(jobId, { statusEl, barEl, fillEl, buttons }, onDone) {
  buttons.forEach((b) => ($(b).disabled = true));
  if (barEl) $(barEl).classList.remove('hidden');
  const iv = setInterval(async () => {
    let job;
    try {
      job = await api(`/jobs/${jobId}`);
    } catch (err) {
      // Transient fetch hiccup (or a service restart): report but keep polling.
      $(statusEl).textContent = `poll error: ${err.message} (retrying)`;
      return;
    }
    if (job.status === 'running') {
      $(statusEl).textContent = job.progress || 'running…';
      if (fillEl && job.progressPct != null) $(fillEl).style.width = job.progressPct + '%';
    } else {
      clearInterval(iv);
      buttons.forEach((b) => ($(b).disabled = false));
      if (barEl) $(barEl).classList.add('hidden');
      if (fillEl) $(fillEl).style.width = '0%';
      if (job.status === 'done') {
        $(statusEl).textContent = '';
        onDone();
      } else {
        $(statusEl).textContent = `failed: ${job.error || 'unknown error'}`;
      }
    }
  }, 2000);
}

// ---- rendering --------------------------------------------------------------
function renderResult(latest) {
  const r = latest.result;
  if (!r) return;
  $('#l-results').classList.remove('hidden');
  $('#l-caveat').textContent = `⚠ ${r.caveat}`;

  const w = r.window;
  const when = latest.createdAt ? ` Sweep run ${fmtDate(latest.createdAt)}${r.grid.fast ? ' (fast pass: ⅓ grid)' : ''}.` : '';
  $('#l-window').textContent =
    `History: ${w.bars.toLocaleString()} daily bars, ${fmtDate(w.from)} → ${fmtDate(w.to)} (${w.years.toFixed(1)} years). ` +
    `BTC $${Math.round(w.priceFrom).toLocaleString()} → $${Math.round(w.priceTo).toLocaleString()}; all-time high $${Math.round(w.ath).toLocaleString()}. ` +
    `${r.grid.totalConfigs.toLocaleString()} configurations scored.${when}`;

  // Top picks (+ reasoning rows).
  const picksBody = $('#l-picks tbody');
  picksBody.innerHTML = '';
  for (const p of r.picks) {
    const tags = [];
    if (p.plateauRank != null) tags.push(`plateau #${p.plateauRank + 1} best (${p.plateauSize} configs)`);
    else if (p.plateauMemberRank != null) tags.push(`in plateau #${p.plateauMemberRank + 1} (${p.plateauMemberSize} configs)`);
    else if ('plateauMemberRank' in p) tags.push('outside plateaus');
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${esc(p.label)}${tags.length ? ` <span class="grid-note">${esc(tags.join(', '))}</span>` : ''}</td>` +
      `<td>${tierChip(p.tier)}</td>` +
      `<td class="num">${pct(p.cagrPct)}</td>` +
      `<td class="num">${pctPlain(p.maxDDPct, 0)}</td>` +
      `<td class="num">${num(p.mar)}</td>` +
      `<td class="num">${num(p.robustScore)}</td>` +
      `<td class="num">${p.maxUnderwaterDays}d</td>` +
      `<td class="num">${pctPlain(p.minUsdPctOfStart, 0)}</td>` +
      `<td class="num">${pctPlain(p.btcSharePct, 0)}</td>` +
      `<td class="num">${p.trades} · ${pctPlain(p.feesPct)}</td>`;
    picksBody.appendChild(tr);
    const rr = document.createElement('tr');
    rr.className = 'reason-row';
    rr.innerHTML = `<td colspan="10">Why: ${esc(p.reasoning)}</td>`;
    picksBody.appendChild(rr);
  }

  // Plateaus.
  const platBody = $('#l-plateaus tbody');
  platBody.innerHTML = '';
  r.plateaus.forEach((pl, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>#${i + 1}</td>` +
      `<td class="num">${pl.size.toLocaleString()}</td>` +
      `<td>${esc(rangesLabel(pl.ranges))}</td>` +
      `<td class="num">${pct(pl.best.cagrPct)} / ${pctPlain(pl.best.maxDDPct, 0)} DD</td>`;
    platBody.appendChild(tr);
  });

  // Baselines.
  const baseBody = $('#l-baselines tbody');
  baseBody.innerHTML = '';
  for (const b of r.baselines) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${esc(b.name)}${b.priceNote ? ` <span class="grid-note">${esc(b.priceNote)}</span>` : ''}</td>` +
      `<td class="num">${pct(b.cagrPct)}</td>` +
      `<td class="num">${pctPlain(b.maxDDPct, 0)}</td>` +
      `<td class="num">${num(b.mar)}</td>` +
      `<td class="num">${b.maxUnderwaterDays}d</td>` +
      `<td class="num">${b.trades} · ${pctPlain(b.feesPct)}</td>`;
    baseBody.appendChild(tr);
  }

  // Synthetic futures grid.
  renderScenarios(r);

  // Parameter sensitivity heat.
  const heatHead = $('#l-heat thead');
  const heatBody = $('#l-heat tbody');
  heatHead.innerHTML = '<tr><th>Parameter</th><th title="Mean MAR (CAGR ÷ MaxDD) of every configuration using this value, averaged over the rest of the grid">Mean risk-adjusted score by value</th></tr>';
  heatBody.innerHTML = '';
  const heatNames = { entryStart: 'First buy rung (% below ATH)', buyFrac: 'Buy size (% of spendable USD)' };
  for (const [dim, cells] of Object.entries(r.heat)) {
    const vals = cells.map((c) => c.meanMar);
    const hi = Math.max(...vals);
    const cellHtml = cells
      .map((c) => {
        const label = dim === 'buyFrac' ? `${Math.round(c.value * 100)}%` : `−${c.value}%`;
        const strong = c.meanMar === hi;
        return `<span style="display:inline-block;margin-right:1rem;${strong ? 'font-weight:700' : ''}">${label}: ${num(c.meanMar)}${strong ? ' ◀ best' : ''}</span>`;
      })
      .join('');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(heatNames[dim] || dim)}</td><td>${cellHtml}</td>`;
    heatBody.appendChild(tr);
  }
}

function renderScenarios(r) {
  const s = r.scenarios;
  $('#l-scen-note').textContent =
    `— ${s.pathsPerArchetype} synthetic ${s.years}-year paths per archetype, starting at today's price with the real ATH carried in; cells: median [10th…90th percentile] return`;
  $('#l-prob-note').textContent = s.probabilityNote;

  const head = $('#l-scenarios thead');
  const body = $('#l-scenarios tbody');
  const archs = s.archetypes;
  head.innerHTML =
    '<tr><th title="Rows: each top pick plus the baselines">Strategy</th>' +
    archs
      .map(
        (a) =>
          `<th class="num" title="Median [p10…p90] ${s.years}-year return across ${s.pathsPerArchetype} synthetic paths of this archetype">${esc(a.name)}<span class="prob">≈${(a.probability * 100).toFixed(0)}% prob.</span></th>`
      )
      .join('') +
    '<th class="num" title="Median return weighted by the rough archetype probabilities — a single blended expectation">Prob-weighted</th></tr>';

  body.innerHTML = '';
  const cell = (v) =>
    v
      ? `<td class="num" title="10th–90th percentile: ${pct(v.p10, 0)} … ${pct(v.p90, 0)}">${pct(v.median, 0)}<span class="prob">[${pct(v.p10, 0)}…${pct(v.p90, 0)}]</span></td>`
      : '<td class="num">—</td>';

  const rows = [
    ...r.picks.map((p, i) => ({
      name: `Pick #${i + 1}${p.tier ? ` (${p.tier})` : ''}`,
      title: p.label,
      scen: p.scenarios,
    })),
    ...r.baselines.filter((b) => b.scenarios).map((b) => ({ name: b.name, title: '', scen: b.scenarios })),
  ];
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td title="${esc(row.title)}">${esc(row.name)}</td>` +
      archs.map((a) => cell(row.scen.byArchetype[a.key])).join('') +
      `<td class="num"><strong>${pct(row.scen.probWeightedMedian, 0)}</strong></td>`;
    body.appendChild(tr);
  }
}

async function loadLatest() {
  try {
    const latest = await api('/ladder/latest');
    if (latest && latest.result) renderResult(latest);
  } catch (err) {
    $('#l-status').textContent = `could not load last result: ${err.message}`;
  }
}

// ---- wiring -----------------------------------------------------------------
$('#l-load').addEventListener('click', async () => {
  $('#l-data-status').textContent = 'starting…';
  try {
    const { jobId } = await api('/ladder/load-data', { method: 'POST', body: {} });
    pollJob(
      jobId,
      { statusEl: '#l-data-status', barEl: null, fillEl: null, buttons: ['#l-load'] },
      async () => {
        $('#l-data-status').textContent = 'loaded ✓';
        await refreshStatus();
      }
    );
  } catch (err) {
    $('#l-data-status').textContent = `failed to start: ${err.message}`;
    $('#l-load').disabled = false;
  }
});

$('#l-run').addEventListener('click', async () => {
  $('#l-status').textContent = 'starting…';
  try {
    const { jobId } = await api('/ladder/sweep', { method: 'POST', body: { fast: $('#l-fast').checked } });
    pollJob(
      jobId,
      { statusEl: '#l-status', barEl: '#l-bar', fillEl: '#l-bar-fill', buttons: ['#l-run', '#l-load'] },
      loadLatest
    );
  } catch (err) {
    $('#l-status').textContent = `failed to start: ${err.message}`;
    $('#l-run').disabled = false;
  }
});

(async () => {
  await refreshStatus();
  await loadLatest();
})();
