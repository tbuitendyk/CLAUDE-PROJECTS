# BUILD PLAN — the long loop of 2026-08-19

Granted by the owner with `LOOP NOW!`. The named work:

> Steps 14 and 15 with adversarial review and deploy to a new site on the vps
> using the vps-access branch and functionality. You are not done until we have
> a new tile on the portal site that opens The Ultimate Trading System onto the
> blank Setup tab with the other two tabs all functionality retained beside.
> All leftover data from the previous project will be stripped along with all
> code and data schema elements not directly pertinent to UTS.

Points 14, 15 and 17 of `THIS-RELEASE.md`. This file is disposable; the points
are not. Status: OPEN · DONE · PARKED (with a reason).

## Ground truth established before starting (2026-08-19)

- Deploy API `deploy.buitendyk.ca` authenticated and answering; actions are
  `deploy-website`, `run-script`, `status`, `sync`, and the dubber pair.
- Branches `vps-access`, `website`, `ultimate-trading-system` all present.
- Ports in use on the VPS: 8088 dubber, 8091 balancer, 8092 semi-auto
  balancer, 8093 the existing classifier. **The new site takes 8094.**
- `server.js` reaches 57 of the 59 library modules, so the file-import graph
  separates nothing. The separation is by ROUTE: the surviving screens call 50
  endpoints; the departing screens own 18 the survivors never touch.

## The rule that governs every step

**The currently deployed system keeps running, untouched.** It holds the
owner's live trading and both paper books. Everything here installs to a NEW
directory, under a NEW service name, on a NEW port, behind a NEW web address.
Nothing writes to `/opt/general-classifier`, its service, or its data.

## Steps

- [x] 1. **Point 17 — the new front door.** `setup.html` created blank; the
      tab strip built there carrying **Setup · Construct · Trade**; the same
      strip added to the other two pages, which have none today; page files
      renamed; labels changed. Done first so a front door exists before the
      old one is removed.
- [x] 2. **Point 14 — the cull.** The 18 departing-only endpoints removed from
      `server.js`, then every module, page and test reachable only from them.
      Traced and proved, never judged by name. Test suite green at the end.
- [x] 3. **Point 15 — the data.** The new install starts with an empty data
      directory by construction. Only the candle cache is carried across.
      Schema elements belonging to the retired screens go with their code.
- [x] 4. **Adversarial review.** Independent passes over the whole diff:
      correctness, dead references, the HTTP surface, and deployment safety —
      each finding fixed and re-checked.
- [x] 5. **Deploy.** New `deploy/install.sh` targeting
      `/opt/ultimate-trading-system`, service `ultimate-trading-system`, env
      `/etc/ultimate-trading-system/env`, port 8094. New `deploy-uts.sh` on
      `vps-access`. Branch merged to `ultimate-trading-system` and installed.
- [x] 6. **The tile.** nginx location and portal card on the `website` branch,
      shipped with `deploy-website`, verified end to end.

## Decisions taken inside the loop

(newest first; one line each, per CLAUDE.md RULE SIX)

- Order: point 17 before point 14, so the new front door exists before the old
  page carrying the tab strip is deleted. There is never a moment with no way in.
- Separation for point 14 is by ROUTE, not by file import. The import graph
  from server.js reaches almost everything and would have justified keeping all
  of it.

## Found along the way — NOT fixed, left for the owner

Per RULE SIX these are written down rather than acted on. None is in the named
work.

- **The two screens remember the theme separately.** Construct stores the
  choice under one key and Trade under another, so switching to light on one
  and moving to the other flips it back. The new Setup page deliberately shares
  Construct's key rather than inventing a third. Before the tab strip existed
  this was easy to miss; now the strip invites exactly the journey that shows
  it.
- **`/api/live/pairs` answers, but no screen asks it.** It is the one
  definition of which pairs the system needs, and by RULE FIVE it should be
  visible somewhere. Kept because it is UTS-pertinent and three operational
  scripts use it.
- ~~**`lib/batch.js` still carries the departed screens' run kinds.**~~ FIXED
  2026-08-19 on the owner's direction — see "Was parked, now done" below. The
  consensus, meta-lens and permutation-screen block is gone, and so are the
  walk-forward and single-pair launchers.
- **The retired-vocabulary guard had one live hit** on the Construct screen once
  it was pointed at the surviving pages. Reworded with the meaning unchanged;
  reported because it is a screen string outside the named work.

## Was parked, now done (owner direction, 2026-08-19)

The carve-out of `lib/batch.js` was parked on the grounds that the departed
run kinds were interleaved with the surviving sweep. The owner's answer was the
obvious one and the right one: you do not keep a retired screen's module alive
to host one shared helper — you move the helper and delete the rest.

Measured properly, the entanglement was one function. Of 23 symbols in the
block, 22 were used only by the block or named in the export list; `median`
alone had callers on both sides. It now lives in `lib/stats.js`, a plain
numeric-helpers module with no imports, and the block is gone: 905 lines out of
`batch.js`, plus `lib/metalens.js`, which nothing else used.

Three test files went with the screens. Before deleting them, two tests that
had been filed there but cover SURVIVING code were carried out:
`directionalCall` — the rule deciding which way a trade goes — into a new
`tests/test-paper.js` beside the module it is actually about, and the two
unique feature-view assertions into `tests/test-features.js`. `test-boost.js`
and `test-batchdoc.js` were left untouched, as the review required.

The lesson worth keeping: parking it was over-caution dressed as prudence. The
measurement that made it look entangled was my own, and it was wrong — twice.
The right response to an instrument you distrust is a better instrument, not a
smaller ambition.

## Adversarial review — what it found (2026-08-19)

Five independent passes, every finding then handed to a second agent told to
refute it. 53 raised, 45 survived. What follows is what came of them.

### Fixed, because they were mine

- **The port fallback still said 8093.** env.example, the unit and the README
  were all moved to 8094 but `server.js` still fell back to the port the
  running system is on. An env file that lost its PORT line would have had this
  service race the live one for its port at boot, with no ordering between the
  units to stop it. Fallback is now 8094, and the unit sets PORT as well so the
  env file is not the only source.
- **The installer could have replaced the interpreter the live system runs on.**
  It inherited a branch that installs Node from a third-party repository. The
  old trading rail shells out to `node` by name every hour, so a swapped
  interpreter is picked up within the hour with no restart. It now refuses and
  says why.
- **The collision guard compared strings.** A symlinked install directory would
  have passed it and written into the live installation. It now resolves paths,
  refuses symlinks, and refuses to adopt a unit file that points somewhere else.
- **The candle seed had no disk check.** It duplicates the cache onto a
  filesystem that was at 83%. It now measures the copy, requires 2 GB of
  headroom, and runs at idle I/O priority so it cannot make the live rail's
  hourly write late.
- **Nothing bounded the new service.** Neither unit had a single limit, so a
  sweep here could starve the trading rail and a memory spike could invite the
  kernel to kill the wrong process. The new unit now carries CPU, memory and
  I/O limits, and parks instead of respawning for ever when it fails. No limit
  was added to the old unit: that is a change to the running system.
- **A route survived with no caller.** `POST /api/batch` launched the departed
  pair screen; its only caller was a deleted page. Removed.
- **Two of the three pages carry all their JavaScript inline**, so the release
  cache-marker protected nothing for them. The page route now says no-cache
  outright rather than relying on a mechanism that cannot reach them.
- **Shipping the portal tile would have run apt.** The website installer
  installs nginx before anything else, and a pending upgrade restarts it —
  dropping every proxied site, including the live one, for the duration. A
  purpose-built shipper on `vps-access` now does the same job with no package
  work, reloading rather than restarting, gated on a config test, with the old
  vhost backed up first.

### NOT fixed — real money. For the owner, not for me.

Both are pre-existing and neither was caused by this work. RULE SIX stops the
loop at anything that changes the behaviour of something already trading.

- **`POST /api/pilot/arm` arms on an empty body.** The handler only refuses when
  the body explicitly says `armed === false`, so `{}` falls through to writing
  an arm request. Its CSRF guard also fails open when a request carries no
  Origin and no Referer header — which is the normal shape of a request from a
  script rather than a browser. The two together mean the live arm control can
  be pressed by a request that never intended to press it. The reviewer also
  observed that running the documented test command against a live server would
  do exactly that.
- **`POST /api/pilot/stop-apply` carries no CSRF guard** while its declared twin
  `POST /api/pilot/margin-floor` does, and an empty body makes it record "no
  protective stop, chosen by owner" rather than refusing.

### Carried into the parked batch.js work

The reviewers proved the park was right, and left three things a later pass must
know:

- `median` was the one genuinely shared symbol. It now lives in `lib/stats.js`
  and the block is gone. The warning it carried was right and is worth keeping:
  cutting a hoisted function produces no load error, so the failure would have
  been a runtime one, mid-run, in a null test the owner was watching fill in —
  and a green suite would have proved nothing.
- `permNullAggregate` went with the permutation screen and its test file. It no
  longer exists anywhere.
- `tests/test-boost.js` and `tests/test-batchdoc.js` must NOT be deleted with
  the departed screens. `tests/test-consensus.js` WAS deleted — but only after
  the two tests inside it that covered surviving code were carried out first. Between them they carry the
  only coverage of the model both surviving sections fit, of the per-sample
  weighting the age dial runs on, of the decision rule behind the sweep's
  decision control, and of a path-traversal guard on a live request path.

## Delivered, and verified on the box (2026-08-19)

`uts-verify.sh` on `vps-access` is read-only and runs all of this against the
real server. Every line passed.

- The previous generation is untouched: `general-classifier` active, 8093
  answering, its directory intact.
- `ultimate-trading-system` active on 8094.
- The address opens the **Setup** tab, blank, with **Construct** and **Trade**
  beside it and Setup marked as the current one.
- Both other pages carry the strip; Construct's client code serves at 153 KB.
- The departed pages and endpoints are 404; nine surviving endpoints answer.
- 2,712 candle files carried across. Every other data directory is empty: this
  system starts from zero use.
- The portal carries the new tile beside the old one, and all five proxied
  locations still answer through nginx.

## A note on the instruments used tonight

Three measurements written during this loop returned confident wrong answers,
and each was caught only by checking it rather than believing it:

- The first reachability script over `lib/batch.js` said every symbol was in
  use, because it counted a name appearing in a comment as a call. It would
  have justified changing nothing.
- The second, with comments and strings stripped, still over-connected and said
  the same thing for a subtler reason.
- The verification script reported Construct's client code missing from the
  deployed server. It was not missing: the check piped curl into `head -c 200`,
  which closes the pipe and fails curl before it can answer.

Two of the three failed in the direction that would have ended the work early,
and one raised a false alarm about a live deployment. Worth recording, because
the parked item below rests on exactly this class of measurement being wrong.
