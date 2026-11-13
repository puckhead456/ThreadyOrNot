# Wave K: xs-keyread (picture keys read as a cipher)

Status: DONE for batch 1 (the engine and its tests). The UI is the xs-app worker's (batch 2).
Owns: NEW `js/xstitch-keyread.js` (`window.XSKeyRead`), NEW `test/xstitch-keyread.test.html`.
Contract (exact): `docs/wave-k/api/xs-keyread.md`.

## Baseline
Both files are new, so there was no earlier suite. No other file was edited.
Final: `BUDGET=400000 VIRTUAL=1 bash tools/headless-suite.sh xstitch-keyread.test` → **91 passed, 0 failed,
0 skipped** (71 before the last round) (the fixture ledger needs `tmp-pdf/`; it skips cleanly when the files are absent).

## What the user will see (once xs-app wires it)
A key that is a picture (the owner's screenshot, a Satsuma / Tiny Modernist / APL key panel) reads
as "DMC 310 · 1839" rows, each with the printed swatch and the designer's own symbol. Rows it could
not pin down show `3?0` with the possible codes to tap, or a blank box. It never puts a guessed
code in the key.

## How it works (02 #7, #9; 04 R1, R5, R6)
1. **Layout from pixels.** Paper = the most common colour; a "not paper" mask; long thin rules
   (table lines, grid lines) are taken out; 8-connected components. Swatches are filled or outlined
   blocks of one common size lined up in a column (pale swatches from a fainter mask; swatches
   printed edge to edge are cut at their colour changes; wide band swatches allowed). Big dense ink
   regions (a chart on the same page) are ignored. Glyphs are grouped into text lines, words by the
   page's own gap valley, one row per swatch (words chained to it), plus rows printed with no swatch
   inside the swatch block (White). Columns are unions of word x-ranges relative to the swatch; typed
   as index / symbol / brand / code / number (Anchor) / name / count.
2. **Digits as a cipher.** Each glyph becomes a 16 × 16 coverage descriptor; glyphs are clustered by
   shape and height (one font: one shape is one character). Clusters are scored against digits and
   letters drawn with `fillText` in the faces the browser has (14 on this machine) at the nearest of
   five sizes: a prior only. A branch-and-bound search over cluster → digit keeps every solution
   within a margin of the best, scored by: every code in the DMC table, codes distinct, the swatch
   near the code's colour (CIEDE2000, colour keys only), an index column 1..n, a count column that
   sums to the chart's total and matches its classes, a sorted key. A row is **exact** only when all
   near solutions agree AND an independent check holds (swatch dE ≤ 18, count = chart, printed name =
   table name, or clear template matches in a mostly explained key). Extra guards found by testing:
   a column counting 1, 2, 3 … is row numbers, never codes (DMC 1–35 exist since 2017, so a row-number
   column once passed as codes); one- and two-digit codes need the swatch, count or name; a search cut
   short by its budget needs both checks; on a black-and-white sheet the "swatches" are symbols and
   give no colour evidence. White / Blanc / Ecru are read as words by letter templates and are exact
   only with a light printed swatch.
3. **The symbol** of each row (symbol column, or printed on the swatch) is a 16 × 16 1-bit bitmap in
   a cell the size of the swatch, with `clean` (isolated, one piece, contrast, agrees with the copy on
   the swatch). Vector paths: not available (see asks).
4. **`readNumbers`** for ruler numbers and count columns; with `expect: 'step'` the sequence pins the
   digits pair by pair.
5. **Output** in `parseKey`'s entry shape plus `read` (status, text, candidates, evidence, why).
6. **Ledger** in the test page; truth for the PDF fixtures was read by eye into gitignored
   `tmp-pdf/<fixture>.key.truth.json` (matryoshka, autumn, Satsuma × 5, tapestry-painted, orr-book14).

## Measured (headless Chrome, this machine)
### Accuracy ledger: rows exact / partial / blank / **wrong**
| fixture (key) | rows | exact | partial | blank | wrong |
|---|---|---|---|---|---|
| owner's potatoes screenshot | 6 | **6** | 0 | 0 | 0 |
| potatoes + stitched total | 6 | 6 | 0 | 0 | 0 |
| potatoes + chart read | 6 | 6 | 0 | 0 | 0 |
| Tiny Modernist matryoshka p1, key crop | 8 | 7 | 0 | 1 (White: no swatch to confirm) | 0 |
| Tiny Modernist autumn p1, key crop | 5 | 5 | 0 | 0 | 0 |
| Satsuma stay home (colour), key crop | 14 | 13 | 1 | 0 | 0 |
| Satsuma stay home (B&W), key crop | 14 | 8 | 5 | 1 | 0 |
| Satsuma summer's flight (colour), 5-column key | 13 | 11 | 0 | 2 | 0 |
| Satsuma summer's flight (B&W) | 13 | 12 | 1 | 0 | 0 |
| Satsuma sunshine | 9 | 9 | 0 | 0 | 0 |
| APL tapestry-painted p5, legend crop | 8 | 7 | 0 | 1 (White word) | 0 |
| APL orr-book14 p19 (J. & P. Coats, not DMC) | 8 | 0 | 0 | 8 | 0 (correctly claims nothing) |
| whole pages, no crop: matryoshka / autumn / stay home / tapestry | 8 / 5 / 14 / 8 | 5 / 0 / 0 / 0 | | rest blank | 0 |

**Zero wrong codes anywhere** (asserted per fixture). On the owner's screenshot and the key crops: 78 of 90 DMC rows exact (87 %), 7 partial, 5 blank.
Whole pages read far less (the key is found but the chart and page text crowd the layout): pass a crop.
Potatoes counts: **6 of 6 read** (100 / 1839 / 305 / 1134 / 1159 / 1184) after the last round, none wrong. Symbols: 4 of 6 potatoes symbols captured cleanly; 8 of 8 synthetic.

### Synthetic (committed tests)
17 keys in Arial, Times New Roman, Verdana, Georgia (old-style figures), Courier New, Trebuchet MS,
Segoe UI and the default sans-serif, 10–24 px digits, JPEG q 0.55 / 0.7 and a 0.6× draw-down, with
and without brand word, index, counts, swatch symbols, a B&W list, unsorted codes, 3 and 60 rows:
**136 exact, 9 partial, 1 blank, 0 wrong of 146**. Names matched to the table on ≥ half the rows;
symbols clean 8 / 8; counts read 8 / 8; three ruler fonts read 10…120 exactly; worker = main thread
output (determinism); cancel resolves "cancelled".

### Time
60-row key (704 × 2016): 0.2–0.7 s in the worker (asserted < 2 s). Key crops 0.1–0.45 s. The 10 px
synthetic key 1.2 s (many split glyph clusters; node budget 200 k). **Whole 2400 × 3100 pages take
2.0–2.7 s** (three labelling passes and rule removal over 7 M px): over the 2 s goal, another reason
to pass a crop.

### Verified where
Headless Chrome only (`tools/headless-suite.sh`; the Browser pane had no free tab). Screenshots of
fixture pages were taken headless to read truth by eye. No UI here, so no phone sizes or themes to
check. Headless virtual time races ahead while a Worker computes; the test page keeps a chain of
tiny fetches going in headless runs (fetches pause virtual time), so the worker path really runs.

## Left, and why
- **Whole-page keys**: needs the page segmenter (02 #8 / R2) or the user's crop. The engine takes
  `crop`; the app should ask for a box (or take `PdfText` `pageKinds` / layout hints) first.
- **Vector symbol paths** (`glyph.path`): `PdfText.layout` exposes drawings as counts and boxes only.
- **Non-DMC brands** (Anchor, J. & P. Coats, Cosmo): nothing can be confirmed without a table; such
  rows come back blank (orr-book14 proves it claims nothing). An Anchor column beside a DMC column is
  typed `number` and its digits help the cipher.
- **Letter codes** B5200, E-numbers: not decoded (blank).
- **Run-together digits** ("00" in a serif face) are split only when there is a clear ink valley.
- The 10 px default-sans key is mostly partial: honest, but small text needs a bigger render.

## For the owner of `index.html` and `sw.js` (shell-ui)
Add `<script src="js/xstitch-keyread.js"></script>` after `js/xstitch.js` (and after
`js/xstitch-read.js` if you keep them together) and `'js/xstitch-keyread.js'` to `PRECACHE_URLS`.

## For the owner of `js/app-xstitch.js` (xs-app, batch 2)
- Call `XSKeyRead.read(canvasOrBlob, { crop, chart, total })` when an import has no text key
  (`parseKey(...).imageOnly` or 0 rows). Ask for a box around the key on a whole page.
- Treat `entries` like parseKey entries. Show `read.status !== 'exact'` rows with `read.text` and
  `read.candidates` as one-tap confirms, `read.why` in small print; never save a partial's code.
- `entry.glyph.bits` (16 × 16, MSB first) is the designer's symbol; use it only when `clean`.
- `readNumbers` is there for ruler numbers when joining page tiles (xs-read).

## For the owner of `js/pdftext.js`
If `layout()` could return each drawing's path operators (or `renderGlyph`-style access to a path
inside a box), key symbols on vector pages could be stored as `glyph.path`.

## Decisions for the coordinator
- The reader is DMC-only by construction; a brand table for Anchor would double what it can confirm
  (Tiny Modernist prints both). Shipping one is an owner decision (data source and licence).
- Whole-page reads are slow-ish and weak; I recommend the app always asks for the key box (or
  uses the segmenter) rather than reading the page blind.

## Last round (from the cross-stitch audit)
- **Why the audit saw 3 of 6 potatoes counts**: not a crop / scale / total difference. The app's call
  (`read(blob, { crop, chart, total })`) and the test's call fail the same way; my earlier report did
  say "counts 3 of 6" but led with "6 of 6 exact", which was about codes. Two causes: (1) a row's words
  were chained to the swatch with a 14-text-height gap limit, and the count column sits ~15 heights
  past a short name ("Tin - Dark", "Black") or past the "4 of 5" overlay that hides row 6's name, so
  the count was never part of rows 1, 2 and 6; (2) "100" prints with the two zeros touching. Fixes:
  the right-hand gap limit is 40 heights (charts beside a key are already excluded as dense regions);
  run-together digits are cut at the darkness valley, judged against the glyph's own height. Now 6 of 6
  counts, in every configuration (plain, with the total, with a chart read).
- **Every row says what became of its count**: `read.countStatus` `'read' | 'not-read' | 'none'` with
  `read.countWhy` in plain words; `stitchCount` is null unless read. Asserted on potatoes (every row),
  on a synthetic key with the count column far right (all read) and one with no count column ('none').
- **Anchor-only and AuriFloss keys are not read, and say so**: the brand column or the header over the
  number column is matched to letter templates; another brand blanks every row with the reason
  (`read.why`), `brandSeen` and a warning. Asserted for an "Anchor" brand word, an "AuriFloss" brand
  word and an "ANCHOR" column header; a "DMC" header still reads as DMC. Documented in the API file.
- Ledger unchanged otherwise (zero wrong codes everywhere); synthetic now 149 exact, 10 partial,
  3 blank, 0 wrong of 162.
