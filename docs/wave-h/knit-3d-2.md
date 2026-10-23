# Wave H — knit-3d-2: cables, the cabled yoke and the back-neck wedge in the 3D diagram

Owner of `js/diagram-geo.js` (now **1.6.0**), `js/diagram.js` (now **1.7.0**), the `// knit` block of
`test/diagram.test.html` and its knitting fixture rows, `test/diagram.gallery.html`, a new helper
`test/diagram.knit-synth.js`, and the diagram-model section of `js/store.js` (Edit only; the parser
and extractor workers edited `js/knits.js`, `js/patterns.js`, `js/pdftext.js` at the same time and I
did not touch them).

Built against the batch-2 fixtures in `docs/research/knitting.md` §9–§13: the Patons mock neck,
boyfriend, boxy and cabled-yoke pullovers and the Sandnes top-down raglan.

## What the user sees

### Cabled flat pieces (mock neck, boyfriend, boxy)

- **Cables are columns.** A cable panel shows as a raised column that twists at the pattern's
  cadence. The mock neck's Back shows its seven panels side by side, C·B·C·A·C·B·C:
  - Panel C is a rope: C6F on row 3, C6B on row 9, every 6 rows.
  - Panel B is diamonds.
  - Panel A is interlaced travelling stitches.
- **Before:** the cable panels were invisible at any normal zoom. Each crossing row was also
  narrower than the plain rows around it, so both side edges were ragged every 2 rows.
- **The fabric pulls in under the cables.** A cable column is drawn at cable gauge (0.85 a
  stitch) from the panel's first plain row to its last, not only on its crossing rows. The mock
  neck's 144-stitch body draws 130.2 wide on every pattern row, all alike, against 144 in
  stockinette. Its 130-stitch k2p2 rib draws 104.
- **The twist window adapts to the cadence.** A crossing's twist covers the rows around it, up
  to half way to the next crossing in the same columns:
  - A lone crossing, or a C6 every 6 rows, leans over 2 + 1 + 2 rows, then runs straight.
  - A T3F / T3B every RS row tiles its 2 rows exactly, so a travelling stitch is one continuous
    diagonal.
  - Lace, a bind-off or a rib row in the cable's columns ends the window.
- **Each crossing has its own shape.** The front group is always on top, travelling left for
  F / LC and right for B / RC. What changes per type is how wide that front group is and how
  many knits stay in the back group (the rest of the back group is purl ground):

  | Crossing | Front group | Back group |
  |---|---|---|
  | C4F / C4B, C6F / C6B | 2 / 3 knits | 2 / 3 knits |
  | Mock neck T3F / T3B, T4F / T4B, C3FP / C3BP | 2 knits | purl only |
  | Boyfriend T3F | 1 twisted stitch | a K1tbl and a P1 |
  | T2F / T2B | 1 | purl only |
  | Cr4F / Cr4B | 1 | 3 knits |
  | Tw4R / Tw4L | 2 | a knit and a purl |
  | C3FK / C3BK | 2 | 1 knit |
  | Cr5B | 2 | 3 knits |
  | Cr7B / Cr7F | 3 | 3 knits, with the purl between them |

- **The pattern's own definition wins over the name.** The store reads it from the abbreviation
  block. The boyfriend's "T3F = Slip next stitch … K1tbl, P1, then K1tbl from cable needle"
  draws as 1 over 1. The mock neck's "Slip next 2 … P1, then K2" draws as 2 over a purl.
- **Cables stay visible zoomed out.** At the lowest level of detail (2–3 px a stitch: a phone
  viewer, a gallery card) a cable and a rib keep their own relief and cavity shading instead of
  the generic bump.
  - Checked at 375 × 560 at 2.6 px a stitch: the ropes, diamonds and centre panel all read.
  - The seam between the rows of a twist is gentler, so a twisting strand no longer shows a dark
    notch at every row edge on the silhouette.

### The cabled round yoke (Patons Cabled Yoke)

- **Bottom Yoke:** 216 picked up, worked down to 284, then divided to 184. It reads as a yoke:
  - The divide may now be the part's last round, because the Body is its own section.
  - The front and back meet the body radius.
  - The sleeve tops (out to 54) fall away 21.
  - No frills.
  - **Before:** the divide had to be followed by 2 body rounds, so this part was a flat cone.
- **Top Yoke:** "pick up and knit 198 sts around **top** edge of Cable Yoke" now means the piece is
  worked up, so it is drawn with its first round at the bottom. It reads as a wide yoke
  narrowing 198 → 90 into a funnel collar. Its C4B crossings run as 18 continuous cable columns,
  crossing every 5 rounds (4, 9, 14, 19, 24, 29).
  - Columns are matched as a fraction of the round, because the P2tog decreases between the
    cables shrink the round.
  - **Before:** it was drawn the other way up, with the cables smeared into single rows.

### The Sandnes top-down raglan (children's and ladies' groups)

- **The back neck sits higher than the front.** The 6 German short rows are a **wedge**, not a
  heel:
  - The worked side gains their height across the tube's diameter (a 14.5° tilt for 2 yrs,
    10.1° for ladies S).
  - The longer stretch after them (the yoke) stands upright, and the neck rib carries the tilt.
  - The back neck edge is 3.05 above the front (children) and 2.86 above it (ladies).
  - **Before:** the 6 short rows were read as a heel. The yoke below bent 29° sideways and was
    never recognised as a yoke, so the whole piece was a tilted lampshade.
  - A run of at most 12 partial rows is a wedge. The sock's 42-row flap and turn is still a 90°
    heel.
- **The raglan yoke widens and divides.**
  - Children: 56 → 144 → 92. Ladies: 80 → 216 → 132.
  - The yoke's long axis (the sleeves) lies across the wedge, so the raised side is the back.
  - The ladies' "k 1 rnd, inc 16 evenly" after the rib flares instead of frilling. A knitted
    increase round now frills only when it is past both 2× the flat rate and 25% of the round
    before it.
- **Short rows are no longer misread counts.** A short row is a few stitches of the ring (the
  first is 5 of 56). The store used to flag it as a misread count and drop it.

Crochet is unchanged, byte for byte. I compared the committed 1.5.0 / 1.6.0 against these
versions on every crochet reference section cached on the test page (162 models in three modes):

- layout JSON;
- prepared-round hashes;
- every stamp at all 4 tiers (3624);
- 572 built bands' vertex buffers.

There were 0 differences.

## Contract (additive; nothing renamed)

### Model records (`js/store.js`, diagram-model section; knitting only)

- A cable record (`t: 'cable'`) may carry:
  - `cf`: knit stitches in the front group;
  - `cb`: knit stitches left in the back group;
  - `name`: up to 8 characters, e.g. `T3F`.
- The store fills these in `knitNameCables`, in this order:
  - **The name.** Knits' own `name` if it sends one. Else the n-th crossing of that width and
    direction named in the row's text. Else the only cable of that width and direction the
    pattern defines.
  - **The groups.** Read from that name's definition (`knitCableDefs`): which group was held, in
    front or behind, and the K/P counts worked off each needle.
  - The definitions come from the part's text, the project's notes and the sibling parts.
- `shape.upsideDown: true`, `upsideDownSource: 'text'` (knitting only, and only when nothing set it
  already): the text picks up along a **top edge** or says "worked up(ward) in the round".
- A round with `shortRow` and `side` in a rounds piece is never left flagged `outlier`.

### DiagramGeo 1.6.0

- **`knitCables(rounds, mode, base)` → `{tw, pull, columns, crossings}` or null.**
  - `tw[row][slot]` is a slot's twist: `{phase, lo, len, sub, n, cross, f, kb, uflip}`.
  - `pull[row][slot]` is `1` when the slot is in a cable column.
  - `columns` lists the cable columns (their x range and rows).
  - `crossings` lists every crossing with its window.
  - Columns are matched about the row centre (flat) or as a fraction of the round.
- **`cableShapeOf(name, n)` → `{f, kb}`**, the default when the pattern defines nothing.
- **`KNIT`** gains `cableTw`, `cableGap`, `cableW`, `wedgeRows` and `wedgeMax`.
- **`cls.knit`** gains:
  - `cables`, the number of crossings;
  - `wedge: {rows, phi, th}`.
- **Bends and the yoke:**
  - each bend now has `wedge` and `th`;
  - the yoke has `axis`;
  - `warp.yoke.ax` is set.
- **The sleeve-top droop now runs before any bend** in `warpPoint`. Nothing used both before.

### Diagram 1.7.0

- `knitTwists` delegates to `DiagramGeo.knitCables`.
- `prepKnitRound` takes a `pull` row and draws those slots at 0.85.
- `knitDescOf` / `reliefCable` draw the front group `f` and the back knits `kb` over the window
  `lo` / `len`. Inside the window, purls in the cable's columns are the cable's own ground, so the
  cable stays one surface.
- At tier 0 a knit cable or rib keeps its relief (`KNIT_LOW_GAIN` 1.8) and its cavity AO.
- New test hook use: `Diagram._relief.stamp`, which already existed.

## Tests

| suite | before | after |
|---|---|---|
| diagram units | 241 | **259 / 0** |
| diagram + reference fixtures | 283 | **309 / 0** (crochet 37 + earlier knitting 5 rows unchanged, +8 batch-2 rows) |
| diagram-model | 529 | **529 / 0** |
| store-safety | 307 | **307 / 0** |
| backup | 205 | **205 / 0** |
| templates | 147 | **147 / 0** |
| crafts | 124 | **124 / 0** |

**New unit checks (18)**, in group "cabled panels, every crossing type, the cabled yoke, the
back-neck wedge" plus 4 end to end:

- Cable shapes from names.
- Mock neck Back:
  - the seven panels as columns, nothing outside them;
  - Panel C's cadence (3, 9, every 6, F/B in turn);
  - Panel A's tiling windows (132 of 150 travelling crossings on a 2-row window, the rest
    bounded);
  - the pull-in (130.2 on every pattern row vs rib 104), and the renderer's matching 0.85 slice
    weight.
- 22 crossing types, each with its front group on top, travelling the right way.
- Mock neck T3F vs boyfriend T3F.
- Cable relief kept at tier 0, with crochet's sc bump still 1.6.
- Bottom Yoke, Top Yoke, Sandnes children and ladies.
- The sock heel still a 90° heel.
- End to end through Knits:
  - definitions → `cf` / `cb` (T3F 2/0, T3B 2/0, Cr7F 3/3, boyfriend T3F 1/1, an undefined C4F
    left to its name);
  - the renderer's Cr7F slices;
  - a short-row back neck read as a wedge with the yoke dividing on its last round;
  - a top-edge pick-up flipped and a bottom-edge one not.

**Fixture rows (8)** run on the real PDFs:

- One row checks that every section of the five lays out as knitting and finite.
- Seven reference rows. Each runs on `Knits.expand` output when Knits reads that part whole (the
  qualifying test is in the code), else on the synthetic model. The detail line says which one
  ran and what Knits reads today.

**Which references are on Knits output and which stayed synthetic** (checked at the end):

| reference | source | why |
|---|---|---|
| Cabled Yoke · Top Yoke | **Knits** | Knits reads 198, 189 … 90 with C4B on rounds 4, 9, 14, 19, 24, 29, giving 18 cable columns. Flipped, funnel, cadence 5 all pass on the real parse. |
| Mock neck · Back | synthetic | Knits reads Back as 130, 130, 144 and stops. "Work 1st row of Panel Pat C" is not expanded, so no cable records. |
| Boyfriend · Front | synthetic | No cable records; the panel references are not expanded. |
| Boxy · Front | synthetic | No cable records; the panel references are not expanded. |
| Cabled Yoke · Bottom Yoke | synthetic | Knits reads 12 rounds with zeros (0, 224 … 248, 0, 8, 268, 276, 0, 0). |
| Sandnes Yoke [children] | synthetic | The groups are split, but after the increase round the rounds read 0, and there are no short-row rounds. |
| Sandnes Yoke [ladies] | synthetic | Same as children. |

The synthetic models (`test/diagram.knit-synth.js`, `window.KnitSynth`) are built from research
counts, never from a pattern's wording:

- the panel widths and crossing rows;
- the cast-ons and increase cadences;
- the short-row turning points.

## Verified in the pane

My own tab, a 1000 × 800 viewer overlay (`fitPurpose: 'viewer'`), a 375 × 560 overlay, and the
gallery's 220 × 260 cards.

- **Mock neck Back.**
  - Before: a plain grey sheet, edges ragged every 2 rows, no cables visible.
  - After: the seven panels read as ropes, diamonds and a centre panel, and the edges are
    straight. At 375 wide (tier 0) the panels still read.
- **Cable swatch, 8 types side by side.** Each strand pair crosses on top, the right way. The
  thin "lip" a wider last row used to make is gone, because the columns now pull in to the end
  of the piece.
- **Sandnes children.**
  - Before: a lampshade cone skewed 29°.
  - After: a tilted neck rib on an upright yoke whose sleeve tops droop.
  - Gallery: next to the cover photo (p1) and the pattern page.
- **Cabled Yoke Top Yoke (real Knits parse).**
  - Before: denser dark notches, and the cables smeared into single rounds.
  - After: a funnel with continuous cable columns.
- **Cabled Yoke Bottom Yoke (synthetic).** A wide, flat saddle whose sleeve sections droop.
- **Gallery** (`test/diagram.gallery.html`):
  - New chips: patons mock neck, boyfriend, boxy, cabled yoke, sandnes top-down raglan.
  - Each shows the SYNTHETIC reference card(s) first, then the Knits sections, beside the PDF
    pages. The chart pages are p4 / p5 / p5 / p3, and the Sandnes cover is p1.
  - Each card's "shape class" line now prints what the knitting path did: crossings, wedge,
    bends, yoke.

## Still wrong / left, and why

- **Most batch-2 references are synthetic** until Knits expands panel references and the Sandnes /
  Bottom Yoke rounds (table above). The fixture rows switch over by themselves once Knits reads
  the part whole.
- **The Bottom Yoke's sleeve sections are pointed wings.**
  - The stadium cross-section with a 40° droop is the same cosmetic model Bernat uses.
  - For a yoke 13 rounds deep whose band edge is wider than the body, it reads as a saddle
    rather than shoulders.
  - The Yoke Cable band (flat, 30 sts × ~280 rows, sewn into a ring) is still drawn as a long
    flat strip. It is not wrapped into its ring.
- **The Sandnes neck rib is drawn its full 7 / 9 cm.** The pattern folds it in half to the WS at
  finishing.
- **Some dark ticks remain on the silhouette of a decreasing cone** (Top Yoke) at round
  boundaries. Most are pre-existing knit band shading; there are fewer than in 1.6.0.
- **Wedge geometry is a tilt.** The tilt is taken at the centre of the short rows, not a
  per-column height field as rows mode has. Short rows that go past the half-back (ladies, ±17)
  are drawn with the same tilt.

## For the owner of js/knits.js / js/patterns.js (knits-parser)

1. **Carry the cable's name on its records.** `recordsOf` already has `o.name` on the op (`T3F`,
   `CR7B`, …) but writes only `cross` / `span` / `at`. A `name` per record — and `cf` / `cb` if
   the parser reads the definition itself — would let the store skip guessing from the row text.
   The store and DiagramGeo already read `name`, `cf` and `cb` when present.
2. **Panel references.** "Work 1st row of Panel Pat C" (mock neck, boyfriend, boxy) should expand
   to that panel row's stitches, crossings included. The panels themselves (`Panel Pat A (worked
   over 24 sts)`, `1st row: …`) currently become rows of the garment part: a probe text read the
   Panel C definition as rows 1–12 of the piece.
3. **Short rows inside rounds.** German short rows numbered "Short row 1–6" collide with round
   numbers and are lost. "Row 20 … 25" works.
   - Sandnes prints no numbers at all: "k(5) 6 (7) … turn … p(9) …, turn …" then "Work and turn
     2 sts pass previous turning until a total of 3 times at each side".
   - The 3D needs 6 short-row rounds with their stitch counts (5, 9, 11, 13, 15, 17 for 2 yrs)
     and `shortRow` / `side`.
4. **Sandnes Yoke / Cabled Yoke Bottom Yoke** read 0 for most rounds today. The raglan increase
   "Rep inc on alt rnds a total of (11) …" and "Rep last rnd 2 ( 7-…) times more" carry the
   counts.

## For the owner of js/store.js outside the diagram section (shell / knit-counter)

- None required. The outlier exemption for short rows is inside `buildDiagramModel`.
- The counter may want the same `knitCableDefs` reading for its "cable in 3" ring. It is a
  private helper in the diagram-model section today; I can export it if asked.

## Contract changes

None to binding names. Everything additive:

- **Store records:** `cf`, `cb`, `name` on a cable record.
- **Store shape:** `shape.upsideDown` from a top-edge pick-up (knitting only).
- **DiagramGeo exports:**
  - `knitCables`, `cableShapeOf`;
  - `KNIT.cableTw`, `cableGap`, `cableW`, `wedgeRows`, `wedgeMax`.
- **Layout fields:**
  - `cls.knit.cables`, `cls.knit.wedge`;
  - `bend.wedge`, `bend.th`;
  - `yoke.axis`, `warp.yoke.ax`.
- **Ruffle rule:** an increase round in a knitted piece frills only past both thresholds
  (it used to be either).

## Second pass: real `Knits.expand` output, and `live: 0` as unknown

The parser now reads the batch-2 parts whole (docs/wave-h/knits-parser-3.md). Two changes followed.

### 1. Which references now run on Knits output

The batch-2 fixture rows now read each fixture the way the app imports it: one project whose parts
are the sections, in order.

- **The project's mode** is the majority of the sections' own `Knits.workMode`.
- **The cable definitions** are read with the document's abbreviation block available as the
  project's notes.

| Reference | Source now | Notes |
|---|---|---|
| Cabled Yoke · Bottom Yoke | **Knits** (flipped by itself) | 216 → 284 → 184. The divide is the last round; the yoke shape needed no change. |
| Cabled Yoke · Top Yoke | **Knits** | Already switched in the first pass. 198 → 90, C4B on rounds 4/9/14/19/24/29, 18 columns. |
| Sandnes Yoke · children | **Knits** (flipped by itself) | 6 short rows (5, 9, 11, 13, 15, 17). The back neck sits 4.23 above the front; the yoke divides on round 29. |
| Sandnes Yoke · ladies | **Knits** | 9, 17, 20, 23, 26, 29. The back neck sits 4.28 above the front; the divide is round 41. See note below. |
| Mock neck · Back row 1 | **Knits** (new row) | See below. |
| Boyfriend · Front row 1 | **Knits** (new row) | See below. |
| Boxy · Front yoke row 1 | **Knits** (new row) | See below. |
| Mock neck · panels over the Back's height | **synthetic** | Knits gives each piece only one or two pattern rows. "Cont in pat … until work measures 15½"" is a single line, not 86 rows of panel cadence, so the cadence over rows can only be checked on the research-count model. |
| Boyfriend · panels over the Front's height | **synthetic** | Same reason. |
| Boxy · panels over the Front's height | **synthetic** | Same reason. |

Sandnes ladies needed the project mode to come from the whole document: `Knits.workMode` returns
null for the ladies Yoke section (and 'rows' for the children's).

The three new row-1 checks:

- **Mock neck Back, row 1** (144 sts): Tw4R, Tw4L, T3F, T3B ×3, Tw4R, Tw4L.
  - Shaped by the pattern's own definitions: Tw4R / Tw4L 2/1, T3F / T3B 2/0.
  - Every crossing sits inside its Panel B or A columns.
  - 34 slices are drawn as twist.
  - The row is drawn 138.9 wide.
- **Boyfriend Front, row 1** (81 sts): Cr4F, Cr4B, T3F, Cr4F, Cr4B.
  - Shaped: Cr4F / Cr4B 1/3, and its own T3F 1/1.
  - The row is drawn 76.7 wide.
- **Boxy Front yoke, row 1** (115 sts): Cr5B ×2, shaped 2/3, drawn 113.5 wide.

**Fixes the real parse needed:**

- **Cable records without `at`.** Knits writes an expanded panel row's cable as one record per
  stitch with `span` and `name`, but no `at` (`panelRecords` in js/knits.js drops it). Each such
  record was counted as a whole cable: the mock-neck row read 178 stitches instead of 144, and no
  crossing was found.
  - New `knitCableAt` (store, diagram-model section) numbers runs of identical cable records,
    `at` 0 to span−1.
  - Now 144 stitches and 10 crossings.

### 2. `live: 0` means unknown, never an empty ring

- **A part with no cast-on** starts on the last count of the part before it in the project
  (`knitCarriedCount`).
  - It is not carried when the previous part ended bound off, ended on a short row or a countless
    row, or is longer than its model window.
  - The part before contributes to the cache key (`knitPrevKey`), so its edits rebuild this part.
  - Example: boyfriend Sleeves (continued) now carries the 43 stitches Sleeves ended on and draws
    41, 41, 39 … 9. Before, every row was 0.
- **A row that says something but comes back `live: 0` with no records** is treated as unknown.
  - It keeps the row's printed count when there is one. Otherwise it carries the count before it.
  - Either way it is marked `countless`, unless a printed count sized it.
  - The same applies to a round with no row of its own once a start count is known: Sandnes
    "Back and Front" ("= 92 sts.", then "Cont St-st in rnds until 32 cm") draws one round of 92,
    marked countless.
  - With nothing to carry, the rows stay at 0 and are marked countless.
- **Assertions:**
  - Unit level (through Knits): a part that follows "CO 40 / Knit / Purl" draws 38, 38, 36. On its
    own, its rows are `0?` (countless).
  - Fixtures: boyfriend Sleeves (continued) has no countless rows and none at 0; boyfriend Shape
    Neck's rows after "Fasten off" carry 2 and are countless, and none is empty; Sandnes Back and
    Front is 92, countless.

### Tests (second pass)

| suite | count |
|---|---|
| diagram units | **260 / 0** (+1) |
| diagram + reference fixtures | **316 / 0** (+7) |
| diagram-model | 529 / 0 |
| store-safety | 307 / 0 |
| backup | 205 / 0 |
| templates | 147 / 0 |
| crafts | 124 / 0 |

No console errors. Crochet is still byte-identical: the new store paths run for knitting only.
For crochet, the cache key only gains an empty `|` segment.

### For the owner of js/knits.js (second pass)

1. **`panelRecords` copies `cross`, `span` and `name` but not `at`** onto a panel's cable records.
   The store repairs this now, but `at` should come from the parser.
2. **`Knits.workMode` misreads the Sandnes Yoke sections.** The children's returns 'rows' (the
   German short rows' `turn`); the ladies' returns null. Both are "Join and work … in rnds".
3. **The Sandnes size-group labels** came out "Ladies" on the children's page and "S–XXL" on the
   ladies' page in this build. The fixture checks now tell the groups apart by their counts.
4. **Panel cadence over a piece.** "Cont in pat … until N"" is a single repeat line, so the 3D
   sees one or two cabled rows per piece. For the counter and the 3D to show the panels over the
   whole piece, the repeat must yield per-row panel rows, using the gauge or the length target.
   The panel row of garment row n is ((n−1) mod R) + 1, as research §9 notes.
5. **Cable definitions in the app.** The importer carries the panel stitch guide into a part's
   text, but not the abbreviation block. So in the app, the boyfriend's T3F (1 over 1) and Cr4F
   (1 over 3) fall back to their names' defaults (2/0, 2/2). The fixture checks pass the document
   as the project's notes to read them.
   - Either carry the cable definitions with the stitch guide, or put `cf` / `cb` on the
     records. The store reads both.

## Third pass: whole cabled pieces from Knits

The parser now expands "Cont in pat … until 15½"" into rows, with the panels carried on, and
writes `at` on every cable record. "Load reference fixtures" read 314 / 2 with the old check:
the mock neck Back and boxy Front cable-column checks failed.

### The rows that tripped it, and why

The geometry was right; the check was wrong. Every failing row was a **cast-off row**:

- the mock neck's 6 shoulder rows (rows 151–156: 15–16 `bo` plus 121 … 44 `k`);
- boxy's 2 armhole rows (10 `bo` plus 105 / 95).

A cast-off row draws its bound-off stitches as fabric. The shoulder row draws 136 stitches for a
live count of 121, and the geometry draws them 123.5 wide: 136 − 0.15 × 83 pulled stitches,
exactly what the cable gauge says. The old condition, "narrower than its count", compared that
width against the live count. No cable row, WS row, rib or ≈ row tripped it.

### The check now

- Each row is measured against its **fabric**: every stitch it draws at its own width before
  cable gauge.
  - A `bo` stitch counts 1.
  - A cable stitch counts 1, because its 0.85 IS the pull.
  - A rib stitch counts 0.8.
- **Every cable row** must be narrower than its fabric by at least 0.14 per cable stitch. A cable
  row at full width would be a geometry bug.
- **Every pulled row** must be narrower by 0.14 per **plain** stitch (k/p/tbl/sl) in a cable
  column.
  - A lace yo or decrease inside a panel keeps its own width, as the geometry does.
  - The first version of the new check counted those too and wrongly failed boxy's lace rows.
- A stockinette or rib row outside the columns is not tested.

### Results

| Reference | Source | Result |
|---|---|---|
| Mock neck · Back | **Knits** (Back (continued), 156 rows) | 9 columns, 691 crossings · 74 / 74 cable rows · 156 / 156 pulled rows · 151 rows twisted |
| Boxy · Front | **Knits** (Front (continued 2), 52 rows) | 7 columns, 114 crossings · 24 / 24 · 52 / 52 |
| Boyfriend · Front | synthetic | Knits' Front parts are 6 + 32 rows with 2 cabled rows, below the 8 cabled rows the reference needs. The new check passes it: 22 / 22, 44 / 44. |

`knitCableAt` (store) no longer changes anything on Knits output: all 34 of the mock-neck row's
cable records now carry `at`. It stays as a tolerant fallback for records that lack `at`, and its
comment says so.

### Tests (third pass)

| suite | count |
|---|---|
| diagram units | **260 / 0** |
| diagram + reference fixtures | **316 / 0** |
| diagram-model | 529 / 0 |
| store-safety | 307 / 0 |
| backup | 205 / 0 |
| templates | 147 / 0 |
