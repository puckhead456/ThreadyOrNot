# Wave F — shell (backup container, drop zone, backup reminders)

Owner files touched: `js/zip.js` (new), `js/blobstore.js`, `js/pdftext.js`, `index.html`,
`sw.js` (PRECACHE list only), `test/backup.test.html`, `test/blobstore.test.html`,
`test/sw.test.html`, `test/pdftext.test.html`; inside `js/app.js` the storage/backup banner, the
export/import section, the ⋯-menu file entries, the Settings backup field, the backup FAQ
answer and `ctx.pdfDropZone`; inside `js/store.js` the backup/export/import section.
`js/tour.js`, `test/store-safety.test.html` unchanged.

## 1. `.thready` backup with page images (12 #4) and one-project files (12 #5)

**What the user sees.**
- Settings → Backup now reads **"Last backup: 3 days ago"** (today / yesterday / N days ago /
  never), then **📥 Back up now**, **📤 Share backup** (only where the browser can share a zip),
  **📂 Import backup**. The hint says a backup is one `.thready` file with every project,
  template and page image, and that Import reads `.thready` or an older `.json`.
- Back up now saves `thready-or-not-backup-2026-10-03.thready`. Toast: "Backup downloaded · 23
  page images". The "Last backup" line updates in place.
- Every project's ⋯ menu (crochet and both crafts) replaces "Download backup" with three
  entries: **📦 Send this project** (one-project `.thready`, `sleepy-sheep-2026-10-03.thready`,
  share sheet where the browser can share it, a download otherwise), **📂 Open a project file**
  (the same import as Settings), **📤 Back up everything**.
- Import accepts `.thready` and `.json`. The file is sniffed by its bytes (`PK\3\4`), never
  by name or MIME type. On iOS the picker has no `accept` filter, because iOS greys out an
  unknown extension. The preview sheet is the existing one. Changes:
  - the title is "Import this project?" for a one-project file
  - each project row adds "· 1 page image"
  - a line says "This file has N page images; each project you import brings its own back"
  - a JSON file gets "This is a JSON backup, so it has no page images; a project you already
    have keeps the ones on this phone"
  - unreadable images are counted ("2 page images in the file could not be read and will be
    left out")
  - the Keep-both note now reads "A “Keep both” copy gets its own copy of the page images"
- After Import the toast reads "Imported 1 project · 1 page image" with **Undo import**. Undo
  takes the images back out too, and puts back any local images the import replaced.

**The container** (documented in a block comment in the store.js backup section):

```
backup.json                 exactly Store.exportJSON() (or a one-project file in the same format);
                            importable on its own, forever
manifest.json               { format:'thready', formatVersion:1, scope:'all'|'project', app,
                              appVersion, writtenAt, backup:'backup.json', backupVersion,
                              counts:{projects, templates, images},
                              entries:[{path, key, type, bytes}] }
README.txt                  plain-words description
pages/<projectId>/<n>.<ext> BlobStore bytes as stored (jpg/png/webp/gif, else .bin);
                            the manifest maps each path to its BlobStore key
```

- Every entry is STORED (method 0) with CRC-32 and UTF-8 names (flag bit 11). The writer
  builds the output Blob from Blob parts. Each image is read once for its CRC and then handed
  on as its Blob, so a 40-page chart never sits in one ArrayBuffer.
- Reading rules:
  - backup.json is the truth.
  - A missing manifest, a missing `pages/` folder, a damaged image, an image for a project
    not in the file and a stray file are never errors. They are skipped and counted.
  - Without a manifest line, an image's key is worked out from the project's own craftData
    (`"p:<id>:<kind>:<n>"`).
  - A zip that was unpacked and re-zipped one folder down still works: the shallowest
    `backup.json` sets the root.
  - DEFLATE entries (an OS "Compress") are inflated with `DecompressionStream` where the
    browser has it.
  - Refused outright:
    - a zip with no backup.json (`noBackupJson`)
    - a damaged backup.json (`damaged`)
    - a manifest `formatVersion` above ours (`newerVersion`, same "update the app" text)
    - anything over 50 MB (`tooBig`, checked before a byte is read)
- **Which images go where** (`Store.importPages`, after `importJSON`):
  - **Replace/new with images in the file:** the local `p:<id>:*` images are moved aside
    (copied to `preimport:<key>`, then deleted only once the copy succeeded), and the file's
    images are written.
  - **Replace/new with no images in the file:** the local images stay (a same-phone restore, or
    a JSON backup).
  - **Keep both:** the clone's craftData blobKeys are rewritten to its new id (`importJSON`
    does this). The file's images are written under the new id. If the file has none, the
    local original's are copied there. The twins never share keys any more, so deleting one
    cannot strip the other's pages (the old code left the clone pointing at the original's
    keys).
  - **Skip:** nothing.
- **Undo:** the page snapshot lives in BlobStore (`preimport:*` plus a `preimport:__list` of
  written/saved keys), so it survives a reload just as the localStorage pre-import snapshot does.
  `undoImport()` stays synchronous and queues the page undo; `Store.pagesIdle()` resolves when
  it is done. A new import clears an older page snapshot first. All page work runs on one
  serial queue.
- A one-project export does **not** stamp `lastBackupAt` (it is not a backup). The full export
  does, through `exportJSON`.
- Fallback: when `window.Zip` is missing or the zip build fails, the backup buttons write the
  plain JSON file as before. That is still a backup.

**Contract (new API).**
- `window.Zip` (`js/zip.js`, loaded after blobstore.js, before app.js; in PRECACHE_URLS):
  - `write(entries, {date, type}) → Promise<Blob>`
  - `writeSync(entries, opts) → Uint8Array`
  - `read(bytes) → Promise<{entries:[{name, size, method, crc, data, crcOk, error, dir}]}>`
  - `parse(bytes)` (sync)
  - `isZip`, `crc32(bytes, [crc])`, `utf8`, `fromUtf8`
  - Error codes: `notZip`, `badZip`, `zip64`, `encrypted`, `tooBig`, `badName`, `badData`.
    A single bad entry never throws; it comes back with `crcOk:false` or with `error`
    (`compressed` | `damaged` | `unsupported`).
- `Store`:
  - `exportThready({projectId?, appVersion?}) → Promise<{blob, scope, projects, images, bytes}>`
  - `exportProjectJSON(id) → string|null`
  - `readBackupFile(File|Blob|ArrayBuffer|Uint8Array|string) → Promise<{kind:'json'|'thready',
    scope, text, pages:[{projectId, key, path, type, bytes}], skipped, manifest}>`
  - `previewImport(text, pages?)`: rows gain `pages` (count)
  - `importPages(pages) → Promise<{written, copied, skipped}>`
  - `pagesIdle() → Promise`
  - `backupFileProblem(bytes) → string|null`
  - `referencedProjectIds()`
  - constants `BACKUP_FILE_MAX_BYTES` (50 MB) and `THREADY_FORMAT_VERSION` (1)
  - `importJSON` is unchanged in signature and return value; it now records the per-project
    outcome for `importPages` and rekeys Keep-both clones.
- `BlobStore`:
  - `entries(prefix) → Promise<[{key, blob}]>` (one read transaction, sorted)
  - `putMany([{key, value}]) → Promise<count>` (one transaction, all or nothing)
  - `deleteKeys(keys) → Promise<count>`
  - `sweep(liveIds, {prefix='p:'}) → Promise<{count, bytes}>`
- `App.__importBackupFile(file)` and `App.__buildBackupFile(projectId?)` are QA hooks, in the
  same spirit as `__forceSheetFallback`.
- The import size cap moved from App's 25 MB (JSON only) to Store's 50 MB for both kinds.
  The message is "That file is 61 MB — a Thready or Not backup is never bigger than 50 MB, so
  it is probably not one." The quota pre-flight now measures backup.json's text, not the
  zip, because the images go to IndexedDB.

## 2. Drop zone: Cancel and the full extract (HANDOFF 6 and 14)

`ctx.pdfDropZone` passes its `{signal}` into `PdfText.open(file, {signal})`. A cancel during
the file read or the parse stops it there, and a handle that arrives after a cancel is
destroyed. On the `onPages` + `onText` route it now calls `handle.extract({signal, maxPages,
onProgress, allowEmpty:true})` instead of looping `textOf`, so cross-stitch gets everything
`onText` alone always had:
- the cross-page running-head pass
- unicode folding
- `emptyPages`, `garbled` and `ocrNoise`
- `columnsDetected`
- the 20-page cap from the big-file prompt (the old loop ignored it)

`allowEmpty` is a new `handle.extract` option in `js/pdftext.js`. A text-free (scanned) chart
resolves with `text: '=== PAGE 1 ===', emptyPages:[1]` instead of rejecting, so the
cross-stitch "This PDF is a scan… the chart pages are here" path still runs. `PdfText.extract`
and the default `handle.extract` behaviour are unchanged.

### 2b. Page renders cancel mid-page (coordinator follow-up, from the sewing agent)

`handle.renderPage(n, {scale|maxWidth, signal})` now has the same cancel contract as
`open`/`extract`. It honours its own `signal` and the signal the document was opened with:
- checked before the call
- checked again after pdf.js fetches the page (no draw starts)
- watched every 40 ms during the draw: on a cancel it calls the pdf.js
  `renderTask.cancel()` and rejects at once with `AbortError`, rather than waiting for the
  page. Before this change, with the pane hidden, the page never finished at all.

pdf.js's own `RenderingCancelledException` is mapped to `AbortError` too. A `{cancelled}`
object and a real `AbortSignal` both work.

`ctx.pdfDropZone`:
- The handle it gives to `onPages` stays bound to the zone's signal for life, so the zone
  can stop a render on it.
- New `wrap.cancel()` stops the read in progress and any render on that handle.
- New `wrap.signal()` returns that signal, for a craft to pass as `{signal}`.
- A craft's own Stop button should pass its own `{signal}` to every `renderPage`
  (cross-stitch `renderPages`, sewing's page loop).

Assertions in test/pdftext.test.html, new group "renderPage cancels mid-page", on bear.pdf:
- a cancel right after the call rejects with AbortError and no canvas
- a cancel 60 ms into a scale-5 draw rejects in about 90 ms
- an `AbortSignal` cancels a render the same way
- the `open()` signal (the drop zone's) cancels a render mid-page, in about 90 ms
- a later uncancelled render still draws; this one is skipped while the tab is not painting
  frames, because pdf.js draws on animation frames

The first big draw of a document does uninterruptible synchronous setup in pdf.js (about
1.8 s here), so the timed cases come after a small warm-up render.

Suites after this change:
- pdftext 96/0 (+1 skipped with the pane hidden; 97 with frames painting)
- backup 205/0
- sw 29/0
- xstitch.fixtures 493/0 (+9 skipped)
- the app boots with no errors and `pdfDropZone().cancel` exists

## 3. Backup reminders that work (13, 12 #1)

The home nag's button is now **Back up now**. It makes the `.thready` file, `exportJSON` stamps
`lastBackupAt`, and the bar re-renders away. The storage-quota banner's "Download backup" makes
the same file. Settings shows "Last backup: …" as above.

## 4. Small and real, from the 09/13 lenses

- **09 #10 orphaned blobs:** `BlobStore.sweep` plus `scheduleBlobSweep()` in App's boot wiring.
  - When: once per start, 8 s in, then on `requestIdleCallback`.
  - What: deletes `p:<id>:*` images whose id nothing references. "Referenced" covers the live
    list, every undo-stack entry (so a deleted project inside its undo window keeps its pages),
    the pre-import snapshot, and the raw state on disk (another tab's new project).
  - When it does nothing: an empty list, a corrupt store or a two-tab conflict.
  - Keys outside the `p:<id>:` convention and the `preimport:` snapshot are never touched.
  - It logs what it removed to the console; it does not toast.
- **sw.test:** a new assertion that every `<script src>` in index.html is in PRECACHE_URLS. A
  forgotten file only breaks a fresh offline install, which nobody tests.
- The download anchor's object URL now lives 60 s, not 1.5 s. A multi-MB backup could still be
  streaming to disk at 1.5 s.

## Verified in the pane (375×812, `localhost:8766`, own tab)

- **New project → Cross-stitch → `tmp-pdf/xs-tinymodernist-welcome.pdf`** went through the new
  `handle.extract` route: "Read 1 page · 238 characters", "Read the key cleanly — 6 colours",
  "80 × 57 stitches · 14 ct · 2 strands". All of it matches the PDF (DMC 725, 3609, 3801, 958,
  906, 905; "57h x 80w"; 14-ct; "Use 2 strands"). Import the key and pages stored
  `p:<id>:chartpage:0` (1400×1812 JPEG).
- **Settings → Back up now** (anchor click intercepted so nothing went to disk) produced
  `thready-or-not-backup-2026-10-03.thready`, 9.6 MB `application/zip`, 23 page images (the
  shared scratch store holds other agents' projects). "Last backup: never" became "today".
  The day buckets read "3 days ago" / "yesterday" / "today" at −3/−1/0 days.
- **Wiping:** I deleted the project and its images, then sent the file through Import. The
  preview read "Projects: 1 new · 5 already here", with the row "Cross-stitch · … · 1 page
  image". Import gave "Imported 1 project · 1 page image". The page decoded at 1400×1812 again.
  Undo import removed the project and its page and left no `preimport:` keys.
- **JSON-only:** the bare backup.json imported with the "This is a JSON backup…" line, and the
  project came back with its on-device page intact.
- **⋯ → Send this project** gave `xs-tinymodernist-welcome-2026-10-03.thready`, 623 KB, scope
  project, one project, one page.
- **Home nag** (forced due) read "Your work lives only on this phone. Save a backup → | Back up
  now | Not now". The click made the `.thready` and stamped the time, and the bar was gone
  after the re-render.
- **Drop-zone Cancel**, pressed right after the file went in: "Import cancelled", no preview,
  the zone back to idle.
- **Deviation from the brief:** I did not wipe the pane's whole storage. The dev server answers
  only `Host: localhost` (127.0.0.1 and `*.localhost` get 400), so there is no private origin.
  Clearing the shared localStorage/IndexedDB would have destroyed the other agents' scratch
  projects mid-task. I wiped my own project and its images instead. backup.test group 9 covers
  the true empty-phone import. Undo import does restore the whole state as of the import, so
  in the shared pane it may have rewound other agents' taps from that one minute.
- **Not checked:**
  - Screenshots: the pane was hidden (screenshots time out).
  - pdf.js page rendering also stalls while the pane is hidden, because `requestAnimationFrame`
    never fires. I shimmed rAF in my tab only (not in source) to render the chart page. This
    is environmental, not caused by this change.
  - Real share-sheet behaviour on iOS/Android was not exercised. Chrome's Web Share allowlist
    has no zip, so `canShare` is false there and the code downloads instead.

## Suites (final run, after the last edit)

Results (baselines in brackets):
- backup 205 (104)
- store-safety 226
- blobstore 65 (46)
- sw 29 (27)
- pdftext 96 (86); this is the count after 2b, plus 1 skipped while the pane is hidden
- templates 117 (94)
- crafts 124
- diagram-model 529 (521)
- patterns.fixtures 780
- xstitch.fixtures 493 (+9 skipped) (475)
- sewing.fixtures 789 (755)

All have 0 failed. templates, diagram-model, xstitch.fixtures and sewing.fixtures grew
because other agents added assertions during the wave. backup.test covers the asks:
- the round trip
- CRC (standard check value, chunked, a flipped byte caught)
- bad zips rejected (notZip, badZip, encrypted, duplicate or empty names)
- deflate read
- Blob-part writing byte-identical to `writeSync`
- the manifest and layout
- empty-phone import and undo
- replace with undo putting the local page back
- Keep both from `.thready` and from JSON
- partial pages, no pages folder, a re-zipped folder with no manifest
- no backup.json, a damaged backup.json, a newer format
- a BOM'd JSON
- the 50 MB guard message
- one-project export and re-import without duplicating

## What is left, and why

- No compression on write (the brief said none is needed). JSON is a small share of a
  backup with images.
- 12 #4's richer layout is not done: `projects/<id>/notes.md`, `chart.oxs`, per-template
  files and `settings.json` restored on request. The brief fixed the simpler layout; the
  reader keeps unknown entries harmlessly.
- Import still ignores the file's `settings` block (pinned in backup.test as a known gap).
- No "Share this template" (12 #5's second half).
- `persist()` status and storage usage are not shown in Settings (12 #12).

## For the docs agent (HANDOFF / SPEC / CRAFTS.md)

- **CRAFTS.md:** delete the paragraph starting "Caveat (as shipped): when `onPages` is given
  together with `onText`…". The route now runs the full extract (HANDOFF 6), and the drop
  zone's Cancel reaches `PdfText.open` (HANDOFF 14). Document:
  - `PdfText.open(file, {signal})` and `handle.extract({onProgress, maxPages, signal,
    allowEmpty})` in the `PdfText` line
  - that `onText` on the onPages route receives the full extract result, which can have empty
    `text` for a scanned PDF
- **HANDOFF:** items 6, 10 and 14 are done. Item 10 ("backup does not include page images") is
  fixed by `.thready`.
- **SPEC backup section:**
  - the `.thready` layout and reading rules above
  - the new Store/BlobStore/Zip API
  - `exportThready` stamps `lastBackupAt` only for a full backup
  - the 50 MB cap
  - Keep-both clones now get their own copies of the page images (replaces "and no page
    images, which the sheet says")
  - the nag button is "Back up now"
  - Settings shows "Last backup: …"
  - ⋯ menu: Send this project / Open a project file / Back up everything
  - the boot-time orphan sweep

## For the owner of `js/app-xstitch.js`

The import sheet's footnote now contradicts the app: "Chart pages are rendered as images and
kept on this device only; they are not in your backup file, so keep the PDF." Suggest: "Chart
pages are rendered as images and saved with the project; Back up now includes them."
(`openImportSheet`, the `xs-import-note` paragraph.) `js/app-sewing.js` may have the same kind
of sentence; I did not find one.
