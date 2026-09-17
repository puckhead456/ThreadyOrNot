# 09 — Engineering health, data safety, performance

Brainstorm lens: what can lose the owner's users their work, what can ship broken, what will
crawl on a £90 Android, and what makes the agent workflow slower or riskier than it needs to be.
Measured 2026-09-17 against `main` @ `1fba5cd` (cache v20).

---

## State of the codebase — measured

**Size.** 34,029 lines across `js/*.js` + `css/*.css`. `index.html` pulls **15 synchronous
`<script>` tags and 4 stylesheets**, all unconditional:

| file | bytes |
|---|---|
| `js/xstitch.js` | 174,664 |
| `js/app.js` | 173,149 |
| `js/app-xstitch.js` | 170,050 |
| `js/app-sewing.js` | 102,941 |
| `js/sewing.js` | 102,880 |
| `js/patterns.js` | 97,821 |
| `js/store.js` | 86,965 |
| `js/diagram.js` | 76,016 |
| `js/xstitch-photo.js` | 57,231 |
| `css/app.css` | 48,412 |
| rest (tour, pdftext, celebrate, blobstore, audio, themes, 3 css) | ~150,000 |

**Cold load** (`http://localhost:8765/index.html`, SW cleared, `tools/serve.ps1`, desktop Chrome):
20 resources, **1,261,781 bytes decoded**, DCL **128 ms**, load event **141 ms**. GitHub Pages
adds compression so the wire cost is roughly a third of that, but **parse + compile of ~1.15 MB
of JS is paid in full on every cold start**, including by someone who only ever counts crochet
rows. On top of that the service worker precaches `pdf.worker.min.js` (1,087,212 B) and
`pdf.min.js` (320,004 B), so **first install downloads ≈ 2.6 MB** before the app is offline-ready.

**localStorage.** Nine real crochet PDFs imported end-to-end (`PdfText.extract` →
`Patterns.splitSections` → `Store.createProject` + `Store.importPatternSections` + `flush`) moved
the store from 12,259 to **61,755 characters** — about **5.5 KB per crochet project**, **1.2 % of
a 5 MB budget**. Crochet, even with pattern text, placement notes and templates, is not the
quota story. Cross-stitch is: `XStitch.SIZE_BUDGET_BYTES` is the whole 5 MB and
`SIZE_WARN_BYTES` is 1 MB, and a single 500×500 chart is 250,000 cells.

**PDF text path.** `PdfText.extract` on crochet PDFs: 142–381 ms for 3–9 pages (largest,
`cardigan.pdf`, 22 pages / 17,538 chars: 273 ms). `Patterns.parse` on that text: **5–13 ms**.
The parser is not a performance problem anywhere.

**Grid reader**, `tmp-pdf/xs-pokemon-tl.pdf` (13.2 MB, 72 pages), desktop:

- `PdfText.extract` **3,210 ms**
- `XStitch.parseKey` **53 ms**
- `XStitch.extractGrid` **8,535 ms**, all on the main thread
- JS heap **19.6 MB → 69.8 MB** (+50 MB)
- result: 500 × 500, 250,000 cells filled, 105/105 colours matched, confidence 1, `Int16Array`
  of 500,000 bytes

So ≈ **12 seconds of a frozen UI and +50 MB of heap** on a fast desktop.

**Photo worker.** 900×1200 → 200 wide / 24 colours: **121 ms**. 2400×3200 → 300 wide / 40
colours: **96 ms**. Heap stayed at 10.6 MB. Worker source built from `String(fn)` is 28 KB.
This is the healthiest heavy path in the app; it is already off-thread, already cancellable,
already deterministic.

**Storage durability.** `navigator.storage.persisted()` returns **`false`** and
`navigator.storage.persist()` is **not called anywhere in the repo** (zero hits). Quota estimate
on this machine: 5.64 GB, usage 15.0 MB — of which **14.3 MB is `caches`**, i.e. fixture PDFs the
service worker swallowed while the fixture pages fetched them.

**Release discipline.** Walking every commit on `main`: **30 commits changed a precached asset;
13 of them (43 %) shipped with no `sw.js` bump.** Every push to `main` deploys.

**Good news worth keeping.** Zero `innerHTML` in `js/*.js` (one in `celebrate.js`, internal) —
the whole UI is built with `createElement`/`textContent`, so untrusted pattern text has no HTML
sink. Both `getDocument` calls in `js/pdftext.js` (615, 725) already pass
`isEvalSupported: false` and `disableFontFace: true`, which is exactly the mitigation for
CVE-2024-4367 in the vendored pdf.js 3.11.174. DOM ids and CSS classes are cleanly namespaced
per craft (`xs-`, `sw-`) with zero collisions. `BlobStore` never rejects. Craft modules write
state through exactly one door (`Store.updateCraftData`).

**Not so good.** 59 empty or comment-only `catch` blocks across `js/*.js`; **zero `console.error`;
no `window.onerror`, no `unhandledrejection` handler** — nothing anywhere records that something
went wrong. No CSP. No string table (~1,100 user-facing literals, three separate copies of
`plural()`, two `Intl` call sites in the whole app). No `.gitattributes` despite mixed CRLF/LF
(`app.js`, `patterns.js`, `store.js`, `tour.js` are CRLF; the rest LF — the 2026-09-16 UX commit
shows `js/xstitch.js` with 9,130 changed lines for what was a ~50-line edit).

---

## Proposals, ranked by risk-reduction × impact ÷ effort

### 1. Generate `CACHE_VERSION` from a content hash; gate the deploy on it
**Evidence** · 13 of 30 commits that changed a precached asset shipped with no `sw.js` bump
(`cac3e3a`, `221fb95`, `4d473cf`, `3cc3329`, `18bb984`, `f1d6d2e`, `1354230`, `58da15e`,
`b1e744f`, `9d2df25`, `fbee404`, `52af404`, `2f8fd84`). `sw.js:5` is a hand-typed `'v20'`;
`sw.js:118-133` `cacheFirst` **never revalidates**, so an installed user pinned to v17 keeps
being served v17 JS forever until some later commit happens to bump the constant. Three commits
in the log (`6fe8c70`, `2c96c89`, `cdfe14b`) exist only to retro-fix a forgotten bump — i.e. the
site was live and stale for installed users in between.
**Proposal** · `tools/cache-version.ps1` hashes every path in `PRECACHE_URLS` (plus `sw.js`
itself minus the constant line), writes `const CACHE_VERSION = 'h<8-hex>';`, and prints the
value. Wire it two ways: (a) a `.git/hooks/pre-commit` that runs it and re-stages `sw.js`; (b) a
`verify` job in `.github/workflows/pages.yml` that runs the same hash and **fails the deploy** if
`sw.js` disagrees. The hook can be skipped; the CI gate cannot. Belt and braces, because the hook
lives outside the repo and no agent will remember it.
**Effort** S · **Impact** 5 · **Risks** A content-hash version changes on every asset edit, which
is the point, but it means the "new version" prompt (#14) fires more often; make that prompt
quiet. The workflow needs PowerShell or a tiny `sha256sum`-based bash equivalent — the runner is
`ubuntu-latest`, so write the CI copy in bash and keep the PS one for the hook.

### 2. Stop swallowing `QuotaExceededError` — a failed save is currently invisible
**Evidence** · `js/store.js:814-821`:
```js
try {
  window.localStorage.setItem(KEY, JSON.stringify(state));
} catch (e) {
  /* quota / private mode — nothing useful to do */
}
```
Every write goes through this, debounced. If the quota is hit — most likely right after a
cross-stitch import, since `SIZE_BUDGET_BYTES` is the entire 5 MB — the user keeps tapping, the
counter keeps moving on screen, and **nothing has been saved since the last successful write.**
They find out when they close the app. "Nothing useful to do" is false: there is a great deal to
do, and doing it costs ten lines.
**Proposal** · `writeNow` returns a status. On failure: (a) set an in-memory `saveFailed` flag;
(b) fire a `Store.onSaveError` callback the shell subscribes to; (c) the shell shows a
non-dismissable banner — "Your last few taps are not saved. Free up space or download a backup." —
with **Download backup** and **Free up space** buttons wired to the existing `exportBackup()` and
to `XStitch.toCountsMode`; (d) retry once with the undo stack cleared, since `undoStack` is
in-memory and not the problem, but a re-serialise after `clearUndo()` is a cheap second chance.
Also add a pre-flight: if `JSON.stringify(state).length > 4.5 MB`, warn *before* the import lands
rather than after.
**Effort** S · **Impact** 5 · **Risks** The banner must not become noise in private-mode
browsers where every write fails; detect that once at boot (`setItem`/`removeItem` probe) and
show a different, calmer message.

### 3. Make backup import non-destructive
**Evidence** · `js/app.js:4244-4270` reads the file and calls `Store.importJSON` immediately —
no preview, no confirmation, no size cap. `js/store.js:2029-2040`: for each incoming project,
`if (existing) list[list.indexOf(existing)] = incoming; // imported wins`. Templates likewise
(`2014-2027`). Then `js/store.js:2044` `clearUndo()`. So: restore last week's backup to get one
deleted project back, and every project you have touched since is **silently reverted, with the
undo stack wiped in the same breath**. This is the sharpest data-loss path in the app and it is
one tap deep in Settings.
**Proposal** · Between parse and apply, show a sheet: "3 new · **2 will be replaced** (Ember the
dragon — last worked on today; Sundress — 2 days ago) · 1 identical", with **Replace them**,
**Keep both** (re-`uid()` the incoming ones) and **Cancel**. Take a full-state snapshot into a
second localStorage key (`stitchkeeper.v1.preimport`) before applying, and offer "Undo import"
for the rest of the session. Cap `file.size` at, say, 25 MB before `readAsText` so a wrong file
cannot hang the main thread.
**Effort** M · **Impact** 5 · **Risks** "Keep both" duplicates BlobStore keys' owning ids —
the re-`uid()`'d copy has no images. Say so in the sheet rather than trying to clone blobs.

### 4. Ask for persistent storage
**Evidence** · Zero hits for `navigator.storage` in `js/*.js`; measured
`navigator.storage.persisted() === false`. Without it, iOS Safari evicts all site data for a
**non-installed** PWA after 7 days of no use, and Chrome/Android evicts under storage pressure
in LRU order. The app's entire value is a months-long row count.
**Proposal** · At the first moment of real investment — not at boot, where the prompt is noise —
call `navigator.storage.persist()`. Good triggers: finishing a project's first part, importing a
PDF, or reaching row 20. Record the answer in settings. If it comes back `false` (Safari grants
it only on install), show a one-time card: "Add this to your Home Screen so iOS keeps your
counts" with the install instructions, and put a small "Storage: protected / not protected" row
in Settings next to the existing backup buttons. Pair with a nudge: if `persisted` is false and
no backup has been downloaded in 14 days, a gentle prompt.
**Effort** S · **Impact** 5 · **Risks** Chrome may show a permission prompt; only ask once, and
only after the user has something worth keeping. Never block anything on the answer.

### 5. Move the grid reader off the main thread and cap its appetite
**Evidence** · Measured above: `extractGrid` on `xs-pokemon-tl.pdf` = **8,535 ms of unbroken
main-thread work** and **+50 MB of heap**, after 3,210 ms in `PdfText.extract`. `js/xstitch.js:4235`
`extractGrid(doc, pageNo, opts)` walks operator lists in page context; pdf.js does its parsing in
its worker but hands everything back to the page. On a low-end Android (4–6× slower CPU, and
Chrome's per-tab heap budget well under 512 MB) that is **a minute of a locked UI and a real
chance of the tab being killed** — which on this app means the import is lost with no record of
why. HANDOFF already flags the 0.4–8.3 s range as acceptable; it is acceptable on the desktop it
was measured on.
**Proposal** · Three steps, in order of value: (a) **yield between pages** — an `await new
Promise(r => setTimeout(r, 0))` per tile page keeps the progress UI alive and lets `Stop` work,
which it currently cannot during the 8.5 s; (b) **hard budget** — if `doc.numPages > 40` or the
estimated cell count > 150,000, offer image-only mode up front instead of after the fact;
(c) **move the operator-list walk into a Worker** the way `xstitch-photo.js` already does
(`_workerSrc`, 28 KB from `String(fn)`) — the pattern is proven in this codebase and the grid
reader's inner loop is pure array maths. Free the `doc` and drop intermediate tile buffers as
each page completes; 50 MB for a 500 KB result says almost nothing is being released.
**Effort** L · **Impact** 4 · **Risks** The Worker cannot hold the pdf.js document; it would
receive per-page operator-list arrays as transferables. That is a real refactor of `_grid` and
needs the 7 KG-Chart fixtures green before and after — which is exactly what the fixture suite is
for. Do (a) and (b) first; they are hours, not days, and they remove the worst of the freeze.

### 6. A local error log and a "copy diagnostics" button
**Evidence** · 59 empty `catch` blocks; **zero** `console.error`; no `window.onerror`; no
`unhandledrejection` listener. `js/store.js:1507-1511` even swallows a throwing craft mutator by
design. When a user says "it went blank", there is nothing to look at — and the owner's hard rule
(no per-user costs, no tracking) rightly forbids Sentry.
**Proposal** · `js/errlog.js` (~80 lines, one global, precached): a ring buffer of the last 50
entries `{t, where, message, stack}` in its own localStorage key with a hard 32 KB cap, fed by
`window.onerror`, `unhandledrejection`, and an exported `ErrLog.note(where, err)` that the
existing `catch` blocks call instead of `/* ignore */`. Settings gets **Copy diagnostics**: app
version (= `CACHE_VERSION`, once #1 makes it meaningful), `navigator.userAgent`, storage estimate,
`persisted`, project/part counts, craftData sizes, and the ring buffer — copied to the clipboard
as text the user can paste into an email. No network, no cost, no tracking.
**Effort** M · **Impact** 4 · **Risks** Diagnostics must not leak pattern text (copyrighted) or
project names; log shapes and sizes, never content. The ring buffer itself consumes quota — cap
it hard and drop it first when #2's pre-flight trips.

### 7. Headless test runner in CI, and a gate in front of the deploy
**Evidence** · 12 test pages, 2,725+ assertions, **all run by hand in a browser**. Every one
writes `passed + ' passed, ' + failed + ' failed'` into `#summary` and `console.log`s it
(`test/patterns.test.html:1208-1212`) — a machine-readable contract already exists. Meanwhile
`.github/workflows/pages.yml` has **no test step at all**: `checkout` → `upload-pages-artifact` →
`deploy-pages`. Push to main is deploy, unconditionally. And there is no node/npx on the owner's
machine, so this can only live in CI.
**Proposal** · `.github/workflows/test.yml`: `ubuntu-latest`, `npx playwright install --with-deps
chromium`, serve the repo with `npx serve`, then a ~40-line script that visits each **synthetic**
page (`patterns`, `templates`, `crafts`, `blobstore`, `xstitch`, `xstitch-photo`, `sewing`), waits
for `#summary` to be non-empty, parses the two numbers, prints a table, and exits non-zero if any
`failed > 0` or any page threw. The fixture pages skip automatically (`tmp-pdf/` is gitignored,
and `fetchBlob` already returns null → `skip`). Make `pages.yml` `needs: test`. Add the
`CACHE_VERSION` check from #1 to the same job.
**Effort** M · **Impact** 4 · **Risks** Playwright's Chromium is not the owner's phone; keep the
manual 375×812 pass for anything visual. The `xstitch-photo` page has a drop-a-photo QA panel —
its assertion count must be stable without one. Budget a CI run at ~3 min; `xstitch.test.html`
alone is 107 KB of assertions.

### 8. Replace the literal control bytes that make `rg` skip the two biggest craft files
**Evidence** · `js/xstitch.js:2859` contains a **raw `0x00`** inside a string literal
(`entry.brand + '\0' + entry.code…`, written as an actual NUL byte); `js/sewing.js:130`, `647`
and `1036` contain raw `0x01`/`0x02` (`var LEADER_MARK = '\x01';`). Ripgrep therefore classes both
files as binary: `Grep` for `function extractGrid` across `js/` returns **"No matches found"**
even though it is at `js/xstitch.js:4235`, and `git grep`/`file` agree. **Every agent that greps
the codebase gets silent false negatives on the two largest craft modules** — 277 KB of logic that
searches simply do not see. This is invisible and it has almost certainly already cost rework.
**Proposal** · Replace the literal bytes with escape sequences — `' '`, `''`,
`''` — which are byte-identical at runtime and make both files plain text again. Six edits.
Then add a `tools/check-text.ps1` (and a line in the CI verify job) that fails if any tracked
`js/`/`css/`/`html` file contains a byte in `[\x00-\x08\x0b\x0c\x0e-\x1f]`.
**Effort** S · **Impact** 4 · **Risks** None at runtime. Touching `xstitch.js`/`sewing.js` means
those files' owners in the parallel-work map need to be idle; do it between agent rounds.

### 9. Bound the undo stack by bytes, not by entries
**Evidence** · `js/store.js:15` `UNDO_CAP = 50`; `js/store.js:912-922` `snapshot()` does
`deepCopy(proj)` — a full `JSON.parse(JSON.stringify())` of the **entire project including
`craftData`** — and `js/store.js:1501` puts one on *every* `updateCraftData` call, which is the
single door every craft write goes through. A 500×500 cross-stitch chart is a 500 KB `Int16Array`
plus packed bitmaps; 50 snapshots of a project like that is **tens of MB of heap that never
shrinks while the project is open**, on top of the +50 MB the import already cost (#5). On a 2 GB
Android this is how the tab dies mid-project.
**Proposal** · Keep the entry cap but add a byte cap: track a running total of
`JSON.stringify(entry.data).length` and shift until the stack is under ~2 MB — so 50 crochet
snapshots (5.5 KB each) still fit comfortably, while a big chart keeps 3 or 4. Better still for
the hot path: for pure counter taps, store a **field-level delta** (`{partId, row, stitch}`)
rather than a whole-project copy, and reserve `deepCopy` for structural changes (delete part,
import sections, apply template). Add a `Store.undoBytes()` for the Settings storage row and for
the diagnostics dump in #6.
**Effort** M · **Impact** 4 · **Risks** A mixed delta/snapshot stack is easy to get subtly wrong;
`test/crafts.test.html` (124 assertions) covers the `updateCraftData` door and must grow undo
cases alongside.

### 10. Sweep orphaned blobs
**Evidence** · `js/app.js:2274-2302`: blobs are deleted `DELETE_UNDO_MS + 400` = **6.4 seconds
after** the project is deleted, fire-and-forget. Close the tab, background the PWA, or lose the
process inside that window and the images are stranded forever — nothing ever reconciles
`BlobStore.keys()` against live project ids. `js/blobstore.js` has `keys(prefix)` and `usage()`
but no caller does the diff. Cross-stitch caps chart pages at 40 per project; sewing renders every
page it is asked to. Measured `indexedDB` usage on this scratch profile: 679,936 bytes with
almost no real projects in it.
**Proposal** · `BlobStore.sweep(liveProjectIds)` — list keys, take the `p:<id>:` segment, delete
anything whose id is not in the live set. Run it once per app start, idle-scheduled
(`requestIdleCallback`, fall back to a 3 s timer), and again right after a backup import (#3),
which can orphan a whole project's images by replacing it. Surface the recovered bytes in the
Settings storage row rather than a toast.
**Effort** S · **Impact** 3 · **Risks** A project mid-creation has an id not yet in `state` —
sweep only ids older than the session start, or have `createProject` register the id before any
blob write.

### 11. Content-Security-Policy meta, and shrink the external surface
**Evidence** · `index.html` has no CSP. External origins: `fonts.googleapis.com` and
`fonts.gstatic.com` (the only non-`self` requests in the measured resource list — the Google
Fonts stylesheet is 14,194 B). The app renders text extracted from PDFs the user downloaded from
strangers on Etsy. Today that text can only reach `textContent` (zero `innerHTML` anywhere, which
is genuinely good), but nothing *enforces* that, and `js/app-xstitch.js:3571` does
`w.document.write(html)` into a popup for the printable chart — a document built by
`XStitch.printableHTML` from chart titles and floss names that came out of a PDF.
**Proposal** · Add a `<meta http-equiv="Content-Security-Policy">` with
`default-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline';
font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:;
script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self';
object-src 'none'; base-uri 'none'; form-action 'none'`. The `'unsafe-inline'` for scripts is
needed by the SW-registration block at `index.html:212-221` — move that into `js/themes.js` (first
script, already precached) and drop it. Separately: audit `printableHTML` for a single escaping
helper applied to *every* interpolated string, and self-host the five font families, which also
removes the last network dependency from an app that advertises itself as offline.
**Effort** S · **Impact** 3 · **Risks** A too-strict CSP breaks the blob-URL print fallback and
the photo Worker; test both. Self-hosting fonts adds ~200 KB to the precache — worth it, but do it
as its own commit so the `CACHE_VERSION` story stays legible.

### 12. Record and plan the vendored pdf.js version
**Evidence** · `js/vendor/pdf.min.js` is **3.11.174** (Sept 2023), vendored 2026-09-14 — about
three years stale. The good news, verified: both `getDocument` calls (`js/pdftext.js:615`, `725`)
pass `isEvalSupported: false` and `disableFontFace: true`, which is exactly the mitigation for
CVE-2024-4367 (FontMatrix → arbitrary JS, fixed upstream in 4.2.67), and **no other file calls
`getDocument`** in the shipped app. The gap is process, not a live hole: nothing records which
version is vendored, why, or when it was last checked. One exception —
`test/xstitch.fixtures.html:500` calls `window.pdfjsLib.getDocument({data: buf})` **without**
those options, so the fixture harness runs untrusted PDFs with eval enabled.
**Proposal** · `js/vendor/VENDOR.md`: library, exact version, SHA-256 of both files, download
date, download URL, the list of options the app must keep passing and why. Add the fixture page's
`getDocument` call to the same options. Put a calendar item (or a line in HANDOFF's "what's left")
to check the pdf.js security advisories each release, and plan a move to 4.x — the 11-chart
fixture suite is the regression net that makes that upgrade a day rather than a week.
**Effort** M · **Impact** 3 · **Risks** pdf.js 4.x is ESM-first and drops some legacy APIs; the
UMD `legacy` build still exists but the worker contract changed. Do it behind the fixture suite
and on its own branch, not during a feature round.

### 13. Generate `PRECACHE_URLS` instead of hand-maintaining it
**Evidence** · `sw.js:8-37` is a hand-written list. It already drifts: `icons/icon.svg`
(referenced at `index.html:13`) and `icons/icon-maskable-512.png` (the manifest's maskable icon —
the one Android uses for the installed launcher) are **both missing**. Neither breaks anything
online, because `cacheFirst` falls through to the network and caches what it gets, but a
first-run-offline install has no launcher icon. The list will drift further every time a craft
module gains a file.
**Proposal** · The same `tools/cache-version.ps1` from #1 writes the array: glob `css/*.css`,
`js/*.js`, `js/vendor/*.js`, `icons/*`, plus `./`, `index.html`, `manifest.webmanifest`. One
generator, one hash, one source of truth, and the CI verify job checks both. While in there:
`manifest.webmanifest`'s description and `index.html`'s meta description still both say "crochet"
only, two crafts later.
**Effort** S · **Impact** 3 · **Risks** Globbing could sweep in a file that should not ship
(nothing today). Keep an explicit exclude list in the generator.

### 14. A quiet "new version" story
**Evidence** · `index.html:212-221` registers the SW and does nothing else — no `updatefound`,
no `controllerchange`, no `reg.update()`. `sw.js:56` calls `skipWaiting()` inside `install` and
`sw.js:71` `clients.claim()` in `activate`, while `activate` deletes every other cache. So on a
deploy the new SW takes over **while the page is still running the old JS**, and anything fetched
lazily from then on (`pdf.min.js`, `pdf.worker.min.js` — both precached, both loaded on first PDF
use) comes from the *new* cache. Mixed-version code in one session, silently. An installed PWA
that is never fully closed can sit in that state for days.
**Proposal** · Keep `skipWaiting` (the alternative is worse for this app), but tell the user:
listen for `controllerchange`, and show a low-key toast with a **Reload** action —
"There's a newer version. Reload when you're at a good stopping point." Never auto-reload; the
user is mid-row. Call `reg.update()` on `visibilitychange` → visible so a long-lived installed PWA
actually notices. Have the SW post its `CACHE_VERSION` to clients so Settings and the diagnostics
dump (#6) can show which build is running.
**Effort** M · **Impact** 3 · **Risks** A toast per deploy is annoying if #1 makes versions change
often; show it at most once per session and suppress it while a counter is actively being tapped.

### 15. Split `app.js` — no build step, no modules, no risk
**Evidence** · `js/app.js` is 4,866 lines / 173 KB, 136 top-level functions, 21 `openSheet(`
call sites, 19 `…Sheet`/`…Flow` functions. Its file-ownership row in HANDOFF makes it a
serialisation point: any two agents touching the shell collide on it, and its size is the reason
edits there are slow and conflict-prone.
**Proposal** · Split by concern into sibling IIFEs that hang off the same `App` global, in
`index.html` order (this pattern already works for the craft modules): `js/app-shell.js` (boot,
screens, topbar, render loop, the `ctx` bag), `js/app-counter.js` (the crochet counter, the tap
gesture at :1302-1400, diagram mounting at :1402-1530), `js/app-sheets.js` (the sheet/field
primitives at :262-557 that both craft modules already consume via `C.`), `js/app-import.js`
(:2143 new-project-with-PDF, :3031 drop zone, :3504 paste-and-pick, `importPicker`),
`js/app-settings.js` (:4128-4400 menus, backup, FAQ). Each keeps its own IIFE and one global;
`App.registerCraft` is unchanged. **No build step, no bundler, no module syntax** — just five
`<script>` tags where there was one, and five independently ownable files in the parallel-work
map.
**Effort** M · **Impact** 3 · **Risks** Load-order coupling: anything reading another file's
internals at script time breaks. Everything must go through `App.*` at call time, which is already
the convention for crafts. Do it in one commit with zero behaviour change and all 12 test pages
green on both sides — and note that the split *increases* request count on cold load, which #23
then addresses.

### 16. Extract the shared craft-UI helpers
**Evidence** · The sheet primitives are correctly centralised (`app.js:262-557`, consumed as
`C.openSheet`/`C.confirmSheet` by both craft modules — no duplicate dialog or Escape handling
anywhere). What *is* duplicated, roughly **270–300 lines**: `barButton` (app-xstitch.js:1029-1035
and app-sewing.js:275-281, byte-identical but for the `C.` prefix), `fmtBytes`
(app-xstitch.js:3052 / app-sewing.js:2380, *different* thresholds and labels — the same number
renders as "1.2 MB" in one craft and "1,2 MB" in the other), the three-tier copy-to-clipboard
fallback (`fallbackCopy` app-xstitch.js:2348-2373 vs `shareFallback` app-sewing.js:1176-1198,
~25 lines each), `copyShoppingList` (app-xstitch.js:2318 / app-sewing.js:1158),
`openPagesSheet` (app-xstitch.js:2511-2605, 95 lines vs app-sewing.js:1831-1915, 85 lines —
same thumbnail-grid / BlobStore.get / confirm-delete skeleton), and `plural` in **three** places
(app.js:3009, app-xstitch.js:71, app-sewing.js:58). Also an inconsistency worth folding in:
xstitch's Pages sheet has a `storageFooter` (app-xstitch.js:2606) and sewing's does not.
**Proposal** · Promote to the `ctx` bag in `js/app.js` (or `js/app-sheets.js` after #15):
`ctx.barButton`, `ctx.fmtBytes`, `ctx.copyText` (the whole fallback chain), `ctx.plural`, and a
parameterised `ctx.pagesSheet({projectId, prefix, title, onDelete})` that both crafts configure.
Roughly 250 lines deleted and two rendering inconsistencies fixed for free.
**Effort** M · **Impact** 3 · **Risks** Touches all three UI files, so it serialises agent work;
schedule it as its own round. `docs/CRAFTS.md` is the contract and must be updated in the same
commit or the next craft re-invents them again.

### 17. Don't let the service worker eat the fixture PDFs
**Evidence** · `sw.js:105-108` sends **every** same-origin GET through `cacheFirst`, which caches
any 200 response indefinitely. The fixture pages fetch `../tmp-pdf/*.pdf` — ~90 MB of copyrighted
PDFs sitting in the repo. Measured on this profile: `navigator.storage.estimate()` reports
**14,343,986 bytes in `caches`** with a nearly empty app. Those entries survive until a
`CACHE_VERSION` bump, they are served stale to the fixture pages on the next run (masking a fixture
you just replaced), and — worst — an agent that swaps a PDF and re-runs the suite can get the old
bytes back with no indication why.
**Proposal** · In `sw.js`, bypass the cache entirely for `/tmp-pdf/` and `/test/` — `return;`
before `respondWith` so they hit the network unmediated. Then bound the general case: in
`cacheFirst`, only *populate* the cache for paths in `PRECACHE_URLS` (plus `icons/`), and let
anything else pass straight through. Cache-first for the shell is right; cache-first-forever for
arbitrary same-origin URLs is not.
**Effort** S · **Impact** 3 · **Risks** Anything currently relying on the incidental caching of a
non-precached asset would go network-only offline. With #13 generating the list from a glob, the
set of precached paths is exactly the set of shipped files, so nothing real is left out.

### 18. `.gitattributes` and one line-ending convention
**Evidence** · No `.gitattributes`. `js/app.js`, `js/patterns.js`, `js/store.js`, `js/tour.js`
are CRLF; `js/xstitch.js`, `js/sewing.js`, `js/app-xstitch.js`, `js/app-sewing.js` and all CSS are
LF. Commit `6e2a624` (a UX contrast/touch-target sweep) shows `js/xstitch.js` with
**9,130 changed lines** — the entire file rewritten by a line-ending flip, burying the ~50 lines
that actually changed. Every agent that reads that diff, and every future `git blame` and
`git bisect` on that file, pays for it.
**Proposal** · `.gitattributes` with `* text=auto eol=lf` and `*.ps1 text eol=crlf`. Normalise
once with `git add --renormalize .` as a single, clearly-labelled commit so the noise is
contained to one place forever. Combine with #8's control-byte fix and the text-hygiene check in
the same pass.
**Effort** S · **Impact** 2 · **Risks** One large mechanical commit that makes `git blame` on the
normalised files point at it; `git blame -w --ignore-rev` handles that, and a
`.git-blame-ignore-revs` file makes it automatic.

### 19. Fix the agent test harness: the server and the shared origin
**Evidence** · `tools/serve.ps1` is a single `HttpListener` loop handling **one request at a
time** — every measurement taken through it serialises, and the 20-resource cold load above is
therefore an upper bound rather than a real number. Its MIME table has no `.pdf` entry (fixtures
get `application/octet-stream`; harmless today because they are read as ArrayBuffers, but
surprising). Separately, and more seriously: while taking these measurements, **another agent's
quota experiment (`__qa_fill_0…39`, 40 × 256 KB) appeared in the same origin's localStorage and
replaced the projects I had just imported** — because every agent tab shares
`http://localhost:8765`. Agents silently corrupt each other's state and each other's numbers.
**Proposal** · (a) Make `serve.ps1` handle requests on a thread pool, or at minimum document that
it does not and that timings through it are pessimistic. (b) Add `.pdf`, `.oxs` and `.woff2` to
the MIME table. (c) Give each agent its own origin: accept `-Port` per agent (`8765`, `8766`, …)
and have the launch config / HANDOFF tell agents to claim one, since a different port is a
different storage origin. (d) Add a `test/reset.html` that clears localStorage, IndexedDB, caches
and SW registrations in one click, replacing the long incantation HANDOFF currently asks everyone
to paste.
**Effort** S · **Impact** 3 · **Risks** Multiple ports mean multiple `launch.json` entries; keep
`stitchkeeper` as the default so nothing existing breaks.

### 20. Put page images in the backup
**Evidence** · `js/store.js:1999-2000` `exportJSON()` is `JSON.stringify(getState())` — state
only. BlobStore contents (chart page renders, sewing page images, capped at 40 per project) are
never exported; HANDOFF item 10 documents this and the UI says "stored on this device only". So a
user who moves phones the correct way, via backup, silently loses every page image — exactly the
content that took the longest to produce.
**Proposal** · Two tiers. Cheap: a manifest — list blob keys and sizes in the export, and on
import show "12 page images were on the other device; re-import the PDF to get them back",
naming the projects. Proper: a real archive. A minimal store-only (uncompressed) ZIP writer is
~150 lines of ES5 with a CRC32 table and needs no dependency — `backup.json` plus `blobs/<key>`
entries. Export becomes a `.zip`, import sniffs `PK\x03\x04` and handles both. Do the manifest
now, the archive when #3's import sheet exists to host the UI.
**Effort** M · **Impact** 3 · **Risks** Backup files jump from ~60 KB to tens of MB, which changes
the share sheet's behaviour on iOS and may hit memory limits while assembling. Stream into the
archive per blob rather than concatenating in memory, and warn above ~50 MB.

### 21. A string table, before there are 2,000 strings
**Evidence** · ~**1,100 distinct user-facing English literals** across `js/*.js` (app.js ~323,
app-xstitch.js ~288, app-sewing.js ~238, tour.js ~72, sewing.js ~95, store.js ~55), every one
inline at its call site. No `i18n`/`locale`/`strings` module exists. Pluralisation is three
hand-rolled English `+s` copies (#16); the only `Intl` in the entire repo is
`toLocaleTimeString` (app.js:110) and `toLocaleString` (app-xstitch.js:68, app.js:3118).
`fmtDuration` (app.js:80-88) and `ago` (app.js:94-105) hard-code "m ago"/"h ago"/"just now".
**Proposal** · Do not translate anything yet. Do make it *possible*: add `js/strings.js` with
`S('key', params)` falling back to the key itself, and move strings into it opportunistically —
every file an agent touches for another reason gets its literals lifted, which costs nothing extra
per round and converges. Meanwhile, standardise the formatting seams **now**, because they are
where retrofitting hurts most: one `ctx.plural` on `Intl.PluralRules`, one `ctx.number` on
`Intl.NumberFormat`, one `ctx.relTime` on `Intl.RelativeTimeFormat`. Getting those three right
today is most of the work of getting i18n right later.
**Effort** L (S if scoped to the formatting seams) · **Impact** 2 · **Risks** A half-migrated
string table is worse than none if agents cannot tell which convention a file uses — put the rule
in `docs/CRAFTS.md` and make it per-file, not per-line.

### 22. Sharpen the agent workflow: ownership, conventions, speed
**Evidence** · HANDOFF's ownership map is prose at the bottom of an 11 KB file; the
SW-clearing ritual is a 200-character incantation to paste; commit messages already follow a
tight convention (subject, bullets, test counts, `Co-Authored-By`) but it lives only in examples;
the `CACHE_VERSION` bump is a manual step that was missed 13 times (#1); and #19 shows agents
share one browser origin. The delegation pattern itself is working well — the parallel craft
build is visible and clean in the log — so this is about removing friction, not changing shape.
**Proposal** · A short `docs/AGENTS.md` (or `CLAUDE.md`, which the harness reads automatically):
the ownership table as a **table**, the commit-message template, "run `tools/cache-version.ps1`,
never hand-edit `CACHE_VERSION`", "claim a port", "`test/reset.html` before testing", "never
commit `tmp-pdf/`", and the file-size/greppability rules from #8. Add a `test/index.html` that
links every suite with its expected assertion count so a reviewing agent sees drift at a glance.
Keep HANDOFF for state; put process in the file the tooling loads by default.
**Effort** S · **Impact** 3 · **Risks** Two documents drift apart. Have HANDOFF link to it and
hold no process of its own.

### 23. Stop shipping 1.15 MB of JS to someone who only counts rows
**Evidence** · Measured: 1,261,781 bytes decoded across 20 resources on cold load, DCL 128 ms on
a fast desktop with a local server. `xstitch.js` (174 KB) + `app-xstitch.js` (170 KB) +
`sewing.js` (103 KB) + `app-sewing.js` (103 KB) = **550 KB, 44 % of the payload, parsed and
compiled on every start by every user** — including the crochet-only user the app was built for,
who may never open another craft. `diagram.js` is another 76 KB for a feature behind a setting.
On a low-end Android, script parse + compile at roughly 1 MB/s means the better part of a second
of blank screen before the first row can be tapped.
**Proposal** · Lazy-load craft modules on demand, no build step required: keep the current
`<script>` tags only for `themes/store/app` and inject the rest with a tiny
`ctx.loadCraft(id) → Promise` that appends `<script>` tags and resolves on load. Craft modules
already self-register with `Store`/`App` at script time and `App.init` already tolerates any
registration order, so the contract barely moves — the shell needs a *name + emoji* manifest for
the craft picker before the code loads, which is a dozen lines. Load a craft when its project is
opened or its picker entry is chosen; keep everything precached so it is instant and offline.
Same treatment for `diagram.js` (load when the setting is on) and `tour.js` (load on first tour).
Expected: **~630 KB off the critical path**, crochet cold start roughly halved.
**Effort** M · **Impact** 3 · **Risks** Interacts with #15 (do the split first, then the lazy
loading, so the boundaries are already drawn) and with #1 (`PRECACHE_URLS` must still list every
lazily-loaded file, which #13's generator handles). A craft screen must show a loading state for
the one frame the script takes, and must degrade to a clear message — never a blank screen — if
the script fails.

---

## Two things worth saying plainly

**The app's engineering is better than its release process.** Zero `innerHTML`, a single
`updateCraftData` door, a `BlobStore` that never rejects, `isEvalSupported: false` on both PDF
entry points, clean per-craft namespacing, 2,725+ assertions, and a photo pipeline that runs in
96 ms in a Worker — this is careful work. What is missing is almost entirely *around* the code:
nothing checks the cache version, nothing runs the tests, nothing records an error, nothing asks
for durable storage, and nothing stops a backup import from overwriting a month of counting.
Proposals 1–4 and 6–7 are all small, and together they close the gap between "well written" and
"safe to ship to strangers".

**Two numbers to keep an eye on as the crafts grow.** 8,535 ms of main-thread grid reading and
+50 MB of heap (#5) is the only measured path that will visibly fail on the hardware this app is
for. And 43 % of asset-changing commits shipping without a cache bump (#1) is the only measured
defect that has already reached production, repeatedly.
