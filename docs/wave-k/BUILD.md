# Wave K — build brief. Shared by every build worker

The owner signed off on **all** the brainstorm proposals (2026-11-12): "go with all the ideas and I
approve downloading more." The proposals live in `docs/wave-k/brainstorm/` (00 parity matrix,
01 knitting, 02 cross-stitch, 03 sewing, 04 visual and recognition). Each worker builds the
proposals named in its task, to the standard the proposal's own "how we would know it is right"
sets. Accuracy stays the bar: an honest "could not read this" beats a confident wrong answer.

## Decisions the coordinator has made (do not re-open; note disagreement in your report)
- **No per-user running cost.** Everything on the device. No server, no LLM, no telemetry.
- **Text recognition**: narrow in-house readers first (glyph templates, the "cipher" key solver).
  A vendored open-source engine (Tesseract, Apache-2.0) is an **opt-in, lazy, one-time download
  that is never precached**; it is a fallback, never the default path.
- **A check that says "off" demotes "Use it"** to a secondary button behind a plain confirm; it
  never blocks the user and never hides the disagreement.
- **Estimated numbers** (gauge-based row targets, finish dates, computed counts) are always marked
  ≈ and only become a target when the maker taps "Use".
- **Units** follow the pattern's own units, with a per-project switch; calculators accept both.
- **The pattern's own symbols and fabrics** are shown when they were captured cleanly, else the
  app's own; never a half-read symbol.
- **Everything is free for now**; nothing is gated as Pro in this wave.
- **Sounds**: `js/audio.js` is silent on localhost so testing never plays through the owner's
  speakers. Never set `localStorage['thready.devSound']`.

## Where and how (same rules as every wave)
- Work ONLY in `C:\Users\mitch\CrochetBs-wave1` (branch `wave-1`). Never touch
  `C:\Users\mitch\CrochetBs`. Do NOT commit or push; the coordinator commits between batches.
- Plain HTML/CSS/JS, no build step, no ES modules: ES5 IIFEs, one `window` global per file.
  Read `HANDOFF.md` ("How to work on it" above all), `docs/CRAFTS.md`, and the docs for your area.
- **Strict file ownership**, listed in your task. Files you do not own: read freely, never edit.
  Requests go under "For the owner of <file>" in your report. On a file anyone else might touch,
  use Edit (string replacement), never Write. New files you create are yours.
- **Publish your interface first.** Within your first few minutes of design, write
  `docs/wave-k/api/<your-name>.md`: the globals, functions, option and result shapes, events and
  CSS hooks other workers will call. Keep it current as you build. Other workers read these files
  instead of guessing; when another worker's API file does not exist yet, feature-detect and
  degrade quietly.
- `tmp-pdf/` is gitignored and copyrighted: read it at runtime from test pages; never copy its
  content into a committed file. Committed tests use synthetic data you generate in code. New
  fixtures arrive there during this wave (see `tmp-pdf/SOURCES.md` and
  `docs/wave-k/fixtures.md`); a fixture page must skip cleanly when a file is absent.
- Dev server: http://localhost:8766 (`preview_start {name: "wave1"}`). Your OWN tab
  (`tabs_create`, pass `tabId` everywhere). `Store.__setKeyForTests('stitchkeeper-wavek-<name>')`
  for private state; delete your projects and their BlobStore `p:<id>:` entries when done.
  pdf.js cannot render while the pane is hidden (HANDOFF explains; shim rAF in your tab only).
  Many workers share this machine: suites can run slow or flake while others save files; let a
  file settle and re-run before believing a failure, and never "fix" a red test that another
  worker's half-saved file caused.
- **Tests**: before your first edit, run every suite that touches a file you own and record the
  counts as your baseline in your report. Every feature and every fix gets an assertion. At the
  end your suites are green at or above baseline, including the fixture pages your change can
  reach (a `js/pdftext.js` change reaches every fixture page; `js/patterns.js` reaches knitting).
  `test/sw.test.html` fails when a script in `index.html` is missing from `sw.js` PRECACHE_URLS:
  new runtime files need both, and both lines belong to the shell-ui worker (ask in your report,
  and load your file from your own test page meanwhile).
- UI quality: phone first (375 × 812 and 375 × 640), then desktop; theme variables only (check
  Stardrop Night, Pixel Wyrm and one light theme); plain wording, no jargon; keyboard and
  screen-reader paths per the module's conventions; nothing heavy on the main thread.
- Do not edit `HANDOFF.md`, `SPEC.md` or `docs/CRAFTS.md`. Write `docs/wave-k/<your-name>.md`:
  what the user sees, the contract as built, measured results (real numbers, including bad ones),
  what you verified in the pane and at which sizes, what is left and why, "For the owner of
  <file>" notes, and decisions the coordinator must make.
- If the API returns a rate-limit error, wait and retry; never abandon a half-done edit.
- Finish with a short final message: files changed, suites and counts, proposals done / partly /
  not done (by their numbers), measured results, asks.

## Ownership map for this wave (batch 1 = engines and shell; batch 2 = craft apps, knitting, galleries)
| Worker | Owns |
|---|---|
| fixtures | `tmp-pdf/` additions, `tmp-pdf/SOURCES.md`, `docs/wave-k/fixtures.md` |
| pdftext | `js/pdftext.js`, `test/pdftext*.html` |
| shell-data | `js/store.js`, `js/blobstore.js`, `js/zip.js`, `test/store-safety.test.html`, `test/backup.test.html`, `test/templates.test.html`, `test/blobstore.test.html` |
| shell-ui | `js/app.js`, `css/app.css`, `css/themes.css`, `index.html`, `sw.js`, `js/tour.js`, `test/crafts.test.html`, `test/sw.test.html`, NEW `js/workmode.js`, `js/checksheet.js`, `js/sharecard.js` |
| xs-core | `js/xstitch.js`, `test/xstitch.test.html`, `test/xstitch.fixtures.html` |
| xs-read | `js/xstitch-read.js`, `test/xstitch-read.test.html` |
| xs-keyread | NEW `js/xstitch-keyread.js`, `test/xstitch-keyread.test.html` |
| xs-render | NEW `js/xstitch-render.js`, `test/xstitch-render.test.html` |
| sew-core | `js/sewing.js`, `test/sewing.test.html`, `test/sewing.fixtures.html` |
| sew-visual | NEW `js/sew-figures.js`, `js/sew-quilt.js`, `test/sew-visual.test.html` |
| ocr | NEW `js/ocr.js`, `js/vendor/tesseract/`, `test/ocr.test.html` |
| batch 2: xs-app | `js/app-xstitch.js`, `css/xstitch.css` |
| batch 2: sew-app | `js/app-sewing.js`, `css/sewing.css` |
| batch 2: knitting workers | `js/knits.js`, `js/patterns.js`, `js/knit-chart.js`, `js/app-knitting.js`, `js/diagram-geo.js`, `js/diagram.js`, their tests |
| batch 2: galleries | NEW `test/xstitch.gallery.html`, `test/sewing.gallery.html`, `test/sewing-app.test.html` |

## Added on resume (2026-11-12, second session). Binding for everyone

- **Run suites headless, not in the pane.** From the worktree:
  `bash tools/headless-suite.sh sewing.test xstitch.test` (names under `test/`, no `.html`;
  `BUDGET=180000` in front for slow fixture pages). It prints each page's summary line, uses a
  throwaway profile (so it never touches the pane's storage), and pdf.js renders fine in it. A page
  that prints "no summary" needs a bigger BUDGET or a real tab.
- **The Browser pane is for looking, not for running suites.** It ran out of tabs last session.
  One tab each at most, opened only when you need to see or drive the real UI, closed
  (`tabs_close`) as soon as you are done. If `tabs_create` fails, do not wait for one: test
  headless, and for a picture use
  `"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --mute-audio --user-data-dir=<a temp dir of your own> --window-size=375,812 --virtual-time-budget=20000 --screenshot=<png in your temp dir> <url>`
  and Read the PNG. Never write screenshots or temp files into the repo.
- **The dev server was restarted**; tab ids from last session are gone.
- **Finish cleanly rather than widely.** The session budget is finite and a worker stopped
  mid-edit costs a full re-read to resume. Land what you have green first, write your report, then
  go on to the next proposal. Keep your report file current as you go, so a stop loses nothing.

### Knitting ownership (batch 2, launched in pieces)
| Worker | Owns |
|---|---|
| knit-parse | `js/knits.js`, the knitting-only paths of `js/patterns.js`, `test/knits*.html` |
| knit-store | the knitting regions of `js/store.js` (row index, `lineForRow`, `chartInfo`, markers, stretches), by Edit only and only after reading the file fresh; `test/knit-counter.test.html`, NEW `test/knits.journey.html` |
| knit-ui | `js/app-knitting.js`, `js/knit-chart.js`, NEW `css/knitting.css`, their tests |
| knit-3d | `js/diagram-geo.js`, `js/diagram.js`, `test/diagram*.html` |

### Craft screens are split in two (batch 2)
| Worker | Owns |
|---|---|
| xs-app | `js/app-xstitch.js`, `css/xstitch.css`: the chart screen and import flows |
| xs-extras | `js/app-xstitch-extras.js` (`window.XStitchExtras`), `css/xstitch-extras.css`, NEW `test/xstitch-extras.test.html`: self-contained sheets (sessions and goals, stash, brands, calculators, printable, replay, framed share, joining files) |
| sew-app | `js/app-sewing.js`, `css/sewing.css`: the step screen, working mode, sizes, sheets |
| sew-extras | `js/app-sewing-extras.js` (`window.SewingExtras`), `css/sewing-extras.css`, NEW `test/sewing-extras.test.html`: self-contained sheets (cutting board, quilt top, quilt and fabric calculators, swatches, timers, glossary, fitting log) |

The extras contract is fixed and tiny so neither side waits: `Extras.menuItems(project)` returns
`[{ id, label, icon, hint }]` for what applies to this project, and `Extras.open(id, project, opts)`
opens that sheet (returns false when unknown). The app worker lists those items in the project's
"⋯" menu (and may deep-link with `open`); the extras worker never edits the app file. Anything
more goes in each side's API doc (`docs/wave-k/api/<name>.md`).

Crochet must not change in this wave: every crochet suite and fixture page stays at its count,
and crochet row numbering is untouched (stretch phases apply to knitting projects only).

- Pages that wait on IndexedDB (`store-safety.test`, `backup.test`, `blobstore.test`) and the very long `diagram-model.test` print no summary under the headless runner: run those in a real tab (one tab, closed after).
