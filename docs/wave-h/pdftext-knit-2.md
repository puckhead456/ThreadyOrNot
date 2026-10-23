# Wave H: `pdftext-knit-2` — the PDF extractor on the batch-2 knitting fixtures

Owner of `js/pdftext.js`, `test/pdftext.test.html`, `test/pdftext.dump.html` and this report. No
other file was edited. Nothing was committed, downloaded or copied out of `tmp-pdf/`.

## What the user gets

- A raglan whose shaping repeats the same row on several pages keeps every copy of it. The
  boyfriend pullover no longer loses its three printed `2nd row: P2. P2tog. Pat to last` /
  `4 sts. P2togtbl. P2.` rows.
- A column that runs on past a blank, beside a shorter column, is read to its end before the
  next column. The boxy pullover's neckband pick-up is read before the neckband ribbing.
- A heading font whose ToUnicode map turns capitals into small letters reads in capitals again,
  as printed. Examples: `MATERIALS` (was `MaTerIalS`), size `L` (was `l`), `C4B` (was `C4b`),
  `K = Knit` (was `k = Knit`), `UK TERMS`, `FINISHING` (was `FiNiSHiNG`), Sandnes' `YARN: DUO`.
  Only the case changes, never a letter. A font that really prints small letters at codes named
  as capitals (the stylecraft charts key, `adjustable ring`) is left alone.
- A landscape page may have five columns side by side. The cabled yoke's three-column
  abbreviation box no longer leaves its two columns of rows (Panel Pat A beside the size list)
  zipped together. The gauge sentence is whole again.
- A table at the head of a block keeps its heading, so the yoke's yarn table reads
  `Sizes XS/S M L XL 2/3XL 4/5XL` / `Aran (87602) 6 6 7 7 8 10 balls`. Before, it was cut down to
  `Sizes XS/S` / `Aran (87602) 6`.

## Fault table

Legend: ✔ fixed; ◐ partly fixed; ✘ not fixed; ⏸ fixed but held back.

| # | Fixture / page | Cause | Before | After | | Assertion (group "Knitting fixtures, batch 2") |
|---|---|---|---|---|---|---|
| 1 | knit-patons-boyfriend-cable p2 col 4, p3 col 3, p4 col 3 | **Furniture rule** `anywhereKeys`. The same text sat at the same height (±1 slot of 30) on 3 of 5 pages, which met the "most pages" threshold of 3. It was not the hidden-text rule, duplicate suppression or the caption filter | Three `2nd row` + run-on pairs dropped | Read in place | ✔ | `p2 col 4 …`, `p2: …with its run-on line`, `p3 col 3 …`, `p4 col 3 …`; unit `a row label and its run-on … are kept` |
| 2 | knit-patons-boxy-cable p4 | **Band cut.** Column 1 (sleeve, then FINISHING) has a blank that column 2 does not fill, because column 2 ended 3 lines higher. Bands were read top to bottom, so column 2 came out between the halves of column 1 | Sleeve, ribbing/sewing, FINISHING, pick-up | Sleeve, FINISHING, pick-up, then ribbing/sewing | ✔ | `p4: the sleeve column runs on into FINISHING …`, `p4: the neckband pick-up is read before …` |
| 3a | knit-patons-cabled-yoke (all pages) | Gotham-Bold's ToUnicode maps 11 capitals (A B D E K L O P R U V) to small letters. The `/Differences` names are right (`A`, `K`, `L`), and the widths are capital widths (A 790 against a 592) | `MaTerIalS`, `l`, `C4b`, `k = Knit`, `boTToM Yoke`, `Size XS-l` | Capitals restored | ✔ | `p1-p2: headings …`, `p1: the yarn table … size L reads "L"`, `p1: abbreviation keys …`, `p2: "M and L only"`, `p4: a page with no symptom …` |
| 3b | yoke p1 cols 3/4 | **Column budget.** `MAX_COLUMNS` 4 was spent by the left half's three-column abbreviation box, so the right half (two columns) never split | `SIZe 1st row: (RS). …` zipped line by line; gauge sentence with `T3B. P3.` glued in | Each column in turn | ✔ | `p1: the gauge sentence is whole…`, `…with nothing glued into it`, `p1: column 4 … reads down its own column` |
| 3c | yoke p2 cols 2/3 | **Gutter measure.** A 12 pt gutter (390.0 → 401.99) counted 9 one-point buckets after floor/ceil rounding, under `MIN_GAP_WIDTH` 10 | Cols 2/3 zipped (`Rep last rnd 2 ( 7-6-12-11-4) times sts evenly around last rnd. 174 ( 192-`) | In order | ✔ | `p2: column 2 is read before column 3 …` |
| 3d | yoke p1 yarn table | Its size cells straddle the abbreviation box's gutter. `tableEnds` did not count the `MATERIALS` heading as part of the table that opens the block, so the table was split and the right cells dropped as a caption | `Sizes XS/S` / `Aran (87602) 6` | All six sizes and counts | ✔ | `p1: …and every ball count` |
| 4 | crochet-stylecraft-guide p1–p8 (found in the diff) | Same font fault as 3a | `uk TerMS uS TerMS`, `HOlDIng THe HOOk`, `SlIpknOT`, `Dfdc` | Capitals | ✔ | `p5: "UK TERMS US TERMS"`, `p5: the charts key printed in lower case stays lower case` |
| 5 | knit-interweave-8-socks (whole book) | Same fault in Avenir small-caps fonts. Each page has its own font object for the same subset | `FiNiSHiNG`, `kNee SockS:`, `heel gusset:`, `kitchener stitch` | `FINISHING`, `KNEE SOCKS:`, `Heel gusset:`, `Kitchener Stitch` | ✔ | `small-caps headings read "FINISHING" throughout the book` |
| 6 | knit-sandnes-0216 headings | Same fault (Verlag) | `yarn: duo`, `2-12 years`, `advaNcEd` | `YARN: DUO`, `2-12 YEARS`, `ADVANCED` | ✔ | existing `p3 left page, then right page` (expected text corrected to the printed capitals) |
| 7 | crochet-stylecraft-guide p1 | Side effect of 4 found in the diff. Restored, `T O C R O C H E T` read as photo letters (furniture). That left the cover blurb under it at 6 lines, short enough for the caption filter | — | Kept (spaced display headings are not photo letters) | ✔ | `p1: the cover blurb under "T O C R O C H E T" is kept` |
| 8 | knit-sandnes-raglan-child p2, p3 | A centred title block. `children` / `ladies` and `INSTRUCTION: …` do not reach the gutter, so they are read after the whole first column | `Limited edition`, column 1, `children`, … | Fix written and verified | ⏸ | Held back: the knits parser names the size groups from the current order (21 knits rows went red). See "For the owner of js/knits.js" |
| 9 | yoke p1 "Finished bust" | `X-Large` (y 235.5) and `49" [124.5 cm]` (y 238.2) are 2.7 pt apart, over `Y_TOLERANCE` | `49" [124.5 cm]` / `X-Large` | Unchanged | ✘ | — |
| 10 | sandnes raglan `MEA SUREMENTS`, `R AGL AN` | Kerning split inside a tracked heading (wave E residual) | — | Unchanged | ✘ | — |
| 11 | mockneck, boyfriend p1 `SKILL LEVEL: INTERMEDIATE` | A badge inside the abbreviation column is read where it sits | Mid-list | Unchanged (harmless) | ✘ | — |
| 12 | chart pages (mockneck p4, boyfriend p5, yoke p3–p4) | Chart row numbers and stitch symbols | Number soup | Unchanged (a figure model is needed) | ✘ | — |

The mockneck pattern text (p1–p4) and the Sandnes raglan instructions were read against their page
images and are right, apart from rows 8–12 above.

## Rules added or changed (general, none per file)

- **Pattern rows are never "anywhere" furniture** (`dropRunningFurniture`).
  - A line opening with a row/round label (`ROW_LABEL_RE`: `2nd row`, `Row 2`, `Rnd 12`) is kept
    even when it repeats at one height on most pages.
  - So is its run-on: the next line, while the label line has not ended its sentence and the
    next line starts in lower case or with a count.
- **Run-on column across a band cut** (`runOnColumn`, in `columnize`'s band loop). The band
  above has to meet all of these:
  - one of its columns reaches the band's foot;
  - every column to its right stops at least 1.5 body lines higher.

  When it does, the leading rows of the next band that sit inside that column are appended to
  it, with these conditions:
  - there are at least 2 such rows, each within 0.5 body heights of the column's ink;
  - the rest of the band is clear of the column.

  A paragraph that only starts inside the column is left alone (stitchedstories).
- **Gutter measured as printed** (`findGaps`). A clear run 8–9 buckets wide counts as a gutter
  when the ink either side is more than 11 pt apart. The split position is unchanged. The edge
  test uses per-bucket edges, so it adds no cost. Rounding the buckets themselves was tried and
  rejected: it moved splits on 16 files.
- **Wider sheets get one more column.** The page's column budget is `max(MAX_COLUMNS, width / 150)`,
  so letter landscape (792 pt) allows 5. Portrait and spread halves are unchanged.
  - Tried and rejected: `MAX_COLUMNS = 5` everywhere, and separate budgets per side. Both moved
    pumpkins / pokemon / freespirit tables.
- **A heading over a table that opens a block belongs to it** (`tableEnds`). This applies to a
  one-cell line directly above a full-width prose line that leads into the table rows. It is
  narrow on purpose: allowing a one-cell line above table rows directly zipped the kingcole
  pumpkin column heads and the freespirit fabric table.
- **Case restoration** (`caseSuspect`, `restoreCase`, `drawnAsNamed`, `widthInfo`,
  `caseByWidth`, `visibleItems`).
  - **When a page is checked.** A page's operator list is read only when one of these holds:
    - a glued word steps from small letters to capitals at least twice (`MaTerIalS`). Words in
      an OCR glyphless font (monospace, ascent 1) do not count;
    - the page uses a font already caught and its text cannot settle the case.
  - **Which glyphs are restored.** A glyph is restored to the case of its name when all of these hold:
    - its `/Differences` (or built-in encoding) name is the same letter in the other case;
    - no glyph in that font names a different letter. OCR CID fonts name glyphs anything, so
      they never qualify;
    - the flipped glyphs' widths follow the named case better than the other case. This is
      judged by the spread of the log width ratios against Helvetica capitals or small letters,
      pooled over pages and over copies of the same subset font. With fewer than 3 glyphs to
      judge, the font's own real small letter is used instead (a capital is at least 8 % wider).
  - **How items are matched to glyphs.** Text items are matched to the glyph stream as unbroken
    runs, and ligatures expand to their letters. An item that does not match is left as it came.
  - **Pages after the first sighting.** On later pages a caught font is restored from the text
    when it can be:
    - a letter with only one glyph says itself;
    - a letter the font has both glyphs for is decided by the run's width (within 3 %, the
      other reading at least 6 % off).

    Otherwise the operator list is read. Pages read before a font was caught are re-read
    (`recase` pass in `readDoc`).
  - `getDocument` now passes `fontExtraProperties: true`, which carries the glyph names.
- **Spaced display headings** (`isSpacedHeading`). A spaced capital line is not page furniture
  when all of these hold:
  - it has 6 or more letters;
  - it uses 5 or more different letters;
  - it reads as a word;
  - it is set between 0.8 and 2.5 body heights.

  Diagram grids (`G E E G G E`), the swoon tagline and the 49 pt `P A T T E R N R` watermark
  stay out.
- New test hooks: `_dropRunningFurniture`, `_anywhereKeys`, `_caseSuspect`, `_restoreCase`,
  `_drawnAsNamed`, `_caseByWidth`, `_widthInfo`.
- Dump page: the five batch-2 PDFs and `crochet-bee-sizes.pdf` are added to `FILES`.

## How it was checked

- **Browser.** Every check ran in a private headless Chrome on CDP port 9344 (scratchpad
  profile), against the dev server at localhost:8766. The pane's shared tabs were not used.
- **Page images.** Rendered with pdf.js and read against the extract: yoke p1/p2,
  boyfriend p2–p4, boxy p4, stylecraft p1/p5, sandnes p3, raglan-child p2, weaving p19,
  stitchedstories p1, weldons p9.
- **Whole-corpus diff.** All 106 fixtures, heavy included, were extracted before the first change
  and after every change (30 runs). Every changed file was read.
  - **Final diff against the start.** 10 files change: priscilla-filet2, weldons-v24,
    bernat-lace-cardigan, stylecraft-guide, socks, boxy, boyfriend, cabled-yoke, mockneck and
    sandnes-0216.
    - priscilla and weldons now read their columns in order. Weldons' running head is split in two.
    - bernat-lace p4 and the mockneck p4 charts move schematic or chart numbers only.
    - Everything else is the fixes above.
- **Speed.** Corpus 47 s before, 49 s after.
  - Reading operator lists on every page in a caught font had first made sandnes-0216 15× slower
    (0.25 s to 3.6 s) and weldons OCR 7.6 s, which broke both time budgets in patterns.fixtures.
  - The OCR-font exclusion and the width-based text path brought them back to 0.6 s and 0.45 s.

## Suites (fresh headless tabs, session cache cleared)

| Suite | Baseline | Now |
|---|---|---|
| pdftext | 137 | **166 passed, 0 failed** (+3 skipped heavy) |
| pdftext `?heavy=1` | 139 | **170 passed, 0 failed** |
| patterns.fixtures | 894 | **895 passed, 0 failed** |
| patterns.fixtures `?heavy=1` | 909 | **910 passed, 0 failed** |
| knits.fixtures `?heavy=1` | 510 | **510 passed, 0 failed, 14 known** |
| xstitch.fixtures | 493 (+9) | **493 passed** (+9 skipped) |
| sewing.fixtures | 789 | **789 passed** |

- One assertion of mine changed: `p3 left page, then right page` on sandnes-0216. It now expects
  the printed capitals (`Model 1 -- 2-12 YEARS`, `YARN: DUO`), checked against the page image,
  and it also requires both lines to be found. No other test was touched.

## For the parser worker (knits): lines that now read correctly

- **knit-patons-boyfriend-cable**
  - p2: `Size 4/5XL only: 1st row: (RS). K2.` / `ssk. Pat to last 4 sts. K2tog. K2.` /
    **`2nd row: P2. P2tog. Pat to last` / `4 sts. P2togtbl. P2.`** / `Rep last 2 rows 9 times
    more, then` …
  - p3 (Front, All sizes): `All sizes: 1st row: K2. ssk. Pat to` / `last 4 sts. K2tog. K2.` /
    **`2nd row: P2. P2tog. Pat to last` / `4 sts. P2togtbl. P2.`** / `3rd row: As 1st row.`
  - p4 (Sleeves, XS/S–XL): `1st row: (RS). K2. ssk. Pat to last` / `4 sts. K2tog. K2.` /
    **`2nd row: …` / `4 sts. P2togtbl. P2.`** / `3rd row: As 1st row.`
  - The research file's "blocked by extractor" marks on these blocks can go.
- **knit-patons-boxy-cable p4**: `… down from first cast off edges.` / `FINISHING` / `Pin all
  pieces …` / `Neckband: Sew right shoulder seam. … pick up and knit 20 sts …` / `102 (102-106-106-110-110) sts.` /
  `Knit 2 rows.` / `Beg on a 2nd row, work 9 rows in` / `(K2. P2) ribbing as given for Back.` /
  `Cast off in ribbing. Sew left shoulder` / … / `changes at side seams.`
- **knit-patons-cabled-yoke**
  - p1 materials: `MATERIALS` / `Patons ® Decor™ (3.5 oz/100 g; 208 yds/190 m)` /
    `Sizes XS/S M L XL 2/3XL 4/5XL` / `Aran (87602) 6 6 7 7 8 10 balls`.
  - Abbreviations keep their case: `Approx`, `Beg`, `C4B`, `Dec`, `K`, `K2tog`, `P`, `P2tog`,
    `Pat`, `Psso`, `Rem`, `Rep`, `Rnd(s)`, `RS`, `T3B`, `T4B`.
  - Sizes: `Extra-Small/Small`, `Large`, `Extra-Large`, `2 Extra-Large/3 Extra-Large`, …
  - `GAUGE` / `20 sts and 26 rows = 4" [10 cm] with` / `larger needles in stocking st.`
  - `INSTRUCTIONS` and its paragraph whole.
  - Panel Pat A rows 1–16 one per line in order, then `YOKE CABLE`.
  - p2 in four columns: `BOTTOM YOKE`, `All sizes:`, `Size 4/5XL only:`, `Body: Sizes XS/S, M and
    L only:`, the dividing round, the sleeves, `TOP YOKE` rounds 1–14.
  - p3: rounds 15–29.
  - p4 schematic: `Size XL-5XL`, `Size XS-L`, `Body`.
  - The one fault left is `49" [124.5 cm]` printed before `X-Large` in the Finished bust list (row 9).
- **Also changed, so check your expectations**
  - crochet-stylecraft-guide: `UK TERMS US TERMS` and all-caps section heads.
  - knit-interweave-8-socks: `FINISHING`, `NOTES`, `TOE`, `FOOT`, `Heel gusset:`, `Kitchener Stitch`, `Step 1:`.
  - knit-sandnes-0216: `YARN: DUO`, `2-12 YEARS`, `EASY / MEDIUM / ADVANCED`.
  - All suites above pass with them.

## For the owner of js/knits.js / test/knits.fixtures.html

- **Held back (row 8).** knit-sandnes-raglan-child p2/p3 print a centred title block,
  `LIMITED EDITION / CHILDREN / SINGLE PATTERN NO 133 / … / INSTRUCTION: …`, over three
  columns. The extract reads `Limited edition`, then the whole first column (SIZES … TENSION),
  then `children` / `SINGLE PATTERN …` / `INSTRUCTION …`, then column 2.
  - A rule that reads the centred title lines whole (head rows of a region that bridge the gutter
    or stand centred, one short run each) gives the printed order:
    `Limited edition / children / SINGLE PATTERN … / INSTRUCTION … / SIZES …`.
  - But the size-group namer then labels the groups `["Ladies","S–XXL"]` instead of
    `["Children","Ladies"]`, and 21 Sandnes raglan rows go red.
  - I took the rule out. If the namer can find the label in the title block (the line after
    `Limited edition`), tell the coordinator and the rule can go back in. Diff it touches: sandnes
    raglan p2/p3, plus small title moves in sparkling-wrap, priscilla and orr-filet4.

## Still wrong (and why)

- Rows 9–12 of the fault table. The kerning splits (`MEA SUREMENTS`) are the wave E tracked-run
  residual.
- **Case restoration needs glyph names.**
  - A font with a broken ToUnicode map and no encoding names, or with names that disagree on any
    letter, is left as it is.
  - So is a page in a caught font whose runs mix both glyphs of a letter in a way their width
    cannot settle, when its operator list cannot be read.
- The research's sandnes-0216 ½ and age-range glyphs (wave H #10, #11) are unchanged.

## Follow-up: the Sandnes title-block rule (fault table row 8), second try

The coordinator reported that the size-group namer now reads the label from the title block, so
I put the rule back (the same code as before) with its assertions (`p2: the centred title block
is read whole before the first column`, `p3: ...and on the ladies page`).

Fresh tabs with the rule **on**:

| Suite | Result |
|---|---|
| pdftext | 168 passed |
| patterns.fixtures `?heavy=1` | 910 passed |
| knits.fixtures `?heavy=1` | **532 passed, 1 failed**, 11 known |
| xstitch.fixtures | 493 passed (+9 skipped) |
| sewing.fixtures | 789 passed |

- The group names stayed `Children`, `Ladies`, and every Sandnes parse row was green.
- The one red row is a Sandnes row: `Sandnes: the reordered text differs (title block before SIZES)`
  (test/knits.fixtures.html, `runSandnesRaglan`). It checks that the test's own simulated
  reordering changed the text. With the rule on, the extract already comes in the printed order,
  so the simulation has nothing to move.
- As instructed, the rule is **out** again. Rule off: pdftext 167 passed, knits.fixtures heavy
  533 passed, 0 failed, 11 known.
- **For the owner of test/knits.fixtures.html:** let that assertion also pass when the extract is
  already in printed order. For example, check that `children` comes right after
  `Limited edition` on p2 in either `reord` or `txt`. Once that is done, the rule can go back in
  unchanged. It is the block marked "A title block centred over the page" plus `TITLE_CENTRED` /
  `TITLE_SHORT` in the earlier version of `fullWidthBands`.

## Follow-up 2: the title-block rule is back on

The knits fixture assertion now only requires the title block to come before SIZES, so the rule
from row 8 is back in `fullWidthBands` unchanged (`TITLE_CENTRED` 0.02, `TITLE_SHORT` 0.6). Its
two assertions are back in `test/pdftext.test.html` (`p2: the centred title block is read whole
before the first column`, `p3: ...and on the ladies page`).

Fresh headless tabs:

| Suite | Result |
|---|---|
| pdftext | 168 passed, 0 failed (+3 skipped) |
| patterns.fixtures | 895 passed |
| patterns.fixtures `?heavy=1` | 910 passed |
| knits.fixtures `?heavy=1` | 533 passed, 0 failed, 11 known (Sandnes groups Children, Ladies) |
| xstitch.fixtures | 493 passed (+9 skipped) |
| sewing.fixtures | 789 passed |

Fault table row 8 is now ✔. The rule also moves three small titles: in crochet-premier-sparkling-wrap,
"Design by Ellen K. Gormley" is now read under the title. The other two moves are OCR title lines
on priscilla-filet2 and orr-filet4.
