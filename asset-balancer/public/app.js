/* Asset Balancer frontend — vanilla JS, no build step. */

const $ = (sel) => document.querySelector(sel);

let state = {
  profiles: [],
  selectedId: null,
  detail: null,
  pendingCoin: null, // coin picked from search, awaiting "Add asset"
};

// API URLs are relative so the app works both served at the root
// (http://localhost:3000/) and behind a stripping reverse proxy
// (https://www.buitendyk.ca/balancer/ -> 127.0.0.1:8091/).
async function api(path, opts = {}) {
  const res = await fetch(`api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('unauthorized');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

// ---- auth ----

function showLogin() {
  $('#login-view').classList.remove('hidden');
  $('#main-view').classList.add('hidden');
}

function showMain() {
  $('#login-view').classList.add('hidden');
  $('#main-view').classList.remove('hidden');
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/login', { method: 'POST', body: { password: $('#login-password').value } });
    $('#login-error').textContent = '';
    showMain();
    await loadProfiles();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

// ---- profiles ----

async function loadProfiles() {
  state.profiles = await api('/profiles');
  renderProfiles();
  if (state.selectedId && !state.profiles.some((p) => p.id === state.selectedId)) {
    state.selectedId = null;
    state.detail = null;
  }
  if (state.selectedId) await loadDetail();
  renderDetail();
}

function renderProfiles() {
  const ul = $('#profile-list');
  ul.innerHTML = '';
  for (const p of state.profiles) {
    const li = document.createElement('li');
    li.className = p.id === state.selectedId ? 'active' : '';
    const label = document.createElement('span');
    label.textContent = p.name;
    if (!p.enabled) label.className = 'off';
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = `${p.threshold_pct}%`;
    li.append(label, meta);
    li.addEventListener('click', async () => {
      state.selectedId = p.id;
      renderProfiles();
      await loadDetail();
      renderDetail();
    });
    ul.appendChild(li);
  }
}

$('#profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/profiles', {
    method: 'POST',
    body: {
      name: $('#pf-name').value,
      index_asset: $('#pf-index').value || 'usd',
      threshold_pct: Number($('#pf-threshold').value),
      poll_minutes: Number($('#pf-poll').value),
    },
  });
  $('#pf-name').value = '';
  await loadProfiles();
});

// ---- detail ----

async function loadDetail() {
  if (!state.selectedId) return;
  state.detail = await api(`/profiles/${state.selectedId}/state`);
}

function fmtNum(n, digits = 6) {
  if (n == null) return '—';
  return Number(n).toPrecision(digits);
}

function fmtPct(n) {
  if (n == null) return '—';
  const cls = n >= 0 ? 'pos' : 'neg';
  return `<span class="${cls}">${n >= 0 ? '+' : ''}${n.toFixed(2)}%</span>`;
}

function fmtMoney(n) {
  if (n == null) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Editable cell for quantity / target %; saves on change.
function editCell(asset, field, step) {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = step;
  input.value = asset[field];
  input.className = 'cell-input';
  input.addEventListener('change', async () => {
    try {
      await api(`/assets/${asset.id}`, { method: 'PATCH', body: { [field]: Number(input.value) } });
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });
  td.appendChild(input);
  return td;
}

function renderDetail() {
  const d = state.detail;
  $('#detail-empty').classList.toggle('hidden', Boolean(d));
  $('#detail').classList.toggle('hidden', !d);
  if (!d) return;

  const { profile, assets, sets, alertLog, totals, snapshots } = d;
  $('#d-name').textContent = profile.name;
  const polled = profile.last_polled_at
    ? new Date(profile.last_polled_at).toLocaleString()
    : 'never';
  $('#d-meta').textContent =
    `Index: ${profile.index_asset} · threshold ${profile.threshold_pct}% · ` +
    `polls every ${profile.poll_minutes} min · last poll: ${polled}`;

  // summary: total value, value in index units, growth since baseline
  const summary = $('#d-summary');
  summary.innerHTML = '';
  const stats = [
    ['Total value', totals && totals.totalUsd != null ? '$' + fmtMoney(totals.totalUsd) : '—'],
    [`Total (${profile.index_asset})`, totals ? fmtNum(totals.totalRel) : '—'],
    ['Growth since baseline', totals && totals.growthPct != null ? fmtPct(totals.growthPct) : '—'],
  ];
  for (const [label, value] of stats) {
    const div = document.createElement('div');
    div.className = 'stat';
    div.innerHTML = `<span class="stat-label">${label}</span><span class="stat-value">${value}</span>`;
    summary.appendChild(div);
  }

  // target allocations should add up to 100 (index asset included)
  const warning = $('#alloc-warning');
  const targetTotal = totals ? totals.targetTotal : 0;
  if (Math.abs(targetTotal - 100) > 0.01 && targetTotal !== 0) {
    warning.textContent = `Target allocations add up to ${targetTotal.toFixed(1)}% — they should total 100% (index asset included).`;
    warning.classList.remove('hidden');
  } else {
    warning.classList.add('hidden');
  }

  // assets table
  const tbody = $('#asset-table tbody');
  tbody.innerHTML = '';
  for (const a of assets) {
    const tr = document.createElement('tr');
    const sym = document.createElement('td');
    sym.textContent = a.symbol.toUpperCase();
    tr.appendChild(sym);
    tr.appendChild(editCell(a, 'target_pct', '0.1'));
    tr.appendChild(editCell(a, 'quantity', 'any'));
    const rest = document.createElement('template');
    rest.innerHTML =
      `<td>${a.last ? '$' + fmtNum(a.last.usd_price) : '—'}</td>` +
      `<td>${a.valueUsd != null ? '$' + fmtMoney(a.valueUsd) : '—'}</td>` +
      `<td>${a.actualPct != null ? a.actualPct.toFixed(1) + '%' : '—'}</td>` +
      `<td>${fmtPct(a.driftPct)}</td>`;
    tr.append(...rest.content.childNodes);
    const td = document.createElement('td');
    const del = document.createElement('button');
    del.textContent = '✕';
    del.className = 'ghost';
    del.addEventListener('click', async () => {
      if (!confirm(`Remove ${a.symbol.toUpperCase()} from this profile?`)) return;
      await api(`/assets/${a.id}`, { method: 'DELETE' });
      await refresh();
    });
    td.appendChild(del);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  // value history (snapshots, oldest -> newest)
  const snapBody = $('#snap-table tbody');
  snapBody.innerHTML = '';
  for (const s of snapshots || []) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${new Date(s.ts).toLocaleString()}</td>` +
      `<td>$${fmtMoney(s.total_usd)}</td>` +
      `<td>${fmtNum(s.total_rel)}</td>` +
      `<td>${fmtPct(s.growth_pct)}</td>`;
    snapBody.appendChild(tr);
  }

  // screenshot import (only when the server has an Anthropic API key)
  $('#import-section').classList.toggle('hidden', !state.visionConfigured);

  // sets
  const setList = $('#set-list');
  setList.innerHTML = '';
  const bySymbol = new Map(assets.map((a) => [a.id, a.symbol.toUpperCase()]));
  for (const s of sets) {
    const div = document.createElement('div');
    div.className = 'set';
    const head = document.createElement('div');
    head.className = 'set-head';
    const title = document.createElement('strong');
    title.textContent = s.name;
    head.appendChild(title);
    if (s.active_alerts.length > 0) {
      const badge = document.createElement('span');
      badge.className = 'alert-badge';
      badge.textContent = `⚠ ${s.active_alerts.length} pair(s) over threshold`;
      head.appendChild(badge);
    }
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.className = 'ghost';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete set "${s.name}"?`)) return;
      await api(`/sets/${s.id}`, { method: 'DELETE' });
      await refresh();
    });
    head.appendChild(del);
    div.appendChild(head);
    const members = document.createElement('p');
    members.className = 'muted';
    members.textContent = s.member_ids.map((id) => bySymbol.get(id) || '?').join(', ') || 'no members';
    div.appendChild(members);
    setList.appendChild(div);
  }

  // set-member checkboxes
  const box = $('#s-members');
  box.innerHTML = '';
  for (const a of assets) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = a.id;
    label.append(cb, document.createTextNode(a.symbol.toUpperCase()));
    box.appendChild(label);
  }

  // alert log
  const log = $('#alert-log');
  log.innerHTML = '';
  for (const entry of alertLog) {
    const li = document.createElement('li');
    li.textContent = `${new Date(entry.ts).toLocaleString()} ${entry.emailed ? '📧' : ''}\n${entry.message}`;
    log.appendChild(li);
  }
}

async function refresh() {
  await loadDetail();
  renderDetail();
}

// detail actions
$('#d-poll').addEventListener('click', async () => {
  $('#d-poll').disabled = true;
  try {
    await api(`/profiles/${state.selectedId}/poll`, { method: 'POST' });
    await refresh();
  } catch (err) {
    alert(`Poll failed: ${err.message}`);
  } finally {
    $('#d-poll').disabled = false;
  }
});

$('#d-rebalance').addEventListener('click', async () => {
  if (!confirm('Reset all baselines to current prices? Do this after you have manually rebalanced.')) return;
  await api(`/profiles/${state.selectedId}/rebalance`, { method: 'POST', body: {} });
  await refresh();
});

$('#d-delete').addEventListener('click', async () => {
  const p = state.detail.profile;
  if (!confirm(`Delete profile "${p.name}" and all its data?`)) return;
  await api(`/profiles/${p.id}`, { method: 'DELETE' });
  state.selectedId = null;
  state.detail = null;
  await loadProfiles();
});

// asset search + add
let searchTimer = null;
$('#a-search').addEventListener('input', () => {
  state.pendingCoin = null;
  $('#a-add').disabled = true;
  clearTimeout(searchTimer);
  const q = $('#a-search').value.trim();
  if (q.length < 2) {
    $('#a-results').classList.add('hidden');
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const coins = await api(`/search-coins?q=${encodeURIComponent(q)}`);
      const box = $('#a-results');
      box.innerHTML = '';
      for (const c of coins) {
        const div = document.createElement('div');
        div.textContent = `${c.name} (${c.symbol.toUpperCase()})${c.rank ? ' · #' + c.rank : ''}`;
        div.addEventListener('click', () => {
          state.pendingCoin = c;
          $('#a-search').value = `${c.name} (${c.symbol.toUpperCase()})`;
          $('#a-add').disabled = false;
          box.classList.add('hidden');
        });
        box.appendChild(div);
      }
      box.classList.toggle('hidden', coins.length === 0);
    } catch {
      /* search failing is non-fatal */
    }
  }, 300);
});

$('#asset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.pendingCoin) return;
  try {
    await api(`/profiles/${state.selectedId}/assets`, {
      method: 'POST',
      body: { coingecko_id: state.pendingCoin.id, symbol: state.pendingCoin.symbol },
    });
  } catch (err) {
    alert(err.message);
  }
  state.pendingCoin = null;
  $('#a-search').value = '';
  $('#a-add').disabled = true;
  await refresh();
});

$('#set-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#s-name').value.trim();
  if (!name) return;
  const member_ids = [...document.querySelectorAll('#s-members input:checked')].map((cb) => Number(cb.value));
  await api(`/profiles/${state.selectedId}/sets`, { method: 'POST', body: { name, member_ids } });
  $('#s-name').value = '';
  await refresh();
});

// ---- screenshot import ----

// Downscale to keep upload + vision token cost small while leaving phone
// screenshot text perfectly legible.
function fileToScaledBase64(file, maxEdge = 1568) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      resolve(dataUrl.split(',')[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image'));
    };
    img.src = url;
  });
}

let importPlan = []; // [{kind: 'update'|'add', ...}] built from the preview

function renderImportPreview(result) {
  const box = $('#i-rows');
  box.innerHTML = '';
  importPlan = [];

  const addRow = (labelHtml, plan, extraEl = null) => {
    const idx = importPlan.push(plan) - 1;
    const row = document.createElement('label');
    row.className = 'import-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = plan.kind !== 'skip';
    cb.disabled = plan.kind === 'skip';
    cb.dataset.idx = idx;
    const span = document.createElement('span');
    span.innerHTML = labelHtml;
    row.append(cb, span);
    if (extraEl) row.appendChild(extraEl);
    box.appendChild(row);
  };

  for (const m of result.matches) {
    addRow(
      `<strong>${m.symbol.toUpperCase()}</strong> quantity ${fmtNum(m.old_quantity)} → <strong>${fmtNum(m.new_quantity)}</strong>` +
        (m.value_usd != null ? ` <span class="muted">($${fmtMoney(m.value_usd)})</span>` : ''),
      { kind: 'update', asset_id: m.asset_id, quantity: m.new_quantity }
    );
  }
  for (const u of result.unmatched) {
    if (u.candidates && u.candidates.length > 0) {
      const select = document.createElement('select');
      for (const c of u.candidates) {
        const opt = document.createElement('option');
        opt.value = JSON.stringify({ id: c.id, symbol: c.symbol });
        opt.textContent = `${c.name} (${c.symbol.toUpperCase()})${c.rank ? ' #' + c.rank : ''}`;
        select.appendChild(opt);
      }
      const plan = { kind: 'add', quantity: u.quantity, select };
      addRow(
        `<strong>${(u.symbol || u.name).toUpperCase()}</strong> — new asset, quantity ${fmtNum(u.quantity)} as`,
        plan,
        select
      );
    } else {
      addRow(
        `<strong>${(u.symbol || u.name).toUpperCase()}</strong> — no CoinGecko match found, skipped`,
        { kind: 'skip' }
      );
    }
  }
  if (importPlan.length === 0) {
    box.innerHTML = '<p class="muted">No holdings with quantities were found in that screenshot.</p>';
  }
  $('#import-preview').classList.remove('hidden');
}

$('#import-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = $('#i-file').files[0];
  if (!file) return;
  $('#i-go').disabled = true;
  $('#i-status').textContent = 'Reading screenshot… (this takes a few seconds)';
  $('#import-preview').classList.add('hidden');
  try {
    const image = await fileToScaledBase64(file);
    const result = await api(`/profiles/${state.selectedId}/import-screenshot`, {
      method: 'POST',
      body: { image, media_type: 'image/jpeg' },
    });
    $('#i-status').textContent = `Found ${result.parsed.length} holding(s). Review and apply:`;
    renderImportPreview(result);
  } catch (err) {
    $('#i-status').textContent = `Import failed: ${err.message}`;
  } finally {
    $('#i-go').disabled = false;
  }
});

$('#i-apply').addEventListener('click', async () => {
  const boxes = document.querySelectorAll('#i-rows input[type=checkbox]:checked');
  let applied = 0;
  for (const cb of boxes) {
    const plan = importPlan[Number(cb.dataset.idx)];
    if (!plan || plan.kind === 'skip') continue;
    try {
      if (plan.kind === 'update') {
        await api(`/assets/${plan.asset_id}`, { method: 'PATCH', body: { quantity: plan.quantity } });
      } else if (plan.kind === 'add') {
        const coin = JSON.parse(plan.select.value);
        await api(`/profiles/${state.selectedId}/assets`, {
          method: 'POST',
          body: { coingecko_id: coin.id, symbol: coin.symbol, quantity: plan.quantity },
        });
      }
      applied++;
    } catch (err) {
      alert(`Failed on one row: ${err.message}`);
    }
  }
  $('#import-preview').classList.add('hidden');
  $('#i-status').textContent = `Applied ${applied} change(s).`;
  $('#i-file').value = '';
  await refresh();
});

$('#i-cancel').addEventListener('click', () => {
  $('#import-preview').classList.add('hidden');
  $('#i-status').textContent = '';
  $('#i-file').value = '';
});

// ---- boot ----

(async function boot() {
  const session = await fetch('api/session').then((r) => r.json());
  $('#email-status').textContent = session.emailConfigured
    ? 'email alerts: on'
    : 'email alerts: not configured';
  state.visionConfigured = Boolean(session.visionConfigured);
  if (session.authed) {
    showMain();
    await loadProfiles();
    setInterval(async () => {
      if (state.selectedId) await refresh().catch(() => {});
    }, 60_000);
  } else {
    showLogin();
  }
})();
