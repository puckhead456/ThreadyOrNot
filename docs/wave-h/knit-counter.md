# Wave H — knit-counter

Knitting state on the shared counter and the knitting-only widgets of `#screen-project`
(contract §3). Files: `js/store.js` (section "Knitting (wave H, knit-counter)" plus one-line
hooks), `js/app.js` (section "14b. Knitting on the counter" plus one-line hooks), `css/app.css`
(section "Wave H — knitting on the counter"), new `test/knit-counter.test.html` (216 assertions).

## What the knitter sees

- **RS / WS chip** beside ROW (`data-tour="knit-side"`). It follows the line's own stated tag
  ("(RS)", "Rows 2, 4, 6 and 8 (WS)", "Row 3 RS:"), else parity from the **last stated tag at or
  before** the row (a setup row counts as row 0). Before any stated tag it shows a dashed "RS?".
  Tap flips it; the tap sticks (outlined) until the next row whose line states a side, then the
  pattern speaks again. Hidden in the round, except on a row that states its side (a sock's heel
  flap) and in short rows (they turn). The side is announced with the row ("Row 5 done. Next:
  wrong side").
- **Short rows**: when the working row's line has `Line.shortRow`, a strip under the counter says
  "↩ Short row 3 of 8" (or "Short row 5" when the pattern says "until all sts are worked"), the
  pattern line shows the line that short row is worked from, the row number does **not** move,
  the stitch count has no target (stitches to the turn) and + reads "Short row done (turn)".
  "Done" ends the run by hand. Two kinds of run:
  - numbered (a heel turn's Row 89-102, with "Rep Rows 91-92" back-references): the last short
    row lands the counter on the row after them (row 102 done → Row 103), one history entry;
  - unnumbered ("Short row 1 (RS): …, w&t" lines between Row 24 and Row 25): leaving them keeps
    the row number where it was.
  − steps back a short row; right after a run it steps back onto the last short row.
- **Markers** (`data-tour="knit-markers"`): a strip under the stitch readout with the markers
  (● m1 · ● heel · ▲ BOR), the next one ringed, and one line "7 → m2 · 3 | 12 | 30 | 12 | 3"
  (current segment underlined; "Slip marker m2" on a marker; "2 → end" after the last). Markers
  come from the pattern's `Line.markers` (the set-up row) until the knitter edits them; "+ marker"
  (stitch actions) places one after the current stitch (copying the pattern's first); tap a marker
  to rename (BOR moves it to 0, one BOR only); hold (or Delete key) removes it, with Undo. When the
  row being worked makes a different total than the row the markers were placed on (a raglan
  increase row) the strip says "Markers set on a 60-st row · this row makes 62" instead of counts
  it cannot vouch for.
- **Two at a time**: linked parts share one tab ("Sleeve 1 | +2", each half picks its piece), the
  row label reads "Sock 1+2 · ROW", one + advances both (one Undo), − steps both back, stitches go
  to the active piece, and when a piece finishes its row by itself the work moves to the other
  ("Sock 2 next"). A "⇄ Sock 2 · Rnd 4" chip switches pieces. Part editor → Knitting card → "Work
  with…" links any two parts; "Knit both at once (Sock 1+2)" splits a part made twice (the
  built-in Socks / Sweater Sleeves ×2) into two linked parts; "Stop working them together" unlinks.
- **Cable ring** in the row label: "cable in 3", filling as the crossing comes, "cable row" with a
  pulse on it. Read by walking the rows ahead through the part's repeat and the pattern's own
  back-references, looking for a crossing (C6F, T3R, 1/1 LC, `t:'cable'` records); else from a
  stated cadence (`Line.cable.every`, counted from its line).
- **Length chip** under the pattern line on a "work even until it measures" stretch:
  "📏 32 cm ≈ 118 rows, not 110 · ≈ row 126" (measured row gauge; the printed one when none was
  measured; "add your gauge" when neither). The length is counted from the start of the piece
  unless the line says "from underarm / marker …", then from where that stretch began; "ending
  with a WS row" moves the ≈ row onto a WS row. Never a target: `targetRows` is untouched. Tap →
  part editor.
- **Chart chip**: "▦ Chart A · row 7 of 16" when the line names a chart (a "Rows 3-16: work rows
  3-16 of Chart A" range is followed row by row). It opens the chart page image (BlobStore) with
  zoom, the row written out by `KnitChart.rowText` when the chart was read (RS right to left, WS
  left to right; nothing — never a guess — when rowText returns null), and what was read even
  from a drawn chart: rows, width, repeat box, the key.
- **Part editor → 🧣 Knitting card**: pattern gauge (sts, rows, over, cm/in, needle — the whole
  project's) and "Your swatch" (sts, rows); live "Rows: 7% tight" and, for every "until it
  measures" line in this part, "32 cm ≈ 118 rows, not 110" with the line quoted; saved with the
  part's Save in the same Undo. Two at a time and "Clear my markers" act at once (Undo toast).
  The UK/US **Terms** row is hidden for knitting here and in the 3D viewer (dialect is crochet's).
- **⋯ → 📖 Glossary**: `App.openGlossarySheet(projectId)`. "In this pattern" first (the pattern's
  own abbreviation block via `Knits.glossary`, marked "this pattern"), the rest folded; a search
  box. Without `Knits.glossary`, the profile table (55 entries) with "used" from the text.

## Contract

### Fields (all normalised on load in `knitNormalizeProject`, called by `normalizeProject`)

| field | shape | default (knitting) | other crafts |
|---|---|---|---|
| `Project.gauge` | `{sts, rows, over, unit:'cm'\|'in', needle, swatch:{sts, rows}}`, numbers 2 dp or null | empty gauge, unit from `Settings.crafts.knitting.unit`, over 10 cm / 4 in | carried only when not empty |
| `Part.side` | `'rs'\|'ws'\|null` — the knitter's word for the row being worked | null | carried when set |
| `Part.markers` | `[{id, name, at}]` sorted, ≤ 40, one `BOR` forced to 0 | `[]` | carried when non-empty |
| `Part.markerTotal` | row total the markers were placed on, or null (**addition**) | null | with markers |
| `Part.linked` | partId, always mutual (repaired on load: one-sided made mutual, self / missing dropped) | null | carried when set |
| `Part.shortRows` | `{active, n, of, row, base, numbered}` (**`row`, `base`, `numbered` are additions**) | null | carried when set |
| `craftData.chartPages` | `[{page, name, key?}]`, key default `'p:<id>:chartpage:<page>'` | — | — |
| `craftData.charts` | `[{page, name, rows, cols, cells\|null, legend, repeatBox, …}]` (the knit-chart contract change) | — | — |

Templates carry `Template.gauge` (printed half only, never the swatch) and per part `markers`
(`[{name, at}]`) and `linked` (the **index** of the partner in the template's parts); a project
made from one gets fresh marker ids and links by the new part ids. `createProject({gauge})` takes a
gauge read off a PDF. Backups carry everything (normalised through `normalizeProject`).

### Store API (`installKnitApi`, on `window.Store`)

Writers (each one snapshot + touch = one Undo): `setGauge(projectId, patch, {undo:false}?)`
(patch: any of sts, rows, over, unit, needle, swatch:{sts, rows}; `''`/null clears; `undo:false`
for a write inside another snapshot — the importer and the part editor use it), `setSide`,
`flipSide`, `addMarker(projectId, partId, {name?, at?})`, `renameMarker`, `removeMarker`,
`setMarkers(projectId, partId, list, total?)`, `linkParts`, `unlinkPart`, `splitTwoAtATime`,
`endShortRows`, `setChartPages(projectId, [{page, name, key?, chart?, noImage?}], opts)`.

Readers: `gaugeOf`, `normalizeGauge`, `lengthToRows(projOrGauge, value, unit, 'swatch'|'pattern')`,
`gaugeCompare`, `sideInfo(prt)` → `{side, source:'you'|'pattern'|'parity'|'round'|null, pattern,
inRound, row}`, `patternSideAt(prt, row)`, `markerInfo(prt)`, `linkedPart(proj, prt)`,
`linkedLabel(proj, prt)`, `shortRowInfo(prt)`, `cableInfo(prt)`, `untilInfo(prt)`,
`glossary(projOrPartOrText)`, `chartInfo(prt)`, `chartPages(proj)`, `KNIT_CRAFT`.

Counter behaviour (hooks): `tapRow` → `knitTapRow` (short-row step; a linked pair under one
snapshot), `untapRow` → `knitUntapRow`, `completeRow` / `untapRow` / `jumpToRow` → `knitRowMoved`
(the side turns with the work; a stated tag clears the override), a new piece / reset →
`knitNewPiece`, `currentTarget` returns null in short rows, `tapStitch`'s auto-advance →
`knitAfterAutoRow` (`switchedTo`), new results `shortRow` / `shortRowsDone` and `res.linked`.
All are no-ops for any craft but knitting.

### One shared-code fix

`buildRowIndex` (store) now honours `Line.rowList`: "Rows 2, 4, 6 and 8 (WS)" covered rows 3, 5,
7 as well, so Row 3's own line was never shown. (Patterns' `inRange` already did this.)

## Verified

- `test/knit-counter.test.html`: **216 passed, 0 failed**. Groups 1-12 use hand-built `Line`
  objects through a stand-in parser registered with `registerCraftParser`; group 13 runs the real
  `window.Knits` (side tags + enumeration, set-up row markers 3/15/45/57 and "3 | 12 | 30 | 12 | 3",
  the shifted guard on an increase row, C6F cadence, "32 cm ≈ 118 rows, not 110" from underarm,
  a heel turn of 14 short rows with "Rep Rows 3-4").
- Re-run after my store edits: store-safety 302, backup 205, diagram-model 529, templates 147,
  crafts 124 — all green.
- Pane, 375×812, private key `stitchkeeper-knit-counter` (removed after, with its BlobStore page):
  a hand-typed cabled back (RS chip, "cable in 2", marker strip "1 → m1 …", tap to stitch 15 =
  "Slip marker m2 · 30 → next", + → "WS" and "Row 1 done. Next: wrong side", length chip
  "32 cm ≈ 118 rows, not 110 · ≈ row 126", Glossary from ⋯ with "In this pattern"); the built-in
  **Socks** template (heel turn "Short row 7 of 14 · rows 89–102", pattern line Row 91, 8 taps
  → row 102 done and Row 103, announcements per short row with the side; "Knit both at once"
  → tab "Sock 1 | +2", + moves both, "⇄ Sock 2 · Rnd 4"); a chart project (chip "Chart A · row 7
  of 16", sheet with the stored page image and zoom); the **Bernat raglan** through the importer's
  Store path (`splitSections(text,'knitting')` + `importPatternSections`): gauge 12 sts / 17 rows
  over 4 in, needle "6 mm (US 10)" landed through `setGauge`; RS chip, setup line, markers from
  "1st row:(RS). K1. PM. K2. PM. …"; a crochet project shows none of the widgets.
- **3D**: knitting parts build through `Store.diagramModel` → `Knits.expand` (records `{t:'k',
  h:0.75, w:1, side:'rs'}`), the 3D button and viewer open ("Flat panel · 8 rows"), the Terms row
  is hidden, Auto/Rounds/Rows and orientation stay. No diagram file was edited.

Not verified in the pane: the hold-to-remove gesture on a real finger (only the Store side and the
keyboard Delete path), the marker rename sheet's Save, the chart capture at import from a real
drop (KnitChart.scan on a dropped PDF → BlobStore); the Store side of `setChartPages`/`charts` and
the sheet are verified, the drop → scan → render path was not driven with a file.

## Left / known gaps

- **"ROUND" in the label on a heel row** (and "Round 102 done"): a Row line inside a piece knitted
  in the round has no `workedIn: 'rows'`, so `rowWordAt` says Round. The chip already treats a row
  with a stated side as flat.
- Markers move only when the pattern places them again or the knitter does; segment counts are
  hidden on a row whose total differs from the markers' row (honest, but a raglan yoke shows only
  the marker chips on its increase rows). Moving markers through `expand` inc positions is next.
- `Part.shortRows.of` for an unnumbered run counts "Short rows 3-8" from the text (span 6); "rep
  the last 2 short rows N times" is read only when the parser gives the repeat line `repeatTimes`.
- The chart capture keeps ≤ 12 chart pages per import and holds the scan for 30 minutes waiting
  for the import to land; it runs only for a knitting drop zone (the `onPages` getter).
- Two at a time links exactly two parts; a part made 3+ times does not split.

## For the owner of `js/knits.js` (knits-parser)

1. Parity sides on untagged rows can be wrong: in "Row 1 (RS) / Rows 2, 4, 6 and 8 (WS) / Row 3 /
   Row 5 / Row 7" every odd row came back `side: 'ws'` (should be RS). The counter ignores
   unstated sides now (it does its own parity from stated tags only); a `sideStated` flag, or
   leaving untagged rows null, would make `Line.side` safe for other readers (the 3D?).
2. "Rep Rows 1-8 4 more times." has `repeatTimes: 5` but no `repeatOf` / `repeatFrom` /
   `repeatTo`, so rows 9-40 resolve to the next sentence (a "work even until…" whose
   `repeatFrom: 8` overlaps row 8): the cable ring and pattern line go blank there.
3. After an enumeration ending at row 8, "Next row (RS)" is numbered 8 again (approxRow).
4. Bernat: the "1st row:(RS). K1. PM. K2. PM. K4 … " row wraps over three lines and only the first
   carries markers (4 of 8); its sections come back unnamed ("Part 2", "Part 3") and the first
   holds the abbreviations page.
5. Please set `workedIn: 'rows'` on Row lines inside a piece read as rounds (heel flap/turn).

## For the owner of `js/app-knitting.js` (shell)

- The Glossary menu item is gated on `window.Knits.glossary`; `Store.glossary` has its own table,
  so `App.openGlossarySheet` alone would do.
- Hooks I added in shared regions (all marked "wave H"): `normalizeProject` returns through
  `knitNormalizeProject`; `normalizeTemplate` / `validateTemplate` / `saveTemplate` /
  `templateFromProject` / `createProject` (`knitFromTemplate(proj, tpl, opts.gauge)`) / `addPart`;
  the counter functions listed above; in app.js `updateCounters` (end), `renderTabs` (pair tab),
  `applyResult` (before and after the switch), the row-minus announcement, `openPartEditor`
  (card + `commit()` after both save paths), the viewer's Terms row, the two drop zones
  (`knitZoneOpts`) and the three import commits (`knitAttachCharts`), and `App.openGlossarySheet`.

## Contract changes

- `Part.shortRows` gains `row`, `base`, `numbered`; `Part.markerTotal` is new.
- Template parts: `markers`, `linked` (index); `Template.gauge`.
- `craftData.chartPages` = `[{page, name, key?}]` and `craftData.charts` as the chart worker asked.

## Addendum — charts on the final KnitChart API

- **When charts are read**: a knitting drop zone only remembers the open PDF handle
  (`knitZoneOpts` → `onPages`, present only while the craft is knitting). Once the import has landed
  in a project (`knitAttachCharts`, called after the three import commits), `KnitChart.scan(handle,
  {signal})` runs once in the background. Each chart page is drawn at 2 px per PDF point, the images
  go to BlobStore (`p:<id>:chartpage:<n>`), and the charts go to `craftData.charts` (plain JSON:
  name, rows, cols, cells, legend, repeats, rowNos, rowStep, bbox, pageBox, turned, …) with
  `craftData.chartPages = [{page, name, key, scale}]`. The counter never opens the PDF again, and
  the import never waits for the scan.
- **Chip and sheet**: the line's chart name is matched with `KnitChart.find`. The row is followed
  through a "Rows 2-20: work rows 2-20 of …" range, and through a "Work Rows 1-61 of Lace chart"
  sentence that sits between written rows (new `chartGapLine`). "of N" is the last charted row
  number (`rowNos`, so a `rowStep: 2` chart reads "row 14 of 36"). `rowText(chart, row, side,
  {repeat})` is called with `null` in the round, `'rs'`/`'ws'` when flat, and the side left out
  when it is not known. It is not called when `cells` is null or the chart is an image. Where a
  chart has several repeat boxes, `opts.repeat` is picked by the row's stitch total
  (`repeats[n].sizeSts`), then the project's size name in the box label, then the size index. The
  sheet shows the written row, or "Row 15 is not drawn on the chart: work it as the pattern says"
  when `rowNos` does not hold the row, or the plain no-write note. Under that it shows the facts
  read off the chart (rows, width, repeat) and its key. The page image is cropped to `chart.bbox`
  (`pageBox` on a sideways chart; PDF points, y up), with a "Whole page" toggle and zoom.
- **Tests**: `test/knit-counter.test.html` is now **229 / 0**. New assertions use a fake charts
  array and a fake `KnitChart`: `find` is asked for the line's own name; `rowText` gets `'rs'`, the
  68-st repeat box, `null` in the round and no side when the side is unknown; a null row gives no
  written row; a `cells: null` chart never calls `rowText`; a "Rows 1-61 of Lace" sentence makes
  round 3 into chart row 3 of 61, and round 62 gives no chip. Re-run: store-safety 307, templates
  147, crafts 124, all green.
- **End to end in the pane** (375×812, private key, cleaned up after): `knit-interweave-lace.pdf`
  was dropped through New project → 🧣 Knitting (a real `File` on the drop zone's input), size 26",
  then Save. In the background the scan kept **14 charts** from pages 7, 9, 15, 27 and 29: p9's
  Henley laces, p15's Chart A–F and p27's Lace were read cell by cell, and p29 is a raster image.
  Its pattern text names almost no chart rows (see below), so I added two parts by hand that point
  at the charts that were read:
  - "Back and Sleeve Lace" (Henley, p9), row 3: the chip reads "row 3 of 20", the written row is
    `k3, ssk, k1, yo, k1, yo, *k2, sl 1, k2tog, psso, k2, yo, k1, yo; rep from * to last 6 sts,
    k1, k2tog, k3`, and the crop is the chart. Row 4 (WS) reads `p21`.
  - Icelandic **Chart B** (p15, a half chart with `rowStep: 2`): row 14 is written out, and row 15
    is the "not drawn" note with the cropped chart image (checked by screenshot: the crop
    orientation is right).
- **Still open, all in the parser** (for knits-parser):
  - The lace ebook's lines rarely carry `Line.chart`. "See Chart C for Rows 38-56", "ending with
    chart Row 28" and "Cont in charted patt" are not read. "Row 1 of Oriel chart" and "Work Rows
    1-61 of Lace chart" are read, but on unnumbered notes.
  - The Hat section ends with the next pattern's "Rnd 1 / Rnd 2" (the mittens). Those written rows
    stop the "Rows 1-61 of Lace" sentence from owning round 3, so the imported Hat itself shows no
    chip there.
  - The coordinator's "Chart A row 3 of 20" was not seen as such: in this PDF Chart A (p15) has 6
    rows, and the 20-row Henley chart is called "Back and Sleeve Lace".
- Half charts (Icelandic B/D/F) are written for the half that is shown, as KnitChart reads them.
