# Wave I — focus mode. Shared brief for every worker

Goal of this wave: the owner's two phone requests — a bigger pattern-line strip on the counter, and a
full-screen "working mode" built around the 3D view where the maker can actually count — plus a
group-readout bug seen in their screenshot. Accuracy stays the bar.

## Where and how
- Work ONLY in the git worktree `C:\Users\mitch\CrochetBs-wave1` (branch `wave-1`). Never touch
  `C:\Users\mitch\CrochetBs` (that is `main`). Do NOT commit or push; the coordinator commits.
- Plain HTML/CSS/JS PWA, no build step, no ES modules: ES5 IIFEs, one `window` global per file.
  Read `HANDOFF.md`, `SPEC.md` (the sections for your area) and `docs/CRAFTS.md` before editing.
- Strict file ownership (listed in your task). Files you do not own: read freely, never edit.
  If you need a change there, write it up under "For the owner of <file>" in your report.
  Never use Write on a file that is shared with another agent; use Edit (string replacement)
  so concurrent edits in other regions survive.
- `tmp-pdf/` is gitignored and copyrighted. Read it, never copy it anywhere, never save anything
  into it or into the repo root. Do not download files. Provenance is in `tmp-pdf/SOURCES.md`.
- Dev server for this worktree is already running at http://localhost:8766 (launch config
  `wave1`; `preview_start {name:"wave1"}` reuses it). Open your OWN browser tab with
  `tabs_create` and pass that `tabId` to every browser call; other agents share the pane. The
  pane's localStorage is scratch. Never take desktop screenshots, never sign in anywhere.
  On localhost the service worker is network-first: just reload after edits.
- Test pages: http://localhost:8766/test/<name>.test.html, each shows `#summary` "N passed,
  M failed" (read with get_page_text). Current green baseline: patterns 1067, patterns.fixtures 895 (910 with `?heavy=1`), knits 373, knits.fixtures 530 (533 heavy, +11 known), knit-counter 317, knit-chart 151, xstitch 752, xstitch.fixtures 493 (+9 skipped), xstitch-photo 131, sewing 963, sewing.fixtures 789, pdftext 168 (171 heavy), diagram 260 unit + 316 after "Load reference fixtures", diagram-model 529, store-safety 307, backup 205, crafts 124, templates 147, sw 29, blobstore 65. Fixture pages are test/patterns.fixtures.html, test/xstitch.fixtures.html, test/sewing.fixtures.html (no `.test`); open them in a FRESH tab (sessionStorage caches extracted text).
  Every fix gets an assertion. Your suites must be green when you finish, and you must re-run
  every suite that touches a file you edited (patterns.js → patterns + patterns.fixtures +
  templates + crafts; store.js → store-safety + backup + diagram-model + templates; etc.).
- Do not edit `HANDOFF.md`, `SPEC.md` or `docs/CRAFTS.md` (a docs agent integrates afterwards).
  Write what you built and decided to `docs/wave-i/<your-name>.md`: the feature as the user sees it,
  the contract (new fields, options, registration hooks, settings keys), what you verified in the
  pane and at which sizes, what is left and why, and "For the owner of <file>" notes.
- If the API returns a rate-limit error, wait and retry; do not abandon a half-done edit.
- Finish with a short report in your final message: files changed, suites and counts, the
  features done vs left, anything the coordinator must decide.
