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
      · dormant ±${esc(String(doc.params.dormantPct))}% · ${range} · ${esc(doc.params.geometry || 'weekly-8d')} · vs ${esc(doc.params.compareSymbol)}`;
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
      medPaper: 'Middle value of the 8 specs’ one-shot $100 paper books over the test window (this geometry’s own entry/exit candles, $1 round trip) — the TYPICAL spec’s dollars, never the luckiest cell’s. (+N) = how many specs finished positive. Same caveat as the per-spec column: a few big-move periods dominate it.',
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
      paperPnl: 'One-shot $100 paper book over this spec’s test weeks, tracker economics exactly (entry Tue 03:00 open, exit Thu 15:00 open, $1 round trip). Color metric: a handful of big-move weeks dominate it — rank by true edge, use this as the dollars reality-check.',
      paperWT: 'Paper wins / trades: directional (±1) calls only; wins closed positive after fees.',
    };
    const th = (label, tip) => `<th title="${esc(tip)}">${label}</th>`;
    const consensusBlock = s.kind === 'consensus' && s.pairs ? `
      <div class="tablewrap" style="margin-bottom:12px"><table>
        <tr>${th('pair', T.pair)}${th('specs done', T.specs)}${th('positive true edge', T.posEdge)}${th('consensus', T.consensus)}${th('median true edge', T.medEdge)}${th('median balanced acc', T.medBal)}${th('median paper P&amp;L', T.medPaper)}${th('null: median consensus', T.nullMed)}${th('null: exceed rate', T.nullExceed)}</tr>
        ${s.pairs.map((p) => `
          <tr class="${p.fraction >= 0.625 && (p.medianTrueEdge ?? 0) > 0 ? 'hilite' : ''}">
            <td>${esc(p.trade)}</td><td>${p.specs}</td><td>${p.positive}</td>
            <td><strong>${pct(p.fraction, 0)}</strong></td>
            <td>${p.medianTrueEdge != null ? (p.medianTrueEdge >= 0 ? '+' : '') + (100 * p.medianTrueEdge).toFixed(1) + '%' : '—'}</td>
            <td>${pct(p.medianBalancedAcc)}</td>
            <td>${p.medianPaperPnl != null ? `${money(p.medianPaperPnl)} (+${p.positivePaper})` : '—'}</td>
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
    $('allloaded').checked = !!doc.params.allLoaded;
    $('allloaded').dispatchEvent(new Event('change'));
    if (!doc.params.allLoaded) {
      $('start').value = doc.params.startMonth;
      $('end').value = doc.params.endMonth;
    }
    $('features').value = doc.params.featureSet || 'compressed';
    $('geometry').value = doc.params.geometry || 'weekly-8d';
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
          allLoaded: allLoadedChecked(),
          featureSet: $('features').value,
          geometry: $('geometry').value,
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
      const res = await fetch(`api/rotations?pairs=${encodeURIComponent(pairs)}&geometry=${encodeURIComponent($('geometry').value)}`);
      const body = await jsonBody(res);
      setBatchStatus('');
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      $('cons-null').value = body.suggested;
      const parts = Object.entries(body.pairs).map(([p, r]) => `${p}: ${r.chunks} weeks → ${r.maxRotations} rotations`);
      batchViewEl.insertAdjacentHTML('afterbegin', `<p class="note">Exact ceilings on cached data — ${parts.map(esc).join(' · ')} · null shifts set to ${body.suggested}.</p>`);
    } catch (err) {
      setBatchStatus('');
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
        allLoaded: allLoadedChecked(),
        nullShifts: Number($('cons-null').value) || 0,
        geometry: $('geometry').value,
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

  refreshBatch();
  refreshDataState();
  refreshTracker();
})();
