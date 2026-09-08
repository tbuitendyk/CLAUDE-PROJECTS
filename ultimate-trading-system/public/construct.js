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
// A GATEWAY THAT GAVE UP IS NOT A REFUSAL (owner, 2026-09-02: the press came
// back "FAILED - nothing changed. HTTP 504" while the run had started). The
// service may still be working on what was asked; say so, and say where the
// answer will show, instead of claiming nothing happened.
// AND IT SAYS WHERE **THIS** PRESS'S ANSWER WILL SHOW (3.67.0, owner report).
// It named Sweep and Boards whatever had been pressed, so a press on the Funnel
// sent the owner to two screens that know nothing about it. Every caller that
// is not a Sweep press says where its own answer lands.
const WHERE_SWEEP = 'The status line at the top of Sweep says what is going; Boards lists what landed.';
const tryPost = async (p, body, where = WHERE_SWEEP) => {
  try { return await post(p, body); } catch (e) {
    alert(/HTTP 50[24]\b/.test(String(e.message))
      ? 'NO ANSWER IN TIME — the service may still be working on it.\n\n' + e.message + '\n\n' + where
      : 'FAILED — nothing changed.\n\n' + e.message);
    return null;
  }
};
const WHERE_FUNNEL = 'The Stage 4 record set box at the top of this screen lists what landed - choose it there.';
// A POST that ASKS rather than acts: it changes nothing, so a failure is a
// blank answer, never a dialog. The cost line asks on every keystroke and a
// popup there would be unusable.
const askPost = async (p, body, fallback = null) => { try { return await post(p, body); } catch (_) { return fallback; } };

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
// A DIAL IS NAMED WITH ITS SWEEP LABEL EVERYWHERE THE FUNNEL SHOWS IT (owner
// order, 2026-09-04: "give me the actual FULL NAMES OF THESE DIALS IN ALL OF
// THE CONTROLS"): the step 1 table, the dial boxes on steps 2 and 3, the
// rule sentence, the step notes and the marks. A key that IS its Sweep label
// (gate, entry, decision) is written once, not "gate (gate)".
const fDialLabel = (d) => (DIAL_ON_SWEEP[d] && DIAL_ON_SWEEP[d] !== d ? `${d} (${DIAL_ON_SWEEP[d]})` : String(d));
// the dial boxes: the engine's list of dials (RULE FIVE), each named as above
function fDialOptions(selected) {
  const list = VOCAB && VOCAB.funnelDial;
  if (!list) return '<option value="">(choices unavailable)</option>';
  return list.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(selected) ? ' selected' : ''}>${esc(fDialLabel(o.value))}</option>`).join('');
}
// the rule sentence comes from the service with the dials' keys ("tHours 65
// to 137; gate is directional"); each part opens with its dial, so the key at
// the front of each part is named the same way before it is shown
function fRuleWords(sentence) {
  return String(sentence || '').split('; ').map((part) => part.replace(/^([A-Za-z]+)(?= )/, (k) => (DIAL_ON_SWEEP[k] ? fDialLabel(k) : k))).join('; ');
}

const COL = {
  // Funnel
  fDialName: 'one of the settings a sweep can be told to vary. This table lists only the dials this run swept more than one value of. A dial swept at a single value has nothing to measure against anything, so it is named on the "Not measurable here" line below instead of appearing here as flat.',
  fAcrossUnit: 'one of the other coin-and-shape units of this set. The rule built on this walk was applied to that unit\'s own records.',
  fAcrossSurvivors: 'how many of that unit\'s settings the rule keeps, out of all it has.',
  fCrossPair: 'the two dials this row is about. Every pair of dials whose values still vary among the settings your rule keeps is read; this is one of the pairs that turned out to say something.',
  fCrossBlock: 'the largest rectangle of boxes on that pair\'s grid that all beat the check, corner to corner. Pressing load this grid opens it so you can see it and keep it.',
  fCrossSquares: 'how many boxes that block covers, of how many boxes the whole grid has. A block covering the whole grid is not listed at all: it says nothing the two dials could not say separately.',
  fCrossBeats: 'across every box inside the block, against every scrambled copy of the table: how many of those comparisons the real box won, of how many there were. This is what the list is ordered by, and it is the only thing it is ordered by until two pairs tie.',
  fCrossLead: 'how far above the copies\' typical the block sits, in units of how far apart the copies are. Breaks a tie after the beats column and the size.',
  fCrossSays: 'what the pair is telling you: which dial\'s good part depends on the other. That dependence is the whole reason to grid two dials together instead of setting a range on each.',
  fGridCorner: 'the first dial down the side, the second across the top. Each square is the average test money of the settings that carry both values, with the count in brackets when the square is thin, and under it how many of the scrambled copies of that same square it beats - the same count step 2 shows for a value.',
  fGridValue: 'one value of the second dial. Read down this column to see how the first dial behaves at this value of the second.',
  fRegionDial: 'a dial the widest region spans. Keeping the region writes these edges into the rule.',
  fRegionFrom: 'the lowest value of this dial inside the region, or the one value a word-valued dial takes there.',
  fRegionTo: 'the highest value of this dial inside the region.',
  fCheck: 'how many of this dial\'s values make more money than that same value on at least the bar\'s worth of the scrambled copies (or sit above both halves\' averages, when the set kept no copies). On step 2 each value shows the copies\' range, how many of them it beats, and its lead: how far ahead of the copies\' average it sits, in units of their spread. That is the test step 2 applies to each value, so a bold row here is a row with something to keep on step 2. Zero means greyed: this dial may move the money, but not in the direction a forecast is for.',
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
  pair: 'the Binance symbol, hourly candles.',
  months: 'how many whole months of hourly candles are cached on this box for the pair.',
  from: 'first cached month, YYYY-MM.',
  to: 'last cached month, YYYY-MM. The current month is partial until it closes.',
  manage: 'per-pair actions. Downloading is by month; purging removes the cached candles, not any run that used them.',
  // saved-run lists
  run: 'the run id. The timestamp in it is when the job was FIRED, in UTC.',
  kind: 'which stage produced it — stage 1, 2, 3 or 4. Different stages read differently.',
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

// ---- release strip (persistent; the marker opens Setup on Version) ----------
// The release the box runs and the stage-engine check's standing for it, read
// from the check's own status: NOT CHECKED, RUNNING, PASS, FAIL or UNREADABLE.
// `running` is the in-flight check's run id, and it is what tells the page
// that something IS happening; the strip re-reads itself every five seconds
// while one runs, and stops the moment it lands.
let gatePoll = null;

function gateBadge(s) {
  if (!s) return { text: '—', cls: 'b-warn', tip: 'the stage-engine check\'s status is unavailable' };
  if (s.running || s.state === 'RUNNING') {
    return { text: 'RUNNING', cls: 'b-warn',
      tip: `the stage-engine check is running now${s.running ? ` (${s.running})` : ''} — two fabricated coins through all three stages, minutes not seconds` };
  }
  const st = String(s.state || 'NOT CHECKED');
  return {
    text: st,
    cls: /^pass$/i.test(st) ? 'b-pass' : /^fail$/i.test(st) ? 'b-fail' : 'b-warn',
    tip: (s.detail ? `${s.detail} — ` : 'the instrument\'s calibration certificate — ') + 'click to open Setup on Version, where it is run and read',
  };
}

async function renderStrip() {
  let s = null;
  try { s = await api('api/stage-gate/status'); } catch (_) { s = null; }
  const el = $('#strip');
  if (!el) return s;
  if (!s) { el.innerHTML = 'release <span class="muted">—</span>'; return null; }
  const b = gateBadge(s);
  // The flag's box sits ON the text bottom (owner order, 2026-08-26): the
  // class's middle-alignment centred this bordered box on the small text's
  // line and hung it below the release and time text beside it.
  el.innerHTML = `release ${esc(s.release || '')} · stage-engine check:
    <span class="badge ${b.cls}" id="stripBadge" style="vertical-align:text-bottom" title="${esc(b.tip)}">${esc(b.text.toUpperCase())}</span>`;
  const btn = $('#stripBadge');
  // The marker opens the Setup page on its Version tab, where the check is run
  // and read.
  if (btn) btn.onclick = () => { try { localStorage.setItem('setup-tab', 'version'); } catch (_) { /* private window */ } window.location.href = 'setup.html'; };
  // While a check is in flight, keep the marker honest without the owner having
  // to reload. One timer only, cleared the moment it lands.
  const going = !!(s.running || s.state === 'RUNNING');
  if (going && !gatePoll) {
    gatePoll = setInterval(async () => {
      const now = await renderStrip();
      if (!now || !(now.running || now.state === 'RUNNING')) { clearInterval(gatePoll); gatePoll = null; }
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
      ${rows.map((r) => (`
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
// EVERY START GHOSTS THE MOMENT IT IS PRESSED, AND THE LINE AT THE TOP SAYS
// STARTING (3.83.0, owner order 2026-09-07: "ghost as soon as a button is
// pressed AND not start a time-out that complains after one minute -- you
// need to give a status of 'starting...' or something like that at the top").
//
// The buttons used to sleep or wake only on the next tick of the four-second
// poll, so a press could be repeated inside that gap; and when the gateway
// gave up on a slow answer at sixty seconds the press came back as a failure
// dialog while the run had in fact started. Now all three sleep on the press
// itself, the status line at the top reads starting… before the box has
// answered, and a start whose answer the gateway dropped is not a failure:
// the line says the box has not answered yet and the poll goes and looks.
let swPressed = null;      // which start is in flight
let swPressedAt = 0;
function swStarting(what) {
  swPressed = String(what);
  swPressedAt = Date.now();
  for (const bid of ['swGo1', 'swGo2', 'swGo3']) {
    const b = $(`#${bid}`);
    if (b) { b.disabled = true; b.title = 'starting…'; }
  }
  const el = $('#swProg');
  if (!el) return;
  el.innerHTML = what === 'again' ? '<span>starting again…</span>'
    : what === 1 ? '<span>starting stage 1…</span>'
      : what === 2 ? '<span>starting stage 2…</span>' : '<span>starting stage 3…</span>';
}
// a start's POST. A gateway that gave up is not the box saying no -- the
// service may well be working on it -- so it is not a dialog either; the line
// says so, and the poll finds out. Anything else is a refusal, said plainly.
async function startPost(p, body) {
  try { return await post(p, body); } catch (e) {
    if (/HTTP 50[24]\b/.test(String(e.message))) {
      const el = $('#swProg');
      if (el) el.innerHTML = '<span>starting… the box has not answered yet — this line follows it</span>';
      return { pending: true };
    }
    alert('FAILED — nothing changed.\n\n' + e.message);
    return null;
  }
}
function swAfterStart(got) {
  if (!(got && got.pending)) swPressed = null;
  else if (!swPoll) swPoll = setInterval(swProgress, 4000);
  swProgress();
}

// EVERY PICKER CARRIES AN EMPTY ENTRY, AND IT IS THE DEFAULT (3.77.0, owner
// order 2026-09-06: "each drop down selector box should have an -empty- entry
// as well which is the default when nothing has been set. it should always be
// selectable. if it is selected then that item goes black and no longer links
// in either direction").
//
// Before this the box took the first record set on the list the moment one
// existed, so a set was named that the owner had never chosen -- and there was
// no way back to naming nothing. `— none —` is always there, always
// selectable, and always what an unset box shows.
// A PAUSED STAGE 3 RUN IS OFFERED WHERE A NEW ONE IS SET UP (3.82.0, owner
// order 2026-09-07: "an entry written to the stage 3 sweep drop down list as in
// a paused record set which can then be selected for start again perhaps
// using the existing start button"). Its value says so -- continue:<id> --
// and everything else on the section reads that value: the count line says
// what is already priced, the boxes below are ghosted because the run keeps
// its own, and start stage 3 starts it again instead of launching.
const swContinueOf = () => { const v = ($('#swFrom3') && $('#swFrom3').value) || ''; return v.startsWith('continue:') ? v.slice('continue:'.length) : null; };
function swPausedOptions(sets, selected) {
  const list = sets.filter((x) => x.stage === 3 && x.checkpoint && ['paused', 'interrupted', 'error'].includes(x.status));
  return list.map((x) => {
    const v = `continue:${x.id}`;
    const pf = x.perf || {};
    const how = x.status === 'paused' ? 'paused' : x.status === 'interrupted' ? 'paused by a restart' : 'paused by a failure';
    return `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${how} — ${esc(x.name)} — ${esc((x.createdAt || '').slice(0, 10))} — ${Number(pf.unitsDone || 0).toLocaleString()} of ${Number(pf.unitsTotal || 0).toLocaleString()} units priced</option>`;
  }).join('');
}
function swSetOptions(sets, stage, selected) {
  const list = sets.filter((x) => x.stage === stage && (x.status === 'done'));
  const on = selected ? '' : ' selected';
  // the stage 3 section's box (stage 2 parents) also offers the paused stage 3 runs
  const paused = stage === 2 ? swPausedOptions(sets, selected) : '';
  if (!list.length) return `<option value=""${on}>— none — no finished stage ${stage} record set on this box</option>${paused}`;
  return `<option value=""${on}>— none —</option>${paused}`
    + list.map((x) => `<option value="${esc(x.id)}"${x.id === selected ? ' selected' : ''}>${esc(x.name)} — ${esc((x.createdAt || '').slice(0, 10))} — ${x.plan.units.toLocaleString()} units${x.stage === 1 ? ', votes kept' : ''}</option>`).join('');
}
// EVERYTHING BELOW THE BOX IS GHOSTED WHILE A PAUSED RUN IS CHOSEN: the run
// keeps the settings it was launched with, and a live box that is not read is
// worse than a dead one (RULE FOUR's sibling). Turned off again the moment a
// parent is chosen instead; the count line then re-applies its own ghosting.
function swContinueMode(on) {
  const panel = $('#swH3') && $('#swH3').closest('.panel');
  if (!panel) return;
  for (const c of panel.querySelectorAll('select, input, button')) {
    if (c.id === 'swFrom3' || c.id === 'swGo3') continue;
    c.disabled = !!on;
    const holder = c.closest('label') || c;
    holder.classList.toggle('ctl-off', !!on);
  }
}

// THE PARENT PICKERS FOLLOW WHAT IS ON THE BOX (3.76.1, owner order 2026-09-06:
// "when the stage one sweep finishes, you must refresh the stage two boxes ...
// when the stage two sweep finishes, obviously, you must refresh the stage
// three box").
//
// They were filled once, when the screen was drawn, and never again. So a
// stage 1 run watched from this screen landed and left `from stage 1 record
// set` still reading "no finished stage 1 record set on this box" -- the set
// was there, finished, on disk, and the only way to see it was to reload.
//
// The poll below already fetches the list every four seconds, INCLUDING on the
// tick that finds the run has ended, which is the tick that matters. This
// rebuilds both boxes off that same list, through the same builder a fresh
// draw uses, so the two can never say different things.
//
// TWO THINGS IT MUST NOT DO. It must not take the owner's choice away: the box
// keeps whatever it names as long as that set is still on the list. And it must
// not rewrite a box that has not changed -- a select rebuilt under an open
// dropdown closes it, and this ticks every four seconds. So the comparison is
// made on the list WITHOUT the selection marked, and the owner changing the box
// therefore never reads as the list having changed.
const swParentShown = new Map();   // box -> the options last written, unselected
function swRefillParents(sets) {
  let moved = false;
  for (const [sel, stage] of [['#swFrom2', 1], ['#swFrom3', 2]]) {
    const box = $(sel);
    if (!box) continue;
    const shape = swSetOptions(sets, stage, null);
    if (swParentShown.get(sel) === shape) continue;
    swParentShown.set(sel, shape);
    // a box naming a set that is still there keeps it; one naming nothing, or
    // naming a set that has gone, takes the first on the list -- which is
    // exactly what a fresh draw of this screen shows
    box.innerHTML = swSetOptions(sets, stage, box.value || null);
    moved = true;
  }
  return moved;
}

async function swProgress() {
  const el = $('#swProg');
  if (!el) return;
  const st = await apiOr('api/stagesets', null);
  if (!st) { el.innerHTML = '<span class="warn">the record-set list could not be read</span>'; return; }
  // the greyed suggestion in each name box is the next free name, and it
  // moves the moment a launch takes one
  for (const n of [1, 2, 3]) { const b = $(`#swName${n}`); if (b && st.nextNames) b.placeholder = st.nextNames[n] || ''; }
  // and the two parent boxes follow the same fresh list, on every tick and on
  // the last one. The cache goes with them: the heading colours and the stage 3
  // cost line are both judged off it, so a stale copy would answer for a box
  // that has just moved.
  swSetsCache = st.sets || [];
  const swMoved = swRefillParents(swSetsCache);
  // THE HEADING COLOURS ARE REPAINTED ON EVERY TICK, NOT ONLY WHEN A BOX MOVED
  // (3.76.2, owner order 2026-09-06: "JUST THINK ABOUT IT AND CODE IT RIGHT SO
  // THE DROP DOWNS FILL AND THE COLORS SET").
  //
  // Filling the box and setting the colour are two answers to one event, and
  // hanging the second off the first is what leaves them disagreeing. A heading
  // is judged from THREE things -- the record set its own box names, the row
  // behind that set, and the boxes in the section above it -- and rebuilding
  // the options only ever watches the first. So the colour is worked out from
  // scratch every four seconds, unconditionally, and can never be left saying
  // something that was true one tick ago.
  //
  // It is free to do that: three string comparisons and a colour written to
  // three headings. Writing the same colour again is nothing at all. Re-asking
  // the COUNTS is not free -- it blanks both cost lines to an asking note --
  // so that stays behind the boxes actually having moved, with the draft
  // memory that only has something new to save when they have.
  swProvenance();
  if (swMoved) {
    rememberSweepForm();
    swCountsSoon();
  }
  // the start buttons sleep while a run is going — one heavy job at a time,
  // said on the button instead of by a refusal after the press
  const going = !!st.running;
  // a press in flight keeps the buttons asleep and the line saying starting
  // until the box reports the run -- for two minutes, in case the gateway
  // dropped the answer -- and a run that appears ends the wait
  if (going) swPressed = null;
  if (!going && swPressed) {
    if (Date.now() - swPressedAt < 120000) { if (!swPoll) swPoll = setInterval(swProgress, 4000); return; }
    swPressed = null;
  }
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
    ? `<b>${esc(row.name)}</b> is going: ${esc(row.progress || '…')}${tail ? ` · ${tail}` : ''} <button id="swStop" class="danger">${row.stage === 3 ? 'pause' : 'stop'}</button>`
    : `a stage run is going (${esc(st.running)})`;
  const stop = $('#swStop');
  if (stop) stop.onclick = async () => { await tryPost(`api/stageset/${st.running}/stop`, {}); swProgress(); };
  if (!swPoll) swPoll = setInterval(swProgress, 4000);
}

// GREEN WHEN A SECTION READS FROM WHAT THE SECTION ABOVE IT SHOWS, RED AT THE
// POINT OF BREAK (owner order, 2026-08-27; re-aimed 2026-09-02: "why is Stage
// 2 red ... should be GREEN and Stage 3 should be red"). Each title is judged
// by ITS OWN box: stage 2's by the stage 1 record set its box names, held up
// to the stage 1 section above; stage 3's by the stage 2 record set its box
// names, held up to the stage 2 section above. Stage 1 is the root and has
// nothing above it to disagree with. It was judged one section up before --
// the red landed on the section ABOVE the box that broke the chain, so a
// stage 3 box still naming an older stage 2 set painted Stage 2. Judged live
// on every change; set a box back and the title goes green again. A box
// naming no record set is green.
function swProvenance() {
  const sets = swSetsCache || [];
  const rowOf = (id) => sets.find((x) => x.id === id) || null;
  // A SECTION THAT NAMES NO RECORD SET CLAIMS NOTHING (3.76.3, owner order
  // 2026-09-06: "you've got stage 3 that's got nothing in it green. that's
  // dumb. it should be black"). Green is a statement -- this section reads from
  // what the section above it shows -- and an empty box has not made it. So
  // there are three states, not two, and the third is the page's own colour:
  // the heading is left exactly as the stylesheet draws it, which is neither
  // claim. Pass `ok` as null for it.
  const paint = (sel, ok, why) => {
    const h = $(sel);
    if (!h) return;
    if (ok === null) {
      h.style.color = '';
      h.title = why;
      return;
    }
    h.style.color = ok ? 'var(--pos)' : 'var(--neg)';
    h.title = ok
      ? 'green: this section is part of one linked chain with the green sections above it'
      : `red: ${why}. Set the boxes back and this goes green again.`;
  };
  // AND A RED HEADING SAYS WHY ON THE SCREEN, NOT IN A HOVER (3.76.4, owner:
  // "STILL RED"). The reason was written into the heading's hover text and
  // nowhere else, so a red heading was a colour with no way to act on it: the
  // owner could see that something disagreed and not which box, or what it
  // disagreed with. Three sittings were spent on that. The line names the
  // control, what the box holds now, and what the record set was actually run
  // with -- which is everything needed to set it back.
  const sayWhy = (sel, m) => {
    const p = $(sel);
    if (!p) return;
    if (!m) { p.innerHTML = ''; p.style.display = 'none'; return; }
    p.style.display = '';
    p.innerHTML = `<b>${esc(m.what)}</b> — the box holds ${esc(m.box)}, and ${esc(m.setName)} was run with ${esc(m.set)}. `
      + 'Set the box back and this section goes green again.';
  };
  const v = (sel) => { const e = $(sel); return e ? e.value : ''; };
  const c = (sel) => { const e = $(sel); return !!(e && e.checked); };

  // THE OWNER'S TRUTH TABLE, WRITTEN OUT (3.77.0, 2026-09-06), and this
  // function does nothing that is not one of these six rows:
  //
  //   black black black   all empty
  //   green black black   s1 set, others empty
  //   green red   black   s1 set, s2 doesn't match, s3 empty
  //   green green black   s1 set, s2 matches, s3 empty
  //   green green red     s1 set, s2 matches, s3 doesn't match
  //   green green green   s1 set, s2 matches, s3 matches
  //
  // Read down the column and each section answers for ITS OWN box:
  //
  //   * black is "nothing set here". It claims nothing and links in neither
  //     direction -- the owner's words for the empty entry in a picker.
  //   * red is "what is set here does not match the section above". The red
  //     lands on the section whose own box holds the break, never the one
  //     above it.
  //   * green is "set, and matching". The greens together are what show the
  //     chain is linked.
  //
  // EACH SECTION ANSWERS FOR ITS OWN BOX AND NOTHING ELSE. The owner's later
  // rows settle it: `green black red` -- stage 2 empty and stage 3 still red
  // for a set that does not match -- and `green red green`, stage 3 green over
  // a stage 2 that is not. So no section's colour is ever gated on the one
  // above it being green; each is only ever describing what is in its own box.
  //
  // STAGE 1 HAS NO PICKER, so "s1 set" is its own section being set up at all:
  // a run needs at least one of singles / doubles / triples, and with none of
  // them ticked there is no stage 1 to link anything to. It is never red --
  // it names no record set, so it can never be the section that disagrees.
  paint('#swH1', (c('#swSingles') || c('#swDoubles') || c('#swTriples')) ? true : null,
    'stage 1 is set up once singles, doubles or triples is ticked — until then there is nothing here for the sections below to link to');

  const s1row = rowOf(v('#swFrom2'));
  sayWhy('#swWhy2', null);
  sayWhy('#swWhy3', null);
  if (!v('#swFrom2')) paint('#swH2', null, 'this section names no stage 1 record set yet, so nothing is linked to the stage 1 section above');
  else if (!s1row) paint('#swH2', false, 'the stage 1 record set named here is not on this box any more');
  else {
    const p = s1row.params || {};
    // A BOX IS COMPARED AS THE LAUNCH RESOLVED IT, NEVER AS IT IS TYPED
    // (3.76.3, owner: "you've got state 2 red that matches exactly with stage
    // 1. that's dumb. it should be green").
    //
    // A stage 1 run writes down what it ACTUALLY read, not what was in the box
    // -- that is RULE NINE, and it is right. Blank `compare coins` is recorded
    // as the seventeen default pairs; blank month boxes are recorded as the
    // months the launch fell back to. Held up to the raw box, every one of
    // those reads as a disagreement, so a set launched from a blank compare
    // coins box -- which is every set on the box -- painted Stage 2 red the
    // moment its own record set appeared in the box below, and nothing the
    // owner could type would ever make it green.
    //
    // So each box is put through the SAME resolution the launch uses before it
    // is compared. The trade coins box has always been read this way; the other
    // two were not. Where these two files must agree, they are named together:
    // theStageHeadingsCompareABoxTheWayTheLaunchResolvesIt reads both.
    const defaults = ((VOCAB && VOCAB.defaultPairs) || []).map((o) => String(o.value));
    const coinsIn = (sel) => (v(sel) || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    const boxUni = coinsIn('#swUni');
    const wantUni = (boxUni.length ? boxUni : defaults).slice().sort().join(',');
    const setUni = (p.universe || []).slice().sort().join(',');
    // ...and the compare coins are recorded EMPTY when nothing reads them:
    // singles on their own put no coin alongside another
    const boxCmp = coinsIn('#swCompare');
    const wantCmp = ((c('#swDoubles') || c('#swTriples')) ? (boxCmp.length ? boxCmp : defaults) : [])
      .slice().sort().join(',');
    const setCmp = (p.compare || []).slice().sort().join(',');
    const sz = p.sizes || {};
    const geos = p.geometries || [];
    // ONE ROW PER THING COMPARED, each carrying what the box holds and what
    // the run recorded, so the screen can say both. A bare "no longer match"
    // is a colour with no way to act on it.
    const ticks = (a, b, cc) => `${a ? 'singles' : ''}${b ? ' doubles' : ''}${cc ? ' triples' : ''}`.trim() || 'none ticked';
    const shape = (perm, one) => (perm ? 'every chunk shape' : one);
    const months = (all, from, to) => (all ? 'all loaded data' : `${from} to ${to}`);
    const CHECKS = [
      ['trade coins', wantUni.split(',').join(', '), setUni.split(',').join(', ')],
      ['compare coins', wantCmp ? wantCmp.split(',').join(', ') : 'none', setCmp ? setCmp.split(',').join(', ') : 'none'],
      ['singles / doubles / triples', ticks(c('#swSingles'), c('#swDoubles'), c('#swTriples')), ticks(!!sz.singles, !!sz.doubles, !!sz.triples)],
      ['chunk shape', shape(c('#swPermGeom'), v('#swGeom')), shape(geos.length > 1, geos[0] || 'unrecorded')],
      ['window layout', v('#swLayout'), p.windowLayout || 'unrecorded'],
      ['weigh each trade by the money it was worth', c('#swByMoney') ? 'on' : 'off', (p.trainOn || 'direction') === 'money' ? 'on' : 'off'],
      ['null set size', String(Number(v('#swNull1'))), String(Number(p.nullN))],
      ['all loaded data', c('#swAllData') ? 'on' : 'off', p.allLoaded !== false ? 'on' : 'off'],
      ['start / end months', months(c('#swAllData'), v('#swStart') || '2018-01', v('#swEnd') || '2026-06'),
        months(p.allLoaded !== false, p.startMonth || '', p.endMonth || '')],
    ];
    const off = CHECKS.find(([, box, set]) => box !== set);
    const mismatch = off ? { what: off[0], box: off[1], set: off[2], setName: s1row.name } : null;
    paint('#swH2', !mismatch, mismatch
      && `${mismatch.what} no longer matches — the stage 1 section above no longer shows the provenance of ${s1row.name}, the record set this box reads from`);
    sayWhy('#swWhy2', mismatch);
  }

  // stage 3: the stage 2 record set its box names, held up to the stage 2 section
  //
  // An empty stage 2 box above does NOT excuse this one: `green black red` is
  // the owner's own row -- a stage 3 set naming a chain the stage 2 box no
  // longer shows is a break in THIS box, and it is red whatever is above it.
  // a paused run chosen here is linked through ITS parent, the stage 2 set it
  // was priced from, so the truth table reads exactly as it does for a launch
  // (read off the box's own value here rather than through swContinueOf, so
  // this function stays whole when a test lifts it out and runs it alone)
  const s3v = v('#swFrom3');
  const cont = s3v.startsWith('continue:') ? s3v.slice('continue:'.length) : null;
  const pausedRow = cont ? rowOf(cont) : null;
  const s2row = cont ? (pausedRow ? rowOf((pausedRow.parent || {}).id) : null) : rowOf(v('#swFrom3'));
  if (!v('#swFrom3')) paint('#swH3', null, 'this section names no stage 2 record set yet, so there is nothing set here to link');
  else if (cont && !pausedRow) paint('#swH3', false, 'the paused record set named here is not on this box any more');
  else if (!s2row) paint('#swH3', false, 'the stage 2 record set named here is not on this box any more');
  else {
    const par = s2row.parent || {};
    const carryBox = Number(v('#swCarry')) || 0;
    const carryMatch = carryBox === 0
      ? (par.carry != null && par.of != null ? par.carry === par.of : true)
      : carryBox === par.carry;
    const named = rowOf(v('#swFrom2'));
    const mismatch = v('#swFrom2') !== (par.id || '')
      ? { what: 'from stage 1 record set', box: (named && named.name) || 'nothing', set: par.name || par.id || 'unrecorded', setName: s2row.name }
      : (!carryMatch
        ? { what: 'carry forward', box: String(carryBox), set: `${par.carry} of ${par.of}`, setName: s2row.name }
        : null);
    paint('#swH3', !mismatch, mismatch
      && `${mismatch.what} no longer matches — ${s2row.name}, the record set this box reads from, does not come out of the stage 2 section above`);
    sayWhy('#swWhy3', mismatch);
  }
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

// A GROUP THIS BLOCK WILL NOT READ IS GHOSTED, NEVER HIDDEN (owner order,
// 2026-09-03: "ghost arm and one voice at"). Greyed and held, so the row keeps
// its shape and what is in the box comes back untouched the moment the box it
// waits on changes. Hiding is for a box that cannot exist at all (market has
// no rails); ghosting is for one that exists and nothing in the block reads.
function swGhostGroup(sel, off) {
  const e = $(sel);
  if (!e) return;
  e.classList.toggle('ctl-off', !!off);
  for (const c of e.querySelectorAll('select, input')) c.disabled = !!off;
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
  {
    // arm is read only by a stop that follows the price: with trail on static
    // and its permute unticked, no setting in the block has one, so the box
    // and its tick would change nothing. one voice at is read only by voices:
    // with quorum by on anything else and its permute unticked, nothing in
    // the block can read it either.
    const staticStop = $('#swTrail') && $('#swTrail').value === ''
      && !($('#swPermTrail') && $('#swPermTrail').checked);
    swGhostGroup('#swGrpArm', staticStop);
    const notVoices = $('#swAgreeRule') && $('#swAgreeRule').value !== 'voices'
      && !($('#swPermAgreeRule') && $('#swPermAgreeRule').checked);
    swGhostGroup('#swGrpCopy', notVoices);
    // NOTHING READS THE COMPARE COINS WHEN ONLY SINGLES IS TICKED (owner,
    // 2026-09-06: "what are you allowing that compare coins box for when only
    // singles is selected? ... that makes NO SENSE AT ALL"). A single is a
    // coin on its own price history alone -- there is nothing for it to be
    // read against, so a box that takes a list and changes nothing is a box
    // that lies. Greyed, never hidden, exactly as arm is under a static stop.
    swGhostGroup('#swGrpCompare', !($('#swDoubles') && $('#swDoubles').checked)
      && !($('#swTriples') && $('#swTriples').checked));
  }
  const c1 = $('#swCost1');
  if (c1) {
    const body = {
      universe: ($('#swUni').value || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean),
      compare: ($('#swCompare').value || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean),
      sizes: { singles: $('#swSingles').checked, doubles: $('#swDoubles').checked, triples: $('#swTriples').checked },
      geometry: $('#swGeom').value, permuteGeometry: $('#swPermGeom').checked,
    };
    if (!body.universe.length) delete body.universe;
    if (!body.compare.length) delete body.compare;
    const r = await swAsk('api/stage1-count', body);
    if (current()) {
      swSayCount(c1, r.ok
        ? `${r.data.units.toLocaleString()} units → ${r.data.trainings.toLocaleString()} trainings, votes kept for every one · null set is free arithmetic`
        : null, r.why);
    }
  }
  if (!current()) return;   // a newer ask is in flight; its answer is the one to draw
  const c3 = $('#swCount');
  if (c3 && swContinueOf()) {
    // a paused run: nothing to count, everything to say
    const sets = swSetsCache || [];
    const x = sets.find((y) => y.id === swContinueOf());
    swContinueMode(!!x);
    const pf = (x && x.perf) || {};
    const left = Math.max(0, Number(pf.cyclesTotal || 0) - Number(pf.cyclesDone || 0));
    swSayCount(c3, x
      ? `starts again where it was paused: <b>${Number(pf.unitsDone || 0).toLocaleString()} of ${Number(pf.unitsTotal || 0).toLocaleString()} units</b> are already priced and are kept`
        + ` · about ${left.toLocaleString()} pricings still to go · the boxes below are this run's own and cannot be changed here`
      : null, x ? null : 'the paused record set named here is not on this box any more');
    return;
  }
  swContinueMode(false);
  if (c3) {
    const sets = swSetsCache || [];
    const parent = sets.find((x) => x.id === $('#swFrom3').value);
    const pick = ($('#swPick3') && $('#swPick3').value) || 'count';
    const carry = Number($('#swCarry3') && $('#swCarry3').value) || 0;
    const pickedN = parent ? Number(parent.picked) || 0 : 0;
    const units = parent
      ? (pick === 'selected' ? pickedN : (carry > 0 ? Math.min(carry, parent.plan.units) : parent.plan.units))
      : null;
    // the carry box applies to N records only; under Selected records the
    // line beside it says how many are picked on the parent's table
    if ($('#swCarry3')) $('#swCarry3').disabled = pick === 'selected';
    if ($('#swPicked3')) $('#swPicked3').textContent = pick === 'selected' && parent ? `${pickedN.toLocaleString()} picked on ${parent.name}` : '';
    const coins = parent && parent.params && Array.isArray(parent.params.universe) ? parent.params.universe.length : null;
    // from and carry ride along so the counter resolves the ACTUAL units the
    // launch will price — which agreement bars exist is decided by them, and
    // a bar the run cannot use is neither counted nor named (owner order,
    // 2026-08-27: on singles there is no with contexts at all)
    const r = await swAsk('api/stage3-count', {
      ...swBlockParams(), from: $('#swFrom3').value || '', carry, pick, units: units || 0, coins: coins || 1,
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
      // 24/5 IS GHOSTED WHEN NO UNIT BEING PRICED HAS A WEEKDAY VERSION (owner
      // order, 2026-09-04: "the system should not permute 24/5 on any weekly
      // shape. Ever."). Weekly shapes span weekends whichever way the box is
      // set, so with only those units the box and its tick would change
      // nothing -- ghosted the way arm is under a static stop, never hidden.
      swGhostGroup('#swGrpWk', got.weekdaysApply === false);
      // the budget verdict comes from the SAME arithmetic the launch enforces:
      // a refusal is said here, before the button is pressed
      const refuse = (got.heap && got.heap.band === 'refuse' && got.heap) || (got.disk && got.disk.band === 'refuse' && got.disk) || null;
      const tight = !refuse ? ((got.heap && got.heap.band === 'tight' && got.heap) || (got.disk && got.disk.band === 'tight' && got.disk) || null) : null;
      // WHEN THE BLOCK ASKED FOR MORE THAN IT WILL PRICE, SAY SO. Settings that
      // place identical orders on every unit are folded to one; a count that
      // quietly shrank would be as much of a surprise as one that grew.
      const fold = got.declared && got.folded ? ` <span class="muted">(${got.declared.toLocaleString()} declared, `
        + `${got.folded.toLocaleString()} priced the same trade and were folded into one)</span>` : '';
      // WHAT THE UNITS HOLD (3.52.0): a unit prices only the settings that
      // place different orders on it, so the pricings are the sum of what each
      // unit holds, never settings × units, and a unit holding fewer is said
      const perUnit = Array.isArray(got.unitSettings) ? got.unitSettings.map((x) => Number(x.held) || 0) : [];
      const fewer = perUnit.filter((n) => n < got.settings).length;
      const pricings = Number(got.pricings) || 0;
      // A FILTER SAVED ON THE PARENT'S TABLE CUTS WHAT THE CARRY TAKES (3.78.0,
      // owner order: "the carry from table 2 must NOT ignore filters!"). It is
      // said HERE because the boxes that hold it are on another screen: a
      // filter set days ago and forgotten would otherwise change what this
      // launch prices with nothing in front of the owner about it.
      const cut = got.filtered
        ? `<br><span class="warn">the filters saved on the parent's table leave <b>${Number(got.filtered.held).toLocaleString()}</b> `
          + `of its ${Number(got.filtered.of).toLocaleString()} records, and the carry takes the top of those. `
          + 'Press clear filters under its table on Boards to carry from the whole set.</span>'
        : '';
      html = `declared: <b>${got.settings.toLocaleString()} settings</b>${fold}${units && perUnit.length ? ` — ${perUnit.length.toLocaleString()} units hold ${pricings.toLocaleString()} between them`
        + (fewer ? ` <span class="muted">(${fewer.toLocaleString()} of them hold fewer than the block: a setting that places the same orders on a unit as another is priced there once)</span>` : '')
        + ` × ${per3().toLocaleString()} readings ≈ ${(pricings * per3()).toLocaleString()} pricings — no trainings` : ''}`
        + cut
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
  // t IS HOURS, OR THE ONE CHOICE THAT IS NOT (3.72.0). Coercing it here would
  // send NaN and the launch would refuse with a message about the grid, which
  // is true and useless.
  const tRaw = $('#swT').value;
  const cell = { tHours: tRaw === 'own' ? 'own' : Number(tRaw) };
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
    setV('#swCompare', (p.compare || []).join(','));
    setC('#swSingles', (p.sizes || {}).singles); setC('#swDoubles', (p.sizes || {}).doubles); setC('#swTriples', (p.sizes || {}).triples);
    setC('#swAllData', p.allLoaded !== false);
    setV('#swStart', p.startMonth || ''); setV('#swEnd', p.endMonth || '');
    const geos = p.geometries || [];
    if (geos.length) setV('#swGeom', geos[0]);
    setC('#swPermGeom', geos.length > 1);
    setV('#swLayout', p.windowLayout || 'reserve61');
    setC('#swByMoney', (p.trainOn || 'direction') === 'money');
    setV('#swCap1', p.weightCap ?? 10);
    setV('#swNull1', p.nullN ?? 19);
    setV('#swFee1', p.fee != null ? p.fee * 100 : 0.125);
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
    setV('#swPick3', p.selected != null ? 'selected' : 'count');
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
      <button id="campTree" title="shows the record sets and greenlights belonging to the campaign named in the box. Press it again to put them away.">View tree</button>
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
    box.innerHTML = t ? `<h3>Campaign “${esc(t.name)}” — record sets &amp; greenlights</h3>
      <table><thead><tr>${cth('record set','run')}${cth('kind','kind')}${cth('status','status')}${cth('started','started')}${cth('derives from','derives','text-align:left')}</tr></thead><tbody>
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
    // WHAT CAME OUT OF THIS CAMPAIGN'S SETS IS COUNTED SEPARATELY (2026-09-06).
    // A record set cut from one of these carries no campaign name of its own,
    // and it has to go first or its parent refuses -- so it IS deleted, and
    // showing it folded into one number would be deleting something the owner
    // was never shown.
    const inherited = (found.stageSets || []).filter((x) => x.inherited);
    const lines = [
      ['greenlights', c.greenlights],
      ['setups (none deployed)', c.setups],
      ['record sets', c.stageSets - inherited.length],
      ['record sets that came out of them', inherited.length],
    ].filter(([, n]) => n > 0);

    box.innerHTML = `<div class="panel" style="border-color:var(--warn)"><b style="color:var(--warn)">Deleting “${esc(found.name)}” will permanently remove:</b>
      ${lines.length ? `<ul style="margin:.3rem 0 0 1.1rem">${lines.map(([what, n]) =>
    `<li><b>${n}</b> ${esc(what)}</li>`).join('')}</ul>`
    : '<div style="margin-top:.3rem">nothing but the name — this campaign holds no record sets, greenlights or setups.</div>'}
      ${inherited.length ? `<div style="margin-top:.4rem">The ${inherited.length} that came out of them carry no campaign name of their own, and
        they are named here because they go too — a set another set was cut from cannot be removed while it is still there:
        <b>${inherited.map((x) => esc(x.name || x.id)).join(' · ')}</b></div>` : ''}
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

// THE TOP OF AN OPENED RUN IS ONE STRUCTURE, DRAWN ON TWO SCREENS (owner
// order, 2026-08-27: "the same structure at the top of Boards as we have
// with Boards ... all formatted the same — recycle / re-use whatever
// code/back-end you need"). Boards draws a saved run's head with these;
// Boards draws a record set's head with the SAME functions, so the two
// cannot drift apart — the same reason the Trade page draws its two branches
// from one path. Top-level and called by name, so the word list and the
// control reader follow them onto both screens.
function campaignNoteHtml(doc) {
  // AND HOW ITS UNITS WERE TRAINED (3.69.0). A set trained on what each trade
  // was worth is not comparable with one trained on direction alone, so the
  // set says which it was wherever it is named rather than leaving it to the
  // release it was made under.
  const p = (doc && doc.params) || {};
  const trained = (p.trainOn === 'money')
    ? `trained by the money each trade was worth${Number(p.weightCap) > 0 ? `, one trade worth at most ${Number(p.weightCap)}` : ''}`
    : 'trained by direction only';
  return doc ? `<span class="note">campaign: ${esc(p.campaign || '—')} · ${esc(doc.status)} · ${esc(p.windowLayout || '')} · ${esc(trained)}</span>` : '';
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
// THE NAME IS THE OWNER'S, on every open section (owner order, 2026-09-03).
// Three literal copies for the same reason the notes have three: the ids are
// read out of the source. Held asleep while the set is being written, with the
// reason on the button, exactly as the notes are.
function namePanel1(doc) {
  const off = doc.status === 'running';
  return `<div class="panel">
        <div class="row" style="align-items:flex-end">
          <label class="f">name<input id="bName1" value="${esc(doc.name || '')}" maxlength="80" style="width:14rem" ${off ? 'disabled' : ''}></label>
          <button id="bRename1" ${off ? 'disabled title="the name changes after the run finishes — the engine refuses writes while it computes"' : ''}>rename</button>
          <span id="bNameMsg1" class="note">${doc.nameEditedAt ? `renamed ${esc(String(doc.nameEditedAt).slice(0, 16))}` : ''}</span>
        </div>
      </div>`;
}
function namePanel2(doc) {
  const off = doc.status === 'running';
  return `<div class="panel">
        <div class="row" style="align-items:flex-end">
          <label class="f">name<input id="bName2" value="${esc(doc.name || '')}" maxlength="80" style="width:14rem" ${off ? 'disabled' : ''}></label>
          <button id="bRename2" ${off ? 'disabled title="the name changes after the run finishes — the engine refuses writes while it computes"' : ''}>rename</button>
          <span id="bNameMsg2" class="note">${doc.nameEditedAt ? `renamed ${esc(String(doc.nameEditedAt).slice(0, 16))}` : ''}</span>
        </div>
      </div>`;
}
function namePanel3(doc) {
  const off = doc.status === 'running';
  return `<div class="panel">
        <div class="row" style="align-items:flex-end">
          <label class="f">name<input id="bName3" value="${esc(doc.name || '')}" maxlength="80" style="width:14rem" ${off ? 'disabled' : ''}></label>
          <button id="bRename3" ${off ? 'disabled title="the name changes after the run finishes — the engine refuses writes while it computes"' : ''}>rename</button>
          <span id="bNameMsg3" class="note">${doc.nameEditedAt ? `renamed ${esc(String(doc.nameEditedAt).slice(0, 16))}` : ''}</span>
        </div>
      </div>`;
}
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
// THE DATE RANGES A RUN USED, ON ITS HEADER (3.85.0, owner order 2026-09-07).
// Each window is the span across the run's units; the unread window runs from
// where the seal began to the newest candle the box holds today, because
// whatever reads it reads all the data there is.
function windowsLineHtml(win) {
  if (!win) return '';
  const day = (ts) => (Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : '?');
  const rng = (w) => (w ? `${day(w.fromTs)} → ${day(w.toTs)}` : null);
  const parts = [];
  if (win.train) parts.push(`training ${rng(win.train)}`);
  if (win.test) parts.push(`test ${rng(win.test)}`);
  if (win.hold) parts.push(`held-back ${rng(win.hold)}`);
  if (win.unread) parts.push(`unread from ${day(win.unread.fromTs)} onward — the box holds data to ${day(win.unread.dataToTs)}, all of it unread`);
  // a run still going, or paused, has them for the units priced so far
  const state = win.known >= win.units && win.units > 0 ? '' : win.known ? ` — ${win.known} of ${win.units} units so far` : '';
  return `<p class="note"><b>Date ranges:</b> ${parts.length ? parts.map((x) => esc(x)).join(' · ') : (win.units ? 'not recorded on this run yet' : 'no units')}${state}</p>`;
}
function runIdentityPanelHtml(sizeLine, dm, win = null) {
  return `<div class="panel"><h3 style="margin-top:0">What this run actually is</h3>
          ${sizeLine || ''}
          ${windowsLineHtml(win)}
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
// the rename posts the one field the endpoint reads, then redraws Boards where
// it stands, because every picker and heading on the screen shows the name
function wireRename(url, suffix) {
  const b = $(`#bRename${suffix}`);
  if (b) b.onclick = async () => {
    const box = $(`#bName${suffix}`);
    const out = await tryPost(url, { name: box.value });
    if (out) {
      box.value = out.name || '';
      $(`#bNameMsg${suffix}`).textContent = `renamed ${String(out.nameEditedAt || '').slice(0, 16)}`;
      drawBoardsHoldingPlace();
    }
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
// ---- Verify: the machinery check, then the verdict on a Stage 4 record set --------
//
// (3.86.0, VERIFY-DESIGN.md.) THE UNIT OF VERIFICATION IS THE SET, never one
// row: a rule can be checked against scrambled data and a single row cannot,
// which is why the Funnel writes a rule. Every label below sits in a top-level
// helper with markup, so the word list sees it.
const V_SET_KEY = 'cx-verify-set';
const WHERE_VERIFY = 'The Stage 4 record set box on Verify lists what was stamped - pick the set there.';
function vRememberedSet(list) {
  let want = null;
  try { want = localStorage.getItem(V_SET_KEY); } catch (_) { want = null; }
  if (want && list.some((x) => x.id === want)) return want;
  return list.length ? list[0].id : null;          // newest first, as the server lists them
}
const vDay = (ts) => (ts != null && Number.isFinite(Number(ts)) ? new Date(Number(ts)).toISOString().slice(0, 10) : '?');
const vPct = (v) => (v == null ? '?' : `${Math.round(100 * v)}%`);
const vFix = (v, n = 2) => (v == null || !Number.isFinite(Number(v)) ? 'none' : Number(v).toFixed(n));

// the set is picked from the server's own list, newest first, never typed
function vSetBoxHtml(list, chosen) {
  return `<div class="row"><label class="f" title="every Stage 4 record set on this box, newest first, with its coin and shape, its survivors of its target, and whether a verdict is stamped on it">Stage 4 record set<select id="vSet" style="min-width:28rem">${list.length
    ? list.map((x) => `<option value="${esc(x.id)}" ${x.id === chosen ? 'selected' : ''}>${esc(x.name)} · ${esc(x.unitName || 'all units together')} · ${Number((x.counts || {}).survivors ?? 0).toLocaleString()} of ${x.target == null ? 'no target' : Number(x.target).toLocaleString()} · ${x.verify ? `${x.verify.pass ? 'PASS' : 'FAIL'} stamped ${esc(String(x.verify.at).slice(0, 10))}` : 'no verdict yet'}</option>`).join('')
    : '<option value="">- no Stage 4 record set on this box yet - cut one on the Funnel -</option>'}</select></label></div>`;
}
function vFootingHtml(d) {
  const f = d.footing;
  if (!f) return '';
  const r = f.releases || {};
  return `<p class="note"><b>Footing:</b> ${f.same && !f.gone
    ? `the rule gives back its own ${Number(f.had).toLocaleString()} survivors today`
    : `<b class="neg">the rule does not give back its own survivors today</b> - ${Number(f.now).toLocaleString()} now, ${Number(f.had).toLocaleString()} on the record, ${Number(f.gone).toLocaleString()} gone`}
    · rule keys ${f.keys.ok ? 'are dials and the two limits' : `<b class="neg">include ${esc(f.keys.bad.join(', '))}</b>`}${f.keys.cut ? ` · a top ${f.keys.cut.n} cut, which each copy takes for itself` : ''}
    · check: ${f.check.kind === 'scrambles' ? `${f.check.copies} scrambled copies, bar ${f.check.bar} of them (${f.check.barPct}%)` : 'the two halves, no scrambled copies'}
    · sealed window ${f.sealed.sealed ? `intact on this unit from ${vDay(f.sealed.fromTs)} onward` : `<b class="neg">not intact</b> - ${esc(String(f.sealed.why || ''))}`}
    · ${f.marks} mark(s) carried · ${f.steps} step(s) and ${f.backSteps} step(s) back
    · ${f.userRuleDiffers === null ? 'no User Rule recorded' : (f.userRuleDiffers ? 'the User Rule differs from the Final Rule' : 'the User Rule is the Final Rule')}
    · releases: set ${esc(r.set || '?')}, parent ${esc(r.parent || '?')}, reader ${esc(r.reader || '?')}${r.sameFirstDigit ? ' (one first digit)' : ' <b class="warn">(the first digits differ)</b>'}</p>`;
}
function vLooksHtml(d) {
  const l = d.looks;
  if (!l) return '';
  return `<p class="note"><b>Looks at the held-back window before any stamp:</b> at least ${Number(l.unstamped).toLocaleString()} unstamped (${l.what.map(esc).join('; ')})${l.stamped ? ` · ${l.stamped} stamped read(s) below` : ' · none stamped yet'}${l.rides ? ` · ${l.rides} ride(s) worked out below, each a stamped look` : ''}${d.heldBackReadAt ? ` · first stamped look ${esc(String(d.heldBackReadAt).slice(0, 16))}` : ''}</p>`;
}
function vPressHtml(d) {
  const r = d.rules || {};
  return `<div class="row" style="margin-top:.4rem;align-items:flex-end">
    <label class="f" title="the share of the scrambled copies the survivors' held-back money has to beat. Opens on the share this set was cut under; a change is written onto the verdict as a guessed threshold.">bar share %<input id="vBarPct" type="number" min="1" max="100" value="${Number(r.barPct) || 80}" style="width:5rem"></label>
    <label class="f" title="the share of every scrambled held-back figure on the whole board that must be losing money for the copies to count as noise. A guessed threshold, written onto the verdict.">noise must lose at least %<input id="vSanityPct" type="number" min="0" max="100" value="${Number(r.sanityPct) || 50}" style="width:5rem"></label>
    <button id="vRead" class="pri" ${d.refused ? 'disabled' : ''} title="the one press that opens the held-back window on this screen. Every press appends a block and none is overwritten; the first is the verdict, the rest are later looks.">Read the rule against nothing on the held-back window</button>
    <span id="vReadMsg" class="note">${d.refused ? `<b class="warn">refused:</b> ${esc(d.refused)}` : ''}</span></div>`;
}
function vLinesHtml(b) {
  const a = b.lineA || {};
  const l = b.lineB || {};
  return `<p class="note"><b>Information only, never a pass or fail.</b> Line A, the rule on the test window against its own copies: real ${money(a.real)} beats ${a.beats} of ${a.copies} (${esc(a.why || '')}). Line B, the bound on shopping: the best ${l.n} of ${Number(l.of || 0).toLocaleString()} by test money made ${money(l.real)} and beats ${l.beats} of ${l.copies} scrambled boards' own best ${l.n} (${esc(l.why || '')}).</p>`;
}
function vSurvivorsTableHtml(b) {
  const rows = ((b.survivors || {}).rows) || [];
  if (!rows.length) return '';
  return `<div class="scrollx" style="max-height:24rem;overflow-y:auto"><table><thead><tr>
    <th title="the setting, by the name the board gives it">setting</th>
    <th title="dollars on the held-back window, the once-only look">avg held-back $</th>
    <th title="positions taken on the held-back window">trades</th>
    <th title="its held-back dollars against simply holding the coin over the same days">vs always long $</th>
    <th title="as stored on the record: of its own null copies, raw dollars over every deal, how many its held-back money beat">beat its own null set</th>
    <th title="how many deals the stored figure is over, which may be more than the copies kept">null copies</th>
    <th title="as stored on the record: how far its held-back money sits above the typical copy, over the population spread">lead</th>
    <th title="read here: of the copies kept, how many its held-back money beats by at least a cent, against the same bar as the set">beats N of K</th>
    <th title="this survivor's own reading against its own copies at the same bar. It never picks a survivor and never gates the set.">own verdict</th>
  </tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="${(r.held || 0) >= 0 ? 'pos' : 'neg'}">${money(r.held)}</td><td>${r.trades == null ? '—' : r.trades}</td><td>${money(r.vsLong)}</td><td>${r.storedBeat == null ? '—' : r.storedBeat}</td><td>${r.storedPairs == null ? '—' : r.storedPairs}</td><td>${vFix(r.storedLead)}</td><td>${r.beats} of ${r.copiesKept}</td><td class="${r.pass ? 'pos' : 'neg'}">${r.pass ? 'PASS' : 'FAIL'}</td></tr>`).join('')}</tbody></table></div>
  <p class="note muted">${rows.length} survivors, every one of them, in the set's own order. There is no sort on this table: a sort is a look.</p>`;
}
function vBlockHtml(b, isVerdict) {
  const v = b.verdict || {};
  const h = b.heldBack || {};
  const c = h.comparisons || {};
  const cp = b.copies || {};
  const s = b.survivors || {};
  const sn = b.sanity || {};
  const r = b.rules || {};
  const tags = r.tags || {};
  return `<div class="panel" style="margin-top:.5rem">
    <h4 style="margin:0 0 .3rem">${isVerdict ? 'The verdict' : `look ${b.look}`} - <b class="${v.pass ? 'pos' : 'neg'}">${v.pass ? 'PASS' : 'FAIL'}</b> <span class="muted">stamped ${esc(String(b.at || '').slice(0, 16))} under release ${esc(b.release || '?')}</span></h4>
    <p class="note">${esc(v.sentence || '')}</p>
    <p class="note"><b>Rules declared before the numbers:</b> bar ${r.bar} of ${r.copies} copies (${r.barPct}%, ${esc(tags.bar || '')}${r.barChanged ? `, changed from the set's own ${r.ownBarPct}%` : ''}); noise must lose at least ${r.sanityPct}% (${esc(tags.sanity || '')}); comparisons gated: buying the coin and going away, shorting it and going away (${esc(tags.comparisons || '')}); being long every period and being short every period are the window's direction and never a gate.</p>
    <p class="note"><b>Held-back read:</b> ${Number(h.of || 0).toLocaleString()} survivors made ${money(h.real)} a setting${h.missing ? ` (${h.missing} with no figure)` : ''}${h.trades == null ? '' : ` · ${vFix(h.trades, 1)} trades a setting`}${h.vsLong == null ? '' : ` · ${money(h.vsLong)} against always long`} · ${c.known
    ? `buying the coin and going away ${money((c.buyHold || {}).hi)} ${c.beatsBuyHold ? 'beaten' : '<b class="neg">not beaten</b>'} · shorting it and going away ${money((c.shortHold || {}).hi)} ${c.beatsShortHold ? 'beaten' : '<b class="neg">not beaten</b>'} · being long every period ${money((c.alwaysLong || {}).hi)} · being short every period ${money((c.alwaysShort || {}).hi)}`
    : `<b class="warn">the four comparisons are not known</b> - ${esc(String(c.why || ''))} - INCOMPLETE, never a pass`} · ${h.pass ? '<b class="pos">stands</b>' : '<b class="neg">does not stand</b>'}</p>
    <p class="note"><b>The rule on a noise board, held-back window:</b> ${cp.incomplete
    ? '<b class="warn">this set kept no scrambled copies, so nothing was read against nothing</b>'
    : `real ${money(cp.real)} beats ${cp.beats} of ${cp.copies} copies, the bar being ${cp.bar} - <b class="${cp.pass ? 'pos' : 'neg'}">${cp.pass ? 'PASS' : 'FAIL'}</b> · a forecast-free rule clears this about ${vPct(cp.chance)} of the time; the finest claim ${cp.copies} copies allow is 1 in ${Number(cp.copies) + 1}, a floor, never a measure of strength · lead ${vFix(cp.lead)} (${esc(cp.leadDefinition || '')})${cp.survivorsWithNoFigure ? ` · ${cp.survivorsWithNoFigure} survivor(s) with no figure on any copy, counted` : ''}${cp.copiesShortOfSurvivors ? ` · ${cp.copiesShortOfSurvivors} copy or copies short of survivors` : ''}`}</p>
    <p class="note"><b>Every survivor against its own copies:</b> ${s.passing} of ${s.survivors} clear the same bar, about ${s.byChance == null ? '?' : Number(s.byChance).toFixed(1)} would by chance · ${s.positive} made money · ${s.beatsAlwaysLong} beat always long · head-to-heads won ${vPct(s.headToHeadsWon)} over ${s.dealsOver == null ? '?' : s.dealsOver} deal(s) a setting, ${s.kept} copies kept · median lead ${vFix(s.medianLead)} read here, ${vFix(s.medianStoredLead)} as stored${s.moneyByThird ? ` · money by third: ${s.moneyByThird.positive.join(' / ')} of ${s.moneyByThird.of} in the money` : ''} · ${esc(s.notIndependent || '')}, so this is never a gate</p>
    <p class="note">sanity: ${sn.known ? `${vPct((sn.board || {}).losing)} of ${Number((sn.board || {}).figures || 0).toLocaleString()} scrambled held-back figures on the whole board lose money (among the survivors ${vPct((sn.survivors || {}).losing)}), threshold ${sn.threshold}% - ${sn.ok
    ? '<b class="pos">PASS — noise mostly loses, as fees demand.</b>'
    : '<b class="neg">FAIL — NOISE IS PROFITING: the simulation is broken; do not read the tests above.</b>'} On a window that pays one direction the copies are paid too, and this can fail honestly.` : '<b class="warn">not known</b> - no scrambled figure to read, so nothing above it can be read against noise.'}</p>
    <p class="note"><b>The other units:</b> ${b.others
    ? `${b.others.positive} of ${b.others.of} other units positive on the held-back window; ${b.others.clearBar} clear the bar${b.others.keepsNothing ? ` · ${b.others.keepsNothing} keep nothing` : ''}${b.others.mark ? ` · <b class="warn">${esc(b.others.mark)}</b>` : ''} <span class="muted">(read ${esc(String(b.others.at || '').slice(0, 16))}, information only)</span>`
    : 'not read when this was stamped'}</p>
    ${vLinesHtml(b)}
    <p class="note"><b>What a pass buys:</b> this window only. It stops obvious chance results being frozen; the
      forward paper test after freezing is the real judge.</p>
    ${(b.marks || []).length ? `<p class="note"><b>Marks the walk was carried past:</b> ${b.marks.map((m) => esc(m.what || m.key)).join('; ')}</p>` : ''}
    <p class="note muted">fee ${b.fee && b.fee.feePerLeg != null ? `${(100 * Number(b.fee.feePerLeg)).toFixed(3)}% a leg` : 'not recorded'} · sealed window ${b.windows && b.windows.sealed && b.windows.sealed.intact ? `from ${vDay(b.windows.sealed.fromTs)} onward` : 'not intact'}${b.windows && b.windows.hold ? ` · held-back ${vDay(b.windows.hold.fromTs)} → ${vDay(b.windows.hold.toTs)}` : ''}</p>
    ${isVerdict ? vSurvivorsTableHtml(b) : `<details><summary>the survivors on this look</summary>${vSurvivorsTableHtml(b)}</details>`}
  </div>`;
}
function vSetPanelHtml(list, chosen, d) {
  const blocks = d ? (d.blocks || []).slice().reverse() : [];       // oldest first: the verdict, then later looks
  return `<div class="panel">
    <h3 style="margin-top:0">The verdict on a Stage 4 record set</h3>
    <p class="note">A rule can be checked against scrambled data and a single row cannot, so this reads the set as a
      whole: what its survivors made on the held-back window, against the four simpler things the Funnel prints,
      against the same settings' money on every scrambled copy of their table, with a sanity line that noise must
      lose, and the marks the walk was carried past. Opening this panel reads no held-back number; the press below
      is the stamped look, and every look is counted.</p>
    ${vSetBoxHtml(list, chosen)}
    ${d ? `<p class="note"><b>${esc(d.name)}</b> - ${esc(d.unitName || 'all units together')} · <b>Final Rule:</b> ${esc(d.ruleSentence || '')}${d.userSentence ? ` · <b>User Rule:</b> ${esc(d.userSentence)}` : ''} · ${Number((d.counts || {}).survivors ?? 0).toLocaleString()} survivors${(d.warnings || []).length ? ` · <b class="warn">${d.warnings.map(esc).join('; ')}</b>` : ''}</p>
      ${vFootingHtml(d)}${vLooksHtml(d)}${vPressHtml(d)}
      ${blocks.length ? blocks.map((b, i) => vBlockHtml(b, i === 0)).join('') : '<p class="note">No stamped read on this set yet. The first press writes the verdict; later presses are printed as later looks and never replace it.</p>'}
      ${vOthersHtml(d)}${vRideHtml(d)}` : ''}
  </div>`;
}
// a blank box is sent blank: read as a number it would be 0, and 0 is not a share anyone typed
function vTyped(id) { const v = $(id).value; return v === '' ? '' : Number(v); }
// THE RULE ON THE OTHER UNITS, HELD-BACK WINDOW (V6, 3.88.0): the newest reading
// in full, earlier ones one line each; every press appends and none is overwritten.
function vOthersHtml(d) {
  const list = d.others || [];
  const o = list[0] || null;
  const earlier = list.slice(1);
  return `<div class="panel" style="margin-top:.5rem">
    <h4 style="margin:0 0 .3rem">The rule on the other units, held-back window</h4>
    <p class="note">The same rule on every other coin-and-shape unit of the stage 3 set this was cut from, each read on its
      own held-back window against its own scrambled copies at the bar declared above. Two counts, information only,
      never a gate; a mark when fewer than half are positive. About five seconds a unit, read one at a time.</p>
    <div class="row" style="align-items:flex-end">
      <button id="vOthers" class="pri" ${d.othersRefused ? 'disabled' : ''} title="reads the rule on each other unit's held-back window, one unit at a time, and appends the reading to the set. Never a pass or fail on the set.">Read the rule on the other units' held-back windows</button>
      <span id="vOthersMsg" class="note">${d.othersRefused ? `<b class="warn">refused:</b> ${esc(d.othersRefused)}` : ''}</span></div>
    ${o ? `<p class="note"><b>${o.positive} of ${o.of} other units positive; ${o.clearBar} clear the bar</b>${o.keepsNothing ? ` · ${o.keepsNothing} keep nothing` : ''}${o.mark ? ` · <b class="warn">${esc(o.mark)}</b>` : ''} <span class="muted">read ${esc(String(o.at || '').slice(0, 16))} under release ${esc(o.release || '?')} · bar ${(o.rules || {}).barPct}% (${esc(((o.rules || {}).tags || {}).bar || '')})</span></p>
      <div class="scrollx" style="max-height:20rem;overflow-y:auto"><table><thead><tr>
        <th title="one of the other coin-and-shape units of the stage 3 set. The set's rule was applied to that unit's own board.">unit</th>
        <th title="how many of that unit's settings the rule keeps, out of all it has">survivors</th>
        <th title="the mean held-back money of the settings the rule keeps there">avg held-back $</th>
        <th title="of that unit's scrambled copies, how many the real figure beats by at least a cent, against the bar declared above resolved for that unit's copy count">beats N of K</th>
        <th title="positive and beating at least the bar of its copies; never a gate on the set">clears the bar</th>
        <th title="the real figure minus the copies' mean, over the copies' sample spread">lead</th>
      </tr></thead><tbody>${(o.units || []).map((u) => `<tr><td>${esc(u.name || u.unit)}</td><td>${u.survivors} of ${Number(u.of || 0).toLocaleString()}</td><td class="${u.keepsNothing ? '' : ((u.real || 0) >= 0 ? 'pos' : 'neg')}">${u.keepsNothing ? 'keeps nothing' : money(u.real)}</td><td>${u.keepsNothing ? '—' : (u.copies ? `${u.beats} of ${u.copies} (bar ${u.bar})` : 'no copies')}</td><td class="${u.keepsNothing || !u.copies ? '' : (u.clears ? 'pos' : 'neg')}">${u.keepsNothing ? '—' : (u.copies ? (u.clears ? 'yes' : 'no') : 'no copies to read against')}</td><td>${u.keepsNothing ? '—' : vFix(u.lead)}</td></tr>`).join('')}</tbody></table></div>
      ${earlier.length ? `<p class="note muted">earlier readings: ${earlier.map((e) => `${esc(String(e.at || '').slice(0, 16))} at bar ${(e.rules || {}).barPct}%: ${e.positive} of ${e.of} positive, ${e.clearBar} clear the bar`).join('; ')}</p>` : ''}`
    : '<p class="note">Not read on this set yet.</p>'}
  </div>`;
}
// THE RIDE ON THE HELD-BACK WINDOW (V7, 3.88.0): per survivor, the held-back half
// beside the test half, stamped with the release that computed it.
function vRideHtml(d) {
  const list = d.ride || [];
  const r = list[0] || null;
  const earlier = list.slice(1);
  const thirds = (h) => (h && Array.isArray(h.pnlThirds) && h.pnlThirds.length ? h.pnlThirds.map((v) => money(v)).join(' / ') : '—');
  return `<div class="panel" style="margin-top:.5rem">
    <h4 style="margin:0 0 .3rem">The ride on the held-back window</h4>
    <p class="note">What the held-back window looked like from inside, per survivor: the largest drawdown, the worst
      and best single trade, trades won, stopped out, gross per trade and money by third, beside the same numbers
      on the test window. Worked out by the same pass as the missing numbers on the Funnel, on this unit only;
      minutes. Information only, never a gate, and every press is a stamped look at the held-back window.</p>
    <div class="row" style="align-items:flex-end">
      <button id="vRide" class="pri" ${d.rideRefused ? 'disabled' : ''} title="prices this set's survivors on this unit again and keeps the held-back half of what the pricing works out, beside the test half, with the release that computed it. A stamped look; never a pass or fail.">Work out the held-back ride</button>
      <span id="vRideMsg" class="note">${d.rideRefused ? `<b class="warn">refused:</b> ${esc(d.rideRefused)}` : ''}</span></div>
    ${r ? `<p class="note"><span class="muted">worked out ${esc(String(r.at || '').slice(0, 16))} under release ${esc(r.release || '?')}</span> · ${(r.rows || []).length} of ${r.settings} survivors${(r.missing || []).length ? ` · <b class="warn">${r.missing.length} not priced</b>` : ''}${(r.failures || []).length ? ` · <b class="warn">${r.failures.length} unit failure(s)</b>` : ''}</p>
      <div class="scrollx" style="max-height:24rem;overflow-y:auto"><table><thead><tr>
        <th title="the setting, by the name the board gives it">setting</th>
        <th title="dollars on the held-back window, as priced by this pass">held-back $</th>
        <th title="positions taken on the held-back window">trades</th>
        <th title="the deepest fall from a high point of the running money on the held-back window, in dollars">largest drawdown $</th>
        <th title="the single worst trade on the held-back window">worst trade $</th>
        <th title="the single best trade on the held-back window">best trade $</th>
        <th title="trades that closed with a gain on the held-back window">trades won</th>
        <th title="trades closed by the stop on the held-back window">stopped out</th>
        <th title="money per trade before fees on the held-back window">gross per trade $</th>
        <th title="the held-back window's money in three equal parts, first to last">money by third</th>
        <th title="the same setting's dollars on the test window, from the same pass">test $</th>
        <th title="the deepest fall on the test window, for scale">test largest drawdown $</th>
      </tr></thead><tbody>${(r.rows || []).map((x) => { const h = x.hold || {}; const t = x.test || {}; return `<tr><td>${esc(x.label)}</td><td class="${(h.money || 0) >= 0 ? 'pos' : 'neg'}">${money(h.money)}</td><td>${h.trades == null ? '—' : h.trades}</td><td>${money(h.maxDrawdown)}</td><td>${money(h.worstTrade)}</td><td>${money(h.bestTrade)}</td><td>${h.wins == null ? '—' : h.wins}</td><td>${h.stops == null ? '—' : h.stops}</td><td>${money(h.grossPerTrade)}</td><td>${thirds(h)}</td><td class="${(t.money || 0) >= 0 ? 'pos' : 'neg'}">${money(t.money)}</td><td>${money(t.maxDrawdown)}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="note muted">${(r.rows || []).length} survivors, in the set's own order. There is no sort on this table: a sort is a look.</p>
      ${earlier.length ? `<p class="note muted">earlier rides: ${earlier.map((e) => `${esc(String(e.at || '').slice(0, 16))} under release ${esc(e.release || '?')}`).join('; ')}</p>` : ''}`
    : '<p class="note">Not worked out on this set yet.</p>'}
  </div>`;
}
async function drawVerify() {
  // a half-life set stands on its source's verdict and is read there, so it is not offered here (3.95.0)
  const sets = ((await apiOr('api/funnel/sets', ({ sets: [] }))).sets || []).filter((x) => !x.derived);
  const chosen = vRememberedSet(sets);
  const d = chosen ? await apiOr(`api/funnel/set/${encodeURIComponent(chosen)}/verify`, null) : null;
  $('#view').innerHTML = vSetPanelHtml(sets, chosen, d);
  const sel = $('#vSet');
  if (sel) sel.onchange = () => {
    try { localStorage.setItem(V_SET_KEY, sel.value); } catch (_) { /* private window */ }
    drawVerify();
  };
  const btn = $('#vRead');
  if (btn && chosen && d && !d.refused) btn.onclick = async () => {
    btn.disabled = true;
    $('#vReadMsg').textContent = 'reading…';
    const body = { barPct: vTyped('#vBarPct'), sanityPct: vTyped('#vSanityPct') };
    const started = await tryPost(`api/funnel/set/${encodeURIComponent(chosen)}/verify`, body, WHERE_VERIFY);
    if (!started) { btn.disabled = false; $('#vReadMsg').textContent = ''; return; }
    vFollow(chosen, started.token);
  };
  const ob = $('#vOthers');
  if (ob && chosen && d && !d.othersRefused) ob.onclick = async () => {
    ob.disabled = true;
    $('#vOthersMsg').textContent = 'reading…';
    // the same bar the verdict is read under: the set's own share, or the typed one
    const started = await tryPost(`api/funnel/set/${encodeURIComponent(chosen)}/others`, { barPct: vTyped('#vBarPct') }, WHERE_VERIFY);
    if (!started) { ob.disabled = false; $('#vOthersMsg').textContent = ''; return; }
    vOthersFollow(chosen, started.token);
  };
  const rb = $('#vRide');
  if (rb && chosen && d && !d.rideRefused) rb.onclick = async () => {
    if (!confirm('Work out the held-back ride?\n\nPrices this set\'s survivors on this unit again and keeps the held-back half beside the test half. Minutes. It is a stamped look at the held-back window, counted on every later verdict.')) return;
    rb.disabled = true;
    $('#vRideMsg').textContent = 'starting…';
    const started = await tryPost(`api/funnel/set/${encodeURIComponent(chosen)}/ride`, {}, WHERE_VERIFY);
    if (!started) { rb.disabled = false; $('#vRideMsg').textContent = ''; return; }
    vRideFollow(chosen, started.token);
  };
  // a read or a ride already going for this set is followed, so a reload mid-way keeps saying so
  if (d && d.othersRunning && ob) { ob.disabled = true; vOthersFollow(chosen, d.othersRunning.token); }
  if (d && d.rideRunning && rb) { rb.disabled = true; vRideFollow(chosen, d.rideRunning.token); }
}
// THE READ IS STARTED AND POLLED, the shape every press on the Funnel has, so no
// one request is held open; the page redraws from the record when it lands.
async function vFollow(id, token) {
  for (;;) {
    let s = null;
    try { s = await api(`api/funnel/set/${encodeURIComponent(id)}/verify/status`); } catch (_) { s = null; }
    if (!s || s.none || s.token !== token) { drawVerify(); return; }
    if (s.error) {
      const m = $('#vReadMsg'); if (m) m.textContent = s.error;
      const b = $('#vRead'); if (b) b.disabled = false;
      return;
    }
    if (s.result) { drawVerify(); return; }
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    if (tab !== 'verify') return;
  }
}

// the other units are read one at a time and the count is said while they are
async function vOthersFollow(id, token) {
  for (;;) {
    let s = null;
    try { s = await api(`api/funnel/set/${encodeURIComponent(id)}/others/status`); } catch (_) { s = null; }
    if (!s || s.none || s.token !== token) { drawVerify(); return; }
    if (s.error) {
      const m = $('#vOthersMsg'); if (m) m.textContent = s.error;
      const b = $('#vOthers'); if (b) b.disabled = false;
      return;
    }
    if (s.result) { drawVerify(); return; }
    const m = $('#vOthersMsg'); if (m) m.textContent = `read ${s.done} of ${s.of}`;
    await new Promise((resolve) => { setTimeout(resolve, 2000); });
    if (tab !== 'verify') return;
  }
}
// the ride prices, so the count is said with the box's load beside it
async function vRideFollow(id, token) {
  for (;;) {
    let s = null;
    try { s = await api(`api/funnel/set/${encodeURIComponent(id)}/ride/status`); } catch (_) { s = null; }
    if (!s || s.none || s.token !== token) { drawVerify(); return; }
    if (s.error) {
      const m = $('#vRideMsg'); if (m) m.textContent = s.error;
      const b = $('#vRide'); if (b) b.disabled = false;
      return;
    }
    if (s.result) { drawVerify(); return; }
    const m = $('#vRideMsg'); if (m) m.textContent = `worked out ${s.done} of ${s.of}${s.cpu != null ? ` · box ${Math.round(Number(s.cpu))}% busy` : ''}`;
    await new Promise((resolve) => { setTimeout(resolve, 2000); });
    if (tab !== 'verify') return;
  }
}

// ---- History (History Tuning + HT v2 age dial) ---------------------------------
// THE RESERVE GRADE ON A STAGE 4 RECORD SET (3.89.0): the unread window -- the
// sealed 13% nothing trained or searched on, from where the seal began to
// whatever the box holds today -- priced for the set's survivors on the set's
// own unit, forecast by the members' saved models, and read by the verdict's
// four rules on that window. Every grade is a counted look; the first look is
// at data nothing has seen and every later one says so.
const H_SET_KEY = 'cx-history-set';
// THREE SMALL FORMATTERS OF THIS SCREEN'S OWN, written with braces on purpose:
// the word list's walk brace-matches a helper's body from where it is defined,
// and a brace-less one-liner defined just above another screen's renderer reads
// as that renderer's body, dragging that screen's controls onto this list.
function hDay(ts) { return ts == null ? '?' : new Date(Number(ts)).toISOString().slice(0, 10); }
function hFix(v, n = 2) { return v == null || !Number.isFinite(Number(v)) ? 'none' : Number(v).toFixed(n); }
function hPct(v) { return v == null || !Number.isFinite(Number(v)) ? '?' : `${Math.round(100 * Number(v))}%`; }
function hRememberedSet(list) {
  let want = null;
  try { want = localStorage.getItem(H_SET_KEY); } catch (_) { want = null; }
  if (want && list.some((x) => x.id === want)) return want;
  return list.length ? list[0].id : null;
}
function hSetBoxHtml(list, chosen) {
  return `<div class="row" style="align-items:flex-end">
    <label class="f" title="which Stage 4 record set to grade, from every set on this box, newest first">Stage 4 record set<select id="hSet">${list.length
    ? list.map((x) => `<option value="${esc(x.id)}" ${x.id === chosen ? 'selected' : ''}>${esc(x.name)} · ${esc(x.unitName || 'all units together')} · ${Number((x.counts || {}).survivors ?? 0).toLocaleString()} survivors${x.verify ? ` · verdict ${x.verify.pass ? 'PASS' : 'FAIL'}` : ' · no verdict'}</option>`).join('')
    : '<option value="">no Stage 4 record set on this box yet</option>'}</select></label></div>`;
}
function hGradeBlockHtml(g, isFirst) {
  const v = g.verdict || {};
  const r = g.read || {};
  const c = r.comparisons || {};
  const cp = g.copies || {};
  const sv = g.survivors || {};
  const sn = g.sanity || {};
  const w = g.window || {};
  const rows = g.rows || [];
  return `<div class="panel" style="margin-top:.5rem">
    <h4 style="margin:0 0 .3rem">look ${g.look}${isFirst ? ' - the first look' : ''} - <b class="${v.pass ? 'pos' : 'neg'}">${v.pass ? 'PASS' : 'FAIL'}</b> <span class="muted">graded ${esc(String(g.at || '').slice(0, 16))} under release ${esc(g.release || '?')}</span></h4>
    <p class="note">${esc(v.sentence || '')}</p>
    <p class="note"><b>The unread window:</b> from ${hDay(w.fromTs)} to ${hDay(w.toTs)}, ${w.chunks ?? 0} whole chunks · the box's data reached ${hDay(w.seenToTs)} · verdict ${esc((g.gate || {}).id || '?')} stood</p>
    <p class="note"><b>The read:</b> ${Number(r.of || 0).toLocaleString()} survivors made ${money(r.real)} a setting${r.trades == null ? '' : ` · ${hFix(r.trades, 1)} trades a setting`} · ${c.known
    ? `buying the coin and going away ${money((c.buyHold || {}).hi)} ${c.beatsBuyHold ? 'beaten' : '<b class="neg">not beaten</b>'} · shorting it and going away ${money((c.shortHold || {}).hi)} ${c.beatsShortHold ? 'beaten' : '<b class="neg">not beaten</b>'} · being long every period ${money((c.alwaysLong || {}).hi)} · being short every period ${money((c.alwaysShort || {}).hi)}`
    : `<b class="warn">the four comparisons are not known</b> - ${esc(String(c.why || ''))}`} · ${r.pass ? '<b class="pos">stands</b>' : '<b class="neg">does not stand</b>'}</p>
    <p class="note"><b>Against scrambled copies of that window:</b> ${cp.incomplete ? '<b class="warn">none were priced</b>' : `real ${money(cp.real)} beats ${cp.beats} of ${cp.copies}, the bar being ${cp.bar} - <b class="${cp.pass ? 'pos' : 'neg'}">${cp.pass ? 'PASS' : 'FAIL'}</b> · a forecast-free rule clears this about ${hPct(cp.chance)} of the time · lead ${hFix(cp.lead)}`}</p>
    <p class="note"><b>Every survivor against its own copies:</b> ${sv.passing} of ${sv.survivors} clear the same bar, about ${sv.byChance == null ? '?' : Number(sv.byChance).toFixed(1)} would by chance · ${sv.positive} made money · never a gate</p>
    <p class="note">sanity, over the survivors' copies only: ${sn.known ? `${hPct((sn.board || {}).losing)} of ${Number((sn.board || {}).figures || 0).toLocaleString()} scrambled unread figures lose money, threshold ${sn.threshold}% - ${sn.ok ? '<b class="pos">PASS</b>' : '<b class="neg">FAIL - NOISE IS PROFITING: do not read the lines above</b>'}` : '<b class="warn">not known</b>'}</p>
    ${(g.missing || []).length ? `<p class="note"><b class="warn">${g.missing.length} survivor(s) were not priced</b> - they are not in the stage 3 set's block on this unit</p>` : ''}
    ${rows.length ? `<details><summary>the survivors on this look</summary><div class="scrollx" style="max-height:24rem;overflow-y:auto"><table><thead><tr>
      <th title="the setting, by the name the board gives it">setting</th>
      <th title="dollars on the unread window">unread $</th>
      <th title="positions taken on the unread window">trades</th>
      <th title="trades closed by the stop on the unread window">stopped out</th>
      <th title="its unread dollars against simply holding the coin over the same days">vs always long $</th>
      <th title="the deepest fall from a high point of the running money on the unread window">largest drawdown $</th>
      <th title="the single worst trade on the unread window">worst trade $</th>
    </tr></thead><tbody>${rows.map((x) => `<tr><td>${esc(x.label)}</td><td class="${(x.money || 0) >= 0 ? 'pos' : 'neg'}">${money(x.money)}</td><td>${x.trades == null ? '—' : x.trades}</td><td>${x.stops == null ? '—' : x.stops}</td><td>${money(x.vsLong)}</td><td>${money((x.ride || {}).maxDrawdown)}</td><td>${money((x.ride || {}).worstTrade)}</td></tr>`).join('')}</tbody></table></div>
      <p class="note muted">${rows.length} survivors, in the set's own order. There is no sort on this table: a sort is a look.</p></details>` : ''}
  </div>`;
}
function hGradePanelHtml(list, chosen, d) {
  const grades = d ? (d.grades || []).slice().reverse() : [];       // oldest first: the first look, then later ones
  const sealed = d ? d.sealed || {} : {};
  return `<div class="panel">
    <h3 style="margin-top:0">The reserve grade on a Stage 4 record set</h3>
    <p class="note">The unread window is the sealed 13% no part of the search touched: it was cut away before anything
      trained, and it runs from where the seal began to whatever the box holds today. This prices the set's survivors
      on it, on the set's own coin and shape, with the members forecasting it from the models they were trained as,
      and reads the result by the same four rules as the verdict on Verify: money, the two comparisons a rule has to
      beat, the scrambled copies at the set's own bar, and noise losing. It refuses without a verdict that passed
      under this release line. Every grade is a counted look, and only the first is at data nothing has seen.</p>
    ${hSetBoxHtml(list, chosen)}
    ${d ? `<p class="note"><b>${esc(d.name)}</b> - ${esc(d.unitName || 'all units together')} · ${esc(d.ruleSentence || '')} · ${Number(d.survivors || 0).toLocaleString()} survivors
      · verdict ${d.gate ? `<b class="pos">${esc(d.gate.id)} stood (PASS, release ${esc(d.gate.release || '?')})</b>` : `<b class="neg">none stood</b> (${d.verdicts} stamped)`}
      · sealed window ${sealed.intact ? `intact on this unit from ${hDay(sealed.fromTs)} onward, ${sealed.chunks ?? '?'} chunks at the seal` : `<b class="neg">not intact</b> - ${esc(String(sealed.why || ''))}`}
      · ${d.looks ? `<b>this window has been read ${d.looks} time(s) already</b>` : 'this window has never been read'}</p>
      <div class="row" style="align-items:flex-end">
        <button id="hGrade" class="pri" ${d.refused ? 'disabled' : ''} title="prices the set's survivors on the unread window and stamps the grade on the set. The first press is the only look at data nothing has seen; every press is counted.">Run the reserve grade on this set${d.looks ? ` - look ${d.looks + 1}` : ''}</button>
        <span id="hGradeMsg" class="note">${d.refused ? `<b class="warn">refused:</b> ${esc(d.refused)}` : ''}</span></div>
      ${grades.length ? grades.map((g, i) => hGradeBlockHtml(g, i === 0)).join('') : '<p class="note">No grade on this set yet. The first press is the first look at the unread window.</p>'}` : ''}
  </div>`;
}
// the grade prices on the box, so the count is said with the box's load beside it
async function hGradeFollow(id, token) {
  for (;;) {
    let s = null;
    try { s = await api(`api/funnel/set/${encodeURIComponent(id)}/unread/status`); } catch (_) { s = null; }
    if (!s || s.none || s.token !== token) { drawHistory(); return; }
    if (s.error) {
      const m = $('#hGradeMsg'); if (m) m.textContent = s.error;
      const b = $('#hGrade'); if (b) b.disabled = false;
      return;
    }
    if (s.result) { drawHistory(); return; }
    const m = $('#hGradeMsg'); if (m) m.textContent = `pricing the unread window${s.cpu != null ? ` · box ${Math.round(Number(s.cpu))}% busy` : ''}`;
    await new Promise((resolve) => { setTimeout(resolve, 2000); });
    if (tab !== 'history') return;
  }
}
// ---- THE HALF-LIFE RUN ON HISTORY (3.94.0, AGEDIAL-DESIGN.md) -------------------
//
// The same records retrained with recent history weighted more, once per
// ticked half-life, priced beside the unweighted column on the stretch the
// retraining never touched. Drawn under the reserve grade, for the set chosen
// in its box. Helpers written with braces on purpose (see above).
const H_HL_KEY = 'cx-history-halflives';
const H_HALF_LIVES = [12, 18, 24, 30, 36, 48];
function hRememberedHalfLives() {
  try {
    const raw = JSON.parse(localStorage.getItem(H_HL_KEY) || 'null');
    if (Array.isArray(raw)) return H_HALF_LIVES.filter((m) => raw.includes(m));
  } catch (_) { /* private window, or nothing saved */ }
  return H_HALF_LIVES.slice();
}
function hMonthsWord(key) { return key === 'none' ? 'unweighted' : `${String(key).slice(1)} months`; }
function hHalfLifeBlockHtml(b, isFirst) {
  const cols = b.columns || [];
  const w = b.window || {};
  const rows = b.rows || [];
  const green = 'background:rgba(40,170,80,.28)';
  const colHead = cols.map((c) => `<th title="${c.key === 'none' ? `the set's own forecasts, unweighted and not retrained, on the ${esc(b.judgeWord)} window` : `the records priced again with forecasts retrained on the first ${b.shares.train}% of history with a ${c.months}-month half-life, on the ${esc(b.judgeWord)} window`}">${esc(hMonthsWord(c.key))} $</th>`).join('');
  return `<div class="panel" style="margin-top:.5rem">
    <h4 style="margin:0 0 .3rem">look ${b.look}${isFirst ? ' - the first' : ''} <span class="muted">taken ${esc(String(b.at || '').slice(0, 16))} under release ${esc(b.release || '?')}</span></h4>
    <p class="note">judged on the <b>${esc(b.judgeWord)}</b> window${w.fromTs != null ? ` from ${hDay(w.fromTs)} to ${hDay(w.toTs)}` : ''}, ${w.chunks ?? '?'} whole chunks${w.seenToTs != null ? ` · the box's data reached ${hDay(w.seenToTs)}` : ''} · retrained on the first ${b.shares.train}% of history, tested on the next ${b.shares.test}% · ${b.members} members, both kinds · verdict ${esc((b.gate || {}).id || '?')} stood</p>
    <p class="note">${cols.filter((c) => c.key !== 'none').map((c) => `<b>${esc(hMonthsWord(c.key))}</b>: ${c.refused ? `<b class="warn">refused</b> - ${esc(c.refused)}` : `${hFix(c.effectiveDays, 0)} effective training days of ${b.counts.train ?? '?'}${c.weighedByMoney ? ', weighed by money' : ''}`}`).join(' · ')}</p>
    ${(b.missing || []).length ? `<p class="note"><b class="warn">${b.missing.length} survivor(s) are not in the stage 3 set's block on this unit</b></p>` : ''}
    <div class="scrollx" style="max-height:28rem;overflow-y:auto"><table><thead><tr><th title="the setting, by the name the board gives it">setting</th>${colHead}</tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.label)}</td>${cols.map((c) => { const v = (r.money || {})[c.key]; const best = r.best === c.key; return `<td class="${(v || 0) >= 0 ? 'pos' : 'neg'}" style="${best ? green : ''}" title="${best ? 'the best of this row' : ''}">${v == null ? '—' : money(v)}</td>`; }).join('')}</tr>`).join('')}
    </tbody><tfoot>
      <tr><td><b>rows won</b></td>${cols.map((c) => `<td><b>${(b.wins || {})[c.key] ?? 0}</b> of ${rows.length}</td>`).join('')}</tr>
      <tr><td><b>average $</b></td>${cols.map((c) => { const v = (b.averages || {})[c.key]; return `<td class="${(v || 0) >= 0 ? 'pos' : 'neg'}">${v == null ? '—' : money(v)}</td>`; }).join('')}</tr>
    </tfoot></table></div>
    <p class="note muted">${rows.length} records, in the set's own order. Green is the best of the row: a half-life wins only by at least a cent over the unweighted column; a tie goes to the unweighted side.</p>
  </div>`;
}
// THE 4.h SET FROM THIS TABLE (3.95.0): the rows a half-life won, each carrying its half-life; named by the owner
function hHlBuildRowHtml(run, built) {
  const wins = run.wins || {};
  const improved = Object.entries(wins).filter(([k, v]) => k !== 'none' && v > 0).reduce((a, [, v]) => a + v, 0);
  const mine = (built || []).filter((b) => b.run === run.id);
  return `<div class="row" style="margin-top:.4rem;align-items:flex-end">
    <label class="f" style="flex:1" title="what you want to see on Tune and Greenlight for the set built from this table">name<input id="hHlName" style="width:100%" placeholder="e.g. XRP daily, half-life set"></label>
    <button id="hHlBuild" class="pri" ${improved ? '' : 'disabled title="no record improved with any half-life on this table"'} title="builds a record set from every row a half-life won on this table, each record carrying the half-life that won on it; rows the unweighted column won are left out. It stands on this set's verdict and appears on Tune and Greenlight.">Build the half-life set from this table</button>
    <span class="note">${improved} of ${(run.rows || []).length} records improved with a half-life${mine.length ? ` · built from this table: ${mine.map((b) => `<b>${esc(b.name)}</b> (${b.survivors} records)`).join(', ')}` : ''}</span>
  </div>`;
}
function hHalfLifePanelHtml(chosen, d) {
  const runs = d ? (d.runs || []).slice().reverse() : [];
  const ticked = hRememberedHalfLives();
  const lay = d && d.layout ? d.layout : null;
  return `<div class="panel">
    <h3 style="margin-top:0">Retrain with recent history weighted</h3>
    <p class="note">The same records, retrained: every setting of the set chosen above is kept exactly as it is, and only the
      forecasts behind it are trained again with recent history weighted more, once per half-life ticked, keeping every other
      training choice the set was made with. Then the same records are priced again on the stretch the retraining never
      touched, in one pass beside the set's own unweighted figures. A set built 61/13/13/13 retrains on the first 72% of
      history and tests on the next 15%, and is judged on the Reserve; a set built 70/15/15 retrains on its 70% and tests on
      its 15%, and is judged on the Held window. Every press is a counted look.</p>
    ${d ? `<p class="note"><b>${esc(d.name)}</b> - ${esc(d.unitName || 'all units together')} · ${Number(d.survivors || 0).toLocaleString()} survivors
      · verdict ${d.gate ? `<b class="pos">${esc(d.gate.id)} stood (PASS, release ${esc(d.gate.release || '?')})</b>` : `<b class="neg">none stood</b> (${d.verdicts} stamped)`}
      · ${lay ? `built ${lay.judge === 'reserve' ? '61/13/13/13' : '70/15/15'}: retrains on the first ${lay.train}%, tests on the next ${lay.test}%, judged on the <b>${esc(lay.judgeWord)}</b> (${lay.untouched}%)` : `<b class="warn">${esc(d.layoutWhy || 'no layout')}</b>`}
      · ${d.looks ? `run ${d.looks} time(s) so far` : 'not run yet'}</p>
      <div class="row" style="align-items:flex-end">
        <span class="note" title="which half-lives to retrain at. A half-life is how long ago a training day must be to count half as much as today's; each ticked value is a full retraining of both kinds of forecast and one column of the table.">half-lives</span>
        <label class="f" style="flex:none"><input type="checkbox" id="hHl12" ${ticked.includes(12) ? 'checked' : ''}> 12 months</label>
        <label class="f" style="flex:none"><input type="checkbox" id="hHl18" ${ticked.includes(18) ? 'checked' : ''}> 18 months</label>
        <label class="f" style="flex:none"><input type="checkbox" id="hHl24" ${ticked.includes(24) ? 'checked' : ''}> 24 months</label>
        <label class="f" style="flex:none"><input type="checkbox" id="hHl30" ${ticked.includes(30) ? 'checked' : ''}> 30 months</label>
        <label class="f" style="flex:none"><input type="checkbox" id="hHl36" ${ticked.includes(36) ? 'checked' : ''}> 36 months</label>
        <label class="f" style="flex:none"><input type="checkbox" id="hHl48" ${ticked.includes(48) ? 'checked' : ''}> 48 months</label>
      </div>
      <div class="row" style="margin-top:.4rem;align-items:flex-end">
        <button id="hHalfLife" class="pri" ${d.refused ? 'disabled' : ''} title="retrains the set's forecasts once per ticked half-life and prices the same records again beside the unweighted figures, on the window the retraining never touched. Minutes. Every press is a counted look and appends a table; none is overwritten.">Retrain at the ticked half-lives${d.looks ? ` - look ${d.looks + 1}` : ''}</button>
        <span id="hHalfLifeMsg" class="note">${d.refused ? `<b class="warn">refused:</b> ${esc(d.refused)}` : ''}</span></div>
      ${runs.length ? runs.map((b, i) => `${hHalfLifeBlockHtml(b, i === 0)}${i === runs.length - 1 ? hHlBuildRowHtml(b, d.built) : ''}`).join('') : '<p class="note">No half-life run on this set yet.</p>'}` : ''}
  </div>`;
}
async function hHalfLifeFollow(id, token) {
  for (;;) {
    let s = null;
    try { s = await api(`api/funnel/set/${encodeURIComponent(id)}/halflife/status`); } catch (_) { s = null; }
    if (!s || s.none || s.token !== token) { drawHistory(); return; }
    if (s.error) {
      const m = $('#hHalfLifeMsg'); if (m) m.textContent = s.error;
      const b = $('#hHalfLife'); if (b) b.disabled = false;
      return;
    }
    if (s.result) { drawHistory(); return; }
    const m = $('#hHalfLifeMsg'); if (m) m.textContent = `retraining and pricing · ${s.done} of ${s.of} step(s)${s.cpu != null ? ` · box ${Math.round(Number(s.cpu))}% busy` : ''}`;
    await new Promise((resolve) => { setTimeout(resolve, 3000); });
    if (tab !== 'history') return;
  }
}
async function drawHistory() {
  // a half-life set is graded and retrained through its source, so it is not offered here (3.95.0)
  const hSets = ((await apiOr('api/funnel/sets', ({ sets: [] }))).sets || []).filter((x) => !x.derived);
  const hChosen = hRememberedSet(hSets);
  const hd = hChosen ? await apiOr(`api/funnel/set/${encodeURIComponent(hChosen)}/unread`, null) : null;
  const hl = hChosen ? await apiOr(`api/funnel/set/${encodeURIComponent(hChosen)}/halflife`, null) : null;
  $('#view').innerHTML = `  ${hGradePanelHtml(hSets, hChosen, hd)}
  ${hHalfLifePanelHtml(hChosen, hl)}`;
  const hSel = $('#hSet');
  if (hSel) hSel.onchange = () => {
    try { localStorage.setItem(H_SET_KEY, hSel.value); } catch (_) { /* private window */ }
    drawHistory();
  };
  const hb = $('#hGrade');
  if (hb && hChosen && hd && !hd.refused) hb.onclick = async () => {
    const look = (hd.looks || 0) + 1;
    const msg = look === 1
      ? 'Run the reserve grade on this set?\n\nThis is the FIRST look at the unread window — data nothing in this system has seen. After it, that is no longer true.'
      : `Run the reserve grade on this set — look ${look}?\n\nThis window has already been read ${look - 1} time(s). The grade will be recorded as look ${look} and its verdict will say so: the floor it prints is the best case, and the real strength is weaker by an amount nothing here can measure.`;
    if (!confirm(msg)) return;
    hb.disabled = true;
    $('#hGradeMsg').textContent = 'starting…';
    const started = await tryPost(`api/funnel/set/${encodeURIComponent(hChosen)}/unread`, {}, 'The Stage 4 record set box on History lists what was graded - pick the set there.');
    if (!started) { hb.disabled = false; $('#hGradeMsg').textContent = ''; return; }
    hGradeFollow(hChosen, started.token);
  };
  if (hd && hd.running && hb) { hb.disabled = true; hGradeFollow(hChosen, hd.running.token); }
  // the half-life run: the ticks are remembered, the press sends them, started and polled
  for (const m of H_HALF_LIVES) {
    const box = $(`#hHl${m}`);
    if (box) box.onchange = () => {
      const on = H_HALF_LIVES.filter((k) => { const el = $(`#hHl${k}`); return el && el.checked; });
      try { localStorage.setItem(H_HL_KEY, JSON.stringify(on)); } catch (_) { /* private window */ }
    };
  }
  const hlb = $('#hHalfLife');
  if (hlb && hChosen && hl && !hl.refused) hlb.onclick = async () => {
    const months = H_HALF_LIVES.filter((k) => { const el = $(`#hHl${k}`); return el && el.checked; });
    if (!months.length) { alert('tick at least one half-life: 12, 18, 24, 30, 36 or 48 months'); return; }
    const look = (hl.looks || 0) + 1;
    if (!confirm(`Retrain ${hl.name} at ${months.join(', ')} month(s)?\n\nEvery ticked half-life is a full retraining of both kinds of forecast, then the same records priced again on the ${hl.layout ? hl.layout.judgeWord : 'untouched'} window beside the unweighted figures. Minutes. This is look ${look}.`)) return;
    hlb.disabled = true;
    $('#hHalfLifeMsg').textContent = 'starting…';
    const started = await tryPost(`api/funnel/set/${encodeURIComponent(hChosen)}/halflife`, { months }, 'The Stage 4 record set box on History lists what was retrained - pick the set there.');
    if (!started) { hlb.disabled = false; $('#hHalfLifeMsg').textContent = ''; return; }
    hHalfLifeFollow(hChosen, started.token);
  };
  if (hl && hl.running && hlb) { hlb.disabled = true; hHalfLifeFollow(hChosen, hl.running.token); }
  const hlBuild = $('#hHlBuild');
  if (hlBuild && hChosen && hl && (hl.runs || []).length) hlBuild.onclick = async () => {
    const name = $('#hHlName').value.trim();
    if (!name) { alert('name the half-life set - something you will recognise on Tune and Greenlight.'); return; }
    const run = hl.runs[0];
    if (!confirm(`Build the half-life set "${name}" from the newest table of ${hl.name}?\n\nEvery row a half-life won, each record carrying its half-life; rows the unweighted column won are left out. It stands on this set's verdict and appears on Tune and Greenlight.`)) return;
    const out = await tryPost(`api/funnel/set/${encodeURIComponent(hChosen)}/halflife/build`, { runId: run.id, name }, 'The Stage 4 record set box on History lists the source set - pick it there.');
    if (out) { alert(`Built: ${out.set.name} - ${out.set.survivors} of ${out.set.of} records, each with its half-life.\n\nIt is on Tune and Greenlight now.`); drawHistory(); }
  };
}

// ---- THE PER-TRADE CAPTURE OF A STAGE 4 RECORD SET, on Tune (3.92.0) ----------
//
// The two scans on this screen take a list of entries and price them
// themselves; a Stage 4 record set holds money per window and never the
// trades. The panel below writes them down for every survivor that enters at
// market with no trailing stop, and the scan target box then offers the set,
// with one survivor and the windows the scan reads beside it. A scan that
// reads the held-back entries is a counted look. Helpers written with braces
// on purpose (see the History formatters above for why).
const TN_SET_KEY = 'cx-tune-set';
const TN_PICK_KEY = 'cx-tune-pick';
const TN_WINDOWS_KEY = 'cx-tune-windows';
const TN_WINDOWS = [['train', 'tnWinTrain', 'training'], ['test', 'tnWinTest', 'test'], ['hold', 'tnWinHold', 'held-back']];
function tnDay(ts) { return ts == null ? '?' : new Date(Number(ts)).toISOString().slice(0, 10); }
function tnWindowWords(list) { return (list || []).map((w) => (TN_WINDOWS.find(([k]) => k === w) || [])[2] || w).join(' + '); }
function tnRememberedSet(list) {
  let want = null;
  try { want = localStorage.getItem(TN_SET_KEY); } catch (_) { want = null; }
  if (want && list.some((x) => x.id === want)) return want;
  return list.length ? list[0].id : null;
}
function tnRememberedPick(cand) {
  let want = null;
  try { want = localStorage.getItem(TN_PICK_KEY); } catch (_) { want = null; }
  if (want && want !== 'depth' && (cand.rows || []).some((r) => r.label === want)) return want;
  return 'depth';
}
function tnRememberedWindows() {
  try {
    const raw = JSON.parse(localStorage.getItem(TN_WINDOWS_KEY) || 'null');
    if (Array.isArray(raw)) return TN_WINDOWS.map(([k]) => k).filter((k) => raw.includes(k));
  } catch (_) { /* private window, or nothing saved */ }
  return ['train', 'test'];
}
function tnSetBoxHtml(list, chosen) {
  return `<div class="row" style="align-items:flex-end">
    <label class="f" title="which Stage 4 record set to capture the trades of, from every set on this box, newest first">Stage 4 record set<select id="tnSet">${list.length
    ? list.map((x) => `<option value="${esc(x.id)}" ${x.id === chosen ? 'selected' : ''}>${esc(x.name)} · ${esc(x.unitName || 'all units together')} · ${Number((x.counts || {}).survivors ?? 0).toLocaleString()} survivors${x.derived ? ` · half-life set from ${esc(x.derived.fromName || x.derived.from)}` : (x.verify ? ` · verdict ${x.verify.pass ? 'PASS' : 'FAIL'}` : ' · no verdict')}</option>`).join('')
    : '<option value="">no Stage 4 record set on this box yet</option>'}</select></label></div>`;
}
function tnCaptureBlockHtml(c) {
  const e = c.entries || {};
  const reads = c.reads || [];
  const w = c.windows || {};
  const span = (x) => (x ? `${tnDay(x.fromTs)} to ${tnDay(x.toTs)}, ${x.chunks ?? '?'} chunks` : 'not recorded');
  return `<div class="panel" style="margin-top:.5rem">
    <h4 style="margin:0 0 .3rem">the capture on record <span class="muted">taken ${esc(String(c.at || '').slice(0, 16))} under release ${esc(c.release || '?')}${Number(c.times) > 1 ? ` · taken ${c.times} times, this is the latest` : ''}</span></h4>
    <p class="note"><b>${c.captured} of ${c.survivors} survivors captured</b> · verdict ${esc((c.gate || {}).id || '?')} stood · ${Number(e.train || 0).toLocaleString()} training entries, ${Number(e.test || 0).toLocaleString()} test entries, ${Number(e.hold || 0).toLocaleString()} held-back entries
      · by depth among the captured: <b>${esc((c.pick || {}).label || 'none')}</b></p>
    <p class="note">training ${span(w.train)} · test ${span(w.test)} · held-back ${span(w.hold)}</p>
    ${(c.notCaptured || []).length ? `<p class="note"><b class="warn">${c.notCaptured.length} survivor(s) not captured:</b> ${c.notCaptured.slice(0, 3).map((x) => `${esc(x.label)} - ${esc(x.why)}`).join(' · ')}${c.notCaptured.length > 3 ? ` · and ${c.notCaptured.length - 3} more` : ''}</p>` : ''}
    ${(c.missing || []).length ? `<p class="note"><b class="warn">${c.missing.length} survivor(s) are not in the stage 3 set's block on this unit</b></p>` : ''}
    <p class="note">${reads.length ? `scans run on this capture: ${reads.length} · <b>the held-back entries have been read ${reads.filter((r) => r && r.look != null).length} time(s)</b>, each a counted look` : 'no scan has read this capture yet'}</p>
    ${reads.length ? `<details><summary>the scans, newest first</summary><div class="scrollx" style="max-height:12rem;overflow-y:auto"><table><thead><tr>
      <th title="when the scan ran">when</th><th title="which scan">scan</th><th title="the survivor it read">survivor</th><th title="the windows it read">windows</th><th title="the look number when the held-back entries were read">look</th>
    </tr></thead><tbody>${reads.map((r) => `<tr><td>${esc(String(r.at || '').slice(0, 16))}</td><td>${r.tool === 'stop' ? 'protective stop' : 'conviction'}</td><td>${esc(r.survivor)}</td><td>${esc(tnWindowWords(r.windows))}</td><td>${r.look == null ? '—' : r.look}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
  </div>`;
}
function tnCapturePanelHtml(list, chosen, d) {
  return `<div class="panel">
    <h3 style="margin-top:0">Per-trade capture of a Stage 4 record set</h3>
    <p class="note">The two scans above take a list of trades and price them themselves; a Stage 4 record set holds money per
      window and never the trades. This writes them down: for every survivor that enters at market with no trailing stop,
      every hour the rule spoke on the training, test and held-back windows, with the side, how many members called that
      side, and the money the simulator made on that one trade. It refuses without a verdict that passed under this release
      line. Once captured, the set appears in the scan target box above, and a scan that reads the held-back entries is a
      counted look at the held-back window.</p>
    ${tnSetBoxHtml(list, chosen)}
    ${d ? `<p class="note"><b>${esc(d.name)}</b> - ${esc(d.unitName || 'all units together')} · ${esc(d.ruleSentence || '')} · ${Number(d.survivors || 0).toLocaleString()} survivors
      · verdict ${d.gate ? `<b class="pos">${esc(d.gate.id)} stood (PASS, release ${esc(d.gate.release || '?')})</b>` : `<b class="neg">none stood</b> (${d.verdicts} stamped)`}
      · ${d.capture ? `captured ${esc(String(d.capture.at || '').slice(0, 10))}` : 'no capture yet'}${d.looks ? ` · <b>the held-back entries have been read ${d.looks} time(s)</b>` : ''}</p>
      <div class="row" style="align-items:flex-end">
        <button id="tnCapture" class="pri" ${d.refused ? 'disabled' : ''} title="writes down every trade of every survivor that enters at market with no trailing stop, on the training, test and held-back windows. A second press replaces the first; the looks already counted stay.">Capture the trades of this set${d.capture ? ' again' : ''}</button>
        <span id="tnCaptureMsg" class="note">${d.refused ? `<b class="warn">refused:</b> ${esc(d.refused)}` : ''}</span></div>
      ${d.capture ? tnCaptureBlockHtml(d.capture) : '<p class="note">No capture on this set yet. The scans above cannot be aimed at it until there is one.</p>'}` : ''}
  </div>`;
}
// the survivor and the windows, drawn under the scan target when a Stage 4 record set is the target
function tnTargetRowHtml(cand, pick, wins) {
  const depth = cand.pick || {};
  const rows = cand.rows || [];
  return `<div class="row" style="margin-bottom:.4rem;align-items:flex-end">
    <label class="f" style="flex:1 1 auto;min-width:0" title="which captured survivor the scans read. By depth is the setting nearest the middle of every range of the rule, among the captured survivors, chosen without looking at money; naming one records it as your pick.">one survivor<select id="tnPick">
      <option value="depth" ${pick === 'depth' ? 'selected' : ''}>by depth - ${esc(depth.label || '?')} (worst distance ${glFix(depth.worst)})</option>
      ${rows.map((r) => `<option value="${esc(r.label)}" ${pick === r.label ? 'selected' : ''}>${esc(r.label)} - ${r.tHours}h${r.halfLife == null ? '' : ` - half-life ${r.halfLife} months`} - ${(r.entries || {}).train ?? 0} + ${(r.entries || {}).test ?? 0} + ${(r.entries || {}).hold ?? 0} entries${r.held == null ? '' : ` - held-back ${money(r.held)}`}</option>`).join('')}</select></label>
  </div>
  <div class="row" style="margin-bottom:.4rem;align-items:flex-end">
    <span class="note" title="which of the three windows' entries the scans read. The training and test windows were read to choose the rule, so reading them again is not a look; the held-back window was sealed until Verify, so every scan that reads it is a counted look.">windows the scans read</span>
    <label class="f" style="flex:none"><input type="checkbox" id="tnWinTrain" ${wins.includes('train') ? 'checked' : ''}> training</label>
    <label class="f" style="flex:none"><input type="checkbox" id="tnWinTest" ${wins.includes('test') ? 'checked' : ''}> test</label>
    <label class="f" style="flex:none"><input type="checkbox" id="tnWinHold" ${wins.includes('hold') ? 'checked' : ''}> held-back</label>
    <span class="note">${wins.includes('hold') ? `<b class="warn">reading the held-back entries is look ${(cand.looks || 0) + 1}</b>` : 'the held-back entries are not read'}</span>
  </div>`;
}
// the line at the top of a result that came from a capture
function tnTargetLineHtml(t) {
  return `<p class="note"><b>Read from the capture:</b> the survivor <b>${esc(t.survivor)}</b> ${t.pick === 'depth' ? '(by depth)' : '(named)'} of ${esc(t.set)}${t.unitName ? ` - ${esc(t.unitName)}` : ''},
    ${Number(t.entries || 0).toLocaleString()} entries on the ${esc(tnWindowWords(t.windows))} window(s), captured ${esc(String(t.captureAt || '').slice(0, 10))} under release ${esc(t.captureRelease || '?')}
    · ${t.look == null ? 'the held-back entries were not read: not a look' : `<b>this read of the held-back entries was look ${t.look}</b>`} · nothing is applied from a Stage 4 record set</p>`;
}
async function tnCaptureFollow(id, token) {
  for (;;) {
    let s = null;
    try { s = await api(`api/funnel/set/${encodeURIComponent(id)}/capture/status`); } catch (_) { s = null; }
    if (!s || s.none || s.token !== token) { drawTune(); return; }
    if (s.error) {
      const m = $('#tnCaptureMsg'); if (m) m.textContent = s.error;
      const b = $('#tnCapture'); if (b) b.disabled = false;
      return;
    }
    if (s.result) { drawTune(); return; }
    const m = $('#tnCaptureMsg'); if (m) m.textContent = `capturing the trades${s.cpu != null ? ` · box ${Math.round(Number(s.cpu))}% busy` : ''}`;
    await new Promise((resolve) => { setTimeout(resolve, 2000); });
    if (tab !== 'tune') return;
  }
}
// ---- Tune (stop tuner · conviction sizing · compare) ----------------------------
async function drawTune() {
  clearTimeout(tunePoll); tunePoll = null;
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
  // WHAT THE SCANS ARE AIMED AT: the Stage 4 record sets whose trades are
  // captured on this tab, one survivor of one of them, over the windows ticked.
  // The server lists them; nothing here is typed. The older engine's targets —
  // a saved run's row and the live setups, which the scans replayed with the
  // older committee — went with that engine (3.97.0).
  const cand = await apiOr('api/pilot/stop-candidates', ({ candidates: [] }));
  const books = (cand && cand.candidates) || [];
  // the Stage 4 record sets on this box, for the capture panel (3.92.0)
  const tnSets = ((await apiOr('api/funnel/sets', ({ sets: [] }))).sets || []);
  const tnChosen = tnRememberedSet(tnSets);
  const tnd = tnChosen ? await apiOr(`api/funnel/set/${encodeURIComponent(tnChosen)}/capture`, null) : null;
  // the Stage 4 record sets that carry a per-trade capture (3.92.0): a scan on
  // one reads the captured entries of one survivor over the windows ticked
  const stage4 = books.filter((b) => b.kind === 'stage4');
  const optId = (b) => `s:${b.id}`;
  const known = new Set(books.map(optId));
  const savedTarget = localStorage.getItem('cx-scan-target') || '';
  // A stored preference pointing at something that no longer exists resolves to
  // the first real target rather than leaving a dangling option selected.
  const firstReal = (stage4[0] && optId(stage4[0])) || '';
  const tgt = known.has(savedTarget) ? savedTarget : firstReal;
  const chosen = books.find((b) => optId(b) === tgt) || null;
  // a Stage 4 target carries the survivor and the windows with it; both are
  // remembered on this browser and redrawn, so the body sent is what is shown
  const isSet = !!(chosen && chosen.kind === 'stage4');
  const tnPickVal = isSet ? tnRememberedPick(chosen) : 'depth';
  const tnWins = isSet ? tnRememberedWindows() : [];
  const scanBody = isSet ? { setId: chosen.id, pick: tnPickVal, windows: tnWins } : null;
  // The prose and the dropdown are computed from the SAME resolved value, so
  // the sentence above the control can no longer describe a different target
  // from the one the launcher will actually use.
  const target = isSet ? `the survivor <b>${esc(tnPickVal === 'depth' ? `${(chosen.pick || {}).label || '?'} (by depth)` : tnPickVal)}</b> of the Stage 4 record set <b>${esc(chosen.name)}</b>, on its ${tnWins.length ? esc(tnWindowWords(tnWins)) : '<b class="warn">no</b>'} entries`
    : '<b>nothing selectable</b> — no Stage 4 record set on this box has its trades captured';
  $('#view').innerHTML = `
  ${busy ? `<div class="panel warn">A heavy scan is running (${esc(String(busy))}) — one at a time; both launchers are disabled until it lands (scans run minutes and cannot be aborted mid-flight).</div>` : ''}
  <div class="panel">
    <h3 style="margin-top:0">Protective stop tuner — on the captured trades, loses no winner</h3>
    <p class="note">Reads the captured trades of one survivor of a Stage 4 record set over the windows ticked and finds the
      tightest fixed stop that would not have clipped a single winner, plus the sacrifice curve (give up top winners →
      tighter stop → NET $). Scanning applies nothing. Target: ${target}.</p>
    <div class="row" style="margin-bottom:.4rem"><label class="f" title="what the scans below are aimed at: a Stage 4 record set whose trades are captured on this tab, one survivor of it, over the windows ticked">scan target<select id="tuneTarget">
      ${stage4.map((b) => `<option value="${esc(optId(b))}" ${tgt === optId(b) ? 'selected' : ''}>${esc(b.name)} — ${esc(b.unitName || 'all units together')} — ${b.captured} of ${b.survivors} survivors captured</option>`).join('')}
    </select></label>
    <span class="note">${stage4.length} Stage 4 record set(s) with their trades captured</span></div>
    ${isSet ? tnTargetRowHtml(chosen, tnPickVal, tnWins) : ''}
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
    <div class="row"><button id="stopRun" class="pri" ${busy ? 'disabled' : ''}>Tune protective stop</button>
      <span class="note">currently applied on the trading machine: ${applied.stopPct != null ? `<span class="pos">${pct(applied.stopPct)}</span>` : 'none'}</span></div>
    <div id="stopOut">${stop.status === 'done' ? renderStopResult(stop) : stop.status === 'running' ? '<p class="note">running…</p>' : stop.status === 'error' ? `<p class="warn">last scan failed: ${esc(stop.error || '')}</p>` : ''}</div>
  </div>
  <div class="panel">
    <h3 style="margin-top:0">Conviction sizing — bet more when more members agree?</h3>
    <p class="note">Prices the DECLARED clip ladder (multiplier = winning-side vote count) as a pure $ overlay on the
      same captured trades, against a shuffled-assignment chance check and exposure-honest metrics.
      Target: ${target}.</p>
    <div class="row"><button id="convRun" class="pri" ${busy ? 'disabled' : ''}>Run conviction sweep</button></div>
    <div id="convOut">${conv.status === 'done' ? renderConvResult(conv) : conv.status === 'running' ? '<p class="note">running…</p>' : conv.status === 'error' ? `<p class="warn">last sweep failed: ${esc(conv.error || '')}</p>` : ''}</div>
  </div>
  ${tnCapturePanelHtml(tnSets, tnChosen, tnd)}`;
  function renderStopResult(s) {
    const cc = s.counts || {};
    return `${s.target ? tnTargetLineHtml(s.target) : ''}<p><b>${esc(s.bookId)}</b>: tightest no-winner-lost stop <span class="pos">${pct(s.stopPct)}</span> —
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
    return `${c.target ? tnTargetLineHtml(c.target) : ''}<p><b>${esc(c.bookId)}</b> over ${c.entries} priced entries: flat ${usd(c.flatUsd)} vs ladder <b>${usd(c.ladderUsd)}</b>
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
    // target above says — that picker chooses which record set's captured trades
    // are SCANNED, and applying never touches a record set. Applying went through with no
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
  const tnConfirm = (what) => {
    if (!isSet) return confirm(`Run the full-history ${what}? (minutes; one heavy scan at a time)`);
    if (!tnWins.length) { alert('tick at least one window for the scan to read: training, test or held-back'); return false; }
    const look = tnWins.includes('hold') ? `\n\nThis reads the captured held-back entries: a counted look at the held-back window (look ${(chosen.looks || 0) + 1}).` : '\n\nThe held-back entries are not read: not a look.';
    return confirm(`Run the ${what} on the captured entries of ${chosen.name}? (${tnWindowWords(tnWins)} window(s); one heavy scan at a time)${look}`);
  };
  $('#stopRun').onclick = async () => {
    if (!scanBody) return noTarget();
    if (!tnConfirm('stop scan')) return;
    const out = await tryPost('api/pilot/stopsweep', scanBody); if (out) { clearTimeout(tunePoll); tunePoll = setTimeout(drawTune, 1500); }
  };
  $('#convRun').onclick = async () => {
    if (!scanBody) return noTarget();
    if (!tnConfirm('conviction sweep')) return;
    const out = await tryPost('api/pilot/convictionsweep', scanBody); if (out) { clearTimeout(tunePoll); tunePoll = setTimeout(drawTune, 1500); }
  };
  // the survivor and the windows are remembered and redrawn, so what the
  // sentence above says is what the press sends
  const tnPickSel = $('#tnPick');
  if (tnPickSel) tnPickSel.onchange = () => { try { localStorage.setItem(TN_PICK_KEY, tnPickSel.value); } catch (_) { /* private window */ } drawTune(); };
  for (const [, id] of TN_WINDOWS) {
    const box = $(`#${id}`);
    if (box) box.onchange = () => {
      const on = TN_WINDOWS.filter(([, bid]) => { const el = $(`#${bid}`); return el && el.checked; }).map(([k]) => k);
      try { localStorage.setItem(TN_WINDOWS_KEY, JSON.stringify(on)); } catch (_) { /* private window */ }
      drawTune();
    };
  }
  // the capture panel: the set box, the press, started and polled
  const tnSel = $('#tnSet');
  if (tnSel) tnSel.onchange = () => {
    try { localStorage.setItem(TN_SET_KEY, tnSel.value); } catch (_) { /* private window */ }
    drawTune();
  };
  const tnb = $('#tnCapture');
  if (tnb && tnChosen && tnd && !tnd.refused) tnb.onclick = async () => {
    if (!confirm(`Capture the trades of ${tnd.name}?\n\nEvery survivor that enters at market with no trailing stop, on the training, test and held-back windows. The set then appears in the scan target box.${tnd.capture ? '\n\nThis replaces the capture on record; the looks already counted stay.' : ''}`)) return;
    tnb.disabled = true;
    $('#tnCaptureMsg').textContent = 'starting…';
    const started = await tryPost(`api/funnel/set/${encodeURIComponent(tnChosen)}/capture`, {}, 'The Stage 4 record set box on Tune lists what was captured - pick the set there.');
    if (!started) { tnb.disabled = false; $('#tnCaptureMsg').textContent = ''; return; }
    tnCaptureFollow(tnChosen, started.token);
  };
  if (tnd && tnd.running && tnb) { tnb.disabled = true; tnCaptureFollow(tnChosen, tnd.running.token); }
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
// THE STAGE 4 DOOR ON GREENLIGHT (3.90.0): a Stage 4 record set whose verdict
// stood, one survivor chosen by depth inside the rule or named, a name and a
// why. The frozen configuration carries the agreement as the survivor carries
// it, which no integer quorum expresses. Nothing here trades, and nothing built
// from it can be put to work until the live path speaks that agreement.
const GL_SET_KEY = 'cx-greenlight-set';
function glRememberedSet(list) {
  let want = null;
  try { want = localStorage.getItem(GL_SET_KEY); } catch (_) { want = null; }
  if (want && list.some((x) => x.id === want)) return want;
  return list.length ? list[0].id : null;
}
function glFix(v, n = 2) { return v == null || !Number.isFinite(Number(v)) ? 'none' : Number(v).toFixed(n); }
function glStage4PanelHtml(list, chosen, d) {
  const depth = d && d.depthPick ? d.depthPick : null;
  return `<div class="panel">
    <h3 style="margin-top:0">Greenlight a Stage 4 record set</h3>
    <p class="note">The other way to write the decision down: from a Stage 4 record set whose verdict stood on Verify. One of its
      survivors is taken forward, chosen by how surrounded it is inside the rule (the setting nearest the middle of every
      range, never the one with the most money) or named by you, and both are recorded. The frozen settings carry the
      way its members agree exactly as the survivor does. Nothing here trades, and nothing built from it can be put to
      work until the live path speaks that agreement.</p>
    <div class="row" style="align-items:flex-end">
      <label class="f" title="which Stage 4 record set to take a survivor from, from every set on this box, newest first; a half-life set stands on the verdict of the set it was built from">Stage 4 record set<select id="gl4Set">${list.length
    ? list.map((x) => `<option value="${esc(x.id)}" ${x.id === chosen ? 'selected' : ''}>${esc(x.name)} · ${esc(x.unitName || 'all units together')} · ${Number((x.counts || {}).survivors ?? 0).toLocaleString()} survivors${x.derived ? ` · half-life set from ${esc(x.derived.fromName || x.derived.from)}` : (x.verify ? ` · verdict ${x.verify.pass ? 'PASS' : 'FAIL'}` : ' · no verdict')}</option>`).join('')
    : '<option value="">no Stage 4 record set on this box yet</option>'}</select></label></div>
    ${d ? `<p class="note"><b>${esc(d.name)}</b> - ${esc(d.unitName || 'all units together')} · ${esc(d.ruleSentence || '')} · ${(d.survivors || []).length} survivors
      · verdict ${d.gate ? `<b class="pos">${esc(d.gate.id)} stood (PASS, release ${esc(d.gate.release || '?')})</b>` : `<b class="neg">none stood</b> (${d.verdicts} stamped)`}${d.members ? ` · ${d.members} members as the stage 2 set trained them` : ''}${d.refused ? ` · <b class="warn">refused:</b> ${esc(d.refused)}` : ''}</p>
      ${d.refused ? '' : `<div class="row" style="align-items:flex-end">
        <label class="f" style="flex:1 1 auto;min-width:0" title="which survivor is taken forward. By depth is the setting nearest the middle of every range of the rule, chosen without looking at money; naming one records it as your pick.">one survivor<select id="gl4Pick">
          <option value="depth">by depth - ${esc(depth ? depth.label : '?')} (worst distance ${glFix(depth ? depth.worst : null)})</option>
          ${(d.survivors || []).map((x) => `<option value="${esc(x.label)}">${esc(x.label)} - distance ${glFix(x.worst)}${x.halfLife == null ? '' : ` - half-life ${x.halfLife} months${x.retrained == null ? '' : ` - retrained ${money(x.retrained)}`}`}${x.held == null ? '' : ` - held-back ${money(x.held)}`}${x.unread == null ? '' : ` - unread ${money(x.unread)}`}</option>`).join('')}</select></label>
      </div>
      <div class="row" style="margin-top:.4rem;align-items:flex-end">
        <label class="f" style="flex:1" title="what you want to see on screen for this configuration">name<input id="gl4Name" style="width:100%" placeholder="e.g. XRP weekly, depth pick"></label>
        <label class="f" style="flex:2" title="the reasoning that cleared it. Required, kept forever with the record.">why — the decision record (required)<input id="gl4Why" style="width:100%" placeholder="e.g. verdict PASS on Verify; reserve grade look 1 PASS; other units 8 of 9 positive"></label>
        <button id="gl4Go" class="pri">GREENLIGHT this survivor</button></div>`}` : ''}
  </div>`;
}
async function drawGreenlight() {
  const gls = await apiOr('api/live/greenlights', ({ greenlights: [] }));
  const glSets = ((await apiOr('api/funnel/sets', ({ sets: [] }))).sets || []);
  const glChosen = glRememberedSet(glSets);
  const gl4 = glChosen ? await apiOr(`api/live/greenlight/stage4/${encodeURIComponent(glChosen)}`, null) : null;
  $('#view').innerHTML = `<div class="panel">
    <h3 style="margin-top:0">Greenlight — the decision that a config is fit to trade</h3>
    <p class="note">Records WHO/WHEN/WHY with the exact frozen config, engine version, and the campaign's whole
      evidentiary chain. The config then appears on the Trade tab (both sides) for activation. Only greenlighted
      configs ever trade — no hand-built live configs, ever.</p>
  </div>
  ${glStage4PanelHtml(glSets, glChosen, gl4)}
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
  const gl4Sel = $('#gl4Set');
  if (gl4Sel) gl4Sel.onchange = () => {
    try { localStorage.setItem(GL_SET_KEY, gl4Sel.value); } catch (_) { /* private window */ }
    drawGreenlight();
  };
  const go4 = $('#gl4Go');
  if (go4 && glChosen && gl4 && !gl4.refused) go4.onclick = async () => {
    const why = $('#gl4Why').value.trim();
    const name = $('#gl4Name').value.trim();
    if (!name) { alert('name is required — what you want to see on screen.'); return; }
    if (!why) { alert('why is required — the decision record is the point.'); return; }
    const pick = $('#gl4Pick').value;
    if (!confirm(`Greenlight ${pick === 'depth' ? `the survivor by depth (${gl4.depthPick ? gl4.depthPick.label : '?'})` : `the named survivor ${pick}`} of ${gl4.name}?\n\nNothing trades from this. It records the decision; the live path cannot yet put it to work.`)) return;
    const out = await tryPost('api/live/greenlight', { source: 'stage4', setId: glChosen, pick, why, name });
    if (out) { alert(`Greenlighted: ${out.greenlight.id}\n\nIt is on the Trade tab, both sides, and cannot be activated until the live path speaks the stage engine's agreement.`); drawGreenlight(); }
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
  // the next free name per stage, shown greyed in each name box as the
  // suggestion an empty box takes
  const nextNames = st.nextNames || {};
  // built once and remembered unselected, so the poll's comparison starts level
  // with what is on screen and the first tick does not rewrite either box
  const swOpt1 = swSetOptions(sets, 1, null);
  const swOpt2 = swSetOptions(sets, 2, null);
  swParentShown.set('#swFrom2', swOpt1);
  swParentShown.set('#swFrom3', swOpt2);
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
      argmax fit. No trade shape and no decision exist here; those are priced later, at stage 3, from the votes this stage keeps.
      The fee prices only the tuning-slice $ on Boards: each unit's own votes on the last quarter of its training window,
      one buy or sell per chunk in the direction they lean, read against the same null set.</p>
    <div class="row" style="align-items:flex-end">
      <label class="f" title="the coins this run actually buys and sells. Blank means all 17 default pairs.">trade coins (blank = all 17 default pairs)<input id="swUni" placeholder="LTCUSDT,XRPUSDT,BCHUSDT" style="width:16rem"></label>
      <span id="swGrpCompare"><label class="f" title="the coins each traded coin is READ AGAINST — context only, never bought or sold. Blank means all 17 default pairs, the same as the box beside it, so one coin typed into trade coins with nothing here is that coin against everything. Only doubles and triples read this: singles is a coin on its own price history alone, so with only singles ticked this box is greyed and nothing reads it.">compare coins (blank = all 17 default pairs)<input id="swCompare" placeholder="BTCUSDT,ETHUSDT,SOLUSDT" style="width:16rem"></label></span>
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
      <label class="f">fee % each way<input id="swFee1" type="number" value="0.125" min="0" max="5" step="0.005" style="width:5.5rem"></label>
    </div>
    <div class="row" style="margin-top:.5rem;align-items:flex-end">
      <label class="c" title="off: every trade teaches one lesson whatever it was worth. On: a trade is weighed by the gap between the best and the worst its decision could have done, in dollars. One chunk of history is one decision and one trade -- a week on the weekly shape, a day on the daily ones."><input type="checkbox" id="swByMoney"> weigh each trade by the money it was worth</label>
      <label class="f">the most one trade may count for<input id="swCap1" type="number" value="10" min="0" step="1" style="width:6rem"></label>
      <span class="note">One chunk of history is one decision and one trade - a week on the weekly shape, a day on the
        daily ones. Off, a trade where the price moved 0.6% and one where it moved 14% are the same single lesson, so a
        forecast right nine times on crumbs and wrong once on a landslide trains as a good one. On, the landslide
        teaches more. A trade too small to cover the fees is never weightless - taking it the wrong way wastes them,
        and staying out is worth learning. The number beside it is how many ordinary trades the biggest may count for,
        so one freak trade cannot be the whole training; 0 turns that limit off. This carries to stage 2 by itself, so
        a committee is trained one way.</span>
    </div>
    <div class="row" style="margin-top:.5rem;align-items:flex-end">
      <label class="f">name<input id="swName1" placeholder="${esc(nextNames[1] || '')}" maxlength="80" style="width:10rem"></label>
      <label class="f" style="flex:1">description<input id="swDesc1" style="width:100%"></label>
      <button id="swGo1" class="pri">start stage 1</button>
    </div>
    <p class="note" style="margin:.4rem 0 0" id="swCost1">…</p>
    <div id="swOut1"></div>
  </div>

  <div class="panel">
    <h3 id="swH2" style="margin-top:0">Stage 2 — carry the best forward, add the BOOST members</h3>
    <p class="note warn" id="swWhy2" style="margin:.2rem 0 .5rem;display:none"></p>
    <div class="row" style="align-items:flex-end">
      <label class="f">from stage 1 record set<select id="swFrom2" style="min-width:24rem">${swOpt1}</select></label>
      <label class="f" title="the carry takes the top of the parent's table in the sort saved on it — pick the sort on Boards. The fixed rule (beat its own null set, ties by lead over null set) when none is saved.">carry forward (0 = all)<input id="swCarry" type="number" value="0" min="0" style="width:5.5rem"></label>
    </div>
    <div class="row" style="margin-top:.5rem;align-items:flex-end">
      <label class="f">name<input id="swName2" placeholder="${esc(nextNames[2] || '')}" maxlength="80" style="width:10rem"></label>
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
    <p class="note warn" id="swWhy3" style="margin:.2rem 0 .5rem;display:none"></p>
    <div class="row" style="align-items:flex-end">
      <label class="f">from stage 2 record set<select id="swFrom3" style="min-width:24rem">${swOpt2}</select></label>
      <label class="f" title="which of the parent's records get priced. N records: the carry forward box beside this decides — 0 prices every record, N prices the top N of the parent's table in the sort saved on it. Selected records: exactly the records ticked on the parent's stage 2 table on Boards, however many that is.">records to price<select id="swPick3">${vocabOptions('stage3Pick', 'count')}</select></label>
      <label class="f">carry forward (0 = all)<input id="swCarry3" type="number" value="0" min="0" style="width:5.5rem"></label>
      <span id="swPicked3" class="note"></span>
      <label class="f">fee % each way<input id="swFee" type="number" value="0.125" min="0" max="5" step="0.005" style="width:5.5rem"></label>
      <label class="f">null set size<input id="swNull3" type="number" value="19" min="0" style="width:4.5rem"></label>
      <label class="f" title="how many of the null set's money figures to write down, rather than just counting them. Keeping some builds a whole second copy of the stage 3 tables out of scrambled money alone, which is the only thing the Funnel can measure a real result against. Costs one extra pricing per setting per coin for each one kept, so 10 makes the run about 10% longer. 0 keeps none, which is how every run before this one worked.">null set money kept<input id="swKeep3" type="number" value="10" min="0" style="width:4.5rem"></label>
    </div>
    <div class="row" style="margin-top:.5rem">
      <button id="swTrained3" title="fills the boxes below with the conditions the units were actually trained and scored under in stages 1 and 2, so what those stages did can be priced here as one setting and read against everything else on the same table. Those stages open at the close of the chunk and hold to the chunk's own end, add every member's lean together and take the winning side whatever the margin, with no head count and nothing to clear. Nothing is started: the boxes are filled and you press start stage 3 yourself.">load training setup</button>
      <span id="swTrainedSaid" class="note"></span>
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
      <div id="swGrpWk" style="display:flex;align-items:flex-end;gap:.45rem">
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
        <label class="f" title="how long a position is held before it is closed on time. The hours are the same on every unit. the chunk's own is not a number: it holds each unit for exactly as long as its own chunk shape is held when stages 1 and 2 score it - 60 hours on a weekly 8-day chunk, 17 on a daily 1-day or 2-day, 41 on a daily 3-day or 4-day - so one setting can be right on every unit at once.">t<select id="swT">${vocabOptions('tHours', '65')}</select></label>
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
        <label class="f" title="WHAT IS WEIGHED when the members are polled. count is how many say the same thing — the plain head count. conviction is how hard they lean, added up, so six that are certain outweigh six that barely lean. voices is a head count in which members that almost always call the same way as each other share one vote between them, so a crowd of near-copies cannot outvote a real disagreement. families is how many different KINDS of evidence agree — the members read four different slices of the numbers, and this asks that several slices line up rather than several members. trained is the way stages 1 and 2 added the members up when they scored these units: every lean added together and the winning side taken, whatever the margin and whoever the head count would have picked. It is the only choice here that reads no bar at all, because those stages had none — so quorum bar and share are left out of its name and off its records, and it is one setting however many of either are being priced. This box is only half the quorum: quorum bar decides how much of it is enough.">quorum by<select id="swAgreeRule">${vocabOptions('agreeRule', 'count')}</select></label>
        <label class="c" title="price every quorum by choice as its own setting."><input type="checkbox" id="swPermAgreeRule"> permute</label>
        <label class="f" title="WHAT THE BAR IS A SHARE OF. all of them means a share of what EXISTS — 75% of 8 members is 6 of them, worked out from the committee's size and nothing else. its own history means a share of what this committee ACTUALLY REACHES — the moments are sorted and 75% admits only the strongest quarter of them. The second matters because a bar set as a share of what exists only makes sense when the thing weighed reaches its maximum in practice: a head count does, a sum of how hard eight members lean does not. Read from the test window only; the held-back window is never used for it, though the same window did the ordering, so the bar is set knowing the window it will be scored on.">quorum bar<select id="swAgreeBar">${vocabOptions('agreeBar', 'all')}</select></label>
        <label class="c" title="price both bars as their own settings."><input type="checkbox" id="swPermAgreeBar"> permute</label>
        <div id="swGrpCopy" style="display:flex;align-items:flex-end;gap:.45rem">
          <label class="f" title="HOW ALIKE TWO MEMBERS MUST BE TO COUNT AS ONE VOICE. Only voices reads this. Two members that make the same call at least this often across the test window share one vote between them, so a crowd of near-copies cannot outvote a real disagreement. Lower is harsher: at 80% two members agreeing four times in five are already one voice, and the committee shrinks. At 100% only members that never once differ are folded together, which is almost never, and voices then gives the same answer as count. The block is not multiplied by this for the other three — they cannot read it.">one voice at<select id="swAgreeCopy">${vocabOptions('agreeCopy', '98')}</select></label>
          <label class="c" title="price every one voice at choice as its own setting. It only multiplies the block where voices is being priced."><input type="checkbox" id="swPermAgreeCopy"> permute</label>
        </div>
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
      <label class="f">name<input id="swName3" placeholder="${esc(nextNames[3] || '')}" maxlength="80" style="width:10rem"></label>
      <label class="f" style="flex:1">description<input id="swDesc3" style="width:100%"></label>
      <button id="swGo3" class="pri">start stage 3</button>
    </div>
    <div id="swOut3"></div>
  </div>`;

  wireCampaignPanel(() => drawSweep());
  const say = (sel, msg, bad) => { $(sel).innerHTML = `<p class="note${bad ? ' warn' : ''}" style="margin:.4rem 0 0">${msg}</p>`; };
  // THE NAME THE OWNER TYPED STAYS IN THE BOX (3.67.1, owner report 2026-09-04:
  // "when i create a new Stage 1 sweep and give it a name such as 'S1 #3' then
  // the code needs to retain *THAT NAME* in the Stage 1 name field after the
  // start stage 1 button is used"). All three of these used to empty their own
  // name box the moment the start went through, so the one thing that says
  // which set was just launched vanished at the moment it became true. The box
  // is saved and restored with the rest of this screen's boxes, so leaving it
  // alone is the whole fix -- and a second start under the same name is refused
  // by the service, in words, which is better than an empty box that hides it.
  $('#swGo1').onclick = async () => {
    swStarting(1);
    const body = {
      universe: ($('#swUni').value || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean),
      compare: ($('#swCompare').value || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean),
      sizes: { singles: $('#swSingles').checked, doubles: $('#swDoubles').checked, triples: $('#swTriples').checked },
      geometry: $('#swGeom').value, permuteGeometry: $('#swPermGeom').checked,
      windowLayout: $('#swLayout').value, allLoaded: $('#swAllData').checked,
      startMonth: $('#swStart').value || undefined, endMonth: $('#swEnd').value || undefined,
      nullN: Number($('#swNull1').value) || 0, fee: Number($('#swFee1').value) / 100, desc: $('#swDesc1').value,
      name: $('#swName1').value,
      // what each training trade is worth (3.69.0)
      trainOn: $('#swByMoney').checked ? 'money' : 'direction',
      weightCap: $('#swCap1').value === '' ? undefined : Number($('#swCap1').value),
    };
    if (!body.universe.length) delete body.universe;
    if (!body.compare.length) delete body.compare;
    const got = await startPost('api/stage1', body);
    if (got && !got.pending) { rememberSweepForm(); say('#swOut1', `started <b>${esc(got.name)}</b> — ${got.units.toLocaleString()} units. Progress above; the set lands on Boards.`); }
    swAfterStart(got);
  };
  $('#swGo2').onclick = async () => {
    swStarting(2);
    const got = await startPost('api/stage2', {
      from: $('#swFrom2').value,
      carry: Number($('#swCarry').value) || 0, desc: $('#swDesc2').value,
      name: $('#swName2').value,
    });
    if (got && !got.pending) { rememberSweepForm(); say('#swOut2', `started <b>${esc(got.name)}</b> — ${got.units.toLocaleString()} carried units.`); }
    swAfterStart(got);
  };
  $('#swGo3').onclick = async () => {
    // with a paused run chosen in the box nothing is launched: it is started
    // again instead, below, with everything it had
    const cont = swContinueOf();
    swStarting(cont ? 'again' : 3);
    const got = cont ? null : await startPost('api/stage3', {
      from: $('#swFrom3').value, fee: Number($('#swFee').value) / 100,
      carry: Number($('#swCarry3').value) || 0,
      pick: $('#swPick3').value,
      nullN: Number($('#swNull3').value) || 0, keepN: Number($('#swKeep3').value) || 0, desc: $('#swDesc3').value,
      name: $('#swName3').value,
      ...swBlockParams(),
    });
    if (got && !got.pending) { rememberSweepForm(); say('#swOut3', `started <b>${esc(got.name)}</b> — ${got.settings.toLocaleString()} settings × ${got.units.toLocaleString()} units.`); }
    if (cont) {
      // the box answers before it has read what is on disk; the line above
      // says how far that reading has got, then how far the pricing has
      const again = await startPost(`api/stageset/${encodeURIComponent(cont)}/continue`, {});
      if (again && !again.pending) {
        rememberSweepForm();
        say('#swOut3', `started again <b>${esc(again.name)}</b> — progress above; the set lands on Boards.`);
      }
      swAfterStart(again);
      return;
    }
    swAfterStart(got);
  };
  // THE CONDITIONS THE UNITS WERE TRAINED UNDER, AS ONE SETTING (3.71.0, owner
  // question 2026-09-05: "is there a fixed set of Stage 3 settings that
  // accurately represents exactly the conditions under which the Stage 1 and
  // Stage 2 unit trainings work? Does it make sense to put a button 'load
  // training setup' on the Stage 3 sweep").
  //
  // It FILLS BOXES AND STOPS. Nothing is launched, nothing is hidden, and the
  // owner can change any of it before pressing start stage 3 — which is the
  // only reason this can exist at all under RULE FIVE: a hidden setting the
  // system priced for itself would be a setting the owner never chose.
  //
  // ONE SETTING, RIGHT ON EVERY UNIT (3.72.0, owner: "the chunk's own, no new
  // field"). The first version of this filled everything except t, because the
  // hold length is a different number on each chunk shape and picking one
  // would have been choosing for the owner in silence. It is not a number any
  // more: t is set to the chunk's own hold length, which each unit turns into
  // its own when it is priced, the way a band of auto already does. So there
  // is nothing left for this to guess at and nothing left for it to ask.
  $('#swTrained3').onclick = () => {
    const said = $('#swTrainedSaid');
    const setV = (sel, v) => { const el = $(sel); if (el) el.value = String(v); };
    const setC = (sel, v) => { const el = $(sel); if (el) el.checked = !!v; };
    setV('#swAgreeRule', 'trained'); setC('#swPermAgreeRule', false);
    setC('#swPermAgreeBar', false); setC('#swPermAgreeShare', false); setC('#swPermAgreeCopy', false);
    setC('#swAgreeBoth', false); setC('#swPermAgreeBoth', false);
    setV('#swAgreeHold', '0'); setC('#swPermAgreeHold', false);
    setV('#swEntry', 'market'); setC('#swPermEntry', false);
    setC('#swPermGate', false); setC('#swPermD', false);
    setV('#swTrail', ''); setC('#swPermTrail', false); setC('#swPermArm', false);
    setV('#swDec', 'argmax'); setC('#swPermDec', false);
    setV('#swBand', 'auto'); setC('#swPermBand', false);
    setC('#swWk', false); setC('#swPermWk', false);
    setV('#swT', 'own'); setC('#swPermT', false);
    said.textContent = 'filled in: quorum by trained, entry market, t the chunk\u2019s own, band % (or auto) auto, '
      + 'decision argmax, 24/5 off, every permute off. That is one setting, and it prices every unit at the hold '
      + 'length and the band its own stage 1 worked out \u2014 press start stage 3 when you are ready.';
    rememberSweepForm();
    swProvenance();
    swCounts();
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
const bDash = () => '<span class="muted">—</span>';
function bShare(share, beat, pairs) {
  if (share == null) return bDash();
  return `<b class="${share > 0.5 ? 'pos' : ''}">${(share * 100).toFixed(1)}%</b> <span class="muted">${Number(beat).toLocaleString()}/${Number(pairs).toLocaleString()}</span>`;
}
const bLead = (v) => (v == null ? bDash() : `×${Number(v).toFixed(1)}`);
// THE COIN COLUMN IS THE COIN (owner order, 2026-09-06). It printed the traded
// coin AND the coins it is read alongside, and the very next column prints
// those same coins again -- so every three-coin row spent 27 characters saying
// what the column beside it says in 17, and it was the widest column on the
// table for no information at all. Its own heading already promised only the
// traded coin: "Anything listed under alongside is context only".
const bCoin = (r) => `<b>${esc(r.trade)}</b>`;
// THE COINS A ROW IS READ ALONGSIDE, NAMED ON THE COLUMN AND PRINTED IN THE
// CELL (3.79.2). The owner settled the word: "FINE, call it ALONGSIDE then"
// -- so this column says exactly what the two tables above it say, and the
// screen carries ONE name for one thing. The order was (2026-09-07): add
// "+ ASSOCIATED COINS" under coin + chunk shape "in cases of selections with
// doubles or triples"). Its rows are ALREADY keyed on those coins -- keyOf
// splits the table on ctx1 and ctx2 -- so one coin judged on its own and the
// same coin read against two others were two DIFFERENT rows printing exactly
// the same text, with nothing on screen to tell them apart. Only this table
// prints them in the coin cell: the two tables above it have their own
// alongside column beside it, which is why bCoin stays the traded coin alone.
const bAlso = (r) => {
  if (!r.ctx1) return '';
  const also = '+ ' + [r.ctx1, r.ctx2].filter(Boolean).join(' + ');
  return `<div class="muted">${esc(also)}</div>`;
};
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
  // EACH BOX OFFERS ONLY WHAT CAME OUT OF THE PICK ABOVE IT (owner order,
  // 2026-09-02: "why is Stage 3 on boards offering me a pick of S3 #1 which is
  // not related ... the provenance chain display is broken"). A stage 3 box
  // under a picked stage 2 set lists that set's children; under a picked stage
  // 1 set alone, its grandchildren; with nothing picked above, every set of
  // the stage. Descent is walked through the parent links, never assumed.
  const descendsFrom = (x, ancestorId) => {
    for (let r = x, hops = 0; r && hops < 8; r = r.parent ? rowOf(r.parent.id) : null, hops++) {
      if (r.parent && r.parent.id === ancestorId) return true;
    }
    return false;
  };
  const bOptions = (stage, sel, aboveId) => {
    const above = aboveId ? rowOf(aboveId) : null;
    const list = sets.filter((x) => x.stage === stage && (!above || descendsFrom(x, above.id)));
    const head = above && !list.length
      ? `<option value="">— nothing came out of ${esc(above.name)} yet —</option>`
      : `<option value="">— pick a stage ${stage} record set${above ? ` out of ${esc(above.name)}` : ''} —</option>`;
    return head + list.map((x) => `<option value="${esc(x.id)}"${x.id === sel ? ' selected' : ''}>${esc(x.name)} — ${esc(x.status)} — ${esc((x.createdAt || '').slice(0, 10))}${x.desc ? ` — ${esc(x.desc.slice(0, 40))}` : ''}</option>`).join('');
  };
  const foldBtn = (stage) => `<button data-bfold="${stage}" title="puts this stage's table away, or brings it back. The last state is remembered.">${fold[stage] ? 'put away' : 'open'}</button>`;

  $('#view').innerHTML = `<div class="panel">
    <h3 style="margin-top:0">Boards — the record sets, and what each stage wrote</h3>
    <p class="note">One section per stage, the whole provenance on screen: picking a stage 3 record set fills the
      stage 2 and stage 1 sections with its parents; picking a stage 2 set fills its stage 1 parent; picking a
      parent puts the child selections away. Each box offers only the record sets that came out of what is picked
      above it. Each section can be put away and comes back as you left it.</p>
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
      <label class="f">record set<select id="bPick2" style="min-width:26rem">${bOptions(2, s2sel, s1sel)}</select></label>
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
      <label class="f">record set<select id="bPick3" style="min-width:26rem">${bOptions(3, s3sel, s2sel)}</select></label>
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
      c.parent && c.parent.selected != null
        ? `selected ${Number(c.parent.selected).toLocaleString()} of ${Number(c.parent.of).toLocaleString()}`
        : c.parent && (c.parent.sortedBy || c.parent.orderBy)
          ? `carried ${Number(c.parent.carry).toLocaleString()} by ${c.parent.sortedBy || (c.parent.orderBy === 'lead' ? 'lead over null set' : 'beat its own null set')}`
          : null,
      esc(c.status),
    ].filter(Boolean).join(' · ')})`).join(' → ')}${chain.length > 1 ? ' · price files fingerprint-checked at every launch' : ''}</p>` : '';
    mount.innerHTML = `${chainLine}${descriptionPanelHtml(doc.desc, true)}
      ${stage === 1 ? namePanel1(doc) : stage === 2 ? namePanel2(doc) : namePanel3(doc)}${stage === 1 ? notesPanel1(doc) : stage === 2 ? notesPanel2(doc) : notesPanel3(doc)}${bKeptFillPanel(doc)}
      ${runIdentityPanelHtml(doc.plan && doc.plan.units ? `<p class="note"><b>Size:</b> <b>${Number(doc.plan.units).toLocaleString()}</b> units${doc.plan.settings ? ` × ${Number(doc.plan.settings).toLocaleString()} settings` : ''}${doc.plan.pricings ? ` · ${Number(doc.plan.pricings).toLocaleString()} records, each unit holding only the settings that place different orders on it` : ''}${(doc.params || {}).nullN ? ` · null set size ${doc.params.nullN}` : ''}.</p>` : '', doc.dataManifest || null, got.windows || null)}
      <div id="bT${stage}"></div>`;
    wireNotesSave(`api/stageset/${encodeURIComponent(doc.id)}/notes`, null, String(stage));
    wireRename(`api/stageset/${encodeURIComponent(doc.id)}/name`, String(stage));
    if (stage === 3) wireKeptFill(doc.id);
    if (doc.status !== 'done' && doc.status !== 'incomplete') {
      // whether it can be started again is on the LIST row (the set document
      // itself does not carry it), and the list is already in hand
      const canContinue = !!((sets.find((x) => x.id === doc.id) || {}).checkpoint);
      $(`#bT${stage}`).innerHTML = `<div class="panel"><p class="note">${esc(doc.name)} is ${esc(doc.status)}${doc.progress ? ` — ${esc(doc.progress)}` : ''}.${canContinue ? ' It can be started again from the stage 3 section on Sweep.' : ''} Its tables appear when it lands.</p></div>`;
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
       ${Number((doc.counts || {}).failures || 0)} unit(s) failed and are missing from every table below — read the numbers accordingly.
       ${doc.stage === 1 ? `<div class="row" style="margin-top:.5rem"><button id="bFillUnits" data-bfillunits="${esc(doc.id)}">put the missing units back</button>
       <span id="bFillUnitsSaid" class="note"></span></div>` : ''}</div>` : '';
    if (doc.stage === 1) await bDrawStage1(doc, incomplete, view, `#bT${stage}`);
    else if (doc.stage === 2) await bDrawStage2(doc, incomplete, view, `#bT${stage}`);
    else await bDrawStage3(doc, incomplete, view, `#bT${stage}`);
    if (doc.stage === 1 && doc.status === 'incomplete') bWireFillUnits(doc);
  }
}

// PUTTING BACK THE UNITS A RUN LOST (3.73.0, owner order 2026-09-06: "can you
// give me a button to fix issues like that without wasting another 18 hours on
// a run?").
//
// A stage 1 set that is short even one unit is refused as a stage 2 parent, so
// eighteen units out of ten thousand used to cost the whole run. This re-runs
// exactly the ones that are absent, under the set's OWN saved choices, and
// stamps the set finished when it matches its plan again.
//
// The refusal is the service's, printed here word for word. There is only one
// copy of the reasons and it is not on this page.
async function bWireFillUnits(doc) {
  const btn = $('#bFillUnits');
  const said = $('#bFillUnitsSaid');
  if (!btn || !said) return;
  const path = `api/stageset/${encodeURIComponent(doc.id)}/fill-units`;
  const poll = async () => {
    let st = null;
    try { st = await api(`${path}/status`); } catch (_) { st = null; }
    if (!st) { said.textContent = 'the service did not answer — it may still be working'; return; }
    if (st.running) {
      said.textContent = `putting the units back: ${Number(st.done).toLocaleString()} of ${Number(st.total).toLocaleString()}`
        + `${st.added ? ` — ${Number(st.added).toLocaleString()} back so far` : ''}`;
      setTimeout(poll, 2000);
      return;
    }
    if (st.error) { said.innerHTML = `<span class="warn">${esc(st.error)}</span>`; return; }
    if (st.missing === 0) { said.textContent = 'every unit is back — reopening'; drawBoards(); return; }
    said.innerHTML = `<span class="warn">${Number(st.missing || 0).toLocaleString()} still missing${st.why ? ` — ${esc(st.why)}` : ''}</span>`;
  };
  // WHY IT CANNOT BE PRESSED, BEFORE IT IS PRESSED. The service refuses a set
  // whose price files have moved since it was written, and finding that out by
  // pressing is finding it out too late to plan around.
  try {
    const st = await api(`${path}/status`);
    if (st && st.running) { btn.disabled = true; poll(); return; }
    if (st && st.why) { btn.disabled = true; said.innerHTML = `<span class="warn">${esc(st.why)}</span>`; return; }
    if (st && st.missing != null) {
      said.textContent = `${Number(st.missing).toLocaleString()} of ${Number(st.total).toLocaleString()} planned units are absent`;
    }
  } catch (_) { /* the line below still says what pressing does */ }
  btn.onclick = async () => {
    btn.disabled = true;
    said.textContent = 'starting…';
    const got = await tryPost(path, {});
    if (!got) { btn.disabled = false; said.textContent = ''; return; }
    if (got.already) { said.textContent = 'nothing is missing'; return; }
    poll();
  };
}
const btd = 'style="padding:.25rem .5rem"';
const btd0 = 'style="padding:.25rem .5rem .25rem 0"';
// A ROW IS ONE LINE (owner order, 2026-09-06: "rows taking one or two lines,
// all because you're wasting an enormous amount of space on each row"). A cell
// holding one number or one coin has nothing to gain from wrapping, and a
// table where some rows are two lines and some are one cannot be read down a
// column at all. Used on the stage 1 and stage 2 tables, whose cells are all
// short; the stage 3 tables carry whole setting names and are left to wrap.
const btdN = 'style="padding:.25rem .5rem;white-space:nowrap"';
const btdN0 = 'style="padding:.25rem .5rem .25rem 0;white-space:nowrap"';
// AND A HEADING NEVER DECIDES HOW WIDE A COLUMN IS. Left alone, a column is as
// wide as the longest thing in it, and the longest thing was the WORDS AT THE
// TOP -- "beat its own null set - tuning-slice $" is 37 characters over a cell
// holding "55.0% 11/20". Capped, the heading wraps onto two or three lines
// ONCE, at the top, and every row underneath is as narrow as its own numbers.
// Sitting on the bottom keeps a wrapped heading level with the one-line
// headings beside it and with its own sort button (RULE FOUR).
const bth = 'style="padding:.3rem .5rem;max-width:7.5rem;white-space:normal;vertical-align:bottom"';

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
      if (out) drawBoardsHoldingPlace();
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
      if (out) drawBoardsHoldingPlace();
    };
  });
}

// A REDRAW THAT LEAVES THE PAGE WHERE IT IS (owner order, 2026-09-02: "don't
// reposition the windows when column sorters are used on the Boards tab").
// The remembered place is only as good as the last thing that wrote it, and a
// long redraw outlives the hold on the memory: the page shrinks while its
// tables are rebuilt, the browser clamps to the bottom of what is left, the
// listener writes that clamped place, and the restore lands there -- higher
// than the owner was. So this takes the place BEFORE anything is replaced and
// puts the page back at exactly that height afterwards, then tells the memory.
async function drawBoardsHoldingPlace() {
  const y = window.scrollY;
  await drawBoards();
  holdScrollMemory();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    holdScrollMemory();
    window.scrollTo(0, y);
    rememberScroll(tab);
  }));
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
// THE STAGE 2 FILTERS SAVE ON THE RECORD SET (3.78.0, owner order 2026-09-06:
// "the carry from table 2 must NOT ignore filters!"). Every other table's
// filters are a view and stay one; these decide what a stage 3 launch prices,
// so they have to live where the launch can read them, exactly as the sort and
// the picks do. Saved the moment they change, so the table in front of the
// owner and the table the carry reads are never two different tables.
async function bApplyFilters(root, key, doc) {
  const next = bBoxesNow(root, key);
  bSetFilters(key, next);
  bSaveView({ [`from${key}`]: 0 });
  if (key === 'S2' && doc && doc.id) {
    await tryPost(`api/stageset/${encodeURIComponent(doc.id)}/filters`, { filters: next });
  }
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
function bWireFilters(root, doc) {
  if (!$(root)) return;   // the mount went with a redraw; the newer draw wires its own
  $(root).querySelectorAll('[data-bfilter]').forEach((el) => {
    const [key] = el.dataset.bfilter.split(':');
    // ON INPUT, not on change: the button has to wake on the first keystroke
    // and go back to sleep the moment the old value is typed back, and change
    // only fires when the box is left.
    el.oninput = () => { if (!bAuto(key)) bApplyState(root, key); };
    el.onchange = () => { if (bAuto(key)) bApplyFilters(root, key, doc); else bApplyState(root, key); };
  });
  $(root).querySelectorAll('[data-bapply]').forEach((btn) => {
    btn.onclick = () => { if (!btn.disabled) bApplyFilters(root, btn.dataset.bapply, doc); };
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
    btn.onclick = async () => {
      const key = btn.dataset.bfilterclear;
      const all = { ...(bView().filters || {}) };
      delete all[key];
      bSaveView({ filters: all, [`from${key}`]: 0, ...(key === 'S3C' ? { s3cBeforePin: null, s3cPin: null } : {}) });
      // and off the record set too, or the boxes empty while the carry stays cut
      if (key === 'S2' && doc && doc.id) await tryPost(`api/stageset/${encodeURIComponent(doc.id)}/filters`, { filters: {} });
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
// SETTINGS THE BLOCK NO LONGER DECLARES (owner order, 2026-08-30). Drawn above
// the fill-in line, which is the order they have to happen in: filling in
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
  return `<p class="note warn"><b>this set holds ${Number(surplus).toLocaleString()} settings its own block does not declare.</b>
    They price a trade that another setting it holds already prices, so every one of them is a second copy of a row that is
    already here. Dropping them deletes those rows and renumbers what is left; nothing else is touched, and the tables are
    worked out again afterwards.
    <button id="bDropUndeclared" data-bdrop="${esc(doc.id)}">drop the settings the block does not declare</button></p>`;
}
function bFillInLine(doc, gap, filling) {
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
    ['moneyMin', 'tuning-slice $ at least', 'num', 'hides rows whose tuning-slice $ is below this. Empty hides nothing.'],
    ['beatMoneyMin', 'beat its own null set — tuning-slice $ at least, %', 'num', 'hides rows whose tuning-slice $ beat less than this share of their null set. Empty hides nothing.'],
    ['leadMoneyMin', 'lead over null set — tuning-slice $ at least', 'num', 'hides rows whose tuning-slice $ lead over their null set is below this. Empty hides nothing.'],
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
        <th ${bth} title="how far above its null set's typical forecast score the real one sits, against the null set's own spread — the tie-break">lead over null set${bSortBtn(doc, 'lead', 'desc')}</th>
        <th ${bth} title="the unit's own votes on the tuning slice — the last quarter of its training window, which the fit never saw and the test window is not — priced one buy or sell per chunk in the direction they lean, held from the entry hour to the exit hour, at the fee declared on Sweep. US dollars on $100 a trade, after fees.">tuning-slice $${bSortBtn(doc, 'money', 'desc')}</th>
        <th ${bth} title="of its null set — the same votes dealt onto other days of the tuning slice — how many this unit's tuning-slice $ beat">beat its own null set — tuning-slice $${bSortBtn(doc, 'beatMoney', 'desc')}</th>
        <th ${bth} title="how far above its null set's typical tuning-slice $ the real one sits, against the null set's own spread">lead over null set — tuning-slice $${bSortBtn(doc, 'leadMoney', 'desc')}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td ${btdN0}>${Number(r.rank).toLocaleString()}</td>
        <td ${btdN}>${bCoin(r)}</td>
        <td ${btdN}${r.ctx1 ? '' : ' class="muted"'}>${r.ctx1 ? esc([r.ctx1, r.ctx2].filter(Boolean).join(' + ')) : '—'}</td>
        <td ${btdN}>${esc(bGeo(r.geometry))}</td>
        <td ${btdN}>${r.members == null ? '—' : r.members}</td>
        <td ${btdN}${r.voices != null && r.members && r.voices < r.members ? ' class="warn"' : ''}>${r.voices == null ? '—' : r.voices}</td>
        <td ${btdN}>${r.score == null ? '—' : r.score.toFixed(1)}</td>
        <td ${btdN}>${bShare(r.pairs ? r.beat / r.pairs : null, r.beat, r.pairs)}</td>
        <td ${btdN}>${bLead(r.lead)}</td>
        <td ${btdN}>${bMoney(r.money)}</td>
        <td ${btdN}>${bShare(r.pairs && r.beatMoney != null ? r.beatMoney / r.pairs : null, r.beatMoney, r.pairs)}</td>
        <td ${btdN}>${bLead(r.leadMoney)}</td></tr>`).join('') || '<tr><td colspan="12" class="empty">nothing here</td></tr>'}</tbody></table></div>
    ${bShown(t)}
    ${bPager((t && t.total) || 0, from, 100, 'S1')}
    <p class="note">Ordered by the sort picked on the columns — saved on this record set, and exactly what a stage 2
      carry forward takes the top of. With nothing picked: beat its own null set, ties broken by lead over null set —
      the fixed rule. Independent voices below members means some members are near-copies of each other and the
      committee is smaller than it looks. The tuning-slice $ columns are the only money before stage 3: each unit's own
      votes priced on the last quarter of its training window, which the fit never saw and the test window is not.
      Test-window money is priced at stage 3 alone.</p>
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
  // PICKED RECORDS (owner order, 2026-09-02): saved on the record set, served
  // with its table, and what the stage 3 set-up prices under Selected records
  const picked = new Set((t && t.picked) || []);
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
    ['moneyAllMin', 'tuning-slice $ — all members at least', 'num', 'hides rows whose tuning-slice $ with every member pooled is below this. Empty hides nothing.'],
    ['beatMoneyMin', 'beat its own null set — tuning-slice $ at least, %', 'num', 'hides rows whose tuning-slice $ beat less than this share of their null set. Empty hides nothing.'],
    ['leadMoneyMin', 'lead over null set — tuning-slice $ at least', 'num', 'hides rows whose tuning-slice $ lead over their null set is below this. Empty hides nothing.'],
    ['s1rankMax', 'stage 1 order at most', 'num', 'hides rows that placed lower than this at stage 1. Empty hides nothing.'],
  ])}
    <div class="scrollx"><table style="border-collapse:collapse">
      <thead><tr style="text-align:left;border-bottom:1px solid var(--line)">
        <th ${bth.replace('.3rem .5rem', '.3rem .5rem .3rem 0')} title="ticks every record on this page, or clears them. Picks save on this record set, and the stage 3 set-up on Sweep prices exactly the picked records when its records to price says Selected records."><input type="checkbox" data-bpickpage="S2"${rows.length && rows.every((r) => picked.has(r.u)) ? ' checked' : ''}></th>
        <th ${bth} title="this unit's place under the sort picked on the columns — settled before any filter, so it still says where the row stands in the whole set.">stage 2 order</th>
        <th ${bth} title="where the same unit ranked at stage 1">stage 1 order${bSortBtn(doc, 's1rank', 'asc')}</th>
        <th ${bth} title="the traded coin. Anything listed under alongside is context only — read against, never bought or sold.">coin${bSortBtn(doc, 'trade', 'asc')}</th>
        <th ${bth} title="the one or two coins this unit is read against — blank for a coin judged on its own">alongside${bSortBtn(doc, 'ctx', 'asc')}</th>
        <th ${bth} title="how long a stretch of prices each decision looks at, and how often a decision is made — fixed when the unit was trained.">chunk shape${bSortBtn(doc, 'geometry', 'asc')}</th>
        <th ${bth} title="how many members vote for this unit now, and what they are">members${bSortBtn(doc, 'members', 'desc')}</th>
        <th ${bth} title="how many of those members are INDEPENDENT. Members that call the same way almost every time count as one voice however differently they were built. The figure in brackets is what it was before the BOOST members joined, so what the fuller board bought in real opinions is visible here.">independent voices${bSortBtn(doc, 'voices', 'desc')}</th>
        <th ${bth} title="the unit's forecast score with only the stage 1 members pooled">forecast score — stage 1 members${bSortBtn(doc, 'score3', 'desc')}</th>
        <th ${bth} title="the same fixed score with every member pooled, BOOST included">forecast score — all members${bSortBtn(doc, 'scoreAll', 'desc')}</th>
        <th ${bth} title="all-members score minus stage-1-members score — what the BOOST members bought, before any pricing">fuller board helped?${bSortBtn(doc, 'helped', 'desc')}</th>
        <th ${bth} title="the stage 1 members' own votes on the tuning slice — the last quarter of the training window — priced one buy or sell per chunk in the direction they lean, at the fee the parent declared. Read again here, and it must equal the parent's figure to the cent or the unit is refused.">tuning-slice $ — stage 1 members${bSortBtn(doc, 'money3', 'desc')}</th>
        <th ${bth} title="the same pricing with every member pooled, BOOST included — what the fuller board bought in money, before any test-window pricing">tuning-slice $ — all members${bSortBtn(doc, 'moneyAll', 'desc')}</th>
        <th ${bth} title="of its null set — the parent's own deals, dealt again here: the same votes with the calendar shuffled away — how many the forecast score of EVERY member on this row beat, BOOST included">beat its own null set${bSortBtn(doc, 'beat', 'desc')}</th>
        <th ${bth} title="how far above its null set's typical forecast score the real one sits, against the null set's own spread — every member on the row">lead over null set${bSortBtn(doc, 'lead', 'desc')}</th>
        <th ${bth} title="of its null set — the same votes dealt onto other days of the tuning slice — how many this row's tuning-slice $ with every member pooled beat">beat its own null set — tuning-slice $${bSortBtn(doc, 'beatMoney', 'desc')}</th>
        <th ${bth} title="how far above its null set's typical tuning-slice $ the real one sits, against the null set's own spread — every member pooled">lead over null set — tuning-slice $${bSortBtn(doc, 'leadMoney', 'desc')}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td ${btdN0}><input type="checkbox" data-bpick="S2:${r.u}"${picked.has(r.u) ? ' checked' : ''} title="picks this record. Saved on this record set the moment it changes."></td>
        <td ${btdN}>${Number(r.rank).toLocaleString()}</td>
        <td ${btdN}>${r.s1rank == null ? '—' : Number(r.s1rank).toLocaleString()}</td>
        <td ${btdN}>${bCoin(r)}</td>
        <td ${btdN}${r.ctx1 ? '' : ' class="muted"'}>${r.ctx1 ? esc([r.ctx1, r.ctx2].filter(Boolean).join(' + ')) : '—'}</td>
        <td ${btdN}>${esc(bGeo(r.geometry))}</td>
        <td ${btdN}>${r.members} — ${r.logreg} LOGREG + ${r.boost} BOOST</td>
        <td ${btdN}${r.voices != null && r.members && r.voices < r.members ? ' class="warn"' : ''}>${r.voices == null ? '—' : r.voices}${r.voices3 == null ? '' : ` <span class="muted">(${r.voices3} before BOOST)</span>`}</td>
        <td ${btdN}>${r.score3 == null ? '—' : r.score3.toFixed(1)}</td>
        <td ${btdN}>${r.scoreAll == null ? '—' : r.scoreAll.toFixed(1)}</td>
        <td ${btdN}>${r.helped == null ? '—' : `<span class="${r.helped >= 0 ? 'pos' : 'neg'}">${r.helped >= 0 ? '+' : ''}${r.helped.toFixed(1)}</span>`}</td>
        <td ${btdN}>${bMoney(r.money3)}</td>
        <td ${btdN}>${bMoney(r.moneyAll)}</td>
        <td ${btdN}>${bShare(r.pairs ? r.beat / r.pairs : null, r.beat, r.pairs)}</td>
        <td ${btdN}>${bLead(r.lead)}</td>
        <td ${btdN}>${bShare(r.pairs && r.beatMoney != null ? r.beatMoney / r.pairs : null, r.beatMoney, r.pairs)}</td>
        <td ${btdN}>${bLead(r.leadMoney)}</td></tr>`).join('') || '<tr><td colspan="17" class="empty">nothing here</td></tr>'}</tbody></table></div>
    ${bShown(t)}
    ${bPager((t && t.total) || 0, from, 100, 'S2')}
    <p class="note"><b data-bpickcount="S2">${picked.size.toLocaleString()}</b> picked on this record set
      <button data-bpickclear="S2"${picked.size ? '' : ' disabled'} title="clears every pick on this record set, on every page">clear picks</button>
      <span>- tick records to pick them; the stage 3 set-up on Sweep prices exactly the picked records when its records to price says Selected records.</span></p>
    <p class="note">Ordered by the sort picked on the columns — saved on this record set, and exactly what a stage 3
      carry forward takes the top of. With nothing picked: forecast score — all members, best first; ties keep their
      carry order either way. Independent voices below members means some members are near-copies; if the BOOST
      members added members without adding voices, this is where that shows. The tuning-slice $ columns are the only
      money here: the members' own votes on the last quarter of the training window, stage 1 members alone and every
      member pooled, so what the BOOST members bought in money is visible before any pricing. Test-window money and the
      held-back window belong to stage 3.</p>
  </div>`)) return;
  bWirePager(mount);
  bWireSort(doc, mount);
  bWirePicks(doc, mount, t);
  // the set goes down with the wiring: these filters save on it, because the
  // stage 3 carry reads them
  bWireFilters(mount, doc);
  bWireTableFold(mount);
}

// PICKING RECORDS (owner order, 2026-09-02): a tick on the left of every
// record on the stage 2 table. The ticks save on the record set the moment
// they change, exactly as a column sort does, because the stage 3 set-up
// prices them. The count line, the clear button and the page's own tick
// follow without redrawing the table; a save that fails puts the tick back.
function bWirePicks(doc, root, t) {
  if (!$(root)) return;   // the mount went with a redraw; the newer draw wires its own
  const have = () => new Set((t && t.picked) || []);
  const uOf = (el) => Number(el.dataset.bpick.split(':')[1]);
  const boxes = () => [...$(root).querySelectorAll('[data-bpick]')];
  const save = async (next) => {
    const out = await tryPost(`api/stageset/${encodeURIComponent(doc.id)}/picked`, { picked: [...next] });
    if (!out) return false;
    t.picked = out.picked;
    const c = $(root).querySelector('[data-bpickcount]'); if (c) c.textContent = out.picked.length.toLocaleString();
    const b = $(root).querySelector('[data-bpickclear]'); if (b) b.disabled = !out.picked.length;
    const all = $(root).querySelector('[data-bpickpage]');
    if (all) all.checked = boxes().length > 0 && boxes().every((x) => x.checked);
    return true;
  };
  boxes().forEach((cb) => {
    cb.onchange = async () => {
      const next = have();
      if (cb.checked) next.add(uOf(cb)); else next.delete(uOf(cb));
      if (!(await save(next))) cb.checked = !cb.checked;
    };
  });
  const all = $(root).querySelector('[data-bpickpage]');
  if (all) all.onchange = async () => {
    const next = have();
    for (const x of boxes()) { if (all.checked) next.add(uOf(x)); else next.delete(uOf(x)); }
    if (await save(next)) boxes().forEach((x) => { x.checked = all.checked; });
    else all.checked = !all.checked;
  };
  const clear = $(root).querySelector('[data-bpickclear]');
  if (clear) clear.onclick = async () => {
    if (await save(new Set())) boxes().forEach((x) => { x.checked = false; });
  };
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
  const [ranked, coins, gap, filling, dropping, undoing] = await Promise.all([
    apiOr(`api/stageset/${doc.id}/ranked?${rankQs}`, null),
    apiOr(`api/stageset/${doc.id}/coins?${qs}`, null),
    apiOr(`api/stageset/${doc.id}/missing`, null),
    apiOr(`api/stageset/${doc.id}/fill-in/status`, null),
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
        <td ${btd}>${bShare(r.pairs ? r.beat / r.pairs : null, r.beat, r.pairs)}</td>
        <td ${btd}>${r.noisePairs ? bShare(r.beatNoise / r.noisePairs, r.beatNoise, r.noisePairs) : '<span class="muted">—</span>'}</td>
        <td ${btd}>${bLead(r.avgLead)}</td>
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
        <th ${bth} title="the traded coin and the chunk shape it was priced at, and under them the one or two coins it is read alongside, on rows that have any. All of it is in this one cell, and the row is one setting on one coin at one chunk shape. What is listed after alongside is context only — read against, never bought or sold. Same word, same meaning, as the alongside column on the two tables above.">coin + chunk shape + alongside${bCoinSortBtn(view, 'coin', '↑')}</th>
        <th ${bth} title="of the head-to-heads between this coin's held-back money and its null-set deals, the share it won.">beat its own null set${bCoinSortBtn(view, 'share', '↓')}</th>
        <th ${bth} title="of the kept scrambled copies of this whole table, how many this row's avg test $ beat. Two things make it different from beat its own null set: it reads TEST money, not held-back, so nothing here opens the sealed window; and each copy is the WHOLE table scrambled the same way, so a row has to beat what the shuffle managed across every setting, not just its own scrambled twins. Empty on a set that kept none - set null set money kept on Sweep before the run.">beat the kept null money${bCoinSortBtn(view, 'beatnoise', '↓')}</th>
        <th ${bth} title="how many head-to-heads the share rests on.">comparisons${bCoinSortBtn(view, 'pairs', '↓')}</th>
        <th ${bth} title="average test-window money per record — flattering by construction, because the carry was ordered on that window.">avg test $${bCoinSortBtn(view, 'test', '↓')}</th>
        <th ${bth} title="average held-back money per record.">avg held-back${bCoinSortBtn(view, 'money', '↓')}</th>
        <th ${bth} title="average held-back entries per record.">avg trades${bCoinSortBtn(view, 'trades', '↓')}</th>
        <th ${bth} title="average held-back money minus just holding the coin over the same window.">avg vs always-long${bCoinSortBtn(view, 'vslong', '↓')}</th>
        <th ${bth} title="what ACTUALLY agreed at the moments this coin's records spoke, averaged over the records underneath. Every rule fires at or above its bar, so this sits at the share or above it. Measured on the test window.">share that agreed${bCoinSortBtn(view, 'agreed', '↓')}</th>
        <th ${bth} title="how many records this row averages — one per decision, band and 24/5 variant of the setting that this coin's units hold; a unit holds only the variants that place different orders on it.">rows${bCoinSortBtn(view, 'rows', '↓')}</th>
        <th ${bth} title="opens the records themselves below the row.">records</th></tr></thead>
      <tbody id="bCoinBody">${cr.map((r) => {
    const k = keyOf(r);
    return `<tr data-bkey="${esc(k)}">
        <td ${btd0}>${esc(r.cellLabel)}</td>
        <td ${btd}>${bCoin(r)} <span class="muted">${esc(bGeo(r.geometry))}</span>${bAlso(r)}</td>
        <td ${btd}>${bShare(r.share, r.beat, r.pairs)}</td>
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
  if ((filling && filling.running)
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
          <td style="padding:.2rem .5rem">${bShare(r.pairs ? r.beat / r.pairs : null, r.beat, r.pairs)}</td>
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
  regionPapered: 'the region was widened over settings that lost money',
  losesToBuyHold: 'the settings it keeps made less than buying the coin and going away',
  losesToShortHold: 'the settings it keeps made less than shorting the coin and going away',
  regionAcross: 'the region was joined across dials whose values are words, which have no order',
  regionReach: 'the region was joined over settings missing from the board',
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
// THE BAR AND THE TARGET STAY WHERE THEY ARE LEFT, FOR THE WHOLE SET (owner
// order, 2026-09-04: "i put it on 75% and every single selection you set it
// back to 80%"). Both sit on the standing line above every unit's walk, so
// they are remembered once per set and every unit's walk reads them from
// there; the walk's own copy is what the read, the across and the cut post.
const fSetKeyFor = (set) => `cx-funnel-set-${set}`;
function fSetMemory(set) {
  try { return JSON.parse(localStorage.getItem(fSetKeyFor(set)) || 'null') || {}; } catch (_) { return {}; }
}
function fRememberForSet(set, fields) {
  try { localStorage.setItem(fSetKeyFor(set), JSON.stringify({ ...fSetMemory(set), ...fields })); } catch (_) { /* private window */ }
}
// WHAT A READING OF THE OTHER UNITS WAS READ FOR: the rule AND the bar. The
// same rule under another share of the copies is another reading.
const fAcrossKey = (st) => JSON.stringify([st.rule, st.barPct == null ? null : st.barPct]);
// WHAT A CROSSES READING IS HELD UNDER (§18.4): the rule, the bar AND the thin
// floor, because the floor decides which squares count and so changes every
// block on every pair. A reading whose key has moved is not shown -- a list
// worked out under a rule that no longer holds is worse than no list.
const fCrossKey = (st) => JSON.stringify([st.rule, st.barPct == null ? null : st.barPct, Math.max(0, Math.floor(Number(st.floor) || 0))]);
const fSecs = (ms) => (ms == null || !Number.isFinite(Number(ms)) ? '-'
  : (ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} second(s)` : `${Math.round(ms / 60000)} minute(s)`));
function fLoad() {
  const set = pickedSet3();
  const unit = fUnitChosen(set);
  if (fState && fState.set === set && (fState.unit || null) === unit) return fState;
  let saved = null;
  if (unit) { try { saved = JSON.parse(localStorage.getItem(fWalkKeyFor(set, unit)) || 'null'); } catch (_) { saved = null; } }
  // a walk saved while the bar was a count holds that count; it is dropped
  // for the default share rather than read as a percent
  if (saved && 'bar' in saved) delete saved.bar;
  fState = (saved && saved.set === set) ? { ...saved, unit }
    : { set, unit, step: 1, rule: { ranges: {}, allowed: {}, floors: {} }, target: null,
      dial: null, dialA: null, dialB: null, floor: 20, steps: [], backSteps: [], rebuilt: false, rebuiltSaid: null,
      closing: { key: 'rule' }, marks: [], pick: null, leaders: [], conditions: {}, across: null, barPct: null };
  // the set's own bar and target win over whatever this unit's walk last saw
  const shared = fSetMemory(set);
  if (shared.barPct !== undefined) fState.barPct = shared.barPct;
  if (shared.target !== undefined) fState.target = shared.target;
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
      barPct: st.barPct,                                    // null: the engine's default share of the copies
      regionAtLeast: st.regionAtLeast,                      // step 5's bar; 0 is "made money", below 0 papers over dips
      regionReach: st.regionReach,                          // how far one step may reach; 1 is neighbours only
      regionAcross: st.regionAcross,                        // word-valued dials the region may step across
      // showing a Stage 4 record set: no step is drawn, so no step is read
      view: (st.cut && st.cut !== F_NEW) ? 'cut' : null,
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
    // what is being worked out, in the totalling's own words -- the phase,
    // the count -- and the page asks again, as Boards does
    const tp = d.totalling && typeof d.totalling === 'object' ? d.totalling : null;
    const said = tp
      ? `${tp.phase || 'totalling the tables'}: ${Number(tp.done || 0).toLocaleString()} of ${Number(tp.total || 0).toLocaleString()} ${tp.word || 'parts'}`
      : String(d.totalling || d.waiting);
    $('#view').innerHTML = `<div class="panel"><h3 style="margin-top:0">Funnel</h3>
      <p class="note">${d.totalling ? 'the tables for this set are being worked out - ' : ''}<b>${esc(said)}</b> - this page asks again in a few seconds</p></div>`;
    setTimeout(() => { if (tab === 'funnel') drawFunnel(); }, 4000);
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
  // A COIN AND SHAPE WITH STAGE 4 RECORD SETS OPENS ON ONE (3.58.0, owner order):
  // the drop-down replaces the rule-building heading, and `new rule` puts the
  // seven steps back. Nothing chosen yet lands on the newest set.
  // `new rule` is never overridden here: fCutChosen answers null for it, so the
  // only case that lands on a set by itself is a coin and shape never chosen on.
  const cutId = fCutChosen(st, d);
  if (cutId && !st.cut) { st.cut = cutId; fSave(); return drawFunnel(); }
  if (!cutId && st.cut && st.cut !== F_NEW) { st.cut = F_NEW; fSave(); return drawFunnel(); }
  if (cutId) {
    if (cutId !== st.cut) { st.cut = cutId; fSave(); }
    return fDrawCut(d, st, cutId);
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
  const a4 = st.across && st.across.ruleKey === fAcrossKey(st) ? st.across : null;
  st.read = {
    groups: d.step === 2 && Array.isArray(r.groups) ? r.groups.map((g) => [String(g.value), g.n]) : null,
    grid: d.step === 3 && r.grid ? { aVals: r.aVals, bVals: r.bVals, block: (r.block || {}).block || null } : null,
    accept: d.step === 4 && r.pressed
      ? (a4 ? { positive: a4.positive, of: a4.of, check: null, clearBar: a4.clearBar } : null)
      : (d.step === 4 && !r.why ? { positive: r.positive, of: r.of, check: r.check || null } : null),
    keep: d.step === 5 && r.keep ? { ranges: r.keep.ranges || {}, allowed: r.keep.allowed || {} } : null,
  };
  $('#view').innerHTML = `<div class="panel">${fTitle(d, st, F_NEW_NAME)}</div>
  <div class="panel">${fHead(d)}${fRail(d, st)}</div>
  <div class="panel">
    <h3 style="margin-top:0">Step ${d.step} - ${esc(F_STEPS[d.step - 1][0])}</h3>
    <p class="note">${esc(F_STEPS[d.step - 1][1])}</p>
    ${d.step <= 5 ? fCheckLine(d) : ''}
    ${r.why && d.step !== 2 ? `<p class="note neg">${esc(r.why)}</p>`
    : (d.step === 1 ? fStep1(r) : d.step === 2 ? fStep2(r, st) : d.step === 3 ? fStep3(r, st)
      : d.step === 4 ? fStep4(r, st) : d.step === 5 ? fStep5(r, d, st) : d.step === 6 ? fStep6(d, st, r) : fStep7(d, st))}
    ${fNoiseLine(r, d)}
  </div>
  <div class="panel">${fRuleBox(d, st)}</div>`;
  fWire(st, d);
}

// THE COIN AND SHAPE BOX, drawn by ONE function (3.58.0). The walk's heading and
// the Stage 4 record set view both carry it, and two copies of a control is how
// the two screens come to offer different boards.
//
// ONE BOX PER PART (3.80.0, owner order 2026-09-07: "allow the coin and shape
// selector to have 3 fields above coin, alongside1, alongside2 ... we need to
// be able to type those in or drop them down (even better) to select the
// actual coin and shape"). It was a single list of every joined-up name --
// "LTCUSDT alongside BTCUSDT and ETHUSDT weekly-8d" and hundreds like it -- so
// picking a known coin at a known shape meant reading the whole list to find
// the one line that said it. Four boxes ask for the four things the owner
// already has in mind.
//
// EVERY LIST IS WHAT THE SET ACTUALLY HOLDS, narrowed by the boxes to its left
// (RULE FIVE). Nothing is offered that would land on no board, and nothing the
// set holds is left out.
// A MISSING REPLY IS NO BOARD, NEVER AN EXCEPTION (3.80.1). Written as
// `d.units` this threw the moment one of the two callers of fWireUnit was
// missed, and a throw here takes down every control wired after it -- the
// whole walk, from one box.
const fUnitOf = (d, key) => ((d || {}).units || []).find((u) => u.key === key) || null;
// The choice narrowed left to right: each box is honoured if the set has
// anything matching it, and simply dropped if it does not, so no combination
// of presses can land on a board that is not there.
function fUnitResolve(d, want) {
  let rows = ((d || {}).units || []).filter((u) => u.trade === want.trade);
  for (const [field, val] of [['ctx1', want.ctx1], ['ctx2', want.ctx2], ['geometry', want.geometry]]) {
    const next = rows.filter((u) => (u[field] || '') === (val || ''));
    if (next.length) rows = next;
  }
  return rows[0] ? rows[0].key : null;
}
const F_UNIT_NONE = '— none —';
function fUnitPicker(d) {
  const units = d.units || [];
  const cur = fUnitOf(d, d.unit);
  // in the order the set lists its units, which is the stage 2 table's order
  const only = (rows, field) => {
    const out = [];
    for (const u of rows) { const v = u[field] || ''; if (!out.includes(v)) out.push(v); }
    return out;
  };
  const opts = (values, chosen) => (values.length ? values : ['']).map((v) => `<option value="${esc(v)}"${v === chosen ? ' selected' : ''}>${esc(v || F_UNIT_NONE)}</option>`).join('');
  // a box with nothing to offer is DEAD ON SCREEN rather than silently doing
  // nothing when it is pressed (RULE FOUR's sibling: a control that looks live
  // and is not is worse than one that looks dead)
  const dead = (values) => (values.length ? '' : ' disabled');

  const onCoin = cur ? units.filter((u) => u.trade === cur.trade) : [];
  const on1 = cur ? onCoin.filter((u) => (u.ctx1 || '') === (cur.ctx1 || '')) : [];
  const on2 = cur ? on1.filter((u) => (u.ctx2 || '') === (cur.ctx2 || '')) : [];
  const a1 = cur ? only(onCoin, 'ctx1') : [];
  const a2 = cur ? only(on1, 'ctx2') : [];
  const geoms = cur ? only(on2, 'geometry') : [];

  // EVERY id IS WRITTEN OUT, never assembled (found 2026-09-07). Built through
  // a shared box() helper they were invisible to every check that reads this
  // file as text -- the Help tab's "nothing is described that does not exist",
  // and the closed word list, which is the only vocabulary allowed about a
  // screen. A control no source scan can see is a control outside RULE ONE-A.
  return `<label class="f" title="which board the steps below are walked on. all units together blends every coin and shape in the set into one board; anything else is one coin at one chunk shape, read alongside the coins named beside it.">coin<select id="fUnit"><option value="all"${cur ? '' : ' selected'}>all units together</option>${
    only(units, 'trade').map((c) => `<option value="${esc(c)}"${cur && c === cur.trade ? ' selected' : ''}>${esc(c)}</option>`).join('')
  }</select></label>
    <label class="f" title="the first coin this one is read against — context only, never bought or sold. — none — is the coin judged on its own. Only what the set holds beside the coin chosen is offered.">alongside 1<select id="fUnitA1"${dead(a1)}>${opts(a1, cur ? (cur.ctx1 || '') : '')}</select></label>
    <label class="f" title="the second coin this one is read against — context only, never bought or sold. — none — is the coin read against one other, or on its own.">alongside 2<select id="fUnitA2"${dead(a2)}>${opts(a2, cur ? (cur.ctx2 || '') : '')}</select></label>
    <label class="f" title="how long a stretch of prices each decision looks at, and how often a decision is made — fixed when the unit was trained, so only the shapes the set holds for the coins chosen beside it are offered.">chunk shape<select id="fUnitGeom"${dead(geoms)}>${opts(geoms, cur ? cur.geometry : '')}</select></label>`;
}

// The standing line. Which set, how many survive against the target, and -
// NAMED rather than left blank - whether a noise comparison exists at all and
// whether the sealed window is intact. A missing comparison shown as nothing
// reads as 'nothing to report', which is the opposite of the truth.
const fPct = (x) => (x == null ? '-' : `${Math.round(Number(x) * 100)}%`);
// WHAT THIS BOARD HAS TO BEAT BESIDES A SHUFFLE (3.70.0, owner order).
// The scrambled copies only ask whether a reading beats noise. They never ask
// whether it beats the obvious thing, and buying the coin and going away IS
// the obvious thing -- so a rule can clear every copy and still be the worse
// of two choices. Printed before any narrowing, so a board where there is
// nothing to find can be left alone instead of walked.
const fMoneySpan = (c) => (!c ? '-' : (Math.abs(c.hi - c.lo) < 0.005
  ? `<b>${fFix(c.lo, 2)}</b>` : `<b>${fFix(c.lo, 2)}</b> to <b>${fFix(c.hi, 2)}</b>`));
function fAgainst(a, what) {
  if (!a || !a.known) {
    return `<p class="note muted">What ${esc(what)} would have to beat besides the scrambled copies is not known here -
      ${esc(String((a && a.why) || 'nothing was kept'))}.</p>`;
  }
  const many = (a.keys || []).length > 1;
  const lost = [];
  if (a.beatsBuyHold === false) lost.push('buying the coin and going away');
  if (a.beatsShortHold === false) lost.push('shorting the coin and going away');
  return `<p class="note${lost.length ? ' neg' : ''}">On the held-back window, ${esc(what)} made
      <b>${fFix(a.real, 2)}</b> a setting. Buying the coin and going away made ${fMoneySpan(a.buyHold)};
      shorting it and going away made ${fMoneySpan(a.shortHold)}; being long every period made
      ${fMoneySpan(a.alwaysLong)}; being short every period made ${fMoneySpan(a.alwaysShort)}.${many
    ? ` These settings use ${a.keys.length} different hold lengths, so each is a span across them and beaten means beaten at the worst of them.` : ''}
      ${lost.length ? `<b>It made less than ${esc(lost.join(' and '))}</b>, so there is a simpler thing that did better.` : ''}</p>`;
}
function fHead(d) {
  const c = d.check || {};
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
      <span class="note"><b>${Number(d.survivors).toLocaleString()}</b> of
      ${Number(d.of).toLocaleString()} settings survive${d.target ? ` and the target is ${Number(d.target).toLocaleString()}` : ''}</span>
      <label class="f">target size<input id="fTarget" type="number" min="0" style="width:6rem"
        value="${d.target == null ? '' : d.target}"></label>
      ${c.kind === 'scrambles' ? `<label class="f">bold when a value beats at least<input id="fBar" type="number" min="1" max="100" step="1" style="width:4.5rem"
        value="${c.barPct}"></label>
      <span class="note">% of the <b>${c.k}</b> copies - that is <b>${c.bar}</b> of them - by chance about <b>${fPct(c.chance)}</b> of values would</span>` : ''}</div>
    ${fAgainst((d.against || {}).board, 'every setting on this board')}
    ${fAgainst((d.against || {}).keeping, 'the settings this rule keeps')}
    <p class="note">${n.available ? `This set carries ${Number(d.set.keptScrambles || n.kept || 0)} scrambled copies of the whole table, each one the same days in a jumbled order. Every step below is read once against the real table and again against each of those, and the second reading is drawn beside the first.`
    : `<b>No scrambled copies on this set</b> - ${esc(String(n.why || 'not captured'))}. Every step below is read
       against the two halves of the settings instead, which tests whether a reading is STABLE and never whether the effect is real.`}</p>
    <p class="note">${sealed.sealed
    ? `The sealed window is intact on all ${(sealed.units || []).length} unit(s): unread from ${fDayOf(sealed.fromTs)} onward - the box holds data to ${fDayOf(sealed.dataToTs)}, and all of it counts as unread.`
    : `<b>No sealed window</b> - ${esc(String(sealed.why || 'not recorded'))}`}</p>`;
}

// a timestamp as the day it falls on, for the sealed window's two ends
const fDayOf = (ts) => (Number.isFinite(Number(ts)) && ts != null ? new Date(Number(ts)).toISOString().slice(0, 10) : '?');
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
      A value counts when it beats at least <b>${c.bar}</b> of them, your <b>${c.barPct}%</b>; with no forecast at all about <b>${fPct(c.chance)}</b> of values
      would clear that bar.</p>`;
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
  const h = r.honesty || null;
  return `${h ? `<p class="note"><b>${h.clear} of ${h.of}</b> values clear the bar on this board; by chance about
      <b>${h.byChance == null ? '-' : Math.round(h.byChance)}</b> would.</p>` : ''}<p class="note">How far apart a dial's values sit, against how much the result varies anyway.
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
  const pick = `<label class="f">dial<select id="fDial">${fDialOptions(st.dial || '')}</select></label>`;
  if (!r.groups || !r.groups.length) {
    // THE DIAL BOX STAYS whatever the reason: a dial the rule has already fixed
    // has no shape to read, and the box is how the next one is picked (owner,
    // 2026-09-04: "there's nothing i can do to narrow another candidate")
    return `<div class="row">${pick}</div><p class="note${r.why ? ' neg' : ''}">${esc(r.why || 'pick a dial to read its shape')}</p>`;
  }
  const sh = r.splitHalf || {};
  const rec = r.rec || {};
  const kind = rec.kind || (r.noise || {}).kind;
  const byVal = new Map((rec.values || []).map((v) => [String(v.value), v]));
  const checkOf = (v) => {
    const c = v && v.check ? v.check.filter((x) => x != null) : [];
    if (!c.length) return '-';
    if (kind === 'halves') return v.check.map((x) => fFix(x)).join(' / ');
    return `${fFix(Math.min(...c))} to ${fFix(Math.max(...c))} - beats ${v.beaten == null ? '-' : v.beaten} of ${c.length}${v.lead == null ? '' : ` - lead ${Number(v.lead).toFixed(1)}`}`;
  };
  // WHAT IS PRE-FILLED: the range already in the rule for this dial, else the
  // recommendation. Either way the boxes show where the count line comes from.
  const have = (st.rule.ranges || {})[st.dial] || {};
  const rr = rec.recommend || {};
  // NONE ON ITS OWN IS A CLAUSE OF ITS OWN (3.62.0, owner order): it is kept as
  // a VALUE, not as a range with no ends, because that is what it is -- the
  // settings that have no value for this dial at all. The boxes show blank for
  // it, or the screen would offer back a range the rule does not hold.
  const noneAlone = ((st.rule.allowed || {})[st.dial] || []).map(String).join(',') === 'none';
  const lo = noneAlone ? '' : (have.min != null ? have.min : (rr.min != null ? rr.min : ''));
  const hi = noneAlone ? '' : (have.max != null ? have.max : (rr.max != null ? rr.max : ''));
  // A DIAL SOME SETTINGS HAVE NO VALUE FOR (3.53.0, owner order 2026-09-04:
  // "how can the range 0.5-none be selected"): a market entry carries no d,
  // and "none" is not a number, so a range alone drops every such setting.
  // The rule has always been able to say "or none"; now the screen can.
  const hasNone = r.groups.some((g) => String(g.value) === 'none');
  const alsoNone = noneAlone || (Array.isArray(have.also) && have.also.map(String).includes('none'));
  const total = r.groups.reduce((a, g) => a + g.n, 0);
  // both boxes clear with the tick on means NONE AND NOTHING ELSE
  const onlyNone = hasNone && alsoNone && lo === '' && hi === '';
  const inRange = (val) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return String(val) === 'none' && alsoNone;
    return !onlyNone && (lo === '' || n >= Number(lo)) && (hi === '' || n <= Number(hi));
  };
  const keptByRange = rec.ordered === false ? null : r.groups.filter((g) => inRange(g.value)).reduce((a, g) => a + g.n, 0);
  // a LIST of values, from the rule or the recommendation -- never anything
  // else, whatever else rides under those names
  const kept = (st.rule.allowed || {})[st.dial];
  const chosen = new Set((Array.isArray(kept) ? kept : (Array.isArray(rr.values) ? rr.values : [])).map(String));
  const keptByValues = rec.ordered === false ? r.groups.filter((g) => chosen.has(String(g.value))).reduce((a, g) => a + g.n, 0) : null;
  return `<div class="row">${pick}</div>
    <p class="note">shape: <b>${esc(r.shape)}</b>, and the two halves read ${esc(String(sh.a))} and
      ${esc(String(sh.b))} - ${sh.agrees ? 'they agree' : '<b class="neg">they do not agree</b>'}</p>
    ${r.shape === 'spike' ? `<p class="note warn"><b>A spike is the shape a shuffle makes.</b> One value far clear of an
      otherwise flat menu is what a fluke looks like; a hill or a ramp is a relationship.</p>` : ''}
    <table><thead><tr>${cth('value', 'fValue')}${cth('settings', 'fSettings')}${cth('avg test', 'fAvgTest')}${cth('check', 'fCheck')}</tr></thead>
      <tbody>${r.groups.map((g) => { const v = byVal.get(String(g.value)); return `<tr class="${v && v.counts === false ? 'dim' : (v && v.counts ? 'cnt' : '')}"><td>${esc(g.value)}</td><td>${g.n}</td><td>${fFix(g.mean)}</td><td>${esc(checkOf(v))}</td></tr>`; }).join('')}</tbody></table>
    <p class="note"><b>Recommended:</b> ${rr.min != null ? `keep ${esc(String(rr.min))} to ${esc(String(rr.max))} - the widest run of neighbouring values that beat the check`
    : (Array.isArray(rr.values) && rr.values.length ? `keep ${esc(rr.values.join(', '))} - every value that beats the check`
      : `nothing - ${esc(rec.why || 'no value beats the check')}. A range can still be kept; it is then a choice the check did not support, and the set will say so.`)}</p>
    ${rec.ordered === false
    ? `<div class="row" style="align-items:flex-end;margin-top:.5rem">
        ${r.groups.map((g) => `<label class="c"><input type="checkbox" data-fval="${esc(String(g.value))}" ${chosen.has(String(g.value)) ? 'checked' : ''}> ${esc(String(g.value))}</label>`).join('')}
        <button id="fKeepValues" class="pri">keep these values</button>
        <span class="note" id="fKeepCount">keeps ${Number(keptByValues).toLocaleString()} of ${Number(total).toLocaleString()}${st.target ? ` - target ${Number(st.target).toLocaleString()}` : ''}</span></div>`
    : `<div class="row" style="align-items:flex-end;margin-top:.5rem">
        <label class="f">keep from<input id="fMin" style="width:7rem" value="${esc(String(lo))}"></label>
        <label class="f">to<input id="fMax" style="width:7rem" value="${esc(String(hi))}"></label>
        ${hasNone ? `<label class="c"><input type="checkbox" id="fAlsoNone" ${alsoNone ? 'checked' : ''}> also keep none</label>` : ''}
        <button id="fAddRange" class="pri">add this range to the rule</button>
        <span class="note" id="fKeepCount">keeps ${Number(keptByRange).toLocaleString()} of ${Number(total).toLocaleString()}${st.target ? ` - target ${Number(st.target).toLocaleString()}` : ''}</span>
        <span class="note">a RANGE, never a value - picking the peak is the shopping this walk exists to avoid</span></div>
      ${hasNone ? `<p class="note"><b>To keep none and nothing else:</b> clear both boxes, tick <b>also keep none</b>, and press
        <b>add this range to the rule</b>. The count beside the button says what that leaves before you press it.
        <b>none</b> is the one value that can be kept on its own here: it is not a point on this dial's scale, it is the
        settings that have no ${esc(fDialLabel(st.dial))} at all, so keeping it is choosing a kind of setting rather
        than picking a peak. The rule then reads <b>${esc(fDialLabel(st.dial))} is none</b>.</p>` : ''}`}`;
}

// WHICH CROSSES ARE WORTH READING (§18, owner order 2026-09-04). Always on the
// screen, above the two pickers; the switch and the button start it. It lists
// only the pairs that say something the two single-dial ranges cannot, scored
// on how many of the scrambled copies each block beats -- never on money.
function fCrosses(r, st) {
  const off = r.crossesOffer || {};
  const key = fCrossKey(st);
  const held = st.crosses && st.crosses.key === key ? st.crosses.result : null;
  const going = st.crossesAsked && st.crossesAsked.key === key;
  const head = `<div class="row" style="align-items:flex-end">
      <label class="c"><input type="checkbox" id="fCrossOn" ${st.crossesOn ? 'checked' : ''}> keep this list up to date</label>
      <button id="fCrosses" ${going ? 'disabled' : ''}>read every pair</button>
      <span class="note" id="fCrossMsg">${going ? 'starting' : ''}</span></div>`;
  const cost = `<p class="note"><b>${Number(off.dials ? off.dials.length : 0)}</b> dial(s) still vary across the
      <b>${Number(off.rows || 0).toLocaleString()}</b> settings your rule keeps, which is <b>${Number(off.pairs || 0)}</b>
      pair(s) to read. On this box that is about <b>${fSecs(off.msAll)}</b>${off.k ? ` - each pair is read once for real and once against each of the ${off.k} scrambled copies` : ''}.
      Nothing here is ranked by money: a block is scored only on how many of those copies it beats.</p>`;
  if (going) {
    return `${head}${cost}<p class="note">reading them now - this page follows it and shows the list when it is done.</p>`;
  }
  const failed = st.crossesFailed && st.crossesFailed.key === key ? st.crossesFailed.why : null;
  if (failed) {
    return `${head}${cost}<p class="note neg">The last reading of these pairs failed: ${esc(failed)}. Press
      <b>read every pair</b> to try again - it is not started again by itself, or a reading that cannot work would
      be started on every draw.</p>`;
  }
  if (!held) {
    return `${head}${cost}<p class="note">Press <b>read every pair</b> for the list, or tick
      <b>keep this list up to date</b> and it is read again by itself every time your rule changes.</p>`;
  }
  const list = held.crosses || [];
  // THE COUNT LINE STAYS WHEN NOTHING IS FOUND (owner, 2026-09-04): silence and
  // "nothing found" look identical otherwise.
  const counted = `<p class="note"><b>${Number(held.read || 0)}</b> pair(s) read, <b>${list.length}</b> of them
      say something the two single-dial ranges cannot${list.length ? '' : ' - none of these dials interact on this board'}.</p>`;
  if (!list.length) return `${head}${counted}`;
  return `${head}${counted}
    <table><thead><tr>${cth('cross', 'fCrossPair')}${cth('the block it finds', 'fCrossBlock')}${cth('squares', 'fCrossSquares')}${cth('beats', 'fCrossBeats')}${cth('lead', 'fCrossLead')}${cth('what it says', 'fCrossSays')}<th ${bth}></th></tr></thead>
      <tbody>${list.map((x) => `<tr>
        <td ${btd0}>${esc(fDialLabel(x.a))} x ${esc(fDialLabel(x.b))}</td>
        <td ${btd}>${esc(x.block.a.from)}..${esc(x.block.a.to)} x ${esc(x.block.b.from)}..${esc(x.block.b.to)}</td>
        <td ${btd}>${Number(x.squares)} of ${Number(x.ofSquares)}</td>
        <td ${btd}>${Number(x.won)} of ${Number(x.of)}</td>
        <td ${btd}>${fFix(x.lead, 1)}</td>
        <td ${btd0}>${esc(fDialLabel(x.a))} pays only at <b>${esc(x.block.a.from)}..${esc(x.block.a.to)}</b>, and only while ${esc(fDialLabel(x.b))} is <b>${esc(x.block.b.from)}..${esc(x.block.b.to)}</b></td>
        <td ${btd}><button data-fcross="${esc(x.a)}|${esc(x.b)}">load this grid</button></td>
      </tr>`).join('')}</tbody></table>`;
}

function fStep3(r, st) {
  const a0 = st.dialA || (st.leaders || [])[0] || '';
  const b0 = st.dialB || (st.leaders || [])[1] || '';
  const pickers = `<div class="row" style="align-items:flex-end">
      <label class="f">first dial<select id="fA">${fDialOptions(a0)}</select></label>
      <label class="f">second dial<select id="fB">${fDialOptions(b0)}</select></label>
      <label class="f">thin below<input id="fFloor" type="number" min="0" style="width:6rem" value="${st.floor || 0}"></label>
      <button id="fGrid" class="pri">read the grid</button></div>`;
  // HOW TO WALK THIS STEP, ON THE SCREEN (owner order, 2026-09-04: "you need
  // to have plain steps to walk this step 3"). Every control is named as it
  // is drawn below, and every sentence says what pressing it does.
  const howTo = `<ol class="note fhow">
      <li>Set <b>first dial</b> and <b>second dial</b> to the two dials to compare.</li>
      <li>Set <b>thin below</b>: a box on the grid holding fewer settings than this number is greyed out, shows its count in brackets, and can never be bold or part of a block.</li>
      <li>Press <b>read the grid</b> to build the grid for those two dials with that cut-off. Changing a dial box reads the grid again by itself; a new thin below number needs the button.</li>
      <li>Bold boxes beat the check. The outlined block is the largest rectangle of bold boxes. Press <b>keep this block</b> to write it into the rule.</li>
      <li>Or click one box on the grid to start a block of your own...</li>
      <li>...then click the box at the opposite corner to finish it. Your block turns green, and the green line under the grid says which values it covers...</li>
      <li>...then press <b>keep this block</b> to write your block into the rule instead of the outlined one.</li>
    </ol>`;
  if (!r.grid) return `${fCrosses(r, st)}${howTo}${pickers}<p class="note">name two dials and read the grid</p>`;
  const kind = (r.noise || {}).kind;
  const blk = (r.block || {}).block;
  const counting = new Set((r.block || {}).counting || []);
  // HOW MANY COPIES EACH SQUARE BEATS (3.56.0), from the same pass that
  // decided bold -- the words step 2 uses, so the grid reads the same way
  const beatenAt = (r.block || {}).beaten || {};
  // WHAT A BLOCK IS WORTH, printed beside it and never used to choose it: the
  // average money of its squares, weighted by the settings in each, and the
  // settings it holds
  const worthOf = (a0, a1, b0, b1) => {
    const ai = [r.aVals.indexOf(a0), r.aVals.indexOf(a1)].sort((x, y) => x - y);
    const bi = [r.bVals.indexOf(b0), r.bVals.indexOf(b1)].sort((x, y) => x - y);
    let sum = 0; let n = 0;
    for (let i = ai[0]; i <= ai[1]; i++) {
      for (let j = bi[0]; j <= bi[1]; j++) {
        const c = r.grid.find((x) => x.a === r.aVals[i] && x.b === r.bVals[j]);
        if (c && c.mean != null && c.n) { sum += c.mean * c.n; n += c.n; }
      }
    }
    return n ? ` <span class="muted">avg test ${fFix(sum / n)} over ${n.toLocaleString()} settings</span>` : '';
  };
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
  // A SECOND CHECK GRID (owner order, 2026-09-04: "a second check box, after
  // the highest scrambled average check box. exact same formatting but it
  // should show 'average scrambled average'"): the same squares, the average
  // of the scrambled copies' averages in each. The highest is what a square
  // must clear to be above all of the copies; the average is where they sit.
  const checkAvgAt = (a, b) => {
    const cells = (r.checkGrids || []).map((g) => (g.grid || []).find((x) => x.a === a && x.b === b)).map((c) => (c && c.mean != null ? c.mean : null));
    const fin = cells.filter((x) => x != null);
    if (!fin.length) return '-';
    return fFix(fin.reduce((s, x) => s + x, 0) / fin.length);
  };
  // THE THREE TABLES LINE UP (owner order, 2026-09-04: "line up those two
  // check tables and draw the cell boundaries"): fixed, equal columns on the
  // same width, so a square sits under the same square in every table
  const table = (title, cell) => `<p class="note"><b>${title}</b></p><table class="fgrid"><thead><tr>${cth(`${esc(fDialLabel(r.dialA))} \\ ${esc(fDialLabel(r.dialB))}`, 'fGridCorner')}${(r.bVals || []).map((b) => cth(esc(b), 'fGridValue')).join('')}</tr></thead><tbody>
      ${(r.aVals || []).map((a) => `<tr><td><b>${esc(a)}</b></td>${(r.bVals || []).map((b) => cell(a, b)).join('')}</tr>`).join('')}</tbody></table>`;
  return `${fCrosses(r, st)}${howTo}${pickers}
    <p class="note"><b>${r.thin} of ${r.squares} squares are thin.</b> A square built from two settings tells you
      nothing, but it looks like every other square - and it is often the best-looking one on the grid, because small
      groups swing further. Thin squares are marked and keep their count; none is dropped.</p>
    <p class="note">What each floor would keep: ${(r.floorCost || []).map((x) => `${x.floor} keeps ${x.keeps} of ${x.of}`).join('; ')}.</p>
    ${table('The grid - bold squares beat the check; the outlined block is recommended; press two corners to choose your own', (a, b) => {
      const c = r.grid.find((x) => x.a === a && x.b === b) || {};
      const k = `${a}|${b}`;
      const cls = [c.thin ? 'muted' : '', counting.has(k) ? 'cnt' : '', inBlock(a, b) ? 'blk' : '', inPick(a, b) ? 'pick' : '', 'pickable'].filter(Boolean).join(' ');
      const bt = beatenAt[k];
      return `<td class="${cls}" data-fcell="${esc(k)}">${fFix(c.mean)}${c.thin ? ` (${c.n || 0})` : ''}${bt && bt.of ? `<br><span class="muted">beats ${bt.won} of ${bt.of}</span>` : ''}</td>`;
    })}
    ${table(kind === 'halves' ? 'The check - each half\'s average, first / second' : 'The check - the highest scrambled average in each square', (a, b) => `<td>${esc(checkAt(a, b))}</td>`)}
    ${kind === 'halves' ? '' : table('The check - the average scrambled average in each square', (a, b) => `<td>${esc(checkAvgAt(a, b))}</td>`)}
    <div class="row" style="align-items:flex-end;margin-top:.5rem">
      <span class="note">${blk ? `Recommended block: ${esc(fDialLabel(r.dialA))} ${esc(blk.a.from)} to ${esc(blk.a.to)}, ${esc(fDialLabel(r.dialB))} ${esc(blk.b.from)} to ${esc(blk.b.to)} - ${blk.squares} square(s).${worthOf(blk.a.from, blk.a.to, blk.b.from, blk.b.to)}`
      : `No block - ${esc((r.block || {}).why || 'no square beats the check')}.`}
      ${pk && pk.a1 != null ? ` <b class="fpick">Your block: ${esc(fDialLabel(r.dialA))} ${esc(pk.a0)} to ${esc(pk.a1)}, ${esc(fDialLabel(r.dialB))} ${esc(pk.b0)} to ${esc(pk.b1)}.</b>${worthOf(pk.a0, pk.a1, pk.b0, pk.b1)}` : (pk && pk.a0 != null ? ' <b class="fpick">One corner chosen - press the other.</b>' : '')}</span>
      <button id="fKeepBlock" class="pri" ${(pk && pk.a1 != null) || blk ? '' : 'disabled'}>keep this block</button>
      <span class="note">writes a range on BOTH dials in one step, replacing what the rule held for them. Your own block if you chose one, else the recommended one.</span></div>`;
}

function fStep4(r, st) {
  const ax = r.axis || {};
  if (r.pressed) {
    // ON A UNIT'S BOARD, "elsewhere" IS THE OTHER UNITS (§17.3): the same rule
    // on each of their records, read one at a time when asked
    // UNDER THE KEY THE PRESS FILED IT UNDER (3.55.0, owner: "looks like the
    // 'read the other units' button doesn't do anything"): since 3.50.0 a
    // reading is kept under the rule AND the bar; this looked under the rule
    // alone, never found it, and the table never showed
    const a = st.across && st.across.ruleKey === fAcrossKey(st) ? st.across : null;
    const asked = !a && st.acrossAsked && st.acrossAsked.ruleKey === fAcrossKey(st);
    return `<p class="note">Read across the <b>${r.others}</b> other coin-and-shape unit${r.others === 1 ? '' : 's'} of this set: the
        rule you have built here, applied to each of their records.</p>
      <div class="row" style="align-items:flex-end">
        <button id="fAcross" class="pri" ${asked ? 'disabled' : ''}>read the other units</button>
        <span id="fAcrossMsg" class="note">${a ? `<span>read at ${esc(new Date(a.at).toLocaleTimeString())}</span>` : `<span>not read yet for this rule - ${r.others} boards, read one at a time</span>`}</span></div>
      ${a ? `<p class="note"><b>${a.positive} of ${a.of}</b> other units are positive under this rule, and on
        <b>${a.clearBar} of ${a.of}</b> the money of the survivors clears the bar against the scrambled copies of that unit.</p>
      <table><thead><tr>${cth('unit', 'fAcrossUnit')}${cth('survivors', 'fAcrossSurvivors')}${cth('avg test', 'fAvgTest')}${cth('check', 'fCheck')}</tr></thead>
        <tbody>${a.units.map((u) => `<tr class="${u.clears ? 'cnt' : (u.avgTest == null ? 'dim' : '')}"><td>${esc(u.name)}</td><td>${Number(u.survivors).toLocaleString()} of ${Number(u.of).toLocaleString()}</td><td>${fFix(u.avgTest)}</td><td>${u.k ? `<span>beats ${u.beats} of ${u.k}${u.lead == null ? '' : ` - lead ${Number(u.lead).toFixed(1)}`}</span>` : '-'}</td></tr>`).join('')}</tbody></table>
      <div class="row" style="align-items:flex-end;margin-top:.5rem">
        <button id="fAccept4" class="pri">accept and carry on</button>
        <span class="note">records "accepted ${a.positive} of ${a.of} other units positive; ${a.clearBar} clear the bar" as a mark on the set, and opens the next step</span></div>` : ''}`;
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

function fStep5(r, d, st) {
  const keep = r.keep || {};
  const ranges = Object.entries(keep.ranges || {});
  const allowed = Object.entries(keep.allowed || {});
  const pap = r.papered || {};
  const at = r.atLeast == null ? 0 : Number(r.atLeast);
  // THE BAR A SETTING HAS TO CLEAR (3.64.0, owner order). Zero is what it has
  // always been. Below zero lets a shallow dip be walked through, so a wide
  // area is not split in two by one setting a cent under.
  // THE THREE WALLS ROUND A REGION, ALL THREE THE OWNER'S TO MOVE (3.65.0,
  // owner order). Money is only one of them: a board still free on a
  // word-valued dial is cut into pieces a region may never cross, and a step
  // was always exactly one notch, so a setting missing from the board walled it
  // off too. Lowering the money bar alone can leave the size dead still.
  const reach = Number.isFinite(Number(r.regionReach)) && Number(r.regionReach) >= 1 ? Math.floor(Number(r.regionReach)) : 1;
  const crossOn = new Set(Array.isArray(r.regionAcross) ? r.regionAcross.map(String) : []);
  const canCross = Array.isArray(r.canCross) ? r.canCross : [];
  const acrossRow = canCross.length
    ? `<div class="row" style="align-items:flex-end;margin-top:.5rem">
      <span class="note">also join across:</span>
      ${canCross.map((c) => `<label class="c" title="${esc(String(c.dial))} still has ${c.values.length} value(s) on this board: ${esc(c.values.join(', '))}"><input type="checkbox" data-facross="${esc(String(c.dial))}"
        ${crossOn.has(String(c.dial)) ? 'checked' : ''}> ${esc(fDialLabel(c.dial))}</label>`).join('')}
      <span class="note">these dials hold words, not numbers, so nothing is next to anything on them. A region never
        crosses one unless you say so here - and while it does not, settings that differ on one of them can never be
        in the same region however low the bar above goes.</span></div>`
    : `<p class="note">Every dial whose values are words is already down to one value here, so there is nothing left
       to join across.</p>`;
  const bar = `<div class="row" style="align-items:flex-end;margin-top:.5rem">
      <label class="f">count a setting in if it makes at least<input id="fRegionAtLeast" type="number" step="0.01"
        style="width:7rem" value="${esc(String(at))}"></label>
      <label class="f">join settings up to this many apart<input id="fRegionReach" type="number" min="1" step="1"
        style="width:6rem" value="${esc(String(reach))}"></label>
      <button id="fRegionRead">read the region again</button>
      <span class="note">dollars, per setting. <b>0</b> is "it made money", which is how this step has always read.
        A number below 0 papers over settings that lost that much or less, so one weak setting cannot split a wide
        area in two. The scrambled copies are measured under the same number, or the comparison would be rigged.
        <b>1</b> apart is neighbours only, which is how this step has always read; a bigger number lets the region
        step over a setting that is missing from the board rather than stopping at it.</span></div>
    ${acrossRow}`;
  const papered = at === 0
    ? `<p class="note">At <b>0</b> nothing is papered over: every setting in the region made money.</p>`
    : (pap.n
      ? `<p class="note neg"><b>${Number(pap.n).toLocaleString()}</b> of the
         ${Number(pap.of || 0).toLocaleString()} settings in this region LOST money - the worst by
         <b>${fFix(pap.worst, 2)}</b>. They are in it because you set the bar at ${fFix(at, 2)}. This is recorded on
         the set as a mark and cannot be cleared.</p>`
      : `<p class="note">The bar is at ${fFix(at, 2)}, but nothing in the region needed it: every setting in it made
         money anyway.</p>`);
  // AND THE WAY PAST STEP 5 ALTOGETHER (owner order 2026-09-04): the rule the
  // owner built goes to step 6 whole, with nothing replaced.
  const mine = `<div class="row" style="align-items:flex-end;margin-top:.5rem">
      <button id="fKeepMine">keep my own rule and go on</button>
      <span class="note">leaves every range and value you chose exactly as it is and moves to step 6. Nothing on this
        step is written into the rule, and the set will say the widest region was never kept.</span></div>`;
  return `<p class="note">The widest run of neighbouring settings that all made money, and <b>its middle</b> - chosen
      by depth inside the region, never by score, so the best-scoring one cannot sneak back in.</p>
    <p class="note">region size <b>${r.size || 0}</b> of ${r.cellsClearing || 0} settings that cleared,
      out of ${r.cellsConsidered || 0} considered.</p>
    ${bar}
    ${papered}
    ${r.size ? `<table><thead><tr>${cth('dial', 'fRegionDial')}${cth('from', 'fRegionFrom')}${cth('to', 'fRegionTo')}</tr></thead><tbody>
      ${ranges.map(([k, b]) => `<tr><td>${esc(fDialLabel(k))}</td><td>${esc(String(b.min))}</td><td>${esc(String(b.max))}</td></tr>`).join('')}
      ${allowed.map(([k, v]) => `<tr><td>${esc(fDialLabel(k))}</td><td colspan="2">${esc(v.join(', '))}</td></tr>`).join('')}
    </tbody></table>
    <div class="row" style="align-items:flex-end;margin-top:.5rem">
      <button id="fKeepRegion" class="pri">keep the widest region</button>
      <span class="note">replaces every range and value in the rule with the region's edges above - keeps
        <b>${Number(keep.keeps || 0).toLocaleString()}</b> of ${Number(d.of || 0).toLocaleString()}${d.target ? ` - target ${Number(d.target).toLocaleString()}` : ''}</span></div>`
    : '<p class="note neg">No region: nothing here has neighbours that also work, which is what an isolated fluke looks like.</p>'}
    ${mine}`;
}

// WHAT EACH LIMIT WOULD KEEP, so the number is set with its cost in view.
function fLadder(name, l, word, ex) {
  if (!l) return '';
  if (!l.measured) return `<p class="note muted">${esc(name)}: no survivor carries this number yet - press work out the missing numbers first.</p>`;
  // a trade count is put on a yearly footing beside each rung (3.57.0); a
  // dollar figure is already in dollars at the stake named above
  return `<p class="note">${esc(name)} - what each limit would keep of ${l.of}: ${l.rungs.map((x) => `${word} ${fFix(x.at)}${ex ? fPerYear(x.at, ex) : ''} keeps ${x.keeps}`).join('; ')}.</p>`;
}

// WHAT A TRADE COUNT COMES TO OVER A YEAR (3.57.0): the window the trades were
// counted over is not a year, so a count means nothing until it is put on the
// same footing. Worked out from the window's own length.
const fPerYear = (n, ex) => {
  const f = ex && ex.window && ex.window.perYearFactor;
  return f && Number.isFinite(Number(n)) ? ` <span class="muted">(about ${Math.round(Number(n) * f).toLocaleString()} a year)</span>` : '';
};
const fDay = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : '-');
// WHAT THE TWO LIMITS WOULD LEAVE, AS THEY ARE TYPED (3.81.0, owner order
// 2026-09-07: "the remaining settings size needs to be continuously displayed
// so we can try for our target without shooting in the dark").
//
// ONE wording, used by the first draw and by every keystroke after it. Written
// twice they drift, and a line that changes its shape the moment you touch a
// box reads as two different facts about the same thing.
function fKeepsWords(keeps, of, target) {
  if (keeps == null) return 'how many these limits would leave is not known yet';
  const n = Number(keeps);
  const head = `these limits would leave ${n.toLocaleString()} of ${Number(of || 0).toLocaleString()} setting(s)`;
  const t = target == null ? null : Number(target);
  if (!t) return `${head}.`;
  if (n === t) return `${head} — exactly the target.`;
  return `${head} — ${n > t ? `${(n - t).toLocaleString()} above` : `${(t - n).toLocaleString()} below`} the target of ${t.toLocaleString()}.`;
}
// THE RULE THE WALK WOULD HOLD if the two boxes were added right now. Built the
// same way fAddFloors builds it, from the same two boxes, so the count under
// them is the count the press produces and never an estimate of it.
function fRuleWithFloors(st) {
  const dd = ($('#fDD') || {}).value;
  const tr = ($('#fTrades') || {}).value;
  const floors = { ...((st.rule || {}).floors || {}) };
  if (dd === '' || dd == null) delete floors.maxDrawdown; else floors.maxDrawdown = { max: Number(dd) };
  if (tr === '' || tr == null) delete floors.avgTrades; else floors.avgTrades = { min: Number(tr) };
  return { ...(st.rule || {}), floors };
}

// STEP 6's PRESS: WHAT IT SAYS AND WHEN IT IS DEAD (3.81.0, owner order
// 2026-09-07: "the interface tells the user to use the button again to load
// the values after the service is finished ... and then when the services are
// resting using the button fires the entire process again. absolutely horrible
// pathetic design").
//
// Both halves of that were true. The press held the request open, the gateway
// gave up at sixty seconds, and the page then told the owner to press it again
// -- and a second press re-priced every survivor from scratch, because nothing
// asked whether the numbers were already there.
//
// Now: the service says how many of TODAY's survivors already carry the
// numbers (richOn.have of richOn.need), so the press is DEAD when there is
// nothing left to work out, and one press finishes on its own -- it starts the
// run, watches it, and draws the values in when it lands. Nothing is ever
// pressed twice.
// UNKNOWN IS LIVE, NEVER DEAD (found 2026-09-07 by pressing the page for
// real). Written to fall back to need:0, a reply that carried no richOn at
// all ghosted the button with no explanation -- which is the exact fault
// this release is fixing, arriving by a different door. With nothing said
// about what is already worked out, every survivor still needs it.
const fRichOf = (d) => (d && d.richOn) || { have: 0, need: Number((d && d.survivors) || 0), run: null };
const fRichGoing = (d) => !!(fRichOf(d).run && fRichOf(d).run.running);
function fRichOff(d) {
  const x = fRichOf(d);
  if (fRichGoing(d)) return true;               // it is working; pressing again is the fault above
  if (!x.need) return true;                     // no survivors, nothing to work out
  return x.have >= x.need;                      // all of them already carry the numbers
}
// The CPU reading, in the same words on the progress line and nowhere else.
// null while the service has only taken one sample and has nothing to compare.
function fCpuWords(cpu) {
  if (!cpu || cpu.busy == null) return '';
  return ` · ${Math.round(cpu.busy * 100)}% of ${cpu.cores} core${cpu.cores === 1 ? '' : 's'} busy`;
}
function fRichLine(d) {
  const x = fRichOf(d);
  const run = x.run || {};
  if (fRichGoing(d)) {
    return (run.of ? `working them out — ${Number(run.done || 0).toLocaleString()} of ${Number(run.of).toLocaleString()} settings`
      : 'working them out') + fCpuWords(run.cpu);
  }
  if (run.error) return `FAILED — ${String(run.error)}`;
  if (!x.need) return 'no setting survives the rule, so there is nothing to work out';
  if (x.have >= x.need) return `done — all ${Number(x.need).toLocaleString()} surviving setting(s) carry them`;
  if (x.have) {
    return `${Number(x.have).toLocaleString()} of ${Number(x.need).toLocaleString()} surviving setting(s) carry them — `
      + `the press works out the other ${Number(x.need - x.have).toLocaleString()}`;
  }
  return `not done yet — one press works out all ${Number(x.need).toLocaleString()} of them and finishes on its own`;
}
function fStep6(d, st, r) {
  const dd = (st.rule.floors || {}).maxDrawdown || {};
  const tr = (st.rule.floors || {}).avgTrades || {};
  const ex = r.exposure || {};
  const w = ex.window || null;
  // WHAT THE TWO LIMITS ARE LIMITS ON (owner order, 2026-09-04: "how much are
  // we trading per trade? how much can be on the table at once maximum? ...
  // fewest trades? over what time period?"). Every number here is read off
  // the set and the engine, never typed.
  // HOW MANY CAN BE OPEN AT ONCE: not one per coin. A unit starts a new
  // position every step and holds it for the hold, so they overlap whenever
  // the hold outruns the step (owner, 2026-09-04). Said per unit, because a
  // weekly shape and a daily one differ by six times.
  const perUnit = Array.isArray(ex.perUnit) ? ex.perUnit.filter((u) => u.atOnce != null) : [];
  const overlap = perUnit.length && ex.holdHours
    ? `<p class="note">With the longest hold your rule still allows, <b>${Number(ex.holdHours).toLocaleString()} hours</b>:
        ${perUnit.map((u) => `${esc(u.name)} starts one every ${Number(u.stepHours).toLocaleString()} hours, so up to
          <b>${u.atOnce}</b> can be open at once - <b>$${Number(u.mostAtOnce).toLocaleString()}</b>`).join('; ')}.
        ${ex.mostAtOnce != null ? `Across this reading that is <b>$${Number(ex.mostAtOnce).toLocaleString()}</b> on the table
          at once if every one of them is in a trade.` : ''}</p>`
    : '';
  const money = ex.stake ? `<p class="note"><b>What these limits are limits on.</b> Every trade stakes
      <b>$${Number(ex.stake).toLocaleString()}</b>, so every dollar figure on this walk is dollars at that stake.
      A position is opened at the start of a chunk and held for the hold, so a coin can hold more than one at a time
      whenever the hold runs longer than the gap between starts.</p>${overlap}` : '';
  const when = w
    ? `<p class="note"><b>The trades are counted over ${fDay(w.fromTs)} to ${fDay(w.toTs)}</b> -
        ${Math.round(w.weeks)} weeks, or ${Math.round(w.days)} days. That is the test window: the part of the history
        the money on this walk was made in. Held-back and sealed time sit after it and are not counted here.
        <b>${Number(tr.min || 20).toLocaleString()}</b> trades over that window is
        about <b>${w.perYearFactor ? Math.round((Number(tr.min) || 20) * w.perYearFactor).toLocaleString() : '-'}</b> a year.</p>`
    : `<p class="note muted">The window the trades were counted over cannot be worked out${ex.why ? ` - ${esc(ex.why)}` : ''}, so a trade count here cannot be put on a yearly footing.</p>`;
  const howTo = `<ol class="note fhow">
      <li>Press <b>work out the missing numbers</b> FIRST. Nothing below can be read or set until it has run: the two
        limits are read off the survivors themselves, and no survivor carries these numbers until this is pressed. It
        changes no rule and no record; it prices the survivors again for the numbers a sweep does not keep.</li>
      <li>Read the two lines under it: what each limit would keep, of the settings that survive.</li>
      <li>Set <b>worst losing streak allowed</b> - in dollars, per coin: the deepest the running total ever sat below
        its own best point. A setting whose worst streak is deeper than this is dropped.</li>
      <li>Set <b>fewest trades</b> - counted over the window named above. A setting that traded fewer times is dropped.</li>
      <li>Press <b>add these limits to the rule</b>. Both limits go into the rule together, and the survivor count at
        the top moves.</li>
    </ol>`;
  return `<p class="note">The numbers a sweep does not keep - the worst losing streak, the biggest single loss, how
      many trades won, and how much of the result rests on guessing what happened inside a single bar - are worked out
      here, for the <b>${Number(d.survivors).toLocaleString()}</b> settings that survive and no others. Totals
      flatter; an average losing streak hides the one that would have ended you.</p>
    ${howTo}
    ${money}
    ${when}
    <div class="row"><button id="fRebuild" class="pri"${fRichOff(d) ? ' disabled' : ''}>work out the missing numbers</button>
      <span id="fRebuildMsg" class="note">${esc(fRichLine(d))}</span></div>
    ${st.rebuiltSaid ? `<p class="note">${esc(st.rebuiltSaid)}</p>` : ''}
    ${fLadder('worst losing streak', (r.ladders || {}).maxDrawdown, 'at most', null)}
    ${fLadder('trades', (r.ladders || {}).avgTrades, 'at least', ex)}
    <div class="row" style="align-items:flex-end;margin-top:.5rem">
      <label class="f">worst losing streak allowed<input id="fDD" type="number" style="width:8rem"
        value="${esc(String(dd.max == null ? '' : dd.max))}"></label>
      <label class="f">fewest trades<input id="fTrades" type="number" style="width:8rem"
        value="${esc(String(tr.min == null ? '' : tr.min))}"></label>
      <button id="fAddFloors">add these limits to the rule</button>
      <span class="note">${w ? `a trade count here is over ${Math.round(w.weeks)} weeks${tr.min ? fPerYear(tr.min, ex) : ''}` : 'the window these trades were counted over is not known for this set'}</span></div>
    <p class="note" id="fFloorsKeeps">${esc(fKeepsWords(d.survivors, d.of, d.target))}</p>`;
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
    <p class="note"><b>${esc(fRuleWords(d.ruleSentence))}</b></p>
    <p class="note">${Number(d.survivors).toLocaleString()} settings survive${d.target
    ? ` against a target of ${Number(d.target).toLocaleString()}` : ''}.</p>
    ${detail ? `<p class="note">${esc(detail)}</p>` : ''}
    <div class="row" style="align-items:flex-end">
      <label class="f" style="flex:1 1 30rem;min-width:14rem">name<input id="fName" style="width:100%"
        placeholder="left blank, it is numbered"></label>
      <label class="f">how to reach the target<select id="fClose">${vocabOptions('funnelClosing', cl.key)}</select></label>
      ${top}
      <button id="fCut" class="pri">write the Stage 4 set</button><span id="fCutMsg" class="note"></span></div>
    <p class="note"><b>Taking the top N is shopping</b>, on the board this walk exists to stop you shopping. It is
      offered because the choice is yours, and whichever you use is recorded on the set so the final check knows what
      it is judging. Only columns a scrambled copy of the table really has are offered, so the same rule takes the
      same top N of a scrambled copy and the two can be compared.</p>
    <p class="note">An empty or one-setting result is written with a warning, never refused.</p>`;
}

// EVERY CLAUSE OF THE RULE, EACH WITH ITS OWN remove (3.55.0, owner order,
// 2026-09-04: the clause "weekdaysOnly is false" was stuck in a rule built
// on a weekly unit -- step 2 offers its tick boxes only where the dial has
// two or more values, and after the fold it had one there -- so nothing on
// the screen could take it out, and applied to the daily units it halved
// them). The sentence stays the service's; the list under it is the rule as
// the page holds it, one line per clause, and remove drops that clause only.
function fRuleClauses(st) {
  const out = [];
  const R = st.rule || {};
  for (const [dial, spec] of Object.entries(R.ranges || {})) {
    if (!spec) continue;
    const lo = spec.min != null ? spec.min : null;
    const hi = spec.max != null ? spec.max : null;
    const also = Array.isArray(spec.also) && spec.also.length ? ` or ${spec.also.join('/')}` : '';
    const span = lo != null && hi != null ? `${lo} to ${hi}` : lo != null ? `${lo} or more` : hi != null ? `${hi} or less` : 'anything';
    out.push({ kind: 'ranges', key: dial, text: `${fDialLabel(dial)} ${span}${also}` });
  }
  for (const [dial, vals] of Object.entries(R.allowed || {})) {
    if (!Array.isArray(vals) || !vals.length) continue;
    out.push({ kind: 'allowed', key: dial, text: `${fDialLabel(dial)} is ${vals.join(' or ')}` });
  }
  for (const [field, spec] of Object.entries(R.floors || {})) {
    if (!spec) continue;
    if (spec.min != null) out.push({ kind: 'floors', key: field, text: `${field} at least ${spec.min}` });
    if (spec.max != null) out.push({ kind: 'floors', key: field, text: `${field} at most ${spec.max}` });
  }
  return out;
}
// ---- A STAGE 4 RECORD SET, ON SCREEN (3.58.0) --------------------------------
//
// Owner order, 2026-09-04: "if there are one or more Stage 4 record sets
// available for the S3 provenance, then in place of the rule building Heading
// section, a drop-down should be presented that either (a) displays the selected
// Stage 4 record set or (b) if 'new rule' is chosen, the standard Funnel process
// starts". On (a) the heading is "essentially display only (except for a rename
// control) with the funnel step buttons removed".
//
// Nothing on this screen writes except the rename. The rows are the settings the
// set WROTE DOWN, not the settings its rule picks today, so the screen cannot
// quietly show a different set under the same name.
const F_NEW = 'new';

// HOW FAR THE CUT HAS GOT, asked every second until it is done (3.67.0). The
// count on the line beside the button is the settings the rule has been read
// against so far, so a long cut says it is moving rather than sitting silent.
async function fCutFollow(st) {
  const msg = () => $('#fCutMsg');
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const s = await api(`api/funnel/${encodeURIComponent(st.set)}/cut`).catch(() => null);
    if (!s) { if (msg()) msg().textContent = 'the service stopped answering - nothing was written'; return null; }
    if (s.error) { if (msg()) msg().textContent = `FAILED - ${s.error}`; return null; }
    if (s.result) return s.result;
    if (msg()) msg().textContent = s.of ? `writing - ${Number(s.done).toLocaleString()} of ${Number(s.of).toLocaleString()} settings read` : 'writing';
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function fCutChosen(st, d) {
  const cuts = (d && d.cuts) || [];
  if (!cuts.length) return null;                     // none cut here: the walk, always
  if (st.cut === F_NEW) return null;                 // the owner asked for a new rule
  if (st.cut && cuts.some((c) => c.id === st.cut)) return st.cut;
  return cuts[0].id;                                 // never chosen, or gone: the newest
}

async function fDrawCut(d, st, cutId) {
  waitStart();
  let cd = null;
  let bad = null;
  const q = `sort=${encodeURIComponent(st.cutSort || '')}&dir=${encodeURIComponent(st.cutDir || '')}`;
  try { cd = await api(`api/funnel/set/${encodeURIComponent(cutId)}/rows?${q}`); }
  catch (e) { bad = e.message; }
  finally { waitEnd(); }
  // A FAILED READ STILL DRAWS THE PICKER. Without it the owner is shut inside a
  // set that will not open, with no control on screen to leave it by.
  const named = ((d.cuts || []).find((c) => c.id === cutId) || {}).name || 'this Stage 4 record set';
  if (bad) {
    $('#view').innerHTML = `<div class="panel">${fTitle(d, st, named)}</div>
      <div class="panel"><p class="note neg">This Stage 4 record set could not be read: ${esc(bad)}. Choose another
        above, or <b>new rule</b> to walk the steps again.</p></div>`;
    fWireCut(d, st, null);
    return;
  }
  if (cd.totalling || cd.waiting) {
    const tp = cd.totalling && typeof cd.totalling === 'object' ? cd.totalling : null;
    const said = tp
      ? `${tp.phase || 'totalling the tables'}: ${Number(tp.done || 0).toLocaleString()} of ${Number(tp.total || 0).toLocaleString()} ${tp.word || 'parts'}`
      : String(cd.totalling || cd.waiting);
    $('#view').innerHTML = `<div class="panel">${fTitle(d, st, named)}</div>
      <div class="panel"><p class="note">the tables of the stage 3 set this was cut from are being worked out -
        <b>${esc(said)}</b> - this page asks again in a few seconds</p></div>`;
    fWireCut(d, st, null);
    setTimeout(() => { if (tab === 'funnel') drawFunnel(); }, 4000);
    return;
  }
  $('#view').innerHTML = `<div class="panel">${fTitle(d, st, cd.set.name)}</div>
    <div class="panel">${fCutHead(cd, st)}</div>
    <div class="panel">${fCutTable(cd, st)}</div>`;
  fWireCut(d, st, cd);
  fWatchCutBox();
}

// THE DROP-DOWN IS ON BOTH HEADINGS (3.58.0). It was on the Stage 4 heading
// only, and that made the walk a one-way door: choose `new rule` and there was
// no control left on the screen to get back to a set already cut. The owner's
// order reads the other way -- the drop-down is what is presented once sets
// exist, and `new rule` is one of the things it offers.
function fCutPickBox(d, st) {
  const cuts = d.cuts || [];
  return `<label class="f">Stage 4 record set<select id="fCutPick" style="min-width:20rem">${cuts.map((c) => `<option value="${esc(c.id)}" ${c.id === st.cut ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="new" ${st.cut === F_NEW ? 'selected' : ''}>new rule</option></select></label>`;
}
// ONE HEADING, NOT TWO. This drew "Funnel - <set> - <coin and shape>" above a
// heading that says the same thing plus the counts, which is the owner's own
// first line. The picker is the row; the identity is the line below it.
// THE TITLE AND THE TWO SELECTORS, ALWAYS AT THE TOP (owner order, 2026-09-04):
// "the coin and shape and stage 4 record set and the bold name are always at
// the top in a title/selector section, regardless of stage 4 data present or
// not". Only the section BELOW this one changes with what is chosen, so the
// screen never rearranges itself under the owner.
function fTitle(d, st, name) {
  // A STAGE 4 RECORD SET CAN BE DELETED FROM THE SCREEN IT LIVES ON (owner
  // order, 2026-09-06: "there's no way to delete s4 data" and "s1/2/3 wont
  // delete cause 4 exists").
  //
  // The engine has always been able to delete one -- the endpoint takes any
  // record set -- and Boards only ever drew the control for stages 1, 2 and 3,
  // because those are the sections it has. A stage 4 set is drawn here and
  // nowhere else, so here is the only place the control can go, and without it
  // the owner was walled in: a set another set was cut from refuses to be
  // deleted while its children exist, so one undeletable stage 4 set made its
  // stage 3, stage 2 and stage 1 parents undeletable too, all the way up the
  // chain. That is not a stage 4 problem, it is the whole chain (RULE FIVE:
  // what the system can do, the interface exposes).
  const chosen = st.cut && st.cut !== F_NEW ? st.cut : null;
  return `<div class="row" style="align-items:flex-end">
      ${fUnitPicker(d)}
      ${fCutPickBox(d, st)}
      <button id="fCutDelete" class="danger" ${chosen ? '' : 'disabled'}
        title="permanently deletes the Stage 4 record set chosen beside this, and nothing else. Its parent stage 3 set, and the stage 2 and stage 1 sets above that, cannot be deleted while a set cut from them is still here — so this is what clears the way.">Delete Stage 4 record set…</button>
      <span class="note">${(d.cuts || []).length} Stage 4 record set(s) have been cut from this coin and shape.
        Choose <b>new rule</b> to walk the steps again and cut another.</span>
    </div>
    <h3 id="fTitleName" style="margin:.55rem 0 0">${esc(name)}</h3>`;
}
// what the bold name says while the steps are being walked
const F_NEW_NAME = 'new rule';

// THE HEADING, AS THE OWNER DREW IT (2026-09-04, reordered 3.61.0). Display
// only, one control on it: the name. It reads top to bottom as one progression
// rather than notes scattered round a box -- what the money is, the rule the
// OWNER built, the rule that was written, how both were checked, what history
// was held back, how the walk went, and anything wrong with it. Every line is
// read off THIS SET: what its check was, how many copies it kept, which unit's
// window is sealed, what the closing was, how the walk went.
// WHAT HAPPENED TO THE NUMBERS THIS SET'S RULE READS (3.68.0, owner order
// 2026-09-05). Two of the limits on step 6 read numbers the sweep does not
// store; they are worked out on the press and kept in one file beside the
// PARENT record set. Until 3.68.0 a later pass over the same stage 3 records
// wrote that file fresh, so an earlier set's numbers went with it: its rule
// then kept nothing, while its rows carried on showing the names it wrote down.
// The file adds rather than replaces now, and every set keeps its own copy --
// but a set cut before that has nothing to copy, so it says so and offers the
// one thing that can put it right: pricing its own settings again.
// The two numbers a rule can put a limit on, in the words the table heading
// above them uses. Nothing else in a rule reads a number the sweep did not keep.
const F_LIMIT_WORDS = { maxDrawdown: 'worst losing streak', avgTrades: 'trades' };
function fCutNumbers(rec) {
  const reads = Array.isArray(rec.reads) ? rec.reads : [];
  if (!reads.length) return '';
  const lost = reads.filter((f) => Number((rec.onParent || {})[f] || 0) < Number(rec.had || 0));
  if (!lost.length) return '';
  const names = lost.map((f) => `<b>${esc(F_LIMIT_WORDS[f] || f)}</b>`).join(' and ');
  const mine = lost.map((f) => Number((rec.onMine || {})[f] || 0));
  const haveAll = mine.every((n) => n >= Number(rec.had || 0));
  return `<p class="note neg">This rule reads ${names}, and ${lost.map((f) => Number((rec.onParent || {})[f] || 0).toLocaleString()).join(' and ')}
      of its ${Number(rec.had || 0).toLocaleString()} settings still carry ${lost.length > 1 ? 'them' : 'it'} on the parent's board. Those numbers are not
      stored by a sweep - they are worked out on the press at step 6 and kept beside the parent record set, and a later
      walk over the same records used to write that file fresh. ${haveAll
    ? 'This set kept its own copy, so the rows below and their columns are complete.'
    : 'This set has no copy of its own, so the columns below are empty and the rule cannot be re-applied.'}</p>
    <div class="row" style="align-items:flex-end;margin-top:.4rem">
      <button id="fSetRebuild">work out the missing numbers</button>
      <span id="fSetRebuildMsg" class="note">prices this set's own ${Number(rec.had || 0).toLocaleString()} settings again from the
        parent's records and keeps the answer on this set. Minutes, and it waits for any sweep that is running.</span></div>`;
}
function fCutHead(cd, st) {
  const s = cd.set;
  const c = s.check || {};
  const rec = cd.record || {};
  const se = cd.sealedOn || {};
  const unitName = s.unit ? (s.unitName || s.unit) : 'all units together';
  const parentName = (s.parent || {}).name || (s.parent || {}).id || 'its stage 3 set';
  const marks = (s.marks || []).map((m) => m.what).filter(Boolean);
  const of = Number(cd.of).toLocaleString();
  const who = `${esc(parentName)} - ${esc(unitName)}`;
  return `<div class="row" style="align-items:flex-end">
      <label class="f">name<input id="fCutName" value="${esc(s.name || '')}" maxlength="80" style="width:26rem"></label>
      <button id="fCutRename">rename</button>
      <span id="fCutNameMsg" class="note">${s.nameEditedAt ? `renamed ${esc(String(s.nameEditedAt).slice(0, 16))}` : `cut ${esc(String(s.createdAt || '').slice(0, 16))}`}${s.release ? ` by release ${esc(s.release)}` : ''}</span>
    </div>
    <p class="note"><b>The rules below were built on test money</b> - the steps read the test window and nothing
      else. The held-back window is opened once, at the cut, on what survives, and <b>avg held-back $</b> in the table
      is that one look. Reading down that column and taking the best of these
      ${Number(s.survivors).toLocaleString()} is shopping the held-back window, which is the one thing it does not
      survive. It is here because <b>Verify</b>, <b>History</b>, <b>Tune</b> and <b>Greenlight</b> are where a survivor
      is graded, and they start from what is on this screen.</p>

    <h4 style="margin:1rem 0 .3rem">User Rule:</h4>
    ${s.userSentence ? `<p class="note">${esc(fRuleWords(s.userSentence))}</p>
    <p class="note">${who} - <b>${s.userSurvivors == null ? '-' : Number(s.userSurvivors).toLocaleString()}</b> of ${of}
      settings survive. These are the ranges and values you chose yourself, and they are what step 5 read to find its
      widest region; keeping that region replaced every one of them with the rule below.
      ${s.userStamped ? '<b>Recovered from this walk\'s own recorded steps and written onto the record</b>, because it was cut before the rule feeding step 5 was kept.' : ''}</p>`
    : `<p class="note">The widest region was never kept on this walk, so nothing of yours was replaced - the rule
      below is the one you built.</p>`}

    <h4 style="margin:1rem 0 .3rem">Final Rule:</h4>
    <p class="note">${esc(fRuleWords(s.ruleSentence))}</p>
    <p class="note">${who} - <b>${Number(s.survivors).toLocaleString()}</b> of ${of} settings survive${s.target ? ` and the target is ${Number(s.target).toLocaleString()}` : ''}.
      ${rec.same ? 'Re-applying this rule to the same board today gives back exactly these settings.'
    : `<b class="neg">Re-applying this rule to the same board today gives ${Number(rec.now || 0).toLocaleString()} settings, not
        ${Number(rec.had || 0).toLocaleString()}</b>${rec.sameOwn ? '' : ' - the board has moved since the cut'}. The rows below are the ones the set
        wrote down, which is what it decided.`}
      ${rec.gone ? `<b class="neg">${Number(rec.gone).toLocaleString()} of them are no longer on the board at all</b> and are shown with no numbers.` : ''}</p>
    ${fCutNumbers(rec)}
    ${(st && st.setRebuiltSaid) ? `<p class="note">${esc(st.setRebuiltSaid)}</p>` : ''}

    <p class="note"><b>Rule build settings:</b> target size ${s.target == null ? 'not set' : Number(s.target).toLocaleString()}${c.kind === 'scrambles'
    ? `; bold when a value beats at least ${c.barPct}% of the ${c.k} copies - that is ${c.bar} of them - by chance about ${fPct(c.chance)} of values would`
    : '; this walk had no scrambled copies to set a bar against'}.</p>
    <p class="note"><b>How every step of this walk was checked.</b> ${c.kind === 'scrambles'
    ? `<b>${esc(unitName)}</b>'s own table was scrambled <b>${c.k}</b> times, each copy the same days in a jumbled
       order. Every one of the ${Number(s.steps || 0)} choices recorded below was read once against the real table and
       again against each of those ${c.k}, and a value counted only when it beat at least <b>${c.bar}</b> of them.`
    : `<b class="neg">This set kept no scrambled copies</b>, so every step was read against the two halves of
       <b>${esc(unitName)}</b>'s settings instead - which tests whether a reading is STABLE and never whether the
       effect is real, and is marked as such on this set.`}</p>
    <p class="note">${se.sealed
    ? `The sealed window is intact on <b>${esc(unitName)}</b>${se.of > 1 ? ` and on the other ${se.of - 1} unit(s) this set was cut across` : ''} - a final stretch of that unit's history no part of this walk touched, from ${fDayOf(se.fromTs)} onward to the newest data the box holds.`
    : `<b class="neg">No sealed window on ${esc(unitName)}</b> - ${esc(String(se.why || 'not recorded'))}.`}</p>

    <p class="note"><b>Step 7 - ${esc(F_STEPS[6][0])}:</b> ${esc((s.closing || {}).label || 'accept what the rule gives')}${(s.closing || {}).detail ? ` - ${esc(String(s.closing.detail))}` : ''}.
      ${Number(s.steps || 0)} choice(s) recorded on the way, ${Number(s.backSteps || 0)} step(s) back.
      ${marks.length ? `<b>${marks.length} mark(s)</b> - ${esc(marks.join('; '))}.` : 'No marks were recorded.'}</p>
    ${(s.warnings || []).length ? `<p class="note neg"><b>Written with warnings:</b> ${esc((s.warnings || []).join('; '))}</p>` : ''}`;
}

// the sort button on a column of the table below: click sorts every row of the
// set by it, click again flips it
function fcSort(key, cd) {
  const on = cd.sort === key;
  return ` <button data-fcsort="${esc(key)}" style="min-width:2.2rem;padding:0 .25rem"
    title="click to sort every setting in this set by this column; click again to flip it. The sort is over the whole set, not the page showing.">${on ? (cd.dir === 'desc' ? '↓' : '↑') : '·'}</button>`;
}
const fcThirds = (v) => (Array.isArray(v) && v.length ? v.map((x) => fFix(x, 2)).join(' / ') : '-');

// WHAT EACH SURVIVOR DID (3.59.0, owner order: "no horizontal scroll bar is
// allowed"). One setting is THREE rows -- what it is, then its test window and
// its held-back window stacked underneath it and set to the right -- so nine
// columns carry fifteen numbers and the table stays inside the panel. Each
// heading holds both names, the test one above the held-back one, lined up with
// the two rows under it, and either can be pressed to order the whole set by
// it. The heading is frozen, so scrolling the rows never loses what is being
// looked at.
//
// The dials the rule pinned are the same on every row and are said once above
// the table; the dials that still vary are on each setting's own line, because
// a column each is what forced the table sideways.
function fCutTable(cd, st) {
  const has = (k) => !!(cd.has || {})[k];
  const dials = cd.varying || [];
  const blend = !cd.set.unit;
  const c2 = has('maxDrawdown') || has('avgTrades');
  const c3 = has('worstTrade') || has('avgVsLong');
  const c4 = has('bestTrade') || has('beat');
  const c5 = has('wins') || has('pairs');
  const c6 = has('stops') || has('avgLead');
  const c7 = has('grossPerTrade');
  const c8 = has('pnlThirds');
  const cols = 2 + [c2, c3, c4, c5, c6, c7, c8].filter(Boolean).length;
  const gaps = ['maxDrawdown', 'worstTrade', 'bestTrade', 'wins', 'stops', 'grossPerTrade'].filter((k) => !has(k)).length;
  const fixedLine = Object.entries(cd.fixed || {})
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${fDialLabel(k)} ${v}`).join('; ');
  if (!cd.total) {
    return `<p class="note neg">This Stage 4 record set kept no settings at all. An empty result is written with a
      warning rather than refused, because the choice is yours - the warning is on the heading above.</p>`;
  }
  return `<p class="note">Every one of these ${Number(cd.total).toLocaleString()} settings has the same
      ${fixedLine ? `<b>${esc(fixedLine)}</b>` : 'nothing'} - the rule fixed those, so they are said here once rather
      than repeated on every row.</p>
    ${gaps ? `<p class="note muted">The numbers a sweep does not keep - worst losing streak, biggest single loss, best
      single trade, trades won, stopped out, gross per trade - are not on this set. Either it was cut without pressing
      <b>work out the missing numbers</b> on step 6, or it was cut before a set kept its own copy of them.
      <b>work out the missing numbers</b> on the heading above prices this set's own settings again and keeps the
      answer here, for good.</p>` : ''}
    <p class="note"><b>Order the whole set by</b> setting${fcSort('label', cd)}${dials.map((k) => ` &middot; ${esc(fDialLabel(k))}${fcSort(k, cd)}`).join('')}${has('members') ? ` &middot; members${fcSort('members', cd)}` : ''}${has('avgRung') ? ` &middot; rung${fcSort('avgRung', cd)}` : ''}${has('avgVoices') ? ` &middot; voices${fcSort('avgVoices', cd)}` : ''}
      - or press any heading in the table below.</p>
    <p class="note">All <b>${Number(cd.total).toLocaleString()}</b> of them are in the box below, in whatever order
      you set - scroll it. ${cd.clipped ? `<b class="neg">${Number(cd.clipped).toLocaleString()} are not shown</b>: this screen draws at most ${Number(cd.per).toLocaleString()} settings at once.` : ''}</p>
    <div class="s4box" id="fCutRows"><table class="s4"><thead>
      <tr>
        <th style="width:5rem" title="which of the two rows under each setting you are reading: its test window first, its held-back window under it."><span class="t">test</span><span class="h">hold</span></th>
        <th title="top: average test-window dollars for this setting, the money every one of the steps was read on. Bottom: dollars on the held-back window - the once-only look at days no part of the search touched."><span class="t">avg test $${fcSort('avgTest', cd)}</span><span class="h">avg held-back $${fcSort('avgHold', cd)}</span></th>
        ${c2 ? `<th title="top: on the test window, the deepest the running total ever sat below its own best point, in dollars per coin. Bottom: how many positions this setting took on the held-back window."><span class="t">worst losing streak $${fcSort('maxDrawdown', cd)}</span><span class="h">trades${fcSort('avgTrades', cd)}</span></th>` : ''}
        ${c3 ? `<th title="top: on the test window, the single worst trade in dollars. Bottom: its held-back dollars against simply holding the coin over the same days - positive means it beat holding."><span class="t">biggest single loss $${fcSort('worstTrade', cd)}</span><span class="h">vs always long $${fcSort('avgVsLong', cd)}</span></th>` : ''}
        ${c4 ? `<th title="top: on the test window, the single best trade in dollars - a result resting on one of these is one trade wide. Bottom: of its own null copies, the same votes with the calendar shuffled away, how many its held-back money beat."><span class="t">best single trade $${fcSort('bestTrade', cd)}</span><span class="h">beat its own null set${fcSort('beat', cd)}</span></th>` : ''}
        ${c5 ? `<th title="top: on the test window, how many of its trades ended in profit. Bottom: how many null copies it was measured against - N copies is at best a 1-in-(N+1) claim."><span class="t">trades won${fcSort('wins', cd)}</span><span class="h">null copies${fcSort('pairs', cd)}</span></th>` : ''}
        ${c6 ? `<th title="top: on the test window, how many trades were closed by the stop rather than at the end of the hold. Bottom: how far its held-back money sits above the typical null copy, measured in how far apart those copies are."><span class="t">stopped out${fcSort('stops', cd)}</span><span class="h">lead${fcSort('avgLead', cd)}</span></th>` : ''}
        ${c7 ? `<th title="on the test window, average dollars a trade made before fees. There is no held-back figure for this one."><span class="t">gross per trade $${fcSort('grossPerTrade', cd)}</span><span class="h">-</span></th>` : ''}
        ${c8 ? '<th title="the test window cut into three by time, the dollars of each third in order. A number that is all one third is a number about one stretch of history. There is no held-back figure for this one."><span class="t">money by third</span><span class="h">-</span></th>' : ''}
      </tr>
    </thead><tbody>${(cd.rows || []).map((r) => `<tr class="${r.gone ? 'muted' : ''}">
        <td class="s4what" colspan="${cols}"><b>${esc(r.label)}</b>${r.gone ? ' <b class="neg">no longer on the board</b>' : ''}${dials.map((k) => ` &middot; ${esc(fDialLabel(k))} ${esc(r[k] == null ? '-' : r[k])}`).join('')}${has('members') ? ` &middot; ${fFix(r.members, 0)} members` : ''}${has('avgRung') ? ` &middot; rung ${fFix(r.avgRung, 2)}` : ''}${has('avgVoices') ? ` &middot; ${fFix(r.avgVoices, 2)} voices` : ''}${blend && has('coins') ? ` &middot; ${fFix(r.coins, 0)} coins, ${fFix(r.coinsInMoney, 0)} in the money` : ''}</td>
      </tr>
      <tr class="${r.gone ? 'muted' : ''}">
        <td class="s4tag">test</td>
        <td>${fFix(r.avgTest, 2)}</td>
        ${c2 ? `<td>${fFix(r.maxDrawdown, 2)}</td>` : ''}
        ${c3 ? `<td>${fFix(r.worstTrade, 2)}</td>` : ''}
        ${c4 ? `<td>${fFix(r.bestTrade, 2)}</td>` : ''}
        ${c5 ? `<td>${fFix(r.wins, 1)}</td>` : ''}
        ${c6 ? `<td>${fFix(r.stops, 1)}</td>` : ''}
        ${c7 ? `<td>${fFix(r.grossPerTrade, 3)}</td>` : ''}
        ${c8 ? `<td>${fcThirds(r.pnlThirds)}</td>` : ''}
      </tr>
      <tr class="s4hold ${r.gone ? 'muted' : ''}">
        <td class="s4tag">hold</td>
        <td>${fFix(r.avgHold, 2)}</td>
        ${c2 ? `<td>${fFix(r.avgTrades, 1)}</td>` : ''}
        ${c3 ? `<td>${fFix(r.avgVsLong, 2)}</td>` : ''}
        ${c4 ? `<td>${fFix(r.beat, 0)}</td>` : ''}
        ${c5 ? `<td>${fFix(r.pairs, 0)}</td>` : ''}
        ${c6 ? `<td>${fFix(r.avgLead, 2)}</td>` : ''}
        ${c7 ? '<td></td>' : ''}
        ${c8 ? '<td></td>' : ''}
      </tr>`).join('')}</tbody>
    </table></div>`;
}

// HOW TALL THE BOX IS, MEASURED RATHER THAN GUESSED (3.60.0, owner order: "based
// on the vertical screen real estate available that the browser should be able
// to probe"). The box runs from wherever it starts on screen to the bottom of
// the window, less whatever is drawn under it -- the second paging bar -- and a
// little breathing room. Re-measured whenever the window changes size.
function fSizeCutBox() {
  const box = $('#fCutRows');
  if (!box) return;                                  // another screen is drawn
  // WHAT SITS UNDER THE BOX, MEASURED THE SAME WAY. Summing the boxes drawn
  // after it left out the panel's own bottom padding and its margin, so the
  // box ran off the bottom of the window by exactly that much (found by the
  // browser harness measuring it rather than trusting the arithmetic). The
  // panel's bottom edge minus the box's bottom edge is every one of them at
  // once, whatever the stylesheet says they are.
  const panel = box.closest('.panel') || box.parentElement;
  const b = box.getBoundingClientRect();
  const under = panel.getBoundingClientRect().bottom - b.bottom
    + (parseFloat(getComputedStyle(panel).marginBottom) || 0);
  // TWO NUMBERS, AND THE BOX TAKES WHICHEVER SERVES THE OWNER. `below` is the
  // room where the box actually stands; `scrolled` is the room it would have if
  // the page were scrolled so the box began at the top of the window. On this
  // screen the heading above the rows is tall enough on a laptop to leave almost
  // nothing below it -- measured at 190px of a 1000px window -- and two settings
  // is not "an appropriate number of records". So: use the room below when
  // there is enough of it, and otherwise take a share of the window and let the
  // page scroll to the box, which costs nothing because the heading is stuck to
  // the TOP OF THE BOX and comes with it.
  const below = window.innerHeight - b.top - under - 8;
  const scrolled = window.innerHeight - under - 24;
  // 45% of the window fitted FOUR settings on the owner's screen and they asked
  // for about eight (2026-09-04, measured at 78 pixels a setting on a 1000-pixel
  // window). The box is not held to the room where it stands, so the share is
  // what decides how many are readable at once; `scrolled` still caps it at a
  // box that fits the window whole, heading and all.
  //
  // 80% ran to nine settings and stood a little past the bottom of the window
  // on that measurement; the owner asked for it "a tiny bit shorter" (3.66.0).
  // 72% is eight, which is what they asked for in the first place.
  const share = Math.round(window.innerHeight * 0.72);
  const room = below >= share ? below : Math.min(scrolled, share);
  // never so short that the box is useless: three settings is nine rows
  box.style.maxHeight = `${Math.max(200, Math.round(room))}px`;
}
// ONE listener for the life of the page. fSizeCutBox does nothing when the box
// is not on screen, so it costs nothing on the other sections.
let fCutBoxWatched = false;
function fWatchCutBox() {
  fSizeCutBox();
  if (fCutBoxWatched) return;
  fCutBoxWatched = true;
  window.addEventListener('resize', fSizeCutBox);
}

// the drop-down is wired the same on both screens, by one function, because two
// copies of a control's handler is how the two screens come to behave differently
function fWireCutPick(st, d) {
  const cs = $('#fCutPick');
  if (cs) cs.onchange = () => {
    // A NEW RULE STARTS AT STEP 1 (owner order, 2026-09-04: "don't go back to
    // step 7 the previous finished rule if a record set already exists"). A
    // walk that has been cut is finished; dropping back into it at step 7 with
    // its own rule still on it is not a new rule, it is the old one wearing the
    // words. The walk is recognised by its own rule SENTENCE, which is the
    // sentence the set it wrote carries -- so this works on sets cut before it
    // was written, and never resets a walk that produced nothing.
    if (cs.value === F_NEW && fWalkWasAlreadyCut(d)) fFreshWalk(st);
    st.cut = cs.value; st.setRebuiltSaid = null; fSave(); drawFunnel();
  };
}
const fWalkWasAlreadyCut = (d) => !!(d && d.ruleSentence
  && (d.cuts || []).some((c) => c.ruleSentence && c.ruleSentence === d.ruleSentence));
function fFreshWalk(st) {
  st.step = 1;
  st.rule = { ranges: {}, allowed: {}, floors: {} };
  st.closing = { key: 'rule' };
  st.dial = null; st.dialA = null; st.dialB = null;
  st.steps = []; st.backSteps = []; st.marks = [];
  st.pick = null; st.leaders = []; st.conditions = {}; st.across = null; st.userRule = null;
  st.crosses = null; st.crossesAsked = null; st.crossesFailed = null;
  st.acrossAsked = null; st.read = null; st.rebuilt = false; st.rebuiltSaid = null;
}
// and one for the coin-and-shape box, for the same reason: this walk keeps its
// place, the chosen board is remembered, and the next load is that board's own
function fWireUnit(st, d) {
  const go = (key) => {
    fSave();
    fUnitChoose(st.set, key || 'all');
    fState = null;
    drawFunnel();
  };
  // WHAT IS IN THE BOXES RIGHT NOW, not what was in them when the page drew:
  // the boxes to the left of the one just changed have to be read live, or
  // changing the coin and then the shape would resolve against the old coin.
  const val = (id) => { const el = $(`#${id}`); return el ? el.value : ''; };
  const cur = fUnitOf(d, d.unit);
  const wire = (id, field) => {
    const el = $(`#${id}`);
    if (!el) return;
    el.onchange = () => {
      if (id === 'fUnit' && el.value === 'all') { go('all'); return; }
      // everything to the RIGHT of the changed box is left to fUnitResolve,
      // which drops what the set cannot honour rather than offering a dead board
      const want = {
        trade: val('fUnit'),
        ctx1: field === 'trade' ? null : val('fUnitA1'),
        ctx2: field === 'trade' || field === 'ctx1' ? null : val('fUnitA2'),
        geometry: field === 'geometry' ? val('fUnitGeom') : null,
      };
      if (!want.trade || want.trade === 'all') { go('all'); return; }
      // a box the owner has not touched this time keeps what the board already
      // has, so changing the shape alone does not throw away the alongside pair
      if (field !== 'trade' && cur && cur.trade === want.trade) {
        if (want.ctx1 == null) want.ctx1 = cur.ctx1 || '';
        if (want.ctx2 == null) want.ctx2 = cur.ctx2 || '';
        if (want.geometry == null) want.geometry = cur.geometry;
      }
      go(fUnitResolve(d, want));
    };
  };
  wire('fUnit', 'trade');
  wire('fUnitA1', 'ctx1');
  wire('fUnitA2', 'ctx2');
  wire('fUnitGeom', 'geometry');
}

function fWireCut(d, st, cd) {
  fWireUnit(st, d);
  fWireCutPick(st, d);
  // WIRED BEFORE THE EARLY RETURN, with the two pickers. A set that will not
  // OPEN is exactly the one most likely to want deleting, and a control drawn
  // above a panel that never rendered has to be wired above it too.
  const dl = $('#fCutDelete');
  if (dl && st.cut && st.cut !== F_NEW) {
    dl.onclick = async () => {
      const id = st.cut;
      const look = await tryPost(`api/stageset/${encodeURIComponent(id)}/delete`, {});
      if (!look) return;
      if (!look.preview) { alert('Nothing was deleted — the service answered strangely.'); return; }
      const typed = prompt(`Permanently delete ${look.name} (stage ${look.stage}, ${look.status})?\n\n`
        + `${Number(look.rows).toLocaleString()} record row(s), ${(look.bytes / 1048576).toFixed(1)} MB on disk`
        + `${look.desc ? `\n"${look.desc}"` : ''}\n\nType the record set id back to confirm:\n${look.confirmWith}`, '');
      if (typed === null) return;
      if (typed.trim() !== look.confirmWith) { alert('That is not the record set id — nothing was deleted.'); return; }
      const done = await tryPost(`api/stageset/${encodeURIComponent(id)}/delete`, { confirm: typed.trim() });
      if (done && done.deleted) {
        alert(`Deleted ${done.name} — ${Number(done.rows).toLocaleString()} row(s), ${(done.bytes / 1048576).toFixed(1)} MB freed.`);
        // the same two lines the picker uses when it is moved to new rule:
        // the set that was chosen is gone, so the screen cannot stay in it
        st.cut = F_NEW; st.setRebuiltSaid = null; fSave(); drawFunnel();
      }
    };
  }
  // the panels below exist only when the set opened; the two above are the way
  // out of one that did not, so they are wired first and unconditionally
  if (!cd) return;
  const rn = $('#fCutRename');
  if (rn) rn.onclick = async () => {
    const box = $('#fCutName');
    const out = await tryPost(`api/stageset/${encodeURIComponent(cd.set.id)}/name`, { name: box.value });
    if (!out) return;
    box.value = out.name || '';
    $('#fCutNameMsg').textContent = `renamed ${String(out.nameEditedAt || '').slice(0, 16)}`;
    // AND THE NAME AT THE TOP CHANGES WITH IT, ON THE SPOT (owner order,
    // 2026-09-04). It used to wait for a whole redraw -- seconds on a big
    // board -- and until then the title and the drop-down both still showed
    // the old name, which reads as a rename that did not take.
    const title = $('#fTitleName');
    if (title) title.textContent = out.name || '';
    const sel = $('#fCutPick');
    if (sel) [...sel.options].forEach((o) => { if (o.value === cd.set.id) o.textContent = out.name || ''; });
  };
  // PUTTING THIS SET'S OWN NUMBERS BACK (3.68.0, owner order). Started and
  // polled, because it prices; it refuses while a sweep is going and says so.
  const sr = $('#fSetRebuild');
  if (sr) sr.onclick = async () => {
    sr.disabled = true;
    $('#fSetRebuildMsg').textContent = 'working them out - this prices this set\'s own settings again';
    const started = await tryPost(`api/funnel/set/${encodeURIComponent(cd.set.id)}/rebuild`, {}, WHERE_FUNNEL);
    if (!started) { sr.disabled = false; $('#fSetRebuildMsg').textContent = ''; return; }
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const p = await api(`api/funnel/set/${encodeURIComponent(cd.set.id)}/rebuild`).catch(() => null);
      if (!p) { sr.disabled = false; $('#fSetRebuildMsg').textContent = 'the service stopped answering - nothing was written'; return; }
      if (p.error) { sr.disabled = false; $('#fSetRebuildMsg').textContent = `FAILED - ${p.error}`; return; }
      if (p.result) {
        sr.disabled = false;
        st.setRebuiltSaid = `worked out for ${Number(p.result.own || 0).toLocaleString()} of this set's settings and kept on it`;
        fSave(); drawFunnel();
        return;
      }
      $('#fSetRebuildMsg').textContent = p.of ? `working them out - ${Number(p.done).toLocaleString()} of ${Number(p.of).toLocaleString()} settings` : 'working them out';
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 1500));
    }
  };
  document.querySelectorAll('[data-fcsort]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.fcsort;
      if (st.cutSort !== k) { st.cutSort = k; st.cutDir = k === 'label' ? 'asc' : 'desc'; }
      else if (st.cutDir === 'desc') st.cutDir = 'asc';
      else { st.cutSort = null; st.cutDir = null; }
      fSave(); drawFunnel();
    };
  });
}

function fRuleBox(d, st) {
  const clauses = st ? fRuleClauses(st) : [];
  return `<h3 style="margin-top:0">The rule so far</h3><p class="note">${esc(fRuleWords(d.ruleSentence))}</p>
    ${clauses.length ? `<ul class="note frule">${clauses.map((c) => `<li>${esc(c.text)} <button data-frm="${esc(`${c.kind}|${c.key}`)}">remove</button></li>`).join('')}</ul>` : ''}
    <div class="row"><button id="fClear">start the rule again</button>
      <span class="note">keeps the set open and clears every choice - recorded as going back</span></div>`;
}

// FOLLOWING A READING OF THE OTHER UNITS (§17.3): started on the box and
// polled every two seconds, the count of boards read on the line beside the
// button. The result is kept under the rule it was read for; a result the box
// holds for some other reading (another rule, another window) is left alone.
// FOLLOWING A READING OF THE CROSSES (§18): started on the box and polled every
// two seconds, with what is left worked out from the pairs already read rather
// than from the estimate the screen showed before it began.
async function fCrossFollow(st, status) {
  const asked = st.crossesAsked;
  if (!asked) return;
  let s = status;
  for (;;) {
    if (!s) {
      try { s = await api(`api/funnel/${encodeURIComponent(st.set)}/crosses`); } catch (_) { s = null; }
      if (!s || s.none || s.token !== asked.token) { st.crossesAsked = null; fSave(); if ($('#fCrosses')) drawFunnel(); return; }
    }
    if (s.error) {
      st.crossesAsked = null;
      st.crossesFailed = { key: asked.key, why: s.error };
      fSave(); drawFunnel();
      return;
    }
    if (s.result) {
      st.crosses = { key: asked.key, result: s.result };
      st.crossesAsked = null; st.crossesFailed = null;
      fSave(); drawFunnel();
      return;
    }
    const m = $('#fCrossMsg');
    if (m) m.textContent = `read ${s.done} of ${s.of}${s.msEach ? ` - about ${fSecs((s.of - s.done) * s.msEach)} left` : ''}`;
    await new Promise((resolve) => { setTimeout(resolve, 2000); });
    if (fState !== st) return;                       // the walk on screen is another one now
    s = null;
  }
}

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

// WATCHING STEP 6's RUN (3.81.0). One at a time per page: a redraw re-enters
// fWire, and two loops asking the same door would fight over the same line.
let fRichWatching = false;
async function fRichWatch(st) {
  if (fRichWatching) return;
  fRichWatching = true;
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const p = await api(`api/funnel/${encodeURIComponent(st.set)}/rebuild`).catch(() => null);
      const msg = $('#fRebuildMsg');
      if (!p) { if (msg) msg.textContent = 'the service stopped answering — nothing was written'; return; }
      if (p.error) { if (msg) msg.textContent = `FAILED — ${p.error}`; return; }
      if (p.result) {
        const out = p.result;
        // the tables of the set are not built yet, so there were no survivors
        // to work anything out for. Said plainly; nothing was priced.
        if (out.totalling || out.waiting) {
          if (msg) msg.textContent = out.waiting || 'the tables of this set are being worked out — this step reads them when they land';
          return;
        }
        st.rebuilt = true;
        // THE PROOF IS SHOWN, NOT ASSUMED. An unchecked rebuild must never look
        // checked, so the absence of a check is printed as plainly as a failed one.
        const pr = out.proof || {};
        // THE TRUE COUNT, NOT THE LENGTH OF A CAPPED LIST (3.57.3)
        const off = pr.differed == null ? (pr.mismatches || []).length : pr.differed;
        // AND IT IS KEPT ON THE WALK, NOT WRITTEN STRAIGHT ONTO THE SCREEN (3.65.1,
        // owner report). The numbers this button works out are laid onto the
        // survivors by the next READ, and this used to paint its answer and stop --
        // so the two limits below it went on saying "no survivor carries this number
        // yet - press work out the missing numbers first" directly underneath "all
        // 640 match what the sweep stored". Both were on screen at once and one of
        // them was false. The walk holds what was said, the screen is drawn again,
        // and the proof survives the redraw.
        st.rebuiltSaid = pr.ran
          ? (off
            ? `${off} of ${pr.checked} setting(s) came back different from what the sweep stored - this is not the same run`
            : `done for ${out.settings} setting(s); all ${pr.checked} match what the sweep stored`)
          : `done for ${out.settings} setting(s) - NOT checked against the sweep (${String(pr.why || '')})`;
        fSave();
        fRichWatching = false;           // the redraw re-enters fWire, and by then there is nothing to watch
        drawFunnel();
        return;
      }
      if (msg) {
        msg.textContent = (p.of ? `working them out — ${Number(p.done || 0).toLocaleString()} of ${Number(p.of).toLocaleString()} settings`
          : 'working them out') + fCpuWords(p.cpu);
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 1500));
    }
  } finally { fRichWatching = false; }
}

function fWire(st, d) {
  // EVERY RECORDED STEP CARRIES THE COUNT THE PAGE HAD IN HAND (3.88.1): the
  // number of settings the rule so far keeps on the walked board, from the read
  // this screen was drawn from -- never re-read, never worked out here. No read
  // in hand is null, never 0: an unknown is not a zero.
  const fCount = () => (d && d.survivors != null && Number.isFinite(Number(d.survivors)) ? Number(d.survivors) : null);
  const fRecord = (step) => st.steps.push({ ...step, survivors: fCount() });
  const fRecordBack = (back) => st.backSteps.push({ ...back, survivors: fCount() });
  const go = (n, why) => {
    if (n < st.step) fRecordBack({ from: st.step, to: n, why: why || null });
    else if (n > st.step) markStep(st.step);
    st.step = n; fSave(); drawFunnel();
  };
  document.querySelectorAll('[data-fstep]').forEach((b) => { b.onclick = () => go(Number(b.dataset.fstep)); });
  fWireCutPick(st, d);
  const t = $('#fTarget');
  if (t) t.onchange = () => { st.target = t.value === '' ? null : Math.max(0, Math.floor(Number(t.value) || 0)); fRememberForSet(st.set, { target: st.target }); fSave(); drawFunnel(); };
  const bb = $('#fBar');
  if (bb) bb.onchange = () => {
    const v = bb.value === '' ? null : Math.max(1, Math.min(100, Math.floor(Number(bb.value) || 0)));
    st.barPct = v; fRememberForSet(st.set, { barPct: v }); fSave(); drawFunnel();
  };
  fWireUnit(st, d);
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
    if (step === 3 && c.interact) mark('interact', 3, `${fDialLabel(st.dialA || '')} x ${fDialLabel(st.dialB || '')}`);
    if (step === 5 && c.regionNotWider) mark('regionNotWider', 5);
    if (step === 5 && c.regionPapered) mark('regionPapered', 5);
    // ON EVERY STEP, not one of them (3.70.0): losing to the obvious thing is
    // not a fact about step 5, it is a fact about the rule, and walking past
    // any step with it true is walking past it.
    if (c.losesToBuyHold) mark('losesToBuyHold', step);
    if (c.losesToShortHold) mark('losesToShortHold', step);
    if (step === 5 && c.regionAcross) mark('regionAcross', 5);
    if (step === 5 && c.regionReach) mark('regionReach', 5);
    if (c.checkIsHalves) mark('checkIsHalves', step);
  };
  // a row on step 1 opens step 2 with that dial chosen
  document.querySelectorAll('[data-fnarrow]').forEach((b) => {
    b.onclick = () => { markStep(1); st.dial = b.dataset.fnarrow; st.step = 2; fRecord({ n: 1, what: 'which dial to narrow next', chose: fDialLabel(st.dial) }); fSave(); drawFunnel(); };
  });
  // a word-valued dial keeps a list of values, not a range
  const kv = $('#fKeepValues');
  if (kv) kv.onclick = () => {
    if (!st.dial) return;
    const vals = [...document.querySelectorAll('[data-fval]')].filter((x) => x.checked).map((x) => x.dataset.fval);
    if (!st.rule.allowed) st.rule.allowed = {};
    if (!vals.length) delete st.rule.allowed[st.dial]; else st.rule.allowed[st.dial] = vals;
    markStep(2);
    fRecord({ n: 2, what: `the values of ${fDialLabel(st.dial)}`, chose: vals.join(', ') || 'none' });
    fSave(); drawFunnel();
  };
  const ar = $('#fAddRange');
  if (ar) ar.onclick = () => {
    if (!st.dial) return;
    const lo = $('#fMin').value;
    const hi = $('#fMax').value;
    const alsoNone = !!($('#fAlsoNone') && $('#fAlsoNone').checked);
    if (!st.rule.allowed) st.rule.allowed = {};
    if (lo === '' && hi === '' && alsoNone) {
      // NONE AND NOTHING ELSE (3.62.0, owner order). Kept as a VALUE, which is
      // the shape the rule already has for "this dial is one of these" -- the
      // settings with no value for the dial answer to the name none, so nothing
      // new had to be invented and the rule reads "dMult (d) is none".
      delete st.rule.ranges[st.dial];
      st.rule.allowed[st.dial] = ['none'];
      markStep(2);
      fRecord({ n: 2, what: `the values of ${fDialLabel(st.dial)}`, chose: 'none' });
    } else if (lo === '' && hi === '') {
      delete st.rule.ranges[st.dial];
      delete st.rule.allowed[st.dial];
      markStep(2);
      fRecord({ n: 2, what: `the shape of ${fDialLabel(st.dial)}`, chose: `${lo} to ${hi}` });
    } else {
      st.rule.ranges[st.dial] = { min: lo === '' ? null : Number(lo), max: hi === '' ? null : Number(hi), ...(alsoNone ? { also: ['none'] } : {}) };
      // A RANGE REPLACES A none-ONLY CLAUSE on the same dial. Left in place the
      // two would both apply, and a range plus "is none" keeps nothing at all.
      delete st.rule.allowed[st.dial];
      markStep(2);
      fRecord({ n: 2, what: `the shape of ${fDialLabel(st.dial)}`, chose: `${lo} to ${hi}${alsoNone ? ' or none' : ''}` });
    }
    fSave(); drawFunnel();
  };
  // the count line follows the boxes as they are edited, from the table on
  // screen -- the range boxes and the also keep none tick alike
  const countRange = () => {
    const lo = $('#fMin').value; const hi = $('#fMax').value;
    const none = !!($('#fAlsoNone') && $('#fAlsoNone').checked);
    // both boxes clear with the tick on keeps none and nothing else (3.62.0)
    const onlyNone = none && lo === '' && hi === '';
    let kept = 0; let total = 0;
    for (const [val, n] of ((st.read || {}).groups || [])) {
      const v = Number(val);
      total += n;
      if (Number.isFinite(v) ? (!onlyNone && (lo === '' || v >= Number(lo)) && (hi === '' || v <= Number(hi))) : (String(val) === 'none' && none)) kept += n;
    }
    const kc = $('#fKeepCount');
    if (kc) kc.textContent = `keeps ${kept.toLocaleString()} of ${total.toLocaleString()}${st.target ? ` - target ${Number(st.target).toLocaleString()}` : ''}`;
  };
  for (const id of ['fMin', 'fMax']) {
    const el = $(`#${id}`);
    if (el) el.oninput = countRange;
  }
  const an = $('#fAlsoNone');
  if (an) an.onchange = countRange;
  // AND THE TICK BOXES (owner, 2026-09-04: "why when i uncheck the 'true'
  // checkbox on the weekdaysOnly dial does the record count not change?").
  // The count line beside keep these values follows the ticks the same way
  // the range boxes' line follows their edits, from the table on screen.
  document.querySelectorAll('[data-fval]').forEach((box) => {
    box.onchange = () => {
      const on = new Set([...document.querySelectorAll('[data-fval]')].filter((x) => x.checked).map((x) => String(x.dataset.fval)));
      let kept = 0; let total = 0;
      for (const [val, n] of ((st.read || {}).groups || [])) { total += n; if (on.has(String(val))) kept += n; }
      const kc = $('#fKeepCount');
      if (kc) kc.textContent = `keeps ${kept.toLocaleString()} of ${total.toLocaleString()}${st.target ? ` - target ${Number(st.target).toLocaleString()}` : ''}`;
    };
  });
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
    fRecord({ n: 3, what: `a block on ${fDialLabel(st.dialA)} x ${fDialLabel(st.dialB)}`, chose: `${va[0]}..${va[va.length - 1]} x ${vb[0]}..${vb[vb.length - 1]}${pk ? '' : ' (recommended)'}` });
    fSave(); drawFunnel();
  };
  // WHICH CROSSES ARE WORTH READING (§18). The switch keeps the list up to date
  // as the rule narrows; the button reads them once. Both are always drawn.
  const startCrosses = async () => {
    const key = fCrossKey(st);
    const started = await tryPost(`api/funnel/${encodeURIComponent(st.set)}/crosses`,
      { rule: st.rule, unit: st.unit, barPct: st.barPct, floor: st.floor });
    if (!started) { const b = $('#fCrosses'); if (b) b.disabled = false; return; }
    st.crossesAsked = { key, token: started.token };
    fSave();
    fCrossFollow(st, started);
  };
  const cx = $('#fCrosses');
  if (cx) cx.onclick = () => { cx.disabled = true; st.crossesFailed = null; startCrosses(); };
  const cxOn = $('#fCrossOn');
  if (cxOn) cxOn.onchange = () => { st.crossesOn = cxOn.checked; st.crossesFailed = null; fSave(); if (st.crossesOn) startCrosses(); else drawFunnel(); };
  // ON THE SWITCH, A RULE THAT HAS MOVED READS ITSELF AGAIN (§18.4) -- and a
  // reading that FAILED is not, or a reading that cannot work would be started
  // on every single draw.
  const crossKey = fCrossKey(st);
  const crossHeld = st.crosses && st.crosses.key === crossKey;
  const crossBad = st.crossesFailed && st.crossesFailed.key === crossKey;
  if (cx && st.crossesOn && !crossHeld && !crossBad && !st.crossesAsked) startCrosses();
  // a reading started before the page was left is followed again, not asked twice
  else if (cx && st.crossesAsked && st.crossesAsked.key === crossKey && !crossHeld) fCrossFollow(st, null);
  document.querySelectorAll('[data-fcross]').forEach((b) => {
    b.onclick = () => {
      const [ca, cb] = String(b.dataset.fcross).split('|');
      st.dialA = ca; st.dialB = cb;
      // §15.6: a choice the machine put in front of the owner is recorded as
      // such, in the same shape a hand-picked one is
      fRecord({ n: 3, what: 'the cross to read', chose: `${fDialLabel(ca)} x ${fDialLabel(cb)}`, fromList: true });
      fSave(); drawFunnel();
    };
  });
  const ax = $('#fAcross');
  if (ax) ax.onclick = async () => {
    ax.disabled = true;
    const ruleKey = fAcrossKey(st);
    const started = await tryPost(`api/funnel/${encodeURIComponent(st.set)}/across`, { rule: st.rule, unit: st.unit, barPct: st.barPct });
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
    const said = a4.clearBar != null
      ? `accepted ${a4.positive} of ${a4.of} other units positive; ${a4.clearBar} clear the bar`
      : `accepted ${a4.positive} of ${a4.of}; the check managed ${best.length ? Math.max(...best) : '-'} of ${a4.of}`;
    // the mark is for accepting with some slice NOT positive; all positive is
    // not something to be marked for
    if (a4.positive != null && a4.of != null && a4.positive < a4.of) mark('slices', 4, said);
    if ((st.conditions || {}).checkIsHalves) mark('checkIsHalves', 4);
    fRecord({ n: 4, what: 'does it hold elsewhere', chose: said });
    st.step = 5; fSave(); drawFunnel();
  };
  const ra = $('#fRegionAtLeast');
  const rre = $('#fRegionReach');
  const rr = $('#fRegionRead');
  const setAtLeast = () => {
    const v = ra && ra.value !== '' ? Number(ra.value) : 0;
    st.regionAtLeast = Number.isFinite(v) ? v : 0;
    const n = rre && rre.value !== '' ? Math.floor(Number(rre.value)) : 1;
    st.regionReach = Number.isFinite(n) && n >= 1 ? n : 1;
    st.regionAcross = [...document.querySelectorAll('[data-facross]')].filter((x) => x.checked).map((x) => x.dataset.facross);
    fSave(); drawFunnel();
  };
  if (rr) rr.onclick = setAtLeast;
  if (ra) ra.onchange = setAtLeast;
  if (rre) rre.onchange = setAtLeast;
  document.querySelectorAll('[data-facross]').forEach((box) => { box.onchange = setAtLeast; });
  // THE OWNER'S OWN RULE, WHOLE, INTO STEP 6 (3.64.0, owner order). Nothing on
  // step 5 is written; the set will say the widest region was never kept.
  const km = $('#fKeepMine');
  if (km) km.onclick = () => {
    markStep(5);
    fRecord({ n: 5, what: 'the widest region', chose: 'not kept - my own rule carried on whole' });
    st.step = 6; fSave(); drawFunnel();
  };
  const kr = $('#fKeepRegion');
  if (kr) kr.onclick = () => {
    const keep = (st.read || {}).keep;
    if (!keep) return;
    const ranges = {}; const allowed = {};
    for (const [dial, b] of Object.entries(keep.ranges)) ranges[dial] = { min: b.min, max: b.max };
    for (const [dial, v] of Object.entries(keep.allowed)) allowed[dial] = v.slice();
    // THE RULE THE OWNER BUILT IS KEPT BEFORE IT IS REPLACED (3.61.0, owner
    // order). This button throws away every range and value chosen on steps 2
    // and 3, and until now the only trace left was the words in the walk's
    // recorded steps. The rule itself now rides to the cut and onto the set.
    st.userRule = { ranges: JSON.parse(JSON.stringify(st.rule.ranges || {})), allowed: JSON.parse(JSON.stringify(st.rule.allowed || {})) };
    st.rule.ranges = ranges; st.rule.allowed = allowed;
    markStep(5);
    const loosened = [
      st.regionAtLeast ? `counted in at ${st.regionAtLeast}` : '',
      Number(st.regionReach) > 1 ? `joined up to ${Math.floor(Number(st.regionReach))} apart` : '',
      (st.regionAcross || []).length ? `joined across ${st.regionAcross.map(fDialLabel).join(', ')}` : '',
    ].filter(Boolean);
    fRecord({ n: 5, what: 'the widest region', chose: `kept as the rule (${Object.keys(ranges).length + Object.keys(allowed).length} dial(s))${loosened.length ? `, ${loosened.join(', ')}` : ''}` });
    fSave(); drawFunnel();
  };
  // CONTINUOUSLY, AS THEY ARE TYPED (3.81.0). Debounced so a held-down key is
  // one question and not thirty, and stamped so a slow answer to an older
  // keystroke can never overwrite the newer one -- that is how a count ends up
  // showing a number for a value that is no longer in the box.
  const kp = $('#fFloorsKeeps');
  if (kp) {
    let asked = 0;
    let timer = null;
    const ask = async () => {
      const mine = ++asked;
      // askPost, never tryPost: this changes nothing, and a popup on every
      // keystroke is unusable -- the line just says it could not be read.
      const out = await askPost(`api/funnel/${encodeURIComponent(st.set)}/keeps`,
        { rule: fRuleWithFloors(st), unit: st.unit }, null);
      if (mine !== asked) return;                       // a newer keystroke is already out
      const el = $('#fFloorsKeeps');
      if (!el) return;
      el.textContent = out ? fKeepsWords(out.keeps, out.of, st.target) : 'how many these limits would leave could not be read';
    };
    for (const id of ['fDD', 'fTrades']) {
      const b = $(`#${id}`);
      if (!b) continue;
      b.oninput = () => { clearTimeout(timer); timer = setTimeout(ask, 200); };
    }
  }
  const af = $('#fAddFloors');
  if (af) af.onclick = () => {
    const dd = $('#fDD').value;
    const tr = $('#fTrades').value;
    if (dd === '') delete st.rule.floors.maxDrawdown; else st.rule.floors.maxDrawdown = { max: Number(dd) };
    if (tr === '') delete st.rule.floors.avgTrades; else st.rule.floors.avgTrades = { min: Number(tr) };
    markStep(6);
    fRecord({ n: 6, what: 'exposure', chose: `worst streak ${dd}, fewest trades ${tr}` });
    fSave(); drawFunnel();
  };
  // ONE PRESS, START TO FINISH (3.81.0). It starts the run, watches it, and
  // draws the values in when it lands -- no second press, and nothing held
  // open for the gateway to give up on. A page reloaded in the middle picks
  // the run back up from the read, because the read carries it.
  const rb = $('#fRebuild');
  if (rb && !rb.disabled) {
    rb.onclick = async () => {
      rb.disabled = true;
      $('#fRebuildMsg').textContent = 'working them out — this prices the survivors again from their parent set';
      // THE RULE, NOT A LIST OF NAMES (3.57.1): the walk holds the rule, the
      // service holds the settings, and the survivors are worked out there --
      // the same rule, the same unit and the same bar every other read sends
      const started = await tryPost(`api/funnel/${encodeURIComponent(st.set)}/rebuild`,
        { rule: st.rule, unit: st.unit, barPct: st.barPct }, WHERE_FUNNEL);
      if (!started) { rb.disabled = false; $('#fRebuildMsg').textContent = fRichLine(d); return; }
      await fRichWatch(st);
    };
  }
  // and if one is already going -- another tab pressed it, or this page was
  // reloaded -- it is watched without anything being pressed
  if (fRichGoing(d)) fRichWatch(st);

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
    fRecord({ n: 7, what: 'how to reach the target', chose: key });
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
    // STARTED, THEN FOLLOWED (3.67.0, owner order: the press must not freeze the
    // page). The service comes straight back and this asks how far it is, the
    // same way step 3's reading of every pair and step 4's reading across the
    // other units already do -- so nothing is held open long enough for the
    // gateway to give up, and every other screen keeps answering while it runs.
    const started = await tryPost(`api/funnel/${encodeURIComponent(st.set)}/cut`, {
      name: $('#fName').value || null, target: st.target, rule: st.rule,
      steps: st.steps, backSteps: st.backSteps, closing: st.closing || { key: 'rule' },
      marks: st.marks || [],
      userRule: st.userRule || null,               // what step 5 replaced, if it ran
      unit: st.unit,
      barPct: st.barPct,
    }, WHERE_FUNNEL);
    const out = started ? await fCutFollow(st) : null;
    cut.disabled = false;
    if (!out) { $('#fCutMsg').textContent = ''; return; }
    // THE SET JUST WRITTEN IS WHAT IS SHOWN (3.66.0, owner order 2026-09-04:
    // "the behavior needs to be refresh the new item into the Stage 4 record
    // set list at the top and then display that new record set"). The redraw
    // re-reads the list from the box, so the set is on the box at the top, and
    // landing on it puts its name, its rule, its count, what the closing did
    // and any warning it was written with on the screen -- everything the one
    // line beside this button used to say, and the whole set besides.
    if (out.id) { st.cut = out.id; fSave(); return drawFunnel(); }
    // no id came back, so there is nothing to land on: say it here instead.
    // 'tighten the ranges toward the middle' can stop short of the target, and
    // a set written with 480 against a target of 400 has to say it narrowed.
    const cd = (out.closing && out.closing.detail) ? ` - ${out.closing.detail}` : '';
    $('#fCutMsg').textContent = `${out.name} written for ${out.unitName || 'all units together'} `
      + `with ${out.survivors} setting(s)${cd}${(out.warnings || []).length ? ` - ${out.warnings.join(' - ')}` : ''}`;
    return undefined;
  };
  // one clause out, the rest untouched, recorded in the walk's notes
  document.querySelectorAll('[data-frm]').forEach((b) => {
    b.onclick = () => {
      const [kind, key] = String(b.dataset.frm).split('|');
      if (!st.rule || !st.rule[kind] || !(key in st.rule[kind])) return;
      const gone = fRuleClauses(st).filter((c) => c.kind === kind && c.key === key).map((c) => c.text).join('; ');
      delete st.rule[kind][key];
      if (!st.steps) st.steps = [];
      fRecord({ n: st.step, what: `removed from the rule: ${gone}`, chose: 'removed' });
      fSave(); drawFunnel();
    };
  });
  const cl = $('#fClear');
  if (cl) cl.onclick = () => {
    fRecordBack({ from: st.step, to: 1, why: 'started the rule again' });
    st.rule = { ranges: {}, allowed: {}, floors: {} };
    st.closing = { key: 'rule' }; st.userRule = null;
    st.step = 1; st.rebuilt = false; st.rebuiltSaid = null; fSave(); drawFunnel();
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
