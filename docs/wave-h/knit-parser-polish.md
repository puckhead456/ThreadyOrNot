# knit-parser-polish — report (wave H)

Owner of `js/patterns.js`, `js/knits.js`, `test/patterns.test.html`, `test/patterns.fixtures.html`,
`test/knits.test.html`, `test/knits.fixtures.html`. Nothing committed, nothing downloaded, nothing
copied out of `tmp-pdf/`. Store / app / diagram / pdftext files were read, never edited.

## What the knitter sees

- Instructions printed inside a paragraph are counted: the lace hat's "…rib for 3/4". Inc. Rnd: Work
  in St st … —144 sts. Work 5 rnds even …" is round 1 (144) and five plain rounds; the Arrowhead's "Rep
  Rows 9–20 six more times …—191 sts" and "Change to Chart 2 …—207 sts"; the boot stocking's toe paragraph
  is Dec rnd 56, even 56, ×3 to 48, Dec rnd 44 (21 sole + 23 instep), … 18; Spectrum's "…to CO 27 sts.
  Knit 6 rows. Next row: …"; On-Your-Toes' cast-on wrapped over three lines; Albus Argyle's "Next" / "rnd
  Knit, dec …—64 sts"; Oriel's "Shape bust: Inc row: (RS)" (87 + 2 = 89) and its "ending with chart" /
  "Row 20—87 sts rem" (the end of a sentence, not rows 20–87).
- Flying Trapeze's six sizes read the pattern's two numbers by its own grouping ("the first number is for
  sizes toddler, woman's small, and man's small …") — 60 at 5"/7"/9", 68 at 6"/8"/10". A two-number list
  on a six-size pattern that does not say how still shows no count.
- A short row that only turns (no decrease, no printed total) shows no count of its own — Genome's
  "K19, turn, leaving last st unworked" is no longer the 48 on the needles; Time Traveler's wrap-and-turn
  short rows likewise (research T11 says "null on the row"); heel turns that decrease keep their counts.
  A heel-flap row that works to the end and turns is not a short row.
- Tunisian crochet patterns are read as Tunisian: a forward pass and its return pass are one row, the
  loops on the hook are the count, tss/tks/tps/… are stitches, the 3D gets Tunisian records.

## The 23 KNOWN fixture lines

`test/knits.fixtures.html?heavy=1`, fresh tab, with the extractor that has now landed: **235 passed, 0 failed, 4 known** (232 / 0 / 4 without `?heavy=1`) —
was 168 / 0 / 23. **19 of the 23 closed**, each now a plain assertion, most with neighbours asserted too:

| Id | What it was | What closed it |
|---|---|---|
| LF2, LF3, AR2, AR3, H11, SP1, A1, O1, H3, HE6 | rows / repeats / cast-ons printed inside a paragraph or with their label broken over a wrap | the knitting reflow (below) |
| OR4 | "Shape bust: Inc row: (RS)" | a step name before a named row (`knitDetectNextRow`) + the reflow |
| F1, F1 six sizes | six sizes over two numbers | `columnsOf` / `opts.sizeColumns` |
| F13 | the toe's printed 34 at the 68-st sizes | the columns (and the reflow) — the printed 34 is kept with its deviation |
| G4 | the heel short row showed 48 | short rows that only turn carry no count |
| M15 | "Knit 6, knit 2 together. Repeat to end of row." | a star-less "Repeat to end of row" repeats the stitches before it; "knit 2 together" is a token; the gusset's "for a total of 36 (40, 48) stitches" is the count |
| T15, T16 count | the advert inside the heel row | the extractor now reads the advert after the page; the row's "(see" / "Glossary), turn—1 heel st dec'd." wrap is joined over its open bracket, so −1 and then 63 |
| F2 | "Work Rnds 1–44 of chart once." | p15 now reads in column order; "of chart" (the pattern's one unnamed chart) is read as Chart rows 1–44 |

Still KNOWN (4), and why:

- **Bernat neck / yoke names** — the PDF prints no heading over them; a name would be invented (the
  store names unnamed sections, see knit-qa).
- **T7, T9** — "work Row 1 of Foot chart over 32 sts": the chart is a vector drawing, its rows are not
  read; T9 counts on from T7.
- **R5** — Rico's "*P7, k2*" rows grow "according to patt"; the 9-st repeat does not divide the count.

## QA defects (docs/wave-h/knit-qa.md, "For knits-parser") — status

1. **Bernat XL/2/3XL yoke numbering** — fixed. A size-only block that restarts at "1st rnd" in the
   middle of a part goes on from the rows before it ("Sizes XL, 2/3XL and 4/5XL only: 1st rnd" is round
   43 at XL); the divide follows the block. New profile hook `rowOffset`.
2. **Rows after a length stretch numbered from 1** — fixed where it can be done honestly: when a part
   opens with "Knit even … until … measures 12" from the divide / CO / pick-up / a further …" and the
   pattern prints its gauge, the stretch covers ≈ rows (`Line.approxRows`, e.g. Bernat Body 1–51 at 17
   rows/4") and the "Next rnd" rows after it are numbered on from there. No gauge, a length measured
   from somewhere else, or printed row numbers after it: nothing is renumbered.
3. **Speed Bump toe** — fixed. "…7 (8, 10) more times, then work Rnd 1 once more—20 (24, 24) sts":
   the repeat spells out its rows (the block ×7, then Rnd 1), the printed 20 is on the extra round, no
   false deviation.
4. **A repeat's printed total on its last row** — fixed (the rows before it stay uncounted).
5. **Magic-loop** — sizes are "36 st, 40 st, 48 st"; the heel flap is half of the stitches (24 at 48);
   heel rows count 23, 22 … row 6 **18** (12 at 36); "leaving (2) stitches" is never a total; starred
   size-only rows ("****Row 7: 40 stitch sock only:", "####Row 9: 48 stitch only:", and the scope-less
   "****Row 8" after one) are rows for their sizes only. Rows 7–10 themselves stay uncounted (the
   pattern's typos: "knit 0 (2) leaving 0 ()").
6. **Icelandic** — fixed: "Row 15 and all following odd-numbered rows through Row" / "35:" is rows
   15–35 odd; interleaved enumerations ("Rows 38 and 40" / "Rows 39 and 41", "47 and 49" / "48 and 50")
   count row by row in the order they are worked (288, 288, 286, 286 … 280, 278, 278, 276, 276), and the
   single rows between them are re-counted; the border's picked-up foundation keeps its own rows
   (`setupOwnsRows`); the contents page's wrapped title gives the group "Icelandic Lace Shawl".
7. **Henley** — the stitch-guide "Division Pattern" rows are not offered as a part; a chart title over its
   row labels ("Back and Sleeve Lace" / "20" / "18" …) is never a part heading; "Work as for back until
   …" (shaping) no longer publishes the last row's count on every row; the neckband's "Work 5 rows in St
   st" is plain rows (87, not +4 a row to 107). The sleeve / fronts / bands still share one section
   ("Hem") — not touched.
8. **Sock book / lace book parts** — designer bylines the contents page names are never parts;
   stitch-guide definitions ("DNA Cable: (worked over 11 sts)") are not parts; the lace book's "Glossary"
   is no longer a pattern group; "Guanaco and" / "Vicuña Lace Fingerless Gloves" keeps its full title.
   **Left:** Speed Bump's Cuff and Leg are length stretches with no numbered rows ("Work in k1, p1 rib
   for about 1½"…"), so they are not parts yet.
9. **"Needle 1:" as a colour** — not reproduced on synthetic text (`colors()` returns no Needle names);
   asserted.
10. **Gauge / needle lines carried into each part** — done, as a field: each part of `splitSections`
    has `gaugeLines` (the pattern's own labelled "Gauge: …" / "Needles: …" lines, from its group in a
    book; a bare "GAUGE" heading over its line too). They are **not** in the part's text (see "Front
    matter is never part text" below); only a part with a length stretch ends with the gauge line.
    `test/knit-counter.test.html` (line 1018) now expects Sock Two's own gauge, `[34, 48]`, and gets it.
11. **workMode of a sock with a flat heel** — 'rounds' (begun in rounds, rounds after the last row).
12. **diagram-model 528/1 (Stylecraft hood Motif `Part.dialect`)** — not the parser: the same failure
    reproduced with the pre-session `js/patterns.js` swapped in (request interception), and
    `Patterns.dialectHints` on that section said "uk" all along. The store side has since been fixed by
    its owner: diagram-model is **529 / 0** with this parser.

## Front matter is never part text (coordinator follow-up, 3D reference "yoke rounds")

`Store.splitSections(text, 'knitting')` on the Bernat pullover put the materials tail ("needles or size
needed to obtain gauge. Susan Bates® yarn needle…") at the head of every part, and the Neck began with
the materials, abbreviations, INSTRUCTIONS and Notes before its cast-on. Two causes, both in
`carryIntoParts` (`js/knits.js`):

- the gauge/needle carry matched any line starting "needles" — it now takes only a **labelled** line
  ("Needles:", "Gauge:", a bare "GAUGE" heading over its numbers), and the lines no longer go into the
  text at all: they travel as `gaugeLines` (passed through by `splitSections` in `js/patterns.js`);
- the first part of each pattern (each group in a book) now begins at its first heading, cast-on or
  row (`setup`/`row`/`repeat`, with any headings right above it): the front matter before it is the
  gauge card's and the notes', not the pattern sheet's.

So a part's text is now: optional `Sizes:` / `Numbers:` lines, then (a part that carries on) its heading
and `Start with N (…) sts.`, then its own lines. Two parts also **end** with the pattern's labelled
gauge line (as the crochet engine's `carryGauge` does — never in front of the first row): a part with
a length stretch ("Knit even … until work from sleeve divide measures 3""), so QA #2 holds when the
counter reads that part alone; and, in a book, each pattern's first part, because the store imports a
book's pattern from its parts' text alone (knit-counter's "imported pattern's OWN gauge, Sock Two
34/48" — that gauge used to arrive inside the front matter the first part no longer holds). Bernat now leads: Neck "With larger circular needle, cast on 36…", the yoke
"1st rnd: Knit.", "BODY", "SLEEVES", "Neckband: With RS facing…". Asserted on the real fixture
(`knits.fixtures`, QA group) and on synthetic text (`knits.test`, after #10).

## A FINISHING heading ends the part (extractor follow-up, crochet engine)

With the extractor's column fix, crochet-bernat-lace-cardigan p3 reads cleanly and its "Outer edging …
Next rnd" and "Sleeve edging … 1st rnd / 2nd rnd" ran on as the sleeve top's rounds (Sleeves 7 rows,
expected 5). Rule (general, engine): a bare capitals `FINISHING` / `FINISH` / `TO FINISH` / `MAKING UP` /
`MAKE UP` / `ASSEMBLY` / `EDGING(S)` line closes the part above it; the rows after it open a new part
(named "Edging" under EDGING, unnamed otherwise, or by a fresh heading printed after it), the prose
under the heading goes with that new part, and a heading queued above it never names what comes after
it. Also: "…17 (17-17-27-" / "38-38) sc across …" — the rest of a size list the line above left open — is
joined to that line, never a row 38. patterns.fixtures is **831 / 846** (829 / 844 + two new
assertions on this fixture: the edging rounds are not the Sleeves', and they are the two parts after
FINISHING); `Sleeves/2/5` holds with the correctly read page. Unit tests in `test/patterns.test.html`
("a FINISHING heading ends the part above it").

## Tunisian crochet (lens §3) — the contract

A vocabulary pack on the crochet reader, not a craft:

- `Patterns.isTunisian(text)` — Tunisian stitches (tss tks tps tfs tes ttw tdc thdc …), pass words
  (FwP, RetP, forward/return pass, standard return) or the word "Tunisian", in enough number. Plain crochet
  never is (tested; the old-vs-new differential confirms no crochet fixture is).
- `Patterns.parse(text)` reads a Tunisian text with `Patterns.tunisian` (=`createParser(TUNISIAN)`, the
  crochet profile plus: vocabulary, stitch heights, glossary, `reflow`, `detectNextRow`, `detectSetup`,
  `findExplicit`, `evaluate`, `afterLine`) and sets **`lines.meta.tunisian = true`**; `splitSections`
  marks each part `tunisian: true`; `dialectHints(text)` returns **`craft: 'tunisian', tunisian: true`**.
  Every other function dispatches the same way (text → `isTunisian`, lines → `meta.tunisian`), keeping
  the arity of the crochet function. Crochet texts go to the unchanged crochet reader.
- **One row = forward + return.** "Row 2: FwP: … RetP: …" keeps its forward pass on the row and puts the
  return on the next line; "Row 2 (RetP): …" / "Return pass: …" / "RetP: …" lines are notes with
  **`Line.returnPass = true`** (never rows, never a restart of the numbering); "Row 2:" over "FwP: …" is
  one row; an unnumbered "FwP: …" / "Forward pass: …" is the next row.
- **The count is the loops on the hook** at the end of the forward pass: "—20 loops on hook" / "(12
  loops)" are printed totals; computed: "Pull up a loop in 2nd ch from hook and in each ch across" over N
  ch = N (the loop on the hook is the first stitch), "Sk first vertical bar, tss in each st across"
  keeps it, "tks in next st, tps in next st; rep from * to last st, tks in last st", tss2tog −1, yo +1.
- "Foundation Row (FwP): …" is the foundation (setup); "Bind off: …" / "Bind-off row: …" is the last
  row.
- **`expand` records**: `t:'tss'|'tks'|'tps'|'tfs'|'tes'|'ttw'`, `h: 0.9`, `w: 1`; tdc `h: 1.8`, thdc
  `h: 1.3`; tss2tog etc. are `t:'dec'`; the skipped first bar adds an edge record `{t:'tss', edge:true}`
  so the row has as many records as loops.
- `Patterns.version` is now `'2.8/crochet+tunisian-1'` (the store keys its line cache on it).
- Tests: `test/patterns.test.html` group "Tunisian crochet (wave H)" — a dishcloth (chain, foundation,
  tss rows, a "Rows 3-20" range, bind-off: 21 rows of 20), a tks/tps textured block with tss2tog and
  "Row N (RetP)" lines, unnumbered forward/return passes, "Row 1:" over "FwP:", an entrelac text whose
  notes about rows stay notes, three crochet texts that must not read as Tunisian. **No Tunisian PDF
  fixture**: tmp-pdf/SOURCES.md says the Lion Brand Tunisian throw URL served HTML and was not kept, and
  no fixture on hand is Tunisian (none reads as one in the differential).

## Engine changes in `js/patterns.js`

All but two are behind a profile key crochet does not set, or only reachable through Tunisian text:
`PROFILE.reflow(raws)` (start of `prepareLines`), `PROFILE.rowOffset(cur, marker)` (before
`sectionForRow`), `PROFILE.setupOwnsRows`, a named part ("Foot: Work even …") carrying the count when
`PROFILE.carryCount` says so, `RUN = { opts }` (the options a parse was asked for, for hooks), and the
Tunisian section at the end. The two that reach crochet were asked for once the extractor landed: the
FINISHING rule above, and "a bare `38-38)` after a line that left a size list open is not a row" (in
the main loop and in the assembly-prose scan). **Old-vs-new differential** (old = the file as I found it; all 72 crochet /
knit / other / sewing PDFs and txt in tmp-pdf, parse at two sizes and at sizeCount 2, meta, summary,
countReport, splitSections, placement, sizes, gauge, colours, dialect, workMode, startHint, stuffing,
expand row by row on the document and on every part), run twice, with the landed extractor and with
the HEAD one: every crochet, other and sewing fixture is identical except **crochet-bernat-lace-cardigan**
(the FINISHING page: Sleeves 5 rows, the outer edging and the sleeve edging their own parts; intended)
and **crochet-patons-mesh-cardigan** (only the omitted FINISHING prose lines change which section index
they sit under; no row, count, name or part text changes). The knitting PDFs read with the crochet
reader differ where the knitting reader is the one meant (the lace book's FINISHING). Five scanned
files have no text layer in either run.

## Knitting changes in `js/knits.js` (beyond the above)

Reflow of paragraph instructions (lead forms: row labels, Next row/rnd, named rows, short rows, repeats,
"Work N rnds", "Work Rows a–b", "Change to … and work Rows", "Cont … every Nth row", cast-on / pick-up /
bind-off of N sts at a sentence start, "Place … N sts …—N sts"; a row's sentences go on while they are
stitches; a small-capitals label run into the sentence goes on its own line; a row label the line above
runs into is that sentence's end); `columnsOf` / `spreadColumns` / "Numbers:" carry line; short rows
(turn-at-end is not short; turn-only has no count); "until" / "end of rnd" fills; moving the beginning of
the round keeps the count; `Line.approxRows`; `thenOnceMore`; last-row totals; starred size-only rows
and "N stitch sock only" scopes; "36 (40, 48) Stitch" sizes; "half of your stitches"; "across all N
stitches"; "…" as a pause; "as before"; "purl remaining N"; "knit 2 together"; "Repeat to end of row";
"a total of N stitches"; "leaving (2) stitches" never a total; ordered enumeration counts; "all
following odd-numbered rows through Row N"; stitch-guide sections not parts; chart titles not parts;
designer bylines not parts; wrapped contents titles; Glossary not a group; gauge/needle lines carried;
"Work N rows in St st" is plain; `workMode` for socks; `Knits.isTunisian` (always false) /
`Knits.tunisian` (null) for API parity.

A regex I added (the "N stitch sock only" scope) backtracked catastrophically on a run of chart labels
("61 59 57 …") and hung `splitSections` on the lace book; it was rewritten to one unambiguous reading
before anything else ran on it. Worth knowing if a fixture page ever "never finishes".

## Suites (all in a headless Chrome on localhost:8766)

With the landed extractor, fresh tab each:

| Suite | Result | Baseline |
|---|---|---|
| patterns.test | **1067 / 0** | 1037 (+27 Tunisian, +3 FINISHING) |
| patterns.fixtures | **831 / 0** (`?heavy=1` **846 / 0**) | 829 / 844 (+2 bernat-lace assertions) |
| knits.test | **301 / 0** | 237 |
| knits.fixtures | **232 / 0 / 4 known** (`?heavy=1` **235 / 0 / 4 known**) | 165 / 168 with 23 known |
| templates | 147 / 0 | 147 |
| crafts | 124 / 0 | 124 |
| diagram-model | **529 / 0** | 529 |
| store-safety | 307 / 0 | |
| knit-counter | **295 / 0** | |
| diagram | 241 / 0; reference fixtures **282 / 1** (Bernat yoke `grows`, see "For other owners") | |
| backup | 205 / 0 | |
| knit-chart | 151 / 0 | |

## Tooling note (for the coordinator)

All runs are a headless Chrome of my own (port 9461, profile in my scratchpad) driving the test pages
over CDP, fresh tab per run. While the extractor was mid-change it could not read the lace book, so
the work in between was checked with the HEAD `js/pdftext.js` served in its place (request
interception — nothing in the worktree was touched); every number below is with the landed extractor
unless it says otherwise. The dev server on 8766 stopped once during the session; it was restarted
with `preview_start {name:'wave1'}`. The differential scripts live in my scratchpad, not in the repo.

## For other owners

- **3D (knit-3d / diagram)**: Tunisian `expand` records carry `t:'tss'|'tks'|'tps'|'tfs'|'tes'|'ttw'|
  'tdc'|'thdc'` (h 0.9; tdc 1.8, thdc 1.3; w 1) — until the renderer gives them relief they will draw as
  whatever unknown types fall back to (sc). A Tunisian row is one forward pass; there is no separate
  return-pass row. The first record of a row whose first bar is skipped is `edge: true`.
- **Store / counter**: `dialectHints().craft` can now be `'tunisian'` (and `.tunisian === true`) for a
  crochet project; `lines.meta.tunisian`; `Line.returnPass` notes sit right after their row — a
  two-pass counter mode can key on them. `Patterns.version` changed (line cache refreshes once).
  `Line.approxRows` marks a length stretch the gauge turned into ≈ rows (rows after it are numbered on);
  show it with "≈". Parts may now start with a "Numbers: …" line (like "Sizes:"). A knitting part's
  gauge and needle lines are `section.gaugeLines` (not in the text): the import preview's gauge chip
  for a book pattern reads the joined part texts, which still hold it (each pattern's first part ends
  with its gauge line); `gaugeLines` is there for a reader that wants it without parsing
  (`Store.splitSections` copies named fields only, so it would pass `gaugeLines` through first).
- **pdftext**: see the tooling note; the research list (three-column interleave on socks p15/p20 and
  lace p31, overlay duplicates, the advert inside T15) still stands.
- **3D (diagram.test "Load reference fixtures", 282 / 1)**: the Bernat yoke section is found again
  (Sizes / Start, then "1st rnd: Knit."), reads 33 rounds 76, 84, 84, 92 … 204 and then the divide to
  120 — what the research says. The row still fails only on `grows` (last ring > 1.8 × ring 1): the last
  ring IS that divide round (19.1 vs 12.97), and `knitYoke` does not take it as a divide because the
  body rounds after it are their own part. Either the check measures the widest ring before the divide
  or the yoke reading accepts a divide as the part's last round — a geometry/test call, not the parser.
