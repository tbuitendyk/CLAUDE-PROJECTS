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

Generated from **f916f6598ade — what the box is serving**, not from the working tree.

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

## What the controls are called (68)

- `— each says why:`
- `— no finished stage`
- `” will permanently remove:`
- `all loaded data`
- `arm`
- `band % (or auto)`
- `both kinds`
- `Campaign — the parent chain name`
- `Campaign “`
- `carry forward (0 = all)`
- `chunk shape`
- `Currently set:`
- `d`
- `decision`
- `declared,`
- `declared:`
- `Delete campaign…`
- `Deleting “`
- `description`
- `doubles`
- `end`
- `entry`
- `existing campaigns`
- `fee % each way`
- `from stage 1 record set`
- `from stage 2 record set`
- `gate`
- `greenlight(s),`
- `greenlights:`
- `hold`
- `is going:`
- `lands`
- `lands about`
- `no estimate until the first`
- `no runs yet`
- `null set size`
- `on this box —`
- `or a new name`
- `permute`
- `Quorum`
- `quorum bar`
- `quorum by`
- `record set on this box —`
- `record set(s) stayed`
- `Removed`
- `run(s),`
- `Set`
- `settings`
- `settings ×`
- `setup(s),`
- `share`
- `singles`
- `start`
- `start stage 1`
- `start stage 2`
- `start stage 3`
- `start stage 3 will refuse:`
- `started`
- `stop`
- `Sweep — the three stages, live`
- `t`
- `the count is not known right now —`
- `trail`
- `triples`
- `units`
- `UTC`
- `View tree`
- `window layout`

## What the dropdowns offer (67)

- `0.25×`
- `0.5×`
- `0.75×`
- `0×`
- `1`
- `1.5×`
- `1×`
- `10%`
- `100%`
- `113h`
- `137h`
- `161h`
- `17h`
- `2`
- `2×`
- `20%`
- `25%`
- `30%`
- `40%`
- `41h`
- `50%`
- `60%`
- `61/13/13/13 (sealed exam)`
- `65h`
- `70/15/15`
- `70%`
- `75%`
- `80%`
- `89h`
- `90%`
- `active`
- `ADAUSDT`
- `all of them`
- `always`
- `argmax`
- `ATOMUSDT`
- `AVAXUSDT`
- `BCHUSDT`
- `BNBUSDT`
- `breakout`
- `conviction`
- `count`
- `Daily 1-day`
- `Daily 2-day`
- `Daily 3-day`
- `Daily 4-day`
- `directional`
- `DOGEUSDT`
- `DOTUSDT`
- `ETCUSDT`
- `ETHUSDT`
- `families`
- `its own history`
- `legacy 80/20 (never evidence)`
- `LINKUSDT`
- `LTCUSDT`
- `market`
- `off`
- `SOLUSDT`
- `static`
- `TRXUSDT`
- `UNIUSDT`
- `voices`
- `Weekly 8-day`
- `XLMUSDT`
- `XRPUSDT`
- `ZECUSDT`

## Sentences the page prints (25)

- Each stage writes a record set the next one reads, and every set names its parent. What is
- running, and everything finished, is on Boards.
- Stage 1 — train the LOGREG members once, keep every vote, rank against the null set
- every member is a LOGREG forecast — 4 per coin on its own, 5 alongside others — trained with the plain
- argmax fit. No trade, no fee and no decision exist here; those are priced later, at stage 3, from the votes this stage keeps.
- universe (blank = all 17 default pairs)
- Stage 2 — carry the best forward, add the BOOST members
- BOOST is the second kind of member — a different way of working out a forecast from the same prices.
- The LOGREG members are reused, never retrained; only the BOOST members train (4 per coin on its own, 5 alongside others),
- so a carried unit ends up with both kinds voting side by side.
- Stage 3 — price any settings from the kept votes, no training
- — every coin is judged by 8 members. These four boxes decide when enough of them agree to act.
- units. Progress above; the set lands on Boards.
- carried units.
- units.
- Every run launched while a campaign is set attaches to it: sweeps, null rounds, tuning passes,
- scans, stage record sets. The campaign's whole chain travels with any greenlight minted from it.
- ” — runs, record sets & greenlights
- ” is locked — nothing has been deleted.
- setup(s) on the Trade tab are still deployed. Retire them there first:
- nothing but the name — this campaign holds no runs, greenlights or setups.
- This cannot be undone.
- ” deleted.
- and the saved models and tuning files belonging to them.
- priced the same trade and were folded into one)

## Every word, flat (278)

```
1-day 113h 137h 161h 17h 2-day 3-day 4-day 41h 65h 8-day 89h about above act. active ADAUSDT add against agree all alongside always and any are argmax arm at ATOMUSDT attaches auto AVAXUSDT band bar BCHUSDT be been belonging best blank BNBUSDT Boards. BOOST both box boxes breakout but by Campaign campaign campaigns cannot carried carry chain chunk coin conviction count Currently Daily data decide decision declared default Delete deleted. Deleting deployed. description different directional DOGEUSDT DOTUSDT doubles Each each end ends enough entry estimate ETCUSDT ETHUSDT every Every everything evidence exam exist existing families fee files finished first fit. folded forecast forward four from gate going greenlight greenlights has here history hold holds into is it it. its judged keep keeps. kept kind kinds known lands later launched layout legacy LINKUSDT live loaded locked LOGREG LTCUSDT market member members members. minted models name names never new next No no not nothing now null of off on once one only or others out own pairs parent parent. passes per permanently permute plain price priced prices. Progress Quorum quorum rank reads record refuse remove Removed Retire retrained reused right rounds run running runs same saved says scans sealed second set Set sets sets. settings setup setups. shape share side side. singles size so SOLUSDT stage Stage stages start started static stayed still stop Sweep sweeps tab the The them them. there These this This those three to trade Trade trail train trained training travels tree triples TRXUSDT tuning undone. unit units units. UNIUSDT universe until up UTC View voices vote votes voting way Weekly were What when while whole why will window with working writes XLMUSDT XRPUSDT yet ZECUSDT
```

---

# Boards

## What the controls are called (94)

- `— pick a stage`
- `+both`
- `+hold`
- `alongside`
- `any`
- `arm`
- `average`
- `avg held-back`
- `avg held-back $`
- `avg held-back trades`
- `avg test $`
- `avg trades`
- `avg vs always-long`
- `avg vs always-long $`
- `band`
- `band %`
- `beat its own null set`
- `before BOOST)`
- `BOOST`
- `call`
- `campaign:`
- `chunk shape`
- `clear filters`
- `coin`
- `coins`
- `coins in the money`
- `comparisons`
- `copy settings into the form`
- `could not read this row's records`
- `d`
- `Data fingerprint:`
- `decision`
- `Delete record set…`
- `entry`
- `fill in the missing settings`
- `forecast score`
- `forecast score — all members`
- `forecast score — stage 1 members`
- `fuller board helped?`
- `gate`
- `h`
- `held-back $`
- `held-back stops`
- `held-back trades`
- `independent voices`
- `is`
- `is going:`
- `It cannot be done on this set:`
- `lead over null set`
- `LOGREG +`
- `maximum`
- `median`
- `members`
- `minimum`
- `next`
- `nothing cleared the floors`
- `nothing here`
- `of`
- `of the`
- `order`
- `own`
- `prev`
- `Pricing them is`
- `pricings over`
- `put the filters back`
- `quorum by`
- `record set`
- `record set —`
- `records`
- `row(s)`
- `rows`
- `rows · page`
- `rung it landed on`
- `save notes`
- `setting`
- `share that agreed`
- `Size:`
- `Stage 1`
- `stage 1 order`
- `Stage 2`
- `stage 2 order`
- `Stage 3`
- `t`
- `test $`
- `test trades`
- `The missing`
- `the tables are not totalled yet —`
- `the totalling failed:`
- `this set cannot be added to:`
- `this set holds`
- `trail`
- `units`
- `vs always-long`
- `What this run actually is`

## What the dropdowns offer (13)

- `active`
- `all of them`
- `always`
- `argmax`
- `breakout`
- `conviction`
- `count`
- `directional`
- `does not apply`
- `families`
- `its own history`
- `market`
- `voices`

## Sentences the page prints (44)

- Boards — the record sets, and what each stage wrote
- One section per stage, the whole provenance on screen: picking a stage 3 record set fills the
- stage 2 and stage 1 sections with its parents; picking a stage 2 set fills its stage 1 parent; picking a
- parent puts the child selections away. Each section can be put away and comes back as you left it.
- . Its tables appear when it lands.
- THIS SET DOES NOT MATCH ITS OWN PLAN.
- unit(s) failed and are missing from every table below — read the numbers accordingly.
- notes — why this run exists, what it showed, what it cost
- STAMP FAILED — this run cannot be proved comparable to any other
- put away — press the arrow to bring it back.
- Ordered by the sort picked on the columns — saved on this record set, and exactly what a stage 2
- carry forward takes the top of. With nothing picked: beat its own null set, ties broken by lead over null set —
- the fixed rule. Independent voices below members means some members are near-copies of each other and the
- committee is smaller than it looks. No money on this table because stage 1 never prices a trade.
- Ordered by the sort picked on the columns — saved on this record set, and exactly what a stage 3
- carry forward takes the top of. With nothing picked: forecast score — all members, best first; ties keep their
- carry order either way. Independent voices below members means some members are near-copies; if the BOOST
- members added members without adding voices, this is where that shows. No money on this table: a stage 2
- record is training inventory. Pricing and the held-back window belong to stage 3.
- Stage 3 — settings priced from the kept votes (
- — the records are all kept; the totalling can be tried again after a service restart.
- . This page asks again every few seconds.
- — building in the background; the tables appear here when it lands.
- Table 3.A: Settings, ranked
- — one row per declared setting, averaged over its coins
- show in 3.B
- share that agreed is empty on this set —
- Ordered by the sort picked on the columns — one column at a time, saved on this record set. With
- nothing picked: beat its own null set, best first. Independent voices below members means the committees held
- near-copies, so the setting rests on fewer real opinions than its member count suggests.
- Table 3.B: Every coin of every setting
- — one row per coin, its records opening below it
- row(s) held back by the floors.
- The four numbers beside each box are what that column holds in the rows the table is showing now, after every filter above. They move as you filter.
- rows — the rest are held back by the filters above.
- filling in the missing settings failed:
- — nothing already priced was touched.
- filling in the settings this block declares:
- — running in the background; the tables are worked out again when it lands. This page asks again every few seconds.
- every setting this block declares is priced. It was filled in
- time(s) since it first ran.
- settings its block declares.
- are ways of asking that did not exist when it ran, so nothing here can answer for them.
- unit(s); nothing already priced is read, touched or priced again.

## Every word, flat (314)

```
3.A 3.B above. accordingly. active actually added adding after again again. agreed all alongside already always always-long and answer any appear apply are argmax arm arrow as asking asks at average averaged avg away away. back back. background band be beat because before belong below beside best block board Boards BOOST both box breakout bring broken building by call campaign can cannot carry child chunk clear cleared coin coins column columns comes committee committees comparable comparisons conviction copy cost could count Data decision declared declares declares. Delete did directional DOES does done each Each either empty entry every Every exactly exist exists failed FAILED families few fewer fill filled filling fills filter filter. filters fingerprint first first. fixed floors floors. for forecast form forward four from fuller gate going held held-back helped here history hold holds if in independent Independent into inventory. is it It it. its Its ITS keep kept landed lands. lead left LOGREG looks. market MATCH maximum means median member members minimum missing money move near-copies never next No NOT not notes nothing now null numbers of of. on One one opening opinions or order Ordered other out over OWN own page parent parents per pick picked picking PLAN. press prev priced priced. prices Pricing pricings proved provenance put puts quorum ran ran. ranked read real record records rest restart. rests row rows rule. run rung running save saved score screen seconds. section sections selections service set SET set. sets setting settings Settings shape share show showed showing shows. since Size smaller so some sort stage Stage STAMP stops suggests. table Table tables takes test than that the The their them them. They THIS this This ties time to top totalled totalling touched touched. trade. trades trail training tried unit units voices votes vs was way. ways what What when where whole why window with With without worked wrote yet you
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

## What the controls are called (53)

- `· folds:`
- `· hold windows won`
- `· reference`
- `· sign-flip p`
- `· winner hold`
- `Age dial: half-life`
- `carried by one fold`
- `completed,`
- `computing the stamped verdict…`
- `computing the verdict…`
- `dropped,`
- `effective days (GUESSED) ·`
- `engine`
- `exam status loading…`
- `FAILED`
- `Finished tuning runs`
- `Fire trail-replay null draw`
- `folds positive`
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
- `paired sum`
- `PASSED`
- `planned,`
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
- `silent on both arms`
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

## Every word, flat (296)

```
12mo 24mo 36mo above across after again against Age age age-dial ALL all already already. and any appear appears are arms as at back be because been before BEFORE best board Boards book both by cadence calendar. call candidate. cannot carried case cell change click combined comparable compared complete completed completes computing confirm construction count cutting data days dealt declared depth dial Dial dial-pair dial. difference different discipline dollar dollars DOWN-WEIGHTS draw draws drills dropped each early/middle/late eff. effect effective empty engine Every every exactly. exam excluded failed FAILED falls figure find finish Finished finished Fire fired fires first first. fixed flat flattering floor fold fold. folds folds. for from frozen full grade graded grid GUESSED had half half-life has held here History history HOLD hold holds how HT in influence inheriting instead into is it its KEY late-rule Launch launch. launched length loading look lookback many marked meaningless. minimum money must NAME net never no-dial NOT not nothing null numbers of off old on once ONE One one ONLY Only only or over own pair paired pairs paper partial pass PASSED passes per picked picking PLAIN planned positive price priced ran rather read reading Reading reading. records reference REFERENCE refuses repeated replays reserve reserve61 resolution retune retune. row rows rule rules run Run run-up runs same sample saw says SEALED seed seed. seen seen. select selected server setting Shaping shopped. shown sign-flip silent single slice smallest smoothly. so some split splits stamped status strength strength. structurally sum summed table TABLE test TEST test/hold than the The then this This three through time to together. trade trades/lookback-week trading trail-replay Trailing trained training training-history Tuning tuning v2 variable verdict verdict. votes vs walk was when which window windows winner WINNER with won WORDS would yet your zero
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

