// Constructing — the UTS-shape successor to the Bracket lab (NEXT-RELEASE
// point 25). Same back-end APIs, flow-ordered sections, token theme. The old
// Bracket lab page is frozen; this page is where construction happens now.
/* eslint-disable no-alert */
(() => {
const $ = (s, r = document) => r.querySelector(s);
// A 500 IS A FAILURE, not a reply. This returned r.json() whatever the status,
// so an error body like {error:"..."} sailed through as data: the caller's
// `.catch(() => fallback)` never fired, the fallback's own `|| []` produced an
// empty list, and an OUTAGE rendered as "nothing here yet". On the Trading tab
// that read "No greenlighted configs yet" while the service was down — telling
// the operator their configs were gone (found by fault injection, 2026-08-18).
const api = async (p) => {
  const r = await fetch(p);
  if (!r.ok) {
    let m = `HTTP ${r.status}`;
    try { const j = await r.json(); if (j && j.error) m = j.error; } catch (_) { /* no body */ }
    throw new Error(`${p}: ${m}`);
  }
  return r.json();
};
// Every panel that survives a failed read records WHICH read failed, so the
// screen can say "this is incomplete" instead of "there is nothing".
let fetchFailures = [];
const apiOr = async (p, fallback) => {
  try { return await api(p); } catch (e) { fetchFailures.push(e.message); return fallback; }
};
// AN OBJECT IS NOT TEXT. Converting one produced "[object Object]" on screen,
// which reads as content rather than as a fault (found 2026-08-21).
const esc = (t) => {
  if (t != null && typeof t === 'object') return '(unreadable)';
  return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
};
// WHAT COUNTS AS A FIGURE, and why the test is written out in full inside the
// function rather than shared. Only a number, or text that reads as one. A
// boolean is not money (Number(true) is 1) and neither is an empty list
// (Number([]) is 0, which would have printed a confident $0.00). Anything else
// reads the same as no value: a dash.
//
// Kept self-contained on purpose: the adversarial suite lifts this function out
// of the page by name and runs it, and a helper defined outside it is not there
// when it does. That would not have failed loudly — it would have reported
// eleven imaginary faults and quietly stopped checking the real one.
const money = (v) => {
  const ok = (typeof v === 'number' && Number.isFinite(v))
    || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
  return ok ? `${Number(v) < 0 ? '-' : ''}$${Math.abs(Number(v)).toFixed(2)}` : '—';
};

// THE CHOICE LISTS COME FROM THE SYSTEM, NOT FROM THIS PAGE (RULE FIVE).
//
// Thirteen dropdowns here each carried their own list of options, typed into
// this file. The owner could only pick what somebody had written here, nothing
// on screen said so, and the lists had already drifted from the engine: it
// implements a 161-hour hold and the list stopped at 137, so an option the
// system provides could not be reached. Committee agreement of 7/8 and 8/8 were
// missing the same way.
//
// Now every one of them is drawn from /api/vocabulary, which reads the code
// that implements each choice. Adding a value to the engine puts it on screen
// with nothing here to keep in step.
let VOCAB = null;
function vocabOptions(name, selected) {
  const list = VOCAB && VOCAB[name];
  if (!list) {
    // Never silently draw an empty control. A dropdown with nothing in it and
    // no explanation is worse than an error.
    return '<option value="">(choices unavailable)</option>';
  }
  return list.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(selected) ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
}
async function loadVocabulary() {
  try { VOCAB = await api('api/vocabulary'); } catch (err) { VOCAB = null; }
}

async function post(p, body) {
  const r = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
const tryPost = async (p, body) => { try { return await post(p, body); } catch (e) { alert('FAILED — nothing changed.\n\n' + e.message); return null; } };
// A POST that ASKS rather than acts: it changes nothing, so a failure is a
// blank answer, never a dialog. The cost line asks on every keystroke and a
// popup there would be unusable.
const askPost = async (p, body, fallback = null) => { try { return await post(p, body); } catch (_) { return fallback; } };
// A setup is the TRADED pair plus its context pairs. Printing only the traded
// pair makes a three-asset committee read as a single asset, which is a
// different setup with a different result — so every "selected:" line uses this.
const comboOf = (r) => (!r ? '—' : r.trade + (r.ctx1 ? ` + ${r.ctx1}` : '') + (r.ctx2 ? ` + ${r.ctx2}` : ''));

// COLUMN KEYS (owner's standing rule: every table gets a name and a KEY, and the
// key defines every heading in plain words INCLUDING ITS UNITS — money and
// accuracy points get confused, and which one it is decides whether something is
// tradeable). Most headings on this tab carried nothing at all, which left the
// decoding to the reader; that is the writer's job. Held in one place so a word
// means the same thing on every table that uses it.
const COL = {
  // Data
  pair: 'the Binance symbol, hourly candles. The fabricated planted-check pair is listed too and is marked as such.',
  months: 'how many whole months of hourly candles are cached on this box for the pair.',
  from: 'first cached month, YYYY-MM.',
  to: 'last cached month, YYYY-MM. The current month is partial until it closes.',
  manage: 'per-pair actions. Downloading is by month; purging removes the cached candles, not any run that used them.',
  // saved-run lists
  run: 'the run id. The timestamp in it is when the job was FIRED, in UTC.',
  kind: 'which engine produced it — a sweep, a History Tuning pass, an age-dial pass. Different kinds read differently.',
  status: 'done, running, or error. An error row keeps whatever it managed to record.',
  started: 'when the job was fired, UTC.',
  derives: 'the run this one was launched from, when it was — so a null run or a re-run can be traced back to its parent.',
  // asset predictability
  rank: 'position in this list only. It is an ordering, not a score.',
  asset: 'the TRADED pair of the setup. On a multi-asset committee the others are context and are never bought or sold.',
  // replication detail
  band: 'the dormant band as a PERCENT move: anything smaller than this counts as no move, so it is neither up nor down.',
  agree: 'how many committee members must agree before a position is taken, out of how many there are.',
  trades: 'how many positions this setting actually took in the window. A handful of trades makes any money figure noise.',
  // boards
  setup: 'the traded pair plus its context pairs — the whole committee, because a different context set is a different setup.',
  shape: 'the measurement geometry, the decision rule, and the dormant band. These are fixed for the run, not searched per row.',
  cell: 'the SETTING this row scored: agreement, entry and gate, hold length, and any trailing stop. The thing being chosen.',
  vsNulls: 'how many of this setup\'s own dealt-vote null copies its held-back money beats. N copies is at best a 1-in-(N+1) claim, and this is the only null the register admits as evidence.',
  // members
  member: 'one voter on the committee. Members differ only in WHICH features they are allowed to see.',
  view: 'the slice of the feature vector this member sees.',
  model: 'the trained classifier behind this member.',
  // null verdict
  nullDraw: 'one dealt-vote null world — the same committee and machinery with the calendar alignment destroyed.',
  value: 'that null world\'s held-back money in US dollars. The real result has to beat these.',
  // tool 2
  heldBack: 'money on the once-only look at data no search touched, US dollars after fees. This is what the counts read.',
  nullCopies: 'how many dealt-vote null copies this setup has. It sets the finest claim available: 1 in N+1.',
  beaten: 'how many of those copies the held-back money beats.',
  claim: 'the strongest honest statement these copies support — never finer than 1 in N+1.',
  // history tuning
  hash: 'row number in this board only.',
  age: 'the half-life setting: how fast older weeks stop counting.',
  retune: 'how often the model is retrained and how far back it looks when it is.',
  testUsd: 'net paper dollars per $100 book on the window the settings were CHOSEN on — flattering by construction, never a money claim.',
  effDays: 'the smallest effective training days any split saw. A starved split returns plausible numbers from almost no data.',
  holdUsd: 'the three held-back windows (early / middle / late) in US dollars, shown only where a hold is graded once and never shopped.',
  wt: 'winning trades over total trades in that cell.',
  // stop tuner
  giveUp: 'how many of the biggest winners you are willing to have clipped. Zero is the no-winner-lost stop.',
  stopPct: 'the fixed protective stop as a PERCENT move against the position.',
  winnersCut: 'how many winning positions this stop would have closed early.',
  winnerGiven: 'US dollars of winning profit given up by those early closes. Always negative or zero.',
  losersCut: 'how many losing positions this stop would have closed early.',
  lossSide: 'US dollars saved (or lost) on the losing side by closing them early.',
  netUsd: 'winner dollars given up plus loss-side dollars, versus running with no stop. Positive means the stop helps.',
  // conviction
  agreement: 'how many members agreed on the winning side for the trades in this bucket.',
  mult: 'the clip multiplier the declared ladder applies at that agreement level.',
  wins: 'winning trades in the bucket.',
  winPct: 'winning trades as a percent of the bucket. A thin bucket is marked and should not be read as a rate.',
  flatUsd: 'US dollars this bucket made at a FLAT clip — every trade the same size.',
  ladderUsd: 'US dollars the same bucket made with the declared ladder applied. The difference is the whole question.',
  // greenlight
  glId: 'the greenlight id. It is the config\'s identity on the Trade tab.',
  campaign: 'the named line of work the source sweep belonged to.',
  why: 'the reason recorded at greenlight time. It is the decision record and is not editable afterwards.',
  minted: 'when the config was greenlighted, UTC.',
  state: 'whether this config is running on either side, and whether it has been revoked.',
};
// cth(label, key[, style]) — a heading always carries its own description.
const cth = (label, key, style) => `<th${style ? ` style="${style}"` : ''}${COL[key] ? ` title="${esc(COL[key]).replace(/"/g, '&quot;')}"` : ''}>${label}</th>`;

// THE PER-ASSET TABLE, hoisted out of the panel that used to own it (owner
// order, 2026-08-23). The ranked list no longer carries example rows — a run
// declaring 2,772 configurations made that a 99 MB reply — so the rows are
// fetched when a line is opened, and the opened table and the panel have to be
// drawn by the SAME function or they will come to disagree about what a row
// means.
const moreNote = (d) => (d.matched > d.shown
  ? `<p class="note">showing ${d.shown} of ${d.matched.toLocaleString()} rows for this configuration — the rest are recorded on the run and are not sent to the screen at once.</p>`
  : '');
const nullCell = (g) => (g.nullShare == null
  ? '<span class="muted" title="this run recorded no dealt-vote copies of this configuration">no null copies</span>'
  : `<b class="${g.nullShare === 1 ? 'pos' : ''}">${g.nullBeat}/${g.nullPairs}</b>`);
const detail = (rs) => `<div class="scrollx"><table><thead><tr>${cth('asset','asset')}${cth('band','band')}${cth('agree','agree')}
    <th title="the window the settings were chosen on — flattering by construction">test $</th>
    <th title="the once-only look on data no search touched — this is what the counts read">held-back $</th>
    <th title="held-back money minus the same execution forced long every period">vs always-long</th>
    ${cth('trades','trades')}</tr></thead><tbody>
  ${rs.map((r) => `<tr><td>${esc(r.trade + (r.ctx1 ? ' + ' + r.ctx1 : '') + (r.ctx2 ? ' + ' + r.ctx2 : ''))}</td>
    <td>±${r.bandPct != null ? r.bandPct.toFixed(2) : '?'}%</td>
    <td>${r.quorum}/${r.members}</td>
    <td class="${(r.pnl || 0) >= 0 ? 'pos' : 'neg'}">${money(r.pnl)}</td>
    <td class="${r.holdout ? ((r.holdout.pnl || 0) >= 0 ? 'pos' : 'neg') : 'muted'}">${r.holdout ? money(r.holdout.pnl) : '—'}</td>
    <td class="${r.holdout && r.holdout.vsAlwaysLong != null ? (r.holdout.vsAlwaysLong >= 0 ? 'pos' : 'neg') : 'muted'}">${r.holdout && r.holdout.vsAlwaysLong != null ? money(r.holdout.vsAlwaysLong) : '—'}</td>
    <td>${r.trades ?? '—'}</td></tr>`).join('')}
  </tbody></table></div>`;


// ---- ONE PAGING BAR, USED BY EVERY TABLE THAT CAN GROW ----------------------
// (owner order, 2026-08-23: "make it sane and pageable".)
//
// Four tables on this page grow with the run: the ranked list of declared
// configurations, one configuration's per-asset rows, the survivor board, and
// the menu grid. Each had its own answer — one shipped everything and reached
// 99 MB, one capped at 500 with no way to ask for the 501st, one capped at 400
// and said so, one had no limit at all. Four answers to one question is four
// things to get wrong, so there is one now.
//
// The bar ALWAYS states the true total. A page that does not say what it is a
// page of is a short list that reads as a complete one, which is the fault all
// of this exists to remove.
//
// The controls carry no ids on purpose: the bar is drawn many times on one
// screen (once per opened configuration) and ids have to be unique. They are
// addressed the same way the per-row buttons beside them already are, by data
// attribute, through one delegated handler.
const PAGE_SIZES = [25, 50, 100, 200, 500];

function pageBar(name, p, extra = '') {
  if (!p) return '';
  const total = p.total || 0;
  const from = total ? p.offset + 1 : 0;
  const to = p.offset + (p.shown || 0);
  const at = (o) => `data-pager="${esc(name)}" data-go="${o}"`;
  const dis = (cond) => (cond ? 'disabled' : '');
  const prev = Math.max(0, p.offset - p.limit);
  const last = Math.max(0, Math.floor(Math.max(0, total - 1) / p.limit) * p.limit);
  return `<div class="row" style="gap:.4rem;margin:.35rem 0;align-items:center;flex-wrap:wrap">
    <button ${at(0)} ${dis(p.offset === 0)} title="back to the first page">first</button>
    <button ${at(prev)} ${dis(p.offset === 0)} title="the previous page">prev</button>
    <span class="note">showing <b>${from.toLocaleString()}–${to.toLocaleString()}</b> of <b>${total.toLocaleString()}</b>${extra}</span>
    <button ${at(p.offset + p.limit)} ${dis(!p.more)} title="the next page">next</button>
    <button ${at(last)} ${dis(!p.more)} title="jump to the last page">last</button>
    <label class="muted" style="font-size:.74rem" title="how many rows this table shows at a time. Nothing is hidden by a smaller number — the count beside it always says how many there are in total.">rows per page
      <select data-pager="${esc(name)}" data-size="1">
        ${PAGE_SIZES.map((n) => `<option value="${n}" ${n === p.limit ? 'selected' : ''}>${n}</option>`).join('')}
      </select></label>
  </div>`;
}

// Every pageable table registers how to redraw itself at a given page. One
// delegated listener then serves all of them, however many are on screen.
// Where each table currently is. Kept out here so a redraw — switching sort,
// saving notes — puts you back on the page you were reading, not at the top.
const pageAt = {
  repList: { offset: 0, limit: 100 },
  board: { offset: 0, limit: 50 },
  grid: { offset: 0, limit: 200 },
  repDetail: {},                       // one entry per configuration label
};
const PAGERS = {};
// The replication table, once it has been asked for. Kept per run so opening it
// costs its minutes once and a redraw does not spend them again — and so
// switching runs cannot show one run's totals under another's name.
let repLoaded = { id: null, data: null };
function wirePagers(root) {
  if (!root || root.dataset.pagersWired) return;
  root.dataset.pagersWired = '1';
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-pager][data-go]');
    if (!b || b.disabled) return;
    const go = PAGERS[b.dataset.pager];
    if (go) go({ offset: Math.max(0, Number(b.dataset.go) || 0) });
  });
  root.addEventListener('change', (ev) => {
    const sel = ev.target.closest('select[data-pager][data-size]');
    if (!sel) return;
    const go = PAGERS[sel.dataset.pager];
    // A new page size starts from the top: staying at row 2,300 of a list you
    // just asked to show 25 at a time is not what anybody means by it.
    if (go) go({ offset: 0, limit: Number(sel.value) || 100 });
  });
}

// ---- the replication ranking ------------------------------------------------
// SCORE AND ORDER THE DECLARED CONFIGURATIONS. Lifted out of the render function
// on 2026-08-17 so it can be TESTED rather than only read: the previous version
// grouped from a list its null copies had already been filtered out of, so the
// headline statistic was structurally empty on every run and the comparator
// (whose first key returned -1 whenever both sides were null) ordered nothing at
// all. A grep-based test cannot see either fault — it saw the right words in the
// right order and passed. tests/test-declaredset.js now evaluates THIS function.
//
// Deliberately closure-free: everything it needs arrives as an argument.
//
// Order, and the reason for it (QC-7, QC-142 — an ordering IS a claim, so only
// statistics the register admits as evidence may sit in the key):
//   1. the MEASURED NULL — this configuration's held-back money against its OWN
//      dealt-vote copies, asset by asset. The register's only yardstick.
//   2. PLATEAU WIDTH on the traded asset — guards against a knife-edge fit.
//   3. the across-asset share — CONTEXT ONLY; crypto assets move together, so
//      these are nowhere near independent looks and no p-value is quoted.
//   4. money, LAST. Leading on money rebuilds the shopped board.
// GROUPING IS PART OF THE RANKING, so it lives here too. Splitting them is how
// the fault survived: the caller grouped from a real-only list and the ranker
// then looked for null copies inside groups that could not contain one. A test
// that builds the groups itself cannot see that, so the function now owns both
// halves and the test drives the whole path.
//   all      — every replication row the run recorded, null copies included
//   realRows — the real-copy subset the caller already resolved
//   tagged   — whether this doc marks which copy scored each row
// The declared-configuration ranking used to live here and now lives in
// lib/replication.js, where it can stream rows off disk instead of needing all
// of them in the browser. The reading rules moved with it — the ordering leads
// on the measured null and money is last on purpose — and the test that guards
// the sort key moved to test-declaredset.js's reading of that file.

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
  ['history', 'History'], ['tune', 'Tune'], ['greenlight', 'Greenlight'], ['help', 'Help']];
let tab = localStorage.getItem('cx-tab') || 'sweep';
// the working selection: a saved run + its selected row ride across sections
let pickedRun = localStorage.getItem('cx-run') || null;
let pickedDoc = null; // cached doc for pickedRun

// WHERE YOU WERE ON EACH TAB (owner, 2026-08-21).
//
// Every tab shared one scroll position, which is the browser's, so coming back
// to a tab put you at the top of it. On a long tab that means finding your
// place again every single time.
//
// Kept per tab and written to the browser's own storage, so it survives a
// reload too — the position is a property of the tab, not of this visit.
const scrollKeyFor = (t) => `cx-scroll-${t}`;

function rememberScroll(t) {
  try { localStorage.setItem(scrollKeyFor(t), String(Math.round(window.scrollY))); } catch (_) { /* private window */ }
}

function restoreScroll(t) {
  let y = 0;
  try { y = Number(localStorage.getItem(scrollKeyFor(t))) || 0; } catch (_) { y = 0; }
  // Two frames, not one. The content has only just been put on the page and the
  // browser has not laid it out yet — scrolling before it has means scrolling a
  // page that is still short, which quietly lands at the bottom of nothing.
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
}

// Keep it current while reading, so a reload lands in the right place too.
// Throttled to once a frame: a scroll event fires far more often than that and
// there is nothing to gain from writing every one of them.
let scrollPending = false;
window.addEventListener('scroll', () => {
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => { scrollPending = false; rememberScroll(tab); });
}, { passive: true });

function renderTabs() {
  // HELP SITS AT THE FAR RIGHT EDGE, not merely last in the row (owner,
  // 2026-08-21). Being last in the list only puts it beside Greenlight; the
  // owner asked for the far right, which in a flex row means pushing it away
  // from the working tabs with the space between them. It is not one of the
  // steps, so it should not look like the step after Greenlight.
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<div class="tab ${k === tab ? 'on' : ''}${
    k === 'help' ? ' tab-far' : ''}" data-k="${k}">${l}</div>`).join('');
  $('#tabs').querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      rememberScroll(tab);                    // where we were on the one we are leaving
      tab = t.dataset.k;
      localStorage.setItem('cx-tab', tab);
      draw().then(() => restoreScroll(tab));  // and back to where we were on this one
    };
  });
}

// ---- release strip (persistent; clickable badge -> Verify) ------------------
// THE FIELD IS `state`. This read `s.verdict || s.status` — neither of which the
// endpoint has ever returned — so it fell through to NOT CHECKED on every call,
// including after a PASS, permanently. Same class as the dead vsNulls column:
// reading a field nothing writes (owner, 2026-08-17).
//
// gateStatus returns { engineVersion, state, detail, running, lastGate }.
// `running` is the in-flight gate's run id, and it is what tells the page that
// something IS happening — the previous code ignored it and nothing polled, so
// firing the check looked identical to not firing it.
let gatePoll = null;

function gateBadge(s) {
  if (!s) return { text: '—', cls: 'b-warn', tip: 'gate status unavailable' };
  if (s.running) {
    return { text: 'RUNNING', cls: 'b-warn',
      tip: `the planted check is running now (${s.running}) — a full sweep on the fabricated pair, minutes not seconds` };
  }
  const st = String(s.state || 'NOT CHECKED');
  return {
    text: st,
    cls: /^pass$/i.test(st) ? 'b-pass' : /^fail$/i.test(st) ? 'b-fail' : 'b-warn',
    tip: s.detail || 'the instrument\'s calibration certificate — click for the runner and the full verdict',
  };
}

async function renderStrip() {
  let s = null;
  try { s = await api('api/planted-gate/status'); } catch (_) { s = null; }
  const el = $('#strip');
  if (!el) return s;
  if (!s) { el.innerHTML = 'release <span class="muted">—</span>'; return null; }
  const b = gateBadge(s);
  el.innerHTML = `release ${esc(s.engineVersion || '')} · planted check:
    <span class="badge ${b.cls}" id="stripBadge" title="${esc(b.tip)}">${esc(b.text.toUpperCase())}</span>`;
  const btn = $('#stripBadge');
  if (btn) btn.onclick = () => { tab = 'verify'; localStorage.setItem('cx-tab', tab); draw(); };
  // While a gate is in flight, keep the badge honest without the owner having to
  // reload. One timer only, cleared the moment it lands.
  if (s.running && !gatePoll) {
    gatePoll = setInterval(async () => {
      const now = await renderStrip();
      if (!now || !now.running) {
        clearInterval(gatePoll); gatePoll = null;
        if (tab === 'verify') drawVerify();
      }
    }, 5000);
  }
  return s;
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
  const d = await apiOr('api/data-state', null);
  const rows = (d && d.symbols) || [];
  $('#view').innerHTML = `<div class="panel">
    <h3 style="margin-top:0">Data on server</h3>
    <p class="note">Every sweep, null board and tune reads this cache, never the exchange — a gap here silently
      shrinks every window. Refresh re-fetches from the newest cached month (it may have been partial) through the
      current month. Trim keeps only a range, deleting the rest. Purge deletes the whole asset. Every write refuses
      while a job runs; purge and trim DELETE data — the only way back is downloading again.</p>
    <div class="scrollx" id="dataTbl">${rows.length ? `<table><thead><tr>
      ${cth('pair','pair')}${cth('months','months')}${cth('from','from')}${cth('to','to')}${cth('manage','manage','text-align:left')}</tr></thead><tbody>
      <!-- THE FLAG, NOT ONE HARDCODED NAME. This tested r.symbol ===
           'PLANTEDUSDT', so the second fabricated pair — the late-rule exam —
           was offered refresh and TRIM like an ordinary Binance pair. Trimming
           it silently corrupts the exam it exists to be, and nothing on screen
           would say so. The planted flag now comes from lib/planted.js's list via
           /api/data-state, so a third fabricated pair cannot be missed
           (audit 2026-08-17). -->
      ${rows.map((r) => (r.planted ? `
        <tr><td>${esc(r.symbol)} <span class="note">fabricated pair — mirrors the real data's span, never downloaded; trimming it would corrupt the exam it exists to be</span></td>
          <td>${r.months ?? '—'}</td><td>${esc(r.from || '—')}</td><td>${esc(r.to || '—')}</td>
          <td style="text-align:left"><button type="button" class="ds-refresh" data-sym="${esc(r.symbol)}">regenerate to span</button>
            <button type="button" class="ds-purge" data-sym="${esc(r.symbol)}">purge…</button></td></tr>` : `
        <tr><td>${esc(r.symbol)}</td><td>${r.months ?? '—'}</td><td>${esc(r.from || '—')}</td><td>${esc(r.to || '—')}</td>
          <td style="text-align:left"><button type="button" class="ds-refresh" data-sym="${esc(r.symbol)}">refresh to latest</button>
            <!-- toMonth, not to. cacheState reports the "to" field at DAY
                 precision whenever day files exist (the normal state after any
                 refresh), and the trim endpoint accepts YYYY-MM only — so the
                 prompt pre-filled a value the server then refused, on every pair
                 with fresh days (audit 2026-08-17). -->
            <button type="button" class="ds-trim" data-sym="${esc(r.symbol)}" data-from="${esc(String(r.from || '').slice(0, 7))}" data-to="${esc(r.toMonth || String(r.to || '').slice(0, 7))}">trim…</button>
            <button type="button" class="ds-purge" data-sym="${esc(r.symbol)}">purge…</button></td></tr>`)).join('')}</tbody></table>`
    : `<p class="note">nothing cached yet — download below</p>`}</div>
    <h3>Download / refresh</h3>
    <div class="row" style="align-items:flex-end">
      <label class="f">download new pair(s), comma-sep<input id="dlPairs" placeholder="LTCUSDT,XRPUSDT" style="width:16rem"></label>
      <label class="f">from<input id="dlStart" type="month"></label>
      <label class="f">to<input id="dlEnd" type="month"></label>
      <button id="dlBtn" class="pri">Download</button>
      <!-- THE STATUS SITS BESIDE THE BUTTON, NOT AT THE FOOT OF THE PAGE (owner,
           2026-08-21). While a Global Refresh runs, "working…" used to appear
           below everything, away from the control that was doing the work.
           This inner group is what makes it line up: the row it sits in is
           deliberately bottom-aligned, because the controls to its left are a
           label stacked above an input and their BOTTOM edges are what should
           agree. Putting the status straight into that row would sit it on the
           same bottom edge rather than level with the button. The group aligns
           to the bottom like its neighbours, and centres the button and the
           status against each other inside itself. -->
      <div style="display:flex;align-items:center;gap:.8rem;flex:1 1 18rem;min-width:0">
        <button id="dlRefreshAll" title="Every cached pair: fetch from its newest cached month through the current month">Global Refresh</button>
        <!-- Wraps to a second line inside the group rather than pushing the
             group onto one of its own, which would put it back underneath. -->
        <div id="dlOut" class="note" style="min-width:0"></div>
      </div>
    </div></div>`;
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
// Section poll timers, held at module scope so a redraw CANCELS the previous
// chain instead of adding one beside it.
let sweepPoll = null;
let tunePoll = null;

// THE FORM KEEPS WHAT IS IN IT (owner, 2026-08-22).
//
// drawSweep rebuilds this whole section from scratch, so every control went
// back to its default on any redraw — switching tab, changing the theme,
// anything. The owner set up a wide sweep, launched it, pressed the theme
// button, and came back to an empty form with a job running that the screen
// could no longer describe.
//
// Two different things are wanted, and they do not conflict:
//   * while a job is RUNNING, the form shows THAT JOB's settings, because the
//     question anyone has in front of a running job is what it is doing;
//   * with nothing running, the form shows whatever the owner last had in it.
//
// The control list is asked of the page rather than kept here. A list would
// need somebody to remember it when a control is added; a query cannot go
// stale.
const SWEEP_FORM_KEY = 'cx-sweepform';
const sweepControls = () => Array.from(document.querySelectorAll('#view [id^="sw"]'))
  .filter((e) => e.tagName === 'INPUT' || e.tagName === 'SELECT' || e.tagName === 'TEXTAREA');

function rememberSweepForm() {
  const o = {};
  for (const e of sweepControls()) o[e.id] = e.type === 'checkbox' ? e.checked : e.value;
  try { localStorage.setItem(SWEEP_FORM_KEY, JSON.stringify(o)); } catch (_) { /* private window */ }
}

function restoreSweepForm() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(SWEEP_FORM_KEY) || 'null'); } catch (_) { o = null; }
  if (!o || typeof o !== 'object') return false;
  for (const e of sweepControls()) {
    if (!Object.prototype.hasOwnProperty.call(o, e.id)) continue;
    if (e.type === 'checkbox') e.checked = !!o[e.id];
    else e.value = o[e.id] == null ? '' : String(o[e.id]);
  }
  return true;
}

// A run's stored settings, written back into the boxes. ONE mapping, used by
// "copy settings into the form" on the Boards section and by the running-job
// display here — two copies of it would be two answers to the same question.
function fillSweepForm(p, description) {
  const q = (id) => document.querySelector(id);
  const setV = (id, v) => { const e = q(id); if (e != null && v != null) e.value = v; };
  const setC = (id, v) => { const e = q(id); if (e) e.checked = !!v; };
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
  setV('#swBoardRows', p.detailK);
  setV('#swMinTr', p.minTrades); setC('#swTrail', p.trailing);
  // Stored as a fraction, shown as a percent. A run recorded before fees became
  // a rate stored dollars on the $100 book; 0.125 dollars there is 0.125% here,
  // which is the same cost and the same number, so the old form reads correctly
  // either way and the new one is unambiguous.
  if (p.feePerLeg != null) {
    const frac = p.feeUnits === 'fraction' ? Number(p.feePerLeg) : Number(p.feePerLeg) / 100;
    if (Number.isFinite(frac)) setV('#swFee', String(100 * frac));
  }
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
  // description travels only when the caller asks for it: a RE-RUN states its
  // own purpose, but a running job's own description is exactly what somebody
  // looking at a running job wants to read.
  setV('#swDesc', description == null ? '' : description);
}

async function drawSweep() {
  clearTimeout(sweepPoll); sweepPoll = null;
  const [camp, names, batches] = await Promise.all([
    apiOr('api/campaign', ({ name: '' })),
    apiOr('api/campaigns', ({ names: [] })),
    apiOr('api/batches', ({ batches: [] })),
  ]);
  const running = (batches.batches || batches || []).find((b) => b.status === 'running');
  $('#view').innerHTML = `<div class="panel">
    <h3 style="margin-top:0">Campaign — the parent chain name</h3>
    <p class="note">Every run launched while a campaign is set attaches to it: sweeps, null rounds, tuning passes,
      scans. The campaign's whole chain travels with any greenlight minted from it.</p>
    <!-- A <datalist> FILTERS ITS SUGGESTIONS BY WHAT IS ALREADY IN THE BOX, and
         the box is pre-filled with the current campaign — so opening it showed
         exactly the one entry that matched, and every other campaign on the box
         was unreachable without clearing the field first. The list was never
         short: the service was offering three (owner, 2026-08-18). Two plain
         controls now: pick an existing campaign, or type a new name. -->
    <div class="row" style="align-items:flex-end">
      <label class="f" title="every campaign this box has ever stamped on a run or a greenlight, newest activity first. Picking one switches to it immediately.">existing campaigns<select id="cxCampPick" style="min-width:18rem">
        <option value="">— ${(names.names || []).length} on this box —</option>
        ${(names.names || []).map((n) => `<option value="${esc(n)}" ${n === camp.name ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      </select></label>
      <label class="f" title="name a NEW campaign. Runs launched from now on attach to whatever is set here.">or a new name<input id="cxCamp" value="${esc(camp.name || '')}" style="width:18rem"></label>
      <button id="campSet">Set</button>
      <button id="campTree" title="shows the runs and greenlights belonging to the campaign named in the box. Press it again to put them away.">View tree</button>
      <!-- Same row, same shape as its neighbours: the row is bottom-aligned
           because the controls to the left are a label above a box. -->
      <button id="campDelete" class="danger">Delete campaign…</button>
    </div>
    <p class="note">Currently set: <b>${esc(camp.name || 'none')}</b>${(names.names || []).length ? ` · ${(names.names || []).length} campaign(s) on this box` : ''}</p>
    <div id="campOut"></div></div>
  <div class="panel">
    <h3 style="margin-top:0">Board sweep — wide to FIND (never a result)</h3>
    <!-- THE TWO PASSES ARE TWO BOXES (owner order, 2026-08-22). Every control
         here belongs to one of exactly two kinds, and the rows used to cut
         straight across that line: window layout beside promote top K beside
         a control the first pass ignores. Nothing on the screen said which was
         which, so the only way to know was to be told — in words off the
         screen, which is the fault this whole rule set exists to stop. The
         boxes ARE the explanation. -->
    <div class="passbox">
      <div class="passname"><b>Both passes</b> — everything in this box shapes the slim pass and the promote pass alike</div>
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
      <!-- THE WORD "branch" IS ON THE SCREEN NOW (owner order, 2026-08-21).
           These four together are one thing, and that thing had no name the
           owner could see — so every time it was described it was described
           with a word out of the code. The answer to needing a word that is
           not there is to put it there, not to borrow one. Laid out the same
           way a field label is: the name above what it names, same size and
           same colour. -->
      <div style="display:flex;flex-direction:column;gap:.15rem">
        <span style="font-size:.74rem;color:var(--dim)">branch</span>
        <div style="display:flex;align-items:flex-end;gap:.8rem;flex-wrap:wrap">
        <div id="swGrpGeom" style="display:flex;align-items:flex-end;gap:.45rem">
          <label class="f">chunk shape<select id="swGeom">${vocabOptions('geometry', 'daily-4d')}</select></label>
          <label class="c"><input type="checkbox" id="swPermGeom" checked> permute</label>
        </div>
        <div id="swGrpDec" style="display:flex;align-items:flex-end;gap:.45rem">
          <label class="f">decision<select id="swDec">${vocabOptions('decision', 'argmax')}</select></label>
          <label class="c"><input type="checkbox" id="swPermDec" checked> permute</label>
        </div>
        <div id="swGrpBand" style="display:flex;align-items:flex-end;gap:.45rem">
          <label class="f">band % (or auto)<input id="swBand" value="auto" style="width:5rem"></label>
          <label class="c"><input type="checkbox" id="swPermBand" checked> permute</label>
        </div>
        <div id="swGrpWk" style="display:flex;align-items:flex-end;gap:.45rem">
          <label class="c"><input type="checkbox" id="swWeekdays"> 24/5</label>
          <label class="c"><input type="checkbox" id="swPermWk"> permute</label>
        </div>
        </div>
      </div>
    </div>
    <div class="row" style="margin-top:.5rem;align-items:flex-end">
      <label class="f">window layout<select id="swLayout">${vocabOptions('windowLayout', 'split70')}</select></label>
      <label class="f">null boards<input id="swNulls" type="number" value="0" min="0" style="width:4.5rem" title="companion boards with votes dealt onto random days. Beating all N of them is at best a 1-in-(N+1) claim, so 19 is the first number whose best claim reaches 1-in-20. There is NO ceiling: type any number you like and the cost is printed beside the box before you launch."></label>
      <label class="f">min trades<input id="swMinTr" type="number" value="10" style="width:4.5rem"></label>
      <label class="f" title="what a trade is assumed to cost, as a percent of the money in the position. It is charged EACH WAY — once going in and once coming out — so 0.125 here costs 0.25% over the whole trade. It is not decoration: 86% of the gross edge this system finds is eaten by fees and break-even sits about 16% above the assumed cost, so the answer moves with this box. Set it to what the venue you would trade this on charges; a config sent to Trade starts at whatever it was found under here.">fee % each way<input id="swFee" type="number" value="0.125" min="0" max="5" step="0.005" style="width:5.5rem"></label>
      <span class="note" id="swNullCost"></span>
    </div>
    </div>

    <!-- THE HINGE. One control decides what travels from the first pass to the
         second, so it sits between the two boxes rather than inside either. -->
    <div class="hinge">
      <div class="row" style="align-items:flex-end">
        <label class="f">board rows<input id="swBoardRows" type="number" value="50" min="1" style="width:4.5rem" title="how many rows the survivor board keeps. This was fixed at 50 and set nowhere, so it was neither yours to choose nor visible. There is NO ceiling — type any number and the cost of it is printed beside the box before you launch. It also sets the most that can carry into the second pass, because promotion picks from the board."></label>
        <label class="f">promote top K<input id="swK" type="number" value="25" min="1" style="width:4.5rem" title="how many of the best rows carry into the second, fuller scoring. It used to be reduced to 50 without saying so; now it goes through as typed, and a number larger than board rows is refused by name instead of being quietly changed."></label>
        <span class="note" id="swBoardCost"></span>
      </div>
      <div class="row" style="margin-top:.3rem">
        <span class="note">how many rows carry from the slim pass into the promote pass — the only thing that travels between the two boxes.
          <b>null boards</b> above zero sends every row through instead, and so does replication below.</span>
      </div>
    </div>

    <div class="passbox">
      <div class="passname"><b>Promote pass only</b> — the slim pass ignores everything in this box, however it is set</div>
    <div class="row" style="align-items:flex-end">
      <label class="c" title="Makes the SEARCH try stops that follow the price up behind you, as well as the one that sits still. Four following distances by three starting points, on the promote pass only — roughly thirteen times the work. This is about what the run LOOKS AT; the trail box below is about the one configuration you name."><input type="checkbox" id="swTrail"> also try moving stops</label>
    </div>
    <div class="row" style="margin-top:.5rem;align-items:flex-end;border-top:1px solid var(--line);padding-top:.55rem">
      <label class="c" title="REPLICATION MODE. Instead of judging each asset by the best cell the search shopped for, score settings YOU fix here, before the run, on every asset. With every permute unticked that is ONE config: nothing was chosen after seeing results, so there is no shopping tax and no branch correction owed, and it is the strongest reading the system offers. Tick any permute and these boxes declare a BLOCK of configs instead — every combination, each one scored on every asset. The counter beside them says how many, it multiplies the whole run, and having searched, the honest end is the sealed block of the 61/13/13/13 window layout. Either way the menu still runs and the board is unchanged; this adds a separate replication table reporting each declared cell per asset, read against that configuration's own dealt-vote copies and never as a binomial (QC-7: assets move together, so they are not independent looks). Agreement travels as an exact count per committee size — the 'agree' boxes (5/6 means 5 of a single coin's 6 members).">
        <input type="checkbox" id="swDecOn">
        <!-- BOTH WORDINGS ARE IN THE PAGE, and one is hidden (owner order,
             2026-08-22). The tick means two different things depending on the
             permute boxes beside it, and calling both "DECLARED" was a claim
             that is only true of one of them: with nothing permuted you named a
             setting before the run, and with anything permuted the machine
             tried thousands and you read off the best afterwards. The owner:
             "I'M NOT DECLARING ANYTHING...I'M PERMUTING THE OPTIONS."
             Rendered rather than written in by script so both sentences are on
             the screen's own word list. -->
        <span id="swDecLabelOne">replication: score ONE setting you name, on every asset</span><span id="swDecLabelMany" style="display:none">replication: search many settings, each scored on every asset</span></label>
      <div id="swGrpEntry" style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="f" id="swDecEntryWrap" title="BREAKOUT opens the position when price reaches a rail at p(1±d). MARKET enters at the entry candle's open in the called direction with no rails, holds to t, and exits at the open: the general classifier's own trade, and exactly what the live paper books do. Market entry is directional by definition, so gate and d do not apply to it.">entry
        <select id="swDecEntry">${vocabOptions('entry', 'breakout')}</select></label>
        <label class="c" title="score EVERY entry style as its own declared config"><input type="checkbox" id="swPermDecEntry"> permute</label>
      </div>
      <div id="swGrpGate" style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="f" id="swDecGateWrap">gate
        <select id="swDecGate">${vocabOptions('gate', 'directional')}</select></label>
        <label class="c" id="swPermDecGateWrap" title="score EVERY gate as its own declared config"><input type="checkbox" id="swPermDecGate"> permute</label>
      </div>
      <div id="swGrpD" style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="f" id="swDecDWrap">d
        <select id="swDecD">${vocabOptions('dMult', '1.5')}</select></label>
        <label class="c" id="swPermDecDWrap" title="score EVERY rail distance as its own declared config"><input type="checkbox" id="swPermDecD"> permute</label>
      </div>
      <div id="swGrpT" style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="f">t
        <select id="swDecT">${vocabOptions('tHours', '65')}</select></label>
        <label class="c" title="score EVERY hold length as its own declared config"><input type="checkbox" id="swPermDecT"> permute</label>
      </div>
      <div id="swGrpTrail" style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="f" id="swDecTrailWrap" title="WHICH STOP YOUR declared configuration uses. 'static' means the stop sits at the price level on the far side of your entry and never moves; the others follow the price up behind you, at the distance shown, measured against the band. This is one setting on ONE configuration — 'also try moving stops' above is the separate question of whether the SEARCH tries moving stops at all, and this needs that ticked, because a declared cell can only be found among cells the run computed.">trail
        <select id="swDecTrail">${vocabOptions('trailMult', '')}</select></label>
        <label class="c" id="swPermDecTrailWrap" title="score EVERY trailing stop, static included, as its own declared config"><input type="checkbox" id="swPermDecTrail"> permute</label>
      </div>
      <div id="swGrpArm" style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="f" id="swDecArmWrap" title="How far price must move in your favour before the trail starts. 0 trails from the first bar; 1× is close to move-to-breakeven-then-trail.">arm
        <select id="swDecArm">${vocabOptions('armMult', '0')}</select></label>
        <label class="c" id="swPermDecArmWrap" title="score EVERY arm distance as its own declared config"><input type="checkbox" id="swPermDecArm"> permute</label>
      </div>
      <div id="swGrpAgree" style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="f" id="swDecQ6Wrap" title="How many of a SINGLE coin's 6 members must agree. A single-coin committee is 3 data views (everything / prices only / volume only) × 2 model types.">agree
        <select id="swDecQ6">${vocabOptions('quorumOf6', '2')}</select></label>
        <label class="f" id="swDecQ8Wrap" title="How many of a CONTEXT combo's 8 members must agree. Adding one or two context coins adds a fourth data view — how this coin moves against them — so those committees hold 8 members.">with contexts
        <select id="swDecQ8">${vocabOptions('quorumOf8', '3')}</select></label>
        <label class="c" title="score EVERY agreement level as its own declared config — this multiplies the set fastest"><input type="checkbox" id="swPermDecAgree"> permute</label>
      </div>
      <span class="note" id="swDecCount"></span>
    </div>
    </div>

    <div class="row" style="margin-top:.5rem">
      <label class="f" style="flex:1">description — why this run exists (rides in the job heading forever)
        <input id="swDesc" style="width:100%"></label>
    </div>
    <!-- WHAT IT WILL COST, BEFORE THE BUTTON (owner order, 2026-08-22). Every
         hard stop this system has hit was a cost nobody could see until it
         arrived. The counting is done by the same code that builds the run, so
         it cannot describe a different run from the one about to start. -->
    <div class="passbox" id="swCostBox" style="margin-top:.6rem">
      <div class="passname"><b>What this run will cost</b> — worked out from the settings above, against what the box has now</div>
      <div id="swCost" class="note">working it out…</div>
    </div>
    <div class="row" style="margin-top:.6rem">
      <button id="swStart2" class="pri">Start sweep</button>
      <button id="swStop" class="danger" title="aborts the running batch job. Heavy SCANS (stop/conviction) are minutes-scale and run to completion — the Tune section shows which is running.">Stop jobs</button>
      <span id="swMsg" class="note"></span>
    </div></div>
  <div class="panel" id="swProg">${running ? '' : '<span class="muted">No job running.</span>'}</div>`;
  $('#campSet').onclick = async () => { const out = await tryPost('api/campaign', { name: $('#cxCamp').value }); if (out) drawSweep(); };
  const campPick = $('#cxCampPick');
  if (campPick) campPick.onchange = async () => {
    if (!campPick.value) return;
    // WHAT THE USER JUST PICKED WINS, IMMEDIATELY (owner, 2026-08-18).
    // "View tree" reads #cxCamp, and that box only caught up after the POST
    // returned and drawSweep() re-rendered. Click View tree inside that window
    // and it fetched the tree of the PREVIOUS campaign — a wrong answer that
    // looks like a right one, because the tree renders fine, it is just the
    // wrong campaign's. Reflecting the pick into the box synchronously, BEFORE
    // the await, closes the window: the control the button reads is correct
    // from the instant of the click.
    $('#cxCamp').value = campPick.value;
    // ...and belt-and-braces: no campaign action at all while the switch is in
    // flight, so the panel can never be acted on while "Currently set" still
    // disagrees with the dropdown. drawSweep() re-renders and re-enables.
    const tree = $('#campTree'); const set = $('#campSet');
    if (tree) tree.disabled = true; if (set) set.disabled = true;
    const out = await tryPost('api/campaign', { name: campPick.value });
    if (out) drawSweep();
    else { if (tree) tree.disabled = false; if (set) set.disabled = false; }
  };
  // A TOGGLE (owner, 2026-08-22): the same button that shows a campaign's runs
  // and greenlights puts them away again.
  //
  // What it closes is only ever a tree THIS button opened, for the campaign
  // named in the box right now. The panel below is shared with "Delete
  // campaign…", so a blind "if something is showing, clear it" would let a
  // second press silently wipe a delete warning — and the whole point of that
  // warning is that it is read before anything is answered. Recording which
  // campaign's tree is open, and clearing that record wherever the panel is
  // written by anything else, keeps the two uses of one panel apart.
  $('#campTree').onclick = async () => {
    const name = $('#cxCamp').value.trim(); if (!name) { alert('name a campaign'); return; }
    const box = $('#campOut');
    if (box.dataset.tree === name) { box.innerHTML = ''; delete box.dataset.tree; return; }
    const t = await apiOr(`api/campaign-tree?name=${encodeURIComponent(name)}`, null);
    box.dataset.tree = name;
    box.innerHTML = t ? `<h3>Campaign “${esc(t.name)}” — runs &amp; greenlights</h3>
      <table><thead><tr>${cth('run','run')}${cth('kind','kind')}${cth('status','status')}${cth('started','started')}${cth('derives from','derives','text-align:left')}</tr></thead><tbody>
      ${(t.runs || []).map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.kind)}</td><td>${esc(r.status)}</td>
        <td>${esc((r.startedAt || '').slice(0, 16))}</td><td style="text-align:left" class="muted">${esc(r.parentRunId || '—')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">no runs yet</td></tr>'}
      </tbody></table>
      ${(t.greenlights || []).length ? `<p class="note">greenlights: ${t.greenlights.map((g) => `${esc(g.id)}${g.revoked ? ' (nuked)' : ''}`).join(' · ')}</p>` : ''}` : '<p class="note">tree unavailable</p>';
  };
  // DELETING A CAMPAIGN TAKES EVERYTHING UNDER IT, so the owner is told exactly
  // what that is BEFORE answering — a count after the fact is no use to anyone.
  // Two steps on purpose: ask the server what is there, show it, then act.
  $('#campDelete').onclick = async () => {
    const name = $('#cxCamp').value.trim();
    if (!name) { alert('name a campaign, or pick one'); return; }
    const box = $('#campOut');
    // this panel is no longer showing a tree, so "View tree" must not treat a
    // press as "put the tree away" and wipe what is written below
    delete box.dataset.tree;
    const found = await apiOr(`api/campaign-contents?name=${encodeURIComponent(name)}`, null);
    if (!found) { box.innerHTML = '<p class="note">could not read what that campaign holds — nothing deleted</p>'; return; }

    // The one thing that stops it.
    if (found.locked) {
      // .panel, not .banner: .banner is a Trade-page class and does not exist
      // here. Styling against a class the page does not define is how a control
      // ends up looking like plain text (RULE FOUR).
      box.innerHTML = `<div class="panel" style="border-color:var(--neg)"><b style="color:var(--neg)">“${esc(found.name)}” is locked — nothing has been deleted.</b>
        <div style="margin-top:.3rem">${found.blocking.length} setup(s) on the Trade tab are still deployed. Retire them there first:</div>
        <ul style="margin:.3rem 0 0 1.1rem">${found.blocking.map((b) =>
    `<li>${esc(b.name || b.id)} — <b>${esc(b.state)}</b>${b.channel ? ` (${esc(b.channel)})` : ''}</li>`).join('')}</ul></div>`;
      return;
    }

    const c = found.counts;
    const lines = [
      ['saved runs', c.runs],
      ['greenlights', c.greenlights],
      ['setups (none deployed)', c.setups],
      ['saved model files', c.modelFiles],
      ['tuning files', c.tuningFiles],
    ].filter(([, n]) => n > 0);

    box.innerHTML = `<div class="panel" style="border-color:var(--warn)"><b style="color:var(--warn)">Deleting “${esc(found.name)}” will permanently remove:</b>
      ${lines.length ? `<ul style="margin:.3rem 0 0 1.1rem">${lines.map(([what, n]) =>
    `<li><b>${n}</b> ${esc(what)}</li>`).join('')}</ul>`
    : '<div style="margin-top:.3rem">nothing but the name — this campaign holds no runs, greenlights or setups.</div>'}
      <div class="muted" style="margin-top:.4rem">This cannot be undone.</div></div>`;

    // THE LIST HAS TO BE ON SCREEN BEFORE THE BOX APPEARS (owner, 2026-08-22).
    // prompt() blocks the browser dead, so setting innerHTML on the line above
    // is not enough: the change was in the page but had never been PAINTED, and
    // the summary of what was about to be destroyed only became visible once
    // the answer had already been given and acted on — which is no use to
    // anyone. Two frames, then a turn of the event loop: the first frame is
    // scheduled before the paint, the second runs after it, and the timeout
    // makes sure the paint has actually landed rather than merely been queued.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));

    // The name typed back, not an OK button. A campaign holding a season of
    // work and one holding nothing must not be one keystroke apart.
    const typed = prompt('Type the campaign name exactly to delete it and everything listed on the page behind this box:'
      + `\n\n${found.name}\n\n`
      + 'Hit Cancel to review the campaign contents prior to deleting.');
    if (typed === null) { box.innerHTML += '<p class="note">cancelled — nothing deleted</p>'; return; }
    if (typed.trim() !== found.name) {
      box.innerHTML += '<p class="note">that did not match the name — nothing deleted</p>';
      return;
    }

    const out = await tryPost('api/campaign/delete', { name: found.name, confirm: found.name });
    if (!out) return;                       // tryPost already reported why
    const r = out.removed || {};
    box.innerHTML = `<div class="panel"><b>“${esc(out.name)}” deleted.</b>
      Removed ${r.runs || 0} run(s), ${r.greenlights || 0} greenlight(s), ${r.setups || 0} setup(s),
      and the saved models and tuning files belonging to them.
      ${out.wasCurrent ? 'It was the campaign in use, so nothing is set now.' : ''}</div>`;
    drawSweep();
  };

  // Market entry has no gate and no rail distance, and the server REJECTS both
  // rather than ignoring them — a silently ignored parameter is how a declared
  // config stops meaning what its author thought it meant. So hide the controls
  // whose values would be refused instead of leaving them on screen.
  //
  // WHAT THE RUN WILL SCORE decides that, NOT the dropdown on its own (owner,
  // 2026-08-22). Ticking permute beside entry puts breakout in the run while
  // the box still reads market, and every breakout cell needs a gate, a rail
  // distance and a stop. Reading the box alone hid all four, so the page sent
  // none of them and Start sweep came back refused naming "gate" — a control
  // that was not on screen to set.
  const syncDecEntry = () => {
    const market = $('#swDecEntry').value === 'market' && !$('#swPermDecEntry').checked;
    // A permute tick belongs to its box and must vanish WITH it. Left on their
    // own they were ticks for controls that were not on screen — a market entry
    // showed three orphans and a static stop a fourth (owner, 2026-08-17).
    // Each dropdown and its permute are ONE control in one group now, so
    // hiding is one call instead of two and the tick can no longer outlive the
    // box it belongs to. The group keeps the row's flex flow, so a hidden pair
    // closes up rather than leaving a gap.
    const show = (id, on) => { const e = $(id); if (e) e.style.display = on ? 'flex' : 'none'; };
    for (const grp of ['#swGrpGate', '#swGrpD', '#swGrpTrail']) show(grp, !market);
    // arm means nothing without a MOVING stop — and permuting trail puts moving
    // stops in the run even while the box itself reads static. Hidden, the page
    // sent no arm at all and every trailing cell was scored at the code's own
    // 0x: a setting the operator never saw and never chose (RULE FIVE).
    show('#swGrpArm', !market && (!!$('#swDecTrail').value || $('#swPermDecTrail').checked));
  };
  $('#swDecEntry').onchange = syncDecEntry;
  $('#swDecTrail').onchange = syncDecEntry;
  // the two ticks that change WHICH BOXES THE RUN NEEDS, so the row keeps up
  $('#swPermDecEntry').addEventListener('change', syncDecEntry);
  $('#swPermDecTrail').addEventListener('change', syncDecEntry);
  syncDecEntry();

  // Each agreement box exists only when the run will contain committees of that
  // size: 6 members for a single coin, 8 with context coins. GREY OUT, NEVER
  // HIDE (owner, 2026-07-31) — both boxes keep their place so the row keeps its
  // shape and the "agree" label keeps its context.
  const syncDecQuorum = () => {
    // RESTORE the authored tooltip, do not blank it. This assigned '' whenever
    // the control was enabled, and it runs on load with both boxes ticked — so
    // the two "agree" descriptions were erased before the operator could ever
    // read them, and only ever came back as the REFUSAL message when the
    // control was greyed out (audit 2026-08-17).
    const off = (wrap, sel, disabled, why) => {
      const w = $(wrap);
      if (w.dataset.baseTitle === undefined) w.dataset.baseTitle = w.title || '';
      $(sel).disabled = disabled;
      w.classList.toggle('ctl-off', disabled);
      w.title = disabled ? why : w.dataset.baseTitle;
    };
    const noSingles = !$('#swSingles').checked;
    const noContexts = !($('#swDoubles').checked || $('#swTriples').checked);
    off('#swDecQ6Wrap', '#swDecQ6', noSingles,
      'this run has no single-coin committees — tick "singles" to set their agreement level');
    off('#swDecQ8Wrap', '#swDecQ8', noContexts,
      'this run has no context committees — tick "doubles" or "triples" to set their agreement level');
    // THE TICK GOES WITH THE BOXES IT BELONGS TO (owner, 2026-08-21). Both
    // dropdowns can be greyed out with the "permute" beside them still live and
    // tickable — offering to try every agreement level when there is no
    // agreement level to set. It is the same fault as a tick outliving its box,
    // which the groups fixed for the others; this one is shared by two boxes,
    // so it is only dead when BOTH of them are.
    const permWrap = $('#swPermDecAgree').closest('label');
    if (permWrap) {
      if (permWrap.dataset.baseTitle === undefined) permWrap.dataset.baseTitle = permWrap.title || '';
      const dead = noSingles && noContexts;
      $('#swPermDecAgree').disabled = dead;
      permWrap.classList.toggle('ctl-off', dead);
      permWrap.title = dead
        ? 'there is no agreement level to permute — tick "singles", "doubles" or "triples" first'
        : permWrap.dataset.baseTitle;
    }
  };
  ['#swSingles', '#swDoubles', '#swTriples'].forEach((id) => { $(id).addEventListener('change', syncDecQuorum); });
  syncDecQuorum();

  // HOW MANY CONFIGS THE TICKS DECLARE, before Start sweep. Every declared config
  // is scored on every asset, so the count multiplies the run — and the strongest
  // claim available shrinks as the search widens. A number you only discover from
  // a refusal message is a number you found too late.
  // trailMoving counts the MOVING stops only; the static stop is added on its
  // own below, because arm multiplies the moving ones and never the static one.
  const MENUS = { entry: 2, gate: 3, dMult: 5, tHours: 7, trailMoving: 4, arm: 3 };
  const syncDecCount = () => {
    const el = $('#swDecCount');
    if (!el) return;
    if (!$('#swDecOn').checked) { el.textContent = ''; return; }
    const permEntry = $('#swPermDecEntry').checked;
    const market = $('#swDecEntry').value === 'market';
    // COUNTED PER ENTRY STYLE AND ADDED, not multiplied straight through. A
    // market cell has no gate, no rail distance and no stop, so those menus
    // never multiply it — the flat product both overstated a permuted entry
    // (multiplying the market half by rails it cannot have) and understated it
    // (skipping the rail menus altogether whenever the box read market).
    let rails = 1;
    if ($('#swPermDecGate').checked) rails *= MENUS.gate;
    if ($('#swPermDecD').checked) rails *= MENUS.dMult;
    const armN = $('#swPermDecArm').checked ? MENUS.arm : 1;
    if ($('#swPermDecTrail').checked) rails *= 1 + MENUS.trailMoving * armN;
    else if ($('#swDecTrail').value) rails *= armN;
    // permuting entry scores BOTH: the one market cell, plus every rail cell
    let n = permEntry ? 1 + rails : (market ? 1 : rails);
    if ($('#swPermDecT').checked) n *= MENUS.tHours;
    if ($('#swPermDecAgree').checked) {
      if ($('#swSingles').checked) n *= 6;
      if ($('#swDoubles').checked || $('#swTriples').checked) n *= 8;
    }
    // WHAT IT COSTS ON DISK, not just in time (owner, 2026-08-22). The rows are
    // no longer held in memory, so the limit is the disk — and a limit anybody
    // meets in hour forty is not a limit, it is a loss. Each unit the run
    // scores in full records one row per config, and a stored row is about 150
    // bytes; the run's own plan line says how many units, so this says the part
    // the operator cannot work out for themselves.
    // WHICH OF THE TWO THINGS THIS TICK IS DOING, said on the tick itself.
    const one = $('#swDecLabelOne');
    const many = $('#swDecLabelMany');
    if (one && many) { one.style.display = n === 1 ? '' : 'none'; many.style.display = n === 1 ? 'none' : ''; }

    // HOW MANY WOULD LOOK GOOD BY LUCK ALONE. A setting beating all of its own
    // scrambled copies happens by chance about once in (null boards + 1) — that
    // is the rank argument: under the null the real result is equally likely to
    // be any of them. Across N searched settings the expected count of lucky
    // ones is N/(boards+1), whatever the settings have in common, because an
    // expected count adds up that way even when the things counted do not.
    //
    // Stated as the WORST case on purpose. If a setting's assets were separate
    // looks the number would be far smaller, but the register's own position is
    // that they are not — crypto assets move together (QC-7) — so we do not get
    // to assume the flattering version.
    const boards = Math.max(0, Math.floor(Number($('#swNulls').value) || 0));
    const luck = boards > 0 ? Math.round(n / (boards + 1)) : null;
    const cost = `Roughly ${n}x the replication work, and every unit scored in full records up to ${n} `
      + `rows on disk at about 150 bytes each (<b>${(n * 150 / 1048576).toFixed(1)} MB</b> per unit).`;
    el.innerHTML = n === 1
      ? 'one setting, named before the run — nothing was chosen after seeing results, and that is the strongest reading the system offers'
      : `<b>${n.toLocaleString()}</b> settings searched, each scored on every asset. `
        + (boards > 0
          ? `With <b>${boards}</b> null boards, one setting beating every one of its own copies happens by luck about `
            + `1 time in ${boards + 1} — so out of ${n.toLocaleString()}, expect about <b class="warn">${luck.toLocaleString()}</b> `
            + 'to beat all their copies by chance alone. Beating the copies says little here; picking the best line of this table is shopping. '
          : 'No null boards, so there is nothing to compare any of them against. ')
        + `${cost} Having searched, the honest end is the sealed slice (window layout 61/13/13/13, graded once in History).`;
  };
  ['#swDecOn', '#swDecEntry', '#swDecTrail', '#swPermDecEntry', '#swPermDecGate', '#swPermDecD',
    '#swPermDecT', '#swPermDecTrail', '#swPermDecArm', '#swPermDecAgree', '#swSingles', '#swDoubles', '#swTriples',
    // the luck figure is worked out from null boards, so it has to follow that box as well
    '#swNulls']
    .forEach((id) => { if ($(id)) $(id).addEventListener('change', syncDecCount); });
  if ($('#swNulls')) $('#swNulls').addEventListener('input', syncDecCount);
  syncDecCount();

  // WHAT THE NUMBER COSTS, BEFORE Start sweep (owner, 2026-08-22). This box
  // used to refuse anything above 24 — a ceiling this software picked for the
  // owner, on how strong a claim they were allowed to attempt. The cap is gone
  // and the cost is stated instead, which is the standing rule: the software
  // reports the cost, the human decides.
  const syncNullCost = () => {
    const el = $('#swNullCost');
    if (!el) return;
    const n = Math.max(0, Math.floor(Number($('#swNulls').value) || 0));
    if (!n) { el.textContent = 'no null boards — nothing to measure this run against'; return; }
    el.innerHTML = `<b>${n + 1}x</b> the work — the whole run once for real, then once per board. `
      + 'promote top K stops applying, so every row is scored in full rather than only the best ones. '
      + `Beating all ${n} is at best a <b>1-in-${n + 1}</b> claim`
      + (n < 19 ? ` — ${19 - n} more would reach 1-in-20.` : '.');
  };
  ['input', 'change'].forEach((ev) => $('#swNulls').addEventListener(ev, syncNullCost));
  syncNullCost();

  // BOARD ROWS AND PROMOTE TOP K (owner order, 2026-08-23). The board was fixed
  // at 50 and promote top K was quietly reduced to it. Both are boxes now, and
  // the pair is checked HERE so the conflict is visible while it is being typed
  // rather than thrown back after Start sweep is pressed.
  const syncBoardCost = () => {
    const el = $('#swBoardCost');
    if (!el) return;
    const rows = Math.max(1, Math.floor(Number($('#swBoardRows').value) || 0));
    const k = Math.max(1, Math.floor(Number($('#swK').value) || 0));
    if (k > rows) {
      el.innerHTML = `<b class="neg">promote top K is ${k} but the board keeps ${rows}</b> — `
        + `${k - rows} of those rows would not exist to promote. Raise board rows to ${k}, or lower promote top K to ${rows}. `
        + 'Nothing will be changed for you: the launch refuses this pair.';
      return;
    }
    // The board is re-sorted on every row that lands on it, so its cost is in
    // the sorting, not in the storage. Stated rather than capped.
    el.innerHTML = `the board keeps <b>${rows}</b> rows and <b>${k}</b> of them carry into the second pass. `
      + (rows > 200
        ? `A board this size is re-ordered on every row that lands on it, so ${rows} rows costs roughly `
          + `${(rows / 50).toFixed(0)}x the sorting of the usual 50 — noticeable on a wide run, and yours to spend.`
        : 'The usual board is 50.');
  };
  ['input', 'change'].forEach((ev) => {
    if ($('#swBoardRows')) $('#swBoardRows').addEventListener(ev, syncBoardCost);
    if ($('#swK')) $('#swK').addEventListener(ev, syncBoardCost);
  });
  syncBoardCost();

  // ---- what is in the boxes survives a redraw (see the top of this section) ----
  const runDoc = running ? await apiOr(`api/batch/${encodeURIComponent(running.id)}`, null) : null;
  if (runDoc) fillSweepForm(runDoc.params || {}, runDoc.description || (runDoc.params || {}).description || '');
  else restoreSweepForm();
  // the dependent controls follow whatever is now in the boxes, not the
  // defaults they were rendered with
  syncDecEntry(); syncDecQuorum(); syncDecCount(); syncNullCost(); syncBoardCost();
  if (runDoc) {
    const m0 = $('#swMsg');
    if (m0) {
      m0.textContent = `these are the settings of the job running now (${runDoc.id}). `
        + 'The form goes back to your own the moment it finishes.';
    }
  } else {
    // Only remember the owner's OWN form. Writing while the running job's
    // settings are on display would overwrite the draft they left here.
    for (const e of sweepControls()) {
      e.addEventListener('change', rememberSweepForm);
      e.addEventListener('input', rememberSweepForm);
    }
  }

  // ---- the cost of the run in front of you ----
  //
  // The body is built by the same function the launch uses, so the estimate is
  // priced on exactly what would be sent. Re-asked when anything changes, and
  // debounced, because it walks the whole plan on the other side.
  let costTimer = null;
  const drawCost = async () => {
    const el = $('#swCost');
    if (!el) return;
    const out = await askPost('api/sweep-estimate', sweepBody());
    if (!out) { el.textContent = 'could not work out what this run would cost'; return; }
    if (out.refusal) {
      el.innerHTML = `<b style="color:var(--neg)">This run would be refused:</b> ${esc(out.refusal)}`;
      return;
    }
    const p = out.plan;
    const t = out.time;
    const b = out.box;
    const dur = t.seconds == null ? null
      : t.seconds < 3600 ? `${Math.max(1, Math.round(t.seconds / 60))} min`
        : t.seconds < 86400 ? `${(t.seconds / 3600).toFixed(1)} hours`
          : `${(t.seconds / 86400).toFixed(1)} days`;
    const size = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB`
      : n >= 1048576 ? `${Math.round(n / 1048576)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);
    el.innerHTML = `<div class="row" style="gap:1.4rem;flex-wrap:wrap">
        <span><span class="k">units</span> <b>${p.units.toLocaleString()}</b>
          <span class="muted">${p.combos} x ${p.branches}${p.nullBoards ? ` x ${p.nullBoards + 1}` : ''}</span></span>
        <span><span class="k">trainings</span> <b>${(p.slimRuns + p.promoteRuns).toLocaleString()}</b>
          <span class="muted">${p.slimRuns.toLocaleString()} + ${p.promoteRuns.toLocaleString()}</span></span>
        <span><span class="k">time</span> <b>${dur || '—'}</b>
          <span class="muted">${t.secPerTraining == null ? 'nothing measured yet'
    : `from ${t.samples} finished run(s), ${t.secPerTraining.toFixed(2)}s each`}</span></span>
        <span><span class="k">disk</span> <b>${size(out.bytes)}</b>
          <span class="muted">of ${b.diskFreeBytes == null ? '?' : size(b.diskFreeBytes)} free</span></span>
        <span><span class="k">memory</span> <b>${out.memory ? size(out.memory.bytes) : '—'}</b>
          <span class="muted">of a ${b.heapCeilingMb == null ? '?' : b.heapCeilingMb} MB ceiling · ${b.memFreeMb.toLocaleString()} MB free on the box</span></span>
        <span><span class="k">workers</span> <b>${b.cpus}</b> <span class="muted">cpus on the box</span></span>
      </div>
      <div class="muted" style="margin-top:.35rem">
        The memory figure is what the RUN adds — the unit list, the work queue, and one copy of the settings per worker.
        The decoded prices the workers hold are larger and are not in it: those grow with how many ASSETS are in the run,
        not with how many settings.
      </div>
      <div class="muted" style="margin-top:.35rem">
        second pass: <b>${p.promoteUnits.toLocaleString()}</b> unit(s)${p.everyUnitPromoted
    ? ` — every one of them, because ${esc(p.whyEveryUnit || '')}, so promote top K does nothing`
    : ' — the top of the board, as promote top K says'}${p.declaredConfigs
    ? ` · ${p.declaredConfigs.toLocaleString()} declared config(s), ${out.rows.replication.toLocaleString()} rows` : ''}${p.trailingMultiplier > 1
    ? ' · moving stops multiply the settings each promoted unit scores by about 13' : ''}
      </div>
      ${out.warnings.length ? `<ul style="margin:.4rem 0 0 1.1rem;color:var(--warn)">${out.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`;
  };
  const askCost = () => { clearTimeout(costTimer); costTimer = setTimeout(drawCost, 300); };
  for (const e of sweepControls()) { e.addEventListener('change', askCost); e.addEventListener('input', askCost); }
  askCost();

  // THE REQUEST THIS FORM WOULD SEND, built once and used twice: by the launch
  // below, and by the cost line above it. Two copies would be two different
  // runs — the one you were shown the price of, and the one that started.
  function sweepBody() {
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
      promoteK: Number($('#swK').value) || 25, detailK: Number($('#swBoardRows').value) || 50,
      minTrades: Number($('#swMinTr').value) || 10,
      trailing: $('#swTrail').checked, windowLayout: $('#swLayout').value,
      labelShiftReps: Number($('#swNulls').value) || 0, description: $('#swDesc').value.trim(),
      // The box is in percent and the engine stores a fraction of the position,
      // the same convention as every other percent box on these pages. A blank
      // box is not a fee of nothing — it is omitted, and the launcher falls
      // back to the lab rate rather than quietly pricing the run as free.
      feePerLeg: $('#swFee').value.trim() === '' ? undefined : Number($('#swFee').value) / 100,
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
      // WHAT IS ON SCREEN IS WHAT IS SENT — the same rule syncDecEntry decides
      // visibility by, so a box the operator can see and set always reaches the
      // run. Rails ride along whenever breakout is in the run (the box reads
      // breakout, or its permute is ticked); the server applies them to the
      // breakout members and drops them for the market one. An arm rides along
      // whenever a moving stop is in the run, including one that only exists
      // because trail is permuted.
      const rails = entry !== 'market' || dp.entry;
      const movingStop = trailRaw || dp.trail;
      body.declared = {
        entry,
        tHours: Number($('#swDecT').value),
        ...qPart,
        ...(rails ? {
          gate: $('#swDecGate').value,
          dMult: Number($('#swDecD').value),
          ...(trailRaw ? { trailMult: Number(trailRaw) } : {}),
          ...(movingStop ? { armMult: Number($('#swDecArm').value) } : {}),
        } : {}),
      };
    }
    return body;
  }

  $('#swStart2').onclick = async () => {
    const body = sweepBody();
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
  // ALWAYS, not only while something is going: with nothing running this panel
  // is where a job that ended badly gets reported, and it can only report it
  // if it is asked.
  pollProgress();
  // ONE CHAIN. Every visit to this section used to start another poller, and
  // each re-armed itself against the freshly rendered element, so it never hit
  // the bail-out — five visits meant five chains hitting the box every 5s
  // forever. CLAUDE.md names this failure mode by name: never check a running
  // job more often than it could plausibly need (audit 2026-08-17).
  async function pollProgress() {
    const bl = await apiOr('api/batches', null);
    const rows = (bl && (bl.batches || bl)) || [];
    const run = rows.find((b) => b.status === 'running');
    const el = $('#swProg'); if (!el) return;
    if (!run) {
      // A JOB THAT ENDED BADLY SAYS SO HERE (owner, 2026-08-22). The owner's
      // first wide sweep stopped after five minutes and this panel said "No
      // job running." — the same words it says when nothing was ever started.
      // The one screen that could have told them apart was the one they had no
      // reason to go and look at.
      const last = rows.slice().sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))[0];
      const bad = last && (last.status === 'interrupted' || last.status === 'error');
      el.innerHTML = bad
        ? `<div class="panel" style="border-color:var(--warn);margin:0"><b style="color:var(--warn)">The last job did not finish: ${esc(last.id)} — ${esc(last.status)}.</b>
           <div style="margin-top:.3rem">${esc(last.error || 'no reason was recorded')}</div>
           <div class="muted" style="margin-top:.4rem">Open it on the Boards section to see what it managed to record${last.status === 'interrupted' ? ', and to carry it on from where it stopped' : ''}.</div></div>`
        : '<span class="muted">No job running.</span>';
      return;
    }
    const doc = await apiOr(`api/batch/${encodeURIComponent(run.id)}`, null);
    const perf = (doc && doc.perf) || {};
    el.innerHTML = `<h3 style="margin-top:0">Running: ${esc(run.id)}</h3>
      <div class="grid">
        <div class="tile" title="which stage the job is in: the cheap slim pass over every setting, then the promote stage that re-scores the survivors in full."><div class="k">Phase</div><div class="v">${esc(perf.phase || '—')}</div></div>
        <div class="tile" title="one unit is one asset committee on one geometry. This counts units finished against units planned."><div class="k">Units</div><div class="v">${perf.unitsDone ?? 0} / ${perf.unitsTotal ?? '—'}</div></div>
        <div class="tile" title="one training is one member model fitted on one window. It is the real measure of how much work the job is doing."><div class="k">Trainings</div><div class="v">${perf.runsDone ?? 0} / ${perf.runsTotal ?? '—'}</div></div>
        <div class="tile" title="trainings completed per minute across all workers on this box. It moves with the CPU cap."><div class="k">Rate</div><div class="v">${perf.ratePerMin ? perf.ratePerMin.toFixed(1) + '/min' : '—'}</div></div>
        <div class="tile" title="estimated minutes remaining, from the current rate. It is an extrapolation, not a promise."><div class="k">ETA</div><div class="v">${perf.etaMs ? Math.round(perf.etaMs / 60000) + ' min' : '—'}</div></div>
      </div>`;
    if (tab === 'sweep') { clearTimeout(sweepPoll); sweepPoll = setTimeout(pollProgress, 5000); }
  }
}

// ---- Boards -------------------------------------------------------------------
async function loadPicked() {
  if (!pickedRun) return null;
  if (pickedDoc && pickedDoc.id === pickedRun) return pickedDoc;
  pickedDoc = await apiOr(`api/batch/${encodeURIComponent(pickedRun)}`, null);
  return pickedDoc;
}
const selKey = 'cx-selrow';
function getSelRow(doc) {
  // the run's OWN stored selection (set via Select on a row) is authoritative;
  // the local pick is display state until the server confirms
  return doc && doc.selection ? doc.selection : null;
}
async function drawBoards() {
  const bl = await apiOr('api/batches', ({ }));
  const list = (bl.batches || bl || []).filter((b) => b.kind === 'bracketlab' || b.kind === 'screen' || b.kind === 'walkforward' || b.kind === 'historytuning' || b.kind === 'httwo');
  const doc = await loadPicked();
  const leaders = doc ? (doc.leaders || []).filter((l) => l.nullDealSeed == null) : [];
  // THE BOARD IS PAGED TOO (owner order, 2026-08-23). It was the whole list in
  // one table — fine at fifty rows, which is what the board held until `board
  // rows` became a box the owner sets with no ceiling.
  const boardPage = {
    offset: Math.min(pageAt.board.offset, Math.max(0, leaders.length - 1)),
    limit: pageAt.board.limit,
    total: leaders.length,
  };
  const shownLeaders = leaders.slice(boardPage.offset, boardPage.offset + boardPage.limit);
  boardPage.shown = shownLeaders.length;
  boardPage.more = boardPage.offset + shownLeaders.length < leaders.length;
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
  // VS NULLS, from the CENSUS. construct.js read l.vsNulls, a field nothing
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
  // NOT FETCHED ON EVERY DRAW ANY MORE (owner, 2026-08-25: "WHAT I WANT IS TO
  // BE ABLE TO START MY JOB").
  //
  // This line asked for the replication table every single time Boards was
  // drawn. That table is totalled by reading every recorded row, and on the
  // owner's run that is 49,519,009 of them — measured at about ten minutes a
  // pass, on the one thread that serves every other page. So opening a run to
  // press Resume run froze the whole site for ten minutes, and the page the
  // owner was waiting for was the page that was doing it to them.
  //
  // It is opened by hand now, the same way each configuration's own rows
  // already were. Boards draws at once, Resume run is reachable, and the ten
  // minutes are spent only when somebody actually asks for that table.
  const rep = doc ? (repLoaded.id === doc.id ? repLoaded.data : null) : null;
  // Whether this run has one at all: no declared rows, nothing to open.
  const declaredHere = !!(doc && doc.rowCounts && doc.rowCounts.replication);
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
      <div class="scrollx"><table><thead><tr>${cth('rank','rank')}${cth('asset','asset')}
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
    // THE ROWS ARE ON DISK AND THERE CAN BE HUNDREDS OF MILLIONS OF THEM
    // (owner order, 2026-08-22). This used to group and total every recorded
    // row here, in the browser, which was right at seventeen rows a run and
    // impossible the moment the declared boxes could be permuted. The counting
    // now happens on the other side by streaming, and what arrives is one line
    // per declared configuration — see lib/replication.js, which carries the
    // reading rules that used to live in rankDeclaredConfigs.
    if (!rep || !rep.scored || !rep.scored.length) return '';
    const scored = rep.scored;
    const tagged = rep.tagged;
    const inferredNote = tagged ? '' : `<p class="note"><b>Counts below are INFERRED, not measured.</b> This run recorded ${rep.total}
      declared-cell rows without marking which copy scored them, so each asset's first-recorded row is taken as the
      real one — real copies are queued ahead of every null copy. ${rep.dropped} row(s) were excluded.</p>`;
    // TOOLTIPS carry the reading rules. A number shown without its rule is a
    // number that will be misread, and these four are misread in opposite
    // directions if you swap them.
    const TIP = {
      null: "this configuration's held-back money against its OWN dealt-vote copies, asset by asset. The register's only sanctioned yardstick (QC-7): the copies keep the committee's vote mix and destroy only the alignment with the market.",
      region: 'how many neighbouring settings around this one also made money on the traded asset, averaged over its assets. One step at a time on d, t and agreement. Guards against a knife-edge fit; says nothing about whether it generalises.',
      assets: 'how many assets held up. CONTEXT, NOT EVIDENCE: crypto assets move together, so these are nowhere near independent looks. No p-value is quoted from them (QC-7).',
      money: 'summed money on the once-only held-back look. Ranked LAST on purpose — leading on money rebuilds the shopped board.',
    };
    // THE PER-ASSET TABLE IS CAPPED and says so. A configuration scored on a
    // wide run has one real row per asset PER BRANCH, which is thousands — a
    // table nobody scrolls. Showing the first of them silently would be a table
    // that looks complete and is not.
    // NEVER A SHORT LIST THAT LOOKS COMPLETE. The reply says how many rows the
    // configuration actually has; if fewer were sent, the screen says so.

    // ONE declared config: the table on its own, exactly as it was. There is
    // nothing to choose between, so a ranked list would be furniture.
    if (scored.length === 1) {
      const g = scored[0];
      return `<div class="panel"><h3 style="margin-top:0">Replication — the declared config on every asset</h3>
        <p class="note">KEY — one FIXED configuration, named before the run, scored once on each asset.
          <b>beat its own null copies</b> is the reading that counts: the same configuration on dealt votes, which is the
          only yardstick the register admits. <b>plateau width</b> says whether the setting is sturdy or a knife edge.
          <b>assets held up</b> is CONTEXT ONLY — crypto assets move together, so it is not a count of independent
          looks and no p-value is quoted from it. Money is last on purpose. held-back $ is the once-only look on data
          no search touched; test $ is the window the settings were chosen on and flatters itself by construction.</p>
        ${inferredNote}
        <div><b>${esc(g.label)}</b></div>
        <div class="row" style="gap:1.4rem;margin:.3rem 0 .5rem">
          <span><span class="k" title="${esc(TIP.null)}">beat its own null copies</span> ${nullCell(g)}</span>
          <span><span class="k" title="${esc(TIP.region)}">plateau width</span> <b>${g.region == null ? '—' : g.region}</b></span>
          <span><span class="k" title="${esc(TIP.assets)}">assets held up (context)</span> <b>${g.pos} / ${g.holdCount}</b></span>
          <span><span class="k" title="${esc(TIP.money)}">total held-back</span> <b class="${g.sum >= 0 ? 'pos' : 'neg'}">${money(g.sum)}</b></span>
          <span><span class="k">beat always-long</span> <b>${g.vsLPos} / ${g.vsLCount}</b></span>
        </div>
        <div class="repdetail" data-label="${esc(g.label)}"><span class="muted">loading this configuration's rows…</span></div></div>`;
    }

    // MANY declared configs: the ranked list comes FIRST (owner, 2026-08-17).
    // One line per configuration, scrollable; open a line for its per-asset table.
    const listHtml = scored.map((g, i) => `<details style="border-bottom:1px solid var(--line)">
        <summary style="padding:.4rem .25rem;cursor:pointer">
          <span class="k" style="margin-right:.5rem">#${i + 1}</span><b>${esc(g.label)}</b>
          <span style="margin-left:.6rem" title="${esc(TIP.null)}">beat its own nulls ${nullCell(g)}</span>
          <span style="margin-left:.5rem" title="${esc(TIP.region)}">plateau <b>${g.region == null ? '—' : g.region}</b></span>
          <span class="note" style="margin-left:.5rem" title="${esc(TIP.assets)}">· assets ${g.pos}/${g.holdCount} (context)</span>
          <span class="note" style="margin-left:.5rem">· beat always-long ${g.vsLPos}/${g.vsLCount}</span>
          <span class="${g.sum >= 0 ? 'pos' : 'neg'}" style="margin-left:.5rem" title="${esc(TIP.money)}">${money(g.sum)}</span>
        </summary>
        <div class="repdetail" data-label="${esc(g.label)}" style="padding:.3rem .25rem .8rem"><span class="muted">open to load this configuration's rows</span></div>
      </details>`).join('');
    return `<div class="panel"><h3 style="margin-top:0">Replication — ${scored.length} declared configs, ranked</h3>
      <p class="note">KEY — each line is ONE declared configuration scored on every asset. Ranked by <b>how much of its
        own measured null it beat</b> first, then by <b>plateau width</b>, then by the across-asset share, then by money.
        That order is the register's: an ordering is a claim about which row is better, so only statistics the register
        admits as evidence may sit in it (QC-7, QC-142). The across-asset share is shown as CONTEXT — assets move
        together, so it is not a count of independent looks. Open a line to see that configuration on every asset.
        These configurations were SEARCHED, not declared, so the honest end is the sealed slice: window layout
        61/13/13/13, graded once in the History section.</p>
      ${inferredNote}
      ${pageBar('repList', rep.page, ' configurations')}
      <div style="max-height:26rem;overflow-y:auto;border:1px solid var(--line);border-radius:6px">${listHtml}</div>
      ${pageBar('repList', rep.page, ' configurations')}</div>`;
  })();
  $('#view').innerHTML = `<div class="panel"><div class="row" style="align-items:flex-end">
      <label class="f">saved runs<select id="bPick" style="min-width:22rem">
        <option value="">— pick a run —</option>
        ${list.map((b) => `<option value="${esc(b.id)}" ${b.id === pickedRun ? 'selected' : ''}>${esc(b.id)} (${esc(b.status)})</option>`).join('')}
      </select></label>
      <button id="bOpen">Open</button>
      <button id="bResume" ${doc && (doc.status === 'interrupted' || doc.status === 'cancelled') ? '' : 'disabled'} title="carries on a run that stopped, from where it stopped. It scores only the units that have no result yet, then finishes as normal. It refuses if the price files or the engine are not the ones the run started under — half a board scored against a different history is not one board.">Resume run</button>
      <button id="bKick" class="danger" title="restarts the service that runs the sweeps, and nothing else on this machine. For when this page will not answer at all: it is pressed through a separate small program, so it still works when this one has stopped replying. A run that was going is marked as stopped and can be picked up again with Resume run.">Restart the service</button>
      <button id="bDelete" class="danger" ${doc ? '' : 'disabled'} title="permanently removes the open run and the model and tuning files that belong to it. It refuses the run that is going right now — stop it first — and any run a greenlight names as its evidence. You are shown exactly what will go before anything is deleted.">Delete run…</button>
      ${doc ? `<span class="note">campaign: ${esc((doc.params && doc.params.campaign) || '—')} · ${esc(doc.status)} · ${(doc.params && doc.params.windowLayout) || ''}</span>` : ''}
    </div>
    <div id="bDelOut"></div></div>
    <div id="bBody">${!doc ? '<div class="panel empty">Open a run to see its board.</div>' : `
      ${doc.status === 'interrupted' || doc.status === 'error' ? `<div class="panel" style="border-color:var(--warn)">
        <b style="color:var(--warn)">This run did not finish — ${esc(doc.status)}.</b>
        <div style="margin-top:.3rem">${esc(doc.error || 'no reason was recorded')}</div></div>` : ''}
      ${doc.description || (doc.params && doc.params.description) ? `<div class="panel note">${esc(doc.description || doc.params.description)}</div>` : ''}
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
        const nullBoards = Number((doc.params || {}).labelShiftReps) || 0;
        if (!pl && !dm) return '';
        return `<div class="panel"><h3 style="margin-top:0">What this run actually is</h3>
          <!-- THE NULL-BOARD FACTOR. This gated on pl.nullBoards, a field
               nothing writes, so the clause never printed — and with the
               default 19 null boards the equation shown was off by a factor of
               20 against the unit count printed beside it. The count that IS
               recorded is params.labelShiftReps (audit 2026-08-17). -->
          ${pl ? `<p class="note"><b>Size:</b> ${pl.combos} combos × ${pl.branches} branch(es)${nullBoards ? ` × ${nullBoards + 1} boards (1 real + ${nullBoards} null)` : ''}
            = <b>${pl.units}</b> units · ${pl.slimRuns ?? '—'} slim runs · ${pl.promoteRuns ?? '—'} promote runs.
            <span title="the multiplicity any null reading here must be read against: one good-looking unit out of this many is not a finding">Every null claim on this page is against ${pl.units} units.</span></p>` : ''}
          <!-- dm.overallDigest / dm.symbols / dm.at are what lib/manifest.js
               actually writes. This read dm.digest, dm.coins, dm.files and
               dm.utc — four names nothing has ever written — so the fingerprint
               that decides whether two runs are comparable at all rendered as
               "—" with no coin or file count and no stamp time, on every run
               that had one (audit 2026-08-17). -->
          ${dm ? `<p class="note"><b>Data fingerprint:</b> <code>${esc(String(dm.overallDigest || dm.error || '—')).slice(0, 24)}</code>
            ${dm.symbols ? `· ${Object.keys(dm.symbols).length} coin(s), ${Object.values(dm.symbols).reduce((a, x) => a + (x.files || 0), 0)} file(s)` : ''}
            ${dm.at ? `· stamped ${esc(String(dm.at).slice(0, 16))}` : ''}
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
      <div class="scrollx"><table><thead><tr>${cth('setup','setup')}${cth('shape','shape')}${cth('cell','cell')}${cth('trades','trades')}
        ${cth('test $','testUsd')}${cth('held-back $','heldBack')}${cth('vs nulls','vsNulls')}
        <th title="How many neighbouring settings around this row's best region ALL made money after fees. One step at a time on d, t and agreement; entry and gate are categories, so a region never crosses them. A lone winner scores 1 — noise gives spikes, structure gives regions.">region</th><th></th></tr></thead><tbody>
      ${shownLeaders.length ? shownLeaders.map((l, i) => {
    const isSel = sel && sel.trade === l.trade && sel.geometry === l.geometry && sel.decision === l.decision
      && sel.quorum === l.quorum && sel.tHours === l.tHours && (sel.ctx1 || '') === (l.ctx1 || '');
    const abs = boardPage.offset + i;                 // the index in the WHOLE board:
    // every handler below reads leaders[data-i], so a per-page index would
    // open, inspect and select the wrong row on every page but the first.
    return `<tr class="clickable ${isSel ? 'selected' : ''}" data-i="${abs}">
      <td>${esc(l.trade)}${l.ctx1 ? ` <span class="muted">+ ${esc(l.ctx1)}${l.ctx2 ? ' + ' + esc(l.ctx2) : ''}</span>` : ''}</td>
      <td>${esc(l.geometry)} · ${esc(l.decision)} · ±${l.bandPct ?? l.band ?? '—'}%</td>
      <td>q${l.quorum} · ${l.entry === 'market' ? 'directional/market' : `${esc(l.gate)}/breakout d${l.dMult}×`} · ${l.tHours}h${l.trailMult != null ? ` · trail ${l.trailMult}×` : ''}</td>
      <td>${l.trades ?? '—'}</td>
      <td class="${(l.pnl || 0) >= 0 ? 'pos' : 'neg'}">${money(l.pnl)}</td>
      <td class="${l.holdout ? ((l.holdout.pnl || 0) >= 0 ? 'pos' : 'neg') : 'muted'}">${l.holdout ? money(l.holdout.pnl) : '—'}</td>
      ${vsNullsCell(l)}
      <td title="${l.region && l.region.centre ? esc(`middle of the region: q${l.region.centre.quorum} ${l.region.centre.entry === 'market' ? 'directional/market' : `${l.region.centre.gate}/breakout d${l.region.centre.dMult}x`} ${l.region.centre.tHours}h — ${l.region.cellsClearing} of ${l.region.cellsConsidered} settings cleared the bar (${l.region.bar})`) : 'not recorded — this run predates the region being measured'}">${l.region ? esc(String(l.region.size)) : '<span class="muted">—</span>'}</td>
      <td><button data-grid="${abs}" title="every execution-menu permutation for this row, plateau view on top (test window only)">menu grid</button>
        <button data-inspect="${abs}" title="open this setup: what each committee member saw, how they voted, and how alike they are. A MICROSCOPE, not a null test — it cannot tell you whether the setup works.">inspect</button></td>
      </tr>
      <tr><td colspan="9" style="text-align:left;padding:0 .45rem .3rem"><details><summary>everything recorded for this row, verbatim</summary>
        <pre>${esc(JSON.stringify(l, null, 1))}</pre></details></td></tr>`;
  }).join('') : '<tr><td colspan="9" class="empty">no promoted rows (still running, or nothing survived)</td></tr>'}
      </tbody></table></div>
      ${pageBar('board', boardPage, ' rows on the board')}
      ${sel ? `<p class="note">selected: <b>${esc(comboOf(sel))}</b> ${esc(sel.geometry)} ${esc(sel.decision)} q${sel.quorum} ${sel.tHours}h — this selection feeds Verify · Tune · Greenlight
        <button id="bClearSel" style="margin-left:.5rem" title="take the selection off this run. Nothing here could remove one until now, so a row chosen once kept steering Verify, Tune and Greenlight indefinitely.">clear selection</button></p>` : '<p class="note">no row selected yet</p>'}
      </div>
      ${repBlock || (declaredHere ? `<div class="panel"><details id="bRepOpen"><summary style="cursor:pointer"><b>Replication —</b> the declared config on every asset</summary>
        <p class="note" id="bRepNote">Totalled by reading every recorded row of this run — ${(doc.rowCounts && doc.rowCounts.replication || 0).toLocaleString()} of them.
          On a run this size that takes minutes, and while it runs nothing else on this page answers, so it is opened by hand rather than every time.</p></details></div>` : '')}
      <div class="panel" id="gridOut"><span class="muted">Menu grid: press a row's button — every execution permutation for that row with the plateau view (one setting moved at a time) on top.</span></div>
      <div class="panel"><details><summary>the COMPLETE stored settings record for this run, verbatim (nothing invisible)</summary>
        <pre>${esc(JSON.stringify(doc.params || {}, null, 1))}</pre></details></div>`}
    </div>`;
  $('#bOpen').onclick = () => { pickedRun = $('#bPick').value || null; localStorage.setItem('cx-run', pickedRun || ''); pickedDoc = null; drawBoards(); };
  // OPENED BY HAND. The table is totalled by reading every recorded row, so on
  // a large run this is minutes and the rest of the page cannot be drawn while
  // it happens. Asking for it is the owner's press, not a side effect of
  // arriving on this section.
  // ONE SERVICE, AND ONLY THAT ONE (owner, 2026-08-25: "IF THERE WAS A SERVICE
  // NOT RUNNING THAT WAS STOPPING THAT THEN I NEED TO BE ABLE TO CONTROL *ONLY
  // THAT SERVICE*").
  //
  // It goes through a separate small program rather than this one, for two
  // reasons that both stand on their own: the service that draws these pages
  // runs under an account that is not permitted to start or stop anything, so
  // it could not do this; and if it has stopped replying — which is the only
  // reason to press this — a button it served would not be answering either.
  const kick = $('#bKick');
  if (kick) {
    kick.onclick = async () => {
      const box = $('#bDelOut');
      if (!confirm('Restart the service that runs the sweeps?\n\n'
        + 'Nothing else on the machine is touched.\n\n'
        + 'A run that is going is marked as stopped, and can be picked up again with Resume run.\n\n'
        + 'Hit Cancel and nothing is done.')) {
        box.innerHTML = '<p class="note">cancelled — nothing was done</p>';
        return;
      }
      box.innerHTML = '<p class="note">restarting it…</p>';
      const out = await tryPost('svc/api/restart', {});
      if (!out) { box.innerHTML = '<p class="note neg">it did not go through — nothing has been changed</p>'; return; }
      box.innerHTML = `<p class="note pos">${esc(out.was)} → ${esc(out.now)}. Give it a few seconds, then reload.</p>`;
    };
  }
  const repOpen = $('#bRepOpen');
  if (repOpen) {
    repOpen.addEventListener('toggle', async () => {
      if (!repOpen.open || repLoaded.id === doc.id) return;
      const note = $('#bRepNote');
      if (note) note.innerHTML = '<span class="muted">reading every recorded row — this takes minutes on a run this size, and nothing else on this page will answer until it is done</span>';
      const got = await apiOr(`api/batch/${encodeURIComponent(doc.id)}/replication`
        + `?offset=${pageAt.repList.offset}&limit=${pageAt.repList.limit}`, null);
      if (!got) {
        if (note) note.innerHTML = '<span class="warn">could not read it — nothing is missing from the run, the screen could not ask</span>';
        return;
      }
      repLoaded = { id: doc.id, data: got };
      drawBoards();
    });
  }
  // DELETING A RUN takes the model and tuning files that hang off it, so the
  // owner is shown exactly what that is BEFORE answering — the same two-step
  // the campaign delete uses, and for the same reason: a count given after the
  // fact is no use to anybody.
  // PICKING UP A RUN THAT STOPPED. Same shape as the delete: ask what is left,
  // show it, then act — so the owner sees how much of the job is still to do
  // before starting hours of work on the box.
  const bres = $('#bResume');
  if (bres) bres.onclick = async () => {
    const id = pickedRun;
    const box = $('#bDelOut');
    if (!id) { box.innerHTML = '<p class="note">open a run first</p>'; return; }
    const found = await apiOr(`api/resume-contents?id=${encodeURIComponent(id)}`, null);
    if (!found) { box.innerHTML = '<p class="note">could not read what is left of that run — nothing started</p>'; return; }
    if (!found.resumable) {
      box.innerHTML = `<div class="panel" style="border-color:var(--neg);margin-top:.5rem"><b style="color:var(--neg)">“${esc(found.id)}” cannot be picked up — nothing has been started.</b>
        <ul style="margin:.3rem 0 0 1.1rem">${found.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`;
      return;
    }
    box.innerHTML = `<div class="panel" style="border-color:var(--warn);margin-top:.5rem"><b style="color:var(--warn)">Picking up “${esc(found.id)}” will score what it never got to:</b>
      <ul style="margin:.3rem 0 0 1.1rem">
        <li><b>${found.unitsScored}</b> already scored, kept as they are</li>
        <li><b>${found.unitsLeft == null ? '—' : found.unitsLeft}</b> still to score${found.failures ? `, plus <b>${found.failures}</b> that failed and get another go` : ''}</li>
        ${found.promotedScored ? `<li><b>${found.promotedScored}</b> already scored in full, kept as they are</li>` : ''}
        ${found.promotedUnnamed ? `<li class="muted"><b>${found.promotedUnnamed}</b> older rows cannot be matched and will be scored again</li>` : ''}
        ${found.resumes ? `<li class="muted">this run has been picked up ${found.resumes} time(s) already</li>` : ''}
      </ul>
      <div class="muted" style="margin-top:.4rem">The price files are checked again the moment it starts. If they are not the ones this run read, nothing is scored and it says so.</div></div>`;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));
    if (!confirm(`Carry on "${found.id}" from where it stopped?\n\n`
      + `${found.unitsLeft == null ? 'The remaining' : found.unitsLeft} unit(s) still to score. `
      + 'This takes the one job slot until it finishes.\n\n'
      + 'Hit Cancel to review what is left prior to starting.')) {
      box.innerHTML += '<p class="note">cancelled — nothing started</p>';
      return;
    }
    const out = await tryPost('api/run/resume', { id: found.id });
    if (!out) return;
    box.innerHTML += `<p class="note">picked up ${esc(out.batchId || found.id)} — watch it on the Sweep section</p>`;
  };
  const bdel = $('#bDelete');
  if (bdel) bdel.onclick = async () => {
    const id = pickedRun;
    const box = $('#bDelOut');
    if (!id) { box.innerHTML = '<p class="note">open a run first</p>'; return; }
    const found = await apiOr(`api/run-contents?id=${encodeURIComponent(id)}`, null);
    if (!found) { box.innerHTML = '<p class="note">could not read what that run holds — nothing deleted</p>'; return; }

    if (found.locked) {
      box.innerHTML = `<div class="panel" style="border-color:var(--neg);margin-top:.5rem"><b style="color:var(--neg)">“${esc(found.id)}” cannot be deleted — nothing has been deleted.</b>
        <div style="margin-top:.3rem">${esc(found.lockedWhy || '')}</div>
        ${found.greenlights.length ? `<ul style="margin:.3rem 0 0 1.1rem">${found.greenlights.map((g) =>
    `<li>${esc(g.id)}${g.revoked ? ' (nuked)' : ''}</li>`).join('')}</ul>` : ''}</div>`;
      return;
    }

    const c = found.counts;
    const lines = [
      ['rows on the board', c.leaderRows],
      ['scored rows', c.slimRows],
      ['replication rows', c.replicationRows],
      ['saved model files', c.modelFiles],
      ['tuning files', c.tuningFiles],
    ].filter(([, n]) => n > 0);
    box.innerHTML = `<div class="panel" style="border-color:var(--warn);margin-top:.5rem"><b style="color:var(--warn)">Deleting “${esc(found.id)}” will permanently remove:</b>
      <ul style="margin:.3rem 0 0 1.1rem"><li>the run itself${found.campaign ? ` (campaign ${esc(found.campaign)})` : ''}</li>
      ${lines.map(([what, n]) => `<li><b>${n}</b> ${esc(what)}</li>`).join('')}</ul>
      ${found.plantedGate ? `<div class="note" style="margin-top:.4rem"><b>The planted check verdict is KEPT.</b>
        Deleting this run removes its rows, not its result — the pass or fail it recorded, the engine version it
        judged and the sentences saying why stay on the box for good, and the badge at the top of the page goes on
        showing them.</div>` : ''}
      <div class="muted" style="margin-top:.4rem">This cannot be undone.</div></div>`;

    // Painted BEFORE the box appears: prompt() blocks the browser, so without
    // this the list of what is about to go is only visible after the answer.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));

    const typed = prompt('Type the run id exactly to delete it and everything listed on the page behind this box:'
      + `\n\n${found.id}\n\n`
      + 'Hit Cancel to review what the run holds prior to deleting.');
    if (typed === null) { box.innerHTML += '<p class="note">cancelled — nothing deleted</p>'; return; }
    if (typed.trim() !== found.id) { box.innerHTML += '<p class="note">that did not match the id — nothing deleted</p>'; return; }
    const out = await tryPost('api/run/delete', { id: found.id, confirm: found.id });
    if (!out) return;
    pickedRun = null; pickedDoc = null; localStorage.setItem('cx-run', '');
    drawBoards();
  };
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
    tab = 'sweep'; localStorage.setItem('cx-tab', tab);
    draw().then(() => {
      // '' for the description: intent never copies — a re-run states its own
      // purpose. Everything else comes from the one shared mapping.
      fillSweepForm(doc.params || {}, '');
      rememberSweepForm();
      const m = $('#swMsg');
      if (m) m.textContent = `form filled from ${doc.id} — nothing launched. Say why this re-run exists, then Start sweep.`;
    });
  };
  if ($('#bSort')) {
    $('#bSort').onchange = () => { localStorage.setItem('cx-boardsort', $('#bSort').value); drawBoards(); };
  }
  // THE MISSING OFF-SWITCH (owner, 2026-08-18). A row could be selected and
  // never unselected — nothing in the tab removed a selection from a run. It
  // is not cosmetic: the stored selection changes what Verify, Tune and
  // Greenlight offer and aim at, so a state that cannot be left goes on quietly
  // steering later decisions. The confirm names what stops following it.
  const bcs = $('#bClearSel');
  if (bcs) {
    bcs.onclick = async () => {
      if (!confirm('Clear the selected row on this run?\n\nVerify, Tune and Greenlight stop following it. '
        + 'The row stays on the board — this removes the SELECTION, not the result.')) return;
      const out = await tryPost(`api/bracketlab/${encodeURIComponent(doc.id)}/select`, { clear: true });
      if (out) drawBoards();
    };
  }
  if (!doc) return;
  // ONE CONFIGURATION'S ROWS, FETCHED WHEN IT IS OPENED (owner order,
  // 2026-08-23). The ranked list is summaries only now, so each line's
  // per-asset table arrives on demand. Fetched ONCE per line — a second open
  // re-shows what is already there rather than asking again — and the reply
  // says how many rows the configuration really has, so a capped table can
  // never read as a complete one.
  // The two tables the SERVER pages redraw the whole section; the two paged in
  // the browser redraw only themselves. Registered here, where the section's
  // own redraw function is in scope.
  PAGERS.repList = ({ offset, limit }) => {
    pageAt.repList = { offset: offset ?? pageAt.repList.offset, limit: limit ?? pageAt.repList.limit };
    drawBoards();
  };
  PAGERS.board = ({ offset, limit }) => {
    pageAt.board = { offset: offset ?? pageAt.board.offset, limit: limit ?? pageAt.board.limit };
    drawBoards();
  };
  wirePagers($('#view'));

  $('#bBody').querySelectorAll('.repdetail').forEach((box) => {
    const load = async () => {
      if (box.dataset.loaded) return;
      box.dataset.loaded = '1';
      box.innerHTML = '<span class="muted">reading this configuration\'s rows…</span>';
      const at = pageAt.repDetail[box.dataset.label] || { offset: 0, limit: 200 };
      const d = await apiOr(`api/batch/${encodeURIComponent(doc.id)}/replication-detail`
        + `?label=${encodeURIComponent(box.dataset.label || '')}&offset=${at.offset}&limit=${at.limit}`, null);
      if (!d) {
        // A failed read must not leave a table that looks empty. Empty and
        // could-not-ask are different answers and the screen says which.
        box.dataset.loaded = '';
        box.innerHTML = '<span class="warn">could not read this configuration\'s rows — nothing is missing from the run, the screen could not ask</span>';
        return;
      }
      // Its own pager, named after the configuration, so several open lines
      // page independently rather than moving each other.
      const key = `repDetail:${box.dataset.label}`;
      PAGERS[key] = ({ offset, limit }) => {
        const at = pageAt.repDetail[box.dataset.label] || { offset: 0, limit: 200 };
        pageAt.repDetail[box.dataset.label] = { offset: offset ?? at.offset, limit: limit ?? at.limit };
        box.dataset.loaded = '';
        load();
      };
      box.innerHTML = detail(d.rows || []) + moreNote(d) + pageBar(key, d.page, ' rows');
    };
    const holder = box.closest('details');
    if (!holder) { load(); return; }              // the single-configuration panel: no line to open
    holder.addEventListener('toggle', () => { if (holder.open) load(); });
  });

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
      const d = await apiOr(`api/bracketlab/${encodeURIComponent(doc.id)}/inspect?file=${encodeURIComponent(file)}&quorum=${encodeURIComponent(q)}`, null);
      if (!d || d.error) { $('#gridOut').innerHTML = `<span class="warn">${esc((d && d.error) || 'inspect failed')}</span>`; return; }
      const mem = d.members || [];
      const pw = d.pairwise || d.agreement || null;
      $('#gridOut').innerHTML = `<h3 style="margin-top:0">Inside a setup — a MICROSCOPE, not a null test</h3>
        <p class="note">${esc(d.meta ? `${d.meta.trade} · ${d.meta.geometry} · ${d.meta.decision}` : '')} at agreement ${esc(String(q))}.
          This panel shows what the committee is made of. It cannot tell you whether the setup works — only a null
          comparison can, and this is not one.</p>
        ${mem.length ? `<div class="scrollx"><table><thead><tr>${cth('member','member')}${cth('view','view')}${cth('model','model')}
          <th title="share of periods this member called a direction rather than standing aside. Read on the HELD-BACK window when the run has one, otherwise the search window.">participation</th>
          <th title="exact 3-class match rate of this member's calls. Held-back window when the run has one, otherwise the search window. ACCURACY POINTS, not money.">accuracy</th>
          <th title="accuracy minus the training-majority baseline — what the member adds over always guessing the commonest label. ACCURACY POINTS, not money.">edge</th>
          <th title="share of this member's committed calls that the committee also traded — a member echoed by the others adds agreement without adding an independent opinion.">echoed by the vote</th></tr></thead><tbody>
          ${mem.map((m, i) => {
    // THE DUMP'S OWN NAMES. This read m.participation and m.metrics — neither of
    // which lib/inspect.js has ever written — so all three columns showed "—"
    // for every member of every run while looking like a measurement. The real
    // names are activeHold/activeSearch and the search/hold metric objects
    // (audit 2026-08-17). Held-back is preferred where it exists: it is the
    // once-only look, and the search window flatters by construction.
    const act = m.activeHold ?? m.activeSearch;
    const met = m.hold || m.search;
    const pctOf = (v) => (v == null ? '—' : `${(100 * v).toFixed(1)}%`);
    // m.spec is set on every member lib/inspect.js builds, so the old
    // `|| m.view` / `|| m.model` fallbacks were unreachable reads of names
    // nothing writes — the same class as the three columns above, just
    // harmless because a working read sat in front of them.
    return `<tr><td>${i + 1}</td><td>${esc(String((m.spec && m.spec.view) || '—'))}</td>
            <td>${esc(String((m.spec && m.spec.model) || '—'))}</td>
            <td>${pctOf(act)}</td>
            <td>${met && met.testAcc != null ? (100 * met.testAcc).toFixed(1) + '%' : '—'}</td>
            <td>${met && met.edge != null ? (100 * met.edge).toFixed(1) + ' pts' : '—'}</td>
            <td>${pctOf(m.withTradeHold)}</td></tr>`;
  }).join('')}
          </tbody></table></div>
          <p class="note">Columns read the HELD-BACK window where the run has one, the search window otherwise.
            Accuracy and edge are ACCURACY POINTS, never money.</p>` : '<p class="note">no per-member detail in this dump</p>'}
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
        const drawGridTable = () => {
        const gridPage = {
          offset: Math.min(pageAt.grid.offset, Math.max(0, cells.length - 1)),
          limit: pageAt.grid.limit, total: cells.length,
        };
        const gridShown = cells.slice(gridPage.offset, gridPage.offset + gridPage.limit);
        gridPage.shown = gridShown.length;
        gridPage.more = gridPage.offset + gridShown.length < cells.length;
        $('#gridOut').innerHTML = renderPlateau(cells, l) + rankLine + `<h3 style="margin-top:0">Menu grid — ${esc(l.trade)} ${esc(l.geometry)} (${cells.length.toLocaleString()} permutations, test window only)</h3>
          <div class="scrollx"><table><thead><tr>${cth('cell','cell')}${cth('trades','trades')}${cth('test $','testUsd')}</tr></thead><tbody>
          ${gridShown.map((c) => `<tr><td>q${c.quorum} · ${c.entry === 'market' ? 'market' : `${esc(c.gate)} d${c.dMult}×`} · ${c.tHours}h${c.trailMult != null ? ` · trail ${c.trailMult}×` : ''}</td>
            <td>${c.trades ?? '—'}</td><td class="${(c.pnl || 0) >= 0 ? 'pos' : 'neg'}">${money(c.pnl)}</td></tr>`).join('')}
          </tbody></table></div>${pageBar('grid', gridPage, ' settings')}`;
        // The grid arrives whole and is paged here rather than re-asked for:
        // it is one run of arithmetic the server already did, and asking again
        // would recompute it. Re-rendered from the cells already in hand.
        PAGERS.grid = ({ offset, limit }) => {
          pageAt.grid = { offset: offset ?? pageAt.grid.offset, limit: limit ?? pageAt.grid.limit };
          drawGridTable();
        };
        };
        pageAt.grid.offset = 0;      // a freshly opened grid starts at its top
        drawGridTable();
      } catch (e) { $('#gridOut').innerHTML = `<span class="warn">menu grid failed: ${esc(e.message)}</span>`; }
    };
  });
}

// ---- Verify -------------------------------------------------------------------
async function drawVerify() {
  const doc = await loadPicked();
  const sel = getSelRow(doc);
  const gate = await apiOr('api/planted-gate/status', null);
  // The scramble run was a box you TYPED a run id into. The service has always
  // had an endpoint that lists exactly the runs this tool can read, with how
  // many null draws each carries — the Bracket lab used it for a dropdown and
  // this tab never called it. Typing meant every mistake came back as "unknown
  // scramble run", and an empty box asked the server a question it could not
  // answer (owner, on the same class: "I thought I would be able to select from
  // the saved sweeps").
  const vs = await apiOr('api/bracketlab/verdict-sources', ({ sources: [] }));
  const nullSrc = (vs.sources || []).filter((s) => s.scrambleDraws > 0);
  $('#view').innerHTML = `<div class="panel">
    <h3 style="margin-top:0">Planted check — the instrument's calibration certificate</h3>
    <p class="note">Regenerates a fabricated pair carrying a KNOWN planted rule and fires it through the full sweep +
      null pipeline. PASS = the board found the plant, profited, beat always-long, and every null board destroyed it.
      A pass belongs to the engine version that earned it; a new release starts NOT CHECKED.</p>
    <div class="row"><span>current: <b class="${gate && gate.running ? 'warn' : (gate && gate.state === 'PASS' ? 'pos' : gate && gate.state === 'FAIL' ? 'neg' : 'muted')}">${esc(gate && gate.running ? 'RUNNING' : ((gate && gate.state) || 'NOT CHECKED'))}</b>
      ${gate && gate.engineVersion ? `<span class="muted">(engine ${esc(gate.engineVersion)})</span>` : ''}</span>
      <button id="pgRun" class="pri" ${gate && gate.running ? 'disabled title="a planted check is already running"' : ''}>Run the planted check</button>
      <span id="pgMsg" class="note">${gate && gate.running ? `running now — ${esc(gate.running)}` : ''}</span></div>
    ${gate && gate.detail ? `<p class="note">${esc(gate.detail)}</p>` : ''}
    ${gate && gate.running ? '<p class="note">This regenerates the fabricated pair and fires a full sweep, so it takes minutes. The badge above and the release strip refresh themselves — you do not need to reload.</p>' : ''}
    ${gate && gate.lastGate && gate.lastGate.sentences ? `<div class="note"><b>Last gate (${esc(gate.lastGate.id || '')}, engine ${esc(gate.lastGate.engineVersion || '')}, ${gate.lastGate.pass ? 'PASS' : 'FAIL'}):</b>
      ${gate.lastGate.sentences.map((x) => `<div>${esc(x)}</div>`).join('')}
      ${gate.lastGate.runDeleted ? `<div style="margin-top:.3rem"><b>That run has been deleted</b> — its rows are gone, so
        it is not on the Boards section any more. The verdict above is the record kept when it finished, and it stands
        until a fresh planted check replaces it.</div>` : ''}</div>` : ''}
    ${gate ? `<details style="margin-top:.4rem"><summary>full gate record</summary><pre>${esc(JSON.stringify(gate, null, 1))}</pre></details>` : ''}
  </div>
  <div class="panel">
    <h3 style="margin-top:0">Tool 1 — this row against its null runs</h3>
    <p class="note">Compares the picked REAL run against a SCRAMBLE run (a sweep launched with scrambled labels): each
      scrambled world re-shops the whole menu in the same test window, and its best find must beat the selected row.
      The draws come from a sweep launched with <b>null boards</b> above zero on the Sweep section — that is the box
      that makes a run appear in the list below. Read the verdict here. ALWAYS VISIBLE — a gate failing judges the INSTRUMENT,
      never retires the candidate on one number.</p>
    ${sel ? `<div class="row" style="align-items:flex-end">
      <span class="note">selected: <b>${esc(comboOf(sel))}</b> ${esc(sel.geometry)} q${sel.quorum} ${sel.tHours}h</span>
      <label class="f" title="only runs that actually carry null draws are listed — the count in brackets is how many, and it sets the finest claim available (N draws is at best 1 in N+1). Launch them with 'null boards' on Sweep.">scramble run<select id="t1null" style="min-width:22rem">
        <option value="">${nullSrc.length ? '— pick a run with null draws —' : '— no run on this box carries null draws yet —'}</option>
        ${nullSrc.map((s) => `<option value="${esc(s.id)}" ${s.id === doc.id ? 'selected' : ''}>${esc(s.id)} (${s.scrambleDraws} null draws)</option>`).join('')}
      </select></label>
      <button id="t1run" class="pri" ${nullSrc.length ? '' : 'disabled'}>Read Tool 1 verdict</button><span id="t1msg" class="note">${nullSrc.length ? '' : 'launch a sweep with null boards &gt; 0 first — this tool reads those draws.'}</span></div>
      <div id="t1out"></div>`
    : '<button disabled title="select a row on Boards first">Read Tool 1 verdict</button> <span class="note">— select a row on the Boards section first; this tool is per-row.</span>'}
  </div>
  <div class="panel">
    <h3 style="margin-top:0">Rotation rounds — a SEPARATE instrument, retired as evidence</h3>
    <p class="note">This button used to sit inside Tool 1 saying its rounds were what that tool reads. They are not.
      It fires the ROTATION null: each round rotates outcomes against features and replays the whole downstream search
      on the selected row. Its output lands on this run's own record and is shown below — nowhere else — and it creates
      none of the dealt-vote rows Tool 1 pairs against. Those come from launching a sweep with
      <b>null boards</b> above zero on the Sweep section.
      <b>The register marks this construction RETIRED as evidence</b> (historical reading only), so a number from it is
      never a claim. It stays operable because a run that already carries one must remain readable.</p>
    ${sel ? `<div class="row" style="align-items:flex-end">
      <label class="f" title="each round rotates outcomes against features and replays the whole downstream search. N rounds is at best a 1-in-(N+1) claim, and each costs a full sweep.">rotation rounds to fire<input id="t1rounds" type="number" value="19" min="1" max="1000" style="width:5rem"></label>
      <button id="t1fire">Fire rotation rounds on this run</button>
      <span id="t1fireMsg" class="note">— minutes to hours. They land on this run's own record.</span>
    </div>` : '<span class="note">select a row on the Boards section first — rotation rounds are per-row.</span>'}
    ${renderRotationRounds(doc)}
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
    return `<table><thead><tr>${cth('setup','setup')}${cth('held-back $','heldBack')}${cth('null copies','nullCopies')}${cth('beaten','beaten')}${cth('claim','claim')}</tr></thead><tbody>
      ${reals.map((l) => {
    const ns = byKey.get(key(l)); const mine = l.holdout ? l.holdout.pnl : null;
    const beaten = mine == null ? null : ns.filter((n) => (n.holdout ? n.holdout.pnl : -Infinity) < mine).length;
    return `<tr><td>${esc(l.trade)} ${esc(l.geometry)} ${esc(l.decision)}</td>
      <td class="${(mine || 0) >= 0 ? 'pos' : 'neg'}">${money(mine)}</td><td>${ns.length}</td>
      <td>${beaten == null ? '—' : `${beaten}/${ns.length}`}</td>
      <td class="muted">${beaten == null ? '—' : `at best 1 in ${ns.length + 1}`}</td></tr>`;
  }).join('')}</tbody></table>`;
  }
  const pg = $('#pgRun');
  if (pg) pg.onclick = async () => {
    if (!confirm('Run the planted check?\n\nRegenerates the fabricated pair and fires a full sweep through the null pipeline. Minutes, not seconds. It refuses while ANY other job or sweep is running.')) return;
    pg.disabled = true;
    $('#pgMsg').textContent = 'starting…';
    const out = await tryPost('api/planted-gate', {});
    if (!out) { pg.disabled = false; $('#pgMsg').textContent = ''; return; }
    // Say what is happening and KEEP saying it. Before this, the button fired,
    // claimed the page would update when it landed, and nothing ever polled —
    // so a running check was indistinguishable from one that never started.
    $('#pgMsg').textContent = `running — ${out.batchId || ''}`;
    renderStrip();
    drawVerify();
  };
  const t1 = $('#t1run');
  const t1f = $('#t1fire');
  if (t1f) t1f.onclick = async () => {
    const rounds = Number($('#t1rounds').value) || 0;
    // the engine clamps a missing/zero/negative count to ONE — a finished-looking
    // null test with n=1, which is no test at all. Refuse it here instead.
    if (rounds < 1) { $('#t1fireMsg').textContent = 'a null test needs at least one round'; return; }
    if (!confirm(`Fire ${rounds} ROTATION round(s) on ${doc.id}?\n\nEach round rotates outcomes against features and replays the whole downstream search — a full sweep each. `
      + `${rounds} rounds is at best a 1-in-${rounds + 1} claim — and the register retires this construction AS EVIDENCE, `
      + `so the result is a historical reading rather than a claim at all. `
      + `It does NOT feed Tool 1: those draws come from launching a sweep with null boards above zero.`)) return;
    t1f.disabled = true;
    $('#t1fireMsg').textContent = 'launching…';
    const out = await tryPost(`api/bracketlab/${encodeURIComponent(doc.id)}/null`, { shifts: rounds });
    t1f.disabled = false;
    $('#t1fireMsg').textContent = out ? `${out.shifts} rotation round(s) running — the table below fills in as they land` : '';
  };
  if (t1) t1.onclick = async () => {
    const nullId = $('#t1null').value;
    // Refuse here rather than let the server answer "unknown scramble run" to a
    // question that was never asked — the box being empty is not an error the
    // operator should have to decode from a 400.
    if (!nullId) { $('#t1msg').textContent = 'pick a scramble run first'; return; }
    $('#t1msg').textContent = 'reading…';
    try {
      // THE CONTEXT PAIRS ARE PART OF THE SETUP'S IDENTITY. This sent trade,
      // geometry and decision only, so the key it asked for was the SINGLES
      // key — and every doubles/triples run answered "setup … not in this
      // run's real rows". Since the live vocabulary only accepts three-asset
      // combos, that meant Tool 1 could not be read for any setup this project
      // can actually trade (runtime harness, 2026-08-17).
      //
      // The layout goes with the ROW, not the run: verdict.js fills a
      // single-arm doc in from its own rows, and only a mixed-arm ('both') run
      // needs the arm named. Sending params.windowLayout regardless put a
      // stamp on the key that the rows may not carry.
      const d = await post('api/bracketlab/null-verdict', {
        realId: doc.id, nullId,
        trade: sel.trade, ctx1: sel.ctx1 || null, ctx2: sel.ctx2 || null,
        geometry: sel.geometry, decision: sel.decision,
        ...(sel.layoutArm ? { windowLayout: sel.layoutArm } : {}),
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
      <label class="f" title="how fast older evidence stops counting. The server accepts these three keys and no others (lib/httwo.js HALF_LIVES); the tab used to offer 90d/180d/365d/730d and EVERY launch threw.">half-life<select id="ht2hl">${vocabOptions('halfLife', '12mo')}</select></label>
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
  const list = await apiOr('api/batches', ({}));
  const runs = (list.batches || list || []).filter((b) => b.kind === 'historytuning' || b.kind === 'httwo').slice(0, 12);
  $('#htList').innerHTML = runs.length ? `<table><thead><tr>${cth('run','run')}${cth('kind','kind')}${cth('status','status')}${cth('started','started')}<th></th></tr></thead><tbody>
    ${runs.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.kind)}</td><td>${esc(r.status)}</td><td>${esc((r.startedAt || '').slice(0, 16))}</td>
      <td><button data-open="${esc(r.id)}">read</button></td></tr>`).join('')}</tbody></table><div id="htRead"></div>`
    : '<span class="muted">none yet</span>';
  $('#htList').querySelectorAll('button[data-open]').forEach((b) => {
    b.onclick = async () => {
      const d = await apiOr(`api/batch/${encodeURIComponent(b.dataset.open)}`, null);
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
  const exams = await apiOr('api/httwo/exams', null);
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
// The rotation null's own output. lib/batch.js has written doc.nullTest since
// the instrument existed and this tab rendered it NOWHERE — so the button spent
// a full sweep per round and the operator had no way to see the result at all
// (audit 2026-08-17). The frozen Bracket lab has always shown it.
//
// Labelled for what it is on every reading: the register marks this construction
// RETIRED as evidence, so the numbers are historical reading, never a claim.
function renderRotationRounds(doc) {
  const nt = doc && doc.nullTest;
  if (!nt) return '<p class="note">no rotation rounds on this run.</p>';
  const pct = (v) => (v == null ? '—' : `${(100 * v).toFixed(1)}%`);
  const head = nt.status === 'running'
    ? `RUNNING — ${nt.shifts ?? 0} of ${nt.requestedShifts ?? '?'} rounds banked`
    : `${String(nt.status || '?')} — ${nt.shifts ?? 0} round(s)`;
  return `<h4 style="margin:.7rem 0 .3rem">Rotation rounds on this run: ${esc(head)}</h4>
    <p class="note">TABLE: the rotation null. NAME: how often a rotated world matched or beat the real result.
      KEY — exceed: the share of rounds whose result reached the real one, so LOWER is better and it is a share, not
      money; null median $: the middle result across rounds, in US dollars on the same window as the real figure.
      Real result: ${money(nt.real ? nt.real.pnl : null)} over ${nt.real && nt.real.trades != null ? nt.real.trades : '—'} trades.</p>
    <div class="scrollx"><table><thead><tr>
      <th title="which reading: the whole downstream search replayed per rotation, or only the selected cell's own configuration">reading</th>
      <th title="share of rotation rounds that matched or beat the real result. A SHARE, not money — and lower is better.">exceed</th>
      <th title="the middle result across the rotation rounds, in US dollars on the same window as the real figure">null median $</th></tr></thead><tbody>
      <tr><td>best-of-menu, search replayed</td><td><b>${pct(nt.exceedSearch)}</b> of ${nt.shifts ?? 0}</td>
        <td>${nt.medianBestPnl != null ? money(nt.medianBestPnl) : '—'}</td></tr>
      <tr><td>same configuration only</td><td>${pct(nt.exceedSame)}</td>
        <td>${nt.medianSamePnl != null ? money(nt.medianSamePnl) : '—'}</td></tr>
    </tbody></table></div>
    <p class="note">The row itself was chosen from ${doc.plan ? doc.plan.units : '?'} searched units. That multiplicity is
      NOT replayed here, so this cannot be read as the shopping-corrected number — and the register retires this
      construction as evidence in any case.</p>`;
}

function renderNullVerdict(d) {
  if (!d) return '<span class="warn">no verdict</span>';
  const drawsTable = (t) => `<div class="scrollx" style="max-height:14rem;overflow-y:auto"><table>
    <thead><tr>${cth('null draw','nullDraw')}${cth('value','value')}</tr></thead><tbody>
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
      <table><thead><tr>${cth(esc(title),'cell')}${cth('test $','testUsd')}${cth('W/T','wt')}</tr></thead><tbody>
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
    + `${p.mode === 'reserve-grade' ? ` <span class="badge">reserve grade${
  (p.reserveLook || 1) > 1 ? ` · look ${p.reserveLook}` : ''}</span>` : ''}</h3>`;

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
        figure would be structurally zero and meaningless.</p>
      ${(p.priorReserveLooks || []).length ? `<p class="note"><b>This was look ${p.reserveLook}.</b>
        The slice had already been read ${p.priorReserveLooks.length} time(s) when this grade ran:
        ${p.priorReserveLooks.map((g) => `<div>${esc(g.id)} — ${g.passed === null ? esc(g.status || '—') : (g.passed ? 'PASSED' : 'FAILED')}</div>`).join('')}
        <div style="margin-top:.3rem">Only the first look was at data nothing had seen, so the floor above is the best
        case rather than the strength of this reading.</div></p>` : ''}</div>`;
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
  // EVERY LOOK THIS SETUP'S SEALED SLICE HAS HAD (owner order, 2026-08-23).
  // The button used to say "one touch, final" and the server used to refuse a
  // second press. It does not refuse any more — how many times the slice is
  // read is the owner's call — so the screen's job is to say which look this
  // would be and what the earlier ones said, before it is pressed.
  const myLooks = (siblings || [])
    .filter((d) => (d.params || {}).mode === 'reserve-grade' && (d.params || {}).replayOf === r.id)
    .sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
  const nextLook = myLooks.length + 1;
  const looksSoFar = myLooks.length
    ? `<p class="note"><b>This slice has been read ${myLooks.length} time(s) already.</b>
       ${myLooks.map((d, i) => `<div>look ${(d.params || {}).reserveLook || i + 1} — ${esc(d.id)} — ${
  d.verdict ? (d.verdict.passed ? '<b class="pos">PASSED</b>' : '<b class="neg">FAILED</b>') : esc(d.status)}</div>`).join('')}
       <div style="margin-top:.3rem">The first look was at data nothing had seen. Every look after it is not, so its
       resolution floor is the best case rather than the strength. Reading it again is your call; the run records
       which look it was and says so on its own verdict.</div></p>`
    : '';
  const gradeBtn = readable && p.reserveFromTs
    ? `${looksSoFar}<p class="note"><button data-ht-grade="${esc(r.id)}" data-look="${nextLook}" class="pri">Run the reserve grade${
  nextLook > 1 ? ` — look ${nextLook}` : ''}</button>
       — the winner's walk, the reference pass's walk and 19 null draws over the SEALED reserve, fired together.${
  nextLook === 1 ? ' This is the first look at that slice.' : ''}</p>`
    : (readable ? '<p class="note">No reserve exists for this setup (its board run predates the reserve layout) — the binding grade is the forward paper book.</p>' : '');

  return `<div class="panel">${head}${shaping}${rules}${excludedNote}
    <p class="note"><b>TABLE: the dial-pair board</b>${r.status === 'running' ? ' — FILLING LIVE as passes finish' : ''}.
      NAME: combined TEST money per dial pair (the picking read). KEY: age = the half-life setting; retune = cadence and
      lookback; test $ = net paper dollars per $100 book summed across the three test windows (picked on, flattering by
      construction) — a row marked partial has not finished all three splits, so its sum cannot be compared with complete
      rows; eff. days = the smallest effective training days any split saw; hold $ = the three hold windows
      early/middle/late, shown ONLY for the winner and the reference pass, because holds are graded once and never shopped.</p>
    <div class="scrollx"><table><thead><tr>${cth('#','hash')}${cth('age','age')}${cth('retune','retune')}${cth('test $','testUsd')}${cth('eff. days','effDays')}<th></th>${cth('hold $ (e/m/l)','holdUsd')}</tr></thead>
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
  // v.folds is an OBJECT — { planned, completed, dropped, silentBothArms, used }
  // — so interpolating it printed "[object Object]" where the denominator
  // belongs. The count the line wants is folds.used, and the other three are
  // computed precisely so they are disclosed rather than hidden, so they are
  // now shown too (audit 2026-08-17).
  const rich = v.p != null || v.sum != null;
  return `<p><b class="${v.pass ? 'pos' : 'warn'}">${v.pass ? 'PASS' : 'NO EFFECT SHOWN'}</b>
      <span class="note">engine ${esc(String(v.engineVersion || '?'))}</span></p>${lines}
    ${rich ? `<p class="note">paired sum ${money(v.sum)} · sign-flip p ${v.p == null ? '—' : v.p.toFixed(4)} ·
      folds positive ${v.positiveFolds ?? '—'}/${v.folds && v.folds.used != null ? v.folds.used : '—'}${v.carriedByOneFold ? ' · <b class="warn">carried by one fold</b>' : ''}
      ${v.folds ? `<span title="planned: how many folds the run asked for. dropped: folds that could not be scored. both arms silent: folds where neither arm took a position, so the pair carries no information. used: what the numbers above are computed from — the only one of the four that is a denominator.">· folds: ${v.folds.planned ?? '—'} planned, ${v.folds.completed ?? '—'} completed, ${v.folds.dropped ?? 0} dropped, ${v.folds.silentBothArms ?? 0} silent on both arms</span>` : ''}</p>` : ''}`;
}

async function wireHtRun(d, runs) {
  const p = d.params || {};
  if (d.kind === 'httwo') {
    const el = $('#ht2Verdict');
    if (el) {
      const v = await apiOr(`api/httwo/${encodeURIComponent(d.id)}/verdict`, null);
      el.innerHTML = renderHtTwoVerdict(v);
    }
    return;
  }
  // the stamped verdict prints on the REAL run only — the server refuses it for
  // a null draw or a grade, and the grade's verdict is already on its own doc
  if (d.status === 'done' && p.arm !== 'null' && !p.mode) {
    const el = $('#htVerdict');
    if (el) {
      const v = await apiOr(`api/historytuning/${encodeURIComponent(d.id)}/verdict`, null);
      // THE ENDPOINT'S OWN VOCABULARY. This read v.passed, v.nullDraws and
      // v.resolutionFloor — three names the endpoint has never returned. The
      // badge therefore said NO after a genuine PASS, permanently, and the two
      // gated clauses never printed at all. Same class as the dead vsNulls
      // column and the planted check's s.verdict (audit 2026-08-17).
      //
      // There are TWO rules and the verdict needs both: the hold rule (did
      // tuning strengthen this survivor) and the null rule (did the winner
      // exceed its draws). The sentence already says so; the badge now agrees
      // with it. PENDING is its own state — with no draws yet there is no claim
      // to make, and calling that "NO" would retire a candidate on a
      // measurement that has not happened.
      const pending = !v || v.drawCount === 0;
      const passed = v && v.holdPassed && v.nullPassed;
      el.innerHTML = !v || v.error ? `<span class="muted">${esc((v && v.error) || 'no verdict')}</span>`
        : `<p><b class="${passed ? 'pos' : pending ? 'muted' : 'warn'}">${passed ? 'PASS' : pending ? 'PENDING' : 'NO'}</b> ${esc(v.sentence || '')}</p>
           <p class="note">winner <b>${esc(String(v.winner || '—'))}</b> · winner hold ${money(v.winnerHold)} ·
             reference hold ${money(v.referenceHold)} · hold windows won ${v.holdWindowsWon ?? '—'} of 3
             ${v.drawCount ? ` · null draws at or above: ${v.nullsAtOrAbove}/${v.drawCount} · resolution floor 1 in ${v.drawCount + 1}` : ' · no null draws yet'}</p>`;
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
      const look = Number(gb.dataset.look) || 1;
      const msg = look === 1
        ? 'Run the reserve grade?\n\nThis is the FIRST look at the sealed slice — data nothing in this system has seen.'
          + ' After it, that is no longer true.'
        : `Run the reserve grade — look ${look}?\n\nThis slice has already been read ${look - 1} time(s).`
          + ' The result will be recorded as look ' + look + ' and its verdict will say so.'
          + '\n\nWhat changes: the first look was at unseen data. This one is not, so the 1-in-20 floor it prints is'
          + ' the best case and the real strength is weaker by an amount nothing here can measure.';
      if (!confirm(msg)) return;
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
  clearTimeout(tunePoll); tunePoll = null;
  const doc = await loadPicked();
  const sel = getSelRow(doc);
  const [scan, stop, conv, applied] = await Promise.all([
    apiOr('api/pilot/heavyscan', ({ running: false })),
    apiOr('api/pilot/stopsweep', ({ status: 'idle' })),
    apiOr('api/pilot/convictionsweep', ({ status: 'idle' })),
    apiOr('api/pilot/fixed-stop', ({ stopPct: null, chosen: false, why: null })),
  ]);
  const busy = scan.running;
  // THE FLOOR IS SERVED, NOT RESTATED (owner order, 2026-08-23). This section
  // used to carry 0.5% in three places — an input's min=, a tooltip and an
  // alert — kept in step with the server by a test. The server derives it from
  // the fee now, so a copy here would go stale the moment the fee moves.
  // Falling back to the served default only if the read failed.
  const floorPct = applied.floorPct == null ? 0.005 : applied.floorPct;
  const pcOf = (v) => `${(100 * v).toFixed(3)}%`;
  const floorPc = pcOf(floorPct);
  const tripPc = pcOf(applied.roundTripPct == null ? 0.0025 : applied.roundTripPct);
  const feePc = pcOf(applied.feePerLeg == null ? 0.00125 : applied.feePerLeg);
  const pct = (v) => (v == null ? '—' : (v * 100).toFixed(2) + '%');
  const usd = (v) => money(v);
  // (target prose is resolved below, from the SAME value the launcher uses)
  // WHAT THE SCANS ARE AIMED AT. The tab could only ever target F1 or the
  // selected board row; the Bracket lab reads the saved forward books and lets
  // any of them be picked ("I thought I would be able to select from the saved
  // sweeps" — owner). Books already carrying a protective stop are not listed:
  // a breakout cell's opposite rail IS its stop, so tuning one is meaningless.
  const cand = await apiOr('api/pilot/stop-candidates', ({ candidates: [] }));
  const books = (cand && cand.candidates) || [];
  // Same fix as Tool 1: run A and run B were boxes you typed a run id into, so
  // an empty box or a typo came back as a 400 the operator had to decode. The
  // list is the runs that actually carry comparable rows.
  const cmpSrc = ((await apiOr('api/bracketlab/verdict-sources', ({ sources: [] }))).sources || [])
    .filter((s) => s.realRows > 0);
  const cmpOpt = (s) => `<option value="${esc(s.id)}">${esc(s.id)}${s.windowLayout && s.windowLayout !== 'legacy' ? ` [${esc(s.windowLayout)}]` : ''}</option>`;
  // YOUR OWN SETUPS ARE THE TARGETS (owner, 2026-08-19: "just fix it all").
  //
  // This picker used to open with a fixed entry pointing at ONE hardcoded
  // config, and the endpoint behind it only ever knew about the built-in
  // research books. So the setups the owner created — including the one holding
  // real money — could not be aimed at from this screen at all, and the option
  // sitting at the top of the list claimed to be the live one while pointing at
  // something that no longer runs. A control that names a thing it cannot reach
  // is worse than an absent control.
  //
  // Now the list is built from what the server reports: the owner's setups
  // first, each addressed by its own id and scanned against its OWN training
  // cutoff, then the pre-registered books, then the selected board row.
  const profiles = books.filter((b) => b.kind === 'profile');
  const savedBooks = books.filter((b) => b.kind !== 'profile');
  const optId = (b) => `${b.kind === 'profile' ? 'p' : 'b'}:${b.id}`;
  const known = new Set(books.map(optId));
  const savedTarget = localStorage.getItem('cx-scan-target') || '';
  // A stored preference pointing at something that no longer exists resolves to
  // the first real target rather than leaving a dangling option selected.
  const firstReal = (profiles[0] && optId(profiles[0])) || (savedBooks[0] && optId(savedBooks[0])) || '';
  const tgt = (savedTarget === 'sel' && !sel) ? firstReal
    : (savedTarget === 'sel' ? 'sel' : (known.has(savedTarget) ? savedTarget : firstReal));
  const chosen = books.find((b) => optId(b) === tgt) || null;
  const scanBody = tgt === 'sel' ? { runId: doc.id, target: 'best' }
    : chosen ? (chosen.kind === 'profile' ? { setupId: chosen.id } : { bookId: chosen.id })
      : null;
  // The prose and the dropdown are computed from the SAME resolved value, so
  // the sentence above the control can no longer describe a different target
  // from the one the launcher will actually use.
  const target = tgt === 'sel'
    ? `the row selected on Boards (<b>${esc(sel.trade)}</b> ${esc(sel.geometry)} q${sel.quorum} ${sel.tHours}h of ${esc(doc.id)})`
    : chosen ? (chosen.kind === 'profile'
      ? `your setup <b>${esc(chosen.name || chosen.id)}</b>`
      : `the saved book <b>${esc(chosen.id)}</b>`)
      : '<b>nothing selectable</b> — no setup or book is without a protective stop';
  $('#view').innerHTML = `
  ${busy ? `<div class="panel warn">A heavy scan is running (${esc(String(busy))}) — one at a time; both launchers are disabled until it lands (scans run minutes and cannot be aborted mid-flight).</div>` : ''}
  <div class="panel">
    <h3 style="margin-top:0">Protective stop tuner — full-history, loses no winner</h3>
    <p class="note">Replays the frozen committee over ALL history and finds the tightest fixed stop that would not have
      clipped a single winner, plus the sacrifice curve (give up top winners → tighter stop → NET $). Scanning applies
      nothing. Target: ${target}.</p>
    <div class="row" style="margin-bottom:.4rem"><label class="f" title="what the scans below are aimed at. Anything already carrying a protective stop is not listed — a breakout cell's opposite rail IS its stop, so tuning one is meaningless. Each target is scanned against its OWN training cutoff.">scan target<select id="tuneTarget">
      ${profiles.map((b) => `<option value="${esc(optId(b))}" ${tgt === optId(b) ? 'selected' : ''}${b.blocked ? ' disabled' : ''}>${esc(b.name || b.id)} — ${esc((b.combo && b.combo.trade) || '')} ${b.cell && b.cell.tHours ? b.cell.tHours + 'h' : ''}${b.state ? ` (${esc(b.state)})` : ''}${b.blocked ? ' — cannot scan' : ''}</option>`).join('')}
      ${sel ? `<option value="sel" ${tgt === 'sel' ? 'selected' : ''}>the row selected on Boards — ${esc(sel.trade)} ${esc(sel.geometry)} q${sel.quorum} ${sel.tHours}h</option>` : ''}
      ${savedBooks.map((b) => `<option value="${esc(optId(b))}" ${tgt === optId(b) ? 'selected' : ''}>${esc(b.name || b.id)} — ${esc((b.combo && b.combo.trade) || '')} ${b.cell && b.cell.tHours ? b.cell.tHours + 'h' : ''}</option>`).join('')}
    </select></label>
    <span class="note">${profiles.length} of your setup(s) and ${savedBooks.length} saved book(s) without a protective stop</span></div>
    <div class="row" style="margin-bottom:.4rem">
      <label class="f" title="apply a stop you chose yourself rather than one off the curve. The box is in percent; the engine stores a fraction. The floor is ${floorPc}, which is twice the ${tripPc} it costs to trade in and out at ${feePc} each way — tighter than the round trip and a triggered stop is a guaranteed loss, tighter than the floor and it fires on ordinary hourly noise. This button writes the live engine's own risk parameter, so the floor is the lab rate rather than any one profile's fee.">or apply a custom stop<input id="stopCustomPct" type="number" step="0.5" min="${floorPct}" max="99" placeholder="e.g. 25" style="width:5.5rem"> %</label>
      <button id="stopCustomApply">apply custom</button>
      <button id="stopClear" title="run with NO fixed stop. The position then rests on its scheduled exit alone.">No stop (clear)</button>
    </div>
    <!-- YOUR REASON, WRITTEN BY YOU. The record carries a reason beside the
         number so a chosen "none" is not mistaken for one nobody set. For one
         release that field could only be filled by running a script, which put
         a control that belongs to the operator somewhere they could not reach.
         It is a box on this page now, sent with every apply and every clear,
         and editable on its own afterwards. -->
    <div class="row" style="margin-bottom:.4rem">
      <label class="f" title="why you chose this. Saved with the number and shown on the Trade screen beside it. Yours to write and to change at any time.">your reason for this choice<input id="stopWhy" type="text" maxlength="300" placeholder="why this stop, or why none" value="${esc(applied.why || '')}" style="width:32rem"></label>
      <button id="stopWhySave" title="save the reason on its own, leaving the stop exactly as it is">save the reason</button>
    </div>
    ${applied.chosen ? `<div class="note" style="margin-bottom:.4rem">on record: ${applied.stopPct != null ? pct(applied.stopPct) : 'no stop'}${applied.why ? ` — ${esc(applied.why)}` : ' — no reason recorded'}${applied.utc ? ` (${esc(String(applied.utc).slice(0, 10))}${applied.by ? ', ' + esc(applied.by) : ''})` : ''}</div>` : '<div class="note warn" style="margin-bottom:.4rem">no choice about the stop has been recorded yet</div>'}
    <div class="row"><button id="stopRun" class="pri" ${busy ? 'disabled' : ''}>Tune protective stop (full history)</button>
      <span class="note">currently applied on the trading machine: ${applied.stopPct != null ? `<span class="pos">${pct(applied.stopPct)}</span>` : 'none'}</span></div>
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
      <label class="f">run A<select id="cmpA" style="min-width:20rem">
        ${cmpSrc.map((s) => cmpOpt(s).replace('>', s.id === pickedRun ? ' selected>' : '>')).join('')}
      </select></label>
      <label class="f" title="leave B empty only for a run whose window layout is 'both' — that run compares its own two arms. Any other pairing needs a second run.">run B<select id="cmpB" style="min-width:20rem">
        <option value="">— empty: compare a 'both' run's own two sides —</option>
        ${cmpSrc.map(cmpOpt).join('')}
      </select></label>
      <button id="cmpGo" ${cmpSrc.length ? '' : 'disabled'}>Compare</button>
      <span class="note">${cmpSrc.length ? `${cmpSrc.length} comparable run(s)` : 'no run on this box carries comparable rows yet'}</span></div>
    <div id="cmpOut"></div>
  </div>`;
  function renderStopResult(s) {
    const cc = s.counts || {};
    return `<p><b>${esc(s.bookId)}</b>: tightest no-winner-lost stop <span class="pos">${pct(s.stopPct)}</span> —
      ${cc.winners || 0} winners / ${cc.losers || 0} losers over ${cc.priced || 0} entries.</p>
      <div class="scrollx"><table><thead><tr>${cth('give up top winners','giveUp')}${cth('stop','stopPct')}${cth('winners cut','winnersCut')}${cth('winner $ given up','winnerGiven')}${cth('losers cut','losersCut')}${cth('loss-side $','lossSide')}${cth('NET $','netUsd')}<th></th></tr></thead><tbody>
      ${(s.curve || []).map((c) => `<tr><td>${c.sacrificeTopWinners}</td><td>${pct(c.stopPct)}</td><td>${c.winnersForfeited}</td>
        <td class="neg">${usd(-Math.abs(c.winnerProfitForfeitedUsd || 0))}</td><td>${c.losersCut}</td>
        <td class="${(c.loserPnlDeltaUsd || 0) >= 0 ? 'pos' : 'neg'}">${usd(c.loserPnlDeltaUsd)}</td>
        <td class="${(c.netPnlDeltaUsd || 0) >= 0 ? 'pos' : 'neg'}"><b>${usd(c.netPnlDeltaUsd)}</b></td>
        <td>${s.bookId === 'F1' ? `<button data-stop="${c.stopPct}">apply to the live rule</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="note">NET = winner $ given up + loss-side $ vs no stop; positive means the stop helps. Apply buttons exist
        only for the running engine; for a lab row the number informs the greenlight instead.</p>`;
  }
  function renderConvResult(c) {
    const n = c.null || {};
    return `<p><b>${esc(c.bookId)}</b> over ${c.entries} priced entries: flat ${usd(c.flatUsd)} vs ladder <b>${usd(c.ladderUsd)}</b>
      — uplift <b class="${(c.upliftUsd || 0) >= 0 ? 'pos' : 'neg'}">${usd(c.upliftUsd)}</b>.</p>
      <div class="scrollx"><table><thead><tr>${cth('agreement','agreement')}${cth('mult','mult')}${cth('trades','trades')}${cth('wins','wins')}${cth('win %','winPct')}${cth('flat $','flatUsd')}${cth('ladder $','ladderUsd')}</tr></thead><tbody>
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
  // EVERY path that writes the stop carries the reason from the box on the page.
  // Nothing here may post without it — that is what made the field reachable
  // only from a script.
  const stopWhy = () => { const el = $('#stopWhy'); return el ? el.value.trim() : ''; };
  const applyStop = async (stopPct) => {
    const out = await tryPost('api/pilot/stop-apply', { stopPct, why: stopWhy() });
    if (out) drawTune();
  };
  const wsv = $('#stopWhySave');
  if (wsv) wsv.onclick = async () => {
    // Re-sends the stop UNCHANGED with the new wording, so editing the reason
    // can never move the number by accident.
    const out = await tryPost('api/pilot/stop-apply', { stopPct: applied.stopPct ?? null, why: stopWhy() });
    if (out) drawTune();
  };
  const cust = $('#stopCustomApply');
  if (cust) cust.onclick = () => {
    const v = Number($('#stopCustomPct').value);
    if (!Number.isFinite(v) || v <= 0 || v >= 100) { alert('a stop is a percent between 0 and 100'); return; }
    // THE FLOOR, stated here as well as on the server (2026-08-18). The endpoint
    // has always refused below it with a clear 400, so nothing silently
    // succeeded — but the box advertised min="0.1", offering a value the backend
    // rejects, and the refusal only arrived after a round trip. Same rule as the
    // run-id pickers (QC-145): where the answer is knowable on the page, refuse
    // on the page, in the same words the server uses.
    //
    // The number is the SERVED one now (2026-08-23), not a copy: the server
    // derives it from the fee, and a literal here would be right only until the
    // fee moved.
    if (v < 100 * floorPct) {
      alert(`A ${v}% stop is below the ${floorPc} floor.\n\nThat floor is twice the ${tripPc} it costs to trade in `
        + `and out at ${feePc} each way. Tighter than the round trip and a triggered stop is a guaranteed net loss; `
        + 'tighter than the floor and it stops out on hourly noise rather than on a real adverse move.\n\n'
        + `Choose ${floorPc} or wider, or use "No stop (clear)".`);
      return;
    }
    // BOTH of these write the LIVE engine's risk parameter, whatever the scan
    // target above says — that picker chooses what is SCANNED, and there is no
    // endpoint that applies a stop to a saved book. Applying went through with no
    // confirmation at all, so a stray click changed a live-money setting silently
    // (audit 2026-08-17). The scan target is named in the prompt so the gap
    // between "what I was looking at" and "what I just changed" cannot pass
    // unnoticed.
    if (!confirm(`Apply a ${v.toFixed(2)}% protective stop to the LIVE engine?\n\n`
      + 'This writes F1\'s own risk parameter. The scan target above chooses what is SCANNED — '
      + 'it does not change what this button applies to.')) return;
    // the box is in PERCENT, the engine wants a FRACTION
    applyStop(v / 100);
  };
  const clr = $('#stopClear');
  if (clr) clr.onclick = () => {
    if (!confirm('Clear the LIVE engine\'s protective stop?\n\nthe live rule will run with NO fixed stop until one is applied again — a position then rests on its scheduled exit alone.')) return;
    // NULL, not 0. The endpoint's guard is `if (raw != null && raw !== '')` and
    // then refuses `v <= 0`, so a 0 took the positive-value path and came back
    // 400 every time: the stop could not be cleared from this tab at all. The
    // frozen Bracket lab sends null and always has (audit 2026-08-17).
    applyStop(null);
  };
  // scanBody is null when the picker has nothing selectable (every setup and
  // book already carries a protective stop, or the list failed to load). Say so
  // instead of posting an empty request and surfacing the server's 400 — the
  // operator did not type anything wrong, there is simply nothing to aim at.
  const noTarget = () => { alert('No scan target: nothing in the list is without a protective stop, '
    + 'so there is nothing to tune. A breakout cell already stops at its opposite rail.'); };
  $('#stopRun').onclick = async () => {
    if (!scanBody) return noTarget();
    if (!confirm('Run the full-history stop scan? (minutes; one heavy scan at a time)')) return;
    const out = await tryPost('api/pilot/stopsweep', scanBody); if (out) { clearTimeout(tunePoll); tunePoll = setTimeout(drawTune, 1500); }
  };
  $('#convRun').onclick = async () => {
    if (!scanBody) return noTarget();
    if (!confirm('Run the full-history conviction sweep? (minutes; one heavy scan at a time)')) return;
    const out = await tryPost('api/pilot/convictionsweep', scanBody); if (out) { clearTimeout(tunePoll); tunePoll = setTimeout(drawTune, 1500); }
  };
  $('#view').querySelectorAll('button[data-stop]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm(`Apply a ${(Number(b.dataset.stop) * 100).toFixed(2)}% protective stop to the LIVE engine?`)) return;
      const out = await tryPost('api/pilot/stop-apply', { stopPct: Number(b.dataset.stop), why: stopWhy() }); if (out) drawTune();
    };
  });
  // A running scan used to say "running…" and then never change: the result
  // only appeared if the operator happened to reload. It refreshes itself now,
  // ONE cancellable chain, at 30s — these scans take minutes, and checking a
  // job faster than it could plausibly finish is waste, not diligence.
  if (busy && tab === 'tune') { clearTimeout(tunePoll); tunePoll = setTimeout(drawTune, 30000); }
  $('#cmpGo').onclick = async () => {
    const a = $('#cmpA').value;
    if (!a) { $('#cmpOut').innerHTML = '<span class="warn">pick run A first</span>'; return; }
    // Leaving B empty is only meaningful for a run that holds BOTH arms — that
    // run compares its own two sides. For any other run the server refuses, and
    // the page already knows which layout each run carries, so say it here in
    // plain words instead of relaying a 400.
    const aSrc = cmpSrc.find((s) => s.id === a);
    if ($('#cmpB').value === a) {
      $('#cmpOut').innerHTML = '<span class="warn">run A and run B are the same run — a comparison needs two.</span>';
      return;
    }
    if (!$('#cmpB').value && aSrc && aSrc.windowLayout !== 'both') {
      $('#cmpOut').innerHTML = `<span class="warn">${esc(a)} holds one window layout (${esc(aSrc.windowLayout)}),
        so there is no second side of it to compare against — pick a run B.</span>`;
      return;
    }
    try {
      const d = await post('api/bracketlab/compare', { a, b: $('#cmpB').value || null });
      $('#cmpOut').innerHTML = `<pre>${esc(JSON.stringify(d, null, 1).slice(0, 20000))}</pre>`;
    } catch (e) { $('#cmpOut').innerHTML = `<span class="warn">${esc(e.message)}</span>`; }
  };
  if (stop.status === 'running' || conv.status === 'running') setTimeout(() => { if (tab === 'tune') drawTune(); }, 4000);
}


// ---- Help: every control on every screen, in plain language -----------------
//
// Owner order, 2026-08-21. There were no help pages at all and fourteen
// controls on the Sweep tab had not even hover text, so the only way to find
// out what anything did was to ask — and be answered in words that are not on
// the screen.
//
// The pictures of the controls are DEAD COPIES. Every one is disabled and
// carries no id, so nothing here can be pressed, changed, or mistaken for the
// real control. That matters more than it sounds: a help page that looks
// operable is a help page somebody will try to operate.
function helpReplica(c) {
  const dead = 'disabled style="opacity:.85;pointer-events:none"';
  const choices = (name, n) => {
    const list = (HELPVOCAB && HELPVOCAB[name]) || [];
    return list.slice(0, n).map((o) => `<option>${esc(o.label)}</option>`).join('')
      + (list.length > n ? `<option>… ${list.length - n} more</option>` : '');
  };
  if (c.type === 'checkbox') {
    return `<label class="c"><input type="checkbox" ${dead}> ${esc(c.label)}</label>`;
  }
  if (c.kind === 'button') {
    return `<button ${dead}>${esc(c.label)}</button>`;
  }
  if (c.type === 'select') {
    return `<label class="f">${esc(c.label)}<select ${dead}>${
      c.choices ? choices(c.choices, 4) : '<option>…</option>'}</select></label>`;
  }
  const width = c.type === 'number' ? '4.5rem' : (c.label.length > 24 ? '16rem' : '9rem');
  return `<label class="f">${esc(c.label)}<input ${dead} type="${esc(c.type === 'month' ? 'month' : 'text')}"`
    + ` style="width:${width}" value=""></label>`;
}

let HELPVOCAB = null;
let HELPMAP = null;

async function drawHelp() {
  if (!HELPVOCAB) HELPVOCAB = await apiOr('api/vocabulary', {});
  if (!HELPMAP) HELPMAP = await apiOr('api/screen-controls', null);
  const H = window.HELP || {};
  if (!HELPMAP) {
    $('#view').innerHTML = '<div class="panel empty">The list of controls could not be read, '
      + 'so this page cannot be sure it is describing everything. Nothing is shown rather than '
      + 'showing a part of it and looking complete.</div>';
    return;
  }

  const sections = Object.entries(HELPMAP).map(([key, t]) => {
    const help = H[key] || { controls: {} };
    const rows = t.controls.map((c) => {
      const e = (help.controls || {})[c.id];
      return `<tr>
        <td style="width:22rem;vertical-align:top;padding:.45rem .6rem .45rem 0">${helpReplica(c)}</td>
        <td style="vertical-align:top;padding:.45rem 0">${e
    ? `${esc(e.what)}${e.more ? `<div class="muted" style="margin-top:.25rem">${esc(e.more)}</div>` : ''}`
    : '<span class="warn">Not described yet. That is a fault in this page, not in the control.</span>'}</td>
      </tr>`;
    }).join('');
    // THE OVERVIEW COMES FIRST. A list of controls says what each button does
    // and never says what the screen is DOING — the owner asked what a sweep
    // actually performs and the page had no answer anywhere (owner, 2026-08-21).
    // Paragraphs are split on blank lines so a long explanation reads as prose
    // rather than as one wall.
    const how = (help.how || []).map(([heading, body]) => `<div style="margin:.7rem 0">
      <div style="font-weight:600;font-size:.86rem;margin-bottom:.25rem">${esc(heading)}</div>
      ${String(body).split('\n\n').map((para) =>
    `<p class="note" style="font-size:.82rem;margin:.3rem 0">${esc(para)}</p>`).join('')}</div>`).join('');
    return `<div class="panel">
      <h3 style="margin-top:0">${esc(t.label)}</h3>
      ${help.intro ? `<p class="note" style="font-size:.82rem">${esc(help.intro)}</p>` : ''}
      ${how}
      ${how ? '<div style="font-weight:600;font-size:.86rem;margin:.9rem 0 .2rem">Every control on this screen</div>' : ''}
      <table style="width:100%;border-collapse:collapse">${rows}</table></div>`;
  }).join('');

  $('#view').innerHTML = `<div class="panel">
      <h3 style="margin-top:0">Help — what every control on every screen does</h3>
      <p class="note">One entry for every box, tick, dropdown and button on the seven screens.
        The list of controls is read from the screens themselves, so nothing can be left out of it
        quietly: a control with no description says so, in place, rather than being missing.</p>
      <p class="note"><b>Everything shown below is a dead copy.</b> None of it can be pressed or
        changed — it is a picture of the control, put beside its description so you can see which
        one is being talked about. The real ones are on their own tabs.</p>
    </div>${sections}`;
}

// ---- Greenlight -----------------------------------------------------------------
async function drawGreenlight() {
  const doc = await loadPicked();
  const sel = getSelRow(doc);
  const gls = await apiOr('api/live/greenlights', ({ greenlights: [] }));
  $('#view').innerHTML = `<div class="panel">
    <h3 style="margin-top:0">Greenlight — the decision that a config is fit to trade</h3>
    <p class="note">Records WHO/WHEN/WHY with the exact frozen config, engine version, and the campaign's whole
      evidentiary chain. The config then appears on the Trade tab (both sides) for activation. Only greenlighted
      configs ever trade — no hand-built live configs, ever.</p>
    ${sel ? `<div class="row" style="align-items:flex-end">
      <span class="note" style="flex:1 1 auto;min-width:0">selected: <b>${esc(comboOf(sel))}</b> ${esc(sel.geometry)} ${esc(sel.decision)} q${sel.quorum} ${sel.tHours}h
        — test ${money(sel.pnl)}${sel.holdout ? ` · held-back ${money(sel.holdout.pnl)}` : ''}</span>
      <label class="f" style="flex:none">anchor<select id="glTarget" title="WHICH cell gets greenlighted. 'declared cell' is the one fixed before the run — no shopping. 'best cell' is the highest scorer, which is the best of ~1,260 tries and flatters itself. 'widest region' is the MIDDLE of the widest run of neighbouring settings that all made money — chosen by depth inside the region, never by its score, so the shopped peak cannot sneak back in.">${vocabOptions('greenlightAnchor', 'declared')}</select></label>
    </div>
    <div class="row" style="margin-top:.4rem;align-items:flex-end">
      <label class="f" style="flex:1">why — the decision record (required)<input id="glWhy" style="width:100%"
        placeholder="e.g. money screen + Tool 2 null + held-back all cleared; stop scanned; conviction priced"></label>
      <button id="glGo" class="pri">GREENLIGHT this config</button></div>`
    : '<span class="note">select a row on Boards first — a greenlight is minted from the selected row.</span>'}
  </div>
  <div class="panel"><h3 style="margin-top:0">Existing greenlights</h3>
    <table><thead><tr>${cth('id','glId')}${cth('pair','asset')}${cth('campaign','campaign')}${cth('why','why','text-align:left')}${cth('fee','fee')}${cth('minted','minted')}${cth('state','state')}</tr></thead><tbody>
    ${(gls.greenlights || []).map((g) => `<tr><td>${esc(g.id)}</td><td>${esc(g.configSnapshot?.combo?.trade || '—')}</td>
      <td class="muted">${esc(g.campaign || '—')}</td><td style="text-align:left" class="muted">${esc((g.why || '').slice(0, 90))}</td>
      <td class="${g.sourceRun && g.sourceRun.feePerLeg != null ? '' : 'muted'}">${g.sourceRun && g.sourceRun.feePerLeg != null
    ? `${(100 * g.sourceRun.feePerLeg).toFixed(3)}%` : '—'}</td>
      <td>${esc((g.createdUtc || '').slice(0, 16))}</td><td>${g.revoked ? '<span class="warn">nuked</span>' : '<span class="pos">greenlighted</span>'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">none yet</td></tr>'}
    </tbody></table>
    <p class="note"><b>fee</b> is what the run behind each one was priced at, per trade and each way. It is not a
      setting here — it is what the evidence was found under, and a config sent to the Trade tab starts out priced
      at it and can be changed there. A dash means the run predates the fee being recorded.
      Activation, deactivation and nuking live on the <a href="trade.html">Trade tab</a>.</p></div>`;
  const go = $('#glGo');
  if (go) go.onclick = async () => {
    const why = $('#glWhy').value.trim();
    if (!why) { alert('why is required — the decision record is the point.'); return; }
    if (!confirm(`Greenlight ${sel.trade} ${sel.geometry} (${$('#glTarget').value} cell)?`)) return;
    const out = await tryPost('api/live/greenlight', { runId: doc.id, target: $('#glTarget').value, why });
    if (out) { alert(`Greenlighted: ${out.greenlight.id}\n\nIt is now on the Trade tab, both sides.`); drawGreenlight(); }
  };
}

// draw() RETURNS the section's promise. It used to return undefined while every
// section function was async, so `draw().then(...)` — which is how "copy settings
// into the form" waits for the Sweep form to exist before filling it — threw
// "Cannot read properties of undefined (reading 'then')" every single time. The
// tab switched, the exception was swallowed by the console, and not one field
// was filled: a button that looked like it worked and did nothing (found by the
// runtime harness, 2026-08-17).
function draw() {
  renderTabs(); renderStrip();
  // Reset the failure log for THIS render, then band the section afterwards if
  // any read failed. Without this a panel that lost its data renders its
  // empty state, which reads as "there is nothing" rather than "I could not
  // ask" — the two look identical and mean opposite things.
  fetchFailures = [];
  const band = () => {
    if (!fetchFailures.length) return;
    const v = $('#view');
    if (!v) return;
    const seen = [...new Set(fetchFailures)];
    const el = document.createElement('div');
    el.className = 'panel';
    // Same marker its Trading-tab twin carries, so the outage banner can be
    // identified by what it IS rather than by matching its wording (2026-08-18).
    el.dataset.role = 'incomplete';
    el.style.borderColor = 'var(--neg)';
    el.innerHTML = `<b class="neg">THIS SCREEN IS INCOMPLETE.</b> ${seen.length} read(s) failed, so any panel
      below that looks empty may be missing data rather than reporting none. Reload once the service is back;
      do not read an empty panel here as a result.<div class="note" style="margin-top:.3rem">${
  seen.map((x) => `<div>${esc(x)}</div>`).join('')}</div>`;
    v.prepend(el);
  };
  const section = tab === 'data' ? drawData()
    : tab === 'sweep' ? drawSweep()
      : tab === 'boards' ? drawBoards()
        : tab === 'verify' ? drawVerify()
          : tab === 'history' ? drawHistory()
            : tab === 'tune' ? drawTune()
              : tab === 'greenlight' ? drawGreenlight()

                : drawHelp();
  // A section that THROWS must say so. Without the rejection arm the promise
  // rejects, the banner never runs, and #view keeps whatever was there — on a
  // first load that is nothing at all, so a hard failure renders as a blank
  // page with no explanation, which is the worst of the three outcomes.
  return Promise.resolve(section).then((r) => { band(); return r; }, (err) => {
    fetchFailures.push(`the ${tab} section stopped rendering: ${err && err.message ? err.message : err}`);
    const v = $('#view');
    if (v && !v.innerHTML.trim()) v.innerHTML = '<div class="panel empty">This section could not be drawn.</div>';
    band();
    return null;
  });
}
function tickClock() { $('#utcClock').textContent = new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC'; }
tickClock(); setInterval(tickClock, 1000);
// The choice lists must be in hand before anything that uses them is drawn.
// On first load, land where this tab was left rather than at the top.
loadVocabulary().then(draw).then(() => restoreScroll(tab));
})();
