# Wave H — knit-3d: knitted fabric and garment shapes in the live 3D diagram

Owner of `js/diagram-geo.js` (now **1.5.0**), `js/diagram.js` (now **1.6.0**), the `// knit` block
of `test/diagram.test.html` plus its knitting fixture rows, `test/diagram.gallery.html`, and the
diagram-model section of `js/store.js` (edited with Edit only; `shell` and `knit-counter` edited
other regions at the same time).

## What the user sees

A knitting project's 3D button and ⤢ viewer now show knitting, not crochet:

- **Stitches.** Stockinette is columns of V's: two legs from a point at the base to the top
  corners, no crochet top bar, flatter than a crochet V. Purl stitches are horizontal bumps. A row
  worked on the WS is drawn as it looks from the RS (its knits are bumps, its purls V's), so
  garter shows alternating ridges. In a round that mixes knits and purls (rib, seed, a cable on
  reverse stockinette) the knit columns stand proud and the purls sink; k2p2 at 0.8 a stitch pulls
  the brim in. A yarn-over is an open eyelet ringed by its strand. k2tog leans right and ssk left
  as seen on the face, whichever way the row was worked; cdd stands its centre stitch up; m1/kfb are
  narrower V's (kfb shows its purl bar); a slipped stitch is a narrow V. Cables show the crossing
  twist: the strands lean over 2 rows either side of the crossing row (5 rows in all), the front
  strand on top. C6F travels left and C6B travels right. Cast-on rows are drawn as a twisted cord and
  bind-off rows as a sideways chain. Knit rows are not staggered by a quarter stitch the way crochet
  rows are.
- **Heights.** Stockinette, rib, lace and cable rows are 0.75 of a stitch width tall. Garter rows
  are 0.5 (a ridge is 2 rows).
- **Socks.** A top-down sock (cuff rib → leg → flat heel flap → short-row heel turn → gusset →
  foot → toe, grafted) is an **L**. The leg stands straight up, the heel turns a right angle, and
  the foot runs out level to a closed toe. A toe-up sock is turned so its leg stands with the cuff on
  top. The heel flap is drawn as part of the tube (its held instep stitches close it), not as a tube
  pinched to half its width.
- **Raglan.** A top-down raglan yoke widens to the underarm, and the body tube continues narrower
  from the divide. The yoke's front and back run straight down into the body. The sleeve tops step
  in and fall away from the shoulders instead of standing out like a lampshade brim.
- **Hats** worked brim-up are shown crown up: a dome on a pulled-in rib brim.
- **Shawls.** A triangle grown from the centre (increases at both edges and a centre spine) is a
  triangle with a straight top edge in garter and the point at the bottom. A lace triangle worked
  from its two lower edges up to the neck point gives the same triangle. A side-to-side triangle
  (the Rico shawl) has one straight edge.
- **Short rows in a flat piece** thicken one side: the full rows above them sit on the wedge, and
  nothing tears.
- **Lace rectangles** stay flat sheets with holes.

Nothing about crochet changed. The reference set is byte-for-byte green: 205 units plus 37
reference rows, 242 in all.

## How it works (contract)

### Model (`js/store.js`, diagram-model section; knitting parts only)

`craftKeyOf(proj || prt) === 'knitting'` switches all of the following on. A crochet model keeps
exactly the keys it had.

| field | where | meaning |
|---|---|---|
| `Model.craft: 'knitting'` | model | DiagramGeo and the renderer take their knitting path |
| `Model.shape.graft: true` | shape | the text says Kitchener / graft (a closed toe) |
| `Model.shape.closedStart: true` | shape | Turkish / Judy's / figure-8 / pinhole / circular cast-on: a closed toe or crown start |
| `Round.side` 'rs'\|'ws' | round | from `Line.side`, else `expand().side` |
| `Round.shortRow: true` | round | from `Line.shortRow` or `expand().shortRow` |
| `Round.markers [{name, at}]` | round | from `Line.markers` (copied, sanitised, ≤ 24) |
| `Round.delta` | round | from `Line.delta` |
| record `side`, `cross`, `n`, `span`, `at` | stitch | carried when `Knits.expand` sends them |

Count rules (knitting only):

- A **cable** may be one record per stitch (Knits does this, with `span`/`at`) or one record over
  several stitches (`n`, else `round(w / 0.85)`). Both count as their stitches.
- A **`bo`** record is in its row's fabric but not on the needle. It does not count. A row that
  binds off everything is drawn as its bound-off stitches, and the next row starts from 0.
- **Row 1 starts from the cast-on.** The first `setup` line before row 1 (`CO 56 sts`, row 0) seeds
  `prevCount`, so `*k2, p2; rep from * to end` knows where the end is.
- A count with no records is filled with plain `k` records 0.75 tall, not crochet's generic `x`.
- `incDecPositions` reads knitting types: yo / m1* / kfb / pfb / kyok are increase sites, and
  k2tog / ssk / p2tog / ssp / k3tog / p3tog / sssk / sssp / cdd / s2kp / sk2p / skp are decrease
  sites.

### DiagramGeo 1.5.0 (`js/diagram-geo.js`, new section 7c)

- `isKnit(model)`, `knitPartials(rounds)`, `knitSpan(rec)`, `warpPoint(warp, band, x, y, z, out)`
  and the constants in `KNIT`.
- `classify` sends a knitting model to `classifyKnitRounds` / `classifyKnitRows`. These reuse the
  crochet walk on converted rounds (h / SH_SC, so a row comes out at its own height), then add the
  following:
  - **(13) Partial rows → bend.** A round with `side` or `shortRow`, on ≤ 85% of the ring, is
    closed by its held stitches. With no side information at all, the fallback is the heel count
    signature: ≥ 4 rows at ≤ 0.6 of the ring that come back to ≥ 0.9 of it. The ring of a run
    walks from the round before it to the round after it (the gusset pick-up), so the tube does not
    frill at the pick-up. The run's height becomes a bend about the held side (the pivot at the
    instep), angle = height / radius, capped at 90°. A toe-up piece (`closedTop`) is rotated so its
    last segment, the leg, stands up, with the cuff at y = 0 and the leg on the y axis.
  - **(14) Yoke.** An increase run of ≥ 3 rounds growing ≥ 1.3×, then a one-round drop to ≤ 80%,
    then ≥ 2 rounds at the new count. The yoke rounds take a stadium profile whose ends are the body
    radius. The divide rises one row height. The sleeve tops (|x| > body radius, above the divide)
    fall at 40° (`warp.yoke`).
  - **Knit rules on the walk.** Widths are eased with a 1-2-1 filter (two passes, never across
    partial rows, outliers or jumps > 20%), so "+8 every other round" is a slope, not a staircase.
    A round with no more stitches than the one before never frills. An increase round frills only
    past 2× the flat rate or 25% of the round before. A piece open at both ends gets slack 0, so a
    yoke is not lofted into a dome. A piece that closes at its last round and starts open (a hat
    worked brim-up) is flipped so the crown is on top. A graft closes the toe. `closedTop` comes
    from `closedStart`, or from casting on ≤ 32 stitches (≤ 45% of the widest round) and increasing
    at once.
  - **(15) Short rows in rows mode.** A row flagged `shortRow` that is under 90% of the last
    unflagged row is anchored at the edge that row ended at. It tapers to nothing over 2 stitches at
    its turn. Every row lies on a per-column height field (`band.field`).
  - **(16) Chevron.** Edge plus spine increases (top-down) or decreases (worked toward the apex,
    `rev`) on ≥ 40% of the shaping rows, and the piece grows or shrinks ≥ 4×. Each half becomes a
    linear map at the half-angle fitted from the rows' width/height (45° in garter, 33.7° in
    stockinette). The map is proper, so normals and winding are kept.
  - Rows-mode outliers in a knitting piece are judged against the row before, not the running
    median, so a triangle knitted down to its point is not bridged. Crochet calls
    `outlierFlags(rounds, mode)` exactly as before.
- `layout` gives warped knitting bands `ext {rad, ymin, ymax}` (sampled through the warp),
  `warpSig`, and for rows `field`. `cls.warp` is null or `{bends, disp, chevron, field, yoke}`.
  `cls.knit` reports `{partials, bends, yoke, toeUp, box, shortRows, chevron}`.

### Diagram 1.6.0 (`js/diagram.js`)

- `normalizeModel` → `prepKnitRound` for a knitting model. A cable is expanded into one slice per
  stitch. Held slices of a partial row come first and are always solid. `mir` gives the on-screen
  direction. Cable twists come from `knitTwists` (window `CABLE_TW` = 2 rows either side). Texture
  (rib) is on when faced knits and purls are each ≥ 15% of the round.
- `knitDescOf` / `reliefKnit` / `reliefCable` work like crochet: the relief is zero on the cell
  edges. Cable slices join continuously and only the cable's outer edges are windowed. Eyelets use
  the hole mechanism with their own window (`holeLo/holeHi/holeU`); crochet's stays `0…HOLE_TOP`
  across the whole slice.
- `warpGeo` moves anchor, point and normal of every vertex of a band (and the caps) through
  `DiagramGeo.warpPoint`. Hashes fold in `warpSig`. `bandExtent` uses `b.ext` (× 1.08 for
  perspective at the frame edge), and `curY` uses its centre.
- Test hooks on `Diagram._relief`: `knitDescOf`, `knitSpan`, `buildKnitRound`, `warp`, `normalize`.

## Tests

`test/diagram.test.html` now also loads `js/knits.js` and registers it as the knitting parser.

| suite | before | after |
|---|---|---|
| diagram units | 205 | **241 / 0** (+36: geometry 17, relief 14, Knits end-to-end 5) |
| diagram + reference fixtures | 242 | **283 / 0** (crochet 242 unchanged + 36 knit units + 5 knitting fixture rows) |
| diagram-model | 529 | **529 / 0** (one run read 528 / 1 on the Premier wrap "< 60 ms" timing; see below) |
| store-safety | 302 | **302 / 0** |
| backup | 205 | **205 / 0** |
| templates | 147 | **147 / 0** |
| sw | 29 | **29 / 0** (no new file) |

**Synthetic references** are built from the counts in `docs/research/knitting.md`:

- Speed Bump sock, size S: CO 56, 32-row flap on 28, 10 short rows to 18, pick-up to 80, gussets
  to 56, toe to 20, Kitchener.
- A toe-up sock.
- Bernat raglan XS/S: 76 → +8 every other round → 204 → 120.
- A brim-up hat.
- A centre-out garter triangle.
- The Rico side-to-side triangle (CO 6, +1 each RS row to the middle and back).
- Thórdís, worked from the lower edges to the neck point (−4 per RS row).
- A lace rectangle.
- A short-row wedge.
- A cable swatch (C6F / C6B).

**Through `Knits.expand`** (end-to-end, synthetic pattern text parsed by `js/knits.js`):

- A top-down sock text gives an L.
- The Knits records carry `side`, and rib comes through at 0.8.
- C6F / C6B rows come through as two 5-row twists, count 20.
- A hat text gives a dome, crown up.
- Markers, delta and a BO row reach the model.

**Fixture rows** (real PDFs via `Store.splitSections(text, 'knitting')`):

- Every section of 5 fixtures lays out as knitting, finite, at 0.5 / 0.75.
- Bernat yoke: a widening cone, no frills on shaping rounds.
- Bernat Sleeves: a tapering tube.
- Bernat Neckband: 7 × 68, a short rib collar.
- Rico rows 1–16: 6 → 13 with one straight edge.

**Which references stay synthetic, and why.** The sock L, the raglan divide, both triangles, the
lace sheet and the hat stay synthetic, because the parser does not yet read those fixtures into
whole parts:

- The 8-socks book splits into ~44 sections, mostly zero counts or "until it measures" lines.
- Bernat's yoke section reads round 1 as 204, jumps 84 → 120, and over-applies the repeat to 240
  without the divide.
- The lace book's Thórdís sections are mostly zeros.
- Rico's pattern section restarts its numbering and grows "until half the yarn" (no count).

Switch them to the fixture text when knits.fixtures lands those parts.

## Verified in the pane

Own tab, overlay canvas 420–700 px CSS at `fitPurpose: 'viewer'`, plus the real app at 375 × 812.

| piece | before (crochet geometry/renderer on knitting) | after |
|---|---|---|
| top-down sock (synthetic + Knits text) | a straight tube pinched to half width for 42 heel rows; gusset round frilled | L: leg, orange heel at the back corner, gusset bulge, foot level, toe capped; at 375 × 812 the viewer shows the planned sock as a ghost L and the button its silhouette |
| toe-up sock | — | leg up, cuff on top, foot level |
| stockinette / garter / rib / lace swatch | crochet V + top bar, stagger | knit V columns; garter alternates V and ridge rows; rib columns proud and pulled in; eyelets open |
| cable swatch | a horizontal smear inside one row | an X of strands across 5 rows; the first pass was low-contrast, so the strands were narrowed, raised, and given V texture along them |
| raglan | first pass: a lampshade (dome loft from the turn-in slack rule, frills on every +8 round) | yoke cone into a body tube; sleeve tops droop as shoulders |
| brim-up hat | crown at the bottom, frill at rib→stockinette | crown up, rib brim pulled in, no frill |
| centre-out shawl | a 4:1 flat trapezoid | triangle, depth/width 0.55 (garter: 0.5) |
| short-row wedge | first pass: white cracks at the turn ends | tapered turns, watertight |

Gallery (`test/diagram.gallery.html`): five knitting chips (Bernat raglan, 8 socks, magic-loop
socks, lace, Rico), read through Knits with `craft` and the model's `craft`/`side`/`shortRow`
carried. Compared against the photos:

- **Bernat (red raglan pullover).**
  - The neck section is a jagged strip, because the WS rows parse as 36.
  - The yoke section is a shallow, wide cone, because of the 204 first round and no divide.
  - The Sleeves card is a tube with a frill at the cuff, from a 28 → 46 jump the parser reads out
    of the L+ block.
  - The Neckband is right.
  - With an honest parse the yoke/body read like the photo (synthetic test).
- **Socks.** Sections are too fragmentary to make a sock. Time Traveler's Turkish cast-on toe is
  capped closed (`closedStart`) ✓.
- **Rico.** The first 16 rows draw the right-anchored growing edge ✓.

All remaining fixture gaps are the parser's. I made no geometry change for them.

## Still wrong / left, and why

- **Follow mode on a bent piece** turns about the leg's axis. Rounds on the foot do not come to the
  front, and the over-count wedge on a partial row is off by its held slices.
- **Real patterns restart numbering** in each section ("Row 1" of the heel flap after "Rnds
  13-60"). A one-part sock whose numbering restarts collides in the row index, so the heel rows are
  never reached. The importer splits such patterns into parts, which avoids it.
- **Garment assembly.** Each part is drawn alone. A sock imported as Cuff / Leg / Heel / … parts
  shows each piece, not the whole sock.
- **The raglan's sleeve tops** are open thin "wings": the sleeves themselves are separate parts.
  The yoke droop is cosmetic (40°), like the crochet wall bow.
- **Heights are 0.7496, not 0.75.** `roundMetrics` keys heights to 3 decimals in sc units
  (0.789 × 0.95). Tests use a 1e-3 tolerance.
- **Cables in rounds mode** use the outside-view direction. They are not checked against a real
  cabled sock photo, because no fixture parses one.

## For the owner of js/knits.js / js/patterns.js (knits-parser)

1. Bernat yoke section: round 1 reads 204 (the following "Rep … 204 sts" total), 84 → 120 in one
   round, the repeat runs to 240, and the divide (→ 120) is lost. Sleeves: decreases every round
   (44, 42, 40…) instead of every 6, and a trailing 46 from the "Sizes L… only" block. Neck rows 2,
   4, 6 read 36.
2. `Knits.workMode` returns `rows` for a sock that has a flat heel flap inside rounds. A per-line
   `workedIn: 'rows'` (as crochet wave G does) would let the store keep the piece in rounds.
3. "Rows 63-92: Rep Rows 61 and 62" gives every row of the range `side: 'rs'`. Alternate it.
4. Heel-flap rows ending in `turn` are all marked `shortRow`. DiagramGeo tolerates this (it uses
   width), but the counter's short-row mode may not.

## For the owner of js/store.js outside the diagram section (shell)

- `buildDiagramModel` resolves `expand` from `patternsApi(proj || prt)` but the lines from
  `partLines(prt)` → `craftKeyOf(prt)`. A probe part with no `craft` in a knitting project object
  is parsed by Patterns and expanded by Knits. Tests and the gallery pass `part.craft`. Resolving
  both from the same context would remove the trap.
- diagram-model's Premier wrap "< 60 ms" budget failed twice mid-session (73–86 ms), then passed.
  Measured: `Patterns.expand` is 57 of 64 ms of that build (the parser's in-flight change), and
  the store's share is unchanged.

## Contract changes

None to the binding names. Additive:

- Model `craft`, `shape.graft`, `shape.closedStart`.
- Round `side`, `shortRow`, `markers`, `delta`.
- Record `side`, `cross`, `n`, `span`, `at`.
- DiagramGeo `isKnit`, `knitPartials`, `knitSpan`, `warpPoint`, `KNIT`, `layout().warp`,
  `band.ext`, `band.field`, `band.warpSig`.

Contract §2 said a cable is one record `w` wide. Knits writes one record per stitch (`span`, `at`),
and both are supported.
