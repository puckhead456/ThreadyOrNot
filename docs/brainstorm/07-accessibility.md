# Brainstorm 07 — Accessibility and inclusive design

*17 September 2026 · audited against cache v20 at `http://localhost:8765`, service worker and
caches cleared first, viewport emulated at 375×812.*

**Method.** Three projects seeded (crochet Sheep template, a 6-colour cross-stitch project, a
sewing project). Contrast computed in-page from `getComputedStyle` with a relative-luminance
helper that composites each element's own background over its ancestors — not eyeballed, not
from the theme file. Announcements captured with a `MutationObserver` on `#live-region` and
`#toasts` while driving the real controls. Tab order walked with real `Tab` key presses. Target
geometry and overlap from `getBoundingClientRect`. Text scaling tested by setting
`documentElement.style.fontSize = '200%'` and re-scanning every box. WCAG 1.4.12 tested with the
standard text-spacing override. Every number below is measured.

**Who this is for.** Crafters skew older. The counter is used one-handed, often with the phone
propped across the room, often by people with presbyopia, arthritis, tremor, colour-vision
deficiency, or a screen reader. The app is already unusually careful — the September UX sweep
fixed 66 findings and the sheet layer is genuinely clean (see "Clean, for the record" below).
What is left is not polish: **the app's core loop is mute and valueless to assistive tech.**

---

## Measured WCAG 2.2 AA failures

| # | Criterion | Element | Theme(s) | Measured | Needs |
|---|---|---|---|---|---|
| 1 | 1.4.11 Non-text Contrast | `#stitch-3d` ⤢ glyph — `color: var(--primary-text)` on `rgba(0,0,0,.55)` over `--primary` | dragon-pixel | **1.81:1** (`#0f0f1e` on `rgb(115,35,49)`) | 3:1 |
| 1 | 1.4.11 | same | dragon-fury | **2.53:1** (`#0e1512` on `rgb(55,95,61)`) | 3:1 |
| 2 | 2.4.11 Focus Appearance | global `:focus-visible { outline: 3px solid var(--accent-2); outline-offset: 2px }`, ring drawn on `--surface-2` | dragon-throne | **1.77:1** | 3:1 |
| 2 | 2.4.11 | same, on `--surface-2` | stardew-spring | **1.96:1** | 3:1 |
| 2 | 2.4.11 | same, on `--surface` | spring, throne | **2.19:1** | 3:1 |
| 2 | 2.4.11 | `.seg button.on:focus-visible` — `box-shadow: inset 0 0 0 3px var(--accent-2)` directly on the `--primary` fill | fury **1.25**, harvest **1.69**, spring **2.07**, pixel **2.23**, night **2.94** | 5 of 6 fail | 3:1 |
| 3 | 4.1.2 Name, Role, Value | `#row-number` (`<div class="big-number">`) and `#stitch-number` (`<span>`) carry the app's two primary values with no role and no programmatic value. `#stitch-btn` has a **static** `aria-label="Count a stitch"` which suppresses its own inner "STITCHES / 0 / tap" text | all | 5 taps: number 0→5, `aria-label` unchanged, **0 announcements** | value exposed |
| 4 | 4.1.3 Status Messages | Counting is silent. Measured: crochet row +1 → `"Round 1"`, `"Round 2"`; crochet stitch ×5 → **nothing**; crochet −1 → **nothing**; cross-stitch tap ×25 → **nothing** (policy is every 100th); sewing block bump → announces every time. Undo produces a visual toast only, and `#toasts` is `aria-live="polite"` with no `role="status"` | all | three different policies for the same gesture | one policy |
| 5 | 2.4.3 Focus Order | `#stitch-3d` sits visually at (309, 305) — inside the tap button — but is DOM-last in `.stitch-section`. Real Tab walk: `row-plus` → `stitch-btn` → `stitch-minus` (y 690) → `stitch-reset` (y 691) → **⤢ (y 305)** | all | order ≠ meaning | match visual order |
| 6 | 1.4.4 Resize Text *(mechanism)* | **167 of 167** `font-size` declarations in `css/app.css` (93), `css/xstitch.css` (36) and `css/sewing.css` (38) are `px`; **zero** `rem` or `em`. Setting `documentElement.style.fontSize='200%'` produced a byte-identical layout scan — 0 px delta on every box | all | OS/browser text-size setting is inert | root-relative type |

Not a failure but worth recording: `#stitch-3d` is a 44×44 modal-opening control at (309, 305)
that is **fully inside** `#stitch-btn`'s 347×357 rect at (14, 297) — 1.6 % of the tap surface,
in the top-right corner where a right thumb naturally rests against the phone.

**Clean, for the record.** Sheets are `:modal`, carry `aria-labelledby`, and put initial focus on
Close. Settings toggles are `role="switch"` with correct `aria-checked`. Hidden screens are
genuinely `hidden` (`display:none`), not merely visually hidden. No unnamed and no sub-44 px
interactive element on the crochet counter. The viewport meta has no `user-scalable=no` or
`maximum-scale`, so pinch-zoom works. WCAG 1.4.12 Text Spacing passes: under the standard
override only `.p-name` clips (172 px into 146 px), which is the already-known name-truncation
issue. `js/celebrate.js` has a real `prefers-reduced-motion` branch with a fade-only path, and
the blanket CSS rule now covers delays. `XStitch.symbolInk` puts only **13 of 454** DMC colours
below 4.5:1, worst DMC 3607 Plum Light `#c54989` at **4.22:1** — 2.9 %, genuinely minor.

---

## Proposals, ranked by impact ÷ effort

### 1. Speak the count — one announcement policy, three crafts
**Problem (measured).** Five taps of `#stitch-btn` moved the number 0→5 and produced zero
entries in `#live-region`; `aria-label` stayed `"Count a stitch"` throughout. Twenty-five taps of
`#xs-stitch-btn` produced zero announcements (cross-stitch announces every 100th). Sewing
announces every block. Crochet announces rows (`"Round 1"`) and never stitches. A blind or
low-vision crafter tapping the app's primary control gets nothing back.
**Proposal.** One `C.count(kind, value, total)` helper in `js/app.js` used by all three crafts.
Policy: announce **every** row/step/block change; announce a stitch **on group boundaries, on
the target, and on the first and last of a row**, otherwise stay quiet — and always after 1.2 s
of silence, so a burst of taps yields one summary ("12 of 24, round 7") rather than twelve.
Debounce inside `announce()` so the existing 30 ms clear/write race (A19) cannot drop it.
**Effort** M · **Impact** 5 · **Risks** Over-announcing is worse than silence; the debounce
window needs a real-device test with VoiceOver, where a trailing announcement can interrupt
the next tap's own feedback.

### 2. Give the two big numbers a value, and the tap button a live name
**Problem (measured).** `#row-number` and `#stitch-number` are a bare `<div>` and `<span>`.
`#stitch-btn`'s static `aria-label="Count a stitch"` **overrides** the "STITCHES 0 tap" it
contains, so the current stitch count is not reachable from the button at all — a screen-reader
user must find `#stitch-readout` separately. Cross-stitch already does this correctly:
`"Mark a stitch of 310 · Colour 310, 25 done"`.
**Proposal.** Copy the cross-stitch pattern into crochet: `aria-label` on `#stitch-btn` becomes
`"Count a stitch — 12 of 24, round 7"`, rebuilt on every change. Wrap the counter card in
`role="group"` with `aria-label="Round 7 of 24"`, and give `#row-number` / `#stitch-number`
`role="status"` so a value change is observable without a separate live region. Give
`.progress .bar` `role="progressbar"` + `aria-valuenow`/`valuemax` (currently none).
**Effort** S · **Impact** 5 · **Risks** A changing `aria-label` on a focused button re-announces
on some screen readers and not others; pair it with proposal 1 rather than relying on it.

### 3. Fix the focus ring so it is visible on the buttons that matter
**Problem (measured).** The global ring is `--accent-2`, which is `#e6a23c` in spring and
`#c9a227` in throne. Measured against the surface it is actually drawn on: **1.96:1** on
`--surface-2` (spring), **1.77:1** (throne), 2.19:1 on `--surface` in both. The `.seg` inset
variant sits directly on a `--primary` fill and measures **1.25:1** (fury), 1.69 (harvest),
2.07 (spring), 2.23 (pixel), 2.94 (night) — five of six themes. WCAG 2.2 2.4.11 wants 3:1.
**Proposal.** A dedicated `--focus-ring` token per theme, chosen for ≥3:1 against that theme's
`--surface`, `--surface-2` **and** `--primary`, plus a two-tone ring (`outline` in `--focus-ring`
with a 1px `box-shadow` in the opposite lightness) so it survives any background it lands on.
Add the check to the same in-page helper this audit used so it cannot regress.
**Effort** S · **Impact** 4 · **Risks** `--accent-2` is the theme's identity colour in five of
six themes; a separate token means the ring no longer matches the palette in some themes. That
is the right trade.

### 4. Global key and pedal shortcuts for count / undo / row
**Problem (measured).** `grep` finds **no** `document`- or `window`-level `keydown`/`keyup`
handler in `js/app.js`, `js/app-xstitch.js` or `js/app-sewing.js`. Counting by keyboard requires
`#stitch-btn` to hold focus — and clicking a part tab drops `document.activeElement` to `BODY`
(measured), so focus is routinely lost. A Bluetooth page-turner pedal — the standard arthritis
and tremor workaround, and it presents as a keyboard — therefore cannot drive the counter.
**Proposal.** One document-level handler, active on the counter screens, ignoring events whose
target is an input/textarea/contenteditable: `Space` / `ArrowRight` / `PageDown` = count,
`ArrowLeft` / `PageUp` = −1, `Enter` = complete row/step, `Ctrl+Z` = undo. Document the pedal
mapping in the FAQ. This also gives switch-access users a second route that does not depend on
scanning to the right button.
**Effort** S · **Impact** 4 · **Risks** Space also activates whatever button holds focus — the
handler must not double-count; guard on `event.target === document.body` or on the screen's own
container.

### 5. Root-relative type so the OS text-size setting works
**Problem (measured).** 167 of 167 `font-size` declarations are `px`. `documentElement.style.
fontSize='200%'` changed nothing: identical box scan before and after, 0 px delta, no clipping,
no overflow — because nothing scales. Chrome for Android's *Accessibility → Text scaling* slider
and the browser's default-font-size preference are exactly the mechanism older low-vision users
reach for, and the app is inert to both. Page zoom and pinch still work, so this is not a hard
1.4.4 failure, but it is the one that bites in practice in an installed PWA.
**Proposal.** Set `html { font-size: 100% }` and convert the ~167 declarations to `rem` via a
mechanical pass (`px / 16`). Keep the counter glyphs on `--counter-size` (already a single
variable at `96px` — see proposal 6). Re-run the text-spacing and overflow scan afterwards; the
current layout has zero clipping headroom problems, so it should absorb 125–150 % cleanly.
**Effort** M · **Impact** 4 · **Risks** A wholesale unit change can shift the counter layout,
which L1 of the UX sweep only just brought to zero overflow at 375×812. Do it with the overflow
scanner running.

### 6. Big-count mode
**Problem.** Crafters count with the phone propped on a table or across the room. The row number
is `--counter-size: 96px` and the stitch number `calc(var(--counter-size) * 1.15)` = 110 px —
legible at arm's length, not at two metres. Nothing in Settings changes it, and (see 5) the OS
text-size setting does nothing.
**Proposal.** A Settings toggle that raises `--counter-size` to ~168 px, hides the parts strip
and the pattern line, and grows the tap button to fill the freed height — a mode, not a zoom, so
the layout stays deliberate. `--counter-size` is already a single CSS variable used in exactly
two rules, so the type half of this is a one-line change.
**Effort** S · **Impact** 4 · **Risks** At 168 px a four-digit stitch count needs the
`counter-row` to reflow; cap it or drop to 140 px past 999.

### 7. Move the ⤢ 3D button out of the tap surface, and into the right tab stop
**Problem (measured).** `#stitch-3d` is 44×44 at (309, 305). `#stitch-btn` is 347×357 at
(14, 297). The ⤢ is **entirely inside** the tap button — 1.6 % of its area, in the top-right
corner where a right thumb rests. A tremor or large-thumb mis-tap opens a modal 3D viewer
mid-count. It is also DOM-last, so a Tab walk reaches it after `reset stitches` at y 691
(measured: `row-plus` → `stitch-btn` → `stitch-minus` → `stitch-reset` → ⤢).
**Proposal.** Move it into `.stitch-actions` beside `−1` and `reset stitches` as a labelled
control ("3D view"), which fixes the overlap, the focus order and the 1.4.11 glyph contrast in
one edit (on `--surface-2` it can use `--text`). If the corner placement is worth keeping, at
minimum reorder the DOM and require a deliberate press (hold, or a `pointerup` inside 12 px with
no prior movement — the same gesture guard `js/diagram.js` already implements for the swipe).
**Effort** S · **Impact** 3 · **Risks** The ⤢ overlay is a nice discovery affordance; moving it
makes the 3D view less discoverable. Mitigate with a one-time tour beat.

### 8. Fix the ⤢ glyph contrast in the two dark-`--primary-text` themes
**Problem (measured).** `.stitch-3d { color: var(--primary-text); background: rgba(0,0,0,.55) }`
assumes `--primary-text` is white. It is white in four themes (12.26–13.68:1 over the scrim) but
**dark** in dragon-fury (`#0e1512`) and dragon-pixel (`#0f0f1e`), giving **2.53:1** and
**1.81:1** against the composited scrim. The UX sweep's C5 fix (scrim .22 → .55) made it worse in
exactly those two themes, because a darker scrim moves toward the glyph colour, not away.
**Proposal.** Hard-code `color: #fff` on `.stitch-3d` — the scrim is black-based, so white is
correct in all six themes regardless of theme tokens. Or fold it into proposal 7 and the problem
disappears. Add a rule to the contrast checker: *no token-driven colour on a fixed-colour scrim.*
**Effort** S · **Impact** 3 · **Risks** None; `--primary-text` was never the right token here.

### 9. Focus-preserving rerender with an announcement
**Problem (measured).** Clicking a part tab leaves `document.activeElement === BODY` and
announces nothing. A screen-reader or switch user who changes part loses their place in the
page and gets no confirmation which part is now current. The same is true of every `rerender()`
in all three crafts (sweep finding A15, still open).
**Proposal.** A `withFocus(fn)` helper in `js/app.js`: record `document.activeElement`'s stable
key (id, or `data-focus-key` on generated rows) before the rebuild, restore it after, and fall
back to the nearest surviving ancestor. Pair it with an `announce()` of the new state
("Head — round 3 of 18, current part"). One helper, then a mechanical adoption per craft.
**Effort** M · **Impact** 4 · **Risks** Restoring focus to a node that no longer exists must
degrade to the container, not to `<body>`; get the fallback right or this makes things worse.

### 10. Voice control: "next row", "undo", "how many"
**Problem.** Hands are full of yarn, hook and project. Arthritis makes repeated precise taps
painful; tremor makes them unreliable. `SpeechRecognition` and `speechSynthesis` are both
available in this environment (verified: `{rec: true, synth: true}`) and both run on-device in
Chrome and Safari — **no network, no token cost**, which fits the project's hard rule.
**Proposal.** A mic toggle beside Awake on the counter bottom bar. A tiny grammar —
"next" / "next row" / "row", "stitch", "back" / "undo", "how many" / "where am I" (answered
through `speechSynthesis`), "reset stitches" behind a confirmation. Continuous recognition with
a visible listening state and a hard off; never auto-start. Ship it as an opt-in labelled
experimental, and pair it with the Awake toggle so the screen does not sleep mid-session.
**Effort** L · **Impact** 4 · **Risks** iOS Safari's `SpeechRecognition` support is uneven and
may route audio to a server on some platforms — gate on a capability check *and* say plainly in
the UI what runs where, or the no-cloud promise is broken. Battery drain with Awake on. False
positives from a TV in the room; require a short wake word or a push-to-talk press.

### 11. Speak the count aloud (not just to the screen reader)
**Problem.** Proposals 1 and 2 serve screen-reader users. A far larger group — low vision
without a screen reader, and anyone counting with their eyes on the yarn — gets nothing but a
number they cannot read from arm's length and a buzz that carries no information.
**Proposal.** A "Say the count" setting using `speechSynthesis` (on-device, free): speak the row
number on every row, and the stitch count at group boundaries and on target. Reuses the exact
policy from proposal 1, so it is a second sink on the same event. Respect the existing `sounds`
setting as a master switch and add its own volume-independent toggle.
**Effort** S · **Impact** 3 · **Risks** Speech latency on low-end Android can lag a fast tapper;
cancel the pending utterance on each new one. Voice quality varies wildly by device.

### 12. Informative haptics instead of one global on/off
**Problem (measured).** `Store.settings()` exposes `haptics: true` and `sounds: true` — two
booleans, nothing more. `js/audio.js` does own `navigator.vibrate` patterns, but the user cannot
choose *what* buzzes. For a crafter counting by feel with the screen off or across the room, the
buzz is the primary channel and it is undifferentiated.
**Proposal.** Distinct, learnable patterns: one short pulse per stitch, a double pulse at each
group boundary, a long pulse at row complete, a triple at a stitch alert. Expose them in
Settings as three independent switches (stitch / group / row) with a "try it" button, plus a
strength choice. Same event plumbing as proposal 1.
**Effort** S · **Impact** 3 · **Risks** `navigator.vibrate` is unsupported on iOS Safari, so
this is Android-only and the Settings copy must say so rather than offering a dead toggle.

### 13. A keyboard path for the chart canvas
**Problem.** Still open from the sweep (D1): `js/app-xstitch.js` gives the chart canvas
`role="img"` and `aria-label="Chart"` while it handles `pointerdown`, wheel zoom, pinch,
drag-paint, 10×10 and the eraser. Marking a specific square is pointer-only. The label never
changes with the current colour or progress. This audit adds that the `role="img"` is itself
wrong for an interactive surface.
**Proposal.** `tabindex="0"` + `role="application"` + `aria-roledescription="chart"`. A visible
cursor square; arrows move it, `Home`/`End` jump to row/column ends, `PageUp`/`PageDown` move ten,
Space marks, `Shift`+arrows drag-paints, `Delete` erases. `aria-activedescendant` onto an
off-screen `.sr-only` element rebuilt per move: "row 14, column 32, DMC 310, not yet stitched".
This also makes the whole screen switch-accessible.
**Effort** L · **Impact** 3 · **Risks** A canvas with a hand-rolled cursor is a lot of state; it
must survive zoom, page change and the layer switch or it will confuse more than it helps.

### 14. Keyboard and screen-reader path for the photo-crop handles
**Problem.** Still open from the sweep (D2): four `<span role="button">` corner handles carry
`aria-label` but have **no `tabindex` and no keydown**, and the `role="group"` crop box responds
only to pointer drags. ARIA promises four activatable buttons and delivers none — which is worse
than no ARIA, because a screen reader announces controls that cannot be operated.
**Proposal.** `tabindex="0"` on each handle; arrows nudge 1 px, `Shift`+arrows 10 px; announce
the resulting crop as "crop 180 by 240 stitches" after a 400 ms settle. Add a numeric
width/height field pair as the plain fallback — for many users typing two numbers beats dragging
four handles, and it is a fraction of the work.
**Effort** M · **Impact** 3 · **Risks** Aspect-lock makes independent handle movement
surprising; announce the locked dimension explicitly.

### 15. Never convey state by colour alone — audit and fix the remaining cases
**Problem.** The cross-stitch key already pairs every swatch with a symbol and a code, which is
right. The remaining risks are the ones this audit could not exhaustively enumerate in the time:
selected-state chips and pills now rely on a `--primary` fill (contrast fixed by the sweep, but
fill-vs-no-fill is still a colour difference), and the crochet yarn-colour feature identifies a
colour by a name the user types plus a swatch. For deuteranopia — ~8 % of men, and crafters buy
yarn by colour — a fill-only difference is a real risk.
**Proposal.** A standing rule plus a checklist pass: every selected/active/done state carries a
**second** cue (a ✓, a bold weight change, a left border, or a shape), not only a fill. For the
cross-stitch key specifically, keep the symbol mandatory and never let a "colour only" display
mode ship. Add a swatch **outline** (1px `--text` at 40 %) so a light floss on a light surface
still reads as a swatch.
**Effort** M · **Impact** 3 · **Risks** Doubling cues can clutter a 375 px row; prefer weight and
border changes over added glyphs.

### 16. Say what Undo undid
**Problem (measured).** Undo produces only a visual toast reading `"Undone"` in `#toasts`, which
is `aria-live="polite"` with **no `role="status"` and no `aria-atomic`**, and which contains a
focusable button that appears and disappears on a timer. The word "Undone" says nothing about
what changed or what the count now is — the one moment a user most needs that.
**Proposal.** `role="status"` + `aria-atomic="true"` on `#toasts`; move the Undo affordance out
of the live region (or mark it `aria-hidden` and pair it with the keyboard shortcut from
proposal 4). Make the message specific: "Undone — back to round 6, 12 stitches".
**Effort** S · **Impact** 3 · **Risks** A focusable control inside a live region is the actual
bug; splitting text from action is the fix, not more ARIA on the same node.

### 17. Bring the part tabs into reach — and onto the keyboard
**Problem (measured).** On the Sheep template at 375 px the part strip renders `Body` (x 16),
`Head` (87), `Ears` (160), `Legs` (251), `Tail` (**345**) and `Add a part` (**406**) — the last
two extend past the 375 px viewport. It is a horizontal scroller with 8 px gaps, no scroll
affordance, no arrow-key support, and (proposal 9) selecting a tab drops focus to `<body>`.
**Proposal.** Make it a real tablist: `role="tablist"` / `role="tab"`, roving `tabindex`, Left/
Right/Home/End, and `scrollIntoView({block:'nearest'})` on focus so the keyboard path pulls
off-screen tabs into view. Add a right-edge fade so the overflow is visible. On a project with
more than ~4 parts, offer the parts sheet as the primary route instead of the strip.
**Effort** M · **Impact** 3 · **Risks** A tablist changes the interaction contract (arrows move
*and* select, by default); use manual activation so an arrow does not re-render the counter.

### 18. One-handed reach: `Complete row` is in the worst corner
**Problem (measured).** At 375×812 `#row-plus` sits at x 284–346, y 188–250 — the top-right
band, the hardest reach for a right thumb and across the phone for a left thumb. It is the
second-most-used control in the app. `#row-minus` mirrors it at x 29. The bottom bar's four
controls sit at 4 px gaps (69×53 each) — fine for 2.5.8, tight for tremor.
**Proposal.** A "Reach" setting that mirrors the counter row (`+` left, `−` right) for
left-handed use, and — more useful — an option to duplicate `Complete row` as a full-width
button directly under the tap button, inside the thumb arc. Raise the bottom-bar gap to 8 px;
the bar has the width.
**Effort** M · **Impact** 2 · **Risks** Two ways to complete a row is a real duplication;
gate it behind the setting rather than shipping both by default.

### 19. Honour `forced-colors` and `prefers-contrast`
**Problem (measured).** `grep` over `css/app.css`, `css/themes.css`, `css/xstitch.css`,
`css/sewing.css` and `index.html` finds **zero** `forced-colors`, `prefers-contrast` or
`forced-color-adjust` rules. In Windows High Contrast and Android's high-contrast text mode, an
app that paints everything from CSS custom properties — including the `--primary` tap button,
the `--accent-2` focus ring and the chart canvas — degrades unpredictably.
**Proposal.** A `@media (forced-colors: active)` block that maps the semantic tokens onto system
colours (`ButtonFace`/`ButtonText`/`Highlight`/`Canvas`/`CanvasText`), adds visible borders where
the design relied on a fill alone, and sets `forced-color-adjust: none` on the two canvases with
an explicit fallback. A `@media (prefers-contrast: more)` block that thickens borders and pushes
`--text-muted` to `--text`.
**Effort** M · **Impact** 2 · **Risks** Forced-colors is hard to test without a Windows HC
session; scope it to the counter and home first rather than guessing across all three crafts.

### 20. Outline the key symbol on the 13 mid-tone flosses
**Problem (measured).** `XStitch.symbolInk` picks a binary dark/light ink. Across all 454 DMC
entries, **13 (2.9 %)** land below 4.5:1; worst DMC 3607 Plum Light `#c54989` at **4.22:1**,
then DMC 553 Violet 4.24, DMC 3850 4.25, DMC 3804 4.26, DMC 163 4.26. A binary choice cannot
clear 4.5 on every hue, and the symbol is redundant beside the code and name.
**Proposal.** A 1 px contrasting outline on the glyph (`text-shadow` in the opposite ink, or
`-webkit-text-stroke`), which lifts all 13 well clear without changing `symbolInk`. Cheapest
item on this list; listed last because the measured exposure is 2.9 % of a redundant cue.
**Effort** S · **Impact** 1 · **Risks** None material; check the stroke does not thicken the
17 px glyph into mush on the 34 px swatch.

---

## Sequencing

Proposals **1, 2, 3, 4** are the set that changes who can use this app, and together they are
roughly two days. They share one piece of plumbing — a single count event with a value, a
policy and several sinks (live region, aria-label, speech, haptics) — which proposals **11** and
**12** then plug into almost for free. **5** and **6** are the low-vision pair and should ship
together so the counter is re-measured once. **7** and **8** are the same ten-minute edit.
**13** and **14** are the two genuinely large items and can wait; **19** and **20** are cheap
insurance.
