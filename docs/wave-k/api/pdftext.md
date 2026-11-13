# API: `window.PdfText` page structure (wave K, pdftext worker)

Status: BUILT (`PdfText.LAYOUT_VERSION === 1`). Everything here is **additive**:
`PdfText.extract`, `handle.extract`, `textOf` and `renderPage` (without the new options) give the
same output as before, byte for byte over the whole `tmp-pdf` corpus (`test/pdftext.corpus.html`).
Feature-detect: `if (handle.layout) …`. Tests: `test/pdftext.layout.test.html`.

All new calls live on the handle from `PdfText.open(file, {signal})`. Every call takes an optional
`{signal}` (`{cancelled}` or an AbortSignal; rejects with `.name === 'AbortError'`); a closed handle
rejects with "That PDF has been closed."

## Coordinates
- **Page units**: points of the page as it is shown (pdf.js viewport at scale 1: `/Rotate` applied,
  **origin top-left, y down**). `box = {x0, y0, x1, y1}`.
- **Normalised**: `nbox = {x0, y0, x1, y1}` in 0..1 of the page width / height (same origin).
  To crop a stored page image W px wide: `x = nbox.x0 * W`.
- `rect` arguments: `{x0,y0,x1,y1}` (or `{x,y,w,h}`) in page units, or with `norm: true` in 0..1;
  `null` = the whole page.

## 1. Positions
`handle.layout(n, {signal, glyphs:false, graphics:true})` → `Promise<PageLayout>` (the last 8 pages
are cached on the handle):
```
{ page, width, height, rotate,
  lines: [{ i,            // reading order, the order textOf / extract use
            text,         // exactly textOf(n)'s line (lines.map(text).join('\n') === textOf(n))
            box, nbox,
            font,         // PostScript name, subset tag dropped ("Avenir-Book"); '' without graphics
            fontId,       // pdf.js id ("g_d0_f3"): the key for glyphs / renderGlyph
            size,         // font size in page units
            col,          // the column pageLines put it in
            margin }],    // in the top / bottom 8% (running heads, folios)
  images: [ImageDraw], drawings: [Drawing], backgrounds,   // count of page-sized grounds left out
  captions: [Caption], layers: [layerId], fonts: { [fontId]: FontInfo },
  chart: { cols, rows, cells, pitchX, pitchY, fonts, symbols, fit } | null,  // symbol-font lattice
  kind: PageKind,
  glyphs: [Glyph],        // only with {glyphs:true}
  stats: { ms, mainMs, textMs, walkMs, regionMs, ops, items, glyphs, paths, segments } }
```
`ms` is wall time (mostly waiting on the pdf.js worker); `mainMs` is the main thread's share. The
work yields once in the middle (a message, so a hidden tab is not held back by timer throttling).
`graphics:false` skips the operator list (no images / drawings / glyphs / font names; cheap).

- `handle.textIn(n, rect)` → `Promise<{ text, lines:[{text, box, nbox, fontId, size}] }>`: the text
  items whose centre lies in `rect`, grouped into lines top to bottom.
- `handle.find(n, re | string)` → `Promise<[line]>` (a string matches case-insensitively).

## 2. Page structure
```
ImageDraw = { id|null, op, box, nbox, px:{w,h}|null, mask, inline, layer|null, clipped, colour }
            // box is cut to the clip; clipped: the clip trimmed it (a fabric patch in a quilt)
Drawing   = { box, nbox, paths, fills, strokes, rects,
              fillColours:[{hex, n}], strokeColours:[{hex, n}],   // most used first, ≤ 8
              kind: 'grid' | 'swatch' | 'figure' | 'rule' | 'box',
              grid: { cols, rows, pitchX, pitchY, x0, y0, drawn:'lines'|'cells' } | null,
              layer|null }
            // grid.cols/rows are CELLS; x0,y0 the first line (or first cell's corner)
Caption   = { text, line:i|null, box, ref:'Figure 3'|'Diagram B1'…, label, target:{type, index}|null, gap }
```
- Captions are lines **starting** "Figure / Fig. / Diagram / Diag. / Illustration / Chart / Photo /
  Picture / Image" + a label ("3", "B", "B1"); "(Figure 3)" inside a step is a reference, not a
  caption. "Fig. 2   Fig. 2" on one baseline is two captions; one printed twice in place is one.
  `line` is null when the extractor dropped that label as a figure callout. Each caption gets at
  most one target and each target at most one caption (nearest first; above/below beats beside);
  full-page grounds and page-edge strips are never targets.
- `handle.renderImage(n, index, {maxSide:1024})` → `Promise<canvas>` with `canvas.image = {w, h,
  rendered?}`. The decoded bitmap when pdf.js still holds it; otherwise (pdf.js never resends a
  cleaned-up page's pictures) the crop rendered at the picture's own pixel density and resampled to
  its pixel size (`rendered: true`).

## 3. Layers (optional content)
`handle.layers()` → `Promise<{ none, layers:[{id, name, visible, intent}], order }>`; a PDF without
optional content gives `{none: true, layers: []}`.
`renderPage(n, {layers, …})` and `renderRegion(n, rect, {layers})`:
`layers: { only:[name|id] } | { on:[…] } | { off:[…] }` (exact name, then any case). Unknown names
come back as `canvas.region.layersUnknown` / `canvas.layersUnknown`. `renderPage` without `layers`
/ `whenHidden` is the old call, unchanged.

## 4. Glyphs (symbol fonts)
`handle.glyphs(n, {rect, font})` → `Promise<{ page, width, height, fonts, chartFonts:[fontId], glyphs:[Glyph] }>`
```
FontInfo = { id, name, base, embedded, type3, hasToUnicode, symbolic }
Glyph    = { font:fontId, base, code, unicode, box, nbox, advance, size, space, invisible, run, layer }
```
- `handle.chart(n, {rect, fonts})` → `Promise<Lattice|null>`:
  `{ page, cols, rows, pitchX, pitchY, x0, y0 /* centre of cell (0,0) */, cells,
     symbols:[{key:'Ursasoftware:2', font, base, code, unicode, count}], grid:[[symbolIndex|-1]],
     fit, clashes, offCell, fonts }`. Symbol identity is **base font name + code**, so a key's
  symbol column (another subset of the same font) matches the chart cells without recognising
  anything. Default fonts: `chartFonts` (fonts set one symbol to a cell, or standing on a lattice).
- `PdfText.glyphGrid(glyphs, {fonts, rect})` is the same, pure; `PdfText.chartFonts(glyphs)`.
- `handle.renderGlyph(fontId, code, {px:24, pad:2, colour, fit:true})` → `Promise<canvas|null>`:
  the glyph's outline from the embedded font, fitted into px × px; `canvas.ink` is its ink box in em.
  `null` for Type3 / not-embedded fonts or a glyph never seen by `layout`/`glyphs` on this handle.
- The glyph lattice's (x0, y0) is the glyph centre, which can sit off the ruled cell's centre: to
  crop a cell from the page, use the ruled grid (`drawings[k].grid`) when there is one.

## 5. Region rendering
`handle.renderRegion(n, rect, opts)` → `Promise<canvas | ImageData>` with
`.region = {page, box, scale, clamped, intent, layersUnknown}`.
`opts = { scale | width | height | dpi | maxSide | maxWidth, maxPixels, layers, signal, budgetMs, imageData,
          background:'#fff'|false, whenHidden:'print'|'fail'|'wait', intent:'print' }`
- Precedence: `scale`, then `width` (exact px across; height follows), then `height`, then `dpi`,
  `maxSide`, `maxWidth`.
- Cap: `PdfText.MAX_RENDER_PIXELS` (2048² px) and `MAX_RENDER_SIDE` (4096 px); a bigger ask lowers
  the scale and sets `clamped: true`.
- `handle.renderTiles(n, rect, opts, onTile(canvas, {i, col, row, box, px}))` → `Promise<{tiles,
  cols, rows, scale}>`: tiles under the cap, one at a time; each tile is freed after `onTile` returns
  (or its promise settles) unless `opts.keep`.
- `budgetMs`: rejects with `.name === 'TimeoutError'`; cancel rejects with `AbortError`.
- **Hidden pane**: pdf.js's display intent waits on `requestAnimationFrame`. `renderRegion` probes
  first (`PdfText.canPaint()` → `Promise<boolean>`, cached 1.5 s); when frames are not firing it draws
  with pdf.js's print intent (no rAF) and says `intent: 'print'`. `whenHidden: 'fail'` rejects with
  `.name === 'HiddenError'`, message "The page is hidden, so it can't be drawn right now.";
  `'wait'` keeps the old behaviour (waits for frames).

## 6. Page kind hints
`PageKind = { guess, confidence (0..1), reasons:[string], scores:{kind: 0..1} }`, guesses
`'chart' | 'key' | 'photo' | 'instructions' | 'sheet' | 'layout' | 'cover' | 'blank'`.
`handle.pageKinds({signal, maxPages, onProgress})` → `Promise<[{page, guess, confidence, reasons,
scores, ms, mainMs, ops, heap}]>`, one page at a time, yielding between pages. A hint only.
Known misses: a chart that is a **picture** reads as `photo` (TM welcome, Satsuma); a ruled table
with big cells is never a chart.

## Pure helpers (tests and other workers)
`PdfText._pageGraphics(ol, OPS)`, `_drawingRegions(paths, W, H)`, `_captions(...)`,
`_pageKind(layout)`, `_periodOf(positions, minPitch, jitter)`, `_latticeOf(positions, pitch)`,
`_itemBox(item, width)`.

## OCR lines on a picture page
`handle.setPageText(n, items)` → `Promise<{ ok, lines, reason?, cleared? }>`, `items` = what
`Ocr.toTextItems(result, {scale, pageWidth, pageHeight, offsetX, offsetY})` builds (each needs
`text`, and `box` or `nbox`; `margin`, `size`, `conf`, `words` are kept).
- **Never overwrites real text**: a page whose own text (furniture left out) has 20 or more
  non-blank characters answers `{ok: false, reason}` and keeps its text.
- After it: `textOf(n)` is the OCR lines joined by `\n` (in the order given); `layout(n).lines`
  are those lines with `ocr: true`, `font: 'ocr'`, `fontId: null`, `conf` (images / drawings / kind
  still come from the page); `textIn(n, rect)` filters them (`{ocr: true}` on the result);
  `extract()` puts them on page n (`emptyPages` no longer lists it) and reports
  **`ocrPages: [n…]`**, which the UI must turn into "read from a picture — check every row".
- `setPageText(n, null)` (or `[]`) takes them off (`cleared: true`); `handle.ocrPages()` lists the
  pages carrying OCR lines now. Lines live on the handle only (not stored, not shared).
- `extract()` results always carry `ocrPages` (`[]` with no OCR); with nothing attached every
  other field is byte-identical to before (corpus fingerprint).
