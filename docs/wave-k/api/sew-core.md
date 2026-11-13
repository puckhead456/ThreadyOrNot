# API: sewing logic (wave K, sew-core worker)

Status: **BUILT** (2026-11-12). File: `js/sewing.js` (`window.Sewing`, ES5, pure: no DOM, no
storage, no network). Everything is **additive**: every pre-wave-K field and function keeps its
output, except the deliberate changes listed under "Behaviour changes". Feature-detect each name
(`if (Sewing.suggestSize)`). Tests: `test/sewing.test.html` (synthetic, 1197) and
`test/sewing.fixtures.html` (real booklets from `tmp-pdf/`, 946). Encrypted (owner-password)
PDFs need nothing special: `Sewing` only ever sees extracted text.

Conventions
- Quilt calculators work in **inches**; garment charts in **mm** (`cell.mm`); every result also
  carries display text in the pattern's own units. Nothing is converted silently: a converted
  figure has `approxOther: true` and its text carries "≈".
- `Amount = { m: number|null, yd: number|null, text, precut: ''|'fat eighth'|'fat quarter', included: bool, inches? }`
- Every calculator returns `why` (the formula in words, for the "≈ why" line).
- `Check` is exactly shell-ui's `CheckSheet` shape (`docs/wave-k/api/shell-ui.md` §2):
  `{ verdict:'exact'|'close'|'off'|'unchecked', title, summary, rows:[{label, printed, read, verdict, why, page}] }`,
  row verdicts `exact | computed | close | off | unknown`. Pass it straight to `ctx.check.*`.
- Functions taking `dataOrParse` accept a `Sewing.parse()` result **or** `craftData` (a string is parsed first).

## Behaviour changes (deliberate)
- `parse()` of a **bag** no longer warns "No size chart found" (P14).
- `cutTotals(d)` returns `{cut, total, rows, rowsDone, strips, stripsCut}`: a row that is the
  `parentId` of another row (a WOF strip with subcuts) counts in `strips`/`stripsCut`, **not** in
  `total`. Harmony: 183 cuts + 11 strips (was "194 pieces"). Rows without `parentId` are unchanged.
- A tiled sheet whose printing instructions used to come out as steps (pencil-skirt sheet) is now
  `kind: 'sheet'` with no steps.
- The bathers' empty body chart is now filled (`parse().sizes.chart` 3 rows, `finished` gains
  "Finished bust / waist / hip" rows before the elastic rows).

- **A step never loses text** (sew-audit): a long step carries on over as many "(continued)" cards
  as it needs; the old three-card limit and its "got shortened" warning are gone.
- `kind` also follows the pattern's own name ("… Bag" / "… Tote" → bag, "… Quilt" → quilt), and two
  quilt-only words ("flying geese" + "quilt") outweigh a stray garment word. "Bag & Straps: one
  yard" / "Lining: ¾ yard" lines are fabric rows, not notions.
- `projectName` returns '' rather than a wrong name: amounts, requirement headings ("Binding 5/8
  yard", "SIZE TABLE"), sentence fragments, and lone generic words ("Paper", the stamped "BELLA").

## New fields
`parse()` result:
- `sizeChart: SizeChart | null` (§2) · `sheet: Sheet` (only when `kind === 'sheet'`, §5)
- `cuttingList[i]`: `parent` (index of its WOF strip row, subcuts only), and on interfacing rows
  `product`, `application: 'fusible'|'sew-in'|null`, `productFrom`, `productWhy`
- `units[i]`: `step` (printed step number), `stepIndex` (index into `steps`), `size` ('7 5/8" x 6 1/4" unfinished')

`craftData` (kept by `normalize` / `toCraftData`; each written only when present, so older data is byte-identical):
- `kind: 'garment'|'bag'|'quilt'|'sheet'` (from the import; absent when unknown)
- `cutting[i]`: `product`, `application`, `productFrom`, `parentId` (a dangling id is dropped)
- `units[i]`: `step`, `stepKey` (= `Sewing.stepKey` of its step), `size`, `measured: true` (the UI's "measured right ✓")
- `steps[i]`: `origKey`, `edited: true`, `note`, `noteStale: true` (gap 7)
- `steps[i].fig`: the step's drawing (P1). `{ kind:'crop', page|null, blobKey:'p:<id>:fig:…' }` or
  `{ kind:'page', page, rect:{x0,y0,x1,y1} }` (normalised 0..1, x1 > x0, y1 > y0), plus optional
  `confidence` (0..1) and `reason` (≤ 80 chars). Anything else is dropped. A split keeps it on the
  first card; a merge keeps the first card's (or brings the second card's up); a re-import keeps
  it while the step's text is unchanged. `imageRef` is still kept as before.
- `measurements.mine[i].unit: 'cm'|'in'` (optional; `value` stays a string like "97" or "97 cm")
- `swatchColours: { [fabricIndex 0–99]: '#rrggbb' }` (sew-extras' colour chips; other keys / values dropped; hex lower-cased)
- `swatches: [{ index, blobKey, colour:'#rrggbb'|null, spread:0..1|null, clean }]` (sew-visual's SwatchBitmap; ≤ 40)
- `quiltModel: QuiltModel` (sew-visual's shape, `mode` 'vector'|'picture'; kept whole up to 60 KB of JSON)
- `fitting: [Alteration]` (§10) · `sheet: StoredSheet` (§5) ·
  `fabricPrefs: { width:{value, unit:'cm'|'in'}, shrinkPct (0–30], nap:true, view, unit:'metric'|'imperial', wof (30–120, inches), fuseSeconds (1–600) }`

## 1. Numbers and units
- `Sewing.measure(text, defaultUnit?)` → `{ value, unit:'cm'|'mm'|'m'|'in'|'yd', mm, text } | null`
  ('33 1/2"', '84cm', '1½ yd'; a bare '97' needs `defaultUnit`).
- `Sewing.dualCell(text)` → `{ cm, inch, ok, delta, text } | null` ('84cm/33"', '76 cm/30';
  `ok` when |cm − in × 2.54| ≤ 1.3).
- `Sewing.amountOf(text)` → `Amount | null`.
- `Sewing.splitGlued('14256')` → `[142, 56] | null` (kept only where cm ÷ 2.54 ≈ in).

## 2. Size charts (P4) and the size advisor (P3)
`Sewing.readSizeChart(textOrParseOrData)` → `SizeChart | null`
```
SizeChart = { labels:['XS',…], orientation:'rows'|'transposed', units:'cm'|'in'|'dual'|'',
  namesFrom:'rows'|'caption'|'header', unitGuessed:boolean,
  rows:[{ label:'Bust', kind:'body'|'finished', page|null,
          cells:[{ mm|null, cm|null, inch|null, text, ok, why? }] }],   // one cell per label
  check: Check }
```
Elastic / cut-to-size charts are not in it (see `resolveSize`). A chart printing no unit is read
from the size of its numbers and the check says so (`unitGuessed`).
`Sewing.checkChart(chart)` → `Check` (row grows with the size; cm and inches agree; unread cells).

`Sewing.sizeRule(sourceText)` → `{ text, prefer:'larger'|'smaller'|'grade'|'closest'|null, slightly:boolean, slightlyText?, page } | null`
— exactly the one sentence that states the between-sizes rule, verbatim, with its page (a heading
the column text ran through is taken out; a run-on is cut back to the clause, marked "…").
`slightly`: the pattern also says "only slightly different → closest", quoted on its own in
`slightlyText`. `prefer: null` when the rule is conditional ("size up for woven, down for knit").
`page` is the page of the sentence's first letter (a rule that opens a page is on that page).
A "SIZE CHART (cm)" / "Size table (inches)" heading sets the chart's unit (no `unitGuessed`).

`Sewing.suggestSize(chartOrParseOrData, mine, opts?)` → `SizeAdvice`
- `mine`: `[{label, value, unit?}]` (`craftData.measurements.mine` works as is) or `{Bust:{value, unit}}`.
  Labels go through the chart's own names (Hips → Hip, Chest → Bust).
- `opts.rule` overrides `sizeRule` (pass `null` for "no rule"); `opts.unit: 'in'` for inch wording.
```
SizeAdvice = { rows:[{ label, mineMm, at:'exact'|'between'|'below'|'above', sizes:[..], index, size, nearest, why }],
               suggestion: { size, blend:[{label, size}] } | null,
               rule, ease:[{label, mm, negative}], why, chosen:false }
```
Never chosen silently. Sundress 97 / 79 / 104 → 42 with a 44 hip; bathers 92 / 102 → M, ease −15 cm.

`Sewing.resolveSize(dataOrParse, size)` → `{ size, index, items:[Item], unresolved:[{what, where, why, page}] }`
`Item = { what, where:'fabric'|'elastic'|'finished'|'body'|'step'|'notion'|'cutting', value, text, page|null, step|null, check? }`
Fabric per width; finished and body rows; a cm row + inch row of one chart is one item
('66 cm / 26"'); "a (b, c)" runs inside steps, notions and cutting notes. `check` is a plain
sentence when the page's own figures disagree or look cut off ('70.'). Bathers at M: 4 elastic
items, 2 fabric items, 0 unresolved.

## 3. Fabric calculator and shopping list v2 (P13)
`Sewing.fabricNeed(dataOrParse, opts)` → `{ lines:[FabricLine], uncovered:[{name, why}], notes:[string] }`
- `opts = { size?, view?, width?:{value, unit}, nap?:bool, shrinkPct?:number, unit?:'metric'|'imperial' }`
  (`size` defaults to `craftData.size.chosen`; `craftData.fabricPrefs` is the place to keep these).
- `FabricLine = { name, view, printedWidth, amount:Amount|null, base:Amount|null, covered, why,
  nap:'printed'|'not printed'|null, shrink:{pct, amount:Amount}|null, approx }`
- Uses the widest printed width not wider than yours; never interpolates. Narrower than every
  width → `uncovered` "lay the pieces out and measure". A row named "… (with nap)" / "one way" is
  the nap figure; otherwise `nap:'not printed'` and a sentence, never a number.

`Sewing.shoppingListV2(dataOrParse, opts)` → `[{ section:'fabric'|'notions'|'thread'|'other', text, have, id|null, page|null, why|null }]`
(opts as `fabricNeed` plus `fabric / notions / thread / extras: false` toggles). Adds the
"Additional Recommendations" lines (`Sewing.extraSupplies(text)` → `[{text, page}]`), lists a
fusing once, adds "Thread to match" only when nothing mentions thread. v1 `shoppingList` is unchanged.
`Sewing.mergeShopping([list, …])` → `[{section, text, have, from:[listIndex], times}]` ("(×2)" appended).

## 4. Cutting board (P6 / S5) and strips (P7)
`parse()` also reads, when the ordinary reader found nothing: a numbered **piece inventory**
('4 – Cuff (long), cut x2 pair + interfacing' → 4 cuffs + 4 interfacing rows, note 'long'; rows
carry `number`) and Shannon-style **rectangles** ('- 1 (19" x 48"), Robe Front.' under 'From the
Main Cuddle®, cut:', '2 Hood Linings*, 1 main, 1 reverse' → `grain:'mirrored'`; rows inside a
"To make the Curvy size" box get note 'Curvy size only'), and bulleted yardage under "Fabric
Requirements" with no table.
`Sewing.napNotes(text)` → `[{ text, page }]` (the booklet's nap-direction sentences);
`stepSetup(...)` gains `nap: boolean` and a `{kind:'nap', label:'Nap direction'}` chip.
- `Sewing.cutProduct(row, dataOrParse)` → `{ product, application, from:'saved'|'cut line'|'next lines'|'piece name'|'only one on the list', why } | null`
  (null for a fabric piece). Parse rows already carry it.
- `Sewing.fuseList(text)` → `[{ text, pieces:[string], interfacing, page }]` (Mabel: 4 pieces).
- `Sewing.dims(text)` → `{ w, h|null, unit:'in'|'cm', wof } | null` ('3 1/2" x WOF strip', '6 3/4" tall x 7 5/8" wide', '5 1/4" square').
- `Sewing.linkSubcuts(rows)` → rows (sets `parent`, and `parentId` when rows have ids).
- `Sewing.stripCheck(stripRow, subRows, {wof:40})` →
  `{ strips, stripWidth, wof, need, yield, perStrip, minWof, verdict:'exact'|'close'|'off'|'unchecked', why, unchecked }`
  (first-fit packing; `close` = fits with < 1/2" to spare; `minWof` = the usable width that makes it fit).
- `Sewing.cuttingBoard(dataOrParse, {wof})` →
  `{ groups:[{ key, label, kind:'main'|'contrast'|'lining'|'letter'|'interfacing'|'batting'|'other', letter?, product, application, rows:[BoardRow] }], fuse, totals }`
  `BoardRow = { id, piece, qty, cutCount, mirrored, onFold, dims, parentId, subcuts:[id], check:stripCheck|null, product, application, productFrom }`
  Order: main, contrast, lining, Fabric A…, interfacing products, batting, other. Notions that are
  really cut pieces ('Fusible Fleece (2) 10" x 12" rectangles') join as rows with ids `n<i>`
  (not in `totals`). Parse rows get ids `r<i>`.

## 5. Pattern sheets (P5)
`Sewing.readSheet(text, { pageSizes?:[{w,h}] points, layers?:[name] })` → `Sheet`
```
Sheet = { pieces:[{ name, number|null, pages:[n], cuts:[{ qty, how:'pair'|'fold'|'x', material:'main'|'lining'|'interfacing', note }] }],
          tiles: TapeMap | null, test:[{ text, size, page }], print:[string],
          paper:'A0'|'A1'|'A2'|'A3'|'A4/Letter'|'large format'|null, copyShop?:true,
          layers:{ sizes, always, other } | null, check: Check }
TapeMap = { rows, cols, rowLabels, colLabels, tiles:[{label, page, row, col}], missing:[label],
            order:'row-major', marks:'tiles'|'joins', ownLabels, firstPage, check:{consistent, of} }
```
`TapeMap` is sew-visual's shape plus `marks`, `ownLabels`, `firstPage`, `check`. Three printings:
one label per page ('Page 1A', Tiana's: `missing` = grid cells no page prints), own + neighbour
labels (sundress 1a–5f: 5 × 6), and labels at the **joins** (pencil skirt 1A–4D: a 5 × 5 grid,
`marks:'joins'`, tile labels are the app's own 'A1'…, `ownLabels:false`).
Cut `how` may also be `'mirror'` ("cut 2 mirrored"). A piece printed again on a "PATTERN LAYOUT"
page is one piece; layer size labels glued to a name ("Size: LSize: S…FRONT") are stripped. `print`
holds whole sentences; `test[].size` the ruler's label ("10 centimeters").
`Sewing.layerSizes(names)` → `{ sizes, always, other }`. `Sewing.attachSheet(craftData, sheet)` →
boolean: stores `craftData.sheet = { pieces, tiles, test, print, paper, layers, taped:{label:true} }`
keeping `taped`. Sheet-only imports get it from `toCraftData` automatically.

## 6. Quilt maths (P7–P9)
`Sewing.quilt.*` (inches; `null` without a size):
- `binding({w, h, extra=10, stripWidth=2.5, wof=40})` → `{ length, strips, yards, stripWidth, wof, why }`
- `backing({w, h, margin=4, wof=42})` → `{ widths, lengthIn, yards, orientation, wof, why }`
- `batting({w, h, margin=4})` → `{ w, h, why }`
- `hst(finished, 2|4|8)` → `{ method, cut:[{what, size, qty, note}], exact, yield, unfinished, why }`
  (2: f + 7/8; 4: √2(f + 1/2) + 1/2; 8: 2(f + 7/8); sizes rounded up to 1/8")
- `qst(finished)` → f + 1 1/4 · `geese(fw, fh, 1|4)` (1: rectangle (fw+½)×(fh+½) + 2 squares fh+½;
  4: one square fw + 1 1/4 and four fh + 7/8) · `resize({w, h, block:{w,h}, addRows, addCols})` → `{ w, h, ratio, approx:true, why }`
`Sewing.quiltFacts(dataOrParse, {wof})` →
`{ finished:{w, h, text, page}|null, blocks:[{w,h,text}], binding:{ printed:{length, stripWidth, fabric, strips, page}|null, calc, check },
   backing:{ printed:[{name, amount, wof}], calc:[…], check }, batting:{ printed:{w,h,text}|null, calc }, wof }`
`check = { printed, read, verdict, why }`. Joyous: 310" exact; backing 5 yd within the printed 5½.
Catwalk: 182½ vs printed 184 = `close`; backing fits only at 44" = `close` (and says so).
`Sewing.unitSizes(text)` → `{ 'Unit 2a': { w, h, text, unfinished:true }, … }` (ranges 'Units 1a-1h' expand).
- `hst(f, 2, {trim:true})` → finished + 1" squares and `qst(f, {trim:true})` → finished + 1 1/2": the
  "cut big and trim" convention Moda prints (7" squares for a 6" HST, 10 1/2" for a 9" QST).
- `Sewing.unitCutCheck(text)` → `Check` ("Triangle units against the formula"): each printed
  "(n) Z" SQUARES FOR HST/QST" against its "T" HST (F" FINISHED)" on the same page; exact
  (+ 7/8" / + 1 1/4"), close (the trim convention, said), off (differs).
- `quiltFacts` also reads "Quilt is 67 1/2" x 72 1/2"", "Size: 58"x 83"" (never "Cut Size:"),
  "Binding: cut 8–2½"x WOF", "9 - 2 1/2" x width of fabric strips (binding)" and a "Backing 5 yards"
  line with no fabric row. A backing up to 1/4 yd under the 4"-a-side formula is `close` (it fits
  with 3" a side, and the `why` says which). Printed amounts are quoted as printed (4 1/3, not 4 3/8).
- Glued fraction glyphs (Moda): '21/2"' is 2 1/2" and '12/3 YARDS' is 1 2/3 everywhere a number is
  read (`measure`, `amountOf`, `dims`, the calculators' inputs).

## 7. Units in their step (P10 / S3)
`Sewing.stepKey(step)` → `origKey-or-textKey + '#' + n` (stable across edits and re-imports).
`Sewing.unitsForStep(craftData, stepIndex)` → `[unit]` (by `stepKey`, else by printed `step`).
`Sewing.activeUnit(craftData)` → `{ unit, index } | null`: the first unfinished unit of
`currentStep` — what the working-mode button counts. Harmony: all 18 units have a step.

## 8. Quilt-top model (P11 / S2)
`Sewing.quiltTop(dataOrParse)` →
`{ rows:[{ n, cells:[{ fabric:'B', size:'3 1/4"' }] }], blocks:[{ label:'B2a', name:'Block 2a', count, step|null, unitId|null }],
   layoutLabels:[{label, page, count}], fabrics:[{ letter, name, code }], layoutPage|null, counts:{blocks?, rows?},
   source:'rows'|'labels'|'counts'|'none', why }`
Catwalk: 13 rows of fabric letters. Harmony: p12 labels (B3 ×4). Joyous: 14 blocks / 8 rows
(picture layout). Text only: sew-visual locates and draws it.

## 9. Kind, name, per-step set-up, glossary, timer (P14–P16)
- `Sewing.vocab(kind)` → `{ unit, units, piece, pieces, sizeWord, showSizes, showFinished, kindWord }`.
- `Sewing.projectName(parse, fileName)` → 'Gathered Sundress' | '' (never the file name).
- `Sewing.stepSetup(stepText, craftData)` → `{ sa:{mm, inches, text, source:'step'|'exception'|'pattern', part?}|null,
  trims:[{mm, text}], topstitch:[{what, mm, text}], foot:string|null, footWhy, press, fuse, chips:[{kind:'sa'|'trim'|'topstitch'|'foot'|'fuse'|'press', label}] }`
  (`footWhy` 'the step names it' or a reason; a suggested foot is a suggestion).
- `Sewing.glossary(text)` → `{ inPattern:[{term, count, def}], booklet:[{term, text, page}] }` (defs are the app's own words).
- `Sewing.pressTimer(stepText, seconds|null)` → `{ kind:'fuse'|'press', seconds|null, why } | null` — no default time is invented.

## 10. Fitting log (P17), milestones (P19)
`Alteration = { id, at, amount:{value, unit:'cm'|'in'}|null, piece, why, date:'YYYY-MM-DD', photo:blobKey|null, carried }`
`Sewing.addAlteration(craftData, entry)` → Alteration | null (≤ 100) ·
`Sewing.carryAlterations(fromData, toData)` → number copied (marked `carried`, photo not copied).
`Sewing.milestones(before, after)` → newly reached of `['all-cut','all-fused','top-finished','binding-on','hemmed']`.

## 11. What was missed (gap 8)
`Sewing.importCheck(parse, { emptyPages:[n|string], pages?, wof? })` → `Check` titled "What was
read". Rows: `Steps` (read N of M, or "made from paragraphs"), `Step n` missing with the page
around it, `Not in any step` (a sewing sentence between the first and last step that no card
holds, with its page), `Page(s) a–b` pictures, `Text` (image-only booklet), `Cutting list`
(on the pattern sheets), `Size chart · …`, strip rows (`Fabric E · 2 × …`), `Binding`, `Backing`,
units with no step. Verdict `off` when something did not add up, `close` with only things to check.
Tote: "Cut off your zipper excess." on page 4; Westend: "Mostly pictures of text: 14 of 17 pages".

## 12. Step edits and notes (gap 7)
`Sewing.editStep(craftData, index, text)` / `Sewing.setStepNote(craftData, index, note)` → boolean
(pure; call inside `Store.updateCraftData` for one undo step; `''` removes a note). A re-import
(`toCraftData(parse, existing)`) puts back the edited text, the tick and the note while the
printed text is unchanged; a note whose step text changed lands on the step with the same
printed number with `noteStale: true`. Stored in `craftData.steps` (backed up with the project).
