# Wave E — accuracy. Shared brief for every worker

Goal of this wave: make the app *as accurate as possible*. Accuracy means: what the app shows
(part names, Make N, round/row counts, stitch counts, targets, placement notes, colour keys,
cutting lists, the 3D shape) matches what the pattern PDF actually says and what the finished
object actually looks like. Ground truth is the PDF itself, read with the Read tool (use the
`pages` parameter), and the photos in it. Never guess from the parser's own output.

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
  M failed" (read with get_page_text). Current green baseline: patterns 929, patterns.fixtures
  711 (`?heavy=1` for files > 17 MB), diagram 153 + 180 after clicking "Reload reference
  fixtures", diagram-model 503, store-safety 210, backup 102, crafts 124, templates 94, sw 27,
  sewing 803 / sewing.fixtures 682, xstitch 675 / xstitch.fixtures 436 (+9 skipped).
  Every fix gets an assertion. Your suites must be green when you finish, and you must re-run
  every suite that touches a file you edited (patterns.js → patterns + patterns.fixtures +
  templates + crafts; store.js → store-safety + backup + diagram-model + templates; etc.).
- Do not edit `HANDOFF.md`, `SPEC.md` or `docs/CRAFTS.md` (a docs agent integrates afterwards).
  Write your findings and decisions to `docs/wave-e/<your-name>.md`: a discrepancy table
  (fixture, part/section, what the PDF says, what the app said, fixed? assertion name), the
  rules you added, what is still wrong and why, and "For the owner of <file>" notes.
- If the API returns a rate-limit error, wait and retry; do not abandon a half-done edit.
- Finish with a short report in your final message: files changed, suites and counts, the
  discrepancies fixed vs left, anything the coordinator must decide.
