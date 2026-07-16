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

function renderDetail() {
  const d = state.detail;
  $('#detail-empty').classList.toggle('hidden', Boolean(d));
  $('#detail').classList.toggle('hidden', !d);
  if (!d) return;

  const { profile, assets, sets, alertLog } = d;
  $('#d-name').textContent = profile.name;
  const polled = profile.last_polled_at
    ? new Date(profile.last_polled_at).toLocaleString()
    : 'never';
  $('#d-meta').textContent =
    `Index: ${profile.index_asset} · threshold ${profile.threshold_pct}% · ` +
    `polls every ${profile.poll_minutes} min · last poll: ${polled}`;

  // assets table
  const tbody = $('#asset-table tbody');
  tbody.innerHTML = '';
  for (const a of assets) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${a.symbol.toUpperCase()}</td>` +
      `<td>${a.last ? '$' + fmtNum(a.last.usd_price) : '—'}</td>` +
      `<td>${a.last ? fmtNum(a.last.rel_price) : '—'}</td>` +
      `<td>${fmtNum(a.baseline_rel)}</td>` +
      `<td>${fmtPct(a.driftPct)}</td>`;
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

// ---- boot ----

(async function boot() {
  const session = await fetch('api/session').then((r) => r.json());
  $('#email-status').textContent = session.emailConfigured
    ? 'email alerts: on'
    : 'email alerts: not configured';
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
