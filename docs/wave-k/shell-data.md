# Wave K: shell-data report (js/store.js, js/blobstore.js, js/zip.js)

The contract is `docs/wave-k/api/shell-data.md`. This file is what was built, what it measured,
what it does not make safe, and how the craft workers adopt it.

## Suites

| page | baseline (before my first edit) | now |
|---|---|---|
| test/store-safety.test.html | 324 | **472** |
| test/backup.test.html | 205 | **229** (the pinned "import ignores settings" gap un-pinned on purpose) |
| test/templates.test.html | 147 | **159** |
| test/blobstore.test.html | 65 | **78** |
| test/crafts.test.html | 159 | 212 (shell-ui's additions; green) |
| test/knit-counter.test.html | 317 | 317 |
| test/diagram-model.test.html | 529 | 529 |
| test/sw.test.html | 29 | 41 (shell-ui's additions; green) |
| xstitch.test 969, sewing.test 963, patterns.test 1112, knits.test 385 | same | same |

Headless note: `tools/headless-suite.sh` prints "no summary" for store-safety, backup, blobstore and
diagram-model. Not red: the first three wait on IndexedDB, which does not progress under
`--virtual-time-budget`; all four are green in a real tab (run in one tab through iframes, closed
afterwards). crafts, knit-counter, sw, xstitch, sewing, patterns and knits ran headless green.
The app boots in a frame with no errors.

## What was built (by task item)

1. **Templates for every craft.** `Store.registerCraft({ template: { fromProject(project) →
   {craftData, checklist?, emoji?}, blank?() } })` or `Store.setCraftHooks(id, { template })` (for
   shell-ui to forward `def.template`). `templateFromProject` runs the hook on a deep copy
   (`opts.fromProject` overrides it); crochet / knitting drafts are unchanged (craftData null).
   `Store.templateDraft(craft)` is the "+ New template" seed. `saveTemplate` refuses a template whose
   craftData is over 256 KB with a plain sentence (templates live in localStorage). Backup round
   trip asserted. Done.
2. **Per-craft settings and a profile that survive a backup.** Craft hooks `settings: { defaults,
   normalize }`; `Store.setCraftSettings`. `settings.profile` (present once used): units,
   measurements `{value, unit, at}` (mm stored as cm), floss stash by brand and code with owned
   counts (quarter skeins), fabric stash, plus `flossAllocation` (computed, never stored) and
   `convertLength`. `previewImport(...).settings` lists what would change; `importJSON(text,
   {settings: 'merge'|'replace'|'skip'})`, default **merge**; device-only keys (focusProjects,
   persistGranted, the nag snooze) never come from a file; `undoImport` puts settings back. Done.
3. **Heavy craft data off localStorage.** Opt-in `heavy: { fields, minBytes }`; IndexedDB under
   `p:<id>:heavy:<path>:<rev>`; a side table `Project.heavy` on disk only; load on demand with
   `Store.whenReady`; diff undo. Done, with the limits below.
4. **Sessions and activity log.** `Project.activity` (sessions ≤ 200, day rollups ≤ 800, totals),
   10-minute idle rule, `Store.pace` (perHour trimmed mean, perDay, streak, ≈ finish range only with
   ≥ 5 sessions and a remaining count), goals (`setGoal` / `goalStatus`, 02 #21) and the mark log
   for the time-lapse (`logMarks` / `flushMarks` / `readMarks`, varint deltas in BlobStore, 04 X3).
   The crochet / knitting counter records its own stitches and rows. Done.
5. **Count events.** `Store.counted(ev)` + `Store.onCount(fn)`; counter events carry
   `origin: 'counter'` so the shell helper does not announce them twice. Done.
6. **Step edits and notes.** `Project.overlay.steps[stepKey]`, keyed by a hash of the printed
   text (case, spaces and punctuation ignored, `~2` for repeats), `applyStepOverlay` returns rows
   and orphans. Done.
7. **Other asks.** `Store.storageUsage()` (12 #12's numbers), measurements in the profile for P3,
   the floss stash for 02 #15. Not done: P17 fitting log as a store structure (it fits in
   `craftData` plus `p:<id>:fitphoto:<n>` blobs, which backups already carry; nothing new needed).

## Measured (real tab, desktop, 2026-11-12; store-safety group "wave K 7")

On a synthetic 250,000-cell chart: 533 KB of cells and a 41,668-character progress bitmap.

| | not opted in (today) | opted in |
|---|---|---|
| store work per tap (updateCraftData, mean of 50; the bit flip itself 0.004 ms) | **2.8 ms** (whole-project deep copy) | **0.47 ms** |
| undo memory after 50 taps | **1,726,689 bytes in 3 steps** (the 2 MB cap throws the rest away) | **44,665 bytes in 50 steps** (~890 bytes a step) |
| localStorage state | ~575 KB | **7,322 chars** |
| first move to IndexedDB (save → committed, incl. read-back) | | **24–58 ms** (transaction + read-back 17–53 ms), off the tap path |
| loading it back after a reload (`whenReady`) | | **2–3 ms** |
| `Store.counted` per event | | **3.9–4.1 µs** |

## Store.js: exactly what changed (for the knit-store worker)

No knitting region was edited. Changes, by place:
- Utilities: new `jsonValue` after `jsonObject`.
- Crafts: `registerCraft` (entry gains `template`, `settingsHook`, `heavy`), `renormalizeCraft`
  (skips unloaded projects, re-normalises the craft's settings bag).
- Templates: `saveTemplate` (size guard, first lines), `templateFromProject` (last line calls
  `applyTemplateHook`).
- Factories: `normalizeProject` (craftData through `wkCraftDataIn`; the return wraps
  `knitNormalizeProject(...)` in `wkProjectOut(..., p)`), `normalizeCraftSettings` (per-craft hook),
  `normalizeState` (profile, after the literal).
- Persistence: `load` (`heavyIngest` after the state is built), `writeNow` (`serializeState`,
  `heavyAfterWrite`, `heavyRescue` on quota, `rescuing` in the result), `adoptForeign`.
- Lookup: `craftSettings` (defaults merge).
- Undo: `snapshot` (one stringify; heavy path), `undo` (heavy restore / refuse, not-ready entries).
- Counting: `completeRow`, `tapStitch`, `untapStitch`, `untapRow` each got one `counterCounted`
  line (no change to their results).
- Projects: `updateCraftData` (refuses unloaded projects; rebase after a silent write),
  `summaryFor` (stored line while unloaded).
- Export / import: `exportJSON` (+ new `exportView` / `exportProjectView`), `exportProjectJSON`,
  `previewImport` (`settings`), `importJSON` (pre-import disk copy, heavy table rekey, `heavyIngestOne`,
  settings), `undoImport`, `exportThready` (now hydrates first; the old body is `exportThreadyNow`,
  which skips `:heavy:` blobs of ready projects).
- New section "Wave K (shell-data …)" just before "Public API" (K1–K6), new names in `window.Store`,
  `__setKeyForTests` clears commit timers.

## Adopting it (craft workers, batch 2)

**Cross-stitch (xs-app / xs-core)**
1. In `XStitch`'s `Store.registerCraft`, add `heavy: { fields: ['chart.cells.data',
   'progress.done'], minBytes: 32768 }`. Declare the *string leaves*: `normalizeChart` makes a new
   `{enc, data}` object each time, but the `data` string survives, so nothing is rewritten on open.
2. Treat both as immutable: assign a new string (`cd.progress.done = b64`), never mutate in place
   (true today).
3. In `renderProject` (or have the shell do it): `if (Store.heavyState(id) !== 'ready' &&
   Store.heavyState(id) !== 'none') { show "Loading the chart…"; Store.whenReady(id).then(render);
   return; }`; on `'missing'` show "This chart's stitches are not on this device. Restore a backup
   (or Keep what is left)" with `Store.discardMissingHeavy(id)` behind a confirm.
4. `summary(project)` must not need the cells when loading (it is not called then; the stored line
   is used), so no change.
5. After each mark: `Store.counted({ projectId, n, unit: 'stitch', part: 'DMC 310', total })`
   (one event per action; a whole-colour mark is one event with its real n; an unmark is negative),
   and `Store.logMarks(projectId, [[cellIndex, 1|0], …])` for the time-lapse.
6. Templates: `template.fromProject(p)` returning palette, fabric and the chart without progress;
   keep it under 256 KB or return craftData without cells.
7. Stash: `Store.flossOwned / setFlossOwned / flossAllocation`; settings via `settings.defaults`.
8. Undo is cheap now, so the 1 MB oversize guard can move up once this is in.

**Sewing (sew-app / sew-core)**
1. Step edits and notes: `var keys = Store.stepKeys(steps.map(s => s.printedText))` at import time
   (store the key on the step as `step.key`), `Store.setStepEdit(id, key, text)`,
   `Store.setStepNote(id, key, note)`, and `Store.applyStepOverlay(id, printedTexts)` when drawing.
   Use the imported text, never the edited one, as the key.
2. Measurements: `Store.setMeasurement('bust', 97, 'cm')`, `Store.measurement('bust', chartUnit)`.
3. `Store.counted({ projectId, n: 1, unit: 'step' })` on Step done (and `unit: 'cut'` for cut
   chips, `'unit'` for quilt units). Settings via `settings.defaults`; templates via `template`.
4. Page images need nothing new; a fitting log fits in craftData with photos under
   `p:<id>:fitphoto:<n>`.

**Shell (shell-ui)**: forward `def.template` with `Store.setCraftHooks(def.id, { template:
def.template })`; call `Store.whenReady(id)` before `renderProject`; ignore `origin: 'counter'`
count events in `ctx.counted`; show `preview.settings` and pass `{ settings }` to `importJSON`;
Settings → Profile reads `Store.profile()` / `setProfile`.

## What I did not make safe (plainly)

- **The last ~150 ms of heavy edits can be lost on a crash.** localStorage only lets go of a field
  once IndexedDB has committed it; until then a crash reloads the previous whole version (never a
  mix). Inline data had the same 150 ms debounce, but the IndexedDB commit adds its own latency.
- **A second tab editing the same chart at the same moment** is still the wave 1 conflict bar
  (last writer keeps theirs); each tab's revisions have unique keys and the previous one is kept,
  so neither tab reads a half-written blob, but there is no merge of two tabs' stitches.
- **Templates are not offloaded**: a craft template over 256 KB is refused instead.
- **The plain `exportJSON()` is synchronous**, so an unloaded project leaves it with its side
  table (no cells). `exportThready` hydrates first; the app's .json fallback path (`app.js` 9526)
  should `await Store.hydrateAll()` first (ask below).
- **Undo of an action taken before a project was loaded** (for example a status change right after
  a reload) restores a light copy and reloads the heavy fields from disk; if they had changed in
  between, light and heavy are a step apart.
- **Heavy objects mutated in place** break the shared-undo assumption; the contract forbids it,
  and a diff that no longer fits refuses the undo step rather than restoring a wrong chart.
- **Knitting short-row / two-at-a-time row taps** (`knitTapRow`) do not record a row in the
  activity log; only `completeRow` / `untapRow` do. The knit-store worker can add one
  `counterCounted` line in their region if wanted.
- **The pace test is time-of-day sensitive** in the first 31 minutes after midnight.
- Nothing ran on a phone.

## For the owner of js/app.js (shell-ui)
- `exportBackupJSON` (app.js ~9526): call `Store.hydrateAll()` before `Store.exportJSON()` /
  `exportProjectJSON` so a `.json` fallback is whole.
- The adoption items under "Shell" above.
- `sw.js` / `index.html`: no new runtime files from me.

## Decisions for the coordinator
- Settings restore defaults to **merge** (theme and switches from the file; profile by key, newer
  wins). A one-project file has no settings, so sending a project never changes the receiver's.
- `Store.counted` records sessions for crochet and knitting too (craft-agnostic), with no UI yet.
- `zip.js` is unchanged (`.thready` stays uncompressed; heavy data is inline in backup.json).
