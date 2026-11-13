# Wave K — knit-parse report

Owner: knit-parse (`js/knits.js`, knitting-only paths of `js/patterns.js`, `test/knits.test.html`,
`test/knits.fixtures.html`). Interface: `docs/wave-k/api/knit-parse.md`.

## Baseline (before the first edit, 2026-11-12)
| Suite | Count |
|---|---|
| knits.test | 385 passed, 0 failed |
| knits.fixtures | 530 passed, 0 failed, 11 known |
| patterns.test | 1112 passed, 0 failed |
| patterns.fixtures | 905 passed, 0 failed |
| knit-counter.test | 317 passed, 0 failed |
| knit-chart.test | 151 passed, 0 failed |

How measured: `tools/headless-suite.sh` for the unit pages; the fixture pages and knit-chart never
print a summary under `--virtual-time-budget` (pdf.js work does not advance virtual time), so they
were run through a small CDP driver (headless Chrome `--remote-debugging-port`, poll
`window.__done` / `#summary`), kept in my scratchpad, not the repo.

## Progress
(in build order; updated as each lands)

### P8 pairs by default — DONE
- `finishParts` → `pairPrior`: sleeve/sock/mitten/glove/stocking parts, and in a socks-only
  (stockings/mittens/gloves) pattern every part, become x2 with `makeCountInferred`,
  `makeCountWhy: 'pair'`, `pairNoun`. Never when the text says one ("(make 1)", "one sleeve
  only", "with one sleeve") or the name is one of a pair ("Left Sleeve", "Sock 1"). "Make 1 (M1)"
  is a stitch, never a make-count.
- `rowWord: 'rnd' | 'row'` per part (majority of numbered rows `workedIn === 'rounds'`), `pages`.
- Measured: Bernat / Boyfriend / Cabled Yoke Sleeves x2 pair; every Time Traveler, Stranded Boot
  and magic-loop part x2; TT Foot `rnd`; Boyfriend Back `row`.
- Changed one old assertion: knits.test "Sleeves x1 / Sleeves (continued) x1" → x2 (the brief's rule).
- New hook in `js/patterns.js` `splitSections` output: `if (PROFILE.partOut) PROFILE.partOut(s, o,
  lines, meta)`. Crochet has no `partOut`: output unchanged (patterns.test 1112 / fixtures 905).

### P7 book import, parser half — DONE (parser side)
- `Knits.bookPatterns(text[, parts])`: lace book lists **10** patterns (was 7 offered), each with
  pages (Sophia 3-4, Icelandic 12-15, TT 3-9, Stranded Boot 32-34), own sizes, gauge (TT 32 x 46 /
  4 in from "GAUGE 32 sts and 46 rnds" — `frontLines` now reads labels with no colon; Sophia
  15 x 28), gauge and needle lines. `group.index` = place in the contents.
- Oriel, Spectrum, Arrowhead: one `unread: true` placeholder part each (their own text, 0 rows).
- Adverts ("KNITS" / "Interweave Knits IS A MUSTHAVE" / "interweaveknits.com", "Originally
  published in ...") are notes, never headers: no "Knits" part. Chart titles now match as printed
  (the Leg chart's "Leg" no longer swallows the "LEG" heading).
- Sock names: TT = Toe, Foot, Gusset ("HEEL / Shape Gusset"), Turn Heel, Heel Flap, Leg, Cuff.
  Stranded Boot = Cuff, Turn Heel, Gusset, Foot (inline "Cut CC. Turn heel:" / "... Gusset:"
  labels name the part instead of "Cuff (continued N)"). "Turn Heel" kept as printed (the
  proposal said "Heel Turn"; renaming would be invention).
- Glossary how-to sentences (glossary pages, Kitchener "Step N") are dropped from `placement`.
- Not done: Stranded Boot's heel flap rows stay inside "Cuff" (splitting "Heel: Place first 15 ..."
  as its own part made the engine move the turn-heel rows into the Cuff; reverted). Border Socks /
  Albus still have odd names ("Shape Gusset (continued)", "Albus", "Argyle", one unnamed part).

### P1 stretches, parser half — DONE (contract in api §3)
- `markStretches` (end of `postParse`): `Line.stretch`, `Line.phase`, `Line.phaseBase`,
  `Line.phaseRow/End`, `lines.stretches`, and `Knits.phases(lines[, section])`.
- Measured (fixtures, part text as the counter reads it): Boyfriend L Front: rib stretch, rows
  1-4, "same length as Back to beg of raglan shaping" stretch (count 93, ending WS), raglan
  cast-offs phase 2 rows 1-2 (E1). Back: 16½" from beg, raglans phase-row 1. Bernat M yoke:
  "Cont even in rnds on ... 216" onSts 216 after round 34 (E8). Sandnes 4 yrs yoke: "work 7 cm
  ribbing" is its own stretch on 52 sts, round 1 after it (E7). Boyfriend Sleeves L: two count
  stretches (to 45, to 61) then the 17½" one; TT Foot 7¼" from tip of toe on 68.
- Known gaps: count-ended stretches stay `open` until P6 closes them; Boyfriend Front's rib
  stretch `endOn` is null ("ending on a 2nd row" cannot be resolved in that part).

### P6 shaping schedule — DONE
- `Knits.shaping(text, {size, sizeCount, start, scope})` (api §4): clauses split on AT (THE) SAME
  TIME (together) and ", then" (one after the other); every / alt / RS / WS / every Nth, next N
  rows, "next and following", "of the 5th row and every following", times / twice / once / until
  N sts, bind-off series. Printed totals are checked; a disagreement gives no schedule.
- Measured: Boyfriend F23 L 10 -> 9, 7, 6, 4 in 4 rows (research: 4 rows, raglan on rows 3, 5 of
  the neck = rows 2, 4 after the turn row); F32 L 13 rows to 45, XS/S 61 rows to 59; Boxy X21
  rows 1, 7, 13, 51 -> 57 = printed; Cascade saddle sleeve S 35 -> 63 (printed 63), L 39 -> 75
  (printed 75); Heathers armhole "BO 4 once, then every WS row 3 once, 2 x1, 1 x2" 47 -> 36.
- Bernat sleeve is not a P6 sentence ("dec rnd, 5 even, Rep last 6 rnds 8 times more"): it is a
  counted repeat the parser already numbers; not re-proved here.
- A count-ended stretch whose schedule reads is closed: `open:false, rows`. Boyfriend F23 closes
  in the whole-document parse; read alone as the Shape Neck part it stays open (the part does not
  carry the 10 sts it starts on) — honest, but the store will see it open.
- Not read (schedule null): "AT THE SAME TIME, when band measures ..." triggers after the first
  clause (Heathers neck), lengths as intervals ("Rep inc every 3½ cm").

### P12 mirror — DONE (lines; charts not)
- `Knits.mirror`, `Knits.mirrorText` (api §5). Heathers cardigan (both fronts printed): 4 of 4
  Right Front lines mirror to the Left Front word for word (rib row, armhole bind-offs, neck
  bind-offs, shoulders). Anything uncertain comes back unchanged with `mirrorYourself`.
- Not mirrored: star repeats ("*k1, p1; rep from * to end"), sk2p, wraps, free prose with
  first/last N sts. Half charts: not built (KnitChart cells; owner of `js/knit-chart.js`).

### P15 calculators — DONE
- `Knits.evenly`, `Knits.evenlyRow`, `Knits.pickupRatio` (api §6). Boyfriend F4 L 85 -> 88, F30 XL
  37 -> 41 agree with the printed totals; unit tests check every spelled row works and makes the
  right number of stitches.

### P20 materials, parser half — DONE
- `Knits.materials` (api §7); `bookPatterns()[i].materials` per book pattern. Bernat M 2 balls,
  5+6 mm circular 24", 5.5+6 mm dpn; Boyfriend L 10 balls, or 9 of the alternative yarn; Sandnes
  children one per size; Cascade saddle US 9 & 10. Weak: in the sock book, yarn names from
  wrapped prose come out as "Yarn" or a colour word ("pewter"): the numbers are right, the names
  not always.

### E18 and the knit-ui chart-name bug — DONE
- `Knits.importNotice` (lookbook; Sandnes 0216 asserted with ?heavy=1), `dialectHints().uk`
  always false (Handbook asserted).
- "Work Chart A." / "Work from Chart A." / "Work Chart A over 32 sts" -> chart A (the article
  check had caught the letter A; "from" was taken as a name). 5 assertions.

## Results (end of session)
| Suite | Baseline | Now |
|---|---|---|
| knits.test | 385 | **449** passed, 0 failed |
| knits.fixtures | 530 + 11 known | **583** passed, 0 failed, 11 known (587 with ?heavy=1) |
| patterns.test | 1112 | 1112 (unchanged) |
| patterns.fixtures | 905 | 905 (unchanged) |
| knit-counter.test | 317 | 378 (the knit-store worker's additions; green) |
| knit-chart.test | 151 | 151 |

One old knits.test expectation changed per the brief (Sleeves x1 -> x2). New fixtures read:
`knit-cascade-saddle-cardigan.pdf`, `knit-cascade-heathers-cardigan.pdf` (skip cleanly if absent).

## Decisions for the coordinator
- P12: mirrored lines carry `by: 'app'`; the UI must say "worked out by the app" (brainstorm §5).
- "Turn Heel" kept as printed rather than renamed "Heel Turn".
- A count-ended stretch read alone (part text) often lacks the count it starts on and stays open
  (Boyfriend Shape Neck); carrying a "Start with N sts" line into such parts would close it. Not
  done: it changes part text that other suites assert on.

## For the owner of `js/app.js` (shell-ui) — E12, pinned
- Wrong pattern imported: `buildRows()` ~8515-8519 ticks the FIRST pattern by default
  (`groupTicks[n] = ... gi === 0`); the "Import this pattern" tick handler ~8800-8807 only
  toggles the open tab (`groupTicks[openGroup] = !groupTicks[openGroup]`), so Sophia stays ticked
  when the maker ticks Icelandic. `sizeSections()` ~8469-8482 then takes the FIRST ticked group
  for the size chips (TT's sizes shown while Stranded Boot is open), `patternName()` ~8963
  returns null with two ticked, and `Store.importPatternSections` (store.js ~4134-4156) takes the
  first group's sizes/gauge. Suggested: in a pattern book make the tick single-choice (ticking one
  unticks the others, or the open tab is the imported one).
- List every book pattern: the importer lists only groups with `rows > 0` (~8570). Use
  `Knits.bookPatterns(text)` for the list (all 10 in the lace book) and show `unread` parts with
  "the app could not read this pattern's rows".
- Gauge chip per pattern: `bookPatterns()[i].gauge` / `gaugeLine` is the picked pattern's own.
- Charts / checklist: keep only charts whose page is inside `bookPatterns()[i].pages` (E12: TT got
  Stranded Boot's p34 Leg chart).

## Later (not chased, per coordinator)
- OCR text of the Nicoll scan: `Knits.parse` finds none of the printed counts though the text
  matches (docs/wave-k/ocr.md).

## Follow-ups from knit-store (2026-11-12, later) — DONE
1. Lace hat 3/4" rib read as 4 in -> 0.75 in (bare fractions in `untilOf`). Asserted (KS1).
2. Lace hat "Inc. Rnd" a second set-up row -> round 1, 144 sts (no sentence stop after
   "Inc."/"Dec." before Rnd/Row). Asserted (KS2) in the part as the counter reads it.
3. "Knit 5 rnds even" back-reference -> `plainRows: true`, `repeatOf: []` (removing `repeatOf`
   outright made the engine lose those rounds' counts; an empty list keeps them). Asserted (KS3).
4. Stranded Boot cuff + leg + heel flap in one part -> split at the text's "Leg:" / "Heel:"
   labels into Cuff / Leg (Start with 84 sts) / Heel (rows 1-6 on 29) / Turn Heel / Gusset / Foot.
   The earlier attempt (making "Heel:" a header) moved the turn-heel rows into the cuff; this one
   splits the part text after parsing, so the whole-document counts (H7 Turn Heel 28) are
   unchanged. The old E10 assertion was updated to the new part list. Asserted (KS4).
5. Stretch on a cast-on line -> the rib is now its own line in both cases; a setup line that
   still holds one is marked `within: true` (cast-on first, then the stretch). Asserted (KS5).

| Suite | Now |
|---|---|
| knits.test | 455 passed, 0 failed |
| knits.fixtures | 590 passed, 0 failed, 11 known |
| knits.journey | 57 passed, 0 failed (knit-store's KNOWN lines can now become assertions) |
| patterns.test / patterns.fixtures | 1112 / 905 (unchanged) |
| knit-counter.test / knit-chart.test | 385 / 151 |

For the owner of `js/store.js` (knit-store): treat `plainRows` lines as plain rows (show the
line itself); a setup line's `stretch.within` means "cast-on, then the stretch".

## Follow-ups from knit-ui (2026-11-13) — DONE
1. Mirror: the trailing stitch total stays at the end of the mirrored row (3 unit assertions + 1
   fixture). **knit-ui's workaround can be removed.**
2. Red Heart season cardigan: parts are now Rib, Back, Right Front (were Rib, Shape Shoulders,
   Shape Shoulder, Small, Medium). "Shape ..." headings join the piece above them when that piece
   has no rows of its own; size-word rows ("Small: K1, ...") are notes. Fixture assertions on the
   real file (added to FILES) plus a unit assertion. "Left Front: Work same as Right Front,
   reversing all shaping." stays a note (0 rows), so `Knits.mirrorText(rightFront.text)` is the way
   to build it.
3. Materials: `Knits.parse(text).meta.materials` and `part.materials` (api §10). Red Heart: 5.5 mm,
   3 (4, 4, 5, 5) skeins; Boyfriend parts carry both yarns.

| Suite | Now |
|---|---|
| knits.test | 461 passed, 0 failed |
| knits.fixtures | 595 passed, 0 failed, 11 known |
| knits.journey | 66 passed, 0 failed |
| patterns.test / patterns.fixtures | 1112 / 905 (unchanged) |
| knit-counter.test / knit-chart.test | 388 / 151 |

## Release audit round (2026-11-13) — what changed
1. Mirror: bind-off "at beginning of next row" -> mirror this yourself; ". 29 sts." stays at the end.
2. Shape Neck: `Knits.partStart` + `parse(..., {startCount})` (no change to part text). Boyfriend L
   Shape Neck: start 43, "Turn" row 10 sts, the AT SAME TIME neck/raglan shaping closes at 4 rows
   (a real-pattern schedule). The join row carries "slip center ... sts onto a st holder" as `leadNote`.
3. Import gaps: Cascade saddle cardigan's prose pieces (Back, Left Front) are offered as `unread`
   parts with their text; every part lists the instructions it did not number (`notRead`).
4. "Work from ** to ** as given for Back": the block is on `refBlock` (cast-on + rib rows); the
   Front's rib repeat no longer points at the Back's row 23.
5. `Knits.title`: Boyfriend's Cable Knit Pullover, Saddle Shoulder Cardigan (as printed on p1);
   null for a book.

## NOT fixed in this round (plainly)
- Cascade saddle cardigan: its prose rows ("K9 rows", "work Pattern st ... until 13"") are still
  not numbered rows; Right Front ("Work as for left front, reversing shaping") and Sleeves are not
  offered as parts (no own cast-on found / "CO35" heading not a section). Offered as unread only.
- Heathers fronts still stop at row 9 and the "Rnd 6:" stray row remains; "for 4" = 39 rows" is not
  read as 39 rows. They show in `notRead` where they are notes.
- Time Traveler Leg: "work Rows 1–12 of Leg chart … 5 times" (60 rounds) is still not numbered
  (rows from charts, P5, is knit-store's); TT Foot's toe-up "Work even through Row 11 of Foot
  chart" stays one line.
- Icelandic shawl (IC1 split, border even-row rule, crochet edging read as a stretch): not touched.
- Stranded Cuff's line starting mid-sentence ("marker (pm), and join…"): an extractor/reflow wrap,
  not touched.
- `part.refBlock` is data: nothing expands it into numbered rows (inserting the rows would make the
  Front's numbering restart inside one part).
- `Knits.partStart` must be called by the importer (app / store) and stored; nothing calls it yet.

## For the owners
- `js/app.js` (shell-ui): name the project with `Knits.title(text)` when it returns a name; call
  `Knits.partStart(text, part.text, size)` at import for parts that have no cast-on and store it;
  show `part.notRead` ("the app could not read these lines") and `unread` parts as such; show
  `line.leadNote` before a join row and `part.refBlock` under "Work from ** to **".
- `js/store.js` (knit-store): pass the stored start as `Knits.parse(text, { size, startCount })`.
- knit-ui: the mirror workaround for the full-stop total can go.
