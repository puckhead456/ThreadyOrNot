# Wave F: cross-stitch (`xstitch`)

Owner of `js/xstitch.js`, `js/xstitch-photo.js` (untouched this wave), `js/app-xstitch.js`,
`css/xstitch.css`, `test/xstitch*.html`. All of this comes from the 04 cross-stitcher lens
(`docs/brainstorm/04-cross-stitcher.md`): #1, #2 and #3, the two leftover expectations from wave E,
then #15, #13 (partly), #6 (copy), #14 and the "next stitch of this colour" item from the parking lot.

## Suites (all green at the end)

| suite | before | after |
|---|---|---|
| test/xstitch.test.html | 700 | **752** (+52) |
| test/xstitch.fixtures.html | 475 (+9 skipped) | **493** (+9 skipped) |
| test/xstitch-photo.test.html | 131 | 131 |
| test/crafts.test.html | 124 | 124 |

The fixtures ran in a fresh tab. The extractor was not changed by me.

## What the stitcher sees

### 1. Rulers, centre marks and a position readout (04 #1)
- **Rulers.** Both chart canvases (the strip and the full Chart sheet) have rulers in screen
  space: a 16 px strip along the top and a 26 px one down the left (32 px when the chart is
  1000+ rows tall).
  - They overlay the canvas. Fit and the pan limits leave room for them, so column 1 and row 1
    are never hidden.
  - They are numbered from 1, like a printed chart: every 10 stitches, or 20, 50, 100… when ten
    stitches are less than 30 px wide (`XStitch.rulerStep`). There is a minor tick every 10
    while ten stitches are at least 4 px.
  - The crosshair's column and row show as a coloured band on each ruler.
  - Colours come from the theme (`--surface`, `--text`, `--border`, `--primary`, `--danger`).
    They are read once per theme, not on every frame. Checked in Stardew Night (dark) and
    Stardew Spring (light).
- **Centre marks.** Red ▼ and ▶ arrows on the rulers, plus a dashed hairline across the chart,
  at w/2 and h/2 at every zoom.
  - For an even count, that is the line between the two middle stitches. For an odd count, it
    runs through the middle of the centre stitch.
  - A ruler number that would sit under an arrow is not drawn.
- **10×10 grid.** The 10×10 majors now stay visible below 8 px a stitch (thinner), down to about
  5 px a block. The minor lines still need 8 px.
- **Position readout.** A permanent chip, bottom left, with two lines:
  - "col 134 · row 57"
  - "22 right · 88 up from centre", or "on the centre column · 4 up from centre", or "the
    centre stitch".

  The chip follows the crosshair (the tapped or current stitch). A drag in progress, or a mouse
  hovering over the chart, shows the stitch under the pointer until it lets go or leaves. The
  canvas's `aria-label` carries the same text. The chip uses a system font, because Press
  Start 2P would make line 2 wider than a phone.

### 2. Zoom, pan and tool are remembered per project (04 #2)
- Reopening the Chart sheet lands on the same zoom and the same middle stitch, with the same
  tool (Tap / Drag / 10×10 / Whole colour) and the same layer (Crosses / Back / Knots / Parts).
  This holds after Done, after a reload, and on another device.
- Unmark is deliberately **not** remembered: a chart reopened in erase mode would quietly undo
  the next tap.
- Fit, the Fit button and a double-tap store "no view", so the chart opens at Fit.
- On restore the zoom is clamped to at least Fit for the current canvas. A rotate or a different
  phone never restores an off-screen view.
- When the canvas resizes (rotate, sheet resize), a zoomed view keeps its middle stitch in the
  middle instead of snapping back to Fit.
- A tap on the strip moves the crosshair, and that is remembered too.

### 3. The PDF pages are kept when the grid reader wins, and 📄 flips to them (04 #3)
- The import path ("Try to read the grid" → "Use it") renders and keeps every page, exactly as a
  key-only import does. The grid adds a chart; it does not replace the pages.
- **Each page now records which stitches it prints** (`pages[i].region`, see Contract) and where
  its grid sits on the page.
- **📄 in the Chart sheet** opens a new full-screen page viewer on the page that printed the
  crosshair stitch (or the middle stitch of the view, when the crosshair is off screen).
  - The stitch is outlined in red and the viewer zooms to about 24 stitches across.
  - A note says "col 116 · row 143 is on this page, outlined. This page prints cols 107–159 ·
    rows 78–154."
  - If that page was past the 40-page cap, the viewer says so and shows the nearest page that was
    kept.
  - An import made before this wave has no regions. Its note says to re-import, or to use ‹ ›.
- **The page viewer** (04 #14): pinch, drag, wheel or + / − to zoom; double-tap toggles Fit and
  3×; arrow keys pan; ‹ › move between pages; "Mark page done" sits under it.
  - It also opens from a Pages-sheet thumbnail. Before, a thumbnail in chart mode changed a strip
    that was not on screen, so it appeared to do nothing.
  - It also opens from a new ⤢ on the image-mode page strip.
  - Thumbnails show "cols 54–106 · rows 1–77".
- **Orphan cleanup.** A re-import removes page images under the project's `chartpage:` prefix that
  the new page list no longer uses. 04 #3 had found an orphan `chartpage:0`.
- **Page flags.** When the grid read, a page's `isChart` follows "has a region": the cover and the
  key page are not chart pages, so the viewer's default page is the first real chart page. A
  one-page PDF (Tiny Modernist) is now "Page 1", a chart page, not "Cover".
- **Grid-reader result copy (04 #6).** It reads "Read 149,000 stitches over a 298 × 500 grid…" and
  adds that the pages are kept and 📄 shows them.
- **Backup wording.** Per the shell agent's note, the import footnote, the Pages sheet and the
  "Where are my chart images stored?" FAQ now say the pages are saved with the project and that
  Back up now (`.thready`) includes them. Only an older `.json` backup leaves them out.

### 4. The two loose wave-E expectations, tightened
- **Foxy.** `xs-tinymodernist-foxy` now asserts all nine cross colours **exactly and in order**
  (Blanc 19 3854 3853 352 666 3347 3345 3799). It also asserts that DMC 19 and the 3799 cross row
  are present as cross rows. The KNOWN GAP warning is gone.
- **The Pokémon key repair is a fallback only.**
  - `expandCountColumns` now treats a run as "read across" only when at least two of its lines,
    and at least half of them, hold two or more `code (N ct)` cells. Otherwise it keeps the
    extractor's order.
  - Before, a single glued line pulled every following line into a two-column run and moved its
    second cell to the end. A unit test covers this.
  - `parseKey` reports `keyOrder: 'extractor' | 'repaired'`.
  - All four Pokémon fixtures assert `keyOrder === 'extractor'`, and assert that the repair leaves
    their extracted text unchanged line for line. The old read-across unit test still passes, as
    `'repaired'`.

### 5. Picked from the 04 lens by value
- **🎯 "Next stitch of this colour"** (parking lot). In the Chart sheet it jumps to the nearest
  stitch of the current colour still to do.
  - It zooms to at least 16 px a stitch, moves the crosshair there, and toasts "DMC 310 · Black ·
    col 117 · row 146 · 56,985 left".
  - Each press moves on to the next-nearest stitch it has not shown yet, so two neighbours never
    ping-pong. A tap on the chart starts over.
  - It says so when the colour is finished, or has no stitches on the chart.
- **The big button counts where the stitcher is (04 #15, impact 5).** In cells mode the next
  stitch is the first one still to do, in reading order, inside the crosshair's 10×10 block.
  When that block is finished, it moves to the block of the nearest stitch still to do
  (`XStitch.nextStitchNear`). Before, it filled from row 1 across a 224-wide chart.
  - The readout reads "block 15,25 · 4 left here · 3 / 12,711" instead of the crochet-style
    "Group 6 · stitch 5 of 10". Counts mode keeps the group readout.
  - **−1 takes back the stitch the button marked last** (`view.tapHistory`). It falls back to the
    old "last in reading order" only when that history is empty.
- **10×10 obeys an isolated colour (04 #13, partly).** With a colour isolated (◉), 10×10 marks only
  that colour in the block, and toasts "Marked 4 DMC 310 · Black stitches in this 10×10 block
  (isolated colour only)". With no colour isolated, it still marks every colour in the block,
  for people who work block by block.
- **A new FAQ entry**: "How do I find my place on a big chart?"
- **Colour-done celebration** already existed (`noteMilestones`: announce + toast +
  `celebrate('part')`). **Backstitch marking** already existed (the layer switch). I did not
  redo either.

## Contract

**`XStitch.normalize`, new or changed fields (all JSON-safe, all repaired on load):**
- `current.view: { z, x, y } | null`
  - `z`: CSS px per stitch, capped at `XStitch.VIEW_MAX_Z` (64).
  - `x`, `y`: the fractional stitch at the middle of the chart area, clamped to the chart.
  - `null` means open at Fit.
- `current.tool: 'tap' | 'paint' | 'block' | 'page'` (default `'tap'`).
- `current.layer: 'cross' | 'back' | 'knots' | 'part'` (default `'cross'`). The sheet falls back
  to Crosses when the chart has no such layer.
- `pages[i].region: { x, y, w, h, fx, fy, fw, fh } | null`
  - `x, y, w, h`: the cell range in chart stitches.
  - `fx, fy, fw, fh`: where that range sits on the page, as fractions of its width and height.
    All four are null when unknown, for example on a rotated page or when they fall off the page.
- `current.zoom` is unchanged and still unused.

**`XStitch.extractGrid` result.** It gains `regions: [{ page (1-based), region }]`, one per placed
tile (`tileRegion`, built from each tile's lattice and `page.view`). `[]` on failure.

**`XStitch.parseKey` result.** It gains `keyOrder: 'extractor' | 'repaired'`.

**New pure helpers on `window.XStitch`:**
- `centreOffset(i, n) → { k, side }`
- `positionLabel(x, y, w, h) → { col, row, grid, centre, block, text }`
- `rulerStep(z, minPx)`
- `pageForCell(pages, x, y)`
- `nearestCellOf(cells, w, h, value, x, y, skip)`
- `nextStitchNear(cells, w, h, value, x, y, done)`
- `VIEW_MAX_Z`
- `_key.expandCountColumns`, for the tests

**Non-undoable view writes (`saveViewState` in app-xstitch.js).** View details are written with
`Store.updateCraftData(id, fn, { undo: false })`, which takes no undo snapshot, does not bump
`updatedAt`, and goes through the normal save path:
- the remembered view, tool, layer and page
- the crosshair set by a strip tap or by 🎯

A plain `updateCraftData` snapshots every call, so a pan would flood the undo stack and Undo would
start undoing zooms. The view write is debounced to 300 ms and flushed when the sheet closes.
An earlier draft wrote `craftData.current` directly and called `Store.save()`. It was switched to
the store's option once that existed.
- Re-verified after the switch: 4 zooms, a pan and a tool change left `undoBytes` at 0 and
  `updatedAt` unchanged, and the view and tool were in localStorage.
- After a reload, the chart reopened on the same middle stitch with Drag selected.
- A stitch tap still made an undo entry.
- xstitch 752 and xstitch.fixtures 493 (+9 skipped) passed in fresh tabs.

## Verified in the pane (375×812)
The shared pane storage kept changing under me: projects vanished, the active project switched,
and page images were wiped mid-render. So the in-app work ran on `Store.__setKeyForTests(
'stitchkeeper-wavef-xstitch')` in my own background tab. rAF was shimmed with `setTimeout` while
the pane was hidden, because pdf.js page rendering waits on rAF. I removed the test key and my
projects and images afterwards.

- **xs-pacman (KG-Chart).** Import, grid, Use it: 22 pages kept, 20 with regions.
  - The region geometry was checked against the rendered page pixels. The printed grey at the
    predicted spot matches the chart cell's colour for 99.8% of 6,155 sampled stitches, against
    94% when shifted by one stitch either way. So the alignment is exact, not just close.
  - 📄 on col 116 · row 143 opened Page 9 (tile 3 of row 2), with the stitch outlined at the
    frame centre.
  - View persistence after Done and reopen: z 9.145 centred on (125.12, 152.75); 10×10 restored.
    `craftData.current` was written to localStorage, and the undo bytes were unchanged after
    several zooms and pans.
- **xs-pokemon-tr (KG-Chart, 98 colours, 298 × 500, 38 pages).** 36 regions.
  - Pixel check: 55% at the predicted spot, against 31% at ±1 stitch. The absolute figure is lower
    because the DMC table colours differ from KG's printed RGB. The peak is unambiguous.
  - 📄 on col 148 · row 248 opened Page 16 ("cols 103–153 · rows 169–252"). The screenshot shows the
    outline two columns left of the printed "150" and two rows above "250", as expected.
  - Tap button: from the crosshair in block 15,25 it walked (144,240), (147,240), (148,240),
    (144,241). −1 took back (144,241).
  - With DMC 310 isolated, 10×10 marked 4 stitches, all DMC 310; the other colours did not move.
  - The view and tool survived a reload.
- **xs-wocs-caterpillars.** Key + 4 pages (image mode). ⤢ on the strip opened the viewer.
  Double-tap zoomed to a legible key, and a drag panned.
- **xs-tinymodernist-welcome.** Six DMC rows (725 3609 3801 958 906 905). The Pages thumbnail
  opened the viewer.
- **Screenshots:**
  - Chart sheet in dark and light themes, at Fit and zoomed.
  - Strip at Fit (ruler steps 50 / 100).
  - Page viewer on Pacman and Pokémon.
  - Pages sheet with region captions.

  Everything fits at 375 wide. Five zoom-row buttons of 63 px each fit, and nothing scrolls
  sideways.

## Left, and why
- **The rest of 04 #13.** Scoping 10×10 to the current colour when it is merely current, and
  offering "whole block" as a second chip, needs a UI decision; isolated-only is unambiguous.
- **04 #5 (give the chart sheet the full screen), #16 (parking on the chart), #4 / #7 / #9–12 /
  #17 / #18.** Not attempted; #15 and the 📄 / 🎯 work came first by value. #16 is the natural
  next item, since the crosshair, the rulers and `positionLabel` are now there to build on.
- **"Render this page sharper"** (04 #14 risk). Pages are still 1400 px JPEGs, legible at about
  3× on a phone.
- **Not checked on a real touch device.** Pinch in the page viewer was exercised with synthetic
  pointer events only.
- **Regions on rotated pages.** They keep the cell range but have no outline (fractions are null).
  No fixture has one.

## For the owner of `js/store.js`
- Done: the silent variant `updateCraftData(id, fn, { undo: false })` now exists, and
  `saveViewState` uses it. Nothing is left open here.
- One thing seen in passing: once, `Store.__setKeyForTests('<new key>')` threw `Cannot set
  properties of undefined (setting 'builtIn')` in `seedTemplate`, via `normalizeTemplates` and
  `defaultState`. After a reload it worked. It may have been a mid-edit file; worth a glance.

## For the coordinator / docs agent
- **CRAFTS.md, cross-stitch section:**
  - the new fields under Contract
  - `extractGrid().regions`
  - `parseKey().keyOrder`
  - the "view state is written without undo" rule
- **HANDOFF:**
  - the 04 #1 / #2 / #3 / #14 / #15 items are live
  - item 14's "Pokémon key repair is only a fallback" and "foxy" are done
  - item 0's "keyboard path for the chart canvas" is still open; the page viewer has arrow keys
    and + / −, the chart canvas does not
- **Testing tip:** `Store.__setKeyForTests('<own key>')` gives an agent's tab its own state. With
  it, in-app checks survive other agents' test pages. Worth adding to "How to work on it".

## Files changed
- js/xstitch.js
- js/app-xstitch.js
- css/xstitch.css
- test/xstitch.test.html
- test/xstitch.fixtures.html
- docs/wave-f/xstitch.md
