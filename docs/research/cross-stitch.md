# Cross-stitch module — research and proposed spec

Research report + proposed technical spec for adding a **cross-stitch** craft to Thready or Not.
Written 2026-09-15. Companion to `docs/CRAFTS.md` (the shell ↔ craft plugin contract), which this
document assumes as already-agreed; every API named there is used here as-is.

Nothing in this document has been built. It is the input for a build agent.

---

## 0. Executive summary

1. **The "drop a PDF and immediately have the info" promise is only half-deliverable for cross-stitch,
   and that is fine.** The *legend*, *fabric* and *design size* are plain text on the cover page of
   almost every commercial chart, so `PdfText.extract` already gets us 80% of what a stitcher needs to
   set up a project: floss list, strands, stitch counts, skein estimates, design size in stitches, and
   finished size at 14/16/18 ct. The *chart grid* itself is a different problem: only apps with a
   maintained per-designer whitelist (Pattern Keeper) reliably reconstruct cells from a PDF, and
   Pattern Keeper's own designer page says *"The complexity of the PDF format makes it so that it is
   impossible to set any strict guidelines"* ([patternkeeper.app/for-designers](https://patternkeeper.app/for-designers/)).
   So: **v1 parses the key and renders the chart pages as images** for a pan/zoom viewer, which is
   instantly useful and cannot fail badly.
2. **The real cell-level grid comes from OXS**, an open, documented, plain-XML format
   ([ursasoftware.com/OXSFormat](https://www.ursasoftware.com/OXSFormat/)) that WinStitch/MacStitch,
   DP Software's Cross Stitch Professional Platinum, KXStitch, FlossCross and Cross Stitch Saga read
   and write. `DOMParser` handles it in ~200 lines. Every other interchange format (.pat, .xsd,
   .chart, KG-Chart .sth) is undocumented proprietary binary and should be out of scope.
3. **Photo → chart needs no server, no LLM, and no tokens.** The whole chain (area-average downsample
   → CIELAB → k-means → nearest-DMC by ΔE → confetti cleanup → symbols) is ~1.4 s on a mid phone for a
   200×250 chart, with image decode the dominant cost. Detailed budget in §A3.
4. **The defensible gap in the market is exactly what this app already is:** free/one-time, offline,
   iOS *and* Android, phone-first, no account. The category leader is Android-only, has no sync, and
   *"currently only supports full cross stitches"* — no backstitch, no fractionals, no French knots
   ([patternkeeper.app/faq](https://patternkeeper.app/faq/)).
5. Proposed build: `js/xstitch.js` + `js/app-xstitch.js` + `css/xstitch.css` + `js/xstitch-photo.js`,
   registering through `App.registerCraft` / `Store.registerCraft`. **Zero edits to crochet code.**

---

# PART A — RESEARCH

## A1. How cross-stitch patterns are delivered today

### A1.1 The PDF chart: anatomy

A commercial counted cross-stitch PDF is remarkably standardised. Almost every one has:

| Section | Typical content | Machine-readable? |
|---|---|---|
| **Cover / info page** | Design title, designer, copyright line. **Stitch count** ("71W × 71H"). **Finished size** at one or several fabric counts ("5.1 × 5.1 in on 14ct"). Fabric name/colour/count. Number of floss skeins. "Stitches used: cross stitch, backstitch, French knot". | **Yes** — plain text |
| **Floss key / legend** | A table: `Symbol \| Brand+number \| Colour name \| Strands \| Stitches \| Skeins`. Often a colour swatch column. Separate blocks for backstitch and French knots. | **Mostly** — text, but the symbol glyph is the weak point |
| **Chart pages** | The grid. Heavy rules every 10 squares, row/column numbers in the margins every 10, centre arrows, and for large charts a tiled layout (pages A1/A2/B1…) with a few stitches of greyed overlap and an index/overview sheet. | **Rarely** — see A1.4 |
| **Instructions / stitch diagrams** | How to start, over-2, fractional-stitch diagrams. | Yes, but not useful |

The key table columns are consistent enough to parse: the canonical order is
`Symbol | DMC number | Colour name | Skeins | Stitches`
([Fat Quarter Shop](https://www.fatquartershop.com/how-to-read-a-cross-stitch-pattern),
[Two Little Kits](https://twolittlekits.com/blogs/lesson/reading-a-cross-stitch-pattern)), with strand
count sometimes as its own column and sometimes as a global note ("2 strands throughout").
Heavy gridlines every 10 and centre arrows are universal
([Fat Quarter Shop](https://www.fatquartershop.com/how-to-read-a-cross-stitch-pattern)); page tiling
with greyed overlap is the norm for anything over ~120 stitches wide
([Stitchmate](https://stitchmate.app/guides/cross-stitch-pattern-pdf-quality),
[StitchiStudio](https://stitchistudio.com/en-us/blogs/tips-and-inspiration/pdf-cross-stitch-pattern-print-organize)).

Symbol conventions: full cross = a symbol in a cell; half = `/` or `\`; three-quarter = a triangle
whose orientation encodes position; **backstitch = a line drawn along/between gridlines, not a cell
symbol**; French knots and beads = dots with their own legend rows
([StitchThis notation guide](https://stitchthis.io/blog/cross-stitch-pattern-symbols-and-notation-guide)).
That backstitch-as-edge fact is the single biggest data-model consequence: a cell array is not enough.

### A1.2 Interchange formats

| Format | Owner / apps | Nature | Documented? | Browser-JS parseable? |
|---|---|---|---|---|
| **OXS** (.oxs) | Ursa Software; WinStitch/MacStitch 2021+, DP Software CSP Platinum, KXStitch, FlossCross, Cross Stitch Saga, Pattern Maker | **Plain XML, UTF-8** | **Yes, publicly** ([spec](https://www.ursasoftware.com/OXSFormat/)) | **Yes — trivial** (`DOMParser`) |
| PCStitch (.pat) | PCStitch 7–11 | Proprietary binary, changes between majors (v8 drops backstitch/knots on third-party import; v9–11 must "save as 7" first — [Xstitchify](https://xstitchify.com/import/)) | No | No — reverse-engineering only |
| Pattern Maker (.xsd) | Hobbyware | Proprietary binary | No. KXStitch's maintainer asked users to *supply examples so the format could be reverse-engineered* ([SF #10](https://sourceforge.net/p/kxstitch/feature-requests/10/)) | No |
| WinStitch/MacStitch (.chart) | Ursa Software | Proprietary — **but the same app exports OXS one click away** | No | No (and unnecessary) |
| KG-Chart / StitchSketch (.sth, .sthbw, .sthmb) | Ikuta Software | Proprietary; StitchSketchEx imports its own legacy files only | No | No |
| CSTX | MyCozyApp | Deliberately **encrypted** DRM distribution format ([mycozyapp](https://mycozyapp.com/about-oxs)) | No | No, by design |

**Verdict: support OXS, and nothing else binary.** Everything proprietary either has an OXS export path
or is a dead end. Note also a licence trap: KXStitch (the one open-source reader of PCStitch files) is
**GPL-2.0-or-later**; this app ships a proprietary `LICENSE`, so its code must not be copied or
transliterated.

### A1.3 OXS in detail

Root `<chart>`, then `format`, `properties`, `palette`, `fullstitches`, `partstitches`,
`backstitches`, `ornaments_inc_knots_and_beads`, `commentboxes`. `properties`, `palette`,
`fullstitches` and `backstitches` are mandatory even when empty. Verbatim from the spec:

```xml
<properties software="Ursa Software" software_version="2020"
  chartheight="74" chartwidth="89" charttitle="The Cottage"
  author="" copyright="(c) Peter Bristow"
  instructions="Cottage is based upon his own house."
  stitchesperinch="14" stitchesperinch_y="14" palettecount="13" />

<palette>
  <palette_item index="0" number="cloth" name="cloth" color="FFFFFF"
    printcolor="FFFFFF" blendcolor="nil" comments="" strands="2"
    symbol="100" dashpattern="" misc1=""/>
  <palette_item index="1" number="DMC 781" name="Topaz V DK" color="A26D20"
    printcolor="A26D20" bscolor="A2FFFF" blendcolor="nil" comments=""
    strands="2" bsstrands="1" symbol="21" dashpattern="" misc1=""/>
</palette>

<fullstitches>
  <stitch x="1" y="47" palindex="3"/>
  <stitch x="1" y="49" palindex="3" marked="true"/>
</fullstitches>

<partstitches>
  <partstitch x="38" y="68" palindex1="2" palindex2="13" direction="1"/>
</partstitches>

<backstitches>
  <backstitch x1="23" x2="27.5" y1="4" y2="8.5" palindex="1"
    objecttype="backstitch" sequence="0"/>
</backstitches>

<ornaments_inc_knots_and_beads>
  <object x1="2" y1="3.5" palindex="1" objecttype="fullcross"/>
  <object x1="28" y1="108" palindex="14" objecttype="tent" direction="1"/>
</ornaments_inc_knots_and_beads>
```

Practical notes for a parser:
- `palette_item index="0"` is conventionally the **cloth/background**, not a floss. Skip it for the key.
- `number` is free text: `DMC 781`, `781`, `Anchor 403`, `cloth`, `B5200`, `Blanc`. Split brand off.
- `color` is hex **without** `#`. `blendcolor="nil"` means no blend.
- `symbol` is a **number**, not a character — it indexes the writing app's own symbol font. We must
  therefore **assign our own glyphs** and only treat the OXS `symbol` as a stable ordering hint.
- Backstitch coordinates are on the **vertex lattice** and may be fractional (`27.5`), i.e. they run
  between cell corners, including to cell midpoints.
- `marked="true"` already carries per-stitch progress, which we can import as initial done-state.
- `stitchesperinch` / `stitchesperinch_y` give the design's intended fabric count.

There is no formal licence statement on the spec page; it is published as an open interchange format
with an explicit invitation to implement it.

### A1.4 What existing PDF-reading apps actually do, and what fails

- **Pattern Keeper** (Android, ~$9 one-time after a ~1-month trial) is the category leader: it joins
  tiled pages into one continuous chart, highlights a symbol chart-wide, counts remaining stitches per
  colour, fills finished stitches with the real thread colour, and records parking markers *including
  which corner of the square* ([patternkeeper.app](https://patternkeeper.app/),
  [help: highlighting](https://patternkeeper.app/help/highlighting-your-progress/)).
  It does **not** OCR: it reads structure out of the PDF. But its compatibility is maintained as an
  **empirical designer whitelist** (well supported: Heaven and Earth, Charting Creations, Artecy, Paine
  Free Crafts, Pic2Pat, Tilton, Orenco, Advanced Cross Stitch…; "no guarantees": Long Dog Samplers,
  Golden Kite, Gecko Rouge, Heartstring Samplery, Kooler)
  ([supported designers](https://patternkeeper.app/supported-designers/)), plus export guides for
  WinStitch/MacStitch, PC Stitch and DP Professional. Documented failure modes: unsupported generator,
  several charts in one PDF, and non-chart pages that *look* like charts (a mock-up with gridlines, an
  alphabet page) producing a grey X ([help](https://patternkeeper.app/help/why-did-my-pattern-get-a-grey-x-on-it/)).
  A photographed paper chart can be loaded but "you will not be able to search or add thread numbers".
  **Crucially, it supports full cross stitches only** — no backstitch, fractionals or knots
  ([FAQ](https://patternkeeper.app/faq/)) — and there is no automatic sync.
- Third-party guidance converges on: symbols must be **embedded font glyphs** (often a custom TrueType
  built from SVG symbol definitions) rather than rasterised; grid lines must be **vector**, not a
  screenshot; page boundaries must be predictable with a few stitches of greyed overlap; and the key
  must be **text**, not an image of a table
  ([Stitchmate](https://stitchmate.app/guides/cross-stitch-pattern-pdf-quality)). Custom fonts that map
  symbols to non-standard Unicode positions confuse detection.
- **Markup R-XP** (iOS/Android/M1 mac, £14.99/yr or a one-time tier) is the only app that credibly
  claims raster symbol recognition: it loads "almost any chart" *including photos and scans*,
  auto-detects symbols and colours, reads the key, joins pages, and supports backstitch, fractionals
  and blackwork ([markuprxp.co.uk](https://markuprxp.co.uk/)). Complaints: learning curve,
  symbol-detection inconsistency needing sensitivity tweaks, subscription, no auto sync.
- **Cross Stitch Saga** ($14.99 iOS; Android sales suspended) has the richest stitch-type support
  (cross, half, quarter, petit, oblong, backstitch, longstitch, French knot, decorative) and a
  materials calculator, but **cannot open PDFs at all** — only XSD / XSPro / PC Stitch 6–10 /
  Win+MacStitch / OXS. Its reviews are dominated by this: *"99% of sellers don't give you the file
  types this app offers because svg and pdf are standard"*
  ([App Store reviews](https://apps.apple.com/us/app/cross-stitch-saga/id1440279996)).
- **StitchSketch / StitchSketchEx** is a chart *designer*, importing only KG-Chart's own formats.
- **Stitch Fiddle**'s progress tracker explicitly **"cannot currently be used for cross stitch
  projects"** ([help](https://www.stitchfiddle.com/en/help/1pdx-98nqe4/progress-tracker)).
  **Chartminder** and **FlossCross** are makers, not trackers; FlossCross is free, no-registration,
  browser-local, DMC-only, 300×300 max, and exports **PDF and OXS**.
- A *reference implementation* worth reading (not copying — check its terms first): `Kate-nc/cross-stitch`
  ("stitchx"), an ISC-licensed, fully client-side React app that already does OXS parsing, pdf.js
  extraction, k-means + Floyd–Steinberg photo conversion, CIEDE2000 blend detection, IndexedDB storage
  and Web Workers ([github.com/Kate-nc/cross-stitch](https://github.com/Kate-nc/cross-stitch)).
  `Mickey1992/stitch-pdf2oxs` (Java) attempts PDF → OXS directly
  ([github](https://github.com/Mickey1992/stitch-pdf2oxs)).

### A1.5 What this means for us

`PdfText.extract` already produces exactly the input a **key parser** wants: lines grouped by Y,
two-column pages untangled, page markers, page furniture dropped. Reading a legend out of that is the
same class of problem as `Patterns.parse`, and the existing parser architecture transfers directly.

Reading the **grid** is a separate, much riskier project. The honest technical statement is: pdf.js's
`page.getTextContent()` returns items with a transform matrix (x, y), width, height and `fontName`
([pdf.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)), so for charts whose
symbols are individually-positioned font glyphs you *can* bucket items into a lattice and recover
cells. But items are not reliably one glyph each, custom symbol fonts often lack a usable `ToUnicode`
map (giving PUA code points or `�`), and raster charts give nothing. **Treat full-grid PDF
extraction as an experiment behind a flag (§B3.4), never as the v1 promise.**

---

## A2. How people stitch, and what they track

### A2.1 Stitching orders

- **Cross-country**: work one colour across a whole section, travelling behind the fabric. Needs
  confident counting and a chart-wide "where else is this symbol" view
  ([Stitching Daily](https://stitchingdaily.com/cross-stitch-parking-vs-cross-country/)).
- **Row-by-row / block**: work a 10×10 block or a row of ten at a time, changing colour constantly.
- **Parking**: work a small area; when a colour's next appearance is outside it, bring the needle up in
  that future stitch's hole and leave it dangling rather than ending the thread
  ([Scarlet Quince](https://www.scarletquince.com/parking.php),
  [Peacock & Fig](https://peacockandfig.com/2015/03/cross-stitch-how-to-park-your-threads/)).
  Two variants: **block parking** (finish a 10×10, park each colour into the next block) and
  **row/column parking** (work one column of ten, park each colour one column ahead and leapfrog)
  ([Thread Bare](https://www.thread-bare.com/blog/thread-parking-method-cross-stitching)).
  Stitchers routinely manage 3–5 parked colours; on huge charts, dozens.

**Tracker consequence:** parking is the strongest argument for state beyond done/not-done. Pattern
Keeper's parking marker records **which corner of the square** a thread is parked in. On paper the
analogue is a second highlighter colour.

### A2.2 Page-by-page, confetti, gridding

- **Page as a first-class unit.** People set goals like "finish page 7"; Pattern Keeper sells "select
  all stitches on a page or in a square". Even with a joined chart view, keep page and 10×10 block as
  navigation and goal units.
- **Confetti** = isolated single stitches surrounded by other colours. Hated because every one is a
  re-thread with no neighbours to bury the end under; pain reportedly starts above ~5–10% of the chart
  ([Caterpillar](https://www.caterpillarcrossstitch.com/blogs/blog/cross-stitch-confetti-stitches-guide-for-beginners),
  [Xstitchify](https://xstitchify.com/cross-stitch-confetti/)). A **confetti count per page and per
  colour** is a cheap, genuinely novel metric for us to show.
- **Gridding** = drawing 10×10 boxes on the fabric with washable pen, Easy Count Guideline thread, or
  pre-gridded Zweigart Easy Count Aida
  ([Sirious Stitches](https://sirithre.com/gridding-for-cross-stitch-techniques-to-help-with-counting-stitches/),
  [DoodleCraft](https://doodlecraftdesign.co.uk/pages/gridding-fabric-for-cross-stitching)).
  Our chart viewer must therefore show **10×10 majors aligned to the fabric grid** and display
  coordinates, so "row 40, column 70" is findable.
- **Marking off**: digitally means tapping/dragging cells to finished, with finished cells filled in the
  real thread colour so the screen mirrors the fabric; highlighting a symbol restricts selection to that
  symbol — effectively a "current colour" lock ([PK help](https://patternkeeper.app/help/highlighting-your-progress/)).

### A2.3 Fabric, strands, floss, stash, time

- **Finished size** = stitches ÷ count per axis; add ~3 in per side (≈ +6 in per axis) for framing
  ([Lost in Cross Stitch](https://www.lostincrossstitch.com/calculate-cross-stitch-fabric-size/)).
  Aida counts directly (11/14/16/18). Evenweave and linen (25/28/32) are normally stitched **over 2
  threads**, halving the effective count — 28ct over 2 = 14ct stitch size — and allow fractionals
  ([Cross Stitched](https://cross-stitched.com/en-us/blogs/what-is-cross-stitch/cross-stitch-fabric-counts)).
- **Strands**: ~3 on 11ct, 2 on 14/16ct and 28-over-2, 1–2 on 18ct+.
- **Skeins**: a DMC skein is ~8 m / 8.7 yd of 6-strand. Published "stitches per skein" at 14ct/2 strands
  ranges from **~960 to ~1,785** depending on waste and tension
  ([Cross Stitch Boutique](https://www.crossstitchboutique.com/how-much-floss-needed-for-cross-stitch-complete-guide-2025/),
  [Stitchmate](https://stitchmate.app/tools/thread-usage-calculator)). **Show a range, not false
  precision.**
- **Conversions** DMC↔Anchor↔Madeira are approximate; roughly 15–20% of DMC shades have no exact Anchor
  equivalent. Better design: store each brand's own RGB list and run the same ΔE matcher, rather than
  shipping a lookup table.
- **Stash / "kit up"**: cross-referencing a pattern's floss list against what you own and generating a
  shopping list is a named, real feature (X-Stitch Tracker's "Kit Up",
  [xstitchtracker.com](https://xstitchtracker.com/)). Today stash and chart live in different apps,
  which is why forum members fall back to Excel.
- **Time / rotation / WIPs**: session logs with hours + stitch counts, daily pace, streaks, WIP photos,
  and deliberate project **rotation** (WIPocalypse is an annual community rotation challenge,
  [Measi's Musings](https://measi.net/wipocalypse-2024-kickoff-post/)). Our existing timer, history and
  status model already covers most of this.

### A2.4 What stitchers praise and complain about

Praised: joined multi-page charts; symbol highlight + per-colour remaining countdown; finished stitches
filled in the thread colour; one-time purchase; parking markers.

Complained about, repeatedly:

| Complaint | Source | Our position |
|---|---|---|
| **Android-only** category leader | PK FAQ answers iOS with "No not yet." ([FAQ](https://patternkeeper.app/faq/)) | We are a PWA. iOS + Android + desktop, free. |
| **No backstitch / fractionals / knots** | [PK FAQ](https://patternkeeper.app/faq/) | Model them from day one (OXS gives them free). |
| **Won't open my Etsy PDF** | [Saga reviews](https://apps.apple.com/us/app/cross-stitch-saga/id1440279996) | Key-parse + page images always works. |
| **Subscriptions** | [Lord Libidan](https://lordlibidan.com/the-best-apps-for-cross-stitchers/) | Already our model. |
| **No sync; manual export/import only** | PK FAQ; Markup R-XP | Our export/import JSON is the same trade-off — be honest about it. |
| **Abandoned apps** | forum: "no longer being updated, which makes it useless" | — |
| **Needs a tablet in practice** | PK only unlocks mark mode when zoomed far enough to see symbols ([help](https://patternkeeper.app/help/highlighting-your-progress/)) | **Phone-first is our differentiator**: a big tap button + current-colour counter works at 375 px where a 50k-cell grid does not. |

*Caveat on sourcing:* the researching agent could not access reddit.com, so no r/CrossStitch quotes are
claimed here; the above comes from vendor docs, app-store reviews, forums and blogs.

---

## A3. Photo → pattern (stretch goal)

### A3.1 What converters expose

| Tool | Parameters | Limits |
|---|---|---|
| [Pic2Pat](https://www.pic2pat.com/index.en.php) | colours (≤60), artwork size, stitches/inch, width in stitches | Free; 18 MB upload; PDF out with symbol chart, key, skein counts |
| [FlossCross](https://flosscross.com/) | photo import + full editor, 498 DMC, backstitch, half/petite, PDF + OXS export | Free, no account, browser-local; ~300×300 |
| [Stitch Fiddle](https://www.stitchfiddle.com/en/help/1pej-wc93j/import-picture) | colours, columns × rows, rotation, gauge | Free 50 colours/300×300; premium ~$2.75/mo |
| [Xstitchify](https://xstitchify.com/cross-stitch-confetti/) | colours, width, **confetti cleanup strength** (light/medium/strong), 8-neighbour multi-pass smoothing | Free tier |
| [Chart Minder](https://www.chart-minder.com/) | photo "scan" to chart | Charts public unless Pro |

The common denominator is tiny: **max colours, width in stitches, fabric count, crop**. Almost nobody
exposes dithering or the distance metric. Confetti control is the feature newer tools compete on.

### A3.2 The algorithm chain

1. **Decode + crop.** `createImageBitmap`, cap long edge ~1200 px. This is the most expensive step for a
   12 MP phone photo.
2. **Resample to the stitch grid** by **box/area averaging** in **linear light**, not nearest neighbour
   (NN picks one pixel of nine → jagged edges and colour noise) and not gamma-encoded sRGB (averages
   skew dark).
3. **Convert to CIELAB (D65)**. Euclidean distance in Lab approximates perception (ΔE*ab ≈ 2.3 ≈ a
   just-noticeable difference, [Color difference](https://en.wikipedia.org/wiki/Color_difference)),
   whereas RGB distance badly misweights green vs blue.
   ```
   lin(c) = c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4        // c in 0..1
   XYZ = [0.4124564 0.3575761 0.1804375;
          0.2126729 0.7151522 0.0721750;
          0.0193339 0.1191920 0.9503041] · [R,G,B]lin
   Xn,Yn,Zn = 0.95047, 1.00000, 1.08883                            // D65
   f(t) = t > 216/24389 ? cbrt(t) : ((24389/27)*t + 16)/116
   L* = 116 f(Y/Yn) - 16;  a* = 500(f(X/Xn)-f(Y/Yn));  b* = 200(f(Y/Yn)-f(Z/Zn))
   ```
   Precompute a 256-entry linearisation LUT.
4. **Quantize to k colours.** Median cut is fast but errs in sparse colour regions; octree is O(N) time
   / O(K) memory ([Leptonica](http://www.leptonica.org/papers/colorquant.pdf)); Wu's variance-splitter
   is the best splitting method; **k-means directly minimises the objective we care about** and is the
   right choice at k = 10–40 over only 50k cells
   ([Celebi 2011](https://faculty.uca.edu/ecelebi/documents/IMAVIS_2011.pdf)). Seed with **k-means++**
   ([Arthur & Vassilvitskii](http://theory.stanford.edu/~sergei/papers/kMeansPP-soda.pdf)) or, faster,
   with a median-cut result; 15–25 Lloyd iterations, early exit when max centroid movement < 0.5 ΔE.
   *Worth trying:* constrain centroids to snap to the nearest floss each iteration (k-medoids over the
   DMC set), which removes the two-stage drift where free centroids land between flosses.
5. **Map to DMC.** ΔE76 = plain Euclidean Lab. CIEDE2000 adds SL/SC/SH weighting and the RT hue-rotation
   term near 275° (authoritative notes, test data and reference implementation:
   [Sharma's CIEDE2000 page](https://www.hajim.rochester.edu/ece/~gsharma/ciede2000/)).
   **Use ΔE76 in the k-means inner loop and CIEDE2000 only for the final centroid → floss mapping.**
   Quantize-then-match is 30 centroids × ~450 flosses ≈ 13,500 evaluations (sub-millisecond); matching
   every cell instead is 22.5 M evaluations, which is tens of ms with ΔE76 but 1–3 s with CIEDE2000.
   De-duplicate: if two centroids land on the same floss, merge and hand the slot back to k-means.
6. **Dithering: default OFF.** Floyd–Steinberg (7/16, 3/16, 5/16, 1/16, serpentine) and ordered Bayer
   both work, but every dithered cell is a thread change — error diffusion manufactures confetti. Offer
   it as an off-by-default toggle, optionally at 50% error strength.
7. **Confetti cleanup** on the index grid: a **majority filter** (if the centre index occurs ≤ 1 time in
   its 3×3, replace with the modal neighbour, tie-broken by smallest ΔE to the cell's *pre-quantization*
   Lab, which must be kept so repeated passes don't drift) and/or **connected components** (8-connected,
   explicit stack, never recursion; reassign components smaller than `minRun` to the bordering component
   with the largest shared boundary). 2–3 passes, ~450k ops each. A 3×3 **median filter on Lab before**
   quantization is cheaper still and kills photographic noise at source. Report the confetti count
   before/after as a UI metric.
8. **Symbols.** One glyph per palette colour. ~30–40 distinct symbols is the practical legibility
   ceiling before confusable pairs appear; good sets use fundamentally different shapes, not size
   variants of one shape. Assign the simplest, lowest-ink glyph to the highest-count colour; set glyph
   ink by luminance (**L\* < 50 → light glyph on the swatch, else dark**); sort the palette by Lab and
   alternate glyph *families* so adjacent shades never get similar symbols.
9. **Floss estimate.** Thread per full cross ≈ `2.50 cm × 14 / count` (11ct 3.18, 14ct 2.50, 16ct 2.19,
   18ct 1.94, 22ct 1.59; 28ct over 2 = 2.50). A skein is 8 m of 6-strand, so usable length at `s`
   strands = `8 × 6/s` m.
   ```
   skeins_i = ceil( stitches_i * lenPerStitch_cm * (1 + waste) / (800 * 6/strands) )
   ```
   At 14ct/2 strands that is 24 m / 0.025 m ≈ **960 stitches per skein**, ~800 with 20% waste.
10. **Finished size.** Aida `inches = stitches / count`; evenweave over 2 `stitches / (count/2)`;
    fabric to buy = design inches + 6 in per axis.

### A3.3 Performance — this runs on a phone, offline, in ~1.4 s

200 × 250 = 50,000 cells, all typed arrays:

| Stage | Ops | Budget |
|---|---|---|
| Decode + intermediate downscale | — | 100–300 ms (**dominant**) |
| Area average, ~1.4 M src px × ~6 ops | ~10 M | < 30 ms |
| sRGB→Lab, 50k cells (150k `cbrt`) | ~2 M | < 15 ms |
| k-means++ seeding, k=30 | 1.5 M | < 20 ms |
| Lloyd, k=30, d=3, 20 iters | **90 M** mult-add | 0.2–1.0 s |
| Nearest-DMC, 30 × 450, CIEDE2000 | 13.5 k | < 5 ms |
| Cleanup, 3 passes × 9 neighbours | ~1.4 M | < 10 ms |

Mobile JS engines run tight `Float32Array` mult-add loops at 10⁸–10⁹ ops/s per core; typed arrays are
4–6× faster than plain arrays for bulk numeric work. **Total well under 1.5 s**, with decode the visible
cost. Seeding k-means from median cut roughly halves the dominant term.

Run it in a **Web Worker** and post `ImageData.data.buffer` as a transferable (zero-copy).
`OffscreenCanvas` is ~95% supported (Safari 16.4+ including iOS, [caniuse](https://caniuse.com/offscreencanvas))
but **is not needed**: decode on the main thread with `createImageBitmap` + `drawImage`, then transfer
the raw buffer. That path works everywhere.

### A3.4 DMC colour data and licensing

| Source | Entries | Fields | Licence |
|---|---|---|---|
| [sharlagelfand/dmc](https://github.com/sharlagelfand/dmc) (R package, `data-raw/`) | **454** | number, name, hex, r, g, b | **MIT** — the safe one |
| [seanockert/rgb-to-dmc](https://github.com/seanockert/rgb-to-dmc/blob/master/rgb-dmc.json) | 450 | floss, description, r, g, b, hex, row | **No LICENSE file → treat as all-rights-reserved** |
| [nathantspencer/DMC-ColorCodes](https://github.com/nathantspencer/DMC-ColorCodes) | full set | CSV | check repo |
| [zilliah/embroidery-floss-api](https://github.com/zilliah/embroidery-floss-api) | DMC subset | JSON | check repo |

**How many:** DMC's Mouliné Spécial 117 line reached **500 shades** after the 01–35 greys were added in
2017 ([Cross Stitched](https://cross-stitched.com/en-us/blogs/what-is-cross-stitch/dmc-thread-chart-colours));
community lists commonly carry 447–498 because they predate that or exclude specialty lines.

**Critical caveat:** there is **no official DMC RGB table**. Every hex list is a scan or eyeball
approximation of a physical colour card, which is why the repos disagree by several units per channel.
We inherit a few ΔE of error *before* the matcher runs — a strong argument against over-engineering the
distance metric.

**Legal:** colour numbers and names are product facts, not individually copyrightable; "DMC" is a
registered trademark, so use it **nominatively** ("DMC 310 Black"), never reproduce DMC logos or trade
dress, and never imply endorsement. A curated chart's selection/arrangement and someone's measured RGB
table may carry their own rights — another reason to take the MIT data. *Not legal advice.*

### A3.5 What an LLM would add: nothing

Every step is closed-form or a fixed-iteration numerical loop. The conversion needs **zero tokens and
zero network**, runs offline and deterministically in a Worker in under two seconds, and an LLM in the
conversion path would be slower, non-deterministic and strictly worse at nearest-colour matching than a
13,500-iteration ΔE loop. Legitimate optional garnish — all outside the hot path, all requiring network
— would be naming a generated palette ("Harbour Dusk") or writing a shareable description. Ship without
them and the feature is complete.

---

## A4. Sample patterns for fixtures — download these yourself into `tmp-pdf/`

**Do not commit any of these.** `tmp-pdf/` is already gitignored and already holds the copyrighted
crochet fixtures. Free ≠ redistributable: DMC's and every pattern shop's free PDFs are copyrighted
works licensed for personal use only.

| # | Source | URL | Demonstrates |
|---|---|---|---|
| 1 | **Artecy free patterns** (2 new free every month; free account, no card) | https://www.artecyshop.com/index.php?main_page=index&cPath=189 | A **Pattern-Keeper-supported** commercial chart: proper cover page, text legend, tiled chart pages with overlap. The gold-standard happy path for `parseKey`. |
| 2 | **DMC free cross-stitch patterns** | https://www.dmc.com/US/en/patterns/free-patterns-by-craft/cross-stitch | Designer-house house style: fabric/count/finished-size block, DMC-only key, sometimes an image-based key (a good failure case). |
| 3 | **LoveCrafts free cross stitch & embroidery** | https://www.lovecrafts.com/en-us/l/cross-stitch-and-embroidery/cross-stitch-and-embroidery-patterns/free-cross-stitch-and-embroidery-patterns | Multi-designer variety; several are magazine-style layouts with two-column keys — exercises `PdfText`'s column splitter. |
| 4 | **Antique Pattern Library** (CC BY-NC-SA 2.5 scans of public-domain books), e.g. https://www.antiquepatternlibrary.org/pub/PDF/6-JA013PrisCross.pdf and the index at https://www.antiquepatternlibrary.org/ | **The scanned-image failure case**: no text layer at all. Must degrade gracefully to "we couldn't read this one — here are the pages as images." *NC licence ⇒ still not committable to a commercial repo.* |
| 5 | **Generate your own with FlossCross** from one of your own photos: https://flosscross.com/designer/ — export **both PDF and OXS** | The only fixtures you own outright. Gives a matched PDF/OXS pair, so `parseKey` output can be diffed against ground truth from `parseOXS`. **Do this first.** |
| 6 | (optional) **Pic2Pat** https://www.pic2pat.com/index.en.php — free, outputs a PDF with symbol chart, key and skein counts | A second self-owned generator style, and a listed Pattern-Keeper-supported designer. |

Recommended fixture set: one FlossCross PDF+OXS pair (ground truth), one Artecy chart (commercial happy
path), one DMC chart (designer-house style), one Antique Pattern Library scan (graceful failure), plus
one large tiled chart if you own one.

---

# PART B — PROPOSED SPEC

Everything below plugs into `docs/CRAFTS.md` without changing it. New files only:
`js/xstitch.js`, `js/xstitch-photo.js`, `js/app-xstitch.js`, `css/xstitch.css`,
`test/xstitch.test.html`, `test/xstitch.fixtures.html`. Shell files (`index.html`, `sw.js`,
`js/store.js`, `js/app.js`) are touched only by the shell work item already described in CRAFTS.md.

## B1. Registration

```js
/* js/xstitch.js — pure logic, no DOM */
window.XStitch = { /* see B3 */ };
Store.registerCraft({
  id: 'crossstitch',
  normalize: XStitch.normalize,          // (rawCraftData, rawProject) -> craftData, never throws
  summary: XStitch.summary,              // (project) -> 'Cottage · 8 of 13 colours · 41%'
  templates: XStitch.TEMPLATES           // built-in, re-seeded on load like the crochet ones
});

/* js/app-xstitch.js — UI */
App.registerCraft({
  id: 'crossstitch', name: 'Cross-stitch', emoji: '❌', tagline: 'Charts, floss and progress.',
  renderProject, destroyProject, menuItems, openImportSheet, newProjectFields, summary, onTheme, onInit
});
```

Built-in templates (`Template.craft = 'crossstitch'`, `craftData` seeds an empty chart):

| id | name | emoji | seed |
|---|---|---|---|
| `xs-blank` | Cross-stitch project | ❌ | no chart; manual entry |
| `xs-sampler` | Sampler | 🌸 | 14 ct white aida, checklist [Cut and zigzag fabric, Grid the fabric, Find the centre, Stitch the border, Backstitch, Wash and press, Frame] |
| `xs-kit` | Kit | 🧵 | checklist [Sort the floss, Check the key against the kit, Grid the fabric] |

## B2. Data model

`Project.craft = 'crossstitch'`, `Project.craftData = XSData`. Must stay **JSON-safe** and small enough
for localStorage; the shell caps the whole state at a few MB. Everything binary (chart page images)
lives in `BlobStore`.

```js
XSData = {
  v: 1,

  fabric: { count: 14, countY: 14, over: 1, kind: 'aida'|'evenweave'|'linen',
            color: 'White', widthIn: null, heightIn: null },
  // `over` is 1 for aida, 2 for evenweave/linen worked over two threads.
  // effectiveCount = count / over

  design: { w: 89, h: 74,               // stitches; null when unknown (PDF-image projects)
            title: '', designer: '', copyright: '' },

  strandsDefault: 2,

  palette: [ PaletteEntry, ... ],       // display order = key order
  chart:  Chart | null,                 // real cell data (OXS / photo / grid-extracted PDF)
  pages:  ChartPage[],                  // PDF chart page images (BlobStore keys)

  progress: {
    mode: 'cells' | 'counts',           // 'cells' when chart !== null
    done: '<base64>',                   // cells mode: 1 bit per cell, row-major, w*h bits
    doneCount: 0,                       // cached popcount
    perColor: [ { i: 0, done: 0 }, ... ],// counts mode (and a cache in cells mode)
    pageDone: [ { page: 0, done: false } ],
    blocks: { }                         // optional: '12,7' -> true for 10x10 block ticks
  },

  current: { paletteIndex: 0, page: 0, cx: 0, cy: 0, zoom: 1 },  // view + "current colour"
  parking: [ { key: 'col:120' | 'block:12,7', symbol: '▲', corner: 'tl'|'tr'|'bl'|'br', note: '' } ],
  stash:   { '310': 2, '3799': 0 },     // skeins owned, keyed by palette code; 0 = "need to buy"
  notesKey: '',                         // free text scraped from the key page
  source:  { kind: 'oxs'|'pdf'|'photo'|'manual', fileName: '', importedAt: 0, warnings: [] }
}

PaletteEntry = {
  i: 0,                 // stable index; chart cells reference this
  symbol: '▲',          // OUR glyph (see B3.5) — never the source app's symbol number
  brand: 'DMC',         // 'DMC' | 'Anchor' | 'Madeira' | '' (unknown)
  code: '310',          // '310', 'B5200', 'Blanc', 'Ecru'
  name: 'Black',
  hex: '1a1a1a',        // no '#'
  strands: 2,
  bsStrands: 1,
  kind: 'cross',        // 'cross' | 'back' | 'knot' | 'bead' | 'half' | 'blend'
  blendWith: null,      // palette index for two-thread blends
  stitchCount: 1234,    // from the key, from OXS cell counts, or computed
  skeins: 1,            // from the key or estimated
  have: false           // "I own this" checkbox (mirrors stash)
}

Chart = {
  w: 89, h: 74,
  cells: { enc: 'rle', data: '-1x7,3x12,...' },   // see B3.6; -1 = empty
  part:  [ { x, y, a, b, d } ],                   // fractional stitches: palette a/b, direction 1-4
  back:  [ { x1, y1, x2, y2, i } ],               // vertex lattice, halves allowed (27.5)
  knots: [ { x, y, i, t: 'knot'|'bead' } ]
}

ChartPage = {
  n: 0,                 // 0-based page index within the PDF
  label: 'A1',          // from the PDF text if found, else 'Page 3'
  blobKey: 'p:<projectId>:chartpage:0',
  w: 1400, h: 1980,     // rendered pixel size
  isChart: true         // heuristic: did this page look like a grid?
}
```

**Why a bitmap for progress.** A 200×250 chart is 50,000 cells = 6,250 bytes packed = ~8.4 kB base64.
A 400×500 chart is ~33 kB base64. Plain arrays of booleans would be 10× that in JSON. Cells themselves
are RLE'd because charts are extremely run-heavy (a 500×700 HAED-style chart RLEs to a small fraction of
its 350,000 cells). Anything beyond ~1 MB of `craftData` should trip a warning and offer to drop the
chart back to image-only mode.

**Why page images go in `BlobStore`.** localStorage is ~5 MB per origin; a single rendered chart page at
1400 px wide is 150–400 kB as JPEG. IndexedDB under the modern WebKit policy gets up to 60% of disk per
origin ([WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)), and a Home
Screen web app has the same quota as the browser. Note the eviction rule: script-created data for an
origin with **no user interaction in seven days of browser use** can be deleted wholesale
([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)).
Hence CRAFTS.md's rule that page images are **not** in the backup JSON and the UI must say "chart images
are stored on this device only — keep the PDF".

## B3. `window.XStitch` — API contracts

### B3.1 Craft plumbing
```js
XStitch.normalize(raw, project) -> XSData    // never throws; repairs/creates every field above
XStitch.summary(project) -> string           // 'Cottage · 8 of 13 colours · 41%'
XStitch.TEMPLATES -> Template[]
```

### B3.2 OXS
```js
XStitch.parseOXS(xmlText) -> {
  ok: boolean,
  data: { design, fabric, palette, chart, strandsDefault, notesKey },  // → XSData fields
  warnings: string[]                    // 'cloth palette entry skipped', 'unknown objecttype "bugle"'
}
```
Rules:
- `DOMParser().parseFromString(xmlText, 'application/xml')`; a `<parsererror>` child ⇒ `ok:false`.
- `properties@chartwidth/chartheight` → `design.w/h`; `charttitle`/`author`/`copyright` →
  `design.title/designer/copyright`; `stitchesperinch(_y)` → `fabric.count/countY` (default 14).
- Palette: skip `number === 'cloth'` (and `index="0"` when its number/name is `cloth`), recording its
  colour as `fabric.color` if it is not white. Split `number` on the first space into brand + code when
  the first token matches `/^(DMC|Anchor|Madeira|Cosmo|Olympus|Sullivans)$/i`, else `brand:''`,
  `code: number`. `color` → `hex` (strip `#`, uppercase→lowercase, reject non-6-hex → `'808080'` +
  warning). `strands`/`bsstrands` default to `strandsDefault`. **Ignore `symbol`** except to preserve
  ordering; assign our own glyph via `XStitch.assignSymbols`.
- `fullstitches/stitch` → cells (`palindex` is the *OXS* index; remap through a
  `oxsIndex → our i` map built while filtering the cloth entry). `marked="true"` collects into the
  initial `progress.done` bitmap.
- `partstitches/partstitch` → `chart.part` (`d` = `direction` 1–4 verbatim).
- `backstitches/backstitch` with `objecttype="backstitch"` → `chart.back`; `daisy`/`bugle` → also
  `chart.back` plus a warning (we draw them as plain lines in v1).
- `ornaments_inc_knots_and_beads/object` → `chart.knots` with `t:'knot'` for `knot`, `t:'bead'` for any
  bead/button/sequin type; `tent`/`quarter`/`verticalhalf`/`horizontalhalf` → `chart.part`; others →
  dropped with a warning.
- Coordinate origin: OXS is 1-based in the examples but files in the wild use 0-based. Detect by taking
  `minX`/`minY` over all stitches; if both ≥ 1 and `maxX <= chartwidth`, subtract 1.
- `stitchCount` per palette entry = count of cells (+ parts weighted 0.5) with that index.
- Must not block the main thread on huge charts: parse in a `requestIdleCallback`-free simple chunked
  loop (5,000 nodes per tick) with a progress callback, or accept up to ~300 ms for a 350k-cell chart.

### B3.3 PDF key parser — the "drop a PDF and immediately have the info" path
```js
XStitch.parseKey(text, opts?) -> KeyResult

opts = { brands: ['DMC','Anchor','Madeira'], defaultStrands: 2 }

KeyResult = {
  entries: KeyEntry[],
  fabric: { count: number|null, countY: number|null, over: 1|2|null,
            kind: 'aida'|'evenweave'|'linen'|null, color: string|null },
  design: { w: number|null, h: number|null, title: string|null, designer: string|null },
  sizes:  [ { count: 14, wIn: 6.36, hIn: 5.29 } ],   // "finished size" rows found verbatim
  strandsDefault: number,
  stitchesUsed: string[],        // ['cross stitch','backstitch','french knot']
  copyrightLines: string[],
  confidence: number,            // 0..1 — see below
  warnings: string[]
}

KeyEntry = {
  symbol: string,                // '' when the glyph did not survive extraction
  brand: 'DMC', code: '310', name: 'Black',
  strands: number|null, stitchCount: number|null, skeins: number|null,
  kind: 'cross'|'back'|'knot'|'bead'|'half'|'blend',
  blendCode: string|null,        // '3799' for '310 + 3799'
  hex: string|null,              // filled by XStitch.hexFor(brand, code)
  line: string                   // the raw source line, for the "check this" UI
}
```

**Detection strategy (mirrors `Patterns.parse`'s tolerance).**

1. **Candidate lines.** A line is a key-row candidate when it contains a floss-code token: an optional
   brand word, then `\b(\d{1,5}|B5200|Blanc|Blanc Neige|White|Ecru|E\d{3,4}|\d{4}|5200)\b`. Require the
   line to also contain at least one of: a colour-name-looking run of letters, a strand hint, or a
   trailing integer.
2. **Column inference.** Collect candidates; find the numeric token **positions** that are consistent
   across ≥ 60% of them, then label them left-to-right against the canonical order
   `symbol, code, name, strands, stitchCount, skeins`. Layouts seen in the wild:
   ```
   ▲  DMC 310    Black                 2    1,234
   ▲  310  Black                                  2 str   1234 sts   1 skein
   310 BLACK ................ 2 ......... 1234
   ▲ | 310 | Black | 2 | 1234 | 1
   DMC 310  Black  (2 strands)  1234 stitches
   ```
   Disambiguation rules: a token with a thousands separator or ≥ 3 digits after the name is
   `stitchCount`; a token in 1..6 immediately after the name is `strands`; a token ≤ 30 at the end,
   after a stitchCount, is `skeins`. `1,234` → 1234 (strip commas/spaces inside digit groups).
3. **Section switching.** A short line matching `/back\s*stitch|backstitch|b\.?s\.?$/i`,
   `/french\s*knot/i`, `/bead/i`, `/half\s*stitch|petite|fractional/i` sets `kind` for all following
   entries until the next section header or a blank run of ≥ 2 lines. Default `kind:'cross'`.
4. **Blends.** `310 + 3799`, `310/3799`, `DMC 310 & 3799` → `code:'310'`, `blendCode:'3799'`,
   `kind:'blend'`.
5. **Fabric & size lines** (searched anywhere in the text, first match wins):
   - `/(\d{2})\s*(?:-|\s)?(?:ct|count)\b/i` → count. `/over\s*(?:2|two)/i` → `over:2`.
   - `/\baida\b/i` / `/\bevenweave\b|\blugana\b|\bjobelan\b/i` / `/\blinen\b|\bbelfast\b|\bcashel\b/i` → kind.
   - `/stitch(?:es)?\s*count\s*:?\s*(\d+)\s*(?:w|x|×|wide|by)\s*(\d+)/i`,
     `/(\d+)\s*(?:w|wide)\s*(?:x|×|by)\s*(\d+)\s*(?:h|high)/i`,
     `/design\s*(?:area|size)\s*:?\s*(\d+)\s*(?:x|×)\s*(\d+)/i` → `design.w/h`.
   - `/(\d+(?:\.\d+)?)\s*(?:in|")\s*(?:x|×)\s*(\d+(?:\.\d+)?)\s*(?:in|")?[^\n]*?(\d{2})\s*ct/i` and the
     mirrored order → a `sizes` row. Also accept cm and convert.
   - `/(\d)\s*strands?\b/i` near "cross stitch" → `strandsDefault`.
   - Fabric colour: the capitalised words immediately before/after the count word
     (`White`, `Antique White`, `Lamb's Wool`, `Zweigart 3706 Ivory`).
6. **Confidence** = weighted: 0.4 × (entries ≥ 3), 0.2 × (design.w && design.h), 0.2 × (fabric.count),
   0.1 × (≥ 60% of entries have a stitchCount), 0.1 × (≥ 60% have a symbol glyph). The import sheet
   shows a green/amber/red banner from this and **always** lets the user edit every field.

**Edge cases the parser must survive (each becomes a test):**

| Case | Expected |
|---|---|
| Symbol glyph is a PUA code point or `�` after extraction | `symbol: ''`, warning `'symbols unreadable'`; we assign our own glyphs |
| Two-column key page | Already untangled by `PdfText`'s column splitter; nothing extra |
| Key split across two pages with a repeated header | `=== PAGE n ===` markers are ignored; duplicate `brand+code+kind` rows merge (max of stitchCounts) |
| Leader dots `310 Black ......... 2 .... 1234` | Runs of ≥ 3 `.`/`·`/`_` collapse to a single separator before tokenising |
| Colour name contains a number (`Delft Blue 3325`, `Blue Violet MD`) | Code is the **first** standalone number after the brand or at line start; names keep the rest |
| `Blanc` / `Ecru` / `B5200` / `White` | Valid codes; `hexFor` knows them |
| Anchor-only chart | `brand:'Anchor'`; `hexFor` returns null; swatch falls back to grey with a "no colour data" note |
| Variegated (`4210`, `115`) | Parsed normally; `hex` is the midpoint or grey; warning |
| Kit-style "DMC 310 — 1 skein" with no stitch count | `stitchCount:null`; per-colour counting falls back to a free counter |
| Scanned/image-only PDF (no text) | `entries: []`, `confidence: 0`; the sheet offers image-only mode, no error |
| Instruction pages full of the word "stitch" | Candidate filter requires a floss code token, so they produce nothing |

```js
XStitch.hexFor(brand, code) -> '1a1a1a'|null     // DMC table only in v1
XStitch.FLOSS.dmc -> [ { code, name, hex, r, g, b } ]   // 454 entries, MIT source (A3.4)
XStitch.nearestFloss(rgbOrLab, { brand, limit }) -> [ { code, name, hex, de } ]
```

### B3.4 Chart-grid extraction from PDF — experimental, behind a flag
```js
XStitch.extractGrid(pdfDoc, pageNo, opts) -> Promise<{
  ok, w, h, originX, originY, cellW, cellH,
  cells: Int16Array, glyphs: string[], confidence, warnings
}>
```
Approach: `page.getTextContent()` → items with `transform` (x, y), `width`, `height`, `fontName`
([pdf.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)). Split multi-glyph items
by advancing `width/str.length`. Histogram the x and y positions, find the dominant spacing by
autocorrelation → `cellW`, `cellH`, `originX`, `originY`; snap each glyph to `(round((x-ox)/cw),
round((y-oy)/ch))`; require ≥ 80% of glyphs to snap within 20% of a cell to accept. Distinct glyph
strings become symbols; match them to key symbols by string equality, else by frequency ranking against
`stitchCount`. Cross-check the recovered per-symbol counts against the key's `stitchCount` column —
**agreement within 2% on ≥ 80% of colours is the acceptance test**; otherwise return `ok:false` and stay
in image mode. **Never ship this as the default path**; it is a "Try to read the grid (beta)" button
whose failure costs the user nothing.

### B3.5 Symbols
```js
XStitch.SYMBOLS -> string[]      // ~64 curated, visually distinct glyphs, ordered by ink weight
XStitch.assignSymbols(palette, opts?) -> palette   // mutates .symbol in place
```
Curated set (no confusable pairs, all present in the app's font stack with a monospace fallback):
`· : ▫ ▪ ○ ● ◌ ◍ △ ▲ ▽ ▼ ◇ ◆ □ ■ ☆ ★ + × ÷ = ≡ ~ ≈ ^ v < > ( ) [ ] { } / \ | — ‖ ¤ § ¶ † ‡ ¥ £ ∞ ∴ ∅ Ω Δ Σ Ψ Φ Θ Λ Ξ Π ß æ` and digits `2 3 4 5 6 7 8 9` (never `0 O o I l 1`).
Assignment: sort palette by Lab lightness; give the lowest-ink glyphs to the highest `stitchCount`
colours; alternate glyph *families* down the sorted list so neighbouring shades never share a family.
Glyph ink colour = `L* < 50 ? light : dark`.

### B3.6 Grid packing, progress bitmap, geometry, floss maths
```js
XStitch.packCells(int16Array, w, h) -> { enc:'rle', data:string }   // '<idx>x<run>' joined by ','
XStitch.unpackCells(packed) -> Int16Array
XStitch.packBits(uint8, n) -> string      // base64 of ceil(n/8) bytes
XStitch.unpackBits(b64, n) -> Uint8Array
XStitch.getBit(b64, i) / XStitch.setBit(state, i, v)   // state = { b64, bytes:Uint8Array, dirty }

XStitch.finishedSize({ w, h, count, over }) ->
  { wIn, hIn, wCm, hCm, fabricIn: { w, h }, fabricCm: { w, h } }   // +6 in margin per axis
XStitch.sizeTable({ w, h }, counts=[14,16,18]) -> [ { count, wIn, hIn } ]
XStitch.lengthPerStitchCm(count, over) -> number                    // 2.50 * 14 / (count/over)
XStitch.skeinsFor({ stitchCount, count, over, strands, waste=0.2 }) -> number
XStitch.skeinRange(args) -> { low, high }                           // honest range, not one number
XStitch.confetti(chart) -> { total, byColor: { [i]: n }, byPage: [] } // size-1 8-connected components
XStitch.progressStats(data) -> { done, total, pct, byColor: [ { i, done, total } ] }
```

## B4. Import flows

### B4.1 OXS / XML
Drop zone accepts `.oxs`, `.xml`. `FileReader.readAsText` → `XStitch.parseOXS` → preview card
("The Cottage · 89 × 74 · 13 colours · 14 ct · backstitch and 4 French knots") → **Import**. Sets
`progress.mode:'cells'`, seeds `done` from `marked`. Warnings listed under the preview, collapsed.

### B4.2 PDF (the main path)
Uses `ctx.pdfDropZone` and the new `PdfText.open` from CRAFTS.md:

1. `PdfText.open(file)` → `{ doc, numPages, textOf, renderPage }`.
2. Full text via `textOf` over all pages (reusing `PdfText.extract`'s line grouping, column splitting
   and furniture dropping) → `XStitch.parseKey(text)`.
3. **Page classification.** A page is a chart page when its text is mostly single-character tokens, or
   when it has > 200 text items with < 40 distinct strings, or (fallback) when it is not page 1 and the
   key was found on an earlier page. Chart pages get `renderPage(n, { maxWidth: 1400 })` → canvas →
   `canvas.toBlob('image/jpeg', 0.82)` → `BlobStore.put('p:<id>:chartpage:<n>', blob)`.
   Render lazily: page 1 immediately, the rest in a `for` loop with `await` and a progress bar, so a
   30-page chart does not block. Cap at 40 pages with a "render more" button.
4. Preview sheet shows: the parsed key as an editable list (symbol, code, name, strands, stitches,
   skeins), the fabric/size block as editable fields, a confidence banner, page thumbnails with
   chart/not-chart toggles, and **Import**.
5. On import: `progress.mode:'counts'` (no cell data), `perColor` zeroed, `pageDone` seeded.
   Toast: `Read 14 pages · 23 colours · 89 × 74 stitches`.
6. If `confidence === 0` (scanned): skip straight to image-only mode with a friendly line —
   *"This PDF is a scan, so I couldn't read the colour key. The chart pages are here; add colours by
   hand or from a photo."*

### B4.3 Manual entry
New project → cross-stitch → fields: design W × H, fabric count/kind/colour, strands. Then "Add colour"
rows (code → name+hex autofilled from `XStitch.FLOSS.dmc`, stitch count optional). This is the fallback
that always works and the path a kit stitcher takes.

### B4.4 Photo (§B6)

## B5. Screens (phone-first, 375 px)

### B5.1 Project screen (`renderProject(project, main, ctx)`)

A vertical stack inside `#craft-body`:

1. **Chart strip** — a `<canvas class="xs-chart">` at ~34vh with pan/zoom, or, in image mode, the
   current page image in the same frame. Overlaid: 10×10 major gridlines, a crosshair at
   `current.cx/cy`, and a coordinate readout `col 72 · row 41`. Pinch/drag to move; double-tap to fit;
   a ⤢ button opens the **full-screen chart sheet**.
   *Rendering*: draw cells into an offscreen `ImageData` at 1 px per cell once per model change, then
   `drawImage` it scaled with `imageSmoothingEnabled = false`. Symbols and gridlines draw on top only
   when `zoom ≥ 8 px/cell`. This keeps 60 fps on a 200×250 chart trivially and works to 500×700.
   Done cells render **filled with the floss colour** (matching the fabric); not-done render as a pale
   swatch + symbol. Current colour's cells get a ring; everything else dims when "isolate colour" is on.
2. **Current colour bar** — a swatch, `▲ DMC 310 Black`, `1,234 sts · 412 left`, and ‹ › to step
   through the key.
3. **The big tap button** — reuse `.stitch-btn` verbatim (`id="xs-stitch-btn"`, caption `STITCHES`, big
   number, hint `tap`) so all six themes style it for free. In counts mode it increments
   `perColor[current].done`; in cells mode it advances through that colour's cells in reading order and
   marks each done, moving the crosshair with it. `–1` and `reset` as in crochet. Group readout reuses
   `Project.groupSize` ("Group 3 of 12 · stitch 4 of 10"), which maps perfectly onto counting a colour
   run. Feedback: `ctx.fb('tap'|'group'|'row')`; colour finished → `ctx.fb('done')` + `ctx.celebrate('part')`.
4. **Colour key list** — one row per palette entry: swatch, symbol, code + name, a slim progress bar,
   `412 left`, a ✓ when complete, an "own it" checkbox. Tap = make current. Long-press = isolate on the
   chart. Sortable by key order / most remaining / lightness.
5. **Bottom bar** (rendered inside `main`, class `bottombar`): Undo · Awake · Pages · Floss.

### B5.2 Sheets
- **Chart** (full screen): the same canvas with `interactive`, plus mark tools — *tap*, *drag paint*,
  *10×10 block*, *whole page*, *this colour on this page* — and an Undo. Mark tools write through
  `Store.updateCraftData`, so shell Undo works for free.
- **Import pattern** (`openImportSheet`): drop zone (PDF / OXS), "Make one from a photo" button,
  "Enter it by hand" link, then the preview described in B4.
- **Floss list**: every palette entry with skeins needed (as a range), "own it" checkbox, a
  **Shopping list** button that copies/share-sheets the missing codes, and the stash totals.
- **Fabric & size**: count, kind, over-2 toggle, colour; live finished-size table at 14/16/18 ct plus
  "fabric to buy" including margin.
- **Parking notes**: list of `{ where, symbol, corner, note }` with ＋, for the parking method.
- **Pages**: thumbnail grid of chart pages with done ticks and % per page.

### B5.3 Settings / help
The shell's Crafts line lists cross-stitch. Register FAQ entries via `onInit(ctx)`:
*"Why couldn't it read my chart's grid?"*, *"What's over 2?"*, *"How are skeins estimated?"*,
*"Where are my chart images stored?"*.

### B5.4 How the live 3D diagram concept maps
Don't. A cross-stitch piece is flat, so the 3D solid-of-revolution idea has no analogue. The equivalent
delight is a **live chart preview**: the same `.stitch-btn` canvas slot, but showing the *whole design
shrunk to fit*, with only the done cells painted in their floss colours on a fabric-coloured ground — so
the picture literally appears as you stitch. It is a 2D `putImageData` of a `w × h` buffer, one byte
write per tap, so the tap path stays well under 1 ms. Reuse `Diagram`'s palette and reduced-motion
conventions but **not** its WebGL code. The newest stitch gets a 140 ms scale-in highlight; finishing a
colour flashes that colour's cells once. In image-only mode, show a per-page completion mosaic instead.

## B6. `js/xstitch-photo.js` — `window.XStitchPhoto`

```js
XStitchPhoto.isAvailable() -> boolean        // Worker + createImageBitmap + Blob URL

XStitchPhoto.convert(source, opts, onProgress) -> Promise<Result>
  source = File | Blob | ImageBitmap | HTMLCanvasElement
  opts = {
    stitchWidth: 100,        // 20..500 — the only size control the user needs
    maxColors: 24,           // 2..64
    count: 14, over: 1,      // fabric, for size + floss maths only
    brand: 'DMC',
    dither: false,           // default OFF (A3.2 step 6)
    cleanup: 1,              // 0 none, 1 majority, 2 majority + component removal
    minRun: 1,
    crop: { x, y, w, h } | null,
    metric: 'de2000',        // final mapping metric; inner loop is always de76
    strands: 2, waste: 0.2,
    seed: 1234               // deterministic k-means++ for reproducible output
  }
  onProgress({ phase: 'decode'|'resample'|'quantize'|'match'|'cleanup'|'symbols', pct })

Result = {
  ok: true,
  data: XSData-shaped { design, fabric, palette, chart, strandsDefault },
  stats: { colors, cells, confetti: { before, after }, ms, skeinsTotal },
  preview: ImageData            // w x h, for an instant thumbnail
}
XStitchPhoto.cancel(token)
```

**Implementation plan (no build step).** The worker source is a string constant inside
`js/xstitch-photo.js`, turned into a Worker with
`URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))`. The DMC table is posted into the
worker once at startup (it is ~30 kB of numbers) rather than duplicated in the worker source. Main
thread does `createImageBitmap` + `drawImage` into a small canvas + `getImageData`, then
`worker.postMessage({ buf, w, h, opts }, [buf])` (zero-copy). The worker returns
`{ cells: Int16Array, palette, stats }` transferably. If Workers are unavailable, fall back to running
the same functions on the main thread in `setTimeout`-chunked phases so the UI still paints.

**UI**: a sheet with the photo, a crop frame, three controls (*width in stitches*, *colours*, *fabric
count*), an "Advanced" disclosure (dither, cleanup strength, brand), a live preview that re-runs on
release (debounced 250 ms), and readouts *"100 × 133 stitches · 7.1 × 9.5 in on 14 ct · 24 colours ·
18 skeins · 312 confetti stitches"*. **Create project** writes the same `XSData` the OXS importer
produces, so everything downstream — chart viewer, key list, counter, export — works unchanged.

## B7. Export

- **Backup JSON**: already handled — `craft` + `craftData` ride along. Page images do not (state it).
- **OXS export** (`XStitch.toOXS(data) -> string`): round-trips our chart into the open format so the
  user is never locked in. Straight string building against the spec in A1.3; `symbol` attributes get
  sequential integers; our palette index 0 becomes OXS index 1 with a synthetic `cloth` at 0.
- **Printable chart** (`XStitch.printableHTML(data, opts) -> string`): open a new window with a
  self-contained HTML page — cover block (title, size table, fabric, floss list with skeins), then chart
  pages tiled at a chosen stitches-per-page with 10×10 majors, margin numbering every 10, centre arrows
  and a repeated key — then `window.print()`. No PDF library needed; the browser makes the PDF. This is
  also how a photo-generated pattern gets shared.

## B8. Tests and fixtures

- `test/xstitch.test.html` — same harness as `test/patterns.test.html` (dark page, `log/group/deepEqual`,
  pass/fail counters). **Committed synthetic fixtures only.** Target ≥ 90 assertions:
  - `parseOXS`: a hand-written 6×6 chart string covering palette with and without brand prefix, cloth
    entry, `marked`, part stitches, backstitch with `27.5`, a knot, a bead, an unknown `objecttype`,
    0-based vs 1-based coordinates, malformed XML.
  - `parseKey`: one synthetic snippet per row in the edge-case table in B3.3 (~16), plus the five layout
    variants, plus fabric/size line variants in inches and cm, plus a "no key at all" text.
  - `packCells`/`unpackCells`/`packBits`/`unpackBits` round-trips including a 200×250 random grid.
  - `finishedSize`, `sizeTable`, `lengthPerStitchCm`, `skeinsFor`/`skeinRange` against the worked
    examples in A3.2 step 9 (14ct/2 strands ⇒ ~960 stitches/skein).
  - `assignSymbols`: no duplicates, no confusable glyphs, deterministic for a fixed palette.
  - `confetti` on a hand-made grid with a known number of isolated cells.
  - `XStitchPhoto`: a synthetic 40×40 gradient `ImageData` → 8 colours; assert determinism with a fixed
    seed, cell count, palette size, and < 500 ms.
- `test/xstitch.fixtures.html` — runs against the real files in gitignored `tmp-pdf/`
  (`xs-flosscross.pdf` + `.oxs`, `xs-artecy.pdf`, `xs-dmc.pdf`, `xs-scan.pdf`), **skipping gracefully
  when absent**, and reports: entries found, confidence, fabric/size detected, and — for the
  FlossCross pair — a **diff of `parseKey` against `parseOXS` ground truth** (codes, names, stitch
  counts). Target: ≥ 90% code agreement on the paired fixture, ≥ 1 usable entry on every non-scan
  fixture, and a clean `confidence: 0` on the scan.
- Browser check at 375 × 812 per CRAFTS.md: clear service worker + caches, create → import → count →
  mark → undo → export/import round-trip → delete, then confirm a crochet project still works.

## B9. Risks and open questions

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **PDF grid extraction never works well enough.** | Medium | It is explicitly not the v1 promise. Image mode + key parse is the product; grid extraction is a labelled beta button. |
| 2 | **Symbol glyphs don't survive text extraction** (custom fonts with no `ToUnicode`). | High likelihood, low impact | We assign our own glyphs anyway; the PDF's symbols only matter for matching to page images, which the user does visually. |
| 3 | **Storage.** A 30-page chart at 300 kB/page is 9 MB in IndexedDB; Safari can evict an origin with no interaction for 7 days. | Medium | JPEG q0.82 at 1400 px, cap at 40 pages, show `BlobStore.usage()` in settings, re-import from the PDF is always possible, and say so in the UI. |
| 4 | **`craftData` bloat in localStorage** on a 500×700 chart. | Medium | RLE cells + base64 bitmap; warn above 1 MB and offer image-only mode. Consider moving `chart.cells` to `BlobStore` in v2. |
| 5 | **Copyright.** Users import purchased charts. | Low but must be right | Everything stays on-device; no upload, no sharing of imported charts; the printable export is for *your own* patterns. Never commit a fixture. |
| 6 | **DMC trademark / RGB accuracy.** | Low | Nominative use only, MIT-licensed table, and an explicit "screen colours are approximate — always check against a real shade card" line in the floss sheet. |
| 7 | **Phone ergonomics of a 50k-cell grid.** | Medium | This is *why* the big tap button + current-colour counter is the primary interface and the grid is secondary — the opposite of Pattern Keeper's tablet-shaped design. |
| 8 | **Scope creep into a chart editor.** | High | Explicitly out of scope for v1: freehand editing, backstitch drawing, layers. We track and import; FlossCross edits. |

**Open questions for the owner**
1. Is **fractional/backstitch progress tracking** in v1, or v2? (Modelling them is cheap; *tracking* them
   adds a second bitmap and a mode switch.) Recommendation: model now, track in v2.
2. Should cross-stitch projects reuse `Part`s at all (e.g. one part per page)? Recommendation: no —
   `parts` stays the single hidden `Main` the shell requires.
3. Photo → pattern: free feature, or the first Pro feature? It is the most "magic" thing here and costs
   nothing to run.
4. Brands beyond DMC in v1? Recommendation: DMC RGB only; parse and display Anchor/Madeira codes but
   show a neutral swatch.
5. `❌` as the craft emoji is ugly on some platforms — `🧵` or `✚`?

## B10. Build order and rough effort

Effort is in *agent-days* on the delegation pattern in HANDOFF.md (one Opus agent per file group).

| # | Work item | Files | Effort | Depends on |
|---|---|---|---|---|
| 0 | Shell plumbing per `docs/CRAFTS.md` | `store.js`, `app.js`, `index.html`, `sw.js`, `blobstore.js`, stubs | 1.5 | — |
| 1 | `XStitch` core: normalize, packing, geometry, floss maths, DMC table, symbols | `js/xstitch.js`, `test/xstitch.test.html` | 1.0 | 0 |
| 2 | `XStitch.parseOXS` + `toOXS` | `js/xstitch.js`, tests | 0.75 | 1 |
| 3 | `XStitch.parseKey` + fixtures page | `js/xstitch.js`, both test pages | 1.5 | 1 |
| 4 | Project screen: chart canvas, key list, tap button, bottom bar | `js/app-xstitch.js`, `css/xstitch.css` | 2.0 | 1 |
| 5 | Import sheet: PDF + OXS + manual, page rendering to `BlobStore` | `js/app-xstitch.js` | 1.5 | 2, 3, 4 |
| 6 | Floss / fabric / parking / pages sheets, FAQ | `js/app-xstitch.js` | 1.0 | 4 |
| 7 | Live chart preview in the tap button | `js/app-xstitch.js` | 0.5 | 4 |
| 8 | `XStitchPhoto` worker + sheet | `js/xstitch-photo.js`, `js/app-xstitch.js` | 2.0 | 1, 4 |
| 9 | Printable chart export | `js/xstitch.js` | 0.5 | 1 |
| 10 | Grid-extraction beta | `js/xstitch.js` | 1.5 | 3, 5 |

**Suggested slices.** *Ship 1:* items 0–5 — a stitcher can drop a PDF, get the key, fabric and size, page
through the chart images and count a colour at a time. That alone beats every free option on iOS.
*Ship 2:* 6–7 and 9. *Ship 3:* 8 (photo). *Later / maybe never:* 10.

---

## Sources

[OXS format spec](https://www.ursasoftware.com/OXSFormat/) ·
[OXS overview (Ursa help)](https://ursasoftware.com/help/2023/TheOXSOpenXStitchfileformat.html) ·
[MyCozyApp on OXS](https://mycozyapp.com/about-oxs) ·
[Xstitchify import limits](https://xstitchify.com/import/) ·
[KXStitch XSD reverse-engineering request](https://sourceforge.net/p/kxstitch/feature-requests/10/) ·
[Pattern Keeper](https://patternkeeper.app/) ·
[PK FAQ](https://patternkeeper.app/faq/) ·
[PK for designers](https://patternkeeper.app/for-designers/) ·
[PK supported designers](https://patternkeeper.app/supported-designers/) ·
[PK highlighting help](https://patternkeeper.app/help/highlighting-your-progress/) ·
[PK grey-X help](https://patternkeeper.app/help/why-did-my-pattern-get-a-grey-x-on-it/) ·
[Stitchmate: good chart PDFs](https://stitchmate.app/guides/cross-stitch-pattern-pdf-quality) ·
[Stitchmate thread usage](https://stitchmate.app/tools/thread-usage-calculator) ·
[Markup R-XP](https://markuprxp.co.uk/) ·
[Cross Stitch Saga reviews](https://apps.apple.com/us/app/cross-stitch-saga/id1440279996) ·
[Lord Libidan: best apps](https://lordlibidan.com/the-best-apps-for-cross-stitchers/) ·
[Lord Libidan: markup apps](https://lordlibidan.com/whats-the-best-mark-up-app-for-cross-stitch-patterns/) ·
[Stitch Fiddle progress tracker](https://www.stitchfiddle.com/en/help/1pdx-98nqe4/progress-tracker) ·
[FlossCross](https://flosscross.com/) ·
[Chart Minder](https://www.chart-minder.com/) ·
[X-Stitch Tracker](https://xstitchtracker.com/) ·
[Kate-nc/cross-stitch (ISC)](https://github.com/Kate-nc/cross-stitch) ·
[Mickey1992/stitch-pdf2oxs](https://github.com/Mickey1992/stitch-pdf2oxs) ·
[Fat Quarter Shop: reading a pattern](https://www.fatquartershop.com/how-to-read-a-cross-stitch-pattern) ·
[Two Little Kits: legends](https://twolittlekits.com/blogs/lesson/reading-a-cross-stitch-pattern) ·
[StitchThis: symbols & notation](https://stitchthis.io/blog/cross-stitch-pattern-symbols-and-notation-guide) ·
[Scarlet Quince: parking](https://www.scarletquince.com/parking.php) ·
[Peacock & Fig: parking](https://peacockandfig.com/2015/03/cross-stitch-how-to-park-your-threads/) ·
[Thread Bare: parking](https://www.thread-bare.com/blog/thread-parking-method-cross-stitching) ·
[Stitching Daily: parking vs cross-country](https://stitchingdaily.com/cross-stitch-parking-vs-cross-country/) ·
[Sirious Stitches: gridding](https://sirithre.com/gridding-for-cross-stitch-techniques-to-help-with-counting-stitches/) ·
[DoodleCraft: gridding](https://doodlecraftdesign.co.uk/pages/gridding-fabric-for-cross-stitching) ·
[Caterpillar: confetti](https://www.caterpillarcrossstitch.com/blogs/blog/cross-stitch-confetti-stitches-guide-for-beginners) ·
[Xstitchify: confetti](https://xstitchify.com/cross-stitch-confetti/) ·
[Cross Stitched: fabric counts](https://cross-stitched.com/en-us/blogs/what-is-cross-stitch/cross-stitch-fabric-counts) ·
[Lost in Cross Stitch: fabric size](https://www.lostincrossstitch.com/calculate-cross-stitch-fabric-size/) ·
[Cross Stitch Boutique: floss needed](https://www.crossstitchboutique.com/how-much-floss-needed-for-cross-stitch-complete-guide-2025/) ·
[Pic2Pat](https://www.pic2pat.com/index.en.php) ·
[Stitch Fiddle: import picture](https://www.stitchfiddle.com/en/help/1pej-wc93j/import-picture) ·
[Sharma: CIEDE2000](https://www.hajim.rochester.edu/ece/~gsharma/ciede2000/) ·
[Celebi: k-means for colour quantization](https://faculty.uca.edu/ecelebi/documents/IMAVIS_2011.pdf) ·
[Arthur & Vassilvitskii: k-means++](http://theory.stanford.edu/~sergei/papers/kMeansPP-soda.pdf) ·
[Leptonica: colour quantization](http://www.leptonica.org/papers/colorquant.pdf) ·
[Wikipedia: colour difference](https://en.wikipedia.org/wiki/Color_difference) ·
[sharlagelfand/dmc (MIT, 454 colours)](https://github.com/sharlagelfand/dmc) ·
[seanockert/rgb-to-dmc](https://github.com/seanockert/rgb-to-dmc) ·
[DMC free patterns](https://www.dmc.com/US/en/patterns/free-patterns-by-craft/cross-stitch) ·
[Artecy free patterns](https://www.artecyshop.com/index.php?main_page=index&cPath=189) ·
[LoveCrafts free patterns](https://www.lovecrafts.com/en-us/l/cross-stitch-and-embroidery/cross-stitch-and-embroidery-patterns/free-cross-stitch-and-embroidery-patterns) ·
[Antique Pattern Library](https://www.antiquepatternlibrary.org/) ·
[pdf.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html) ·
[WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/) ·
[MDN storage quotas & eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) ·
[caniuse: OffscreenCanvas](https://caniuse.com/offscreencanvas)
