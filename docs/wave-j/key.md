# Wave J — key worker: Floss list keys, DMC 1–35, design size, the count check, written rows

Files changed: `js/xstitch.js`, `test/xstitch.test.html`, `test/xstitch.fixtures.html` (Edit only). Nothing committed.

## Suites (Browser pane, own tab, http://localhost:8766)

| suite | baseline | now |
|---|---|---|
| `test/xstitch.test.html` | 752 / 0 failed | **945 / 0 failed** |
| `test/xstitch.fixtures.html` | 493 / 0 failed, 9 skipped | **512 / 0 failed, 9 skipped** |
| `test/xstitch-photo.test.html` | 131 / 0 | 131 / 0 (benchmark 135 → 151 ms, run-to-run noise) |
| `test/crafts.test.html` | 124 / 0 | 124 / 0 |

**Ratchet check beyond the assertions.** Before the first edit I snapshotted `parseKey`'s full output for every
fixture text the fixture page had extracted (24 text-layer PDFs) and diffed it after the change. Exactly one
fixture changed: **tinymodernist-foxy**, where DMC 19 now has `hex: 'f7c95f'` and the warning "no colour data for
DMC 19" is gone. That was the point of the change, and the fixtures page now asserts it. No entries, codes, names,
counts, kinds, sizes or confidences moved anywhere else. No new design-size form matched any fixture line.

## What the user gets

- **The owner's "Floss list" key now reads.** On the transcription (`tmp-pdf/xs-potatoes.key.json`, read at runtime):
  six DMC rows, the PDF's own names ("Tin - Dark", "Beige Brown - Very Light"), counts 100 / 1839 / 305 / 1134 / 1159 /
  1184 = **5,721**, 2 strands on every row and as the default, design 144 x 85, confidence 0.8. Before this wave the
  same text gave **no rows at all** (the leading row number was read as the floss code). The fixtures page also
  asserts the same key mangled at runtime: private-use symbol codes, row numbers glued to "DMC", "1,839", and one cell
  per line.
- **DMC 1–35 have swatches and names** (the HANDOFF gap). `04`, `4`, `001` and `DMC 04` all resolve; `nearestFloss`
  can return them.
- **`XStitch.designSize(text)`** and **`XStitch.checkCounts(data, entries)`** for the reader and the review screen.
- **Written instructions**: `writtenRows`, `rowText`, `rowDone`, `cellsOfRow`.

## Contract as built

### parseKey: the "Floss list" layout
Only its own heading (`Floss list` / `Floss list for …`) switches it on, or a header row made entirely of column
words that include a number, a name and a stitches column (`N Symbol Number Name Stitches`, any order). No fixture
has either, which is why nothing else moved. Inside it:
- A row is found by **brand + code** (`DMC 04`, `DMC04`, `1DMC 04`). Everything in front of the brand is the row
  number and the symbol column's junk (PUA codes, U+FFFD, stray glyphs; up to 4 short tokens). A word of 3+ letters
  there means prose, not a row. A readable glyph is kept as `symbol`. An unreadable one gives `symbol: ''` and the
  existing "symbols unreadable" warning. When no brand is printed, the row number tells `1 04 Tin - Dark 100` apart
  from a code.
- Numbers after the name fill the header's numeric columns **from the right**: `Blue 2 77` under `… Name Stitches`
  reads as "Blue 2" with 77 stitches. Numbers between the code and the name fill any columns the header puts there
  (`N Number Stitches Name`), and a Strands column is read. Thousands separators: `1,839`, `1.839`, `1'839`, and a
  no-break or thin space in the **last** number only (so `1 310 …` stays row 1, DMC 310). A trailing unit
  (`sts`, `stitches`) or a length column is dropped.
- Wrapped names: a continuation line is joined only in two cases. Either the row is visibly unfinished (no count yet,
  no name yet, or the name ends in " -"), or the line holds nothing but shade words (Light, Very, Pale, …). So a
  footer under the last row ("Chart imported from image", "Page 4 of 5") is never glued on. The same state machine
  handles one cell per line (an extractor that splits the columns).
- `Floss list for crosses / half stitches / backstitches / french knots / beads` maps to
  `cross / half / back / knot / bead`. `Use N strands of thread for …` sets `strands` on the rows of that section, and
  the existing strand pass still sets `strandsDefault` / `bsStrands` / `knotStrands`. A page break ends a row, the
  repeated heading on the next page carries on, and duplicate rows merge through the existing `addEntry`.
- **New KeyResult field `totalStitches`**: null unless a `Total …` line is printed. When the total disagrees with the
  sum of the cross rows, a plain warning says so ("the key prints a total of 3,540 stitches but its rows add up to
  3,537").
- Every entry carries `stitchCount` (null when the row prints none).

### DMC 1–35
The 35 colours are appended after the 454-colour MIT table (`approx: true, since: 2017`), so no existing index moves
and older colours win ties in `nearestFloss`. Names are DMC's own. The hex values come from published DMC-to-RGB
conversion charts **recalled without a download**; the source marks them approximate, to be checked against a shade
card. They are not a precise table: for example, 4 "Tin Dark" is `aeaeb1`, which looks light for "dark" next to the
owner's screenshot swatch.
- **The key parser deliberately does not see them** when it decides what a floss code is. It uses `keyHexFor`
  (exactly the old table and normalising), so a bare `9` or `20` (rulers, Anchor numbers, row labels) means what it
  meant before. Swatches for the 2017 codes are filled in after the rows are decided. Without this split, adding the
  table would have moved several fixture decisions (`nextStartsWithDmc`, `lastRowDmc`, `codeOk`).
- `canonDmcCode` also strips a brand written into the code (`'DMC 04'`). Nearest-colour expectations in the xstitch
  and xstitch-photo suites did not move. The only test changed is the table length (454 → 489), plus a second
  assertion that the MIT part is still 454. No assertion was weakened.

### `designSize(text) -> { w, h, source } | null`
The size reading that lived inline in `parseKey` is now `designSizeFromLine`, used by both (no fork). The original
four forms keep their order and looseness. Three new ones (`Design size: 144 by 85`, `144 x 85 stitches`,
`Size: / Dimensions: / Stitches: 144 x 85`) refuse a measurement (`5.9 x 8.2"`, `15 x 21 cm`, decimals) and zeros.
The first line that states a size wins. **`source` is that line as printed** (trimmed, at most 120 characters).

### `checkCounts(data, entries) -> Check` (§3 shape exactly)
- Palette entries are matched to key entries by brand + canonical code (`04` = `4`), one to one in key order. A floss
  split over two palette entries counts towards its one key row. A code listed twice in the key pairs up in order,
  and the spare row reads 0 (`unmatchedEntries`).
- Only `cross` / `blend` rows are checked (backstitch, knots, beads and halves are not cells).
- `expected` is null for a missing, null or **zero** `stitchCount` (normalized palettes store "unknown" as 0).
  Then `delta`, `pct` and **`ok` are null**, meaning "unknown", not false.
- `pct` is the signed difference as a percentage of the printed count, to one decimal (-7.7).
- `ok` = `|delta| <= max(2, 1% of expected)`. `exact` = every counted row has delta 0.
  `agree` = Σ min(read, expected) / expectedTotal (0 when unchecked).
- verdict:
  - `unchecked`: no chart, no rows, or no counts.
  - `exact`: exact, and no colours in the chart that the key does not list.
  - `close`: every counted row is ok, and the cells in colours the key does not list are at most max(2, 1%).
  - `off`: anything else.
- Summaries use fixed commas as thousands separators, not the device locale (`XStitch.fmtInt` is exported):
  - "All 6 colours match the key exactly (5,721 stitches)." ("Both colours …", "The only colour matches …")
  - "All 6 colours are within a stitch or two of the key (5,721 of 5,721 stitches); DMC 04 reads 99 of 100; DMC 310 reads 1,840 of 1,839."
  - "2 of 3 colours match; DMC 310 reads 12 of 1,839." It names the worst two rows, then "and N more are off".
  - "1 colour in the chart (4 stitches) is not in the key." is added when the chart has colours the key does not list.
  - "The key prints no stitch counts, so this chart cannot be checked against it (23 stitches read)."
  - "There is no chart to check against the key."
- With no `entries` argument, the palette is listed, unchecked. A palette's `stitchCount` may be computed from the
  chart (extractGrid does this), so it is never treated as the key's count.

### Written instructions
- `writtenRows`:
  - `n` is the label over the **whole chart** (row 1 = top, or bottom with `from:'bottom'`), so labels do not shift
    with `yFrom`/`yTo` or `skipEmpty`.
  - Serpentine: odd labels run left to right, even labels are `rtl`.
  - Runs cover the whole row in working order; -1 = skip.
  - **`x` is the chart column where the run starts as worked.** In an rtl row that is its rightmost column, and the
    run covers x, x-1, …, x-n+1. The app should use `rtl` when drawing.
  - `yFrom`/`yTo` are 0-based chart rows, inclusive, clamped, and swapped if reversed.
  - `totals.emptyRows` counts the empty rows in the range, whether or not `skipEmpty` dropped them.
  - The last unpacked chart and the last done-bitmap are cached by their packed strings.
- `rowText`: "Row 1 (left to right): skip 2, 2 × DMC 310, 1 DMC 842". Leading skips are kept. **Trailing skips are
  left off the text** (they stay in `runs`) unless `opts.trailing: true`. A run of one reads "1 DMC 842", and an empty
  row reads "nothing to stitch". `names`: `'code'` (default), `'code+name'`, `'symbol'` (falls back to the code).
- `cellsOfRow`: the ascending `y*w+x` indices of the row's stitched cells (or only those of `opts.color`).
- `rowDone`: true when every such cell is set in `progress.done`, the crosses' bitmap that `progressStats` reads (a
  test asserts the two agree). An empty row, or a row with none of the colour, is done. No chart, a row off the
  chart, or counts mode gives `false`.
- **Measured**:
  - 300 x 300 confetti (12 colours, 78,295 runs): 16.5–17.7 ms cold (including the RLE unpack), 1.6–1.8 ms warm.
  - 300 x 300 blocks: 1.9–2.5 ms.
  - `rowDone` on all 300 rows: 14–15 ms (one unpack).
  - The suite asserts under 30 ms.

## Contract changes
1. `rowText`: the contract's example keeps the trailing "skip 4". As briefed, trailing skips are dropped from the
   text by default (`opts.trailing: true` restores them). A run of one reads "1 DMC 842" instead of "1 × …".
2. `Check.rows[].ok` (and `delta`, `pct`) are `null` when the key gives no count, not `false`.
3. `designSize(...).source` is the printed line, not `'declared'`.
4. Additive changes:
   - `KeyResult.totalStitches`.
   - `FLOSS.dmc` entries 454–488 carry `approx: true, since: 2017`.
   - `XStitch.fmtInt`.
   - `XStitch._key.flossListRow / flossListHeader / keyHexFor` (test hooks).

## Left / not done
- The real PDF is not on this machine, so the extractor's true output for the owner's key is still unknown. The
  layout is built and tested for the variants listed above. When the PDF arrives, drop it in `tmp-pdf/` and add a
  text fixture.
- The DMC 1–35 hex values are approximate recollections and need checking against a shade card.
- The dmc-2168 finished-size line ("15 CM X 21 CM / 5.9 X 8.2"", with the count on another line) is still not read
  into `sizes`. It is a finished size, not a design size, and fixing it would move that fixture's parse. Small; left.
- A count with an ordinary space as the thousands separator ("1 839") is not read as one number, because it cannot
  be told apart from a name ending in a digit.

## For the owner of `js/app-xstitch.js` (app)
- Use `rowText(row, data, { names })` for "Copy as text". Pass `{ trailing: true }` only if you want the trailing skip.
- For the run chips in an rtl row, the run's columns are `x - n + 1 … x`.
- `rowDone` / `cellsOfRow` read `progress.done` (crosses). Marking the `cellsOfRow` indices there is all "Row done"
  needs.
- `checkCounts(...).rows[i].ok === null` means "the key has no count for this colour": show the read count, no ✓ / ✗.
- Swatches for DMC 1–35 are approximate (`XStitch.flossFor('DMC','4').approx === true`). If the floss sheet shows a
  "colour data" note, these deserve one too.

## Follow-up (after the app worker's integration)

Suites after the follow-up: **xstitch.test 969 / 0 failed** (was 945), **xstitch.fixtures 512 / 0 failed, 9 skipped**,
xstitch-photo 131 / 0, crafts **159** / 0. The crafts count went up from 124 because of another worker's tests, not
mine.

1. **`normalize` keeps what the picture flow records.** It now keeps exactly the fields `app-xstitch.js` writes:
   - `'picture'` is a valid `source.kind`.
   - `source.check` is kept as `{ verdict, summary, readTotal, expectedTotal, off, colours }`, with nothing else.
     An unknown verdict becomes `'unchecked'`, and the summary is whitespace-collapsed and capped at 400 characters.
     Totals are finite non-negative integers or null. `off` falls back to 0, and `colours` to null.
   - `source.picture` is the BlobStore key string, kept when it is at most 200 characters.
   - `current.rowOpts` is `{ from, dir, one, skipEmpty }`. This is the app's own shape (`normRowOpts`), with the
     same defaults: top / ltr / false / true.
   - A `color` field is kept only when one was stored. It becomes null when it is not a palette index. The app stores
     `one`, not `color`, so I kept the app's fields rather than the brief's `color` and did not add a key the app
     would keep rewriting.
   - Each of these is added only when present, so **old saves normalise byte-for-byte as before**, and normalising
     twice is idempotent (both asserted).
   - `toCountsMode` keeps all three. `dataSize` measures them. OXS export ignores them, and the export still parses.
   - Bad values are asserted to fall back.
2. **`checkCounts` summary grammar** covers 1, some and all counted colours. When only some colours have a printed
   count, the summary ends with "; N colour(s) has/have no printed count":
   - "The 1 colour the key counts matches the key exactly (8 stitches); 5 colours have no printed count."
     (also "… is within a stitch or two …" and "… does not match; DMC 842 reads 8 of 80; …")
   - "Both colours the key counts match …" / "All 3 colours the key counts match …"
   - "3 of 4 colours the key counts match; …"
   - "The only colour does not match; DMC 310 reads 12 of 99."
   - When every colour is counted, the sentences are unchanged.

   I also fixed a bug: the "close" sentence's "(X of Y stitches)" now adds up only the colours the key counts. Before,
   it used every stitch read, so uncounted colours inflated X. One earlier assertion changed wording, from "All 2
   colours the key counts match … (15 stitches)." to "Both colours the key counts match … (15 stitches); 1 colour has
   no printed count." Each form is asserted.

## For the owner of `js/xstitch-read.js` (reader)
- `XStitch.checkCounts(data, key.entries)` matches by code, so build `data.palette` with the key entries' `brand` /
  `code`, as `extractGrid` does.
- A class left unmatched should be `-1` cells or a palette entry with a code the key does not list; both count as
  `unmatchedClasses`.
- Fabric must be `-1`, not a palette entry.
