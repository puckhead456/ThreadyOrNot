# Wave K brainstorm, lens 02: the cross-stitcher

I stitch full-coverage pieces of 100,000+ stitches by parking, small samplers, and kits with
backstitch and French knots. My charts are Etsy PDFs, and today I work them in Pattern Keeper (PK)
or Markup R-XP.

Used at 375 × 812 in my own tab (`Store.__setKeyForTests`, http://localhost:8766, 2026-11-12).
Imported and stitched on: `xs-pacman.pdf` (KG-Chart vector), `xs-pokemon-tl.pdf` (500 × 500, 105
colours), the owner's `xs-potatoes-preview.webp` and `xs-potatoes-key.png`,
`xs-satsuma-stayhome-color.pdf` and `xs-tinymodernist-autumn.pdf` (picture PDFs), `xs-dmc-2173.pdf`
(DMC library) and `xs-ursa-piggies.oxs`. Afterwards I deleted all 7 projects, their 62 BlobStore
`p:<id>:` keys and the test key.

**Verdict.** The engine beats PK in places: vector charts read exactly (Pac-Man 224 × 288 in
1.6 s; Pokémon 250,000 stitches, 105/105 colours, in 8 s), a tap costs 7–18 ms on a 250k chart,
whole-colour marks 21,207 stitches in 78 ms, OXS brings backstitch, knots and fractionals (PK has
none), and it reads a chart from a picture (PK cannot). What stops me leaving PK is how I *work*:
parking on the chart, page boundaries, a chart that fills the screen, a session log, seeing the
piece grow. What still stops a third of my PDFs is *reading*: a key that is a picture, a chart on a
busy page, a chart set in a symbol font, backstitch drawn as lines.

---

## 0. Status of the 2026-09-17 lens (`docs/brainstorm/04-cross-stitcher.md`)

| # | item | state today (evidence from this session) |
|---|---|---|
| 1 | rulers + position readout | **done** (wave F) |
| 2 | remember the view | **done** (wave F) |
| 3 | keep PDF pages with the grid | **done** (wave F): Pac-Man kept 22 pages |
| 4 | one truth for counts after a partial match | **open**. Pac-Man key rows show "DMC 349 · no count yet" and "DMC 3843 · no count yet", but the Floss sheet shows 176 and 4,824 for the same colours. The header says "of 59,512 stitches" while the key sums to 64,512 |
| 5 | give the chart sheet the full screen | **open**. The canvas is 345 × 366 px of 812 (45 %) |
| 6 | show the grid before committing | **half**. The copy is fixed ("Read 64,512 stitches over a 224 × 288 grid"). There is still no thumbnail, and "1 symbol could not be matched to a colour in the key" has no picker (the picture reader has one) |
| 7 | distinct symbols | **open**. Pac-Man got `· ● ▪ : △ ▲ ◍ ▫ ◌ ○` (`assignSymbols`, `js/xstitch.js:945`) |
| 8 | photo → chart layout | not re-checked; not listed open in HANDOFF |
| 9 | linen/evenweave over 2 | **mostly done** (wave E). A doubled printed size or "N HPI" sets over 2, and Pac-Man showed "16 ct linen · over 2". A plain "28 ct linen" with no printed size is still over 1 |
| 10 | skein ranges that inform | **open**. "DMC 310 · 56,985 sts · 56–125 skeins"; "About 70–147 skeins in all" |
| 11 | confirm before a photo replaces a key | **open**. `applyPhoto` (`js/app-xstitch.js:5510`) has no confirm |
| 12 | progress that moves | **open**. "20 of 59,512 stitches · 0%"; the home card says "0 of 10 colours" |
| 13 | 10×10 obeys the current colour | **partly**: only an isolated colour scopes it (wave F) |
| 14 | page viewer | **done** (wave F) |
| 15 | count where I am | **done** (wave F, block counting) |
| 16 | parking on the chart | **open**. The code adds `corner: 'tl'` hard-coded and puts the colour name in `note`. There is no edit, and nothing is drawn on the chart (`openParkingSheet`, `js/app-xstitch.js:3884`) |
| 17 | DMC-library keys | **partly**. Strands are fixed (wave E), but `xs-dmc-2173` still imports 4 backstitch rows and **no cross colours** (503, 3833, 3832, E677 are missing) |
| 18 | page classification + thumbnails | **partly**. A grid read sets `isChart` from regions. A key-only or picture import has no per-page chart/not-chart toggle |

Proposal 1 below bundles #4, #7, #10, #11, #12 and the rest of #13. Proposal 2 covers #5, and
proposal 3 covers #16.

---

## 1. Parity table: crochet's richness against cross-stitch

| crochet capability | cross-stitch | evidence |
|---|---|---|
| PDF import that turns a messy pattern into countable work | **has** (vector), **partial** (pictures) | `extractGrid` places tiles by ruler numbers. `XSRead` reads one picture page. Satsuma reads **88 × 110** for a 70 × 97 chart; Tiny Modernist autumn is refused ("more than 60 distinct colours") until cropped by hand |
| Parser with computed counts and a confidence signal | **has** | `checkCounts` verdicts, the import banner ("Read the key cleanly — 10 colours found") |
| Hundreds of real-fixture assertions | **has** | xstitch.fixtures 512 and xstitch-read 229. But no fixture is a raster multi-page chart, a symbol-font chart read as a grid, or a Pattern Keeper-style commercial PDF |
| Accuracy audit against page-by-page truth | **has** for keys (wave E) | Picture charts are checked only on the potatoes screenshot. Satsuma and Tiny Modernist chart truth is size and colour list only |
| Multi-size | n/a, as size per fabric | Fabric & size table, "over 2" |
| **Live 3D model that follows every tap** | **missing** | The tap button shows a flat chart preview. There is no "my piece" picture anywhere |
| Yarn colours from the pattern | **has** | The key gives DMC names and swatches. Anchor, Madeira and Cosmo are DMC-only (`FLOSS = { dmc }`, `js/xstitch.js:630`) |
| Repeats / targets / alerts | **partial** | "Colour done" celebration only. No goals ("finish page 9", "500 a day") |
| Placing notes | **partial** | Backstitch, knots and parts layers from OXS. From a PDF: none |
| Templates | missing (low need) | — |
| Checklists | **has** | ⋯ → Checklist |
| **Focus / working mode** | **missing** | Crochet has ⤢ Work in 3D full screen. Cross-stitch has a 45 % chart in a sheet |
| Group readout | **has** | "block 1,1 · 100 left here · 0 / 56,985" |
| History / sessions | **missing** | ⋯ → History says "No completed rows yet." after 20 stitches (crochet's row history) |
| Tours, FAQ | **has** | tour plus a Row-by-row step, FAQs |
| Celebrations | **has**, unguarded | "Whole colour" marked 21,207 Pokémon stitches in one tap: "DMC 310 · Black done ✓", no confirmation |
| Keyboard path | **missing** on the chart canvas | HANDOFF small item 0 |

---

## 2. Proposals, ranked (value ÷ effort, my judgement as a stitcher)

### 1. The honesty sweep (04 leftovers in one go)  · S
**What I see.** One total on every screen; a colour the grid could not place shows the key's count
("counted from the key, not on the chart") and the tap button still counts it; "20 stitches ·
0.03 %"; symbols from different shape families; "56–125 skeins (buy 72)"; a confirm before "Whole
colour" over 1,000 stitches and before a photo replaces an imported key.

**Why it matters.** These are the screenshots above. Two numbers for one colour is the fastest way
to lose a stitcher's trust, and a one-tap mark of 21k stitches is a silent disaster with Undo as the
only net.

**How.** `progressStats` falls back to `palette[i].stitchCount` for an entry with no cells (counts
mode for that entry only); one decimal below 1 %; `assignSymbols` round-robins `SYMBOL_FAMILY`
before reusing a family (on import, or a "re-letter symbols" action); `skeinRange` gains a
midpoint; `ctx.confirmSheet` in `markWholeColour` above a threshold and in `applyPhoto`; 10×10
scoped to the current colour with a "whole block" chip (04 #13's open UI decision).

**Risks.** Re-lettering moves existing projects' symbols, so make it opt-in.
**Proof.** Pac-Man shows 64,512 in the header, the home card and Floss. Unit tests on the
fallback and the symbol families (10 colours, no repeated family). A confirm-sheet test in
`test/crafts.test.html` group 11.

### 2. Stitch mode: the chart *is* the screen  · M
**What I see.** ⤢ on the chart strip opens a full-screen chart, like crochet's working mode: rulers
kept, tools as one floating pill (Tap / Drag / 10×10 / Park / Highlight), the tap button docked
bottom-right ("block 15,25 · 4 left"). **Highlight** fades every other symbol to 12 % (PK's
highlight; `view.isolate` already paints one), two or three at once for blends. Keep awake,
landscape for a tablet on a stand, and the keyboard (arrows one stitch, Shift+arrows one block,
Space marks, H highlights), which closes HANDOFF item 0.

**Why.** 04 #5 is still open. PK's main complaint, "needs a tablet", is our chance, but only if the
phone shows more than 30 × 32 stitches.
**How.** Reuse `makeChartView` in a full-viewport host. The tool row becomes an overlay (as the
wave I working mode does in `js/app.js`). Remember the mode per project in `current` (view state,
`{undo:false}`).
**Proof.** Canvas ≥ 85 % of 375 × 812 and 375 × 640. A keyboard-only walk marks 10 stitches.
Six themes.

### 3. Parking that lives on the chart, with a parking assistant  · M
**What I see.** Long-press a stitch: "Park DMC 310 here", a four-corner picker, an optional note; a
corner triangle in the floss colour is drawn at ≥ 8 px a stitch. When I finish a colour in my
10×10 block, the **assistant** suggests the spot: "next DMC 310 in the block to the right: col 61
row 12", in my direction (block parking left→right, or column parking one column ahead). Marking a
parked stitch offers to unpark it. The sheet lists threads in the order I will meet them; a tap
jumps there.

**Why.** Parking is how big full-coverage pieces get done, and PK's corner marker is its most-praised
feature (research A2.1). Our parking sheet is a text list with a wrong corner.
**How.** `parking[]` gains `{x, y, corner, paletteIndex, note}`, migrated in `normalize`, with the
old `note` text kept. The suggestion is `XStitch.nearestCellOf` restricted to the next block in the
chosen direction. `drawExtras` draws the markers.
**Proof.** Unit tests on the next-block search (both directions, chart edge); on Pokémon, park 8
colours, reload, markers in place; marking a parked cell offers to unpark.

### 4. Pages on the chart (the printed page boundaries)  · S
**What I see.** Dashed outlines and "p9" labels show each printed page on the chart; "Page 9 ·
1,204 of 4,081 done" in the readout; "Mark page done" asks, then marks the page's stitches (or this
colour on this page). Today it only sets a flag (`js/app-xstitch.js:3772`), so page progress and
stitch progress disagree. A "this page" scope for the tap button and Row by row.

**Why.** "Finish page 7" is the real goal unit (research A2.2), and I talk to my paper copy by page
number. The data is already there: `pages[i].region` from wave F, checked to 99.8 % on Pac-Man.
**Proof.** On Pac-Man, page 9's outline matches the printed tile (`cols 107–159 · rows 78–154`).
Marking page 9 sets exactly its cells.

### 5. Stitch sessions, pace and a finish date  · M
**What I see.** A session opens on the first mark after 10 minutes idle (or ⏱). History lists "Tue
11 Nov · 52 min · 318 stitches · DMC 310, 3843 · page 9" instead of "No completed rows yet"; a week
strip of stitches per day, "about 365 an hour", "at this pace: done around March 2028", a streak;
and "last stitched 9 days ago" on the home card for people who rotate WIPs.

**Why.** Session logs, pace and rotation are the motivation layer stitchers keep in spreadsheets
(research A2.3). On a 64k chart, percent barely moves for weeks. Stitches per day does move.
**How.** Each tap / `commitBulk` adds to an open `{start, end, n, byColor}` in
`craftData.sessions` (day rollups after 90 days). Pace is a trimmed mean; the finish date shows
only after 5 sessions, as a range.

**Proof.** A unit test with synthetic sessions gives the pace and range. A reload keeps a session
open. Undo removes stitches from the open session.

### 6. Read symbol-font charts from the text layer  · M
**What I see.** The Tiny Modernist PDFs (welcome, halloween, homestitchhome, foxy) import as a
**real chart** in one step, the way KG-Chart does. Today they come in as key + page images.
**Why.** These charts are set in a symbol font. The wave E audit shows the text layer carrying the
chart as dense, grid-aligned glyph rows ("`2222222 8 222222 OOO`" on foxy p1). The key's symbol
column uses the **same font codes**, so the cell-to-key match is by code identity: no glyph has to
be recognised. Most of the Etsy designers PK supports export this way (research A1.4: "symbols
must be embedded font glyphs").
**How.** Bucket the symbol font's `getTextContent` items into a lattice (split multi-glyph items by
advance width); read the key's symbol column as raw codes before `stripChartSoup` drops them; place
tiles by ruler numbers (`placeTile`); borrow `KnitChart`'s glyph-font fallback (`js/knit-chart.js`).

**Risks.** Pages where the sidebar interleaves with the chart rows (foxy, the wave E pdftext note
2). Use positions, not the extracted line order.
**Proof.** The four TM fixtures read at exactly the printed size (68 × 68, 57h × 80w, 54w × 76h,
35h × 49w), each colour count summed. Halloween prints per-row stitch counts that can serve as
the check.

### 7. Read a key that is a picture, without OCR: solve it as a cipher  · L
**What I see.** I drop the key screenshot (`xs-potatoes-key.png`) or a picture PDF's key panel; the
app reads "DMC 04 · 100, DMC 310 · 1839, …" with each row's own swatch and symbol, says "read from
the picture: check these", and leaves a row it cannot pin down blank with a box to type in.
Today the same picture is taken for a chart ("a grid of about 6 × 3 squares, but I am not sure"),
and with no key the potatoes chart names DMC 977, 640, 841 and 3822 for what are really 3827, 3032,
842 and 745.

**Why template matching beats OCR here.** A key only needs digits, plus "DMC" / "Anchor" and the
column layout. The names come from our floss table. Each digit can be checked three ways:
1. **Counts.** The chart read gives each colour's stitch count to within ±1, so the count column's
   glyph strings must spell numbers close to those.
2. **Codes.** They must be real codes in the brand's table (about 500 valid values out of 10,000),
   and their table colour must sit near the swatch printed beside them.
3. **One font.** The same glyph shape is the same digit everywhere on the page.

Steps: cut the key into rows by its swatch column and baselines; cut rows into glyph blobs and
cluster them by shape (the 10 × 10 ink descriptor from `xstitch-read.js` symbol mode); solve the
cluster → digit mapping as a constraint problem (10 unknowns, thousands of constraints). The result
is a unique answer or an honest "could not read the numbers", on any typeface, with no font known in
advance. Each row's symbol and swatch come free as crops (proposal 9).

**On-device OCR, for comparison.** Tesseract.js (Apache-2.0) is on-device and free per user, but
it is a ~2 MB wasm core plus ~4–11 MB of language data per script, takes seconds a page on a mid
phone, and is often confidently wrong on 8 pt table digits. It needs an owner download approval
and a vendored-licence note. I would only reach for it if the cipher route fails on the fixtures.

**Fixtures.** The potatoes key (6 rows, checkable against the read); the Satsuma stay-home key panel
(14 cross + 5 backstitch, transcribed in wave E); Tiny Modernist autumn and matryoshka; the
tapestry-painted APL key (8 rows).

**Proof.** Every row is exact on the potatoes key. For the others: either exact or blank, never a
wrong number (asserted).

### 8. Find the chart on a busy page  · M
**What I see.** On the Satsuma sheet the app proposes a box around just the chart, "70 × 97
squares", outlining what it left out ("key", "picture"); Tiny Modernist autumn reads with no manual
crop; when unsure it offers two or three candidate boxes.

**Why.** The open wave J gap, measured today: Satsuma reads **88 × 110** with the key panel inside
the box (32 colours for a 14-colour key); autumn is refused ("more than 60 distinct colours"; the
page holds a key table, a photo and the chart); matryoshka read 86 × 119 for 81 × 66.

**How.** `detect` takes the biggest connected component. Instead: score 64 px page tiles for a 2-D
periodic lattice (the autocorrelation `detect` already has, run locally); grow the largest region of
agreeing square pitch; exclude key-like regions (a swatch column beside text rows, the row cutter of
proposal 7) and photo-like ones (smooth, no lattice); let a read key's colours tighten the choice.

**Proof.** Asserted exact sizes on Satsuma stay-home (70 × 97), summer's flight (44 × 70) and
sunshine. Tiny Modernist autumn reads 77 × 41, matryoshka 81 × 66, and DMC 2173 p3 the measured
~102 × 88 inside 110 × 96.

### 9. The designer's own symbols on my screen  · M
**What I see.** The chart and the key show **the same symbols as my paper copy**: Pac-Man's KG
glyphs, the wocs dingbats, the potatoes heart and cross. A switch, "Symbols: from the pattern /
the app's set", falls back to the app's set when a symbol cannot be read.
**Why.** Today every import gets the app's own set (wave E row 16). I hold the paper or the PDF in
my other hand: if the paper says ♥ and the phone says ▫, I mis-stitch.
**How.** Glyph-font charts: draw the key row's glyph with the embedded font (pdf.js loaded it) onto
a 24 px canvas. KG vector charts: draw the cell's symbol path from the operator list `extractGrid`
already walks. Pictures: the reader's `glyph` crops (wave J) and proposal 7's key crops. Store a
1-bit 16 × 16 bitmap (32 bytes) in `palette[i].glyph`; `drawSymbols` draws it as a sprite.

**Proof.** A pixel comparison of the app's sprite against the page crop, for each Pac-Man and
wocs key row.

### 10. Backstitch, French knots and fractionals out of a PDF  · L
**What I see.** After a KG or Tiny Modernist import, the Back and Knots layers fill in from the PDF.
They are drawn and counted like an OXS import ("1105 backstitch segments" is what Ursa's OXS
gives). A kit's outline is no longer something I have to remember from the paper.
**Why.** HANDOFF small item 8, wave E row 19, and research A2.4 (PK cannot do this, and
stitchers ask).
**How (vector).** In `extractGrid`'s operator-list pass, collect stroked segments with both ends on
the half-cell lattice, snap, merge collinear runs, and match stroke colour to the key's backstitch
rows (or the legend's swatch lines). Knots: small filled circles on a vertex. Fractionals: filled
triangles / half squares in a cell (the OXS model has the directions).
**How (pictures).** Remove the read crosses, find thin strokes off the grid-line lattice, line-fit
and snap to vertices. Harder: ship only with "unsure" outlines and the count shown.

**Fixtures.** Do the TM or KG fixtures have vector backstitch? This needs a check. The wave E
audit says the TM BS swatches are graphics. DMC 2173 is a picture with backstitch: it read 59
colour classes and "55 kinds of square have no key colour" today, mostly because of the
backstitch lines. **Ask:** a PK-style commercial PDF with vector backstitch and knots.
**Proof.** Segment counts per colour against a hand count on one fixture page. Ursa's OXS
round-trips.

### 11. Charts split across pages as pictures  · L
**What I see.** I drop a picture PDF of 6 chart pages (or 6 screenshots); the app shows the tiles
in a 3 × 2 layout with overlap rows greyed, asks "Is this the layout?", then assembles one chart
checked against the key's counts.
**Why.** The last import gap in HANDOFF, and the commonest Etsy format after vector.
**How.** Read each page with `XSRead`; place tiles by page order (row-major), the printed ruler
numbers (multiples of 10 in sequence, so proposal 7's cipher pins them) and overlap detection
(repeated edge columns have identical classes); cluster classes across tiles so one DMC is one
class everywhere.

**Proof.** Synthetic: render KG pages to pictures (as the wave J tests already do) and assemble.
The ground truth is `extractGrid` on the same PDF (Pac-Man 20 tiles, Portal's 1-column edge tile).
**Ask:** one real raster multi-page chart.

### 12. A stitched piece that grows: the cross-stitch centrepiece  · M (L with the time-lapse)
**What I see.** The tap button shows **my piece**: fabric with a weave texture, done stitches as
little thread Xs in the floss colour with a sheen, the rest as a faint printed ghost, backstitch on
top once done. "See it framed" puts it in a hoop or mat and frame at real size for my fabric. A
time-lapse replays it growing session by session; a share card at the finish.

**Why this and not 3D.** Crochet's 3D model earns its place because a 2D pattern does not show a
3D shape. Cross-stitch is flat, so a 3D model adds nothing. The thing stitchers photograph and
post is the WIP on the fabric, and "fills finished stitches with the real thread colour" is PK's
most-praised view (research A1.4). This is the equivalent emotional payoff.

**How.** Canvas 2D with a pre-rendered X sprite per colour at three tiers (shaded X above ~6 px a
stitch, flat swatch above 2 px, a pixel a stitch below); the weave is a pattern fill; a 500 × 500
overview is a 250k-pixel `ImageData`, the tap preview's cost today. Time-lapse: each session
(proposal 5) stores its done-bitmap delta in BlobStore (8 KB per session at 64k stitches), carried
by the `.thready` backup.

**Proof.** Visual QA screenshots in six themes. Frame time at 375 px on the Pokémon chart under
16 ms on desktop; measure on a phone (HANDOFF owner item 3).

### 13. Cross-country by colour: islands and travel  · S
**What I see.** With a colour current, the readout says "island 4 of 37 · 12 stitches here ·
nearest next island 3 cm away".
- A warning, "over 2.5 cm (1 in): start a new thread rather than carry", uses my fabric count.
- A confetti count per colour and per page: "DMC 3846: 41 % confetti".
- 🎯 steps island by island, not stitch by stitch.

**Why.** Cross-country stitchers work islands. Long carries show through light fabric. Confetti
is the hated metric nobody shows (research A2.2). `XStitch.confetti` already exists but is only
used in the photo readout.
**How.** Connected components per colour, computed lazily, plus a greedy nearest-island route.
Distance is cells ÷ effective count.
**Proof.** Unit tests on small charts. Pac-Man's 3820 (17 stitches) gives its island count.

### 14. Row by row that fits a real chart  · S
**What I see.** Row by row gets a scope (whole chart / this page / this 10-wide band), and done
stitches show as ticked runs inside a row.
**Why.** On Pac-Man, "Row 1" is 31 runs across 224 columns, and the 20 stitches I had marked in it
did not show as done in the chips. Nobody works a 224-wide row. The feature is great for the
potatoes-size charts it was built for (wave J), and needs a scope for big ones.
**How.** `writtenRows` already takes `yFrom` / `yTo`. Add `xFrom` / `xTo`, and mark done runs from
`progress.done`.
**Proof.** Unit tests on the band edges and partial runs.

### 15. One floss stash across every project, and a kitting list  · M
**What I see.** Settings → 🧵 My floss: what I own per code (a fast numeric keypad, or a DMC grid to
tick). Each Floss sheet says "need 3 skeins · you have 2 · 1 set aside for Pac-Man", and **Kit up**
lists what to buy for this project after my other WIPs' needs.

**Why.** The per-project "I own this" ticks own the same skein three times over (04 "needs
infrastructure"). Kit up is a named feature in X-Stitch Tracker (research A2.3), and it is why
stitchers keep spreadsheets.
**How.** `Settings.crafts.crossstitch.stash = {brand: {code: skeins}}`; allocation is computed
(active projects' needs, in order), never stored. **Shell dependency**: backup import ignores
`settings` today (HANDOFF), so fix that first or the stash is lost on restore.

**Proof.** Unit tests on allocation. A backup round trip keeps the stash.

### 16. Brand conversion and substitutions  · M (needs an owner decision)
**What I see.** Anchor, Madeira and Cosmo charts get real swatches and names; "Show as DMC" gives
the nearest DMC per row with a plain word ("very close / noticeable"); "I'm out of 3846" offers the
3 nearest in my stash.

**Why.** Today `FLOSS` is DMC-only, so an Anchor chart renders grey. Research A2.3: about 15–20 %
of DMC shades have no exact Anchor match, so matching by colour difference against each brand's
own RGB list is more honest than a lookup table.
**How.** Second and third RGB tables in the same structure, matched with the CIEDE2000 already in
the code.
**Owner decision / risk.** The source and licence of the Anchor and Madeira RGB values. MIT-style
community tables exist for DMC (ours is MIT), but Anchor and Madeira lists are mostly scraped.
Approve a source before anyone types one in.

### 17. Fabric, framing and hoop calculator  · S
**What I see.** Fabric & size gains a margin per side (3 in framing / 2 in hoop / custom), the cut
size, "fits a fat quarter (18 × 22 in)? yes, 2.1 in spare", the hoop or Q-snap to buy, mat and
frame openings, and the reverse ("8 × 10 frame: on 16 ct it fits / needs 18 ct").

**Why.** It is already "the best fabric calculator I have used on a phone" (04). This is the next
question I ask at the shop.
**Proof.** Unit tests on the arithmetic.

### 18. Very large charts: join quadrant files and move the cells off localStorage  · L
**What I see.** "Join with another file…" assembles the four Pokémon quadrant PDFs into one
798 × 1000 chart, and a 1000 × 1000 chart keeps per-stitch tracking instead of the 1 MB guard
downgrading it to counts mode.

**Why (measured today).** Pokémon-tl alone is 500 × 500 = **564 KB of craftData**, and
localStorage reached 1.37–1.42 M characters with the undo stack. The joined design is about 4×
that, which is over the `SIZE_WARN_BYTES` 1 MB guard and near the 5 MB budget. Also, the 40-page
cap kept 40 of Pokémon-tl's 72 pages, so 📄 cannot show the rest.

**How.** Cells and progress bitmaps move to BlobStore as `p:<id>:cells` / `p:<id>:done` (craftData
keeps a fingerprint; loaded on open); undo on big charts stores **diffs**, not snapshots; raise the
page cap or render pages on demand from stored PDF bytes.

**Dependencies.** The shell owns `js/store.js` and the backup; this needs a contract change.
Keep-both and restore paths must carry the new blobs.
**Proof.** Pokémon joined: 798 × 1000 cells. Tap under 20 ms. A reload restores progress, and a
`.thready` round trip restores it too. localStorage under 100 KB for the project.

### 19. The printable chart that knows my progress  · S
**What I see.** "Print what's left": done stitches hatched, the original page numbers kept (p9 on
paper is p9 in the app), parking markers shown, optional 2–3 stitches of greyed overlap.

**Why.** HANDOFF small item 4. The thing I take on the train.
**How.** `printableHTML` reads `progress.done`, `parking` and `pages[].region` for its tiling.
**Proof.** SVG tile tests: a done cell has the hatch class, and the page count matches the
regions.

### 20. Adjacent grid crafts: a "kind" switch, not new crafts  · M each
The chart engine (cells, palette, progress bitmap, rulers, block counting, row-by-row, the photo
converter, the picture reader) already fits most counted grid crafts. My ranking:

| craft | verdict | what changes |
|---|---|---|
| **Diamond painting** | **yes, first**. Hugely popular kits, the same "symbol + DMC code" charts, and no good free tracker | Drill counts (packs of 200; round or square), "bag" numbers, no fabric or strands, canvas sections instead of pages. Reuse everything else |
| **Filet crochet** | **yes, under crochet**. It belongs with the crochet users we already have | A 2-colour grid of open and filled meshes. `writtenRows` already writes runs, so it becomes "Row 5: 3 open, 7 filled, …" turned into "ch 2, dc" instructions. APL Priscilla and dg003 are real filet and cross-stitch books in `tmp-pdf/` |
| **Knitting colourwork** | **yes, small**. The photo converter with a non-square cell (stitch aspect ~0.75–0.8) and 2–6 colours makes a Fair Isle or intarsia chart for knitting projects | The `XStitchPhoto` aspect parameter, then a hand-off to `KnitChart` row text |
| **Needlepoint / tapestry** | maybe, as a fabric kind | Mesh count, tent stitch (continental / basketweave) yarn maths, wool brands. `xs-apl-tapestry-painted` is a fixture |
| **Fuse beads** | no for now | Perler / Hama palettes need licensed colour data. Pegboard tiles = pages is cute, but the audience overlap is small |

**How.** `craftData.kind: 'cross' | 'diamond' | 'needlepoint'`, which changes the labels, the
material maths and the fabric sheet only. Filet lives in the crochet craft as a chart part type.
**Ask.** The owner decides whether diamond painting is in scope.

### 21. "Find my place" keypad and goals  · S
**What I see.** In stitch mode, a jump keypad ("col 134 row 57", "page 9", "block 13,6") lands the
crosshair there (`centerOn` exists; UI only). Goals: "finish page 9 by Sunday", "500 a day", with a
ring on the home card and a celebration when met: crochet's targets/alerts, built on 4 and 5.

---

## 3. Top 8

1. **The honesty sweep (1).** One total everywhere, symbols you can tell apart, a confirm before
   a 21k-stitch mark: trust first.
2. **Stitch mode (2).** A full-screen chart with highlight and a keyboard: the phone stops needing
   to be a tablet.
3. **Parking on the chart (3).** Markers in the right corner, plus the "next block" assistant: the
   reason parkers use PK.
4. **Pages on the chart (4).** Printed page boundaries, page progress, and a "Mark page done"
   that really marks the page's stitches.
5. **Sessions, pace, finish date (5).** Stitches per day moves when percent does not.
6. **Symbol-font charts from the text layer (6).** Tiny Modernist-style Etsy PDFs become real
   charts, matched by font code, with no recognition at all.
7. **Key pictures read as a cipher (7).** Digits pinned by the chart's own counts and the DMC
   table: no OCR, no wrong numbers.
8. **The stitched piece that grows (12).** Cross-stitch's answer to crochet's 3D model.

**The one thing I would build first: proposal 2 + 1 together, "Stitch mode" with the honesty
sweep.** Every other proposal (parking markers, page outlines, highlight, sessions, the stitched
render) is drawn *into* that full-screen chart, so it is the frame the rest hangs on. It is
almost all UI over data and functions that already exist (`makeChartView`, `view.isolate`,
`nextStitchNear`, `pages[].region`). The honesty fixes are the trust floor under it.

---

## 4. Do not build

- **A 3D model of the piece.** Cross-stitch is flat. The stitched-look 2D render (12) gives the
  same payoff for a fraction of the cost and runs on any phone.
- **Server or LLM chart reading** (for example, send the PDF to a vision model). It has a
  per-user cost, sends paid patterns off the device (designers' licences forbid redistribution),
  and on every fixture we have, the on-device readers are already exact or honestly refuse.
- **Bundling Tesseract.js as the first answer to image keys.** It is 6–13 MB, seconds per page,
  and confidently wrong on small table digits. Only consider it if proposal 7's cipher fails on
  the fixtures, and then only behind an owner download approval and a licence note.
- **A floss lookup table typed from a website** (DMC ↔ Anchor). It has unclear licensing and
  false precision. Match on per-brand RGB lists instead (16), once a source is approved.
- **Automatic stitch detection from a camera photo of my fabric** ("scan my progress"). Thread
  sheen, perspective and tension make it unreliable, and a wrong "done" is worse than none.
- **Cloud sync** as part of this wave. It has a running cost. The `.thready` file is the honest
  answer for now.
- **Fuse-bead mode** (see 20): licensed palettes and a small audience overlap.
- **Re-lettering every existing project's symbols automatically** (1, 9). It moves symbols under
  a stitcher mid-project. Make it opt-in only.
- **A "whole colour" mark with no confirmation on big counts.** Keep the tool, but it must ask
  above a threshold (1).

---

## 5. Asks for the owner

1. **Fixtures.**
   - **The real "Po Ta Toes" PDF**, still owed since wave J. It gives the high-resolution read and
     the true extractor output for the Floss list key.
   - **A PK-style commercial chart** with vector backstitch and French knots (HANDOFF item 2), for
     proposal 10.
   - **A raster multi-page chart** (a picture PDF split over 4+ pages, or the screenshots of one),
     for proposal 11.
   - **The FlossCross PDF + OXS pair** (HANDOFF item 1).
   - **One Anchor-keyed chart** if (16) goes ahead.
2. **Decisions.**
   - The Anchor / Madeira colour data source and its licence (16).
   - Whether diamond painting and filet crochet are in scope (20).
   - Whether symbols switch to the designer's set by default or opt-in (9).
   - The default scope for 10×10 when a colour is merely current (04 #13: I say the current
     colour, with a "whole block" chip).
3. **Shell / contract changes that other lenses will feel.**
   - The cells and progress bitmaps move to BlobStore, with diff-based undo for big charts (18).
   - Backup import must restore the `settings` block before a cross-project stash exists (15).
4. **A real-device check.** Stitch mode, pinch, long-press-to-park and the stitched render have
   only ever run on desktop with synthetic pointers. One phone session before shipping
   (HANDOFF owner item 3).
5. **No downloads are needed** for proposals 1–15, 17–21. Proposal 7's fallback (Tesseract.js)
   would need a download approval; 16 needs the data-source decision.
