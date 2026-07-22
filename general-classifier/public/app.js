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

  // ---- CPU throttle (semi-auto balancer pattern) -----------------------------

  const cpuBtn = $('cpu-btn');
  const CPU_STEPS = [100, 90, 75, 50, 25, 10, 0];
  let cpuPct = null;

  function showCpu() {
    cpuBtn.textContent = cpuPct === null ? 'CPU …' : cpuPct <= 0 ? 'CPU OFF' : `CPU ${cpuPct}%`;
  }
  async function loadCpu() {
    try {
      const res = await fetch('api/cpu');
      cpuPct = (await jsonBody(res)).pct;
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
      cpuPct = (await jsonBody(res)).pct;
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
          <tr><th>pair</th><th>months cached</th><th>from</th><th>to</th></tr>
          ${body.symbols.map((s) => `
            <tr class="${current.includes(s.symbol) ? 'hilite' : ''}">
              <td>${esc(s.symbol)}</td><td>${s.months}</td><td>${esc(s.from)}</td><td>${esc(s.to)}</td>
            </tr>`).join('')}
        </table></div>
        <p class="note">Highlighted rows are the pairs currently selected above. Months cached on disk are never re-downloaded.</p>`;
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
          featureSet: $('features').value,
          model: $('model').value,
          featureView: pendingView || 'full',
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
          ${tile('Test accuracy', pct(t.accuracy), `${r.split.test.count} held-out weeks`, true)}
          ${tile('Majority baseline', pct(t.majorityBaseline), `always guess ${clsName(t.majorityClass)}`)}
          ${tile('Random baseline', pct(t.randomBaseline), '3 classes')}
          ${tile('Training weeks', String(r.split.train.count), `${esc(r.split.train.from)} → ${esc(r.split.train.to)}`)}
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
        <h2>Held-out weeks, one by one</h2>
        <div class="tablewrap"><table>
          <tr><th>week (Mon)</th><th>actual</th><th>predicted</th><th>P(−1)</th><th>P(0)</th><th>P(+1)</th><th>Tue&rarr;Thu move</th></tr>
          ${t.rows.map((row) => `
            <tr class="${row.actual === row.predicted ? '' : 'miss'}">
              <td>${esc(row.weekStart)}</td>
              <td>${clsSpan(row.actual)}</td>
              <td>${clsSpan(row.predicted)}</td>
              <td>${pct(row.probs['-1'], 0)}</td><td>${pct(row.probs['0'], 0)}</td><td>${pct(row.probs['1'], 0)}</td>
              <td><span class="cls ${row.diffPct > 0 ? 'up' : row.diffPct < 0 ? 'down' : 'flat'}">${row.diffPct >= 0 ? '+' : ''}${row.diffPct.toFixed(2)}%</span></td>
            </tr>`).join('')}
        </table></div>
        <p class="note">Shaded rows are misses. Probabilities are the model's own confidence — well-calibrated only if there's real signal.</p>
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
    const header = `${esc(doc.id)} — ${esc(doc.status)}${doc.status === 'running' && doc.progress ? ` — ${esc(doc.progress)}` : ''}
      · ${doc.runs.filter((r) => r.status === 'done' || r.status === 'error').length}/${doc.runs.length} runs
      · dormant ±${esc(String(doc.params.dormantPct))}% · ${esc(doc.params.startMonth)}→${esc(doc.params.endMonth)} · vs ${esc(doc.params.compareSymbol)}`;
    if (!s || !s.ranked.length) {
      batchViewEl.innerHTML = `<p class="note">${header}</p><p class="note">No completed runs yet.</p>`;
      return;
    }
    const consensusBlock = s.kind === 'consensus' && s.pairs ? `
      <div class="tablewrap" style="margin-bottom:12px"><table>
        <tr><th>pair</th><th>specs done</th><th>positive true edge</th><th>consensus</th><th>median true edge</th><th>median balanced acc</th><th>null: median consensus</th><th>null: exceed rate</th></tr>
        ${s.pairs.map((p) => `
          <tr class="${p.fraction >= 0.625 && (p.medianTrueEdge ?? 0) > 0 ? 'hilite' : ''}">
            <td>${esc(p.trade)}</td><td>${p.specs}</td><td>${p.positive}</td>
            <td><strong>${pct(p.fraction, 0)}</strong></td>
            <td>${p.medianTrueEdge != null ? (p.medianTrueEdge >= 0 ? '+' : '') + (100 * p.medianTrueEdge).toFixed(1) + '%' : '—'}</td>
            <td>${pct(p.medianBalancedAcc)}</td>
            <td>${p.null ? pct(p.null.medianNullFraction, 0) : '—'}</td>
            <td>${p.null ? `${pct(p.null.exceedRate, 0)} of ${p.null.shifts} shifts` : '—'}</td>
          </tr>`).join('')}
      </table></div>
      <p class="note">Consensus = share of the pair's specs (4 views × 2 models) with positive true edge. Highlighted rows:
        ≥5/8 specs positive with positive median. Null exceed rate ≈ p-value: the share of label-shifted reruns whose
        consensus matched or beat the real one — small is good, and anything above ~10% means noise does this routinely.
        Per-spec detail below covers the real (unshifted) runs.</p>` : '';
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
        <tr><th>#</th><th></th><th>trade</th><th>model</th><th>view</th><th>band</th><th>test acc</th><th>best constant</th><th>true edge</th><th>balanced acc</th><th>dir calls</th><th>dir hit rate</th><th>train acc</th><th>weeks (tr/te)</th><th>picked</th></tr>
        ${s.ranked.map((r, i) => {
          const te = r.hindsightEdge != null ? r.hindsightEdge : r.edge;
          const bc = r.bestConstant != null ? pct(r.bestConstant) : `${pct(r.majorityBaseline)} (${clsName(r.majorityClass)})`;
          return `
          <tr class="${te > 0 ? '' : 'miss'}">
            <td>${i + 1}</td>
            <td><button type="button" class="rowload" data-i="${i}" title="Load this combo into the form above and run the full detailed report">detail</button></td>
            <td>${esc(r.trade)}</td><td>${esc(r.model)}</td>
            <td>${esc(r.view || 'full')}</td>
            <td>${r.bandPct != null ? '±' + Number(r.bandPct).toFixed(2) + '%' : '—'}</td>
            <td>${pct(r.testAcc)}</td><td>${bc}</td>
            <td><strong>${te >= 0 ? '+' : ''}${(100 * te).toFixed(1)}%</strong></td>
            <td>${pct(r.balancedAcc)}</td>
            <td>${r.directionalCalls}</td><td>${pct(r.directionalHitRate)}</td>
            <td>${pct(r.trainAcc)}</td><td>${r.trainWeeks}/${r.testWeeks}</td><td>${esc(r.chosen)}</td>
          </tr>`;
        }).join('')}
      </table></div>
      ${s.failed.length ? `<p class="note">Failed: ${s.failed.map((f) => `${esc(f.trade)}/${esc(f.model)} (${esc(f.error)})`).join(' · ')}</p>` : ''}
      <p class="note">True edge = test accuracy − the best CONSTANT guess in hindsight (the toughest prior-only competitor —
        immune to train/test distribution drift, unlike the train-majority baseline). Rows shaded red have no true edge.
        Dir hit rate = accuracy of the non-dormant (±1) calls only. Sorted best-first. "detail" shuttles the combo into
        the form above and runs the full report.</p>`;

    batchViewEl.querySelectorAll('.rowload').forEach((btn) => {
      btn.addEventListener('click', () => shuttleToForm(doc, s.ranked[Number(btn.dataset.i)]));
    });
  }

  // Batch row -> one-off run: copy the screen's config + the row's combo into
  // the form and fire the detailed report. Consensus rows carry a feature
  // VIEW (no form control for it) — passed through on the next submit only.
  let pendingView = null;

  function shuttleToForm(doc, r) {
    $('trade').value = r.trade;
    $('compare').value = r.compare || doc.params.compareSymbol;
    $('start').value = doc.params.startMonth;
    $('end').value = doc.params.endMonth;
    $('features').value = doc.params.featureSet || 'compressed';
    $('model').value = r.model;
    const auto = doc.params.dormantPct === 'auto';
    $('autoband').checked = auto;
    $('dormant').disabled = auto;
    if (!auto) $('dormant').value = doc.params.dormantPct;
    pendingView = r.view && r.view !== 'full' ? r.view : null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    form.requestSubmit();
  }

  const batchPickEl = $('batch-pick');
  let pickedBatch = null; // null = follow the latest

  function fillPicker(batches) {
    batchPickEl.innerHTML = batches
      .map((b) => `<option value="${esc(b.id)}">${esc(b.id)} — ${esc(b.status)} (${b.runsDone}/${b.runsTotal}, ±${esc(String(b.params.dormantPct))}%, ${esc(b.params.startMonth)}→${esc(b.params.endMonth)})</option>`)
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
          featureSet: $('features').value,
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
  $('cons-start').addEventListener('click', async () => {
    try {
      batchErrorEl.hidden = true;
      const pairsRaw = $('cons-pairs').value.trim();
      const body = {
        startMonth: $('start').value,
        endMonth: $('end').value,
        nullShifts: Number($('cons-null').value) || 0,
      };
      if (pairsRaw) body.pairs = pairsRaw.split(',').map((p) => p.trim().toUpperCase()).filter(Boolean);
      const res = await fetch('api/consensus', {
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

  function renderTracker(t) {
    if (!t.initialized) {
      trackerViewEl.innerHTML = '<p class="note">Not initialized yet. Initialize trains and freezes the models (one-time, throttle-aware), then seeds every week since 2026-07-01.</p>';
      return;
    }
    trackerViewEl.innerHTML = Object.entries(t.pairs).map(([pair, p]) => {
      const vb = p.books.vote;
      const liveCount = p.weeks.filter((w) => w.live).length;
      return `
      <div class="section">
        <h2>${esc(pair)} — band ±${p.bandPct.toFixed(2)}%, ${p.trainWeeks} training weeks through ${esc(p.trainedThrough)}</h2>
        <div class="tiles">
          ${tile('Vote book P&L', money(vb.pnl), `${vb.trades} trades, ${vb.wins} wins, after $1/trip fees`, true)}
          ${tile('Vote accuracy', vb.scored ? pct(vb.correct / vb.scored) : '—', `${vb.correct}/${vb.scored} scored weeks`)}
          ${tile('Weeks recorded', String(p.weeks.length), `${liveCount} live · ${p.weeks.length - liveCount} seeded`)}
        </div>
        <div class="tablewrap" style="margin-top:10px"><table>
          <tr><th>book</th><th>trades</th><th>wins</th><th>P&amp;L</th><th>accuracy</th></tr>
          ${Object.entries(p.books).map(([k, b]) => `
            <tr class="${k === 'vote' ? 'hilite' : ''}"><td>${esc(k)}</td><td>${b.trades}</td><td>${b.wins}</td>
            <td>${money(b.pnl)}</td><td>${b.scored ? pct(b.correct / b.scored) : '—'}</td></tr>`).join('')}
        </table></div>
        <div class="tablewrap" style="margin-top:10px"><table>
          <tr><th>week (Mon)</th><th>vote</th><th>actual</th><th>entry</th><th>exit</th><th>vote P&amp;L</th><th>status</th><th>provenance</th></tr>
          ${p.weeks.slice(-30).reverse().map((w) => `
            <tr class="${w.status === 'settled' && w.vote !== 0 && w.pnl.vote <= 0 ? 'miss' : ''}">
              <td>${esc(w.weekOf)}</td><td>${clsSpan(w.vote)}</td><td>${w.actual === null ? '—' : clsSpan(w.actual)}</td>
              <td>${w.entry != null ? w.entry : '—'}</td><td>${w.exit != null ? w.exit : '—'}</td>
              <td>${w.pnl ? money(w.pnl.vote) : '—'}</td><td>${esc(w.status)}</td>
              <td>${w.live ? 'LIVE' : 'seeded'}</td>
            </tr>`).join('')}
        </table></div>
      </div>`;
    }).join('');
  }

  async function refreshTracker() {
    try {
      trackerErrEl.hidden = true;
      const res = await fetch('api/tracker');
      const t = await jsonBody(res);
      if (!res.ok) throw new Error(t.error || `HTTP ${res.status}`);
      renderTracker(t);
      $('tracker-init').disabled = !!t.initialized;
    } catch (err) {
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
  $('tracker-refresh').addEventListener('click', refreshTracker);

  refreshBatch();
  refreshDataState();
  refreshTracker();
})();
