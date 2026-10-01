# 04 — Visual QA: every fixture part, render vs photo

Lens: the reviewer who puts the render next to the picture on the pattern's own cover and
asks "is that the same object?". This file is the **evidence**; `01-geometry-truth.md` is
the physics it keeps running into, and where a cause is already derived there I point at it
rather than re-derive it.

Tool built for this pass: **`test/diagram.gallery.html`**. For each of 18 curated fixture
PDFs it fetches the file, runs `PdfText.extract`, splits it with `Store.splitSections`, and
for every section builds an in-memory part (`{ id, name, patternText, row: 0, stitch: 0,
rowStitches: [], sizeIndex: 0 }`) plus a fake project (`{ countMode, yarnColors: {} }`),
calls `Store.diagramModel`, marks every round worked, and mounts the **finished** piece on
an interactive auto-rotating canvas next to the PDF's own page 1 (and the page the section's
text came from, found by counting `=== PAGE n ===` markers). Nothing is written to the app's
real `localStorage`: the store is pointed at `ZD4_gallery_store` via `__setKeyForTests`, and
the reviewer's shape classes and verdicts live under `ZD4_gallery` with a JSON export button.
Per-card controls: rounds/rows override, shape class, verdict; global: ghost/wire toggle,
photo toggle, card cap.

Numbers printed on each card are **recomputed in the gallery** from the same formulas as
`layoutRounds`/`layoutRows` (`R = count·SW/2π`, `R_MIN 0.42`, `SH 1.5`, `SH_ROWS 1.05`,
the `asin(R/Rmax)` arc walk, `MAX_STRETCH 2.6`) rather than imported, so if a constant drifts
the card stops matching the picture — which is itself a finding. Every number quoted below is
what the card printed.

Screenshots cannot be saved from the Browser pane, so each row says precisely what is on
screen.

---

## Part 1 — The table

`asp` = printed aspect (height ÷ width). Severity: **wrong-class** (a different kind of
object), **wrong-proportion** (right kind, wrong shape), **cosmetic**, **fine**.

### Amigurumi (rounds mode — the case the feature was designed for)

| fixture | part | counts (printed) | asp | expected from the photo | what the render shows | severity | note |
|---|---|---|---|---|---|---|---|
| panda | Body | 6→36, 36×7, 30×3, 24×3, 18×2 | 2.08 | squat black-and-white egg, ≈1.3 tall | a **tall ribbed capsule**, all cream | wrong-proportion + colour | 7 straight rounds at max radius each cost 1.5 SW |
| panda | Head | 6→48, 48×8, →18 | 1.68 | round ball head ≈1.0–1.1 | tall barrel with a domed top, all cream | wrong-proportion + colour | a *pure* 6→48→6 sphere prints 1.05, so the error is entirely in the straight rounds |
| panda | Arm | 6, 9, 9, 6×8 | 4.07 | short black sausage with a rounded tip | a **chess-pawn**: bulb on a thin stick, sharply pointed tip | wrong-proportion | the 9→6 step reads as a shoulder; tip is a cone, not a dome |
| panda | Leg | 6,12,18,18,15,11,9,9,9 | 1.54 | small black foot | dome on a short stem | cosmetic | |
| panda | Tail | 6,6,6 | 2.10 | a bobble | a small pointed cone | wrong-proportion | 3 rounds of 6 should be ≈1.0 tall, prints 2.1 |
| panda | Ear | 6,12,18,18,12 | 0.95 | flat black semicircle | a shallow bowl | wrong-class | ears are flat, sewn closed |
| panda | Eye | 6,12 | 0.43 | flat white disc | a shallow cone | wrong-class | |
| snowman | (unnamed, whole body) | 6→66, 66×6, →18, →48, 48×5, →6 (42 rnds) | 2.02 | two stacked balls with a waist | **two stacked bulbs with a waist — recognisably a snowman** | fine (proportion long) | best rounds render in the set; `01` puts the truth at 1.56 |
| snowman | Nose | 4,4 | 1.97 | a carrot cone | a 2-round stub | cosmetic | the carrot's 20 dec rounds never parsed |
| snowman | Hat | 6→48 (all increase) | 0.74 | a hat: dome + brim | a **shallow bowl / cone** | wrong-proportion | see defect C |
| snowman | Scarf | **0**, 71, 71 | 0.24 | a long flat strip | a giant ring with a pinched start | wrong-class | leading zero count, defect F |
| turtle | Shell | 12→42, 42×3 | 0.68 | shallow green dome | **a dome** | fine | |
| turtle | Belly | 12,18,24,30,36,42,48 | 0.47 | a **flat circle** sewn to the shell | a deep **bowl** | wrong-class | defect C, the clearest example |
| turtle | Head | 12,18,24,24,18×5,12 | 1.55 | rounded head on a neck | a **mushroom**: flared cap with a lip over a neck | wrong-proportion | the 24→18 step makes a hard skirt |
| turtle | Feet | 12,12,12,12 | 1.48 | a short open tube sewn on | a **cone with a sharp point on top** and a flared hem | wrong-class | defect D — the cap |
| turtle | Tail | 4,8 | 0.64 | tiny cone | a cone | fine | |
| fish | Body | 9,18,24,30,36,42,40,34,36,33,30,24,18,12 | 1.13 | blue fish body, longer than tall | egg with a **visible ledge** where 42→40→34→36 wobbles | cosmetic + colour | all cream; photo is bright blue |
| bear | Head | 8,16,24,30×6,24,18,12,6 | 1.64 | round navy head, cream muzzle | tall barrel, navy with a **full-height cream wedge** | wrong-proportion + colour placement | colour *does* resolve here (#2b3556) |
| bear | Body | 18,36,40×5,36,30,24 (hdc, h 1.5) | 1.56 | squat navy body with a cream belly oval | tall barrel with a **floor-to-ceiling cream panel** | wrong-proportion | a colour run is drawn as a vertical stripe, never as a patch |
| bear | First Leg | 16,24,24,12,6 | 0.91 | small flat paw | a wide bowl with a pointed top | wrong-class | |
| bear | Second Leg | **8** (1 round) | 0.59 | same as the first leg | a single cone | wrong-class | "work as First Leg" is not followed — defect E |
| bear | Arms ×2 | 6,9,9,9,8,6 | 3.93 | short rounded navy stub | a **navy spindle, pointed at both ends** | wrong-proportion | |
| bear | Ears ×2 | 5,8,12 | 0.65 | flat navy semicircle | a cone | wrong-class | |
| cato | Head | 6→24, 24×2, 30,36,36,42×3, →9 | 1.42 | green dragon head | egg/barrel with a nub, **all cream** | wrong-proportion + colour | |
| cato | Ears ×2 | 6,6,6,9,12,12,15,18,21,21 | 1.24 | flat leaf-shaped ear | a **stepped pagoda cone** | wrong-class | count jumps make terraces |
| cato | Horns ×2 | 5×3,10×3,15,15 | 1.43 | tapered spike | a **3-tier pagoda** | wrong-proportion | a doubling round is a hard ledge, not a taper |
| cato | Tail & Body | 5→15→18→48→18 (37 rnds) | 1.80 | dragon body with a tail | a **light bulb**: long neck into a bulb | fine-ish | the best long part in the set |
| cato | Arms ×2 | 6,12,18,18,18,15×3,12×6,9,9,4 | 3.09 | short arm | long thin tube, rounded top | wrong-proportion | |
| cato | Feet ×2 | 6,12,18,18,13,13 | 1.13 | small foot | a dome | cosmetic | |
| cato | Wings ×2 | rows 8,14,13,12,22,21,**60** | 0.16 | a triangular wing flap | a **horizontal sliver** | wrong-class | the stray 60 sets the sheet width; defect G |
| baphomet | Body/Head | 8→36, 36×6, →18, →48, 48×12, →8 (33 rnds) | 2.65 | body + head in one piece | tall two-bulb capsule | wrong-proportion | |
| baphomet | Arms | 8,16×7,11,11,11 | 2.80 | short arm | capped tube | wrong-proportion | |
| baphomet | Tail | 4→15→6, then 6×30 | 6.19 | long thin tail | long thin tube, **pointed cap** | wrong-proportion | 30 straight rounds × 1.5 = 45 of the 47 units of height |
| baphomet | Muzzle | 24,24,24,24,24 | 1.08 | an **oval tube** sewn on the face, open | a **capped cylinder** | wrong-class | defect D; `01` §1.5 wants a stadium ring here |
| baphomet | Horns | 5,6,7,…,18 (+1/round) | 2.22 | a curved horn | a smooth cone | fine | the one part the +1 walk suits |
| baphomet | Ears | 6,12,18,24,30,30 | 0.62 | flat ear | a bowl | wrong-class | |
| baphomet | Feet | 8,16,24,24,16×4 | 1.23 | a hoof | dome on a tube | cosmetic | |
| bee | Body (small) | 5,10,15×6,10,5 | 2.48 | fat yellow-and-black oval | **yellow with black stripes**, too long | wrong-proportion | colour is right |
| bee | Body (medium) | 6→24, 24×10, →6 | 2.84 | fat striped oval ≈1.5 | striped capsule | wrong-proportion | |
| bee | Body (large) | 6→42, 42×16, →6 | 2.73 | fat striped oval | **striped capsule — the colour is excellent** | wrong-proportion | best colour result in the whole set |
| bee | Wings ×3 sizes | 6,12 / 6,12,17 / 6,12,17,23,29,35 | 0.43–0.48 | flat teardrop wings | domes | wrong-class | |

### Published designer patterns (the half of the fixture set that barely produces a model)

| fixture | part | counts (printed) | asp | expected from the photo | what the render shows | severity | note |
|---|---|---|---|---|---|---|---|
| kingcole pumpkins | Pumpkin Body / Medium / Large | rows **10,10** / **20,20** / **30,30** | 0.21 / 0.11 / 0.07 | three fat ribbed orange spheres | a **2-row flat ribbon** | wrong-class | only the foundation chain parsed |
| kingcole pumpkins | Stalk ×3 | rows 5,5 / 7,7 / 9,9 | 0.42–0.23 | a short green stalk | a 2-row ribbon | wrong-class | |
| redheart persian tiles | First Square | 16,24,24,24,24 (one h 2 row) | 1.02 | a **flat square motif** in a blanket | a **bell / bowl of revolution** | wrong-class | defect B, textbook case |
| redheart persian tiles | Second Square | *(none)* | — | another flat square | **empty card** — "no rows with a count" | wrong-class | |
| redheart persian tiles | Border | 0, 1 | 2.98 | a flat edging round | a twisted sliver | wrong-class | |
| stylecraft hood | Motif ×8 | *(none)* | — | a hooded wrap of motifs | **empty** | wrong-class | |
| stylecraft cowl-mitts | Scarf / Cowl / Mitts | *(none, none, none)* | — | scarf (rectangle), cowl (tube), mitts (tubes) | **all three empty** | wrong-class | |
| stylecraft hex-socks | (unnamed) / Leg Lengthening / Top Of Leg Rib / Toe | *(all none)* | — | a pair of colourful socks | **empty** | wrong-class | |
| stylecraft hex-socks | Foot Lengthening Rnds | **7** (1 round, h 2.5) | 1.13 | part of a sock foot | a single tr ring | wrong-class | |
| premier sparkling wrap | Wrap | rows 405, **0**, 405, 405 | **0.01** | a wide rectangular wrap on a model | a **hairline stick** with a pinch in it | wrong-class | defect F and G together |
| premier simple throw | Blanket | rows 94, 94 | 0.03 | a 40″×59″ blanket | a 2-row sliver | wrong-class | ≈88 real rows, 2 parsed |
| bernat basketweave | (unnamed) | rows **98** (1 row) | 0.01 | a basketweave blanket | a 1-row thread | wrong-class | |
| bernat basketweave | Edging | *(none)* | — | a worked edging | empty | wrong-class | |
| gosyo lace doily | (unnamed) | *(none)* | — | a flat round lace doily (symbol chart) | **empty** | wrong-class | chart-only; graceful, but nothing to show |
| cardigan | Swatch | rows 18,18,**0**,**0**,18,18 | 0.35 | a gauge swatch | a sheet with two collapsed rows | cosmetic | |
| cardigan | First Section | rows 184×8 | **0.05** | the cardigan body | a **razor-thin ribbon** | wrong-proportion | ≈8 of ≈90 rows expanded |
| cardigan | Center Back | rows 88,88,88,88,12,12 | 0.07 | the back panel | a tapered ribbon | wrong-proportion | |
| cardigan | Second Section | rows 184×9 | 0.05 | the second body half | a ribbon | wrong-proportion | |
| cardigan | Sleeves | **58** (1 round) | 0.21 | a sleeve tube | a single ring | wrong-class | |
| cardigan | Sleeve Cuff | rows **0**,**0**,2 | 1.58 | a cuff | a two-hole sliver | wrong-class | |
| cardigan | Front Trim | rows 7,7,2 | 0.45 | a long front band | a 3-row stub | wrong-class | |
| fish | *(only 1 section for the whole PDF)* | — | — | fish with fins and a tail | fins/tail never become parts | wrong-class | a `splitSections` miss, listed for completeness |

**Tally over 66 cards:** 24 wrong-class, 21 wrong-proportion, 7 cosmetic, 4 fine,
10 empty-or-one-round (counted inside wrong-class).

---

## Part 2 — Recurring defect classes

Ordered worst first. "Cause" is a hypothesis with the line I would look at.

### A. Straight rounds are 50% too tall — every tube, limb and body is a stretched capsule

*Fixtures:* panda Body/Head/Arm/Tail, bee all three Bodies, baphomet Tail/Arms/Body,
cato Arms, bear Head/Body/Arms, turtle Head/Feet, snowman body. **Twenty-one parts.**

*Evidence.* A pure sphere (`6,12,…,48,48,42,…,6`) prints **aspect 1.05** — the
`asin(R/Rmax)` arc walk handles the poles correctly. Add straight rounds at the equator
and the error appears in proportion to how many there are: a bare tube (`6,12×11`) prints
**1.385 units of height per round** against real fabric's ≈0.95. Panda Head is 25.74 tall
where it should be ≈21.7; bee large Body is 36.48 where ≈29 is right; baphomet Tail spends
45 of its 47 units on 30 straight rounds.

*Cause.* `SH = 1.5` in `js/diagram.js` (~line 59). At the equator `phi → 90°`, so
`dy = reach·sin(phi) → reach = height·SH = 1.5`. A single crochet is ≈0.95 as tall as it
is wide (`01` §1.1 derives this from the +6-per-round flat-circle rule, and the same file's
§1.2 tables it per stitch type). The renderer already half-knows: **rows mode uses
`SH_ROWS = 1.05`** eight lines further down. The two constants disagree by 43% and the
rows one is nearly right.

*Smallest fix:* `SH → 0.95`, or better the per-type table in `01` §1.2. Spheres stay at
1.0 because the polar damping is unchanged; every capsule loses its stretch.

### B. Squares, hexagons and any non-circular motif are rendered round

*Fixtures:* redheart persian tiles First Square (dc square motif, prints aspect 1.02 as a
**bell**), stylecraft hex-socks (hexagon motifs), and by construction every granny square,
hexagon, triangle and star in the corpus.

*Cause.* `layoutRounds` is a solid of revolution by definition: a ring is `R = count/2π`
and the band is swept through a full `TAU`. There is no notion of corners, so a motif whose
count grows by `+8 per round at four corners` is drawn as a circle whose radius grows —
i.e. a bowl. The model contract (`SPEC.md` § Model) has no field that could carry
"this is a 4-corner flat motif" either, so this cannot be fixed in `diagram.js` alone:
`Store.diagramModel` has to detect corner repeats (`(3 dc, ch 2, 3 dc) in corner sp`) and
emit a per-round `corners: n` / `flat: true`, and the layout has to lay a polygon ring.

Because the same rounds are also **flat**, this defect stacks with C: the render is both
round *and* domed when the truth is a flat square.

### C. Flat discs are rendered as bowls; anything flat gains a dome

*Fixtures:* turtle Belly (12→48 all-increase, prints **0.47**), panda Ear/Eye, bear
First Leg/Ears, baphomet Ears, bee Wings ×3, snowman Hat, cato Feet.

*Evidence.* A round worked `+6 sc` every round lies dead flat in real fabric; the gallery
prints 0.47 for the turtle belly, i.e. a hemisphere. `01` §1.1 gives the exact rule
(`Δn = N_flat ⇒ Δy = 0`).

*Cause.* Same line as A, from the other side. `dy = max(reach·sin(phi), dR·tan(phi))` with
`phi = asin(R/Rmax)`: on a flat disc every round sits near `Rmax`, so `phi → 90°` and
`tan(phi)` blows up, and the clamp `dy ≤ 2.6·reach` is what stops it — which is to say the
outer rounds of every flat circle are pinned at the *maximum* rise the model allows. The
formula was tuned so that a stuffed sphere reads as a ball; it has no term for "this round
added exactly enough stitches to stay flat". The arc-length form in `01` §1.1
(`Δy = h·sqrt(1 − (Δn/N_flat)²)`) gives 0 here for free and still gives a ball for a sphere.

### D. Every rounds-mode piece is capped, even when it starts on a chain ring

*Fixtures:* turtle Feet (12,12,12,12 — a plain tube with a **pointed top**), baphomet
Muzzle (24×5, capped cylinder), bear First Leg (starts at 16), panda Arm (visible spike),
cato Horns; in principle every sock, cuff, sleeve, cowl and muzzle in the corpus.

*Cause.* Found it: `js/diagram.js` ~line 1060,

```js
// magic-ring cap
if (mode === 'rounds' && rounds.length && rounds[0].count > 0) {
```

There is no magic-ring test at all — the comment says "magic ring", the condition says
"has any stitches". `SPEC.md` is explicit ("Close the top with a cap **when round 1 is a
magic ring**"). A cheap heuristic that matches the fixtures: cap when `rounds[0].count ≤ 8`
**and** the first two or three rounds increase; otherwise leave the top open, exactly as
the bottom is. Better, have `Store.diagramModel` set a `closedTop` flag from the text
(`magic ring`, `MR`, `6 sc in second ch from hook`, `ch 2, 6 sc in ring` → closed;
`ch 24, join with sl st` / `join to form a ring` → open).

### E. Published designer patterns produce an empty or two-row model

*Fixtures:* **12 of the 18 fixtures.** Completely empty: stylecraft hood, stylecraft
cowl-mitts (all 3 parts), stylecraft hex-socks (4 of 5), gosyo lace doily, redheart persian
tiles Second Square, bernat basketweave Edging. Two rows or fewer: kingcole pumpkins (all
6 parts), premier simple throw, bernat basketweave, cardigan Sleeves, bear Second Leg.

*Cause.* Not the renderer — `Store.diagramModel` falls through to `countOf(line)`/
`rowStitches`/current-row and gets nothing, because `Patterns.parse` never produced a
numbered row with a count for UK-dialect prose (`2ch, 11tr into ring, ss to top of 2ch
(12 sts)`), for repeat instructions (`Rows 3–60: rep rows 1 and 2`), and for back-reference
sections (`work as First Leg to Rnd 5`). The user-visible effect is the worst in the set:
open a Stylecraft pattern, press ⤢ 3D view, and the viewer is **blank**. Whatever else
lands, `App` should not offer a 3D view for a part whose model has fewer than ~3 non-zero
rounds — an empty viewer reads as a broken feature, while a hidden button reads as
"not for this pattern".

### F. A zero count in the middle of a piece punches a hole through it

*Fixtures:* premier sparkling wrap (`405, 0, 405, 405`), cardigan Swatch (`18,18,0,0,18,18`)
and Sleeve Cuff (`0,0,2`), snowman Scarf (`0,71,71`), redheart persian tiles Border (`0,1`).

*Cause.* `buildDiagramModel` will happily push a round with `count: 0` (the loop only
guards `count < done`), and `layoutRounds` clamps its radius to `R_MIN = 0.42` — so a
405-stitch sheet pinches to nothing and back. A zero-count round is never real fabric;
it is a row the parser could not read. It should either inherit the previous round's count
or be dropped. One line in `store.js`.

### G. Rows mode: sheets are a tenth of their height and one bad count sets the width

*Fixtures:* cardigan First/Second Section (184 wide × 8 rows, **aspect 0.05**), Center Back
(0.07), premier sparkling wrap (**0.01**), premier simple throw (0.03), bernat basketweave
(0.01), kingcole pumpkins (0.07–0.42), cato Wings (0.16).

Two separate things stack:
1. **Height.** `Row 3–60: repeat rows 1 and 2` is never expanded, so a 90-row cardigan
   panel has 8 rounds in the model. This is the same parser gap as E, but it produces a
   *plausible-looking* wrong answer rather than an empty one, which is worse.
2. **Width.** `layoutRows` sets `width = maxCount · SW` over the whole part, so a single
   stray count — cato Wings' `60` among 8–22, or a chain length counted as a row — makes
   the sheet 3× too wide and the auto-fit shrinks the real fabric to a line. Using a
   median (or dropping rounds whose count is a wild outlier from the previous one) would
   make every one of these readable.

### H. Colour: the row-level "With black," form is never recognised, and the legend is polluted

*Fixtures:* panda (whole animal renders cream although the text says `With white,` /
`With black,` on Rnd 1 of every part), cato (green dragon, all cream), fish (blue, all
cream), turtle (green, all cream). **Working:** bee (yellow + black stripes, excellent),
bear (twilight `#2b3556`).

*Evidence, measured in the gallery console on the panda Arm section whose Rnd 1 literally
reads `Rnd 1: With black, ch 2, 6 sc in second chain from hook`:

```
Patterns.expand(...)  → { color: null } for rows 1–4, every stitch c: null
Patterns.colors(armText) → { legend: {}, names: [] }
Patterns.colorHex('black') → '#1c1c1c'        // the word is known!
```

and on the whole document:

```
Patterns.colors(fullText).legend
  → { CH: 'chain', SC: 'single crochet', ST: 'stitch', RND: 'round', TOG: 'together' }
Patterns.colors(fullText).names
  → ['chain','single crochet','stitch','round','together','black','white']
```

*Two causes.* (1) `SPEC.md` lists `With MC` and `Using yellow` as base-colour setters, but
the real amigurumi idiom is `With black, ch 2, …` — the colour word is followed by a comma
and more instructions on the same line, and the matcher does not take it. (2) The
abbreviation table at the top of the PDF (`CH = chain`, `SC = single crochet`) is being read
as a colour legend, so five instruction words become "yarn colours" and would appear in the
Yarn colours sheet. Both live in `Patterns.colors`/`expand`, and both are small.

### I. A colour run is drawn as a full-height vertical stripe, never as a patch

*Fixtures:* bear Head (cream muzzle → a cream wedge from crown to chin), bear Body
(cream belly → a cream panel floor to ceiling).

*Cause.* `prepRound` colours slice *i* of each ring from `stitches[i]`, and consecutive
rounds start their stitch 0 at the same angle, so any colour run at the same stitch offset
in several rounds lines up into a meridian stripe. That is right for a belly panel worked
at the same offset, and wrong the moment the run moves (a muzzle is 6 sts wide on round 8
and 10 sts wide on round 10, centred). No rotation offset per round is carried in the model;
the round is drawn starting at angle 0 regardless of where the previous round ended.
Low severity next to A–E, but it is the thing that makes a two-colour animal look striped.

### J. Stitch-count jumps make hard terraces instead of tapers

*Fixtures:* cato Horns (`5,5,5,10,10,10,15,15` → a 3-tier pagoda), cato Ears (stepped
cone), turtle Head (a mushroom lip at 24→18), fish Body (a ledge where the count wobbles
42→40→34→36), panda Arm (a shoulder at 9→6).

*Cause.* This is geometrically *honest* — the fabric really does jump — but real yarn and
stuffing smooth it, and the model makes it worse: `BULGE`/`DIP` put a groove at every band
edge, so a big `dR` step lands a groove exactly on the discontinuity. A small amount of
vertical smoothing of the radius profile (a 3-tap filter over `R[]` before the arc walk,
strength scaled by how much of the piece is stuffed) would keep the silhouette and lose
the staircase.

### K. WebGL canvases stay blank when the page is not compositing

Not a fidelity bug, but it cost an hour of this pass and it will cost the next reviewer the
same. `diagram.js` draws only from `requestAnimationFrame`. In a window that is minimised,
occluded, or an embedded preview pane, rAF never fires, so `getStats()` reports
`webgl: true, chunks: 42, verts: 25380, triangles: 0, fps: 0` and the canvas shows the
clear colour. The app is exposed to the same thing on tab restore: a WebGL canvas without
`preserveDrawingBuffer` shows nothing until a frame is drawn. Worth a `visibilitychange`
listener that marks the state dirty and kicks. (pdf.js has the identical problem — a
display-intent render task never settles in such a window — which is why the gallery
rasterises pages with `intent: 'print'`.)

---

## Part 3 — What I would fix first

1. **`SH = 1.5 → 0.95`** (defect A). One constant; it fixes 21 of the 66 cards and nothing
   else regresses, because the sphere case is carried by the polar damping and rows mode
   already uses 1.05.
2. **The flat-fabric term** (defect C), i.e. `01` §1.1's `Δy = h·sqrt(1 − (Δn/N_flat)²)` in
   place of the `asin` heuristic. Fixes every ear, wing, eye, belly and sun-hat, and makes
   A's fix exactly right rather than approximately right.
3. **Make the cap conditional** (defect D) — a real `magic ring` test where the comment
   already claims one.
4. **Guard the empty model** (defect E): no ⤢ 3D view, and no live canvas, for a part whose
   model has fewer than three non-zero rounds. Today 12 of 18 fixtures open a blank viewer.
5. **Drop zero-count rounds** (defect F) and **median-width the rows sheet** (defect G) —
   two small changes in `store.js`/`layoutRows` that stop a single unreadable line from
   destroying a whole piece.
6. **`With <colour>,` at the head of a round** and **stop reading the abbreviation table as
   a colour legend** (defect H) — the difference between a cream blob and a panda.

`test/diagram.gallery.html` is the regression harness for all six: set the shape class on
every card once, export the JSON, and any of these changes can be re-run against the same
66 parts and the same printed numbers.
