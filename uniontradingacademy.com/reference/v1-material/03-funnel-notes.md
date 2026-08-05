# v1 material 03/04 — conversion funnel (PDF mockups + owner's flow sketch)

## 03-funnel-mockups.pdf (7 pages, received 2026-08-05)

Screenshots of a reference funnel (branded "Conquer Finance" / "Conquer
Finance LATAM") with the UTA logo composited over — supplied as *examples*
of the desired flow, not as literal pages to clone:

1. **Thank-you page** — "¡Felicidades! Tu llamada ha sido reservada" +
   3 steps: PASO 1 watch a short video ("Haz click en reproducir"), PASO 2
   confirm the appointment (they call from a +52 number; "contéstala
   confirmada"), PASO 3 longer video about becoming a funded-account trader.
   Hexagon-pattern light background, blue accent bars.
2-5. **Typeform-style qualification form** — "Sesión de Consultoría":
   Comenzar → Nombre → Número de teléfono (+52, MX flag) → ¿Qué edad
   tienes? (brackets) → ¿Qué objetivo tienes…? (A-E cards: principiante /
   pasión por inversiones / segunda fuente de ingresos / libertad de
   ubicación / otra) → ¿Qué ingresos mensuales netos generas? (USD
   brackets) → ¿Qué problemas encuentras en tu situación actual…? (open
   text) → Enviar. Progress bar bottom-right, one question per screen.
6-7. **Calendly-style scheduler** — "Sesión de Consultoría | … LATAM",
   45 min, "Cómo será la llamada" bullets (análisis de situación, plan de
   acción, resolver dudas), month calendar + time slots, zona horaria
   Ciudad de México.

## 04 — owner's hand-drawn flow sketch (chat image, received 2026-08-05)

Pencil sketch, two columns:

- **Main page**: "Empieza tu curso" button (top, circled — matches the
  copy's "Comienza tu mentoría" header CTA), content area, "Más" button →
  **Information about the classes** page/section.
- **Funnel**: Landing Page with **Video 10m** → **Cuestionario** ("Queremos
  saber más de ti…": Nombre → Correo → Teléfono → ⋮ more) → **Calendario**
  (annotated "Calendly.com") → **WhatsApp**.

## Build implications (all compatible with a static site + GitHub-only deploys)

- The funnel = third-party embeds/links: video player (e.g. YouTube/Vimeo
  embed), form (Typeform or equivalent — or a native multi-step form),
  Calendly embed, WhatsApp deep link (wa.me). No server code required.
- Pages needed beyond the main page: landing (video + CTA), cuestionario,
  agenda (Calendly), gracias/confirmación (3-step thank-you).
- "Conquer Finance" naming in the mockups is from the reference material —
  the real funnel is branded Union Trading Academy. Which form/calendar
  accounts to use (Typeform/Calendly/etc.) is an owner/client decision at
  wiring time.
