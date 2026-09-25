# 07 — Review: motifs and garments after the fidelity rebuild

Fresh-eyes pass over the **published-designer half** of the fixture set — the motifs,
the blankets, the wrap, the cardigan and the shawl — with the render next to the PDF's
own photo and against the reference table in `01-geometry-truth.md` (§1.4 polygons,
§1.5 ovals, §2.2 flat shapes in rounds, §2.3 worked in rows).
`04-visual-qa.md` is the *before* picture; this file is the *after*.

Read on: `http://localhost:8766/test/diagram.gallery.html` (worktree
`C:\Users\mitch\CrochetBs-wave1`, branch `wave-1`), `DiagramGeo.version 1.0.0`.
Numbers quoted are what the card printed, cross-checked by calling
`Store.diagramModel` + `DiagramGeo.classify` directly in the page so the table and
the canvas cannot drift. Screenshots at 0.5 scale; the Browser pane cannot save
images, so every "what you see" is a written description of the canvas.

> **Method note / trap for the next reviewer.** The *first* page load of the session
> was served stale by the service worker and printed a completely different model for
> the same fixture (Persian Tiles First Square as `16,24,48,104,342,32`, max 342,
> aspect 0.02). Every later reload printed `16,24,36,30,25,13`. **Reload once, then
> reload again and confirm the numbers repeat before writing anything down.** All
> numbers below are from confirmed-fresh loads.
>
> A parser agent is concurrently working on motif group counts (hex socks, Persian
> Tiles corners) and open-fill mesh rows. Counts marked **[mid-fix]** are the ones I
> expect to move; the shape-class verdicts next to them do **not** depend on the
> counts being right, because nothing in the pipeline can emit a corner today (below).

---

## Part 1 — The table

`verdict`: **matches** (render and photo are the same kind of object, proportions within
`01`'s ±8–12%) · **close** (right kind, wrong proportion) · **wrong** (different kind of
object) · **ugly** (wrong *and* visually broken — overflow, spikes, detached shards).

### 1.1 Motifs worked in rounds

| fixture | part | expected (`01` ref) | what you see | verdict | printed numbers |
|---|---|---|---|---|---|
| redheart persian tiles | First Square | #41 flat **square**, k=4, 4 corners, H/Ø < 0.10, corner:side swing 1.41 | a cream **sun-hat**: raised cylindrical crown in the middle, a wide frilled brim around it. Zero corners; the outline is a circle with a ruffled edge; it is *not* flat — the crown stands about a third of the radius proud | **wrong** | counts `16,24,36,30,25,13` **[mid-fix]** · 6 rounds · shape class `ring ×6 · 3 ruffled (rounds 3,5,6)` · corners **0** · aspect 0.22 · w×h 14.00 × 3.13 · start `chain-ring ch 4 ring 15` · slack 0.05 · cap top no, bottom no |
| redheart persian tiles | Second Square | another flat square | a tiny cream **dome**, one round of fabric | **wrong** | counts `0,0,0,0,0,3` max 3 · aspect 2.00 · w×h 1.50 × 1.26 · `ring ×6` · start unknown |
| redheart persian tiles | Border | flat edging round | a short open **cylinder band**, a crown, with a ruffled top edge | **wrong** | counts `22,1,0` · `ring ×3 · 1 ruffled` · aspect 0.29 · w×h 7.00 × 2.02 · cap bottom **yes** on a border |
| stylecraft hood | Motif ×8 | #43 **granny square** in UK tr, 4 corners, 6 rounds, flat (H/Ø < 0.08), `6 rnds to 16 cm` | a two-tier cream **lampshade**: a narrow straight collar sitting on a flared skirt, open top and bottom. No corners, not flat | **wrong** | counts `23,32,0` **[mid-fix]** — 2 of 6 rounds · `ring ×3` · corners **0** · aspect 0.46 · w×h 10.18 × 4.65 · st heights `2.68×2` (UK tr height is right) · start `chain-ring ch 6` |
| stylecraft hex-socks | (unnamed — hexagon + leg + foot) | #45 **hexagon**, k=6, +18 tr/round, **6 corners**, H/Ø < 0.06, then a 24-dc cylinder | a cream **spinning top**: a frilled disc at the wide end that narrows through fifteen steps into a long sharp point. Reads as a Christmas-tree finial | **ugly** | counts `18,21,47,38,30,24,20,16,12,10,8,6,4,2,2` **[mid-fix]** · `ring ×15 · 1 ruffled (round 3)` · corners **0** · aspect 1.55 · w×h 16.91 × 26.22 · cap bottom yes · slack 0.35 |
| stylecraft hex-socks | Leg Lengthening Rnds | extra leg rounds | nothing — card is empty | wrong (honest) | `(no rows with a count — prose-only section)` |
| stylecraft hex-socks | Top Of Leg Rib | rib rounds | nothing | wrong (honest) | counts `0,0,0` |
| stylecraft hex-socks | Foot Lengthening Rnds | part of the foot | one tr ring | wrong | counts `6` · 1 round · aspect 1.33 |
| stylecraft hex-socks | Toe | toe decreases | a **thin ribbed rod** with a small bulb at one end, ~8× taller than wide; the silhouette is a knitting needle | **ugly** | counts `7,7,7,6,6,6,2,2,6` · aspect **7.65** · w×h 2.23 × 17.04 · on screen radius **16%** of the half-width |
| stylecraft cowl-mitts | Cowl | #47 **chevron cylinder** from `240 ch joined`, 10 lobes, constant count, zig-zag top/bottom edges | a smooth cream **open cylinder band**, two rounds tall, faint vertical ribs, dead-straight top and bottom edges. No ripple anywhere | **wrong** | counts `23,23` · `ring ×2` · aspect 0.52 · **R max 3.66** · start `chain-ring **ch 240**` — the 240-chain *is* detected and then ignored in favour of the 23-stitch parsed count |
| gosyo lace doily | (unnamed) | #46 flat lace circle Ø 19 cm; text layer carries no row instructions — must degrade gracefully | the card says **"(no rows with a count — prose-only section)"** and draws nothing | **matches** | 0 rounds · no canvas, no invented shape |

### 1.2 Worked in rows

| fixture | part | expected (`01` ref) | what you see | verdict | printed numbers |
|---|---|---|---|---|---|
| premier sparkling wrap | Wrap | #48 **rectangle** 405 sts × 46 rows, asp **0.216**; `01` predicts 0.119 if every row is forced to sc height 1.0 | a dense tilted **band of fabric running off both the left and right edge** of the canvas — you never see either end, so it does not read as a rectangle. Below it, **detached, a separate hairline strip with a small notch** (rows 2–4). Vertically the fabric sits in the bottom 40% with empty space above | **close / ugly** | 46 rows (the repeats **do** expand now — big win) · counts `405,2,5,5,405…405,406` **[mid-fix]** · st heights **`1×46`** — every row sc · aspect **0.112** (truth 0.216, i.e. exactly `01`'s "half too short" prediction) · w×h 406.00 × 45.30 · anchor center · fit `scale 0.16 (honest 0.03) CLAMPED: height` · on screen radius **451%** of the half-width |
| premier simple throw | Blanket | #49 rectangle 94 sts × ≈88 rows, asp 1.475, BLO ridge every row | a **thin cord** stretching off both edges — two rows of hdc. Not a blanket | **wrong** | 2 rows `94,94` · st heights `1.34×2` (hdc height correct) · aspect **0.027** · fit `1.21 (honest 0.15) CLAMPED: height` · radius **800%** of the half-width |
| bernat basketweave | (unnamed) | #50 rectangle 97 sts × ≈70 rows, asp 1.14, 4-stitch fpdc/bpdc checkerboard ±0.30 SW in z, hdc edging | a tilted **5-row band** off both edges, with clean horizontal ridges but a perfectly smooth surface — **no basketweave relief at all** | **wrong** | 5 rows `98,98,98,98,98` · st heights `2.01×5` (dc) · aspect 0.097 · radius 516% of the half-width |
| bernat basketweave | Edging | worked edging round | nothing | wrong (honest) | counts `0` |
| cardigan | Swatch | a gauge swatch | an 18-wide 2-row band with a **2-stitch-wide stack of four rows standing straight up out of the middle of it** — a capital T | **ugly** | counts `18,18,2,2,2,2` · aspect 0.317 · fit `1.25 (honest 0.79) CLAMPED: height` |
| cardigan | First Section | #56 body panel, 18 → 184 (208, 224) sts over ≈90 rows, puff rows alternating with BLO sc ⇒ welts every 2 rows | a flat **8-row ribbon** off both edges; stitch texture is uniform sc, no puff welts | **wrong** | 8 rows × 184 (task's "8 rows plus repeats" confirmed — the repeats are **not** expanded here) · st heights `1×8` · aspect **0.041** · radius **800%** of the half-width |
| cardigan | sizes | 184 (208, 224) | `sizeIndex` 0/1/2 → **184 / 208 / 224**, correct | **matches** | verified by calling `Store.diagramModel` with each `sizeIndex`; note the gallery card has no size control, so the harness only ever exercises index 0 |
| cardigan | Center Back | back panel | tapered ribbon, drops to a 12-wide sliver for the last two rows | close | counts `88,88,88,88,12,12` · aspect 0.065 |
| cardigan | Second Section | second body half | ribbon | wrong | 9 rows × 184 · aspect 0.046 |
| cardigan | Sleeves | #57 truncated cone in rounds, 58 → 34, all decs at one angular position | a single flat ring | **wrong** | counts `58` · 1 round · aspect 0.051 |
| cardigan | Sleeve Cuff | #58 7-wide strip worked sideways into a ring | a 3-row scrap 2.4 wide | wrong | counts `3,2,2` · st heights `1×2 0.3×1` |
| cardigan | Front Trim | long front band | a 3-row stub | wrong | counts `7,7,2` · aspect 0.407 |
| hobbii amarah (**not in the gallery's fixture list** — I injected it via `loadFixture`) | Shawl | #53 **right triangle**, increases at one edge only, one straight vertical edge, one hypotenuse, apex at row 1, **must be left-aligned not centred** | a clean **right triangle**: one straight edge, one hypotenuse, three corners, apex at the narrow end. Edges are straight, the growth is all on one side | **matches** (shape) / **close** (proportion) | 144 rows · counts `3,5,5,7,7,9,9,11…143,145,145,147` · st heights `1.34×144` (hdc) · **anchor left** · aspect 1.247 (the printed finished size 142.5 × 46 cm implies ≈0.32; `01` flags the printed gauge as low-confidence row-*pairs*) · corners reported 0 |

### 1.3 The app (`http://localhost:8766/`, 375 × 812, project `ZR2_wrap`, since deleted)

Imported `/tmp-pdf/crochet-premier-sparkling-wrap.pdf` through **New project** → the
sheet picked up **"From this PDF — Wrap"** by itself. Counted rows to 5, then to 46/46.

| what | expected | what you see | verdict |
|---|---|---|---|
| import + row model | a 405 × 46 rectangle | `0 / 46` rows, `Group 1 of ≈ 41 · stitch 0 of 10`, `0 / ≈ 405`. The `≈` is exactly the right amount of honesty | **matches** |
| row instruction text | per-row text | at row 5 the card reads **`ROW 6 — Rows 5-44: Rep Rows 3 and 4.`** — the 40 expanded rows all share the one repeat line, so the instruction never changes for most of the piece | close |
| stitch-button preview, row 5 | a 5-row strip | a **single golden hairline** across the purple panel, roughly 3% of its height | **ugly** |
| stitch-button preview, row 46 | the finished wrap | a band of fabric in the **bottom third** of the panel running off both edges, the top 45% empty, with the detached rows-2–4 hairline below it | close |
| viewer shape summary line | "Flat panel · 46 rows · 405 wide" | at row 5: **"Flat panel — 46 rows · 406 wide"**. At row 46: **"Flat panel — 47 rows · 406 wide"** — the row count grows by one when the piece completes, and the width is the 406-chain, not the 405 sc | close |
| viewer header | `Row 46` | **`Row 47 · 0 sts`** at 46/46 — off by one | close |
| Worked-in control | say what it did | segmented **`Auto` / `Rounds` / `Rows`**, `Auto` selected, with no indication that Auto resolved to rows | close |
| Worked-in → Rounds (manual override) | a tube, or a refusal | **"Ruffle — 47 rounds · 406 around"**: a huge olive-brown dome with three sail-shaped flaps sticking out of the rim and **flat degenerate quads lying across the middle of the mesh**. Visually broken | **ugly** |
| framing, 375 px wide | the rectangle readable end to end | the sheet is deliberately over-scaled (`FIT_MIN_HEIGHT_FRAC`) so it is **4.5× wider than the frame** and cropped on both sides | close — no longer a hairline, but now unreadable in the other direction |

---

## Part 2 — What got better

Worth saying plainly, because most of this file is complaints.

1. **Row repeats expand.** The sparkling wrap went from 4 rows to **46**, the Amarah
   shawl builds all **144**. `04` defect G-1 is half fixed.
2. **Per-stitch heights are real.** hdc 1.34, dc 2.01, UK tr 2.68, sl st 0.3 all show up
   in the `st heights` line. `04` defect A is gone.
3. **One-edge growth is anchored, not centred.** The Amarah shawl's `anchor left` is the
   single best result in this half of the corpus and closes `01` item 7.
4. **Empty models say so.** The doily and the prose-only sections print
   "no rows with a count — prose-only section" and draw nothing, exactly as `01` §4.1 asks.
5. **Caps are conditional.** `cap top no, bottom no` on the motifs and the cowl — `04`
   defect D is gone for open-rim pieces.
6. **The stitch-count sizes work.** 184 / 208 / 224 from `sizeIndex`.
7. **Zero-count rounds no longer punch a hole**; they are marked `empty`.

---

## Part 3 — Ranked defects, with a hypothesis and a file each

### D1. Nothing in the pipeline can ever emit a corner, so every motif is a solid of revolution
*Fixtures:* persian First/Second Square, hood Motif ×8, hex-socks hexagon — **4 of the
5 motif cards**, and by construction every granny square, hexagon and star in the corpus.

*Evidence.* Every card prints `corners 0` and `shape class ring ×n`. The vocabulary is
already there and unused: `js/app.js` `shapeName()` (~2366) has branches for
`'Triangle motif'`, `'Square motif'`, `'Hexagon motif'`, `'Octagon motif'` keyed on
`cls.corners`, and `js/diagram-geo.js` has a full `polygonFit()` (~449) plus
polygon radius modulation (~610, `SHARP_FLAT 0.75`). It never fires.

*Hypothesis — classification rule + parser, jointly.* `polygonFit` is driven by
**increase-site indices** (`sit[i].inc`), and `POLY_MIN_PER_SITE = 1.8` demands a corner
consume ≥ 2 stitches. Granny rounds are phrased `(3 dc, ch 3, 3 dc) in corner sp` /
`(3tr, 2ch, 3tr)`, which `Patterns.expand` does not turn into positioned `inc` markers —
it returns a flat count, so `sit[i].inc` is empty and `polygonFit` has nothing to fit.
`01` §1.4.7 specified the escape hatch — a **text fallback**: `k = 4` when a round matches
`(…, ch 2|3|5, …) in (corner|next ch-\d sp)` with `rep from \* (2|3) (more )?times`, or the
part is called *square*/*tile*/*motif* with a `Square = …` gauge; `k = 6` on
*hexagon* / `6 x 3tr groups`. `grep -n "corner\|hexagon\|square\|motif" js/store.js`
returns **nothing**: the fallback was never built.

*Lives in:* `js/store.js` `buildDiagramModel` (detection, emit a per-round
`corners`), feeding `js/diagram-geo.js` `classify` (~499–720) which already knows what to
do with it. The parser half (group counts like `3tr in each space`) is
`js/patterns.js` `expand`/`stitchTok`.

### D2. Rows sheets are over-scaled until they run off both edges of the frame
*Fixtures:* sparkling wrap (radius **451%** of the half-width), simple throw (**800%**),
cardigan First/Second Section (**800%**), Center Back (777%), basketweave (516%),
cowl-mitts Mitts (316%), and the same thing in the app's viewer and stitch button.

*Evidence.* Every one of these prints `fit: scale X (honest Y) CLAMPED: height`. The
honest scale would fit the piece; the clamp multiplies it up so the fabric fills 40% of
the height, and the width overflows by up to 8×. The result is that **no rows-mode
rectangle in the corpus is ever seen as a rectangle** — you see a band with no ends,
which is a different failure from `04` defect G but just as uninformative. The wrap's
truth is 405 × 46; at 375 px wide you see roughly 90 of the 405 stitches.

*Hypothesis — renderer/fit policy.* `js/diagram-geo.js` `fit()` (~985) clamp (b):
`needH = FIT_MIN_HEIGHT_FRAC * halfH / (hy*cp)`, capped by `FIT_MAX_OVERSCALE_ROWS`.
The comment says "let the sheet overflow sideways, current row centred", which is a
defensible choice *while counting* — you want to see the current row's stitches — but
it is the wrong default for the **finished** piece and for the gallery's finished-piece
cards. Two scales are needed: a "working" scale (overflow, current row centred) and a
"whole piece" scale (honest, letterboxed) selected by whether the piece is complete or
the viewer is idle. Also worth noting the piece is bottom-anchored in the button rather
than vertically centred, so the top 45% of the panel is empty at the same time as the
sides are cropped.

*Lives in:* `js/diagram-geo.js` `fit()` and its `FIT_*` constants; consumed in
`js/diagram.js` and `js/app.js` (viewer + stitch-button canvas).

### D3. The wrap's 46 rows are all single crochet, so a mesh wrap is half its true height
*Fixture:* premier sparkling wrap — `st heights 1×46`, aspect **0.112** against the
pattern's own 74″ × 16″ = **0.216**.

*Evidence.* `01` §2.3 #48 predicted this number exactly: "with every row forced to sc
height 1.0 it gets **0.119** — half too short". The rows now expand but each expanded row
inherits the wrong stitch. The same mechanism makes cardigan First Section `1×8` where
the pattern alternates puff rows with BLO sc rows.

*Hypothesis — parser expansion.* `01` Part 3 records that `expand` computes a per-stitch
`h` internally and **drops it** (`res.stitches = list.map(… {t, c})`), so a mixed row
(`tr, dc, hdc, sc`) collapses to one `dominantHeight`; and a row generated by
`Rows 5-44: Rep Rows 3 and 4` is being synthesised from the *count* of the referenced row
without re-running its stitch tokens. Open-fill mesh rows (`ch 5, skip 5, sc in next`)
also need the `ch-k` = width k / height 0 rule from `01` §1.2.

*Lives in:* `js/patterns.js` `expand` (plumb per-stitch `h` and `w` out), `js/store.js`
(carry them into the model's rounds when expanding a repeat).

### D4. Degenerate mid-piece rows tear the fabric into detached pieces
*Fixtures:* sparkling wrap (`405, 2, 5, 5, 405…` — a hairline strip floating below the
sheet, with a visible notch), cardigan Swatch (`18,18,2,2,2,2` — a 2-stitch tower
standing straight up out of the middle of an 18-wide band, a capital T), persian Border
(`22,1,0`), hex-socks Toe (`…,2,2,6`), cowl-mitts Mitts (`0,12`).

*Evidence.* `04` defect F was about `count: 0`; zeros are now marked `empty` and skipped.
But a row of **2 or 5** among rows of 405 is not real fabric either — it is a line the
parser misread — and it is still laid out at full width ratio, so the sheet visibly
separates. The T in the cardigan Swatch is the clearest single image of it.

*Hypothesis — model builder.* `js/store.js` `buildDiagramModel` guards `count <= 0` but
not "count is a wild outlier from its neighbours". `04` already proposed the fix for the
width case (median / outlier rejection); it needs to apply to the *row itself*: a row
whose count is < ~15% of the running median between two rows at the median should inherit
the median (and be flagged low-confidence), not be drawn.

*Lives in:* `js/store.js` `buildDiagramModel` (~1327 area, where repeated rows are
expanded); the layout consequence is `js/diagram-geo.js` `classifyRows` (~871).

### D5. The cowl detects its 240-stitch chain and then throws it away
*Fixture:* stylecraft cowl-mitts Cowl — `start chain-ring **ch 240**` printed on the same
card as `R max 3.66`, i.e. a 23-stitch ring. The render is a 2-round smooth band; `01`
#47 wants a 10-lobe chevron cylinder ≈38 SW across with zig-zag edges.

*Hypothesis — model builder.* The start-detector already parses `make 240ch, join chain
into a circle`, so the number is in hand; `buildDiagramModel` then takes the round count
from `Rnd 1`'s parsed stitches (23) instead of seeding round 1 from the detected chain.
When a chain-ring start is detected and round 1's parsed count is wildly smaller, the
chain should win. Separately, `01` §1.4.6's **chevron veto** (k inc sites + k dec sites,
net Δn = 0 ⇒ ripple, never a polygon) is present in `diagram-geo.js` (`ripple[i]`, ~523)
but can never trigger here because there are no `inc`/`dec` positions to count —
same root cause as D1.

*Lives in:* `js/store.js` `buildDiagramModel` (chain-ring seeding) and
`js/patterns.js` (chevron repeat expansion).

### D6. A one-edge triangle is labelled "Shaped panel"; "Triangle" is reserved for the centred case
*Fixture:* hobbii amarah Shawl — geometry is right (`anchor left`, three corners, straight
edge + hypotenuse) but `js/app.js` `shapeName()` (~2364) reads:

```js
if (cls.anchor === 'spine')  return 'Triangle';
if (cls.anchor === 'left' || cls.anchor === 'right') return 'Shaped panel';
```

A `spine` shawl (grows both sides of a centre) is an **isosceles** triangle; a `left`/
`right` shawl is a **right** triangle. Both are triangles; the label has them backwards
in usefulness. `cls.corners` is also 0 in rows mode, so the "3 corners" the reference
table asks for is never reported.

*Lives in:* `js/app.js` `shapeName`/`shapeSummary` (~2355–2420); `corners` for rows mode
in `js/diagram-geo.js` `classifyRows` (~897, hard-coded `corners: 0`).

### D7. The viewer's own numbers drift by one and quote the chain, not the stitches
*Fixture:* app, ZR2_wrap. At row 5 the summary says `46 rows · 406 wide`; at row 46 it
says `47 rows · 406 wide`, and the header says `Row 47` at 46/46.

*Hypothesis — app.* `shapeSummary` uses `n = model.rounds.length` and the app appends a
round for the current row once it passes the last parsed row, so finishing the piece adds
a phantom row. `wide` is `max(count)` over the model, and the foundation chain (406) is in
the model as a round, so the sheet is one stitch wider than the 405 sc the pattern
states — the same +1 that sets the sheet width in `classifyRows`.

*Lives in:* `js/app.js` `shapeSummary` (~2394) and wherever the current row is appended
to the model; the chain-as-a-row question is `js/store.js`.

### D8. The "Worked in" control lets you reach a visibly broken mesh, and never says what Auto chose
*Fixture:* app viewer, `Auto | Rounds | Rows`. Forcing **Rounds** on the wrap gives
"Ruffle — 47 rounds · 406 around" and draws an olive dome with three sail-like flaps and
**flat degenerate quads lying across the middle of the surface** — not just a wrong shape
but a broken mesh. `Auto` also never tells you it resolved to rows, so the three buttons
read as three equal choices rather than "we picked rows; override if we're wrong".

*Hypothesis — renderer + app.* The ruffle branch (`01` §1.7, `f.kind = 'wave'`,
`diagram-geo.js` ~330) is being handed `e ≫ 1` (405 → 2 → 5 → 405 in *rounds* mode is a
hyperbolic impossibility) and produces `eps` large enough that adjacent band rings
self-intersect. Either clamp `eps` so the surface stays manifold, or refuse the override
with a one-line reason when the forced mode makes the piece a ruffle over most of its
rounds. Label `Auto` as `Auto (rows)`.

*Lives in:* `js/diagram-geo.js` wave/ruffle profile (~325–335) and
`js/app.js` viewer mode control.

### D9. Post-stitch and BLO texture is still flat
*Fixtures:* bernat basketweave (no checkerboard relief at all; `01` #50 wants 4-stitch
blocks alternating ±0.30 SW in z), premier simple throw (BLO ridge), cardigan (puff rows).

*Hypothesis — parser + renderer.* `01` item 13: `fpdc`/`bpdc`/`BLO`/`FLO` collapse to
plain `dc`/`sc` in `stitchTok`, so there is no `t` for the renderer to offset. Low impact
next to D1–D4 but it is the whole visual identity of two fixtures.

*Lives in:* `js/patterns.js` `stitchTok`, `js/diagram.js` band builder.

### D10. The harness does not cover the two fixtures that matter most for rows
*Evidence.* `test/diagram.gallery.html` `FIXTURES` (~171) has 18 entries and **does not
include `crochet-hobbii-amarah-en.pdf`** — the corpus's only one-edge-growth triangle and
the regression case for `01` item 7 — nor `crochet-furls-frontier-shawl.pdf`, the
no-text-layer graceful-failure case. I had to inject the shawl by hand
(`loadFixture({file:'crochet-hobbii-amarah-en.pdf'}, document.createElement('button'))`)
to review it. The cards also have no **size** control, so the cardigan's
184 (208, 224) path is never exercised in the gallery even though it works.

*Lives in:* `test/diagram.gallery.html` (`FIXTURES`, and a `sizeIndex` select on the card
next to the existing mode/shape selects).

### D11. Gallery / pane robustness
Two things cost time and will cost the next reviewer the same:

* **A stale service-worker response gave a completely different model on the first
  load** (see the method note). A cache-version line printed on the gallery page —
  `DiagramGeo.version` is already there, the *app* build hash is not — would make this
  self-evident.
* Screenshots of the page go blank whenever the tab is scrolled away from the top or the
  Browser pane is hidden; the practical workaround is to hide every other card
  (`cards.forEach(c => c.style.display = 'none')`) and screenshot at `scrollY = 0`. A
  "show only this card" toggle on the gallery toolbar would make the pass much faster.

---

## Part 4 — What I would fix first

1. **D1** — the text fallback for `k` (`store.js`), because it is the difference between
   "three of the four motif fixtures are the wrong kind of object" and "they are squares
   and a hexagon". Everything downstream (`polygonFit`, the radius modulation,
   `shapeName`'s `Square motif`) is already written and waiting.
2. **D2** — two fit policies instead of one. It costs a boolean and it makes every
   blanket, wrap and cardigan panel legible for the first time.
3. **D4** — outlier rows. One guard in `store.js` removes the floating strip in the wrap,
   the T in the cardigan swatch and the pinch in the mitts.
4. **D3** — plumb per-stitch height through repeat expansion; the wrap's aspect is the
   cleanest single number in the reference table to regress against (0.216 ± 8%).
5. **D10** — put the Amarah shawl and the Furls shawl in `FIXTURES` and add a size select,
   so the next pass measures what this one had to inject by hand.
