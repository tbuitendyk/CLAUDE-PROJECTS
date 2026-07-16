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

// Editable quantity cell; saves on change.
function qtyCell(asset) {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = 'any';
  input.value = asset.quantity;
  input.className = 'cell-input';
  input.addEventListener('change', async () => {
    try {
      await api(`/assets/${asset.id}`, { method: 'PATCH', body: { quantity: Number(input.value) } });
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });
  td.appendChild(input);
  return td;
}

// Checkmark for the tethered index asset (at most one per profile, priced
// 1:1 with the index).
function indexCell(asset) {
  const td = document.createElement('td');
  td.className = 'center';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = Boolean(asset.is_index);
  cb.title = 'Tethered to the index asset (1:1)';
  cb.addEventListener('change', async () => {
    try {
      await api(`/assets/${asset.id}`, { method: 'PATCH', body: { is_index: cb.checked } });
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });
  td.appendChild(cb);
  return td;
}

function renderDetail() {
  const d = state.detail;
  $('#detail-empty').classList.toggle('hidden', Boolean(d));
  $('#detail').classList.toggle('hidden', !d);
  if (!d) return;

  const { profile, assets, alertLog, totals, snapshots, flows } = d;
  $('#d-name').textContent = profile.name;
  const polled = profile.last_polled_at
    ? new Date(profile.last_polled_at).toLocaleString()
    : 'never';
  const idx = (totals && totals.indexLabel) || 'USD';
  $('#d-meta').textContent =
    `Index: ${idx} (tethered asset) · threshold ${profile.threshold_pct}% of target · ` +
    `polls every ${profile.poll_minutes} min · last poll: ${polled}`;

  // Editable threshold / poll settings.
  $('#s-threshold').value = profile.threshold_pct;
  $('#s-poll').value = profile.poll_minutes;

  // Overall performance, two lines: (1) currency basket — unit growth,
  // (2) value in the index currency with growth since start.
  const summary = $('#d-summary');
  summary.innerHTML = '';
  const line1 = document.createElement('div');
  line1.className = 'perf-line';
  if (totals && totals.basket != null) {
    const unitPct = (totals.basket - 1) * 100;
    line1.innerHTML =
      `Currency basket: <strong>${totals.basket.toFixed(8)}</strong> ` +
      `<span class="${unitPct >= 0 ? 'pos' : 'neg'}">(${unitPct >= 0 ? '+' : ''}${unitPct.toFixed(4)}% units)</span>`;
  } else {
    line1.innerHTML = 'Currency basket: <span class="muted">— set targets to start</span>';
  }
  const line2 = document.createElement('div');
  line2.className = 'perf-line';
  if (totals && totals.totalRel > 0) {
    const since = totals.valueStartedAt
      ? `since ${new Date(totals.valueStartedAt).toLocaleString()}`
      : 'since start';
    line2.innerHTML =
      `Value (${idx}): <strong>${fmtNum(totals.totalRel)}</strong> ` +
      (totals.growthPct != null ? `${fmtPct(totals.growthPct)} <span class="muted">${since}</span> ` : '') +
      `<span class="muted">· $${fmtMoney(totals.totalUsd)} USD</span>`;
  } else {
    line2.innerHTML = `Value (${idx}): <span class="muted">— no priced holdings yet</span>`;
  }
  // Third line: annualized (compounding) rate, once there's enough runway.
  const line3 = document.createElement('div');
  line3.className = 'perf-line muted';
  if (totals && totals.growthPct != null) {
    line3.innerHTML =
      totals.annualizedPct != null
        ? `Annualized (compounding): ${fmtPct(totals.annualizedPct)}`
        : 'Annualized (compounding): <span class="muted">n/a — too soon (needs ~1 week of history)</span>';
    summary.append(line1, line2, line3);
  } else {
    summary.append(line1, line2);
  }

  // target allocations should add up to 100 (tethered index asset included)
  const warning = $('#alloc-warning');
  const targetTotal = totals ? totals.targetTotal : 0;
  if (Math.abs(targetTotal - 100) > 0.01) {
    warning.textContent =
      targetTotal === 0
        ? 'No targets set yet — use "Set new targets" to define the intended mix.'
        : `Target allocations add up to ${targetTotal.toFixed(1)}% — they should total 100%. Use "Set new targets" to fix.`;
    warning.classList.remove('hidden');
  } else {
    warning.classList.add('hidden');
  }

  // assets table: the tethered index asset sorts to the top, visually
  // separated from the base assets below it.
  const tbody = $('#asset-table tbody');
  tbody.innerHTML = '';
  const ordered = [...assets].sort((a, b) => (b.is_index ? 1 : 0) - (a.is_index ? 1 : 0));
  for (const a of ordered) {
    const tr = document.createElement('tr');
    if (a.breached) tr.className = 'breached';
    if (a.is_index) tr.classList.add('index-row');
    tr.appendChild(indexCell(a));
    const sym = document.createElement('td');
    sym.textContent = a.symbol.toUpperCase();
    tr.appendChild(sym);
    const tgt = document.createElement('td');
    tgt.textContent = a.target_pct ? a.target_pct + '%' : '—';
    tr.appendChild(tgt);
    tr.appendChild(qtyCell(a));
    const drift =
      a.driftRelPct == null
        ? '—'
        : `<span class="${a.driftRelPct >= 0 ? 'pos' : 'neg'}">${a.driftRelPct >= 0 ? '+' : ''}${a.driftRelPct.toFixed(1)}%</span>` +
          (a.breached ? ' ⚠' : '');
    const rest = document.createElement('template');
    rest.innerHTML =
      `<td>${a.last ? '$' + fmtNum(a.last.usd_price) : '—'}</td>` +
      `<td>${a.valueUsd != null ? '$' + fmtMoney(a.valueUsd) : '—'}</td>` +
      `<td>${a.actualPct != null ? a.actualPct.toFixed(2) + '%' : '—'}</td>` +
      `<td>${drift}</td>`;
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
      `<td>${s.basket != null ? s.basket.toFixed(8) : '—'}</td>` +
      `<td>${s.value_index != null ? s.value_index.toFixed(6) : '—'}</td>` +
      `<td>${fmtNum(s.total_rel)}</td>` +
      `<td>$${fmtMoney(s.total_usd)}</td>`;
    snapBody.appendChild(tr);
  }

  // deposit / withdraw: one signed input per asset, plus flow history
  renderFlowRows(assets);
  const flowBody = $('#flow-table tbody');
  flowBody.innerHTML = '';
  for (const f of flows || []) {
    let deltas = [];
    try { deltas = JSON.parse(f.deltas); } catch {}
    const change = deltas
      .map((d) => `${d.delta >= 0 ? '+' : ''}${d.delta} ${d.symbol.toUpperCase()}`)
      .join(', ');
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${new Date(f.ts).toLocaleString()}</td><td>${change}</td><td>${f.note ? f.note.replace(/[<>]/g, '') : ''}</td>`;
    flowBody.appendChild(tr);
  }

  // screenshot import (only when the server has an Anthropic API key)
  $('#import-section').classList.toggle('hidden', !state.visionConfigured);

  // notifications: state machine status, toggle, recipients
  const rearmAt = profile.notify_state_at
    ? new Date(profile.notify_state_at + 12 * 3600 * 1000).toLocaleString()
    : null;
  const stateText = {
    armed: 'Armed — a new target hit sends a notification. "Poll now" notifies immediately if anything is exceeded.',
    notified: `Notified — automatic emails paused. "Poll now" re-checks and re-notifies; a screenshot upload re-arms. Auto re-arms ${rearmAt}.`,
    awaiting_upload: `Notified — automatic emails paused. "Poll now" re-checks and re-notifies; a screenshot upload re-arms. Auto re-arms ${rearmAt}.`,
  };
  $('#n-state').textContent = 'State: ' + (stateText[profile.notify_state] || stateText.armed);
  $('#n-enabled').checked = Boolean(profile.alerts_enabled);
  renderRecipients(JSON.parse(profile.recipients || '[]'));

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

// ---- notifications ----

function recipientRow(r = {}) {
  const row = document.createElement('div');
  row.className = 'recipient-row';
  const mk = (cls, ph, val) => {
    const i = document.createElement('input');
    i.className = cls;
    i.placeholder = ph;
    i.value = val || '';
    return i;
  };
  row.append(
    mk('r-email', 'email@example.com', r.email),
    mk('r-phone', 'WhatsApp +1555… (optional)', r.whatsapp_phone),
    mk('r-key', 'CallMeBot key (optional)', r.whatsapp_key)
  );
  const del = document.createElement('button');
  del.textContent = '✕';
  del.className = 'ghost';
  del.addEventListener('click', () => row.remove());
  row.appendChild(del);
  return row;
}

function renderRecipients(list) {
  const box = $('#n-recipients');
  box.innerHTML = '';
  for (const r of list) box.appendChild(recipientRow(r));
  if (list.length === 0) box.appendChild(recipientRow());
}

$('#n-add').addEventListener('click', () => {
  $('#n-recipients').appendChild(recipientRow());
});

$('#n-save').addEventListener('click', async () => {
  const recipients = [...document.querySelectorAll('#n-recipients .recipient-row')].map((row) => ({
    email: row.querySelector('.r-email').value.trim(),
    whatsapp_phone: row.querySelector('.r-phone').value.trim(),
    whatsapp_key: row.querySelector('.r-key').value.trim(),
  }));
  try {
    await api(`/profiles/${state.selectedId}`, { method: 'PATCH', body: { recipients } });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

$('#n-enabled').addEventListener('change', async () => {
  try {
    await api(`/profiles/${state.selectedId}`, {
      method: 'PATCH',
      body: { alerts_enabled: $('#n-enabled').checked },
    });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

// detail actions
$('#d-status').addEventListener('click', async () => {
  $('#d-status').disabled = true;
  try {
    const r = await api(`/profiles/${state.selectedId}/email-status`, { method: 'POST' });
    const parts = [];
    parts.push(r.emailedTo.length ? `Email sent to ${r.emailedTo.join(', ')}` : 'No email sent');
    parts.push(`WhatsApp: ${r.whatsappOk} sent${r.whatsappFailed.length ? `, ${r.whatsappFailed.length} FAILED` : ''}`);
    if (r.errors && r.errors.length) parts.push(r.errors.join(' | '));
    alert(parts.join('\n'));
    await refresh();
  } catch (err) {
    alert(`Status report failed: ${err.message}`);
  } finally {
    $('#d-status').disabled = false;
  }
});

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

// Set new targets: the deliberate decision to change the intended mix.
$('#d-targets').addEventListener('click', () => {
  const rows = $('#t-rows');
  rows.innerHTML = '';
  for (const a of state.detail.assets) {
    const row = document.createElement('label');
    row.className = 'target-row';
    const name = document.createElement('span');
    name.textContent = a.symbol.toUpperCase() + (a.is_index ? ' ⚓' : '');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.step = '0.1';
    input.value = a.target_pct || 0;
    input.dataset.assetId = a.id;
    input.addEventListener('input', updateTargetSum);
    row.append(name, input, document.createTextNode('%'));
    rows.appendChild(row);
  }
  updateTargetSum();
  $('#targets-editor').classList.remove('hidden');
});

function updateTargetSum() {
  let sum = 0;
  for (const input of document.querySelectorAll('#t-rows input')) sum += Number(input.value) || 0;
  const el = $('#t-sum');
  el.textContent = `Total: ${sum.toFixed(1)}%`;
  el.className = Math.abs(sum - 100) > 0.01 ? 'warn-text' : 'muted';
  $('#t-save').disabled = Math.abs(sum - 100) > 0.01;
}

$('#t-save').addEventListener('click', async () => {
  const targets = [...document.querySelectorAll('#t-rows input[data-asset-id]')].map((input) => ({
    asset_id: Number(input.dataset.assetId),
    target_pct: Number(input.value) || 0,
  }));
  try {
    await api(`/profiles/${state.selectedId}/targets`, {
      method: 'POST',
      body: { targets, reset_basket: $('#t-reset').checked },
    });
    $('#targets-editor').classList.add('hidden');
    $('#t-reset').checked = false;
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

$('#t-cancel').addEventListener('click', () => {
  $('#targets-editor').classList.add('hidden');
});

// Edit threshold / poll interval on an existing profile.
$('#d-rename').addEventListener('click', async () => {
  const current = $('#d-name').textContent;
  const name = prompt('Rename profile:', current);
  if (name == null) return; // cancelled
  const trimmed = name.trim();
  if (!trimmed || trimmed === current) return;
  try {
    await api(`/profiles/${state.selectedId}`, { method: 'PATCH', body: { name: trimmed } });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

$('#s-save').addEventListener('click', async () => {
  try {
    await api(`/profiles/${state.selectedId}`, {
      method: 'PATCH',
      body: {
        threshold_pct: Number($('#s-threshold').value),
        poll_minutes: Number($('#s-poll').value),
      },
    });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

// ---- deposit / withdraw ----

function renderFlowRows(assets) {
  const box = $('#flow-rows');
  box.innerHTML = '';
  for (const a of assets) {
    const row = document.createElement('label');
    row.className = 'flow-row';
    const name = document.createElement('span');
    name.textContent = a.symbol.toUpperCase() + (a.is_index ? ' ⚓' : '');
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.placeholder = '+deposit / -withdraw';
    input.dataset.assetId = a.id;
    input.className = 'flow-input';
    row.append(name, input);
    box.appendChild(row);
  }
}

$('#flow-save').addEventListener('click', async () => {
  const deltas = [...document.querySelectorAll('#flow-rows .flow-input')]
    .map((input) => ({ asset_id: Number(input.dataset.assetId), delta: Number(input.value) || 0 }))
    .filter((d) => d.delta !== 0);
  if (deltas.length === 0) {
    alert('Enter at least one non-zero deposit or withdrawal.');
    return;
  }
  const summary = deltas
    .map((d) => {
      const a = state.detail.assets.find((x) => x.id === d.asset_id);
      return `${d.delta >= 0 ? '+' : ''}${d.delta} ${(a ? a.symbol : '').toUpperCase()}`;
    })
    .join(', ');
  if (!confirm(`Record this flow?\n\n${summary}\n\nThe basket and value performance stay continuous — this is not counted as a gain.`)) return;
  try {
    await api(`/profiles/${state.selectedId}/flow`, {
      method: 'POST',
      body: { deltas, note: $('#flow-note').value.trim() || undefined },
    });
    $('#flow-note').value = '';
    await refresh();
  } catch (err) {
    alert(err.message);
  }
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

// Fiat currencies: datalist of supported codes, added as 'fiat:<code>'.
let fiatListLoaded = false;
async function loadFiatList() {
  if (fiatListLoaded) return;
  try {
    const codes = await api('/fiat-currencies');
    const dl = $('#fiat-list');
    dl.innerHTML = '';
    for (const c of codes) {
      const opt = document.createElement('option');
      opt.value = c;
      dl.appendChild(opt);
    }
    fiatListLoaded = true;
  } catch {
    /* datalist is a convenience; add still validates server-side */
  }
}
$('#f-code').addEventListener('focus', loadFiatList);

$('#fiat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#f-code').value.trim().toLowerCase();
  if (!code) return;
  try {
    await api(`/profiles/${state.selectedId}/assets`, {
      method: 'POST',
      body: { coingecko_id: `fiat:${code}`, symbol: code },
    });
    $('#f-code').value = '';
    await refresh();
  } catch (err) {
    alert(err.message);
  }
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
  // The applied screenshot re-arms notifications (new target hits only).
  if (applied > 0) {
    await api(`/profiles/${state.selectedId}/import-complete`, { method: 'POST' }).catch(() => {});
  }
  $('#import-preview').classList.add('hidden');
  $('#i-status').textContent = `Applied ${applied} change(s). Notifications re-armed.`;
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
