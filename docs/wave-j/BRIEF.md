# Wave J — read a chart from a picture. Shared brief for every worker

Goal of this wave (the owner's request, 2026-11-11): a cross-stitcher drops a **picture of a chart**
(a screenshot, an image file, or a PDF whose chart is a picture) and gets a real, countable chart
plus **written row-by-row instructions**, all on the device. **No inference, no network, no
per-user cost**; classic image arithmetic only. The colour key's own stitch counts are the
checksum that tells the user (and us) whether the read is right. Accuracy stays the bar: a wrong
chart presented as right is worse than an honest "I could not read this".

This is NOT the photo → chart converter (`js/xstitch-photo.js`), which invents a chart from any
photo. This wave recovers the chart that is already in the picture, one cell per stitch.

The binding interface between the three workers is `docs/wave-j/CONTRACT.md`. Read it before
anything else. If you must deviate, do it, and record it under "Contract changes" in your report.

## The owner's example (the acceptance case)
`tmp-pdf/xs-potatoes-preview.webp` and `tmp-pdf/xs-potatoes-key.png` are the owner's two phone
screenshots of a 5-page PDF ("Chart imported from image", design size 144 x 85 stitches, a
"Floss list for crosses" key with N / Symbol / Number / Name / Stitches columns, six DMC colours,
5,721 stitches). The PDF itself is not on this machine yet. `tmp-pdf/xs-potatoes.key.json` holds
the key as read off the screenshot by the coordinator (codes, names, stitch counts, design size).
The preview screenshot is a "stitched look" render at roughly 6 px per stitch with WebP artefacts:
a deliberately hard, real input.

## Where and how
- Work ONLY in the git worktree `C:\Users\mitch\CrochetBs-wave1` (branch `wave-1`). Never touch
  `C:\Users\mitch\CrochetBs` (that is `main`). Do NOT commit or push; the coordinator commits.
- Plain HTML/CSS/JS PWA, no build step, no ES modules: ES5 IIFEs, one `window` global per file.
  Read `HANDOFF.md` ("How to work on it" and the cross-stitch paragraphs), `docs/CRAFTS.md` and
  `docs/research/cross-stitch.md` (the B2 data model) before editing.
- Strict file ownership (listed in your task). Files you do not own: read freely, never edit.
  If you need a change there, write it up under "For the owner of <file>" in your report.
  Never use Write on a file that is shared with another agent; use Edit (string replacement)
  so concurrent edits in other regions survive.
- `tmp-pdf/` is gitignored and copyrighted. Read it at runtime from test pages; never copy its
  content into a committed file, never save anything into it or into the repo root. Do not
  download files. Committed tests use synthetic charts you generate in code.
- Dev server for this worktree: http://localhost:8766 (launch config `wave1`;
  `preview_start {name:"wave1"}` reuses it). Open your OWN browser tab with `tabs_create` and pass
  that `tabId` to every browser call; other agents share the pane. The pane's localStorage is
  scratch; use `Store.__setKeyForTests('stitchkeeper-<your-name>')` for in-app checks. Never take
  desktop screenshots, never sign in anywhere. On localhost the service worker is network-first:
  just reload after edits. pdf.js cannot draw pages while the pane is hidden (see HANDOFF).
- Test pages: http://localhost:8766/test/<name>.test.html, each shows `#summary` "N passed,
  M failed" (read with get_page_text). **Before your first edit, run every suite that touches a
  file you own and write down the counts as your baseline** (xstitch, xstitch.fixtures,
  xstitch-photo, crafts, sw, and anything else relevant). Every fix and every feature gets an
  assertion. Your suites must be green when you finish, with counts at or above the baseline.
- Do not edit `HANDOFF.md`, `SPEC.md` or `docs/CRAFTS.md`. Write what you built and decided to
  `docs/wave-j/<your-name>.md`: the feature as the user sees it, the contract as built, measured
  accuracy (real numbers, including the ones that are not good), what you verified in the pane and
  at which sizes, what is left and why, and "For the owner of <file>" notes.
- Honesty rules: report measured accuracy per fixture, never a blanket claim. When a read is not
  trustworthy the code must say so (`ok: false` or a low-confidence result with reasons), and the
  UI must show it. Never guess a colour silently.
- If the API returns a rate-limit error, wait and retry; do not abandon a half-done edit.
- Finish with a short report in your final message: files changed, suites and counts, measured
  accuracy on the acceptance case, features done vs left, anything the coordinator must decide.
