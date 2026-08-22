# The words on the Sweep tab

GENERATED - do not edit by hand. Rebuild with:

```
node tests/sweep-words.js --write
```

Owner order, 2026-08-21: **these are the only words that may be used to
talk about anything on this screen.** Not a style preference - a fabricated
label sends the owner hunting for a control that was never there, and it
makes every other statement suspect.

Taken out of `drawSweep()` in `public/construct.js` - the function that
draws the tab - and out of the choice lists the page fills its dropdowns
from. Tooltips are deliberately excluded: hover text is not a name.

## The tab

It is called **Sweep**. Read from `TABS` in `public/construct.js`.

## What the controls are called (41)

Anything the owner reads beside a box, a tick or a button.

- `— on this box —`
- `agree`
- `all loaded data`
- `arm`
- `band % (or auto)`
- `Campaign — the parent job (pt 13)`
- `Campaign “ ” — runs & greenlights`
- `chunk shape`
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
- `greenlights:`
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

## Sentences the page prints (19)

- Every run launched while a campaign is set attaches to it: sweeps, null rounds, tuning passes,
- scans. The campaign's whole chain travels with any greenlight minted from it.
- Board sweep — wide to FIND (never a result)
- universe (blank = all 17 default pairs)
- replication: also score one DECLARED config per asset
- description — why this run exists (rides in the job heading forever)
- ${(t.greenlights || []).length ? `
- “ ” is locked — nothing has been deleted.
- setup(s) on the Trade tab are still deployed. Retire them there first:
- ${found.blocking.map((b) =>
- `).join('')}
- Deleting “ ” will permanently remove:
- ${lines.length ? `
- nothing but the name — this campaign holds no runs, greenlights or setups.
- This cannot be undone.
- “ ” deleted.
- Removed run(s), greenlight(s), setup(s),
- and the saved models and tuning files belonging to them.
- declared configs, each scored on every asset — roughly x the replication work.

## Every word, flat (180)

For checking one word quickly.

```
.join .length 1-day 113h 137h 161h 17h 2-day 3-day 4-day 41h 65h 8-day 89h active agree all also always and any are argmax arm asset attaches auto band be been belonging blank Board boards box breakout but Campaign campaign campaigns cannot chain chunk config configs contexts Currently Daily data decision DECLARED declared default Delete deleted. Deleting deployed. description directional doubles each end entry ETA Every every evidence exam existing exists files FIND first forever found.blocking.map from gate greenlight greenlights has heading holds in is it it. job jobs launched layout legacy lines.length loaded locked market min minted models name never new no nothing null on one or pairs parent passes per permanently permute Phase plane promote pt Rate remove Removed replication result Retire rides roughly rounds run Running runs saved scans. score scored sealed set Set setup setups. shape singles start Start static still Stop sweep sweeps t.greenlights tab the The them them. there this This to top Trade trades trail trailing Trainings travels tree triples tuning undone. Units universe View Weekly while whole why wide will window with work.
```

