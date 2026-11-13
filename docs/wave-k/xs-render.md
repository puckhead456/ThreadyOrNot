# Wave K — xs-render (X1 stitched fabric, X2 loupe, X3 time-lapse, X4 framed picture, X5 backstitch / knots)

Status: DONE for batch 1 (renderer, loupe, time-lapse, share picture, backstitch / knots drawn).
Mounting it in the app is the batch-2 xs-app worker's job; the contract is
`docs/wave-k/api/xs-render.md` (exact, with a wiring recipe for the tap button).

## Files (all new, all mine)
- `js/xstitch-render.js` — `window.XSRender` (2,700 lines, ES5 IIFE, no dependency).
- `test/xstitch-render.test.html` — assertions + GPU probes + budgets + a live gallery.
- `docs/wave-k/api/xs-render.md` — the contract. This report.

## Suites
Baseline: none (every file is new), 0 / 0.
Now: `bash tools/headless-suite.sh xstitch-render.test` → **61 passed, 0 failed** (GPU disabled;
the video check skips there). With the GPU (headless Chrome, ANGLE D3D11) → **62 passed, 0 failed**.
In a real pane tab → 60 / 60 before the last two assertions were added (the pane was closed under me
once and is now look-only, so the final count is from headless). No other suite can reach these files.

## What the user will see (once xs-app mounts it)
- **The tap button (X2)**: on a big chart, the 10 × 10 block being stitched plus a two-stitch margin
  at about 12 CSS px a stitch, the block outlined in the theme's primary colour and the rest a touch
  dimmer, the next stitch marked with a square that breathes for 2.4 s after each tap, the newest
  stitch drawn leg by leg (bottom `/`, then top `\`) in 150 ms, a corner thumbnail of the whole piece
  with a "you are here" box, and optionally the chart symbol printed under unstitched squares.
  Small charts (that fit at ≥ 5 CSS px a stitch) show the whole piece instead (`buttonView`).
- **The piece itself (X1)**: aida (holes at every corner, basket-weave bundles that turn a quarter
  from block to block), evenweave and linen (single threads over and under; linen slubs), in the
  fabric's colour. Each done square is a two-leg cross in its floss colour: the top leg always `\`,
  strands as plies with a twist stripe and a crease between them, a Kajiya–Kay sheen under a fixed
  light from the top left (metallic E-codes shinier), thread pinched into the holes, the top leg
  shading the bottom one, a soft drop shadow on the cloth, and per-stitch jitter seeded by the holes
  so neighbours share their hole. Unstitched squares show a faint printed tint (or bare cloth).
  Fractionals as three-quarter + quarter stitches; half stitches as one leg; blends ply by ply.
- **Backstitch and knots (X5)**: raised thread with the bsStrands width and a shadow; knots as
  wrapped balls, beads as glossy beads with a hole; undone ones as a thin printed line / ring.
- **Zoomed out**: thread detail fades out between 9 and 3.5 device px a stitch into a mipmapped
  colour image of the piece, so a 500 × 500 chart is one calm picture (measured: a third-of-a-pixel
  pan changes pixels by 0.25 / 255 on average at 0.8 px a stitch).
- **Whole piece / framed (X4)**: a wooden hoop at the real standard size for the design at its count
  (60 × 48 on 14 count → 7 in) with a brass clasp, or a mat and moulding frame, with a drop shadow;
  `XSRender.picture()` gives the shell's share card a square framed PNG-ready canvas.
- **Watch it grow (X3)**: replays the mark order (or, labelled "Not your real order: shown colour by
  colour, row by row", a fallback), each stitch drawing in as the front passes; pausable, scrubbable,
  instant seeking at any size; save a frame as PNG; save a video where the browser can record a
  canvas (MP4 in Chrome here), else a plain "not supported on this device".
- **Viewer sheet**: pinch, wheel, drag with inertia, double-tap to fit; tap reports the cell.
- **No WebGL**: flat stitched tiles, weave, backstitch and knots in Canvas 2D, with the message
  "Showing a simple stitched view: this device has no 3D graphics."

## How it works (one paragraph)
The chart is a w × h RGBA8 texture: palette index (12 bits), done, part and empty flags, and a 16-bit
mark rank. A palette texture (n × 2) holds sRGB, strands, blend partner, sheen and kind; fractionals
a second w × h texture only when the chart has any; symbols an atlas drawn with `fillText`. One
full-screen fragment pass computes the cloth and the stitch for the pixel's own cell (no neighbour
lookups), so the cost is per pixel, not per stitch. A second GPU pass renders one texel per stitch
into a power-of-two texture that is mipmapped for the far zoom; it reruns only when progress, the
palette or the time-lapse position changes. A tap writes one byte in the CPU mirror and sub-uploads
the row; bulk marks upload the rows they touched. The time-lapse is a uniform compared against the
rank. Backstitch / knots are quads expanded in a vertex shader (6 vertices each).

## Measured (this machine: Windows 11, desktop NVIDIA GPU, Chrome; **phone numbers are unmeasured**)
| what | result |
|---|---|
| 250,000 stitches, 1000 × 1000 px, full thread detail (14 px a stitch) | **0.35–0.46 ms a frame** GPU-synced, p95 0.5–0.8 ms |
| same, blend tier (5 px) / fit (colour tier) | 0.35–0.55 ms / 0.33–0.55 ms |
| texture memory at 250k | **3.27 MB** (cells 0.95, colour image + mips 1.33, symbol atlas 1.0, palette) |
| mount with a 250k model, warm shader cache | **22–26 ms** (pack + upload + compile start) |
| `setModel` 250k (Pokémon TL, in the pane) | 4.7–12.7 ms |
| first mount on a page: the renderer's own work | **2–4 ms**; the browser's WebGL context creation 80–320 ms and the page's first style/layout 180–340 ms are on top and not the renderer's |
| cold first frame (fresh profile, no shader cache) | **~2 s**, compiled off the main thread (`KHR_parallel_shader_compile`); before that change the compile blocked the main thread for 1.4 s in the pane. Warm: ~35 ms |
| one tap at 250k (CPU) | median **< 0.1 ms** (timer resolution), max 0.1 ms |
| 21,000 marks at once / `setProgress` 250k | 2.4–3.3 ms / 2.9 ms CPU; the next frame (colour image + mips) 2.4–2.6 ms GPU-synced |
| share picture 720 px | 1–5 ms each after the first (282 ms for the first, which compiles) |
| Pokémon TL read through `extractGrid` and rendered | 500 × 500, 105 colours, read in 15.8 s (the reader's time, not mine); it reads as stitched work at 7 px a stitch |

## Verified, and where
- Headless Chrome with GPU, screenshots read back: sampler at 40 / 12 px a stitch; 500 × 500 fit in a
  375 × 812 canvas on **Stardrop Night** (calm, no shimmer); sampler in a hoop at 375 × 812 on **Pixel
  Wyrm**; the loupe with symbols on Stardrop Night; the default light theme for the gallery (8 share
  pictures: hoop / frame / none, white / antique white / ecru / navy / light blue / black / khaki,
  aida 14–18, linen and evenweave 28 over 2); linen and navy evenweave close up with backstitch,
  knots and beads; a time-lapse mid-frame.
- Pane (one tab, closed after): the real Pokémon TL chart at 7 px a stitch, cold vs warm compile,
  and a real 60 KB MP4 recorded by `recordVideo`.
- Context loss and restore (`WEBGL_lose_context`): reported, textures rebuilt from the CPU copies,
  drawn again. Canvas 2D fallback: draws and reports in plain words.

## Left, and why
- **Phone GPUs: unmeasured.** The per-pixel shader is ~2 legs × 2 capsule evaluations + shadow +
  weave; the desktop has a big margin, a mid phone (Adreno 610 class) is unknown. `benchmark()` and
  the readout on the test page make the measurement one tap away (owner ask 5 in brainstorm 04).
  If it is slow, the cheap levers are: render at DPR 1 while panning, drop the drop-shadow pair of
  capsules below 14 px a stitch.
- **Cold first compile ~2 s** on a first visit (blank canvas until then). Mitigation for xs-app: mount
  the button renderer when the project opens, keep the old flat preview until `compiling` is false.
- **Sheen not tuned against a real photo** (owner fixture ask 3b in brainstorm 04).
- Time-lapse "session by session, with dates": I replay order only; dates need xs-core's mark log
  frames (`t`) and are a caption the app can draw from `onTick`.
- Outside the hoop the cloth is not drawn (transparent + shadow); the brainstorm's "dimmed, crinkled
  fabric outside the hoop" is not done.
- `orderFromMarkLog` is written against xs-core §11 (`replay(log, n).next() → { t, frame, bits }`)
  but not exercised against a real log (it did not exist when I built this; it returns null without one).
- Video records the handle's own canvas at its size; a bigger video needs a bigger canvas.

## For the owner of `index.html` / `sw.js` (shell-ui)
Please add `<script src="js/xstitch-render.js"></script>` after `js/xstitch.js` and the same path to
`PRECACHE_URLS`. (`test/sw.test.html` will require both together.)

## For the owner of `js/app-xstitch.js` (xs-app, batch 2)
Everything is in the API file, including the tap-button recipe. Pass `view.bits.bytes` (and the three
layer bitmaps) as `done`: the renderer adopts them by reference. Call `setTheme()` after a theme
switch. Use `XSRender.picture(p.craftData, { size, frame: 'hoop' })` for `def.sharePicture`.

## For the owner of `js/xstitch.js` (xs-core)
Confirm the mark log replay frames carry `bits` (Uint8Array or base64) so `orderFromMarkLog` can
diff them; if they carry the cell list per frame instead, a `XStitch.markLog.order(log)` returning
cell indices oldest-first would be simpler, and I will read it first.

## Decisions for the coordinator
- `MAX_LIVE` is 4 in my own registry (button + viewer + picture + spare), separate from `Diagram`'s
  3: crochet and cross-stitch never share a screen, so they never add up in practice.
- The time-lapse with no recorded order shows the labelled colour-by-colour fallback rather than
  refusing. The brainstorm's "do not build a fake time-lapse" is honoured by the label being part of
  the result (`fallback`, `label`); the app must show it. If you would rather refuse, the app can
  check `tl.fallback` and not offer the button.
