# Crafts: the plugin contract

Thready or Not started as a crochet counter. From September 2026 it also serves
**cross-stitch** and **sewing**, and from October 2026 (wave H) **knitting**. Wave K
(November 2026) gave every craft the shell's shared surfaces — working mode, the check
sheet, the share card, the page viewer, templates, count events and work sessions, heavy
data in IndexedDB, the opt-in text reader — through new optional registration fields;
they are collected in **"Wave K: shared surfaces"** at the end of this document. Each
craft is a module in its own files that plugs into the existing shell (home
screen, project header, sheets, themes, export/import, service worker). The
crochet code paths stay exactly as they are; a project with `craft: 'crochet'`
(the default, and what every old save migrates to) renders through the existing
`#screen-project` and never touches anything in this document.

There are three kinds of craft module:

- a **chart craft** (cross-stitch) and a **steps craft** (sewing) paint their own
  project screen inside `#screen-craft` (`renderProject`), keep their state in
  `craftData` and bring their own importer (`openImportSheet`) — most of this
  document;
- a **counter craft** (knitting) paints nothing of its own: its projects open on
  the crochet counter (`#screen-project`) with every crochet feature, and the
  craft brings a pattern **parser** that fills the same `Line` records crochet's
  does, plus whatever widgets it adds to the counter. See "Counter crafts" below.

This document is the contract between the **shell** (`js/store.js`, `js/app.js`,
`index.html`, `css/app.css`) and the **craft modules**. Per-craft data models and
screens live in `docs/research/cross-stitch.md`, `docs/research/sewing.md` and
`docs/research/knitting.md` (research + proposed specs; knitting's is the
fixtures' ground truth) and, once built, in SPEC.md sections for each craft.

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
js/knits.js             # window.Knits      – knitting parser: Patterns.createParser(knitting profile) (wave H)
js/knit-chart.js        # window.KnitChart  – knitting charts read off a PDF page (wave H, no DOM)
js/app-knitting.js      # window.AppKnitting – registers knitting as a counter craft (wave H; no CSS
                        #   file: its counter widgets live in css/app.css "Wave H — knitting on the counter")
test/xstitch.test.html, test/sewing.test.html, test/blobstore.test.html
test/knits.test.html, test/knits.fixtures.html, test/knit-counter.test.html, test/knit-chart.test.html

# wave K (contracts in docs/wave-k/api/<worker>.md)
js/workmode.js          # window.WorkMode   – working mode for any craft (shell; crochet and knitting run on it too)
js/checksheet.js        # window.CheckSheet – the one Check shape, sheet and ✓ ≈ ≠ ? badge
js/sharecard.js         # window.ShareCard  – the 1080 px "Share a picture" card, on the device
js/pageviewer.js        # window.PageViewer – one pinch / zoom / pan / outline viewer for page images
js/ocr.js               # window.Ocr        – loader for the opt-in text reader (engine in js/vendor/tesseract/,
                        #   never precached; downloaded only on the maker's tap)
js/xstitch-render.js    # window.XSRender   – stitched-fabric WebGL renderer, loupe, time-lapse, framed picture
js/xstitch-keyread.js   # window.XSKeyRead  – a colour key read from a picture (digits solved as a cipher)
js/app-xstitch-extras.js# window.XStitchExtras – self-contained cross-stitch sheets (⋯ menu), css/xstitch-extras.css
js/sew-figures.js       # window.SewFigures – a step's own figure, swatches, tape-up map (pure + small widgets)
js/sew-quilt.js         # window.SewQuilt   – quilt-top model, cutting board to scale, unit picture
js/app-sewing-extras.js # window.SewingExtras – self-contained sewing sheets (⋯ menu), css/sewing-extras.css
css/knitting.css        # knitting's own widgets (app-knitting.js paints through def.counterPaint)
```

Script order in `index.html` (after the existing tags, in this order):
`blobstore.js`, `zip.js` (the shell's `.thready` backup container, wave F),
`xstitch.js`, `xstitch-photo.js`, `sewing.js`, then `app.js`
as today, then `app-knitting.js`, `app-xstitch.js`, `app-sewing.js`. Knitting's
pure files load earlier, beside the files they build on: `knits.js` right after
`patterns.js` (it calls `Patterns.createParser` at script time) and
`knit-chart.js` right after `pdftext.js`. Craft UI files register at
script-evaluation time; `App.init` runs on `DOMContentLoaded`, after all of
them, so registration order never matters. Every new file is precached in
`sw.js` and `CACHE_VERSION` is bumped on release. `css/xstitch.css` and
`css/sewing.css` are linked after `css/themes.css` and use ONLY the theme
variables listed in SPEC.md ("Themes contract") plus their own layout numbers.
**The script and stylesheet order as wired since wave K** is `docs/wave-k/api/shell-ui.md` §8
(the shared surfaces load before `app.js`; `xstitch-read`, `xstitch-render` and
`xstitch-keyread` after `xstitch.js`; `sew-figures` and `sew-quilt` after `sewing.js`; the
extras files after their craft's app file); `test/sw.test.html` asserts that order, that every
script and stylesheet is precached, and that nothing under `js/vendor/tesseract/` is.
`CACHE_VERSION` is generated (`tools/sw-version.sh`), never hand-bumped.

A module that fails to load, or a browser that cannot run it, must never break
crochet: every shell entry point checks `crafts[id]` exists before calling it
and falls back to a friendly "This project needs the <name> module" card.

## Store (shell side)

```js
Project.craft: 'crochet' | 'knitting' | 'crossstitch' | 'sewing'   // default 'crochet' (old saves migrate to it)
Project.craftData: object                              // opaque to the shell; owned by the craft module
Template.craft: 'crochet' | 'knitting' | 'crossstitch' | 'sewing'   // default 'crochet'
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
  `craft` wins when `opts.craft` is missing. For chart and steps crafts `parts` is
  still created (one part named `Main`) so nothing in the shell that expects
  `parts.length >= 1` breaks, but the craft UI may ignore parts entirely. A
  counter craft's template parts are real parts, made exactly as crochet's are.
- **`Part.workMode`, `Part.orientation` and `Part.dialect` belong to the counter**
  (added by the 3D diagram work; see SPEC.md): crochet's, and a counter craft's,
  which runs the same counter (knitting uses Worked in and Orientation; it hides
  Terms, because dialect is crochet's). They are normalised on load for
  every project whatever its craft, because `Part` is one shape shell-wide and a
  missing field would be `undefined` rather than `'auto'` — but nothing outside
  the counter paths reads them: they only feed `Store.diagramModel` /
  `DiagramGeo`, and the part editor's chips for them (Worked in, Orientation,
  Terms) sit with the other counter-only fields the chart and steps craft UIs
  hide. A craft module must not repurpose them; per-craft state belongs in
  `craftData` (a counter craft may also add its own `Part` fields, normalised on
  load and carried by other crafts only when set, as knitting's are).
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
  `js/app-sewing.js` (`STORED_HERE`) says the same since wave K ("go into a .thready backup";
  a plain .json backup leaves them out). A craft that stores page images must
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
  importAccept: string[],
  // --- wave H (see "Counter crafts"); every one optional ---------------------
  usesCounter: boolean,              // true: no #screen-craft; the project runs on the crochet counter
  parser: 'Knits' | api,             // the craft's pattern parser (a window global's NAME, or the object)
  parserExtras: { checklistStart: RegExp, checklistSections: RegExp },
  settingsFields(body, ctx),         // the craft's own section in Settings → Crafts (any craft)
  faq: [{ q, a }],                   // Settings → Help entries (same as ctx.addFaq in onInit)
  tourId: string,                    // counter craft: the tour "Show me around" starts
  label: string,                     // alias of `name`
  // --- wave K (see "Wave K: shared surfaces"); every one optional and feature-detected ---
  workMode: spec,                    // working mode on the shell's engine (js/workmode.js)
  template: { fromProject(p), fields?(body, draft, ctx), describe?(tpl) },  // forwarded to Store.setCraftHooks
  settings: { defaults?, normalize? },   // the craft's settings bag (forwarded likewise)
  copy: { dropLabel, homeEmpty?, allDone?, importEmpty?, newProjectHint? },
  sharePicture(project, { size }) → canvas | Promise<canvas> | null,   // the craft's picture on the share card
  shareProgress(project),            // the card's progress line (optional)
  counterPaint(p, prt, nodes)        // counter craft only: paint own widgets after each counter paint
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
  // wave K
  workMode: { open, close, isOn, refresh, button(label?) },  // for the craft's def.workMode
  counted(ev),                                               // the one announcement / haptic policy
  check: { badge, line, open, guard, demote, fromCountReport, fromXStitch },
  pageViewer(opts), sharePicture(projectId),
  ocr: { available, sizeLabel, offerButton, ensure, mark, check, LABEL },   // the opt-in text reader
  fillSizeMarked(node, text, part, project)                  // pattern text with the chosen size marked
}
```

- **Announcements** (`ctx.announce`) follow one policy in every craft: milestones only —
  a row/round, group, piece, part or project done, a colour done, a step done, a block or
  cut count moved, and every 50th stitch only where there is no grouping — never a single
  stitch. Calls landing together are spoken together. Since wave K the policy is one function,
  `ctx.counted(ev)` (below); cross-stitch moved to it (every 50th, from every 100th) and keeps
  its old cadence only as a fallback for an older shell.
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
- The **⋯ menu** for a chart or steps craft's project: `Import pattern` → `def.openImportSheet`;
  `Parts` and `Yarn colours` are hidden (`Save as template` shows for every craft since wave K,
  seeded by `def.template.fromProject`, else name, emoji and checklist only); `def.menuItems`
  (and, from wave K, the craft's extras module items, below) and the shell's
  `⤢ <workMode label>` and `🖼️ Share a picture`
  are inserted above `Notes`; `Checklist`, `Notes`, `History`, `Status`,
  `Export backup`, `Show me around` stay. A counter craft's project keeps
  crochet's whole menu (Parts, Import pattern, Yarn colours, Save as template …)
  with `def.menuItems(p, ctx)` above the file items, and "Show me around" starts
  `def.tourId` (see "Counter crafts").
- `App.registerCraft` is also exported as `App.crafts()` → `[{ id, name, emoji, tagline }]`
  for settings/help copy.
- Settings gains a **Crafts** line under Help & tours listing the registered
  crafts with their taglines (informational). The craft may register FAQ
  entries via `onInit(ctx)` → `ctx.addFaq({ q, a })`.
- **Tours**: `js/tour.js` gains `Tour.register(def)` (adds to its `TOURS` map;
  the same `{ id, title, blurb, steps }` shape as the built-in four) so a craft
  can ship its own walkthrough; `Tour.list()` then includes it in Settings →
  Help & tours automatically. Optional for v1.
- Craft identity emojis: crochet `🧶`, **knitting `🧣`** (wave H), **cross-stitch `🧵`**, **sewing `🪡`**
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

## Counter crafts (wave H)

A craft whose work is counted in rows and stitches like crochet (knitting is the
first) does not build a screen. It registers with `usesCounter: true` and brings a parser, and the shell
does the rest. The shell half of this (the dispatch, the store readers, the
import) is SPEC.md → "Crafts" → "Counter crafts and the parser slot".

**What `usesCounter` gives.** `isCraftProject(p)` is false for the craft, so
`render()` shows `#screen-project` rather than `#screen-craft`, and the project
gets everything crochet has: part tabs, make-counts, rows / rounds, the stitch
button with targets and auto-advance, repeats, alerts, placing notes, history,
the pattern line and sheet, size-once and size groups, the colour strip, the
count-confidence badge, templates with parts, the 3D button and viewer
(Worked in and Orientation chips), the New project drop zone and import picker
(sections, sizes, "From this PDF", "Also save as a template", checklist
suggestions), and crochet's ⋯ menu. `App.craftUsesCounter(id)` answers whether a
craft works this way; `App.parserOf(x)` gives the parser a project reads with.
Nothing crochet-only may break: crochet is never registered, and every hook a
counter craft adds is a no-op for crochet.

**What the parser must return.** Register it with `parser: 'Name'` (the name of
its `window` global, looked up on every call, so script order never matters) or
the object itself; `Store.registerCraftParser(id, api, parserExtras)` is called
for you. It must expose **every name `window.Patterns` exposes, with the same
arity** (`parse`, `targetFor`, `lineFor`, `summary`, `splitSections`, `placement`,
`detectSizes`, `sizeMarks`, `sizeScope`, `countReport`, `dialectHints`, `gauge`,
`evaluate`, `colors`, `colorHex`, `expand`, `startHint`, `workMode`,
`stuffingHint`, `glossary`, `craft`, `version`), and `parse` must return the
**`Line` contract** in SPEC.md → "Patterns API v2" → "The `Line` contract":
the crochet fields every reader relies on, plus any of the craft additions it
can fill honestly (`null` when it cannot; never a guess). The cheap way to get
all of that is `Patterns.createParser(profile)`: a profile overrides the
vocabulary, regexes and the hooks it needs and inherits the rest of the crochet
engine (SPEC.md → "Wave H: the craft-profile engine"). A parser that is
registered but did not load gives a plain counter and one line under the part
tabs ("the … pattern reader did not load"), never crochet's reading of the text.
`parserExtras.checklistStart` / `checklistSections` are the craft's finishing
verbs and section names for `Store.suggestChecklist` ("Graft toes", "Block").

**`settingsFields(body, ctx)`** (any craft) renders a section
`[data-craft-settings="<id>"]` under Settings → Crafts with the shell's `ctx`
helpers; read and write it through `Store.craftSettings(id)` /
`Store.setCraftSetting(id, key, value)`.

**Templates with parts.** A counter craft's built-ins are declared with
`Store.registerCraft({ id, templates })` (no `normalize` or `summary` needed:
the counter's home card line is crochet's) and are ordinary crochet-shaped
templates — `parts: [{ name, makeCount, patternText, workMode? }]`, `checklist`,
`countMode`, `groupSize` — so `createProject` makes real parts with their text,
targets read by the craft's parser. Give every built-in pattern text whose
counts were worked by hand; a row the text cannot count (a short row) must print
no count. The template editor shows Count / group size for counter crafts.

**Its own counter state and widgets** live in the shell files, in marked
regions, with Edit only (knitting's: "Knitting (wave H, knit-counter; …)" in
`js/store.js`, "14b. Knitting on the counter" in `js/app.js`, "Wave H — knitting
on the counter" in `css/app.css`). Rules: every entry point returns at once for
another craft; new `Part` / `Project` fields are normalised on load for the
craft and carried by others only when set, so a crochet save is byte for byte
what it was; every writer is one undo snapshot; templates and backups carry the
fields. A craft that reads the 3D model sets `Model.craft` and gets its own path
in `DiagramGeo` / `Diagram` (SPEC.md → "Live 3D diagram" → "2c. Knitting").

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

## Knitting (`js/knits.js`, `js/knit-chart.js`, `js/app-knitting.js`, wave H)

The binding names: `docs/wave-h/CONTRACT.md`. What each area built, checked and
left: `docs/wave-h/shell.md`, `knits-parser.md`, `knit-counter.md`, `knit-3d.md`,
`knit-chart.md`, `knit-research.md`. The fixtures' ground truth, hard line by
hard line: `docs/research/knitting.md`. The contract-level detail is in SPEC.md
("Knitting", "The `Line` contract", "Wave H: the craft-profile engine", "2c.
Knitting"); this section is the craft's shape.

- **Registration** (`js/app-knitting.js`, `window.AppKnitting`):
  `App.registerCraft({ id: 'knitting', name: 'Knitting', emoji: '🧣',
  usesCounter: true, parser: 'Knits', parserExtras, sectionNames,
  settingsFields, menuItems, tourId: 'knitting', faq, onInit })` and
  `Store.registerCraft({ id: 'knitting', templates })`. `AppKnitting.settings()`
  → `{ unit, needleSystem }` (default cm / metric, inches for an en-US browser,
  and US needles whenever the unit is inches), `AppKnitting.needleLabel(mm, system)` ('4 mm' / 'US 6' / 'UK 8'; mm
  when a system has no size), `AppKnitting.needleSizes`,
  `AppKnitting.sectionNames` (the garment nouns: Back, Front, Left / Right Front,
  Sleeve, Yoke, Body, Collar, Cuff, Neckband, Button Band, Hood, Pocket, Heel,
  Heel Flap, Gusset, Foot, Toe, Leg, Brim, Crown, Border, Edging),
  `AppKnitting.templates`.
- **Templates**: `knit-blank` Single piece, `knit-sweater` Sweater (Back, Front,
  Sleeves ×2), `knit-socks` Socks (Sock ×2), `knit-hat` Hat, `knit-shawl` Shawl,
  `knit-blanket` Blanket, each with a checklist (Block, Seam, Set in sleeves,
  Graft toes, Weave in ends …) and pattern text whose every bracketed count was
  worked through by hand (a 64-st top-down heel-flap sock numbered continuously
  rnds 1–56 / rows 57–103 / rnds 104–182; the heel turn prints no count).
- **Settings**: `Settings.crafts.knitting = { unit: 'cm'|'in', needleSystem:
  'metric'|'us'|'uk' }`, shown as Settings → 🧣 Knitting ("Measure in",
  "Needle sizes"). The unit is the default for an imported gauge whose unit is
  not printed and for a new project's empty gauge.
- **Parser** (`window.Knits` = `Patterns.createParser(KNIT_PROFILE)`): every
  `Patterns` name plus `readInstruction`, `until`, `profile`; the knitting `Line`
  fields (`side`, `delta`, `until`, `markers`, `shortRow`, `chart`, `cable`,
  `rowList`, `workedIn`, `sizeSkip`) and knitting `expand` records.
- **Counter**: the RS / WS chip, short rows, markers, two at a time, the cable
  ring, the length chip, the chart chip and sheet, the part editor's 🧣 Knitting
  card and ⋯ → 📖 Glossary, on `Project.gauge`, `Part.side / markers /
  markerTotal / linked / shortRows` and `craftData.charts / chartPages` (chart
  page images under `p:<id>:chartpage:<n>`, so the backup, Keep-both rekey and
  orphan sweep find them).
- **Charts** (`window.KnitChart`, no DOM, no app wiring): read from the page's
  vector drawing, matched to the page's own key, never guessed; `scan` runs once
  in the background after a knitting import. The no-guess rule is the craft's
  rule everywhere: a chart row with an unknown symbol, a row a column-mixed page
  scrambled, a size list that does not fit, a short row — each shows nothing
  rather than a number the pattern does not support.
- Wave H2 polish (see `docs/wave-h/knit-parser-polish.md`): 19 of the 23 KNOWN knitting fixture lines are closed (4 remain: Bernat neck/yoke names, T7, T9, R5); Tunisian crochet is a vocabulary pack on the crochet profile, not a craft.

## Testing and verification (every craft)

- `test/<craft>.test.html`: parser unit tests on committed synthetic snippets
  (aim for ≥ 60 assertions at launch), same style as `test/patterns.test.html`.
- `test/<craft>.fixtures.html`: runs against real PDFs/files in `tmp-pdf/`
  (gitignored, copyrighted, never committed); skips gracefully when absent. It
  extracts through `PdfText` and caches the text in sessionStorage, so after a
  change to `js/pdftext.js` run it in a fresh tab.
- Run suites headless since wave K: `bash tools/headless-suite.sh <page> …` or `--all`
  (real time by default; see `HANDOFF.md` "How to work on it" and `docs/wave-k/suites.md`).
  The Browser pane is for looking.
- Browser check at 375×812 in the Browser pane (on localhost the service worker
  is network-first, so a reload is enough; see `HANDOFF.md`), exercise create →
  import → count → undo → export/import round-trip → delete, then confirm a
  crochet project still works. When other agents share the pane, run in-app checks
  under a private key (`Store.__setKeyForTests('<own key>')`, test-only) and clean up
  your `p:<id>:` images afterwards; page renders stall while the pane is hidden (see
  `HANDOFF.md`).
- A counter craft built on `Patterns.createParser` shares the crochet engine:
  a change to either `js/patterns.js` or the craft's profile re-runs both
  crafts' parser suites (crochet's patterns 1112 / patterns.fixtures 905 since wave H are
  the gate that nothing crochet moved; they were 1037 / 829 when this rule was written), plus `test/store-safety.test.html`,
  `test/templates.test.html`, `test/crafts.test.html` and
  `test/diagram-model.test.html`. Fixture assertions are named after the
  research file's hard-line IDs, and a line the parser is known to miss is
  listed as KNOWN with its cause rather than loosened.
- Performance: a stitch tap or "mark done" must update the DOM in < 5 ms; chart
  pan/zoom must hold 60 fps on a 200×250 chart (canvas, not DOM cells).

## Wave K: shared surfaces

What each worker built, measured and left: `docs/wave-k/<worker>.md`; the exact signatures are
`docs/wave-k/api/<worker>.md` (the store side `shell-data.md`, the app side `shell-ui.md`). This
section is the shape of the contract and the rules a craft must keep; it does not repeat the
signatures. Every field and function is optional and **feature-detected on both sides**: a craft
checks the global / the `ctx` key before calling it, the shell checks the `def` field, and a
missing one gives today's behaviour.

**Registration fields added.** On `App.registerCraft(def)`: `workMode`, `template`, `settings`,
`copy`, `sharePicture`, `shareProgress`, `counterPaint` (listed in the `def` block above). On
`Store.registerCraft`: `template: { fromProject, blank? }`, `settings: { defaults, normalize }`,
`heavy: { fields, minBytes }`. The shell forwards `def.template` / `def.settings` with
`Store.setCraftHooks(id, …)`, so a craft may declare them on either side. As built: cross-stitch
registers `heavy` and `template` from `js/xstitch.js` and `workMode`, `sharePicture`, `copy` from
`js/app-xstitch.js`; sewing registers `workMode`, `sharePicture`, `copy` (no `template` hook yet,
so a sewing template keeps name, emoji and checklist only); knitting registers `counterPaint`.

- **Working mode** (`def.workMode`, `docs/wave-k/api/shell-ui.md` §1). The craft supplies a
  surface and actions (`primary`, `forward`, `back`, `undo`, `secondary`, `readout`, `panel`,
  `keys`); the shell owns the full-screen layout in both orientations, the header, the corner
  buttons, Options with ☀ Keep awake, ✕ / Escape, the keys (Space / Enter primary, arrows,
  **PageDown / PageUp for a page-turner pedal**), the remembered state (`settings.focusProjects`,
  no undo), announcements and reduced motion. `surfaceUnderHud: true` lets the surface fill the
  whole screen under the HUD (cross-stitch's chart); `api.insets()` still reports the free
  rectangle. Crochet and knitting run through the same engine (`adopt: true`) with no visible
  change. `test/workmode.test.html` has a demo craft to copy.
- **Check sheet** (`window.CheckSheet`, §2). One shape for "what the pattern prints against what
  the app read": `{ verdict: 'exact'|'close'|'off'|'unchecked', summary, rows: [{ label, printed,
  read, verdict, why, page }] }`, one sheet, one badge (✓ ≈ ≠ ?). **The rule: an `off` check
  demotes the primary button behind a plain "Use it anyway?" confirm (`ctx.check.demote` /
  `guard`); it never blocks and never hides the disagreement.** `unchecked` (nothing printed to
  check against) does not demote. Producers: crochet / knitting `countReport` (`fromCountReport`;
  `off` when a fifth of the counted rows disagree), the cross-stitch grid and picture readers
  (`fromXStitch`), `Sewing.importCheck`, `ctx.ocr.check` (every OCR line a `?` row, never ✓).
- **Share card** (`window.ShareCard`, §3): ⋯ → 🖼️ Share a picture on every project; the craft's
  `sharePicture(project, { size })` gives the picture (crochet and knitting get a 3D still from
  `handle.snapshot()`).
- **Templates for every craft** (§4, shell-data §2): `template.fromProject(project)` returns the
  seed with progress dropped; a template whose craftData is over 256 KB of JSON is refused with a
  plain sentence (templates live in localStorage). "＋ New template" asks for the craft first.
- **Count events and sessions** (shell-data §5, shell-ui §5). After each user action's own
  `updateCraftData`, a craft calls **`Store.counted({ projectId, n, unit, part? })`** once, with
  the units that action really moved (a whole-colour mark of 1,204 stitches is one event, n 1204;
  an unmark is negative). That records `Project.activity` (sessions split after 10 idle minutes,
  day rollups, totals) and feeds `Store.pace` (≈ finish only after 5 sessions) and goals
  (`Store.setGoal` / `goalStatus`). It does not speak: the craft speaks through **`ctx.counted`**,
  which applies the one announcement policy and haptics. The crochet / knitting counter records
  its own taps (`origin: 'counter'`, never announced twice).
- **Mark log** (`Store.logMarks(id, [[cellIndex, 1|0], …])`, shell-data §5): a chart craft logs
  every mark and unmark (bulk marks via `XStitch.markDiff`); chunks go to BlobStore as
  `p:<id>:marks:<seq>` and travel in `.thready` files. It is the only source of a real
  time-lapse; without it the replay is labelled "not your real order".
- **Heavy data off localStorage** (shell-data §4). Opt in with `heavy: { fields, minBytes }`
  (dotted paths to **string leaves** in craftData; cross-stitch: `chart.cells.data`,
  `progress.done`, 32 KB). Treat heavy values as immutable (assign a new string, never mutate).
  After a reload such a project is not ready until **`Store.whenReady(id)`** has read the
  IndexedDB blobs back; the shell calls it before `renderProject` and shows "Opening …" or an
  honest "Part of this project is missing" card (`Store.discardMissingHeavy` behind a confirm).
  `updateCraftData` on a project that is not ready returns `null` and changes nothing; backups
  hydrate first and write heavy values inline.
- **Profile and settings** (shell-data §3): `Store.profile()` (units, measurements, floss and
  fabric stash; `Store.setMeasurement` / `measurement(key, unit)`, `flossOwned` /
  `adjustFloss` / `flossAllocation`) is shared by every craft and shown in Settings → Your
  profile. Backups now restore settings (merge by default; device-only keys never).
- **Step edits and notes** (shell-data §6): `Store.stepKey` / `setStepEdit` / `setStepNote` /
  `applyStepOverlay`, keyed by a hash of the printed text so a re-import finds them. Sewing keeps
  its edits in its own craftData instead (`Sewing.editStep` / `setStepNote`); knitting uses the
  overlay for row notes.
- **Page viewer** (`window.PageViewer`, `ctx.pageViewer`, §7) and **the opt-in text reader**
  (`ctx.ocr`, §9). The reader is downloaded only on the maker's tap (about 5 MB once, into a
  `thready-ocr-*` cache `sw.js` never deletes); anything it reads is marked "Read from a picture
  — check it" (`ctx.ocr.mark`) and never accepted without a tap. A craft that runs it calls
  `Ocr.terminate()` after a batch. Use it only for the two jobs the spike proved
  (`docs/wave-k/ocr.md`): a **cropped** colour key checked against the DMC list, and scanned
  single-column prose. Never for size tables or whole chart pages.

**Extras modules** (cross-stitch `window.XStitchExtras`, sewing `window.SewingExtras`). A craft's
self-contained sheets live in their own file so two workers never share one. The contract is fixed
and tiny: **`Extras.menuItems(project) → [{ id, label, icon, hint }]`** (only what applies to this
project; an item whose engine function is missing is simply not listed) and **`Extras.open(id,
project, opts) → boolean`** (false for an unknown id; `opts = { ctx, app }`). The craft's app file
lists the items in ⋯ and may deep-link with `open`; the extras file never edits the app file and
reaches back only through feature-detected hooks (`XStitchApp.repaint / dataOf / picture`,
`SewingApp.repaint / quiltModel / captureSwatches`, the `sewingextras:change` event). Item lists
as built: `docs/wave-k/api/xs-extras.md`, `docs/wave-k/api/sew-extras.md`.

**Counter crafts** gain `def.counterPaint(p, prt, nodes)`, called at the end of every counter
paint (`nodes = { extra, patternLine, patternTag, patternText, … }`); the working-mode HUD mirrors
those nodes, so a widget painted there shows in working mode too. The knitting store additions
(stretch phases `Project.rowPhases`, `lineInfo`, `stretchInfo` / `endStretch`, `tapStitches`,
markers that move) are knitting-only regions of `js/store.js`: `docs/wave-k/api/knit-store.md`.

**Rules that carry over unchanged**: crochet never moves (every crochet suite keeps its count);
every writer is one undo snapshot; estimates are marked ≈ and become a target only when the maker
taps "Use"; units follow the pattern with a per-project switch; the pattern's own symbols and
swatches are shown only when captured cleanly; nothing runs on a server.

## Build order

1. Shell plumbing (this document): Store craft fields + `registerCraft` +
   `updateCraftData` + template craft, `BlobStore`, `#screen-craft`, router,
   craft picker, menu routing, `PdfText.open`, `ctx.pdfDropZone`, script/CSS
   tags, empty stub files that register nothing, sw precache, tests still green.
2. Cross-stitch and sewing modules in parallel, each strictly inside its own
   files; the only shared edits are the already-present script/CSS tags.
3. Photo → chart (`js/xstitch-photo.js`) after the cross-stitch chart viewer
   exists, since it outputs the same chart data model.
