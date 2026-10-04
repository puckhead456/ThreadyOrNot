# Thready or Not — Technical Spec

(App was called "Stitchkeeper" during the initial build; the localStorage key `stitchkeeper.v1` and cache names keep that name on purpose so existing saved projects survive the rename.)

A crochet row/round + stitch counter PWA. Plain HTML/CSS/JS, **no build step, no ES modules, no frameworks**.
Hosted on GitHub Pages at `https://puckhead456.github.io/ThreadyOrNot/` (repo github.com/puckhead456/ThreadyOrNot; local folder is still C:\Users\mitch\CrochetBs) (so all paths must be **relative**: `./css/app.css`, never `/css/app.css`).
Works on iPhone Safari, Android Chrome, and desktop. Installable as a PWA ("Add to Home Screen"). Works offline.

Every JS file attaches ONE global object to `window` (e.g. `window.Patterns`, `window.Celebrate`, `window.Themes`, `window.Store`, `window.App`). Script tags load in order in `index.html`. Use `'use strict'` inside an IIFE.

## File layout

```
index.html                  # single page, all screens/modals as sections
manifest.webmanifest
sw.js                       # service worker, cache-first for app shell + fonts
css/app.css                 # layout + components, uses ONLY the CSS variables below
css/themes.css              # the 6 themes: each sets the CSS variables on html[data-theme="..."]
js/themes.js                # window.Themes = metadata list (id, name, group, tagline, swatches, emoji, fonts)
js/patterns.js              # window.Patterns = pattern text parser (pure functions)
js/celebrate.js             # window.Celebrate = themed finish animations
js/audio.js                 # window.Feedback = haptics + synthesized tap sounds
js/store.js                 # window.Store = state, persistence (localStorage), undo, export/import
js/app.js                   # window.App = rendering + event handling (the UI)
icons/icon-192.png, icons/icon-512.png, icons/apple-touch-icon.png, icons/icon.svg
```

## Data model (localStorage key `stitchkeeper.v1`)

```js
State = {
  version: 1,
  revision: number,                 // bumped on every successful write (multi-tab, 13 #1)
  writerId: string,                 // the tab that wrote it; a foreign id means another tab
  settings: {
    theme: 'stardew-night',         // one of the 6 theme ids (Stardrop Night is the default for new installs)
    haptics: true,
    sounds: true,
    keepAwake: false,               // screen wake lock preference
    autoAdvance: true,              // when a row's stitch target is hit, auto-complete the row
    liveDiagram: true,              // the 3D piece inside the stitch button
    toursSeen: string[], welcomed: boolean,
    // Backup reminder + persistent storage (12 #1, 09 #4)
    lastBackupAt: number,           // ms; Store.exportJSON() stamps it (taking one counts as a backup)
    backupNagSnoozedUntil: number,  // ms; "Not now" sets now + 14 days
    touchDays: string[],            // 'YYYY-MM-DD' per day work happened, newest last, cap 60
    persistGranted: boolean,        // navigator.storage.persist() said yes
    crafts: { [craftId]: object },  // opaque per-craft settings. Crochet's bag holds
                                    // `diagramFollow` (wave F: absent = on, see "Live 3D diagram")
  },
  templates: Template[],
  projects: Project[],
  activeProjectId: string|null,
}

Project = {
  id: string,                       // random id
  name: string,
  emoji: string,                    // e.g. '🐑' '🐉' '🧶'; user pickable from a small grid
  status: 'active'|'paused'|'finished'|'frogged',
  createdAt: number, updatedAt: number, finishedAt: number|null,
  countMode: 'rows'|'rounds',       // label only; both count identically
  groupSize: number,                // stitch group size, default 10, 0–50 (0 = grouping off)
  templateId: string|null,          // template the project was created from (null on old saves / unknown)
  notes: string,                    // project-wide notes (hook, yarn, pattern link)
  timer: { totalMs: number, runningSince: number|null },
  parts: Part[],                    // always >= 1 part. Single-piece projects have one part named 'Main'
  activePartId: string,
  checklist: { id: string, text: string, done: boolean }[],   // assembly checklist
  history: { ts: number, partId: string, partName: string, row: number }[], // one entry per completed row, newest last, cap 500
  sizes: string[]|null,             // the document's size names (['XS','S','M',…]), shared by all parts
  size: { index: number, label: string }|null,   // wave F: the size the maker picked ONCE for the
                                    // whole project (see "Size once"). null = never asked
}

Part = {
  id: string,
  name: string,                     // 'Body', 'Wing', 'Main'
  makeCount: number,                // how many of this piece (wings = 2). default 1
  piecesDone: number,               // completed pieces of this part (0..makeCount)
  row: number,                      // current row/round number. 0 = not started. "row 5" means 5 rows completed
  stitch: number,                   // stitches completed in the current (in-progress) row
  targetRows: number|null,          // total rows for this part; enables progress bar
  repeat: { enabled: boolean, startRow: number, endRow: number, times: number,
            mode: 'times'|'untilRows', untilRows: number|null },   // wave F: "until there are a
                                    // total of 25 Rows" is kept as untilRows (old saves are
                                    // 'times'); `times` is kept in step (Store.repeatTimes =
                                    // whole blocks between startRow and untilRows) so every
                                    // reader of `times` is unchanged
  makeCountInferred?: true,         // wave F: present only when the parser inferred the make-count
                                    // from the assembly text; dropped when the owner changes it
  alerts: number[],                 // stitch numbers to flash+buzz at within a row, e.g. [40, 80]
  placementNotes: string,           // 'eyes between rnd 8-9, 6 sts apart'
  patternText: string,              // pasted pattern for this part; parsed by Patterns
  importKey: string,                // content-derived id of the section that made this part
                                    // (name + first instruction line). Re-importing a corrected
                                    // PDF matches on this BEFORE the name, so a section the
                                    // parser could not name updates itself instead of being
                                    // appended as 'Part 10', 'Part 11', … (13 #7). '' when the
                                    // part was made by hand.

  // --- per-part crochet rendering hints (3D waves B–D). Crochet only. -----
  workMode: 'auto'|'rounds'|'rows',        // default 'auto'. Rounds vs rows is a
                                    // property of the PIECE, not the project (05 #2).
                                    // Resolved by `Store.partWorkMode`.
  orientation: 'auto'|'top-down'|'bottom-up',  // default 'auto'. The model always
                                    // grows DOWNWARD from round 1, so a piece the
                                    // designer worked from its base renders upside
                                    // down until something says so. 'auto' reads the
                                    // part's own text ("starting from the bottom of
                                    // the body"); `Model.shape.upsideDown` carries the
                                    // verdict and `DiagramGeo.layout` does the flip.
  dialect: 'auto'|'uk'|'us',        // default 'auto'. UK and US crochet COUNT the same
                                    // (sc/dc/tr are one-for-one), so this never moves a
                                    // stitch count — it moves HEIGHTS, which is the whole
                                    // of the 3D diagram: a UK `tr` is a US `dc` (h 2.01),
                                    // a US `tr` is a round taller (h 2.68). 'auto' asks
                                    // this piece's own text through `Patterns.dialectHints`
                                    // and `importPatternSections` seeds it from the WHOLE
                                    // document, because a section that writes nothing but
                                    // `tr`, `dc` and `ch` is undecided on its own (the
                                    // Stylecraft hood motif came out 33 % too tall).
                                    // Set by hand with the "Terms: Auto / UK / US"
                                    // chips in the part editor and the 3D viewer.
}
```

### Counting semantics (Store implements these; App only calls them)

- `Store.tapStitch(projectId, partId)` → `stitch += 1`. If the current row (`row + 1`) has a stitch target from the pattern (`Patterns.targetFor`) and `stitch >= target` and `settings.autoAdvance` → completes the row (same as tapRow) and returns `{ event: 'rowAuto' }`. If `groupSize > 0` and stitch lands on a multiple of `groupSize` → returns `{ event: 'group' }` (`groupSize` 0 turns grouping off entirely). If stitch is in `alerts` → returns `{ event: 'alert', stitch }`. Else `{ event: 'stitch' }`.
- `Store.untapStitch` → `stitch = max(0, stitch - 1)`.
- `Store.tapRow` → `row += 1`, `stitch = 0`, push history entry. A part that is already in its terminal state (`targetRows` set, `piecesDone >= makeCount`, `row >= targetRows`) does nothing and returns `{ event: 'alreadyDone', partName, row, targetRows }` — every transition into "done" is idempotent, so the counter never runs past its target and the finale never replays (13 #6). Otherwise, if `targetRows` and `row >= targetRows`: if `piecesDone + 1 < makeCount` → `piecesDone += 1`, `row = 0` and return `{ event: 'pieceDone', piecesDone, makeCount }`; else `piecesDone = makeCount` and return `{ event: 'partDone' }`. If ALL parts are done → return `{ event: 'projectDone' }`. Else `{ event: 'row' }`.
- **`allPartsDone`** (02 #2): at least one part has a `targetRows`, every part that has one has `piecesDone >= makeCount`, **and** no part without a target is completely untouched (`row`, `stitch` and `piecesDone` all 0). A target-less part that HAS been worked is skipped — it is the open-ended tail the user chose not to bound. `Store.blockingParts(id)` names whatever is in the way and `Store.finishProject(id, {force})` is the "Finish anyway" path the app offers on the project-done sheet.
- `Store.untapRow` → the literal inverse of the row tap (13 #4): `row -= 1`, `stitch = 0`, popping this part's last history entry, and returning `{ event: 'row', row, piecesDone }`. Off row 0 with `piecesDone > 0` it steps back into the previous piece (`piecesDone -= 1`, `row = targetRows`); out of the terminal state it steps back to the last row of the last piece. At row 0 of the first piece it clears a part-worked `stitch` if there is one, and otherwise returns `{ event: 'none' }` and changes nothing — in particular it does not eat a history entry, and the app makes no sound and no announcement.
- `Store.resetPart` → row 0, stitch 0 (keeps piecesDone).
- `Store.undo()` → every mutating call above first pushes a deep-copy snapshot of the project onto an undo stack (cap 50, in memory only). `undo()` pops and restores. Returns boolean.
- Repeat readout: if `repeat.enabled`, `len = endRow - startRow + 1`, current row number being worked is `r = row + 1` (`times` is `Store.repeatTimes(repeat)`, which for `mode: 'untilRows'` is `floor((untilRows − startRow + 1) / len)`, at least 1). If `r >= startRow && r < startRow + len * times`: `k = floor((r - startRow) / len) + 1` (which repeat, 1-based), `j = ((r - startRow) % len) + 1` (row within repeat), `patternRow = startRow + j - 1`. Else not inside repeat; `patternRow = r`. `Store.repeatInfo(part)` returns `{ inside, k, j, len, times, patternRow, workingRow: r }`. **Pattern line highlighting and stitch targets always use `patternRow`**, so a repeated section highlights correctly.
- Timer: `Store.toggleTimer(projectId)`. `Store.elapsedMs(project)` = `totalMs + (runningSince ? now - runningSince : 0)`. Only one project's timer runs at a time.
- `Store.save()` writes to localStorage (debounced ~150ms is fine; must also flush on `visibilitychange`/`pagehide`). `Store.load()` on boot; if missing, create default state with NO projects (the home screen shows an empty-state).
- `Store.exportJSON()` → string of the whole state, and stamps `settings.lastBackupAt` (taking a backup is what resets the nag). `Store.importJSON(str, choices?)` → applies a backup, `choices` being `{projects:{[id]:'skip'|'replace'|'keepBoth'}, templates:{…}}`; anything not named defaults to `'replace'`. Returns how many projects were applied. Throws an `Error` with `code === 'newerVersion'` for a file from a later version. `Store.previewImport(str)` answers what it *would* do without writing.

### Persistence health, multi-tab and the backup nag (Store owns the facts, App owns the UI)

The wave-1 data-safety bundle (13 #1–#3, 09 #2/#3/#4, 12 #1/#3). Nothing here is silent: every failure has a place on screen.

- **A failed write is loud.** `Store.writeNow()` / `flush()` return `{ok, kind:'quota'|'private'|'unknown'|null, error, retried, blocked:'corrupt'|'conflict'|'nostate'|null}` and retry once with the undo stack cleared. `Store.saveFailed()`, `Store.lastSaveError()` and `Store.onStorageError(fn)` report it; `Store.storageHealth()` → `{writable, privateMode, bytesUsed, corruptKey}` answers it at boot. **App shows a persistent, non-dismissable `role="alert"` banner above every screen** (`#app-banners`, `--banner-h` pushes the screens down): quota → "Your last taps are not saved. Free up space or download a backup." with **Download backup** (and **Free up space** when the open craft module publishes a `freeUpSpace(projectId, ctx)` on its registration); private mode → the calmer "Private browsing: nothing will be saved after you close this tab."
- **Unreadable state is quarantined, not overwritten.** An unparseable read is copied to `<KEY>.corrupt.<ts>` and every write is refused until `Store.acknowledgeCorrupt()`. `Store.isCorrupt()`, `corruptSnapshot()`, `corruptKey()`. **App boots into a full-screen locked sheet** "Your saved projects could not be read" with **Download the copy** (the snapshot as `<corruptKey>.json`) and **Start fresh**.
- **Pre-flight.** `Store.wouldExceedQuota(bytes)`. App calls it before a backup import (`file.size * 2`) and before reading a PDF (the same bound capped at 1 MB, because only the extracted *text* is stored, never the file).
- **Two tabs.** Every write bumps `state.revision` and stamps `state.writerId`. A `storage` event carrying a foreign writer is adopted silently when nothing local is in flight (`Store.onExternalChange` → App re-renders and toasts "Updated from another tab"), and otherwise raises `Store.conflict()` / `Store.onConflict` — auto-saving stops and **App shows a sticky bar** "This app is open in another tab and both made changes." with **Keep mine** / **Use the other tab's** → `Store.resolveConflict('keepMine'|'takeTheirs')`.
- **Persistent storage + the backup nag.** `Store.requestPersist()` → `Promise<boolean>`, called by App **once per session after the first completed row** (a gesture, not cold boot). `Store.backupStatus()` → `{due, days, lastBackupAt, snoozedUntil, persistGranted}`; `due` is "5+ separate days of work since the last backup, not snoozed, at least one project". App puts a one-line dismissible bar at the top of the home list — "Your work lives only on this phone. Save a backup →" with **Back up now** (wave F: it writes the `.thready` file, `exportJSON` stamps `lastBackupAt` and the bar re-renders away) and **Not now** (`Store.snoozeBackupNag(14)`) — and appends "Add to Home Screen keeps it safer." on iOS Safari outside standalone mode.
- **Import preview.** Settings → Import backup (a `.thready` or a `.json`, see "Backup file" below) caps the file at 50 MB (`Store.BACKUP_FILE_MAX_BYTES`, checked before a byte is read; it was App's 25 MB for JSON until wave F), then `previewImport` drives a sheet: a counts line "N new · M will be replaced · K identical · J older" and a row per non-identical project and template (name, craft, both dates, and "· 1 page image" when the file carries some) with a segmented **Skip / Replace / Keep both** (a brand-new item gets **Skip / Import** instead). Defaults: new → import, file-is-newer → replace, identical or local-is-newer → skip. Keep-both clones get fresh ids and " (from backup)", and since wave F **their own copy of the page images** (the file's, else the local original's), so deleting one twin never strips the other's pages. `importJSON` snapshots the whole state first, so the result toast offers **Undo import** (`Store.canUndoImport()` / `Store.undoImport()`) for the rest of the session; the undo takes the imported images back out and restores any local ones the import replaced.
- Templates (`Store.templates`): array of `{ id, name, emoji, countMode, parts: [{name, makeCount}], checklist: string[] }`:
  - `blank` "Single piece" 🧶 rows, parts [Main]
  - `blob` "Blobby animal" 🐑 rounds, parts [Body, Head, Ears x2, Legs x4, Tail], checklist [Stuff body, Stuff head, Sew head to body, Attach safety eyes, Sew ears, Sew legs, Sew tail, Embroider face]
  - `dragon` "Dragon" 🐉 rounds, parts [Body, Head, Wings x2, Legs x4, Tail, Horns x2, Spikes], checklist [Stuff body, Stuff head, Sew head to body, Attach safety eyes, Sew wings, Sew legs, Sew tail, Sew horns, Sew spikes down back, Embroider nostrils]
  - `garment` "Garment" 🧥 rows, parts [Front, Back, Sleeves x2], checklist [Block pieces, Seam shoulders, Set in sleeves, Seam sides, Weave in ends]
  - `blanket` "Blanket / scarf" 🧣 rows, parts [Main], checklist [Weave in ends, Add border, Block]
- `Store.createProject({ name, emoji, templateId, groupSize, countMode })` → applies template.

### Backup file (`.thready`, wave F; 12 #4–#5)

A backup is one zip file, `thready-or-not-backup-YYYY-MM-DD.thready`, written by **📥 Back up now**
in Settings → Backup (under "Last backup: today / yesterday / N days ago / never", with **📤 Share
backup** only where the browser can share a zip, and **📂 Import backup**), by the home nag and by
the quota banner. Every project's ⋯ menu has **📦 Send this project** (one-project file,
`<project-name>-YYYY-MM-DD.thready`), **📂 Open a project file** (the same import) and **📤 Back up
everything**. The full contract is a block comment in the backup section of `js/store.js`;
details and the test list are in `docs/wave-f/shell.md`.

```
backup.json                  exactly Store.exportJSON() (a one-project file: the same format with one
                             project); importable on its own, forever
manifest.json                { format:'thready', formatVersion:1, scope:'all'|'project', app, appVersion,
                               writtenAt, backup:'backup.json', backupVersion,
                               counts:{projects, templates, images}, entries:[{path, key, type, bytes}] }
README.txt                   what this is, in plain words
pages/<projectId>/<n>.<ext>  BlobStore bytes as stored (jpg/png/webp/gif, else .bin); the manifest maps
                             each path to its BlobStore key
```

- **Writing.** Every entry is STORED (no compression) with CRC-32 and UTF-8 names. The output Blob
  is built from Blob parts and each image is read once for its CRC, so a 40-page chart never sits
  in one ArrayBuffer. A full backup stamps `lastBackupAt` (through `exportJSON`); a one-project file
  does not (it is not a backup). Without `window.Zip`, or when the build fails, the buttons write the
  plain JSON file as before.
- **Reading.** The file is sniffed by its bytes (`PK\3\4`), never by name or MIME type (the iOS
  picker has no `accept` filter, because iOS greys out an unknown extension). `backup.json` is the
  truth. A missing manifest or `pages/` folder, a damaged image, an image for a project not in the
  file and a stray entry are skipped and counted, never errors; without a manifest line an image's
  key is worked out from the project's own craftData; the shallowest `backup.json` sets the root, so
  a zip unpacked and re-zipped one folder down still works; DEFLATE entries are inflated with
  `DecompressionStream` where the browser has it. Refused outright: no `backup.json`
  (`noBackupJson`), a damaged one (`damaged`), a manifest `formatVersion` above
  `THREADY_FORMAT_VERSION` (`newerVersion`), and anything over 50 MB (`tooBig`). The quota pre-flight
  measures `backup.json`'s text, not the zip, because the images go to IndexedDB.
- **Which images go where** (`Store.importPages`, after `importJSON`): replace/new with images in
  the file → the local `p:<id>:*` images are copied to `preimport:<key>` (deleted only once the copy
  succeeded) and the file's are written; replace/new with none in the file → the local images stay
  (a same-phone restore, or a JSON backup); Keep both → `importJSON` rewrites the clone's craftData
  blob keys to its new id and the images are written (or copied from the local original) under it;
  Skip → nothing. The page snapshot lives in BlobStore (`preimport:*` plus `preimport:__list`), so it
  survives a reload like the localStorage one; `undoImport()` stays synchronous and queues the page
  undo; a new import clears an older page snapshot first; all page work runs on one serial queue.
- **Housekeeping.** A boot-time sweep (`BlobStore.sweep`, 8 s in, on `requestIdleCallback`) deletes
  `p:<id>:*` images whose id nothing references — not the live list, any undo-stack entry, the
  pre-import snapshot or the raw state on disk (another tab's new project). It does nothing on an
  empty list, a corrupt store or a two-tab conflict, never touches keys outside `p:<id>:` or the
  `preimport:` snapshot, and logs rather than toasts.
- **Known gap.** Import still ignores the file's `settings` block (pinned in
  `test/backup.test.html`), so themes and the per-craft bags are written into a backup but not
  restored from it.

```js
window.Zip   // js/zip.js, loaded after blobstore.js and before app.js; precached
Zip.write(entries, { date, type }) → Promise<Blob>      // entries: [{ name, data: Blob|bytes|string }]
Zip.writeSync(entries, opts) → Uint8Array               // no Blobs
Zip.read(bytes) → Promise<{ entries: [{ name, size, method, crc, data, crcOk, error, dir }] }>
Zip.parse(bytes)                                         // sync
Zip.isZip(bytes), Zip.crc32(bytes, [crc]), Zip.utf8(str), Zip.fromUtf8(bytes)
// errors carry .code: 'notZip' | 'badZip' | 'zip64' | 'encrypted' | 'tooBig' | 'badName' | 'badData';
// one bad entry never throws: it comes back with crcOk:false or error 'compressed'|'damaged'|'unsupported'

Store.exportThready({ projectId?, appVersion? }) → Promise<{ blob, scope, projects, images, bytes }>
Store.exportProjectJSON(id) → string|null
Store.readBackupFile(File|Blob|ArrayBuffer|Uint8Array|string)
  → Promise<{ kind: 'json'|'thready', scope, text, pages: [{ projectId, key, path, type, bytes }],
              skipped, manifest }>
Store.previewImport(text, pages?)                        // rows gain `pages` (count)
Store.importPages(pages) → Promise<{ written, copied, skipped }>
Store.pagesIdle() → Promise                              // the queued page work (and page undo) is done
Store.backupFileProblem(bytes) → string|null             // the 50 MB message
Store.referencedProjectIds() → string[]                  // what the sweep must keep
Store.BACKUP_FILE_MAX_BYTES                              // 50 MB
Store.THREADY_FORMAT_VERSION                             // 1

BlobStore.entries(prefix) → Promise<[{ key, blob }]>     // one read transaction, sorted
BlobStore.putMany([{ key, value }]) → Promise<count>     // one transaction, all or nothing
BlobStore.deleteKeys(keys) → Promise<count>
BlobStore.sweep(liveIds, { prefix = 'p:' }) → Promise<{ count, bytes }>
```
`importJSON` keeps its signature and return value; it records each project's outcome for
`importPages` and rekeys Keep-both clones. `App.__importBackupFile(file)` and
`App.__buildBackupFile(projectId?)` are QA hooks, like `__forceSheetFallback`.

## Patterns API (`window.Patterns`, pure, no DOM)

```js
Patterns.parse(text) → Line[]
Line = { index: number, text: string, row: number|null, stitches: number|null }
```
Rules: split on newlines. For each line, detect a row/round number at the START of the line (case-insensitive, optional leading whitespace/bullets): `Rnd 5`, `Round 5`, `R5`, `R 5`, `Row 5`, `Rows 5-8` (range → row=5, rowEnd=8; include `rowEnd` on the Line), `5.`, `5:`, `5)`. Then detect a stitch count at the END of the line: `(30)`, `[30]`, `(30 sts)`, `(30 sc)`, `= 30`, `- 30 sts`, `30 sts`. Lines like `Rnd 2: inc x6 (12)` → row 2, stitches 12. Lines with no row number → row null (headers, notes). Row ranges (`Rnd 6-10: sc around (30)`) apply to every row in the range.

```js
Patterns.targetFor(lines, rowNumber) → number|null   // stitch count for that row, honoring ranges
Patterns.lineFor(lines, rowNumber) → Line|null       // the line to highlight for that row (ranges match)
Patterns.summary(lines) → { rows: number, maxRow: number|null, hasTargets: boolean }
```

## Patterns API v2 (supersedes the section above)

Goal: a user copy/pastes instruction text straight out of a pattern PDF (which is messy: side-notes interleaved, two-column bleed, typos like `6..Inc`) and the app still finds the rows, the stitch counts, the sizes, the sections and the repeats. Reference fixtures (NOT committed, copyrighted): `tmp-pdf/bee.txt` (amigurumi, numbered `1.` rows, NO explicit counts, `5-6.` ranges, `6..`/`8-11..` typos, colour-change lines between rows, eye-placement paragraph interleaved) and `tmp-pdf/cardigan.txt` (garment, `Row 1 (WS):`, `Rows 3-4:`, `Rnd 1:`, `Next Row:`, `Setup:`, counts after a pipe `| 184 (208, 224) sts; ...`, multi-size lists `25 (29, 33, 37, 37) (41, 45, 49, 53)`, `Repeat Rows 5-8 ... until there are a total of N Rows`, trailing count with no unit `turn. 184 (208, 224)`).

```js
Patterns.parse(text, opts?) → Line[]            // opts.size = 0-based index into multi-size lists (default 0)
Line = {
  index: number, text: string,
  kind: 'row' | 'setup' | 'header' | 'repeat' | 'note',
  row: number|null, rowEnd: number|null,         // setup/foundation lines: row 0 (rowEnd 0)
  section: number,                                // 0-based section index (see sections)
  stitches: number|null,                          // EXPLICIT count found in the text, size-resolved
  sizes: number[]|null,                           // all values when the explicit count was a multi-size list
  computed: number|null,                          // count EVALUATED from the instruction when no explicit count
  count: number|null,                             // stitches ?? computed
  countSource: 'explicit' | 'computed' | null,
  notes: string[],                                // short instruction-ish lines attached to this row (e.g. 'Colour change to black')
  deviation?: { printed, computed },              // wave E: only when a printed total and its own plain arithmetic disagree
}
Patterns.targetFor(lines, row) → number|null     // Line.count of the first section-0 line whose range contains row (any section if none in 0)
Patterns.lineFor(lines, row)   → Line|null       // same matching, ignores count
Patterns.summary(lines) → {
  rows, maxRow, hasTargets,                       // as before; hasTargets true if any count (explicit or computed)
  computedOnly: boolean,                          // true when no explicit counts exist but computed ones do
  sizes: string[]|null,                           // size names if a sizes line like `XS (S, M, L, 1X) (2X, 3X, 4X, 5X)` was found
  multiSize: boolean,                             // any multi-size count list seen
  sections: [{ index, name, makeCount, startLine, endLine, rows, maxRow }],
  suggestions: { targetRows: number|null, repeat: { startRow, endRow, times: number|null, untilRows: number|null } | null },
}
Patterns.splitSections(text) → [{ name, makeCount, text, placement, makeCountInferred? }]   // for the "import into parts" flow; the whole text becomes one section named '' if no headers
Patterns.detectSizes(text) → string[]|null
Patterns.evaluate(instruction, prevCount) → number|null   // exposed for tests
```

### Row markers (start of trimmed line, optional bullets `-*•`)
`Row 1`, `Row 1 (WS)`, `Rows 3-4`, `Rows 5 - 8`, `Rows 5–8`, `Rows 5 to 8`, `Rows 5 & 6`, `Rnd 1`, `Rnds 6-10`, `Round 1`, `Rounds 6–10`, `R1`, `R 1`, `Rnd1`, `ROW 1`, followed by `:`, `.`, `-`, `–`, `)` or whitespace. Bare numbers need adjacent punctuation: `1.`, `1:`, `1)`, `5-6.`, `6..`, `8-11..`, `7.. `. `Next Row`/`Next Rows`/`Next Rnd`/`Next Round` → row = (last row in section)+1 (rowEnd same). `Setup`, `Length Setup (WS)`, `Foundation`, `Foundation row`, `Base` (with `:` ) → kind 'setup', row 0. Never treat `5 sc in next st`, `6 inc around`, `2 sl sts` as markers. `R` must not match inside words.

### Sections
A **header** is a non-row line that is short (≤ 40 chars), has no sentence punctuation, and is either ALL CAPS letters (`BODY`, `WINGS`, `ASSEMBLY`) or Title Case (`First Section`, `Center Back`, `Sleeve Cuff`), optionally with a make-count: `Wings (make 2)`, `Legs x4`, `Leg (x4)`, `Ears - make 2`, `WINGS (2)`. A new section also starts when a row number ≤ the previous row's number appears (restart) even without a header (name ''). Header lines adjacent to each other where the second is a known non-part word (`EYES`, `ASSEMBLY`, `NOTES`, `MATERIALS`, `TERMINOLOGY`, `Finishing`, `Tips`) are not sections; `EYES`/`ASSEMBLY` blocks are notes. Section names are Title-cased (`BODY` → `Body`).

### Explicit stitch counts (size-resolved)
Search, in order: (1) after a pipe `|` anywhere in the line: first number or multi-size list there (`| 18 sts`, `| 184 (208, 224) sts; the number of puff...`, `| 7 sc, 2 sl sts` → 7); (2) at the END of the line: `(30)`, `[30]`, `(30 sts)`, `(30 sc)`, `(30 stitches)`, `= 30`, `– 30 sts`, `- 30`, `30 sts`, `30 sts.`, `(24, 30)` → last, `sts: 30`, `st count: 30`, `(30 sts total)`, trailing multi-size list with or without unit (`turn. 184 (208, 224)`), `= 184 (208, 224) sts`. Numbers INSIDE the instruction (`blo sc 88 (100, 108), Fsc 96`) are not counts. A multi-size list is `N (N, N, N) (N, N, N)` or `N (N, N)`; flatten in order and pick `opts.size` (clamp to length-1). Also resolve multi-size lists inside `Repeat ... until there are a total of 25 (29, ...) Rows`.

### Computed counts (`evaluate`)
When a row line has no explicit count, evaluate the instruction against the previous row's count (previous line in the same section with a count; setup counts as previous). Tokenize on commas/semicolons/`and`; groups in `()`, `[]`, or `* ... *`, with multipliers `x6`, `×6`, `*6`, `6 times`, `repeat 6 times`, `rep from * 5 more times` (= 6 total), or `repeat around` / `around` / `to end` / `across` (fill from previous count). Stitch vocabulary (produced, consumed): `sc`,`hdc`,`dc`,`tr`,`dtr`,`slst`/`sl st` (1,1); `puff`,`bobble`,`popcorn`,`cluster`,`shell` (1,1); `inc`,`increase`,`2 sc in next`,`2sc in same` (2,1); `dec`,`decrease`,`sc2tog`,`invdec`,`inv dec` (1,2); `3 sc in next st` (3,1); `sk`/`skip` (0,1); `ch N`,`turn`,`join`,`fasten off`,`flo/blo` prefixes, `mr`/`magic ring` (0,0). Counts: `6 sc`, `6sc`, `sc 6`, `sc in next 6 sts`, `sc in each of next 6 ch`, `2sc` → 2. Specials: `N sc in mr`, `Nsc in mr`, `N st in mr`, `mr N`, `magic ring N`, `N sc in magic ring/circle`, `MR with N sc` → N. `inc in each st`, `inc around`, `inc all around` → prev×2. `sc in each st`, `sc around`, `sc in each st around`, `sc all around`, `blo sc in each st across`, `sc across`, `work even` → prev. `dec in each st`, `dec all around`, `dec around` → prev/2. `X, Y, repeat around` (no brackets, trailing "repeat around"/"rep around"/"around") → treat the comma list before "repeat" as the group. Group filling: groups = floor(prev / consumedPerGroup); leftover stitches (prev mod consumed) each produce 1. `(inc, sc) x5, inc` → 5×3+2 = 17. `Ch1, turn, (inc, 2sc) x5, inc, sc` → 5×4+2+1 = 23. Typos to tolerate: `inx` → inc, `eact` → each. If anything in the line is not understood and no fill-from-previous rule applies → computed null (never guess). Lines whose only content is "work in pattern"/"continue in established pattern" → prev.

### Notes attached to rows
Non-row, non-header lines that are short (≤ 80 chars) and start with an instruction keyword (`colour change`, `color change`, `change to`, `switch to`, `add`, `stuff`, `tie off`, `fasten off`, `sl st`, `slst`, `join`, `place`, `insert`, `attach`, `sew`, `embroider`, `do not`, `don't`, `put`, `with`, `in <colour>`, `cut`, `leave`, `finish`, `close`) attach to the NEXT row line as `notes` (so "Colour change to black" shows when you start round 5). If there is no next row line in the section, attach to the previous row. **Exceptions (wave F):** a colour change that names its round ("CC to main color in last stitch of R12", printed under it) is that round's note; a paragraph carrying an end-of-row change ("to end, join with Yarn B at end of" / "final st, turn.") is the tail of the row ABOVE it (`notesAfter`), not a note for the next row. Either way the new colour starts on the following row. Everything else (side commentary, page headers, footers like `Chronic.Creator`) is kind 'note' with no attachment.

### Repeat / target suggestions
`Repeat Rows 5-8 ... until there are a total of 25 (29, ...) Rows` → `suggestions.repeat = {startRow:5,endRow:8,times:null,untilRows:25}`, `suggestions.targetRows = 25`. `Repeat Rows 3-6 until you have at least 14 total rows` → same with 14. `Rep Rows 2-3` / `Next Rows: Rep Rows 2-3` / `Repeat rows 2-3 around` → repeat with times null, untilRows null. `Repeat Rows 5-8 six times` / `x6` / `6 more times` → times 6 (or 7 for "more"). `Rnd 6-10: sc around` is a range, not a repeat. Lines that match are kind 'repeat'. Only the first suggestion in section 0 is returned.

### v2.1 additions (fixtures: `tmp-pdf/bear.txt`, `tmp-pdf/cato.txt`)

**Explicit count anywhere after the instruction.** Take the LAST bracket whose content is only a number (optionally followed by a unit word: `sts`, `st`, `stitches`, `sc`, `hdc`, `dc`), even if text follows it: `(30) (PHOTO A)` → 30; `(12) Fasten off Almond .` → 12; `(9) (2 Rounds x 9 Hdc = 18 Hdc)` → 9; `(24) (2 rounds total)` → 24; `- (18) touching round 6. If your eyes` → 18; `(16) Fasten off Twilight` → 16. Brackets with instructions (`A (Sc 5)`, `(Sc 1, Inc) x 8`) never count. The `- (N)` / `– (N)` dash form is common. Text after the count that starts with an instruction keyword (`Fasten off`, `FO`, `Stuff`, `Tie off`, `Sl st`) becomes a note on that same row; `(PHOTO X)`, `(PHOTO M-N)`, `(N rounds total)`, `(N Rounds x ...)` fragments are stripped from `text` and `notes`.

**Wrapped rows.** A row line whose text ends with `,` or has no count yet, followed by a non-marker, non-header line that starts with `(`, a lowercase letter, a colour-prefix like `A (`, `S (`, or a stitch token (`Inc`, `Sc`, `Hdc`, `Dec`, `Fsc`) is a continuation: merge it into the row's `text` (space-joined) and take its count. Also a line that is just `(36)` or `(30) Fasten off Almond .` is a continuation. Multi-line continuation allowed (max 3 lines).

**Two-column interleaving & headers.** Lines that consist only of single capital letters / photo labels (`A`, `B`, `E F`, `I J K`, `L M N`) are dropped. Trailing single-capital-letter tokens are stripped from headers (`Legs G` → `Legs`). Known non-part words are stripped from header names (`BODY EYES` → `Body`; a header that is only such a word (`EYES`, `ASSEMBLY`, `NOTES`, `MATERIALS`, `TERMINOLOGY`, `Finishing`, `Tips`, `Eye Placement`, `Facial Sculpting`, `Finished wing.`) is not a section header).
Row → section assignment uses **expected-next-row matching**: each section remembers `lastRow` (rowEnd of its last row). A row line whose start number equals `section.lastRow + 1` for some section is assigned to the most recently opened such section (setup row 0 makes a section expect 1). Otherwise, if the row starts at 1 or at ≤ current section's lastRow → open a NEW section. Otherwise (a gap) → current section. Header lines seen since the last header group form a **header group** (consecutive headers, ignoring blank lines and short "In Colour :" notes between them); when a new section opens it takes the next unused name from the most recent header group (in order), else ''. A header group is replaced when a later header appears after non-header content. Consequences that must hold: bear page 6 `Arms (Make 2)` + `Ears (Make 2)` headers followed by lines like `2. (Hdc 1, Hdc Inc) x 3 (9) 1. 5 Sc in Magic Ring (5)` — split a line at ` <count>) <N>. ` boundaries into two row lines — yields Arms rows 1,2,3-4,5,6 (6,9,9,8,6) and Ears rows 1,2,3 (5,8,12), both makeCount 2. Cato `Tail Frill` header between rows 30 and 31-33 does NOT start a section (rows continue in `Tail & Body`, 37 rounds); `Feet (make 2)` header bleeding into Arms row 17's wrapped text still names the next section Feet (rows 1-6). Bear: `Head`(13 rows), `Body`(10), `First Leg`(5), `Second Leg`(1), `Arms`(6 rows incl. range, make 2), `Ears`(3, make 2) — `Legs` header has no rows and is dropped.

**Notes as paragraphs.** Consecutive non-row lines merge into one note paragraph when the previous line ends with `,`, `-`, or a connector word (the, of, and, a, an, for, to, between, in, is, you, your, be, with, or, on, at, from, as, are, if, this, that, will, it, into, until, each, up, do); otherwise each line is its own note. A paragraph attaches to the next row (or previous if none) when it starts with a keyword (existing list plus: `before`, `after`, `now`, `next`, `make sure`, `switch`, `change`, `mark`, `pinch`, `fold`, `work`, `continue`, `stuff`, `embroider`, `place`, `add`, `attach`, `FO`, `fasten`, `tie`, `in color`, `in colour`, `with color`, `using`, `optional`, `do not`, `don't`, `begin`, `start`, `insert`, `invisible colour change`, `invisible color change`) and is ≤ 220 chars. `In Color A` / `In Twilight :` attach to the next row (row 1). The bee's interleaved commentary must still stay loose (the bee assertions keep passing).

**Evaluate vocabulary additions.** `Mr6`, `Mr 6`, `MR6`, `Mr8, Ch 1 and turn work` → 6/8; `Increase around`, `Inc around` → prev×2; `Decx9`, `Incx5`, `Inc x 8` (no/odd spacing) → counted; `Hdc Inc`, `Hdc Dec`, `Sc Inc`, `Sc Dec`, `HdcInc`, `11HdcInc` (= 11 hdc inc → 22) → inc/dec variants; `3Hdc in each stitch`, `3 sc in each st` → prev×3; `Hdc around`, `Sc around`, `Hdc 27`, `Sc 24`, `Sc 2, Inc x 3`; colour prefixes `A (Sc 5)`, `S (Dec x 12)`, `A (Hdc Inc x 5)` → the bracket group ×1; `Skip 1st stitch, 13Sc` → 13 (skip consumes 1 produces 0); `Bbl`, `Slst` (1,1); `(Bbl, Slst)x5`; `Sc, (Bbl, Slst)x5, 7sc` → 18; `Fold in half, sc 4 across to close` → 4; `2Sc, (Inc, Sc, Bbl, Inc, 2Sc)x2, Inc, 2Sc, Inc` → 24. Consistency check in the fixtures page: for every row with BOTH explicit and computed counts, report mismatches; target ≥ 90% agreement across bear + cato (list the rest).

### Wave E additions (ground-truth audit of every crochet fixture)

The full rule list, with the fixture each rule came from, is `docs/wave-e/crochet-audit.md`. The contract-level ones:

- **Printed vs computed (`deviation`).** A printed total is always kept, as printed: it is the target and the drawn count. When the row is plain sc/inc/dec arithmetic that `evaluate` reads exactly (`PLAIN_ARITH_RE`) and the two disagree, the parse line carries `deviation: { printed, computed }` and `Patterns.expand(...)` returns `deviation: { printed, computed, delta }` (`delta = printed − computed`) for that round; otherwise the field is absent. The corpus raises exactly three: Baphomet R29 "(2sc, dec)x8 [36]" (makes 24), Cato Feet R3 "(Sc, Inc) - (18)" (makes 3), AllFree Broomstick Row 138. Negative computed counts are dropped, and so is a computed total of a quarter of the row below or less on a row that neither decreases nor leaves stitches (a misreading, not a count).
- **`makeCountInferred`.** A section named for a paired thing (arm, leg, ear, eye, foot, hand, wing, horn, sleeve, cuff …; not "First/Left/Right …"), with no make-count, whose plural the document attaches somewhere ("Sew arms to body") gets `makeCount: 2` and `makeCountInferred: true`. The field is optional and absent otherwise.
- **Copied rounds.** "Rnds 1-5: Work same as First Square" is replaced by that part's rounds 1–5 (with its foundation when copying from round 1); "the same as the first (Rounds 1-5 above)" appends them renumbered. Only when every named round exists. The copied text is in the part's `text`, so the maker sees it.
- **Placement goes to the mover and the host.** A placing sentence that names the part it goes on ("of head", "to body", "onto the body") goes to the moving part **and** to that host; an unaddressed face detail (mouth, nose, eyes, cheeks) goes to the Head rather than the main part; "on black eye" stays with the Eye.
- **Repeats count the written row.** "Rep 3rd Rnd 3 times" after round 3 is written means 3 more (`times` 4, rounds 4–6), and "2 more times" adds 2 rows; "once/twice more" are read. A plain "Repeat Rows 5-8 six times" printed before rows 5–8 keeps 6. `suggestions.repeat.times` and `summary().maxRow` always agree, matching how `Store.applySuggestions` reads `times`. A repeat in mid-piece moves the next "Next row" past the rows it adds; a second repeat after the last written row follows the first; "Work a further 14 (…) rows even in pat." repeats the row just worked.
- **Designer row targets.** A row count written in an until-clause ("approx. 44 rows", "until there are a total of 25 Rows") sets `maxRow`, not only the suggestion. `untilRows` is never taken from a sentence that measures ("until … measures 19 (21) in."); "through Rnd 3" and "work even … until Rnd 49" count.
- **Section-level tension.** `Patterns.gauge(text, forName?)` reads the piece labels inside a tension box ("TENSION Scarf/cowl … Mitts 1 patt rep and 3.5 rows = 5x5cm"). When a part holds a length target that only a gauge can resolve, the part's own tension line is appended to its `text` (else the document's), so the mitts resolve on their own gauge (~20 rows) rather than the scarf's (14).
- **The colour key travels.** The yarn key ("313 Aran CA and 376 Burgundy CB", "Colour used A Black 1002, B Cream 1005") is appended as "Colours: (CA = Aran, CB = Burgundy)" to every part whose rounds use its codes and do not define them; "Using B", "With CA", "Attach CB in …", "Join C in …" set the colour, the foundation's colour applies to round 1, and "changing from colours A to B alternately" alternates a repeat's rounds.
- **Capital headings name their sub-blocks.** A capitals piece heading whose first block names itself on its own line ("SLEEVES" / "Ribbing: With smaller hook …") names its blocks "Sleeves: Ribbing", "Sleeves: Body Of Sleeve", "Sleeves: Shape Top" until the next capitals heading; `makeCountInferred` reads the piece half of the name. "All sizes:" / "Sizes … only:" name no part.
- **Foundations.** "Ch 100.", "With A, ch 21 (…).", "MR with 6 sc." are counted foundations, and open the next part when Row/Rnd 1 follows; row 1 over a counted foundation starts from it.
- **Granny closing side** (`closingSide`). A round written "corner, * side, corner; rep from * 2 times more" and closed with only the slip stitch gets its fourth side (hood round 2: 36, not 33).
- **`workMode` and turned rounds.** An `R`-labelled line that ends by turning, with no join, is a row; when half or more of the R lines do, the part is `'rows'` (snowman Scarf). A round that is joined and then turned stays a round.
- **Stitch records carry `post` and `lp`** (see `expand` v2 under "Live 3D diagram").

### Wave F additions (size once, colour changes, confidence, lengths)

Rules, fixtures and the pane checks are in `docs/wave-f/crochet-core.md`. The contract:

```js
Patterns.parse(text, { size, sizeCount })   // sizeCount = how many sizes the DOCUMENT names
Line.sizeUnresolved?: true        // a size list whose length is not sizeCount: no count, nothing computed
Line.notesAfter?: string[]        // notes that belong to the END of this row (an end-of-row colour change)
Line.approxRow?: true             // a row numbered after an unresolved length sentence ("≈ Row 25")
Line.lengthEstimate?: { value, unit, rows, gauge, fromStart }   // on the length sentence itself
Line.repeatFromLength?: true      // on a 'repeat' line whose row count came from a length + gauge
summary().lengthRows: boolean     // a row total here was read off a tape measure through a gauge
Patterns.detectSizes(text)        // also reads "Sizes XS/S M L XL 2/3XL 4/5XL" and "To Fit 4-6yrs … Adult L"
Patterns.sizeMarks(text, size, sizeCount)   // the chosen size's number marked in every size list
Patterns.sizeScope(text, names)   // which "Size XS:" / "Sizes M, L … only:" blocks belong to which size
Patterns.countReport(lines) → { rows, printed, computed, missing, unresolved,
                                disagree: [{ row, rowEnd, printed, computed, text }] }   // per ROW
```

- **Size names.** A size label line (Yarnspirations "Sizes XS/S M L XL", Stylecraft "To Fit 4-6yrs …
  Adult S Adult L", the classic `XS (S, M, L, 1X) (2X …)`) is read token by token, so hook sizes and
  "To fit chest measurement" are not size lists. A size list whose second bracket wrapped onto the
  next line is joined.
- **Honesty rule: one number per size or no number.** When the document names N sizes, a list of
  any other length resolves to **no count** (`sizeUnresolved`) instead of the clamp's guess. The
  Wheat Stitch panels print `184 (208, 224)`, three LENGTHS against nine body sizes, so they get no
  stitch target; the counter says "Pattern lists 184 / 208 / 224 here — not one per size". Without
  `sizeCount` the parser reads exactly as before.
- **A colour change made at the END of a row colours the NEXT row.** "changing to black in last 2
  loops", "in last st", "last st of R5", "at end of final st / row" set `state.pendingColor`, so the
  panda's Rnd 15 is white and Rnd 16 black, as in the photo (one wave A unit test changed, with the
  reason in the test). "Using Yarn A", "join with Yarn B", "re-join Yarn I", "pick up Yarn A",
  "continue with Yarn D" are read through the key; a two-range yarn table ("Azure (3366) x 2 A
  Turquiose (4044) x 3") is the key; "Starting in secondary color" / "CC to main color" name roles.
- **Lengths.** A row total that comes from a measurement through a gauge is an estimate (preview
  "→ target ≈ 89", counter "24 / ≈ 89"). Rows after a length sentence the section cannot resolve
  (Caron "Cont even in pat until work from beg measures 13"", whose "beg" is another block's
  foundation) keep the parser's count and carry `approxRow`; they are deliberately not renumbered
  off the gauge.
- **Repeats between written rows** fill the hole for the target ("Repeat Rows 5-8 until … 36 Rows"
  then "Next Row" = 37), and one written row continued by a repeat is a target too.

### App/Store integration (v2)
- `Part.sizeIndex: number` (default 0). `Store.linesFor(part)` calls `Patterns.parse(part.patternText, { size: part.sizeIndex, sizeCount })` (wave F: `sizeCount` = `Project.sizes.length`, so the honesty rule applies); cache key includes sizeIndex.
- **Size once** (wave F, brainstorm 4 / 03 #1, #13, #14). The size is a property of the PROJECT, picked once: `Project.size = { index, label }`. The contract:
  - A multi-size import (the New project drop zone or ⋯ → Import pattern) shows a **"Your size"** chip row (`role=radiogroup`, roving tabindex, arrow keys) with the document's own names. Until a size is picked each section says "pick your size for targets" and Save / Create parts refuses with "Pick your size first" and moves focus to the chips (`importPicker({initialSize})` → `size()`, `needsSize()`, `focusSize()`), so a nine-size pattern is never made silently in the first size. `importPatternSections(…, {size})` sets `Project.size`, every touched part's `sizeIndex`, reads each target at that size, and returns `sizeSet`; the toast adds "· size L".
  - `Store.setProjectSize(id, index)` → `{index, label, retargeted}`: one undo snapshot, every part's `sizeIndex` moves, rows / stitches / pieces are untouched, a target that was the pattern's reading (and an `untilRows` repeat that was the old suggestion) follows the size, a target typed by hand never moves. `Store.partSize(proj, part)` → `{index, label, source: 'project'|'part'|null, names}`; `Store.sizeNames(proj)` gives the document's names, else "Size 1..N". `Part.sizeIndex` keeps its meaning: a part set on its own ("Only this part" in the part editor, for body-in-L-sleeves-in-M) simply differs from `Project.size.index`. `addPart` inherits the project size; `targetRowsFromText(text, size, sizeCount)`.
  - Counter label "ROW · L"; the chosen size's number is marked in every size list in the pattern line, setup line and pattern sheet (`Patterns.sizeMarks`); the sheet starts "Your size: L" and dims the other sizes' blocks (`Patterns.sizeScope`).
  - Templates saved from a multi-size import (`templateFromProject`, the "Also save as a template" toggle) carry `sizes` and the picked `size`, and `createProject` starts the project there, so it offers the leaflet's names rather than "Size 1..N".
- **Colour changes reach the counter** (wave F, brainstorm 8). `Store.colorPlan(part)` walks `expand` once per parse + repeat (cached, never per tap); `Store.rowColorInfo(part, row)` → `{color, change: {to, at: 'start'|'end'}|null}`. The pattern line's tag carries a swatch of the row's yarn; on a change row a one-line strip says "Change to black at the end of this round" (`at: 'end'`) or "Change to Burgundy" (`at: 'start'`), announced once with the row milestone. Swatches use the owner's yarn colour, else the colour word; an unknown shade gets a dashed outline, never an invented colour. On that row the instruction clamps one line tighter, so 375×812 and 375×640 still do not overflow.
- **Confidence line** (wave F, brainstorm 3 / 06 #1, #8). `Store.countReport(partOrText)` wraps `Patterns.countReport`. The import preview shows one line per section ("10 counts computed ≈ · 1 count disagrees with the pattern", red when something disagrees or is unresolved; "every count printed"; "×2 (from the assembly text)" for `makeCountInferred`), and so do the Parts list and the part editor (plus up to three "Rnd 29: pattern says 36 · instructions add up to 24"). The stitch readout carries a small badge, **"≈ why"** (computed), **"≠ why"** (contradicted by its own arithmetic), **"? why"** (no count for this size) or for an approximate row number, which opens a sheet with the reason, the size-marked line and the part's confidence line.
- **Tap the row number** (wave F, 03 #6). `#row-number` is made a control from JS (`role=button`, `tabindex=0`, Enter/Space, "Rounds done: 14. Set the round count"). It opens "Set the round count" (− / number / +, pre-filled and selected, live hint "you will be working row 13 of 56, stitches back to 0"); Set runs the same undoable `Store.jumpToRow` as the pattern sheet, capped at the part's target, announced "Working row 13".
- **Until N rows** (wave F, 03 #5). `applySuggestions` keeps "Repeat Rows 5-8 until there are a total of 25 Rows" as `repeat.mode: 'untilRows'`, `untilRows: 25`; the part editor's Repeat section has "N times | Until N rows total" with a live "Rows 5–8 worked 5 times (5–24)" hint. `Store.targetApprox(part)` is true when the target came from a measurement (never for a hand-typed one); the counter shows "24 / ≈ 89" and an `approxRow` as "≈ Row 25".
- Part editor: under the pattern textarea show the summary line, e.g. `24 rounds · counts computed ≈ · 3 sections detected`. If `summary.sizes` or `summary.multiSize`: a **Size** select (names from `sizes`, else "Size 1..N" up to the longest list seen) bound to `part.sizeIndex`. If `summary.suggestions` has anything: an **"Apply detected settings"** button that sets targetRows / repeat (confirm shows what it will set). If `summary.sections.length > 1`: a hint "This text has N sections — use Import pattern to split into parts."
- New project-level sheet **Import pattern** (overflow menu + a link in the part editor): big textarea "Paste the instructions from your PDF", live list of detected sections from `Patterns.splitSections` with name (editable), make-count, row count and computed/explicit indicator, each with a checkbox (default on for sections that have rows). Buttons: **Create parts** (for each checked section: if a part with the same name exists (case-insensitive) → set its patternText and makeCount; else add a new part) and **Put it all in <active part>** (whole text into the active part). Toast with what happened.
- Each section from `Patterns.splitSections` also carries **`placement: string`** (`''` when there is none): the assembly prose the parser took off an "Assembly / Finishing / Eyes deepen" block and handed to the part it names (and, since wave E, to the host part the sentence puts it on), plus that part's own "Attach safety eyes between R21&R22…" sentences (those stay row notes as well). Assembly blocks and `=== PAGE n ===` / `ADDITIONAL PHOTOS:` furniture never reach a section's `text` or its row notes. `importPatternSections` writes `placement` into `Part.placementNotes` — replacing it on a new part, adding only the lines it does not already hold (case-insensitive) on an existing one — and returns `placed` alongside `created`/`updated`; the section row and the toast say "· placing notes".
- **Targets past the written rows** (wave E). `Store.targetRowsFromText(text)` (exported) counts a repeat that continues the written rows, through the parser's own `summary().maxRow` — the hood's "Rep 3rd Rnd 3 times" is a 6-round target, not 3. `Store.lineForRow` / `targetFor` answer exactly as `Patterns.lineFor` / `targetFor` do, so a row past the last written one shows the repeat sentence and takes the repeated row's count (the throw's rows 3+ target row 2's 94). `createProject` sets `targetRows` from each template part's text, so a project made from a PDF-saved template finishes like the PDF project did. The import preview names each section in its own word ("×8 · 6 rounds · → target 6"), not the project's.
- Counter screen: the pattern line shows `notes` beneath it in a smaller muted line (joined with ' · '). A computed target renders as `≈ 24` (tilde-approx) in the stitch readout; explicit as `24`. When the working row is 1 and a setup line (row 0) exists, show it above the pattern line labelled "Setup".
- Pattern sheet: render section headers as headers, setup lines labelled, `notes` inline under their row, computed counts as `≈N` at the end of the line.

## Templates v2 (user-editable)

Templates are DATA in state, not a constant. `State.templates: Template[]`.
```js
Template = { id, name, emoji, countMode: 'rows'|'rounds', groupSize: number (default 10, 0 = grouping off),
             parts: [{ name, makeCount, patternText, placementNotes }], checklist: string[], builtIn: boolean, updatedAt }
```
`patternText` is a string, default `''`, no length limit: a template drafted from a PDF import (or
from a project) carries each part's instructions, so a project made from it starts with its rounds
already in place. Built-ins have none. `validateTemplate` and `normalizeTemplate` both keep it;
anything that is not a string normalises to `''`.
`placementNotes` is a string handled exactly the same way (default `''`, kept by `validateTemplate`,
`normalizeTemplate`, `templateFromProject` and `createProject`), so a template made from an imported
project carries each part's placing notes too.
Shipped defaults (seeded into `state.templates` on first load, and any missing built-in id is re-seeded on load so old saves get them):
- `blank` "Single piece" 🧶 rows, group 10, parts [Main], checklist []
- `sheep` "Sheep" 🐑 rounds, group 10, parts [Body, Head, Ears x2, Legs x4, Tail], checklist [Stuff body, Stuff head, Sew head to body, Attach safety eyes, Sew ears, Sew legs, Sew tail, Embroider face]
- `dragon` "Dragon" 🐉 rounds, group 10, parts [Body, Head, Wings x2, Legs x4, Tail, Horns x2, Spikes], checklist [Stuff body, Stuff head, Sew head to body, Attach safety eyes, Sew wings, Sew legs, Sew tail, Sew horns, Sew spikes down back, Embroider nostrils]
(`garment` and `blanket` are removed; `blob` is renamed to `sheep` — migrate: if a saved state has a template with id `blob`, keep it under id `sheep`.)

Store API: `Store.templates()` → array (built-ins first, then user templates by name); `Store.template(id)`; `Store.saveTemplate(tpl)` (create when no id / unknown id, else update; validates: name required, ≥ 1 part, part names non-empty, makeCount 1–99); `Store.deleteTemplate(id)` (user templates only; built-ins cannot be deleted, only reset); `Store.resetTemplate(id)` (built-in → restore shipped values); `Store.templateFromProject(projectId)` → an unsaved Template drafted from the project's parts (name + makeCount + patternText), checklist texts, countMode, groupSize, emoji, name "<project name> template". `Store.createProject` reads the template from state and copies each template part's `patternText` onto the part it makes (fresh part ids, so there is no line cache to clear). Export/import JSON includes templates with their part pattern text (import merges by id, imported wins). Undo not required for template edits.

UI:
- New-project sheet: template picker reads `Store.templates()`; each card shows emoji, name, and the part list preview; a small "Edit templates" link under the picker opens the Templates sheet.
- New-project sheet, **crochet only** (hidden for other crafts, destroyed on close): under the template picker sits the shared `pdfDropZone` (`data-tour="new-pdf"`) with a collapsed "or paste pattern text" disclosure, and below it the shared **import picker** — the same "Sections detected" (tick / rename / row counts) and "Checklist items found" lists the Import pattern sheet uses, hidden until there is something to show. Once a PDF has been read: a synthetic **"From this PDF"** card (📄, preview = the ticked section names) goes to the front of the template picker and is selected; picking a real template instead keeps the sections, which are then added on top of that template's parts. An empty Name field takes the PDF file name (without extension) as its placeholder. An **"Also save as a template"** toggle with a name input (default `<project or PDF name> template`) appears under the sections. On Save: `createProject` (template `blank` when "From this PDF" is chosen), then `importPatternSections(created.id, ticked, {mode:'parts', text})`, then the ticked checklist items, then optionally `saveTemplate` with the ticked sections as parts carrying their `patternText`; one toast, e.g. "Created Panda · 7 parts · saved as template". Creating a project is not undoable, so Undo afterwards steps back the import only.
- New-project sheet, **cross-stitch and sewing** (wave E): a craft drop zone takes the crochet block's place ("🧵 Drop a cross-stitch PDF or .oxs file here…", "🪡 Drop a sewing PDF here…"; accept list from the registration's `importAccept`, default `['.pdf']`). It catches the file **unread** (`pdfDropZone({handOff})`), creates and opens the project exactly as Save would (an empty name takes the file's base name), then calls that craft's `openImportSheet(projectId)` with the file already in the importer's first drop zone, so the user gets the craft's own preview and confirm step. See `docs/CRAFTS.md`.
- Template editor and New project "Also save as a template" keep each part's `placementNotes`, `workMode`, `orientation` and `dialect` (wave E; they used to rebuild parts from name/count/text only), and the template is saved after the import, so it carries the project's flipped Rows/Rounds.
- Template editor: a part row whose `patternText` is non-empty shows a "Pattern attached" tag, the line count and an ✕ that clears the text. Renaming, reordering and saving never drop it; there is no textarea for it here.
- Settings sheet: new section **Templates** with a list (emoji, name, "N parts", "Built-in" tag) — tap to edit; "＋ New template" button.
- **Template editor sheet**: name, emoji grid (same as project), Rows/Rounds toggle, group size stepper, **Parts** list (each row: name input, make-count stepper 1–99, ✕ remove; "＋ Add part" button; drag not required but ▲▼ move buttons are), **Checklist** list (text inputs, ✕, "＋ Add item"), Save / Cancel, and for built-ins a "Reset to default" button (confirm), for user templates a "Delete template" button (confirm). Validation errors shown inline (toast is fine).
- Project overflow menu: **Save as template** → opens the Template editor pre-filled from `Store.templateFromProject`, so the user can tweak and save.
- Empty state text for user templates section when none: "Your saved templates will show up here."

## Crafts

The app serves more than crochet. A **craft** is a plug-in module in its own files
(`js/<craft>.js` pure logic, `js/app-<craft>.js` UI, `css/<craft>.css`) that registers
itself with the shell at script time. Crochet is the shell itself: it is never
registered, it is the default, and its code paths are untouched by any of this.

The full contract — file list, script order, `App.registerCraft(def)` and its `ctx`
helpers, `#screen-craft`, the ⋯ menu rules, `BlobStore`, `PdfText.open`,
`ctx.pdfDropZone` and `Tour.register` — lives in **`docs/CRAFTS.md`**. The data model
half of it is:

```js
Project.craft: 'crochet' | 'crossstitch' | 'sewing'   // default 'crochet'; every old save migrates to it
Project.craftData: object                              // opaque to the shell, owned by the craft module
Template.craft: 'crochet' | 'crossstitch' | 'sewing'   // default 'crochet'
Template.craftData: object | null                      // seed craftData for projects made from it (deep-copied)
Settings.crafts: { [craftId]: object }                 // per-craft settings shared across projects
```

All five normalise on load and on import, so a save written before September 2026 comes
back as a crochet project with `craftData: {}` and `settings.crafts: {}`. When no module
is registered for a project's craft id, its `craftData` is kept byte for byte, so a craft
file that failed to load never costs the user their work.

Store API: `Store.registerCraft({ id, normalize, summary, templates })` (called by the
pure-logic module at script time), `Store.crafts()`, `Store.craftDef(id)`,
`Store.templates(craft?)`, `Store.createProject({ craft, craftData, … })`,
`Store.updateCraftData(projectId, patchOrFn, opts?)` (the only door a craft writes project state
through — undo snapshot, mutate, touch, debounced save; with `opts = {undo: false}` (alias
`{undoable: false}`, wave F) it writes **view state**: no snapshot, no `updatedAt` / touch-day
bump, the same `save()` so revision / writerId and the multi-tab rules are unchanged; a view is
not a piece of work, and a pan must never fill the undo stack), `Store.summaryFor(project)`,
`Store.craftSettings(id)`, `Store.setCraftSetting(id, key, value)`. Craft built-in
templates re-seed on load and again whenever a craft registers late. Nothing added for
crafts runs on the crochet tap path.

Two optional `App.registerCraft` properties came in wave E: **`freeUpSpace(projectId, ctx)`**
puts a **Free up space** button on the quota banner while that craft's project is open
(cross-stitch publishes its switch to counts-only mode), and **`importAccept`** (default
`['.pdf']`; cross-stitch `['.pdf', '.oxs', '.xml']`) is the accept list of the craft drop zone
in the New project sheet. The shell's `ctx` also gains `preserveFocus(fn)` (see UX rules).
Wave F gives the node `ctx.pdfDropZone` returns `wrap.cancel()` and `wrap.signal()` (see "PDF
import"), and the cross-stitch and sewing enhancements are listed in `docs/CRAFTS.md`.

## Guided help (tours)

New file `js/tour.js` → `window.Tour`. A spotlight walkthrough engine plus declarative tour definitions. No dependencies.

```js
Tour.start(tourId, opts?)      // opts.onDone(); runs steps; Promise resolves when finished or skipped
Tour.stop()
Tour.list() → [{ id, title, blurb, seen: boolean }]
Tour.hasSeen(id) / Tour.markSeen(id)   // persisted via Store.settings().toursSeen (array of ids)
```
Engine: a fixed full-screen overlay that dims the page with a **cut-out** around the target element (use an SVG mask or four dim panels around the target rect; the target stays fully visible and CLICKABLE), an outline ring (`--accent-2`, 3px, `--radius-sm`) around it, and a small card (`--surface`, theme fonts) positioned below the target, or above when there is no room, clamped to the viewport with 12px margins; on phones the card may span the width. Card contains: step counter "2 of 7", title, 1–3 sentences, an optional "Try it: tap the button" hint, and buttons Back / Next (or "Done" on the last step) and a Skip link. Steps declare `{ target: selector|function → Element|null, title, body, tryIt?: string, before?: async fn (e.g. open a sheet, switch screen), placement?: 'auto'|'top'|'bottom', advanceOn?: 'click' }`. When `advanceOn: 'click'`, a real click/tap on the target advances the tour (and the app handles the click normally). Before showing a step: run `before`, scroll the target into view (`scrollIntoView({block:'center'})`), wait one frame, measure. Reposition on resize/scroll (throttled). A step whose target is missing is skipped. Escape = skip. Focus management: card gets focus; Tab stays within card. Respects `prefers-reduced-motion` (no animated spotlight moves).

Tours (write the copy warmly, short sentences, second person; every step teaches one thing):
- `home` "Around the home screen": New project button → project cards (what the summary line shows) → settings gear (themes live here) → finished shelf (mention statuses).
- `counter` "Counting a project" (requires a project open; if none exists, `before` creates a sample project "Tour sheep" from the Sheep template with a short amigurumi pattern on Body, e.g. `Rnd 1: 6 sc in MR (6)\nRnd 2: inc x6 (12)\nRnd 3: (sc, inc) x6 (18)\nRnd 4: (sc 2, inc) x6 (24)\nRnd 5-8: sc around (24)\nRnd 9: (sc 2, dec) x6 (18)`, opens it, and the final step offers "Delete the sample project" / "Keep it"): part tabs (tap to switch, tap again to edit; make-2 shows 0/2) → row counter and ± (rows vs rounds) → stitch button (`tryIt`: tap it three times; `advanceOn` not used, Next) → group readout and target (what `13 / 24` and `≈` mean, group size 0 = off) → pattern line (tap for the whole pattern, jump to a row) → Undo → Awake (keep screen on) → Alerts (buzz at stitch N) → Placing (placement notes) → timer chip → overflow menu (Import pattern, Checklist, Notes, History, Status, Save as template).
- `import` "Importing a pattern": `before` opens the Import pattern sheet for the open project (or the sample): textarea (paste straight from the PDF, mess is fine) → sections list (each becomes a part; edit names; make counts detected) → Create parts vs Put it all in → then closes the sheet; final step says where the pattern shows up and that ≈ means computed.
- `templates` "Templates and checklists": `before` opens Settings → Templates section (edit built-ins, reset, create your own) → then the project checklist (rename, reorder, reload from template) if a project is open.

Entry points (App): a **Help** item in the Settings sheet ("Help & tours" section: list from `Tour.list()` with ✓ for seen and a Replay/Start button each, plus 6 short FAQ answers: importing a pattern, what ≈ means, repeats, stitch alerts, group size 0, backups) and a **?** item in the project overflow menu that starts `counter`. First run: when the home screen is empty on first ever load (settings flag `welcomed` false), show a small welcome card in the empty state: "New here? Take the 2-minute tour" → starts `home` then chains into `counter` (sample project) then offers `import`. Set `welcomed` true regardless of choice. `Store.settings()` gains `toursSeen: string[]` and `welcomed: boolean` (migrate on load).

## PDF import (in-app)

New file `js/pdftext.js` → `window.PdfText`. Uses the vendored pdf.js 3.11.174 UMD build at `./js/vendor/pdf.min.js` (worker `./js/vendor/pdf.worker.min.js`), loaded lazily on first use via a dynamically inserted `<script>`; both files are precached by the service worker so it works offline. Everything runs on-device; no network besides loading the library.

```js
PdfText.extract(file, { onProgress(page, total), maxPages, signal })
  → Promise<{ text, pages, pagesTotal, chars, columnsDetected, emptyPages: number[] }>
PdfText.isAvailable() → boolean   // false when the library cannot load (offline first run without cache)
PdfText.SIZE_WARN_BYTES           // 25 MB — over this the app offers the first 20 pages instead
```
`signal` is `{ cancelled: boolean }` (or a real `AbortSignal`), checked at the head of each page; a cancelled read rejects with `err.name === 'AbortError'` and **the textarea is left untouched**.

The open-document API (crafts read text and rasterise pages from one load; wave E added `signal`
and `extract`, wave F the render cancel and `allowEmpty`):
```js
PdfText.open(file, { signal }) → Promise<handle>   // signal checked before the read, before and after
                                                   // the parse (a cancel during the parse destroys the
                                                   // document instead of handing it out), and for the
                                                   // life of the handle
handle = { doc, numPages, destroy(),
  textOf(pageNo) → Promise<string>,                // one page, no unicode folding
  extract({ onProgress, maxPages, signal, allowEmpty }) → Promise<extract() result>
                                                   // the WHOLE extract pipeline on this document,
                                                   // running-head pass, emptyPages, garbled, ocrNoise
  renderPage(pageNo, { scale | maxWidth, signal }) → Promise<HTMLCanvasElement> }
```
- **`allowEmpty`** (wave F): a text-free (scanned) PDF resolves instead of rejecting, with text that
  is only the page markers (`'=== PAGE 1 ==='`) and `emptyPages: [1]`, so a caller that also has the
  page images (a scanned cross-stitch chart) still gets its result. `PdfText.extract` and the default
  `handle.extract` still reject such a file.
- **`renderPage` cancels mid-page** (wave F). It honours its own `signal` and the one the document
  was opened with: checked before the call, again after pdf.js fetches the page, and every 40 ms
  during the draw, when it calls pdf.js's `renderTask.cancel()` and rejects at once with
  `AbortError` (pdf.js's `RenderingCancelledException` is mapped to `AbortError` too). The first big
  draw of a document does about 1.8 s of synchronous pdf.js setup that cannot be interrupted.
- **`ctx.pdfDropZone`** (wave F) passes its signal into `PdfText.open`, destroys a handle that
  arrives after a cancel, and on the `onPages` + `onText` route calls `handle.extract({signal,
  maxPages, onProgress, allowEmpty: true})` instead of looping `textOf` (so that route gets the
  running-head pass, `columnsDetected` and the 20-page cap too). The handle it gives `onPages` stays
  bound to the zone's signal; the returned node gains `wrap.cancel()` (stop the read and any render
  on that handle) and `wrap.signal()` (that signal, for a craft to pass on as `{signal}`). `emptyPages` lists the 1-based pages that carried almost no text — the drop zone says "Pages 12–20 had no readable text (they are probably images)." under the result line, never the word "failed" (06 #4).
Extraction rules (this is what makes the parser's life easy):
- Per page, group text items into lines by Y (tolerance 2.5 units), sort lines top→bottom, items left→right, join items with a space, collapse whitespace.
- **Column detection:** for pages with ≥ 12 lines, build the set of x-spans (start..end) of every item; if there is a vertical gap band ≥ 14 units wide located between 30% and 70% of the page width that no item spans, for ≥ 70% of lines, treat the page as two columns: emit all left-column lines (top→bottom) first, then all right-column lines. Same rule applied recursively at most once (3 columns max). Else emit single-column. Report how many pages were split in `columnsDetected`.
- Join fragments like `fi nished` / `stuf fi ng` (pdf ligature splits: a lone `fi`/`fl` token with spaces around it) back into the word.
- Insert `=== PAGE n ===` markers between pages (the parser treats them as notes).
- Drop lines that are only page furniture: pure page numbers (`3 of 6`, `Page 3`), `©`/`@ 20xx ... All Rights Reserved` lines, lines that are only single capital letters (photo labels).

Store: `Store.suggestChecklist(text) → [{ text, confidence: 'strong'|'weak' }]` (the objects are `String` wrappers, so old callers that treat them as strings keep working) — from the pasted/extracted text, collect imperative assembly steps: lines (or note paragraphs) in sections whose header is Assembly / Finishing / Construction / Sewing, plus any line anywhere that starts with `Sew`, `Attach`, `Stuff`, `Embroider`, `Weave in`, `Block`, `Insert (safety) eyes`, `Glue`, `Fasten off and sew`, `Join`, trimmed to ≤ 90 chars, de-duplicated, max 20. Uses `Patterns.parse` kinds/notes where helpful.

App (Import pattern sheet):
- A **drop zone** above the textarea: dashed border, icon, "Drop a pattern PDF here, or **choose a file**" (the whole zone is a button; `<input type="file" accept="application/pdf,.pdf">` hidden; on phones the button opens the file picker). Drag-over state highlights it. Accepts one PDF; non-PDF → toast "That isn't a PDF".
- Before reading: `Store.wouldExceedQuota` (see above) and, over `PdfText.SIZE_WARN_BYTES`, a confirm sheet "That's a 61 MB file · Reading it may take a while or run out of memory on this phone. Read the first 20 pages?" → `{maxPages: 20}`, after which the result line reads "Read 20 of 61 pages" (06 #6).
- While extracting: zone shows "Reading page 3 of 21…" with a slim progress bar and a **Cancel** button that flips `signal.cancelled`; the sheet stays usable. On success: textarea is filled (replacing content, after a confirm if the textarea already had text), a line under the zone says "Read 9 pages · 2 columns untangled · 4,120 characters" plus the empty-pages line when there is one, and the sections list refreshes as usual. On failure: toast with the reason ("Couldn't read that PDF (it may be scanned images)"); on cancel: "Import cancelled" and nothing else changes.
- **Sections detected** row meta names the target the import will set — "20 rows · **→ target 20** · counts found" — and a **Don't set targets** checkbox in the sections header passes `{noTargets: true}` to `Store.importPatternSections` (01 #1).
- A chip above the lists says "Looks like UK terms" when `Patterns.dialectHints(text)` reports `uk && !us`. Informational only: the arithmetic is identical (06 #3).
- **Checklist items found** block under the sections list: a checkbox per `Store.suggestChecklist(text)` result, **ticked for `confidence: 'strong'` and unticked (with a "· check this one" tail) for `'weak'`** — a suggestion this code had to reconstruct from two lines, or that only qualified by living in an Assembly section, is offered rather than assumed (01 #3). "Create parts" and "Put it all in…" both also append the checked items to the project checklist (skipping duplicates by text, case-insensitive), and the toast mentions "+ 6 checklist items".
- Home empty state and the New project sheet get a short line: "Have a pattern PDF? Create the project, then use menu → Import pattern to drop it in."
- The import tour gets a first step on the drop zone ("Drop the PDF from your pattern shop right here, or paste text below").
- The `sw.js` PRECACHE list gains `./js/pdftext.js`, `./js/vendor/pdf.min.js`, `./js/vendor/pdf.worker.min.js`.

## Themes contract

`css/themes.css` defines, for each `html[data-theme="<id>"]`, ALL of these variables. `css/app.css` uses only these (plus its own layout numbers). Defaults for `:root` (no attribute) must equal `stardew-spring`.

```
--bg              page background color
--bg-image        page background: a CSS `background-image` value (subtle SVG data-URI pattern, or `none`)
--surface         cards / sheets
--surface-2       nested surfaces, inputs
--text            main text
--text-muted      secondary text
--border          1px border color
--primary         main button bg (the big stitch button)
--primary-text    text on primary
--primary-glow    box-shadow color for pressed/active primary
--accent          secondary button bg (row button)
--accent-text
--accent-2        highlights, progress bar fill, active tab
--danger          destructive
--success
--radius          card radius (e.g. 18px; pixel theme uses 0)
--radius-sm       small controls radius
--shadow          card box-shadow value
--font-body       font-family stack
--font-display    font-family for big numbers + headings
--counter-size    font-size of the big row number (e.g. 96px)
--tap-border      border shorthand for the big tap button (pixel theme: 4px solid ...)
--header-bg       app header background (may be a gradient)
--header-text
--mascot          `url("data:image/svg+xml,...")` — a small cute theme mascot SVG (junimo, stardrop, pumpkin, night fury, red dragon, pixel dragon) used as decoration in the header/empty state. ~64px.
--overlay         modal backdrop color (rgba)
--color-scheme    'light' or 'dark' (app.css does `color-scheme: var(--color-scheme)`)
```

Theme ids and directions:
| id | name | group | vibe |
|---|---|---|---|
| `stardew-spring` | Pelican Town Spring | stardew | cream/soft greens/peach, wooden accents, junimo mascot, rounded, light |
| `stardew-night` | Stardrop Night | stardew | deep navy/purple, stars bg, stardrop-purple primary, dark |
| `stardew-harvest` | Harvest Festival | stardew | warm autumn: pumpkin orange, mustard, barn red, wood brown; pumpkin/leaf mascot, light |
| `dragon-fury` | Night Fury | dragon | HTTYD Toothless: charcoal/black surfaces, toothless-green (#7bd389-ish) accents, soft round shapes, plasma-blue glow, dark |
| `dragon-throne` | Fire & Blood | dragon | GoT/Targaryen: parchment bg, deep crimson primary, black + gold accents, serif display font, subtle scale pattern, light |
| `dragon-pixel` | Pixel Wyrm | dragon | 8-bit: pixel font (Press Start 2P), 4px hard borders, radius 0, hard offset shadows, limited retro palette, image-rendering pixelated, dark |

Google Fonts are allowed (loaded from `<link>` in index.html); every family must have a system fallback. Suggested: Nunito (body, stardew), Fredoka (display, stardew), Cinzel (display, throne), Press Start 2P (pixel), Quicksand (fury).

`js/themes.js`:
```js
window.Themes = [ { id, name, group: 'stardew'|'dragon', tagline, emoji, swatches: [bg, primary, accent, accent2] }, ... ]
```

## Celebrate API (`window.Celebrate`)

```js
Celebrate.play(themeId, { kind: 'project'|'part'|'piece'|'row' })   // returns Promise resolved when done
Celebrate.stop()
```
Creates a fixed, full-screen, pointer-events:none overlay (`<div class="celebrate">`) and removes it when done. `kind: 'project'` is the big one (2.5–3.5s): junimos hopping + confetti (stardew-spring), stardrops + shooting stars (stardew-night), leaves + pumpkins (stardew-harvest), a Night Fury flying across with plasma glow (dragon-fury), fire + falling embers with a dragon silhouette (dragon-throne), pixel fire + pixel dragon sprite (dragon-pixel). `part`/`piece` is a smaller 1.2s burst of the theme's particle. `row` is not used by default (returns immediately). Everything inline SVG/CSS/JS, respects `prefers-reduced-motion` (shortened, no large movement).

## Feedback API (`window.Feedback`)

```js
Feedback.init(settingsGetter)   // function returning { haptics, sounds }
Feedback.tap()      // stitch: 10ms vibrate, short soft click
Feedback.group()    // group boundary: [15, 40, 15], slightly higher tone
Feedback.row()      // row done: [30, 50, 30], rising two-note
Feedback.alert()    // stitch alert: [60, 60, 60, 60, 60], alternating tone
Feedback.done()     // part/project done: longer pattern, little arpeggio
Feedback.undo()     // brief low tone
```
Uses `navigator.vibrate` when present (Android), WebAudio oscillator sounds synthesized on the fly (no audio files). AudioContext is created lazily on first user gesture and resumed if suspended (iOS).

## Screens (App)

1. **Home** (`#screen-home`): header (mascot + "Stitchkeeper" + settings gear). Empty state if no projects ("No projects yet" + New project button). Active/paused project cards: emoji, name, status pill, summary of the active part, updated-ago, timer total. The crochet summary (wave E, `crochetPartSummary` in `js/app.js`) names the round being **worked** with its own target, in the piece's own word: "Body · Rnd 6 of 20 · 33/36 sts" ("of 20" only when the part has a target), "· piece 2 of 8" for a make-count, "Body · not started yet" for an untouched part, and "Body · done ✓ · 6 parts to go" (or "all 2 done ✓", "every part done") when it is finished. It used to pair the completed-row count with the next round's target ("Rnd 1 · 0/12"). `Store.summaryFor`'s crochet fallback is unchanged. Sewing: "step 4 of 6" in printed steps, "all 8 steps done" once finished. Tap card → open project. "Finished shelf" collapsible section listing finished/frogged projects. Floating "+ New" button.
2. **New/Edit project sheet**: name, emoji grid (🧶🐑🐄🐖🐔🐰🐉🐲🦖🐢🐙🐸🦊🐻🧣🧥🧸🌵🌙⭐), template picker (cards with emoji + part list preview; edit mode hides template), Rows/Rounds toggle, group size stepper (1–50), notes textarea. Save/Cancel. Delete project (edit mode; confirm).
3. **Project screen** (`#screen-project`): 
   - Header: back, emoji+name (tap → edit), timer chip (tap to start/stop; shows h:mm:ss), overflow menu (Parts, Checklist, Notes, History, Status, Export).
   - Part tabs: horizontal scroll chips; each shows name + `1/2` piece progress when makeCount>1 + ✓ when done. Last chip "＋ part". Tap active chip again → part editor. A chip is capped at `11em` and clips with `text-overflow: ellipsis`; the full name stays in the chip's `title` and accessible name, so a 2,000-character part name can no longer fill the strip and push "＋ part" out of reach (13 #10).
   - Repeat readout (if enabled): "Repeat 2 of 6 · row 3 of 4".
   - Big row counter: label "ROW"/"ROUND", number in `--font-display` at `--counter-size`, `–` and `+` buttons; progress bar + "12 / 40" when targetRows.
   - Pattern line: current pattern row's text (from `Patterns.lineFor(lines, patternRow)`); tap → opens full pattern sheet with the line highlighted and scrolled into view. Hidden if no pattern.
   - Stitch section: HUGE tap button (min 45vh on phones) showing stitch count; below it "Group 3 of 12 · stitch 4 of 10" and, if target, "24 / 30" with a slim bar. Actions row: `–1`, **⤢ 3D view**, "reset stitches" link. The 3D control is a labelled `.btn` in that row — **never inside the tap surface**, where it used to be a 44×44 corner hole that cost a stitch on a mis-tap, came last in the tab order and failed WCAG 1.4.11 in `dragon-fury` (2.53:1) and `dragon-pixel` (1.81:1). On `--surface-2`/`--text` it measures 9.9–12.5:1 in all six themes, and tab order is stitch button → `–1` → 3D view → reset (02 #8, 07 #7–#8).
   - Bottom bar: Undo, Keep awake toggle (sun icon), Alerts (bell, shows count), Placement notes (pin, shows if any).
   - Piece/part completed toasts: "Wing 1 of 2 done! Starting wing 2." Part done: "Body complete ✓". Project done → `Store.finishProject` + `Celebrate.play(theme,{kind:'project'})` + sheet "All parts done! 🎉 Assembly checklist →". When parts still block it (`Store.blockingParts`), the same sheet becomes "Finish <name>?", lists them and offers **Finish anyway** (`finishProject(id,{force:true})`); Settings → Project status → Finished takes the same route. A tap on an already-finished part toasts "Already finished — undo a row to keep counting", once per part per session.
4. **Part editor sheet**: name, make count stepper, target rows, repeat (enable, start, end, times), stitch alerts (comma list), placement notes, pattern text (textarea, monospace-ish, shows "Parsed: 24 rows, targets found" using `Patterns.summary`), Reset counts, Delete part (not if only one). Save asks first when the make count would throw finished pieces away: `Store.makeCountImpact(projectId, partId, n)` → `{piecesLost, piecesDone, makeCount}` drives a confirm "This part has 12 pieces done — drop to 2?" (13 #9).
5. **Pattern sheet**: full pattern with lines; current line highlighted; tapping a line with a row number jumps the counter to that row (confirm).
6. **Checklist sheet**: checkable items, "3 of 8 done", add item, ✕ delete, ▲▼ reorder, tap an item's text to rename it inline (Enter/blur saves, Escape cancels), "Clear completed" and "Clear all" (both confirm), and "Reload from <template>" (replaces the list with `Project.templateId`'s checklist; hidden when the project has no template or it no longer exists). Store: `renameChecklistItem`, `moveChecklistItem(projectId, itemId, delta)`, `clearChecklist(projectId, { completedOnly })`, `reloadChecklistFromTemplate(projectId)`.
7. **Notes sheet**: project notes textarea (autosaves).
8. **History sheet**: list of completed rows with time (newest first), "Clear".
9. **Settings sheet**: theme grid (6 cards with swatches, grouped Stardew / Dragon, current one highlighted; tap applies instantly), haptics toggle, sounds toggle, auto-advance toggle, Backup (wave F: "Last backup: …", **📥 Back up now** saves `thready-or-not-backup-YYYY-MM-DD.thready` via Blob + `<a download>`, the object URL kept 60 s; **📤 Share backup** where `navigator.canShare` accepts the zip; **📂 Import backup** reads `.thready` or `.json` — see "Backup file"), About/version.

Status change sheet: Active / Paused / Finished / Frogged with short explanations.

## UX rules
- Mobile first, 100dvh layouts, `env(safe-area-inset-*)` padding, `touch-action: manipulation`, `user-select: none` on tap surfaces, no 300ms delay, `-webkit-tap-highlight-color: transparent`.
- Big tap button: press-and-release counts. `pointerdown` takes pointer capture and shows the press state but counts nothing; `pointerup` counts one stitch if the pointer never moved more than 12px (`MOVE_TOLERANCE_SQ`), synchronously so it still feels instant. Move past the tolerance and the gesture becomes a **swipe that rotates the live 3D piece** (`handle.dragStart/dragMove/dragEnd`) and the lift counts nothing. Nothing is ever undone by the gesture. Keyboard activation (click with `detail === 0`) counts. Double tap on the button is two stitches, not a view reset.
- All state changes go through Store; App re-renders the current screen from state (simple `render()`; fine-grained updates optional for the counters to keep taps snappy).
- Sheets are bottom sheets on phones, centered dialogs ≥ 700px wide. Close on backdrop tap and Escape. `<dialog>` element is fine. `openSheet({subject})` names the project a sheet is *about*; `render()` closes any sheet whose subject no longer exists and says so, so deleting a project never leaves its editor floating over the home screen saving into nothing (13 #11). `openSheet({locked:true})` (the corrupt-state recovery only) hides ✕ and ignores Escape and the backdrop.
- Undo toast after destructive things (delete project → "Deleted. Undo" for 6s).
- Keep awake: `navigator.wakeLock.request('screen')` when toggled on AND project screen visible; re-acquire on `visibilitychange` visible. Hide toggle if unsupported.
- Theme applies via `document.documentElement.dataset.theme` and `<meta name="theme-color">` updated to `--header-bg` solid color.
- Accessible: buttons have aria-labels, focus-visible outlines, and one live region (`announce`, `ctx.announce` for the crafts) with **one announcement policy** in every craft (wave E): announce **milestones, never a single stitch** — a row/round done ("Round 5 done", in the piece's own word), a stitch group done ("Stitch 20, group 2 done"), a piece/part/project done, a colour done, a step done, a block or cut count moved, and every 50th stitch only where there is no grouping to mark it; "Working round 7" after a jump, "Back to round 5" after −1. Calls landing in the same 30 ms window are spoken together, not dropped.
- **Focus survives a rebuild** (wave E). `preserveFocus(fn)` (`ctx.preserveFocus` for the crafts) notes the focused element's key (`data-focus-key`, else id, else aria-label), runs `fn`, and if that element is gone focuses its replacement (or the first control in its row when the replacement is disabled). `render()` and the checklist use it.
- **No `showModal`?** `openFallbackSheet` paints the tint at z 150 (above the banners, under the tour), sets `aria-modal`, traps Tab, focuses the first control and restores focus on close. `App.__forceSheetFallback(true)` drives it for QA.
- **Short screens** (wave E). Below 860 px tall the stitch button floor drops to `max(20vh, 140px)` and the setup line clamps to one line; below 760 px the row card compacts (60 px number, 50 px ± buttons) and the instruction clamps to two lines (floor 120 px). Nothing overflows at 375×812 or 375×640.
- No external network calls except Google Fonts.

## PWA
- `manifest.webmanifest`: name "Stitchkeeper", short_name "Stitchkeeper", start_url "./", scope "./", display "standalone", background/theme colors, icons 192/512 (any + maskable).
- `sw.js`: precache app shell on install (`./`, `./index.html`, css, js, manifest, icons), cache-first for same-origin + fonts.googleapis/gstatic (opaque ok), network-first for `./index.html` navigation with cache fallback. Bump `CACHE_VERSION` on release; delete old caches on activate; `self.skipWaiting()` + `clients.claim()`.
- `index.html` has `<link rel="apple-touch-icon">`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style` = `black-translucent`, viewport `viewport-fit=cover`.


## Live 3D diagram

Goal: inside the big stitch button, show the piece being made as a **slowly rotating 3D model**, updated in real time as the user taps. A round-worked piece is a **stack of rings** (one ring per round, ring circumference = stitch count), which is a solid of revolution: sphere for increase-then-decrease, cone for a horn, tube for a body. Each stitch is a small bump on its ring, coloured by yarn. A row-worked piece is a gently curved sheet of stitch bumps. Colours come from the pattern (colour changes, colour prefixes, legends) or the user's yarn colour settings. The current round shows only the stitches tapped so far; future rounds from the pattern are faint wireframe ghosts. With no pattern, the model is built purely from what was actually tapped.

### Three work packages, three contracts

**1. Parser additions (`js/patterns.js`)**
```js
Patterns.colors(text) → {
  legend: { 'A': 'Almond', 'S': 'Sand' },          // from "( A = Almond )", "A = Almond", "MC = Main colour"
  names: ['Twilight','Almond','Sand','black','yellow','Color A','Color B'],  // every yarn colour name mentioned, first-seen order
}
Patterns.expand(lines, rowNumber, prevCount, state) → {
  stitches: [ { t: 'sc'|'hdc'|'dc'|'tr'|'inc'|'dec'|'sl'|'ch'|'bbl'|'puff'|'x', c: string|null } ],  // one entry per PRODUCED stitch; inc yields 2 entries (t:'inc'), dec yields 1 (t:'dec'); c = colour NAME or null (= row colour)
  color: string|null,          // the row's base colour name (state carried from previous rows), null if unknown
  height: number,              // 1 (sc/sl/x), 1.5 (hdc), 2 (dc), 2.5 (tr): dominant stitch of the row
  state: object                // opaque; pass back for the next row (tracks current colour, legend)
}
Patterns.colorHex(name) → '#rrggbb' | null
```
Rules: colour state flows row to row: `In Twilight :`, `In Color A`, `With MC`, `Using yellow` set the base colour (from notes attached to the row or header lines before it); `Colour change to black`, `change to Color B`, `switch to yellow` attached to row N sets the base from row N; `Fasten off Almond` ends a secondary colour; prefixes `A (Sc 5)`, `S (Dec x 12)`, `MC: sc 6`, `(in B) sc 3` colour just that group; `Rnd 5 (yellow): ...` colours the row. When a row cannot be evaluated but has a count, emit `count` × `{t:'x', c:null}`. Never throw; on any failure return `count` generic stitches. `colorHex` knows ~120 yarn colour words (black, white, cream, ivory, almond, sand, beige, tan, brown, chocolate, twilight → dark navy, navy, teal, sage, mint, forest, olive, lime, yellow, mustard, gold, orange, coral, peach, pink, blush, rose, red, burgundy, maroon, purple, lavender, lilac, plum, grey/gray, silver, charcoal, sky, baby blue, denim, turquoise, aqua, ...) and returns null for `Color A`, `MC`, `CC` and unknown words (the app maps those).

**`expand` v2** (waves B–D) returns one record per **ring position**, not per stitch:
```js
Patterns.expand(lines, rowNumber, prevCount, state) → {
  stitches: [ { t, c, h: number, w: number,       // per-stitch HEIGHT and WIDTH in sc units
                post?: 'front'|'back',            // FPdc / BPdc / Dcfp / FPtr … (wave E)
                lp?: 'blo'|'flo' } ],             // "in back loop only", "BLO", "tbl", "FRONT LOOP ONLY" (wave E)
  color, height,               // `height` is the round's dominant stitch, as before
  width: number,               // the round's total width — the sum of the w's
  inc: number[], dec: number[],// stitch INDEXES where the round increases / decreases
  deviation?: { printed, computed, delta },   // wave E: see "Wave E additions" under Patterns API v2
  state: object
}
```
`post` and `lp` are absent on a plain stitch, so a plain record is still exactly `{t, c, h, w}`;
`lp` goes on every non-chain stitch of a loop-qualified row ("join in both lps" is not one).
- `t` gains `'inc+'` (a 3-into-1 or larger increase) beside `'inc'` / `'dec'`, and longhand
  increases (`2 dc in the next st`) are read as increases rather than as two plain stitches.
- **Width by consumption.** A group worked into one anchor shares that anchor's width between its
  members (`shares`), so a shell and the chain space it sits in are the size they really are; a
  chain that closes into a loop spans its chord, not its length (`Patterns.LOOP_CHAIN_W` = 0.75,
  exported for the geometry owner). This is why a round can carry more records than its count.
- **Motif anchors** (§9b): how many corners, chain spaces and group-gaps the round **below** left
  is the only place a motif round's repeat count is written down, so `(3 dc, ch 3, 3 dc) in each
  corner sp` is expanded against the round below rather than guessed. Open-fill rows consume the
  row below.
- **Repeat back-references**: `Rnds 4-15: rep Rnd 3` re-reads the row it points at *here*, against
  the count this row starts from, so every stitch, increase position and per-stitch height comes
  out of that reading instead of a generic run. A row with no count anywhere cannot hold more ring
  positions than the row below did (its chain spaces would compound every repeat).
- UK dialect is honoured for **heights**, never for counts (see `Part.dialect`).

**Shape and document hints** (all pure, all null-safe, none ever throw):
```js
Patterns.startHint(lines) → { start: 'magic-ring'|'chain-ring'|'chain-oval'|'chain-row'|'unknown',
                              chainLen: number, ringCount: number }
Patterns.workMode(text)     → 'rounds' | 'rows' | null   // row/round markers, then vocabulary
Patterns.stuffingHint(text) → true | false | null        // null = the pattern never says
Patterns.dialectHints(text) → { uk, us, dialect: 'uk'|'us'|null, craft, tokens, … }
Patterns.gauge(text, forName?) → { stsPer10cm, rowsPer10cm, stsPer4in, rowsPer4in,
                                stitch, source, estimated }   // forName: a piece label in the tension box (wave E)
```
`workMode`: an `R`-labelled line that turns without a join is a row, and a part whose R lines
mostly do is `'rows'`; a joined-and-turned round stays a round (wave E).
`gauge` reads every house's spelling of the gauge box (`9 hdc and 6 rows = 4"`,
`Tension: 16 sts x 20 rows to 10 cm`, and the rows-less `12 dc = 4"`, finished off from the
stitch's own height and flagged `estimated`), converting 4 in and 10 cm properly rather than
treating them as the same swatch. It exists so **"work until it measures 59″" can become a row
count**: the pattern told you the rows two pages earlier. With no gauge anywhere, one sc row is
assumed to be 5 mm and everything derived from it is `estimated`.

**2. Renderer (`js/diagram.js`, `window.Diagram` v1.5.0) — 3D, WebGL**

**Model v2** (what `Store.diagramModel` returns; v1 — no `shape`, no `inc`/`dec`, no
per-stitch `h`/`w`, no `window`/`deviation` — still renders, it just gets rings instead of
polygons and a guessed cap):
```js
Model = {
  mode: 'rounds' | 'rows',
  rounds: [ {                      // in work order; index 0 = first round/row IN THE WINDOW
    count: number,                 // stitches this round will have (known or planned); 0 allowed
    done: number,                  // stitches completed so far (= count when finished)
    stitches: [ { t, c: '#hex'|null, h: number, w: number,       // per-stitch height/width in sc units;
                  post?: 'front'|'back', lp?: 'blo'|'flo' } ],    // a `ch` is a SPACE: h 0 (wave E; it used
                                   // to arrive as 1). `post`/`lp` pass through from `expand`, strings only
    printed: number|null,          // wave E: the printed total and the count its own
    computed: number|null,         // instructions make, both non-null only when they DISAGREE
    color: '#hex',                 // base colour for the round
    height: number,                // 1 = sc height (the round's dominant stitch)
    ghost: boolean,                // planned from pattern, not started
    inc: number[], dec: number[],  // stitch indexes where this round increases / decreases
    row: number,                   // 1-based WORK row this round draws
    outlier: boolean,              // the count is a wild outlier from its neighbours,
                                   // i.e. a line the parser misread. Never undefined.
                                   // `DiagramGeo` bridges it: no band, and it is left
                                   // out of the piece's width, height and aspect.
    truncated: boolean,            // `stitches` is a SAMPLE of the round, not all of it
                                   // (over `STITCH_DETAIL_MAX` = 999 records). The
                                   // `count` itself is never truncated.
    countless?: true,              // wave F: only on the WORKING round, only when nothing
                                   // sized it (no parsed count and no counter target), so
                                   // `count` is just the stitches tapped so far. Never
                                   // `false`, never on any other round. Follow mode does not
                                   // turn on it, and it holds the piece open (a countless
                                   // round is always "full", which used to read as finished)
  } ],
  current: number,                 // index of the round being worked
  defaultColor: '#hex',
  shape: { start: 'magic-ring'|'chain-ring'|'chain-oval'|'chain-row'|'unknown',
           chainLen: number|null, ringCount: number|null, stuffed: boolean|null,
           corners: 0|3|4|6|8,                      // polygon prior: how many corners
           cornersSource: 'sites'|'text'|null,      // measured increase sites, or the text
           upsideDown: boolean,                     // round 1 belongs at the BOTTOM
           upsideDownSource: 'part'|'text'|null,    // the chip, or the pattern's words
           dialect: 'uk'|'us'|null },               // resolved stitch-height dialect
  window: { first: number, total: number },     // rounds[0] is work row `first` of `total`
  deviation: { expected: number|null, actual: number },  // the pattern's count for the
                                 // working round vs the stitches tapped into it; `expected`
                                 // is null when the pattern never stated one
}
Diagram.mount(canvas, {
  palette: { ghost, ink, glow, alert, bg },
  reducedMotion, interactive: false,
  safeInsets: { top, right, bottom, left },   // CSS px the piece must stay out of
  onStatus: function ({ webgl, status, message }) {},  // 'ok'|'unavailable'|'lost'|'blank'|'restored'
  follow: false                     // wave F: the piece turns with the taps (see "Follow mode").
                                    // Default OFF in the renderer (the gallery and the demo are
                                    // unchanged); the app passes the setting, which is on
}) → handle
handle.setFollow(true|false); handle.getFollow()   // on: ease to the working stitch; off: a rows
                                    // sheet slides home and auto-rotate resumes after the pause
handle.setModel(model, { animate: 'stitch' | 'round' | 'none' })
handle.setPalette(palette); handle.resize()
handle.setSafeInsets({ top, right, bottom, left })
handle.isLive()                     // is there a working GL context on this canvas
handle.destroy({ release: true })   // `release` hands the GL context back (see below)
handle.setInteractive(true|false)   // drag to rotate, wheel/pinch to zoom, double-tap resets (the expanded viewer)
handle.resetView()
handle.dragStart(); handle.dragMove(dxCssPx, dyCssPx); handle.dragEnd()
    // host-driven rotation for a canvas that cannot take pointer events itself
    // (the one under the stitch button is `pointer-events: none`). Works with
    // `interactive` off, shares every line of the pointer path, so the button
    // and the viewer can never disagree about direction or inertia.
handle.getStats() → { webgl, status, lost, fps, frameMs, submitMs, buildMs, triangles,
                      drawCalls, chunks, verts, dpr, canvasPx, stitchPx, tex, contexts,
                      ghostAlpha: { ghost, pending, marker }, insets,
                      yaw, pitch, userPitch, zoom, fitScale, fitClamp, dragging, running, geo,
                      lod: { tier, name, segs, rows, px, switches, budget },   // wave E
                      holes,                       // chain-space slices opened as holes
                      alert: { wedgeFrom, … },     // first over-count slice drawn, −1 = none
                      bump: { …, relRelief, floor },    // relief range at the tier actually built
                      follow: { on, angle, front, target, animating, trophy, reason,   // wave F
                                userTurned, pan, key } }
Diagram._relief                     // test hook: the CPU relief builder, for the pure renderer tests
Diagram.follow                      // wave F: follow mode's pure maths, used by the renderer and tests
  .angle(index, count[, a0, aw])    // ring angle of the working point
  .yawFor(angle)                    // the yaw that puts that angle in front (angle − FRONT)
  .nearest(target, ref)             // target moved by whole turns nearest ref
  .step(prevYaw, index, count[, a0, aw])   // the yaw follow mode lands on
  .duration(deltaYaw)               // ms for a move (MS for one stitch, up to MAX_MS)
  .ease(from, to, elapsedMs, durMs, reducedMotion)   // reduced motion snaps
  .pan(xWork, xMin, xMax, halfVisible)    // rows: horizontal slide, 0 when the sheet fits
  .rotation(yaw, pitch)             // the camera matrix buildView uses
  .FRONT (π/2), .MS (150), .MAX_MS (420), .PAN_MS (180)
```
The renderer's `version` string is `'1.5.0'` as of wave F's follow mode (`'1.4.0'` was the wave E
relief rewrite). `js/diagram-geo.js` is unchanged at 1.4.0.
- **`getStats().follow`**: `angle` is the working point on its ring (radians from stitch 0), `front`
  the ring angle facing the camera now (yaw + π/2), `target` the unwrapped yaw it is easing to,
  `pan` the rows slide in world units, `trophy` whether a finished piece is turning, `reason` `''` /
  `'finished'` / `'no-count'`, and `key` the follow key (`'no-count'` on a countless round).
- **`frameMs` is the real frame time** — the wall-clock gap between two rendered frames while
  something is animating, with gaps over 100 ms (a throttled or hidden tab) dropped.
  **`submitMs` is the old `frameMs`**: the JS submit loop, which never waits on the GPU and
  read 0.12 ms at 57k triangles. Nothing may be called a frame budget from `submitMs` again.
- **Ghost alpha belongs to the renderer.** The host passes an **opaque** ghost colour; any
  alpha on it is dropped. `GHOST_ALPHA` (0.20, future rounds) and `PENDING_ALPHA` (0.72, the
  working round's unworked grid) are the only multiplication. Passing `rgba(--text, 0.35)` on
  top of them composed to **0.070** and made future rounds invisible in the app while the test
  page, which passes an opaque white, looked right (02 #1). `getStats().ghostAlpha` prints the
  composed numbers so this cannot regress silently.
- **Live GL contexts are capped.** A page gets a handful and the browser then drops the oldest
  without a word. Every mount registers; a new mount reaps the records whose canvas has left
  the document and releases the oldest past `MAX_LIVE` (3), telling that host through
  `onStatus`. `destroy({ release: true })` gives the context back through
  `WEBGL_lose_context` — pass it **only** when the `<canvas>` element itself is being thrown
  away, because a canvas whose context was lost can never be given another one.
- **`onStatus` makes the handle honest.** `mount` returns a handle whatever happens, so a host
  that only checked for null showed a silent empty rectangle. A refused context
  (`'unavailable'`, the Canvas-2D silhouette draws), a lost one (`'lost'`) and a frame that
  submitted nothing while the model has fabric (`'blank'`) all fire once per transition.
Implementation: raw WebGL 1 (chosen; no dependency, ~1 vertex + 1 fragment shader, vertex colours). Canvas 2D fallback (flat shaded silhouette) when WebGL is unavailable.

**2b. Geometry (`js/diagram-geo.js`, `window.DiagramGeo`) — pure, no WebGL, no DOM**

The layout maths lives here, not in the renderer, and `test/diagram.test.html` asserts it
directly. The physics is `docs/brainstorm/3d/01-geometry-truth.md`: `N_flat = 2πh/w` stitches
per round to stay flat, `dy = h·sqrt(1 − ((1−s)|dr|/h)²)` for the rise with stuffing slack
`s`, and `r = (sum of the round's stitch widths) / 2π` for the radius — so "+6 sc lies flat",
"no change is a cylinder" and "|dn| > N_flat ruffles" all fall out of one line. The old
`SH = 1.5` (wrong by 57 %) and the `asin(R/Rmax)` slope heuristic are gone, and so is the
per-round `BULGE` that made every horn a pinecone.
```js
DiagramGeo.classify(model) → { mode, rounds:[{ kind:'ring'|'polygon'|'oval'|'ripple'|'row',
    corners, radius, radiusMax, perimeter, y, yTop, h, ruffle, empty, prof, … }],
    slack, shape, closedTop, closedBottom, height, width, maxRadius, aspect,
    equatorFrac, equatorRound, corners, ruffles, anchor }
DiagramGeo.layout(model) → classify(model) + `bands`, one per round, ready to build:
    rounds: { rTop, rBot, yTop, yBot, reach, prof(θ,t), sig, kind, corners, ruffle, radMax }
    rows:   { rTop, rBot, yTop, yBot, reach, Rc, x0, width, anchor, sig }
    `prof` is a radius MULTIPLIER (polygon / stadium / ripple cross-section), null = a circle.
DiagramGeo.layout(model, { upsideDown })          // forces the orientation flip
DiagramGeo.fit({ rad, ymin, ymax, halfW, halfH, cp, sp, curY, mode,
                 purpose: 'button'|'viewer'|'gallery', finished, model })
  → { scale, base, clamp: ''|'radius'|'height', cy, radFrac, heightFrac,
      purpose, finished, letterbox }
DiagramGeo.arcSlices(prof, wt, n, a0Out, awOut)   // stitch width follows ARC LENGTH
DiagramGeo.classify(model, { terrace: false })    // wave E: terrace smoothing off, for comparison
DiagramGeo.loopSag, sitePositions, cornerGroups, LOOP, TERRACE, OPEN_TURN_IN   // wave E exports
DiagramGeo.version                                // '1.4.0'
```
Wave E adds, per round from `classify`: `radiusCount` (Σw/2π), `fan` / `fanShift`, `loop`, `kf`,
`terrace`; per piece: `terrace { applied, alpha, runs, rings, maxShift }` and `fans`. A round's
`radius` may now differ from Σw/2π on a fan ring and on a terrace corner, as the fillet's radial
ease already could; bands are still `rTop`/`rBot` from `radiusDraw`.
The renderer **consumes** `fit` rather than re-deriving it: `clamp: 'radius'` keeps a very long
thin tail from being cropped to a hairline, `clamp: 'height'` lets a 405-stitch row overflow
sideways with the worked row centred (`cy = curY`, which the ghost floor is not allowed to drag
off). `getStats().fitClamp` reports the clamp that actually bound the final scale, with
`+solid` appended when the ghost floor took over. `index.html` loads `js/diagram-geo.js`
**before** `js/diagram.js`, and `sw.js` precaches it.

**Two fit purposes, not one** (07 D2). `purpose: 'button'` (the default) is the piece being
**counted**: a 405-stitch row fitted to the width is a hairline, so the scale is pushed up until
the fabric fills `FIT_MIN_HEIGHT_FRAC` (0.40) of the height and the sheet overflows sideways with
the worked row centred — bounded by `FIT_MAX_WIDTH_FRAC` (1.5), so the silhouette overflows the
frame by at most half, never the 4.5× the wrap and 8× the throw were getting. `purpose: 'viewer'`
/ `'gallery'`, `finished: true`, or a model whose rounds are **all worked** is the piece being
**looked at**: letterbox it at its honest scale, so a rectangle is seen as a rectangle. A finished
piece letterboxes in the button too — there is no current row left to centre on. `purpose` /
`finished` / `letterbox` in the result say which policy ran, and the host passes the purpose
(`js/app.js` for the button and the viewer, the gallery page for itself).

**The geometry rules, and the constant each one is spelled with** (`js/diagram-geo.js` v1.4.0;
every constant is re-exported on `DiagramGeo` so `test/diagram.test.html` prints it):

| rule | what it does | constants |
|---|---|---|
| stitch metrics | one round's `perimeter` is the **sum of every stitch record's width**, not `count × SW` — a row may carry MORE records than its count (a chain space or a shell shares the width of what it is worked into), and clamping to `count` halved a mesh row. `h` is the **tallest**/dominant stitch of the round, or the width-weighted mean when no height owns half of it | `SW` 1.0, `SH_SC` 0.95, `STITCH_H` (hdc 1.34, dc 2.01, tr 2.68, dtr 3.35, sl 0.3, ch 0, bbl 1.68, puff 1.79), `STITCH_W` (sl 0.7, bbl/puff 1.15) |
| chains are spaces | a `ch` record reaches the geometry with **h 0** (the store's `diagramStitchH` no longer turns it into a 1-sc-high stitch); a chain counts for width, never for height | `STITCH_H.ch` 0 |
| radius | `r = perimeter / 2π`, floored | `R_MIN` 0.42, `RING_START` 0.30, `RING_START_FRAC` 0.34 |
| lace loops arch (wave E) | a run of `ch` records at `LOOP_W` (= `Patterns.LOOP_CHAIN_W` 0.75) is a loop; when loops are ≥ 10 % of the round's width the round reaches `anchor h + loopSag(n)/SH_SC` past the stitch that closes it, `loopSag = √(3c(L−c)/8)` (0.80 for a ch-3). Never lowers a round | `LOOP` |
| fan-and-fill (wave E) | a round past its own k-gon reach followed by one under `GRANNY_FLAT` of its reach, the pair landing within `GRANNY_FLAT`…`POLY_FLAT_TOL` of the combined reach, **shares its step by reach, and only the fan's ring moves (inward)**. The fan's surplus is scallop, not radius (Persian Tiles round 3's 4-dc fans), so round 4 steps out instead of standing up as a wall; the outer round keeps its own Σw, so the finished size does not move. Steady grannies and plain rings are never touched | `fanFill`, `POLY.grannyFlat`, `POLY.flatTol` |
| arc walk with slack | `dy = h·sqrt(1 − ((1−s)·abs(dr)/h)²)` — "+6 sc lies flat", "no change is a cylinder" out of one line. `s` is the stuffing slack | `SLACK` stuffed 0.35, firm 0.45, unstuffed 0.05, open 0.00, shaped 0.20, bowl 0.10; `DY_MIN` 0.02 |
| open-rim forms (`formOf`) | 01 §1.3 gives every open-rim piece slack 0, which is right for a doily and wrong for everything domed. The count sequence decides: increases → **≥ 2 straight rounds** → stop open = cup/dome/hat (slack `shaped`, or stuffed when the text says so); increases → stop open = flat disc/bowl (slack 0, the sqrt alone picks which); a small unstuffed piece that decreases a little = shallow bowl | `CUP_STRAIGHT` 2, `BOWL_MAX_ROUNDS` 8, `BOWL_MIN_END` 0.5, `FLAT_TOL` 0.85 |
| ruffle gate, slack-aware | a round frills only past the **slack-adjusted** flat rate. On a piece held out from inside, surplus up to 1.5× is pressed flat (a wide annulus, still a ring); a doily's picot round, with nothing pressing outward, still buckles | `RUFFLE_EPS` 0.08, `RUFFLE_RISE` 0.12, `STUFFED_FLAT_TOL` 1.5 |
| closure | one threshold for "the yarn was pulled shut", used by both `closedBottom` and `closesIn` | `CLOSE_COUNT` 9 |
| sphere-law dome loft | a magic-ring spiral is a dome, not a cone: each monotone run's rise is redistributed on `r = R·sin φ`, `y = R(1 − cos φ)` with the fabric's own arc, **keeping the run's total**, so every aspect in 01 §2 is unchanged and only the curvature is new. Blended in by slack | `LOFT.blendAt` 0.35, `LOFT.minRun` 2 |
| stuffed profile | three passes that move the profile and not one measured number: a **fillet** limiting the meridian's bend radius (rings move along `y`, borrowing height from the straight run and giving it back; a last-resort radial ease, never on the widest ring), a **wall bow** on the middle of a straight run — declared cosmetic, carried as `bow`/`radiusDraw`, never measured — and a **lid dome** giving a past-the-flat-rate run a shallow spherical sagitta instead of a tin lid | `STUFF.minSlack` 0.20, `filletBend` 1.2, `filletSpan` 2, `filletEase` 0.04, `filletKeep` 0.30, `wallBow` 0.05 (`wallBowMin` 3 rounds), `lidSag` 0.15 |
| terrace smoothing (wave E) | a 3-tap filter on the ring at each corner of a monotone run with ≥ `minTreads` treads of 1–`flatMax` straight rounds, so a `36,36,42,42,48,48` plateau body is a smooth ball, not a wedding cake (cato Head 43° → 30.5° worst turn). Strength `alpha` at full stuffing, `yarn` × that at slack 0. **Never moved:** the widest ring, run ends (a neck or a waist), ruffled / flattened / polygon / oval / granny / fan rounds (a hat brim, a flared rim) and text-prior motifs; a plateau longer than `flatMax` is a wall and is left to the fillet. Each run's rise is handed back, so height, width, aspect and equator are unchanged | `TERRACE` { `alpha` 0.5, `yarn` 0.5, `flatMax` 3, `minTreads` 2 } |
| open rim, silent stuffing (wave E) | a lace motif whose stitch **count** falls while its fabric (Σw) grows is open, not a shallow bowl; a 2+-round wall (`straight ≥ CUP_STRAIGHT`) is not a bowl either; an open piece that grows and turns back in to ≤ `OPEN_TURN_IN` of its widest with `stuffed === null` gets the stuffed slack ("Do not stuff" still wins); a round the store flagged `outlier` is not fabric in the form test | `OPEN_TURN_IN` 0.8 |
| polygon / oval / ripple classification | increase **sites** that cluster into a `k` give a k-gon cross-section; sites are placed by the **widths** of the records before them (`sitePositions`; identical to index/count for one-wide stitches). A *spread* increase (k even sites gaining under `minPerSite` each, i.e. "+6 sc per round") is a positive verdict for a **circle** and the text prior may not overrule it — but a round whose count fell, or whose increase groups hold a chain run (`cornerGroups`), is not a spread increase, and a spread round inside a text-prior motif gets `flatTol` before it may frill. The store mirrors both (`sitePlaces`, `cornerGroupCount`) | `POLY.ks` [4,6,8,3], `run` 3, `POLY_OCCUPANCY` 0.8, `minPerSite` 1.8, `sharpFlat` 0.75, `sharpSoft` 0.45, `RIPPLE_AMP` 0.06, `OVAL_MIN_END` 0.15 |
| text corner prior | `shape.corners` fills the rounds the sites cannot speak for, because `expand` returns no positioned `inc` for `(3 dc, ch 3, 3 dc) in corner sp`. Rounds 1–2 stay circular (the corners have not formed); the **k-gon flat rate** `kf = k·tan(π/k)/π` (1.273 for a square, 1.103 for a hexagon) applies to the whole walk, or a flat granny square ruffles; a prior round may run past that rate and still lie flat, because the text is independent evidence and the stitch height is the soft number | `POLY.priorKs` [3,4,6,8], `priorFrom` 2, `flatTol` 1.5 |
| granny flat rule | the other side of `flatTol`: three trebles worked into one chain space **fan out**, so a k-gon round growing at `grannyFlat` or more of its own flat rate is granny fabric — `dy = 0`, `granny: true`. Below it a piece may still cup (a bowl with stacked corners is a real bowl); above `flatTol` it still ruffles. Taken for the PIECE too (`grannyFabric`, the median over its k-gon rounds), so a motif's two circular opening rounds lie flat with the rest of the same fabric. A plain ring has `kf = 1` and is never asked | `POLY.grannyFlat` 0.55 |
| chain-ring opening | a round 1 worked into a small chain ring opens out from the **ring**, like a magic ring, not from its own circumference — guarded by `chainR < firstR` so a 240-chain cowl is untouched | — |
| outlier bridging | a round the store flagged `outlier` — or, absent the flag, a rows-mode row under `frac` of the running median of the rows before it — gets no band, joins the rows above and below, and is left out of the piece's width, height and aspect. Rows-only fallback, so a piece that grows from 3 stitches is safe | `OUTLIER.frac` 0.20, `minMedian` 8, `minBefore` 1 |
| tallest-stitch row height | a rows-mode row is as tall as its dominant stitch, from the same metrics as a round | `SHEET_CURVE` 3 (sheet bend radius, in widths) |
| orientation flip | `layout(model, {upsideDown})` — or `model.shape.upsideDown` — mirrors `y` about the piece's mid-height (the piece still occupies `[-height, 0]`) and swaps `closedTop`/`closedBottom`, because those name the piece's geometric **ends**. `shape.closedTop`/`shape.closedBottom` keep naming round 1's ring and the gathered close, which tells the renderer which BAND each cap belongs to. Rows mode already walks upward, so a sheet is unaffected | — |

- **Geometry, rounds mode**: ring i has radius `R_i = max(R_min, count_i * SW / 2π)` and sits at height `y_i = -Σ height_k * SH` (round 1 at the top; the piece grows downward). Between consecutive rings build a triangle strip. Each **ring position** occupies an angular slice — `n = min(max(count, records), 160)`, so a lace round's chain spaces and a compressed fan round each keep their own slices (wave E; it used to be `min(count, 160)`, which smeared Persian Tiles round 5's 80 positions into 20) and `done` maps onto slices by proportion. Each slice carries its stitch's relief (see "Stitch relief is geometry"). Vertex colour = stitch colour (or the round colour), per stitch, so colour work is crisp at stitch boundaries. Round 0/1 stitches (magic ring) = a small cap. The ring being worked: only `done` slices are solid; the remaining slices of that ring are drawn as a translucent wireframe **grid** in `palette.ghost` at alpha 0.72 (cells waiting to be filled), and every future round as a single bare **ring** at alpha 0.20 — a full grid on every planned round reads as a cage at button size. Close the top with a cap when round 1 is a magic ring; leave the bottom open (you see inside a tube slightly, which looks right).
  The stitch relief must be exactly zero on all four edges of its cell. Consecutive rounds have different stitch counts and different per-stitch amplitudes, so any relief left at the shared ring (or at a slice edge) makes neighbours disagree about the radius and hairline cracks of background show (the wave E builder's worst slice-to-slice gap is ~1e-15, asserted).
- **Rows mode**: rows stacked bottom-up as a sheet in the XZ plane tilted toward the camera, width = count × SW, row height by `height`; each stitch is a bump; odd/even rows offset half a stitch; current row partial from left (odd) or right (even); ghost rows wireframe. Gentle curvature (cylinder radius ≈ 3× width) so rotation shows depth.
- **Camera & motion**: perspective camera, slight downward pitch (~20°), and — with follow off ("Free spin") — auto-rotate around the vertical axis at ~12°/s (pauses for 1.5s after each model change or drag so the new stitch is seen, then resumes **from wherever the user left the yaw**), model auto-fit so the whole solid part (ghosts capped so they can't shrink the real piece below 45% of the view) fits with 8% margin; scale and camera distance ease over 200ms. `interactive`: pointer drag rotates (inertia), wheel/pinch zooms, double-tap resets. `reducedMotion`: no auto-rotate, no scale-in, no pitch return.
- **Follow mode** (wave F; the owner's request, and the app's default). Each stitch tap turns the
  piece so the stitch just made faces the viewer:
  - **Angle.** The working point's ring angle is `angle = 2π·index/count` for equal stitches; with
    the round's real slice layout (built bands carry `a0` / `aw`) it is walked through the slices,
    so a wide stitch turns the piece further and polygons follow arc length. Stitch 0 is at θ = 0
    and the point nearest the camera is at `yaw + π/2` at any pitch, so `yaw = angle − π/2`.
    10° per tap on a 36-stitch round; 36 taps make exactly one turn; the next round carries on from
    the seam with no spin back. Done stitches sit just right of the centre line, the unworked grid
    to the left (the work travels right to left, as under a right-handed hook); the working-round
    marker and the over-count wedge are band geometry, so they turn with the piece.
  - **Absolute, never accumulated.** The angle comes from the absolute stitch index; only the choice
    of turn (+2πk) uses history — the turn nearest the previous follow target, or nearest the
    user's yaw after a swipe, never the lagging yaw on screen (7 fast taps on 12 must land at +210°,
    not −150°). So Undo turns back one stitch, and un-tapping a row, finishing a row early, a jump
    from the pattern sheet and any Undo all re-aim without drift.
  - **Ease.** 150 ms (`MS`) for one stitch, up to 420 ms (`MAX_MS`) for a longer swing, sampled from
    `performance.now()` so a skipped frame never stretches it; **snaps under `prefers-reduced-motion`**.
  - **Swipe offset.** A swipe on the button or a drag in the viewer moves the piece freely; the angle
    the user leaves is kept (`userTurned`) until the next tap, which blends back to the working stitch
    the short way. Nothing snaps while a finger is down, and a recolour, a resize or opening the
    viewer never pulls back a piece the user just spun.
  - **No clock.** With follow on, auto-rotate is off in the button and the viewer; between taps
    nothing moves and nothing is drawn (the loop stops). A tap is a camera change only: `setModel`
    on the tap path costs one follow target and an ease, and **rebuilds no band** (0.14 ms per tap
    on a 2,394-stitch piece).
  - **Rows pan.** A rows-mode sheet faces the camera. When it is wider than the frame (the button's
    `clamp: 'height'` sheets), it slides (`Diagram.follow.pan`, 180 ms) so the working stitch stays
    centred, never showing empty space past the sheet's edge; a sheet that fits never moves.
  - **Trophy turn.** A finished piece (`fitFinished` or the model's own `finished`) turns at the old
    auto-rotate rate after the usual pause, still without the glow and the wedge; finishing starts
    the turn from wherever the last tap left the yaw.
  - **`countless`.** A working round that nothing sized does not turn (the work really does end at
    the seam, 2π·n/n); `getStats().follow.key` and `reason` are `'no-count'`.
  - The 2D fallback does not rotate.
- **Rotation direction (never invert this)**: the model follows the finger like a physical ball. Drag right → the surface nearest the camera travels right (`yaw += dx·k`); drag down → the near surface travels down so more of the *top* comes into view (`userPitch += dy·k`). `k = π / canvas CSS width`, i.e. a full-width drag is half a revolution at any canvas size. Verify on screen with an identifiable feature (a colour panel, the unworked arc of the current round), never from the matrices. Flick inertia is real pointer velocity, capped at 3.5 rad/s. The user's yaw is kept; the user's pitch eases back to the default over ~1.7s once the 1.5s pause is over, so the piece never sits stuck at an awkward angle.
- **Material**: a warm wrapped key light, a cool bounce fill, and a matte two-lobe sheen (broad `pow(N·H, 6)·0.10` plus a tight lobe at 0.008) tinted 65 % toward the yarn colour — wool scatters, so a white specular blob turns it to plastic, and with real relief every lobe of every V catches the key on its own (wave E lowered it from `pow(N·H, 7)·0.13`, tight 0.022, 50 %). At `high`/`full` and ≥ ~12 device px per stitch a ±4.5 % chevron striation follows the legs of the V (`uPly`, the twist of a plied yarn). A broad Fresnel in the **yarn's own** colour at 0.20 is the halo of stray fibres that says wool; the white Fresnel rim sits behind it at 0.18. Baked crevice AO at the slice edges (17%) and band edges (7%). Per stitch, seeded noise moves lightness ±7.5%, warm/cool ±4.5% and bump amplitude ±10%, which is the difference between "extruded plastic" and "crocheted". The **wrong side** of the fabric (`dot(N, V) < 0`, i.e. the inside of an open tube) is darkened to 42% and loses most of its rim — ramped, not stepped, or the silhouette speckles where interpolated normals cross zero.
- **Tone mapping, then the real sRGB curve** (02 #3). The lighting is linear and unbounded: the default cream's key term alone reached 1.03 and clipped to a hue-less white, while a dark red crushed to near-black over half the piece. A Reinhard variant with a 0.8 white point — `c = c(1 + c/0.64)/(1 + c)` — runs **before** the encode, the key's constant term is 0.22 (was 0.17) so dark yarns lift, and the encode is the exact piecewise sRGB curve rather than `pow(c, 1/2.2)`, because the CPU-side decode is exact and a mid grey has to round-trip. One hash dither of ±0.5/255 after the encode kills the `mediump` banding on the three dark themes. Verified on cream, black, white and a saturated red across all six themes.
- **Stitch relief is geometry, on detail tiers** (wave E; supersedes "fabric texture lives in the fragment shader", 02 #3/#22, 07 D9). Each stitch is a height field over its own cell — `u` across the stitch, `s` from its **base** (the round/row it is worked into) to its top loops, `uv.y = s` in **both** modes (rows-mode V's used to point the wrong way) — displaced along the smooth surface's normal, from a descriptor of the stitch record (`descOf`). An sc (and the top of every taller stitch) is **a V**: two plump legs meeting at the base, opening to the top, with the **braid of top loops** as a bar at `s ≈ 0.9`. `hdc`/`dc`/`tr`/`dtr` put the V in the top sc-height (`vf = 1/h`) over a **post** with **one diagonal wrap per extra yarn-over**; an increase's two V's lean into their shared base; `post: 'front'` stands +0.3 SW proud, `post: 'back'` sinks −0.2 SW (the basketweave checkerboard); `lp: 'blo'` leaves the round below's front loop as a **ridge** at the base, `lp: 'flo'` pulls the base in; `bbl`/bobble/popcorn/cluster are a welt 1.9×, `puff` 1.65× with ribs, `sl` 0.4×. A `ch` in a round ≥ 1.3 sc tall that also has real stitches (granny, lace, mesh) is an **open hole** — a beaded strand at the top of the space, open below, built from degenerate triangles so every slice keeps its index count and the `done` draw range, the over-count wedge and the stitch animation are untouched; anywhere else a `ch` is a strand with no hole. A stitch's height is floored at 0.3 before the wrap spacing is divided by it, so an all-chain round at h 0 is safe. The shading normal is the displaced grid's true normal, and crevice AO is baked from the relief (`AO_CAV` 0.30). Stamps are cached per (descriptor, tier, rows, direction).
  **Level of detail** (`LOD_TIERS`), picked from the projected stitch width (device px) of the **target** fit and the zoom with 15 % hysteresis, re-checked every frame and rebuilt only on a change: `low` 2×2 (the old bump, plus the painted shader V, kept **only** here) from 0 px, `mid` 4×3/4/5 (sc/dc/taller) from 3.5 px, `high` 6×5/7/8 from 9 px, `full` 8×7/10/12 from 16 px. `LOD_MAX`: the viewer may use `full`, the button and the gallery stop at `high`. `LOD_BUDGET` (vertices: viewer 160k, button 70k, gallery 60k) drops a tier when a piece would exceed it, so 60 × 60 is `high` in the viewer and `low` in the button, and a 400 × 160 window is 576k verts at `low` (960k at the old fixed 15 per stitch). Detail is chosen **per piece**, not per on-screen band.
  **Small rings.** The relief tiers' amplitude is `min(BUMP, max(RELIEF_FLOOR 0.12, BUMP_R_RELIEF 0.10 · r))`, so a 6-stitch tail keeps visible stitches (0.12 SW on r 0.95) without turning into a cog; the `low` tier keeps 06 #6's `min(0.20, 0.06·r)`. The fit's radius margin includes the round's own relief peak.
  The shader still cuts the inter-round **crease** at every tier (at 45 % where the geometry already carries one), and a round whose yarn differs from the round above it cuts its seam deeper (`uSeam`) — now at the base of the round/row in both modes — which is what makes a colour change readable at button size.
- **The working round is marked** (05 #3): both edges of the current band are drawn as a `palette.glow` line at alpha 0.60, with the depth test on so the ring wraps the piece. Consecutive bands share a ring, so the band above's ring *is* this round's top edge — no extra geometry. **Over-count** (05 #6): when `deviation.actual > deviation.expected`, the slices past `expected` render in `palette.alert` instead of confidently closing the ring; when the count is short, the unworked grid simply stays visible. The wedge (`wedgeFrom(model, current, finished)`) is **never drawn on a finished piece**, nor when `deviation.row` names a different row than the round `current` draws (a finished panda Body used to show an orange patch in its gathered close). The host derives `alert` from `--danger`, falling back to `--accent-2` where `--danger` is the button colour (dragon-pixel).
- **Grounding**: a soft elliptical contact shadow (a vertex-weighted disc, black premultiplied, drawn after the solids with `depthMask(false)`) sits on the plane where the finished piece will rest — the bottom of the whole model, which the ghost cage reaches down to — with the radius of the widest fabric that actually exists, clamped to the fitted radius so it can never be clipped. It fades in as the work grows down to that plane (`smoothstep(0.45, 0.92, grown)`) and fades out as the camera comes level with the piece, so it never appears when looking from below. Plain black, so it never clashes with a theme's `--primary`.
- **Animation**: `animate:'stitch'` → the newest bump scales in from 0 over 140ms with slight overshoot; `'round'` → the finished ring flashes once with `palette.glow`. Redraw only via requestAnimationFrame while something changes or auto-rotating; must stay ≤ 4ms/frame for 60 rounds × 60 stitches on a mid phone (cap 160 slices per ring; subsample beyond; the per-purpose `LOD_BUDGET` is the knob). A tap rebuilds nothing (per-band hash). Not yet measured on a phone GPU: wave E's desktop bursts gave `frameMs` 7.0 (420 px button, `high`) / 12.1 (60 × 60 viewer, `mid`) and CPU builds of 7–21 ms. DPR-aware, transparent clear colour so the button colour shows through.
- Deliver `test/diagram.test.html`: canvas + buttons for sample models (sphere 6→48→6, cone/horn, striped tube, bear head with a belly-panel colour run, a 30-row blanket), a "tap" button that advances `done` with animation, a "complete round" button, an interactive toggle, and a theme switcher for the background colour. Plus a **Gesture** panel: "Drag right/down" buttons that drive `dragStart/dragMove/dragEnd` in controlled steps and print yaw/pitch, a "Finish piece" button (the contact shadow only appears once the work reaches the ground plane) and a quadrant-coloured model whose four colour panels make the rotation direction unmistakable.

**3. App integration (`js/store.js`, `js/app.js`, `index.html`, `css/app.css`, `js/tour.js`)**
- `Part.rowStitches: number[]` (index = row number, 1-based; value = stitch count when that row was completed). `tapRow` records `part.stitch` (or the target when auto-advanced) before resetting; `untapRow` pops; `resetPart` clears; normalised on load.
- `Project.yarnColors: { [name]: '#hex' }` with reserved key `'*'` = main yarn colour (default warm cream `#f1e3c8`).
- `Store.diagramModel(part, project) → Model`: rows 1..max(part.row + 1, pattern maxRow, rowStitches.length); per row: if a pattern line exists → `Patterns.expand` (state carried row to row), colours resolved as `yarnColors[name] || Patterns.colorHex(name) || yarnColors['*']`; else if `rowStitches[row]` → that many generic stitches in the main colour; else if it is the current row → `count = max(part.stitch, target || 0)`, where `target` is the counter's own target for that row (`targetFor(part, patternRow)`, the number the readout shows, which also answers past the written rows from the repeat sentence; wave F), and with no target either the round carries `countless: true`; `done` from rowStitches / part.stitch; `ghost = row > current`. Cache per part (key: patternText, sizeIndex, yarnColors, row, rowStitches.length, `partWorkMode`) and on the tap path only mutate the current round's `done`/`count`. It returns **Model v2**: per-stitch `h`/`w`, `inc`/`dec` positions, the round's own `row`, `shape` from `Patterns.startHint`/`stuffingHint`, a `window` of rounds anchored to the round being **worked** (not to the end of the pattern), and `deviation`.
- **Rounds vs rows is a property of the PIECE** (05 #2). `Part.workMode: 'auto' | 'rounds' | 'rows'` (default `'auto'`, set through `updatePart`). `Store.partWorkMode(part, project)` resolves it in order: the owner's explicit `workMode`, then what `Patterns.workMode(patternText)` says, then `Project.countMode` as the tie-break. Everything that labels one part's counter goes through it — the ROW/ROUND caption, the pattern-line tag, the viewer readout — and so does `Store.diagramModel`. The part editor carries a **"Worked in: Auto / Rounds / Rows"** segmented control whose Auto row says what it resolves to for the text in the box right now ("Auto — this pattern reads as rounds."), and the 3D viewer carries the same three chips. One project-level word used to decide the shape of seven different pieces, and an amigurumi imported as `'rows'` modelled a tail that begins `R1: MR4` as a flat sheet.
- **The other two per-part resolvers, same pattern.** `Store.partShape(part)` builds the whole `Model.shape` — `Patterns.startHint` / `stuffingHint`, the corner prior (`sites` from measured increase positions, else `text`), the orientation verdict (`part` chip → the part's own text → null) and the dialect. `Store.partDialect(part)` resolves `Part.dialect`: the owner's explicit `'uk'`/`'us'`, else this piece's own text through `Patterns.dialectHints`, else whatever the imported document said. All of them are in the `diagramModel` cache key.
- **Terms: Auto / UK / US** (wave E) sets `Part.dialect` by hand: a field in the part editor after Worked in and Orientation (saved with the sheet, one Undo; Auto's hint reads the text in the box through `Store.partDialect` — "Auto — US terms from the pattern" / "…does not say; read as US"), and a third chip row "Terms" in the 3D viewer that writes at once and re-renders. An Undo moves all three chip rows in the viewer.
- **`Store.importPatternSections` reports `modeFlipped`** when every section reads as rounds and it moved the project off `'rows'`, and **`dialectSet`** (a count of parts) when `opts.text` — the WHOLE document — carried a dialect onto sections whose own text was undecided. A part whose `dialect` is already an explicit `'uk'`/`'us'` is never touched. The app says so once, in a toast: *"This pattern is worked in rounds — switched the project to Rounds"*. Nothing else in the UI would ever mention it, and the flip is the difference between a tail rendering as a tail and rendering as a blanket.
- **`Store.roundDeviation(part) → { expected, actual, row, delta, printed, computed }`** (05 #6): the pattern's count for the round being worked against the stitches actually tapped into it. `expected` is `null` when the pattern never stated one, and is never compared against a count the store invented. When `delta > 0` the counter shows one quiet inline line under the stitch readout — *"3 more than the pattern's 24"* — and the renderer draws the surplus stitches in `palette.alert`. Never modal.
  `printed` / `computed` (wave E) are non-null only when the round's printed total and the count its own instructions make disagree — the designer's slip, a different thing from the maker's over-count. `expected` stays the **printed** count: the pattern is quoted, never corrected. They come from `countCheck`, which reads the parser's `deviation` on the `expand` record, then on the parse line (then bare `printed`/`computed` on either); it deliberately does **not** fall back to the parse line's `stitches`/`computed` pair, because the parser leaves `computed` on rounds it could not evaluate exactly. Model rounds carry the same pair. The app says it in plain words (`countCheckText`): "Pattern says 36 · instructions add up to 24", in the deviation line under the counter (joined with an over-count by " · ", never on a finished piece) and as a small note under the 3D viewer's readout.
- **The piece gets its own region of the stitch button** (05 #1). `STITCHES`, a 90 px numeral and the `TAP` pill used to run down the exact centre of the button, which is exactly where a round-worked solid of revolution is: on the 6-round Ear the whole model sat behind the `STITCHES` pill. With the live diagram on, the caption and the number are one row pinned to the **top** of the button (`.stitch-head`, numeral at 0.68 × `--counter-size`), the hint is a hairline at the bottom that fades once the piece has been counted on, and everything between belongs to the piece. `js/app.js` measures that row and passes it as `handle.setSafeInsets({top, right, bottom, left})`, so the fit box is the free area rather than the canvas and the projection is shifted to centre the piece in it. The whole button stays the tap target, and without the diagram the old centred stack is unchanged.
- App: `<canvas id="stitch-canvas">` inside `#stitch-btn` behind the caption/number (absolute, inset 0, `pointer-events:none`; number/caption get a soft text shadow), `Diagram.mount` when the project screen renders, `setModel(..., {animate:'stitch'})` on the tap fast path, `'round'` on row completion, `setPalette` on theme change, `destroy` when leaving. The canvas is `pointer-events: none`, so the stitch button's own pointer handlers drive rotation through `handle.dragStart/dragMove/dragEnd` once the pointer passes the 12px tolerance (see "UX rules"); the handle is also parked on the canvas element as `canvas.diagram` so `getStats()` can be read from a console.
- **Long patterns do not mount the live canvas** (13 #5). `Store.diagramModel` rebuilds the whole piece whenever the row changes, and that build walks every row looking each one up, so its cost grows with the square of the pattern length: measured in the Browser pane, a completed row cost ~1,040 ms on a 1,500-row pattern (a sixth of a second was already visible at 500 rows) while a 60-row amigurumi stays under a millisecond. Stitch taps were always cheap — the model is cached — but a row tap froze the counter, which is the one interaction that must never stutter. So App will not ask for a live model past `DIAGRAM_MAX_LIVE_ROWS`, or for any build measured over 60 ms (remembered per part): the canvas inside the tap button is not mounted, `pushDiagram` is a no-op, and the piece is built only when the user opens the 3D viewer on purpose. **That real fix has landed** — `Store.diagramModel` builds a row → line index once instead of calling `lineForRow` inside the loop, and a 1,500-row pattern now builds in under 60 ms — so `DIAGRAM_MAX_LIVE_ROWS` is **2,000**. The measured-time guard and `partIsHeavy` stay as the safety valve for whatever the row count does not predict.
- A **⤢ 3D view** button in the stitch actions row (never inside the tap surface — see Screens) opens the **3D viewer sheet**: full-height canvas with `interactive: true`, the part name, round/stitch readout, and a Yarn colours button. Above the stage it shows **the resolved shape class and its size in stitch units** from `DiagramGeo.classify` — "Sphere · 15 rounds · 48 around", "Capsule · 42 rounds · 15 around", "Flat panel · 46 rows · 405 wide" — beside the **Auto / Rounds / Rows** chips that write `Part.workMode`, the **Auto / Top-down / Bottom-up** chips that write `Part.orientation` and the **Terms Auto / UK / US** chips that write `Part.dialect` (each set has a hint saying what Auto resolved to and why; all three stay in step with the store, so an Undo or a chip tapped in the part editor moves them). The shape line is filled synchronously, not on the canvas's first frame. The readout names a finished piece by its last round — "Rnd 20 · done", not "Row 47 · 0 sts" at 46/46 — and a finished piece's stitch readout says "All 20 rounds done"; the group readout gives the last group its real size ("stitch 3 of 6" in a 36-stitch round grouped by 10).
  **The shape names** (`shapeName` in `js/app.js`): rounds mode gives `Triangle motif` / `Square motif` / `Hexagon motif` / `Octagon motif` when anything knows the corner count (`shape.corners` or the geometry's own), then `Ruffle`, then by aspect and caps — `Bobble` / `Flat circle` under 0.38, **`Egg`** for a closed top over 1.2 (`Capsule` from 2.4), `Sphere` for a closed top from 0.9, `Sphere`/`Capsule` when both ends close, **`Dome`** for an open rim that shrank back in, `Cone` when it grew, `Tube` from 1.5, else `Bowl`. A dome is by definition squat, so "Dome" is left for the open-rimmed cups it describes and a 20-round closed-top piece is an egg (06 #12). Rows mode gives `Triangle` (a spine anchor), `Shaped panel` (a left/right anchor) or `Flat panel`. The detail line counts **the pattern's own rows and its widest real row**, not `model.rounds.length` and not `max(count)` — the working round the builder appends past the end used to turn "46 rows" into "47 rows · 406 wide" on completion (07 #7) — and appends "worked bottom-up" when the piece was actually drawn flipped. Opening the viewer **closes the button's GL context** and closing it rebuilds one, so the app never holds more than one context and repeated opens can never leave a blank canvas; if there is no piece on screen the stage carries a one-line footer ("Showing a simple outline — 3D isn't available right now") instead of a flat slab of `--primary`. Settings toggle **Live diagram** (default on; off removes the canvas), and directly under it (wave F) **"3D follows your stitches"** ("Each tap turns the piece so the stitch you just made faces you."), **default on**. It is stored as `settings.crafts.crochet.diagramFollow` through `Store.craftSettings('crochet')` / `Store.setCraftSetting('crochet', 'diagramFollow', bool)` — **absent means on**, only an explicit `false` turns it off — because `Store.setSetting` refuses keys `defaultState()` does not declare; in `js/app.js` everything goes through `diagramFollowOn()` / `setDiagramFollow(on)` (`DIAGRAM_FOLLOW_KEY`). It is a device preference, not part of the project, so it has no Undo. The ⤢ viewer's header has the same switch as one compact ↻ button between the readout and ✕ (`aria-label` / `title` "Turns with each stitch", `aria-pressed`, kept in step by `syncFollowButton()`); both move the live canvases at once. The app's `modelFinished` treats a `countless` round as not finished, like the renderer. New sheet **Yarn colours** (project overflow menu + from the viewer): Main yarn plus every name from `Patterns.colors` across the project's parts, each with `<input type="color">` and the resolved swatch; edits update the model live.
- Tour: one counter-tour step for the diagram, targeting `#stitch-3d` ("The piece inside the big button grows as you count. Tap 3D view to open it full size and spin it around."). It trims itself out when the button is absent.
- Bump `CACHE_VERSION`, precache `./js/diagram-geo.js` and `./js/diagram.js` (in that load order — `DiagramGeo` must be on `window` before `Diagram` reads it).
