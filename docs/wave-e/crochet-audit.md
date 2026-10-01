# Wave E - crochet ground-truth audit (`crochet-audit`)

Owner files: `js/patterns.js`, `test/patterns.test.html`, `test/patterns.fixtures.html`
(the brief's `patterns.fixtures.test.html`), `test/templates.test.html`, `test/crafts.test.html`.
No edits to `js/pdftext.js`, `js/store.js`, `js/app.js`. The scratch page
`test/_crochet-audit-dump.html` was used for the round-by-round dumps and has been deleted.

## Method

Every crochet PDF in `tmp-pdf/` was read page by page with the Read tool (page text and page
images; photos, captions and colour keys included) and written down as ground truth: parts,
Make N, every printed round/row marker with the count it PRINTS (and the arithmetic where it
is easy), colours, which lines are assembly/placement and which are glossary or front matter.
The amigurumi set, the garments and the 2026-09-19 batch were transcribed by parallel readers
(one per group of PDFs) and spot-checked against my own reads (Stylecraft hood read directly);
the APL scans were sampled (three have no text layer at all, so their ground truth is "no
rounds"). Each file was then run through `PdfText.extract -> Patterns.splitSections ->
Patterns.parse / expand` and compared part by part and round by round.

Suites at the end (all run in this worktree, fresh extraction cache):

| suite | before | after |
|---|---|---|
| patterns | 929 / 0 | **967 passed, 1 failed** - the one failure is `columns: ...but a sideways block on an UPRIGHT page is left upright`, a `PdfText._pageLines` test of the extractor that is being rewritten this wave (see "For the owner of js/pdftext.js"); every Patterns assertion passes |
| patterns.fixtures | 711 / 0 | **780 / 0** |
| patterns.fixtures `?heavy=1` | 711+ / 0 | **780 / 0** (heavy files come from the same session cache) |
| templates | 94 / 0 | **94 / 0** |
| crafts | 124 / 0 | **124 / 0** |
| diagram-model (consumer of expand, checked) | 503 | 517 / 0 |
| diagram (consumer, checked) | 193 | 193 / 0 |

## Discrepancy table

"PDF" is the ground truth; "App" is what the parser gave at the start of the wave.

| fixture | part / round | PDF says | app said | fixed? | assertion |
|---|---|---|---|---|---|
| crochet-snowman | Hat R12 | "FRONT LOOP ONLY: (sc, sc inc) around" -> 72 | no count | yes | `crochet-snowman.pdf: Hat R12 ... -> 72` |
| crochet-snowman | Scarf R1-R3 | 71 ch, 70, 70 | -, 71, 71 | yes | `Scarf "R1: Ch71, turn." 71 chains, then 70 sc` |
| crochet-snowman | Scarf work mode | rows (every R line turns, never joins) | rounds | yes | `the Scarf's "R1..R3 ... turn" are rows` + unit tests (joined-and-turned = rounds) |
| crochet-snowman | R1 notes | glossary "slst = slip stitch" is front matter | attached to R1 as a note | yes | `the "Terms used" line ... is no note on round 1` |
| crochet-snowman | Hat / Scarf colours | bold vs regular type = colour 1 / 2 | none | no (typography is not in the text layer) | - |
| crochet-turtle | every part | "MR with 6 sc." is a 6-st round before Rnd 1 (12) | note, no setup | yes | `every "MR with 6 sc" ... is a counted magic ring` |
| crochet-turtle | Feet placement | "sew the legs, head and tail onto the underside" | Tail only (legs vs Feet) | no - "legs" is not the part's name | - |
| crochet-fish | Rnd 7 | 12 wrapped lines, both fins, "(40)" | first 3 lines; rest hung as notes on Rnd 8 | yes | `round 7 keeps all twelve of its lines` / `none of round 7 hangs under round 8` |
| crochet-panda | Arm, Leg, Ear, Eye | Make 2 each ("Sew arms...", "legs and tail", "Sew ears...", "Sew eyes...") | Make 1 | yes (`makeCountInferred`) | section list `Arm/2/11 ...`, `Arm/Leg/Ear/Eye x2 come from ...` |
| crochet-panda | placement | ears/eyes/mouth go on the Head; arms go on the Body | Ear / Eye / Body | yes (host rule, see below) | `the Head carries the ears, eyes and mouth`, `the mouth is no longer the Body's` |
| crochet-baphomet | Body/Head R29 | "(2sc, dec)x8 [36]" - x8 is a designer error, x12 intended | 36 (printed) | kept printed count; no `deviation` flag exists in the model | - |
| crochet-baphomet | all other rounds | as printed | as printed | - | (existing) |
| bear.pdf | Second Leg | "1. Hdc 8 (8)" + "the same as the first (Rounds 1-5 above)" = 6 rounds | 1 round | yes (copied rounds) | `Second Leg ... -> six rounds` |
| cato.pdf | Feet R3 | "(Sc, Inc) - (18)" missing "x6" - designer typo | 18 (printed) | kept printed | - |
| cato.pdf, bee.pdf | all | counts match | match | - | (existing) |
| cardigan.pdf | Second Section "Next Row" | row 25 (after "Repeat Rows 5-8 ... total of 24 Rows") | row 9 | yes | `"Next Row:" after the repeat to 24 rows -> row 25` |
| cardigan.pdf | Sleeves | "Rnd 1" + "through Rnd 3" ... "until Rnd 49" = 49 rounds | 1 round | yes (maxRow 49) | `Sleeves ... -> 49 rounds, not 1` |
| cardigan.pdf | BLO rows | "blo sc" throughout | stitch records had no loop | yes (`lp: 'blo'`) | `First Section rows worked "blo sc" mark their stitches` |
| cardigan.pdf | Front Trim R3 / Sleeve Cuff R3 | no count printed | "2" (from "in next 2 sts," at a line end) | yes | `Front Trim Row 3 ... is no total of 2` |
| cardigan.pdf | Center Back R5-6 | no count (88 expected) | ~12 (row text cut at the wrap) | no | - |
| cardigan.pdf | First Section | one setup (FSC is an alternative) | two setups | no | - |
| patons mesh | sections | Ribbing 2, Body 3, Right Front 2 + Shape V-neck 4, Back 4, Shape Neck 1(+1), Left front 2 + Shape V-neck 4, Ribbing 2, Body of Sleeve 6, Shape Top 4, Band 2, buttonholes 2 | 15 sections with phantom/merged rows, unnamed blocks, "All" part | yes | new `expect`, `Back 1st row -> 22`, `"Left front: ..." names the Left Front`, `Shape Top keeps "Sizes ... only: 2nd row:"`, `"All sizes:" names no part` |
| patons mesh | SLEEVES | Make 2 implied, sub-blocks Ribbing / Body of Sleeve / Shape Top | "Sleeves" header lost; sub-blocks are separate parts | partly (sub-blocks named; no Make 2) | - |
| caron cardigan | Foundation row | one setup of 40 | a second setup "40 (...) hdc." | yes | `ONE setup of 40` |
| caron cardigan | Cardigan block | 1st row + 6 more = 7 rows | 8 (and the sleeve's rows merged in) | yes | `-> 7 rows, not 8`, new `expect` |
| caron cardigan | Shape sleeve | "1st row" restarts numbering; rows 1-24 by repeat, "Next 6 rows" = 25-30 at 88 | unnamed, row 2 "= 5" (page stamp "July 5, 2019"), Next 6 rows = 3-8, phantom "6th row" | yes | `Shape sleeve 2nd row has no total`, `"Next 6 rows" ... (25-30)`, `no phantom row 6` |
| caron cardigan | "Work a further 14 (...) rows even" | unnumbered row blocks | not counted | no | - |
| bernat basketweave | Ch 100 | foundation 100 | note | yes | `"Ch 100." is the counted foundation` |
| bernat basketweave | post stitches | Dcfp / Dcbp | plain dc on the records | yes (`post`) | `row 2 ... -> post front x4, back x4 on the records` |
| bernat lace cardigan | Body / Sleeves | foundation 17 shells; armhole & neck "Next row"s; SLEEVES 5 shells | phantom rows 6/16/28/38/44 from wrapped size lists, second setup, "first 4 (...)" read as totals, Sleeves unnamed | yes | `Body 9 rows and Sleeves 5 rows (x2)`, `one setup each`, `"first 4" is no total`, `Sleeves ... "5 (5-5-6-" / "6-7) shells."` |
| bernat lace cardigan | FINISHING page | outer edging 232 sc, sleeve edging 36 | interleaved columns (extraction) | no - extraction | see pdftext notes |
| lionbrand log cabin | block Row 1s | "(for a total of 30 (...) sc)" etc. | first pick-up count or none | yes | `each block's Row 1 is its "(for a total of N (...) sc)"` |
| lionbrand log cabin | "Rows 2-12" | 30 etc. | "~1" | yes | `"Rows 2-12 (...): Ch 1, turn, sc" / "in each st across." holds the block's 30` |
| lionbrand log cabin | shoulders | 30 29 28 26 25 24 16 8 | ~55, ~-5, 13 | yes (no negative counts) | `Left Shoulder rows 1-14 as printed`, `Right Shoulder rows 13 and 14` |
| lionbrand log cabin | Shape Shoulders | "you will have 28 (...) sts" | 13 | yes | `"... - you will have 28 (...) sts in last row"` |
| lionbrand log cabin | bands | length "19 (21, ...) in." | offered as a 19-row target | yes | `is a length, never a 19-row target` |
| lionbrand log cabin | First Block chain | ch 21 (...31) | setup 31 | yes | unit test `a chain in six sizes is 21 at size 0` |
| lionbrand log cabin | Ninth Block Row 1, Body of Sleeve increase row, "Rep last 4 (...) rows 13 (14, 15, 15," | 60, 38, 13 (...) more times | 10, ~36, times lost | no | - |
| redheart persian | Second Square | "Rnds 1-5: Work same as First Square" | one empty 5-round range | yes (copied rounds) | `carries rounds 1-5 (16, 24 ...)` |
| redheart persian | Border | no totals | 22 / 1 | yes | `the Border ... gets none (was "22", "1")` |
| redheart persian | colours | CA = Aran, CB = Burgundy, alternating rounds | all cream | yes | `"With CA" / "Attach CB" / "Attach CA" colour the motif rounds` |
| redheart persian | Second Square Make | 71 more (afghan 9 x 8) | 1 | no - only implied by the layout sentence | - |
| kingcole pumpkins | Stalk | "Repeat 2nd Row 2 more times" = 4 rows | 5 | yes | `maxRow ... each stalk to row 4` |
| kingcole pumpkins | Bodies | "approx. 44 / 56 / 84 rows" | 2 rows (suggestion only) | yes (coordinator's call) | `maxRow runs each body to its "approx. N rows"` |
| kingcole festival UK/US | rows | 175 rows, every one printed | ~128 rows; 40 lost ("Row 20 (RS) Keep RS facing...", "Row 8 Repeat Row 6..."); rows 43-44 re-worked row 35 twice; phantom 1-row parts at 120 and 154 | yes | `writes every row 1-175 and the parser finds them all`, `no phantom one-row part` |
| kingcole festival | Parts 1-6 | six instalments | 1 long part + border | no - "Part 1" is not a part name | - |
| stylecraft hood | repeat | round 3 worked 4 times (rounds 4-6) | "x3" offered, 6 rounds counted | yes | `-> round 3 worked 4 times in all, rounds 4-6` |
| stylecraft hood | Rnd 2 | 36 tr (4th side left to the maker) | 33 | yes (`closingSide`) | `[24, 36, 48, 60, 72, 84]`, widths `[16, 28, ...]` |
| stylecraft hood | colours | B, A, B, then A/B alternately (Cream, Black, ...) | all cream | yes | `"Using B" / "Using A" ... alternately` |
| stylecraft hood | Hood with Scarf | 24 motifs of 6 rounds | no part | no - it writes no rounds of its own | - |
| stylecraft cowl-mitts | lengths | scarf ~82 rows, cowl ~14 rnds (5 rows = 10x10cm) | 2 / 2 | yes | `the scarf runs to ~82 rows and the cowl to ~14 rounds` |
| stylecraft cowl-mitts | Mitts | own tension 3.5 rows = 5x5cm -> ~20 rows | 14 (document gauge) | no | noted in the fixture |
| stylecraft cabaret | "Rep rows 8-11, 29 times more" | rows 12-127 | 131 | yes | `rows 12-127, not 131` |
| stylecraft cabaret | "Rep rows 8-10 once more" | rows 128-130 | not added | no | - |
| stylecraft hex socks | rib / toe totals | "30[34:36:40:48] dc", "27[...] dc" ... | no counts | yes | `the toe's "27[30:33:36:45] dc" totals`, `rib Rnd 1` |
| stylecraft hex socks | rib | "Rep last rnd twice more" -> 5 rounds | (5) | - | `-> rib rounds 4-5` |
| stylecraft hex socks | hexagon | "6 x 3tr groups" etc. (group counts) | none | no - a group count is not a stitch total | - |
| premier throw | row 2 loops | back loop only | no loop on the records | yes (`lp`) | `row 2 ... marks every stitch lp "blo"` |
| premier wrap, hobbii, gosyo x2, magicyarn, furls | all | as printed / chart only / no text | same | - | (existing) |
| allfree ebook | Hello Kitty totals | "... = 15 sc" | computed guesses (10) | yes | `Hello Kitty Head ... totals are read as printed` |
| allfree ebook | Blush Rose Afghan, Soft Bobble, Squares Throw, Daisy, Tiger | see ground truth | "~1" guesses, unnamed parts | partly ("~1" dropped where a starred row half-reads) | unit test |
| APL scans | orr-filet4 / weldons v24 / priscilla | highest written round 15 / 27 / 68 | 22 / 27 / 67 | no (negative fixtures, caps unchanged) | (existing) |

## Rules added to `js/patterns.js`

Row detection and counts
- `OPEN_LIST_END_RE` / `unclosedBracket`: a size list broken after a HYPHEN ("3 (3-5-5-" /
  "6-6)") or broken after closing one list and opening the next is a hanging list, so the next
  line is never a bare row marker; the merge loop joins such lines (and Lion Brand's comma
  form) into the row.
- `TOTAL_LINE_RE` / `TURN_TOTAL_RE` / `strandedCount(... ended)`: a stand-alone total
  ("17 (19-21-23-27-31) shells.", "24[27:30:33:42] dc", "22 (24-...) X-sts.") after a row that
  already ended its sentence is that row's count; the lines between are merged into the row
  (fixes the fish round 7 notes landing on round 8), and `continuationCount` merges a
  total-only next line.
- `MULTI_POS_BEFORE_RE`, `PLAIN_POS_BEFORE_RE`: a number after first/last/next/each/over, or
  after a stitch name at a wrapped line end, is a position, not a total; a chain's multi-size
  bracket is never a total.
- `SQUARE_MULTI_RE`: "30[34:36:40:48] dc" sizes; `EQUALS_TAIL_RE` accepts "= 15 sc";
  `HOOK_COLON_TOTAL_RE`: "from the hook: 70sc, ch1, turn".
- `totalOfAhead` / `TOTAL_OF_RE`: "(for a total of N (...) sc)" and "you will have N (...)"
  within the row or the next five lines win over the pick-up counts.
- `ROW_REST_REF_RE` + side-tag rule in `detectMarker`: "Row 20 (RS) Keep RS facing..." and
  "Row 8 Repeat Row 6 ..." are rows without a colon.
- `WRAPPED_REF_RE` / `prevText`: a row marker on the line after a line ending in a preposition
  ("...at end of" / "6th row.", "...missed 5 sts in" / "Row 120, ...") is a reference, not a row.
- Wrapped back-reference numbers ("Repeat Rows 35 -" / "36 ..."; "Repeat Rows" / "123 - 124")
  and "...ch" / "2, skip ..." are merged.
- `LABEL_ROW_RE` split without a header: "Divide for armholes: Next row:" is a row; a
  sentence-case label becomes a Title Case header when it passes `headerInfo`
  ("Shape sleeve:" -> "Shape Sleeve"); a marker with nothing after it takes the next line.
- `SIZE_QUAL_ROW_RE`: "Sizes M, L, 2/3XL and 4/5XL only: 2nd row:" / "All sizes: 3rd row:";
  `PIECE_SUB_INSTR_RE`: "Left front: Shape V-neck and armhole: Skip next ..." names the piece;
  `TITLE_WORD` allows "V-Neck"; NON_PART gains "only"; "all sizes"/"sizes ..." name nothing;
  `INSTR_START_RE` gains "Turn work", "Change to", "Pick up", "Rejoin"; a colon label over a row
  that repeats (both fronts' "Shape V-neck only:") is not a running head.
- `CHAIN_ONLY_RE` / `MR_ONLY_RE`: "Ch 100.", "With A, ch 21 (...).", "MR with 6 sc." are counted
  foundations, and open the next part when Row/Rnd 1 follows.
- `PUBLISHER_STAMP_RE` in `isFurniture`: "CAC0129-026985M | July 5, 2019", "TITLE | CROCHET",
  "For more ideas & inspiration", lines of web addresses.
- Negative computed counts are dropped; a starred row of unknown special stitches that
  evaluates to a quarter of the row below or less is dropped; `evaluate` returns null for
  "rep from ** around" with no row below, ignores loop qualifiers (FLO/BLO/"FRONT LOOP ONLY:")
  and the closing slip stitch, and counts a row that is only its chain ("Ch71, turn." = 71).

Repeats
- `detectRepeat` records `more`; plain "Rep 3rd Rnd 3 times" after round 3 is written is
  also "3 more" (times 4). The rows a repeat adds are `times - 1` blocks: "2 more times" is 2
  rows, "29 times more" 116. "once/twice more" are read. The offered repeat and `maxRow` agree.
- A repeat in the middle of a piece (`repeatAfter`, `repeatEnd`): "Rep last 2 rows 11 times
  more" / "until there are a total of 24 Rows" move the next "Next row" past them, and the
  repeat covers the rows it follows.
- `untilRows` is never taken from a sentence that measures ("until ... measures 19 (21) in.",
  "21 1/2 in"); "approx." does not end the until-clause; `REPEAT_THROUGH_RE` / `THROUGH_NEXT_RE`:
  "through Rnd 3", "work even ... until Rnd 49" (joined across the line break).
- Coordinator's call: a row count written in an until-clause ("approx. 44 rows", "a total of
  25 Rows") now also sets `maxRow` (it was a suggestion only).

Gauge
- `G_SQ`: "5 rows = 10x10cm (4x4in)"; `GAUGE_LABEL_ONLY_RE` accepts "TENSION Scarf/cowl".

Parts, Make N, placement
- `inferPairs` (`PAIRED`, `PAIRED_PLURALS`): a part named for a paired thing (arm, leg, ear,
  eye, foot, hand, wing, horn, sleeve, cuff, ...), with no make-count, whose plural the
  pattern attaches somewhere ("Sew arms to body") is made twice; the section gets
  `makeCountInferred: true`. "First/Left/Right ..." names are excluded.
- `inlineSameAs` (`SAME_AS_RE`, `sameAsTarget`): "Rnds 1-5: Work same as First Square" is
  replaced by that part's rounds 1-5 (with its foundation when copying from round 1); "the same
  as the first (Rounds 1-5 above)" appends them renumbered. Only when every named round exists.
- `distributePlacement` host rule (`hostOf`, `FACE_DETAIL_RE`): a placing sentence that names
  the part it goes ON ("of head", "to body", "onto the body") also goes to that part; an
  unaddressed face detail (mouth, nose, eyes, cheeks...) goes to the Head rather than the
  main part; "on black eye" stays with the Eye. The mover keeps its copy.
- `carryColourKey`: the yarn key ("313 Aran CA and 376 Burgundy CB", "Colour used A Black
  1002, B Cream 1005" - `YARN_CODE_AFTER_RE` / `YARN_CODE_BEFORE_RE`, first design wins) is
  appended to every part whose rounds use its codes, as "Colours: (CA = Aran, CB = Burgundy)".

expand() (renderer / 3D requests)
- Stitch records carry `post: 'front'|'back'` (FPdc/BPdc/Dcfp/FPtr/FPdtr...) and, for rows
  phrased "in back loop only", "BLO", "Work all in Back Lps", "tbl", `lp: 'blo'|'flo'` on every
  non-chain stitch. ("join in both lps of first sc" is not a loop instruction.)
- Motif colours: codes the key defines count as colours in "Using B", "With CA", "Attach CB in
  ...", "Join C in ..." (`C_ATTACH`); the foundation line's colour applies to round 1; "changing
  from colours A to B alternately" colours a repeat's rounds in turn.
- `closingSide`: a granny round written "corner, * side, corner; rep from * 2 times more" and
  closed with only the slip stitch gets its fourth side.
- Row 1 over a counted foundation starts from that foundation (`line.prevCount`) when the caller
  has no row 0.

workMode
- An "R"-labelled line that ends by turning, with no join, is a row; when half or more of the
  R lines do, the part is rows. Joined-and-turned rounds stay rounds. (The 3D agent's
  store-side workaround can be removed - see below.)

## Still wrong, and why

- Designer errors kept as printed (the model has no `deviation` flag): Baphomet Body/Head R29
  "(2sc, dec)x8 [36]" (x12 intended); Cato Feet R3 "(Sc, Inc) - (18)" (x6 missing); AllFree
  Broomstick Row 138 "1 st" (arith 2). Printed-value inconsistencies noted by the readers:
  Caron back neck "79-79" (77 expected), Wheat Stitch Second Section 2X target 42 (40 expected),
  Patons Left front repeat "1 (2-1-2-1-2)" vs Right front "1 (2-1-2-1-3)".
- Caron: "Work a further 14 (16-16-20-24-28) rows even in pat." blocks are unnumbered and not
  counted; the Shape Left Sleeve's two "Next row"s sit in the Shape Sleeve part.
- Cardigan: Center Back rows 5-6 read ~12 (the row wraps into a lowercase line the merge does
  not take - a general "lowercase line continues the row" rule broke the two-column bee and the
  knitting negatives, so it was reverted); First Section has two setups (the FSC alternative).
- Patons: the SLEEVES heading is lost to its "Ribbing:" sub-block, so the sleeve parts carry no
  Make 2; the Back's second-shoulder row is unlabelled; the Band parts are unnamed.
- Lion Brand: Ninth Block Row 1 (60) reads 10; Body of Sleeve "Increase row" reads ~36 (38);
  "Rep last 4 (...) rows 13 (14, 15, 15," / "16, 17) more times" loses its count (the size list
  wraps inside the times clause).
- Stylecraft Mitts use their own tension (3.5 rows = 5x5cm, ~20 rows); the document gauge (5
  rows = 10cm) gives 14. Cabaret's second repeat "Rep rows 8-10 once more" (rows 128-130) is not
  added. Hexagon totals are group counts ("6 x 3tr groups") and stay null.
- Persian Tiles: the 71 further squares are only implied ("9 squares long by 8 squares wide").
- King Cole Festival: "Part 1..6" instalments are not part names, so the blanket is one part of
  175 rows plus the border; the US edition finds 174 of the rows (one row is printed in a
  different column order there).
- Turtle: the assembly says "legs" for the Feet, so the Feet get no placing note.
- Snowman Hat/Scarf colours are encoded in bold vs regular type only.
- AllFree ebook: many parts of the ten designs are unnamed or run into each other (Blush Rose,
  Soft Bobble, Squares Throw, Daisy, Year of the Tiger); only the clear count bugs were fixed.
- APL OCR scans: rows are counted from OCR noise ("1st 4 Rows", "Sd" for 3d); the negative
  fixtures' caps are unchanged.

## Decisions for the coordinator

1. Placement host rule: a sentence that names its host now goes to BOTH the moving part and the
   host (the mover's sheet still says where it goes). The app-shell request read as "host
   instead of mover"; if duplicates are unwanted, drop the `add(ix, ...)` half of `addWithHost`
   in `distributePlacement`. Three older unit tests were updated to the both-parts reading.
2. `suggestions.repeat.times` now always counts the written block too ("Rep 3rd Rnd 3 times"
   after round 3 -> 4), matching how `Store.applySuggestions` reads `times` (rows start-end
   worked `times` times). A plain "Repeat Rows 5-8 six times" printed BEFORE rows 5-8 exist
   keeps 6.
3. `maxRow` now follows a designer's "approx. N rows" / "until there are a total of N Rows" (was
   a suggestion only) - as requested from the 3D review.
4. `makeCountInferred` is a new optional field on `splitSections()` sections; the app may want to
   show "made twice (from the assembly text)".
5. Copied rounds ("same as First Square") and the "Colours: (...)" key line are written into the
   part's `text` - they are visible to the maker in the pattern sheet.

## For the owner of js/store.js

- The workMode workaround in the diagram-model section can go: `Patterns.workMode` now returns
  `'rows'` for the snowman Scarf ("R1: Ch71, turn." / "R2: ... ch1, turn") and still
  `'rounds'` for joined-and-turned rounds.
- `Patterns.expand` stitch records now carry `post` and `lp` (optional fields); pass them
  through to the model as the renderer expects.
- Sections may carry `makeCountInferred: true`.

## For the owner of js/pdftext.js

- `crochet-bernat-lace-cardigan.pdf`, page 3: two text columns and the stitch-diagram labels
  come out interleaved line by line, e.g. "Shape top: Next row: Ch 3 Next rnd: Ch 1. 1 sc in same
  sp as" / "DIAGRAM" / "(counts as dc). (Yoh and draw up sl st. *Miss next 3 sc. (1 dc. Ch 2." and
  "1st rnd: Ch 1. 1 sc in same sp as FOUNDATION" / "markers along back and front" / "ROW". The
  FINISHING column (Outer edging 232 sc, Sleeve edging 36 sc) cannot be read; the parser makes
  phantom rows 16, 38 and 44 out of it.
- `crochet-bernat-basketweave.pdf`, page 1: the materials column's "or size" is printed inside
  the 1st row: "1st row: (RS). 1 dc in 4th ch from" / "or size" / "hook (counts as 2 dc)...".
- `crochet-redheart-persian-tiles.pdf`, page 1 foot / page 2 head: "For more ideas & inspiration
  -", "www.redheart.com www.coatsandclark.com", "www.crochettoday.com
  www.knitandcrochettoday.com" and the running head "PERSIAN TILES AFGHAN | CROCHET" arrive in
  the middle of BORDER Rnd 1 (the parser now drops them as furniture).
- `crochet-caron-cuff-cardigan.pdf` / `crochet-patons-mesh-cardigan.pdf`: the page stamp
  "CAC0129-026985M | July 5, 2019" / "PAC0129-034206M | April 12, 2026" and "| CROCHET" arrive
  as text lines between rows (parser drops them now).
- `tmp-pdf/bear.txt` (the old text fixture) has the ligature split "the same as the fi rst"
  (line 91); the PDF extraction itself is fine.
- Mid-wave, while `pdftext.js` was being edited, `test/patterns.test.html` showed the
  `columns:` tests failing (all six, later one: "a sideways block on an UPRIGHT page is left
  upright" - got "Anchor 387 311 313"), and fresh extractions briefly returned "Couldn't read
  that PDF" for the Caron and Bernat lace cardigans and let the Baphomet photo captions through.
  At the end only the sideways-block test still fails.
- Two fixture expectations follow the new extractor and should be confirmed: 
  `crochet-lionbrand-logcabin-pullover.pdf` now reports page 7 image-only (correct - it is the
  schematic image), and `other-apl-tatting-riego.pdf` reports pages 2, 6 and 17 image-only
  (pages 2 and 6 now carry no text, page 17 only its page number "15").

## Follow-up: closing the "still wrong" list (coordinator round 2)

Decisions 1-5 were accepted as written; item 6 went to the store owner.

| item | PDF says | app said | now | assertion |
|---|---|---|---|---|
| (a) Caron "Work a further 14 (16-16-20-24-28) rows even in pat." (x3) and "Work 1 row even in pat." | rows of the piece | not counted | read as repeats of the row just worked (`WORK_FURTHER_RE`, the size list wrapped onto "rows even" is joined); the Next rows after them are numbered past them; Shape Sleeve runs to row 81 | `caron: the three "Work a further N (...) rows even" blocks...`, `Shape back neck "Next row" ... -> row 47`, `Shape Sleeve runs to row 81` |
| (b) Wheat Stitch Center Back rows 5-6 | 88 | ~12 | 88 - a wrapped line starting "work across ..." or naming "the remaining sts" continues the row | `Center Back rows 5-6 ... come to 88` |
| (c) Lion Brand Ninth Block Row 1 | 60 | 10 | 60 - "(for a total of ...)" is looked for up to 8 printed lines below the row (five pick-up segments) | block Row 1 list now includes the Ninth Block |
| (d) Stylecraft Cabaret "Rep rows 8-10 once more" | rows 128-130 | not added | a second repeat after the last written row follows the first (`tailEnd`); maxRow 130 | `cabaret: ... 130 rows` |
| (e) Stylecraft mitts tension | "Mitts 1 patt rep and 3.5 rows = 5x5cm" -> ~20 rows | 14 (the scarf's 5 rows = 10x10cm) | `gauge(text, partName)` reads the piece labels in a tension box ("TENSION Scarf/cowl", "Mitts"); the length is resolved, and the gauge line carried onto the part, with the part's own line; mitts 20 | `scarf ~82 rows and cowl ~14 rounds ..., mitts ~20 rows on their OWN ...`, `the Mitts part carries its own tension line` |
| (f) Patons SLEEVES | the sleeve blocks belong to SLEEVES, made twice | "Ribbing", "Body Of Sleeve", "Shape Top" x1 | a capitals piece heading whose first block names itself on its own line ("SLEEVES" / "Ribbing: With smaller hook...") names its blocks "Sleeves: Ribbing", "Sleeves: Body Of Sleeve", "Sleeves: Shape Top" until the next capitals heading (FINISHING); `inferPairs` reads the piece part of the name, and "Sew in sleeves" makes all three x2 | new Patons `expect`, `the SLEEVES heading names its three blocks ... makes each twice`, `the FINISHING heading ends the sleeves` |
| (g) AllFree ebook | ten designs | partly split | general rules only: Soft Bobble Afghan is one 10-row part (a wrapped "(Ch" / "1. Miss next ch" no longer opens a phantom row 1); "FIRST SQUARE 1" names the Beginner Granny's first square; three-word numbered tutorial steps ("1. Start with a chain.", "4. Hook onto the yarn.") are no rows; "~1" guesses on the Blush Rose Afghan rows are dropped (a computed total of a quarter of the row below or less, on a row that does not decrease or leave stitches, is a misreading) | `the Soft Bobble Afghan is one part of ten written rows`, `"FIRST SQUARE 1" heading names its part`, `the tutorials' numbered steps ... are no rows` |
| designer errors | Baphomet R29 makes 24 as written, printed 36; Cato Feet R3 "(Sc, Inc)" makes 3, printed 18; Broomstick Row 138 makes 2, printed "1 st" | printed only (Row 138: no count at all) | the printed total is kept and a `deviation: {printed, computed}` is put on the parse line; `expand()` returns `deviation: {printed, computed, delta}` for that round (the round is still drawn at the printed total). Flagged only for rounds in the plain sc/inc/dec arithmetic `evaluate()` reads exactly (`PLAIN_ARITH_RE`), so the whole corpus raises exactly these three. "sc2tog-1 st." is read as a printed 1 | `R29 ... keeps 36 and says the words make 24`, `expand() draws R29 at the printed 36 and carries the deviation`, `...no other round has one`, `Feet R3 ... flagged`, `Broomstick Row 138 ... flags that it makes 2` |

New rules in `js/patterns.js`: `WORK_FURTHER_RE` (+ the line join in `prepareLines`); the
"remaining sts" / "work across" continuation; `TOTAL_OF_LOOKAHEAD = 8`; `tailEnd` chaining of
tail repeats; `gauge(text, forName)` with tension-box piece labels, used by the length
resolution and by `carryGauge`; `pieceParent` / `adoptParent` / `PIECE_CAPS_RE` with the
"Parent: Block" naming and the parent-aware `inferPairs`; the bare-marker rule for a line
that broke after "(Ch" / "skip" / "miss"; `PROSE_MIN_WORDS` 3 with a back-reference
exception; the stray footnote digit after a capitals heading; the generalised "quarter of the
row below" guard; `DASH_GLUED_RE`; mid-row "working in front loops only" and a trailing "-"
ignored by `evaluate()`; `PLAIN_ARITH_RE` and the `deviation` record on lines and in
`expand()`.

### For the owner of js/store.js (roundDeviation)

`roundDeviation(prt)` compares the pattern's count with the stitches tapped. The designer's
own error is a different thing, so it is offered beside it rather than inside it:
`Patterns.parse` lines carry `deviation: { printed, computed }` and `Patterns.expand(...)`
returns `deviation: { printed, computed, delta }` (delta = printed - computed) for such a
round, absent otherwise. `expected` stays the printed total (what the pattern says);
`roundDeviation` can add e.g. `designer: ex.deviation || null` from the round's expand result
and the UI can say "the pattern prints 36 here; its own stitches make 24". The diagram model
can surface it the same way it surfaces `outlier`.

### Still open after the follow-up

- AllFree: Princess Leg (x2), the Elegant Sport Shawl and the Broomstick Motif (make 19)
  still come out unnamed (their headings are design titles or lowercase labels the general
  rules do not accept); the Frog's "Work same as Princess Rnds 1-26" names a design, not a
  part, so nothing is copied; the Crazy Shell tutorial keeps four step lines that carry a
  stitch abbreviation; one Daisy "2nd rnd" arrives on a tutorial page (extraction order).
- Caron: "Cont even in pat until work from beg measures 13"" in the middle of the sleeve is a
  length without a gauge line for this piece, so the rows after it are numbered from the last
  counted row.
- Suites after the follow-up: patterns 976 / 0 (the PdfText column test passes again),
  patterns.fixtures 780 / 0 fresh and 795 / 0 with `?heavy=1` (fresh cache each), templates
  94 / 0, crafts 124 / 0, diagram-model 521 / 0.
