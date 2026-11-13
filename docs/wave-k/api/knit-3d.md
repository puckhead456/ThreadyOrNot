# API: knit-3d (wave K): `DiagramGeo` 1.8.0, `Diagram` 1.8.0

Status: K4, snapshot, K3 (needs store glue), K1 (needs app glue), K2 BUILT. Owner of `js/diagram-geo.js`,
`js/diagram.js`, `test/diagram*.html`, `test/diagram.knit-synth.js`. Everything is additive; a
crochet model takes none of these paths. Feature-detect (`typeof DiagramGeo.assemble === 'function'`)
and degrade quietly. Report: `docs/wave-k/knit-3d.md`.

## K4: follow mode on a bent sock (no caller change)

Follow mode now also tilts the piece so the working segment's axis stands up, then turns about it
as before. On a top-down sock the leg is upright while you knit the leg; through the heel the sock
tips over smoothly; on the foot the foot stands up and each tap brings the stitch just made to the
front. Nothing changes for an unbent piece (crochet, hats, raglans, flat pieces).

```js
DiagramGeo.frameAt(warp, y, out9?) → number[9]   // row-major rotation: the warp's turn at walked height y
DiagramGeo.followFrame(cls, i)    → { m: number[9], y, deg } | null   // band i's local frame; null = no bend
DiagramGeo.extentsIn(cls, bands, m9) → [{ rad, ymin, ymax } | null]    // band extents seen in frame m9
Diagram.follow.tilt(geo, i)       → number[9] | null                   // the tilt follow mode applies (frame transposed)
Diagram.follow.angle(index, count, a0?, aw?, held?)                    // `held` = slices before the worked ones (heel flap)
handle.getStats().follow.tilt     → { on, deg, band }
```

Also fixed: on a heel-flap row (held stitches drawn first) the follow angle and the over-count
wedge now start after the held slices.

## Snapshot (for js/sharecard.js)

```js
handle.snapshot(opts?) → HTMLCanvasElement | null
  opts = { size?: 512,            // longest side of the result, px (clamped 64…2048)
           background?: null,     // null = transparent; a CSS colour paints it (e.g. the theme's --bg)
           crop?: true,           // crop to the piece's drawn pixels plus `pad`
           pad?: 0.06 }           // fraction of the longest side
handle.snapshotBlob(opts?) → Promise<Blob|null>   // the same, as a PNG
```

Renders one frame synchronously into the live canvas (no rAF needed, so it works when the page is
hidden), reads it back, and returns a new 2D canvas. `null` when there is no GL context (the 2D
fallback) or nothing is drawn.

## K3: stranded colour from the chart (needs the knit-store glue below)

```js
DiagramGeo.chartColors(stitches, cells, opts) → { colors: (hex|null)[], labels: (string|null)[],
                                                  unknown: n, partial: bool, width: n }
  cells = KnitChart.rowCells(chart, row, side)   // in knitting order
  opts  = { palette: { MC: '#hex', CC1: '#hex', … }, main: '#hex', offset?: 0 }
DiagramGeo.applyChart(round, cells, opts) → round  // a copy whose stitch records carry `c`,
                                                  // plus `chartPartial: true` when cells were unknown
```

Cells are laid onto the round's stitch records by repeat (the chart row's produced stitches,
repeated round the round from `offset`). An unknown cell (`?n`) or a label with no palette colour
keeps the main colour (`c` left unset). The renderer already colours per slice from `rec.c`.

Store data needed: per knitting round whose line names a read chart, the chart object, the chart row,
the side (`null` in the round) and the palette `{label: hex}` from the project's yarn colours.

## K1: the whole piece (BUILT)

```js
DiagramGeo.roleOf(name) → role | null
  roles: 'back' 'front' 'left-front' 'right-front' 'sleeve' 'neckband' 'body' 'yoke'
         'cuff' 'leg' 'heel-flap' 'heel-turn' 'gusset' 'foot' 'toe'
DiagramGeo.construction(parts) → { kind: 'sock' | 'sweater-flat' | 'board', reason }
DiagramGeo.chainSock(parts) → Model v2 + { sections: [{id, name, role, from, to, state}], toeUp } | null
DiagramGeo.assemble(parts, kind?) → {
  kind: 'sock' | 'sweater-flat' | 'board',
  reason,                       // plain words: why the board, when it is the board
  checks,                       // sock: {bends, sections}; sweater: {sideSeam, capArmhole, capInside, …} in stitches
  model                         // pass straight to handle.setModel(model)
}
  parts = [{ id, name, role?, makeCount, state: 'done' | 'working' | 'todo', model }]
          // in pattern order; model = Store.diagramModel(part) for that part
  kind  = optional 'board' to force the pieces board
DiagramGeo.pieceLayout(model, extra) / underarmOf(layout)    // used by assemble; exported for tests
```

- `'sock'`: `model` is an ordinary Model v2 (all the sections' rounds in work order, toe-up when
  the toe comes first in the parts' order). The heel bend, K4's follow tilt and the glow on the
  round being worked all work unchanged. `model.current` is the working section's round.
- `'sweater-flat'` / `'board'`: `model = { pieces: [{id, name, role, state, model, layout, copy}],
  kind, current, finished }`. `handle.setModel(model)` draws it: back and front bent onto half an
  elliptic body each, the sleeves rolled into tubes and set in at 70°, the neckband ringed at the
  neck; or every part side by side on one baseline (a part made twice is shown twice). Follow mode
  does not turn it (`getStats().follow.key === 'pieces'`); `getStats().pieces = {kind, count,
  rounds, sliceCap}`.
- Proven constructions: a sock in sections (top-down or toe-up); a pullover of flat Back + Front
  + Sleeves (+ Neckband), set-in or drop shoulder. Everything else (cardigan fronts, raglans and
  yokes in parts, pieces in the round other than the neckband, an unnamed part, a Front more than
  25% off the Back or a different length) is the board, with `reason`.
- Budget: a whole garment is drawn at most `sliceCap` slices a row (from a 140k-vertex budget at
  the lowest relief tier): the synthetic pullover (~40k stitches) is 131,796 vertices, built once
  in ~180–220 ms headless when the view opens, never on a tap.

## K2: baked fabric for a whole garment (BUILT, no caller change)

A `{pieces}` model (from `assemble`) draws each row coarse; every flat piece that is not a ghost is
baked in the background (8 ms a frame) into an albedo + normal texture that its rows then sample,
so cables and rib survive. Nothing to call; optional:

```js
Diagram.mount(canvas, { bake: false })     // never bake (draw coarse only)
handle.finishBake()                        // finish any bake now (tests; before a snapshot)
handle.getStats().pieces.bake → { jobs, ready, failed, rowsBuilt, texels, ms }
assembled.model.sliceCap = n               // optional: draw rows with at most n slices
```

Textures: power-of-two, ≤ 1024 a side, mipmapped, about 5 MB for a plain pullover; dropped on
context loss and baked again when the context comes back.

## Moving progress without a rebuild (BUILT, for shell-ui)

```js
handle.setDone(ref, round, done, o?) → { ok, current, ms }
  ref   = a piece's id in a whole garment (`assemble(...).model.pieces[k].id`, the part id you passed),
          a section's id in a chained sock (`model.sections[k].id`, the part id you passed),
          or null for the whole model (a plain single part)
  round = the round index INSIDE that part's own model (0-based)
  done  = stitches done on that round
  o     = { animate: 'stitch' | 'none' }   // default: 'stitch' when the same round grew by one
```

Rounds of that part before `round` become worked, `round` shows `done`, the rest of the part become
ghosts; other parts are untouched. It only moves draw ranges, the glow and `current`: **no
geometry is rebuilt** (`getStats().rebuilds` is unchanged; measured 23 µs a call headless, worst
0.5 ms over 60 calls on the whole pullover). An unknown `ref` returns `{ ok: false }` and changes
nothing. A part that changes state (todo to working) is not re-baked until the next `setModel`.
Feature-detect `typeof handle.setDone === 'function'`; call `setModel` again when parts are added,
removed or re-read.

`getStats().rebuilds` counts every geometry rebuild of the handle; `getStats().pieces.current` is
the combined round being worked.

## Board laid out for the frame

`DiagramGeo.assemble(parts, { aspect: canvasWidth / canvasHeight })` (or `{ kind: 'board', aspect }`)
lays the pieces board out for that frame: the largest piece first, wrapped into shelves, the shelf
count that draws the board biggest wins (375 × 812: three shelves for a pullover, 2.17× the size of
one row; a wide frame: one row). All pieces stay to the same scale. Without `aspect` it lays out
for a square frame. Re-assemble on a big resize (a phone turned on its side).
