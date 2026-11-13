# Wave K API: knit-store (the knitting regions of `js/store.js`)

Owner: knit-store. Consumers: knit-ui (`js/app-knitting.js`, `js/knit-chart.js`), working mode.
Everything here is **knitting only**: a crochet part never gets these fields or answers, and every
existing `Store` function keeps its old return shape (new data is in new fields or new functions).
Status per item: **built** (green, asserted) or **designed**.

Row numbers are the counter's rows: `Part.row` = rows done, the working row is `row + 1`, after
the part's manual repeat block (`repeatInfo(prt).patternRow`). In a project with `rowPhases`
(P1) these are the stretch-phase numbers; every Store reader uses the same numbering.

---

## P3 Panels and charts that keep running — built

`Store.chartInfo(prt)` keeps its fields for the FIRST panel / chart (`name, row, of, page, chart,
text, textSource, panel, repeat, line`) and adds:

| field | shape | meaning |
|---|---|---|
| `panels` | `[{ name, row, of, page, chart, text, textSource, panel, origin?, continued? }]` | every panel the row works, in the pattern's order ("Cable Panel C", "Cable Panel B", "Cable Panel A"). Present when the row works several panels, or when the panels run on from an earlier row. `row` / `of` are **null when the panel's length is unknown** (show "C row ?"), never a guess. `text` = that panel row written out (the pattern's own words for a written panel, `KnitChart.rowText` for a read chart), or null. |
| `continued` | `true` or absent | this row's own line names no panel; an earlier line placed them and they keep running through "Cont in pat …", "Keeping cont of pat, cast off …", stretches and back-references. |

Panel row on part row r = ((r − origin) mod N) + 1; origin = the row the placing line was worked
on − (its panel row − 1); N = the panel's written definition length, else a chart **of that exact
name**. The old "the only chart on the page" fallback is gone (E3). A panel name is never given
"of N" from the rows its placing lines happen to name. `Store.cableInfo(prt)` reads the same
running panels (`source: 'panel'`, `panel: name`).

## P2 "This row" resolves the repeat — built

`Store.lineForRow(prt, row)` still returns a `Line`. New:

`Store.lineInfo(prt, row)` → `null` (no line) or

```
{ line,      // what lineForRow returns
  shown,     // the Line whose words this row works ("Next rnd: K2tog. Knit to last 2 sts. ssk.")
  via,       // the repeat sentence (=== line) when something was resolved, else null
  k, n,      // row k of the n rows repeated (1-based); null when not resolved
  cycle,     // which working of those rows this is (1-based); the written rows count as working 1
             //   when the sentence repeats the rows just above it ("Rep last 6 rnds 8 times more"
             //   = workings 2..9); otherwise the first repeat is 1
  of }       // workings in all, null when open-ended
```

A line the reader marks `plainRows: true` ("Knit 5 rnds even") is always shown as written.
Resolved only for "rep …" / "as …" sentences whose `repeatOf` are whole earlier rows; a chain
("Rep last 4 rows" → "3rd row: As 1st row") is followed to the written row. "Knit 5 rnds even"
(a counted span) is shown as written. Anything unsure: `shown === line`, `via === null` (today's
sentence). Inside a stretch whose rows are an open "Rep last 2 rows …" just before it, `shown` is
the row that repeat works. Crochet: always unresolved.

## P1 Stretch phases — built

- `Project.rowPhases: true` on knitting projects created from this wave on (`createProject`;
  survives save / load / backup). Projects saved before have no flag and keep their absolute
  numbering. `Store.setRowPhases(projectId, on)` → `true|false` (one undo step) switches.
- A **stretch** is an open "work until" line: the reader's own `Line.stretch` when it gives one
  (a SET-UP line with `stretch.within: true`, "CO 124 sts … rib for 3/4"", is read as the cast-on
  at row 0 followed by the stretch as its own line, text `stretch.text`; `within` on other lines
  is not handled yet), else a length `until`, "until … measures / same
  length as …", or "until N sts rem" on a run of rows (never a stitch-level "rep from * until 3
  sts rem").
- Numbering: the stretch starts on the row after the rows written before it. While **open** it
  owns every row from its start on (`lineForRow` → the stretch line, `targetFor` → the stitch total
  kept through it: the line's own "on 216 sts", else the count before it; null when it shapes) and
  nothing after it has a row number. Once ended, the lines after it are numbered from its end
  (≈ `approxRow` flags dropped). `Part.targetRows` is null while a stretch is open and the
  pattern's target moved by the stretches' rows once all are ended (`Part.phaseTarget` keeps the
  pattern's own number).
- The stretch line the store returns carries
  `line.stretch = { key, start, end|null, open, planned, count, lead, parser }`
  (`lead`: the open "Rep last 2 rows …" line the stretch works; `parser`: the reader's own
  `Line.stretch`, if any).
- `Part.stretches = { [key]: { rows, planned, at } }` (absent = none ended). `rows` = the stretch's
  length (so re-ending an earlier stretch moves later ones with it). `key` =
  `'s<line index>:<hash>'`; a re-import with different text forgets old ends.
- `Store.stretchInfo(prt[, row])` → `null` (row not in a stretch) or
  `{ key, line, start, end|null, state: 'open'|'planned'|'ended', row, of|null, count|null,
     estimate: { rows, end, value, unit, gaugeSource, fromRow, approx: true } | null }`
  (`row` = 1-based row of the stretch; `estimate` from the gauge for a length stretch, a ≈ hint).
- `Store.stretchList(prt)` → `[{ key, line, start|null, end|null, state }]` in pattern order;
  `state` also `'later'` (after an open stretch: no start yet).
- `Store.endStretch(projectId, partId)` = **"I'm at the length"**: the rows done so far end the
  stretch being worked; the working row becomes the first instruction after it. One undo step,
  one history entry `{ ts, partId, partName, row, kind: 'stretchEnd', stretchRows }`.
  → `{ event: 'stretchEnd', key, start, end, rows, next: Line|null }`, `{ event: 'none' }` when the
  working row is in no stretch, `null` for a missing / crochet part.
- `Store.useStretchEstimate(projectId, partId)` = **"Use"** on the ≈ estimate: planned end
  (`state: 'planned'`, a target). → the new `stretchInfo` or null. One undo step.
- `Store.reopenStretch(projectId, partId[, key])` → `true|false`: takes an end off (default: the
  stretch being worked, else the last ended one before the working row). One undo step.

## P10 "I measured" — built

- `Store.addMeasurement(projectId, partId, value, unit)` records `{ row: rows done, value, unit,
  at }` on `Part.measures` (≤ 24, one undo step). If the stretch measured was only **planned**
  from the gauge, its end is re-planned from the measurements. Returns `measureInfo` plus
  `replanned: true` (when re-planned) and `atLength: true|false` (the measurements say the length
  is reached: offer "I'm at the length"). null for a bad value / crochet.
- `Store.measureInfo(prt)` →
  `{ pairs, rowsPerUnit, unit, fromRow, endRow, rowsLeft, stretch, stretchKey?,
     gaugeOffer: { rows, over, unit, was } | null }`
  — rows per unit (the project gauge's unit) fitted through the measurements taken in the stretch
  being worked (or the last one started), the row the length comes to, rows left. `gaugeOffer`
  ("your row gauge is 20 rows / 4 in — use it?") appears with ≥ 2 measurements or ≥ 10 rows
  measured and ≥ 2 % off; the store never applies it (the UI calls `setGauge({swatch:{rows}})`).

## Audit round (release-blocking, docs/wave-k/knit-audit.md) — built (knit-counter group 27, journey "Audit: …")

The store now says "not sure" instead of a confident wrong answer:

- `lineInfo(prt, row)` gains **`unsure: true`** when the row's line is a back-reference the store
  could not prove (then `shown === line`, `via === null`: show the printed sentence). A sentence
  is resolved only when it SAYS which rows it repeats and they match the reader's rows: "Rep last
  6 (6-6-6-4-4) rnds …" (one of its numbers = the rows, and they are the rows just above), "Rep Rows
  91-92", "Rows 63 and 64", "As 1st row", "Rep Row 1". Never "rep Inc rnd every other rnd" (the
  plain round between is not a written row), never a stretch ("Cont even in pat until … same length
  as Back"), never anything else.
- `chartInfo`: **a chart row is never past the chart's length** (that row is `null`); `of` comes
  only from a read chart, a written panel, or a line naming a RANGE of chart rows (one row named
  says nothing of the length: "chart row 7" has `of: null` unless the chart is known); a line
  covering several rows with one chart row named ("Row 15 and all following odd rows", "Rows 38 and
  40") is chart row = pattern row when the chart is numbered like the pattern, else unknown; a chart
  named as an end ("… ending with chart Rnd 10") or carried on from elsewhere ("Work even through
  Row 11 of Foot chart") gives `{ name, row: null, of, unknown: true }` (or no chip when unnamed).
- `sideInfo` / `patternSideAt`: an ended stretch "ending on a WS row" states its last row's side;
  "With RS facing … join yarn" on a row, and "Join yarn to rem sts" after a "Turn. Leave rem sts on a
  holder" row, are RS (the side the first side began on); a part that continues the one before it
  ("(continued)", or "Start with N sts.") carries its parity on; a part whose rows are all labelled
  "rnd" is in the round.
- `cableInfo`: a row working written panels rings where the PANELS cross (inside a stretch too).
- Row targets: a part the import gave no target gets one once its last stretch has ended (its last
  written row; `Part.phaseTargetAuto: true`), so it can finish; reopening a stretch takes it away.
- A set-up line the reader marks as a stretch is one, `within` or not (boyfriend Sleeves' 2½" rib).
- `markerInfo`: a lone BOR marker (all markers at 0) is never `shifted`.

## P9 Markers that move — built (knit-counter group 21, journey Bernat / Sandnes)

`Store.markerInfo(prt)` keeps every old field and adds:

| field | meaning |
|---|---|
| `moved: true` | the markers were walked from the row they were placed on to this row: `markers[].at` and `segments` are THIS row's (Bernat XS/S row 3: 2\|2\|6\|2\|20\|2\|6\|2\|2). `shifted` is then false. |
| `unplaced: true` | the walk could not place an increase (not beside a marker, a decrease, a cast-on with no place): `shifted` stays true and `segments` null, i.e. today's honest "Markers set on a 36-st row · this row makes 76". |
| `marker.kind: 'stitch'` | a marker AROUND a stitch ("insert marker around next st", or the reader's `kind: 'stitch'` / `around: true`): `at` is that stitch's index. |
| `marked: true`, `plain: [n…]` | when any marker is a marked stitch: `plain` = the plain stitches between marked stitches (`segments` minus the marked stitch itself), e.g. 12 \| ● \| 8 \| ● \| 24 \| ● \| 8 \| ● \| 12. |
| `source: 'carried'`, `from` | the part has no markers of its own and starts on exactly the stitches the part before it ended with: that part's markers where they ended (`from` = its name). |
| `basisRow` | (pattern markers) the row they were placed on. |

Rules: an increase goes to the side of the marker the row's words put it ("M1. SM." before,
"SM. M1." after; star blocks and "Rep from * to ** once more / twice more, then from * to ** once"
worked out); the increases the words name must equal the row's printed change. A round that
adds exactly 2 per marked stitch with no "SM" words ("inc 1 st at each side of marked sts")
adds one each side of each marked stitch. In stretch phases a marker NOTE between rows is placed
after the last numbered row before it (it used to count as row 0). Part-owned markers record
`Part.markerRow` (the row they were placed on) from now on; markers placed before have none and
keep the old behaviour.

## P5 Rows counted from charts — built (knit-counter group 23, journey "Lace Fountain Hat")

In stretch phases an UNNUMBERED line that takes a known number of rows becomes numbered rows
where it is worked, and the lines after it move on: "Work Rows 1-61 of Lace chart" (61 rows),
"Work through Rnd 84 of Leg chart" (84), "Work 5 rnds even" (5). ("See Chart E for Rows 3-15"
names the pattern's own rows and is left alone.) For a chart block whose chart is read, each row's
count comes from `KnitChart.rowInfo(chart, row)` (what the row takes and makes, repeated round
the work from the count before the block, a carried "Start with 84 sts." included): `targetFor` per row, the line's printed total on the
last row. A row with an unknown cell (or a width the chart repeat does not divide) has **no
count**, nor has any row after it; the printed end total still ends the block. The derived line
carries `line.block = { rows, start, end }`, `countSource: 'chart'`, and `chartPrinted` when the
line's printed total disagrees with the chart's. The numbering re-reads when the background chart
scan lands (`setChartPages`). `chartInfo` on those rows: chart row = row − start + chart.row.

## P7 store half — built (knit-counter group 24, journey "Time Traveler")

`importPatternSections` on a knitting book records `craftData.patternPages = [{ name, from, to }]`
for the patterns it imported (`Knits.bookPatterns` pages, matched by the sections' group names;
absent for a single pattern). `Store.setChartPages` then keeps only charts on those pages, so the
app's background scan (`knitAttachCharts`, unchanged) no longer attaches another pattern's "Leg"
chart. Sections from `Store.splitSections` keep the reader's `rowWord: 'rnd'`; the part gets
`Part.rowWord = 'rnd'` and its side chip is "in the round" (E13).

## `Store.tapStitches(projectId, partId, n)` — built (knit-counter group 25)

n stitches as ONE action: one undo step, one count event (`Store.onCount` gets `n`), clamped at
the row's count; reaching it completes the row (auto-advance) exactly as the n-th single tap would.
Returns tapStitch's shape plus `n` (stitches actually added): `{event: 'stitch'|'group'|'alert'|
'rowAuto'|'pieceDone'|…, stitch, n}`; `'alert'` names the first alert stitch inside the run,
`'group'` a repeat / group boundary inside it. `n = 1` is exactly `tapStitch`. Any craft;
`tapStitch` itself is unchanged.

## Glue for knit-3d K3 — built (knit-counter group 22)

`buildDiagramModel` (knitting only) runs `DiagramGeo.applyChart(round, cells, {palette:
yarnColors, main})` on every round whose row works a read chart with key colours
(`KnitChart.rowCells(chart, chartRow, side)`); the model's cache key carries the charts' state.
A crochet model never changes.
