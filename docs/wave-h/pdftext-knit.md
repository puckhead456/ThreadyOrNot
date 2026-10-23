# Wave H: `pdftext-knit` — the PDF extractor on the knitting fixtures

Owner of `js/pdftext.js`, `test/pdftext.test.html`, `test/pdftext.dump.html` and this report. No other
file was edited. Nothing was committed, downloaded or copied out of `tmp-pdf/`.

## What the user gets

A knitting book or magazine PDF now imports in reading order:

- Three-column pages with different column grids stacked on one page are read block by block, and
  each block is read with its own columns. The rounds no longer come out mixed with the
  neighbouring column line by line.
- Text that the PDF carries but nobody can see is no longer read. This covers a page placed twice,
  text clipped out of a frame, and text painted over by a later box or photo. A sock page no
  longer reads every line twice, and the glossary hidden under a pattern page no longer appears
  inside the Leg paragraph.
- An advert at the head of a column no longer splits the instruction row that runs on across the
  column break. It is read after the page's text.
- Small-caps headings are whole words ("Notes", "Leg"), two-page spreads are read one page after
  the other, and a chart's top row label in the margin is no longer dropped as a page number.

## Fault table

Legend: ✔ fixed; ◐ partly fixed; ✘ not fixed. Unless noted otherwise, the assertions are in the
group "Knitting fixtures (wave H)" of `test/pdftext.test.html`.

| # | Fixture / page | Before | After | | Assertion |
|---|---|---|---|---|---|
| 1 | knit-interweave-8-socks p15 (Flying Trapeze) | The full-width Notes bridged the Leg / heel gutter, so no gutter was found. The two columns were zipped line by line ("join in the rnd. Work Rnds 1–44 of chart Rows 2 and 4: (WS) …"). Headings came out as "N otes", "L eg" | Notes, then Leg column, then heel column; "Notes", "Leg" | ✔ | `p15 the Leg column reads down its own column`, `…heel column`, `p15 the "Notes" and "Leg" headings are whole words`, `p15 no line mixes the two columns` |
| 2 | socks p20 (On-Your-Toes) | Columns 2 and 3 zipped. The Sssp / Eastern Cast-On sidebars underneath were interleaved with them | 3 columns, then Sssp, then Eastern Cast-On | ✔ | `p20 the third column follows the second`, `p20 the Sssp sidebar …`, `p20 columns first, then the two sidebars` |
| 3 | knit-interweave-lace p31 (gloves) | The 3-column spinning table was laid over the 2-column rounds. Result: "around (7 times)." three times in a row, and the table's third column was read between the two columns of rounds | Table (3 cols), then rounds left, then rounds right | ✔ | `p31 the continuation lines stay with their rounds`, `p31 the spinning table … before the rounds`, `p31 the cuff shaping reads in order` |
| 4 | socks p4 (Time Traveler) | Every line twice: the same page is placed twice, 24 pt apart. "cretime", "traveler in many vintage patterns" | Once; "time" / "traveler" apart from the intro; "create" | ✔ | `p4 a page placed twice comes out once`, `p4 the title column …` |
| 5 | socks p6 | Hidden glossary (SSSK, Turkish cast-on, Whipstitch) clipped out of its frame, read inside the Leg paragraph. Chart labels were mixed in as well | Gone. The Leg paragraph is whole | ✔ | `p6 the glossary clipped out of view is not read`, `p6 the Leg paragraph is whole again` |
| 6 | socks p9 | p6's pattern text painted over by the glossary box, plus chart labels | Glossary only | ✔ | `p9 the pattern text covered by the glossary box is not read` |
| 7 | socks p8 | Hidden 5 pt figure numbers glued into lines: "back,1 (Figure 1)", "…back of the4", "wrap:6" | Gone; two stray "2" / "3" lines remain (not detected as hidden) | ◐ | `p8 hidden figure numbers stay out of the lines` |
| 8 | socks p5 (Time Traveler heel flap) | The "K NITS / Interweave Knits IS A MUST HAVE …" advert sat at the head of column 3, so it was read inside Heel Flap Row 1 | The row runs on; the advert is read after "removing 2 heel m." | ✔ | `p5 the heel-flap row runs on across the column break`, `p5 the advert is read after the page text` |
| 9 | socks p29 | Labels of a chart on another page, hidden on this one ("Key", "MC", "64 sts", 31, 29 …) | Gone | ✔ | (covered by the suite) |
| 10 | knit-sandnes-0216 | Needle "5½" read as "5" | Unchanged. The ½ is **not text**: the operator list has one glyph "5", followed by three small vector fills (1, ⁄, 2) at x 105–114. There is no ½ item and no private-use char, so it cannot be read without OCR | ✘ | — |
| 11 | sandnes p17 | Age range "1-12" read as control codes | Unchanged (glyphs with no ToUnicode entry) | ✘ | — |
| 12 | sandnes (every two-model spread) | The two info boxes were zipped ("Booklet Booklet / 5 3 / 0216EN 0216EN") | Left page, then right page | ✔ | `p3 the two info boxes of a spread are not zipped together`, `p3 left page, then right page` |
| 13 | socks p30 (Albus Argyle) | The chart's top label "45" sat in the top 8 % and was dropped as a page number | Kept | ✔ | `p30 the Albus Argyle chart's top row label "45" …` |
| 14 | crochet-stylecraft-guide p5 | The charts key is placed once per cell and clipped, so it was read 7 times | Once | ✔ | `p5 the charts key … is read once` |
| 15 | crochet-stylecraft-guide (all spreads) | Two magazine pages zipped (wave E residual "spreads") | Left page, then right page | ✔ | (spread rule; unit `a two-page spread is read …`) |
| 16 | sew-freespirit-harmony-quilt p1, p5–6 | "Finished Finished Block Sizes:" (wave E #7 ◐). Cutting-diagram placed pages repeated "Fabric J … Cut 4 each" and the disclaimer | Once each | ✔ | `"Finished Finished Block Sizes:" … no longer doubled` |
| 17 | other-weaving-handwoven p2, p7 | Draft figure placed 4× (each copy clipped), so the numbers were read 4 times ("4 44 4 4 44 4"). On p7 the columns were mixed | One copy; p7 reads in columns | ◐ | — (the draft grid is still a figure, read as numbers) |
| 18 | crochet-apl-priscilla-filet2, crochet-archive-weldons-v24, -orr-filet4 (OCR) | Two OCR columns with a narrow, drifting gutter zipped line by line (wave E residual) | Column by column on most pages | ◐ | `an OCR page with a narrow drifting gutter is read column by column` (heavy) |
| 19 | crochet-bernat-lace-cardigan p3 (FINISHING beside a diagram) | Columns mixed (wave E residual) | In order; a few diagram numbers ("3", "1") still glued to line ends | ◐ | see "For the coordinator" |
| 20 | cardigan p22, crochet-premier-simple-throw, crochet-patons-mesh-cardigan | Adverts read out of order; title read after the materials; "Crochet Mesh Cardigan" running head left mid-page | Top to bottom; head dropped | ✔ | `p22 the three adverts are read top to bottom` |
| 21 | caron, bernat lace cardigan, bernat top-down: two-column abbreviation boxes | Read inconsistently: column by column on caron, row by row ("Alt = Alternate P = Purl") on the top-down | Row by row everywhere, which is what the glossary readers parse ("two to a line"). A column-wise reading of the top-down box cost the knits glossary "St(s)" and "WS", because Ssk's 4-line definition broke its 3-miss limit | ✔ | knits `Bernat glossary: … two to a line`; unit `a short two-column table in a band is still read row by row` |

## Rules added (all geometric or typographic, none per file)

- **Hidden text** (`textVisibility`, `dropHiddenItems`, `visibleItems`). The page's operator list
  is replayed with a small graphics-state machine: CTM, clip box, form XObjects, groups,
  ExtGState alpha / blend / soft mask, and text state (matrix, leading, spacing, rise). Each text
  run gets a page-space box. A run is **hidden** in two cases:
  - Less than 25 % of its box lies inside the clip in force.
  - Something painted later covers ≥ 90 % of it. That can be a *box* fill (one rectangle, or a
    short path whose points all lie on its bounding box), opaque, normal blend, outside any
    transparency group. It can also be an image whose own pixels are opaque there: alpha is
    sampled at five points from pdf.js's decoded image.

  Render mode 3 is **not** hidden, because it is how every OCR layer lies over its scan. OCR text
  is never "covered" by an image. A text item is dropped only when every run it starts on (same
  baseline segment, same first glyphs) is hidden. A visible line that starts where a hidden one
  does keeps its text.
- **When the operator list is read.** It costs the worker an image decode, so it is read only for
  suspect pages:
  - A page where ≥ 3 long runs (10+ chars) are each printed exactly twice at the same x and the same
    vertical offset (a page placed twice).
  - A page where ≥ 3 runs lie on other runs of their own baseline. This check is skipped on OCR
    layers, which give one word per run.
  - Pages that share ≥ 3 long runs (20+ chars) with exactly one other page. These are re-read
    after the first pass.

  Whole corpus: 37 s → 40 s.
- **Columns per band** (`columnize` → `columnizeAt`, `horizontalBands`, `bandsDisagree`,
  `bandSpan`). A region is cut into bands at every full-width blank taller than 2.2 body lines.
  Bands are read top to bottom, each with its own columns and measured on its own ink, but only
  when they disagree with the region. That happens when:
  - the region has no gutter and a band has one, or
  - rows in the middle of a band bridge the region's gutter, either for ≥ 30 % of the band, or
    for ≥ 2 rows when the band's own gutter is somewhere else.

  Rows at a band's top or bottom edge are a full-width note or header (fullWidthBands reads them
  in place). Bands that agree keep the region's gutter, so a two-column page still flows across a
  blank both columns share. Inside a band:
  - A clean gutter may sit off the middle third.
  - A clean gutter needs only two lines a side.
  - A two-column table of short cells or labels is read row by row. This covers the bee US / UK
    terms and the "Alt = Alternate | P = Purl" abbreviation boxes, which the glossary readers take
    two to a line.
  - A band of table rows (3+ short cells, or mostly figures) is read as its own region would be.

  Symbol-chart grids never band.
- **Spreads** (`spreadHalves`). On a sheet ≥ 1.35 times as wide as it is high (two portrait pages
  side by side; letter landscape is 1.29), where nothing crosses the centre line, the left page is
  read first and then the right page.
- **Adverts at a column head** (`moveInterruptions`). A block of ≤ 6 lines at the start of a
  column is moved after the page's text when all of the following hold:
  - none of its glyphs is near body size;
  - its small print holds ≥ 3 words;
  - the line before it, the last of the previous column, does not end a sentence;
  - the line after it starts in lower case.
- **Initials** (`isInitialSpace`). A zero-width space run between a lone capital and a run that
  touches it is not a word break. This applies when the capital is set at a different size, but
  no more than 1.6× (small caps: "N|otes"). A two-line drop cap is left alone.
- **Chart labels in the margin** (`inNumberRun`). A bare number in the margin band is kept when the
  next number in its column, a line or so away, is within 2 of it.
- **Dump page**: `&hidden=1` (with `&raw=1`) lists the hidden runs per page and the reason for each.
  New test hooks: `_textVisibility`, `_imageAlphaOf`, `_dropHiddenItems`, `_overlaySuspect`,
  `_crossPageSuspects`, `_horizontalBands`, `_columnizeAt`, `_bridgesGutter`, `_cellCount`,
  `_isTableBand`.

The "OCR item-start gutter signal" was not needed. Per-band detection already separates the OCR
two-column pages (#18), so the signal was not added.

## How it was checked

- **Browser.** The browser pane's tab cap was full for the whole session, so `tabs_create` failed.
  Every check ran in a private headless Chrome driven over CDP on 127.0.0.1:9333 (scratchpad
  only), against the same dev server at localhost:8766.
- **Page images.** Rendered with pdf.js on that page, then looked at. This covered socks p4, p6,
  p8, p9, p28, p29; lace; weaving p2; stylecraft-guide p5; redheart p1; bernat-basketweave p1;
  cardigan p22; sandnes p3; freespirit p6. `pdftotext -layout` served as a second reading.
- **Whole-corpus diff.** All 100 fixtures, heavy files included, were extracted before the first
  change and after every change. Every changed file was read against its page image. Rules that
  moved text the wrong way were narrowed or dropped:
  - the bee terms table;
  - the bronte size chart;
  - the bernat top-down size table;
  - the halloween key;
  - pokemon chart grids;
  - drop caps;
  - headings mistaken for adverts.
- **Final diff against the wave-E output.** Only these 29 files changed, each one checked:
  cardigan, orr-filet4, priscilla-filet2, weldons-v24, bernat-basketweave, bernat-lace-cardigan,
  caron, kingcole festival uk/us, kingcole pumpkins, patons, premier, stylecraft
  guide/hex-socks/hood, socks, lace, sandnes, macrame, stitchedstories guide, weaving,
  freespirit, peppermint apron-A0, sundress, swoon mabel, dmc pointdemarque/puntomarca,
  nichols, tinymodernist welcome. The xstitch keys (pokemon, halloween, dmc-2168), bear, bee,
  bronte and all other sewing files are byte-identical.

## Suites (fresh headless tabs, session cache cleared)

- pdftext: **137 passed, 0 failed** (+2 skipped without `?heavy=1`). With `?heavy=1`: **140 passed,
  0 failed**.
  - The two "renderPage cancels … promptly" timing checks reach about 1.9–2.0 s (limit 1.5 s) only
    while five suites load the machine at once. Run alone, they pass.
- patterns.fixtures: **828 passed, 1 failed**. With `?heavy=1`: **843 passed, 1 failed**. See the
  bernat-lace note below.
- xstitch.fixtures: **493 passed** (+9 skipped).
- sewing.fixtures: **789 passed**.
- knits.fixtures `?heavy=1`: **229 passed, 0 failed, 7 known**. The page has grown since the
  brief's 168 / 23. No KNOWN line turned green. The extractor-blamed ones (T15 advert, F2 p15)
  now have the right text, so what remains there is in the parser (next section).
  - A column-wise reading of the Bernat abbreviation box briefly failed `Bernat glossary … two
    to a line`. The rule was changed, not the test: such boxes stay row by row (#21).

## For the coordinator

- **patterns.fixtures `bernat-lace: Body 9 rows and Sleeves 5 rows` now gets `Sleeves/2/7`.** The
  extraction is now right: crochet-bernat-lace-cardigan p3 (FINISHING beside the stitch diagram) is
  read column by column, checked against the page image. The fixture's own verdict says this page
  "arrives with its columns interleaved, so the edgings after the sleeves are not pinned". With
  the text readable, the parser attaches the FINISHING page's "Outer edging … Next rnd" and the
  sleeve-edging rounds to the Sleeves part, because a bare `FINISHING` line does not end the part.
  - I did not undo the column fix to keep the old count, and I did not edit the test.
  - Decide between two options: patterns.js ends a part at a FINISHING heading (owner of
    `js/patterns.js`), or the expectation moves.
- knits.fixtures: the KNOWN lines blamed on the extractor now have correct text but stay KNOWN
  for parser reasons. Their reason strings should be reworded by the owner of
  `test/knits.fixtures.html`:
  - T15: socks p5 now reads "… insert right needle into wrap" / "then kwise into wrapped st …
    turn—1 heel st dec'd." as one run-on row with no advert inside, yet `delta` is still null.
  - F2: p15 now reads "join in the rnd. Work Rnds 1–44 of chart" / "once." in its own column,
    yet `chart` is still null.
  - O-, GL- and T20 lines on p20 and lace p31 are also in order now.

## Still wrong (and why)

- Sandnes ½ (vector glyphs) and the p17 age range (unmapped glyphs) are not in the text layer.
- xs-dmc-2173's hidden "use 2 strand backstitch" stays. That page shows none of the overlay
  symptoms, so its operator list is not read. Reading every page's operator list would find it,
  at about 4× the import time.
- Text set in a transparency group, or under a soft-masked image, is never judged covered: the
  pixels behind it are not known.
- crochet-stylecraft-hex-socks p2's yarn table ("Head over Heels | 100g 1 1 1 1 2") is read
  label column then value column, for the same reason as the hood box below.
- Two stray figure numbers on socks p8; diagram numbers glued to line ends on bernat-lace p3 and
  stitchedstories; the draft grids of the weaving booklet. These are labels inside drawings that
  are drawn visibly. They need a figure model, not a visibility rule.
- crochet-stylecraft-hood p2: the two-row yarn box ("Special Chunky | 100g balls 2 balls each" /
  "Colour used | A White 1001 …") is now read label column then value column. The rows sit in a
  band with prose, so the paired-table guard does not see them as a table. The patterns suite
  passes.
- The wave E residuals not touched here (letter-spaced runs without word gaps, kerning splits,
  rotated label blocks, captions sharing a baseline) are unchanged.

## For the owner of js/patterns.js

- See the bernat-lace FINISHING note above.
- `PdfText.extract` text may now carry an advert block at the END of a page (moved out of the
  row it split), for example "K NITS / Interweave Knits IS A MUST HAVE / … / interweaveknits.com".
  It is still visible text; the knitting reader should not make it a part. T15 already asserts
  this.
