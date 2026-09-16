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
`blobstore.js`, `xstitch.js`, `xstitch-photo.js`, `sewing.js`, then `app.js`
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
- `Store.summaryFor(project) → string` calls the craft's `summary(project)`
  (home card summary line); crochet keeps the existing `projectSummary`.
- Per-craft **settings** (things shared across projects, e.g. the sewist's own
  body measurements, machine presets, the cross-stitcher's default fabric
  count): `Settings.crafts: { [craftId]: object }`, read with
  `Store.craftSettings(craftId) → object` (always an object) and written with
  `Store.setCraftSetting(craftId, key, value)`. Normalised on load as an opaque
  JSON object per craft; included in export/import.
- Export/import JSON includes `craft`, `craftData`, `Template.craft`
  unchanged. `BlobStore` contents (page images) are NOT in the backup file in
  v1; the craft UI shows "chart images are stored on this device only" and can
  re-import the PDF.

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
  onInit(ctx)
}
ctx = {
  // the shell's helpers, so craft UIs look identical to the rest of the app
  el, button, on, clear, field, textInput, numInput, textArea, stepper, segmented, switchRow,
  openSheet, confirmSheet, toast, announce, fb,            // fb('tap'|'group'|'row'|'alert'|'done'|'undo')
  wake: { supported, isOn(), toggle() → bool },            // screen wake lock (the lock follows any open project)
  render,                                                    // full re-render (use sparingly)
  currentProject, openProjectEditor, openChecklistSheet, openNotesSheet, openHistorySheet, openStatusSheet,
  celebrate,                                                 // celebrate('project'|'part'|'piece')
  prefersReducedMotion, cssVar,                              // cssVar(getComputedStyle(root), '--primary', fallback)
  isPdfFile, firstFile, readPdfInto(zoneOpts) → node        // the existing PDF drop zone, reusable: see below
}
```

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
  onError(err) {}
}) → HTMLElement            // append it wherever the sheet wants it
```

`PdfText` gains `PdfText.open(file) → Promise<{ doc, numPages, textOf(pageNo), renderPage(pageNo, { scale|maxWidth }) → Promise<HTMLCanvasElement>, destroy() }>`
so a craft can both read text and rasterise chart pages from a single load. The
existing `PdfText.extract` is unchanged and used by crochet.

Caveat (as shipped): when `onPages` is given together with `onText`, the text
is assembled per page from `textOf(n)`, which still untangles columns and
drops per-page furniture but skips the cross-page repeated-running-head pass,
and `columnsDetected` is reported as 0. `onText` alone runs the exact
`extract()` pipeline. Crafts that need the running-head pass should call
`PdfText.extract` themselves and `PdfText.open` separately for page images.

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

## Testing and verification (every craft)

- `test/<craft>.test.html`: parser unit tests on committed synthetic snippets
  (aim for ≥ 60 assertions at launch), same style as `test/patterns.test.html`.
- `test/<craft>.fixtures.html`: runs against real PDFs/files in `tmp-pdf/`
  (gitignored, copyrighted, never committed); skips gracefully when absent.
- Browser check at 375×812 in the Browser pane: clear the service worker and
  caches before every check (`HANDOFF.md` has the snippet), exercise create →
  import → count → undo → export/import round-trip → delete, then confirm a
  crochet project still works.
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
