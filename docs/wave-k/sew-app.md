# Wave K report: sew-app

Owner of `js/app-sewing.js` and `css/sewing.css`. Interface (exact): `docs/wave-k/api/sew-app.md`.

## Suites (headless, `bash tools/headless-suite.sh …`)
| Suite | Baseline (before my first edit) | Now |
|---|---|---|
| sewing.test | 1143 / 0 | 1159 / 0 (sew-core's later additions) |
| sew-visual.test | 164 / 0 | 168 / 0 (sew-visual's own additions) |
| crafts.test | 212 / 0 | 239 / 0 (shell-ui's additions) |
| workmode.test | 101 / 0 | 101 / 0 |
| checksheet.test | 58 / 0 | 58 / 0 |
| templates.test | 159 / 0 | 159 / 0 |
| sewing-extras.test | — | 121 / 0 (runs against my hooks) |

No suite of mine exists: app-level assertions are exposed through `SewingApp.__test` for the
galleries worker's `test/sewing-app.test.html` (not written yet when I finished). `js/app-sewing.js`
was also parse-checked in headless Chrome after every batch of edits (0 errors).

## What the user sees
- **Size advisor (P3 / P4).** Size & alterations: a cm / inches switch for this project (the
  pattern's own units by default), "My measurements" (the shared profile, `Store.setMeasurement`;
  the pre-wave-K free-text values are still read), a **Suggestion** card ("Size 42, with 44 at the
  hip", each measurement's reason, ease with negative ease explained) and a **Use 42** button (one
  undo step, never automatic), the designer's own between-sizes sentence quoted with its page chip,
  the chart as read with the chosen column lit, doubtful cells shown "… ?" (dotted, with the reason)
  and the chart's own check line, then **At size 42**: every per-size number once (fabric, elastic,
  finished, body, in-step runs), a cell the page may have cut off shown "?" with the sentence, and
  the numbers that could not be resolved listed plainly. A pattern whose chart is not a chart keeps
  the old sheet. On the step card, a step with a per-size run shows "SIZE 42 · Hem the skirt by 56 cm".
- **Sewing mode (P2)** on `def.workMode`: "⤢ Sewing mode" under the big button and in ⋯. The step
  fills the screen: STEP n / total (card k of m), the active unit's count, the step text, the step's
  set-up chips (seam allowance, trims, topstitch, 🦶 foot, ⏱ press / fuse), its size numbers, the
  sewist's note, the next step; the step's figure fills the free area. Tap anywhere / Space / Enter
  = Step done (or +1 on the unit); › / → / PageDown (pedal) = Step done and on; ‹ / ← = back a step;
  Undo; −1 when a unit is active; Options: note, the page, step list. Remembered per project (shell).
- **The step's own figure (P1 / S4).** The import has "Show each step's own drawing beside it"
  (ticked); after the import, in the background, `SewFigures.readPages → link → renderCrops`
  (mode `figure` only) keeps clean crops. The crop sits beside the step text (36 % column) so the big
  button stays above the fold; tap opens the page (shell PageViewer). A step with no clean figure
  stores its text frame, and the page chip opens that page with the step outlined. Never a half crop.
- **Units in their step (P10 / S3).** A unit whose step is known takes the big button
  ("UNIT 1A · 0 / 2", tap = +1), the step's other units are a chip strip with −1, "✓ Step done"
  becomes a link, finishing the step's last unit offers "Step done" in a toast; units without a step
  keep the old cards. Every count goes through `Store.counted` (step, cut, unit) and `ctx.counted`.
- **Kind and name (P14).** A bag has no Size row and no Size & alterations item; a quilt / bag shows
  "Finished 70" × 80"" in that row when printed. The project takes the pattern's name
  ("sew-sundress" became "Gathered Sundress") only when its name was the file's or a default.
- **What was missed (gap 8).** The import review starts with `Sewing.importCheck` as a check line
  (See the check); "off" demotes Import (`ctx.check.demote`) behind the shell's confirm
  (`ctx.check.guard`); it never blocks. Picture pages offer the opt-in text reader
  (`ctx.ocr.offerButton`); what it reads opens as "Read from a picture: check it" through the check
  sheet, and only goes into steps through the paragraph picker, by hand.
- **Step edits and notes (gap 7).** ✂ in the step list now also has "✎ Edit the text" and "📝 Add a
  note"; the note shows on the step card and in working mode; marks ✎ 📝 🖼 in the list.
- **Pattern sheet (P5).** ⋯ → Add the pattern sheets → drop the sheet PDF → `Sewing.readSheet`
  (page sizes from pdf.js `page.view`, layer names from `handle.layers()`) → review (pieces with
  per-fabric cuts and pages, copy-shop note for A0, test square, size layers with "tick only yours")
  → Add. The 🗺️ Pattern sheet row / sheet: tape-up map (`SewFigures.mountTapeMap`, tap to tick taped),
  the pieces, print notes, and "Use these pieces as the cutting list" when the booklet has none.
- **Milestones (P19)** from `Sewing.milestones` after every write: "Everything is cut ✂️", "All the
  interfacing is fused", "The quilt top is finished", "The binding is on", "Hemmed".
- **⋯ menu:** the app's own items, then `SewingExtras.menuItems(project)`; a "Cut…" step deep-links
  to the extras Cutting board, a press / fuse chip to the extras timer. **Share a picture**:
  `def.sharePicture` draws the latest step drawing, else a progress ring. Tour and FAQ refreshed.

## Proposals
| # | State | Notes |
|---|---|---|
| P3 + P4 size advisor | done | see above |
| P2 working mode | done | |
| P1 / S4 figure | done | on the card and in working mode; not drawn inside the button (`mountButtonPicture` unused: it competes with the count) |
| P10 / S3 units in their step | done | the unit picture (`SewQuilt.mountUnit`) is not used |
| P14 + gap 8 + gap 7 | done | |
| P5 sheet | done | "my size only" rendering of layers is not built (the app names the layers to tick instead) |
| P19 milestones | done | |
| P15 set-up chips | done | |
| ⋯ extras, Share a picture | done | |

## Verified by hand (Browser pane, one tab, private key `stitchkeeper-wavek-sewapp`, rAF shimmed in that tab)
- Synthetic garment text (5 steps, 36–44 chart, a "between sizes" rule): profile 97 / 79 / 104 cm →
  suggestion 42, Use 42, resolved hem "56 cm" on step 4, chips (Seam allowance 10 mm · Zipper foot ·
  Press); working mode: Enter on the surface ticks step 2 → 3, ArrowLeft goes back, remembered on;
  injected units (2 + 1 on step 3): the button counted 1A → 1B → Step done, activity `{step 3, unit 3}`.
- `tmp-pdf/sew-sundress.pdf` through the real drop zone: review shows the check ("1 thing to
  check"), the name, both page / figure rows ticked; Import kept 9 pages (16 s) and **5 of 15 cards
  got a clean crop** (steps 1–3, 6, 7), the other 10 a framed page; renamed "Gathered Sundress".
- `sew-sundress-pattern.pdf` through ⋯ → Add the pattern sheets: 10 pieces, tiles 5 × 6; the map
  ticked 1A; mini row "10 pieces · 1 of 30 sheets taped".
- `sew-peppermint-westend-jacket.pdf`: check "Mostly pictures of text: 14 of 17 pages", Import
  demoted (`btn check-demoted`), the text-reader offer shown (not downloaded).
- `sew-swoon-mabel-bag.pdf` (parse → craftData): kind bag, no Size row, menu without Size, extras listed.
- `sew-freespirit-harmony-quilt.pdf` through the drop zone: the check is "off" (Fabric E strips),
  Import demoted, "Use it anyway?" confirm, then imported; named "Harmony Quilt"; 17 pages; **14 of
  22 steps got a clean crop**, 8 framed; quilt model **vector, page 12, 17 blocks, 238 patches**;
  **16 swatches** captured; all 18 units have a step; step 3's button reads "UNIT 2A · 0 / 4", +1
  recorded `{unit: 1}` in the activity, Undo put it back. The big button now sits at **y 582–793 at
  375 × 812** (was 2,927 in the brainstorm): on a unit step the cutting table is hidden.
- Layout from DOM rects (the pane was hidden, so no screenshots): 375 × 812 and 375 × 640, no
  horizontal scroll; with a figure the big button is at y 524–735 (812) and 465–632 (640); working
  mode figure in the free band 283–487 at 640. Desktop 1024 checked once. Themes: only theme
  variables are used, except a white backing behind booklet crops (the pages are white paper);
  Stardrop Night / Pixel Wyrm / a light theme were **not** looked at, for want of screenshots.
- Cleaned up: 5 projects, their `p:<id>:` blobs, the storage key; both tabs closed.

## Left, and why
- No screenshots (pane hidden for the whole session): one visual pass in the three themes is owed.
- The sundress links 5 of 15 cards to a clean figure (sew-visual's confidence rule; Samford 2 of 15
  by design); everything else falls back to the outlined page.
- OCR path: wired but not driven (the 5 MB download needs the owner's tap).
- Layers: no "print my size only" render; size-layer names are listed with an instruction.
- `SewingApp.quiltModel` / `captureSwatches` (asked by sew-extras) are built; the quilt model is
  kept only when the text names its layout page (Harmony yes; Joyous / Catwalk not checked).
- On a unit step at 375 × 812 the "✓ Step done" link falls just below the fold (y 812–856); the
  working mode has it in the corner.

## For the owner of `js/sewing.js` (sew-core)
- Please keep a `step.fig = { mode:'figure'|'page', blobKey?, page, rect:{x0,y0,x1,y1}, reason }` in
  `normalize`. Until then the app stores the figure in `step.imageRef` (`'p:<id>:fig:…'` or
  `'rect:<page>:x0,y0,x1,y1'`); `toCraftData` resets `imageRef` on a re-import, which is fine (the
  app captures again), but please keep it across `splitStep` / `mergeSteps` for the first card.
- `sizeRule` on a text without page breaks quoted the whole run-up ("GATHERED TEST DRESS SIZE
  CHART … choose the larger size."): trim the quote to its sentence.

## For the owner of `js/tour.js`
- Nothing needed: the sewing tour's steps live in `js/app-sewing.js` and now include
  `.sw-work-open` (Sewing mode) and `.sw-fig` (the step's drawing). Exact request only if the engine
  does not skip a hidden target: please skip steps whose target is `hidden` / not displayed
  (`.sw-fig` is hidden on a step without a clean figure).

## Decisions for the coordinator
- **Step edits / notes use sew-core's craftData path** (`Sewing.editStep` / `setStepNote`, re-import
  safe in `toCraftData`), not shell-data's `Project.overlay`: one place, already in backups and undo.
- **Pages and figures are kept by default** at import (P1 says so; the row shows the size, and both
  can be unticked). About 2 MB for the sundress.
- The figure capture is written outside the undo stack (`{undo:false}`), so Undo after an import
  undoes the import, not the figures.
