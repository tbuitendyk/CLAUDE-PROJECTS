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
  const addLi = (p, { indent = false, head = false } = {}) => {
    const li = document.createElement('li');
    li.className =
      (p.id === state.selectedId ? 'active' : '') + (indent ? ' sub-item' : '') + (head ? ' group-head' : '');
    const label = document.createElement('span');
    label.textContent = head ? `🪣 ${p.name}` : p.name;
    // The shell is intentionally never-polling; struck-through would read as
    // "broken" on a group header, so only non-head disabled profiles get it.
    if (!p.enabled && !head) label.className = 'off';
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = head ? 'account' : `${p.threshold_pct}%`;
    li.append(label, meta);
    li.addEventListener('click', async () => {
      state.selectedId = p.id;
      renderProfiles();
      await loadDetail();
      renderDetail();
    });
    ul.appendChild(li);
  };

  // Grouping: a multi-profile exchange account renders as its Unallocated
  // shell on top (the account-level view) with its linked strategy profiles
  // indented underneath in creation order. Everything else renders flat in
  // creation order, groups slotted where their oldest member sits.
  const byCreated = (a, b) => (a.created_at || 0) - (b.created_at || 0) || a.id - b.id;
  const groups = new Map(); // account_id -> members[]
  for (const p of state.profiles) {
    if (p.exchange_account_id) {
      if (!groups.has(p.exchange_account_id)) groups.set(p.exchange_account_id, []);
      groups.get(p.exchange_account_id).push(p);
    }
  }
  const rendered = new Set();
  const entries = [];
  for (const p of [...state.profiles].sort(byCreated)) {
    if (rendered.has(p.id)) continue;
    const members = p.exchange_account_id ? groups.get(p.exchange_account_id) : null;
    const shell = members && members.find((m) => m.is_shell);
    if (members && members.length > 1 && shell) {
      entries.push({ head: shell, children: members.filter((m) => !m.is_shell).sort(byCreated) });
      for (const m of members) rendered.add(m.id);
    } else {
      entries.push({ single: p });
      rendered.add(p.id);
    }
  }
  for (const e of entries) {
    if (e.single) addLi(e.single);
    else {
      addLi(e.head, { head: true });
      for (const c of e.children) addLi(c, { indent: true });
    }
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
  // Fire-and-forget: re-attach to any search still running server-side (a
  // reload or profile flip must not orphan a live progress display).
  resumeActiveJobs();
}

function fmtUtc(ts) {
  // All clocks in this app are UTC and say so — local-time rendering caused
  // real confusion about when a track record actually started.
  if (!ts) return 'never';
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
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

// Editable quantity cell; saves on change. Inside an account GROUP the cell
// is read-only: every quantity change there has a proper owner (sync,
// carve-outs, master deposits, rewind) and a bare number edit would break
// the reconcile invariant and fake performance — the API refuses it too.
function qtyCell(asset) {
  const td = document.createElement('td');
  const p = state.detail && state.detail.profile;
  if (p && (p.is_shell || groupShellFor(p))) {
    td.textContent = String(asset.quantity);
    td.title = p.is_shell
      ? 'Pool balances change via account sync, deposits, and carve-outs — not by editing the number.'
      : 'Sub-account balances change via account sync, carve-outs from the master, and the attribution inbox (or rewind a bad transaction) — not by editing the number.';
    return td;
  }
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
  $('#d-name').textContent = profile.is_shell ? `🪣 ${profile.name}` : profile.name;
  const gShell = groupShellFor(profile);
  $('#detail').classList.toggle('group-sub', Boolean(gShell));
  applyShellView(Boolean(profile.is_shell));
  applyView();
  const polled = profile.last_polled_at
    ? fmtUtc(profile.last_polled_at)
    : 'never';
  const idx = (totals && totals.indexLabel) || 'USD';
  const meta = $('#d-meta');
  if (profile.is_shell) {
    const hasTether = assets.some((a) => a.is_index);
    meta.textContent =
      (hasTether
        ? `Account pool, valued in ${idx} (⚓ in the table picks the tether). `
        : 'Account pool — checkmark an asset below as the ⚓ tether to value everything in it. ') +
      `Sync & poll reads the account (balances, trades, attribution) and reprices (last poll: ${polled}); ` +
      'it never alerts. Deposits land here, dust settles here, and sub-accounts are funded from here by carve-out.';
  } else if (gShell) {
    // A grouped sub's poll never reads the venue — say how fresh the
    // quantities under the prices are, and where the sync lives.
    const syncedAt =
      d.exchange && d.exchange.last_sync_at ? fmtUtc(d.exchange.last_sync_at) : 'never';
    meta.innerHTML =
      `Index: ${idx} (tethered asset) · reacts to ~${profile.threshold_pct}% price moves · ` +
      `polls every ${profile.poll_minutes} min · last poll: ${polled} · account: ` +
      `<a class="meta-link" id="d-shell-link">🪣 ${gShell.name}</a>` +
      ` · balances as of account sync ${syncedAt} (sync &amp; poll on the master)`;
    $('#d-shell-link').addEventListener('click', async () => {
      state.selectedId = gShell.id;
      renderProfiles();
      await loadDetail();
      renderDetail();
    });
  } else {
    meta.textContent =
      `Index: ${idx} (tethered asset) · reacts to ~${profile.threshold_pct}% price moves · ` +
      `polls every ${profile.poll_minutes} min · last poll: ${polled}`;
  }

  // "Poll now" by context: the master and a 1:1-linked profile read the
  // ACCOUNT first (sync: balances, trades, attribution) and then reprice —
  // that is what the button always felt like it meant. A grouped sub or an
  // unlinked profile reprices its recorded quantities only.
  {
    const pollBtn = $('#d-poll');
    const syncsFirst = Boolean(d.exchange && (profile.is_shell || !gShell));
    pollBtn.textContent = syncsFirst ? 'Sync & poll' : 'Poll now';
    pollBtn.title = syncsFirst
      ? 'Reads balances and trades from the exchange (sync + attribution), then refreshes prices and re-evaluates alerts. Also the universal notification reset.'
      : gShell
        ? "Refreshes market prices and re-evaluates alerts over this sub-account's recorded balances. The balances themselves change only via account sync — use Sync & poll on the master. Also the universal notification reset."
        : 'Refreshes market prices and re-evaluates alerts (quantities here are manual). Also the universal notification reset.';
  }

  // Editable sensitivity / poll / trading-cost settings.
  $('#s-threshold').value = profile.threshold_pct;
  $('#s-poll').value = profile.poll_minutes;
  $('#s-fee').value = profile.fee_pct != null ? profile.fee_pct : 0.38;
  $('#s-spread').value = profile.spread_pct != null ? profile.spread_pct : 0.1;

  // Overall performance, two lines: (1) currency basket — unit growth,
  // (2) value in the index currency with growth since start.
  const summary = $('#d-summary');
  summary.innerHTML = '';
  // On the shell, this block is the ACCOUNT STATUS (total in the tether,
  // per-sub-account split, combined balances) — filled asynchronously by
  // the sub-accounts summary fetch; basket/value lines are strategy-only.
  if (profile.is_shell) {
    summary.innerHTML = '<div class="perf-line">Account status: <span class="muted">pricing…</span></div>';
  }
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
      ? `since ${fmtUtc(totals.valueStartedAt)}`
      : 'since start';
    // The line names the BASELINE the % is measured from — the original
    // value, not just the growth — and offers ✎ to re-pin it (entry costs
    // are funding-path artifacts, not balancing performance).
    line2.innerHTML =
      `Value (${idx}): <strong>${fmtNum(totals.totalRel)}</strong> ` +
      (totals.growthPct != null
        ? `${fmtPct(totals.growthPct)} <span class="muted">from ${totals.valueBaselineRel != null ? fmtNum(totals.valueBaselineRel) : '?'} ${since}</span> `
        : '') +
      `<span class="muted">· $${fmtMoney(totals.totalUsd)} USD</span>`;
    if (!profile.is_shell && totals.growthPct != null) {
      const edit = document.createElement('button');
      edit.className = 'ghost';
      edit.textContent = '✎ baseline';
      edit.title =
        `Set the value track record's baseline in ${idx} units — the amount performance is measured FROM. ` +
        'Prefilled with the CURRENT value; overwrite it with the true initial capital (entry costs like fiat ' +
        'conversions are funding artifacts, not balancing performance). The "since" date is unchanged.';
      edit.addEventListener('click', () => {
        edit.disabled = true;
        const box = document.createElement('span');
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = 'any';
        inp.min = '0';
        inp.value = Math.round(totals.totalRel * 100) / 100; // cents are enough
        inp.className = 'cell-input';
        inp.style.width = '110px';
        inp.title = `Baseline amount in ${idx} units`;
        // Start clock, ALWAYS UTC (editable — the original stamp came from
        // whatever event anchored the index, not necessarily your fills).
        const when = document.createElement('input');
        when.type = 'text';
        when.className = 'cell-input';
        when.style.width = '150px';
        when.placeholder = 'YYYY-MM-DD HH:MM UTC';
        when.title = 'Track-record start, in UTC (e.g. 2026-07-21 08:00). Leave as-is to keep the current start.';
        when.value = totals.valueStartedAt ? new Date(totals.valueStartedAt).toISOString().replace('T', ' ').slice(0, 16) : '';
        const save = document.createElement('button');
        save.textContent = 'Save baseline';
        const cancel = document.createElement('button');
        cancel.textContent = 'Cancel';
        cancel.className = 'ghost';
        save.addEventListener('click', async () => {
          try {
            await api(`/profiles/${state.selectedId}/value-baseline`, {
              method: 'POST',
              body: { baseline: Number(inp.value), startedAt: when.value.trim() },
            });
            await refresh();
          } catch (err) {
            alert(err.message);
          }
        });
        cancel.addEventListener('click', () => {
          box.remove();
          edit.disabled = false;
        });
        box.append(' ', inp, ' ', when, document.createTextNode(' UTC '), save, ' ', cancel);
        line2.append(box);
        inp.focus();
        inp.select();
      });
      line2.append(' ', edit);
    }
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
    if (!profile.is_shell) summary.append(line1, line2, line3);
  } else if (!profile.is_shell) {
    summary.append(line1, line2);
  }

  // Strategy-column stripping + pool semantics for the shell's asset table.
  $('#detail').classList.toggle('shell-mode', Boolean(profile.is_shell));

  // target allocations should add up to 100 (tethered index asset included)
  // — a strategy concern; the shell has no targets by design.
  const warning = $('#alloc-warning');
  const targetTotal = totals ? totals.targetTotal : 0;
  if (profile.is_shell) {
    warning.classList.add('hidden');
  } else if (Math.abs(targetTotal - 100) > 0.01) {
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
    // Symbol cell: just the ticker (⚓ marks the tethered index). All state
    // badges live in the dedicated Status column so this stays uncluttered.
    const sym = document.createElement('td');
    sym.className = 'sym-cell';
    sym.textContent = a.symbol.toUpperCase() + (a.is_index ? ' ⚓' : '');
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

    // Status cell: buy-freeze badge (click to unfreeze), the standing
    // ignore-freeze toggle, and the depeg flag — all the state that used to
    // crowd the Symbol cell, now in one place.
    const statusTd = document.createElement('td');
    statusTd.className = 'status-cell';
    // Standing "ignore freeze" toggle for EVERY active base asset FIRST, then
    // the frozen status badge. freeze_override persists across an auto-unfreeze,
    // so the toggle must be visible and settable whether or not the asset is
    // currently frozen — otherwise a lingering override sits invisible on an
    // unfrozen asset and silently neutralizes the next freeze. When set, BUY
    // alerts and composition-lab eligibility stay active even if the rail
    // freezes the asset (the freeze status still tracks).
    const activeAsset = !a.is_index && (a.target_pct > 0 || a.quantity > 0);
    if (activeAsset) {
      const ovrLabel = document.createElement('label');
      ovrLabel.className = 'chip chip-toggle' + (a.freeze_override ? ' chip-on' : '');
      ovrLabel.title =
        'Standing setting: never buy-freeze this asset. BUY alerts and composition-lab eligibility stay active even if the safety rail freezes it. ' +
        'Persists whether or not it is currently frozen.';
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
      ovrLabel.append(ovr, document.createTextNode('ignore freeze'));
      statusTd.appendChild(ovrLabel);
    }
    if (a.buy_frozen) {
      const badge = document.createElement('button');
      badge.textContent = a.freeze_override ? '🧊 frozen · ignored' : '🧊 frozen';
      badge.className = 'chip chip-frozen';
      badge.title =
        `BUY alerts frozen — ${a.freeze_reason || 'structural break'}. Sells still alert. ` +
        (a.freeze_override ? 'Currently IGNORED (effects off) via the toggle. ' : '') +
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
      statusTd.appendChild(badge);
    }
    if (a.depegged) {
      const peg = document.createElement('span');
      peg.textContent = '⚠ depeg';
      peg.title = 'Trading outside the $0.98–1.02 peg band (valuation stays pinned 1:1)';
      peg.className = 'chip chip-warn';
      statusTd.appendChild(peg);
    }
    if (!statusTd.childNodes.length) {
      statusTd.innerHTML = '<span class="muted">—</span>';
    }
    tr.appendChild(statusTd);

    const td = document.createElement('td');
    const del = document.createElement('button');
    del.textContent = '✕';
    del.className = 'ghost';
    del.addEventListener('click', async () => {
      if (!confirm(`Remove ${a.symbol.toUpperCase()} from this profile?`)) return;
      try {
        const r = await api(`/assets/${a.id}`, { method: 'DELETE' });
        // Grouped sub-account with a balance: the money went back to the
        // master pool, not into the void — say so.
        if (r.returned) {
          alert(
            `${r.returned.qty} ${r.returned.symbol.toUpperCase()} returned to "${r.returned.toName}" (unallocated pool) — recorded in the account transaction log (rewindable).`
          );
        }
      } catch (err) {
        alert(err.message);
      }
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
      `<td>${fmtUtc(s.ts)}</td>` +
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
      `<td>${fmtUtc(f.ts)}</td><td>${change}</td><td>${f.note ? f.note.replace(/[<>]/g, '') : ''}</td>`;
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
    ? fmtUtc(profile.notify_state_at + 12 * 3600 * 1000)
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
    li.textContent = `${fmtUtc(entry.ts)} ${entry.emailed ? '📧' : ''}\n${entry.message}`;
    log.appendChild(li);
  }

  // Uncommitted edits survive every rebuild (per-profile draft store).
  restoreDrafts(profile.id);
}

// ---- unsaved-field preservation ---------------------------------------------
// Re-renders (the periodic refresh, post-action refreshes, and profile
// switches) rebuild the DOM, which used to eat anything typed but not yet
// saved. Every keystroke in a text field is captured into a PER-PROFILE
// draft store; after any re-render the drafts are written back into the
// rebuilt fields — so flipping between sub-accounts mid-edit (e.g. copying
// emails/chat ids across) keeps every uncommitted value. A draft retires
// itself the moment the server value matches it (i.e. it was saved).
const draftStore = {}; // profileId -> Map(fieldKey -> value)

function fieldKey(el) {
  if (el.id) return '#' + el.id;
  const container = el.closest('[id]');
  const cid = container ? container.id : 'detail';
  const kin = container ? [...container.querySelectorAll(`${el.tagName}.${(el.className || 'x').split(' ')[0]}`)] : [];
  return `${cid}|${(el.className || '').split(' ')[0]}|${el.dataset.assetId || el.dataset.cg || ''}|${kin.indexOf(el)}`;
}

document.addEventListener('input', (e) => {
  const el = e.target;
  if (!state.selectedId) return;
  if (!el.matches || !el.matches('#main-view input[type="text"], #main-view input[type="number"], #main-view input[type="email"], #main-view input:not([type]), #main-view textarea')) return;
  const store = draftStore[state.selectedId] || (draftStore[state.selectedId] = new Map());
  store.set(fieldKey(el), el.value);
});

function restoreDrafts(profileId) {
  const store = draftStore[profileId];
  if (!store || !store.size) return;
  // Drafted EXTRA recipient rows (added but never saved) must exist again
  // before values can land in them.
  const recKeys = [...store.keys()].filter((k) => k.startsWith('n-recipients|'));
  if (recKeys.length) {
    const maxIdx = Math.max(...recKeys.map((k) => Number(k.split('|')[3] || 0)));
    const box = $('#n-recipients');
    while (box && box.querySelectorAll('.r-email').length <= maxIdx) box.appendChild(recipientRow());
  }
  for (const [key, val] of [...store]) {
    let el = null;
    if (key.startsWith('#')) el = document.querySelector(key);
    else {
      const [cid, cls, dataKey, idx] = key.split('|');
      const container = document.getElementById(cid);
      if (container) {
        const kin = [...container.querySelectorAll(`.${cls || 'x'}`)];
        el =
          (dataKey && kin.find((c) => (c.dataset.assetId || c.dataset.cg || '') === dataKey)) ||
          kin[Number(idx)] ||
          null;
      }
    }
    if (!el) continue;
    if (el.value === val) {
      store.delete(key); // committed (or identical) — draft retired
      continue;
    }
    el.value = val;
  }
}

async function refresh() {
  // Keep the caret where the user left it across the rebuild.
  const ae = document.activeElement;
  const focusKey = ae && ae.matches && ae.matches('#main-view input, #main-view textarea') ? fieldKey(ae) : null;
  const sel = focusKey && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null;
  await loadDetail();
  renderDetail();
  if (focusKey) {
    const el = focusKey.startsWith('#') ? document.querySelector(focusKey) : null;
    const target = el || (() => {
      const [cid, cls, dataKey, idx] = focusKey.split('|');
      const container = document.getElementById(cid);
      if (!container) return null;
      const kin = [...container.querySelectorAll(`.${cls || 'x'}`)];
      return (dataKey && kin.find((c) => (c.dataset.assetId || c.dataset.cg || '') === dataKey)) || kin[Number(idx)] || null;
    })();
    if (target) {
      target.focus();
      if (sel && target.setSelectionRange) try { target.setSelectionRange(sel[0], sel[1]); } catch {}
    }
  }
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
    const r = await api(`/profiles/${state.selectedId}/poll`, { method: 'POST' });
    // Sync-first contexts: a venue failure never blocks the price poll, but
    // it must not pass silently either — stale balances under fresh prices.
    if (r.syncError) alert(`Account sync failed (prices were still refreshed): ${r.syncError}`);
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
  // A hypothetical sweep (⇢ tuner from the composition lab) shows the exact
  // mix under test front and centre — not just in the fine-print stamp.
  const stampS = r.stamp || {};
  const mixLine =
    stampS.hypothetical && stampS.targets
      ? `<span class="tune-mix">Mix under test (hypothetical): ${stampS.targets
          .map((t) => {
            const [sym, pct] = t.split(':');
            return `${sym}${stampS.indexSymbol && sym.toLowerCase() === String(stampS.indexSymbol).toLowerCase() ? '⚓' : ''} ${pct}%`;
          })
          .join(' · ')}</span><br>`
      : '';
  if (r.recommendation) {
    const same = Math.abs(r.recommendation.x - profile.threshold_pct) < 1e-9;
    // "current setting" only makes sense for a sweep of the ACTIVE profile's
    // own mix — a hypothetical (lab) sweep compares to nothing applied.
    const settingNote = stampS.hypothetical
      ? ''
      : `; current setting: ${profile.threshold_pct}%${same ? ' — already applied' : ''}`;
    reco.innerHTML =
      mixLine +
      `Recommended sensitivity: <strong>${r.recommendation.x}%</strong> ` +
      `<span class="muted">(${r.recommendation.reason}${settingNote})</span>`;
  } else {
    reco.innerHTML = mixLine + '<strong>No recommendation</strong> <span class="muted">— see warning below.</span>';
  }

  const warn = $('#tune-warnings');
  warn.textContent = (r.warnings || []).join(' ');
  warn.classList.toggle('hidden', !(r.warnings || []).length);

  const s = r.stamp || {};
  const hypothetical = Boolean(s.hypothetical);
  // Recent-window sub-grids (most recent half / quarter of the history).
  const recent = r.recent || {};
  const recCell = (win, x) => {
    const w = recent[win];
    if (!w) return '<td class="muted">—</td>';
    const g = (w.grid || []).find((row) => row.x === x);
    if (!g) return '<td class="muted">—</td>';
    const edge = g.valueGrowthPct - w.hold.valueGrowthPct;
    return `<td>${fmtPct(g.valueGrowthPct)} <span class="${edge >= 0 ? 'pos' : 'neg'}" title="vs holding over this recent window">(${edge >= 0 ? '+' : ''}${edge.toFixed(1)})</span></td>`;
  };
  const recHoldCell = (win) => {
    const w = recent[win];
    return w ? `<td class="muted">${fmtPct(w.hold.valueGrowthPct)} hold</td>` : '<td class="muted">—</td>';
  };

  // The evaluated time periods, stated up top — not just fine print below.
  const d10h = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : '?');
  const yearsH = stampS.bars ? (stampS.granularity === 'hourly' ? stampS.bars / 24 / 365 : stampS.bars / 365) : 0;
  $('#tune-window').textContent =
    `Period: ${d10h(stampS.dataFrom)} → ${d10h(stampS.dataTo)} · ${stampS.bars} ${stampS.granularity === 'hourly' ? 'hourly' : 'daily'} bars ≈ ${yearsH.toFixed(1)} years` +
    (recent.half ? ` · ½ recent = ${d10h(recent.half.from)} → ${d10h(recent.half.to)}` : '') +
    (recent.quarter ? ` · ¼ recent = ${d10h(recent.quarter.from)} → ${d10h(recent.quarter.to)}` : '') +
    (stampS.idealTether ? ' · ⚠ tether idealized $1' : '');

  const tbody = $('#tune-table tbody');
  tbody.innerHTML = '';
  const holdTr = document.createElement('tr');
  holdTr.innerHTML =
    `<td class="muted">hold</td><td class="muted">—</td>` +
    `<td>${fmtPct(r.hold.valueGrowthPct)}</td><td class="muted">baseline</td>` +
    recHoldCell('half') + recHoldCell('quarter') +
    `<td>${r.hold.maxValueDrawdownPct.toFixed(1)}%</td><td class="muted">0</td><td class="muted">—</td><td></td>`;
  tbody.appendChild(holdTr);
  for (const row of r.grid) {
    const tr = document.createElement('tr');
    const isReco = r.recommendation && row.x === r.recommendation.x;
    if (isReco) tr.classList.add('reco-row');
    tr.innerHTML =
      `<td>${row.x}%${isReco ? ' ★' : ''}${!hypothetical && row.x === r.currentX ? ' <span class="muted">(current)</span>' : ''}</td>` +
      `<td>${fmtPct(row.netBasketGrowthPct)}</td>` +
      `<td>${fmtPct(row.valueGrowthPct)}</td>` +
      `<td>${fmtPct(row.valueGrowthPct - r.hold.valueGrowthPct)}</td>` +
      recCell('half', row.x) + recCell('quarter', row.x) +
      `<td>${row.maxValueDrawdownPct.toFixed(1)}%</td>` +
      `<td>${row.tradeCount}</td>` +
      `<td>${row.feesPct.toFixed(2)}%</td>`;
    const td = document.createElement('td');
    if (!hypothetical) {
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
    }
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  // History length stated plainly (bars + span in years + dates), the recent
  // window boundaries, and a loud marker when this sweep is a HYPOTHETICAL
  // composition-lab mix rather than the profile's applied targets.
  const spanYears = s.bars ? (s.granularity === 'hourly' ? s.bars / 24 / 365 : s.bars / 365) : 0;
  const d10 = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : '?');
  $('#tune-stamp').textContent =
    (hypothetical
      ? `⚠ HYPOTHETICAL mix (from the composition lab — NOT this profile's applied targets; Apply disabled): ${(s.targets || s.assets || []).join(' · ')} · `
      : '') +
    `Swept ${fmtUtc(latest.createdAt)} · ${s.assets ? s.assets.map((x) => x.toUpperCase()).join('/') : ''} · ` +
    `history: ${s.bars} ${s.granularity === 'hourly' ? 'hourly' : 'daily'} bars ≈ ${spanYears.toFixed(1)} years (${d10(s.dataFrom)} → ${d10(s.dataTo)})` +
    (recent.half ? ` · ½ recent = ${recent.half.bars} bars from ${d10(recent.half.from)}` : '') +
    (recent.quarter ? ` · ¼ recent = ${recent.quarter.bars} bars from ${d10(recent.quarter.from)}` : '') +
    ` · fee ${s.feePct}%/leg + spread ${s.spreadPct}% · execution lag ${s.lagHours}h` +
    (s.idealTether ? ' · ⚠ ASSUMPTION: tether idealized to a perfect $1 peg.' : '') +
    (hypothetical ? '' : ' · Apply refuses if targets or costs have changed since.');
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
  compose: { run: '#c-run', status: '#c-status', bar: '#c-bar', fill: '#c-bar-fill', cancel: '#c-cancel', pause: '#c-pause' },
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
    status.textContent = (entry.paused ? '⏸ paused — ' : '') + (entry.progress || 'running…');
    if (w.bar) {
      $(w.bar).classList.remove('hidden');
      $(w.fill).style.width = (entry.progressPct != null ? entry.progressPct : 0) + '%';
    }
    if (w.cancel) $(w.cancel).classList.remove('hidden');
    if (w.pause) {
      const pb = $(w.pause);
      pb.classList.remove('hidden');
      pb.textContent = entry.paused ? '▶ Resume' : '⏸ Pause';
    }
  } else {
    runBtn.disabled = false;
    status.textContent = jobMsg[kind][state.selectedId] || '';
    if (w.bar) $(w.bar).classList.add('hidden');
    if (w.cancel) $(w.cancel).classList.add('hidden');
    if (w.pause) $(w.pause).classList.add('hidden');
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
        entry.paused = Boolean(job.paused);
        if (profileId === state.selectedId) renderJobControls(kind);
      } else {
        clearInterval(entry.interval);
        delete runningJobs[kind][profileId];
        jobMsg[kind][profileId] =
          job.status === 'done' ? '' : job.status === 'cancelled' ? 'cancelled — no result saved' : `failed: ${job.error}`;
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

// A reload used to orphan running searches: the job keeps running (and its
// result still persists) server-side, but the page forgot the job id, so the
// controls sat idle as if nothing was happening. On boot and on every detail
// load, ask the server for running jobs and re-attach the ones this page
// knows how to track — the progress bar comes back as if never interrupted.
const SERVER_JOB_KINDS = { compose: 'compose', 'tune-threshold': 'tune' };
async function resumeActiveJobs() {
  try {
    const { jobs, checkpoints } = await api('/jobs');
    for (const j of jobs) {
      const kind = SERVER_JOB_KINDS[j.kind];
      if (!kind || j.profileId == null) continue;
      const existing = runningJobs[kind][j.profileId];
      if (existing && existing.jobId === j.id) continue; // already attached
      trackJob(kind, j.id, j.profileId);
      // Seed the listing's live progress so the bar doesn't flash "starting…".
      const e = runningJobs[kind][j.profileId];
      if (e) {
        e.progress = j.progress || 'running…';
        e.progressPct = j.progressPct;
        e.paused = Boolean(j.paused);
        if (j.profileId === state.selectedId) renderJobControls(kind);
      }
    }
    // Checkpointed searches: paused runs that survived a restart/deploy.
    // Park a pseudo-entry so the widget shows ⏸ paused with ▶ Resume /
    // Cancel — resuming spawns a fresh job that continues from the frozen
    // state and provably reproduces the uninterrupted result.
    for (const c of checkpoints || []) {
      const kind = SERVER_JOB_KINDS[c.kind];
      if (!kind || c.profileId == null) continue;
      if (runningJobs[kind][c.profileId]) continue; // a live job owns the slot
      runningJobs[kind][c.profileId] = {
        checkpointId: c.id,
        paused: true,
        progress: `${c.progress || 'checkpointed'} — survived restart, Resume to continue`,
        progressPct: c.progressPct,
        interval: null,
      };
      if (c.profileId === state.selectedId) renderJobControls(kind);
    }
  } catch {
    /* transient — the next boot/detail load retries */
  }
}

$('#tune-run').addEventListener('click', async () => {
  const profileId = state.selectedId;
  $('#tune-run').disabled = true;
  $('#tune-status').textContent = 'starting…';
  try {
    const { jobId } = await api(`/profiles/${profileId}/tune-threshold`, {
      method: 'POST',
      body: { granularity: $('#tune-gran').value, lag_hours: Number($('#tune-lag').value), idealTether: $('#tune-ideal').checked },
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
  // Warnings (e.g. no mix beat holding out-of-sample) lead; the standing
  // hindsight caveat follows.
  $('#c-caveat').textContent = [...(r.warnings || []), r.caveat].filter(Boolean).join('  ·  ');

  const sp = (n, d = 1) => (n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(d) + '%');
  const regimeMode = r.mode === 'regime';
  const holdCellOf = (h) =>
    (h && h.value != null ? sp(h.value) : '—') + (h && h.edge != null ? ` <span class="muted">(edge ${sp(h.edge)})</span>` : '');

  // Header depends on mode: regime shows per-market-type edges; folds shows
  // the walk-forward columns.
  // The evaluated time periods, stated up top — not just fine print below.
  {
    const w0 = r.window || {};
    const d10c = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : '?');
    const yearsC = w0.bars ? w0.bars / 365 : 0;
    $('#c-window').textContent =
      `Period: ${d10c(w0.from)} → ${d10c(w0.to)} · ${w0.bars || '?'} daily bars ≈ ${yearsC.toFixed(1)} years` +
      ` · in-sample ${w0.inSampleBars || '?'} bars · holdout ${w0.holdoutBars || '?'} bars from ${d10c(w0.holdoutFrom)}` +
      (regimeMode && r.regime ? ` · regimes: ${r.regime.byType.bull}d bull / ${r.regime.byType.bear}d bear / ${r.regime.byType.range}d range` : '') +
      (r.idealTether ? ' · ⚠ tether idealized $1' : '');
  }

  const qualTh =
    '<th title="Whole-window return @ the trigger sensitivity that produced it (@ hold = holding won, no full-window trigger) · max drawdown · whether it keeps up with the market (holding BTC in the index currency). ✓mkt = real possibility; ▼mkt = lags the market">Return @ X · DD · vs mkt</th>';
  const thead = $('#c-table thead');
  thead.innerHTML = regimeMode
    ? '<tr><th title="The proposed allocation: each asset with its target %. ⚓ marks the tethered index. ★ = recommended (harvests in every present market type AND keeps up with the market, with a positive holdout)">Mix (targets) · ★ = recommended</th>' +
      '<th title="Market types (bull/bear/range) the mix harvested in, out of those present">Types ✓</th>' +
      '<th title="Median harvest edge over holding across BULL swaths">Bull</th>' +
      '<th title="Median harvest edge over holding across BEAR swaths">Bear</th>' +
      '<th title="Median harvest edge over holding across RANGE swaths">Range</th>' +
      '<th title="Worst market type — the consistency score the ranking uses">Worst</th>' +
      '<th title="Equal-weighted mean edge across market types">Avg</th>' +
      '<th title="Untouched confirmation tail: value and (edge over holding)">Holdout</th>' +
      qualTh + '<th title="⇢ tuner: send this mix to the sensitivity tuner for a full X-grid sweep (hypothetical — nothing applies)"></th></tr>'
    : '<tr><th title="The proposed allocation: each asset with its target %. ⚓ marks the tethered index. ★ = recommended (harvests in most walk-forward windows AND keeps up with the market, with a positive holdout)">Mix (targets) · ★ = recommended</th><th title="Walk-forward windows harvested, out of N sequential in-sample folds — how CONSISTENTLY this mix beat holding across time">Folds ✓</th>' +
      '<th title="Median harvest edge across the folds">Median edge</th><th title="Untouched confirmation tail: value and (edge)">Holdout</th>' +
      '<th title="Best sensitivity on the holdout">X</th>' + qualTh + '<th title="⇢ tuner: send this mix to the sensitivity tuner for a full X-grid sweep (hypothetical — nothing applies)"></th></tr>';

  const tbody = $('#c-table tbody');
  tbody.innerHTML = '';
  const pt = (row, t) => (row.perType && row.perType[t] != null ? sp(row.perType[t]) : '<span class="muted">—</span>');
  // Current-set mode: each split carries its full sensitivity sweep over the
  // window (value + edge per X). Render it inline under the mix so the
  // allocation × sensitivity interaction is visible; best X starred.
  const xSweep = (row) => {
    if (!r.currentSet || !row.xGrid) return '';
    const bestX = row.full ? row.full.x : null;
    const cells = row.xGrid
      .map((g) => {
        const best = g.x === bestX;
        return (
          `<span class="xg${best ? ' xg-best' : ''}" title="sensitivity ${g.x}%: value ${sp(g.value)}, edge ${sp(g.edge)} over holding, ${g.trades} trades, max DD ${g.dd.toFixed(0)}%">` +
          `${g.x}%&nbsp;<span class="${g.edge >= 0 ? 'pos' : 'neg'}">${sp(g.edge)}</span>${best ? ' ★' : ''}</span>`
        );
      })
      .join('');
    return `<div class="xsweep">split × sensitivity: ${cells}</div>`;
  };
  // Return · drawdown · market-keep — the "real possibility" cell. netReturn is
  // the whole-window value at the mix's best X; maxDD its drawdown; the marker
  // says whether it keeps up with holding BTC (in the index currency).
  const qualCell = (row) => {
    const ret = row.netReturn != null ? sp(row.netReturn) : row.full ? sp(row.full.value) : '—';
    const dd = row.maxDD != null ? row.maxDD.toFixed(0) : row.full ? row.full.dd.toFixed(0) : '—';
    // The sensitivity behind that whole-window return: a real X when some
    // trigger beat holding over the full path, else "hold" (holding won —
    // there is no full-window rebalance trigger; the edge lives per-regime).
    const trig =
      row.full && row.full.x != null
        ? ` <span class="muted" title="the trigger sensitivity that produced this whole-window return">@ ${row.full.x}%</span>`
        : ' <span class="muted" title="no sensitivity beat holding over the full window — the harvest is per-regime / holdout only">@ hold</span>';
    const mk =
      row.beatsMarket == null
        ? ''
        : row.beatsMarket
          ? ' <span class="pos" title="keeps up with the market (hold BTC) — a real possibility">✓mkt</span>'
          : ' <span class="neg" title="lags the market (hold BTC) on return/drawdown">▼mkt</span>';
    return `${ret}${trig} <span class="muted">· DD ${dd}%</span>${mk}`;
  };
  const addRow = (label, row, highlight, weeded) => {
    const tr = document.createElement('tr');
    if (highlight) tr.classList.add('ref-row');
    if (weeded) tr.classList.add('weeded-row');
    const star = row.recommended ? ' ★' : '';
    const h = row.holdout || {};
    // The star (and the final asset spec) never orphan onto their own wrapped
    // line: the last " · asset pct%" chunk plus the ★ form one unbreakable unit.
    const cut = label.lastIndexOf(' · ');
    const labelHtml =
      cut === -1
        ? `<span class="nowrap-tail">${label}${star}</span>`
        : `${label.slice(0, cut)} · <span class="nowrap-tail">${label.slice(cut + 3)}${star}</span>`;
    const labelCell = `<span class="mix-label">${labelHtml}</span>${xSweep(row)}`;
    tr.innerHTML = regimeMode
      ? `<td>${labelCell}</td>` +
        `<td>${row.typesPositive != null ? `${row.typesPositive}/${row.typesPresent}` : '—'}</td>` +
        `<td>${pt(row, 'bull')}</td><td>${pt(row, 'bear')}</td><td>${pt(row, 'range')}</td>` +
        `<td><strong>${row.consistency != null ? sp(row.consistency) : '—'}</strong></td>` +
        `<td>${row.average != null ? sp(row.average) : '—'}</td>` +
        `<td>${holdCellOf(h)}${h.x != null ? ` <span class="muted">@ ${h.x}%</span>` : ''}</td>` +
        `<td>${qualCell(row)}</td>`
      : `<td>${labelCell}</td>` +
        `<td>${row.positiveFolds != null ? `${row.positiveFolds}/${row.nFolds}` : '—'}</td>` +
        `<td>${sp(row.robust)}</td><td><strong>${holdCellOf(h)}</strong></td>` +
        `<td>${h.x != null ? h.x + '%' : 'hold'}</td><td>${qualCell(row)}</td>`;
    // "⇢ tuner" (own trailing cell): sweep THIS mix across the whole X grid in
    // the sensitivity tuner (marked hypothetical there — nothing applies), so
    // the full performance-vs-X curve is inspectable with your own eyes.
    const tunerTd = document.createElement('td');
    tunerTd.className = 'tuner-cell';
    const toTuner = document.createElement('button');
    toTuner.textContent = '⇢ tuner';
    toTuner.className = 'ghost';
    toTuner.title = 'Run the sensitivity tuner on this mix (full X sweep, all/half/quarter windows). Hypothetical — nothing is applied.';
    toTuner.addEventListener('click', async () => {
      const profileId = state.selectedId;
      try {
        const { jobId } = await api(`/profiles/${profileId}/tune-threshold`, {
          method: 'POST',
          body: {
            days: (r.window && r.window.bars) || 1460,
            idealTether: r.idealTether === true,
            mix: row.assets.map((a) => ({ id: a.id, symbol: a.symbol, targetPct: a.pct, isIndex: a.isIndex })),
          },
        });
        trackJob('tune', jobId, profileId);
        const sect = document.getElementById('tune-section');
        if (sect) sect.scrollIntoView({ behavior: 'smooth' });
      } catch (err) {
        alert(err.message);
      }
    });
    tunerTd.appendChild(toTuner);
    tr.appendChild(tunerTd);
    tbody.appendChild(tr);
  };
  if (r.currentMix) addRow(`CURRENT (reference only): ${mixLabel(r.currentMix.assets)}`, r.currentMix, true);
  for (const m of r.mixes) addRow(mixLabel(m.assets), m, false);
  if (!r.mixes.some((m) => m.recommended)) {
    const tr = document.createElement('tr');
    const cols = regimeMode ? 10 : 7;
    const why = r.noRealPossibility
      ? 'no mix kept up with the market (holding BTC in the index currency) on return and drawdown. The rows are best-effort harvesters, not upgrades over holding.'
      : regimeMode
        ? 'no mix both harvested across every market type AND kept up with the market. Rankings reflect robustness, not a proven edge.'
        : 'no mix both cleared the walk-forward + holdout bar AND kept up with the market. Rankings reflect capital preservation, not skill.';
    tr.innerHTML = `<td colspan="${cols}" class="warn-text">★ none — ${why}</td>`;
    tbody.appendChild(tr);
  }

  // The weeded (gate-hidden) rows are viewable on demand: same columns, muted,
  // each already labeled ▼mkt/✓mkt by the quality cell — nothing is erased,
  // the default view just stays honest. Older persisted results predate the
  // field; only the stamp explains those.
  {
    const hidden = r.hiddenMixes || [];
    if (hidden.length) {
      const tr = document.createElement('tr');
      tr.className = 'weeded-toggle';
      const td = document.createElement('td');
      td.colSpan = regimeMode ? 10 : 7;
      const btn = document.createElement('button');
      btn.className = 'ghost';
      const total = r.weededForQuality || hidden.length;
      const showLabel =
        `▽ show the ${total} weeded mix(es)` +
        (hidden.length < total ? ` (best ${hidden.length} kept)` : '') +
        ' — lagged the market (▼mkt) or fell below the finalists fold';
      btn.textContent = showLabel;
      btn.title =
        'Reveal the rows the quality gate keeps off the board. They are ranked with the same quality order — useful for gleaning what ' +
        'almost made it — but the gate verdict stands: ▼mkt rows lag holding BTC on return/drawdown.';
      let open = false;
      btn.addEventListener('click', () => {
        open = !open;
        if (open) {
          for (const m of hidden) addRow(mixLabel(m.assets), m, false, true);
          btn.textContent = '△ hide the weeded mixes';
        } else {
          tbody.querySelectorAll('tr.weeded-row').forEach((x) => x.remove());
          btn.textContent = showLabel;
        }
      });
      td.appendChild(btn);
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }

  // Solo-screen verdicts: which candidates made it into combinatorics. In
  // current-set mode there is no screen (the set is fixed) — show the weight
  // rules instead.
  const sc = $('#c-screen');
  if (r.currentSet) {
    const wr = r.weightRules || {};
    const nAssets = r.currentMix ? r.currentMix.assets.length : (r.mixes[0] ? r.mixes[0].assets.length : 0);
    sc.textContent =
      `Current-holdings mode: your exact ${nAssets} assets, no additions or drops. Each asset ` +
      `${wr.minPct != null ? wr.minPct : 4}–${wr.maxPct != null ? wr.maxPct : 80}% on a ${wr.stepPct != null ? wr.stepPct : 1}% grid, ` +
      `every split scored jointly across the full sensitivity range (see the per-row × sweep).` +
      (r.universe && r.universe.droppedNames && r.universe.droppedNames.length
        ? ` Dropped for missing history: ${r.universe.droppedNames.map((s) => s.toUpperCase()).join(', ')}.`
        : '');
  } else if (r.heldOnly) {
    const dropped = (r.screen || []).filter((s) => !s.kept);
    const decl = dropped.filter((s) => s.ownReturnPct != null);
    const legacy = dropped.filter((s) => s.ownReturnPct == null);
    sc.textContent =
      `Current holdings, drops allowed: searching subsets + weights of your ${r.universe ? r.universe.covered : ''} holdings (no market candidates).` +
      (decl.length
        ? ` Dropped as terminal decliners (lost >75%): ${decl.map((s) => `${s.symbol.toUpperCase()} ${s.ownReturnPct.toFixed(0)}%`).join(', ')}.`
        : '') +
      (legacy.length
        ? ` ⚠ ${legacy.map((s) => s.symbol.toUpperCase()).join(', ')} excluded by the OLD harvest screen — re-run to apply the keep-all rules.`
        : '') +
      ' The subset search drops the rest as it sees fit.';
  } else if (r.screen && r.screen.length) {
    const kept = r.screen.filter((s) => s.kept);
    const dropped = r.screen.filter((s) => !s.kept);
    // Solo harvest edge is INFORMATIONAL (character only) — every candidate
    // goes into the search except terminal decliners. Legacy results (from
    // before the keep-all screen) carry no ownReturnPct on their drops — never
    // claim "terminal decliner" for those; they were cut by the OLD harvest
    // rule and only a re-run applies the current one.
    const legacyDrops = dropped.filter((s) => s.ownReturnPct == null);
    const declinerDrops = dropped.filter((s) => s.ownReturnPct != null);
    sc.textContent =
      `Candidate harvest character (50/50 vs tether, ${regimeMode ? 'worst-market-type' : 'median walk-forward'} edge — informational; all kept except terminal decliners): ` +
      kept.map((s) => `${s.symbol.toUpperCase()} ${s.soloTrain >= 0 ? '+' : ''}${s.soloTrain.toFixed(1)}%`).join(', ') +
      (declinerDrops.length
        ? ` · dropped as terminal decliners (lost >75% over the window): ` +
          declinerDrops.map((s) => `${s.symbol.toUpperCase()} ${s.ownReturnPct.toFixed(0)}%`).join(', ')
        : '') +
      (legacyDrops.length
        ? ` · ⚠ ${legacyDrops.map((s) => s.symbol.toUpperCase()).join(', ')} excluded by the OLD harvest screen — this result predates the keep-all rules; re-run the search to include ${legacyDrops.length > 1 ? 'them' : 'it'}.`
        : '');
  } else {
    sc.textContent = '';
  }

  const w = r.window || {};
  const u = r.universe || {};
  const unit = r.currentSet ? 'splits' : 'combos';
  const combos = r.combos
    ? `${r.combos.broadSampled.toLocaleString()} ${unit} broad-searched, ${r.combos.contenders} contenders full-scored` +
      (r.funnel ? ` (boards ${r.funnel.fullTop}+${r.funnel.retKeep} raw-return · refine ${r.funnel.refineTop}×${r.funnel.refineEvals})` : '')
    : `${r.evaluatedMixes} mixes evaluated`;
  $('#c-stamp').textContent =
    `Searched ${fmtUtc(latest.createdAt)} · ${combos} · ` +
    (r.currentSet
      ? `current holdings only (${u.covered} assets)`
      : `universe ${u.covered}/${u.considered} candidates`) +
    (r.currentSet ? '' : u.venue ? ` (restricted to ${u.venue}-tradable${u.notOnVenue && u.notOnVenue.length ? `; dropped: ${u.notOnVenue.map((s) => s.toUpperCase()).join(', ')}` : ''})` : ' (no linked venue — unconstrained)') +
    (u.excludedByUser && u.excludedByUser.length
      ? ` · excluded by you: ${u.excludedByUser.map((s) => s.toUpperCase()).join(', ')}`
      : '') +
    (u.pinnedByUser && u.pinnedByUser.length
      ? ` · 📌 pinned by you (forced into every mix): ${u.pinnedByUser.map((s) => s.toUpperCase()).join(', ')}`
      : '') +
    (u.heldExcludedFrozen ? ` · ${u.heldExcludedFrozen} held asset(s) excluded: buy-frozen` : '') +
    (!r.currentSet && u.droppedNames && u.droppedNames.length
      ? ` · ${u.droppedNames.length} dropped for insufficient history: ${u.droppedNames.map((s) => s.toUpperCase()).join(', ')}`
      : '') +
    (u.windowDays && u.requestedDays && u.windowDays < u.requestedDays
      ? ` · window auto-shrunk ${u.requestedDays}d → ${u.windowDays}d for coverage${
          u.windowLimitedBy && u.windowLimitedBy.length ? ` (limited by ${u.windowLimitedBy.map((s) => s.toUpperCase()).join(', ')})` : ''
        }`
      : '') +
    ` · window ${w.from ? new Date(w.from).toISOString().slice(0, 10) : '?'} → ${w.to ? new Date(w.to).toISOString().slice(0, 10) : '?'}` +
    (regimeMode && r.regime
      ? ` · REGIME mode: ${r.regime.byType.bull}d bull / ${r.regime.byType.bear}d bear / ${r.regime.byType.range}d range`
      : ` · ${w.nFolds || '?'} walk-forward folds`) +
    ` + untouched holdout from ${w.holdoutFrom ? new Date(w.holdoutFrom).toISOString().slice(0, 10) : '?'} (${w.holdoutBars} bars).` +
    (r.idealTether ? ' · ⚠ ASSUMPTION: tether idealized to a perfect $1 peg (real wobble/depegs erased).' : '') +
    (r.market ? ` · market (hold BTC): ${sp(r.market.return)} / DD ${r.market.maxDD.toFixed(0)}% — the bar a "real possibility" must keep up with.` : '') +
    (r.weededForQuality
      ? r.hiddenMixes && r.hiddenMixes.length
        ? ` · ${r.weededForQuality} mix(es) weeded (lagged the market or fell below the fold) — viewable via "show" at the bottom of the table.`
        : ` · ${r.weededForQuality} mix(es) hidden: lagged the market. Re-run the search to make them viewable.`
      : '');
}

$('#c-run').addEventListener('click', async () => {
  const profileId = state.selectedId;
  $('#c-run').disabled = true;
  $('#c-status').textContent = 'starting…';
  try {
    const scope = $('#c-scope').value;
    const { jobId } = await api(`/profiles/${profileId}/compose`, {
      method: 'POST',
      body: {
        samples: Number($('#c-intensity').value),
        currentSet: scope === 'reweight',
        heldOnly: scope === 'drops',
        idealTether: $('#c-ideal').checked,
      },
    });
    trackJob('compose', jobId, profileId);
  } catch (err) {
    jobMsg.compose[profileId] = err.message;
    if (profileId === state.selectedId) renderJobControls('compose');
  }
});

// Service-wide CPU cap: one header button, stored server-side, applies LIVE
// to every heavy loop (running searches included, within seconds). Click
// cycles down through the steps and wraps back to 100%.
const CPU_STEPS = [100, 90, 75, 50, 25, 10, 0]; // 0 = OFF: heavy work parks in place
function paintCpuBtn(pct) {
  const btn = $('#cpu-btn');
  btn.dataset.pct = String(pct);
  btn.textContent = pct <= 0 ? 'CPU OFF' : `CPU ${pct}%`;
  btn.classList.toggle('warn', pct <= 0);
}
$('#cpu-btn').addEventListener('click', async () => {
  const cur = Number($('#cpu-btn').dataset.pct ?? 90);
  const idx = CPU_STEPS.indexOf(cur);
  const next = CPU_STEPS[(idx + 1) % CPU_STEPS.length];
  try {
    const r = await api('/settings/cpu', { method: 'POST', body: { pct: next } });
    paintCpuBtn(r.pct);
  } catch (err) {
    alert(`CPU setting failed: ${err.message}`);
  }
});

// Pause/resume the running comp lab search for the profile ON SCREEN: the
// search parks at its next yield point (sub-second) and holds its place.
$('#c-pause').addEventListener('click', async () => {
  const entry = runningJobs.compose[state.selectedId];
  if (!entry) return;
  $('#c-pause').disabled = true;
  try {
    if (entry.checkpointId) {
      // A checkpointed search (survived a restart): Resume spawns a fresh
      // job continuing from the frozen state — same result, guaranteed.
      const { jobId } = await api(`/checkpoints/${entry.checkpointId}/resume`, { method: 'POST', body: {} });
      delete runningJobs.compose[state.selectedId];
      trackJob('compose', jobId, state.selectedId);
      return;
    }
    const r = await api(`/jobs/${entry.jobId}/pause`, { method: 'POST', body: { paused: !entry.paused } });
    entry.paused = Boolean(r.paused);
    renderJobControls('compose');
  } catch (err) {
    jobMsg.compose[state.selectedId] = `pause failed: ${err.message}`;
    renderJobControls('compose');
  } finally {
    $('#c-pause').disabled = false;
  }
});

// Cancel the running comp lab search for the profile ON SCREEN. The job
// aborts at its next progress report; the poll loop then shows "cancelled".
$('#c-cancel').addEventListener('click', async () => {
  const entry = runningJobs.compose[state.selectedId];
  if (!entry) return;
  $('#c-cancel').disabled = true;
  try {
    if (entry.checkpointId) {
      // Discard a checkpointed (restart-surviving) paused search.
      await api(`/checkpoints/${entry.checkpointId}`, { method: 'DELETE' });
      delete runningJobs.compose[state.selectedId];
      jobMsg.compose[state.selectedId] = 'paused search discarded';
      renderJobControls('compose');
      return;
    }
    await api(`/jobs/${entry.jobId}/cancel`, { method: 'POST', body: {} });
    entry.progress = 'cancelling…';
    renderJobControls('compose');
  } catch (err) {
    jobMsg.compose[state.selectedId] = `cancel failed: ${err.message}`;
  } finally {
    $('#c-cancel').disabled = false;
  }
});

// ---- composition-lab candidate pool (per-profile exclusions) ----
//
// "Candidate pool…" toggles a checklist of everything the lab would consider
// (held assets + venue-tradable market candidates). Unchecking an asset saves
// it to the profile's exclusion list, weeded before ANY search scope runs.
$('#c-pool-btn').addEventListener('click', async () => {
  const wrap = $('#c-pool-wrap');
  if (!wrap.classList.contains('hidden')) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  const box = $('#c-pool');
  const status = $('#c-pool-status');
  box.innerHTML = '<span class="muted">Loading candidate pool…</span>';
  status.textContent = '';
  try {
    const r = await api(`/profiles/${state.selectedId}/compose-candidates`);
    box.innerHTML = '';
    const excludedNow = new Set(r.pool.filter((c) => c.excluded).map((c) => c.id));
    const pinnedNow = new Set(r.pool.filter((c) => c.pinned).map((c) => c.id));
    const save = async () => {
      status.textContent = 'saving…';
      try {
        await api(`/profiles/${state.selectedId}`, {
          method: 'PATCH',
          body: { compose_excluded: [...excludedNow], compose_pinned: [...pinnedNow] },
        });
        status.textContent =
          (excludedNow.size ? `${excludedNow.size} asset(s) excluded from all lab scopes.` : 'No exclusions — the full pool is searchable.') +
          (pinnedNow.size ? ` 📌 ${pinnedNow.size} pinned — every searched mix must contain ${pinnedNow.size > 1 ? 'them all' : 'it'}.` : '');
      } catch (err) {
        status.textContent = `save failed: ${err.message}`;
      }
    };
    if (r.tether) {
      const lock = document.createElement('label');
      lock.title = 'The tethered index cannot be excluded — every mix is denominated in it.';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.disabled = true;
      lock.append(cb, document.createTextNode(` ${r.tether.symbol.toUpperCase()} ⚓`));
      box.appendChild(lock);
    }
    for (const c of r.pool) {
      const label = document.createElement('label');
      label.title = c.held
        ? 'Held in this profile — always enters the search'
        : c.inCut === false
          ? `Market candidate (rank ${c.rank || '?'}) — currently OUTSIDE the top-40 search cut; ranks drift, so it may enter a future run. Unchecking excludes it permanently either way.`
          : `Market candidate (rank ${c.rank || '?'}) — inside the current top-40 search cut`;
      if (c.inCut === false) label.classList.add('out-of-cut');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !c.excluded;
      // 📌 pin: force this asset into EVERY searched mix. A pin overrides an
      // exclusion, and excluding a pinned asset unpins it — the click order
      // decides, and both controls stay visually consistent either way.
      const pin = document.createElement('span');
      pin.className = 'pin' + (pinnedNow.has(c.id) ? ' on' : '');
      pin.textContent = '📌';
      pin.title = 'Pin: force this asset into every searched mix (overrides an exclusion). Click to toggle; saves immediately.';
      pin.addEventListener('click', (ev) => {
        ev.preventDefault(); // keep the label from also toggling the checkbox
        if (pinnedNow.has(c.id)) pinnedNow.delete(c.id);
        else {
          pinnedNow.add(c.id);
          excludedNow.delete(c.id);
          cb.checked = true;
        }
        pin.classList.toggle('on', pinnedNow.has(c.id));
        save();
      });
      cb.addEventListener('change', () => {
        if (cb.checked) excludedNow.delete(c.id);
        else {
          excludedNow.add(c.id);
          if (pinnedNow.has(c.id)) {
            pinnedNow.delete(c.id);
            pin.classList.remove('on');
          }
        }
        save();
      });
      label.append(cb, pin, document.createTextNode(`${c.symbol.toUpperCase()}${c.held ? ' •' : ''}`));
      box.appendChild(label);
    }
    status.textContent =
      (r.marketsUnavailable
        ? '⚠ Market candidates unavailable right now (data queue busy — likely a running search); showing held assets only. Reopen later for the full pool. '
        : '') +
      (excludedNow.size
        ? `${excludedNow.size} asset(s) currently excluded. `
        : 'Nothing excluded. Uncheck to exclude; saves immediately. ') +
      (pinnedNow.size ? `📌 ${pinnedNow.size} pinned. ` : '') +
      '• = held · 📌 = pinned into every mix.';
  } catch (err) {
    box.innerHTML = `<span class="error">Pool load failed: ${err.message}</span>`;
  }
});

// ---- exchange sync ----

function renderExchange(x, pendingFlows, profile) {
  // Reset the group-view collapses; loadSubaccounts re-applies them when
  // this profile turns out to be a grouped sub-account.
  $('#x-pointer').classList.add('hidden');
  $('#flow-section').classList.remove('group-collapsed');
  $('#x-none').classList.toggle('hidden', Boolean(x));
  $('#x-linked').classList.toggle('hidden', !x);
  if (!x) return;

  const last = x.last_sync_at ? fmtUtc(x.last_sync_at) : 'never';
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
    when.textContent = fmtUtc(f.ts);
    const kind = document.createElement('td');
    kind.textContent = f.kind;
    const amt = document.createElement('td');
    amt.textContent = `${f.amount >= 0 ? '+' : ''}${f.amount} ${f.code.toUpperCase()}`;
    amt.className = f.amount >= 0 ? 'pos' : 'neg';
    // Multi-profile accounts: the flow may be redirected to any linked
    // profile at confirm time; the cell is populated once sub-account data
    // loads (single-profile accounts just show a dash).
    const target = document.createElement('td');
    target.className = 'flow-target';
    target.dataset.suggested = f.profile_id;
    target.textContent = '—';
    const actions = document.createElement('td');
    const ok = document.createElement('button');
    ok.textContent = 'Confirm';
    ok.addEventListener('click', async () => {
      try {
        const sel = target.querySelector('select');
        await api(`/pending-flows/${f.id}/confirm`, {
          method: 'POST',
          body: sel ? { profileId: Number(sel.value) } : {},
        });
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
    tr.append(when, kind, amt, target, actions);
    tbody.appendChild(tr);
  }

  // Phase 6 sub-accounts panel (loads its own data; failures stay local).
  loadSubaccounts(x).catch((err) => {
    $('#sub-status').textContent = `sub-accounts unavailable: ${err.message}`;
  });
}

// ---- view mode: one flowing page OR tabbed sections -------------------------
// The detail pane's blocks are assigned to tabs at runtime by walking the
// landmarks (no HTML restructuring, so nothing else can break). Preference
// persists per browser; "Tabs"/"Flow" toggles in the header.
const TAB_DEFS = [
  { key: 'profile', label: 'Profile & Assets' },
  { key: 'tuner', label: 'Sensitivity tuner' },
  { key: 'lab', label: 'Composition lab' },
  { key: 'money', label: 'Deposits & Exchange' },
  { key: 'notify', label: 'Notifications' },
  { key: 'history', label: 'History' },
];
let viewMode = localStorage.getItem('sab-view') || 'flow';
let activeTab = localStorage.getItem('sab-tab') || 'profile';

function assignTabs() {
  let current = 'profile';
  for (const el of $('#detail').children) {
    if (el.id === 'tab-bar') continue;
    // Blocks that belong with Assets despite sitting later in the DOM.
    if (el.id === 'asset-form' || el.id === 'fiat-form' || el.id === 'import-section') {
      el.dataset.tab = 'profile';
      continue;
    }
    if (el.id === 'tune-section') current = 'tuner';
    else if (el.id === 'compose-section') current = 'lab';
    else if (el.id === 'flow-section') current = 'money';
    else if (el.id === 'exchange-section') current = 'money';
    else if (el.tagName === 'H3' && /^Notifications/.test(el.textContent)) current = 'notify';
    else if (el.tagName === 'H3' && /^(Value|Alert) history/.test(el.textContent)) current = 'history';
    el.dataset.tab = current;
  }
}

// The shell ("Master") entry is the ACCOUNT view, not a strategy: it keeps
// the assets pool, deposits/withdrawals, and the exchange + sub-accounts
// machinery, and hides everything strategy-shaped (sensitivity settings,
// tuner, composition lab, notifications, histories, screenshot import,
// add-asset forms, the basket/value summary, and the strategy action
// buttons). Server-side, deleting a shell with linked siblings is refused.
function isShellSelected() {
  const p = state.profiles.find((pp) => pp.id === state.selectedId);
  return Boolean(p && p.is_shell);
}

function applyShellView(shell) {
  assignTabs();
  const denyIds = new Set(['import-section', 'asset-form', 'fiat-form']);
  for (const el of $('#detail').children) {
    if (el.id === 'tab-bar') continue;
    let off = false;
    if (shell) {
      const tab = el.dataset.tab;
      if (tab === 'tuner' || tab === 'lab' || tab === 'notify' || tab === 'history') off = true;
      if (denyIds.has(el.id) || el.classList.contains('settings-row')) off = true;
    }
    el.classList.toggle('shell-off', off);
  }
  // Poll now STAYS on the shell — it refreshes the pool's valuation.
  for (const bid of ['#d-status', '#d-targets', '#d-delete']) {
    $(bid).classList.toggle('hidden', shell);
  }
}

// A grouped SUB-profile: linked to an account whose shell exists. Its
// account sections are factored out entirely (they live on the master).
function groupShellFor(profile) {
  if (!profile || profile.is_shell || !profile.exchange_account_id) return null;
  return state.profiles.find((p) => p.is_shell && p.exchange_account_id === profile.exchange_account_id) || null;
}

function applyView() {
  assignTabs();
  const tabs = viewMode === 'tabs';
  $('#view-toggle').textContent = tabs ? 'Flow' : 'Tabs';
  $('#view-toggle').title = tabs
    ? 'Back to one flowing page'
    : 'Split the sections into clickable tabs (remembered per browser)';
  const bar = $('#tab-bar');
  bar.classList.toggle('hidden', !tabs);
  if (tabs && !bar.children.length) {
    for (const t of TAB_DEFS) {
      const b = document.createElement('button');
      b.textContent = t.label;
      b.dataset.key = t.key;
      b.addEventListener('click', () => {
        activeTab = t.key;
        localStorage.setItem('sab-tab', t.key);
        applyView();
      });
      bar.appendChild(b);
    }
  }
  // Tab sets per profile kind: the shell has only pool + account tabs; a
  // grouped sub-profile has everything EXCEPT the account tab (that
  // machinery lives on its master); ungrouped profiles have all six.
  const selected = state.profiles.find((p) => p.id === state.selectedId);
  const shell = Boolean(selected && selected.is_shell);
  const grouped = Boolean(groupShellFor(selected));
  const allowed = shell ? ['profile', 'money'] : grouped ? TAB_DEFS.map((t) => t.key).filter((k) => k !== 'money') : TAB_DEFS.map((t) => t.key);
  if (!allowed.includes(activeTab)) activeTab = allowed[0];
  for (const b of bar.children) {
    b.classList.toggle('hidden', !allowed.includes(b.dataset.key));
    b.classList.toggle('active', b.dataset.key === activeTab);
  }
  for (const el of $('#detail').children) {
    if (el.id === 'tab-bar') continue;
    el.classList.toggle('tab-off', tabs && el.dataset.tab !== activeTab);
  }
}

$('#view-toggle').addEventListener('click', () => {
  viewMode = viewMode === 'tabs' ? 'flow' : 'tabs';
  localStorage.setItem('sab-view', viewMode);
  applyView();
});

// ---- Phase 6: sub-accounts UI -----------------------------------------------
let subState = { accountId: null, profiles: [] };

function profileOptions(select, profiles, preselectId) {
  select.innerHTML = '';
  for (const p of profiles) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.isShell ? `${p.name} (shell)` : p.name;
    if (p.id === preselectId) o.selected = true;
    select.appendChild(o);
  }
}

async function loadSubaccounts(x) {
  $('#sub-status').textContent = 'loading…';
  const data = await api(`/accounts/${x.id}/subaccounts?viewProfileId=${state.selectedId}`);
  $('#sub-status').textContent = '';
  subState = { accountId: x.id, profiles: data.profiles };
  const multi = data.profiles.length > 1;

  // Factored-out account controls: on a SUB-profile of a group, the whole
  // exchange panel collapses to a pointer at the group's master (shell)
  // entry — the 1:n machinery lives in exactly one place.
  const viewing = data.profiles.find((p) => p.id === state.selectedId);
  const shellProfile = data.profiles.find((p) => p.isShell);
  const collapse = multi && viewing && !viewing.isShell && shellProfile;
  $('#x-pointer').classList.toggle('hidden', !collapse);
  $('#x-linked').classList.toggle('hidden', Boolean(collapse));
  $('#flow-section').classList.toggle('group-collapsed', Boolean(collapse));
  $('#flow-pointer').classList.toggle('hidden', !collapse);

  // On the SHELL, deposit/withdraw offers every asset the account knows
  // (union across linked profiles, deduped) — an empty pool must be able to
  // receive its first deposit; the asset row is created server-side.
  if (viewing && viewing.isShell) {
    const union = new Map();
    for (const p of data.profiles) {
      for (const a of p.assets) if (!union.has(a.coingecko_id)) union.set(a.coingecko_id, a);
    }
    const box = $('#flow-rows');
    box.innerHTML = '';
    for (const a of [...union.values()].sort((q, w) => q.symbol.localeCompare(w.symbol))) {
      const row = document.createElement('label');
      row.className = 'flow-row';
      const name = document.createElement('span');
      name.textContent = a.symbol.toUpperCase();
      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.placeholder = '+deposit / -withdraw';
      input.dataset.cg = a.coingecko_id;
      input.dataset.symbol = a.symbol;
      input.className = 'flow-input';
      row.append(name, input);
      box.appendChild(row);
    }
  }
  if (collapse) {
    const btn = $('#x-open-shell');
    btn.textContent = `Open 🪣 ${shellProfile.name}`;
    btn.onclick = async () => {
      state.selectedId = shellProfile.id;
      renderProfiles();
      await loadDetail();
      renderDetail();
    };
    $('#sub-off').classList.add('hidden');
    $('#sub-on').classList.add('hidden');
    return;
  }

  $('#sub-off').classList.toggle('hidden', multi);
  $('#sub-on').classList.toggle('hidden', !multi);

  // Profiles eligible for linking: not linked to any account, not this one.
  const unlinked = state.profiles.filter(
    (p) => !p.exchange_account_id && !data.profiles.some((lp) => lp.id === p.id)
  );
  for (const selId of ['#sub-link-profile', '#sub-link-profile2']) {
    const sel = $(selId);
    sel.innerHTML = '';
    for (const p of unlinked) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      sel.appendChild(o);
    }
  }
  $('#sub-link').disabled = unlinked.length === 0;
  $('#sub-link2').disabled = unlinked.length === 0;
  if (!multi) return;

  // Combined header: the panel renders immediately; the priced totals come
  // from a SEPARATE request so a slow price round can't stall the page.
  $('#sub-summary').classList.remove('hidden');
  $('#sub-total').textContent = 'Account total: pricing…';
  $('#sub-asset-totals').textContent = '';
  const summaryProfileId = state.selectedId;
  api(`/accounts/${x.id}/subaccounts?viewProfileId=${summaryProfileId}&summary=1`)
    .then((d2) => {
      const s = d2.summary;
      const fmt = (v) => v.toLocaleString(undefined, { maximumFractionDigits: v >= 100 ? 0 : 2 });
      if (s) {
        const totalLine =
          `Account total: ${s.totalValue != null ? `${s.complete ? '' : '≥ '}${fmt(s.totalValue)} ${s.indexSymbol}` : 'unpriced'}` +
          (s.complete ? '' : ' (some assets unpriced this round)');
        const balancesLine =
          'Combined balances: ' +
          s.assets
            .map((a) => `${a.symbol.toUpperCase()} ${+a.qty.toFixed(8)}${a.value != null ? ` ≈ ${fmt(a.value)} ${s.indexSymbol}` : ''}`)
            .join(' · ');
        $('#sub-total').textContent = totalLine;
        $('#sub-asset-totals').textContent = balancesLine;
        // The shell's Profile & Assets header IS the account status.
        if (summaryProfileId === state.selectedId && isShellSelected()) {
          const split = (s.perProfile || [])
            .map((p) => `${p.isShell ? '🪣 ' : ''}${p.name}: ${p.value != null ? `${fmt(p.value)} ${s.indexSymbol}` : '—'}`)
            .join(' · ');
          const strongTotal =
            s.totalValue != null
              ? `<strong>${s.complete ? '' : '≥ '}${fmt(s.totalValue)} ${s.indexSymbol}</strong>` +
                (s.complete ? '' : ' <span class="muted">(some assets unpriced this round)</span>')
              : '<span class="muted">unpriced this round</span>';
          $('#d-summary').innerHTML =
            `<div class="perf-line">Account total: ${strongTotal}</div>` +
            (split ? `<div class="muted">${split}</div>` : '') +
            `<div class="muted">${balancesLine}</div>`;
        }
      } else {
        $('#sub-total').textContent = `Account total unavailable: ${d2.summaryError || 'no summary'}`;
        if (summaryProfileId === state.selectedId && isShellSelected()) {
          $('#d-summary').innerHTML = `<div class="perf-line">Account status: <span class="muted">${d2.summaryError || 'unavailable'}</span></div>`;
        }
      }
    })
    .catch((err) => {
      $('#sub-total').textContent = `Account total unavailable: ${err.message}`;
    });

  // Linked profiles summary line.
  $('#sub-profiles').innerHTML = data.profiles
    .map((p) => {
      const held = p.assets.filter((a) => a.quantity > 0);
      const sum = held.map((a) => `${a.symbol.toUpperCase()} ${+a.quantity.toFixed(6)}`).join(', ') || 'empty';
      return `<strong>${p.name}</strong>${p.isShell ? ' 🪣' : ''}: ${sum}`;
    })
    .join(' &nbsp;·&nbsp; ');

  // Per-code reconcile view from the last sync.
  const rb = $('#sub-recon tbody');
  rb.innerHTML = '';
  $('#sub-recon-wrap').classList.toggle('hidden', !data.perCode);
  for (const c of data.perCode || []) {
    const tr = document.createElement('tr');
    const bad = Math.abs(c.residual) > Math.max(1e-8, 5e-4 * Math.abs(c.physical));
    tr.innerHTML =
      `<td>${c.code.toUpperCase()}</td><td class="num">${c.physical}</td><td class="num">${+c.virtual.toFixed(8)}</td>` +
      `<td class="num">${+(c.pending || 0).toFixed(8)}</td><td class="num">${+(c.queued || 0).toFixed(8)}</td>` +
      `<td class="num${bad ? ' neg' : ''}">${+c.residual.toFixed(8)}${bad ? ' ⚠' : ''}</td>`;
    rb.appendChild(tr);
  }

  // Pending-flow target selects (populated now that profiles are known).
  document.querySelectorAll('#x-pending-table .flow-target').forEach((td) => {
    if (td.querySelector('select')) return;
    const sel = document.createElement('select');
    profileOptions(sel, data.profiles, Number(td.dataset.suggested));
    td.textContent = '';
    td.appendChild(sel);
  });

  // Attribution inbox.
  const inbox = data.inbox.trades || [];
  $('#sub-inbox-wrap').classList.toggle('hidden', inbox.length === 0);
  const ib = $('#sub-inbox tbody');
  ib.innerHTML = '';
  for (const q of inbox) {
    const tr = document.createElement('tr');
    const fill = `${(q.side || 'trade').toUpperCase()} ${q.pair || ''} ` + q.deltas.map((d) => `${d.delta > 0 ? '+' : ''}${d.delta} ${d.code.toUpperCase()}`).join(' / ');
    tr.innerHTML = `<td>${fmtUtc(q.ts)}</td><td>${fill}</td><td class="muted">${q.reason || ''}</td>`;
    const selTd = document.createElement('td');
    const sel = document.createElement('select');
    profileOptions(sel, data.profiles, q.suggested_profile_id);
    selTd.appendChild(sel);
    const act = document.createElement('td');
    const assign = document.createElement('button');
    assign.textContent = 'Assign';
    assign.addEventListener('click', async () => {
      try {
        await api(`/attribution/${q.id}/assign`, { method: 'POST', body: { profileId: Number(sel.value) } });
        await refresh();
      } catch (err) { alert(err.message); }
    });
    const dis = document.createElement('button');
    dis.textContent = 'Dismiss';
    dis.className = 'ghost';
    dis.addEventListener('click', async () => {
      if (!confirm('Dismiss this fill? Its quantities will never be applied anywhere.')) return;
      try {
        await api(`/attribution/${q.id}/dismiss`, { method: 'POST', body: {} });
        await refresh();
      } catch (err) { alert(err.message); }
    });
    act.append(assign, dis);
    tr.append(selTd, act);
    ib.appendChild(tr);
  }

  // Carve-out selects + items for the chosen source.
  const from = $('#carve-from');
  const to = $('#carve-to');
  if (!from.dataset.wired || Number(from.dataset.account) !== x.id) {
    // Default source: the first profile that actually holds something (the
    // shell once it has contents; before that, whichever strategy is funded).
    const holding = data.profiles.find((p) => p.assets.some((a) => a.quantity > 0)) || data.profiles[0];
    const dest = data.profiles.find((p) => p.id !== holding.id) || data.profiles[0];
    profileOptions(from, data.profiles, holding.id);
    profileOptions(to, data.profiles, dest.id);
    from.dataset.wired = '1';
    from.dataset.account = x.id;
  }
  const renderCarveItems = () => {
    const src = subState.profiles.find((p) => p.id === Number(from.value));
    const host = $('#carve-items');
    host.innerHTML = '';
    for (const a of (src?.assets || []).filter((a2) => a2.quantity > 0)) {
      const label = document.createElement('label');
      label.className = 'muted';
      label.style.marginRight = '.8rem';
      label.innerHTML = `${a.symbol.toUpperCase()} (have ${+a.quantity.toFixed(8)}) `;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = 'any';
      inp.min = '0';
      inp.max = String(a.quantity);
      inp.style.width = '7rem';
      inp.dataset.assetId = a.id;
      label.appendChild(inp);
      host.appendChild(label);
    }
    if (!host.children.length) host.innerHTML = '<span class="muted">nothing held in the source profile</span>';
  };
  from.onchange = renderCarveItems;
  renderCarveItems();
  restoreDrafts(state.selectedId);

  // Transaction log.
  const lb = $('#sub-log tbody');
  lb.innerHTML = '';
  const nameOf = (id) => (data.profiles.find((p) => p.id === id) || { name: id ?? '—' }).name;
  for (const rrow of data.txnLog) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${fmtUtc(rrow.ts)}</td><td>${nameOf(rrow.profile_id)}</td>` +
      `<td>${rrow.note}${rrow.rewound_by ? ' <span class="muted">(rewound)</span>' : ''}</td>`;
    const act = document.createElement('td');
    if (rrow.kind !== 'rewind' && !rrow.rewound_by) {
      const rw = document.createElement('button');
      rw.textContent = 'Rewind';
      rw.className = 'ghost';
      rw.title = 'Reverse this transaction (appends a compensating entry; attributed fills return to the inbox)';
      rw.addEventListener('click', async () => {
        if (!confirm(`Rewind: ${rrow.note}?`)) return;
        try {
          const res = await api(`/txnlog/${rrow.id}/rewind`, { method: 'POST', body: {} });
          if (res.warnings && res.warnings.length) alert('Rewound with warnings:\n' + res.warnings.join('\n'));
          await refresh();
        } catch (err) { alert(err.message); }
      });
      act.appendChild(rw);
      if (rrow.kind.startsWith('trade-')) {
        const sel = document.createElement('select');
        profileOptions(sel, data.profiles.filter((p) => p.id !== rrow.profile_id));
        const re = document.createElement('button');
        re.textContent = 'Reassign →';
        re.title = 'Rewind and assign this fill to the selected profile in one step';
        re.addEventListener('click', async () => {
          try {
            const res = await api(`/txnlog/${rrow.id}/reassign`, { method: 'POST', body: { profileId: Number(sel.value) } });
            if (res.warnings && res.warnings.length) alert('Reassigned with warnings:\n' + res.warnings.join('\n'));
            await refresh();
          } catch (err) { alert(err.message); }
        });
        act.append(sel, re);
      }
    }
    tr.appendChild(act);
    lb.appendChild(tr);
  }
}

async function linkSelectedProfile(selId, statusId) {
  const sel = $(selId);
  if (!sel.value) return;
  $(statusId).textContent = 'linking…';
  try {
    await api(`/profiles/${sel.value}/link-account`, { method: 'POST', body: { accountId: subState.accountId || state.exchangeId } });
    $(statusId).textContent = 'linked ✓';
    await refresh();
  } catch (err) {
    $(statusId).textContent = `failed: ${err.message}`;
  }
}
$('#sub-link').addEventListener('click', () => linkSelectedProfile('#sub-link-profile', '#sub-status'));
$('#sub-link2').addEventListener('click', () => linkSelectedProfile('#sub-link-profile2', '#sub-status2'));

$('#carve-go').addEventListener('click', async () => {
  const status = $('#carve-status');
  const items = [...document.querySelectorAll('#carve-items input')]
    .map((i) => ({ asset_id: Number(i.dataset.assetId), qty: Number(i.value) }))
    .filter((i) => i.qty > 0);
  if (!items.length) { status.textContent = 'enter at least one quantity'; return; }
  if ($('#carve-from').value === $('#carve-to').value) { status.textContent = 'pick two different profiles'; return; }
  status.textContent = 'transferring…';
  try {
    await api(`/accounts/${subState.accountId}/carve`, {
      method: 'POST',
      body: { fromProfileId: Number($('#carve-from').value), toProfileId: Number($('#carve-to').value), items },
    });
    status.textContent = 'done ✓ (both track records spliced)';
    await refresh();
  } catch (err) {
    status.textContent = `failed: ${err.message}`;
  }
});

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
    .map((input) =>
      input.dataset.cg
        ? { coingecko_id: input.dataset.cg, symbol: input.dataset.symbol, delta: Number(input.value) || 0 }
        : { asset_id: Number(input.dataset.assetId), delta: Number(input.value) || 0 }
    )
    .filter((d) => d.delta !== 0);
  if (deltas.length === 0) {
    alert('Enter at least one non-zero deposit or withdrawal.');
    return;
  }
  const summary = deltas
    .map((d) => {
      const a = d.asset_id != null ? state.detail.assets.find((x) => x.id === d.asset_id) : null;
      const sym = d.symbol || (a ? a.symbol : '');
      return `${d.delta >= 0 ? '+' : ''}${d.delta} ${sym.toUpperCase()}`;
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

// asset search + add. The dropdown ALWAYS answers: results, "searching…",
// "no matches", or the actual error — never silence (the old handler hid
// every failure, which read as a dead control whenever the search flaked).
// A sequence guard drops out-of-order responses so a slow older query can't
// overwrite a newer one.
let searchTimer = null;
let searchSeq = 0;
$('#a-search').addEventListener('input', () => {
  state.pendingCoin = null;
  $('#a-add').disabled = true;
  clearTimeout(searchTimer);
  const q = $('#a-search').value.trim();
  const box = $('#a-results');
  if (q.length < 2) {
    box.classList.add('hidden');
    return;
  }
  box.innerHTML = '<div class="muted">searching…</div>';
  box.classList.remove('hidden');
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const coins = await api(`/search-coins?q=${encodeURIComponent(q)}`);
      if (seq !== searchSeq) return; // a newer query superseded this one
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
      if (coins.length === 0) box.innerHTML = `<div class="muted">no matches for “${q.replace(/[<>]/g, '')}”</div>`;
    } catch (err) {
      if (seq !== searchSeq) return;
      box.innerHTML = `<div class="error">search failed: ${String(err.message || err).replace(/[<>]/g, '')} — keep typing to retry</div>`;
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
  paintCpuBtn(Number.isFinite(session.cpuPct) ? session.cpuPct : 90);
  state.visionConfigured = Boolean(session.visionConfigured);
  state.telegramConfigured = Boolean(session.telegramConfigured);
  if (session.authed) {
    showMain();
    applyView();
    await loadProfiles();
    resumeActiveJobs();
    setInterval(async () => {
      if (!state.selectedId) return;
      // Never rebuild under the user's cursor — drafts survive anyway, but
      // a refresh mid-keystroke still feels like the page fighting you.
      const ae = document.activeElement;
      if (ae && ae.matches && ae.matches('#main-view input, #main-view textarea, #main-view select')) return;
      await refresh().catch(() => {});
    }, 120_000);
  } else {
    showLogin();
  }
})();
