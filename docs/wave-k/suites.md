# Wave K: test suites and the headless runner

Snapshot taken 2026-11-12, about 19:30 to 19:50, on the shared machine with 13 or more
agents busy. Several pages were being edited while this was recorded, so their counts moved
between runs (for example `knits.test` went 419, 431, 449). Treat the counts as a snapshot,
not a baseline.

## The runner

```sh
bash tools/headless-suite.sh blobstore.test pdftext.test        # names under test/, .html optional
bash tools/headless-suite.sh 'sew-visual.test?real=1'           # query strings work
bash tools/headless-suite.sh --all                              # every test page (or ALL=1)
JOBS=2 TIMEOUT=600 SHOW_TIME=1 bash tools/headless-suite.sh --all
DUMP=/c/some/temp/dir bash tools/headless-suite.sh knits.fixtures   # also save each page's text
VIRTUAL=1 bash tools/headless-suite.sh knits.test               # the old virtual-time path
```

It prints one `name: summary` line per page, in the order you gave them, and exits non-zero
if any page failed, timed out or printed no summary.

**Real time is the default.** For each page, `tools/cdp-page.ps1` (PowerShell 5.1, no Node
or Python needed) starts headless Chrome (or Edge if Chrome is missing) with a throwaway
profile and `--remote-debugging-port=0`. It reads the port the browser actually got from
`DevToolsActivePort`, so two agents never fight over a port. It then connects to the page
over the DevTools websocket and asks for `#summary`'s text once a second. It stops when the
text has a final `N passed, M failed` and no longer says `running`, or after `TIMEOUT`
seconds (default 180). Up to `JOBS` pages run at once (default 3). Audio is always muted,
and background networking, component updates and the crash reporter are switched off, so
nothing is sent anywhere.

**Cleanup.** Each page's browser tree is killed with `taskkill /T` when the page finishes
or times out, and its profile is deleted. The bash exit trap also runs on Ctrl-C and on
TERM. It kills every runner PowerShell and every chrome/msedge process whose command line
names this run's temp directory, so it never touches the Browser pane or other agents'
browsers. Then it deletes that directory, retrying while Windows still holds a file. This
was tested by sending TERM partway through a two-page run: 24 browser and runner processes
were gone afterwards and the directory was removed. A page that times out prints
`(timed out after N s; summary was: ...)`. A missing page prints
`(page has no #summary element)`.

**DUMP=dir** writes each page's `document.body.innerText` to `dir/<name>.txt` when the page
finishes or times out. Run `grep '^FAIL' dir/*.txt` to see which assertions failed or were
skipped. Keep `dir` outside the repo: fixture pages print text that comes from `tmp-pdf`.

**What `--all` runs.** It runs every `test/*.html` whose source has `id="summary"` and
writes a `' passed, '` line. That rule skips these pages on its own:

| skipped | why |
|---|---|
| `celebrate.test.html` | a demo page with buttons; it has no `#summary` and no assertions |
| `diagram.gallery.html`, `sewing.gallery.html` | visual galleries, no pass/fail line |
| `pdftext.dump.html` | dev dump tool; its summary is `done` or `rendered N` |
| `pdftext.corpus.html` | dev fingerprint tool; its summary is `N files, corpus <hash>, 0 failed`, with no "passed" |
| `diagram.knit-synth.js` | a helper script, not a page |
| `_*.html` (e.g. `_tmp_xscore_probe.html`) | someone's scratch probe |

A new test page is picked up automatically if it follows the usual
`passed + ' passed, ' + failed + ' failed'` pattern.

**Confirmed in real-time mode:** pdf.js loads and renders. In `pdftext.test`, the
"renderPage cancel / a later render still draws" checks ran instead of skipping as
"tab is not painting frames". IndexedDB works: `blobstore`, `store-safety` and `backup` all
pass. WebGL works: `diagram.test` reports "WebGL renderer active". Workers work: the OCR,
`xstitch-read` and photo pages pass. A page in the headless browser counts as visible, so
background-tab throttling does not apply.

## The table

Counts are passed / failed from the second full `--all` run (`JOBS=3`, `TIMEOUT=600`).
Pages that changed afterwards were re-run on their own, and those later numbers are shown.
"Time" is wall-clock seconds under that load. "Virtual" is what the old
`VIRTUAL=1 BUDGET=60000` path printed for the same page. "Real time needed" is yes when
that output was wrong: no summary, still `running…`, or reds that do not appear in real
time.

| page | passed | failed | other | time (s) | virtual (old path) | real time needed |
|---|---:|---:|---|---:|---|---|
| backup.test | 229 | 0 | | 5 | no summary | **yes** |
| blobstore.test | 78 | 0 | | 4 | `running…` | **yes** |
| checksheet.test | 58 | 0 | | 4 | 58 / 0 | no |
| crafts.test | 243 | 0 | | 9 | 243 / 0 | no |
| diagram-model.test | 529 | 0 | | 11 | no summary | **yes** |
| diagram.test | 283 | 0 | | 6 | 283 / 0 | no |
| knit-chart.test | 151 | 0 | | 7 | `running…` | **yes** |
| knit-counter.test | 378 | 0 | | 12 | 375 / **1** | **yes** (virtual time gives a false red) |
| knit-ui.test | 87 | 0 | | 7 | 87 / 0 | no |
| knits.fixtures | 574 | 0 | 11 known | 35 | no summary | **yes** |
| knits.journey | 53 | 0 | | 14 | 49 / 0 | no |
| knits.test | 449 | 0 | | 5 | 439 / **2** | **yes** (virtual time gives a false red) |
| ocr.fixtures | 4 | 0 | | 203 | `running…` | **yes** (slowest page) |
| ocr.test | 73 | 0 | | 13 | 73 / 0 | no |
| pageviewer.test | 37 | 0 | | 8 to 27 | 37 / 0 | no |
| patterns.fixtures | 905 | 0 | | 60 | no summary | **yes** |
| patterns.test | 1112 | 0 | | 10 | 1112 / 0 | no |
| pdftext.layout.test | 192 | 0 | | 26 | `running…` | **yes** |
| pdftext.test | 169 | 0 | 2 skipped (over 17 MB, need `?heavy=1`) | 38 | `running…` | **yes** |
| sew-visual.test | 168 | 0 | 0 skipped | 4 | 168 / 0 | no |
| sew-visual.test?real=1 | 245 | 0 | 0 skipped | 30 | not tried | **yes** (reads real PDFs) |
| sewing-app.test | 108 | **12** | | 13 | 108 / 12 | no |
| sewing-extras.test | 121 | 0 | | 9 | 121 / 0 | no |
| sewing.fixtures | 890 | 0 | 0 fixtures missing | 17 | no summary | **yes** |
| sewing.test | 1175 | 0 | | 5 | 1175 / 0 | no |
| sharecard.test | 31 | 0 | | 5 | 31 / 0 | no |
| store-safety.test | 472 | 0 | | 5 | no summary | **yes** |
| sw.test | 59 | 0 | | 4 | 59 / 0 | no |
| templates.test | 159 | 0 | | 4 | 159 / 0 | no |
| workmode.test | 111 | 0 | | 6 | 111 / 0 | no |
| xstitch-app.test | 201 | 0 | | 10 | 204 / 0 | no |
| xstitch-extras.test | 114 | 0 | | 5 | 114 / 0 | no |
| xstitch-keyread.test | 71 | 0 | 0 skipped | 28 | 71 / 0 | no |
| xstitch-photo.test | 131 | 0 | | 5 | `running…` | **yes** |
| xstitch-read.test | 279 | **1** | | 108 to 128 | `running…` | **yes** |
| xstitch-render.test | 62 | 0 | | 9 | 61 / 0 | no (virtual loses one assertion) |
| xstitch.fixtures | 582 | 0 | 9 skipped | 89 | no summary | **yes** |
| xstitch.test | 1119 | **1** | | 8 | 1118 / **2** | no, but its timing check is red in both |

**Headline:** 37 test pages (plus the `sew-visual?real=1` variant), **11,471 assertions**,
3 pages red. 16 pages (17 with the variant) need real time. A full `--all` run takes about
4 m 50 s at `JOBS=3` on the loaded machine, and `ocr.fixtures` alone takes about 3.5 minutes
of that. Every page finished well inside `TIMEOUT=600`. The default `TIMEOUT=180` is too
short only for `ocr.fixtures` (about 200 s), so pass `TIMEOUT=600` for `--all`.

## Reds

Each red was re-run on its own, one page at a time (`JOBS=1`), before it was recorded here.

| page | failing assertion(s) | on its own | verdict |
|---|---|---|---|
| sewing-app.test | 12 failures, all in one area: "97 / 79 / 104 cm suggests 42" got `{"size":"44"}`; "with 44 at the hip" got `[]`; "Use 42 chooses size 42" got `"44"`; the per-size hem run gives 58 cm instead of 56 cm at step 4; and the follow-on card and sheet checks | the same 12 every time, in real time and in virtual time | **real failure**, or a page and code that are out of step mid-edit (the page is new and untracked). The size suggestion picks 44 where the page expects 42 with 44 at the hip. For the owner of `js/sewing*.js` / `test/sewing-app.test.html` |
| xstitch-read.test | "detect under 400 ms (segmenter included)": 518 ms, then 469 ms on its own | still red on its own | **load / timing.** It is a wall-clock budget, and it passed (280 / 0) in the first full run. It is tight on a machine shared by 13 agents |
| xstitch.test | "parseOXS on a 350,000-cell chart is under 300 ms": 311 ms, then 315 ms on its own | still red on its own | **load / timing.** It is a wall-clock budget and passed (1120 / 0) in the first full run. It is also red under virtual time |

Reds seen once under `JOBS=3` load that were green when re-run on their own:

- `diagram.test`: 2 failures, "a cable swatch drawn coarse ... SSIM ≥ 0.9" (0.634) and "a
  whole pullover ... baked". The page grew from 281 to 283 assertions between runs, so it
  was mid-edit. It was 283 / 0 on its own and in the next full run.
- `knits.fixtures`: once "F23 -> P1: the neck stretch is closed at exactly 4 rows" (got
  open). Green on its own and in the next full run, so it looks mid-edit.
- `knit-counter.test`: once 2 failures in the 3D model parity and T3F checks (got `null`).
  Green on its own (372, then 378 / 0) while the page was still growing, so it looks
  mid-edit.

## Notes

- **Nothing in the list needs a change to run headless.** Every test page reaches a final
  summary in real-time mode.
- `pdftext.test` skips 2 files over 17 MB unless you pass `?heavy=1`. Run
  `TIMEOUT=600 bash tools/headless-suite.sh 'pdftext.test?heavy=1'` when you want those two
  (not timed here).
- `pdftext.corpus.html` can be driven the same way (`TIMEOUT=600 bash tools/headless-suite.sh
  pdftext.corpus`), but its summary has no "passed", so the runner never counts it as
  finished and reports a timeout. Read its `window.CORPUS` in a tab instead. It is a
  before/after comparison tool, not a test.
- The runner needs the dev server on `PORT` (default 8766) to be up already. It does not
  start one.
- Under heavy load, a few pages' wall-clock budgets (`xstitch-read` detect under 400 ms,
  `xstitch` parseOXS under 300 ms) can go red. If you see one, re-run that page alone with
  `JOBS=1` before you believe it.
