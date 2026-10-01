# 3D brainstorm 02 — real-time rendering and material quality

Lens: a graphics engineer who has shipped a mobile 3D product. I read `SPEC.md` § "Live 3D
diagram" and all 1,911 lines of `js/diagram.js` (v1.1.0), then drove `test/diagram.test.html`
and the app itself in the Browser pane at 375×812 / DPR 2, with the canvas magnified
pixel-for-pixel (`transform: scale(2)` + `image-rendering: pixelated`, backing store left
alone) so I was judging real device pixels and not a resampled screenshot.

Test rig: Chrome/ANGLE on an RTX 3080, `gl.SAMPLES = 4` (the requested MSAA is honoured),
`OES_standard_derivatives`, `ANGLE_instanced_arrays`, `OES_element_index_uint`,
`EXT_disjoint_timer_query`, `EXT_sRGB` and `OES_vertex_array_object` all present. Desktop fps
numbers are meaningless for this question, so the budget below is derived from vertex, triangle
and fragment counts rather than from the frame timer.

---

## What it looks like today

**The engineering is sound and the code is unusually disciplined.** Linear-space lighting with
a proper sRGB decode on the CPU side, a real wrapped key/fill/rim rig, baked crevice AO,
deterministic per-stitch noise, a band-taper that genuinely does keep consecutive rounds
watertight in the common case, incremental chunk hashing so a stitch tap costs 0.2 ms, chunk
reuse across `setModel`, context-loss handling, a 2D fallback. Nothing here is sloppy. The
problems are *art-direction* problems dressed as constants, plus two structural choices
(geometry bumps, per-band baked vertex buffers) that cap how good it can get.

**What the surface actually reads as, per model:**

| Model | Stats I measured | What I saw |
|---|---|---|
| Sphere 6→48→6, round 10/42 | 16 chunks, 6,480 verts, 4,592 tris, 19 draws, build 0.9–1.1 ms | Vertical corduroy / woven straw. Every round starts at angle 0 so the bumps stack into perfect vertical columns; the eye reads ribs, not stitches. |
| Striped tube (purple/orange/blue) | 18 chunks, 6,120 verts, 4,592 tris, 19 draws, build 0.7 ms | A stack of separate tyres. The silhouette scallops in and out once per round. Colour changes are crisp and land exactly on the round boundary — good — but perfectly horizontal, because there is no spiral. |
| Bear head (belly panel) | 15 chunks, 6,210 verts, 4,032 tris, 21 draws | Panel edges are a clean vertical staircase, which is honest. The magic-ring cap is a flat navy disc with radial creases that does not belong to the rest of the surface. |
| Quadrants (12 sts/round) | 3,870 verts | A pinecone. At 12 stitches a bump of 0.20 SW is 21% of the ring radius. |
| Horn 6→24 (ZD5 fixture, stardew-spring viewer) | 3,690 verts | The clearest failure: a serrated saw-blade of triangular flaps, with hairline seams between bands near the tip. Reads as an artichoke, a drill bit, a dragon scale — anything but yarn. |
| Blanket, rows mode, 20/40 | 30 chunks, 36,000 verts, 5,040–57,648 tris, build 3.3–9.9 ms | **The best-looking thing in the renderer.** Turned 60° off face-on it convincingly reads as fabric: a regular grid of V-ish bumps, a real extruded edge, believable thickness. Spoiled by a sawtooth left/right edge and a circular contact shadow under a vertical sheet. |
| 60 × 60 (worst case) | 60 chunks, 54,000 verts, 57,648 tris, 62 draws, build 6.9–9.9 ms, submit 0.16 ms | Holds up fine; the alternating cream/navy stripes shimmer badly at button size. |

**At button size (168 px, magnified to real pixels):** the stitch detail collapses into
speckle. The sphere's 48 stitches are ~2.3 device px wide; the bump's specular and the crevice
AO alias into scattered dark dots that read as dirt on the yarn, not as texture. MSAA cleans
the silhouette (which is good) and does nothing for this, because it is shading aliasing, not
edge aliasing. At DPR 2 in the real app (682×475 backing behind a 341×238 button) it is much
better, but the corduroy reading remains.

**Lighting and colour.** There is no tone mapping. For the default cream `#f1e3c8`, the key
term alone reaches ~1.03 linear, and the sheen adds another ~0.23 — so the lit side clips and
desaturates to a flat `#fffde0`. Going the other way, the ZD5 horn's mid-dark red crushes to
near-black across half the surface (`0.17 + 0.94·wrap`, then up to 24% AO on top). Light yarns
blow out, dark yarns crush, and both lose hue. The two-lobe sheen is the right idea but with a
single per-stitch-invariant exponent it draws long continuous highlight *streaks* along the
scallop ridges that read as satin or brass, not wool. There is no halo, no fuzz, no fibre —
the single strongest "this is wool" cue is absent.

**Ghosts.** `App.diagramPalette()` passes `ghost: rgba(--text, 0.35)`, and the renderer then
multiplies by `GHOST_ALPHA = 0.20` / `PENDING_ALPHA = 0.72`. Future rounds therefore render at
**0.070 effective alpha** and the current round's pending grid at 0.252. In the real app I
could not see the horn's ghost rounds 12–15 at all against stardew-spring's `#448359`; the
same on the sphere against stardew-night and dragon-pixel. Whatever the spec intended, the
composed number is not it. They are also drawn as `gl.LINES` at the driver's clamped width of
1 *device* pixel, so they get thinner as DPR rises.

**Grounding, framing, motion.** The contact shadow is plain black at 0.38 over a
premultiplied `ONE / ONE_MINUS_SRC_ALPHA` blend, i.e. a pure multiply toward black; over a
saturated `--primary` it greys the hue out and reads as a smudge rather than a shadow. In rows
mode it is a 1.35× disc under a piece of fabric standing on edge. The viewer sheet is a flat
slab of `var(--primary)` — 375×612 of unbroken hot pink / green / purple behind the piece,
which is the single biggest reason no frame of this is screenshot-worthy. In the tap button
the auto-fit centres the model in the canvas, which is exactly where the "STITCHES" chip, the
huge number and the "TAP" hint live, so on a young project the piece is a wafer hidden behind
the caption. Auto-rotate feel is good and the drag direction is correct, but a flick's inertia
decays with a 0.25 s half-life while `ROT_PAUSE` is 1.5 s, so a throw ends in a dead stop
followed by 1.25 s of nothing before the spin resumes.

---

## Performance budget (suggested)

Nothing here is GPU-bound today; the cost is on the CPU and in the frame *cadence*.

- **Vertices:** 15 verts × 13 floats = **780 B per stitch** (1,560 B in rows mode). 60 × 60 =
  54,000 verts = **2.81 MB** of vertex data. Budget: ≤ 256 B/stitch (packed, or instanced).
- **Triangles:** 16/stitch, 57,648 at worst case. Fine — a mid phone eats 200k/frame. Keep
  the 160-slice cap; no change needed.
- **Draw calls:** 62 at worst (one per band + cap + shadow). Fine, but they are ordered
  top-to-bottom and `CULL_FACE` is off, so expect ~2× shaded overdraw on the solid. Acceptable
  on a tiler; don't add a depth prepass.
- **Fragments:** viewer at 375×612 / DPR 2 = 918k px; the piece covers ~35% → ~700k shader
  invocations/frame at ~55 ALU ops including **6 `pow()`**. ~2.3 GFLOP/s at 60 fps. A mid phone
  (Adreno 619 ≈ 400 GFLOPS) is not troubled. Budget: keep it under 10 `pow()`-equivalents.
- **CPU per completed round:** currently up to 4.2 ms of rebuild + 1.6 MB `bufferData` on a
  26-round pattern-less piece (measured, desktop; ×4–6 on a phone) — see #17. Budget: ≤ 2 ms
  and ≤ 64 KB of upload per round.
- **Frame rate:** budget **30 fps while only auto-rotating**, 60 fps for 500 ms after a tap or
  during a drag. At 12°/s the per-frame step at 30 fps is 0.4° — invisible, and it halves the
  GPU power draw on the screen users stare at for hours.
- `getStats().frameMs` (0.12–0.16 ms even at 57k triangles) times the JS submit loop only and
  never the GPU. The spec's "≤ 4 ms/frame" is currently unverifiable from it.

---

## Proposals, ranked by impact ÷ effort

### 1. Ghost alpha is multiplied twice, so future rounds are invisible in the app
**What I saw.** stardew-spring, ZD5 horn in the 3D viewer at Rnd 11 · 8/15: rounds 12–15 are
simply not on screen. Same on the sphere under stardew-night and dragon-pixel at button size.
The arithmetic: `App.diagramPalette()` returns `ghost: withAlpha(--text, 0.35)`, `setPalette`
stores that alpha in `state.ghostLin[3]`, and pass 2 multiplies it by `GHOST_ALPHA = 0.20` →
**0.070**. The test page, which passes an opaque `#ffffff`, looks fine — which is why this
never got caught.
**Proposal.** The renderer owns ghost alpha; the host supplies a colour. In `js/app.js`, drop
`withAlpha(..., 0.35)` and pass `ghost: cssVar('--text')` unchanged. Then, because `--text` on
a light theme is a dark brown sitting on a mid `--primary` (1.1:1 at any alpha), choose the
ghost colour by contrast instead of by variable: pick whichever of `--text` / `--primary-text`
has the greater WCAG contrast against `--primary`, and keep `GHOST_ALPHA` at 0.20 /
`PENDING_ALPHA` at 0.72. Add a line to the test page that prints the composed alpha so this
cannot regress.
**Effort** S · **Impact** 5
**Risks.** On dragon-pixel a white ghost at 0.20 over `#ff4d6d` may now be *too* loud behind
the number; check the tap button before the viewer.

### 2. Kill the per-round bulge — it is what makes the piece look like a pinecone
**What I saw.** The ZD5 horn and tail in the viewer: a serrated stack of triangular flaps, each
round overhanging the one below. `BULGE = 0.09` with
`BLG[t] = BULGE·SW·(1.35·sin(π·t) − 0.42)` puts the band's mid-height at **+0.084 SW** and both
its edges at **−0.038 SW** — a 0.12 SW radial swing at every single round boundary, on top of
the ±0.20 SW stitch bump. On a 6-stitch round (R = 0.955) that is a 13% radius modulation once
per 1.5 units of height. Real crochet has a *crease* between rounds, not a barrel per round.
**Proposal.** Make the inter-round groove asymmetric and much shallower: `BULGE` 0.09 → 0.03,
and replace the symmetric sine with a profile that is flat over the middle 60% of the band and
dips only in the last 20% at the top —
`BLG[t] = -BULGE·SW·smoothstep(0.80, 1.0, t)` (plus the matching derivative for the normal).
Rounds then read as a stack of fabric rows with a seam, and the silhouette becomes a smooth
solid with fine serration instead of a saw-blade.
**Effort** S (two `initProfiles` lines + one constant) · **Impact** 5
**Risks.** Removes some of the depth cue that currently separates rounds at button size;
compensate with #14 (ambient) and the existing `AO_BAND`. Re-check the striped tube — the
colour-change boundary relies on the groove being legible.

### 3. Tone map before the sRGB encode
**What I saw.** Default cream `#f1e3c8` (linear 0.878/0.766/0.577): key alone reaches
(1.03, 0.84, 0.56), sheen adds up to (0.23, 0.22, 0.19) — red clips, and the highlight lands
at ~`#fffde0`, a hue-less white blob. The other end: the ZD5 horn's red is near-black over the
lower half. Light yarns blow out, dark yarns crush, and a hard clamp to 1.0 destroys hue on
the way.
**Proposal.** One line before the gamma encode in `FRAG_SRC`:
`c = c * (1.0 + c / 0.64) / (1.0 + c);` (a Reinhard variant with a white point of 0.8, which
keeps mid-tones essentially unchanged and rolls the top off), then raise the key's constant
term from 0.17 to ~0.22 so dark yarns lift. Also switch the encode from `pow(c, 0.4545)` to
the real sRGB curve, or accept the mismatch knowingly — the decode uses the exact piecewise
formula, so today a mid grey does not round-trip.
**Effort** S · **Impact** 4
**Risks.** Everything gets slightly less contrasty; the six themes need a re-look, especially
dragon-throne where the dark red yarn currently reads dramatic.

### 4. Offset each round by half a stitch so the surface stops reading as corduroy
**What I saw.** Sphere and 60 × 60 at every size: the bumps line up in exact vertical columns,
because `buildRoundBand` starts every round's angular accumulator at 0. The eye reads
continuous ribs top-to-bottom, which is why the surface looks like woven straw or a ribbed
lampshade rather than crochet. Real stitches sit in the V of the round above.
**Proposal.** In `buildRoundBand`, rounds branch, start the accumulator at half a slice:
`var acc = (index & 1) ? TAU / (2 * n) : 0;` — one line. Better still, make it continuous
(see #7). Add `index` to the band hash so a rebuild picks it up (it already is: `hashNum(h, i & 1)`).
**Effort** S · **Impact** 4
**Risks.** None to geometry watertightness — the bump already tapers to zero at both band
edges, so a phase shift cannot open a crack. Re-check that the bear head's belly-panel
boundary still reads as a straight-ish edge; it will become a 1-stitch zigzag, which is what
real colour-blocked amigurumi looks like.

### 5. Cap the auto-rotate to 30 fps and stop when the document is hidden
**What I saw.** `needsFrame` returns `true` unconditionally whenever `!reducedMotion &&
t >= pauseUntil`, so the diagram redraws 60 times a second, forever, on the counter screen —
the screen a user leaves open for hours with the wake lock held. At `ROT_SPEED = 12°/s` the
per-frame delta is 0.2°. There is also no `document.hidden` guard; `schedule()` early-returns
on a non-zero `rafId`, so if a pending rAF is never delivered the loop cannot restart (I hit
exactly this in a hidden browser pane — `running: true`, `drawCalls: 0`, indefinitely).
**Proposal.** In `frame()`, when the only reason for the frame is auto-rotation (no drag, no
`anim`/`glowAnim`, no `fitT0`, `|spinVel| < 0.0005`), skip the render if
`t - lastRenderT < 32` and just re-schedule. 0.4°/frame at 30 fps is imperceptible at 12°/s.
Add a `visibilitychange` listener that cancels the rAF and clears `rafId` on hide and calls
`kick()` on show.
**Effort** S · **Impact** 4
**Risks.** The 60°/s edge-on flick in rows mode would strobe at 30 fps — keep full rate while
`spinSpeed(yaw) > 20°/s`.

### 6. Give the viewer a studio backdrop instead of a slab of `--primary`
**What I saw.** `.viewer-stage { background: var(--primary); }` — the 3D viewer is 375×612 of
unbroken flat colour with a cream ball floating in it. In dragon-pixel that is a field of
`#ff4d6d`. Nothing about it says "photograph of my work".
**Proposal.** Pure CSS on `.viewer-stage`, zero GPU cost: a vertical
`linear-gradient(color-mix(in srgb, var(--primary) 78%, white), var(--primary) 55%,
color-mix(in srgb, var(--primary) 82%, black))` plus a soft radial vignette, so the piece sits
in a lit sweep rather than on a colour swatch. Apply a weaker version inside the tap button.
Pairs with #14 so the piece's ambient picks up the backdrop.
**Effort** S · **Impact** 4
**Risks.** `color-mix` needs a fallback (the flat `--primary` it already has). Check the
"Yarn colours" and "Close" buttons still read against the darker bottom band.

### 7. Give continuous rounds their spiral
**What I saw.** The striped tube's colour changes are perfectly horizontal rings and the
quadrant model's colour boundary is a perfectly straight vertical line. Amigurumi worked in
continuous rounds has neither: it has a visible diagonal seam where each round steps up, and
colour changes jog by one stitch per round. Its absence is the strongest cue that this is a
solid of revolution and not fabric.
**Proposal.** Replace the half-stitch offset of #4 with a running spiral: carry an
accumulated start angle through `layoutRounds` (`startAngle[i] = startAngle[i-1] + TAU/count[i-1]`,
i.e. exactly one stitch per round) and pass it as `a0[0]` in `buildRoundBand`. Then darken the
first slice of every round by ~8% in the vertex colour so the seam is visible as a faint
diagonal. Only for `mode === 'rounds'`; joined rounds are a different animal and can stay flat
behind a `Model.joined` flag when someone adds it.
**Effort** S (once the layout carries one extra array) · **Impact** 4
**Risks.** The seam must not be mistaken for a crack — keep it a colour effect, never a
geometric gap. Rounds with very different counts step by different amounts, which is correct
but makes the seam wander; that is what real amigurumi looks like.

### 8. Tint the contact shadow and give rows mode the right footprint
**What I saw.** The shader emits `vec4(0, 0, 0, w·uAlpha)` under `ONE / ONE_MINUS_SRC_ALPHA`,
i.e. a pure multiply toward black. Over stardew-spring's `#448359` at 0.38 it turns the green
grey — it reads as a dirty smear under the ZD5 horn, not as shade. In rows mode the blanket, a
sheet standing on its edge, gets a 1.35× **disc** whose radius is half the row width; the
ellipse is wider than the piece and visibly detached from it.
**Proposal.** (a) Shadow colour: instead of black, use the palette's `bg` (which is already
plumbed through `setPalette` and today is **dead code** — never read) darkened 45% and slightly
hue-rotated, output non-premultiplied-to-black so saturated primaries stay saturated. (b) In
rows mode build the shadow as a stretched ellipse — full width in x, `THICK·SW·3` in z — and
drop `SHADOW_SPREAD` to 1.1. (c) Also honour the `ink` palette entry or delete it; it is dead
too.
**Effort** S · **Impact** 3
**Risks.** A tinted shadow on a light theme can look like a coloured stain; clamp its
saturation. Keep the existing pitch fade-out, which is correct and works well.

### 9. Break up the sheen so it stops reading as satin
**What I saw.** The ZD5 horn in the viewer: long, continuous, pale-olive highlight streaks
running along every scallop ridge — the look of brushed brass or silk, not wool. Cause:
`sheen = pow(nh, 7)·0.15 + pow(nh, 44)·0.045` uses the *same* exponent for every stitch, so the
lobe is perfectly coherent across a whole band, and `specTint = mix(vec3(1.0), vColor·1.6, 0.5)`
pushes it bright.
**Proposal.** `prepRound` already computes three noise values per stitch; spend a fourth on
roughness and carry it in the unused w slot of the colour attribute (widen `aColor` to `vec4`,
no change to `FLOATS` if you drop the anchor/offset split of #21, otherwise +1 float). In the
shader: `float e = 7.0 * mix(0.6, 1.6, vRough); sheen = pow(nh, e) * 0.13 + pow(nh, 44.0) * 0.02;`
Halving the tight lobe and jittering the broad one per stitch turns a continuous streak into a
scatter of individual fibre glints, which is what a wool ball looks like.
**Effort** S · **Impact** 3
**Risks.** Adds one varying (30 available, 3 used). Under-sampling at button size could make
the roughness jitter itself alias — clamp the variation by the LOD factor from #15.

### 10. Dither before the sRGB encode
**What I saw.** `precision mediump float` (fp16 on mobile) doing linear-space lighting, then a
gamma encode that stretches darks, with large smooth gradients from the cool fill lobe. On the
three dark themes this is a textbook banding setup; on desktop fp32 it hides.
**Proposal.** Three lines at the end of `FRAG_SRC`, after the gamma encode:
`float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);`
`c += (d - 0.5) / 255.0;` Costs one `sin`, removes every visible band.
**Effort** S · **Impact** 3
**Risks.** Adds per-pixel noise that could interact badly with the speckle of #15 — apply the
LOD fade first, then dither.

### 11. Build the magic-ring cap from the first round's own slices
**What I saw.** `buildCap` is a hard-coded 18-segment fan with a single flat colour, a
hand-written normal of `(ca·0.55, 0.83, sa·0.55)` and no bumps at all. On the bear head it is a
smooth navy disc with radial creases sitting on top of a knobbly surface; on the sphere it is
a small plastic nipple. It also does not match the first round's slice count (6, 8 or 12), so
the seam between cap and round 1 is arbitrary.
**Proposal.** Generate the cap in `buildRoundBand` as a degenerate band: same `n`, same `a0`/`aw`,
same `amp`/`col` as round 0, with `rBase = [0, rTop·0.6, rTop]` and a dome in `yBase`. It then
inherits the per-stitch colours, the bumps, the AO and the noise for free, and the magic ring
looks like six stitches pulled into a circle — which is what it is.
**Effort** S · **Impact** 3
**Risks.** A zero radius at the pole means a degenerate tangent; clamp `rBase[0]` to
`0.08·SW` and fan the normals to `+Y`.

### 12. Draw the ghost and pending wires as constant-width quads
**What I saw.** Both wire passes use `gl.drawElements(gl.LINES, ...)` and `gl.lineWidth` is
never set — Chrome and most mobile drivers clamp it to 1.0 *device* pixel. At DPR 2 in the app
that is 0.5 CSS px, at DPR 3 it is 0.33; the "Just started" model's ghost egg is a broken,
dashed hairline at button size. The pending grid — the one wire that is supposed to be the
brightest thing on screen, showing the stitches left in this round — suffers the same.
**Proposal.** Replace both index buffers with a thin camera-facing ribbon: 2 triangles per
segment, expanded in the vertex shader along `normalize(cross(segmentDir, viewDir))` by
`uLineWidth * vView.z / uProj[0][0]` so the width is constant in CSS pixels (1.25 px for
ghosts, 1.75 px for the pending grid). Costs 4× the index data for the wire passes only
(~8 KB per band), gets MSAA coverage, and makes the ghosts legible at every DPR.
**Effort** S–M · **Impact** 3
**Risks.** Needs the segment direction as a per-vertex attribute; simplest is a small dedicated
buffer per band rather than reusing the solid one.

### 13. Straighten the rows sheet's edges
**What I saw.** Blanket at 60° off face-on, magnified: the left and right edges are a clean
sawtooth, each row jutting out further or less far than its neighbour. `buildRoundBand`'s rows
branch shifts the start by `±0.25·SW` on alternate rows *and* sizes each row as `n·SW` with its
own per-stitch widths, so no two rows end at the same x. A blanket has a straight edge.
**Proposal.** Keep the half-stitch phase for the texture, but normalise the geometric extent:
compute the sheet's half-width once from `maxCount·SW/2` and scale each row's `sw` so its
stitches exactly fill `[-halfW, +halfW]`, with the phase applied inside that range rather than
outside it. Two lines.
**Effort** S · **Impact** 3
**Risks.** Rows with genuinely different stitch counts (a shaped garment piece) *should*
have different widths — only equalise when `count === maxCount`.

### 14. Add a hemispherical ambient tinted by the theme
**What I saw.** The rig is one key, one directional fill from below and a white-ish Fresnel
rim. There is no environment term, so the piece never picks up any colour from the very
saturated background it sits on and always looks pasted on. On dragon-pixel a cream ball on
`#ff4d6d` reads like a sticker.
**Proposal.** Three instructions in the fragment shader:
`c += vColor * mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5) * 0.12;` where `uSkyColor` is the
palette `bg` lightened 25% and `uGroundColor` is it darkened 40% (both already available from
`--primary` via the currently-dead `palette.bg`). The piece then sits *in* the button rather
than on it, and it partly recovers the depth separation that #2 removes.
**Effort** S · **Impact** 3
**Risks.** Over-tinting makes a cream yarn go pink on dragon-pixel; 0.12 is about the ceiling.
Users editing yarn hexes will notice if the rendered colour drifts too far from the swatch.

### 15. LOD: fade the geometric stitch detail out below ~4 device px per stitch
**What I saw.** The magnified 168 × 168 button capture: the sphere's 48 stitches at ~2.3 device
px each turn into scattered dark pixels. It is not noise from the per-stitch jitter — it is
the bump's specular and the crevice AO sampled below Nyquist. MSAA cannot fix it. This is the
single reason the button diagram reads as "grainy cream blob" rather than "my piece".
**Proposal.** In `rebuild`, compute the projected stitch size
`px = fit.scale · zoom · SW · (canvasH / (2·CAM_DIST·tan(FOV/2)))` and derive
`lod = smoothstep(2.0, 6.0, px)`. Scale `BUMP`, `DIP` and the AO strengths by `lod`, and when
`lod < 0.35` build with `SEGS = 2` instead of 4 (halving vertices too). The band grooves and
the per-stitch colour survive; the sub-pixel relief does not. Rebuild only when `lod` crosses a
bucket boundary, not every frame.
**Effort** M · **Impact** 5
**Risks.** `lod` depends on `fit.scale`, which eases over 200 ms — bucket it (say 4 levels) or
you rebuild the world during every fit animation. Must not fight the `'stitch'` animation,
which scales one slice from 0.

### 16. Fit the piece around the button's text, not into the canvas centre
**What I saw.** ZD2_Render at row 3 of the panda body: the piece is a handful of wafers sitting
across the top third of the tap button, with the "STITCHES" chip cutting straight through it
and the giant "4" below. `computeFit` centres the model's y range in the canvas; the canvas is
`inset: 0` on a button whose middle 60% is occupied by UI.
**Proposal.** Add `safeInsets: { top, bottom, left, right }` (CSS px) to `Diagram.mount`
options and to a new `handle.setSafeInsets()`. `computeFit` then fits into the reduced box and
offsets `cy` so the piece is centred in the free area. The app passes the measured heights of
`.stitch-caption` + `.stitch-number` + `.stitch-hint`. For the viewer, pass the sheet header
and the footer button row.
**Effort** M · **Impact** 4
**Risks.** On a tall piece there may be no free area; degrade gracefully to the current centre
fit rather than shrinking the piece to nothing. The insets change on every re-render of the
caption — debounce.

### 17. Build bands in band-local space so a relayout stops re-uploading the model
**What I saw.** Measured on a pattern-less piece (no ghost rounds, so `rMax` grows every
round): completing a round rebuilds and re-uploads **every** chunk, because `layoutRounds`
recomputes `phi = asin(R/rMax)` for all bands and the band hash includes `yTop`/`yBot`.
setModel cost 1.0 ms at 11 rounds → 2.2 ms at 20 → **4.2 ms at 26 rounds** (31,590 verts,
1.6 MB of `bufferData`), growing linearly with the piece, i.e. O(n²) over a project. On a
mid-range phone that is 15–25 ms plus the driver's upload stall, landing exactly on the frame
where the round-complete glow starts. Patterns with ghosts are safe only because `rMax` is
known up front.
**Proposal.** Emit each band's vertices relative to its own origin (y = 0 at `yTop`, radius
relative to `rTop`) and pass `(yTop, rTop, rBot − rTop)` as a per-draw uniform that the vertex
shader applies. Then `layoutRounds` moving every band in y touches no buffer at all — only
`prepRound`'s hash (counts, colours, stitch types) can force a rebuild. Bonus: `bandExtent`
and the fit get cheaper too.
**Effort** M · **Impact** 4
**Risks.** The vertical scallop (`dipScale`) and the normal's `dydt` term are computed in world
space today; both need the uniform. Watch the taper invariant that keeps rounds watertight —
it must hold after the uniform transform, which it does as long as the scale is uniform in y.

### 18. Give the yarn a halo
**What I saw.** Nothing in any frame says "fibre". The Fresnel rim at 0.30 is white-ish
(`mix(white, glow, 0.35)`) and hard-edged, which reads as a plastic highlight on a plastic
egg. Real yarn has a soft halo of stray fibres that lifts the silhouette off the background —
it is the single most recognisable wool cue and the cheapest thing on this list to fake.
**Proposal.** Two options, in order of preference. (a) In-shader: add
`c += vColor * pow(1.0 - nv, 1.6) * 0.22` *before* the existing rim, i.e. a broad Fresnel in
the **yarn's own** colour, and reduce the white rim from 0.30 to 0.18. Free. (b) A shell pass:
re-draw each solid band scaled 1.5% along the normal with `depthMask(false)`, alpha
`pow(1-|N·V|, 2) · 0.35`, yarn-coloured — one extra draw per band, softens the silhouette into
a genuine fuzz. Do (a) first and measure whether (b) is worth 60 more draw calls.
**Effort** M (S for option (a)) · **Impact** 4
**Risks.** Option (b) doubles draw calls; gate it on the viewer only, never the button. Option
(a) will slightly desaturate light yarns against dark themes — check dragon-pixel.

### 19. The viewer renders its first frame at 300 × 150
**What I saw.** Reading `.viewer-canvas` immediately after the 3D view sheet opens gives
`width/height = 300 × 150` (the HTML default) inside a 373 × 612 CSS box — the first frame is
a 300 × 150 image stretched 2.5×, until `ResizeObserver` fires. There is a visible soft pop as
the sheet settles.
**Proposal.** In `mount`, `resize()` is already called synchronously — but the app appends the
canvas and mounts before layout has settled, so `getBoundingClientRect()` returns 0 and
`resize()` bails on `cssW <= 0`. Call `handle.resize()` once more from the app in a
`requestAnimationFrame` right after the sheet's open transition starts, or give
`.viewer-canvas` explicit `width`/`height` attributes matching the stage.
**Effort** S · **Impact** 2
**Risks.** None.

### 20. `getStats()` needs a real GPU number
**What I saw.** `frameMs` reads 0.12–0.16 ms whether the scene is 3,690 or 54,000 vertices,
because it times `render()`'s JS — the `drawElements` submissions — and never waits on the
GPU. Every performance claim about this renderer, including the spec's "≤ 4 ms/frame", is
currently unmeasurable from the API the spec provides for measuring it. `fps` is also
meaningless whenever the compositor throttles rAF (I saw `running: true`, `drawCalls: 0`
indefinitely in a hidden pane).
**Proposal.** `EXT_disjoint_timer_query` (`EXT_disjoint_timer_query_webgl2` on 2) is available
on this rig; wrap the frame in a query and report a rolling `gpuMs`, `null` where the extension
is absent. Rename `frameMs` to `submitMs` so nobody reads it as frame time again. Add
`dpr`, `canvasPx` and `lod` to the stats object while you are there — all three are things a
reviewer wants and cannot get.
**Effort** S · **Impact** 2
**Risks.** Timer queries are asynchronous and disjoint-prone; report the last completed query,
never block.

### 21. The open bottom never reads as open
**What I saw.** Dragged the striped tube to `pitch = −0.75` (looking up from below, under
dragon-fury): the tube's open end is an undifferentiated dark blob. The `inside` ramp darkens
the wrong side to 42% and correctly kills the rim, which is right as far as it goes, but there
is no *geometric* evidence of an opening — no wall thickness, no lip, no visible transition
from outside to inside. It reads as a closed, dented solid.
**Proposal.** Give the last round of a rounds-mode piece the same `thick` extrusion the rows
sheet already gets (`THICK · SW`), so the open edge has a real wall with its own darker
inside colour, exactly as `buildBand` already does for rows. One extra flag on the last band's
`buildRoundBand` call. Optionally extrude a couple of rounds up from the bottom so the inside
is visible in depth.
**Effort** M · **Impact** 3
**Risks.** `bandExtent` needs the extra `THICK·SW` for the last band or the fit will clip it.
If the piece is later closed (a finished sphere), the flag must move to the new last round —
it is derived from the model each rebuild, so that is automatic.

### 22. Replace geometry bumps with a procedural stitch normal in the fragment shader
**What I saw.** Everything above about the surface — the corduroy, the sub-pixel speckle, the
780 bytes per stitch, the 5-column × 3-row cage that forces `SEGS = 4` — traces back to the
same decision: the stitch is carved into the mesh. And what it carves is a *cosine ridge*, a
vertical rib. A crochet stitch is a **V with a horizontal bar across its top**, not a rib;
geometry at 4 segments per stitch physically cannot express that shape.
**Proposal.** Keep the mesh as a smooth low-poly solid (drop to `SEGS = 1–2`, no bump, no dip
— ~4× fewer vertices) and interpolate a per-band `vec2 vUV` (u = position within the stitch,
v = position within the band). In the fragment shader, build the stitch normal analytically:
two mirrored diagonal legs forming the V, a horizontal top bar, and a groove at `v ≈ 0`, all
from `fract()` and `smoothstep()`. Fade the whole perturbation with
`fwidth(vUV)` (`OES_standard_derivatives` is available) so it *filters itself* at button size
instead of aliasing. Gains: a true V shape, a plied-yarn twist for free (a second higher-
frequency diagonal band along each leg), a clean silhouette, no rebuild cost when the layout
shifts, and a per-stitch look that finally reads as crochet. This is the proposal that makes
the surface right; #2, #4, #7, #9 and #15 are all mitigations of not having done it.
**Effort** L · **Impact** 5
**Risks.** The biggest single change in the file and it touches the fit, the animation
(`uAnimSlice` currently keys off a per-vertex slice id — it would move to a uv test) and the
2D fallback. The silhouette loses the knobbly outline entirely, which some people will read as
*less* crocheted; keep a much-reduced geometric bump (0.05 SW) purely for the edge. Prototype
it on the test page behind a toggle before committing.

### 23. Instance the stitches
**What I saw.** 780 B/stitch, 1,560 B in rows mode; 2.81 MB of vertex data for 60 × 60. Half
of that is the `aAnchor` + `aOffset` split, which exists solely so one slice per frame can
scale in over 140 ms. `ANGLE_instanced_arrays` is available.
**Proposal.** One 15-vertex (or, after #22, 4-vertex) stitch mesh, drawn instanced per band,
with per-instance attributes `(startAngle, angularWidth, rTop, rBot, yTop, yBot, amp, colour)`
— about 32 bytes per stitch, an **~25× reduction**. A round completion then updates one small
attribute buffer instead of re-uploading megabytes, and the anchor/offset pair collapses into
a single uniform pivot plus a per-vertex weight. Combines naturally with #17.
**Effort** L · **Impact** 4
**Risks.** Needs a no-extension fallback path (the extension is near-universal but the 2D
fallback already exists for the rest). Per-instance colour means the colour-change boundary is
per-stitch, which is what it already is.

### 24. Do **not** ship a texture atlas of real stitch photos
**What I saw.** It was on the brief as a possible fallback, so here is the argument against.
A photo atlas cannot follow the per-stitch yarn colour (every project sets its own hexes, and
the whole point of `yarnColors` is that they are live), cannot widen an `inc` or narrow a
`dec`, cannot show a partially worked round, and cannot be lit consistently with the rest of
the scene without a normal map anyway — at which point the normal map is the deliverable and
the photo is dead weight. It also adds licensing surface and 200–600 KB to a PWA that
currently ships no binary assets at all.
**Proposal.** Spend the effort on #22 instead. If a photographic reference is wanted, use it
as the *target* when tuning the procedural shader, and ship a side-by-side in the test page.
**Effort** L (avoided) · **Impact** 1
**Risks.** None — this is a recommendation not to build something.

### 25. A flick dies 1.25 s before the auto-rotate picks it up
**What I saw.** `spinVel *= Math.pow(0.06, dt)` is a 0.25 s half-life, but `dragFinish` sets
`pauseUntil = now() + ROT_PAUSE (1500)`. So a throw decelerates to a full stop in about a
quarter of a second and then the piece sits perfectly still for over a second before the 12°/s
auto-rotate resumes. It reads as the app having lost the gesture.
**Proposal.** Decay the flick far more slowly (half-life ~1.1 s, `Math.pow(0.53, dt)`) and end
the pause when `|spinVel|` drops to the auto-rotate speed rather than on a fixed timer —
blend `spinVel` into `ROT_SPEED` instead of stopping and restarting. The `ROT_PAUSE` timer
stays as-is for `setModel` (seeing the new stitch is the point there).
**Effort** S · **Impact** 2
**Risks.** A long-lived flick delays the pitch return, which eases home only after the pause;
run the pitch return on its own timer.

---

## What "screenshot-worthy" would need

Ranked, and mostly already above: a **real stitch shape** (#22), a **backdrop that is not a
colour swatch** (#6) with a **grounded, tinted shadow** (#8), **tone-mapped** colour that keeps
its hue at both ends (#3), a **halo** on the silhouette (#18), and the **spiral seam** that
tells a crocheter this is their piece and not a lathe-turned solid (#7). Then one feature not
on the list: a **"save an image" button** in the viewer that renders one frame at 2× the
canvas size with `preserveDrawingBuffer`, the auto-rotate parked at a flattering
three-quarter yaw, the backdrop composited in, and the project + part name set small in a
corner. That is an hour of work on top of the above and it is the thing people actually post.
