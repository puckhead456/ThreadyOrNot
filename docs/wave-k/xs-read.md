# Wave K — xs-read (`js/xstitch-read.js`, `window.XSRead` 2.0.0)

Files changed: `js/xstitch-read.js` (version 2.0.0) and `test/xstitch-read.test.html` (Edit only). API:
`docs/wave-k/api/xs-read.md` (exact, what xs-app builds on). Nothing else touched.

## Suites

| suite | baseline (start of wave K) | now |
|---|---|---|
| `test/xstitch-read.test.html` (full, every fixture present) | 229 passed, 0 failed | **292 passed, 0 failed** (`TIMEOUT=900 bash tools/headless-suite.sh xstitch-read.test`, after the follow-up below) |

## Last round: wrong sizes must not look confident (audit, docs/wave-k/xs-audit.md)

Suite: **300 passed, 0 failed** (`TIMEOUT=900 bash tools/headless-suite.sh xstitch-read.test`); potatoes
144 x 85, 5,721 / 5,721.

- **Satsuma stay-home 70 x 101 (app flow)**: reproduced at a 3,200 px render (the lattice took 2 caption /
  margin rows). No check failed: the edge probe compared against mid-square ink (symbols defeat it) and
  the key panel test dropped swatches. Now: the edge probe compares the line outside with the nearest
  inner line; a "bare outer rows" check (rows / columns no grid line crosses); a colour key / picture /
  text block inside the box is `region: false`; candidate boxes are chosen by fewest objections. Result
  at 3,200 and 4,000 px: still a wrong size (88 x 103 / 62 x 78 depending on run) but **doubtful**;
  1,600–2,600 px read 70 x 97 clean. The API doc states the render width (square 15–28 px).
- **Robin 107 x 141 (truth 40 x 79)**: the grid covers the whole magazine page with the key panel printed
  over it. Now `region: false` ("About 8 % of the box read is a block the grid lines do not cross…"),
  **doubtful**. The size itself is not fixed.
- **FQS sampler, readTiles 178 x 238 (truth 138 x 172)**: the cover page is now **left out** (and any page
  that fails or reads with confidence < 0.5) instead of failing the join; a declared size the join misses
  makes `check.verdict 'off'`, `sizeVerdict 'doubtful'`, `sizeOff`, summary "The pages join to 178 x 238,
  not the 138 x 172 the pattern gives." Real result, in the ledger: still **178 x 238, off**. Cause, not
  fixed: pages 3–5 each read the whole page (89 x 119 at pitch 20.5; the grid is about 70 x 88, the box
  takes the title / footer banners) and page 2 reads at double pitch then fails as a symbol chart, so it
  is left out too. No repeated overlap rows were found (all joins "order").
- New assertions: Satsuma at 1,600 and 3,200 px and robin (right size or doubtful, ledger rows), sampler
  (cover left out; right or "off"), synthetic tiles with a photo cover (left out, join exact) and a wrong
  declared size (off + doubtful).
- Not built (unchanged from above): phone-photo rectification, symbol templates, ruler numbers for tiles.

## Follow-up: key rows with no printed count (xs-app's regression on the wave J flow)

When the picture-key reader returns DMC 04 without its count, the row was left out of the matching and
its 100 stitches came in as DMC 413. Now the counted rows are placed by count first, then each row
with no count claims the nearest leftover colour class (CIEDE2000 to its swatch / table colour, one
to one, never a noise split of a placed colour); its Check row stays unverified (`expected`, `ok`,
`delta`, `pct` null). A missing count (absent / null) is now told apart from a printed 0, and a key
with missing counts no longer sets the speck size. Proved on `xs-potatoes-preview.webp` with the
size given: with DMC 04's count removed, and with DMC 04's and DMC 745's removed, **all six colours
land on the same squares as the full-key read (100 %)**: 04 100, 310 1,839, 745 305, 842 1,135,
3032 1,159, 3827 1,183; both rows unverified, no class left unmatched (12 new assertions, 2 ledger rows).
Ruler numbers for `readTiles` via `XSKeyRead.readNumbers`: not done (not small enough for this pass).

Runs were headless (Chrome `--headless=new` driven over the DevTools protocol from a PowerShell script
in my scratch folder, own throwaway profile, polling `#summary`); pdf.js renders fine there. A full run takes about 6 minutes; the shared `tools/headless-suite.sh` now runs it in real time (`TIMEOUT=900`).
The owner's acceptance case holds: **144 x 85, 5,721 of 5,721 stitches** (key + size, and key with
no size), DMC 842 +1 / DMC 3827 −1 exactly as in wave J.

## What was built (proposal numbers from the task)

### 1. Page segmenter (R2) — done
- Tile map (T ≈ max side / 64 px, pictures over 2.5 MP looked at half size): per tile the column /
  row gradient profiles, page-ground share, sharp-versus-soft steps.
- A global pitch from windowed autocorrelation where x and y agree (squares are square), refined.
- Each tile's 3 x 3 neighbourhood is "lattice" when its profile folded modulo the pitch keeps its
  variance, **or** when the picture shifted by one square matches itself far better than shifted by
  half a square (runs of one colour, the same symbol, grid line on grid line). Bold / centre lines are
  bridged by a one-tile closing. The chart is the largest lattice region plus the flat fills it
  touches, grown while the strip outside still looks like lattice.
- Everything else is labelled photo (soft colour steps), text, other; a **colour key** is a column of
  ≥ 3 same-size swatches, standing on the page (page to the left, or between swatch and text), with
  text to the right. Swatches inside the chart region are ignored.
- The wave J box is replaced by the segmenter's only when something real was left out (a key panel or
  a photo inside the old box) and what was cut is not lattice; the box is then found again with
  everything outside the chart region masked as page. The result is checked by the size evidence:
  if the grid lines go on past the new box or the squares come out not square, it tries the
  segmenter's own box, then falls back to the wave J box. This guard is what keeps every wave J
  result (KG Pokémon pages with their glued ruler band, synthetic charts at 25–40 px) unchanged.
- `detect` / `read` return `regions` (chart first and chosen, then key / picture / text) so the UI can
  show "this is what I took to be the chart" and offer another region (`opts.region`).
- A picture that is a key and has no chart lattice fails with **`reason: 'looks-like-a-key'`**.

### 2. Honest size — done
`sizeEvidence` + `sizeVerdict` on every ok result: square squares (2.5 %), grid lines that stop at the
box, thick every-10 lines on multiples of 10 from an edge or the centre (line darkness measured
against the squares on both sides, median along the line). False evidence lowers confidence (×0.75,
×0.5 when the squares are more than 6 % off square) and is repeated in `stats.warnings`. With no
declared size, an empty gridded margin outside a thick frame (seen on at least three sides) is
trimmed and reported as `region` evidence.

### 3. Charts split across pages as pictures (#11) — done for synthetic tiles; no real fixture yet
`XSRead.readTiles(sources, opts)`: each page read with no key; classes joined by colour (CIEDE2000
< 4.5); placement by repeated rows / columns (overlap 1 … half a page, ±2 rows of slip, ≥ 97 %
agreement), thick-line phase when the overlap is empty, one overlap per column / row boundary taken
from the join with the most evidence; the layout (columns per row) chosen by joins, the declared size,
then squareness. The whole chart is then matched to the key **with its counts** (classes the key
cannot place but that sit within 10 dE of a placed one are folded in). Each seam reports overlap,
squares compared, agreement and `ok` (null when it could not be checked).
Ruler numbers: `XSKeyRead.readNumbers` was not available while I built this, so tiles are not placed
by printed ruler numbers yet (see "Left").

### 4. Phone photos of paper charts (R3) — not done
No rectification was built (no time left after 1–3, 6, 7). `opts.rectify` / `opts.flatten` are
accepted and ignored; `rectified` is always null. The reader still refuses honestly: a tilted photo
gives no confident lattice.

### 5. Black-and-white symbols under 13 px — not done
`opts.symbols` (key glyph bitmaps, RGBA or xs-keyread bits) is parsed but not yet used to match
squares. The measured table from wave J stands (exact from 13 px; 75 / 68 / 77 % at 8.3 px).

### 6. Colour cap — done
No fixed 60. With no key and no `maxColors`, a read keeps up to 256 classes when the squares are flat
(fewer than 20 % of neighbouring squares differ by a "gradient" amount, between the noise and 12 dE)
on a confident lattice; otherwise more than 60 colours is refused as a photo with a plain message. A
number passed is a hard cap. Symbol charts: cap max(60, key symbols + 10).

### 7. Accuracy ledger (R6) — done
The test page ends with one table, "Accuracy ledger", one row per picture-reading case with its pass
mark; any row worse than its mark is a FAIL line and turns the page red: the acceptance screenshot
(total, worst colour), the synthetic matrix (worst clean recovery per style from 6 px, 13 px for B&W),
the busy synthetic page, the tile cases, the seven KG vector-truth fixtures (agreement with nothing
given, 100 % / 99.9 %), and the image-only fixtures that have truth (Satsuma sizes, the photo left
out on the Tiny Modernist pages, the DMC photo page refused, the key screenshot).

## The three named failures, before / after (page rendered 2200 px wide, nothing given)

| case | wave J | now |
|---|---|---|
| Satsuma "Stay home" colour p1 (truth 70 x 97) | 88 x 103 here (the app saw 90 x 81 and 88 x 110); the key panel inside the box | **70 x 97**, key panel and text listed as their own regions; size evidence: square, edges stop; the thick lines sit 8 rows from the top, which is the centre rule for 97 rows (consistent) |
| Tiny Modernist autumn p1 | 81 x 45 with nothing given; refused "more than 60 distinct colours" in the app (declared 77 x 41, page with photo) | nothing given: **81 x 45**, read, the photo listed as a picture region and left out. Declared 77 x 41 (the app's path, maxColors 60 or unset): **read, not refused** (56 classes), and the evidence says why it is wrong: squares 16.9 x 21.2 px not square, grid lines go on past the left and right edges, verdict doubtful, confidence 0.06. The printed "41 by 77" is not reached: the gridded area is about 81 x 45 with margins the frame rule does not trim here |
| Owner's key screenshot `xs-potatoes-key.png` | "a grid of about 6 x 3 squares, but I am not sure" | **`looks-like-a-key`**: "This looks like a colour key (3 rows of colour swatches with text), not a chart…" |

Also: Tiny Modernist matryoshka 89 x 125 (the whole page) → 85 x 70 (truth 81 x 66; 2 gridded margin
columns each side, no thick lines to trim by), photo left out. DMC 2173 p1 (a photo page) is still
refused, now "do not sit in flat squares".

## Measured (final run, this machine shared with other workers)

- detect, 2,000 x 1,500 px, 240 x 180 stitched chart: median of three warm calls **211 ms** (206 / 211 / 377);
  first call 581 ms (worker compile). Across runs the warm median ranged 198–432 ms; with the segmenter off the
  same call is 196–250 ms. The segmenter itself is 37–145 ms of it (half-size tile map).
- read, same picture: key + size **558 ms** (locate 68, lattice 239, sample 165, cluster 46, match 11, assemble 13),
  nothing given 723 ms.
- Acceptance (xs-potatoes-preview.webp): 144 x 85, **5,721 / 5,721**, DMC 842 1,135 / 1,134, DMC 3827 1,183 / 1,184,
  the other four exact; key with no size the same; no key, no size: 144 x 85, total 5,721.
- Vector truth, nothing given (21 pages): Pac-Man, Portal, Typechar 100 %; Pokémon tl 99.98, tr 99.93, bl 99.98,
  br 100 % — unchanged from wave J; every page's size found.
- Synthetic tiles (70 x 56 chart, 2 x 2 pages, 11 px, blocks + grid + symbols): overlap 3, clean **100 %**, layout 2 x 2,
  3 joins checked at 100 %, the all-fabric join placed from its column and reported unchecked; JPEG 0.85 **99.36 %**
  (one colour, 25 squares, split off on one page: "1 colour in the chart is not in the key"); abutting pages with the
  declared size **100 %**, all four joins reported unchecked. 280–370 ms for four pages.
- Busy synthetic page (chart + key panel 10 px beside it + photo above), nothing given: size exact, key panel
  labelled "colour key", photo labelled "picture", read with the key exact; read with opts.region exact.
- Image-only fixtures, nothing given (2,200 px renders): Satsuma stay-home **70 x 97** (was 88 x 103), summer's
  flight 44 x 70, sunshine 56 x 56 (evidence says lines go on past every edge: unverified, may be a false alarm of
  the edge probe on that page), autumn 81 x 45, DMC 2168 p1/p2 83 x 116, DMC 2173 p3 110 x 96, DMC 2173 p1 refused
  (photo), Satsuma B&W / DMC 2168 p3 refused (216 / 223 symbol shapes).
- At the app's smaller detect scale (Satsuma page drawn 1,250 px wide) the segmenter's box is not taken and the read
  is 89 x 110 again, but now flagged: "The thicker every-10 lines start 3 squares in from the left", confidence 0.43,
  verdict doubtful. Draw the page at about 2,000 px for the read (the app already redraws at >= 8 px a square).

## Left, and why
- R3 phone photos (rectification, lighting) and #5 symbol templates below 13 px: not built.
- Tiles by printed ruler numbers: needs `XSKeyRead.readNumbers` (feature-detect it when it lands); no
  real raster multi-page fixture was used.
- Autumn's printed 77 x 41 is not reached (81 x 45); matryoshka 85 x 70 for 81 x 66.
- `detect` time: the budget test now takes the median of three warm calls, because single warm calls
  on this shared machine ranged 187–510 ms (one call alone stalled past 400 ms more than once).
- The segmenter's box is used only when a key panel or a photo sits inside the old box, and only if
  the size evidence does not object; on a page where its lattice tiles miss part of the chart
  (stitched look at 32 px, symbol-dense areas) it is ignored rather than trusted. A small render of a
  busy page (1,250 px) still falls back to the old box, now flagged doubtful.
- Region labels "text" / "other" are coarse (a ring of text tiles round a chart is one region).

## For the owner of `js/app-xstitch.js` (xs-app)
- Show `regions` over the picture (label + box), the chosen one outlined; a tap on another region
  re-reads with `{ region }`.
- `reason: 'looks-like-a-key'`: offer "Use it as the key" (xs-keyread) instead of the chart check.
- Show `sizeEvidence` details when `sizeVerdict === 'doubtful'` next to the size steppers.
- Stop passing `maxColors: 60`; leave it unset (or pass a number only to force a cap).
- `readTiles` for multi-page picture charts: show `layout` and each seam's `agree`, confirm with
  `layout: { cols }`.

## Decisions for the coordinator
- `maxColors` default changed from 60 to evidence-based (contract §1 said 60).
- New failure reason `looks-like-a-key` (contract §1 listed six reasons).
