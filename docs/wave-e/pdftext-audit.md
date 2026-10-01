# Wave E: PDF text extractor audit (`js/pdftext.js`)

Owner of `js/pdftext.js`, `test/pdftext.test.html` (new) and `test/pdftext.dump.html` (new, dev
tool). No other file was edited.

## How the audit was done
- `test/pdftext.dump.html` dumps, for any fixture, `PdfText.extract` per page next to the raw
  pdf.js rows (every item, baseline-grouped, y / height / rotated flag) and lists the items the
  extractor did not emit. `?all=1&sink=PORT` walks all 100 fixtures, and `?render=1` writes page
  images (a background tab never fires `requestAnimationFrame`, so the page polyfills it).
  Both POST to a scratch sink outside the repo; nothing from `tmp-pdf` went anywhere else.
- Every text-bearing fixture (85 of 100; the other 15 have no text layer and are correctly
  refused) was compared against its page images. That covered all crafts, plus `?heavy=1`
  files. J-YS004 was skipped because it was never fetched. Six read-only helper audits split
  the corpus (amigurumi, yarn-company leaflets, long booklets, sewing, OCR scans,
  cross-stitch). The crochet / sewing / xstitch parser audits' pdftext sections were folded in.
- Every change was checked by diffing the whole-corpus dump before and after, and by
  re-running the parser suites with a cleared session cache. While the other agents were still
  editing, each suite was also run against a HEAD copy of `pdftext.js`, so that only
  extraction-caused failures were counted as mine.

## Discrepancy table
Legend: ✔ fixed; ◐ partly fixed; ✘ not fixed (see "Still wrong"). Assertions are in
`test/pdftext.test.html` unless noted.

| # | Fixture / page | Fault: before | After | | Assertion |
|---|---|---|---|---|---|
| 1 | bear p2 | Full-width Legal box cut down the gutter: "This pattern is intended for personal" … "use only. All patterns, designs and photos included" in the other column | each line whole, after both columns; "Legal" heading stays above it | ✔ | `p2 legal box line read whole…`, `…"Legal" heading sits right above` |
| 2 | bear p2 | Last short line "Willow&Wild. Copyright 2024." | kept with its paragraph | ✔ | `p2 the legal box's short last line stays with it` |
| 3 | bear p2 | Tip bubble "You can use a different weight of yarn…" dropped as a caption | kept (wrapped prose is not a callout) | ✔ | `p2 the tip bubble is read` |
| 4 | bear p3, p5 | Photo key letters glued: "…desired firmness is C", "Legs G" | "…firmness is", "Legs" | ✔ | `p3 photo letter C…`, `p5 photo letter G…` |
| 5 | knit-interweave-lace, -8-socks, other-weaving-handwoven | Stacked fractions: numerators on their own line ("1 3" over "Finished Size 26 (27 ⁄2 , 28 ⁄4)") | "26 (27 1/2 , 28 3/4)" | ✔ | `stacked fractions keep their numerators` |
| 6 | knit-interweave-8-socks | "Finished Size 71/2 (9, 101/2)" (one text run) | "7 1/2 (9, 10 1/2)" | ✔ | `same-baseline fraction…`, unit `…ASCII slash` |
| 7 | sew-freespirit p1-p17 | Faux-bold (every glyph drawn twice) + stacked: "11" / "64 ⁄22"", "⁄33 yard", "Finished Finished" | "64 1/2" x 64 1/2"", "2/3 yard", "1 5/8 yards" | ◐ | `faux-bold stacked fraction`; "Finished Finished" (a second overlapping layout, not faux bold) still doubled |
| 8 | sew-freespirit p2 | "PWCG012.KEYLIME 4/8 yards" (numerator level with the bigger swatch labels) | "4 1/8 yards (3.77m)" | ✔ | `p2 a numerator level with bigger swatch labels…` |
| 9 | sew-freespirit p5-p11 | Superscript piece numbers on their own line ("4 5 6" / "I , I , and I") | "I4, I5, and I6", "J4, and J5", "N4" | ✔ | `superscript piece numbers stay on their line` |
| 10 | sew-freespirit p4-p6 | Cutting-diagram letters "I I I I", "J J" leaking between heading and cut line (control code U+001F inside defeated the furniture test) | dropped | ✔ | `cutting-diagram letters…` |
| 11 | crochet-premier-simple-throw p2 | "rd" alone / "Hdc in 3 ch from hook" | "Hdc in 3rd ch from hook" | ✔ | `"Hdc in 3rd ch from hook"` |
| 12 | crochet-stylecraft-cowl-mitts p2 | "th" alone / "3tr in 6 ch" | "3tr in 6th ch from hook" | ✔ | `"3tr in 6th ch from hook"`, `no orphan "th" line` |
| 13 | knit-fromtheheart-magicloop-socks p1 | "th th, th) th st, th)" / "between 18 (20 24 and 19 (21 25" | "between 18th (20th, 24th) and 19th (21st, 25th) stitches" | ✔ | `size list keeps its ordinals and punctuation` |
| 14 | sew-peppermint-westend-jacket p3 | "60" 1 yds" (raised 7/8 dropped) | "60" 1 7/8 yds" | ✔ | `the raised 7/8 stays with its 1` |
| 15 | sew-swoon-mabel-bag p2, p9-13 | "® ®" lines; "Pellon Peltex 70" | "Pellon® Peltex® 70 stabilizer" | ✔ | `Peltex line whole, ® marks in place`, `no "® ®" line` |
| 16 | sew-agf-catwalk-quilt p1, p4, p5 | Double-printed letter-spaced headings "C U T T I N GC U T T I N G…" (and briefly dropped altogether mid-wave) | "FREE PATTERN", "CUTTING DIRECTIONS", "CONSTRUCTION" | ✔ | `p1 "FREE PATTERN"`, `p4 …`, `p5 …`; unit `a faux-bold heading drawn twice comes out once` |
| 17 | sew-swoon-mabel-bag | 3 pt logo tagline "S E W I N G P A T T E R N S" became "SEWING PATTERNS" lines once tracked headings were repaired | stays out | ✔ | `the 3 pt logo tagline stays out` |
| 18 | crochet-baphomet p2-p4 | (guard) arm-diagram callouts must stay out while bands / prose rules change | "Crochet arms", "5 4 3 2 1", "4 sc between", "Eye placement" all out | ✔ | `diagram callout "…" is not in the text` (4) |
| 19 | xs-dmc-2168 p4 | Three side-by-side key blocks split inside each record: "162 / 300 / …" then "x1 722 x1" | "162 x1" … "721 x1", then "722 x1" …, then "946 x1" … | ✔ | `p4 each key block reads as "code x1" records`, `p4 block by block` |
| 20 | xs-pokemon-tl/tr/bl/br key page | (regression guard) newspaper-column key must stay column-major; a mid-wave table-row rule zipped it across | column-major | ✔ | `key page: column-major order…` |
| 21 | xs-pokemon-tr/bl/br key page | Page stamp glued into a key row: "38 / 383756 (905 ct)" | stamp run dropped: "3756 (905 ct)" | ✔ | xstitch.fixtures `3756 found with 905 stitches` (parser keeps its repair) |
| 22 | xs-tinymodernist-foxy p1 | "X" heading the key dropped by the photo-letter rule | "X DMC" | ✔ | `the "X" leading the key header…` |
| 23 | xs-tinymodernist-halloween | (guard) Stitches/Length block stays its own column, as the parser expects | unchanged | ✔ | `key row "453 Shell Grey LT"`, `the Stitches/Length block stays its own column` |
| 24 | crochet-kingcole-pumpkins p2 | Shade labels under swatches dropped as captions ("3312 Mustard", "1746 Mango", "3491 Burnt Orange"…) | kept | ✔ | `p2 shade labels under the swatches are key cells` |
| 25 | sew-rileyblake-triple-t-tote p4 | "Cut off your zipper excess." dropped as a caption | kept | ✔ | `p4 a one-sentence step between figures is kept` |
| 26 | sew-rileyblake-triple-t-tote p2-3 | "backs�tch", "crea�ng" (unmapped "ti" ligature) | "backstitch", "creating" | ✔ | `the unmapped "ti" ligature…` |
| 27 | crochet-archive-weldons-v24 p8, p12 | Whole instruction lines dropped because OCR read a smudge as "©" | kept; real © notices still dropped | ✔ | `an OCR "©" smudge does not throw a whole instruction line away`, cardigan `the © running head is still furniture` |
| 28 | cardigan p3/p7/p8/p21, sew-peppermint-* , sew-agf-catwalk p6, OCR scans | Line-end hyphen kept on short prefixes: "sec-tion", "pat-tern", "cro-cheted", "fab-ric", "re-duce"; joined line ending in "-" never re-joined | "section", "pattern", …; hyphen kept only next to a craft token ("ch-sp", "X-st"); joins chain | ✔ | `"sec-tion" joins…`, `"pat-tern" joins…`, unit `line-end hyphens…` |
| 29 | crochet-hobbii-amarah-en p4 | 1 pt SKU stamp "hobbii-pattern-sku:…" | dropped | ✔ | `the 1 pt SKU stamp…` |
| 30 | crochet-allfree-stitches-ebook | 81 private-use Symbol bullets U+F0B7 | "-" | ✔ | `no private-use Symbol bullets left` |
| 31 | crochet-turtle p1-p5 | Folios "1"-"5" at y 69 (above the 8 % band); p1 line cut at the gutter "…each piece" / "– for sewing together" lost | folios dropped; line whole | ✔ | `folios 1-5…`, `p1 the line crossing the gutter is read whole` |
| 32 | xs-pacman / portal / typechar / pokemon | KG-Chart footer "(This chart is printed using KG-Chart LE…)" at 10 % of the sheet, title on every page | dropped on most pages (same text at the same height on ≥60 % of pages) | ◐ | `the KG-Chart footer at 10%…` (≤5 left) |
| 33 | other-apl-tatting-riego p2/6/17, xs-apl-priscilla-cross1, xs-apl-dmc-pointdemarque, crochet-apl-priscilla-filet2 | Diagonal "Antique Pattern Library" watermark kept as text, so image plates were never reported empty | slanted text dropped; plates reported empty | ✔ | `the diagonal APL watermark is never text`, `image-only plates are reported` |
| 34 | crochet-lionbrand-logcabin-pullover p7 | Schematic page not reported empty (footer survived) | `emptyPages [7]` | ✔ | `p7 … has no readable text` |
| 35 | crochet-caron-cuff-cardigan p1-4 | Footer "CAC0129-026985M \| July 5, 2019" + head "CUFF TO CUFF CROCHET CARDIGAN \| CROCHET", glued on some pages, separate on others, never reached the repeat threshold | dropped | ✔ | `a footer printed as one line on some pages and two on others…` |
| 36 | crochet-redheart-persian-tiles p1-2 | Two-page leaflet footer "For more ideas & inspiration", URLs, running head inside BORDER Rnd 1 | footer dropped (two pages are enough for an identical margin line) | ◐ | `a two-page leaflet's identical footer is dropped`; one "PERSIAN TILES AFGHAN \| CROCHET" left on p2 |
| 37 | crochet-bernat-basketweave p1 | "or size" torn off the hook line into "1st row" | "…crochet hook or size" | ✔ | `p1 "or size" stays on its line` |
| 38 | sew-peppermint-samford-pants p5 | Fabric table split down the page gutter ("140CM / SIZES A-H / 113CM…" then "1.5 / 1.6…" then the rest after the notions); stray cells in front of the fabric prose cost the notions list its elastic | table read row by row after the columns; "2" (5cm) Elastic" read | ✔ | `p5 the fabric table under the columns is read row by row`, `…headers included`, `p5 no stray table cells ahead of the notions`; sewing.fixtures `the 2" elastic itself…` |
| 39 | sew-peppermint-samford-pants p5 | Side headings FABRIC / INTERFACING / NOTIONS / FABRIC REQUIREMENTS dropped as captions | kept (but listed together at the top of the label column, not beside their blocks) | ◐ | `p5 the side headings are kept` |
| 40 | crochet-stylecraft-hex-socks p3 | (guard) three prose columns must not be taken for a table | unchanged | ✔ | `p3 three prose columns are not zipped into table rows` |
| 41 | sew-tianas-jogger | Size layers printed at one spot glued: "SIZE 12MSIZE 18M…" | upright layers "SIZE 12M SIZE 18M …"; sideways ones still glued | ◐ | `upright size layers…` |
| 42 | crochet-panda p1, bee p4/6/8, crochet-premier-* , crochet-hobbii p2, cardigan p2/p4/p7 | Full-width titles / blocks above or below the columns read into column 1 or cut in half | read whole in place (when their words cross the gutter) | ◐ | covered by #1 and the unit `a full-width block under two columns…` |
| 43 | crochet-patons-mesh, crochet-caron, knit-bernat-topdown | Page stamp / header pieces mid-page | mostly dropped (#35); Patons keeps "Crochet Mesh Cardigan PAC0129-… " on p1 and p6 only | ◐ | — |
| 44 | xs-apl-dmc-puntomarca, -pointdemarque | Poor OCR layer, nothing measured it | new additive `ocrNoise` (0.315 / 0.069 vs 0 for born-digital); `garbled` unchanged | ✔ | `a poor OCR layer scores ocrNoise >= 0.2`, `a good OCR layer scores low`, `born-digital text has no OCR noise` |
| 45 | HANDOFF 14 | `PdfText.open` had no signal | `open(file, {signal})`, checked before the read, before/after parse (a late cancel destroys the doc), and on every textOf / renderPage / extract | ✔ | `open() with a cancelled signal…`, `textOf after cancel…`, `renderPage after cancel…` |
| 46 | HANDOFF 6 | `onPages`+`onText` built text from `textOf`, so there was no running-head pass, no unicode folding, no emptyPages | new `handle.extract(opts)` runs the exact extract pipeline on the open document | ✔ (pdftext side) | `handle.extract() gives exactly PdfText.extract()'s text`, `…including the cross-page running-head pass`, `…same emptyPages`, `…cancelled signal rejects` |

Faults reported and NOT fixed are listed under "Still wrong".

## Rules added or changed (all geometric or typographic, none per file)
- **attachScripts**: a glyph much smaller than a neighbouring row (≤ 0.75 of its height),
  sitting within 0.6 heights above or 0.35 below its baseline, touching one of its items and
  not lying on its glyphs, joins that row as a super- or subscript. This is judged glyph by
  glyph, so a numerator sharing a baseline with bigger labels still qualifies. A numerator
  touching a whole number gets a space ("27 1/2").
- **dropOverprint**: two runs starting at the same place on one line, where one is a prefix
  of the other, keep exactly one copy (faux bold).
- **Tracked headings**: a line made only of spaced-out runs, with one run of 4 or more glyphs
  that reads as a word (not "A B C D", not a repeating chart row, not set much smaller than
  the body), is letter-spacing-repaired even on an ordinary page.
- **Full-width bands** (`fullWidthBands`): once a gutter is found, lines whose words cross it
  are read whole, in place. That covers a run of two or more such lines, or one at the very
  top or bottom of the region, provided the crossing run is at least 30 % of the region wide
  and has at most two cells. A one-side heading just above the band and the paragraph's
  short last line go with it. The rest is split at the same gutter, and caption detection
  sees all the pieces of one column together.
- **Table at the end of a region** (`tableEnds`): rows of three or more short cells (three
  words a cell at most) on both sides of the gutter are read row by row when they open or
  close the region and are the smaller part of it. One-cell row labels between them come too.
  A record repeated across the gutter (a newspaper-column key) never counts.
- **Record gaps** (`preferRecordGaps` / `isCellWall`): a gutter candidate whose two sides
  repeat the same record shape goes first. A band inside a record, where nearly every row is
  paired one or two tokens a side, is not a gutter.
- **splitRow**: words within a word space of each other go to the same side of the gutter,
  by the run's centre. Text turned against the page still goes item by item.
- **Captions**: wrapped prose (12+ words, lower-case run-ons) is not a caption. Neither is a
  body-size sentence of 5+ words, nor a shade code with a name ("3282 Spice"). A capitalised
  side heading level with a kept line in another column is restored.
- **Photo letters**: a lone capital at least 1.3× the body size, clear of its neighbours, and
  not first on its line is dropped. **Invisible text** under 2 pt is dropped on pages with
  normal text. **Slanted text** (not a right angle) is never content.
- **Furniture**:
  - © lines are furniture unless they are a long lower-case sentence that names no year,
    site or rights.
  - Furniture is tested with control codes removed.
  - Folios outside the 8 % band are dropped when they run in step with the page number.
  - A line of 12+ characters at the same height on ≥ 60 % of pages is dropped wherever it sits.
  - Margin heads count when glued to other heads. Two-page documents use a threshold of 2.
  - A spaced "n / N" stamp run is removed from a row near the page edge.
- **Hyphenation**: a line-end hyphen is kept only next to a craft token (ch, sp, st, sc, dc,
  tr, sl, yo, rnd, k, p, …). Joins chain.
- **Unicode** (extract only; `textOf` stays byte-exact for the chart readers):
  - U+F0B7 becomes "-".
  - The fraction slash becomes "/".
  - "71⁄2" and "71/2" become "7 1/2" (proper halves to sixteenths only, never dates).
  - An unmapped glyph between lower-case letters becomes "ti".
- **API**:
  - `PdfText.open(file, {signal})`; `handle.extract({onProgress, maxPages, signal})`.
  - `extract` and `handle.extract` share `readDoc`.
  - New `ocrNoise` on the result.
  - Test hooks: `_columnize`, `_attachScripts`, `_dropOverprint`, `_fullWidthBands`,
    `_readsAsProse`, `_rowIsTracked`, `_ocrNoise`.

## Still wrong (and why)
- **Tables that the page gutter runs through in mid-page** (FreeSpirit p2 yardage table
  names / codes / yardages, xs-tinymodernist-halloween key) still come out column by column.
  Zipping them into rows was tried and broke the newspaper-column keys (pokemon) and the
  halloween parser's zip-back. Only tables at the start or end of a region are read as rows.
- **Hidden / duplicate text layers** (knit-interweave-8-socks p4 every line twice, 24 pt
  apart; socks p5 ad text inside Heel Flap; xs-dmc-2173 hidden "use 2 strand backstitch";
  freespirit "Finished Finished Block Sizes"). pdf.js `getTextContent` does not expose the
  render mode or clipping. Telling them apart needs the operator list. Not attempted.
- **Narrow gutters with drifting baselines** (crochet-bernat-lace-cardigan p3,
  crochet-stylecraft-guide spreads, the APL two-column OCR pages, weaving p7) are still
  interleaved. No clear band exists at the item level, and the OCR "gutter from item starts"
  idea needs its own column model.
- **Letter-spaced runs without word gaps** (crochet-snowman p2 "JumboChenilleYarn…",
  catwalk "ADDITIONALBLENDERSFORTHISPROJECT"): pdf.js returns one item with uniform single
  spaces, so the word breaks are not in the data.
- **Kerning splits in display faces** ("AT TACH", "EL ASTIC", "CUT TING": Peppermint), small
  caps mapped to lower case (joyous-picnic "Fus-P-1208"), symbol fonts as codes (wocs).
  These are font-level problems. The parsers already repair the kerning splits.
- **Rotated label blocks on upright pages** (pattern sheets, sew-peppermint-bronte p5 size
  chart drawn at 90° on a rotate-0 page, apron A0) are read in the page frame.
- **Captions sharing a baseline with body text** (cato p9, mabel "1) PREPPING Exterior
  Lining", freespirit p6 "(8) 6 3/Fabric N - …: Cut 4 each4" squares", sundress p5) are
  still glued.
- **Bullets vs asterisks in OCR** ("Repeat from -." where the page has "*") were not changed,
  because mid-line "•" is a real separator in born-digital PDFs.
- **Text-free APL books are still accepted**: klickmann, hkb383 and nicoll carry a
  licence page with real text. Their plates are now reported empty, and `ocrNoise` is
  available, but a licence page cannot be told from a pattern page geometrically.
- Kerned folios ("1 0" inside kingcole p10) and the bronte "bikini top" section head (it
  repeats on 41 % of pages, so it is treated as a running head) were left alone.

## For the coordinator: expectations that can be tightened now
- `test/xstitch.fixtures.html` xs-tinymodernist-foxy: DMC 19 and the 3799 cross row are back
  in the extraction ("X DMC / Blanc / 19 / 3854 / … / p 3799"). The "KNOWN GAP" relaxation can
  go.
- `test/sewing.fixtures.html` sew-peppermint-samford-pants: the fabric grid is now row-major
  ("TOP SHORTS PANTS" / "METERS YARDS METERS YARDS METERS YARDS" / "140CM 1.5 1.65 1.5 1.9 2.6
  2.85" / "SIZES A-H" / "113CM 1.6 …"). The parser can read it instead of reporting the
  table unreadable.
- `test/xstitch.fixtures.html` pokemon "3756 read through the 38 / 38 page footer": the stamp
  is no longer glued, so the parser's repair is now only a fallback.
- Confirmed against the page images: Lion Brand p7 is image-only (schematic + footer), and
  riego p2/6/17 are plates with only the watermark. The relaxed expectations in
  patterns.fixtures are right.

## For the owner of js/app.js
- `pdfDropZone`'s `onPages` + `onText` route (`gatherText`, around line 4404) should call
  `handle.extract({ signal: signal, onProgress: … })` instead of looping `textOf`. That gives
  the running-head pass, unicode folding, emptyPages, garbled and ocrNoise (HANDOFF 6).
  `PdfText.open(file, { signal: signal })` makes Cancel stop the open itself (HANDOFF 14).
  CRAFTS.md's caveat paragraph can then be removed by the docs agent.

## Suites (final, fresh tab each, session cache cleared)
pdftext 86/0 (new) · patterns 976/0 · patterns.fixtures 780/0, `?heavy=1` 795/0 · xstitch
700/0 · xstitch.fixtures 475/0 (+9 skipped) · sewing 882/0 · sewing.fixtures 755/0 · crafts
124/0 · templates 94/0 · diagram-model 521/0 · diagram 193/0.
