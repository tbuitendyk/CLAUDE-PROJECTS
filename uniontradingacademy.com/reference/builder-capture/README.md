# Builder capture — 2026-08-05 (read-only)

Faithful capture of the unpublished MyWebsite Now design for
`uniontradingacademy.com`, taken from the builder's preview mode via the
client's panel (read-only session; nothing was edited or published).

- `html/` — the exact rendered DOM of each page's preview (`srcdoc` extract):
  `inicio`, `proyectos`, `contactanos`, `aviso-legal`, `privacidad`.
  Ground truth for text content, structure, inline styles.
- `assets/` — every `/-_-/…` asset the pages reference (images + Poppins font
  family), downloaded through the authenticated session. The site images
  (logo, hero art, section photos) live under `assets/-_-/img/`.
- `shots/` — full-page screenshots per page, desktop (1440px) and mobile
  (390px), rendered locally from `html/` + `assets/` with scripts stripped.

To re-render locally: copy a page from `html/`, strip `<script>` tags,
replace every `/-_-/` with `assets/-_-/`, open via `file://` from this
directory.

## Asset paths (normalized 2026-08-13)

The builder served assets from deep, redundant paths — the worst was 190
characters. The whole `assets/` tree is now flat and descriptive:

| Kind | Was | Now |
|---|---|---|
| Images | `/-_-/res/<siteUUID>/images/assets/<assetUUID>/2000-1333/<sha1>?o=width:…` | `/-_-/img/<name>-<W>x<H>.<ext>` |
| Fonts | `/-_-/common/fonts/Poppins-latin_latin-ext-600italic.woff2` | `/-_-/fonts/Poppins-600italic.woff2` |
| Scripts | `/-_-/common/services/<name>/<name>.js` | `/-_-/js/<name>.js` |

The `/-_-/` prefix is deliberately kept so the re-render step above is
unchanged. Notes:

- Image `?o=width:…/height:…/` query strings were dropped — the size is in the
  filename now, and `file://` loads fail on a query string.
- Font `?#iefix` / `#Poppins` suffixes ARE preserved: they are part of the
  `@font-face` `src` syntax, not path noise.
- Three byte-identical duplicate logo files collapsed into one each, so the 63
  image files became 60. Fonts (34) and scripts (5) moved 1:1.
- All 1,448 references across the five pages were rewritten. Nothing outside
  `html/` referenced these paths. The one remaining `/-_-/common/…` string in
  the tree is inside minified vendor `js/consent.js`, which fetches that path
  from the builder's live server at runtime — deliberately left alone.

### Known pre-existing gaps (not introduced by the rename)

- 74 of the 113 font references dangle: the builder's `@font-face` blocks list
  `eot`/`ttf`/`svg`/`woff`/`woff2` per weight, but only `woff`/`woff2` were
  downloaded. Browsers pick `woff2`, so this is harmless.
- Re-rendering from `html/` falls back to Times, not Poppins — the 36
  `@font-face` rules are present but nothing requests them, so the stylesheet
  that sets `font-family` was evidently not part of the captured DOM. Verified
  identical before and after the rename. Use `shots/` for true typography.

| Image | Sizes | Used on |
|---|---|---|
| `uta-hero-orderflow` | 375–1366 wide (png) | inicio — **the real UTA brand art**: logo, tagline, order-flow chart |
| `logo-placeholder` | 125–455 wide (png) | all 5 pages — template placeholder ("arhitectura"), NOT UTA branding |
| `office-loft-banner` | 375–1366 wide | aviso-legal, contactanos, privacidad, proyectos (page-header strip) |
| `office-meeting-room` | 240–2000 wide | inicio, proyectos |
| `desk-plants` | 240–2000 wide | inicio, proyectos |
| `good-morning` | 240–664 wide | inicio, proyectos |
| `office-lobby` | 240–2000 wide | inicio, proyectos |
| `lounge-green-wall` | 256–2000 wide | inicio |
| `hanging-garden` | 256–2000 wide | inicio |
| `corner-office-tree` | 256–2000 wide | inicio |

All except `uta-hero-orderflow` are MyWebsite-Now template stock photography —
generic interiors with no connection to trading. They are captured for fidelity
only; none carry over into the v1 site.

Notes for the rebuild:

- Typeface: **Poppins** (full weight set in `assets/-_-/fonts/`).
- Nav: Inicio / Proyectos / Contáctanos (+ footer: Aviso legal, Política de
  privacidad).
- The header logo slot shows a template placeholder ("arhitectura") — the real
  brand mark lives in the hero image; a proper logo asset is wanted for v1.
- Social links in the builder are bare placeholders (facebook.com,
  instagram.com, twitter.com without handles).
- This capture is the *baseline*. Owner is supplying additional material as
  design **guidance** (explicitly not a literal template) for v1.0.0.
