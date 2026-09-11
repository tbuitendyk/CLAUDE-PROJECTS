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

Generated from **4a65aa2b571c — what the box is serving**, not from the working tree.

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
- **Funnel**
- **Verify**
- **History**
- **Tune**
- **Greenlight**
- **Help**

Read from `TABS` in `public/construct.js`.

---

# Data

## What the controls are called (10)

- `Data on server`
- `Download`
- `Download / refresh`
- `download new pair(s), comma-sep`
- `from`
- `Global Refresh`
- `Purge…`
- `Refresh to latest`
- `to`
- `Trim…`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (5)

- Every sweep, null board and tune reads this cache, never the exchange — a gap here silently
- shrinks every window. Refresh re-fetches from the newest cached month (it may have been partial) through the
- current month. Trim keeps only a range, deleting the rest. Purge deletes the whole asset. Every write refuses
- while a job runs; purge and trim DELETE data — the only way back is downloading again.
- nothing cached yet — download below

## Every word, flat (71)

```
again. and asset. back been below board cache cached comma-sep current Data data DELETE deletes deleting download Download downloading Every every exchange from gap Global have here is it job keeps latest may month month. never new newest nothing null on only pair partial Purge purge range re-fetches reads Refresh refresh refuses rest. runs server shrinks silently sweep the this through to Trim trim tune way while whole window. write yet
```

---

# Sweep

## What the controls are called (84)

- `— each says why:`
- `— none —`
- `— none — no finished stage`
- `— the box holds`
- `, and`
- `” — record sets & greenlights`
- `” will permanently remove:`
- `all loaded data`
- `are already priced and are kept`
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
- `Load training setup`
- `name`
- `no estimate until the first`
- `no runs yet`
- `null set money kept`
- `null set size`
- `of`
- `on this box —`
- `one voice at`
- `or a new name`
- `permute`
- `Quorum`
- `quorum bar`
- `quorum by`
- `record set on this box`
- `record set(s) stayed`
- `records to price`
- `Removed`
- `run(s),`
- `Set`
- `settings`
- `settings ×`
- `setup(s),`
- `share`
- `singles`
- `start`
- `Start stage 1`
- `Start stage 2`
- `Start stage 3`
- `Start stage 3 will refuse:`
- `started`
- `started again`
- `starts again where it was paused:`
- `Sweep — the three stages, live`
- `t`
- `The`
- `the count is not known right now —`
- `the most one trade may count for`
- `trail`
- `triples`
- `units`
- `units priced`
- `UTC`
- `View tree`
- `was run with`
- `window layout`

## What the dropdowns offer (73)

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
- `60h`
- `61/13/13/13 (sealed exam)`
- `65h`
- `70/15/15`
- `70%`
- `75%`
- `80%`
- `85%`
- `89h`
- `90%`
- `95%`
- `98%`
- `active`
- `ADAUSDT`
- `all of them`
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
- `LINKUSDT`
- `LTCUSDT`
- `market`
- `N records`
- `off`
- `Selected records`
- `SOLUSDT`
- `static`
- `the chunk's own`
- `trained`
- `TRXUSDT`
- `UNIUSDT`
- `voices`
- `Weekly 8-day`
- `XLMUSDT`
- `XRPUSDT`
- `ZECUSDT`

## Sentences the page prints (40)

- Each stage writes a record set the next one reads, and every set names its parent. What is
- running, and everything finished, is on Boards.
- Stage 1 — train the LOGREG members once, keep every vote, rank against the null set
- every member is a LOGREG forecast — 4 per coin on its own, 5 alongside others — trained with the plain
- argmax fit. No trade shape and no decision exist here; those are priced later, at stage 3, from the votes this stage keeps.
- The fee prices only the tuning-slice $ on Boards: each unit's own votes on the last quarter of its training window,
- one buy or sell per chunk in the direction they lean, read against the same null set.
- trade coins (blank = all 17 default pairs)
- compare coins (blank = all 17 default pairs)
- weigh each trade by the money it was worth
- One chunk of history is one decision and one trade - a week on the weekly shape, a day on the
- daily ones. Off, a trade where the price moved 0.6% and one where it moved 14% are the same single lesson, so a
- forecast right nine times on crumbs and wrong once on a landslide trains as a good one. On, the landslide
- teaches more. A trade too small to cover the fees is never weightless - taking it the wrong way wastes them,
- and staying out is worth learning. The number beside it is how many ordinary trades the biggest may count for,
- so one freak trade cannot be the whole training; 0 turns that limit off. This carries to stage 2 by itself, so
- a committee is trained one way.
- Stage 2 — carry the best forward, add the BOOST members
- BOOST is the second kind of member — a different way of working out a forecast from the same prices.
- The LOGREG members are reused, never retrained; only the BOOST members train (4 per coin on its own, 5 alongside others),
- so a carried unit ends up with both kinds voting side by side.
- Stage 3 — price any settings from the kept votes, no training
- — every coin is judged by 8 members. These four boxes decide when enough of them agree to act.
- units. Progress above; the set lands on Boards.
- carried units.
- units.
- — progress above; the set lands on Boards.
- Every run launched while a campaign is set attaches to it: sweeps, null rounds, tuning passes,
- scans, stage record sets. The campaign's whole chain travels with any greenlight minted from it.
- ” is locked — nothing has been deleted.
- setup(s) on the Trade tab are still deployed. Retire them there first:
- nothing but the name — this campaign holds no record sets, greenlights or setups.
- that came out of them carry no campaign name of their own, and
- they are named here because they go too — a set another set was cut from cannot be removed while it is still there:
- This cannot be undone.
- ” deleted.
- and the saved models and tuning files belonging to them.
- priced the same trade and were folded into one)
- the filters saved on the parent's table leave
- of them hold fewer than the block: a setting that places the same orders on a unit as another is priced there once)

## Every word, flat (372)

```
1-day 113h 137h 161h 17h 2-day 3-day 4-day 41h 60h 65h 8-day 89h about above act. active ADAUSDT add again against agree all alongside already and another any are argmax arm as at ATOMUSDT attaches auto AVAXUSDT band bar BCHUSDT be because been belonging beside best biggest blank block BNBUSDT Boards Boards. BOOST both box boxes breakout but buy by came Campaign campaign campaigns cannot carried carries carry chain chunk coin coins committee compare conviction count cover crumbs Currently cut daily Daily data day decide decision declared default Delete deleted. Deleting deployed. description different direction directional DOGEUSDT DOTUSDT doubles Each each end ends enough entry estimate ETCUSDT ETHUSDT every Every everything exam exist existing families fee fees fewer files filters finished first fit. folded for forecast forward four freak from gate go going good greenlight greenlights has here history hold holds how in into is it it. its itself judged keep keeps. kept kind kinds known lands landslide last later launched layout lean learning. leave lesson limit LINKUSDT live Load loaded locked LOGREG LTCUSDT many market may member members members. minted models money more. most moved name named names never new next nine No no none not nothing now null number of Off off off. on On once one One one. ones. only or orders ordinary others out own pairs parent parent. passes paused per permanently permute places plain price priced prices prices. Progress progress quarter Quorum quorum rank read reads record records refuse remove removed Removed Retire retrained reused right rounds run running runs same saved says scans sealed second Selected sell set Set set. sets sets. setting settings setup setups. shape share side side. single singles size small so SOLUSDT stage Stage stages start Start started starts static stayed staying still Sweep sweeps tab table taking teaches than that the The their them them. there These they this This those three times to too trade Trade trades trail train trained training trains travels tree triples TRXUSDT tuning tuning-slice turns undone. unit units units. UNIUSDT until up UTC View voice voices vote votes voting was wastes way way. week weekly Weekly weigh weightless were What when where while whole why will window with working worth writes wrong XLMUSDT XRPUSDT yet ZECUSDT
```

---

# Boards

## What the controls are called (128)

- `— nothing came out of`
- `— pick a stage`
- `+both`
- `+hold`
- `1v`
- `alongside`
- `any`
- `Apply settings`
- `arm`
- `auto-apply settings`
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
- `beat the kept null money`
- `before BOOST)`
- `BOOST`
- `call`
- `campaign:`
- `Check this set`
- `chunk shape`
- `Clear filters`
- `Clear picks`
- `coin`
- `coin + chunk shape + alongside`
- `coins`
- `coins in the money`
- `comparisons`
- `Copy settings into the form`
- `could not read this row's records`
- `d`
- `Data fingerprint:`
- `Date ranges:`
- `decision`
- `declared,`
- `Delete record set…`
- `dropping the settings failed:`
- `dropping the settings:`
- `entry`
- `Fill in the kept null money`
- `Fill in the missing settings`
- `Filling in the kept null money`
- `forecast score`
- `forecast score — all members`
- `forecast score — stage 1 members`
- `fuller board helped?`
- `gate`
- `h`
- `held-back $`
- `held-back stops`
- `held-back trades`
- `held,`
- `independent voices`
- `is`
- `is going:`
- `It cannot be done on this set:`
- `it holds and the block does not,`
- `lead over null set`
- `LOGREG +`
- `maximum`
- `median`
- `members`
- `minimum`
- `name`
- `Next`
- `nothing cleared the floors`
- `nothing here`
- `null set money kept`
- `of`
- `of the`
- `order`
- `own`
- `parts`
- `picked on this record set`
- `Prev`
- `Pricing them is`
- `pricings over`
- `Put the missing units back`
- `quorum by`
- `record set`
- `records`
- `records,`
- `Rename`
- `Revert filters`
- `row(s)`
- `rows`
- `rows · page`
- `rung it landed on`
- `Save notes`
- `settings,`
- `share that agreed`
- `Size:`
- `Stage 1`
- `stage 1 order`
- `Stage 2`
- `stage 2 order`
- `Stage 3`
- `still missing`
- `Stop after this unit`
- `t`
- `test $`
- `test trades`
- `the block declares and it does not`
- `the check could not run:`
- `The missing`
- `the run was stopped after`
- `the tables are not totalled yet —`
- `the totalling failed:`
- `this set cannot be added to:`
- `this set holds`
- `trail`
- `tuning-slice $`
- `tuning-slice $ — all members`
- `tuning-slice $ — stage 1 members`
- `Undo the unfinished run`
- `undoing the unfinished run failed:`
- `undoing the unfinished run:`
- `units`
- `vs always-long`
- `What this run actually is`
- `yet —`

## What the dropdowns offer (13)

- `active`
- `all of them`
- `argmax`
- `breakout`
- `conviction`
- `count`
- `directional`
- `does not apply`
- `families`
- `its own history`
- `market`
- `trained`
- `voices`

## Sentences the page prints (70)

- Boards — the record sets, and what each stage wrote
- One section per stage, the whole provenance on screen: picking a stage 3 record set fills the
- stage 2 and stage 1 sections with its parents; picking a stage 2 set fills its stage 1 parent; picking a
- parent puts the child selections away. Each box offers only the record sets that came out of what is picked
- above it. Each section can be put away and comes back as you left it.
- Its tables appear when it lands.
- THIS SET DOES NOT MATCH ITS OWN PLAN.
- unit(s) failed and are missing from every table below — read the numbers accordingly.
- notes — why this run exists, what it showed, what it cost
- STAMP FAILED — this run cannot be proved comparable to any other
- put away — press the arrow to bring it back.
- beat its own null set — tuning-slice $
- lead over null set — tuning-slice $
- Ordered by the sort picked on the columns — saved on this record set, and exactly what a stage 2
- carry forward takes the top of. With nothing picked: beat its own null set, ties broken by lead over null set —
- the fixed rule. Independent voices below members means some members are near-copies of each other and the
- committee is smaller than it looks. The tuning-slice $ columns are the only money before stage 3: each unit's own
- votes priced on the last quarter of its training window, which the fit never saw and the test window is not.
- Test-window money is priced at stage 3 alone.
- - tick records to pick them; the stage 3 set-up on Sweep prices exactly the picked records when its records to price says Selected records.
- Ordered by the sort picked on the columns — saved on this record set, and exactly what a stage 3
- carry forward takes the top of. With nothing picked: forecast score — all members, best first; ties keep their
- carry order either way. Independent voices below members means some members are near-copies; if the BOOST
- members added members without adding voices, this is where that shows. The tuning-slice $ columns are the only
- money here: the members' own votes on the last quarter of the training window, stage 1 members alone and every
- member pooled, so what the BOOST members bought in money is visible before any pricing. Test-window money and the
- held-back window belong to stage 3.
- Stage 3 — settings priced from the kept votes (
- — the records are all kept; the totalling can be tried again after a service restart.
- . This page asks again every few seconds.
- — building in the background; the tables appear here when it lands. This page asks again every few seconds and leaves your place on it alone.
- Table 3.A: Settings, ranked
- — one row per permuted Sweep Stage 3 setting, averaged over its coin/chunk-shape combinations promoted from Stage 2
- show in 3.B
- Show in 3.B
- share that agreed is empty on this set —
- Ordered by the sort picked on the columns — one column at a time, saved on this record set. With
- nothing picked: beat its own null set, best first. Independent voices below members means the committees held
- near-copies, so the setting rests on fewer real opinions than its member count suggests.
- Table 3.B: Every coin of every setting
- — one row for each "short" setting x (each coin + chunk shape); every row averages the "factored out" settings: decision, band and 24/5 variants of the short setting, which are provided as sub-rows
- SHORT SETTING: DECISION, BAND, 24/5 FACTORED OUT
- The four numbers beside each box are what that column holds in the rows the table is showing now, after every filter above. They move as you filter.
- rows — the rest are held back by the filters above.
- reads every record and says whether the set is sound. It adds nothing and changes nothing.
- the set could not be compared with its own block:
- — the set holds exactly what its block declares
- units.
- — nothing was replaced; the records are exactly as they were.
- — what is kept is written beside the old records and only swapped in once it is all there. This page asks again every few seconds.
- records past the end of its own list of settings.
- A run that fills in the missing settings writes its rows as it goes and its list of names only when it finishes, so a run
- that stopped or died leaves these behind. They cover some of this set’s coins and not others, which would read on every
- table as an ordinary row resting on fewer. Undoing puts the set back exactly as it was before that run started; filling in
- again then prices the whole thing once.
- settings its own block does not declare.
- They price a trade that another setting it holds already prices, so every one of them is a second copy of a row that is
- already here. Dropping them deletes those rows and renumbers what is left; nothing else is touched, and the tables are
- worked out again afterwards.
- Drop the settings the block does not declare
- filling in the missing settings failed:
- — nothing already priced was touched.
- filling in the settings this block declares:
- — running in the background; the tables are worked out again when it lands. This page asks again every few seconds.
- stopping after this unit.
- The units that finished are whole and are still on disk, but the ones that did not are not — so the set is not filled in, and
- the line above offers to put it back.
- settings its block declares.
- are ways of asking that did not exist when it ran, so nothing here can answer for them.
- unit(s); nothing already priced is read, touched or priced again.

## Every word, flat (432)

```
1v 3.A 3.B above above. accordingly. active actually added adding adds after afterwards. again again. agreed all alone alone. alongside already always-long an and another answer any appear Apply apply are argmax arm arrow as asking asks at auto-apply average averaged averages avg away away. back back. background band BAND be beat before behind. belong below beside best block board Boards BOOST both bought box breakout bring broken building but by call came campaign can cannot carry changes Check check child chunk Clear cleared coin coin/chunk-shape coins column columns combinations comes committee committees comparable compared comparisons conviction Copy copy cost could count cover Data Date decision DECISION declare declare. declared declares declares. Delete deletes did died directional disk DOES does done Drop dropping Dropping each Each either else empty end entry every Every exactly exist exists factored FACTORED failed FAILED families few fewer fewer. Fill filled Filling filling fills filter filter. filters fingerprint finished finishes first first. fit fixed floors for forecast form forward four from fuller gate goes going held held-back helped here here. history hold holds if in independent Independent into is it It it. its Its ITS keep kept landed lands. last lead leaves left line list LOGREG looks. market MATCH maximum means median member members minimum missing money move name names near-copies never Next NOT not not. notes nothing nothing. now null numbers of of. offers old on once once. One one ones only opinions or order Ordered ordinary other others out OUT over OWN own page parent parents parts past per permuted pick picked picking picks place PLAN. pooled press Prev price priced prices Pricing pricing. pricings promoted proved provenance provided put Put puts quarter quorum ran ranges ranked read reads real record records records. Rename renumbers replaced rest restart. resting rests Revert row rows rule. run rung running Save saved saw says score screen second seconds seconds. section sections Selected selections service set SET set-up set. sets setting SETTING settings Settings settings. shape share short SHORT show Show showed showing shows. Size smaller so some sort sound. stage Stage STAMP started still Stop stopped stopping stops sub-rows suggests. swapped Sweep table Table tables takes test Test-window than that the The their them them. then there. these They they thing THIS this This those tick ties time to top totalled totalling touched touched. trade trades trail trained training tried tuning-slice Undo undoing Undoing unfinished unit unit. units units. variants visible voices votes vs was way. ways were. what What when where whether which whole why window with With without worked would writes written wrote yet you your
```

---

# Funnel

## What the controls are called (244)

- `- chosen`
- `- what each limit would keep of`
- `, and`
- `, and only while`
- `, and press`
- `, and the two halves read`
- `, at the top of a Funnel walk,`
- `, so`
- `; with no forecast at all about`
- `: it starts one every`
- `: this screen draws at most`
- `'s own table was scrambled`
- `(about`
- `% of the`
- `a`
- `a setting against your`
- `a year)`
- `about`
- `above, or`
- `Accept and carry on`
- `across the`
- `Add these limits to the rule`
- `Add this range to the rule`
- `again against each of those`
- `all`
- `All`
- `all units together`
- `alone -`
- `alongside 1`
- `alongside 2`
- `also join across:`
- `also keep none`
- `and`
- `and the box offers all`
- `and the other with`
- `are not shown`
- `are where a survivor`
- `At`
- `avg held-back $`
- `avg test`
- `avg test $`
- `beat its own null set`
- `beaten`
- `beats`
- `best of the four`
- `best single trade $`
- `biggest single loss $`
- `boards, read one at a time`
- `bold when a value beats at least`
- `box that CONTAINS the region -`
- `by which column`
- `can be on the table at once,`
- `can be open on that one`
- `choice(s) recorded on the way,`
- `Choose`
- `chunk shape`
- `chunks a part`
- `clear both boxes, tick`
- `clear the bar,`
- `cleared`
- `clears the bar`
- `coin`
- `coin and shape`
- `copies - that is`
- `Delete Stage 4 record set…`
- `dial`
- `dial(s) still vary across the`
- `did better`
- `do not,`
- `does not`
- `Every one of these`
- `Every trade stakes`
- `fewest chunks a part`
- `fewest settings ranked`
- `fewest trades`
- `Final Rule:`
- `first → second`
- `first dial`
- `for the list, or tick`
- `Funnel`
- `Funnel -`
- `Go to Funnel home`
- `Greenlight`
- `gross per trade $`
- `History`
- `hold`
- `hours`
- `hours, so up to`
- `how many to keep`
- `how much must hold`
- `how to reach the target`
- `in the table`
- `is`
- `is how much history is behind each`
- `is none`
- `is set to -`
- `is the only one`
- `is the same order on both parts,`
- `its middle`
- `keep from`
- `Keep my own rule and go on`
- `Keep the auto-plateau region`
- `Keep these values`
- `Keep this block`
- `keep this list up to date`
- `keeps`
- `lead`
- `Load this grid`
- `mark(s)`
- `mark(s) so far`
- `money by third`
- `more than the`
- `name`
- `Narrow this one`
- `new rule`
- `Next`
- `no figure`
- `no longer on the board`
- `no parts`
- `No scrambled copies on this set`
- `No sealed window`
- `No sealed window on`
- `none`
- `Not evenly swept:`
- `Not measurable here:`
- `not read yet for this rule -`
- `null copies`
- `of`
- `of its`
- `of the`
- `of them`
- `of them - by chance about`
- `of them, your`
- `of this set: the`
- `of values`
- `of values would`
- `on how many of the four`
- `on this set`
- `one half leads with`
- `One rule per coin and shape:`
- `One value far clear of an`
- `order by`
- `Order the whole set by`
- `other coin-and-shape unit`
- `other units positive;`
- `out of`
- `over`
- `pair(s) read,`
- `Passed over:`
- `pays only at`
- `Press`
- `Prev`
- `prices this set's own`
- `Read across`
- `Read across the`
- `read at`
- `Read every pair`
- `Read the grid`
- `Read the other units`
- `Read the ranking`
- `Read the region again`
- `Recommended:`
- `records "accepted`
- `records what you accepted - "`
- `region size`
- `Remove`
- `Rename`
- `row(s)`
- `row(s) match what`
- `rows · page`
- `Rule build settings:`
- `scrambled copies of the table`
- `second dial`
- `Set`
- `set's`
- `setting`
- `settings`
- `settings again from the`
- `settings against your`
- `settings has the same`
- `settings ranked`
- `settings still carry`
- `settings survive`
- `settings that cleared,`
- `settings that have no`
- `settings your rule keeps, which is`
- `settings, not`
- `shape:`
- `show`
- `Split-half:`
- `Stage 4 record set`
- `Start the rule again`
- `Step`
- `Step 7 -`
- `stopped out`
- `Taking the top N is shopping`
- `target size`
- `test`
- `The bar is at`
- `The check:`
- `The heaviest single one is`
- `The middle copy made`
- `The middle copy reached`
- `The ordering is the finding`
- `the records of`
- `the region's rule:`
- `The rule so far`
- `The sealed window is intact on`
- `The trades are counted over`
- `These numbers come from`
- `These settings use`
- `they do not agree`
- `thin below`
- `this one`
- `This rule reads`
- `This section could not read`
- `This set kept no scrambled copies`
- `this walk`
- `this walk is on`
- `to`
- `To keep none and nothing else:`
- `trades`
- `trades over that window is`
- `trades won`
- `Tune`
- `up to`
- `User Rule:`
- `Verify`
- `vs always long $`
- `Walk this one`
- `weeks, or`
- `What`
- `What each floor would keep:`
- `wider than`
- `Work out the test history numbers`
- `worst losing streak $`
- `worst losing streak allowed`
- `Worth walking?`
- `Write the Stage 4 set`
- `Written with warnings:`
- `x`
- `Your bar on this step is`
- `Your block:`
- `your rule:`

## What the dropdowns offer (19)

- `accept what the rule gives`
- `agreeBar`
- `agreeBoth`
- `agreeCopy`
- `agreePct`
- `agreePersist`
- `agreeRule`
- `armMult`
- `avg test $`
- `bandMode`
- `decision`
- `dMult`
- `entry`
- `gate`
- `take the top N by a column (this is shopping)`
- `tHours`
- `tighten the ranges toward the middle`
- `trailMult`
- `weekdaysOnly`

## Sentences the page prints (246)

- There is no stage 3 record set open. Open the Boards section
- once - it will settle on one - and come back. The Funnel walks the set Boards has open, so there is no second
- picker here to disagree with it.
- . Nothing below is from it, because there
- is nothing below. The reason came back in the message box; if that set has just been deleted or renamed,
- pick one on the Boards section.
- - this page asks again in a few seconds
- This Stage 4 record set could not be read:
- . Choose another
- to walk the steps again.
- the tables of the stage 3 set this was cut from are being worked out -
- The whole walk below is one way of choosing: put the settings in order by what they made and keep
- the best of them. This asks whether that order survives being moved to a part of the test window it was not
- chosen on. It reads nothing from the held-back window and nothing from the unread stretch, so it costs nothing
- that can only be spent once - and it decides nothing. A coin and shape that clears the bar has not been shown
- to work; it has only failed to be ruled out.
- Stage 4 record set(s) have been cut from this coin and shape,
- cut from this stage 3 record set - one from another coin and shape says which.
- to walk the steps again and cut another.
- Every money figure on this screen is test money.
- The held-back window is opened once,
- at the cut, on what survives.
- alone - its own money, its own scrambled copies, every dial
- the blended table, every unit averaged into one row per setting, which hides what any one coin does
- Two readings, and both matter: the whole board, so you know before narrowing anything whether
- there is a rule worth hunting here, and the settings the rule keeps, so it cannot drift out of sight while
- you narrow.
- . Every step below is read
- against the two halves of the settings instead, which tests whether a reading is STABLE and never whether the effect is real.
- Going back is allowed and is recorded on the set - a funnel walked back four times has seen more
- of the board than one walked forward once, and the final check can only count what was written down.
- step(s) back so far.
- every reading on this step is drawn beside the same reading on each of this
- A value counts when it beats at least
- would clear that bar.
- this set kept no scrambled copies, so every reading is drawn beside the same
- reading on each of the two halves of the settings. That tests whether a reading is STABLE, never whether the
- effect is real - a weaker check, and it is marked as such on the set.
- values clear the bar on this board; by chance about
- would.
- How far apart a dial's values sit, against how much the result varies anyway.
- - at this many rows every dial shows some movement, and the size of the
- number is a claim only against the check beside it. Press a row to narrow that dial next.
- they do not agree, and nothing below this step means anything until they do.
- Grouping by one dial only averages the others out when every value was swept against the same spread of
- everything else. These are partly some other dial's movement wearing their name.
- . That is not the same as flat.
- A spike is the shape a shuffle makes.
- otherwise flat menu is what a fluke looks like; a hill or a ramp is a relationship.
- a RANGE, never a value - picking the peak is the shopping this walk exists to avoid
- . The count beside the button says what that leaves before you press it.
- is the one value that can be kept on its own here: it is not a point on this dial's scale, it is the
- at all, so keeping it is choosing a kind of setting rather
- than picking a peak. The rule then reads
- to the two dials to compare.
- : a box on the grid holding fewer settings than this number is greyed out, shows its count in brackets, and can never be bold or part of a block.
- to build the grid for those two dials with that cut-off. Changing a dial box reads the grid again by itself; a new thin below number needs the button.
- Bold boxes beat the check. The outlined block is the largest rectangle of bold boxes. Press
- to write it into the rule.
- Or click one box on the grid to start a block of your own...
- ...then click the box at the opposite corner to finish it. Your block turns green, and the green line under the grid says which values it covers...
- ...then press
- to write your block into the rule instead of the outlined one.
- name two dials and press Read the grid
- squares are thin.
- A square built from two settings tells you
- nothing, but it looks like every other square - and it is often the best-looking one on the grid, because small
- groups swing further. Thin squares are marked and keep their count; none is dropped.
- One corner chosen - press the other.
- writes a range on BOTH dials in one step, replacing what the rule held for them. Your own block if you chose one, else the recommended one.
- rule you have built here, applied to each of their records.
- other units are positive under this rule, and on
- the money of the survivors clears the bar against the scrambled copies of that unit.
- clear the bar" as a mark on the set, and opens the next step
- a weaker check than comparing coins
- slices are positive. The check managed
- as many or more, so this count is what a shuffle gives
- " - as a mark on the set, and opens the next step
- these dials hold words, not numbers, so nothing is next to anything on them. A region never
- crosses one unless you say so here - and while it does not, settings that differ on one of them can never be
- in the same region however low the bar above goes.
- Every dial whose values are words is already down to one value here, so there is nothing left
- to join across.
- count a setting in if it makes more than
- join settings up to this many apart
- dollars, per setting, and a setting has to beat this number, not match it - at
- setting that broke even to the cent is left out.
- is "it made money", which is how this step has always read.
- A number below 0 papers over settings that lost that much or less, so one weak setting cannot split a wide
- area in two. The scrambled copies are measured under the same number, or the comparison would be rigged.
- apart is neighbours only, which is how this step has always read; a bigger number lets the region
- step over a setting that is missing from the board rather than stopping at it.
- nothing is papered over: every setting in the region made money.
- settings in this region LOST money - the worst by
- . They are in it because you set the bar at
- . This is recorded on
- the set as a mark and cannot be cleared.
- , but nothing in the region needed it: every setting in it made
- money anyway.
- leaves every range and value you chose exactly as it is and moves to step 6 - keeps
- . Nothing on this
- step is written into the rule, and the set will say the auto-plateau region was never kept.
- The two presses above write the SAME rule, so the choice between them changes nothing except the
- mark on the set.
- The two rules are NOT the same, even where they keep the same number of settings today: the
- rule is what gets read against the copies below and written onto the Stage 4 set, so on a shuffled copy the
- two keep different rows.
- The widest run of neighbouring settings that all made money, and
- by depth inside the region, never by score, so the best-scoring one cannot sneak back in.
- considered.
- replaces every range and value in the rule with the region's edges above - keeps
- A rule can only be ranges and values, never a list of settings, so this keeps the smallest
- in it. Those are settings the region walked around, and at this bar they are
- settings that did not clear it.
- No region: nothing here has neighbours that also work, which is what an isolated fluke looks like.
- With the longest hold your rule still allows,
- coin and shape(s) this reading covers:
- if every one of them is in a trade.
- What these limits are limits on.
- , so every dollar figure on this walk is dollars at that stake.
- A position is opened at the start of a chunk and held for the hold, so a coin can hold more than one at a time
- whenever the hold runs longer than the gap between starts.
- days. That is the test window: the part of the history
- the money on this walk was made in. Held-back and sealed time sit after it and are not counted here.
- a year.
- The window the trades were counted over cannot be worked out
- , so a trade count here cannot be put on a yearly footing.
- , at the top of this screen. Nothing below can be read or
- set until that has run for this record set: the two limits are read off the settings themselves, and no
- setting carries these numbers until it is pressed. It changes no rule and no record.
- Read the two lines below: what each limit would keep, of the settings that survive.
- - in dollars, per coin: the deepest the running total ever sat below
- its own best point. A setting whose worst streak is deeper than this is dropped.
- - counted over the window named above. A setting that traded fewer times is dropped.
- . Both limits go into the rule together, and the survivor count at
- the top moves.
- The numbers a sweep does not keep - the worst losing streak, the biggest single loss, how
- many trades won, and how much of the result rests on guessing what happened inside a single bar - are worked
- out for every setting in this record set, above the steps, and the two limits here are read off the
- that survive. Totals flatter; an average losing streak hides
- the one that would have ended you.
- The choices you made ARE the rule. This is what gets written - not the rows it happens to
- pick today - because a rule can be checked against scrambled data and a single row cannot.
- , on the board this walk exists to stop you shopping. It is
- offered because the choice is yours, and whichever you use is recorded on the set so the final check knows what
- it is judging. Only columns a scrambled copy of the table really has are offered, so the same rule takes the
- same top N of a scrambled copy and the two can be compared.
- An empty or one-setting result is written with a warning, never refused.
- the same days with the forecasts dealt onto the wrong ones -
- - and the widest region each of them reached.
- reached a region as wide as yours, so yours is
- A size counts settings, never dollars: a copy that got a WIDER region than yours may have got it
- out of settings making pennies. That is what the second column is for.
- keeps the set open and clears every choice - recorded as going back
- The rules below were built on test money
- - the steps read the test window and nothing
- else. The held-back window is opened once, at the cut, on what survives, and
- is that one look. Reading down that column and taking the best of these
- is shopping the held-back window, which is the one thing it does not
- survive. It is here because
- is graded, and they start from what is on this screen.
- settings survive. These are the ranges and values you chose yourself, and they are what step 5 read to work out
- its auto-plateau region; keeping that region replaced every one of them with the rule below.
- Recovered from this walk\'s own recorded steps and written onto the record
- , because it was cut before the rule feeding step 5 was kept.
- The auto-plateau region was never kept on this walk, so nothing of yours was replaced - the rule
- below is the one you built.
- Re-applying this rule to the same board today gives
- . The rows below are the ones the set
- wrote down, which is what it decided.
- of them are no longer on the board at all
- and are shown with no numbers.
- How every step of this walk was checked.
- times, each copy the same days in a jumbled
- order. Every one of the
- choices recorded below was read once against the real table and
- , and a value counted only when it beat at least
- of them.
- , so every step was read against the two halves of
- 's settings instead - which tests whether a reading is STABLE and never whether the
- effect is real, and is marked as such on this set.
- - a final stretch of that unit's history no part of this walk touched, from
- onward to the newest data the box holds.
- step(s) back.
- This Stage 4 record set kept no settings at all. An empty result is written with a
- warning rather than refused, because the choice is yours - the warning is on the heading above.
- - the rule fixed those, so they are said here once rather
- than repeated on every row.
- The numbers a sweep does not keep - worst losing streak, biggest single loss, best
- single trade, trades won, stopped out, gross per trade - are not on this set. Either it was cut without pressing
- at the top of a Funnel walk, or it was cut before a set kept its own copy of them.
- The same press on the heading above prices this set's own settings again and keeps the
- answer here, for good.
- - or press any heading in the table below.
- of them are in the box below, in whatever order
- you set - scroll it.
- settings at once.
- could not be read.
- Each column ranks the settings on one part of the test window and reads the money on another:
- puts them in order by what they made in the first part and scores that order on the
- second.
- no relation at all, and a number below zero is
- the order coming out backwards.
- is how many settings here carry all three parts;
- is how many do not and were left out.
- of those figures, and it is the one that separates the shapes: a shape that decides once a week gets about
- sixteen chunks a part on today's history where one that decides daily gets over a hundred.
- Three things this cannot tell you, so do not read it as though it could.
- The four are not four separate tests
- - three of them score on the third part, so a third part that
- happens to look like the rest of the window lifts all three together.
- that never touches it.
- A coin that went one way for the whole window scores well here for no skill at
- - if everything long made money in both parts, the order survives because the direction did, and this
- column cannot tell that apart from a rule that works.
- And a part with no trades in it counts as zero
- the same as a part that traded and broke even, so a board of rarely-trading settings has a large block of
- settings tied on nothing; that pulls a reading towards
- rather than flattering it.
- would have to beat besides the scrambled copies is not known here -
- Dollars a setting, over the test window - the same window every other figure on this screen is
- read on. Nothing here is from the held-back part or the unread part.
- different hold lengths, so each figure is a span across them and
- means beaten at the worst of them.
- of the four has no figure, so the best of them is not known.
- there is a simpler thing that did better and it needs no forecast at all.
- pair(s) to read. On this box that is about
- Nothing here is ranked by money: a block is scored only on how many of those copies it beats.
- reading them now - this page follows it and shows the list when it is done.
- The last reading of these pairs failed:
- . Press
- to try again - it is not started again by itself, or a reading that cannot work would
- be started on every draw.
- and it is read again by itself every time your rule changes.
- say something the two single-dial ranges cannot
- : no survivor carries this number yet - press Work out the test history numbers first.
- The copies carry no money figure, so only the sizes can be compared.
- A copy is the same days with the forecasts dealt onto the wrong ones, so anything it made came from the price
- moving and not from the forecast.
- on the parent's board. Those numbers are not
- stored by a sweep. They are worked out by
- and kept beside the parent record set - so a set cut before that was pressed over the whole of its parent can
- find them gone from the parent's board.
- parent's records and keeps the answer
- , where the press at the top of a walk keeps it beside
- the parent. Minutes, and it waits for any sweep that is running.

## Every word, flat (815)

```
...then about above above. Accept accept accepted across across. Add after again again. against agree agreeBar agreeBoth agreeCopy agreePct agreePersist agreeRule all All all. allowed allows alone alongside already also always an An and And another another. answer any anything anyway. apart applied are ARE area armMult around as asks at At auto-plateau average averaged averages avg avoid back back. backwards. bandMode bar bar. be beat beaten beats beats. because been before behind being below below. beside besides best best-looking best-scoring better between bigger biggest blended block block. board board. Boards boards bold Bold both BOTH Both box boxes boxes. brackets broke build built built. but button button. by came can cannot cannot. carries carry cent chance changes changes. Changing check check. checked checked. choice choices Choose choosing chose chosen chunk chunks claim clear cleared cleared. clears click coin coin-and-shape coins column columns come coming compare. compared. comparing comparison considered. CONTAINS copies copy corner costs could could. count counted counts covers covers... crosses cut cut-off. daily data date days days. dealt decided. decides decision deeper deepest Delete deleted depth dial dials did differ different direction disagree dMult do do. does dollar dollars Dollars done. down down. draw. drawn draws drift dropped. each Each edges effect Either else else. empty ended entry even evenly ever Every every everything exactly except exists failed far far. feeding few fewer fewest figure figures final Final find finding finish first first. fixed flat flat. flatter flattering floor fluke follows footing. for for. forecast forecast. forecasts forward four from Funnel funnel further. gap gate gets gives Go go goes. Going going gone good. got graded green Greenlight greyed grid gross Grouping groups guessing half halves happened happens has have heading heaviest held held-back Held-back here here. hides hill history History hold holding holds. home hours how How however hundred. hunting if in in. inside instead intact into is isolated it It it. its itself join judging. jumbled just keep Keep keeping keeps kept kept. kind know known known. knows large largest last lead leads least leaves left lengths less lets lifts like like. limit limits line lines list Load long longer longest look look. looks losing loss lost LOST low made makes makes. making managed many mark marked match matter may means measurable measured menu message middle Minutes missing money money. more most moved movement moves moves. moving much must my name name. named narrow Narrow narrow. narrowing needed needs neighbouring neighbours never new newest next Next next. no No none not Not NOT Nothing nothing nothing. now null number numbers numbers. of off offered offers often on On on. once once. one One one-setting one. ones only Only onto onward Open open open. opened opens opposite or Or order Order order. ordering other other. others otherwise out out. outlined over own own... page pair pairs papered papers parent parent. part part. partly parts Passed pays peak peak. pennies. per pick picker picking point point. position positive positive. Press press pressed pressed. presses pressing Prev price prices pulls put puts ramp range RANGE ranges ranked ranking ranks rarely-trading rather Re-applying reach reached reached. read Read read. reading Reading readings reads real real. really reason Recommended recommended record record. recorded records records. Recovered rectangle refused refused. region relation relationship. Remove Rename renamed repeated replaced replaces replacing rest rests result rigged. row row. rows rows. rule Rule rule. ruled rules run running running. runs said same SAME sat say says scale score scored scores scrambled screen screen. scroll sealed second second. seconds section section. seen separate separates set Set set. setting settings settings. settle shape shapes shopping shopping. show shown shows shuffle shuffled sight simpler single single-dial sit sixteen size sizes skill slices small smallest sneak so some something span spent spike split Split-half spread square squares STABLE stage Stage stake. stakes start Start started starts starts. Step step steps still stop stopped stopping stored streak stretch such survive survive. survives survives. survivor survivors sweep sweep. swept swing table tables take takes Taking taking target tell tells test tests than that That the The their them them. themselves then There there These these they They thin Thin thin. thing things third This this those Those though tHours three Three tick tied tighten time times to To today together together. top total Totals touched touches toward towards trade trade. traded trades trailMult try Tune turns Two two two. under unit unit. units unless unread until up use User value values varies vary Verify vs waits walk Walk walked walking walks warning warnings was way weak weaker wearing week weekdaysOnly weeks well went were what What whatever when whenever where whether which which. whichever while whole whose wide wider WIDER widest will window with With without won words work Work worked works. worst Worth worth would would. write Write writes written Written wrong wrote year year. yearly yet you you. your Your yours yourself zero
```

---

# Verify

## What the controls are called (115)

- `- INCOMPLETE, never a pass`
- `, information only)`
- `, parent`
- `, reader`
- `, so this is never a gate`
- `· bar`
- `· check:`
- `· releases: set`
- `· rule keys`
- `· sealed window`
- `(read`
- `(the first digits differ)`
- `), threshold`
- `); noise must lose at least`
- `a setting -`
- `and beats`
- `as stored`
- `at least`
- `avg held-back $`
- `bar`
- `bar share %`
- `beat its own null set`
- `beat the best of the four`
- `beaten by rule`
- `beats`
- `beats N of K`
- `best of the four`
- `best trade $`
- `by test money made`
- `clear the bar`
- `clear the same bar, about`
- `clears the bar`
- `comparison`
- `copies (`
- `copies allow is 1 in`
- `copies kept · median lead`
- `copies, the bar being`
- `deal(s) a setting,`
- `earlier readings:`
- `earlier rides:`
- `FAILS`
- `fee`
- `Final Rule:`
- `Footing:`
- `gone`
- `gross per trade $`
- `held-back $`
- `held-back $ a setting`
- `how many`
- `include`
- `INCOMPLETE, never a pass`
- `it made`
- `largest drawdown $`
- `lead`
- `made money ·`
- `mark(s) carried ·`
- `Marks the walk was carried past:`
- `median held-back $`
- `money by third`
- `no figure`
- `noise must lose at least %`
- `not intact`
- `not known`
- `not priced`
- `now,`
- `null copies`
- `of`
- `of the time; the finest claim`
- `on the record,`
- `other units positive;`
- `over`
- `own verdict`
- `positive`
- `read`
- `read here,`
- `Read what the rule dropped`
- `real`
- `refused:`
- `rule ahead by`
- `rule ahead by it`
- `Rules declared before the numbers:`
- `sanity:`
- `scrambled boards' own best`
- `setting`
- `settings`
- `Stage 4 record set`
- `stamped`
- `STANDS`
- `step(s) and`
- `step(s) back`
- `stopped out`
- `survivors`
- `survivors made`
- `test $`
- `test largest drawdown $`
- `the four comparisons are not known`
- `The other units:`
- `The ride on the held-back window`
- `the survivors on this look`
- `These settings use`
- `this read`
- `trades`
- `trades a setting`
- `trades won`
- `under release`
- `unit`
- `unit failure(s)`
- `unstamped (`
- `User Rule:`
- `vs always long $`
- `What a pass buys:`
- `Work out the held-back ride`
- `worked out`
- `worst trade $`
- `would by chance ·`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (52)

- The verdict on a Stage 4 record set
- A rule can be checked against scrambled data and a single row cannot, so this reads the set as a
- whole: what its survivors made on the held-back window, against the four simpler things the Funnel prints,
- against the same settings' money on every scrambled copy of their table, with a sanity line that noise must
- lose, and the marks the walk was carried past. Opening this panel reads no held-back number; the press below
- is the stamped look, and every look is counted.
- No stamped read on this set yet. The first press writes the verdict; later presses are printed as later looks and never replace it.
- - no Stage 4 record set on this box yet - cut one on the Funnel -
- the rule does not give back its own survivors today
- Looks at the held-back window before any stamp:
- Read the rule against nothing on the held-back window
- ); comparisons gated: all four, and the rule must beat the best of them (
- The rule on a noise board, held-back window:
- this set kept no scrambled copies, so nothing was read against nothing
- · a forecast-free rule clears this about
- , a floor, never a measure of strength · lead
- Every survivor against its own copies:
- beat always long · head-to-heads won
- scrambled held-back figures on the whole board lose money (among the survivors
- PASS — noise mostly loses, as fees demand.
- FAIL — NOISE IS PROFITING: the simulation is broken; do not read the tests above.
- On a window that pays one direction the copies are paid too, and this can fail honestly.
- - no scrambled figure to read, so nothing above it can be read against noise.
- other units positive on the held-back window;
- this window only. It stops obvious chance results being frozen; the
- forward paper test after freezing is the real judge.
- The rule on the other units, held-back window
- The same rule on every other coin-and-shape unit of the stage 3 set this was cut from, each read on its
- own held-back window against its own scrambled copies at the bar declared above. Two counts, information only,
- never a gate; a mark when fewer than half are positive. About five seconds a unit, read one at a time.
- Read the rule on the other units' held-back windows
- Not read on this set yet.
- What the rule dropped, held-back window
- The settings the rule did NOT keep, read on the same held-back window as the survivors. A count of
- survivors that clear a bar cannot be read without it: if nearly every setting on the board was positive here, then
- all the survivors being positive says the window rose and says nothing about the picking. Each side is read
- against the four at its own hold lengths. Nothing is priced, every figure is already on the board, and this is a
- counted look at the held-back window. Information only, never a gate.
- how many of the dropped to read (blank = all
- dropped settings were read, taken with an even stride through the board's own order.
- What the held-back window looked like from inside, per survivor: the largest drawdown, the worst
- and best single trade, trades won, stopped out, gross per trade and money by third, beside the same numbers
- on the test window. Worked out by the same pass as the missing numbers on the Funnel, on this unit only;
- minutes. Information only, never a gate, and every press is a stamped look at the held-back window.
- survivors, in the set's own order. There is no sort on this table: a sort is a look.
- Not worked out on this set yet.
- not known - one of the four has no figure
- different hold lengths, so each comparison is read at the worst of them.
- Information only, never a pass or fail.
- Line A, the rule on the test window against its own copies: real
- ). Line B, the bound on shopping: the best
- survivors, every one of them, in the set's own order. There is no sort on this table: a sort is a look.

## Every word, flat (316)

```
about About above above. after against ahead all allow already always among an and any are as at avg back bar be beat beaten beats before being below beside best blank board boards bound box broken buys by can cannot carried chance check checked claim clear clears coin-and-shape comparison comparisons copies copy count counted counted. counts cut data deal declared demand. did differ different digits direction do does drawdown dropped each Each earlier even every Every FAIL fail fail. FAILS failure fee fees fewer figure figures Final finest first five floor Footing forecast-free forward four freezing from frozen Funnel gate gate. gated give gone gross half has head-to-heads held-back here hold honestly. how if in include INCOMPLETE information Information inside intact is IS it It it. its judge. keep kept keys known largest later lead least lengths lengths. like line Line long look look. looked looks Looks lose loses made many mark marks Marks measure median minutes. missing money mostly must nearly never no No noise NOISE noise. not Not NOT nothing Nothing now null number numbers obvious of on On one only only. Opening or order. other out over own paid panel paper parent PASS pass past past. pays per picking. positive positive. press presses priced printed prints PROFITING read Read reader readings reads real record refused release releases replace results ride rides rose row rule Rule Rules same sanity says scrambled sealed seconds set setting settings share shopping side simpler simulation single so sort Stage stage stamp stamped STANDS step stopped stops stored strength stride survivor survivors survivors. table taken test tests than that The the their them them. then There These things third this threshold through time time. to today too trade trades Two under unit units unstamped use User verdict vs walk was were what What when whole window window. windows with without won Work Worked worked worst would writes yet yet.
```

---

# History

## What the controls are called (83)

- `- INCOMPLETE, never a pass`
- `, the bar being`
- `: retrains on the first`
- `· built from this table:`
- `· retrained on the first`
- `· sealed window`
- `· verdict`
- `% of history, tested on the next`
- `%, judged on the`
- `%, tests on the next`
- `12 months`
- `18 months`
- `24 months`
- `30 months`
- `36 months`
- `48 months`
- `a setting -`
- `average $`
- `beaten by rule`
- `beats`
- `best of the four`
- `built`
- `clear the same bar, about`
- `comparison`
- `FAILS`
- `from`
- `graded`
- `half-lives`
- `held-back $ a setting`
- `INCOMPLETE, never a pass`
- `it made`
- `judged on the`
- `largest drawdown $`
- `look`
- `made money · never a gate`
- `members, both kinds · verdict`
- `name`
- `no figure`
- `none stood`
- `none were priced`
- `not intact`
- `not known`
- `of`
- `of the time · lead`
- `PASS`
- `real`
- `records improved with a half-life`
- `records)`
- `refused`
- `refused:`
- `Retrain at the ticked half-lives`
- `rows won`
- `rule ahead by`
- `rule ahead by it`
- `Run the reserve grade on this set`
- `setting`
- `Stage 4 record set`
- `stamped)`
- `STANDS`
- `stood`
- `stood (PASS, release`
- `stopped out`
- `survivor(s) were not priced`
- `survivors`
- `survivors made`
- `taken`
- `the four comparisons are not known`
- `the survivors on this look`
- `The unread window:`
- `These settings use`
- `this read`
- `this window has been read`
- `time(s) already`
- `to`
- `trades`
- `trades a setting`
- `under release`
- `unread $`
- `vs always long $`
- `whole chunks`
- `window`
- `worst trade $`
- `would by chance ·`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (31)

- The reserve grade on a Stage 4 record set
- The unread window is the sealed 13% no part of the search touched: it was cut away before anything
- trained, and it runs from where the seal began to whatever the box holds today. This prices the set's survivors
- on it, on the set's own coin and shape, with the members forecasting it from the models they were trained as,
- and reads the result by the same four rules as the verdict on Verify: money, the two comparisons a rule has to
- beat, the scrambled copies at the set's own bar, and noise losing. It refuses without a verdict that passed
- under this release line. Every grade is a counted look, and only the first is at data nothing has seen.
- No grade on this set yet. The first press is the first look at the unread window.
- Retrain with recent history weighted
- The same records, retrained: every setting of the set chosen above is kept exactly as it is, and only the
- forecasts behind it are trained again with recent history weighted more, once per half-life ticked, keeping every other
- training choice the set was made with. Then the same records are priced again on the stretch the retraining never
- touched, in one pass beside the set's own unweighted figures. A set built 61/13/13/13 retrains on the first 72% of
- history and tests on the next 15%, and is judged on the Reserve; a set built 70/15/15 retrains on its 70% and tests on
- its 15%, and is judged on the Held window. Every press is a counted look.
- No half-life run on this set yet.
- no Stage 4 record set on this box yet
- whole chunks · the box's data reached
- Against scrambled copies of that window:
- · a forecast-free rule clears this about
- Every survivor against its own copies:
- sanity, over the survivors' copies only:
- scrambled unread figures lose money, threshold
- FAIL - NOISE IS PROFITING: do not read the lines above
- - they are not in the stage 3 set's block on this unit
- survivors, in the set's own order. There is no sort on this table: a sort is a look.
- survivor(s) are not in the stage 3 set's block on this unit
- records, in the set's own order. Green is the best of the row: a half-life wins only by at least a cent over the unweighted column; a tie goes to the unweighted side.
- Build the half-life set from this table
- not known - one of the four has no figure
- different hold lengths, so each comparison is read at the worst of them.

## Every word, flat (236)

```
about above again Against against ahead already always and anything are as at average away bar beat beaten beats been before began behind being beside best block both box Build built by cent chance choice chosen chunks clear clears coin column comparison comparisons copies counted cut data different do drawdown each Every every exactly FAIL FAILS figure figures figures. first forecast-free forecasting forecasts four from gate goes grade graded Green half-life half-lives has Held held-back history hold holds improved in INCOMPLETE intact is IS it It its judged keeping kept kinds known largest lead least lengths line. lines long look look. lose losing. made members models money months more name never next no No noise NOISE none not nothing of on once one only order. other out over own part PASS pass passed per press priced prices PROFITING reached read reads real recent record records refused refuses release reserve Reserve result Retrain retrained retraining retrains row rows rule rules Run run runs same sanity scrambled seal sealed search seen. set setting settings shape side. so sort Stage stage stamped STANDS stood stopped stretch survivor survivors table taken tested tests that The the them. Then There These they This this threshold ticked tie time to today. touched trade trades trained training two under unit unread unweighted use verdict Verify vs was weighted were whatever where whole window window. wins with with. without won worst would yet yet.
```

---

# Tune

## What the controls are called (79)

- `— uplift`
- `, each a counted look`
- `, on its`
- `, p=`
- `; peak concurrent`
- `; worst trade`
- `: tightest no-winner-lost stop`
- `· by depth among the captured:`
- `· held-back`
- `· test`
- `· verdict`
- `(flat`
- `(worst distance`
- `A heavy scan is running (`
- `Apply custom`
- `Apply to the live rule`
- `by depth -`
- `Capture the trades of this set`
- `Chance check:`
- `drawdown`
- `entries`
- `entries on the`
- `Exposure:`
- `h`
- `held-back`
- `held-back entries`
- `last scan failed:`
- `last sweep failed:`
- `look`
- `losers over`
- `no`
- `No stop (clear)`
- `none stood`
- `of`
- `of the Stage 4 record set`
- `on record:`
- `one survivor`
- `or apply a custom stop`
- `over`
- `per-$`
- `priced entries: flat`
- `Read from the capture:`
- `refused:`
- `Run conviction sweep`
- `running…`
- `Save the reason`
- `scan`
- `scan target`
- `scans run on this capture:`
- `shuffled deals, mean uplift`
- `Stage 4 record set`
- `stamped)`
- `stood ·`
- `stood (PASS, release`
- `survivor`
- `survivor(s) not captured:`
- `survivors`
- `survivors captured`
- `taken`
- `Target:`
- `test`
- `test entries,`
- `the capture on record`
- `the scans, newest first`
- `the survivor`
- `time(s)`
- `training`
- `training entries,`
- `Tune protective stop`
- `under release`
- `Verdict:`
- `vs ladder`
- `when`
- `window(s), captured`
- `windows`
- `windows the scans read`
- `winners /`
- `x`
- `your reason for this choice`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (28)

- ) — one at a time; both launchers are disabled until it lands (scans run minutes and cannot be aborted mid-flight).
- Protective stop tuner — on the captured trades, loses no winner
- Reads the captured trades of one survivor of a Stage 4 record set over the windows ticked and finds the
- tightest fixed stop that would not have clipped a single winner, plus the sacrifice curve (give up top winners →
- tighter stop → NET $). Scanning applies nothing. Target:
- Stage 4 record set(s) with their trades captured
- no choice about the stop has been recorded yet
- currently applied on the trading machine:
- Conviction sizing — bet more when more members agree?
- Prices the DECLARED clip ladder (multiplier = winning-side vote count) as a pure $ overlay on the
- same captured trades, against a shuffled-assignment chance check and exposure-honest metrics.
- entries.
- NET = winner $ given up + loss-side $ vs no stop; positive means the stop helps. Apply buttons exist
- only for the running engine; for a lab row the number informs the greenlight instead.
- reading the held-back entries is look
- Per-trade capture of a Stage 4 record set
- The two scans above take a list of trades and price them themselves; a Stage 4 record set holds money per
- window and never the trades. This writes them down: for every survivor that enters at market with no trailing stop,
- every hour the rule spoke on the training, test and held-back windows, with the side, how many members called that
- side, and the money the simulator made on that one trade. It refuses without a verdict that passed under this release
- line. Once captured, the set appears in the scan target box above, and a scan that reads the held-back entries is a
- counted look at the held-back window.
- the held-back entries have been read
- No capture on this set yet. The scans above cannot be aimed at it until there is one.
- this read of the held-back entries was look
- · nothing is applied from a Stage 4 record set
- no Stage 4 record set on this box yet
- survivor(s) are not in the stage 3 set's block on this unit

## Every word, flat (237)

```
aborted about above against agree aimed among and appears applied applies apply Apply are as at be been bet block both box buttons by called cannot capture Capture captured chance Chance check choice clear clip clipped concurrent Conviction conviction count counted currently curve custom deals DECLARED depth disabled distance down drawdown each engine enters entries entries. every exist Exposure exposure-honest failed finds first fixed flat for from give given greenlight has have heavy held-back helps. holds hour how in informs instead. is it It its lab ladder lands last launchers line. list live look losers loses loss-side machine made many market mean means members metrics. mid-flight minutes money more multiplier NET never newest no No no-winner-lost none not nothing nothing. number of on Once one one. only or over overlay PASS passed peak per per- Per-trade plus positive price priced Prices Protective protective pure read Read reading Reads reads reason record recorded refused refuses release row rule run Run running sacrifice same Save scan Scanning scans set shuffled shuffled-assignment side simulator single sizing spoke Stage stage stamped stood stop survivor survivors sweep take taken Target target test that the The their them themselves there this This ticked tighter tightest time to top trade trade. trades trades. trading trailing training Tune tuner two under unit until up uplift Verdict verdict vote vs was when window window. windows winner winners winning-side with without worst would writes yet yet. your
```

---

# Greenlight

## What the controls are called (20)

- `- distance`
- `· verdict`
- `(worst distance`
- `by depth -`
- `Existing greenlights`
- `fee`
- `Greenlight a Stage 4 record set`
- `Greenlight this survivor`
- `greenlighted`
- `name`
- `none stood`
- `none yet`
- `nuked`
- `one survivor`
- `refused:`
- `Stage 4 record set`
- `stamped)`
- `stood (PASS, release`
- `survivors`
- `Trade tab`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (15)

- Greenlight — the decision that a config is fit to trade
- Records WHO/WHEN/WHY with the exact frozen config, engine version, and the campaign's whole
- evidentiary chain. The config then appears on the Trade tab (both sides) for activation. Only greenlighted
- configs ever trade — no hand-built live configs, ever.
- is what the run behind each one was priced at, per trade and each way. It is not a
- setting here — it is what the evidence was found under, and a config sent to the Trade tab starts out priced
- at it and can be changed there. A dash means the run predates the fee being recorded.
- Activation, deactivation and nuking live on the
- The other way to write the decision down: from a Stage 4 record set whose verdict stood on Verify. One of its
- survivors is taken forward, chosen by how surrounded it is inside the rule (the setting nearest the middle of every
- range, never the one with the most money) or named by you, and both are recorded. The frozen settings carry the
- way its members agree exactly as the survivor does. Nothing here trades, and nothing built from it can be put to
- work until the live path speaks that agreement.
- no Stage 4 record set on this box yet
- why — the decision record (required)

## Every word, flat (143)

```
Activation activation. agree agreement. and appears are as at be behind being both box built by campaign can carry chain. changed chosen config configs dash deactivation decision depth distance does. down each engine ever ever. every evidence evidentiary exact exactly Existing fee fit for forward found from frozen Greenlight greenlighted greenlights hand-built here how inside is It it its live means members middle money most name named nearest never no none not Nothing nothing nuked nuking of on one One Only or other out PASS path per predates priced put range record recorded. Records refused release required rule run sent set setting settings sides speaks Stage stamped starts stood surrounded survivor survivors tab taken that the The then there. this to trade Trade trades under until verdict Verify. version was way way. what WHO/WHEN/WHY whole whose why with work worst write yet you
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

