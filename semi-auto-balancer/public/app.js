/* Semi-Auto Balancer frontend — vanilla JS, no build step. */

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
    `Index: ${idx} (tethered asset) · reacts to ~${profile.threshold_pct}% price moves · ` +
    `polls every ${profile.poll_minutes} min · last poll: ${polled}`;

  // Editable sensitivity / poll / trading-cost settings.
  $('#s-threshold').value = profile.threshold_pct;
  $('#s-poll').value = profile.poll_minutes;
  $('#s-fee').value = profile.fee_pct != null ? profile.fee_pct : 0.38;
  $('#s-spread').value = profile.spread_pct != null ? profile.spread_pct : 0.1;

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
    if (a.buy_frozen) {
      const badge = document.createElement('button');
      badge.textContent = ' 🧊';
      badge.className = 'ghost';
      badge.title =
        `BUY alerts frozen — ${a.freeze_reason || 'structural break'}. Sells still alert. ` +
        `Auto-unfreezes when the drawdown eases; click to unfreeze now.`;
      badge.addEventListener('click', async () => {
        if (!confirm(`Unfreeze BUY alerts for ${a.symbol.toUpperCase()}?\n\nFrozen because: ${a.freeze_reason || 'structural break'}\n\nThe rail may re-freeze if conditions still hold.`)) return;
        try {
          await api(`/assets/${a.id}/unfreeze`, { method: 'POST' });
          await refresh();
        } catch (err) {
          alert(err.message);
        }
      });
      sym.appendChild(badge);
    }
    if (a.depegged) {
      const peg = document.createElement('span');
      peg.textContent = ' ⚠$';
      peg.title = 'Trading outside the $0.98–1.02 peg band (valuation stays pinned 1:1)';
      peg.className = 'warn-text';
      sym.appendChild(peg);
    }
    if (!a.is_index) {
      // Freeze override: the frozen STATUS keeps tracking (badge stays), but
      // its effects — BUY-alert suppression and exclusion from the
      // composition lab — stand down while checked.
      const ovrLabel = document.createElement('label');
      ovrLabel.className = 'muted';
      ovrLabel.title =
        'Ignore buy-freeze for this asset: BUY alerts and composition-lab eligibility stay active even while frozen. ' +
        'The freeze status itself keeps tracking (badge remains).';
      ovrLabel.style.marginLeft = '6px';
      ovrLabel.style.whiteSpace = 'nowrap';
      const ovr = document.createElement('input');
      ovr.type = 'checkbox';
      ovr.checked = Boolean(a.freeze_override);
      ovr.addEventListener('change', async () => {
        try {
          await api(`/assets/${a.id}`, { method: 'PATCH', body: { freeze_override: ovr.checked } });
          await refresh();
        } catch (err) {
          alert(err.message);
        }
      });
      ovrLabel.append(ovr, document.createTextNode('❄off'));
      sym.appendChild(ovrLabel);
    }
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
    // Per-asset effective drift trigger (weight-normalized). The tether never
    // trades on its own breach; very tight triggers get flagged as noisy.
    const trigger = a.is_index
      ? '<span class="muted" title="Tethered index asset — note only, never trades">note</span>'
      : a.effThresholdPct == null
        ? '—'
        : `±${a.effThresholdPct.toFixed(1)}%` +
          (a.effThresholdPct < 2 ? ' <span class="warn-text" title="Very tight — may trigger on daily noise">⚡</span>' : '');
    const rest = document.createElement('template');
    rest.innerHTML =
      `<td>${a.last ? '$' + fmtNum(a.last.usd_price) : '—'}</td>` +
      `<td>${a.valueUsd != null ? '$' + fmtMoney(a.valueUsd) : '—'}</td>` +
      `<td>${a.actualPct != null ? a.actualPct.toFixed(2) + '%' : '—'}</td>` +
      `<td>${drift}</td>` +
      `<td>${trigger}</td>`;
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

  // exchange sync: link form vs linked-account panel + pending flows
  renderExchange(d.exchange, d.pendingFlows || [], profile);

  // sensitivity tuner: last persisted sweep result
  renderTune(d.latestTune, profile);

  // composition lab: last persisted mix search
  renderCompose(d.latestCompose);

  // repaint run controls (button/status/bar) for THIS profile — a job still
  // running on another profile keeps polling untouched; its status only
  // shows when that profile is on screen.
  renderJobControls('tune');
  renderJobControls('compose');

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
  renderTelegramStatus();

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
  const chat = mk('r-chat', 'Telegram chat ID', r.telegram_chat_id);
  chat.title = 'Optional. Click "Find chat IDs" below to fill this in — no need to type it.';
  row.append(mk('r-email', 'email@example.com', r.email), chat);
  const test = document.createElement('button');
  test.textContent = 'Test';
  test.className = 'ghost';
  test.title = 'Send a test Telegram message to this chat ID';
  test.addEventListener('click', async () => {
    const chatId = row.querySelector('.r-chat').value.trim();
    if (!chatId) return alert('Enter a chat ID first (use "Find chat IDs").');
    try {
      await api('/telegram/test', { method: 'POST', body: { chat_id: chatId } });
      alert('Test message sent — check Telegram.');
    } catch (err) {
      alert(`Test failed: ${err.message}`);
    }
  });
  const del = document.createElement('button');
  del.textContent = '✕';
  del.className = 'ghost';
  del.addEventListener('click', () => row.remove());
  row.append(test, del);
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

// ---- telegram bot (one bot, all profiles) ----

function renderTelegramStatus() {
  $('#tg-status').textContent = state.telegramConfigured
    ? 'Telegram bot: configured — recipients message the bot once (/start), then "Find chat IDs".'
    : 'Telegram bot: NOT configured — create one with @BotFather (/newbot) and paste its token here.';
}

$('#tg-save').addEventListener('click', async () => {
  const token = $('#tg-token').value.trim();
  try {
    const r = await api('/telegram/token', { method: 'POST', body: { token } });
    state.telegramConfigured = Boolean(r.configured);
    $('#tg-token').value = '';
    renderTelegramStatus();
    alert(token ? `Token verified — bot @${r.username} is live.` : 'Stored token cleared.');
  } catch (err) {
    alert(`Token rejected: ${err.message}`);
  }
});

$('#tg-find').addEventListener('click', async () => {
  const box = $('#tg-chats');
  box.innerHTML = '<p class="muted">Checking recent messages to the bot…</p>';
  try {
    const chats = await api('/telegram/chats');
    box.innerHTML = '';
    if (chats.length === 0) {
      box.innerHTML =
        '<p class="muted">No recent chats. Each recipient must open the bot in Telegram and send /start ' +
        '(messages older than ~24h stop showing here — just send it again).</p>';
      return;
    }
    for (const c of chats) {
      const row = document.createElement('div');
      row.className = 'recipient-row';
      const label = document.createElement('span');
      label.textContent = `${c.name}${c.username ? ' (@' + c.username + ')' : ''} — ${c.chat_id}`;
      const use = document.createElement('button');
      use.textContent = 'Use';
      use.className = 'ghost';
      use.title = 'Fill this chat ID into the first empty recipient row';
      use.addEventListener('click', () => {
        const empty = [...document.querySelectorAll('#n-recipients .r-chat')].find((i) => !i.value.trim());
        if (empty) empty.value = c.chat_id;
        else $('#n-recipients').appendChild(recipientRow({ telegram_chat_id: c.chat_id }));
      });
      row.append(label, use);
      box.appendChild(row);
    }
  } catch (err) {
    box.innerHTML = `<p class="warn-text">${err.message}</p>`;
  }
});

$('#n-save').addEventListener('click', async () => {
  const recipients = [...document.querySelectorAll('#n-recipients .recipient-row')].map((row) => ({
    email: row.querySelector('.r-email').value.trim(),
    telegram_chat_id: row.querySelector('.r-chat').value.trim(),
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
    parts.push(`Telegram: ${r.telegramOk} sent${r.telegramFailed.length ? `, ${r.telegramFailed.length} FAILED` : ''}`);
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
        fee_pct: Number($('#s-fee').value),
        spread_pct: Number($('#s-spread').value),
      },
    });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

// ---- sensitivity tuner (Phase 2) ----

function renderTune(latest, profile) {
  const box = $('#tune-result');
  if (!latest || !latest.result) {
    box.classList.add('hidden');
    return;
  }
  const r = latest.result;
  box.classList.remove('hidden');

  const reco = $('#tune-reco');
  if (r.recommendation) {
    const same = Math.abs(r.recommendation.x - profile.threshold_pct) < 1e-9;
    reco.innerHTML =
      `Recommended sensitivity: <strong>${r.recommendation.x}%</strong> ` +
      `<span class="muted">(${r.recommendation.reason}; current setting: ${profile.threshold_pct}%${same ? ' — already applied' : ''})</span>`;
  } else {
    reco.innerHTML = '<strong>No recommendation</strong> <span class="muted">— see warning below.</span>';
  }

  const warn = $('#tune-warnings');
  warn.textContent = (r.warnings || []).join(' ');
  warn.classList.toggle('hidden', !(r.warnings || []).length);

  const tbody = $('#tune-table tbody');
  tbody.innerHTML = '';
  const holdTr = document.createElement('tr');
  holdTr.innerHTML =
    `<td class="muted">hold</td><td class="muted">—</td>` +
    `<td>${fmtPct(r.hold.valueGrowthPct)}</td><td class="muted">baseline</td>` +
    `<td>${r.hold.maxValueDrawdownPct.toFixed(1)}%</td><td class="muted">0</td><td class="muted">—</td><td></td>`;
  tbody.appendChild(holdTr);
  for (const row of r.grid) {
    const tr = document.createElement('tr');
    const isReco = r.recommendation && row.x === r.recommendation.x;
    if (isReco) tr.classList.add('index-row');
    tr.innerHTML =
      `<td>${row.x}%${isReco ? ' ★' : ''}${row.x === r.currentX ? ' <span class="muted">(current)</span>' : ''}</td>` +
      `<td>${fmtPct(row.netBasketGrowthPct)}</td>` +
      `<td>${fmtPct(row.valueGrowthPct)}</td>` +
      `<td>${fmtPct(row.valueGrowthPct - r.hold.valueGrowthPct)}</td>` +
      `<td>${row.maxValueDrawdownPct.toFixed(1)}%</td>` +
      `<td>${row.tradeCount}</td>` +
      `<td>${row.feesPct.toFixed(2)}%</td>`;
    const td = document.createElement('td');
    const apply = document.createElement('button');
    apply.textContent = 'Apply';
    apply.className = 'ghost';
    apply.title = `Set this profile's sensitivity to ${row.x}%`;
    apply.addEventListener('click', async () => {
      if (!confirm(`Set sensitivity to ${row.x}% (currently ${profile.threshold_pct}%)?`)) return;
      try {
        await api(`/profiles/${state.selectedId}/apply-threshold`, {
          method: 'POST',
          body: { x: row.x, stamp: r.stamp },
        });
        await refresh();
      } catch (err) {
        alert(err.message);
      }
    });
    td.appendChild(apply);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  const s = r.stamp || {};
  $('#tune-stamp').textContent =
    `Swept ${new Date(latest.createdAt).toLocaleString()} · ${s.assets ? s.assets.map((x) => x.toUpperCase()).join('/') : ''} · ` +
    `${s.bars} ${s.granularity === 'hourly' ? 'hourly' : 'daily'} bars (${s.dataFrom ? new Date(s.dataFrom).toISOString().slice(0, 10) : '?'} → ` +
    `${s.dataTo ? new Date(s.dataTo).toISOString().slice(0, 10) : '?'}) · fee ${s.feePct}%/leg + spread ${s.spreadPct}% · ` +
    `execution lag ${s.lagHours}h · Apply refuses if targets or costs have changed since.`;
}

// ---- analysis-job registry (tuner + composition lab) ----
//
// Long jobs (tune-threshold, compose) run server-side per profile. The run
// controls (button / status / bar) are ONE shared set in the detail panel,
// so they must be painted from whichever profile you're currently viewing —
// not from whatever job happens to be polling. Each in-flight job keeps its
// OWN poll interval, keyed by profile, that lives across profile switches
// and is never cleared by switching (the running job is untouched). When a
// job's profile isn't the one on screen its progress just accrues quietly;
// switch to it and the controls repaint from its live state.
const runningJobs = { tune: {}, compose: {} }; // kind -> profileId -> {jobId, progress, progressPct, interval}
const jobMsg = { tune: {}, compose: {} };      // kind -> profileId -> last terminal message (error, or '')
const JOB_WIDGETS = {
  tune: { run: '#tune-run', status: '#tune-status' },
  compose: { run: '#c-run', status: '#c-status', bar: '#c-bar', fill: '#c-bar-fill' },
};

// Paint one kind's run controls from the CURRENTLY selected profile's state.
function renderJobControls(kind) {
  const w = JOB_WIDGETS[kind];
  const runBtn = $(w.run);
  const status = $(w.status);
  if (!runBtn) return;
  const entry = runningJobs[kind][state.selectedId];
  if (entry) {
    runBtn.disabled = true;
    status.textContent = entry.progress || 'running…';
    if (w.bar) {
      $(w.bar).classList.remove('hidden');
      $(w.fill).style.width = (entry.progressPct != null ? entry.progressPct : 0) + '%';
    }
  } else {
    runBtn.disabled = false;
    status.textContent = jobMsg[kind][state.selectedId] || '';
    if (w.bar) $(w.bar).classList.add('hidden');
  }
}

// Start polling a launched job; the interval survives profile switches and
// only stops when the job ends. Only repaints the shared controls while the
// job's profile is the one on screen; a completed job refreshes the detail
// (which re-reads the persisted result) if you're watching it, otherwise the
// result simply appears the next time you open that profile.
function trackJob(kind, jobId, profileId) {
  const existing = runningJobs[kind][profileId];
  if (existing) clearInterval(existing.interval);
  const entry = { jobId, progress: 'starting…', progressPct: null, interval: null };
  runningJobs[kind][profileId] = entry;
  jobMsg[kind][profileId] = '';
  if (profileId === state.selectedId) renderJobControls(kind);
  entry.interval = setInterval(async () => {
    try {
      const job = await api(`/jobs/${jobId}`);
      if (job.status === 'running') {
        entry.progress = job.progress || 'running…';
        entry.progressPct = job.progressPct;
        if (profileId === state.selectedId) renderJobControls(kind);
      } else {
        clearInterval(entry.interval);
        delete runningJobs[kind][profileId];
        jobMsg[kind][profileId] = job.status === 'done' ? '' : `failed: ${job.error}`;
        if (profileId === state.selectedId) {
          if (job.status === 'done') await refresh();
          else renderJobControls(kind);
        }
      }
    } catch (err) {
      clearInterval(entry.interval);
      delete runningJobs[kind][profileId];
      jobMsg[kind][profileId] = err.message;
      if (profileId === state.selectedId) renderJobControls(kind);
    }
  }, 2000);
}

$('#tune-run').addEventListener('click', async () => {
  const profileId = state.selectedId;
  $('#tune-run').disabled = true;
  $('#tune-status').textContent = 'starting…';
  try {
    const { jobId } = await api(`/profiles/${profileId}/tune-threshold`, {
      method: 'POST',
      body: { granularity: $('#tune-gran').value, lag_hours: Number($('#tune-lag').value) },
    });
    trackJob('tune', jobId, profileId);
  } catch (err) {
    jobMsg.tune[profileId] = err.message;
    if (profileId === state.selectedId) renderJobControls('tune');
  }
});

// ---- composition lab (Phase 2.75) ----

function mixLabel(assets) {
  return assets
    .map((a) => `${a.symbol.toUpperCase()}${a.isIndex ? '⚓' : ''} ${a.pct}%`)
    .join(' · ');
}

function renderCompose(latest) {
  const box = $('#c-result');
  if (!latest || !latest.result) {
    box.classList.add('hidden');
    return;
  }
  const r = latest.result;
  box.classList.remove('hidden');
  $('#c-caveat').textContent = r.caveat || '';

  const tbody = $('#c-table tbody');
  tbody.innerHTML = '';
  const addRow = (label, row, highlight) => {
    const tr = document.createElement('tr');
    if (highlight) tr.classList.add('index-row');
    tr.innerHTML =
      `<td>${label}</td>` +
      `<td>${fmtPct(row.train.score)}</td>` +
      `<td><strong>${row.oos.value != null ? (row.oos.value >= 0 ? '+' : '') + row.oos.value.toFixed(2) + '%' : '—'}</strong></td>` +
      `<td>${fmtPct(row.oos.hold)}</td>` +
      `<td>${row.oos.dd != null ? row.oos.dd.toFixed(1) + '%' : '—'}</td>` +
      `<td>${row.oos.x != null ? row.oos.x + '%' : 'hold'}</td>` +
      `<td>${row.oos.trades}</td>`;
    tbody.appendChild(tr);
  };
  if (r.currentMix) addRow(`CURRENT: ${mixLabel(r.currentMix.assets)}`, r.currentMix, true);
  for (const m of r.mixes) addRow(mixLabel(m.assets), m, false);

  // Solo-screen verdicts: which candidates made it into combinatorics.
  const sc = $('#c-screen');
  if (r.screen && r.screen.length) {
    const kept = r.screen.filter((s) => s.kept);
    const dropped = r.screen.filter((s) => !s.kept);
    sc.textContent =
      `Solo screen (50/50 vs tether — harvest edge over holding, worse train half): kept ` +
      kept.map((s) => `${s.symbol.toUpperCase()} ${s.soloTrain >= 0 ? '+' : ''}${s.soloTrain.toFixed(1)}%`).join(', ') +
      (dropped.length
        ? ` · weeded out: ` +
          dropped.map((s) => `${s.symbol.toUpperCase()} ${s.soloTrain >= 0 ? '+' : ''}${s.soloTrain.toFixed(1)}%`).join(', ')
        : '');
  } else {
    sc.textContent = '';
  }

  const w = r.window || {};
  const u = r.universe || {};
  const combos = r.combos
    ? `${r.combos.broadSampled.toLocaleString()} combos broad-searched, ${r.combos.contenders} contenders full-scored`
    : `${r.evaluatedMixes} mixes evaluated`;
  $('#c-stamp').textContent =
    `Searched ${new Date(latest.createdAt).toLocaleString()} · ${combos} · ` +
    `universe ${u.covered}/${u.considered} candidates` +
    (u.venue ? ` (restricted to ${u.venue}-tradable${u.notOnVenue && u.notOnVenue.length ? `; dropped: ${u.notOnVenue.map((s) => s.toUpperCase()).join(', ')}` : ''})` : ' (no linked venue — unconstrained)') +
    (u.heldExcludedFrozen ? ` · ${u.heldExcludedFrozen} held asset(s) excluded: buy-frozen` : '') +
    (u.windowDays && u.requestedDays && u.windowDays < u.requestedDays ? ` · window auto-shrunk ${u.requestedDays}d → ${u.windowDays}d for coverage` : '') +
    ` · window ${w.from ? new Date(w.from).toISOString().slice(0, 10) : '?'} → ${w.to ? new Date(w.to).toISOString().slice(0, 10) : '?'}` +
    ` · out-of-sample from ${w.splitAt ? new Date(w.splitAt).toISOString().slice(0, 10) : '?'} (${w.oosBars} bars).`;
}

$('#c-run').addEventListener('click', async () => {
  const profileId = state.selectedId;
  $('#c-run').disabled = true;
  $('#c-status').textContent = 'starting…';
  try {
    const { jobId } = await api(`/profiles/${profileId}/compose`, {
      method: 'POST',
      body: { samples: Number($('#c-intensity').value) },
    });
    trackJob('compose', jobId, profileId);
  } catch (err) {
    jobMsg.compose[profileId] = err.message;
    if (profileId === state.selectedId) renderJobControls('compose');
  }
});

// ---- exchange sync ----

function renderExchange(x, pendingFlows, profile) {
  $('#x-none').classList.toggle('hidden', Boolean(x));
  $('#x-linked').classList.toggle('hidden', !x);
  if (!x) return;

  const last = x.last_sync_at ? new Date(x.last_sync_at).toLocaleString() : 'never';
  const status = x.last_sync_status
    ? x.last_sync_status === 'ok'
      ? '✓ ok'
      : `⚠ ${x.last_sync_status}`
    : '—';
  $('#x-info').textContent =
    `${x.venue.charAt(0).toUpperCase() + x.venue.slice(1)} · key ${x.api_key_masked} · ` +
    `last sync: ${last} · status: ${status}`;

  // Sync-note warnings: currencies the venue holds that no asset matches,
  // and residuals the trades/flows didn't explain.
  const note = x.note || {};
  const warnings = [];
  const cap = note.capability || {};
  if (cap.trades && cap.trades !== 'ok') {
    warnings.push(
      `Trade history unavailable (${cap.trades}) — fills won't sync automatically. ` +
        `On Bitso, reading your own trades requires the trading/orders permission group: edit the API key to add it ` +
        `(keep "Make withdrawals" and "Perform security actions" OFF; the IP allowlist still applies).`
    );
  }
  if (cap.flows && cap.flows !== 'ok') {
    warnings.push(
      `Deposit/withdrawal history unavailable (${cap.flows}) — flows won't be detected automatically; ` +
        `record them manually under Deposit / withdraw until the key permission is fixed.`
    );
  }
  if (note.unmapped && note.unmapped.length) {
    warnings.push(`On the venue but not in this profile: ${note.unmapped.map((c) => c.toUpperCase()).join(', ')} — add the asset(s) to include them.`);
  }
  for (const u of note.unexplained || []) {
    warnings.push(
      `${u.symbol.toUpperCase()}: venue balance differs by ${u.residual >= 0 ? '+' : ''}${u.residual} ` +
        `beyond what synced trades/flows explain — record it as a deposit/withdrawal or fix the quantity.`
    );
  }
  $('#x-note').textContent = warnings.join(' ');
  $('#x-note').classList.toggle('hidden', warnings.length === 0);

  $('#x-minutes').value = x.sync_minutes;
  $('#x-auto').checked = Boolean(x.auto_flows);
  state.exchangeId = x.id;

  // Observed fee vs the profile's cost model (advisory: apply with one click).
  const feeBox = $('#x-fee');
  feeBox.innerHTML = '';
  if (x.feeObserved && x.feeObserved.trades > 0) {
    const obs = x.feeObserved.feePct;
    feeBox.append(
      `Observed taker fee from ${x.feeObserved.trades} real fill(s): ${obs.toFixed(3)}%/leg · profile setting: ${profile.fee_pct}%/leg `
    );
    if (Math.abs(obs - profile.fee_pct) > 0.005) {
      const btn = document.createElement('button');
      btn.className = 'ghost';
      btn.textContent = `Apply ${obs.toFixed(3)}%`;
      btn.addEventListener('click', async () => {
        try {
          await api(`/profiles/${state.selectedId}`, {
            method: 'PATCH',
            body: { fee_pct: Number(obs.toFixed(3)) },
          });
          await refresh();
        } catch (err) {
          alert(err.message);
        }
      });
      feeBox.appendChild(btn);
    }
  } else {
    feeBox.textContent = 'Observed fee: no synced fills yet — appears after the first trades sync in.';
  }

  // Pending flows awaiting confirmation.
  $('#x-pending-wrap').classList.toggle('hidden', pendingFlows.length === 0);
  const tbody = $('#x-pending-table tbody');
  tbody.innerHTML = '';
  for (const f of pendingFlows) {
    const tr = document.createElement('tr');
    const when = document.createElement('td');
    when.textContent = new Date(f.ts).toLocaleString();
    const kind = document.createElement('td');
    kind.textContent = f.kind;
    const amt = document.createElement('td');
    amt.textContent = `${f.amount >= 0 ? '+' : ''}${f.amount} ${f.code.toUpperCase()}`;
    amt.className = f.amount >= 0 ? 'pos' : 'neg';
    const actions = document.createElement('td');
    const ok = document.createElement('button');
    ok.textContent = 'Confirm';
    ok.addEventListener('click', async () => {
      try {
        await api(`/pending-flows/${f.id}/confirm`, { method: 'POST' });
        await refresh();
      } catch (err) {
        alert(err.message);
      }
    });
    const no = document.createElement('button');
    no.textContent = 'Dismiss';
    no.className = 'ghost';
    no.addEventListener('click', async () => {
      if (!confirm('Dismiss this detected flow? Only do this if it is already recorded (or wrong).')) return;
      try {
        await api(`/pending-flows/${f.id}/dismiss`, { method: 'POST' });
        await refresh();
      } catch (err) {
        alert(err.message);
      }
    });
    actions.append(ok, no);
    tr.append(when, kind, amt, actions);
    tbody.appendChild(tr);
  }
}

$('#x-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#x-link').disabled = true;
  try {
    await api(`/profiles/${state.selectedId}/exchange`, {
      method: 'POST',
      body: {
        venue: $('#x-venue').value,
        api_key: $('#x-key').value.trim(),
        api_secret: $('#x-secret').value.trim(),
      },
    });
    $('#x-key').value = '';
    $('#x-secret').value = '';
    await refresh();
  } catch (err) {
    alert(err.message);
  } finally {
    $('#x-link').disabled = false;
  }
});

$('#x-sync').addEventListener('click', async () => {
  $('#x-sync').disabled = true;
  try {
    const r = await api(`/exchange-accounts/${state.exchangeId}/sync`, { method: 'POST' });
    const s = r.summary;
    const parts = [`${s.tradesApplied} trade(s) applied`];
    if (s.adopted && s.adopted.length) {
      parts.push(`starting balances adopted: ${s.adopted.map((a) => `${a.quantity} ${a.symbol.toUpperCase()}`).join(', ')}`);
    }
    if (s.newPendingFlows) parts.push(`${s.newPendingFlows} deposit/withdrawal(s) detected — confirm below`);
    if (s.autoAppliedFlows) parts.push(`${s.autoAppliedFlows} flow(s) auto-applied`);
    if (s.unexplained.length) parts.push(`${s.unexplained.length} unexplained difference(s) — see warning`);
    if (s.rearmed) parts.push('notifications re-armed');
    const cap = s.capability || {};
    if ((cap.trades && cap.trades !== 'ok') || (cap.flows && cap.flows !== 'ok')) {
      parts.push('LIMITED: some history endpoints are blocked by key permissions — see the warning under Exchange sync');
    }
    alert(`Sync complete: ${parts.join(', ')}.`);
    await refresh();
  } catch (err) {
    alert(`Sync failed: ${err.message}`);
  } finally {
    $('#x-sync').disabled = false;
  }
});

$('#x-minutes').addEventListener('change', async () => {
  try {
    await api(`/exchange-accounts/${state.exchangeId}`, {
      method: 'PATCH',
      body: { sync_minutes: Number($('#x-minutes').value) },
    });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

$('#x-auto').addEventListener('change', async () => {
  const on = $('#x-auto').checked;
  if (on && !confirm('Auto-apply detected deposits/withdrawals without confirmation?\n\nOnly enable this once synced detections have proven correct — a wrong flow splice silently corrupts the basket track record.')) {
    $('#x-auto').checked = false;
    return;
  }
  try {
    await api(`/exchange-accounts/${state.exchangeId}`, { method: 'PATCH', body: { auto_flows: on } });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

$('#x-unlink').addEventListener('click', async () => {
  if (!confirm('Unlink this exchange account? Synced history stays; syncing stops.')) return;
  try {
    await api(`/exchange-accounts/${state.exchangeId}`, { method: 'DELETE' });
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
  state.telegramConfigured = Boolean(session.telegramConfigured);
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
