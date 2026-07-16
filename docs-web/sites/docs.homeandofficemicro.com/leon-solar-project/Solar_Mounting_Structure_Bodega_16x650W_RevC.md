# Solar PV Mounting Structure — Bodega Roof
## 16 × LONGi Hi-MO X10 Guardian Anti-Dust LR7-72HVHF-650M — Rev. C

| | |
|---|---|
| **Document** | Solar_Mounting_Structure_Bodega_16x650W_RevC |
| **Date** | 2026-07-15 |
| **Status** | FOR CONSTRUCTION — survey substantially closed (§6.3); three field verifications remain in §16 before drilling |
| **Companion docs** | Solar Hybrid Wiring — León Install — Rev. B; Solar_Subplan_CFE_Victron_ServicePanel_RevB |
| **Scope** | Structural mounting of 16 panels (Phase 1) on the bodega roof: steel understructure, aluminum rail system, all interfaces, fasteners, grounding/bonding of the array. Electrical stringing/wiring is out of scope except for interface notes (§12). |

**Verification legend used throughout:**
- **[V]** — verified against a primary source (LONGi datasheet 20240927 V01, LONGi DG Installation Manual V19 draft, GERAVOLT product listings retrieved 2026‑07‑15)
- **[C]** — calculated from [V] inputs; calculation shown or referenced in §15
- **[A]** — assumption or from-memory value; must be confirmed before the affected step (all [A] items are also collected in §16)

---

## 1. Scope & design basis

### 1.1 The array

| Item | Value | Src |
|---|---|---|
| Module | LONGi LR7-72HVHF-650M, Hi-MO X10 Guardian Anti-Dust | [V] |
| Module dimensions | 2382 × 1134 × 30 mm, 28.5 kg | [V] |
| Electrical (STC) | 650 W, Voc 53.90 V, Isc 15.29 A, Vmp 44.56 V, Imp 14.59 A | [V] |
| Module mech. limits (test) | +5400 Pa front / −2400 Pa rear | [V] |
| Module mech. limits (design) | +3600 / −1600 Pa (test = design × 1.5 safety factor, per manual) | [V] |
| Count / power | 16 modules, 10.40 kWp | — |
| Orientation | Portrait (long axis up-slope), facing south | [V] mandatory, see §2 |
| Layout | 2 rows × 8 modules: north row @ 30° tilt, south row @ 10° tilt | per site plan |

### 1.2 The roof

| Item | Value | Src |
|---|---|---|
| Plan dimensions | 9.14 m (E–W) × 4.82 m (N–S) | site measurement |
| Deck construction | **Vigueta y bovedilla** (owner-confirmed 2026-07-15). Vigueta direction, spacing, and capa de compresión thickness still to be surveyed — §16.1a. | [V owner] / [A survey] |
| Added mass, complete system | ≈ 1,003 kg total ≈ 22.8 kg/m² averaged over the roof (concentrated at 18 rafter bases) | [C] |

### 1.3 Load design basis

The structure is sized so that **the module reaches its own design load limit before any steel, aluminum, or anchor element does.** Envelope pressure normal to panel plane:

| Case | Pressure | Basis |
|---|---|---|
| Uplift (suction) | **−1.6 kPa** (163 kgf/m²) | = module design uplift limit [V]. Site cross-check: q = 0.613·V² at V = 140 km/h (38.9 m/s) gives 0.93 kPa dynamic; with net force coefficient 1.5–1.7 for an open tilted panel → ≈ 1.4–1.6 kPa. The 140 km/h regional velocity and Cf range are **[A]** engineering values from memory of CFE MDOC-order magnitudes, chosen conservative for the Bajío; the module-limit envelope governs regardless. |
| Downforce | +1.7 kPa (wind 1.6 + dead 0.11) | [C]; module design downforce limit is 3.6 kPa [V] — not approached by wind; would only matter under hail loading/point loads. |
| Dead | Panel 10.55 kg/m² of panel + steel/rail self-weight | [V]/[C] |

All member and anchor demands in §15 derive from this envelope. This is a self-build design rationale, not a stamped engineering calculation; if a formal check is ever needed (permits, insurance), a local structural engineer should verify against CFE MDOC wind provisions for the exact site.

---

## 2. Governing manufacturer requirements — all [V] from LONGi DG Installation Manual V19

These are warranty conditions. Every one is designed-in below; do not deviate during build.

1. **Anti-Dust (anti-soiling) modules must be mounted in portrait orientation** and must **not** be clamped on the short edge. (The planned layout complies — and is the only compliant option.)
2. **Clamp position on the long frame:** permitted only within bands measured from the module ends — **250–350, 350–450, or 450–550 mm.** This design places clamps at **491 mm** from each end (inside the 450–550 band, coincident with the module's outer bolt-hole line at 1400 mm spacing per datasheet [V]). ⚠ *The manual's table mapping each band to its exact load rating did not extract legibly from the PDF; that the 450–550/bolt-line position carries the full ±5400/2400 rating is a reasoned inference [A] — confirm with LONGi/GERAVOLT support (§16).*
3. **Minimum gap between adjoining modules ≥ 10 mm** (thermal). Design uses ~20 mm (mid-clamp width, to be confirmed §16).
4. **Distance from module frame to roof surface ≥ 10 cm** (fire rating / ventilation). *The original sketch's 9 cm south stub violates this; corrected to 150 mm minimum in this design (§3.3).*
5. Clamps: length ≥ 50 mm, overlap onto frame 10–12 mm, must never touch the glass, must not block the frame **drain holes**.
6. Clamp bolt torque: **M8 = 12–16 N·m** (M6 = 8–12 N·m).
7. **Never drill the module frame**; do not scratch the anodizing except at the designated grounding point.
8. Grounding via the Ø4.2 mm marked grounding holes on the rear frame (or a listed third-party grounding device); recommended conductor 12 AWG copper; toothed/star washer must penetrate the anodizing.
9. Portrait wiring uses **leap-frog** (adjacent modules rotated 180°); 72-cell type requires **≥ 1.4 m** cable reach. Datasheet cable is +400 / −200 mm (customizable to ±1400 mm) — **check the leads on the delivered panels before finalizing wiring plan** (§12, §16).

---

## 3. Array layout & geometry

### 3.1 Coordinate system (used for every dimension in this document)

- **x** = 0 at the **west** roof edge, positive east, 0 → 9140 mm.
- **y** = 0 at the **south** roof edge, positive north, 0 → 4820 mm.
- **z** = 0 at roof surface, positive up.
- All dimensions in **mm** unless noted.

### 3.2 Two discrepancies in the site sketch, resolved

1. **Inter-row gap is 411 mm, not 500 mm.** The sketch labels a "50 cm espacio de sombra," but the roof only closes dimensionally with 411 mm: 4820 − 2063 (30° row projection) − 2346 (10° row projection) = **411.3 mm** [C]. The sketch's own side-view "41 cm" annotation matches reality; the "50 cm" label does not. This design fixes both rows flush to the north and south roof edges with the 411 mm gap between.
2. **The 9 cm south edge height violates the LONGi ≥ 10 cm rule** (§2 item 4). Corrected: 10° row low edge at **150 mm**, 30° row low edge at **250 mm** (the extra 100 mm on the 30° row buys shading margin, §3.4).

### 3.3 Row geometry summary [C]

| | 30° row (north) | 10° row (south) |
|---|---|---|
| Modules | 8 portrait | 8 portrait |
| Row footprint (y) | y = 2757 → 4820 (depth 2062.9) | y = 0 → 2345.8 |
| Panel low edge z | 250 | 150 |
| Panel high edge z | 1441 | 564 |
| Rise across panel | 1191 | 414 |
| Rail lines (y, at clamp line 491 mm from panel ends) | **y = 3182 and y = 4395** | **y = 484 and y = 1862** |
| Rail spacing (slope / horizontal) | 1400 / 1212 | 1400 / 1379 |
| Top-of-steel z at rail lines (rail height 40 mm [A] deducted) | 456 (front) / 1156 (rear) | 195 (front) / 438 (rear) |

Array width (E–W): 8 × 1134 + 7 × 20 = **9212 mm** on a 9140 mm roof → **36 mm overhang each side** [C]. Structurally trivial; rails cantilever 80 mm past the end rafters.

### 3.4 Winter shading check [C — noon-plane approximation]

León ≈ 21.12° N → winter-solstice solar-noon altitude ≈ **45.4°**. Height differential from 10°-row north edge (z = 564) down to 30°-row south edge (z = 250) is 314 mm; noon shadow = 314/tan 45.4° ≈ **309 mm < 411 mm gap → clear at midday all year.** Grazing of the 30° row's bottom edge begins when solar altitude drops below ≈ **37.3°**, i.e., roughly the first/last ~1.5–2 h of winter days (approximate; off-noon azimuth ignored). With half-cut cells and 3 bypass diodes [V] this costs little energy and is accepted. (This margin is *why* the 30° row sits on 250 mm stubs instead of 150.)

### 3.5 Plan view (not to scale)

```
        N ↑                      x=0                                x=9140
  y=4820 ┌──┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──┐
         │  R1  R2 │  R3  │  R4  │  R5  │  R6  │  R7  │  R8  │  R9     │
         │  ═══════════════ rail 30N @ y=4395 ═══════════════════════  │   30° ROW
         │  P1 │ P2 │ P3 │ P4 │ P5 │ P6 │ P7 │ P8   (portrait)         │   8 × 650 W
         │  ═══════════════ rail 30S @ y=3182 ═══════════════════════  │
  y=2757 ├────────────────────────────────────────────────────────────┤
         │                gap 411 mm  (walkway / shadow)               │
  y=2346 ├────────────────────────────────────────────────────────────┤
         │  ═══════════════ rail 10N @ y=1862 ═══════════════════════  │   10° ROW
         │  P9 │ P10│ P11│ P12│ P13│ P14│ P15│ P16                     │   8 × 650 W
         │  ═══════════════ rail 10S @ y= 484 ═══════════════════════  │
  y=0    └────────────────────────────────────────────────────────────┘
            R1…R9 = rafter lines, x = 0, 1142.5, 2285, 3427.5, 4570,
                                      5712.5, 6855, 7997.5, 9140
```

### 3.6 Side elevation, looking west (not to scale)

```
      N ←                                                          → S
                 30° ROW                        gap             10° ROW
        z=1441 ✦
              ╱ panel 2382 on slope
        ▒▒▒▒╱  rail
          ┃╱ chord (PTR 51×51)                        z=564 ✦
    1046┃┃                                                 ╱▒▒╱ 10°
   post ┃┃         346┃                        336┃      ╱    93┃
        ┻┷━━━base━━━━━┷┓250 low edge      z=150 ┏┷━━base━━━━━━━┷┓
   ═════╧══════════════╧═══════roof════════════╧═══════════════╧═════
        y=4545      y=3032                   y=2012          y=334
        anchor…150 in from each base end; posts under rail lines
```

---
## 4. Setting-out dimensions (mark these on the roof)

Rafter lines (x): **0 · 1142.5 · 2285 · 3427.5 · 4570 · 5712.5 · 6855 · 7997.5 · 9140** (9 lines, 8 equal bays of 1142.5). Chalk-line all nine, then the four base bands below.

| Element | y from south edge | Notes |
|---|---|---|
| 10° row base, south end | 334 | base runs y 334 → 2012 |
| 10° row anchor line, front | ≈ 394 | 60 mm in from base end |
| 10° row front posts / rail 10S | 484 | posts directly under rail |
| 10° row rear posts / rail 10N | 1862 | |
| 10° row anchor line, rear | ≈ 1952 | |
| 30° row base, south end | 3032 | base runs y 3032 → 4545 |
| 30° row anchor line, front | ≈ 3092 | |
| 30° row front posts / rail 30S | 3182 | |
| 30° row rear posts / rail 30N | 4395 | |
| 30° row anchor line, rear | ≈ 4485 | |

Layout tolerance: rafter lines ±5 mm; rail lines ±5 mm in y; TOS elevations ±3 mm between adjacent rafters (rail must not be forced into a curve).

---

## 5. Steel structure

### 5.1 Material [A — confirm at purchase]

**PTR (perfil tubular) ASTM A500 Grado B or C**, or the unbranded commercial equivalent sold at León steel yards (Aceros/DEACERO distributors). All member checks in §15 pass with large margins even at a conservative Fy = 250 MPa, so uncertified commercial PTR is acceptable *for this load level*. Buy straight stock; reject bent or heavily rusted tramos.

| Use | Section | Cal. | Wall | Mass |
|---|---|---|---|---|
| Rafter members (base, posts, chord) | **PTR 51 × 51 mm (2" × 2")** | cal. 11 | 3.0 mm | 4.52 kg/m [C] |
| E–W ties and X-bracing | **PTR 38 × 38 mm (1½" × 1½")** | cal. 11 | 3.0 mm | 3.30 kg/m [C] |
| Rail seat tabs | Ángulo 38 × 38 × 4.8 mm (1½" × 3/16") | — | — | |
| Anchor tabs | Solera 51 × 4.8 mm (2" × 3/16") | — | — | |

Cal. 11 (3.0 mm) chosen deliberately over cal. 14 (1.9 mm): the structural demand would pass either, but 3.0 mm wall is far more forgiving for flux-core welding (burn-through margin) and gives corrosion life.

### 5.2 Rafter design

Each of the **18 rafters** (9 per row) is a welded right-triangle frame. The two posts sit **directly under the two rail lines**, so panel loads pass through the chord into the posts in pure compression — the chord carries essentially no bending from panel loads [C, §15.3].

**Cut list per rafter [C]:**

| Member | 30° row (×9) | 10° row (×9) | End cuts |
|---|---|---|---|
| Base | 1512 | 1679 | square both ends |
| Front post | 346 | 93 | bottom square; **top mitered** 30°/10° to mate chord underside |
| Rear post | 1046 | 336 | bottom square; **top mitered** 30°/10° |
| Chord | 1600 | 1600 | square both ends (overhangs each post 100 mm along slope) |

Assembly geometry per rafter: posts land on the base **150 mm in from each base end**, spaced 1212 mm (30°) / 1379 mm (10°) apart on the base. Chord sits on the mitered post tops with its **top face at the TOS elevations of §3.3**; chord centerline crosses post centerlines at the rail lines. Build a jig: tack the first rafter on a flat surface against blocks, verify TOS diagonal measurements, then use it as the template for the other eight. Frames within a row must be identical to ±3 mm or the rails won't seat.

### 5.3 Ties and bracing

- **E–W ties (4 total):** PTR 38×38 × 9140 running the full row width at the four §4 anchor lines — these are the **anchored sleepers** of §6: drilled at every vigueta crossing, chemically anchored, with every rafter base end landing on and fillet-welded (both sides) to a tie. Each tie fabricated from one 6100 tramo + one 3040 piece, butt-welded with a 150 mm fish plate (solera); land the joint at a rafter station. Ties square the array, carry all vertical load into the viguetas, and resist E–W drag. Bending check §15.4a.
- **X-bracing (8 diagonals):** in the vertical E–W plane of the **rear posts**, bays R2–R3 and R7–R8, both rows. PTR 38×38, lengths **1549 mm** (30° row, ×4) and **1191 mm** (10° row, ×4) [C], ends coped/flattened to the post faces. The rails brace the top plane; these two braced bays per row stop E–W racking of the posts.

### 5.4 Welding notes

- Process: FCAW-S (flux-core, gasless) as available; 0.9 mm (0.035") E71T-GS/-11 class wire. Run test coupons on cal. 11 offcuts and destructive-bend them before touching the real frames; set the machine from the coupons, not from a chart. (Any parameter numbers here would be machine-specific — deliberately not specified.)
- Grind mill scale and any galvanic coating 15 mm back from every joint before welding.
- Post-to-base and chord-to-post: **4 mm fillet, all-around** where the joint is accessible.
- Seat tabs and anchor tabs: 2 × 30 mm stitch fillets per side minimum.
- Weld sequence: alternate sides to control distortion; check each rafter against the jig after full welding, before paint.

---

## 6. Roof interface — vigueta y bovedilla (confirmed)

Deck is beam-and-block: prestressed concrete **viguetas** spanning N–S across the 4.82 m dimension (confirmed by owner photos, 2026-07-15: vigueta ends bear on the long walls; cement-block bovedilla), with a **capa de compresión reported at 60 mm** by the builders [A — verify at first pilot hole]. Two absolute rules follow:

1. **Nothing anchors into, and nothing bears point loads on, bovedilla.** Bovedilla (cement or polystyrene block) has no reliable capacity.
2. **Anchors go into vigueta top flanges** (or, as a surveyed fallback, into a confirmed ≥ 50 mm reinforced capa). Prestressing strands sit in the *bottom* of the vigueta; drilling is restricted to the top ~70–80 mm with a depth stop so strands are never approached [A — standard practice; confirm max depth with the vigueta type if identifiable, §16.1b].

### 6.1 Load path — ties become the anchored sleepers

The four E–W ties (§5.3) run **perpendicular to the viguetas** and become the anchorage members: each tie is drilled and chemically anchored **at every vigueta crossing** (~12–13 anchors per tie line), and every rafter base end lands on and is fillet-welded to a tie. Rafter loads therefore enter the ties at the 9 rafter stations and exit into viguetas at ~730 mm centers — no rafter-grid-to-vigueta-grid alignment problem, and per-anchor demand drops well below the Rev. A tab scheme.

Consequences:
- The whole structure bears **only** on the anchored ties; bases float ~38 mm (tie height) above the losa. All §3.3/§4 z-elevations now reference **top-of-tie**; absolute heights above the losa increase by 38 mm (favorable for the §2 ≥ 10 cm rule; shading geometry unchanged since both rows rise equally). Post and chord cut lengths in §5.2 are unaffected.
- Anchor demand [C, §15.4a]: worst single-point tie reaction ≈ 2.4 kN down / 1.9 kN up at a rafter station; with anchors at every crossing the governing single-anchor design tension is taken conservatively as **2.0 kN (≈ 205 kgf)**, shear ≤ 1.1 kN.

### 6.2 Anchor specification

| Item | Spec |
|---|---|
| Anchor | **Chemical:** 10 mm (3/8") varilla roscada, A2 stainless or hot-galvanized, set in injection epoxy/hybrid mortar (Hilti HIT-HY 200 / RE 500, Sika AnchorFix-3001, Fischer FIS V class) |
| Embedment | **90 mm total over vigueta lines**: through the 60 mm capa, 30 mm into the vigueta top. **Hard drill-depth stop at 100 mm.** (A ~130 mm vigueta keeps strands ≥ ~70 mm below the drill tip — comfortable, but the stop rule stands.) |
| Hole | 12 mm, SDS; prep per epoxy card — brush ×2, blow ×2, repeat (hole cleaning is the entire strength of a chemical anchor) |
| Count | 12 vigueta crossings + 1 east-wall anchorage point per tie = **52** + 10% spares |
| If steel is struck while drilling | stop, abandon hole, move 50 mm along the tie, patch |
| Cure | full manufacturer cure time before any structure load — no exceptions |
| Fallback | with the 60 mm capa confirmed, capa-only anchors (embed 45–50 mm, never breaking through) calculate to ≈ 3–4 kN allowable cone capacity [C, generic f'c] — acceptable for isolated misses at half design value; vigueta lines remain primary [A — engineer sign-off if used widely] |
| Proof test | **3 anchors per tie line to 4 kN (≈ 2× design)** with lever/scale rig after cure, before erecting rafters |

### 6.3 Vigueta survey — RESULTS (owner photos + builder report, 2026-07-15)

| Finding | Value | Src |
|---|---|---|
| Span direction | N–S (bearing on the 9.14 m walls) — matches design assumption | [V photos] |
| Count | **12 viguetas**; westernmost alongside the west wall | [V owner] |
| East edge | **No vigueta** — final bovedilla course bears directly on the east brick wall | [V owner/photos] |
| Implied average spacing | ≈ **760 mm** center-to-center (11 bays over ~8.4 m) — passes the §15.4a ≤ 800 mm check | [C — derived from count, **not measured**: measure actual centers and chalk every line before drilling] |
| Capa de compresión | 60 mm, builder-reported | [A — verify with a depth gauge at the first pilot hole before committing the pattern] |
| Bovedilla type | cement block (ribbed) — more robust than polystyrene to incidental load, still never anchored or point-loaded | [V photos] |

### 6.3b East-end anchorage — MANDATORY DETAIL (new in Rev. C)

Rafter **R9 sits at x = 9140, on the east wall line — beyond the last vigueta.** A tie left unanchored past vigueta 12 would cantilever ~0.6–0.7 m under R9's load: M ≈ 2.4 kN × 0.65 m = 1.56 kN·m → **343 MPa on 38×38 — fails outright** [C]. Therefore each of the four ties gets **2 anchors within 150 mm of the east wall line**, set into the concrete over the wall bearing (dala/cadena de cerramiento or the wall-top capa band — the wall line has solid bearing beneath it by definition; the exterior photos show a cast perimeter band consistent with a cerramiento [A — confirm visually at the wall top before drilling]). With the end anchored, R9's load passes essentially straight into the east wall — the strongest support on the roof. Mirror-check the west end: vigueta 1 runs at the west wall, so R1 anchors normally at that crossing; add the wall-line pair there too if vigueta 1 sits > 200 mm inboard of R1.

### 6.4 Work protection & sealing

- Walk boards over bovedilla zones during all roof work; concentrated loads (people, stacked panels, welder) stage over vigueta lines only.
- Seal every anchor penetration through the impermeabilizante: butyl + PU (Sikaflex-1A class) under tie contact points and around each rod; re-coat locally.

---

## 7. Aluminum rail system (Epcom Vektor "8")

### 7.1 Parts — GERAVOLT SKUs [V, retrieved 2026-07-15]

| Qty | SKU | Item | Status at Geravolt |
|---|---|---|---|
| 8 | EPL-SR8-... / VEKTOR rail | **Rail "8" anodized aluminum, 5400 mm** | 5400 sold within kits; bare 2700 (EPL-SR8-2700BLK) listed. Buy 5400s loose via WhatsApp quote — they sell kit components separately. |
| 4 | EPLSCN201B | Splice connector, rail "8" | listed ($22.45) — *agotado* at doc date |
| 30 | **EPLMCN230B** | **Mid clamp 30 mm** | ⚠ *agotado* at doc date — see below |
| 10 | EPLECN230/35B | End clamp 30/35 mm (dual) | **in stock** ($21.46) |

⚠ **The module frame is 30 mm.** The in-stock 8-panel kit (KIT8PVEKTOR8R) is specified for **35 mm** modules — its mid clamps will not grip a 30 mm frame. Do not buy the kit; buy components. EPLMCN230B is an Epcom/Syscom part — source via any Syscom dealer or MercadoLibre if GERAVOLT can't restock. **35 mm mid clamps are not an acceptable substitute.**

### 7.2 Rail runs and cut schedule [C]

Four runs of **9300 mm**, each from two 5400 sticks. Rails span x = −80 → 9220 (80 mm cantilever past R1/R9 — fine). All splices land 200 mm from rafter R5 (x = 4570), staggered between the paired rails of each row:

| Run | Piece 1 (west) | Piece 2 (east) | Splice at x | Offcuts |
|---|---|---|---|---|
| Rails 30N and 10N | 4850 | 4450 | 4770 (200 E of R5) | 550 + 950 |
| Rails 30S and 10S | 4450 | 4850 | 4370 (200 W of R5) | 950 + 550 |

Offcuts: 4 × (550 + 950) = **6.0 m of rail banked for Phase 2** (house roof).

**Before cutting:** dry-fit one full row. The 9300 figure assumes a 20 mm mid-clamp gap [A] and ~40 mm of rail beyond the outer panel edge per end for end clamps. Measure the actual mid clamp; recompute row width as 8 × 1134 + 7 × (clamp width) + 2 × (end-clamp seat); cut to that.

### 7.3 Panel positions and clamp lines [C]

Panels centered on the roof: panel 1 west edge at x = −36. Mid-clamp (joint) centers at x = **1108 · 2262 · 3416 · 4570 · 5724 · 6878 · 8032**. Note joint 4 (x = 4570) sits exactly on rafter R5 — no physical conflict (clamps use the rail's top channel, the structure attaches below), but **offset the rail-to-steel T-bolt at R5 by 60 mm west** so the two bolts aren't stacked.

Clamp rules recap from §2: mids torqued 12–16 N·m (M8) [V]; end clamps same; overlap on frame 10–12 mm [V]; never over a drain hole [V].

---

## 8. Rail-to-steel interface (36 seats: 9 rafters × 2 rails × 2 rows)

**Primary detail — welded seat tab (recommended; you own the welder, and the Epcom L-foot EPLFFN202B is agotado):**

```
        rail "8" (aluminum)
   ┌────────────────────────┐
   │   bottom T-channel     │ ← M8×25 A2 T-slot bolt, head in channel
   └───────────┬────────────┘
        ▓▓▓▓▓▓▓▓▓▓▓▓          ← EPDM pad 3 mm, 50 × 60 (galvanic isolation)
   ────═════════╧═════════──── ← ángulo 38×38×4.8 × 60 long, slot 9×20 mm
        ╲ 2×30 mm stitch ╱       welded to chord top face
   ═══════ PTR 51×51 chord ═══
```

- One tab per rafter/rail crossing, welded on the chord top face at the rail line, slot running E–W (gives ±10 mm y-adjustment).
- **M8 × 25 A2-70 stainless T-slot bolt** ("tornillo cabeza de martillo para riel solar") dropped/rotated into the rail's bottom channel, down through EPDM and slot, **A2 serrated flange nut** below. Torque to the T-bolt maker's spec (typically high-teens N·m [A]).
- ⚠ Verify the Vektor "8" bottom-channel dimensions against the T-bolt head profile **before** ordering 40 bolts — buy 2 samples first (§16.4). If the profile has no usable bottom channel, fall back to side-channel T-bolts or the Epcom L-foot when restocked.
- Galvanic pairs: stainless-on-aluminum (bolt/rail) is acceptable; aluminum-on-carbon-steel is the pair the EPDM pad exists to separate — no bare rail may touch bare or painted steel directly.

---
## 9. Fastener & hardware schedule

| # | Item | Spec | Qty (incl. spares) | Where |
|---|---|---|---|---|
| F1 | Roof anchors | 10 mm varilla roscada A2/galv. × 120 mm + injection epoxy (2–3 cartridges) per §6.2; nuts + 30 mm fender washers | 58 rods | ties @ every vigueta crossing |
| F2 | T-slot bolts | M8 × 25, A2-70 stainless, hammer-head for solar rail | 44 | rail seats (36) + spares |
| F3 | Flange nuts | M8 serrated, A2 | 44 | with F2 |
| F4 | EPDM pads | 3 mm × 50 × 60 | 40 | under every rail seat |
| F5 | Mid clamps | EPLMCN230B, **30 mm**, with M8 hardware | 30 | 28 used |
| F6 | End clamps | EPLECN230/35B, with M8 hardware | 10 | 8 used |
| F7 | Rail splices | EPLSCN201B + hardware | 4 | one per run |
| F8 | Grounding lugs | Tin-plated lay-in lug, 12–6 AWG, w/ star washer | 12 | rails ×4, structure ×2, spares |
| F9 | Splice bonding jumpers | 12 AWG Cu, 150 mm, lugged both ends | 4 | across each rail splice (unless splice is verified as listed for bonding — it is not assumed to be) |
| F10 | Module ground hardware | M4/M5 bolt + toothed washer sets at frame Ø4.2 ground holes (or listed grounding clamps) | 16 sets | per LONGi §2.8 |
| F11 | Sealant | Butyl tape + PU sealant (Sikaflex-1A class) | 2 tubes + roll | anchor penetrations |

All exposed hardware stainless A2 minimum. Clamp torques per §2 item 6; anchor torques per anchor card; record torques in the QC sheet (§14).

---

## 10. Corrosion protection

1. After weld QC: wire-wheel welds and mill scale, degrease.
2. **Primario alquidálico anticorrosivo** (or epoxy primer), 1 coat all steel, brush into weld toes.
3. **Esmalte** topcoat × 2 (color per preference; light gray reflects heat).
4. Cold-galvanizing spray on any field welds/drill cuts made after painting.
5. EPDM at every aluminum/steel contact (§8); no exceptions.
6. Annual visual: weld toes, anchor points, rail seats. León's dry climate is favorable; the coating system above is the long-life budget option, and hot-dip galvanizing is deliberately skipped as disproportionate at this scale.

---

## 11. Grounding & bonding

Interfaces with the site scheme in *Solar Hybrid Wiring — Rev. B* (single N–G bond at the LuxPower N-PE Connect; containers as grounding electrode).

1. **Modules:** ground each frame at its Ø4.2 mm marked hole with toothed hardware penetrating the anodizing, 12 AWG bare Cu daisy-chain per row [V — LONGi §2.8]. Do not drill new holes [V].
2. **Rails:** bond each of the 4 rails to the row ground conductor via lay-in lug (F8); jumper across every splice (F9) — anodized rail joints are not assumed conductive.
3. **Steel structure:** bond each row's structure (one lug per row on a ground-cleaned spot) to the same conductor.
4. **Home run:** array EGC routes with the PV circuit conductors to the equipment grounding system per Rev. B. The array ground is *not* a separate electrode — one grounding system, one N–G bond, as already established for the site.

---

## 12. Wiring interface notes (electrical plan owns the rest)

- Portrait → **leap-frog wiring** [V]: adjacent modules rotated 180° so junction boxes alternate; 72-cell modules need ≥ 1.4 m lead reach [V]. Delivered leads are +400/−200 mm standard [V datasheet] — **measure the actual leads on arrival**; if leap-frog reach fails at the 1134 mm pitch, order MC4 extension jumpers (Geravolt stocks 1 m pairs) or specify ±1400 mm leads at purchase [V datasheet option].
- Anticipated stringing for the SNA-US-12K: 8S per MPPT (one row per MPPT), 16 panels = 2 strings. String Voc cold-corrected must clear the inverter's PV input limit — carried in the electrical doc, not here.
- Route strings along the rear rail in UV-rated ties/clips [V manual: UV-resistant fixing, min bend radius 43 mm]; drip loops at row ends; keep connectors off the roof surface [V].

---

## 13. Consolidated bill of materials

### 13.1 GERAVOLT / solar-specific
| Item | Qty | Ref |
|---|---|---|
| Rail "8" Vektor 5400 mm | 8 | §7.1 |
| Splice EPLSCN201B | 4 | |
| Mid clamp 30 mm EPLMCN230B | 30 | ⚠ sourcing, §16.3 |
| End clamp EPLECN230/35B | 10 | in stock |
| MC4 extensions (contingency) | 4 pr | §12 |

### 13.2 Steel yard (León)
| Item | Qty | ≈ Mass |
|---|---|---|
| PTR 51×51 cal. 11, tramo 6.10 m | 13 | 358 kg |
| PTR 38×38 cal. 11, tramo 6.10 m | 9 | 181 kg |
| Ángulo 38×38×4.8, 6.10 m | 1 | (36 × 60 mm tabs) |
| Solera 51×4.8, 6.10 m | 1 | (tie fish plates; anchor tabs deleted in Rev. B) |
| Primer + esmalte + thinner | 4 L + 4 L | |
| Cutting discs, flap discs, FCAW wire 0.9 mm | — | ~2 spools |

### 13.3 Ferretería / tornillería
Everything in §9 (F1–F11), plus: 12 AWG bare Cu ~30 m, chalk line, string line, anchor drill bit per anchor card.

### 13.4 Cut summary [C]
- 51×51: 9× {1512, 346, 1046, 1600} + 9× {1679, 93, 336, 1600} — total 73.9 m
- 38×38: 4 × (6100 + 3040) ties + 4 × 1549 + 4 × 1191 diagonals — total 47.8 m
- Rail: 4 × 4850 + 4 × 4450 from 8 × 5400 (offcuts 4 × 550 + 4 × 950 → Phase 2)

---

## 14. Assembly sequence & QC

1. **Vigueta survey per §6.3** — map direction/spacing/capa, chalk the lines (gating). Buy steel; buy 2 sample T-bolts; verify §16.4.
2. Fabricate rafter jig; weld rafter #1; check against §5.2 cut list and TOS diagonals; weld remaining 17.
3. Weld seat tabs (36) and anchor tabs (36) on the bench. Prime + paint everything.
4. Chalk the §4 grid over the vigueta map. Drill the four **ties** at every vigueta crossing, clean holes per epoxy card, set rods, full cure, then **proof-test per §6.2** before anything sits on them. Bed tie contact points in sealant.
5. Set 10° row rafters on lines R1–R9 with base ends on the ties, plumb posts, square the row by diagonals (±5 mm over 9.14 m), fillet-weld base ends to ties (cold-galv the welds). Repeat for 30° row. Weld X-bracing in bays R2–R3 and R7–R8.
6. String-line each rail seat plane: TOS within ±3 mm rafter-to-rafter. Shim under seat tabs (stainless shims) only — never pull the rail down to a low seat.
7. Set rails on EPDM pads, T-bolts finger-tight; install splices at §7.2 stations; verify 9300 overall and 80 mm cantilevers; torque seats.
8. Panels, south row first, west to east: set panel, leap-frog connect *before* placing its neighbor, clamp per §2 (mid 12–16 N·m). End clamps last. Verify no drain hole is blocked and clamp overlap is 10–12 mm on every clamp — spot-check with a scribed gauge block.
9. Grounding/bonding per §11; continuity-test frame-to-EGC < 1 Ω at the farthest module.
10. QC sheet (file with this doc): every torque, anchor test loads, TOS survey, continuity readings, photos of each splice and 4 random clamps.

Two-person minimum for panel setting (28.5 kg, sail area); never in wind; never step on modules [V].

---

## 15. Calculation appendix

Full script: `calc.py` (companion file, reproduces every [C] number).

**15.1 Loads.** Envelope ±1.6 kPa normal to panel (§1.3). Rafter spacing 1142.5 mm; tributary per rail contact 1.361 m² → **2.18 kN (222 kgf) per contact**, 4.35 kN normal per rafter.

**15.2 Anchor demand.** Vertical uplift per rafter = 4.35·cos θ − dead (0.53 kN): 30° → 3.24 kN; 10° → 3.76 kN. Per anchor (2/rafter) with 1.5 eccentricity/prying factor: **2.43 / 2.82 kN design tension**; shear ≤ 1.09 kN. Proof test at 5 kN ≈ 1.8× worst design.

**15.3 Members (51×51×3: A = 576 mm², Z = 8,708 mm³, r = 19.6 mm).** Chord bending from panel loads ≈ 0 (loads enter at posts); governing chord case is a 1 kN construction point load mid-span → 40 MPa vs 150 MPa allowable (conservative Fy 250 basis). Rear post (1046 mm): KL/r = 53, demand 7.6 MPa vs Euler 695 MPa — compression is trivial. 38×38 ties/braces are stiffness/robustness members; demands are far below capacity.

**15.4a Tie bending (Rev. B, updated Rev. C).** Worst rafter station load mid-way between anchors at the surveyed ≈ 760 mm spacing: downforce 2.4 kN → M = PL/4 = 0.46 kN·m → **100 MPa** on 38×38 (Z = 4,546 mm³); uplift 1.9 kN → 79 MPa. Both < 150 MPa allowable ✓ (rule stands: re-run if measured spacing > 800 mm). **East cantilever (Rev. C):** unanchored, 2.4 kN at 0.65 m → 343 MPa — fails; resolved by the §6.3b wall-line anchor pair, which reduces the moment at R9 to ≈ 0.

**15.4 Rail.** w = 1.91 kN/m per rail; continuous over 1.1425 m spans: M ≈ wL²/10 = 0.249 kN·m → ~71 MPa at an assumed Z = 3.5 cm³ [A] vs ~140 MPa allowable for 6005-T5. Margin ≈ 2×; the operative justification is that Epcom's own Vektor kits (rated 136 km/h, 20–45°) support at comparable spacing. Do not exceed 1.15 m rafter spacing without a verified rail section modulus.

**15.5 Shading.** §3.4; noon-plane approximation, azimuth off-noon ignored — adequate for a go/no-go on the 411 mm gap.

**Stated limits of this appendix:** wind velocity/Cf are conservative assumptions [A], not a site MDOC determination; anchor capacities are product-generic pending the chosen anchor's data card [A]; this is a self-build rationale, not a stamped calc.

---

## 16. Open items — CLOSE BEFORE BUILD

| # | Item | Blocks | Status |
|---|---|---|---|
| 1 | Roof deck construction | — | **CLOSED 2026-07-15** — vigueta y bovedilla, owner-confirmed |
| 1a | Vigueta survey | — | **SUBSTANTIALLY CLOSED 2026-07-15** (§6.3). Residual field checks before drilling: (i) tape-measure actual vigueta centers and chalk all 12 lines — the 760 mm figure is derived, not measured; (ii) verify 60 mm capa with a depth gauge at the first pilot hole; (iii) confirm concrete (dala/cerramiento) at the east wall top for §6.3b |
| 1b | Drill-depth rule | §6.2 | CLOSED — 90 mm embed / 100 mm stop over vigueta lines per confirmed 60 mm capa; strand clearance ample |
| 2 | LONGi confirmation that clamp band 450–550 mm (bolt-hole line) carries full ±5400/2400 Pa for LR7-72HVHF | §2.2 (design proceeds on reasoned inference) | OPEN — one WhatsApp/email to Geravolt or LONGi support |
| 3 | Source 30 mm mid clamps EPLMCN230B (agotado at Geravolt at doc date) | §7 purchase | OPEN — Syscom dealer / MercadoLibre / restock |
| 4 | Vektor "8" rail: actual profile height, bottom-channel dims (T-bolt fit), mid-clamp width | §3.3 TOS values (±few mm), §7.2 cut length, §8 bolts | OPEN — measure on 2 sample pieces before bulk cut/order |
| 5 | Anchor proof test, 3 per tie line @ 4 kN after cure | §6.2, §14.4 | pending #1a |
| 6 | Delivered panel lead length vs leap-frog reach | §12 | check at delivery |
| 7 | Optional: formal CFE MDOC wind determination by local engineer | §1.3 (design is conservative without it) | optional |

---

**Revision history**

| Rev | Date | Change |
|---|---|---|
| A | 2026-07-15 | Initial issue for review; roof deck unknown |
| B | 2026-07-15 | Deck confirmed vigueta y bovedilla. §6 rewritten: E–W ties become anchored sleepers, chemical anchors (10 mm epoxy rods) at every vigueta crossing, 80 mm depth-stop rule; rafter-base anchor tabs deleted; structure floats 38 mm on ties (all z now top-of-tie referenced); tie bending check added (§15.4a); assembly sequence and open items updated. |
| C | 2026-07-15 | Survey results incorporated (photos + builder report): 12 viguetas N–S, ≈ 760 mm implied spacing, 60 mm capa, cement bovedilla, **no east-edge vigueta**. Embed revised to 90 mm / 100 mm stop; §6.3b mandatory east-wall-line anchor pair added (unanchored cantilever fails, §15.4a); anchor count fixed at 52 + spares; capa-only fallback upgraded per 60 mm capa. |

*Calculations reproducible via companion `calc.py`. Field changes log here and roll into Rev. D.*
