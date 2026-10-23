# knits-parser — report (wave H, contract §2)

Owner of `js/patterns.js` (engine), new `js/knits.js` (`window.Knits`), new `test/knits.test.html`,
new `test/knits.fixtures.html`. Nothing committed; no files downloaded; nothing copied out of `tmp-pdf/`.

## What the user gets

A knitting project reads its pattern with a knitting reader. Every crochet counter feature works off
the same `Line` records, so a knitting part shows: the row/round number, the stitch count (printed,
or worked out with ≈), RS/WS where the pattern says so, markers placed by the row (with their
stitch positions), short rows, the chart row a line refers to, "until it measures …" lengths, a
stated change ("8 sts inc'd"), and size-only lines dropped for the sizes they are not written for.
An ebook of several patterns (the sock and lace books) imports as one group per pattern, and every
part carries its pattern's size line and, when it continues from the part before it (Turn Heel after
Heel Flap), the stitches it starts with — so a part read on its own still counts.

## Engine factoring (`js/patterns.js`)

- `CROCHET` profile object at the top of the file: `vocab`, `zeroRes`, `mrRe1`, `mrRe2`,
  `mrOnlyRe`, `prefixRe`, `imperativeRe`, `partNounRe`, `placeNounRe`, `stitchH`, `slWidth`,
  `glossary`. `createParser(profile)` builds the whole reader over a profile (keys left out fall back
  to crochet's). `window.Patterns = createParser(CROCHET)`; `Patterns.createParser`,
  `Patterns.profile` exported. Body keeps its original indentation inside `createParser`.
- `VOCAB` entries may be functions of the match (`['c(\\d+)[fb]', m => +m[1], m => +m[1]]`); capture
  groups are made non-capturing inside the shared stitch alternation; regexes are compiled once.
- New on both instances: `glossary(text)`, `craft`, `version` (`'2.8/crochet'`, `'2.8/knitting-1'`).
- Profile hooks (all no-ops for crochet; each documented where it is read):
  replace-or-wrap `detectMarker`, `detectNextRow`, `detectSetup`, `findExplicit`, `sizeScope`,
  `detectSizes`, `evaluate`, `detectRepeat`, `refDelta`, `findGroups`; in-loop `parseOpts`,
  `classify`, `lineCount`, `afterLine`, `postParse`, `continues`, `hangs`, `setupFromNote`,
  `carryCount`, `carryIntoParts`; switches `rowHeights:false`, `wrapLimit`, `headerStartsPart`,
  `joinRepeatWraps`, `repeatsAddRows`, `groupStartsSection`; `init(E, api)` receives the engine's
  helpers (`E`).
- Engine-level, crochet-neutral additions: `Line.rowList` honoured by `inRange`, `refLineAt`,
  `summary().rows`, `countReport`; `targetFor` reads a repeat line's own per-row `counts`
  (`countsFrom`) when a profile set them.
- Crochet is unchanged: patterns 1037/1037, patterns.fixtures 829 (844 heavy), templates 147,
  crafts 124, diagram-model 529 — and a temporary differential page compared the old and new file on
  all 67 crochet/knit/other/sewing PDFs and txt fixtures (parse at two sizes, meta, summary, count
  report, splitSections, placement, sizes, gauge, colours, dialect, workMode, startHint, stuffing,
  expand row by row on the document and on every part): **0 mismatches**. The page was deleted.
- Performance: `Patterns.expand` on the Premier wrap and on the 1,500-row diagram-model pattern is
  the same old vs new (≈20–22 ms both); diagram-model's warm build reads 22.8 ms best (< 60). The
  57 ms the 3D worker saw is not in the parser.

## `window.Knits` API

Every `Patterns` key with the same arity: `parse`, `targetFor`, `lineFor`, `summary`,
`splitSections`, `placement`, `detectSizes`, `sizeMarks`, `sizeScope`, `countReport`,
`dialectHints`, `gauge`, `evaluate`, `colors`, `colorHex`, `expand(lines, row, prev, state)`,
`LOOP_CHAIN_W`, `startHint`, `workMode`, `stuffingHint`, `glossary`, `craft`, `version`. Extra:
`readInstruction(text, prev, opts)` → `{count, net, markers, shortRow, gap}`, `until(text, size)`,
`profile`. (The contract's `parseSections`/`looksLikeGlossary` do not exist on `Patterns` either;
`splitSections`/`glossary` are the real names.)

`Line` additions: `side` ('rs'|'ws'|null — only from a printed tag, or by parity strictly between
two tags that agree; null in the round), `delta`, `until {kind:'length'|'rows', value, unit,
endOn, relative?}`, `markers [{name, at}]` (BOR at 0; "pm for end of instep" named; else m1…),
`shortRow`, `chart {name, row[, rowEnd]}`, `cable {every, name}`, `rowList` (enumerated rows),
`counts`/`countsFrom` on repeat lines, `net` (what one working of the row does), `workedIn`
('rows'|'rounds' per row: a flat heel inside a sock in the round), `sizeSkip` (line written for
other sizes), `deviation {printed, computed}` (printed total kept, worked total said),
`startFrom` (internal: the count a part carried in).

`expand` returns `{stitches:[{t,c,h,w,side,cross?,span?,at?}], color, height, width, state, inc,
dec, shortRow, live, side}`; types k p yo k2tog ssk k3tog cdd m1 kfb sl cable co bo; heights 0.75
(garter 0.5 — a knit row after a knit row flat, or alternating pure rounds); widths 1, rib 0.8, cable
0.85 per crossed stitch; `bo` records are stitches bound off in the row (`live` = the rest = count);
a short row has records only for the stitches it works.

## The twelve lines (lens §1.3) — what they produce (unit tests, test/knits.test.html)

1. `Row 1 (RS): K2, *yo, k2tog, k3; rep from * to last 3 sts, k3. (60 sts)` → row 1, rs, count 60
   explicit, computed 60 (62 sts would be null: the remainder does not fit).
2. `Rows 2, 4, 6 and 8 (WS): Purl.` → rowList [2,4,6,8], ws, computed = prev; `lineFor(3)` is the
   odd line; each listed row has its own count.
3. `Rnd 13: K1, m1L, knit to last st, m1R, k1 — 62 (68, 74, 80, 86) sts.` → row 13, side null,
   62 explicit (80 at L), computed agrees.
4. `Set-up row (WS): P3, pm, p12, pm, p30, pm, p12, pm, p3.` → setup, 60, ws, markers 3/15/45/57.
5. `Raglan inc rnd: *K1, m1L, knit to 1 st before marker, m1R, k1, sm; rep from * 3 more times —
   8 sts inc.` → next rnd, delta 8, count prev+8, the "8 sts" is not a total.
6. `Repeat Rnds 13–14 a further 9 (11, …) times — 160 (184, …) sts.` → repeat of [13,14],
   repeatTimes 10 + repeatMore (engine convention: the written working counts), count 160; every
   repeated rnd has its own count; the piece runs to rnd 32.
7. `Heel turn Row 1 (RS): Sl1, k17 (19), ssk, k1, turn.` → row 1 of a part named "Heel Turn", rs,
   stitches null ((19) is a size), shortRow, computed prev−1.
8. `Row 2 (WS): Sl1, p to one st before the gap, p2tog, p1, turn.` → computed null; the row after it
   is not counted from a stale number.
9. `Rnd 25: [K6, C6F] 8 times. (96 sts)` → 96 explicit and computed.
10. `Work even in St st until piece measures 32 (33, 34, 35) cm / …, ending with a WS row.` →
    until {length, 33, cm, endOn ws} at size M; no row target, no rows grown.
11. `Next row (RS): BO 4 sts, work to end — 56 sts rem.` → row prev+1, rs, 56 explicit = computed.
12. `Sizes S (M, L) only: K2tog at each end of next row.` → a row (−2) for S/M/L; a `sizeSkip`
    note for XL.
Traps: `CO 60 (66, 72) sts` (66 at M); "Cast On"/"Bind Off"/"Picot Bind-Off" never parts;
`34 (38, 42, 46)` detected as sizes; gauge/needle lines never a setup row.

## Coordinator / worker audit items — done, each with assertions

- "Rep Rows 3-4 60 more times. (255 sts)" and "Rows 5-124: Rep Rows 3-4" both count each row
  (shawl 19, 19, 23 … 255); sleeves don't stick at 44; a repeat without a total is worked out.
- Socks template heel flap "Rows 59-88: Rep Rows 57-58" = 32 each (rows replay their own words).
- Bernat: wrapped rows joined before counting (8 markers on row 1; never "≈ 9"); Body/Sleeves/
  Neckband parts named; neckband is its own part; XL-only blocks dropped for other sizes and read
  for XL; the sleeves read on their own at L use the L block; the yoke read on its own starts at the
  neck's 76; alt rows 36/44/52.
- `side` only from tags (tests for disagreeing tags, "(Wrong side facing)", "RS (Set-up row)",
  "(RS, Row 1 of patt)", and labels in the side slot — "(dec rnd)", "(turning ridge)", "(dec)").
- Rows unique after enumerations; single rows interleave with an enumeration.
- `workedIn` rows/rounds per line (Speed Bump heel inside the round).
- Short rows: "do not turn", magic-loop "Turn work, position needle point", a turn after every
  stitch (Albus Argyle) are not short rows; "wrap next st, turn", "turn so WS is facing" are.
- Ebooks: one group per pattern from the contents page (sock book 8, lace book 10); a group starts
  its own parts; no row runs back into another pattern's part; the hat no longer swallows the next
  pattern.
- Parts carry `Sizes: …` and `Start with N (…) sts.` lines (only when the carried count's size list
  is known — never a guessed per-size number).
- Chart sentences: "See Chart B for Rows 14-36" puts the chart on rows 14–36; "ending with chart
  Row 20" takes the last named chart.
- Five printed errors: Bernat XL divide kept as printed 156 with `deviation`; Flying Trapeze toe
  (KNOWN: the page interleaves columns); Genome Rnd 4 gives no count (9 of 11 sts); Spectrum gauge
  shown as printed (112); magic-loop toe null for 36/40.
- Sandnes: no rows, no "Model N" parts, no sizes. Nicoll: 205 empty pages, no rows.

## Verified

test/knits.test.html **237/237**; test/knits.fixtures.html?heavy=1 **168 passed, 0 failed, 23
known** (without `?heavy=1` and a cold cache the three Sandnes checks are skipped: 165); patterns 1037; patterns.fixtures 829 / 844 heavy; templates 147; crafts 124;
diagram-model 529. All in the pane on localhost:8766 (desktop width; no UI here).

## Still wrong (the 23 KNOWN lines, and why)

- Prose layouts: rows printed mid-paragraph (lace hat "Inc. Rnd:", Arrowhead "Rep Rows 9–20",
  Boot Stockings toe, "Next" / "rnd Knit" split label, "Toe: With … using the" / "Eastern method…
  CO 8") are not read as rows — counts stay null, never guessed.
- Extractor faults (owner of `js/pdftext.js`): Flying Trapeze p15–16, On-Your-Toes p20, gloves p31
  interleave columns; the Time Traveler advert inside the heel-flap row; overlay text p4/p8–9.
- Flying Trapeze: six finished sizes over two instruction columns — no column mapping, so no count
  at sizes 3–6 (shown as nothing, not as a wrong number).
- Chart rows (vector charts) are not counted ("work Row 1 of Foot chart over 32 sts" → null).
- "Repeat to end of row" after stitches with no star (magic loop toe) is not a repeat.
- Rico's pattern rows: the 9-st repeat does not divide the growing count ("according to patt").
- Genome G4: the parser reports the 48 sts on the needles for a heel short row; the research wants
  no count on it.
- Bernat's neck rows and yoke rounds have no printed heading; the parts are unnamed (the importer
  should label them, e.g. "Part 1") — naming them "Neck"/"Yoke" would be invented.
- Side for a short row after the last tag in its part is null (rule: only between agreeing tags).
- "Rep from * N times" (without "more") directly after its block is read as N more workings.

## For the owner of `js/store.js`

- Pass `opts.sizes` (Project.sizes) and `opts.sizeCount` to `Knits.parse` so "Sizes XL only:"
  blocks map without the carried `Sizes:` line; key the line cache on `Knits.version`.
- `Line.rowList` (enumerations, "2nd and alt rows") — rows are not contiguous; `counts` on such a
  line is indexed by `row - line.row` with holes. Repeat lines may carry `counts` + `countsFrom`.
- `Line.workedIn` is now set on every knitting row ('rows'/'rounds').

## For the owner of `js/pdftext.js`

Three-column pages interleave (socks p15, p20; lace p31); duplicated overlay text (socks p4, p8–9).

## Contract changes

- `expand` keeps the crochet signature `(lines, rowNumber, prevCount, state)`.
- `until.unit` adds `'rnds'|'rows'` for `kind:'rows'`; `until.relative` for "a further 2"".
- `chart` may carry `rowEnd` for a range ("Rows 1–12 of Leg chart").
- `repeatTimes` for "a further N" / "N more" is N+1 with `repeatMore:true` (engine convention).
