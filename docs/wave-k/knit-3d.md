# Wave K: knit-3d (K4, snapshot, K3, K1, K2)

Owner of `js/diagram-geo.js` (1.6.0 to **1.8.0**), `js/diagram.js` (1.7.0 to **1.8.0**),
`test/diagram.test.html`, `test/diagram-model.test.html`, `test/diagram.gallery.html`,
`test/diagram.knit-synth.js`. Interface: `docs/wave-k/api/knit-3d.md`.

Status: **K4 done. Snapshot done. K3 done on my side, needs the knit-store glue below. K1 done on
my side (sock chain, pullover assembly, pieces board), needs the app glue below. K2 done for the
whole-garment view (flat pieces), SSIM 0.951. Follow-ups done: `handle.setDone` (progress
without a rebuild) and a pieces board laid out for the frame.** `diagram.test` 260 to
**284 / 0**; with the reference fixtures **340 / 0** (316 before: the same 56 fixture
assertions, crochet unchanged); `diagram-model.test` **529 / 0** (now that
`TIMEOUT=600 bash tools/headless-suite.sh` runs in real time).

## Follow-ups (second session)

- **`handle.setDone(ref, round, done)`** (shell-ui's ask): moves which rounds are worked, how much
  of the working round is drawn, the glow and `current` in an assembled view (a piece by id, a
  sock section by id, or a plain model) with **no rebuild**. Asserted: 60 taps and two row changes
  on the pullover's sleeve, then a row change in a chained sock, leave `getStats().rebuilds`
  unchanged; **23 µs a call**, worst 0.5 ms (headless). Shell-ui's measured 76 ms row change can now
  be this call.
- **The board fits the frame**: `assemble(parts, { aspect })` puts the largest piece first and
  wraps into shelves, picking the shelf count that draws the board biggest. Measured: at 375 × 812
  a pullover takes 3 shelves (Back / Front + Sleeve / Sleeve + Neckband) and is drawn **2.17×** the
  size one row gave; a 1280 × 500 frame keeps one row. To scale, nothing overlaps (asserted).

## Baseline (before my first edit)

| suite | count | how |
|---|---|---|
| `diagram.test` | **260 / 0** | `BUDGET=180000 bash tools/headless-suite.sh diagram.test` (WebGL works headless: the demo and live-handle tests run on SwiftShader with `--disable-gpu`) |
| `diagram-model.test` | **443 / 0 synchronous, no summary** | headless `--dump-dom` returns as soon as the synchronous groups end; the fixture groups 18+ (PDFs through pdf.js) never finish in headless, at any `--virtual-time-budget` or with `--timeout`. The page does not load `js/diagram-geo.js` or `js/diagram.js`, so nothing I own can change it. |

## What the user sees

- **K4. Follow mode on a bent sock.** Knitting the leg, nothing changes. Through the heel the sock
  tips over smoothly, row by row, and on the foot the foot stands upright and turns with each tap,
  so the stitch just made faces you (before: the foot turned about the leg's axis and its
  stitches never came to the front; worst stitch 90° off the camera). A finished sock, or follow
  switched off, stands upright again. The contact shadow fades out while the piece is tilted.
  On a heel-flap row the turn and the over-count wedge now start after the held stitches.
- **Snapshot.** `handle.snapshot()` gives the share card a still of the piece, cropped to it,
  without a second 3D view.
- **K3. Stranded colour.** A colourwork round shows its chart stitch by stitch on the model (the
  renderer already coloured per slice from `rec.c`; what was missing was putting the chart's colours
  on the records). An unread chart cell keeps the main colour and the round carries
  `chartPartial`. Gallery: "K3 · stranded peerie band" card on the 8-socks chip (synthetic).
- **K1. The whole piece** (once the app glue lands). A sock imported as Cuff / Leg / Heel Flap /
  Turn Heel / Gusset / Foot / Toe is one sock: the sections chained in work order, the heel bend
  the one-part L already draws, finished sections solid, the section being worked glowing at its
  round, later ones ghosts, and K4's follow tilt on the foot. A pullover of flat Back, Front,
  Sleeves (×2) and Neckband is put together: back and front each bent round half an elliptic body
  (depth 0.62 of width), the side seams meeting row by row below the underarm and the armhole
  opening above it, the sleeves rolled into tubes and set in at 70° with their underarm seam on the
  body's underarm, the neckband ringed at the neck. Anything the app cannot place honestly is the
  **pieces board**: every part side by side, to scale, on one baseline, with a plain reason
  ("cannot tell what Part 3 is", "the front (140 sts) and the back (100 sts) do not go round one
  body", "cardigan fronts are not put together yet").
- **K2. Baked fabric.** A whole garment draws each row with a few coarse slices (the vertex
  budget), which on its own turns cables and rib into blocks. Each finished or started flat piece
  is now baked once, a little per frame, into an albedo + normal texture, and the coarse rows
  sample it, so the cables, the rib at the hem and cuffs and the stockinette texture are back.
  Until a piece's bake is done (a fraction of a second) it is drawn as before.

## The contract as built

See `docs/wave-k/api/knit-3d.md` for signatures.

- `DiagramGeo.frameAt(warp, y)`: the warp's rotation at walked height y (bends, lowest first, then
  the toe-up turn), row-major 3x3. `followFrame(cls, i)`: `{m, y, c, deg}` for band i, null when
  nothing is bent or in rows mode. `extentsIn(cls, bands, m, c)`: the same 32 samples per band as
  the layout's own extents, seen through p -> m(p - c).
- `Diagram.follow.tilt(geo, i)`: `{v, c, m, frame, deg}`. The tilt is the smallest rotation
  taking the band's local axis to the vertical of the piece's most upright segment (+y for a
  top-down sock's leg, the leg's direction for a toe-up sock), about the axis line through the
  working round (`c` = that line's closest point to the origin, so a tap on the same round moves
  nothing and the fit does not jitter row to row on the leg). `Diagram.follow.aim(tilt, a)`: the
  yaw from the stitch's real direction on the finished piece (`atan2(-n.x, n.z)` after the tilt),
  identical to wave F's `a - pi/2` on an unbent piece. `follow.angle(..., held)`.
- Renderer: view = camera x tilt, with the fit's centre taken back through the tilt. The tilt
  eases (rotation vector and centre, linearly: exact within one bend) with wave F's durations,
  snaps under reduced motion. The fit reads `extentsIn` for the target tilt (computed once per
  row change, ~32 x bands `warpPoint` calls). `getStats().follow.tilt = {on, deg, band, animating}`.
- `handle.snapshot({size, background, crop, pad})` / `snapshotBlob()`: renders one frame
  synchronously at up to 2048 px (the relief tier is held, so nothing is rebuilt), with no safe
  insets, reads it back in the same task (no `preserveDrawingBuffer`, no rAF: works on a hidden
  page), crops to alpha > 8, scales to `size`, puts the canvas back and redraws it.
- `DiagramGeo.chartColors(stitches, cells, opts)` / `applyChart(round, cells, opts)` (K3).
- K1: `DiagramGeo.roleOf / construction / chainSock / assemble / pieceLayout / underarmOf`;
  `warpPoint` gained three terms used only by a whole garment's pieces: `wrap` (a rows sheet bent
  onto half an ellipse of half-perimeter = the row's own width below the underarm, the underarm's
  above it, arc-length parametrised), `roll` (a rows sheet rolled into a tube of circumference = the
  row's width, seam placed under the arm) and `place` (rigid). The renderer takes
  `{pieces: [...]}` models: each piece normalised on its own, rounds and bands end to end, each
  band carrying its piece's mode, row index and warp.
- K2: `mount({bake: false})` switches it off; `handle.finishBake()`; `getStats().pieces.bake =
  {jobs, ready, failed, rowsBuilt, texels, ms}`. The bake is a second tiny program (orthographic,
  two passes: sqrt-linear albedo, sheet-space normal) into power-of-two textures (nearest power of
  two, ≤ 1024), mipmapped when done; at least 4 texels a stitch, more when the piece is seen
  bigger. Only distinct rows are built (same stitches, yarns, width, position, direction), the
  rest redrawn moved up. In the main shader a baked row maps slice + uv to the sheet position (a
  coarse row now has even slices so this is exact) and perturbs the coarse normal in a frame from
  the piece's own "up". Coarse pieces never paint the per-slice V texture (a slice there is
  several stitches).

## Measured

- K4, synthetic Speed Bump sock (research §2b), 12 stitches round each of 3 rounds per segment:
  worst working-stitch direction off the camera **0.0°** on the foot (was **90°**), leg 0.0°,
  heel turn and gusset 0.0°; toe-up foot 0.0° (was 87.8°), toe-up leg 0.0° (was **157°**: wave F
  turned a toe-up leg the mirror way). Tilt blends 0° to 90° through the heel, at most 2.4° per row.
  A live handle on the foot: tilt 90°, 6 taps rebuild 0 chunks.
- Snapshot of a 189-round sock at 400 px: 167 x 400, 56% of the pixels are the piece.
- K3: 56 of 56 slices take the right yarn through `normalize`.
- K2, a three-cable swatch (C6F, C6B, T3F, 28 rows) in a 320 px viewer, the same piece through the
  same path at full detail as the reference: **SSIM 0.951** baked (≥ 0.9 required) against
  **0.805** for the coarse rows unbaked; 30,240 vertices at full detail, 6,720 coarse; 12 distinct
  rows built for 28; 23 ms. First tries, for the record: 0.634 (compared against a differently
  framed single-piece render, and soft at 5 texels a unit), 0.899 (coarse slices took sampled
  widths, so the texture slid up to half a stitch on the cables).
- K2, the whole pullover: 4 of 4 flat pieces baked from **126 distinct rows of 460**, **351 ms in
  all** headless (SwiftShader, so a GPU is faster), spread at 8 ms a frame; **5 MB** of texture
  (about 6.7 MB with mipmaps; 20 MB before rounding sides to the nearest power of two rather than
  up); the drawn mesh stays at 131,796 vertices, one draw call a row. Phone GPU not measured.

## Verified, and how

Headless screenshots (my own harness pages in my temp dir loading the dev server's scripts):
the tilted sock at 375 x 812 (foot upright and centred, leg off to the side, toe ghosted below);
the peerie band on the leg, diamonds stitch by stitch; the sock chained from 7 sections (the same L,
tilted on the foot); the pullover at 375 x 812 and 1280 x 800, before and after the bake (after: rib
at hem and cuffs and the stockinette texture, no moiré once mipmapped); the pieces board at 375 x
812 (first session: five pieces in one row, small; now wrapped, see Follow-ups); the cable swatch geometric / baked / coarse side by
side.

Second session, at 375 × 812 with each theme's palette worked out as `diagramPalette()` does
and the viewer stage's own background (`--primary`): the wrapped board, the assembled pullover and
the stranded sock in **Stardrop Night**, **Pixel Wyrm** and **Stardew Spring** (light). All read: on
Pixel Wyrm the not-started neckband's ghost is the theme's dark ink on the pink stage, visible; the
peerie band reads on pink and on green. (A first pass painted the harness with `--surface` and the
ghost vanished on Pixel Wyrm; the real stage is `--primary`, where it does not.) The reference
fixtures ran in a Browser-pane tab (rAF shimmed in that tab only), **340 / 0**, tab closed. The
**K3 gallery card opened** in a tab: on the 8-socks chip, "1. SYNTHETIC reference · K3 · stranded
peerie band", 189 rounds, 1 bend, colours `3: #efe6d2 #9c2f2a #2b5a8a` on the model; tab closed.
`diagram-model.test` (which loads none of my files) is 529 / 0 in real time.

## For the owner of js/store.js (knit-store), K3

`DiagramGeo.applyChart` does the work; the store only has to find the chart row for each knitting
round. Paste after `flagOutliers(mode, rounds);` in `buildDiagramModel`:

```js
    // wave K (K3, knit-3d): stranded colour from a read chart, stitch by stitch
    var DG = window.DiagramGeo;
    if (knit && DG && typeof DG.applyChart === 'function') {
      for (var kci = 0; kci < rounds.length; kci++) {
        var kcells = knitChartCellsAt(prt, proj, rounds[kci].row);
        if (kcells) rounds[kci] = DG.applyChart(rounds[kci], kcells, { palette: yarnColorsOf(proj), main: mainYarn(proj) });
      }
    }
```

`knitChartCellsAt(prt, proj, patternRow)` is `chartInfo`'s chart / chart-row resolution for an
arbitrary pattern row instead of the current one, ending in
`KnitChart.rowCells(chart, chartRow, inRound ? null : side)`; it returns null when the row has no
read chart, the chart is an image, or no cell has a `color`. `yarnColorsOf(proj)` must be keyed by
the chart's labels (`MC`, `CC1`, …, as the key names them); labels with no colour stay main, so
nothing is invented (`mainYarn(proj)` is the existing helper). Add the chart pages' read state and the yarn colours to the model's cache key.
Say "chart partly read" where the round has `chartPartial`.

## K1 measured (synthetic references in `test/diagram.knit-synth.js`)

- Sock in 7 sections: 189 rounds, one 90° bend, foot reach 69.58 = the one-part sock's exactly.
- Pullover (Back / Front 100 sts × 132 rows, Sleeve 50 → 74 sts plus cap, Neckband 84 × 6): side
  seam gap **0.000 st** on every row below the underarm (≤ 0.5 required), sleeve underarm to body
  underarm **0.000 st**, both cap tops inside the armhole. Board: 5 pieces, no overlap, largest
  first, wrapped to the frame (see Follow-ups).
- Budget: the pullover is ~40k stitches. At the lowest relief tier that was **719,928 vertices and
  842 ms** to build (measured, first try): far over the viewer's 160k. Now each row of a whole
  garment is drawn with at most `sliceCap` slices (14 here, from a 140k budget): **131,796
  vertices**, built in **183–222 ms** headless, once when the view opens; one draw call per row
  (526 here), as for a single part. At that size a stitch is ~1.5 px, below where the relief and the
  stitch texture already fade out, so the silhouette, seams and colours are what is left to see.
  Zooming in on a whole garment shows the coarse rows: that is what K2 (baked textures) is for.

## For the owner of js/app.js / js/app-knitting.js (K1 glue)

Feature-detect `DiagramGeo.assemble`. In the ⤢ viewer (and working mode's Options) of a knitting
project with 2 or more parts, add a **Whole piece / This part** switch. On Whole piece:

```js
var parts = proj.parts.map(function (p) {
  return { id: p.id, name: p.name, makeCount: p.makeCount || 1,
           state: p.done ? 'done' : (p.id === activePart.id ? 'working' : 'todo'),
           model: Store.diagramModel(p) };   // whatever the viewer already calls per part
});
var A = DiagramGeo.assemble(parts, { aspect: canvas.clientWidth / canvas.clientHeight });
viewerHandle.setModel(A.model, { animate: 'none', finished: !!A.model.finished });
caption.textContent = A.kind === 'board' ? 'All the pieces · ' + A.reason : (A.kind === 'sock' ? 'The whole sock' : 'The whole sweater');
// then, on a stitch tap or a row change of the active part (no rebuild):
if (typeof viewerHandle.setDone === 'function') viewerHandle.setDone(activePart.id, roundIndexInPart, stitchesDone);
```

Only one part is `'working'` (the active one). Call `assemble` + `setModel` again only when parts
are added, removed, re-read or finished; `setDone` covers taps and rows. Leave the stitch button on
the single part.

## Left / decisions

- **Phone GPU unmeasured** (as for all 3D so far): K1/K2 numbers are headless SwiftShader. The
  budgets to tune are `PIECES_BUDGET` (140k vertices), `BAKE_PX` (4), `BAKE_MAX` (1024),
  `BAKE_STEP_MS` (8) in `js/diagram.js`.
- K2 covers flat (rows) pieces of a whole garment only. A single big piece (a 144-row shawl in its
  own viewer) still drops to the low relief tier as before; the same bake could serve it (draw it
  as a one-piece `{pieces}` model), not done. Pieces in the round (a neckband, a sock on the board)
  are not baked. The bake ignores per-row yarn wobble (a repeated row repeats its wobble) and the
  relief's parallax (seen edge-on, the baked fabric is flat).
- The set-in sleeve cap is a rolled cone (the armhole above the underarm shows as an open gap
  beside it); a real cap is sewn round the armhole. Good enough to read as a sweater, not a fit.
- The board is laid out once per `assemble`; a phone turned on its side keeps the portrait layout
  until the host re-assembles (the call above, on resize).
- `setDone` does not re-bake a piece that went from not started to started (it is drawn coarse,
  unbaked, until the next `setModel`).

- K1 does not yet assemble raglans / round yokes in parts, cardigans (two fronts), or pieces worked
  in the round other than the neckband; they get the board with a reason. The sleeve angle (70°)
  and body depth (0.62) are fixed choices, not read from the pattern; size is in stitch units
  (all parts share the gauge), not from a printed chest measurement.
- No real fixture is assembled: the parser does not yet give whole Back / Front / Sleeve parts for
  the Patons pullovers (the "(continued)" sections), so the proof is synthetic, as the proposal
  says.
