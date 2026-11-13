# Wave K: knit-store report (knitting regions of `js/store.js`)

Contract: `docs/wave-k/api/knit-store.md`. This file: what the user will see, what was built,
measured results (real numbers, bad ones included), what is left, notes for other owners, and
decisions for the coordinator. Kept current as I go.

## Baseline (before my first edit, headless, 2026-11-12)

| page | baseline |
|---|---|
| knit-counter.test | 317 |
| knits.test | 385 |
| patterns.test | 1112 |
| crafts.test | 212 |
| templates.test | 159 |
| knits.fixtures, knit-chart.test, patterns.fixtures | no summary headless (pdf.js worker does not run on the virtual clock); knits.fixtures and knit-chart.test do not load `js/store.js`, so nothing of mine reaches them; patterns.fixtures does (crochet) and is run in a real tab at the end |
| store-safety / backup / blobstore | real tab at the end (472 / 229 / 78 per shell-data) |

New page `test/knits.journey.html` loads `js/vendor/pdf.worker.min.js` as a plain script so
pdf.js runs its "fake worker" on the main thread: then the headless runner's virtual clock waits
for the extraction and the page prints a summary headless (`BUDGET=180000`).

## Progress

| proposal | state |
|---|---|
| P3 panels that keep running | **done** |
| P2 this row resolves the repeat | **done** (knitting only) |
| P1 stretch phases | **done** (not yet: a stretch INSIDE a row line, Sandnes E7, needs the reader's `stretch.within`) |
| P10 I measured | **done** |
| P9 markers that move | **done** (Bernat row 8's cast-on + join stays honest "unplaced", so the markers are not carried into the yoke rounds there) |
| P5 rows from charts | **done**: lace hat (61 rounds, 144 → 84) and Stranded Boot Leg (84 rounds, 84 → 60); Time Traveler's Leg does not read as one chart block (see "Left") |
| knit-3d K3 glue | **done** |
| `Store.tapStitches` (shell-ui's ask) | **done** |
| P7 store half of the book import | **done** for charts (`craftData.patternPages`); the tick / checklist halves are app.js (see below) |
| P21 journey audit | **done** as a ratchet: 57 assertions over 7 fixtures (E1–E5, E7, E8, E9–E13, E12 charts); grows with every fix |

## What the user will see (store side; the screens are knit-ui's)

- **P3.** On a cabled sweater the chart chip keeps counting through "Cont in pat until …":
  mock neck M Back row 31 reads Panel Pat C 7/12 · B 3/28 · A 7/24 (research §9: C 7, B 3, A 7);
  boyfriend L Front row 132 has every panel on its last row (6/6, 4/4, 22/22) and row 133 has all
  three on row 1. Before: "Panel Pat C · row 1 of 28" frozen (E2) with the only chart's length (E3).
  A panel whose length is not known says so (`row: null, of: null`).
- **P2.** `Store.lineInfo(prt, row)`: on Bernat M sleeve rnd 20 the line is "Next rnd: K2tog. Knit
  to last 2 sts. ssk." via "Rep last 6 rnds 8 times more", rnd 1 of 6, working 2 of 9; rnds
  21–25 "Knit 5 rnds even"; rnd 26 decreases again; yoke rnd 20 is the "2nd rnd" increase round
  (160 sts).

- **P1.** Boyfriend L Front: row 1 is the 4" rib (a stretch); after "I'm at the length" at 20
  rows the panel set-up rows are 21–24, row 25 is "Cont even in pat until … same length as Back"
  (not the raglan cast-offs, E1) on 93 sts kept (E8), every row after it is that stretch until the
  knitter ends it; ended at row 100, rows 101–102 are "Shape raglans", 89 sts. One history entry
  (`kind: 'stretchEnd'`), one Undo reopens it. A gauge estimate is a ≈ hint until "Use".
  Projects saved before this wave (no `rowPhases`) keep their numbering exactly.

- **P10.** "I measured 3 in" after 15 sleeve rounds (pattern gauge said ≈ 13): 5 rounds per
  inch, the planned end moves to round 15 and the decrease round is round 16, not 14; an offer
  "20 rows / 4 in (was 17)" that the store never applies.
- **P9.** Bernat XS/S neck: rows 3 / 5 / 7 read 2|2|6|2|20|2|6|2|2, 3|2|8|2|22|2|8|2|3,
  4|2|10|2|24|2|10|2|4 (research §1) instead of a blank strip; row 8 (cast on 16 and join) stays
  the honest message. Sandnes 4 yrs: the rib is its own stretch, the German short rows follow it,
  the first raglan round reads 12|9|25|9|13 (marked stitches: 12 | ● | 8 | ● | 24 | ● | 8 | ● | 12)
  where it said 11|7|23|7|20 (E5).
  Bad number found on the way: walking `Knits.expand`'s stitch records put Bernat row 5's
  increases in the wrong segments (the expansion cannot know where "Knit to first marker" ends),
  so the walk reads the row's words instead and checks them against the printed total.

- **P5.** Lace Fountain Hat: after the rib stretch, "Work 5 rnds even" is 5 rounds and "Work
  Rows 1-61 of Lace chart" is 61 numbered rounds, each with the chart chip and a count from the
  read chart: 144 at chart row 1, 90 at row 59, **84** at row 61 (research 144 → 84).
  Stranded Boot Stockings (now split by the reader into Cuff, Leg, Heel, …): the Leg is 84
  numbered rounds, chart row = round, round 1 on 84 sts, round 84 ends on 60. The p34 Leg chart has
  an unread cell on row 2, so rounds 2–83 honestly have no count (only the printed 60 at the end).
- **Reader follow-ups (knit-parse §9) taken up:** `plainRows` lines are shown as written; a set-up
  line with `stretch.within` is cast-on first, then a stretch line; the hat rib is ¾ in and its
  "Inc. Rnd" is round 7 (144 sts) after 6 rib rounds.
- **K3 glue** (for knit-3d): stranded colour from a read chart on the 3D rounds, knitting only.
- **P7.** Time Traveler out of the 8-socks book: the scan reads the p34 Stranded Boot "Leg" chart
  but it is no longer kept with Time Traveler (E12); its own charts are. The Foot (worked in
  rounds) no longer shows "RS?" (E13, the reader's `rowWord` carried onto the part).
- **tapStitches.** A 5-stitch repeat tap is one Undo, one count event.

## Audit round (release-blocking; docs/wave-k/knit-audit.md "For the owner of js/store.js")

| # | audit item | now | proof |
|---|---|---|---|
| 1 | `lineInfo` "every other rnd" (TT toe), "cont in pat" stretch (boyfriend Front "4th row" on every row), Sandnes yoke short-row line | **fixed at the cause**: only sentences that name their rows are resolved; otherwise `unsure: true` and the printed sentence | group 27; journey: Front rows 25–40 never "4th row", TT toe rnds 3–20 never the set-up round, Sandnes rnds 23–43 never a short-row line |
| 2 | `cableInfo` "cable in 1" in a stretch | **fixed**: rings from the panels | group 27 (rows 8/9/10/15 = 1/0/5/0); journey (Front stretch) |
| 3 | `knitSyncTarget`: no target after the last stretch | **fixed**: last written row (Front ends at row 102) | group 27; journey |
| 4 | `chartInfo` enumerated / repeated rows (Icelandic 15 on 17–35, 38 on 40, "65 of 64") | **fixed**; a row past the chart is unknown | group 27; journey: no chart row past its length on any Icelandic row, no row 15 on 17–35 |
| 5 | `chartInfo` from a sentence (Stranded "row 10 of 10", TT "row 1 of 1", TT Leg restarting at 1) | **fixed**: end conditions / "work even through" give row unknown; `of` only from a read chart, a panel or a range | group 27 + the changed group 11 assertion ("chart row 7", `of` null); journey (Stranded Foot, TT Leg) |
| 6 | side: "RS?" in a stretch and in Front (continued); "With RS facing … Join yarn" WS; E13 TT Foot | **fixed** (see the API doc's rules) | group 27; journey: Front stretch RS/WS alternate, Front (continued) RS/WS/RS, Shape Neck "Join yarn" row RS, TT Foot rnds 1–2 in the round |
| 7 | `untilInfo` "from tip of toe" counts only this part's rows (TT Foot ≈ 83, should be ≈ 62) | **NOT fixed**: the screen still shows "≈ row 84" for the Foot's 7¼ in; it is marked ≈ and never a target, but the number is ≈ 21 rounds high (the toe's rounds are not counted) | — |
| 8 | `markerInfo`: lone BOR / unplaceable markers noisy; Sandnes sleeve "this row makes 2" | **partly**: a lone BOR is never "set on a 48-st row"; other unplaceable markers still say "Markers set on a N-st row · this row makes M" (honest, noisy); Sandnes sleeve's "makes 2" comes from the reader's count and is still shown | group 27 (lone BOR) |
| 9 | `stretch.within` / set-up stretch ignored (boyfriend Sleeves rib) | **fixed** | group 27; journey (Sleeves row 1 is the rib stretch) |

Also not fixed from the audit's store list: Bernat Part 2 still gets no carried markers (row 8's
cast-on + join cannot be placed, so the yoke rounds have none: honest, empty), and a one-size book
pattern showing the book's first size is app.js / import.

**knit-ui.test 131 → 130 / 0:** its "past the end" check (knit-ui group 10, lines ~497–506) branches
on whether the part has a target; with fix 3 the part now has one, so it takes the one-assertion
branch ("the part has a target: the counter says it is done itself") instead of the two-assertion
one. Not a failure; the knit-ui owner may want a fixture that still runs past its end.

## Contract as built (store side)

`js/store.js` edits outside the knitting region, all one-line hooks: `partLines` (both returns
go through `knitPhased` for knitting), `lineForRow` / `targetFor` (an open stretch answers rows
past the index), `createProject` (`rowPhases` on new knitting projects), `importPatternSections`
(`knitAfterImport` at the end), `normalizeProject` history (keeps `kind: 'stretchEnd'`). The rest
is in the knitting region: P3 `knitPanelsAt` / `knitChartMeta` / `knitPanelRows`, chartInfo's
`panels`, the E3 fallback removed; P2 `lineInfo` / `knitResolveRepeat`; P1 `knitScanStretches`,
`knitBuildPhased` (the derived, renumbered parse), `stretchInfo`, `stretchList`, `endStretch`,
`useStretchEstimate`, `reopenStretch`, `setRowPhases`, `knitSyncTarget`.

Also outside the knitting region (additive): `Store.tapStitches` next to `tapStitch`; in
`importPatternSections` the part gets `rowWord` and `splitSections` keeps it; in
`buildDiagramModel` / `diagramKey` the K3 colour glue (knitting only); `setChartPages` filters by
`patternPages`; `patternSideAt` honours `Part.rowWord`.

## Measured

| page | baseline | now |
|---|---|---|
| knit-counter.test | 317 | **405 passed, 0 failed** |
| knits.journey (new) | — | **82 passed, 0 failed** (headless, fixtures read at run time) |
| knits.test | 385 | 475 (knit-parse additions; green) |
| patterns.test | 1112 | **1112** |
| patterns.fixtures (real tab) | 905 (HANDOFF) | **905** |
| store-safety / backup / blobstore (real tab) | 472 / 229 / 78 | **472 / 229 / 78** |
| crafts.test | 212 | 309 (shell-ui additions; green) |
| templates.test | 159 | **159** |
| diagram.test | 281 (when first run) | 284 (green) |
| knit-ui.test | — | 130 / 0 (see the audit round) |

knit-counter group 15's book-picker assertions were re-pointed to shell-ui's E12 fix (the open
tab is the single pattern imported, `[data-book-pick]`), with the replacement lines from
`docs/wave-k/shell-ui.md`. Crochet: patterns 1112, patterns.fixtures 905, store-safety 472
unchanged.

One existing knit-counter assertion (group 14, "for a further 2"") was written against the old
numbering; it now runs on a project switched to the old numbering (`setRowPhases(id, false)`),
which is exactly the case it describes for saved projects; group 19 covers the new numbering.

## What is left, and why

- **A stretch inside a numbered row line** (`Line.stretch.within` on a row, not a set-up line):
  ignored for now; no fixture needs it since the reader splits those ribs into their own lines.
- **Time Traveler's Leg** (toe-up): "Work even through Row 11 of Foot chart" then "Row 6 … Row 10"
  lines of the Leg chart as written rows; it does not read as one chart block, so its 60 rounds are
  not counted from the chart.
- **Stranded Boot Leg counts** stop at the first unread chart cell (row 2): a better chart read
  (knit-chart) would give every round its count.
- **Bernat row 8** (cast on 16 at the front, join) cannot place the new stitches between markers
  from the words, so the strip says "Markers set on a 36-st row" from row 8 on and the markers
  are not carried into the yoke rounds (honest, not a number).
- **Panels across parts** ("Front (continued)" carrying on the Front's panels) are not carried yet:
  the panels run within a part only.
- **History UI** for `kind: 'stretchEnd'` entries is knit-ui's / app's (the entry carries
  `stretchRows`).

## For the owner of `js/knits.js` (knit-parse)

All five items below were fixed in knit-parse §9 and are now asserted in the journey page
(kept here for the record).

- "Knit 5 (5-5-5-3-3) rnds even." carries `repeatOf: [14]` (the dec round). The store treats a
  line with `until.kind === 'rows'` that is not a "rep" sentence as a plain span, so it shows as
  written; a cleaner parse would not hang a back-reference on it.
- Lace hat: "Work in 2×2 (k2, p2) rib for 3/4"." gives `until.value: 4` (the ¾ read as 4): the
  estimate says "4 in ≈ 33 rnds" for ¾ in.
- Lace hat "Inc. Rnd: Work in St st … inc 20 sts" becomes a set-up line (row 0) after the split
  "Inc." note.
- Stranded Boot Stockings: Cuff + Leg + Heel flap in one part, the heel's "Row 1" restarting the
  numbering (E10); Bernat Sleeves still ×1 is now fixed (the journey's E9 check passes).
- The Cuff's parser `stretch` sits on the `setup` line ("CO 84 … rib until 3""); the store does
  not take a set-up line as a stretch (its row 0 is the cast-on), so that rib has no stretch.

## For the owner of `js/app.js` / `js/app-knitting.js`

- **E12 tick — fixed since by shell-ui** (the open tab is now the single pattern imported;
  knit-counter group 15 re-pointed). What I had pinned down: in the book picker (`renderGroupTabs`, app.js ~9250) the first
  pattern starts ticked and opening another tab does not move the tick, so ticking the Icelandic
  shawl imported BOTH Sophia and Icelandic and the project came out as Sophia. Rule that fixes
  it: while the maker has not touched a tick (`!ticksTouched`), the tick follows the open tab
  (`groupTicks[g] = (g === openGroup)` on tab change); once touched, leave it. (The file was
  being changed while I looked: if that is the fix, knit-counter group 15's three book-picker
  assertions need re-pointing to the new wording.)
- **Checklist from the chosen pattern only:** `buildChecks` calls `Store.suggestChecklist(text,
  craft)` with the WHOLE book text; pass the ticked patterns' section text (or the text within
  `craftData.patternPages` after import) instead.
- Charts: nothing to do; `setChartPages` now drops charts outside the imported pattern's pages.
- New store answers to show: `Store.lineInfo` (P2 line + "rnd 1 of 6 · repeat 2 of 9"),
  `chartInfo().panels` (stacked chip), `stretchInfo` / `endStretch` / `useStretchEstimate` /
  `reopenStretch` ("I'm at the length", "≈ row 101 · Use"), `addMeasurement` / `measureInfo`,
  `markerInfo().moved / unplaced / marked / plain / source 'carried'`, `tapStitches`.

## Decisions for the coordinator

- **Stretch phases are on for every knitting project created from now** (`Project.rowPhases`),
  off for saved ones; `Store.setRowPhases` exists if the owner wants an "update numbering" offer
  for old projects. A part with an open stretch has no row target (it cannot finish by itself
  mid-stretch).
- **Marked-stitch rounds**: a round that adds exactly two stitches per marked stitch, with no
  "SM" words, is read as one each side of each marked stitch (Sandnes' "inc 1 st at each side of
  marked sts"). It is the only place the walk infers rather than reads; say if you want it off.

- Boyfriend proof wording: the brainstorm says "row 132 brings all three panels back to row 1";
  with row 1 as the set-up row, row 132 is the LAST row of every panel and row **133** is row 1
  again (LCM 132 rows later). Both are asserted.
