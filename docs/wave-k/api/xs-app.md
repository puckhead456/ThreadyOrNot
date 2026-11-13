# API: xs-app (`window.XStitchApp`, `js/app-xstitch.js`), wave K

Status: BUILT (wave K, batch 2). Owner: xs-app. Names below are the contract for the xs-extras
worker (`js/app-xstitch-extras.js`) and the galleries worker (`test/xstitch.gallery.html`).
Fields may be added, never renamed. Everything is feature-detectable:
`window.XStitchApp && XStitchApp.version >= 1`.

The cross-stitch module registers at script-evaluation time, so `window.XStitchApp` exists as
soon as `js/app-xstitch.js` has run (it loads before `js/app-xstitch-extras.js`).

## For xs-extras (runtime, called by app code)

```js
XStitchApp.version                 // 1
XStitchApp.current() -> { projectId, project, data } | null
     // the cross-stitch project on screen now (data = its normalised craftData, the live object:
     // read it, never mutate it; write through Store.updateCraftData).
XStitchApp.dataOf(projectOrId) -> XSData       // normalised craftData of any cross-stitch project
XStitchApp.cells(projectId?) -> { w, h, cells: Int16Array, done: Uint8Array /* packed bits */ } | null
     // the decoded chart of the project on screen (shared, read only). null when no chart / not on screen.
XStitchApp.repaint(projectId?, { cells?: boolean })
     // call after an extras sheet changed craftData through Store.updateCraftData. Drops the screen's
     // caches (pass cells: true when cells, palette or progress changed) and re-renders. Safe to call
     // for a project that is not on screen (no-op).
XStitchApp.centerOn(x, y)           // move the crosshair (and the stitch-mode view) to a stitch
XStitchApp.openSheet(name, opts?) -> boolean
     // the app's own sheets: 'chart' | 'floss' | 'fabric' | 'pages' | 'parking' | 'rows' | 'find'
     //   | 'read' (the picture-read check) | 'colour' ({ index })
XStitchApp.stitchMode() -> { isOn: boolean, open(), close() }   // the working mode
XStitchApp.picture(project, { size, frame }) -> Promise<HTMLCanvasElement|null>
     // the stitched-fabric picture (XSRender.picture) for share / framed cards; null without XSRender
XStitchApp.onMarked(fn) -> unsubscribe
     // fn({ projectId, n, cells /* Int32Array|null */, on: boolean, colour /* palette index|-1 */ })
     // after every mark / unmark the app makes (tap, drag, block, whole colour, row, page, undo excluded)
```

The "⋯" menu lists `XStitchExtras.menuItems(project)` (each `{id, label, icon, hint}`) after the
app's own items and calls `XStitchExtras.open(id, project, { ctx, app: XStitchApp })`; the app
never builds those sheets.

## For the galleries worker (test only, never called by app code)

`XStitchApp.__test` — the pure helpers and the real entry points:
- (wave J, kept) `readerAvailable, isImageFile, importAcceptList, pickPdfPage, pdfReadScale,
  readBannerText, unsureText, checkOff, cellsPrint, codeKey, normRowOpts, writtenOptsFor,
  rowOptsLabel, firstStitchX, rowsAvailable, def, handlePicture, openReadSheet, openRowsSheet,
  reopenRead, applyKey`
- (wave K) `selfCheck() -> [{ name, ok, got }]` (19 pure checks of this file's wave K logic: drive it
  and assert every `ok`), and the entry points / helpers:
  `gridCheckOf(res)`, `gridSourceCheck(res)`, `keepReadFields(out, src)`, `letterPalette(palette)`,
  `statsOf(data)`, `pctOf(done, total)`, `liveCheckOf(data)`, `readInfo(data)`, `stitchModeSpec`,
  `stitchModeReadout(project)` (project on screen), `view()`, `markCellList(id, cells, on, colour)`,
  `markPageDone(id, pageIndex, on, after)`, `openFindSheet(id)`, `openParkingSheet(id)`,
  `openResolveSheet(id, paletteIndex)`, `openGridCheck(id)`, `pageLine(data)`, `blockScope('all'|'colour')`,
  `stitched()` (the button renderer `{handle, mode, shown}`), `runGridBeta(handle, key, box, onUse)`,
  `applyGrid(id, extractGridResult)`, `openKeyReadSheet(id, {blob, name, crop?, wholePage?})`,
  `keyEntriesFrom(keyRead, choices)`, `confirmCode(text)`, `keyReadAvailable()`, `pdfLookScale(base)`,
  `rowsOptsScoped(rowOpts, data, 'all'|'page'|'band')`, `rowDoneByRuns(row)`, `rowCellsByRuns(row, w)`.
