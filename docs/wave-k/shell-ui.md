# Wave K — shell-ui report

Owner of `js/app.js`, `css/app.css`, `css/themes.css` (unchanged), `index.html`, `sw.js`
(PRECACHE_URLS only), `js/tour.js` (unchanged), `test/crafts.test.html`, `test/sw.test.html`, and
the new `js/workmode.js`, `js/checksheet.js`, `js/sharecard.js`, `js/pageviewer.js` with a test page
each. The contract as built is `docs/wave-k/api/shell-ui.md` (kept current).

## What the user sees
- **Working mode for any craft.** A craft that registers `workMode` gets crochet's wave I screen:
  full screen in portrait and landscape, big numbers, the big line, hints, the next step, big corner
  buttons, Options ▾ with ☀ Keep awake, ✕ / Escape, remembered per project across reloads, and the
  keys Space / Enter, arrows **and a page-turner pedal (PageDown / PageUp)**. ⋯ gets the entry too.
  Crochet and knitting run through the same engine with no visible change (same ids, classes,
  labels, order; crochet gains PageDown / PageUp as row + / row −).
- **One check sheet and badge** (✓ exact, ≈ computed / close, ≠ disagrees, ? unknown). Crochet's
  import list now shows the badge and "See the check" per section (a table of every round: printed
  against read, disagreements first, with the reason); the counter's "≈ why" sheet links to "See
  every round checked". When the ticked sections' check is **off**, "Create parts" (⋯ → Import) is
  demoted to a secondary look with a spoken reason, and it, or New project's Save with a PDF, asks
  "Use it anyway?" once. It never blocks.
- **⋯ → 🖼️ Share a picture** on every project: a 1080 px card in the current theme (name, craft,
  status, dates, hours from the timer, progress bar, parts) with the craft's picture; crochet and
  knitting get a still of the 3D piece, cropped to the piece. Share sheet where files can be shared,
  else "Save picture" downloads the PNG. No network.
- **Templates for every craft.** ⋯ → Save as template for cross-stitch / sewing / any screen craft
  (the craft's seed through `def.template.fromProject`, Parts field hidden, the card says what the
  seed holds); "＋ New template" asks which craft first.
- **Craft-aware words.** Home empty state names all four crafts; "Nothing on the hook" only when
  the shelf is all crochet ("on the needles" for knitting, neutral otherwise); the import list's
  empty example is knitting's for knitting; the New project drop zone takes `def.copy.dropLabel`
  (so cross-stitch can say "or a picture of a chart"). A craft's tour is offered once after its
  first project.
- **Settings → Your profile** (unit, bust / waist / hip / height and any stored measurement, stash
  counts) from shell-data's `Store.profile`; per-craft sections were already a hook.
- **Backup import preview** has a ticked "Settings" row (theme, feedback, each craft's settings,
  profile) using shell-data's `preview.settings` / `importJSON({settings})`.
- **Heavy craft data**: a screen-craft project whose data is still in IndexedDB shows "Opening …"
  until `Store.whenReady`, or an honest "Part of this project is missing" card (Open what is left /
  Back), per shell-data §4.
- **Page viewer component** (`window.PageViewer`, `ctx.pageViewer`), not yet used by any craft.

## Contract as built (summary; the API doc has the shapes)
`WorkMode.create(host, spec, env)`, `WorkMode.keyAction`, `WorkMode.countPolicy`;
`ctx.workMode {open, close, isOn, refresh, button}`; `ctx.counted(ev)`; `ctx.check {badge, line,
render, open, guard, demote, fromCountReport, fromXStitch}`; `ctx.pageViewer(opts)`;
`ctx.sharePicture(id)`; registration fields `workMode`, `template {fromProject, fields, describe}`
(forwarded to `Store.setCraftHooks`), `settings`, `copy {dropLabel, allDone, importEmpty, …}`,
`sharePicture(project, {size})`, `shareProgress(project)`. App exports `workMode`, `counted`,
`openCheckSheet`, `openPageViewer`, `openShareCard`.

Crochet's verdict rule (`fromCountReport`): all printed → exact; computed / missing with no
disagreement → close; disagreeing rows ≥ 1/5 of counted rows → off; otherwise close; nothing
counted → unchecked (knitting "count unknown" rows show as ?).

## Tests (counts)
| suite | baseline | now |
|---|---|---|
| test/crafts.test.html | 159 | **212 / 0** (group 12: the real app in a 375×812 frame — a demo craft's working mode, keys, Undo, remembered, ctx.counted, Save as template, craft picker, drop label, profile, check sheet, share card, crochet working mode through the engine) |
| test/sw.test.html | 29 | **48 / 0** (every new file loaded + precached, load orders, every stylesheet precached, nothing under js/vendor/tesseract) |
| test/workmode.test.html | new | 101 / 0 (+ the demo craft to copy) |
| test/checksheet.test.html | new | 58 / 0 |
| test/sharecard.test.html | new | 24 / 0 (pixel probes of picture, bar, background) |
| test/pageviewer.test.html | new | 37 / 0 |
| test/templates.test.html | 147 | 159 / 0 (shell-data's additions) |
| test/store-safety.test.html | 324 | 472 / 0 (shell-data's additions; run in a tab — headless prints no summary) |
| test/backup.test.html | 205 | 205 / 0 (tab) |
| test/knit-counter.test.html | 317 | 317 / 0 |
| test/patterns.test.html | 1112 | 1112 / 0 |
| test/knits.test.html | 385 | 385 / 0 |
| test/diagram.test.html | 260 | 260 / 0 |
| test/diagram-model.test.html | 529 | 527–528 / 1–2: only the 60 ms build-time checks (60.7, 65.8, 102 ms) while other workers loaded the machine; the page loads none of my files (HANDOFF names this timing check as load-sensitive) |

## Verified in the pane
- 375 × 812 (stardew-night): crochet Work in 3D opens, wave I layout unchanged, Space / PageDown /
  ArrowUp / PageUp / Escape, Options panel (one Keep awake), scrim fold, focus back to Work in 3D,
  remembered over a reload. Import sheet: badge + "See the check", table, demoted Create parts, the
  confirm and the parts made after "Create parts anyway". Share card with the 3D still.
- 375 × 640, Pixel Wyrm: the demo craft's working mode, 0 elements outside the viewport.
- 812 × 375: landscape left column (stack right edge 374 px = 46 %).
- Not done: a desktop-width pass of the share and check sheets in all three themes, a screen
  reader walk on real hardware, touch hardware.

## Left, and why
- No craft has adopted `workMode`, `def.template`, `def.copy`, `sharePicture` or PageViewer yet:
  batch 2 (xs-app, sew-app). Crochet's PDF pages are not kept, so not viewable (not cheap: crochet
  stores no page images).
- `ctx.counted` does not replace crochet's own tap announcements (already the same policy); crafts
  move to it in batch 2. It does not record work: crafts call `Store.counted` (shell-data §5).
- `js/ocr.js` does not exist yet; it is not wired. `docs/wave-k/api/ocr.md` not yet published, so no
  opt-in cache support was added to sw.js.
- `CACHE_VERSION`: `tools/sw-version.sh` was run, but other workers keep changing precached files,
  so `--check` drifts; run it (or the commit hook) at commit time.
- I closed a pane tab `tab-6` at the end that I believed was my own from the first session; after
  the server restart it belonged to another worker (`test/xstitch-render.test.html?v=2`). Sorry —
  it only needs reopening.

## For the owner of
- **js/app-xstitch.js / js/app-sewing.js (batch 2)**: adopt `workMode` (copy the demo spec in
  `test/workmode.test.html`), `template.fromProject` / `describe`, `copy.dropLabel`, `sharePicture`,
  `ctx.counted` (cross-stitch: drop the every-100th cadence), `ctx.check.open` with
  `CheckSheet.fromXStitch(check)` and `ctx.check.demote` on "Use it", and `ctx.pageViewer`.
- **js/diagram.js**: a `handle.snapshot()` would make the share still exact; today the shell mounts
  a short-lived second context and copies it in the frame it draws (null in a hidden pane → emoji).
- **SPEC.md / CRAFTS.md (docs agent)**: the new registration fields and ctx keys above.

## Decisions for the coordinator
- Crochet "off" = ≥ 1/5 of counted rows disagree (one printed typo stays "close"). Change
  `CheckSheet.OFF_SHARE` if you want it stricter.
- The pedal map: PageDown / ArrowRight = forward (crochet: complete row; a craft without `forward`:
  its primary), PageUp = back.

## Shell-data follow-ups (coordinator's message)
1. `Store.hydrateAll()` runs before a backup is built (the `.json` fallback included) — done.
2. `Store.whenReady(id)` before a screen craft's `renderProject` ("Opening …" / missing card) —
   done; counter crafts do not opt into heavy data, so their path is unchanged.
3. `def.template` (and `def.settings`) forwarded with `Store.setCraftHooks` at registration — done.
4. `ctx.counted` never subscribes to `Store.onCount`, so `origin: 'counter'` events are never
   announced a second time; a craft announces through `ctx.counted` and records through
   `Store.counted`.
5. `preview.settings` shown in the backup import sheet as a ticked "Settings" row (`merge`;
   unticked → `skip`) — done.

## Opt-in text reader (OCR), after the spike (coordinator's decision: opt-in only)
- `sw.js`: `activate` keeps every cache named `thready-ocr-*` in production **and** on localhost
  (pure `swShouldDelete(name, dev)`, exported for the test); `PRECACHE_URLS` holds nothing under
  `js/vendor/tesseract/`, and the policy never stores an engine file in the shell cache.
- `js/ocr.js` (loader only) is in `index.html` (before `app.js`) and `PRECACHE_URLS`.
- Settings → **Read scanned pages**: Not installed / Installed · size, Download (about 5 MB once)
  with a progress bar ("Getting the text reader… 2.1 of 4.9 MB"), Cancel, Remove with a confirm.
- `ctx.ocr` / `App.ocr` (API §9): `offerButton` ("Try reading this scanned page (downloads about
  5 MB once)"), `ensure`, `mark` ("Read from a picture — check it"), `check` (every OCR line a "?"
  row, never ✓). Not wired into any craft file (not mine): the craft apps call it.
- Tests: sw 48 → **59** (keep `thready-ocr-v1/v2` in prod and dev, delete old shell caches, a
  prefix-only match, no engine file stored or precached, js/ocr.js wired); crafts 212 → **224**
  (the offer's wording, mark, check, the Settings row's state). Nothing was downloaded by a test.
- Not seen yet: the download sheet and the Settings row on a phone, and a real install / remove
  through the UI (the ocr worker's own suite covers install and remove).

## Knitting K1 glue and the 3D still (knit-3d's requests)
- ⤢ viewer, knitting with 2+ parts: **This part / Whole piece** switch; Whole piece shows
  `DiagramGeo.assemble(parts).model` with a plain caption ("The whole pullover · the pieces sewn
  together", "The whole sock", "All the pieces · <reason>"); per-part chips fold away; remembered per
  project in `settings.crafts.knitting.viewWhole` (no undo). Crochet viewers unchanged (asserted).
  Rebuilt on a row change and also on a stitch tap while the viewer shows the whole piece (the
  in-place `done` update the knit-3d doc suggests is not used: simpler, and only the opened viewer pays).
- Share card: `ShareCard.snapshot(handle)` uses `handle.snapshot` first (seen in the pane: the
  pullover still on the card), the old frame copy stays the fallback. Whole piece is what is shared
  when it is on.
- Checked at 375 × 812 (stardew-night): switch, caption, piece, share card; no horizontal overflow.
- Tests: crafts 224 → **239** (offered only for knitting 2+ parts, assemble kind, captions incl. the
  board's reason, reuse without rebuild, remembered with no undo, per project, the switch in the
  viewer on the remembered choice, the shape line, none in a crochet viewer); sharecard 24 → **31**
  (snapshot first with a bake finished, options, null fallbacks, a throw contained).
- Not done: the switch inside working mode's Options (Options → 🔍 Whole piece opens the viewer,
  where the switch is).

### Whole piece: a tap no longer rebuilds (coordinator's follow-up)
- The assembled piece depends on rows, pieces, the active part and the per-part chips, never on the
  stitch (`wholeKey`). With Whole piece showing, a stitch tap does no geometry work at all: no
  `assemble`, no `setModel`, no single-part `diagramModel` either (the button's canvas is closed while
  the viewer is open). A row change (or a part switch / chip) rebuilds **once, off the tap path** (a
  0 ms timeout after the tap returns), and only if the viewer still shows the whole piece. The caption
  never builds on the tap path; it reads the last piece built.
- The in-place `rounds[current].done` update the knit-3d doc mentions is not used: the renderer's
  `setModel` always rebuilds, so updating in place and pushing would cost the same as a rebuild.
  So the whole-piece view moves its progress per row, not per stitch. **For the owner of
  js/diagram.js**: a cheap `handle.setDone(round, done)` (no rebuild) would let a tap move the glow.
- **Measured** in the pane (375 × 812, the Sweater template assembled as a pullover, 131,976
  vertices; median of 7 / 20 taps): tap cost **before 76.4 ms** (assemble + setModel on every tap;
  first one 292.6 ms) → **after 0.10 ms** (max 0.8 ms). The row-change rebuild still costs the
  ~76 ms, once, after the tap.
- Asserted (crafts.test, 239 → **243**): five taps with Whole piece showing call `assemble` 0 times
  and `setModel` 0 times; a row change calls neither during the tap, then each exactly once just
  after; an idle push calls neither again.
- The switch lives only in the viewer (agreed).

### Working mode: `surfaceUnderHud` (asked by xs-app, for stitch mode)
- Opt-in spec option: the craft's surface fills the whole screen (375 × 812 → 100 % drawable,
  against the free area the HUD leaves, which is what the chart used before) and the header, readout
  stack and next line float over it on scrims (`--primary` at 82 %, 3 px blur; `.work-under-hud`
  on the host). `api.insets()` / the surface's `insets(ins)` still report the free rectangle, so the
  craft keeps the current stitch out from under the HUD; `api.underHud()` says the option is on.
  Default specs and adopted surfaces (crochet, knitting) never get it.
- Seen at 375 × 812 (stardew-night) on the demo craft: chart under the HUD, the readouts legible
  on the scrim.
- workmode.test 101 → **111** (the class only when asked, a full-screen surface, a scrim behind the
  stack, insets still reported and handed to the surface, the class removed on close, ignored with
  `adopt`).

## Knit-ui's js/app.js asks (P2 hook, chart sheet, P13, P8)
1. `def.counterPaint` called at the end of `updateKnitWidgets` (knit-ui's temporary watcher can go).
2. `ctx.fillSizeMarked` added.
3. `openKnitChartSheet` → `AppKnitting.openChartSheet` when present.
4. **P13**: on long knitting rows a tap counts a repeat or a marker segment; long press = 1 stitch;
   per-project switch in ⋯; hint under the readout and in working mode; crochet never. Seen at
   375 × 812 and 375 × 640 on "*K2, p3; rep from * to end. (60 sts)": "Group 2 of 12 · stitch 5 of 5",
   "Tap = 1 repeat (5 sts) · hold = 1 st", 0 px overflow at both sizes. Row 1 of a pattern with no
   count before it gets no groups (the reader has no previous count), so it counts stitches — honest.
   **For the owner of js/store.js**: `Store.tapStitches(projectId, partId, n)` (one snapshot, n
   stitches, the same events as `tapStitch` for the last one, auto-advance at the target) would make a
   repeat tap one Undo; until then the fallback is n single taps (n undo steps, one announcement).
5. **P8**: "Knit both at once" on a pair section in the import list, applied with
   `Store.splitTwoAtATime` after Import / New project.
- Tests: crafts 243 → **262** (units from real repeat groups, the marker-segment fallback, a tap =
  a unit, a long press = 1, mid-unit, the hint and aria-description, the per-project switch,
  crochet never, the pair split once and only once); knit-counter 378 / 0, patterns 1112 / 0,
  workmode 111 / 0, templates 159 / 0, sw 59 / 0. Every crochet group unchanged.

## E12: the wrong pattern imported from a pattern book (knit-parse's pin)
- In a knitting **book** (groups that are patterns, not sizes) the import is now **single choice and
  follows the open tab**: opening a pattern's tab makes it the one imported ("Importing “Icelandic
  Lace Shawl” only — pick another pattern above to import that one instead.", `[data-book-pick]`);
  there is no separate "Import this pattern" tick any more, so the first pattern can never stay
  ticked beside the one chosen. Crochet size groups and knitting size groups (Sandnes) unchanged.
- Every pattern of the contents is listed from `Knits.bookPatterns(text)`, "unread" ones as
  "· not read" with "The app could not read the rows of …; importing it gives one part with its
  text, to count by hand."
- The picked pattern's own sizes (`bookPatterns()[i].sizes`) and gauge / needle line feed the size
  chips and the gauge chip; the checklist suggestions come from its own pages only; charts are kept
  only when their page is inside its pages (`knitAttachCharts(id, pages)`), on top of the
  "named in its text" rule.
- **By hand (pane, one tab)**: the lace book lists all 10 patterns (Arrowhead Shawl "· not read");
  Icelandic Lace Shawl picked → parts Shawl, Part 2, Lace Border and charts **A–F only** (all p15).
  The socks book lists all 8; Time Traveler shows 7" / 8½" / 9½"; Stranded Boot Stockings picked →
  no size chips (the research file: single size) and its own gauge "26 sts × 28 rows = 4 in ·
  3.75 mm" — Time Traveler's sizes no longer show for it.
- Tests: crafts 262 → **273** (a synthetic two-pattern book: both listed, the first with rows
  picked, no tick, the hat's size chips; the cowl's tab → the cowl picked, its own chips, exactly one
  marked, no hat checklist line; Create parts imports the cowl only, at the cowl's size; the chart
  page rule).
- **For the owner of test/knit-counter.test.html** (knit-store): the wave H group "a pattern book
  in the New project sheet" (~lines 1672-1686) pins the OLD behaviour ("Sock Two · skipped", the
  "Import this pattern" tick) and now throws at the missing tick, which skips the rest of that
  page's app group: 374 / 3 failed. Replace those lines with:
```js
        eq(names, ['Sock One', 'Sock Two'], 'every pattern of the book is listed');
        var pk = dl.querySelector('[data-book-pick]');
        eq(pk && pk.getAttribute('data-book-pick'), 'Sock One', 'the first pattern is the one to import');
        var chips = Array.prototype.map.call(dl.querySelectorAll('.size-chip'), function (b) { return b.textContent; });
        eq(chips, ['S', 'M', 'L'], 'the size chips are the picked pattern\'s own (S, M, L)');
        // pick Sock Two: its tab is the pattern imported (single choice)
        tabs.querySelectorAll('.size-tab')[1].click();
        return sleep(200).then(function () {
          var chips2 = Array.prototype.map.call(dl.querySelectorAll('.size-chip'), function (b) { return b.textContent; });
          eq(chips2, ['5"', '6"', '7"', '8"', '9"', '10"'], 'picking Sock Two makes its six sizes the chips');
          var pk2 = dl.querySelector('[data-book-pick]');
          eq(pk2 && pk2.getAttribute('data-book-pick'), 'Sock Two', '... and Sock Two is the only pattern imported');
        });
```

## Knitting follow-ups: materials, the book checklist, and the page-image sweep
1. **Materials kept at import (knit-ui P20).** After every knitting import (Import pattern → Create
   parts / Put it all in, and New project with a PDF) `knitKeepMaterials` stores
   `Knits.materials(fullText)` — or, in a book, the picked pattern's `bookPatterns()[i].materials` —
   as `craftData.materials` through `Store.updateCraftData(…, {undo: false})`, only when it read a
   yarn or a needle. Never for crochet.
2. **Checklist from the picked pattern only (knit-store's note).** In a book the suggestions read the
   picked pattern's own pages; when the text has no page markers (pasted text), its own sections'
   text — never the whole book.
3. **The boot-time page-image sweep** (IndexedDB is shared by every store key on the origin): it now
   never runs when the store key changed after boot (`Store.__setKeyForTests`), and it always keeps
   the projects named by every OTHER `stitchkeeper*` key in localStorage (an unreadable one keeps
   every `p:<id>:` its text names). So a test page or an agent's private profile can never delete a
   real user's page images, and the user's own sweep never deletes a test profile's.
- Tests: crafts 273 → **281** (materials kept for a book's picked pattern and a single pattern, never
  for crochet; the sweep sees and keeps another store's project, is skipped after a key switch, and a
  "real" page image put under another key is still there afterwards). knit-counter **388 / 0** (its
  book group was re-pointed by knit-store), patterns 1112 / 0, templates 159 / 0, workmode 111 / 0,
  sw 59 / 0, sharecard 31 / 0, checksheet 58 / 0, pageviewer 37 / 0.
- `test/knits.test.html` is **460 / 2** at this moment: two "Shape Shoulder(s)" assertions about
  `js/knits.js` sections. That page loads no file of mine (no app.js); it is the knit-parse side,
  presumably mid-edit — not touched.

### Whole piece: progress per stitch again with `handle.setDone`, and a board that fits the frame
- When the renderer has `handle.setDone` (knit-3d), the whole-piece key is the **structure** only
  (who is working / done / started, make counts, the chips, the frame's shape). A stitch tap calls
  `setDone(partId, round, stitch)`; a row change finds the working part's round index from its own
  model (once per row) and calls `setDone` too. Neither rebuilds. A rebuild (once, after the tap)
  only when the structure changes — the working part's first stitch (not started → started), a part
  finished, a part switch, a chip — or when `setDone` answers `ok: false`. Without `setDone`: the
  earlier behaviour (rebuild once after a row change, nothing on a stitch).
- `DiagramGeo.assemble(parts, { aspect })` gets the viewer canvas's width / height; the frame's shape
  (rounded to 0.1) is part of the key, and a window resize (debounced 200 ms) re-assembles once when
  it changed. The share card builds a fresh assembled piece (today's progress), not the viewer's cache.
- **Measured** (pane, 375 × 812, the Sweater template as a pullover; 20 taps / 5 rows): stitch tap
  **0.20 ms** median (max 0.9) — it now moves the progress (was 0.10 ms doing nothing, and 76.4 ms
  before the first fix); row change **15.5 ms** median on the tap path (the single part's model for
  its round index), was a ~76 ms deferred rebuild. `getStats().rebuilds` = 2 (open + first stitch).
- Tests: crafts 281 → **283** (the first stitch rebuilds once; five taps = five `setDone`, no
  `assemble`, no `setModel`; a row change = `setDone`, no rebuild; idle push nothing; a new frame
  shape re-assembles once over two resize events, the same shape again nothing); sharecard 31 / 0.

## Wording fixes from the cross-stitch audit (last change before integration)
1. **Singular / plural in js/checksheet.js**: "1 colour on the chart **matches** no key row" (many:
   "match"); every count-dependent sentence checked and asserted ("1 key colour found no stitches",
   "1 line disagrees / 2 lines disagree", "1 round … 1 count disagrees / 2 counts disagree").
2. **"This PDF is a scan"** was wrong for born-digital PDFs whose pages are pictures. The shell's PDF
   drop zone (crochet / knitting, and any craft without its own onError) now says "These pages are
   pictures, so there is no text to read." plus, where the browser can run it, "The text reader
   (Settings → Read scanned pages) can try them; check what it reads." The extractor's own error
   ("…may be scanned images") is mapped to these words; other errors keep theirs.
   `ctx.ocr.noText()` / `ctx.ocr.failText(err)` give crafts the same words.
   - **For the owner of js/app-xstitch.js** (xs-audit): line ~5796 still says "This PDF is a scan,
     so there is no text to read." Replace its first sentence with
     `(C.ocr && C.ocr.noText ? C.ocr.noText() : 'These pages are pictures, so there is no text to read.') + ' The chart pages are here; …'`
     (or just the plain sentence). **For the owner of js/app-sewing.js**: line ~3967 "That looks
     like scanned images" and ~3900 "(it may be scanned images)" the same way.
     **For the owner of js/pdftext.js / js/sewing.js**: their "may be scanned images" strings
     (pdftext 2845 / 2999, sewing 3235) read better as "the pages are pictures"; the shell already
     maps the pdftext error.
- Tests: checksheet 58 → **64**, crafts 283 → **288**; sharecard 31, workmode 111, sw 59, all 0 failed.

## Release-blocking knitting round (knit-audit, knit-charts)
1. **One-size book pattern took the book's first sizes** ("ROUND · 7"" on Stranded Boot). The
   import now hands `Store.importPatternSections` the picked pattern's own text (its pages, else
   its sections: `picker.importText()`), so the store's document-wide size / gauge / abbreviation
   reading never sees another pattern. By hand: socks book → Stranded Boot Stockings → parts Cuff,
   Leg, Heel, Turn Heel, Gusset, Foot; `sizes: null`, `size: null`; label "Stranded Boot Stockings ·
   Cuff · ROUND".
2. **Sandnes raglan imported Children AND Ladies.** Not a regression in the tick code (it was
   "every size group on" before this wave too); the fix is the audit's rule: a knitting pattern's
   size groups are single choice like a book's patterns — the open tab is the group imported, with
   its own sizes ("Importing “Children” only — pick the other sizes above …"). Crochet size groups
   (the bee) unchanged. By hand: default Children → Yoke, Back And Front, Sleeves [Children], chips
   2–12 yrs, label "Children · Yoke · ROUND · 2 yrs"; Ladies picked → the same three [Ladies], chips
   S–XXL, "Ladies · Yoke · ROUND · S". No duplicates.
3. **Round words (E13).** `partMode` / `rowModeAt` honour `Part.rowWord: 'rnd'` (knit-parse) when
   the knitter left Worked in on Auto (a `workedIn: 'rows'` line inside still says Row); the until
   chip and its sentence say rounds ("↕ 5 rounds", "📏 2 in ≈ 9 rounds"). The "RS?" chip and the
   store's "Before group 1 · stitch 0 of 1" readout are the store's (not changed here).
4. **Picture charts.** `KC.scan(handle, { signal, pictures: true })`; `KNIT_CHART_KEYS` gains kind,
   confidence, reasons, calib, colour, imageBox, rowNosRead. The scan starts 50 ms after the import
   returns (never on its path), passes its signal to every page render, and a newer import cancels
   the one in flight. A text-only import starts nothing.
5. **Project name** (New project with a knitting PDF, empty name): `Knits.title(text)` when the
   parser is sure, else the file name tidied ("knit-patons-boyfriend-cable" → "Patons Boyfriend
   Cable").
- Tests: crafts 288 → **309** (one-size book pattern: no chips, no sizes, no size label on the
  counter; size groups single choice (skips cleanly when the synthetic text gives no groups — checked
  on the Sandnes raglan by hand); round words for a `rowWord: 'rnd'` part and Row for crochet; the
  chart keys; a text-only import starts no scan in < 5 ms; a PDF import returns in < 5 ms, the scan
  starts after it with `pictures: true` and a live signal, a newer import cancels it; the names).
- Suites (`tools/headless-suite.sh`, real time): crafts **309 / 0**, knit-counter **402 / 0**, knit-ui
  **130 / 0**, knit-chart **162 / 0**, patterns 1112 / 0, templates 159 / 0, workmode 111 / 0,
  sw 59 / 0, checksheet 64 / 0, sharecard 31 / 0.
