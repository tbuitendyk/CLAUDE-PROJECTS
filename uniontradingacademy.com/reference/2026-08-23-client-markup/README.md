# Client markup received 2026-08-23 (via owner, `more_files2.7z`)

Supersedes the 2026-08-16 WhatsApp batch (6 screenshots, never committed).
The archive held **5 files but only 3 distinct images** — two were exact
byte-for-byte duplicates (WhatsApp "(1)" copies), so only the 3 are kept.

| File | Size | What it is | Action |
|---|---|---|---|
| `promesa-section-with-2-new-bullets.jpg` | 872×611 | Mockup of the "Una promesa basada en resultados de enseñanza" section **with two extra bullets already added** — the desired end state | **DECISION PENDING** — see below |
| `rentabilidad-paragraph.jpg` | 1090×182 | The "te ayudamos a lograr tu rentabilidad" paragraph | None — same copy as the Aug-16 capture, only re-screenshotted at a different scroll offset (verified by pixel diff; text is identical, just shifted) |
| `agenda-page-empty-gap.jpg` | 809×848 | `/agenda/` showing the large empty area above the WhatsApp fallback | None yet — that gap fills once `CALENDLY_URL` is set; the earlier Aug-16 capture drew a "video" box in the same space |

## The two proposed bullets (decision pending with the owner)

The mockup adds these to a list whose stem is "Trabajamos a tu lado de forma
directa hasta que:" —

1. "Aprendas a operar los mercados americanos, para tener un ingreso semanal o
   quincenal."
2. "Capacitado para pasar una cuenta de Fondeo, y para capitalizarla para hacer
   retiros quincenales o mensuales."

Flagged before implementing (raised with the owner 2026-08-16, still open):

- **Income-cadence claims.** The section is explicitly framed on *teaching*
  outcomes; its other three bullets are purely process (build a plan, justify
  entries with the method, audit the journal). Promised earnings frequency
  conflicts with that framing.
- **Ad-policy risk.** Google's financial-services advertising policy restricts
  income claims — this directly threatens the search campaign requested in the
  same round of client material.
- **Consumer-protection exposure** in Mexico (PROFECO/CONDUSEF) for advertised
  financial returns on a paid mentoring offer.
- **Grammar.** The stem requires subjunctive: "Aprendas" is correct, but
  "*Capacitado* para pasar…" does not agree and needs "Estés capacitado para…".

Suggested wording that keeps the substance without the earnings cadence:
"Aprendas a operar los mercados americanos con un proceso estructurado" and
"Estés preparado para superar una evaluación de cuenta de fondeo y gestionarla
con disciplina."
