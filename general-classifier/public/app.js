/* General Classifier UI. All URLs are prefix-relative: nginx serves this app
   at /classifier/ and strips the prefix on proxy. */
(() => {
  const $ = (id) => document.getElementById(id);
  const form = $('form');
  const runBtn = $('run');
  const statusEl = $('status');
  const errorEl = $('error');
  const reportEl = $('report');

  const CLASSES = [-1, 0, 1];
  const GATE_Q = [5, 6, 7, 8]; // agreement-gradient rungs (server: GATE_QUORUMS)
  const clsName = (c) => (c > 0 ? '+1' : c < 0 ? '−1' : '0');
  const clsSpan = (c) => `<span class="cls ${c > 0 ? 'up' : c < 0 ? 'down' : 'flat'}">${clsName(c)}</span>`;
  const pct = (x, d = 1) => (x == null ? '—' : (100 * x).toFixed(d) + '%');
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function setStatus(text) {
    statusEl.hidden = !text;
    statusEl.innerHTML = text ? `<span class="spin">⟳</span>${esc(text)}` : '';
  }
  function setError(text) {
    errorEl.hidden = !text;
    errorEl.textContent = text || '';
  }

  // Parse a response body that SHOULD be JSON but may be an nginx HTML error
  // page (502/504 during proxy hiccups) — surface a readable message instead
  // of "Unexpected token '<'".
  async function jsonBody(res) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`server returned ${res.status || 'no'} status with a non-JSON body (proxy timeout or service restart?)`);
    }
  }

  const dormantValue = () => ($('autoband').checked ? 'auto' : Number($('dormant').value));
  $('autoband').addEventListener('change', () => {
    $('dormant').disabled = $('autoband').checked;
  });

  // "All loaded data": run on exactly what's cached — months (and Load Data,
  // which exists to fetch explicit ranges) go dormant while checked.
  const allLoadedChecked = () => $('allloaded').checked;
  $('allloaded').addEventListener('change', () => {
    const on = allLoadedChecked();
    $('start').disabled = on;
    $('end').disabled = on;
    $('start').required = !on;
    $('end').required = !on;
    $('load-btn').disabled = on;
  });

  // ---- form persistence -------------------------------------------------------
  //
  // Every screen is defined by these controls, so a reset silently redefines
  // the experiment. A deploy ships a new app.js version, which reloads the
  // page — that once turned an adaptive-band consensus screen into a fixed
  // ±2% one (different labels, uncomparable to the null already computed).
  // Settings now survive reloads; only an explicit change alters a run.
  const FORM_KEY = 'gc.form.v1';
  const PERSIST = ['dormant', 'trade', 'compare', 'start', 'end', 'geometry', 'features', 'model', 'decision', 'cons-pairs', 'cons-null'];
  const PERSIST_CHECKS = ['autoband', 'allloaded', 'weekdays'];

  function saveForm() {
    try {
      const state = {};
      for (const id of PERSIST) state[id] = $(id).value;
      for (const id of PERSIST_CHECKS) state[id] = $(id).checked;
      localStorage.setItem(FORM_KEY, JSON.stringify(state));
    } catch {
      /* private mode / quota — persistence is a convenience, never required */
    }
  }

  function restoreForm() {
    let state;
    try {
      state = JSON.parse(localStorage.getItem(FORM_KEY) || 'null');
    } catch {
      state = null;
    }
    if (state) {
      for (const id of PERSIST) if (state[id] != null && $(id)) $(id).value = state[id];
      for (const id of PERSIST_CHECKS) if (state[id] != null && $(id)) $(id).checked = !!state[id];
    }
    // Always sync dependent disabled/required states, restored or not.
    $('autoband').dispatchEvent(new Event('change'));
    $('allloaded').dispatchEvent(new Event('change'));
  }

  for (const id of [...PERSIST, ...PERSIST_CHECKS]) {
    const el = $(id);
    if (el) el.addEventListener('change', saveForm);
  }
  restoreForm();

  // ---- workspace tabs ----------------------------------------------------------
  //
  // Research (form, screens) vs Paper books (the live pre-registered
  // experiments). Different categories of work: the books verify past
  // setups in real time and shouldn't clutter — or distract from — the
  // research tools. Selection survives reloads via the URL hash, so a
  // bookmarked #books goes straight to the books.
  const TAB_PANES = { research: ['tab-research', 'tab-research-2'], bracket: ['tab-bracket'], walkforward: ['tab-walkforward'], books: ['tab-books'] };
  function showTab(name) {
    const tab = TAB_PANES[name] ? name : 'research';
    for (const [key, ids] of Object.entries(TAB_PANES)) {
      for (const id of ids) $(id).hidden = key !== tab;
    }
    document.querySelectorAll('.tabbar .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (window.location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  }
  document.querySelectorAll('.tabbar .tab').forEach((b) => {
    b.addEventListener('click', () => showTab(b.dataset.tab));
  });
  showTab((window.location.hash || '').replace('#', ''));


  // ---- walk-forward tab (DESIGN-WALKFORWARD.md) ------------------------------
  const wfViewEl = $('wf-view');
  const wfErrEl = $('wf-error');
  const m$wf = (v) => (v == null ? '—' : (v < 0 ? '-' : '+') + '$' + Math.abs(v).toFixed(2));

  function renderWalkforward(doc) {
    const running = doc.status === 'running';
    const header = `${esc(doc.id)} — ${esc(doc.status)}${doc.perf ? ` · ${doc.perf.unitsDone}/${doc.perf.unitsTotal} setups` : ''}`
      + (running && doc.perf && doc.perf.etaMs ? ` · ~${Math.round(doc.perf.etaMs / 60000)} min left` : '')
      + (doc.description ? ` · ${esc(doc.description)}` : '');
    const rows = (doc.wfRows || []).slice()
      .sort((x, y) => (y.holdMedian ?? -Infinity) - (x.holdMedian ?? -Infinity))
      .map((r, i) => {
        const pt = r.holdTrades ? r.holdTotal / r.holdTrades : null;
        return `<tr>
        <td>${i + 1}</td>
        <td><strong>${esc(r.trade)}</strong> ${esc(r.geometry)} ${esc(r.decision)}</td>
        <td>${r.foldsScored}/${r.foldsPlanned}</td>
        <td class="${(r.holdMedian ?? 0) >= 0 ? 'up' : 'down'}"><strong>${m$wf(r.holdMedian)}</strong>
          <div class="cellsub">${m$wf(r.iqrLo)} … ${m$wf(r.iqrHi)}</div></td>
        <td>${r.foldsPositive}/${r.foldsScored}</td>
        <td class="${(r.holdTotal ?? 0) >= 0 ? 'up' : 'down'}">${m$wf(r.holdTotal)}
          <div class="cellsub">${m$wf(r.holdTotal - (r.alwaysLongTotal || 0))} vs long</div></td>
        <td>${r.holdWins}/${r.holdTrades}<div class="cellsub">${m$wf(pt)}/t</div></td>
        <td>${r.detailFile ? `<button class="wf-detail" data-file="${esc(r.detailFile)}" data-label="${esc(r.trade)} ${esc(r.geometry)} ${esc(r.decision)}" title="Every fold of this setup: when, which settings were picked, and what the holdout slice paid">folds</button>` : '—'}</td>
      </tr>`;
      }).join('');
    return `<p class="note">${header}</p>
      <div class="section"><h2>Walk-forward board</h2>
      <p class="note"><strong>One row per setup; every number is HOLDOUT money</strong> — earned on 8-week
        slices the fold's settings never saw, summed or summarized across all folds.
        KEY — <em>folds</em>: holdout slices scored / planned (skips = thin data).
        <em>median fold $</em>: the middle fold's holdout money, per $100 book — the sort key, because a
        median cannot be carried by one lucky era; second line = the middle half's range (25th…75th
        percentile). <em>positive</em>: folds that made money. <em>total $</em>: summed across all folds —
        one coin's whole history, so unlike the retired boards this IS one setup's stitched record; second
        line = total minus always-going-long the same slices (the skill question). <em>W/T</em>: wins over
        trades, with money per trade under it.</p>
      <div class="tablewrap"><table>
        <tr><th title="Rank by median fold holdout money">#</th>
        <th title="coin · chunk shape · decision rule">setup</th>
        <th title="Holdout slices scored / planned. Skips mean thin data (gaps or a short history), never selection.">folds</th>
        <th title="The middle fold's holdout money per $100 book — the sort key. A median cannot be carried by one lucky era. Second line: 25th to 75th percentile fold.">median fold $</th>
        <th title="Folds whose holdout slice made money">positive</th>
        <th title="All folds' holdout money summed — this setup's stitched record over its whole history. Second line: the same total minus always-going-long the same slices; positive means the machinery beat doing nothing clever.">total $ <div class="cellsub">vs long</div></th>
        <th title="Holdout wins over trades across all folds; money per trade beneath">W/T</th>
        <th title="Per-fold detail">detail</th></tr>
        ${rows || '<tr><td colspan="8" class="note">no setups scored yet</td></tr>'}</table></div>
      <p class="note">Read with the standing cautions: totals across SETUPS still overlap (QC 36/47 —
        re-cuts of one coin are not independent), and nothing here has faced its noise comparison yet.</p>
      <div id="wf-detail-out"></div></div>`;
  }

  function renderWfDetail(d, label) {
    const rows = (d.folds || []).map((f) => f.skipped
      ? `<tr><td>${new Date(f.testStart).toISOString().slice(0, 10)}</td><td colspan="6" class="note">skipped — ${esc(f.skipped)}</td></tr>`
      : `<tr><td>${new Date(f.testStart).toISOString().slice(0, 10)}</td>
         <td>${esc(f.cell.entry)}/${esc(String(f.cell.gate ?? '-'))}/d${f.cell.dMult ?? '-'}/t${f.cell.tHours}h q${f.cell.quorum}</td>
         <td class="${f.testPnl >= 0 ? 'up' : 'down'}">${m$wf(f.testPnl)}</td>
         <td class="${f.holdPnl >= 0 ? 'up' : 'down'}"><strong>${m$wf(f.holdPnl)}</strong></td>
         <td>${f.holdWins}/${f.holdTrades}</td>
         <td class="${(f.holdPnl - (f.alwaysLong || 0)) >= 0 ? 'up' : 'down'}">${m$wf(f.holdPnl - (f.alwaysLong || 0))}</td>
         <td>${f.holdStops}${f.holdAmbiguous ? ` (${f.holdAmbiguous} amb)` : ''}</td></tr>`).join('');
    return `<h3>${esc(label)} — every fold</h3>
      <p class="note"><strong>Fold table.</strong> One row per fold, oldest first.
      KEY — <em>fold</em>: the test slice's start date. <em>picked settings</em>: entry/gate/stop distance/
      timeout/agreement level chosen on that fold's test slice. <em>test $</em>: what the pick made on the
      slice it was picked on (flattering by construction). <em>holdout $</em>: what it made on the next
      8 weeks, which it never saw — the honest column. <em>W/T</em>: holdout wins/trades.
      <em>vs long</em>: holdout money minus always-going-long the same slice. <em>stops</em>: holdout trades
      ended by the stop rail (amb = bars that spanned both rails, resolved against the book).</p>
      <div class="tablewrap"><table>
      <tr><th>fold</th><th>picked settings</th><th>test $</th><th>holdout $</th><th>W/T</th><th>vs long</th><th>stops</th></tr>
      ${rows}</table></div>`;
  }

  let wfCurrent = null;
  let wfTimer = null;
  async function refreshWalkforward() {
    try {
      wfErrEl.hidden = true;
      const list = await (await fetch('api/batches')).json();
      const ids = (list.batches || []).map((b) => b.id).filter((id) => String(id).startsWith('walkforward-'));
      if (!ids.length) { wfViewEl.innerHTML = '<p class="note">No walk-forward runs yet. Start one above.</p>'; return; }
      const doc = await (await fetch(`api/batch/${encodeURIComponent(ids[0])}`)).json();
      wfCurrent = doc.id;
      wfViewEl.innerHTML = renderWalkforward(doc);
      wfViewEl.querySelectorAll('.wf-detail').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const out = $('wf-detail-out');
          out.innerHTML = '<p class="note">reading fold detail…</p>';
          try {
            const r = await fetch(`api/walkforward/${encodeURIComponent(wfCurrent)}/unit?file=${encodeURIComponent(btn.dataset.file)}`);
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || r.status);
            out.innerHTML = renderWfDetail(d, btn.dataset.label);
            out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } catch (err) { out.innerHTML = `<p class="note">could not read folds: ${esc(err.message)}</p>`; }
        });
      });
      clearTimeout(wfTimer);
      if (doc.status === 'running') wfTimer = setTimeout(refreshWalkforward, 5000);
    } catch (err) { wfErrEl.hidden = false; wfErrEl.textContent = err.message; }
  }
  $('wf-start').addEventListener('click', async () => {
    try {
      wfErrEl.hidden = true;
      const uni = $('wf-universe').value.trim();
      const res = await fetch('api/walkforward', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          universe: uni ? uni.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) : undefined,
          permute: { geometry: $('wf-perm-geometry').checked, decision: $('wf-perm-decision').checked },
          minTradesSlice: Number($('wf-mintrades').value) || 5,
          description: $('wf-desc').value.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      refreshWalkforward();
    } catch (err) { wfErrEl.hidden = false; wfErrEl.textContent = err.message; }
  });
  $('wf-refresh').addEventListener('click', refreshWalkforward);
  refreshWalkforward();

  // ---- CPU throttle (semi-auto balancer pattern) -----------------------------

  const cpuBtn = $('cpu-btn');
  const CPU_STEPS = [100, 90, 75, 50, 25, 10, 0];
  let cpuPct = null;
  let cpuThreads = 1;

  function showCpu() {
    // The cap governs EACH worker's duty cycle, so the machine-wide draw is
    // threads x pct. Show the multiplier rather than quietly redefining the
    // number the owner has been reading for months.
    cpuBtn.textContent = cpuPct === null ? 'CPU …'
      : cpuPct <= 0 ? 'CPU OFF'
      : cpuThreads > 1 ? `CPU ${cpuPct}% ×${cpuThreads}` : `CPU ${cpuPct}%`;
  }
  async function loadCpu() {
    try {
      const body = await jsonBody(await fetch('api/cpu'));
      cpuPct = body.pct;
      cpuThreads = body.threads || 1;
    } catch {
      cpuPct = null;
    }
    showCpu();
  }
  cpuBtn.addEventListener('click', async () => {
    const idx = CPU_STEPS.indexOf(cpuPct);
    const next = CPU_STEPS[(idx + 1) % CPU_STEPS.length];
    try {
      const res = await fetch('api/cpu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pct: next }),
      });
      const body = await jsonBody(res);
      cpuPct = body.pct;
      cpuThreads = body.threads || cpuThreads;
    } catch {
      /* leave display as-is */
    }
    showCpu();
  });
  loadCpu();

  // ---- data state -------------------------------------------------------------

  const dataStateEl = $('data-state');

  async function refreshDataState() {
    try {
      const res = await fetch('api/data-state');
      const body = await jsonBody(res);
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (!body.symbols.length) {
        dataStateEl.innerHTML = '<p class="note">Nothing cached yet — Load Data will populate this.</p>';
        return;
      }
      const current = [$('trade').value.toUpperCase(), $('compare').value.toUpperCase()];
      dataStateEl.innerHTML = `
        <div class="tablewrap"><table>
          <tr><th>pair</th><th>months cached</th><th>from</th><th>to</th><th>≈ max rotations</th></tr>
          ${body.symbols.map((s) => `
            <tr class="${current.includes(s.symbol) ? 'hilite' : ''}">
              <td>${esc(s.symbol)}</td><td>${s.months}</td><td>${esc(s.from)}</td><td>${esc(s.to)}</td>
              <td>~${Math.max(0, Math.floor(s.months * 4.345) - 18)}</td>
            </tr>`).join('')}
        </table></div>
        <p class="note">Highlighted rows are the pairs currently selected above. Months cached on disk are never re-downloaded;
          newly published months are fetched automatically every 6 hours for every pair listed here.
          ≈ max rotations estimates the distinct null-shift ceiling from cached months (weeks − 16);
          the consensus "max" button computes it exactly for the pairs you enter.</p>`;
    } catch (err) {
      dataStateEl.innerHTML = `<p class="note">data state unavailable: ${esc(err.message)}</p>`;
    }
  }

  // ---- load / run -------------------------------------------------------------

  const loadBtn = $('load-btn');

  loadBtn.addEventListener('click', async () => {
    setError('');
    loadBtn.disabled = true;
    runBtn.disabled = true;
    setStatus('loading data…');
    try {
      const res = await fetch('api/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeSymbol: $('trade').value,
          compareSymbol: $('compare').value,
          startMonth: $('start').value,
          endMonth: $('end').value,
        }),
      });
      const body = await jsonBody(res);
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const result = await poll(body.jobId);
      const parts = Object.entries(result).map(([sym, s]) => {
        const missing = s.missingMonths.length ? `, no data for ${s.missingMonths.length} month(s)` : '';
        return `${sym}: ${s.candles.toLocaleString()} candles across ${s.monthsRequested - s.missingMonths.length}/${s.monthsRequested} months${missing}`;
      });
      setStatus('');
      statusEl.hidden = false;
      statusEl.textContent = `✓ Data loaded — ${parts.join(' · ')}`;
      refreshDataState();
    } catch (err) {
      setError(err.message);
      setStatus('');
    } finally {
      loadBtn.disabled = false;
      runBtn.disabled = false;
    }
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    setError('');
    reportEl.hidden = true;
    runBtn.disabled = true;
    loadBtn.disabled = true;
    setStatus('starting…');
    try {
      const res = await fetch('api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dormantPct: dormantValue(),
          tradeSymbol: $('trade').value,
          compareSymbol: $('compare').value,
          startMonth: $('start').value,
          endMonth: $('end').value,
          allLoaded: allLoadedChecked(),
          featureSet: $('features').value,
          model: $('model').value,
          featureView: pendingView || 'full',
          geometry: $('geometry').value,
          decision: $('decision').value,
          weekdaysOnly: $('weekdays').checked,
        }),
      });
      pendingView = null;
      const body = await jsonBody(res);
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const result = await poll(body.jobId);
      setStatus('');
      render(result);
      refreshDataState();
    } catch (err) {
      setError(err.message);
      setStatus('');
    } finally {
      runBtn.disabled = false;
      loadBtn.disabled = false;
    }
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MAX_POLL_FAILURES = 8; // transient 502/504s and network blips survive; ~30s of solid failure gives up

  // Polls a job to completion and RETURNS its result (callers render).
  // onStatus lets a caller route progress into its own status line.
  async function poll(jobId, onStatus = setStatus) {
    let failures = 0;
    for (;;) {
      let job;
      try {
        const res = await fetch(`api/jobs/${jobId}`);
        if (res.status === 404) {
          // The service restarted and forgot the job — retrying won't help.
          const body = await jsonBody(res).catch(() => ({}));
          throw Object.assign(new Error(body.error || 'the service restarted mid-run — run again'), { fatal: true });
        }
        job = await jsonBody(res);
        if (!res.ok) throw new Error(job.error || `HTTP ${res.status}`);
      } catch (err) {
        if (err.fatal || ++failures >= MAX_POLL_FAILURES) throw err;
        onStatus(`status check failed (${err.message}) — retrying ${failures}/${MAX_POLL_FAILURES}…`);
        await sleep(3000);
        continue;
      }
      failures = 0;
      if (job.status === 'running') {
        onStatus(job.progress || 'working…');
        await sleep(800);
        continue;
      }
      if (job.status === 'error') throw new Error(job.error);
      return job.result;
    }
  }

  function tile(label, value, sub, hero) {
    return `<div class="tile${hero ? ' hero' : ''}"><div class="label">${esc(label)}</div>` +
      `<div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  }

  function classCountsInline(counts) {
    return CLASSES.map((c) => `${clsSpan(c)}&thinsp;×${counts[String(c)]}`).join(' &nbsp; ');
  }

  function render(r) {
    const t = r.test;
    const daily = (r.params.geometry || 'weekly-8d') !== 'weekly-8d';
    const chunkWord = daily ? 'chunks' : 'weeks';
    const moveLabel = daily ? 'entry→exit move' : 'Tue→Thu move';
    const edgeVsMaj = t.accuracy - t.majorityBaseline;
    const verdict =
      edgeVsMaj > 0.05 && t.accuracy > t.randomBaseline
        ? `The model beat both baselines on the held-out weeks (+${pct(edgeVsMaj)} over always guessing the majority class) — evidence of real signal, worth a longer date range to confirm.`
        : t.accuracy > t.majorityBaseline
          ? 'The model edged past the majority-class baseline, but not by much — weak signal at best; try a longer range or different pairs.'
          : 'The model did NOT beat simply guessing the most common class — no usable correlation found in this configuration. That is an honest result, not a bug.';

    const missingNotes = Object.entries(r.data.missingMonths)
      .filter(([, arr]) => arr.length)
      .map(([sym, arr]) => `${esc(sym)} had no data for: ${arr.map(esc).join(', ')}`);

    const maxCell = Math.max(1, ...CLASSES.map((a) => Math.max(...CLASSES.map((p) => t.confusion[a][p]))));
    const heat = (n) => {
      const q = n / maxCell;
      const bg = q === 0 ? 'transparent' : q < 0.34 ? 'var(--seq-100)' : q < 0.67 ? 'var(--seq-250)' : 'var(--seq-450)';
      const fg = q >= 0.67 ? '#fff' : 'var(--ink)';
      return `<span class="cellwrap" style="background:${bg};color:${fg}">${n}</span>`;
    };

    reportEl.innerHTML = `
      <div class="section">
        <h2>Out-of-sample result &mdash; ${esc(r.split.test.from)} to ${esc(r.split.test.to)}</h2>
        <div class="tiles">
          ${tile('Test accuracy', pct(t.accuracy), `${r.split.test.count} held-out ${chunkWord}`, true)}
          ${tile('Majority baseline', pct(t.majorityBaseline), `always guess ${clsName(t.majorityClass)}`)}
          ${tile('Random baseline', pct(t.randomBaseline), '3 classes')}
          ${t.paper ? tile('Paper P&L', money(t.paper.pnl), `${t.paper.trades} trades, ${t.paper.wins} wins, $1/trip fees${t.paper.unpriced ? `, ${t.paper.unpriced} unpriced` : ''}`) : ''}
          ${tile(daily ? 'Training chunks' : 'Training weeks', String(r.split.train.count), `${esc(r.split.train.from)} → ${esc(r.split.train.to)}`)}
        </div>
        <div class="verdict">${verdict}</div>
      </div>

      <div class="section">
        <h2>Data</h2>
        <div class="tiles">
          ${tile(`${esc(r.params.tradeSymbol)} candles`, r.data.candles[r.params.tradeSymbol].toLocaleString(), `${r.data.gapFills[r.params.tradeSymbol]} gap-filled`)}
          ${tile(`${esc(r.params.compareSymbol)} candles`, r.data.candles[r.params.compareSymbol].toLocaleString(), `${r.data.gapFills[r.params.compareSymbol]} gap-filled`)}
          ${tile('Labelable chunks', String(r.data.chunks), `${r.data.dropped.gap} dropped (gaps), ${r.data.dropped.noLabel} without label data`)}
          ${tile('Features / chunk', r.data.featureCount.toLocaleString(), r.params.featureSet === 'raw' ? 'raw: 192h × 5 fields × 2 pairs' : 'compressed (engineered)')}
        </div>
        <p class="note">
          Dormant band: ${r.data.adaptiveBand
            ? `<strong>auto &rarr; &plusmn;${r.data.dormantBandPct.toFixed(2)}%</strong> (33rd percentile of |Tue&rarr;Thu move|, calibrated on training weeks only)`
            : `&plusmn;${esc(String(r.params.dormantPct))}%`}.
          Score distribution (all chunks): ${classCountsInline(r.data.classCounts)}
          &nbsp;&middot;&nbsp; train: ${classCountsInline(r.split.train.classCounts)}
          &nbsp;&middot;&nbsp; test: ${classCountsInline(r.split.test.classCounts)}
          ${missingNotes.length ? '<br>' + missingNotes.join('<br>') : ''}
        </p>
      </div>

      ${r.tuning.model === 'boost' ? `
      <div class="section">
        <h2>Boosting rounds (validation = last ${r.tuning.valSize} training weeks)</h2>
        <div class="tiles">
          ${tile('Rounds chosen', String(r.tuning.bestRound), 'early stopping on validation log-loss')}
          ${tile('Validation accuracy', pct(r.tuning.valAcc), 'at the chosen round count')}
          ${tile('Validation majority ref', pct(r.tuning.valMajorityAcc), 'always guessing the training majority')}
          ${tile('Training accuracy', pct(r.final.trainAcc), 'final model, full training window')}
        </div>
        <p class="note">Rounds are a real quality knob for boosting, so they are tuned automatically: train on the older
          three-quarters of the training window, watch log-loss on the newest quarter, keep the best round count.
          A validation accuracy at or below the majority reference means the model found nothing the prior didn't know.</p>
      </div>` : `
      <div class="section">
        <h2>Regularization ladder (validation = last ${r.tuning.valSize} training weeks)</h2>
        <div class="tablewrap"><table>
          <tr><th>&lambda;</th><th>validation accuracy</th><th>iterations</th><th>converged</th></tr>
          ${r.tuning.ladder.map((row) => `
            <tr>
              <td class="${row.lambda === r.tuning.chosenLambda ? 'chosen' : ''}">${row.lambda}${row.lambda === r.tuning.chosenLambda ? ' ← chosen' : ''}</td>
              <td>${pct(row.valAcc)}</td><td>${row.iters}</td><td>${row.converged ? 'yes' : 'NO (hit cap)'}</td>
            </tr>`).join('')}
        </table></div>
        <p class="note">Reference: always guessing the training-majority class scores <strong>${pct(r.tuning.valMajorityAcc)}</strong>
          on these validation weeks — ladder rows at or below that are the model converging to the prior, not finding signal.
          The ladder auto-extends when the top &lambda; wins, so a chosen &lambda; is always an interior optimum.
          Final model: retrained on all ${r.split.train.count} training weeks at &lambda;=${r.tuning.chosenLambda};
          converged ${r.final.converged ? `after ${r.final.iters} iterations` : `— NO, hit the iteration cap at ${r.final.iters}`};
          training accuracy ${pct(r.final.trainAcc)}.</p>
      </div>`}

      ${r.tuning.tau != null ? `
      <div class="section">
        <h2>Directional hunter — threshold tuned by validation paper P&amp;L</h2>
        <div class="tiles">
          ${tile('Chosen τ', String(r.tuning.tau), r.tuning.tau === 0 ? 'always in — trade every period, direction only' : 'stand aside below this directional probability', true)}
          ${tile('Class weights', CLASSES.map((c) => `${clsName(c)}&thinsp;×${(r.tuning.classWeights[String(c)] ?? 1).toFixed(2)}`).join(' '), 'training loss multipliers (balanced on training counts)')}
        </div>
        <div class="tablewrap"><table>
          <tr><th>τ</th><th>validation P&amp;L</th><th>trades</th></tr>
          ${r.tuning.tauLadder.map((row) => `
            <tr>
              <td class="${row.tau === r.tuning.tau ? 'chosen' : ''}">${row.tau}${row.tau === r.tuning.tau ? ' ← chosen' : ''}</td>
              <td>${money(row.pnl)}</td><td>${row.trades}</td>
            </tr>`).join('')}
        </table></div>
        <p class="note">The action compares P(+1) vs P(−1) only — 0 is never "predicted", it's what happens when the winning
          direction lacks confidence (or the probabilities tie). τ comes from a fixed menu scored by paper P&amp;L on the
          validation tail; the test window never influences it. With wide dormant bands this is the honest setup: the
          model is trained to hunt the rare big movers, and dollars — not accuracy — pick how trigger-happy to be.</p>
      </div>` : ''}

      ${r.final.topWeights ? `
      <div class="section">
        <h2>What the model leaned on (top ${r.final.topWeights.length} of ${r.data.featureCount} features by |weight|)</h2>
        <div class="tablewrap"><table>
          <tr><th>feature</th><th>w(−1)</th><th>w(0)</th><th>w(+1)</th></tr>
          ${r.final.topWeights.map((m) => `
            <tr><td>${esc(m.name)}</td>
              <td>${m.weights['-1'].toFixed(3)}</td><td>${m.weights['0'].toFixed(3)}</td><td>${m.weights['1'].toFixed(3)}</td></tr>`).join('')}
        </table></div>
        <p class="note">Weights are on standardized features, so magnitudes are comparable; a positive weight pushes toward that class when the feature is above its training average. Only trust these if the test accuracy itself beats the baselines.</p>
      </div>` : ''}
      ${r.final.importance ? `
      <div class="section">
        <h2>What the model leaned on (split-gain share, top ${r.final.importance.length} of ${r.data.featureCount})</h2>
        <div class="tablewrap"><table>
          <tr><th>feature</th><th>gain share</th></tr>
          ${r.final.importance.map((m) => `<tr><td>${esc(m.name)}</td><td>${pct(m.share)}</td></tr>`).join('')}
        </table></div>
        <p class="note">Share of total split gain across all boosted trees. Only trust these if the test accuracy itself beats the baselines.</p>
      </div>` : ''}

      <div class="section">
        <h2>Confusion matrix (rows = actual, columns = predicted)</h2>
        <div class="tablewrap"><table class="confusion">
          <tr><th>actual \\ predicted</th>${CLASSES.map((c) => `<th>${clsName(c)}</th>`).join('')}</tr>
          ${CLASSES.map((a) => `<tr><td>${clsSpan(a)}</td>${CLASSES.map((p) => `<td class="count">${heat(t.confusion[a][p])}</td>`).join('')}</tr>`).join('')}
        </table></div>
      </div>

      <div class="section">
        <h2>Per-class metrics</h2>
        <div class="tablewrap"><table>
          <tr><th>class</th><th>test weeks</th><th>precision</th><th>recall</th><th>F1</th></tr>
          ${t.perClass.map((m) => `<tr><td>${clsSpan(m.class)}</td><td>${m.support}</td><td>${pct(m.precision)}</td><td>${pct(m.recall)}</td><td>${pct(m.f1)}</td></tr>`).join('')}
        </table></div>
      </div>

      <div class="section">
        <h2>Held-out ${chunkWord}, one by one</h2>
        <div class="tablewrap"><table>
          <tr><th>${daily ? 'chunk start' : 'week (Mon)'}</th><th>actual</th><th>predicted</th><th>P(−1)</th><th>P(0)</th><th>P(+1)</th><th>${esc(moveLabel)}</th><th title="One-shot $100 paper trade at this geometry's own entry/exit candles; $0.00 = stood aside; — = entry/exit candle missing.">paper P&amp;L</th></tr>
          ${t.rows.map((row) => `
            <tr class="${row.actual === row.predicted ? '' : 'miss'}">
              <td>${esc(row.weekStart)}</td>
              <td>${clsSpan(row.actual)}</td>
              <td>${clsSpan(row.predicted)}</td>
              <td>${pct(row.probs['-1'], 0)}</td><td>${pct(row.probs['0'], 0)}</td><td>${pct(row.probs['1'], 0)}</td>
              <td><span class="cls ${row.diffPct > 0 ? 'up' : row.diffPct < 0 ? 'down' : 'flat'}">${row.diffPct >= 0 ? '+' : ''}${row.diffPct.toFixed(2)}%</span></td>
              <td>${row.paperPnl != null ? money(row.paperPnl) : '—'}</td>
            </tr>`).join('')}
        </table></div>
        <p class="note">Shaded rows are misses. Probabilities are the model's own confidence — well-calibrated only if there's real signal.
          Paper P&amp;L uses the tracker's exact economics; the total is dominated by a few big-move weeks, so treat it as the dollars reality-check, not the ranking metric.</p>
      </div>`;
    reportEl.hidden = false;
  }

  // ---- pair-screen batch UI --------------------------------------------------

  const batchStatusEl = $('batch-status');
  const batchErrorEl = $('batch-error');
  const batchViewEl = $('batch-view');
  let batchTimer = null;

  function setBatchStatus(text) {
    batchStatusEl.hidden = !text;
    batchStatusEl.innerHTML = text ? `<span class="spin">⟳</span>${esc(text)}` : '';
  }

  function renderBatch(doc) {
    const s = doc.summary;
    const range = doc.params.allLoaded ? 'all loaded data' : `${esc(doc.params.startMonth)}→${esc(doc.params.endMonth)}`;
    const header = `${esc(doc.id)} — ${esc(doc.status)}${doc.status === 'running' && doc.progress ? ` — ${esc(doc.progress)}` : ''}
      · ${doc.runs.filter((r) => r.status === 'done' || r.status === 'error').length}/${doc.runs.length} runs
      · dormant ±${esc(String(doc.params.dormantPct))}% · ${range} · ${esc(doc.params.geometry || 'weekly-8d')}${doc.params.weekdaysOnly ? ' · 24/5' : ''}${doc.params.decision === 'directional' ? ' · directional hunter' : ''} · vs ${esc(doc.params.compareSymbol)}`;
    if (doc.kind === 'bracketlab') {
      batchViewEl.innerHTML = `<p class="note">${header}</p><p class="note">This is a Bracket lab sweep — view it on the <strong>Bracket lab</strong> tab.</p>`;
      return;
    }
    if (doc.kind === 'permscreen') {
      renderPermScreen(doc, header);
      return;
    }
    if (s && s.kind === 'metalens') {
      renderMetalens(doc, s, header);
      return;
    }
    if (!s || !s.ranked.length) {
      batchViewEl.innerHTML = `<p class="note">${header}</p><p class="note">No completed runs yet.</p>`;
      return;
    }
    const T = {
      pair: 'The trade asset — each is tested against the compare pair (BTCUSDT).',
      specs: 'How many of the 8 method permutations (4 feature views × 2 models) completed for this pair.',
      posEdge: 'How many of the specs beat their best-constant baseline (true edge > 0).',
      consensus: 'positive ÷ specs done. The pair’s headline agreement score across methods.',
      medEdge: 'Middle value of the specs’ true edges — the TYPICAL spec’s margin, immune to one lucky or one broken spec.',
      medBal: 'Middle value of the specs’ balanced accuracies. Chance = 33.3% whatever the class mix, so distance above 33.3% = real sorting skill.',
      medPaper: 'Middle value of the 8 specs’ one-shot $100 paper books over the test window (this geometry’s own entry/exit candles, $1 round trip) — the TYPICAL spec’s dollars, never the luckiest cell’s. (+N) = how many specs finished positive. Robustness check; the vote book to the right is the tradable number.',
      votePnl: 'The tradable number: each test period the 8 specs VOTE (majority wins, any tie stands aside — the live tracker’s exact rule) and the vote trades one $100 order at this geometry’s entry/exit candles at research friction ($0.25 round trip since 2026-07-26; older screens $1). This is what the consensus strategy would actually have made over the test window. (W/T) = wins/trades. Click "trades" for the period-by-period history.',
      voteAcc: 'Share of test periods where the vote matched the realized class, with (edge) = vote accuracy − the best constant hindsight guess. Stand-asides count as calls of 0.',
      nullVote: 'Share of label-shifted reruns whose VOTE BOOK made at least as many dollars as the real one — the dollars version of the exceed rate. Small is good; the consensus-fraction exceed rate stays the primary test.',
      superPnl: 'The fee-fighter: trades ONLY when 6+ of the 8 specs call the SAME direction (plurality doesn’t count — 5 up vs 3 down stands aside). Fewer trades, each backed by broad cross-method agreement, so less of any real edge goes to the $1 round trips. Same $100 economics and friction as the vote book.',
      superAcc: 'Share of test periods where the 6-of-8 gate call matched the realized class, with (edge) = accuracy − best constant hindsight guess. Stand-asides count as calls of 0, so a rarely-firing gate scores near the dormant share.',
      nullSuper: 'Share of label-shifted reruns whose 6-of-8 gate book made at least as many dollars as the real one. The gate’s own noise floor — judge the gate against this, not against the vote’s.',
      nullMed: 'Consensus the same grid typically fabricates when labels are time-shifted (nothing real to find) — the machine’s noise floor.',
      nullExceed: 'Share of distinct label-shifted reruns whose consensus matched or beat the real one. Empirical p-value: 0% = noise never faked this well.',
      rank: 'Rank, best first by true edge.',
      detail: 'Loads this combo into the form above and runs the full detailed report.',
      model: 'The learner: logreg = linear (flat decision planes), boost = small trees (thresholds + interactions).',
      view: 'Feature slice used: full 44 / prices-only / volume-only / cross-asset-only.',
      band: 'Dormant band for this pair. auto = 33rd percentile of its own training-week |Tue→Thu| moves, so classes balance.',
      testAcc: 'Percentage of held-out test weeks where the predicted −1/0/+1 matched what actually happened.',
      bestConst: 'Plain accuracy of always guessing the test window’s most common class (in hindsight) — the toughest do-nothing competitor.',
      trueEdge: 'test acc − best constant. Positive = beat the smartest lazy strategy.',
      balAcc: 'Average of the three per-class hit rates. 33.3% = chance for ANY know-nothing strategy, regardless of class mix.',
      dirCalls: 'Weeks this spec dared a directional (±1) call instead of standing aside.',
      dirHit: 'Fraction of those directional calls that were right — the would-it-have-traded-well column.',
      trainAcc: 'Accuracy on its own training weeks. Far above test acc = memorization; close to test acc = honest fit.',
      weeks: 'Training / test week counts — the sample sizes behind every other number.',
      picked: 'Auto-tuned hyperparameter: λ (regularization strength) for logreg, boosting rounds for boost. Extreme λ ≈ shrank toward predicting the prior.',
      paperPnl: 'One-shot $100 paper book over this spec’s test weeks, research friction ($0.25 round trip since 2026-07-26; screens before that used $1). Color metric: a handful of big-move weeks dominate it — rank by true edge, use this as the dollars reality-check.',
      paperWT: 'Paper wins / trades: directional (±1) calls only; wins closed positive after fees.',
    };
    const th = (label, tip) => `<th title="${esc(tip)}">${label}</th>`;
    const fmtE = (e) => (e == null ? '—' : (e >= 0 ? '+' : '') + (100 * e).toFixed(1) + '%');
    // Exact upper-tail binomial P(X >= k | n, p) — n <= 17 here, so a direct
    // sum is fine and avoids any approximation in a reported p-value.
    const binomTail = (k, n, p) => {
      const c = (nn, ii) => {
        let r = 1;
        for (let j = 0; j < ii; j++) r = (r * (nn - j)) / (j + 1);
        return r;
      };
      let s = 0;
      for (let i = k; i <= n; i++) s += c(n, i) * Math.pow(p, i) * Math.pow(1 - p, n - i);
      return s;
    };
    // The conviction hypothesis, tested by REPLICATION across pairs rather
    // than by a tighter p-value on any one of them. Both statistics are
    // computed automatically and stated before the per-pair tables, so the
    // test cannot be swapped for a friendlier one after the data is seen.
    const withLadder = s.kind === 'consensus' && s.pairs ? s.pairs.filter((p) => p.gateLadder) : [];
    const gradientSummary = withLadder.length < 2 ? '' : (() => {
      const wr = (g) => (g && g.trades ? g.wins / g.trades : null);
      let rising = 0;
      let comparable = 0;
      let monotone = 0;
      for (const p of withLadder) {
        const w = GATE_Q.map((q) => wr(p.gateLadder[q]));
        if (w[0] != null && w[3] != null) {
          comparable++;
          if (w[3] > w[0]) rising++;
        }
        if (w.every((v) => v != null) && w[1] > w[0] && w[2] > w[1] && w[3] > w[2]) monotone++;
      }
      const pSign = comparable ? binomTail(rising, comparable, 0.5) : null;
      // Chance rate for a strictly monotone gradient is 1/8, NOT 1/24. The
      // four rungs are NESTED cumulative subsets (every q8 trade is also a
      // q7/q6/q5 trade), so w5<w6 holds exactly when the "exactly 5" stratum
      // sits below the average of the strata above it — a coin flip — and the
      // same for the other two steps. Each stratum appears in only one of the
      // three conditions, so the flips are independent: (1/2)^3 = 1/8.
      // The 1/24 figure treats the rungs as independent orderings and
      // understates the null by ~3x; it reported p=0.0046 where the correct
      // value is p=0.154 on this screen.
      const MONO_CHANCE = 1 / 8;
      const pMono = withLadder.length ? binomTail(monotone, withLadder.length, MONO_CHANCE) : null;
      const verdict = pSign != null && pSign < 0.05
        ? 'The gradient replicates across pairs — evidence that agreement tracks edge as a general mechanism, not a DOGE artifact.'
        : pSign != null && pSign < 0.2
          ? 'Leaning the right way but short of significance — suggestive, not established.'
          : 'No replication: agreement does not track edge across pairs, and the single-pair gradient should be treated as an artifact of that window.';
      // Compact verification matrix: one row per pair, win rate at each rung
      // with its trade count, plus why a pair was excluded. Deliberately
      // carries NO P&L — this table exists to audit the counts above, not to
      // shop for a candidate.
      const matrix = `<div class="tablewrap" style="margin:8px 0"><table>
        <tr><th>pair</th>${GATE_Q.map((q) => `<th title="win rate (trades) at ${q}-of-8 agreement">${q}/8</th>`).join('')}<th>q8&gt;q5</th><th>monotone</th></tr>
        ${withLadder.map((p) => {
          const w = GATE_Q.map((q) => wr(p.gateLadder[q]));
          const cmp = w[0] != null && w[3] != null ? (w[3] > w[0] ? 'yes' : 'no') : '— (no trades)';
          const mono = w.every((v) => v != null) && w[1] > w[0] && w[2] > w[1] && w[3] > w[2] ? 'yes' : 'no';
          return `<tr><td>${esc(p.trade)}</td>${GATE_Q.map((q, i) => {
            const g = p.gateLadder[q];
            return `<td>${w[i] == null ? '—' : pct(w[i])} <span class="note">(${g ? g.trades : 0})</span></td>`;
          }).join('')}<td>${cmp}</td><td>${mono}</td></tr>`;
        }).join('')}
      </table></div>`;
      return `<div class="warnbox" style="margin-bottom:12px">
        <strong>Conviction hypothesis — replication test (pre-registered, gradient only)</strong><br>
        Win rate rises from 5-of-8 to unanimous in <strong>${rising} of ${comparable}</strong> pairs
        (chance = 50%, binomial p = <strong>${pSign == null ? '—' : pSign.toFixed(4)}</strong>).<br>
        Strictly monotone across all four rungs in <strong>${monotone} of ${withLadder.length}</strong> pairs
        (chance = 1 in 8 — the rungs are nested subsets, not independent orderings — expected
        ${(withLadder.length * MONO_CHANCE).toFixed(1)}, binomial p =
        <strong>${pMono == null ? '—' : pMono.toFixed(4)}</strong>).<br>
        ${esc(verdict)}
        ${matrix}
        <em>These two numbers are the whole result of this screen; the matrix exists to audit them, which is why
        it carries no P&amp;L. Reading the per-pair tables below for a new candidate spends 17 more looks and
        worsens every p-value in the project.</em>
      </div>`;
    })();
    const voteHist = (pair) => {
      const rows = doc.votes && doc.votes[pair] && doc.votes[pair].real && doc.votes[pair].real.rows;
      if (!rows) return '<p class="note">No vote trade rows stored for this pair (older screen?).</p>';
      const hasSuper = rows.some((r) => r.sup !== undefined);
      return `<div class="tablewrap" style="margin:6px 0 4px"><table>
        <tr><th>period start</th><th>vote</th>${hasSuper ? '<th title="6-of-8 supermajority gate call">super 6/8</th>' : ''}<th>actual</th><th>entry</th><th>exit</th><th>vote P&amp;L</th>${hasSuper ? '<th>super P&amp;L</th>' : ''}</tr>
        ${rows.map((r) => `
          <tr class="${r.vote !== 0 && r.pnl != null && r.pnl <= 0 ? 'miss' : ''}">
            <td>${esc(r.week)}</td><td>${clsSpan(r.vote)}</td>${hasSuper ? `<td>${clsSpan(r.sup)}</td>` : ''}<td>${clsSpan(r.actual)}</td>
            <td>${r.entry != null ? r.entry : '—'}</td><td>${r.exit != null ? r.exit : '—'}</td>
            <td>${r.pnl != null ? money(r.pnl) : '—'}</td>${hasSuper ? `<td>${r.supPnl != null ? money(r.supPnl) : '—'}</td>` : ''}
          </tr>`).join('')}
      </table></div>`;
    };
    const consensusBlock = s.kind === 'consensus' && s.pairs ? `
      <div class="tablewrap" style="margin-bottom:12px"><table>
        <tr>${th('pair', T.pair)}${th('specs done', T.specs)}${th('positive true edge', T.posEdge)}${th('consensus', T.consensus)}${th('median true edge', T.medEdge)}${th('median balanced acc', T.medBal)}${th('median paper P&amp;L', T.medPaper)}${th('vote P&amp;L (W/T)', T.votePnl)}${th('vote acc (edge)', T.voteAcc)}${th('super 6/8 P&amp;L (W/T)', T.superPnl)}${th('super acc (edge)', T.superAcc)}${th('null: median consensus', T.nullMed)}${th('null: exceed rate', T.nullExceed)}${th('null: vote exceed', T.nullVote)}${th('null: super exceed', T.nullSuper)}</tr>
        ${s.pairs.map((p) => `
          <tr class="${p.fraction >= 0.625 && (p.medianTrueEdge ?? 0) > 0 ? 'hilite' : ''}">
            <td>${esc(p.trade)}</td><td>${p.specs}</td><td>${p.positive}</td>
            <td><strong>${pct(p.fraction, 0)}</strong></td>
            <td>${fmtE(p.medianTrueEdge)}</td>
            <td>${pct(p.medianBalancedAcc)}</td>
            <td>${p.medianPaperPnl != null ? `${money(p.medianPaperPnl)} (+${p.positivePaper})` : '—'}</td>
            <td class="nowrap">${p.vote
              ? `<strong>${money(p.vote.pnl)}</strong> (${p.vote.wins}/${p.vote.trades})
                 <button type="button" class="rowload votetrades" data-pair="${esc(p.trade)}">trades</button>${p.vote.specsInVote < 8 ? ` <span title="only ${p.vote.specsInVote} of 8 specs completed">⚠${p.vote.specsInVote}/8</span>` : ''}`
              : '—'}</td>
            <td>${p.vote ? `${pct(p.vote.acc)} (${fmtE(p.vote.trueEdge)})` : '—'}</td>
            <td class="nowrap">${p.superVote ? `<strong>${money(p.superVote.pnl)}</strong> (${p.superVote.wins}/${p.superVote.trades})` : '—'}</td>
            <td>${p.superVote ? `${pct(p.superVote.acc)} (${fmtE(p.superVote.trueEdge)})` : '—'}</td>
            <td>${p.null ? pct(p.null.medianNullFraction, 0) : '—'}</td>
            <td>${p.null ? `${pct(p.null.exceedRate, 0)} of ${p.null.shifts} shifts` : '—'}</td>
            <td${p.nullVote ? ` title="Null vote books: median ${money(p.nullVote.medianPnl)} on ${p.nullVote.medianTrades ?? '?'} trades (real: ${money(p.vote.pnl)} on ${p.vote.trades}). Similar trade counts mean the real book's TRADES were better; far fewer null trades would mean the real book simply acted more often."` : ''}>${p.nullVote ? `${pct(p.nullVote.exceedPnl, 0)} of ${p.nullVote.shifts}` : '—'}</td>
            <td${p.nullVote && p.nullVote.superMedianPnl != null ? ` title="Null 6/8 gate books: median ${money(p.nullVote.superMedianPnl)} on ${p.nullVote.superMedianTrades ?? '?'} trades (real: ${money(p.superVote.pnl)} on ${p.superVote.trades}). If noise-trained specs rarely reach 6-of-8, the null gate fires far less often than the real one — that is a different (and stronger) finding than the real gate simply picking better trades."` : ''}>${p.nullVote && p.nullVote.superExceedPnl != null ? `${pct(p.nullVote.superExceedPnl, 0)} of ${p.nullVote.superShifts}` : '—'}</td>
          </tr>
          <tr class="votehist" data-pair="${esc(p.trade)}" hidden><td colspan="15">${'' /* filled on toggle */}</td></tr>`).join('')}
      </table></div>
      ${gradientSummary}
      ${s.pairs.filter((p) => p.gateLadder).map((p) => {
        const nv = p.nullVote || {};
        const trip = 2 * (doc.params.feePerLeg ?? 0.5); // round trip at this screen's recorded rate
        const rung = (q) => {
          const g = p.gateLadder[q];
          if (!g) return '';
          const gross = g.pnl + g.trades * trip;
          const per = g.trades ? gross / g.trades : null;
          return `<tr class="${q === 6 ? 'hilite' : ''}">
            <td class="nowrap">${q} of 8${q === 6 ? ' <strong>← pre-registered</strong>' : ''}</td>
            <td>${g.trades}</td>
            <td>${money(g.pnl)}</td>
            <td>${money(gross)}</td>
            <td><strong>${per == null ? '—' : '$' + per.toFixed(2)}</strong></td>
            <td>${g.trades ? pct(g.wins / g.trades) : '—'}</td>
            <td>${nv.gateExceed && nv.gateExceed[q] != null ? `${pct(nv.gateExceed[q], 0)} of ${nv.gateShifts}` : '—'}</td>
          </tr>`;
        };
        return `<div class="tablewrap" style="margin-bottom:12px"><table>
          <tr><th colspan="7">${esc(p.trade)} — agreement gradient (diagnostic, NOT a menu)</th></tr>
          <tr>
            <th title="How many of the 8 specs must call the SAME direction before the book trades. An absolute count: 5 up vs 3 down does not clear 6.">quorum</th>
            <th title="Periods this rung actually traded.">trades</th>
            <th title="Net paper P&amp;L after $1.00 round-trip friction.">net</th>
            <th title="P&amp;L before friction — net plus $1 per trade. This is the raw directional edge the rung captured.">gross</th>
            <th title="Gross ÷ trades. THE number for this table: if conviction correlates with edge it should rise monotonically as the quorum tightens, regardless of what net dollars do.">gross/trade</th>
            <th title="Share of this rung's trades that closed positive after fees.">win rate</th>
            <th title="Share of label-shifted reruns whose book at THIS quorum made at least as many dollars. Each rung is judged against its own noise floor.">null exceed</th>
          </tr>
          ${GATE_Q.map(rung).join('')}
        </table></div>
        <p class="note">Read the <strong>gross/trade</strong> column, not the net column. A monotone rise as the quorum
          tightens is the claim being tested — that agreement across methods tracks real edge — and it is much harder
          for noise to fake than any single rung's dollars. Net dollars are expected to peak somewhere in the middle
          and fall at the tight end, because volume drops faster than per-trade edge rises. The decision rule remains
          <strong>6 of 8</strong>, fixed in advance; the other rungs are evidence about the hypothesis, not candidates
          to adopt. Picking the best-looking rung after the fact is a 4-way search and would cost a 4&times; correction
          on its p-value.</p>`;
      }).join('')}
      <p class="note">Consensus = share of the pair's specs (4 views × 2 models) with positive true edge. Highlighted rows:
        ≥5/8 specs positive with positive median. Vote P&amp;L simulates the actual consensus strategy — the tracker's
        majority-vote rule trading $100 per period; super 6/8 is the conviction gate, trading only on 6+ same-direction
        specs (fewer trades, less fee drag). The medians are robustness checks. Null exceed rates ≈ p-values: the share
        of label-shifted reruns that matched or beat the real run on consensus fraction (primary), vote dollars, or gate
        dollars — small is good, and anything above ~10% means noise does this routinely. Per-spec detail below covers
        the real (unshifted) runs.</p>` : '';
    const maxTestWeeks = Math.max(...s.ranked.map((r) => r.testWeeks || 0));
    const weakWarning = maxTestWeeks < 20
      ? `<div class="warnbox">⚠ <strong>Statistically weak screen:</strong> only ${maxTestWeeks} test weeks per combo —
         each week is worth ${(100 / maxTestWeeks).toFixed(0)} points of accuracy, so every edge in this table is
         within luck's reach. Widen the month range (the batch uses the form's months) and re-run before believing anything here.</div>`
      : '';
    batchViewEl.innerHTML = `
      <p class="note">${header}${s.positiveEdge != null ? ` · ${s.positiveEdge} of ${s.done} completed combos beat their baseline` : ''}</p>
      ${weakWarning}
      ${consensusBlock}
      <div class="tablewrap"><table>
        <tr>${th('#', T.rank + ' ' + T.detail)}${th('trade', T.pair)}${th('model', T.model)}${th('view', T.view)}${th('band', T.band)}${th('test acc', T.testAcc)}${th('best const', T.bestConst)}${th('true edge', T.trueEdge)}${th('bal acc', T.balAcc)}${th('dir hits/calls', T.dirHit + ' ' + T.dirCalls)}${th('paper P&amp;L (W/T)', T.paperPnl + ' ' + T.paperWT)}${th('train acc', T.trainAcc)}${th('wks tr/te', T.weeks)}${th('picked', T.picked)}</tr>
        ${s.ranked.map((r, i) => {
          const te = r.hindsightEdge != null ? r.hindsightEdge : r.edge;
          const bc = r.bestConstant != null ? pct(r.bestConstant) : `${pct(r.majorityBaseline)} (${clsName(r.majorityClass)})`;
          return `
          <tr class="${te > 0 ? '' : 'miss'}">
            <td class="nowrap">${i + 1} <button type="button" class="rowload" data-i="${i}" title="Load this combo into the form above and run the full detailed report">detail</button></td>
            <td>${esc(r.trade)}</td><td>${esc(r.model)}</td>
            <td>${esc(r.view || 'full')}</td>
            <td>${r.bandPct != null ? '±' + Number(r.bandPct).toFixed(2) + '%' : '—'}</td>
            <td>${pct(r.testAcc)}</td><td>${bc}</td>
            <td><strong>${te >= 0 ? '+' : ''}${(100 * te).toFixed(1)}%</strong></td>
            <td>${pct(r.balancedAcc)}</td>
            <td>${r.directionalHits}/${r.directionalCalls}${r.directionalHitRate != null ? ` (${pct(r.directionalHitRate, 0)})` : ''}</td>
            <td>${r.paperPnl != null ? `${money(r.paperPnl)} (${r.paperWins}/${r.paperTrades})` : '—'}</td>
            <td>${pct(r.trainAcc)}</td><td>${r.trainWeeks}/${r.testWeeks}</td><td>${esc(r.chosen)}</td>
          </tr>`;
        }).join('')}
      </table></div>
      ${s.failed.length ? `<p class="note">Failed: ${s.failed.map((f) => `${esc(f.trade)}/${esc(f.model)} (${esc(f.error)})`).join(' · ')}</p>` : ''}
      <p class="note">True edge = test accuracy − the best CONSTANT guess in hindsight (the toughest prior-only competitor —
        immune to train/test distribution drift, unlike the train-majority baseline). Rows shaded red have no true edge.
        Dir hit rate = accuracy of the non-dormant (±1) calls only. Sorted best-first. "detail" shuttles the combo into
        the form above and runs the full report.</p>`;

    batchViewEl.querySelectorAll('.rowload[data-i]').forEach((btn) => {
      btn.addEventListener('click', () => shuttleToForm(doc, s.ranked[Number(btn.dataset.i)]));
    });
    batchViewEl.querySelectorAll('.votetrades').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = batchViewEl.querySelector(`.votehist[data-pair="${btn.dataset.pair}"]`);
        if (!row) return;
        if (row.hidden) {
          row.firstElementChild.innerHTML = voteHist(btn.dataset.pair);
          row.hidden = false;
        } else {
          row.hidden = true;
        }
      });
    });
  }

  // Permutation screen: the staged pick workflow. Stage 1 renders every
  // pair's 16 distinct members (8 specs × 2 training regimes, labeled with
  // the protocol permutations each represents); the owner then checkboxes an
  // asset, a member subset, reads the net-direction quorum menu, checkboxes
  // rungs, and fires the null test on the frozen selection. All selections
  // persist server-side.
  async function permPost(id, path, body) {
    batchErrorEl.hidden = true;
    try {
      const res = await fetch(`api/permscreen/${encodeURIComponent(id)}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resBody = await jsonBody(res);
      if (!res.ok) throw new Error(resBody.error || `HTTP ${res.status}`);
      pickedBatch = id; // stay pinned to the doc being worked
      refreshBatch();
    } catch (err) {
      batchErrorEl.hidden = false;
      batchErrorEl.textContent = err.message;
    }
  }

  const regimeLabel = (regime) => (regime === 'interlaced' ? 'interlaced-purged window' : 'full training window');

  function renderPermScreen(doc, header) {
    const running = doc.status === 'running';
    const sel = doc.selection || { pair: null, members: [], rungs: [] };
    const fee = (doc.params.feePerLeg ?? 0.125);
    const trip = 2 * fee;
    const s = doc.summary;
    const gpt = (m) => (m.paperTrades ? (m.paperPnl + m.paperTrades * trip) / m.paperTrades : null);
    const stage = !sel.pair ? '2 — checkbox ONE asset to work'
      : !doc.quorums ? '3 — checkbox the members to committee, then show the quorum table'
        : !sel.rungs.length ? '5 — checkbox the rungs to keep, then fire the null test'
          : doc.nullTest && doc.nullTest.status === 'done' ? '6 — null results below'
            : doc.nullTest && doc.nullTest.status === 'running' ? '6 — null test running'
              : '5/6 — rungs picked; fire the null test when ready';

    const memberRow = (trade, key, m, selectable) => {
      const met = m.metrics;
      const checked = sel.members.includes(key) ? ' checked' : '';
      const box = selectable && !running ? `<input type="checkbox" class="perm-member" data-key="${esc(key)}"${checked}>` : '';
      return `<tr class="${(met.hindsightEdge ?? -1) > 0 ? 'hilite' : ''}">
        <td>${box}</td>
        <td>${esc(regimeLabel(m.regime))}</td>
        <td>${esc(m.view)}/${esc(m.model)}</td>
        <td>${met.paperPnl != null ? money(met.paperPnl) : '—'} <span class="note">(${met.paperWins ?? 0}/${met.paperTrades ?? 0}t)</span></td>
        <td>${gpt(met) != null ? '$' + gpt(met).toFixed(2) : '—'}</td>
        <td>${pct(met.testAcc)}</td>
        <td>${pct(met.bestConstant)}</td>
        <td>${met.hindsightEdge != null ? (met.hindsightEdge >= 0 ? '+' : '') + (100 * met.hindsightEdge).toFixed(1) + '%' : '—'}</td>
        <td>${pct(met.balancedAcc)}</td>
        <td>${met.directionalHits ?? 0}/${met.directionalCalls ?? 0}</td>
        <td>${pct(met.trainAcc)}</td>
        <td>${esc(met.chosen || '')}</td>
      </tr>`;
    };

    const pairOrder = s && s.pairs ? s.pairs.map((p) => p.trade) : Object.keys(doc.perms || {});
    const assetBlocks = pairOrder.map((trade) => {
      const p = doc.perms[trade];
      if (!p) return '';
      const members = Object.entries(p.members || {})
        .sort((a, b) => (b[1].metrics.paperPnl ?? -Infinity) - (a[1].metrics.paperPnl ?? -Infinity));
      const isSel = sel.pair === trade;
      const best = members[0] ? members[0][1].metrics.paperPnl : null;
      return `<details ${isSel ? 'open' : ''}>
        <summary><label class="check" style="display:inline">
          <input type="radio" name="perm-asset" class="perm-asset" value="${esc(trade)}" ${isSel ? 'checked' : ''} ${running ? 'disabled' : ''}>
          <strong>${esc(trade)}</strong></label>
          · band ±${p.band != null ? p.band.toFixed(2) : '?'}% · ${members.length}/16 members · best ${best != null ? money(best) : '—'}
          ${isSel ? ' · <strong>working this asset</strong>' : ''}</summary>
        <div class="tablewrap" style="margin:6px 0"><table>
          <tr><th title="Stage-3 checkbox (working asset only): include this member in the committee"></th>
            <th title="Which window the member's model trained on — the only distinction that survives at the spec level; band and test window are shared, so members from both regimes stay period-aligned">training window</th>
            <th>view/model</th>
            <th title="One-shot $100 paper book over the shared test window, research friction">paper P&L (W/T)</th>
            <th title="Per-trade result before the round-trip fee">gross/trade</th>
            <th>test acc</th><th>best const</th><th title="test acc − best constant">true edge</th>
            <th>bal acc</th><th title="directional hits/calls">±1 hits</th><th>train acc</th><th>picked</th></tr>
          ${members.map(([key, m]) => memberRow(trade, key, m, isSel)).join('')}
        </table></div>
      </details>`;
    }).join('');

    const topTable = s && s.top && s.top.length ? `
      <h3 style="margin:14px 0 4px">Top 20 by test paper P&L (all assets)</h3>
      <div class="tablewrap"><table>
        <tr><th>pair</th><th>member</th><th>training window</th><th>P&L (W/T)</th><th>true edge</th><th>test acc</th><th>picked</th></tr>
        ${s.top.map((t) => `<tr><td>${esc(t.trade)}</td><td>${esc(t.key)}</td><td>${esc(regimeLabel(t.regime || String(t.key).split('/')[0]))}</td>
          <td>${money(t.pnl ?? 0)} <span class="note">(${t.wins ?? 0}/${t.trades ?? 0}t)</span></td>
          <td>${t.hindsightEdge != null ? (t.hindsightEdge >= 0 ? '+' : '') + (100 * t.hindsightEdge).toFixed(1) + '%' : '—'}</td>
          <td>${pct(t.testAcc)}</td><td>${esc(t.chosen || '')}</td></tr>`).join('')}
      </table></div>` : '';

    const membersBar = sel.pair && !running ? `
      <div class="controls" style="margin:8px 0">
        <div class="field submit"><button id="perm-members-go" type="button"
          title="Save the checked members as the committee and compute the quorum menu (1..n, net-direction rule) over the shared test window">Show quorum table (save members)</button></div>
        <span class="note">working ${esc(sel.pair)} — check members above, ${sel.members.length} saved</span>
      </div>` : '';

    let quorumBlock = '';
    if (doc.quorums && sel.pair === doc.quorums.pair) {
      const n = doc.quorums.members.length;
      quorumBlock = `
        <h3 style="margin:14px 0 4px">Quorum menu — ${n} member(s), net direction wins, best dollars first</h3>
        <p class="note">Rule: each period the majority side among the committee wins; the book trades at rung k when the
          winning side's absolute count reaches k; tied up/down stands aside. Accuracy scores every period (stand-asides
          count as calls of 0); trade hit scores only the periods it traded.</p>
        <div class="tablewrap"><table>
          <tr><th title="Stage-5 checkbox: keep this rung for the null test"></th><th>rung</th><th>net P&L</th><th>trades</th><th>wins</th><th>gross/trade</th><th>acc</th><th>trade hit</th></tr>
          ${doc.quorums.rows.map((r) => `<tr>
            <td><input type="checkbox" class="perm-rung" data-k="${r.k}" ${sel.rungs.includes(r.k) ? 'checked' : ''} ${running ? 'disabled' : ''}></td>
            <td>${r.k} of ${n}</td><td>${money(r.pnl)}</td><td>${r.trades}</td><td>${r.wins}</td>
            <td>${r.grossPerTrade != null ? '$' + r.grossPerTrade.toFixed(2) : '—'}</td>
            <td>${pct(r.acc)}</td><td>${pct(r.tradeHit)}</td></tr>`).join('')}
        </table></div>
        ${running ? '' : `<div class="controls" style="margin:8px 0">
          <div class="field"><label for="perm-shifts">Null shifts</label><input id="perm-shifts" type="number" min="1" max="1000" step="1" value="200"></div>
          <div class="field submit"><button id="perm-null-go" type="button"
            title="Freeze the checked rungs and re-run ONLY the selected members under circularly shifted labels; each kept rung is judged against its own noise floor. This calibrates the picked book conditional on every pick made above — it is not a clean p-value, and it spends looks against the ledger.">Fire null test on checked rungs</button></div>
        </div>`}`;
    }

    let nullBlock = '';
    if (doc.nullTest) {
      const nt = doc.nullTest;
      if (nt.perRung && Object.keys(nt.perRung).length) {
        // Live exceed table — fills in rotation by rotation while the null
        // runs (same behaviour as the consensus screen's null columns) and
        // freezes when it finishes.
        const title = nt.status === 'running'
          ? `Null test — RUNNING: ${nt.shifts} of ${nt.requestedShifts} distinct rotations banked so far`
          : nt.status === 'cancelled'
            ? `Null test — CANCELLED at ${nt.shifts} distinct rotations (numbers below are valid for that sample)`
            : `Null test — ${nt.shifts} distinct rotations`;
        nullBlock = `
          <h3 style="margin:14px 0 4px">${title}</h3>
          <div class="tablewrap"><table>
            <tr><th>rung</th><th>real net (trades)</th>
              <th title="Share of label-shifted committees whose rung book made at least as many dollars — the primary reading">P&L exceed</th>
              <th title="Share of label-shifted committees whose rung matched the realized class at least as often (stand-asides count as 0-calls)">acc exceed</th>
              <th title="The typical null committee at this rung — a low P&L exceed means something different when null books traded as often as the real one than when noise rarely agreed enough to fire">null median $ / trades</th></tr>
            ${Object.entries(nt.perRung).map(([k, r]) => `<tr>
              <td>${k} of ${sel.members.length}</td>
              <td>${money(r.real.pnl)} (${r.real.trades}t)</td>
              <td><strong>${r.exceedPnl != null ? pct(r.exceedPnl) : '—'}</strong> of ${r.shifts}</td>
              <td>${r.exceedAcc != null ? pct(r.exceedAcc) : '—'}</td>
              <td>${r.medianPnl != null ? money(r.medianPnl) : '—'} / ${r.medianTrades ?? '—'}t</td></tr>`).join('')}
          </table></div>
          ${nt.status === 'running' ? '<p class="note">Interim numbers move until the run completes — no action follows an interim look.</p>' : ''}
          <p class="note">Conditional calibration: every pick above (asset, members, rungs) was made after seeing test-window
            results, and none of those picks replay inside the null. Read against the ledger's denominator; a forward book
            is the only clean test.</p>`;
      } else if (nt.status === 'running') {
        nullBlock = `<p class="note">Null test running — ${nt.requestedShifts} shifts requested; the exceed table appears here the moment the first rotation's committee completes…</p>`;
      } else if (nt.status === 'error') {
        nullBlock = `<p class="warn-text">Null test failed: ${esc(nt.error || 'unknown error')}</p>`;
      }
    }

    batchViewEl.innerHTML = `<p class="note">${header}</p>
      <p class="note"><strong>Staged pick workflow — stage ${stage}.</strong> 16 members per asset: 8 specs ×
        2 training windows (full, and interlaced-purged). That is all the five protocol permutations amount to at
        the spec level. Every member shares the asset's band and test window, so quorum books over any subset are exact.</p>
      ${topTable}
      <h3 style="margin:14px 0 4px">Assets — pick one to work</h3>
      ${assetBlocks}
      ${membersBar}
      ${quorumBlock}
      ${nullBlock}`;

    batchViewEl.querySelectorAll('.perm-asset').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) permPost(doc.id, 'select', { pair: radio.value });
      });
    });
    const membersGo = batchViewEl.querySelector('#perm-members-go');
    if (membersGo) {
      membersGo.addEventListener('click', () => {
        const members = [...batchViewEl.querySelectorAll('.perm-member:checked')].map((b) => b.dataset.key);
        permPost(doc.id, 'select', { members });
      });
    }
    const nullGo = batchViewEl.querySelector('#perm-null-go');
    if (nullGo) {
      nullGo.addEventListener('click', async () => {
        const rungs = [...batchViewEl.querySelectorAll('.perm-rung:checked')].map((b) => Number(b.dataset.k));
        const shifts = Number(batchViewEl.querySelector('#perm-shifts').value) || 200;
        if (!rungs.length) {
          batchErrorEl.hidden = false;
          batchErrorEl.textContent = 'check at least one rung first';
          return;
        }
        batchErrorEl.hidden = true;
        try {
          let res = await fetch(`api/permscreen/${encodeURIComponent(doc.id)}/select`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rungs }),
          });
          let body = await jsonBody(res);
          if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
          res = await fetch(`api/permscreen/${encodeURIComponent(doc.id)}/null`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shifts }),
          });
          body = await jsonBody(res);
          if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
          pickedBatch = doc.id;
          refreshBatch();
        } catch (err) {
          batchErrorEl.hidden = false;
          batchErrorEl.textContent = err.message;
        }
      });
    }
  }

  // Meta-lens screen rendering: one row per pair (a run here is one complete
  // two-stage recipe), with the real run's stage detail expandable.
  function renderMetalens(doc, s, header) {
    const MT = {
      lenses: 'How many of the 8 lenses passed stage 1 — beat the best constant guess on half A’s unseen tail. Zero passing is a legitimate result: the book stands aside everywhere.',
      frac: 'The agreement threshold stage 2 chose on half B, from the fixed menu 50/62.5/75/87.5/100% of passing lenses. Ties go stricter. Chosen before the test window was ever touched.',
      book: 'The meta-book’s paper P&L over the untouched test window: $100 per order at research friction ($0.25 round trip), entry/exit at the geometry’s candle opens.',
      gpt: 'P&L before friction, per trade. Positive above its round-trip cost means the book beats its own fees.',
      acc: 'Share of test periods where the meta-call matched the realized class, with (edge) = accuracy − the test window’s best constant guess.',
      nullP: 'Share of label-shifted replays of the ENTIRE recipe — lens selection and threshold choice included — whose test book made at least as many dollars. Hover for how the null recipes behaved.',
      nullE: 'Same, on accuracy edge instead of dollars.',
      s1: 'Stage 1 scoreboard on half A’s tail: a lens passes only if accuracy beats the tail’s best constant guess.',
      s2: 'Stage 2 menu on half B: each fixed agreement fraction’s paper P&L. The chosen row traded the test window.',
    };
    const th = (label, tip) => `<th title="${esc(tip)}">${label}</th>`;
    const fmtE = (e) => (e == null ? '—' : (e >= 0 ? '+' : '') + (100 * e).toFixed(1) + '%');
    const rows = s.pairs.map((p) => {
      const m = p.metrics;
      if (!m) return `<tr><td>${esc(p.trade)}</td><td colspan="8">no completed real run</td></tr>`;
      const nullHover = p.null
        ? ` title="Null recipes: median ${money(p.null.medianPnl)} on ${p.null.medianTrades} trades, median ${p.null.medianLensesPassed} lenses passing (real: ${money(m.pnl)} on ${m.trades} trades, ${m.lensesPassed} lenses). If noise recipes pass few lenses, lens selection itself is doing real filtering."`
        : '';
      return `<tr class="${m.pnl > 0 ? 'hilite' : ''}">
        <td>${esc(p.trade)}</td>
        <td>${m.lensesPassed}/8${m.forcedAll ? ' <strong title="Stage 1 passed nothing; the owner-enabled fallback ran stage 2 with ALL 8 lenses — agreement-only mode. This is a different claim than a selective run and is permanently marked as such.">⚑ forced all 8</strong>' : ''}</td>
        <td>${m.standAside ? '<em title="No agreement fraction was profitable on half B, so no threshold was chosen and the book stood aside on the whole test window — the pre-registered stand-aside rule.">stood aside</em>' : m.chosenFrac == null ? '—' : pct(m.chosenFrac, 1)}</td>
        <td>${m.trades} (${m.wins} w)</td>
        <td><strong>${money(m.pnl)}</strong></td>
        <td>${m.grossPerTrade == null ? '—' : '$' + m.grossPerTrade.toFixed(2)}</td>
        <td>${pct(m.accuracy)} (${fmtE(m.edge)})</td>
        <td${nullHover}>${p.null ? `${pct(p.null.exceedPnl, 0)} of ${p.null.shifts}` : '—'}</td>
        <td>${p.null ? pct(p.null.exceedEdge, 0) : '—'}</td>
      </tr>`;
    }).join('');
    const details = s.pairs.filter((p) => p.detail).map((p) => {
      const d = p.detail;
      const sp = d.data.split || { mode: 'chronological' };
      const g = d.data.groups || {};
      return `<details style="margin-top:8px"><summary class="note" style="cursor:pointer">${esc(p.trade)} — stage detail (${esc(sp.mode)} split${sp.mode === 'interlaced' ? `, ${sp.blocks} blocks of ${sp.blockDays}d, ${sp.purgedChunks} chunks purged` : ''}; fit ${g.fitA != null ? g.fitA : '?'} / score ${g.scoreA != null ? g.scoreA : '?'} / B ${d.data.halves.B}, band ±${d.data.bandPct.toFixed(2)}%)</summary>
        <div class="tablewrap" style="margin:6px 0"><table>
          <tr>${th('lens (stage 1)', MT.s1)}<th>tail acc</th><th>best const</th><th>edge</th><th>passed</th></tr>
          ${d.stage1.map((r) => `<tr class="${r.passed ? '' : 'miss'}"><td>${esc(r.key)}</td><td>${r.valAcc == null ? esc(r.error || '—') : pct(r.valAcc)}</td><td>${pct(r.bestConstant)}</td><td>${r.edge == null ? '—' : fmtE(r.edge)}</td><td>${r.passed ? 'yes' : 'no'}</td></tr>`).join('')}
        </table></div>
        ${d.stage2.forcedAll ? '<p class="note"><strong>⚑ zero lenses passed stage 1 — fallback engaged: all 8 lenses form the committee (agreement-only mode).</strong></p>' : ''}
        ${d.stage2.menu.length ? `<div class="tablewrap" style="margin:6px 0"><table>
          <tr>${th('agreement (stage 2)', MT.s2)}<th>B-half P&amp;L</th><th>trades</th></tr>
          ${d.stage2.menu.map((r) => `<tr><td class="${r.frac === d.stage2.chosenFrac ? 'chosen' : ''}">${pct(r.frac, 1)}${r.frac === d.stage2.chosenFrac ? ' ← chosen' : ''}</td><td>${money(r.pnl)}</td><td>${r.trades}</td></tr>`).join('')}
        </table></div>` : '<p class="note">no lenses passed stage 1 — the meta-book stood aside on the whole test window.</p>'}
      </details>`;
    }).join('');
    batchViewEl.innerHTML = `
      <p class="note">${header}</p>
      <div class="tablewrap"><table>
        <tr><th>pair</th>${th('lenses passed', MT.lenses)}${th('threshold', MT.frac)}${th('test trades', MT.book)}${th('P&amp;L', MT.book)}${th('gross/trade', MT.gpt)}${th('acc (edge)', MT.acc)}${th('null: P&amp;L exceed', MT.nullP)}${th('null: edge exceed', MT.nullE)}</tr>
        ${rows}
      </table></div>
      ${details}
      ${s.failed.length ? `<p class="note">Failed: ${s.failed.map((f) => `${esc(f.trade)}${f.shift ? `/shift${f.shift}` : ''} (${esc(f.error)})`).join(' · ')}</p>` : ''}
      <p class="note">A meta-lens run is the whole two-stage recipe, so a null shift here re-runs lens selection AND the
        threshold choice on rotated labels before trading the rotated test window — the noise floor gets every freedom
        the real run had. The hover on the null column shows whether noise recipes even pass lenses.</p>`;
  }

  // Batch row -> one-off run: copy the screen's config + the row's combo into
  // the form and fire the detailed report. Consensus rows carry a feature
  // VIEW (no form control for it) — passed through on the next submit only.
  let pendingView = null;

  function shuttleToForm(doc, r) {
    $('trade').value = r.trade;
    $('compare').value = r.compare || doc.params.compareSymbol;
    $('allloaded').checked = !!doc.params.allLoaded;
    $('allloaded').dispatchEvent(new Event('change'));
    if (!doc.params.allLoaded) {
      $('start').value = doc.params.startMonth;
      $('end').value = doc.params.endMonth;
    }
    $('features').value = doc.params.featureSet || 'compressed';
    $('geometry').value = doc.params.geometry || 'weekly-8d';
    $('decision').value = doc.params.decision || 'argmax';
    $('weekdays').checked = !!doc.params.weekdaysOnly;
    $('model').value = r.model;
    const auto = doc.params.dormantPct === 'auto';
    $('autoband').checked = auto;
    $('dormant').disabled = auto;
    if (!auto) $('dormant').value = doc.params.dormantPct;
    pendingView = r.view && r.view !== 'full' ? r.view : null;
    saveForm(); // programmatic changes fire no events; keep the stored state true
    window.scrollTo({ top: 0, behavior: 'smooth' });
    form.requestSubmit();
  }

  const batchPickEl = $('batch-pick');
  let pickedBatch = null; // null = follow the latest

  function fillPicker(batches) {
    batchPickEl.innerHTML = batches
      .map((b) => `<option value="${esc(b.id)}">${esc(b.id)} — ${esc(b.status)} (${b.runsDone}/${b.runsTotal}, ±${esc(String(b.params.dormantPct))}%, ${esc(b.params.geometry || 'weekly-8d')}${b.params.weekdaysOnly ? '/24-5' : ''}${b.params.decision === 'directional' ? '/hunter' : ''}, ${b.params.allLoaded ? 'all loaded' : `${esc(b.params.startMonth)}→${esc(b.params.endMonth)}`})</option>`)
      .join('');
    const want = pickedBatch && batches.some((b) => b.id === pickedBatch) ? pickedBatch : (batches[0] || {}).id;
    if (want) batchPickEl.value = want;
    return want;
  }

  async function refreshBatch() {
    try {
      batchErrorEl.hidden = true;
      const res = await fetch('api/batches');
      const body = await jsonBody(res);
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (!body.batches.length) {
        batchViewEl.innerHTML = '<p class="note">No pair screens have been run yet.</p>';
        setBatchStatus('');
        return;
      }
      const targetId = fillPicker(body.batches);
      const res2 = await fetch(`api/batch/${targetId}`);
      const doc = await jsonBody(res2);
      if (!res2.ok) throw new Error(doc.error || `HTTP ${res2.status}`);
      renderBatch(doc);
      if (doc.status === 'running') {
        setBatchStatus(doc.progress || 'running…');
        clearTimeout(batchTimer);
        batchTimer = setTimeout(refreshBatch, 5000);
      } else {
        setBatchStatus('');
      }
    } catch (err) {
      setBatchStatus('');
      batchErrorEl.hidden = false;
      batchErrorEl.textContent = err.message;
    }
  }

  batchPickEl.addEventListener('change', () => {
    pickedBatch = batchPickEl.value;
    clearTimeout(batchTimer);
    refreshBatch();
  });

  $('batch-start').addEventListener('click', async () => {
    try {
      batchErrorEl.hidden = true;
      const res = await fetch('api/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dormantPct: dormantValue(),
          startMonth: $('start').value,
          endMonth: $('end').value,
          allLoaded: allLoadedChecked(),
          featureSet: $('features').value,
          geometry: $('geometry').value,
          decision: $('decision').value,
          weekdaysOnly: $('weekdays').checked,
        }),
      });
      const body = await jsonBody(res);
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      pickedBatch = null; // follow the batch we just started
      refreshBatch();
    } catch (err) {
      batchErrorEl.hidden = false;
      batchErrorEl.textContent = err.message;
    }
  });
  $('cons-max').addEventListener('click', async () => {
    try {
      batchErrorEl.hidden = true;
      const pairsRaw = $('cons-pairs').value.trim();
      if (!pairsRaw) throw new Error('enter a pair list first — computing exact rotations for all 17 pairs would take a while');
      const pairs = pairsRaw.split(',').map((p) => p.trim().toUpperCase()).filter(Boolean).join(',');
      setBatchStatus('computing exact rotation ceilings…');
      const q = new URLSearchParams({
        pairs,
        geometry: $('geometry').value,
        weekdays: $('weekdays').checked ? '1' : '0',
        allLoaded: allLoadedChecked() ? '1' : '0',
        startMonth: $('start').value,
        endMonth: $('end').value,
      });
      const res = await fetch(`api/rotations?${q}`);
      const body = await jsonBody(res);
      setBatchStatus('');
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      $('cons-null').value = body.suggested;
      const parts = Object.entries(body.pairs).map(([p, r]) => `${p}: ${r.chunks} weeks → ${r.maxRotations} rotations`);
      const scope = allLoadedChecked() ? 'all loaded data' : `${esc($('start').value)}→${esc($('end').value)}`;
      batchViewEl.insertAdjacentHTML('afterbegin', `<p class="note">Exact ceilings for the settings above (${scope}, ${esc($('geometry').value)}${$('weekdays').checked ? ', 24/5' : ''}) — ${parts.map(esc).join(' · ')} · null shifts set to ${body.suggested}.</p>`);
    } catch (err) {
      setBatchStatus('');
      batchErrorEl.hidden = false;
      batchErrorEl.textContent = err.message;
    }
  });

  $('cons-start').addEventListener('click', async () => {
    // The screening grids are built around the ADAPTIVE band: it balances the
    // classes per pair so results can be read against nulls calibrated on the
    // same machine. A fixed band is the exception (wide-band hunter grids),
    // and silently running one produces a screen that looks like its adaptive
    // sibling but isn't comparable to it.
    if (!$('autoband').checked
      && !confirm(`Run the screen at a FIXED ±${$('dormant').value}% band?\n\n`
        + 'Screens normally use the adaptive band ("auto — balance the classes"), and results '
        + 'from a fixed band cannot be compared against nulls or screens computed with auto.\n\n'
        + 'Cancel to tick the auto checkbox first.')) return;
    try {
      batchErrorEl.hidden = true;
      const useMeta = $('proto-metalens').checked;
      const usePerm = $('proto-perm').checked;
      const pairsRaw = $('cons-pairs').value.trim();
      const body = {
        startMonth: $('start').value,
        endMonth: $('end').value,
        allLoaded: allLoadedChecked(),
        nullShifts: Number($('cons-null').value) || 0,
        geometry: $('geometry').value,
        decision: $('decision').value, // classic only; the meta-lens endpoint ignores it
        dormantPct: dormantValue(),
        weekdaysOnly: $('weekdays').checked,
        forceAllOnZeroPass: $('proto-forceall').checked, // meta-lens only; classic ignores it
        splitMode: $('proto-interlaced').checked ? 'interlaced' : 'chronological',
      };
      if (pairsRaw) body.pairs = pairsRaw.split(',').map((p) => p.trim().toUpperCase()).filter(Boolean);
      const res = await fetch(usePerm ? 'api/permscreen' : useMeta ? 'api/metalens' : 'api/consensus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resBody = await jsonBody(res);
      if (!res.ok) throw new Error(resBody.error || `HTTP ${res.status}`);
      pickedBatch = null; // follow the screen we just started
      refreshBatch();
    } catch (err) {
      batchErrorEl.hidden = false;
      batchErrorEl.textContent = err.message;
    }
  });

  $('stop-all').addEventListener('click', async () => {
    if (!confirm('Stop the running screen and abort any in-flight training? Completed runs are kept.')) return;
    try {
      batchErrorEl.hidden = true;
      const res = await fetch('api/abort', { method: 'POST' });
      const body = await jsonBody(res);
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setBatchStatus(body.cancelledBatch ? `stopping ${body.cancelledBatch}…` : 'no screen running — any in-flight training aborted');
      setTimeout(() => { setBatchStatus(''); refreshBatch(); }, 2500);
    } catch (err) {
      batchErrorEl.hidden = false;
      batchErrorEl.textContent = err.message;
    }
  });

  $('batch-refresh').addEventListener('click', refreshBatch);

  // ---- live tracker -----------------------------------------------------------

  const trackerViewEl = $('tracker-view');
  const trackerErrEl = $('tracker-error');
  const trackerStatusEl = $('tracker-status');

  function setTrackerStatus(text) {
    trackerStatusEl.hidden = !text;
    trackerStatusEl.innerHTML = text ? `<span class="spin">⟳</span>${esc(text)}` : '';
  }

  function money(v) {
    return (v < 0 ? '−$' : '+$') + Math.abs(v).toFixed(2);
  }

  let trackerData = null;
  const bookSel = {}; // pair -> selected book key ('vote' default)

  function renderTracker(t) {
    trackerData = t;
    if (!t.initialized) {
      trackerViewEl.innerHTML = '<p class="note">Not initialized yet. Initialize trains and freezes the models (one-time, throttle-aware), then seeds every week since 2026-07-01.</p>';
      return;
    }
    const fmtEdge = (e) => (e == null ? '—' : (e >= 0 ? '+' : '') + (100 * e).toFixed(1) + '%');
    trackerViewEl.innerHTML = Object.entries(t.pairs).map(([pair, p]) => {
      const vb = p.books.vote;
      const liveCount = p.weeks.filter((w) => w.live).length;
      const selected = bookSel[pair] || 'vote';
      const ref = p.screenRef || null;
      // vote first (with the screen's MEDIAN true edge as its reference),
      // then the 8 spec books ordered by their screening true edge
      const specKeys = Object.keys(p.books).filter((k) => k !== 'vote')
        .sort((a, b) => ((ref && ref.specs[b]) ?? -1e9) - ((ref && ref.specs[a]) ?? -1e9));
      const bookRows = ['vote', ...specKeys].map((k) => {
        const b = p.books[k];
        const refEdge = k === 'vote' ? (ref ? ref.median : null) : ref ? ref.specs[k] : null;
        return `
          <tr class="bookrow ${k === selected ? 'hilite' : ''}" data-pair="${esc(pair)}" data-book="${esc(k)}"
              title="Click to show this book's full trade history below">
            <td>${k === 'vote' ? '<strong>vote (majority of 8)</strong>' : esc(k)}</td>
            <td>${fmtEdge(refEdge)}</td>
            <td>${b.trades}</td><td>${b.wins}</td><td>${money(b.pnl)}</td>
            <td>${b.scored ? pct(b.correct / b.scored) : '—'}</td>
          </tr>`;
      }).join('');
      const hist = p.weeks.slice().reverse().map((w) => {
        const call = selected === 'vote' ? w.vote : (w.specs || {})[selected];
        const pnl = w.pnl ? w.pnl[selected] : null;
        const floatingExit = w.status === 'pending' && p.lastPrice
          ? `<em title="current market price (as of ${esc(p.lastPrice.at)}) — position still floating, not the exit">${p.lastPrice.price}</em>`
          : '—';
        return `
          <tr class="${w.status === 'settled' && call !== 0 && pnl != null && pnl <= 0 ? 'miss' : ''}">
            <td>${esc(w.weekOf)}</td><td>${clsSpan(call)}</td><td>${w.actual === null ? '—' : clsSpan(w.actual)}</td>
            <td>${w.entry != null ? w.entry : '—'}</td><td>${w.exit != null ? w.exit : floatingExit}</td>
            <td>${pnl != null ? money(pnl) : '—'}</td><td>${esc(w.status)}</td>
            <td>${w.live ? 'LIVE' : 'unseen'}</td>
          </tr>`;
      }).join('');
      return `
      <div class="section">
        <h2>${esc(pair)} — band ±${p.bandPct.toFixed(2)}%, ${p.trainWeeks} training weeks through ${esc(p.trainedThrough)}</h2>
        <div class="tiles">
          ${tile('Vote book P&L', money(vb.pnl), `${vb.trades} trades, ${vb.wins} wins, after $1/trip fees`, true)}
          ${tile('Vote accuracy', vb.scored ? pct(vb.correct / vb.scored) : '—', `${vb.correct}/${vb.scored} scored weeks`)}
          ${tile('Weeks recorded', String(p.weeks.length), `${liveCount} live · ${p.weeks.length - liveCount} unseen (backfilled)`)}
        </div>
        <div class="tablewrap" style="margin-top:10px"><table>
          <tr>
            <th title="The decision book: vote = majority of the 8 specs (ties stand aside); the rest are the individual method permutations, each running its own $100 paper book on identical prices.">book</th>
            <th title="True edge this book showed in the screening era (vote row = median of the 8). Historical context only — the live columns to the right are the actual test.">screen true edge</th>
            <th title="Settled weeks where this book took a position (±1). Weeks it called 0 are not trades.">trades</th>
            <th title="Trades that closed with positive P&L after fees.">wins</th>
            <th title="Cumulative paper P&L: $100 per order, entry Tue 03:00 open, exit Thu 15:00 open, $0.50 per leg.">P&amp;L</th>
            <th title="Of settled weeks with a known outcome, how often this book's call matched the realized class.">accuracy</th>
          </tr>
          ${bookRows}
        </table></div>
        <p class="note" style="margin-top:10px">Trade history — <strong>${esc(selected === 'vote' ? 'vote (majority of 8)' : selected)}</strong>${ref ? ` · screening reference from ${esc(ref.source)}` : ''}</p>
        <div class="tablewrap"><table>
          <tr>
            <th title="Monday the 8-day feature chunk started; the call was made after it closed.">week (Mon)</th>
            <th title="This book's call for the week: +1 long, −1 short, 0 stand aside.">call</th>
            <th title="What actually happened (Tue morning vs Thu afternoon averages against the frozen band).">actual</th>
            <th title="Trade entry: Tuesday 03:00 UTC hourly open.">entry</th>
            <th title="Trade exit: Thursday 15:00 UTC hourly open.">exit</th>
            <th title="This book's P&L for the week after $1 round-trip fees; $0.00 when it stood aside.">P&amp;L</th>
            <th title="pending = awaiting Thursday settlement; settled = done; missed = data gap prevented pricing.">status</th>
            <th title="Every post-June week is data the frozen models never trained on. LIVE = the call was also recorded before its outcome window opened (Thu 12:00 UTC) and counts toward the 26-week verdict; unseen = backfilled after the fact — equally untrained-on, reported alongside.">provenance</th>
          </tr>
          ${hist}
        </table></div>
      </div>`;
    }).join('');
    trackerViewEl.querySelectorAll('.bookrow').forEach((row) => {
      row.addEventListener('click', () => {
        bookSel[row.dataset.pair] = row.dataset.book;
        renderTracker(trackerData);
      });
    });
  }

  // fresh=true (the Refresh button) pulls current prices server-side first;
  // the initial page load just reads existing state.
  async function refreshTracker(fresh = false) {
    try {
      trackerErrEl.hidden = true;
      if (fresh) setTrackerStatus('fetching current prices…');
      const res = await fetch('api/tracker' + (fresh ? '/refresh' : ''), fresh ? { method: 'POST' } : undefined);
      const t = await jsonBody(res);
      setTrackerStatus('');
      if (!res.ok) throw new Error(t.error || `HTTP ${res.status}`);
      renderTracker(t);
      $('tracker-init').disabled = !!t.initialized;
    } catch (err) {
      setTrackerStatus('');
      trackerErrEl.hidden = false;
      trackerErrEl.textContent = err.message;
    }
  }

  $('tracker-init').addEventListener('click', async () => {
    try {
      trackerErrEl.hidden = true;
      setTrackerStatus('initializing…');
      const res = await fetch('api/tracker/init', { method: 'POST' });
      const body = await jsonBody(res);
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      await poll(body.jobId, setTrackerStatus);
      setTrackerStatus('');
      refreshTracker();
    } catch (err) {
      setTrackerStatus('');
      trackerErrEl.hidden = false;
      trackerErrEl.textContent = err.message;
    }
  });
  $('tracker-refresh').addEventListener('click', () => refreshTracker(true));

  // ---- live tracker II: DOGE daily-3d -----------------------------------------

  const dogeViewEl = $('doge-view');
  const dogeErrEl = $('doge-error');
  const dogeStatusEl = $('doge-status');
  const BOOK_LABEL = {
    vote: 'vote (majority of 8)',
    q5: '5 of 8 agree',
    q6: '6 of 8 agree',
    q7: '7 of 8 agree',
    q8: '8 of 8 (unanimous)',
  };
  // The backtest gradient this book exists to test forward (TRACKER-DOGE.md).
  const BACKTEST_WIN = { q5: 0.537, q6: 0.574, q7: 0.626, q8: 0.673 };
  let dogeSel = 'q7';

  function setDogeStatus(text) {
    dogeStatusEl.hidden = !text;
    dogeStatusEl.innerHTML = text ? `<span class="spin">⟳</span>${esc(text)}` : '';
  }

  function renderDoge(t) {
    if (!t.initialized) {
      dogeViewEl.innerHTML = '<p class="note">Not initialized. Initialize trains and freezes the 8 specs on every '
        + 'chunk completed before 2026-07-01 (throttle-aware, a few minutes), then seeds every day since.</p>';
      return;
    }
    const rows = Object.entries(t.books).map(([k, b]) => {
      const back = BACKTEST_WIN[k];
      const live = b.trades ? b.wins / b.trades : null;
      return `<tr class="bookrow ${k === dogeSel ? 'hilite' : ''}" data-book="${esc(k)}"
          title="Click to show this book's period-by-period history below">
        <td>${k === 'vote' ? '<strong>' + esc(BOOK_LABEL[k]) + '</strong>' : esc(BOOK_LABEL[k])}</td>
        <td>${b.trades}</td><td>${b.wins}</td>
        <td>${live == null ? '—' : pct(live)}</td>
        <td>${back == null ? '—' : pct(back)}</td>
        <td>${money(b.pnl)}</td>
        <td>${b.grossPerTrade == null ? '—' : '$' + b.grossPerTrade.toFixed(2)}</td>
        <td>${b.scored ? pct(b.correct / b.scored) : '—'}</td>
      </tr>`;
    }).join('');
    const hist = t.periods.slice().reverse().map((p) => {
      const call = p.calls[dogeSel];
      const pnl = p.pnl ? p.pnl[dogeSel] : null;
      const floatingExit = p.status === 'pending' && t.lastPrice
        ? `<em title="current market price (as of ${esc(t.lastPrice.at)}) — position still floating, not the exit">${t.lastPrice.price}</em>`
        : '—';
      const agree = Object.values(p.predictions).filter((v) => v === call && call !== 0).length;
      return `<tr class="${p.status === 'settled' && call !== 0 && pnl != null && pnl <= 0 ? 'miss' : ''}">
        <td>${esc(p.dayOf)}</td><td>${clsSpan(call)}</td>
        <td>${call === 0 ? '—' : `${agree}/8`}</td>
        <td>${p.actual === null ? '—' : clsSpan(p.actual)}</td>
        <td>${p.entry != null ? p.entry : '—'}</td><td>${p.exit != null ? p.exit : floatingExit}</td>
        <td>${pnl != null ? money(pnl) : '—'}</td><td>${esc(p.status)}</td>
        <td>${p.live ? 'LIVE' : 'unseen'}</td>
      </tr>`;
    }).join('');
    const vb = t.books.q7;
    dogeViewEl.innerHTML = `
      <div class="tiles">
        ${tile('7-of-8 book P&L', money(vb.pnl), `${vb.trades} trades, ${vb.wins} wins, after $1/trip fees`, true)}
        ${tile('Vote book P&L', money(t.books.vote.pnl), `${t.books.vote.trades} trades, ${t.books.vote.wins} wins`)}
        ${tile('Periods recorded', String(t.periods.length), `${t.liveCount} live · ${t.periods.length - t.liveCount} unseen (backfilled)`)}
        ${tile('Frozen band', '±' + t.bandPct.toFixed(2) + '%', `${t.trainChunks} training chunks through ${esc(t.trainedThrough)}`)}
      </div>
      <div class="tablewrap" style="margin-top:10px"><table>
        <tr>
          <th title="All five rules were declared before the first period. None will be promoted on the basis of live results.">book</th>
          <th title="Settled periods where this book took a position (±1).">trades</th>
          <th title="Trades that closed positive after $1 round-trip fees.">wins</th>
          <th title="Live win rate — the number this book exists to test.">win rate</th>
          <th title="What this rung scored in the backtest. The claim under test is that win rate rises monotonically with agreement; if the live column reproduces that ordering, the conviction hypothesis survives out of sample.">backtest</th>
          <th title="Cumulative paper P&L at $100 per order, $0.50 per leg.">P&amp;L</th>
          <th title="P&L before friction, per trade — the raw directional edge captured. Above $1.00 means the rule beats its own fees.">gross/trade</th>
          <th title="Of settled periods with a known outcome, how often this book's call matched the realized class. Stand-asides count as calls of 0.">accuracy</th>
        </tr>
        ${rows}
      </table></div>
      <p class="note" style="margin-top:10px">History — <strong>${esc(BOOK_LABEL[dogeSel])}</strong>. Click any book above to switch.</p>
      <div class="tablewrap"><table>
        <tr>
          <th title="Day the 72-hour chunk started; the call was made after it closed.">chunk day</th>
          <th title="This book's call: +1 long, −1 short, 0 stand aside.">call</th>
          <th title="How many of the 8 specs backed the traded direction.">agreement</th>
          <th title="Realized class from the two candle opens against the frozen band.">actual</th>
          <th title="Entry: 01:00 UTC the day after the chunk closed, hourly open.">entry</th>
          <th title="Exit: 18:00 UTC the following day, hourly open (41-hour hold).">exit</th>
          <th title="This book's P&L for the period after $1 round-trip fees; $0.00 when it stood aside.">P&amp;L</th>
          <th title="pending = awaiting settlement; settled = done; missed = data gap prevented pricing.">status</th>
          <th title="LIVE = recorded before the outcome candle existed. unseen = backfilled after the fact — equally untrained-on, reported alongside but not counted toward the live verdict.">provenance</th>
        </tr>
        ${hist}
      </table></div>`;
    dogeViewEl.querySelectorAll('.bookrow').forEach((row) => {
      row.addEventListener('click', () => {
        dogeSel = row.dataset.book;
        renderDoge(t);
      });
    });
  }

  async function refreshDoge(fresh = false) {
    try {
      dogeErrEl.hidden = true;
      if (fresh) setDogeStatus('fetching current prices…');
      const res = await fetch('api/dogebook' + (fresh ? '/refresh' : ''), fresh ? { method: 'POST' } : undefined);
      const t = await jsonBody(res);
      setDogeStatus('');
      if (!res.ok) throw new Error(t.error || `HTTP ${res.status}`);
      renderDoge(t);
      $('doge-init').disabled = !!t.initialized;
    } catch (err) {
      setDogeStatus('');
      dogeErrEl.hidden = false;
      dogeErrEl.textContent = err.message;
    }
  }

  $('doge-init').addEventListener('click', async () => {
    try {
      dogeErrEl.hidden = true;
      setDogeStatus('initializing…');
      const res = await fetch('api/dogebook/init', { method: 'POST' });
      const body = await jsonBody(res);
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      await poll(body.jobId, setDogeStatus);
      setDogeStatus('');
      refreshDoge();
    } catch (err) {
      setDogeStatus('');
      dogeErrEl.hidden = false;
      dogeErrEl.textContent = err.message;
    }
  });
  $('doge-refresh').addEventListener('click', () => refreshDoge(true));

  // ---- generalized paper books --------------------------------------------------

  const bkViewEl = $('bk-view');
  const bkErrEl = $('bk-error');
  const bkStatusEl = $('bk-status');
  const RULE_LABEL = { vote: 'vote (majority)', q5: '5 of 8', q6: '6 of 8', q7: '7 of 8', q8: '8 of 8' };
  const RULE_TIP = {
    vote: 'Majority of the 8 specs; ANY tie stands aside. The live tracker’s exact rule.',
    q5: 'Trade only when ≥5 of 8 specs call the same direction. Absolute count — 4 up vs 3 down stands aside.',
    q6: 'Trade only when ≥6 of 8 agree. The quorum pre-registered in the backtests.',
    q7: 'Trade only when ≥7 of 8 agree. Best backtest dollars — chosen after seeing tables, hence one rule among five, never “the” rule.',
    q8: 'Unanimous only. Rare, hottest per-trade backtest numbers, thinnest samples.',
  };
  const BK_COL_TIPS = `
    <th title="All declared rules report every period. None can be promoted on live results.">rule</th>
    <th title="Settled periods where this rule took a position (±1). Stand-asides are not trades.">trades</th>
    <th title="Trades that closed positive after $1 round-trip fees.">wins</th>
    <th title="Wins ÷ trades, in MONEY. A trade can win money without the exact class being right (e.g. long, price up 1%, actual class 0) — that's why this and trade acc can differ.">win rate</th>
    <th title="Cumulative paper P&L: $100 per order at the book's declared per-leg fee (shown in its protocol; book #1 declared $0.50/leg, newer books default $0.125/leg). Verdict-window periods only (post-horizon excluded).">P&amp;L</th>
    <th title="P&L before friction, per trade. Above the book's round-trip cost = the rule beats its own fees.">gross/trade</th>
    <th title="Of the periods this rule actually TRADED, how often its call matched the realized class exactly. The right accuracy for judging a rare-firing rule.">trade acc</th>
    <th title="Across ALL settled periods, with stand-asides counted as calls of 0. For a rule that rarely fires this mostly measures how often the market sat still — e.g. 3-for-3 on trades can read 50% here because the market moved during 12 of 21 stand-asides. Judge rare rules by trade acc and dollars, not this.">all-period acc</th>`;

  function setBkStatus(text) {
    bkStatusEl.hidden = !text;
    bkStatusEl.innerHTML = text ? `<span class="spin">⟳</span>${esc(text)}` : '';
  }
  $('bk-autoband').addEventListener('change', () => {
    $('bk-band').disabled = $('bk-autoband').checked;
  });

  function bookCard(b) {
    const cfg = b.config;
    const head = `${b.bookNumber ? `<strong>book #${b.bookNumber}</strong>` : `<em>draft (would be book #${b.wouldBeNumber})</em>`}
      · ${esc(cfg.pair)} vs ${esc(cfg.compareSymbol)} · ${esc(cfg.geometry)} · band ${cfg.band === 'auto' ? `auto${b.bandPct ? ` → ±${b.bandPct.toFixed(2)}%` : b.preview ? ` → ±${b.preview.bandPct.toFixed(2)}%` : ''}` : `±${esc(String(cfg.band))}%`}
      · cutoff ${esc(cfg.cutoff)} · <strong>${esc(b.status)}</strong>${b.status === 'live' ? ` · verdict ${b.horizonDone}/${cfg.horizonPeriods} live periods` : ''}${b.status === 'completed' ? ' · verdict window closed' : ''}`;
    const decl = `<details><summary class="note" style="cursor:pointer">protocol declaration${b.status === 'draft' ? ' — READ BEFORE DECLARING' : ''}</summary>
      <pre style="white-space:pre-wrap; font-size:12px; padding:8px; background:var(--page); border:1px solid var(--grid); border-radius:6px">${esc(b.declaration)}</pre></details>`;
    if (b.status === 'draft') {
      return `<div class="section" style="margin-top:14px">
        <p class="note">${head} · ${b.preview.trainChunks} training chunks, ${b.preview.totalChunks} total</p>
        ${decl}
        <div class="controls" style="margin-top:8px">
          <div class="field submit"><button type="button" class="bk-declare" data-id="${esc(b.id)}">Declare &amp; initialize</button></div>
          <div class="field submit"><button type="button" class="bk-discard secondary" data-id="${esc(b.id)}">Discard draft</button></div>
        </div>
      </div>`;
    }
    const statRow = (label, s, tip) => `
      <tr><td title="${esc(tip || '')}">${label}</td>
        <td>${s.trades}</td><td>${s.wins}</td>
        <td>${s.trades ? pct(s.wins / s.trades) : '—'}</td>
        <td>${money(s.pnl)}</td>
        <td>${s.grossPerTrade == null ? '—' : '$' + s.grossPerTrade.toFixed(2)}</td>
        <td>${s.tradeScored ? `${pct(s.tradeCorrect / s.tradeScored)} (${s.tradeCorrect}/${s.tradeScored})` : '—'}</td>
        <td>${s.scored ? pct(s.correct / s.scored) : '—'}</td></tr>`;
    const rows = Object.entries(b.rules).map(([r, s]) => statRow(esc(RULE_LABEL[r] || r), s, RULE_TIP[r])).join('');
    const specRows = b.specs
      ? Object.entries(b.specs).map(([k, s]) => statRow(esc(k), s, 'Individual spec, reference only — never a decision rule. Each runs its own $100 book on identical prices so you can see whether the committee beats its members.')).join('')
      : '';
    const hist = b.periods.slice(-30).reverse().map((p) => {
      const firstRule = cfg.rules[0];
      return `<tr>
        <td>${esc(p.dayOf)}</td>
        ${cfg.rules.map((r) => `<td>${clsSpan(p.calls[r])}</td>`).join('')}
        <td>${p.actual === null ? '—' : clsSpan(p.actual)}</td>
        <td>${p.entry != null ? p.entry : '—'}</td><td>${p.exit != null ? p.exit : '—'}</td>
        <td>${p.pnl && p.pnl[firstRule] != null ? money(p.pnl[firstRule]) : '—'}</td>
        <td>${esc(p.status)}${p.postHorizon ? ' · post-horizon' : ''}</td>
        <td>${p.live ? 'LIVE' : 'unseen'}</td>
      </tr>`;
    }).join('');
    return `<div class="section" style="margin-top:14px">
      <p class="note">${head}</p>
      ${decl}
      <div class="tablewrap" style="margin-top:8px"><table>
        <tr>${BK_COL_TIPS}</tr>
        ${rows}
      </table></div>
      ${specRows ? `<details style="margin-top:8px"><summary class="note" style="cursor:pointer">8 individual specs (reference — the committee's members)</summary>
      <div class="tablewrap"><table><tr>${BK_COL_TIPS}</tr>${specRows}</table></div></details>` : ''}
      <details style="margin-top:8px"><summary class="note" style="cursor:pointer">last 30 periods (calls: ${cfg.rules.map((r) => esc(RULE_LABEL[r] || r)).join(' · ')}; P&amp;L column = ${esc(RULE_LABEL[cfg.rules[0]])})</summary>
      <div class="tablewrap"><table>
        <tr><th>period</th>${cfg.rules.map((r) => `<th>${esc(r)}</th>`).join('')}<th>actual</th><th>entry</th><th>exit</th><th>P&amp;L</th><th>status</th><th>prov.</th></tr>
        ${hist}
      </table></div></details>
      ${b.status === 'live' || b.status === 'completed' ? `<div class="controls" style="margin-top:8px">
        <div class="field submit"><button type="button" class="bk-retire danger" data-id="${esc(b.id)}">Retire book</button></div>
      </div>` : ''}
      ${b.amendments && b.amendments.length ? `<p class="note">log: ${b.amendments.map((a) => `${esc(a.at.slice(0, 10))} — ${esc(a.what)}`).join(' · ')}</p>` : ''}
    </div>`;
  }

  // ---- book pager: one book per page ----------------------------------------
  // Page 1 = DOT/AVAX weekly tracker, page 2 = DOGE daily-3d (the two
  // hard-coded frozen books), pages 3+ = engine books in declaration order
  // (#1 → page 3, #2 → page 4, …; undeclared drafts trail in creation order).
  // New declarations extend the run automatically.
  let lastBooksAll = null;
  let bookPage = 1;

  function engineBooksOrdered(all) {
    if (!all) return [];
    const declared = all.books.filter((b) => b.bookNumber).sort((a, b) => a.bookNumber - b.bookNumber);
    const drafts = all.books
      .filter((b) => !b.bookNumber)
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    return [...declared, ...drafts];
  }

  function renderBookPager() {
    const list = engineBooksOrdered(lastBooksAll);
    const total = 2 + Math.max(1, list.length);
    if (bookPage > total) bookPage = total;
    if (bookPage < 1) bookPage = 1;
    const b = list[bookPage - 3];
    const title = bookPage === 1
      ? 'DOT/AVAX weekly tracker (frozen)'
      : bookPage === 2
        ? 'DOGE daily-3d (frozen)'
        : b
          ? b.bookNumber
            ? `engine book #${b.bookNumber} — ${esc(b.config.pair)} ${esc(b.config.geometry)} (${esc(b.status)})`
            : `draft — ${esc(b.config.pair)} ${esc(b.config.geometry)}`
          : 'new paper books';
    const html = `<button type="button" class="secondary" data-dir="-1"${bookPage <= 1 ? ' disabled' : ''}>&lsaquo; prev</button>
      <span class="pager-label">book ${bookPage} of ${total} &middot; ${title}</span>
      <button type="button" class="secondary" data-dir="1"${bookPage >= total ? ' disabled' : ''}>next &rsaquo;</button>`;
    for (const id of ['books-pager-top', 'books-pager-bottom']) {
      const el = $(id);
      el.hidden = false;
      el.innerHTML = html;
      el.querySelectorAll('button').forEach((btn) =>
        btn.addEventListener('click', () => {
          bookPage += Number(btn.dataset.dir);
          applyBookPage();
        })
      );
    }
    $('tracker-section').hidden = bookPage !== 1;
    $('dogebook-section').hidden = bookPage !== 2;
    $('books-section').hidden = bookPage < 3;
  }

  function applyBookPage() {
    renderBookPager();
    renderEngineView();
  }

  function renderBooks(all) {
    lastBooksAll = all;
    applyBookPage();
  }

  function renderEngineView() {
    if (bookPage < 3) return; // engine section is hidden on the frozen pages
    const all = lastBooksAll;
    if (!all) {
      bkViewEl.innerHTML = '<p class="note">Loading books…</p>';
      return;
    }
    const list = engineBooksOrdered(all);
    const active = all.books.filter((b) => b.status === 'live' || b.status === 'completed');
    const combined = active.length
      ? `<p class="note"><strong>${all.declaredCount}</strong> book(s) declared all-time — that count is the denominator
         against any winner. Active: ${active.map((b) => `#${b.bookNumber} ${esc(b.config.pair)}`).join(', ')}.</p>`
      : `<p class="note">${all.declaredCount ? `${all.declaredCount} book(s) declared all-time.` : 'No books yet.'} Create a draft above to begin.</p>`;
    const shown = list[bookPage - 3];
    bkViewEl.innerHTML = combined + (shown ? bookCard(shown) : '<p class="note">No engine books yet — create a draft above to begin.</p>');
    bkViewEl.querySelectorAll('.bk-declare').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Declare and initialize this book?\n\nThis trains and FREEZES the models, band and config permanently, '
          + 'assigns the book its number, and starts the live record. Read the protocol declaration first.\n\n'
          + 'After this the only actions are view and retire.')) return;
        try {
          bkErrEl.hidden = true;
          setBkStatus('declaring…');
          const res = await fetch(`api/books/${btn.dataset.id}/declare`, { method: 'POST' });
          const body = await jsonBody(res);
          if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
          await poll(body.jobId, setBkStatus);
          setBkStatus('');
          refreshBooks();
        } catch (err) {
          setBkStatus('');
          bkErrEl.hidden = false;
          bkErrEl.textContent = err.message;
        }
      });
    });
    bkViewEl.querySelectorAll('.bk-discard').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const res = await fetch(`api/books/${btn.dataset.id}/discard`, { method: 'POST' });
          const body = await jsonBody(res);
          if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
          refreshBooks();
        } catch (err) {
          bkErrEl.hidden = false;
          bkErrEl.textContent = err.message;
        }
      });
    });
    bkViewEl.querySelectorAll('.bk-retire').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const reason = prompt('Retiring is permanent and logged. Reason?');
        if (reason === null) return;
        try {
          const res = await fetch(`api/books/${btn.dataset.id}/retire`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason }),
          });
          const body = await jsonBody(res);
          if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
          refreshBooks();
        } catch (err) {
          bkErrEl.hidden = false;
          bkErrEl.textContent = err.message;
        }
      });
    });
  }

  async function refreshBooks(fresh = false) {
    try {
      bkErrEl.hidden = true;
      if (fresh) setBkStatus('fetching current prices…');
      const res = await fetch('api/books' + (fresh ? '/refresh' : ''), fresh ? { method: 'POST' } : undefined);
      const all = await jsonBody(res);
      setBkStatus('');
      if (!res.ok) throw new Error(all.error || `HTTP ${res.status}`);
      renderBooks(all);
    } catch (err) {
      setBkStatus('');
      bkErrEl.hidden = false;
      bkErrEl.textContent = err.message;
    }
  }

  $('bk-create').addEventListener('click', async () => {
    try {
      bkErrEl.hidden = true;
      setBkStatus('building draft preview…');
      const res = await fetch('api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair: $('bk-pair').value,
          compareSymbol: $('bk-compare').value,
          geometry: $('bk-geometry').value,
          band: $('bk-autoband').checked ? 'auto' : Number($('bk-band').value),
          startMonth: $('bk-start').value,
          cutoff: $('bk-cutoff').value,
          horizonPeriods: Number($('bk-horizon').value),
          rules: [...document.querySelectorAll('.bk-rule:checked')].map((el) => el.value),
          notes: $('bk-notes').value,
        }),
      });
      const body = await jsonBody(res);
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      await poll(body.jobId, setBkStatus);
      setBkStatus('');
      refreshBooks();
    } catch (err) {
      setBkStatus('');
      bkErrEl.hidden = false;
      bkErrEl.textContent = err.message;
    }
  });
  $('bk-refresh').addEventListener('click', () => refreshBooks(true));


  // ---- bracket lab tab -------------------------------------------------------

  const blViewEl = $('bl-view');
  const blErrEl = $('bl-error');
  const blPickEl = $('bl-pick');
  let blPicked = null; // null = follow the latest bracketlab doc
  let blTimer = null;

  function setBlStatus(text) {
    const el = $('bl-status');
    el.hidden = !text;
    el.innerHTML = text ? `<span class="spin">⟳</span>${esc(text)}` : '';
  }

  const fmtDur = (ms) => {
    if (ms == null) return '—';
    const m = Math.round(ms / 60000);
    return m < 90 ? `${m}m` : m < 60 * 48 ? `${(m / 60).toFixed(1)}h` : `${(m / 1440).toFixed(1)}d`;
  };

  function comboLabel(l) {
    return l.trade + (l.ctx1 ? '+' + l.ctx1 : '') + (l.ctx2 ? '+' + l.ctx2 : '');
  }

  // TABLES CARRY A NAME AND A KEY (owner's standing rule) — these render for
  // the owner to operate alone, so nothing is assumed known.
  function renderInspect(d, label) {
    const pc = (v) => (v == null ? '—' : (100 * v).toFixed(1) + '%');
    const sp = (v) => (v == null ? '—' : `<span class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : ''}${(100 * v).toFixed(1)}%</span>`);
    // Dumps saved before 2026-07-30 carry a third spec field ("regime") from
    // the removed near-duplicate member dimension; show it when present so
    // old records stay readable.
    const specLabel = (s) => [s.model, s.view, s.regime].filter(Boolean).map(esc).join(' · ');
    const rows = d.members.map((m) => `<tr>
      <td>${m.i + 1}</td>
      <td>${specLabel(m.spec)}</td>
      <td>${m.search ? pc(m.search.testAcc) : '—'} ${m.search ? sp(m.search.edge) : ''}</td>
      <td>${m.hold ? pc(m.hold.testAcc) : '—'} ${m.hold ? sp(m.hold.edge) : ''}</td>
      <td>${m.hold && m.hold.directionalCalls ? `${m.hold.directionalHits}/${m.hold.directionalCalls}` : '—'}</td>
      <td>${pc(m.activeHold ?? m.activeSearch)}</td>
      <td>${pc(m.withTradeHold)}</td>
    </tr>`).join('');
    const pw = d.pairwise.map((row, a) => `<tr><th title="member ${a + 1}: ${specLabel(d.members[a].spec)}">${a + 1}</th>${row.map((v, b) =>
      `<td title="${a === b ? 'same member' : v == null ? `members ${a + 1} and ${b + 1}: fewer than 5 periods where both committed — not enough to score` : `members ${a + 1} and ${b + 1} agreed on ${Math.round(100 * v)}% of the periods where both committed${v >= 0.8 ? ' — effectively one opinion counted twice' : ''}`}" class="${v != null && v >= 0.8 && a !== b ? 'pw-hot' : ''}">${a === b ? '·' : v == null ? '—' : Math.round(100 * v)}</td>`).join('')}</tr>`).join('');
    return `
      <h3>${esc(label)} — quorum ${d.quorum}, band ±${d.bandPct != null ? d.bandPct.toFixed(2) : '?'}%</h3>
      <p class="note"><strong>Member table.</strong> One row per committee member.
        KEY — <em>member</em>: model type · data view (older saved setups show a third part, a now-removed training variant).
        <em>test / held-back</em>: that member's OWN accuracy (and edge vs baseline) on each window — accuracy points, not money.
        <em>dir hits</em>: held-back directional calls it got exactly right.
        <em>active</em>: how often it commits to a direction at all.
        <em>with trade</em>: when the committee traded, how often this member voted with the traded direction —
        high for the same few members every time means one opinion echoed, not twelve.</p>
      <div class="tablewrap"><table>
        <tr><th title="Member number — matches the rows and columns of the agreement matrix below">#</th>
        <th title="What this member is: model type (logreg = weighted-sum / boost = stack of decision rules) · which slice of the data it sees (full / prices only / volume only). Setups saved before 2026-07-30 show a third part — a 'full'/'interlaced' training variant that was removed because the two variants were near-copies of each other (the 'interlaced' one never interlaced; it only dropped ~10% of the same training window)">member</th>
        <th title="This member's OWN accuracy on the TEST window, with its edge (accuracy minus the always-guess-the-commonest baseline) beside it. Accuracy points, not money. The committee's settings were chosen on this window, so these read flattering.">test</th>
        <th title="The same two figures on the HELD-BACK window — the slice nothing was chosen with. This is the pair that matters.">held-back</th>
        <th title="Held-back directional calls this member got exactly right / the directional calls it made. A call of up or down on a flat period counts as a miss.">dir hits</th>
        <th title="How often this member commits to a direction at all (held-back window). Near 0% = it almost always says 'flat' and its solo accuracy is mostly about predicting nothing happening.">active</th>
        <th title="When the COMMITTEE actually traded, how often this member's own vote matched the traded direction. High for the same few members every time = one opinion echoed; spread around = genuine shifting agreement.">with trade</th></tr>
        ${rows}</table></div>
      <p class="note"><strong>Agreement matrix (${d.pairwiseWindow} window).</strong>
        KEY — cell (a,b): of the periods where BOTH members committed to a direction, the percentage where they
        agreed. — means fewer than 5 shared commitments. Values ≥80% are highlighted: members that near-always
        agree are one opinion counted twice, so the committee may hold fewer real opinions than seats.</p>
      <div class="tablewrap"><table class="pw">
        <tr><th title="Rows and columns are member numbers from the table above"></th>${d.members.map((m) => `<th title="member ${m.i + 1}: ${specLabel(m.spec)}">${m.i + 1}</th>`).join('')}</tr>${pw}</table></div>
      <p class="note">committee at quorum ${d.quorum}: ${d.committee.holdTrades}/${d.committee.holdPeriods} held-back periods traded,
        ${d.committee.searchTrades}/${d.committee.searchPeriods} test periods.</p>`;
  }

  function renderCompare(d) {
    const m$ = (v) => (v == null ? '—' : (v < 0 ? '-' : '+') + '$' + Math.abs(v).toFixed(2));
    const shortKey = (k) => k.replace(/\|+/g, ' ').trim();
    const rows = d.paired.slice(0, 40).map((p) => `<tr>
      <td title="asset · geometry · decision rule">${esc(shortKey(p.key))}</td>
      <td class="${p.a.holdPnl >= 0 ? 'up' : 'down'}">${m$(p.a.holdPnl)}</td>
      <td>${p.a.holdTrades ?? '—'}</td>
      <td>${m$(p.a.holdPerTrade)}</td>
      <td class="blk-l ${p.b.holdPnl >= 0 ? 'up' : 'down'}">${m$(p.b.holdPnl)}</td>
      <td>${p.b.holdTrades ?? '—'}</td>
      <td>${m$(p.b.holdPerTrade)}</td>
      <td class="blk-l ${p.dHoldPnl >= 0 ? 'up' : 'down'}"><strong>${m$(p.dHoldPnl)}</strong></td>
    </tr>`).join('');
    return `
      <h3>${esc(d.arms.a)} vs ${esc(d.arms.b)} — ${d.jobs.map(esc).join(' + ')}</h3>
      ${d.warnings.map((w) => `<p class="note" style="color:#c33"><strong>${esc(w)}</strong></p>`).join('')}
      <p class="note"><strong>Paired setups table.</strong> One row per setup measured under BOTH window
        geometries — the only like-for-like comparison here, since the two arms' held-back windows are
        different calendar periods (recent stretch vs sprinkled through history).
        KEY — <em>setup</em>: asset, time-period shape, decision rule.
        <em>held-back $</em>: money the chosen cell made on that arm's held-back window, dollars per $100
        book. <em>trades</em>: trades it actually took there (differing counts between arms is a finding,
        not an error — potential trade days are forced identical, opinions are not).
        <em>$/trade</em>: money per trade, the rate that compares fairly across arms.
        <em>Δ held-back $</em>: ${esc(d.arms.b)} minus ${esc(d.arms.a)} — positive means the interlaced-side
        arm earned more. Sorted by largest absolute difference; first 40 shown, all stored.</p>
      <div class="tablewrap"><table>
        <tr><th rowspan="2" title="asset · shape · decision">setup</th>
          <th colspan="3" title="the ${esc(d.arms.a)} arm">${esc(d.arms.a)}</th>
          <th colspan="3" class="blk-l" title="the ${esc(d.arms.b)} arm">${esc(d.arms.b)}</th>
          <th rowspan="2" class="blk-l" title="${esc(d.arms.b)} held-back money minus ${esc(d.arms.a)} held-back money">Δ held-back $</th></tr>
        <tr><th>held-back $</th><th>trades</th><th>$/trade</th>
          <th class="blk-l">held-back $</th><th>trades</th><th>$/trade</th></tr>
        ${rows}</table></div>
      <p class="note"><strong>Survivor overlap.</strong> Of each arm's top 10 setups by held-back money,
        <strong>${d.survivorOverlap.sharedCount}</strong> appear in both top-10s. High overlap means the two
        geometries crown the same setups — evidence the ranking reflects the setups rather than the era the
        evaluation windows landed in. The shared ones: ${d.survivorOverlap.shared.length ? d.survivorOverlap.shared.map((k) => esc(shortKey(k))).join(', ') : '(none)'}.</p>
      <p class="note"><strong>Totals (read the label).</strong> ${esc(d.arms.a)}: ${m$(d.totals.a.holdPnl)}
        over ${d.totals.a.holdTrades} trades in ${d.totals.a.setups} setups ·
        ${esc(d.arms.b)}: ${m$(d.totals.b.holdPnl)} over ${d.totals.b.holdTrades} trades in
        ${d.totals.b.setups} setups. ${esc(d.totals.note)}</p>
      ${d.mode === 'linked' ? `<p class="note">Linked runs: every stored setting was verified identical before this comparison rendered (${d.onlyA} setups only in A, ${d.onlyB} only in B were left unpaired).</p>` : ''}`;
  }

  function renderVerdict(d) {
    const m$ = (v) => (v == null ? '—' : (v < 0 ? '-' : '+') + '$' + Math.abs(v).toFixed(2));
    const drawsTable = (t) => `<div class="tablewrap"><table>
      <tr><th>scramble</th><th>value</th></tr>
      ${t.draws.map((x) => `<tr><td>${x.shift.toFixed(3)}${x.setup ? ' · ' + esc(x.setup.replace(/\|/g, ' ')) : ''}</td>
        <td class="${t.real > x.value ? 'up' : 'down'}">${m$(x.value)}</td></tr>`).join('')}
    </table></div>`;
    const block = (title, t, what) => t ? `
      <h3>${title} — ${t.passes ? 'PASS' : 'FAIL'} (beats ${t.beats}/${t.n})</h3>
      <p class="note">${what}
        KEY — <em>real</em>: held-back dollars on genuine data. <em>scrambles</em>: the same quantity in
        worlds with nothing to predict. Beating all ${t.n} is the strongest claim ${t.n} draws allow
        (p floor ${t.pFloor ? t.pFloor.toFixed(3) : '—'}) — a floor, never a measure of strength.</p>
      <p><strong>real ${m$(t.real)}</strong>${t.realBestSetup ? ' (' + esc((t.setup || t.realBestSetup).replace(/\|/g, ' ')) + ')' : t.setup ? ' (' + esc(t.setup.replace(/\|/g, ' ')) + ')' : ''}
        vs scrambles: best ${m$(Math.max(...t.draws.map((x) => x.value)))}, worst ${m$(Math.min(...t.draws.map((x) => x.value)))}</p>
      ${drawsTable(t)}` : '';
    return `
      <p class="note">real: ${esc(d.realJob)} · scrambles: ${esc(d.nullJob)} (${d.drawCount} draws)</p>
      ${block('Per-setup test', d.perSetup, 'Is this setup better than ITS OWN noise? Same setup, same machinery, scrambled outcomes.')}
      ${block('Selection-aware test', d.selection, 'Is topping the board better than topping a NOISE board? Each scramble contributes its own best-of-board — this prices in that the winner was picked after looking.')}
      <p class="note">sanity: ${d.sanity.scrambleRows} scrambled setups, ${(100 * d.sanity.negativeShare).toFixed(1)}% losing money —
        ${d.sanity.ok ? 'as fees demand.' : '<strong>NOISE IS PROFITING: the simulation is broken; do not read the tests above.</strong>'}</p>
      <p class="note"><strong>What a pass buys:</strong> this window only. It stops obvious luck being frozen;
        the forward paper test after freezing is the real judge.</p>`;
  }

  function renderBracket(doc) {
    if (!doc) {
      blViewEl.innerHTML = '<p class="note">No bracket-lab sweeps yet — set the controls and Start sweep.</p>';
      return;
    }
    const p = doc.params;
    const perf = doc.perf || {};
    const running = doc.status === 'running';
    const sel = doc.selection;
    const permuted = Object.entries(p.permute || {}).filter(([, v]) => v).map(([k]) => k);
    const header = `${esc(doc.id)} — ${esc(doc.status)}${running && doc.progress ? ' — ' + esc(doc.progress) : ''}`;
    const planLine = doc.plan
      ? `${doc.plan.combos} combos × ${doc.plan.branches} branch(es) = ${doc.plan.units} units · slim runs ${doc.plan.slimRuns}`
        + (doc.plan.promoteRuns != null ? ` · promote runs ${doc.plan.promoteRuns}` : '')
      : '';
    // WHAT THIS RUN IS FOR, stated on the page rather than only in an email.
    const descBlock = doc.description
      ? `<p class="jobdesc">${esc(doc.description)}</p>`
      : '<p class="jobdesc jobdesc-missing">No description was recorded for this run.</p>';

    // EVERY SETTING THAT SHAPES THE RESULT, on the page, for the job actually
    // running (owner, 2026-07-29). Previously the note listed the execution
    // grid only, so the things that decide what a number MEANS — whether a
    // holdout was held back, whether the outcomes were scrambled and how, and
    // whether the census was kept off the money-ranked board — were invisible
    // here and had to be taken on trust from whatever launched the job. A
    // dropped setting has already invalidated one conclusion on this project;
    // this is the page where that becomes visible instead of silent.
    const yn = (v) => (v ? '<strong>on</strong>' : 'off');
    const nullDesc = p.labelShiftReps > 0
      ? `<strong>${p.labelShiftReps} scramble(s)</strong>, ${esc(p.labelShiftScope || 'series')}-scope`
      : (p.labelShiftFrac ? `1 scramble, ${esc(p.labelShiftScope || 'series')}-scope` : '<strong>none — real outcomes</strong>');
    const settingsBlock = `
      <table class="settings">
        <tr><th>Outcomes</th><td>${nullDesc}</td>
            <th>Held-back slice</th><td>${p.holdout ? '<strong>yes</strong> — 70/15/15' : 'no — 80/20, nothing held back'}</td></tr>
        <tr><th>Census</th><td>${yn(p.edgeScreen)}${p.edgeScreen ? ' — every unit recorded, not just money winners' : ''}</td>
            <th>Trailing stops</th><td>${yn(p.trailing)}</td></tr>
        <tr><th>Universe</th><td>${(p.universe || []).length} symbols${p.set && p.set.geometry ? '' : ''}</td>
            <th>Sizes</th><td>${Object.entries(p.sizes || {}).filter(([, v]) => v).map(([k]) => esc(k)).join(', ') || '—'}</td></tr>
        <tr><th>Permuted</th><td>${permuted.length ? esc(permuted.join(', ')) : 'nothing — single branch'}</td>
            <th>Fixed</th><td>${esc((p.set && p.set.geometry) || '—')} · ${esc((p.set && p.set.decision) || '—')} · band ${esc(String((p.set && p.set.band) || '—'))}</td></tr>
        <tr><th>Execution grid</th><td>d ${p.dMults.join('/')}×band · t ${p.tHours.join('/')}h · gates ${p.gates.join('/')} · entry ${(p.entries || ['breakout']).join('/')}</td>
            <th>Fees</th><td>$${(2 * p.feePerLeg).toFixed(2)} per round trip</td></tr>
        <tr><th>Selection rule</th><td>top net $ with ≥${p.minTrades} trades</td>
            <th>Promoted</th><td>top ${p.promoteK}</td></tr>
      </table>`;

    const perfBlock = `
      <div class="section"><h2>Progress &amp; performance</h2>
      ${descBlock}
      <p class="note">${planLine}</p>
      ${settingsBlock}
      <div class="tiles">
        ${tile('Phase', esc(perf.phase || '—'), running ? 'running' : esc(doc.status))}
        ${tile('Units', `${perf.unitsDone ?? 0} / ${perf.unitsTotal ?? '—'}`, 'combo × branch permutations')}
        ${tile('Trainings', `${perf.runsDone ?? 0} / ${perf.runsTotal ?? '—'}`, 'the raw denominator count')}
        ${tile('Rate', perf.ratePerMin ? perf.ratePerMin.toFixed(1) + '/min' : '—', (perf.secPerTraining ? perf.secPerTraining.toFixed(1) + 's/training' : '') + (perf.workers > 1 ? ` · ${perf.workers} threads` : ''))}
        ${tile('Elapsed', fmtDur(perf.elapsedMs), '')}
        ${tile('ETA', running ? fmtDur(perf.etaMs) : '—', running ? 'at current pace' : 'finished')}
      </div>
      ${doc.failures && doc.failures.length ? `<p class="note">${doc.failures.length} unit(s) failed — first: ${esc(doc.failures[0].key)}: ${esc(doc.failures[0].error)}</p>` : ''}
      </div>`;

    // Market cells have no rails, so no distance — printing "d null×" would
    // be worse than useless. They are the classifier's own trade and read as
    // such.
    const execCell = (r) => (r.entry === 'market'
      ? `market entry<div class="cellsub">at open · t ${r.tHours}h</div>`
      : `${esc(r.gate)}${r.trailMult != null ? ` · trail ${r.trailMult}×/arm ${r.armMult}×` : ''}<div class="cellsub">d ${r.dMult}× · t ${r.tHours}h${r.trailAmbiguous ? ` · <strong>${r.trailAmbiguous} trail-amb</strong>` : ''}</div>`);
    const pct = (v) => (v == null ? '—' : (100 * v).toFixed(1) + '%');
    const signedPct = (v) => (v == null ? '—' : `<span class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : ''}${(100 * v).toFixed(1)}%</span>`);
    const leadRows = (doc.leaders || []).map((l, i) => {
      const selectable = !running && l.stage === 'promoted';
      const isSel = sel && sel.key === l.key && sel.stage === l.stage;
      const band = `${l.bandMode === 'auto' ? 'auto→' : ''}±${l.bandPct != null ? l.bandPct.toFixed(2) : '?'}%`;
      const h = l.holdout || null;
      const hm = h && h.metrics ? h.metrics : null;
      // The tuning-window figures, compressed: stacked pairs in the small
      // light style. These are the numbers the row was PICKED on — flattering
      // by construction, so they get the quiet styling on purpose.
      const tuneBlock = `
        <td class="tune blk-l">${money(l.pnl)}
          <div class="cellsub">${l.gate === 'always' || l.controlPnl == null ? '—' : 'vs ' + money(l.pnl - l.controlPnl)}</div></td>
        <td class="tune">${l.metrics ? pct(l.metrics.testAcc) : '—'}
          <div class="cellsub">${l.metrics ? signedPct(l.metrics.edge) : ''}</div></td>
        <td class="tune">${l.wins}/${l.trades}
          <div class="cellsub">${l.grossPerTrade != null ? '$' + l.grossPerTrade.toFixed(2) : ''}</div></td>
        <td class="tune">${l.stops}${l.ambiguous ? `<div class="cellsub">${l.ambiguous} amb</div>` : ''}</td>`;
      // The held-back figures, full size: nothing was chosen using this
      // window, so these are the ones that matter.
      const holdBlock = h ? `
        <td class="blk-l"><strong>${money(h.pnl)}</strong></td>
        <td>${hm ? pct(hm.testAcc) : '—'}
          <div class="cellsub">${hm ? 'base ' + pct(hm.majorityBaseline) : ''}</div></td>
        <td>${hm ? signedPct(hm.edge) : '—'}
          <div class="cellsub">${hm && hm.directionalCalls ? hm.directionalHits + '/' + hm.directionalCalls + ' dir' : ''}</div></td>
        <td>${h.wins}/${h.trades}
          <div class="cellsub">${h.grossPerTrade != null ? 'g/t $' + h.grossPerTrade.toFixed(2) : '—'}</div></td>
        <td>${h.stops}${h.ambiguous ? `<div class="cellsub">${h.ambiguous} amb</div>` : ''}</td>`
        : '<td class="blk-l note" colspan="5">no held-back window in this run</td>';
      // Arm-aware: on a 'both' run the same setup exists once per layout,
      // and the wrong pick would open the other arm's members (audit
      // 2026-07-30). Rows and leaders without layout info match as before.
      const censusRow = (doc.edgeCensus || []).find((r) => !r.shiftFrac
        && r.trade === l.trade && r.geometry === l.geometry && r.decision === l.decision
        && (!l.layoutArm || r.windowLayout === l.layoutArm));
      const dumpFile = censusRow && censusRow.modelFile ? censusRow.modelFile.split('/').pop() : null;
      return `<tr class="${l.stage === 'promoted' ? 'hilite' : ''}">
        <td>${selectable ? `<input type="radio" name="bl-sel" class="bl-sel" data-key="${esc(l.key)}" data-stage="${esc(l.stage)}" ${isSel ? 'checked' : ''}>` : ''}
          ${l.stage === 'promoted' && dumpFile ? `<button class="bl-inspect" data-file="${esc(dumpFile)}" data-quorum="${l.quorum}" data-label="${esc(comboLabel(l))} ${esc(l.geometry)} ${esc(l.decision)}" title="Open this setup's committee members individually">inspect</button>` : ''}</td>
        <td>${i + 1}</td>
        <td><strong>${esc(comboLabel(l))}</strong> <span class="bl-stage">${l.stage === 'promoted' ? 'prom' : 'slim'}</span>
          <div class="cellsub">${esc(l.geometry)} · ${band} · ${esc(l.decision)} · ${l.weekdaysOnly ? '24/5' : '24/7'}</div></td>
        <td>q${l.quorum}/${l.members} · ${execCell(l)}</td>
        ${tuneBlock}
        ${holdBlock}
      </tr>`;
    }).join('');
    // Did this run hold anything back? A legacy run with the box unticked did
    // not, and everything that reads held-back numbers has to say so rather
    // than render empty (owner, 2026-07-31).
    const hasHold = (doc.leaders || []).some((l) => l.holdout)
      || (doc.edgeCensus || []).some((r) => r.holdPnl != null);
    const leaderBlock = `
      <div class="section"><h2>${running ? 'Live leaderboard — reranks as combos complete' : 'Survivor board'}</h2>
      ${running ? '<p class="note">Interim numbers move until the sweep completes — for watching, not for stopping early. The promote rule fires mechanically at completion.</p>' : ''}
      ${hasHold ? `<p class="note"><strong>Sorted by HELD-BACK net P&L</strong> (rows under the min-trades floor sink).
        The top row is a <strong>LEAD to declare and test on fresh data — never a result</strong>: ranking 170
        setups on the held-back window makes the top figure the best of 170 draws. The evidence is the
        aggregate census against its scrambled comparisons, which is not selected on anything.</p>`
        : `<p class="note"><strong>Sorted by TEST-WINDOW net P&L — this run held nothing back.</strong>
        Every row won its own settings on this same window, so the ranking is a ranking of how well each
        setup fitted the data it was fitted on. It cannot say whether anything works out of sample, and
        the null tests below are unavailable for this run. Tick "hold back a final 15%" (or pick the
        chronological or interlaced layout) to get a board that can.</p>`}
      <div class="tablewrap"><table class="bl-board">
        <tr class="grp-row"><th colspan="4"></th>
          <th colspan="4" class="grp grp-tune blk-l" title="Numbers from the TEST window — the window each row's trading settings were chosen on. Flattering by construction: the row won because it scored best here.">TEST WINDOW — where settings were chosen</th>
          <th colspan="5" class="grp grp-hold blk-l" title="Scored ONCE with settings already committed. Nothing was chosen using this window.">HELD-BACK — what matters</th></tr>
        <tr><th title="Pick a PROMOTED row as the null-test candidate"></th><th>#</th>
        <th title="Combo and stage; second line: chunk shape · band · decision · week mode">setup</th>
        <th title="Quorum rung (net direction wins) and how the position is opened. BREAKOUT cells state a gate plus the rail distance d×band; MARKET cells enter at the entry candle's open in the called direction with no rails — the general classifier's own trade, and what the live paper books do.">execution</th>
        <th class="tune blk-l" title="Test-window net P&L over vs-control. vs-control can NEVER be negative here: the row was picked as the best cell of a menu already containing every always-gate (model-free) cell. It says how much gating won by, not that gating works.">P&L<div class="cellsub">vs ctl*</div></th>
        <th class="tune" title="Test-window accuracy over edge (accuracy minus the training-mix baseline). Accuracy points, not money.">acc<div class="cellsub">edge</div></th>
        <th class="tune" title="Test-window wins/trades over gross per trade before the round-trip fee">W/T<div class="cellsub">g/t</div></th>
        <th class="tune" title="Test-window trades closed by the stop rail">st</th>
        <th class="blk-l" title="Held-back net dollars after fees, the sort key">net P&L</th>
        <th title="Held-back accuracy; second line the majority baseline it is scored against">acc</th>
        <th title="Held-back accuracy minus baseline; second line directional hits/calls">edge</th>
        <th title="Held-back wins/trades; second line gross per trade before the round-trip fee">W/T · g/t</th>
        <th title="Held-back trades closed by the stop rail; (n amb) = bars spanning both rails, resolved AGAINST the book">stops</th></tr>
        ${leadRows || '<tr><td colspan="13" class="note">nothing on the board yet</td></tr>'}
      </table></div>
      <p class="note">* <strong>vs control on a search board is not evidence.</strong> Each row is the best
        cell of a menu that already contains every always-gate (model-free) cell, so a row whose winner
        is gated has beaten the control by construction — the column can only ever come out positive or
        blank. It says how much gating won by; it does not say gating works. The column means something
        only in the replication table below, where the cell is DECLARED before the run and the control
        still gets its full search.</p></div>`;

    // Replication view: the declared cell scored on every asset. This is the
    // honest cross-asset reading — one look per asset, so the binomial across
    // them owes no shopping tax and no branch correction.
    let repBlock = '';
    if (p.declared) {
      const rows = doc.replication || [];
      const scored = rows.filter((r) => r.pnl != null);
      const withCtl = scored.filter((r) => r.vsControl != null);
      const pos = scored.filter((r) => r.pnl > 0).length;
      const posVsCtl = withCtl.filter((r) => r.vsControl > 0).length;
      const binomTailRep = (k, n) => {
        if (!n) return null;
        const c = (nn, ii) => { let r = 1; for (let j = 0; j < ii; j++) r = (r * (nn - j)) / (j + 1); return r; };
        let acc = 0;
        for (let i = k; i <= n; i++) acc += c(n, i) * Math.pow(0.5, n);
        return acc;
      };
      const pPos = binomTailRep(pos, scored.length);
      const pCtl = binomTailRep(posVsCtl, withCtl.length);
      const q = p.declared.quorumRatio ? Math.round(p.declared.quorumRatio * 100) + '% of members' : p.declared.quorum;
      repBlock = `
        <div class="section"><h2>Replication — declared config on every asset</h2>
        <p class="note">Declared before the run: <strong>${p.declared.entry === 'market'
            ? `market entry (at the open, called direction) · t ${p.declared.tHours}h`
            : `${esc(p.declared.gate)} gate · d ${p.declared.dMult}× · t ${p.declared.tHours}h`} ·
          quorum ${esc(String(q))}</strong>. One fixed cell scored on each asset — a single
          look apiece, so there is NO shopping tax and no branch correction owed. The reading is the binomial across
          assets, never any single row.</p>
        <div class="tiles">
          ${tile('Positive dollars', `${pos} / ${scored.length}`, pPos == null ? '' : `binomial p = ${pPos.toFixed(4)} (chance = 50%)`, true)}
          ${tile('Positive vs control', `${posVsCtl} / ${withCtl.length}`, pCtl == null ? '' : `binomial p = ${pCtl.toFixed(4)}`)}
        </div>
        <div class="tablewrap" style="margin-top:10px"><table class="bl-board">
          <tr><th>asset</th><th>band</th><th>quorum</th><th>net P&L</th><th>vs control</th><th title="Exact 3-class match rate of the committee's calls">acc</th><th title="Accuracy minus the training-majority baseline">edge</th><th title="Net minus the SAME execution with the direction forced long on every period — identical period count, horizon and fee load. Isolates the calls by holding everything else fixed: a setup that cannot beat 'be long every period' has not earned its complexity.">vs always-long</th><th title="Net minus buying at the first entry and selling at the last exit — one position, one round trip. The classic benchmark, and the one that answers 'why not just buy it and go away?'">vs buy-hold</th><th title="The SAME cell re-run on the final 15% that no search ever touched, scored once. Second line: trades, and its own vs-always-long. This is the only column on this page that no selection process has shopped in.">HOLDOUT</th><th>W/T</th><th>gross/trade</th><th>stops</th></tr>
          ${rows.map((r) => `<tr>
            <td><strong>${esc(r.trade + (r.ctx1 ? '+' + r.ctx1 : '') + (r.ctx2 ? '+' + r.ctx2 : ''))}</strong></td>
            <td>±${r.bandPct != null ? r.bandPct.toFixed(2) : '?'}%</td>
            <td>${r.quorum}/${r.members}</td>
            <td><span class="${r.pnl >= 0 ? 'up' : 'down'}"><strong>${money(r.pnl)}</strong></span></td>
            <td>${r.vsControl == null ? '—' : `<span class="${r.vsControl >= 0 ? 'up' : 'down'}">${money(r.vsControl)}</span>`}</td>
            <td>${r.metrics ? pct(r.metrics.testAcc) : '—'}</td>
            <td>${r.metrics ? signedPct(r.metrics.edge) : '—'}</td>
            <td>${r.vsAlwaysLong == null ? '—' : `<span class="${r.vsAlwaysLong >= 0 ? 'up' : 'down'}">${money(r.vsAlwaysLong)}</span>`}</td>
            <td>${r.vsBuyHold == null ? '—' : `<span class="${r.vsBuyHold >= 0 ? 'up' : 'down'}">${money(r.vsBuyHold)}</span>`}</td>
            <td>${!r.holdout ? '—' : `<span class="${r.holdout.pnl >= 0 ? 'up' : 'down'}"><strong>${money(r.holdout.pnl)}</strong></span>
              <div class="cellsub">${r.holdout.trades}t · vsAL ${money(r.holdout.vsAlwaysLong)}${r.holdout.trailAmbiguous ? ` · ${r.holdout.trailAmbiguous} amb` : ''}</div>`}</td>
            <td>${r.wins}/${r.trades}</td>
            <td>${r.grossPerTrade != null ? '$' + r.grossPerTrade.toFixed(2) : '—'}</td>
            <td>${r.stops}${r.ambiguous ? ` <span class="cellsub">${r.ambiguous} amb</span>` : ''}</td></tr>`).join('')
            || '<tr><td colspan="13" class="note">no declared-cell results yet — they fill in during the promote phase</td></tr>'}
        </table></div></div>`;
    }

    let nullBlock = '';
    if (sel && !running) {
      nullBlock += `<div class="controls" style="margin:8px 0">
        <div class="field"><label for="bl-shifts">Null shifts</label><input id="bl-shifts" type="number" min="1" max="1000" step="1" value="200"></div>
        <div class="field submit"><button id="bl-null-go" type="button"
          title="Replays everything downstream of the combo per rotation: full member grid retrained, whole execution menu + quorum rungs swept, best cell taken by the same rule. The combo-search multiplicity is NOT replayed — read against the stamped denominator.">Fire null on selected survivor</button></div>
        <span class="note">selected: ${esc(comboLabel(sel))} ${esc(sel.geometry)} q${sel.quorum} ${sel.entry === 'market' ? 'market' : `${esc(sel.gate)} ${sel.dMult}×`} ${sel.tHours}h → ${money(sel.pnl)}</span>
      </div>`;
    }
    if (doc.nullTest) {
      const nt = doc.nullTest;
      const title = nt.status === 'running'
        ? `Null replay — RUNNING: ${nt.shifts} of ${nt.requestedShifts} rotations banked`
        : `Null replay — ${nt.status}, ${nt.shifts} rotations`;
      nullBlock += `<div class="section"><h2>${title}</h2>
        <div class="tablewrap"><table>
          <tr><th>reading</th><th>exceed</th><th>null median $</th></tr>
          <tr><td title="Per rotation the null gets the WHOLE downstream search (menu + quorums + best-cell rule) — the honest, search-replayed p-value for this survivor given its combo">best-of-menu vs real ${money(nt.real ? nt.real.pnl : 0)}</td>
            <td><strong>${nt.exceedSearch != null ? pct(nt.exceedSearch) : '—'}</strong> of ${nt.shifts}</td>
            <td>${nt.medianBestPnl != null ? money(nt.medianBestPnl) : '—'}</td></tr>
          <tr><td title="Only the selected cell's own config per rotation — the conditional reading">same-config only</td>
            <td>${nt.exceedSame != null ? pct(nt.exceedSame) : '—'}</td>
            <td>${nt.medianSamePnl != null ? money(nt.medianSamePnl) : '—'}</td></tr>
        </table></div>
        <p class="note">The combo itself was chosen from ${doc.plan ? doc.plan.units : '?'} searched units — that multiplicity is
          not replayed here and must be read against the stamp. A forward book remains the only clean test.</p></div>`;
    }

    // INSIDE VIEW + NULL TESTS — owner-operable, read-only over stored data
    // (owner, 2026-07-30: every check runnable from the interface,
    // generalized, not just the ones that matter for one row).
    const inspectBlock = `
      <div class="section"><h2>Inside a setup — the committee members individually</h2>
      <p class="note">Click <em>inspect</em> on any promoted row above. Runs from 2026-07-30 onward
        save every member's fitted model, votes and solo scores; older runs saved nothing and will say so.</p>
      <div id="bl-inspect-out"></div></div>`;
    const verdictBlock = !hasHold ? `
      <div class="section"><h2>Null tests — is a result better than scrambled data?</h2>
      <p class="note"><strong>Unavailable for this run: nothing was held back.</strong> Both tests compare
        held-back money against the same figure in scrambled worlds, and this run has no held-back window
        to compare. Re-run it with the holdout on (or under the chronological or interlaced layout) and
        the tests apply.</p></div>` : `
      <div class="section"><h2>Null tests — is a result better than scrambled data?</h2>
      <p class="note">Compares a REAL run against a SCRAMBLE run (both already on disk — this fires nothing).
        Two tests: <strong>per-setup</strong> (is this setup better than its own noise?) and
        <strong>selection-aware</strong> (is topping the board better than topping a noise board? —
        the honest test for any row picked off a board, since the best of 170 looks good even on noise).</p>
      <p class="note">real run <select id="bl-v-real"></select>
        scramble run <select id="bl-v-null"></select>
        setup <select id="bl-v-setup"><option value="">— board best only —</option></select>
        <button id="bl-v-go">run the tests</button></p>
      <div id="bl-verdict-out"></div></div>`;
    const compareBlock = `
      <details class="archived section-archive"><summary title="Part of the retired window-layout instrument (QC 57): compares the chronological and interlaced arms of the recorded runs. Kept for reading the historical record; new comparisons come from the walk-forward instrument.">archived — layout comparison (historical runs)</summary>
      <div class="section"><h2>Layout comparison — same settings, two window geometries</h2>
      <p class="note">Compares the <strong>chronological</strong> and <strong>interlaced</strong> arms of one
        run (or two separate runs). Two separate runs link ONLY when every stored setting matches — the
        comparison refuses otherwise and names the differences, so nothing gets compared that is not
        comparable. Fires no compute; reads stored results.</p>
      <p class="note">run A <select id="bl-c-a"></select>
        run B <select id="bl-c-b"><option value="">— A is a "both" run —</option></select>
        <button id="bl-c-go">compare</button></p>
      <div id="bl-compare-out"></div></div></details>`;
    blViewEl.innerHTML = `<p class="note">${header}</p>${perfBlock}${repBlock}${leaderBlock}${inspectBlock}${verdictBlock}${compareBlock}${nullBlock}`;
    // ---- inside view ------------------------------------------------------
    blViewEl.querySelectorAll('.bl-inspect').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const out = $('bl-inspect-out');
        out.innerHTML = '<p class="note">reading the saved members…</p>';
        try {
          const r = await fetch(`api/bracketlab/${encodeURIComponent(doc.id)}/inspect?file=${encodeURIComponent(btn.dataset.file)}&quorum=${encodeURIComponent(btn.dataset.quorum)}`);
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || r.status);
          out.innerHTML = renderInspect(d, btn.dataset.label);
          out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (err) {
          out.innerHTML = `<p class="note">could not inspect: ${esc(err.message)}</p>`;
        }
      });
    });

    // ---- null tests ---------------------------------------------------------
    (async () => {
      const realSel = $('bl-v-real');
      const nullSel = $('bl-v-null');
      const setupSel = $('bl-v-setup');
      if (!realSel || !nullSel || !setupSel) return; // panel not rendered (no held-back window)
      try {
        const r = await fetch('api/bracketlab/verdict-sources');
        const d = await r.json();
        const srcs = d.sources || [];
        realSel.innerHTML = srcs.filter((x) => x.realRows > 0)
          .map((x) => `<option value="${esc(x.id)}" ${x.id === doc.id ? 'selected' : ''}>${esc(x.id)} (${x.realRows} real)</option>`).join('');
        nullSel.innerHTML = srcs.filter((x) => x.scrambleDraws > 0)
          .map((x) => `<option value="${esc(x.id)}">${esc(x.id)} (${x.scrambleDraws} scrambles)</option>`).join('');
        const cA = $('bl-c-a');
        const cB = $('bl-c-b');
        if (cA) {
          const layoutTag = (x) => x.windowLayout && x.windowLayout !== 'legacy' ? ` [${x.windowLayout}]` : '';
          const opts = srcs.filter((x) => x.realRows > 0)
            .map((x) => `<option value="${esc(x.id)}">${esc(x.id)}${esc(layoutTag(x))}</option>`).join('');
          cA.innerHTML = opts;
          cB.innerHTML = '<option value="">— A is a "both" run —</option>' + opts;
        }
      } catch { /* dropdowns stay empty; the button will say why */ }
      (doc.leaders || []).filter((l) => l.stage === 'promoted').forEach((l) => {
        const o = document.createElement('option');
        o.value = JSON.stringify({
          trade: l.trade, geometry: l.geometry, decision: l.decision,
          ...(l.layoutArm ? { windowLayout: l.layoutArm } : {}),
        });
        o.textContent = `${comboLabel(l)} · ${l.geometry} · ${l.decision}${l.layoutArm ? ` · ${l.layoutArm}` : ''}`;
        setupSel.appendChild(o);
      });
      $('bl-v-go').addEventListener('click', async () => {
        const out = $('bl-verdict-out');
        out.innerHTML = '<p class="note">comparing against the scrambled worlds…</p>';
        const body = { realId: realSel.value, nullId: nullSel.value };
        if (setupSel.value) Object.assign(body, JSON.parse(setupSel.value));
        try {
          const r = await fetch('api/bracketlab/null-verdict', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || r.status);
          out.innerHTML = renderVerdict(d);
        } catch (err) {
          out.innerHTML = `<p class="note">could not run the tests: ${esc(err.message)}</p>`;
        }
      });
      const cGo = $('bl-c-go');
      if (cGo) cGo.addEventListener('click', async () => {
        const out = $('bl-compare-out');
        out.innerHTML = '<p class="note">reading both arms…</p>';
        try {
          const body = { a: $('bl-c-a').value };
          if ($('bl-c-b').value) body.b = $('bl-c-b').value;
          const r = await fetch('api/bracketlab/compare', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || r.status);
          out.innerHTML = renderCompare(d);
        } catch (err) {
          out.innerHTML = `<p class="note">could not compare: ${esc(err.message)}</p>`;
        }
      });
    })();

    blViewEl.querySelectorAll('.bl-sel').forEach((radio) => {
      radio.addEventListener('change', async () => {
        if (!radio.checked) return;
        try {
          blErrEl.hidden = true;
          const res = await fetch(`api/bracketlab/${encodeURIComponent(doc.id)}/select`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: radio.dataset.key, stage: radio.dataset.stage }),
          });
          const body = await jsonBody(res);
          if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
          blPicked = doc.id;
          refreshBracket();
        } catch (err) { blErrEl.hidden = false; blErrEl.textContent = err.message; }
      });
    });
    const nullGo = blViewEl.querySelector('#bl-null-go');
    if (nullGo) nullGo.addEventListener('click', async () => {
      try {
        blErrEl.hidden = true;
        const res = await fetch(`api/bracketlab/${encodeURIComponent(doc.id)}/null`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shifts: Number(blViewEl.querySelector('#bl-shifts').value) || 200 }),
        });
        const body = await jsonBody(res);
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        blPicked = doc.id;
        refreshBracket();
      } catch (err) { blErrEl.hidden = false; blErrEl.textContent = err.message; }
    });
  }

  async function refreshBracket() {
    try {
      blErrEl.hidden = true;
      const listRes = await fetch('api/batches');
      const list = (await jsonBody(listRes)).batches.filter((b) => b.id.startsWith('bracketlab-'));
      blPickEl.innerHTML = list.map((b) => `<option value="${esc(b.id)}"${b.id === blPicked ? ' selected' : ''}>${esc(b.id)} (${esc(b.status)})</option>`).join('');
      const id = blPicked || (list[0] && list[0].id);
      if (!id) { renderBracket(null); return; }
      const res = await fetch(`api/batch/${encodeURIComponent(id)}`);
      const doc = await jsonBody(res);
      if (!res.ok) throw new Error(doc.error || `HTTP ${res.status}`);
      renderBracket(doc);
      clearTimeout(blTimer);
      if (doc.status === 'running') blTimer = setTimeout(refreshBracket, 5000);
    } catch (err) {
      blErrEl.hidden = false;
      blErrEl.textContent = err.message;
    }
  }

  blPickEl.addEventListener('change', () => { blPicked = blPickEl.value; refreshBracket(); });
  $('bl-refresh').addEventListener('click', refreshBracket);
  $('bl-stop').addEventListener('click', async () => {
    if (!confirm('Stop the running sweep? Everything completed so far stays persisted.')) return;
    try {
      const res = await fetch('api/abort', { method: 'POST' });
      const body = await jsonBody(res);
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setBlStatus(body.cancelledBatch ? `stopping ${body.cancelledBatch}…` : 'nothing running — in-flight training aborted');
      setTimeout(() => { setBlStatus(''); refreshBracket(); }, 2500);
    } catch (err) { blErrEl.hidden = false; blErrEl.textContent = err.message; }
  });
  // Market entry has no gate and no rail distance. Hide them rather than
  // leaving controls on screen whose values would be refused by the server.
  const blSyncEntry = () => {
    const market = $('bl-dec-entry').value === 'market';
    $('bl-dec-gate-wrap').style.display = market ? 'none' : '';
    $('bl-dec-d-wrap').style.display = market ? 'none' : '';
    $('bl-dec-trail-wrap').style.display = market ? 'none' : '';
    // arm means nothing without a trail
    $('bl-dec-arm-wrap').style.display = market || !$('bl-dec-trail').value ? 'none' : '';
  };
  $('bl-dec-entry').addEventListener('change', blSyncEntry);
  $('bl-dec-trail').addEventListener('change', blSyncEntry);
  blSyncEntry();

  // The 8-member box exists only when the run will contain 8-member
  // committees — i.e. when doubles or triples are ticked (owner, 2026-07-31).
  // Each agreement box exists only when the run will contain committees of
  // that size (owner, 2026-07-31): 6 members for singles, 8 with contexts.
  const syncQ = () => {
    const anySize = $('bl-singles').checked || $('bl-doubles').checked || $('bl-triples').checked;
    // GREY OUT, NEVER HIDE (owner, 2026-07-31). Both boxes stay where they
    // are so the row keeps its shape and the "agree" label keeps its
    // context; the one whose committee size this run will not contain is
    // simply disabled. Controls that appear and vanish move everything
    // around them.
    const setOff = (wrapId, selId, off, why) => {
      $(selId).disabled = off;
      $(wrapId).classList.toggle('ctl-off', off);
      $(wrapId).title = off ? why : '';
    };
    setOff('bl-dec-q6-wrap', 'bl-dec-q6', !$('bl-singles').checked,
      'this run has no single-coin committees — tick "singles" to set their agreement level');
    setOff('bl-dec-q8-wrap', 'bl-dec-q8', !($('bl-doubles').checked || $('bl-triples').checked),
      'this run has no context committees — tick "doubles" or "triples" to set their agreement level');
    // A run with no combo size ticked has nothing to sweep; the server
    // refuses it, so the button says so up front rather than letting the
    // click produce an error (owner, 2026-07-31).
    const btn = $('bl-start-btn');
    btn.disabled = !anySize;
    btn.title = anySize ? '' : 'tick at least one combo size (singles, doubles or triples)';
  };
  ['bl-singles', 'bl-doubles', 'bl-triples'].forEach((id) => $(id).addEventListener('change', syncQ));
  syncQ();

  // The holdout checkbox only decides anything under the legacy layout: the
  // chronological and interlaced layouts are three-window by construction and
  // force it on. Show that instead of letting the box sit there lying.
  const syncHoldout = () => {
    const forced = $('bl-layout').value !== 'legacy';
    const box = $('bl-holdout');
    if (forced) { box.checked = true; box.disabled = true; } else { box.disabled = false; }
    $('bl-holdout-note').hidden = !forced;
  };
  $('bl-layout').addEventListener('change', syncHoldout);
  syncHoldout();

  $('bl-start-btn').addEventListener('click', async () => {
    try {
      blErrEl.hidden = true;
      const uni = $('bl-universe').value.trim();
      const bandRaw = $('bl-band').value.trim().toLowerCase();
      const body = {
        universe: uni ? uni.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) : undefined,
        sizes: { singles: $('bl-singles').checked, doubles: $('bl-doubles').checked, triples: $('bl-triples').checked },
        startMonth: $('bl-start').value,
        endMonth: $('bl-end').value,
        allLoaded: $('bl-allloaded').checked,
        permute: {
          geometry: $('bl-perm-geometry').checked,
          decision: $('bl-perm-decision').checked,
          band: $('bl-perm-band').checked,
          weekdays: $('bl-perm-weekdays').checked,
        },
        set: {
          geometry: $('bl-geometry').value,
          decision: $('bl-decision').value,
          band: bandRaw === 'auto' || bandRaw === '' ? 'auto' : Number(bandRaw),
          weekdaysOnly: $('bl-weekdays').checked,
        },
        promoteK: Number($('bl-promotek').value) || 25,
        minTrades: Number($('bl-mintrades').value) || 10,
        trailing: $('bl-trailing').checked,
        holdout: $('bl-holdout').checked,
        windowLayout: $('bl-layout').value,
        interlaceSeed: Number($('bl-ilseed').value) || 1,
        sharedBand: $('bl-sharedband').checked,
      };
      if ($('bl-declared-on').checked) {
        const entry = $('bl-dec-entry').value;
        // Market entry has no gate and no distance. The server REJECTS them
        // rather than ignoring them, so send a declaration that means exactly
        // what the form shows.
        const trailRaw = $('bl-dec-trail').value;
        // Agreement level: a fraction of the committee, or an exact count
        // when the owner wants a specific number rather than one that lands
        // differently on 6- and 8-member committees.
        // A count per committee size, sent only for the sizes this run
        // actually contains.
        const qPart = {};
        if ($('bl-singles').checked) qPart.quorumSingles = Number($('bl-dec-q6').value);
        if ($('bl-doubles').checked || $('bl-triples').checked) qPart.quorumContexts = Number($('bl-dec-q8').value);
        body.declared = entry === 'market'
          ? { entry, tHours: Number($('bl-dec-t').value), ...qPart }
          : {
              entry,
              gate: $('bl-dec-gate').value,
              dMult: Number($('bl-dec-d').value),
              tHours: Number($('bl-dec-t').value),
              ...qPart,
              // armMult is refused by the server unless a trail is declared,
              // so send neither rather than a meaningless pair.
              ...(trailRaw ? { trailMult: Number(trailRaw), armMult: Number($('bl-dec-arm').value) } : {}),
            };
      }
      const res = await fetch('api/bracketlab', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const resBody = await jsonBody(res);
      if (!res.ok) throw new Error(resBody.error || `HTTP ${res.status}`);
      blPicked = null; // follow the sweep we just started
      refreshBracket();
    } catch (err) { blErrEl.hidden = false; blErrEl.textContent = err.message; }
  });

  refreshBatch();
  refreshDataState();
  applyBookPage(); // pager + page-1 visibility before any fetch lands
  refreshBracket();
  refreshTracker();
  refreshDoge();
  refreshBooks();
})();
