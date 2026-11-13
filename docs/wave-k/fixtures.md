# Wave K fixtures (fixtures worker)

Status: DONE for this wave (2026-11-12). 76 new files landed in `tmp-pdf/` (23 cross-stitch,
20 sewing, 32 knitting, 1 crochet). Where each file came from and its terms: `tmp-pdf/SOURCES.md`,
section "Added 2026-11-12". Manifest, script and log: `tmp-pdf/fetch-2026-11-12.{txt,sh,log}`.
Every file was checked: it opens as a PDF, ends with `%%EOF`, is under 40 MB, and is the pattern
named. Everything in `tmp-pdf/` is copyrighted and for personal test use: read it at runtime,
never commit it, and skip cleanly when a file is absent.

Column key: **p** = pages, **text** = characters in the text layer (from pdftotext). "0 text"
means a picture-only file.

## Cross-stitch (23)

| File | p | text | What it tests (wish) |
|---|---|---|---|
| xs-wocs-robin.pdf | 1 | 1.2k | **DMC / Anchor / Madeira triple key**, vector **backstitch + French knots**, "Contains fractionals", 40x79 |
| xs-wocs-floral-bunting.pdf | 4 | 7.2k | backstitch in 1 and 3 strands, French knots, **Mill Hill beads** as an extra key section |
| xs-wocs-teatime-clock.pdf | 2 | 8.0k | 128x128, French knots, triple key |
| xs-wocs-alphabet.pdf | 3 | 15k | **sampler alphabet**, triple key |
| xs-wocs-kawaii.pdf | 2 | 8.2k | 99x98 dense motifs (closest we have to full coverage) |
| xs-wocs-animals.pdf | 2 | 6.5k | several motifs on one chart, 81x125 |
| xs-wocs-new-baby.pdf | 1 | 2.7k | key plus embedded photos (2 MB) |
| xs-gathered-backstitch-alphabets.pdf | 1 | 0 | backstitch-only alphabets, **no text layer**: the "nothing to read" case |
| xs-anchor-{new-home,holiday-sampler,monarch-butterfly,tea-time,halloween-sampler,gardening}.pdf | 3 each | ~2.1k | **Anchor-only keys** (4-digit numbers: `0400 0398 0001 1066`), samplers, backstitch. Key symbols and chart are graphics: the key text gives only the numbers in a column, with no symbol characters |
| xs-fqs-celebration-sampler.pdf | 5 | 2.3k | 138x172 sampler over 5 pages, key in **AuriFloss** numbers (not DMC) |
| xs-fqs-moonbeams.pdf | 6 | 3.7k | 104x104, **dual DMC + Classic Colorworks** key |
| xs-fqs-little-quaker-abc.pdf, xs-fqs-little-quaker-christmas.pdf | 1 | 0 | **sampler alphabets as a single picture** (made in Photoshop) |
| xs-fqs-current-mood.pdf | 1 | 0 | single picture (Acrobat image conversion) |
| xs-fqs-tree-name.pdf | 1 | 0 | "Microsoft: Print To PDF": one page built from 13 picture tiles |
| xs-fqs-haunted-halloween.pdf | 6 | 3.8k | multi-page stitch-along, backstitch |
| xs-fqs-granny-square.pdf | 2 | 2.1k | Lori Holt stitch-along, 37 images |
| xs-oxs-xspro-additions.pdf | | | Ursa's note on the extra OXS fields that DP Software's Stitch Pro writes (format documentation, not a chart) |

## Sewing (20)

| File | p | text | What it tests (wish) |
|---|---|---|---|
| sew-tianas-margo-top-A0.pdf + sew-tianas-margo-top-A4.pdf | 1 / 17 | | **A0 sheet paired with its print-at-home file**, **layered** women's top XXS-5XL (11 layers) |
| sew-tianas-colette-dress-A0.pdf + sew-tianas-colette-dress-A4.pdf | 2 / 27 | | the same for a women's dress |
| sew-peppermint-albion.pdf | 24 | 24k | **cutting list inside the booklet** ("Cuff, cut x2 pair + interfacing"), women's, metric first |
| sew-peppermint-belle-shirt.pdf | 19 | 21k | shirt booklet, 194 images |
| sew-peppermint-rozelle-slip.pdf | 19 | 18k | slip, interfacing |
| sew-peppermint-somerset-dress.pdf | 11 | 0.7k | **instructions are pictures of text**: OCR case, a graceful-failure case |
| sew-shannon-cuddle-robe.pdf | 6 | 13k | garment cut from rectangles, cutting diagrams and **nap direction** in the booklet, S/M/L + "Curvy" |
| sew-shannon-wrap-adult-child.pdf | 4 | 12k | adult + child sizes, nap |
| sew-shannon-cozy-tote.pdf | 2 | 4.9k | bag with notions |
| sew-moda-quick-sew-bag.pdf | 2 | 3.6k | bag with notions |
| sew-moda-charm-monday.pdf | 2 | 2.2k | **fat-quarter requirements** + 140 **flying-geese** rectangles and 280 squares |
| sew-moda-courtyard.pdf | 6 | 5.4k | stars + flying geese, 300 squares, WOF cutting |
| sew-moda-mfcim-sampler.pdf | 46 | 32k | **block of the month**, 20 numbered blocks, **HSTs**, per-block cutting charts |
| sew-fqs-bsb-block4-flying-geese.pdf, sew-fqs-bsb-block5-hst.pdf, sew-fqs-bsb-finishing.pdf | 2 / 1 / 4 | | **block-of-the-month sheets** (Bella Skill Builder), flying geese, HST, finishing/layout |
| sew-moda-cfac-love.pdf | 4 | 0.1k | block sheet that is **nearly all picture** (71 images): a layout given as a picture only |
| sew-moda-quilt-blocks.pdf | 1 | 0 | pure picture page |

## Knitting (32)

| File | What it tests (wish) |
|---|---|
| knit-stitchmastery-{dash,dashcable,dot}-font.pdf, knit-stitchmastery-using-fonts.pdf | **knitting symbol font**: every glyph of the Stitchmastery fonts, set in the embedded font, with key / decimal / hex / suggested-use columns. Ground truth for a glyph-to-stitch map. Not a pattern (see "not found") |
| knit-sandnes-bursfjell-yoke.pdf | **stranded colourwork round yoke**, 6 sizes, **cm only, translated from Norwegian** (closest to DROPS style) |
| knit-sandnes-ask-yoke-child.pdf | round yoke, child sizes, metric |
| knit-sandnes-bernies-mittens.pdf | **Fair Isle mittens** with colour chart, metric |
| knit-sandnes-cable-hat-mittens.pdf | **hat in the round** + cabled mittens, metric |
| knit-sandnes-charlie-set.pdf | cardigan + **cuff-down** baby socks + more, several patterns (7A/7B/7C) in one file |
| knit-sandnes-rib-sweater.pdf | "Falsk patent" = mock-brioche rib raglan (not true brioche) |
| knit-cascade-color-yoke.pdf | **colourwork yoke**, 6 sizes S-3XL, imperial, yoke chart + photo |
| knit-cascade-mens-retro-fairisle.pdf, knit-cascade-nordic-set.pdf | Fair Isle sweater; hat + mittens |
| knit-patons-northern-fairisle-hat-mittens.pdf, knit-redheart-fair-isle-hat.pdf, knit-patons-fair-isle-sock.pdf | Fair Isle hat + mittens, a hat, a sock (the sock's page is a small 387x603 page) |
| knit-cascade-intarsia-skirt.pdf | **flat intarsia charts** |
| knit-cascade-brioche-cowl.pdf, knit-patons-brioche-pullover.pdf | **brioche** (two-colour cowl; 8-page pullover) |
| knit-redheart-lacy-toeup-socks.pdf | **toe-up** socks, 3 shoe sizes |
| knit-cascade-fisherman-sock.pdf, knit-cascade-basic-socks.pdf | **cuff-down** socks with heel flap |
| knit-cascade-shetland-shawl.pdf, knit-cascade-japanese-lace-shawl.pdf | **lace shawls with charts** |
| knit-cascade-aran-pullover.pdf, knit-cascade-cable-yoke.pdf | **cabled sweaters with charts** (cable yoke: 7 sizes XS-3XL) |
| knit-cascade-saddle-cardigan.pdf | **"at the same time" neck + armhole** on the Left Front, then "Right Front: work as for left front, **reversing shaping**" (knitting P6/P12) |
| knit-cascade-heathers-cardigan.pdf | both fronts written in full, each with AT THE SAME TIME (the mirrored ground truth) |
| knit-cascade-colorwork-cardigan.pdf | colourwork cardigan worked in one piece, "AND AT THE SAME TIME" neckline, 6 sizes |
| knit-redheart-season-cardigan.pdf | cardigan with "reversing shaping" |
| knit-cascade-topdown-raglan.pdf | **top-down raglan**, women's and men's sizes |
| knit-cascade-cabled-raglan-cardigan.pdf | seamed baby cardigan, 5 sizes |

Units: Sandnes files are metric only; Cascade and Yarnspirations files are imperial first.

## Crochet (1)
- crochet-sandnes-scarf.pdf: small crocheted scarf. I took it as a knitted shawl by mistake and kept it.

## Not found free and legitimately (owner can supply, sign up or buy)

| Wish | Status / candidates |
|---|---|
| **Projector file paired with its print file** | Not found as a plain link. Tiana's Closet newer posts (2024+, e.g. Flora dress https://tianascloset.com/index.php/product/flora-v-neck-ruffle-hem-dress/) include projector files but go through a WooCommerce $0 cart. Maison Fauve Cédrat camisole (free; A4/A3/A0/projector) is a $0 checkout: https://www.maison-fauve.com/en/products/patron-pdf-gratuit-couture-caraco-cedrat-pdf-a4-a3-a0-us-letter-cadres-calques-par-taille-videoprojection. Peppermint pattern files now need a code from the magazine. Paid: Winslets patterns (~US$7.99, A4/A0/projector). |
| **FlossCross PDF + OXS pair** (still owed) | No free published pair exists. The owner makes it at https://flosscross.com/designer/ (export both). Charlotte Badger's free "Fox CB18" includes an .oxs file but is a Patreon post: https://www.patreon.com/CharlottePatternLab/posts/free-cross-fox-139361945 (may need a free Patreon login). Stitch Fiddle exports PDF + OXS (free account). |
| Charts from other chart software (PCStitch, WinStitch/MacStitch, Stitch Fiddle, StitchMate) | None found with an identifiable producer. The FQS files say only InDesign / Photoshop / "Print To PDF". The owner could export one from Stitch Fiddle's free tier or the MacStitch/WinStitch demo. |
| A real pattern **set in a knitting font** | None found in about 40 publisher PDFs checked (Cascade, Patons, Red Heart, Sandnes, Berroco and Interweave all draw charts as pictures or vectors). Only the Stitchmastery reference sheets arrived. Candidates: Tin Can Knits Flax (Ravelry download), any indie designer's Stitchmastery-exported PDF on Ravelry (free Ravelry account). |
| **Two-at-a-time socks** | Knit Picks "Two at Once, Toe Up, Magic Loop Socks" (free, but the download redirects to login): https://www.knitpicks.com/two-at-once-toe-up-magic-loop-socks-free-knitting-pattern/p/50631. KnitFreedom (free beginner sock patterns, sign-up gated; 403 to curl). Mina's Two At A Time Socks (free Ravelry download). |
| **DROPS** cm-only pattern | garnstudio.com returns 403 behind a Cloudflare check; not circumvented. The owner can open any DROPS pattern in a browser and use "Print" to save a PDF (DROPS allows personal use). Sandnes Bursfjell / Ask stand in (metric, translated). |
| **DMC <-> Anchor <-> Madeira table with an open licence** | None found. The GitHub repos (cheshire137/cross-stitch-color-conversion, TheRealTenkoshi2020/floss-fox, HoangEditor/embroidery-floss-matcher, dv83/cross-stitch-master) have **no licence**, so all rights are reserved. Cstitch (kleintom/Cstitch) is GPL-3.0 but has floss colours, not conversions. No manufacturer conversion PDF was found from DMC, Anchor / Coats / MEZ, or Madeira. Usable instead: the 8 WOCS charts each carry a real DMC/Anchor/Madeira triple per colour (factual pairs to check against). Web tables without a licence: https://lordlibidan.com/embroidery-thread-conversion-table/, https://www.cyberstitchers.com/stitching_tools/floss_conversion_charts |
| Chart split as pictures over 4+ pages | Partial: xs-fqs-celebration-sampler (5 pages, 6 images) and xs-wocs-floral-bunting (4 pages) need checking for whether the chart really continues across pages. The FQS Midsummer Star Trio (8 pages, 52 images) is 62.7 MB, over the cap: https://www.fatquartershop.com/midsummer-star-trio-free-cross-stitch-pattern-count-your-stitches |
| Full-coverage chart | Not found free. The closest are the kawaii (99x98) and teatime clock (128x128) charts. |
| Indie booklet with a **nap column** in its cutting list (Closet Core / Grainline style) | Email-gated (Closet Core, Grainline, Helen's Closet, Mood Sewciety's email form, Fabrics-Store). Shannon Robe and Peppermint Albion stand in. |
| Anchor freebies on Wool Warehouse / LoveCrafts; the DMC capital alphabet | Basket or account flow; the Wool Warehouse media link returned 404. |
| Yarnspirations brioche scarf (Caron) | Product page stayed rate-limited (HTTP 429). The site rate-limits heavily: wait 60 s or more between page loads. |

## Surprises a parser worker should know
- **Encrypted PDFs**: all four `sew-tianas-margo/colette-*` files carry an owner password ("restricted permission"). They open and extract without a password. pdf.js should cope; check that no code path refuses an `/Encrypt` file.
- **Layers**: the same four files have 11 optional-content groups (one per size). This is real data for the sewing P1/P5 "pass an optional-content config to renderPage" ask.
- **Picture-only files (0 text)**: xs-gathered-backstitch-alphabets, xs-fqs-little-quaker-abc / -christmas, xs-fqs-current-mood, xs-fqs-tree-name (13 tiles on one page), sew-moda-quilt-blocks. Near-empty: sew-moda-cfac-love (114 chars), sew-peppermint-somerset-dress (746 chars over 11 pages, instructions as pictures of text).
- **Moda fractions are lost**: `2½"` comes out as `21/2"` and `¼"` as a replacement character (`�`), because the fraction glyphs have no Unicode mapping. "From 70 cut 140-2�"x4�"" is typical. A size parser must not read `21/2` as 21.
- **WOCS charts set their symbols in embedded fonts** ("Charting-Symbols", "New", "New7"). The text layer holds the whole symbol grid as letters (`nlZl9999MMM`) next to the key. That suits a glyph-template reader, but chart rows interleave with key rows in reading order.
- **Anchor keys on Yarnspirations**: the colour numbers sit in one column with no symbols in the text (the symbols are pictures), and the materials line repeats them with no separators: `0400 0398 0001 1066 ...`. Anchor numbers have leading zeros; do not strip them into DMC-looking numbers.
- **Sandnes text** has broken spacing in headings ("I NST RU C T I ON: ANI TA B RAT H E T L AND") and mojibake where the Norwegian letters should be (`F�lg oss`). Several patterns share one file (knit-sandnes-charlie-set has 7A/7B/7C).
- **Page sizes vary**: Shannon Fabrics and Patons are landscape Letter (792x612), Sandnes Bursfjell is 595x788, the Patons Fair Isle sock is 387x603, and the Little Quaker samplers are odd picture-sized pages (621x801, 630x810).
- **Cascade**: charts are pictures, text uses Calibri/Garamond, sizes look like `XS (S, M, L, XL, XXL, 3XL)` with commas inside the parentheses, and each file ends with a "© 20xx Cascade Yarns - All Rights Reserved" line.
- **Sizes of files**: all are under 7 MB except sew-moda-mfcim-sampler (5.5 MB, 46 pages) and knit-sandnes-rib-sweater (6.2 MB, 2 pages of large photos).
