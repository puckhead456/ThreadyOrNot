# Wave E: cross-stitch ground-truth audit (`xstitch-audit`)

This audit covers every cross-stitch fixture in `tmp-pdf/`: the 34 `xs-*.pdf` files and `xs-ursa-piggies.oxs`.
Five fixtures named in SOURCES.md are not on disk and are skipped: `xs-flosscross.pdf/.oxs`, `xs-artecy`, `xs-dmc`, `xs-lovecrafts` and `xs-scan`.

For each fixture, the truth was read off the rendered PDF pages. Then `XStitch.parseKey` / `extractGrid` / `parseOXS` output was compared with it, and the in-app import was checked at 375×812.

**Tooling note.** `pdftoppm` is not installed, so the Read tool cannot render PDF pages with `pages`. Pages were rendered with the Windows PDF API from PowerShell (`Windows.Data.Pdf`, a scratchpad script) and read as PNGs. `pdftotext` (mingw64) was used to cross-check the text layer.

## Suites (all green at the end)

| suite | before | after |
|---|---|---|
| test/xstitch.test.html | 675 | **700** (+25 wave-E assertions) |
| test/xstitch.fixtures.html | 436 (+9 skipped) | **475** (+9 skipped) |
| test/crafts.test.html | 124 | 124 |
| test/xstitch-photo.test.html | 131 | 131 |

**Extraction changed mid-audit.** `js/pdftext.js` changed during the audit (the extractor agent's uncommitted "table row across the gutter" work).
- The fixture page caches the extraction per browser session.
- Against the **new** extraction, the parser went from 473 to 440 passed / 33 failed.
- The parser now handles both the old and the new extraction; see "For the owner of js/pdftext.js".
- The final 475/0 run uses the new extraction.

## Discrepancy table

"Fixed" means parser or app code changed, plus an assertion. Fixture assertion names are prefixed with the fixture name in the run. `[unit]` marks an assertion in xstitch.test.html under "parseKey: wave E ground-truth fixes".

| # | fixture | part | PDF says (truth) | app said | fixed? | assertion |
|---|---|---|---|---|---|---|
| 1 | xs-pokemon-bl | key p62 | DMC **340** (1273 ct). The "62 / 62" footer is printed over the row. | code **34062** (text `34062 / 62 (1273 ct)`) | yes: stripFooterGlue handles the footer *after* the code; `unglueFooters` handles it mid-row | `every code, in key order, as printed (107 rows)`; [unit] `footer glued after the code` |
| 2 | all 4 xs-pokemon-* | key | 105 / 98 / 107 / 101 rows, codes and "(N ct)" as transcribed (sums = W×H exactly) | matched, apart from #1 | truth now asserted row by row | `every code, in key order, as printed`, `every "(N ct)" as printed` |
| 3 | all 4 xs-pokemon-* | finished size | Prints 181.42 cm for 500 st at "14 ct./inch" on **aida**, which is 2× the real 90.7 cm (KG-Chart sizes for over-two). | notes stored "14 ct: 71.43 × 71.43 in" | yes: the size is corrected to design/count, with a warning ("…it is really 35.7 x 35.7 in") | `the printed size is corrected…`, `and the stitcher is told…`, `aida is not turned into "over two"`; [unit] `on aida the doubled printed size is corrected` |
| 4 | xs-pacman, xs-portal, xs-typechar | fabric | Linen, "16 ct./inch", and the printed cm size is 2× design/16, i.e. over two | fabric.over null, so the app's own finished size (14 in) contradicted the sheet (28 in) | yes: on linen/evenweave a doubled printed size sets `fabric.over = 2` | `the doubled printed size on linen reads as "over two"`, `so the app computes the same 28 in`, kgChart `linen, and the doubled printed size…`, `the "(N ct)" counts add up to every cell` |
| 5 | xs-tinymodernist-welcome | key | 6 rows: DMC 725 3609 3801 958 906 905 (Cosmo 701 482 838 844 326 327) | 7 rows. **Cosmo 844 imported as DMC 844** (PdfText wraps `57h x 80w 958` / `844`). | yes: an equivalents number wrapped onto its own line is owed to the row above | `exactly the six DMC rows`, `Cosmo 844 … is not DMC 844`; [unit] `a wrapped equivalents number…` |
| 6 | Tiny Modernist ×5 | sizes | "14-ct 2.5” x 3.5”", "16-ct 2" x 3"" (in the stitch count's own h/w order) | `sizes: []` (the hyphen in `14-ct` and the curly ” were not accepted) | yes: CT/IN patterns widened, and rows turned to w×h against the design size | `sizes` assertions on halloween, welcome, homestitchhome, matryoshka, foxy; [unit] `"14-ct 2.5” x 3.5”" is read and turned` |
| 7 | xs-tinymodernist-foxy | key | 9 cross colours: Blanc, **19**, 3854, 3853, 352, **666**, 3347, 3345, 3799. B/S table: Blanc, 19, 3799. | 7 rows. `O 666` was dropped as a "glyph run". `19` (a DMC 2017 shade) was rejected. | yes: a known DMC 333/444/666/777 on a short line is a code; soup is cut *after* a leading real code; DMC 1–35 is accepted only inside a DMC column, sandwiched between DMC rows | `every row is one the sheet prints, under the right technique`, `at least seven of the nine`, `DMC 666 … is a colour`, `the Anchor column … do not become DMC 1-35`; [unit] `"O 666" is DMC 666…`, `"(2 strands)" … is not DMC 2`, `chart soup is cut after a real 666` |
| 8 | xs-tinymodernist-foxy | key (new PdfText) | as #7 | 19 and the 3799 cross row are lost: the sidebar now arrives interleaved with chart rows | **no**: extraction, see pdftext notes (logged as KNOWN GAP) | — |
| 9 | xs-wocs-caterpillars | fabric | "14 HPI (28-count evenweave)" and "6x10cm (2¼x4in)", i.e. over two | over null, so the app computed a 2 in wide design | yes: "N HPI" at half the count sets over 2 | `"14 HPI" on 28-count evenweave is stitched over two`; [unit] |
| 10 | xs-wocs-caterpillars | strands | "French knots in one strand" | not read (knot rows imported with the 2-strand default) | yes: `key.knotStrands`; applyPdf uses it for knot rows | `"French knots in one strand"`, `that line does not override the cross-stitch strands`; [unit] |
| 11 | any key with backstitch | app import | the backstitch strand count as printed | `applyPdf` gave back rows the cross-stitch default and hard-coded bsStrands 1 | yes (app-xstitch.js): back/knot rows use key.bsStrands / key.knotStrands | parser side via #10 and #12 (no app-level harness) |
| 12 | xs-dmc-2173 | key p3 | cross **503, 3833, 3832, E677** (2 strands); backstitch **3808, 501, 3831, 3832** in **1 strand**. The page also carries a hidden text layer ("use 2 strand backstitch"). | only 4 rows, all backstitch; **bsStrands 2**. The old fixture asserted exactly that ("exactly the four colours", "bs 2"): it was wrong. | yes (with the current PdfText): two legends under one heading row take their kinds in heading order, each "* 1 skein" footnote moves to the next; E-codes are accepted in bare DMC-library rows; the strand number *after* "backstitch" on a shared line is the backstitch one | `the four backstitch colours, as backstitch`, `any cross row read is one of 503, 3833, 3832, E677`, `every row is one the key prints`; [unit] `headings side by side…`, `"Use 1 strand" after "backstitch"…` |
| 13 | xs-tinymodernist-halloween | key (new PdfText) | 453 Shell Grey LT, 132 stitches, 28.8 in | name `Shell Grey LT 132 28.8 in.`, count null | yes: a trailing floss length is cut off, and the number before it is the count | halloween `with their DMC names` / `Stitches column` stay green; [unit] `a trailing floss length is not part of the name` |
| 14 | 4 × xs-pokemon (new PdfText) | key | three newspaper columns, read top to bottom | rows arrive one visual row across (`310 (21207 ct) 3810 (1188 ct) 3837 (827 ct)`); only 37–40 of ~100 rows kept, and the grid reader then failed | yes: `expandCountColumns` splits the cells and re-emits them column by column (headings kept, short rows aligned) | pokemon truth assertions; [unit] `a key read across its columns is put back in column order` |
| 15 | floss table | DMC 158 | "Cornflower Blue Medium Very Dark" | "Cornflower **Blu** …" in the floss list | yes | [unit] `DMC 158 is spelled "Blue"` |
| 16 | xs-wocs, foxy, pokemon | symbols | Rendered glyphs (wocs: ∩ ■ I b N – ☀ Z ◊ v A × ▼ $ ◐) | The text layer carries the symbol **font's** codes (Z W 2 h 7 z y x [ L b v P 9 S). For KG the glyphs are vector paths. | by design: `applyPdf` always runs `assignSymbols`, so the app shows its own consistent set. The mismatch with paper is recorded, not fixed (see "Still wrong") | — |
| 17 | xs-metalgreymon | key order | the master key on p10 is in numeric order | order merged from the per-page legends (B5200, 310, 762…) | no (cosmetic): all 15 codes, names and counts match | existing assertions |
| 18 | xs-metalgreymon / xs-dmc-2168 / xs-dmc-2173 | design size | not printed in stitches. Measured: 133×128, 83×116, ~102×88 inside a 110×96 grid. | design null | correct as is; "design size not stated" warning | existing |
| 19 | halloween (310), welcome (958), homestitchhome (3855), foxy (Blanc/19/3799) | backstitch | the BS column is a drawn line or swatch (graphic only) | not marked as backstitch | no: not in the text layer | — |
| 20 | xs-tinymodernist-matryoshka | key | 8 colours: White, 945, 892, 666, 907, 3849, 300, 310 (Anchor 2 881 33 46 255 1070 352 403) | 0 rows | no: the key is part of the artwork image (OCR case) | existing `no key rows invented` |
| 21 | xs-dmc-2168 | sizes | "15 CM X 21 CM / 5.9 X 8.2"" on 14-ct aida | sizes [] (no count on that line) | no (minor) | — |
| 22 | xs-dmc-2234 | key | Eco Vita 002 and 105; surface embroidery (A straight, B buttonhole, C French knot, D stem, E satin) | 105 only; kind "embroidery", confidence 0 | fine as is (flagged as not a counted chart) | existing |

Everything else matched the ground truth exactly:
- pacman, portal and typechar: codes, counts, design, fabric; the counts add up to W×H.
- metalgreymon: 15 codes, names and counts.
- dmc-2168: all 34 codes in column order, x 1 skein each, 2 strands, 14 aida.
- wocs: 15 cross (DMC column), 3 backstitch and 1 knot row, names, 56×32, 28 evenweave, 2/1 strands.
- homestitchhome: 5 codes and 54×76.
- yarntree: no key anywhere, and none is invented.
- Ursa OXS: 69×73, 14 count, 7 colours, and 1000 full stitches (322: 160, 3708: 145, 3773: 108, 367: 587). There are 55 part stitches: 3708 ×11, 3773 ×11 and 367 ×33, all half stitches (direction 1 and 2). There are 1105 backstitches (943: 42, 310: 1063), 10 knots (310) and 8 beads (326, bead3mm). Per-colour counts are [0, 160, 0, 151, 114, 0, 604], counting half stitches as ½.

## Ground truth recorded

### KG-Chart (pacman, portal, typechar, pokemon ×4)
- **Layout.** The key is on the last page, the cover on p1, and every other page is chart.
  - pacman: 5×4 pages, 53-column × 77-row tiles.
  - portal: 4×3 pages, including a one-column edge page.
  - typechar: 3×2 pages.
  - pokemon-tl: 10×7 pages; tr and br: 6×6 at 51×84; bl: 10×6 at 51×84.
  - No page overlaps its neighbours.
- **Cells and symbols.** Every cell has a symbol drawn on a coloured square.
  - Symbols are handed out by key position, not by colour: `+ E □ – × ✳ | # …`, then lowercase letters after #91.
  - Only #85–91 (♪ ♫ ♭ ♮ ※ ★ ☆) and the letters survive in the text layer.
  - The pacman and pokemon readings disagree at position 9 (V vs •). Confirm before relying on the sequence.
- **Pacman** is greyscale throughout. 349 and 3843 have identical swatches.
- **Pokemon.**
  - tl and tr say KG-Chart LE; bl and br carry a "KG-Chart Pro … Unregistered" watermark.
  - 234 distinct codes across the four quadrants; 18 appear in all four.
  - The assembled design is 798×1000 (inferred; not printed).
- **In-app.**
  - pokemon-bl imports 107 colours, 500×500, 14 ct aida, with the size warning.
  - The grid beta reads 107/107 colours, 250,000 stitches in 7.7 s.
  - Floss list counts and skein ranges are shown. The chart renders at 375×812.

### Tiny Modernist / Satsuma
- **halloween**
  - Key: A 453, ⁘ 3854, Y 977, 8 3052, and □ 310 (also backstitch, red line).
  - Stitches and length are printed per row.
  - 35h×49w; 14-ct 2.5"×3.5", 16-ct 2"×3".
- **welcome**
  - Key (symbol, DMC, Cosmo): ↗ 725/701, ☾ 3609/482, < 3801/838, ◣ 958/844 (also backstitch), □ 906/326, ✖ 905/327.
  - 57h×80w.
- **homestitchhome**
  - Key (symbol, DMC, Anchor): ⌶ Ecru/387, r 3855/311 (also backstitch), ← 3854/313, 2 3347/266, ⊏ 3848/1074.
  - 54w×76h.
- **foxy**
  - Cross key (symbol, DMC, Anchor): ⌶ Blanc/"1 or 2", N 19/n/a, + 3854/313, ✓ 3853/1003, ★ 352/9, O 666/46, 2 3347/266, < 3345/268, ⊏ 3799/236.
  - Backstitch: Blanc, 19, 3799.
  - 68×68; 14-ct 5"×5", 16-ct 4.2"×4.2".
- **autumn** (image only)
  - Key: 725, 729, 922, 720, 869.
  - 41×77 stitches, about 3"×5.5" on 14-ct.
- **Satsuma** (all single JPEG pages, no text)
  - stay home: 70w×97h, 14-ct or 28 over two, 5"×7".
    - Cross stitch in 2 strands: 153 162 209 563 718 722 726 906 938 964 3608 3705 3844 3850.
    - Backstitch in 2 strands: 209, 718, 3844, 3850. In 1 strand: 938.
  - summer's flight: 44w×70h, 14 aida or 28 linen, 3"×5".
    - Key: 718 347 166 3687 741 898 967 3821 3865 3340 780 900 832.
- **In-app** (satsuma-sunshine): "This PDF is a scan, so there is no text to read. The chart pages are here…" and "Import the pages only".

### DMC library, magazine, alphabets
Full keys are in the discrepancy rows above.
- **dmc-2168**: 34 codes in three columns of 12/12/10; the symbols are not in the text layer.
- **wocs**: three brand columns (DMC, Anchor, Madeira) plus names. Six designs, each fitting on its page. The text layer has no chart text.
- **yarntree**: raster alphabets only; no thread numbers anywhere.

### Antique Pattern Library
- **No colour key (0 rows is correct):** dg003, pointdemarque, puntomarca, hkb383, nichols, priscilla-cross1, priscilla-cross2.
  - The Priscillas print sizes in meshes:
    - Book 1: basket 53 wide, alphabet 10 high, centrepiece a 130-mesh circle / 150 with margin.
    - Book 2: wreath 45, basket 39, borders 21 / 13 / 15.
- **Real keys, but no text layer (OCR-only):**
  - tapestry-painted p5: grid 259W×195H, 18.50"×13.93". Eight rows: DMC 816, 796, 597, 909, 913, 938, 783, White.
  - orr-book14: four symbol keys in J.&P. Coats numbers on pp16, 19, 20 and 22. Example p19: ^ Crimson 120, ▲ Lt Red 6, ◘ Steel Blue 108, \ Yellow 9, blank White 1, ■ Black 12, ● Dk Moss Green 60, X Purple 32.
  - dmc-motifs: a "Nuances : colour DMC no." shade list on every even page from 8 to 70 (names to numbers, no symbols).
- **Encryption.** Six files are AES-256 encrypted with an empty user password: pointdemarque, puntomarca, hkb383, nichols and both Priscillas.
  - pdf.js opens them. In-app, xs-apl-nichols read 15 pages and 32,260 characters and said "I couldn't find a colour key in this PDF…".
  - The fixture run extracts text from all six.

## Rules added (js/xstitch.js)
1. **Footer glued after a code.** `stripFooterGlue` handles `34062 / 62` → 340 when the remaining code is a known DMC. `unglueFooters` handles the same footer in the middle of a row of cells.
2. **Wrapped equivalents numbers (`owedAlt`).** A cross-brand row that stops short of its brand columns owes the next line. If that line is only a code, it is skipped. `trailingCodeRow` gained `{ withRun }`.
3. **Short-line codes that look like glyph runs.** On a line of three tokens or fewer, a known DMC 333/444/666/777 is a code, not a glyph run. `stripChartSoup` never cuts in front of such a code in the first two places.
4. **DMC 2017 shades 1–35.** Accepted only under a header naming DMC as a column, with a DMC row above and a DMC code below. Never when the code is in brackets or followed by a unit. They have no swatch: warning "no colour data for DMC 19", grey swatch.
5. **Printed sizes.**
   - `14-ct`, `14-count` and curly or prime inch marks are accepted.
   - Rows are turned to w×h against the design size.
   - A size exactly 2× design/count means over two:
     - on linen or evenweave: `fabric.over = 2`;
     - on aida: the size is corrected to design/count and a warning is given.
6. **Over two from HPI.** `N HPI` / `holes per inch` at half the count → `fabric.over = 2`.
7. **Strand counts.**
   - `knotStrands` is a new parseKey field, read from "French knots in N strand(s)".
   - On a line holding two headings, the strand number after "backstitch" is the backstitch one.
8. **Newspaper-column keys.** `expandCountColumns` puts a multi-column `code (N ct)` key read across back into column order.
9. **Trailing length column.** A trailing "N 28.8 in." is a stitch count plus floss length, not part of the name.
10. **Side-by-side legends.** A heading line naming two techniques sets the first kind now and queues the second. Each "* N skein in each colour" footnote advances the queue.
11. **E-codes.** Light Effects E-codes pass the DMC-library bare-row check.
12. **Floss table.** DMC 158 name typo fixed.

## Also done (coordinator requests)
- **`freeUpSpace`.** It is kept on `App.registerCraft` (app-xstitch.js), wired to `switchToCountsMode`. I did not click it on the live quota banner: that needs a failing save (`Store.saveFailed()`), and forcing one would break the shared pane storage other agents are using. Path by code reading: the downgrade writes, then `syncStorageBanner` hides the banner once a save succeeds.
- **Photo crop, keyboard.**
  - The frame and all four corner handles are focusable (`tabindex=0`, labelled).
  - Arrow keys nudge by 1% of the photo, 5% with Shift. A corner resizes, respecting the aspect lock; the frame moves.
  - `:focus-visible` rings are in css/xstitch.css.
  - Verified: 5× ← on the br corner took a 400×300 photo to 380 wide, Shift+↑ to 285 high, and → moved the frame. Tab showed the ring.
- **Photo crop, alignment (bug found while testing).**
  - The crop frame was positioned in percent of a box wider than the photo (`object-fit: contain` letterboxed tall photos), so on a portrait photo the frame did not sit on the picture.
  - The `.xs-crop` box now shrink-wraps the image.
  - Verified: a 900×1600 photo's frame now matches the image rect exactly.

## Still wrong, and why
- **Printed symbols are not reproduced in the app.**
  - Symbol fonts extract as their character codes, not their glyphs (wocs, foxy), and KG draws glyphs as paths.
  - `applyPdf` replaces them with the app's own set, so the app key and the paper chart use different symbols.
  - For KG-Chart the symbol is a fixed function of key position. A mapping table could make the app match the paper; the #9 disagreement (V vs •) needs a look first.
- **Backstitch marks drawn as graphics** (Tiny Modernist BS column, the Satsuma backstitch legend lines) cannot be read from text.
- **Foxy with the current PdfText:** 19 and the 3799 cross row are lost to chart soup interleaving.
- **DMC 2017 shades 1–35** have no swatch or name in the floss table (no trusted source for their RGB).
- **Image-only keys** (matryoshka, autumn, Satsuma, three APL books) need OCR.
- **Small cosmetic issues:**
  - metalgreymon key order.
  - dmc-2168 printed size line not read.
  - The import preview for an image-only PDF shows "2 strands", which is the default, not read from the file. It also calls a flattened JPEG export "a scan".

## For the owner of js/pdftext.js
1. **Keys in newspaper columns read across (regression).**
   - Fixtures: xs-pokemon-tl p72, tr p38, bl p62, br p38.
   - The new gutter/table-row rule reads the three independent key columns as one table row, e.g. `Cross Stitch 798 (2003 ct) 926 (2868 ct)` / `310 (21207 ct) 3810 (1188 ct) 3837 (827 ct)`.
   - The earlier extraction gave one column after another, which is the reading order.
   - The parser now repairs this (`expandCountColumns`), but a heading glued in front of the first row ("Cross Stitch 798 …") is only guessed to belong to column 1.
   - A run of short `code (N ct)` cells, where each side of the gutter is its own list, should not count as a table row.
2. **Sidebar interleaved with the chart (regression).**
   - Fixture: xs-tinymodernist-foxy p1.
   - The sidebar key now arrives interleaved with chart-glyph rows: `19 n/a p 2222222 8 222222 OOO 2222 OO8888888888888OO p`, `O 666 46 p 22222 8 …`, ` 3854 313 16-ct 4.2" x 4.2" p 222222222 …`.
   - Before, the sidebar was its own column.
   - The chart rows here are real text glyphs, dense and grid-aligned. They should never be merged with the sidebar band.
3. **Row wrapped across lines.**
   - Fixture: xs-tinymodernist-welcome p1.
   - The row "958 844" is split as `57h x 80w 958` + `844` (pdftotext -layout keeps `958 844` together).
   - The parser now handles it.
4. **Hidden text layer and a dropped line.**
   - Fixture: xs-dmc-2173 p3.
   - The page carries a hidden duplicate text layer ("use 2 strand backstitch", "emplear 2 hebras", "dmc mouliné spécial art. 117® / light effect art. 317w").
   - The old extraction dropped the visible "Utilisez 1 brin / Use 1 strand / Utilizar 1 hebra" and put the cross codes (`3832`, `E677`) after the backstitch heading.
   - The current extraction keeps "Use 1 strand" (good). The hidden layer is still extracted; if it can be told apart (for example, text in render mode 3 / invisible, or clipped), dropping it would help.
5. **Page footer overprinting a key row.**
   - Fixtures: xs-pokemon-tr / bl / br, last page.
   - The footer ("38 / 38", "62 / 62") is glued into the row: `38 / 383756 (905 ct)`, `34062 / 62 (1273 ct)`, `38 / 38827 (971 ct)`.
   - The parser handles all three forms. Dropping page-number footers that overlap body text would remove the need.
6. **Symbol fonts extract as codes, not glyphs.**
   - Symbol-font characters come out as their font codes (wocs p1: `Z W 2 h 7 z y x [ L b v P 9 S` for glyphs ∩ ■ I b N – ☀ Z ◊ v A × ▼ $ ◐).
   - Marking text items whose font is a symbol or dingbat font (or has no usable ToUnicode) would let the parser say "symbols unreadable" instead of keeping wrong ones.

## For the owner of js/app.js
- **New project has no PDF drop zone for cross-stitch.** The drop zone is crochet-only (`app.js` ~3570), so "create a cross-stitch project from the PDF via New project" is not possible. The PDF import lives in the project's ⋯ menu → Import pattern.
  - Either the shell offers its drop zone to crafts that ask for it, or I add one to cross-stitch's `newProjectFields` (my file). This needs a decision on the flow: the import needs a project id to write chart pages to BlobStore.
- **Shared pane storage breaks in-app testing.** The pane's localStorage is shared, and other agents' test pages reset it while I tested: my test projects vanished twice mid-import, and the header showed another agent's project behind my import sheet. This isn't an app bug, but in-app checks in this wave are unreliable while suites like store-safety run in the same pane.

## Files changed
- js/xstitch.js
- js/app-xstitch.js
- css/xstitch.css
- test/xstitch.test.html
- test/xstitch.fixtures.html
- docs/wave-e/xstitch-audit.md
