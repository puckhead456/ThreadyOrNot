# Wave H — `shell` report (knitting registration, parser slot, import, home, settings)

## What the user sees

- **🧣 Knitting** in the craft picker (New project), on the home card badge, in Settings → Crafts.
  A knitting project opens on the crochet counter screen (`#screen-project`) with everything
  crochet has: part tabs, make-counts, rows/rounds, stitch button, targets, repeats, alerts,
  placing notes, history, pattern sheet, 3D button and viewer, size-once, size groups, colour strip.
  The ⋯ menu is crochet's (Parts, Import pattern, Checklist, Notes, Yarn colours, History, Status,
  Save as template, file items, Show me around) plus whatever the knitting registration adds
  (Glossary, once knit-counter exposes `App.openGlossarySheet`).
- **Built-in knitting templates**: Single piece, Sweater (Back, Front, Sleeves ×2), Socks (Sock ×2),
  Hat, Shawl, Blanket — each with a checklist (Block, Seam, Set in sleeves, Graft toes, Weave in
  ends …) and short, real pattern text whose every bracketed count was worked through by hand
  (boat-neck sweater 18 sts × 24 rows; 64-st top-down heel-flap sock with continuous numbering
  rnds 1–56 / rows 57–103 / rnds 104–182; 88-st beanie; top-down garter triangle shawl; seed-stitch
  blanket with garter border). Short rows / partial rows (heel turn, "K9 to the centre of the heel")
  print no count, so no target is invented.
- **Import for knitting**: the New project drop zone and ⋯ → Import pattern read a knitting PDF with
  the knitting parser (sections, sizes, size chips, targets, count confidence, checklist suggestions
  with knitting's finishing verbs, the "From this PDF" template card, "Also save as a template",
  which now saves the template under the chosen craft). Switching the craft in the New project sheet
  after a PDF was read re-reads it with the new craft's parser. The gauge and needle lines of the
  front matter go to `Project.gauge` (via knit-counter's `setGauge`), never into a part.
- **Settings → 🧣 Knitting**: "Measure in" Centimetres / Inches and "Needle sizes" mm / US / UK.
- **Help**: three knitting FAQ entries; a "Knitting with the counter" tour (Settings → Help & tours,
  and ⋯ → Show me around on a knitting project). The counter tour also accepts a knitting project.
- **No parser loaded** (`js/knits.js` missing): a knitting project is a plain counter and one line
  under the part tabs says "🧣 The knitting pattern reader did not load, so this is a plain counter
  for now — your counts are safe." Crochet never sees it.

## Contract (hooks and fields added)

### `js/store.js`
- `Store.registerCraftParser(craftId, api, extras?)` → boolean. `api` is the parser object or the
  NAME of its window global (`'Knits'`), resolved on every call so script order never matters;
  `null` unregisters. `'crochet'` and `''` are refused. `extras = { checklistStart: RegExp,
  checklistSections: RegExp }` — the craft's finishing verbs / section names for
  `suggestChecklist`. Registering clears the line and diagram caches.
- `Store.parserFor(projectOrPartOrProbeOrCraftId)` → the craft's parser; crochet, null and any craft
  without a registered parser → `window.Patterns`; a registered parser whose global is missing →
  `null` (no parse at all — never crochet's reading of knitting text).
- Fix (3D worker): `diagramModel(part, project)` / `buildDiagramModel` call `bindPartProject`, so a
  part with no `craft` of its own is parsed, indexed AND expanded with its project's parser (the
  project handed in wins; a part's own `craft` still wins over it). The part→craft memo is keyed on
  the part object. store-safety 307 (5 new assertions).
- `Store.craftOf(x)` → the craft id a project / part / probe / id is read as (a part's craft is its
  project's; a probe part may carry `craft` itself). Never loads state to answer.
- Every former `patternsApi()` caller now dispatches by craft: `partLines` (cache key now includes
  `craft` and the resolved parser object), `patternSummary`, `lineForRow`, `targetFor` (so
  `currentTargetInfo`, `repeatInfo` users), `colorPlan`, `patternColorHex` / `patternColorsOf`
  (via `makeColorResolver`, `yarnColorNames`, `yarnColorFor`), `patternWorkMode` (→ `partWorkMode`,
  `rowWorkMode`), `textDialectFor` (→ `partDialect`), `partShape`, `buildDiagramModel`
  (→ `diagramModel`, `roundDeviation` reads the same lines), `importPatternSections` (detectSizes,
  dialect, targets, rounds flip), `setProjectSize`, `createProject` (template part targets).
- Text-only entry points gained a trailing optional craft: `splitSections(text, craft)`,
  `targetRowsFromText(text, size, sizeCount, craft)`, `suggestChecklist(text, craft)`,
  `countReport(text, { size, sizeCount, craft })` (a part/probe uses its own craft); internal
  `parseLoose(text, opts, craft)`, `untilSuggestion(…, craft)`, `sectionsAllRounds(secs, craft)`,
  `textDialect(text, craft)`. Default is crochet everywhere, so every old call is unchanged.
- `importPatternSections` result gains `gauge: true` when it wrote a gauge. Only a non-crochet
  craft's import reads gauge (crochet imports are unchanged). `importGauge` reads `api.gauge(text)`
  and the needle lines: the counts AS PRINTED, in the unit printed first ("12 sts and 17 rows = 4"
  [10 cm]" → 12 / 17 over 4 in, as docs/research/knitting.md §1 asks; no unit printed → the
  knitter's `Settings.crafts.knitting.unit`), and
  the needle "as printed" ("6 mm (US 10)"), picking the LARGEST size listed when the gauge line says
  "with larger needles" (the Bernat pullover), the smallest for "smaller", else the first. Written
  with `setGauge(id, g, { undo: false })` when the project has `gauge` (knit-counter's field), else
  `craftData.gauge`. A gauge with any number on it is never overwritten (a missing needle is filled).

### `js/app.js`
- `App.registerCraft({ usesCounter, parser, parserExtras, settingsFields(body, ctx), label, faq,
  menuItems(p, ctx), tourId })`: `label` aliases `name`; `parser` is passed to
  `Store.registerCraftParser`; `faq: [{q, a}]` goes through `ctx.addFaq`; `settingsFields` renders
  a section `[data-craft-settings="<id>"]` under Settings → Crafts; on a counter craft `menuItems`
  entries sit above the file items in the crochet ⋯ menu and "Show me around" starts the tour whose
  id is `tourId` (or the craft id) when registered, else `counter`.
- `isCraftProject(p)` is false for a `usesCounter` craft (so `craftFor` is null and the project
  renders `#screen-project`); the two ⋯-menu gates follow it. New helpers `counterCraft(id)`,
  `counterCraftDef(id)`, `parserOf(x)`; exported as `App.craftUsesCounter`, `App.parserOf`.
- New project sheet: Count / group size / crochet PDF block shown for counter crafts; the craft PDF
  zone only for module crafts; "From this PDF" card and section import for counter crafts;
  saved template takes the chosen craft; `newProjectPdfBlock(…, craftFn)` and `pdf.recraft()`.
- `importPicker({ craft })` (a value or a function): `splitSections`, `detectSizes`, size counts,
  `sectionRowInfo(…, craft)` probes (`craft` on the probe part), `dialectHints`, rows-from,
  `suggestChecklist` all read the craft's parser. `openImportSheet` passes `p.craft`.
- `fillSizeMarked`, `yarnHex` and the pattern sheet's `sizeScope` use `parserOf(project)`.
- Template editor: Count / group size shown for counter crafts.
- `syncCraftNotice(p)` after `renderProject` fills `#craft-notice`.

### Other files
- `index.html`: `js/knits.js` after patterns.js, `js/knit-chart.js` after pdftext.js,
  `js/app-knitting.js` after app.js; `<p id="craft-notice" class="repeat-readout craft-notice">`
  under `#part-tabs`. `sw.js`: the same three files in PRECACHE (CACHE_VERSION untouched).
- `js/tour.js`: the counter tour's `ensureProject` accepts a counter-craft project
  (`App.craftUsesCounter`).
- `js/app-knitting.js` (new, `window.AppKnitting`): Store + App registration, templates, settings,
  FAQ, tour, `menuItems`, and helpers for the other workers: `AppKnitting.settings()` →
  `{ unit, needleSystem }` (defaults: cm/metric, in/us for en-US), `AppKnitting.needleLabel(mm,
  system)` ('4 mm' / 'US 6' / 'UK 8', CYC table, mm when a system has no size),
  `AppKnitting.needleSizes`, `AppKnitting.sectionNames` (the contract's garment nouns, also on the
  registration as `sectionNames`).
- Settings key: `Settings.crafts.knitting = { unit: 'cm'|'in', needleSystem: 'metric'|'us'|'uk' }`.

## Verified

- Suites: store-safety **302** (266 + 36 new: parser slot, cache key, fallbacks, lazy global,
  checklist dispatch, import sizes + gauge + needle, crochet unchanged), backup 205, crafts 124,
  templates 147, diagram-model 529, sw 29 (every index.html script precached), patterns 1037.
- Pane, 375×812, own tab, storage key `ZWH_shell.v1` (`Store.__setKeyForTests`): New project →
  Knitting → Socks → Save: knitting project, 🧦, rounds, Sock ×2, 3 checklist items, renders
  `#screen-project`, notice line shown (no Knits yet); tapped 3 stitches and 2 rounds, home card
  "🧦 🧣 Socks · Sock · Rnd 3 · piece 1 of 2 · 3 sts"; 3D view opens; ⋯ menu is crochet's;
  Settings shows 🧣 Knitting with both segments, writes `{unit:'in', needleSystem:'us'}`;
  "Show me around" starts the knitting tour (steps whose targets are missing trim themselves).
- `js/knits.js` was NOT on disk while I worked: the PDF import was verified with a stub `window.Knits`
  (Patterns' functions behind a call counter): New project → Knitting → drop
  `knit-bernat-topdown-pullover.pdf` → the stub's `splitSections`/`parse`/`gauge` were the ones
  called, size chips XS/S, M, L, "From this PDF" card, Save with M → project craft knitting, sizes
  set, size M, gauge `{12, 17, over 4, in}` (knitter on inches) and — after the fix below — needle
  "6 mm (US 10)". (The stub is crochet's parser, so the section split itself is not knitting's.)
  First run picked "5 mm (US 8)" — the first needle listed — although the gauge is "with larger
  needles": fixed (largest/smallest by the gauge line) with an assertion.

### With the real `js/knits.js` (landed while I worked)

- Every template part, row by row, against hand-computed counts: Hat 54 rnds, Sweater Back/Front
  150 rows, Sleeves 132 rows, Shawl 125 rows, Blanket 300 rows — every target and every per-row
  count exact; Socks target 182 and every count exact except rows 59–87 of the heel flap, which
  read no count (honest null — the parser prints a range's count on its last row only).
- First run showed WRONG intermediate counts: Knits reads `Rep Rows 3-4 60 more times. (255 sts)`
  as "every row is row 3/4's 15" (shawl rows 5–124 all 15, sleeve rows 21–86 all 44, gusset all
  82). The templates now use the range form `Rows 5-124: Rep Rows 3-4. (255 sts)`, which Knits
  grows row by row correctly. The other form is the commonest in real patterns — see "For the
  owner of js/knits.js".
- Bernat PDF through New project at 375×812: size chips XS/S…4/5XL, "From this PDF" card, Save at
  M → knitting project, 6 sizes, size M, 3 parts, gauge 12 / 17, needle "6 mm (US 10)", no notice
  line. Parser quality on this file is knits-parser's (below).

## Left / for the coordinator
- The 3D viewer's "Terms Auto / UK / US" row and "Flat circle" wording are crochet's; for a knitting
  project they belong to knit-counter / knit-3d.
- At 375 px the craft picker's four segments wrap "Cross-stitch" onto two lines (fits, no overflow).

## For the owner of `js/app.js` counter / part-editor regions (knit-counter)
- Tour step targets I point at: `[data-tour="knit-side"]` (RS/WS chip) and
  `[data-tour="knit-markers"]` (marker strip). Add those attributes and the knitting tour shows them.
- Glossary: expose `App.openGlossarySheet(projectId)`; `js/app-knitting.js` then adds "📖 Glossary"
  to a knitting project's ⋯ menu (only when `Knits.glossary` exists too).
- `AppKnitting.settings()` / `AppKnitting.needleLabel()` are there for the gauge card.

## For the owner of `js/knits.js` (knits-parser)
- `Rep Rows 3-4 60 more times. (255 sts)` (no range label) gives every repeated row the count of
  the row it repeats (15) instead of growing 19, 19, 23 … 255; `Rows 5-124: Rep Rows 3-4. (255 sts)`
  is right. A shaping repeat without a range label should grow the same way, or give no count.
- `Rows 59-88: Rep Rows 57-58. (32 sts)` gives rows 59–87 no count although rows 57/58 are both
  32 (honest, but a flat repeat could carry 32).
- Bernat pullover via `splitSections`: three sections named "", "", "Sleeves" (Neck/Yoke/Body
  expected; the "Sleeves" section starts with the neckband pick-up text), and "1st row:(RS). K1.
  PM. K2. PM. K4 (4-4-4-6-6). PM. K2. PM." stops at the PDF wrap, so the counter shows "≈ 9" for
  a 38-st row (M) — a count the pattern does not support.
- Registered as `parser: 'Knits'` (global looked up per call). Every Store/App call goes through
  `Store.parserFor`, so `Knits.parse/splitSections/detectSizes/gauge/workMode/dialectHints/
  summary/lineFor/targetFor/countReport/expand/colors/colorHex/sizeMarks/sizeScope/startHint` are
  the names used. Garment section nouns are in `AppKnitting.sectionNames` if useful.
