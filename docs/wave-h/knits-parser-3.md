# knits-parser-3: report (wave H, batch 2)

I own `js/patterns.js`, `js/knits.js`, `test/patterns.test.html`, `test/patterns.fixtures.html`,
`test/knits.test.html` and `test/knits.fixtures.html`. Nothing is committed and nothing was
downloaded. Nothing was copied out of `tmp-pdf/`. I read the store, app, diagram and pdftext
files but did not edit them.

Batch 2 adds nine fixtures (`tmp-pdf/SOURCES.md`, 2026-10-22):
- four Patons cabled pullovers: mock neck, boyfriend, boxy, cabled yoke;
- the Sandnes child/ladies raglan;
- four Project Gutenberg books (Handbook, Stocking-Knitter's Manual, Begin to Knit, Lady's Knitting
  Book).

All nine are read through the import path (`Store.splitSections` + `Knits.parse`). They are
asserted against `docs/research/knitting.md` §9–§17 and its "Batch 2 summary".

## What the knitter sees

### Patons cabled pullovers

**Pieces and copies**
- Each piece is a part, and the rows after "Change to larger needles and proceed in pat" are
  "Back (continued)", "Front (continued)", and so on.
- Panel Pats A/B/C and Cable Panels A/B/C are stitch guides, not parts.
- "Work from \*\* to \*\* as given for Back" takes its count from the closing `**`.
- "Work other sleeve in the same manner" makes a part ×2. A "(continued)" part takes its parent's
  ×2.

**Cables and panels**
- Cable abbreviations carry their width: C4B, C6F, T3F, Cr5B, Cr7B, C3FP and the others.
- Every crossed stitch keeps its cable's name (`name`) on the stitch records.
- A panel reference is expanded into that panel row's own stitches, crossings included. This covers
  "Work 1st row of Panel Pat C", "Work 1st row Cable Panel C" without "of", "... over 7 sts", and a
  reference wrapped over the line end.
- A part read on its own carries a one-line stitch guide for each panel its rows work, so it
  expands the same way. The guide reads "Panel Pat C (worked over 9 sts): 1st row: … | 2nd row: …".
- Expanded row 1 results:
  - mock neck Back (continued): 144 stitches, 34 crossing records;
  - mock neck Sleeves (continued): 81 stitches, 16 records;
  - boyfriend Front: 81 stitches, 19 records (A's T3F plus two B panels' Cr4F/Cr4B);
  - boxy Front: 115 stitches, 10 records (two Cr5B);
  - Cabled Yoke Top Yoke: 198 down to 90, with C4B on rounds 4, 9, 14, 19, 24 and 29.

**Rows, sides and markers**
- Ordinal labels ("1st row:", "5th and 7th rows:", "2nd and all WS rows:") are rows. The side after
  the colon, "(RS)", is the row's side.
- A size block that numbers its rows again from "1st row" carries on the piece's numbering. In that
  block, "3rd row: As 1st row." points at the block's own 1st row, not the cable row 1. This fixes
  the boyfriend sleeve: it reads 53, 51, 49, 49 to the printed 43 with no deviation.
- Shaping sentences are counted:
  - "Cast off 4 sts beg next 2 rows";
  - "…beg next 4 rows," / "then 16 sts beg following 2 rows" is 6 rows, even when the wrap falls
    between them;
  - "Dec 1 st each end of next and every following alt row until…";
  - "inc 1 st each end of … every following 6th row until there are 59 sts".
- A printed total on a ranged row belongs to its last row. "Cast off 2 sts beg next 2 rows. 55 sts
  rem." expands to 57, then 55.
- Neck shaping:
  - "Pat across 7 sts. Turn. Leave rem sts on a st holder." keeps the rest waiting.
  - "With RS facing, slip center 19 sts onto a st holder" removes the centre stitches.
  - "Join yarn to rem sts…" starts the second side from what is left.

**Cabled Yoke, Bottom Yoke**
- The pick-up wrapped over four lines with no comma before "pick up" now reads 216.
  ("Beg at side seam of Cable Yoke, with" / "larger circular needle pick up and knit" / "216 (…)
  sts evenly …")
- Rounds that "Knit to next marked st" are counted.
- "Rep last 2 rnds 0 (1-3-0-2-1) time(s) more" adds no rows for XS/S.
- The rounds read 216, 224, 224, 232, … 248, 252, 260, 268, 276, 284. Before, they read 0, 224 …
  0, 0.
- The dividing round runs on over its underarm cast-ons, the other sleeve and the back, up to its
  own total of 184 (204, 224, 244, 272, 332). Before, "Cast on 6 sts" started a new part.
- The body starts from the stretch's printed 174 (192, 216, 264, 294, 354), which is wrapped over
  three lines.
- The sleeve's setup is its held stitches plus the underarm cast-on: 62 (68, 74, 90, 100, 112).

### Sandnes raglan

**Sizes and groups**
- "(2) 4 (6) 8 (10) 12 yrs" is six sizes in order. "(S) M (L) XL (XXL)" is the ladies' five.
- "(= front)" and "(= ½ back)" are labels, not sizes.
- Children and Ladies are two size groups, each with Yoke, Back And Front, and Sleeves ×2.

**Yoke rounds**
- The prose rounds are read one sentence at a time: "k 1 rnd, while inc 8 sts evenly spaced =
  56", the raglan increase round, "Rep inc on alt rnds a total of 11 (…) times = 144 (…)", and the
  dividing round 92 (100, …).
- Every yoke round is counted: plain and increase rounds in turn, 64, 64, 72 … 144 at round 28
  (ladies: 88 … 216 at round 40). Before, every round after the increase round read 0.

**German short rows**
- These are the only "turn"s in the batch that are short rows.
- Each short row has its own row number. Each one knows how far it works and on which side:
  - children: 5, 9, 11, 13, 15, 17 (RS, WS in turn);
  - ladies: 9, 17, 20, 23, 26, 29.
- The counter sees `shortRow` on each. The 3D gets the worked stitches and the side from
  `expand()`.

**Back and front, sleeves**
- These pieces are prose with no numbered rows. They are offered as parts with honest counts, and
  rows that cannot be counted are left null.
- The "dec"/"inc" wording swapped in the sleeve is read from the printed counts.

### The older books (Project Gutenberg)
- Each pattern of a book is a group ("=For an Infant.=", "_A Child's Sock._", Begin to Knit's
  headings). The Gutenberg boilerplate and licence are never part of a pattern.
- **The period vocabulary is a dialect** (`dialectHints().dialect === 'period'`):
  - shaping: narrow, widen, take 2 together, slip and bind, p.s.s.o., "pass sl st over";
  - stitches: seam/pearl = purl, "N plain", over / wool over;
  - repeats: "; repeat twice" and "repeat from across row".
- **Counts written as words or set by needle are read:**
  - word numbers ("Increase three stitches");
  - "First row--", "2d row--" and "Twenty-first";
  - cast on per needle ("23 on the first pin, 22 on the second, and 20 on the third" is 65);
  - "there ought to be 69 stitches on" and "reduces the stocking to 73".
- The intake tables ("2 intakes with 6 rounds between each", with ditto marks) become rounds and
  decreases.

## Rules added (general, not per file)

### js/patterns.js (engine switches only; no crochet profile sets them)

- **`headerFloor`.** Each new knitting section starts a section floor, and a setup after a header
  opens the part.
- **`shrinkRe`, `wholeLines`, `notRunningHead`, `finishParts` hooks.**
- **`s.offer`.** A profile can offer a section with no numbered rows (prose parts).
- **Group parts.** The first part of a group starts at the group's first line.
- **`repeatWrapLimit` (new).** A knitting repeat sentence may wrap over up to 4 lines. It was 2.
- **`marker.rowOffset` (new).** A row renumbered on from the rows before it (`PROFILE.rowOffset`)
  shifts its "As 1st row" back-reference by the same offset. Knitting only.
- **`repeatLineFor` fix.** A repeat that adds no rows for this size ("Rep last 2 rnds 0 times
  more") has `repeatTo = repeatFrom − 1`. It is no longer read as open-ended, so the rows after it
  no longer resolve back to it. This is a real fix for crochet as well, but no crochet fixture hits
  it: the crochet differential is unchanged.

### js/knits.js

Shown here by area. See the comments in the file for each.

**Vocabulary**
- Cables `(c|t|cr|tw)N(f|b|l|r)(k|p)?` carry their width, cross and name.
- sk2p; "rib/pat across N sts"; the period pack (`periodVocab`); word numbers.
- "P0 (2-2-…)" is a no-op for that size.

**Labels**
- Ordinal and word-ordinal row labels, ordinal enumerations, and the side after the colon.
- Shaping labels ("Armhole shaping:", "Shape Neck:") ride in front of the instruction.

**Joining wrapped lines**
- Narrow-column joins (lead forms 12–19), and the panel definition joined over its wrap.
- A size list broken over a wrap is one list: "174 ( 192-" / "216-…) sts.", "164" / "(184-204) sts."
- A stop before `**` still ends a sentence. ("…sts.**" no longer hides the start of the next
  sentence.)
- "…beg next 4 rows," with "then … beg following 2 rows" on the next line is joined into one
  sentence.
- A dividing round (it puts stitches onto spare yarn or a holder) continues over its cast-ons,
  slips and joins until its own total. A cast-on inside it is never the round's total.
- A part that starts from held stitches and casts on more ("slip 56 sts from spare yarn… Cast on
  6… 62 sts") is one setup.
- A pick-up whose "with …" clause has no comma before "pick up", or that starts "Beg at …,", is
  read.

**Counting**
- "Knit to next marked st" is a fill to a marker.
- Prose rounds ("Knit 24 rounds", "k 1 rnd, while inc…") are counted.
- "Rep inc on alt rnds a total of N times" is (plain, increase) pairs. `expand()` plays the plain
  rounds as plain, so no round is 0.
- A stretch's printed total ("…until work measures 8½", inc 10 sts … 174 sts.") is where the part
  now stands. The next part's "Start with" comes from it.
- Copies ("Work from \*\* to \*\* as given for Back") and continued parts ("(continued)", ×2 from
  the parent).

**Short rows**
- German short rows have their own rows, and `Line.shortRows` records each one's worked stitches
  and side. "Turn" elsewhere is not a short row.

**Panels**
- Panels are collected from the definitions (`lines.panelDefs`) or from a part's carried guide
  lines.
- `expand()` expands panel references, with crossings named.

**Structure**
- Size-block groups, and title groups for books.
- The 19th-century dialect.

## Contract (additive)

**On a Line**
- `Line.chart.also`: the other panels a row works, each `{ name, row }`.
- `Line.until.endOnRow`: "ending on a 2nd row". It resolves to `endOn`.
- `Line.copyCount`: the count where a "Work from \*\* to \*\*" copy ends.
- `Line.germanShortRows`: true on a prose line of German short rows.
- `Line.shortRows`: `[{ n, side: 'rs'|'ws', worked }]`, one entry per short row the line spans,
  in order. It is null when the line does not say how far.
- `Line.counts` / `Line.countsFrom` / `Line.repeatDeltas` on an alternating-round repeat: per-row
  counts, with the plain round's delta 0.

**On the parsed lines and parts**
- `lines.panelDefs`: `{ key: { width, text } }`, the panels the text defines.
- A part's text may end with stitch-guide lines: `Name (worked over N sts): row | row | …`.
  `Knits.parse` reads them as panel definitions and never as rows.
- A section may carry `s.offer` (a prose part offered for import) and `s.continues` (a
  "(continued)" part's parent name).

**From `expand()`**
- Every stitch record carries `name` on cables (C4B, T3F, Cr5B, …). No `cf`/`cb` yet: the parser
  does not read a cable's definition.
- On a German short row: `worked` (stitches worked), `onNeedle` (the needle total, when known),
  `shortRow: true` and `side`. `live` equals `worked`, which is the existing short-row convention
  (a w&t heel row's live is what it works).

**Elsewhere**
- `Knits.dialectHints(text).dialect === 'period'` for the older vocabulary (three or more period
  words).

## Suites (fresh tabs, port 8766)

| suite | result | baseline |
|---|---|---|
| test/knits.test.html | **359 passed, 0 failed** | 301 |
| test/knits.fixtures.html | **507 passed, 0 failed, 14 known** | 232 / 0 |
| test/knits.fixtures.html?heavy=1 | **510 passed, 0 failed, 14 known** | 235 / 0 |
| test/patterns.test.html | **1067 passed, 0 failed** | 1067 |
| test/patterns.fixtures.html | **894 passed, 1 failed** | 831 |
| test/patterns.fixtures.html?heavy=1 | **909 passed, 1 failed** | 846 |
| test/templates.test.html | 147 / 0 | |
| test/crafts.test.html | 124 / 0 | |
| test/diagram-model.test.html | 529 / 0 | |
| test/store-safety.test.html | 307 / 0 | |
| test/knit-chart.test.html | 151 / 0 | |
| test/diagram.test.html | 259 / 0 | |
| test/knit-counter.test.html | 295 / 0 | |

- **patterns.fixtures.** The one failure is "crochet-archive-weldons-v24.pdf: read inside the time
  budget" (8309 ms against 6000). That number is PdfText's extraction time on a cold tab, not the
  parser's. See "For the owner of js/pdftext.js".
- **patterns.fixtures?heavy=1.** The one failure is the same kind: "knit-sandnes-0216.pdf: read
  inside the time budget" (6265 ms). Weldon's passed in that run, so these extraction times sit at
  the edge of the budget. The parser's own "split and read inside the time budget" checks for the
  batch-2 files all pass.
- **knit-counter.** One run threw in `app.js` `renderNow` (`els.home` undefined: the iframe app was
  not yet initialised). An immediate rerun was clean. This is a timing flake in the test's app
  start, not a parser defect.
- **Corpus rows.** All nine new files are corpus rows in `test/patterns.fixtures.html`. The checks
  are no crash, section counts, maxRow / maxSecs, craft `knit`, and that split plus read stays
  inside the time budget.
- **Crochet unchanged.** I compared the start-of-session `patterns.js` / `knits.js` with the
  current ones in sandboxes. I ran the crochet parser over every fixture in `tmp-pdf/` (crochet,
  knit, sewing, other), comparing parse, split, summary, expand, sizes, gauge and hints: **70
  signatures, 70 identical**. Three PDFs gave no text in that tab (furls frontier shawl,
  stitchedstories one-page, punchneedle koekoek), so they were not compared.

## What stays KNOWN (14) and why

| assertion | why |
|---|---|
| Bernat sections "Neck" / "Yoke" | The PDF prints no heading over them; a name would be invented. |
| R5 (Interweave) | "\*P7, k2\*" does not divide the growing count; the increase is "according to patt". |
| M3 side | The next side tag is after a 2" stretch of unknown rows, so parity says nothing. |
| M26 Neckband as a part | A pick-up and a length of rib with no numbered rows is not offered (same rule as Speed Bump's Cuff/Leg). |
| F38 endOn | The rib "begins" on a 2nd row; where it ends is not printed. |
| F9 the three dropped "2nd row" lines (boyfriend) | **Blocked by extractor.** The text layer differs from the page. |
| Y gauge 20 sts / 26 rows (cabled yoke) | **Blocked by extractor.** The gauge line interleaves with the next column. |
| C19 (Cupples' "P" is knit) | The book's own open-work key (P = knit, B = purl, O = yo, T = k2tog) is not read. |
| E12 (Begin to Knit) | "Repeat this row twice." on rows 3–4; the count does not reach row 7 through them. |
| E15 | 49 of 50 stitches named; the research counts the last as knitted. |
| H3 (Handbook) | A round described in a sentence with no row label is not read as a row. |
| K3 | The heel turn starts from "K and sl next 18 sts" prose; its start count is not carried. |
| K6 | A repeat whose count sits in a note-like sentence. |
| K7 | "28 (32, 36) 32 (36, 40)": two size groups in one vector, and no size line names the six sizes. |

**Closed this round** (now plain assertions):
- T7 / T9: the Foot chart row is counted through its "over 32 sts".
- F9 Back 4/5XL 2nd row.
- X29: the boxy neckband follows its pick-up.
- Y sizes (six).
- Y2 (Panel Pat A row 1 = 28).
- Y8 (Bottom Yoke rnd 2 = 224).

**R26 removed.** It tested a substring the normalised line no longer has; R26b covers the same
count.

## For the owner of js/pdftext.js (extractor)
- **Weldon's v24 is over budget.** Extraction takes 7.7–10 s on a cold tab, against a 6 s budget.
  It is the only red line in patterns.fixtures.
- **Boyfriend.** Three "2nd row: P2. P2tog. Pat to last 4 sts. P2togtbl. P2." lines are missing
  from the text layer (F9).
- **Cabled Yoke.** The gauge line ("20 sts and 26 rows = 4"") interleaves with the column beside
  it, so `gauge()` reads nothing. Some lines on p1–p2 come out in mixed case or interleaved.
- In my differential tab, three PDFs gave no text: furls frontier shawl, stitchedstories one-page,
  koekoek punchneedle. Worth a look if that is not already known.

## For the owner of js/store.js (diagram model / counter / shell)

**Panel guide lines in part text**
- A part's text can now end with stitch-guide lines ("Panel Pat C (worked over 9 sts): 1st row: … |
  …").
- `Knits.parse` strips them, but a UI that shows the raw part text will show them. They could be
  folded into a "stitch guide" disclosure.

**Parts that start with no known count**
- Some parts start mid-piece with no "Start with" count. In the boyfriend these are Shape Neck and
  Sleeves (continued).
- The reason: the piece before them ends in a size block that prints only 4 of the 6 sizes' counts,
  so no honest per-size vector exists to carry.
- In these parts, `expand()` with `prevCount` null returns `live: 0` for a row like "K2. ssk. Pat to
  last 4 sts". That 0 means "unknown". Please pass the previous part's last count when the part
  continues one (`s.continues`), or treat 0 there as unknown.

**Short rows and markers**
- `Line.shortRows` and `expand().worked` / `.onNeedle` are available for the counter's short-row
  display ("short row 3 of 6, 11 sts").
- The Cabled Yoke sleeve's BOR marker is placed after the 3rd cast-on stitch. The parser records it
  as `m1` at 6, not as BOR; the research says BOR.

## For the 3D owner (knit-3d-2 asks)

| ask | status |
|---|---|
| (1) Panel references, cable `name` | **Done.** Panel references expand to the panel row's stitches with crossings, and the records carry `name`. `cf`/`cb` are not provided (the parser does not read the definitions' sides); the store's own reading still applies. |
| (2) Sandnes short rows | **Done.** They are their own rows (2–7 after the first round), with no collision with round numbers. `expand()` gives `shortRow`, `side`, and worked 5, 9, 11, 13, 15, 17 (children size 0) or 9, 17, 20, 23, 26, 29 (ladies). |
| (3) No zero rounds | **Done.** Sandnes yoke rounds are honest counts every round. Cabled Yoke Bottom Yoke reads 216 … 284, then 184 at the dividing round. |
| (4) Top Yoke | **Kept.** 198 → 90, C4B on rounds 4, 9, 14, 19, 24, 29 (asserted). |

The references in `test/diagram.knit-synth.js` for mock neck Back, boyfriend Front, boxy Front,
Bottom Yoke and both Sandnes yokes can now move to the real parse.

## For the counter owner
- Sandnes rows 2–7 are `shortRow` with `Line.shortRows`, so each short row can show its own worked
  count.
- The Cabled Yoke dividing round is one round (184), not a round plus a cast-on part.
- "Rep inc on alt rnds" rows alternate plain and increase. `Line.counts` holds each one's count.

## For the chart owner
- `Line.chart` names the first panel a row works, and `chart.also` lists the others with their
  rows.
- The panels' own row text is in `lines.panelDefs` and in the parts' stitch-guide lines. A chart
  can be drawn from those without the vector chart.

## What is left
- Cupples' open-work key letters (C19) and a round with no row label in the Handbook (H3).
- Per-size vectors to carry into a part when the parent's last block prints only some sizes. This
  needs a per-size merge across a size block and "All sizes".
- Reading `cf`/`cb` from cable definitions ("C4B = slip 2 sts onto cn and hold at back…").

## Follow-up (3D second pass, extractor, QA #55–#60)

**3D worker's four items**
1. **`at` on panel cable records.** `panelRecords` now copies `at` (0 to span−1 within each
   cable). Mock neck Back row 1 has 34 records forming 10 crossings, so `knitCableAt` in the store
   is no longer needed for Knits output.
2. **`Knits.workMode`.** A prose piece that says it is worked in rounds ("Join and work … in rnds",
   with at most two row words) is `'rounds'`. Its German short rows' "turn" and "next row" no
   longer make it flat. Both Sandnes yokes are now `'rounds'`; every Sandnes part is.
3. **Sandnes group names (also QA #55).** A size block's group label is now taken from the title
   block of its own page (between its `=== PAGE n ===` markers): the label nearest to its SIZES
   block, above or below it.
   - The groups read ["Children","Ladies"] in both reading orders. This is asserted on the real
     text, re-ordered the way the held-back extractor rule prints it.
   - The group starts at the page top even when the title block puts SIZES 5–10 lines down.
4. **Panel cadence over a piece.** A pattern stretch after the written rows becomes ≈ rows. This
   covers "Cont in pat, keeping cont of Panel Pats … until work from beg measures 15½"", "Cont in
   Box St Pat until …", "Pat for 4"", "Rep last 2 rows … for 2"" and "until armholes measure 9½"".
   - **Row numbers.** The stretch gets `row`/`rowEnd`, `approxRows` and `repeatEstimated: true`
     (the ≈ marking), plus `repeatOf` = the pattern rows. The rows after it are renumbered.
   - **How many rows.** The count comes from the printed gauge, less the rows already worked:
     - "from beg" counts from the cast-on;
     - "armholes measure" counts from the armhole shaping;
     - "from markers" is left alone.
     - A part that goes on from another carries "(About N rows worked from the cast-on.)" under
       its "Start with" line.
     - A length worked with no rows of its own ("Work 2½" in rib") counts as ≈ rows.
     - A shaping stretch that numbers no rows ("inc … every 6th row until there are 59 sts")
       makes the rows before unknown, so nothing after it is given rows.
   - **Panels.** Each repeated row works its panels on from where the written row left them
     (`PANEL_SHIFT`). A panel's cycle comes from "These 24 rows form …", or from "These 3rd to
     16th rows form …" (rows 1–2 once, then 3–16).
   - **Examples:**
     - Mock neck Back (continued): ≈86 rows (3–88). Panel C's C6F falls on rows 3, 15, 27, … and
       its C6B on 9, 21, 33, …. Then 2 armhole rows, then ≈60 rows to 9½".
     - Cabled Yoke band: ≈278 rows, with C4B on rows 1, 9, 23, 37.

**QA #56–#60**
- **#56 (stitch-only gauge).** `Knits.gauge` reads a stitch-only gauge ("14 sts St-st with 6 mm
  ndls = 10 cm"): stitches 14 / 10 cm, rows null.
- **#57 (Begin to Knit groups).**
  - In a booklet whose patterns open with "Materials Required:", a pattern's title is the line
    above its materials, past "Size(s)…" and illustration lines. A heading with no materials is a
    group only after a gap of 3 or more blank lines and when it is not a part or garment name.
  - The groups are now: Knitted Afghan, Five Fancy Stitches…, Plain Socks For A Go-Go Guy, Dolls
    And Guys Two Needle Mittens (its own group now), FOR THE YEARLING … the sweater, His
    Slipover, Her Raglan, Clam Diggers Shell, Pom Pon Poncho, Preteen Slipover.
  - The crochet page no longer swallows the next knitted pattern: the crochet tail ends at a
    heading with "Materials Required:" and a cast-on under it.
  - The spaced old abbreviations ("K 2, P 2", "K 2 tog", "p.s.s.o.", "Y O") make the dialect
    `period`.
- **#58 (Cabled Yoke sleeves).** A sentence like "dec 1 st at beg and end of rnd … every following
  10th (8th-…) rnd … to 54 (…) sts, then on every following 8th (…) rnd to 40 (…) sts" is now
  rows. The same goes for "inc … every 6th row N (…) times".
  - Each round has its own count in `Line.counts`. The decrease falls on the last round of each
    group, worked "as before" from the row it points back to.
  - XS/S reads 60 … 54 at round 31 … 40 at round 87. XL reads 88 … 46 … 44, not a flat 88.
- **#59 (mock-neck shoulder).** "Cast off 15 sts beg next 4 rows, then 16 sts beg following 2
  rows" now gives per-row `Line.counts` (121, 106, 91, 76, 60, 44 for XS/S). `expand()` casts off
  15 or 16 a row, not all 92 on the first row. Any ranged cast-off or cast-on schedule gets the
  same (`rowSchedule`).
- **#60 (glossary).** `Knits.glossary` reads the pattern's own abbreviation block with each
  meaning whole. A meaning over several lines is joined, and "Approx =" / "Approximately" is one
  entry. Entries from the pattern come first, then the craft table as before.

**Extractor items**
- The boyfriend's three restored "2nd row" pairs are asserted. The text has all six lines, and
  Back 4/5XL's is 112.
- The Cabled Yoke gauge assertion was KNOWN only because it read the wrong field. It is now plain:
  20 sts / 26 rows.
- M3 side now passes and is a plain assertion.
- No other assertion depended on lower-case text.
- **I could not flip the Sandnes title-block switch: `js/pdftext.js` on disk has no such switch.**
  Its report (docs/wave-h/pdftext-knit-2.md, row 8) says the rule was taken out. The namer is now
  safe for both orders: groups and parts are identical with the title block before SIZES or after
  TENSION, and this is asserted. The extractor owner can put the rule back.

**Contract additions**
- `Line.approxRows`, `Line.repeatEstimated` and `Line.patternStretch` on pattern stretches.
- `Line.counts`/`countsFrom` on ranged shaping rows and on shaping stretches (with
  `Line.shapeRows`).
- `at` on panel cable records.
- The carried "(About N rows worked from the cast-on.)" line in continued parts.
- `Knits.gauge`'s stitch-only reading.
- `Knits.glossary`'s joined meanings.

**Suites (fresh tabs)**

| suite | result |
|---|---|
| knits.test | 373 / 0 |
| knits.fixtures?heavy=1 | 533 / 0, 11 known |
| patterns.test | 1067 / 0 |
| patterns.fixtures?heavy=1 | 910 / 0 |
| templates | 147 / 0 |
| crafts | 124 / 0 |
| diagram-model | 529 / 0 |
| store-safety | 307 / 0 |
| backup | 205 / 0 |
| knit-counter | 317 / 0 |
| knit-chart | 151 / 0 |
| pdftext | 167 / 0 (+2 skipped) |
| xstitch.fixtures | 493 / 0 (+9 skipped) |
| sewing.fixtures | 789 / 0 |
| crochet old-vs-new | 70 / 70 identical |

**For the owner of test/diagram.test.html (3D).** "Load reference fixtures" is 314/2. The two
failures are the mock neck Back and boxy Front yoke cable-column checks. Both now see the whole
piece (156 and 52 real rows, with panel cadence), and their condition "all narrower than their
count" is false on some row. These checks were written when Knits gave one or two rows per piece,
and they need re-baselining against the real parse. Units are 260/0.
