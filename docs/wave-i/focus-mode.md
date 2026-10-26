# Wave I — focus-mode: a bigger pattern strip, and a working mode in 3D

Owner of `js/app.js`, `css/app.css`, `css/themes.css`, `js/tour.js`, `test/store-safety.test.html`,
and the new settings in `js/store.js` (`focusProjects`, `focusMode`, `setFocusMode`).
`index.html` and `sw.js` are unchanged: no new file, no new script.

The owner's requests, from an iPhone screenshot of the bee (Medium · Body · Round 3/17):
1. *"Would love for the round section in the middle there to be a little bigger, since I'm looking
   on such a small screen."*
2. *"give the app a working mode … full screen counting the stitches and rounds … I want it to have
   the user to be able to work in that full screen view."*

## 1. The pattern strip, about 1.2x larger

What the maker sees: "RND 4 · 4. Inc, 2sc, repeat around" reads larger on the counter, in crochet
and knitting, and wraps to two lines at most. The whole text is still one tap away in the pattern
sheet.

| piece | before | now |
|---|---|---|
| row tag ("RND 4") | 11 px, weight 800 | **13.5 px, weight 900** |
| instruction | 15 px, up to 3 lines (2 below 760 px tall) | **18 px**, **2 lines at most** |
| instruction, below 760 px tall | 14 px | **17 px** |
| notes under it | 12 px | 14 px (13 px below 760 px) |
| colour change / turn strip | 13 px (12 below 760) | **16 px** (15 below 760), swatch 11 → 13 px |

Paying for it, so the counter stays at 0 px overflow (all in `css/app.css`):
- At ≤ 860 px tall, each progress label sits beside its bar instead of under it (one line, both the
  round bar and the stitch bar), and the strip loses 2 px of padding.
- The stitch pad's floor gives way first: in a multi-size project (the 44 px size strip is up)
  `max(20vh − 64px, 96px)` at ≤ 860 px (was `− 44px, 112px`) and 80 px at ≤ 760 px (was 96). A
  knitting part, which carries a 40 px marker strip, gets `max(20vh − 56px, 100px)` and 80 px
  (through `:has(.knit-markers:not([hidden]))`; a browser without `:has` keeps the old floor). The
  button still takes every free pixel, and on a small phone the working mode is the big target now.
- Below 760 px, a note under the instruction is one line, and the knitting short-row strip keeps
  to one line (its "rows 89–102 · …" clips).
- On a phone (≤ 420 px wide) the stitch actions are tighter (6 px gaps, 8 px button padding, 44 px
  minimum width), so a knitting part's −1 · + marker · Work in 3D · reset stitches fit one line
  instead of wrapping to a second 46 px line. In the pixel theme they are 11 px.

**Measured** (`project-body.scrollHeight − clientHeight`, every round of every part, jumping row by
row in my own tab):

| project | 375 × 812 before | 375 × 812 now | 375 × 640 before | 375 × 640 now |
|---|---|---|---|---|
| Bee 2.0 from `tmp-pdf/crochet-bee-sizes.pdf` (Keyring, Medium, Big; 67 rounds) | 0 | **0** on all 67 | **up to 32 px over** (35 rounds; already over before this wave, because of the size strip) | **0** on all 67 |
| Socks template, knitting, 182 rows | up to **151 px** over (actions wrapped, markers, short rows) | **0** on all 182 | (not measured before) | 0 on 181, **15 px** on row 57 (heel set-up: the turn strip plus a two-line marker note) |

The "before" columns were measured by injecting the old rules as a stylesheet over the new ones in
the same tab. With the bigger text alone, the bee went 32 px over at 812 and 46 px over at 640.

## 2. The working mode

### What the maker sees
- The counter's **⤢ Work in 3D** button (it was "⤢ 3D view") opens it.
- The 3D piece fills the screen. **The whole screen counts a stitch**: it is the counter's own stitch
  button, full screen, so press-and-release counts, the 12 px move tolerance applies, a swipe spins
  the piece and counts nothing, and keyboard activation counts. Taps on the readout text count too,
  because the heads-up layer lets every tap through except on its own buttons. The piece follows
  the taps (the "3D follows your stitches" setting, on by default).
- Over the piece:
  - **ROUNDS DONE 3 / 17** (rows done, as the counter's big number counts them; "piece 1 of 2" and
    the repeat readout under it) and **STITCHES 9 / ≈ 24** with the counter's own group line
    ("Group 3 of 6 · stitch 1 of 4"). Digits are 60 px in Fredoka (a 45 px numeral; 56 px / 42 px
    on short phones, 54 px / 40 px in short landscape). The pixel theme uses 46 px, which draws a
    42 px numeral.
  - The **pattern line** at 21 px (19 or 18 on short screens, 15 in the pixel font), up to 3 lines
    (2 on short screens). It is the strip's own nodes cloned (tag, yarn swatch, size marks), so it
    always says exactly what the strip says.
  - The **hints**: the colour change / "↻ Turn · rows from here" strip, the setup line on row 1,
    "2 more than the pattern's 24", and for knitting the short-row strip (its Done works), the
    chart / length / other-piece chips, and the live marker strip (tap to rename, hold to remove).
  - **Next · RND 5 · 5-6. Sc in each st**, or "same as this round", "This is the last round of
    Body", or "Then · Wings 2 of 2, from rnd 1". Hidden in short rows and on a finished part.
  - "Tap anywhere to count · swipe to turn" until the first stitch of the round.
- Big bottom-corner buttons: **−1** and **↶ Undo** on the left, **−** (previous row) and
  **+ RND / + ROW** (accent) on the right. They click the counter's own −1, Undo, − and +, so
  every rule (no undo eaten at row 0, short rows, announcements) is the counter's.
- The over-count wedge, the alert flash, the round's end buzz and the piece / part / project
  celebrations are the counter's own.
- Header: **✕** (back to the counter at the same count), whose piece it is ("Medium · Body", or
  "Sock 1+2"), and **Options ▾**, which unfolds the chips over a dimmed piece: the shape line
  ("Egg · 17 rounds · 24 around"), **Worked in** Auto / Rounds / Rows, **Way up** Auto / Top-down /
  Bottom-up, **Terms** Auto / UK / US (crochet only), **Turn** Follows stitches / Free spin, and
  ☀ Keep awake, 📖 Pattern, 🎨 Yarn colours, 🔍 Whole piece (the old viewer sheet, with pinch
  zoom). A tap on the dimmed area folds it without counting.
- Knitting: the **RS / WS chip** sits under ROWS DONE (a tap flips the side, as on the counter),
  the cable ring with it, and the marker readout under the hints.
- Keyboard: **Space / Enter** count a stitch (a focused control keeps its own Enter / Space),
  **↑ / →** complete a row, **↓ / ←** step back, **Escape** folds the options or closes the mode.
  Not while a sheet or a tour is up, never from a text field.
- Announcements are the counter's ("Round 4 done", "Back to round 4", "Short row 2 of 14, wrong
  side"), plus "Working mode. Round 4: 9 of 24 stitches" on opening and "Back to the counter. …"
  on closing.
- The screen stays awake if the Awake setting is on: it is the project screen, so the existing
  wake lock holds.
- **Landscape** (any `orientation: landscape`): the readouts, the pattern line, the hints and the
  next row take a left column (46 %, at most 520 px), the piece the rest, the buttons the bottom
  corners. The column clips rather than run under the buttons.
- **Remembered per project.** Leave a project in working mode and reopen it (or reload the app):
  it comes back in working mode. ✕ forgets it.

### How it is built (`js/app.js` "15c. Working mode", `css/app.css` "Wave I — working mode")
- `#screen-project.work-mode`: the topbar, the bottom bar and everything in the project body except
  the stitch button are `display: none`; the stitch button is `position: absolute; inset: 0` against
  the screen. **One GL context**, the button's own, with `fitPurpose: 'button'` (the piece being
  counted), the existing follow setting, and safe insets measured from the heads-up layer
  (`syncWorkInsets`: portrait = between the readout stack and the next line / buttons; landscape =
  right of the column, between the header and the buttons). Insets are only handed over when they
  change, and a `ResizeObserver` on the stack / foot / buttons re-measures when a web font lands or
  a hint wraps.
- `#work-hud` (appended to `#screen-project` once): `pointer-events: none`, its buttons and the
  options panel `auto`. `updateWorkHud(p, prt)` runs at the end of `updateCounters`, so every tap,
  row, undo and render repaints it. It mirrors the counter's nodes (`mirrorNode`: children cloned
  once per change, ids and tour hooks dropped, a cloned button clicks the counter's button at the
  same index, looked up at click time).
- `renderProject` calls `syncWorkMode(p)` before the counters paint; `openWorkMode` /
  `closeWorkMode` store the choice and `render()`.

### Contract
- **Settings key `settings.focusProjects`**: array of project ids whose working mode was left open.
  Default `[]`; `normalizeState` keeps distinct non-empty strings (at most 200) of projects that
  exist, so a deleted project's entry goes on the next load, and an old save loads with `[]`.
  It is a device preference: settings are in no undo snapshot (Undo can never open or close the
  mode), it never moves `updatedAt`, and it travels in a backup like every setting.
- **`Store.focusMode(projectId) → boolean`**, **`Store.setFocusMode(projectId, on) → boolean`**
  (no undo step; refuses an id that names no project; returns whether the stored value is now `on`).
- Without those functions (an old cached `store.js`) the mode still works for the page load.
- `#stitch-3d` keeps its id and `data-tour`; label "Work in 3D", aria-label "Work in 3D: count full
  screen with the piece". The tour step under it now describes the working mode.
- The 3D viewer sheet is unchanged and still reachable (Options → 🔍 Whole piece).

### Folded in from group-readout (coordinator's message)
`updateCounters` now calls `Store.groupReadout(prt, prt.stitch, g, target, approx)` and the local
`groupReadout()` is gone. The working mode shows the same text (it mirrors the counter's readout).
Checked on the bee, Medium · Body round 4: counter and working mode both read "Group 1 of 6 ·
stitch 0 of 4" at 0 and "Group 3 of 6 · stitch 1 of 4" at 9. `tapStitch` returned `group:1` at
stitch 4 and `group:2` at 8 (the buzz lands on the end of each "Inc, 2sc" repeat), plain `stitch`
in between. Round 5 ("Sc in each st", no repeat) falls back to "Group 1 of ≈ 3 · stitch 0 of 10".

## Verified in my own tab (tab-2)
Bee 2.0 created through New project with `tmp-pdf/crochet-bee-sizes.pdf` (3 sizes: Keyring, Medium,
Big; Body + Wings each), and Socks QA from the knitting Socks template (Sock ×2, 182 rows).
Halfway through, another agent's tab kept overwriting the shared `stitchkeeper.v1` ("Updated from
another tab" closed my working mode twice), so the rest ran on a copy under
`Store.__setKeyForTests('zqa-focusmode.v1')`, which I removed afterwards.

- **375 × 812, bee Medium · Body, round 4 (the owner's screen)**: the strip reads "● RND 4 4. Inc, 2sc,
  repeat around" at the new size. Work in 3D (a real click) opened the mode. 23 real taps (one on
  the readout text) gave 23 / 24; the 24th auto-advanced to ROUNDS DONE 4, the strip and the HUD
  moved to "RND 5 5-6. Sc in each st", next "RND 6 same as this round". Undo (HUD) went back to 3 /
  23 and stayed in the mode. Space counted the 24th again; ↓ said "Back to round 4"; ↑ completed it.
  3 taps, −1, then a 200 px drag: 2 stitches, `follow.userTurned: true`, nothing counted for the
  drag. Options opened over a dimmed piece, a tap outside folded it with no stitch. ✕ returned to
  the counter at 4 rounds / 2 stitches, focus on the Work in 3D button, the canvas back on the
  button's insets. Home → reopen: back in working mode. Escape closed it.
- **375 × 640, bee round 7** (colour change): "Change to black" hint in the accent strip; with
  auto-advance off, 26 on 24 showed "2 more than the pattern's 24" and the red wedge
  (`alert.wedgeFrom: 24`). The piece gets 232 px of height.
- **812 × 375, bee Wings row 3** (the turn into rows): left column with "↻ Turn · rows from here",
  "Then · Wings 2 of 2, from rnd 1", the piece on the right (422 × 251 px free); taps on the piece
  and on the column text both counted.
- **Socks (knitting)**: row 60 (heel flap) shows the WS chip under ROWS DONE and the marker strip;
  the chip flipped to RS through the HUD without counting a stitch. Row 89: "Short row 1 of 14",
  `+ ROW` labelled "Short row done (turn)", it announced "Short row 2 of 14, wrong side". Checked at
  375 × 812 (piece 310 px tall), 375 × 640 and 812 × 375.
- Pixel theme: digits 46 px (42 px numeral), the pattern line at 15 px, no clipping in portrait.
- No console errors.
- Screenshots were taken at each step above (counter before / after, working mode at all three sizes,
  the options panel, the over-count, knitting short rows, landscape knitting, the pixel theme).

## Tests
| suite | before | now |
|---|---|---|
| `test/store-safety.test.html` | 307 | **324 / 0**: new group "wave I: the working mode is remembered per project", 17 assertions (default `[]`; per project; no undo step and no `updatedAt`; stored once; unknown id refused; Undo after closing keeps it closed; Undo of a tap made before opening keeps it open and undoes the tap; survives a reload; in `exportJSON`; forget; normalisation drops duplicates / non-strings / blanks / missing projects; an old save loads `[]`; a deleted project is dropped on load) |
| `test/backup.test.html` | 205 | 205 / 0 |
| `test/templates.test.html` | 147 | 147 / 0 |
| `test/crafts.test.html` | 124 | 124 / 0 |
| `test/knit-counter.test.html` | 317 | 317 / 0 |
| `test/diagram-model.test.html` | 529 | 529 / 0 |
| `test/sw.test.html` | 29 | 29 / 0 (no new file) |

## Left, and why
- **Knitting heel set-up row at 375 × 640**: 15 px over on one row of 182 (row 57: the turn strip
  plus a two-line "Markers set on a 64-st row · this row makes 32"). Clipping that note would hide a
  real warning. The working mode shows it in full.
- **Knitting in the pixel theme** was not swept row by row. One row checked at 812 is 0 px over.
- **No part switching inside the working mode.** ✕, pick the part, Work in 3D. The header names the
  part. A part chooser in Options would be easy if the owner wants one.
- **Follow mode is the setting, not forced.** The mode opens following the taps because that is the
  default; someone who chose Free spin keeps it, and Options → Turn switches it.
- Not felt on a real phone; the sizes are from the pane's emulation.
- The shared pane storage: another agent's app tab writing `stitchkeeper.v1` replaces this tab's
  state (correct multi-tab behaviour), which is why the later checks ran on a private key.

## For the owner of `SPEC.md` (docs agent)
- § Screens (App) → Project screen: the actions row reads "−1, **⤢ Work in 3D**, reset stitches".
  Add a **Working mode** bullet, taken from "What the maker sees" above.
- § Data model → settings: `focusProjects: string[]` (wave I), with `Store.focusMode` /
  `Store.setFocusMode`.
- § UX rules → Short screens: add the wave I floors and the progress-label-beside-bar rule, and
  change "instruction clamps to two lines" to "the instruction is 18 px (17 px below 760 px) and
  clamps to two lines everywhere".
- § Live 3D diagram → App integration: the working mode uses the button's mount
  (`fitPurpose: 'button'`) full screen with measured `safeInsets`; the viewer sheet is under
  Options → Whole piece.
