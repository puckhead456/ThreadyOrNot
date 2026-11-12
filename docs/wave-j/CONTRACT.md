# Wave J contract — chart reader, key + written rows, app flow

Three workers build against these names at the same time. Code defensively against the other two
(`window.XSRead` or a new `XStitch` function may not exist yet when you test): feature-detect,
degrade quietly, never crash. Shapes below are binding; internals are yours.

Workers and ownership
- **reader**: NEW `js/xstitch-read.js` (`window.XSRead`), NEW `test/xstitch-read.test.html`.
- **key**: `js/xstitch.js`, `test/xstitch.test.html`, `test/xstitch.fixtures.html`.
- **app**: `js/app-xstitch.js`, `css/xstitch.css`, and (Edit only, one line each) `index.html`
  (script tag for `js/xstitch-read.js` right after `js/xstitch-photo.js`) and `sw.js`
  (`./js/xstitch-read.js` in `PRECACHE_URLS`; never hand-edit `CACHE_VERSION`).

---------------------------------------------------------------------------------------------------

## 1. `window.XSRead` (reader)

Pure image arithmetic, deterministic, cancellable, runs in a Web Worker built the way
`js/xstitch-photo.js` builds its own (a blob URL from `String(fn)`; main-thread fallback when
Workers are unavailable). No network, no model weights, no dependency. Uses `window.XStitch`
(`FLOSS`, `nearestFloss`, `hexToLab`, `assignSymbols`, `normalize`, `packCells`) on the main
thread for the final XSData, exactly as the photo converter does.

```js
XSRead.isAvailable() -> boolean
XSRead.version -> string
XSRead.read(source, opts, onProgress) -> Promise<Result>
XSRead.detect(source, opts) -> Promise<Detect>     // locate + lattice only; cheap, for live UI
XSRead.cancel(token)
```
`source`: `ImageData` | `HTMLCanvasElement` | `HTMLImageElement` | `ImageBitmap` | `Blob`/`File`.

```js
opts = {
  crop:    { x, y, w, h } | null,   // source pixels; null = find the chart rectangle
  size:    { w, h } | null,         // declared design size in stitches; null = detect
  lattice: { x0, y0, pitchX, pitchY } | null,  // user-adjusted lattice (source px, sub-pixel); wins over detection
  key:     KeyEntry[] | null,       // parseKey entries (see §2): code, brand, name, hex, stitchCount
  fabric:  'auto' | 'none' | '#rrggbb',   // auto: the ground colour is unstitched; none: every cell is a stitch
  mode:    'auto' | 'colour' | 'symbol',
  maxColors: 60,
  assign:  { [classId]: entryIndex | 'fabric' } | null,  // the user's manual class → key choices, applied before matching
  token:   string
}

Detect = {
  ok, reason, message,
  crop: { x, y, w, h },                       // the chart rectangle found (or the one given)
  lattice: { x0, y0, pitchX, pitchY },        // sub-pixel
  size: { w, h }, sizeSource: 'declared' | 'detected' | 'user',
  confidence: 0..1,                           // of the lattice
  alternatives: [{ w, h, confidence }],       // other plausible sizes (half / double pitch)
  style: 'blocks' | 'blocks-grid' | 'blocks-symbols' | 'stitched' | 'symbols-bw' | 'unknown',
  ms
}

Result = Detect fields, plus {
  data,                    // XSData from XStitch.normalize: w, h, full cells, palette with floss + symbols
  classes: [{              // one per colour / symbol class found, largest first
    id, count, hex,        // hex: the class's own mean colour as seen in the picture
    entry: index | null,   // matched KeyEntry index; null = unmatched
    fabric: boolean,
    how: 'count' | 'colour' | 'count+colour' | 'user' | 'nearest-dmc' | null,
    deltaE: number | null,
    glyph: { w, h, data: Uint8ClampedArray } | null   // representative cell, for the assign UI
  }],
  check: Check,            // §3, same shape as XStitch.checkCounts
  cellConf: Uint8Array,    // w*h, 0..255, how sure each cell is
  lowCells: number,        // cells under the low-confidence threshold
  preview: { w, h, data: Uint8ClampedArray },   // flat render of what was read, 1..4 px per stitch
  stats: { ms, phases: {locate, lattice, sample, cluster, match}, worker: bool, colors, warnings: [] }
}
```
Failure is a value, never a throw: `{ ok: false, reason, message }` with `reason` one of
`'no-image' | 'too-small' | 'no-grid' | 'not-a-chart' | 'too-many-colors' | 'cancelled'` and a
plain-language `message` the app can show as is. A pitch under 3 px is `'too-small'` with a message
that asks for a bigger picture. A read can be `ok: true` and still be low-confidence: say why in
`stats.warnings` and let `check` speak.

What the reader must cope with (each needs a synthetic test and, where a real one exists, a real one)
- Flat colour blocks; blocks with thin grid lines and bold 10-lines; blocks with a symbol drawn in
  each cell; a "stitched look" render (each cell an X of thread with ground showing in the gaps);
  black-and-white symbol charts (`mode: 'symbol'`).
- Non-integer pitch from 3.5 px to 40 px, different in x and y by up to 2%; JPEG / WebP artefacts;
  slight blur; a page around the chart (title, rulers, legend, margins, a phone screenshot's UI).
- A declared size (the normal case from a PDF: "Design size: 144 x 85 stitches") and no declared
  size (a bare screenshot).
- Fabric: the ground colour, which may fill most of the chart and is not a floss.
- Colours: cluster what is actually in the picture first, then match clusters to the key jointly on
  colour distance (CIEDE2000 against each entry's hex; the publishing software's RGB for a floss
  is NOT the DMC table's, so colour alone is weak) and on count agreement with `stitchCount`
  (strong). One-to-one assignment. With no key: nearest DMC per cluster, `how: 'nearest-dmc'`.
- Symbol charts: cluster cells by glyph shape; map classes to key entries by `stitchCount`; classes
  that cannot be matched stay `entry: null` with a `glyph` so the app can ask the user. Never guess.
- Out of scope this wave (list it as left): perspective / skewed phone photos of paper, charts
  split across several pages as rasters, backstitch and fractional stitches.

Budgets: a 2000 x 1500 px picture reads in under 1.5 s on desktop in the worker; `detect` under
300 ms. Same input and opts always give the same output.

Ground truth for `test/xstitch-read.test.html`
1. Synthetic: draw known grids (random ones and shapes with long runs, confetti, single-cell
   details, a near-empty chart) on a canvas in every style above, then degrade (non-integer
   scaling, `toBlob('image/jpeg', q)`, blur, margins, rulers). Assert cell-exact recovery where the
   pitch is 6 px or more, and state the measured rate below that.
2. Vector truth: the seven KG-Chart fixtures in `../tmp-pdf` are recovered exactly by
   `XStitch.extractGrid`. Render the same pages with pdf.js to a canvas and read them with
   `XSRead`; compare cell by cell against the vector result. (Runtime fetch only; see
   `test/xstitch.fixtures.html` for how fixtures are loaded and skipped when absent.)
3. The acceptance case: `../tmp-pdf/xs-potatoes-preview.webp` with the key and size from
   `../tmp-pdf/xs-potatoes.key.json`. Print read vs printed count for each of the six colours and
   the total. Target: every colour within 2% and the total within 1%. Assert what you achieve with
   a small margin, and report the real numbers either way. Also run it with no declared size and
   report whether 144 x 85 is detected.
4. The image-only fixtures (`xs-satsuma-*-color.pdf`, the Tiny Modernist and DMC charts that the
   vector reader cannot read): render, read, and report what happens. No assertion beyond "does not
   throw and says something true"; put the table in your report.

---------------------------------------------------------------------------------------------------

## 2. `window.XStitch` additions (key)

`parseKey(text, opts)` already returns entries carrying `stitchCount` where a key prints one.
- **The "Floss list" layout** (the owner's PDF; text in `tmp-pdf/xs-potatoes.key.json`,
  `keyTextAsPrinted`, is the coordinator's transcription, so tolerate column order and spacing
  variations, a missing Symbol column, and the symbol glyph arriving as a stray character or code):
  heading `Floss list for crosses` (also `for half stitches`, `for backstitches`, `for french
  knots`, `for beads` → the existing section kinds), a header row `N Symbol Number Name Stitches`,
  rows `1 DMC 04 Tin - Dark 100`, and `Use 2 strands of thread for cross stitch` → strands.
  Every entry gets `stitchCount`. The PDF's own colour name is kept.
- **DMC 01–35** (the 2017 colours; HANDOFF lists them as having no swatch or name): add them to
  the floss table with names and approximate hex values, marked approximate in the same way the
  table's header already says every DMC colour is. Codes print as `04` and `4`; both must resolve.
- **`XStitch.designSize(text) -> { w, h, source } | null`**: `Design size: 144 x 85 stitches`,
  `Stitch count: 144w x 85h`, `144 x 85 stitches`, `Size: 144 by 85` and the forms the existing
  fixtures use (reuse and extend whatever size reading already exists; do not fork it).
- **`XStitch.checkCounts(data, entries) -> Check`** (§3): compares the chart's per-palette-entry
  cell counts with the key's printed `stitchCount`s. Pure.
- **Written instructions**
```js
XStitch.writtenRows(data, opts) -> {
  w, h, from, dir, color,
  rows: [{
    y,                 // 0-based row in the chart
    n,                 // 1-based label in the chosen order (row 1 = top, or bottom when from:'bottom')
    rtl: boolean,      // this row is worked right to left (serpentine)
    stitches,          // stitched cells in this row (of the chosen colour, when one is chosen)
    runs: [{ p, n, x }]   // p: palette index, or -1 for unstitched ("skip"); n: length; x: 0-based start column in chart space
  }],
  totals: { rows, stitches, emptyRows }
}
opts = { from: 'top' | 'bottom', dir: 'ltr' | 'serpentine', color: paletteIndex | null,
         skipEmpty: boolean, yFrom, yTo }     // color: a one-colour pass (everything else is "skip")
XStitch.rowText(row, data, opts) -> string
   // "Row 12 (left to right): skip 3, 5 × DMC 310 Black, 2 × DMC 842, skip 4"
   // opts.names: 'code' | 'code+name' | 'symbol'; leading and trailing skips kept (they place the first stitch)
XStitch.rowDone(data, y, opts) -> boolean        // every stitched cell of the row (or of opts.color in it) is marked done
XStitch.cellsOfRow(data, y, opts) -> number[]    // the cell indices a "row done" tap should mark
```
  Row progress has no state of its own: a row is done when its cells are done in the existing
  progress bitmap, so the chart, the tap button and the written rows always agree.
  Budget: `writtenRows` on a 300 x 300 chart under 30 ms.

---------------------------------------------------------------------------------------------------

## 3. `Check` (shared shape; produced by `XSRead.read` and by `XStitch.checkCounts`)

```js
Check = {
  hasCounts: boolean,          // the key printed stitch counts at all
  rows: [{ entry, code, brand, name, hex, read, expected, delta, pct, ok }],
        // entry: KeyEntry index; expected: null when the key gave none; ok: exact, or within tolerance
  unmatchedEntries: [index],   // key colours with no cells
  unmatchedClasses: number,    // colour / symbol classes with no key entry
  readTotal, expectedTotal,    // stitched cells; expectedTotal null without counts
  exact: boolean,              // every row with an expected count matches it exactly
  agree: 0..1,                 // share of expected stitches accounted for
  verdict: 'exact' | 'close' | 'off' | 'unchecked',   // close: every row within max(2, 1%)
  summary: string              // "All 6 colours match the key exactly (5,721 stitches)." / "4 of 6 colours match; DMC 310 reads 1,812 of 1,839."
}
```

---------------------------------------------------------------------------------------------------

## 4. App flow (app)

Entry points
1. **A picture.** The cross-stitch import surfaces (new project, and the project's import / drop
   zone) accept `image/*` files, a drop, and a clipboard paste. A picture goes to
   `XSRead.detect` first: a confident lattice opens **Read a chart picture**; otherwise the user is
   asked which they meant ("A chart, one square per stitch" / "A photo to turn into a chart" → the
   existing photo converter). Never route silently to the wrong one.
2. **A PDF whose chart the vector reader cannot read** (`extractGrid` not ok, or far from the
   key's counts). Offer "Read the chart from the page pictures": render candidate pages with the
   `PdfText` handle at a scale that gives at least 8 px per stitch when the size is declared (cap
   the canvas at a sane size), prefer the page whose detected lattice matches the declared design
   size (the whole-design preview page in the owner's PDF), and read it with the parsed key and
   size. Chart pages that hold only a tile of the design are out of scope this wave; say so in the
   UI rather than importing a tile as the whole chart.
3. The key screenshot alone (no PDF) cannot be read without OCR: when there is no key, the reader
   names colours by nearest DMC and the review screen lets the user fix each one (floss search
   already exists) and type the key's stitch counts if they want the check.

**Review screen** (a sheet or a full-screen step; phone first, 375 x 812)
- The picture with the lattice drawn over it and the read preview beside or under it (toggle or
  split), pinch / scroll zoom reusing the chart viewer's conventions where practical.
- Size steppers (w, h) prefilled from the declared or detected size, lattice nudge (offset and
  pitch), the crop frame (reuse the photo converter's), fabric auto / none / pick.
  Any change re-runs `XSRead` (debounced, cancelling the run in flight).
- **The count table**: one row per key colour: swatch, code, name, read, printed, ✓ or the
  difference; the verdict line from `check.summary` on top; unmatched classes with their `glyph`
  and a control to assign each to a key colour, to fabric, or to a floss search result.
- Low-confidence cells outlined on the preview with a count ("37 squares are unsure").
- "Use this chart" creates or replaces the project's cells through `XStitch.normalize` and
  `Store.updateCraftData` (undoable), keeps the key's names, strands and counts, records
  `craftData.source = { kind: 'picture', check: {verdict, summary, readTotal, expectedTotal} }`
  (or the nearest existing field; follow what the photo converter records), and stores the source
  picture in BlobStore the way chart pages are stored so the user can look back at it.
- A project made this way shows the verdict where the PDF import's confidence banner shows today
  ("Read from a picture. All 6 colours match the key." / "…2 colours are off; open the chart
  check."), with a way back into the review screen.

**Row by row** (written instructions; works for every cross-stitch project with cells, however
they were imported)
- A sheet from the chart menu and from the project's tools: rows listed with run chips (swatch,
  symbol, count; "skip n" chips muted), the current row (the first not done) scrolled into view
  and readable at arm's length, a big **Row done** control that marks `XStitch.cellsOfRow` in the
  progress bitmap (one undo step), and un-done on a second tap.
- Options kept per project in view state (`{undo: false}`): start from top / bottom, left to
  right / back and forth, all colours / one colour at a time (the colour picker is the key),
  hide empty rows.
- "Copy as text" (clipboard) for the whole chart or the current colour, using `XStitch.rowText`.
- Tapping a row jumps the chart viewer's crosshair to that row.
- One FAQ entry ("Can it read a picture of a chart?") and one tour step, in the module's existing
  FAQ / tour registration. Screen-reader labels and keyboard paths per the module's conventions.

Messages are plain and specific: what was read, what does not match, what to try (a bigger
picture, type the size, pick the fabric colour). No jargon ("lattice", "cluster") in the UI.
