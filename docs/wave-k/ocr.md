# Wave K: ocr worker (proposal R4, opt-in Tesseract). Spike report

Status: spike DONE, suites green. Every number below was measured in this session; estimates say so.

## Recommendation
**Ship as opt-in, scoped:** (1) **cross-stitch keys**, read from a cropped key box with the DMC lexicon
check: the best result of the spike; (2) **scanned prose booklets** (APL Nicoll, the West End
instruction pages) as "read from a picture — check it" text. **Do not** use it for size tables, cutting
layouts, multi-column pages fed straight into a line parser, or whole pages scanned for floss codes:
those produce confident wrong answers and must stay behind "could not read this". It costs no running
money (static files, on the device) and about 3.1 MB on the wire per maker who opts in.

## What the maker would see (for shell-ui; nothing of this UI is built here)
On a page with no readable text (`emptyPages`, a scanned PDF, or a key that is part of the artwork), a
secondary button: **"Try reading this scanned page (downloads about 5 MB once)"**. Tapping it shows
"Getting the text reader… 2.1 of 4.9 MB" with Cancel, then "Reading page 4 of 17…" with Cancel. The text
arrives marked "read from a picture — check it" and the confidence banner is forced to "check every row".
Settings: "Text reader: 4.9 MB · Remove". Nothing downloads before the tap; it works offline afterwards.
For keys: "Read 8 colours from the key picture — check them", each unsure code shown as unsure.

## Contract as built
`docs/wave-k/api/ocr.md` (exact). `js/ocr.js`: ES5 IIFE, one global `window.Ocr`, about 30 KB, fetches
nothing when loaded (asserted). Engine: tesseract.js 5.1.1 + tesseract.js-core 5.1.1 LSTM-only WASM
(SIMD and plain; one is downloaded per device) + `eng` tessdata_fast. Versions, sources, sizes, SHA-256
and the Apache-2.0 notice: `js/vendor/tesseract/README.md`.

**How it is offline without the service worker.** `Ocr.install()` copies the five needed files into the
Cache Storage bucket `thready-ocr-v1`. `recognize()` reads them back as Blobs: the library is injected as
a Blob-URL script, the worker and the core run from Blob URLs, and a two-line shim inside the worker
points the core's `locateFile` at the wasm Blob and answers the worker's single
`fetch(<base>/eng.traineddata.gz)` from the traineddata Blob. Asserted: after install, starting the engine
and recognising make **zero** requests to `js/vendor/tesseract/`. (tesseract.js 5.1.1 cannot take the
traineddata as bytes: its initialize step joins the bytes into the language name, hence the shim.)

Added beyond the first draft of the contract, from the measurements:
- **Sideways pages** (`rotate`, `result.rotation`): when the upright reading's mean confidence is under 75,
  text mode also reads the picture turned 90 and 270 degrees and keeps the clearly better reading, with
  boxes mapped back. Tesseract's own orientation check needs the legacy engine (not shipped).
- **`toPlainText(r, {dropMargin: true})`**: drops running heads and a lone page number at either end of the
  text block. Without it the knitting parser took Nicoll's page numbers `[126]`… for stitch counts.
- **Whitelists include the space**, or LSTM Tesseract runs the words together (`1214161820`).
- Installs are serialised; a failed `cache.put` is retried once after deleting the key.

## Measurements (desktop: AMD Ryzen 7 3700X, Chrome headless, real time via DevTools protocol)

**Download**: 5,150,817 bytes raw per device (worker 124 KB, library 67 KB, core JS 124 KB, wasm 2.86 MB,
traineddata.gz 1.98 MB); **served ≈ 3.1 MB gzip / 2.9 MB Brotli** (the traineddata is already gzipped).
Local install 45–200 ms; on a phone the download is network-bound (estimate: 3–10 s on 4G).

**Time to first result** (engine start from the cache): 160–250 ms, then the first page.

**Seconds per page, OCR only** (rendering with pdf.js is separate, 30 ms–2 s):
| page set | 150 dpi | 200 dpi | 300 dpi |
|---|---|---|---|
| Nicoll scans p125–132 (8 pages, 396 × 756 pt) | 1.0–2.1 s (mean 1.6) | 1.1–2.0 s (mean 1.5); 1.4–3.2 s in a busier run | 1.5–2.5 s (mean 2.0) |
| typeset A4 / Letter pages (Belle, Bernat, Cascade, West End, DMC) | 0.6–4.2 s | 1.4–3.6 s | 1.7–3.9 s |
| cropped keys (≈ 600 × 400 px) | – | 0.2–0.9 s | 0.3–1.1 s |
| whole cross-stitch chart pages | – | 2.7–15 s (symbol grids are slow) | – |
| sideways page with the rotate retry (Belle p6) | – | 10.6 s (3 readings) | – |

**Memory** (renderer process working set, sampled every 2 s, includes pdf.js and page canvases):
synthetic suite 177–213 MB; Nicoll 8 pages @200 271 MB; mixed run @200 578 MB; full run with the 300 dpi
banded canvases 1,003 MB. The worker's WASM heap does not shrink until `Ocr.terminate()`; callers should
terminate after a batch. Main-thread JS heap stays 10–50 MB.

**Phone speed: not measured.** DevTools CPU throttling (x4) does not reach the dedicated worker (warm
recognise 192 ms vs 228 ms), so it cannot stand in for a phone. Estimate only: a mid Android phone runs
single-thread WASM 3–6× slower than this desktop, so about 5–10 s per scanned page at 200 dpi and a
17-page booklet in 2–3 minutes. Needs the owner's real-phone session (HANDOFF item 3).

**Accuracy**
| fixture | ground truth | result @200 dpi | @150 / @300 |
|---|---|---|---|
| Nicoll Plain Socks p125–132 (1918 scan) | 12 sentences quoted in `docs/research/knitting.md` §7a | **mean phrase CER 1.8%**, 10/12 within 2%; worst 18.2% (the "Slip 1, purl 14 … Stop right here" sentence) and 2.6%; the 4 printed-count phrases (leaving 69, reduced to 16, 80 for the round, leaves 68) **4/4 exact** | 1.9% / 1.8% |
| matryoshka key (crop) | 8 DMC + 8 Anchor, `docs/wave-e/xstitch-audit.md` | **8/8 + 8/8**, 0 extra "sure" codes | 300: same |
| autumn key (crop) | 5 DMC + 5 Anchor, read off the page by eye | **5/5 + 5/5**, 0 extra | 300: same |
| Satsuma sunshine key (crop) | 9 DMC, by eye | text 8/9, codes mode **9/9**, 0 extra | 300: text 9/9; codes 8/9 with **one confident wrong: 727 read "127" (conf ≥ 80)** |
| tapestry-painted p5 key (APL, crop) | 8 DMC, audit | **8/8**, 0 extra (watermark lines across it) | – |
| orr-book14 p19 key (APL halftone, crop) | 8 J.&P. Coats numbers, audit | 7/8 (missed "9"), names 7/8 | 300 codes mode 8/8 |
| same keys, **whole page** (no crop) | | codes 5/5–8/8 but **1–17 extra "sure" codes** from chart symbols, sizes, prose | – |
| West End p4 (image-only) | 7 measurements read off the page by eye | 6/7 exact (missed "2 1/8"), mean conf 95 | – |
| West End p9, p12 (image-only) | none | conf 91.5 / 94.5, 2% of words under 60 | – |
| Samford p9 cutting layout (sideways labels) | none | conf 46 → **74 with the rotate retry**, 26% of words under 60 | – |
| born-digital pages vs their own text layer: word recall / precision | the page's text layer at run time | Belle p3 **100% / 99%** (CER 7%); Bernat 99% / 94%; Cascade 96% / 74%; West End p5, p6 72–89% / 61–69%; DMC 2173 key 77% / 69% | West End 300: 91–94% recall |
| Belle p6 size table, printed sideways | text layer | **3% recall** upright (mean conf 63: looks plausible); 39% with the rotate retry | – |

Order-sensitive CER against the text layer is 36–60% on multi-column pages even where word recall is
96–99%: Tesseract's line order is not PdfText's column order. That is a real hazard for line parsers.

**Parser hand-off** (the existing parsers on OCR text):
- `Knits.parse` on Nicoll @200: with `dropMargin`, 23 row lines (17 begin with an ordinal; §7a has 16 heel
  rows) and **no page number taken for a count**; without it, `[126] [127] [128] [132]` became counts
  (asserted). The parser still finds none of 69/16/80/68 as counts and reads four `2`s from "knit 2
  together" prose: that is the 1918 phrasing against the parser, not OCR (the OCR text has those phrases
  exactly). Nicoll needs parser work before it is useful even with perfect text.
- `XStitch.parseKey` on the cropped key text: **0 entries** on tapestry ("DMC Cotton 816 garnet") and orr
  (J.&P. Coats). The codes are read right; the key parser does not take these layouts. Use
  `Ocr.codesFrom` + the DMC lexicon (R1's decoder) for keys instead of parseKey.

## Where it is good enough, and where it must say "could not read this"
Good enough to feed the parsers / the check screen (always "check it"):
- Cropped floss keys, born-digital raster or clean scan: 37/38 DMC codes right across five keys at 200 dpi (best mode per key), Anchor
  13/13. With the DMC lexicon every confident wrong seen (127 for 727) is caught.
- Scanned single-column prose (Nicoll, West End instruction pages): ~2% CER, confidences 94–96.
Must stay behind "could not read this" (or never be offered):
- **Size / measurement tables**, especially sideways ones (Belle p6: 3% recall with mean conf 63, i.e.
  confident-looking junk; 39% even turned). Never fill a size chart from OCR.
- **Whole chart pages for codes**: up to 17 confident non-key numbers. Crop to the key first (R2).
- **Multi-column pages straight into a line parser**: lines interleave. Render one column at a time.
- **Pages whose mean confidence is under ~75**: the reading is unreliable; say so.
- Fractions (`2 1/8`) and small superscripts: often lost; measurements need the check screen.

## Repo size impact
+8,151,212 bytes under `js/vendor/tesseract/` (both core variants, so non-SIMD phones work) plus about
84 KB of code, tests and docs. Not precached: the app install stays 4.75 MB. Per opted-in maker about
3.1 MB transferred once (10k makers ≈ 31 GB, well inside GitHub Pages' soft 100 GB a month).

## Tests
Baseline before my first edit: none (every file I own is new). Final:
- `test/ocr.test.html` **73 passed, 0 failed** (synthetic canvas text: contract, install / cancel / remove,
  no network after install, CER on clean / small / serif / noisy text, sideways pages and box mapping,
  codes and digits modes, cancel and signal, folios, lexicon folding).
- `test/ocr.fixtures.html` **4 passed, 0 failed** (default: one pass at 200 dpi; `?dpis=150,200,300`
  for the sweep; reads `../tmp-pdf` at run time, skips any file that is absent; ground truth only from the
  repo's docs, the page's own text layer, or codes/measurements read off the page by eye).
- Both green under `BUDGET=300000 bash tools/headless-suite.sh ocr.test ocr.fixtures`. Note for that
  runner: virtual time races ahead while a page waits only on a worker, so both pages keep a chain of
  small same-origin fetches pending (virtual time stands still during a fetch); timings printed under
  virtual time are not real. The real-time numbers above came from a DevTools-protocol driver.
- Environment finding: Cache Storage `put` fails ("Entry already exists") for every key when the Chrome
  profile directory path is long (the scratchpad path); a short profile path works. Not a device issue.

## What is left
- The UI (shell-ui / craft apps): the opt-in button, progress, Settings row, "check it" marking.
- PdfText integration (below), R1's lexicon decoder on top of `codesFrom`, R2's key box instead of the
  hand-drawn rects in the fixture page.
- A real-phone timing and memory session. The `best_int` traineddata (2.9 MB gz, 1 MB more) was not
  tried; the fast model already reaches ~2% CER on the scans.

## For the owner of sw.js
- **Must:** `activate` deletes every cache that is not `CACHE_NAME` in production, which would wipe
  `thready-ocr-v1` on every deploy and make makers re-download. Keep caches whose name starts with
  `thready-ocr-` (dev may keep deleting everything).
- Never add `js/vendor/tesseract/*` to `PRECACHE_URLS`; nothing else is needed (the engine reads its own
  bucket, not the shell cache). If `js/ocr.js` is loaded by `index.html`, it goes in `PRECACHE_URLS`
  like any script (30 KB) — `test/sw.test.html` checks that pairing.

## For the owner of index.html / js/app.js (shell-ui)
- Load `js/ocr.js` (no dependencies, fetches nothing) or inject it lazily on the first tap. Wording above.
  Call `Ocr.terminate()` after a batch to give back the worker's memory. Render at 200 dpi.

## For the owner of js/pdftext.js
- An additive way to give an image-only page OCR lines so `textOf` / `extract` / `layout` / `textIn` carry
  them, e.g. `handle.setPageText(n, Ocr.toTextItems(r, {scale, pageWidth, pageHeight}))`, with the lines
  marked `ocr: true` and `extract()` reporting `ocrPages: [n…]` so the UI can force "check every row".
- A4 at 300 dpi is over `MAX_RENDER_PIXELS`; the fixture page draws it in bands. 200 dpi fits in one call
  and measured as good as 300 on every fixture, so the shell should not need more.

## For the owner of js/xstitch.js
- `parseKey` returns 0 entries on OCR text of the tapestry ("DMC Cotton 816 garnet") and J.&P. Coats keys.

## For the owner of js/knits.js / js/patterns.js
- On Nicoll's 1918 prose (read at ~2% CER) the parser finds no printed counts (`leaving 69`, `leaves 68`)
  and reads `2` from "knit 2 stitches together" lines as counts.

## For the coordinator / .gitattributes
- `*.wasm` and `*.gz` should be marked `binary` in `.gitattributes` (git's auto-detection should already
  treat them as binary, but `* text=auto eol=lf` makes it worth stating).
