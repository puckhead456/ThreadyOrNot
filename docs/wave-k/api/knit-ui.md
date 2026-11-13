# API: knit-ui (wave K): `window.AppKnitting` additions, `KnitChart` row geometry

Owner: knit-ui. Files: `js/app-knitting.js`, `js/knit-chart.js`, `css/knitting.css`,
`test/knit-chart.test.html`, `test/knit-ui.test.html`. Report: `docs/wave-k/knit-ui.md`.
Knitting only. Crochet never reaches any of this (every entry point returns unless
`project.craft === 'knitting'`). Everything feature-detects the store / parser calls it uses
(`Store.stretchInfo`, `Store.lineInfo`, `Store.measureInfo`, `Knits.shaping` …) and paints
exactly today's screen when they are missing.

## 1. The hook into the counter (one call in `js/app.js`)

The knitting screen is the shared counter (`js/app.js` §14b). knit-ui paints its pieces into
the nodes that already exist, so the working-mode HUD (which mirrors `.knit-extra`, the pattern
tag and text) shows them with no further change.

```js
// craft registration field (js/app-knitting.js registers it)
def.counterPaint(project, part, host) → void
host = {
  extra,         // the .knit-extra node under the pattern line (app.js has just filled it)
  patternLine, patternTag, patternText, patternNotes,   // els.* of the pattern line
  rowLabel,      // els.rowLabel
  finished       // partFinished(part)
}
```

**Asked of the owner of `js/app.js`** (paste at the very end of `updateKnitWidgets`, after the
"+ marker" block):

```js
    // wave K (knit-ui): stretch, resolved repeat, panels, chart strip, colours, shaping
    var kdef = craftDefs[KNIT_ID];
    if (kdef && typeof kdef.counterPaint === 'function') {
      try {
        kdef.counterPaint(p, prt, { extra: knitEls.extra, patternLine: els.patternLine, patternTag: els.patternTag,
          patternText: els.patternText, patternNotes: els.patternNotes, rowLabel: els.rowLabel, finished: finished, hook: true });
      } catch (eK) { /* the counter stays as it was */ }
    }
```

That line is in `js/app.js` (shell-ui.md §11); the paint runs from it only (no watcher).

Also painted (later additions): `.knit-yarn-chip` "🎨 Use the chart’s colours (MC, CC1)" (P11),
`.knit-mirror-chip` "↔ Write it out from Right Front, mirrored" / "↔ Worked out by the app from Right
Front" (P12), `.knit-pickup-chip` (P15), and on app.js's marker strip (`.knit-markers`) ringed marked
stitches "◉ raglan st", "12 ◉ 9 ◉ 45" and `.knit-marker-moved` (P9). ⋯ menu: 🧶 Materials (P20),
📐 Schematic (P17), "Number “work until” stretches as their own rows" (older projects, P1).
Mirrored parts are stored as text whose first line is `Worked out by the app from <part> (mirrored).
Check each row.`; unsure rows end ` [mirror this yourself]`. Materials are read from
`project.craftData.materials` (the `Knits.materials` shape) when the import keeps it.

What `counterPaint` does (in order; each piece only when its data is there):
1. **Stretch (P1)**: `.knit-stretch` card in `extra`: "Stretch · row 12 of ≈ 101 (15½ in at your
   gauge)", the stitches kept, a big **I'm at the length** button (`Store.endStretch`), "Use ≈ 101"
   (`Store.useStretchEstimate`), "I measured" (P10 sheet). The pattern tag says "Stretch · row 12".
   The old `.knit-until-chip` is removed while a stretch card shows (it said the same thing).
2. **Resolved repeat (P2)**: when `Store.lineInfo(...).via` is set, `patternText` shows the
   resolved row's words and a `.knit-via` second line holds the repeat sentence; the tag gets
   "repeat 3 of 9 · rnd 1 of 6". `via === null` leaves today's line untouched.
3. **Panels (P3)**: `chartInfo.panels` (2+) replaces the single chart chip with one
   `.knit-panels-chip` "A 7/22 · B 3/4 · C 1/6" ("C row ?" when unknown) that opens the chart sheet.
4. **Chart strip (P4)**: `.knit-chart-strip` (an inline SVG, so the HUD's clone keeps it) of the
   current row ± 2 with the band, for a chart whose cells were read.
5. **Colours (P11)**: `.knit-colours` "MC 3 · CC1 1 · ×17 · longest float 5" from the chart row;
   intarsia: "4 bobbins: A, B, A, C". A cell the reader did not know shows "?" in its run.
6. **Shaping (P6)**: `.knit-shaping` card from `Knits.shaping` when it reads the line.
7. **Suggestion (P15)**: `.knit-calc` from `Knits.evenlyRow` (when knit-parse ships it).
8. **Terms (P16)**: `.knit-terms-chip` "📖 ssk · m1" → "On this row" sheet (`Store.glossary`).
9. **Row note (P19)**: `.knit-note-chip` when the row has a note (`Store.stepOverlay`).

Also: ⋯ menu items 📏 Stretches and 📝 Note on this row; Settings → 🧣 Knitting → "Clicker or foot
pedal" (P14; `craftSettings('knitting').clickerForward / clickerBack`, a key string); a document
keydown listener moves the row on Page Down / Page Up (counter only) and on a taught key (counter
and working mode, only keys `WorkMode.keyAction` does not map), knitting projects only.
Row-note keys: `AppKnitting.noteKey(part, row)` = `'s' + hash(base part name) + '~' + row`
("Sock 1" and "Sock 2" share).

## 2. Sheets and helpers on `window.AppKnitting`

```js
AppKnitting.openChartSheet(projectId, partId)   // the chart with your row on it (P4); app.js may
                                                // route its own openKnitChartSheet here
AppKnitting.openStretchSheet(projectId, partId) // every stretch of the part, end / reopen
AppKnitting.openMeasureSheet(projectId, partId) // "I measured" (P10); gauge offer is a question
AppKnitting.measured(projectId, partId, value, unit) // the same without the sheet → Store.addMeasurement's result
AppKnitting.endStretch(projectId, partId, word) / useEstimate(projectId, partId, word)
AppKnitting.openRowNoteSheet(projectId, partId) / openTermsSheet(projectId, lineText)
AppKnitting.noteKey(part, row) / clickerAction(keyEvent, inWorkMode) → 'forward'|'back'|null
AppKnitting.ui = {                              // pure, for tests
  frac(v) → '15½',                               // halves / quarters / eighths
  stretchText(si, word, unit?) → { tag, title, sub, say },
  repeatText(li, word) → 'repeat 3 of 9 · rnd 1 of 6' | '',
  panelChip(panels) → { text: 'A 7/22 · B 3/4 · C row ?', label },
  colourText(runInfo) → 'MC 3 · CC1 1 · ×17',
  shapingText(sched, row) → { lines, say } | null
}
```

## 3. `KnitChart` additions (js/knit-chart.js, pure, no DOM)

```js
KnitChart.rowBand(chart, rowNo, calib?) → { x0, y0, x1, y1, unit: 'pt' | 'frac', r } | null
   // the row's rectangle: PDF points (y up, chart.bbox frame) for a read grid; with `calib`
   // (or chart.calib) fractions of the page image (y down). null = not drawn / not known.
KnitChart.cellBox(chart, r, c) → { x0, y0, x1, y1 } | null     // PDF points
KnitChart.cellAt(chart, x, y) → { r, c, rowNo, sym, entry } | null   // x, y in PDF points
KnitChart.doneCols(chart, rowNo, side, stitches) → { c0, c1 } | null
   // the columns already worked after `stitches` consumed stitches, in knitting order
KnitChart.colourRuns(chart, rowNo, side) → {
   runs: [{ label: 'MC'|'?', n }], repeat: { runs, times } | null, unknown: n,
   longestFloat: { label, n } | null, colours: ['MC','CC1'], bobbins: ['A','B','A'] } | null
KnitChart.calib(raw) → { top, bottom, rows, x0, x1 } | null    // normalise a stored calibration
   // raw = { top: 0..1, bottom: 0..1 (fractions of image height: centre of the top / bottom row),
   //         rows: N (rows between them, inclusive), x0?: 0..1, x1?: 0..1, first?: rowNo }
KnitChart.calibBand(calib, rowNo) → { x0, y0, x1, y1, unit: 'frac' } | null
KnitChart.keyColours(chart) → [{ label: 'MC', hex: '#1f2a44' | null }]   // the key samples' printed fills
KnitChart.colourOf(legendEntry) → 'MC' | 'CC1' | 'A' | null
// legend entries of a vector chart now carry `fill: '#rrggbb'` (the sample's fill; absent when white)
```

Calibration is stored per chart in `craftData.charts[n].calib` through `Store.setChartPages`
(the list `Store.chartPages` returns, with that chart's `calib` set).

## 4. CSS hooks (css/knitting.css, theme variables only)

`.knit-stretch`, `.knit-stretch-go` (the big button), `.knit-via`, `.knit-rep-tag`,
`.knit-panels-chip`, `.knit-chart-strip`, `.knit-colours`, `.knit-shaping`, `.knit-chart-canvas`,
`.knit-calib`, `.knit-cell-pop`.
