# 11 — Knitting, and the crafts after it

Brainstorm, 2026-09-17. Lens: **knitting and the next crafts**. Nothing here is built; this is
argument + spec sketch for the owner to cut down.

---

## Summary

**Knitting is the biggest thing this app is not.** It is the larger half of the yarn world —
Ravelry released 1,018,878 patterns 2007–2022 of which 413,303 were crochet, so roughly **60%
of the pattern supply is knitting**, and 60% of Ravelry designers publish knitting vs 40%
crochet ([Ravelry 2022 community stats](https://blog.ravelry.com/2022-community-stats/),
[knitlikegranny](https://knitlikegranny.com/ravelry-stats/)). The Craft Yarn Council's split is
63% do both, 23% crochet only, 14% knit only, over 40M active US knitters and crocheters
([CYC](https://www.craftyarncouncil.com/know.html),
[Craft Industry Alliance 2025 yarn survey](https://craftindustryalliance.org/the-size-of-the-yarn-market-yarn-consumer-survey-results-2025/)).
That 63% matters more than the 60/40: **the majority of the existing crochet users already knit**,
so knitting is a retention feature before it is an acquisition feature.

**The central finding is architectural, and it is good news.** Knitting is the one craft that
should *not* be a `docs/CRAFTS.md`-style module. Cross-stitch and sewing needed their own screens
because they do not count rows. Knitting *is* the crochet counter: rows/rounds, a stitch count per
row, parts with make-counts, repeats, targets, alerts, placement notes, history, the 3D rows-mode
diagram. All of that already exists in `js/store.js` and `js/app.js` and works on
`Project.parts`, which every craft gets regardless. The only thing standing between knitting and
the existing counter is one function:

```js
// js/store.js:958
function patternsApi() {
  return window.Patterns && typeof window.Patterns === 'object' ? window.Patterns : null;
}
```

`Store.linesFor(part)` (store.js:966) always asks `window.Patterns`. Make that a per-craft lookup
and `craft: 'knitting'` renders through `#screen-project` with a different parser — reusing the
tap path, `repeatInfo`, `jumpToRow`, `currentTargetInfo`, `rowStitches`, `diagramModel`,
templates, tours and every pixel of the counter. That is the single highest-leverage change in
this document.

The parser side is also cheaper than it looks. A read of all 2338 lines of `js/patterns.js` says
**~53% is fully craft-agnostic and copies unchanged** (helpers, row/setup markers, sections,
header/note/repeat detection, the whole `parse()` driver, the colour engine, the placement
router), **~17% is a generic algorithm fed by craft-specific data** (count extraction,
`evaluate()`'s segment rules) and **~30% is hard crochet** (the `VOCAB` table, `ZERO_RES`,
magic-ring, and all 423 lines of `expand()` for the 3D diagram). Factor `VOCAB` + `ZERO_RES` +
`MR_RE*` + `PREFIX_RE` + `stitchTok` into a **craft profile object** and ~70% becomes a shared
engine; the knitting delta is a **~200-line profile plus three genuinely new features**:
in-segment multi-size, real `*…*` repeat parsing with "to last N sts", and RS/WS kept on `Line`.

After knitting, the best next bet is **not** a new craft at all: it is **needlepoint + counted
embroidery as an expansion of the cross-stitch module** (same DMC floss maths, same chart grid,
same colour key, different stitch types), with **Tunisian crochet shipped free as a vocabulary
pack** the moment the parser is pluggable. Punch needle, macramé and weaving are exciting
markets with almost no counter to sell them.

---

## Part 1 — The knitting module

### 1.1 The architectural call

| Option | What it is | Verdict |
|---|---|---|
| **A. `#screen-craft` module** (`js/knitting.js` + `js/app-knitting.js`, like sewing) | Rebuild the row counter, part tabs, stitch button, repeat readout, alerts, placement, pattern sheet, history, diagram inside a craft module | **No.** It duplicates ~1500 lines of `app.js` that already do exactly this, and every future counter fix has to be made twice. |
| **B. Crochet-shell twin** — `craft: 'knitting'` renders `#screen-project`, with a swapped parser and a craft label/vocab map | One gate change (`isCraftProject`, app.js:712), one parser lookup (store.js:958), a `Knits` profile, and a few knitting-only extras bolted onto the existing screen | **Yes.** This is the proposal. |
| **C. Not a craft at all** — a per-project "stitch language" toggle on crochet projects | Cheapest, but the craft picker, templates, home badge and tours all lie about what the project is | No — but it is the right model for **Tunisian crochet** (§3). |

Option B has one cosmetic problem worth naming now: **there is no knitting emoji.** 🧶 is "ball
of yarn" and is already crochet's identity; 🪡 is sewing's. The least-bad options are **🥢**
(no), **🧣** (scarf — reads as "knitwear", works at 16px, no clash) or a small inline SVG of two
needles used everywhere the shell prints a craft emoji. Recommend **🧣** for v1 and revisit; the
craft badge is one character in `craftList()` (app.js:681).

### 1.2 Data model

Knitting needs **no new project-level storage** for the counting core — it reuses `Part.row`,
`Part.stitch`, `Part.targetRows`, `Part.repeat`, `Part.alerts`, `Part.rowStitches`,
`Part.sizeIndex`, `Part.patternText`, `Part.placementNotes`. What it adds:

```js
// Project level (new fields, normalised on load, crochet ignores them)
Project.sizeIndex: number        // 0. Knitting patterns state size ONCE for the whole garment;
                                 // Part.sizeIndex stays as the override, defaulting to this.
Project.gauge: {                 // '' when unknown
  sts: number|null, rows: number|null, over: number, unit: 'cm'|'in',
  needle: string,                // '4 mm', 'US 6'
  swatch: { sts: number|null, rows: number|null }   // what the knitter actually measured
}

// Part level (new)
Part.side: 'rs'|'ws'|null        // side of the row the counter is ON. null = worked in the round
Part.markers: [{ id, name, at: number }]   // live stitch markers, `at` = stitch index from the
                                           // start of the row; 'BOR' is reserved
Part.linked: string|null         // partId this part is worked two-at-a-time with (socks, sleeves)

// Settings.crafts.knitting (shared across projects)
{ defaultUnit: 'cm'|'in', needleSystem: 'metric'|'us'|'uk', chartsRead: 'rs-right-to-left' }
```

`Part.markers` is the only genuinely new *state machine*. It is small (≤ 12 markers), plain JSON,
and never touched on the stitch tap path except to render "3 sts to marker".

### 1.3 Parser deltas (`js/knits.js` → `window.Knits`, registered as the knitting craft's parser)

Shape: `Knits.parse(text, opts) → Line[]` with the **same `Line` contract** as `Patterns`
(`index, text, kind, row, rowEnd, section, stitches, sizes, computed, count, countSource, notes`),
plus three additions: `side: 'rs'|'ws'|null`, `delta: number|null` (rows that state a *change*
rather than a total: "8 sts inc"), and `until: { kind: 'length'|'rows', value, unit }|null`.

Vocabulary table, same `[regexSource, produced, consumed]` shape as `patterns.js:51`:

| knitting | p, c | note |
|---|---|---|
| `k`, `p`, `sl1`, `tbl`, `ktbl`, `ptbl` | 1, 1 | bare `k`/`p` collide with `ZERO_RES`'s `/^[a-z]$/` (patterns.js:314) and with `colorHex`'s single-letter legend keys (1759) — must be fixed in the profile, not globally |
| `k2tog`, `ssk`, `p2tog`, `ssp`, `skp`, `k2tog tbl` | 1, 2 | |
| `k3tog`, `sssk`, `cdd`, `sl1-k2tog-psso`, `s2kp` | 1, 3 | |
| `yo`, `m1`, `m1l`, `m1r`, `m1p`, `kyok` | 1, 0 | precedent exists: `fsc` is `[1,0]` at patterns.js:68 |
| `kfb`, `pfb`, `k1fb`, `inc1` | 2, 1 | |
| `C6F`, `C4B`, `T3R`, `1/1 RC` | **n, n** | **`VOCAB` holds literal ints, so a count that depends on the digit in the name cannot be expressed.** Make the tuple entries optionally functions of the match, or enumerate 2/3/4/6/8/10/12. |
| `pm`, `sm`, `rm`, `w&t`, `turn`, `sl m` | 0, 0 | belongs in `ZERO_RES` |
| `CO 60`, `cast on 60`, `BO 4 sts` | abs / −n | reuse the magic-ring `abs` branch (patterns.js:322–323, 348) — it is the existing "count from nothing" hook |

Three structural additions, each already half-present:

1. **In-segment multi-size.** `MULTI_SRC` (patterns.js:162) is only applied at end-of-line
   (`MULTI_TAIL`, 164) or after a `|`. `parseSegment` is multi-size blind, so `CO 60 (66, 72) sts`
   turns `(66, 72)` into a bracket group whose members match the bare-number `ZERO_RES` rule and
   are silently swallowed as zero. Size selection must move **into the tokenizer**. `pickSize`
   (176) is the right precedent. This is the single biggest piece of new work.
2. **Real asterisk repeats.** `scanItems` (416) treats `*` as a paired delimiter, so
   `*k2, p2; rep from * to end` captures `"k2, p2; rep from "` as the group and only survives
   because `OPEN_FILL_RE` short-circuits to `prevCount`. That is coincidentally right for ribbing
   and wrong for `rep from * to last 3 sts, k3` — the dominant knitting line. Needs: a real
   `*…rep from *` scanner with an explicit remainder tail (`to last N sts`, `to end`,
   `to 2 sts before marker`), and `;` treated as a higher-precedence separator than `,`
   (`splitSegments`, 395, flattens both).
3. **RS/WS kept.** `KEYWORD_RE` (109) and `SETUP_RE` (119) **already swallow** `(RS)`/`(WS)`/
   `(right side)`/`(wrong side)` — the value is just thrown away. Plumb it onto `Line.side` in
   `makeLine` (1090), and default flat sections to alternating parity from the first tagged row.

Two things already work and should not be touched: `work even` is handled
(`WORK_EVEN_RE`, 320 + `OPEN_FILL_RE`, 466 → `prevCount`), and bracketed repeats
`[k2, p2] x 3` / `(k1, yo) 3 times` / `twice` / `5 more times` all parse today (`MULT_RE`, 412).

#### The twelve lines the parser must handle

| # | Line | Must produce |
|---|---|---|
| 1 | `Row 1 (RS): K2, *yo, k2tog, k3; rep from * to last 3 sts, k3. (60 sts)` | row 1, `side:'rs'`, asterisk group + 3-st remainder, `count 60` explicit |
| 2 | `Rows 2, 4, 6 and 8 (WS): Purl.` | **four** rows (not a range), `side:'ws'`, `computed = prev` |
| 3 | `Rnd 13: K1, m1L, knit to last st, m1R, k1 — 62 (68, 74, 80, 86) sts.` | row 13, `side:null`, em-dash multi-size count, size-resolved |
| 4 | `Set-up row (WS): P3, pm, p12, pm, p30, pm, p12, pm, p3.` | `kind:'setup'`, row 0, count 60, **four markers at 3/15/45/57** |
| 5 | `Raglan inc rnd: *K1, m1L, knit to 1 st before marker, m1R, k1, sm; rep from * 3 more times — 8 sts inc.` | `delta: +8`, `count = prev + 8`, marker-relative fill must not return null |
| 6 | `Repeat Rnds 13–14 a further 9 (11, 13, 15, 17) times — 134 (152, 170, 188, 206) sts.` | `kind:'repeat'`, `{startRow:13,endRow:14,times:<size-resolved>}`, **and** a size-resolved resulting count |
| 7 | `Heel turn Row 1 (RS): Sl1, k17 (19), ssk, k1, turn.` | row 1, `(19)` is an **in-segment size**, not an end-of-row count; `turn` flips `side` |
| 8 | `Row 2 (WS): Sl1, p to one st before the gap, p2tog, p1, turn.` | `computed: null` — **never guess**; gap-relative is uncountable |
| 9 | `Rnd 25: [K6, C6F] 8 times. (96 sts)` | bracket ×8, `C6F` = 6 produced / 6 consumed, explicit 96 |
| 10 | `Work even in St st until piece measures 32 (33, 34, 35) cm / 12½ (13, 13½, 13¾)" from underarm, ending with a WS row.` | no row number; `until: {kind:'length', value:33, unit:'cm'}` + "end on WS" flag. **Must not** become a `targetRows` suggestion — `detectRepeat` (745) currently reads "until 12" as 12 rows |
| 11 | `Next row (RS): BO 4 sts, work to end — 56 sts rem.` | `Next row` → prev+1 (already works, `detectNextRow`, 144), `BO 4` = −4, explicit 56 |
| 12 | `Sizes S (M, L) only: K2tog at each end of next row.` | size-conditional: kept when `sizeIndex ∈ {0,1,2}`, dropped otherwise |

Two more traps worth a fixture each: `detectSizes` (268) requires `hasLetter` (line 287), so a
purely numeric garment size line `34 (38, 42, 46)` is rejected and `meta.sizes` stays null; and
`IMPERATIVE_RE` (571) has no `cast`/`bind`/`knit`/`purl`/`rib`, so **"Cast On" and "Bind Off"
will pass `TITLE_RE` and be created as phantom part headers.**

There is a real precedent to study rather than invent: **stitch-maps.com's "knitspeak"**
([grammar](https://stitch-maps.com/about/knitspeak/)) is a published, tightly-specified knitting
instruction grammar — mandatory `Row N:` colons, `Rows 2, 4, 6, and 8 (WS)` enumeration, one
asterisk section per row, `[yo, k2tog] twice`, `Repeat rows 1-2.`, `P3, w&t`. It is the closest
thing the craft has to a standard and it validates the twelve lines above almost item for item.

### 1.4 UI deltas on `#screen-project`

Everything below is additive to the existing counter; a crochet project never sees any of it.

- **RS/WS chip** beside the row number: `ROW 23 · RS`. Derived from `Line.side`, falling back to
  parity from the last tagged row; tapping it flips `Part.side` when the pattern's parity has
  drifted. Hidden in the round. This is the #1 knitting counter feature and it is ~30 lines.
- **Marker strip** under the stitch readout: `● 3 · ● 15 · ▲ BOR`, showing **stitches to the next
  marker** as you tap (`7 → marker`). Tap a marker to rename; long-press to remove. This is what
  makes lace and raglan yokes survivable and no free counter app does it well.
- **Stitch readout reads "sts on needle"** and, for a part with markers, a per-segment breakdown
  `3 | 12 | 30 | 12 | 3` — the thing knitters actually recount after a mistake.
- **Cable ring**: when the pattern has a cable worked every N rows, a small ring beside the row
  number that fills and flashes on the crossing row (`cable in 3`). Derived from the repeat the
  parser already suggests.
- **Short-row mode**: a `turn` in the current line puts the counter in short-row mode — the row
  number stops advancing and a `short row 3 of 8` sub-counter runs instead, because short rows
  are not rows and counting them as rows is the classic wrong answer.
- **Two-at-a-time**: when `Part.linked` is set, the row button advances both parts and the tabs
  show `Sleeve 1+2`. `makeCount`/`piecesDone` already model "two of these"; this models "two of
  these at the same time", which is how socks and sleeves are actually knitted.
- **Gauge card** in the part editor: pattern gauge vs "what I measured", and the resulting
  "your row gauge is 8% tight — 32 cm is about 118 rows, not 110". This turns the length-based
  `until` milestones from line 10 into row targets, which is the only way a row counter can serve
  a pattern that measures in centimetres.
- **Glossary sheet** (⋯ menu): the abbreviations found in *this* pattern with plain-English
  meanings, built from the profile table. `looksLikeGlossary` (patterns.js:710) already **finds**
  the pattern's own abbreviation block and throws it away — keep it instead.
- **3D diagram**: `Diagram` rows mode already renders a stacked sheet of stitch bumps and needs no
  change to be useful for knitting. `Patterns.expand` (1900–2322, 423 lines) does need a knitting
  twin, but it mirrors `evaluate` branch-for-branch, so it is mechanical. **Defer it to phase 3**
  — the counter is the product, the diagram is the delight.

### 1.5 Import

Unchanged plumbing: `ctx.pdfDropZone` / `PdfText.extract`, the sections picker, the "From this
PDF" synthetic template card, `importPatternSections`. Knitting-specific handling:

- **Section names are garment parts, not amigurumi parts.** `PLACE_NOUN_RE` (patterns.js:829) is
  an amigurumi anatomy list; the knitting profile swaps it for Back / Front / Left Front /
  Sleeve / Yoke / Body / Collar / Cuff / Neckband / Button Band / Heel / Gusset / Toe.
- **Size is chosen once, at import.** The sections list gets a size selector at the top bound to
  `Project.sizeIndex`, populated from `detectSizes` — because a knitting PDF states
  `XS (S, M, L, XL) (2X, 3X)` on page 2 and then uses it on every line for 14 pages.
- **Gauge and needles are extracted from the front matter** into the gauge card, not thrown away
  as notes. Guard: `EQUALS_TAIL_RE` (185) will otherwise read `22 sts and 30 rows = 4 inches` as
  a stitch count on a note line, and line 1451 promotes any counted note before row 1 into a
  **setup row** — a phantom 4-stitch setup on every imported knitting pattern.
- **Charts stay images.** Knitting symbol charts are drawn as a grid of glyphs in a symbol font;
  reading them is a phase-3 stretch (§ P13). For v1, rasterise chart pages to `BlobStore` exactly
  as the sewing module does for diagrams, and give the row counter a "chart row 7 of 16" chip
  that opens the page image. That covers 90% of the need for 5% of the work.
- **Ravelry.** No API integration (no backend, no per-user cost). But "paste the pattern from the
  Ravelry PDF" is exactly the existing flow, and a **URL field on the project** that opens the
  Ravelry project page is one input.

### 1.6 Phased plan

| Phase | Ships | Rough size |
|---|---|---|
| **0 — Pluggable parser** | `Store.registerCraft({ parser })`, `linesFor` dispatch, craft profile object extracted from `patterns.js` (VOCAB/ZERO_RES/MR/PREFIX/stitchTok), all existing tests still green | 1 agent-day, no user-visible change |
| **1 — Knitting counts** | `js/knits.js` profile + the three structural features (in-segment multi-size, `*…*` with remainder, RS/WS on `Line`); `craft:'knitting'` rendering `#screen-project`; RS/WS chip; knitting templates (Sweater, Socks, Hat, Shawl, Blanket); `test/knits.test.html` ≥ 200 assertions | 3–4 agent-days |
| **2 — What makes it knitting** | Markers + per-segment counts, short-row mode, two-at-a-time, gauge card + length→rows, glossary sheet, tour + FAQs, chart-page images | 3 agent-days |
| **3 — Delight** | `Knits.expand` for the 3D diagram (rows mode), cable ring, chart symbol reader beta | 3+ agent-days, cut if phase 2 lands well |

Fixtures needed in `tmp-pdf/` before phase 1 is credible: **a PetiteKnit top-down raglan**
(short rows at the back neck, markers, multi-size everywhere), **a DROPS pattern** (terse,
translated, numeric sizes, `Garnstudio`'s house style), **a sock pattern with a flap-and-gusset
heel** (short rows, `turn`, in-segment sizes — see the real lines in §1.3), **a lace shawl**
(asterisk repeats with remainders, chart + written both), and **a cabled sweater** (`C6F` family,
"cable every 8th row"). Five files, and the knitting parser is as well-grounded as the crochet
one is at v2.4.

---

## Part 2 — `docs/CRAFTS.md`: what a fourth craft hits

These are things the crochet core assumes that the contract does not say out loud. Every one of
them bit this analysis; a fourth craft will hit all of them on day one.

1. **The parser is a hard-coded global.** `patternsApi()` (store.js:958) returns
   `window.Patterns`, always. A craft cannot supply its own row parser, so
   `linesFor`/`targetFor`/`lineForRow`/`currentTargetInfo`/`repeatInfo`/`diagramModel` — the
   entire counting core — is unreachable for any craft that counts rows. **This is the gap.**
2. **`Line` has no documented contract.** `docs/CRAFTS.md` never mentions the `Line` shape, so a
   craft module has no idea what it would have to produce to be counted. It should be promoted to
   a contract next to `craftData`.
3. **Any non-crochet craft is exiled from `#screen-project`.** `isCraftProject` (app.js:712) is a
   binary gate at render (824) and at the ⋯ menu (4150). There is no way to say "I am a craft, and
   I want the counter". A `usesCounter: true` flag in `registerCraft` would fix it.
4. **`ctx` has no counter widgets and no `undo`.** It gives `el`/`button`/`field`/`stepper`/
   `openSheet`, but not the big tap button behaviour (12px move tolerance, press-and-release,
   keyboard `detail === 0`), the row counter, part tabs, the repeat readout, the alerts sheet or
   `Store.undo()`. Every counting craft reimplements the most carefully-tuned code in the app.
5. **`createProject` always makes exactly one part named `Main`.** There is no craft hook to seed
   parts, so a craft's built-in templates cannot ship a Front/Back/Sleeves structure the way
   crochet's `dragon` template does. `Template.craftData` seeds `craftData` but not `parts`.
6. **The ⋯ menu hides `Parts`, `Yarn colours` and `Save as template` for every non-crochet
   craft** — reasonable for cross-stitch, actively wrong for knitting, which needs all three.
   Hiding should be per-craft, declared by the module.
7. **The New-project PDF drop zone and import picker are crochet-only and hardcoded** (SPEC.md
   "Template picker, crochet only"). `newProjectFields` lets a craft add fields, not participate
   in the app's best feature. Crafts get the worse two-step (create, then ⋯ → Import).
8. **`Settings.crafts` exists as data with no UI hook.** A craft can store per-craft settings but
   cannot render a settings section for them; there is no `settingsFields(body, ctx)` in
   `registerCraft`. Sewing worked around it with its own sheets.
9. **`Store.suggestChecklist` is crochet vocabulary** (Sew/Attach/Stuff/Embroider/Weave in/Block)
   and is not craft-dispatched, so every craft gets amigurumi assembly suggestions.
10. **Colours and the diagram are crochet globals.** `Project.yarnColors`, `Patterns.colors`,
    `Patterns.colorHex` and `Store.diagramModel` are genuinely craft-independent ideas
    (the colour engine is 228 lines with zero craft coupling) living in crochet-only files.
11. **Home-card summaries have no shared shape** — already on the owner's list from the UX sweep;
    a fourth craft makes it three different shapes plus crochet's.
12. **Adding a craft touches five shared files with no registry**: `index.html` script tags,
    `sw.js` precache, `css/` link order, and the craft-id union typed in prose in both SPEC.md and
    CRAFTS.md. A `js/crafts-manifest.js` that the service worker and `index.html` both read would
    make a craft a directory, not a diff.
13. **Testing guidance covers parsers and charts, not counters.** "A stitch tap must update the
    DOM in < 5 ms" is the right bar; there is no guidance for a craft that adds row-counting state
    to the tap path (markers, RS/WS, linked parts).
14. **Craft emoji collision is unhandled.** `craftInfo` falls back to 🧵 for any craft without one,
    and the fourth yarn craft has no distinct glyph (§1.1).
15. **The `onPages` + `onText` caveat** in `ctx.pdfDropZone` is documented but still a footgun: a
    craft that wants both page images and clean cross-page text has to call `PdfText.extract` and
    `PdfText.open` separately and nothing enforces it.

---

## Part 3 — The crafts after knitting

Ranked by **(what the existing contract already gives you) ÷ (what it lacks)**, not by market
size alone. Market context: 71% of US consumers identify as crafters and TikTok/YouTube are the
biggest growth drivers for 18–35s ([Mintel 2025 via Craft Industry Alliance](https://craftindustryalliance.org/trend-report-punch-needle-crafting/)).

| Rank | Craft | Market | Contract covers | Contract lacks | Verdict |
|---|---|---|---|---|---|
| **1** | **Needlepoint + counted embroidery** (as a cross-stitch expansion) | Embroidery/needlepoint retail **$2.12B in 2026 → $2.99B by 2035, 3.9% CAGR** ([BRI](https://www.businessresearchinsights.com/market-reports/embroidery-needlepoint-retail-market-123517)) | Almost everything: `js/xstitch.js` already has DMC floss maths, skein ranges, the chart grid, the colour key with per-layer tallies, the canvas viewer, the printable chart, photo→chart, and a **layer switch for backstitch / knots / fractionals** — which is already "more than one stitch type per cell" | Stitch-type palette beyond 4 (tent/basketweave/continental; satin, stem, chain, French knot, lazy daisy for surface work); canvas mesh count instead of Aida; **surface embroidery is not a chart at all** — it is an outline + stitch-order checklist, which is closer to the sewing steps model | **Best next bet.** Ship counted needlepoint as a chart-module setting (weeks, not months); treat surface embroidery as a separate later question. The cross-stitch module already flags embroidery PDFs in its importer — it just has nowhere to send them. |
| **2** | **Tunisian crochet** | Flagged as a rising 2026 technique; the best-selling Tunisian hook set is up **66.7% month-on-month** ([ASINsight](https://www.asinsight.com/report/US/tunisian-crochet-hooks-set)); crochet hook market $0.83B → $0.9B 2025→26, 7.7% CAGR | Everything. It is the crochet counter with `tss/tks/tps/tdc`, a forward pass and a return pass | Two half-rows per row (forward + return) — one extra counter mode; a few abbreviations; nothing else | **Free, once the parser is pluggable.** Not a craft: a **vocabulary pack + "two passes per row" toggle** on crochet projects. Ship it in the same release as knitting as a 1-day add-on and it reads as generosity. |
| **3** | **Beadwork — loom, peyote, brick** | Crowded but active app market (Loomerly, Threadologie, PlanBead, BeadTool) — all **pattern makers**, none a good progress counter | ~70% of the cross-stitch chart engine: a grid of coloured cells, a colour key with counts, row-by-row progress, a photo→chart pipeline that is *identical* apart from the palette | Miyuki Delica colour library instead of DMC; **offset rows** (peyote/brick are half-drop, not square); bead-count-per-gram shopping maths; loom warp thread calculator | **Strong third.** The photo→chart worker and the chart viewer port almost directly; the palette is a data file. Differentiator vs incumbents: they design, we count. |
| **4** | **Weaving (rigid heddle + tapestry)** | "Technical backbone of the fiber-art revival"; small but committed | The counter (picks instead of rows), parts, templates, notes | **Warp calculator** (ends, width, sett, take-up, loom waste) is the real pain and is pure arithmetic; 4-shaft drafts need a **threading / tie-up / treadling grid renderer** and the WIF file format, which is a whole module | **Interesting, niche.** A standalone *warping calculator* would be loved and is a 1-day tool; the full draft renderer is a bad bet for a phone. |
| **5** | **Punch needle** | **Fastest-growing craft among younger makers**; DIY kit sales +35% in 2024 ([Craft Industry Alliance](https://craftindustryalliance.org/trend-report-punch-needle-crafting/)) | Project list, notes, timer, photos, celebrations | Everything that matters: there is **nothing to count**. Progress is "which area of the printed template is filled", which needs an area-fill tracker on an image — a new interaction, not a counter | **Great market, wrong app.** Revisit only if an image-region tracker is built for something else first. |
| **6** | **Macramé** | Etsy macramé searches **+400%** ([per the same trend reporting](https://craftindustryalliance.org/trend-report-punch-needle-crafting/)) | Checklist, notes, timer | No rows, no stitch counts. The genuine pain is **cord-length calculation** (cord = 4× finished length per strand, ×2 folded, plus fringe) and knot-sequence recall | **No.** Ship a free cord calculator inside the app if anything; a macramé *module* has no counter to hang on. |

**Recommendation:** knitting → Tunisian (free rider) → counted needlepoint → beadwork loom.
Three of those four are expansions of engines that already exist, which is the only way a solo
owner adds four crafts without the app becoming four apps.

---

## Part 4 — Proposals, ranked by impact ÷ effort

Effort: S ≈ ≤1 agent-day, M ≈ 2–4, L ≈ a week+. Impact 1–5.

| # | Title | Effort | Impact | Ratio |
|---|---|---|---|---|
| 1 | Make the pattern parser a craft slot | S | 5 | ★★★★★ |
| 2 | Keep RS/WS instead of throwing it away | S | 4 | ★★★★ |
| 3 | Move size selection to the project, once | S | 4 | ★★★★ |
| 4 | Gauge card and length→rows | S | 4 | ★★★★ |
| 5 | Stop "until it measures 30 cm" becoming 30 rows | S | 4 | ★★★★ |
| 6 | Tunisian crochet as a vocabulary pack | S | 3 | ★★★ |
| 7 | Two-at-a-time linked parts | S | 3 | ★★★ |
| 8 | Ship knitting as a crochet-shell twin | M | 5 | ★★★ |
| 9 | `js/knits.js` — the knitting profile | M | 5 | ★★★ |
| 10 | Real asterisk repeats with a remainder tail | M | 5 | ★★★ |
| 11 | A craft is a directory, not a diff | S | 2 | ★★ |
| 12 | Stitch markers as live state | M | 4 | ★★ |
| 13 | Counted needlepoint on the cross-stitch engine | M | 4 | ★★ |
| 14 | `ctx.counter` — the counter widget kit | M | 3 | ★½ |
| 15 | Beadwork loom on the chart engine | L | 3 | ★ |

---

**1 · Make the pattern parser a craft slot**
· **Why** — `patternsApi()` (store.js:958) hard-codes `window.Patterns`, which is the single line
keeping every future row-counting craft out of a counter core that would otherwise serve it
unchanged. Everything else in this document depends on it.
· **Proposal** — `Store.registerCraft({ …, parser })`; `patternsApi(craftId)` returns
`craftDef(craftId).parser || window.Patterns`. `linesFor(part)` takes the part's owning project
(or the part caches its craft id at creation) so the lookup is O(1) on the tap path. Document the
`Line` contract in `docs/CRAFTS.md` beside `craftData`. No behaviour change: crochet resolves to
`window.Patterns` exactly as today and every existing test stays green.
· **Effort S · Impact 5**
· **Risks** — `lineCache` is keyed on `part.id` + size; adding a craft dimension to the key is
easy to get subtly wrong. Parts do not currently know their project, so the lookup needs a clean
answer rather than a scan.

**2 · Keep RS/WS instead of throwing it away**
· **Why** — `KEYWORD_RE` (patterns.js:109) and `SETUP_RE` (119) already *match and discard*
`(RS)`/`(WS)`/`(right side)`/`(wrong side)`. "Which side am I on" is the most common thing a flat
knitter loses, and the information is already in the regex.
· **Proposal** — add `Line.side: 'rs'|'ws'|null`, set it in `makeLine` (1090), infer parity
forward from the first tagged row in a flat section, and render an `RS`/`WS` chip beside the row
number with a tap to flip when the knitter's parity has drifted. Flip on `turn`.
· **Effort S · Impact 4**
· **Risks** — crochet patterns also tag `(WS)` (the cardigan fixture does); the chip must stay
hidden for crochet unless the owner decides it is useful there too. Inference across a section
that starts mid-pattern will sometimes be wrong — hence the tap-to-flip.

**3 · Move size selection to the project, once**
· **Why** — `Part.sizeIndex` is per part, but a garment pattern states its size once and uses it
for fourteen pages. Today a 6-part cardigan import means picking the size six times, and the
crochet cardigan fixture already exercises this.
· **Proposal** — `Project.sizeIndex` with `Part.sizeIndex` as an optional override (`null` =
inherit). One size selector at the top of the import sheet and one in the project editor.
`linesFor` resolves the effective index.
· **Effort S · Impact 4**
· **Risks** — migration of existing parts with a non-zero `sizeIndex`; the line cache key changes.
Both are contained.

**4 · Gauge card and length→rows**
· **Why** — a row counter cannot serve a pattern that says "until it measures 32 cm" without
knowing the knitter's row gauge. This is also the #1 reason garments come out wrong, and it
applies to **crochet garments today**, not just knitting.
· **Proposal** — `Project.gauge` (§1.2) + a part-editor card: pattern gauge, "what I measured",
and the derived correction ("your row gauge is 8% tight — 32 cm ≈ 118 rows, not 110"). Feeds
`targetRows` with one tap. Extract gauge from the PDF front matter at import.
· **Effort S · Impact 4**
· **Risks** — `EQUALS_TAIL_RE` (185) currently reads `22 sts and 30 rows = 4 inches` as a stitch
count, and line 1451 promotes a counted note before row 1 into a **setup row** — so gauge
extraction must land *before* this, or every imported garment gets a phantom setup row. Fix that
guard whether or not the card ships.

**5 · Stop "until it measures 30 cm" becoming 30 rows**
· **Why** — `detectRepeat` (745–754) parses "repeat rows 1-4 until 12" into `untilRows: 12` and
surfaces it through `summary().suggestions.targetRows`. Knitting's dominant form is "until the
piece measures 12 inches", so **"Apply detected settings" will confidently set a wrong target on
most knitting patterns** — and on crochet garments too.
· **Proposal** — a unit guard on the `until` capture; when the value is followed by a length unit,
emit `Line.until = { kind:'length', value, unit }` and feed the gauge card (#4) instead of
`targetRows`. Show it on the counter as a milestone chip ("keep going until 32 cm").
· **Effort S · Impact 4**
· **Risks** — none beyond a fixture; this is a bug fix wearing a feature's coat.

**6 · Tunisian crochet as a vocabulary pack**
· **Why** — a genuinely rising technique (hook sets +66.7% MoM) that is 95% covered by the
existing counter, and shipping it alongside knitting costs almost nothing while reading as
generosity to the existing crochet base.
· **Proposal** — not a craft. A `stitchLanguage: 'crochet'|'tunisian'` field on a crochet project
that swaps in `tss/tks/tps/tdc/tfs` and adds a **two-passes-per-row** counter mode (forward pass
counts up, return pass counts down, one row per pair). Depends on #1.
· **Effort S · Impact 3**
· **Risks** — the two-pass counter is a real change to the tap path for those projects; it must
be branch-free for ordinary crochet. Scope creep into "Tunisian is its own craft" — resist.

**7 · Two-at-a-time linked parts**
· **Why** — socks and sleeves are knitted two-at-a-time specifically to avoid second-sock
syndrome, and no counter app models it. `makeCount`/`piecesDone` already model "two of these
sequentially"; this is the missing sibling.
· **Proposal** — `Part.linked: partId`. The row button advances both linked parts; the tab reads
`Sleeve 1+2`; undo unwinds both. Works for crochet mittens too.
· **Effort S · Impact 3**
· **Risks** — undo across two parts needs a single snapshot, not two; `allPartsDone` and the
history entries need to stay honest about which part finished.

**8 · Ship knitting as a crochet-shell twin**
· **Why** — the alternative (a `#screen-craft` module) duplicates ~1500 lines of the most
carefully-tuned code in the app — the 12px tap tolerance, press-and-release, auto-advance,
repeat readout, undo — and doubles the cost of every future counter fix. Knitting is the same
counter with a different language.
· **Proposal** — a `usesCounter: true` flag in `registerCraft` that makes `isCraftProject`
(app.js:712) fall through to `#screen-project`; a craft label/vocab map for the few crochet words
on that screen (`rowWord` at app.js:119 is already centralised); per-craft control of which ⋯ menu
items are hidden. Craft identity 🧣 (§1.1).
· **Effort M · Impact 5**
· **Risks** — this is the one change that touches the crochet render path, and the hard rule so
far has been "a crochet-only install is byte-identical". Needs the full crochet regression pass
and the existing 479 + 263 + 94 assertions green. The emoji question is unresolved and visible on
every home card.

**9 · `js/knits.js` — the knitting profile**
· **Why** — the actual parser. ~53% of `patterns.js` copies unchanged and another ~17% is generic
machinery fed by craft data; the knitting delta is a ~200-line vocabulary profile plus the three
structural features.
· **Proposal** — extract `VOCAB` + `ZERO_RES` + `MR_RE*` + `PREFIX_RE` + `stitchTok` into a
profile object the shared engine takes as a parameter, then write the knitting profile (§1.3
table) and `test/knits.test.html` against the five fixture PDFs in §1.6.
· **Effort M · Impact 5**
· **Risks** — bare `k`/`p` collide with `ZERO_RES`'s `/^[a-z]$/` (patterns.js:314) and with
`colorHex`'s single-letter legend keys (1759); `KEYWORD_RE` (107) already eats a leading `r` +
digits. `C6F`-family cables cannot be expressed in a `[re, int, int]` tuple at all — the table
entries need to become optionally functions of the match. And refactoring a parser with 742
passing assertions is exactly the kind of change that quietly costs a day of fixture triage.

**10 · Real asterisk repeats with a remainder tail**
· **Why** — `rep from * to last 3 sts, k3` is the single most common line in knitting, and
`scanItems` (416) currently mangles it: it pairs the opening `*` with the `*` inside "from *",
captures `"k2, p2; rep from "` as the group, and only produces a right answer for `to end` by
accident via `OPEN_FILL_RE` (466).
· **Proposal** — a real `*…rep from *` scanner with an explicit remainder tail (`to end`,
`to last N sts`, `to 2 sts before marker`, `rep from * N more times`), and `;` treated as a
higher-precedence separator than `,` in `splitSegments` (395). Benefits crochet too — the same
notation appears in crochet garment patterns.
· **Effort M · Impact 5**
· **Risks** — `scanItems` is the heart of `evaluate()` and the crochet fixtures depend on its
current bracket behaviour. Do it behind the profile so crochet keeps today's path until its
fixtures prove the new one.

**11 · A craft is a directory, not a diff**
· **Why** — adding a craft today edits `index.html`, `sw.js`, the CSS link order, and a craft-id
union written in prose in two documents. Four crafts is where that stops being charming.
· **Proposal** — `js/crafts-manifest.js`: one array of `{ id, scripts[], styles[] }` that
`index.html` and `sw.js` both read, so the precache list and the script tags cannot drift apart.
· **Effort S · Impact 2**
· **Risks** — the service worker reading a JS manifest at install time needs care; a broken
manifest is a broken offline app. Keep the fallback list.

**12 · Stitch markers as live state**
· **Why** — markers are how knitters survive raglan yokes and lace, and "how many stitches to the
next marker" is exactly the kind of running arithmetic a counter should do and a human should
not. No free competitor does it (the field is dominated by plain row tallies —
[My Row Counter](https://rowcounterapp.com/), [Knitting Row Counter](https://umitapp.com/best-knitting-row-counter/)).
· **Proposal** — `Part.markers` (§1.2), set from `pm` in the parsed setup row (example line 4),
rendered as a strip under the stitch readout showing stitches-to-next-marker live, plus the
per-segment breakdown `3 | 12 | 30 | 12 | 3`.
· **Effort M · Impact 4**
· **Risks** — this is new state on the tap path and the bar is < 5 ms; keep it to integer
arithmetic on a ≤ 12-element array and patch the DOM rather than re-rendering. Marker positions
drift after increases and must be recomputed from the row's instruction, not stored blindly.

**13 · Counted needlepoint on the cross-stitch engine**
· **Why** — the largest adjacent market ($2.12B in 2026, 3.9% CAGR) reachable by expanding a
module that already exists. `js/xstitch.js` has DMC floss, skein maths, the chart grid, the
colour key and **a layer switch for backstitch / knots / fractionals** — the hard part (more than
one stitch type per cell) is built. The importer already *detects* embroidery PDFs and has
nowhere to send them.
· **Proposal** — a stitch-type palette (tent / basketweave / continental) and canvas mesh count
alongside Aida count, behind a project-level "counted needlepoint" flag on the cross-stitch
craft. Explicitly out of scope: surface embroidery, which is an outline + stitch-order problem
closer to the sewing steps model.
· **Effort M · Impact 4**
· **Risks** — scope. "Embroidery" means four different crafts to four different people and the
temptation to serve all of them will sink it. Ship counted-on-canvas only and say so.

**14 · `ctx.counter` — the counter widget kit**
· **Why** — CRAFTS.md gaps 4 and 13: the big tap button's behaviour (12px tolerance, press-and-
release, keyboard `detail === 0`, double-tap = two stitches) is the most tuned code in the app and
no craft module can reach it. Sewing already rebuilt a smaller version (`MOVE_TOLERANCE_SQ` is
copied verbatim into `app-sewing.js:456` with a comment saying so).
· **Proposal** — add `ctx.counter.bigButton(opts)`, `ctx.counter.rowReadout(opts)`,
`ctx.counter.partTabs(opts)` and `ctx.undo()` to the craft context, refactoring the crochet screen
to use them so there is exactly one implementation.
· **Effort M · Impact 3**
· **Risks** — refactoring the crochet tap path for the benefit of hypothetical crafts is the
wrong order if #8 lands, since knitting would then use the real screen and not need this. Do #8
first and re-evaluate; this may be unnecessary.

**15 · Beadwork loom on the chart engine**
· **Why** — a grid of coloured cells with row-by-row progress is literally the cross-stitch
viewer, and `js/xstitch-photo.js` (linear-light resample → CIELAB → k-means → nearest colour by
CIEDE2000) is palette-agnostic: swap DMC for Miyuki Delica and it makes bead patterns. The
incumbent apps (Loomerly, Threadologie, PlanBead, BeadTool) are **designers**, not counters.
· **Proposal** — a `beadwork` craft reusing the chart viewer and photo worker, with a Delica
colour data file, offset-row rendering for peyote and brick stitch, and bead-count-per-gram
shopping maths.
· **Effort L · Impact 3**
· **Risks** — offset rows are not a cosmetic change to the canvas renderer; the half-drop
geometry touches hit-testing, the printable chart and the photo pipeline's output model. And it
is a fifth craft — worth doing only after knitting and needlepoint prove the plugin story holds.

---

## Sources

- [Ravelry 2022 Community Stats](https://blog.ravelry.com/2022-community-stats/)
- [Ravelry statistics roundup — Knit Like Granny](https://knitlikegranny.com/ravelry-stats/)
- [Craft Yarn Council — Knitting & Crocheting Are Hot](https://www.craftyarncouncil.com/know.html)
- [Craft Industry Alliance — Yarn Consumer Survey 2025](https://craftindustryalliance.org/the-size-of-the-yarn-market-yarn-consumer-survey-results-2025/)
- [Craft Industry Alliance — Punch needle trend report](https://craftindustryalliance.org/trend-report-punch-needle-crafting/)
- [Embroidery (Needlepoint) Retail Market](https://www.businessresearchinsights.com/market-reports/embroidery-needlepoint-retail-market-123517)
- [ASINsight — Tunisian crochet hook sets](https://www.asinsight.com/report/US/tunisian-crochet-hooks-set)
- [Stitch Maps — Knitspeak grammar](https://stitch-maps.com/about/knitspeak/)
- [Craft Yarn Council — How to read a knitting pattern](https://www.craftyarncouncil.com/standards/how-to-read-knitting-pattern)
- [My Row Counter](https://rowcounterapp.com/) · [Knitting Row Counter (UmitApp)](https://umitapp.com/best-knitting-row-counter/) — the incumbent row counters
- [Ysolda — Deep Shadow sock heel](https://ysolda.com/blogs/journal/deep-shadow-sock-heel-tutorial) and [Modern Daily Knitting — flap & gusset heel](https://www.moderndailyknitting.com/community/flap-gusset-heel-recipe-toe-up-socks/) — source of the verbatim heel-turn lines in §1.3
