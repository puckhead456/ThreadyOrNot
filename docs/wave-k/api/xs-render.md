# API: xs-render (`window.XSRender`, `js/xstitch-render.js`), wave K

Status: BUILT (wave K, batch 1), `XSRender.VERSION === '1.0.0'`. This is the contract the batch-2
xs-app worker builds on: names are fixed, fields may be added, never renamed. Feature-detect with
`window.XSRender && XSRender.VERSION`. Living examples: `test/xstitch-render.test.html` (pure
assertions, GPU probes, budgets, a viewer, the loupe with a Tap button, the time-lapse, a gallery of
share pictures, and a loader for real charts from `../tmp-pdf`). URL options for that page:
`?chart=sampler|confetti|big|backKnots&cx=&cy=&scale=&frame=hoop&fabric=Ecru&kind=linen&count=28&theme=stardew-night&tap=30&sym=1&reveal=0.4&gallery=1&real=xs-pokemon-tl&shot=viewer|loupe|gallery&sw=375&sh=812`.

One stitched-fabric renderer for cross-stitch: aida / evenweave / linen, two-leg crosses (bottom leg
`/`, top leg `\`, always), strand plies with twist and a sheen under a fixed light, per-stitch
variation (seeded by the holes, so neighbours share a hole), half / quarter / three-quarter stitches,
backstitch, French knots and beads on top, and the unstitched pattern as a faint printed tint or its
symbols. Raw WebGL 1: one full-screen pass whose cost does not depend on the chart size (the chart
lives in textures) plus one small geometry pass for backstitch and knots. Canvas 2D fallback (flat
stitched tiles) when WebGL is missing, and it says so.

Standalone: no dependency. It uses `window.XStitch` only to unpack an XSData (`unpackCells`,
`bitsState`, else `unpackBits`) when you hand it craftData instead of raw arrays.
**Not in `index.html` / `sw.js` yet**: the shell-ui worker adds `<script src="js/xstitch-render.js">`
(after `js/xstitch.js`) and the `PRECACHE_URLS` line.

## Model (what `setModel` / `picture` take)
Either an `XStitch.normalize`d **XSData** (unpacked for you), or a **raw model**, which is cheaper
because the app already holds the decoded cells and the live bitmap:
```js
raw = {
  w, h,                          // stitches
  cells: Int16Array|Array,       // w*h palette indices, -1 = empty; index = y*w + x (used as given, not copied)
  done:  Uint8Array,             // packed bits, LSB first: bit i = bytes[i>>3]>>(i&7)  (= XStitch.bitsState(..).bytes)
  palette: [{ hex:'1a1a1a', symbol:'▲', strands:2, bsStrands:1,
              kind:'cross'|'half'|'back'|'knot'|'bead'|'blend', blendWith:null|index, brand:'DMC', code:'310', name }],
  part:  [{ x, y, a, b, d }],    // fractionals, see below
  back:  [{ x1, y1, x2, y2, i }],// on the vertex lattice (cell corners), halves allowed
  knots: [{ x, y, i, t:'knot'|'bead' }],  // lattice positions
  doneBack, doneKnots, donePart, // Uint8Array packed bits, one bit per list entry (optional)
  fabric: { color:'White'|'Antique White'|'#f4f0e6'|'f4f0e6', count:14, over:1|2, kind:'aida'|'evenweave'|'linen' },
  strandsDefault: 2
}
XSRender.model(xsDataOrRaw) -> normalised model   // pure, never throws; model(null) is an empty model
```
- **`done` is adopted by reference** (so are the three layer bitmaps): `setDone` writes into the
  same bytes. Pass `view.bits.bytes` and the app's bitmap and the renderer's stay one; flipping a bit
  in both places is harmless (idempotent). If the app replaces its bitsState object (undo, import),
  call `setProgress(newBytes)`, which also adopts by reference.
- Strands set the leg width (with the fabric count); `bsStrands` the backstitch width. DMC `E…`
  codes (and names containing metallic / Light Effects / Kreinik) get a metallic sheen, `S…` satin.
  `kind:'half'` draws the bottom leg only. `kind:'blend'` + `blendWith` alternates the two colours
  ply by ply.
- Fractional `d` (as app-xstitch's `PART_TRIS`): colour `a` is a **three-quarter stitch**: a quarter
  leg from corner d (1 TL, 2 BR, 3 TR, 4 BL) to the centre plus the half leg on the diagonal that
  does not touch that corner; colour `b` (when ≥ 0) is a **quarter stitch** from the opposite corner.
  One fractional per cell (a second one in the same cell wins over the first).
- Limits: palette indices up to 4095; symbols are drawn for the first 256 palette entries; charts up
  to the GPU's `MAX_TEXTURE_SIZE` a side (4096 on every phone we know of).

## Mount
```js
var h = XSRender.mount(canvas, {
  view: 'fit' | 'loupe' | 'free',      // default 'fit'
  frame: 'none' | 'hoop' | 'frame',    // decoration, drawn in the 'fit' view only (default 'none')
  ghost: 0.22,                         // tint of unstitched squares (0..1), 0 = bare fabric
  symbols: false,                      // the palette symbol on unstitched squares (fades in from 9 to 14 device px)
  ghostBack: true,                     // undone backstitch as a thin printed line, undone knots as a ring (when ghost > 0)
  interactive: false,                  // pinch, wheel, drag with inertia, double-tap = fit (switches to 'free')
  reducedMotion: <prefers-reduced-motion>, // no leg-by-leg animation, no pulse, no eased moves, no inertia
  background: 'transparent' | 'theme' | '#rrggbb',
  theme: null,                         // { accent, bg, surface, text } override; else CSS vars, see setTheme
  minimap: true,                       // loupe: corner thumbnail of the whole piece with a "you are here" box
  stitchPx: 12,                        // loupe: CSS px per stitch it aims for (the window always fits the block + margin)
  safeInsets: { top, right, bottom, left }, // CSS px the piece keeps clear (the button's caption)
  model: rawOrXSData,                  // optional: same as calling setModel right after mount
  onStatus: function ({ webgl, status, message }) {},   // 'ok' | 'fallback' | 'unavailable' | 'lost' | 'restored'
  onTap: function ({ x, y, i, inside }) {},             // interactive: a tap (not a drag) on the canvas
  onView: function (view) {},                           // interactive: after a pan / zoom settles
  force2d: false                       // tests: the Canvas 2D fallback even with WebGL
});
```
- `mount` never throws on a missing context: it falls back to Canvas 2D and reports
  `status:'fallback'`, message "Showing a simple stitched view: this device has no 3D graphics."
  Show that message; the fallback draws flat stitched tiles, weave, backstitch and knots.
- **Shader compile is asynchronous** where the browser has `KHR_parallel_shader_compile` (Chrome,
  Edge, Safari 17+): `mount` returns in a few ms and the first frame appears when the GPU has
  compiled. On a fresh profile that took ~2 s here (the GPU's shader cache is cold); with a warm cache
  ~35 ms. `getStats().compiling` is true meanwhile; keep the old preview (or nothing) visible until it
  turns false, or mount the button's renderer as soon as the project opens.
- Live contexts: at most `XSRender.MAX_LIVE` (4: button + viewer sheet + share picture + one spare),
  its own registry like `Diagram`'s. A canvas that left the document is reaped first, then the
  shared picture context, then the oldest, which is told `'lost'`. Destroy with `{ release: true }`
  when you throw the canvas away.

## Handle
| call | what it does | measured here (desktop) |
|---|---|---|
| `setModel(model, { keepView })` | import, chart or palette change: pack and upload everything; re-fits unless `keepView` | 4.7 ms warm at 250k (pane), 12.7 ms for Pokémon TL |
| `setDone(i, on, { animate })` | **the tap path**: one cell; when `on` and motion is allowed the newest stitch is drawn leg by leg in 150 ms (`animate:false` to skip) | median 0.03–0.1 ms CPU at 250k |
| `setDoneMany(indices, on)` | bulk marks (a colour, a block, 21,000 at once): one upload of the rows touched | 2.4–3.3 ms for 21,000 random cells |
| `setProgress(bytes)` | replace the whole cross bitmap (undo, import); adopts `bytes` | ≈ 3 ms at 250k |
| `setLayerDone('back'\|'knots'\|'part', i, on)` | one backstitch / knot / fractional entry | a few bytes |
| `setView({ mode, x, y, next, cx, cy, scale, animate })` | `'fit'`; `'loupe'` on the block holding (x, y); `'free'` at (cx, cy) with `scale` in **device px a stitch** | uniform only |
| `setLoupe({ x, y, next:{x,y}\|null, symbols })` | switch to / move the loupe; moves (eased) only when the block changes; `next` marks the next stitch | uniform only |
| `setFrame('none'\|'hoop'\|'frame')` | hoop: the next standard size (3–14 in) that holds the design at its real count + 1 in; frame: mat and moulding | uniform only |
| `setFabric({ color, count, kind, over })` | the cloth; count sets real hoop size and thread fullness | uniform only |
| `setOptions({ ghost, symbols, ghostBack, reducedMotion, minimap, background, stitchPx, safeInsets, showNextInFit })` | | uniform only |
| `setTheme(themeOrUndefined)` | re-read `--primary` (falls back to `--accent`), `--bg`, `--surface`, `--text`; call after a theme switch | |
| `setOrder(order \| null) -> { fallback, label, count, before }` | mark order for the time-lapse (cell indices, oldest first) | one upload |
| `setReveal(f \| null)` | time-lapse position 0..1; `null` = live progress | uniform + colour image |
| `resetView()`, `panBy(dxCss, dyCss)`, `zoomBy(factor, cssX?, cssY?)` | buttons / keyboard for the free view | |
| `hit(clientX, clientY) -> { x, y, i, inside }` | screen point → cell at any zoom (`i` = -1 outside) | |
| `getView() -> { mode, cx, cy, scale, vw, vh, dpr }` | world units are stitches; `scale` = device px a stitch | |
| `snapshot({ type }) -> Promise<Blob>` | PNG of what is on the canvas now | |
| `renderNow()` | draw synchronously (waits for the compile); for exports | |
| `setInteractive(bool)` | turn the gestures on or off | |
| `benchmark({ frames, pan }) -> { msPerFrame, p95, median, cpuMs, frames }` | GPU-synced frame time (tests) | |
| `getStats()` | see below | |
| `resize()`, `isLive()`, `destroy({ release })`, `webgl` (bool), `canvas` | as `Diagram`'s | |

`getStats()` → `{ webgl, status, compiling, parallelCompile, frameMs, cpuMs, mountMs, contextMs,
layoutMs, startCompileMs, compileMs, firstFrameMs, lastUpdateMs, uploadMs, setModelMs, textureBytes,
cellPx, lod, detail, frames, contexts, w, h, dpr, mode, reveal, rankCount, fallbackOrder }`.
`lod` is `'thread'` (≥ 9 device px a stitch), `'blend'` (3.5–9, thread detail fading in) or
`'colour'` (< 3.5: a mipmapped colour image of the piece, rebuilt on the GPU when progress changes,
so 500 × 500 neither aliases nor shimmers). Rendering is idle when nothing changes: no rAF loop
except while something moves (the 150 ms newest stitch, a 2.4 s pulse of the next-stitch marker
after a change, eased moves, inertia, a playing time-lapse).

### Wiring the tap button (replaces `makeLivePreview`)
```js
var mode = XSRender.buttonView(chart.w, chart.h, rect.width, rect.height); // 'whole' | 'loupe'
var live = XSRender.mount(liveCanvas, { view: mode === 'whole' ? 'fit' : 'loupe', ghost: 0.28,
  safeInsets: { top: 34 }, onStatus: showOneLine });
live.setModel({ w, h, cells: view.cells, done: view.bits.bytes, palette, part, back, knots,
  doneBack: view.backBits.bytes, doneKnots: view.knotBits.bytes, donePart: view.partBits.bytes, fabric });
// on every tap, after the app has set its bit:
live.setDone(i, 1);                                   // or setDoneMany / setLayerDone
live.setLoupe({ x: cx, y: cy, next: nextCell ? { x: nx, y: ny } : null });
// −1: live.setDone(i, 0, { animate: false }); theme switch: live.setTheme();
```
The canvas under the button may stay `pointer-events: none`; the renderer never needs its events
unless `interactive`.

## Pure helpers (all asserted in the test page)
```js
XSRender.packCellTexel(idx, done, { part }, rank) -> [r, g, b, a]
  // r = idx & 255; g = (idx >> 8 & 15) | done << 4 | part << 5 | empty << 6; b, a = rank >> 8, rank & 255 (65535 = none)
XSRender.unpackCellTexel(r, g, b, a) -> { idx, done, part, empty, rank }
XSRender.packPartTexel({ a, b, d }, done) -> [r, g, b, a]
XSRender.packCells(model, rank?) -> Uint8Array(w*h*4)
XSRender.packPalette(model) -> Uint8Array(n*2*4)    // row 0: sRGB + strands*32; row 1: blend partner, sheen*80, kind*40
XSRender.lodFor(devicePxPerStitch) -> { tier, detail:0..1, weave:0..1, fine:0..1 }
XSRender.decorGeo(chartW, chartH, frame, fabric) -> { kind, cx, cy, … , x0, y0, x1, y1 }  // what surrounds the chart
XSRender.fitView(chartW, chartH, vw, vh, { frame, fabric, insets /* device px */, pad }) -> { cx, cy, scale }
XSRender.hitTest(view, sx, sy, chartW, chartH) -> { x, y, i, inside, wx, wy }  // view = { cx, cy, scale, vw, vh }, device px
XSRender.screenOf(view, x, y) -> { sx, sy }
XSRender.loupeWindow(chartW, chartH, x, y, { block:10, margin:2 })
  -> { bx, by, bx0, by0, bx1, by1, bw, bh, x0, y0, x1, y1 }  // the block (clipped to the chart) and the window around it
XSRender.loupeView(window, vw, vh, stitchDevicePx, insets) -> { cx, cy, scale }
XSRender.buttonView(chartW, chartH, cssW, cssH) -> 'whole' | 'loupe'   // whole when it fits at ≥ 5 CSS px a stitch
XSRender.replayOrder(model, order?) -> { order:Int32Array, fallback, label, before }
XSRender.fallbackOrder(model) -> Int32Array      // done cells by palette order, then reading order
XSRender.rankOf(order, n) -> { rank:Uint16Array, scale, count }
XSRender.revealCount(f, total) -> number         // cells started at time-lapse position f
XSRender.growWindow(total) -> number             // the width of the "growing" front, in reveal units
XSRender.orderFromMarkLog(log, n) -> Int32Array|null   // via XStitch.markLog.replay (xs-core §11) when present
XSRender.hoopFor(chartW, chartH, count, over) -> { inches, radius, custom, cpi }
XSRender.canRecordVideo() -> { ok, mime, reason }
XSRender.parseColor(hexOrRgbOrFabricName) -> [r, g, b] | null
XSRender.isSupported() -> boolean; XSRender.liveContexts() -> number
XSRender.MAX_LIVE, XSRender.NO_RANK, XSRender.FALLBACK_LABEL
```
`replayOrder` rules: the last occurrence of a cell in `order` wins; cells no longer done are
dropped (undone later); done cells missing from `order` are "before the log" and show from the first
frame (`before` counts them), so the last frame equals the live bitmap bit for bit (asserted). No
order, or none of its cells still done → `fallbackOrder`, `fallback:true`,
`label: 'Not your real order: shown colour by colour, row by row'`. Never a made-up history
without that label.

## Time-lapse (X3)
```js
var tl = XSRender.timelapse(handle, { order /* or null */, durationMs: 10000, onTick(f), onEnd() });
// creating it shows frame 0 at once (empty cloth); pass ghost:0 via setOptions for a bare start
tl.play(); tl.pause(); tl.seek(0..1); tl.playing; tl.position; tl.fallback; tl.label; tl.count; tl.before;
tl.exportFrame() -> Promise<Blob>        // PNG of the current frame
tl.recordVideo({ durationMs: 6000, fps: 30 }) -> Promise<{ ok:true, blob, mime } | { ok:false, reason }>
tl.destroy()                             // back to live progress
```
Order from xs-core's log: `XSRender.orderFromMarkLog(data.markLog, w*h)`. The replay is a uniform
compared with the rank stored per cell, so seeking is instant at any chart size; backstitch and knots
appear over the last 4%. Video: `canvas.captureStream` + `MediaRecorder` only (MP4/H.264 in Chrome
here, else WebM); it records the handle's own canvas at its size. Unsupported or an empty result →
`{ ok:false, reason }` in plain words ("Saving a video is not supported on this device." / "The video
came out empty on this device. Save a picture instead."), never an empty file.

## Share picture (X4)
```js
XSRender.picture(modelOrXSData, { size: 2048, frame: 'hoop'|'frame'|'none', background: 'transparent'|'#rrggbb', ghost: 0 })
  -> Promise<HTMLCanvasElement>   // square 2D canvas, the piece framed and fitted; size clamped 64..4096
// shell hook (docs/wave-k/api/shell-ui.md §3):
def.sharePicture = function (p, o) { return XSRender.picture(p.craftData, { size: o.size, frame: 'hoop' }); };
```
One shared off-screen GL context, reused between calls (a picture is ~1–5 ms after the first).

## CSS hooks
None. The canvas is the host's; the renderer reads only the theme variables above.
