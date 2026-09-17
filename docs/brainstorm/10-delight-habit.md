# Brainstorm 10 — Delight, habit and craft identity

*Lens: does this feel like a craft companion or a spreadsheet? Written 2026-09-17 after ~30 min
on http://localhost:8765 at 375×812, counting a dragon through rounds, finishing parts and a
project, cycling all six themes, opening the 3D viewer, history, timer, status and settings.*

## How it feels today

The **moment-to-moment** is genuinely lovely: the tap button is huge and honest, auto-advance at
the pattern's stitch count is quiet magic, and the live 3D piece growing inside the button is the
single best thing in the app — the first time six stitches turned into a little cream cone I
actually smiled. The six themes are real identities, not palette swaps, and the copy has craft in
its bones ("Hibernating. Still on the home screen, just resting." / "Frogged — ripped back for
good. Kept for the record.").

The **around-it** is a spreadsheet. History is a flat list of 60 identical rows with clock times.
The finished shelf shows a completed dragon as `Spikes · Rnd 0 · 0 sts`. The finish sheet is one
sentence and a button. Every project's yarn is the same default cream `#f1e3c8`, every theme plays
the same 660 Hz triangle blip, and the "big" project celebration in the default theme (Stardrop
Night) is **seven** DOM particles while Pixel Wyrm gets twenty-five. Nothing you make here can
leave the phone as an image, and nothing in the app knows you crafted four evenings this week even
though every row already carries a timestamp.

So: the counting is a companion; the *remembering* is a ledger. Most of what follows is about
turning rows already logged into a story, and giving each project a colour and a face.

---

## Proposals, ranked by impact ÷ effort

### 1. Yarn colour is the project's identity, not a hidden setting
**Effort S · Impact 4**

*Problem.* `Store.yarnColorFor` / `setYarnColor` already exist and the 3D piece honours them —
but the only way in is the project screen → ⤢ 3D view → **Yarn colours**, three taps deep. I
counted a whole dragon without ever discovering it, so every screenshot I took is the same
`MAIN_YARN_DEFAULT` cream cone. A crocheter's first thought about a project is its colour.

*Proposal.* Add a **Yarn** row to the New/Edit project sheet, directly under the emoji grid: a
horizontal strip of ten preset skein swatches (cream, oatmeal, moss, dusty rose, mustard, teal,
charcoal, rust, lilac, off-black) plus a `<input type="color">` at the end for custom, writing
straight to `Store.setYarnColor(id, '*', hex)`. The chosen hex then shows as a 4px vertical bar on
the left edge of the home card and a 14px dot next to the project title in the header. The 3D
piece is that colour from stitch one.

*Risks.* Contrast: a very dark yarn on a dark theme makes the piece read as a silhouette in the
tap button — clamp the rendered material's luminance to a floor for the in-button render only, or
let the contact shadow carry the shape. Existing projects keep cream (no migration).

---

### 2. Make the count feel like a stitch, not a click
**Effort S · Impact 4**

*Problem.* The most-repeated interaction in the whole app — one tap, one stitch, thousands of
times — has almost no feedback beyond the number silently swapping. `css/app.css` gives
`.stitch-btn` a 0.05s transform/box-shadow on `.pressed` and a `sk-flash` keyframe reserved for
alerts; the number itself, the row number and the `Group 1 of 1 · stitch 4 of 10` line never move.
Next to the 3D piece quietly turning, the number feels like a form field.

*Proposal.* Three tiny CSS animations, all `transform`/`opacity` only:
- **stitch**: the number scales `1 → 1.06 → 1` over 110ms with a 40ms overshoot (`will-change:
  transform`), and the group text does a 3px upward nudge every `groupSize`-th tap.
- **row**: the big row number rolls up 12px and fades in from below over 220ms, and the progress
  bar fill gets one 400ms lightness pulse — the bar already has `transition: width 0.18s`, so the
  width and the pulse read as one motion.
- **piece/part done**: the part chip that just earned its ✓ pops once (scale 1.12, 180ms).

*Risks.* Motion sensitivity — all three go inside the existing
`@media (prefers-reduced-motion: reduce)` block that already neutralises `sk-flash`. Jank on a
mid-phone: keep to compositor-only properties and never animate `font-size` or layout.

---

### 3. The finished shelf should remember, not report
**Effort S · Impact 4**

*Problem.* I finished the dragon and the shelf card read
`🐉 Ember the dragon · FINISHED · Spikes · Rnd 0 · 0 sts · just now`. The card that should be the
emotional payoff of the entire app is showing the live counter summary of whichever part happened
to be open when it ended. The frogged sundress gets the same treatment.

*Proposal.* `Store.summaryFor` branches on `status`. For `finished`:
`Finished 17 Sep · 214 rounds · 8 pieces · 4h 12m` (rounds from `history.length`, pieces from
`Σ piecesDone`, time from `timer.totalMs`). For `frogged`:
`Frogged 12 Sep · 6h 20m — it happens.` Style the finished cards warmer than the active ones (a
`--success`-tinted left edge and the yarn swatch from #1), and title the section
**Finished shelf (2)** → **The shelf** with a one-line count of everything ever made underneath.

*Risks.* None functional. Watch the 375px width: the summary line already clips on the home card,
so this needs to be two lines, not one longer one.

---

### 4. Cosy mode after dark
**Effort S · Impact 3**

*Problem.* Three of the six themes are dark and three are light, but the app has no idea what time
it is. Evening crochet in Pelican Town Spring at full brightness with a 660 Hz blip at 0.28 master
gain, in a dark room, is the opposite of cosy — and switching themes just to dim is a six-tap trip
through Settings.

*Proposal.* A Settings toggle **Cosy mode after dark** with a simple from/to time (default
20:00–07:00, local, re-checked on `visibilitychange`). When active, `<html>` gets `.cosy`, which
applies `filter: brightness(.9) saturate(.96) sepia(.06)` to the app shell (explicitly *not* to
`.stitch-btn` or the 3D canvas, so the piece and the target stay readable), halves every
`navigator.vibrate` pattern, and drops `master.gain` from 0.28 to 0.18. A one-line toast the first
evening it fires: *"Cosy mode on — softer light, quieter taps."*

*Risks.* Contrast regressions against the 66 fixes already made in `docs/ux-sweep-2026-09-16.md` —
the filter must be measured, and `brightness()` on text over `--surface-2` is the case to check.
Some people will hate it: one toggle, off is off, and the toast never repeats.

---

### 5. Let the piece rest
**Effort S · Impact 3**

*Problem.* `js/diagram.js` `needsFrame()` returns true forever whenever `prefers-reduced-motion` is
off: the piece spins at a constant `ROT_SPEED` (12°/s) and the WebGL rAF loop never idles. With
**Keep awake** on — exactly the mode crochet is used in — that is an uninterrupted GPU loop for a
two-hour session. It also means the thing you are counting next to is always moving.

*Proposal.* Add an idle rest: 20s after the last tap/drag, ease `spinVel` to zero over ~1.2s and
park the piece face-on, then let `needsFrame()` return false. Any tap, drag or row completion
wakes it for 6s (reuse the existing `ROT_PAUSE` machinery). Expose it as a third state on the
existing **Live diagram** setting: *Always turning / Rests when idle (default) / Off*.

*Risks.* Some people love the constant turn — hence the setting, and "Always turning" keeps
today's behaviour exactly. Make sure the rest pose is the nicest angle (slightly off-axis, not
dead face-on) because it is now what people stare at for minutes at a time.

---

### 6. Hook, yarn and gauge as chips, not a notes blob
**Effort S · Impact 3**

*Problem.* Crochet's project-specific craft information is one free-text `notes` textarea. Cross
-stitch has fabric, count, floss and a stash; sewing has machine settings, presets and seam
allowances. Crochet — the flagship — has a paragraph.

*Proposal.* Three optional structured fields on a crochet project: **hook** (a stepper over the
standard mm ladder, 2.0–12.0), **yarn** (name + weight picked from lace/4ply/DK/aran/chunky), and
**gauge** (free text). They render as three small chips under the project title on the project
screen, carry into `templateFromProject`, and appear on the finished card (#8). `notes` stays for
everything else.

*Risks.* Scope creep toward a full stash app — keep it to the three fields that answer "what did I
use?" a year later. All optional; chips are hidden when empty so nothing gets busier for people
who do not fill them in.

---

### 7. A gentle nudge when the timer has been running alone
**Effort S · Impact 3**

*Problem.* The timer is a single cumulative `totalMs` with a `runningSince`, started from a header
chip, and **Keep awake** encourages leaving the phone propped up. Fall asleep and tomorrow's
"3h 40m" is a lie — and because it is one number, it can never be corrected except by editing the
whole project.

*Proposal.* If the timer is running and no row or stitch has been counted for 45 minutes, then on
the *next* focus (never a notification, never mid-session) show a calm sheet: *"The timer has been
running since 21:14, but the last stitch was at 21:31. Keep the time, or trim it to your last
stitch?"* with **Keep it** / **Trim to 21:31**. Nothing is ever changed without a tap.

*Risks.* Firing on a legitimately slow row (a colour change, frogging back, a complicated
assembly) — hence *offer*, never auto-trim, and 45 minutes is generous. One nudge per running
period.

---

### 8. The finished-object card you can actually send someone
**Effort M · Impact 5**

*Problem.* The finish moment is `openSheet({ title: 'All parts done! 🎉' })` with one sentence and
an **Assembly checklist →** button. There is no way to get anything out of this app as a picture.
People finish a project and immediately want to post it — that is the whole social loop of
crafting, and it currently happens entirely outside the app.

*Proposal.* A **Make a card** button on the finish sheet and on every finished shelf card. It
composes a 1080×1350 `<canvas>` offscreen: the theme's `--bg-image` pattern as a tiled backdrop in
`--bg`, a snapshot of the 3D piece (mount `Diagram` into a second, offscreen canvas created with
`preserveDrawingBuffer: true` — the live one is deliberately `false`, so this needs its own mount),
the project emoji + name in `--font-display`, a stats line *"214 rounds · 8 pieces · 4h 12m over
9 days"*, the theme's tagline in small caps at the foot, and a discreet *Thready or Not* mark.
Then `canvas.toBlob` → `navigator.share({ files: [file] })`, with `<a download>` as the fallback.
`js/app.js` already ships exactly this share-a-File path for the backup export, and
`app-xstitch.js` / `app-sewing.js` already call `canvas.toBlob(done, 'image/jpeg', 0.82)` — so the
plumbing is proven; this is composition work. No backend, no cost.

*Risks.* Memory on old phones for a 1080×1350 canvas plus a WebGL context — build it on demand,
revoke the blob URL, and downscale to 810×1013 if `toBlob` returns null. The 3D snapshot must wait
for one real frame; do not capture on the frame you mount.

---

### 9. Session stories instead of a row ledger
**Effort M · Impact 5**

*Problem.* The History sheet is the single most spreadsheet-like screen in the app: sixty
consecutive lines of `Horns · Rnd 9 — 3:21 PM`, newest first, and a **Clear history** button. It
holds everything needed for a story and tells none of it. Meanwhile the one number people actually
want — *how much did I craft this week* — does not exist anywhere, and cannot be computed from
`timer.totalMs` because it is a single lifetime total.

*Proposal.* Sessionise `project.history` on read with a 20-minute gap rule (no schema change, no
migration, works retroactively on every existing save). Rewrite the sheet as:

- A header card: **This week — 2h 14m · 96 rounds · 4 evenings.**
- Day groups, newest first: *Tue 16 Sep · 2 sessions · 1h 12m · 34 rounds — Body, Head*, each
  expandable to the individual rows that are shown today.
- A per-session sparkline of rows-per-10-minutes, 40px tall, drawn as a single inline SVG
  `<polyline>` — it reads instantly as "I got into a rhythm about twenty minutes in".
- The same sessioniser, run across *all* projects, feeds the home screen (#12 and #16).

*Risks.* The 500-entry history cap means long projects lose their early weeks — worth raising to
2000 (≈60 KB of JSON) now that it earns its keep, or storing a per-day rollup alongside. Gap rule
is a guess: 20 min is right for crochet, probably too short for sewing steps — make it per-craft.

---

### 10. Celebrations proportional to what you actually did
**Effort M · Impact 4**

*Problem.* `Celebrate.play` has exactly two tiers: `big = kind === 'project'` (3000ms) and
everything else (1200ms). A 6-round ear and a 120-round body get the identical 1.2s puff. Worse,
the tiers are wildly uneven *between* themes — I counted the DOM particles at peak:

| theme | project | part |
|---|---|---|
| stardew-spring | 21 | 10 |
| stardew-night | **7** | **3** |
| stardew-harvest | 14 | 6 |
| dragon-fury | 10 | 5 |
| dragon-throne | 20 | 6 |
| dragon-pixel | 25 | 13 |

Stardrop Night is the *default theme for new installs*, and finishing a whole dragon in it spawns
seven elements. On a 375px screen that is very close to nothing happening.

*Proposal.* Extend the API to `Celebrate.play(themeId, { kind, weight })`, `weight` 0–1, computed
by the caller from the part's `targetRows` against the project's largest part (`applyResult` in
`js/app.js` already has both to hand). Particle count and duration interpolate:
a `weight: 0.05` ear gets a 700ms, 3-particle puff near the part chip; a `weight: 1` body gets
1.8s and 16 particles; `kind: 'project'` always lands at the top. Then **normalise every theme** so
a project finish is 24–30 particles and a part finish is 8–12, keeping each theme's own species —
Night Fury gets more plasma sparks, Stardrop Night gets a real shower of stardrops.

*Risks.* Particle count is the battery and jank lever — 30 absolutely-positioned divs animating
`transform`/`opacity` is fine, 100 is not. Keep the reduced-motion path exactly as it is (fade
only, no count scaling).

---

### 11. Give the tap a voice
**Effort M · Impact 4**

*Problem.* `js/audio.js` plays the same sounds for all six themes: `tap()` is one 660 Hz triangle
at 45ms, `group()` a fixed 880→1174 pair, `done()` a fixed C-E-G-C arpeggio. Six worlds with six
mascots and six palettes all beep identically, and the beep is a *UI* beep — a pure oscillator,
the sound of a microwave, not of wool. `done()` is also literally identical for a finished ear and
a finished dragon.

*Proposal.* Two changes, both inside `js/audio.js`:
1. **Per-theme palettes.** A `PALETTES[themeId]` table of `{ wave, baseHz, filterHz, noise }`.
   The soft themes (spring, harvest) use a short filtered *noise* burst — a 30ms
   `AudioBufferSourceNode` of white noise through a lowpass at ~900 Hz reads as a wooden click or
   a yarn rustle rather than a tone, and is ~25 lines. Night Fury gets a soft sine with a long
   tail, Fire & Blood a low struck-bell, Pixel Wyrm keeps square waves and *should* sound like a
   Game Boy. Stardrop Night gets a glassy triangle with a touch of detune.
2. **A group that climbs.** Pitch each tap at `base * 2^((stitchInGroup / groupSize) * 7/12)` so
   the ten taps to a group boundary walk audibly up a fifth and resolve on the `group()` chime.
   You can hear that you are at eight of ten without looking down — which is the entire point of
   counting by ear. Add ±8 cents of random detune per tap so a hundred stitches do not sound like
   a machine.

*Risks.* Noise buffers must be generated once and reused, never per tap. Keep peak gain where it
is; a climbing scale that also gets louder is fatiguing. Everything stays behind the existing
`sounds` setting.

---

### 12. A shelf, not a list
**Effort M · Impact 4**

*Problem.* The home screen is one-line rows on a large empty field — at 375×812 with one project,
roughly 85% of the screen is background pattern. Nothing shows how far along anything is
(the crochet summary is `Body · Rnd 5 · 0 sts`; only sewing shows a percent), and the craft glyph,
emoji and status pill are the only visual differences between a fresh cast-on and a nearly
finished blanket.

*Proposal.* Two-up card grid at ≥360px. Each card: yarn swatch as the card's top edge (#1), emoji,
name, a **project** progress bar (`Σ completed rows ÷ Σ targetRows` over parts that have targets —
the same rule `tapRow` already uses to decide `projectDone`), the craft glyph, and the summary
line demoted to muted small text. The **Finished shelf** becomes a horizontally scrolling strip of
square thumbnails (the piece snapshots from #14 where they exist, the emoji on a yarn-coloured
tile where they do not) — an actual shelf you scroll along.

*Risks.* Two-up at 375px means ~170px cards; the name will truncate on long project names, so
allow two lines and clamp. Do not compute the progress bar for crafts that do not have `parts` —
route it through `Store.summaryFor`'s existing craft hook so cross-stitch and sewing supply their
own fraction.

---

### 13. A 3D piece that knows which world it is in
**Effort M · Impact 4**

*Problem.* I switched all six themes with the viewer open. The background, borders, fonts and
buttons all transformed — and the piece inside stayed the *exact same* smoothly-shaded cream cone
every time. In Pixel Wyrm, a theme built on `image-rendering: pixelated`, 4px hard borders and
`radius: 0`, there is a soft anti-aliased gradient blob sitting in the middle of the screen. It is
the one element that breaks every theme's spell.

*Proposal.* One `u_style` uniform plus one render-target swap in `js/diagram.js`, driven by the
theme id:
- **dragon-pixel**: render at 112px into an FBO and blit up with `NEAREST`, and posterise the
  light ramp to three bands. Instantly, unmistakably 8-bit, for maybe 30 lines of GLSL.
- **dragon-throne**: a warm gold rim light and a slightly waxy specular — a piece on a parchment
  table.
- **dragon-fury**: a cool plasma-blue rim, matching the celebration's glow.
- **stardew-night**: a faint cool ambient and a stronger contact shadow, so the piece sits in the
  dark rather than floating in it.
- spring/harvest keep today's soft daylight look, which is already right for them.

*Risks.* A sixth shader permutation is a maintenance and compile-time cost — express it as
uniforms on one program, not six programs. Verify the pixel path on a mid-phone GPU; an FBO
round-trip per frame is cheap at 112px but must not be done at full resolution.

---

### 14. Keep the pieces you made
**Effort M · Impact 4**

*Problem.* This is the sharpest emotional miss I found. You spend an hour watching a shape build
up in 3D, the part completes, the chip gets a ✓ — and the piece is gone. Switch to Head and you
are back to an empty button. Everything you built is reduced to a tick mark. By the end, a dragon
that took eleven parts has produced zero artefacts.

*Proposal.* On `pieceDone` and `partDone`, snapshot the diagram canvas to a 256px JPEG (q 0.8,
≈12–18 KB) and store it in **`js/blobstore.js`** — the IndexedDB wrapper already built and tested
for chart page images. Add a **Pieces** entry to the ⋯ menu: a grid of the pieces you have made,
each captioned `Wing 2 of 2 · 24 rounds · 41m`. Reuse the grid as a filmstrip along the bottom of
the finished-object card (#8), so what you share is *"here are the eleven pieces this dragon is
made of"* — which is exactly the picture crocheters actually post.

*Risks.* Storage — cap at 24 per project, oldest evicted, and say plainly in the UI that these
live on this device only (the same wording already used for chart images; the backup JSON does not
carry BlobStore, which is known item 10 in HANDOFF). Capture needs a `preserveDrawingBuffer` mount
or a `gl.readPixels` on the frame of completion; do it once, off the critical path, after the
celebration starts.

---

### 15. Frogging deserves a moment too
**Effort S · Impact 2**

*Problem.* The status sheet contains the best writing in the app — *"Frogged. Ripped back for
good. Kept for the record."* — and choosing it does precisely nothing but change a pill from
`ACTIVE` to `FROGGED` and move the card down. Ripping back a month of work is one of the most
emotionally loaded things that happens in crafting, and the app treats it as a dropdown value.

*Proposal.* Choosing **Frogged** plays a 900ms inverse celebration: the theme's particles fall
*down* out of frame and one thin yarn line unravels across the screen. The confirm copy
acknowledges the time rather than hiding it: *"6h 20m of work. The yarn is yours again."* The
shelf card keeps the hours visible. `Celebrate` needs one new kind and each renderer a reversed
path — or, cheaper, one shared unravel renderer tinted with `--accent`.

*Risks.* Getting the tone wrong — this must read as kind, never as a joke or a penalty. No sound
beyond `Feedback.undo()`'s falling two-note, which is already exactly right.

---

### 16. Craft days, without the shame
**Effort M · Impact 3**

*Problem.* There is no habit surface at all — `grep` for streak/daily/reminder across `js/` returns
nothing. Crafting is a slow daily practice and the app has no memory of it. But the obvious
version (a streak with a flame that resets to zero and turns red) is precisely wrong for a hobby
whose whole appeal is that it is not a performance.

*Proposal.* A single 40px strip under the home header: the last 14 days as small yarn-ball dots,
filled on days with any completed row anywhere (from the cross-project sessioniser in #9), hollow
otherwise. One line of copy that is *only ever* additive: **"You've crafted 6 of the last 14
days."** Never "streak", never "lost", never red, no target, no notification. Tapping a dot opens
that day's session story. A **Hide the strip** item in Settings for people who want none of it.

*Risks.* Guilt is the entire risk, and it is a real one — a row of hollow dots after a hard
fortnight is a reproach. Mitigations: cap at 14 days so it never looks like a long failure, never
render a "best streak" number, and consider hiding the strip entirely when the count is 0 or 1
rather than showing an empty row.

---

### 17. Where the hours actually went
**Effort M · Impact 3**

*Problem.* `timer` is `{ totalMs, runningSince }` on the project — one lifetime number. It can
never answer the question every crocheter asks: *how long did the wings take?* The header chip
showed `2:14:00` all session with no breakdown, and the part editor has no notion of time at all.

*Proposal.* Add `msByPart: { [partId]: number }` to the timer object, incremented on part switch,
timer stop, `visibilitychange` and `pagehide` (all four flush points already exist for `save()`).
Then: the part editor shows **"Wings · 2 made · 1h 04m"**; the part tabs get an optional time
readout; and the finished-object card can say which piece ate the project. An occasional, gentle
toast on `pieceDone` when a repeat beats the last one: *"Leg 4 in 22m — your quickest yet."*

*Risks.* Migration: old saves have no `msByPart`, so every derived figure must degrade to "—"
rather than 0h. The "quickest yet" toast tips into competitive framing if it fires often — once
per part at most, and never a *slower* comparison.

---

### 18. One family, three textures: a shared progress spine
**Effort M · Impact 3**

*Problem.* Crochet's progress lives in a round counter and a bar; sewing shows `Step 1 of 15 · 0%`
in small text above the step card; cross-stitch shows tallies per colour. Each is sensible alone,
but opening one after another they do not feel like the same app — and switching crafts loses you
the one thing you had learned to read at a glance. (Small live-region bug seen in passing: opening
a sewing project announced *"Round 0"* — known as the "one announcement policy" item.)

*Proposal.* One shared component pinned under the header of all three craft screens: a 6px spine
with the craft glyph, the percent fill in `--accent-2`, and the craft's *own* noun to its right —
`Rnd 12 of 40` / `Step 3 of 15` / `1 204 of 8 900 stitches`. Same geometry and same colour rules
everywhere; different vocabulary. Each craft module supplies `{ fraction, label }` through the
existing `Store.summaryFor` hook, so the shell owns none of the craft logic.

*Risks.* Vertical space — the counter already overflows below ~700px tall (known UX-sweep item),
so this has to replace existing chrome rather than stack on top of it. Cross-stitch's denominator
can be huge; abbreviate to `1.2k of 8.9k` under 400px.

---

### 19. Let the mascots and taglines into the app
**Effort S · Impact 2**

*Problem.* Each theme ships a hand-drawn `--mascot` SVG and a tagline (*"Counting under the
stardrops"*, *"8-bit hoard of yarn"*). The mascot appears as a static 64px decoration in the top
bar and the empty state; the tagline appears **only** inside the Settings theme grid, which most
people will open once. Six characters with nothing to do.

*Proposal.* Three cheap appearances: the mascot bobs once (150ms, `transform` only) on a part
finish; it is the hero of its own theme's project celebration (spring and night already do this —
harvest, fury, throne and pixel should too); and the theme's tagline appears in small caps on the
finish sheet and the shared card, under the project name, so the world you chose signs off your
finished object.

*Risks.* Trademark — HANDOFF item 11 already flags renaming the IP-referencing themes and
redrawing two mascots before launch. Giving the mascots a larger role *raises* that cost, so this
one is best done after the redraw, not before.

---

### 20. Seasonal touches, not seasonal themes
**Effort M · Impact 2**

*Problem.* Six themes is already the right number; a seasonal theme would be a seventh thing to
maintain and would fight with the choice people have made. But a craft app in December with no
idea it is December is missing an easy warmth, and Harvest Festival already proves the appetite.

*Proposal.* A `--season` overlay layer rather than new themes: by month, swap `--bg-image` for a
variant of the *current* theme's pattern (snowflakes woven into Stardrop Night's stars in
Dec–Jan, blossom in the spring theme in April) and add one seasonal particle species to
`Celebrate`. Roughly six small data-URI patterns and six particle SVGs, behind a
**Seasonal touches** setting, default on. The pixel theme gets pixel snow, which is worth doing on
its own.

*Risks.* Northern-hemisphere assumption — either a hemisphere toggle or (better) name the moods
by feel rather than season. Keep it to background and particles; never touch `--primary` or the
text colours, or every contrast decision has to be re-verified twelve times.

---

## What I'd do first

If only three things ship: **#8 the shareable finished card** and **#9 session stories** are the
two that change what this app *is* — they turn a counter into something with a memory, and both
run on data already in the save file with no backend and no per-user cost. Pair them with **#1
yarn colour**, which costs almost nothing and makes every screenshot from now on look like
somebody's project rather than a demo.
