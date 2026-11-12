# Wave K brainstorm 03 — the sewist and quilter

Lens: I sew garments from indie PDF booklets, bags from maker patterns, and quilts from block
patterns. This document proposes; nothing was built.

**How this was gathered (2026-11-12).** In my own tab (`Store.__setKeyForTests('stitchkeeper-wavek-sewing')`,
375×812, rAF shimmed in that tab only so pdf.js could draw):
- all 16 `tmp-pdf/sew-*.pdf` were read through `PdfText.extract` → `Sewing.parse`;
- three were imported the way a user does it: **New project → 🪡 Sewing → the drop zone → review → Import**.
  These were the sundress (garment), the Mabel bag and the Harmony quilt, each with and without "Keep the pages";
- the page viewer, Size, Cutting and Notions sheets were opened;
- page sizes, optional-content layers and operator lists were read with pdf.js.

Everything was deleted afterwards: 3 projects, 39 `p:<id>:` blobs and the storage key.

Code read: `js/sewing.js` (4,537 lines), `js/app-sewing.js` (3,074) and `pageLines` in `js/pdftext.js`.
Docs read: `docs/research/sewing.md`, `docs/wave-e/sewing-audit.md`, `docs/wave-f/sewing.md` and
`docs/brainstorm/05-sewist-quilter.md`. Claims marked *(memory)* are from my own knowledge, not
from a fixture or the code.

## 0. What the fixtures say today (one line each)

| Fixture | Kind | What the parse found | What is missing at the moment it matters |
|---|---|---|---|
| sundress (9 pp) | garment | 8 printed steps on 11 cards, 4 optional; sizes 36–44 with Bust / Waist / Hip; 4 fabric rows; SA 1 cm plus an exception | No cutting list: it is on the sheet PDF. "Finished" is length only, so there is no ease. The fusing is listed twice (fabric row **and** notion) |
| sundress-pattern (30 pp tiled) | sheet | 0 of everything, 5 warnings | The text holds each piece with its counts ("SIDE FRONT BODICE / 1 PAIR MAIN / 1 PAIR LINING", "FRONT WAISTBAND / 1 x MAIN / 1 x LINING / 1 x FUSING") and tile labels 1a…5f |
| pencilskirt-pattern (26 pp tiled) | sheet | **4 junk "steps"** (the printing instructions plus a web address) | Tile labels 1A–4D, "PATTERN GRID MEASURES 2.5cm x 2.5cm" (a print check) and piece labels |
| pencilskirt | garment | 6 printed steps, 5 sizes, SA 15 mm | Like the sundress: no cutting list |
| bathers (22 pp) | garment | 13 size labels, **0 body-chart rows**, 8 elastic charts, 14 pieces | The p5 body/finished chart is printed transposed with glued digits ("9X 14256 126 50…"). Swimwear has negative ease, and the per-size elastic lengths are never resolved to *my* size |
| samford (16 pp) | garment | 15 steps, 1 hack, the fabric grid read cell by cell | Size letters A–P are image text. 29 "(Figure n)" references point at drawings the app cannot show beside the step |
| westend jacket (17 pp) | unknown | 1,370 characters | Image-only: needs OCR |
| apron + apron-A0 | garment / sheet | 16 steps; A0 sheet 841×1189 mm | Nothing tells the user that the A0 file is for a copy shop, or what its pieces are |
| tianas joggers ×2 | sheet | 6 cut rows | The PDF has **named size layers** ("12M", "18M" … "6"; "7" … "12"; "Print for all sizes") that the app never reads |
| mabel bag (13 pp) | bag | 17 pieces; 6 notions incl. "Shape-flex SF101" and "Peltex 70" | Every stabiliser and interfacing row is just "interfacing"; the product is lost (p8–13 say "Cut 2 Pellon® Peltex®" vs "Cut 2 Pellon® Shape-flex®"). The "SA 13 mm" is one step's sentence, and the bag has no global SA |
| triple-t tote (5 pp) | bag | 11 of 14 steps, 2 cut rows | Fusible fleece and SF101 are read as notions, not as cut pieces |
| AGF joyous (8 pp) | quilt | 18 cut rows, 13 fabrics, 16 steps | "FINISHED SIZE \| 70" × 80"" not captured; **0 block counters**; p6 is a ROW 1–8 layout picture |
| AGF catwalk (10 pp) | quilt | 64 cut rows, 34 steps | Finished 35¼" × 51" not captured; no counters |
| harmony (17 pp) | quilt | 30 cut rows, 18 fabrics, **18 unit counters** | The counters stack to **2,223 px**; Step done sits at y = 2,927 on an 812 px screen. "0 of 194 pieces cut" counts strips *and* the squares cut from them. "Additional Recommendations" (thread, 72"×72" batting, template plastic) gives "Notions: none found" |

## 1. Parity table (crochet capability → sewing today)

| Crochet capability | Sewing | Evidence |
|---|---|---|
| Rich PDF importer | **partial** | Booklets: steps, cutting, notions, SA, sizes and fabric (`Sewing.parse`). Tiled / A0 / layered sheets give nothing or junk (above) |
| Real-fixture assertions, ground-truth audit | **has** | `test/sewing.fixtures.html` 789, `test/sewing.test.html` 963; wave E audit, 42 rows |
| Computed counts + confidence signal | **partial** | Warnings only. No per-field "≈ why"; nothing checks the pattern's own arithmetic (strips → subcuts, binding length) |
| Multi-size, chosen once | **partial** | Size chips and a fabric-for-size card (`fabricForSize`). Elastic lengths, finished length and cut counts per size are not resolved; no advice from my measurements |
| Live visual model | **missing** | A grey SVG "cutting table" of truncated labels ("Main…", `buildCutTable`) and a step ring |
| Colours / materials from the pattern | **missing** | Fabric rows are text only. Swatches printed in the PDF (Harmony p2: 18 images labelled (A)–(P)) are unused |
| Counted progress | **has** | Steps (printed numbering), cut chips with counter sheet, unit counters |
| Repeats / targets / alerts | **partial** | Unit targets; SA reminder per step (`saReminder`). No "make 4 Unit 7a" link to its step |
| Placing notes | **partial** | SA exceptions only. Interfacing ("fuse to…"), pressing and "set aside" are not surfaced |
| Templates | **has** | Garment / Bag / Quilt (`TEMPLATES`) |
| Checklist | **has** | Shell checklist; still titled "Assembly checklist" (05 #17) |
| Focus / working mode | **missing** | Crochet and knitting have ⤢ Work in 3D (wave I); sewing has none |
| Page images | **partial** | Opt-in and **off by default** (`wantPages`, app-sewing.js ~2649); whole-page viewer only |
| Glossary | **missing** | Knitting has ⋯ → 📖 Glossary; the sundress p4 "PATTERN SYMBOLS" page is ignored |
| Tours, FAQ, celebrations | **has** | 6 FAQs, a tour, `C.celebrate('piece' / 'project')` |
| Backup of pages | **has** | `.thready` carries the `p:<id>:page:*` blobs |

## 2. The 2026-09-17 brainstorm (05) — done and open

Done:
- #1 split / merge (F)
- #2 optional extras (E/F)
- #3 numeric cut chips (F)
- #4 quilt fabric rows (E: Joyous 13, Harmony 18)
- #5 shopping list with fabric and thread (F)
- #6 heading-only steps (E)
- #7 no placeholder pieces (E/F)
- #9 drop the PDF into New project (E; it worked for me)
- #10 step pages rendered first (F)
- #11 printed step numbers (E)
- #15 SA exception at the point of use (F)
- #18 orphan blobs (F boot sweep)

**Partly done:**
- **#12 size.** An ease row exists (`easeRows`). There is still no suggestion from my measurements. Values are bare strings with no unit, and every placeholder reads "96 cm", Height included (app-sewing.js 1726).
- **#14 subcuts.** `subcut: true` exists, but there is no parent chain, so the totals double-count.

**Open:**
- #8 group the quilt cutting by fabric (Harmony still reads "OTHER · 30 PIECES").
- #13 quilt counter in the big button (worse than reported: 18 cards).
- #16 machine presets.
- #17 kind-aware chrome. `kind` is still not kept by `normalizeData`, and the Mabel bag import warns "No size chart found".

Below, these are folded into larger proposals rather than repeated.

## 3. Proposals, ranked

### P1. The step's own figure beside the step
**User sees.** Under the step text there is a crop of the booklet: just this step's drawings, not the whole A4. On the sundress, "Sewing the Bodice" shows the two bodice drawings under that heading in the left column of p6. Tapping the crop opens the full page at that spot. Samford's "(Figure 3)" crop is the drawing captioned Figure 3.

**Why.**
- Sundress p6 carries four steps and about six drawings on one A4 page. At 375 px the whole page is unreadable without zooming, and you must hunt for your step.
- Samford has 29 "(Figure n)" references and Harmony 24 "Fig. n" references.
- The research says "the diagram *is* the instruction for half of all steps" (A.3.4).
- Today pages are off by default, so a default import shows no drawing at all.

**How.**
- `pageLines` already gives each line `pos` (y on the page) and `col`. Expose this as `handle.lineBoxes(n)` → `[{text, x0, x1, y0, y1, col}]`. This needs an extractor change, owned by the `pdftext.js` owner.
- At import, record a band per step: page, column x-range, from the step's first line to the next step's first line in the same column.
- Caption mode: when the step names "Figure n" / "Fig. n" / "Diagram n", find that caption's box and take the drawing region around it. Use the operator list's image and path bounds near the caption, the way `KnitChart` reads vector pages.
- The crop is a CSS `object-view-box` / canvas cut of the stored page JPEG, stored as `{page, x, y, w, h}` on the step. No new blobs.
- Also: keep the step and layout pages **by default** (sundress about 1 MB). Make all pages opt-in, not the diagrams.

**Effort** L. **Risks.** A figure printed on the facing page; full-width figures on a two-column page. Fall back to the whole page, never to a wrong crop.

**Proof.**
- A fixture table of step → expected band (sundress, pencil skirt, Samford, Mabel, Harmony, Joyous). Assert that each band contains the step's first line and not the next step's.
- A reviewer page like `test/diagram.gallery.html` showing every step's crop beside its text.

### P2. Sewing working mode (full screen)
**User sees.** ⤢ Sew. The screen holds:
- the step text, large;
- the P1 figure;
- a chip row: "Seam allowance 6 mm · neckline", "🦶 zipper foot", "⏱ press";
- next-step preview;
- big Step done / back buttons.

The screen stays awake, and Space / → turn the step. A Bluetooth page-turner pedal sends arrow keys *(memory)*, so hands stay on the fabric. On a quilt step that makes units, the big button becomes the unit counter (P10).

**Why.** Crochet and knitting have had this since wave I. A sewist's hands are full; the current screen puts mini rows and a cut table between the step and the button.

**How.** Reuse the wave I shell pattern (`settings.focusProjects`, landscape layout, keyboard). Sewing state is already in `craftData`. **Effort** M (after P1). **Proof.** Pane checks at 375×812 and 375×640 with no overflow on all 16 fixtures; keyboard path; Undo inside the mode.

### P3. Size advisor: choose once, resolve every per-size number
**User sees.**
- "My measurements" with cm / in (stored as `{value, unit}`), covering what the booklet asks for. The sundress p3 lists Bust, Waist, Hips, Back-waist length, Sleeve, In-seam and Skirt length.
- The chart lights my cell in each row, with a banner: "Bust 42 · Waist 42 · Hip 44. The pattern says: *if you are between sizes, choose the larger*. Blend 42 → 44 at the hip?"
- **Use 42** (or 42 / 44 blended). From then on every per-size number shows only my size:
  - fabric per width;
  - finished length against my skirt length ("+3 cm: lengthen at the line");
  - the bathers' elastic charts ("Top edge elastic: cut N cm");
  - per-size cut counts and notions.

**Why.**
- 05 #12 is still open. I typed nothing and got nothing.
- The designer's own size rule is printed (sundress p3).
- Bathers has 8 per-size elastic charts, and today they are tables to read across.

**How.**
- Pure arithmetic over `measurements.body` / `finished`, with lenient number parsing.
- Quote a "between sizes" sentence when found; never auto-pick.
- Grading between sizes is shown as which size to use at bust / waist / hip. No pattern lines are drawn.

**Effort** M. **Proof.** Unit tests on synthetic charts (exact, between, beyond range, mixed units). Fixture: the sundress at 97 / 79 / 104 suggests 42 with a 44 hip, and the bathers at size M resolves every elastic chart to one number.

### P4. Read transposed and dual-unit size charts (and let them check themselves)
**User sees.** The bathers' size chart reads as 13 sizes × Bust / Waist / Hip, in body and finished, cm and inches. Ease is shown as negative ("−5 cm: swimwear is cut smaller than you").

**Why.**
- Today: 13 labels and 0 rows.
- The p5 text is rows of `size cm in cm in cm in` with glued pairs ("14256", "10742").

**How.**
- A size-first row reader.
- A glued token is split where cm / 2.54 ≈ in: 142 / 56 works, 1425 / 6 does not. So the dual units are a checksum, and any token that fails it stays unread ("could not read").
- Same rule for "10240" → 102 / 40.

**Effort** M. **Proof.** Bathers p5 asserted cell by cell against the page image (ground truth to be written as in wave E). No other fixture's chart changes.

### P5. The pattern sheet joins the project (tiles, A0, layers, piece list)
**User sees.** On a sewing project: ⋯ → **Add the pattern sheets**. Dropping `sundress-pattern.pdf` gives:
- **A cutting list**, which the booklet never had: Side Front Bodice 1 pair main + 1 pair lining, Back Bodice 1 on fold main + 1 on fold lining, Front / Back Waistband 1 main + 1 lining + 1 fusing, Pocket, Pocket Facing, Front / Back Skirt.
- **A tape-up map**: a grid of tiles 1a…5f from the registration labels. Tick tiles as you tape them; tap a tile to see its page.
- "Piece 3 is on pages 13–18": reprint just those pages.
- **Print check**: "Measure the test square: 2.5 cm (sundress) / 3" (Mabel p8). Page scaling must be None / 100%."

For an **A0** file (the apron, 841×1189 mm) it says "Copy-shop file: print at 100% on A0" and lists its pieces. For a **layered** file (the joggers: layers "12M" … "6") it shows the sizes it found, "**My size only**" renders the page with only my layer plus "Print for all sizes", and it gives the layer names to tick when printing.

**Why.**
- Both Pattern Runway booklets have no cutting list ("No cutting list found").
- The sheet text has every piece with per-fabric counts.
- Importing a sheet as a booklet makes 4 junk steps (pencil skirt).
- Layered PDFs misbehaving on phones is a documented complaint (research A.2.2 #5).

**How.**
- `detectSheet` exists; route a sheet to a sheet reader instead of `parseSteps`.
- Read piece blocks: name, piece number, "N PAIR / N ON FOLD / N x" + MAIN / LINING / FUSING.
- Labels split across tiles ("POCKE T" on p8 and p9; "SIDE B" / "IDE BACK BODICE" on p15 / p16) are merged by piece number and de-duplicated.
- Tile grid from `^\d+\s?[a-zA-Z]$` labels.
- Paper size from `page.view`.
- Layers from `getOptionalContentConfig()`; the page viewer renders with that config.

**Effort** L. **Risks.** The merge of split labels; an honest "N pieces read, check against the sheet". **Proof.** New fixture assertions:
- the sundress sheet → 10 pieces with the counts above;
- the pencil skirt sheet → tiles 1A–4D;
- joggers → 7 / 6 size layers;
- A0 detected;
- no sheet gives steps.

### P6. A cutting board by fabric, with an interfacing map
**User sees.**
- The cutting list grouped by what is on the table: Exterior, Lining, then each interfacing **product** (Shape-flex SF101 · fusible; Peltex 70 · sew-in).
- Each piece row: "Main Panel · cut 2 exterior · 2 lining · 4 SF101". Mirrored pairs and "on fold" are shown as small icons.
- A **"Fuse before you sew"** card, built from the step text: "Fuse woven interfacing to the exterior Flap, lining Main Panels, lining Gussets and Handle".
- On a booklet that prints its pieces (Mabel p8–13), each piece shows a thumbnail of the page it is printed on.
- Quilts group by Fabric A…P (05 #8).

**Why.**
- Mabel: 10 of 17 rows are "interfacing", and the product that decides fuse vs glue is dropped.
- Harmony groups all 30 rows under "OTHER".
- The current cut-table SVG is truncated grey labels.

**How.**
- Keep `material` plus a new `product` from "Cut N <product>" lines.
- A notion ↔ product match (Shape-flex ↔ SF101).
- "Fuse … to <list>" sentences are parsed into a piece list.
- Thumbnails from stored pages.

**Effort** M. **Proof.** Mabel: 4 SF101 rows and 6 Peltex rows asserted, plus the fuse list. Harmony: 16 fabric groups.

### P7. Quilt strip maths: subcut chains that check the pattern
**User sees.** "Fabric E: cut 2 strips 3½" × WOF → subcut 24 squares 3½"". The strips have their own counter, and the squares' counter is under them. Beside it: "2 strips × 11 squares per strip at 40" usable = 22, but the pattern needs 24. Check your fabric width (42"+ gives 12 per strip)". The cutting header counts *finished cuts*, not strips plus squares.

**Why.** Harmony reads "0 of 194 pieces cut", counting parents and children. 05 #14 is still open. A quilter's real worry is "will my strips give enough".

**How.**
- `parentId` on subcut rows (the `subcut` flag already marks them).
- Pure arithmetic: floor(usable WOF / piece width) × strips.
- Usable WOF is a setting (default 40" *(memory: quilters plan 40–42")*).
- Shown as a check, never a correction.

**Effort** M. **Proof.** Harmony and Catwalk: every subcut has a parent; header totals equal top-level cuts; the check fires only where the arithmetic is tight (assert by hand-worked cases).

### P8. Quilt calculators wired to the pattern (binding, backing, batting, HST, geese, scaling)
**User sees.** A 🧮 sheet prefilled from the pattern:
- **Binding**: (70 + 80) × 2 + 10 = 310". The pattern says 310" ✓. That is 8 strips of 2½" WOF.
- **Backing**: 70 × 80 top + 4" each side. Two widths of 42" → 4.9 yd. The pattern suggests 5½ yd.
- **Batting**: 72" × 72" (Harmony).
- **HST / QST / flying geese**: "8 at a time" and "4 at a time" sizes for a finished unit size.
- **Resize**: "add a row of 10" blocks" → new finished size and new yardage per fabric.

All of it can be overridden. Each number shows its formula ("≈ why", like crochet's count badge).

**Why.**
- Research A.2.4: the calculators exist but are disconnected from any tracker.
- Joyous prints the binding length, which the formula reproduces exactly.

**How.**
- Pure functions in `js/sewing.js`.
- The formulas are standard *(memory; to be checked against two published calculators before shipping)*.

**Effort** M. **Proof.** Unit tests on hand-worked values; the Joyous binding = 310 and backing ≤ the printed 5½ yd asserted on the fixture.

### P9. Finished sizes and unit sizes, with a "measure it" check
**User sees.** The quilt header reads "Finished 70" × 80"". Each unit counter shows "should measure 15½" × 12½" unfinished", and on reaching the target it asks "Measured right? ✓ / trim". Harmony prints an unfinished size for almost every unit.

**Why.**
- `FINISHED SIZE | 70" × 80"` (Joyous) and `35¼" × 51"` (Catwalk) are not captured.
- Harmony's "(15 1/2" x 12 1/2" unfinished)" sits beside each "Make a total of 4 Unit 4".
- A wrong unit size is the classic quilting failure *(memory)*.

**How.** Regexes on the cover / requirements and the make-lines. `kind` is stored in `craftData` (05 #17). **Effort** S. **Proof.** The three quilts asserted.

### P10. Units live in their step; the big button counts them (05 #13)
**User sees.**
- On Harmony step 8 the big button reads **UNIT 7A · 2 / 4**, and Step done becomes a link.
- The other units are a one-line chip strip.
- Units of other steps are hidden until their step.
- Making all 4 offers "Step done?".

**Why.** 18 cards at 2,223 px push Step done to y = 2,927.

**How.**
- At import, attach each unit to the step whose text names it (the parse already finds "make 4 Unit 7b").
- Render the active unit into `.stitch-btn`.

**Effort** M. **Proof.** Harmony: every unit has a step; Step done (or the unit button) is above the fold at 375×812.

### P11. The quilt top that assembles itself — the sewing centrepiece
**User sees.**
- The pattern's own layout picture (Joyous p6 "ROW 1…8"; Harmony p12 with B1, B2a–d, B3, C, H) at the top of a quilt project.
- Pieces not yet made are washed out in grey; each row or block comes back into full colour as its counter or step completes.
- At the end the whole quilt is in colour, with a celebration.
- Tap a block: its step and its count.

**Why.**
- This is the honest equivalent of crochet's live 3D. It is the thing being made, in its real fabrics, following every tap.
- Everything needed is in the PDF: a rendered page plus label positions ("ROW 1" … in the text layer, block labels on Harmony p12).
- The page is a composite of 34 clipped fabric images and 271 fills, so redrawing it from geometry is not needed.

**How.**
- A label → region map: a row band between consecutive "ROW n" labels, or a block cell from the label to the nearest enclosing path bounds in the operator list.
- Greyscale with a CSS filter, plus a clip-path per done region on a second copy.
- Where no labels exist, show no picture rather than a guessed one.

**Effort** L. **Risks.** Blocks with no labels (Catwalk); a label shared by four blocks (B3 ×4) lights one of them per unit made. **Proof.** A reviewer page (layout, regions outlined); Joyous gives 8 row bands and Harmony 13 labelled regions, asserted.

### P12. Fabric swatches from the pattern
**User sees.** Each fabric row, cutting group and shopping-list line carries the pattern's own swatch: Harmony's (A) Blue Magic panel tile, Joyous' Rounded Seeds print. The project card takes its main fabric as an accent.

**Why.**
- Crochet takes yarn colours from the pattern; sewing has none.
- Harmony p2 has 18 images labelled (A)–(P) plus two backings. Joyous p2 captions each swatch with its code (FUS-P-1208), which matches the fabric rows case-insensitively (the text layer prints "Fus-P-1208").

**How.**
- The operator list gives image bounds; the text layer gives the caption under each; crop from the stored page.
- Average colour by CIELAB, reusing `xstitch-photo`'s maths.

**Effort** M. **Proof.** Harmony 18/18 and Joyous 7 code-captioned swatches matched.

### P13. Fabric calculator and shopping list v2
**User sees.**
- "My fabric is 140 cm" when the table prints 115 / 150: "Use the 115 cm figure (2.4 m) to be safe, or measure your layout".
- **+ Shrinkage** (pre-wash %) and **+ Nap / one way** (adds the pattern's own nap figure when printed, else a warning).
- Per view (Samford: Top / Shorts / Pants).
- "Already have" against each line.
- One shopping list across projects.
- Harmony's "Additional Recommendations" (thread, 72"×72" batting, template plastic) is on it.
- The sundress fusing is listed once.

**Why.**
- Today: no own-width, shrinkage or nap handling.
- The sundress duplicates "LIGHTWEIGHT FUSING" (fabric row **and** notion).
- Harmony's notions read "none found".

**How.**
- Choosing between printed widths is honest; interpolating between widths is **not** (layouts are not linear), so never interpolate.
- Shrinkage is a multiplier on length.

**Effort** M. **Proof.** Unit tests; the sundress and Harmony shopping lists asserted line by line.

### P14. Kind-aware chrome and the parsed name (05 #17)
**User sees.**
- A bag never says "No size chart found" or shows "Sizes: none found".
- A quilt shows its finished size where garments show the size row.
- The project is named "Gathered Sundress" instead of the file name "sew-sundress" (today's result, although `meta.patternName` holds "GATHERED SUNDRESS # 1301").

**How.** Store `kind` in `normalizeData`; name from meta when the drop zone created the project. **Effort** S. **Proof.** Fixture: warnings per kind; the name equals the meta name on all 16 fixtures (blank when unknown).

### P15. Seam allowance and machine set-up per step
**User sees.**
- Mabel step 1: "SA ½"". Step 4: "¼" topstitch". A trim step: "trim to ⅛"".
- A 🦶 chip when the step names a foot (zipper, walking, buttonhole) and a needle / stitch chip from a preset (05 #16, labelled "a starting point").

**Why.** Mabel has no global SA. The 13 mm comes from "Sew across the wider short edge at 1/2" seam allowance", and its steps use ½", ¼" and "trim to ⅛"".

**How.** Measure-in-sentence rules already exist (`saMeasure`); run them per step and prefer them to the global value. **Effort** S–M. **Proof.** Mabel: per-step SA asserted; the sundress is unchanged.

### P16. Press / fuse timer and an in-pattern technique glossary
**User sees.**
- A ⏱ chip on steps that say press or fuse. It counts down from your interfacing's time (set once; default 10–15 s *(memory: typical fusible instructions)*) and buzzes.
- ⋯ → 📖 Glossary: "In this pattern" first (understitch, edgestitch, stay stitch, grade, clip, baste), plus the booklet's own PATTERN SYMBOLS (sundress p4: grainline, fold, dots, notches).

**Why.**
- Sundress: press ×18, understitch ×2, edgestitch ×3.
- No fixture gives a fusing time, so the default is the user's own.
- Knitting already has a glossary.

**Effort** S. **Proof.** A vocabulary count per fixture; timer unit test.

### P17. Fitting log and alterations that carry forward
**User sees.** Alterations as entries (where · amount · piece · why, e.g. "Lengthen skirt 3 cm at the lengthen/shorten line, Front / Back Skirt"), with an optional photo per fitting. Starting a second project of the same pattern offers "Apply last time's alterations?".

**Why.** "Forgot whether I added those 2 extra centimetres" (research A.2.2 #2); today it is one free-text box. The sheets print "LENGTHEN/SHORTEN HERE".

**Effort** M. **Risks.** Do not become a form-heavy fitting app: one line per change. **Proof.** Store round trip; backup carries photos.

### P18. On-device text recognition for image-only booklets
**User sees.**
- Dropping Westend (17 pp, image-only): "This booklet is pictures of text. Read it on this phone? (about 1 min)".
- Then the usual review, with low-confidence words underlined and every field editable.
- The Samford size letters A–P would be read too.

**How.**
- Tesseract.js (Apache-2.0, compatible with a proprietary app with a notice), vendored, with WASM core and English data served from our own host and loaded only when needed.
- Size from memory: a few MB core plus about 4–11 MB language data, cached by the service worker on first use.
- No per-user cost.
- Shares a need with cross-stitch's image-only keys (HANDOFF).

**Effort** XL. **Risks.** Phone speed; two-column pages. Gate on a confidence score. **Needs the owner**: approval to vendor and download, and a size budget. **Proof.** Westend steps against a hand transcription (ground truth file), and a word-accuracy threshold.

### P19. Sewing milestones and a sewing tour refresh
**User sees.**
- Celebrations at "Everything cut ✂️", "All interfacing fused", "Top finished" (quilt), "Binding on", "Hemmed".
- The tour walks P1 / P2 / P5.

**Effort** S. **Proof.** Unit tests on milestone triggers.

## 4. Visual centrepiece: what is honestly buildable

- **Quilts: P11.** This is the real one: the pattern's own top in its fabrics, filling in. It is buildable where the layout page has labels (Joyous, Harmony). It is not buildable from text alone.
- **Garments and bags: the step's own drawing (P1) plus a pieces board (P6).** A garment "assembly diagram that fills in" would need step → garment-region mapping that no booklet text supplies, so it would be decoration pretending to be data.
- A generated flat sketch is worse than the designer's drawing, which the user already owns.

## 5. Top 8

1. **P1 Step figure beside the step**: the drawing for the step you are on, not a whole A4.
2. **P2 Sewing working mode**: hands-free, full-screen, pedal-friendly; crochet has had it since wave I.
3. **P3 Size advisor**: my measurements → my size, then every per-size number shown once.
4. **P5 Pattern sheets join the project**: the missing cutting list, a tape-up map and "my size only" layers.
5. **P11 Quilt top that assembles**: the sewing answer to the 3D model, in the pattern's own fabrics.
6. **P6 Cutting board by fabric with an interfacing map**: what to cut from what, and what gets fused.
7. **P10 + P7 Units in their step, strips that check out**: the big button counts what I am making, and the strip maths is verified.
8. **P8 Quilt calculators wired to the pattern**: binding, backing, batting, HST / geese, resize, prefilled.

**The one thing to build first: P1.** It needs one extractor export (line boxes) and no new data. Every garment, bag and quilt step gets better, and it is the base for working mode (P2) and the quilt top (P11).

## 6. Do not build

- **Reading pattern-piece outlines to draw garments or nest a cutting layout.** Tiled pieces span up to 30 pages. The research (A.3.1, B.4.6) already rejected it: the pieces are the pattern's commercial value, and the result would be confidently wrong.
- **Printing tiled patterns or projector output from the browser.** True 100% scale from a phone browser is unreliable, and Pattern Projector and similar tools already do this well *(memory)*. Point to them, check the test square (P5), and stop there.
- **Interpolating fabric amounts between printed bolt widths, or for unprinted sizes.** Layouts are not linear; choose the safer printed figure.
- **Pattern-grading lines (drawing a blend between sizes).** P3 says which size where; drawing it needs the pieces.
- **A stash database / wardrobe planner.** It is a crowded niche (research A.2.1), and "already have" in P13 is enough.
- **Fusing times as facts.** No fixture prints one; the time is the user's.
- **Cloud OCR or LLM reading of booklets.** It breaks the no-running-cost rule. P18 is the on-device route.
- **The 3D renderer for sewing.** A solid of revolution means nothing for cut-and-sew (research B.4.6, still right).

## 7. Asks for the owner

1. **Fixtures (new):**
   - one indie booklet whose cutting list is in the booklet with mirrored / interfaced pieces and a nap column (e.g. a Closet Core or Grainline-style booklet);
   - one quilt pattern with fat-quarter requirements and many HSTs / flying geese (research A.4 names Suzy Quilts *Duval Star*);
   - one projector file with its print file;
   - one layered *women's* garment.

   Download approval needed for each.
2. **P18 decision:** may we vendor Tesseract.js plus English data (a one-time several-MB download for users who use it; Apache-2.0 notice)? Cross-stitch's image-only keys would share it.
3. **P1 / P5 need the `js/pdftext.js` owner** to expose line boxes and pass an optional-content config to `renderPage`.
4. **Default "Keep the pages" on for step and layout pages** (about 1–2 MB per booklet). This is a storage-policy decision.
5. **Units of measure default** (cm or inches first in the size advisor and calculators), research B.5 Q4, still open.
6. **A ground-truth pass for P4 / P11**: the bathers p5 chart and the Joyous / Harmony layout regions, written page by page as in wave E.
