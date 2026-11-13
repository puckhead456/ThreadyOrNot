# API: the shell's shared surfaces (wave K, shell-ui worker)

Status: BUILDING (batch 1). Every name here is feature-detectable: a craft module must check the
global / the `ctx` key exists before calling it and degrade quietly (old cached files).
Files: `js/workmode.js` (`window.WorkMode`), `js/checksheet.js` (`window.CheckSheet`),
`js/sharecard.js` (`window.ShareCard`), `js/pageviewer.js` (`window.PageViewer`), all loaded
**before** `js/app.js`; wiring in `js/app.js`. Test / demo pages: `test/workmode.test.html`,
`test/checksheet.test.html`, `test/sharecard.test.html`, `test/pageviewer.test.html`.
CSS for all four lives in `css/app.css` ("Wave K — shared surfaces"), theme variables only.

---------------------------------------------------------------------------------------------------
## 1. Working mode — `def.workMode` (js/workmode.js)

A craft that registers `App.registerCraft({ …, workMode: spec })` gets crochet's wave I working
mode: the shell owns the full-screen layout (portrait + landscape), safe areas, the header (✕,
title, Options ▾), the bottom-corner buttons, the Options panel (with ☀ Keep awake added by the
shell), the keyboard and page-turner pedal keys, the exit path (✕, Escape), the remembered state
(`Store.focusMode` / `setFocusMode`, i.e. `settings.focusProjects`, no undo), the open / close
announcements, the count announcement cadence (§5) and reduced motion. The craft supplies the
surface and the actions.

```js
spec = {
  label: 'Stitch mode',                 // the open button / announcements ("Stitch mode. 3 of 12,711")
  icon: '⤢',                            // optional
  // The surface fills the screen under the HUD. Called once per open with an empty
  // <div class="work-surface">; paint a canvas, a step card, a chart… Return optional hooks.
  surface(node, api) → { destroy?(), resize?(), insets?(ins) } | void,
  surfaceUnderHud: false,               // opt-in (wave K, for cross-stitch's chart): the surface fills the
                                        // WHOLE screen and the header, readout stack and next line float
                                        // over it on scrims (the theme's --primary at 82 %, blurred);
                                        // the surface's background becomes --bg. api.insets() /
                                        // surface().insets(ins) still report the free rectangle, so keep the
                                        // current stitch inside it; draw the rest of the chart under the HUD.
                                        // api.underHud() → true. Ignored with adopt (crochet / knitting).
  tapSurface: true,                     // default true: a tap on the surface (not on a HUD control,
                                        // within 12 px of where it went down) runs primary.
                                        // false: the surface handles its own taps (a chart cell tap).
  primary:  { label: 'Mark a stitch', run(api) },     // Space / Enter, and the surface tap
  forward:  { label: 'Next row', run(api) },          // ArrowUp / ArrowRight / PageDown (pedal). Default: primary
  back:     { label: 'Previous row', run(api) },      // ArrowDown / ArrowLeft / PageUp (pedal). Optional
  undo:     { label: 'Undo', run(api), enabled?() } | true,   // true → Store.undo() + render
  secondary: [ { id, glyph, label, word?, side: 'start'|'end', accent?, run(api),
                 hidden?(api), disabled?(api) } ],   // extra big corner buttons (−1, ‹ colour ›)
  readout(api) → {                     // repainted on every App.render() and api.refresh()
    title: 'Cottage sampler',           // header middle
    cells: [ { cap: 'STITCHES', big: '3', of: '/ 12,711', sub: 'DMC 310 · block 15,25', over: false } ],
    line:  { tag: 'STEP 4', text: 'Sew the side seams…', notes: '' } | null,   // the big text line
    hints: [ 'Seam allowance 6 mm · neckline', { text, cls } ],
    next:  { tag: 'Next', text: 'Step 5 · Press the seams open' } | null,
    tip:   'Tap anywhere to mark · arrows move' | null,     // shown until hidden by the craft
    say:   'Step 4 of 6'                // the sentence announced on open / close
  },
  panel(body, api),                     // optional: Options ▾ content (the shell appends Keep awake)
  keys: { 'h': fn(api, e), 'H': fn },   // optional extra keys (never from a text field / sheet / tour)
  onOpen(api), onClose(api)             // optional
}
api = { project(), refresh(), close(), announce(text), counted(ev) /* §5 */, insets() → {top,right,bottom,left},
        host, surface, hud, landscape() → bool, reducedMotion() → bool, nodes /* HUD nodes */ }
```

Shell side (`ctx.workMode`, also `App.workMode`):
- `ctx.workMode.button(label?)` → a ready `.btn` "⤢ <label>" that opens the mode (put it where you like).
- `ctx.workMode.open()` / `close()` / `isOn()` / `refresh()`.
- A remembered mode reopens by itself when the project is opened or the app reloads.
- `#screen-craft.work-mode` hides the topbar and `#craft-body`; `.work-surface` is `position:absolute; inset:0`.
- Layout classes: `.work-hud` grid (`head / stack / . / foot / btns`; landscape: a left column of at
  most 46 % / 520 px), `.work-big` 60 px digits (56 short, 54 short landscape), `.work-line-text` 21 px.
- `api.insets()` is the free rectangle the HUD leaves (portrait: between the readout stack and the
  next line / buttons; landscape: right of the column). `surface().insets(ins)` is called when it changes.

Engine (pure + DOM, for tests): `WorkMode.create(host, spec, env) → session` with
`session.open() / close() / refresh() / isOn() / handleKey(e) / insets()`; `env = { remember(on),
wanted(), announce, counted, blocked() /* a sheet or tour is up */, wake: {supported,isOn,toggle},
undo(), render(), project() }`. `WorkMode.keyAction(e) → 'primary'|'forward'|'back'|'close'|null`
(the pedal map). Crochet and knitting run through the same engine (`js/app.js` 15c) with
`adopt: true` (the counter's stitch button is the surface) and `build(nodes)` / `paint(nodes)`
hooks that keep wave I's own HUD content.

Demo: `test/workmode.test.html` mounts a demo craft (a counter on a canvas) through the engine,
with no app.js: copy it.

---------------------------------------------------------------------------------------------------
## 2. Check sheet — `window.CheckSheet` (js/checksheet.js)

One shape, one sheet, one badge style for "what the pattern prints against what the app read".

```js
Check = {
  verdict: 'exact' | 'close' | 'off' | 'unchecked',
  summary: 'All 6 colours match the key exactly (5,721 stitches).',
  title?: 'Chart against the key',      // sheet title
  rows: [ { label: 'DMC 310', printed: 1839 | '36' | null, read: 1812 | '24' | null,
            verdict: 'exact' | 'computed' | 'close' | 'off' | 'unknown',
            why: 'plain sentence', page: 3 | null, hex?: '#112233' } ],
  note?: 'Counts printed in the key; read from the chart.'   // footnote
}
```
Badges: `exact` ✓ · `computed` / `close` ≈ (computed by the app, or within tolerance) · `off` ≠
(disagrees) · `unknown` / `unchecked` ? (nothing printed to check against). CSS
`.check-badge.check-exact|check-approx|check-off|check-unknown`.

- `CheckSheet.normalize(check) → Check` (never throws; junk → `{verdict:'unchecked', rows:[]}`).
- `CheckSheet.glyph(verdict) → '✓'|'≈'|'≠'|'?'`, `CheckSheet.badge(verdict, {label}) → <span>`.
- `CheckSheet.render(container, check, {onPage(page), maxRows}) → container` (summary + table).
- `CheckSheet.line(check, {onOpen}) → <div class="check-line">` (badge + summary + "See the check").
- `CheckSheet.open(check, {openSheet, title, onPage}) → sheet api` (or `ctx.check.open(check, opts)`,
  which passes the shell's `openSheet`).
- `CheckSheet.guard(check, confirmFn) → Promise<boolean>`: resolves `true` unless the verdict is
  `off`; then asks `confirmFn({title, message, confirmText})` ("Use it anyway?").
- `CheckSheet.demote(button, check)` → toggles `.primary` off and `.check-demoted` on when the
  verdict is `off` (BUILD.md: "off" demotes the primary button behind a confirm; it never blocks
  and never hides the disagreement). Returns `{ set(check), guard(confirmFn) }`.
- Adaptors: `CheckSheet.fromXStitch(xsCheck)` (wave J contract §3 → Check),
  `CheckSheet.fromCountReport(report, {word, name, lines})` (crochet / knitting
  `Store.countReport` → Check; a knitting row with no count is `unknown`).
- Shell: `ctx.check = { badge, line, open, guard, demote, fromCountReport, fromXStitch }`.

Crochet verdict rule (`fromCountReport`): every row printed → `exact`; computed rows and no
disagreement → `close`; a printed count its own arithmetic contradicts is a row `off`, and the
whole check is `off` only when at least a fifth of the counted rows disagree (a misread, not a
typo), else `close`; no counted rows → `unchecked`.

---------------------------------------------------------------------------------------------------
## 3. Share card — `window.ShareCard` (js/sharecard.js)

```js
info = { name, emoji, craft: { id, name, emoji }, status: 'finished'|'active'|…,
         startedAt?, finishedAt?, elapsedMs?, progress?: { text: '41% · 12 of 34 colours', pct: 0..1 },
         lines?: ['Body · Wings ×2'], picture?: HTMLCanvasElement|HTMLImageElement|ImageBitmap|null }
ShareCard.theme(rootStyleOrNull) → { bg, surface, text, muted, primary, primaryText, accent, font, display }
ShareCard.draw(canvas, info, { size: 1080, theme }) → canvas   // square card, on the device, no network
ShareCard.toBlob(canvas) → Promise<Blob>                      // image/png
ShareCard.fileName(info) → 'thready-or-not-<slug>.png'
ShareCard.share(blob, { title, text, filename }) → Promise<'shared'|'downloaded'|'cancelled'|'failed'>
                                                    // Web Share with files, else a download
```
Craft hook: `def.sharePicture(project, { size }) → canvas | Promise<canvas> | null` (chart thumbnail,
step ring, quilt blocks…). Crochet / knitting get a 3D snapshot from the shell. Shell: ⋯ →
🖼️ "Share a picture" on every project (and offered on finishing).

---------------------------------------------------------------------------------------------------
## 4. Templates for every craft — `def.template`

```js
def.template = {
  fromProject(project) → { craftData, checklist?, emoji? } | null,  // the seed, progress dropped
  fields?(body, draft, ctx) → { get() → craftData },             // template editor's own section
  describe?(tpl) → '12 colours · 14-count aida'                    // the card's sub line
}
```
- ⋯ → "Save as template" shows for every craft; a craft without `def.template.fromProject` saves
  name, emoji and checklist only (craftData null).
- Settings → "＋ New template" asks which craft first (when more than one is registered).
- Storage is the shell-data worker's (`Store.saveTemplate({…, craft, craftData})`, see
  `docs/wave-k/api/shell-data.md`); the shell feature-detects its craft hook.

---------------------------------------------------------------------------------------------------
## 5. Counted — one announcement, haptic and sound policy

```js
ctx.counted({ n, total?, unit: 'stitch', units?: 'stitches', label?: 'DMC 310',
              kind?: 'tap'|'group'|'row'|'done'|'undo'|'alert',
              groupSize?: 0, node?: HTMLElement, say?: 'Row 5 done' }) → { said: string|null, fb: string }
WorkMode.countPolicy(ev) → { say: string|null, fb: 'tap'|'group'|'row'|'done'|'undo'|'alert' }   // pure
```
Policy (the one in `js/app.js` §5): speak milestones only. `row` / `done` / `group` / `alert` speak
`ev.say` (or "<label> done"); a plain `tap` speaks only at `n === total` ("12 of 12 stitches") or,
when there is no grouping, every 50th (`n % 50 === 0`: "50 stitches"); `undo` speaks nothing unless
`say` is given. `node` gets `aria-valuenow` / `aria-valuemax` / `aria-valuetext` (give it
`role="progressbar"` or `role="meter"`; on a button the shell writes `aria-description` instead).
Haptics and sounds go through `Feedback[fb]` (respecting Settings).

---------------------------------------------------------------------------------------------------
## 6. Craft-aware copy, settings and help — registration fields

```js
def.copy = {
  dropLabel: 'Drop a chart PDF, an .oxs or a picture of a chart here, or choose a file',
  homeEmpty?:  'No charts yet…',            // home empty-state line when this is the only craft used
  allDone?:    'Nothing in the hoop right now…',
  importEmpty?: 'No steps found yet…',
  newProjectHint?: 'Start from a template or drop the PDF below.'
}
def.settingsFields(body, ctx)               // (wave H) one Settings section per craft, now shown for every craft
def.faq, def.tourId                         // (wave H) any craft; its tour is offered once after its first project
```
- New project's craft drop zone uses `def.copy.dropLabel` (falls back to the extension list).
- Settings → **Profile** (measurements, units, stashes) renders from the shell-data API when present
  (`Store.profile()` / `Store.setProfile(patch)`, per their doc); hidden otherwise.
- Backup import preview: a **Settings** row ("Theme, per-craft settings and your profile") with a
  tick, when the shell-data API reports a settings block (`preview.settings`).

---------------------------------------------------------------------------------------------------
## 7. Page viewer — `window.PageViewer` (js/pageviewer.js)

One pinch / zoom / pan / region-outline viewer for page images (cross-stitch, sewing and knitting
chart viewers migrate to it in batch 2).

```js
PageViewer.mount(frame, {
  pages: [ { label: 'Page 3', blobKey?: 'p:<id>:chartpage:3', src?: url, blob?: Blob,
             canvas?: HTMLCanvasElement, w?, h? } ],
  index: 0,
  outline?(i, size /* {w,h} image px */) → { x, y, w, h } (image px) | { fx, fy, fw, fh } (0..1) | null,
  focusZoom?: 24,               // with an outline: about this many outlines across the frame
  maxZoom: 12,                  // × fit
  onPage?(i), onEmpty?(i) → 'message', label?: 'Chart page'
}) → { show(i), index(), fit(), zoom(factor, x?, y?), lookAt(ix, iy, scale), state() → {s, tx, ty, fitS, iw, ih},
       destroy() }
PageViewer.open({ openSheet, title, pages, index, outline, bar: true, extra(body, viewer) }) → sheet api
```
Gestures: one finger drags, two pinch, wheel zooms at the pointer, double-tap toggles Fit / 3×;
keyboard on the focused frame: + / − zoom, arrows pan 40 px, Home fits, PageUp / PageDown page.
`frame` gets `role="img"` and an aria-label naming the page. Object URLs are revoked on page change
and `destroy()`. Shell: `ctx.pageViewer` (= `PageViewer.open` with the shell's `openSheet`).

---------------------------------------------------------------------------------------------------
## 8. Script order (index.html) and precache (sw.js) — as wired now

Stylesheets: `app.css, themes.css, xstitch.css, xstitch-extras.css, sewing.css, sewing-extras.css,
knitting.css`. Scripts:
```
… pdftext.js, knit-chart.js, …, store.js, tour.js,
blobstore.js, zip.js,
workmode.js, checksheet.js, sharecard.js, pageviewer.js,      // shell-ui (before app.js)
xstitch.js, xstitch-photo.js, xstitch-read.js,
xstitch-render.js, xstitch-keyread.js,                         // after xstitch.js
sewing.js, sew-figures.js, sew-quilt.js,                       // after pdftext.js + blobstore.js
app.js, app-knitting.js,
app-xstitch.js, app-xstitch-extras.js, app-sewing.js, app-sewing-extras.js
```
Every one is in `PRECACHE_URLS`; `test/sw.test.html` checks each file, the orders above, that every
local stylesheet is precached, and that nothing under `js/vendor/tesseract/` is. `js/ocr.js` (the
small loader) is wired when it exists; the engine under `js/vendor/tesseract/` never is.
`CACHE_VERSION` is generated by `tools/sw-version.sh`.

Note on §5: `ctx.counted` speaks, buzzes and labels; it does not record work. A craft records it
with `Store.counted({projectId, n: unitsMoved, unit, part})` (shell-data §5) after its own write.

---------------------------------------------------------------------------------------------------
## 9. The opt-in text reader — `ctx.ocr` (also `App.ocr`)

The engine is `window.Ocr` (`docs/wave-k/api/ocr.md`); `js/ocr.js` (the 30 KB loader) is in
`index.html` and precached, the engine under `js/vendor/tesseract/` never is: it downloads only when
the maker asks, into `thready-ocr-*` Cache Storage buckets that `sw.js` `activate` always keeps.
**Nothing read from a picture is trusted silently**: label it and make it checkable.

```js
ctx.ocr.available() → boolean                 // this browser can run it (and js/ocr.js loaded)
ctx.ocr.sizeLabel() → 'about 5 MB'
ctx.ocr.offerButton({ text?, reason?, cls?, onReady(Ocr) }) → <button>
     // "Try reading this scanned page (downloads about 5 MB once)"; the note drops once installed.
     // A tap asks first (size, offline, nothing sent), downloads with progress + Cancel, then calls
     // onReady(window.Ocr): the craft renders the page (200 dpi) and calls Ocr.recognize itself.
     // Hidden when the browser cannot run the reader.
ctx.ocr.ensure({ reason? }) → Promise<boolean>   // the same ask-and-download, without a button
ctx.ocr.mark(node, { conf?, label? }) → node     // adds a "? Read from a picture — check it" flag
                                                 // and .ocr-read (dashed outline); idempotent
ctx.ocr.check(result | lines, { page?, title?, lowConf = 60 }) → Check
     // every line a "?" row (never ✓), conf as "Read", lines under lowConf called unsure;
     // verdict 'unchecked', summary "Read from a picture — check every row." → ctx.check.open / line
ctx.ocr.LABEL = 'Read from a picture — check it'
```
Settings → **Read scanned pages**: "Not installed." + Download (about 5 MB once, progress, Cancel), or
"Installed · 4.9 MB on this device." + Remove (confirm; `Ocr.remove()`). A craft that reads a page
should call `Ocr.terminate()` after a batch and force its own confidence banner to "check every row".

---------------------------------------------------------------------------------------------------
## 10. Knitting: the whole piece in the viewer (K1) and the 3D still

- The ⤢ viewer of a **knitting** project with two or more parts shows **This part / Whole piece**
  (`[data-viewer-whole]`) when `DiagramGeo.assemble` exists. Whole piece passes
  `DiagramGeo.assemble(parts).model` straight to `setModel`; the shape line says "The whole sock",
  "The whole pullover" or "All the pieces · <reason>". The per-part chips (Worked in, Way up) fold
  away while it shows. The stitch button and working mode stay on the part being counted.
  Rebuilt only when a part's row, piece, work mode or way up moved (never on a stitch tap), once,
  off the tap path.
- Remembered per project as a device setting, no undo:
  `settings.crafts.knitting.viewWhole = { <projectId>: true }` (gone projects are pruned on write).
- `ShareCard.snapshot(handle, { size, crop = true, pad = 0.06, background = null })` → canvas | null:
  `handle.snapshot` (knit-3d) with any pending bake finished first; null for an older renderer, the
  2D fallback or nothing drawn. The share card uses it (works on a hidden page) and falls back to the
  frame copy, then to the emoji. A knitter on Whole piece shares the whole piece.
- QA only: `App.__viewerQa { wholeAvailable, wholeOn, setWhole, assembled, caption, open }`.

---------------------------------------------------------------------------------------------------
## 11. Knitting glue for knit-ui (wave K)

- **`def.counterPaint(p, prt, nodes)`** (knitting's registration) is called at the end of
  `updateKnitWidgets` on every counter paint: `nodes = { extra, patternLine, patternTag, patternText,
  patternNotes, rowLabel, finished, hook: true }`. A throw leaves the counter as it was.
- **`ctx.fillSizeMarked(node, text, part, project)`**: pattern text with the chosen size's number in
  `<mark class="size-mark">` (text and mark nodes only).
- **`openKnitChartSheet`** hands over to `AppKnitting.openChartSheet(projectId, partId)` when present.
- **P13, a tap counts a repeat**: on a knitting row of ≥ 40 stitches whose stitches split into the
  row's real repeat groups (`Store.rowGroups`, adding up to the target) — else into marker segments
  on a row the markers were set for (`markerTotal === target`) — a tap counts to the end of the unit
  it is in. A long press (550 ms) counts one stitch. Not on short rows, unread rows, finished parts,
  or any crochet project. "Tap = 1 repeat (5 sts) · hold = 1 st" under the readout (#knit-tap-unit),
  the same as `aria-description` on the stitch button, and "· tap = 5 sts" in working mode.
  Per project: ⋯ → "Long rows: a tap counts a repeat / a stitch";
  `settings.crafts.knitting.tapUnit = { <projectId>: 'stitch' }` (absent = repeats), no undo step.
  A repeat tap uses `Store.tapStitches(projectId, partId, n)` (one undo step) when the Store has it,
  else n single taps that stop at a row's end (one announcement and buzz, n undo steps).
- **P8 at import**: a knitting section the reader marked `makeCountWhy: 'pair'` (×2) shows
  "Knit both at once" (`[data-both-at-once]`, aria-pressed) in the import list; ticked, the part is
  split with `Store.splitTwoAtATime` right after the import (Import pattern and New project), and the
  toast says "a pair knit both at once". The list says "×2 (a pair of sleeves)".
- QA only: `App.__knitTapQa { units, step, unit, setUnit, tap, bothAtOnce }`.

---------------------------------------------------------------------------------------------------
## 12. Pattern books in the import picker (E12)

A knitting book (groups that are patterns): every pattern of `Knits.bookPatterns(text)` is a tab
(`.size-tab`, "· not read" for an unread one); the open tab is the ONE pattern imported
(`[data-book-pick="<name>"]` status line, no tick). Its sizes and gauge come from its
`bookPatterns` record, its checklist from its own pages, its charts only from its own pages.
Picker API additions: `bookPick()`, `bookPages()` → `{from, to}`, `pickBookPattern(name)`;
`knitAttachCharts(projectId, pages)`; QA `App.__knitTapQa.pageInside(page, pages)`.
