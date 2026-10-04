# Crafts: the plugin contract

Thready or Not started as a crochet counter. From September 2026 it also serves
**cross-stitch** and **sewing**. Each craft is a module in its own files that
plugs into the existing shell (home screen, project header, sheets, themes,
export/import, service worker). The crochet code paths stay exactly as they are;
a project with `craft: 'crochet'` (the default, and what every old save
migrates to) renders through the existing `#screen-project` and never touches
anything in this document.

This document is the contract between the **shell** (`js/store.js`, `js/app.js`,
`index.html`, `css/app.css`) and the **craft modules**. Per-craft data models and
screens live in `docs/research/cross-stitch.md` and `docs/research/sewing.md`
(research + proposed specs) and, once built, in SPEC.md sections for each craft.

Ground rules that still apply: plain HTML/CSS/JS, **no build step, no ES
modules**, one `window` global per file from an IIFE with `'use strict'`,
relative paths only, everything works offline once installed, phone first
(375 px), all six themes, no network calls except Google Fonts.

## Files

```
js/blobstore.js         # window.BlobStore  – tiny IndexedDB wrapper for big binary data (chart page images)
js/xstitch.js           # window.XStitch    – cross-stitch pure logic: parsers (OXS, PDF key text), geometry, floss maths
js/xstitch-photo.js     # window.XStitchPhoto – photo → chart (stretch goal; Web Worker via Blob URL)
js/app-xstitch.js       # cross-stitch UI; calls App.registerCraft(...)
css/xstitch.css
js/sewing.js            # window.Sewing     – sewing pure logic: instruction-booklet parser
js/app-sewing.js        # sewing UI; calls App.registerCraft(...)
css/sewing.css
test/xstitch.test.html, test/sewing.test.html, test/blobstore.test.html
```

Script order in `index.html` (after the existing tags, in this order):
`blobstore.js`, `zip.js` (the shell's `.thready` backup container, wave F),
`xstitch.js`, `xstitch-photo.js`, `sewing.js`, then `app.js`
as today, then `app-xstitch.js`, `app-sewing.js`. Craft UI files register at
script-evaluation time; `App.init` runs on `DOMContentLoaded`, after all of
them, so registration order never matters. Every new file is precached in
`sw.js` and `CACHE_VERSION` is bumped on release. `css/xstitch.css` and
`css/sewing.css` are linked after `css/themes.css` and use ONLY the theme
variables listed in SPEC.md ("Themes contract") plus their own layout numbers.

A module that fails to load, or a browser that cannot run it, must never break
crochet: every shell entry point checks `crafts[id]` exists before calling it
and falls back to a friendly "This project needs the <name> module" card.

## Store (shell side)

```js
Project.craft: 'crochet' | 'crossstitch' | 'sewing'   // default 'crochet' (old saves migrate to it)
Project.craftData: object                              // opaque to the shell; owned by the craft module
Template.craft: 'crochet' | 'crossstitch' | 'sewing'   // default 'crochet'
Template.craftData: object|null                        // seed craftData for projects made from it (deep-copied)
```

- `Store.registerCraft({ id, normalize(rawCraftData, rawProject) → craftData, summary(project) → string })`
  Called by the pure-logic module (`XStitch`, `Sewing`) at script time. `normalize`
  is invoked from `normalizeProject` on load/import so bad or old data is
  repaired exactly like the rest of the state; it must never throw and must
  return a plain JSON-safe object (typed arrays are converted to plain arrays or
  base64 strings by the module itself). When no craft is registered for a
  project's id, `craftData` is kept as-is (so the data survives a module that
  failed to load).
- `Store.crafts() → string[]` registered ids, in registration order.
- `Store.createProject(opts)` accepts `craft` and `craftData`; the template's
  `craft` wins when `opts.craft` is missing. For non-crochet crafts `parts` is
  still created (one part named `Main`) so nothing in the shell that expects
  `parts.length >= 1` breaks, but the craft UI may ignore parts entirely.
- **`Part.workMode`, `Part.orientation` and `Part.dialect` are crochet-only**
  (added by the 3D diagram work; see SPEC.md). They are normalised on load for
  every project whatever its craft, because `Part` is one shape shell-wide and a
  missing field would be `undefined` rather than `'auto'` — but nothing outside
  the crochet paths reads them: they only feed `Store.diagramModel` /
  `DiagramGeo`, and the part editor's chips for them (Worked in, Orientation,
  Terms) sit with the other crochet-only fields the craft UIs hide. A
  craft module must not repurpose
  them; per-craft state belongs in `craftData`.
- `Store.templates(craft?)` filters by craft when given. Built-in templates
  for the new crafts are declared by the craft module via
  `Store.registerCraft({ ..., templates: Template[] })` and seeded with the same
  "re-seed missing built-in ids on load" rule as the crochet ones (seeding runs
  at `Store.load()`, after every module has registered, and again whenever a
  craft registers late). `createProject` deep-copies `Template.craftData` into
  the new project's `craftData` and runs the craft's `normalize` on it. The Templates
  editor sheet shows a craft tag on each card and hides crochet-only fields
  (Rows/Rounds, group size) for other crafts.
- `Store.updateCraftData(projectId, patchOrFn)` → pushes an undo snapshot,
  applies `Object.assign(craftData, patch)` or `fn(craftData)` (mutating in
  place), bumps `updatedAt`, saves (debounced). This is the ONLY way a craft
  module writes project state; `Store.undo()` therefore works for crafts for
  free. The hot path (a stitch tap on a 50k-cell chart) must stay under a few
  ms: keep chart grids as plain arrays of small integers and progress as a
  base64 bitmap string or plain array; do not store DOM or blobs here.
- **View state goes through the same door, without undo** (wave F):
  `Store.updateCraftData(projectId, patchOrFn, { undo: false })` (alias
  `{ undoable: false }`) applies the change with **no undo snapshot and no
  `updatedAt` / touch-day bump**, through the same `save()`, so revision,
  writerId and the multi-tab rules are unchanged. Use it for anything that must
  persist but is not work — zoom, pan, the chosen tool or layer, a crosshair —
  so a pan never fills the undo stack and Undo never starts "undoing" zooms.
  Never mutate `project.craftData` directly and call `Store.save()`. Debounce
  view writes (cross-stitch uses 300 ms, flushed when the sheet closes).
- `Store.summaryFor(project) → string` calls the craft's `summary(project)`
  (home card summary line); crochet keeps the existing `projectSummary`.
- Per-craft **settings** (things shared across projects, e.g. the sewist's own
  body measurements, machine presets, the cross-stitcher's default fabric
  count): `Settings.crafts: { [craftId]: object }`, read with
  `Store.craftSettings(craftId) → object` (always an object) and written with
  `Store.setCraftSetting(craftId, key, value)`. Normalised on load as an opaque
  JSON object per craft; included in export/import.
- Export/import JSON includes `craft`, `craftData`, `Template.craft`
  unchanged. Since wave F the backup is a `.thready` zip that also carries every
  `BlobStore` page image under the `p:<projectId>:` convention (`pages/<projectId>/<n>.<ext>`,
  see SPEC.md "Backup file"); a Keep-both import gets its own copies under the
  clone's new id, with the craftData blob keys rewritten. Only an older `.json`
  backup leaves the images out. Cross-stitch's copy says so ("saved with the
  project; Back up now includes them"); sewing's page-image copy in
  `js/app-sewing.js` (`STORED_HERE` and the "Keep the pages" hint) still says the
  pages are not in the backup and needs the same change. A craft that stores page images must
  keep to the `p:<projectId>:<kind>:<n>` key convention so the backup, the
  Keep-both rekey and the boot-time orphan sweep can find them; the rekey
  rewrites any craftData **string value** that starts with `p:<oldId>:`, so keep
  whole keys as strings in craftData rather than assembling them from parts.

## BlobStore (`js/blobstore.js`, `window.BlobStore`)

IndexedDB database `stitchkeeper-blobs`, one object store `blobs` keyed by
string. All methods return Promises and resolve to `null`/`false` instead of
rejecting when IndexedDB is unavailable (private mode, old WebView).

```js
BlobStore.put(key, blob | ArrayBuffer | string) → Promise<boolean>
BlobStore.get(key) → Promise<Blob|null>
BlobStore.delete(key) → Promise<boolean>
BlobStore.keys(prefix) → Promise<string[]>
BlobStore.deletePrefix(prefix) → Promise<number>     // used when a project is deleted: prefix = 'p:<projectId>:'
BlobStore.available() → boolean
BlobStore.usage() → Promise<{ count, bytes }|null>
```

Key convention: `p:<projectId>:<kind>:<n>` (e.g. `p:abc:chartpage:3`). The
shell calls `BlobStore.deletePrefix('p:<id>:')` from `deleteProjectFlow` after
the 6-second undo window has passed (not before, so undo keeps the images).

Wave F adds `entries(prefix) → Promise<[{key, blob}]>`, `putMany([{key, value}])
→ Promise<count>` (one transaction, all or nothing), `deleteKeys(keys) →
Promise<count>` and `sweep(liveIds, {prefix = 'p:'}) → Promise<{count, bytes}>`.
The shell runs the sweep once per start (8 s in, on idle): `p:<id>:*` images whose
id no live project, undo-stack entry, pre-import snapshot or on-disk state
references are deleted. Keys outside `p:<id>:` and the shell's own `preimport:`
snapshot are never touched.

## App (shell side)

```js
App.registerCraft(def)
def = {
  id: 'crossstitch',                 // must match the Store registration
  name: 'Cross-stitch', emoji: '✖️', tagline: 'Charts, floss and progress.',
  // Project screen. `main` is an empty <main class="screen-body craft-body"> inside
  // #screen-craft; the shell has already filled the shared topbar (back, emoji,
  // name → edit sheet, timer chip, ⋯ menu). Render everything else here. Called on
  // every App.render() while the project is open; be idempotent and cheap (keep
  // your own DOM cache and patch it, the way updateCounters does).
  renderProject(project, main, ctx),
  // Leaving the project screen or switching projects: drop canvases, observers, timers.
  destroyProject(),
  // Extra ⋯ menu items, inserted above 'Notes'. Return [] for none.
  menuItems(project) → [{ icon, label, run() }],
  // "Import pattern" in the ⋯ menu routes here for non-crochet crafts.
  openImportSheet(projectId),
  // New-project sheet: append craft-specific fields to `body`; return { get() → craftData patch }.
  // Optional. Called only when this craft is selected. The shell hides Rows/Rounds and group size.
  newProjectFields(body, ctx) → { get() },
  // Home card line, e.g. 'Cottage sampler · 12 of 34 colours · 41%'. Optional; falls back to Store.summaryFor.
  summary(project) → string,
  // Theme changed while this craft's project is open (recolour canvases). Optional.
  onTheme(),
  // Called once at App.init after the shell is ready (register FAQ entries, etc.). Optional.
  onInit(ctx),
  // Quota banner: while this craft's project is open, a "Free up space" button calls this.
  // Optional; cross-stitch publishes its switch to counts-only mode (drops page images and caches).
  freeUpSpace(projectId, ctx),
  // Accept list for this craft's drop zone in the New project sheet. Optional, default ['.pdf'];
  // cross-stitch: ['.pdf', '.oxs', '.xml'].
  importAccept: string[]
}
ctx = {
  // the shell's helpers, so craft UIs look identical to the rest of the app
  el, button, on, clear, field, textInput, numInput, textArea, stepper, segmented, switchRow,
  openSheet, confirmSheet, closeAllSheets, toast, announce, fb,   // fb('tap'|'group'|'row'|'alert'|'done'|'undo')
  preserveFocus(fn),                                         // wrap a list rebuild so keyboard focus survives it
  wake: { supported, isOn(), toggle() → bool },            // screen wake lock (the lock follows any open project)
  render,                                                    // full re-render (use sparingly)
  currentProject, openProjectEditor, openChecklistSheet, openNotesSheet, openHistorySheet, openStatusSheet,
  celebrate,                                                 // celebrate('project'|'part'|'piece')
  prefersReducedMotion, cssVar,                              // cssVar(getComputedStyle(root), '--primary', fallback)
  isPdfFile, firstFile, pdfDropZone(zoneOpts) → node        // the existing PDF drop zone, reusable: see below
                                                             // (`readPdfInto` is the same builder under its old name)
}
```

- **Announcements** (`ctx.announce`) follow one policy in every craft: milestones only —
  a row/round, group, piece, part or project done, a colour done, a step done, a block or
  cut count moved, and every 50th stitch only where there is no grouping — never a single
  stitch. Calls landing together are spoken together. (Cross-stitch still announces every
  100th stitch.)
- **Focus**: a craft that rebuilds a list by clearing it (steps, cutting chips, page
  thumbnails) wraps the rebuild in `ctx.preserveFocus(fn)`; give controls a
  `data-focus-key` so the replacement can be found.

- `#screen-craft` is a third `<section class="screen" hidden>` in `index.html`
  with the same topbar markup as `#screen-project` (`#c-back`, `#c-title`,
  `#c-emoji`, `#c-name`, `#c-timer`, `#c-menu`) and an empty
  `<main id="craft-body" class="screen-body craft-body"></main>`. No bottom bar;
  a craft that wants one renders it inside `main` (class `bottombar` is
  reusable and sticks to the bottom of the screen-body's flex column).
- `render()` router: `p.craft === 'crochet'` (or unknown craft with no module)
  → existing behaviour. Otherwise show `#screen-craft`, hide the other two,
  `destroyLiveDiagram()`, fill the topbar, call `crafts[p.craft].renderProject`.
  When the active project changes or the user goes home, call the previous
  craft's `destroyProject()` first.
- The **New project** sheet gets a craft picker at the top (segmented control
  with emoji + name for every registered craft, hidden when only crochet is
  registered). Picking a craft re-renders the template picker filtered to that
  craft, hides crochet-only fields for other crafts, and mounts
  `newProjectFields`. `Save` passes `craft` and the merged `craftData` to
  `Store.createProject`. **Edit project** shows the craft as a read-only tag
  (crafts are not switchable after creation).
  For a craft other than crochet the sheet also shows a **craft drop zone** in place
  of the crochet PDF block (accept list from `def.importAccept`). Dropping a file
  there creates the project exactly as Save would (an empty name takes the file's
  base name), makes it active, closes the sheet, and calls
  `def.openImportSheet(projectId)` with the file already waiting: the **first**
  `ctx.pdfDropZone` the importer builds during that call takes it once mounted. So
  the user sees the craft's own preview and confirm step, and an importer needs no
  code for this beyond building its drop zone synchronously in `openImportSheet`.
- The **home card** shows `Store.summaryFor(p)` and a small craft emoji badge
  when more than one craft is registered.
- The **⋯ menu** for a non-crochet project: `Import pattern` → `def.openImportSheet`;
  `Parts`, `Yarn colours` and `Save as template` are hidden (v1); `def.menuItems`
  are inserted above `Notes`; `Checklist`, `Notes`, `History`, `Status`,
  `Export backup`, `Show me around` stay.
- `App.registerCraft` is also exported as `App.crafts()` → `[{ id, name, emoji, tagline }]`
  for settings/help copy.
- Settings gains a **Crafts** line under Help & tours listing the registered
  crafts with their taglines (informational). The craft may register FAQ
  entries via `onInit(ctx)` → `ctx.addFaq({ q, a })`.
- **Tours**: `js/tour.js` gains `Tour.register(def)` (adds to its `TOURS` map;
  the same `{ id, title, blurb, steps }` shape as the built-in four) so a craft
  can ship its own walkthrough; `Tour.list()` then includes it in Settings →
  Help & tours automatically. Optional for v1.
- Craft identity emojis: crochet `🧶`, **cross-stitch `🧵`**, **sewing `🪡`**
  (the research flagged `❌` as ugly on some platforms; `🪡` is Unicode 13 and
  renders on every phone this app targets).

### The reusable PDF drop zone

The crochet Import sheet's drop zone (dashed box, hidden file input, "Reading
page 3 of 21…" progress, non-PDF toast) is factored out so crafts do not
re-implement it:

```js
ctx.pdfDropZone({
  label: 'Drop a cross-stitch PDF here, or choose a file',
  accept: ['.pdf', '.oxs', '.xml'],   // optional; default PDF only. Non-PDF matches go to onFile.
  onText(res) {},            // res = PdfText.extract result { text, pages, chars, columnsDetected }
  onPages?(pdfDoc) {},       // optional: the loaded pdf.js document, for page.render() to canvas
  onFile?(file) {},          // a non-PDF file that matched `accept` (e.g. an .oxs chart), read it yourself
  confirm?(file) {},         // gate before reading → boolean | Promise<boolean>
  handOff?(file) {},         // catch the file UNREAD (type checked against `accept`, no quota/size
                             // gates, no read) and pass it on; used by the New project craft zone
  onError(err) {}
}) → HTMLElement            // append it wherever the sheet wants it
// wave F, on the returned node:
wrap.cancel()               // stop the read in progress AND any page render on the handle given to
                            // onPages (that handle is unusable afterwards)
wrap.signal()               // the signal that handle honours, to pass on as { signal }
```

`PdfText` gains `PdfText.open(file, { signal }) → Promise<{ doc, numPages, textOf(pageNo),
extract({ onProgress, maxPages, signal, allowEmpty }), renderPage(pageNo, { scale|maxWidth, signal })
→ Promise<HTMLCanvasElement>, destroy() }>` so a craft can both read text and rasterise chart pages
from a single load. `handle.extract` is the whole `extract()` pipeline on the open document
(running-head pass, unicode folding, `emptyPages`, `garbled`, `ocrNoise`, `columnsDetected`);
`allowEmpty` makes a text-free PDF resolve with only its page markers instead of rejecting.
`renderPage` honours its own `signal` and the one the document was opened with, and cancels
mid-page through pdf.js's render task, rejecting with `AbortError`. The existing
`PdfText.extract` is unchanged and used by crochet. See SPEC.md "PDF import" for the details.

The drop zone passes its signal into `PdfText.open`, so Cancel stops the read during the file
read or the parse. With `onPages` + `onText`, `onText` receives the **full extract result**
(`handle.extract({ signal, maxPages, onProgress, allowEmpty: true })`), including the 20-page
cap from the big-file prompt; for a scanned PDF its `text` holds only page markers and
`emptyPages` lists every page, so the craft's "this PDF is a scan" path must check for that
rather than expect a rejection. A craft's own Stop button should pass `{ signal }` to every
`renderPage` it starts (`wrap.signal()`, or its own `{ cancelled }` object) so Stop is immediate
instead of waiting for the page in progress.

`Tour.register(def)`: `def.steps` must be a **function** returning the step
array (the built-in tours are declared that way so targets are resolved late),
not a plain array.

## Shared UI pieces crafts should reuse (from `css/app.css`)

`.card`, `.list`/`.list-item`, `.menu-item`, `.field`/`.field-hint`, `.btn`
(`.primary`/`.ghost`/`.danger`/`.block`/`.big`), `.linkish`, `.chip`, `.pill`,
`.progress`/`.bar`/`.bar-fill`/`.bar-label`, `.stepper`, `.seg`, `.switch`,
`.tabs`/`.tab`, `.stitch-btn` (the big tap button; give it your own id and put a
caption + big number inside exactly like the crochet one so themes style it),
`.readout`, `.dz*` (drop zone), `.check`, `.item-*` (checklist rows), `.tpl-*`
(template cards), `.muted`, `.sr-only`. Sheets come from `ctx.openSheet`.

## Cross-stitch importer rules (`js/xstitch.js`, wave E)

The ground truth, discrepancy table and residuals are in `docs/wave-e/xstitch-audit.md`.
What `XStitch.parseKey` now promises beyond the research spec:

- **Strands per stitch type.** The key result carries `strandsDefault` (cross),
  `bsStrands` (backstitch) and `knotStrands` (French knots, from "French knots in N
  strand(s)"); on a line holding two headings, the number after "backstitch" is the
  backstitch one. The app gives back and knot rows their own count (`key.bsStrands` /
  `key.knotStrands`), never the cross default.
- **Over two.** `fabric.over = 2` when the text says so, when `N HPI` / "holes per inch"
  is half the fabric count (WOCS "14 HPI (28-count evenweave)"), or when a printed size
  is exactly 2× design/count on **linen or evenweave**. KG-Chart prints that doubled
  size on **aida** too; there the size is corrected to design/count and a warning says
  so ("…it is really 35.7 x 35.7 in"), and aida is never turned into over two.
- **Printed sizes** (`sizes`): `14-ct`, `14-count` and curly or prime inch marks are
  read, and each row is turned to w × h against the design size.
- **Codes.** A page footer glued before or after a code (`34062 / 62` → 340) is
  stripped; an equivalents number wrapped onto its own line belongs to the row above
  (Cosmo 844 is not DMC 844); on a short line a known DMC 333/444/666/777 is a code, not
  a glyph run; **DMC 1–35** (the 2017 shades) are accepted only inside a column headed
  DMC, between DMC rows, never in brackets or before a unit — they have no swatch
  ("no colour data for DMC 19", grey); Light Effects E-codes pass the DMC-library
  bare-row check.
- **Layouts.** A multi-column `code (N ct)` key read across the gutter is put back in
  column order (`expandCountColumns`); a heading line naming two techniques takes its
  kinds in heading order, each "* N skein" footnote advancing to the next; a trailing
  "N 28.8 in." is a stitch count plus a floss length, not part of the name.
- **Brand columns.** A key with DMC / Anchor / Madeira (or Cosmo) columns reads one
  colour per row from the DMC column; the other brands are equivalents, never colours of
  their own.
- **Symbols.** Symbol fonts extract as their font codes and KG-Chart draws glyphs as
  paths, so `applyPdf` always assigns the app's own symbol set; the app key and the
  paper chart can differ.

## Cross-stitch chart rules (`js/xstitch.js`, `js/app-xstitch.js`, wave F)

What the stitcher sees, the pane checks and what is left: `docs/wave-f/xstitch.md`
(04 #1, #2, #3, #13 partly, #14, #15 and "next stitch of this colour").

- **View state** (04 #2), all normalised on load and written only through
  `Store.updateCraftData(id, fn, { undo: false })` (`saveViewState`, debounced
  300 ms, flushed when the Chart sheet closes):
  - `current.view: { z, x, y } | null` — `z` CSS px per stitch (capped at
    `XStitch.VIEW_MAX_Z`, 64), `x`/`y` the fractional stitch at the middle of the
    chart area, clamped to the chart; `null` opens at Fit (Fit, the Fit button and
    a double-tap store `null`). On restore the zoom is clamped to at least Fit for
    the current canvas, and a resize keeps a zoomed view's middle stitch.
  - `current.tool: 'tap' | 'paint' | 'block' | 'page'` (default `'tap'`) and
    `current.layer: 'cross' | 'back' | 'knots' | 'part'` (default `'cross'`; the
    sheet falls back to Crosses when the chart has no such layer).
  - The crosshair `current.cx` / `current.cy` (a strip tap, 🎯) and `current.page`.
  - **Unmark is never remembered**: a chart reopened in erase mode would quietly undo
    the next tap. `current.zoom` is unchanged and unused.
- **Page records carry the stitch range they print** (04 #3). `pages[i].region:
  { x, y, w, h, fx, fy, fw, fh } | null` — `x, y, w, h` the cell range in chart
  stitches, `fx, fy, fw, fh` where that range sits on the page as fractions of its
  width and height (all four null when unknown, e.g. a rotated page).
  `XStitch.extractGrid` returns `regions: [{ page (1-based), region }]`, one per
  placed tile (`[]` on failure). When the grid reader wins, every page is still
  rendered and kept (the grid adds a chart; it does not replace the pages), a page's
  `isChart` follows "has a region", and a re-import deletes `chartpage:` images the
  new page list no longer uses. `XStitch.pageForCell(pages, x, y)` picks the page
  that printed a stitch; 📄 in the Chart sheet opens the full-screen page viewer
  there with the stitch outlined (falling back to the nearest kept page past the
  40-page cap; an import made before wave F has no regions and says so).
- **Rulers and position** (04 #1): screen-space rulers numbered from 1 at
  `XStitch.rulerStep(z, minPx)` (10, 20, 50, 100…), centre marks at w/2 and h/2
  (`centreOffset(i, n) → { k, side }`), and a readout from
  `positionLabel(x, y, w, h) → { col, row, grid, centre, block, text }` that is
  also the canvas's `aria-label`. Theme colours are read once per theme.
- **`keyOrder`.** `parseKey` reports `keyOrder: 'extractor' | 'repaired'`.
  `expandCountColumns` (exposed as `_key.expandCountColumns` for the tests) treats a
  run as read across only when at least two of its lines, and at least half, hold two
  or more `code (N ct)` cells; otherwise the extractor's order is kept. All four
  Pokémon fixtures are `'extractor'`: the repair is a fallback.
- **Block counting** (04 #15). In cells mode the big button marks the first stitch
  still to do, in reading order, inside the crosshair's 10×10 block, then moves to
  the block of the nearest stitch still to do (`XStitch.nextStitchNear(cells, w, h,
  value, x, y, done)`); the readout is "block 15,25 · 4 left here · 3 / 12,711"
  (counts mode keeps the group readout). −1 takes back the stitch the button marked
  last (an in-memory `tapHistory`), falling back to reading order when that is
  empty. 10×10 with a colour isolated (◉) marks only that colour in the block;
  with none isolated it marks every colour. 🎯 jumps to the nearest stitch of the
  current colour still to do (`nearestCellOf`, skipping the ones it has already
  shown, so neighbours never ping-pong; a chart tap starts over).

## Sewing importer rules (`js/sewing.js`, wave E)

Ground truth and residuals: `docs/wave-e/sewing-audit.md`.

- **Printed step numbering.** `Sewing.printedSteps(steps)` groups consecutive
  construction cards that share a printed number (`step.n`) into one printed step —
  "(continued)" cards and titled sub-paragraphs ("Centre Back Seam:" under step 4) —
  and starts a new run when a number drops (bathers top 1–10, briefs 1–5). A run's count
  is its highest printed number, so a missed step never reads "22 of 21"; unnumbered
  paragraph and bullet steps fall back to card order. `Sewing.printedDone(steps, ps?)`
  counts printed steps whose cards are all ticked. The UI follows the paper: header and
  ring "Step 4 of 6", a "card 2 of 3" chip only when a step spans cards, the step list
  "4 · 2/3", announcements "Step 4 of 6, card 2 of 3", progress and finish by printed
  steps, home card "step 4 of 6" / "all 8 steps done".
- **Long steps** (over 800 characters) carry on to "(continued)" cards, split at a
  sentence, at most three cards, instead of being cut.
- **Optional extras** (variations, care notes; `step.optional`) are shown after the
  construction as "Optional extra n of m" and never count toward progress or finishing.
- **Placeholder pieces.** A real import that finds no cutting list removes the
  template's untouched placeholder pieces (and, with no notions, its placeholder
  notions); rows the user ticked or edited stay, and "Just keep the text" changes nothing.
- **Fabric rows.** A row printed without a bolt width (`LINING 1m / 1 yd`) is kept and
  reads "<name> · any width"; a width-only row with no amount is dropped with "The
  fabric requirements table could not be read — add the yardage yourself."; Metres and
  Yards lines of one fabric are one row; BINDING / BACKING labels name the row under
  them and "(Included)" is its amount; a column-printed table is zipped back together;
  improper yardage "11/8 yard" is 1 1/8.
- **Cutting.** The same piece under two groups is kept twice, labelled; elastic lengths
  are not pieces; diagram captions ("…: Cut N") are skipped when the table's rows lead
  with "(N)"; overprinted size-layer labels on pattern sheets are stripped; ® / ™ are
  not part of a product code ("Pellon® Peltex® 70").
- **Pattern names from the text.** "Instructions & Pattern <name>" is the name; a line
  printed twice scores higher; letter-spaced lines, credits ("designed by", "X by Y",
  "featuring"), labels, test squares and tile labels are never names. A name that is
  only cover artwork stays blank rather than wrong.
- **Not steps, not sections.** Running heads, "DIAGRAM n" / "Fig. n", rows of diagram
  letters, capitals magazine decks and boilerplate (web addresses, ©, logos,
  disclaimers) never become steps or sections; "sewing instructions - X" names the
  section; a short caption inside a running step does not end it.

## Sewing rules (`js/sewing.js`, `js/app-sewing.js`, wave F)

What the sewist sees, the pane checks and what is left: `docs/wave-f/sewing.md`
(05 #1, #3, #5, #7, #10, #15).

- **Split and merge keep the printed number.** `Sewing.splitStep(data, index, at)`
  (`at` a sentence index, 1..n−1) and `Sewing.mergeSteps(data, index)` mutate the
  data and return a boolean; the app makes each one a single `updateCraftData` call,
  so ↶ Undo and the toast's Undo both put it back. Both halves of a split keep
  `step.n`, so they read exactly like wave E's "(continued)" cards ("1 · 1/2", "card 1
  of 2"). A merge keeps the first card's number, section and page, is done only when
  both cards were, and never folds an optional extra into a construction card.
  `Sewing.sentences` keeps a leading "(Figure 1)" with the sentence before it.
  A split or merged card carries `StepRow.src` (a `Sewing.textKey` of the imported
  card(s) it came from, `+`-joined for a merge; `/^[a-z0-9.+]{3,400}$/` or dropped), and a
  re-import puts the sewist's cards back, ticks kept, wherever those imported texts
  are unchanged. Saved step text is capped at 4,000 characters (`STEP_SAVED_CAP`);
  the parser still makes cards of at most 800. ＋ Add step inserts after the last
  construction card.
- **Cutting chips count pieces, not rows.** A row reads "0 of 4 cut" with −; up to
  6 pieces a tap adds one and stops at the total ("All 2 cut — use − to take one
  off", no wrap to zero); above 6 the chip opens a counter (−10 / −1 / +1 / +10,
  None cut, All N cut). `Sewing.cutTotals(data) → { cut, total, rows, rowsDone }`
  feeds the sheet header ("7 of 112 pieces cut · 1 of 18 rows done"), the mini row,
  the table's label and the home card (`Sewing.summary`). **"Cut 1 pair of pockets"
  and "Pocket: cut 1 pair" are 2 pieces** with `grain: 'pair'`; `Sewing.cutHint(row)`
  explains mirrored pairs, the fold, bias and crosswise. A re-import matches counts by
  piece, fabric and note, by name only when the name is unique on both sides.
- **Optional group.** With a real steps block, a heading-shaped line outside it that
  names a hack, variation, "make it your own" or customise section (capitals, or Title
  Case of six words or fewer) starts an optional run up to the next heading, page
  break or block; it becomes `variations` cards (`step.optional`), "(OPTIONAL!)"
  stripped. Care, washing and social pages are not taken from outside the
  instructions. The step list shows construction first and the extras in a collapsed
  **"Optional — N extras, not counted"** group that opens by itself on an extra; they
  never count toward progress or finishing.
- **Shopping list.** `Sewing.shoppingList(data, { fabric, notions, thread })` puts
  fabric first (the chosen size's amount per bolt width, else every size range, a
  grid row's groups), then the notions not ticked off (minus one that only names a
  listed fabric), then "Thread to match" unless thread is listed; the pattern's
  strings are kept verbatim. The toggles are `Settings.crafts.sewing.shopping`
  (`{ fabric, notions, thread }`).
- **Layout pages.** `Sewing.layoutPages(sourceText)` finds "CUTTING LAYOUTS"
  (kerning-split too), "Cutting layout", "fabric layout", "lay plan" and Pattern
  Runway's "Cutting layouts show approximate position…", skipping a heading in a
  stack of side headings and a quilt's "Quilt Layout". The Cutting sheet offers them
  as page chips that open the page viewer when the image is stored. With "Keep the
  pages" ticked the render queue runs step pages, then layout pages, then optional
  extras' pages, then the rest, so "Stop — keep the pages so far" keeps the diagrams.
- **Seam-allowance reminder.** `Sewing.saPhrases` names the parts an exception covers;
  `Sewing.saReminder(data, stepText) → { mm, inches, part, text }` turns the step
  card's chip into "Seam allowance 6 mm (1/4") · neckline" on a step that mentions
  one. It is a reminder, never a rule.
- **Grouped fabric grids.** A "TOP SHORTS PANTS / METERS YARDS / widths / SIZES A-H …"
  table is read into one row per garment and width with one amount per group;
  `FabricRow.groupLabels` (e.g. `['A-H', 'I-P']`) is kept only when it lines up with
  `rawAmounts`. Amounts are spread per size only when a size chart's labels tile the
  groups; otherwise the Fabric sheet shows a chip per group as printed.

## Testing and verification (every craft)

- `test/<craft>.test.html`: parser unit tests on committed synthetic snippets
  (aim for ≥ 60 assertions at launch), same style as `test/patterns.test.html`.
- `test/<craft>.fixtures.html`: runs against real PDFs/files in `tmp-pdf/`
  (gitignored, copyrighted, never committed); skips gracefully when absent. It
  extracts through `PdfText` and caches the text in sessionStorage, so after a
  change to `js/pdftext.js` run it in a fresh tab.
- Browser check at 375×812 in the Browser pane (on localhost the service worker
  is network-first, so a reload is enough; see `HANDOFF.md`), exercise create →
  import → count → undo → export/import round-trip → delete, then confirm a
  crochet project still works. When other agents share the pane, run in-app checks
  under a private key (`Store.__setKeyForTests('<own key>')`, test-only) and clean up
  your `p:<id>:` images afterwards; page renders stall while the pane is hidden (see
  `HANDOFF.md`).
- Performance: a stitch tap or "mark done" must update the DOM in < 5 ms; chart
  pan/zoom must hold 60 fps on a 200×250 chart (canvas, not DOM cells).

## Build order

1. Shell plumbing (this document): Store craft fields + `registerCraft` +
   `updateCraftData` + template craft, `BlobStore`, `#screen-craft`, router,
   craft picker, menu routing, `PdfText.open`, `ctx.pdfDropZone`, script/CSS
   tags, empty stub files that register nothing, sw precache, tests still green.
2. Cross-stitch and sewing modules in parallel, each strictly inside its own
   files; the only shared edits are the already-present script/CSS tags.
3. Photo → chart (`js/xstitch-photo.js`) after the cross-stitch chart viewer
   exists, since it outputs the same chart data model.
