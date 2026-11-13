# Wave K — knit-ui report

Owner of `js/app-knitting.js`, `js/knit-chart.js`, `css/knitting.css`, `test/knit-chart.test.html`,
NEW `test/knit-ui.test.html`, NEW `test/knit-ui.shots.html` (a page for headless screenshots, not a
suite). Interface: `docs/wave-k/api/knit-ui.md`.

## Suites
| suite | baseline (before my first edit) | now |
|---|---|---|
| knit-ui.test (new) | — | **112 passed, 0 failed** |
| knit-chart.test (real tab: reads `tmp-pdf/`) | no summary headless | **151 passed, 0 failed** |
| knit-counter.test | 364 / 0 | 385 / 0 (knit-store's additions) |
| knits.test | 409 / 0 | 449 / 0 (knit-parse's additions) |
| crafts.test (loads index.html) | 212 / 0 | 273 / 0 |
| workmode.test | 101 / 0 | 111 / 0 (one run during shell-ui's own edit read 110/1; green since; not my file) |

knit-ui.test uses its own key (`stitchkeeper-wavek-knitui-test`) and deletes what it makes.

## How it reaches the screen
`js/app.js` calls the registration field `def.counterPaint(p, prt, nodes)` at the end of
`updateKnitWidgets` (shell-ui.md §11). knit-ui paints into the nodes it already has (the `.knit-extra`
row under the pattern line, the pattern tag and text); the working-mode HUD mirrors exactly those
nodes, buttons included, so everything shows in working mode too. **The temporary watcher is gone**
(removed, not dormant); the paint runs only from the hook (`AppKnitting.__hookOnly`). Every Store /
Knits call is feature-detected; missing → today's screen. Crochet: every entry returns early.

## What the knitter sees, by proposal
- **P1 done.** A card on an open "work until" line: "Stretch · row 10 of ≈ 28", "10 cm at the pattern’s
  gauge, about row 30 · no row target until you end it · 40 sts" (the counter's row bar is hidden while
  a stretch is open, and the card says why), a big **I’m at the length** (one Undo, toast with Undo),
  **Use ≈ 28** (only then a planned target), **I measured**. Planned: "Stretch · row 4 of 29 · planned
  from your gauge"; "Drop the plan" / "Not at the length yet". No estimate → nothing invented ("until
  the same length as Back to beg of raglan shaping"). ⋯ → 📏 Stretches lists them with Reopen.
  **Older projects** (saved before stretch numbering) get ⋯ → "Number “work until” stretches as their
  own rows" → a plain confirm → `Store.setRowPhases(id, true)` (Undo switches back).
- **P10 done.** "I measured" sheet; the toast says the rows left (≈) or "That is the length"; the row
  gauge is offered in a confirm sheet and only "Use it" calls `Store.setGauge`.
- **P2 done.** The resolved row's words are the main line (its own "Rnd 1:" label dropped), the repeat
  sentence is a small italic "from: Rep last 6 rnds 8 times more.", the tag "Rnd 19 · repeat 4 of 9 ·
  rnd 1 of 6"; with `ctx.fillSizeMarked` the chosen size stays marked. Unresolved: today's sentence.
- **P3 done.** "▦ A 7/22 · B 3/4 · C row ?"; the sheet writes every panel's row out.
- **P4 done for read charts; picture charts as far as the reader finds them.** Sheet: page crop, band
  on the row, read arrow inside the band, dashed repeat box, stitches done shaded, tap a cell → "Row 4,
  stitch 4 from the right: CC1 (k)", Whole page, zoom; no page kept → the chart drawn from its cells
  in the key's own colours. Working mode: SVG strip row ± 2. **Two-mark calibration tried on a real
  picture chart** (knit-cascade-intarsia-skirt p4, a 463 × 358 pt hand-drawn colour grid, 375 × 812):
  tapped the top and bottom bands on the cropped chart, typed 11 rows, saved
  (`craftData.charts[n].calib = {top: 0.280, bottom: 0.606, rows: 11, x0, x1}`); row 7 was then
  banded on the 7th band from the bottom, within the chart's width. Marking now stays on the cropped
  chart (it used to jump to the whole page, too small on a phone), and the band spans only the chart.
  **Finding (my file, not fixed):** `KnitChart.scan` finds no chart at all in most new picture-chart
  fixtures — intarsia skirt (p4's picture is judged not chart-like and the page never says "chart"),
  cascade color yoke, Sandnes Bernie mittens, Cascade retro Fair Isle, Red Heart Fair Isle hat, Cascade
  cable yoke: 0 charts each. Without a chart object there is nothing to calibrate. The calibration run
  above used a chart object made by hand from the page's image box. Vector fixtures read well
  (Interweave socks 12 charts, lace 14, Japanese lace shawl 3). Next step for the reader: accept a
  large picture on a page that names a chart anywhere in the pattern, then let the knitter confirm it.
- **P11 done.** "MC 1 · CC1 4 · MC 1 · ×17 · longest float 4" (×N only when the total divides), floats
  joined round the repeat, "catch it" at 5+, unread cells "?" and "1 cell not read (?)", bobbin blocks
  for flat rows without a repeat. **Yarn colours from the key:** `KnitChart` now keeps each key sample's
  printed fill (`legend[i].fill`, new field) and `KnitChart.keyColours(chart)`; a chip "🎨 Use the
  chart’s colours (MC, CC1)" sets them as the project's yarn colours in one tap (Undo undoes all), which
  also colours the 3D piece through knit-store's K3 glue. Real fixture: Interweave socks p23 Chart A
  reads CC2 #c9ac68, MC #c2bfdd (CC1's sample is white, so no colour is offered for it).
- **P6 done.** Shaping card from `Knits.shaping`: "Shaping · row 4 of 11 / Neck dec ✓ · 4 of 4 / Raglan —
  · 2 of 6 · dec next row / 24 sts after this row (worked out by the app)".
- **P8 done (by app.js at import).** My counter offer is dropped; the part editor still has "Knit both at
  once" for older projects. RND / ROW is the counter's word from knit-parse's `rowWord`.
- **P9 done (UI over the store's answer).** On app.js's marker strip: a marker around a stitch is "◉
  raglan st"; with marked stitches the counts read "12 ◉ 9 ◉ 45" (the store's `plain`); a line "moved
  with this row’s increases · carried on from Neck" when `moved` / `source: 'carried'`. The store's
  honest "Markers set on a 36-st row · this row makes 76" (`unplaced`) is app.js's line and unchanged.
  Tested with a stubbed `markerInfo`; not looked at on the Sandnes / Bernat fixtures in the app.
- **P12 done.** A part whose text says "as (for) Right Front, reversing (all) shaping" gets "↔ Write it
  out from Right Front, mirrored" → a preview where every row is badged **worked out by the app**,
  **mirror this yourself** (left as printed) or "same as Right Front"; "Use these rows" stores them under
  the line "Worked out by the app from Right Front (mirrored). Check each row." and unsure rows end
  "[mirror this yourself]". On the counter: "↔ Worked out by the app from Right Front" (tap: what that
  means), plus a warning on an unsure row. Undo puts the pattern's sentence back. A stitch total after
  the row is kept at the end (knit-parse's `mirrorText` put "29 sts" inside the turned row; see below).
  Real fixture: Red Heart season cardigan's "Work same as Right Front, reversing all shaping" is matched,
  but the import names that part "Shape Shoulder" and there is no part called "Right Front", so no offer
  appears there (honest, not a guess).
- **P13 done by app.js** (a tap counts a repeat on long rows).
- **P14 done.** Page Down / Up on the counter; Settings → Knitting → Clicker: "Press your clicker now".
- **P15 done.** "Suggestion, worked out by the app from 56 sts: K3, M1, (k7, M1) 7 times, k4." on an
  "evenly" row (`Knits.evenlyRow`, round from the counter's word); "🧮 Pick-up helper" on a pick-up row
  → type the rows along the edge → "about 3 sts for every 4 rows".
- **P16 partly.** "📖 ssk · m1" chip with the pattern's own definitions first; everyday words (beg, dec,
  rem, st st …) are left out unless the pattern defines them. Not done: tapping the word inside the line
  (the line is a `<button>`) and panel names.
- **P17 done (simple).** ⋯ → 📐 Schematic: each part drawn from its stitch counts row by row at the
  pattern's gauge (SVG), cast-on and last widths, length, "your gauge makes this 1.7 cm wider" when the
  swatch differs; no row gauge → no drawing (says to add it). No printed measurements to compare
  against (the pattern's measurement table is not read).
- **P19 done.** ⋯ → 📝 Note on this row; shown on that row of the other piece.
- **P20 partly.** ⋯ → 🧶 Materials: yarn for your size ("3 balls (size M)", or the whole list when it
  cannot place it), needles in your needle system, tick what you own, "Still to get: …". **It reads
  `craftData.materials` when the import keeps it, else the parts' text** — and real patterns keep their
  materials in the front matter the parts do not include (saddle cardigan: full text 1 yarn + 1 needle,
  parts 0 + 0; Sandnes Bursfjell: 2 + 2 vs 0 + 1). So on real imports the card mostly says "No yarn or
  needle list was read" until app.js keeps the list (ask below).

## Verified
- Headless desktop 1280 × 800: stretch (Stardrop Night), chart sheet (Pixel Wyrm), shaping (Stardew
  Spring), mirror preview (Stardrop Night). Recipe: `test/knit-ui.shots.html?scene=…&theme=…`.
  Headless Chrome will not lay out narrower than about 500 px, so phone sizes were checked in the pane:
- Pane 375 × 812: stretch card on the counter and in working mode (Stardrop Night), "I’m at the length"
  from the HUD; real picture-chart calibration (Stardrop Night); chart strip in working mode with the
  key's colours (Pixel Wyrm). Pane 375 × 640: stretch (Stardew Spring), chart sheet with band (Pixel
  Wyrm), shaping + chips (Stardrop Night). Every tab closed; projects, blobs and keys removed.

## Found on the way (for other owners)
- **knit-parse**: `Knits.mirrorText` turns "K1, ssk, knit to end. 29 sts." into "Knit to last 3 sts. 29
  sts, k2tog, k1." (the total ends up inside the row). The UI works round it (mirrors the row without the
  total, puts it back); the fix belongs in `mirror`.
- **knit-parse / import**: Red Heart season cardigan's fronts import as "Shape Shoulder", "Small",
  "Medium" — the "reversing all shaping" source part cannot be found by name.
- **app.js (housekeeping)**: the boot-time BlobStore sweep removes page images of projects that are not
  under the store key the app booted with; test pages that switch keys after boot lose their page images.

## For the owner of js/app.js (paste-ready)
1. P20: at a knitting import, keep the materials with the project (the full text is in hand there):
```js
    // wave K (knit-ui, P20): the materials list lives in the front matter, not the parts
    if (window.Knits && typeof Knits.materials === 'function' && typeof Store.updateCraftData === 'function') {
      try {
        var mat = Knits.materials(fullText);
        if (mat && (mat.yarn.length || mat.needles.length)) {
          Store.updateCraftData(projectId, function (cd) { cd.materials = mat; }, { undo: false });
        }
      } catch (eM) { /* the card says it read nothing */ }
    }
```
   (for a book: `Knits.bookPatterns(fullText)[i].materials` of the pattern imported). I read
   `project.craftData.materials` (shape of `Knits.materials`).
2. P16 (optional): make the pattern line's abbreviations tappable needs the line to stop being one
   `<button>`; until then the 📖 chip does the job.

## Decisions for the coordinator
- Row notes reuse the steps overlay (`Store.setStepNote`, keys `s<hash of the part's base name>~<row>`).
- The clicker's taught keys and the materials ticks live in `craftSettings('knitting')` (no undo).
- Picture-chart detection in `KnitChart` (my file) needs its own piece of work (see P4); I did not
  loosen it this wave because a looser rule would also pick up photos and schematics.
