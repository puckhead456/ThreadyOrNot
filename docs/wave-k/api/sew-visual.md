# API: sewing visuals (wave K, sew-visual worker)

Status: **BUILT** (2026-11-12). Files: `js/sew-figures.js` (`window.SewFigures`), `js/sew-quilt.js`
(`window.SewQuilt`), tests `test/sew-visual.test.html` (synthetic always; `?real=1` adds the
tmp-pdf fixtures). Neither file touches the DOM, storage or pdf.js at load. Feature-detect:
`if (window.SewFigures)`, `if (window.SewQuilt)`.

Load order: after `js/pdftext.js`, `js/blobstore.js` and `js/sewing.js` (all optional at runtime;
functions that need one resolve empty / `null` without it). `sew-quilt.js` uses `SewFigures` for
`loadImage` only. **Not yet in `index.html` / `sw.js`** (shell-ui's lines; asked in the report).

## Coordinates
Page units are points, **origin top-left, y down** (as `docs/wave-k/api/pdftext.md`). Every rectangle
this API stores or returns is **normalised** `{x0, y0, x1, y1}` in 0..1 of the page, so it crops a
stored page JPEG of any width: `sx = r.x0 * img.width`.

## PageInfo (input of every pure function)
```
PageInfo = { page, width, height,
             lines:   [{ text, box }],               // box {x0,y0,x1,y1} page units
             images:  [{ box, id }],
             drawings:[{ box, paths?, fills?, strokes?, kind? }],
             captions?: [PdfText Caption],            // used when present
             shapes?:  [Shape], outlines?: [{poly, box}] }   // only with {shapes:true}
Shape = { poly:[[x,y],…], box, fill:'#rrggbb'|null, image:id|null, stroke:boolean }
```
`SewFigures.readPages(handle, pageNumbers, {signal, onProgress(done,total), shapes:false})`
→ `Promise<{ [n]: PageInfo }>`. Uses `handle.layout(n)` when present (shapes false), else reads
pdf.js directly through `handle.doc`. `shapes:true` always reads pdf.js directly and adds
`shapes` (filled outlines, prints clipped into outlines) and `outlines` (stroke-only paths): needed
for the quilt layout and for flat-colour swatches. Cancellable (rejects `AbortError`); a page that
fails is left out. Measured: 0.1–1.3 s per booklet (Harmony, 17 pages: 4.3 s).

## 1. Step → figure (P1 / S4)
`SewFigures.link(steps, pages, {minConfidence: 0.6})` → `[FigureLink]`, pure, sync, one per step
in order (`steps` = `craftData.steps` or `parse().steps`: `{id, text, page}`). Under 10 ms per booklet.
```
FigureLink = { index, stepId, page,               // page may be page+1 for a captioned figure
               mode: 'figure' | 'page' | 'none',
               rect: nbox | null,   // 'figure': the step's own drawing(s)
                                    // 'page': framed round the step's text (null: text not found → whole page)
               parts?: [nbox],      // when the step has several figures: each alone, top to bottom;
                                    // rect is then parts[0] (drawings separated by the step's own
                                    // paragraphs are never joined into one column chunk)
               text: nbox | null,   // the step's own text on its page
               aspect: number|null, // rect width / height in page units
               confidence: 0..1,    // 'page'/'none' are 0
               reason: string,      // plain words, e.g. 'caption "Fig. 7"', 'drawing beside the step',
                                    // 'figures 7, 8, 9, 10 by their order on the page',
                                    // 'no drawing near this step',
                                    // "the page's figures are numbered, and which is which could not be read"
               ref: 'Figure 3' | null }
```
Rules, in order: (1) a caption the step names ("Fig. 7", "DIAGRAM B1", a number printed inside a
drawing), on its page or the next; (1b) numbered figures printed inside pictures, when the page's
steps name exactly as many figures as the page has pictures (k-th picture = k-th figure); (2) a
drawing in the step's own column space or level with its lines in an empty column, owned only when
no other step has a close claim. Drawings are joined into one crop only when joining takes in no
line of prose; otherwise `rect` is the first and `parts` lists each. A page whose steps name numbered figures that neither (1) nor (1b)
can place gives every step `'page'` (a nearby picture there is as likely the step before's). No
figure crop ever holds another step's text (asserted on every fixture).

`SewFigures.renderCrops(projectId, links, source, opts)` → `Promise<[Crop|null]>` (same order).
- `source`: `{ handle }` (a `PdfText.open` handle; draws the region straight from pdf.js with
  the print intent, so a hidden tab still draws) or `{ pages: craftData.pages }` (crops the stored
  page JPEGs).
- `opts`: `{ signal, width: 750, maxPixels: 1.2e6, quality: 0.82, onProgress(done,total),
  modes: ['figure'] }` (add `'page'` for the framed-page crops).
- `Crop = { index, blobKey, mode, aspect, w?, h?, cached }`. Key `p:<projectId>:fig:<page>:<hash>`;
  an existing key is reused (2nd call: 5 ms for 11 crops). One canvas alive at a time.
  Sundress: 11 crops in 0.8–2.2 s. Rejects `AbortError` when `signal.cancelled`/`aborted`.
To cut the other figures of a step, pass `{ page: link.page, rect: link.parts[k], mode: 'figure' }` objects.
`SewFigures.cropKey(projectId, link)` → the key. `SewFigures.deleteCrops(projectId)` → `Promise`
(removes `p:<id>:fig:` and `p:<id>:swatch:`).

## 2. Fabric swatches (P12 / S1)
`SewFigures.swatches(fabric, pages)` → `[Swatch]` (pure; one per `craftData.fabric` row, same order)
```
Swatch = { index, name, label:'A'|'', code:'OHM-33447'|'', page|null, rect: nbox|null,
           clean: boolean, reason }
```
Joins by letter "(A)" / "Fabric A", or by printed code (case-insensitive; a one-letter slip such as
OHM/OMH is accepted and named in `reason`); a page mapping "Fabric A  OMH-33447" joins letter rows
to coded pictures. A page needs 3+ labelled pictures to count as a swatch page. Two rows naming
the same fabric (Binding — Fabric A) share its picture and stay clean. Pass pages read with
`{shapes:true}` to include flat-colour (solid) squares. Fixtures: Harmony 16/16 lettered (2 backings
have no picture), Joyous 13/13, Catwalk 20/20.
`SewFigures.captureSwatches(projectId, swatches, source, {signal, px: 96, onProgress})`
→ `Promise<[SwatchBitmap|null]>`, `SwatchBitmap = { index, blobKey:'p:<id>:swatch:<i>', colour:'#rrggbb', spread: 0..1, clean }`
(`clean` false also when the crop came out as blank page). `SewFigures.colourOf(imageData)` → `{colour, spread}`.

## 3. Tape-up map (P5)
`SewFigures.sheetTapeMap(text, pages)` → `TapeMap|null`: **use this.** It returns
`Sewing.readSheet(text).tiles` when sew-core reads one (`source:'text'`), else this file's own
reading from label positions (`source:'positions'`).
`SewFigures.tapeMap(pages)` → `TapeMap|null` (positions: the same registration label on two pages
places one against the other).
`TapeMap = { rows, cols, tiles:[{label, page, row, col}], gaps, loose, conflicts, ok, source }`
(sew-core's adds `rowLabels, colLabels, missing, marks, ownLabels, firstPage, check`).
`SewFigures.mountTapeMap(el, map, { done:{ [label|page]: true }, onTap(tile), title })`
→ `{ el, update(done), destroy() }`. SVG; tiles are `role="button"` `g.sew-tape-tile` (`.is-done`,
`aria-pressed`), Enter / Space tap. `done` may be keyed by label (`craftData.sheet.taped`) or page.

## 4. Step picture in the button (S4)
`SewFigures.mountButtonPicture(buttonEl, { blob | canvas | url, dim: 0.28 })` → `{ set(src), clear(), destroy() }`.
Inserts `span.sew-btn-pic[aria-hidden]` first in the button (button gets `.sew-btn-pic-host`;
`position:relative` only if it was static). `set` cross-fades (none under reduced motion).

## 5. Quilt top (P11 / S2) — `window.SewQuilt`
`SewQuilt.findLayout(pages, fabric)` → `{ page, model } | null`: pages read with `{shapes:true}`;
a page that names itself the layout wins. `SewQuilt.fromShapes(pageInfo, fabric, {fills})` → `QuiltModel|null`.
`SewQuilt.findPicture(pages)` → picture `QuiltModel|null` (a page saying "quilt layout" / "join
rows" with one big picture). `SewQuilt.pictureModel(page, nbox, why)`.
```
QuiltModel = { mode:'vector'|'picture', page, box: nbox, region:{page units}, pageW, pageH, w, h,
               patches:[{ id, poly, box, fill, image, fabric, block, row }],
               blocks: [{ id, label, box, patches:[i], row }],
               rows:   [{ id, label, n, box, patches }],
               labels: 'blocks'|'rows'|'none', reason }
```
Use: vector model with `labels !== 'none'` → block-by-block; otherwise mount the picture
(`findPicture` or the vector model's region) and it fills in as a whole. Fixtures: Harmony p12 →
17 labelled blocks (B1, B2a–d, B3 ×4, C ×4, H ×4), 238 patches; Joyous p6 → picture; Catwalk → none.
`SewQuilt.progress(model, craftData, prevProgress)` → `{ byBlock:{id:0..1}, done, total, fraction,
mapping:'units'|'blocks'|'rows'|'steps'|'order', newest:id|null }`. Joins: "Block 3" counters ↔
B3 (n blocks share a counter's target), `Sewing.quiltTop(d).blocks[].step` ↔ that step's done,
steps naming "Row 3" / "Block B2a", else the overall fraction in reading order (`'order'`). A
"Unit 2a" counter never lights the block B2a (units are parts). Pass the previous result to get `newest`.
`SewQuilt.loadImage(projectId, model, source, {signal, width:1200})` → `Promise<ImageBitmap|null>`
(the model's page region, cached in BlobStore under `p:<id>:fig:`; Harmony 1200×1177 in 2.6 s).
`SewQuilt.mount(canvas, model, opts)` → controller
- `opts`: `{ image, progress, swatches:{[fabricIndex]: CanvasImageSource}, onTapBlock(block),
  reducedMotion, label }`. Without `image` a vector model is drawn from its fills.
- controller: `{ setProgress(p), setImage(img), setSwatches(map), fit(), zoomBy(f), hit(x,y),
  view(), redraw(), destroy() }`.
- Draws only on change (an rAF loop only while the newest block's 0.7 s reveal runs). Drag pans,
  wheel / pinch zoom, keys `+` `-` `0` arrows (canvas gets `tabindex=0`, `role=img`, an
  `aria-label` "Quilt top: 3 of 17 blocks made."). Chrome from `--surface-2`, `--surface`,
  `--border`, `--primary`, `--text`, `--font-body`. When every block is made the whole top
  (sashing too) is in colour. Picture mode: the picture fading up with a % ring; label says
  "This layout is a picture, so it fills in as a whole."

## 6. Active unit in the button (S3)
`SewQuilt.mountUnit(el, { name, done, target, model?, block?, image? })` → `{ el, update(state), destroy() }`.
Appends `span.sew-unit-pic[aria-hidden]`: a 56 px picture of the block (clipped from `image`, or
its fills) or a count ring, plus "Unit 7a · 2 of 4". The button's own label is the accessible name.

## 7. Cutting board to scale (S5)
`SewQuilt.parseDims(str)` → `{ w, h, unit:'in'|'cm'|'mm', wof } | null` (`3½" x WOF`, `2 1/2" x 42"`,
`6 3/4" tall x 7 5/8" wide`, `2½" squares`, `10 x 20 cm`). `SewQuilt.parseMeasure('3½')` → 3.5.
`SewQuilt.boardModel(cutting, fabric, {width:42})` → `{ groups:[{ key, name, letter, pieces,
undrawn, rects:[{item,x,y,w,h,n,cut,sub}], height, drawn }], undrawn, width }` — groups by
"Fabric X" (from `note` / piece) else material; WOF strips take a shelf each with their subcuts
inside; loose pieces shelf-packed; pieces without dimensions listed, never drawn.
`SewQuilt.mountBoard(el, cutting, { onTap(row), swatchColours:{letter:'#hex'}, width })`
→ `{ el, update(cutting), destroy() }`: `div.sew-board` > per fabric `section` (h4 "Fabric B · 4 of
12 cut", an SVG with one `g.sew-board-piece[role=button]` per row, `.is-cut` when all cut, and a
`p.sew-quilt-note` "To scale on 42" fabric. One way to cut it; the yardage is the pattern's."),
undrawn pieces as `button.sew-board-piece`. A tap reports the row; the app counts the cut.

## CSS hooks
`.sew-btn-pic`, `.sew-btn-pic-host`, `.sew-unit-pic`, `.sew-tape`, `.sew-tape-tile(.is-done)`,
`.sew-board`, `.sew-board-piece(.is-cut)`, `.sew-quilt-note`. The files inject one
`<style id="sew-visual-css">` with positioning only; colours are theme variables.
