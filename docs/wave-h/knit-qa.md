# Wave H — `knit-qa` (integration pass)

Owner of `js/app.js`, `js/store.js`, `js/app-knitting.js`, `css/app.css`, `js/tour.js`,
`test/knit-counter.test.html`, `test/store-safety.test.html`, `test/templates.test.html`,
`test/crafts.test.html` for this pass. `js/patterns.js`, `js/knits.js`, `js/pdftext.js` and the diagram
files were read, never edited. Nothing committed, nothing downloaded, nothing copied out of `tmp-pdf/`
(the PDFs were fetched from the dev server into a `File` in the page and dropped on the real drop
zone's input).

## How it was walked

Own tab of the pane, real app (`index.html`), private keys `ZWH_knitqa.v1` (+ `…_restore.v1`,
`…_restore2.v1` for the backup round trip) via `Store.__setKeyForTests`, all removed afterwards with
their BlobStore chart pages. 375×812 for the walk, 375×640 for the layout pass. Each fixture as a
knitter: New project → 🧣 Knitting → drop the PDF → size chips → (pattern tabs) → Save → counter;
targets/counts read per row with `Store.targetFor` / `lineForRow` against `docs/research/knitting.md`.
The tab had to be fronted for the chart scan: `handle.renderPage` waits on `requestAnimationFrame`,
which a background tab does not run (a real phone in the foreground is fine; noted, not a defect).

## Store items the parser worker asked for — done

- `partLines` passes `opts.sizes` (the project's size names) and `opts.sizeCount` to a counter
  craft's `parse`; a part whose own text names its sizes (every Knits part carries `Sizes: …`) is read
  at ITS sizes — an ebook project's sizes are one pattern's, and a six-size sock read with a three-size
  count resolved every list to no count.
- The line cache is keyed on the parser's `version` (`entry.apiVersion`), and on the size count the
  caller ASKED for (`sizeCountAsked`), so a probe whose own sizes win is still a cache hit.
- `Line.rowList` was already honoured by `buildRowIndex`; `countAtRow` now reads a line's per-row
  `counts` from its `countsFrom` when it has one (`Patterns.targetFor`'s repeat path already did).
- Unnamed knitting sections are named from the dominant garment noun in their own text
  (`neck` → Neck, `raglan`/`yoke` → Yoke, Neckband, Collar, Hood, Button Band, Pocket, Sleeve, Cuff,
  Body, Heel, Gusset, Foot, Toe, Leg, Brim, Crown, Border, Edging), else "Part N" (N = place in its
  own pattern). Not counted: "measures … from front neck", "Divide for Sleeves and Body" lines,
  abbreviation lines (`X = …`), the carried `Sizes:` line, a stitch's "leading leg". The winner must
  lead outright and must not already name another section of the pattern (singular/plural alike).
  Bernat now imports as **Neck, Part 2, Body, Sleeves, Neckband** (was "Part 2, Part 3, …" — the
  fallback counted the template's placeholder part).

## Defects

Sev: H = a wrong number/side/shape on screen, M = wrong behaviour or wording a knitter meets, L = minor.
"→ parser" / "→ pdftext" = forwarded (below), not fixed here.

| # | Where seen | Defect | Sev | Status | Assertion / file |
|---|---|---|---|---|---|
| 1 | Bernat import | Unnamed sections became "Part 2", "Part 3" (fallback counted the placeholder "Main") | M | fixed: garment-noun naming in `Store.splitSections` (knitting) | knit-counter §14 ×8 |
| 2 | Bernat XL yoke | Target 5 rounds (numbering restarts in the "Sizes XL … only" block) | H | fixed: a knitting section whose numbering restarts gets no target | §14 "numbering that starts again" |
| 3 | Bernat sleeves | Target 55 although "until it measures 2½"" and 2" of rib remain | H | fixed: a knitting section with a length `until` gets no target | §14 "until it measures 2"" |
| 4 | Rico pattern section | Target 9 for "cont until half the yarn has been used" | H | fixed: a non-row "until …" line the reader did not turn into rows → no target | §14 "half the yarn" |
| 5 | Sock book | Size chips = the book's first pattern's (7", 8½", 9½") for every pattern | H | fixed: chips follow the first ticked pattern; project sizes = imported pattern's | §14 + §15 chips |
| 6 | Sock book | All 8 patterns ticked by default → ~40 parts in one project | M | fixed: only the first pattern ticked (knitting); others "· skipped" | §15 |
| 7 | Sock/lace book | Groups worded as sizes ("Import this size", "Sizes in this pattern", "Remove this size", "Speed Bump Socks size") | M | fixed: "Patterns in this book", "Import this pattern", tab = pattern name, "Remove this pattern", "Make this pattern a template", done sheet "… done!" | §15 ×6 (crochet keeps "size": §15) |
| 8 | Sock book, six-size pattern in a three-size project | Every size list resolved to no count (sizeCount of the wrong pattern) | H | fixed: own sizes win in `partLines` and `targetRowsFromText` | §14 "a probe at size 2 … reads 64" |
| 9 | Sock book | Gauge of the book's FIRST pattern written into any pattern's project | H | fixed: a book import reads gauge only from the imported pattern's text (none → empty, honest) | §14 "no gauge from ANOTHER pattern" |
| 10 | Time Traveler / Tailored Scallops | Two sections of one name ("Foot", "Shape Collar") → the second overwrote the first | H | fixed (knitting): parts made by this import are never re-matched; second is "Foot 2"; import key skips the carried `Sizes:`/`Start with` lines and uses 3 lines | §14 ×3 (crochet unchanged) |
| 11 | Import preview | Gauge read by the import was invisible | M | fixed: chip "Gauge 12 sts × 17 rows = 4 in · 6 mm (US 10)" (`Store.gaugeFromText`) | §14 + §15 |
| 12 | Lace book (Sophia import) | All 14 charts of the book kept with a one-pattern project | M | fixed: a book import keeps the charts its own text names ("Chart B"/"B chart", multi-word names, one-word names only next to "chart") | §15 ×6 |
| 13 | Icelandic border | "See Chart E for Rows 3-15": row 1 showed "Chart E row 3", row 3 "row 3", row 4 nothing | H | fixed: "for Rows X-Y" maps the pattern's own row numbers and survives written rows inside it | §11 ×2 |
| 14 | Bernat body/sleeves | "for a further 2"" / "until ribbing measures 2"" counted from the cast-on ("≈ row 9" for rib starting at round 2) | H | fixed: measured from where the stretch began ("≈ row 10") | §14 |
| 15 | Socks template, 3D | Heel flap rows 59–88 had no side → drawn as full rounds; the sock was a straight tube, not an L | H | fixed: flat rows inside a round piece take parity side in the model (`patternSideAt`) | §14 |
| 16 | Any sock with a flat heel (hand-typed / imported as one part) | `Knits.workMode` says rows → whole sock modelled flat, leg rows read ROW | H | fixed: a knitting piece begun in the round is 'rounds'; `workedIn:'rows'` lines still read ROW | §14 ×2 |
| 17 | 3D viewer label | Knitted yoke/neckband called "Flat circle" (crochet's closed-centre shape) | L | fixed: "Raglan yoke" / "Sock" / "Cone" / "Band"; crochet unchanged | §15 ×4 |
| 18 | Done sheet | "Hat is off the hook" for knitting | L | fixed: "off the needles" (group sheet too) | §15 |
| 19 | Add part / template editor | Hints "Wings ×2, legs ×4", placeholder "Wing" for knitting | L | fixed: "Sleeves ×2, socks ×2", "Sleeve" | — (copy only) |
| 20 | ⋯ menu | Glossary gated on `Knits.glossary` although `Store.glossary` has a table | L | fixed (`app-knitting.js`) | — (visible on Socks: 📖 Glossary) |
| 21 | Marker chips | aria said "hold to remove" only; Delete key works but was not announced | L | fixed: "hold (or press Delete) to remove" | §15 |
| 22 | store-safety | "import reads sizes" asserted exactly one `detectSizes` call (partLines now asks too) | — | test made `>= 1`, intent kept | store-safety 307 |
| 23 | Bernat XL/2-3XL yoke | Divide "Next rnd" numbered round 5 / 15 (numbering restarts in the XL block): 156 / 176 shown mid-yoke; deviation hint lands there | H | → parser | — |
| 24 | Bernat 2/3XL sleeves | Rib rounds alternate 30 / no count from round 57 | M | → parser | — |
| 25 | Bernat body/sleeves | Rows after a length stretch are numbered from 1 (the rib is "round 1" while 51 plain rounds come first) | H | → parser (design: the counter cannot number a length stretch) | — |
| 26 | Speed Bump toe | "Rep … 7 (8,10) more times, then work Rnd 1 once more": 18 rounds not 19, round 18 shows 24 (is 28), false deviation 20 vs 24 | H | → parser | — |
| 27 | Speed Bump turn heel | Printed "18 (20, 22) heel sts rem" never lands on the last short row (rows 3–12 all no count) | M | → parser | — |
| 28 | Magic-loop socks | No size names ("Size 1/2/3" not 36/40/48); heel row 6 shows **2** sts at 48; flap/gusset rows no count | H | → parser | — |
| 29 | Icelandic shawl body | Rows 35 (334, is 294), 40–41 (284, is 286), 49–51 (276/274/276, are 278/276/276) | H | → parser | — |
| 30 | Icelandic | Border rows 15–31 live in the "Shawl" section; group named "Carol Rasmussen Noble" | M | → parser | — |
| 31 | Henley | Stitch-guide "Division Pattern" imported as a part; "Back And Sleeve Lace" (a chart name) as a part with **83 on every row 1–140**; neckband counts continue past row 17 (91, 95 …) | H | → parser | — |
| 32 | Sock book | Designer names as parts ("Chrissy Gardiner", "Mary Jane Mucklestone", "Anne Berk", "Kari Anderson"), stitch-guide parts ("Yarnover Backward", "Cable", Genome's "DNA Cable" as "Genome Socks" with target 12) | M | → parser | — |
| 33 | Border Socks | "Needle 1: …" read as a yarn colour "Needle" (Yarn colours sheet) | M | → parser (`colors`) | — |
| 34 | Speed Bump | Cuff, Leg and Foot are not sections (Heel first) | M | → parser | — |
| 35 | Lace book | Lace Fountain Hat and Arrowhead missing as groups; "Glossary" is a group | M | → parser | — |
| 36 | Book patterns | Each pattern's gauge/needle lines are not carried into its parts (so a book import has no gauge) | M | → parser | — |
| 37 | diagram-model | "Stylecraft hood Motif: Part.dialect is uk" fails: the section ALONE now reads `uk` in `Patterns.dialectHints`, so nothing is lent (529 at the start of this pass; no store/app path involved) | M | → parser (`patterns.js` in flight) | diagram-model 528/1 |
| 38 | knits.test | 3 failures in the parser's own suite while it is being edited (short row 48, "K1 (2)", "purl 2 together") | — | → parser (in flight) | knits 273/3 |

Checked and right (no defect): Bernat neck rows 1–8 at XS/S, M, XL (36/44/52/60/76 …), RS/WS chip
(stated / parity), 8 markers at the research positions (XS/S 1,3,7,9,27,29,33,35; XL …31,33,37,39) with
"1|2|4|2|18|2|4|2|1", the honest "Markers set on a 36-st row · this row makes 44" on increase rows; yoke
XS/S and M (84 … 204 → 120 divide; M 216 → 128); sleeves XS/S 44 → 28; neckband 7 × 68; Speed Bump
M flap 36 rows on 32, gussets 88 → 64; Time Traveler targets (toe 21, gusset 12, 16 short rows, flap 18);
Rico rows 1–16 (6 → 13), TENSION 20 × 33 / 10 cm, 3.5 mm; all six templates' targets and per-row
counts; Socks template heel reads **ROW** (rows 57–103) between ROUND legs (coordinator's re-check:
yes, `rowWorkMode` reads `workedIn`) and "Round 56 done. Next: right side"; short-row strip "Short row
2 of 14 · rows 89–102", + = "Short row done (turn)"; two at a time ("Sock 1 | +2", one + moves both,
"⇄ Sock 2 · Rnd 3", three Undos back to one Sock ×2); until chip "8.5 in ≈ 36 rows" through the gauge;
chart chip "Chart B · row 14 of 36" on the Icelandic body; Remove this pattern + Undo; Make this pattern
a template (7 parts, craft knitting, sizes kept); finish flow (All parts done → finished); backup
round trip: `.thready` 8.9 MB, 24 images, chart cells and page images back after deleting the blobs;
crochet Sheep project: no knitting widget, crochet ⋯ menu (no Glossary), "size" wording; no horizontal
scroll at 375×640.

## For knits-parser (`js/knits.js`, `js/patterns.js`)

1. Numbering restarts inside a section ("Sizes XL … only: 1st rnd") collide with the rows before them:
   the divide becomes round 5 (XL) / 15 (2/3XL) and shows 156/176 mid-yoke. Number the size block after
   the rows it follows (or start a new section), and put the deviation on the divide's real round.
2. Rows after a length stretch ("Knit even until … 12"", then "Next rnd") are numbered 1 — the counter's
   round 1 is then the rib. Either give the length stretch a row span the counter can skip, or start the
   numbered rows after it in a part of their own.
3. Speed Bump toe: "then work Rnd 1 once more" adds a round (19 not 18) and moves the printed 20 to it;
   today round 18 shows 24 and a false deviation (printed 20, computed 24).
4. A repeat's printed total ("—18 (20, 22) heel sts rem") belongs on its last row even when the gap rows
   have no count.
5. Magic-loop: size names from "36 (40, 48) Stitch Adult Socks"; the heel row 6 count of **2** at 48
   (should be 18); flap rows (24) and gusset rows have no count.
6. Icelandic body: rows 35, 40–41, 49–51 have wrong counts (table #29); border rows 15–31 belong in
   Lace Border; the group is "Icelandic Lace Shawl", not "Carol Rasmussen Noble".
7. Henley: the "Division Pattern" stitch guide and chart titles are not parts; "Back And Sleeve Lace"
   answers 83 for rows 1–140 (an `until` stretch must not publish a count for every row); the neckband
   section continues past Row 17 with invented counts.
8. Sock book: designer names and stitch guides as parts (#32); Speed Bump's Cuff/Leg/Foot sections; the
   lace book's Hat/Arrowhead groups and the "Glossary" group.
9. `colors()`: "Needle 1:" / "Needle 2:" prefixes are not yarn colours.
10. Carry each pattern's gauge and needle lines into its parts (like `Sizes:`), so a book import can fill
    the gauge card from the pattern imported (the store reads it from the imported sections now).
11. `workMode` of a piece begun in the round with a flat heel says 'rows'; the store now overrides it from
    the first row's `workedIn`, but the parser's own answer should be 'rounds'.
12. `Patterns.dialectHints` on the Stylecraft hood Motif section alone now reads `uk` (diagram-model
    fails 1). Probably the in-flight patterns.js change.

## For pdftext (`js/pdftext.js`)

No new extractor defect found in this pass beyond the research list (three-column interleave on socks
p15/p20 and lace p31; overlay duplicates on socks p4/p8–9; the advert inside Time Traveler's heel row).
Those still surface as garbled placing notes in the Time Traveler preview ("Row 6 Work to last st, sl 1
pwise, rethree slipped stitches …").

## Contract changes / new API

- `Store.gaugeFromText(text, craft)` → `{sts, rows, over, unit, needle}` | null (never writes).
- `Store.targetRowsFromText`, knitting only: no target with a length `until`, a non-row "until …" line,
  or a row number covered twice.
- `Store.splitSections(text, 'knitting')` names unnamed sections (see above).
- `Store.importPatternSections`, knitting only: same-import parts are never re-matched (`Foot 2`); a
  book (grouped) import takes sizes and gauge from the first imported pattern's sections.
- `App.__knitQa` (QA only): `gaugeChipText`, `chartMentioned`, `groupNoun`, `groupLabel`, `shapeName`.
- Import picker, knitting: groups are patterns (first ticked by default, sizes follow the first ticked).

## Suites

knit-counter **295 / 0** (229 → +66: §11 ×2, §14 Store ×34, §15 app in an iframe ×30), store-safety
**307 / 0**, templates **147 / 0**, crafts **124 / 0**, backup **205 / 0**, diagram-model **528 / 1**
(#37, parser; the "< 60 ms" timing read 61.3 ms once and passed on the re-run), sw 29, patterns 1037,
diagram 241, blobstore 65, knit-chart 151. knits 273 / 3 (parser's in-flight suite, #38).

## Screenshots

In `C:\Users\mitch\.claude\projects\C--Users-mitch-CrochetBs\b5d3849d-2162-4d23-b955-3af4c3ef202d\tool-results\`:

- `mcp-Claude_Browser-blob-1792711324540-6g17ev.jpg`: New project → Knitting → Bernat dropped (375×812, before the fixes).
- `mcp-Claude_Browser-blob-1792711417021-izswi1.jpg`: Bernat XL Neck row 1, with the RS chip, the 8 markers and "1|2|4|2|22|2|4|2|1".
- `mcp-Claude_Browser-blob-1792712098165-n0jb8r.jpg`: Neck done (8/8).
- `mcp-Claude_Browser-blob-1792712108682-44zabt.jpg`: the yoke cone in the 3D viewer.
- `mcp-Claude_Browser-blob-1792712281193-yzcx6z.jpg`: Socks template 3D **before** fix 15 (a straight tube).
- `mcp-Claude_Browser-blob-1792712347089-rwdvdm.jpg`: the same sock **after** fix 15 (the L).
- `mcp-Claude_Browser-blob-1792713348658-8l148b.jpg`: Bernat counter at 375×640.
- `mcp-Claude_Browser-blob-1792713357147-ac0sih.jpg`: Socks heel short rows at 375×640.
- `mcp-Claude_Browser-blob-1792713394571-swdr79.jpg`: import preview at 375×640, with the gauge chip, size chips and "Neck".

## Left

- Markers do not move through increase rows (the "Markers set on a 36-st row" message stands in for
  them). An m1 that sits right at a marker could belong on either side of it, and `expand` drops `sm`.
- The checklist suggestions in a book preview come from the whole book, not just the ticked pattern.
- After a pattern is removed, the project keeps the sizes of the pattern it was imported with.
- I did not drive a cable sock's "cable in N" ring on a fixture: no fixture parses one (Genome's panel is
  a stitch guide, #32). knit-counter covers it with synthetic lines.
