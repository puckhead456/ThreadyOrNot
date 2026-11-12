# Wave J — reader (`js/xstitch-read.js`, `window.XSRead`)

Files (both new): `js/xstitch-read.js` (≈2,950 lines, version 1.0.0) and `test/xstitch-read.test.html`.
Nothing else was edited. `index.html` / `sw.js` wiring is the app worker's.

Suite: **`test/xstitch-read.test.html` — 229 passed, 0 failed** (full run with every fixture present,
2026-11-11; `?quick=1` skips the PDF sections, `?all=1` reads every chart page of the vector fixtures).
Baseline: no existing suite loads either file, so there was nothing to break; `xstitch*.html` were not
touched.

## What it does, as the user will see it

A picture of a chart (screenshot, image file, or a PDF page rendered by the app) goes in; out comes the
grid it shows, one square per stitch, with the colour key's own stitch counts as the check. No inference,
no network: page-ground detection, connected components, 1-D gradient profiles, autocorrelation and DFT,
comb fits, robust per-square colour modes in CIELAB, agglomerative clustering, a Hungarian assignment.
Deterministic (no randomness at all), runs in a Web Worker built from `String(fn)` like
`xstitch-photo.js`, main-thread fallback one step per tick, `cancel(token)` terminates the worker job.

### The acceptance case (owner's screenshot `xs-potatoes-preview.webp`, ~6.01 px per stitch, WebP)

| colour | printed | read, size given | off | read, no size | off |
|---|---|---|---|---|---|
| DMC 04 Tin - Dark | 100 | 100 | 0 % | 100 | 0 % |
| DMC 310 Black | 1839 | 1839 | 0 % | 1839 | 0 % |
| DMC 745 Yellow - Light Pale | 305 | 305 | 0 % | 305 | 0 % |
| DMC 842 Beige Brown - Very Light | 1134 | **1135** | 0.09 % | 1135 | 0.09 % |
| DMC 3032 Mocha Brown - Medium | 1159 | 1159 | 0 % | 1159 | 0 % |
| DMC 3827 Golden Brown - Pale | 1184 | **1183** | 0.08 % | 1183 | 0.08 % |
| **total** | 5721 | **5721** | 0 % | 5721 | 0 % |

- Target (every colour within 2 %, total within 1 %) is met with a lot of room: four colours exact, two
  off by one stitch each (one square read as 842 that the key counts as 3827), total exact. Verdict
  `close`, summary "All 6 colours are within a stitch or two of the key (5,721 of 5,721 stitches)…".
- **No declared size: 144 x 85 is detected**, same lattice (x0 107.09, y0 266.14, pitch 6.0129 x 6.0030),
  same counts.
- No key, no size: 144 x 85, 5,721 stitched squares, 8 classes (the lilac fabric, the five big colours,
  and DMC 04 split into two greys of 60 + 40 — the spoon handle and the steam read 9 dE apart; with the key
  they are one class). Each class gets the nearest DMC no other class took.
- Wall time 200–370 ms on this machine (worker; the higher figures are while other agents load the CPU).
- The key used is `XStitch.parseKey(keyTextAsPrinted)` (the key worker's "Floss list" layout); DMC 04's
  table hex (`aeaeb1`) is far lighter than the screenshot, so that entry is placed by its count, as
  designed (`how: 'count'`).

### Vector truth: KG-Chart pages, `extractGrid` on the PDF vs `XSRead` on the page rendered at 2x

Three chart pages per fixture by default (21 pages, ~14.7 px per stitch). Agreement = each read class
mapped to the `extractGrid` ink it overlaps most (inks with identical RGB are one class on both sides).

| fixture | pages | crop + size | size only | nothing given |
|---|---|---|---|---|
| xs-pacman | p2–p4 | 100 % | 100 % | 100 % |
| xs-portal | p2–p4 | 100 % | 100 % | 100 % |
| xs-typechar | p2–p4 (p4 is a 22-wide edge tile) | 100 % | 100 % | 100 % |
| xs-pokemon-tl | p2–p4 | 99.98 % | 99.98 % | 99.98 % |
| xs-pokemon-tr | p2–p4 | 99.93 % | 99.93 % | 99.93 % |
| xs-pokemon-bl | p2–p4 | 99.98 % | 99.98 % | 99.98 % |
| xs-pokemon-br | p2–p4 | 100 % | 100 % | 100 % |

Every page's size is found with nothing given (21 of 21), including the Pokémon pages whose grid has a
grey ruler band glued to two sides and a seam drawn down the middle of every stitch. The residual Pokémon
misses (1–4 squares a page) are pairs of inks a few dE apart (e.g. DMC Blanc `fefefe` vs B5200 `f9f8f4`,
2.9 dE76) that only the symbol tells apart; without a key there is nothing to separate them by. The
pages are read with `maxColors: 150` because these quadrants use 40–61 inks per page and no key is given.

### Synthetic coverage (generated in code; title, rule line, rulers and caption round every chart)

Recovery = share of squares exactly right, key with counts, declared size, y pitch 1.3 % larger than x.

| style | 3.5 px | 4.5 px | 6 px | 8.3 px | 13.7 / 25 / 40 px |
|---|---|---|---|---|---|
| blocks (clean / JPEG 0.8 / blur 0.6 + WebP 0.8) | 100 / 99.56 / 99.9 | 100 / 99.93 / 100 | 100 / 100 / 100 | 100 all | 100 all |
| blocks + grid lines + bold 10-lines | 68.7 / 65.2 / 46.4 | 100 / 99.6 / 68.8 | 100 / 99.97 / 100 | 100 all | 100 all |
| blocks + symbol in each square | 100 / 99.5 / 99.2 | 97.2 / 99.9 / 99.4 | 100 / 99.83 / 100 | 100 all | 100 all |
| blocks + grid + symbols | 76.4 / 55.1 / 51.3 | 87.6 / 91.6 / 67.7 | 100 / 98.64 / 96.37 | 100 all | 100 all |
| stitched look (X of thread, fabric weave) | 100 / 99.2 / 99.7 | 100 / 99.86 / 100 | 100 / 99.97 / 100 | 100 all | 100 all |
| black-and-white symbols (`mode` auto → symbol) | 23 / 7 / 48 | 16 / 6 / 10 | 52 / 53 / 27 | 75 / 68 / 77 | 100 all |

Asserted (what is achieved): colour styles exact from 6 px clean and from 8 px under JPEG / blur+WebP;
at 6 px JPEG ≥ 98 %; B&W symbol charts exact from 13 px. Contents at 8 px JPEG 0.85: shapes, single-square
details and a near-empty chart exact with declared and detected size; confetti (every square a different
colour from its neighbours, through JPEG's half-resolution colour) 99.73 % stitched / 99.15 % gridded.
Two colours 4.1 dE76 apart stay two with the key (exact on shapes and details; 96–100 % on confetti).
Six stitches on an unlined ground with no size cannot say where the chart ends (read as 64 x 47): the
test accepts that only as "not claimed as the full chart".

Other assertions: failure values (`no-image` for null / text / undecodable bytes, `too-small` for an 8 px
picture and for a 2.4 px pitch with a message asking for a bigger picture, `no-grid` for a blank page, a
smooth photo gets confidence 0.3), `fabric: 'none'`, `fabric: '#rrggbb'`, `opts.assign` overriding the
matcher (`how: 'user'`), a key without counts (`unchecked`, colour-only matching still exact),
determinism, worker vs main thread identical, `cancel` mid-read (resolves `cancelled` in < 600 ms, next
read works), `detect` (size, style, sub-pixel pitch, half-pitch alternative), CIEDE2000 against the Sharma
pair, the Hungarian solver, the §3 Check shape.

### Budgets (this machine, worker, other agents running)

2000 x 1500 px picture, 240 x 180 stitched chart, 12 colours: **detect 236 ms** warm (588 ms on the
first call for that picture, which includes a cold JIT of the worker); **read with key + size 747 ms**
(locate 46, lattice 366, sample 200, cluster 81, match 18, assemble 16); read with nothing given 781 ms.
Both under the contract's 300 ms / 1.5 s; the detect margin is thin when the machine is busy.

### Image-only fixtures (rendered page 1–3 at 2200 px wide, nothing given; no ground truth)

| page | ok | size | pitch | style | classes | note |
|---|---|---|---|---|---|---|
| satsuma-stayhome-color p1 | yes | 88 x 103 | 23.1 | blocks-symbols | 17 | eyeballed: shapes and colours right; black half-stitch triangles and some symbol squares read as their ground colour |
| satsuma-stayhome-bw p1 | too-many-colors | | | | | "216 different symbols…": honest refusal |
| satsuma-summersflight-color p1 | yes | 44 x 70 | 32.3 | stitched (misnamed) | 14 | unverified |
| satsuma-summersflight-bw p1 | yes | 44 x 70 | 32.3 | symbols-bw | 53 | 53 shape classes is too many for this chart: not trustworthy |
| satsuma-sunshine p1 | yes | 56 x 56 | 32.1 | blocks-symbols | 10 | unverified |
| tinymodernist-autumn p1 | yes | 81 x 45 | 23.3 | blocks-symbols | 39 | page has a photo above the chart; 165 unsure squares |
| dmc-2168 p1 / p2 | yes | 83 x 116 | 21.3 / 19.4 | blocks / blocks-symbols | 26 / 37 | p1 is a stitched-look picture of the design |
| dmc-2168 p3 | too-many-colors | | | | | |
| dmc-2173 p1 | too-many-colors | | | | | a photo page: right to refuse |
| dmc-2173 p2 | yes, confidence 0.19 | 395 x 8 | 3.95 | | 9 | text page; flagged "the grid of squares is not clear" |
| dmc-2173 p3 | yes | 110 x 96 | 17.0 | blocks-symbols | 10 | unverified |

Lattice confidence is 1 on all the gridded ones, so **confidence is about the grid, not the colours**:
the app must show `check` (and `lowCells`) to say whether the colours are right, as the contract says.

## The contract as built

`XSRead.isAvailable()`, `version`, `read(source, opts, onProgress)`, `detect(source, opts)`,
`cancel(token)` exactly as §1. Sources: ImageData, canvas, `<img>`, ImageBitmap, Blob/File (decoded with
`createImageBitmap`, `<img>` fallback; a Blob typed octet-stream is tried, only pdf/json/zip/text types
are refused up front). Pictures over 16 MP are drawn down first; every coordinate in the result is in
source pixels.

Pipeline: page ground (mode of a 5 % outer ring) → mask, closing, components, the biggest component's
box; edges pulled in past rulers / title rules only for a filled chart (fabric drawn as a colour), with a
"solid edge" test (a page-to-chart step with chart behind it), else left to the grid lines → per axis
edge-energy and edge-frequency profiles → period by autocorrelation (+ DFT sub-pixel), checked against the
picture shifted by multiples of itself (a stitched X or a centred "+" repeats at half the pitch), and
against the squares' colours (over-segmentation: colour only changes on one gap in m) → grid-line run and
cross-check (a ruler band glued to the grid is not crossed by the other axis's lines) → comb fit (tight
when the chart edge is a solid step) → where there are no grid lines, the boundaries between differently
coloured neighbours are measured on lines clear of a centred symbol, and origin + pitch are refit from
both ends → per-square dominant Lab mode (window 14–25 % in; for squares whose middle is covered by a big
symbol, the band round the symbol instead) → clustering (key: exactly key colours + fabric, specks and
noise splits first; no key: merge closer than a noise-derived dE) → fabric (border share, or the key's
unstitched count) → Hungarian assignment, count agreement heavy, CIEDE2000 light, the colour weight raised
when the classes sit right on their key colours → classes the key cannot place that sit inside another
class's noise are folded into it → when the key prints counts and the read is more than 0.3 % off, the
lattice nudged ±0.2 square in x and y is read again and the best agreement wins (counts compared only
after an honest read; one-to-one matching throughout). Symbol mode: Otsu, 10 x 10 centroid-registered
ink descriptor per square, leader clusters then Ward to the key's symbol count, classes matched by stitch
count only (exact, then 1 % when unambiguous); the rest stay `entry: null` with a glyph.

`Result.check`: `XStitch.checkCounts(data, key)` when it exists (both producers agree; every extra palette
row here carries a DMC code no key row uses), this file's own fallback otherwise (same shape; `ok`,
`delta`, `pct` null when the key printed no count).

### Contract changes / additions

- `Result.cells` (Int16Array of palette indices, -1 fabric) is returned alongside `data` — the app's
  review screen and the tests need it without unpacking. `Result.token`, `stats.mode`
  (`'colour' | 'symbol'`), `stats.candidates`, `stats.noise`, `stats.scale`, `stats.phases.decode/assemble`
  are extra. `Detect.stats` carries `worker`, `warnings`, `debug`.
- `data.palette` = every key row in key order (palette index = key entry index, so `checkCounts` and
  `assign` line up), then one row per unmatched class (nearest DMC not already used). No key: one row per
  class, distinct DMC codes.
- `reason: 'not-a-chart'` is never returned: a picture with no clear lattice comes back `ok` with a low
  `confidence` and the warning "the grid of squares is not clear in this picture" (the smooth-photo test
  gets 0.3), or `no-grid` / `too-many-colors`. The app's chart-vs-photo question should key off
  `detect().confidence` (measured here: photos and text pages 0.19–0.3, charts 0.77–1) — see below.
- B&W symbol charts are exact from ~13 px per stitch, not 6 px (a 6 px glyph cannot tell ● from ■).
- `opts.assign` class ids are those of a read with the same lattice / size / opts; a size change makes
  new classes.

## Verified in the pane

All suites above in my own tab at the pane's default size; the QA panel (potatoes button: lattice overlay
lands on every square, preview, count table with ✓ / ±1, class swatches and glyphs) at 557 px wide. The
test page is a dev page, not checked at 375 x 812. pdf.js pages were drawn with a rAF → setTimeout shim
installed by the test page in its own tab only (never in source).

## Left, and why

- Perspective / skewed photos of paper, multi-page raster charts, backstitch and fractional stitches
  (out of scope, contract §1). Half-stitch triangles on the Satsuma charts read as their square's colour.
- B&W symbol charts under 13 px per stitch (measured above) and the Satsuma B&W page (216 shape classes:
  refused). Two inks that differ only by symbol (Blanc vs B5200) are one class without a key.
- `detect` is ~240 ms warm on a 2000 x 1500 picture with this machine busy; a slower phone will be over
  300 ms. It skips the colour-edge refinement already; the next saving would be sampling the profiles.
- The potatoes PDF itself (higher-resolution render) is not on this machine; synthetic stitched charts at
  13.7–40 px read exactly, and the screenshot is already within one stitch per colour, so a clean
  high-resolution render is expected to read exactly — unmeasured until the PDF arrives.

## For the owner of `js/app-xstitch.js` (app)

- Route a picture with `detect`: `confidence >= 0.6` → "Read a chart picture"; otherwise ask. `style`
  tells you what kind of chart it saw; `alternatives` offers the half / double size.
- Show `check.summary` and `lowCells` ("N squares are unsure", `cellConf[i] < XSRead.LOW_CONF`), not
  `confidence`, as the trust signal: confidence is the grid's.
- For big multi-colour charts with no key, pass `maxColors` above 60 (the KG quadrants need ~150), or
  the photo guard refuses with `too-many-colors`.
- Unmatched classes carry `glyph` (`{w, h, data}` RGBA, ≤ 32 px) for the assign UI; re-read with
  `assign: {classId: entryIndex | 'fabric'}`.
- The first call of a session pays for the worker's compile (~0.3 s extra).

## For the owner of `js/xstitch.js` (key)

Nothing required. `checkCounts`, `parseKey` (Floss list) and the DMC 01–35 rows are used as delivered.
