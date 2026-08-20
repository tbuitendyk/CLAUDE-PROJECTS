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

- [ ] 1. **Point 17 — the new front door.** `setup.html` created blank; the
      tab strip built there carrying **Setup · Construct · Trade**; the same
      strip added to the other two pages, which have none today; page files
      renamed; labels changed. Done first so a front door exists before the
      old one is removed.
- [ ] 2. **Point 14 — the cull.** The 18 departing-only endpoints removed from
      `server.js`, then every module, page and test reachable only from them.
      Traced and proved, never judged by name. Test suite green at the end.
- [ ] 3. **Point 15 — the data.** The new install starts with an empty data
      directory by construction. Only the candle cache is carried across.
      Schema elements belonging to the retired screens go with their code.
- [ ] 4. **Adversarial review.** Independent passes over the whole diff:
      correctness, dead references, the HTTP surface, and deployment safety —
      each finding fixed and re-checked.
- [ ] 5. **Deploy.** New `deploy/install.sh` targeting
      `/opt/ultimate-trading-system`, service `ultimate-trading-system`, env
      `/etc/ultimate-trading-system/env`, port 8094. New `deploy-uts.sh` on
      `vps-access`. Branch merged to `ultimate-trading-system` and installed.
- [ ] 6. **The tile.** nginx location and portal card on the `website` branch,
      shipped with `deploy-website`, verified end to end.

## Decisions taken inside the loop

(newest first; one line each, per CLAUDE.md RULE SIX)

- Order: point 17 before point 14, so the new front door exists before the old
  page carrying the tab strip is deleted. There is never a moment with no way in.
- Separation for point 14 is by ROUTE, not by file import. The import graph
  from server.js reaches almost everything and would have justified keeping all
  of it.
