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

## Which screen this describes

Generated from **30d904032136 — what the box is serving**, not from the working tree.

That distinction is the whole point. Between a commit and its deploy the
two describe different screens, and on 2026-08-22 exactly that happened: a
control was renamed, the deploy was held back so a running sweep would
survive, and this list then authorised a name that was nowhere on the
owner's screen. A word list generated from code nobody is looking at is
the rule failing in the direction the rule exists to prevent.

So the source is read back out of the commit the box last deployed and
checked against the hashes it reported. A mismatch refuses rather than
guesses. `SERVED.json` holds that record; re-capture it with
`vps-access/scripts/uts-served-fingerprint.sh` after every deploy.

**A label you have just changed will not appear here until it is
deployed, and that is correct** - until then the owner cannot see it.

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

## What the controls are called (11)

- `Data on server`
- `Download`
- `Download / refresh`
- `download new pair(s), comma-sep`
- `from`
- `Global Refresh`
- `purge…`
- `refresh to latest`
- `regenerate to span`
- `to`
- `trim…`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (6)

- Every sweep, null board and tune reads this cache, never the exchange — a gap here silently
- shrinks every window. Refresh re-fetches from the newest cached month (it may have been partial) through the
- current month. Trim keeps only a range, deleting the rest. Purge deletes the whole asset. Every write refuses
- while a job runs; purge and trim DELETE data — the only way back is downloading again.
- fabricated pair — mirrors the real data's span, never downloaded; trimming it would corrupt the exam it exists to be
- nothing cached yet — download below

## Every word, flat (83)

```
again. and asset. back be been below board cache cached comma-sep corrupt current Data data DELETE deletes deleting download Download downloaded downloading Every every exam exchange exists fabricated from gap Global have here is it job keeps latest may mirrors month month. never new newest nothing null on only pair partial Purge purge range re-fetches reads real Refresh refresh refuses regenerate rest. runs server shrinks silently span sweep the this through to Trim trim trimming tune way while whole window. would write yet
```

---

# Sweep

## What the controls are called (58)

- `” — runs & greenlights`
- `” will permanently remove:`
- `1-in-`
- `agree`
- `all loaded data`
- `also try moving stops`
- `arm`
- `band % (or auto)`
- `Beating all`
- `branch`
- `Campaign — the parent chain name`
- `Campaign “`
- `chunk shape`
- `claim`
- `Currently set:`
- `d`
- `decision`
- `Delete campaign…`
- `Deleting “`
- `doubles`
- `end`
- `entry`
- `ETA`
- `existing campaigns`
- `gate`
- `greenlight(s),`
- `greenlights:`
- `is at best a`
- `MB`
- `min trades`
- `no runs yet`
- `null boards`
- `on this box —`
- `or a new name`
- `permute`
- `Phase`
- `promote top K`
- `Rate`
- `Removed`
- `run(s),`
- `Running:`
- `Set`
- `setup(s),`
- `singles`
- `start`
- `Start sweep`
- `Stop jobs`
- `t`
- `The last job did not finish:`
- `trail`
- `Trainings`
- `triples`
- `Units`
- `View tree`
- `window layout`
- `with contexts`
- `x`
- `x the replication work,`

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

## Sentences the page prints (17)

- Every run launched while a campaign is set attaches to it: sweeps, null rounds, tuning passes,
- scans. The campaign's whole chain travels with any greenlight minted from it.
- Board sweep — wide to FIND (never a result)
- universe (blank = all 17 default pairs)
- replication: also score every DECLARED config on every asset
- description — why this run exists (rides in the job heading forever)
- No job running.
- ” is locked — nothing has been deleted.
- setup(s) on the Trade tab are still deployed. Retire them there first:
- nothing but the name — this campaign holds no runs, greenlights or setups.
- This cannot be undone.
- ” deleted.
- and the saved models and tuning files belonging to them.
- declared configs, each scored on every asset — roughly
- per unit).
- the work — the whole run once for real, then once per board.
- Open it on the Boards section to see what it managed to record

## Every word, flat (201)

```
1-day 1-in- 113h 137h 161h 17h 2-day 3-day 4-day 41h 65h 8-day 89h active agree all also always and any are argmax arm asset at attaches auto band be Beating been belonging best blank Board board. boards Boards box branch breakout but Campaign campaign campaigns cannot chain chunk claim config configs contexts Currently Daily data decision DECLARED declared default Delete deleted. Deleting deployed. description did directional doubles each end entry ETA Every every evidence exam existing exists files FIND finish first for forever from gate greenlight greenlights has heading holds in is it it. job jobs last launched layout legacy loaded locked managed market MB min minted models moving name never new No no not nothing null on once Open or pairs parent passes per permanently permute Phase promote Rate real record remove Removed replication result Retire rides roughly rounds run Running running. runs saved scans. score scored sealed section see set Set setup setups. shape singles start Start static still Stop stops sweep sweeps tab the The them them. then there this This to top Trade trades trail Trainings travels tree triples try tuning undone. unit Units universe View Weekly what while whole why wide will window with work yet
```

---

# Boards

## What the controls are called (77)

- `— pick a run —`
- `— watch it on the Sweep section`
- `, plus`
- `· assets`
- `· beat always-long`
- `” will permanently remove:`
- `” will score what it never got to:`
- `(context)`
- `accuracy`
- `all failures`
- `already scored, kept as they are`
- `assets held up`
- `assets held up (context)`
- `at agreement`
- `beat always-long`
- `beat its own null copies`
- `beat its own nulls`
- `branch(es)`
- `campaign:`
- `clear selection`
- `combos ×`
- `copy settings into the form`
- `Data fingerprint:`
- `declared configs, ranked`
- `Delete run…`
- `Deleting “`
- `echoed by the vote`
- `edge`
- `first, then by`
- `h`
- `held-back $`
- `how much of its`
- `inspect`
- `menu grid`
- `Menu grid —`
- `menu grid failed:`
- `no per-member detail in this dump`
- `no row selected yet`
- `of`
- `Open`
- `order by`
- `own measured null it beat`
- `participation`
- `permutations, test window only)`
- `picked up`
- `Picking up “`
- `plateau`
- `plateau width`
- `predictability`
- `q`
- `real / null rows`
- `region`
- `Replication —`
- `Resume run`
- `save notes`
- `saved runs`
- `selected:`
- `showing`
- `showing 400 of`
- `Size:`
- `slim runs ·`
- `still to score`
- `Survivor board — the promoted rows`
- `test $`
- `that failed and get another go`
- `the inspect record, verbatim`
- `the run itself`
- `This run did not finish —`
- `this run has been picked up`
- `This run recorded`
- `time(s) already`
- `total held-back`
- `unit(s) FAILED`
- `units ·`
- `vs always-long`
- `What this run actually is`
- `Your cell sits at #`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (60)

- Asset predictability — best to worst
- KEY — for each asset: of all real-versus-null match-ups on HELD-BACK money, the share the real
- setups won. 100% means every real setup beat every null copy; 0% means every null copy beat every real setup;
- 50% means the real setups are indistinguishable from dealt votes.
- Counts grow until the sweep finishes — do not judge yet.
- Counts below are INFERRED, not measured.
- declared-cell rows without marking which copy scored them, so each asset's first-recorded row is taken as the
- real one — real copies are queued ahead of every null copy.
- row(s) were excluded.
- rows for this configuration — the rest are recorded and can be read from the run's stored rows.
- Replication — the declared config on every asset
- KEY — one FIXED configuration, named before the run, scored once on each asset.
- is the reading that counts: the same configuration on dealt votes, which is the
- only yardstick the register admits.
- says whether the setting is sturdy or a knife edge.
- is CONTEXT ONLY — crypto assets move together, so it is not a count of independent
- looks and no p-value is quoted from it. Money is last on purpose. held-back $ is the once-only look on data
- no search touched; test $ is the window the settings were chosen on and flatters itself by construction.
- KEY — each line is ONE declared configuration scored on every asset. Ranked by
- , then by the across-asset share, then by money.
- That order is the register's: an ordering is a claim about which row is better, so only statistics the register
- admits as evidence may sit in it (QC-7, QC-142). The across-asset share is shown as CONTEXT — assets move
- together, so it is not a count of independent looks. Open a line to see that configuration on every asset.
- These configurations were SEARCHED, not declared, so the honest end is the sealed slice: window layout
- 61/13/13/13, graded once in the History section.
- Open a run to see its board.
- notes — why this run exists, what it showed, what it cost
- promote runs.
- Every null claim on this page is against
- units.
- STAMP FAILED — this run cannot be proved comparable to any other
- A failed unit is missing from every count on this page — the denominator is smaller than the run intended. First:
- This run held nothing back.
- Every dollar below is from the window the settings were CHOSEN on, so it flatters itself by construction and cannot say whether anything works out of sample. The null tools are unavailable for this run.
- KEY — setup: traded + context coins; shape: chunk geometry · decision · band; cell: agreement/entry/hold;
- trades: entries in the test window; test $: profit-and-loss in dollars on the window the settings were CHOSEN on
- (flattering by construction); held-back $: the once-only look that matters; vs nulls: how many of the row's dealt-vote
- null copies its held-back money beat. Click a row to SELECT it — the selection drives Verify's Tool 1, Tune's scans
- and the Greenlight.
- best cell (the board's own ranking)
- widest region (neighbouring settings that all made money)
- the rows are the same either way — only the order changes
- everything recorded for this row, verbatim
- no promoted rows (still running, or nothing survived)
- h — this selection feeds Verify · Tune · Greenlight
- Menu grid: press a row's button — every execution permutation for that row with the plateau view (one setting moved at a time) on top.
- the COMPLETE stored settings record for this run, verbatim (nothing invisible)
- ” cannot be picked up — nothing has been started.
- already scored in full, kept as they are
- older rows cannot be matched and will be scored again
- The price files are checked again the moment it starts. If they are not the ones this run read, nothing is scored and it says so.
- ” cannot be deleted — nothing has been deleted.
- This cannot be undone.
- Inside a setup — a MICROSCOPE, not a null test
- This panel shows what the committee is made of. It cannot tell you whether the setup works — only a null
- comparison can, and this is not one.
- Columns read the HELD-BACK window where the run has one, the search window otherwise.
- Accuracy and edge are ACCURACY POINTS, never money.
- how alike the members are (pairwise agreement) — near-duplicates make an agreement count read higher than the number of independent opinions behind it
- in the table below (marked ▶).

## Every word, flat (391)

```
about accuracy Accuracy ACCURACY across-asset actually admits admits. again against agreement agreement/entry/hold ahead alike all already always-long an and another any anything are as Asset asset asset. assets at back. band be beat beat. been before behind below best better board board. branch button by campaign can cannot cell changes checked chosen CHOSEN chunk claim clear Click coins Columns combos committee comparable comparison COMPLETE config configs configuration configurations construction construction. CONTEXT context copies copy copy. cost count Counts counts crypto data Data dealt dealt-vote decision declared declared-cell Delete deleted deleted. Deleting denominator detail did do dollar dollars drives dump each echoed edge edge. either end entries es every Every everything evidence excluded. execution exists FAILED failed failures feeds files fingerprint finish finishes first First first-recorded FIXED flattering flatters for form from full geometry get go got graded Greenlight Greenlight. grid grow has held HELD-BACK held-back higher History honest how If in independent indistinguishable INFERRED Inside inspect intended. into invisible is it It it. its itself judge kept KEY knife last layout line look looks looks. made make many marked marking match-ups matched matters may means measured measured. members menu Menu MICROSCOPE missing moment money Money money. move moved much named near-duplicates neighbouring never no not notes nothing null nulls number of of. older on once once-only one ONE one. ones only ONLY Open opinions or order ordering other otherwise. out own p-value page pairwise panel participation per-member permanently permutation permutations pick picked Picking plateau plus POINTS predictability press price profit-and-loss promote promoted proved purpose. QC-142 QC-7 queued quoted ranked Ranked ranking read reading real real-versus-null record recorded region register remove Replication rest Resume row rows rows. run run. running runs runs. same sample. save saved say says scans score scored sealed search SEARCHED section section. see SELECT selected selection setting settings setup setups shape share showed showing shown shows sit sits Size slice slim smaller so so. STAMP started. starts. statistics still stored sturdy survived Survivor sweep Sweep table taken tell test than that That the The them then These they This this time to together Tool tools top. total touched traded trades Tune unavailable undone. unit units units. until up verbatim Verify view vote votes votes. vs watch way were what What where whether which why widest width will window with without won. works worst yardstick yet yet. you Your
```

---

# Verify

## What the controls are called (15)

- `, engine`
- `(engine`
- `current:`
- `Fire rotation rounds on this run`
- `full gate record`
- `h`
- `Last gate (`
- `null boards`
- `null draws)`
- `q`
- `Read Tool 1 verdict`
- `rotation rounds to fire`
- `Run the planted check`
- `scramble run`
- `selected:`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (29)

- Planted check — the instrument's calibration certificate
- Regenerates a fabricated pair carrying a KNOWN planted rule and fires it through the full sweep +
- null pipeline. PASS = the board found the plant, profited, beat always-long, and every null board destroyed it.
- A pass belongs to the engine version that earned it; a new release starts NOT CHECKED.
- This regenerates the fabricated pair and fires a full sweep, so it takes minutes. The badge above and the release strip refresh themselves — you do not need to reload.
- Tool 1 — this row against its null runs
- Compares the picked REAL run against a SCRAMBLE run (a sweep launched with scrambled labels): each
- scrambled world re-shops the whole menu in the same test window, and its best find must beat the selected row.
- The draws come from a sweep launched with
- above zero on the Sweep section — that is the box
- that makes a run appear in the list below. Read the verdict here. ALWAYS VISIBLE — a gate failing judges the INSTRUMENT,
- never retires the candidate on one number.
- — select a row on the Boards section first; this tool is per-row.
- Rotation rounds — a SEPARATE instrument, retired as evidence
- This button used to sit inside Tool 1 saying its rounds were what that tool reads. They are not.
- It fires the ROTATION null: each round rotates outcomes against features and replays the whole downstream search
- on the selected row. Its output lands on this run's own record and is shown below — nowhere else — and it creates
- none of the dealt-vote rows Tool 1 pairs against. Those come from launching a sweep with
- above zero on the Sweep section.
- The register marks this construction RETIRED as evidence
- (historical reading only), so a number from it is
- never a claim. It stays operable because a run that already carries one must remain readable.
- — minutes to hours. They land on this run's own record.
- select a row on the Boards section first — rotation rounds are per-row.
- Tool 2 — the board against its dealt-vote null boards
- For each promoted row: how many of its null copies (same setup, votes dealt onto random days) its
- HELD-BACK money beats. With N null boards the finest honest claim is 1 in N+1. Computed from the run's own stored
- null rows — needs a sweep launched with null boards &gt; 0.
- open a run on Boards first.

## Every word, flat (217)

```
above against against. already ALWAYS always-long and appear are as badge beat beats. because belongs below below. best board boards Boards box button calibration candidate carries carrying certificate check CHECKED. claim claim. come Compares Computed construction copies creates current days dealt dealt-vote destroyed do downstream draws each earned else engine every evidence fabricated failing features find finest fire Fire fires first first. For found from full gate gt HELD-BACK here. historical honest hours. how in inside instrument INSTRUMENT is it It it. its Its judges KNOWN labels land lands Last launched launching list makes many marks menu minutes minutes. money must need needs never new none NOT not not. nowhere null number number. of on one only onto open operable outcomes output own pair pairs PASS pass per-row. picked pipeline. plant Planted planted profited promoted random re-shops Read readable. reading reads. REAL record record. refresh Regenerates regenerates register release reload. remain replays retired RETIRED retires rotates Rotation ROTATION rotation round rounds row row. rows rule Run run runs same saying SCRAMBLE scramble scrambled search section section. select selected SEPARATE setup shown sit so starts stays stored strip sweep Sweep takes test that the The themselves They This this Those through to Tool tool used verdict version VISIBLE votes were what whole window with With world you zero
```

---

# History

## What the controls are called (11)

- `engine`
- `exam status loading…`
- `Finished tuning runs`
- `h`
- `half-life`
- `Launch History Tuning on this row`
- `Launch paired age-dial run`
- `loading…`
- `q`
- `read`
- `selected row:`

## What the dropdowns offer (3)

- `12mo`
- `24mo`
- `36mo`

## Sentences the page prints (12)

- History Tuning — change ONE variable (training-history length) and price the effect
- One variable per run, declared before it fires (the confirm discipline): the same frozen trading
- cell, trained on windows of different depth, priced on the same folds. The reading rule is stamped at launch.
- select a row on Boards first — History Tuning drills the selected candidate.
- Age dial (HT v2) — one declared half-life vs the reference, paired folds
- PLAIN WORDS: instead of cutting history off, the age dial DOWN-WEIGHTS old days smoothly. One
- half-life (how many days back a sample's influence falls to half) is declared, then priced against the
- no-dial reference on ~20 paired folds — same folds, same frozen trading cell, so the ONLY difference is the
- dial. The table's verdict is the paired money difference, fold by fold.
- select a row on Boards first.
- Run exam A (late-rule pair — must find)
- Run exam B (flat pair — must NOT find)

## Every word, flat (110)

```
12mo 24mo 36mo against Age age age-dial and at back before Boards by candidate. cell change confirm cutting days declared depth dial dial. difference different discipline DOWN-WEIGHTS drills effect engine exam falls find Finished fires first first. flat fold fold. folds folds. frozen half half-life History history how HT influence instead is it late-rule Launch launch. length loading many money must no-dial NOT of off old on ONE One one ONLY pair paired per PLAIN price priced read reading reference row rule run Run runs same sample select selected smoothly. so stamped status table the The then this to trading trained training-history Tuning tuning v2 variable verdict vs windows WORDS
```

---

# Tune

## What the controls are called (45)

- `— uplift`
- `, p=`
- `; peak concurrent`
- `; worst trade`
- `: tightest no-winner-lost stop`
- `(flat`
- `A heavy scan is running (`
- `apply custom`
- `apply to the live rule`
- `Chance check:`
- `Compare`
- `Compare two runs — NOT a null test`
- `drawdown`
- `Exposure:`
- `h`
- `h of`
- `holds one window layout (`
- `last scan failed:`
- `last sweep failed:`
- `losers over`
- `No stop (clear)`
- `of`
- `of your setup(s) and`
- `on record:`
- `or apply a custom stop`
- `over`
- `per-$`
- `priced entries: flat`
- `q`
- `run A`
- `run B`
- `running…`
- `save the reason`
- `scan target`
- `shuffled deals, mean uplift`
- `Target:`
- `the row selected on Boards —`
- `the row selected on Boards (`
- `the saved book`
- `Verdict:`
- `vs ladder`
- `winners /`
- `x`
- `your reason for this choice`
- `your setup`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (18)

- ) — one at a time; both launchers are disabled until it lands (scans run minutes and cannot be aborted mid-flight).
- Protective stop tuner — full-history, loses no winner
- Replays the frozen committee over ALL history and finds the tightest fixed stop that would not have
- clipped a single winner, plus the sacrifice curve (give up top winners → tighter stop → NET $). Scanning applies
- nothing. Target:
- saved book(s) without a protective stop
- no choice about the stop has been recorded yet
- Tune protective stop (full history)
- currently applied on the trading machine:
- Conviction sizing — bet more when more members agree?
- Prices the DECLARED clip ladder (multiplier = winning-side vote count) as a pure $ overlay on the
- same full-history replay, against a shuffled-assignment chance check and exposure-honest metrics.
- Run conviction sweep (full history)
- — empty: compare a 'both' run's own two sides —
- entries.
- NET = winner $ given up + loss-side $ vs no stop; positive means the stop helps. Apply buttons exist
- only for the running engine; for a lab row the number informs the greenlight instead.
- so there is no second side of it to compare against — pick a run B.

## Every word, flat (180)

```
aborted about against agree ALL and applied applies apply Apply are as at B. be been bet Boards book both buttons cannot chance Chance check choice clear clip clipped committee Compare compare concurrent Conviction conviction count currently curve custom deals DECLARED disabled drawdown empty engine entries entries. exist Exposure exposure-honest failed finds fixed flat for frozen full full-history give given greenlight has have heavy helps. history holds informs instead. is it lab ladder lands last launchers layout live losers loses loss-side machine mean means members metrics. mid-flight minutes more multiplier NET no No no-winner-lost not NOT nothing. null number of on one only or over overlay own peak per- pick plus positive priced Prices Protective protective pure reason record recorded replay Replays row rule run Run running runs sacrifice same save saved scan Scanning scans second selected setup shuffled shuffled-assignment side sides single sizing so stop sweep Target target test that the there this tighter tightest time to top trade trading Tune tuner two until up uplift Verdict vote vs when window winner winners winning-side without worst would yet your
```

---

# Greenlight

## What the controls are called (11)

- `— test`
- `anchor`
- `Existing greenlights`
- `GREENLIGHT this config`
- `greenlighted`
- `h`
- `none yet`
- `nuked`
- `q`
- `selected:`
- `Trade tab`

## What the dropdowns offer (3)

- `best cell`
- `declared cell`
- `widest region`

## Sentences the page prints (7)

- Greenlight — the decision that a config is fit to trade
- Records WHO/WHEN/WHY with the exact frozen config, engine version, and the campaign's whole
- evidentiary chain. The config then appears on the Trade tab (both sides) for activation. Only greenlighted
- configs ever trade — no hand-built live configs, ever.
- why — the decision record (required)
- select a row on Boards first — a greenlight is minted from the selected row.
- activation, deactivation and nuking live on the

## Every word, flat (68)

```
activation activation. anchor and appears best Boards both campaign cell chain. config configs deactivation decision declared engine ever ever. evidentiary exact Existing first fit for from frozen Greenlight GREENLIGHT greenlight greenlighted greenlights hand-built is live minted no none nuked nuking on Only record Records region required row row. select selected sides tab test that the The then this to trade Trade version WHO/WHEN/WHY whole why widest with yet
```

---

# Help

## What the controls are called (2)

- `Every control on this screen`
- `None of it can be pressed or`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (8)

- Not described yet. That is a fault in this page, not in the control.
- Help — what every control on every screen does
- One entry for every box, tick, dropdown and button on the seven screens.
- The list of controls is read from the screens themselves, so nothing can be left out of it
- quietly: a control with no description says so, in place, rather than being missing.
- Everything shown below is a dead copy.
- changed — it is a picture of the control, put beside its description so you can see which
- one is being talked about. The real ones are on their own tabs.

## Every word, flat (80)

```
about. and are be being below beside box button can changed control control. controls copy. dead described description does dropdown entry Every every Everything fault for from Help in is it its left list missing. no None Not not nothing of on One one ones or out own page picture place pressed put quietly rather read real says screen screens screens. see seven shown so tabs. talked than That the The their themselves this tick what which with yet. you
```

