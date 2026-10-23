# Wave H: `knit-chart` (contract §5)

Files: new `js/knit-chart.js` (`window.KnitChart`, ES5 IIFE, no DOM), new
`test/knit-chart.test.html` (151 passed, 0 failed), this report. No other file touched.

## What it does

`KnitChart` reads knitting charts off a PDF page. For each chart it returns:
- its grid of symbols, matched to the page's own key;
- the row numbers;
- the repeat boxes.

It also writes any row out ("k2, yo, ssk, k4, k2tog, yo, k2") in knitting order. The counter
worker uses this for the "chart row 7 of 16" chip.

### The contract assumed glyphs. Every fixture chart is a drawing.
None of the knitting fixtures has a chart set in a symbol font. Every chart is vector paths:
thousands of moveTo/lineTo/curveTo operations, with only the row numbers, captions and key words
in the text layer. The research worker found the same thing. So the reader works from
`page.getOperatorList()`, in five steps:

1. **Grid.** Grey/black axis-aligned rules are merged and grouped into connected lattices.
   Boundaries are made evenly spaced, and missing lines are filled in. A rule inside a cell (a
   purl dash, a bracket) is skipped.
   - A cell exists when all four of its edges are drawn, or it has a fill, or it has three edges
     and a symbol. This keeps stepped edges and the notches beside offset rows from becoming
     cells.
2. **Cell content.** Each cell's ink is reduced to a small descriptor in cell units:
   - lines;
   - rings and dots;
   - filled polygons with their colour;
   - background colour;
   - text glyphs that sit inside the cell (the Icelandic shawl's stray "#" and "2" are read this
     way).
   - Ink wider than a cell is a span (a cable).
   - When two fills of the same colour overlap, only the one painted last counts. That is what
     tells C4F from C4B.
3. **Key.** The key's sample boxes are drawn with the same paths, on the same page. Each sample
   gets the same kind of descriptor, and its meaning comes from the text to its right.
   - Meanings that run onto more lines are joined, including lines above a tall coloured sample.
   - Each cell is matched to the nearest key entry. The cost penalises line angle, so a slash
     never matches a dash, and it uses Hausdorff distance for polygons.
4. **Unmatched cells become "?n".** Nothing is ever guessed as a plain knit.
5. **What the page hides is dropped.**
   - Clip paths are tracked as real polygons, because colourwork clips each colour's symbols to
     its own cells.
   - White fills painted on top hide what is under them.
   - Text whose show-text op ran under a clip that hides it is dropped. The sock ebook has a
     whole hidden page of another pattern's text sitting on top of p6.

A glyph-font reader (the contract's original idea) is there as a fallback when a page has no
drawn grid:
- it splits runs of glyphs into one glyph per cell;
- a glyph several cells wide is a cable span;
- the key is a glyph to the left of its meaning.

It is only tried with no drawn grid on the page and at least 9 glyphs on a regular grid of at
least 3 by 3. Two stray glyphs can never make a chart.

A raster picture becomes `{ source: 'image', image: true, cells: null, mentions }`, but only when
it looks like a chart:
- mostly white, with evenly spaced long rules in both directions (pixels read through
  `page.objs` / `commonObjs` and an OffscreenCanvas);
- and the page talks about a chart.

## API (`window.KnitChart`)

| Call | Returns |
|---|---|
| `fromHandle(handle, pageNo, opts)` | **Promise**<Chart[]>. `handle` = `PdfText.open(file)`. `[]` when the page has no chart. `opts.cells: false` returns drawn charts without cells. |
| `scan(handle, {pages?, maxPages?, signal?, cells?})` | Promise<[{page, charts}]> for every page (34 pages ≈ 2–4.5 s). A chart with no key of its own borrows the key of the nearest page within 3 that has one (`chart.legendFromPage`). |
| `rowText(chart, rowNo, side, opts)` | `"k3, *p1, k2, ppso, yo; rep from * to last 3 sts, k3"`, or `null` when the row is not charted or a symbol in it is not in the key. `opts.partial` writes `[?]` for those symbols instead. `opts.repeat`: `false` ignores boxes; `n` uses `chart.repeats[n]`. |
| `rowCells(chart, rowNo, side)` | The row's units in knitting order: `[{sym, c0, c1, stitch, text, run, color, consumes, produces, skip, unknown}]`. |
| `rowInfo(chart, rowNo, side)` | `{text, consumes, produces, unknown}`. Counts are `null` when any stitch's count is unknown. |
| `rowNumbers(chart)`, `find(charts, "Chart A" / "A" / "Leg")`, `parseMeaning(text)` | Helpers. |
| `fromPageData(data, opts)`, `readPage(pdfPage)`, `settle(charts, opts)` | The synchronous core and its pieces (used by the tests). |

`side`:
- `'rs'` reads right to left;
- `'ws'` reads left to right;
- `null` means in the round: right to left, and side-dependent keys resolve as RS;
- left out (`undefined`), the side comes from where the row number is printed: right = RS,
  left = WS, otherwise by parity.

Chart object, beyond the contract fields (`name, cols, rows, cells, legend, noStitch, readRS,
startRow, repeatBox`):

- `page`, `source` (`'vector'|'glyph'|'image'`), `drawn`, `image`, `bbox`, `pitch`.
- `cells[0]` is the **bottom** drawn row and `cells[r][0]` the **leftmost** column. `null` means
  no cell is drawn there (a stepped edge).
- `spans: [{r, c0, c1, sym}]`: symbols drawn across several cells (cables).
- Row numbering:
  - `rowStep`: 2 when only right-side rows are charted (Icelandic shawl).
  - `rowNos`: the row number of each drawn row.
  - `rowNumbersGuessed`: true when no row numbers were printed.
  - `labelSide`: which side each row number is printed on.
- `legend[]` entries carry:
  - `sym, meaning, stitch, text, kind, consumes, produces, color, w, count`;
  - `rs`/`ws` for side-dependent keys, and `cross` for cables;
  - `kind` is one of stitch, nostitch, repeat, setup, marker, note, unknown.
  - `stitch` is one of the parser's tokens: `k p yo k2tog ssk k3tog sk2p cdd m1 kfb sl ktbl
    ptbl mb cable nostitch`, or `null` for wordings like "p1, k2, ppso".
  - `text` is how `rowText` writes the stitch. Plain cables become `C4F`/`C4B`. Complex cables
    are the key's own words in brackets.
- Repeats:
  - `repeats: [{c0, c1, r0, r1, label, only, byRow?}]`. They come from coloured boxes (labelled
    from the key) and from "Repeat" brackets or "6 st repeat" captions under the grid.
  - `only` marks a box like "for sizes worked over 60 sts", where only the boxed stitches are
    worked.
  - `repeatBox` is the first repeat, or `null`.
- `marks`: set-up rows, turning-point lines, markers.
- `unknown: [{sym, count, at}]`.
- `turned`: a chart printed sideways, read in its upright frame.
- `legendFromPage`: the page a borrowed key came from.
- `unread`: why `cells` is `null` on a drawn chart (see below).
- `mentions`: on image charts, the chart names the page text mentions.

How `rowText` writes:
- Runs are compressed ("k5", "p22").
- Repeated decreases are written "ssk twice" / "k2tog 3 times". A yo is never folded, because
  "yo twice" means something else.
- A repeat box is folded into "*…; rep from * to last N sts, …". N comes from the key's stitch
  counts. Copies of the unit drawn outside the box fold into the repeat, which leaves the
  instruction unchanged.
- A size-only box (`only`) writes just its own stitches: "*…; rep from * around".

**Automatic fallback (`settle`).** A drawn chart comes back with `cells: null, drawn: true` in
three cases:
- the page has no key (`unread: 'no key'`);
- more than 25% of its cells are not in the key (`'symbols not in the key'`);
- the caller passed `opts.cells: false` (`'not asked'`).

It keeps its name, rows, row numbers, width, key meanings and repeats. `scan` settles only after
borrowing keys from nearby pages.

## The fixtures: what reads

| Fixture / page | Chart | Result |
|---|---|---|
| lace p7 | Oriel 13×28 | **Full**. The overprinted title is read once. |
| lace p9 | Henley: Right/Left-Front ×2 sizes, Back and Sleeve (22/21/18 × 20) | **Full**. Every row consumes and makes `cols` stitches. Red 8-st repeat box. |
| lace p15 | Icelandic Charts A–F (rows 2–64, right-side rows only) | **Full**. Written rows match (below). B, D and F are half charts (to the centre). |
| lace p27 | hat "Lace" 24×61 | **Full**. |
| lace p29 | Arrowhead shawl Charts 1–2 | **Image** (`cells: null`, mentions "Chart 1", "Chart 2"). |
| socks p6 | Foot 32×12, Leg size 7" 51 sts ×12 | **Full**. Rounds 6 and 10 hold 50 and 52 stitches: these are the rounds marked "* Work as given in directions", where the start of the round moves. |
| socks p7 | Leg 8½" (63 sts), 9½" (75 sts), printed sideways | **Full**: read turned, with the key borrowed from p6 via `scan`. |
| socks p16 | Cable Pattern 34×44 | **Full**: knit, purl, yo, k2tog, ssk, C4B ×14, C4F ×23 and three cable-with-decrease symbols. Repeat boxes for 60 and 68 sts, set-up rounds 1–4. |
| socks p23 | Chart A 6×21 | **Full** colourwork (MC / CC1 / CC2 fills with symbols). |
| socks p23 | Chart B 6×5 | **Partly**: 4 cells unknown (Rounds 2–3 return null). A symbol clipped out of a neighbouring colour leaks into those cells. |
| socks p30–31 | argyle Small 64×31, Medium 74×37, Large 90×45 | **Partly**: 1–2 unknown cells per chart. Their rows return null; every other row reads. |
| socks p34 | Instep 31×26 | **Full**. |
| socks p34 | Leg 28×84 (narrowing) | **Partly**: 1 unknown cell; k2tog ×4 and sl1-k1-psso ×4 are read. |
| Bernat, Sandnes, Rico, Magic Loop | no charts | `[]`. Sandnes' gauge icons and zigzags are not taken for charts. |

**Ground truth: Icelandic shawl rows vs the pattern's written rows.** All are asserted in the
test. The written wording is normalised: "until N sts rem" becomes "to last N sts", and
"into next st" becomes "in next st".
- Chart A Rows 6 and 8, Chart E Rows 3 and 5, Chart C Rows 42 and 44 match **exactly**, e.g.
  E3 = `k3, *p1, k2, ppso, yo; rep from * to last 3 sts, k3`.
- Chart B Row 14 matches the written first half: `k1, *k3tog, k3, yo, k2, yo, k3; rep from * to last 3 sts, k3tog`.
- Chart D Rows 58 and 60 match their first halves.
- Chart E Row 11 and Chart C Row 38 match too.
- I checked Chart F 17–21 and Chart B 16/22/34 by hand. They match the first halves.

## For the counter worker
- Call `KnitChart.scan(handle, {signal})` once after import, in the background. Store `charts`
  per page; they are plain JSON, about 14 KB for the cable chart.
  - Or call `fromHandle(handle, page)` for one page.
  - `find(charts, line.chart.name)` maps "work row 7 of Chart A" to a chart.
- For the chip:
  - Use `chart.rows` and `chart.rowNos`. With `rowStep: 2`, only those row numbers are charted;
    the even rows are worked "as given in the pattern".
  - Show `rowText(chart, rowNo, side)`:
    - pass `null` when the part is worked in the round;
    - pass the part's `'rs'`/`'ws'` when flat;
    - leave it out only if the side is unknown.
  - Show the chart without a written row when `rowText` returns `null`, `chart.cells === null`,
    or `chart.image` is true.
- For several size boxes, pick `opts.repeat` by size. Each `repeats[n]` carries `label` and
  `sizeSts` (60 / 68 on the sock chart).
- `rowInfo(...).consumes / produces` can check a row's stitch count against the pattern.
- The page image is still the right thing to open from the chip. `chart.bbox` is in PDF points
  and can crop it. On sideways charts use `chart.pageBox` (`bbox` is in the turned frame).

## Contract changes
1. `fromHandle` returns a **Promise**, because pdf.js text and operator lists are async. Accepted
   by the coordinator.
2. Drawn (vector) charts are read cell by cell, not returned as `cells: null`. They fall back to
   `cells: null, drawn: true, unread` under the rules above. Raster charts give `image: true`.
3. Additions: `scan`, `rowCells`, `rowInfo`, `rowNumbers`, `find`, `parseMeaning`, `settle`; the
   chart fields `spans`, `rowStep`, `rowNos`, `labelSide`, `repeats`, `marks`, `unknown`,
   `turned`, `legendFromPage`; `opts.repeat` and `opts.partial` on `rowText`.
4. `cells` orientation is defined: `cells[0]` is the bottom row and `[r][0]` is the leftmost
   column.

## Verified, and what is left
- Verified in the dev pane (tab of `localhost:8766`): `test/knit-chart.test.html` 151 / 0. It
  covers:
  - unit tests;
  - a synthetic 12×8 glyph lace chart with a WS row, a one-text-run row and a 4-cell cable
    glyph;
  - a synthetic drawn chart with a cable, a repeat box, the no-guess rule with a key sample
    removed, and `cells:false`;
  - the real pages above, including no-guess on the real p9 with "k2tog" removed from the key.
  - I compared the readings against page renders for p9, p15, p16 (cable crossings zoomed),
    p6/p7 and p23.
- No UI, so there are no screen sizes to check.
- Left:
  - Half charts (Icelandic B/D/F) are written for the half shown. The mirror-image second half
    is not generated.
  - The few unknown cells on socks p23 Chart B and the argyle and Leg charts.
  - A symbol-font chart in a real PDF has not been seen yet; the glyph reader is tested
    synthetically only.

## For the owner of `index.html` / `sw.js` (shell)
Load `js/knit-chart.js` after `js/pdftext.js`, and add it to PRECACHE. It needs `pdfjsLib` only
at call time, through the handle.
