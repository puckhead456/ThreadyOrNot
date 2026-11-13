# Wave K report: sew-core

Owner of `js/sewing.js`, `test/sewing.test.html`, `test/sewing.fixtures.html`. Contract as built:
`docs/wave-k/api/sew-core.md` (exact; the sew-app worker builds on it). No UI was built: this is
the pure logic the batch-2 app worker wires up.

## Suites
| Suite | Baseline (before my first edit) | Now |
|---|---|---|
| `test/sewing.test.html` | 963 / 0 | **1143 / 0** (headless `tools/headless-suite.sh sewing.test`) |
| `test/sewing.fixtures.html` | 789 / 0 (14 fixtures) | **871 / 0** (real tab; see note) |
| `test/crafts.test.html`, `test/templates.test.html` (load sewing.js) | — | 212 / 0, 159 / 0 headless |

Two existing assertions were changed on purpose, both by a proposal: the bag "missing size chart is
warned about" became "a bag is not warned about a size chart" (P14), and the wave F `cutTotals`
shape gained `strips: 0, stripsCut: 0` (P7).

**Headless note.** `BUDGET=180000 bash tools/headless-suite.sh sewing.fixtures` (and 600000)
prints "no summary" here: Chrome returned in under a second with the page still on its first
fixture (the PDF extraction does not advance under the virtual-time budget). The fixtures were
run in one real Browser-pane tab instead, which was closed afterwards. The sessionStorage text
cache only lives in that tab, so nothing reached the shared profile.

**Second pass (coordinator follow-ups):** `sewing.test` **1159 / 0** and `sewing.fixtures` **890 / 0**,
both headless (`TIMEOUT=600` real-time mode now runs the fixture page).

### The calculators against the new quilts' printed numbers
| Fixture | What the page prints | Formula | Verdict |
|---|---|---|---|
| Moda Charm Monday, 58" × 83" | binding 8 × 2½" WOF | 292" → 8 strips at 40" | **agrees** |
| | backing 5 yd | 5 1/8 yd at 4" a side; 5 yd at 3" a side | **close** (1/8 yd; the pattern allows ~3" a side) |
| | flying geese 2½" × 4½" + 2½" squares (one at a time) | `geese(4, 2, 1)` | **agrees** |
| Moda Courtyard, 67½" × 72½" | binding 8 × 2½" WOF | 290" → 8 strips | **agrees** |
| | backing 4⅓ yd | 4¼ yd | **agrees** (printed covers it) |
| | Geese A 5½" × 3" + 3" squares; Geese B 3" × 1¾" + 1¾" squares | `geese(5, 2½, 1)`, `geese(2½, 1¼, 1)` | **agree**, both |
| Moda MFCIM sampler (block of the month) | 7 HST/QST sizes, e.g. 7" squares for a 6" HST, 10½" for a 9" QST | HST finished + ⅞", QST + 1¼" | **close, every one**: Moda cuts ⅛" (HST) / ¼" (QST) bigger and says "trim to size". `hst(f, 2, {trim:true})` / `qst(f, {trim:true})` now reproduce the printed squares exactly |
| FQS Bella Skill Builder finishing | 9 × 2½" binding strips; no finished size printed | from the printed centre and borders (66" × 88"): 8 strips | **agrees** (printed is enough); no verdict is made up when no size is printed |
| FQS block 4 (flying geese) | 9" and 7½" squares, trimmed with a speciality ruler | no-waste four-at-a-time: 7¼" + 3⅞" | **differs by method** (oversize ruler method, not comparable; not asserted) |
| FQS block 5 (HST) | Triangles-on-a-Roll paper on 8½" × 16" rectangles | — | **not comparable** (paper method) |
| Earlier: AGF Joyous 310", Catwalk 184" | | 310" / 182½" | agrees / close |

Moda's glued fractions are handled everywhere a number is read: "21/2"" is 2½", "12/3 YARDS" is
1⅔ (the sampler's requirements), "41/3 yards" is 4⅓. In this extraction the glyphs came out
intact on Charm Monday; the fix is asserted synthetically and on the sampler's glued yardage.

### Other follow-ups
- `normalize` keeps `swatchColours` (sew-extras), `swatches` (captured SwatchBitmaps) and
  `quiltModel` (a stored QuiltModel, ≤ 60 KB). sew-app.md names no further fields.
- The four owner-password Tiana's files open and read as sheets (asserted on margo-top-A4 and
  colette-dress-A4): `Sewing` only sees extracted text, so nothing refuses them.

**Third pass (sew-app's asks):** `sewing.test` **1175 / 0**, `sewing.fixtures` **914 / 0**, both headless.
- `step.fig` is kept by `normalize` (crop with a `p:<id>:fig:` key, or a page with a normalised
  frame; junk dropped), stays on the first card through split and merge, and survives a re-import.
  sew-app can move off its `imageRef` workaround.
- `sizeRule` quotes exactly the one sentence (asserted on the sundress, the pencil skirt's twin
  rule, Samford's grading sentence with the "CHOOSING YOUR SIZE" heading taken out, and Albion); the
  "slightly different" rule now comes separately as `slightlyText`.
- New garment fixtures:
  - **Peppermint Albion**: the in-booklet piece inventory is read, 11 rows (4 interfacing, pairs as
    12 pieces). **Not read:** its fabric table (asserted as KNOWN, 0 rows).
  - **Shannon Cuddle Robe**: 15 rectangles with their sizes, the two hoods as 1 main + 1 reverse,
    the Curvy alternative marked "Curvy size only", 2 bulleted yardages, 4 nap-direction sentences
    with pages and a nap chip on the steps. **Not read:** "Fits S, M, L" is not a chart (no sizes).
    The Shannon wrap's nap sentences read (3); its cutting list does not.
  - **Tiana's Margo A0 + A4 pair**: both sheets, the same 10 sizes, a tape-up map on the A4 file
    only, every A0 piece also on the A4. **Partly read:** only 2–3 pieces per file (most piece
    labels are drawn, not text). Colette's size-label runs and "Printing Instructions" are no longer
    taken for pieces.

**Fourth pass (sew-audit engine defects):** `sewing.test` **1197 / 0**, `sewing.fixtures` **946 / 0**,
`sewing-app.test` 171 / 0, `sewing-extras.test` 124 / 0 (headless, `TIMEOUT=600`).
1. `sizeRule` page: the page is the sentence's first letter's, so a rule opening a page keeps its
   page and its "slightly different" companion; 97 / 79 / 104 is 42 with a 44 hip again (asserted).
2. No step loses text: long steps carry on over as many cards as needed; the "shortened" branch
   is gone. Asserted on every fixture (no card ends "…", no "shortened" warning) and on Albion.
3. Names and kinds: `projectName` gives '' for "Binding 5/8 yard", "Paper", "BELLA", "SIZE TABLE"
   and Courtyard's sentence fragment; the Quick Sew Bag is a bag (named so) with its two fabric
   amounts as fabric; Bella block 4 is a quilt. Also: no more "(1 columns detected)".
4. "SIZE CHART (cm)" sets the unit; the "Unit" check row is gone for it.
5. Margo A4: 4 pieces, one cut line each (the layout page's repeats merged, "Size: …" labels
   stripped, "Tiana's BACK" read), back cut mirrored; the test ruler reads "10 centimeters" and print
   notes are whole sentences. Found on the way: a stamp-fragment rule that hid a name one letter
   longer than a stamp (sundress Front Waistband) — fixed.
6. All six of the audit's paste-ready assertions added (all pass), plus Bella block 5 and Colette A0 names.
Left from the audit's list (not asked this pass): importCheck on section-restarting booklets (Shannon
robe "steps … and 1 missing"), alternatives counted twice in `cutTotals` ("Curvy size only", Albion's
long / short cuffs), and Colette A4's layout page still merging two pieces' counts (not asserted).

## Proposal by proposal
| # | State | What was built, measured on the fixtures |
|---|---|---|
| P3 size advisor | **done** (logic) | `sizeRule` quotes the designer verbatim with its page; `suggestSize` per row exact / between / below / above, the rule's "between → larger" and "slightly different → closest" both applied; never chooses. Sundress 97 / 79 / 104 → **42 with a 44 hip** (the brainstorm's proof). `resolveSize` resolves fabric, finished, body, elastic and "(a, b, c)" runs once; bathers M → **4 elastic lengths + 2 fabrics, 0 unresolved**; the waistband chart's "70." is flagged with the inch figure (70.5 cm). |
| P4 transposed / dual-unit charts | **done** | Bathers p5: **13 sizes × Bust/Waist/Hip, body and finished, all 78 cells read**, glued pairs split only where cm ÷ 2.54 ≈ in ("14256" → 142/56, "1/412750" → ¼ to the inch before + 127/50). Columns named from the caption (the header words come out in the wrong order); body vs finished from the caption order. Checked cell by cell at size M against the page lines. Charts self-check (rows grow, units agree, unread cells, guessed unit). No other fixture's chart changed. |
| P5 pattern sheet as data | **done** (logic) | Sundress sheet: **10 of 10 pieces** with per-fabric counts ("1 pair main + 1 pair lining", "1 on fold", waistbands main + lining + fusing), split labels joined (SIDE B + IDE BACK BODICE, FRONT SKIR + SKIRT, POCKE T), tape-up map 5 × 6, 30 / 30 pages agree. Pencil-skirt sheet: **its labels mark the joins** (1A–4D on a 5 × 5 grid; sew-visual's "one label per page" assumption would misread it), 5 pieces with numbers, the 2.5 cm grid check and the page-scaling note; it no longer gives 4 junk steps. Tiana's: 6 pieces each, 3 × 5 grid, and the 12M–6 file's irregular grid keeps its 2 gaps. Layer names → sizes / always / other. A0 from page sizes (asserted synthetically: the fixture page has no page sizes). `attachSheet` stores it with taped tiles. |
| P6 / S5 cutting board | **done** (logic) | Interfacing **product** kept: Mabel **5 Shape-flex rows (11 pieces, fusible) and 5 Peltex rows (6 pieces, sew-in)**, from the cut line, the lines printed beside it, the piece name, or "the only interfacing on the list" (each says which). The brainstorm wrote "4 SF101 rows and 6 Peltex rows"; reading the pages, the Main Panel's "Cut 4 Pellon" is the fused interfacing (the step fuses "Main Panel interfacing" over the stabilizer), so I assert 5 / 5 rows and 6 Peltex pieces. Fuse card from "Fuse … to …" (Mabel: 4 pieces). Harmony: **16 fabric groups**, no "Other". The tote's fleece and SF101 notions join the board as cut pieces. |
| P7 strip maths | **done** | Subcuts link to their strip (`parent` / `parentId`); `cutTotals` counts strips apart: Harmony **183 cuts + 11 strips** (was "194 pieces"). `stripCheck`: Harmony Fabric E **2 strips × 11 = 22 of 24 at 40", needs 42"** (off); D, I, L, M add up; rows not cut across the strip are "not checked", never guessed. |
| P8 quilt calculators | **done** (logic) | Binding, backing, batting, HST 2/4/8, QST, geese 1/4, resize, each with its formula. **Joyous binding 310" reproduced exactly**; backing 5 yd ≤ the printed 5½. Catwalk: formula 182½ vs printed 184 → "close" (AGF's own rounding differs between its two quilts: 300 + 10 vs 172½ + 11½); its 1¾ yd backing works only at 44" wide, and says so. Harmony: the 7 printed binding strips are enough. Formulas are standard ones from memory, not yet checked against two published calculators (the brainstorm asked for that). |
| P9 finished / unit sizes | **done** | Finished size captured on all three quilts (70 × 80, 35¼ × 51, 64½ square); unit unfinished sizes on most Harmony units, kept in craftData (`units[].size`, `measured`). |
| P10 / S3 units in their step | **done** | Every unit carries its step (Harmony **18 / 18**, incl. "make 4Unit 7b"); `stepKey` survives edits; `unitsForStep`, `activeUnit` give the big button what to count. |
| P11 / S2 quilt-top model | **done** (text half) | Catwalk 13 rows of fabric letters with sizes; Harmony's p12 labels (6 block kinds, B3 ×4) mapped to their blocks and steps; Joyous 14 blocks / 8 rows (its layout is a picture, said so); fabrics with codes. |
| P13 fabric calculator / shopping v2 | **done** (logic) | Own width (140 cm uses the printed 115 cm figure: sundress 2.4 m at 42), never interpolated; narrower than every width says "measure"; nap only when printed; shrinkage ≈ on the length; unit conversions marked ≈; per view; sundress fusing listed once; Harmony's 5 Additional Recommendations on the list; one list across projects. |
| P14 / gap 19 kind and name | **done** | `kind` kept in craftData; `vocab(kind)`; bags no longer warned about a size chart; `projectName` → "Gathered Sundress". |
| P15 SA and set-up per step | **done** (logic) | Step's own SA preferred (Mabel ½" steps, trim to ⅛", topstitch ¼"), else the exception, else the pattern's; foot named or suggested with its reason. Machine presets (05 #16) not built. |
| P16 glossary and timer | **done** (logic) | Booklet's own glossary / PATTERN SYMBOLS (sundress: 10 entries) plus terms counted with the app's own one-line definitions; fuse / press timer with the sewist's own seconds only (no default). |
| P17 fitting log | **done** (data) | `fitting` entries, carried to a second make; photos are blob keys the app stores. |
| P19 milestones | **done** | all cut, all fused, top finished, binding on, hemmed — each fires once. |
| Gap 8 what was missed | **done** | `importCheck` in the shared Check shape: missing printed steps with their page, sentences no step took (tote: **"Cut off your zipper excess." page 4**), picture pages (apron 4–7), cutting list on the sheets, chart, strip, binding and backing checks, image-only booklets (Westend 14 of 17 pages). False positives found and fixed on sundress, apron, Harmony, Catwalk, Samford, Mabel (titled sub-steps, decimals, notes around the steps, glued headings, captions). |
| Gap 7 step edits and notes | **done** (logic) | `editStep`, `setStepNote`; a re-import restores edit, tick and note while the printed text is unchanged; a changed step keeps the note flagged. Stored in craftData (no shell-data dependency; its API file was not published when I built this). |
| Gap 5 | done (= P3) | |
| Gap 20 | not mine | the gallery is a batch-2 file. |

## Adoption notes for the batch-2 sew-app worker
- Import review: show `Sewing.importCheck(parse, {emptyPages, pages})` through `ctx.check.line` /
  `open`; demote "Import" only on `off` (BUILD rule). Name the project `Sewing.projectName(parse, file)` when the drop zone made it.
- Size & alterations: `measurements.mine` rows can now carry `unit`; call `suggestSize(craftData, mine)`
  and show `why` + `rule.text` (with "page n"); a "Use 42" button sets `size.chosen`. Then list
  `resolveSize(craftData, chosen).items` (and `unresolved` as plain lines). The chart's own check:
  `readSizeChart(craftData).check`.
- Cutting: `cuttingBoard(craftData, {wof: fabricPrefs.wof})` for the grouped list and `.fuse` for
  the "Fuse before you sew" card; a row's `check` is the strip verdict (show as ≈ / ≠ with `why`).
  The home card's `cutTotals` already counts finished cuts; show `strips` as its own line.
- Quilt: `quiltFacts` prefills the 🧮 sheet; `quilt.*` recompute on edit. Units: render
  `activeUnit(craftData)` into the big button, `unitsForStep` as the chip strip.
- Fabric: `fabricNeed` / `shoppingListV2` with `craftData.fabricPrefs`.
- Steps: `stepSetup(step.text, craftData).chips` on each card / in working mode; `editStep` /
  `setStepNote` inside `Store.updateCraftData`.
- Sheets: ⋯ → Add the pattern sheets → `PdfText` text → `readSheet(text, {pageSizes, layers})`
  (layers from `handle.layers()`, page sizes from pdf.js `page.view`) → `attachSheet(craftData, sheet)`;
  tick tiles into `craftData.sheet.taped[label]`. sew-visual's `mountTapeMap` takes `sheet.tiles`.
- `Sewing.milestones(before, after)` after every update, for `Celebrate`.

## For the owner of `js/sew-figures.js` / `js/sew-quilt.js` (sew-visual)
- `SewFigures.tapeMap` assumes one label per page. The pencil-skirt sheet prints labels at the
  **joins** (1A–4D for a 5 × 5 grid) and the sundress prints each tile's own label plus its left and
  upper neighbours'. `Sewing.readSheet(text).tiles` handles all three and returns your TapeMap shape
  (plus `marks`, `ownLabels`, `check`); consider taking it.
- `units[].step` / `stepKey` exist (your `SewQuilt.progress` mapping 'units'); `quiltTop().blocks`
  maps Harmony labels to blocks and steps; `Sewing.dims` mirrors your `parseDims`.

## For the owner of `tools/headless-suite.sh` (coordinator)
- Resolved: the new `TIMEOUT=600` real-time mode runs `sewing.fixtures` (890 / 0).

## Left, and why
- Fixture page sizes are not read in the fixture page, so the A0 apron is asserted synthetically only.
- No new sewing fixtures arrived during this session (`docs/wave-k/fixtures.md` lists none yet).
- Machine presets (05 #16), the cross-project shopping list UI and the resize "per fabric" yardage
  (only an area ratio ≈) are not built.
- The formulas are now checked against the patterns' own printed numbers (table above) rather
  than published calculators; the speciality-ruler and triangle-paper methods are not modelled.
- The new garment fixtures (Albion's in-booklet cutting list, Shannon's nap, the layered Tiana's
  A0/A4 pairs) were not asserted in this pass beyond the encrypted files opening.
- Units with no step on other quilts are shown by `importCheck`; Catwalk has no units to count.

## Decisions for the coordinator
- I changed two existing assertions (above) because the proposals change that behaviour.
- The Mabel product count disagrees with the brainstorm (5 / 5 rows, not 4 / 6); reasoning above.
