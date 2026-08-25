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

Generated from **a88cc797336d — what the box is serving**, not from the working tree.

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

## What the controls are called (86)

- `— so out of`
- `, expect about`
- `” — runs & greenlights`
- `” will permanently remove:`
- `1 time in`
- `1-in-`
- `agree`
- `all loaded data`
- `also try moving stops`
- `arm`
- `band % (or auto)`
- `Beating all`
- `board rows`
- `Both passes`
- `branch`
- `but the board keeps`
- `Campaign — the parent chain name`
- `Campaign “`
- `chunk shape`
- `claim`
- `cpus on the box`
- `Currently set:`
- `d`
- `decision`
- `Delete campaign…`
- `Deleting “`
- `disk`
- `doubles`
- `end`
- `entry`
- `ETA`
- `existing campaigns`
- `fee % each way`
- `free`
- `gate`
- `greenlight(s),`
- `greenlights:`
- `is at best a`
- `MB`
- `MB ceiling ·`
- `MB free on the box`
- `memory`
- `min trades`
- `no runs yet`
- `null boards`
- `of`
- `of a`
- `on this box —`
- `or a new name`
- `permute`
- `Phase`
- `Promote pass only`
- `promote top K`
- `promote top K is`
- `Rate`
- `Removed`
- `rows and`
- `run(s),`
- `Running:`
- `second pass:`
- `Set`
- `setup(s),`
- `singles`
- `start`
- `Start sweep`
- `Stop jobs`
- `t`
- `the board keeps`
- `The last job did not finish:`
- `This run would be refused:`
- `time`
- `trail`
- `trainings`
- `Trainings`
- `triples`
- `unit(s)`
- `units`
- `Units`
- `View tree`
- `What this run will cost`
- `window layout`
- `With`
- `with contexts`
- `workers`
- `working it out…`
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

## Sentences the page prints (29)

- Every run launched while a campaign is set attaches to it: sweeps, null rounds, tuning passes,
- scans. The campaign's whole chain travels with any greenlight minted from it.
- Board sweep — wide to FIND (never a result)
- — everything in this box shapes the slim pass and the promote pass alike
- universe (blank = all 17 default pairs)
- how many rows carry from the slim pass into the promote pass — the only thing that travels between the two boxes.
- above zero sends every row through instead, and so does replication below.
- — the slim pass ignores everything in this box, however it is set
- replication: score ONE setting you name, on every asset
- replication: search many settings, each scored on every asset
- description — why this run exists (rides in the job heading forever)
- — worked out from the settings above, against what the box has now
- No job running.
- ” is locked — nothing has been deleted.
- setup(s) on the Trade tab are still deployed. Retire them there first:
- nothing but the name — this campaign holds no runs, greenlights or setups.
- This cannot be undone.
- ” deleted.
- and the saved models and tuning files belonging to them.
- rows on disk at about 150 bytes each (
- per unit).
- settings searched, each scored on every asset.
- null boards, one setting beating every one of its own copies happens by luck about
- the work — the whole run once for real, then once per board.
- of them carry into the second pass.
- The memory figure is what the RUN adds — the unit list, the work queue, and one copy of the settings per worker.
- The decoded prices the workers hold are larger and are not in it: those grow with how many ASSETS are in the run,
- not with how many settings.
- Open it on the Boards section to see what it managed to record

## Every word, flat (284)

```
1-day 1-in- 113h 137h 161h 17h 2-day 3-day 4-day 41h 65h 8-day 89h about above active adds against agree alike all also always and any are argmax arm asset asset. ASSETS at attaches auto band be beating Beating been belonging below. best between blank Board board board. boards Boards Both box boxes. branch breakout but by bytes Campaign campaign campaigns cannot carry ceiling chain chunk claim contexts copies copy cost cpus Currently Daily data decision decoded default Delete deleted. Deleting deployed. description did directional disk does doubles each end entry ETA Every every everything evidence exam existing exists expect fee figure files FIND finish first for forever free from gate greenlight greenlights grow happens has heading hold holds how however ignores in instead into is it it. its job jobs keeps larger last launched layout legacy list loaded locked luck managed many market MB memory min minted models moving name never new No no not nothing now null of on once ONE one only Open or out own pairs parent pass pass. passes per permanently permute Phase prices promote Promote queue Rate real record refused remove Removed replication result Retire rides rounds row rows run RUN Running running. runs saved scans. score scored sealed search searched second section see sends set Set setting settings settings. setup setups. shape shapes singles slim so start Start static still Stop stops sweep sweeps tab that the The them them. then there thing this This those through time to top Trade trades trail trainings Trainings travels tree triples try tuning two undone. unit units Units universe View way Weekly What what while whole why wide will window with With work worked worker. workers working would yet you zero
```

---

# Boards

## What the controls are called (99)

- `— open it again to retry`
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
- `Apply`
- `assets held up`
- `assets held up (context)`
- `at agreement`
- `at least this many comparisons`
- `beat always-long`
- `beat its own copies`
- `beat its own null copies`
- `beat its own nulls`
- `branch(es)`
- `campaign:`
- `clear selection`
- `coin`
- `combos ×`
- `comparisons`
- `configuration`
- `copy settings into the form`
- `Data fingerprint:`
- `declared configs, ranked`
- `Delete run…`
- `Deleting “`
- `echoed by the vote`
- `edge`
- `Every coin of every configuration`
- `first`
- `first, then by`
- `h`
- `held-back`
- `held-back money`
- `how much of its`
- `inspect`
- `last`
- `loading this configuration's rows…`
- `menu grid`
- `Menu grid —`
- `menu grid failed:`
- `next`
- `no per-member detail in this dump`
- `no row selected yet`
- `nothing`
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
- `prev`
- `q`
- `read(s) failed, so any panel`
- `real / null rows`
- `recorded rows`
- `region`
- `Replication —`
- `Resume run`
- `rows`
- `rows per page`
- `save notes`
- `saved runs`
- `selected:`
- `showing`
- `Size:`
- `slim runs ·`
- `sort by`
- `still to score`
- `Survivor board — the promoted rows`
- `that failed and get another go`
- `the declared config on every asset`
- `the inspect record, verbatim`
- `the run itself`
- `These rows cover the first`
- `These totals cover the first`
- `They refresh when the run finishes`
- `This run did not finish —`
- `this run has been picked up`
- `This run recorded`
- `time(s) already`
- `total held-back`
- `totalling in the background —`
- `unit(s) FAILED`
- `units ·`
- `What this run actually is`
- `Your cell sits at #`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (80)

- Asset predictability — best to worst
- KEY — for each asset: of all real-versus-null match-ups on HELD-BACK money, the share the real
- setups won. 100% means every real setup beat every null copy; 0% means every null copy beat every real setup;
- 50% means the real setups are indistinguishable from dealt votes.
- Counts grow until the sweep finishes — do not judge yet.
- rows so far. This box asks again every fifteen seconds while open.
- row(s) narrowed out by the comparisons floor.
- — one row per coin, sortable over the whole data set
- Counts below are INFERRED, not measured.
- declared-cell rows without marking which copy scored them, so each asset's first-recorded row is taken as the
- real one — real copies are queued ahead of every null copy.
- row(s) were excluded.
- Replication — the declared config on every asset
- KEY — one FIXED configuration, named before the run, scored once on each asset.
- is the reading that counts: the same configuration on dealt votes, which is the
- only yardstick the register admits.
- says whether the setting is sturdy or a knife edge.
- is CONTEXT ONLY — crypto assets move together, so it is not a count of independent
- looks and no p-value is quoted from it. Money is last on purpose. held-back $ is the once-only look on data
- no search touched; test $ is the window the settings were chosen on and flatters itself by construction.
- open to load this configuration's rows
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
- Totalled once from every recorded row —
- of them — off to the side, so nothing here waits on it.
- A finished run totals itself; anything older totals in the background the first time this is opened, and this box shows how far that has got.
- Menu grid: press a row's button — every execution permutation for that row with the plateau view (one setting moved at a time) on top.
- the COMPLETE stored settings record for this run, verbatim (nothing invisible)
- totalling this run's rows in the background —
- so far. Everything else keeps answering; this box asks again every fifteen seconds.
- ” cannot be picked up — nothing has been started.
- already scored in full, kept as they are
- older rows cannot be matched and will be scored again
- The price files are checked again the moment it starts. If they are not the ones this run read, nothing is scored and it says so.
- ” cannot be deleted — nothing has been deleted.
- The planted check verdict is KEPT.
- Deleting this run removes its rows, not its result — the pass or fail it recorded, the engine version it
- judged and the sentences saying why stay on the box for good, and the badge at the top of the page goes on
- showing them.
- This cannot be undone.
- Inside a setup — a MICROSCOPE, not a null test
- This panel shows what the committee is made of. It cannot tell you whether the setup works — only a null
- comparison can, and this is not one.
- Columns read the HELD-BACK window where the run has one, the search window otherwise.
- Accuracy and edge are ACCURACY POINTS, never money.
- how alike the members are (pairwise agreement) — near-duplicates make an agreement count read higher than the number of independent opinions behind it
- in the table below (marked ▶).
- THIS SCREEN IS INCOMPLETE.
- below that looks empty may be missing data rather than reporting none. Reload once the service is back;
- do not read an empty panel here as a result.
- Plateau view — one setting moved at a time, the rest held at your cell
- KEY — each small table changes exactly ONE setting; ▶ marks your cell. Neighbours earning similar
- money is a plateau and the pick is sturdy. Your row alone earning while its neighbours collapse is a needle —
- one step away it falls apart, so distrust it. Money is TEST-WINDOW money, dollars per $100, the same as the grid
- below.

## Every word, flat (488)

```
about accuracy Accuracy ACCURACY across-asset actually admits admits. again against agreement agreement/entry/hold ahead alike all alone already always-long an and another answering any anything apart Apply are as asks Asset asset asset. assets at away back back. background badge band be beat beat. been before behind below below. best better board board. box branch button by campaign can cannot cell cell. changes check checked chosen CHOSEN chunk claim clear Click coin coins collapse Columns combos committee comparable comparison comparisons COMPLETE config configs configuration configurations construction construction. CONTEXT context copies copy copy. cost count Counts counts cover crypto data Data dealt dealt-vote decision declared declared-cell Delete deleted deleted. Deleting denominator detail did distrust do dollar dollars drives dump each earning echoed edge edge. either else empty end engine entries es every Every everything Everything evidence exactly excluded. execution exists fail FAILED failed failures falls far far. feeds fifteen files fingerprint finish finished finishes first First first-recorded FIXED flattering flatters floor. for form from full geometry get go goes good got got. graded Greenlight Greenlight. grid grow has held HELD-BACK held-back here higher History honest how If in INCOMPLETE. independent indistinguishable INFERRED Inside inspect intended. into invisible is IS it It it. its itself judge judged keeps kept KEPT. KEY knife last layout least line load loading look looks looks. made make many marked marking marks match-ups matched matters may means measured measured. members menu Menu MICROSCOPE missing moment money Money money. move moved much named narrowed near-duplicates needle neighbouring Neighbours neighbours never next no none. not notes nothing null nulls number of of. off older on once once-only one ONE one. ones only ONLY open Open open. opened opinions or order ordering other otherwise. out over own p-value page pairwise panel participation pass per per-member permanently permutation permutations pick picked Picking planted plateau Plateau plus POINTS predictability press prev price profit-and-loss promote promoted proved purpose. QC-142 QC-7 queued quoted ranked Ranked ranking rather read reading real real-versus-null record recorded refresh region register Reload remove removes Replication reporting rest result result. Resume retry row rows run run. running runs runs. same sample. save saved say saying says scans score scored SCREEN sealed search SEARCHED seconds seconds. section section. see SELECT selected selection sentences service set setting settings setup setups shape share showed showing shown shows side similar sit sits Size slice slim small smaller so so. sort sortable STAMP started. starts. statistics stay step still stored sturdy sturdy. survived Survivor sweep Sweep table taken tell test TEST-WINDOW than that That the The them them. then These They they This this THIS time to together Tool tools top top. total Totalled totalling totals touched traded trades Tune unavailable undone. unit units units. until up verbatim verdict Verify version view vote votes votes. vs waits watch way were what What when where whether which while whole why widest width will window with without won. works worst yardstick yet yet. you Your your
```

---

# Verify

## What the controls are called (46)

- `— its rows are gone, so`
- `, engine`
- `, worst`
- `· null boards:`
- `· planted check:`
- `(beats`
- `(engine`
- `% losing money —`
- `best-of-menu, search replayed`
- `current:`
- `draws allow (p floor`
- `draws,`
- `exceed`
- `Fire rotation rounds on this run`
- `full gate record`
- `h`
- `is the strongest claim`
- `KEY —`
- `Last gate (`
- `null boards`
- `null draws`
- `null draws)`
- `null median $`
- `null-draw setups,`
- `of`
- `over`
- `q`
- `Read Tool 1 verdict`
- `reading`
- `real`
- `Real result:`
- `real:`
- `release`
- `Rotation rounds on this run:`
- `rotation rounds to fire`
- `Run the planted check`
- `same configuration only`
- `sanity:`
- `scramble run`
- `selected:`
- `SETTINGS MISMATCH:`
- `That run has been deleted`
- `The row itself was chosen from`
- `the two jobs differ on`
- `vs null draws: best`
- `What a pass buys:`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (46)

- Planted check — the instrument's calibration certificate
- Regenerates a fabricated pair carrying a KNOWN planted rule and fires it through the full sweep +
- null pipeline. PASS = the board found the plant, profited, beat always-long, and every null board destroyed it.
- A pass belongs to the engine version that earned it; a new release starts NOT CHECKED.
- This regenerates the fabricated pair and fires a full sweep, so it takes minutes. The badge above and the release strip refresh themselves — you do not need to reload.
- it is not on the Boards section any more. The verdict above is the record kept when it finished, and it stands
- until a fresh planted check replaces it.
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
- TABLE: the rotation null. NAME: how often a rotated world matched or beat the real result.
- KEY — exceed: the share of rounds whose result reached the real one, so LOWER is better and it is a share, not
- money; null median $: the middle result across rounds, in US dollars on the same window as the real figure.
- trades.
- searched units. That multiplicity is
- NOT replayed here, so this cannot be read as the shopping-corrected number — and the register retires this
- construction as evidence in any case.
- : held-back dollars on genuine data.
- : the same quantity in worlds with nothing
- to predict. Beating all
- — a floor, never a measure of strength.
- PASS — noise mostly loses, as fees demand.
- FAIL — NOISE IS PROFITING: the simulation is broken; do not read the tests above.
- this window only. It stops obvious chance results being frozen; the
- forward paper test after freezing is the real judge.

## Every word, flat (325)

```
above above. across after against against. all allow already ALWAYS always-long and any appear are as badge be beat Beating beats beats. because been being belongs below below. best best-of-menu better board Boards boards box broken button buys calibration candidate cannot carries carrying case. certificate chance check CHECKED. chosen claim claim. come Compares Computed configuration construction copies creates current data. days dealt dealt-vote deleted demand. destroyed differ do dollars downstream draws each earned else engine every evidence exceed fabricated FAIL failing features fees figure. find finest finished fire Fire fires first first. floor For forward found freezing fresh from frozen full gate genuine gone gt has HELD-BACK held-back here here. historical honest hours. how in inside instrument INSTRUMENT is IS it It it. its Its itself jobs judge. judges kept KEY KNOWN labels land lands Last launched launching list loses losing LOWER makes many marks matched measure median menu middle minutes minutes. MISMATCH money more. mostly multiplicity must NAME need needs never new noise NOISE none NOT not not. nothing nowhere null null-draw null. number number. obvious of often on one only only. onto open operable or outcomes output over own pair pairs paper PASS pass per-row. picked pipeline. plant Planted planted predict. profited PROFITING promoted quantity random re-shops reached Read read readable. reading reads. REAL real Real record record. refresh Regenerates regenerates register release reload. remain replaces replayed replays result result. results retired RETIRED retires rotated rotates Rotation ROTATION rotation round rounds row row. rows rule Run run runs same sanity saying SCRAMBLE scramble scrambled search searched section section. select selected SEPARATE SETTINGS setup setups share shopping-corrected shown simulation sit so stands starts stays stops stored strength. strip strongest sweep Sweep TABLE takes test tests that That the The themselves They This this Those through to Tool tool trades. two units. until US used verdict version VISIBLE votes vs was were what What when whole whose window with With world worlds worst you zero
```

---

# History

## What the controls are called (44)

- `· hold windows won`
- `· reference`
- `· winner hold`
- `Age dial: half-life`
- `computing the stamped verdict…`
- `computing the verdict…`
- `effective days (GUESSED) ·`
- `engine`
- `exam status loading…`
- `FAILED`
- `Finished tuning runs`
- `Fire trail-replay null draw`
- `h`
- `half-life`
- `Launch History Tuning on this row`
- `Launch paired age-dial run`
- `loading…`
- `look`
- `null draw`
- `null draws at or above the winner:`
- `of 19 (seed`
- `of 3`
- `PASSED`
- `q`
- `read`
- `REFERENCE`
- `reference hold`
- `reserve grade`
- `resolution floor`
- `retune trade floor`
- `rows appear as passes finish`
- `Run the reserve grade`
- `selected row:`
- `Shaping numbers: training floor`
- `TABLE: the dial-pair board`
- `The slice had already been read`
- `This slice has been read`
- `This was look`
- `time(s) when this grade ran:`
- `trades/lookback-week (GUESSED) ·`
- `window`
- `winner`
- `WINNER`
- `winner reserve`

## What the dropdowns offer (3)

- `12mo`
- `24mo`
- `36mo`

## Sentences the page prints (37)

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
- against a flat reference, paired on the
- same folds. The reading is the paired difference across folds, never any single fold.
- verdict appears when the grade completes
- Every dollar here is HOLD money: the grade's test window is empty by construction, so a test
- figure would be structurally zero and meaningless.
- Only the first look was at data nothing had seen, so the floor above is the best
- case rather than the strength of this reading.
- /3 splits — partial, not comparable yet)
- days per test/hold · minimum training run-up 425 days (GUESSED) ·
- reserve61 splits are 60.9/13.05/13.05/13 exactly. Trailing is held fixed at the declared cell's setting through
- every retune.
- The reading rules stamped into this run BEFORE it was launched (click)
- Dial pairs excluded (failed a training floor on some split, so dropped from ALL splits):
- — each draw replays the full grid on dealt votes, inheriting only the calendar. 19 is the declared count
- (floor 1 in 20); the server refuses a repeated seed.
- time(s) already.
- The first look was at data nothing had seen. Every look after it is not, so its
- resolution floor is the best case rather than the strength. Reading it again is your call; the run records
- which look it was and says so on its own verdict.
- — the winner's walk, the reference pass's walk and 19 null draws over the SEALED reserve, fired together.
- NAME: combined TEST money per dial pair (the picking read). KEY: age = the half-life setting; retune = cadence and
- lookback; test $ = net paper dollars per $100 book summed across the three test windows (picked on, flattering by
- construction) — a row marked partial has not finished all three splits, so its sum cannot be compared with complete
- rows; eff. days = the smallest effective training days any split saw; hold $ = the three hold windows
- early/middle/late, shown ONLY for the winner and the reference pass, because holds are graded once and never shopped.

## Every word, flat (288)

```
12mo 24mo 36mo above across after again against Age age age-dial ALL all already already. and any appear appears are as at back be because been before BEFORE best board Boards book by cadence calendar. call candidate. cannot case cell change click combined comparable compared complete completes computing confirm construction count cutting data days dealt declared depth dial Dial dial-pair dial. difference different discipline dollar dollars DOWN-WEIGHTS draw draws drills dropped each early/middle/late eff. effect effective empty engine Every every exactly. exam excluded failed FAILED falls figure find finish Finished finished Fire fired fires first first. fixed flat flattering floor fold fold. folds folds. for from frozen full grade graded grid GUESSED had half half-life has held here History history HOLD hold holds how HT in influence inheriting instead into is it its KEY late-rule Launch launch. launched length loading look lookback many marked meaningless. minimum money must NAME net never no-dial NOT not nothing null numbers of off old on once ONE One one ONLY Only only or over own pair paired pairs paper partial pass PASSED passes per picked picking PLAIN price priced ran rather read reading Reading reading. records reference REFERENCE refuses repeated replays reserve reserve61 resolution retune retune. row rows rule rules run Run run-up runs same sample saw says SEALED seed seed. seen seen. select selected server setting Shaping shopped. shown single slice smallest smoothly. so some split splits stamped status strength strength. structurally sum summed table TABLE test TEST test/hold than the The then this This three through time to together. trade trades/lookback-week trading trail-replay Trailing trained training training-history Tuning tuning v2 variable verdict verdict. votes vs walk was when which window windows winner WINNER with won WORDS would yet your zero
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

## What the controls are called (12)

- `— test`
- `anchor`
- `Existing greenlights`
- `fee`
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

## Sentences the page prints (10)

- Greenlight — the decision that a config is fit to trade
- Records WHO/WHEN/WHY with the exact frozen config, engine version, and the campaign's whole
- evidentiary chain. The config then appears on the Trade tab (both sides) for activation. Only greenlighted
- configs ever trade — no hand-built live configs, ever.
- why — the decision record (required)
- select a row on Boards first — a greenlight is minted from the selected row.
- is what the run behind each one was priced at, per trade and each way. It is not a
- setting here — it is what the evidence was found under, and a config sent to the Trade tab starts out priced
- at it and can be changed there. A dash means the run predates the fee being recorded.
- Activation, deactivation and nuking live on the

## Every word, flat (99)

```
Activation activation. anchor and appears at be behind being best Boards both campaign can cell chain. changed config configs dash deactivation decision declared each engine ever ever. evidence evidentiary exact Existing fee first fit for found from frozen Greenlight GREENLIGHT greenlight greenlighted greenlights hand-built here is It it live means minted no none not nuked nuking on one Only out per predates priced record recorded. Records region required row row. run select selected sent setting sides starts tab test that the The then there. this to trade Trade under version was way. what WHO/WHEN/WHY whole why widest with yet
```

---

# Help

## What the controls are called (4)

- `<input`
- `Every control on this screen`
- `more`
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

## Every word, flat (82)

```
about. and are be being below beside box button can changed control control. controls copy. dead described description does dropdown entry Every every Everything fault for from Help in input is it its left list missing. more no None Not not nothing of on One one ones or out own page picture place pressed put quietly rather read real says screen screens screens. see seven shown so tabs. talked than That the The their themselves this tick what which with yet. you
```

