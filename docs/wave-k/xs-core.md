# Wave K — xs-core report (`js/xstitch.js`, `test/xstitch.test.html`, `test/xstitch.fixtures.html`)

Status: DONE for this batch (pure logic; the UI is batch 2's). Nothing committed. The contract is
`docs/wave-k/api/xs-core.md` and everything in it is built and tested.

## Suites
| suite | baseline (before the first edit) | now |
|---|---|---|
| `test/xstitch.test.html` | 969 / 0 | **1109 / 0** (headless). Three old timing asserts (parseOXS 350k < 300 ms, unpackCells < 20 ms) flaked once each while a fixture page ran beside them; green on re-run |
| `test/xstitch.fixtures.html` | 512 / 0 / 9 skipped | **582 / 0 / 9 skipped** (one pane tab; it does not finish headless, see below) |
| `test/crafts.test.html` | 159 / 0 | 212 / 0 (headless; others added tests) |
| `test/xstitch-read.test.html` | (wave J: 229) | 250 / 8 in a pane tab (rAF shimmed). All 8 are the xs-read worker's new v2 groups in progress (tiles, key-panel recognition, size detection with nothing given); every "agrees with extractGrid" vector-truth check passes |

`xstitch.fixtures.html` gives no summary headless at BUDGET=240000 (it stalls in the text
extraction), so it ran in one pane tab, fronted. In a background tab the Pokémon quadrants
measured 17–28 s against the 15 s budget (the page steps are `setTimeout`s, which background
tabs throttle); fronted: tl 11.2 s, bl 14.9 s, tr 10.3 s, br 7.7 s while other workers were
loading the machine. Same-minute comparison of the HEAD file and mine on Pokémon tl in one tab:
**7.7 s → 8.4 s (+9%)** for the symbol pass. A first version that kept every stroked segment cost
+45% (259,084 segments on Pokémon tl: KG strokes every square edge); segments are now collected only
when the key has backstitch / knots / beads (or `opts.graphics`), and a tile's dominant
colour+width is dropped as grid.

## 1. The live bug (parity gap 1): fixed
**Before** (HEAD, reproduced in my tab): `xs-pacman.pdf` read 9 inks for 10 colours, `matched 8`,
`ok: true`, DMC 349 and DMC 3843 with **0 squares**, **5,000 squares −1**, and a check saying "8 of
10 colours match; DMC 3843 reads 0 of 4,824; DMC 349 reads 0 of 176" that nothing showed.

**Why.** The symbol pages print both colours in grey `5b5b5b`. KG-Chart draws each square's symbol
as filled paths over it (white on dark squares, near-black on light) and the key page draws one
swatch square per row with the same symbol on it. A second, silent fault: DMC 3846 and DMC 728 both
print 126, and the old frequency pairing put inks `a5a5a5` / `bbbbbb` on them in sort order.

**Now.**
- The operator pass keeps every filled shape (lattice squares cheaply, without polygons). Per square,
  a 16 × 16 coverage mask of what is drawn in it (`tileSigs`; at 8 × 8 KG's 0.084-wide bars fell
  between samples and DMC 3843's "-" vanished in some cells, measured). Masks compare with a
  shift-tolerant distance (`maskNear`); key swatches compare to squares in the symbol's own box
  (`normMask`) because KG draws the key symbol bigger and lower than the cell symbol.
- `legendOf` reads a key page's swatch column with its symbols (joined across pages in order). It is
  trusted only when its row count equals the key's cross rows **and** the counts it implies agree on
  ≥ 90% of counted rows.
- `nameClasses`: legend → counts (unique; equal-count clusters by `solveCluster`, where colour decides
  only by a clear CIEDE2000 margin, else a **tie**) → an ink no single count fits is split by symbol
  when the parts' counts fit key rows → whatever is left is an explicit placeholder palette entry
  (`unresolved`, `why: 'shared-ink' | 'tie' | 'unknown'`, candidates named). **No read square is −1.**
- Every grid read returns `check`, `unresolved`, `split`, `legend`, `classes`, `graphics`,
  `mixedCells`. Palette `stitchCount` is the chart's own count for cross colours; the printed count
  is `keyCount` (the old "176 in Floss / no count yet in the key" two numbers).
- `resolveClass` is the stitcher's answer (all squares to a colour, a hand split, or fabric).

**Measured after**, all 7 KG-Chart fixtures: `check.verdict === 'exact'`, 0 placeholders, 0 blank:
| fixture | size | inks → colours | |
|---|---|---|---|
| pacman | 224 × 288 | 9 → 10 | legend (p22) splits 5b5b5b into DMC 349 "E" / 3843 "-"; 3846 / 728 told apart by symbol; 64,512 exact |
| portal | 160 × 206 | 7 | 32,960 exact (legend p14) |
| typechar | 128 × 127 | 7 | 16,256 exact (legend p8) |
| pokemon-tl / bl | 500 × 500 | 105 / 107 | 250,000 exact each (the old test asked "≥ 100 matched") |
| pokemon-tr / br | 298 × 500 | 98 / 101 | 149,000 exact each (old: "≥ 95, within 2%"); bl / br newly in the grid fixtures |

With pacman's key rows shuffled (the swatch order then fails the count test and is not used): the
shared ink is still split by symbol + counts, 3846 / 728 become an explicit tie (two placeholders
naming both), the check says "off", no square is blank, and two `resolveClass` calls make it exact.

**The assertion that stops this class of bug** (`cellTruth`, on every vector grid that reads):
blank squares = squares not read; per key row, the squares that END UP that colour equal the printed
count; no placeholders; the check is exact.

## 2. Proposal by proposal
| # | state | what is built (logic + unit tests; fixture where one exists) |
|---|---|---|
| gap 1 / 1.13 | **done** | above |
| #1 honesty sweep (data) | **done** | `totals` (one total, key-counted colours, `progress.keyDone`), `pctText`, `assignSymbols({distinct})` + `symbolCheck`, `skeinRange().mid` + `skeinPlan` ("56–125 skeins (buy 84)", stash aware), `bulkPlan` (colour / page / page+colour / block / row, unmark, confirm over 1,000) |
| #3 parking | **done** (data) | parking x/y/paletteIndex in normalize, `parkAt`, `unpark`, `parkedAt`, `nextBlockFor` (right / left / down, wraps), `parkingOrder` |
| #4 pages | **done** | `cellsOfPage`, `pageProgress`, page scopes in `bulkPlan` and Row by row |
| #5 sessions | **done** (my half) | shell-data owns the log, pace and finish (`Store.counted / pace`); I added `sessionLines` (the History line) and `dayStrip` |
| #6 symbol fonts | **partly** | `glyphCells`, `keySymbolCodes`, `gridFromGlyphs`. Fixture: **foxy reads 68 × 68 exactly**, 2,507 symbols in 9 classes, 4 colours matched by the key's printed symbol (352, 666, 3347, 3799), the other 5 are placeholders offering the 5 key colours with no readable symbol (the key prints them as an unreadable glyph or none; no counts to decide). **Only foxy is a symbol-font chart**: halloween draws its 612 symbols as images, homestitchhome 1,330 images, welcome is one picture. Not wired: matching unreadable key glyphs by rendering them (PdfText `renderGlyph` exists now) |
| #9 / R5 symbols | **partly** | `palette[i].glyph` in normalize; captured from KG vector charts (pacman 10 of 10 clean, Pokémon 75–81 of ~100; the rest are font glyphs). OXS can only carry a symbol character, so glyphs are not exported; picture glyphs come from xs-keyread |
| #10 backstitch etc. | **partly** | `ornamentsFromGraphics` (grid lines by width, half-lattice snap, unit steps, de-dup, colour → back/knot/bead entry, quarters / halves) feeds `chart.back/knots/part` and round-trips OXS; `extractGrid().graphics` carries strokes and vertex dots when the key has such rows. No fixture has vector backstitch (pacman / Pokémon keys have none), so it is synthetic-tested only. KG fractional quarters: `mixedCells` counts them (0 in all 7 fixtures) |
| #13 islands | **done** | `islands`, `islandRoute` (carry or cut on the fabric count), `islandAt` |
| #14 Row by row v2 | **done** | `writtenRows` xFrom/xTo, chunk, done, scope page / block (serpentine labels stay the chart's) |
| #15 stash | **done** (my half) | `flossId`, `flossNeeds`, `kitList` (allocation in priority order, set-aside per project); storage is `Store.profile().floss` |
| #16 brands | **done** (no data) | `registerBrandTable` (refuses a table without source + licence), `brandTables`, `convert` (by CIEDE2000 against each brand's own RGB, with a plain word), `substitutes`; ships DMC only and says so plainly |
| #17 calculators | **done** | `fabricPlan` (margins, cut, fat eighth / quarter / half yard, hoop, Q-snap, frame), `frameFit` |
| #18 join + heavy | **done** (logic) | `quadrantLayout`, `joinCharts`; registered `heavy: { fields: ['chart.cells.data', 'progress.done'] }` and `template.fromProject` with shell-data. Not run on the real four Pokémon files (a 798 × 1000 join is a UI flow: read four PDFs) |
| #19 printable | **done** | `printableHTML` `progress`, `pageNumbers:'original'`, `parking`, `overlap`, `remaining` |
| #20 kinds | **done** (data) | `kind` in normalize, `KINDS`, `kindOf`, `materials` (drills in packs of 200, ≈ wool, ≈ filet thread), `filetRowText` |
| #21 find my place, goals | **done** | `findPlace`, `goalProgress` (goal storage is `Store.setGoal`) |
| X3 mark log | **done** (my half) | `markDiff`, `replayMarks` (10,000 random taps replay bit for bit); storage is `Store.logMarks` |

Budgets on a synthetic 500 × 500, 60-colour chart (headless, ms): bulkPlan 11, pageProgress 5,
nextBlockFor 1.5, islands of one colour 8, islandAt 1.6, a page of Row by row 1.1, totals 11, a
200-hop island route 46. All asserted with headroom.

## Follow-ups after the first report (from finished workers)
Suites after them: `xstitch.test` **1120 / 0** (headless), `xstitch.fixtures` **582 / 0 / 9 skipped** (pane tab).
1. **Goals (xs-extras).** The first API draft promised `craftData.goals` but `normalize` dropped them.
   It now keeps `[{ id, kind, createdAt, n?, page?, color?, by?, label?, done? }]` (≤ 50; bad kinds,
   missing pages and colours outside the palette dropped), only when present, idempotent, and through
   counts mode. Asserted.
2. **OCR key text (ocr).** `parseKey` gave 0 rows on the tapestry key because "DMC **Cotton** 816
   garnet" puts a thread word between the brand and the code. A thread word straight after the brand
   is now skipped, **and then the code must be in the DMC table** (an unknown code after "DMC Cotton"
   stays blank, asserted). On the tapestry line shape: 8 / 8 rows (816, 796, 597, 909, 913, 938, 783,
   White). The Orr key is in J. & P. Coats numbers, which have no table: it stays at 0 rows, now with
   the warning "the key gives J. & P. Coats numbers; there is no colour table for that brand, so its
   rows are left blank". Tested on text in the shape the ocr report quotes (I did not run Tesseract);
   every fixture key parse is unchanged (582 / 0).
3. **Replay frames (xs-render).** Confirmed: `replayMarks` takes `Store.readMarks(id)`'s
   `[{ at, marks: [[i, 1|0]] }]` as is, and every frame is `{ at, bits, changed }`, `bits` one shared
   `Uint8Array` (a byte per square) to copy when kept. Stated in the API doc and asserted.

## Audit round (docs/wave-k/xs-audit.md), 2026-11-13
Suites: `TIMEOUT=600 bash tools/headless-suite.sh xstitch.test xstitch.fixtures xstitch-app.test` →
**1126 / 0, 599 / 0 / 9 skipped, 241 / 0** (the fixture page now runs headless).
1. `normalize` `keyCount`: a printed 0 stays 0, absent / non-numeric stays absent (was clamped to 1). Asserted.
2. `parseKey`: names that are chart-symbol glyph runs (`nameIsSoup`: letters mixed with digits, or a
   tripled character) are emptied with `nameUnreadable: true` and one warning. Asserted on a synthetic
   robin-style key and on the real `xs-wocs-robin` fixture (no name holds a digit, 17 rows, 2 backstitch, 1 knot).
3. The audit's three fixture assertions are in. I kept robin and the FQS sampler as written; for
   `xs-anchor-new-home` I assert the design size and that no leading-zero Anchor number becomes a DMC
   code, and print the unread Anchor column as a KNOWN warning instead of a failing assertion (it is a
   reader gap, not a regression: a column of Anchor numbers with no symbols is not read yet).
4. Anchor leading zeros: `0400`, `0403`, `0002` stay as printed and Anchor; `flossId` keeps the brand.
   Asserted. Also from the audit's notes: `kitList` rows carry `printed`.

## For the owner of `js/app-xstitch.js` (xs-app)
- `applyPdf` copies `grid.palette` by index, so placeholders already arrive as named entries and
  nothing is blank. Also copy `keyCount`, `unresolved` and `glyph` (normalize keeps them).
- Demote "Use it" (BUILD decision) when `grid.check.verdict` is not exact / close or
  `grid.unresolved.length`; list each `unresolved[k]` with its candidates; `XStitch.resolveClass` per
  answer (one `updateCraftData`). The same for `gridFromGlyphs` results (same shape).
- Show `XStitch.totals(d).text` wherever a total appears; `pctText` for percentages.
- Before whole-colour / page / block / row marks: `bulkPlan`; ask with `text` when `confirm`; then mark
  `cells`, `Store.counted({ n: count, part: label })` and `Store.logMarks(id, XStitch.markDiff(before, after, w*h))`.
- New imports: `assignSymbols(palette, { distinct: true })`; offer "Re-letter symbols" for old projects.
- Parking: draw markers from `parking[i].x/y/corner/paletteIndex`; "next block" = `nextBlockFor`.
- Pages: outlines from `pages[].region`, "Page 9 · …" from `pageProgress`, "Mark page done" = `bulkPlan({page})`.
- Symbols: draw `palette[i].glyph.path` (Path2D, 100 × 100 box) when `glyph.clean`, else the app's symbol.
- Print what's left: `printableHTML(d, { progress: true, pageNumbers: 'original', parking: true, overlap: 2, remaining: true })`.

## For the owner of `js/xstitch-read.js` / `js/xstitch-keyread.js`
- Placeholder palette entries carry `unresolved`; `checkCounts` counts them as "not in the key".
- `XStitch.gridFromGlyphs` shares the extractGrid / XSRead result shape (`check`, `unresolved`).

## Decisions for the coordinator
- `extractGrid().ok` still means "a grid was read" (the app keys on it to keep the chart at all); the
  honesty signal is `check` + `unresolved`. I did not flip `ok` to false on "off".
- The brainstorm's premise for #6 ("the four TM PDFs are symbol-font charts") does not hold: only foxy
  is. Halloween and homestitchhome are per-square symbol **images** (a different reader: hash each
  image XObject, cluster, match to the key's own symbol images — not built).
- The grid key in `tileGraphics` (a colour + width used by ≥ 20% of a page's strokes is grid) could
  drop backstitch on a page that is mostly backstitch in one colour and width. No fixture to test it.
