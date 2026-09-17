# 04 — The cross-stitcher

Thirty minutes on a phone (375 × 812) with two real charts: `xs-pacman.pdf` (KG-Chart, grid reader
recovered all 64,512 cells in 1.4 s — genuinely better than anything free on iOS) and `xs-dmc-2173.pdf`
(DMC library, key only), plus a synthesised photo through Photo → chart (76 ms, ΔE 6.5, 233 → 0 confetti).
The engine underneath is strong: OXS export round-tripped 106 marked stitches, marking is 3.4 ms a tap
and 11 ms for a 10 × 10 block, Undo covers everything, and Fabric & size is the best fabric calculator
I have used on a phone.
What is missing is everything to do with *place*: once I zoom into a 224 × 288 chart there are no row or
column numbers, no centre arrows, no persistent coordinate readout, and closing the chart throws the
zoom away. And when the grid reader cannot read a chart — which is most commercial PDFs — I am left with
a 180 px unzoomable thumbnail of the page I am supposed to stitch from.
Fix position and the image-mode viewer and this beats Pattern Keeper on a phone; leave them and a
months-long chart is unstitchable after the first break.

---

## Proposals, ranked by impact ÷ effort

### 1. Rulers and a permanent position readout on the chart
**Problem.** I zoomed into the middle of the Pac-Man chart in the Chart sheet and had no idea where I
was. `drawGrid` (`js/app-xstitch.js:567`) draws minor lines and 10 × 10 majors and *no numbers at all*.
The one coordinate readout (`showCoord`, `js/app-xstitch.js:658`) only fills in after you tap a cell —
it read `col 113 · row 145` once and then sat there stale while I panned. There are no centre arrows
either, which every paper chart has. On paper the margins are numbered every 10; on the phone there is
nothing to count from, so "row 40, column 70" is unfindable.
**Proposal.** In `drawGrid`, when `z >= GRID_MIN_PX`, draw sticky gutters: a top strip and a left strip
in screen space (not chart space) carrying the column/row number at every major line, on a translucent
theme-background chip so they stay legible over stitches. Draw the design-centre arrows (▼ / ▶ at
`floor(w/2)`, `floor(h/2)`) at every zoom. Update the `.xs-coord` chip on `pointermove` and after every
pan/zoom with the cell under the canvas centre, not only on tap, and label it `col 113 · row 145 ·
block 12,15`.
**Effort** S · **Impact** 5
**Risks/notes.** Gutters eat ~22 px on each edge; make them overlay, not layout, so the canvas keeps its
size. Numbers need the same contrast treatment in all six themes.

### 2. Remember where I was
**Problem.** `makeChartView` keeps `st = { z, ox, oy }` as local state (`js/app-xstitch.js:426`) and
never writes it back. I verified: after nine zoom-ins, `craftData.current.zoom` was still `1`; I pressed
Done, reopened the chart and it was back at Fit with the tool reset to Tap. A page reload reopened the
project and the current colour, but the chart again at Fit. For a chart you work on for months, "find
your place after a break" is the whole job, and the app forgets it every single time.
**Proposal.** On `pointerup` / `zoomBy` / pan end, debounce (300 ms) a write of `{ zoom: st.z, cx, cy }`
into `craftData.current` via a non-undoable `Store.updateCraftData` path (or a `silent` flag so pans do
not flood the undo stack). On opening the Chart sheet or rendering the strip, call `centerOn(cx, cy)`
with the saved `z` instead of `fit()`. Persist the last mark tool per project too. Add a "Take me back"
chip on the strip that jumps to the last marked stitch.
**Effort** S · **Impact** 5
**Risks/notes.** Clamp the restored zoom to the sheet's current size so a rotate or a different device
does not restore an off-screen view.

### 3. Don't throw away the PDF pages when the grid reader wins
**Problem.** I chose "Try to read the grid (beta)" → "Use it" on the Pac-Man chart. Afterwards
`craftData.pages` was `[]`, the bottom-bar Pages button was disabled, and IndexedDB still held an orphan
`p:mu61459f-…:chartpage:0` that nothing references (a leak — `BlobStore.keys('')` shows it). The grid
reader reads full stitches only (HANDOFF item 8), so backstitch, French knots and the designer's notes
exist *only* on those pages — and I had just deleted them.
**Proposal.** Render and keep the pages regardless; make "Use it" additive (it adds `chart`, it does not
replace `pages`). Put a two-way toggle on the chart strip (▦ Chart / 📄 Page) so I can flip to the
original page for backstitch while keeping cell marking. Delete the orphan blob when a render result is
discarded.
**Effort** S · **Impact** 4
**Risks/notes.** Storage: 22 pages at ~300 kB is 6 MB. The cap of 40 pages and the existing usage
readout in the Pages sheet already cover this; say so in the toast.

### 4. One truth for stitch counts after a partial grid match
**Problem.** The grid reader matched "8 of 9 colours". Result: the project key list shows `DMC 349 ·
Coral Dark — no count yet` and `DMC 3843 · Electric Blue — no count yet`, the header reads
`106 of 59,512 stitches · 0%`, while the **Floss sheet for the same project still shows `DMC 349 · 176
sts` and `DMC 3843 · 4,824 sts`** from the PDF key. Two screens, two numbers. And when I selected DMC
3843 the header said "0 left" and the big tap button did nothing at all — a dead colour.
**Proposal.** Keep the key's `stitchCount` as a fallback when the grid has no cells for that palette
entry; label such rows "not found on the chart — counted by hand" and let them fall back to counts-mode
counting so the tap button still works. Compute the denominator once (`XStitch.progressStats`) and use
it in the header, the home card and the Floss sheet.
**Effort** S · **Impact** 4
**Risks/notes.** The mixed mode (some colours by cell, some by count) needs one clear line in the FAQ.

### 5. Give the full-screen chart the full screen
**Problem.** The Chart sheet's canvas measures 345 × 383 CSS px on an 812 px screen — 47 % of the
height. Above it: sheet handle, title, and a five-button tool row (Tap / Drag / 10×10 / Whole colour /
Unmark) that wraps to two lines. Below it: a −/Fit/+ row, two lines of permanent help text ("Drag to
pan, pinch or use the buttons to zoom…") and Undo/Done. At 8–12 px per cell that is about 30 × 32
stitches visible out of 224 × 288.
**Proposal.** Float the tool row as a compact segmented pill over the top of the canvas (icons, one
row), move zoom to pinch + double-tap with a small overlay −/Fit/+ in the bottom-right corner, demote
the help text to a first-run hint that dismisses, and let the canvas take the remaining height. Target
≥ 70 % of the sheet.
**Effort** S · **Impact** 4
**Risks/notes.** Keep the current buttons reachable for the no-pinch case (desktop, accessibility) — the
overlay zoom buttons cover it.

### 6. Show me the recovered grid before I commit to it
**Problem.** The beta reader's result card says "Read 224 × 288 stitches, 8 of 9 colours matched.
64,512 stitches in 1.4 s… any counts you have now are not carried over" and then a single **Use it**
button, with no picture of what it read. 224 × 288 = 64,512 is the *rectangle*, not the stitch count
(the real figure is 59,512); quoting it as "stitches" overstates the job by 8 %. The one unmatched
symbol is mentioned but never shown, and there is no way to say "that one is DMC 3843".
**Proposal.** Render the recovered cells to a ~200 px thumbnail inside the result card (the code already
has an `ImageData` path for the tap-button preview). List the unmatched symbol(s) as a row with its
sampled colour swatch and a picker of the key's unclaimed colours. Change the copy to
"59,512 stitches over a 224 × 288 grid".
**Effort** S · **Impact** 4
**Risks/notes.** None; this is presentation over data the reader already has.

### 7. Stop handing out ten near-identical symbols
**Problem.** My 10-colour Pac-Man palette got `· : ▪ ▫ ○ ◌ ◍ △ ▲ ●` — three rings, two squares, two
triangles, two dots. `assignSymbols` (`js/xstitch.js:863`) walks `SYMBOLS` from the front, and that list
is ordered lightest-ink-first, so its first ten entries *are* the confusable ones; the family rule only
prevents repeats between lightness-**adjacent** colours. At the 12 px threshold where symbols start
drawing (`GRID_MIN_PX * 1.5`, `js/app-xstitch.js:494`) `◌`, `○` and `◍` are the same blob on a phone.
There is also no symbol picker in the Edit colour sheet (brand / code / name / strands / stitch type /
count only).
**Proposal.** For palettes ≤ 24, select glyphs round-robin across `SYMBOL_FAMILY` (one dot, one round,
one square, one tri, one cross, one angle, one digit…) before reusing any family, keeping the
ink-weight sort *within* a family. Raise the symbol draw threshold to ~16 px, or draw a bolder stroke
below that. Add a symbol grid to the Edit colour sheet so I can swap a clash myself.
**Effort** S · **Impact** 4
**Risks/notes.** Changing assignment changes existing projects' symbols; only re-assign on import, or
offer "re-letter the symbols" as an explicit action.

### 8. Photo → chart: put the chart above the photo
**Problem.** The conversion itself is excellent — 76 ms, `233 → 0 confetti stitches`, ΔE 6.5. But the
sheet shows my *source photo* in a large crop frame at the top, then a "Keep the crop shape" switch,
and only then a 345 × 150 preview canvas in which the actual chart renders about 110 px wide, below the
fold. I cannot judge a 24-colour conversion from a 110 px letterboxed thumbnail: I cannot see the
symbols, the confetti, or which DMCs I would have to buy.
**Proposal.** After the first successful run, collapse the crop frame to a 64 px thumbnail with an
"Adjust crop" button and promote the result: full-width preview canvas, square-ish, pinch-zoomable,
with a press-and-hold "show the photo" compare. Under it, the palette as swatch + symbol + code + stitch
count chips, and a "colours over one skein: 5" line.
**Effort** S · **Impact** 4
**Risks/notes.** Keep the crop interaction reachable; the reflow must not re-run the conversion.

### 9. Linen and evenweave should default to over 2
**Problem.** The Pac-Man key says "16 ct linen". The importer set `fabric = { count: 16, kind: 'linen',
over: 1 }`, so Fabric & size reports the design as **14 × 18 in**; worked over 2, as linen almost always
is, it is 28 × 36 in and needs a completely different piece of fabric. The same sheet's own hint reads
"Evenweave and linen are normally worked over two, which halves the effective count" — the app
contradicts its own advice.
**Proposal.** In the key parser, when `kind` is `linen` or `evenweave` and the text does not explicitly
say "over 1", set `over: 2`. Surface it on the import preview as an editable chip — "16 ct linen, worked
over 2 → stitches like 8 ct. Tap to change" — so the stitcher confirms rather than discovers it later.
**Effort** S · **Impact** 3
**Risks/notes.** Some designers chart linen over 1 for petit point; the chip makes it a one-tap fix
either way.

### 10. Skein ranges that inform instead of frighten
**Problem.** The Floss sheet says `DMC 310 · 56,985 sts · 28–63 skeins` — a 2.25× spread I cannot buy
against — and the photo chart summary said "about 29 skeins" for a 100 × 133 chart, where 24 of those
are simply "at least one skein of each of 24 colours". Both numbers are technically honest and
practically useless at the shop.
**Proposal.** Render the range with a best estimate: "28–63 skeins (buy 40)". Split the total line into
"24 colours · 5 need more than one skein · about 40 skeins in all". Put the waste factor (`waste`, now
fixed at 0.2) behind Advanced in the Fabric sheet so a tight stitcher can drop it to 0.1.
**Effort** S · **Impact** 3
**Risks/notes.** Keep the "estimates are a range" caveat; just stop making the range the headline.

### 11. Confirm before a photo chart eats an imported key
**Problem.** I opened Photo → chart from inside the DMC 2173 project and pressed "Use this chart". It
silently replaced the 4-colour imported key with a 24-colour photo palette, switched `progress.mode`
from `counts` to `cells`, and left three now-meaningless PDF pages attached to the project. No sheet, no
toast, no warning. (Undo does recover it, which I verified — palette went 24 → 4.)
**Proposal.** When the project already has a palette or a chart, show a confirm sheet: "This replaces
the colour key and chart for *DMC 2173*, and your progress starts again. 106 stitches will be cleared."
with a second button, "Make a new project instead", which is what I actually wanted.
**Effort** S · **Impact** 3
**Risks/notes.** Reuse `ctx.confirmSheet`; add "your counts are safe in Undo" to the toast.

### 12. A home card and a progress line that move
**Problem.** After 106 stitches the home card read `Pac-Man sampler · 0 of 10 colours · 0%` and the
project header `106 of 59,512 stitches · 0%`. On a 60k chart "0 of 10 colours" will read zero for weeks
and "0%" for days. Worse, that progress line sits *under* the fixed bottom bar at 812 px — I had to
scroll to read my own total.
**Proposal.** Summary → `106 stitches · 0.2% · DMC 310 in hand`; show one decimal below 1 %. Add
"stitches this session" and a pace line ("about 320 an hour") from the existing timer and History. Make
the progress line sticky directly above the bottom bar rather than the last thing in the scroller.
**Effort** S · **Impact** 3
**Risks/notes.** This is the same overflow the UX sweep logged for the crochet counter below ~700 px;
one fix should serve both.

### 13. 10×10 and whole-colour marking should obey the colour I am holding
**Problem.** With DMC 310 current, one tap in 10×10 mode marked 95 cells in 11 ms — every colour in that
block, not just the black — with no toast and no count. A parker who has done the black in that block
and nothing else has just lied to the app about 80 stitches. Separately, "Whole colour" did nothing at
all when I tapped a cell whose colour had no cells (the unmatched DMC 3843), with no feedback.
**Proposal.** When a colour is isolated or current, scope 10×10 to "this colour in this block" and show
the alternative as a second chip. Always toast the result ("marked 14 black stitches · Undo"). Add
"this colour on this page" as the research proposed. Make a no-op mark say so ("no DMC 3843 here").
**Effort** S · **Impact** 3
**Risks/notes.** Keep an unambiguous "whole block, every colour" for people who work block by block.

### 14. A pinch-zoom viewer for chart page images
**Problem.** In image mode the chart page is a bare `<img class="xs-page-img">` inside a ~180 px frame
with a ‹ Page 2 · 2 of 3 › bar. No zoom, no pan, no full screen, no ⤢ button, and the bottom-bar Chart
button is disabled. With the DMC chart I was looking at a page of 8 pt trilingual text rendered 170 px
tall and could not read a single word, let alone a stitch. This is the state the app lands in for every
chart the grid reader cannot read — which is Spriter, DMC, scans and most commercial PDFs.
**Proposal.** Port the sewing module's pinch-zoom page viewer (`js/app-sewing.js`) into a shared helper
and use it here: ⤢ on the page frame, full-screen sheet, pinch/drag, double-tap to fit, swipe between
pages, page label and "mark this page done" in the sheet. Keep it reachable even when a chart exists
(see #3).
**Effort** M · **Impact** 5
**Risks/notes.** Rendered pages are JPEG at 1400 px; at 3× zoom on a phone they will soften. Offer
"render this page sharper" that re-renders the single current page at 2400 px on demand.

### 15. Count where I actually am, not from the top-left corner
**Problem.** In cells mode the big tap button walks the current colour's cells in raster order. I tapped
ten times and the cursor went from `cx 0, cy 0` to `cx 9, cy 0` — it filled in black stitches along row 1
of a 224-wide chart. Nobody stitches 56,985 black stitches in reading order across a 224-column chart;
you work a block, or a page, or a region. As shipped, the headline tap button is a "fill in from the
top-left" button, which is the one motion no cross-stitcher makes. The readout under it,
`Group 6 · stitch 5 of 10`, is borrowed straight from crochet and means nothing here.
**Proposal.** Give the counter a *scope*: default to the current 10 × 10 block (from `current.cx/cy`),
settable by tapping the chart ("count here"). The button then marks the current colour's remaining cells
inside that block, in reading order within the block, and auto-advances to the next block containing
that colour when the block is done. Readout becomes `block 12,7 · 6 black left here · 412 left in all`.
Offer "whole chart" as an explicit scope for people who really do work cross-country.
**Effort** M · **Impact** 5
**Risks/notes.** Needs a cheap per-block index; a `Map` of `blockKey → cell indices` per palette entry,
built lazily, is a few hundred kB at 224 × 288 and can be rebuilt on load rather than stored.

### 16. Parking that lives on the chart
**Problem.** Parking notes are add-and-delete only. "＋ Park a colour here" produced
`{ key: 'col 10, row 1', symbol: '·', corner: 'tl', note: 'DMC 310 · Black' }` — it guessed the cursor,
hard-coded the corner to `tl`, put the colour name into the `note` field (so there is nowhere left for a
note), and gave the row a single ✕ button with no edit. Nothing is drawn on the chart. A block parker
runs 5–15 parked threads at once and needs to see them *where they are*, which is the entire reason
Pattern Keeper records which corner of the square a thread sits in.
**Proposal.** Park from the chart: long-press a cell → "Park DMC 310 here" with a four-corner picker and
an optional note. Draw parked threads on the canvas as a small corner triangle in the floss colour with
the symbol beside it, at any zoom ≥ 8 px. In the sheet, sort by column (the order you meet them when
leapfrogging), let each row be tapped to jump the chart there, and auto-offer "unpark" when that cell
gets marked done.
**Effort** M · **Impact** 4
**Risks/notes.** Keep `parking[]` JSON-safe and small; 30 entries is nothing. Move the colour out of
`note` into a `paletteIndex` field and migrate in `normalize`.

### 17. DMC-library keys import as an all-backstitch project
**Problem.** `xs-dmc-2173.pdf` imported with an amber banner, "Read some of the key (4 colours)", and
gave me `DMC 3808 / 3831 / 501 / 3832`, **all four marked `kind: 'back'`, all "no count yet"**. The
project screen then reads "No stitch counts yet" with a tap button that counts nothing. Looking at the
extracted text, the cause is clear: the trilingual key repeats every label
(`point arrière` / `backstitch` / `punto atrás`), and the line "backstitch Use 1 strand" sits *above*
the block `3808 3831 / 501 3832`, so the section switch swallows the rest of the page — while the
cross-stitch block above it (`Use 2 strands`, code `E677`) was missed entirely.
**Proposal.** Before section detection, drop duplicate translation lines (a line whose neighbour within
two lines shares ≥ 60 % of its digit/code tokens, or which matches a small FR/ES label list). End a
section at the next technique **or strand** header rather than only at the next technique header. Accept
`E###` light-effects codes. And if zero `kind: 'cross'` entries survive a parse, do not import silently:
say "No cross-stitch colours found — this key is probably a picture. Import the pages and add colours by
hand?".
**Effort** M · **Impact** 4
**Risks/notes.** Cheap to test — the fixture is already in `tmp-pdf/` and `test/xstitch.fixtures.html`
runs against it.

### 18. Chart-page classification, and the page thumbnails the spec promised
**Problem.** All three pages of the DMC PDF were kept as chart pages, including a photograph of the
finished hoop and a page of instructions; the strip opens on the hoop photo labelled "Cover · 1 of 3",
so the first thing I see is a picture, not a chart. The import preview has no page thumbnails and no
chart / not-chart toggles (research §B4.2 step 4 called for them).
**Proposal.** Show a thumbnail strip in the import preview with a chart/not-chart toggle per page, and
default `current.page` to the first page classified as a chart rather than page 0. Tighten the
classifier with a cheap raster check on the rendered canvas — a chart page has a strong periodic
vertical/horizontal edge histogram; a photo does not.
**Effort** S · **Impact** 2
**Risks/notes.** Keep every page available even when flagged not-a-chart; classification only sets the
default view and the Pages ordering.

---

## Needs infrastructure

These are worth wanting, but none of them is a "small code item"; each needs a new capability before the
UI work is even worth scoping.

- **Backstitch and knots out of a PDF.** The grid reader recovers coloured rectangles only
  (HANDOFF item 8). Backstitch is strokes on the vertex lattice and would need a second pass over the
  operator list collecting line segments, snapping them to half-cell coordinates and matching them to
  the key's backstitch rows. Until then, #3 (keep the page images) is the workaround — and the layer
  switch in the chart viewer has nothing to switch to on a PDF import.
- **Joining tiled chart pages into one continuous chart.** Pattern Keeper's headline feature. For image
  mode it needs page geometry (overlap detection between rendered pages); for grid mode it needs
  `extractGrid` to run across pages and stitch the lattices together by their margin numbering. Large,
  but it is the single thing that would make image mode competitive.
- **A stash that spans projects.** `craftData.stash` and the per-colour "I own DMC 310" checkboxes are
  per project, so the same skein is owned three times over. A real stash belongs in
  `Settings.crafts.crossstitch` (skeins owned per code, decremented by project needs) with a "kit up"
  view; that is a new shared data model plus a settings screen.
- **Progress on the printable chart.** Known (HANDOFF item 4). `printableHTML` would need the done
  bitmap and a hatch/greyed cell style, plus a "print only what's left" option — which is the thing I
  would actually take on a train.
- **Page images in the backup.** Known (HANDOFF item 10). Today the backup carries `craftData` but not
  BlobStore, so a restored project loses every chart page; a zip export (or a second `.blobs` file) is
  the fix, and it is the difference between "exportable" and "safe".
- **Anchor / Madeira swatches.** `hexFor` is DMC-only, so an Anchor chart imports with grey swatches and
  the chart renders in greys. Needs a second RGB table with a licence check, or a conversion table with
  an explicit "approximate" label.
- **Keyboard and screen-reader path for the chart canvas.** Carried over from the UX sweep. A 50k-cell
  canvas with pointer-only marking has no non-pointer route at all; arrow-key navigation with a live
  `col/row/colour` announcement is a real feature, not a tweak.
