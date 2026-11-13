# Wave K brainstorm 01: the knitter's lens

Lens: an experienced knitter (top-down and seamed sweaters, socks two at a time, charted lace,
cables, stranded yokes, short rows, hats) using the app with real patterns. Written 2026-11-12 on
branch `wave-1`. No code changed.

**How this was gathered.** In my own tab (`localhost:8766`, key `stitchkeeper-wavek-knitter`,
375×812) I imported the knitting fixtures through New project → 🧣 Knitting → drop zone (a real
`File` on the zone's input), picked a size as a user would, saved, and worked rows with the real
+ button: Bernat raglan (M), the 8-socks book (Time Traveler 8½", then Stranded Boot Stockings),
magic-loop socks (40 st), the lace book (26"), Rico shawl, Sandnes lookbook 0216, all four Patons
cabled pullovers (M / L / M / XL), Sandnes raglan (4 yrs), APL Nicoll, and the four Gutenberg
`.txt` books pasted into the text box (16 of 16). For comparison I imported the crochet Caron cuff
cardigan the same way and used the wave E/F/I record of the crochet amigurumi journey. All
projects and their BlobStore `p:<id>:` entries were deleted afterwards (0 left).

**What brainstorm 11 (2026-09-17) left.** Its Part 1 is built: parser slot (#1), RS/WS (#2),
size once (#3), gauge card and length chip (#4, #5), Tunisian pack (#6), two at a time (#7),
counter twin (#8), `js/knits.js` (#9), asterisk repeats with remainders (#10), markers (#12), the
chart chip and a vector chart reader (§1.5, beyond the plan). Still open from it: markers that
move with the work (#12's own risk note), the glyph-font chart (no fixture), the craft manifest
(#11, not a knitting item), and needlepoint/beadwork (other lenses). This document builds on
that, it does not repeat it.

---

## What I saw (evidence used below as E1…E20)

- **E1 Wrong instruction shown (Boyfriend, size L, Front).** Rows 5–6 show "Shape raglans: … cast
  off 2 sts beg next 2 rows" and rows 7–30 show "Cont even in pat until … same length as Back".
  The pattern does it the other way round: you work even for ~100 rows, *then* shape the raglans.
  `Store.lineForRow(front, 5)` returns the raglan line. A bounded "next 2 rows" line is numbered
  before the unbounded stretch that precedes it in the text. This is the one place I saw a
  confident wrong answer.
- **E2 Chart/panel rows freeze in a "cont in pattern" stretch.** Mock neck Back (continued),
  rows 1→31: the chip stays "Panel Pat C · row 1 of 28" and the cable ring stays "cable row";
  Boyfriend Front rows 10→20: "Cable Panel C · row 4 of 22", "cable in 1". Time Traveler Foot,
  round 2 ("Cont in patt until … 7¼ in"): still "Foot · row 1 of 12". `chartInfo`
  (`js/store.js` ~8914–8917) only advances the chart row inside a "Rows 3–16: work rows 3–16 of
  Chart A" range, so in a stretch it never moves.
- **E3 Wrong "of N" on panels.** Panel C is 12 rows (mock neck) / 6 rows (boyfriend), but the
  chip says "of 28" / "of 22", the size of the only chart that was found on the page. Cause:
  `chartInfo` falls back to `if (!page && pages.length === 1) page = pages[0]` (store.js ~8933),
  so any panel name binds to the only chart page. The scan found one chart per Patons pattern
  (mock neck "PANEL PAT B", boyfriend "Cable Panel A", no cells on either), none on Cabled Yoke.
- **E4 Repeat lines show the sentence, not the row.** Bernat Sleeves rnds 43–45 all show "Rep last
  6 (6-6-6-4-4) rnds 8 (8-2-0-12-10) times more" with 38 / 36 / 36 sts. Only the count tells you
  rnd 44 is the decrease round. Bernat yoke rnd 20 shows "Rep last 2 rnds…" for an increase round.
  Crochet does the same (Caron row 4 shows "Rep last 2 rows 11 times more"), so this is shared.
- **E5 Markers: honest on Bernat, wrong on Sandnes.** Bernat row 3: "Markers set on a 38-st row ·
  this row makes 46" and no segment counts (honest, but on every raglan increase row the
  strip goes blank). Sandnes yoke rnd 8 (+8 raglan round): "11 → m1 · 11|7|23|7|20". All 8 new
  stitches went into the last segment; the right answer is 12|9|25|9|13 or similar. Markers set
  with "insert marker around next st" mark a stitch, not a gap; the strip has no notion of that.
  Bernat's 8 raglan markers do not carry from "Part 1" (neck rows) into "Part 2" (yoke rounds).
- **E6 No targets from length.** Knitting never turns "until it measures" into a row target (by
  design: "never a target"). Crochet Caron, same kind of line: "0 / ≈ 85" estimated target. The
  knitting length chip ("📏 9 in ≈ 38 rows · ≈ row 38") is good, but there is no way to say "I
  measured, I'm there", and the round numbers after a length stretch are the app's estimate (Bernat
  sleeve: 13 even rounds assumed, then the dec rounds are numbered from there).
- **E7 A long stretch is one row.** Sandnes Yoke Rnd 1 = "k 1 rnd … Join and work 7 cm ribbing" (≈14
  rounds collapsed into one); the short rows then start at "round 2". Stranded Boot Stockings:
  "Leg: Work through Rnd 84 of Leg chart" is one line inside the "Cuff" part, though `KnitChart`
  read that 28×84 chart cell by cell. Rows from charts are not counted (HANDOFF knitting list).
- **E8 Stitch total lost.** Bernat yoke rnd 35 onward ("Cont even in rnds on 204 (216…) sts until
  …"): stitch readout "Group 1 · stitch 0 of 10" and no "/ 216", though the line prints the total.
- **E9 Make-counts.** Bernat Sleeves ×1, Boyfriend Sleeves ×1, Cabled Yoke Sleeves ×1 (all are
  two sleeves). Every sock part in Time Traveler, magic loop and Stranded Boot ×1: a sock pattern
  imports as one sock. Mock neck and boxy got Sleeves ×2 "from the assembly text".
- **E10 Part names and pieces.** Bernat: "Part 1", "Part 2" (no printed heading, known). Time
  Traveler: a part named **"Knits"** holding the leg (the injected "Interweave Knits" advert
  became a header); the gusset is named "Heel". Boyfriend: 8 tabs for 3 pieces ("Back (continued
  2)"). Stranded Boot: "Cuff", "Cuff (continued)" (the heel), "Cuff (continued 2)" (the gusset).
- **E11 Gauge missing in books.** Time Traveler (prints "GAUGE 32 sts and 46 rnds = 4"), Sophia
  shrug: `Project.gauge` empty, so the length chip says "add your gauge". Single-pattern PDFs
  (Bernat, Patons, Sandnes stitch-only 14/10 cm) are right.
- **E12 Book import friction.** In the lace book I selected the Icelandic shawl's tab and ticked
  "Import this pattern"; the save still made Sophia (the first pattern). Only 7 of 10 lace
  patterns are listed (Oriel, Spectrum, Arrowhead missing). In the socks book the size chips
  shown while Stranded Boot was selected were Time Traveler's (7", 8½", 9½"). Charts from other
  patterns attach: Time Traveler got the p34 Stranded Boot "Leg" chart. Book-wide checklist items
  ("Sew seven buttons…" in a shawl import) and glossary steps as placing notes ("Kitchener stitch
  step 1…") are offered.
- **E13 Round vs row words.** Time Traveler Foot ("Next rnd …", worked in the round): label "ROW",
  chip "RS?". Mock neck at 154 sts: "Group 1 of ≈ 16 · stitch 0 of 10".
- **E14 Charts are shown, not followed.** The chip sheet (Foot, row 1) writes the row out well
  ("k2, k2tog, yo, …, k3") above a cropped page image, but nothing on the image marks row 1, the
  read direction, or where my 32 stitches sit inside the 68-st round.
- **E15 Colourwork.** Stranded Boot Stockings (MC/CC, chart fills read by `KnitChart`):
  `yarnColors` = `{ "*": default }`; no colour strip, no per-round colour sequence.
- **E16 3D.** Bernat yoke: a widening tube, nice. Mock neck back at 154 sts: a faint small square
  in the button, cables illegible at that size. Each part is its own model (a sock is never one
  sock, a raglan's sleeves are wings; known in HANDOFF).
- **E17 Short rows: good.** Sandnes "Short row 1 of 6 · 6 sts" … "6 of 6 · 19 sts", side RS/WS,
  the round moves on after the sixth. This is better than anything I know in a counter app.
- **E18 Honest failures.** Nicoll: "Pages 3–207 had no readable text (they are probably images)".
  Sandnes lookbook: 2,805 characters, no sections, no message saying "this looks like a
  lookbook with no instructions". After pasting text the old "207 pages … no readable text"
  notice stays on screen. The Handbook paste shows "Looks like UK terms" (a crochet dialect chip)
  on a knitting import.
- **E19 "At the same time"** (boyfriend F23, Sandnes R15, Henley HE3 in the research) is read as one
  open-ended line (`js/knits.js` ~1835–1842: `AT SAME TIME` handled by a regex that makes the
  stretch countless). Nothing tracks the two shapings separately.
- **E20 "Reversing shaping"** only sets `makeCount = 2` (`finishParts`, knits.js ~3632); no
  mirrored instructions. Half charts (Icelandic B/D/F) write only the printed half.

---

## 1. Parity table (crochet capability → knitting today)

| Crochet capability | Knitting | Evidence |
|---|---|---|
| PDF import → named parts with counted rows | partial | Bernat "Part 1/2"; Time Traveler "Knits" part (E10); Leg chart 84 rnds = 1 line (E7) |
| Computed counts + confidence badge ("≈ why") | has | "≈ why", "count unknown" (knit-qa #51); per-row counts on Bernat yoke rnd 20 = 160 ✓ |
| Count shown on every row | partial | lost in "cont even on N sts" stretch (E8) and through chart stretches |
| Hundreds of real-fixture assertions | has | `test/knits.fixtures.html` 530; but parser-level, no app-level journey audit |
| Multi-size, size once, size marked in lines | has | "ROW · M", size chips at import |
| Sizes inside charts / schematics | partial / missing | chart repeat box picked by size; no schematic anywhere |
| Live 3D following taps | has (per part) | sock L, raglan, cables; no assembled garment (E16) |
| 3D faithful to the shape | partial | yoke tube good; wide flat panels tiny and pale; sleeves as wings |
| Yarn colours from the pattern + colour strip | missing for colourwork | Stranded Boot colours `{*}` (E15) |
| Repeats | partial | sentence shown, not the repeated row (E4, shared with crochet) |
| Targets from import | partial | row targets only for counted runs; never from length (E6) vs crochet "≈ 85" |
| Group readout / buzz | partial | 10-stitch groups on 154-st rows (E13); repeat groups when they add up |
| Alerts, placing notes, history, undo | has | shared code; placing notes polluted by glossary text (E12) |
| Templates | has | 6 built-ins (Sweater, Socks ×2, Hat, Shawl, Blanket, Single) |
| Checklists from import | partial | book-wide items offered in a one-pattern import (E12) |
| Focus / working mode | has | wave I mirrors RS/WS, short rows, markers |
| Tours, FAQ | has (lighter) | 1 tour, 3 FAQs vs crochet's many |
| Celebrations | has | shared |
| Accuracy audit vs page-by-page truth | partial | `docs/research/knitting.md` is parser truth; nobody walked the app row by row like wave E |
| Fixture set | partial | 16 knitting vs ~40 crochet; no glyph chart, no 2-at-a-time, no intarsia |
| Make-counts from text | partial | sleeves and socks ×1 (E9) |
| **Knitting only:** RS/WS, short rows, markers, cable ring, gauge card, glossary, chart chip | has / partial | short rows excellent (E17); markers stall or mislead (E5); charts not followed (E2, E14) |

---

## 2. Proposals, ranked

Effort: S hours, M a day, L several days, XL a wave.

### P1. A "work until" stretch is a phase, not a row (fixes E1, E6, E7, E8)
**User sees.** On "Cont even in pat until work measures same length as Back", the counter says
"Stretch · row 12 of ≈ 101 (15½ in at your gauge)" with the stitch total kept, the panel rows
still advancing (P3), and a big **"I'm at the length"** button that ends the stretch and moves to
the next instruction ("Shape raglans: cast off 2 sts at beg of next 2 rows"). Nothing after an
open stretch is given a row number until the stretch ends.
**Why.** E1 is a wrong instruction on the screen; E7 hides 14 rounds of rib inside Rnd 1; E8 loses
the stitch total; E6 numbers the sleeve's decreases from an estimate.
**How.** In the store's row index, an `until` line (length, "same length as", "until N sts rem")
becomes a stretch with an open end; rows after it are numbered relative to the stretch's end
(`Part.stretches[] = {line, startRow, endRow|null}`). While open, `lineForRow` returns the stretch
line, `count` = the stretch's "on N sts" or the previous count. "I'm at the length" writes
`endRow` (one undo step, history entry). Estimated end from gauge stays a hint. Crochet benefits
the same way (its "≈ Row 25" logic is the same idea, less explicit).
**Effort.** L. **Risks.** Touches `buildRowIndex`, shared with crochet; needs the crochet
fixtures green. Existing projects with absolute row numbers need a migration that leaves them as
they are. **Proof.** Boyfriend Front L: row 5 is the stretch, not raglans; after "I'm at the
length" at row 101, the next two rows are the raglan cast-offs, 89 sts. Sandnes Yoke rib is its
own stretch; short row 1 follows it. Assertions in `test/knit-counter.test.html` and a crochet
garment (Caron, Lion Brand log cabin) unchanged.

### P2. "This row" resolves the repeat (fixes E4; crochet too)
**User sees.** Under "Rep last 6 rnds 8 times more": **"Dec rnd: K2tog, knit to last 2 sts, ssk ·
repeat 3 of 9 · rnd 1 of 6"**; next tap "Knit · rnd 2 of 6". The repeat sentence moves to a small
second line.
**Why.** E4: on a decrease-every-6th sleeve you need to know *which* round decreases. Today only
the count drop tells you.
**How.** The store already resolves back-references for the chart chip (`backRefFrom`, `repeatOf`
in `chartInfo`) and `Knits.expand` re-reads referenced rows. Use the same resolution for the
pattern line: `lineForRow` returns `{shown: referencedLine, via: repeatLine, cycle, of, k, n}`.
"Rep last 2 rnds" points at the two preceding row lines; "Knit 5 rnds even" counts as 5.
**Effort.** M. **Risks.** "last N rows" when the previous lines include a range or a stretch;
when unsure, show the sentence as today (never a guess). **Proof.** Bernat sleeve M: rnd 20 = dec
rnd, 21–25 knit, 26 dec … through 68 = 30 sts; Bernat yoke rnd 20 = increase round. Caron
cardigan row 4 shows the resolved row.

### P3. Panels and charts that keep running, several at once (fixes E2, E3)
**User sees.** On the boyfriend Front: a stacked chip **"A 7/22 · B 3/4 · C 1/6"**, each with its
own cable ring; it keeps advancing through every "cont in pat" row, and the sheet lists all three
rows written out. A panel whose length is unknown says "C row ?" rather than a number.
**Why.** E2 freezes on the longest part of every cabled sweater. E3 shows a wrong "of 28". The
research notes the Front's panels only line up every LCM(22, 4, 6) = 132 rows: this is exactly
the arithmetic a knitter loses.
**How.** When a line places panels ("Work 1st row of Cable Panel C") record a per-panel origin row
on the part; the panel row at any later row is `(row − origin) mod panelRows + startRow`
(panel definitions already in `lines.panelDefs`, `panelCrossRows`). Drop the single-page fallback
(store.js ~8933) unless the names match. Undo/jumps need nothing new: it is a function of the row.
**Effort.** M. **Risks.** Stretches (P1) must count rows for this to be right; panels that restart
after a shaping need the origin moved. **Proof.** Mock neck M Back (continued) row 31: C and A
rows asserted against the research's panel table (§9); boyfriend Front row 132 brings all three
back to row 1 together.

### P4. The chart, with your row on it (fixes E14; knitCompanion's best feature)
**User sees.** The chart sheet shows the cropped chart with a **highlighter band on the current
row**, an arrow for the read direction (←  on RS, → on WS, ← in the round), row numbers kept
visible, the repeat box outlined, and the stitches you have tapped shaded up to your position.
Tap a cell: its key meaning and the pattern's own words. The band moves with + and −. In working
mode a thin strip of the chart (current row ± 2) sits above the button.
**Why.** Chart knitters read the chart, not text. Today the row is written out but the image is a
static crop (E14).
**How.** Vector charts already give `bbox`, `pitch`, `rowNos`, `labelSide`, `cells`; draw the band
in a canvas over the BlobStore image. For a raster (`image: true`) or unread chart, let the knitter
drag two handles once (top and bottom row) and type the row count; rows are then evenly spaced.
Stored per chart in `craftData.charts[n].calib`.
**Effort.** M (vector), +S (raster calibration). **Risks.** Sideways charts (`turned`) need the
`pageBox` frame; keep a "Whole page" fallback. **Proof.** Socks p6 Foot row 7, p16 cable chart row
20, lace p15 Chart B row 14: screenshots compared with the page; band position asserted from
`rowNos`.

### P5. Rows counted from charts (fixes E7, the HANDOFF "chart rows not counted")
**User sees.** "Leg: Work through Rnd 84 of Leg chart" becomes 84 numbered rounds with a target,
the chart chip on each, and counts from the chart (k2tog ×4 rounds show −8). "Work Rows 1–12 of
Leg chart 5 times" becomes 60 rounds, "repeat 2 of 5 · chart row 7".
**Why.** Charted sections are where crochet's richest features (targets, counts, badge, 3D
follow) all stop for knitting.
**How.** At import, a line naming a chart row range expands into virtual row lines whose stitch
counts come from `KnitChart.rowInfo(chart, r).consumes/produces` around the part's running count
(the non-chart stitches stay constant). The charts arrive after import (background scan), so the
part re-indexes when `craftData.charts` lands. A row with an unknown cell has `count: null`.
**Effort.** L. **Risks.** Charts from other book patterns (E12) must not bind; "work chart over
32 sts" inside a 68-st round needs the remainder kept. **Proof.** Stranded Boot Leg: 84 rounds,
84 → 60 sts (research §2h); Time Traveler Leg 8½": 60 rounds of 63 sts with BOR moves on chart rows
6 and 10; lace hat 61 rounds.

### P6. Shaping schedule for "at the same time" and "every Nth row" (fixes E19)
**User sees.** A shaping card for the stretch: **"Neck: dec on rows 1–4 · Raglan: dec every alt row
· this row: neck ✓ raglan —"**, with two small tick counters ("neck 3 of 4", "raglan 2 of ?") and
the expected stitch count per side ("neck side 9 sts left"). The row's announcement names both.
"Inc 1 st each end on next and every following 6th row 3 times more" shows "inc row in 4".
**Why.** "At the same time" is the line that ruins cardigan fronts; no counter I know tracks two
shapings against one row number. The research has three such lines (F23, R15, HE3).
**How.** Parse each clause into `{what, from, every, times|until}`; generate a per-row schedule
(pure arithmetic, size-resolved); unresolvable clauses ("until armhole measures") become a stretch
(P1) inside the schedule. Show in the counter and in a "shaping" sheet as a small table.
**Effort.** L. **Risks.** Wording variety; when a clause cannot be read, show the sentence and no
schedule. **Proof.** Boyfriend F23 L: 4 neck rows + raglan rows to 4 sts, schedule asserted row by
row against the research; Bernat sleeve, Boxy X21 (rows 1, 7, 13).

### P7. Book import that does what you picked (fixes E9 partly, E10, E11, E12)
**User sees.** Pick "Icelandic Lace Shawl" in a book and that pattern is imported with *its* sizes,
gauge, charts and checklist; nothing from the other nine. Every pattern in the contents is
listed.
**How.** A bundle of store/parser fixes: the pattern tick follows the selected tab; size chips
per group; `knitAttachCharts` keeps only charts on the chosen pattern's pages; per-pattern gauge
for Time Traveler and Sophia; advert lines ("Interweave Knits IS A MUSTHAVE") never become headers;
checklist suggestions from the chosen pattern only (known in knit-qa "Left").
**Effort.** M. **Proof.** Lace book: 10 patterns listed; Icelandic import has charts A–F only;
Time Traveler gauge 32 × 46 / 4 in, parts Toe, Foot, Gusset, Heel Turn, Heel Flap, Leg, Cuff.

### P8. Pairs by default: sleeves and socks (fixes E9, E13)
**User sees.** A sock pattern imports as a pair ("Sock ×2") and the import asks **"Knit both at
once?"** (two at a time, already built). Sleeves without a make-count become ×2 with "made twice
(a pullover has two sleeves)" in the confidence line. A sock part shows "RND", not "ROW / RS?".
**How.** Garment-noun prior in `finishParts` (sleeve, sock, mitten, glove, stocking → 2 unless the
text says otherwise), surfaced as inferred (as crochet's `makeCountInferred`). Round word from the
line's "rnd" label.
**Effort.** S. **Proof.** Bernat, Boyfriend, Cabled Yoke Sleeves ×2 inferred; Time Traveler parts ×2;
"Sweater w/ one sleeve" stays ×1 if the text says so.

### P9. Markers that move, and marked stitches (fixes E5)
**User sees.** On a raglan increase row the strip keeps counting: "4 → m2 · 13|2|8|2|22|…", the
segments grow by one on each side of each marker. A marker "around a stitch" shows as a ringed
stitch ("● raglan st"), and the count says "2 → raglan st". Markers continue into the next part of
the same piece (neck rows → yoke rounds).
**How.** `expand` already returns `inc` positions; map them to segments by the rule "M1 before sm
→ left segment, after sm → right". When `expand` cannot place an increase, keep today's honest
message. Fix Sandnes' last-segment absorption (wrong numbers are worse than none).
**Effort.** M. **Proof.** Bernat rows 3, 5, 7 against the research's segment table (§1 Markers);
Sandnes rnd 8 4 yrs; Time Traveler toe markers.

### P10. "I measured" re-anchors the count, and learns your gauge (E6)
**User sees.** On a length chip: **"I measured: [ 14 ] in"**. The app re-estimates the rows left,
moves later row numbers if the stretch was estimated, and offers "Your row gauge on this project
is 18.4 rows / 4 in — use it?" The swatch card fills itself after two measurements.
**How.** Store `{row, length}` pairs per part; least-squares rows per unit; feed `Project.gauge.swatch`.
**Effort.** S (with P1), M without. **Proof.** Bernat sleeve: after "3 in at round 15" the dec
rounds start at 16, not 14; `test/knit-counter` group.

### P11. Stranded colourwork and intarsia from the chart (fixes E15)
**User sees.** On a colourwork round: a colour strip like crochet's, built from the chart: **"MC 3 ·
CC1 1 · ×17"**, the longest float this round ("float 5: catch it"), and which colour is dominant.
Intarsia: a bobbin list ("4 bobbins: A, B, A, C") per row. Yarn colours read from the chart's key
fills, not just the text.
**How.** `KnitChart` cells already carry `color` (socks p23 Chart A MC/CC1/CC2 read exactly). Runs
per row → strip; floats = longest run of the other colour. Colours enter `yarnColors` by key name.
**Effort.** M. **Risks.** Argyle charts with 1–2 unknown cells: show "?" in that run. **Proof.**
Socks p23 Chart A row by row; Albus Argyle (research A3: colours reverse on the second repeat).

### P12. Mirror what the pattern only says once (fixes E20)
**User sees.** "Work Left Front as Right Front, reversing shaping" produces a Left Front part whose
lines read mirrored ("…to last 3 sts, ssk, k1" ↔ "k1, k2tog, …"; "beg of RS rows" ↔ "beg of WS
rows"), marked **"worked out by the app from Right Front"**. Half charts (Icelandic B/D/F) get
their second half drawn mirrored, with mirrored decreases.
**How.** A token-level swap table (k2tog↔ssk, C4F↔C4B, T3F↔T3B, beg↔end, left↔right, RS↔WS for
shaping placement); for charts, mirror `cells` columns and swap leaning symbols via the key.
Anything not in the table → the line is shown unchanged with "mirror this yourself".
**Effort.** M–L. **Risks.** A wrong mirror is a wrong answer; the "worked out" label and the
fallback are essential. **Owner decision** below. **Proof.** Icelandic Chart B row 14 second half
against the pattern's written full row (research §4d); Tailored Scallops fronts.

### P13. Knit-sized counting: tap a repeat, not a stitch (E13)
**User sees.** On a 154-st row the button counts **repeats** ("*K3, P2* · 12 of 30") or **segments**
between markers, and buzzes at each; a long-press switches to stitches. Plain rows can be "rows
only" (the + is the main control, the stitch button shrinks).
**How.** `repeatGroups` already finds the row's real groups; make the tap unit the group when the
row has one, fall back to stitches. A setting per project.
**Effort.** S–M. **Proof.** Mock neck Back row 1 M (154 sts) counted in groups that add up;
Bernat yoke round 20 by marker segments.

### P14. Clicker and keyboard rows (cheap, beloved)
**User sees.** A Bluetooth page-turner or foot pedal works: PageDown/→ = row done, PageUp/← = row
back, outside working mode too. Settings shows "Press your clicker now" to learn its key.
**How.** A keydown map on `#screen-project` (working mode already has Space/Enter and arrows).
**Effort.** S. **Proof.** Synthetic key events in `test/knit-counter`; one real clicker by the owner.

### P15. Evenly-spaced and pick-up calculators
**User sees.** "Inc 8 sts evenly across" → "K7, M1, (k8, M1) ×7, k1" for your size, on the line.
"Pick up and knit 68 sts along neck" → "about 3 sts for every 4 rows" given your row count.
**How.** Integer arithmetic on the row's start count; the result is labelled as a suggestion.
**Effort.** S. **Proof.** Boxy X23 (M: 69 sts), Henley HE3, Bernat neckband pick-up.

### P16. Stitch guide drawer: tap an abbreviation in the line
**User sees.** In the pattern line, "Cr4F" and "Panel Pat B" are tappable: the pattern's own
definition (full text, not the first line, knit-qa #60) slides up, with the panel's rows.
**How.** `craftData.glossary` and `lines.panelDefs` already exist; wrap known tokens in the
rendered line. **Effort.** S. **Proof.** Boyfriend T3F shows the boyfriend's meaning, not the
generic one.

### P17. Schematic from the numbers (multi-size everywhere)
**User sees.** A 2D schematic per piece (back, front, sleeve, yoke, sock) with widths and lengths
for **your size** computed from stitch counts ÷ gauge, the printed measurements beside them, and
"your gauge makes this 2 cm wider" in red.
**How.** Counts at key rows (cast-on, underarm, shoulder) are already known; widths = sts ÷
gauge; lengths from rows or printed lengths. SVG, no 3D. **Effort.** M. **Proof.** Bernat body
M: 128 sts ÷ 3 sts/in = 42.7 in vs printed chest; mock neck back.

### P18. One sweater, one sock in 3D (assembled garment)
**User sees.** "Whole piece" shows the sweater assembled (yoke + body + two sleeves; or front, back,
sleeves seamed), the part being worked lit and the others ghosted at their real progress. A sock
shows cuff → leg → heel → foot as one L.
**How.** A placement table per template kind (raglan top-down, set-in seamed, sock top-down / toe-up)
that positions each part's model; per-part LOD so a 154-st panel stays light.
**Effort.** XL. **Risks.** Phone GPU (still untested on hardware per HANDOFF). **Proof.** Gallery
chips for Bernat and Time Traveler; `diagram.test` reference rows for the assembled bounds.

### P19. Your own notes on a row, kept for the second sleeve
**User sees.** "📝 note on this row" ("picked up 2 extra at underarm", "switched to 4 mm"); when the
second sleeve or sock reaches that row the note shows. Notes travel in `.thready` backups.
**Effort.** S. **Proof.** Two-at-a-time Socks template: note on Sock 1 rnd 20 shows on Sock 2 rnd 20.

### P20. Materials card: needles and yarn for your size
**User sees.** "Needles: 6 mm 24" circular (body), 5.5 mm DPN (sleeves)" and "Yarn: 2 balls Terracotta
Rose (size M)"; tick what you own; a shopping line like sewing's.
**How.** The front-matter lines are already read for gauge; the yarn table is a size vector.
**Effort.** M. **Proof.** Bernat M (2 balls), mock neck, Sandnes.

### P21. App-level knitting audit (crochet's wave E, for knitting)
Walk every fixture *through the app*, row by row for one size, against `docs/research/knitting.md`,
and record each screen discrepancy as a test (E1–E13 are the start of that list). **Effort.** L.
**Proof.** A `test/knits.journey.html` that drives the store like a user and asserts the line, count,
chip and side per row.

---

## 3. Top 8

1. **P1 Stretch phases** — the only wrong instruction I saw comes from numbering rows past a "work until".
2. **P3 Panels that keep running** — every cabled sweater's long middle is frozen today.
3. **P2 This row, resolved** — "Rep last 6 rnds" should say which round decreases (crochet gains too).
4. **P4 Chart with your row on it** — what chart knitters actually look at, built on data we already read.
5. **P5 Rows counted from charts** — brings counts, targets and 3D follow to charted sections.
6. **P6 Shaping schedule** — "at the same time" tracked row by row, the cardigan-front killer.
7. **P7 + P8 Imports that match the book and the body** — the right pattern, its gauge, pairs of sleeves and socks.
8. **P9 Markers that move** — the raglan yoke's marker strip goes blank or wrong exactly when it matters.

**The one thing to build first: P1, stretch phases.** It removes a confident wrong answer (E1),
it is the foundation P3, P6 and P10 stand on (all of them need row numbers that stay true after
"until it measures"), and it improves crochet garments at the same time.

---

## 4. Do not build

- **LLM or server reading of patterns or charts.** Per-user cost; the vector reader already does
  better on the fixtures than a guess would.
- **OCR for scanned books (Nicoll) now.** Tesseract.js is Apache-2.0 but ~10 MB of data, slow on a
  phone, and the scans' abbreviations are poor OCR targets; the honest "no readable text" (E18) is
  the right answer until a user asks.
- **Voice counting ("next row").** Chrome's Web Speech recognition sends audio to a server
  (privacy, and a cost we don't control). A clicker (P14) does the job.
- **Ravelry sync / project import.** Needs an OAuth app and a server for tokens; a URL field is enough.
- **Per-stitch tapping as the default for knitting.** Knitters count rows; P13 instead.
- **Auto-mirroring without a label or fallback.** P12 only with "worked out by the app" and a
  plain fallback; never silent.
- **Reading paper knitting charts from phone photos** (wave J's cross-stitch reader). Knit symbols
  are line art, not colour cells; wait for the vector and raster-calibrated chart (P4) first.
- **Brioche, double knitting, entrelac vocab.** No fixture; the research lists no candidate.
- **A pattern designer / chart editor.** Different product (Stitchmastery, Knit Visualizer).

---

## 5. Asks for the owner

- **Fixtures** (download approval needed, candidates in `docs/research/knitting.md` §8):
  1. a chart set in a knitting symbol font (Stitchmastery or Knit Visualizer export);
  2. a cardigan with "reverse shaping" fronts and an "at the same time" neck + armhole (P6, P12);
  3. a two-at-a-time sock pattern (P8);
  4. a stranded colourwork round yoke with a chart, and a flat intarsia chart (P11);
  5. a DROPS-style translated pattern (cm only, "work A.1").
- **Decisions:**
  - P1 changes how rows after an open stretch are numbered in **both** crafts. Ok to change crochet too?
  - P12: may the app show mirrored instructions it worked out itself, labelled as such?
  - P13: should knitting default to "rows only" counting with repeats as the tap unit?
  - P18 is XL and GPU-bound: schedule only after a real-phone test of the current 3D.
- **From memory, not checked online** (what knitters expect from other apps):
  - knitCompanion: crops the PDF into "slices" (chart, key, text) on one screen, and a highlighter
    bar that moves row by row with linked counters. It also has repeat counters and notes per
    project, and you set up your size once.
  - Row-counter apps (several): many counters at once, a secondary counter that resets every N
    rows, reminders at a given row, and sometimes voice.

  P3, P4, P6 and P19 cover those. Nothing we lack from them needs a server.
