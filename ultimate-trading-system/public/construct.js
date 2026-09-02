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
// THE DIAL KEYS, WITH WHAT SWEEP CALLS THEM (owner order, 2026-09-01). The
// Funnel prints a dial by the name the engine holds it under -- dMult, agreePct
// -- and those are not names the owner can point at. The screen name goes in
// brackets after it, so the row reads as the box it came from.
//
// Every label here is the text of a control in drawSweep(), and
// theDialNamesCarryTheirSweepLabel checks both directions: a dial with no entry
// fails, and an entry naming a label Sweep does not show fails. A rename on
// Sweep therefore breaks the suite instead of quietly leaving the Funnel
// pointing at a box that is gone.
const DIAL_ON_SWEEP = {
  dMult: 'd',
  tHours: 't',
  trailMult: 'trail',
  armMult: 'arm',
  bandMode: 'band % (or auto)',
  agreePct: 'share',
  agreeCopy: 'one voice at',
  agreePersist: 'hold',
  decision: 'decision',
  weekdaysOnly: '24/5',
  entry: 'entry',
  gate: 'gate',
  agreeRule: 'quorum by',
  agreeBar: 'quorum bar',
  agreeBoth: 'both kinds',
};
const fDialLabel = (d) => (DIAL_ON_SWEEP[d] ? `${d} (${DIAL_ON_SWEEP[d]})` : String(d));

const COL = {
  // Funnel
  fDialName: 'one of the settings a sweep can be told to vary. This table lists only the dials this run swept more than one value of. A dial swept at a single value has nothing to measure against anything, so it is named on the "Not measurable here" line below instead of appearing here as flat.',
  fAcrossUnit: 'one of the other coin-and-shape units of this set. The rule built on this walk was applied to that unit\'s own records.',
  fAcrossSurvivors: 'how many of that unit\'s settings the rule keeps, out of all it has.',
  fGridCorner: 'the first dial down the side, the second across the top. Each square is the average test money of the settings that carry both values, with the count in brackets when the square is thin.',
  fGridValue: 'one value of the second dial. Read down this column to see how the first dial behaves at this value of the second.',
  fRegionDial: 'a dial the widest region spans. Keeping the region writes these edges into the rule.',
  fRegionFrom: 'the lowest value of this dial inside the region, or the one value a word-valued dial takes there.',
  fRegionTo: 'the highest value of this dial inside the region.',
  fCheck: 'how many of this dial\'s values make more money than that same value on every scrambled copy of the table (or sit above both halves\' averages, when the set kept no copies). That is the test step 2 applies to each value, so a bold row here is a row with something to keep on step 2. Zero means greyed: this dial may move the money, but not in the direction a forecast is for.',
  fMovement: 'how far apart this dial\'s values sit, measured against how much the result varies anyway. THE ORDERING IS THE FINDING - at this many rows every dial shows some movement, and the size of the number is a claim only against the split-half beside it.',
  fRange: 'the gap in test dollars between this dial\'s best-averaging value and its worst. A ratio with no magnitude beside it cannot be read.',
  fValues: 'how many different values of this dial the run actually swept. One value is not a comparison, and a dial with one value is listed separately rather than shown as flat.',
  fEven: 'whether each value of this dial was swept the same number of times. Grouping by one dial only averages the others out when it was; below about two thirds, this movement is partly some other dial\'s wearing this one\'s name.',
  fValue: 'one setting of the dial being read.',
  fSettings: 'how many settings sit behind this number. A figure built from two settings looks exactly like one built from two thousand, and it swings much further.',
  fAvgTest: 'average test-window dollars across the settings behind this row. TEST money, never held-back - the held-back window is opened once, at the cut, on what survives.',
  fGridCell: 'average test dollars for the settings holding both this column value and this row value. Greyed with a count beside it when fewer settings sit behind it than the thin-square floor.',
  fSlice: 'one coin, chunk shape, third of the window or dial value the surviving settings are being compared across - whichever of those this set can offer.',
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
  fee: 'what a trade was assumed to cost on the run behind this greenlight, as a percent of the money in the '
    + 'position, charged each way. It is not a setting here — it is what the evidence was found under, and a config '
    + 'sent to the Trade tab starts out priced at it and can be changed there. A dash means the run predates the '
    + 'fee being recorded.',
  campaign: 'the named line of work the source sweep belonged to.',
  why: 'the reason recorded at greenlight time. It is the decision record and is not editable afterwards.',
  minted: 'when the config was greenlighted, UTC.',
  state: 'whether this config is running on either side, and whether it has been revoked.',
  // Boards — every coin of every configuration
  coinCfg: 'the settings fixed before the run, by their label. The same label appears once per coin here.',
  coin: 'the traded pair this row scores, with its chunk shape. The whole-configuration table above averages across all of these; this row is one coin on its own.',
  coinShare: 'of the head-to-heads on THIS coin between the real decisions and their scrambled copies, the share the real ones won. Half is what guessing scores. Read it with the comparisons column: a high share on few comparisons is chance wearing a score.',
  coinPairs: 'how many head-to-heads are behind the share — every real look on this coin against every one of its scrambled copies. More comparisons make the share worth more.',
  coinMoney: 'this configuration\'s held-back money on this coin, AVERAGED over the rows counted in the rows column — the sum divided by the rows that recorded a held-back result (all of them, on a finished run). Averaging is what lets a coin with 16 rows and one with 8 be read side by side.',
  coinTrades: 'the average number of held-back trades per row on this coin — how much trading is behind each row\'s held-back result. An average near zero means the money rests on a handful of trades.',
  coinVsLong: 'this configuration\'s held-back money against just holding the coin over the same window, averaged over the rows that recorded the comparison. Positive means it beat holding, on average.',
  coinRows: 'how many real looks this configuration recorded on this coin.',
  coinRecords: 'opens this row\'s records below it — the rows counted in the rows column, each one a promoted unit\'s own scoring of this configuration on this coin, read straight from the stored rows.',
};
// cth(label, key[, style]) — a heading always carries its own description.
const cth = (label, key, style) => `<th${style ? ` style="${style}"` : ''}${COL[key] ? ` title="${esc(COL[key]).replace(/"/g, '&quot;')}"` : ''}>${label}</th>`;

// THE PER-ASSET TABLE, hoisted out of the panel that used to own it (owner
// order, 2026-08-23). The ranked list no longer carries example rows — a run
// declaring 2,772 configurations made that a 99 MB reply — so the rows are
// fetched when a line is opened, and the opened table and the panel have to be
// drawn by the SAME function or they will come to disagree about what a row
// means.
// The old per-asset row renderer and its more-note are RETIRED with the row
// walk that fed them (owner go, 2026-08-26) — an opened line now draws
// per-coin summaries with coinHeadHtml/coinRowHtml, the same columns the
// every-coin table draws, from the same saved tally.


// (The paging bar, the replication ranking helpers and the whole
// remembered-view machinery that used to sit here belonged to the original
// Sweep and Boards screens. Those screens were removed on 2026-08-28 by owner
// order and this code went with them: every table on the surviving pair pages
// through bPager and remembers its own view through bSaveView.)

// theme — Constructing remembers its OWN setting (owner, 2026-08-17). It used to
// share the Trading page's key; each tab now keeps its own.
//
// PUT BACK 2026-08-28: this sat among the deleted screens' helpers and went out
// with them, which left the theme button on the page doing nothing at all.
const root = document.documentElement;
root.setAttribute('data-theme', localStorage.getItem('cx-theme') || 'dark');
$('#themebtn').onclick = () => {
  const n = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', n); localStorage.setItem('cx-theme', n);
};

// ---- navigation ------------------------------------------------------------
// EIGHT TABS, AND ONLY ONE OF EACH (owner order, 2026-08-28: "get rid of the
// Sweep, Sweep2, Boards, and Boards2 tabs. make the existing 'Sweep3' just
// 'Sweep' and the existing 'Boards3' just 'Boards'. fix *EVERY* reference in
// the code to those obsolete items"). Sweep and Boards below ARE the
// three-stage system: the two earlier working screens and the two drawings
// they were designed on are gone, and nothing is named after them.
const TABS = [['data', 'Data'], ['sweep', 'Sweep'], ['boards', 'Boards'], ['funnel', 'Funnel'],
  ['verify', 'Verify'],
  ['history', 'History'], ['tune', 'Tune'], ['greenlight', 'Greenlight'], ['help', 'Help']];
let tab = localStorage.getItem('cx-tab') || 'sweep';
// the working selection: a saved run + its selected row ride across sections
let pickedRun = localStorage.getItem('cx-run') || null;
// ...and the one run document loadPicked() holds, so four screens asking for it
// in a row do not fetch it four times.
//
// PUT BACK 2026-08-29. This declaration sat among the deleted screens' helpers
// and went out with them, and nothing noticed because nothing here runs under a
// module that would have flagged it. loadPicked() READS it before it assigns,
// so every call threw `pickedDoc is not defined` — which is every draw of
// Verify, History, Tune and Greenlight. The tab highlighted, the renderer died
// on its first line, and #view kept whatever screen was there before. The owner
// found it by pressing Verify and getting Boards under a Verify highlight.
let pickedDoc = null;

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

// ONLY THE OWNER'S OWN SCROLLING WRITES THE MEMORY (owner order,
// 2026-08-26: "the opened table stays open, but the scroll location is
// lost. fix that throughout"). Scrolling a page that is still short lands
// clamped at the bottom of what exists — and that landing fires a scroll
// event exactly like a hand on the wheel, which OVERWROTE the remembered
// place before the content was rebuilt. So every move the page makes
// itself — a restore, a redraw — holds the memory shut for a moment, and
// the listener writes only when no hold is on.
let scrollMemoryHeldUntil = 0;
function holdScrollMemory() { scrollMemoryHeldUntil = Date.now() + 600; }

function restoreScroll(t) {
  let y = 0;
  try { y = Number(localStorage.getItem(scrollKeyFor(t))) || 0; } catch (_) { y = 0; }
  // Two frames, not one. The content has only just been put on the page and the
  // browser has not laid it out yet — scrolling before it has means scrolling a
  // page that is still short, which quietly lands at the bottom of nothing.
  holdScrollMemory();
  requestAnimationFrame(() => requestAnimationFrame(() => { holdScrollMemory(); window.scrollTo(0, y); }));
}

// ── THE WAIT BOX (owner order, 2026-08-30) ──────────────────────────────────
// "going back and forth between the Sweep and Boards tabs and even picking new
// sets of filters on the 3.A and 3.B tables is taking a long time to redraw."
//
// Until a redraw lands, the OLD page is still on screen, unchanged. So a press
// that worked and a press that did nothing look exactly alike — and the
// natural response is to press again, which queues a SECOND slow redraw behind
// the first. This says which it was. It does not make the wait shorter; it
// makes it visible, and it swallows the clicks that would have made it longer.
//
// A COUNT, NOT A FLAG. The pagers, the sorts, the filters, the fold and the tab
// strip all call a renderer straight, and two can be in the air at once; one
// finishing must not take away a box the other still needs.
let waitDepth = 0;
let waitTimer = null;
let waitSilent = false;   // set only by the every-few-seconds ask, below
function waitBox(on) { const el = $('#waitbox'); if (el) el.hidden = !on; }
function waitStart() {
  if (waitDepth++ > 0) return;
  // SHOWN LATE, ON PURPOSE. A redraw that lands in a blink must not flash a box
  // on the way past. And because a timer only runs when the page is otherwise
  // idle, a redraw that never lets go of the page never shows one either —
  // which is right, because the browser could not have drawn it anyway.
  if (!waitTimer) waitTimer = setTimeout(() => { waitTimer = null; if (waitDepth > 0) waitBox(true); }, 150);
}
function waitEnd() {
  if (--waitDepth > 0) return;
  waitDepth = 0;
  if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
  // Two frames, for the same reason restoreScroll waits two: the new content
  // has been put on the page but not laid out or scrolled to yet. Taking the
  // box away on the spot uncovers a page that is still jumping.
  requestAnimationFrame(() => requestAnimationFrame(() => { if (waitDepth === 0) waitBox(false); }));
}
// WRAPPED AT THE DEFINITION, never at the call. There are sixteen places a
// renderer is called from and one missed is a box that never clears. `finally`
// for the same reason: a renderer that throws is a real case — draw() carries a
// whole arm for it — and a thrown draw must not leave the screen covered.
const waitWrap = (fn) => async (...a) => {
  const quiet = waitSilent;            // read here, before the first await
  if (!quiet) waitStart();
  try { return await fn(...a); } finally { if (!quiet) waitEnd(); }
};

// Keep it current while reading, so a reload lands in the right place too.
// Throttled to once a frame: a scroll event fires far more often than that and
// there is nothing to gain from writing every one of them.
let scrollPending = false;
window.addEventListener('scroll', () => {
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => {
    scrollPending = false;
    if (Date.now() < scrollMemoryHeldUntil) return;   // the page moved itself
    rememberScroll(tab);
  });
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
  // The flag's box sits ON the text bottom (owner order, 2026-08-26): the
  // class's middle-alignment centred this bordered box on the small text's
  // line and hung it below the release and time text beside it.
  el.innerHTML = `release ${esc(s.engineVersion || '')} · planted check:
    <span class="badge ${b.cls}" id="stripBadge" style="vertical-align:text-bottom" title="${esc(b.tip)}">${esc(b.text.toUpperCase())}</span>`;
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
let tunePoll = null;

// WHAT IS IN THE STAGE BOXES SURVIVES A SCREEN FLIP (owner order,
// 2026-08-27: "not lose the values loaded to the stage 1/2/3 areas on screen
// flips — that stuff needs to be left as-is"). The same standing rule the
// old Sweep form kept, by the same mechanism: every box and tick on this page,
// found by id so a control added tomorrow is covered, remembered on every
// change and written back on every draw.
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

// Milliseconds as words for the progress line — '38s', '4m', '2h 05m'.
function msWords(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

let swPoll = null;

function swSetOptions(sets, stage, selected) {
  const list = sets.filter((x) => x.stage === stage && (x.status === 'done'));
  if (!list.length) return `<option value="">— no finished stage ${stage} record set on this box —</option>`;
  return list.map((x) => `<option value="${esc(x.id)}"${x.id === selected ? ' selected' : ''}>${esc(x.name)} — ${esc((x.createdAt || '').slice(0, 10))} — ${x.plan.units.toLocaleString()} units${x.stage === 1 ? ', votes kept' : ''}</option>`).join('');
}

async function swProgress() {
  const el = $('#swProg');
  if (!el) return;
  const st = await apiOr('api/stagesets', null);
  if (!st) { el.innerHTML = '<span class="warn">the record-set list could not be read</span>'; return; }
  // the start buttons sleep while a run is going — one heavy job at a time,
  // said on the button instead of by a refusal after the press
  const going = !!st.running;
  for (const bid of ['swGo1', 'swGo2', 'swGo3']) {
    const b = $(`#${bid}`);
    if (b) { b.disabled = going; b.title = going ? 'a stage run is going — one heavy job at a time. The button wakes when it lands.' : ''; }
  }
  if (!st.running) {
    el.innerHTML = 'nothing is running';
    if (swPoll) { clearInterval(swPoll); swPoll = null; }
    return;
  }
  const row = (st.sets || []).find((x) => x.id === st.running);
  // The whole story on one line: what is going, how far through its cycles,
  // the percent, and about how long is left (owner order, 2026-08-27) —
  // refreshed every few seconds by the poll below.
  const pf = (row && row.perf) || {};
  // WHAT A LONG RUN HAS TO SAY (owner order, 2026-08-29: "no idea if it will
  // take 10 hours or 10 minutes to get to 1% ... so long runs aren't pure
  // guesswork"). Four things, in the order they get looked at:
  //
  //   how far through THIS phase · how fast · when it lands · how long it has
  //   been going
  //
  // The percentage is of the phase in progress, not of a number belonging to a
  // phase that has already finished — which is how "reading the kept votes:
  // 10/10 units · 0% of 332,572,800 pricings" came to be on the screen. And the
  // finish is a TIME OF DAY, worked out on the service where the clock that
  // measured the rate is, because a duration has to be added to the clock by
  // hand before it means anything.
  const done = Number(pf.phaseDone);
  const total = Number(pf.phaseTotal);
  const pct = total > 0 ? Math.floor((done / total) * 100) : null;
  const perMs = done > 0 ? pf.phaseElapsedMs / done : null;
  const rate = () => {
    if (!perMs) return null;
    const perHour = 3600000 / perMs;
    if (perHour >= 1) return `${perHour < 10 ? perHour.toFixed(1) : Math.round(perHour).toLocaleString()} ${esc(pf.phaseWord || 'units')}/hour`;
    return `${msWords(perMs)} per ${esc(String(pf.phaseWord || 'unit').replace(/s$/, ''))}`;
  };
  const lands = () => {
    if (pf.phaseEndsAtMs == null) return null;
    const d = new Date(pf.phaseEndsAtMs);
    if (Number.isNaN(d.getTime())) return null;
    const hhmm = d.toISOString().slice(11, 16);
    const days = Math.floor((pf.phaseEtaMs || 0) / 86400000);
    return `lands about <b>${hhmm} UTC</b>${days >= 1 ? ` (+${days}d)` : ''}`;
  };
  const tail = [
    pct != null ? `<b>${pct}%</b>` : null,
    rate(),
    lands(),
    pf.phaseEtaMs != null ? `${msWords(pf.phaseEtaMs)} left` : null,
    pf.phaseElapsedMs ? `${msWords(pf.phaseElapsedMs)} in` : null,
    // A PHASE THAT HAS FINISHED NOTHING CANNOT BE ESTIMATED, and saying so is
    // the whole point: a bare 0% with no rate reads as a stuck job.
    pf.phaseEtaMs == null && pf.phaseTotal
      ? `<span class="muted">no estimate until the first ${esc(String(pf.phaseWord || 'unit').replace(/s$/, ''))} lands</span>` : null,
  ].filter(Boolean).join(' · ');
  el.innerHTML = row
    ? `<b>${esc(row.name)}</b> is going: ${esc(row.progress || '…')}${tail ? ` · ${tail}` : ''} <button id="swStop" class="danger">stop</button>`
    : `a stage run is going (${esc(st.running)})`;
  const stop = $('#swStop');
  if (stop) stop.onclick = async () => { await tryPost(`api/stageset/${st.running}/stop`, {}); swProgress(); };
  if (!swPoll) swPoll = setInterval(swProgress, 4000);
}

// GREEN WHEN A SECTION SHOWS THE PROVENANCE OF THE SECTION BELOW IT, RED AT
// THE POINT OF BREAK (owner order, 2026-08-27). Stage 1's title is judged
// against the stage 1 record set the stage 2 box names; stage 2's against
// the stage 2 record set the stage 3 box names; stage 3 anchors the chain.
// Judged live on every change — set a box back and the title goes green
// again. A section with nothing below it naming a record set is green.
function swProvenance() {
  const sets = swSetsCache || [];
  const rowOf = (id) => sets.find((x) => x.id === id) || null;
  const paint = (sel, ok, why) => {
    const h = $(sel);
    if (!h) return;
    h.style.color = ok ? 'var(--pos)' : 'var(--neg)';
    h.title = ok
      ? 'green: this section shows the provenance of the section below it (or nothing below names a record set yet)'
      : `red: ${why}. Set the boxes back and this goes green again.`;
  };
  const v = (sel) => { const e = $(sel); return e ? e.value : ''; };
  const c = (sel) => { const e = $(sel); return !!(e && e.checked); };

  const s1row = rowOf(v('#swFrom2'));
  if (!s1row) paint('#swH1', true);
  else {
    const p = s1row.params || {};
    const defaults = ((VOCAB && VOCAB.defaultPairs) || []).map((o) => String(o.value));
    const boxUni = (v('#swUni') || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    const wantUni = (boxUni.length ? boxUni : defaults).slice().sort().join(',');
    const setUni = (p.universe || []).slice().sort().join(',');
    const sz = p.sizes || {};
    const geos = p.geometries || [];
    const mismatch = wantUni !== setUni ? 'the universe no longer matches'
      : (c('#swSingles') !== !!sz.singles || c('#swDoubles') !== !!sz.doubles || c('#swTriples') !== !!sz.triples) ? 'the singles / doubles / triples ticks no longer match'
        : (c('#swPermGeom') !== (geos.length > 1) || (!c('#swPermGeom') && geos[0] !== v('#swGeom'))) ? 'the chunk shape no longer matches'
          : v('#swLayout') !== (p.windowLayout || '') ? 'the window layout no longer matches'
            : Number(v('#swNull1')) !== Number(p.nullN) ? 'the null set size no longer matches'
              : c('#swAllData') !== (p.allLoaded !== false) ? 'the all loaded data tick no longer matches'
                : (!c('#swAllData') && (v('#swStart') !== (p.startMonth || '') || v('#swEnd') !== (p.endMonth || ''))) ? 'the start / end months no longer match'
                  : null;
    paint('#swH1', !mismatch,
      `${mismatch} — this section no longer shows the provenance of ${s1row.name}, the record set the stage 2 box reads from`);
  }

  const s2row = rowOf(v('#swFrom3'));
  if (!s2row) paint('#swH2', true);
  else {
    const par = s2row.parent || {};
    const carryBox = Number(v('#swCarry')) || 0;
    const carryMatch = carryBox === 0
      ? (par.carry != null && par.of != null ? par.carry === par.of : true)
      : carryBox === par.carry;
    const mismatch = v('#swFrom2') !== (par.id || '')
      ? `the stage 1 record set named here is not the one ${s2row.name} was carried out of (${par.name || par.id || 'unrecorded'})`
      : (!carryMatch ? 'carry forward no longer matches what was carried' : null);
    paint('#swH2', !mismatch, `${mismatch} — the stage 3 box reads from ${s2row.name}`);
  }

  paint('#swH3', !v('#swFrom3') || !!s2row, 'the stage 2 record set named here is not on this box any more');
}

// A GROUP THAT CANNOT APPLY LEAVES THE ROW (RULE FOUR, and the behaviour the
// original Sweep had before it was removed). A market entry has no rails, so
// gate, d, trail and arm mean nothing — the payload already omits them, and
// leaving them on screen live invites the owner to set a box that is thrown
// away. The whole PAIR goes, box and permute tick together, and a re-shown
// group goes back to 'flex' rather than '' so it keeps its own alignment.
function swShowGroup(sel, on) {
  const e = $(sel);
  if (e) e.style.display = on ? 'flex' : 'none';
}

// THE COST LINES ARE ASKED ROBUSTLY (owner order, 2026-08-29: flipping the
// stage 3 permutations around produced "the counter could not be asked" —
// "make this thing more robust").
//
// Four things were wrong with asking, and all four show up exactly when the
// owner is flipping boxes quickly, which is when the line matters most:
//
//   * IT SAID NOTHING USEFUL. askPost throws the reason away, so every failure
//     read the same — a busy service, a refused block and a typo in the
//     universe box were one message. Now the reason is kept and shown.
//   * A VERDICT OUTLIVED THE BOXES IT WAS ABOUT. "start stage 3 will refuse"
//     stayed on screen after the permutes that caused it were cleared (owner,
//     2026-08-29). So the line is BLANKED THE INSTANT anything changes and says
//     it is re-asking; a refusal or a figure is only ever on screen while it
//     describes the boxes as they are set right now. Keeping the last good
//     answer was considered and rejected for exactly this: the stale thing that
//     hurts here is a refusal, and a refusal nobody can clear is worse than no
//     number at all.
//   * REPLIES COULD LAND OUT OF ORDER. Every change fired its own request; a
//     slow early one arriving after a fast later one overwrote the right answer
//     with a stale one, silently. Each ask now carries a ticket and a late
//     reply is dropped.
//   * IT ASKED ON EVERY FLIP. Ticking four boxes fired four counts at a service
//     that may be running a stage job. The asks are coalesced.
let swAskSeq = 0;               // the ticket; a reply from an old ticket is dropped
let swCountsTimer = null;

// One count ask: returns { ok, data } or { ok:false, why }. Retries ONCE,
// because the common failure here is a service busy with a stage job for a
// moment, not a wrong request — and a wrong request fails the same way twice.
async function swAsk(path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const d = await post(path, body);
      if (d && d.error) return { ok: false, why: String(d.error) };
      return { ok: true, data: d };
    } catch (e) {
      const why = (e && e.message) || String(e);
      // A refusal is an ANSWER — asking again gets the same one, and retrying
      // it just doubles the load on a service that already said no.
      if (attempt === 1 || /must be|refus|invalid|not a|HTTP 4/i.test(why)) return { ok: false, why };
      await new Promise((r) => { setTimeout(r, 400); });
    }
  }
  return { ok: false, why: 'the counter did not answer' };
}

// Draw one cost line: the fresh answer, or the reason there is none. Never a
// figure or a verdict left over from a different set of boxes.
function swSayCount(el, html, why) {
  el.innerHTML = html != null ? html
    : `<span class="warn">the count is not known right now — ${esc(why)}. `
      + 'Change any box to ask again.</span>';
}

// Coalesce the flips: a burst of changes asks once, after the burst — and the
// lines go blank the moment the first change lands, so nothing that described
// the old boxes is still readable while the new answer is on its way.
function swCountsSoon() {
  for (const sel of ['#swCost1', '#swCount']) {
    const el = $(sel);
    if (el) el.innerHTML = '<span class="muted">…asking</span>';
  }
  clearTimeout(swCountsTimer);
  swCountsTimer = setTimeout(() => { swCounts(); }, 250);
}

async function swCounts() {
  const ticket = ++swAskSeq;
  const current = () => ticket === swAskSeq;   // a newer ask has taken over
  // The agreement dial is a SHARE of whatever committee a unit holds, so it
  // applies to a coin judged on its own and to one read alongside others
  // alike — which is why the two committee-size boxes that used to live here
  // are gone (owner loop, 2026-08-28).
  {
    // market with its permute OFF is the only case where the rails cannot
    // exist; with permute on, breakout is in the block too and they can
    const market = $('#swEntry') && $('#swEntry').value === 'market'
      && !($('#swPermEntry') && $('#swPermEntry').checked);
    for (const grp of ['#swGrpGate', '#swGrpD', '#swGrpTrail']) swShowGroup(grp, !market);
    swShowGroup('#swGrpArm', !market);
  }
  const c1 = $('#swCost1');
  if (c1) {
    const body = {
      universe: ($('#swUni').value || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean),
      sizes: { singles: $('#swSingles').checked, doubles: $('#swDoubles').checked, triples: $('#swTriples').checked },
      geometry: $('#swGeom').value, permuteGeometry: $('#swPermGeom').checked,
    };
    if (!body.universe.length) delete body.universe;
    const r = await swAsk('api/stage1-count', body);
    if (current()) {
      swSayCount(c1, r.ok
        ? `${r.data.units.toLocaleString()} units → ${r.data.trainings.toLocaleString()} trainings, votes kept for every one · null set is free arithmetic`
        : null, r.why);
    }
  }
  if (!current()) return;   // a newer ask is in flight; its answer is the one to draw
  const c3 = $('#swCount');
  if (c3) {
    const sets = swSetsCache || [];
    const parent = sets.find((x) => x.id === $('#swFrom3').value);
    const carry = Number($('#swCarry3') && $('#swCarry3').value) || 0;
    const units = parent ? (carry > 0 ? Math.min(carry, parent.plan.units) : parent.plan.units) : null;
    const coins = parent && parent.params && Array.isArray(parent.params.universe) ? parent.params.universe.length : null;
    // from and carry ride along so the counter resolves the ACTUAL units the
    // launch will price — which agreement bars exist is decided by them, and
    // a bar the run cannot use is neither counted nor named (owner order,
    // 2026-08-27: on singles there is no with contexts at all)
    const r = await swAsk('api/stage3-count', {
      ...swBlockParams(), from: $('#swFrom3').value || '', carry, units: units || 0, coins: coins || 1,
    });
    if (!current()) return;
    // PRICINGS PER SETTING PER UNIT: the real one, the null set, and each kept
    // money figure. Written once because the sentence below and the launch both
    // read it, and an estimate that leaves out the kept ones understates how
    // long the owner's run will take by exactly the amount they chose to add.
    const per3 = () => 1 + (Number($('#swNull3').value) || 0) + (Number($('#swKeep3').value) || 0);
    let html = null;
    if (r.ok) {
      const got = r.data;
      const sims = units ? got.settings * units * per3() : null;
      // the budget verdict comes from the SAME arithmetic the launch enforces:
      // a refusal is said here, before the button is pressed
      const refuse = (got.heap && got.heap.band === 'refuse' && got.heap) || (got.disk && got.disk.band === 'refuse' && got.disk) || null;
      const tight = !refuse ? ((got.heap && got.heap.band === 'tight' && got.heap) || (got.disk && got.disk.band === 'tight' && got.disk) || null) : null;
      // WHEN THE BLOCK ASKED FOR MORE THAN IT WILL PRICE, SAY SO. Settings that
      // place identical orders on every unit are folded to one; a count that
      // quietly shrank would be as much of a surprise as one that grew.
      const fold = got.declared && got.folded ? ` <span class="muted">(${got.declared.toLocaleString()} declared, `
        + `${got.folded.toLocaleString()} priced the same trade and were folded into one)</span>` : '';
      html = `declared: <b>${got.settings.toLocaleString()} settings</b>${fold}${units ? ` × ${units.toLocaleString()} units × ${per3().toLocaleString()} readings ≈ ${sims.toLocaleString()} pricings — no trainings` : ''}`
        + (refuse ? `<br><b class="neg">start stage 3 will refuse: ${esc(refuse.message)}</b>`
          : tight ? `<br><span class="warn">${esc(tight.message)}</span>` : '');
    }
    swSayCount(c3, html, r.why);
  }
}

// The declared cell exactly as the launch will read it. market carries no
// gate, d, trail or arm — the same rule the old launcher enforces — so those
// boxes are omitted from the payload rather than silently ignored.
function swBlockParams() {
  const entry = $('#swEntry').value;
  const permEntry = $('#swPermEntry').checked;
  const cell = { tHours: Number($('#swT').value) };
  if (entry !== 'market' || permEntry) {
    cell.entry = entry === 'market' ? 'breakout' : entry;
    cell.gate = $('#swGate').value;
    cell.dMult = Number($('#swD').value);
    if ($('#swTrail').value !== '') { cell.trailMult = Number($('#swTrail').value); cell.armMult = Number($('#swArm').value); }
    else if ($('#swPermTrail').checked) { cell.armMult = Number($('#swArm').value); }
  } else {
    cell.entry = 'market';
  }
  if (entry === 'market' && permEntry) cell.entry = 'breakout';
  return {
    cell,
    cellPermute: {
      entry: permEntry, gate: $('#swPermGate').checked, dMult: $('#swPermD').checked,
      tHours: $('#swPermT').checked, trail: $('#swPermTrail').checked, arm: $('#swPermArm').checked,
    },
    decision: $('#swDec').value, permuteDecision: $('#swPermDec').checked,
    band: $('#swBand').value.trim() === '' ? 'auto' : ($('#swBand').value.trim() === 'auto' ? 'auto' : Number($('#swBand').value)),
    permuteBand: $('#swPermBand').checked,
    weekdaysOnly: $('#swWk').checked, permuteWeekdays: $('#swPermWk').checked,
    // the agreement is its own dimension now, never part of the trade shape
    agreeRule: $('#swAgreeRule').value,
    agreeBar: $('#swAgreeBar').value,
    agreeCopy: Number($('#swAgreeCopy').value),
    agreePct: Number($('#swAgreeShare').value),
    agreeBothModels: $('#swAgreeBoth').checked,
    agreePersist: Number($('#swAgreeHold').value) || 0,
    agreePermuteRule: $('#swPermAgreeRule').checked,
    agreePermuteBar: $('#swPermAgreeBar').checked,
    agreePermuteCopy: $('#swPermAgreeCopy').checked,
    agreePermutePct: $('#swPermAgreeShare').checked,
    agreePermuteBoth: $('#swPermAgreeBoth').checked,
    agreePermutePersist: $('#swPermAgreeHold').checked,
  };
}

// ONE mapping from a record set's stored settings back into the Sweep
// boxes — the same discipline fillSweepForm keeps for the sweeps: a second
// copy of this mapping would be two answers to one question. It reads which
// record set is open on Boards and fills THAT stage's box alone (owner
// order, 2026-08-27: a stage 2 set was filling the stage 1 box too, which
// read as loading the wrong data). The parent box is picked from the set's
// own named parent, so pressing start re-runs the same step of the same
// chain. The description RIDES TOO (owner order, 2026-08-27: "carry the
// description field to the Sweep section") — into the same stage's
// description box, ready to be kept or rewritten before the start.
function fillStageForm(doc) {
  const p = doc.params || {};
  const setV = (sel, v) => { const el = $(sel); if (el && v !== undefined && v !== null) el.value = String(v); };
  const setC = (sel, v) => { const el = $(sel); if (el) el.checked = !!v; };
  if (doc.stage === 1) {
    setV('#swUni', (p.universe || []).join(','));
    setC('#swSingles', (p.sizes || {}).singles); setC('#swDoubles', (p.sizes || {}).doubles); setC('#swTriples', (p.sizes || {}).triples);
    setC('#swAllData', p.allLoaded !== false);
    setV('#swStart', p.startMonth || ''); setV('#swEnd', p.endMonth || '');
    const geos = p.geometries || [];
    if (geos.length) setV('#swGeom', geos[0]);
    setC('#swPermGeom', geos.length > 1);
    setV('#swLayout', p.windowLayout || 'reserve61');
    setV('#swNull1', p.nullN ?? 19);
    setV('#swDesc1', doc.desc || '');
  }
  if (doc.stage === 2) {
    if (doc.parent) setV('#swFrom2', doc.parent.id);
    setV('#swCarry', p.carry ?? 0);
    setV('#swDesc2', doc.desc || '');
  }
  if (doc.stage === 3) {
    if (doc.parent) setV('#swFrom3', doc.parent.id);
    setV('#swCarry3', p.carry ?? 0);
    setV('#swDesc3', doc.desc || '');
    setV('#swFee', p.fee != null ? p.fee * 100 : '');
    setV('#swNull3', p.nullN ?? 19);
    setV('#swKeep3', p.keepN ?? 0);
    setV('#swDec', p.decision || 'argmax'); setC('#swPermDec', p.permuteDecision);
    setV('#swBand', p.band ?? 'auto'); setC('#swPermBand', p.permuteBand);
    setC('#swWk', p.weekdaysOnly); setC('#swPermWk', p.permuteWeekdays);
    const c = p.cell || {};
    setV('#swEntry', c.entry); setV('#swGate', c.gate); setV('#swD', c.dMult); setV('#swT', c.tHours);
    setV('#swTrail', c.trailMult == null ? '' : c.trailMult);
    setV('#swArm', c.armMult == null ? '' : c.armMult);
    setV('#swAgreeRule', p.agreeRule || 'count'); setV('#swAgreeBar', p.agreeBar || 'all');
    setV('#swAgreeCopy', p.agreeCopy || 98);
    setV('#swAgreeShare', p.agreePct == null ? 50 : p.agreePct);
    setC('#swAgreeBoth', p.agreeBothModels); setV('#swAgreeHold', p.agreePersist || 0);
    setC('#swPermAgreeRule', p.agreePermuteRule); setC('#swPermAgreeBar', p.agreePermuteBar);
    setC('#swPermAgreeCopy', p.agreePermuteCopy);
    setC('#swPermAgreeShare', p.agreePermutePct);
    setC('#swPermAgreeBoth', p.agreePermuteBoth); setC('#swPermAgreeHold', p.agreePermutePersist);
    const cp = p.cellPermute || {};
    setC('#swPermEntry', cp.entry); setC('#swPermGate', cp.gate); setC('#swPermD', cp.dMult); setC('#swPermT', cp.tHours);
    setC('#swPermTrail', cp.trail); setC('#swPermArm', cp.arm);
  }
  // a programmatic fill never fires 'change', so remember it here — copied
  // settings must survive a screen flip exactly like typed ones
  rememberSweepForm();
  swCounts();
}

// WHAT IS IN THE STAGE BOXES SURVIVES A SCREEN FLIP (owner order,
// 2026-08-27: "not lose the values loaded to the stage 1/2/3 areas on screen
// flips — that stuff needs to be left as-is"). The same standing rule the
// Sweep form keeps, by the same mechanism: every box and tick on this page,
// found by id so a control added tomorrow is covered, remembered on every
// change and written back on every draw.

let swSetsCache = null;

// A run's stored settings, written back into the boxes. ONE mapping, used by
// "copy settings into the form" on the Boards section and by the running-job
// display here — two copies of it would be two answers to the same question.

// THE CAMPAIGN PANEL IS ONE PANEL, DRAWN ON TWO SCREENS (owner order,
// 2026-08-27: "code the campaign interface and back-end on Sweep3 EXACTLY as
// per the one on Sweep -- go ahead and reuse the code" — both of those
// screens have since been folded into the single Sweep). One function returns
// the markup and one wires the buttons, so the two screens cannot drift — the
// same reason the Trade page draws its two branches from one path. Top-level
// and called by name, so the word list and the control reader follow it onto
// BOTH screens (lib/screencontrols.js reads one level of helpers).
function campaignPanelHtml(camp, names) {
  return `<div class="panel">
    <h3 style="margin-top:0">Campaign — the parent chain name</h3>
    <p class="note">Every run launched while a campaign is set attaches to it: sweeps, null rounds, tuning passes,
      scans, stage record sets. The campaign's whole chain travels with any greenlight minted from it.</p>
    <!-- A <datalist> FILTERS ITS SUGGESTIONS BY WHAT IS ALREADY IN THE BOX, and
         the box is pre-filled with the current campaign — so opening it showed
         exactly the one entry that matched, and every other campaign on the box
         was unreachable without clearing the field first. The list was never
         short: the service was offering three (owner, 2026-08-18). Two plain
         controls now: pick an existing campaign, or type a new name. -->
    <div class="row" style="align-items:flex-end">
      <label class="f" title="every campaign this box has ever stamped on a run, a record set or a greenlight, newest activity first. Picking one switches to it immediately.">existing campaigns<select id="cxCampPick" style="min-width:26rem">
        <option value="">— ${(names.names || []).length} on this box —</option>
        ${(names.names || []).map((n) => `<option value="${esc(n)}" ${n === camp.name ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      </select></label>
      <label class="f" title="name a NEW campaign. Runs launched from now on attach to whatever is set here.">or a new name<input id="cxCamp" value="${esc(camp.name || '')}" maxlength="60" style="width:26rem"></label>
      <button id="campSet">Set</button>
      <button id="campTree" title="shows the runs, record sets and greenlights belonging to the campaign named in the box. Press it again to put them away.">View tree</button>
      <!-- Same row, same shape as its neighbours: the row is bottom-aligned
           because the controls to the left are a label above a box. -->
      <button id="campDelete" class="danger">Delete campaign…</button>
    </div>
    <p class="note">Currently set: <b>${esc(camp.name || 'none')}</b>${(names.names || []).length ? ` · ${(names.names || []).length} campaign(s) on this box` : ''}</p>
    <div id="campOut"></div></div>`;
}

// The panel's buttons, wired the same on every screen that draws it. redraw
// is that screen's own draw, so Set and Delete land back on the page the
// owner is actually looking at.
function wireCampaignPanel(redraw) {
  $('#campSet').onclick = async () => { const out = await tryPost('api/campaign', { name: $('#cxCamp').value }); if (out) redraw(); };
  const campPick = $('#cxCampPick');
  if (campPick) campPick.onchange = async () => {
    if (!campPick.value) return;
    // WHAT THE USER JUST PICKED WINS, IMMEDIATELY (owner, 2026-08-18).
    // "View tree" reads #cxCamp, and that box only caught up after the POST
    // returned and the page re-rendered. Click View tree inside that window
    // and it fetched the tree of the PREVIOUS campaign — a wrong answer that
    // looks like a right one, because the tree renders fine, it is just the
    // wrong campaign's. Reflecting the pick into the box synchronously, BEFORE
    // the await, closes the window: the control the button reads is correct
    // from the instant of the click.
    $('#cxCamp').value = campPick.value;
    // ...and belt-and-braces: no campaign action at all while the switch is in
    // flight, so the panel can never be acted on while "Currently set" still
    // disagrees with the dropdown. The redraw re-renders and re-enables.
    const tree = $('#campTree'); const set = $('#campSet');
    if (tree) tree.disabled = true; if (set) set.disabled = true;
    const out = await tryPost('api/campaign', { name: campPick.value });
    if (out) redraw();
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
    box.innerHTML = t ? `<h3>Campaign “${esc(t.name)}” — runs, record sets &amp; greenlights</h3>
      <table><thead><tr>${cth('run / record set','run')}${cth('kind','kind')}${cth('status','status')}${cth('started','started')}${cth('derives from','derives','text-align:left')}</tr></thead><tbody>
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
      ['record sets', c.stageSets],
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
      Removed ${r.runs || 0} run(s), ${r.greenlights || 0} greenlight(s), ${r.setups || 0} setup(s),${r.stageSets ? ` ${r.stageSets} record set(s),` : ''}
      and the saved models and tuning files belonging to them.
      ${(out.leftBehind || []).length ? `<div style="margin-top:.3rem"><b class="warn">${out.leftBehind.length} record set(s) stayed</b> — each says why: ${out.leftBehind.map((x) => esc(x)).join(' · ')}</div>` : ''}
      ${out.wasCurrent ? 'It was the campaign in use, so nothing is set now.' : ''}</div>`;
    redraw();
  };
}

// ---- shared by the screens that open a saved thing -------------------------------------------------------------------
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

// THE TOP OF AN OPENED RUN IS ONE STRUCTURE, DRAWN ON TWO SCREENS (owner
// order, 2026-08-27: "the same structure at the top of Boards as we have
// with Boards ... all formatted the same — recycle / re-use whatever
// code/back-end you need"). Boards draws a saved run's head with these;
// Boards draws a record set's head with the SAME functions, so the two
// cannot drift apart — the same reason the Trade page draws its two branches
// from one path. Top-level and called by name, so the word list and the
// control reader follow them onto both screens.
function campaignNoteHtml(doc) {
  return doc ? `<span class="note">campaign: ${esc((doc.params && doc.params.campaign) || '—')} · ${esc(doc.status)} · ${(doc.params && doc.params.windowLayout) || ''}</span>` : '';
}
// bold is Boards's (owner order, 2026-08-27: the description set on Sweep
// reads BOLD when its record set is opened); Boards passes nothing and keeps
// its plain rendering — a deliberate difference, not a drifted one.
function descriptionPanelHtml(text, bold) {
  return text ? `<div class="panel note">${bold ? `<b>${esc(text)}</b>` : esc(text)}</div>` : '';
}
// THE BUTTONS LINE UP WITH THE TOP OF THE NOTES BOX (owner order,
// 2026-08-25; standing RULE FOUR). They used to sit in one row with the
// captioned box, top-aligned to the ROW — which is the top of the caption,
// one text line above the box they belong to. The caption sits on its own
// line (still the box's label, tied by for=), and the box and its buttons
// share a row whose tops meet by construction, with nothing nudged.
// extraButtons is the slot for buttons only one screen has (Boards puts its
// settings-copying button there); the box, the save and the stamp are shared.
// EVERY OPEN SECTION GETS ITS OWN NOTES BOX (owner, 2026-08-29: "the field is
// not available to fill on stage 1 and 2 currently").
//
// It was drawn on the deepest selection only, so opening a stage 3 record set
// took the box away from the stage 1 and stage 2 sections above it and there
// was no way to write a note on either. They are three record sets, each with
// its own notes on the service, and each is writable where it is shown.
//
// WHY THREE FUNCTIONS AND NOT ONE WITH A SUFFIX. Every id on these screens has
// to be readable straight out of the source: lib/screencontrols.js is what
// tells the Help tab which controls exist and what feeds the closed word list,
// and it reads literal id attributes. An id built at runtime is a control the
// owner can see and the word list cannot name, which RULE ONE-A does not allow.
// The three per-section pickers, deletes and copy-settings buttons are written
// out literally for the same reason. A test holds these three identical apart
// from the digit.
function notesPanel1(doc) {
  const off = doc.status === 'running';
  return `<div class="panel">
        <label class="f" for="bNotes1">notes — why this run exists, what it showed, what it cost</label>
        <div class="row" style="align-items:flex-start;margin-top:.15rem">
          <textarea id="bNotes1" rows="3" style="flex:1;font:inherit" ${off ? 'disabled' : ''}>${esc(doc.notes || '')}</textarea>
          <button id="bNotesSave1" ${off ? 'disabled title="notes save after the run finishes — the engine refuses writes while it computes"' : ''}>save notes</button>
          <span id="bNotesMsg1" class="note">${doc.notesEditedAt ? `last edited ${esc(String(doc.notesEditedAt).slice(0, 16))}` : ''}</span>
        </div>
      </div>`;
}
function notesPanel2(doc) {
  const off = doc.status === 'running';
  return `<div class="panel">
        <label class="f" for="bNotes2">notes — why this run exists, what it showed, what it cost</label>
        <div class="row" style="align-items:flex-start;margin-top:.15rem">
          <textarea id="bNotes2" rows="3" style="flex:1;font:inherit" ${off ? 'disabled' : ''}>${esc(doc.notes || '')}</textarea>
          <button id="bNotesSave2" ${off ? 'disabled title="notes save after the run finishes — the engine refuses writes while it computes"' : ''}>save notes</button>
          <span id="bNotesMsg2" class="note">${doc.notesEditedAt ? `last edited ${esc(String(doc.notesEditedAt).slice(0, 16))}` : ''}</span>
        </div>
      </div>`;
}
function notesPanel3(doc) {
  const off = doc.status === 'running';
  return `<div class="panel">
        <label class="f" for="bNotes3">notes — why this run exists, what it showed, what it cost</label>
        <div class="row" style="align-items:flex-start;margin-top:.15rem">
          <textarea id="bNotes3" rows="3" style="flex:1;font:inherit" ${off ? 'disabled' : ''}>${esc(doc.notes || '')}</textarea>
          <button id="bNotesSave3" ${off ? 'disabled title="notes save after the run finishes — the engine refuses writes while it computes"' : ''}>save notes</button>
          <span id="bNotesMsg3" class="note">${doc.notesEditedAt ? `last edited ${esc(String(doc.notesEditedAt).slice(0, 16))}` : ''}</span>
        </div>
      </div>`;
}
// FILLING IN THE KEPT SCRAMBLES on a set priced before the column existed.
// It is a USER function and not a script somebody remembers to run (RULE FIVE
// and RULE NINE), so it lives here with the set it changes, says what the set
// has now, and prints what the choice costs BEFORE the button is pressed.
function bKeptFillPanel(doc) {
  if (doc.stage !== 3) return '';
  const p = doc.params || {};
  const nullN = Number(p.nullN) || 0;
  const have = Number(p.keepN) || 0;
  // SIZED FROM THE ROWS ON DISK, not from the plan. The plan is what the LAUNCH
  // asked for; a set that has since been filled in holds more than that, and on
  // the owner's set the difference is 329,280 against 524,832 per unit -- so a
  // cost printed from the plan understates a four-hour job by nearly half.
  const rows = Number((doc.counts || {}).rows) || 0;
  const off = doc.status !== 'done';
  // THE BOX STARTS ON WHAT THE SET ALREADY KEEPS (owner order, 2026-09-02:
  // "that button better not run and start deleting good data if it gets hit
  // again"). A press at that number is refused by the fill; only a number
  // ABOVE it does anything, and that asks first (wireKeptFill).
  const want = have || Math.min(10, nullN);
  // the same arithmetic the fill itself does: the real test money once as a
  // proof, then each ADDED scramble on each of the two windows -- a top-up
  // prices only the scrambles the records do not hold
  const cost = (k) => rows * (1 + Math.max(0, k - have) * 2);
  return `<div class="panel">
      <h3 style="margin-top:0">Filling in the kept null money</h3>
      <div class="row" style="align-items:flex-end">
      <label class="f" title="how many of this set's null-set deals should have their money written down, so the Funnel has a whole second copy of Table 3.A and Table 3.B made of scrambled money to measure against. It re-prices only what is missing, never the whole run, and it proves itself against the money already stored before anything is swapped.">null set money kept<input id="bKeptN" type="number" value="${want}" min="0" max="${nullN}" data-have="${have}" data-rows="${rows}" style="width:4.5rem" ${off ? 'disabled' : ''}></label>
      <button id="bKeptGo" ${off ? 'disabled title="the set is still working — a fill waits until it has landed"' : ''}>fill in the kept null money</button>
      <span id="bKeptMsg" class="note">${have ? `this set keeps ${have} of its ${nullN}. Pressing at ${have} does nothing; a higher number adds only the missing scrambles and asks first.` : `this set keeps none of its ${nullN}.`}${nullN && rows && !have ? ` Keeping ${want} re-prices ${cost(want).toLocaleString()} times, across ${rows.toLocaleString()} rows.` : ''}</span>
      </div>
    </div>`;
}
function runIdentityPanelHtml(sizeLine, dm) {
  return `<div class="panel"><h3 style="margin-top:0">What this run actually is</h3>
          ${sizeLine || ''}
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
}
// One save wiring for both screens; only the address differs. Re-render from
// the RESPONSE: the stored value comes back truncated, and the edited stamp
// is taken on the server, not here. onSaved lets a screen refresh its own
// cached copy (Boards keeps the opened run's doc in hand).
function wireKeptFill(id) {
  const go = $('#bKeptGo');
  if (!go) return;
  go.onclick = async () => {
    const keep = Number(($('#bKeptN') || {}).value) || 0;
    // RAISING THE COUNT IS ASKED FIRST, with what it costs. A fill runs for
    // hours and puts the page to sleep at its end; a mis-typed 11 must not
    // start one on a slip. The refusal for a number at or below what the set
    // keeps is the fill's own and needs no asking.
    const bx = $('#bKeptN');
    const haveNow = Number((bx && bx.dataset.have) || 0);
    const rowsNow = Number((bx && bx.dataset.rows) || 0);
    if (haveNow && keep > haveNow) {
      const adding = keep - haveNow;
      const msg = `This set already keeps ${haveNow} scrambles. Add ${adding} more, for ${keep} in all?\n\n`
        + `Only the ${adding} missing scramble(s) are priced -- ${(rowsNow * (1 + adding * 2)).toLocaleString()} pricings across ${rowsNow.toLocaleString()} rows -- `
        + 'and the records are rewritten beside and swapped only after every check passes. Hours, not minutes.';
      if (!confirm(msg)) return;
    }
    go.disabled = true;
    // THE WAIT BOX, RAISED BEFORE THE ASK (owner, 2026-09-01: "it sits for 30
    // seconds looking like it didn't get the button click").
    //
    // This press is slow for a real reason: the answer does not come back until
    // the pass has worked out every setting the set declares, and on the
    // owner's board that is 524,832 of them. Half a minute of a page that looks
    // exactly like a page that ignored you is how a second press happens, and a
    // second press is a second refusal.
    //
    // waitStart/waitEnd, not a box of my own: it is the same one every slow
    // redraw on this page raises, it counts rather than flags so two slow
    // things at once cannot uncover each other, and it shows itself late so a
    // fast answer never flashes it. `finally`, because a refusal must uncover
    // the page too.
    waitStart();
    let out;
    try {
      out = await tryPost(`api/stageset/${encodeURIComponent(id)}/kept-fill`, { keep });
    } finally {
      waitEnd();
    }
    // tryPost already says why on a refusal; re-enable so the owner can change
    // the number and ask again rather than being left with a dead button
    if (!out) { go.disabled = false; return; }
    $('#bKeptMsg').textContent = `filling in ${out.keep} across ${out.units} unit(s) — `
      + `${Number(out.pricings).toLocaleString()} pricings.`;
    // STRAIGHT TO WHERE THE PROGRESS ACTUALLY IS (owner order, 2026-08-31).
    // The fill runs for hours and reports on the Sweep section's status line,
    // not on this one, so a press that leaves the owner here leaves them
    // watching a line that will never move again.
    //
    // The top is reached through the page's OWN scroll memory rather than a
    // scrollTo of my own. Every redraw restores the tab's remembered place two
    // frames later, so a hand-rolled scroll would be undone right after it
    // happened. Setting Sweep's memory to the top and then restoring it uses
    // that mechanism instead of racing it -- and it leaves the memory honest,
    // because the page really is at the top afterwards.
    rememberScroll(tab);                     // keep the owner's place on the one being left
    try { localStorage.setItem(scrollKeyFor('sweep'), '0'); } catch (_) { /* private window */ }
    tab = 'sweep';
    localStorage.setItem('cx-tab', tab);
    draw().then(() => restoreScroll(tab));
  };
}
function wireNotesSave(saveUrl, onSaved, suffix) {
  const nsave = $(`#bNotesSave${suffix}`);
  if (nsave) nsave.onclick = async () => {
    const box = $(`#bNotes${suffix}`);
    const out = await tryPost(saveUrl, { text: box.value });
    if (out) {
      box.value = out.notes || '';
      $(`#bNotesMsg${suffix}`).textContent = `saved ${String(out.notesEditedAt || '').slice(0, 16)}`;
      if (onSaved) onSaved(out);
    }
  };
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
      <button id="pgRun" class="pri" ${gate && gate.running ? 'disabled title="a planted check is already running"'
    : (gate && gate.blockedBy ? `disabled title="${esc(gate.blockedBy)} is going — the planted check regenerates the fabricated pair and fires a whole sweep, so it waits for the box to be free"` : '')}>Run the planted check</button>
      <span id="pgMsg" class="note">${gate && gate.running ? `running now — ${esc(gate.running)}`
    : (gate && gate.blockedBy ? `waits for ${esc(gate.blockedBy)} to finish` : '')}</span></div>
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
    if (!confirm('Run the planted check?\n\nRegenerates the fabricated pair and fires a full sweep through the null pipeline. Minutes, not seconds. It refuses while any other job, sweep or stage run is going.')) return;
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
      <label class="f" title="how fast older evidence stops counting. A shorter half-life makes the model lean on recent weeks; a longer one keeps older weeks in play. These three are the choices the engine runs.">half-life<select id="ht2hl">${vocabOptions('halfLife', '12mo')}</select></label>
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
    : chosen ? { setupId: chosen.id }
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
        <td>${s.appliesToLiveRule ? `<button data-stop="${c.stopPct}">apply to the live rule</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="note">NET = winner $ given up + loss-side $ vs no stop; positive means the stop helps. Apply buttons exist
        only for the running engine; for a lab row the number informs the greenlight instead.</p>`;
  }
  function renderConvResult(c) {
    const n = c.null || {};
    return `<p><b>${esc(c.bookId)}</b> over ${c.entries} priced entries: flat ${usd(c.flatUsd)} vs ladder <b>${usd(c.ladderUsd)}</b>
      — uplift <b class="${(c.upliftUsd || 0) >= 0 ? 'pos' : 'neg'}">${usd(c.upliftUsd)}</b>.</p>
      <div class="scrollx"><table><thead><tr>${cth('agreement','agreement')}${cth('mult','mult')}${cth('trades','trades')}${cth('wins','wins')}${cth('win %','winPct')}${cth('flat $','flatUsd')}${cth('ladder $','ladderUsd')}</tr></thead><tbody>
      ${(c.buckets || []).map((b) => `<tr><td>${b.agree} of ${(c.setup && c.setup.members) || '?'}${b.thin ? ' ⚠' : ''}</td>
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

// ---- Sweep — the three stages, live ---------------------------------------
//
// Stage 1 trains the LOGREG members and keeps every vote; stage 2 carries the
// best rows forward and adds the BOOST members; stage 3 prices settings from
// the kept votes without training anything. Each stage writes a record set the
// next one reads, and every set names its parent.
async function drawSweep() {
  if (swPoll) { clearInterval(swPoll); swPoll = null; }
  const [st, camp, names] = await Promise.all([
    apiOr('api/stagesets', ({ running: null, sets: [] })),
    apiOr('api/campaign', ({ name: '' })),
    apiOr('api/campaigns', ({ names: [] })),
  ]);
  const sets = st.sets || [];
  swSetsCache = sets;
  $('#view').innerHTML = `<div class="panel">
    <h3 style="margin-top:0">Sweep — the three stages, live</h3>
    <p class="note">Each stage writes a record set the next one reads, and every set names its parent. What is
      running, and everything finished, is on Boards.</p>
    <div class="row"><span class="note" id="swProg">…</span></div>
  </div>
  ${campaignPanelHtml(camp, names)}

  <div class="panel">
    <h3 id="swH1" style="margin-top:0">Stage 1 — train the LOGREG members once, keep every vote, rank against the null set</h3>
    <p class="note" style="margin:.2rem 0 .4rem">every member is a LOGREG forecast — 4 per coin on its own, 5 alongside others — trained with the plain
      argmax fit. No trade, no fee and no decision exist here; those are priced later, at stage 3, from the votes this stage keeps.</p>
    <div class="row" style="align-items:flex-end">
      <label class="f">universe (blank = all 17 default pairs)<input id="swUni" placeholder="LTCUSDT,XRPUSDT,BCHUSDT" style="width:20rem"></label>
      <label class="c"><input type="checkbox" id="swSingles" checked> singles</label>
      <label class="c"><input type="checkbox" id="swDoubles"> doubles</label>
      <label class="c"><input type="checkbox" id="swTriples"> triples</label>
      <label class="c"><input type="checkbox" id="swAllData" checked> all loaded data</label>
      <label class="f">start<input id="swStart" type="month"></label>
      <label class="f">end<input id="swEnd" type="month"></label>
    </div>
    <div class="row" style="margin-top:.5rem;align-items:flex-end">
      <label class="f">chunk shape<select id="swGeom">${vocabOptions('geometry', 'daily-4d')}</select></label>
      <label class="c"><input type="checkbox" id="swPermGeom"> permute</label>
      <label class="f">window layout<select id="swLayout">${vocabOptions('windowLayout', 'reserve61')}</select></label>
      <label class="f">null set size<input id="swNull1" type="number" value="19" min="0" style="width:4.5rem"></label>
    </div>
    <div class="row" style="margin-top:.5rem;align-items:flex-end">
      <label class="f" style="flex:1">description<input id="swDesc1" style="width:100%"></label>
      <button id="swGo1" class="pri">start stage 1</button>
    </div>
    <p class="note" style="margin:.4rem 0 0" id="swCost1">…</p>
    <div id="swOut1"></div>
  </div>

  <div class="panel">
    <h3 id="swH2" style="margin-top:0">Stage 2 — carry the best forward, add the BOOST members</h3>
    <div class="row" style="align-items:flex-end">
      <label class="f">from stage 1 record set<select id="swFrom2" style="min-width:24rem">${swSetOptions(sets, 1, null)}</select></label>
      <label class="f" title="the carry takes the top of the parent's table in the sort saved on it — pick the sort on Boards. The fixed rule (beat its own null set, ties by lead over null set) when none is saved.">carry forward (0 = all)<input id="swCarry" type="number" value="0" min="0" style="width:5.5rem"></label>
    </div>
    <div class="row" style="margin-top:.5rem;align-items:flex-end">
      <label class="f" style="flex:1">description<input id="swDesc2" style="width:100%"></label>
      <button id="swGo2" class="pri">start stage 2</button>
    </div>
    <p class="note" style="margin:.4rem 0 0">BOOST is the second kind of member — a different way of working out a forecast from the same prices.
      The LOGREG members are reused, never retrained; only the BOOST members train (4 per coin on its own, 5 alongside others),
      so a carried unit ends up with both kinds voting side by side.</p>
    <div id="swOut2"></div>
  </div>

  <div class="panel">
    <h3 id="swH3" style="margin-top:0">Stage 3 — price any settings from the kept votes, no training</h3>
    <div class="row" style="align-items:flex-end">
      <label class="f">from stage 2 record set<select id="swFrom3" style="min-width:24rem">${swSetOptions(sets, 2, null)}</select></label>
      <label class="f">carry forward (0 = all)<input id="swCarry3" type="number" value="0" min="0" style="width:5.5rem"></label>
      <label class="f">fee % each way<input id="swFee" type="number" value="0.125" min="0" max="5" step="0.005" style="width:5.5rem"></label>
      <label class="f">null set size<input id="swNull3" type="number" value="19" min="0" style="width:4.5rem"></label>
      <label class="f" title="how many of the null set's money figures to write down, rather than just counting them. Keeping some builds a whole second copy of the stage 3 tables out of scrambled money alone, which is the only thing the Funnel can measure a real result against. Costs one extra pricing per setting per coin for each one kept, so 10 makes the run about 10% longer. 0 keeps none, which is how every run before this one worked.">null set money kept<input id="swKeep3" type="number" value="10" min="0" style="width:4.5rem"></label>
    </div>
    <div class="row" style="margin-top:.5rem;align-items:flex-end">
      <div style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="f">decision<select id="swDec">${vocabOptions('decision', 'argmax')}</select></label>
        <label class="c"><input type="checkbox" id="swPermDec"> permute</label>
      </div>
      <div style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="f">band % (or auto)<input id="swBand" value="auto" style="width:5rem"></label>
        <label class="c"><input type="checkbox" id="swPermBand"> permute</label>
      </div>
      <div style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="c"><input type="checkbox" id="swWk"> 24/5</label>
        <label class="c"><input type="checkbox" id="swPermWk"> permute</label>
      </div>
      <div style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="f">entry<select id="swEntry">${vocabOptions('entry', 'breakout')}</select></label>
        <label class="c"><input type="checkbox" id="swPermEntry"> permute</label>
      </div>
      <div id="swGrpGate" style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="f">gate<select id="swGate">${vocabOptions('gate', 'directional')}</select></label>
        <label class="c"><input type="checkbox" id="swPermGate"> permute</label>
      </div>
      <div id="swGrpD" style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="f">d<select id="swD">${vocabOptions('dMult', '1.5')}</select></label>
        <label class="c"><input type="checkbox" id="swPermD"> permute</label>
      </div>
      <div style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="f">t<select id="swT">${vocabOptions('tHours', '65')}</select></label>
        <label class="c"><input type="checkbox" id="swPermT"> permute</label>
      </div>
      <div id="swGrpTrail" style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="f">trail<select id="swTrail">${vocabOptions('trailMult', '')}</select></label>
        <label class="c"><input type="checkbox" id="swPermTrail"> permute</label>
      </div>
      <div id="swGrpArm" style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="f">arm<select id="swArm">${vocabOptions('armMult', '0')}</select></label>
        <label class="c"><input type="checkbox" id="swPermArm"> permute</label>
      </div>
      <p class="note" style="margin:.6rem 0 .1rem"><b>Quorum</b> — every coin is judged by 8 members. These four boxes decide when enough of them agree to act.</p>
      <div style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="f" title="WHAT IS WEIGHED when the members are polled. count is how many say the same thing — the plain head count. conviction is how hard they lean, added up, so six that are certain outweigh six that barely lean. voices is a head count in which members that almost always call the same way as each other share one vote between them, so a crowd of near-copies cannot outvote a real disagreement. families is how many different KINDS of evidence agree — the members read four different slices of the numbers, and this asks that several slices line up rather than several members. This box is only half the quorum: quorum bar decides how much of it is enough.">quorum by<select id="swAgreeRule">${vocabOptions('agreeRule', 'count')}</select></label>
        <label class="c" title="price every quorum by choice as its own setting."><input type="checkbox" id="swPermAgreeRule"> permute</label>
        <label class="f" title="WHAT THE BAR IS A SHARE OF. all of them means a share of what EXISTS — 75% of 8 members is 6 of them, worked out from the committee's size and nothing else. its own history means a share of what this committee ACTUALLY REACHES — the moments are sorted and 75% admits only the strongest quarter of them. The second matters because a bar set as a share of what exists only makes sense when the thing weighed reaches its maximum in practice: a head count does, a sum of how hard eight members lean does not. Read from the test window only; the held-back window is never used for it, though the same window did the ordering, so the bar is set knowing the window it will be scored on.">quorum bar<select id="swAgreeBar">${vocabOptions('agreeBar', 'all')}</select></label>
        <label class="c" title="price both bars as their own settings."><input type="checkbox" id="swPermAgreeBar"> permute</label>
        <label class="f" title="HOW ALIKE TWO MEMBERS MUST BE TO COUNT AS ONE VOICE. Only voices reads this. Two members that make the same call at least this often across the test window share one vote between them, so a crowd of near-copies cannot outvote a real disagreement. Lower is harsher: at 80% two members agreeing four times in five are already one voice, and the committee shrinks. At 100% only members that never once differ are folded together, which is almost never, and voices then gives the same answer as count. The block is not multiplied by this for the other three — they cannot read it.">one voice at<select id="swAgreeCopy">${vocabOptions('agreeCopy', '98')}</select></label>
        <label class="c" title="price every one voice at choice as its own setting. It only multiplies the block where voices is being priced."><input type="checkbox" id="swPermAgreeCopy"> permute</label>
      </div>
      <div style="display:flex;align-items:flex-end;gap:.45rem">
        <label class="f" title="HOW MUCH IS ENOUGH. Higher is stricter whichever bar is picked, so the dial never changes direction under you. What it is a share OF is quorum bar's business: with all of them it is a share of the committee, and 75% of 8 members is 6; with its own history it is a share of this committee's own moments, and 75% admits the strongest quarter of them. The same number therefore means two different things under the two bars, which is why the bar is written into every setting's name.">share<select id="swAgreeShare">${vocabOptions('agreeShare', '50')}</select></label>
        <label class="c" title="price every share as its own setting. Shares landing on the same bar for every unit in the run are counted once."><input type="checkbox" id="swPermAgreeShare"> permute</label>
        <label class="c" title="the side that wins must include at least one LOGREG member and one BOOST member, so a call can never be one kind's quirk."><input type="checkbox" id="swAgreeBoth"> both kinds</label>
        <label class="c" title="price both with and without the both kinds requirement."><input type="checkbox" id="swPermAgreeBoth"> permute</label>
        <label class="f" title="how many decision moments in a row the same call must have stood before it is acted on. off acts at once.">hold<select id="swAgreeHold">${vocabOptions('agreeHold', '0')}</select></label>
        <label class="c" title="price every hold as its own setting."><input type="checkbox" id="swPermAgreeHold"> permute</label>
      </div>
    </div>
    <div class="row" style="margin-top:.4rem"><span class="note" id="swCount">…</span></div>
    <div class="row" style="margin-top:.5rem;align-items:flex-end">
      <label class="f" style="flex:1">description<input id="swDesc3" style="width:100%"></label>
      <button id="swGo3" class="pri">start stage 3</button>
    </div>
    <div id="swOut3"></div>
  </div>`;

  wireCampaignPanel(() => drawSweep());
  const say = (sel, msg, bad) => { $(sel).innerHTML = `<p class="note${bad ? ' warn' : ''}" style="margin:.4rem 0 0">${msg}</p>`; };
  $('#swGo1').onclick = async () => {
    const body = {
      universe: ($('#swUni').value || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean),
      sizes: { singles: $('#swSingles').checked, doubles: $('#swDoubles').checked, triples: $('#swTriples').checked },
      geometry: $('#swGeom').value, permuteGeometry: $('#swPermGeom').checked,
      windowLayout: $('#swLayout').value, allLoaded: $('#swAllData').checked,
      startMonth: $('#swStart').value || undefined, endMonth: $('#swEnd').value || undefined,
      nullN: Number($('#swNull1').value) || 0, desc: $('#swDesc1').value,
    };
    if (!body.universe.length) delete body.universe;
    const got = await tryPost('api/stage1', body);
    if (got) { rememberSweepForm(); say('#swOut1', `started <b>${esc(got.name)}</b> — ${got.units.toLocaleString()} units. Progress above; the set lands on Boards.`); swProgress(); }
  };
  $('#swGo2').onclick = async () => {
    const got = await tryPost('api/stage2', {
      from: $('#swFrom2').value,
      carry: Number($('#swCarry').value) || 0, desc: $('#swDesc2').value,
    });
    if (got) { rememberSweepForm(); say('#swOut2', `started <b>${esc(got.name)}</b> — ${got.units.toLocaleString()} carried units.`); swProgress(); }
  };
  $('#swGo3').onclick = async () => {
    const got = await tryPost('api/stage3', {
      from: $('#swFrom3').value, fee: Number($('#swFee').value) / 100,
      carry: Number($('#swCarry3').value) || 0,
      nullN: Number($('#swNull3').value) || 0, keepN: Number($('#swKeep3').value) || 0, desc: $('#swDesc3').value,
      ...swBlockParams(),
    });
    if (got) { rememberSweepForm(); say('#swOut3', `started <b>${esc(got.name)}</b> — ${got.settings.toLocaleString()} settings × ${got.units.toLocaleString()} units.`); swProgress(); }
  };
  // EVERY BOX THAT CHANGES THE COUNT RE-ASKS IT, AND ON TYPING AS WELL AS ON
  // LEAVING THE BOX (owner, 2026-08-29: "especially it's not working with the
  // null set size").
  //
  // Two faults, one line of wiring each:
  //   * The list of controls was TYPED here, twice, so a control added later
  //     was wired to nothing and its cost line silently stopped tracking it.
  //     It is read off the page now, the same way the form memory reads it.
  //   * Only `change` was wired. On a dropdown or a tick that fires at once,
  //     but on a TYPED box — the null set size, the carry, the universe, the
  //     band — `change` waits for the box to lose focus. So the owner typed a
  //     new null set size, looked at the line, and it still described the old
  //     one. `input` fires on every keystroke and the ask is coalesced, so this
  //     costs one request per burst, not one per character.
  //
  // The description boxes are left out on purpose: they are recorded on the
  // record set and change no count, so asking on them would be pure noise.
  const NO_COUNT = new Set(['swDesc1', 'swDesc2', 'swDesc3']);
  // what is in the boxes survives a screen flip: write the remembered draft
  // back BEFORE anything reads the boxes, then wire every duty in ONE walk of
  // them — remembering the draft, repainting the provenance colours, and
  // re-asking the counts. Two walks over the same list is two lists again, and
  // the one that fell behind would be the one nobody was looking at.
  restoreSweepForm();
  for (const el of sweepControls()) {
    const onChange = () => {
      rememberSweepForm();
      swProvenance();
      if (!NO_COUNT.has(el.id)) swCountsSoon();
    };
    el.addEventListener('change', onChange);
    el.addEventListener('input', onChange);
  }
  swProgress();
  swCounts();
  swProvenance();
}

// ---- Boards ----------------------------------------------------------------
// WHERE YOU WERE, kept like every other page: the picked set, the every-coin
// floors and sort, and the opened records rows ride localStorage so flipping
// away and back lands on the same view.
const BOARDS_VIEW_KEY = 'cx-boards-view';
let bTallyPoll = null;   // asks again while a set's tables are totalling
// THE EVERY-FEW-SECONDS ASK REDRAWS QUIETLY. It repaints the same progress
// line over and over for as long as the work runs — hours, on a big set — and
// a wait box popping up every four seconds for hours is not information, it is
// a page nobody can read. waitSilent is set and cleared around the CALL, which
// works because waitWrap reads it before its first await.
function bPollRedraw() {
  waitSilent = true;
  try { holdScrollMemory(); return drawBoards().then(() => holdScrollMemory()); } finally { waitSilent = false; }
}
function bView() {
  try { return JSON.parse(localStorage.getItem(BOARDS_VIEW_KEY) || '{}') || {}; } catch (_) { return {}; }
}
function bSaveView(patch) {
  try { localStorage.setItem(BOARDS_VIEW_KEY, JSON.stringify({ ...bView(), ...patch })); } catch (_) { /* private window */ }
}

function bMoney(v) { return v == null ? '<span class="muted">—</span>' : `<span class="${v >= 0 ? 'pos' : 'neg'}">${money(v)}</span>`; }
// EVERY COMPARISON TIED IS NOT LOSING EVERY COMPARISON (owner order,
// 2026-08-30). The service works out which rows those are and says so on the
// row; this only prints it. Two places deciding the same thing is two places
// to get it wrong, and it has been exactly that twice already.
//
// ONE wording, read by both columns: they are empty for the same reason and
// the two explanations must never drift apart.
const B_TIED = "every one of these comparisons tied, so there is nothing to count. With gate always a position opens every period whatever the votes say, so shuffling the votes cannot change a cent — the real run and all of its null-set copies make exactly the same money. Read this as cannot be measured here, not as lost every one.";
const bDash = (tied) => (tied ? `<span class="muted" title="${B_TIED}">—</span>` : '<span class="muted">—</span>');
function bShare(share, beat, pairs, tied) {
  if (tied || share == null) return bDash(tied);
  return `<b class="${share > 0.5 ? 'pos' : ''}">${(share * 100).toFixed(1)}%</b> <span class="muted">${Number(beat).toLocaleString()}/${Number(pairs).toLocaleString()}</span>`;
}
const bLead = (v, tied) => (v == null ? bDash(tied) : `×${Number(v).toFixed(1)}`);
const bCoin = (r) => `<b>${esc(r.trade)}</b>${r.ctx1 ? ` + ${esc(r.ctx1)}` : ''}${r.ctx2 ? ` + ${esc(r.ctx2)}` : ''}`;
const bGeo = (g) => { const v = (HELPVOCAB && HELPVOCAB.geometry) || []; const hit = v.find((o) => o.value === g); return hit ? hit.label : g; };

async function drawBoards() {
  if (bTallyPoll) { clearTimeout(bTallyPoll); bTallyPoll = null; }
  if (!HELPVOCAB) HELPVOCAB = await apiOr('api/vocabulary', {});
  const st = await apiOr('api/stagesets', ({ running: null, sets: [] }));
  const sets = st.sets || [];
  const view = bView();
  const rowOf = (id) => sets.find((x) => x.id === id) || null;
  const parentOf = (id) => { const r = rowOf(id); return r && r.parent ? r.parent.id : null; };

  // ONE SECTION PER STAGE (owner order, 2026-08-27). A child's whole
  // provenance rides with it: picking a stage 3 record set fills the stage 2
  // and stage 1 sections with its parents; picking a stage 2 set fills its
  // stage 1 parent; picking a parent puts the child selections away.
  let s3sel = (rowOf(view.s3) || {}).stage === 3 ? view.s3 : null;
  let s2sel = (rowOf(view.s2) || {}).stage === 2 ? view.s2 : null;
  let s1sel = (rowOf(view.s1) || {}).stage === 1 ? view.s1 : null;
  if (s3sel) { s2sel = parentOf(s3sel); s1sel = s2sel ? parentOf(s2sel) : null; }
  else if (s2sel) { s1sel = parentOf(s2sel); }
  if (!s1sel && !s2sel && !s3sel) {
    // first visit: the newest set of the deepest stage present, chain and all
    const newest = sets.find((x) => x.stage === 3) || sets.find((x) => x.stage === 2) || sets.find((x) => x.stage === 1);
    if (newest && newest.stage === 3) { s3sel = newest.id; s2sel = parentOf(s3sel); s1sel = s2sel ? parentOf(s2sel) : null; }
    else if (newest && newest.stage === 2) { s2sel = newest.id; s1sel = parentOf(s2sel); }
    else if (newest) s1sel = newest.id;
    // AND IT IS WRITTEN DOWN, not left in a local (Funnel build, 2026-08-31).
    //
    // This resolution used to live only in these three variables. The saved
    // view got a set id ONLY when the owner CHANGED a picker -- and with one
    // stage 3 set on the box the picker already shows it, so changing it is
    // impossible and the saved view stayed empty forever. Boards looked right
    // because it was reading its own local; anything else asking "which set is
    // open" got nothing, which is exactly what happened to the Funnel: it said
    // "open a set on Boards first" to an owner who had one open, and opening it
    // again could not help because opening it is what Boards had already done
    // without recording it.
    if (s1sel || s2sel || s3sel) bSaveView({ s1: s1sel, s2: s2sel, s3: s3sel });
  }
  const selOf = { 1: s1sel, 2: s2sel, 3: s3sel };
  const fold = { 1: view.fold1 !== false, 2: view.fold2 !== false, 3: view.fold3 !== false };
  const deepest = s3sel ? 3 : (s2sel ? 2 : 1);
  const running = st.running ? rowOf(st.running) : null;

  // the option lists are shared; the six controls carry LITERAL ids so the
  // control reader and the Help tab see every one of them (RULE ONE-A: a
  // list with holes is worse than no list)
  const bOptions = (stage, sel) => `<option value="">— pick a stage ${stage} record set —</option>`
    + sets.filter((x) => x.stage === stage).map((x) => `<option value="${esc(x.id)}"${x.id === sel ? ' selected' : ''}>${esc(x.name)} — ${esc(x.status)} — ${esc((x.createdAt || '').slice(0, 10))}${x.desc ? ` — ${esc(x.desc.slice(0, 40))}` : ''}</option>`).join('');
  const foldBtn = (stage) => `<button data-bfold="${stage}" title="puts this stage's table away, or brings it back. The last state is remembered.">${fold[stage] ? 'put away' : 'open'}</button>`;

  $('#view').innerHTML = `<div class="panel">
    <h3 style="margin-top:0">Boards — the record sets, and what each stage wrote</h3>
    <p class="note">One section per stage, the whole provenance on screen: picking a stage 3 record set fills the
      stage 2 and stage 1 sections with its parents; picking a stage 2 set fills its stage 1 parent; picking a
      parent puts the child selections away. Each section can be put away and comes back as you left it.</p>
    ${running ? `<p class="note"><b>${esc(running.name)}</b> is going: ${esc(running.progress || '…')}</p>` : ''}
  </div>
  <div class="panel">
    <div class="row" style="align-items:flex-end">
      ${foldBtn(1)}
      <h3 style="margin:0">Stage 1</h3>
      <label class="f">record set<select id="bPick1" style="min-width:26rem">${bOptions(1, s1sel)}</select></label>
      <button id="bDelete1" class="danger" ${s1sel ? '' : 'disabled'}>Delete record set…</button>
      <button id="bCopySettings1" ${s1sel ? '' : 'disabled'} title="fill this record set's own stage box on Sweep with its stored settings and description — its parent picked where it has one. The other boxes are left exactly as they are; nothing launches.">copy settings into the form</button>
      ${campaignNoteHtml(rowOf(s1sel))}
    </div>
    <div id="bS1"></div>
  </div>
  <div class="panel">
    <div class="row" style="align-items:flex-end">
      ${foldBtn(2)}
      <h3 style="margin:0">Stage 2</h3>
      <label class="f">record set<select id="bPick2" style="min-width:26rem">${bOptions(2, s2sel)}</select></label>
      <button id="bDelete2" class="danger" ${s2sel ? '' : 'disabled'}>Delete record set…</button>
      <button id="bCopySettings2" ${s2sel ? '' : 'disabled'} title="fill this record set's own stage box on Sweep with its stored settings and description — its parent picked where it has one. The other boxes are left exactly as they are; nothing launches.">copy settings into the form</button>
      ${campaignNoteHtml(rowOf(s2sel))}
    </div>
    <div id="bS2"></div>
  </div>
  <div class="panel">
    <div class="row" style="align-items:flex-end">
      ${foldBtn(3)}
      <h3 style="margin:0">Stage 3</h3>
      <label class="f">record set<select id="bPick3" style="min-width:26rem">${bOptions(3, s3sel)}</select></label>
      <button id="bDelete3" class="danger" ${s3sel ? '' : 'disabled'}>Delete record set…</button>
      <button id="bCopySettings3" ${s3sel ? '' : 'disabled'} title="fill this record set's own stage box on Sweep with its stored settings and description — its parent picked where it has one. The other boxes are left exactly as they are; nothing launches.">copy settings into the form</button>
      ${campaignNoteHtml(rowOf(s3sel))}
    </div>
    <div id="bS3"></div>
  </div>`;

  for (const stage of [1, 2, 3]) {
    const pick = $(`#bPick${stage}`);
    if (pick) {
      pick.onchange = () => {
        const idv = pick.value || null;
        if (stage === 1) bSaveView({ s1: idv, s2: null, s3: null, fold1: true, openS3: [] });
        if (stage === 2) bSaveView({ s1: idv ? parentOf(idv) : null, s2: idv, s3: null, fold1: true, fold2: true, openS3: [] });
        if (stage === 3) bSaveView({ s1: idv ? parentOf(parentOf(idv)) || null : null, s2: idv ? parentOf(idv) : null, s3: idv, fold1: true, fold2: true, fold3: true, openS3: [] });
        drawBoards().then(() => restoreScroll(tab));
      };
    }
    const del = $(`#bDelete${stage}`);
    if (del) {
      del.onclick = async () => {
        const id = selOf[stage];
        if (!id) return;
        const look = await tryPost(`api/stageset/${id}/delete`, {});
        if (!look) return;
        if (!look.preview) { alert('Nothing was deleted — the service answered strangely.'); return; }
        const typed = prompt(`Permanently delete ${look.name} (stage ${look.stage}, ${look.status})?\n\n`
          + `${Number(look.rows).toLocaleString()} record row(s), ${(look.bytes / 1048576).toFixed(1)} MB on disk`
          + `${look.desc ? `\n"${look.desc}"` : ''}\n\nType the record set id back to confirm:\n${look.confirmWith}`, '');
        if (typed === null) return;
        if (typed.trim() !== look.confirmWith) { alert('That is not the record set id — nothing was deleted.'); return; }
        const done = await tryPost(`api/stageset/${id}/delete`, { confirm: typed.trim() });
        if (done && done.deleted) {
          alert(`Deleted ${done.name} — ${Number(done.rows).toLocaleString()} row(s), ${(done.bytes / 1048576).toFixed(1)} MB freed.`);
          const patch = { [`s${stage}`]: null, openS3: [] };
          if (stage <= 2) patch.s3 = null;
          if (stage === 1) patch.s2 = null;
          bSaveView(patch);
          drawBoards().then(() => restoreScroll(tab));
        }
      };
    }
  }
  document.querySelectorAll('[data-bfold]').forEach((btn) => {
    btn.onclick = () => {
      const sN = Number(btn.dataset.bfold);
      bSaveView({ [`fold${sN}`]: !fold[sN] });
      drawBoards().then(() => restoreScroll(tab));
    };
  });

  // Each open section renders its set: the description (bold), the notes and
  // the settings copy on the DEEPEST selection (one notes box per page — the
  // set you are actually working), What this run actually is, then the
  // stage's own table. All drawn by the same functions Boards uses.
  for (const stage of [1, 2, 3]) {
    const mount = $(`#bS${stage}`);
    const sel = selOf[stage];
    if (!mount) continue;
    if (!sel) {
      mount.innerHTML = `<p class="note">${sets.some((x) => x.stage === stage) ? 'nothing picked' : 'no record sets of this stage on this box yet — start one on Sweep'}</p>`;
      continue;
    }
    const got = await apiOr(`api/stageset/${sel}`, null);
    if (!got || !got.set) { mount.innerHTML = '<div class="panel empty">this record set could not be read</div>'; continue; }
    const doc = got.set;
    // the header's settings copy works folded or open — it reads the set,
    // not the table
    const csbN = $(`#bCopySettings${stage}`);
    if (csbN) csbN.onclick = () => {
      tab = 'sweep'; localStorage.setItem('cx-tab', tab);
      draw().then(() => { fillStageForm(doc); });
    };
    if (!fold[stage]) { mount.innerHTML = '<p class="note">put away — press open to bring it back</p>'; continue; }
    const chain = got.chain || [];
    const chainLine = stage === deepest && chain.length ? `<p class="note" style="margin-top:.5rem">${chain.map((c) => `<b>${esc(c.name)}</b> (${[
      c.plan && c.plan.units ? `${Number(c.plan.units).toLocaleString()} units` : null,
      c.plan && c.plan.settings ? `${Number(c.plan.settings).toLocaleString()} settings` : null,
      c.parent && (c.parent.sortedBy || c.parent.orderBy)
        ? `carried ${Number(c.parent.carry).toLocaleString()} by ${c.parent.sortedBy || (c.parent.orderBy === 'lead' ? 'lead over null set' : 'beat its own null set')}`
        : null,
      esc(c.status),
    ].filter(Boolean).join(' · ')})`).join(' → ')}${chain.length > 1 ? ' · price files fingerprint-checked at every launch' : ''}</p>` : '';
    mount.innerHTML = `${chainLine}${descriptionPanelHtml(doc.desc, true)}
      ${stage === 1 ? notesPanel1(doc) : stage === 2 ? notesPanel2(doc) : notesPanel3(doc)}${bKeptFillPanel(doc)}
      ${runIdentityPanelHtml(doc.plan && doc.plan.units ? `<p class="note"><b>Size:</b> <b>${Number(doc.plan.units).toLocaleString()}</b> units${doc.plan.settings ? ` × ${Number(doc.plan.settings).toLocaleString()} settings` : ''}${(doc.params || {}).nullN ? ` · null set size ${doc.params.nullN}` : ''}.</p>` : '', doc.dataManifest || null)}
      <div id="bT${stage}"></div>`;
    wireNotesSave(`api/stageset/${encodeURIComponent(doc.id)}/notes`, null, String(stage));
    if (stage === 3) wireKeptFill(doc.id);
    if (doc.status !== 'done' && doc.status !== 'incomplete') {
      $(`#bT${stage}`).innerHTML = `<div class="panel"><p class="note">${esc(doc.name)} is ${esc(doc.status)}${doc.progress ? ` — ${esc(doc.progress)}` : ''}. Its tables appear when it lands.</p></div>`;
      continue;
    }
    const incomplete = doc.status === 'incomplete'
      // ITS OWN MARKER, NOT THE OUTAGE ONE (2026-08-29). This wore
      // data-role="incomplete", the marker draw() puts on the "a read failed"
      // banner — and they mean opposite things. That one says the screen could
      // not be drawn; this one says the set really is short those units and the
      // numbers below are true but partial. Sharing a marker made the browser
      // harness report a perfectly honest record set as a broken screen, and
      // would have let a real outage hide behind a legitimate notice.
      ? `<div class="panel" data-role="set-incomplete" style="border-color:var(--neg)"><b class="neg">THIS SET DOES NOT MATCH ITS OWN PLAN.</b>
       ${Number((doc.counts || {}).failures || 0)} unit(s) failed and are missing from every table below — read the numbers accordingly.</div>` : '';
    if (doc.stage === 1) await bDrawStage1(doc, incomplete, view, `#bT${stage}`);
    else if (doc.stage === 2) await bDrawStage2(doc, incomplete, view, `#bT${stage}`);
    else await bDrawStage3(doc, incomplete, view, `#bT${stage}`);
  }
}
const btd = 'style="padding:.25rem .5rem"';
const btd0 = 'style="padding:.25rem .5rem .25rem 0"';
const bth = 'style="padding:.3rem .5rem"';

// THE PAGE NUMBER IS TYPED, NOT WALKED TO (owner order, 2026-08-29). prev and
// next move one page; on a table 4,116 pages long that is not a way of getting
// to page 3,000. The page showing sits in the box, so it also says where you
// are, and a number outside the range is pulled back to the nearest real page
// rather than refused.
function bPager(total, from, n, key) {
  if (total <= n) return `<p class="note">${total.toLocaleString()} row(s)</p>`;
  const page = Math.floor(from / n) + 1;
  const pages = Math.ceil(total / n);
  return `<p class="note">${total.toLocaleString()} rows · page
    <input data-bpageto="${key}" data-bpages="${pages}" data-bper="${n}" type="number" min="1" max="${pages}" step="1" value="${page}"
      style="width:5.5rem;vertical-align:baseline"
      title="the page showing. Type the page you want and press enter, or use the arrows on the box; prev and next move one page at a time. A number past the end goes to the last page."> of ${pages}
    <button data-bpage="${key}:${Math.max(0, from - n)}">prev</button>
    <button data-bpage="${key}:${Math.min((pages - 1) * n, from + n)}">next</button></p>`;
}
// THE SORT SELECTORS ON THE STAGE TABLES (owner order, 2026-08-27). Each
// sortable column carries a small button: click sorts by it, click again
// flips the direction, a third click puts it away; the number on the button
// is the sort's priority — first, second, third, three at most. What is
// picked here SAVES ON THE RECORD SET, because it is the exact order the
// next stage's carry forward takes the top of.
function bSortBtn(doc, key, firstDir) {
  const spec = Array.isArray(doc.sort) ? doc.sort : [];
  const at = spec.findIndex((s) => s.key === key);
  const state = at < 0 ? '·' : `${at + 1} ${spec[at].dir === 'desc' ? '↓' : '↑'}`;
  return ` <button data-bsortkey="${key}" data-bsortdir="${firstDir}" style="min-width:2.2rem;padding:0 .25rem"
    title="click to sort the whole table by this column${firstDir === 'desc' ? ' (high to low first)' : ' (A to Z / low to high first)'}; click again to flip it, a third click puts it away. Its number is the sort's priority — first, second, third. The saved order is exactly what carry forward reads at the next stage's launch.">${state}</button>`;
}
function bWireSort(doc, root) {
  if (!$(root)) return;   // the mount went with a redraw; the newer draw wires its own
  $(root).querySelectorAll('[data-bsortkey]').forEach((btn) => {
    btn.onclick = async () => {
      const key = btn.dataset.bsortkey;
      const spec = (Array.isArray(doc.sort) ? doc.sort : []).map((s) => ({ ...s }));
      const at = spec.findIndex((s) => s.key === key);
      if (at < 0) {
        if (spec.length >= 3) { alert('three sort priorities at most — click one of the numbered columns to put it away first'); return; }
        spec.push({ key, dir: btn.dataset.bsortdir === 'asc' ? 'asc' : 'desc' });
      } else if (spec[at].dir === (btn.dataset.bsortdir === 'asc' ? 'asc' : 'desc')) {
        spec[at].dir = spec[at].dir === 'desc' ? 'asc' : 'desc';
      } else {
        spec.splice(at, 1);
      }
      const out = await tryPost(`api/stageset/${encodeURIComponent(doc.id)}/sort`, { sort: spec });
      if (out) drawBoards().then(() => restoreScroll(tab));
    };
  });
}

// THE RANKED TABLE SORTS BY ONE PICKED COLUMN (owner order, 2026-08-27:
// "only a single column to select by is sufficient"). Click sorts by the
// column, click again flips it, a third click puts it away; picking another
// column simply replaces the pick. Saved on the record set like the stage 1
// and stage 2 sorts — but nothing carries out of stage 3, so the button
// promises only what it does: the order of this table.
function bRankSortBtn(doc, key, firstDir) {
  const spec = Array.isArray(doc.sort) ? doc.sort : [];
  const at = spec.findIndex((s) => s.key === key);
  const state = at < 0 ? '·' : (spec[at].dir === 'desc' ? '↓' : '↑');
  return ` <button data-branksort="${key}" data-brankdir="${firstDir}" style="min-width:1.6rem;padding:0 .25rem"
    title="click to sort the whole table by this column${firstDir === 'desc' ? ' (high to low first)' : ' (A to Z / low to high first)'}; click again to flip it, a third click puts it away. One column at a time — picking another column replaces this one. Saved on this record set.">${state}</button>`;
}
function bWireRankSort(doc, root) {
  if (!$(root)) return;   // the mount went with a redraw; the newer draw wires its own
  $(root).querySelectorAll('[data-branksort]').forEach((btn) => {
    btn.onclick = async () => {
      const key = btn.dataset.branksort;
      const first = btn.dataset.brankdir === 'asc' ? 'asc' : 'desc';
      const cur = (Array.isArray(doc.sort) ? doc.sort : []).find((s) => s.key === key);
      const spec = !cur ? [{ key, dir: first }]
        : cur.dir === first ? [{ key, dir: first === 'desc' ? 'asc' : 'desc' }]
          : [];
      const out = await tryPost(`api/stageset/${encodeURIComponent(doc.id)}/sort`, { sort: spec });
      if (out) drawBoards().then(() => restoreScroll(tab));
    };
  });
}

// THE COINS TABLE HOLDS STILL (owner orders, 2026-08-27: "the page must not
// move" on Apply, and again on the records buttons). ANY redraw of the every-
// coin table — Apply, a column sort, a records open/close, a page turn —
// measures where its line of column headings sits in the window and puts it
// back at exactly that height afterwards, whatever the new rows did to the
// page's length. The scroll memory is held shut around the nudge (the page
// moving itself never writes it) and then told the pegged place.
async function bRedrawPeggedToCoinHead() {
  const head = document.querySelector('[data-bcoinhead]');
  const pegTop = head ? head.getBoundingClientRect().top : null;
  await drawBoards();
  holdScrollMemory();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    holdScrollMemory();
    const again = document.querySelector('[data-bcoinhead]');
    if (pegTop != null && again) {
      window.scrollBy(0, again.getBoundingClientRect().top - pegTop);
      rememberScroll(tab);
    } else {
      restoreScroll(tab);   // the table did not come back (e.g. totalling) — the old rule
    }
  }));
}

// SHOW IN 3.B BRINGS TABLE 3.B TO YOU. Every other change to that table holds
// the page still on purpose, because the owner is already looking at it. This
// one is pressed from the table ABOVE and its whole point is the table below,
// so holding still would leave the answer off the bottom of the screen.
async function bRedrawScrolledToCoinHead() {
  await drawBoards();
  holdScrollMemory();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    holdScrollMemory();
    const head = document.querySelector('[data-bcoinhead]');
    if (head) {
      // its own heading and filters sit above the head row, so land a little
      // higher than the row itself or they are cut off the top
      window.scrollBy(0, head.getBoundingClientRect().top - 180);
      rememberScroll(tab);
    } else {
      restoreScroll(tab);
    }
  }));
}

function bWirePager(root) {
  if (!$(root)) return;   // the mount went with a redraw; the newer draw wires its own
  const goTo = (key, from) => {
    if (key === 'S3C') {
      bSaveView({ coins: { ...(bView().coins || {}), offset: from } });
      bRedrawPeggedToCoinHead();
    } else {
      bSaveView({ [`from${key}`]: from });
      drawBoards().then(() => restoreScroll(tab));
    }
  };
  $(root).querySelectorAll('[data-bpage]').forEach((btn) => {
    btn.onclick = () => {
      const [key, from] = btn.dataset.bpage.split(':');
      goTo(key, Number(from));
    };
  });
  // change fires on enter and on the arrows; blur catches a number typed and
  // then clicked away from, which is the same intent and used to be dropped.
  $(root).querySelectorAll('[data-bpageto]').forEach((el) => {
    let jumped = false;                 // change fires, the redraw pulls the box out, blur follows: one jump
    const jump = () => {
      if (jumped) return;
      const key = el.dataset.bpageto;
      const pages = Math.max(1, Number(el.dataset.bpages) || 1);
      const per = Math.max(1, Number(el.dataset.bper) || 100);
      const want = Math.round(Number(el.value));
      if (!Number.isFinite(want)) { el.value = String(Math.floor(Number(el.defaultValue) || 1)); return; }
      const page = Math.min(pages, Math.max(1, want));
      if (page === Number(el.defaultValue)) { el.value = String(page); return; }
      jumped = true;
      goTo(key, (page - 1) * per);
    };
    el.onchange = jump;
    el.onblur = jump;
  });
}

// ONE CLICK ON A COLUMN SORTS THE COINS TABLE BY IT (owner order,
// 2026-08-27); a second click turns the order the other way. The pick lives
// with the rest of this table's view — the same place the sort by box and
// the floors keep theirs — and the whole data set is sorted before the page
// is cut, so page one really is the top of everything.
function bCoinSortBtn(view, key, naturalArrow) {
  const cq = view.coins || {};
  const active = (cq.sort || 'share') === key;
  const flippedArrow = naturalArrow === '↓' ? '↑' : '↓';
  const state = !active ? '·' : (cq.flip ? flippedArrow : naturalArrow);
  return ` <button data-bcoinsort="${key}" data-barrow="${naturalArrow}" style="min-width:1.6rem;padding:0 .25rem"
    title="one click sorts the whole table by this column${naturalArrow === '↓' ? ' — best first' : ' — A to Z'}; a second click turns it the other way.">${state}</button>`;
}
function bWireCoinSort(root) {
  if (!$(root)) return;   // the mount went with a redraw; the newer draw wires its own
  $(root).querySelectorAll('[data-bcoinsort]').forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.bcoinsort;
      const cq = bView().coins || {};
      const active = (cq.sort || 'share') === key;
      bSaveView({ coins: { ...cq, sort: key, flip: active ? !cq.flip : false, offset: 0 } });
      bRedrawPeggedToCoinHead();
    };
  });
}

// ---- WHAT EVERY TABLE ON THIS SCREEN GETS (owner order, 2026-08-28) -------
//
// Filters above it, lined up in one grid so every name ends on the same edge
// and every box starts on the same edge; a fold so it can be put away; and
// sortable columns carrying their priority number. Written once here rather
// than four times below, because four copies is how two tables end up
// disagreeing about what a filter does.
const bFilters = (key) => (bView().filters || {})[key] || {};
// EVERY BOX AT ONCE, not one at a time (owner order, 2026-08-30). A filter used
// to go on the moment a box lost focus, and on a big record set each one of
// those is a minute. Four boxes was four minutes of watching three tables you
// did not ask for. The whole key is replaced, so what is applied is exactly
// what the boxes say — nothing left over from a box that has since been
// emptied.
function bSetFilters(key, next) {
  const all = { ...(bView().filters || {}) };
  all[key] = { ...next };
  for (const k of Object.keys(all[key])) if (all[key][k] === '' || all[key][k] == null) delete all[key][k];
  bSaveView({ filters: all });
}
// Off by default: the whole point is that a box losing focus costs nothing.
const bAuto = (key) => !!(bView().autoApply || {})[key];
const bSaveAuto = (key, on) => bSaveView({ autoApply: { ...(bView().autoApply || {}), [key]: !!on } });
// What the boxes say RIGHT NOW, in the shape bSetFilters stores.
function bBoxesNow(root, key) {
  const out = {};
  if (!$(root)) return out;
  $(root).querySelectorAll(`[data-bfilter^="${key}:"]`).forEach((el) => {
    if (el.value !== '' && el.value != null) out[el.dataset.bfilter.slice(key.length + 1)] = el.value;
  });
  return out;
}
const bSameFilters = (a, b) => {
  const ka = Object.keys(a).sort(); const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => kb[i] === k && String(a[k]) === String(b[k]));
};
// TYPED BACK TO WHAT IT WAS IS NOT A CHANGE (owner order, 2026-08-30). Compared
// against what is actually applied, not against a "something was touched" flag,
// so undoing an edit by hand puts the button back to sleep.
function bApplyState(root, key) {
  if (!$(root)) return;
  const btn = $(root).querySelector(`[data-bapply="${key}"]`);
  if (!btn) return;
  btn.disabled = bAuto(key) || bSameFilters(bBoxesNow(root, key), bFilters(key));
}
function bApplyFilters(root, key) {
  bSetFilters(key, bBoxesNow(root, key));
  bSaveView({ [`from${key}`]: 0 });
  if (key === 'S3C' || key === 'S3R') bRedrawPeggedToCoinHead();
  else drawBoards().then(() => restoreScroll(tab));
}
// spec: [id, name shown, kind, tooltip, options?]  kind: 'text' | 'num' | 'pick'
// ONE VALUE, PRINTED SO IT CAN BE COMPARED DOWN A COLUMN. Whole numbers keep
// their thousands marks and no decimal point; money and shares get two places;
// anything below one gets three, because a lead of 0.043 and a lead of 0.004
// are not the same number and 0.04 says they are.
function bStat(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Number.isInteger(v)) return v.toLocaleString();
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return v.toLocaleString(undefined, { minimumFractionDigits: a >= 1 ? 2 : 3, maximumFractionDigits: a >= 1 ? 2 : 3 });
}
// FOUR NUMBERS BESIDE EVERY FILTER BOX (owner order, 2026-08-29). They come
// from the service, worked out over the rows the table is holding right now —
// so what is read here and what the table counts can never be two different
// sets. A box that takes words rather than a number gets four empty cells, so
// every row of the grid still lines up on the same six columns.
// THE GATES THE ENGINE HAS, read from what it serves and never typed here
// (RULE FIVE). There are three of them, so a typing box was the wrong control:
// it let a gate be typed that matches nothing, and typing "a" quietly kept
// both `always` and `active`. The fourth choice is not a gate — it is what the
// column prints for a setting opened at market, which no gate applies to.
//
// If the engine's list has not arrived, the box stays a typing box rather than
// offering a short one: a dropdown missing choices the system provides is the
// fault this whole vocabulary mechanism exists to stop.
function bGateFilterSpec(hoverPick, hoverType) {
  const list = (VOCAB && VOCAB.gate) || null;
  if (!list || !list.length) return ['gate', 'gate', 'text', hoverType];
  return ['gate', 'gate', 'pick', hoverPick, [...list.map((o) => String(o.value)), 'does not apply']];
}
function bFilterGrid(key, specs, spread) {
  const cur = bFilters(key);
  const box = (sp) => {
    const [id, , kind, , opts] = sp;
    const v = cur[id] == null ? '' : String(cur[id]);
    if (kind === 'pick') {
      return `<select data-bfilter="${key}:${id}"><option value="">any</option>${
        opts.map((o) => `<option value="${esc(o)}"${v === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    }
    // a fifth element of 'wide' on a text box widens it: a setting's name is
    // far longer than a number and a box that cannot show it is a box that
    // cannot be checked
    return `<input data-bfilter="${key}:${id}" type="${kind === 'num' ? 'number' : 'text'}" step="any" value="${esc(v)}"${
      opts === 'wide' ? ' style="width:26rem"' : ''}>`;
  };
  const sp4 = spread || null;
  const stats = (sp) => {
    if (!sp4) return '';
    const st = sp4[sp[0]];
    return `<span class="fstat">${st ? bStat(st.min) : ''}</span><span class="fstat">${st ? bStat(st.median) : ''}</span>`
      + `<span class="fstat">${st ? bStat(st.avg) : ''}</span><span class="fstat">${st ? bStat(st.max) : ''}</span>`;
  };
  // written out one span at a time on purpose: a heading built by a loop is a
  // word on the screen that the closed word list cannot see.
  const head = sp4 ? `<span></span><span></span><span class="fhead">minimum</span><span class="fhead">median</span><span class="fhead">average</span><span class="fhead">maximum</span>` : '';
  return `<div class="filters${sp4 ? ' withspread' : ''}">${head}${specs.map((sp) => `<label title="${esc(sp[3])}"><span class="fname">${esc(sp[1])}</span><span class="fbox">${box(sp)}</span>${stats(sp)}</label>`).join('')}
    <span class="frow"><button data-bapply="${key}" disabled title="puts every box above on at once. Greyed out until a box says something different from what the table is already showing, and greyed out again if you type it back. Not needed while auto-apply settings is ticked.">apply settings</button>
    <label class="c" title="ticked, each box goes on the moment you leave it. Unticked, nothing goes on until you press apply settings — one wait for the whole set of boxes rather than one wait per box, and on a large record set each wait is minutes."><input type="checkbox" data-bauto="${key}"${bAuto(key) ? ' checked' : ''}> auto-apply settings</label>
    <button data-bfilterclear="${key}" title="empties every filter above and shows the whole table again">clear filters</button>${
  key === 'S3C' && bView().s3cBeforePin ? '<button data-bunpin3b title="puts the filters back exactly as they were before show in 3.B took them off, and lets go of the setting it pinned.">revert filters</button>' : ''}</span></div>${
  sp4 ? `<p class="note">The four numbers beside each box are what that column holds in the rows the table is showing now, after every filter above. They move as you filter.</p>` : ''}`;
}
function bWireFilters(root) {
  if (!$(root)) return;   // the mount went with a redraw; the newer draw wires its own
  $(root).querySelectorAll('[data-bfilter]').forEach((el) => {
    const [key] = el.dataset.bfilter.split(':');
    // ON INPUT, not on change: the button has to wake on the first keystroke
    // and go back to sleep the moment the old value is typed back, and change
    // only fires when the box is left.
    el.oninput = () => { if (!bAuto(key)) bApplyState(root, key); };
    el.onchange = () => { if (bAuto(key)) bApplyFilters(root, key); else bApplyState(root, key); };
  });
  $(root).querySelectorAll('[data-bapply]').forEach((btn) => {
    btn.onclick = () => { if (!btn.disabled) bApplyFilters(root, btn.dataset.bapply); };
  });
  $(root).querySelectorAll('[data-bauto]').forEach((cb) => {
    cb.onchange = () => {
      const key = cb.dataset.bauto;
      bSaveAuto(key, cb.checked);
      // Ticking it means "keep it applied", so anything typed and not yet put
      // on goes on now — otherwise it would sit in a box whose button has just
      // been greyed out, looking applied and not being it.
      if (cb.checked && !bSameFilters(bBoxesNow(root, key), bFilters(key))) bApplyFilters(root, key);
      else bApplyState(root, key);
    };
  });
  $(root).querySelectorAll('[data-bunpin3b]').forEach((btn) => {
    btn.onclick = () => {
      const all = { ...(bView().filters || {}) };
      all.S3C = { ...(bView().s3cBeforePin || {}) };
      bSaveView({ filters: all, s3cBeforePin: null, s3cPin: null, openS3: [], coins: { ...(bView().coins || {}), offset: 0 } });
      bRedrawPeggedToCoinHead();
    };
  });
  $(root).querySelectorAll('[data-bfilterclear]').forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.bfilterclear;
      const all = { ...(bView().filters || {}) };
      delete all[key];
      bSaveView({ filters: all, [`from${key}`]: 0, ...(key === 'S3C' ? { s3cBeforePin: null, s3cPin: null } : {}) });
      if (key === 'S3C' || key === 'S3R') bRedrawPeggedToCoinHead();
      else drawBoards().then(() => restoreScroll(tab));
    };
  });
}
// A table's own fold. Open unless the owner put it away, and remembered.
const bTableOpen = (key) => ((bView().tables || {})[key] !== false);
function bFoldBtn(key, title) {
  return `<h3 style="margin-top:0"><button data-btablefold="${key}" style="min-width:1.6rem;padding:0 .3rem;margin-right:.4rem"
    title="puts this table away, or brings it back. It comes back as you left it.">${bTableOpen(key) ? '▾' : '▸'}</button>${title}</h3>`;
}
function bWireTableFold(root) {
  if (!$(root)) return;   // the mount went with a redraw; the newer draw wires its own
  $(root).querySelectorAll('[data-btablefold]').forEach((btn) => {
    btn.onclick = () => {
      const all = { ...(bView().tables || {}) };
      const key = btn.dataset.btablefold;
      all[key] = !bTableOpen(key);
      bSaveView({ tables: all });
      drawBoards().then(() => restoreScroll(tab));
    };
  });
}
// WHICH ROW OF TABLE 3.A IS PINNED, and whether a given row or record IS it.
// One stored fact answers both, so the bold button and the highlighted record
// can never disagree about what was pressed.
const bPin = () => bView().s3cPin || null;
function bPinnedRow(r) {
  const p = bPin();
  return !!p && String(r.label).split(' · ')[0] === p.setting
    && String(r.decision) === String(p.decision)
    && String(r.bandMode) === String(p.bandMode)
    && !!r.weekdaysOnly === !!p.weekdaysOnly;
}
// ...and the one record, out of a coin's eight, that the pinned row actually
// IS. The eight differ only in these three, so exactly one matches.
function bPinnedRecord(r) {
  const p = bPin();
  return !!p && String(r.decision) === String(p.decision)
    && String(r.bandMode) === String(p.bandMode)
    && !!r.weekdaysOnly === !!p.weekdaysOnly;
}

// A SET WHOSE BLOCK IS NOT ALL PRICED SAYS SO, AND CAN BE FILLED IN (owner
// order, 2026-08-30). A set priced before the quorum bar became a dial holds
// five of the eight ways of asking; the block it declares holds all eight. The
// answer is to price what is missing, not to explain the gap on a screen.
//
// Every number here comes from the launch's own enumerator, so what is offered
// and what would run are the same thing.
// THE SETTING NAMES ARE BEHIND (owner order, 2026-08-30). Drawn above the
// fill-in line on purpose: filling in BEFORE renaming prices every one of
// these a second time under its new name, so the order matters and the screen
// has to make it obvious.
// AN UNFINISHED FILL-IN (owner order, 2026-08-30). It writes its rows unit by
// unit and its list of names once, at the end — so a run that stops or dies
// leaves records at positions the list does not reach, and NOTHING is written
// down to say so. This is drawn first because nothing else may run until it
// is settled, and every other pass refuses while it stands.
// WHAT THE CHECK FOUND (owner, 2026-08-30: "how do i know you haven’t made a
// bunch more issues?"). Every line is a plain statement about the records that
// is either true or it is not, and a false one says how many and shows three.
function bCheckLine(doc, check) {
  if (!check) {
    return `<p class="note"><button id="bCheckSet" data-bcheck="${esc(doc.id)}">check this set</button>
      <span class="muted">reads every record and says whether the set is sound. It adds nothing and changes nothing.</span></p>`;
  }
  if (check.error) return `<p class="note warn">the check could not run: ${esc(check.error)}</p>`;
  const rows = (check.checks || []).map((x) => `<li class="${x.ok ? 'pos' : 'neg'}"><b>${x.ok ? 'yes' : 'NO'}</b> — ${esc(x.name)}
    <span class="muted">${esc(x.detail || '')}</span></li>`).join('');
  const b = check.block;
  const blockLine = !b ? ''
    : b.why ? `<li class="muted">the set could not be compared with its own block: ${esc(b.why)}</li>`
      : `<li class="${b.ok ? 'pos' : 'neg'}"><b>${b.ok ? 'yes' : 'NO'}</b> — the set holds exactly what its block declares
        <span class="muted">${Number(b.held).toLocaleString()} held, ${Number(b.declared).toLocaleString()} declared,
        ${Number(b.surplus).toLocaleString()} it holds and the block does not, ${Number(b.missing).toLocaleString()} the block declares and it does not</span></li>`;
  return `<div class="panel" style="border-color:var(--${check.ok && (!b || b.ok) ? 'pos' : 'neg'})">
    <p style="margin:.1rem 0 .4rem"><b>${check.ok && (!b || b.ok) ? 'This set is sound.' : 'This set is NOT sound.'}</b>
    <span class="muted">${Number(check.rows || 0).toLocaleString()} records, ${Number(check.settings || 0).toLocaleString()} settings, ${check.units} units.</span></p>
    <ul style="margin:.2rem 0 .3rem 1.1rem; padding:0">${rows}${blockLine}</ul>
    <button id="bCheckSet" data-bcheck="${esc(doc.id)}">check this set</button></div>`;
}
function bUndoLine(doc, undoing) {
  if (undoing && undoing.error) {
    return `<p class="note warn">undoing the unfinished run failed: ${esc(undoing.error)} — nothing was replaced; the records are exactly as they were.</p>`;
  }
  if (undoing && undoing.running) {
    const pct = undoing.total ? ` (${Math.floor((undoing.done / undoing.total) * 100)}%)` : '';
    return `<p class="note">undoing the unfinished run: <b>${Number(undoing.done).toLocaleString()} of ${Number(undoing.total).toLocaleString()} parts</b>${pct}
      — what is kept is written beside the old records and only swapped in once it is all there. This page asks again every few seconds.</p>`;
  }
  const half = undoing && undoing.half;
  if (!half) return '';
  return `<p class="note warn"><b>this set holds ${Number(half.extra).toLocaleString()} records past the end of its own list of settings.</b>
    A run that fills in the missing settings writes its rows as it goes and its list of names only when it finishes, so a run
    that stopped or died leaves these behind. They cover some of this set’s coins and not others, which would read on every
    table as an ordinary row resting on fewer. Undoing puts the set back exactly as it was before that run started; filling in
    again then prices the whole thing once.
    <button id="bUndoAppend" data-bundoappend="${esc(doc.id)}">undo the unfinished run</button></p>`;
}
function bRenameLine(doc, renaming) {
  if (renaming && renaming.error) {
    return `<p class="note warn">renaming the settings failed: ${esc(renaming.error)} — nothing was replaced; the records are exactly as they were.</p>`;
  }
  if (renaming && renaming.running) {
    const pct = renaming.total ? ` (${Math.floor((renaming.done / renaming.total) * 100)}%)` : '';
    return `<p class="note">renaming the settings: <b>${Number(renaming.done).toLocaleString()} of ${Number(renaming.total).toLocaleString()} parts</b>${pct}
      — the new names are written beside the old records and only swapped in once they are all there. This page asks again every few seconds.</p>`;
  }
  const behind = (renaming && renaming.behind) || 0;
  if (!behind) return '';
  return `<p class="note warn"><b>${Number(behind).toLocaleString()} of this set’s settings are named without the share that decides
    whether two forecasts count as one voice.</b> The names written today carry it, so this set’s own block reads as not declaring
    them — and filling in the missing settings first would price every one of them a second time under its new name.
    Renaming changes names only: nothing is priced again, and no result moves.
    <button id="bRename" data-brename="${esc(doc.id)}">bring the setting names up to date</button></p>`;
}
// SETTINGS THE BLOCK NO LONGER DECLARES (owner order, 2026-08-30). Drawn
// between the rename and the fill-in, which is the order they have to happen
// in: a name that is only behind reads as undeclared too, and filling in
// before dropping prices rows that are about to go.
function bDropLine(doc, gap, dropping) {
  if (dropping && dropping.error) {
    return `<p class="note warn">dropping the settings failed: ${esc(dropping.error)} — nothing was replaced; the records are exactly as they were.</p>`;
  }
  if (dropping && dropping.running) {
    const pct = dropping.total ? ` (${Math.floor((dropping.done / dropping.total) * 100)}%)` : '';
    return `<p class="note">dropping the settings: <b>${Number(dropping.done).toLocaleString()} of ${Number(dropping.total).toLocaleString()} parts</b>${pct}
      — what is kept is written beside the old records and only swapped in once it is all there. This page asks again every few seconds.</p>`;
  }
  // NOTHING TO SAY WHEN THERE IS NOTHING TO DO (owner order, 2026-08-30). This
  // reported the finished state — that nothing is surplus, and how many times
  // settings had been dropped. Both true, and the owner does not want them: a
  // line that can never go away is not information, it is furniture. What was
  // done to a set is still on the set itself.
  const surplus = (gap && gap.surplus) || 0;
  if (!surplus) return '';
  if (gap && gap.behind) return '';   // the rename comes first and says so
  return `<p class="note warn"><b>this set holds ${Number(surplus).toLocaleString()} settings its own block does not declare.</b>
    They price a trade that another setting it holds already prices, so every one of them is a second copy of a row that is
    already here. Dropping them deletes those rows and renumbers what is left; nothing else is touched, and the tables are
    worked out again afterwards.
    <button id="bDropUndeclared" data-bdrop="${esc(doc.id)}">drop the settings the block does not declare</button></p>`;
}
function bFillInLine(doc, gap, filling) {
  // NOT OFFERED WHILE THE NAMES ARE BEHIND. Pressed in that order it would
  // price every behind-named setting a second time; the pass refuses too, and
  // this is so the owner never gets as far as the refusal.
  const behind = (gap && gap.behind) || 0;
  if (filling && filling.error) {
    return `<p class="note warn">filling in the missing settings failed: ${esc(filling.error)} — nothing already priced was touched.</p>`;
  }
  if (filling && filling.running) {
    const pct = filling.total ? ` (${Math.floor((filling.done / filling.total) * 100)}%)` : '';
    return `<p class="note">filling in the settings this block declares: <b>${Number(filling.done).toLocaleString()} of ${Number(filling.total).toLocaleString()} units</b>${pct}
      — running in the background; the tables are worked out again when it lands. This page asks again every few seconds.
      ${filling.stopping ? '<b>stopping after this unit.</b>'
    : `<button id="bStopFill" data-bstopfill="${esc(doc.id)}">stop after this unit</button>`}</p>`;
  }
  if (filling && filling.stopped) {
    return `<p class="note warn"><b>the run was stopped after ${Number(filling.done).toLocaleString()} of ${Number(filling.total).toLocaleString()} units.</b>
      The units that finished are whole and are still on disk, but the ones that did not are not — so the set is not filled in, and
      the line above offers to put it back.</p>`;
  }
  if (!gap || gap.why) {
    return gap && gap.why ? `<p class="note">this set cannot be added to: ${esc(gap.why)}</p>` : '';
  }
  // and the same here: nothing missing, nothing said (owner order, 2026-08-30)
  if (!gap.missing) return '';
  const stop = gap.gate && gap.gate.band === 'refuse';
  return `<p class="note warn"><b>this set holds ${Number(gap.held).toLocaleString()} of the ${Number(gap.declared).toLocaleString()} settings its block declares.</b>
    The missing ${Number(gap.missing).toLocaleString()} are ways of asking that did not exist when it ran, so nothing here can answer for them.
    Pricing them is ${Number(gap.pricings).toLocaleString()} pricings over ${gap.units} unit(s); nothing already priced is read, touched or priced again.
    ${stop ? `<b>It cannot be done on this set:</b> ${esc(gap.gate.message)}`
    : behind ? `<b>Bring the setting names up to date first</b> — ${Number(behind).toLocaleString()} of this set’s
      settings are named the older way, and pricing now would price every one of them a second time under its new name.`
      : `<button id="bFillIn" data-bfillin="${esc(doc.id)}">fill in the missing settings</button>`}</p>`;
}

// A TABLE WRITES INTO ITS MOUNT ONLY IF THE MOUNT IS STILL THERE (2026-08-29).
//
// Each stage table fetches its rows and then writes them into `#bT1/2/3`. If
// anything redraws Boards while that fetch is in flight — a filter, a page
// turn, a fold, a flip away and back — #view is replaced and the mount the
// earlier draw was going to write into no longer exists. `$(mount).innerHTML`
// then threw `Cannot set properties of null`, which under the new rule blanks
// the whole screen and says the section could not be drawn. It could: a NEWER
// draw is already drawing it. Giving up quietly is the right answer, and the
// six wiring helpers below are made tolerant for the same reason — they run
// against the same mount a moment later.
function bPut(mount, html) {
  const el = typeof mount === 'string' ? $(mount) : mount;
  if (!el) return null;                  // superseded: a newer draw owns the screen
  el.innerHTML = html;
  return el;
}

// The line under a table that owns up to what the filters removed.
function bShown(t) {
  const total = (t && t.total) || 0;
  const of = t && t.of != null ? t.of : total;
  return of > total ? `<p class="note">${total.toLocaleString()} of ${of.toLocaleString()} rows — the rest are held back by the filters above.</p>` : '';
}

async function bDrawStage1(doc, incomplete, view, mount) {
  const heading = `Stage 1 — every unit's LOGREG members, scored once (${esc(doc.name)})`;
  if (!bTableOpen('S1')) {
    if (!bPut(mount, `${incomplete}<div class="panel">${bFoldBtn('S1', heading)}
      <p class="note">put away — press the arrow to bring it back.</p></div>`)) return;
    bWireTableFold(mount);
    return;
  }
  const from = Math.max(0, Number(view.fromS1) || 0);
  const qs = new URLSearchParams({ from, n: 100, ...bFilters('S1') }).toString();
  const t = await apiOr(`api/stageset/${doc.id}/stage1?${qs}`, null);
  const rows = (t && t.rows) || [];
  if (!bPut(mount, `${incomplete}<div class="panel">
    ${bFoldBtn('S1', heading)}
    ${bFilterGrid('S1', [
    ['trade', 'coin', 'text', 'shows only rows whose coin contains what you type. Empty shows every coin.'],
    ['ctx', 'alongside', 'text', 'shows only rows read against a coin containing what you type. Empty shows every row.'],
    ['geometry', 'chunk shape', 'text', 'shows only rows whose chunk shape contains what you type, such as daily.'],
    ['scoreMin', 'forecast score at least', 'num', 'hides rows whose forecast score is below this. Empty hides nothing.'],
    ['beatMin', 'beat its own null set at least, %', 'num', 'hides rows that beat less than this share of their null set. Empty hides nothing.'],
    ['leadMin', 'lead over null set at least', 'num', 'hides rows whose lead over null set is below this. Empty hides nothing.'],
    ['voicesMin', 'independent voices at least', 'num', 'hides rows holding fewer independent voices than this. Empty hides nothing.'],
    ['rankMax', 'order at most', 'num', 'hides rows placed lower than this in the order. Empty hides nothing.'],
  ])}
    <div class="scrollx"><table style="border-collapse:collapse">
      <thead><tr style="text-align:left;border-bottom:1px solid var(--line)">
        <th ${bth.replace('.3rem .5rem', '.3rem .5rem .3rem 0')} title="this unit's place under the sort picked on the columns — settled before any filter, so it still says where the row stands in the whole set.">order</th>
        <th ${bth} title="the traded coin. Anything listed under alongside is context only — read against, never bought or sold.">coin${bSortBtn(doc, 'trade', 'asc')}</th>
        <th ${bth} title="the one or two coins this unit is read against — blank for a coin judged on its own">alongside${bSortBtn(doc, 'ctx', 'asc')}</th>
        <th ${bth} title="how long a stretch of prices each decision looks at, and how often a decision is made — fixed when the unit was trained.">chunk shape${bSortBtn(doc, 'geometry', 'asc')}</th>
        <th ${bth} title="how many members vote for this unit at stage 1 — one per reading, all LOGREG.">members${bSortBtn(doc, 'members', 'desc')}</th>
        <th ${bth} title="how many of those members are INDEPENDENT. Members that call the same way almost every time count as one voice however differently they were built, so this is the number of real opinions behind the vote.">independent voices${bSortBtn(doc, 'voices', 'desc')}</th>
        <th ${bth} title="the sureness the pooled votes placed on what actually happened, summed over the test window. Comparable only among units of the same chunk shape — the two null-set columns are what compare across shapes.">forecast score${bSortBtn(doc, 'score', 'desc')}</th>
        <th ${bth} title="of its null set — the same kept votes with the calendar shuffled away — how many this unit's forecast score beat">beat its own null set${bSortBtn(doc, 'beat', 'desc')}</th>
        <th ${bth} title="how far above its null set's typical forecast score the real one sits, against the null set's own spread — the tie-break">lead over null set${bSortBtn(doc, 'lead', 'desc')}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td ${btd0}>${Number(r.rank).toLocaleString()}</td>
        <td ${btd}>${bCoin(r)}</td>
        <td ${btd}${r.ctx1 ? '' : ' class="muted"'}>${r.ctx1 ? esc([r.ctx1, r.ctx2].filter(Boolean).join(' + ')) : '—'}</td>
        <td ${btd}>${esc(bGeo(r.geometry))}</td>
        <td ${btd}>${r.members == null ? '—' : r.members}</td>
        <td ${btd}${r.voices != null && r.members && r.voices < r.members ? ' class="warn"' : ''}>${r.voices == null ? '—' : r.voices}</td>
        <td ${btd}>${r.score == null ? '—' : r.score.toFixed(1)}</td>
        <td ${btd}>${bShare(r.pairs ? r.beat / r.pairs : null, r.beat, r.pairs)}</td>
        <td ${btd}>${bLead(r.lead)}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">nothing here</td></tr>'}</tbody></table></div>
    ${bShown(t)}
    ${bPager((t && t.total) || 0, from, 100, 'S1')}
    <p class="note">Ordered by the sort picked on the columns — saved on this record set, and exactly what a stage 2
      carry forward takes the top of. With nothing picked: beat its own null set, ties broken by lead over null set —
      the fixed rule. Independent voices below members means some members are near-copies of each other and the
      committee is smaller than it looks. No money on this table because stage 1 never prices a trade.</p>
  </div>`)) return;
  bWirePager(mount);
  bWireSort(doc, mount);
  bWireFilters(mount);
  bWireTableFold(mount);
}

async function bDrawStage2(doc, incomplete, view, mount) {
  const heading = `Stage 2 — the carried rows, LOGREG joined by BOOST (${esc(doc.name)}${doc.parent ? `, out of ${esc(doc.parent.name)}` : ''})`;
  if (!bTableOpen('S2')) {
    if (!bPut(mount, `${incomplete}<div class="panel">${bFoldBtn('S2', heading)}
      <p class="note">put away — press the arrow to bring it back.</p></div>`)) return;
    bWireTableFold(mount);
    return;
  }
  const from = Math.max(0, Number(view.fromS2) || 0);
  const qs = new URLSearchParams({ from, n: 100, ...bFilters('S2') }).toString();
  const t = await apiOr(`api/stageset/${doc.id}/stage2?${qs}`, null);
  const rows = (t && t.rows) || [];
  if (!bPut(mount, `${incomplete}<div class="panel">
    ${bFoldBtn('S2', heading)}
    ${bFilterGrid('S2', [
    ['trade', 'coin', 'text', 'shows only rows whose coin contains what you type. Empty shows every coin.'],
    ['ctx', 'alongside', 'text', 'shows only rows read against a coin containing what you type. Empty shows every row.'],
    ['geometry', 'chunk shape', 'text', 'shows only rows whose chunk shape contains what you type, such as daily.'],
    ['membersMin', 'members at least', 'num', 'hides rows with fewer members than this. Empty hides nothing.'],
    ['voicesMin', 'independent voices at least', 'num', 'hides rows holding fewer independent voices than this. Empty hides nothing.'],
    ['scoreAllMin', 'forecast score — all members at least', 'num', 'hides rows scoring below this with every member pooled. Empty hides nothing.'],
    ['helpedMin', 'fuller board helped at least', 'num', 'hides rows the BOOST members helped by less than this. Empty hides nothing.'],
    ['beatMin', 'beat its own null set at least, %', 'num', 'hides rows that beat less than this share of their null set. Empty hides nothing.'],
    ['leadMin', 'lead over null set at least', 'num', 'hides rows whose lead over null set is below this. Empty hides nothing.'],
    ['s1rankMax', 'stage 1 order at most', 'num', 'hides rows that placed lower than this at stage 1. Empty hides nothing.'],
  ])}
    <div class="scrollx"><table style="border-collapse:collapse">
      <thead><tr style="text-align:left;border-bottom:1px solid var(--line)">
        <th ${bth.replace('.3rem .5rem', '.3rem .5rem .3rem 0')} title="this unit's place under the sort picked on the columns — settled before any filter, so it still says where the row stands in the whole set.">stage 2 order</th>
        <th ${bth} title="where the same unit ranked at stage 1">stage 1 order${bSortBtn(doc, 's1rank', 'asc')}</th>
        <th ${bth} title="the traded coin. Anything listed under alongside is context only — read against, never bought or sold.">coin${bSortBtn(doc, 'trade', 'asc')}</th>
        <th ${bth} title="the one or two coins this unit is read against — blank for a coin judged on its own">alongside${bSortBtn(doc, 'ctx', 'asc')}</th>
        <th ${bth} title="how long a stretch of prices each decision looks at, and how often a decision is made — fixed when the unit was trained.">chunk shape${bSortBtn(doc, 'geometry', 'asc')}</th>
        <th ${bth} title="how many members vote for this unit now, and what they are">members${bSortBtn(doc, 'members', 'desc')}</th>
        <th ${bth} title="how many of those members are INDEPENDENT. Members that call the same way almost every time count as one voice however differently they were built. The figure in brackets is what it was before the BOOST members joined, so what the fuller board bought in real opinions is visible here.">independent voices${bSortBtn(doc, 'voices', 'desc')}</th>
        <th ${bth} title="the unit's forecast score with only the stage 1 members pooled">forecast score — stage 1 members${bSortBtn(doc, 'score3', 'desc')}</th>
        <th ${bth} title="the same fixed score with every member pooled, BOOST included">forecast score — all members${bSortBtn(doc, 'scoreAll', 'desc')}</th>
        <th ${bth} title="all-members score minus stage-1-members score — what the BOOST members bought, before any pricing">fuller board helped?${bSortBtn(doc, 'helped', 'desc')}</th>
        <th ${bth} title="of its null set — the same kept votes with the calendar shuffled away — how many this unit's forecast score beat, as stage 1 read it. Carried with the unit; the BOOST members never face a null set.">beat its own null set${bSortBtn(doc, 'beat', 'desc')}</th>
        <th ${bth} title="how far above its null set's typical forecast score the real one sits, against the null set's own spread — the stage 1 tie-break, carried with the unit">lead over null set${bSortBtn(doc, 'lead', 'desc')}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td ${btd0}>${Number(r.rank).toLocaleString()}</td>
        <td ${btd}>${r.s1rank == null ? '—' : Number(r.s1rank).toLocaleString()}</td>
        <td ${btd}>${bCoin(r)}</td>
        <td ${btd}${r.ctx1 ? '' : ' class="muted"'}>${r.ctx1 ? esc([r.ctx1, r.ctx2].filter(Boolean).join(' + ')) : '—'}</td>
        <td ${btd}>${esc(bGeo(r.geometry))}</td>
        <td ${btd}>${r.members} — ${r.logreg} LOGREG + ${r.boost} BOOST</td>
        <td ${btd}${r.voices != null && r.members && r.voices < r.members ? ' class="warn"' : ''}>${r.voices == null ? '—' : r.voices}${r.voices3 == null ? '' : ` <span class="muted">(${r.voices3} before BOOST)</span>`}</td>
        <td ${btd}>${r.score3 == null ? '—' : r.score3.toFixed(1)}</td>
        <td ${btd}>${r.scoreAll == null ? '—' : r.scoreAll.toFixed(1)}</td>
        <td ${btd}>${r.helped == null ? '—' : `<span class="${r.helped >= 0 ? 'pos' : 'neg'}">${r.helped >= 0 ? '+' : ''}${r.helped.toFixed(1)}</span>`}</td>
        <td ${btd}>${bShare(r.pairs ? r.beat / r.pairs : null, r.beat, r.pairs)}</td>
        <td ${btd}>${bLead(r.lead)}</td></tr>`).join('') || '<tr><td colspan="12" class="empty">nothing here</td></tr>'}</tbody></table></div>
    ${bShown(t)}
    ${bPager((t && t.total) || 0, from, 100, 'S2')}
    <p class="note">Ordered by the sort picked on the columns — saved on this record set, and exactly what a stage 3
      carry forward takes the top of. With nothing picked: forecast score — all members, best first; ties keep their
      carry order either way. Independent voices below members means some members are near-copies; if the BOOST
      members added members without adding voices, this is where that shows. No money on this table: a stage 2
      record is training inventory. Pricing and the held-back window belong to stage 3.</p>
  </div>`)) return;
  bWirePager(mount);
  bWireSort(doc, mount);
  bWireFilters(mount);
  bWireTableFold(mount);
}

async function bDrawStage3(doc, incomplete, view, mount) {
  const from = Math.max(0, Number(view.fromS3R) || 0);
  const coinsQ = view.coins || {};
  const coinF = bFilters('S3C');
  const qs = new URLSearchParams({
    sort: coinsQ.sort || 'share', flip: coinsQ.flip ? '1' : '',
    minPairs: coinF.minPairs ?? '', minShare: coinF.minShare ?? '', minTest: coinF.minTest ?? '',
    minHold: coinF.minHold ?? '', minTrades: coinF.minTrades ?? '', minVsLong: coinF.minVsLong ?? '',
    minAgreed: coinF.minAgreed ?? '', setting: coinF.setting ?? '',
    offset: coinsQ.offset || 0, limit: 100,
  }).toString();
  const rankQs = new URLSearchParams({ from, n: 100, ...bFilters('S3R') }).toString();
  const [ranked, coins, gap, filling, renaming, dropping, undoing] = await Promise.all([
    apiOr(`api/stageset/${doc.id}/ranked?${rankQs}`, null),
    apiOr(`api/stageset/${doc.id}/coins?${qs}`, null),
    apiOr(`api/stageset/${doc.id}/missing`, null),
    apiOr(`api/stageset/${doc.id}/fill-in/status`, null),
    apiOr(`api/stageset/${doc.id}/rename-settings/status`, null),
    apiOr(`api/stageset/${doc.id}/drop-undeclared/status`, null),
    apiOr(`api/stageset/${doc.id}/undo-append/status`, null),
  ]);
  // A finished set whose tables are missing totals itself when opened (the
  // durable fix, owner order 2026-08-27): the service reports how far the
  // totalling has got, the page shows it plainly and asks again every few
  // seconds until the tables land. A failure is said, never retried blind.
  const t = ranked && (ranked.totalling || ranked.waiting || ranked.failed) ? ranked : null;
  if (t) {
    const tp = t.totalling;
    const pct = tp && tp.total ? ` (${Math.floor((tp.done / tp.total) * 100)}%)` : '';
    if (!bPut(mount, `${incomplete}<div class="panel">
      <h3 style="margin-top:0">Stage 3 — settings priced from the kept votes (${esc(doc.name)}${doc.parent ? `, out of ${esc(doc.parent.name)}` : ''})</h3>
      ${t.failed ? `<p class="note"><b class="warn">the totalling failed:</b> ${esc(t.failed)} — the records are all kept; the totalling can be tried again after a service restart.</p>`
    : t.waiting ? `<p class="note">the tables are not totalled yet — ${esc(t.waiting)}. This page asks again every few seconds.</p>`
      : `<p class="note">${tp && tp.phase ? esc(tp.phase) : 'totalling the tables'}: <b>${tp ? `${Number(tp.done).toLocaleString()} of ${Number(tp.total).toLocaleString()} ${esc(tp.word || 'parts')}` : 'starting'}</b>${pct} — building in the background; the tables appear here when it lands. This page asks again every few seconds and leaves your place on it alone.</p>`}
    </div>`)) return;
    if (!t.failed) bTallyPoll = setTimeout(() => { if (tab === 'boards') bPollRedraw(); }, 4000);
    return;
  }
  const rr = (ranked && ranked.rows) || [];
  const cr = (coins && coins.rows) || [];
  const keyOf = (r) => [r.cellLabel, r.trade, r.ctx1 || '', r.ctx2 || '', r.geometry].join('|');
  // 'all' means every row the table is showing: set by show in 3.B, which
  // cannot know the keys until the rows come back from the service. Declared
  // after keyOf on purpose — a const read before its own line throws.
  const openKeys = view.openS3 === 'all' ? new Set(cr.map((r) => keyOf(r))) : new Set(view.openS3 || []);
  const swHead = `Stage 3 — settings priced from the kept votes (${esc(doc.name)}${doc.parent ? `, out of ${esc(doc.parent.name)}` : ''})`;
  if (!bPut(mount, `${incomplete}<div class="panel">
    ${bFoldBtn('S3R', swHead)}
    ${!bTableOpen('S3R') ? '<p class="note">put away — press the arrow to bring it back.</p>' : `
    ${bCheckLine(doc, bView().checked && bView().checked.id === doc.id ? bView().checked.res : null)}
    ${bUndoLine(doc, undoing)}
    ${(undoing && undoing.half) ? '' : bRenameLine(doc, renaming)}
    ${(undoing && undoing.half) ? '' : bDropLine(doc, gap, dropping)}
    ${(undoing && undoing.half && !(filling && (filling.running || filling.stopped))) ? '' : bFillInLine(doc, gap, filling)}
    <p class="t3head"><b>Table 3.A: Settings, ranked</b> — one row per permuted Sweep Stage 3 setting, averaged over its coin/chunk-shape combinations promoted from Stage 2</p>
    ${bFilterGrid('S3R', [
    ['rule', 'quorum by', 'pick', 'shows only settings weighing the members this way. any shows every one.',
      ((VOCAB && VOCAB.agreeRule) || []).map((o) => String(o.value))],
    ['bar', 'quorum bar', 'pick', 'shows only settings whose bar was set this way. all of them is a share of the committee\'s size; its own history is a share of what it actually reached. any shows both.',
      ['all of them', 'its own history']],
    ['decision', 'decision', 'pick', 'shows only settings using this decision. any shows both.', ['argmax', 'directional']],
    ['entry', 'entry', 'pick', 'shows only settings opened this way. any shows both.', ['market', 'breakout']],
    bGateFilterSpec(
      'shows only settings using this gate. does not apply picks the ones opened at market, which no gate applies to '
      + '— the ones showing a dash in the column. any shows every setting.',
      'shows only settings whose gate contains what you type. Type does not apply for the ones opened at market. '
      + 'Empty shows every setting.',
    ),
    ['tMin', 't at least, hours', 'num', 'hides settings held for fewer hours than this. Empty hides nothing.'],
    ['tMax', 't at most, hours', 'num', 'hides settings held for more hours than this. Empty hides nothing.'],
    ['coinsMin', 'coins at least', 'num', 'hides settings priced on fewer coins than this. Empty hides nothing.'],
    ['testMin', 'avg test $ at least', 'num', 'hides settings whose average test money is below this. Empty hides nothing.'],
    ['holdMin', 'avg held-back $ at least', 'num', 'hides settings whose average held-back money is below this. Empty hides nothing.'],
    ['tradesMin', 'avg held-back trades at least', 'num', 'hides settings with fewer average entries than this. Empty hides nothing.'],
    ['vsLongMin', 'avg vs always-long $ at least', 'num', 'hides settings that beat just holding the coin by less than this. Empty hides nothing.'],
    ['beatMin', 'beat its own null set at least, %', 'num', 'hides settings that won less than this share of their head-to-heads. Empty hides nothing.'],
    ['leadMin', 'lead over null set at least', 'num', 'hides settings whose lead over null set is below this. Empty hides nothing.'],
    ['beatNoiseMin', 'beat the kept null money at least, %', 'num', 'hides settings that beat less than this share of the kept scrambled copies of the whole table. Empty hides nothing.'],
    ['inMoneyMin', 'coins in the money at least', 'num', 'hides settings where fewer coins than this made money. Empty hides nothing.'],
    ['voicesMin', 'independent voices at least', 'num', 'hides settings whose committees held fewer independent voices than this. Empty hides nothing.'],
    ['agreedMin', 'share that agreed at least, %', 'num', 'hides every setting whose members agreed by less than this on average. Empty hides nothing.'],
  ], ranked && ranked.spread)}
    <div class="scrollx"><table style="border-collapse:collapse">
      <thead><tr style="text-align:left;border-bottom:1px solid var(--line)">
        <th ${bth.replace('.3rem .5rem', '.3rem .5rem .3rem 0')} title="where this setting sits in the table as it is ordered and filtered right now. It is a position, not a score: change the sort or a filter and the same setting gets a different number.">#</th>
        <th ${bth} style="white-space:nowrap" title="shows, in Table 3.B below, only the coins this setting was priced on and nothing else. Those rows average every decision, band and 24/5 variant of the setting, not just this row's — the rows column there says how many. Press clear filters under Table 3.B to bring the rest back.">show in 3.B</th>
        <th ${bth} title="how the members' votes become a call — priced from the kept votes.">decision${bRankSortBtn(doc, 'decision', 'asc')}</th>
        <th ${bth} title="the size a move must reach to count as a move at all. auto is worked out from each coin's own history.">band${bRankSortBtn(doc, 'bandMode', 'asc')}</th>
        <th ${bth} title="whether this setting trades weekdays only.">24/5${bRankSortBtn(doc, 'weekdaysOnly', 'asc')}</th>
        <th ${bth} title="how the position is opened.">entry${bRankSortBtn(doc, 'entry', 'asc')}</th>
        <th ${bth} title="when a position may be opened at all. A dash means the box does not apply to this setting.">gate${bRankSortBtn(doc, 'gate', 'asc')}</th>
        <th ${bth} title="how far from the starting price the opening level sits. A dash means it does not apply.">d${bRankSortBtn(doc, 'dMult', 'asc')}</th>
        <th ${bth} title="how many hours a position is held before it is closed, if nothing else closed it first.">t${bRankSortBtn(doc, 'tHours', 'asc')}</th>
        <th ${bth} title="which stop the setting uses. static sits still on the far side of the entry; a dash means it does not apply.">trail${bRankSortBtn(doc, 'trailMult', 'asc')}</th>
        <th ${bth} title="how far price must move in your favour before a following stop starts. A dash means it does not apply.">arm${bRankSortBtn(doc, 'armMult', 'asc')}</th>
        <th ${bth} title="the quorum this setting used: what was weighed, and what bar it had to clear. count is a head count; conviction is how hard the members leaned, added up; voices is a head count in which near-copies share one vote; families is how many different kinds of evidence agreed. own beside it means the bar came from this committee's own history rather than from a share of its size — so share means the strongest that fraction of its moments, not that fraction of its members.">quorum by${bRankSortBtn(doc, 'agreeRule', 'asc')}</th>
        <th ${bth} title="what ACTUALLY agreed at the moments this setting spoke, averaged over them and over its coins, as a share of whatever the rule counts. Every rule fires at or above the bar it was built on, never only on it, so this sits at that bar or above it — 100% means every member lined up every time. Measured on the test window; the held-back window is never read for it.">share that agreed${bRankSortBtn(doc, 'avgAgreed', 'desc')}</th>
        <th ${bth} title="the bar this setting was built to clear, in whatever it weighs, averaged because committees can differ in size. Against all of them it is a share of the committee worked out as a count; against its own history it is the amount this committee had to reach. The share it was built on is in its name.">rung it landed on${bRankSortBtn(doc, 'avgRung', 'desc')}</th>
        <th ${bth} title="how many INDEPENDENT voices the committees held, averaged over the coins. Members that call the same way almost every time count as one voice, so this is how many real opinions the setting rests on.">independent voices${bRankSortBtn(doc, 'avgVoices', 'desc')}</th>
        <th ${bth} title="how many coins this setting was priced on.">coins${bRankSortBtn(doc, 'coins', 'desc')}</th>
        <th ${bth} title="average money per coin on the test window — flattering by construction, because the carry was ordered on that window.">avg test $${bRankSortBtn(doc, 'avgTest', 'desc')}</th>
        <th ${bth} title="the once-only look, on data no ordering ever read">avg held-back $${bRankSortBtn(doc, 'avgHold', 'desc')}</th>
        <th ${bth} title="average entries per coin in the held-back window.">avg held-back trades${bRankSortBtn(doc, 'avgTrades', 'desc')}</th>
        <th ${bth} title="average held-back money per coin minus just holding the coin over the same window.">avg vs always-long $${bRankSortBtn(doc, 'avgVsLong', 'desc')}</th>
        <th ${bth} title="across every coin and every null-set deal, the share of held-back head-to-heads won">beat its own null set${bRankSortBtn(doc, 'beat', 'desc')}</th>
        <th ${bth} title="of the kept scrambled copies of this whole table, how many this row's avg test $ beat. Two things make it different from beat its own null set: it reads TEST money, not held-back, so nothing here opens the sealed window; and each copy is the WHOLE table scrambled the same way, so a row has to beat what the shuffle managed across every setting, not just its own scrambled twins. Empty on a set that kept none - set null set money kept on Sweep before the run.">beat the kept null money${bRankSortBtn(doc, 'beatNoise', 'desc')}</th>
        <th ${bth} title="per coin, how far the real held-back money sits above its null-set deals' typical, against their spread — averaged over the coins. The tie-break's twin at the pricing stage.">lead over null set${bRankSortBtn(doc, 'avgLead', 'desc')}</th>
        <th ${bth} title="of the coins priced, how many made money on the held-back window — an average carried by two big coins cannot hide here.">coins in the money${bRankSortBtn(doc, 'coinsInMoney', 'desc')}</th></tr></thead>
      <tbody>${rr.map((r, i) => `<tr>
        <td ${btd0} class="muted" style="white-space:nowrap">${(from + i + 1).toLocaleString()}</td>
        <td ${btd} style="white-space:nowrap"><button id="bPin3b" data-bpin3b="${esc(String(r.label).split(' · ')[0])}"
          data-bpindec="${esc(String(r.decision))}" data-bpinband="${esc(String(r.bandMode))}" data-bpinwk="${r.weekdaysOnly ? 1 : 0}"
          style="white-space:nowrap${bPinnedRow(r) ? ';font-weight:700' : ''}">show in 3.B</button></td>
        <td ${btd}>${esc(r.decision)}</td>
        <td ${btd}>${r.bandMode === 'auto' ? 'auto' : `${esc(String(r.bandMode))}%`}</td>
        <td ${btd}>${r.weekdaysOnly ? 'yes' : 'no'}</td>
        <td ${btd}>${esc(r.entry)}</td>
        <td ${btd}${r.entry === 'market' ? ' class="muted"' : ''}>${r.entry === 'market' ? '—' : esc(r.gate)}</td>
        <td ${btd}${r.dMult == null ? ' class="muted"' : ''}>${r.dMult == null ? '—' : `${r.dMult}×`}</td>
        <td ${btd}>${r.tHours}h</td>
        <td ${btd}${r.trailMult == null ? ' class="muted"' : ''}>${r.trailMult == null ? (r.entry === 'market' ? '—' : 'static') : `${r.trailMult}×`}</td>
        <td ${btd}${r.trailMult == null ? ' class="muted"' : ''}>${r.trailMult == null ? '—' : `${r.armMult}×`}</td>
        <td ${btd}>${esc(r.agreeRule || 'count')}${r.agreeBar === 'own' ? ' <span class="muted">own</span>' : ''}${r.agreeRule === 'voices' && r.agreeCopy ? ` <span class="muted">1v${r.agreeCopy}</span>` : ''}${r.agreeBoth ? ' <span class="muted">+both</span>' : ''}${r.agreePersist ? ` <span class="muted">+hold${r.agreePersist}</span>` : ''}</td>
        <td ${btd}>${r.avgAgreed == null ? '<span class="muted">—</span>' : `${r.avgAgreed.toFixed(1)}%`}</td>
        <td ${btd}>${r.avgRung == null ? '—' : r.avgRung.toFixed(1)}${r.members ? ` <span class="muted">of ${r.members}</span>` : ''}</td>
        <td ${btd}${r.avgVoices != null && r.members && r.avgVoices < r.members ? ' class="warn"' : ''}>${r.avgVoices == null ? '—' : r.avgVoices.toFixed(1)}</td>
        <td ${btd}>${r.coins}</td>
        <td ${btd}>${bMoney(r.avgTest)}</td>
        <td ${btd}>${bMoney(r.avgHold)}</td>
        <td ${btd}>${r.avgTrades == null ? '—' : r.avgTrades.toFixed(1)}</td>
        <td ${btd}>${bMoney(r.avgVsLong)}</td>
        <td ${btd}>${bShare(r.pairs ? r.beat / r.pairs : null, r.beat, r.pairs, r.nullTies)}</td>
        <td ${btd}>${r.noisePairs ? bShare(r.beatNoise / r.noisePairs, r.beatNoise, r.noisePairs) : '<span class="muted">—</span>'}</td>
        <td ${btd}>${bLead(r.avgLead, r.nullTies)}</td>
        <td ${btd}${r.coinsInMoney > r.coins / 2 ? ' class="pos"' : ''}>${r.coinsInMoney} of ${r.coins}</td></tr>`).join('') || '<tr><td colspan="24" class="empty">nothing here</td></tr>'}</tbody></table></div>
    ${ranked && ranked.agreedError ? `<p class="note warn">share that agreed is empty on this set — ${esc(ranked.agreedError)}</p>` : ''}
    ${bShown(ranked)}
    ${bPager((ranked && ranked.total) || 0, from, 100, 'S3R')}
    <p class="note">Ordered by the sort picked on the columns — one column at a time, saved on this record set. With
      nothing picked: beat its own null set, best first. Independent voices below members means the committees held
      near-copies, so the setting rests on fewer real opinions than its member count suggests.</p>
    `}
    <div class="t3break"></div>
    <p class="t3head"><b>Table 3.B: Every coin of every setting</b> — one row for each "short" setting x (each coin + chunk shape); every row averages the "factored out" settings: decision, band and 24/5 variants of the short setting, which are provided as sub-rows</p>
    ${bFilterGrid('S3C', [
    ['minShare', 'beat its own null set at least, %', 'num', 'hides rows that won less than this share of their head-to-heads. Empty hides nothing.'],
    ['minPairs', 'comparisons at least', 'num', 'hides rows whose share rests on fewer head-to-heads than this. Empty hides nothing.'],
    ['minTest', 'avg test $ at least', 'num', 'hides rows whose average test-window money is below this. Empty hides nothing.'],
    ['minHold', 'avg held-back at least, $', 'num', 'hides rows whose average held-back money is below this. Empty hides nothing.'],
    ['minTrades', 'avg trades at least', 'num', 'hides rows with fewer average entries than this. Empty hides nothing.'],
    ['minVsLong', 'avg vs always-long at least, $', 'num', 'hides rows that beat just holding the coin by less than this. Empty hides nothing.'],
    ['minBeatNoise', 'beat the kept null money at least, %', 'num', 'hides rows that beat less than this share of the kept scrambled copies of the whole table. Empty hides nothing.'],
    ['minAgreed', 'share that agreed at least, %', 'num', 'hides rows whose records agreed by less than this on average. Empty hides nothing.'],
    ['setting', 'Table 3.A selection setting', 'text', 'shows only the coins of the setting named here, matched whole. show in 3.B on a row of Table 3.A fills this in for you and takes every other filter off. Empty shows every setting.', 'wide'],
  ], coins && coins.spread)}
    <div class="scrollx"><table style="border-collapse:collapse"><thead><tr data-bcoinhead style="text-align:left;border-bottom:1px solid var(--line)">
        <th ${bth.replace('.3rem .5rem', '.3rem .5rem .3rem 0')} title="the setting with decision, band and 24/5 taken out of its name, so one of these stands for all its decision, band and 24/5 variants at once — they are the records underneath, and the rows column counts them. Table 3.A holds the full settings, which is why it has more rows than this column has values.">SHORT SETTING: DECISION, BAND, 24/5 FACTORED OUT${bCoinSortBtn(view, 'setting', '↑')}</th>
        <th ${bth} title="the traded coin and the chunk shape it was priced at — both are in this one cell, and the row is one setting on one coin at one chunk shape. Anything listed under alongside is context only — read against, never bought or sold.">coin + chunk shape${bCoinSortBtn(view, 'coin', '↑')}</th>
        <th ${bth} title="of the head-to-heads between this coin's held-back money and its null-set deals, the share it won.">beat its own null set${bCoinSortBtn(view, 'share', '↓')}</th>
        <th ${bth} title="of the kept scrambled copies of this whole table, how many this row's avg test $ beat. Two things make it different from beat its own null set: it reads TEST money, not held-back, so nothing here opens the sealed window; and each copy is the WHOLE table scrambled the same way, so a row has to beat what the shuffle managed across every setting, not just its own scrambled twins. Empty on a set that kept none - set null set money kept on Sweep before the run.">beat the kept null money${bCoinSortBtn(view, 'beatnoise', '↓')}</th>
        <th ${bth} title="how many head-to-heads the share rests on.">comparisons${bCoinSortBtn(view, 'pairs', '↓')}</th>
        <th ${bth} title="average test-window money per record — flattering by construction, because the carry was ordered on that window.">avg test $${bCoinSortBtn(view, 'test', '↓')}</th>
        <th ${bth} title="average held-back money per record.">avg held-back${bCoinSortBtn(view, 'money', '↓')}</th>
        <th ${bth} title="average held-back entries per record.">avg trades${bCoinSortBtn(view, 'trades', '↓')}</th>
        <th ${bth} title="average held-back money minus just holding the coin over the same window.">avg vs always-long${bCoinSortBtn(view, 'vslong', '↓')}</th>
        <th ${bth} title="what ACTUALLY agreed at the moments this coin's records spoke, averaged over the records underneath. Every rule fires at or above its bar, so this sits at the share or above it. Measured on the test window.">share that agreed${bCoinSortBtn(view, 'agreed', '↓')}</th>
        <th ${bth} title="how many records this row averages — one per decision, band and 24/5 variant of the setting.">rows${bCoinSortBtn(view, 'rows', '↓')}</th>
        <th ${bth} title="opens the records themselves below the row.">records</th></tr></thead>
      <tbody id="bCoinBody">${cr.map((r) => {
    const k = keyOf(r);
    return `<tr data-bkey="${esc(k)}">
        <td ${btd0}>${esc(r.cellLabel)}</td>
        <td ${btd}>${bCoin(r)} <span class="muted">${esc(bGeo(r.geometry))}</span></td>
        <td ${btd}>${bShare(r.share, r.beat, r.pairs, r.nullTies)}</td>
        <td ${btd}>${r.noisePairs ? bShare(r.beatNoise / r.noisePairs, r.beatNoise, r.noisePairs) : '<span class="muted">—</span>'}</td>
        <td ${btd}>${Number(r.pairs).toLocaleString()}</td>
        <td ${btd}>${bMoney(r.avgTest)}</td>
        <td ${btd}>${bMoney(r.avgHold)}</td>
        <td ${btd}>${r.avgTrades == null ? '—' : r.avgTrades.toFixed(1)}</td>
        <td ${btd}>${bMoney(r.avgVsLong)}</td>
        <td ${btd}>${r.avgAgreed == null ? '<span class="muted">—</span>' : `${r.avgAgreed.toFixed(1)}%`}</td>
        <td ${btd}>${r.rows}</td>
        <td ${btd}><button data-brec="${esc(k)}">${openKeys.has(k) ? '▾ records' : 'records'}</button></td></tr>`;
  }).join('') || '<tr><td colspan="12" class="empty">nothing cleared the floors</td></tr>'}</tbody></table></div>
    ${bShown({ total: (coins && coins.total) || 0, of: ((coins && coins.total) || 0) + ((coins && coins.removed) || 0) })}
    ${bPager((coins && coins.total) || 0, coinsQ.offset || 0, 100, 'S3C')}
  </div>`)) return;
  // THE ORDERING BOX AND ITS Apply ARE GONE (owner order, 2026-08-28: "remove
  // obsolete ordering selections as we can do all row ordering by column
  // selections"). Every column sorts on one click and every filter asks again
  // the moment it changes, so a button whose only job was to re-ask had
  // nothing left to do. The page still holds perfectly still on every one of
  // those redraws — see bRedrawPeggedToCoinHead.
  // opening or closing a row's records must not move the page either (owner
  // order, 2026-08-27) — same peg, same rule
  // SHOW IN 3.B: pin the every-coin table to this one setting's coins. The
  // page holds still — the same peg every other change to that table uses —
  // so the row that was pressed stays where it was.
  $(mount).querySelectorAll('[data-bpin3b]').forEach((btn) => {
    btn.onclick = () => {
      // EVERY OTHER FLOOR COMES OFF (owner order, 2026-08-30). The point of
      // the button is to see that setting's coins — all of them — and a floor
      // left on from earlier would hide some of them with no hint why.
      // What was there is kept so it can be put back in one press.
      const all = { ...(bView().filters || {}) };
      const before = all.S3C || {};
      all.S3C = { setting: btn.dataset.bpin3b };
      bSaveView({
        filters: all,
        s3cBeforePin: before,
        // WHICH ROW OF TABLE 3.A THIS CAME FROM. The button that was pressed
        // reads bold from it, and the one record in each coin's eight that
        // this row actually IS reads highlighted from it — both from the same
        // stored fact, so a redraw, a page turn or a re-sort cannot put the
        // mark on one and not the other.
        s3cPin: {
          setting: btn.dataset.bpin3b,
          decision: btn.dataset.bpindec,
          bandMode: btn.dataset.bpinband,
          weekdaysOnly: btn.dataset.bpinwk === '1',
        },
        openS3: 'all',                 // every coin's records, opened
        coins: { ...(bView().coins || {}), offset: 0 },
      });
      bRedrawScrolledToCoinHead();
    };
  });
  $(mount).querySelectorAll('[data-brec]').forEach((btn) => {
    btn.onclick = () => {
      const k = btn.dataset.brec;
      const keys = new Set(bView().openS3 === 'all' ? [...openKeys] : (bView().openS3 || []));
      if (keys.has(k)) { keys.delete(k); } else { keys.add(k); }
      bSaveView({ openS3: [...keys] });
      bRedrawPeggedToCoinHead();
    };
  });
  $(mount).querySelectorAll('[data-bcheck]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'reading every record…';
      const id = btn.dataset.bcheck;
      const res = await apiOr(`api/stageset/${id}/check`, { error: 'the service did not answer' });
      bSaveView({ checked: { id, res } });
      drawBoards().then(() => restoreScroll(tab));
    };
  });
  $(mount).querySelectorAll('[data-bstopfill]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'stopping…';
      try { await post(`api/stageset/${btn.dataset.bstopfill}/fill-in/stop`, {}); } catch (err) { alert(err.message); }
      drawBoards().then(() => restoreScroll(tab));
    };
  });
  $(mount).querySelectorAll('[data-bundoappend]').forEach((btn) => {
    btn.onclick = async () => {
      // eslint-disable-next-line no-alert
      if (!confirm('Put this set back to before the unfinished run?\n\n'
        + 'THIS DELETES THE RECORDS THAT RUN WROTE. They cover some of this set’s coins and not others, so they cannot be '
        + 'used as they stand. What is kept is written beside the old records and swapped in only once it is all there, so an '
        + 'interruption leaves the set exactly as it is. Filling in again afterwards prices the whole thing once.')) return;
      btn.disabled = true;
      btn.textContent = 'starting…';
      try { await post(`api/stageset/${btn.dataset.bundoappend}/undo-append`, {}); } catch (err) { alert(err.message); }
      drawBoards().then(() => restoreScroll(tab));
    };
  });
  $(mount).querySelectorAll('[data-bdrop]').forEach((btn) => {
    btn.onclick = async () => {
      const n = (gap && gap.surplus) || 0;
      // eslint-disable-next-line no-alert
      if (!confirm(`Delete the ${Number(n).toLocaleString()} settings this block does not declare?\n\n`
        + 'THIS DELETES PRICED RECORDS. Each one prices a trade another setting here already prices, so what goes is a '
        + 'second copy. What is kept is written beside the old records and swapped in only once it is all there, so an '
        + 'interruption leaves the set exactly as it is. It cannot be undone without running the whole set again.')) return;
      btn.disabled = true;
      btn.textContent = 'starting…';
      try { await post(`api/stageset/${btn.dataset.bdrop}/drop-undeclared`, {}); } catch (err) { alert(err.message); }
      drawBoards().then(() => restoreScroll(tab));
    };
  });
  $(mount).querySelectorAll('[data-brename]').forEach((btn) => {
    btn.onclick = async () => {
      // eslint-disable-next-line no-alert
      if (!confirm('Bring this set’s setting names up to date?\n\n'
        + 'Names only. Nothing is priced again and no result moves. The new records are written beside the old ones '
        + 'and swapped in only once they are all there, so an interruption leaves the set exactly as it is. The tables '
        + 'are worked out again afterwards.')) return;
      btn.disabled = true;
      btn.textContent = 'starting…';
      try { await post(`api/stageset/${btn.dataset.brename}/rename-settings`, {}); } catch (err) { alert(err.message); }
      drawBoards().then(() => restoreScroll(tab));
    };
  });
  $(mount).querySelectorAll('[data-bfillin]').forEach((btn) => {
    btn.onclick = async () => {
      const n = Number((gap && gap.missing) || 0).toLocaleString();
      const p = Number((gap && gap.pricings) || 0).toLocaleString();
      // eslint-disable-next-line no-alert
      if (!confirm(`Price the ${n} settings this block declares and this set does not hold?\n\n`
        + `${p} pricings. Nothing already priced is touched. The tables are worked out again when it lands.`)) return;
      btn.disabled = true;
      btn.textContent = 'starting…';
      try { await post(`api/stageset/${btn.dataset.bfillin}/fill-in`, {}); } catch (err) { alert(err.message); }
      drawBoards().then(() => restoreScroll(tab));
    };
  });
  if ((filling && filling.running) || (renaming && renaming.running)
    || (dropping && dropping.running) || (undoing && undoing.running)) {
    bTallyPoll = setTimeout(() => { if (tab === 'boards') bPollRedraw(); }, 4000);
  }
  bWirePager(mount);
  bWireRankSort(doc, mount);
  bWireCoinSort(mount);
  bWireFilters(mount);
  bWireTableFold(mount);
  // opened records rows, fetched and slotted under their coin row
  for (const k of openKeys) {
    const tr = $(mount).querySelector(`tr[data-bkey="${CSS.escape(k)}"]`);
    if (!tr) continue;
    const [cellLabel, trade, ctx1, ctx2, geometry] = k.split('|');
    const q = new URLSearchParams({ cellLabel, trade, ctx1, ctx2, geometry }).toString();
    const got = await apiOr(`api/stageset/${doc.id}/coin-rows?${q}`, null);
    const cell = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = tr.children.length;
    td.style.padding = '.25rem .5rem .6rem 1.2rem';
    if (!got || got.indexed === false) {
      td.innerHTML = `<p class="note warn">could not read this row's records${got && got.why ? ` — ${esc(got.why)}` : ''}</p>`;
    } else {
      td.innerHTML = `<div class="scrollx"><table style="border-collapse:collapse">
        <thead><tr style="text-align:left;border-bottom:1px solid var(--line)">
          <th style="padding:.2rem .5rem .2rem 0" title="how the members' votes became this record's calls">decision</th>
          <th style="padding:.2rem .5rem" title="the band % (or auto) box as this record priced it. auto is worked out from the coin's own history; band % shows what it worked out to">band</th>
          <th style="padding:.2rem .5rem" title="whether this record traded weekdays only">24/5</th>
          <th style="padding:.2rem .5rem" title="what ACTUALLY agreed at the moments THIS record spoke, as a share of whatever its rule counts: the average, and in brackets the least and the most it ever got. The share it was built on is the floor of this, never the whole of it.">share that agreed</th>
          <th style="padding:.2rem .5rem" title="how far either side of the current price this record set its two levels, as a percentage of price">band %</th>
          <th style="padding:.2rem .5rem" title="profit-and-loss on the test window — the window the carry was ordered on">test $</th>
          <th style="padding:.2rem .5rem" title="entries in the test window">test trades</th>
          <th style="padding:.2rem .5rem" title="of the head-to-heads between THIS record's held-back money and every null-set deal, the share it won">beat its own null set</th>
          <th style="padding:.2rem .5rem" title="the once-only look on data no ordering read — the number that counts">held-back $</th>
          <th style="padding:.2rem .5rem" title="entries in the held-back window">held-back trades</th>
          <th style="padding:.2rem .5rem" title="how many held-back positions closed at their stop">held-back stops</th>
          <th style="padding:.2rem .5rem" title="this record's held-back money minus just holding the coin over the same window">vs always-long</th></tr></thead>
        <tbody>${(got.rows || []).map((r) => {
    const h = r.holdout || null;
    const mine = bPinnedRecord(r);
    return `<tr${mine ? ' class="pinned" title="this is the row of Table 3.A you pressed show in 3.B on"' : ''}>
          <td style="padding:.2rem .5rem .2rem 0">${esc(r.decision)}</td>
          <td style="padding:.2rem .5rem">${r.bandMode === 'auto' ? 'auto' : `${esc(String(r.bandMode))}%`}</td>
          <td style="padding:.2rem .5rem">${r.weekdaysOnly ? 'yes' : 'no'}</td>
          <td style="padding:.2rem .5rem">${r.agreed == null ? '<span class="muted">—</span>'
      : `${r.agreed.toFixed(1)}%<span class="muted"> (${r.agreedLow.toFixed(1)}–${r.agreedHigh.toFixed(1)}%, ${Number(r.agreedN).toLocaleString()} call${r.agreedN === 1 ? '' : 's'})</span>`}</td>
          <td style="padding:.2rem .5rem">±${r.bandPct != null ? Number(r.bandPct).toFixed(2) : '—'}%</td>
          <td style="padding:.2rem .5rem">${bMoney(r.pnl)}</td>
          <td style="padding:.2rem .5rem">${r.trades ?? '—'}</td>
          <td style="padding:.2rem .5rem">${bShare(r.pairs ? r.beat / r.pairs : null, r.beat, r.pairs, r.nullTies)}</td>
          <td style="padding:.2rem .5rem">${h ? bMoney(h.pnl) : '<span class="muted">—</span>'}</td>
          <td style="padding:.2rem .5rem">${h && h.trades != null ? h.trades : '—'}</td>
          <td style="padding:.2rem .5rem">${h && h.stops != null ? h.stops : '—'}</td>
          <td style="padding:.2rem .5rem">${h && h.vsAlwaysLong != null ? bMoney(h.vsAlwaysLong) : '<span class="muted">—</span>'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
    }
    cell.appendChild(td);
    tr.after(cell);
  }
}

// draw() RETURNS the section's promise. It used to return undefined while every
// section function was async, so `draw().then(...)` — which is how "copy settings
// into the form" waits for the Sweep form to exist before filling it — threw
// "Cannot read properties of undefined (reading 'then')" every single time. The
// tab switched, the exception was swallowed by the console, and not one field
// was filled: a button that looked like it worked and did nothing (found by the
// runtime harness, 2026-08-17).
// EVERY CONTROL CARRIES ITS HELP AS HOVER TEXT (owner order, 2026-08-26:
// "where's the tool tip on the decision drop down in Sweep? missing tool
// tips on many (most?) of the controls. fix that"). The Help tab already
// holds a plain-language entry for every control on every screen —
// tests/test-help.js refuses a control without one — so the hover is WIRED
// FROM those entries after every draw, rather than typed a second time
// beside each control where the two copies would drift. A title written in
// the template itself wins: it usually carries the sharper in-place
// warning. The caption around a control gets the same text, because
// hovering the words beside a small box is how a hover is actually found.
function hoverFromHelp(key) {
  const entries = (window.HELP && window.HELP[key] && window.HELP[key].controls) || null;
  if (!entries) return;
  for (const [id, e] of Object.entries(entries)) {
    const el = document.getElementById(id);
    if (!el || !e || !e.what) continue;
    const text = e.more ? `${e.what}\n\n${e.more}` : e.what;
    if (!el.title) el.title = text;
    const lab = el.closest ? el.closest('label') : null;
    if (lab && !lab.title) lab.title = text;
  }
}
// Wrapped at the definition, not called at seven tails: the draw functions
// return early on empty states, and a tail call after an early return is a
// hover that quietly never arrives.
drawData = ((fn) => async (...a) => { holdScrollMemory(); const r = await fn(...a); hoverFromHelp('data'); return r; })(drawData);
drawFunnel = ((fn) => async (...a) => { holdScrollMemory(); const r = await fn(...a); hoverFromHelp('funnel'); return r; })(drawFunnel);
drawVerify = ((fn) => async (...a) => { holdScrollMemory(); const r = await fn(...a); hoverFromHelp('verify'); return r; })(drawVerify);
drawHistory = ((fn) => async (...a) => { holdScrollMemory(); const r = await fn(...a); hoverFromHelp('history'); return r; })(drawHistory);
drawTune = ((fn) => async (...a) => { holdScrollMemory(); const r = await fn(...a); hoverFromHelp('tune'); return r; })(drawTune);
drawGreenlight = ((fn) => async (...a) => { holdScrollMemory(); const r = await fn(...a); hoverFromHelp('greenlight'); return r; })(drawGreenlight);
drawSweep = ((fn) => async (...a) => { holdScrollMemory(); const r = await fn(...a); hoverFromHelp('sweep'); return r; })(drawSweep);
drawBoards = ((fn) => async (...a) => { holdScrollMemory(); const r = await fn(...a); hoverFromHelp('boards'); return r; })(drawBoards);
// AND THEN THE WAIT BOX, OUTSIDE ALL OF IT (owner order, 2026-08-30), so the
// box stays up until the very last thing the redraw does has been done.

// ---- Funnel (the step between Boards and Verify) --------------------------------
//
// Half a million priced settings, and the only way through them was to sort a
// table and pick a row -- which is how you find a fluke, not a strategy. This
// walks a fixed seven-step template instead, and writes what survives as a
// Stage 4 record set.
//
// EVERY MONEY FIGURE ON THIS SCREEN IS TEST MONEY. The held-back window is
// opened once, at the cut, on what survives. Six steps of narrowing on the
// held-back numbers would spend the only window that can judge the answer.

const F_STEPS = [
  ['which dials move the result', 'nothing is cut here, review the table'],
  ['the shape of a dial', 'pick a range, never a value'],
  ['do two dials interact', 'the grid, with thin squares marked'],
  ['does it hold elsewhere', 'across whatever this set can offer'],
  ['a plateau or a knife edge', 'the widest region and its middle'],
  ['exposure', 'drawdown, worst trade, stops'],
  ['declare and cut', 'the rule, written as a Stage 4 set'],
];

// what each mark says, in the same words the set records (lib/funnelset.js MARKS)
const F_MARK_WORDS = {
  halvesDisagree: 'the two halves did not agree on the leading dials at step 1',
  leadNotEven: 'the leading dial was not evenly swept',
  spike: 'a kept range had a spike shape',
  interact: 'the two dials interact and the single-dial ranges were kept anyway',
  slices: 'accepted across slices with some not positive',
  regionNotWider: 'the widest region was not wider than the check',
  checkIsHalves: 'no scrambled copies were kept, so the two halves stood in as the check',
};

// ONE WALK PER COIN-AND-SHAPE UNIT (owner order, 2026-09-02: "IT'S ONE RULE
// PER COIN+SHAPE -- 10 RULES, NOT 5"). Which unit is being walked is
// remembered per set; each unit's walk is remembered on its own, so ten walks
// can be in flight and none forgets its place. 'all' is the blended board.
let fState = null;
const fUnitKeyFor = (set) => `cx-funnel-unit-${set}`;
const fWalkKeyFor = (set, unit) => `cx-funnel-${set}-${unit || 'all'}`;
// null until the first read of a set names its first unit (§17.2); 'all' is
// the blended table, chosen by name. Remembered in the page as well as in
// storage, so a window whose storage throws still settles on a unit.
const fUnitMemory = {};
function fUnitChosen(set) {
  try { return localStorage.getItem(fUnitKeyFor(set)) || fUnitMemory[set] || null; } catch (_) { return fUnitMemory[set] || null; }
}
function fUnitChoose(set, unit) {
  fUnitMemory[set] = unit;
  try { localStorage.setItem(fUnitKeyFor(set), unit); } catch (_) { /* private window */ }
}
function fLoad() {
  const set = pickedSet3();
  const unit = fUnitChosen(set);
  if (fState && fState.set === set && (fState.unit || null) === unit) return fState;
  let saved = null;
  if (unit) { try { saved = JSON.parse(localStorage.getItem(fWalkKeyFor(set, unit)) || 'null'); } catch (_) { saved = null; } }
  fState = (saved && saved.set === set) ? { ...saved, unit }
    : { set, unit, step: 1, rule: { ranges: {}, allowed: {}, floors: {} }, target: null,
      dial: null, dialA: null, dialB: null, floor: 20, steps: [], backSteps: [], rebuilt: false,
      closing: { key: 'rule' }, marks: [], pick: null, leaders: [], conditions: {}, across: null };
  return fState;
}
function fSave() {
  if (!fState || !fState.unit) return;                    // no walk is saved under no unit
  try { localStorage.setItem(fWalkKeyFor(fState.set, fState.unit), JSON.stringify(fState)); } catch (_) { /* private window */ }
}

// WHICH SET THE FUNNEL IS WALKING: the one open on Boards, read from Boards'
// own state. There is no second picker, because two places remembering which
// set is open is how one set's numbers end up under another set's name.
function pickedSet3() { return bView().s3 || null; }

const fFix = (v, n) => (v == null || !Number.isFinite(Number(v)) ? '-' : Number(v).toFixed(n == null ? 2 : n));

async function drawFunnel() {
  let st = fLoad();
  if (!st.set) {
    // Reachable only when there is no stage 3 set on the box at all: Boards
    // now records the one it resolved, so "open one" is advice the owner can
    // actually act on rather than a door with no handle.
    $('#view').innerHTML = `<div class="panel empty">There is no stage 3 record set open. Open the Boards section
      once - it will settle on one - and come back. The Funnel walks the set Boards has open, so there is no second
      picker here to disagree with it.</div>`;
    return;
  }
  // the first read of a unit's board is a few seconds of reading its records;
  // the wait box shows late, so a read answered from hand never flashes it
  waitStart();
  let d;
  try {
    d = await tryPost(`api/funnel/${encodeURIComponent(st.set)}/read`, {
      step: st.step, rule: st.rule, target: st.target, dial: st.dial,
      dialA: st.dialA, dialB: st.dialB, floor: st.floor, rebuilt: st.rebuilt,
      closing: st.closing || { key: 'rule' },
      unit: st.unit,                                        // null: the set's first unit; 'all': the blend
    });
  } finally { waitEnd(); }
  if (d && !d.totalling && !d.waiting && d.rebuilt) st.rebuilt = true;
  // A FAILED READ MUST SAY SO. This returned without writing anything, which
  // leaves whatever the last screen put there -- another section's numbers
  // under this section's heading -- or, on a first load, nothing at all. Both
  // read as "there is nothing here", and one of them is a lie.
  if (!d) {
    $('#view').innerHTML = `<div class="panel"><h3 style="margin-top:0">Funnel</h3>
      <p class="note neg">This section could not read <b>${esc(st.set)}</b>. Nothing below is from it, because there
        is nothing below. The reason came back in the message box; if that set has just been deleted or renamed,
        pick one on the Boards section.</p></div>`;
    return;
  }
  if (d.totalling || d.waiting) {
    $('#view').innerHTML = `<div class="panel"><h3 style="margin-top:0">Funnel</h3>
      <p class="note">the tables for this set are being totalled - ${esc(String(d.totalling || d.waiting))}</p></div>`;
    return;
  }
  // THE FIRST VISIT TO A SET IS ON ITS FIRST UNIT, named by the reply. The
  // choice is kept and the walk is read again under it, so what is drawn and
  // what is saved are one unit's -- a walk saved for that unit earlier may
  // stand at another step than the one just read.
  if (!st.unit) {
    fUnitChoose(st.set, d.unit || 'all');
    fState = null;
    return drawFunnel();
  }
  const r = d.reading || {};
  // what this step would leave a mark for, kept so that walking PAST the step
  // records it (§16.5) -- and step 1's leaders, so step 3 can start from them
  st.conditions = d.conditions || {};
  if (d.step === 1 && Array.isArray(r.dials)) st.leaders = r.dials.slice(0, 2).map((x) => x.dial);
  // WHAT EACH CONTROL ACTS ON, kept from the reply rather than read back off
  // the page: the values on step 2 and what each carries, the grid's axes and
  // recommended block on step 3, the counts on step 4, the region's edges on 5
  // on a unit's board step 4 is read by pressing (§17.3), and what was read
  // for THIS rule is what the accept records
  const a4 = st.across && st.across.ruleKey === JSON.stringify(st.rule) ? st.across : null;
  st.read = {
    groups: d.step === 2 && Array.isArray(r.groups) ? r.groups.map((g) => [String(g.value), g.n]) : null,
    grid: d.step === 3 && r.grid ? { aVals: r.aVals, bVals: r.bVals, block: (r.block || {}).block || null } : null,
    accept: d.step === 4 && r.pressed
      ? (a4 ? { positive: a4.positive, of: a4.of, check: null, beatsAll: a4.beatsAll } : null)
      : (d.step === 4 && !r.why ? { positive: r.positive, of: r.of, check: r.check || null } : null),
    keep: d.step === 5 && r.keep ? { ranges: r.keep.ranges || {}, allowed: r.keep.allowed || {} } : null,
  };
  $('#view').innerHTML = `<div class="panel">${fHead(d)}${fRail(d, st)}</div>
  <div class="panel">
    <h3 style="margin-top:0">Step ${d.step} - ${esc(F_STEPS[d.step - 1][0])}</h3>
    <p class="note">${esc(F_STEPS[d.step - 1][1])}</p>
    ${d.step <= 5 ? fCheckLine(d) : ''}
    ${r.why ? `<p class="note neg">${esc(r.why)}</p>`
    : (d.step === 1 ? fStep1(r) : d.step === 2 ? fStep2(r, st) : d.step === 3 ? fStep3(r, st)
      : d.step === 4 ? fStep4(r, st) : d.step === 5 ? fStep5(r, d) : d.step === 6 ? fStep6(d, st, r) : fStep7(d, st))}
    ${fNoiseLine(r, d)}
  </div>
  <div class="panel">${fRuleBox(d)}</div>`;
  fWire(st);
}

// The standing line. Which set, how many survive against the target, and -
// NAMED rather than left blank - whether a noise comparison exists at all and
// whether the sealed window is intact. A missing comparison shown as nothing
// reads as 'nothing to report', which is the opposite of the truth.
function fHead(d) {
  const n = (d.set && d.set.noiseTwin) || {};
  const sealed = (d.set && d.set.sealed) || {};
  const unitName = d.unit ? (d.unitName || d.unit) : 'all units together';
  return `<h3 style="margin-top:0">Funnel - ${esc(d.set.name)} - ${esc(unitName)}</h3>
    <p class="note"><b>Every money figure on this screen is test money.</b> The held-back window is opened once,
      at the cut, on what survives. <b>One rule per coin and shape:</b> this walk is on
      ${d.unit
    ? `<span>the records of <b>${esc(unitName)}</b> alone - its own money, its own scrambled copies, every dial</span>`
    : '<span>the blended table, every unit averaged into one row per setting, which hides what any one coin does</span>'}.</p>
    <div class="row" style="align-items:flex-end">
      <label class="f">coin and shape<select id="fUnit"><option value="all" ${d.unit ? '' : 'selected'}>all units together</option>${(d.units || []).map((u) => `<option value="${esc(u.key)}" ${u.key === d.unit ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
      <span class="note"><b>${Number(d.survivors).toLocaleString()}</b> of
      ${Number(d.of).toLocaleString()} settings survive${d.target ? ` and the target is ${Number(d.target).toLocaleString()}` : ''}</span>
      <label class="f">target size<input id="fTarget" type="number" min="0" style="width:6rem"
        value="${d.target == null ? '' : d.target}"></label></div>
    <p class="note">${n.available ? `This set carries ${Number(d.set.keptScrambles || n.kept || 0)} scrambled copies of the whole table, each one the same days in a jumbled order. Every step below is read once against the real table and again against each of those, and the second reading is drawn beside the first.`
    : `<b>No scrambled copies on this set</b> - ${esc(String(n.why || 'not captured'))}. Every step below is read
       against the two halves of the settings instead, which tests whether a reading is STABLE and never whether the effect is real.`}</p>
    <p class="note">${sealed.sealed
    ? `The sealed window is intact on all ${(sealed.units || []).length} unit(s).`
    : `<b>No sealed window</b> - ${esc(String(sealed.why || 'not recorded'))}`}</p>`;
}

function fNoiseLine(reading, d) {
  const n = reading && reading.noise;
  if (!n) return '';
  if (n.sizes) {
    const beaten = n.beatenBy == null ? null : `${n.beatenBy} of ${n.sizes.length}`;
    const what = n.kind === 'halves' ? 'the two halves' : `the ${n.sizes.length} scrambled cop${n.sizes.length === 1 ? 'y' : 'ies'}`;
    return `<p class="note"><b>The check:</b> the widest region on ${what} was ${n.widest == null ? '-' : n.widest}`
      + ` (${n.sizes.map((x) => (x == null ? '-' : x)).join(', ')})`
      + `${beaten ? `, and this one is wider than ${esc(beaten)}` : ''}. `
      + `${n.beatenBy === n.sizes.length ? 'Wider than every one of them.' : '<b class="neg">Anything short of all of them is a size a shuffle reaches too.</b>'}</p>`;
  }
  return '';
}
function fRail(d, st) {
  return `<div class="row" style="flex-wrap:wrap;gap:.35rem">${F_STEPS.map((x, i) => `<button data-fstep="${i + 1}"
    ${i + 1 === d.step ? 'class="pri"' : ''}>${i + 1}. ${esc(x[0])}</button>`).join('')}</div>
    <p class="note">Going back is allowed and is recorded on the set - a funnel walked back four times has seen more
      of the board than one walked forward once, and the final check can only count what was written down.
      ${(st.backSteps || []).length ? `<b>${st.backSteps.length} step(s) back so far.</b>` : ''}
      ${(st.marks || []).length ? `<b>${st.marks.length} mark(s) so far</b> - ${esc(st.marks.map((m) => m.what).join('; '))}.` : ''}</p>`;
}

// One line saying which check this step was read against and where it is
// drawn. It names what IS on the screen, never what is not.
function fCheckLine(d) {
  const c = d.check || {};
  if (c.kind === 'scrambles') {
    return `<p class="note"><b>The check:</b> every reading on this step is drawn beside the same reading on each of this
      set's <b>${c.k}</b> scrambled copies of the table${c.k === 1 ? ' - one copy is a single draw, and the page says so' : ''}.
      A finding has to beat every one of them.</p>`;
  }
  return `<p class="note"><b>The check:</b> this set kept no scrambled copies, so every reading is drawn beside the same
    reading on each of the two halves of the settings. That tests whether a reading is STABLE, never whether the
    effect is real - a weaker check, and it is marked as such on the set.</p>`;
}

function fStep1(r) {
  const sh = r.splitHalf || {};
  // HOW MANY OF THE DIAL'S VALUES BEAT THE CHECK -- step 2's own test, rolled
  // up, so a bold row here is a bold row waiting on step 2. Movement alone had
  // no direction and bolded a dial whose forecast made the piles differ by
  // losing more (owner, 2026-09-02).
  const checkOf = (x) => {
    const b = (r.beating || {})[x.dial];
    return b ? `${b.n} of ${b.of} values` : '-';
  };
  // THE WHOLE ROW IS BOLD WHEN IT BEATS EVERY COPY (owner order, 2026-09-02),
  // so the button at the end of the row is as easy to find as the number; and
  // three decimals, so a row that beats the top of the range by less than a
  // hundredth does not look equal to it.
  const rowClass = (x) => ((r.counts || {})[x.dial] === false ? 'dim' : ((r.counts || {})[x.dial] ? 'cnt' : ''));
  return `<p class="note">How far apart a dial's values sit, against how much the result varies anyway.
      <b>The ordering is the finding</b> - at this many rows every dial shows some movement, and the size of the
      number is a claim only against the check beside it. Press a row to narrow that dial next.</p>
    <table><thead><tr>${cth('dial', 'fDialName')}${cth('movement', 'fMovement')}${cth('check', 'fCheck')}${cth('range', 'fRange')}
      ${cth('values', 'fValues')}${cth('evenly swept', 'fEven')}<th></th></tr></thead><tbody>
      ${(r.dials || []).map((x) => `<tr class="${rowClass(x)}"><td>${esc(fDialLabel(x.dial))}</td><td>${fFix(x.m, 3)}</td>
        <td>${esc(checkOf(x))}</td><td>${fFix(x.range)}</td>
        <td>${(x.values || []).length}</td>
        <td class="${(x.balance || {}).balanced ? 'muted' : 'warn'}">${fFix((x.balance || {}).even)}</td>
        <td><button data-fnarrow="${esc(x.dial)}" title="opens the next step with this dial chosen, so its range can be set. Nothing is cut by pressing it.">narrow this one</button></td></tr>`).join('')}
    </tbody></table>
    <p class="note"><b>Split-half:</b> ${sh.why ? esc(sh.why)
    : `one half leads with ${esc((sh.a || []).map(fDialLabel).join(', '))} and the other with ${esc((sh.b || []).map(fDialLabel).join(', '))} - ${sh.agrees
      ? 'they agree.'
      : '<b class="neg">they do not agree, and nothing below this step means anything until they do.</b>'}`}</p>
    ${(r.lopsided || []).length ? `<p class="note warn"><b>Not evenly swept:</b> ${esc(r.lopsided.map(fDialLabel).join(', '))}.
      Grouping by one dial only averages the others out when every value was swept against the same spread of
      everything else. These are partly some other dial's movement wearing their name.</p>` : ''}
    ${(r.skipped || []).length ? `<p class="note muted">Not measurable here:
      ${r.skipped.map((x) => `${esc(fDialLabel(x.dial))} - ${esc(x.why)}`).join('; ')}. That is not the same as flat.</p>` : ''}`;
}

function fStep2(r, st) {
  const pick = `<label class="f">dial<select id="fDial">${vocabOptions('funnelDial', st.dial || '')}</select></label>`;
  if (!r.groups || !r.groups.length) {
    return `<div class="row">${pick}</div><p class="note">${esc(r.why || 'pick a dial to read its shape')}</p>`;
  }
  const sh = r.splitHalf || {};
  const rec = r.rec || {};
  const kind = rec.kind || (r.noise || {}).kind;
  const byVal = new Map((rec.values || []).map((v) => [String(v.value), v]));
  const checkOf = (v) => {
    const c = v && v.check ? v.check.filter((x) => x != null) : [];
    if (!c.length) return '-';
    return kind === 'halves' ? v.check.map((x) => fFix(x)).join(' / ') : `${fFix(Math.min(...c))} to ${fFix(Math.max(...c))}`;
  };
  // WHAT IS PRE-FILLED: the range already in the rule for this dial, else the
  // recommendation. Either way the boxes show where the count line comes from.
  const have = (st.rule.ranges || {})[st.dial] || {};
  const rr = rec.recommend || {};
  const lo = have.min != null ? have.min : (rr.min != null ? rr.min : '');
  const hi = have.max != null ? have.max : (rr.max != null ? rr.max : '');
  const total = r.groups.reduce((a, g) => a + g.n, 0);
  const inRange = (val) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return false;
    return (lo === '' || n >= Number(lo)) && (hi === '' || n <= Number(hi));
  };
  const keptByRange = rec.ordered === false ? null : r.groups.filter((g) => inRange(g.value)).reduce((a, g) => a + g.n, 0);
  const chosen = new Set(((st.rule.allowed || {})[st.dial] || (rr.values || [])).map(String));
  const keptByValues = rec.ordered === false ? r.groups.filter((g) => chosen.has(String(g.value))).reduce((a, g) => a + g.n, 0) : null;
  return `<div class="row">${pick}</div>
    <p class="note">shape: <b>${esc(r.shape)}</b>, and the two halves read ${esc(String(sh.a))} and
      ${esc(String(sh.b))} - ${sh.agrees ? 'they agree' : '<b class="neg">they do not agree</b>'}</p>
    ${r.shape === 'spike' ? `<p class="note warn"><b>A spike is the shape a shuffle makes.</b> One value far clear of an
      otherwise flat menu is what a fluke looks like; a hill or a ramp is a relationship.</p>` : ''}
    <table><thead><tr>${cth('value', 'fValue')}${cth('settings', 'fSettings')}${cth('avg test', 'fAvgTest')}${cth('check', 'fCheck')}</tr></thead>
      <tbody>${r.groups.map((g) => { const v = byVal.get(String(g.value)); return `<tr class="${v && v.counts === false ? 'dim' : (v && v.counts ? 'cnt' : '')}"><td>${esc(g.value)}</td><td>${g.n}</td><td>${fFix(g.mean)}</td><td>${esc(checkOf(v))}</td></tr>`; }).join('')}</tbody></table>
    <p class="note"><b>Recommended:</b> ${rr.min != null ? `keep ${esc(String(rr.min))} to ${esc(String(rr.max))} - the widest run of neighbouring values that beat the check`
    : (rr.values && rr.values.length ? `keep ${esc(rr.values.join(', '))} - every value that beats the check`
      : `nothing - ${esc(rec.why || 'no value beats the check')}. A range can still be kept; it is then a choice the check did not support, and the set will say so.`)}</p>
    ${rec.ordered === false
    ? `<div class="row" style="align-items:flex-end;margin-top:.5rem">
        ${r.groups.map((g) => `<label class="c"><input type="checkbox" data-fval="${esc(String(g.value))}" ${chosen.has(String(g.value)) ? 'checked' : ''}> ${esc(String(g.value))}</label>`).join('')}
        <button id="fKeepValues" class="pri">keep these values</button>
        <span class="note" id="fKeepCount">keeps ${Number(keptByValues).toLocaleString()} of ${Number(total).toLocaleString()}${st.target ? ` - target ${Number(st.target).toLocaleString()}` : ''}</span></div>`
    : `<div class="row" style="align-items:flex-end;margin-top:.5rem">
        <label class="f">keep from<input id="fMin" style="width:7rem" value="${esc(String(lo))}"></label>
        <label class="f">to<input id="fMax" style="width:7rem" value="${esc(String(hi))}"></label>
        <button id="fAddRange" class="pri">add this range to the rule</button>
        <span class="note" id="fKeepCount">keeps ${Number(keptByRange).toLocaleString()} of ${Number(total).toLocaleString()}${st.target ? ` - target ${Number(st.target).toLocaleString()}` : ''}</span>
        <span class="note">a RANGE, never a value - picking the peak is the shopping this walk exists to avoid</span></div>`}`;
}

function fStep3(r, st) {
  const a0 = st.dialA || (st.leaders || [])[0] || '';
  const b0 = st.dialB || (st.leaders || [])[1] || '';
  const pickers = `<div class="row" style="align-items:flex-end">
      <label class="f">first dial<select id="fA">${vocabOptions('funnelDial', a0)}</select></label>
      <label class="f">second dial<select id="fB">${vocabOptions('funnelDial', b0)}</select></label>
      <label class="f">thin below<input id="fFloor" type="number" min="0" style="width:6rem" value="${st.floor || 0}"></label>
      <button id="fGrid" class="pri">read the grid</button></div>`;
  if (!r.grid) return `${pickers}<p class="note">name two dials and read the grid</p>`;
  const kind = (r.noise || {}).kind;
  const blk = (r.block || {}).block;
  const counting = new Set((r.block || {}).counting || []);
  const idx = (list, v) => list.indexOf(v);
  const inBlock = (a, b) => blk && idx(r.aVals, a) >= idx(r.aVals, blk.a.from) && idx(r.aVals, a) <= idx(r.aVals, blk.a.to)
    && idx(r.bVals, b) >= idx(r.bVals, blk.b.from) && idx(r.bVals, b) <= idx(r.bVals, blk.b.to);
  const pk = st.pick || null;
  const inPick = (a, b) => pk && pk.a0 != null && pk.b0 != null && pk.a1 != null && pk.b1 != null
    && idx(r.aVals, a) >= Math.min(idx(r.aVals, pk.a0), idx(r.aVals, pk.a1)) && idx(r.aVals, a) <= Math.max(idx(r.aVals, pk.a0), idx(r.aVals, pk.a1))
    && idx(r.bVals, b) >= Math.min(idx(r.bVals, pk.b0), idx(r.bVals, pk.b1)) && idx(r.bVals, b) <= Math.max(idx(r.bVals, pk.b0), idx(r.bVals, pk.b1));
  // the check's square: the highest scrambled average the real one has to beat,
  // or the two halves' averages
  const checkAt = (a, b) => {
    const cells = (r.checkGrids || []).map((g) => (g.grid || []).find((x) => x.a === a && x.b === b)).map((c) => (c && c.mean != null ? c.mean : null));
    const fin = cells.filter((x) => x != null);
    if (!fin.length) return '-';
    return kind === 'halves' ? cells.map((x) => fFix(x)).join(' / ') : fFix(Math.max(...fin));
  };
  const table = (title, cell) => `<p class="note"><b>${title}</b></p><table><thead><tr>${cth(`${esc(fDialLabel(r.dialA))} \\ ${esc(fDialLabel(r.dialB))}`, 'fGridCorner')}${(r.bVals || []).map((b) => cth(esc(b), 'fGridValue')).join('')}</tr></thead><tbody>
      ${(r.aVals || []).map((a) => `<tr><td><b>${esc(a)}</b></td>${(r.bVals || []).map((b) => cell(a, b)).join('')}</tr>`).join('')}</tbody></table>`;
  return `${pickers}
    <p class="note"><b>${r.thin} of ${r.squares} squares are thin.</b> A square built from two settings tells you
      nothing, but it looks like every other square - and it is often the best-looking one on the grid, because small
      groups swing further. Thin squares are marked and keep their count; none is dropped.</p>
    <p class="note">What each floor would keep: ${(r.floorCost || []).map((x) => `${x.floor} keeps ${x.keeps} of ${x.of}`).join('; ')}.</p>
    ${table('The grid - bold squares beat the check; the outlined block is recommended; press two corners to choose your own', (a, b) => {
      const c = r.grid.find((x) => x.a === a && x.b === b) || {};
      const k = `${a}|${b}`;
      const cls = [c.thin ? 'muted' : '', counting.has(k) ? 'cnt' : '', inBlock(a, b) ? 'blk' : '', inPick(a, b) ? 'pick' : '', 'pickable'].filter(Boolean).join(' ');
      return `<td class="${cls}" data-fcell="${esc(k)}">${fFix(c.mean)}${c.thin ? ` (${c.n || 0})` : ''}</td>`;
    })}
    ${table(kind === 'halves' ? 'The check - each half\'s average, first / second' : 'The check - the highest scrambled average in each square', (a, b) => `<td>${esc(checkAt(a, b))}</td>`)}
    <div class="row" style="align-items:flex-end;margin-top:.5rem">
      <span class="note">${blk ? `Recommended block: ${esc(fDialLabel(r.dialA))} ${esc(blk.a.from)} to ${esc(blk.a.to)}, ${esc(fDialLabel(r.dialB))} ${esc(blk.b.from)} to ${esc(blk.b.to)} - ${blk.squares} square(s).`
      : `No block - ${esc((r.block || {}).why || 'no square beats the check')}.`}
      ${pk && pk.a1 != null ? ` Your block: ${esc(fDialLabel(r.dialA))} ${esc(pk.a0)} to ${esc(pk.a1)}, ${esc(fDialLabel(r.dialB))} ${esc(pk.b0)} to ${esc(pk.b1)}.` : (pk && pk.a0 != null ? ' One corner chosen - press the other.' : '')}</span>
      <button id="fKeepBlock" class="pri" ${(pk && pk.a1 != null) || blk ? '' : 'disabled'}>keep this block</button>
      <span class="note">writes a range on BOTH dials in one step, replacing what the rule held for them. Your own block if you chose one, else the recommended one.</span></div>`;
}

function fStep4(r, st) {
  const ax = r.axis || {};
  if (r.pressed) {
    // ON A UNIT'S BOARD, "elsewhere" IS THE OTHER UNITS (§17.3): the same rule
    // on each of their records, read one at a time when asked
    const a = st.across && st.across.ruleKey === JSON.stringify(st.rule) ? st.across : null;
    const asked = !a && st.acrossAsked && st.acrossAsked.ruleKey === JSON.stringify(st.rule);
    return `<p class="note">Read across the <b>${r.others}</b> other coin-and-shape unit${r.others === 1 ? '' : 's'} of this set: the
        rule you have built here, applied to each of their records.</p>
      <div class="row" style="align-items:flex-end">
        <button id="fAcross" class="pri" ${asked ? 'disabled' : ''}>read the other units</button>
        <span id="fAcrossMsg" class="note">${a ? `<span>read at ${esc(new Date(a.at).toLocaleTimeString())}</span>` : `<span>not read yet for this rule - ${r.others} boards, read one at a time</span>`}</span></div>
      ${a ? `<p class="note"><b>${a.positive} of ${a.of}</b> other units are positive under this rule, and on
        <b>${a.beatsAll} of ${a.of}</b> the money of the survivors beats every one of the scrambled copies of that unit.</p>
      <table><thead><tr>${cth('unit', 'fAcrossUnit')}${cth('survivors', 'fAcrossSurvivors')}${cth('avg test', 'fAvgTest')}${cth('check', 'fCheck')}</tr></thead>
        <tbody>${a.units.map((u) => `<tr class="${u.k && u.beats === u.k ? 'cnt' : (u.avgTest == null ? 'dim' : '')}"><td>${esc(u.name)}</td><td>${Number(u.survivors).toLocaleString()} of ${Number(u.of).toLocaleString()}</td><td>${fFix(u.avgTest)}</td><td>${u.k ? `<span>beats ${u.beats} of ${u.k}</span>` : '-'}</td></tr>`).join('')}</tbody></table>
      <div class="row" style="align-items:flex-end;margin-top:.5rem">
        <button id="fAccept4" class="pri">accept and carry on</button>
        <span class="note">records "accepted ${a.positive} of ${a.of} other units positive; ${a.beatsAll} beat every copy" as a mark on the set, and opens the next step</span></div>` : ''}`;
  }
  const slices = r.slices || [];
  const c = r.check || {};
  const kind = c.kind || (r.noise || {}).kind;
  const checkText = (c.positive || []).length
    ? (kind === 'halves'
      ? `on the two halves: ${c.positive.map((p, i) => (p == null ? '-' : `${p} of ${c.of[i]}`)).join(' / ')}`
      : `on the ${c.positive.length} scrambled cop${c.positive.length === 1 ? 'y' : 'ies'}: ${c.positive.map((p, i) => (p == null ? '-' : `${p} of ${c.of[i]}`)).join(', ')}`)
    : 'nothing to compare against';
  const best = (c.positive || []).filter((p) => p != null);
  const checkBest = best.length ? Math.max(...best) : null;
  const said = r.why ? 'nothing to accept' : `accepted ${r.positive} of ${r.of}; the check managed ${checkBest == null ? '-' : checkBest} of ${r.of}`;
  // worked out here, not inside the template: a `>=` inside an interpolation
  // reads as a tag closing to the word-list reader, and it showed the owner a
  // bare r.positive as if it were a label
  const asMany = checkBest != null && r.positive != null && checkBest >= r.positive;
  return `<p class="note">Read across <b>${esc(String(ax.axis || 'nothing'))}</b>${ax.weaker
    ? ' - <b>a weaker check than comparing coins</b>' : ''}.</p>
    ${(ax.passedOver || []).length ? `<p class="note muted">Passed over:
      ${ax.passedOver.map((x) => `${esc(x.axis)} (${esc(x.why)})`).join('; ')}</p>` : ''}
    ${r.why
    ? `<p class="note neg">${esc(r.why)}</p>`
    : `<p class="note"><b>${r.positive} of ${r.of}</b> slices are positive. The check managed ${esc(checkText)}${asMany ? ' - <b class="neg">as many or more, so this count is what a shuffle gives</b>' : ''}.</p>`}
    <table><thead><tr>${cth('slice', 'fSlice')}${cth('settings', 'fSettings')}${cth('avg test', 'fAvgTest')}</tr></thead>
      <tbody>${slices.map((x) => `<tr><td>${esc(x.key)}</td><td>${x.n}</td><td>${fFix(x.mean)}</td></tr>`).join('')}</tbody></table>
    <div class="row" style="align-items:flex-end;margin-top:.5rem">
      <button id="fAccept4" class="pri" ${r.why ? 'disabled' : ''}>accept and carry on</button>
      <span class="note">records what you accepted - "${esc(said)}" - as a mark on the set, and opens the next step</span></div>`;
}

function fStep5(r, d) {
  const keep = r.keep || {};
  const ranges = Object.entries(keep.ranges || {});
  const allowed = Object.entries(keep.allowed || {});
  return `<p class="note">The widest run of neighbouring settings that all made money, and <b>its middle</b> - chosen
      by depth inside the region, never by score, so the best-scoring one cannot sneak back in.</p>
    <p class="note">region size <b>${r.size || 0}</b> of ${r.cellsClearing || 0} settings that cleared,
      out of ${r.cellsConsidered || 0} considered.</p>
    ${r.size ? `<table><thead><tr>${cth('dial', 'fRegionDial')}${cth('from', 'fRegionFrom')}${cth('to', 'fRegionTo')}</tr></thead><tbody>
      ${ranges.map(([k, b]) => `<tr><td>${esc(fDialLabel(k))}</td><td>${esc(String(b.min))}</td><td>${esc(String(b.max))}</td></tr>`).join('')}
      ${allowed.map(([k, v]) => `<tr><td>${esc(fDialLabel(k))}</td><td colspan="2">${esc(v.join(', '))}</td></tr>`).join('')}
    </tbody></table>
    <div class="row" style="align-items:flex-end;margin-top:.5rem">
      <button id="fKeepRegion" class="pri">keep the widest region</button>
      <span class="note">replaces every range and value in the rule with the region's edges above - keeps
        <b>${Number(keep.keeps || 0).toLocaleString()}</b> of ${Number(d.of || 0).toLocaleString()}${d.target ? ` - target ${Number(d.target).toLocaleString()}` : ''}</span></div>`
    : '<p class="note neg">No region: nothing here has neighbours that also work, which is what an isolated fluke looks like.</p>'}`;
}

// WHAT EACH LIMIT WOULD KEEP, so the number is set with its cost in view.
function fLadder(name, l, word) {
  if (!l) return '';
  if (!l.measured) return `<p class="note muted">${esc(name)}: no survivor carries this number yet - work out the missing numbers first.</p>`;
  return `<p class="note">${esc(name)} - what each limit would keep of ${l.of}: ${l.rungs.map((x) => `${word} ${fFix(x.at)} keeps ${x.keeps}`).join('; ')}.</p>`;
}

function fStep6(d, st, r) {
  const dd = (st.rule.floors || {}).maxDrawdown || {};
  const tr = (st.rule.floors || {}).avgTrades || {};
  return `<p class="note">The numbers a sweep does not keep - the worst losing streak, the biggest single loss, how
      many trades won, and how much of the result rests on guessing what happened inside a single bar - are worked out
      here, for the <b>${Number(d.survivors).toLocaleString()}</b> settings that survive and no others. Totals
      flatter; an average losing streak hides the one that would have ended you.</p>
    <div class="row"><button id="fRebuild" class="pri">work out the missing numbers</button>
      <span id="fRebuildMsg" class="note">${st.rebuilt ? 'done for this set' : 'not done yet'}</span></div>
    ${fLadder('worst losing streak', (r.ladders || {}).maxDrawdown, 'at most')}
    ${fLadder('trades', (r.ladders || {}).avgTrades, 'at least')}
    <div class="row" style="align-items:flex-end;margin-top:.5rem">
      <label class="f">worst losing streak allowed<input id="fDD" type="number" style="width:8rem"
        value="${esc(String(dd.max == null ? '' : dd.max))}"></label>
      <label class="f">fewest trades<input id="fTrades" type="number" style="width:8rem"
        value="${esc(String(tr.min == null ? '' : tr.min))}"></label>
      <button id="fAddFloors">add these limits to the rule</button></div>`;
}

function fStep7(d, st) {
  // THE COUNT AND THE SENTENCE ABOVE ALREADY HAVE THE CLOSING IN THEM. The read
  // folds it into the rule for this step, so what is shown is what the button
  // writes.
  const cl = (st && st.closing) || { key: 'rule' };
  const detail = (d.closing || {}).detail;
  const top = cl.key !== 'top' ? '' : `<label class="f">by which column<select id="fCutCol">${
    vocabOptions('funnelTopColumn', cl.column || '')}</select></label>
      <label class="f">how many to keep<input id="fCutN" type="number" min="1" style="width:7rem"
        value="${esc(String(cl.n == null ? '' : cl.n))}"></label>`;
  return `<p class="note">The choices you made ARE the rule. This is what gets written - not the rows it happens to
      pick today - because a rule can be checked against scrambled data and a single row cannot.</p>
    <p class="note"><b>${esc(d.ruleSentence)}</b></p>
    <p class="note">${Number(d.survivors).toLocaleString()} settings survive${d.target
    ? ` against a target of ${Number(d.target).toLocaleString()}` : ''}.</p>
    ${detail ? `<p class="note">${esc(detail)}</p>` : ''}
    <div class="row" style="align-items:flex-end">
      <label class="f">name<input id="fName" style="width:14rem" placeholder="left blank, it is numbered"></label>
      <label class="f">how to reach the target<select id="fClose">${vocabOptions('funnelClosing', cl.key)}</select></label>
      ${top}
      <button id="fCut" class="pri">write the Stage 4 set</button><span id="fCutMsg" class="note"></span></div>
    <p class="note"><b>Taking the top N is shopping</b>, on the board this walk exists to stop you shopping. It is
      offered because the choice is yours, and whichever you use is recorded on the set so the final check knows what
      it is judging. Only columns a scrambled copy of the table really has are offered, so the same rule takes the
      same top N of a scrambled copy and the two can be compared.</p>
    <p class="note">An empty or one-setting result is written with a warning, never refused.</p>`;
}

function fRuleBox(d) {
  return `<h3 style="margin-top:0">The rule so far</h3><p class="note">${esc(d.ruleSentence)}</p>
    <div class="row"><button id="fClear">start the rule again</button>
      <span class="note">keeps the set open and clears every choice - recorded as going back</span></div>`;
}

// FOLLOWING A READING OF THE OTHER UNITS (§17.3): started on the box and
// polled every two seconds, the count of boards read on the line beside the
// button. The result is kept under the rule it was read for; a result the box
// holds for some other reading (another rule, another window) is left alone.
async function fAcrossFollow(st, status) {
  const asked = st.acrossAsked;
  if (!asked) return;
  let s = status;
  for (;;) {
    if (!s) {
      try { s = await api(`api/funnel/${encodeURIComponent(st.set)}/across`); } catch (_) { s = null; }
      if (!s || s.none || s.token !== asked.token) { st.acrossAsked = null; fSave(); if ($('#fAcross')) drawFunnel(); return; }
    }
    if (s.error) {
      st.acrossAsked = null; fSave();
      const m = $('#fAcrossMsg'); if (m) m.textContent = s.error;
      const b = $('#fAcross'); if (b) b.disabled = false;
      return;
    }
    if (s.result) {
      st.across = { ...s.result, ruleKey: asked.ruleKey, at: new Date().toISOString() };
      st.acrossAsked = null;
      fSave(); drawFunnel();
      return;
    }
    const m = $('#fAcrossMsg'); if (m) m.textContent = `read ${s.done} of ${s.of}`;
    await new Promise((resolve) => { setTimeout(resolve, 2000); });
    if (fState !== st) return;                       // the walk on screen is another one now
    s = null;
  }
}

function fWire(st) {
  const go = (n, why) => {
    if (n < st.step) st.backSteps.push({ from: st.step, to: n, why: why || null });
    else if (n > st.step) markStep(st.step);
    st.step = n; fSave(); drawFunnel();
  };
  document.querySelectorAll('[data-fstep]').forEach((b) => { b.onclick = () => go(Number(b.dataset.fstep)); });
  const t = $('#fTarget');
  if (t) t.onchange = () => { st.target = t.value === '' ? null : Math.max(0, Math.floor(Number(t.value) || 0)); fSave(); drawFunnel(); };
  const un = $('#fUnit');
  if (un) un.onchange = () => {
    fSave();                                                   // this unit's walk keeps its place
    fUnitChoose(st.set, un.value);
    fState = null;                                             // the next load is the chosen unit's own walk
    drawFunnel();
  };
  const dl = $('#fDial');
  if (dl) dl.onchange = () => { st.dial = dl.value || null; fSave(); drawFunnel(); };
  // MARKS (§16.5): what this step would leave a mark for is recorded when the
  // walk moves PAST the step with the condition present, and when a step's own
  // control is used. Silent by decision (FUNNEL-DECISIONS.md); never cleared.
  const mark = (key, step, detail) => {
    if (!st.marks) st.marks = [];
    if (st.marks.some((m) => m.key === key && m.step === step && (m.detail || null) === (detail || null))) return;
    st.marks.push({ key, step, what: F_MARK_WORDS[key] || key, detail: detail || null });
  };
  const markStep = (step) => {
    const c = st.conditions || {};
    if (step === 1) { if (c.halvesDisagree) mark('halvesDisagree', 1); if (c.leadNotEven) mark('leadNotEven', 1); }
    if (step === 2 && c.spike) mark('spike', 2, st.dial || null);
    if (step === 3 && c.interact) mark('interact', 3, `${st.dialA || ''} x ${st.dialB || ''}`);
    if (step === 5 && c.regionNotWider) mark('regionNotWider', 5);
    if (c.checkIsHalves) mark('checkIsHalves', step);
  };
  // a row on step 1 opens step 2 with that dial chosen
  document.querySelectorAll('[data-fnarrow]').forEach((b) => {
    b.onclick = () => { markStep(1); st.dial = b.dataset.fnarrow; st.step = 2; st.steps.push({ n: 1, what: 'which dial to narrow next', chose: st.dial }); fSave(); drawFunnel(); };
  });
  // a word-valued dial keeps a list of values, not a range
  const kv = $('#fKeepValues');
  if (kv) kv.onclick = () => {
    if (!st.dial) return;
    const vals = [...document.querySelectorAll('[data-fval]')].filter((x) => x.checked).map((x) => x.dataset.fval);
    if (!st.rule.allowed) st.rule.allowed = {};
    if (!vals.length) delete st.rule.allowed[st.dial]; else st.rule.allowed[st.dial] = vals;
    markStep(2);
    st.steps.push({ n: 2, what: `the values of ${st.dial}`, chose: vals.join(', ') || 'none' });
    fSave(); drawFunnel();
  };
  const ar = $('#fAddRange');
  if (ar) ar.onclick = () => {
    if (!st.dial) return;
    const lo = $('#fMin').value;
    const hi = $('#fMax').value;
    if (lo === '' && hi === '') delete st.rule.ranges[st.dial];
    else st.rule.ranges[st.dial] = { min: lo === '' ? null : Number(lo), max: hi === '' ? null : Number(hi) };
    markStep(2);
    st.steps.push({ n: 2, what: `the shape of ${st.dial}`, chose: `${lo} to ${hi}` });
    fSave(); drawFunnel();
  };
  // the count line follows the boxes as they are edited, from the table on screen
  for (const id of ['fMin', 'fMax']) {
    const el = $(`#${id}`);
    if (el) el.oninput = () => {
      const lo = $('#fMin').value; const hi = $('#fMax').value;
      let kept = 0; let total = 0;
      for (const [val, n] of ((st.read || {}).groups || [])) {
        const v = Number(val);
        total += n;
        if (Number.isFinite(v) && (lo === '' || v >= Number(lo)) && (hi === '' || v <= Number(hi))) kept += n;
      }
      const kc = $('#fKeepCount');
      if (kc) kc.textContent = `keeps ${kept.toLocaleString()} of ${total.toLocaleString()}${st.target ? ` - target ${Number(st.target).toLocaleString()}` : ''}`;
    };
  }
  const readGrid = () => {
    st.dialA = $('#fA').value || null; st.dialB = $('#fB').value || null;
    st.floor = Math.max(0, Math.floor(Number($('#fFloor').value) || 0));
    st.pick = null;
    fSave(); drawFunnel();
  };
  const g = $('#fGrid');
  if (g) g.onclick = readGrid;
  for (const id of ['fA', 'fB']) { const el = $(`#${id}`); if (el) el.onchange = readGrid; }
  // two corners choose a block
  document.querySelectorAll('[data-fcell]').forEach((td) => {
    td.onclick = () => {
      const [a, b] = td.dataset.fcell.split('|');
      const pk = st.pick || {};
      st.pick = (pk.a0 == null || pk.a1 != null) ? { a0: a, b0: b, a1: null, b1: null } : { ...pk, a1: a, b1: b };
      fSave(); drawFunnel();
    };
  });
  const kb = $('#fKeepBlock');
  if (kb) kb.onclick = () => {
    // the owner's block if both corners are chosen, else the recommended one;
    // the values between the corners come from the grid's own axes, as read
    const gr = (st.read || {}).grid;
    if (!gr) return;
    const aVals = gr.aVals || []; const bVals = gr.bVals || [];
    const pk = st.pick && st.pick.a1 != null ? st.pick : null;
    let span;
    if (pk) span = { a: [pk.a0, pk.a1], b: [pk.b0, pk.b1] };
    else if (gr.block) span = { a: [gr.block.a.from, gr.block.a.to], b: [gr.block.b.from, gr.block.b.to] };
    else return;
    const between = (list, x, y) => list.slice(Math.min(list.indexOf(x), list.indexOf(y)), Math.max(list.indexOf(x), list.indexOf(y)) + 1);
    const put = (dial, list, x, y) => {
      const vals = between(list, x, y);
      const nums = vals.map(Number);
      if (nums.every((n) => Number.isFinite(n))) { st.rule.ranges[dial] = { min: Math.min(...nums), max: Math.max(...nums) }; if (st.rule.allowed) delete st.rule.allowed[dial]; }
      else { if (!st.rule.allowed) st.rule.allowed = {}; st.rule.allowed[dial] = vals; delete st.rule.ranges[dial]; }
      return vals;
    };
    const va = put(st.dialA, aVals, span.a[0], span.a[1]);
    const vb = put(st.dialB, bVals, span.b[0], span.b[1]);
    markStep(3);
    st.steps.push({ n: 3, what: `a block on ${st.dialA} x ${st.dialB}`, chose: `${va[0]}..${va[va.length - 1]} x ${vb[0]}..${vb[vb.length - 1]}${pk ? '' : ' (recommended)'}` });
    fSave(); drawFunnel();
  };
  const ax = $('#fAcross');
  if (ax) ax.onclick = async () => {
    ax.disabled = true;
    const ruleKey = JSON.stringify(st.rule);
    const started = await tryPost(`api/funnel/${encodeURIComponent(st.set)}/across`, { rule: st.rule, unit: st.unit });
    if (!started) { ax.disabled = false; return; }
    st.acrossAsked = { ruleKey, token: started.token, at: new Date().toISOString() };
    fSave();
    fAcrossFollow(st, started);
  };
  // a reading started earlier for this rule -- the page was left and come
  // back to -- is followed again rather than asked for twice
  if (ax && ax.disabled && st.acrossAsked && !(st.across && st.across.ruleKey === st.acrossAsked.ruleKey)) fAcrossFollow(st, null);
  const ac = $('#fAccept4');
  if (ac) ac.onclick = () => {
    const a4 = (st.read || {}).accept;
    if (!a4) return;
    const best = ((a4.check || {}).positive || []).filter((p) => p != null);
    const said = a4.beatsAll != null
      ? `accepted ${a4.positive} of ${a4.of} other units positive; ${a4.beatsAll} beat every copy`
      : `accepted ${a4.positive} of ${a4.of}; the check managed ${best.length ? Math.max(...best) : '-'} of ${a4.of}`;
    // the mark is for accepting with some slice NOT positive; all positive is
    // not something to be marked for
    if (a4.positive != null && a4.of != null && a4.positive < a4.of) mark('slices', 4, said);
    if ((st.conditions || {}).checkIsHalves) mark('checkIsHalves', 4);
    st.steps.push({ n: 4, what: 'does it hold elsewhere', chose: said });
    st.step = 5; fSave(); drawFunnel();
  };
  const kr = $('#fKeepRegion');
  if (kr) kr.onclick = () => {
    const keep = (st.read || {}).keep;
    if (!keep) return;
    const ranges = {}; const allowed = {};
    for (const [dial, b] of Object.entries(keep.ranges)) ranges[dial] = { min: b.min, max: b.max };
    for (const [dial, v] of Object.entries(keep.allowed)) allowed[dial] = v.slice();
    st.rule.ranges = ranges; st.rule.allowed = allowed;
    markStep(5);
    st.steps.push({ n: 5, what: 'the widest region', chose: `kept as the rule (${Object.keys(ranges).length + Object.keys(allowed).length} dial(s))` });
    fSave(); drawFunnel();
  };
  const af = $('#fAddFloors');
  if (af) af.onclick = () => {
    const dd = $('#fDD').value;
    const tr = $('#fTrades').value;
    if (dd === '') delete st.rule.floors.maxDrawdown; else st.rule.floors.maxDrawdown = { max: Number(dd) };
    if (tr === '') delete st.rule.floors.avgTrades; else st.rule.floors.avgTrades = { min: Number(tr) };
    markStep(6);
    st.steps.push({ n: 6, what: 'exposure', chose: `worst streak ${dd}, fewest trades ${tr}` });
    fSave(); drawFunnel();
  };
  const rb = $('#fRebuild');
  if (rb) rb.onclick = async () => {
    rb.disabled = true;
    $('#fRebuildMsg').textContent = 'working them out - this prices the survivors again from their parent set';
    const out = await tryPost(`api/funnel/${encodeURIComponent(st.set)}/rebuild`, { labels: [] });
    rb.disabled = false;
    if (!out) { $('#fRebuildMsg').textContent = ''; return; }
    st.rebuilt = true; fSave();
    // THE PROOF IS SHOWN, NOT ASSUMED. An unchecked rebuild must never look
    // checked, so the absence of a check is printed as plainly as a failed one.
    const pr = out.proof || {};
    $('#fRebuildMsg').textContent = pr.ran
      ? ((pr.mismatches && pr.mismatches.length)
        ? `${pr.mismatches.length} setting(s) came back different from what the sweep stored - this is not the same run`
        : `done for ${out.settings} setting(s); all ${pr.checked} match what the sweep stored`)
      : `done for ${out.settings} setting(s) - NOT checked against the sweep (${String(pr.why || '')})`;
  };
  // THE CLOSING IS A CHOICE THAT CHANGES THE COUNT, so it redraws like every
  // other choice does. Picking 'take the top N by a column' seeds the count
  // from the target -- that is what the target was for -- and leaves it blank
  // when there is no target, which reads back as a choice not finished rather
  // than as a cut that happened.
  const cs = $('#fClose');
  if (cs) cs.onchange = () => {
    const key = cs.value;
    st.closing = key === 'top'
      ? { key, column: (st.closing || {}).column || 'avgTest', n: (st.closing || {}).n ?? st.target ?? null }
      : { key };
    st.steps.push({ n: 7, what: 'how to reach the target', chose: key });
    fSave(); drawFunnel();
  };
  const cc = $('#fCutCol');
  if (cc) cc.onchange = () => { st.closing = { ...st.closing, key: 'top', column: cc.value }; fSave(); drawFunnel(); };
  const cn = $('#fCutN');
  if (cn) cn.onchange = () => {
    st.closing = { ...st.closing, key: 'top', n: cn.value === '' ? null : Math.max(1, Math.floor(Number(cn.value) || 0)) };
    fSave(); drawFunnel();
  };
  const cut = $('#fCut');
  if (cut) cut.onclick = async () => {
    cut.disabled = true;
    $('#fCutMsg').textContent = 'writing';
    const out = await tryPost(`api/funnel/${encodeURIComponent(st.set)}/cut`, {
      name: $('#fName').value || null, target: st.target, rule: st.rule,
      steps: st.steps, backSteps: st.backSteps, closing: st.closing || { key: 'rule' },
      marks: st.marks || [],
      unit: st.unit,
    });
    cut.disabled = false;
    // WHAT THE CLOSING DID, in the reply, not only on the record. 'tighten the
    // ranges toward the middle' can stop short of the target, and a set written
    // with 480 against a target of 400 has to say it narrowed and stopped.
    const cd = (out && out.closing && out.closing.detail) ? ` - ${out.closing.detail}` : '';
    $('#fCutMsg').textContent = out
      ? `${out.name} written for ${out.unitName || 'all units together'} with ${out.survivors} setting(s)${cd}${(out.warnings || []).length ? ` - ${out.warnings.join(' - ')}` : ''}`
      : '';
  };
  const cl = $('#fClear');
  if (cl) cl.onclick = () => {
    st.backSteps.push({ from: st.step, to: 1, why: 'started the rule again' });
    st.rule = { ranges: {}, allowed: {}, floors: {} };
    st.closing = { key: 'rule' };
    st.step = 1; st.rebuilt = false; fSave(); drawFunnel();
  };
}

drawData = waitWrap(drawData);
drawSweep = waitWrap(drawSweep);
drawBoards = waitWrap(drawBoards);
drawVerify = waitWrap(drawVerify);
drawHistory = waitWrap(drawHistory);
drawTune = waitWrap(drawTune);
drawGreenlight = waitWrap(drawGreenlight);
drawFunnel = waitWrap(drawFunnel);
drawHelp = waitWrap(drawHelp);

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
        : tab === 'funnel' ? drawFunnel()
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
    // A DEAD SECTION CLEARS THE SCREEN. This used to replace #view only when it
    // was already empty, so a renderer that threw left the PREVIOUS tab's page
    // sitting under the new tab's highlight — every number on it relabelled by
    // a heading it does not belong to, and pressing the tab again just stacked
    // another banner on top of it. The owner hit exactly that: Verify
    // highlighted, Boards on screen, five banners piled above it (2026-08-29).
    // Showing nothing is honest; showing another screen's numbers is not.
    if (v) v.innerHTML = '<div class="panel empty">This section could not be drawn. Nothing below is from it.</div>';
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
