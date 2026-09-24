# 01 — Geometry truth: what stitch sequences actually make

Lens: the crochet geometry expert. This file is the **reference set** the other four
3D brainstorms key off. It answers one question: given a count sequence, what shape
does real fabric take, and what numbers can the renderer be measured against?

Everything below was derived from the fixture PDFs in `tmp-pdf/` (text via
`pdftotext -layout`, structure via `Patterns.expand` run in the browser against
`http://localhost:8766/test/patterns.fixtures.html`), and cross-checked against the
finished-size statements printed in the patterns themselves.

Code read: `SPEC.md` § "Live 3D diagram", `js/store.js buildDiagramModel` (~3355),
`js/diagram.js layoutRounds`/`layoutRows` (~445–490) and its tuning block (~57–130),
`js/patterns.js expand`/`stitchTok`/`dominantHeight` (~2620–3040).

---

## Part 1 — The physics

### 1.1 The one equation that matters

A round of crochet is a band of fabric of **slant length** `h` (the stitch height)
wrapped around the piece. Going from ring radius `r₀` to ring radius `r₁`, the band
has to cover `Δr = r₁ − r₀` horizontally, and the fabric is not stretchy, so:

```
Δr² + Δy² = h²          →      Δy = h · sqrt(1 − (Δr/h)²)
```

Circumference is fixed by the stitch count: `r = n·w / 2π`, so `Δr = Δn·w / 2π`.
Substituting gives the whole of crochet shaping in one line:

```
N_flat = 2π · h / w                         (stitches added per round to stay flat)
Δy     = h · sqrt(1 − (Δn / N_flat)²)       (vertical rise of the round)
```

Read off the three regimes:

| Δn vs N_flat | Δy | shape |
|---|---|---|
| `Δn = +N_flat` | 0 | **flat disc** — the round grows sideways only |
| `0 < Δn < N_flat` | 0 < Δy < h | **cone / bowl**, opening out |
| `Δn = 0` | h | **cylinder** |
| `−N_flat < Δn < 0` | 0 < Δy < h | **dome**, closing in |
| `Δn = −N_flat` | 0 | flat closing disc |
| `\|Δn\| > N_flat` | imaginary | **ruffle** (hyperbolic — no surface of revolution exists) |

**This is why "+6 sc per round lies flat" implies sc height ≈ 0.95 × width.**
If `N_flat = 6` then `h/w = 6 / 2π = 0.955`. The folk rules for the first round of a
flat circle are exactly `N_flat`, and they are self-consistent across stitch heights:

| stitch | folk "flat circle" rate | ⇒ h/w = N/2π |
|---|---|---|
| sc | 6 in a magic ring, +6/round | **0.955** |
| hdc | 8 | **1.273** |
| dc | 12 ("12 dc in a ring") | **1.910** |
| tr | 16 | **2.546** |

Two independent confirmations from the fixtures:

* **Hex socks** (`crochet-stylecraft-hex-socks.pdf`): hexagon in UK tr, adds
  6 × 3tr = **+18 tr per round**. Predicted flat rate for a hexagon in tr (§1.4)
  is `2·6·tan(30°) · 2.546 = 17.6`. Within 2%.
* **Persian Tiles** Rnd 1 is `15 dc in ring` + ch-3 = 16 dc, right on the
  dc flat rate of 12–16 for a round worked into a tiny ch-4 ring.

### 1.2 Recommended SW/SH per stitch

`SW = 1.0` (stitch width) is the right unit; keep it. `SH = 1.5` for height 1 is
**wrong by 57%** and is the single biggest fidelity bug in the layout model
(evidence in §1.3 and §3). Replace the single `SH` with a per-type
(width, height) table, in SW units:

| `t` | width | height, **rounds** | height, **rows** | N_flat | bump amp | notes |
|---|---|---|---|---|---|---|
| `sc`, `x` | 1.00 | **0.95** | 1.00 | 6 | 0.20 | `x` = unparsed; treat as sc |
| `inc` (each of the 2 emitted) | 1.00 | 0.95 | 1.00 | — | 0.22 | wider slice already handled by `wt` |
| `dec` | 1.00 | 0.95 | 1.00 | — | 0.17 | consumes 2 sts of the round below |
| `hdc` | 1.00 | **1.30** | 1.45 | 8 | 0.20 | |
| `dc` | 1.00 | **1.90** | 1.95 | 12 | 0.16 | taller posts read smoother, less knobbly |
| `tr` | 1.00 | **2.55** | 2.60 | 16 | 0.13 | |
| `sl` | 1.00 | **0.35** | 0.40 | 2 | 0.10 | a slip stitch adds almost no height |
| `ch` as a stitch | 1.00 | 0.45 | 0.50 | — | 0.08 | |
| `ch-k` bridging k skipped sts | **k** | 0 | 0 | — | 0 | a *space*, not a stitch: width k, no height |
| `bbl`/`puff`/cluster | 1.15 | 1.60 | 1.70 | 10 | 0.45 | stands proud; doubles the bump |
| `fpdc`/`bpdc` (post sts) | 1.00 | 1.90 | 1.95 | 12 | 0.20 | plus z-offset ∓0.30 (§4.3) |

Rows are ~5–8% taller than rounds because a turned row includes the turning chain
and hangs. Measured gauges from the fixtures back the rows column:

* `crochet-premier-simple-throw.pdf`: 9 hdc and 6 rows = 4" → h/w = **1.50**.
* `crochet-premier-sparkling-wrap.pdf`: 22 sc and 12 rows = 4" over the mesh
  pattern → 1.83 (mixed sc/tr rows, consistent with sc 1.0 + tr 2.6 alternating).
* `crochet-bernat-basketweave.pdf`: 8 sts and 5 rows = 4" in post-stitch pattern →
  1.60 for dc, low because the post stitches pull the fabric in horizontally.

Tolerance for judging the renderer: **±12%** on any single h/w, **±8%** on a
finished part's aspect ratio.

### 1.3 Stuffing, and why the current model needs a fudge factor

Run the numbers on an amigurumi sphere and the unstuffed answer looks wrong:
the snowman's lower body (`crochet-snowman.pdf`, R1–R25: 6→66 at +6, six straight
rounds, 60→18 at −6) is, laid flat, a **drum**: a flat disc, a short cylinder wall,
a flat disc. `Δy = 0` for every increase and decrease round, so
`H = 5.95w` against a diameter of `21.0w` — aspect **0.28**. That is a coaster.

What makes it a ball is **stuffing**, which stretches the flat discs into caps.
So model stuffing explicitly instead of baking it into the slope heuristic. One
knob, one line:

```
Δy = h · sqrt(1 − min(1, (1−s)·|Δr| / h)²)        s ∈ [0, 0.5], the "slack"
```

`s = 0` reproduces the isometric (unstuffed) geometry exactly; `s = 0.35` is the
right default for a closed, firmly stuffed amigurumi part. Validation against the
sizes the patterns print:

| part | max Ø | H, current model (SH 1.5 + asin) | H, `s = 0.35` | reality |
|---|---|---|---|---|
| snowman lower body | 21.0w | 28.9w — **aspect 1.37** | 19.5w — aspect **0.93** | a ball, ≈1.0 |
| snowman head | 15.3w | 21.6w — aspect 1.41 | 13.5w — aspect **0.88** | a ball, ≈1.0 |
| panda head | 15.3w | 25.7w — aspect 1.68 | 16.9w — aspect **1.11** | round head |
| panda body | 11.5w | 23.8w — aspect 2.08 | 16.9w — aspect **1.48** | tall pear |
| turtle shell | 13.4w | 9.3w — aspect 0.70 | 7.0w — aspect **0.52** | shallow dome |
| bear head (sc) | 9.5w | — | 9.7w — aspect **1.02** | round head |

End-to-end check: snowman whole piece = **32.7w** tall, 21.0w wide. Jumbo chenille
sc ≈ 1.2 cm wide → **39 cm**, against the cover's stated **40 cm / 15.7"**.
Panda: head 16.9w + body 16.9w with the usual overlap ≈ 28w; DMC Petra 3 on a 3 mm
hook gives w ≈ 0.36 cm → **10 cm**, against the stated *"4 inches (10 cm) high
(sitting)"*. The current model overshoots both by 35–55%.

**How to pick `s` automatically** (all detectable from the pattern text, which
`Patterns` already reads):

| condition | s |
|---|---|
| text near the part says `do not stuff` / `Do not stuff` (cato tail, turtle feet, baphomet tail) | 0.05 |
| part starts from a magic ring / `ch 2, n sc in` **and** closes to ≤ 8 sts, or says `Stuff` | 0.35 |
| part says `Stuff … VERY firmly` (baphomet muzzle) | 0.45 |
| part ends at or near its maximum count — open rim: hat, cowl, sock leg, motif | 0.00 |
| rows mode | 0.00 always |

### 1.4 Non-circular rings: the polygon rule

Ring radius `R = count·SW/2π` assumes a circle. A motif whose increases stack at the
same *k* angular positions every round is a **k-gon** with straight sides. For a
regular k-gon of perimeter `P`:

```
side  s  = P / k
inradius a  = P / (2k·tan(π/k))          (mid-side)
circumradius Rc = P / (2k·sin(π/k))      (corner)
flat rate  N_flat,k = 2k·tan(π/k) · h/w  (stitches per round to stay flat)
```

| k | corner / circle radius | mid-side / circle radius | N_flat,k ÷ N_flat,circle |
|---|---|---|---|
| 4 (square) | **1.111** | **0.785** | **1.273** |
| 5 | 1.069 | 0.865 | 1.156 |
| 6 (hexagon) | **1.047** | **0.907** | **1.103** |
| 8 | 1.026 | 0.948 | 1.056 |
| ∞ (circle) | 1.000 | 1.000 | 1.000 |

So a granny square worked at 1.27× the circle's increase rate lies flat, its corners
sit 11% further out than a same-perimeter circle and its mid-sides 21% closer in —
a 41% corner-to-side swing, unmistakable on screen.

**Detection rule** (in priority order; uses `Patterns.expand` output plus the row text):

1. **Collapse `inc` pairs.** `expand` emits **two** entries with `t:'inc'` per
   increase, adjacent. Merge adjacent runs of `inc` into one increase site at the
   run's start index. Same for `dec` (one entry, consumes two).
2. Let `sites` = increase-site indices for the round, `n` = round count.
   Convert to angles `θ_j = 2π · site_j / n`.
3. **Clustered test.** Fit `k ∈ {3,4,5,6,8}`: score `k` by how close the `θ_j` are
   to `k` evenly spaced clusters (circular variance within each cluster < (π/k)/3).
   Require at least ⌈0.8k⌉ clusters occupied.
4. **Persistence.** The winning `k` must repeat with the *same phase* (±½ slice) for
   **≥ 3 consecutive rounds**. One round of corner increases is a dart, not a polygon.
5. **Rate test.** `Δn` per round should be within ±25% of `N_flat,k`, not of
   `N_flat,circle`. A square growing at the *circle* rate is a cupped square (needs
   blocking), which is still a square — so this test only raises confidence, it does
   not veto.
6. **Chevron veto.** If the round has ≈k increase sites **and** ≈k decrease sites
   with net `Δn ≈ 0`, it is **not** a polygon — it is a **chevron/ripple cylinder**
   (the Stylecraft cowl: 240 ch joined in a ring, 10 repeats of a `3ch`-peak,
   constant count). Render as a cylinder whose top and bottom band edges zig-zag by
   ±0.6·h with k lobes.
7. **Text fallbacks**, needed because `expand` returns *nothing at all* for granny
   motifs (§3 caveat): `k = 4` when a round matches
   `(…, ch 2|3|5, …) in (corner|next ch-\d sp)` with `rep from \* (2|3) (more )?times`
   or the piece is called a *square*/*tile*/*motif* with a stated `"Square = …"`
   gauge; `k = 6` on *hexagon*/`6 x 3tr groups`. Both cases appear verbatim in
   `crochet-stylecraft-hood.pdf` and `crochet-stylecraft-hex-socks.pdf`.

Geometry to apply once `k` is known: modulate the ring radius,

```
r(θ) = a / cos( ((θ + φ) mod 2π/k) − π/k )      blended toward the circle by
r_render(θ) = mix(P/2π, r(θ), sharp)            sharp = 0.75 for granny corners,
                                                0.45 for amigurumi darts
```

and keep the arc length of each band equal to `Σ width_i` so the stitches still fit.

### 1.5 Ovals / stadiums from a foundation chain

`crochet-baphomet.pdf` muzzle, p5:

```
R1: Ch12, start 2nd chain from hook 10sc, 3scinc (3sc into one stitch) in last
    chain, 9sc down opposite side, inc into bottom side of first ch [24]
R2-R5: 24sc around (4 rounds)
```

This is the canonical oval. Worked down both sides of an `L`-chain it gives a
**stadium** (a rectangle capped by two semicircles), and the straight length never
changes — every later round only grows the two rounded ends:

```
L_straight = (L_chain − 1) · SW              fixed for the whole part
P_k        = 2·L_straight + 2π·r_k           r_k = k · h  (end radius after k rounds)
⇒ Δn per round = 2π·h/w = N_flat             same rate as a circle
⇒ aspect (long axis : short axis) = (L_straight + 2r) : 2r     → narrows every round
```

Round 1 count for the standard phrasing is `2(L−1) + 2 + 2·(extra in the turn sts)`
— here 10 + 3 + 9 + 2 = 24 for `ch 12`, i.e. `≈ 2L`.

**Detection**: round 1's text matches
`ch\s*(\d+)` … and any of `down (the )?(opposite|other) side`, `back (down )?(the )?(other|opposite)`,
`in (each|the) (ch|chain) (across|down) (the )?(other|opposite)`, **or** `3\s*sc\s*(inc)?\s*in (the )?last (ch|chain)`.
Capture `L`. Alternative signal when the text is opaque: round 1's count ≈ 2L with
exactly **two antipodal** increase clusters (the two turn points). Then set
`straightLen = (L−1)·SW`, place the two end centres at ±straightLen/2 on the long
axis, and lay every ring as a stadium of perimeter `Σ width_i`.

Note the **fish body is NOT an oval**, despite the fixture prompt's hint. Its round
1 is `2 ch, into the first ch: 9 sc` — a 9-stitch magic-ring equivalent, so it is a
sphere-family piece that the round 8–11 asymmetric decreases squash laterally into a
teardrop. The muzzle above is the only true stadium in the crochet fixture set.

### 1.6 The equator, closing, and gathering

* **Equator** = the round(s) of maximum count. Report its position as a fraction of
  the finished height, measured at the **centre of the max-count plateau** (using the
  first or last index of a plateau is what makes `turtle shell` read 0.73 or 1.00 for
  the same rim). For a strictly symmetric inc-then-dec sequence with no plateau the
  equator lands at **0.50 ± 0.02** of height; every plateau shifts it toward the
  plateau's own midpoint.
* **Closing to 6 and gathering.** `Fasten off and … thread the yarn through the front
  loops and pull to close` collapses the last ring to a **point**, not to
  `6·SW/2π = 0.955w`. `R_MIN = 0.42` currently leaves a 0.42w-radius flat lid on
  every amigurumi. Detect the gather (`pull (tight )?to close`, `pull to close`,
  `close the (hole|opening)`, `Decx\d` / `dec all around` as the final round, or a
  final count ≤ 8 on a piece that started from a magic ring) and taper the final band
  to `r = 0` with a small inward pucker (radius overshoot −0.15w two rounds before the
  tip reads as the real gathered dimple).
* **Magic-ring start.** `prevR = R[0] · 0.34` is a good approximation of the closed
  ring. Keep it, but cap it at `0.30·SW` absolute so an `MR 24` does not open a crater.

### 1.7 Ruffles (the case the model currently cannot express)

When `|Δn| > N_flat` there is no surface of revolution. The surplus fabric buckles.
Model it as an `m`-lobed wave on the radius rather than trying to make `Δy` imaginary:

```
excess e = (Σ width_i) / (2π·r_flat) − 1          r_flat = the radius the band would
                                                  have at the flat rate
r(θ) = r_flat · (1 + ε·cos(mθ))                   with  ε = (2/m)·sqrt(e)
Δy   = h · (1 − min(0.8, e))                      the round also rises less
```

`m` = the number of increase clusters when clustered; otherwise the natural buckling
wavelength of crochet is 6–10 stitches, so `m = clamp(round(n/8), 5, 14)`.

Fixture cases: **cato wings** row 7 `Skip 1st stitch, 3Hdc in each stitch — (60)`
from 21 (e = 1.9, a violent frill — this is the feather edge); **snowman hat** R12
`FRONT LOOP ONLY: (sc, sc inc) around` 48→72 on a piece that is already at full
diameter (a flared brim); any lace edging round of `3 dc in each st`.

---

## Part 2 — Reference set: 40 crochet fixture parts

`Δ` column: the count sequence, written as `start → max → end` with the per-round
delta. `asp` = expected **height ÷ max diameter** (±8%). `eq` = height fraction of
the equator (centre of the max plateau). `H`/`Ø` in SW units, from
`Δy = h·sqrt(1 − ((1−s)Δr/h)²)` with `h = 0.95` (sc) or `1.30` (hdc) and the `s`
in the table. Photo page = page of the fixture PDF that shows the finished part.

### 2.1 Amigurumi worked in rounds — spheres, eggs, domes

| # | fixture | part | count sequence | class | Ø | H | asp | eq | s | photo |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | crochet-snowman | Body (**one piece, two stacked spheres with a waist**) | 6→66 (+6×11), 66×6, →18 (−6×8), 18→48 (+6×5), 48×5, →6 (−6×7 then Dec×6) | **peanut / snowman**: two spheres, waist Ø 18w at 0.60 H | 21.0 | 32.7 | 1.56 | 0.42 | .35 | p1 (40 cm stated), p6 |
| 2 | crochet-snowman | Nose | MR4, 4 sc | tiny cylinder / nub | 1.3 | 1.8 | 1.42 | 1.00 | .35 | p4 |
| 3 | crochet-snowman | Hat | 6→36 (+6), 36, →48, 48, R12 FLO (sc,inc)→72 | **cup + flared brim** (ruffle on the last round, e≈0.5) | 22.9 | 8.6 | 0.38 | 1.00 | .00 | p5, p6 |
| 4 | crochet-panda | Body | 6→36 (+6×5), 36×6, 30, 30, 30, 24×3, 18×2 | **egg / pear**, stepped taper | 11.5 | 16.9 | 1.48 | 0.55 | .35 | p1, p3 |
| 5 | crochet-panda | Head | 6→48 (+6×7), 48×8, →18 (−6×5) | **sphere** (slight egg) | 15.3 | 16.9 | 1.11 | 0.50 | .35 | p1 |
| 6 | crochet-panda | Arm | 6→9 (+3), 9, →6, 6×7 | **thin tube with a bulb tip** ("only stuff hand") | 2.9 | 10.1 | 3.53 | 0.25 | .15 | p3 |
| 7 | crochet-panda | Leg | 6→18 (+6×2), 18, 15, 11, 9×3 | **cone/paw**, fast taper | 5.7 | 7.7 | 1.34 | 0.40 | .35 | p3 |
| 8 | crochet-panda | Ear | 6→18 (+6×2), 18, →12 (−6) | **shallow cup/bowl**, sewn flat | 5.7 | 3.8 | 0.67 | 0.75 | .10 | p4 |
| 9 | crochet-panda | Eye | 6→12 | **flat disc** (2 rounds, appliqué) | 3.8 | 1.4 | 0.38 | 1.00 | .05 | p4 |
| 10 | crochet-panda | Tail | 6, 6, 6 | **stub cylinder** | 1.9 | 2.6 | 1.37 | 1.00 | .35 | p3 |
| 11 | crochet-turtle | Shell | 6→42 (+6×6), 42×2 | **shallow dome** — all rounds at the flat rate | 13.4 | 7.0 | 0.52 | 0.90 | .35 | p1, p6 |
| 12 | crochet-turtle | Belly | 6→42 (+6×6), join shell → 48 | **flat disc** (stiffens only when the pair is stuffed) | 15.3 | 5.8 | 0.38 | 1.00 | .20 | p2, p6 |
| 13 | crochet-turtle | Head | 6→24 (+6×3), 24, 18, 18×4, 12 | **egg / snout**, widest at 0.42 H | 7.6 | 9.1 | 1.19 | 0.42 | .35 | p3, p6 |
| 14 | crochet-turtle | Foot (×4) | 6→12, 12×3 | **flat-ended tube**, "do not stuff" | 3.8 | 3.4 | 0.90 | 1.00 | .05 | p3, p6 |
| 15 | crochet-turtle | Tail | MR4, 4, →8 | **tiny cone**, unstuffed | 2.5 | 2.5 | 0.98 | 1.00 | .05 | p4, p6 |
| 16 | crochet-fish | Body | 9→42 (+9,+6×4), 40, 34, 36, 33, 30, 24, 18, 12 | **teardrop, laterally squashed** (R8–R11 decs are clustered on one side ⇒ not a surface of revolution) | 13.4 | 9.8 | 0.73 | 0.33 | .40 | p1, p10 |
| 17 | crochet-fish | Tail fin | `{1 slst, 4 ch, back: hdc, dc, hdc, sc}` ×2 into FLO | **flat 2-st-wide flap**, not part of any ring | — | 2.5 | — | — | — | p10 |
| 18 | crochet-fish | Upper fin (in rows on the closed head) | 3 sc, 2 sc, 1 sc | **tiny triangle in rows** | 3.0 | 2.9 | — | — | .00 | p10 |
| 19 | bear | Head | MR8, 16, 24, 30×6, 24, 18, 12, Dec×6 | **sphere with a flat muzzle panel** (colour A run) | 9.5 | 9.7 | 1.02 | 0.55 | .35 | p3 (PHOTO A–D) |
| 20 | bear | Body (**hdc**, grown out of head round 11) | 18→36 (Hdc Inc ×18!), 40×5, 36, 30, 24 | **barrel** — R2 Δn=+18 vs N_flat(hdc)=8 ⇒ **ruffle/flare**, e≈1.25, then cups | 12.7 | 9.9 | 0.78 | 0.55 | .35 | p4 (PHOTO E–F) |
| 21 | bear | Leg (grown out of body round 10, 8 of 24 sts) | 16, 24, 24, 12, 6 | **short cone**, NOT on the body's axis | 7.6 | 2.1 | 0.28 | 0.60 | .35 | p5 (PHOTO I–K) |
| 22 | bear | Arm (hdc) | MR6, 9, 9, 9, 8, 6 | **tube**, very slight taper | 2.9 | 7.6 | 2.65 | 0.60 | .25 | p6 (PHOTO L–N) |
| 23 | bear | Ear | MR5, 8, 12 | **flat-ish shell**, 3 rounds | 3.8 | 2.5 | 0.67 | 1.00 | .05 | p6 (PHOTO O–P) |
| 24 | cato | Head | 6→24, 24×3, 30, 36, 36, 42×3, 36, 30, 24, 24, 18, 9 | **sphere** with a bobble muzzle (R4 `(Bbl, Slst)x5`) | 13.4 | 13.8 | 1.03 | 0.50 | .35 | p4/p5 |
| 25 | cato | **Tail & Body, one piece** | 5, 5, 10, 10×2, 15×7, 18×7, 20–24: →48 (+6×5), 48, →24 (−6×4), 24×3, 18×4 | **tadpole**: 19-round thin tapered tube then a sphere | 15.3 | 32.3 | 2.12 | 0.62 | .20 | p7 |
| 26 | cato | Ear | 6, 6, 6, 9, 12, 12, 15, 18, 21, 21 | **cup / cone** — +3 per round is **half** the flat rate ⇒ pattern says *"making a cupping shape"* | 6.7 | 9.0 | 1.35 | 1.00 | .00 | p6 |
| 27 | cato | Horn | 5×3, 10×3, 15, 15 | **stepped cone**, unstuffed until sewn | 4.8 | 7.1 | 1.50 | 1.00 | .20 | p6 |
| 28 | cato | Arm | 6, 12, 18, 18, 18, 15×3, 12×6, 9, 9 | **tapering tube**, folded + closed at the top | 5.7 | 14.4 | 2.50 | 0.28 | .15 | p8 |
| 29 | cato | Wing (**worked in rows from an MR**) | 8, 14, 13, 12, 22, 21, **60** | **fan then frill**: row 5 doubles (e≈0.8), row 7 triples (e≈1.9) ⇒ hyperbolic ruffle | — | — | — | — | .00 | p9 |
| 30 | crochet-baphomet | Body/Head, one piece | 8, 16, 24, **36** (R4 `(sc,inc)x12`), 36×7, 27, 18, 16, R15 **FLO** 24, 32, 40, 48, 48×10, 36, 36, 24, 16, Dec×8 | **two stacked spheres with a hard FLO waist ridge** at R15 | 15.3 | 22.6 | 1.48 | 0.75 | .40 | p1, p7, p8 |
| 31 | crochet-baphomet | Tail | 4, 6, 7, 9, 11, 11, 13, 15, 15, 12, 9, 6, then **6×30 rounds** | **long whip tube**: 30 rounds of 6 sc, Ø 1.9w. Unstuffed ⇒ should hang/curve, not stand | 4.8 | 39.5 | 8.28 | 0.21 | .05 | p3, p8 |
| 32 | crochet-baphomet | Horn (×2) | MR5, then `Inc, Nsc` **×13** — **one increase, always at the same angular position** | **curled cone**, not a straight cone: the asymmetric increase column makes the tube arc. Pattern: *"both are pointing inward or forward"* | 5.7 | 13.1 | 2.28 | 1.00 | .45 | p5, p7 |
| 33 | crochet-baphomet | Ear (×2) | 6→30 (+6×4), 30 | **flat disc folded in half** (`3sc through both sides`) ⇒ finished shape is a **half-disc** Ø 9.5w | 9.5 | 4.5 | 0.48 | 1.00 | .00 | p6, p7 |
| 34 | crochet-baphomet | Foot (×2) | MR8, 16, **hdc** 24, BTL 24, 16, 16×3 | **cylinder with a 3rd-loop ridge** at round 4 (a visible horizontal welt) | 7.6 | 5.7 | 0.74 | 0.41 | .35 | p6, p7 |
| 35 | crochet-baphomet | **Muzzle** | `Ch12 … 10sc, 3scinc in last ch, 9sc down opposite side, inc [24]`, then 24×4 | **STADIUM / oval tube**: long axis = 11·SW fixed, short axis grows. The only true oval in the set | 7.6 (as a circle) — true footprint **11.0 × 3.5** | 3.8 | 0.50 | 1.00 | .45 | p5, p7 |
| 36 | crochet-baphomet | Arm (×2) | MR8, 16, 16×6, 11, 11, 11 | **tube, folded and closed with `5sc through both sides`** | 5.1 | 9.3 | 1.83 | 0.60 | .20 | p3, p7 |
| 37 | bee (small) | Body | 5, 10, 15, 15×6 (striped), 10, 5 | **striped egg** — colour changes every round | 4.8 | 8.7 | 1.83 | 0.55 | .35 | p4 |
| 38 | bee (large) | Body | 6→42 (+6×6), 42×16 striped, →6 (−6×6) | **striped sphere**, long cylinder waist | 13.4 | ≈29 | 2.16 | 0.50 | .35 | p8 |
| 39 | bee | Wing | `1. 6sc in mr / 2. Inc / 3. Ch1, turn, (Inc, sc) x5, inc / 4. Ch1, turn, (inc, 2sc) x5, inc, sc` | **half-disc fan worked in rows off a ring** (a st marker holds the un-worked stitch) | — | — | — | — | .00 | p7, p9 |
| 40 | crochet-stylecraft-hex-socks | Sock leg (rounds, after the hexagon) | 24 dc × 6 rounds, then toe decs | **cylinder**, open both ends | 7.6 | 4.8 | 0.62 | — | .00 | p1 |

### 2.2 Flat shapes worked in rounds — polygons and discs

| # | fixture | part | count sequence | class | measurable expectations | photo |
|---|---|---|---|---|---|---|
| 41 | crochet-redheart-persian-tiles | Square motif | ch4 ring → 16 dc → 24 sc → 4 × `(3 dc, ch 3, 3 dc)` corners, 6 rounds | **square** from rounds, k=4 | **4 corners**; gauge states `Square = 5½"`; flatness H/Ø < 0.10; corner radius / circle radius = 1.111; corner-to-mid-side swing 1.41 | p1 |
| 42 | crochet-redheart-persian-tiles | Afghan | 9 × 8 joined squares | **flat rectangle of 72 squares**, 46" × 51" | asp 51/46 = **1.11**; the diagram should show one motif, not the afghan | p1 |
| 43 | crochet-stylecraft-hood | 2-colour motif (×8) | 6ch ring → 4 × `(2ch, 3tr)`; 6 rounds of 4 corner `(3tr, 2ch, 3tr)` | **granny square** in UK tr, k=4 | gauge `6 rnds to 16 cm`; **4 corners**; flat (H/Ø < 0.08); Δn ≈ +12 tr/round vs N_flat,4(tr) = 20.4 ⇒ slightly cupped until blocked | p1 |
| 44 | crochet-stylecraft-hood | Hood (assembly) | 8 motifs whip-stitched 3 + 4 + 1 | **folded shell**: 36 × 36 cm | diagram should show the motif only; assembly is out of scope | p1 |
| 45 | crochet-stylecraft-hex-socks | Hexagon | 6 × 3tr groups → `Rnds 4-9 … 9 x 3tr groups` … `Rnds 13-15 … 15 x 3tr groups` | **hexagon**, k=6, **+18 tr/round** | **6 corners**; flatness H/Ø < 0.06; N_flat,6(tr) = 17.6, actual +18 ⇒ genuinely flat (±2%); pattern warns *"6 corners. This is normal"*; then folded corner-1-to-corner-4 into an L | p1 |
| 46 | crochet-gosyo-lace-doily | Doily | magic ring, 14 charted rounds (symbol chart, no row text) | **flat lace circle**, Ø 19 cm / 7.48" | flatness H/Ø < 0.03; every round at or just above `N_flat`; final round a deliberate ruffle picot. Text layer carries **no** row instructions — a graceful-degradation fixture | p1 (chart p2) |
| 47 | crochet-stylecraft-cowl-mitts | Cowl | `make 240ch, join chain into a circle`, then `Rnd 2` repeated to 28 cm | **chevron cylinder**, 10 lobes, constant count | Ø from 240 ch ≈ 240·SW/2π = 38w; H 28 cm ≈ 0.74 × circumference; **net Δn = 0 with 10 inc + 10 dec sites** ⇒ chevron veto (§1.4.6), zig-zag top/bottom edges with 10 points | p1 |

### 2.3 Worked in rows

| # | fixture | part | count sequence | class | measurable expectations | photo |
|---|---|---|---|---|---|---|
| 48 | crochet-premier-sparkling-wrap | Wrap | ch 406 → 405 sc, rows 2–46 mesh | **rectangle**, 74" × 16" | width 405 sts, 46 rows; asp (H/W) = **0.216**; with the measured 1.83 row height the model gets 0.208 (−4%). With every row forced to sc height 1.0 it gets **0.119 — half too short** | p1 |
| 49 | crochet-premier-simple-throw | Blanket | ch 96 → 94 hdc BLO, ≈88 rows | **rectangle**, 40" × 59" | asp = **1.475**; with hdc h=1.50 the model gets 1.41 (−4%); BLO gives a horizontal ridge every row | p1 |
| 50 | crochet-bernat-basketweave | Blanket | ch 100 → 97 dc, `Dcfp`/`Dcbp` in blocks of 4, to 56" | **rectangle with a corrugated surface**, 50" × 57" | asp = **1.14**; gauge 8 sts & 5 rows = 4" ⇒ dc h/w 1.60 (post stitches pull in); 4-stitch checkerboard blocks alternate ±0.30·SW in z; edging round of hdc all round | p1 |
| 51 | crochet-kingcole-pumpkins | Pumpkin body (small) | ch 11 → 10 **UK** dc, `Dc BLO` × ~44 rows | **ribbed rectangle in rows → finished object is a gathered sphere** | rendered honestly: 10 × 44, asp = 44·h/10; **UK dc = US sc ⇒ h must be 1.0, not 2.0**; stated finished 3" × 4" after rolling into a tube and gathering both ends. **The diagram should show the flat panel and say so** | p1 |
| 52 | crochet-kingcole-pumpkins | Stalk | ch 6 → 5 UK dc × 4 rows, folded and seamed | **tiny rectangle → tube** | 5 × 4 panel; finished a 4-round tube | p1 |
| 53 | crochet-hobbii-amarah-en | Shawl | ch4 → 3 hdc; `Row 4: hdc to last st, 3 hdc in last st` (+2), `Row 5: 2 hdc in first st … hdc2tog` (net 0); rows 4&5 to row 144 | **right/asymmetric triangle**: increases at **one edge only** ⇒ one straight vertical edge, one hypotenuse, apex at row 1 | **3 corners**; final count ≈145 over 144 rows; stated 142.5 cm × 46 cm (**low confidence**: the printed `12 sts × 16 rows` gauge is inconsistent with 144 rows — it looks like row *pairs*). Must be **left-aligned**, not centred | p1, p2 |
| 54 | crochet-stylecraft-cowl-mitts | Scarf | 79 ch → chevron rows to 164 cm | **long chevron rectangle** with 3 points at one end, 4 at the other | width ≈ 79·SW; asp ≈ 164/28 = 5.9; edges zig-zag | p1 |
| 55 | crochet-stylecraft-cowl-mitts | Mitt (×2) | 52 ch → chevron rows to 28 cm, **then seamed leaving a 6 cm thumbhole** | **rectangle in rows → finished object is a tube** | 52-wide panel; the diagram should show the flat panel and note "seamed into a tube" | p1 |
| 56 | cardigan (Wheat Stitch) | Body panel | ch 19 → 18 sts, grows to 184 (208, 224) sts, worked flat top-down in one piece with `puff` rows | **rectangle-ish yoke → body**, size-dependent | count jumps at the yoke split (`leaving the remaining 96 (108, 116) sts unworked`); puff rows alternate with BLO sc rows ⇒ horizontal welts every 2 rows; `Fsc 96` re-adds the underarm | p1 |
| 57 | cardigan | Sleeve | Rnd 1 = 58 sts, `dec 1–2 under the arm on every sc round` to 34–36, then even to Rnd 49 | **truncated cone (tapered tube)** worked in rounds | Ø from 58 → 34 sts; all decs at **one** angular position (under the arm) ⇒ the taper is **asymmetric**, not a symmetric cone — same signal as the baphomet horn | p1 |
| 58 | cardigan | Sleeve cuff | `ch 8 → 7 sts`, rows worked **sideways**, `sl st 2 sts on the sleeve edge` each row | **long thin rectangle worked perpendicular** → finished object is a **ring** around the cuff | 7 wide × many rows; the diagram cannot know it is a ring; render the strip and say so | p1 |
| 59 | crochet-furls-frontier-shawl | Filet shawl | — | **triangle (filet mesh)** | **no text layer at all** (`pdftotext` yields 1 byte) — the graceful-failure fixture: the diagram must show nothing rather than a garbage shape | p1 |
| 60 | crochet-snowman | Scarf | `R1: Ch71, turn / R2: 70sc / R3: 70sc` | **long thin rectangle** | 70 × 3; asp 0.043. Note: the snowman project has parts in **both** modes, but `countMode` is per-**project** | p5 |

### 2.4 What the reference table says in aggregate

* **Every stuffed round-worked sphere lands at aspect 0.88–1.15.** The current
  layout model puts all of them at **1.37–1.68**. Systematically 35–55% too tall.
* **Every flat disc/dome lands at aspect 0.03–0.55.** The current model puts the
  turtle shell at 0.70 (a bowl) and cannot represent a doily, a granny square or a
  hexagon at all.
* **Thin tubes are the opposite error**: the `asin(R/Rmax)` heuristic squashes the
  baphomet tail's 30 rounds of 6 sc to 0.60·SH each instead of 0.95, so a 42-round
  tail renders 25% short (29.6w vs 39.5w).

---

## Part 3 — Caveat: how much structure the model actually receives today

Measured by running `Patterns.expand` on the fixture text (browser, `Patterns` as
loaded by `test/patterns.fixtures.html`):

| fixture phrasing | counts | `inc`/`dec` markers | `height` |
|---|---|---|---|
| `R3: (sc, sc inc) x6 (18)` — snowman, turtle, baphomet, cato, bear shorthand | ✔ | ✔ **positions usable** | ✔ |
| `Rnd 3: (Sc in next st, 2 sc in next st) around. (18)` — **panda** longhand | ✔ | ✘ **all `sc`, no markers at all** | ✔ |
| `3. Rnd: (2 sc, inc) x6 (24)` — **fish** (`N. Rnd:` prefix) | ✔ | ✘ **all `x`** | ✘ (always 1) |
| `Ch12 … 9sc down opposite side, inc [24]` — baphomet muzzle | ✔ | ✘ (`x`×24) | ✘ |
| Granny square / hexagon rounds (Persian Tiles Rnd 4+, hood, hex socks) | ✘ **n = 0** | ✘ | ✘ |
| Lace mesh rows (Premier wrap rows 2–4) | carried from `prevCount`, all `sc` | ✘ | ✘ (1, should be ≈1.8) |
| `Row 4: hdc to last st, 3 hdc in last st. <7 sts>` — Amarah shawl | ✔ | ✘ (the edge increase is padding) | ✔ (1.5) |
| UK `Dc BLO` — King Cole pumpkins | ✔ | ✘ | **wrong dialect**: `dialectHints` says `uk` but `stitchTok` never asks, so UK dc would be height 2 instead of 1 and UK tr 2.5 instead of 2 |

Two structural notes on the contract:

* `expand` emits **two adjacent entries with `t:'inc'`** per increase. Any consumer
  counting increase *sites* must collapse adjacent runs.
* `expand` computes a per-stitch `h` internally but **drops it** on the way out
  (`res.stitches = list.map(… {t, c})`), so the renderer only ever sees one
  `dominantHeight` per round. For a mixed row (Premier wrap row 3 = `tr, dc, hdc, sc`,
  fish round 7 = sc + a hdc/dc fin) that loses the real profile.

**Consequence for the layout model**: `Δcount` must remain the *primary* signal — it
is the one thing that is almost always right — and increase positions, polygon `k`
and oval `L` must be *refinements* that degrade to "evenly spread" when absent. Any
design that requires `inc` positions will silently fail on the panda and the fish.

---

## Part 4 — Ranked changes to the layout model

Effort S ≈ under an hour, M ≈ half a day, L ≈ a day or more. Impact 1–5 on
"does the diagram look like the finished object".

| # | change | where | effort | impact |
|---|---|---|---|---|
| 1 | **Per-stitch-type height table, and `SH` for sc → 0.95** (§1.2). Replace `SH = 1.5` and `SH_ROWS = 1.05` with the (width, height) table keyed on `t`, `h_rounds` vs `h_rows`. This alone moves every amigurumi sphere from aspect 1.4 to 0.95. | `diagram.js` tuning + `prepRound` | **S** | **5** |
| 2 | **Replace the `asin(R/Rmax)` slope heuristic with the isometric walk + an explicit stuffing slack** `Δy = h·sqrt(1 − ((1−s)|Δr|/h)²)` (§1.1, §1.3). Deletes `MAX_STRETCH` and the sphere fudge; makes "+6 = flat, 0 = cylinder, >N_flat = ruffle" exact and fixes the 25%-short thin tube. | `diagram.js layoutRounds` | **S** | **5** |
| 3 | **Ring perimeter from Σ per-stitch width, not `count·SW`** — and plumb the per-stitch `h` through `expand` instead of throwing it away. A `ch-3` bridging 3 skipped stitches is 3 wide and 0 tall; a puff is 1.15 wide and 1.6 tall. Without this, lace and granny rounds can never be the right size. | `patterns.js expand` + `store.js` + `diagram.js` | **M** | **5** |
| 4 | **Derive `s` (stuffing) per part from the pattern text** (§1.3 table) and store it on the model (`Model.slack`). "Do not stuff" pieces must stay flat; "stuff VERY firmly" must round out. | `store.js buildDiagramModel` | **S** | **4** |
| 5 | **Taper the closing rounds to a point when the piece is gathered**, and drop `R_MIN` on the final band (§1.6). Right now every amigurumi has a 0.42w flat lid where the gather dimple should be. | `diagram.js layoutRounds` + a text flag from `store.js` | **S** | **4** |
| 6 | **Polygon rings** (§1.4): detect `k` from clustered, persistent increase sites plus the text fallbacks, and modulate `r(θ)`. Without it, the Persian Tiles square, the Stylecraft hood motif and the hex-socks hexagon are all wrong-shaped — three of the four garment-family fixtures worked in rounds. | `store.js` (detection) + `diagram.js` (radius fn) | **L** | **4** |
| 7 | **Row anchoring in rows mode from where the increases fall.** `buildRoundBand` centres every row (`x = −totalW/2`), so the Amarah shawl's one-edge triangle renders as a symmetric isosceles wedge and a cardigan armhole shifts both ways. Anchor left / right / centre / spine from the position of the row's net delta. | `diagram.js` rows branch + a per-row `anchor` in the model | **M** | **4** |
| 8 | **Ruffle model for `\|Δn\| > N_flat`** (§1.7): an m-lobed radius wave plus a reduced `Δy`, instead of the current clamp that turns a frill into a smooth flare. Needed by the cato wing, the snowman hat brim, the bear body's R2 flare and every lace edging. | `diagram.js layoutRounds`/`layoutRows` | **M** | **3** |
| 9 | **Make `expand` recognise longhand increases and the `N. Rnd:` prefix** so the panda and the fish produce `inc`/`dec` markers and real stitch types instead of `sc`/`x` (§3). Everything in items 6–8 and 11 degrades gracefully without it, but degrades. | `patterns.js` | **M** | **3** |
| 10 | **Respect the detected dialect in `stitchTok`**: UK `dc` = US sc (height 1), UK `tr` = US dc (2), UK `dtr` = US tr (2.5). `dialectHints` already returns `uk` for the King Cole pumpkins; `expand` never asks. Every UK pattern is currently 1.5–2× too tall wherever a row does parse. | `patterns.js` | **S** | **3** |
| 11 | **Oval / stadium rings** (§1.5): capture `L` from the chain-and-back-down phrasing, then lay rings as stadiums with a fixed straight length. One fixture part (baphomet muzzle) but a very common amigurumi idiom (muzzles, soles, shoe uppers, bag bases). | `store.js` + `diagram.js` | **M** | **3** |
| 12 | **Chevron/ripple detection and a zig-zag band edge** (§1.4.6), so the Stylecraft cowl and scarf read as rippled fabric rather than a smooth tube, and so a chevron is never mistaken for a polygon. | `store.js` + `diagram.js` | **M** | **2** |
| 13 | **Post-stitch and loop-marker corrugation**: keep `fpdc`/`bpdc`/`BLO`/`FLO`/`BTL` as distinct `t` values and offset those stitches ±0.30·SW in z (Bernat basketweave checkerboard, pumpkin ribs, baphomet foot's BTL welt, snowman hat's FLO brim, baphomet body's FLO waist). Currently `fpdc` collapses to `dc` in `stitchTok`. | `patterns.js` + `diagram.js` | **M** | **2** |
| 14 | **Measure the equator at the centre of the max-count plateau** and expose `equatorFrac`, `aspect`, `maxDiameter` and `cornerCount` from `getStats()`, so `test/diagram.test.html` can assert the numbers in Part 2 rather than relying on eyeballing. | `diagram.js getStats` + the test page | **S** | **2** |
| 15 | **Honest labelling for "rows now, tube later"**: pumpkin body, mitts, cowl-from-rows, sideways cuffs and folded ears are flat panels in the pattern and solids in the hand. Show the panel (correct) with a one-line caption from the finishing text (`Fold work in half`, `seam`, `gather`, `fold and sc through both sides`). Do **not** attempt the fold. | `store.js` + app caption | **S** | **2** |

### 4.1 What the diagram should NOT try to do

* **Assembly.** The bear's body starts with `18 sc into the bottom of the head` and
  its legs continue out of body round 10 using 8 of 24 stitches; the baphomet's arms
  and tail are crocheted *into* the body mid-round; the turtle's belly is joined to
  the shell on its last round; the hood is 8 whip-stitched motifs. Rendering the
  assembled animal needs per-part transforms that no pattern states. Keep parts
  separate — that is the right call and SPEC already does it.
* **Curled and hanging parts.** The baphomet horn's increase column is at one fixed
  angular position for 13 rounds, which in real fabric **arcs the tube**; the
  cardigan sleeve's underarm decreases do the same. A straight cone is a defensible
  simplification, but the diagram should not pretend to a symmetry the fabric does
  not have — at minimum, do not *also* claim it is a symmetric surface of revolution
  in the stats. Likewise the unstuffed 30-round baphomet tail hangs; drawing it
  standing straight up is acceptable, drawing it as a rigid cone is not.
* **Folding, seaming, gathering, blocking.** Items 15 above.
* **Multi-motif objects.** Show one motif (Persian Tiles, hood), never the 72-square
  afghan.
* **Charts with no row text.** The Gosyo doily and the Furls shawl have no usable
  instructions (the Furls PDF has no text layer at all). Show nothing rather than a
  shape invented from a count that was never parsed.
