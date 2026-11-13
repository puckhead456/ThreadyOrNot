# API: knit-charts (wave K): picture charts in `window.KnitChart`

Owner: knit-charts. Files: `js/knit-chart.js`, `test/knit-chart.test.html`, NEW
`test/knit-chart.pictures.html`. Report: `docs/wave-k/knit-charts.md`.
Everything here is **additive and opt-in**: `KnitChart.scan(handle)` / `fromHandle` without the new
option give exactly the results they gave before (vector, glyph and `image` charts, byte for byte).

## 1. Finding picture charts

```js
KnitChart.scan(handle, { pictures: true, signal, pages, onProgress })  -> Promise<[{ page, charts }]>
   // as before, plus the picture charts found on each page (section 2). An old `source: 'image'`
   // chart whose box a picture candidate covers is replaced by that candidate.
KnitChart.pictures(handle, { pages, signal, charts, onProgress, budgetMs }) -> Promise<[{ page, charts, ms }]>
   // only the picture candidates (charts = the vector scan's result, so a picture already read as
   // a vector chart is not offered twice). Needs handle.layout and handle.renderRegion (PdfText
   // wave K); without them it resolves [] (no picture charts, never an error).
KnitChart.measurePicture(imageData | {w, h, data}, opts) -> Promise<Lattice | null>
   // the pixel half on its own (tests, other crafts): runs in a Web Worker; main-thread fallback
KnitChart.pictureAvailable() -> boolean   // the handle calls exist and a worker can be built
```

`onProgress({ page, of })` once per page. The pixel work (ridge lines, lattice, cell colours) runs
in a Web Worker built from the function's source (a Blob URL, as `js/xstitch-read.js` builds its
own); without workers it runs on the main thread in one go per picture (about 20-60 ms).

## 2. The candidate (a Chart, so every existing caller can hold it)

```js
{
  name: 'Lower Body Chart' | 'Chart for sizes XS, S, M, L' | null,   // the caption / title read; null = none
  page,
  source: 'picture-grid' | 'picture',   // same value as kind
  kind:   'picture-grid'                // the lattice was measured in the pixels: rows, cols, pitch
        | 'picture',                    // only words / numbers say it is a chart: rows NOT known
  image: true,                          // a picture: the app cannot write rows out from it
  confidence: 0..1,
  reasons: ['an even grid of 20 × 46 squares', 'row numbers 1 to 46 down the right', 'the pattern says "diagram"'],
  bbox:  { x0, y0, x1, y1 },            // PDF points, y UP (the same frame as vector charts):
                                        // the grid itself for picture-grid, the picture for picture
  imageBox: { x0, y0, x1, y1 },         // the whole picture it was found in, PDF points, y up
  // picture-grid only:
  cols, rows, pitch: { x, y },          // pitch in PDF points
  startRow: 1, rowStep: 1, rowNos: [1..rows],
  rowNosRead: true | false,             // false: the numbers were not read, rows are numbered 1..rows
  labelSide: { 1: 'right', ... },       // where row numbers are printed (text or ink), as vector charts
  calib: { top, bottom, rows, x0, x1, first, step },   // the measured grid as a two-mark calibration
                                        // (fractions of the page, y down): KnitChart.rowBand(chart, n,
                                        // chart.calib) bands a row with no marks from the knitter
  colour: true | false,                 // the cells are flat colours (stranded / intarsia chart)
  cells:  [[sym]] | null,               // colour charts only: cells[0] the BOTTOM row, cells[r][0] the
                                        // LEFTMOST column; sym 'c1'.. a colour class, '?' not classed.
                                        // null for symbol charts (cables, lace): symbols are not read
  legend: [{ sym: 'c1', meaning: 'A' | 'brown', color: 'A' | 'brown', fill: '#8b5a2b',
             kind: 'colour', count, fromKey: true | false }],
  spans: [], repeatBox: null, repeats: [], marks: [], unknown: [], noStitch: null, readRS: 'rtl'
}
```

- `legend[i].color` is the key's own label ("A", "MC", "CC1") when the key's swatch was matched by
  colour (`fromKey: true`); otherwise a plain colour name ("brown", "light grey"). `colourRuns`,
  `keyColours` and the colour strip work on it unchanged. A cell that could not be classed is `'?'`
  (`colourRuns` counts it as unknown).
- Every `rowCells` token of a picture chart is unknown (the stitch is not read), so `rowText` is
  null and `rowInfo(...).unknown > 0`: the store shows no stitch count, the sheet says "read it from
  the chart" (today's wording for `image`).

## 3. What the screen should do with each kind

| kind | band on the row | colour strip / bobbins | knitter does |
|---|---|---|---|
| `vector` / `glyph` | `rowBand(chart, n)` (pt) | from cells | nothing |
| `picture-grid`, `colour: true` | `rowBand(chart, n)` (pt, from the measured grid, as vector) | `colourRuns` | nothing; may re-mark |
| `picture-grid`, symbols | `rowBand(chart, n, chart.calib)` (frac): no marks needed | none | nothing; may re-mark |
| `picture` | needs the two-mark calibration (today's flow) | none | marks top and bottom rows once |

Wording: a `picture-grid` band is "placed from the grid the app measured" (not "from your two
marks"); `picture` keeps "Mark the top and bottom rows once…". Show `reasons` behind a "Why is
this a chart?" line if wanted; a low `confidence` (< 0.5) candidate can be offered as "This picture
may be a chart" with the same flow.

## 4. Asks (paste-ready text is in docs/wave-k/knit-charts.md)
- `js/app.js`: call `KC.scan(handle, { signal, pictures: true })` and keep the new fields in
  `KNIT_CHART_KEYS` (`kind`, `confidence`, `reasons`, `calib`, `colour`, `imageBox`, `rowNosRead`).
- `js/app-knitting.js`: use `chart.calib` when `chart.kind === 'picture-grid'` and there are no
  cells, and say "placed from the grid the app measured".
