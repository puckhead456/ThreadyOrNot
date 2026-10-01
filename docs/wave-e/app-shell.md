# Wave E — app-shell

Owner files: `js/app.js`, `index.html` (untouched), `css/app.css`, `css/themes.css` (untouched),
`js/tour.js`, `js/blobstore.js` (untouched), `test/store-safety.test.html`, `test/backup.test.html`,
and `js/store.js` outside the diagram-model section. Plus one property on the cross-stitch
registration in `js/app-xstitch.js` (task 3, see "For the owner of app-xstitch.js").

## How this was checked

The whole crochet flow was walked at 375×812 (and 375×640) in the Browser pane, with two projects
made through **New project** by dropping the real PDFs: `tmp-pdf/crochet-panda.pdf` (amigurumi,
7 sections) and `tmp-pdf/crochet-stylecraft-hood.pdf` (granny-square motif, "Make 8"). Every
readout was compared with the parsed model and with the PDF itself (read with the Read tool):
the import preview list, the home card, the part list, per-round targets (all 71 panda rounds),
the counter readout, the row/round header, progress, the ⤢ viewer header and shape line, the
finish flow, projects made from the saved templates, and the backup import preview sheet.

Panda ground truth (PDF): Body 20 rnds 6·12·18·24·30·36×7·30×3·24×3·18×2, Head 21, Arm 11,
Leg 9, Tail 3, Ear 5, Eye 2 — every per-round target the counter shows matches (checked round by
round through the Store). Hood: Motif (make 8), Foundation Rnd + 1st/2nd/3rd Rnd + "Rep 3rd Rnd
3 times" = 6 counted rounds after the foundation (the leaflet's own tension line says "6 rnds to
16cm"), UK terms.

## Discrepancies

| fixture | part / screen | PDF says | app said | fixed? | assertion |
|---|---|---|---|---|---|
| hood | Motif target (import) | 6 rounds after the foundation ("Rep 3rd Rnd 3 times") | target **3** — "Motif complete" after half a motif | yes (`targetRowsFromText` honours a counted repeat that continues the written rows — the parser's own `repeatFrom..repeatRows` / `summary().maxRow`) | store-safety "targetRowsFromText: "Rep 3rd Rnd 3 times" …", "importPatternSections sets the 6-round target" |
| hood | pattern line, rounds 4–6 | the repeat sentence | **blank** (Store's row index held numbered rows only) | yes (`lineForRow` / `targetFor` fall back to the parser's repeat answer on an index miss) | "lineForRow answers rows 1-8 exactly as Patterns.lineFor", "round 5 … shows the Rep 3rd Rnd sentence" |
| synthetic throw (Premier shape) | stitch target past row 2 | "Rep Row 2 …" → row 2's 94 | **no target** on rows 3+ | yes (same fallback) | "targetFor agrees with Patterns.targetFor on rows 1-16", "row 10 … targets row 2's 94" |
| both | project made from a PDF-saved template | same targets as the PDF project | **no targetRows** on any part: no bar, no "complete", never finishes | yes (`createProject` sets `targetRowsFromText` on every template part with text) | "the Head part gets targetRows 5 from its template text" |
| panda | template saved in New project | rounds project | template `countMode: 'rows'` (captured before the import flipped it) → "Row" on projects made from it | yes (saved after the import, from the project) | verified in pane |
| hood | template saved in New project | UK terms | template part `dialect: 'auto'` → projects from it read UK trebles as US | yes (template parts take workMode/orientation/dialect from the parts the import made) | verified in pane (template part `uk`) |
| any | template editor ("Save as template", rename) | — | rebuilt parts from name/count/text only: dropped **placementNotes, workMode, orientation, dialect** | yes | verified in pane (all four survive) |
| panda | import preview list | "Rnd 1: …" | "20 **rows**" (project Count segment) | yes (section's own `Patterns.workMode`; the count shown is the target when there is one — hood now "×8 · 6 rounds · → target 6") | verified in pane |
| any | viewer header on a finished piece | last round | "**Row 47** · 0 sts" at 46/46 (panda Body: "Rnd 21 · 0 sts" at 20/20) | yes → "Rnd 20 · done" | verified in pane |
| any | viewer shape line | "Egg · 20 rounds · 36 around" | blank until the canvas's first frame (never, with no WebGL / throttled rAF) | yes (filled synchronously) | verified in pane |
| panda | group readout, last group | a 36-st round in groups of 10 ends in a group of 6 | "Group 4 of 4 · stitch 3 of **10**"; magic ring "stitch 0 of 10" | yes → "stitch 3 of 6", "stitch 0 of 6" | verified in pane |
| any | stitch readout on a finished piece | — | "Group 1 · stitch 0 of 10" under a full bar | yes → "All 20 rounds done" | verified in pane |
| panda | home card | — | "Body · Rnd 1 · 0/**12** sts" (completed-row count paired with the NEXT round's target), "Rnd 0" for untouched, "Rnd 20 · 0 sts" when done, project word | yes → "Body · Rnd 6 of 20 · 33/36 sts" (matches the viewer's "Rnd 6 · 33 / 36" and the pattern tag), "not started yet", "done ✓ · 6 parts to go", "piece 2 of 8" | verified in pane |
| any | parts sheet, history, repeat readout, part-editor summary / target label, jump dialog | piece's own word | project's word ("Row 5 / 20" for a round piece) | yes | verified in pane |
| any | backup import preview header | per list | "1 new · 1 will be replaced · **17 identical** · 0 older" for 7 projects (projects + templates + built-ins summed) | yes → "Projects: 1 new · 1 newer in the file · 5 already here" / "Templates: …" (unchanged built-ins left out); craft id "crochet" → craft name; "Imported 0 projects" for a templates-only import | backup "every shipped template … is flagged builtIn", "and a user template is not" |
| hood | checklist suggestion | "Attach the next motif onto the centre motif of the first 3-motif strip, then attach …" | cut at the PDF line break before its noun ("…of the first 3-motif") | yes (a line with no closing stop followed by a lower-case line is rejoined, weak; a 90-char cut never ends on "the") | "a line with no closing stop whose next line starts lower-case is rejoined", "a line that ends its own sentence is not glued" |

Suites (all run after the last edit): **store-safety 226** (was 210, +16), **backup 104** (was
102, +2), templates 94, crafts 124, diagram-model 503 — all 0 failed.

## Task 2 — Terms: Auto / UK / US

- Part editor: a **Terms** field after Worked in and Orientation (`DIALECT_OPTIONS`,
  `partDialectPick`, `dialectHint`); saved with the sheet through `Store.updatePart({dialect})`
  (one snapshot → one Undo, like the other two); Auto's hint reads the text in the box through
  `Store.partDialect` with the chip taken out ("Auto — US terms from the pattern" /
  "…does not say; read as US").
- Viewer: a third chip row "Terms [Auto|UK|US] <short hint>" (inline, 48 px, so the stage loses
  less than a two-line row would); writes `Part.dialect` at once, pushes the model, re-renders.
- `syncViewerOrientation` now also re-syncs Worked in and Terms, so an Undo moves all three chip
  rows (only orientation followed the Store before).
- Template-carried: Store already carried `dialect`; the two app paths that dropped it are fixed
  (template editor, New-project "Also save as a template").

## Task 3 — "Free up space"

`freeUpSpace: function (projectId) { switchToCountsMode(projectId); }` on the cross-stitch
`App.registerCraft({...})`. Verified: with a quota failure on a cross-stitch project the banner
reads "Download backup | Free up space", and it clears on the next good write. (Not clicked on
the shared scratch project.)

## Task 4 — item 0 leftovers

- **Counter below ~700 px (D4/L10)** — real at 640 and also at 812 on a round with a setup line and
  a 3-line instruction (hood round 1: 76 px over). `css/app.css`: `max-height: 860px` lowers the
  button floor to `max(20vh, 140px)` and clamps the setup line to one line; `max-height: 760px`
  compacts the row card (60 px number, 50 px ± buttons), clamps the instruction to 2 lines,
  tightens gaps, floor 120 px. Order unchanged. Measured: overflow **0** at 375×812 (hood round 1:
  button 173 px, −1 at 690–736 above the bar at 750) and at 375×640 (hood with setup: button
  133 px; amigurumi with target + stitch bar: 129 px; −1 at 518–564 above the bar at 578).
- **`showModal` fallback (D3/A14)** — `openFallbackSheet`: `.sheet-fallback` paints the tint and
  sits at z 150 (above banners, under the tour), `aria-modal`, Tab wraps, focus that escapes is
  pulled back, the first control is focused, closing restores focus. `App.__forceSheetFallback(true)`
  drives it for QA; verified (tint, trap, backdrop-tap close, focus back on the ⋯ button).
- **Focus-preserving rerender (D5/A15)** — `preserveFocus(fn)` (key = `data-focus-key` → id →
  aria-label; only acts if the focused node was destroyed; a now-disabled match falls back to the
  first control in its row). `render()` and the checklist list use it; part tabs and checklist
  controls carry keys; published as `ctx.preserveFocus` for the crafts. Verified: ticking and
  moving checklist items keeps focus; a part tab keeps focus across render.
- **One announcement policy (D7) + A19** — written on `announce()`: milestones only (row/round
  done, group done, piece/part/project done, colour done, step done, block/cut moved; every 50th
  stitch only when grouping is off), never per stitch. Crochet now announces "Round 5 done" (the
  piece's word, and what the number means), "Stitch 20, group 2 done", "Working round 7" after a
  jump, "Back to round 5" after −1. Calls landing inside the 30 ms window are joined instead of the
  first being dropped.
- **Tour (D6, `js/tour.js`)** — no `aria-live` on the focused dialog card (double announcement),
  body is its `aria-describedby`, focus returns to whatever opened the tour, `reducedMotion()` now
  used (no fade). The craft filter in `ensureProject` was already in.
- **Photo-crop handles keyboard path (D2)** — not done: the handles live in `js/app-xstitch.js`
  outside this task's one-property allowance. See below.

## Still wrong, and why

- Hood "Rep 3rd Rnd 3 times": the parser reads `times: 3` in `suggestions.repeat` while its own
  `maxRow` (6) counts the repeat as three MORE rounds. The target is now 6 (parser's maxRow), but
  "✨ Apply detected settings" would set a part repeat 3–3 × 3 that covers rounds 3–5 only.
  (`js/patterns.js`)
- Hood motif has no stitch targets on the counter (the leaflet prints none); the 3D model computes
  24·33·48·60·72·84 — round 2 should be 36 (4 corners × 6 tr + 4 × 3 tr), the Persian-tiles-style
  side-space residual. (`js/patterns.js` / 3D)
- Panda placement routing: "With black yarn, embroider mouth." lands on **Body**; "Sew ears on rnds
  5-10 of head" / "Sew eyes … on rnds 10-14" land on Ear/Eye but not on Head where the rounds are
  counted. (`js/patterns.js` placement)
- Panda Arm/Leg/Ear/Eye import as ×1: the PDF never states a make count, so nothing to fix
  without inventing one.
- Hood checklist: the first MAKING UP sentence ("Using A and whip stitch …, attach 3 motifs …")
  is not suggested — it opens with "Using", and "MAKING UP" is not a parser section.
- The crochet fallback line `Store.summaryFor` → `crochetSummary` still says "Main · Row 0 · 0 sts";
  `test/crafts.test.html` pins that exact string, so the home card's new line lives in app.js only.
- A part WITHOUT a target whose pattern ran out still shows the working row (row + 1) in the viewer
  header; only the terminal state with a target is named "done".

## For the owner of `js/app-xstitch.js`

- I added exactly one property to the registration: `freeUpSpace: function (projectId) {
  switchToCountsMode(projectId); }` (HANDOFF item 13). Please keep it through your edits.
- D2: the photo-crop corner handles are `<span role="button">` with no `tabindex`/keydown.
  Suggest `tabindex="0"` + arrow keys (8 px, Shift = 1 px) on each handle and on the crop box.
- D7: cross-stitch announces every 100th stitch; the shared policy is milestones + every 50th
  where there is no grouping. `ctx.preserveFocus(fn)` is available for list rebuilds (steps,
  cutting chips, page thumbnails).

## For the owner of `js/patterns.js`

- `repeatSpec` "Rep 3rd Rnd 3 times": `times` should agree with `repeatRows` (3 more = 4 in all),
  or `suggestions.repeat` should carry the same span `maxRow` does.
- Placement routing for "embroider mouth" / "Sew ears on rnds … of head" (above).

## For the docs agent (HANDOFF / SPEC / CRAFTS.md)

- HANDOFF "What's left": remove "No UI for Part.dialect", "viewer header reads Row 47 at 46/46",
  item 13; item 0 now leaves D1 (chart canvas keyboard), D2 (crop handles), D8, D9 for the other
  crafts, and the touch-hardware check of the D4 layout.
- CRAFTS.md: document `freeUpSpace(projectId, ctx)` on the registration, and `ctx.preserveFocus`.
- SPEC: the home-card crochet line ("Body · Rnd 6 of 20 · 33/36 sts", "not started yet",
  "done ✓ · N parts to go"); the viewer header "Rnd 20 · done"; `Store.targetRowsFromText` is
  exported and counts a repeat that continues the written rows; `lineForRow`/`targetFor` answer
  past the written rows from the repeat sentence, as `Patterns.lineFor`/`targetFor` do; projects
  made from a template get `targetRows` from the template text; preview rows carry `builtIn`.

## Addendum — craft-aware New project drop zone (cross-stitch audit)

**What changed.** The New project sheet's PDF block was crochet-only, so a cross-stitch or sewing
project could only get its pattern after it existed, through ⋯ → Import pattern. Now, when the
sheet's craft is cross-stitch or sewing, a second drop zone takes the crochet block's place
(`mountCraftPdf` in `openProjectEditor`; the crochet block, its "From this PDF" card and "Also
save as a template" are unchanged and still crochet-only). Dropping or picking a file there:

1. catches the file **unread** (new `pdfDropZone` option `handOff(file)`: the type is checked
   against the zone's accept list, then the file is passed on — no quota/size gates twice, no
   second read);
2. creates the project exactly as Save would (`newProjectPatch`: name — or the file's base name
   when the name is empty — emoji, template, craft, the craft's own new-project fields), makes it
   active, closes the sheet and renders the craft screen;
3. opens **that craft's own importer** — `def.openImportSheet(projectId)`, the same sheet ⋯ →
   Import pattern opens — with the file already in its drop zone (`importFileIntoCraft`: the file
   is parked in `pendingZoneFile` for exactly that synchronous call; the first `pdfDropZone` the
   importer builds takes it once mounted). The user therefore sees the importer's own preview and
   confirm step (cross-stitch: key + "Import the key and pages"; sewing: "What was found" +
   Import / Just keep the text). No craft importer code changed.

Registration: the only new property is `importAccept: ['.pdf', '.oxs', '.xml']` on the
cross-stitch registration (so the New project zone takes an .oxs chart too, as that importer's
own zone does). Sewing needs none — the default is `['.pdf']` — so `js/app-sewing.js` was not
touched. No logic landed in `js/store.js`, so there is no new Store assertion; the flow is
verified in the pane.

**Verified at 375×812 (own tab):**
- Craft switch: Cross-stitch shows "🧵 Drop a cross-stitch PDF or .oxs file here…" (accept
  `application/pdf,.pdf,.oxs,.xml`), Sewing "🪡 Drop a sewing PDF here…", Crochet brings the
  crochet block back and hides the craft zone; no horizontal scroll (373/373).
- `tmp-pdf/xs-tinymodernist-welcome.pdf` → project "xs-tinymodernist-welcome" (craft
  crossstitch, active) → "Import a chart" preview: "Read the key cleanly — 6 colours found",
  "80 × 57 stitches · 14 ct · 2 strands", DMC 725 / 3609 / 3801 / 958 / 906 / 905 — the PDF's
  key and "57h x 80w", 14-ct, "Use 2 strands" exactly. "Import the key and pages" wrote the
  palette and design (80 × 57, source pdf); home card "0 of 6 colours". The chart-page render then
  sat at "Rendering page 1 of 1…" in the hidden pane — the ⋯ menu path does exactly the same in
  the same pane (throttled rendering), so it is the environment, not this path.
- `tmp-pdf/sew-peppermint-apron.pdf` → project "Peppermint apron" (sewing, active) → "Import
  pattern" review: "Read 8 pages · 1 column untangled", 16 steps (from paragraphs), 5 notions,
  1 fabric, with the importer's own warnings; Import → 16 steps and 5 notions on the project,
  craft screen shown.
- Crochet unchanged: the panda PDF in the crochet block still yields its 7 sections.

Suites after this change: store-safety 226, backup 104, templates 94, crafts 124,
diagram-model 517 (raised by the 3D agent) — all 0 failed.

**For the owner of `js/app-sewing.js`:** the imported apron's home card reads "apron · step 1 of
16 · **0 of 5 cut**" while the importer reported "Cutting list — none found"; the 5 looks like
the notions count or a template default leaking into the cut tally. Also the card's name part is
"apron", not the project name.

**For the docs agent:** CRAFTS.md — `importAccept` (optional, default `['.pdf']`) and the New
project hand-off (`def.openImportSheet(projectId)` is called with the dropped file already in its
first `ctx.pdfDropZone`); `pdfDropZone({handOff})`.

## Addendum — printed total vs what the instructions make

`Store.roundDeviation` now carries `printed` / `computed` when a round's printed total disagrees
with the count its own instructions make (`expected` stays the printed number). The shell says so
in plain words; the target is untouched.

- `countCheckText(dev)` → "Pattern says 36 · instructions add up to 24", or ''.
- Counter: the existing one-line deviation hint under the stitch readout (`#stitch-dev`) shows it
  on the round being worked; with an over-count too, both ride in that line joined by " · ".
  Never on a finished piece.
- 3D viewer header: `setViewerReadout` writes "Rnd 29 · 0 / 36" and, under it, the same sentence
  as a small right-aligned note (`.viewer-readout-note`, max 150 px so the sheet title keeps its
  room).

Verified at 375×812 in my own tab: `tmp-pdf/crochet-baphomet.pdf` (BabyBaphometFINAL) through New
project → Body/Head, tapped "R29: (2sc, dec)x8 [36]" in the pattern sheet → Jump. Counter: pattern
tag "Rnd 29", stitch bar "0 / 36" (still the printed target), hint "Pattern says 36 · instructions
add up to 24", body overflow 0. Viewer header "Rnd 29 · 0 / 36" / "Pattern says 36 · instructions
add up to 24", header 69 px tall, no horizontal overflow (373/373; the first try overflowed by
13 px and the note was capped). Round 30: hint gone; Undo back to 29: hint back. (`(2sc, dec)×8`
is 8 × 3 = 24 — the PDF's own [36] is the designer's slip, quoted as printed.)

Suites: store-safety 226, backup 104, templates 94, crafts 124 — 0 failed. No store.js change in
this step (the pair comes from the Store's own `roundDeviation`), so no new Store assertion.
