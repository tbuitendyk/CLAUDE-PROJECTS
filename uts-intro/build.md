# uts-intro — build notes

## Version 2 — `uts-intro-v2.mp4` (new voice)

**Result:** `uts-intro-v2.mp4`, 1920×1080, 30 fps, H.264 + AAC, **1:54** (114.2 s), 15.9 MB.
Same script, same shots, same captions and end card as version 1, with a more natural voice and a fresh take
(filmed on Release 7.211.0) so every click lines up with the new voice's own timing.

**Voice: Kokoro-82M, voice `af_heart` (American English, female), at 85 % speed**, about 155 words a minute.
Kokoro is an open-source model (Apache 2.0) that runs on this machine; nothing was sent to a voice service.

How it was chosen: the long second paragraph was spoken by 14 candidates and each was scored two ways.
The first was UTMOS, a model trained to predict how human listeners rate naturalness, scored out of 5.
The second was Whisper, which heard every word correctly for every candidate.

| Voice | Naturalness (UTMOS, out of 5) |
|---|---|
| **Kokoro `af_heart`, 85 % speed — used** | **4.55** |
| Kokoro `am_fenrir` (best male voice), 80 % speed | 4.52 |
| Microsoft `en-US-AvaMultilingualNeural` | 4.47 |
| Microsoft `en-US-AndrewNeural`, −10 % — version 1 | 4.39 |
| Chatterbox (Resemble AI), default voice | 4.13 |

Kokoro also ranks top among open voices that run without a graphics card in public blind listening
tests. Chatterbox was also tried; it rates lower and takes about 8 seconds of computing for every second of speech here.
Fish Audio rates higher, but its licence rules out commercial use.

If you'd rather have a male voice, Kokoro `am_fenrir` scored almost the same, and switching is one re-run.

Each narration clip was checked by speech recognition: every word came out as written.

The trial account was found with `Guided` **off** this time. It was switched on only for filming, so the
opening card shows, and put back to off afterwards, along with FONT SIZE 100%, the dark theme and the guided
workflow at step 2 of 76. The take now records what it finds and puts back exactly that.

New scripts: `tools/ktts.py` (Kokoro voice with word timings), `tools/score.py` (naturalness and accuracy
scores).

---

## Version 1 — `uts-intro.mp4`

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
| 7–8 | Find a trading rule… / ultimate trading system dot com | End card: each line appears as it is spoken, then the site name, written ultimate-trading-system.com |

Captions are word for word from your md: *Trust, or check.* · *Tested against "nothing" · held · reserve* ·
*Greenlight = frozen evidence* · *Paper first* · *Your keys, your machine* · *Deterministic · guided*.

## Shots that changed from the md

- **Release shown is 7.210.0, not 7.209.0.** The site moved to 7.210.0 while I was working (around
  07:47 UTC). The status line was filmed as it stood; it reads `Stage-engine check: NOT CHECKED`.
- **Both themes, more than one font size, and Guided switched off and on again** were added at your request.
  Scenes 5 and 6 are in the light theme; scene 6 changes the font size on screen.
- **The workflow wasn't re-picked from the list.** It was already set to the Compute workflow, so the
  cursor points at it instead of reopening the list.
- **The last line is spoken as "ultimate trading system dot com"** (your request after the first cut), not read
  out with its dashes. The end card still shows the written address, ultimate-trading-system.com.
- **The end card runs about 10 s, not 4 s,** because the last two lines take about 6.5 s to say.
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
