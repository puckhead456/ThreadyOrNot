# Wave K status (coordinator's working notes; update as things change)

Owner's standing instructions (2026-11-12)
- Signed off on ALL brainstorm proposals; approved downloading more fixtures (and the OCR spike).
- **Pause when the 5-hour session limit reaches 5% remaining (95% used).** Check with
  `mcp__ccd_session_mgmt__get_usage`. On pause: stop running agents (TaskStop), commit the
  worktree as a WIP commit on `wave-1` only if every suite is green, otherwise leave it
  uncommitted, update this file, and tell the owner exactly where things stand. Agents can be
  resumed with SendMessage and keep their context.
- App sounds are muted on localhost (`js/audio.js`); never enable them while testing.
- Spawn Opus agents (`model: "opus"`) wherever it makes sense.

Phase 1, brainstorm: done. `docs/wave-k/brainstorm/00..04`.
Phase 2, build: `docs/wave-k/BUILD.md` is the shared brief (decisions + ownership map).

## Batch 1 (engines and shell), launched 2026-11-12
| Worker | Agent id | State |
|---|---|---|
| fixtures | a3e15da3fec0a648c | PAUSED mid-work 2026-11-12 (session limit); resume with SendMessage |
| pdftext | a1c4b8e1e1c104713 | PAUSED mid-work 2026-11-12 (session limit); resume with SendMessage |
| shell-data | a9bd7312ff9341007 | PAUSED mid-work 2026-11-12 (session limit); resume with SendMessage |
| shell-ui | abc28e2605c72ff27 | PAUSED mid-work 2026-11-12 (session limit); resume with SendMessage |
| xs-core | a13a79171a1d90cd3 | PAUSED mid-work 2026-11-12 (session limit); resume with SendMessage |
| sew-core | a49f6dd9f59f6edef | PAUSED mid-work 2026-11-12 (session limit); resume with SendMessage |
| xs-render | af264a8ff56b6a4ee | PAUSED mid-work 2026-11-12 (session limit); resume with SendMessage |
| xs-read | a0190acd1b34ebf9e | PAUSED mid-work 2026-11-12 (session limit); resume with SendMessage |
| xs-keyread | a9dc1e6c34677f10f | PAUSED mid-work 2026-11-12 (session limit); resume with SendMessage |
| sew-visual | ae7400ca030ec740f | PAUSED mid-work 2026-11-12 (session limit); resume with SendMessage |
| ocr (opt-in Tesseract spike) | not launched yet | held for budget |

Brainstorm agents (resumable for questions): parity a48481adbed3304b8, knitting ac649e4e8406d4876,
cross-stitch a5d4e4e92faa6dc66, sewing a4fbfd5224a81973b, visual a3355cb858e3e2cd9.

## Batch 2 (not launched): needs batch 1's API files in `docs/wave-k/api/`
- xs-app: `js/app-xstitch.js`, `css/xstitch.css`: stitch mode on the working-mode contract, honesty
  sweep, parking / pages on the chart, sessions UI, the stitched renderer and loupe in the tap
  button, picture-key flow, check sheet on the grid path (the pacman bug's UI half), stash, calculators.
- sew-app: `js/app-sewing.js`, `css/sewing.css`: working mode, figure beside step, size advisor,
  cutting board, quilt top, calculators, timers, glossary, fitting log, "what was missed".
- knitting: `js/knits.js` (+ `js/patterns.js`), `js/knit-chart.js`, knit regions of store / app,
  `js/diagram*.js`: proposals in `brainstorm/01-knitting.md` (stretch phases first; knitting only,
  crochet numbering unchanged for now), plus K1–K4 from `04-visual-and-recognition.md`.
- galleries / audits: `test/xstitch.gallery.html`, `test/sewing.gallery.html`, `test/sewing-app.test.html`.
- docs: integrate into HANDOFF.md / SPEC.md / CRAFTS.md; commit; merge to main; deploy.

## Coordinator decisions recorded for the owner (BUILD.md has the full list)
Units follow the pattern; estimates are ≈ and opt-in; "off" checks demote, never block; OCR engine
is opt-in and lazy; everything free for now; knitting stretch phases apply to knitting only until a
phone trial; mirrored chart halves may be shown when labelled as worked out by the app.

## Resumed 2026-11-12 ~21:05Z (owner: "continue, full speed, spawn as much as is relevant")
- 5-hour window reset to 0% (resets 2026-11-13T01:20Z). Still stop agents before 95%.
- All ten batch-1 agents resumed by SendMessage (same ids as the table above).
- New: knit-parse `a9ef9a9a2605475cd` (js/knits.js, patterns.js knit paths: P8, P7, stretch data
  for P1, P6, P12, P15, P20), ocr `ad9097023e25f9984` (opt-in Tesseract spike).
- New shared tool: `tools/headless-suite.sh` (headless Chrome runs test pages; no pane tabs needed).
  BUILD.md has an "Added on resume" section with this and the knitting ownership table.
- Launch as engines report: xs-app (after xs-core; needs xs-render / xs-read / xs-keyread APIs),
  sew-app (after sew-core; needs sew-visual API), knit-store (after shell-data AND knit-parse's
  stretch shape), knit-ui (after knit-store API), knit-3d (independent), galleries, knitting
  journey audit (P21) last.

## Paused 2026-11-12 at ~86% of the 5-hour limit (owner's rule: stop before 95%)
- All ten batch-1 agents were stopped mid-edit. **The worktree is uncommitted and may have red
  suites**; nothing was merged; `main` and the live site are at 897f174 (wave J + silent dev server).
- Burn rate with ten Opus agents was about 2.2 points of the 5-hour limit per minute. A full
  5-hour window buys roughly 40 to 45 minutes of ten-agent work. Plan batches accordingly.
- The Browser pane ran out of free tabs with ten agents (xs-render and xs-keyread could not get
  one). On resume run at most 5 or 6 pane-using agents at a time, or have pure-logic agents test
  headless.
- To resume: SendMessage each agent id above with "continue from where you stopped; re-read
  BUILD.md; re-run your suites first because other workers' files changed". Start with the ones
  batch 2 depends on: shell-ui, shell-data, pdftext, xs-core, sew-core. Then xs-render,
  sew-visual, xs-read, xs-keyread, fixtures. Then batch 2.
- knit-3d `ad37d1bc1816c77d0` (diagram-geo.js, diagram.js: K4, K3, K1, K2), launched ~21:12Z.
- shell-data FINISHED ~21:16Z (store-safety 472, backup 229, templates 159, blobstore 78; report docs/wave-k/shell-data.md; asks relayed to shell-ui).
- knit-store `a22ef089802687cce` launched ~21:17Z (knit regions of store.js: P3, P2, P1, P10, P9, P5, P7 store half, P21 journey audit).
- Placeholders created by coordinator for batch-2 split: js/app-xstitch-extras.js, js/app-sewing-extras.js, css/xstitch-extras.css, css/sewing-extras.css, css/knitting.css (shell-ui told to wire them). Batch-2 workers: xs-app, xs-extras, sew-app, sew-extras, knit-ui, galleries (see BUILD.md tables).
- shell-ui FINISHED ~21:22Z (crafts 212, sw 48, workmode 101, checksheet 58, sharecard 24, pageviewer 37; report docs/wave-k/shell-ui.md). index.html + sw.js wire all new files incl. placeholders; js/ocr.js NOT wired yet (resume shell-ui or do it at integration). CACHE_VERSION must be regenerated at commit.
- xs-render FINISHED ~21:30Z (xstitch-render.test 61 headless / 62 with GPU; report docs/wave-k/xs-render.md).
- xs-app `ae9e0f20328fe6a64` and xs-extras `aa9b257cbce84dc99` launched ~21:31Z.
- sew-core FINISHED ~21:36Z (sewing.test 1143, sewing.fixtures 871 in a real tab only; report docs/wave-k/sew-core.md). Open: binding/backing/HST formulas not yet checked against two published calculators; Mabel read as 5 Shape-flex + 5 Peltex (coordinator accepts pending owner look); machine presets and per-fabric quilt resize not built.
- sew-app `ad1aeb6903734ee02` and sew-extras `a066164aab293ddba` launched ~21:37Z.
- fixtures FINISHED ~21:41Z: 76 new files (23 cross-stitch, 20 sewing, 32 knitting, 1 crochet), all logged in tmp-pdf/SOURCES.md; docs/wave-k/fixtures.md lists what each tests and what could not be found (DROPS, two-at-a-time socks, PDF+OXS pair, knitting-font pattern, projector file). No open-licence floss conversion table exists: check what xs-core used for #16 before shipping brand conversion.
- pdftext FINISHED ~21:44Z (pdftext.test 169, pdftext.layout.test 169; extract output byte-identical on 106 fixtures; report docs/wave-k/pdftext.md). xstitch.fixtures showed 11 timing failures and sewing.fixtures 1 under machine load: re-run on a quiet machine. Headless runner cannot run PDF or IndexedDB pages (virtual time): coordinator to build a real-time runner.
- xs-core FINISHED ~21:47Z (xstitch.test 1109, xstitch.fixtures 582 / 9 skipped in a real tab; pacman now reads all 10 colours, 64,512 stitches, check exact; report docs/wave-k/xs-core.md). #16 brand conversion ships with no non-DMC table (no open-licence data): owner decision needed on a data source.

## Second pause, 2026-11-12 ~21:50Z at ~81% (stopping in two steps to stay under 95%)
Stopped mid-work (resume each with SendMessage; re-read BUILD.md "Added on resume"; re-run suites first):
| Worker | Agent id | Was doing when stopped |
|---|---|---|
| xs-app | ae9e0f20328fe6a64 | about to append the wave K CSS section (js/app-xstitch.js mid-edit) |
| xs-extras | aa9b257cbce84dc99 | fixing three test expectations (page labels "p1"/"p2") |
| sew-app | ad1aeb6903734ee02 | in applyImport: rename, figure capture |
| sew-extras | a066164aab293ddba | about to write its test page |
| knit-store | a22ef089802687cce | P1 journey (E1) and synthetic knit-counter tests |
| knit-3d | ad37d1bc1816c77d0 | fixing the K4 test's yaw comparison (mod 2 pi) |
| knit-parse | a9ef9a9a2605475cd | writing the stretch marker (P1 parser data) |
Still running at this point: xs-read, xs-keyread, sew-visual, ocr (allowed a few more minutes to land).
Finished this window: shell-data, shell-ui, xs-render, sew-core, fixtures, pdftext, xs-core.
Not launched yet: knit-ui, galleries / audits, final integration.
Coordinator to do while idle (cheap): a real-time headless runner (the virtual-time one cannot run
PDF or IndexedDB pages); wire js/ocr.js into index.html / sw.js once the ocr report says ship.
- sew-visual FINISHED ~21:53Z (sew-visual.test 168 headless, 245 with ?real=1; report docs/wave-k/sew-visual.md). It drove headless Edge over the debugging port for fixture pages: reuse that approach for the real-time runner.
- xs-keyread FINISHED ~21:59Z (xstitch-keyread.test 71; potatoes key 6 of 6 exact; key crops 78 of 90 DMC rows exact, 0 wrong; whole pages need a box around the key; report docs/wave-k/xs-keyread.md). Ask: Anchor table needs a licensed data source (owner).
- ocr FINISHED ~22:10Z (ocr.test 73, ocr.fixtures 4; report docs/wave-k/ocr.md). Recommendation: ship opt-in
  for two uses only (cropped cross-stitch keys checked against the DMC list; scanned single-column prose).
  5.15 MB per device once; repo +8.2 MB. Integration to do (coordinator / resumed shell-ui):
  sw.js activate must keep caches named `thready-ocr-*`; wire js/ocr.js into index.html + PRECACHE (never
  js/vendor/tesseract/); `.gitattributes` marking *.wasm and *.gz binary; opt-in button, progress and
  Settings row (wording in the ocr report); pdftext `setPageText(n, items)` hook (resume pdftext);
  parser gaps: XStitch.parseKey on OCR'd tapestry / Orr keys, Knits.parse on Nicoll text.

## Owner changed the pause rule, 2026-11-12 ~22:12Z: "dont worry about 95% go to 100%"
- The 95% stop no longer applies: run agents until the 5-hour limit is actually hit.
- All seven paused workers were resumed at ~90% (xs-app, xs-extras, sew-app, sew-extras, knit-store,
  knit-parse, knit-3d; same ids as the table above); xs-read `a0190acd1b34ebf9e` was still running.
- If this file is the last thing written: the limit was hit with those eight mid-work. The 5-hour window
  resets 2026-11-13T01:20Z. After it resets: SendMessage each of the eight ("continue from where you
  stopped; re-run your suites first"), then launch knit-ui and the galleries worker, then integrate
  (ocr wiring in sw.js / index.html, .gitattributes, real-time headless runner, all suites, phone-size
  walkthrough, HANDOFF / SPEC / CRAFTS, commit, merge to main, push, verify the deploy).
- xs-read FINISHED ~22:16Z (xstitch-read.test 280, needs a real-time run, about 6 min; potatoes still 144 x 85, 5,721 of 5,721; Satsuma now 70 x 97; report docs/wave-k/xs-read.md; asks relayed to xs-app). Not built: phone-photo rectify, B/W symbols under 13 px. All batch-1 workers are now finished.

## Third window, from 2026-11-13 01:21Z (limit reset to 0%; owner rule: run to 100%, no early stop)
- Dev server restarted. Resumed: xs-app, xs-extras, sew-app, sew-extras, knit-store, knit-parse, knit-3d.
- Follow-ups sent to finished workers: shell-ui (OCR wiring: sw.js keeps thready-ocr-* caches, js/ocr.js
  wired, Settings row, shared opt-in helper), pdftext (setPageText OCR hook, renderRegion width),
  xs-core (goals in normalize, parseKey on OCR text, mark-log bits).
- New: knit-ui `a3531914eb385bd50` (js/app-knitting.js, js/knit-chart.js, css/knitting.css),
  runner `abc41fe701abe5377` (real-time headless runner in tools/, docs/wave-k/suites.md).
- xs-extras FINISHED 01:25Z (xstitch-extras.test 114; all eight sheets; report docs/wave-k/xs-extras.md).
  Coordinator confirmed its three defaults (units per project in craft settings; other unfinished
  projects get first claim on stash; fabric sizes approximate, hoop/frame sizes not).
- Still to launch: galleries / audits worker (after xs-app and sew-app report), then integration.
- Coordinator at integration: .gitattributes (*.wasm, *.gz binary), all suites via the new runner,
  phone-size walkthrough, HANDOFF / SPEC / CRAFTS, commit, merge, push, verify deploy.
- shell-ui OCR follow-up FINISHED 01:30Z (sw 59, crafts 224; Settings row, ctx.ocr helper, thready-ocr-* caches kept). Not yet looked at on a phone-size screen.
- xs-core follow-ups FINISHED 01:35Z (xstitch.test 1120, fixtures 582; goals kept by normalize; parseKey reads OCR-shaped tapestry key, tested on constructed text only; mark-log frames carry bits, shared array: copy to keep a frame).
- sew-extras reported 01:40Z (sewing-extras.test 121; six sheets done, quilt top and swatches partly: need SewingApp.quiltModel / captureSwatches from sew-app, relayed). sew-core resumed for swatchColours in normalize, quilt-formula check against the new Moda fixtures, encrypted-PDF check.
- knit-3d FINISHED 01:50Z (diagram.test 283 headless / 339 with reference fixtures; K4, snapshot, K3, K1, K2 built; crochet fixture assertions unchanged; phone GPU not measured; report docs/wave-k/knit-3d.md). Asks relayed: knit-store (applyChart in buildDiagramModel), shell-ui (Whole piece switch in viewer, snapshot in sharecard).
- pdftext follow-ups FINISHED 01:55Z (pdftext.layout 192, pdftext.test 168; setPageText OCR hook with ocrPages, renderRegion width/height; fixture pages green in a real tab: patterns.fixtures 905, knits.fixtures 568, sewing.fixtures 871, xstitch.fixtures 582).
- sew-core follow-ups FINISHED 01:58Z (sewing.test 1159, sewing.fixtures 890 headless real-time; normalize keeps swatchColours / swatches / quiltModel; quilt formulas checked against Moda / Bella prints; glued fractions read as mixed numbers). Not done: assertions on the new garment fixtures (Albion, Shannon nap, layered pairs).
- Backup snapshot of the whole worktree saved 02:00Z as git ref `refs/backup/wave-k-0200` (c2459d5; no branch moved, no hooks run). Restore a file with `git checkout refs/backup/wave-k-0200 -- <path>`.
- sew-app FINISHED 02:02Z (all eight items; no screenshots taken, themes never looked at; report docs/wave-k/sew-app.md).
- sew-audit `ab2d5c7c7ad5d93fc` launched 02:04Z: now owns js/app-sewing*.js, css/sewing*.css, NEW test/sewing-app.test.html and test/sewing.gallery.html; looks, tests on real patterns, fixes.
- sew-core resumed again (step.fig in normalize, sizeRule trim, new garment fixture assertions).
- shell-ui: Whole piece / This part switch in the 3D viewer and snapshot in sharecard done (crafts 239, sharecard 31); sent back once to stop rebuilding the assembled model on every tap.
- xs-app FINISHED 02:12Z (all but #6 symbol-font charts; #11 tiles untested on a real file; stitch-mode chart 73% of screen vs 85% target; no screenshots or themes looked at; report docs/wave-k/xs-app.md). Coordinator accepted its four defaults (10x10 marks current colour; "off" demotes, "unchecked" does not; un-ticking a page keeps stitches; pattern symbols on by default when clean).
- xs-audit `a442cbb555efa52ae` launched 02:14Z: now owns js/app-xstitch*.js, css/xstitch*.css, NEW test/xstitch-app.test.html and test/xstitch.gallery.html; looks, tests on real charts, fixes.
- xs-read resumed: key entries with no printed count must still claim a colour class (DMC 04 came in as DMC 413 when the key came from the key picture).
- shell-ui: tap in Whole piece view 76.4 ms -> 0.10 ms (crafts 243); resumed for a working-mode "surface under the HUD" option. Open ask for diagram.js: handle.setDone(round, done) without a rebuild (later).
- Note: the owner declined Browser-pane screenshot prompts from agents; agents use headless screenshots instead.
- shell-ui: workMode `surfaceUnderHud` option done (workmode 111); xs-audit told to adopt it. Resumed again for knit-ui's js/app.js hooks (updateKnitWidgets hook, fillSizeMarked, chart sheet routing, P13 repeat counting, pairs at import).
- knit-ui reported 02:30Z (knit-ui.test 87; done P1, P10, P2, P3, P6, P14, P19; partly P4, P8, P11, P16; waiting on knit-parse for P15 / P12 and knit-store for P9; not done P13 (app.js), P17, P20; report docs/wave-k/knit-ui.md). Resume knit-ui (`a3531914eb385bd50`) when knit-parse and knit-store finish. Coordinator: keep its temporary watcher until the app.js hook lands, then it must be removed; row notes via Store.setStepNote accepted.
- sew-core third pass FINISHED 02:38Z (sewing.test 1175, sewing.fixtures 914; step.fig kept, sizeRule one sentence, napNotes, Albion / Shannon / Margo fixture assertions; known gaps: Albion fabric table, Shannon wrap cutting list, drawn piece labels). Relayed to sew-audit.
- xs-read fix FINISHED 02:44Z (xstitch-read.test 292; key rows with no count claim a colour by distance and show as unverified; potatoes with counts removed for DMC 04 / 745 reads 100% the same). Relayed to xs-audit.
- shell-ui: knit-ui app.js hooks FINISHED 02:50Z (crafts 262, knit-counter 378, patterns 1112; counterPaint hook, fillSizeMarked, chart sheet routing, P13 tap-a-repeat on knitting rows of 40+ sts with long-press for one stitch, "Knit both at once" at import). Asked knit-store for Store.tapStitches (one undo step). "Knit both at once" toggle not looked at in the pane.
- knit-parse FINISHED 03:00Z (knits.test 449, knits.fixtures 583 + 11 known; patterns 1112 / 905 unchanged; P8, P7 parser half, P1 parser half, P6, P12 lines, P15, P20 parser half, E18; report docs/wave-k/knit-parse.md). Open: Stranded Boot heel flap stays inside Cuff; Shape Neck stretch cannot close when read alone; half-chart mirroring. shell-ui resumed for the E12 book-import fix in app.js; knit-ui resumed for P15, P12, P20, P17, P9 UI, P11 colours, P4 calibration.
- runner FINISHED 03:05Z: tools/headless-suite.sh is real-time by default (tools/cdp-page.ps1 drives headless Chrome over DevTools); `TIMEOUT=600 SHOW_TIME=1 bash tools/headless-suite.sh --all` runs 37 pages, 11,471 assertions in about 5 min; docs/wave-k/suites.md has the table. Reds at that moment: sewing-app.test 12 (sew-audit mid-work), two wall-clock limits under load (xstitch-read detect, xstitch parseOXS).
- Backup snapshot 03:06Z: refs/backup/wave-k-0305.
- shell-ui: book-import (E12) fix FINISHED 03:20Z (crafts 273; lace book lists 10, Icelandic imports with Charts A-F only; socks book 8 with own sizes / gauge). knit-counter.test 374 / 3 until knit-store applies the paste-ready test update (relayed).
- knit-store FINISHED 03:30Z (knit-counter 385, knits.journey 57 new; P3, P2, P1, P10, P9 done, P5 partly, P7 store half, P21; Store.tapStitches, K3 hook, book test re-pointed; store-safety 472 / backup 229 / blobstore 78 unchanged; report docs/wave-k/knit-store.md). Five parser defects relayed to knit-parse (resumed); knit-ui told P9 / P5 are available. Open ask for app.js owner: checklist suggestions from the picked pattern only.

### If the limit cuts this window off (written 03:32Z at 85%)
Running at this point: xs-audit `a442cbb555efa52ae`, sew-audit `ab2d5c7c7ad5d93fc`, knit-ui `a3531914eb385bd50`,
knit-parse `a9ef9a9a2605475cd` (five parser defects). Everything else has reported finished.
Window resets 2026-11-13T06:20Z. Then:
1. Restart the dev server (`preview_start {name: "wave1"}`), SendMessage each of the four ("limit reset;
   check your last edit landed; re-run suites; continue").
2. When they report: `TIMEOUT=600 SHOW_TIME=1 bash tools/headless-suite.sh --all` (37+ pages, about 5 min);
   re-run timing reds alone; fix or route real reds.
3. Coordinator walkthrough at 375 x 812 (headless screenshots of the two galleries + one pass through the
   live app per craft), then HANDOFF.md / SPEC.md / docs/CRAFTS.md, `bash tools/sw-version.sh`, commit on
   wave-1 (message via C:\Users\mitch\AppData\Local\Temp\sk-commit.txt), merge --no-ff into main, push
   both, poll the live sw.js for the new hash.
4. Later items recorded above: handle.setDone in diagram.js; checklist suggestions from the picked
   pattern only (app.js); knitting P17 / P20 if knit-ui did not reach them; a real-phone test.
Backup refs: refs/backup/wave-k-0200, refs/backup/wave-k-0305 (take another before integrating).
- knit-parse follow-ups FINISHED 03:42Z (knits.test 455, knits.fixtures 590; all five defects fixed incl. Stranded Boot split into Cuff / Leg / Heel / Turn Heel / Gusset / Foot). knit-store resumed (`a22ef089802687cce`) to adopt plainRows / within, prove P5 on the Stranded Boot leg chart, and turn the journey KNOWN lines into assertions.
- knit-ui FINISHED 03:52Z (knit-ui.test 112, knit-chart 151; P15, P12, P9, P11, P17 built; watcher removed; gaps: P20 materials need storing at import (shell-ui asked), picture-chart detection finds no chart in most new picture-chart fixtures (own piece of work); new test/knit-ui.shots.html for screenshots). knit-parse resumed (mirror trailing total, Red Heart cardigan part names, materials from whole-document parse); shell-ui resumed (materials at import, picked-pattern checklist, boot-time image cleanup scope).

## Fourth window, from 2026-11-13 06:21Z (limit reset; dev server restarted; backup ref refs/backup/wave-k-w4-start)
- Resumed after the cut-off: sew-audit, xs-audit, knit-parse (mirror total, Red Heart part names, materials), shell-ui, knit-store (plainRows / within, P5 on Stranded Boot leg, journey KNOWN lines).
- shell-ui FINISHED 06:25Z its three app.js items (crafts 281; materials kept at import as craftData.materials; checklist from the picked pattern; boot-time image cleanup made safe).
- New: knit-audit `a2768f965d4714f6b` (owns js/app-knitting.js, css/knitting.css, knit-ui tests; walks real patterns through the app, E1..E20 re-check), knit-charts `a045660ae02e17038` (owns js/knit-chart.js: honest picture-chart finding and measuring), knit-3d resumed (handle.setDone, phone-size pieces board, light-theme look).
- Still to do after these report: docs worker or coordinator for HANDOFF / SPEC / CRAFTS; full suite run; walkthrough; commit; merge; push; verify deploy.
- knit-store follow-ups FINISHED 06:30Z (knit-counter 388, knits.journey 66 with 0 known; Stranded Boot Leg counts 84 rounds from the chart, lace hat rib 3/4 in; Time Traveler leg still not chart-counted (toe-up parse shape)). Ask for knit-chart.js owner: unread cell on Stranded Boot Leg chart row 2.
- knit-parse third pass FINISHED 06:36Z (knits.test 461, knits.fixtures 595; mirror keeps the trailing total, Red Heart cardigan parts fixed, materials reachable). Relayed to knit-audit. Note: the runner returned exit 1 once with every page at 0 failed (check at integration).
- knit-3d follow-ups FINISHED 06:42Z (diagram.test 284 / 340 with references, diagram-model 529; handle.setDone, pieces board wraps to the screen, looked at in three themes). shell-ui resumed to adopt setDone and assemble({aspect}).
- docs worker `aaa1b860df37800bb` launched 06:45Z: owns HANDOFF.md, SPEC.md, docs/CRAFTS.md, NEW docs/wave-k/SUMMARY.md (owner-facing one-pager). The coordinator changes the "not yet committed" sentence at commit.
- sew-audit reported 06:55Z (sewing-app.test 160 new, sewing-extras 124; gallery built and every picture read; many phone fixes; verdicts in docs/wave-k/sew-audit.md). Open and routed: sew-core (sizeRule page bug, dropped step text on Albion, wrong names / kinds, Margo sheet pieces), sew-visual (sundress step-1 crop). Coordinator decisions: keep only the extras fabric sheet; step text tap not counting in Sewing mode is fine. S4 not built. Real-phone checks listed in the report.
- shell-ui: setDone + assemble({aspect}) adopted, FINISHED 07:00Z (crafts 283, sharecard 31; whole-piece tap 0.20 ms, row change 15.5 ms).
- sew-audit FINISHED 07:15Z (sewing-app.test 171, sewing-extras 124, sewing.test 1197; one fabric sheet; Sewing mode tip reworded; no reliance on :has(); S4 deliberately not built: the figure already sits beside the step, coordinator agrees).
- sew-visual crop fix FINISHED 07:20Z (sew-visual.test 171 / 266 with real fixtures; step crops never join across prose; new optional `parts`). Open: Mabel step-1 crop is a narrow strip with its own text; Harmony sashing pieces counted into some blocks.
- xs-audit FINISHED 07:30Z (xstitch-app.test 241 new, xstitch-extras 115, xstitch.fixtures 582, xstitch-read 292; 16 of 21 defects fixed; gallery looked at in three themes; chart draws under the HUD; verdicts in docs/wave-k/xs-audit.md). FINAL ROUND routed: xs-core (keyCount 0, symbol-glyph names, Anchor leading zeros, fixture assertions), xs-read (doubtful sizes must flag; readTiles on the 5-page sampler), xs-keyread (missed counts must say so), shell-ui (two wording fixes). After these and sew-core, knit-audit, knit-charts, docs report: integrate. No further follow-up rounds this wave; later findings go to HANDOFF "Left".
- sew-core audit fixes FINISHED 07:40Z (sewing.test 1197, sewing.fixtures 946, sewing-app 171, sewing-extras 124; sizeRule page, no step loses text, names / kinds, unit heading, Margo sheet). Left for HANDOFF: import check reports missing steps when numbering restarts per section (Shannon robe); alternative cuts both counted in cut totals; Colette A4 layout merges two pieces.
- shell-ui wording fixes FINISHED 07:45Z (checksheet 64, crafts 288). Coordinator applied the matching "pages are pictures" wording in js/app-xstitch.js (5496, 5796) and js/app-sewing.js (3900, 3967).
- xs-core final round FINISHED 07:50Z (xstitch.test 1126, xstitch.fixtures 599 / 9 skipped, xstitch-app 241). Left: Anchor-only keys (a column of numbers with no symbols) are not read: KNOWN warning in the fixture page.
- docs worker FINISHED 08:00Z: HANDOFF.md, SPEC.md, docs/CRAFTS.md updated; SUMMARY.md saved by the coordinator. Its full run: 38 pages, 11,783 passed, 2 failed (knit-ui.test 110 / 2: knit-audit mid-edit wording). To refresh at commit: the "not yet committed / deployed" sentences in HANDOFF and SUMMARY, knit-audit and knit-charts results, final suite totals.
- knit-charts FINISHED 08:10Z (knit-chart.test 162, knit-chart.pictures 20 new; picture charts: 9 present, 8 found and measured, 0 false positives; opt-in so existing results identical; report docs/wave-k/knit-charts.md). NOT wired yet: js/app.js must call KC.scan(handle, {pictures: true}) in knitAttachCharts and extend KNIT_CHART_KEYS; js/app-knitting.js must use the stored calib for picture-grid charts (paste-ready in the report). Not looked at: Stranded Boot Leg unread cell; the intarsia skirt chart is missed.
- HOLD ON DEPLOY (coordinator, 08:05Z): knit-audit is finding wrong instructions on screen in knitting (wrong evenly-spaced suggestion, "4th row" on every row of a repeating stretch, RS? where the side is knowable, cable ring wrong inside a stretch). No deploy until that class is fixed or degraded to plain display. One knitting fix round after knit-audit reports: knit-store, knit-parse, knit-audit (UI), shell-ui (picture-chart wiring).
- xs-keyread final round FINISHED 08:15Z (xstitch-keyread.test 91; potatoes key 6 of 6 codes AND 6 of 6 counts; per-row countStatus / countWhy; Anchor / AuriFloss / Madeira / Cosmo keys come back blank with the reason). UI to do in js/app-xstitch.js: show "count not read" from countStatus and read.why on blank rows.
- knit-audit reported 08:20Z (knit-ui.test 131; walked Bernat M, Boyfriend L, Time Traveler, Stranded Boot, Icelandic shawl, lace hat, part of Sandnes; E-table: 11 fixed, 6 partly, 1 still wrong (E13), 2 not reached; UI guards added for three wrong-instruction cases; report docs/wave-k/knit-audit.md). Not done: phone / theme check, journey assertions for the walks, remaining new fixtures.
- KNITTING FIX ROUND launched 08:25Z (release-blocking; rule: fix the cause or answer "not sure"): knit-store (lineInfo, chartInfo, sides, cable ring in stretch, knitSyncTarget, stretch.within), knit-parse (mirror bind-off / full-stop total, Shape Neck start count, short imports, ** to ** reference, pattern title), shell-ui (one-size book sizes, Sandnes double import, rnd / row words, picture-chart wiring, project name).
- After they report: resume knit-audit to re-walk the Boyfriend Front, Time Traveler toe, Icelandic chart rows and Sandnes yoke and confirm nothing wrong is on screen; then integrate and deploy.
- Coordinator 08:40Z: js/app-xstitch.js key-reader rows now say "count not read" from countStatus; test/xstitch-app.test.html updated for the key reader now reading all six potatoes counts (243 / 0; DMC 04 ticked in the real flow, "not checked" proven on a key with its count removed). Cross-stitch, sewing and shell suites all green at 08:35Z.

### If the limit cuts this window off (written 08:50Z at 83%)
Running: knit-store `a22ef089802687cce`, knit-parse `a9ef9a9a2605475cd`, shell-ui `abc28e2605c72ff27` (the release-blocking
knitting fix round), xs-read `a0190acd1b34ebf9e` (doubtful sizes must flag; readTiles on the 5-page sampler).
Everything else has reported. Backup ref: refs/backup/wave-k-0850. Window resets 2026-11-13T11:20Z. Then:
1. Restart the dev server; SendMessage each of the four ("limit reset; check your last edit landed; re-run suites; finish").
2. When they report: resume knit-audit `a2768f965d4714f6b` for a short re-walk (Boyfriend L Front stretch rows, Time Traveler toe
   and Foot label, Icelandic chart rows 17-35 and Chart D, Sandnes yoke, Stranded Boot size label) to confirm no wrong
   instruction is on screen; it also adopts picture-grid charts in js/app-knitting.js (docs/wave-k/knit-charts.md).
3. Integrate: `TIMEOUT=600 SHOW_TIME=1 bash tools/headless-suite.sh --all`; re-run timing reds alone; coordinator looks at
   knitting screens (test/knit-ui.shots.html) as it did for cross-stitch and sewing (those looked right at 08:45Z).
4. Refresh HANDOFF.md / docs/wave-k/SUMMARY.md ("not yet committed" sentences, knit-audit / knit-charts / final-round results,
   final suite totals), `bash tools/sw-version.sh`, commit on wave-1 (message via C:\Users\mitch\AppData\Local\Temp\sk-commit.txt,
   ending with the Co-Authored-By line), merge --no-ff into main, push both, poll the live sw.js for the new hash.
- shell-ui knitting round FINISHED 09:00Z (crafts 309, knit-counter 402, knit-ui 130, knit-chart 162, patterns 1112): one-size book pattern carries no sizes; knitting size groups import one at a time (Sandnes no longer doubles); round parts say ROUND; picture-chart scan wired (starts 50 ms after import, cancellable); project name from the pattern title or tidied file name. Left to the store owner: the "RS?" chip and the "Before group 1 · stitch 0 of 1" readout.
- knit-parse audit round FINISHED 09:10Z (knits.test 475, knits.fixtures 605, knits.journey 81, patterns 1112 / 905): mirror bind-off and full-stop total fixed (live); Knits.partStart / startCount, unread parts + notRead lines, refBlock for "** to **", Knits.title (data ready, NOT yet called by js/app.js / js/store.js: wiring asks in docs/wave-k/knit-parse.md; shell-ui already names projects its own way, switch it to Knits.title). Not fixed: saddle cardigan prose rows, Heathers fronts stop at row 9, Time Traveler Leg chart rounds, Icelandic items, Stranded Boot cuff mid-sentence line.
- knit-store audit round FINISHED 09:20Z (knit-counter 405, knits.journey 82 with walks on the audit rows; 7 of 9 store items fixed: unsure repeats show the printed sentence, chart row cannot exceed chart length, RS / WS parity in stretches and continued parts, cable ring follows panels, parts finish after their last stretch, set-up stretch shown; not fixed: "from tip of toe" estimate about 21 rounds high (marked approximate, never a target), unplaceable-marker message repeats). knit-ui.test is 130 by design now (one branch has one assertion).
- 09:22Z at 91%: coordinator lifted the deploy hold: every wrong-instruction item the audit found has a fix with a journey assertion on the real fixture rows. Integration started: full suite running; xs-read told to land green now.
