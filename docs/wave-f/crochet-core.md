# Wave F — crochet core (`crochet-core`)

Owner files: `js/patterns.js`, `test/patterns.test.html`, `test/patterns.fixtures.html`,
`test/templates.test.html`, `test/crafts.test.html` (unchanged), `css/app.css` (Edit only),
and the crochet counter / part editor / pattern sheet / import preview regions of `js/app.js`
and the project / part / counter / import functions of `js/store.js` (Edit only).
Plus the coordinator's mid-wave request: `Store.updateCraftData(..., {undo: false})`, with its
assertions in `test/store-safety.test.html`.

## Suites (all run after the last edit, in my own tab)

| suite | baseline | now |
|---|---|---|
| patterns | 976 | **1009 / 0** (+33) |
| patterns.fixtures | 780 | **797 / 0** (+17) |
| patterns.fixtures `?heavy=1` | 795 | **812 / 0** |
| templates | 94 | **123 / 0** (+29) |
| crafts | 124 | 124 / 0 |
| store-safety | 226 | **236 / 0** (+10, the updateCraftData request) |
| backup | 104 | 205 / 0 (raised by the shell agent; green with my store changes) |
| diagram-model | 521 | 529 / 0 (raised by the 3D agent; green) |
| diagram (+ reference fixtures) | 193 / 230 | 242 / 0 (consumer of `expand`, checked) |

## 1. Size-once (brainstorm 4, 03 #1, 03 #13, 03 #14)

**As the user sees it.** Dropping a multi-size PDF into New project (or ⋯ → Import pattern) shows
a **"Your size"** chip row above the sections: the leaflet's own names (`XS/S M L XL 2/3XL 4/5XL`,
`4-6yrs … Adult S Adult L`, `XS (S, M, L, 1X) (2X …)`), arrow keys move inside it (roving
tabindex, `role=radiogroup`). Until a size is picked each section says "pick your size for
targets" and Save / Create parts nudges ("Pick your size first", the chips shake, focus moves to
them) — a nine-size cardigan can no longer be made silently in XS. After the pick every row
target, stitch target and the per-part confidence line in the preview are that size's. The toast
says "· size L". In the counter the row label reads **"ROW · L"**; the chosen size's number is
**marked** in every size list in the pattern line, the setup line and the pattern sheet
(`blo sc 88 (<mark>100</mark>, 108)`); the sheet starts "Your size: L" and dims the per-size
blocks that are not yours ("Size XS:" … "Size 5X:", "Sizes M, L … only:", "For 2nd, 3rd … sizes
only"). In the part editor the **Size** select sets the **project's** size (hint: "Saving makes M
the project's size: every part's counts and targets follow, and progress stays"), with an "Only
this part" switch for the body-in-L-sleeves-in-M case. Saving moves every part; rows, stitches and
pieces are untouched; a target that was the pattern's reading follows the size, a target typed by
hand never moves ("Size M for the whole project · 1 target updated").

**Honesty rule — lists that are not one number per size.** `Patterns.parse(text, {size,
sizeCount})`: when the document names N sizes, a list of any other length resolves to **no
count** (`line.sizeUnresolved = true`) instead of the clamp's guess, and nothing is computed from
it. The Wheat Stitch cardigan is the case: its panels print `184 (208, 224)` — three LENGTHS
("For 23 (26, 28)"") against nine body sizes; size L used to count against the 28" length's 224.
Now the counter shows no stitch bar there and says "Pattern lists 184 / 208 / 224 here — not one
per size", the pattern sheet says "no count for your size", and the "? why" badge explains. Row
targets still resolve per size (First Section 25 / 29 / 33 / 37 …). Without `sizeCount` the parser
reads exactly as before (the whole old corpus is unchanged — checked by diffing every row count
of every multi-size fixture with and without it: only the cardigan's panels differ).

**Parser rules added** (`js/patterns.js`): `sizeLabelLine` (Yarnspirations "Sizes XS/S M …",
Stylecraft "To Fit 4-6yrs … Adult S Adult L", each token checked so hook sizes and "To fit chest
measurement" are no size list); `SIZE_COUNT` / `sizeListFits` (above); a size list whose second
bracket wrapped onto the next line is joined ("| 58 (58, 62, 64, 66)" / "(68, 72, 72, 74) sts" —
the Wheat Stitch Sleeves read five sizes of nine); `Patterns.sizeMarks(text, size, sizeCount)`;
`Patterns.sizeScope(text, names)`.

**Store** (`js/store.js`): `Project.size: {index, label} | null` (normalized, additive — no
backup migration; survives a backup round trip, asserted); `Store.setProjectSize(id, index)`
(one snapshot, re-derives pattern targets and an `untilRows` repeat that was the old suggestion,
returns `{index, label, retargeted}`); `Store.partSize(proj, part)` → `{index, label, source:
'project'|'part'|null, names}`; `Store.sizeNames(proj)` (document names, else "Size 1..N");
`importPatternSections(..., {size})` sets `Project.size`, every touched part's `sizeIndex` and
reads its target at that size, returning `sizeSet`; `addPart` inherits the project size;
`targetRowsFromText(text, size, sizeCount)`; the line cache passes `sizeCount` (=
`Project.sizes.length`, a probe part may carry its own `sizeCount`). `Part.sizeIndex` keeps its
meaning (no new part field): the project size is written into every part, a part set on its own
simply differs from `Project.size.index`.

## 2. Colour changes to the counter (brainstorm 8, 02 #3, 10 #1)

**As the user sees it.** The pattern line's tag carries a small swatch of the yarn the row is
worked in ("● RND 15"). On the row where the yarn changes a one-line strip appears above the
pattern line: "○ → ● **Change to black at the end of this round**" (a change written as "changing
to black in last 2 loops" / "join with Yarn B at end of final st"), or "● **Change to Burgundy**"
(a row that starts in a new yarn). It is announced once with the row milestone under the one
announcement policy ("Round 14 done. Change to black at the end of this round"). Swatches use the
owner's yarn colour, else the colour word; an unknown shade gets a dashed outline, never a
made-up colour. The strip costs one line; on that row the instruction clamps one line tighter, so
the counter still fits with **0 px overflow at 375×812 and 375×640** (measured).

**Parser rules** (`js/patterns.js`), shared with the 3D piece:
- A change made at the END of a row (`C_END_RE`: "in last 2 loops", "in last st", "last st of R5",
  "at end of final st / row") colours the NEXT row (`state.pendingColor`), so the panda's Rnd 15 is
  white and Rnd 16 on black, as in the photo. **This changes one wave A unit test**
  ("changing to black in last 2 loops sets the row colour" → now asserts this row keeps the old
  colour and black is pending), with the reason in the test.
- `C_YARN`: "Using Yarn A", "join with Yarn B", "joining with Yarn C", "re-join Yarn I", "pick up
  Yarn A", "continue with Yarn D"; resolved through the key.
- King Cole's two-range yarn table "Azure (3366) x 2 A Turquiose (4044) x 3" is the key
  (`A = Azure / Turquiose`; "Violet … E Violet" is said once); legends may hold "X / Y";
  `colorHex("Hot Pink / Fuchsia")` takes the first known shade.
- Generic roles are colour names: "Starting in secondary color", "CC to main color" (`C_ROLE`,
  `cc to` in `C_CHANGE`, `NOTE_KEY_RE`).
- A colour change that names its round ("CC to main color in last stitch of R12", printed under
  the last round) is that round's note; a paragraph carrying an end-of-row change ("to end, join
  with Yarn B at end of" / "final st, turn.") is the tail of the row above it (`notesAfter`), not a
  note for the next row — every King Cole colour was one row late.
- King Cole's 30-character column: "to end, …", "end of final st …", "at end of …", "final st …"
  continue the row; "…joining with" / "Yarn C at end of row." is one row.
Ground truth checked against the PDF text: King Cole rows 1–40 (A; Row 2 ends B; 4 C; 5 D; 6 E;
7 F; Row 8 "Repeat Row 6 joining with Yarn C"; 10 G; 12 H; 16 I; 18 B; 20 re-join I … join F;
28 join A … G; 30 pick up A … C), panda, baphomet (Arms/Tail/Ears/Feet), Persian Tiles, hood, bee.

**Store**: `Store.colorPlan(part)` (one `expand` walk per parse + repeat, cached — never per tap)
and `Store.rowColorInfo(part, row)` → `{color, change: {to, at: 'start'|'end'} | null}`.

## 3. Computed ≠ stated badge + import confidence line (brainstorm 3, 06 #1, 06 #8)

- `Patterns.countReport(lines)` → `{rows, printed, computed, missing, unresolved, disagree:
  [{row, rowEnd, printed, computed, text}]}`, counted per ROW; `Store.countReport(partOrText)`.
- **Import preview**: one line under each section — "10 counts computed ≈ · 1 count disagrees with
  the pattern" (red when something disagrees or is unresolved), "every count printed", and
  "×2 (from the assembly text)" for `makeCountInferred` (wave E's field is now shown; the Store's
  `splitSections` used to drop it).
- **Part list** (⋯ → Parts): the same line per part ("11 rounds · 7 counts computed ≈ · made twice
  (from the assembly text)"). `Part.makeCountInferred` is kept on the part (present only when true,
  dropped when the owner changes the count).
- **Part editor**: the line, plus up to three "Rnd 29: pattern says 36 · instructions add up to 24".
- **Counter**: a small **"≈ why"** badge rides at the end of the stitch readout (no extra height)
  whenever the count is computed, contradicted by its own arithmetic ("≠ why"), not given for the
  size ("? why") or the row number is approximate (below). Tap → a sheet with the reason in words,
  the line itself (size-marked) and the part's confidence line. The pattern sheet tags those lines
  ("says 36 · makes 24", "no count for your size").

## 4. Tap the row number to set it (03 #6)

`#row-number` becomes a control from JS (index.html untouched): `role=button`, `tabindex=0`,
Enter/Space, `aria-label` "Rounds done: 14. Set the round count". It opens **"Set the round
count"**: − / number field / +, pre-filled with the number the counter shows (rows completed),
focused and selected, live hint "The counter will show 12 — you will be working row 13 of 56,
stitches back to 0", Enter or Set → the same undoable `Store.jumpToRow` as the pattern sheet's
Jump, announced "Working row 13". Capped at the part's target.

## 5. "Until N rows" repeats and garment residuals (03 #5)

- `Part.repeat.mode: 'times' | 'untilRows'` + `untilRows` (normalized; `times` is kept in step so
  every reader of the plain field — repeat readout, diagram row mapping — is unchanged;
  `Store.repeatTimes(r)`). `applySuggestions` keeps "Repeat Rows 5-8 until there are a total of 25
  Rows" as `untilRows` 25. The part editor's Repeat section has "N times | Until N rows total" with
  a live "Rows 5–8 worked 5 times (5–24)" hint. `setProjectSize` moves an `untilRows` that was the
  old size's suggestion to the new size's.
- A repeat between written rows fills the hole for the target ("Repeat Rows 5-8 until … 36 Rows"
  then "Next Row" = 37): the Wheat Stitch Second Section now gets 25 / 29 / 33 / 37 … like the
  First Section. One written row continued by a repeat is a target too (Caron Cardigan block, 7).
- **Caron "Cont even in pat until work from beg measures 13"".** The two printed lines are joined
  into one length sentence. I did **not** renumber the rows after it off the gauge, and the reason
  is written in the code: "from beg" is the foundation of the *Cardigan* block — eight rows before
  the sleeve section's own "1st row", which a section cannot see. At the document gauge (12 hdc
  and 10 rows = 4") 13" is ~33 rows from that foundation, i.e. ~25 in the sleeve's numbering —
  within a row of what the parser already counts (Next 6 rows = 25–30). So the rows after an
  unresolved length keep their count and carry `approxRow`; the sentence carries `lengthEstimate:
  {value, unit, rows, gauge, fromStart}`. The counter shows **"≈ Row 25"** and the "≈ why" sheet
  says so ("…your real row number may differ … set the row count by tapping the big number").
  Bernat lace Body rows after "Cont in pat until work from beg measures 10"" are marked the same.
- Row totals read off a tape measure through a gauge are shown as estimates: import preview
  "→ target ≈ 89", counter bar "24 / ≈ 89" (`Store.targetApprox(part)`; a hand-typed target is
  never ≈). `summary().lengthRows` says when it applies.
- AllFree designs still unnamed: not attempted (their headings are design titles / lowercase labels;
  no general rule I could defend).

## Also

- **Pattern sheet** no longer lists a wrapped line twice (lines the parser merged into the row
  above — `consumed` — were shown again under it).
- **Coordinator request — `Store.updateCraftData(id, patchOrFn, {undo: false})`** (alias
  `undoable: false`): no snapshot, no `updatedAt` / touch-day bump (view state is not work), written
  through the same `save()`, so revision / writerId and the multi-tab rules are unchanged.
  store-safety asserts: the write applies, the undo stack stays empty (0 bytes), `updatedAt`
  unchanged, the revision bumps, it persists with this tab's writerId, the alias and a patch
  object work, a plain call still snapshots, and undoing a real write keeps the silent view state.

## Verified in the pane (own tab, 375×812, and 375×640 for the counter height)

Projects made through **New project** from tmp-pdf PDFs (later in an isolated storage key via
`Store.__setKeyForTests`, because other agents' tabs kept switching the shared profile):
- `crochet-patons-mesh-cardigan.pdf`: size chips, Save nudge, pick M → "ROW · M", Body row 1
  "158 (**176**-194-…)" marked, stitch target 176; Set-row sheet (typed 12 → Enter → "Working row 13").
- `cardigan.pdf` (Wheat Stitch, 9 sizes) at L: First Section "0 / 37", no stitch bar, "Pattern lists
  184 / 208 / 224 here — not one per size", "? why" sheet; Sleeves sheet "Your size: L", 64 marked,
  Size XS/S/M/1X… blocks dimmed and Size Large not; part editor → M for the project → toast
  "Size M for the whole project · 1 target updated", First Section target 33, every part sizeIndex 2.
- `crochet-panda.pdf`: Body Rnd 15 strip "○ → ● Change to black at the end of this round",
  announcement on completing Rnd 14, Rnd 16 swatch black without a strip; overflow 0 at 812 and 640;
  parts sheet confidence lines with "made twice (from the assembly text)".
- `crochet-kingcole-festival-uk.pdf`: Row 2 "● → ● Change to Hot Pink / Fuchsia at the end …",
  "≈ why" on computed rows; rows 1–12 plan as listed above.
- `crochet-caron-cuff-cardigan.pdf` at L (picked with the arrow keys): Shape Sleeve "24 / ≈ 89",
  "≈ Row 25", "≈ why" sheet text.
- `crochet-baphomet.pdf` preview: Body/Head line "18 counts computed ≈ · 1 count disagrees with the
  pattern" in red.
No console errors.

## Contract summary (for the docs agent)

- `Patterns.parse(text, {size, sizeCount})`; line fields `sizeUnresolved`, `notesAfter`,
  `approxRow`, `lengthEstimate`; repeat field `repeatFromLength`; `summary().lengthRows`.
- `Patterns.sizeMarks`, `Patterns.sizeScope`, `Patterns.countReport`; `detectSizes` reads the
  "Sizes …" and "To Fit …" lines; `expand` state `pendingColor` / `pendingFrom`.
- `Project.size`; `Part.repeat.mode` / `untilRows`; `Part.makeCountInferred` (optional).
- `Store.setProjectSize`, `partSize`, `sizeNames`, `countReport`, `targetApprox`, `colorPlan`,
  `rowColorInfo`, `repeatTimes`; `targetRowsFromText(text, size, sizeCount)`;
  `importPatternSections(..., {size})` → `sizeSet`; `updateCraftData(id, fn, {undo: false})`.
- App: `importPicker({initialSize})` → `size()`, `needsSize()`, `focusSize()`.
- SPEC "Notes attached to rows": a note with an end-of-row change attaches to the row ABOVE.

## Still open / decisions for the coordinator

1. **Two size axes.** The Wheat Stitch panels' length choice (23/26/28") is a second axis the app
   cannot pick yet, so those rows have no stitch target at any size (honest, but a maker who knows
   their length gets no bar). A "length" picker would need a per-axis size model.
2. **Wave A colour semantics changed** for "changing to X in last st/loops" (next row, not this
   one). The 3D piece follows (panda Rnd 15 white). If the 3D owner prefers the old reading, the
   switch is the `hit.end` branch in `applyPhrases`.
3. Templates saved from a multi-size import do not carry the size names, so a project made from
   such a template offers generic "Size 1..N" (it still resolves every list).
4. The size strip text truncates on long two-range shade names ("Change to Hot Pink / Fuchsia at
   the end …"); the full sentence is the strip's aria-label and the announcement.
5. AllFree design names and the Caron gauge renumbering are deliberately not done (see 5).
6. Part editor "project size" save is two undo steps (part edit + size).

## Follow-up (coordinator round 2)

- **Templates carry sizes.** `Template.sizes` (the leaflet's names) and `Template.size` (`{index,
  label}`, the size picked at import) — present only for multi-size templates, so older templates
  and built-ins are byte-identical. `templateFromProject` drafts them, `saveTemplate` keeps them
  (an edit that does not mention them keeps the saved ones; the template editor and New project's
  "Also save as a template" pass them on), and `createProject` from such a template sets
  `Project.sizes` / `Project.size`, every part's `sizeIndex`, and each part's target at that size.
  So a project made from the template offers "XS/S M L …", not "Size 1..N". Survives a backup round
  trip. Decision 3 above is closed.
- **One undo step.** `Store.updatePartWithProjectSize(projectId, partId, patch, sizeIndex)` takes
  ONE snapshot: the box's pattern text first, then the project size (every part, pattern targets
  follow), then the rest of the sheet (a typed target still wins). Returns `{part, size}`. The part
  editor's Save uses it when the Size select is the project's size. `updatePart` /
  `setProjectSize` take a Store-internal `{noSnapshot: true}` fourth / third argument for this.
  Decision 6 above is closed.
- Decisions 1 (Wheat Stitch panels show no target without a length axis) and 2 (a change in the
  last loops colours the next row) stay as built.
- Suites: templates **133 / 0** (+10: draft / save / edit / create / names / backup round trip of
  the template size; one Undo restores both the part edit and the size), store-safety 236 / 0,
  patterns 1009 / 0, crafts 124 / 0, backup 205 / 0, diagram-model 529 / 0 (one run showed a
  68.5 ms build against the 60 ms budget while other agents loaded the pane; the re-run was green).

## For the owner of `index.html`
- Optional: make `#row-number` a real `<button class="big-number">`; app.js adds `role=button` /
  `tabindex` / key handling today and would keep working either way.

## For the owner of `docs/CRAFTS.md`
- `Store.updateCraftData(id, patchOrFn, { undo: false })` for view state (see above); the
  cross-stitch module can switch `saveViewState` to it.
