# 06 — Fresh-eyes review of the live 3D diagram, after the fidelity rebuild

Lens: someone who has not touched this code, opening `test/diagram.gallery.html` and the
app and asking one question per card — *is that the same object as the photograph?*

Reference used: `01-geometry-truth.md` Part 2 (expected class, `asp` = height ÷ max
diameter, `eq` = equator as a fraction of height). Prior state: `04-visual-qa.md`.

**Session conditions, because they limit what this file can claim.** The Browser pane was
hidden for the middle third of the pass, and a hidden pane produces no WebGL frames, so
screenshots came back black and `toDataURL` came back fully transparent. Where that
happened I judged the piece from the card's own printed geometry (`DiagramGeo.classify` —
per-round radius, `dy`, `y`, cap flags, lobes, per-round colour), which is the same module
the renderer lays out with, so shape/proportion/cap/colour verdicts are sound even without
a picture. Rows marked **(numbers only)** were *not* looked at. Everything else was seen.

A second limit: at ~7 mounted canvases the gallery loses WebGL contexts — 4 of 7 reported
`status:'lost'` after one scroll pass, and a lost card draws a plain **white** rectangle
while `getStats()` still cheerfully reports `running:true, fps:165, triangles:8670`. I
worked around it by loading one fixture at a time with `max cards/fixture` turned down.
That is defect **11** below.

---

## Part 1 — Card by card

Verdict key: **matches** (same object), **close** (right kind, wrong numbers), **wrong**
(different kind of object), **ugly** (a rendering artefact, whatever the silhouette says).

### panda — `crochet-panda.pdf`

| part | expected (01 §2.1) | what you see | verdict | note (printed numbers) |
|---|---|---|---|---|
| Body | egg / pear, asp 1.48, eq 0.55 | a cream **beehive**: straight-sided cone on top, barrel below, one hard shoulder where 36→30, black from R15 down. Black colour change is right and obvious | close | asp **1.49**, eq **0.43@r9**, w 11.46 × h 17.05, slack 0.35, cap T–, colours 2: R1 `#fdfdfb`, **R15 `#1c1c1c`** ✓ |
| Head | sphere, asp 1.11, eq 0.50 | an **ice-cream cone / lampshade** — the whole upper half is a straight-sided cone to a needle apex, then a short cylinder, then an open flat bottom. Not a ball | wrong (proportion is right, silhouette is not) | asp **1.12**, eq **0.57@r12**; every increase round `dy 0.72` with `Δr 0.95` ⇒ constant 37° slope ⇒ a cone by construction |
| Arm | thin tube + bulb tip, asp 3.53, eq 0.25 | *(numbers only)* | close | asp **3.58**, eq **0.22**, black ✓, cap T– |
| Leg | cone / paw, asp 1.34, eq 0.40 | a dark **stack of flared tiers** — each round is its own shell with an overhanging lip | ugly | asp **1.36**, eq 0.35; black `#1c1c1c` renders as mid-grey with hard speculars |
| Tail | stub cylinder, asp 1.37, eq 1.00 | three **lampshades stacked on top of each other**, each flaring out over the one below, dark hole at the apex. A 6-stitch ring is a hexagonal flower, not a circle | ugly | asp **1.44**, eq 0.65; 3 rounds × 6 sts, r 0.95 vs stitch bump 0.20 ⇒ 21 % radial wave |
| Ear | shallow cup, asp 0.67, eq 0.75 | a **spinning top / cog**: central conical spike over a flat disc with 18 sharp points around the rim | wrong | asp **0.51** (was 0.44 before today's `formOf` change), form `shallow-bowl`, slack 0.10 |
| Eye | flat disc, asp 0.38 | *(numbers only)* — a 2-round disc, R1 black R2 white | close | asp **0.19**, form `disc`, slack 0 — flatter than 01 asks, but honest for `Δn = N_flat` |

### snowman — `crochet-snowman.pdf`

| part | expected | what you see | verdict | note |
|---|---|---|---|---|
| (whole body) | peanut, two spheres + waist, asp 1.56, eq 0.42 | *(numbers only)* | close | asp **1.56** — exact — eq **0.33@r14**, w 21.01 × h 32.87, cap TB |
| Nose | tiny nub, asp 1.42 | a smooth cream **paper bag / bucket** with four huge lobes and one seam, blown up to fill the frame. No stitch texture survives at this scale | ugly | asp **1.42** ✓ but 4 sts around; auto-fit scales a 1.27-wide piece to full frame |
| Hat | cup + flared brim, asp 0.38, eq 1.00 | a **tiered wedding cake** (5 hard ledges) sitting on a violent 23-point frill. The frill is rendered **coral-orange**, which is not a yarn colour — it is the working-round glow | close + ugly | asp **0.33** (was 0.16 — today's `cup` form fixed that), form `cup`, slack 0.20, RUF 1 (R12, 23 lobes), colours 1 (`#f1e3c8`) |
| Scarf | flat strip 70 × 3, asp 0.043 | *(numbers only)* — a giant ring: the project is in rounds mode and round 1 has count **0** | wrong | counts `0, 71, 71`, asp **0.08**. 04 defect F is **not fixed**: a zero-count round still enters the model |

### turtle — `crochet-turtle.pdf`

| part | expected | what you see | verdict | note |
|---|---|---|---|---|
| Shell | shallow dome, asp 0.52, eq 0.90 | *(numbers only)* — a shallow dome whose whole height comes from the 3 straight rounds | close | asp **0.35** (was 0.15), form `cup`, slack 0.20; rounds 2–6 all `dy 0.56`, r steps 0.95 ⇒ a cone frustum, not a dome |
| Belly | flat disc, asp 0.38, eq 1.00 | *(numbers only)* | close | asp **0.28**, form `disc`, slack 0.35, eq 1.00 |
| Head | egg / snout, asp 1.19, eq 0.42 | *(numbers only)* | close | asp **1.00**, eq **0.25@r4** |
| Feet | flat-ended tube, asp 0.90, "do not stuff" | a wide **cake tin**: a flat 12-petal star lid with a dark hole at the centre, then 3 heavily overhanging tiers | ugly | asp **0.75**, slack 0.05 ✓ (`stuffed:false` detected), cap T– |
| Tail | tiny cone, asp 0.98 | *(numbers only)* | close | asp **0.63**, form `bowl` — a 2-round `4,8` piece classified as a bowl |

### fish — `crochet-fish.pdf`

| part | expected | what you see | verdict | note |
|---|---|---|---|---|
| Body | teardrop, asp 0.73, eq 0.33 | *(numbers only)* | matches | asp **0.76**, eq **0.35@r6** — both inside tolerance. RUF 1 on R2 (9→18) is a false positive (defect 1) |
| *(fins, tail fin)* | separate parts | never become sections | wrong | `splitSections` still yields **1 section** for the whole PDF (04 noted this) |

### bear — `bear.pdf`

| part | expected | what you see | verdict | note |
|---|---|---|---|---|
| Head | sphere + muzzle panel, asp 1.02, eq 0.55 | *(numbers only)* — but the numbers say the top pole is a flat lid: R2 and R3 are both ruffled, `dy 0.11` each, so 8→24 stitches happen in 0.22 of height | wrong | asp **0.97**, eq 0.43, cap TB, RUF **2**, navy `#2b3556` ✓ |
| Body | barrel, asp 0.78, eq 0.55 | *(numbers only)* | close | asp **0.80**; **slack 0.05** because `stuffed` came back `null` and `start` is `unknown` — the right answer by luck |
| First Leg | short cone, asp 0.28 | *(numbers only)* | close | asp **0.35**, RUF 2, cap –B |
| Second Leg | same as First Leg | **one round** — "work as First Leg" is still not followed | wrong | counts `8`, asp 0.50. 04 defect E unchanged |
| Arms | tube, asp 2.65 | *(numbers only)* | close | asp **2.58**; form `shallow-bowl` for a 6-round tube is a misclassification |
| Ears | flat-ish shell, asp 0.67 | *(numbers only)* | matches | asp **0.61**, form `bowl` |

### cato — `cato.pdf`

| part | expected | what you see | verdict | note |
|---|---|---|---|---|
| Head | sphere, asp 1.03, eq 0.50 | *(numbers only)* | close | asp **1.04** ✓, eq **0.65@r11** vs 0.50; ends at 9 sts and is gathered, yet `capB = false` ⇒ an open hole in the skull (defect 3) |
| Ears | cup / cone, asp 1.35, eq 1.00 | *(numbers only)* | close + ugly | asp **1.32** ✓ but the model carries a **stray final round of 2 stitches** (`…,21,21,2`) that pinches the rim shut, and `cap TB` closes a cup that should be open |
| Horns | stepped cone, asp 1.50 | *(numbers only)* | matches | asp **1.51** ✓, form `cup` |
| Tail & Body | tadpole, asp 2.12, eq 0.62 | *(numbers only)* | close | asp **1.80** — 15 % short, because `stuffed:false` (from the tail's "do not stuff") is applied to the **whole one-piece tail+body**; slack 0.05 where 01 wants 0.20 |
| Arms | tapering tube, asp 2.50, eq 0.28 | *(numbers only)* | matches | asp **2.66**, eq 0.21 |
| Feet | small foot | *(numbers only)* | close | asp 0.88 |
| Wings | fan then frill (rows) | *(numbers only)* — a horizontal sliver | wrong | rows `8,14,13,12,22,21,**60**`; `w 60.00 × h 7.94`, asp **0.13**, `fitClamp: height`. 04 defect G (one stray count sets the sheet width) unchanged |

### baphomet — `crochet-baphomet.pdf`

| part | expected | what you see | verdict | note |
|---|---|---|---|---|
| Body/Head | two stacked spheres with a FLO waist ridge, asp 1.48, eq 0.75 | **two stacked tin cans**: flat serrated lid, dead-vertical wall, a flat overhanging collar sticking out sideways at the waist, flat serrated base. Nothing is spherical | **wrong** | asp **1.26**, **RUF 13 of 33 rounds**. R2–R4 `dy 0.11` each (8→36 in 0.34 of height); R15–R18 `dy 0.11` each (16→48 in 0.44); R29–R33 `dy 0.11` each. 17.6 of the 20.2 total height is the two straight-round cylinders |
| Tail | long whip tube, asp 8.28, eq 0.21, *should hang* | a **spear**: lance-head bulb, dead-straight beaded shaft, needle point | close (proportion) / wrong (attitude) | asp **8.21** — the best number in the set — but 01 §4.1 explicitly says a rigid straight draw is not acceptable |
| Arms | tube folded, asp 1.83 | a **barrel with a flat serrated lid** and a flared skirt at the hem; surface reads like bubble wrap at 16 sts around | close + ugly | asp **1.65**, RUF 1, eq **0.09@r2** — the equator is reported at the *ruffled* round because its lobes make `radiusMax` exceed the real plateau (defect 2) |
| Muzzle | stadium 11.0 × 3.5, open | *(numbers only)* | **matches** | `kinds {"oval":5}`, `start chain-oval / ch10`, `cap ––`, w **11.27** × h 4.75. Oval detection is the clearest win of the rebuild |
| Horns | curled cone, asp 2.28 | *(numbers only)* | matches | asp **2.30** ✓ (a smooth cone; the real horn arcs — accepted simplification) |
| Ears | folded half-disc, asp 0.48 | *(numbers only)* | close | asp **0.18**, form `disc` — honest as an unfolded disc, half the reference's folded aspect |
| Feet | cylinder + 3rd-loop ridge, asp 0.74 | *(numbers only)* | matches | asp **0.75** ✓; RUF 2; the BTL welt is not rendered |

### bee — `bee.pdf`

| part | expected | what you see | verdict | note |
|---|---|---|---|---|
| Body (small) | striped egg, asp 1.83 | *(numbers only)* | matches | asp **1.85** ✓, stripes at R5/R6/R7/R8 |
| Body (medium) | striped oval ≈1.5 | *(numbers only)* | close | asp **1.92** |
| Body (large) | striped sphere, asp 2.16 | a bright **yellow drum with two clean black bands** and a party-hat cone on top. The colour work is excellent and unmistakable | close (colour matches, shape does not) | asp **1.85**; stripes R12/R15/R18/R21 ✓. The yellow is very saturated and every stitch carries a hard specular — reads as moulded plastic; the black bands lose all stitch relief |
| Wings ×3 | flat teardrop fans | **flying saucers**: a spiked cream dome on a flat coral-pink ring. On the 2-round wing, **half the object is the working-round glow colour** | wrong + ugly | asp **0.19 / 0.23 / 0.12**, form `disc`; `model.current` = last round on a finished piece (defect 5) |

### kingcole pumpkins — `crochet-kingcole-pumpkins.pdf`

| part | expected | what you see | verdict | note |
|---|---|---|---|---|
| Pumpkin Body / Medium / Large | ribbed panel 10 × ~44 rows, UK dc = US sc ⇒ h 1.0 | *(numbers only)* — a 2-row ribbon | wrong | rows `10,10` / `20,20` / `30,30`; `h 3.82` for 2 rows = **1.91 per row**, i.e. UK `dc` is being given US `dc` height 1.9. 01 item 10 (dialect) is **not** done, and `Dc BLO × ~44 rows` still never expands |
| Stalk ×3 | 5 × 4 panel | *(numbers only)* | wrong | rows `5,5` (h 1.90 — sc height) / `7,7` / `9,9` (h 3.82 — dc height). The same UK `dc` gets two different heights in the same PDF |

### The app (`http://localhost:8766/`, project `ZR1_panda`, 375 × 812)

Imported `crochet-panda.pdf`; the New-project sheet correctly offered
**"From this PDF — Body, Head, Arm, Leg, Tail, Ear, Eye"**, and on save the app
announced *"This pattern is worked in rounds — switched the project to Rounds"*.

* **Legibility under the number.** Good. `STITCHES` sits left, the count top-right, and
  the piece hangs below it — the digits never cross the model, even at "27".
* **The piece in the button.** At round 15 it is a cream beehive about 130 px tall in a
  230 px button: readable as an object, and the round-by-round creases are countable.
* **Colour change at R15.** Clearly visible — the bottom of the piece turns black exactly
  where the pattern does. This is the single most convincing thing the feature does.
* **The working-round ring.** Not legible at phone size. On the black R15/R16 band the
  amber marker is a hairline on a dark band; I had to open the 3D view at 540 px to find it.
* **Per-tap feedback.** There is essentially none. 0/24 and 12/24 of a 24-stitch round on
  a 20-round piece look identical; only the number and the progress bar move.
* **Over-tapping round 16 by 3.** Works, and works well in text: **"3 more than the
  pattern's 24"** in the warning colour, plus a full amber progress bar. The 3D
  **surplus wedge does exist** — a small orange segment on the working round — but it is
  three stitches of twenty-four on a black band, so it is near-invisible at 375 px.
  (Reaching this state needs Auto-advance off; I toggled the global setting and restored
  it to `true` immediately after.)
* **The viewer's shape summary.** Reads **"Dome — 20 rounds · 36 around"**. "36 around"
  is useful. "**Dome**" is wrong for a closed-top, open-bottom piece of aspect 1.49; 01
  calls it an egg/pear, and a dome is by definition squat. The line does not carry aspect,
  cap or stuffing, which the gallery card does.
* **The ghost cage.** It does *not* hide the piece — 4–5 faint lavender rings below the
  solid part. But they read as a separate saucer/stand under the object rather than as the
  rest of the piece, and the outermost ring draws **wider** than the solid piece's bottom
  edge although rounds 17–20 are narrower (24, 24, 18, 18).
* **Material, close up.** Matte, soft-shadowed, clearly wool rather than plastic on the
  cream — the round-to-round creases are separation, not cracks, and there is no
  pinecone ridging. Two blemishes: a small **dark hole at the apex** where the magic ring
  should be pulled shut, and a faint **vertical seam** down the front where the spiral
  closes. At 540 px the per-stitch speculars start to read as wet scales.
* **Group readout is wrong.** Every round reports "**stitch N of 10**" — round 1 (6 sts),
  round 16 (24 sts in 3 groups, i.e. 8 each) and the 405-stitch wrap row all say "of 10".

`ZR1_panda` was deleted at the end; the three pre-existing projects and `ZA3_wrap` were
left untouched, and `autoAdvance` was restored to `true`.

---

## Part 2 — Ranked defects

### 1. The ruffle gate ignores stuffing slack, so every ordinary amigurumi shaping round is drawn as a flat serrated plate

**Worst thing in the build.** `classifyRounds` decides "ruffle" on the **raw** `|Δr|`:

```js
if (!isFirstFromRing && adr > h * kf * (1 + RUFFLE_EPS) && h > 0) { … dy = RUFFLE_RISE * h; }
```

but the non-ruffle branch then uses `(1 - shape.slack) * adr`. A firmly stuffed piece can
absorb `|Δr|` up to `h / (1 − 0.35) = 1.54·h` without buckling; the gate cuts at `1.08·h`.
So on an sc piece any round with `Δn ≥ 7` (`Δr ≥ 1.11`) is declared a frill and given
`dy = 0.12·h = 0.11`.

What that costs: the baphomet Body/Head has **13 of 33 rounds** ruffled — its magic-ring
opening (8→16→24→36 in 0.34 of height), its FLO waist flare (16→48 in 0.44) and its entire
gathered close (48→8 in 0.44). The result is not two spheres, it is two tin cans with flat
lids and a horizontal collar. Bear Head loses its whole crown the same way; cato Head,
baphomet Arms/Feet, fish Body and bear First Leg all carry false ruffles.

*Hypothesis:* geometry constant / rule — the gate must see the same slack the rise does,
e.g. `(1 - shape.slack) * adr > h * kf * (1 + RUFFLE_EPS)`. A decrease of −N_flat on a
stuffed ball is a pole, not a frill.
*File:* `js/diagram-geo.js`, `classifyRounds` (~line 733).

### 2. A magic-ring spiral renders as a straight-sided cone, not a dome

Every increase round has the same `Δr` (0.95) and the same `h`, so the isometric walk gives
the same `dy` (0.72) for all of them — a constant slope, which is a cone by definition. The
panda Head, the turtle Shell, the bee bodies and the snowman Hat crown are all cones or
cone frusta; the only curvature in the picture comes from wherever the count plateaus.
`asp` can be right (panda Head 1.12 vs 1.11) while the object is the wrong shape.

*Hypothesis:* geometry rule. Slack currently only scales `dy`; it needs to also redistribute
the profile, i.e. loft a closed stuffed run toward an ellipsoid between its pole and its
equator rather than walking it straight. (01 §1.3 predicted this — "laid flat it is a drum"
— but the fix it proposed only restores height, not curvature.)
*File:* `js/diagram-geo.js`, `classifyRounds`.

### 3. The equator is measured from `radiusMax`, which a ruffle inflates

`equatorRound` is the centre of the max-**radiusMax** plateau, and a ruffled round's
`radiusMax` is `radius × (1 + eps)`. On baphomet Arms (`8,16×7,11,11,11`) the plateau is
rounds 2–8, but round 2 is ruffled to `rMax 2.79` against the plateau's 2.55, so the card
prints **eq 0.09 @ r2**. `eq` is systematically off elsewhere too (panda Body 0.43 vs 0.55,
cato Head 0.65 vs 0.50, turtle Head 0.25 vs 0.42).

*Hypothesis:* classification rule — take the plateau from `meanRadius` (or from the count),
not from the lobed `radiusMax`.
*File:* `js/diagram-geo.js`, `classifyRounds` (~line 808).

### 4. `closedBottom` uses `GATHER_COUNT 6` while `closesIn` uses `CLOSE_COUNT 8`, so gathered pieces keep an open hole

`shapeOf` sets `closedBottom = last <= GATHER_COUNT (6)` but `closesIn = last <= CLOSE_COUNT (8)`.
The baphomet Body/Head ends on `Decx8` at 8 stitches and the cato Head at 9: both get the
stuffed slack, and both are left with a 2.5-wide open hole where the yarn was pulled shut.

*Hypothesis:* geometry constant — cap the bottom on the same threshold that decides
"closes in", or better on the gather text (`pull to close`, `Dec×n` as the last round),
which 01 §1.6 already specifies and `classify` still reports as `gather: undefined`.
*File:* `js/diagram-geo.js`, `shapeOf`.

### 5. On a finished piece the last round still wears the working-round glow

The gallery builds every card with `current = rounds.length - 1`, so the finished object
carries an amber/coral marker ring on its final round. On the snowman Hat that paints the
whole flared brim orange; on a 2-round bee wing it recolours **half the object**. In the
app the same is true whenever the user stands on the last round of a completed part.

*Hypothesis:* renderer / app state — a part whose rounds are all done should have no
current round (or the marker should be suppressed at `done === count` on the last round).
*File:* `js/diagram.js` (`MARKER_ALPHA`, the marker ring) plus whoever sets `current`:
`js/store.js buildDiagramModel` and `test/diagram.gallery.html finishedModel`.

### 6. Per-stitch bump amplitude is absolute, so low-count rounds render as cogs and flowers

`BUMP 0.20` / `DIP 0.17` are fractions of **SW**, not of the ring radius. On a 6-stitch
round (r 0.95) that is a 21 % radial wave with 6 lobes; on 4 stitches (snowman Nose, r 0.64)
it is 31 %. Hence the panda Tail's stack of lampshades, the panda Ear's 18-point cog rim,
the turtle Feet's 12-petal star lid and the baphomet Tail's beaded shaft. Worse, the flare
at each band's base overhangs the band below, so every round boundary grows a visible lip —
the "stack of shells" look on the panda Leg and turtle Feet.

*Hypothesis:* renderer / material — taper the bump amplitude with `min(1, r / k)` (or with
`stitchPx`), and keep the band's outer edge from exceeding the band above it.
*File:* `js/diagram.js` (the tuning block, ~lines 98–142, and `prepRound`).

### 7. Straight rounds and increase rounds have different `dy`, so plateaus terrace

An increase round rises 0.56–0.72, a straight round 0.95. Alternating them (snowman Hat
`36,36,42,42,48,48`; cato Horns `5,5,5,10,10,10,15,15`) makes a visible staircase — the hat
is a five-tier wedding cake. It is geometrically honest and it looks wrong; 04 defect J
called for a 3-tap smoothing of `R[]` scaled by how stuffed the piece is, and it is still
not there.

*Hypothesis:* geometry — smooth the radius profile before the walk.
*File:* `js/diagram-geo.js`, `classifyRounds`.

### 8. `stuffed: null` falls through to slack 0 or 0.05 on pieces that are obviously stuffed

`shapeOf` only reaches `SLACK_STUFFED` via an explicit `stuffed === true`, a `cup` form or
`closesIn`. Everything else with `stuffed: null` lands on `SLACK_OPEN 0` or
`SLACK_UNSTUFFED 0.05`: bear Body (0.05, `start unknown`), bear Arms (0.10), snowman Nose
(0), turtle Shell before today's `cup` rule (0). 01 §1.3 says a magic-ring part that closes
to ≤ 8 stitches **or** says "Stuff" is 0.35 — the magic-ring half of that test is missing.
Separately, cato's one-piece **Tail & Body** inherits `stuffed:false` from the tail's "do
not stuff" and renders the body unstuffed too (asp 1.80 vs 2.12).

*Hypothesis:* parser / model — `Store.diagramModel` should scope the stuffing phrase to the
rounds it sits next to, not to the whole section, and `shapeOf` should default a magic-ring
closed piece to 0.35.
*File:* `js/store.js buildDiagramModel` (the `shape.stuffed` detection) + `js/diagram-geo.js shapeOf`.

### 9. Old parser defects F, G and E are unchanged

* **F — zero-count rounds.** snowman Scarf still enters the model as `0, 71, 71`.
* **G — one stray count sets the sheet width.** cato Wings: rows `8,14,13,12,22,21,60` ⇒
  `w 60.00 × h 7.94`, `fitClamp: height`. A median or an outlier drop fixes it.
* **E — back-references.** bear "Second Leg" is still a single round of 8; "work as First
  Leg" is not followed.

*Hypothesis:* parser expansion / model build.
*File:* `js/store.js buildDiagramModel` (F, E), `js/diagram-geo.js classifyRows` (G),
`js/patterns.js expand` (E).

### 10. UK dialect still ignored, and inconsistently

King Cole pumpkins: `Pumpkin Body` rows give `h 3.82` over 2 rows = **1.91 per row**, i.e.
UK `dc` is being priced as US `dc`. The small `Stalk` in the same PDF gives `h 1.90` = 0.95
per row, i.e. US sc. Same stitch word, two heights, one document. `dialectHints` returns
`uk`; `stitchTok` never asks. Every UK pattern is ~2× too tall wherever a row parses.

*Hypothesis:* parser.
*File:* `js/patterns.js` (`stitchTok` / `expand`, dialect plumbing).

### 11. WebGL context loss is silent, and `getStats()` lies about it

With 7 canvases mounted, 4 reported `status:'lost'` after one scroll pass, and the card drew
a plain **white** rectangle on a dark page. `getStats()` still returned
`running: true, fps: 165, triangles: 8670, webgl: false, lost: true`. `js/diagram.js` does
have `webglcontextlost`/`restored` handlers and a 2D outline fallback string
(*"Showing a simple outline — 3D stopped and had to be released"*), but neither the outline
nor any notice appeared. The app mounts one or two canvases so the risk is lower there, but
a user who leaves the app parked will hit it.

*Hypothesis:* renderer + host — report `running: false` once lost, draw the 2D silhouette
fallback, and attempt a remount; the gallery's placeholder should also not be white.
*File:* `js/diagram.js` (`onLost` / `report` / `getStats`, ~lines 2186–2230, 2500) and
`test/diagram.gallery.html` (the `.ph` placeholder).

### 12. App wording and readouts

* **Shape summary says "Dome"** for a 20-round, aspect-1.49, closed-top open-bottom piece.
  A dome is squat; this is an egg. The line should use the same vocabulary as
  `01 §2.1` and could cheaply add the aspect and "open at the bottom".
  *File:* `js/app.js` (the 3D-view header) fed by `DiagramGeo.classify`.
* **"stitch N of 10"** on every round regardless of the round's real count or grouping
  (6-stitch round 1, 24-stitch round 16 in 3 groups, a 405-stitch row). *File:* `js/app.js`.
* **The surplus wedge is right but too quiet** — 3 stitches of 24, in `--danger`, on a black
  band, at 375 px. Consider thickening the wedge or pulsing it; the text
  ("3 more than the pattern's 24") is doing all the work.
* **The ghost cage** draws the remaining rounds wider than the solid piece's last round even
  when the counts decrease, and reads as a stand under the object rather than its
  continuation. *File:* `js/diagram.js` (ghost rings) — worth checking the ghost radius
  against the same `classify` profile the solid uses.

---

## Part 3 — What the rebuild clearly won

Worth saying plainly, because most of this file is complaints.

* **Aspect ratios are now right.** 19 of the 33 round-worked parts land inside 01's ±8 %:
  snowman body 1.56 (exact), baphomet Tail 8.21 vs 8.28, panda Body 1.49 vs 1.48, panda Arm
  3.58 vs 3.53, cato Horns 1.51 vs 1.50, baphomet Horns 2.30 vs 2.28, baphomet Feet 0.75 vs
  0.74, bear Ears, bee small Body, fish Body. 04's "systematically 35–55 % too tall" is gone.
* **The cap is conditional.** `start === 'magic-ring'` drives it; the baphomet Muzzle and the
  snowman Scarf are open, as they should be. 04 defect D is fixed at the top.
* **Ovals work.** The muzzle comes out `kinds {"oval":5}`, `chain-oval / ch10`,
  11.27 × 4.75, open both ends — exactly what 01 §1.5 asked for.
* **Colour works.** `With black,` at the head of a round now resolves: panda Body flips to
  `#1c1c1c` at R15, panda Arm/Leg/Tail are black, panda Eye is black then white, bear is
  `#2b3556`, and all three bee bodies stripe on the right rounds. 04 defect H is fixed.
* **The material is good.** Matte, warm key light, soft creases between rounds, no cracks
  through to the background and no pinecone ridging on the mid-size pieces. On light yarn at
  button size it reads as wool.
* **Today's `formOf` deviation earns its keep.** turtle Shell 0.15 → 0.35, snowman Hat
  0.16 → 0.33, panda Ear 0.44 → 0.51. All three move toward the photograph.
