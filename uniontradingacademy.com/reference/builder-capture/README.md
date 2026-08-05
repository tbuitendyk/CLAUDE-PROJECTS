# Builder capture — 2026-08-05 (read-only)

Faithful capture of the unpublished MyWebsite Now design for
`uniontradingacademy.com`, taken from the builder's preview mode via the
client's panel (read-only session; nothing was edited or published).

- `html/` — the exact rendered DOM of each page's preview (`srcdoc` extract):
  `inicio`, `proyectos`, `contactanos`, `aviso-legal`, `privacidad`.
  Ground truth for text content, structure, inline styles.
- `assets/` — every `/-_-/…` asset the pages reference (images + Poppins font
  family), downloaded through the authenticated session. The site images
  (logo, hero art, section photos) live under `assets/-_-/res/`.
- `shots/` — full-page screenshots per page, desktop (1440px) and mobile
  (390px), rendered locally from `html/` + `assets/` with scripts stripped.

To re-render locally: copy a page from `html/`, strip `<script>` tags,
replace every `/-_-/` with `assets/-_-/`, open via `file://` from this
directory.

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
