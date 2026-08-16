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

## Image paths (normalized 2026-08-13)

The builder served images from deep hash paths, e.g.
`/-_-/res/<siteUUID>/images/assets/<assetUUID>/2000-1333/<sha1>?o=width:…` —
190 characters, opaque, and awkward on some filesystems. They are now flat and
descriptive:

    assets/-_-/img/<name>-<width>x<height>.<ext>

The `/-_-/` prefix is deliberately kept so the re-render step above is
unchanged. The `?o=width:…/height:…/` query strings were dropped (the size is
in the filename, and `file://` loads fail on a query). Three byte-identical
duplicate logo files collapsed into one each, so 63 files became 60. Every
reference in `html/` was rewritten to match; nothing else in the repo referenced
these paths.

| Image | Sizes | Used on |
|---|---|---|
| `uta-hero-orderflow` | 375–1366 wide (png) | inicio — **the real UTA brand art**: logo, tagline, order-flow chart |
| `logo-placeholder-arhitectura` | 125–455 wide (png) | all 5 pages — template placeholder ("arhitectura"), NOT UTA branding |
| `office-loft-banner` | 375–1366 wide | aviso-legal, contactanos, privacidad, proyectos (page-header strip) |
| `office-meeting-room` | 240–2000 wide | inicio, proyectos |
| `desk-workspace-plants` | 240–2000 wide | inicio, proyectos |
| `interior-good-morning` | 240–664 wide | inicio, proyectos |
| `office-lobby` | 240–2000 wide | inicio, proyectos |
| `lounge-green-wall` | 256–2000 wide | inicio |
| `hanging-garden-meeting-room` | 256–2000 wide | inicio |
| `corner-office-tree` | 256–2000 wide | inicio |

All except `uta-hero-orderflow` are MyWebsite-Now template stock photography —
generic interiors with no connection to trading. They are captured for fidelity
only; none carry over into the v1 site.

Notes for the rebuild:

- Typeface: **Poppins** (full weight set in `assets/-_-/common/fonts/`).
- Nav: Inicio / Proyectos / Contáctanos (+ footer: Aviso legal, Política de
  privacidad).
- The header logo slot shows a template placeholder ("arhitectura") — the real
  brand mark lives in the hero image; a proper logo asset is wanted for v1.
- Social links in the builder are bare placeholders (facebook.com,
  instagram.com, twitter.com without handles).
- This capture is the *baseline*. Owner is supplying additional material as
  design **guidance** (explicitly not a literal template) for v1.0.0.
