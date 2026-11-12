# Wave K brainstorm 04: visual and recognition engineer

Lens: (A) the visual centrepiece each non-crochet craft deserves, and (B) recognition (text, charts, symbols,
photos) that runs on the device with no per-user cost. Written 2026-11-12 on `wave-1`. No code was changed.

**How I checked.** I read HANDOFF, SPEC "Live 3D diagram", `docs/wave-h/knit-3d*.md`, `docs/wave-j/reader.md`,
brainstorms 04 / 05 / 06 / 11, and the code cited below. In my own tab (`stitchkeeper-wavek-visual`, cleaned up
afterwards with its 40 `p:<id>:` page blobs) I loaded the knitting chips in `test/diagram.gallery.html`, imported
`xs-pokemon-tl.pdf` through New project → Cross-stitch → drop, read the grid and tapped the big button, ran
`Sewing.parse` and the pdf.js operator lists over four sewing booklets, and rendered pages of
`sew-agf-catwalk-quilt`, `sew-freespirit-harmony-quilt` and `xs-tinymodernist-matryoshka`. Anything marked
**(memory)** is my own knowledge and was not checked here. Nothing was downloaded.

## What I saw (the evidence the proposals lean on)

- **Cross-stitch: the tap button shows nothing on a big chart.** Pokémon TL reads as 500 × 500 = 250,000 stitches
  in 105 colours (6.8 s). `makeLivePreview` (`js/app-xstitch.js` §5) fits the whole chart into about 150 CSS px,
  so one stitch is about 0.3 px. After a real tap the readout said "1 / 21,207" and the preview was still a blank
  cream square. The same import said "most chart symbols could not be read; the app assigns its own".
- **Cross-stitch progress is a bitmap only.** `craftData.progress.done` is base64 bits, with no order and no
  timestamps, so a time-lapse has nothing to replay. `craftData.chart` was 533 KB of JSON for 250k cells.
- **Knitting garments are stacks of separate sheets.** The Patons mock-neck gallery card draws the Back as a curved
  grey sheet with cable columns beside a photo of a cabled pullover. The importer splits it into "Back" (14 rib
  rows) and "Back (continued)" (156 rows), drawn apart. The 8-socks book gives 42 sections ("Heel Flap (continued
  5)", "Toe (continued)"…), so no sock is ever one object. knit-3d.md "Garment assembly" lists this as known.
- **Sewing booklets carry drawable structure.** Catwalk (AGF): p2 has 18 fabric swatches as images, each labelled
  with its code; p4's requirements table maps Fabric A–R to those codes; `Sewing.parse` gives 64 `cuttingList`
  rows with `dims`, 20 `fabric` rows, 34 steps; p8 is a vector appliqué template (one filled closed path).
  Harmony (FreeSpirit): p12 "Quilt Layout" is vector, with 35 clip paths, 34 draws of 6 distinct fabric images,
  and block labels (B1, B2a–d, B3, C, H) in the text layer with positions; pp4–11 are vector block diagrams with
  92–200 clips each. West End (Peppermint): 14 of 17 pages have no text, so the gap there is OCR.
- **Image-only key.** On matryoshka p1 the chart is vector (2,456 fills, 2,335 image draws), but the key's codes are
  not in the text layer (21 text items in all). They are printed in a clean sans-serif, about 25 px x-height at 3×.
- **Budgets today.** The precache is 4.75 MB (pdf.js is 1.4 MB of it). The renderer is raw WebGL1 with at most 3
  live contexts (`MAX_LIVE`, `js/diagram.js`); vertex budgets are 160k viewer / 70k button (`LOD_BUDGET`);
  `frameMs` has only been measured on desktop (7–12 ms). Nothing has run on a phone GPU.

## 1. Parity table (my lens)

| Crochet capability | Knitting | Cross-stitch | Sewing |
|---|---|---|---|
| Live 3D of the piece in the tap button, grows per tap | **has** (per part, diagram 1.7.0) | **partial**: flat 1-px-per-cell preview, invisible above ~150 stitches wide (Pokémon TL) | **missing**: step ring and "STEP DONE" (`app-sewing.js:234`) |
| Relief true to the stitch | **has**: V, purl, rib, eyelets, 22 cable crossings | **missing**: flat colour squares, no thread or fabric | n/a |
| Pattern colours on the model | **partial**: per round only; chart colours (`KnitChart.rowCells().color`) never reach the model | **has** the palette, drawn as flat ink | **missing**: fabrics are codes; printed swatches ignored |
| The whole object, not one part | **missing** (crochet too): socks and sweaters drawn per part | **has** | **missing**: no assembled pieces or quilt top |
| Follow mode | **partial**: a bent sock turns about the leg axis | **missing**: button does not centre on the crosshair block | n/a |
| Ghost of what is left | **has** | **partial**: pale cells on the chart, not in the button | **missing** |
| Finished trophy / share picture | **partial**: turning trophy, no export | **missing** | **missing** |
| Visual reference set (01 §2 + gallery) | **partial**: synthetic refs, 5 fixture rows, 10 chips | **partial**: reader QA panel, no render QA | **missing** |
| Reads image-only pages (OCR) | **missing**: APL Nicoll p3+ | **missing**: matryoshka, autumn, Satsuma keys, 3 APL books | **missing**: West End, Samford size letters |
| Charts from vector drawings | **has** (`KnitChart`) | **has** (`extractGrid`) | n/a (quilt layouts are vector, unread) |
| Charts from pictures | **missing** (`image: true`, no cells) | **has** (`XSRead`), chart finding fails on busy pages | n/a |
| The pattern's own symbols | **has** (key paths matched) | **missing**: app assigns `SYMBOLS` (`xstitch.js:898`) | n/a |
| Phone photo of paper | **missing** | **missing** (reader.md "Left") | **missing** |

**The 2026-09-17 brainstorm in my lens.** Done: 04 #14 (page viewer), 05 #10 (step pages first), 06 #4
(`emptyPages`), the Pokémon key repair. Still open and built on below: 06 #22 Tesseract → R4; 04 "joining tiled
chart pages" and 04 #18 page classification → R2; 04 #7 near-identical symbols → R5; 05 #13 quilt unit in the
big button → S3; 05 #17 quilt chrome → touched by S2; HANDOFF item 8 (backstitch from PDFs) → drawn by X5.

## 2. Proposals, ranked

Value ÷ effort, with accuracy risk counted against. X = cross-stitch, K = knitting, S = sewing, R = recognition
across crafts. Effort: S = hours, M = a day, L = several days, XL = a wave.

### 1. X1 — Stitched-fabric renderer (one shader, any chart size) · L

**User sees.** The chart viewer and the tap button show fabric, not ink: aida weave where nothing is stitched;
each finished square a two-leg cross in its floss colour (top leg over the bottom one), with a twist stripe and a
soft sheen that moves as you pan; backstitch on top as raised thread; knots as dots; unstitched squares as a faint
printed tint. Zoomed out it fades to flat colour, so 500 × 500 is still one picture.

**Why.** Cross-stitch has no material at all, yet its finished object is fully determined by the data. The tap
button is blank on large charts (above). The reader's synthetic "stitched look" test style shows it is drawable.

**How.** One full-screen quad in WebGL1. The fragment shader reads a **cell texture** (w × h RGBA8: R+G palette
index, B flags for done / four fractional corners / knot) and a 256 × 1 **palette texture** (linear RGB plus
per-floss sheen, more for metallic and satin). From the pixel's position in its cell it computes two capsule
distance fields for the legs, a hash-jittered thread stripe, an anisotropic highlight along each leg, an
occlusion dip at the holes, and a procedural basket weave where done = 0. Cost does not depend on stitch count:
250k cells is a 500 × 500 texture (1 MB); a tap is one 1 × 1 `texSubImage2D`; WebGL1 guarantees 4096².
Below about 3 device px a cell the shader returns pre-filtered colour from a CPU-built mip chain (1.33 MB);
thread detail fades in between 4 and 10 px. Backstitch is a separate pass of quads expanded in the vertex
shader (a few thousand segments at most). The Canvas2D blit stays as the no-WebGL and print fallback. It is a
new file (`js/xs-fabric.js`, about 250 lines) sharing `MAX_LIVE` with the 3D diagram.

**Budget (estimate, to measure).** 412 × 915 CSS at dpr 2 ≈ 1.5 MP; about 60 ALU per pixel ≈ 90 MFLOP a frame,
which a mid phone GPU (Adreno 610 class, 100–200 GFLOPS, memory) should do in ≤ 4 ms. Target ≤ 8 ms per pan
frame by `frameMs`; nothing drawn while idle.

**Risks.** Fill rate on old Mali GPUs (draw at dpr 1 while panning, sharpen on idle); plastic-looking sheen (tune
against the owner's stitched photo).

**Proof.** `test/xs-fabric.test.html`: a pure `cellShade(u, v, flags)` against hand values, plus pixel probes (a
leg pixel within ΔE 6 of the floss; a hole darker than the fabric). `frameMs` on Pokémon TL at three zooms, and
on a real phone.

### 2. X2 — The tap button shows a loupe on the block being stitched · S (M with X1)

**User sees.** The button shows the 10 × 10 block under the crosshair plus a two-stitch margin at about 12 px a
stitch; the stitch just marked fills in with a small pop; a corner thumbnail of the whole piece has a dot where
you are. Charts under 120 wide keep the whole-chart view.

**Why.** On Pokémon TL a tap changed nothing visible. Block counting already knows the block ("block 3,2 · 4
left here"). It also gives cross-stitch a follow mode for free.

**How.** `makeLivePreview` takes a source rectangle from the current block instead of `0, 0, w, h`: the existing
`liveCanvas` blit now, the X1 shader later.

**Proof.** A crafts.test case: after one tap on a 500-wide chart the preview's source rectangle is ≤ 14 × 14 and
the changed pixel is the floss colour.

### 3. S1 — Real fabric swatches from the booklet · M

**User sees.** "Fabric A" chips, the shopping list, the cutting list and the fabric card show the actual print,
taken from the booklet's fabric page. With no swatch, the code chip stays as today.

**Why.** Quilt and bag booklets print their fabric line as labelled swatch images (Catwalk p2: 18, mapped to
letters on p4). It is the cheapest way to make sewing look like the user's project.

**How.** From the operator list take each image draw's box (the transform at `paintImageXObject`); from the text
layer, the code token nearest below or beside each squarish 60–200 pt image; join to the code in
`fabric[].name` (`OMH-33447`). Crop from the 1400 px page render already in BlobStore to a 96 px JPEG at
`p:<id>:swatch:<code>`; add `fabric[].swatch`.

**Risks.** A cover photo taken for a swatch: require at least 6 squarish images in a row or grid, each with a
code. A code shared by two images gives no swatch.

**Proof.** In `sewing.fixtures`: Catwalk gets 18 links whose codes equal the p2 labels (codes, not pixels);
FreeSpirit and Mabel get exactly what their pages show; a booklet with no swatch page gets 0.

### 4. R1 — Floss-code reader by glyph templates (no OCR engine) · L

**User sees.** On an image-only key (matryoshka, autumn, Satsuma sheets, tapestry-painted p5): "Read 8 colours
from the key picture — check them", each row's crop beside what was read. An unsure code shows as "DMC 9?5",
never guessed.

**Why.** "Image-only keys need OCR" is the top open cross-stitch item. The vocabulary is narrow: digits, a few
letters (`B5200`, `E3821`, White, Blanc, Ecru) and about 500 DMC codes we already ship as a lexicon.

**How.** (1) Find the key with R2. (2) Segment: Otsu on a 3× render; horizontal then vertical projection profiles
for rows and columns; swatches as coloured connected components; glyphs as components, broken ones merged.
(3) Score each glyph by normalised cross-correlation against templates drawn in the browser with `fillText` from
6–8 system font stacks at the measured x-height (no fonts shipped), keeping a 10-best list. (4) Decode each token
with a Viterbi constrained to the DMC / Anchor lexicon and colour names, breaking ties with the row's printed
swatch colour (ΔE ≤ 15 to the code's hex). (5) Cross-check the code count against `XSRead`'s colour classes.
Then **self-train**: once ten glyphs are confident, crop them from the page as templates for the rest. It runs in
the `XSRead` worker style and feeds synthetic text lines to `XStitch.parseKey`. About 30 KB of code, no download.

**Accuracy (expected).** ≥ 98% exact rows on born-digital raster keys; under 80% on APL scans, which go to R4.
Measured as exact-row accuracy against wave E's written ground truth: matryoshka's 8 rows (DMC plus Anchor),
tapestry-painted p5's 8 rows, orr-book14 p19's 8 J.&P. Coats rows.

**Risk.** Phone fonts differ from the PDF's font (self-training covers it); it never claims a code it cannot
decode.

### 5. R2 — Page segmenter: chart, key, photo and text regions · M (PDF) + M (pictures)

**User sees.** The reader boxes the right rectangle: the Satsuma colour sheet reads 70 × 97, not 90 × 81 with the
key inside, and the Tiny Modernist page needs no manual crop. The import shows page thumbnails labelled chart /
key / photo / instructions (04 #18).

**Why.** These are wave J's own residuals. The same machinery finds the quilt layout (S2), unit drawings (S3), step
figures (S4) and knitting chart pages (`KnitChart.scan` caps at 12 pages).

**How.**
- **PDF pages: the drawing is the truth.** Cluster operations by bounding box into a lattice (≥ 200 fills or image
  draws on a regular pitch), a photo (one image draw ≥ 8% of the page), text blocks (lines grouped by spacing) and
  a key table (text rows aligned with small square fills or images).
- **Pictures:** a 32 px tile map with four features per tile: periodicity at `XSRead.detect`'s pitch, colour
  count, edge density, and text-likeness (stroke-width consistency, baseline runs). Rules label the tiles, regions
  grow, and the chart is the largest periodic region, passed as `opts.crop` (which already exists).

**Proof.** A hand-drawn chart box per fixture page (in page points). Assert IoU ≥ 0.95 on the 7 KG-Chart, 5 Satsuma
and 6 Tiny Modernist pages and dmc-2168 / 2173, and no chart claimed on photo pages (dmc-2173 p1).

**Risk.** Overlapping regions: ask "Is this the chart?" with the box shown, as wave J's unsure route does.

### 6. K1 — The whole garment, assembled · XL (L for the pieces board, L for the 3D)

**User sees.** A sweater's ⤢ viewer gets **Whole piece**: Back, Front and two Sleeves wrapped round a plain dress
form at the pattern's own finished chest, the neckband ringing the top. Finished parts are solid, the working
part glows, and parts not started are ghosts. A sock imported as Cuff / Leg / Heel Flap / Turn Heel / Gusset /
Foot / Toe is one sock with the working section lit. When the app cannot tell how the pieces go together it
shows the **pieces board**: every part flat, to scale, side by side.

**Why.** The gallery shows a cabled pullover as one curved sheet. Sweaters, socks and hats are most of knitting.

**How (data).** A construction class from text and part names: flat set-in / drop-shoulder pieces, top-down raglan
/ round yoke, sock (top-down or toe-up), hat, shawl. Part roles come from names, with "×2" mirrored. Sock sections
chain end to end through the start counts wave H already carries ("Turn Heel after Heel Flap"), along the bend the
L already draws. Size comes from the pattern's finished measurement, else counts ÷ `Project.gauge`.

**How (rendering).** Each part keeps its `DiagramGeo` layout. A new pure `DiagramGeo.assemble(parts, cls)` returns a
transform and warp per part: a flat Back or Front bent onto half an elliptic cylinder of the body circumference
with the existing `warpPoint`; sleeves as tubes rotated 70–80° about the shoulder; a picked-up band as a ring at
the neck edge.

**Budget.** A cabled sweater is about 65k stitches (Back 144 × 156 ≈ 22k, Front ≈ 22k, Sleeves 2 × ≈ 10k). At the
160k viewer budget that is about 2.4 vertices a stitch, the bottom tier where cables vanish, so it needs K2.

**Honest failure.** Unknown roles ("Part 3"), or pieces that do not tile (a Front more than 25% off half the
chest), give the pieces board, never an invented garment.

**Proof.** Synthetic sweater and sock references in `test/diagram.knit-synth.js`: side seams meet within 0.5
stitch, sleeve cap meets armhole, aspect within ±35% of the photo (the 01 §2 rule). Fixture rows for the Patons
mock neck and Bernat raglan once the parser joins "(continued)" sections, a parser-lens item this depends on.

### 7. K2 — Baked fabric textures for big knitted pieces · L

**User sees.** A whole sweater or a 144-row shawl keeps cables, rib and lace when zoomed out (today large pieces
stay on the basic relief tier, HANDOFF 3D "Very large pieces").

**How.** Render each part's relief once, offscreen and orthographic, into an albedo + normal atlas at 4 px a
stitch. Draw the garment as a low-poly surface (2 triangles per 4 × 4 stitches) sampling the atlas. Rebake only the
working part, and only on a row change; a tap moves a highlight uniform.

**Budget.** 65k stitches × 4 × 3 px ≈ 0.8 MP, so one 1024² atlas (4 MB albedo + 4 MB normal). The bake is one
draw per part, estimated under 30 ms on desktop, off the tap path. The silhouette loses its edge relief, so keep
geometry for the working row ± 1.

**Proof.** Cable swatch, geometric versus baked, at viewer zoom: SSIM ≥ 0.9.

### 8. S2 — Quilt top that assembles block by block · L

**User sees.** A quilt project's big button shows the quilt top drawn from the pattern's own layout page in the
real fabrics (S1). Finished blocks are sewn in, the rest are pale outlines, and "Block done" on the active unit
(S3) sews the next block in with a short stitch-line animation. ⤢ shows the whole top; a finished quilt gets an
"on the bed" trophy (the flat drawing on a gently curved quad, not a cloth simulation).

**Why.** Harmony p12 is fully vector, with labels positioned in the text layer. `Sewing.parse().units` already
counts "Unit 2a 0/4", but nothing links the counts to a picture.

**How.** From the layout page's operator list: each clip path is a patch polygon, its fill or image draw is its
fabric, the label inside it names its block, and polygons group by label. Store
`craftData.layout = {w, h, patches:[{poly, fabric, block}], blocks}` in page points (a few KB) and draw with SVG
(fine under 2,000 polygons), filling with a `<pattern>` of the S1 swatch. Block progress maps unit name to label
("Unit 2a" ↔ B2a), else follows layout-grid order.

**Honest failure.** A raster-only layout shows the page crop with a progress ring. Per-block reveal appears only
when R2 finds a grid whose block count equals the unit target. Never an invented quilt, and never a tiling
guessed from "3 rows of 4" text.

**Proof.** Harmony's labels and patch count per label, read once by a person, asserted in `sewing.fixtures`;
Catwalk asserted to claim no layout; Joyous Picnic recorded as found.

### 9. X3 — Mark log and time-lapse replay · M

**User sees.** ⋯ → **Watch it grow**: a 10-second replay of the piece filling in, session by session, on X1's
fabric, with dates. Save as video where the browser can record a canvas (memory: `MediaRecorder` on
`captureStream()` gives WebM on Chrome / Android and MP4 on recent Safari; needs a spike), else a 6-frame strip.

**Why.** Cross-stitchers post progress pictures constantly, but the order of stitching is not stored.

**How.** An append-only log in BlobStore `p:<id>:marks:<n>`: every 60 s or at session end, the cell indices newly
done or undone as delta varints. A session of 300–1,500 stitches is 1–3 KB; a 250k piece is about 400 KB in all.
`.thready` carries it like page images. Replay applies deltas to the cell texture with dirty-rectangle uploads
(about 400 cells a frame). A project from before the log starts with one frame, "everything up to today".

**Proof.** Replaying the log reproduces the progress bitmap bit for bit; size checked on a 10k-tap synthetic run.

### 10. R5 — The pattern's own symbols in the app · M

**User sees.** The chart and key use the symbols printed in the PDF (a KG-Chart ★ stays ★), so paper and screen
differ only in colour.

**How.** Vector source: KG-Chart draws key symbols as paths. Take the path operators inside each key row's symbol
cell, normalise them to a unit box and store an SVG path (≤ 1 KB) as `entry.glyphPath`. Verify with the ink
descriptor `KnitChart` already uses against key paths: every chart cell in that colour should match the key glyph.
Raster source: `XSRead` unmatched classes already carry a ≤ 32 px `glyph`; trace it to 1-bit. The chart draws
`glyphPath` with `Path2D` from 8 px cells (`GRID_MIN_PX`), else the `SYMBOLS` fallback.

**Risk.** ◆ versus ◇ (the descriptor keeps the fill). 150 colours means about 150 KB in `craftData`: cap it and
fall back to raster above that.

**Proof.** Every KG-Chart palette entry gets a `glyphPath`, and key-glyph-to-cell agreement is ≥ 99%.

### 11. S3 — The quilt's active unit in the big button (05 #13) · M

The button shows the unit being made ("Flying geese 23 / 80") with a small drawing of that unit cropped by R2 from
the block-diagram pages (Harmony pp4–11 are vector). Tap = +1, and "Step done" becomes a link. This is the open
05 #13, and it is what S2 animates. **Proof:** a sewing.test tap increments `units[i].done`; the crop box is
asserted on Harmony.

### 12. S4 — The step's own picture in the button · M

The step button shows the figure printed beside that step, cross-fading on Next. R2 finds image and path clusters
on the step's page; each pairs with the nearest step paragraph by vertical overlap, inside the column bands
`PdfText` already computes. Stored as `step.fig = {page, rect}`, with no figure when no pair is confident.
**Proof:** Bathers, Samford and Mabel hand-marked once; ≥ 85% exact pairs and 0 figures from another page.

### 13. R3 — Phone photo of a paper chart, rectified from its own grid · L

**User sees.** Photograph a printed chart at an angle in kitchen light; the app straightens it, evens the light,
shows the grid over the result and reads it with `XSRead`, or says the grid is not clear enough.

**How.** Sobel on a 1,600 px downscale, then a Hough transform on gradient orientation finds two line families. Their
vanishing points plus the chart's outer box give a first homography, refined by Gauss–Newton on 8 parameters so the
rectified line positions form arithmetic sequences. A one-parameter barrel model is fitted to line straightness.
Lighting: estimate the paper as a large-kernel max filter then blur, per channel, divide, and white-balance on the
background. Hand the result to `XSRead` at the source pitch.

**Accuracy.** Unknown without photos. Estimate: colour charts at ≥ 8 px a stitch after rectification read ≥ 99%.
B&W symbols need ≥ 13 px (reader.md), so a 4,000 px photo covers at most about 300 stitches across: the app should
say "fill the frame with the chart". Curled paper (a cylinder) needs a mesh warp, v2. **Needs owner photos.**

### 14. R4 — Opt-in Tesseract for scanned booklets · L (plus a hosting decision)

**User sees.** On a scanned PDF (West End, APL books, Nicoll p3+): "Read the page pictures as text — downloads a
6–8 MB reader once, then works offline". The text is marked "read from a picture — check it", goes through the
existing parsers, and the confidence banner is forced to "check every row".

**Why.** It is the only route for image-only fixtures in three crafts; 06 #22 called it "low ratio, high strategic
value".

**Candidates (all memory; sizes and speeds need a spike):**

| engine | licence | download | phone speed / memory | fit |
|---|---|---|---|---|
| **tesseract.js v5** + **tesseract.js-core** (LSTM WASM) | Apache-2.0; traineddata Apache-2.0 | core ≈ 3–4.5 MB raw (≈ 1.5–2 MB Brotli); `eng` tessdata_fast ≈ 4 MB, _best ≈ 12–15 MB | ≈ 2–10 s per A4 page at 300 dpi; 150–400 MB peak | **Best fit.** Classic script, no build; `workerPath` / `corePath` / `langPath` self-hostable, offline once the SW caches them; word boxes let `PdfText` take OCR words as synthetic items (06 #22's design) |
| PaddleOCR PP-OCRv4 mobile on **onnxruntime-web** | Apache-2.0 models, MIT runtime | ORT ≈ 8–10 MB + det ≈ 2–5 MB + rec ≈ 8–11 MB | heavier; better on photos | Too big now; revisit for R3 |
| Scribe.js | AGPL-3.0 | — | — | **Licence incompatible** |
| ocrad.js, GOCR | GPL | small | weak | **Licence incompatible** |
| `TextDetector` (Shape Detection API) | browser | 0 | — | Behind flags / desktop-only (memory) |
| Transformers.js TrOCR / Florence-2 | Apache / MIT | 50–500 MB | slow | Too big (Do not build) |

**How.** Vendor the files under `js/vendor/tesseract/`, **not precached** (they would double the 4.75 MB install).
On first opt-in, fetch them same-origin into a separate cache (`thready-ocr-v1`) that `sw.js` serves offline;
Settings shows "Text reader: 7.1 MB · Remove". Only `emptyPages` are rendered, at scale 2–3, with the shell's Cancel
and wake lock. Per-field character whitelists (digits in size tables, the knitting vocabulary) and R1's lexicon
decode for floss codes cut errors.

**No per-user cost.** Static files on our host, about 7 MB per user once (10k users ≈ 70 GB). GitHub Pages has a
soft 100 GB a month and Cloudflare Pages (in the launch plan) has free bandwidth (both memory). Owner decision.

**Proof.** `test/ocr.fixtures.html` against transcriptions we own (West End, read by OCR in the wave E sewing audit;
Nicoll Plain Socks, `docs/research/knitting.md` §7a; the tapestry-painted p5 key): character error rate, rows whose
computed count equals ground truth, and "confident wrong" rows, which must be 0 after the parser's mismatch flag.
Guess: 2–5% CER on clean scans, 10–20% on APL halftones, so the review step is mandatory.

### 15. X4 — Framed finish and share picture · S (after X1)

Finishing shows the piece in a wooden hoop or a mat-and-frame (two taps) with a soft shadow; **Save picture**
writes a 2048 px PNG. X1 renders offscreen at a fixed zoom; the hoop is an SVG ring plus a radial vignette, with the
fabric outside it dimmed and crinkled by cheap normal noise. `canvas.toBlob`, plus the share sheet where it exists.
This ties into the open share-card item (wave 2, 10 #1). **Proof:** an export size and colour-probe test.

### 16. K3 — Stranded colour from the chart onto the knitted model · M

An argyle or Fair Isle sock shows its motif stitch by stitch on the 3D sock. `KnitChart.rowCells()` already returns
`color`; `diagramModel` maps chart rows onto each round's records by repeat as `rec.col`, and `diagram.js` gains a
per-slice colour attribute (one byte per vertex; today colour is per band). A `?n` cell keeps the main colour and
the round says "chart partly read". **Proof:** socks p23 Chart A (read exactly), colour per stitch asserted
against the chart cells; a gallery card.

### 17. S5 — Cutting board, to scale · M

Every piece as a to-scale rectangle in its fabric, packed onto WOF strips for quilts, showing the strip → subcut
chain (05 #14: 7 strips become 56 squares, drawn inside their strip). Tap to count cut (existing `cutCount`).
Garment pieces, whose shapes a booklet does not hold, are labelled boxes only. Shelf packing (first-fit decreasing
height) across the fabric width (42″ default or the row's own), in SVG, labelled "one way to cut it"; yardage stays
the pattern's. **Proof:** no overlaps, and every row's quantity equals its drawn pieces (Catwalk's 64 rows).

### 18. X5 — Backstitch and knots drawn on the fabric · M (draw only)

Reading backstitch strokes from PDFs (HANDOFF item 8) belongs to the key lens. My part is X1's line pass and the
loupe drawing them over the crosses at the strand count's thickness, keeping the button's existing "walk
backstitch once a colour's crosses are done". **Proof:** a synthetic chart with three segments renders three
raised lines over the crosses.

### 19. K4 — Sock follow mode on the bend · S

A bent sock turns about the leg axis, so foot rounds never face you (knit-3d "still wrong"). Rotate about the
working segment's axis from `cls.warp.bends`, blending between segments. **Proof:** the `Diagram.follow.rotation`
test extended to a foot round, with the working stitch's normal within 10° of the camera.

### 20. R6 — Recognition harness and accuracy ledger · M

`test/recognise.fixtures.html` runs R1, R2, R4 (and R3 once photos exist) over the fixtures against a ground-truth
JSON per page in `docs/research/` (codes and boxes only, no copyrighted text beyond identifiers). It prints exact
rows, character error rate, region IoU and "confident wrong" per page. This is the 01 §2 discipline for
recognition: a number changes only with its argument written beside it. Build it **first** among the R items so
each lands against a ratchet.

## 3. Top 8

1. **X1 — Stitched-fabric renderer.** Any chart, even 250k stitches, looks like thread on aida, at constant cost.
2. **X2 — Loupe in the tap button.** Every tap on a big chart finally shows something; today it shows nothing.
3. **S1 — Real fabric swatches.** The booklet's own prints on every chip: cheap, and it changes how sewing feels.
4. **R1 — Glyph-template floss-code reader.** Image-only keys read with no engine or download, kept honest by the
   DMC lexicon and swatch colours.
5. **R2 — Page segmenter.** Finds chart, key, photo and figure; fixes wave J's wrong box; feeds S2, S3, S4.
6. **S2 — Quilt top assembling block by block.** From the vector layout, in the real fabrics: sewing's centrepiece.
7. **K1 + K2 — The whole garment.** Sweater and sock as one object, a pieces board when unsure, baked textures so
   cables survive.
8. **R4 — Opt-in Tesseract.** The only route for scanned booklets in three crafts; 6–8 MB once, then offline.

**Build first: X1, with X2 as its first consumer.** It is the biggest visible gain for the craft whose button is
blank today; it needs no parser work, fixture or owner decision; its budget can be measured on Pokémon TL at once;
and it lays the cell-texture pipeline X3, X4 and X5 reuse.

## 4. Do not build

- **On-device vision-language models** (Florence-2, TrOCR, a VLM via Transformers.js / ONNX): 50–500 MB, slow on
  phones, and confident hallucination is what "accuracy over reach" forbids.
- **GPL / AGPL OCR** (Scribe.js, ocrad.js, GOCR): incompatible with proprietary code.
- **Server or cloud OCR by default:** a per-user cost. If ever wanted it is a **paid service** (Google Cloud Vision
  or AWS Textract, about US$1.50 per 1,000 pages, memory: check current pricing), opt-in Pro only.
- **Instanced geometry per cross-stitch:** 250k instances × about 20 vertices blows the vertex and memory budget;
  X1's fragment approach costs the same at any size.
- **Cloth simulation for garments or quilts:** no phone budget for it, and it invents drape the pattern never
  states. Warped surfaces (K1) and one curved quad (S2's trophy) are enough.
- **three.js or another 3D library:** about 600 KB and a second renderer beside the raw WebGL one that passes the
  reference set. The MIT licence is fine; the value is not.
- **A WebGPU-only renderer:** keep WebGL1; WebGPU is not on every phone the app runs on today (memory).
- **Tracing garment pieces off A0 sheets, for now:** `sew-peppermint-apron-A0.pdf` has vector outlines, but pairing
  pieces to names across nested sizes is research. Revisit after S5 proves the board is used.
- **A quilt tiling guessed from text** when no layout drawing is read: invented geometry.
- **A fake time-lapse built from the bitmap** (row order) for projects with no log: a made-up history.

## 5. Asks for the owner

1. **Approval to download, for a spike:** tesseract.js v5, tesseract.js-core (LSTM WASM) and `eng.traineddata`
   (tessdata_fast), vendored under `js/vendor/tesseract/` with Apache-2.0 notices. The spike measures download size,
   phone speed and memory, and character error rate on West End, Nicoll and tapestry-painted.
2. **Decision:** host the OCR files as an opt-in download, not precached (about 6–8 MB per user once). Confirm the
   host (GitHub Pages now, Cloudflare Pages in the launch plan) and that the feature is free, not Pro.
3. **Fixtures:** (a) about 10 phone photos of printed fixture charts (two colour, one B&W symbol; 0° / 15° / 30°
   tilt; window light and lamp light) for R3; (b) a photo of a finished cross-stitch with its chart, to tune X1's
   sheen; (c) a quilt pattern whose layout page is raster only, for S2's failure path; (d) a Fair Isle or stranded
   knitting pattern with a colour chart and a finished photo, for K3; (e) the real "Po Ta Toes" PDF (already owed).
4. **Decision:** is the time-lapse video (X3) and the framed share picture (X4) free or Pro? Neither costs anything
   to run.
5. **A real-phone measurement session:** X1, K1 and K2 carry estimated GPU budgets. One mid Android phone and one
   iPhone running `frameMs` on Pokémon TL and a synthetic sweater would turn them into numbers (the open "touch
   hardware" ask, HANDOFF item 3).
