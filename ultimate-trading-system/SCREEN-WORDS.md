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

Generated from **605def34aa58 — what the box is serving**, not from the working tree.

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
- **Coins**
- **Sweep**
- **Boards**
- **Funnel**
- **History**
- **Tune**
- **Held**
- **Reserve**
- **Greenlight**
- **Help**

Read from `TABS` in `public/construct.js`.

---

# Data

## What the controls are called (10)

- `Data on server`
- `Download`
- `Download / refresh`
- `download new coin(s), comma-sep`
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
again. and asset. back been below board cache cached coin comma-sep current Data data DELETE deletes deleting download Download downloading Every every exchange from gap Global have here is it job keeps latest may month month. never new newest nothing null on only partial Purge purge range re-fetches reads Refresh refresh refuses rest. runs server shrinks silently sweep the this through to Trim trim tune way while whole window. write yet
```

---

# Coins

## What the controls are called (237)

- `-hour window · one decision a`
- `— press`
- `, after the`
- `, and`
- `, and its pooled money is`
- `, opening`
- `· at band`
- `· band`
- `· median`
- `· plateau`
- `· release`
- `· with the link cut, a plateau in`
- `(chance is`
- `(from a sit-out band sweep of`
- `(its own sweet spot)`
- `\u00b7`
- `&#9666; its rows`
- `&mdash;`
- `&middot;`
- `&middot; pooled late money`
- `% · sit out under ±`
- `% acted on`
- `% called`
- `% round trip`
- `× chance`
- `a trade`
- `above`
- `after falling`
- `after rising`
- `All`
- `also each unit's sweet spot band`
- `Apply`
- `Apply settings`
- `at band`
- `auto-apply settings`
- `band`
- `band(s)`
- `bands`
- `bands, mean`
- `before cost`
- `Below it,`
- `best on both halves`
- `best window`
- `black`
- `called`
- `Candidates for Sweep`
- `candles`
- `Carry on with it`
- `changes`
- `check`
- `Choose early, read late`
- `chunk shape`
- `chunk shapes`
- `Clear filters`
- `Clear the sort`
- `coin`
- `coins`
- `coins (blank = all`
- `coins and shapes that pass`
- `coins to walk (blank = all)`
- `could not be read:`
- `decision`
- `decision's own window,`
- `decisions`
- `decisions from`
- `Delete it`
- `did not finish —`
- `down`
- `downloaded)`
- `each picked on its first`
- `early`
- `edge`
- `edge over chance`
- `edge per called trade`
- `entire`
- `Every figure below is`
- `falling`
- `fewest late windows`
- `fewest trades`
- `fewest trades a window must have`
- `fewest trades each half must have`
- `fewest windows`
- `from`
- `gap (move)`
- `gap (points)`
- `green`
- `had ONE setting win both halves`
- `hidden by the filter boxes above`
- `highest sit-out band`
- `highest tried`
- `holds`
- `How each coin reads`
- `is on over there,`
- `It is a share`
- `itself is untouched`
- `judged`
- `late`
- `late windows paid`
- `late windows up`
- `lead`
- `learned before each window`
- `learned once on train`
- `least best window, %`
- `least early, %`
- `least late windows paid, %`
- `least late windows up, %`
- `least late, %`
- `least lead, %`
- `least per trade per spread`
- `least per trade, %`
- `least percentile`
- `least whole per trade, %`
- `least windows paid, %`
- `least windows up, %`
- `least worst late window, %`
- `least worst window, %`
- `look-back`
- `look-backs`
- `lowest sit-out band`
- `lowest tried`
- `more month(s) cached since`
- `most scrambles as good`
- `most slides as good`
- `most spread, %`
- `most whole scrambles as good`
- `most whole slides as good`
- `move after falling`
- `move after rising`
- `name for the set this walk writes`
- `Next`
- `no`
- `no coin has been read`
- `no ratio`
- `of`
- `of them picked`
- `on disk, finished`
- `One coloured unit is one`
- `only rows best on both halves`
- `only rows same pick`
- `only what is ticked on Coins`
- `Open this screen`
- `Open this set`
- `own`
- `pair(s) shown`
- `part`
- `per decision`
- `per trade`
- `per trade per spread`
- `percentile`
- `pick(s) pay after that round trip`
- `picking blind`
- `plateau`
- `pooled late money above the`
- `Prev`
- `Promote every row shown`
- `Promote the ticked rows`
- `read`
- `Read these coins`
- `red`
- `Remove`
- `Remove them all`
- `Remove these files`
- `removes exactly the`
- `Rename it`
- `rising`
- `row(s)`
- `row(s) —`
- `row(s) kept`
- `row(s) taken off the list —`
- `rows · page`
- `run`
- `same pick`
- `Save as&hellip;`
- `scrambled copies`
- `scrambles as good`
- `screens on this box`
- `searched`
- `shape is walked for each:`
- `signal`
- `sit out`
- `sit-out bands to sweep`
- `sit-out bands to try`
- `slides as good`
- `span,`
- `spread`
- `stands alone`
- `stands for`
- `starts`
- `step`
- `Stop`
- `sweet spot band`
- `Take the`
- `takes`
- `th`
- `the coin's usual move`
- `the colour changes no call`
- `The four columns on the`
- `the last reading stopped:`
- `the records carry`
- `the walk stopped:`
- `thin side`
- `Throw it away`
- `Tick every row shown`
- `to`
- `trades`
- `trades a month`
- `trailing`
- `traits`
- `Untick every row shown`
- `up`
- `up after falling`
- `up after rising`
- `UTC · release`
- `UTC, and was walked by release`
- `Walk it forward`
- `walk sets on this box`
- `walked row(s)`
- `where it fell,`
- `where it moved`
- `where price rose across that`
- `which way it leans`
- `whole`
- `whole band`
- `whole history`
- `whole look-back`
- `whole per trade`
- `whole scrambles as good`
- `whole slides as good`
- `window moves from`
- `window, months`
- `windows`
- `windows &mdash; which the`
- `windows paid`
- `windows up`
- `worst late window`
- `worst window`
- `yes`

## What the dropdowns offer (2)

- `61/13/13/13 (sealed exam)`
- `70/15/15`

## Values the screen shows as data (8)

- `both`
- `fading`
- `mixed`
- `much`
- `often`
- `reverting`
- `steady`
- `trending`

## Sentences the page prints (97)

- puts the three boxes above into the list below. Nothing is swept until the coins are read.
- file(s) on disk this release cannot draw:
- file(s) named above and nothing else
- LOOK ONLY. Everything in this section changes the colours of the bars below and nothing
- else.
- No reading is taken, no record is written, and neither box here reaches Sweep, Walk it forward or
- Candidates for Sweep.
- A picture of each coin's history, one bar per chunk shape.
- too little either way and would sit out. Above each bar,
- : train, test, held.
- : train, test, held, reserve.
- Nothing here refuses a coin.
- The sit-out band is one number for every coin, read on each coin's own scale.
- of that coin's median window move for the shape: at 50, a decision sits out when it moved less than half what
- the coin typically moves over that window. Change it and every bar recolours; nothing is read again and nothing
- else on the box changes. Sweep has its own band % (or auto); Walk it forward has sit-out bands to try.
- sit-out band, % of the median window move
- each shape at its own best sit-out band
- walk set(s) are not listed below because their promotions have not been read:
- Nothing has been lost &mdash; the rows are in the set and the
- promotions are still recorded. Restart the service and it moves them; if this line comes back after a restart, the service log says why.
- ticked. Sweep runs the ticked rows when
- and nothing else does. A row that passed a reading carries a coin, a chunk shape and its own sweet spot band; a row promoted off a
- walk carries a look-back as well.
- Each promoted row belongs to the walk set it came from &mdash;
- delete that set and its rows here go with it
- Every coin and shape, priced one window at a time from the start of its history to the end.
- At the start of each window the coin's usual move and which way it leans are worked out from everything
- behind that window and then held still while the window is priced
- , so no number here knew anything it
- could not have known at the time. Read the windows across: steady is a property of the coin, off-then-on is a
- phase, up and down is noise.
- Nothing here trades, refuses or chooses.
- . Getting in and out costs
- counts only the windows that cleared it.
- No exchange on Setup&#39;s Account tab is ticked as the system default yet, so the built-in figure is standing in. Enter what your venue actually charges and tick it.
- history before the first window, months
- puts the three boxes above into the list below, one step beyond each end.
- look-backs, hours (blank = each shape&#39;s own)
- The box is empty, so the walk reads each chunk shape&rsquo;s own span and nothing else.
- of the ones in the box are not among them:
- The walk works those out from the candles when it starts and keeps them, so it is a slower start once and never again.
- row(s) of this walk are hidden by the filter boxes above.
- Nothing is wrong with the walk &mdash; the table is there. Empty a box to widen it, or clear them all:
- row(s) hidden by the filter boxes above
- The headings stay put while the rows scroll under them, and every one of them sorts the whole walk, not this page.
- A row ticked on one page stays ticked when you move to another.
- row(s) are shown &mdash; these two reach all of them, not just this page.
- Narrow the boxes above first, then tick, then untick the few you do not want.
- ticked · they will appear at the top under
- row(s) promoted — they are in the list at the top
- row(s) promoted \u2014 they are in the list at the top, and the table above is showing them
- — the check with the link cut found a plateau at least this strong in at most
- deals.
- coin and shape reading(s) are not listed here because they were swept over different sit-out bands.
- A plateau found over one set of bands, graded against deals checked over another, is two measurements read as one &mdash; so they are left out rather
- than counted. Press
- to take the check again on the bands in
- - selections may feed units into STAGE 1 and 2 and if so feed STAGE 3 CONFIRMATION AWARENESS
- promoted - selections may feed units into STAGE 1 and 2 ADDITIONAL MEMBER TRAINING
- row(s) &mdash; the walk set is not deleted
- no band beats chance for three steps together
- At a fixed look-back a chunk shape is only how long the trade is held.
- A look-back in hours decides what is looked at, so what is left of a shape is when the trade opens
- and closes &mdash; and two shapes that hold for the same time are the same trade a day apart. So one
- . Every shape is still walked at its
- where the readings really do differ. This is why the table is smaller than it was.
- the last walk finished but could not be written down:
- &mdash; the table above is still good, and it goes when the service restarts.
- . It is not a set until it is finished.
- only the rows Choose early, read late is showing
- Each coin and shape's windows are cut in two. Its best row is picked on the
- windows alone, and what that one row did on the
- choosing never saw &mdash; is what is reported. The test is whether the pick beats what taking a row
- at random from the same coin and shape would have paid on those same late windows.
- Written down before the numbers: a pass needs the picks ahead on at least 60 of 90, and the
- round trip.
- windows to choose on (blank = half)
- leave out the chunk shape's own span
- coin-and-shape pair(s) had enough trades in both halves
- &middot; the pick beat picking at random on
- &middot; the average pick landed at the
- percentile of its own rows on the late windows (50 is no skill)
- pick(s) chose a look-back of 240 hours or more
- What to tune with is the whole history, not this reading.
- right carry the look-back and band that the
- swath chooses for each coin and shape, which is
- what a unit that has passed above should actually be set to &mdash; the early/late columns spend half the
- history to answer whether the choosing is worth anything at all, and that is all they are for.
- The whole history chose the same look-back and band as the early windows on
- &mdash; higher than the late figure because it is the best of everything, chosen with everything in view.
- row(s) of this reading are hidden by the filter boxes above.
- Nothing is wrong with the reading &mdash; the table is there. Empty a box to widen it, or clear them all:
- window(s) or thereabouts &mdash; a coin with fewer windows is cut in its own half.
- Every heading sorts: click to add it, again to flip it, once more to drop it.
- carry a look-back in hours and add a member to their unit
- · with the link cut, one at least this strong in

## Every word, flat (541)

```
-hour above Above above. Account across acted actually add ADDITIONAL after again again. against ahead all All alone also among and another another. answer anything apart. appear Apply are as at At auto auto-apply average AWARENESS away back band bands bands. bar bars be beat beats because been before behind belongs below Below below. best beyond black blank blind both box boxes built-in but by cached call called came Candidates candles cannot carries carry Carry chance Change changes changes. charges check checked Choose choose chooses chooses. choosing chose chosen chunk clear Clear cleared click closes coin coin-and-shape coin. coins Coins colour coloured colours columns comes CONFIRMATION copies cost costs could counted. counts cut day deals deals. decides decision decisions default delete Delete deleted did differ. different disk do does. down downloaded draw drop each Each early early/late edge either else else. empty Empty end. enough Enter entire every Every Everything everything exactly exam exchange fading falling feed fell few fewer fewest figure file files filter filters finish finished finished. first fixed flip for for. forward found four from gap Getting go goes good graded green had half half. halves has have heading headings held held. hellip here hidden higher highest history hold holds hours How how if in in. into is it It it. its Its itself judged just keeps kept knew known landed last late lead leans learned least leave left less line link list listed little log long LOOK look-back look-backs looked lost lowest may mdash mean measurements median MEMBER member middot mixed money month months more most move moved moves much must name named Narrow needs neither never Next No no noise. not Nothing nothing number numbers of off off-then-on often on once one One ONE ones only ONLY. Open opening opens or out out. over own page page. paid pair part pass passed pay per percentile phase pick picked picking picks picture plateau points pooled press Press Prev price priced Promote promoted promotions property put puts random rather ratio reach reaches Read read read. reading reading. readings reads really recolours record recorded. records red refuses release Remove removes Rename reported. reserve. Restart restart restarts. reverting right rising rose round row rows rsquo run runs same Save saw says scale. scrambled scrambles screen screens scroll sealed searched section selections service set sets setting settings Setup shape shape. shapes share should showing shown side signal since sit sit-out sits skill slides slower smaller so So sort sorts span spend spot spread STAGE standing stands start starts stay stays steady step steps still Stop stopped strong swath sweep Sweep Sweep. sweet swept system tab table Take take taken takes taking test th than that the The their them then there there. thereabouts these they thin this This those three Throw tick Tick ticked ticked. time time. to together too top trade trades trailing train TRAINING traits trending tried trip trip. try try. tune two two. typically u00b7 u2014 under unit units Untick untick until untouched up usual UTC venue view. Walk walk walked want. was was. way well. were what What when where whether which while whole why why. widen will win window window. windows windows. with worked works worst worth would writes written Written wrong yes yet you your
```

---

# Sweep

## What the controls are called (105)

- `— each says why:`
- `— none —`
- `— none — no finished stage`
- `— the box holds`
- `, and`
- `” — record sets & greenlights`
- `” will permanently remove:`
- `(confirm reads a lean on`
- `24/5`
- `all loaded data`
- `are already priced and are kept`
- `arm`
- `band % (or auto)`
- `both kinds`
- `Campaign — the parent chain name`
- `Campaign “`
- `carry forward (0 = all)`
- `chunk shape`
- `compare coins (blank = all`
- `confirm`
- `Confirmation`
- `confirmed ×`
- `Currently set:`
- `d`
- `decision`
- `declared,`
- `declared:`
- `Delete campaign…`
- `Delete record set…`
- `deleted`
- `Deleting “`
- `description`
- `doubles`
- `downloaded)`
- `end`
- `entry`
- `every coin here is judged by`
- `existing campaigns`
- `fee % each way`
- `from stage 1 record set`
- `from stage 2 record set`
- `gate`
- `greenlight(s),`
- `greenlights:`
- `hold`
- `ignore what is on Coins`
- `is going:`
- `lands`
- `lands about`
- `leave the extra members out`
- `Load training setup`
- `members`
- `name`
- `no estimate until the first`
- `no runs yet`
- `null set money kept`
- `null set size`
- `of`
- `of the`
- `on this box —`
- `one voice at`
- `or a new name`
- `permute`
- `plateau share`
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
- `split for extra members`
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
- `the coins here are judged by`
- `the count is not known right now —`
- `the most one trade may count for`
- `to`
- `trade coins (blank = all`
- `trail`
- `triples`
- `unconfirmed ×`
- `units`
- `units priced`
- `UTC`
- `View tree`
- `was run with`
- `what is ticked from a walk set`
- `window layout`

## What the dropdowns offer (60)

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
- `50/50`
- `50%`
- `60/40`
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
- `all of them`
- `argmax`
- `breakout`
- `confirmed only`
- `conviction`
- `count`
- `Daily 1-day`
- `Daily 2-day`
- `Daily 3-day`
- `Daily 4-day`
- `directional`
- `families`
- `its own history`
- `market`
- `N records`
- `off`
- `Selected records`
- `sized`
- `static`
- `the chunk's own`
- `trained`
- `voices`
- `Weekly 8-day`

## Sentences the page prints (46)

- Each stage writes a record set the next one reads, and every set names its parent. What is
- running, and everything finished, is on Boards.
- Stage 1 — train the LOGREG members once, keep every vote, rank against the null set
- every member is a LOGREG forecast — 4 per coin on its own, 5 alongside others — trained with the plain
- argmax fit. No trade shape and no decision exist here; those are priced later, at stage 3, from the votes this stage keeps.
- The fee prices only the tuning-slice $ on Boards: each unit's own votes on the last quarter of its training window,
- one buy or sell per chunk in the direction they lean, read against the same null set.
- where this run takes its units from
- what is ticked under coins and shapes that pass
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
- — the boxes below decide when enough of a coin's members agree to act.
- — on a unit whose coin and chunk shape are ticked on Coins, every call the members make is checked against the way that coin itself has moved after a rising window and after a falling window, at its own sweet spot band. These boxes decide what that check changes. The reading is taken from the SAME list this record set took its units from — the one named under where this run takes its units from when its stage 1 was started — and never from the other one. Greyed when no unit being priced has one, and the line below says why.
- units. Progress above; the set lands on Boards.
- carried units.
- — it is gone from the box above.
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
- — the stage starts wake when it lands
- priced the same trade and were folded into one)
- the filters saved on the parent's table leave
- units; on the rest its values are one setting)
- of them hold fewer than the block: a setting that places the same orders on a unit as another is priced there once)
- , and the number differs from unit to unit
- . The boxes below decide when enough of them agree to act,

## Every word, flat (400)

```
1-day 113h 137h 161h 17h 2-day 3-day 4-day 41h 60h 65h 8-day 89h about above above. act act. active add after again against agree all alongside already and another any are argmax arm as at attaches auto band band. bar be because been being belonging below beside best biggest blank block Boards Boards. BOOST both box boxes breakout but buy by call came Campaign campaign campaigns cannot carried carries carry chain changes. check checked chunk coin coins Coins committee compare confirm Confirmation confirmed conviction count cover crumbs Currently cut daily Daily data day decide decision declared Delete deleted deleted. Deleting deployed. description different differs direction directional doubles downloaded Each each end ends enough entry estimate every Every everything exam exist existing extra falling families fee fees fewer files filters finished first fit. folded for forecast forward freak from gate go going gone good greenlight greenlights Greyed has here history hold holds how ignore in into is it it. its itself judged keep keeps. kept kind kinds known lands landslide last later launched layout lean learning. leave lesson limit line list live Load loaded locked LOGREG make many market may member members minted models money more. most moved name named names never new next nine No no none not nothing now null number of Off off off. on On once one One one. ones. only or orders ordinary other others out own parent parent. pass passes paused per permanently permute places plain plateau price priced prices prices. Progress progress quarter Quorum quorum rank read reading reads record records refuse remove removed Removed rest Retire retrained reused right rising rounds run running runs same SAME saved says scans sealed second Selected sell set Set set. sets sets. setting settings setup setups. shape shapes share side side. single singles size sized small so split spot stage Stage stages start Start started starts static stayed staying still Sweep sweeps sweet tab table taken takes taking teaches than that the The their them them. there These they this This those three ticked times to too took trade Trade trades trail train trained training trains travels tree triples tuning tuning-slice turns unconfirmed under undone. unit units units. until up UTC values View voice voices vote votes voting wake walk was wastes way way. week weekly Weekly weigh weightless were What what when where while whole whose why why. will window with working worth writes wrong yet
```

---

# Boards

## What the controls are called (173)

- `— nothing came out of`
- `— pick a stage`
- `(centre)`
- `(no unit carried a lean)`
- `/\u00d7`
- `\u00b7`
- `\u00b7 at size 1`
- `\u00d7`
- `+both`
- `+hold`
- `+plateau`
- `× usual)`
- `1v`
- `24/5`
- `alongside`
- `any`
- `Apply settings`
- `arm`
- `around`
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
- `bands`
- `beat its own null set`
- `beat the kept null money`
- `before BOOST)`
- `biggest before the ceiling`
- `BOOST`
- `call`
- `called at half`
- `campaign:`
- `centre's forecast score`
- `Check this set`
- `chunk shape`
- `Clear filters`
- `Clear picks`
- `Close`
- `coin`
- `coin + chunk shape + alongside`
- `coins`
- `coins in the money`
- `comparisons`
- `confirm`
- `Copy settings into the form`
- `could not read this row's records`
- `d`
- `Data fingerprint:`
- `Date ranges:`
- `decision`
- `decision moment(s) dropped`
- `decisions`
- `declared,`
- `Delete record set…`
- `dropping the settings failed:`
- `dropping the settings:`
- `entry`
- `every number to the right of`
- `Fill in the kept null money`
- `Fill in the missing settings`
- `Filling in the kept null money`
- `forecast score`
- `forecast score — all members`
- `forecast score — stage 1 members`
- `from`
- `fuller board helped?`
- `gate`
- `h`
- `h at band`
- `held`
- `held-back $`
- `held-back stops`
- `held-back trades`
- `held-back verdict`
- `held,`
- `independent voices`
- `is`
- `is going:`
- `It cannot be done on this set:`
- `it holds and the block does not,`
- `kind`
- `lead over null set`
- `lean forecast score`
- `LOGREG +`
- `look-back`
- `look-backs`
- `maximum`
- `median`
- `member`
- `member(s)`
- `members`
- `Members of this unit —`
- `minimum`
- `missing`
- `name`
- `Next`
- `none`
- `nothing cleared the floors`
- `nothing here`
- `null set money kept`
- `of`
- `of one mind`
- `of the`
- `order`
- `own`
- `parts`
- `picked on this record set`
- `plateau`
- `Prev`
- `Pricing them is`
- `pricings over`
- `pulled apart`
- `Put the missing units back`
- `quorum by`
- `read on`
- `reads`
- `record set`
- `records`
- `records,`
- `Rename`
- `Revert filters`
- `right when called`
- `right when it spoke`
- `row(s)`
- `rows`
- `rows · page`
- `rung it landed on`
- `Save notes`
- `settings,`
- `share that agreed`
- `show the held-back window`
- `silent`
- `Size:`
- `spoke`
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
- `trained`
- `trained on`
- `tuning-slice $`
- `tuning-slice $ — all members`
- `tuning-slice $ — stage 1 members`
- `Undo the unfinished run`
- `undoing the unfinished run failed:`
- `undoing the unfinished run:`
- `units`
- `verdict`
- `vs always-long`
- `What this run actually is`
- `yet —`

## What the dropdowns offer (17)

- `active`
- `adds nothing`
- `adds value`
- `all of them`
- `argmax`
- `better signal`
- `breakout`
- `conviction`
- `count`
- `directional`
- `does not apply`
- `families`
- `its own history`
- `just leverage`
- `market`
- `trained`
- `voices`

## Sentences the page prints (89)

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
- the sort saved on this set reads the held-back window (
- ); it is set aside while the window is hidden, and the table reads in its own order
- Table 3.B was sorting by
- , a held-back column; while the window is hidden it reads by beat the kept null money
- Table 3.A: Settings, ranked
- — one row per permuted Sweep Stage 3 setting, averaged over its coin/chunk-shape combinations promoted from Stage 2
- show in 3.B
- Show in 3.B
- share that agreed is empty on this set —
- Ordered by the sort picked on the columns — one column at a time, saved on this record set. With
- nothing picked, or with the held-back window hidden and a held-back sort saved: beat the kept null money, best first. Independent voices below members means the committees held
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
- made before the split for extra members existed
- : its extra members trained on the training window alone, as the window layout cut it
- because they could not reach back far enough for a member's look-back
- This record set carries no reading for each member on its own, so those columns below are blank. They are blank because nothing was stored, not because the members said nothing. Run the stage again and they are there.
- A member added from a walk set is marked with a line down its left edge. Its band is a GATE, not a different question:
- on the decisions where the move over its own look-back clears the bar it is asked the unit's own question — which way will this chunk go —
- and on every other decision it sits out and is never asked. It is trained on the decisions it may answer and on no others, and the gate is
- APPLIED rather than learned, so it speaks at the same share of decisions the walk acted on. That share is the thing to hold against
- on the walk's own table. It trains on the first share of the whole history — the split for extra members on Sweep — and
- is read on the rest of it, not on the test window alone; it still votes in the committee on the
- test and held-back windows like every other member, and those lie inside that rest. Its forecast score is read on the decisions its gate
- opened, because a sit out it was handed is not a forecast it made;
- beside it is over every decision it was read on, because
- how often it acts out of all of them is the rate.
- The plateaus, read on the test window

## Every word, flat (531)

```
1v 3.A 3.B above above. accordingly. acted active acts actually added adding adds after afterwards. again again. against agreed all alone alone. alongside already always-long an and another answer any apart appear APPLIED Apply apply are argmax arm around arrow as aside asked asked. asking asks at auto-apply average averaged averages avg away away. back back. background band BAND bands bar be beat because before behind. belong below beside best better biggest blank blank. block board Boards BOOST both bought box breakout bring broken building but by call called came campaign can cannot carried carries carry ceiling centre changes Check check child chunk Clear cleared clears Close coin coin/chunk-shape coins column columns combinations comes committee committees comparable compared comparisons confirm conviction Copy copy cost could count cover cut Data Date decision DECISION decisions declare declare. declared declares declares. Delete deletes did died different directional disk DOES does done down Drop dropped dropping Dropping each Each edge. either else empty end enough entry every Every exactly exist existed exists extra factored FACTORED failed FAILED families far few fewer fewer. Fill filled Filling filling fills filter filter. filters fingerprint finished finishes first first. fit fixed floors for forecast form forward four from fuller gate GATE go goes going half handed held held-back helped here here. hidden history hold holds how if in independent Independent inside into is it It it. its Its ITS just keep kept kind landed lands. last layout lead lean learned leaves left leverage lie like line list LOGREG look-back look-backs looks. made marked market MATCH maximum may means median member members Members mind minimum missing moment money move name names near-copies never Next no none NOT not not. notes nothing nothing. now null number numbers of of. offers often old on on. once once. One one ones only opened opinions or order Ordered ordinary other others out OUT over OWN own page parent parents parts past per permuted pick picked picking picks place PLAN. plateau plateaus pooled press Prev price priced prices Pricing pricing. pricings promoted proved provenance provided pulled put Put puts quarter question quorum ran ranges ranked rate. rather reach read reading reads real record records records. Rename renumbers replaced rest rest. restart. resting rests Revert right row rows rule. run Run rung running said same Save saved saw says score screen second seconds seconds. section sections Selected selections service set SET set-up set. sets setting SETTING settings Settings settings. shape share short SHORT show Show showed showing shows. signal silent sit sits Size size smaller so some sort sorting sound. speaks split spoke stage Stage STAMP started still Stop stopped stopping stops stored sub-rows suggests. swapped Sweep table Table table. tables takes test Test-window than that That the The their them them. then there. these They they thing THIS this This those tick ties time to top totalled totalling touched touched. trade trades trail trained training trains tried tuning-slice u00b7 u00d7 Undo undoing Undoing unfinished unit unit. units units. usual value variants verdict visible voices votes vs walk was way way. ways were. what What when where whether which while whole why will window windows with With without worked would writes written wrote yet you your
```

---

# Funnel

## What the controls are called (248)

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
- `fewest test trades`
- `Final Rule:`
- `first → second`
- `first dial`
- `for the list, or tick`
- `Funnel`
- `Funnel -`
- `Greenlight`
- `gross per trade $`
- `Held`
- `History`
- `hold`
- `hours`
- `hours, so up to`
- `how many to keep`
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
- `or`
- `or change`
- `order by`
- `order must agree by at least`
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
- `Reserve`
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
- `show the held-back window`
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
- `vs always long $`
- `Walk this one`
- `weeks, or`
- `What`
- `What each floor would keep:`
- `What this rule had to beat:`
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

## What the dropdowns offer (21)

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
- `confirm`
- `decision`
- `dMult`
- `entry`
- `gate`
- `plateauPct`
- `take the top N by a column (this is shopping)`
- `tHours`
- `tighten the ranges toward the middle`
- `trailMult`
- `weekdaysOnly`

## Sentences the page prints (252)

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
- Nothing is open. Press
- on a row above to start a walk on that coin and shape,
- to walk another. A
- opens from the box beside them.
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
- the sort saved on this set reads the held-back window (
- ); it is set aside while the window is hidden, and the table reads in its own order
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
- : no survivor carries this number yet.
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

## Every word, flat (822)

```
...then about above above. Accept accept accepted across across. Add after again again. against agree agreeBar agreeBoth agreeCopy agreePct agreePersist agreeRule all All all. allowed allows alone alongside already also always an An and And another another. answer any anything anyway. apart applied are ARE area armMult around as aside asks at At auto-plateau average averaged averages avg avoid back back. backwards. bandMode bar bar. be beat beaten beats beats. because been before behind being below below. beside besides best best-looking best-scoring better between bigger biggest blended block block. board board. Boards boards bold Bold both BOTH Both box boxes boxes. brackets broke build built built. but button button. by came can cannot cannot. carries carry cent chance change changes changes. Changing check check. checked checked. choice choices Choose choosing chose chosen chunk chunks claim clear cleared cleared. clears click coin coin-and-shape coins column columns come coming compare. compared. comparing comparison confirm considered. CONTAINS copies copy corner costs could could. count counted counts covers covers... crosses cut cut-off. daily data date days days. dealt decided. decides decision deeper deepest Delete deleted depth dial dials did differ different direction disagree dMult do do. does dollar dollars Dollars done. down down. draw. drawn draws drift dropped. each Each edges effect Either else else. empty ended entry even evenly ever Every every everything exactly except exists failed far far. feeding few fewer fewest figure figures final Final find finding finish first fixed flat flat. flatter flattering floor fluke follows footing. for for. forecast forecast. forecasts forward four from Funnel funnel further. gap gate gets gives go goes. Going going gone good. got graded green Greenlight greyed grid gross Grouping groups guessing had half halves happened happens has have heading heaviest held Held held-back Held-back here here. hidden hides hill history History hold holding holds. hours how How however hundred. hunting if in in. inside instead intact into is isolated it It it. its itself join judging. jumbled just keep Keep keeping keeps kept kept. kind know known known. knows large largest last lead leads least leaves left lengths less lets lifts like like. limit limits line lines list Load long longer longest look look. looks losing loss lost LOST low made makes makes. making managed many mark marked match matter may means measurable measured menu message middle Minutes missing money money. more most moved movement moves moves. moving much must my name name. named narrow Narrow narrow. narrowing needed needs neighbouring neighbours never new newest next Next next. no No none not Not NOT Nothing nothing nothing. now null number numbers numbers. of off offered offers often on On on. once once. one One one-setting one. ones only Only onto onward Open open open. opened opens opposite or Or order Order order. ordering other other. others otherwise out out. outlined over own own... page pair pairs papered papers parent parent. part part. partly parts Passed pays peak peak. pennies. per pick picker picking plateauPct point point. position positive positive. Press press pressed pressed. presses pressing Prev price prices pulls put puts ramp range RANGE ranges ranked ranking ranks rarely-trading rather Re-applying reach reached reached. read Read read. reading Reading readings reads real real. really reason Recommended recommended record record. recorded records records. Recovered rectangle refused refused. region relation relationship. Remove Rename renamed repeated replaced replaces replacing Reserve rest rests result rigged. row row. rows rows. rule Rule rule. ruled rules run running running. runs said same SAME sat saved say says scale score scored scores scrambled screen screen. scroll sealed second second. seconds section section. seen separate separates set Set set. setting settings settings. settle shape shapes shopping shopping. show shown shows shuffle shuffled sight simpler single single-dial sit sixteen size sizes skill slices small smallest sneak so some something sort span spent spike split Split-half spread square squares STABLE stage Stage stake. stakes start Start started starts starts. Step step steps still stop stopped stopping stored streak stretch such survive survive. survives survives. survivor survivors sweep sweep. swept swing table tables take takes Taking taking target tell tells test tests than that That the The their them them. themselves then There there These these they They thin Thin thin. thing things third This this those Those though tHours three Three tick tied tighten time times to To today together together. top total Totals touched touches toward towards trade trade. traded trades trailMult try Tune turns Two two two. under unit unit. units unless unread until up use User value values varies vary vs waits walk Walk walked walking walks warning warnings was way weak weaker wearing week weekdaysOnly weeks well went were what What whatever when whenever where whether which which. whichever while whole whose wide wider WIDER widest will window with With without won words work Work worked works. worst Worth worth would would. write Write writes written Written wrong wrote year year. yearly yet yet. you you. your Your yours yourself zero
```

---

# History

## What the controls are called (31)

- `: retrains on its`
- `· built from this table:`
- `% is not read here`
- `%, judged on the`
- `%); the held-back`
- `12 months`
- `18 months`
- `24 months`
- `30 months`
- `36 months`
- `48 months`
- `average $`
- `half-lives`
- `judged on the`
- `members, both kinds`
- `name`
- `of`
- `records improved with a half-life`
- `records)`
- `refused`
- `refused:`
- `Retrain at the ticked half-lives`
- `rows won`
- `run`
- `setting`
- `Stage 4 record set`
- `survivors`
- `taken`
- `under release`
- `window (`
- `window layout`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (15)

- Retrain with recent history weighted
- The same records, retrained: every setting of the chosen set is kept exactly as it is, and only the
- forecasts behind it are trained again with recent history weighted more, once per half-life ticked, keeping every other
- training choice the set was made with. Then the same records are priced again on the Test window, the stretch the
- retraining never touched, in one pass beside the set's own unweighted figures. A set built 61/13/13/13 (sealed exam)
- retrains on its 61% and is judged on its 13% test window, with its held-back 13% not read and its last 13% sealed; a set
- built 70/15/15 retrains on its 70% and is judged on its 15% test window, with its held-back 15% not read. Nothing on this
- screen reads the held-back window: it stays secret until Held, or until a scan on Tune is told to read it. Every press
- appends a table; none is overwritten.
- No half-life run on this set yet.
- no Stage 4 record set on this box yet
- whole chunks · retrained on the set's own
- survivor(s) are not in the stage 3 set's block on this unit
- records, in the set's own order. Green is the best of the row: a half-life wins only by at least a cent over the unweighted column; a tie goes to the unweighted side.
- Build the half-life set from this table

## Every word, flat (134)

```
again and appends are as at average behind beside best block both box Build built by cent choice chosen chunks column every Every exactly exam figures. forecasts from goes Green half-life half-lives Held held-back here history improved in is it it. its judged keeping kept kinds last layout least made members months more name never No no none not Nothing of on once one only or order. other over overwritten. own pass per press priced read read. reads recent record records refused release Retrain retrained retraining retrains row rows run same scan screen sealed secret set setting side. Stage stage stays stretch survivor survivors table taken Test test The the Then this ticked tie to told touched trained training Tune under unit until unweighted was weighted whole window wins with with. won yet yet.
```

---

# Tune

## What the controls are called (96)

- `- by conviction -`
- `, each a counted look`
- `, on its`
- `, one clip ($`
- `, p=`
- `; peak concurrent`
- `; worst trade`
- `: tightest no-winner-lost stop`
- `· by depth among the captured:`
- `· held-back`
- `· test`
- `(flat`
- `(worst distance`
- `A heavy scan is running (`
- `all`
- `all survivors -`
- `amount traded $`
- `Apply custom`
- `Apply the conviction sizing`
- `at the $`
- `by conviction`
- `by depth -`
- `Capture the trades of this set`
- `captured -`
- `captured survivors`
- `Chance check:`
- `drawdown`
- `entries`
- `entries · money with no stop`
- `entries on the`
- `Exposure:`
- `flat`
- `h`
- `held-back`
- `held-back entries`
- `ladder`
- `ladder over flat`
- `last scan failed:`
- `last sweep failed:`
- `look`
- `losers over`
- `money $`
- `no`
- `no reserve entries:`
- `No stop (clear)`
- `of`
- `of the Stage 4 record set`
- `on record for`
- `or apply a custom stop %`
- `over`
- `per-$`
- `Read from the capture:`
- `refused:`
- `reserve`
- `return on the amount traded`
- `Run conviction sweep`
- `running…`
- `Save the reason`
- `scan`
- `scan target`
- `scans run on this capture:`
- `shuffled deals, mean uplift`
- `sizing`
- `sizing on record for`
- `Stage 4 record set`
- `survivor`
- `survivor(s) not captured:`
- `survivors`
- `survivors captured`
- `Take the sizing off`
- `taken`
- `Target:`
- `test`
- `test entries,`
- `the capture on record`
- `the reserve entries have been read`
- `the scans, newest first`
- `the survivor`
- `time(s)`
- `training`
- `training entries,`
- `Tune protective stop`
- `Tuning targets`
- `under release`
- `uplift`
- `Verdict:`
- `when`
- `window(s), captured`
- `windows`
- `windows the scans read`
- `winners /`
- `x`
- `yet`
- `your choice`
- `your reason for the sizing`
- `your reason for this choice`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (34)

- ) — one at a time; both launchers are disabled until it lands (scans run minutes and cannot be aborted mid-flight).
- What the two scans below read: a Stage 4 record set whose trades are captured above, one survivor of it
- or all of them, over the windows ticked. Choosing here reads nothing; each scan says what it will read before it runs.
- Stage 4 record set(s) with their trades captured
- Protective stop tuner — on the captured trades, loses no winner
- Reads the captured trades of one survivor of a Stage 4 record set over the windows ticked and finds the
- tightest fixed stop that would not have clipped a single winner, plus the sacrifice curve (give up top winners →
- tighter stop → NET $). A stop you force onto the survivor yourself, or clear from it, is recorded on that survivor
- and scanned the same way, as one row of the same table. Nothing here is applied to any trading machine. Target:
- no choice about the stop has been recorded for
- , the record's own dollars) a member that agreed
- Conviction sizing — bet more when more members agree?
- Prices the DECLARED clip ladder (multiplier = winning-side vote count) as a pure $ overlay on the
- same captured trades, against a shuffled-assignment chance check and exposure-honest metrics.
- clip.
- NET = winner $ given up + loss-side $ vs no stop; positive means the stop helps. The green row, when there
- is one, is the stop on record for this survivor; a no-stop choice is the baseline and changes nothing. Nothing on this
- table is applied anywhere.
- priced entries.
- ; the same p holds for the return on the amount traded, because a shuffle keeps the ladder's amount traded.
- Per-trade capture of a Stage 4 record set
- The two scans below take a list of trades and price them themselves; a Stage 4 record set holds money per
- window and never the trades. This writes them down: for every survivor that enters at market with no trailing stop,
- every hour the rule spoke on the training, test and held-back windows, with the side, how many members called that
- side, and the money the simulator made on that one trade. Tune comes before Held and asks nothing of it.
- Once captured, the set appears in the scan target box below, and a scan that reads the held-back entries is a
- counted look at the held-back window.
- the held-back entries have been read
- No capture on this set yet. The scans below cannot be aimed at it until there is one.
- reading the held-back entries is look
- this read of the held-back entries was look
- · nothing is applied from a Stage 4 record set
- no Stage 4 record set on this box yet
- survivor(s) are not in the stage 3 set's block on this unit

## Every word, flat (262)

```
aborted about above against agree agreed aimed all among amount and any anywhere. appears applied apply Apply are as asks at baseline be because been before below bet block both box by called cannot capture Capture captured chance Chance changes check choice Choosing clear clip clip. clipped comes concurrent conviction Conviction count counted curve custom deals DECLARED depth disabled distance dollars down drawdown each enters entries entries. every Exposure exposure-honest failed finds first fixed flat for force from give given green has have heavy Held held-back helps. here holds hour how in is it it. its keeps ladder lands last launchers list look losers loses loss-side machine. made many market mean means member members metrics. mid-flight minutes money more multiplier NET never newest no No no-stop no-winner-lost not nothing Nothing nothing. of off on Once one one. onto or over overlay own peak per per- Per-trade plus positive price priced Prices Protective protective pure read Read reading reads Reads reason record recorded refused release reserve return row rule run Run running runs. sacrifice same Save says scan scanned scans set shuffle shuffled shuffled-assignment side simulator single sizing spoke Stage stage stop survivor survivors sweep table table. Take take taken target Target targets test that the The their them themselves there this This ticked ticked. tighter tightest time to top trade trade. traded traded. trades trades. trading trailing training Tune tuner Tuning two under unit until up uplift Verdict vote vs was way What what when whose will window window. windows winner winners winning-side with worst would writes yet yet. you your yourself
```

---

# Held

## What the controls are called (167)

- `- INCOMPLETE, never a pass`
- `, information only)`
- `, parent`
- `, reader`
- `, so this is never a gate`
- `, threshold`
- `· bar`
- `· check:`
- `· information only, never a gate`
- `· pricing`
- `· releases: set`
- `· rule keys`
- `· sealed window`
- `· window from`
- `(PASS, release`
- `(read`
- `(the first digits differ)`
- `); noise must lose at least`
- `a setting -`
- `all four at its own hold`
- `and beats`
- `as stored`
- `at least`
- `avg held-back $`
- `avg reserve $`
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
- `clips a trade`
- `comparison`
- `copies (`
- `copies allow is 1 in`
- `copies kept · median lead`
- `copies kept of`
- `copies, the bar being`
- `counted look at the`
- `deal(s) a setting,`
- `deals · fee`
- `earlier readings:`
- `earlier rides:`
- `FAILS`
- `fee`
- `Final Rule:`
- `Footing:`
- `from`
- `gone`
- `gross per trade $`
- `held set`
- `held-back $`
- `held-back $ a setting`
- `hindsight reading`
- `hold lengths in use`
- `how many`
- `include`
- `it made`
- `largest drawdown $`
- `lead`
- `made money ·`
- `mark(s) carried ·`
- `Marks the walk was carried past:`
- `median held-back $`
- `median reserve $`
- `money by third`
- `no figure`
- `no figure at`
- `no held set of this rule stands`
- `noise must lose at least %`
- `none`
- `not intact`
- `not known`
- `not priced`
- `not read on this block`
- `not readable`
- `now,`
- `null copies`
- `of`
- `of the rule, the rule and`
- `of the time; the finest claim`
- `of this unit`
- `of this unit ·`
- `on`
- `on the record,`
- `other units positive on the`
- `other units positive;`
- `over`
- `own`
- `own verdict`
- `positive`
- `Price the reserve board`
- `priced`
- `Priced`
- `read`
- `Read from:`
- `read here,`
- `Read what the rule dropped`
- `real`
- `refused:`
- `reserve $`
- `reserve $ a setting`
- `reserve set`
- `reserve window`
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
- `stands on`
- `Stands on:`
- `step(s) and`
- `step(s) back`
- `Stop after this unit`
- `stopped`
- `stopped out`
- `survivor(s) were not priced`
- `survivors`
- `survivors made`
- `test $`
- `test largest drawdown $`
- `the average is ahead`
- `the average is behind`
- `the bar`
- `the four comparisons are not known`
- `The held-back window priced:`
- `The other units:`
- `the reading on this set`
- `The reserve board of this unit`
- `The reserve window priced:`
- `The ride on the held-back window`
- `The ride on the reserve window`
- `The tunings applied on Tune:`
- `The verdict on the reserve window`
- `this read`
- `to`
- `trades`
- `trades a setting`
- `trades won`
- `tunings`
- `under release`
- `unit`
- `unit failure(s)`
- `unstamped`
- `User Rule:`
- `vs always long $`
- `What a pass buys:`
- `What the`
- `with the sizing $`
- `without them $`
- `Work out the held-back ride`
- `Work out the reserve ride`
- `worked out`
- `worst trade $`
- `would by chance ·`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (82)

- The verdict on the held-back window
- A rule can be checked against scrambled data and a single row cannot, so this reads the rule as a
- whole: what its survivors made on the
- , each against the four simpler things the Funnel prints
- at its own hold length, against the same settings' money on every scrambled copy, with a sanity line that noise must
- lose, and the marks the walk was carried past. Opening this panel reads no figure of that window; the press below
- is the stamped look, and every look is counted. Each press writes a
- its Tune choices frozen at that moment with its one verdict, and that set is what Greenlight reads.
- No reserve set read from this rule yet. The first press writes one; later presses write later ones, numbered, and never replace it.
- No held set read from this rule yet. The first press writes one; later presses write later ones, numbered, and never replace it.
- the rule does not give back its own survivors today
- Looks at the reserve window before any stamp:
- Looks at the held-back window before any stamp:
- reserve set(s) below, each a stamped look
- held set(s) below, each a stamped look
- Every setting of this coin and shape priced on the reserve window, with the members forecasting it from the
- models they were trained as: its money and trades, its scrambled copies, and the four comparisons at each hold length,
- kept beside the stage 3 set so a second rule cut on this unit reads the same board. Its first pricing is the one look at
- data nothing in this system has seen. The press above reads this board and prices nothing; so do the three readings below.
- whole chunks, the box's data reaching
- Not priced yet.
- The press below prices it; until then the read, the settings the rule dropped and the ride refuse on this tab.
- Price the reserve boards of the other units
- Read the rule on the reserve window
- Read the rule on the held-back window
- , which passed on the held-back window under release
- Read off the reserve board of this unit:
- whole chunks · the box's data reached
- ); comparisons gated: each survivor against all four at its own hold length, and the same
- % share of survivors must be in the money and ahead of all four (
- ); the best of the four at the worst hold length is printed as the hindsight reading it is.
- The rule on a noise board, reserve window:
- The rule on a noise board, held-back window:
- no scrambled copies were kept, so nothing was read against nothing
- · a forecast-free rule clears this about
- , a floor, never a measure of strength · lead
- Every survivor against its own copies:
- beat always long · head-to-heads won
- scrambled reserve figures lose money
- scrambled held-back figures lose money
- PASS — noise mostly loses, as fees demand.
- FAIL — NOISE IS PROFITING: the simulation is broken; do not read the tests above.
- On a window that pays one direction the copies are paid too, and this can fail honestly.
- - no scrambled figure to read, so nothing above it can be read against noise.
- - they are not in the stage 3 set's block on this unit
- this window only. It stops obvious chance results being frozen; the
- forward paper test after freezing is the real judge.
- The rule on the other units, reserve window
- The rule on the other units, held-back window
- The same rule on every other coin-and-shape unit of the stage 3 set this was cut from, each read on its
- against its own scrambled copies at the bar declared above. Two counts, information only,
- never a gate; a mark when fewer than half are positive. About five seconds a unit, read one at a time.
- Read the rule on the other units' reserve windows
- Read the rule on the other units' held-back windows
- not priced on the reserve window yet
- Not read on this rule yet.
- What the rule dropped, reserve window
- What the rule dropped, held-back window
- The settings the rule did NOT keep, read on the same
- as the survivors. A count of
- survivors that clear a bar cannot be read without it: if nearly every setting on the board was positive here, then
- all the survivors being positive says the window rose and says nothing about the picking. Each side is read
- against the four at its own hold lengths. Nothing is priced, every figure is already on the board, and this is a
- . Information only, never a gate.
- how many of the dropped to read (blank = all
- dropped settings were read, taken with an even stride through the board's own order.
- looked like from inside, per survivor: the largest drawdown, the worst
- and best single trade, trades won, stopped out, gross per trade and money by third, beside the same numbers
- on the test window. Worked out by the same pass as the missing numbers on the Funnel, on this unit only;
- minutes. Information only, never a gate, and every press is a stamped look at the
- survivors, in the set's own order. There is no sort on this table: a sort is a look.
- Not worked out on this rule yet.
- not known - one of the four has no figure
- survivors beating all four at their own hold length
- with no figure at their hold length, which never passes)
- stamped before this reading existed; the hindsight reading above was the gate then
- Information only, never a pass or fail.
- Line A, the rule on the test window against its own copies: real
- ). Line B, the bound on shopping: the best
- survivors carry a stop or a sizing ·
- survivors, every one of them, in the set's own order. There is no sort on this table: a sort is a look.
- survivor(s) the capture's plain re-pricing is off the reading by a cent or more (the largest gap

## Every word, flat (375)

```
about About above above. after against ahead all allow already always an and any applied are as at average avg back bar be beat beaten beating beats before behind being below below. beside best blank block board board. boards bound box broken buys by can cannot capture carried carry cent chance check checked choices chunks claim clear clears clips coin coin-and-shape comparison comparisons copies copy count counted counted. counts cut data deal deals declared demand. did differ digits direction do does drawdown dropped each Each earlier even every Every existed FAIL fail fail. FAILS failure fee fees fewer figure figures Final finest first five floor Footing forecast-free forecasting forward four freezing from frozen Funnel gap gate gate. gated give gone Greenlight gross half has head-to-heads held held-back here hindsight hold honestly. how if in include INCOMPLETE information Information inside intact is IS is. it It it. its Its judge. keep kept keys known largest later lead least length lengths lengths. like line Line long look look. looked Looks lose loses made many mark marks Marks measure median members minutes. missing models moment money more mostly must nearly never no No noise NOISE noise. none not Not NOT nothing Nothing now null numbered numbers obvious of off on On one ones only only. Opening or order. other out over own paid panel paper parent PASS pass passed passes past past. pays per picking. plain positive positive. press presses Price priced Priced prices pricing printed prints PROFITING re-pricing reached reaching read Read readable reader reading readings reads reads. real record refuse refused release releases replace reserve results ride rides rose row rule Rule Rules same sanity says scrambled sealed second seconds seen. set setting settings shape share shopping side simpler simulation single sizing so sort Stage stage stamp stamped stands Stands STANDS step Stop stop stopped stops stored strength stride survivor survivors survivors. system tab. table taken test tests than that The the their them then There they things third this three threshold through time time. to today too trade trades trained Tune tunings Two under unit units unstamped until use User verdict vs walk was were what What when which whole window window. windows with without won Work Worked worked worst would write writes yet yet.
```

---

# Reserve

## What the controls are called (167)

- `- INCOMPLETE, never a pass`
- `, information only)`
- `, parent`
- `, reader`
- `, so this is never a gate`
- `, threshold`
- `· bar`
- `· check:`
- `· information only, never a gate`
- `· pricing`
- `· releases: set`
- `· rule keys`
- `· sealed window`
- `· window from`
- `(PASS, release`
- `(read`
- `(the first digits differ)`
- `); noise must lose at least`
- `a setting -`
- `all four at its own hold`
- `and beats`
- `as stored`
- `at least`
- `avg held-back $`
- `avg reserve $`
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
- `clips a trade`
- `comparison`
- `copies (`
- `copies allow is 1 in`
- `copies kept · median lead`
- `copies kept of`
- `copies, the bar being`
- `counted look at the`
- `deal(s) a setting,`
- `deals · fee`
- `earlier readings:`
- `earlier rides:`
- `FAILS`
- `fee`
- `Final Rule:`
- `Footing:`
- `from`
- `gone`
- `gross per trade $`
- `held set`
- `held-back $`
- `held-back $ a setting`
- `hindsight reading`
- `hold lengths in use`
- `how many`
- `include`
- `it made`
- `largest drawdown $`
- `lead`
- `made money ·`
- `mark(s) carried ·`
- `Marks the walk was carried past:`
- `median held-back $`
- `median reserve $`
- `money by third`
- `no figure`
- `no figure at`
- `no held set of this rule stands`
- `noise must lose at least %`
- `none`
- `not intact`
- `not known`
- `not priced`
- `not read on this block`
- `not readable`
- `now,`
- `null copies`
- `of`
- `of the rule, the rule and`
- `of the time; the finest claim`
- `of this unit`
- `of this unit ·`
- `on`
- `on the record,`
- `other units positive on the`
- `other units positive;`
- `over`
- `own`
- `own verdict`
- `positive`
- `Price the reserve board`
- `priced`
- `Priced`
- `read`
- `Read from:`
- `read here,`
- `Read what the rule dropped`
- `real`
- `refused:`
- `reserve $`
- `reserve $ a setting`
- `reserve set`
- `reserve window`
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
- `stands on`
- `Stands on:`
- `step(s) and`
- `step(s) back`
- `Stop after this unit`
- `stopped`
- `stopped out`
- `survivor(s) were not priced`
- `survivors`
- `survivors made`
- `test $`
- `test largest drawdown $`
- `the average is ahead`
- `the average is behind`
- `the bar`
- `the four comparisons are not known`
- `The held-back window priced:`
- `The other units:`
- `the reading on this set`
- `The reserve board of this unit`
- `The reserve window priced:`
- `The ride on the held-back window`
- `The ride on the reserve window`
- `The tunings applied on Tune:`
- `The verdict on the reserve window`
- `this read`
- `to`
- `trades`
- `trades a setting`
- `trades won`
- `tunings`
- `under release`
- `unit`
- `unit failure(s)`
- `unstamped`
- `User Rule:`
- `vs always long $`
- `What a pass buys:`
- `What the`
- `with the sizing $`
- `without them $`
- `Work out the held-back ride`
- `Work out the reserve ride`
- `worked out`
- `worst trade $`
- `would by chance ·`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (82)

- The verdict on the held-back window
- A rule can be checked against scrambled data and a single row cannot, so this reads the rule as a
- whole: what its survivors made on the
- , each against the four simpler things the Funnel prints
- at its own hold length, against the same settings' money on every scrambled copy, with a sanity line that noise must
- lose, and the marks the walk was carried past. Opening this panel reads no figure of that window; the press below
- is the stamped look, and every look is counted. Each press writes a
- its Tune choices frozen at that moment with its one verdict, and that set is what Greenlight reads.
- No reserve set read from this rule yet. The first press writes one; later presses write later ones, numbered, and never replace it.
- No held set read from this rule yet. The first press writes one; later presses write later ones, numbered, and never replace it.
- the rule does not give back its own survivors today
- Looks at the reserve window before any stamp:
- Looks at the held-back window before any stamp:
- reserve set(s) below, each a stamped look
- held set(s) below, each a stamped look
- Every setting of this coin and shape priced on the reserve window, with the members forecasting it from the
- models they were trained as: its money and trades, its scrambled copies, and the four comparisons at each hold length,
- kept beside the stage 3 set so a second rule cut on this unit reads the same board. Its first pricing is the one look at
- data nothing in this system has seen. The press above reads this board and prices nothing; so do the three readings below.
- whole chunks, the box's data reaching
- Not priced yet.
- The press below prices it; until then the read, the settings the rule dropped and the ride refuse on this tab.
- Price the reserve boards of the other units
- Read the rule on the reserve window
- Read the rule on the held-back window
- , which passed on the held-back window under release
- Read off the reserve board of this unit:
- whole chunks · the box's data reached
- ); comparisons gated: each survivor against all four at its own hold length, and the same
- % share of survivors must be in the money and ahead of all four (
- ); the best of the four at the worst hold length is printed as the hindsight reading it is.
- The rule on a noise board, reserve window:
- The rule on a noise board, held-back window:
- no scrambled copies were kept, so nothing was read against nothing
- · a forecast-free rule clears this about
- , a floor, never a measure of strength · lead
- Every survivor against its own copies:
- beat always long · head-to-heads won
- scrambled reserve figures lose money
- scrambled held-back figures lose money
- PASS — noise mostly loses, as fees demand.
- FAIL — NOISE IS PROFITING: the simulation is broken; do not read the tests above.
- On a window that pays one direction the copies are paid too, and this can fail honestly.
- - no scrambled figure to read, so nothing above it can be read against noise.
- - they are not in the stage 3 set's block on this unit
- this window only. It stops obvious chance results being frozen; the
- forward paper test after freezing is the real judge.
- The rule on the other units, reserve window
- The rule on the other units, held-back window
- The same rule on every other coin-and-shape unit of the stage 3 set this was cut from, each read on its
- against its own scrambled copies at the bar declared above. Two counts, information only,
- never a gate; a mark when fewer than half are positive. About five seconds a unit, read one at a time.
- Read the rule on the other units' reserve windows
- Read the rule on the other units' held-back windows
- not priced on the reserve window yet
- Not read on this rule yet.
- What the rule dropped, reserve window
- What the rule dropped, held-back window
- The settings the rule did NOT keep, read on the same
- as the survivors. A count of
- survivors that clear a bar cannot be read without it: if nearly every setting on the board was positive here, then
- all the survivors being positive says the window rose and says nothing about the picking. Each side is read
- against the four at its own hold lengths. Nothing is priced, every figure is already on the board, and this is a
- . Information only, never a gate.
- how many of the dropped to read (blank = all
- dropped settings were read, taken with an even stride through the board's own order.
- looked like from inside, per survivor: the largest drawdown, the worst
- and best single trade, trades won, stopped out, gross per trade and money by third, beside the same numbers
- on the test window. Worked out by the same pass as the missing numbers on the Funnel, on this unit only;
- minutes. Information only, never a gate, and every press is a stamped look at the
- survivors, in the set's own order. There is no sort on this table: a sort is a look.
- Not worked out on this rule yet.
- not known - one of the four has no figure
- survivors beating all four at their own hold length
- with no figure at their hold length, which never passes)
- stamped before this reading existed; the hindsight reading above was the gate then
- Information only, never a pass or fail.
- Line A, the rule on the test window against its own copies: real
- ). Line B, the bound on shopping: the best
- survivors carry a stop or a sizing ·
- survivors, every one of them, in the set's own order. There is no sort on this table: a sort is a look.
- survivor(s) the capture's plain re-pricing is off the reading by a cent or more (the largest gap

## Every word, flat (375)

```
about About above above. after against ahead all allow already always an and any applied are as at average avg back bar be beat beaten beating beats before behind being below below. beside best blank block board board. boards bound box broken buys by can cannot capture carried carry cent chance check checked choices chunks claim clear clears clips coin coin-and-shape comparison comparisons copies copy count counted counted. counts cut data deal deals declared demand. did differ digits direction do does drawdown dropped each Each earlier even every Every existed FAIL fail fail. FAILS failure fee fees fewer figure figures Final finest first five floor Footing forecast-free forecasting forward four freezing from frozen Funnel gap gate gate. gated give gone Greenlight gross half has head-to-heads held held-back here hindsight hold honestly. how if in include INCOMPLETE information Information inside intact is IS is. it It it. its Its judge. keep kept keys known largest later lead least length lengths lengths. like line Line long look look. looked Looks lose loses made many mark marks Marks measure median members minutes. missing models moment money more mostly must nearly never no No noise NOISE noise. none not Not NOT nothing Nothing now null numbered numbers obvious of off on On one ones only only. Opening or order. other out over own paid panel paper parent PASS pass passed passes past past. pays per picking. plain positive positive. press presses Price priced Priced prices pricing printed prints PROFITING re-pricing reached reaching read Read readable reader reading readings reads reads. real record refuse refused release releases replace reserve results ride rides rose row rule Rule Rules same sanity says scrambled sealed second seconds seen. set setting settings shape share shopping side simpler simulation single sizing so sort Stage stage stamp stamped stands Stands STANDS step Stop stop stopped stops stored strength stride survivor survivors survivors. system tab. table taken test tests than that The the their them then There they things third this three threshold through time time. to today too trade trades trained Tune tunings Two under unit units unstamped until use User verdict vs walk was were what What when which whole window window. windows with without won Work Worked worked worst would write writes yet yet.
```

---

# Greenlight

## What the controls are called (42)

- `- distance`
- `· read from`
- `· verdict`
- `(worst distance`
- `$ a setting`
- `always long`
- `always short`
- `buy and hold`
- `by depth -`
- `clear all four`
- `clears all four`
- `does not stand`
- `Existing greenlights`
- `fee`
- `Greenlight a Stage 4 record set`
- `Greenlight this survivor`
- `greenlighted`
- `name`
- `no`
- `no figure)`
- `no tuning $`
- `none yet`
- `nuked`
- `one survivor`
- `One survivor,`
- `refused:`
- `short and hold`
- `Stage 4 record set`
- `stood (PASS, release`
- `stopped`
- `stretch`
- `survivors`
- `survivors ·`
- `survivors read`
- `The picture through every period`
- `the same lines for it alone`
- `Trade tab`
- `trades`
- `trades a setting`
- `tuned $`
- `tunings frozen on this set:`
- `yes`

## What the dropdowns offer (0)

_none_

## Sentences the page prints (19)

- Greenlight — the decision that a config is fit to trade
- Records WHO/WHEN/WHY with the exact frozen config, engine version, and the campaign's whole
- evidentiary chain. The config then appears on the Trade tab (both sides) for activation. Only greenlighted
- configs ever trade — no hand-built live configs, ever.
- is what the run behind each one was priced at, per trade and each way. It is not a
- setting here — it is what the evidence was found under, and a config sent to the Trade tab starts out priced
- at it and can be changed there. A dash means the run predates the fee being recorded.
- Activation, deactivation and nuking live on the
- The other way to write the decision down: from a reserve set that passed on Reserve, or from a held set that
- passed on Held on a layout that keeps no reserve, held alone. One of its
- survivors is taken forward, chosen by how surrounded it is inside the rule (the setting nearest the middle of every
- range, never the one with the most money) or named by you, and both are recorded. The frozen settings carry the
- way its members agree exactly as the survivor does. Nothing here trades, and nothing built from it can be put to
- work until the live path speaks that agreement.
- no held set or reserve set on this box yet - read a rule on Held first
- why — the decision record (required)
- The rule's money on each stretch of history, read off the sets this one is built on and the records they stand on:
- train off the capture on Tune, test off the stage 3 records, held off the held set, reserve off the reserve set. Nothing here
- is priced and nothing counts as a look. Each stretch is held against the four simpler things at the survivors' own hold lengths.

## Every word, flat (193)

```
Activation activation. against agree agreement. all alone alone. always and appears are as at be behind being both box built buy by campaign can capture carry chain. changed chosen clear clears config configs counts dash deactivation decision depth distance does does. down each Each engine ever ever. every evidence evidentiary exact exactly Existing fee figure first fit for forward found four from frozen Greenlight greenlighted greenlights hand-built held Held here history hold how inside is It it its keeps layout lengths. lines live long look. means members middle money most name named nearest never no none not Nothing nothing nuked nuking of off on one One Only or other out own PASS passed path per period picture predates priced put range read record recorded. Records records refused release required reserve Reserve rule run same sent set set. sets setting settings short sides simpler speaks Stage stage stand starts stood stopped stretch surrounded survivor survivors tab taken test that the The then there. they things this through to trade Trade trades train Tune tuned tuning tunings under until verdict version was way way. what WHO/WHEN/WHY whole why with work worst write yes yet you
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

