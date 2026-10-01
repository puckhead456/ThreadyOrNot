# Wave E — 3d-renderer (`js/diagram.js`)

Owner of `js/diagram.js` (WebGL renderer, v1.3.0) and of the `// renderer` block in
`test/diagram.test.html`. Goal: the piece reads as real crochet, not a smooth bumpy vase
(HANDOFF residual "Stitch texture is bumps, not V's", 07 D9, 02 #22).

## What changed

### 1. Stitch relief is geometry again, built from the stitch record

Before: one cosine bump per stitch (5 × 3 vertices), and a V + bar painted in the fragment
shader off a band-local uv. Every stitch type looked the same except for a bump height; a
post stitch, a BLO ridge, a puff and a chain space had no shape of their own.

Now each stitch is a **height field over its own cell** — `u` across the stitch, `s` from its
**base** (the round/row it is worked into) to its **top loops** — displaced along the smooth
surface's normal (`relief(u, s, D)`, descriptor from `descOf(stitchRecord, roundHeight,
holeOK)`):

| record | relief |
|---|---|
| `sc`, `x`, `dec`, and the top of every taller stitch | **the V**: two plump legs (a round yarn cross-section, `yarnP`) meeting at a point at the base and opening toward the top, with a shallow body between them; **the braid of top loops** as a horizontal bar at `s ≈ 0.9` — the bar between rounds |
| `hdc` / `dc` / `tr` / `dtr` (from the record's own `h`) | the V occupies one sc of height at the top (`vf = 1/h`: hdc 0.74, dc 0.50, tr 0.37); below it a **vertical post** with open ground beside it, and **one diagonal yarn-over wrap per extra turn** (hdc 0, dc 1, tr 2, dtr 3) |
| `inc` / `inc+` | the two V's of one increase **lean into their shared base** |
| `post: 'front'` (or `t` `fpdc`…) | the whole column stands proud (+0.3 SW at the full ceiling) |
| `post: 'back'` (or `t` `bpdc`…) | the column sinks (−0.2 SW): the basketweave checkerboard of 01 §4.3 |
| `lp: 'blo'` (or `loop: 'back'`) | the unworked front loop of the round below stands as a **ridge at the base** |
| `lp: 'flo'` (or `loop: 'front'`) | the base is pulled in |
| `bbl` / bobble / popcorn / cluster | a **welt** 1.9× a plain stitch |
| `puff` | a welt 1.65× with its loops showing as vertical ribs |
| `sl` | nearly flat (0.4×) |
| `ch` in a round ≥ 1.3 sc tall that also has real stitches (granny, lace, mesh) | **an open hole**: the chain hangs as a beaded strand at the top of the space and everything below it is open |
| `ch` anywhere else (an sc round's `ch 1`, a foundation chain) | a beaded strand across the middle, no hole |

Rules that make this safe:

- **Every term is exactly zero on all four edges of the cell** (a window times the terms), so
  stitches of any kind, count and phase meet their neighbours and the rings above and below
  **watertight**. The old bump dipped each slice edge inward by its *own* jittered amplitude,
  so neighbouring slices disagreed and hairline cracks were possible between every pair of
  stitches; the new builder has worst slice-to-slice gap ~1e-15 (asserted).
- A hole is made of **degenerate triangles**, not missing ones: every slice keeps the same
  index count, so the `done`-slice draw range, the over-count wedge and the stitch animation
  are untouched. Thick rows-mode fabric drops the back face and the walls under the hole too.
- The shading normal is the **true normal of the displaced grid** (the stamp's slopes are taken
  at the grid spacing), so what is lit is what is drawn at every LOD.
- Crevice AO is baked from the relief itself (`AO_CAV` 0.30 × how far below the stitch's peak
  a vertex sits): between the legs, beside a post and around a welt is where light does not
  reach. The lowest tier keeps the old slice-edge AO.
- Relief amplitude keeps a ring-relative ceiling in the spirit of 06 #6 (see §5 for the relief
  tiers' `max(0.12, 0.10·r)`), so a 6-stitch ring is still not a cog; the fit's radius margin now includes the round's own relief peak (a welt
  or front-post round stands further out than a V).
- Stamps (relief + slopes + cavity + hole flags on one grid) are cached per
  `(descriptor, tier, rows, direction)` — a round of 48 identical sc is one stamp.

**The V now points the right way in rows mode.** The band-local `v` used to run from the
band's top edge to its bottom in both modes. In rounds mode that is base→top (the piece grows
downward from the magic ring), but a row is worked **upward**, so every rows-mode V was upside
down and the colour-change seam sat at the wrong edge of the row. `uv.y` is now `s`, base→top,
in both modes (asserted).

### 2. Level of detail, honest about vertices

`LOD_TIERS` — picked from the projected stitch width (device px) of the **target** fit and the
zoom, with 15 % hysteresis so a pinch or the 200 ms fit ease never rebuilds back and forth:

| tier | grid per stitch (sc / dc / taller) | enters at | what it shows |
|---|---|---|---|
| low | 2 × 2 (the old single bump) + the painted shader V | 0 px | a bump; the fragment-shader V is kept **only** here |
| mid | 4 × 3 / 4 / 5 | 3.5 px | a coarse V (two lobes at u = .25/.75), posts, holes |
| high | 6 × 5 / 7 / 8 | 9 px | V, post, wraps, bar, BLO ridge, welts, holes |
| full | 8 × 7 / 10 / 12 | 16 px | the same, rounder |

- **Caps per purpose** (`LOD_MAX`): the viewer may use `full`; the stitch button and the
  gallery cards stop at `high`.
- **Vertex budget per purpose** (`LOD_BUDGET`: viewer 160k, button 70k, gallery 60k): a piece
  that would exceed it drops a tier. 60 × 60 in the viewer → `high` (151k verts); in the button
  → `low` (32k); a 400-round × 160 window → `low` at 576k verts, **down from 960k** at the old
  fixed 15 vertices per stitch.
- `render()` re-checks the tier every frame (cheap) and rebuilds only when it changes;
  `getStats().lod` reports `{ tier, name, segs, rows, px, switches, budget }` and
  `getStats().holes` the number of chain-space slices opened.

### 3. Yarn look

- Sheen: broad lobe `pow(nh, 6)·0.10` (was `pow(nh,7)·0.13`), tight lobe 0.008 (was 0.022),
  tinted 65 % toward the yarn (was 50 %). With real relief every lobe of every V catches the
  key on its own, so the old amounts turned a saturated yarn into moulded plastic (06, bee
  "hard specular — reads as moulded plastic", "per-stitch speculars … read as wet scales").
- Ply: at `high`/`full` and ≥ ~12 device px per stitch, a ±4.5 % chevron striation follows
  the legs of the V (`uPly`), the twist of a plied yarn. Fades out below that.
- The inter-round crease stays in the shader at every tier (at 45 % strength where the geometry
  already carries a crease); the colour-change seam (`uSeam`) is unchanged, and now sits at the
  base of the round/row in both modes.
- Colour is per stitch: every vertex of a stitch carries that stitch's yarn, so colour work is
  crisp at stitch boundaries (asserted with alternating red/blue stitches).

### 4. The over-count wedge no longer paints finished pieces

Found in the gallery: the finished panda Body showed an orange patch in its gathered close (so
did the Persian Tiles square's outer round, in the old renderer). The model's `deviation`
describes the part's *working* round (row 1, expected 6), while a finished model draws its
last round as `current` (18 stitches), so 2/3 of that round was painted `palette.alert`. The
wedge now follows the marker's rule: **never on a finished piece**, and **not when
`deviation.row` names a different row** than the round `current` draws. Pure helper
`wedgeFrom(model, current, finished)`; `getStats().alert.wedgeFrom` reports the slice it
started at on the last frame (−1 = none).

### 5. One slice per ring position; a relief floor on small rings; h = 0 records

- **Slices follow positions, not the count.** `prepRound` used `n = min(count, 160)`. A lace
  or granny round carries more records than its count (every chain of a ch-3 space is a
  position: Persian Tiles round 5 has 20 counted stitches and 80 positions), so it drew 20
  smeared quarter-stitches and sampled the chain spaces away. Now `n = min(max(count,
  records), 160)`; `done` still maps onto slices by proportion. On the Persian Tiles square this
  is what turned a "tatty" outer ring into distinct stitches between open spaces, and it keeps
  DiagramGeo 1.4.0's compressed fan round (48 widths on round 3) as 48 distinct narrow stitches
  rather than a smear.
- **Small rings.** 06 #6's ceiling `min(0.20, 0.06·r)` gave a 6-stitch tail 0.057 SW of relief,
  and with real V geometry that rendered as a smooth blob at viewer size. The relief tiers now
  use `min(BUMP, max(RELIEF_FLOOR 0.12, BUMP_R_RELIEF 0.10 · r))`: two lobes per stitch make the
  silhouette wave twice as fine, so 0.12 on r 0.95 (a 12-lobe, ≤ 13 % wave) reads as texture,
  not a cog. The `low` tier keeps the old ceiling. `getStats().bump` gains `relRelief`/`floor`
  and now reports the range at the tier actually built.
- **h = 0.** DiagramGeo 1.4.0 hands chains over with `h = 0`. The relief never divides by a
  chain's height (chains use their own profile); a stitch record's height is floored at 0.3
  before the wrap spacing is divided by it (asserted with an all-chain round of height 0).

Unchanged: working-round ring, over-count wedge on a working round, ghost alpha (0.20 /
0.72), tone mapping and the sRGB encode, flip-aware caps, contact shadow, context-loss
handling, the 2D fallback.

## Tests — `test/diagram.test.html`, `// renderer` block (end of `runUnits`)

Group **"Renderer — stitch relief and LOD (wave E)"**, 18 assertions, all pure (built on the
CPU through `Diagram._relief`, no GL context). The block sits between `// renderer` and
`// /renderer` markers just before `render()`:

1. every relief kind is zero on all four edges of its cell
2. an sc is a V (two lobes, a shallow valley, one point at the base)
3. tall stitches carry a post and a wrap per extra turn
4. front-post proud / back-post sunk
5. BLO ridge at the base / FLO base pulled in
6. bobble, puff welts vs a flat slip stitch
7. increase V's lean into their shared base
8. chain space in a tall round is an open hole (degenerate triangles, index count unchanged);
   not in an sc round; not at the lowest tier
9. a band of ten different stitch kinds meets its rings and its neighbours seamlessly
10. colour is per stitch (no bleed)
11. the V points at the round/row it is worked into in both modes
12. four tiers, 9 vertices per stitch at the bottom, 72 at the top
13. LOD follows the stitch size with hysteresis
14. the viewer alone gets `full`
15. the vertex budget holds (60 × 60, 400 × 160)
16. a 6-stitch round keeps visible stitches without turning into a cog (relief 0.12 SW, 12.6 %
    of r)
17. zero-height records never divide by zero
18. the over-count wedge is drawn on the working round, never on a finished piece or for a
    deviation naming another row

**Suite results at hand-off:** `test/diagram.test.html` **193 passed, 0 failed** (units, which
include the geometry agent's additions) and **230 passed, 0 failed** after "Reload reference
fixtures" (the 228 reference total + my 2 later assertions). `test/sw.test.html` 27 / 0 (sw.js precaches `js/diagram.js`). No other
suite loads `js/diagram.js`.

## Verification against the fixture photos

Method: `test/diagram.gallery.html` in my own tab, each card's finished model re-mounted
side by side at viewer size (390 × 560 CSS, `fitPurpose: 'viewer'`) under the **old**
renderer (a scratch copy of `HEAD`'s `js/diagram.js`, since deleted) and the **new** one, and
the PDF page rasterised at 1400–2400 px wide through the gallery's own `openDoc`/`rasterise`
and cropped to the photo. Button size checked in the app (375 × 812) and on the test page's
168 px button. PDF photos are small and several are plush/chenille yarns, so the comparison
is of stitch *read* and material, not fibre.

| fixture / part | photo | before (old renderer) | after (new) | defect → fix | assertion |
|---|---|---|---|---|---|
| test page sphere 6→48→6, 560 px | — | knobbly scalloped bands with a faint painted V; lower half a saw-toothed "scale" silhouette; satin highlights | rows of distinct **Λ-shaped stitches** (two plump legs, point toward the magic ring, dark crevice between them), a clean crease and top-loop bar between rounds; zoomed ×2.2 every stitch is a readable two-legged V with a faint ply | bumps → V relief; legs first rendered near-parallel ("columns of teeth") → widened to ~45° | #2, #9 |
| panda Body / Head | white head & upper body, black lower body, matte, small tight sc | bumpy cream-white egg, specular streaks, black half a blur of bumps; **orange blob in the gathered close** | white and black both show a regular grid of sc V's; the black keeps its relief; **no orange** | relief; wedge on a finished piece | #2, #16 |
| bee Body (large) | saturated yellow + two black bands, fuzzy matte yarn, no gloss | yellow drum with hard per-stitch specular (06: "moulded plastic"); black bands flat | yellow reads matte with V texture; black bands keep stitch relief; stripe edges crisp at the stitch | sheen lowered; per-stitch colour | #10 |
| snowman (whole body) | white plush snowman, two balls | two bumpy bulbs | two bulbs covered in rows of V's, waist crease clean | relief | #2 |
| redheart persian tiles, First Square | lace squares: solid centre medallion, open chain-space rings, dense outer round | a solid disc-square; the outer round painted orange (wedge) | an **openwork square**: first pass 39 holed slices but the outer rounds were sampled one record in four and looked tatty; after slicing per position, 100 holed slices, every stitch its own column, the fan round (48 widths, compressed by DiagramGeo 1.4.0) reads as distinct narrow stitches; sc rounds with chains stay closed; no orange | holes for chain spaces in tall rounds; slices per position | #8 |
| panda Tail (6,6,6), panda Ear, snowman Nose (4,4) | small black tail, flat ear, carrot | tail/nose a smooth cone; 06 #6's cog already fixed by the 0.06·r clamp | first pass: **smooth black blob** (relief 0.057); after the floor: faint lumpy stitch texture, no cog; ear shows V's with a lumpy, not toothed, rim | relief floor on small rings | #16 |
| any finished gallery card | — | — | `markerOn: false`, `finished: true`, `wedgeFrom: −1` on every card read: **no glow and no wedge on a finished piece** | (verified, 06 #5) | #18 |
| gallery with more live canvases than `MAX_LIVE` (3) | — | — | evicted cards report `status 'lost'`, `webgl false`, `running false`, `isLive() false` — honest at the API; the gallery shows a blank white card because it passes no `onStatus` and does not remount | host-side (see below) | — |
| stylecraft hood, Motif | granny squares with the classic diagonal **corner holes** | solid concentric square rings | granny square with **open corners** on the diagonals (42 holed slices) and tr posts with wraps between them | holes; tall-stitch posts | #3, #8 |
| synthetic basketweave (24 × 12 dc, 4-st FP/BP blocks) | (bernat basketweave: checkerboard relief) | flat identical bumps | visible **checkerboard**: front-post blocks stand out lighter, back-post blocks sink darker | FP/BP relief (needs the data, see below) | #4 |
| synthetic puff / BLO rows (cardigan's wheat stitch) | (cardigan: puff welts every 2 rows) | uniform bumps | alternating rows of **plump puff welts** and sc rows with a BLO ridge | welts; BLO ridge | #5, #6 |
| rows mode (any sheet) | — | the painted V pointed **up** the row (upside down), the colour seam at the row's top | V points at the row it is worked into; seam at the base | s = base→top in both modes | #11 |
| hobbii amarah shawl (144 rows × ≤147 hdc) | right triangle | 324,000 verts | budget drops it to the `low` tier, 194,400 verts; reads as before | vertex budget | #15 |
| app button, panda Body round 14 (375 × 812, DPR 2) | — | — | `mid` tier (5.6–7.9 px/stitch), stitch grid visible, black colour-change round crisp, ghost rings intact | LOD cap for the button | #13, #14 |
| app viewer, same piece | — | — | `full` tier, 38,880 verts / 47,312 tris, build 26 ms; rows of V's, black working round, ghost rings, drag rotates | — | — |

**Performance.** CPU build: sphere at `full` 7–14 ms, panda Body 14 ms, snowman at `high` 21 ms,
60 × 60 at `mid` in the viewer 16–18 ms (72,000 verts, 86,448 tris, 62 draws). A tap still
rebuilds nothing (per-band hash; the tier only moves when the stitch size crosses a tier with
15 % hysteresis). `submitMs` 0.20–0.21 ms. **`frameMs` could only be sampled in bursts**: the
Browser pane was hidden for most of the session, so `requestAnimationFrame` ran only while a
screenshot was being taken; in those bursts frame gaps were 6 ms (a 165 Hz desktop vsync) at
26k triangles and `frameMs` 7.0 (420 px button, `high`) / 12.1 (60 × 60 viewer, `mid`). Not
measured on a phone GPU; the per-purpose vertex budgets are there so it can be tuned from
there.

**Context loss.** Test page "Lose context": `status` lost → `restored`, `webgl` true, chunks
rebuilt at the right tier (18,144 verts, `high`). In the app's viewer, `loseContext()` on the
viewer canvas: the host remounted a fresh canvas which rendered `ok` at `full`.

**Rotation at 375 × 812.** Host-driven drag (`dragStart/dragMove/dragEnd`) in the app viewer
turned the piece (yaw −0.35 → 1.78) and it redrew correctly; smoothness could not be judged by
eye with the pane hidden (see Performance).

## What is still wrong, and why

- **Post and loop stitches have relief but no data.** `stitchTok` in `js/patterns.js` parses
  `fp`/`bp` into `post: 'front'|'back'` and then `cell()` drops it; BLO/FLO are stripped by
  `PREFIX_RE`; and `Store.diagramModel` copies only `{t, c, h, w}`. So the bernat basketweave,
  the premier throw (BLO hdc) and the cardigan's BLO rows render as plain dc/hdc/sc today. The
  renderer side is done and tested with synthetic records.
- **Colour work in motifs is the parser's.** Persian Tiles (red/cream) and the hood motif
  (teal/blue/white) come out all cream: no colour reaches the model for those sections.
- **The cardigan and the premier throw produced no usable rows** in the gallery during this
  session (parser in flux by other agents); the puff/BLO rows were verified on synthetic models.
- **LOD is per piece, not per view.** A 144-row shawl zoomed ×3 in the viewer stays on the
  `low` bump because the whole piece's vertex count decides; a view-dependent LOD (only the
  bands on screen at full detail) would be the next step.
- **Plush / chenille yarns** (bee, snowman photos) cannot be matched by a smooth-yarn material;
  out of scope.
- The lower hemisphere of a sphere seen from above shows the V's foreshortened into "scales";
  that is geometry seen at a grazing angle, not a shading defect.

## For the owner of `js/patterns.js`

`stitchTok` already returns `post: 'front'|'back'`; please carry it into every emitted cell
(`cell`, `emit`, `incRun`, `decCell`, `cloneList`, `paint`), and turn a `BLO`/`FLO`
(`back loop only`, `front loop only`, `Dc BLO`, "in back loop only of each st") prefix/suffix
into `lp: 'blo'|'flo'` on the cells of that group instead of stripping it. The renderer reads
`post` / `lp` (and, as aliases, a `t` of `fpdc`/`bpdc`… or `loop: 'back'|'front'` as a
**string** — the existing boolean `loop` on slack chains is ignored).

## For the owner of `js/store.js`

`Store.diagramModel` builds each stitch record as `{ t, c, h, w }`. Please pass `post` and
`lp` through when present (strings only). The renderer's hash already folds them in, so a
change rebuilds the band. Optionally add `row` to `deviation` (the row it measures): the
renderer then refuses to draw the over-count wedge on any other round.

## For the owner of `test/diagram.gallery.html`

"Silent context loss" is the gallery's, not the renderer's: an evicted or lost card's handle
reports `status: 'lost'` through `getStats()` and would through `onStatus`, but
`mountCard` passes no `onStatus` and never remounts, so the card stays a white rectangle. Pass
`onStatus` and, on `'lost'`, call `unmountCard(card)` (it already swaps in a fresh `<canvas>`
and a "scroll into view" placeholder) so the sweep remounts it. Two further suggestions: (1) a "viewer size" button per card that re-mounts it at
`fitPurpose: 'viewer'` so the `full` relief tier can be reviewed without a console; (2) the
gallery passes the part's `deviation` into a finished model, which is what made the wedge
appear; the renderer now ignores it, but the gallery could drop it.

## For the owner of `SPEC.md` (docs agent)

"Live 3D diagram" § Material / "Fabric texture lives in the fragment shader, not in the
geometry" is superseded: relief is geometry again (this file, §1–2), the painted V survives only
on the lowest tier, `uv.y` is base→top in both modes, and `getStats()` gains `lod`, `holes`
and `alert.wedgeFrom`. `Diagram._relief` is a test hook.
