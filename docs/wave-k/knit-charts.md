# Wave K — knit-charts report (picture charts)

Owner of `js/knit-chart.js`, `test/knit-chart.test.html`, NEW `test/knit-chart.pictures.html`.
Interface: `docs/wave-k/api/knit-charts.md`. Status: stopping point for the deploy (may resume).

## What was built
- **Picture-chart finder, opt-in.** `KnitChart.pictures(handle, opts)` and `KnitChart.scan(handle,
  { pictures: true })`. Without `pictures: true` every result is unchanged (suites below).
- **Pixel half in a Web Worker** (`PicCore`, built from its own source into a Blob URL like
  `js/xstitch-read.js`; main-thread fallback). Thin ruled lines are found as ridges (a pixel darker or
  lighter than both pixels 2-3 px away), joined into lines, lines that cross form lattices, the pieces
  of one broken lattice are joined when their lines sit on its phase, glyph strokes are dropped (a
  piece must be long or run from rule to rule), a frameless chart's outer row / column is added when
  the rules run on past the last rule. Then each cell's middle is sampled: flat colour, or paper plus
  a symbol; colour classes clustered in Lab; ink beside each row (row numbers in the picture).
- **Positive evidence only.** `picture-grid` needs an even lattice (≥ 70 % of its lines really
  drawn, no off-lattice rules) with flat / two-tone cells. Confidence adds row numbers (text layer or
  ink), a title naming a chart, the pattern's own word ("chart", "diagram", "mønster"; "size chart"
  does not count). `picture` (no rows) needs a title naming a chart. Photos and schematics give no
  lattice.
- **Measured**: rows, cols, pitch, row-number side and which rows carry a number (`labelSide`),
  `calib` (the grid as a two-mark calibration, so the band works with no marks), and for colour
  charts `cells` + `legend` of colour classes (key label when the key's swatch is matched in the text
  layer, else a plain colour name; unclassed cells `'?'`).

## Ledger (`test/knit-chart.pictures.html`, assertions; charts counted by eye on headless renders)
| fixture | present | found | kind | rows × cols right | false pos. | ms / page |
|---|---|---|---|---|---|---|
| cascade-color-yoke (p5) | 4 | 4 | picture-grid, colour | yes: 6×16, 6×17, 6×24, 4×10, all named | 0 | ~815 |
| sandnes-bernies-mittens (p3, whole-page picture) | 1 | 1 | picture-grid, colour | yes: 20×46 | 0 | ~1080 |
| cascade-mens-retro-fairisle (p5) | 1 | 1 | picture-grid, colour | 13×46 (cols by eye 12-st repeat + 1; rows match the labels) | 0 | ~830 |
| cascade-cable-yoke (p7, p8) | 2 | 2 | picture-grid, symbols | 21×51 yes; 23×63 (not checked cell by cell) | 0 | ~850 |
| redheart-fair-isle-hat (photos only) | 0 | 0 | — | — | 0 | ~460 |
| cascade-intarsia-skirt (p4, hand-drawn) | 1 | **0** | — | — | 0 | ~350 |
| **total** | **9** | **8** | | **8 measured** | **0** | |

Row numbers are not read yet (`rowNosRead: false`, rows numbered 1..N from the bottom; the ink beside
the rows is seen, e.g. odd rows on the right in the cable yoke). Key colours: the retro key's labels
are in the picture, so its classes carry colour names ("dark brown", "yellow 2"), not A–K.

## Suites (baseline before my first edit → now)
| suite | baseline | now |
|---|---|---|
| knit-chart.test | 151 / 0 | **162 / 0** (11 new: synthetic colour chart lattice, photo, schematic, names, key labels) |
| knit-chart.pictures (new) | — | **20 / 0** (the ledger) |
| knits.fixtures | 595 / 0 (11 known) | 595 / 0 (11 known) |
| knits.journey | 66 / 0 | 66 / 0 |
| knit-ui.test | 112 / 0 | 131 / 0 (another worker's additions; one run read 111/1 mid-save, green on re-run) |

## Not done (left for a resume)
- The skirt: a hand-drawn chart the page never names (rules are wobbly, no columns). Plan: offer the
  largest line-art drawing as `picture` when the pattern says "chart" and nothing else was found.
- Reading row numbers in the picture (`XSKeyRead.readNumbers` on the ink boxes) and text-layer
  numbers are wired (`textRowNumbers`) but not proven on a fixture.
- The ledger rows for the old vector fixtures (Interweave, Sandnes 0216, Bernat, Japanese lace…):
  covered by knit-chart.test / knits.fixtures as before, not yet re-counted in the pictures page.
- The coordinator's vector item (8-socks Stranded Boot Stockings Leg chart, page 34, an unread cell
  on row 2): not looked at yet.
- Not looked at in the app UI (the app does not ask for pictures yet: see asks).

## For the owner of js/app.js (paste-ready)
In `knitAttachCharts`: `return KC.scan(handle, { signal: { cancelled: false }, pictures: true });`
and add to `KNIT_CHART_KEYS`: `'kind', 'confidence', 'reasons', 'calib', 'colour', 'imageBox', 'rowNosRead'`.
Cost: about 0.3-1 s a page more in the background scan (pictures only; text pages are cheap).

## For the owner of js/app-knitting.js
In `drawOnPage`: a chart with `kind === 'picture-grid'` and no `cells` should use its own
`ch.calib` (already the stored calibration shape, so `calOf()` works once app.js keeps it); the note
should say "placed from the grid the app measured" instead of "from your two marks" when
`ch.kind === 'picture-grid'` and the knitter has not re-marked. Colour picture charts have `cells`, so
the band, colour strip and bobbins work through the existing vector path.
