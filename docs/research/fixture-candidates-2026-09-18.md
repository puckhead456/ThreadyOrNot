# PDF import fixture candidates — sourcing pass, 2026-09-18/19

Candidate list for the parser test corpus described in
`docs/brainstorm/06-pdf-import-robustness.md` ("Fixture wish-list", failure modes #2–#23).
Every entry is a **free** download published by the designer, the brand or the Antique Pattern
Library itself. Nothing paywalled, nothing that looked pirated, nothing account-gated except where
the row says so.

**77 candidates** were sourced and verified. The batch was then fetched into the gitignored
`tmp-pdf/` folder: **76 succeeded, 1 failed** (the Lion Brand Tunisian Entrelac Throw URL returns
`200` with an HTML body, not a PDF — see Dead ends). Local filenames and the exact URL for each
file are recorded in **`tmp-pdf/fetch-2026-09-19.txt`** (`name|url` per line), with the run's
per-file result in `tmp-pdf/fetch-2026-09-19.log`. The `crochet-` / `knit-` / `xs-` / `sew-` /
`other-` prefixes are the ones `test/patterns.fixtures.html`, `test/xstitch.fixtures.html` and
`test/sewing.fixtures.html` look for.

Reading the columns:

- **Size** is the byte count actually received, from the fetch log — not a header estimate.
- **HTTP status** is the final status after redirects; the fetch ran `curl --fail`, so every `OK`
  row resolved 2xx and passed a `%PDF-` magic-byte check.
- **Licence/terms** records what the hosting page states. Where a page states nothing at all, the
  row says so rather than inventing a licence. Antique Pattern Library's terms were read directly:
  the originals are public-domain scans, and the scans themselves are released under a
  **Creative Commons Attribution-NonCommercial-ShareAlike** licence — free to copy, distribute and
  make derivative works of, explicitly *not* to sell. That makes APL the only group here whose text
  could ever be committed to the repo.
- **Exercises** is the *intended* target — the failure mode this file was chosen for. It is a
  prediction from the source, the format and the file size, to be confirmed the first time each one
  is actually parsed. Treat a surprise here as information, not as an error in this table.

Size flags: **▲** over 25 MB (the #6 size-guard fixtures), **▼** under 100 KB (probably not a real
pattern — keep only as a degenerate-input case).

---

## Crochet (28)

| # | Name | Designer/brand | Direct URL | Size | Licence/terms | HTTP | Exercises |
|---|---|---|---|---|---|---|---|
| 1 | Festival Fiesta — **UK terms** | King Cole | https://www.kingcole.com/wp-content/uploads/2025/09/Festival-Fiesta-UK-Terms.pdf | 19,856,627 (18.9 MB) | Free pattern download, no account; no explicit licence stated | 200 | **#3** the UK vocabulary fixture — htr/tr/dtr/miss/tension. Half of a matched UK/US pair, so any arithmetic divergence between the two is *ours* |
| 2 | Festival Fiesta — **US terms** | King Cole | https://www.kingcole.com/wp-content/uploads/2025/09/Festival-Fiesta-US-Terms.pdf | 19,852,751 (18.9 MB) | Free pattern download, no account; no explicit licence stated | 200 | **#3** the US twin of #1 — the same garment, same layout, different dialect: free ground truth for the UK/US hint chip |
| 3 | Basketweave blanket | Bernat (Yarnspirations) | https://www.yarnspirations.com/cdn/shop/files/BRC0502-035313M.pdf | 777,994 (760 KB) | Free PDF, no account; Yarnspirations terms = personal, non-commercial | 200 | **#3** post stitches — fpdc/bpdc are the whole stitch pattern, so `computed` is null on every row today |
| 4 | Lace cardigan | Bernat (Yarnspirations) | https://www.yarnspirations.com/cdn/shop/files/BRC0129-000032M.pdf | 627,227 (613 KB) | Free PDF, no account; personal, non-commercial | 200 | **#10** brand shaping table + multi-size lists; the canonical "table gutter read as a page gutter" case |
| 5 | Log Cabin Pullover | Lion Brand | https://cdn.accentuate.io/8196511432797/12378270040157/M25103-WEDK_Log-Cabin-Pullover-12.5-edit-v1785871765863.pdf | 1,432,013 (1.4 MB) | Free pattern, no account; no explicit licence stated | 200 | **#13** Lion Brand's narrow left "Notes" sidebar sits outside the 30–70 % `findGap` band — every round vanishes today |
| 6 | Cuffed cardigan | Caron (Yarnspirations) | https://cdn.shopify.com/s/files/1/0711/5132/1403/files/CAC0129-026985M.pdf | 778,985 (761 KB) | Free PDF, no account; personal, non-commercial | 200 | **#10** second independent brand table, for confirming `looksTabular` is not tuned to one publisher |
| 7 | Mesh cardigan | Patons (Yarnspirations) | https://cdn.shopify.com/s/files/1/0711/5132/1403/files/PAC0129-034206M.pdf | 695,089 (679 KB) | Free PDF, no account; personal, non-commercial | 200 | **#10 / #3** multi-size garment with "repeat until it measures"; a third house variant of the shaping table |
| 8 | Persian Tiles blanket | Red Heart (Yarnspirations) | https://cdn.shopify.com/s/files/1/0711/5132/1403/files/RHC0502-023713M.pdf | 437,198 (427 KB) | Free PDF, no account; personal, non-commercial | 200 | **#17** motif blanket — rounds with joins, stitch-pattern repeats and a chart the text delegates to |
| 9 | Weldon's Practical Needlework (K-WK013) | Antique Pattern Library | https://www.antiquepatternlibrary.org/pub/PDF/K-WK013.pdf | 42,238,204 (40.3 MB) ▲ | Public-domain original; scan under **CC BY-NC-SA**, free to copy, may not be sold | 200 | **#22 + #6** the headline OCR fixture: a scan with no text layer, period typesetting, UK "miss 1 chain" throughout, and big enough to trip the size guard |
| 10 | Priscilla Filet Crochet Book 2 | Antique Pattern Library | https://antiquepatternlibrary.org/pub/PDF/6-JA018PrisFilet2.pdf | 30,628,820 (29.2 MB) ▲ | Public domain original; scan **CC BY-NC-SA** | 200 | **#22 + #9 + #6** filet charts are dense grids — the quadratic `buildRows` case *and* an OCR case in one file |
| 11 | Häkelarbeit (German, B-YS097) | Antique Pattern Library | https://www.antiquepatternlibrary.org/pub/PDF/B-YS097.pdf | 17,480,673 (16.7 MB) | Public domain original; scan **CC BY-NC-SA** | 200 | **#19 + #22** a *German* public-domain scan: Reihe/Runde/FM/Stb/Lm as OCR output, committable, which no other language fixture is |
| 12 | Craft of Crochet (Klickmann) | Antique Pattern Library | https://www.antiquepatternlibrary.org/pub/PDF/KlickmannCraftCrochet1.pdf | 9,208,485 (8.8 MB) | Public domain original; scan **CC BY-NC-SA** | 200 | **#10 + #22** dense period text with tables of rows — the committable UK-vocabulary text fixture for #3 |
| 13 | Orr, Filet Crochet Book 4 | Antique Pattern Library | https://www.antiquepatternlibrary.org/pub/PDF/Orr4FiletCrochet.pdf | 7,071,559 (6.7 MB) | Public domain original; scan **CC BY-NC-SA** | 200 | **#17 + #22** chart-only pages with no text form at all — the "import ends with an empty project" case |
| 14 | Weldon's Practical Crochet V24 N285 | archive.org | https://archive.org/download/pc-24-285/PracticalCrochet-V24N285.pdf | 10,618,611 (10.1 MB) | Public domain (pre-1929); archive.org public-domain item | 200 | **#22** a second, independently produced scan pipeline — archive.org's OCR layer differs from APL's, so it tests that we do not tune to one scanner |
| 15 | Crochet Stitches eBook | AllFreeCrochet | https://www.allfreecrochet.com/master_images/AllFreeCrochet/Crochet-Stitches-eBook.pdf | 2,426,719 (2.3 MB) | Free eBook download, no account; no explicit licence stated | 200 | **#15 + #2** multi-pattern ebook with a contents page: the phantom-section-from-TOC case and the ebook boundary detector in one file |
| 16 | Lace Doily (amikomo3-13) | Gosyo / Pierrot Yarns | https://www.gosyo.co.jp/english/pattern/eHTML/ePDF/1103/3w/amikomo3-13_Lace_Doily.pdf | 580,235 (567 KB) | Free English translation, no account; no explicit licence stated | 200 | **#7 + #17** Japanese-origin symbol chart — fullwidth digits, `段` markers, and a piece that exists only as a diagram |
| 17 | Soft Lace Motif Doily (28-50) | Gosyo / Pierrot Yarns | https://www.gosyo.co.jp/english/pattern/eHTML/ePDF/1110/2w/28-50_Soft_Lace_Motif_Doily.pdf | 355,602 (347 KB) | Free English translation, no account; no explicit licence stated | 200 | **#17** motif pattern: rounds with joins ("join with sl st to top of beg ch-3") plus chart references |
| 18 | Chunky Crochet Hood (F138) | Stylecraft Yarns | https://www.stylecraft-yarns.co.uk/Content/Downloads/Free%20Patterns/F138-SpecialChunkyCrochetHoodOnlinePattern_MB1v3.pdf | 574,839 (561 KB) | Free online pattern, no account; no explicit licence stated | 200 | **#3** UK terms from a second UK brand, with a different PDF generator from King Cole's |
| 19 | Cowl, Mitts & Scarf (F045) | Stylecraft Yarns | https://www.stylecraft-yarns.co.uk/Content/Downloads/Free%20Patterns/F045_CrochetCowl_Mitts_Scarf_BatikSwirl.pdf | 340,408 (332 KB) | Free online pattern, no account; no explicit licence stated | 200 | **#15 + #3** three garments in one leaflet — a small, cheap multi-pattern boundary case in UK terms |
| 20 | Cabaret Cluster Stitch (F048) | Stylecraft Yarns | https://www.stylecraft-yarns.co.uk/Content/Downloads/Free%20Patterns/F048_FreeonlineCabaretClusterStitch_p2_.pdf | 280,034 (273 KB) | Free online pattern, no account; no explicit licence stated | 200 | **#3** cluster/V-stitch vocabulary the table has never seen, in UK terms |
| 21 | Festive HEX Socks (F151) | Stylecraft Yarns | https://www.stylecraft-yarns.co.uk/Content/Downloads/Free%20Patterns/F151SC202_HOHFestiveHEXSocksFreeOnlinePattern_MB2.pdf | 1,807,185 (1.7 MB) | Free online pattern, no account; no explicit licence stated | 200 | **#3 + #10** crochet socks: mirrored pieces, a size table, and post-stitch ribbing at the cuff |
| 22 | Crochet Guide | Stylecraft Yarns | https://www.stylecraft-yarns.co.uk/Content/Downloads/CrochetGuideNew.pdf | 1,606,482 (1.5 MB) | Free guide, no account; no explicit licence stated | 200 | **#2** a pure glossary/technique document with numbered steps and no rounds at all — the confidence banner (#8) must score this LOW, not invent a pattern |
| 23 | Simple Crochet Throw | Premier Yarns | https://cdn.shopify.com/s/files/1/1190/0400/files/Simple_croche_throw.pdf | 1,028,873 (1.0 MB) | Free PDF, no account; no explicit licence stated | 200 | **#10** blanket with stitch-pattern repeats; a fourth brand house style for the table detector |
| 24 | Spangle Sparkling Wrap | Premier Yarns | https://cdn.shopify.com/s/files/1/1190/0400/files/spangle-sparkling-wrap-crochet-pattern.pdf | 142,293 (139 KB) | Free PDF, no account; no explicit licence stated | 200 | **#13** a one-page leaflet whose materials block is set as a narrow side column |
| 25 | Frontier Shawl | Furls Crochet | https://cdn.shopify.com/s/files/1/0166/0254/files/FRONTIER-SHAWL-PDF.pdf | 438,898 (429 KB) | Free PDF, no account; no explicit licence stated | 200 | **#5** an indie-studio design export — the subset-font / no-ToUnicode class we have no real sample of yet |
| 26 | Varied Size Pumpkins | King Cole | https://www.kingcole.com/wp-content/uploads/2024/07/Varied-Size-Pumpkins-FOC-Pattern-copy.pdf | 7,087,095 (6.8 MB) | Free pattern download, no account; no explicit licence stated | 200 | **#3 + #10** one pattern in several sizes side by side — the multi-size list shape, in UK terms |
| 27 | C2C Mountain Landscape | Magic Yarn Pixels | https://magicyarnpixels.com/wp-content/uploads/2021/04/Mountain-Landscape-by-Magic-Yarn-Pixels.pdf | 31,492 (31 KB) ▼ | Free pattern, no account; no explicit licence stated | 200 | **#17 + #9** a corner-to-corner graph chart — almost no prose, a dense grid, and small enough to be a fast degenerate-input regression test |
| 28 | Tunisian Entrelac Throw | Lion Brand | https://cdn.accentuate.io/4679269777501/12378270040157/Crochet-Pattern-Tunisian-Crochet-Entrelac-Throw-L20319-v1589735065960.PDF | 63,177 received — **not a PDF** | Free pattern, no account | **200, HTML body** | **DEAD.** Intended as the Tunisian vocabulary fixture (tss/tks/tps, forward and return pass). The CDN answers 200 with an HTML page; the Tunisian gap is still uncovered |

---

## Knitting (7) — for the planned knitting module

| # | Name | Designer/brand | Direct URL | Size | Licence/terms | HTTP | Exercises |
|---|---|---|---|---|---|---|---|
| 29 | Sandnes Garn 0216 (EN) | Sandnes Garn | https://www.sandnesgarn.no/media/productattach/11006/SG_0216EN_oppslag.pdf | 18,946,752 (18.1 MB) | Free pattern-booklet PDF, no account; no explicit licence stated | 200 | **#23 + #10** the Scandinavian house style: a spread-imposed booklet (two pages per sheet — a geometry case in itself), charts referenced by letter, and size tables |
| 30 | Top-Down Pullover | Bernat (Yarnspirations) | https://cdn.shopify.com/s/files/1/0711/5132/1403/files/BRK0129-027155M.pdf | 455,384 (445 KB) | Free PDF, no account; personal, non-commercial | 200 | **#10 + #3** the brand knit house style — identical table furniture to the crochet leaflets, entirely different vocabulary (k/p/k2tog/ssk/yo/m1l) |
| 31 | 8 Free Sock Patterns from Knitting Daily | Interweave | https://www.interweave.com/wp-content/uploads/8-FREE-Sock-Patterns-from-Knitting-Daily.pdf | 7,352,920 (7.0 MB) | Free download, no account; no explicit licence stated | 200 | **#15 + #3** eight patterns in one file: the ebook boundary detector, plus magic-loop and mirrored left/right sock shaping |
| 32 | Magic Loop Adult Socks | From the Heart Stitchers | https://fromtheheartstitchers.org/wp-content/uploads/2017/11/magic-loop-adult-socks.pdf | 481,989 (471 KB) | Free charity-knitting pattern, no account | 200 | **#3** a single clean magic-loop sock — "at the same time" shaping and mirrored instructions without the ebook complication of #31 |
| 33 | Knitting Lace Patterns | Interweave | https://www.interweave.com/wp-content/uploads/knitting-lace-patterns.pdf | 3,762,276 (3.6 MB) | Free download, no account; no explicit licence stated | 200 | **#9 + #17** lace charts *and* written row-by-row repeats in one file: a dense symbol grid beside text that says the same thing |
| 34 | Triangular Shawl, Wool Dégradé (EN) | Rico Design | https://www.rico-design.de/wp-content/uploads/2020/04/Triangular-shawl_Wool-D%C3%A9grad%C3%A9_EN.pdf | 190,702 (186 KB) | Free pattern, no account; no explicit licence stated | 200 | **#7 + #19** a German brand's English export — accented filenames, European typesetting, decimal commas in needle sizes (`2,5 mm` must not read as a multi-size list) |
| 35 | Nicoll, knitting (public domain) | Antique Pattern Library | https://www.antiquepatternlibrary.org/pub/PDF/NicollKnitting.pdf | 9,394,119 (9.0 MB) | Public domain original; scan **CC BY-NC-SA** | 200 | **#22 + #3** a committable vintage knitting scan — period UK knitting vocabulary as OCR output |

---

## Cross-stitch (24)

| # | Name | Designer/brand | Direct URL | Size | Licence/terms | HTTP | Exercises |
|---|---|---|---|---|---|---|---|
| 36 | **piggies.OXS** (format sample) | Ursa Software (OXS format docs) | https://www.ursasoftware.com/OXSFormat/piggies.OXS | 148,856 (145 KB) | Sample file published with the open, documented OXS format specification | 200 | **Ground truth.** Not a PDF at all — the reference OXS file from the format's own documentation. The cell-level target the OXS reader is written against, and the only fixture whose correct answer is knowable exactly |
| 37 | Let's Stay Home — **colour** | Satsuma Street | https://satsumastreet.com/s/lets_stay_home_color.pdf | 6,325,512 (6.0 MB) | Free pattern, direct download, no account; no explicit licence stated | 200 | **#10** a modern indie key table (`Symbol / DMC / name / strands / stitches / skeins`) whose column gutters look exactly like page gutters to `findGap` |
| 38 | Let's Stay Home — **black & white** | Satsuma Street | https://satsumastreet.com/s/lets_stay_home_bw.pdf | 3,941,157 (3.8 MB) | Free pattern, no account; no explicit licence stated | 200 | **#5 + #9** the symbol-only twin of #37 — same chart, symbol font instead of colour blocks: the no-ToUnicode case with a known-correct answer from its own colour sibling |
| 39 | Summer's Flight — colour | Satsuma Street | https://satsumastreet.com/s/summers_flight_color_01.pdf | 1,428,171 (1.4 MB) | Free pattern, no account; no explicit licence stated | 200 | **#10** a second colour/B&W pair from the same designer — confirms the key parser is reading the style, not one file |
| 40 | Summer's Flight — black & white | Satsuma Street | https://satsumastreet.com/s/summers_flight_bw_01.pdf | 1,382,050 (1.3 MB) | Free pattern, no account; no explicit licence stated | 200 | **#5 + #9** second symbol-only chart, paired with #39 |
| 41 | Sunshine | Satsuma Street | https://satsumastreet.com/s/sunshine_20.pdf | 2,600,950 (2.5 MB) | Free pattern, no account; no explicit licence stated | 200 | **#4** a small chart to calibrate the "no readable text on this page" threshold against a file that really is mostly picture |
| 42 | Halloween 2015 | Tiny Modernist | https://cdn.shopify.com/s/files/1/0211/0164/files/Halloween_2015-pattern.pdf?v=1620327006 | 3,261,073 (3.1 MB) | Free pattern, no account; no explicit licence stated | 200 | **#10** a second independent designer's key layout, with backstitch listed in its own block |
| 43 | Home Stitch Home | Tiny Modernist | https://cdn.shopify.com/s/files/1/0211/0164/files/P-Home_Stitch_Home.pdf | 489,125 (478 KB) | Free pattern, no account; no explicit licence stated | 200 | **#13** a compact chart with the key set as a narrow sidebar beside the grid |
| 44 | Welcome (freebie) | Tiny Modernist | https://cdn.shopify.com/s/files/1/0211/0164/files/Freebie_Welcome.pdf?v=1748367268 | 1,926,124 (1.8 MB) | Explicitly a freebie, no account; no explicit licence stated | 200 | **#4** lettering chart — mostly grid, minimal prose, a low-confidence case the banner must flag honestly |
| 45 | Matryoshka | Tiny Modernist | https://cdn.shopify.com/s/files/1/0211/0164/files/Matroyshka_Kit-2.pdf?v=1591014720 | 2,302,090 (2.2 MB) | Free kit chart, no account; no explicit licence stated | 200 | **#10** a kit chart — the key carries a skein/kit column most charts do not |
| 46 | Autumn | Tiny Modernist | https://cdn.shopify.com/s/files/1/0211/0164/files/P-_Autumn_pattern.pdf?11656834609694638266 | 648,239 (633 KB) | Free pattern, no account; no explicit licence stated | 200 | **#7** note the bare-number query string on the URL; content-wise a mid-size chart with fractional stitches |
| 47 | Foxy Snowglobe | Tiny Modernist | https://cdn.shopify.com/s/files/1/0211/0164/files/P-Foxy_Snowglobe_f86ebcc3-0639-4405-8f48-c4805c18f4e8.pdf?v=1762967407 | 756,376 (739 KB) | Free pattern, no account; no explicit licence stated | 200 | **#10** backstitch + French knots as separate key blocks — the multi-block key the spec calls for |
| 48 | Orr, Book 14 (cross-stitch) | Antique Pattern Library | https://antiquepatternlibrary.org/pub/PDF/6-TA001.pdf | 41,066,742 (39.2 MB) ▲ | Public domain original; scan **CC BY-NC-SA** | 200 | **#6 + #9 + #22** the biggest chart scan in the batch: size guard, quadratic-grid risk and OCR in one file |
| 49 | Painted tapestry / cross-stitch (A-MH006) | Antique Pattern Library | https://antiquepatternlibrary.org/pub/PDF/A-MH006.pdf | 27,393,043 (26.1 MB) ▲ | Public domain original; scan **CC BY-NC-SA** | 200 | **#6 + #22** a second over-25 MB scan, so the size-guard threshold is tested on more than one file |
| 50 | DMC Point de Marque 1 (French) | Antique Pattern Library | https://antiquepatternlibrary.org/pub/PDF/6-SW007DMCPointMarque1.pdf | 4,430,892 (4.2 MB) | Public domain original; scan **CC BY-NC-SA** | 200 | **#19 + #22** a *French* public-domain chart book — committable non-English text for the language work |
| 51 | DMC Punto de Marca 1 (Spanish) | Antique Pattern Library | https://antiquepatternlibrary.org/pub/PDF/8-DG006DMCPuntoMarca1.pdf | 9,182,499 (8.8 MB) | Public domain original; scan **CC BY-NC-SA** | 200 | **#19 + #22** the *Spanish* sibling of #50 — the same publisher's charts in a third language, all committable |
| 52 | DMC motifs (6-DA015) | Antique Pattern Library | https://antiquepatternlibrary.org/pub/PDF/6-DA015.pdf | 18,486,229 (17.6 MB) | Public domain original; scan **CC BY-NC-SA** | 200 | **#9 + #22** dense motif plates — many small grids per page, the worst possible item ordering for `buildRows` |
| 53 | Nichols (6-AK015) | Antique Pattern Library | https://antiquepatternlibrary.org/pub/PDF/6-AK015Nichols.pdf | 3,067,726 (2.9 MB) | Public domain original; scan **CC BY-NC-SA** | 200 | **#22** a mid-size scan, cheap enough to keep in a fast OCR regression run |
| 54 | HKB 383 (6-DA023) | Antique Pattern Library | https://antiquepatternlibrary.org/pub/PDF/6-DA023HKB383.pdf | 3,050,782 (2.9 MB) | Public domain original; scan **CC BY-NC-SA** | 200 | **#22 + #19** a German-market chart booklet scan |
| 55 | Priscilla Cross Stitch 1 | Antique Pattern Library | https://antiquepatternlibrary.org/pub/PDF/6-JA030PrisCross1.pdf | 5,409,291 (5.2 MB) | Public domain original; scan **CC BY-NC-SA** | 200 | **#22** sibling of the PrisCross scan already in the corpus — a same-series comparison for OCR consistency |
| 56 | Priscilla Cross Stitch 2 | Antique Pattern Library | https://antiquepatternlibrary.org/pub/PDF/6-JA044PrisCross2.pdf | 4,503,550 (4.3 MB) | Public domain original; scan **CC BY-NC-SA** | 200 | **#22** second in the same series, same reason |
| 57 | 7-DG003 | Antique Pattern Library | https://antiquepatternlibrary.org/pub/PDF/7-DG003.pdf | 14,654,162 (14.0 MB) | Public domain original; scan **CC BY-NC-SA** | 200 | **#9 + #22** large multi-plate scan — the page-range picker (#12) needs a file people would actually want to narrow |
| 58 | Free caterpillar charts | The World of Cross Stitching | https://worldofcrossstitching.com/wp-content/uploads/2026/08/Free-caterpillar-cross-stitch-patterns-b27bb4c.pdf | 7,018,576 (6.7 MB) | Free magazine download, no account; no explicit licence stated | 200 | **#15 + #10** a magazine freebie sheet: several small charts in one file, magazine typesetting rather than chart-software output |
| 59 | Alphabets chart | Yarn Tree | https://www.yarntree.com/freecharts/alphabets.pdf | 297,795 (291 KB) | Free chart, no account; no explicit licence stated | 200 | **#5 + #9** an alphabet sheet is nothing but a symbol grid — the densest items-per-page-to-prose ratio in the corpus, and a pure `buildRows` stress test |

---

## Sewing / quilting (12)

| # | Name | Designer/brand | Direct URL | Size | Licence/terms | HTTP | Exercises |
|---|---|---|---|---|---|---|---|
| 60 | West End Jacket — instructions | Peppermint Magazine | https://peppermintmag.com/wp-content/uploads/2026/01/Peppermint-Sewing-Instructions-WestEnd-Jacket-FINAL.pdf | 5,101,939 (4.9 MB) | Free download, no account; the page states **no** terms or licence at all | 200 | **#10** the full indie booklet furniture: body-measurement table, finished-measurement table, and a fabric-requirements table keyed by width × size |
| 61 | Bronte Bathers — instructions | Peppermint Magazine | https://peppermintmag.com/wp-content/uploads/2025/11/PEPPERMINT-60-BRONTE-BATHERS-INSTRUCTIONS.pdf | 8,308,752 (7.9 MB) | Free download, no account; no stated terms | 200 | **#2** swimwear: a heavily numbered construction sequence plus a numbered notions list — the two collide in the bare-number branch |
| 62 | Samford Set (pants) — instructions | Peppermint Magazine | https://peppermintmag.com/wp-content/uploads/2026/01/SewingInstructions-SamfordSet-Pants.pdf | 2,198,698 (2.1 MB) | Free download, no account; no stated terms | 200 | **#15** one "set" pattern split across separate per-garment booklets — the multi-document project shape |
| 63 | Apron — instructions | Peppermint Magazine | https://peppermintmag.com/wp-content/uploads/2023/06/PEPPERMINT-APRON-INSTRUCTIONS.pdf | 7,686,969 (7.3 MB) | Free download, no account; no stated terms | 200 | **#4** a simple make whose booklet is mostly photographs — high page count, low character count, the `emptyPages` calibration case |
| 64 | Apron — **A0 pattern sheet** | Peppermint Magazine | https://peppermintmag.com/wp-content/uploads/2023/06/PEPPERMINT-APRON-A0.pdf | 887,519 (867 KB) | Free download, no account; no stated terms | 200 | **#9 + #4** paired with #63: the *same* pattern as a single giant-format sheet. One enormous page, piece labels and registration marks in near-random Y order — and a page whose physical size alone breaks assumptions |
| 65 | Joyous Picnic Quilt | Art Gallery Fabrics | https://liveartgalleryfabrics.com/wp-content/uploads/2022/01/Joyous-Picnic-Quilt-Instructions.pdf | 2,473,770 (2.4 MB) | Free pattern, no account; no explicit licence stated | 200 | **#10** WOF cutting tables — quilting's table dialect (`cut 4 strips 2½" × WOF`), and quilting never restates its ¼" seam allowance |
| 66 | Cat Walk Quilt | Art Gallery Fabrics | https://liveartgalleryfabrics.com/wp-content/uploads/2021/05/CatWalk_Quilt_Instructions_new.pdf | 2,714,282 (2.6 MB) | Free pattern, no account; no explicit licence stated | 200 | **#10 + #4** a second WOF cutting table plus cutting-layout diagram pages that carry no text |
| 67 | Harmony Quilt | FreeSpirit Fabrics | https://freespiritfabrics.com/product_images/HarmonyQuilt_Harmony.pdf | 8,712,024 (8.3 MB) | Free pattern, no account; no explicit licence stated | 200 | **#10** a third fabric-company quilt house style — fabric-requirement tables keyed by colourway |
| 68 | Triple T Tote | Riley Blake Designs | https://cdn.shopify.com/s/files/1/0578/1841/5283/files/Triple_T_Tote.pdf | 744,624 (727 KB) | Free pattern, no account; no explicit licence stated | 200 | **#10** a bag with a cutting list and interfacing named by branded product code |
| 69 | Swoon Mabel bag | Swoon Patterns / Pellon Projects | https://www.pellonprojects.com/wp-content/uploads/2015/01/swoon-mabel.pdf | 585,545 (572 KB) | Free pattern hosted by Pellon Projects, no account | 200 | **#10 + #2** the **hardware list** fixture: D-rings, swivel hooks, magnetic snaps, rivets, plus branded interfacing codes — a numbered list of things that are not steps |
| 70 | Kids Jogger Pants, sizes **12m–6y** | Tiana's Closet | https://tianascloset.com/wp-content/uploads/2023/05/KIDS-JOGGER-PANTS-SIZE-12M-6Y.pdf | 363,522 (355 KB) | Free pattern, no account; no explicit licence stated | 200 | **#10** the children's **dual-unit size chart** — cm and inches side by side, months/years sizing, and the half of a split size range |
| 71 | Kids Jogger Pants, sizes **7–12** | Tiana's Closet | https://tianascloset.com/wp-content/uploads/2023/05/KIDS-JOGGER-PANTS-SIZE-7-12.pdf | 513,922 (502 KB) | Free pattern, no account; no explicit licence stated | 200 | **#10** the other half of #70 — the same pattern re-tabled for a different size run, so the table parser is checked against a near-duplicate |

---

## Other crafts (6) — graceful-failure fixtures

These exist so the parser proves it stays **quiet** rather than confidently wrong. Every one should
land low on the #8 confidence banner; a high score on any of them is a bug.

| # | Name | Designer/brand | Direct URL | Size | Licence/terms | HTTP | Exercises |
|---|---|---|---|---|---|---|---|
| 72 | Free Weaving Patterns (Handwoven) | Interweave / Handwoven | https://www.interweave.com/wp-content/uploads/0914_WT_HW_Free_Weaving_Patt_ReRelaunch.pdf | 2,203,535 (2.1 MB) | Free download, no account; no explicit licence stated | 200 | **#9 + #8** weaving **drafts** — threading/tie-up/treadling grids of tiny numbers. The single best "dense grid of digits that means nothing to us" test: it must not become rounds |
| 73 | Pocket Stitching Guide | Stitched Stories | https://stitchedstories.s3-us-west-2.amazonaws.com/resources/StitchedStories-PocketStitchingGuide.pdf | 7,000,886 (6.7 MB) | Free resource download, no account | 200 | **#3 + #8** embroidery stitch vocabulary the crochet table has no entry for, in a photo-heavy guide |
| 74 | All the Stitches on One Page | Stitched Stories | https://stitchedstories.s3-us-west-2.amazonaws.com/resources/SS-StitchesOnOnePage2.pdf | 5,923,205 (5.6 MB) | Free resource download, no account | 200 | **#4 + #9** one page, very many small labelled diagrams — an extreme single-page item count with almost no parseable prose |
| 75 | Punch needle transfer sample | Studio Koekoek | https://studio-koekoek.com/wp-content/uploads/2018/12/studio-koekoek-how-to-transfer-punch-needle-pattern-sample.pdf | 620,796 (606 KB) | Free sample from the beginner tutorial page, no account | 200 | **#4** a punch-needle **template** — a traceable outline with essentially no text: extraction "succeeds" with nothing usable, which must produce an honest message |
| 76 | Herwig, Square Knot (macramé) 3 | Antique Pattern Library | https://www.antiquepatternlibrary.org/pub/PDF/HerwigSquareKnot3.nw.pdf | 8,063,301 (7.7 MB) | Public domain original; scan **CC BY-NC-SA** | 200 | **#22 + #3** macramé: knot names and cord-length tables as OCR output, and committable |
| 77 | Riego, tatting | Antique Pattern Library | https://www.antiquepatternlibrary.org/pub/PDF/6-BD002RiegoTatting.pdf | 6,691,183 (6.4 MB) | Public domain original; scan **CC BY-NC-SA** | 200 | **#22 + #8** tatting — a craft whose notation superficially *resembles* crochet (rings, chains, picots, joins). The most dangerous confident-wrongness case in the batch |

---

## Priority order — the first 15 to wire into the fixture pages

All 76 are already local, so this is a **work order**, not a download queue: the 15 below buy the
most new coverage per file and are the ones to add to `test/patterns.fixtures.html`,
`test/xstitch.fixtures.html` and `test/sewing.fixtures.html` first.

| Rank | Local filename | Bytes | Why first |
|---|---|---|---|
| 1 | `crochet-kingcole-festival-uk.pdf` | 19,856,627 | The UK-terms gap (#3) is the largest single vocabulary hole, and this is half of a matched pair |
| 2 | `crochet-kingcole-festival-us.pdf` | 19,852,751 | Its US twin — the only free ground-truth dialect pair in the batch |
| 3 | `crochet-bernat-basketweave.pdf` | 777,994 | Post stitches (#3): a whole product category currently parses to `computed: null` |
| 4 | `crochet-bernat-lace-cardigan.pdf` | 627,227 | The brand shaping table (#10) — the failure most likely to appear in the first ten brand imports |
| 5 | `crochet-lionbrand-logcabin-pullover.pdf` | 1,432,013 | The narrow-sidebar geometry case (#13), where *every* round currently disappears |
| 6 | `xs-ursa-piggies.oxs` | 148,856 | The OXS reader's ground truth — the one fixture with an exactly knowable answer |
| 7 | `xs-satsuma-stayhome-color.pdf` | 6,325,512 | A modern indie key table (#10); the corpus has no post-2020 indie chart |
| 8 | `xs-satsuma-stayhome-bw.pdf` | 3,941,157 | Its symbol-only twin — the no-ToUnicode case (#5) with a known-correct sibling |
| 9 | `crochet-apl-weldons-K-WK013.pdf` | 42,238,204 | The OCR headline (#22) and the size guard (#6) in one committable public-domain file |
| 10 | `crochet-gosyo-lace-doily.pdf` | 580,235 | Fullwidth digits and chart-only pieces (#7, #17) |
| 11 | `crochet-allfree-stitches-ebook.pdf` | 2,426,719 | Multi-pattern ebook + TOC phantom rows (#15, #2) |
| 12 | `sew-peppermint-westend-jacket.pdf` | 5,101,939 | The complete indie sewing table set — size, finished, fabric-by-width (#10) |
| 13 | `knit-sandnes-0216.pdf` | 18,946,752 | Opens the knitting module: spread-imposed booklet, lettered charts, size tables |
| 14 | `other-weaving-handwoven.pdf` | 2,203,535 | The graceful-failure benchmark — a dense grid of digits that must not become rounds (#9, #8) |
| 15 | `xs-apl-orr-book14.pdf` | 41,066,742 | The largest file in the batch: size guard, quadratic grid and OCR together (#6, #9, #22) |

**Total for the top 15: 165,526,263 bytes (157.9 MiB / 165.5 MB).**

---

## Dead ends and gated sources

Recorded so nobody spends the afternoon re-finding them. The first item was verified in this pass;
the rest are as reported by the sourcing workers and were not independently re-checked here.

- **Lion Brand Tunisian Entrelac Throw** — *verified dead.* The `cdn.accentuate.io` URL returns
  HTTP 200 with a 63 KB **HTML** body, not a PDF. This was the intended Tunisian-vocabulary fixture
  (tss/tks/tps, forward and return pass); that gap is still open. Lion Brand's other free patterns
  on the same CDN do work — see candidate #5 — so the host is fine and this specific object is not.
- **DROPS / Garnstudio** — no direct PDF anywhere. Patterns are HTML pages with a print view, and
  the language is selected by a `cid` query parameter on `pattern.php` (one `cid` per language), so
  the "same pattern in EN/DE/ES/FR/NO" idea has to be built by printing each `cid` to PDF by hand
  rather than downloaded. The site also refuses automated fetches (403). This is why the batch
  contains **no** DROPS file, and why failure mode **#23** (one publisher, many languages, lettered
  diagram references) remains untested. Worth doing manually later — it is still the canonical case.
- **Artecy** — free charts rotate monthly and sit behind a free account, so any URL recorded today
  is wrong next month. Not worth a fixture; if one is ever wanted, grab it on the day.
- **Sinclair Patterns / Maison Fauve projector files** — the layered projector PDFs (optional
  content groups plus a 10 cm calibration grid) are the structurally novel sewing format we most
  want, and neither site exposes one as a plain link. Still uncovered.
- **DMC and LoveCrafts free patterns** — both route downloads through an add-to-basket / checkout
  flow rather than a file URL. We already hold three DMC charts from an earlier manual pass, so this
  costs us nothing for now.
- **Hobbii** — serves pattern PDFs from presigned, time-limited URLs, so nothing from Hobbii can be
  recorded as a durable fixture URL. The one Hobbii file in `tmp-pdf/`
  (`crochet-hobbii-amarah-en.pdf`, fetched by hand on 2026-09-18) has to be re-grabbed through the
  site if it is ever lost. Keep it: Hobbii's generator is the letter-spacing offender the
  `pageLooksSpaced` repair was written for, and this is the second independent sample of it.

## Still uncovered

The gaps this pass did **not** close, roughly in order of how much they would teach us:

1. **A video-timestamp companion pattern** — the `3:40 Attaching the head` shape that detonates the
   bare-number branch (#2). Nothing free and directly linkable was found; YouTube crocheters tend to
   put these behind Ko-fi or a mailing list.
2. **A Canva-export garble case** (#5) — our worst silent failure still has no real sample. Note
   brainstorm 06's own answer: the owner writing a pattern and exporting it from Canva is both
   cheaper and *committable*, and beats any amount of searching.
3. **A true 9+-size indie garment** with "repeat until it measures" (#10, multi-size lists). The
   brand cardigans here carry 4–7 sizes; the 9–14-size indie grading that actually breaks things is
   almost all paid.
4. **Dutch and Spanish patterns from living designers** (#19). The batch has German and French, but
   only as public-domain *scans* — so they arrive through OCR, which conflates #19 with #22. Modern
   born-digital `v/hv/st` and `pb/pa/aum` text is still missing.
5. **A projector-layered PDF** (#4, #12) — see the Sinclair/Maison Fauve note above.
6. **A modern tiled multi-page cross-stitch chart with overlap markers** and an A1/A2/B1 page index
   (#12). The free indie charts here are all small enough to be single-page; the tiled-with-overlap
   convention is a paid-chart habit.
7. **A 25 MB+ *sewing* file** (#6). The oversize files in this batch are all scans and charts; the
   sewing size-guard case — a tiled garment pattern at 60–100 MB — is not represented, and sewing is
   where real users meet it.
8. **Tunisian crochet** (#3) — collateral damage from the one dead URL above.

Note on 2, 3 and 4: brainstorm 06 items 9 and 10 already argue that owner-authored patterns pushed
through several exporters buy more geometry coverage than more searching will, and are the only
files that can be committed. Gaps 2 and 3 in particular look more like a morning in Canva than a
research problem.

## Verified by the five research workers (HEAD/GET checks on 2026-09-18)

- DROPS / Garnstudio publishes no PDF at all. Pattern pages are HTML; print is an HTML view at includes/pattern-print.php?id=PATTERN&cid=LANG followed by window.print(). cid is the language id: 19 English UK units, 17 English US units, 9 German, 23 Spanish, 8 French, 1 Norwegian, 3 Danish, 4 Italian, 7 Dutch, 5 Polish, 12 Swedish, 11 Finnish, 28 Portuguese. Both English variants use US stitch names, so DROPS is not a UK-terms source. The site sits behind a Cloudflare challenge, so only a real browser loads it; a DROPS fixture must be print-to-PDF by hand. Golden Garden (id 9698) was confirmed in five languages with the A.1 to A.4 diagram references preserved in each.
- Hobbii has no stable PDF URL: the download button calls a GraphQL query PatternBySkuPdf(sku, language) that returns a presigned S3 link valid for one hour; the same pattern ships in eleven languages. The Amarah shawl was saved through the browser during scouring (crochet-hobbii-amarah-en.pdf).
- Artecy free charts need a free account (no payment details), are PCStitch-generated black-and-white symbol charts with a page-layout diagram, and the free set rotates monthly.
- DMC's own site serves pattern PDFs only through a basket flow; the old direct media paths now redirect and 404. LoveCrafts free DMC PDFs are basket plus account.
- Sinclair Patterns and Maison Fauve publish free patterns with projector files behind a zero-price Shopify checkout; Love Notions additionally requires a Facebook group. Mood Sewciety is email-gated.
- Interweave / Long Thread Media files under interweave.com/wp-content/uploads are served openly even though their landing pages are email-gated; neighbouring files sometimes 403, so the openness is inconsistent.
- Studio Koekoek hotlink-protects its PDFs: HEAD returns 403, a GET with a Referer of the pattern page works.
- Pattern Keeper compatibility is a real selling point (Etsy market pages, designer collections titled "Pattern Keeper Compatible"); Markup R-XP markets the opposite ("any PDF, no special formatting"). Sewing's compatibility problem is already solved at read time by the free Pattern Projector PWA.
- Etsy free listings cannot be fetched directly (checkout flow) and Etsy's mobile app cannot download digital files at all; that is where Canva-export garble lives, so that class remains uncovered by direct download.
- Lion Brand PDFs live on cdn.accentuate.io and serve to plain curl; the product pages are JS-rendered and the old cdn.lionbrand.com host is dead. Yarnspirations, King Cole (trailing slash required), Stylecraft, Premier, Furls, Satsuma Street, Tiny Modernist, Peppermint, Art Gallery Fabrics, FreeSpirit, Riley Blake, Pellon and the Antique Pattern Library all serve direct PDFs.
