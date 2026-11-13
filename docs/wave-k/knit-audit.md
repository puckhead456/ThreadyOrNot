# Wave K — knit-audit report

Owner (from this worker on): `js/app-knitting.js`, `css/knitting.css`, `test/knit-ui.test.html`,
`test/knit-ui.shots.html`; append-only groups in `test/knits.journey.html` (marked "knit-audit").
Everything else read-only; defects there are under "For the owner of <file>".

How the walks were done: one Browser-pane tab (`tab-3`), store key `stitchkeeper-wavek-knitaudit`,
375 × 812. Each fixture imported the way a user does: ＋ New project → 🧣 Knitting → a real `File`
on the drop zone's input → the size chip → Save. Rows worked with the real `#row-plus` button,
stretches ended with the card's own "I’m at the length" button. What the screen showed was read
from the DOM (row label, pattern tag, pattern line, every visible chip in `.knit-extra`, stitch
readout, marker strip) for every row.

## Baseline (before my first edit, headless, 2026-11-13)

| suite | baseline |
|---|---|
| knit-ui.test | 112 / 0 |
| knit-counter.test | 388 / 0 |
| knits.test | 461 / 0 |
| knits.journey | 66 / 0 |
| knit-chart.test | 151 / 0 |
| crafts.test | 281 / 0 |

## Now (end of this session)

| suite | baseline | now |
|---|---|---|
| knit-ui.test | 112 / 0 | **131 / 0** (+17 in group 10 "knit-audit fixes", 2 old expectations re-worded) |
| knits.journey | 66 / 0 | 66 / 0 (no journey groups added yet: see "Not done") |
| knit-counter.test | 388 / 0 | 388 / 0 |
| crafts.test | 281 / 0 | 288 / 0 (shell-ui's additions) |
| knits.test / knit-chart.test | 461 / 151 | not touched by my files; not re-run |

## E1..E20 through the real app (one tab, 375 × 812, Stardrop Night)

| E | now | what the screen says now |
|---|---|---|
| E1 boyfriend Front raglan before the stretch | **fixed** | row 24 is "Cont even in pat … same length as Back", the raglan cast-off comes after "I’m at the length" (89 sts L) |
| E2 panel/chart rows frozen in a stretch | **fixed** (store) | boyfriend "C 5/6 · B 1/4 · A 5/22" moves every row; TT Foot chart 1…12, 1 |
| E3 wrong "of N" | **partly** | panels right; new wrong ones: Stranded Foot "Chart · row 10 of 10" (Instep is 26), TT "Foot · row 1 of 1" before the scan, Icelandic "Chart D · row 65 of 64" |
| E4 repeat shows the sentence | **fixed, with two new wrong cases** | Bernat sleeve/yoke resolved ✓; boyfriend Front stretch showed "4th row" on every row, TT toe and Sandnes raglan showed a set-up / short-row line as "rnd 1 of 2": guarded in my file, root cause in the store |
| E5 markers | **partly** | Bernat neck rows 1–7 ✓, Sandnes 12 ◉ 8 ◉ … ✓; not carried into Bernat's yoke rounds; lone BOR / toe markers say "Markers set on a N-st row" every round |
| E6 no target from length | **fixed** | stretch card, "Use ≈ N", "I’m at the length", "I measured"; TT "from tip of toe" estimate ignores the toe's rounds (≈ wrong) |
| E7 long stretch is one row | **fixed** | Sandnes rib is its own stretch; Stranded Leg 84 rounds; **not** TT Leg (60 chart rounds missing) nor boyfriend Sleeve rib (on the cast-on line) |
| E8 stitch total lost | **fixed** | "216 sts at the end" |
| E9 make-counts | **fixed** | Sleeves ×2, sock parts ×2 |
| E10 part names | **partly** | TT/Stranded parts named by piece ✓; Bernat "Part 1/2", boyfriend 8 tabs, Icelandic "Shawl" + "Part 2", Sandnes Children + Ladies both imported |
| E11 book gauge | **fixed** for TT (32 × 46); Icelandic has none printed (honest) |
| E12 book import | **mostly fixed** | 10 lace patterns listed (Arrowhead "not read"), the open tab is imported, own charts only; **still**: a one-size book pattern shows the book's first sizes ("ROUND · 7"" on Stranded Boot, "26"" on Icelandic and the hat) |
| E13 round vs row | **still wrong** | TT Foot "ROW · RS?"; Heel Flap/Leg chart rows "ROW"; my chart sheet now reads it in the round |
| E14 chart shown not followed | **fixed for read charts** | band, direction, tap a cell; direction was wrong in a round part (fixed) |
| E15 colourwork | **fixed** | Stranded Leg "MC 13 · CC 1 · … ×3 · longest float 13: catch it" |
| E16 3D | not walked (no time) | |
| E17 short rows | still good | TT heel 16 short rows, Sandnes German short rows |
| E18 honest failures | **fixed** (knit-parse) | lookbook notice, no UK-terms chip (not re-walked) |
| E19 "at the same time" | **not on screen** | boyfriend F23 is an open stretch with no shaping card (no start count); saddle cardigan imports as 2 rows; Heathers fronts stop at row 9 — no fixture reached the P6 card in the app |
| E20 reversing shaping | **partly** | Red Heart: new "↔ Make the Left Front from this, mirrored" (mine); bind-off rows mirror to "at end of next row" (wrong, knit-parse) — now left as printed and flagged |

## Fixed in my files (each with an assertion in knit-ui.test group 10 unless said)

1. **Evenly suggestion from the wrong count** (worst: a wrong instruction). "inc 8 sts evenly across last row. 93 sts" said "from 93 sts" (makes 101); now worked back from the printed total (85 → 93) and says "for the last row of this stretch"; a suggestion that would not reach the printed total is not shown.
2. **Resolved repeat guard**: never show one row for a whole "cont in pat" stretch, a row whose printed side is not the side worked, a marker set-up / cast-on round as a repeated round, or a short row ("turn") as a plain round in a round part. Chips then read the sentence on screen.
3. **Stretch card**: "N sts at the end" (the count a stretch prints is its end); count-ended stretches say "until you have 61 sts" and the button is "I have 61 sts" (no "I measured").
4. **"repeat 1 of 1"** dropped ("3rd row: As 1st row").
5. **Past the end of a part** (store leaves no target after its stretches end): "The pattern’s rows for Front end at row 100. It carries on in Front (continued)." + "Go to Front (continued)"; a gap inside a part is not taken for its end; the stale length chip is removed there.
6. **Round parts with an unknown side**: chart sheet direction "read right to left (in the round)" and "rnd" words (was "left to right (WS)").
7. **Missing twin front (P12)**: "Work same as Right Front, reversing all shaping" inside the Right Front's own text → "↔ Make the Left Front from this, mirrored" → a new part, every row labelled worked out by the app; two-step Undo from the toast.
8. **Mirror guard**: a mirrored "bind off … at end of next row" is left as printed with "mirror this yourself". The ". 29 sts." workaround stays (knit-parse's fix covers "—43 sts." and "(38 sts)." only; asserted).
9. **Materials card**: plain words ("double-pointed", "24 in long"), printed line cut at a word (no "[61"). Checked on real data: Bernat M "2 balls (size M)", US 8 & 10 circular, US 9 & 10 dpn; Red Heart 44" "4 skeins (size 44")", US 9.

## Pattern walks

### Patons boyfriend, size L (research §10)

Parts on import: Back, Back (continued), Back (continued 2), Front, Front (continued), Shape Neck,
Sleeves ×2, Sleeves (continued) ×2 — 8 tabs for 3 pieces (E10 still). Project is named after the
file ("knit-patons-boyfriend-cable"), not the pattern.

| part | row | pattern says | app shows | class | owner |
|---|---|---|---|---|---|
| Front | 1–20 (rib stretch) | F16 "… inc 8 sts evenly across last row. 81 (85-93-…) sts" — L is 85 → 93 | "Suggestion, worked out by the app from 93 sts: K5, M1, (k11, M1) 7 times, k11." on every rib row — that makes 101, a wrong instruction | **wrong** | mine (fixed) |
| Front | 1–20 | rib rows alternate RS/WS | "RS?" on every row | wrong side | store (`sideInfo` in a stretch) |
| Front | 1 | "Work from ** to ** as given for Back" (cast on 85, rib rows 1–2) | not shown anywhere on the counter; row 1 is already the stretch | gap | parser / store |
| Front | stretch card | rib on 85 sts, 93 after the last row | "· 93 sts" on every row of the rib | misleading | mine (fixed: "93 sts at the end") |
| Front | 24 → (the "Cont even in pat … same length as Back" stretch) | rows 1–4 of the panel pattern, repeated | **"4th row: P0 (2-2-2-0-2) …" on every row** (RS rows too), tag "Stretch · row 1 · repeat 2", "repeat 3", … — the resolved-repeat line names one WS row for the whole stretch | **wrong** | parser (`repeatOf: [23]`, should be the 4 pattern rows) + store (`lineInfo` n = 1); UI guard added (mine) |
| Front | 24 → | Panel A crosses every RS row | cable ring "cable in 1" on every row, never "cable row" inside the stretch | wrong | store (`cableInfo` in a stretch) |
| Front | 24 → | panels | "▦ C 5/6 · B 1/4 · A 5/22" and on: right (E2/E3 fixed) | ok | |
| Front | 99–100 | F7 raglan cast-off, 89 sts (L) | right, after "I’m at the length" | ok (E1 fixed) | |
| Front | 101 → | the Front goes on in "Front (continued)" | blank counter, no target, part never finishes, nothing says "go to Front (continued)" | silent | store (`targetRows` stays null after the last stretch ends); UI note added (mine) |
| Front (continued) | 1–36 | F20/F21: 89 → 59 → 43 | resolved rows right, "repeat 2 of 5 · row 1 of 4" right, 36 rows ✓ | ok | |
| Front (continued) | all | RS/WS alternate | "RS?" on every row | wrong side | store |
| Front (continued) | 3 | "3rd row: As 1st row." | tag "repeat 1 of 1" | noise | mine (fixed) |
| Shape Neck | 1 | F22: 10 sts on the left side | "count unknown" | gap | parser (count of a "Turn" row) |
| Shape Neck | 2 → | F23 AT SAME TIME: 4 neck rows, raglan on alt rows, to 4 sts | an open stretch "until 4 sts remain" with **"I’m at the length"** and no shaping card (no start count) | gap + wrong wording | parser (start count) / mine (button wording fixed) |
| Shape Neck | 28 | F25 "With RS facing, slip center 21 sts … Join yarn …" | "Join yarn to rem sts…" labelled **WS** (the second side starts on a RS row); "slip centre 21 sts" dropped | wrong side | parser / store |
| Sleeves | rib | F30 "Work 2½" … in Twisted Ribbing … inc 2 (2-2-4…) sts evenly" (≈ 12 rows) | not on the counter: row 1 is already the panel row 1 (the rib stretch sits on the cast-on line, `within`) | gap | store (`stretch.within` ignored) |
| Sleeves | 5 → | F32 to 45 (L), then F33 "Inc 1 st each end of every following 6th row until there are (61-63-65) sts" | one open stretch "until 61 sts remain" (F32 not seen separately); no shaping card ("every following 6th row" has no start count); "remain" for an increase | gap + wrong word | parser/store (P6 not closed); mine (wording fixed: "until you have 61 sts", button "I have 61 sts") |
| Sleeves | 25 → | F34 17½" (L) | "row 1 of ≈ 64 · about row 88" (17½ × 20 / 4 = 87.5 from the cast-on) | ok | |
| Sleeves | 89–94 | raglans 61 → 57 → … | right; then blank from row 95 (Sleeves (continued) carries on) | silent | store; UI note added (mine) |

### Bernat top-down raglan, size M (research §1)

Parts: Part 1 (8), Part 2, Body, Sleeves ×2, Neckband (7). Gauge 12 × 17 / 4 in ✓, sizes ✓.

| part | row | pattern says | app shows | class | owner |
|---|---|---|---|---|---|
| Part 1 | 1, 3, 5, 7 | markers 1\|2\|4\|2\|20\|2\|4\|2\|1, +8 each inc row (M) | 1\|2\|4\|2\|20…, 2\|2\|6\|2\|22…, 3\|2\|8\|2\|24…, 4\|2\|10\|2\|26… "moved with this row’s increases" | ok (E5 fixed on Bernat) | |
| Part 1 | 3, 5, 7 | — | stitch readout "Before group 1 · stitch 0 of 1" / "of 8" | jargon | app.js (repeat-group readout) |
| Part 1 | 8 | B7 cast on 18, join, 80 sts | "Markers set on a 38-st row · this row makes 80" (honest) | ok | |
| Part 2 | 1 → | 8 raglan markers carried on | no marker strip at all | gap (known) | store |
| Part 2 | 3–34 | B10: rnd 1 knit / rnd 2 inc, 17 times (M) | "repeat 2 of 17 · rnd 1 of 2" with the 1st / 2nd rnd words ✓ (E4 fixed) | ok | |
| Part 2 | 35 → | B14 "Cont even … on 216 sts until … 9" from front neck" | "Stretch · rnd 1 of ≈ 4 · 9 in … about rnd 38 · 216 sts at the end" ✓ (34 rnds ≈ 8 in from the front neck) | ok (E8 fixed) | |
| Part 2 | 39 | B15 divide round, 128 sts | right; then the new past-the-end note "carries on in Body" | ok | |
| Body | | 12" stretch, then rib 2" further | both stretches ✓, "BOR carried on from Part 2" ✓ | ok | |
| Body / Sleeves | after the last stretch | — | the old "📏 2 in ≈ 9 rows" chip stays next to the end note ("rows" in rounds) | noise | mine (removed past the end); app.js ("rows" in a round part) |
| Sleeves | 1 → | B20 3" ≈ 13 rnds, dec rnd + 5 even, ×9 (M) → 30 | stretch ✓; "repeat 2 of 9 · rnd 1 of 6" = dec rnd, "rnd 2 of 6" = Knit 5 even ✓; 30 at the end ✓ (E4, E6 fixed) | ok | |
| Sleeves | every round | one BOR marker | "▲ BOR Markers set on a 48-st row · this row makes 46" on every decrease round | noise | store (`markerInfo`: a lone BOR marker is never "unplaced") |
| Sleeves / Cuff | "Knit 5 rnds even" | rounds | chip "↕ 5 rows" | wrong word | app.js |
| Materials | | M: 2 balls Terracotta Rose; 5 + 6 mm 24" circular, 5.5 + 6 mm dpn | "2 balls (size M)", "US 8 and US 10 · circular 24 in", "US 9 and US 10 · dpn" ✓; the printed line cut mid-bracket ("24\" [61") | ok, rough | mine (fixed: "double-pointed", "24 in long", cut at a word) |

### 8-socks book, Time Traveler, 8½" (research §2a)

Book tab "Time Traveler Socks", size 8½". Parts Toe, Foot, Gusset, Turn Heel, Heel Flap, Leg, Cuff,
all ×2 (E9 fixed); gauge 32 × 46 / 4 in (E11 fixed); no "Knits" part (E10 fixed); only its own charts
kept: Foot, Leg 7" / 8½" / 9½" on pp. 6–7 (E12 fixed). With the rAF shim in my (hidden) tab the
chart scan read all four with cells.

| part | row | pattern says | app shows | class | owner |
|---|---|---|---|---|---|
| Toe | 1 | T2 set-up rnd, 4 markers | 1\|12\|2\|12\|1 (28) ✓ | ok | |
| Toe | 3, 5, … 19 | T4 "rep Inc rnd every other rnd 9 more times": a plain round, then the Inc rnd | **"rnd 1 of 2" = "Next rnd *K1, pm, k10 (12, 14), pm, k1 …"**, the marker set-up round, on every repeat | **wrong** | store (`lineInfo` reads "every other rnd" as "last 2 rnds"); UI guard added (mine: a set-up round is never shown as a repeated row) |
| Toe | 2 → | 4 toe markers moving | "Markers set on a 28-st row · this row makes 32 / 36 …" on every round | honest, noisy | store |
| Foot | all | worked in rounds | label "ROW", "RS?" (E13 **still wrong** on screen; the journey's E13 check reads `sideInfo` on row 2 only) | wrong side | parser/store (`rowWord` of a part with only "Next rnd" + "Cont in patt"); mine: chart direction and words read "rnd" when the part only speaks of rounds |
| Foot | chart sheet, row 4 | in the round: right to left | "Row 4 is marked, read left to right (WS)" | **wrong** | mine (fixed) |
| Foot | 1 → (stretch) | Foot chart 12 rnds, repeating | "▦ Foot · row 1 of 12", 2 … 12, 1 ✓ (E2 fixed for a chart in a stretch). Before the scan landed: "row 1 of 1", then "row ?" | ok; wrong before the scan | store ("of 1" with no chart) |
| Foot | stretch | 7¼" **from tip of toe** = 83 rnds from the tip, ≈ 62 after the 21 toe rounds | "row 1 of ≈ 83 · about row 84" (the toe's rounds not counted) | wrong estimate (≈) | store (`untilInfo` "from tip of toe" across parts) |
| Gusset | 1–12 | T9/T10 6 × 2 rnds (8½") | ✓ | ok | |
| Turn Heel | short rows 1–16 | T11–T14 4 + 6 × 2 | ✓ | ok (E17) | |
| Heel Flap | 1–18 | T15–T17 rows 1–4 + 7 × 2, −1 each | counted as "SHORT ROW 1 … 18", no counts | ok, rough | |
| Leg | 2 | "Work even through Row 11 of Foot chart" | "▦ Foot · row 1 of 12" (the chart does not restart; the row is not known) | wrong | store |
| Leg | 14 → | T19 "work Rows 1–12 of Leg chart for your size 5 times" = 60 rnds | rnds 14–16, 18–20 blank; chart rows 6 and 10 as lone rows 17 and 21 ("ROW · RS?"); the 60 rounds are not numbered | **gap** (P5 for TT, known) | parser/store |
| Cuff | 1, 10 | "Knit 8 rnds", "Knit 7 rnds" | chip "↕ 8 rows" | wrong word | app.js |
| Cuff | 9 | eyelet rnd +1 → 64 | readout "Before group 1 · stitch 0 of 1"; markers "set on a 63-st row" | jargon | app.js / store |

### 8-socks book, Stranded Boot Stockings (research §2h)

Parts Cuff, Leg, Heel (24), Turn Heel (13), Gusset (12), Foot, all ×2. Charts Leg 84 × 28 and
Instep 26 × 31 read with cells.

| part | row | pattern says | app shows | class | owner |
|---|---|---|---|---|---|
| all | row label | one size | "ROUND · 7"": Time Traveler's first size on a one-size pattern | wrong | app.js / store (book sizes per pattern) |
| Cuff | stretch | "CO 84 sts … pm, and join in the rnd—28 sts each needle. Work in corrugated rib … until 3"" | the line starts mid-sentence ("marker (pm), and join in the rnd-28 sts each needle. Work in…"); the cast-on is lost | gap | parser |
| Leg | 1–84 | H1, chart 84 rnds, 84 → 60 | 84 numbered rounds, chart row = round ✓; colours "MC 13 · CC 1 · MC 1 · CC 1 · MC 11 · CC 1 · ×3 · longest float 13: catch it" ✓ (E7, E15 fixed) | ok | |
| Leg | rounds with unread cells | — | "· repeat · 2 cells not read (?)" (no ×N): honest | ok | |
| Leg | every round | — | "🎨 Use the chart’s colours (MC)" on all 84 rounds | clutter | mine (see "Look") |
| Heel | 1–24 | H3–H6 | ✓ 4 × 6 rows | ok | |
| Turn Heel | 1–12, 13 | written out, −1 each; then the gusset set-up | ✓ as short rows; row 13 = set-up with 🧮 Pick-up helper ✓ | ok | |
| Foot | stretch | "until 7" from back of heel … ending with chart Rnd 10" (Instep chart 26 rnds) | "▦ Chart · row 10 of 10" | **wrong** | store (length from "Rnd 10", name "Chart") |
| Foot (toe) | | 3 × (dec + even), 3 single dec rnds, rep 2 × 2 → 18 | structure ✓, counts mostly "count unknown" | gap | parser |

### Lace book, Icelandic shawl (research §4d) — one size

Parts "Shawl", "Part 2", "Lace Border"; charts A–F read with cells; no gauge (none printed ✓).

| part | row | pattern says | app shows | class | owner |
|---|---|---|---|---|---|
| all | label | one size; odd rows WS in the body (IC1) | "ROW · 26"" (Sophia's size), "RS?" on every row | wrong | app.js/store; store (side) |
| Shawl | 1–12 | IC1 "Rows 1, 3, and 5 … See Chart A for Rows 2-12." | the sentence split: odd rows show "Rows 1, 3, and 5 … See Chart A for", even rows show "Rows 2-12 ."; the real rows 2–12 are in "Part 2", which numbers from 1 again | **wrong** | parser |
| Part 2 | 15, 17 … 35 | IC4 "Row 15 and all following odd rows" | chip "Chart B · row 15 of 36" on rows 17, 19 … | **wrong chart row** | store |
| Part 2 | 40 | IC5 "Rows 38 and 40" | chip "Chart C · row 38" | wrong chart row | store |
| Part 2 | 66, 68 … | IC7 repeat rows 63–64 | chip "Chart D · row 65 of 64" | **wrong** | store |
| Part 2 | 124, 126 | 5, 3 sts | ✓ | ok | |
| Lace Border | even rows | "Row 2 and every following even-numbered row" | blank rows | gap | parser |
| Lace Border | end | crochet loop edging | an open stretch "until you have 6 sts" | wrong | parser |

### Lace book, Lace Fountain Hat (research §4h)

Rib ¾" ≈ 6 rnds ✓; Inc rnd: "Suggestion … from 124 sts: (k7, M1) 4 times, (k6, M1) 16 times" ✓ (124 + 20 = 144; before my fix this kind of line was worked from the total);
"Work 5 rnds even" ✓ (chip "↕ 5 rows": app.js word); chart rounds 1–61, 144 → 84 ✓; then the end note.
Size label "26"" (book's first size) is wrong.

### Sandnes raglan, 4 yrs (research §13)

| part | row | pattern says | app shows | class | owner |
|---|---|---|---|---|---|
| import | | Children (6 sizes) and Ladies are size groups | both groups imported: Yoke, Back And Front, Sleeves ×2 **twice**, all at "4 yrs" | wrong | app.js (size-group ticks) |
| Yoke | 1 | 7 cm rib | stretch "until it measures 7 cm · add your gauge" (only a stitch gauge is printed) ✓ honest | ok | |
| Yoke | 22 | first raglan round | "12 ◉ 8 ◉ 24 ◉ 8 ◉ 12" ✓ (E5 fixed) | ok | |
| Yoke | 23, 25 … 43 | raglan: plain rnd / inc rnd | "rnd 1 of 2" = "Work and turn 2 sts pass previous turning …" (the short-row line) | **wrong** | store (`lineInfo`); guarded (mine) |
| Sleeves | | "Rep inc every 3½ cm until 26 sts" (a decrease) | "until you have 26 sts" ✓; markers "set on a 36-st row · this row makes 2" | odd count | store |

### New fixtures

- **Cascade saddle cardigan** ("at the same time" + "Right Front: work as for left front, reversing shaping"): the
  import finds **one section of 2 rows and no sizes** — prose headings ("Left Front:", "Sleeves:") are not parts,
  "42 (46, 50)" vectors give no size chips. Nothing to walk; P6/P12 cannot be reached. Owner: knit-parse.
- **Cascade Heathers cardigan** (both fronts written: the truth for P12): parts Back, Right Front, Left Front,
  Sleeves ×2, Pocket, Pocket (continued) ✓, sizes ✓; but each front stops at row 9 ("Cont even."), a "Rnd 6:"
  stray line is a row, "Repeat these two rows as set for 4" = 39 rows" gets "📏 4 in ≈ 25 rows" (the printed 39
  ignored). The AT THE SAME TIME shaping is never reached. Owner: knit-parse.
- **Red Heart season cardigan** (44"): parts Rib, Back, Right Front ✓; Right Front has one numbered row; the new
  twin offer builds the Left Front; its first row "Bind off 7 sts at beginning of next row" mirrors to "… at end of
  next row" (knit-parse) → now flagged. Materials ✓.
- Not walked (time): stranded yoke (Cascade color yoke / Sandnes Bursfjell), intarsia skirt, Red Heart toe-up
  socks. HANDOFF/knit-ui say the picture charts there give no chart objects (knit-chart owner).

## Proposals P1..P21 (as seen through the app)

| P | verdict | note |
|---|---|---|
| P1 stretches | works but rough | right on boyfriend/Bernat; parts with no target never finish (end note added), set-up-line stretches lost (boyfriend sleeve rib) |
| P2 resolved repeat | works but rough | right on counted repeats; wrong on "cont in pat" / "every other rnd" (guarded now) |
| P3 panels | meets the bar | boyfriend, mock neck |
| P4 chart with your row | works but rough | read charts good; wrong "of N" / chart row on rule-enumerated rows (store) |
| P5 rows from charts | works but rough | Stranded Leg, lace hat ✓; TT Leg not numbered |
| P6 shaping | wrong / not reached | no real fixture shows the card (start counts missing, cardigans not parsed) |
| P7 book import | works but rough | one-size patterns inherit the book's sizes |
| P8 pairs | meets the bar | |
| P9 markers | works but rough | Bernat/Sandnes ✓; lone markers noisy, not carried into the yoke |
| P10 I measured | not walked on a real stretch beyond the card | |
| P11 colourwork | meets the bar (Stranded Leg) | key-colour chip repeats on every round |
| P12 mirror | works but rough | twin offer added; bind-off mirror wrong in knit-parse (flagged) |
| P13 tap a repeat | works but rough | readout "Before group 1 · stitch 0 of 1" is jargon (app.js) |
| P14 clicker | not walked | |
| P15 calculators | was wrong, fixed | evenly from the printed total; pick-up helper ✓ |
| P16 terms chip | works but rough | shows K, P, Pat for patterns that define them |
| P17 schematic | not walked | |
| P18 whole piece 3D | not walked | |
| P19 row notes | not walked | |
| P20 materials | meets the bar on Bernat / Red Heart | |
| P21 journey | works | 66 assertions; my walks not yet added as journey groups |

## For the owner of `js/store.js` (knit-store), ranked by harm

1. **`lineInfo` on "rep Inc rnd every other rnd" / "inc … every other rnd" (TT toe T4, Sandnes yoke)** resolves "rnd 1 of 2" to the line
   *before* the inc round (the marker set-up round; the short-row line) — a wrong instruction. "Every other rnd" means one plain round,
   then the named round: resolve rnd 1 of 2 as a plain round (or return `via: null`). The UI now refuses set-up / short-row lines, but any
   other line before the inc round would still show.
2. **`lineInfo` on a "Cont even in pat until …" stretch with `repeatOf` of one row** (boyfriend Front F16→F17, `repeatOf: [23]`) gives
   n = 1 and the 4th pattern row for every stretch row; with `repeatOf` of one line inside a stretch return `via: null` (or the 4 pattern rows,
   when the parser gives them).
3. **`knitSyncTarget`**: a part imported with no `targetRows` (it had a "work until" line) never gets `phaseTarget`, so after every stretch is
   ended it has no target, never finishes, and rows past its end are blank (boyfriend Front, Bernat Part 2/Body/Sleeves, TT Foot …).
   When no stretch is open, set the target to the last numbered row.
4. **`chartInfo` row on rule-enumerated and repeated rows** (Icelandic): "Row 15 and all following odd-numbered rows" → row 15 on rows 17, 19…;
   "Rows 38 and 40" → 38 on row 40; "Repeat Rows 63 and 64" → "row 65 of 64". Use the garment row inside the enumeration; never a row past `of`.
5. **`chartInfo` length from a sentence**: Stranded Foot "ending with chart Rnd 10" → "Chart · row 10 of 10" (Instep is 26); TT "row 1 of 1"
   with no chart yet; TT Leg "Work even through Row 11 of Foot chart" → restarts at row 1. When the chart is not kept or the row is not
   known, `row: null`.
6. `sideInfo`: RS/WS unknown ("RS?") on whole flat parts (boyfriend Front rib stretch, Front (continued), Icelandic); a second side after
   "With RS facing … Join yarn" keeps the old parity (boyfriend Shape Neck row 28 shows WS).
7. `untilInfo` "from tip of toe" / "from beg" counts only this part's rows (TT Foot ≈ 83, should be ≈ 62).
8. `markerInfo`: a lone BOR marker, or markers on a round whose stitches cannot be placed, gives "Markers set on a N-st row · this row makes M"
   on every round (Bernat sleeves, TT toe and cuff, Icelandic centre marker); Sandnes sleeve "this row makes 2".
9. `stretch.within` on a cast-on line is ignored: boyfriend Sleeves' 2½" rib is not on the counter.

## For the owner of `js/knits.js` (knit-parse), ranked by harm

1. `Knits.mirror("Bind off 7 sts at beginning of next row.")` → "… at end of next row." — not workable. Mirror a bind-off by moving it to
   the next row of the other side ("at beg of next WS row"), or return `mirrorYourself`.
2. `mirror` still moves a ". 29 sts." total into the row: "K1, ssk, knit to end. 29 sts." → "Knit to last 3 sts. 29 sts, k2tog, k1."
   (§10 covers "—43 sts." and "(38 sts)." only). The UI keeps its workaround (asserted).
3. Cascade saddle cardigan imports as 1 section / 2 rows, no sizes ("Left Front:" prose headings; "42 (46, 50)" vectors).
4. Heathers fronts stop at row 9; "Rnd 6:" stray row; "for 4" = 39 rows" printed count ignored.
5. Icelandic: IC1 split into two alternating lines in "Shawl" and the real rows in "Part 2" restarting at 1; border even-row rule not applied;
   the crochet edging read as a "until 6 sts" stretch.
6. Boyfriend F16 `repeatOf: [23]` should be the 4 rows that "form the pattern"; F22 "K2. ssk. Pat across next 7 sts … Turn" count 10 (so
   the F23 shaping card can run); "Work from ** to ** as given for Back" for the Front is not on the counter.
7. TT Foot `rowWord` (rounds); TT Leg "work Rows 1–12 of Leg chart … 5 times" (60 rnds) not numbered; Stranded Cuff line starts
   mid-sentence ("marker (pm), and join…").

## For the owner of `js/app.js` (shell-ui)

1. A one-size book pattern shows the book's first pattern's sizes on the row label ("ROUND · 7"" on Stranded Boot, "26"" on Icelandic / the
   hat): take sizes from `bookPatterns()[i]` only, none when it has none.
2. Sandnes raglan: the Children and Ladies size groups are both imported (duplicate parts) with one size picked: tick only the group the
   picked size belongs to.
3. Words: the until chip says "↕ 5 rows" / "📏 2 in ≈ 9 rows" in round parts; the repeat readout "Before group 1 · stitch 0 of 1" is jargon.
4. Project name is the file name ("knit-patons-boyfriend-cable") on single-pattern imports.

## Look (step 3) — not done

The phone/theme pass (375 × 812 and 375 × 640 in Stardrop Night, Pixel Wyrm, a light theme, desktop; Whole piece view; working mode with
a chart strip) was not done: the pane was hidden, the viewport emulation dropped mid-session, and the coordinator called the wave in.
What I did see at 375 × 812 (Stardrop Night): the boyfriend counter (tabs scroll, "ROW · L RS" label, Tap/hold hint) and the New project
sheet look clean; the Stranded Leg row carries three chips + a colour line on one round (chart chip, colours, key-colour chip) — the
key-colour chip on all 84 rounds is clutter worth a "not now".

## Not done (to resume)

- Journey groups for the walks (boyfriend evenly 85 → 93, TT toe guard, Icelandic chart rows) in `test/knits.journey.html`.
- Walks: a stranded yoke, the intarsia skirt, the toe-up socks; E16 3D; P10/P14/P17/P19 on real projects.
- The look pass and `test/knit-ui.shots.html` scenes for the new chips (past-end note, twin offer).
- P16 tappable words in the line.

## Clean-up

Tab `tab-3` closed, viewport reset; 9 projects under `stitchkeeper-wavek-knitaudit` deleted and their 6 BlobStore `p:<id>:` chart-page
entries removed (0 left); my helper keys in the pane's localStorage removed.
