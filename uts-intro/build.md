# uts-intro — build notes

**Result:** `uts-intro.mp4`, 1920×1080, 30 fps, H.264 + AAC, **1:50** (109.7 s), 16.3 MB.
The share page (https://claude.ai/artifact/1NkbzPwcKkCuFajdSgbCpj) plays a slightly smaller copy of the same cut,
with each scene's raw recording and each voice clip. Those clips and recordings live there, not in this folder.

Everything on screen is the live site at ultimate-trading-system.com, signed in as
support@homeandofficemicro.com, recorded in one continuous take. Only the captions and the end card were
added afterwards, and they are plain type.

## Voice

- **edge-tts, voice `en-US-AndrewNeural`, rate −10 %.** Your md asked for −5 %; at −5 % Andrew reads
  at about 200 words a minute, which isn't calm. At −10 % the script averages about 160 words a minute.
- One clip per paragraph (P1 … P8, on the share page), read from `script/P1.txt` … `P8.txt` **word for word**,
  including P6's last sentence about Guided mode.
- Each click is timed to the word being spoken, using the voice's own word timings.
- Mixed to −16 LUFS (a normal online-video level). There's no music.
- The voice is AI text-to-speech. That's the only AI anywhere in this, and none of it is in the product.

## What's on screen, scene by scene

| # | Narration | On screen |
|---|---|---|
| 1 | Most trading systems… | Setup › Accounts with the guided card up. The cursor clicks beside the card to dismiss it, then switches `Guided` off so the per-screen cards don't cover the next scenes |
| 2 | The Ultimate Trading System searches… | Construct (it opens on Sweep, the last screen used) › Data; slow zoom to the MONTHS / FROM columns. Then Sweep, Boards, Funnel, Held ("a held set") and Reserve ("a reserve set"); zoom on Reserve's description, which mentions the four simpler things it is measured against |
| 3 | Only the survivors… | Greenlight; zoom on "Greenlight — the decision that a config is fit to trade" and the line under it; then zoom on the status line's release number |
| 4 | From there, it runs on paper first… | Trade › Paper Books: zoom on the FREE TRIAL notice and "No greenlighted configs yet". The cursor rests on Live Trading without clicking |
| — | (short pause) | Back to Setup, then `◐ Theme` switches to the light theme |
| 5 | And it runs on your machine… | Compute: Where each part runs → The sweep processor (HOMSSURF02, connected), then Accounts › Trading accounts |
| 6 | No AI in anything that runs… | Profile: `Enlarge font` twice (FONT SIZE 100% → 120%), zoom on Guidance, `Guided` back on, `Start fresh`, `Activate`, `Open` → the guided step box on Compute, `Next`, pull back |
| 7–8 | Find a trading rule… / ultimate-trading-system.com | End card: each line appears as it is spoken, then the site name |

Captions are word for word from your md: *Trust, or check.* · *Tested against "nothing" · held · reserve* ·
*Greenlight = frozen evidence* · *Paper first* · *Your keys, your machine* · *Deterministic · guided*.

## Shots that changed from the md

- **Release shown is 7.210.0, not 7.209.0.** The site moved to 7.210.0 while I was working (around
  07:47 UTC). The status line was filmed as it stood; it reads `Stage-engine check: NOT CHECKED`.
- **Both themes, more than one font size, and Guided switched off and on again** were added at your request.
  Scenes 5 and 6 are in the light theme; scene 6 changes the font size on screen.
- **The workflow wasn't re-picked from the list.** It was already set to the Compute workflow, so the
  cursor points at it instead of reopening the list.
- **The end card runs about 10 s, not 4 s,** because the last two lines take about 7.5 s to say.
- **Total length is 1:50, not about 90 s.** That's the calmer voice plus about 5 s of guided-workflow clicks
  after the narration ends.
- **A "Please wait" box shows for under a second when Funnel opens** (about 0:25). That's the site's own
  message while it redraws the page; it was left in.

## The trial account

Four takes were recorded and take 4 is the one used. After **every** take the script put the account back
and signed out:

- `Guided`: on, as found
- FONT SIZE: 100%, as found
- Theme on Setup: dark, as found (this setting is stored in the browser only, not the account)
- Guided workflow: Setup | Compute tab workflow, step 2 of 76 "Read it again", as found
- Nothing on Data was pressed apart from its tab; nothing was purged or trimmed; no other setting was touched

Every click checks first that the intended control is actually under the cursor; if anything else is
there, the click is refused. That check refused one click in take 2, where the page's top bar was
covering the target.

## A defect found along the way (not fixed — reported)

**`◐ Theme` is remembered separately on each tab.** Switching it on Trade turned Trade light, but Setup
and Construct stayed dark when opened next. The code saves the choice under a different name on each page
(`lt-theme` on Trade, `cx-theme` on Setup), so one switch doesn't carry across. I haven't changed anything;
it's yours to decide whether it should.

## Re-recording

`tools/` has everything: `tts.py` (voice), `take.js` (one recorded take on a virtual display), `cards.js`
(end card and captions), `compose.py` (cuts the scene recordings and builds the film). The scripts expect a
`work/` folder beside `tools/` for the voice clips and raw takes. They aren't kept here (about 580 MB),
so a re-shoot starts from fresh voice clips. The account to film is given at run time as `UTS_EMAIL` and
`UTS_PASSWORD`; no password is stored in the scripts.
