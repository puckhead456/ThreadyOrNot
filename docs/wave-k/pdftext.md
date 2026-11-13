# Wave K: pdftext — page structure for the craft readers

Owner of `js/pdftext.js` and `test/pdftext*.html` (new: `test/pdftext.layout.test.html`,
`test/pdftext.corpus.html`). No other file edited. Contract: `docs/wave-k/api/pdftext.md`.

## What the user sees
Nothing directly: this is engine work the craft readers build on. What it makes possible:
the step's own figure under a sewing step (P1, S4), "my size only" pattern sheets (P5), real fabric
swatches (P12/S1), the quilt layout page (P11/S2), symbol-font charts read in one step with the
designer's own symbols (02 #6, #9; R5), finding the chart on a busy page (02 #8, R2) and page
thumbnails labelled chart / key / photo / instructions (shell items 6/7).

## The contract as built (all additive)
- `handle.layout(n)`: every text line with its box (page units, top-left, y down, and 0..1), font
  name, size, column and reading-order index (`lines` say exactly what `textOf(n)` says, in its
  order); image draws (box cut to the clip, pixel size, layer); drawing regions (clusters of
  painted paths, each described as grid / swatch / figure / rule / box, with fill and stroke
  colours, counts, and for a grid its cells and pitch); captions ("Figure 3", "Fig. 3", "DIAGRAM B1")
  joined one to one to the nearest picture or drawing; layers used; a page-kind hint; timings.
- `textIn(n, rect)`, `find(n, re)`.
- `glyphs(n)`, `chart(n)`, `PdfText.glyphGrid` / `chartFonts`: each glyph's font, code, unicode,
  box and advance; symbol-font charts as a lattice keyed by base font + code.
- `renderGlyph(fontId, code, {px})`: one glyph of an embedded font as a sprite.
- `layers()`; `renderPage` / `renderRegion` with `layers: {only|on|off}`.
- `renderRegion(n, rect, {scale|dpi|maxSide, budgetMs, signal, imageData})`, capped at 2048² px
  and 4096 px a side (`clamped`), `renderTiles` for bigger asks, `renderImage` for one picture.
- Hidden pane: `PdfText.canPaint()`; `renderRegion` draws through pdf.js's **print intent** (no
  `requestAnimationFrame`) when frames are not firing and says so (`region.intent`), or rejects
  with `HiddenError` ("The page is hidden, so it can't be drawn right now.") on `whenHidden: 'fail'`.
- `pageKinds()`: chart / key / photo / instructions / sheet / layout / cover / blank, with a
  confidence and reasons, one page at a time.
- **OCR lines (asked by ocr):** `handle.setPageText(n, Ocr.toTextItems(...))` gives a picture page
  its OCR lines; `textOf` / `layout` / `textIn` / `extract` carry them, layout lines say
  `ocr: true`, and `extract()` reports `ocrPages: [n…]`. A page with real text (20+ characters of its
  own) is refused with a reason and never overwritten; `setPageText(n, null)` takes them off.
- **`renderRegion({width})` / `{height}` (asked by sew-visual):** an exact pixel width or height.

## Text output unchanged (measured)
`test/pdftext.corpus.html?heavy=1` hashes every `extract()` result (text, pages, columns, empty
pages, garbled, ocrNoise). Before the change and after: **106 / 106 fixtures identical**
(the 76 fixtures that landed during the wave have no "before"; their after-hashes are the new
baseline, corpus fingerprint `be98b408016fd886` over 182 files, re-checked after `setPageText`;
`extract()` results now also carry `ocrPages`, `[]` when no OCR lines are attached). The only text-pipeline edits are
two extra fields on row items (`font`, `box`) and a `geo` on pageLines' lines, which readDoc and
textOf never copy.

## Measured results (real fixtures, assertions in `test/pdftext.layout.test.html`)
- **Symbol-font charts (02 #6).** Which fixtures have them: Tiny Modernist **foxy** (Ursasoftware,
  Wingdings, Wingdings2, Arial-Black, Arial), the **Pokémon** quadrants (two symbol fonts) and
  **DMC 2168** p2. The other Tiny Modernist files are not symbol-font charts: halloween,
  homestitchhome and matryoshka are vector cells, welcome and autumn are pictures. Results:
  foxy 68 × 68 (the printed size), 2507 cells, 9 symbols, every glyph on the lattice, no clashes;
  Pokémon TL p3 53 × 72, 10 symbols; DMC 2168 p2 83 × 116, 11 symbols.
- **The designer's own symbols (02 #9, R5).** `renderGlyph` draws all 9 foxy symbols from the
  embedded fonts. Against three page crops of each symbol's cells: worst IoU 0.69, typical
  0.82–0.95, and no cell looks more like another symbol than its own (asserted ≥ 0.6, 0 confusions).
- **Ruled chart grids (02 #8, R2).** halloween 49 × 35, homestitchhome 54 × 76, foxy 68 × 68 (all the
  printed sizes; a centre arrow one pitch outside the grid used to add a column, now only long
  lines count). Matryoshka reads 85 × 70 lines (printed 81 × 66: not asserted, needs a look).
  Pokémon / Pac-Man / Portal KG tiles 53 × 77 at 7.37–7.40 pt; DMC 2168 83 × 116.
- **Layers (P5).** jogger 12M–6: 8 layers (12M, 18M, 24M, 3T, 4T, 5T, 6, "Print for all sizes");
  jogger 7–12: 7; one size only draws visibly less ink than all sizes (asserted); the sundress sheet
  says `none: true`; the A0 apron is a "sheet" with "841 x 1189 mm" in its reasons.
- **Pictures and captions (P1, P11, P12, S1, S2, S4).** Harmony p2: 18 square fabric pictures (the
  brainstorm's count); Harmony p8–p11: Fig. 1–14 each found once (the double-printed ones too) and
  each joined to the picture under it (gaps 1.5–16 pt); Harmony p12 = layout (16 clipped fabric
  pictures); Joyous p7: DIAGRAM B1–B3 on their drawings, the "(DIAGRAM B 1)" inside a step is not a
  caption; Joyous p6 "DIAGRAM 3" names the layout picture; Catwalk p2: 12 vector swatches, each one
  flat colour.
- **Positions (P1).** sundress p6 "1. Sewing the Bodice:" is in the left column (nbox x1 < 0.55) and
  `textIn` of its box reads it back.
- **Page kinds.** Pokémon TL: 70 chart, 1 key, 1 cover of 72; Harmony: cover, key, 13
  instructions, sheet (the template page), layout; Satsuma sunshine p1 photo (it is a picture chart:
  known miss, see below); Samford p6's ruled size table is not a chart.
- **Time and memory** (`?measure=1&heavy=1`, desktop Chrome, shared machine; `ms` = wall time incl.
  the pdf.js worker, `main` = main-thread share):

  | file | pages | total | per page median / max | main thread max | heap max |
  |---|---|---|---|---|---|
  | knit-interweave-8-socks | 34 | 11.8 s | 187 / 2334 ms | 1062 ms (196 ms rerun alone) | 33 MB |
  | crochet-allfree-stitches-ebook | 56 | 2.8 s | 31 / 574 ms | 78 ms | 14 MB |
  | sew-freespirit-harmony-quilt | 17 | 5.3 s | 222 / 1340 ms | 59 ms | 5 MB |
  | xs-pokemon-tl | 72 | 32.9 s | 424 / 1787 ms | 1065 ms (185 ms rerun alone) | 38 MB |
  | crochet-stylecraft-guide | 5 | 2.6 s | 482 / 850 ms | 105 ms | 12 MB |
  | xs-apl-orr-book14 (39 MB scan) | 24 | 31.6 s | 1128 / 3134 ms | 18 ms | 0 MB |

  The 1 s main-thread peaks were under load from other agents; the same pages alone take ~190 ms.
  A page's work now yields once in the middle (a message, so hidden tabs are not timer-throttled),
  so the longest single block is the walk or the region pass, not both. On a phone expect 3–5×:
  a 50k-operator chart page is ~0.5–1 s of main thread in two pieces. `layout(n, {graphics:false})`
  is the cheap path (text only).

## Tests and counts
| suite | before | after |
|---|---|---|
| pdftext.test | 166 passed, 2 failed (timing, machine busy), 3 skipped | 168 passed, 0 failed, 3 skipped (2 heavy, 1 frame-dependent while the pane is hidden; 169 / 2 with it shown) |
| pdftext.layout.test (new) | — | 192 passed (incl. setPageText 21 and width 2; +6 with `?measure=1&heavy=1`) |
| pdftext.corpus (new, fingerprint) | 106 files | 106 identical + 76 new (182 files, last run after setPageText) |
| patterns.test | 1112 | 1112 |
| knits.test | 385 | 419 (the knitting workers' new tests) |
| knit-chart.test | 151 | 151 |
| patterns.fixtures | 905 | 905 |
| knits.fixtures | 530 (11 known) | 568 (11 known; the knitting workers' new cases) |
| xstitch.fixtures | 462 passed, 5 failed (xs-core's half-saved `tileGraphics`), 9 skipped | 582 passed, 0 failed, 9 skipped (an earlier run under load failed 11 Pokémon time budgets, 26–31 s against 15 s; green on the re-run) |
| sewing.fixtures | 789 | 871 passed, 0 failed |

Verified in the pane: none of this has UI. The tests ran in one real tab (the headless runner's
virtual-time budget runs out while the pdf.js worker works: every PDF page prints "running…"
headless; the pure pages run headless fine).

## Left, and why
- A chart that is a **picture** (TM welcome / autumn, Satsuma) reads as `photo`: telling them apart
  needs pixels (the XSRead detector), not structure. Consumers should run their own reader.
- Matryoshka's ruled grid is 85 × 70 against the printed 81 × 66: unverified.
- `renderImage` gives a re-rendered crop, not the decoded bitmap, once a page has been cleaned up
  (pdf.js never resends a page's pictures). The crop is at the picture's own density.
- The glyph lattice's origin is the glyph centre, which sits off the ruled cell centre; use the
  ruled grid to crop cells (the test does).
- Backstitch / knots as graphics (02 #10): `layout` gives stroked paths with colours, but not yet
  the segment-level lattice snapping; that belongs with xs-core's vector reader.
- OCR line order is Tesseract's: `setPageText` keeps the order it is given (no column
  untangling of OCR lines). Give it one column at a time on two-column scans, as ocr.md advises.

## For the owner of `sw.js` / `index.html`
Nothing new to precache: no new runtime file.

## Decisions for the coordinator
- The headless runner cannot run PDF pages (virtual time races the pdf.js worker). Running them in
  one real tab works; a runner that waits on real time (e.g. polling `#summary` over the DevTools
  protocol) would fix it.
