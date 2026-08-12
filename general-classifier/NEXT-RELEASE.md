# General Classifier — next release: development plan notes

Working document. Owner dictates points; no code until the explicit go.
Feasibility remarks are the session's, marked [feasibility].

## 1. New "Live Trading" tab; future split-out as a subscription product

Owner (2026-08-12): Make a new tab called **Live Trading**. That tab and the
existing **Bracket Lab** will eventually become a **separate application**,
offered on a **subscription basis**.

[feasibility]
- The tab itself is straightforward — the current pilot screen (pilot.html) is
  effectively the Live Trading surface already; this formalizes it as a tab in
  the main UI's tab structure.
- The future split-out should shape HOW we build now: keep Live Trading +
  Bracket Lab code modular (own routes, own libs, minimal imports from the
  research side) so the extraction is a lift, not a rewrite. Shared primitives
  (paper-trade lib, Binance data layer, candle cache) need an explicit "shared
  core" boundary, since both halves of the split will need them.
- Subscription = multi-user. Today the whole site is single-owner behind one
  Basic Auth. A subscription product needs real auth (accounts/sessions),
  billing, and per-user data isolation. That's a product-scale work item, not a
  tab-scale one — fine as a destination, but the release plan should treat
  "tab now, product later" as two separate milestones.
- Flag for later decision: subscription *Live Trading* for third parties raises
  questions single-owner use never had — whose exchange API keys execute, per-
  user risk controls, and the regulatory posture of offering trade execution to
  subscribers. Bracket Lab (analytics/backtesting) has none of that weight. It
  may be worth planning the split-out as analytics-first, live-trading-second.

## 2. Zero AI interaction in all Bracket Lab + Live Trading functionality

Owner (2026-08-12): ALL functionality ultimately provided on the Bracket Lab
and Live Trading tabs must be **entirely devoid of AI interaction**.

[feasibility]
- Achievable, and mostly already true: today's classification path, training
  (lib/logreg.js, zero imports), committee voting, executor, and display path
  are all deterministic code — the existing hard constraint ("no AI/LLM/API
  calls anywhere in the classification path") already covers the runtime. This
  point extends that constraint from the classification path to the ENTIRE
  product surface of both tabs, which the plan should state as a standing
  product invariant, not a per-feature choice.
- Interpretation being carried forward (correct if unchallenged): the
  constraint binds the PRODUCT at runtime — no LLM/AI calls in any request
  path, no AI-generated runtime content, every number reproducible from
  deterministic code + market data. AI (sessions) remains a development-time
  tool only: it writes/reviews the code, but nothing it does is in the shipped
  execution or analytics path.
- For a subscription product this is a differentiator worth designing around:
  every result auditable and re-derivable — no "the model said so" black box in
  the paid surface. Enforcement should be structural (the split-out app simply
  has no AI dependency, no API keys to any AI service in its environment), so
  the guarantee is checkable, not aspirational.

## 3. Live Trading tab: self-service, API-key capture, per-setup configurability, separable execution engine

Owner (2026-08-12): Whatever is developed for the Live Trading tab must not
require any AI intervention to operate. The app WILL capture exchange API keys
(owner acknowledges the reservation about keys co-located with other
functions). Design so the trading box can be SPLIT OUT as a separate function,
configurable in the software one way or the other. **Everything must be
configurable per trading setup on the Live Trading tab.**

[feasibility]
- The deep implication: every lifecycle operation that currently runs through a
  session by hand — deploying the executor, installing timers, provisioning the
  arm secret, editing ~/.executor-env, wiring a new pair/model — must become an
  in-app, owner/user-operable function. "No AI intervention" is therefore not
  just a runtime property (point 2) but an OPERABILITY requirement: the tab is
  a control plane, not a dashboard.
- "Trading setup" becomes a first-class entity. Today everything is hardwired
  to one setup (F1/LTCUSDT: one intent producer, one box, one key, one timer
  set, deploy-time config). The plan needs a setup record carrying at minimum:
  model/committee reference, traded pair, clip size, entry/exit geometry
  (frozen per model), protective stop, execution target, API-key reference,
  and its own arm switch + journal. The current single-pilot machinery becomes
  an instance of it.
- Execution engine as a separable, configurable component: the existing seams
  are already clean (intent file -> executor; journal back; ARM carry; HMAC'd
  switch). Formalize them into a versioned control-plane/execution-agent
  protocol so a setup can point at (a) an executor on the same host, or (b) a
  remote box (like today's Mexico host), chosen per setup in software. This is
  the natural path — the architecture is already message-passing; it needs a
  defined protocol + registration/config instead of hand-run scp/ssh scripts.
- API-key capture needs a deliberate security design (to be its own plan
  point): encrypted at rest, write-only from the UI (never displayed back),
  scoped keys enforced/verified (trade-only, no withdrawal), per-setup key
  association, and keys delivered to the execution component rather than
  resident in the web tier. Current posture (key exists ONLY on the execution
  box, IP-whitelisted) is the strongest form; the design should preserve as
  much of that as multi-setup self-service allows. Options belong in a design
  round, not here.

## 4. Greenlight pipeline: Bracket Lab -> Live Trading

Owner (2026-08-12):
- Only configurations fully tested to the point of being GREENLIGHTED on the
  Bracket Lab can go live.
- A button shuttles a greenlighted Bracket Lab config onto a NEW setup on the
  Live Trading tab.
- The Live Trading tab pages through live trading setups; each setup has its
  own API key and potentially a different server (execution target).
- The configuration itself always originates from a greenlighted Bracket Lab
  config — no hand-built live configs.

[feasibility] Clean. Needs: a formal "greenlighted" state on Bracket Lab
configs (criteria to be defined), an immutable config snapshot at shuttle time
(so later lab edits can't mutate a live setup), and the per-setup entity from
point 3 (key + server + arm switch each). No blockers.

## 5. Generalize the trading engine: fully parameter-driven from the lab config

Owner (2026-08-12): The trading engine functionality must be generalized to be
fully configurable from the parameters of the shuttled Bracket Lab config —
the config becomes a new live trading job.

[feasibility] This is the core engineering item of the release. Today's
executor hardcodes F1's shape (LTCUSDT, $10 clip, 01:00 entry, 137h hold,
daily cadence, market entries). Generalizing means every lab-expressible
parameter (pair, geometry/offsets, cadence, clip, entry/exit style, stop,
committee/model) drives the producer + executor from the job record instead of
constants. The lab simulator (lib/bracket.js) and the live engine must share
ONE parameter vocabulary so a greenlighted config means the same thing live —
any parameter the engine reinterprets differently from the lab breaks the
greenlight's meaning (the QC-register instrumentation lesson applies).

## 6. Build location: inside general-classifier now, factor out later

Owner (2026-08-12): All of this is built into the EXISTING general-classifier
project. The Bracket Lab + Live Trading tabs are planned to be factored out
into a new separate application at the end.

[feasibility] Fine. Discipline to hold while building: keep the two tabs'
backend code in their own modules with a clean boundary to the research side,
so the eventual factor-out is file moves, not surgery.

## 7. Future (post-split) update: alternate exchange platforms

Owner (2026-08-12): A possible future update to the factored-out application:
selecting ALTERNATE exchange/trading platforms, making the subscription
available to Americans and Canadians (Binance is unavailable/restricted there).

[feasibility] Future item, but it costs almost nothing to prepare for now:
put the exchange behind an adapter interface (data fetch + order placement +
account read) instead of importing Binance directly in the generalized engine
(point 5). Data geometry (1h klines) is exchange-neutral; fees/filters/margin
semantics differ per venue and would live in the adapter.

## 8. Future app: setup/settings page

Owner (2026-08-12): The subscription application will have a setup page for
trading account settings, possibly API keys, email addresses, etc. — whatever
is relevant to using the software.

[feasibility] Standard. Note the overlap with point 3: per-setup keys live on
the Live Trading tab; the setup page holds the account-level settings (user
identity, notification email, defaults). Worth keeping that split explicit
when the page is designed.

## 9. Compute placement: subscriber CPU by default, configurable per function

Owner (2026-08-12):
- CPU for setup discovery, sweeps, null checks, AND trading itself defaults to
  the SUBSCRIBER'S LOCAL machine. The interface stays web-based on a server we
  host/rent; engine components are offloaded by default to subscriber CPU.
- Our own use of the current software keeps running compute on the VPS.
- The client will be able to select processing options per function — e.g.
  local system for crunching permutations, a hosted system for live trading,
  perhaps a separate hosted VPS to manage trades.
- All of this must be configurable in the final app; what we build NOW must be
  at least COMPATIBLE with that split even if not directly supporting it.

[feasibility]
- The architecture is already message-passing (intent -> executor, journal
  back, config in files), which is exactly what makes compute placement
  configurable. Today's Mexico box is already a "remote engine component."
- The one constraint worth honoring now for compatibility: define jobs/intents/
  journals as TRANSPORT-NEUTRAL messages. Today the control plane pushes over
  ssh/scp to hosts we own; a subscriber's local machine can't take inbound
  connections, so the future worker must DIAL OUT (agent connects/polls/
  websockets home). Building now against message schemas — not against "we can
  always ssh there" — keeps every future placement option open.
- Pleasant consequence: subscriber-local trading means their exchange keys can
  stay on THEIR machine — the strongest form of the point-3 key posture.

## 10. Ultimate system: subscriber database, login front page, per-user tool set

Owner (2026-08-12): The ultimate system will have a subscriber database, a
login front page, and then access to the tool set and the user's own
configurations.

[feasibility] Standard product plumbing (accounts, auth, per-user config
storage). One prep note for now: key current data (setups, greenlights,
journals) by an owner/user id even while there is only one user, so the
subscriber-database migration is a backfill, not a re-model.

## 11. Key custody: zero-knowledge storage, user-side decryption, no trading from our facilities

Owner (2026-08-12):
- Trading will NEVER be performed from our own facilities.
- Provide a guided interface for the user to: generate API keys for Binance
  SUB-ACCOUNTS, and generate a PRIVATE KEY of their own with which their API
  keys are encrypted before storage on our server.
- Encrypted API keys live in our database; WE CANNOT decrypt them — no access,
  by construction.
- The trading engine — wherever the user configures it (their local machine or
  a hosted VPS of theirs) — holds that private key and decrypts the API key
  for use on the trading machine.

[feasibility] Sound, standard zero-knowledge envelope design: our DB is a
blind vault (ciphertext only); plaintext keys exist only on the user's
execution host. This resolves the point-3 custody tension completely.
Clarifies point 9: "hosted" execution options are always user-procured hosts —
never ours. Two UX details for the design round: (a) key-loss is unrecoverable
BY DESIGN — the flow is simply re-key (regenerate exchange keys, re-encrypt),
and the UI should say so plainly; (b) the guided sub-account walkthrough
should also verify the key's scope (trade-only, no withdrawal) before
accepting it.

## 12. UTS interface reorg: two-tier tabs (NOT in current general classifier)

Owner (2026-08-12): In the Ultimate Trading System (UTS) — not the current
general classifier — the Bracket Lab interface gets cleaned up and organized
into groups with tabs, replacing today's single flow that can scroll for
thousands of lines:
- Top tier of tabs: **Settings | Bracket Lab | Live Trading**.
- Within Bracket Lab (especially), sub-tabs breaking up: locally stored data,
  profile configurations, reporting-while-permutations-run, resulting tables,
  null sweeps, history tuning, setup comparisons, etc.
- Live Trading also gets sub-tabs where useful.
- NO reorg of the current general classifier's Bracket Lab — but the Live
  Trading tab we build NOW should already be essentially in this shape, since
  it is being built from scratch.

[feasibility] Clear. Actionable now: design the new Live Trading tab with the
sub-tab structure from day one (e.g. setups pager | key/engine config |
journals/reporting), so it carries into UTS unchanged.

## 13. Bracket Lab: full provenance per candidate config, under one job name

Owner (2026-08-12):
- The Bracket Lab must record EVERY candidate config's full provenance.
- Job names get organized logically, building on the existing prefix field at
  the top of the Bracket Lab (the "campaign" field): a GENERAL job name, and
  then everything run while narrowing toward a candidate — the sweeps, the
  null checks, the history tuning, whatever else — all lives UNDER that same
  single job.
- That provenance is stored with the final result.

[feasibility] Clean fit — the campaign prefix already exists as the seed of
this. Work is making the job a real parent entity (not a name convention):
child runs attach to it, and the final candidate's record carries the full
chain. Ties into point 4: the greenlight shuttle then hands Live Trading a
config whose entire evidentiary history travels with it.

## 14. UTS Bracket Lab: guided, flow-ordered interface with branching

Owner (2026-08-12):
- The sub-tab layout under the UTS Bracket Lab should correspond to the
  TYPICAL FLOW of narrowing down jobs, so users understand the process as a
  sequence of steps.
- Branching is allowed: multiple candidates can share the same starting point
  and branch out at selections indicating good plateaus, good null sweeps, etc.
- Net: the Bracket Lab interface is a GUIDED interface that takes the user
  through the steps.

[feasibility] Good pairing with point 13 — the provenance parent job gives the
guided flow its data model for free: each branch is a child chain under the
same job, and the UI walks/visualizes that tree. The flow order itself (wide
screen -> drill -> null -> tune -> compare -> greenlight) mirrors the research
discipline already in use here; encoding it as the tab sequence is the same
methodology, productized.

---
Points 15-19: session-proposed, owner-accepted 2026-08-12 (15 modified by
owner: paper stage must be OPTIONAL).

## 15. OPTIONAL paper-first stage per setup (bypassable)

A new live setup can run in paper mode on the user's own engine — same
intents, same journal, no orders — before arming real money. **Optional by
owner decision:** the user must be able to BYPASS paper and go straight to
live with small trades ("deeper pockets" users). Default flow offers paper;
never forces it.

## 16. Safety rails shipped as per-setup product features

Mirror check with auto-disarm, dead-man arm keepalive, intent staleness gate,
chunk dedup, drift backstop, loss-limit halt, incident alerts to the user's
email — everything the F1 pilot runs on, generalized to every setup.

## 17. Execution-fidelity reporting per setup

Fill deviation, realized fee/leg vs model, live-vs-lab tracking — the pilot
screen's metrics as a standard per-setup report: "is live matching what the
lab promised."

## 18. Engine version in provenance; upgrades cannot silently change a greenlight

The provenance record (point 13) includes the engine version. On engine
upgrade, setups are either pinned to their validated version or flagged for
re-validation.

## 19. Subscriber workers fetch their own market data — with a controlled catalog and self-repair

Each user's worker pulls candles directly from the exchange's public channel;
we never redistribute market data (cleaner legally, no bottleneck on us).

Owner amendment (2026-08-12): local data is fine, but it must be MANAGED:
- A **catalog/library under the user's profile that WE control** — a
  server-side manifest of what data the user's system is supposed to have
  (pairs, ranges, files/checksums).
- A **known path** to the user's local data on whatever machine runs the
  engine — the worker registers where its data lives; never an unknowable
  scatter.
- **Missing-data detection and repair:** if the user deletes files locally,
  the system flags the data as MISSING against the catalog and can REBUILD it
  (re-download from the exchange's public channel) rather than failing on
  file-not-found errors.

[feasibility] Clean — the catalog is the source of truth, the local store is a
rebuildable cache. The current cache layout (month bundles + day files per
pair) already fits a manifest-with-checksums model; verify-against-catalog and
re-fetch-what's-missing becomes a standard worker operation (run on start, on
schedule, and on any read miss).

## 20. Live trade size configurable per trading setup

Owner (2026-08-12): The user's live trade size (clip) is configurable per
trading setup. Rationale: trade-size scale is personal — a small test trade
for one user ($10) may not be worth another user's time; they may want to
test at $100 or more.

[feasibility] Fits the point-3 setup entity directly. One design note for
later: the lab validates at a model fee/leg that is a % of clip in effect —
size changes fee proportionality and exchange minimums, so the setup form
should sanity-bound the clip (>= exchange min notional) but size itself
doesn't invalidate a greenlight.

## 21. Subscription pricing — DECIDED DIRECTION (owner, 2026-08-12)

- **Trial:** two weeks, everything unlocked, PLUS a permanent free
  paper-only tier. Free users cost near-zero (compute is subscriber-local,
  point 9; they fetch their own data, point 19); the paper book performing
  over time is the conversion funnel, and "subscribe to go live" is the
  conversion moment.
- **NOT tied to trade size.** Two structural reasons: (a) unverifiable — the
  engine and keys live on the user's machine (points 9/11), so size would be
  self-reported and spoofable, and auditing it would contradict the
  zero-knowledge privacy posture; (b) posture — flat software subscription
  keeps the clean "we sell tools" position for US/Canada entry (point 7),
  while volume-linked pricing has adviser-adjacent optics (lawyer check
  before ever revisiting) and an incentive-alignment problem.
- **Tier on what the control plane can see and enforce:** number of
  concurrent LIVE setups, number of parallel lab campaigns/branches, later
  multi-exchange access. Sketch: Free (paper only) -> Base (1-2 live
  setups) -> Trader (~5) -> Pro (unlimited + alternate exchanges when they
  land).
- Selling point that falls out: "we can't see how big you trade, and we
  don't charge you for it."

## 22. Thorough help system

Owner (2026-08-12): A very thorough help system throughout — screenshots and
examples everywhere, tooltips on everything.

## 23. Guided VPS selection, setup, and verification

Owner (2026-08-12): Because the product asks users to distribute engine
functionality to configurable back ends, the system must provide guided VPS
selection and setup — pointing users at sensible options (e.g. an AWS server
in Mexico, or an IONOS VPS in Mexico) — with direct in-product support for
performing that setup AND verifying it works.

[feasibility] The verification half is the part to design deliberately: after
guided provisioning, the worker/agent should run a self-check the user can see
(connectivity to the exchange from that region, time sync, data path writable,
key decryption works, control-plane reachability) and report a green/red
checklist back to the tab. Region guidance matters because exchange
reachability is geographic (the reason today's execution box is in Mexico);
the guide should encode "which regions work for which exchange."

## Amendment to 15 (owner, 2026-08-12): paper trades live in the same tab

Paper trading is integrated under the SAME Live Trading tab with IDENTICAL
display and formatting as live setups — the only difference is a clear marker
that it is a paper trade, not real money. No separate paper view.

## 24. UTS look and feel: consistent across tabs, dark + light modes

Owner (2026-08-12): The UTS interface needs consistency across all tabs.
Provide a DARK mode styled like the existing F1 test page (pilot.html) and a
LIGHT mode styled like the existing Bracket Lab. Owner preference: the more
technical/compressed style of the F1 test page sets the tone.

[feasibility] Straightforward: one shared stylesheet with theme tokens
(dark/light), the pilot page's compact technical density as the baseline.
Actionable now: the new Live Trading tab (built from scratch) adopts this
shared-token approach from day one, so it carries into UTS unchanged.

---
## Delivery map (plan 9.2 — which phase delivers which point; honest gaps)

| Point | Delivered by | Status/gap |
|---|---|---|
| 1 Live Trading tab | Phase 5 (livetrading.html) | shipped; portal tile (website branch) pending |
| 2 zero-AI surface | all phases (deterministic code only) | structural |
| 3 per-setup config/keys/servers | Phases 1, 8 (registry, targets); keyRef plumbing | key CAPTURE UI = UTS (11) |
| 4 greenlight shuttle | Phase 4 | shipped |
| 5 generalized engine | Phases 2-3 (+ parity PASS) | executor deploy = plan 10.3 |
| 6 build here, factor later | lib/live/ + livetrading.html boundary | structural |
| 7 alt exchanges | Phase 8.2 adapter seam | future adapter = UTS |
| 8 setup page | — | UTS |
| 9 subscriber CPU | transport-neutral messages + targets (8.1) | worker dial-out = UTS |
| 10 subscriber DB/login | ownerId on every record | UTS |
| 11 zero-knowledge keys | keyRef presence-only discipline | custody flow = UTS |
| 12 two-tier tabs | Phase 5 sub-tabs (Live Trading born in shape) | Bracket Lab reorg = UTS |
| 13 provenance under one job | Phase 4 (campaign+manifest+run in greenlight) | tree BROWSER = UTS |
| 14 guided lab flow | — | UTS (data model ready via 13) |
| 15 optional paper | Phase 3 paper mode + state machine bypass | shipped (badge in tab) |
| 16 safety rails per setup | Phases 3, 6 (allowlist, stops, mirror, alerting) | disarm-on-break wiring with 10.3 |
| 17 fidelity per setup | Phase 6 (view + tab) | shipped |
| 18 engine version in provenance | version.js in greenlight/setup | shipped |
| 19 catalog + repair | Phase 7 | shipped (worker form = UTS) |
| 20 per-setup trade size | Phase 1 clipUsd + allowlist clip cap | shipped |
| 21 pricing | decided direction recorded | UTS |
| 22 help system | — | UTS |
| 23 guided VPS setup | targets registry is the hook | UTS |
| 24 theming | Phase 5 tokens (dark F1 / light lab) | shipped |
