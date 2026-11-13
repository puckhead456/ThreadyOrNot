# Wave K: xs-app report (js/app-xstitch.js, css/xstitch.css)

Contract: `docs/wave-k/api/xs-app.md`. Only `js/app-xstitch.js` and `css/xstitch.css` were edited.

## Suites (headless, `tools/headless-suite.sh`)
| page | baseline (before my first edit) | end |
|---|---|---|
| xstitch.test | 1096 | 1120 / 0 failed (xs-core's additions) |
| xstitch-render.test | 61 | 62 / 0 |
| crafts.test | 212 | 239 / 0 (shell-ui's additions; the cross-stitch module group stays green) |
| workmode.test | 101 | 101 / 0 |
| checksheet.test | 58 | 58 / 0 |
| xstitch.fixtures, xstitch-read.test | no summary headless (pdf.js pages; need a real tab) | not re-run in a tab (my files are not loaded by either page) |
| `XStitchApp.__test.selfCheck()` (new, 19 pure checks of this file's wave K logic) | — | 19 / 0 (run in a pane tab) |

`js/app-xstitch.js` parses (headless syntax page after every batch).

## Proposals (numbers from 02-cross-stitch.md / 04)
| # | state | what the user sees |
|---|---|---|
| pacman bug UI | **done** | Grid read box shows the shared check line ("See the check"); colours not told apart are listed and make the check "off"; an off check demotes "Use it" to "Use it anyway…" behind a plain confirm. Palette keeps `keyCount`, `glyph`, `unresolved`; placeholders get "?" and a dashed swatch; key row "not told apart: tap ? to choose" → **Which colour are these?** (candidates with the key's count, other key colours, "They are fabric", leave) via `resolveClass`, one undo step. Band above the chart: "Read from the PDF’s grid. 100 stitches have no key colour yet…", re-checked live from `keyCount` (follows Undo and choices). On Pac-Man today (xs-core's glyph split) the read is exact: "All 10 colours match the key exactly (64,512 stitches)". |
| #1 honesty | **mostly** | One total everywhere (`statsOf` = `XStitch.totals`: key-only colours "counted from the key, not on the chart" and tapped into `progress.keyDone`); `pctText` ("0.03%"); bar is a progressbar; distinct symbol families on new imports (Pac-Man: `· ☆ ◇ ▫ = § ^ ○ + △`, `symbolCheck` ok); Floss "≈ 32–72 skeins (buy 48)" and "About 43–88 skeins (buy ≈ 61) in all"; whole colour > 1,000 asks first (`bulkPlan`); 10×10 = current colour by default with a "whole block" switch; picture-read "Use this chart" demoted when off; announcements through `ctx.counted` (every 50th). **Not done**: "Re-letter symbols" for old projects (opt-in action), a confirm before a photo replaces an imported key (`applyPhoto`). |
| shell-data | **done** | xs-core registered `heavy` (cells + done); the shell waits on `whenReady`. Every mark path calls `Store.counted` once per action and `Store.logMarks` on every mark and unmark (tap, −1, drag, 10×10, whole colour, reset, row done, page done, layers count only). |
| #2 stitch mode | **done (size below target)** | ⤢ Stitch mode (button under the strip, and the shell's ⋯ item; remembered per project, reopens after a reload). Chart fills the HUD's free rectangle; taps use the tool; +1 / Space / pedal = next stitch block by block, −1, Undo, ‹ › colour, 🎯; compact readout (colour done / total, block, island, ALL %, page); Options: tool, Unmark, Highlight, 10×10 whole block, Fit, Find my place; keys H F + − N J. **Measured chart share: 73 % of 375 × 812, 67 % of 375 × 640** (was 45 %); the 85 % target needs the chart under the HUD (decision below). |
| X1 + X2 + X5 | **done** | `XSRender` in the tap button, `buttonView` whole / loupe (Pac-Man: loupe, `lod: thread`, 13.7 px a stitch), next stitch marked, flat preview until compiled + drawn, fallback message, lost → flat preview, released on leave, theme follows. Backstitch / knots / fractionals passed with their done bits. |
| #3 parking | **done (no long-press)** | Corner triangles in the floss colour; Parking sheet: direction, assistant "Next DMC 310 · Black in your direction: col 11 · row 1 (block 2,1, 100 to do there). 📌 Park it there", park at the crosshair in a chosen corner with a note, threads in meeting order (jump, turn corner, unpark), old text notes kept; marking a parked stitch offers Unpark. Long-press on a stitch was not built (the sheet and the crosshair do it). |
| #4 pages | **done** | Dashed page outlines + "p3" labels (solid ✓ when done); "Mark page done" asks "Mark 500 stitches of page 3 as done?", marks the stitches and the flag as one undo step (verified Undo restores both); Stitch mode readout "page 2 · 0 of 1,200". Un-ticking leaves stitches (said). |
| #13 islands | **done** | Stitch mode: "island 1/12 · next ≈ 0.4 cm" (+ "new thread" over 2.5 cm), worked out 400 ms after the crosshair settles. 🎯 still steps stitch by stitch (not island by island). |
| #14 row by row | **done** | "Rows across: Whole chart / This page / 10 wide", runs chunked at 10 columns on wide charts, done runs inside a row ("✓10", "3/10"), Row done marks only the scoped squares. Wave J options unchanged. |
| #21 find my place | **done** | ⋯ → 🔢 Find my place: keypad + col / row / page / block words, `findPlace`, errors in plain words ("That is off the chart (224 × 288 stitches)."); links to xs-extras' goals / sessions sheets when listed. |
| #7 / R1 key picture | **done** | 🔑 Read a key from a picture (⋯), "The colour key" choice on a dropped picture, and the reader's `looks-like-a-key` → "Read the colour key". Sheet: crop box (open for a big picture: "drag the box round just the key"), rows exact / check / blank, one-tap candidates, typed codes checked against the DMC list, a partial row's code never saved, "Use 6 colours" ("N rows with no code will be left out"). A chart read from a picture is read again against the new key; else the key becomes the project's key. Potatoes key: **6 of 6 rows exact** (DMC 4, 310, 745, 842, 3032, 3827). |
| #8 / R2 reader v2 | **done** | `maxColors` no longer forced to 60; busy PDF pages looked at and read about 2,000 px wide; a doubtful size is said plainly with the evidence and the size steppers opened; "Read the chart part of the picture; left out: colour key, picture". |
| #11 tiles | **partly** | When each page holds part of the design: "Join the chart pages (new)" → `XSRead.readTiles`, "Joined 6 pages as 3 across × 2 down … Is this the layout?" with each seam's agreement, the check, demoted Use when a seam or the check is off. Labelled as tried on made-up charts only; **not driven on a real file** (no raster multi-page fixture). |
| #6 symbol-font | **not done** | `gridFromGlyphs` is not wired (needs per-page text items with fonts; xs-core found only foxy is a symbol-font chart). |
| #10 backstitch from a PDF | **done (wiring)** | `ornamentsFromGraphics(extractGrid().graphics)` fills the Back / Knots / Parts layers on a grid read and says "N backstitch segments read from the PDF"; unmatched lines are left out and counted. No fixture with vector backstitch was driven. |
| #9 / R5 designer's symbols | **done** | Clean `glyph`s drawn on the chart (Path2D or the 16 × 16 bitmap) and in key swatches; Settings → Cross-stitch "The pattern’s own symbols" (on by default; off = the app's set). Pac-Man: 10 / 10 clean vector glyphs drawn. |
| #20 kind | **done** | Fabric & size → "What are you making?" (Cross-stitch, Diamond painting, Needlepoint, Filet crochet, Fuse beads); the button caption / bar unit and the Floss sheet's material line ("≈ …packs of 200") follow `XStitch.KINDS` / `materials`. |
| ⋯ extras + share | **done** | `XStitchExtras.menuItems(project)` listed, `open(id, project, {ctx, app})`; `def.sharePicture` = `XSRender.picture` in a hoop; `XStitchApp.repaint / dataOf / picture` as xs-extras names them. |
| Ocr hook | **done (small)** | Blank rows on a *cropped* key: `ctx.ocr.offerButton` → `Ocr.recognize(crop, {mode:'codes'})`, only DMC-table codes on the row's line offered as "310 ?" (marked with `ctx.ocr.mark`), never accepted without a tap. Not driven (engine not installed). |

## Measured
- Tap on Pac-Man (224 × 288, 64,512 stitches, desktop pane): **median 4.9 ms, worst 10.3 ms** per button tap including `Store.counted`, `logMarks` and the renderer's `setDone`.
- `extractGrid` on Pac-Man: 2.4 s; check exact.
- Stitch mode chart: 73 % (812) / 67 % (640) of the screen height, full width.
- Theme contrast of the new text (danger on surface): 4.53–6.14 in all six themes; danger on surface-2 drops to 4.06 in Stardew Spring, so new danger text is only placed on `--surface`.
- No horizontal overflow at 375 px in the Parking, Find, Rows, Floss, Fabric and Pages sheets.

## Driven by hand (Browser pane, own key `stitchkeeper-wavek-xsapp`, 375 × 812 and 375 × 640; no screenshots: the owner declined pane screenshots, so checks are DOM reads)
Synthetic chart with a placeholder and a key-only colour (band, key rows, resolve sheet → candidate chosen, live band); Pac-Man PDF → `extractGrid` → `applyGrid` (total, symbols, renderer, 20 taps timed, Stitch mode by Space ×10, reload reopens Stitch mode, parking + assistant, Find my place, Floss text); pages synthetic (Mark page done + Undo); Row by row scope + Row done; potatoes key picture → key → potatoes screenshot → "Read a chart picture" → "Use it anyway" (144 × 85, 5,721 stitches; the check is off because the key picture gives no count for DMC 04, so its 100 stitches came in as DMC 413: honest, demoted, but worse than the wave J text key). All test projects and the key were removed afterwards.

## For the owner of js/xstitch-read.js (xs-read)
- With a key read from a picture that has no count for DMC 04, the potatoes 100-stitch class is named DMC 413 instead of DMC 04 (which is in the key). A key entry with no count could still claim the nearest unmatched class by colour.

## For the owner of js/app.js (shell-ui)
- The work HUD's readout band takes ~129 px at the top and ~70 px at the bottom; a `spec.overlay: true` (surface under the HUD, with `insets` only for safe margins) would let a chart reach the 85 % the brainstorm asks for.

## Decisions for the coordinator
- 10×10 defaults to the current colour with a "whole block" switch (brainstorm recommendation).
- "Off" demotes; "unchecked" (no counts printed) does not (xs-core suggested demoting anything not exact / close).
- Un-ticking a page leaves its stitches marked.
- The pattern's own symbols are on by default when clean (BUILD decision), switchable in Settings.
