# Wave H contract — knitting

Six workers build in parallel against this. Names here are binding; if you must deviate, write
it in your report under "Contract changes" and say so in your final message.

Design source: `docs/brainstorm/11-knitting-next-crafts.md` Part 1 (read it in full; its line
numbers are from September and have moved, but every finding is still true unless this file
says otherwise). Knitting is NOT a `#screen-craft` module: it is a twin of the crochet counter
(`#screen-project`) with its own parser and a few knitting-only extras.

Knitting fixtures on hand in `tmp-pdf/` (never copy, never commit): `knit-bernat-topdown-
pullover.pdf` (top-down raglan, markers, multi-size), `knit-interweave-8-socks.pdf` (8 sock
patterns: flap-and-gusset heels, short rows, in-segment sizes, a cable sock, toe-up and top-
down), `knit-fromtheheart-magicloop-socks.pdf`, `knit-interweave-lace.pdf` (lace: asterisk
repeats with remainders, charts + written), `knit-rico-triangular-shawl.pdf`,
`knit-sandnes-0216.pdf` (Scandinavian booklet, several garments, numeric sizes),
`knit-apl-nicoll.pdf` (antique scan). Text layer of any file:
http://localhost:8766/test/pdftext.dump.html?f=<file>. Do not download anything.

## 1. Craft registration and the parser slot (owner: `shell`)
- `App.registerCraft({ id: 'knitting', label: 'Knitting', emoji: '🧣', usesCounter: true,
  parser: 'Knits', ... })`. `usesCounter: true` means the project renders `#screen-project`
  (the crochet counter) with every crochet feature: parts, make-counts, repeats, targets,
  alerts, placement notes, history, templates, 3D button/viewer, Terms/Orientation/Worked-in,
  size-once, size groups, colour strip, deviation hint. The ⋯ menu keeps Parts, Yarn colours
  and Save as template for a counter craft. Nothing crochet-only may break.
- `Store.registerCraftParser(craftId, api)` and `Store.parserFor(projectOrPart)`;
  `linesFor`, `targetFor`, `lineForRow`, `currentTargetInfo`, `repeatInfo`, `diagramModel`,
  `importPatternSections`, `rowWorkMode`, `partDialect`, `roundDeviation`, `suggestChecklist`
  and every other `patternsApi()` caller dispatch through it (crochet → `window.Patterns`,
  knitting → `window.Knits`). The `partLines` cache key includes the craft.
- `Project.craft === 'knitting'`. `createProject` from a knitting template seeds its parts
  (built-in templates: Sweater (Back, Front, Sleeves ×2), Socks (×2), Hat, Shawl, Blanket,
  with pattern text where a built-in crochet template has it). The home card uses the same
  shape as crochet with the craft emoji. The New project drop zone and import picker work for
  knitting exactly as for crochet; section names are garment parts (Back, Front, Left Front,
  Right Front, Sleeve, Yoke, Body, Collar, Cuff, Neckband, Button Band, Hood, Pocket, Heel,
  Heel Flap, Gusset, Foot, Toe, Leg, Brim, Crown, Border, Edging). Gauge and needle lines in
  the front matter go to `Project.gauge`, not to notes, and never become a phantom setup row.
- `Settings.crafts.knitting = { unit: 'cm'|'in', needleSystem: 'metric'|'us'|'uk' }` with a
  settings section rendered through a new `registerCraft({ settingsFields(body, ctx) })` hook.
- Tour + FAQ entries for knitting; `index.html` script order and `sw.js` PRECACHE gain
  `js/knits.js`, `js/knit-chart.js` (CACHE_VERSION is generated, never hand-edited).

## 2. `window.Knits` (owner: `knits-parser`, files `js/patterns.js`, new `js/knits.js`,
`test/patterns*.html`, new `test/knits.test.html`, new `test/knits.fixtures.html`)
- Exposes EVERY function `window.Patterns` exposes, with the same names and signatures
  (`parse(text, opts)`, `parseSections(text)`, `expand(line, prevCount, opts)`, `placement`,
  `workMode`, `startHint`, `stuffingHint`, `dialectHints`, `gauge`, `detectSizes`, `colors`,
  `colorHex`, `looksLikeGlossary`, `version`, …). Shared code is factored out of
  `js/patterns.js` into a craft-profile engine (`Patterns.createParser(profile)` or
  equivalent) that `js/knits.js` instantiates with the knitting profile. Crochet behaviour
  must not change: patterns 1037 and patterns.fixtures 829/844 stay green.
- `Line` keeps the crochet contract and adds: `side: 'rs'|'ws'|null` (null = in the round),
  `delta: number|null` ("8 sts inc"), `until: {kind:'length'|'rows', value, unit,
  endOn:'rs'|'ws'|null}|null`, `markers: [{name, at}]|null` (stitch index from row start;
  'BOR' reserved), `shortRow: boolean` (the line contains `turn` / `w&t` / wrap),
  `chart: {name, row}|null` ("work row 7 of Chart A"), `cable: {every, name}|null` when a
  cable cadence is stated. The twelve lines in lens §1.3 are the acceptance list, plus
  `CO 60 (66, 72) sts` in-segment sizes, `Rows 2, 4, 6 and 8 (WS)` enumerations, "Cast On" /
  "Bind Off" never becoming part headers, numeric size lines `34 (38, 42, 46)` detected.
- `expand()` returns the crochet v2 shape `{stitches:[{t,c,h,w,side}], color, height, width,
  state, inc, dec}` with knitting types: `k`, `p`, `yo`, `k2tog`, `ssk`, `k3tog`, `cdd`, `m1`,
  `kfb`, `sl`, `cable` (with `w` = cable width, `cross:'f'|'b'`), `co`, `bo`. Heights in
  stitch widths: stockinette row 0.75, garter row 0.5 per row (a ridge = 2 rows), rib row
  0.75, lace row 0.75, cable row 0.75. Widths: k/p 1, yo 1, a decrease 1 produced, rib pulls in
  (k2p2 width 0.8 per stitch), a cable crossing 0.85 of its stitches.
- `Knits.glossary(text)` → `[{abbr, meaning, fromPattern: boolean}]` from the pattern's own
  abbreviation block when present plus the profile table.
- `test/knits.fixtures.html` asserts every knitting fixture against `docs/research/
  knitting.md` (the research worker writes it during this wave; check for it before writing
  the fixture page and read it when it exists).

## 3. Knitting state and counter UI (owner: `knit-counter`, in the knitting sections of
`js/store.js` and `js/app.js` plus `css/app.css` — Edit only; `shell` edits other regions of
the same files at the same time)
- `Project.gauge = { sts, rows, over, unit, needle, swatch: { sts, rows } }`;
  `Part.side: 'rs'|'ws'|null`; `Part.markers: [{id, name, at}]`; `Part.linked: partId|null`
  (two-at-a-time); `Part.shortRows: { active, n, of }|null`. All normalised on load; crochet
  ignores them; templates and backups carry them; undo rules as every other write.
- Counter UI (knitting only; crochet never sees it): RS/WS chip beside the row number (from
  `Line.side`, else parity from the last tagged row; tap flips `Part.side`; hidden in the
  round); marker strip under the stitch readout showing stitches to the next marker as you tap
  ("7 → marker"), tap to rename, long-press to remove; per-segment stitch breakdown
  "3 | 12 | 30 | 12 | 3"; short-row sub-counter ("short row 3 of 8") that does not advance
  the row; two-at-a-time ("Sleeve 1+2", one tap advances both linked parts); cable ring
  ("cable in 3"); gauge card in the part editor (pattern vs measured → "32 cm ≈ 118 rows,
  not 110") that turns `until` length lines into ≈ row targets; glossary sheet in ⋯;
  chart chip "chart row 7 of 16" that opens the page image (BlobStore, as sewing keeps
  diagrams) and, when `KnitChart` has read the chart, shows that row written out.

## 4. 3D for knitting (owner: `knit-3d`, `js/diagram-geo.js`, `js/diagram.js`,
`test/diagram.test.html` knit block, `test/diagram.gallery.html`)
- Consumes the `expand` records above. Stockinette shows knit V's (not crochet bumps), purl
  rows show bumps, garter alternates ridges, ribbing shows pulled-in vertical columns, lace
  shows yo holes, cables show the crossing twist, short rows wedge the fabric. Row height
  0.75 of stitch width. Flat vs in-the-round from `workMode` as today; socks (cuff-leg-heel-
  gusset-foot-toe) and top-down raglans read as the garment in the photo. Reference
  assertions on the knitting fixtures once `Knits.expand` exists; synthetic records until then.

## 5. Chart reader (owner: `knit-chart`, new `js/knit-chart.js` → `window.KnitChart`,
new `test/knit-chart.test.html`)
- `KnitChart.fromHandle(handle, pageNo)` → `[{ name, cols, rows, cells: [[sym]], legend:
  [{sym, meaning, stitch}], noStitch, readRS: 'rtl', startRow, repeatBox: {c0,c1}|null }]`
  read from the PDF's text layer (chart cells are glyphs in a symbol font laid out on a grid;
  `PdfText.open(file)` gives a handle whose page items carry x/y/width/height/font), `[]` when
  a page has no chart, and `null` cells for an image-only chart.
- `KnitChart.rowText(chart, rowNo, side)` → the row written out ("k2, yo, k2tog, k3 …") in
  reading order (RS right-to-left, WS left-to-right, in the round always right-to-left),
  with repeat boxes folded into "*…; rep from *".
- Tests against the lace ebook and the sock ebook charts; no DOM, no app wiring (the counter
  worker consumes the API).

## 6. Ground truth (owner: `knit-research`, `docs/research/knitting.md`)
- Per fixture: the garment, sizes, gauge, every section with its row/round count and the
  stitch count at the end of each row where printed, markers, short-row sections, charts,
  two-at-a-time notes, and the exact hard lines (one table per fixture). Written early and
  appended to; every other worker reads it when it appears.
