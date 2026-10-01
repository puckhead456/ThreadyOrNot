# Wave E: sewing and quilting ground-truth audit (`sewing-audit`)

**Scope.** All 16 `tmp-pdf/sew-*.pdf` files: the Pattern Runway skirt and sundress (plus their tiled sheets), the Peppermint bathers, jacket, pants, apron and apron A0 sheet, the AGF Joyous Picnic and Catwalk quilts, the FreeSpirit Harmony quilt, the Riley Blake tote, the Swoon Mabel bag, and both Tiana's jogger sheets.

**How each file was checked.**
1. Ground truth was written from the PDF itself: the page images where the Read tool could render them, and `pdftotext -layout/-raw -enc UTF-8` to stdout. Several pages are image-only; the Westend booklet, the apron (p4-7) and parts of the bathers were read by OCR.
2. `Sewing.parse` was run on the same file through `PdfText.extract` (`test/sewing.fixtures.html`).
3. The two results were compared line by line.
4. The app itself was checked at 375×812: New project → Sewing → ⋯ → Import pattern, for the sundress, Harmony, Mabel and apron.

**Files changed** (only files I own):
- `js/sewing.js`
- `js/app-sewing.js`
- `test/sewing.test.html`
- `test/sewing.fixtures.html`

**Suites** (all green, re-run after the last edit):

| Suite | Before | Now |
|---|---|---|
| sewing | 803 | **871 / 0** |
| sewing.fixtures | 682 | **752 / 0** (with a fresh extraction, not the session cache) |
| crafts | 124 | **124 / 0** |
| templates | 94 | **94 / 0** |

`js/pdftext.js` changed several times while this audit ran (the extractor agent's work). Every parser rule below was re-checked against the latest extraction, and the fixture page was re-run with its session cache cleared.

---

## Discrepancy table

In the Fixed column, "assert" names the assertion: *F:* is in `sewing.fixtures`, *U:* is in `sewing.test`, and every name starts with "audit:".

| # | Fixture | Part | What the PDF says | What the app said | Fixed? / assertion |
|---|---|---|---|---|---|
| 1 | pencilskirt | size chart | Bust `84cm/33"` | `84cm/3"`: a doubled digit after an ASCII slash was collapsed as if it were faux-bold art | ✔ F: "the Bust inch value keeps both digits"; U: "a dual-unit value keeps a doubled digit" |
| 2 | pencilskirt, sundress, Swoon, bathers | long steps | Step 6 runs about 1,500 characters and ends "Hand sew or blind stitch the hem." | Cut at 800 characters with "…", so the end of the instruction was lost | ✔ The step now carries on to a "(continued)" card, splitting at a sentence (at most three cards). F: "no step is cut short"; U: "a 1,000-character step becomes two cards" |
| 3 | pencilskirt | last step | Page 9 is the back cover | Once the text was no longer cut short, the back cover's web address and copyright showed up glued onto step 6 | ✔ F: "the back cover is not glued onto the last step" |
| 4 | sundress | numbering | Step "4. Waistband:" contains SHELL/LINING; "5. Skirt:" contains POCKETS | SHELL, LINING and POCKETS were all numbered 3 | ✔ F: "SHELL / LINING are step 4 and POCKETS step 5"; U: "SHELL / LINING under a demoted …" |
| 5 | sundress | step 4 LINING | Continues past the "Lining" figure caption (p7: "Press seams open. With right sides…") | That text was dropped entirely | ✔ A caption set like a heading inside a running step no longer ends it. F: "the LINING paragraph keeps the prose…"; U: "a caption set like a heading does not end the step" |
| 6 | sundress | variations | 4 variations, then the logo and web address | The logo line "E S T . 2 0 1 1 www…" was glued onto variation 4 | ✔ F: "the logo and web address are not glued…" |
| 7 | sundress (HANDOFF 5) | fabric | `LINING 1m / 1 yd` has no bolt width | The parser already kept it (Wave 1). **In the app** it read "at this width · LINING" | ✔ The Fabric sheet now reads "LINING · any width". F: "(HANDOFF 5) the LINING row … reaches the chosen size" |
| 8 | sundress | app header | 8 printed steps (11 cards) plus 4 optional variations | "Step 1 of 15", the variations were counted in the %, and you had to tick the variations to finish | ✔ Header now "Step 1 of 11". The % and "finished" count construction steps only; variations show as "Optional extra n of 4". U: "the summary says step 1 of 2" |
| 9 | Samford | steps | 15 steps; step 14 wraps as "…drawstring made in / Step 1 through buttonhole openings" | "Step 1 through…" became a new step 1 under "Section 2", and step 15 (Hem) was lost | ✔ F: "steps 1-15, the hem included"; U: "Step 1 through… continues the running step" |
| 10 | Samford | sections | MAKE AND ATTACH WAISTBAND, INSERT AND SECURE ELASTIC | "Make And At Tach Waistband", "Insert And Secure El Astic" (extraction splits the words at kerning pairs) | ✔ Parser rejoins them. F: "kerning-split headings are joined"; U: "AT TACH reads as Attach" |
| 11 | Samford | notions | `2" (5cm) Elastic`, Thread, tear-away interfacing; tools listed separately | The elastic was missing. The old fixture passed only because "Bodkin … pull elastic through" contains the word | ✔ Elastic now listed. F: "the 2" elastic itself is on the notions list". Interfacing is still missing (see Still wrong) |
| 12 | Samford | fabric | A size-group × width grid of TOP/SHORTS/PANTS in metres and yards | 4 rows named "Meters" / "Sizes A-h" with a width and no amount | ◐ Those rows are dropped and the warning now says "The fabric requirements table could not be read". F: "no fabric row is a bolt width with no amount", "either read or reported as unreadable"; U: "width-only rows…". The grid itself is not read (see Still wrong) |
| 13 | bathers | cutting | 14 pieces; the briefs' outer and lining front/back repeat the top's names | 13 rows. The 4 briefs pieces were de-duplicated away, and 3 non-pieces ("length of 6mm … elastic", "Bikini Top Edge Elastic", "Elastic Chart") were counted | ✔ 14 rows, each labelled with its group. F: "fourteen cutting rows", "the briefs front and back … are not merged", "no elastic length is a piece"; U: "top front and briefs front are both kept", "an elastic length is not a piece" |
| 14 | bathers | fabric | "Outer swim fabric" and "Swimwear lining", each in metres and yards across 4 size groups; `1 1/8 yard` | 4 rows named "Outer swim Metres" / "fabric Yards" / …, with "11/8 yard" | ✔ 2 rows, e.g. "0.9 m / 1 yard", with fractions read as 1 1/8. F: "two fabrics, each with metres / yards", "11/8 yard reads as 1 1/8"; U: "metres and yards lines are one fabric" |
| 15 | bathers | notions | Narrow elastic (5 m XS-5X / 6 m 6X-9X), wider elastic (1 m / 1.2 m), sliders, rings, foam bra cups | Only sliders and rings; rings typed as a notion, cups as interfacing | ✔ 5 items; elastic lengths grouped by size; rings are hardware, cups a notion. F: "both elastics…", "cups are not interfacing"; U: "the elastic and its per-size lengths are one item" |
| 16 | bathers | sections | 10 top steps, then 5 briefs steps (numbering restarts) | Sections were diagram and chart labels ("Centre Front Stitch Line", "Waistband Elastic Chart", "Section 2") | ✔ Briefs steps sit under "Bikini Briefs", taken from the page's running head. F: "the briefs are a named section…"; U: "sewing instructions - bikini briefs names the section" |
| 17 | bathers | size chart | The body chart is on p5 (scrambled in extraction); p15–21 hold 4 per-size **elastic** charts | The top-edge elastic lengths were shown as the **body** chart ("CM 38 42 46…") | ✔ Elastic charts are named after their chart ("Bikini Top Edge Elastic · cm", "Elastic 12mm · cm", …) and never shown as body measurements. F: "the elastic-length charts are not shown as body measurements"; U: "elastic lengths are not body measurements" |
| 18 | apron | steps | 4 "Let's get cooking" paragraphs, 2 intro paragraphs, then Classic / Slant / Pouch pocket and Holster paragraphs; each pocket has an ALL-CAPS dek | Deks were counted as steps ("Classic pocket THE CLASSIC POCKET…"), and the dek tails became sections ("Too Cute", "In Some Secateurs") | ✔ 16 steps; sections are the pocket names. F: "no step is a capitals magazine dek", "the pocket names are the sections"; U: "the capitals dek lines are not steps" |
| 19 | apron | notions / fabric | 6 needs items, including "1m of fabric (minimum 60cm width)", Scissors, Sewing machine and thread, Tape measure | Pattern line split in two at "– see page 108)"; the three tools were missing; the fabric was listed as a notion | ✔ 5 notions plus 1 fabric row at 60 cm. F: "the wrapped see page joins", "…tape measure", "1m of fabric … is the fabric row"; U: "Scissors / Tape measure one per line stay" |
| 20 | apron (coordinator) | home card | No cutting list in the booklet. The A0 sheet labels APRON BODY (place on fold) and 4 pockets, with **no quantities** | "apron · step 1 of 16 · 0 of 5 cut": the 5 were the Garment template's placeholder pieces, not notions | ✔ An import that finds no cutting list removes untouched template placeholder pieces, and notions the same way. Checked in the app: "apron · step 1 of 16", "No cutting list yet". U: "an import that found no cutting list clears the placeholder pieces", "…also when the import sheet left the empty group unticked", "Just keep the text changes nothing else", "a placeholder the user already ticked stays" |
| 21 | AGF Joyous | name | Title is cover artwork | "f r e e p a t t e r n", later "QUILT DESIGNED BY" | ✔ Name is blank. F: "a letter-spaced free pattern or a credit is not the name"; U: same |
| 22 | AGF Joyous, Catwalk | fabric | BINDING FABRIC "Fabric A … (Included)"; BACKING FABRIC "FUS-P-1205 5 ½yds" | A 12th fabric with no amount, and a 13th named only by its code | ✔ Now "Binding — Fabric A …: included" and "Backing — FUS-P-1205: 5 1/2 yds". F: "the binding and backing rows say what they are"; U: same |
| 23 | AGF Joyous | steps | 16 bullets, including "Set aside" and p6 "Join rows 1-8." | 13 steps (short bullets merged or dropped) | ✔ 16. F: "sixteen bullets…"; U: "set aside and Join rows 1-8. are bullets of their own" |
| 24 | AGF Joyous, Catwalk | step sections | CONSTRUCTION / QUILT ASSEMBLY / BINDING | "DIAGRAM 1" / "DIAGRAM 2" were used as sections, and a stray repeated "QUILT ASSEMBLY" after BINDING reset the section | ✔ F (Catwalk): "no diagram label or fabric group is a section"; U: "a repeated section heading and DIAGRAM 1 leave the section alone" |
| 25 | AGF Catwalk | cutting / steps | 64 cut lines, 34 bullets | While the extractor dropped the double-printed headings (see pdftext notes): **0 cut rows**, the 64 lines read as fabric, and the construction bullets were lost | ✔ Robust whether or not the headings survive: a bulleted "… from fabric A" line inside the yardage block opens the cutting table, and "- Take …" / "Sew all …" opens construction. F: "all sixty-four cutting lines", "thirty-four bullets", "eighteen fabrics, the binding and the backing" |
| 26 | FreeSpirit | fabric | 16 fabrics A–P (design, colour, item id, yardage) plus 2 backing options | 0 rows ("No fabric requirements found"). The table comes out one column after another | ✔ Columns zipped back: "Fabric K — Bundles of Joy Magenta (PWCG009.MAGENTA): 1 1/4 yards (1.14m)", plus "Backing — … (option 1/2)" at 44" / 108". F: "the column-printed table is zipped back"; U: "each name meets its own id and yardage" |
| 27 | FreeSpirit | cutting | 30 lines; A = (1) 21½" panel | A missing (heading "Fabric A*, fussy cut:" not recognised); 3 diagram captions counted as rows; "6 3/4" read as 6 pieces; D subcut "3/2" x 21 /2""; C "5/4""; template rows dropped as captions; H/P strips lost their fabric | ✔ 30 rows, fabric on every row. F: "the Fabric A panel is on the cutting list", "no cutting-diagram caption became a row", "no improper fraction survives", "thirty cutting lines"; U: "the cutting-diagram captions add no rows", "6 3/4 …: Cut 4 is four", "template pieces with a placement clause are rows", three stacked-fraction assertions |
| 28 | FreeSpirit | counters | Units 2a–10b ×4, Block 3 ×4, Inner Borders ×4 (and the printed "Block 2 - Make 4") | 12: capped at 12, and "make 4Unit 7b" / Inner Borders not read | ✔ 18. F: "every repeated unit, 4Unit 7b and the inner borders included"; U: two assertions |
| 29 | FreeSpirit | steps | Step 22 is the last; p12 is the quilt layout and p13–17 are templates | The layout labels and template text were carried into step 22 | ✔ F: "the layout and template pages are not glued onto step 22" |
| 30 | FreeSpirit | meta | Designer: Anna Maria / FreeSpirit | Designer "Little Somewhere Plum": "(C) Little Somewhere Plum" was read as a © line | ✔ F: "(C) Little Somewhere Plum is fabric C" |
| 31 | FreeSpirit | sections | Block Construction / Quilt Top Assembly / Finishing | "K K K K", "I I", "B", "J", "D D", "Harmony Quilt" | ✔ Diagram letters and running heads are never sections. U: "a row of diagram letters is not a section" |
| 32 | Riley Blake tote | name | "Triple T Tote" (printed twice) | "Standard Piecing Bag" (a strapline) | ✔ F and U: "the name printed twice…" |
| 33 | Riley Blake tote | notions | 14" zipper, Fusible Fleece, Shapeflex/SF101 | SF101 missing | ✔ F: "zipper, fusible fleece and the Shapeflex/SF101"; U: "Shapeflex/SF101 is a notion" |
| 34 | Riley Blake tote | steps | 14 paragraphs, the first being "Prep your rectangles by fusing…" | 9, missing "Prep…" (scored zero) and gluing paragraphs across diagram labels (".5" .5"") | ◐ 11. F: "the prep/fusing paragraph is the first step", "at least eleven". The last 3 merges are short paragraphs with no blank line between them |
| 35 | Swoon Mabel | name | "Mabel Vintage Handbag" | "swoon" | ✔ F: "the name comes from Instructions & Pattern …"; U: same |
| 36 | Swoon Mabel | fabric | ½ yd 44" exterior, ½ yd 44" lining | 0 fabric rows; both listed as notions | ✔ F: "the two half-yard lines are fabric rows at 44"", "and no longer notions"; U: "the yardage line is a fabric row with its bolt width" |
| 37 | Swoon Mabel | cutting | 17 rows across 10 pieces (Main Panel, Gusset, Exterior Gusset Interfacing, Main Panel / Flap Top / Flap Bottom / Gusset / Handle Stabilizer, Flap, Handle) | 14 rows. Rotated labels were mis-attributed: Flap lining and exterior filed under "Gusset Stabilizer"; Handle / Flap Bottom Stabilizer missing | ✔ 17, in the app too (main 4, lining 3, interfacing 10). F: "seventeen cutting rows" plus one assertion per piece name |
| 38 | Swoon Mabel | code | "Pellon® Peltex® 70" | "Peltex® 70" failed the code match | ✔ ® and ™ are stripped. U: "registered marks are not part of a code" |
| 39 | Tiana's joggers ×2 | cutting | FRONT ×2, BACK ×2 (plus 4 others) | "SIZE 6" ×2 and "BACKSIZE 6SIZE 3T…" ×2 | ✔ F: "FRONT and BACK are pieces", "no piece is named after a size layer"; U: same |
| 40 | Tiana's joggers ×2 | name | KID'S JOGGER PANTS | "TEST SQUARE" | ✔ F: "the name comes off the piece labels" |
| 41 | all | import summary | — | "Fabric: 13 found (13 widths)" for rows that print no width | ✔ Now counts distinct bolt widths ("4 found (2 bolt widths)") |
| 42 | step card (HANDOFF small item 0 / UX D8) | SA chip | — | "SA 1 cm (3/8") +1" | ✔ Now "Seam allowance 1 cm (3/8") +1". Measured at 375 px: 197 px on one line (h 44), clear of the page chip, no horizontal scroll |

**Matched the PDF already (no change needed):**
- AGF Joyous: 18 cut lines and 11 yardages.
- AGF Catwalk: 64 cut lines, once readable.
- Bathers: 13 sizes and the seam allowance (SA).
- Pencil skirt and sundress: SA and its exception, sizes, and the grouped fabric columns.
- Seam allowance on every fixture.
- Kind detection on all 16 files.
- Jogger fold and count flags.
- Westend and apron A0: the parser stays quiet.

---

## Rules added to `js/sewing.js`
1. **ASCII slash:** a doubled digit after an ASCII slash is a value. Only the fraction slash U+2044 is collapsed.
2. **Stacked fractions:** numerator rows may be single digits. They can fill bare "/3" slots, or "improper" slots such as "6/4"" (never printed as a measurement). A diagram caption glued onto the numerator row survives as its own line. A whole number lifted above "1/4 yards" rejoins it.
3. **Improper yardage:** "11/8 yard" reads as 1 1/8 yard.
4. **Registered marks:** ® and ™ are removed.
5. **Step references:** "Step N <lowercase>" continuing an unfinished sentence is a reference, not a step marker.
6. **Demoted labels:** a "4. Waistband:" label that is demoted to a section keeps its number for the titled paragraphs under it.
7. **Captions inside a step:** a caption-like heading (up to 5 words, or mid-sentence) inside a running step, followed by prose, continues the step. A caption at the foot of a page never does.
8. **Not sections:** running heads (on 3 or more pages), "DIAGRAM n" / "Fig. n", rows of diagram letters, a repeat of a section already left, and headings that belong to a cutting, fabric or notions block. "sewing instructions - X" names the section.
9. **Boilerplate ends a step:** web addresses, e-mail, ©, the letter-spaced logo, and the publisher's disclaimer (matched with spaces removed).
10. **Long steps:** a step over 800 characters carries on to a "(continued)" card (at most 3 cards) instead of being cut.
11. **Short bullets:** bullets of 8 characters or more are steps once the line above has ended, or when the line above is itself a one-line bullet.
12. **Kerning splits:** kerning-split heading words are rejoined ("AT TACH", "EL ASTIC", "CUT TING", "L AYOUTS", "PAT TERN").
13. **Magazine decks:** capitals deck lines are dropped in the paragraph path, and the short name above the deck becomes the section.
14. **Fabric rows:**
    - BINDING / BACKING group labels name the row under them; "(Included)" becomes the amount.
    - Column-printed tables are zipped back together.
    - Metres and Yards lines of one fabric are merged into one row.
    - Width-only rows with no amount are dropped, with a warning.
    - Yardage lines in a materials list move to fabric.
15. **Cutting:**
    - "Fabric A*, fussy cut:" is recognised as a fabric heading.
    - A leading mixed number is not a count.
    - Placement clauses ("oriented as shown…") are stripped before matching.
    - Under "Fabric X, cut:" the row belongs to fabric X.
    - Diagram captions ("…: Cut N") are skipped when the table's rows lead with "(N)".
    - Elastic lengths are not pieces.
    - Superscripts are part of a piece's identity.
    - The same piece under two groups is kept twice, labelled.
    - A bulleted "… from fabric A" line inside a yardage block opens the cutting table; "- Take…" or "Sew all…" inside a cutting block opens construction.
16. **Pattern sheets:** overprinted size-layer labels are stripped. The label for a cut line is looked for up to 4 lines above, then up to 6 lines below, skipping brand stamps, ®, FOLD and "Cut Size:".
17. **Notions:**
    - Amount bullets are merged into the item above them.
    - A "NOTIONS" label glued to the first item opens the list.
    - One-per-line tools stay in the list.
    - A second product name ("Shapeflex/SF101") is accepted.
    - Bra cups are a notion; "pair of rings" is hardware.
18. **Sizes:** per-size elastic charts are named after their chart and are never treated as body measurements.
19. **Counters:** "make 4Unit 7b" and "Inner Borders" are read, and the cap is 24 (the data-model limit).
20. **Names:**
    - "Instructions & Pattern <name>" is taken as the name.
    - Names printed twice get a bonus.
    - Rejected: letter-spaced lines, credits ("designed by", "X by Y", "featuring", "for …"), label lines, the test square and tile labels.
    - A pattern sheet is searched up to page 3, but only for lines that name a garment.
21. **Copyright:** "(c)" counts only before a year.
22. **Import:** a real import with no cutting list (or no notions) removes the template's untouched placeholder rows.
23. **Summary:** the home-card summary counts construction steps only, not optional extras.

**`js/app-sewing.js`:**
- Seam allowance chip spelled out.
- Header, progress and finish count use construction steps only.
- A fabric row with no width reads "<name> · any width".
- The import summary counts distinct bolt widths.

---

## Still wrong, and why
- **Westend jacket (17 pp) is image-only.** Every step, notion and piece is in images, so it would need OCR. The parser correctly stays quiet: 0 steps, 5 honest warnings.
- **Samford fabric grid (TOP/SHORTS/PANTS × m/yd × A-H/I-P × 140/113 cm).** PdfText puts the TOP metres column beside the widths and the other five columns after the notions. The TOP column also belongs to a different booklet. Reading it back would mean building a grid reconstructor for one layout, so I report "could not be read" instead of showing wrong numbers.
- **Samford tear-away interfacing** sits in a prose sentence between the fabric prose and the bullets. It is not picked up.
- **Samford size chart.** The size letters A–P are image text, so there are no size labels to map the 16 values onto.
- **Sub-titled paragraphs are separate cards.** Pattern Runway's "Centre Back Seam:", "Invisible Zip:", "SHELL:" and "LINING:" each get their own card, numbered with their parent step. So the skirt has 11 cards for 6 printed steps, and the sundress 11 for 8. This is deliberate: merged, they would run to 1,400 characters. The printed number is kept on each card (`step.n`), but the card header counts cards. **Coordinator:** decide whether the header should show the printed number.
- **Sundress "Bodice Shell Bodice Lining"** is a caption between steps 1 and 2 and still becomes the section for steps 2–3. Nothing in the text separates it from a real section heading placed before a numbered step.
- **FreeSpirit:**
  - The backing "4/8 yards" should be 4 ⅛.
  - Fabric M "(8) 6 3/Fabric N - … each4" squares" should be (8) 6¾" squares. The caption text sits inside the number itself.
  - Steps 2 and 10–12 come out interleaved by the extractor.
  - These are all extraction faults (see below).
- **Riley Blake:** "Cut off your zipper excess." is missing from the extracted text. Steps 8/9 and 13/14 are short paragraphs with no gap between them, so they merge (11 of 14 steps).
- **Swoon Mabel:**
  - 6 numbered sections containing 29 paragraphs make 13 cards, because long sections carry on over extra cards.
  - The legend "Exterior Lining Wrong Side" is glued onto "1) PREPPING" in the text.
- **Pattern-sheet PDFs** (pencilskirt-pattern, sundress-pattern, apron-A0) carry the real piece lists. Importing the booklet cannot see them. The Pattern Runway sheets print counts ("1 PAIR MAIN / 1 PAIR LINING"); the apron A0 prints none (APRON BODY on fold plus 4 pockets). Only the A0 is a fixture, and it correctly yields 0 cut rows because no counts are printed.
- **Pattern names that are cover artwork** stay blank: both AGF quilts and FreeSpirit. Once the extractor's running-head pass removes "Harmony Quilt", no text line names it.

---

## For the owner of `js/pdftext.js`
Each item gives the fixture, page, the exact text PdfText produced, and what `pdftotext` / the page shows.

1. **Double-printed headings were dropped entirely** at one point during this wave, apparently by `dropOverprint` removing both copies. I messaged the coordinator at the time.
   - `sew-agf-catwalk-quilt.pdf`: p4 "CUTTING DIRECTIONS", p5 "CONSTRUCTION" and p1 "FREE PATTERN" were missing (before the change they came out doubled, "F R E EF R E E…").
   - By the end of the audit, CONSTRUCTION and BINDING were back.
   - Please keep one copy of an overprinted run; a regression test on the Catwalk headings would catch this.
   - The parser now copes either way (rows 25 and 24).
2. **Stacked fractions:**
   - `sew-freespirit-harmony-quilt.pdf` p2: "1\nPWCG012.KEYLIME 4/8 yards (3.77m)"; the page says 4⅛.
   - p6: "(8) 6 3/Fabric N - N, N, N, and N: Cut 4 each4\" squares". A diagram caption is inserted inside "6¾"".
   - p4 / p8: numerators come out on their own line ("3 5", "1 1") with the fraction slash glued to the whole number ("6/4"").
   - The parser repairs the recoverable cases (rule 2). Emitting "6 ¾" as one run would be better.
3. **Interleaved step text:** FreeSpirit p8 step 2 ("2. Arrange 3 each Fabric E / Make a total of 1 each Units 1a-1h ( / Unit 1a / Make 1 …") and p10 steps 10–12 ("10. Stitch a J / top edges. Make a total of 4 Unit 8 ( / sides). / 11. / a block. …"). The figure labels in the left column split the right-column lines.
4. **Kerning splits in Peppermint's display face:** `sew-peppermint-samford-pants.pdf` p13 "MAKE AND AT TACH WAISTBAND", p14 "INSERT AND SECURE EL ASTIC", p6 "EL ASTIC CUT TING GUIDE MEASUREMENTS", p8 "PAT TERN", "CUT TING L AYOUTS", p7 "RST an d WST". `pdftotext` reads all of these whole. The parser rejoins a short word list.
5. **Unmapped "ti" ligature:** `sew-rileyblake-triple-t-tote.pdf` p2 "backs�tch!", p3 "crea�ng", "back s�tching" (CID 0x019F has no ToUnicode entry). Mapping U+FFFD between letters to "ti" would fix it.
6. **Dropped line:** Riley Blake p4 "Cut off your zipper excess." is missing from the PdfText output but present in `pdftotext`.
7. **Overprinted layer labels glued without spaces:**
   - `sew-tianas-jogger-12m-6y.pdf` p5 "FRONTSIZE 12MSIZE 18MSIZE 24M" and p7 "cut 2BACKSIZE 6SIZE 3TSIZE 5TSIZE 4T".
   - The seven size layers print at the same spot. `pdftotext -raw` gives a clean list.
   - The parser strips them.
8. **Scattered grid:** `sew-peppermint-samford-pants.pdf` p5 comes out as "140CM 1.5 / SIZES A-H / 113CM 1.6 / 140CM 1.7 / SIZES I-P / 113CM 2 …" and then, after the notions, "SHORTS PANTS / YARDS METERS YARDS METERS YARDS / 1.65 1.5 1.9 2.6 2.85 …". Row-major output of that grid would let the parser read it.
9. **Case mangling of small caps:** `sew-agf-joyous-picnic-quilt.pdf` p4 "Fabric A Fus-P-1208", "den-s-2002", "Pe-408", and p7 "Place Backing FaBric", "Place toP". `pdftotext` gives "FUS-P-1208", "DEN-S-2002".
10. **Legend glued to a heading:** `sew-swoon-mabel-bag.pdf` p2 "1) PREPPING Exterior Lining Wrong Side". The legend is a separate text block to the right.
11. **Missing running head:** `sew-peppermint-bronte-bathers.pdf` has "sewing instructions - bikini briefs" on p19–21, but the matching "… bikini top" head (p12–15 in `pdftotext`) does not come out.

## For the coordinator (decisions and notes)
- **Long steps now split instead of truncating.** This changed the old unit assertion "a very long step is still one step". I rewrote it: a runaway still stops at 3 cards and is then shortened.
- **Step count and finishing** in the app header, progress, "finished" logic and the home-card summary now exclude the optional variation / care extras. They are still shown after the construction as "Optional extra n of m".
- **Template placeholders are removed when an import finds none.** Rows the user ticked or edited stay, and "Just keep the text" changes nothing.
- **The "SA" chip is spelled out**, which resolves UX decision D8. At 375 px the longest realistic label, "Seam allowance 1.5 cm (5/8") +2", still fits beside "📄 page 12".
- **Two fixture expectations changed:**
  - Samford: the fabric widths "140/113 cm must be read" became "rows must have amounts, or the table is reported unreadable", because the old rows were wrong.
  - The Swoon and bathers last-step checks now skip "(continued)" cards.
- **Housekeeping:** the scratch localStorage in the pane has my "audit …" sewing projects in it. The quilt ground-truth helper's tool harness saved one oversized `pdftotext` output under `~/.claude/projects/…/tool-results/` (outside the repo). Nothing was written to `tmp-pdf/` or the repo root.

---

## Addendum: printed step numbering (coordinator decision)

Decisions 1 (continued cards) and 3 (relaxed fixture checks) were accepted. Decision 2 was answered: the step header shows the pattern's own numbering, because the user reads the paper alongside the phone.

**The rule** is `Sewing.printedSteps(steps)` and `Sewing.printedDone(steps)`, both new exports in `js/sewing.js`.
- **Grouping.** Consecutive construction cards that share a printed number form one printed step. That covers "(continued)" cards and titled sub-paragraphs such as "Centre Back Seam:" under step 4.
- **Runs.** A number lower than the one before starts a new run, and each run is counted on its own. The bathers top is 1–10; the briefs are 1–5.
- **Count.** The printed count is the highest printed number in the run, so a step the reader missed never produces "22 of 21".
- **Optional extras** (variations, care notes) are not steps.
- **Unnumbered steps.** Paragraph and bullet steps carry their card order as their number, so they fall back to card numbering.

**Where it shows.**

| Place | What it shows |
|---|---|
| Step header and ring | "Step 4 of 6" |
| Card chip | "card 2 of 3", only when a printed step spans several cards |
| Optional extras | "Optional extra n of m", with the header word EXTRA |
| Step list | printed number; "4 · 2/3" for a card of a multi-card step |
| Announcements | "Step 4 of 6, card 2 of 3" |
| Progress % | printed steps whose cards are all ticked |
| Finish | when the last printed step is complete; extras never block it |
| Home card | "step 4 of 6", or "all 8 steps done" once finished and on the extras |

**Checked at 375×812.**
- **Pencil skirt:** 11 cards read as Step 1–6 of 6. Steps 4 and 5 show "card 1/2/3 of 3" and step 6 "card 1/2 of 2". The chip sits beside the ring on a single 30 px header line with no horizontal scroll. Ticking the last card gives ALL DONE, and the home card reads "… · step 6 of 6".
- **Sundress:** 11 cards read as Step 1–8 of 8. Steps 4, 6 and 7 are two cards each. After step 8 it is finished at 100% and moves to "Optional extra 1 of 4" (EXTRA). The home card reads "all 8 steps done" (earlier wording, "optional extras", now fixed).

**Assertions.**
- *U* (unit tests):
  - "ten cards, six printed steps, the optional extra not counted"
  - "a titled sub-paragraph is card 2 of 3 of printed step 4 of 6"
  - "a (continued) card belongs to its step"
  - "an optional extra has no printed position"
  - "a printed step is not done while one of its cards is open" / "and is done once every card is"
  - "a restart (bikini briefs) counts its own run" / "and the first run keeps its own count"
  - "a missed step never makes the last read 4 of 3"
  - "the home card says step 4 of 6 on card 5 of 10"
  - "on the optional extras after finishing it says all 6 steps done"
- *F* (fixtures):
  - Pencil skirt: "the header counts the six printed steps"
  - Sundress: "the header counts the eight printed steps, variations excluded"
  - Bathers: "printed numbering runs top 1-10 then briefs 1-5"

**Files touched:** `js/sewing.js`, `js/app-sewing.js`, `css/sewing.css` (the `.sw-card-chip` style), and both test files.

**Suites:** sewing **882/0**, sewing.fixtures **755/0**, crafts **124/0**, templates **94/0**.

**Cleanup:** my "audit …" sewing projects and helper keys were deleted from the pane's storage.
