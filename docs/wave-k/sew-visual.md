# Wave K — sew-visual report

Worker: sew-visual. Files (all new, all mine): `js/sew-figures.js` (`window.SewFigures`, 1,700 lines),
`js/sew-quilt.js` (`window.SewQuilt`, 1,090 lines), `test/sew-visual.test.html`. Contract:
`docs/wave-k/api/sew-visual.md` (exact; sew-app builds on it). Nothing else edited.

## Baseline and suites
- Baseline: no suite touched my files before this wave (all three are new): 0.
- `TIMEOUT=600 bash tools/headless-suite.sh sew-visual.test 'sew-visual.test?real=1'` →
  **171 passed, 0 failed** (synthetic layouts and DOM widgets, no fixture content) and **266 passed,
  0 failed** (plus the 16 `tmp-pdf/sew-*` fixtures, read in real time; they skip cleanly when absent).
- Reviewer views on the same page: `?view=gallery&f=<fixture>` (every step beside its crop, green =
  figure, amber = page), `?view=quilt&f=sew-freespirit-harmony-quilt&page=12` (the quilt top at
  343 px with progress), `?view=widgets` (cutting board, unit in the button, tape-up map at 375 px).

## What the user sees (once sew-app mounts it)
- **P1 / S4 — the step's own figure.** Under each step: a crop of the booklet holding just that
  step's drawing(s), or, when the app cannot be sure, the page framed round the step's text, with
  the reason in plain words. The same crop can sit dimmed behind the Step-done label.
- **P12 / S1 — fabric swatches.** Each fabric row gets the pattern's own printed swatch (96 px) and
  a representative colour (CIELAB mean) with a "captured cleanly" flag.
- **P11 / S2 — the quilt top.** Harmony's vector layout is read into 17 labelled blocks; the
  page's own picture is shown grey, and each block comes back in its real fabrics as it is made
  (a stitch-line reveal on the newest; whole top in colour at the end). Joyous' layout is a single
  raster picture: shown whole, fading up with a % ring, and it says so. Catwalk: no layout claimed.
- **S3** — the block / unit being made, "Unit 7a · 2 of 4", inside the big button.
- **S5** — the cutting board to scale per fabric: WOF strips across 42" with their subcuts inside,
  loose pieces shelf-packed, cut / uncut state, one tap target per row; garment pieces with no
  printed dimensions listed, never drawn.
- **P5** — the tape-up map: a grid of the sheet's pages, tap to tick a sheet taped.

## Measured results
### Step → figure, per fixture (all 16; `link()` time after pages are read)
| Fixture | Steps | Figure | Page-only | None | link ms | read ms | Manual check (sample) |
|---|---|---|---|---|---|---|---|
| sundress | 15 cards | 5 | 10 | 0 | 3 | 330 | #0, #1 seen right in the gallery; #2 checked by coordinates (the drawing under its text in the right column); 0 wrong seen |
| pencilskirt | 11 | 8 | 3 | 0 | 3 | 814 | 6 checked (#0–#5): 4 right, 2 page, 0 wrong |
| samford | 16 cards | 3 | 13 | 0 | 4 | 299 | all 15: 2 right (p12, figures 7–10 / 11–12 by order), 13 page, 0 wrong |
| bathers | 19 | 18 | 1 | 0 | 4 | 1,005 | 5 checked (#2–#6): 4 right, 1 page, 0 wrong |
| apron | 16 | 0 | 16 | 0 | 4 | 649 | not sampled (no figure claimed) |
| westend (image-only) | 0 | 0 | 0 | 0 | 0 | 0 | no text, no steps |
| mabel bag | 13 | 8 | 5 | 0 | 3 | 121 | 6 checked (#0–#5): 2 right, 1 **poor** (#1: right drawing, but the crop is a narrow band holding its own text), 3 page |
| triple-t tote | 11 | 9 | 2 | 0 | 1 | 588 | not sampled |
| harmony | 22 | 14 | 8 | 0 | 5 | 4,300 | captions ("Fig. n") with pdftext's targets; not sampled by eye this pass |
| joyous | 16 | 2 | 14 | 0 | 2 | 935 | not sampled |
| catwalk | 34 | 6 | 28 | 0 | 4 | 1,024 | not sampled |
| 5 sheet files | 0 | – | – | – | ≤1 | ≤414 | (sheets have no steps) |

Linking is ≤ 10 ms for every booklet (budget 3 s); reading pages is 0.1–4.3 s. Every fixture asserts
that no figure crop holds a sentence another step owns. **Before** the numbered-figure rule, Samford
p11 gave 3 visibly wrong figures (its pictures are laid out by number, offset from their text);
that page now falls back to "page" by rule, which is why Samford dropped from 11 to 2 linked.

### Audit #19 fixed (2026-11-13): sundress step 1's crop was a column chunk
Cause: the fixture pass linked `parse().steps` (11) while the app links `toCraftData().steps`
(15 cards), and the proximity rule joined every drawing a step owned into one box; on p6 that box
ran from the bodice drawings down through the step's own paragraphs ("Press all seams open…") to
the Bodice Shell / Lining drawings. The "no other step's text" check passed because, by the parse,
those paragraphs are step 1's own. Fix: drawings (and captioned or numbered figures) are joined
only when joining takes in no line of prose; otherwise `rect` is the first figure and the new
`parts` lists each one, top to bottom. The fixture pass now links the app's cards and asserts on
every fixture that **no figure crop holds more than two lines of prose**, plus the sundress case
(step 1: first drawing only, 3 parts). Counts after the fix: identical figure / page splits on every
fixture; the only changes come from linking the app's cards (sundress 11 → 15 cards, 5 figures;
Samford 15 → 16 cards, 2 → 3 figures). A synthetic case covers drawings split by a step's own
paragraphs.

### Swatches
| Fixture | Rows | Clean | Notes |
|---|---|---|---|
| Harmony | 18 | 16 | (A)–(P) all clean; the two backings have pictures labelled "Backing 44"" / "108"", not joined |
| Joyous | 13 | 13 | codes FUS-P-1208 … under the pictures; binding/backing share their fabric's picture |
| Catwalk | 20 | 20 | swatch page prints OHM-, requirements print OMH-: joined as a one-letter slip, named in the reason; 4 blenders are flat-colour vector squares (need `{shapes:true}`) |
`swatches()` ≤ 4 ms. Harmony capture: 16 bitmaps and colours (e.g. P navy #172344, I maize #f4c763).

### Quilt top
Harmony p12: 238 patches, 17 blocks (B1, B2a–d, B3 ×4, C ×4, H ×4), 55 patches left as sashing /
border (coloured only when every block is made). Viewed at 343 px: B1's panel, the B3 stars and
B2a come back in their real prints. Known imperfection: a few sashing pieces next to a block
(the pink squares under the top B3s, part of the top flower border near B2a) are taken into that
block by the nearest-label rule. Joyous p6: picture mode. Catwalk: none. `loadImage` cuts and
decodes the 1200 px layout in 2.6 s and caches it.

### Tape-up map
sundress sheet 5 × 6 (30 sheets, 0 gaps); pencil skirt 5 × 5 (21 placed, 4 pages carry no label);
joggers: my position reading finds none, sew-core's text reading gives 3 × 4 / 3 × 5 — so
`sheetTapeMap()` prefers sew-core's (`Sewing.readSheet(text).tiles`) and both agree on the grid
where both read one. A0 apron: none (correct).

### Crops
Sundress: 11 crops (figure + framed page) in 0.8–2.2 s, every one ≤ 750 px wide and ≤ 1.2 Mpx;
a second call is all cache hits (5 ms); a cancelled run rejects with AbortError; `deleteCrops`
leaves no `p:<id>:` keys. Test projects use throwaway ids and are deleted.

## Verified at which sizes
Headless Edge at 375 × 812 (device scale 2): the step galleries, the quilt top (343 px canvas) and
the widgets page. Theme: one light palette set by variables on the widget host. **Not done:**
375 × 640, Stardrop Night / Pixel Wyrm, the real app screens (sew-app mounts these), touch pinch on
a device. The Browser pane had no free tab in the first session; this session ran headless only.

## Proposals
- **P1 / S4 step figures: done** (linking, crops in BlobStore, button picture). Partial on layouts
  whose figures are numbered inside the pictures and placed away from their text (Samford p11,
  p13–15): honest page fallback rather than a guess.
- **P12 / S1 swatches: done** (Harmony 16/16 lettered, Joyous 13/13, Catwalk 20/20).
- **P11 / S2 quilt top: done for Harmony (vector) and the picture fallback (Joyous)**; block edges
  are approximate where sashing touches a block.
- **S3 unit in the button: done** (renderer; the active unit comes from sew-core's `activeUnit`).
- **S5 cutting board: done** (Harmony's B¹/B² "tall x wide" rectangles now parse).
- **P5 tape-up map: done** (renderer + own reader; prefers sew-core's reader).

## For the owner of `index.html` and `sw.js` (shell-ui)
Add `js/sew-figures.js` and `js/sew-quilt.js` after `js/sewing.js` in `index.html` and to
`PRECACHE_URLS` in `sw.js` (test/sw.test.html fails until both lines exist).

## For the owner of `js/app-sewing.js` (sew-app)
- Read pages once at import: `SewFigures.readPages(handle, stepPages ∪ {fabric pages} , {})`, then
  `link`, `renderCrops(id, links, {handle}, {modes:['figure','page']})`; keep `links` on the steps
  (`step.fig = {page, rect, mode, reason, blobKey}`) — a few hundred bytes each.
- Swatches and the quilt need `readPages(handle, pages, {shapes:true})` for the fabric pages (≤ 5)
  and the layout page.
- A link may carry `parts` (several figures for one step; `rect` is the first). Cut the others with
  `renderCrops(id, link.parts.map(function (r) { return {page: link.page, rect: r, mode: 'figure'}; }), …)`
  if you want a strip of them; showing only `rect` is correct too.
- `deleteCrops(id)` when a project is deleted (the shell's boot sweep removes `p:<id>:*` anyway).

## For the owner of `js/pdftext.js`
Thanks for `renderRegion({width})`. I kept my own region draw from `handle.doc` (print intent, exact
width, works with the pane hidden); `renderRegion` stays the fallback when a handle has no `doc`.

## Decisions for the coordinator
1. The fixture half of `test/sew-visual.test.html` stays opt-in (`?real=1`); `tools/headless-suite.sh`
   now runs it in real time with `TIMEOUT=600`.
2. Samford-style booklets (pictures numbered inside the art, laid out away from the text) would need
   the in-house glyph reader or OCR on the figure numbers to link more than 2 of 15 steps.
