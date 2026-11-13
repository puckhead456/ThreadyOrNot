# API: `window.Knits` additions (wave K, knit-parse worker)

Status: BUILT (every section below is LIVE in `js/knits.js` and asserted in `test/knits.test.html`
and `test/knits.fixtures.html`; this file is kept exact).
Everything is **additive** and knitting-only: `Patterns` (crochet) output is unchanged. Feature-detect
every call (`if (Knits.phases) ...`). All functions are pure (no DOM, no storage) and never throw:
on input they cannot read they return `null` (or the documented "could not read" shape).

Size arguments are the size **index** (0-based, as `Knits.parse(text, {size})`).

---

## 1. Parts: `Knits.splitSections(text)` — new fields on each part (P8, P7) **LIVE**

```
{ name, makeCount, text, placement, group, gaugeLines?,      // as before
  makeCountInferred?: true,      // as before; now also set by the pair prior below
  makeCountWhy?: 'pair' | 'other' | 'continues' | 'assembly',  // assembly: the engine's "sew sleeves to body" rule
                                 // 'pair': garment noun prior (sleeve, sock, mitten, glove,
                                 //   stocking; or a sock-anatomy part - cuff, leg, heel, heel flap,
                                 //   heel turn, gusset, foot, toe, instep, sole, thumb, hand - in a
                                 //   sock / stocking / mitten / glove pattern) -> makeCount 2
                                 // 'other': "Work other sleeve in the same manner" (wave H rule)
                                 // 'continues': copied from the part it continues
  pairNoun?: 'sleeve' | 'sock' | 'mitten' | 'glove' | 'stocking',
                                 // with makeCountWhy 'pair': the noun, for the confidence line
                                 //   ("made twice (a pullover has two sleeves)")
  rowWord: 'rnd' | 'row',        // 'rnd' when most of the part's numbered rows are worked in the
                                 //   round (E13): label RND and drop "RS?" for such a part
  pages?: { from, to },          // PDF pages (1-based) the part's lines are on; absent for text
                                 //   with no "=== PAGE n ===" markers
  unread?: true                  // a book pattern listed in the contents whose instructions the
                                 //   reader could not turn into rows: one placeholder part holding
                                 //   that pattern's text (its rows are 0). Never invented rows.
}
```
In a pattern for socks / stockings / mittens / gloves alone (title or book-group name, and no other
garment such as hat, scarf, sweater named there) EVERY named part is a piece of the pair (x2, 'pair').
The prior never overrides the text: a part keeps 1 when its header or text says "make 1 / make
one", "one sleeve", "single sleeve", or its name is one of a pair ("Left Sleeve", "Right Mitten",
"First Sock", "Sock 1").

`group.index` is the pattern's position in `Knits.bookPatterns(text)` (every pattern in the
contents), not its position among the patterns that produced parts.

## 2. Books: `Knits.bookPatterns(text[, parts])` (P7) **LIVE**

```
Knits.bookPatterns(text) -> null | [{
  name,                 // as in the contents ("Icelandic Lace Shawl")
  index,                // 0-based book order == part.group.index
  pages: { from, to } | null,   // the pattern's own PDF pages (from its contents page to the
                                //   page before the next pattern's)
  sizes: [..] | null,   // Knits.detectSizes over that pattern's own text
  gauge: Gauge | null,  // Knits.gauge over that pattern's own gauge line (same shape as Knits.gauge)
  gaugeLine: string | null,     // the pattern's own "Gauge ..." line, wraps joined
  needleLine: string | null,    // the pattern's own "Needles ..." line, wraps joined
  parts: number         // how many parts splitSections made for it (0 -> an `unread` placeholder)
}]
```
`null` for a document that is not a book of several patterns. Use `pages` to attach only that
pattern's charts and checklist items (charts whose page is outside `pages` belong to another
pattern).

## 3. Stretches: open "work until" phases (P1, parser half) **LIVE**

Every line that keeps working "until" something the maker decides is marked, in text order: a
length ("until work from beg measures 17"", "Pat for 4"", "work 7 cm ribbing"), "same length as
Back", or a stitch count ("until 4 sts rem", "until there are 59 sts"). Not marked: counted
repeats, "until 24 rows", rows `shapeEvery` already numbered, lines for other sizes
(`sizeSkip`), notes before the section's first setup/row. Row numbers the parser gives are
**unchanged**; the phase fields say how to number them. Everything is per **section** (= per part
as the counter parses `part.text`; a numbering that starts again at "1st row" opens a new section,
so ids restart there).

```
Line.stretch = {
  id,              // 1-based within the line's section, in text order (== the phase it opens)
  open: bool,      // true: the maker says when it ends. false: P6 read the shaping and
                   //   knows its exact rows -> `rows: N` (count-ended stretches only)
  within: bool,    // true: a ROW line that does something first and then the stretch
                   //   ("Rnd 1: ..., k 1 rnd, inc 8 ... = 60 sts. Join and work 7 cm ribbing", E7):
                   //   the line's own rows are worked first (its Line.phase is id-1), then the stretch.
                   //   A row line that IS the stretch ("Foot: Work even in patt until foot measures
                   //   7"") has within:false; its parser row number is not a real row.
  ends: { kind: 'length', value, unit: 'in'|'cm', endOn: 'rs'|'ws'|null,
          from: 'beg'|'tip of toe'|'sleeve divide'|...|null,   // "measures ... from <from>"
          what: 'work'|'piece'|'foot'|'armhole'|'sleeve'|'ribbing'|...|null, // "<what> measures"
          relative: bool }                                       // "a further 2""
      | { kind: 'sameAs', of: 'Back', at: 'beg of raglan shaping'|null, endOn }
      | { kind: 'count', value: N, endOn },                      // size-resolved
  onSts: N | null,     // the total printed in the line ("on 204 (216-...) sts" -> 216 for M)
  count: N | null,     // stitches while it runs: onSts, else a printed total (when it is not the
                       //   end count), else the count before it; null while shaping or unknown
  endCount: N | null,  // stitches after its last row when printed ("..., inc 3 sts evenly across
                       //   last row. 76 (...) sts.") or the count end value
  shaping: bool,       // it increases / decreases as it goes (a closing "cast off" or "inc N sts
                       //   evenly across last row" is not shaping)
  approxRows: N | null,// the parser's ≈ estimate from the gauge when it gave the line rows
                       //   (untilSpans / patternStretches); a hint, never a target
  afterRow: N,         // the section's last parser row number before the stretch (0 none; for a
                       //   within line, that line's own last row)
  text                 // the line's text (trimmed)
}
Line.phase        // every line of a section: number of stretches opened up to and including it
                  //   (0 = before any). A within line has phase = stretch.id - 1.
Line.phaseBase    // lines in phase >= 1: subtract from ANY parser row number on the line (row,
                  //   rowEnd, rowList, repeatFrom/To, countsFrom) to get its 1-based place after
                  //   the end of stretch `phase`. 0 when the numbering restarted at 1 after it.
Line.phaseRow, Line.phaseRowEnd
                  // row lines in phase >= 1: row - phaseBase, rowEnd - phaseBase
lines.stretches   // [copy of Line.stretch + { line: index, section }] in text order
```

Example (Boyfriend L, part "Front"): the 4" rib stretch id 1 (endCount 93), rows 1-4 in
phase 1, "Cont even in pat until ... same length as Back to beg of raglan shaping" id 2
`{kind:'sameAs', of:'Back', at:'beg of raglan shaping', endOn:'ws'}`, count 93; "Shape raglans:
... cast off 2 sts beg next 2 rows" phase 2, parser rows 5-6, phaseBase 4 -> phaseRow 1-2.

`Knits.phases(lines[, section])` -> working order of one section (default: the first section with
rows or a stretch): `[{kind:'rows', from, to, phase, phaseFrom, phaseTo}` (parser numbers and
phase-relative ones; counted repeats' rows included) `| {kind:'stretch', line, stretch}]`.

## 4. Shaping schedule (P6) **LIVE**

```
Knits.shaping(text, { size, sizeCount, start, scope? }) -> {
  readable: bool,        // false -> schedule null: show `sentence` as written
  sentence,              // the text as given
  clauses: [{ what,      // 'neck'|'raglan'|'armhole'|'shoulder'|'side seam'|'center front'|
                         //   'front'|'each end'|null (then shown as 'clause N')
              op: 'dec'|'inc'|'bo',
              per,       // sts per shaping (null for a bind-off series: see series)
              edges: 1|2,// "each end" / "both sides" / "each neck edge" -> 2
              from,      // first row, 1 = the next row ("now", "next", "of the 5th row and")
                         //   "every 4th row" alone starts on row 4; after ", then" it follows
                         //   the clause before
              every,     // 1, 2 (alt / other / RS / WS rows), N ("every 6th")
              times,     // occurrences in all ("next and every following 6th row 13 times"
                         //   = 14; "twice more" after "next" = 3); null with an until
              until: { sts } | null,
              series: [{ per, times }] | null,  // "bind off at beg of every WS row 3 sts once,
                                                //   2 sts 1 times and 1 st 2 times"
              when: string | null,  // "When side seams measures same as back" (a trigger)
              after?: index,        // the clause it follows (", then ...")
              text }],
  schedule: [{ row, delta, count, changes: [{ what, delta }], done: { <what>: n } }] | null,
  rows: N | null,        // rows the schedule takes (to its last shaping row)
  endCount: N | null,
  disagrees?: { printed, computed }   // a printed total the arithmetic does not reach -> no schedule
}
```
`start` (the stitch count before the first row) is required for a schedule. The sentence is
size-resolved first ("6th (6th-4th-...)" lists, `scope` = the size indices of a "Sizes L,
2/3XL and 4/5XL only:" block for a bare list). `AT (THE) SAME TIME` splits shapings that run
together. Unreadable -> `readable:false`, `schedule:null`: no clause it cannot read, no
trigger after the first clause ("AT THE SAME TIME, when band measures 8½" ..."), no until-count
the steps miss, no printed total that disagrees.

Feeds §3: a stretch ended by a count whose sentence reads gets `open: false, rows: N`.
Proofs (fixtures): Boyfriend F23 L 10 -> 9, 7, 6, 4 (4 rows); F32 L 13 rows, XS/S 61 rows;
Boxy X21 rows 1, 7, 13 (51 -> 57); Cascade saddle cardigan sleeve S 35 -> 63 in 83 rows, L -> 75.

## 5. Mirror (P12) **LIVE**

`Knits.mirror(lineText)` ->
`{ text, mirrored: true, by: 'app', swaps: [[from, to]] }` or, when it cannot be sure,
`{ text: <unchanged>, mirrored: false, mirrorYourself: true, unknown: [tokens] | ['(stitch order)'] }`.

- Swap table: k2tog<->ssk, p2tog<->ssp, k3tog<->sssk, p3tog<->sssp, M1L<->M1R, LT<->RT,
  CnF<->CnB / CrnF<->CrnB / TnF<->TnB, "n/n LC"<->"n/n RC" (and LPC/RPC), left<->right,
  beg<->end (only where "beg" is in the line: "to end" stays).
- A **written row** (a comma list of stitches) keeps its side and is turned round: "K1, ssk,
  knit to end" -> "Knit to last 3 sts, k2tog, k1"; bracketed repeats turn round inside
  ("[k1, p1] 4 times" -> "[p1, k1] 4 times"); "to last N sts" is checked against the stitches
  after it.
- A **bind-off line** moves to the other side: "(WS) Bind off 4 sts ..., then at beg of every WS
  row" -> "(RS) ... every RS row". "at beg of every RS row" in prose -> "WS row" (one swap).
- `mirrorYourself`: a stitch token not in the table (sk2p, a star repeat, wraps), a stitch order
  it cannot count, or "first / last N sts" in words.
- `Knits.mirrorText(text)` -> `{ text, by: 'app', lines: [{ from, to, mirrored, mirrorYourself,
  unknown }] }` for a whole part ("work Left Front as Right Front, reversing shaping"). The UI must
  label the result "worked out by the app from <part>" (owner decision, brainstorm §5).
- Proof: Cascade Heathers cardigan writes both fronts; the Right Front's rib row, armhole and neck
  bind-offs and shoulder bind-offs mirror to the Left Front's printed words (fixtures, 4 checks).
- Not built: half charts (Icelandic B/D/F) mirrored cell by cell (needs `KnitChart`, not my file).

## 6. Calculators (P15) **LIVE**

- `Knits.evenly(count, change[, {round}])` -> `{ text, from, to, change, suggestion: true }` or
  null (more changes than stitches, or too few stitches between decreases). `change` > 0 = M1
  increases, < 0 = k2tog decreases. Flat: half a gap at each edge
  ("K3, M1, (k7, M1) 7 times, k4." for 56 +8); round: equal groups, the remainder one each
  ("(k7, M1) 2 times, (k6, M1) 6 times." for 50 +8). The UI shows it as a suggestion (≈ rule).
- `Knits.evenlyRow(lineText, { count, size, sizeCount, round? })` -> the same for a line's
  "inc / dec N (..) sts evenly across / around" (size-resolved), or null. `round` defaults from
  the words (around / rnd).
- `Knits.pickupRatio(sts, rows)` -> `{ sts, rows, per, of, exact, text, suggestion: true }`, the
  closest ratio with at most 8 rows: 68 over 90 -> "about 3 sts for every 4 rows".

## 7. Materials (P20) **LIVE**

`Knits.materials(text)` -> `{ sizes, yarn: [...], needles: [...] }` (never throws; empty lists
when nothing reads). For a book, call it on one pattern: `Knits.bookPatterns(text)[i].materials`
is that pattern's own.
```
yarn:    [{ name,          // "Terracotta Rose" ("Yarn" when the line names none cleanly)
            per: [n, ...], // the numbers as printed, one per size when bySize
            bySize: bool,  // per has one number for each of `sizes` (or one for all, spread)
            unit: 'balls'|'skeins'|'hanks'|'cakes',
            alternative: bool,  // an "OR <other yarn>" line
            text }]        // the printed line(s)
needles: [{ text,          // the statement ("US 8 (5 mm) and US 10 (6 mm) ... circular ...")
            mm: [5, 6], us: ['8', '10'],
            kind: ['circular'|'dpn'|'straight', ...],
            length: { value, unit: 'in' } | null }]
```
Read: Patons/Bernat "Sizes ..." blocks, "OR" + bare number rows, Sandnes "(2) 2 (2) 2 (3) 3
balls", Cascade "2 (3, 3) skeins". Instructions that name a needle ("CO 42 sts US 9 knitting
needles", "Change to 6 mm ndl") are left out.

## 8. Small fixes (E18) **LIVE**

- `Knits.importNotice(text)` -> `null | { kind: 'lookbook', text: 'This looks like a lookbook: it
  shows the designs, sizes and yarns, but has no knitting instructions to count.' }` - no row,
  repeat or cast-on / pick-up in the parse and no stitch words in the text (Sandnes 0216 says so).
- `Knits.dialectHints(text).uk` is always `false` and `dialect` is never 'uk'/'us' (it stays
  'period' for the older vocabulary): the crochet "Looks like UK terms" chip is not raised.
- Chart names: "Work Chart A." / "Work from Chart A." / "Work Chart A over 32 sts" -> `Line.chart.name
  'A'` (were "Chart" / "from").

## 9. Follow-ups from knit-store (LIVE)

- Lengths written as a bare fraction ("rib for 3/4"") read as 0.75 (were 4). "1 1/2"" unchanged.
- "Inc. Rnd: ..." / "Dec. Row: ...": the stop after Inc/Dec is not a sentence end, so the round
  stays one row line (lace hat: round 1, 144 sts) instead of a second set-up row.
- `Line.plainRows: true` with `repeatOf: []` on "Knit 5 (...) rnds even" / "Work N rows even"
  repeat lines: so many plain rows, no back-reference (the counts stay as before).
- Sock pieces named inside one part's text ("... from CO. Leg: Work through Rnd 84 ...",
  "Heel: Place first 15 and last 14 sts ...") are split into their own parts (Stranded Boot:
  Cuff, Leg, Heel, Turn Heel, Gusset, Foot). A piece that does not open with its own cast-on /
  placement gets `Start with N sts.` (Leg: 84). Only Leg and Heel labels split ("Toe:" inside a
  Foot is left: splitting it lost the toe's counts).
- `Line.stretch.within` is also true on a **setup** line whose cast-on comes before the stretch in
  the same sentence ("CO 124 sts ... Work in rib for 3/4""): the cast-on (row 0) first, then the
  stretch; its `afterRow` is 0. (In Stranded Boot and the lace hat the rib is now on its own line.)

## 10. Follow-ups from knit-ui (LIVE)

- `Knits.mirror` / `mirrorText`: a row's printed total ("—43 sts.", "(38 sts).", "- 40 sts rem.")
  is taken off before the stitches are turned round and put back at the END of the mirrored row:
  "K1, ssk, knit to end—43 sts." -> "Knit to last 3 sts, k2tog, k1—43 sts." (the UI workaround can go).
- Part names: a "Shape Shoulder(s) / Neck / Armhole / Cap" heading that holds the only numbered
  rows under a piece heading ("Back", "Right Front") is a section of that piece: the part is named
  for the piece and its text starts at the piece heading (cast-on included). "Small: K1, ..." /
  "Medium: ..." (a row for one size) is never a part heading. Red Heart season cardigan: parts
  Rib, Back, Right Front (the "reversing all shaping" source is findable by name).
- Materials reachable after import, same shape as §7:
  - `Knits.parse(text).meta.materials` - the whole document's (computed on first read; not
    enumerable, so JSON of `meta` is unchanged);
  - `part.materials` on each `splitSections` part - its pattern's (its book group's), present when
    anything was read;
  - `Knits.bookPatterns(text)[i].materials` as before.
  - Also read now: 'Red Heart® "Collage™": 3 (4, 4, 5, 5) skeins 2250 Rose Dust.'

## 11. Release audit (docs/wave-k/knit-audit.md) (LIVE)

- `Knits.mirror`: a bind-off whose side is only "beginning / end of next row" is returned
  `{ mirrored: false, mirrorYourself: true, unknown: ['(bind-off side)'] }` (it cannot move to the
  end of the same row); a stated side still moves ("beg of every WS row" -> "RS"). The ". 29 sts."
  total (full-stop form) stays at the end, like "—43 sts." and "(38 sts).".
- `Knits.parse(partText, { size, startCount })`: `startCount` (a number, or one per size) is the
  count the part's first row starts on when the part text does not say. The text is untouched; the
  first row gets `prevCount` and `startFrom: { count, given: true }`.
- `Knits.partStart(docText, partText, size)` -> number | null: that count, read from the whole
  document (Boyfriend L Shape Neck: 43 -> the "Turn" row is 10, the AT SAME TIME stretch closes
  at 4 rows). Call it at import per size and store it with the part.
- `Line.leadNote`: on a "Join yarn to rem sts ..." row, the sentence before it when it puts the
  centre stitches on a holder ("With RS facing, slip center 19 (19-21-21) sts onto a st holder.").
  Show it with the row.
- `Line.refBlock` / `part.refBlock` = `{ from: 'Back', lines: [...] }` on "Work from ** to ** as
  given for Back.": the block's lines (cast-on, rib rows) with the stars removed. A repeat that
  points only at rows the section has not written yet ("Rep last 2 rows" right after it) gets
  `repeatOf: []`, `notSure: true` (was the Back's row 23).
- `Knits.title(text)` -> the pattern's printed title, or null (a book, nothing title-like): from
  the publisher's running line with a product code, else the line over "Designed by".
- `part.notRead: [text]`: instruction sentences inside a part that the reader did not number
  (Red Heart "Work in Rib pattern for 6 rows. Change to St st and work even until ...").
- Single-pattern documents: a named piece with its own cast-on whose instructions are all prose
  comes as `{ unread: true }` part with its text (Cascade saddle cardigan: Back, Left Front).
