# Wave E: 3D geometry (`3d-geometry`)

Owner of `js/diagram-geo.js` (now **1.4.0**), `test/diagram.test.html`, `test/diagram.gallery.html`,
`test/diagram-model.test.html` and the diagram-model section of `js/store.js`. I edited store.js
with Edit only; another agent edited the rest of it at the same time. The renderer agent adds its own
block to `test/diagram.test.html` ("Renderer — stitch relief and LOD"), so that file is shared as
well and I used Edit only on it too.

## Suites (all green at hand-off)

| suite | before | after |
|---|---|---|
| diagram (units) | 153 | **191** (38 more: 23 mine, the rest the renderer agent's block) |
| diagram + "Reload reference fixtures" | 180 | **228** (37 reference rows, 10 of them new) |
| diagram-model | 503 | **514** |
| store-safety | 210 | 226 (the other store.js agent added tests) |
| backup | 102 | 104 |
| templates | 94 | 94 |

Heads-up: `js/patterns.js` changed under me twice during the session. Twice `splitSections` returned
one unnamed section for every PDF, and once the hex-socks hexagon parsed to all zeros. While that was
happening, diagram-model showed 3 failures (hex corners, King Cole dialect, cowl round 1 = 185) and the
gallery was empty. Both suites went green again without any change from me once the parser settled.
If a suite goes red on re-run, look at patterns.js first.

## Discrepancy table

| fixture | part / round | PDF / photo says | app said | fixed? | assertion |
|---|---|---|---|---|---|
| Persian Tiles | First Square rnd 4 | fills the rnd-3 fans and steps out one round; photo p.1 is a flat tile, `Square = 5¼"` | rose 1.86 as a dc-high wall, stepping out only 0.48 | yes, fan-and-fill (11) | `redheart-persian-tiles · First Square — every round flat, round 4 steps out of round 3`; unit `Persian round 3 is a FAN and round 4 its FILL…` |
| Persian Tiles | rnd 3 | 4 dc fans on single sc; the petals are scalloped | ring at Σw 48/2π = 7.64, which took rnd 4's whole step | yes, ring drawn at 5.97 (Σw kept) | same two rows |
| Persian Tiles | rnd 5 | sc + ch-3 loops, lies flat | 5-lobe frill (2.3× an sc round's rate) | yes, loop reach (10) | `…rounds 3, 5, 6 stay right…` (fixture and unit) |
| Persian Tiles | rnd 2 | 24 sc BLO around 16 dc, flat | frill (1.34× the circle rate, "spread" so no motif allowance) | yes, a spread round in a prior motif gets POLY_FLAT_TOL | unit `a spread round in a text-prior motif…` |
| Persian Tiles | whole piece | open flat motif | `shallow-bowl`, slack 0.10, read off stitch counts 16,24,36,19,20,31 | yes, open rim also judged by Σw | fixture row (slack 0, form disc) |
| Persian Tiles | rnd 4 kind | square corners | `ring`: count 36→19 read as a "spread increase", sites placed by count (19) not by the 51 records | yes | units `increase sites are placed by record WIDTH…`, `cornerGroups…`, `a lace round whose COUNT falls…` |
| Persian Tiles | finished size | 5¼" | final ring Σw 84 → side 21 widths ≈ 5¼" at 0.25"/sc | unchanged, and asserted | `…the finished size is Σw's` |
| cato | Head 24,24,24,30,36,36,42,42,42 | smooth stuffed ball (p.4) | terraces, worst turn between rounds 43° | yes, terraces (12) | `cato · Head — terraces smoothed…` (43.1° → 30.5°) |
| cato | Horns 5,5,5,10,10,10,15,15 | smooth cones (p.6) | 3-tier pagoda, 45° | yes (30.6°; the 15,15 rim is the widest ring and stays pinned) | `cato · Horns — …`, unit `the cato horn … is a cone…` |
| cato | Tail & Body | unstuffed tail that tapers smoothly into a flat diamond body (p.7) | staircase at 5→10→15 and 30,30,24,24,24 | partly: slack 0.05 → a = 0.29 (yarn share) | `cato · Tail & Body — …` |
| cato | Ears `…21, 21, 2` | open cup, "Sc 2, then FO. Pinch" (p.6) | the stray 2 capped the cup shut and frilled | yes, the store flags a closing round under 1/3 of the one before; geo ignores flagged rounds in shapeOf | ref `cato · ear` (`open`, ruffles 0); diagram-model 13c; unit `a round the store flags…` |
| snowman | Hat 36,36,42,42,48,48,71 | a hat with a flared brim (p.5/6) | 5-ledge wedding cake | yes: wall smoothed, brim kept | units `a stuffed 36,36,42,42,48,48 plateau body…`, `a hat BRIM is kept…` |
| snowman | Scarf `R1: Ch71, turn` | 70 × 3 strip | after the parser's 0→71 fix it drew as a 70-around tube (aspect 0.126) | yes, `R` lines that turn the work are rows | ref `snowman · scarf`; diagram-model 13c |
| Stylecraft hood | Motif | UK leaflet, trebles = US dc | measured at US tr (2.68) because the part had no dialect | yes, dialect seeded like the importer does (task 3) | ref `stylecraft-hood · motf — measured in its own dialect`; `priorFlat` now gated |
| bear | Body (grown out of the head) | stuffed barrel (p.1, p.5 G/H) | slack 0.05 (no start ring, text silent), ruffled 18→36 hdc | yes, a piece that turns back in by ≥ 20% with the text silent is stuffed | ref `bear · body — barrel` (aspect 0.84, 01 wants 0.78 ± 8%) |
| bear | Arms 6,9,9,9,8,6 | tapering tube (p.6 L; photographed flattened, unstuffed) | `shallow-bowl` | yes, a 2+-round wall is not a bowl (aspect 2.62, 01 wants 2.65) | ref `bear · arms`; unit `a tapering tube with a 3-round WALL…` |
| all fixtures | chain records | a chain is a space, h 0 (01 §1.2) | store's `posNum(h, 1)` turned every ch into a 1-sc-high stitch | yes (`diagramStitchH`) | diagram-model 13c; unit `a chain is a SPACE…` |
| all REF rows | reference harness | the store's outlier flag | `finishedModel` dropped `outlier`, so bridged rounds were drawn in the test | yes | carried into every ref row |
| bear | Second Leg | "work the rest the same as the first" | 1 round | **no**, parser (cross-section back-reference) | — |
| Persian Tiles | Second Square | "Rnds 1-5: Work same as First Square" | 0,0,0,0,0,3 | **no**, parser | — |
| Persian Tiles | Border | 3 rounds | 22, 1 | **no**, parser | — |
| cowl-mitts | Cowl | `Rep Rnd 2 until 28 cm` | 1–2 rounds (the parse moved between 23, 185 and 240 during the session) | **no**, parser/gauge | — |
| kingcole pumpkins | Body / Stalk | ~44 BLO rows, "work until it measures" | 2 / 4 rows | **no**, parser/gauge | — |
| cardigan | Sleeves | 58 → 34 over 49 rounds | 1 round | **no**, parser | — |
| cato | Wings (rows) | fan, then a frill | a 60-wide sheet (06 defect G) | **no**, rows mode has no frill model; out of scope this wave | — |
| baphomet | Tail | hangs (01 §4.1) | a rigid straight whip | **no**, accepted simplification | — |

Everything else in the gallery matches its 01 §2 class and aspect band: panda, turtle, fish, bee,
baphomet, the hex socks when the parser gives its rounds, the wrap, the throw and the Amarah shawl.
The rows and the review wording from 06/07 still hold. I read the photos in the Persian Tiles, cato
and bear PDFs page by page. The other fixtures were judged against 06/07's photo reviews and the
card numbers, because the Browser pane was hidden and could not take screenshots (renderer-only
defects are listed under "For the owner of js/diagram.js").

## Task 1: why the fix is not "the corner group adds the space's width"

The brief suggested this rule: "a corner group worked INTO one space adds its own widths on top of
the space's width". I checked it against the physics and it double counts. The parser already gives
round 4's corner group `(sc, ch 2, sc)` its full 4 widths (the sc share the 3-wide space, capped at 1
each, and the corner chains stand beside it). Round 4's Σw of 51 is exactly what a flat square of
sc + dc + sc + dc rounds predicts from the heights alone: inradius a ≈ 6.36 widths, so P = 8a = 51.9.
Adding the space's 3 widths again would give 64, a square about 3.4 sc-heights further out than
round 4 is tall.

The widths were never wrong. What was wrong is the ring the fans got. Round 3 grows 24 widths over
the 24 sc it sits on, which is 1.57× what a dc round can lay flat. That surplus is scallop (four
petals), not radius. Drawing round 3 at Σw/2π gave it the whole step of both rounds, and round 4 had
to stand up as a wall.

So the rule is (11) below. It gives rings 3.82 → 5.97 → 8.12, and 5.67 / 8.10 is where the height
arithmetic puts them. Round 6 keeps its own Σw (84, side 21 widths ≈ the printed 5¼"), so the
finished size does not move.

## Rules added (js/diagram-geo.js 1.4.0; each is documented at its constant)

1. **(10) Lace loops arch.** A run of `ch` records at `LOOP_W` (= `Patterns.LOOP_CHAIN_W` 0.75) is a
   loop. It reaches `anchor h + loopSag(n)/SH_SC` past the stitch that closes it, where
   `loopSag = √(3c(L−c)/8)` (0.80 for a ch-3). This applies only when loops are ≥ 10% of the round's
   width, and it never lowers a round.
2. **Sites by width.** `sitePositions` places increase sites by the widths of the records before
   them, around the round's own record width. For one-wide stitches this is identical to the old
   (index, count). The store's `siteCorners` mirrors it (`sitePlaces`).
3. **Not a spread increase:** a round whose count fell, or whose increase groups hold a chain run
   (`cornerGroups`: `inc … ch … inc+`). The store mirrors this (`cornerGroupCount`; a count-falling
   round is neither a corner nor a circle).
4. **A spread round in a text-prior motif** keeps kf 1 but gets `POLY_FLAT_TOL` before it may frill.
5. **(11) Fan-and-fill** (`fanFill`). A round over its own k-gon reach, followed by one under
   `GRANNY_FLAT` of its reach, whose pair lands within `GRANNY_FLAT`…`POLY_FLAT_TOL` of the combined
   reach: the pair shares its step by reach, and only the fan's ring moves (inward). Steady grannies
   (hood, hex socks) and plain rings are never touched.
6. **Open rim by Σw too** (`shapeOf`). A lace motif whose stitch count falls while its fabric grows
   is open, not a "shallow bowl".
7. **(12) Terraces** (`terraceSmooth`, `TERRACE.alpha` 0.5 at full stuffing, `TERRACE.yarn` 0.5 of
   that at slack 0). A 3-tap filter on the ring at each corner of a monotone run that has
   ≥ `TERRACE.minTreads` (2) treads of 1–`TERRACE.flatMax` (3) straight rounds. A plateau longer than
   3 rounds is a wall and is left to the fillet.
   - **Never moved:** the widest ring, run ends (which is what makes a neck or a waist safe),
     ruffled / flattened / polygon / oval / granny / fan rounds (hat brims, flared rims), and
     text-prior motifs.
   - **Height kept:** each run's rise is handed back, so height, width, aspect and equator are
     unchanged.
   - **Switch:** `classify(model, {terrace: false})` turns the pass off, and the tests compare the
     two.
8. **Outlier rounds are not fabric in `shapeOf` / `countProfile`** (they were already bridged in
   the walk).
9. **A wall is not a shallow bowl:** `cp.straight < CUP_STRAIGHT` is now required.
10. **Silent stuffing:** an `open` piece that grows and turns back in to ≤ `OPEN_TURN_IN` (0.8) of
    its widest, with `stuffed === null`, gets `SLACK_STUFFED`. "Do not stuff" still wins.

Store diagram-model section:

- `diagramStitchH` keeps a chain's h 0.
- `flagOutliers` flags a last round under a third of the one before it. No decrease takes more than
  3 stitches into 1.
- `turnedBareRows`: bare `R<n>` lines that turn the work are rows, unless the text says `Rnd`/`Round`.
- The site mirrors listed above.

Test harness: `finishedModel` in `diagram.test.html` now seeds `Part.dialect` exactly as
`importPatternSections` / `lendDialect` do and carries the store's `outlier` flag. The gallery's
`makePart` seeds the dialect too and prints it on each card.

## New fields (additive, no contract change)

Per round from `classify`: `radiusCount` (Σw/2π), `fan` / `fanShift`, `loop`, `kf`, `terrace`.
Per piece: `terrace` {applied, alpha, runs, rings, maxShift}, `fans`. Exports: `LOOP`, `TERRACE`,
`OPEN_TURN_IN`, `loopSag`, `sitePositions`, `cornerGroups`, and `classify(model, {terrace})`.
`radius` may now differ from Σw/2π on a fan ring and on a terrace corner, just as the fillet's radial
ease already could. Bands are still `rTop`/`rBot` from `radiusDraw`.

## Still wrong, and why

- **Terraces at a max-radius rim** stay stepped. The cato horn's 15,15 is its widest ring, and the
  widest ring is pinned because the width and aspect are measured on it.
- **Unstuffed staircases** (cato Tail & Body) are only smoothed at the yarn share (a ≈ 0.29).
- **Loop height is a first-order sagitta.** It is right for ch-3 loops closed by sc. Long loops
  over tall anchors are untested.
- **The bear Arms are photographed unstuffed and pressed flat.** The model now calls them a stuffed
  tube (0.35 against 01's 0.25). The aspect is right, the attitude is not.
- **The parser items in the table.**

## For the owner of js/patterns.js

1. `workMode` counts a bare `R1:` as a round even when every R line says `turn` (snowman Scarf). I
   worked around it in the store (`turnedBareRows`); the parser is the right home for it.
2. Cross-section back-references are not followed: bear "Second Leg … work the rest the same as the
   first (Rounds 1-5 above)", and Persian "Second Square — Rnds 1-5: Work same as First Square".
3. Persian Border reads `22, 1`. Cowl `Rep Rnd 2 until cowl measures 28cm` and pumpkins "until it
   measures" are gauge repeats. The cardigan Sleeves read as one round.
4. `splitSections` and the hex-socks expand were unstable during this wave (see Suites).

## For the owner of js/diagram.js

- Chain records now reach the renderer with `h: 0` (they arrived as 1 before). Your relief block
  already treats `ch` at h 0 as a hole or strand; check that nothing else divides by a record's `h`.
- A fan round (Persian rnd 3) now has a Σw of 48 laid on a 37.5-long ring, so `arcSlices`
  compresses its stitches to about 0.78 of a width. That is honest (the petals are scalloped), but a
  per-stitch bump sized off `w` will look crowded there. `e.fan` / `e.radiusCount` are available if
  you want to ruffle it instead.
- Renderer-only defects I could not judge because the pane was hidden (06 defects 5, 6 and 11):
  last-round glow on finished pieces, bump amplitude on 4–6-stitch rounds, and silent context loss.
  I made no changes to them.

## Coordinator decisions

- Task 1 was fixed with a different rule than the brief proposed. The reasoning is above; please
  confirm you are happy with it.
- The two new slack rules (6: open rim by Σw; 10: silent stuffing) move pieces between forms. Only
  the bear Body/Arms and Persian changed in the corpus, and every 01 §2 aspect is still in band.
- `turnedBareRows` sits in the store for now. Move it into `Patterns.workMode` if the parser owner
  agrees.

## Follow-ups (coordinator, after the renderer agent's report)

1. **`post` / `lp` pass-through** (`js/store.js` `buildDiagramModel`). A stitch record now carries
   `post: 'front' | 'back'` and `lp: 'blo' | 'flo'` when `Patterns.expand` sends them. An absent or
   unknown value adds no key, so a plain stitch is still exactly `{t, c, h, w}`. Asserted in
   diagram-model 13c with a synthetic expand (front, back, blo, flo, plain, and junk values).
   `everyStitchWellFormed` now accepts `h: 0` on a `ch` record (a chain space) and nowhere else.
2. **Gallery context loss** (`test/diagram.gallery.html`). Every card now passes an `onStatus`
   (`cardStatus`). A card without WebGL shows the renderer's message on the card instead of a white
   rectangle. On `lost` or `blank` it remounts once on a fresh canvas (`CARD_REMOUNTS` 1, the same
   single retry as the app viewer). `unmountCard` now destroys with `{release: true}`, since its
   canvas is always replaced, which gives the context back to the browser when the LRU trims.
   Verified in the pane by forcing `WEBGL_lose_context`: the first loss remounted a live context; a
   second loss showed "lost: Showing a simple outline…" and did not loop.
3. Two diagram-model expectations moved with the parser, not with my code:
   - **Cardigan swatch:** it now parses as 18, 18 plus twelve 2s. The assertion keeps the review's
     first six rows and checks the rule itself: every 2-wide row flagged, no 18 flagged.
   - **Turned rounds:** `Patterns.workMode` now reads `Rnd 1 … R2 … turn` as rows, so the "turned
     rounds are still rounds" check uses `Rnd` on every line, which is unambiguous. **For the parser
     owner:** a round that is joined and then turned is still a round.

Suites after the follow-ups: diagram 193 unit / 230 with reference fixtures; diagram-model 517;
store-safety 226; backup 104; templates 94. All 0 failed.

## Follow-ups 2 (workaround removed, printed vs computed counts)

1. **Store-side Scarf workaround removed.** `turnedBareRows` and its three regexes are gone from
   `patternWorkMode`; `Patterns.workMode` now owns "unjoined `R1: … turn` = rows". The snowman
   Scarf reference row still passes as a rows piece: 3 rows, 71 / 70 / 70, kinds `{row: 3}`,
   aspect 0.04 against a band of 0.02–0.09. The diagram-model 13c Scarf assertion now exercises the
   parser end to end.
2. **Printed vs computed counts.** `Store.roundDeviation` returns two more fields, `printed` and
   `computed`. They are non-null only when a round's printed total and the count its own
   instructions make disagree. `expected` stays the PRINTED count, because the pattern is quoted,
   never corrected. Model rounds carry the same pair. The shared `countCheck` reads, most specific
   first:
   - `printed` / `computed` on the `expand` round record. This is the shape the crochet agent is
     adding; it was **not** in `js/patterns.js` when I read it, so the read is tolerant and is
     covered only by a stubbed expand.
   - The same two names on the parse line.
   - The parse line's current spelling: `stitches` = printed, `computed` = evaluated. This is
     already live for Baphomet R29, which prints 36 and computes 24.

   After the parser landed (18:06), the real fixtures read: Baphomet R29 printed 36 / computed 24,
   Cato Feet R3 printed 18 / computed 3 (`(Sc, Inc)` once). Both come from the parse line;
   `expand` records still carry no pair, so that read stays tolerant. Asserted in diagram-model 13c:
   - a printed 36 against 24 computed, with expected staying 36;
   - an agreeing round reports no pair;
   - the model round carries the pair;
   - an expand-record pair is read.

   The three older `roundDeviation` shape assertions now include `printed: null, computed: null`.
   The change is additive for `js/app.js`.

Suites after follow-ups 2: diagram 193 unit / 230 with reference fixtures; diagram-model 521;
store-safety 226; backup 104; templates 94. All 0 failed. A run in the middle of a `js/patterns.js`
save showed transient failures (the sphere test reading 0,0,0,5, and a 63 ms build timing); a clean
re-run after the file had sat still for 90 s was green.
