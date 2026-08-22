# The words on every screen of the Construct page

GENERATED - do not edit by hand. Rebuild with:

```
node tests/sweep-words.js --write
```

Owner order, 2026-08-21: **these are the only words that may be used to
talk about anything on these screens.** Not a style preference - a
fabricated label sends the owner hunting for a control that was never
there, and it makes every other statement suspect.

Taken out of the function that draws each tab in `public/construct.js`,
and out of the choice lists the page fills its dropdowns from. Tooltips
are deliberately excluded: hover text is not a name, and using it as one
is the same fault wearing a disguise.

## The tabs

- **Data**
- **Sweep**
- **Boards**
- **Verify**
- **History**
- **Tune**
- **Greenlight**
- **Help**

Read from `TABS` in `public/construct.js`.

---

# Data

## What the controls are called (7)

- `Data on server`
- `Download`
- `Download / refresh`
- `download new pair(s), comma-sep`
- `from`
- `Global Refresh`
- `to`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (4)

- Every sweep, null board and tune reads this cache, never the exchange — a gap here silently
- shrinks every window. Refresh re-fetches from the newest cached month (it may have been partial) through the
- current month. Trim keeps only a range, deleting the rest. Purge deletes the whole asset. Every write refuses
- while a job runs; purge and trim DELETE data — the only way back is downloading again.

## Every word, flat (67)

```
again. and asset. back been board cache cached comma-sep current Data data DELETE deletes deleting Download download downloading Every every exchange from gap Global have here is it job keeps may month month. never new newest null on only pair partial Purge purge range re-fetches reads Refresh refresh refuses rest. runs server shrinks silently sweep the this through to Trim trim tune way while whole window. write
```

---

# Sweep

## What the controls are called (45)

- `— on this box —`
- `1-in-`
- `agree`
- `all loaded data`
- `arm`
- `band % (or auto)`
- `Beating all is at best a`
- `branch`
- `Campaign — the parent chain name`
- `Campaign “ ” — runs & greenlights`
- `chunk shape`
- `claim`
- `Currently set:`
- `d`
- `decision`
- `Delete campaign…`
- `doubles`
- `end`
- `entry`
- `ETA`
- `existing campaigns`
- `gate`
- `min trades`
- `null boards`
- `or a new name`
- `permute`
- `Phase`
- `promote top K`
- `Rate`
- `Running:`
- `Set`
- `singles`
- `start`
- `Start sweep`
- `Stop jobs`
- `t`
- `trail`
- `trailing plane`
- `Trainings`
- `triples`
- `Units`
- `View tree`
- `window layout`
- `with contexts`
- `x`

## What the dropdowns offer (43)

- `0.25×`
- `0.5×`
- `0.75×`
- `0×`
- `1.5×`
- `1/6`
- `1/8`
- `1×`
- `113h`
- `137h`
- `161h`
- `17h`
- `2/6`
- `2/8`
- `2×`
- `3/6`
- `3/8`
- `4/6`
- `4/8`
- `41h`
- `5/6`
- `5/8`
- `6/6`
- `6/8`
- `61/13/13/13 (sealed exam)`
- `65h`
- `7/8`
- `70/15/15`
- `8/8`
- `89h`
- `active`
- `always`
- `argmax`
- `breakout`
- `Daily 1-day`
- `Daily 2-day`
- `Daily 3-day`
- `Daily 4-day`
- `directional`
- `legacy 80/20 (never evidence)`
- `market`
- `static`
- `Weekly 8-day`

## Sentences the page prints (15)

- Every run launched while a campaign is set attaches to it: sweeps, null rounds, tuning passes,
- scans. The campaign's whole chain travels with any greenlight minted from it.
- Board sweep — wide to FIND (never a result)
- universe (blank = all 17 default pairs)
- replication: also score every DECLARED config on every asset
- description — why this run exists (rides in the job heading forever)
- “ ” is locked — nothing has been deleted.
- setup(s) on the Trade tab are still deployed. Retire them there first:
- Deleting “ ” will permanently remove:
- This cannot be undone.
- “ ” deleted.
- Removed run(s), greenlight(s), setup(s),
- and the saved models and tuning files belonging to them.
- declared configs, each scored on every asset — roughly x the replication work.
- the work — the whole run once for real, then once per board.

## Every word, flat (181)

```
1-day 1-in- 113h 137h 161h 17h 2-day 3-day 4-day 41h 65h 8-day 89h active agree all also always and any are argmax arm asset at attaches auto band be Beating been belonging best blank Board board. boards box branch breakout Campaign campaign campaigns cannot chain chunk claim config configs contexts Currently Daily data decision DECLARED declared default Delete deleted. Deleting deployed. description directional doubles each end entry ETA Every every evidence exam existing exists files FIND first for forever from gate greenlight greenlights has heading in is it it. job jobs launched layout legacy loaded locked market min minted models name never new nothing null on once or pairs parent passes per permanently permute Phase plane promote Rate real remove Removed replication result Retire rides roughly rounds run Running runs saved scans. score scored sealed set Set setup shape singles start Start static still Stop sweep sweeps tab the The them them. then there this This to top Trade trades trail trailing Trainings travels tree triples tuning undone. Units universe View Weekly while whole why wide will window with work work.
```

---

# Boards

## What the controls are called (36)

- `— pick a run —`
- `, l);`
- `· assets / (context)`
- `· beat always-long /`
- `'; return; }`
- `accuracy`
- `assets held up`
- `assets held up (context)`
- `beat always-long`
- `beat its own null copies`
- `beat its own nulls`
- `const censusFileFor = (l) => {`
- `const d = await apiOr(`
- `const file = censusFileFor(l);`
- `const start = await post(`
- `echoed by the vote`
- `edge`
- `first, then by`
- `held-back $`
- `how much of its`
- `Open`
- `opening the setup…`
- `own measured null it beat`
- `participation`
- `plateau`
- `plateau width`
- `predictability`
- `q · · h`
- `real / null rows`
- `saved runs`
- `showing 400 of`
- `test $`
- `This run recorded`
- `total held-back`
- `try {`
- `vs always-long`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (47)

- Asset predictability — best to worst
- KEY — for each asset: of all real-versus-null match-ups on HELD-BACK money, the share the real
- setups won. 100% means every real setup beat every null copy; 0% means every null copy beat every real setup;
- 50% means the real setups are indistinguishable from dealt votes.
- Counts below are INFERRED, not measured.
- declared-cell rows without marking which copy scored them, so each asset's first-recorded row is taken as the
- real one — real copies are queued ahead of every null copy. row(s) were excluded.
- Replication — the declared config on every asset
- KEY — one FIXED configuration, named before the run, scored once on each asset.
- is the reading that counts: the same configuration on dealt votes, which is the
- only yardstick the register admits.
- says whether the setting is sturdy or a knife edge.
- is CONTEXT ONLY — crypto assets move together, so it is not a count of independent
- looks and no p-value is quoted from it. Money is last on purpose. held-back $ is the once-only look on data
- no search touched; test $ is the window the settings were chosen on and flatters itself by construction.
- Replication — declared configs, ranked
- KEY — each line is ONE declared configuration scored on every asset. Ranked by
- , then by the across-asset share, then by money.
- That order is the register's: an ordering is a claim about which row is better, so only statistics the register
- admits as evidence may sit in it (QC-7, QC-142). The across-asset share is shown as CONTEXT — assets move
- together, so it is not a count of independent looks. Open a line to see that configuration on every asset.
- These configurations were SEARCHED, not declared, so the honest end is the sealed slice: window layout
- 61/13/13/13, graded once in the History section.
- pickedDoc = null; if (out) drawBoards();
- const cr = (doc.edgeCensus || []).find((r) => r.nullDealSeed == null && !r.shiftFrac
- && r.trade === l.trade && (r.ctx1 || '') === (l.ctx1 || '') && (r.ctx2 || '') === (l.ctx2 || '')
- && r.geometry === l.geometry && r.decision === l.decision);
- return cr && cr.modelFile ? cr.modelFile.split('/').pop() : null;
- // INSPECT — a microscope on one setup: what each member saw, how it voted, and
- // how alike the members are. It is NOT a null test and cannot say whether the
- // setup works; that caveat travels with the panel because the panel invites
- // exactly that misreading.
- $('#bBody').querySelectorAll('button[data-inspect]').forEach((b) => {
- b.onclick = async () => {
- const l = leaders[Number(b.dataset.inspect)];
- if (!file) { $('#gridOut').innerHTML = '
- this row has no stored votes file (older run) — inspect needs the persisted committee votes
- $('#gridOut').innerHTML = '
- const q = l.quorum ?? 1;
- Columns read the HELD-BACK window where the run has one, the search window otherwise.
- Accuracy and edge are ACCURACY POINTS, never money.
- how alike the members are (pairwise agreement) — near-duplicates make an agreement count read higher than the number of independent opinions behind it
- $('#bBody').querySelectorAll('button[data-grid]').forEach((b) => {
- const l = leaders[Number(b.dataset.grid)];
- this row has no stored votes file (older run) — the grid needs the persisted committee votes
- re-scoring the full menu from the stored votes…
- $('#gridOut').innerHTML = renderPlateau(cells, l) + rankLine +

## Every word, flat (281)

```
.find .forEach .innerHTML .pop .querySelectorAll about accuracy Accuracy ACCURACY across-asset admits admits. agreement ahead alike all always-long an and apiOr are are. as Asset asset asset. assets async await b.dataset.grid b.dataset.inspect b.onclick bBody beat because before behind below best better button by cannot caveat cells censusFileFor chosen claim Columns committee config configs configuration configurations const construction. CONTEXT context copies copy copy. count Counts counts cr cr.modelFile cr.modelFile.split crypto data data-grid data-inspect dealt declared declared-cell doc.edgeCensus drawBoards each echoed edge edge. end every evidence exactly excluded. file first first-recorded FIXED flatters for from full graded grid gridOut has held HELD-BACK held-back higher History honest how if in independent indistinguishable INFERRED INSPECT inspect invites is it It it. its itself KEY knife l.ctx1 l.ctx2 l.decision l.geometry l.quorum l.trade last layout leaders line look looks looks. make marking match-ups may means measured measured. member members menu microscope misreading. money Money money. move much named near-duplicates needs never no not NOT null nulls Number number of older on once once-only one ONE only ONLY Open opening opinions or order ordering otherwise. out own p-value pairwise panel participation persisted pick pickedDoc plateau POINTS post predictability purpose. QC-142 QC-7 queued quoted r.ctx1 r.ctx2 r.decision r.geometry r.nullDealSeed r.shiftFrac r.trade ranked Ranked rankLine re-scoring read reading real real-versus-null recorded register renderPlateau Replication return row rows run runs same saved saw say says scored sealed search SEARCHED section. see setting settings setup setups share showing shown sit slice so start statistics stored sturdy taken test than that That the The them then These This this to together total touched travels try up vote voted votes votes. vs were what where whether which width window with without won. works worst yardstick
```

---

# Verify

## What the controls are called (3)

- `current:`
- `null boards`
- `Run the planted check`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (24)

- Planted check — the instrument's calibration certificate
- Regenerates a fabricated pair carrying a KNOWN planted rule and fires it through the full sweep +
- null pipeline. PASS = the board found the plant, profited, beat always-long, and every null board destroyed it.
- A pass belongs to the engine version that earned it; a new release starts NOT CHECKED.
- Tool 1 — this row against its null runs
- Compares the picked REAL run against a SCRAMBLE run (a sweep launched with scrambled labels): each
- scrambled world re-shops the whole menu in the same test window, and its best find must beat the selected row.
- The draws come from a sweep launched with
- above zero on the Sweep section — that is the box
- that makes a run appear in the list below. Read the verdict here. ALWAYS VISIBLE — a gate failing judges the INSTRUMENT,
- never retires the candidate on one number.
- Rotation rounds — a SEPARATE instrument, retired as evidence
- This button used to sit inside Tool 1 saying its rounds were what that tool reads. They are not.
- It fires the ROTATION null: each round rotates outcomes against features and replays the whole downstream search
- on the selected row. Its output lands on this run's own record and is shown below — nowhere else — and it creates
- none of the dealt-vote rows Tool 1 pairs against. Those come from launching a sweep with
- above zero on the Sweep section.
- The register marks this construction RETIRED as evidence
- (historical reading only), so a number from it is
- never a claim. It stays operable because a run that already carries one must remain readable.
- Tool 2 — the board against its dealt-vote null boards
- For each promoted row: how many of its null copies (same setup, votes dealt onto random days) its
- HELD-BACK money beats. With N null boards the finest honest claim is 1 in N+1. Computed from the run's own stored
- null rows — needs a sweep launched with null boards &gt; 0.

## Every word, flat (190)

```
above against against. already ALWAYS always-long and appear are as beat beats. because belongs below below. best board boards box button calibration candidate carries carrying certificate check CHECKED. claim claim. come Compares Computed construction copies creates current days dealt dealt-vote destroyed downstream draws each earned else engine every evidence fabricated failing features find finest fires For found from full gate gt HELD-BACK here. historical honest how in inside instrument INSTRUMENT is it It it. its Its judges KNOWN labels lands launched launching list makes many marks menu money must needs never new none NOT not. nowhere null number number. of on one only onto operable outcomes output own pair pairs PASS pass picked pipeline. plant Planted planted profited promoted random re-shops Read readable. reading reads. REAL record Regenerates register release remain replays retired RETIRED retires rotates Rotation ROTATION round rounds row row. rows rule Run run runs same saying SCRAMBLE scrambled search section section. selected SEPARATE setup shown sit so starts stays stored sweep Sweep test that the The They this This Those through to Tool tool used verdict version VISIBLE votes were what whole window with With world zero
```

---

# History

## What the controls are called (5)

- `engine`
- `exam status loading…`
- `Finished tuning runs`
- `half-life`
- `loading…`

## What the dropdowns offer (3)

- `12mo`
- `24mo`
- `36mo`

## Sentences the page prints (10)

- History Tuning — change ONE variable (training-history length) and price the effect
- One variable per run, declared before it fires (the confirm discipline): the same frozen trading
- cell, trained on windows of different depth, priced on the same folds. The reading rule is stamped at launch.
- Age dial (HT v2) — one declared half-life vs the reference, paired folds
- PLAIN WORDS: instead of cutting history off, the age dial DOWN-WEIGHTS old days smoothly. One
- half-life (how many days back a sample's influence falls to half) is declared, then priced against the
- no-dial reference on ~20 paired folds — same folds, same frozen trading cell, so the ONLY difference is the
- dial. The table's verdict is the paired money difference, fold by fold.
- Run exam A (late-rule pair — must find)
- Run exam B (flat pair — must NOT find)

## Every word, flat (98)

```
12mo 24mo 36mo against Age age and at back before by cell change confirm cutting days declared depth dial dial. difference different discipline DOWN-WEIGHTS effect engine exam falls find Finished fires flat fold fold. folds folds. frozen half half-life History history how HT influence instead is it late-rule launch. length loading many money must no-dial NOT of off old on ONE One one ONLY pair paired per PLAIN price priced reading reference rule run Run runs same sample smoothly. so stamped status table the The then to trading trained training-history Tuning tuning v2 variable verdict vs windows WORDS
```

---

# Tune

## What the controls are called (21)

- `— uplift`
- `: tightest no-winner-lost stop`
- `apply custom`
- `Chance check:`
- `Compare`
- `Compare two runs — NOT a null test`
- `Exposure:`
- `holds one window layout ( ),`
- `No stop (clear)`
- `or apply a custom stop`
- `per-$ → ; worst trade ;`
- `q h of )`
- `run A`
- `run B`
- `save the reason`
- `scan target`
- `the row selected on Boards (`
- `the saved book`
- `Verdict:`
- `your reason for this choice`
- `your setup`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (20)

- Protective stop tuner — full-history, loses no winner
- Replays the frozen committee over ALL history and finds the tightest fixed stop that would not have
- clipped a single winner, plus the sacrifice curve (give up top winners → tighter stop → NET $). Scanning applies
- nothing. Target: .
- of your setup(s) and saved book(s) without a protective stop
- Tune protective stop (full history)
- currently applied on the trading machine:
- Conviction sizing — bet more when more members agree?
- Prices the DECLARED clip ladder (multiplier = winning-side vote count) as a pure $ overlay on the
- same full-history replay, against a shuffled-assignment chance check and exposure-honest metrics.
- Target: .
- Run conviction sweep (full history)
- — empty: compare a 'both' run's own two sides —
- winners / losers over entries.
- NET = winner $ given up + loss-side $ vs no stop; positive means the stop helps. Apply buttons exist
- only for the running engine; for a lab row the number informs the greenlight instead.
- over priced entries: flat vs ladder
- shuffled deals, mean uplift , p= .
- drawdown ; peak concurrent (flat ).
- so there is no second side of it to compare against — pick a run B.

## Every word, flat (156)

```
against agree ALL and applied applies apply Apply as B. bet Boards book both buttons chance Chance check choice clear clip clipped committee Compare compare concurrent Conviction conviction count currently curve custom deals DECLARED drawdown empty engine entries entries. exist Exposure exposure-honest finds fixed flat for frozen full full-history give given greenlight have helps. history holds informs instead. is it lab ladder layout losers loses loss-side machine mean means members metrics. more multiplier NET no No no-winner-lost not NOT nothing. null number of on one only or over overlay own peak per- pick plus positive priced Prices Protective protective pure reason replay Replays row Run run running runs sacrifice same save saved scan Scanning second selected setup shuffled shuffled-assignment side sides single sizing so stop sweep Target target test that the there this tighter tightest to top trade trading Tune tuner two up uplift Verdict vote vs when window winner winners winning-side without worst would your
```

---

# Greenlight

## What the controls are called (2)

- `Existing greenlights`
- `Trade tab`

## What the dropdowns offer (3)

- `best cell`
- `declared cell`
- `widest region`

## Sentences the page prints (5)

- Greenlight — the decision that a config is fit to trade
- Records WHO/WHEN/WHY with the exact frozen config, engine version, and the campaign's whole
- evidentiary chain. The config then appears on the Trade tab (both sides) for activation. Only greenlighted
- configs ever trade — no hand-built live configs, ever.
- activation, deactivation and nuking live on the

## Every word, flat (49)

```
activation activation. and appears best both campaign cell chain. config configs deactivation decision declared engine ever ever. evidentiary exact Existing fit for frozen Greenlight greenlighted greenlights hand-built is live no nuking on Only Records region sides tab that the The then to trade Trade version WHO/WHEN/WHY whole widest with
```

---

# Help

## What the controls are called (1)

- `None of it can be pressed or`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (7)

- Help — what every control on every screen does
- One entry for every box, tick, dropdown and button on the seven screens.
- The list of controls is read from the screens themselves, so nothing can be left out of it
- quietly: a control with no description says so, in place, rather than being missing.
- Everything shown below is a dead copy.
- changed — it is a picture of the control, put beside its description so you can see which
- one is being talked about. The real ones are on their own tabs.

## Every word, flat (70)

```
about. and are be being below beside box button can changed control controls copy. dead description does dropdown entry every Everything for from Help in is it its left list missing. no None nothing of on One one ones or out own picture place pressed put quietly rather read real says screen screens screens. see seven shown so tabs. talked than the The their themselves tick what which with you
```

