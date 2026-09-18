# Handoff: Thready or Not

Crochet, cross-stitch and sewing counter PWA. Live: https://puckhead456.github.io/ThreadyOrNot/ (repo puckhead456/ThreadyOrNot, deploys from `main` via `.github/workflows/pages.yml`, ~1 minute). Local folder `C:\Users\mitch\CrochetBs` (folder name intentionally unchanged). Plain HTML/CSS/JS, **no build step, no modules, no framework**; one `window` global per file from an ES5 IIFE. Owner: puckhead456 (Windows user "mitch"). Started 2026-09-14; crafts expansion 2026-09-15/16.

Read in this order: this file → `SPEC.md` (crochet + shell contract; the "Crafts" section points onward) → `docs/CRAFTS.md` (the craft plugin contract) → `docs/research/cross-stitch.md` and `docs/research/sewing.md` (research + the per-craft specs the modules were built from; the code is the truth where they differ).

## What is live (2026-09-18; the cache version is now a content hash, see How to work on it)

- **Crochet** (the original app): row/round + stitch counters, parts with make-counts, editable templates (**templates carry pattern text** per part since v19), checklists, pattern paste and in-app PDF import (pdf.js, on-device; **drop the PDF straight into the New project sheet**: sections + checklist picker inline, synthetic "From this PDF" template card, "Also save as a template" toggle; `importPicker` in app.js is shared with the menu → Import pattern sheet) through parser v2.4 (computed counts, multi-size, sections, notes, repeats; header forms `Name – colour:`, `Name in colour:`, `(4x)`, `Rnd 7+8:`, stranded wrapped counts, title-above-header, `Name: (Make 2)`, slash names, duplicate headers, glossary guard, **assembly / finishing pages and in-round placement sentences routed into each part's placement notes** (`section.placement`, `Patterns.placement`); `PdfText` repairs letter-spaced PDFs per page and drops rotated / floating photo captions geometrically), six themes, celebrations, guided tours + FAQ, export/import, proprietary LICENSE. **Live 3D diagram** in the stitch button (raw WebGL, `js/diagram.js` v1.1): count on release inside 12 px, swipe on the button spins the piece and never counts, drag follows the finger in button and viewer, yarn material + contact shadow. Not yet checked on real touch hardware or a mid-phone GPU.
- **Crafts shell** (`docs/CRAFTS.md`): `Project.craft` ('crochet' default; old saves migrate), opaque `Project.craftData`, `Store.registerCraft` / `App.registerCraft`, `#screen-craft`, craft picker in New project (only when a craft module registered), `Store.updateCraftData` (undoable), `Settings.crafts`, `js/blobstore.js` (IndexedDB for page images), `PdfText.open`, `Tour.register`, `ctx` helper bag incl. `pdfDropZone` and `wake`. Crochet code paths untouched; a crochet-only install is byte-identical.
- **Cross-stitch** (`js/xstitch.js`, `js/app-xstitch.js`, `css/xstitch.css`): OXS import/export with full cell data; PDF import = colour-key parser (KG-Chart, Spriter and DMC-library layouts, confidence banner, declared-colour sanity check, embroidery detection) + chart pages rendered to BlobStore (cap 40) + **grid reader beta** (`XStitch.extractGrid` reads per-stitch coloured rectangles from the page operator list; all 7 KG-Chart fixtures recover exactly in 0.4–8 s, Spriter/DMC fail fast); manual entry; chart viewer with tap / drag / 10×10 / whole-colour marking and a layer switch for backstitch / knots / fractionals; colour key with per-layer tallies; big tap button with a live chart preview that walks backstitch once a colour's crosses are done; floss (skein ranges, shopping list), fabric & size, pages, parking sheets; printable chart (inline-SVG tiles in mm, colour or B&W); oversize-chart guard (1 MB sheet, image-only downgrade keeps tallies); 6 FAQs + tour.
- **Photo → chart** (`js/xstitch-photo.js`): on-device Web Worker (linear-light resample → CIELAB → seeded k-means → nearest DMC by CIEDE2000 → confetti cleanup → symbols), ~90–160 ms for 200×250 / 24 colours on desktop, deterministic, cancellable, crop frame with aspect lock. No LLM, no network, no per-user cost.
- **Sewing** (`js/sewing.js`, `js/app-sewing.js`, `css/sewing.css`): booklet parser (steps incl. titled paragraphs, cutting list incl. quilting WOF/subcut, notions, seam allowance with exceptions, size charts with dual-unit cells, grouped fabric yardage per size, kind detection, reference blocks skipped); step counter with big Step-done button; steps / cutting (tap-to-cycle counts) / notions (copy shopping list) / size & alterations (shared "my measurements") / fabric (chosen-size card) / machine settings + presets / seam-allowance sheets; quilt unit counters; import review list with "Make steps from paragraphs" picker; opt-in page images with pinch-zoom viewer; cutting-table SVG illustration + step ring; Awake toggle; 6 FAQs + tour.

## Tests (all green 2026-09-17)

| page | assertions | notes |
|---|---|---|
| `test/patterns.test.html` | 479 | crochet parser, synthetic |
| `test/patterns.fixtures.html` | 263 | real crochet PDFs in `tmp-pdf/` |
| `test/templates.test.html` | 94 | templates carry pattern text + placement notes; createProject / templateFromProject / export round-trip |
| `test/crafts.test.html` | 124 | Store craft plumbing |
| `test/sw.test.html` | 27 | service-worker routing policy (dev vs production) |
| `test/blobstore.test.html` | 46 | IndexedDB wrapper |
| `test/xstitch.test.html` | 602 | synthetic |
| `test/xstitch.fixtures.html` | 174 (+5 skipped) | 11 real charts, read directly from the PDFs (~1 min) |
| `test/xstitch-photo.test.html` | 131 | + visual QA panel (drop a photo) |
| `test/sewing.test.html` | 675 | synthetic |
| `test/sewing.fixtures.html` | 137 | 2 real booklets, read directly from the PDFs |
| `test/celebrate.test.html`, `test/diagram.test.html` | demo pages | no assertions |

Fixtures: `tmp-pdf/` is gitignored and copyrighted (**never commit it**). The fixture pages extract text from `xs-*.pdf` / `sew-*.pdf` themselves via `PdfText` (sessionStorage cache; a `.txt` of the same name overrides), so adding a fixture = drop the file in and add shape assertions. `tmp-pdf/SOURCES.md` lists what is there and where it came from: 7 KG-Chart LE charts, 1 Spriter chart, 3 DMC library PDFs (one is embroidery, flagged as such), 2 Pattern Runway booklets (their cutting lists live on the pattern sheets, so "no cutting list" is correct), 9 crochet PDFs (bear, bee, cardigan, cato + snowman, turtle, fish, panda, baphomet added 2026-09-17).

## What's left

Owner-side (fixtures):
1. A FlossCross export of one of your own photos as **PDF + OXS** (`xs-flosscross.pdf/.oxs`): the only ground-truth pair we can own outright; also settles the fractional-stitch direction → corner mapping, which is unverified against a real generator.
2. A commercial chart in the Artecy / Pattern-Keeper style (a different key layout than KG-Chart), and a **quilt** and a **bag** booklet: the quilting WOF/subcut and hardware/interfacing rules have only seen synthetic text.
3. A feel-test of the 3D swipe and the chart pinch on a real phone; nothing here has run on touch hardware.

Small code items (each < half a day):
0. From the UX sweep (`docs/ux-sweep-2026-09-16.md`, 74 findings, 66 fixed): keyboard path for the chart canvas and photo-crop handles, a focus-preserving rerender helper, a proper fallback when `dialog.showModal` is missing, one announcement policy across crafts, home-card summaries in one shared shape, "SA" abbreviation on the sewing step card, the counter still overflowing below ~700 px tall.
4. Printable chart does not distinguish done stitches (progress is not part of a print).
5. Sewing fabric rows printed without a bolt width (`LINING 1m / 1 yd`) are dropped.
6. `ctx.pdfDropZone` with `onPages` + `onText` skips the cross-page running-head pass (documented in CRAFTS.md; both craft importers avoid the combination).
7. Steps-from-paragraphs picker re-renders the whole list per edit (fine at ≤ 300 rows).
8. Cross-stitch grid reader recovers full stitches only; backstitch/knots from PDFs would need stroke parsing.

Bigger / product decisions:
9. Photo → chart: free or the first Pro feature (it costs nothing to run).
10. Backup file does not include BlobStore page images (documented in the UI as "stored on this device only"); a zip export would fix it.
11. Launch checklist (business plan): move hosting to Cloudflare Pages (free, private repo, custom domain) then flip the repo private; name/trademark search; rename IP-referencing themes and redraw two mascots; minification + canary strings (note: `js/xstitch-photo.js` builds its Worker from `String(fn)`, so `XSPhotoCore` / `xspWorkerBody` must be excluded from name mangling); later move parser/diagram-model behind an API for Pro. Business plan artifact: https://claude.ai/artifact/YM4khtjkszxfibJDyLNVyq (private).

## How to work on it

- Local server: `.claude/launch.json` config `stitchkeeper` runs `tools/serve.ps1` on http://localhost:8765 (no node or python on this machine). Use the Browser pane's preview tools, never Bash, to run it.
- **Caching / service worker** (rewritten 2026-09-18; no more manual bumps, no more clearing ritual):
  - `CACHE_VERSION` in `sw.js` is **generated, never hand-edited**. `tools/sw-version.sh` (Git Bash) hashes every file in `PRECACHE_URLS` — the list is read out of `sw.js` itself — plus `sw.js` minus the version line, and rewrites the line in place (`h<10 hex>`), printing old → new. It is idempotent. `--check` verifies without writing, `--list` prints the precached paths.
  - Run **once per clone**: `git config core.hooksPath .githooks` (already done in this working copy). `.githooks/pre-commit` then regenerates and re-stages `sw.js` whenever a precached file is staged. The hook file must stay LF-only (a CRLF shebang breaks it on Windows); if a fresh clone mangles it, `git config core.autocrlf input` or the `.gitattributes` fix.
  - The deploy is gated: `.github/workflows/pages.yml` runs `bash tools/sw-version.sh --check` before uploading and fails the job if `sw.js` disagrees with the content hash. The hook can be skipped; the gate cannot.
  - **On localhost / 127.0.0.1 the SW precaches nothing and is network-first for everything same-origin** (cache is an offline fallback only, and `activate` deletes every cache). You do **not** need to unregister the worker or clear caches before testing — just reload. Still a new file? Hard-reload once.
  - In production, same-origin requests are **stale-while-revalidate**: the cached copy is served instantly and refreshed in the background, so even a missed version bump heals on the next load. Navigation stays network-first (cached `index.html` when offline), Google Fonts stay SWR. Only precached paths and `icons/` are ever written to the cache; **`/tmp-pdf/` and `/test/` are never cached on any host**, so a swapped fixture PDF is always read fresh.
  - New file that must work offline → add it to `PRECACHE_URLS` in `sw.js`; the hash and the version follow automatically.
  - `test/sw.test.html` (27 assertions) covers the routing decision: it fetches `sw.js` as text and runs its pure `swPolicy` against a fake production location and a fake localhost one, so both stories are checked without registering anything.
  - On a deploy, `index.html`'s registration script shows a non-blocking "A new version is ready — Reload" toast (falls back to a `.sw-update` banner if `App.toast` is not up) and calls `registration.update()` on `visibilitychange`, at most once per 10 minutes. It never auto-reloads.
- Browser pane quirks: the service worker will not register inside the pane (environment, not code); `requestAnimationFrame` is throttled unless a screenshot forces a frame, so take a cheap screenshot before driving a canvas with synthetic pointer events; `window.open` is blocked (the printable chart's blob-URL fallback is what you will exercise). The pane's localStorage is a scratch profile: agents may wipe it. The owner's phone data is separate.
- Git: signed in; pushes work non-interactively with `GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never`. Put commit messages in a short-path file such as `C:\Users\mitch\AppData\Local\Temp\sk-commit.txt` and use `git commit -F`; long scratchpad paths break git on Windows. Git Bash heredocs work; PowerShell here-strings with quotes do not survive as git arguments. End commit messages with the Co-Authored-By line.
- Deploy = push to `main` (single branch; the owner wants everything on main). Verify live files WITHOUT cache-busting query strings (GitHub's CDN returns 404 for `?x=` on fresh deploys); polling `sw.js` for the new `CACHE_VERSION` (now a generated `h…` hash — `bash tools/sw-version.sh --print` tells you what to expect) is the reliable check.
- Delegation pattern that has worked: write the contract (SPEC.md / CRAFTS.md), spawn one Opus agent per independent file group with strict file ownership, tell each to use its own Browser-pane tab (`tabs_create` + `tabId`), integrate, run every test page, verify at 375×812, deploy (the cache version regenerates itself). Research-first for new crafts (one agent writes `docs/research/<craft>.md`, then builders implement Part B).
- File ownership map for parallel work: shell = `js/store.js`, `js/app.js`, `index.html`, `sw.js`, `css/app.css`, `css/themes.css`, `js/pdftext.js`, `js/tour.js`, `js/blobstore.js`; crochet logic = `js/patterns.js`, `js/diagram.js`, `js/celebrate.js`, `js/audio.js`; cross-stitch = `js/xstitch.js`, `js/xstitch-photo.js`, `js/app-xstitch.js`, `css/xstitch.css`, `test/xstitch*.html`; sewing = `js/sewing.js`, `js/app-sewing.js`, `css/sewing.css`, `test/sewing*.html`.
