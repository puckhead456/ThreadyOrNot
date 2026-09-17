# Brainstorm 03 — the garment crocheter

I imported `tmp-pdf/cardigan.pdf` (Briana K "Wheat Stitch Crochet Cardigan", 22 pages, 9 sizes)
through the New project sheet and worked it as a cardigan maker would: pick my size, set the body
panel going, chase the "repeat rows 5-8 until 25 rows" instruction, count 184-stitch rows, read the
pattern sheet, come back to the counter.

The counter itself is genuinely good for a garment — the repeat readout ("Repeat 2 of 6 · row 2 of 4")
with the row progress bar is exactly right. Everything *around* it fails: the PDF arrives hard-wrapped
at two-column width and nothing rejoins the lines, so the single most important number in a garment
pattern ("a total of **25 (29, 33, 37, 37) (41, 45, 49, 53)** Rows") is lost, instructions are shown cut
off mid-word, a wrapped size list `96 (108, 116)` is read as **Row 108**, and 9 parts each ask me to
pick my size again — defaulting to XS every time. The fixture suite does not catch any of it because the
strong cardigan assertions run against a hand-de-interleaved `.txt`, not the PDF.

---

## Proposals, ranked by impact ÷ effort

### 1. Pick your size ONCE, on the project, at import
**Problem.** The New project sheet has no size control at all, even though `Store.importPatternSections`
already detects and stores `proj.sizes = ['XS','S','M','L','1X','2X','3X','4X','5X']`. The chosen size
lives on `Part.sizeIndex` (`js/store.js:589`, default 0). My cardigan imported as 9 parts, every one at
sizeIndex 0 = XS. To make an L I must open Parts → each part → scroll past NAME / HOW MANY / TARGET
ROWS / REPEAT SECTION / STITCH ALERTS / PLACEMENT NOTES / PATTERN TEXT to reach the SIZE select, nine
times. Miss one and that part silently counts XS stitch targets (184 instead of 224) with no warning.
**Proposal.** Add `Project.sizeIndex` (default 0). `Store.linesFor` uses `part.sizeIndex ?? proj.sizeIndex`;
keep the per-part override for the rare "I'm making the body in L and the sleeves in M" case, shown as a
badge ("Size: L (project)" / "Size: M (this part)"). In the New project sheet, as soon as
`Patterns.detectSizes` returns >1 name, render a segmented/select "Your size" under the sections list
(a 9-wide list wraps fine at 375 px as two rows of chips), defaulting to nothing chosen and blocking
Save with "Pick your size" if a multi-size pattern is detected. Show the chosen size in the project
topbar next to the emoji.
**Effort** S · **Impact** 5
**Risks.** `Part.sizeIndex` must stay honoured for old saves (treat 0 as "inherit" only when the project
never had a size, or add `Part.sizeOverride: number|null` and migrate).

### 2. De-wrap column-hyphenated PDF text before parsing
**Problem.** The root cause of almost everything below. `PdfText.extract` untangles columns but keeps the
physical line breaks, so `Patterns` sees:
```
Repeats: Repeat Rows 5-8 (the stitch pat-
tern repeats) until there are a total of 25 (29,
33, 37, 37) (41, 45, 49, 53) Rows.
```
Result: `suggestions.targetRows = null` and `repeat.untilRows = null` for **every** part except the
swatch. On the counter, ROW 1 of First Section reads `…work across until the last 10 sts, blo sc` —
it stops mid-sentence, and the `10, turn. | 184 (208, 224) sts` tail renders as a separate grey note
line. The pattern sheet shows `cro-` / `cheted flat.` and `pat-` / `tern repeats`.
**Proposal.** A line-rejoin pass in `js/pdftext.js`, applied per page after the column untangle and
before the running-head pass, gated on "this page's lines are short" (median line length < ~55 chars,
i.e. a narrow column): (a) if a line ends with `-` preceded by a lowercase letter, splice the next line
on and drop the hyphen; (b) otherwise join the next line when the current line does not end in
`.!?:` **and** the next line does not start with a row marker, a `=== PAGE` marker, or a header-shaped
line (≤40 chars, Title Case/ALL CAPS, no sentence punctuation). I prototyped exactly this in the browser
(12 lines): sections go 9 → 7, the two phantom rows disappear, Center Back becomes one 6-row section
instead of a 2-row + 5-row split, and `targetRows` comes back as **25 / 29 / 33 / 37 / 41** for sizes
XS…2X and **24** for the Second Section. Keep it in `PdfText`, not `Patterns`, so pasted text (already
unwrapped by the user's PDF viewer) is untouched.
**Effort** M · **Impact** 5
**Risks.** Over-joining can glue a header onto the previous sentence (my prototype lost the "First
Section" name that way) — the header-shape guard has to run before the join, and amigurumi fixtures
(bear/cato/bee/snowman/panda) must be re-run, since their rows already rely on the v2.1 "wrapped rows"
continuation rules and could double-merge.

### 3. Make the cardigan fixture test the PDF, not the hand-typed text
**Problem.** `test/patterns.fixtures.html:789-792` asserts `targetRows` 25 / 33 / 53 and
`repeat {5,8,null,25}` — but those run on the `=== PAGE 7, de-interleaved by hand ===` block of
`tmp-pdf/cardigan.txt`, which a human rewrote. The real-PDF block (`:262-271`) only checks that six
section names exist and that First Section has 8 rows, so the suite is green while the actual import
produces `targetRows: null`, two unnamed parts and a phantom Row 108.
**Proposal.** In the `name === 'cardigan.pdf'` branch add: no section has `maxRow > 60`; exactly 7
sections and none unnamed; `First Section` suggestions equal `{startRow:5,endRow:8,untilRows:25}`;
`Second Section` `untilRows:24`; the `Sleeves` section text does not contain `Click HERE`. Keep the
hand-de-interleaved block as the *aspiration*, but make the PDF path assert the same numbers.
**Effort** S · **Impact** 4
**Risks.** These assertions fail today — land them with proposal 2, or as `TODO` soft-logs first.

### 4. A wrapped size list must not become a row marker
**Problem.** In Center Back, `…leaving the remaining 96 (108, 116) sts unworked, turn. | 88 (100,` wraps,
so the next physical line begins `108) sts; the number of puff sts in this row are`. The bare-number
marker rule (`N)`) fires → **Row 108**, `summary.maxRow = 108`, and the following real rows (2, 3-4, 5, 6)
open a brand-new unnamed section, which is why my import produced "Center Back" (2 rows) plus "Part 4"
(5 rows). Same bug in Second Section: `116), turn. 184 (208, 224)` → Row 116.
**Proposal.** Reject a bare `N)` / `N.` / `N:` marker when any of: the previous line ends with `(` or with
a digit+comma (`88 (100,`); the text immediately after the bracket starts with `sts`/`sc`/`) sts`; or N
exceeds the section's `lastRow + 40` while the section has ≥1 row. Add the same guard to the
expected-next-row section splitter so a rogue number can never open a section.
**Effort** S · **Impact** 4
**Risks.** None to amigurumi — those rows are `1.`/`R1:`, not `N)` after a comma. Worth a unit test in
`test/patterns.test.html` with the literal `108) sts; the number of puff sts` line.

### 5. Tap the row number to set it
**Problem.** `#row-number` (`index.html:108`) is a plain `<div>`. If I put the cardigan down at row 37
and my phone loses its data, or I recount my panel and I'm actually on 41, my only controls are `–` and
`+`. The pattern sheet's jump-to-row only offers the rows printed in the text (1–8 here), so inside a
repeat it can only send me *backwards*.
**Proposal.** Make `#row-number` a button opening a small "Go to row" sheet: number input pre-filled
with the current row, ± stepper, "the counter will move to row N and stitches reset to 0", undoable via
the existing `snapshot`. Same treatment for the stitch readout.
**Effort** S · **Impact** 4
**Risks.** Keep the big number's visual weight; a `button` with `appearance:none` and the existing
`.big-number` class is enough.

### 6. Repeats should speak "until N total rows", not "times"
**Problem.** The part editor's REPEAT SECTION is FROM / TO / TIMES. The cardigan says "Repeat Rows 5-8
until there are a total of 25 Rows" — I had to do the arithmetic ((25−4)/4 ≈ 6) myself, and it changes
per size (25/29/33/37/41/45/49/53). `Patterns` already returns `untilRows`; `Store.applySuggestions`
(`js/store.js:1819`) converts it to a `times` and throws the intent away.
**Proposal.** `Part.repeat.mode: 'times' | 'untilRows'` with `untilRows: number`. In `untilRows` mode
`repeatInfo` derives `times` live from `targetRows`, so changing the project size re-derives it. Editor
shows a two-option segmented control ("N times" / "until N rows total"). `applySuggestions` prefers
`untilRows` when the parser found one.
**Effort** S · **Impact** 4
**Risks.** `repeatInfo` is on the hot path — keep the derivation to one integer division.

### 7. Home card and part chips should say where I am in the *garment*
**Problem.** After a week away the home card says `First Section · Row 9 · 0/184 sts`. The stitch
fraction is noise for a garment (I count rows), and there is nothing about how far through the project I
am. The nine part chips across the top scroll horizontally with no indication which ones are finished.
**Proposal.** `projectSummary` for crochet: when the active part has `targetRows`, render
`First Section · row 9 of 25 · part 2 of 9` and drop the stitch fraction when the row target is > ~40
stitches. Give each part chip a thin progress underline (row/targetRows) and a ✓ when
`piecesDone === makeCount`, and auto-scroll the active chip into view on render.
**Effort** S · **Impact** 3
**Risks.** `summaryFor` is shared with the crafts contract — keep the shape a plain string.

### 8. Repair the auto-checklist sentences (and teach it garment finishing)
**Problem.** `Store.suggestChecklist(pdfText)` returned exactly three items, all cut mid-sentence by the
column wrap: `Join last row to beginning row by slip stitch`, `Weave in all yarn ends securely, taking
care`, `block once more to smooth out seams` (starts lowercase, mid-sentence). The actual Finishing page
wants: weave in ends, steam or wet block, dry flat reshaping, plus the seaming the pattern describes.
**Proposal.** After proposal 2, take *sentences* not lines: split the finishing block on `.`/`;`, trim to
≤60 chars at a word boundary, drop fragments that start lowercase or with a connector, and title-case the
first letter. Add a garment finishing vocabulary (`block`, `wet block`, `steam`, `seam`, `shoulder seam`,
`set in sleeve`, `button band`, `try on`, `measure`) alongside the amigurumi one, and always offer
"Block to finished measurements" when the pattern has a sizing table.
**Effort** S · **Impact** 3
**Risks.** None; the picker is opt-in per item.

### 9. "Repeat … for the other sleeve" → make 2
**Problem.** The Sleeves and Sleeve Cuff sections came in at `makeCount: 1`. The pattern says, in prose,
"Repeat the Sleeve and Sleeve Cuff sections for the other sleeve." Make-count detection only looks at
header text (`Wings (make 2)`), which garments never use.
**Proposal.** In `splitSections`, scan each section's text (and the following 2 lines) for
`repeat (?:the )?(?:the )?<names> (?:sections? )?for the other\b` and `make (?:a )?(?:second|two|both)`
and `work (?:a )?second`, resolve the named sections case-insensitively, and set their `makeCount = 2`.
Surface it in the import picker row ("Sleeves · 1 row · ×2 detected") so it is visible and editable.
**Effort** S · **Impact** 3
**Risks.** Over-matching "repeat for the other side" when it means a mirrored *within-part* instruction —
only apply when the sentence names a section that exists.

### 10. Keep running heads and the back-matter adverts out of the parts
**Problem.** Two separate leaks. (a) The pattern sheet for First Section renders
`WHEAT STITCH CROCHET CARDIGAN` / `by Briana K Designs` as a section header *in the middle of the
instructions* — it is the page running head, and the cross-page repeated-head pass did not remove it
(it appears once per page-pair here). (b) `Front Trim` is 1,380 chars, of which ~700 are the designer's
back-matter: "Windowpane Granny Blanket … Click HERE for more information … Autumn Wheat Sweater …
GPSR Representative".
**Proposal.** (a) Treat a header-shaped line as furniture when the same string appears on ≥2 pages, even
at different y-positions, and when it matches the PDF's title/`by <name>` pair. (b) Truncate the last
section at the first line matching `/click here|for more information|GPSR|^https?:|@.*\.(com|co\.uk)/i`
when everything after it contains no row markers.
**Effort** S · **Impact** 3
**Risks.** Do not truncate mid-pattern — require "no row markers follow" before cutting.

### 11. Show which side I'm on (RS/WS)
**Problem.** The cardigan is worked flat and turned: `Row 1 (WS)`, `Row 2 (RS)`. Nothing in the app shows
which side faces me, and the cue is buried in the middle of a truncated instruction line. Picking the
wrong side is the classic "unpick 6 rows" garment mistake.
**Proposal.** `Patterns` already sees `(WS)`/`(RS)` in the row text — expose `Line.side: 'RS'|'WS'|null`.
When a part has at least one side tag and `countMode === 'rows'`, derive the side for every row by parity
from the last tagged row and show a small chip beside the ROW label ("WS row" / "RS row"), themed with
the existing `.pill`. Suppress it entirely for rounds.
**Effort** S · **Impact** 3
**Risks.** Short-row / no-turn sections break parity — only derive within a section and stop deriving
after a line containing "do not turn".

### 12. Row-only mode: make the row button the big one
**Problem.** On a 184-stitch row the stitch button is the largest thing on screen and reads
`Group 1 of 19 · stitch 0 of 10`, `0 / 184`. No garment crocheter taps a phone 184 times per row ×
25 rows × 9 parts (≈ 40,000 taps). Meanwhile the ROW control is a small `–  9  +` triple, and
`Store.diagramModel` returns `{mode:'rows', rounds:[]}` for this part — the 3D piece has nothing to show,
so the biggest element on the screen is both useless and inert.
**Proposal.** A per-part counting mode (`Part.countStitches: 'auto'|'on'|'off'`, `auto` = off when the
part's typical row target > 60 or the pattern has no per-row explicit counts). In row-only mode the
stitch card collapses to a one-line "Tap to count stitches on this row" strip, and the row card grows a
full-width `.stitch-btn`-styled "Row done" button with the row number inside it, keeping `–` as a small
corner control. Persist per part; also flip it from the part editor.
**Effort** M · **Impact** 4
**Risks.** Touch-target and layout rework in the crochet counter, which is the most-tested screen; the
existing "counter overflows below ~700 px tall" issue must not get worse.

### 13. Render multi-size numbers resolved to my size
**Problem.** The pattern sheet and the counter row line show raw text:
`chain 185 (209, 225)`, `| 184 (208, 224) sts`, `until there are a total of 25 (29, 33, 37, 37) (41, 45,
49, 53) Rows`. Picking my number out of a 9-long bracket list, on a phone, on every single row, is the
defining chore of multi-size garment crochet. The parser already flattens the list and knows my index.
**Proposal.** A display transform used by the pattern sheet, the counter row line and the notes: find
multi-size lists with the same regex `Patterns` uses, and render the selected value in the accent colour
(bold) with the rest collapsed to a tappable `(…)` that expands inline. Add a Settings/part toggle
"Show only my size" for people who want the raw text. The counter's row line should show the resolved
value inline (`chain **209**`), never the bracket.
**Effort** M · **Impact** 4
**Risks.** Needs the flattened index positions exposed from `Patterns` (`Line.sizeSpans: [{start,end,values}]`)
rather than re-regexing in the UI, or the two will disagree.

### 14. Collapse the per-size prose blocks to my size
**Problem.** The Sleeves part is 3,746 characters and **one** parsed row. Almost all of it is nine
consecutive prose blocks — `Size XS:` … `Size 5X:` — each "decreasing under the arm on every sc round
until you have 34 sts remaining … until Rnd 49". Three of them (`Size Small:`, `Size Medium:`,
`Size Large:`) were even classified as section headers. As an L maker I scroll past eight blocks of
numbers that are wrong for me, in a screen that offers no search.
**Proposal.** Recognise `Size <name>:` / `Sizes <name> and <name>:` where `<name>` is in the detected size
list, and tag the following paragraph with `Line.forSizes: number[]`. The pattern sheet then hides blocks
that are not my size behind one "Other sizes (8)" disclosure, and the counter never shows them as notes.
Bonus: when only my block remains, its "until you have 34 sts remaining" and "until Rnd 49" become a
usable target for that part.
**Effort** M · **Impact** 4
**Risks.** Size names like `S`/`M`/`L` are short — require the exact `Size <name>:` form at line start,
and require ≥2 such blocks before filtering anything.

### 15. A Gauge & fit card
**Problem.** The PDF hands over everything needed to choose a size and it is all discarded:
`Gauge: 16 sts by 12 rows = 4x4" in stitch pattern`, and a schematic block
`A: Length …: 46 (52, 56)"`, `B: Bust: 32 (37.25, 42.5, 48, 48) (53.25, 58.5, 64, 69.25)"`,
`C: Sleeve Length before Cuff: 16.5"`. The app has no gauge, no measurements and no length anywhere in
the crochet paths (sewing has body measurements in `Settings.crafts`, cross-stitch has fabric & size —
crochet garments have nothing). I made a Swatch part, counted 14 rows on it, and then had nowhere to
record what it measured.
**Proposal.** Parse `Gauge: <n> sts by <m> rows = <w>x<h>"` and the `LETTER: Label: <multi-size list><unit>`
schematic lines into `Project.sizing = { gauge:{sts,rows,over,unit}, measures:[{label, values[]}] }`.
New sheet "Size & fit" in the ⋯ menu: the measurement table with my size's column highlighted; a "my
swatch measured" pair of inputs that computes my actual gauge and the resulting finished bust
("16 sts/4in → 32in. You got 15 → 34in. Go down a hook or pick size XS."). No network, pure arithmetic.
**Effort** M (L with the schematic parser) · **Impact** 4
**Risks.** Imperial/metric and `"`/`in`/`cm` mixing; store the raw unit and convert for display only.
The schematic block layout varies a lot between designers — ship it as best-effort with an editable table.

### 16. Pattern sheet navigation for a 22-page pattern, and a repeat-aware jump
**Problem.** The pattern sheet is one long scroll with no section index and no search. Worse, tapping a
row jumps literally: `Store.jumpToRow(p.id, prt.id, line.row)` (`js/app.js:3706`). On row 37 of a 5-8
repeat, tapping "Rows 5-6" — the line the app itself highlights as current — sends me back to row 4 and
silently discards 32 rows of work.
**Proposal.** (a) A sticky chip row of section names at the top of the sheet plus a find box that filters
lines (`Rnd 30`, `puff`). (b) When the part's repeat is enabled and the tapped line is inside the repeat
span, offer the *occurrences*: "Jump to row 5, 9, 13, 17, 21, 25, 29, 33 or 37?" — or simply default to
the occurrence nearest the current row and say so in the confirm sheet.
**Effort** M · **Impact** 3
**Risks.** The confirm sheet copy needs care so nobody loses rows; the existing snapshot/undo covers it.

### 17. Per-part stitch grouping, and stitch alerts from the pattern
**Problem.** STITCH GROUP SIZE lives on the project (Edit project sheet), so my 18-stitch swatch and my
184-stitch body panel share one grouping. And the wheat stitch row is structurally `blo sc 10` +
`[skip, sc, puff] × 82` + `blo sc 10` — a group of 10 is meaningless in the middle and exactly right at
the ends. The STITCH ALERTS field (comma-separated numbers, per part) is already the right mechanism and
I had to work out `10, 174` by hand.
**Proposal.** Move group size to the part (`Part.groupSize: number|null`, null = inherit project). When a
row's text matches `<stitch> <n>, [ … ] … until the last <n> sts, <stitch> <n>`, offer "Alert at 10 and
174?" in the part editor's Apply-detected-settings button, and pre-fill STITCH ALERTS.
**Effort** M · **Impact** 3
**Risks.** `Store` hot-path key (`js/store.js:2276`) has to include the part group size.

### 18. "Measure until" checkpoints
**Problem.** Garment patterns end rows with "until the sleeve measures your desired length", "Repeat Rows
3-6 until you have at least 14 total rows, then measure your gauge", "until Rnd 49, or until the sleeve
measures your desired length". The app can only count to a fixed row target, so these parts get no
target at all (Sleeves: `targetRows: null`), no progress bar, and no prompt to go and measure.
**Proposal.** `Part.measureCheck: { every: number, label: string, target: string }`. When the parser sees
`until (?:it|the \w+) measures` or `until … desired length`, offer an "Ask me to measure every N rows"
setting (default 10). At those rows the counter shows a dismissible strip: "Measure — target 16.5\" before
cuff. Current: ____ " with a tiny input that appends `row 30 = 12.5"` to the part's notes. Row progress
then shows "row 30 · measuring to 16.5\"" instead of a bare number.
**Effort** M · **Impact** 3
**Risks.** Keep it opt-in and dismissible; nobody wants a nag every 10 rows.

### 19. Sessions and pace, not a flat 500-row list
**Problem.** History is one line per row, newest first, capped at 500 — a cardigan blows through that
(25+24+49+49+… rows). Over weeks I want "how much did I get done last night" and "how much is left",
and the flat list gives neither.
**Proposal.** Group history by day with a header ("Tue 16 Sep · 14 rows · 1 h 12 m", using the existing
timer), and add one line under the row progress bar: "16 rows to go · about 1 h 50 m at your recent
pace" (median ms-per-row over the last 30 entries, hidden when fewer than 10). Raise the cap or store
per-day counts once the detail is trimmed.
**Effort** M · **Impact** 2
**Risks.** Pace estimates are wrong when the timer is off — only show it when at least 10 rows have
elapsed timer coverage.

### 20. A mods log that isn't called "Placement notes"
**Problem.** Every one of my 9 parts has an empty "Placement notes · WHERE THINGS GO" sheet (the fixture
even asserts "a garment has no placing notes at all"). What a garment maker actually writes down is
modifications: "chained 205 not 185 for extra length", "5.0 mm, gauge ran tight", "sleeve 4 rounds
shorter". Today that has to go in one project-wide free-text Notes box.
**Proposal.** Keep the field, but title it per part-kind: when a project's sections carry no placement
prose, label the sheet "Notes for this part" / "What I changed" and add a one-tap "stamp current row"
button that prefixes the line with `Row 37 —`. Cheap, and it turns the empty sheet into the thing
garment makers reach for.
**Effort** S · **Impact** 2
**Risks.** Purely copy + one button; keep `Part.placementNotes` as the storage so export/import and
templates are unchanged.

---

## Needs infrastructure

- **A within-row stitch-pattern model.** Proposals 13 and 17 both want to know that a row is
  `10 border + 82×[skip, sc, puff] + 10 border`. `Patterns.evaluate` computes the *total* and throws the
  structure away. A `Line.segments: [{count, repeat, tokens}]` output would unlock a real repeat counter
  ("puff 39 of 82"), border alerts and a meaningful diagram for flat work. Large, and it needs its own
  test corpus.
- **A project-level sizing/schematic model.** Proposal 15 needs `Project.sizing` (gauge + labelled
  multi-size measurement rows) in `Store`, in `normalizeProject`, and in export/import. Nothing like it
  exists today; `proj.sizes` (names only) is the only precedent.
- **Provenance flags on parser-applied settings.** Re-deriving `targetRows` when the project size changes
  (proposals 1 and 6) will clobber values the user typed. Needs `Part.applied: { targetRows: 'parser'|'user' }`
  or similar, plus a rule for what "Apply detected settings" re-touches.
- **A garment fixture with strong PDF-path assertions.** Proposal 3 is the minimum. Beyond that, the
  corpus has exactly one garment PDF; a top-down raglan (round yoke, "increase every 4th row"), a shawl
  with "repeat until you run out of yarn", and a blanket with a large motif count would each exercise a
  different shaping vocabulary the parser has never seen. Owner-side fixture work.
- **A "row-only" counter layout.** Proposal 12 is a real layout branch in the most-tested screen; it
  should come with its own 375×812 and short-viewport checks, and it interacts with the open
  "counter overflows below ~700 px tall" item in HANDOFF.md.
