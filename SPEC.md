# Thready or Not — Technical Spec

(App was called "Stitchkeeper" during the initial build; the localStorage key `stitchkeeper.v1` and cache names keep that name on purpose so existing saved projects survive the rename.)

A crochet row/round + stitch counter PWA. Plain HTML/CSS/JS, **no build step, no ES modules, no frameworks**.
Hosted on GitHub Pages at `https://puckhead456.github.io/ThreadyOrNot/` (repo github.com/puckhead456/ThreadyOrNot; local folder is still C:\Users\mitch\CrochetBs) (so all paths must be **relative**: `./css/app.css`, never `/css/app.css`).
Works on iPhone Safari, Android Chrome, and desktop. Installable as a PWA ("Add to Home Screen"). Works offline.

Every JS file attaches ONE global object to `window` (e.g. `window.Patterns`, `window.Celebrate`, `window.Themes`, `window.Store`, `window.App`). Script tags load in order in `index.html`. Use `'use strict'` inside an IIFE.

## File layout

```
index.html                  # single page, all screens/modals as sections
manifest.webmanifest
sw.js                       # service worker, cache-first for app shell + fonts
css/app.css                 # layout + components, uses ONLY the CSS variables below
css/themes.css              # the 6 themes: each sets the CSS variables on html[data-theme="..."]
js/themes.js                # window.Themes = metadata list (id, name, group, tagline, swatches, emoji, fonts)
js/patterns.js              # window.Patterns = pattern text parser (pure functions)
js/celebrate.js             # window.Celebrate = themed finish animations
js/audio.js                 # window.Feedback = haptics + synthesized tap sounds
js/store.js                 # window.Store = state, persistence (localStorage), undo, export/import
js/app.js                   # window.App = rendering + event handling (the UI)
icons/icon-192.png, icons/icon-512.png, icons/apple-touch-icon.png, icons/icon.svg
```

## Data model (localStorage key `stitchkeeper.v1`)

```js
State = {
  version: 1,
  settings: {
    theme: 'stardew-night',         // one of the 6 theme ids (Stardrop Night is the default for new installs)
    haptics: true,
    sounds: true,
    keepAwake: false,               // screen wake lock preference
    autoAdvance: true,              // when a row's stitch target is hit, auto-complete the row
  },
  projects: Project[],
  activeProjectId: string|null,
}

Project = {
  id: string,                       // random id
  name: string,
  emoji: string,                    // e.g. '🐑' '🐉' '🧶'; user pickable from a small grid
  status: 'active'|'paused'|'finished'|'frogged',
  createdAt: number, updatedAt: number, finishedAt: number|null,
  countMode: 'rows'|'rounds',       // label only; both count identically
  groupSize: number,                // stitch group size, default 10, 0–50 (0 = grouping off)
  templateId: string|null,          // template the project was created from (null on old saves / unknown)
  notes: string,                    // project-wide notes (hook, yarn, pattern link)
  timer: { totalMs: number, runningSince: number|null },
  parts: Part[],                    // always >= 1 part. Single-piece projects have one part named 'Main'
  activePartId: string,
  checklist: { id: string, text: string, done: boolean }[],   // assembly checklist
  history: { ts: number, partId: string, partName: string, row: number }[], // one entry per completed row, newest last, cap 500
}

Part = {
  id: string,
  name: string,                     // 'Body', 'Wing', 'Main'
  makeCount: number,                // how many of this piece (wings = 2). default 1
  piecesDone: number,               // completed pieces of this part (0..makeCount)
  row: number,                      // current row/round number. 0 = not started. "row 5" means 5 rows completed
  stitch: number,                   // stitches completed in the current (in-progress) row
  targetRows: number|null,          // total rows for this part; enables progress bar
  repeat: { enabled: boolean, startRow: number, endRow: number, times: number },
  alerts: number[],                 // stitch numbers to flash+buzz at within a row, e.g. [40, 80]
  placementNotes: string,           // 'eyes between rnd 8-9, 6 sts apart'
  patternText: string,              // pasted pattern for this part; parsed by Patterns
}
```

### Counting semantics (Store implements these; App only calls them)

- `Store.tapStitch(projectId, partId)` → `stitch += 1`. If the current row (`row + 1`) has a stitch target from the pattern (`Patterns.targetFor`) and `stitch >= target` and `settings.autoAdvance` → completes the row (same as tapRow) and returns `{ event: 'rowAuto' }`. If `groupSize > 0` and stitch lands on a multiple of `groupSize` → returns `{ event: 'group' }` (`groupSize` 0 turns grouping off entirely). If stitch is in `alerts` → returns `{ event: 'alert', stitch }`. Else `{ event: 'stitch' }`.
- `Store.untapStitch` → `stitch = max(0, stitch - 1)`.
- `Store.tapRow` → `row += 1`, `stitch = 0`, push history entry. If `targetRows` and `row >= targetRows`: if `piecesDone + 1 < makeCount` → `piecesDone += 1`, `row = 0` and return `{ event: 'pieceDone', piecesDone, makeCount }`; else `piecesDone = makeCount` and return `{ event: 'partDone' }`. If ALL parts are done (every part with a targetRows has piecesDone >= makeCount; parts without targetRows are ignored, and at least one part has a target) → return `{ event: 'projectDone' }` (App then sets status finished + Celebrate.play). Else `{ event: 'row' }`.
- `Store.untapRow` → `row = max(0, row - 1)`, `stitch = 0`, pop last history entry for that part if it matches.
- `Store.resetPart` → row 0, stitch 0 (keeps piecesDone).
- `Store.undo()` → every mutating call above first pushes a deep-copy snapshot of the project onto an undo stack (cap 50, in memory only). `undo()` pops and restores. Returns boolean.
- Repeat readout: if `repeat.enabled`, `len = endRow - startRow + 1`, current row number being worked is `r = row + 1`. If `r >= startRow && r < startRow + len * times`: `k = floor((r - startRow) / len) + 1` (which repeat, 1-based), `j = ((r - startRow) % len) + 1` (row within repeat), `patternRow = startRow + j - 1`. Else not inside repeat; `patternRow = r`. `Store.repeatInfo(part)` returns `{ inside, k, j, len, times, patternRow, workingRow: r }`. **Pattern line highlighting and stitch targets always use `patternRow`**, so a repeated section highlights correctly.
- Timer: `Store.toggleTimer(projectId)`. `Store.elapsedMs(project)` = `totalMs + (runningSince ? now - runningSince : 0)`. Only one project's timer runs at a time.
- `Store.save()` writes to localStorage (debounced ~150ms is fine; must also flush on `visibilitychange`/`pagehide`). `Store.load()` on boot; if missing, create default state with NO projects (the home screen shows an empty-state).
- `Store.exportJSON()` → string of the whole state. `Store.importJSON(str)` → validates `version`, merges projects by id (imported wins), returns count.
- Templates (`Store.templates`): array of `{ id, name, emoji, countMode, parts: [{name, makeCount}], checklist: string[] }`:
  - `blank` "Single piece" 🧶 rows, parts [Main]
  - `blob` "Blobby animal" 🐑 rounds, parts [Body, Head, Ears x2, Legs x4, Tail], checklist [Stuff body, Stuff head, Sew head to body, Attach safety eyes, Sew ears, Sew legs, Sew tail, Embroider face]
  - `dragon` "Dragon" 🐉 rounds, parts [Body, Head, Wings x2, Legs x4, Tail, Horns x2, Spikes], checklist [Stuff body, Stuff head, Sew head to body, Attach safety eyes, Sew wings, Sew legs, Sew tail, Sew horns, Sew spikes down back, Embroider nostrils]
  - `garment` "Garment" 🧥 rows, parts [Front, Back, Sleeves x2], checklist [Block pieces, Seam shoulders, Set in sleeves, Seam sides, Weave in ends]
  - `blanket` "Blanket / scarf" 🧣 rows, parts [Main], checklist [Weave in ends, Add border, Block]
- `Store.createProject({ name, emoji, templateId, groupSize, countMode })` → applies template.

## Patterns API (`window.Patterns`, pure, no DOM)

```js
Patterns.parse(text) → Line[]
Line = { index: number, text: string, row: number|null, stitches: number|null }
```
Rules: split on newlines. For each line, detect a row/round number at the START of the line (case-insensitive, optional leading whitespace/bullets): `Rnd 5`, `Round 5`, `R5`, `R 5`, `Row 5`, `Rows 5-8` (range → row=5, rowEnd=8; include `rowEnd` on the Line), `5.`, `5:`, `5)`. Then detect a stitch count at the END of the line: `(30)`, `[30]`, `(30 sts)`, `(30 sc)`, `= 30`, `- 30 sts`, `30 sts`. Lines like `Rnd 2: inc x6 (12)` → row 2, stitches 12. Lines with no row number → row null (headers, notes). Row ranges (`Rnd 6-10: sc around (30)`) apply to every row in the range.

```js
Patterns.targetFor(lines, rowNumber) → number|null   // stitch count for that row, honoring ranges
Patterns.lineFor(lines, rowNumber) → Line|null       // the line to highlight for that row (ranges match)
Patterns.summary(lines) → { rows: number, maxRow: number|null, hasTargets: boolean }
```

## Patterns API v2 (supersedes the section above)

Goal: a user copy/pastes instruction text straight out of a pattern PDF (which is messy: side-notes interleaved, two-column bleed, typos like `6..Inc`) and the app still finds the rows, the stitch counts, the sizes, the sections and the repeats. Reference fixtures (NOT committed, copyrighted): `tmp-pdf/bee.txt` (amigurumi, numbered `1.` rows, NO explicit counts, `5-6.` ranges, `6..`/`8-11..` typos, colour-change lines between rows, eye-placement paragraph interleaved) and `tmp-pdf/cardigan.txt` (garment, `Row 1 (WS):`, `Rows 3-4:`, `Rnd 1:`, `Next Row:`, `Setup:`, counts after a pipe `| 184 (208, 224) sts; ...`, multi-size lists `25 (29, 33, 37, 37) (41, 45, 49, 53)`, `Repeat Rows 5-8 ... until there are a total of N Rows`, trailing count with no unit `turn. 184 (208, 224)`).

```js
Patterns.parse(text, opts?) → Line[]            // opts.size = 0-based index into multi-size lists (default 0)
Line = {
  index: number, text: string,
  kind: 'row' | 'setup' | 'header' | 'repeat' | 'note',
  row: number|null, rowEnd: number|null,         // setup/foundation lines: row 0 (rowEnd 0)
  section: number,                                // 0-based section index (see sections)
  stitches: number|null,                          // EXPLICIT count found in the text, size-resolved
  sizes: number[]|null,                           // all values when the explicit count was a multi-size list
  computed: number|null,                          // count EVALUATED from the instruction when no explicit count
  count: number|null,                             // stitches ?? computed
  countSource: 'explicit' | 'computed' | null,
  notes: string[],                                // short instruction-ish lines attached to this row (e.g. 'Colour change to black')
}
Patterns.targetFor(lines, row) → number|null     // Line.count of the first section-0 line whose range contains row (any section if none in 0)
Patterns.lineFor(lines, row)   → Line|null       // same matching, ignores count
Patterns.summary(lines) → {
  rows, maxRow, hasTargets,                       // as before; hasTargets true if any count (explicit or computed)
  computedOnly: boolean,                          // true when no explicit counts exist but computed ones do
  sizes: string[]|null,                           // size names if a sizes line like `XS (S, M, L, 1X) (2X, 3X, 4X, 5X)` was found
  multiSize: boolean,                             // any multi-size count list seen
  sections: [{ index, name, makeCount, startLine, endLine, rows, maxRow }],
  suggestions: { targetRows: number|null, repeat: { startRow, endRow, times: number|null, untilRows: number|null } | null },
}
Patterns.splitSections(text) → [{ name, makeCount, text }]   // for the "import into parts" flow; the whole text becomes one section named '' if no headers
Patterns.detectSizes(text) → string[]|null
Patterns.evaluate(instruction, prevCount) → number|null   // exposed for tests
```

### Row markers (start of trimmed line, optional bullets `-*•`)
`Row 1`, `Row 1 (WS)`, `Rows 3-4`, `Rows 5 - 8`, `Rows 5–8`, `Rows 5 to 8`, `Rows 5 & 6`, `Rnd 1`, `Rnds 6-10`, `Round 1`, `Rounds 6–10`, `R1`, `R 1`, `Rnd1`, `ROW 1`, followed by `:`, `.`, `-`, `–`, `)` or whitespace. Bare numbers need adjacent punctuation: `1.`, `1:`, `1)`, `5-6.`, `6..`, `8-11..`, `7.. `. `Next Row`/`Next Rows`/`Next Rnd`/`Next Round` → row = (last row in section)+1 (rowEnd same). `Setup`, `Length Setup (WS)`, `Foundation`, `Foundation row`, `Base` (with `:` ) → kind 'setup', row 0. Never treat `5 sc in next st`, `6 inc around`, `2 sl sts` as markers. `R` must not match inside words.

### Sections
A **header** is a non-row line that is short (≤ 40 chars), has no sentence punctuation, and is either ALL CAPS letters (`BODY`, `WINGS`, `ASSEMBLY`) or Title Case (`First Section`, `Center Back`, `Sleeve Cuff`), optionally with a make-count: `Wings (make 2)`, `Legs x4`, `Leg (x4)`, `Ears - make 2`, `WINGS (2)`. A new section also starts when a row number ≤ the previous row's number appears (restart) even without a header (name ''). Header lines adjacent to each other where the second is a known non-part word (`EYES`, `ASSEMBLY`, `NOTES`, `MATERIALS`, `TERMINOLOGY`, `Finishing`, `Tips`) are not sections; `EYES`/`ASSEMBLY` blocks are notes. Section names are Title-cased (`BODY` → `Body`).

### Explicit stitch counts (size-resolved)
Search, in order: (1) after a pipe `|` anywhere in the line: first number or multi-size list there (`| 18 sts`, `| 184 (208, 224) sts; the number of puff...`, `| 7 sc, 2 sl sts` → 7); (2) at the END of the line: `(30)`, `[30]`, `(30 sts)`, `(30 sc)`, `(30 stitches)`, `= 30`, `– 30 sts`, `- 30`, `30 sts`, `30 sts.`, `(24, 30)` → last, `sts: 30`, `st count: 30`, `(30 sts total)`, trailing multi-size list with or without unit (`turn. 184 (208, 224)`), `= 184 (208, 224) sts`. Numbers INSIDE the instruction (`blo sc 88 (100, 108), Fsc 96`) are not counts. A multi-size list is `N (N, N, N) (N, N, N)` or `N (N, N)`; flatten in order and pick `opts.size` (clamp to length-1). Also resolve multi-size lists inside `Repeat ... until there are a total of 25 (29, ...) Rows`.

### Computed counts (`evaluate`)
When a row line has no explicit count, evaluate the instruction against the previous row's count (previous line in the same section with a count; setup counts as previous). Tokenize on commas/semicolons/`and`; groups in `()`, `[]`, or `* ... *`, with multipliers `x6`, `×6`, `*6`, `6 times`, `repeat 6 times`, `rep from * 5 more times` (= 6 total), or `repeat around` / `around` / `to end` / `across` (fill from previous count). Stitch vocabulary (produced, consumed): `sc`,`hdc`,`dc`,`tr`,`dtr`,`slst`/`sl st` (1,1); `puff`,`bobble`,`popcorn`,`cluster`,`shell` (1,1); `inc`,`increase`,`2 sc in next`,`2sc in same` (2,1); `dec`,`decrease`,`sc2tog`,`invdec`,`inv dec` (1,2); `3 sc in next st` (3,1); `sk`/`skip` (0,1); `ch N`,`turn`,`join`,`fasten off`,`flo/blo` prefixes, `mr`/`magic ring` (0,0). Counts: `6 sc`, `6sc`, `sc 6`, `sc in next 6 sts`, `sc in each of next 6 ch`, `2sc` → 2. Specials: `N sc in mr`, `Nsc in mr`, `N st in mr`, `mr N`, `magic ring N`, `N sc in magic ring/circle`, `MR with N sc` → N. `inc in each st`, `inc around`, `inc all around` → prev×2. `sc in each st`, `sc around`, `sc in each st around`, `sc all around`, `blo sc in each st across`, `sc across`, `work even` → prev. `dec in each st`, `dec all around`, `dec around` → prev/2. `X, Y, repeat around` (no brackets, trailing "repeat around"/"rep around"/"around") → treat the comma list before "repeat" as the group. Group filling: groups = floor(prev / consumedPerGroup); leftover stitches (prev mod consumed) each produce 1. `(inc, sc) x5, inc` → 5×3+2 = 17. `Ch1, turn, (inc, 2sc) x5, inc, sc` → 5×4+2+1 = 23. Typos to tolerate: `inx` → inc, `eact` → each. If anything in the line is not understood and no fill-from-previous rule applies → computed null (never guess). Lines whose only content is "work in pattern"/"continue in established pattern" → prev.

### Notes attached to rows
Non-row, non-header lines that are short (≤ 80 chars) and start with an instruction keyword (`colour change`, `color change`, `change to`, `switch to`, `add`, `stuff`, `tie off`, `fasten off`, `sl st`, `slst`, `join`, `place`, `insert`, `attach`, `sew`, `embroider`, `do not`, `don't`, `put`, `with`, `in <colour>`, `cut`, `leave`, `finish`, `close`) attach to the NEXT row line as `notes` (so "Colour change to black" shows when you start round 5). If there is no next row line in the section, attach to the previous row. Everything else (side commentary, page headers, footers like `Chronic.Creator`) is kind 'note' with no attachment.

### Repeat / target suggestions
`Repeat Rows 5-8 ... until there are a total of 25 (29, ...) Rows` → `suggestions.repeat = {startRow:5,endRow:8,times:null,untilRows:25}`, `suggestions.targetRows = 25`. `Repeat Rows 3-6 until you have at least 14 total rows` → same with 14. `Rep Rows 2-3` / `Next Rows: Rep Rows 2-3` / `Repeat rows 2-3 around` → repeat with times null, untilRows null. `Repeat Rows 5-8 six times` / `x6` / `6 more times` → times 6 (or 7 for "more"). `Rnd 6-10: sc around` is a range, not a repeat. Lines that match are kind 'repeat'. Only the first suggestion in section 0 is returned.

### v2.1 additions (fixtures: `tmp-pdf/bear.txt`, `tmp-pdf/cato.txt`)

**Explicit count anywhere after the instruction.** Take the LAST bracket whose content is only a number (optionally followed by a unit word: `sts`, `st`, `stitches`, `sc`, `hdc`, `dc`), even if text follows it: `(30) (PHOTO A)` → 30; `(12) Fasten off Almond .` → 12; `(9) (2 Rounds x 9 Hdc = 18 Hdc)` → 9; `(24) (2 rounds total)` → 24; `- (18) touching round 6. If your eyes` → 18; `(16) Fasten off Twilight` → 16. Brackets with instructions (`A (Sc 5)`, `(Sc 1, Inc) x 8`) never count. The `- (N)` / `– (N)` dash form is common. Text after the count that starts with an instruction keyword (`Fasten off`, `FO`, `Stuff`, `Tie off`, `Sl st`) becomes a note on that same row; `(PHOTO X)`, `(PHOTO M-N)`, `(N rounds total)`, `(N Rounds x ...)` fragments are stripped from `text` and `notes`.

**Wrapped rows.** A row line whose text ends with `,` or has no count yet, followed by a non-marker, non-header line that starts with `(`, a lowercase letter, a colour-prefix like `A (`, `S (`, or a stitch token (`Inc`, `Sc`, `Hdc`, `Dec`, `Fsc`) is a continuation: merge it into the row's `text` (space-joined) and take its count. Also a line that is just `(36)` or `(30) Fasten off Almond .` is a continuation. Multi-line continuation allowed (max 3 lines).

**Two-column interleaving & headers.** Lines that consist only of single capital letters / photo labels (`A`, `B`, `E F`, `I J K`, `L M N`) are dropped. Trailing single-capital-letter tokens are stripped from headers (`Legs G` → `Legs`). Known non-part words are stripped from header names (`BODY EYES` → `Body`; a header that is only such a word (`EYES`, `ASSEMBLY`, `NOTES`, `MATERIALS`, `TERMINOLOGY`, `Finishing`, `Tips`, `Eye Placement`, `Facial Sculpting`, `Finished wing.`) is not a section header).
Row → section assignment uses **expected-next-row matching**: each section remembers `lastRow` (rowEnd of its last row). A row line whose start number equals `section.lastRow + 1` for some section is assigned to the most recently opened such section (setup row 0 makes a section expect 1). Otherwise, if the row starts at 1 or at ≤ current section's lastRow → open a NEW section. Otherwise (a gap) → current section. Header lines seen since the last header group form a **header group** (consecutive headers, ignoring blank lines and short "In Colour :" notes between them); when a new section opens it takes the next unused name from the most recent header group (in order), else ''. A header group is replaced when a later header appears after non-header content. Consequences that must hold: bear page 6 `Arms (Make 2)` + `Ears (Make 2)` headers followed by lines like `2. (Hdc 1, Hdc Inc) x 3 (9) 1. 5 Sc in Magic Ring (5)` — split a line at ` <count>) <N>. ` boundaries into two row lines — yields Arms rows 1,2,3-4,5,6 (6,9,9,8,6) and Ears rows 1,2,3 (5,8,12), both makeCount 2. Cato `Tail Frill` header between rows 30 and 31-33 does NOT start a section (rows continue in `Tail & Body`, 37 rounds); `Feet (make 2)` header bleeding into Arms row 17's wrapped text still names the next section Feet (rows 1-6). Bear: `Head`(13 rows), `Body`(10), `First Leg`(5), `Second Leg`(1), `Arms`(6 rows incl. range, make 2), `Ears`(3, make 2) — `Legs` header has no rows and is dropped.

**Notes as paragraphs.** Consecutive non-row lines merge into one note paragraph when the previous line ends with `,`, `-`, or a connector word (the, of, and, a, an, for, to, between, in, is, you, your, be, with, or, on, at, from, as, are, if, this, that, will, it, into, until, each, up, do); otherwise each line is its own note. A paragraph attaches to the next row (or previous if none) when it starts with a keyword (existing list plus: `before`, `after`, `now`, `next`, `make sure`, `switch`, `change`, `mark`, `pinch`, `fold`, `work`, `continue`, `stuff`, `embroider`, `place`, `add`, `attach`, `FO`, `fasten`, `tie`, `in color`, `in colour`, `with color`, `using`, `optional`, `do not`, `don't`, `begin`, `start`, `insert`, `invisible colour change`, `invisible color change`) and is ≤ 220 chars. `In Color A` / `In Twilight :` attach to the next row (row 1). The bee's interleaved commentary must still stay loose (the bee assertions keep passing).

**Evaluate vocabulary additions.** `Mr6`, `Mr 6`, `MR6`, `Mr8, Ch 1 and turn work` → 6/8; `Increase around`, `Inc around` → prev×2; `Decx9`, `Incx5`, `Inc x 8` (no/odd spacing) → counted; `Hdc Inc`, `Hdc Dec`, `Sc Inc`, `Sc Dec`, `HdcInc`, `11HdcInc` (= 11 hdc inc → 22) → inc/dec variants; `3Hdc in each stitch`, `3 sc in each st` → prev×3; `Hdc around`, `Sc around`, `Hdc 27`, `Sc 24`, `Sc 2, Inc x 3`; colour prefixes `A (Sc 5)`, `S (Dec x 12)`, `A (Hdc Inc x 5)` → the bracket group ×1; `Skip 1st stitch, 13Sc` → 13 (skip consumes 1 produces 0); `Bbl`, `Slst` (1,1); `(Bbl, Slst)x5`; `Sc, (Bbl, Slst)x5, 7sc` → 18; `Fold in half, sc 4 across to close` → 4; `2Sc, (Inc, Sc, Bbl, Inc, 2Sc)x2, Inc, 2Sc, Inc` → 24. Consistency check in the fixtures page: for every row with BOTH explicit and computed counts, report mismatches; target ≥ 90% agreement across bear + cato (list the rest).

### App/Store integration (v2)
- `Part.sizeIndex: number` (default 0). `Store.linesFor(part)` calls `Patterns.parse(part.patternText, { size: part.sizeIndex })`; cache key includes sizeIndex.
- Part editor: under the pattern textarea show the summary line, e.g. `24 rounds · counts computed ≈ · 3 sections detected`. If `summary.sizes` or `summary.multiSize`: a **Size** select (names from `sizes`, else "Size 1..N" up to the longest list seen) bound to `part.sizeIndex`. If `summary.suggestions` has anything: an **"Apply detected settings"** button that sets targetRows / repeat (confirm shows what it will set). If `summary.sections.length > 1`: a hint "This text has N sections — use Import pattern to split into parts."
- New project-level sheet **Import pattern** (overflow menu + a link in the part editor): big textarea "Paste the instructions from your PDF", live list of detected sections from `Patterns.splitSections` with name (editable), make-count, row count and computed/explicit indicator, each with a checkbox (default on for sections that have rows). Buttons: **Create parts** (for each checked section: if a part with the same name exists (case-insensitive) → set its patternText and makeCount; else add a new part) and **Put it all in <active part>** (whole text into the active part). Toast with what happened.
- Each section from `Patterns.splitSections` also carries **`placement: string`** (`''` when there is none): the assembly prose the parser took off an "Assembly / Finishing / Eyes deepen" block and handed to the part it names, plus that part's own "Attach safety eyes between R21&R22…" sentences (those stay row notes as well). Assembly blocks and `=== PAGE n ===` / `ADDITIONAL PHOTOS:` furniture never reach a section's `text` or its row notes. `importPatternSections` writes `placement` into `Part.placementNotes` — replacing it on a new part, adding only the lines it does not already hold (case-insensitive) on an existing one — and returns `placed` alongside `created`/`updated`; the section row and the toast say "· placing notes".
- Counter screen: the pattern line shows `notes` beneath it in a smaller muted line (joined with ' · '). A computed target renders as `≈ 24` (tilde-approx) in the stitch readout; explicit as `24`. When the working row is 1 and a setup line (row 0) exists, show it above the pattern line labelled "Setup".
- Pattern sheet: render section headers as headers, setup lines labelled, `notes` inline under their row, computed counts as `≈N` at the end of the line.

## Templates v2 (user-editable)

Templates are DATA in state, not a constant. `State.templates: Template[]`.
```js
Template = { id, name, emoji, countMode: 'rows'|'rounds', groupSize: number (default 10, 0 = grouping off),
             parts: [{ name, makeCount, patternText, placementNotes }], checklist: string[], builtIn: boolean, updatedAt }
```
`patternText` is a string, default `''`, no length limit: a template drafted from a PDF import (or
from a project) carries each part's instructions, so a project made from it starts with its rounds
already in place. Built-ins have none. `validateTemplate` and `normalizeTemplate` both keep it;
anything that is not a string normalises to `''`.
`placementNotes` is a string handled exactly the same way (default `''`, kept by `validateTemplate`,
`normalizeTemplate`, `templateFromProject` and `createProject`), so a template made from an imported
project carries each part's placing notes too.
Shipped defaults (seeded into `state.templates` on first load, and any missing built-in id is re-seeded on load so old saves get them):
- `blank` "Single piece" 🧶 rows, group 10, parts [Main], checklist []
- `sheep` "Sheep" 🐑 rounds, group 10, parts [Body, Head, Ears x2, Legs x4, Tail], checklist [Stuff body, Stuff head, Sew head to body, Attach safety eyes, Sew ears, Sew legs, Sew tail, Embroider face]
- `dragon` "Dragon" 🐉 rounds, group 10, parts [Body, Head, Wings x2, Legs x4, Tail, Horns x2, Spikes], checklist [Stuff body, Stuff head, Sew head to body, Attach safety eyes, Sew wings, Sew legs, Sew tail, Sew horns, Sew spikes down back, Embroider nostrils]
(`garment` and `blanket` are removed; `blob` is renamed to `sheep` — migrate: if a saved state has a template with id `blob`, keep it under id `sheep`.)

Store API: `Store.templates()` → array (built-ins first, then user templates by name); `Store.template(id)`; `Store.saveTemplate(tpl)` (create when no id / unknown id, else update; validates: name required, ≥ 1 part, part names non-empty, makeCount 1–99); `Store.deleteTemplate(id)` (user templates only; built-ins cannot be deleted, only reset); `Store.resetTemplate(id)` (built-in → restore shipped values); `Store.templateFromProject(projectId)` → an unsaved Template drafted from the project's parts (name + makeCount + patternText), checklist texts, countMode, groupSize, emoji, name "<project name> template". `Store.createProject` reads the template from state and copies each template part's `patternText` onto the part it makes (fresh part ids, so there is no line cache to clear). Export/import JSON includes templates with their part pattern text (import merges by id, imported wins). Undo not required for template edits.

UI:
- New-project sheet: template picker reads `Store.templates()`; each card shows emoji, name, and the part list preview; a small "Edit templates" link under the picker opens the Templates sheet.
- New-project sheet, **crochet only** (hidden for other crafts, destroyed on close): under the template picker sits the shared `pdfDropZone` (`data-tour="new-pdf"`) with a collapsed "or paste pattern text" disclosure, and below it the shared **import picker** — the same "Sections detected" (tick / rename / row counts) and "Checklist items found" lists the Import pattern sheet uses, hidden until there is something to show. Once a PDF has been read: a synthetic **"From this PDF"** card (📄, preview = the ticked section names) goes to the front of the template picker and is selected; picking a real template instead keeps the sections, which are then added on top of that template's parts. An empty Name field takes the PDF file name (without extension) as its placeholder. An **"Also save as a template"** toggle with a name input (default `<project or PDF name> template`) appears under the sections. On Save: `createProject` (template `blank` when "From this PDF" is chosen), then `importPatternSections(created.id, ticked, {mode:'parts', text})`, then the ticked checklist items, then optionally `saveTemplate` with the ticked sections as parts carrying their `patternText`; one toast, e.g. "Created Panda · 7 parts · saved as template". Creating a project is not undoable, so Undo afterwards steps back the import only.
- Template editor: a part row whose `patternText` is non-empty shows a "Pattern attached" tag, the line count and an ✕ that clears the text. Renaming, reordering and saving never drop it; there is no textarea for it here.
- Settings sheet: new section **Templates** with a list (emoji, name, "N parts", "Built-in" tag) — tap to edit; "＋ New template" button.
- **Template editor sheet**: name, emoji grid (same as project), Rows/Rounds toggle, group size stepper, **Parts** list (each row: name input, make-count stepper 1–99, ✕ remove; "＋ Add part" button; drag not required but ▲▼ move buttons are), **Checklist** list (text inputs, ✕, "＋ Add item"), Save / Cancel, and for built-ins a "Reset to default" button (confirm), for user templates a "Delete template" button (confirm). Validation errors shown inline (toast is fine).
- Project overflow menu: **Save as template** → opens the Template editor pre-filled from `Store.templateFromProject`, so the user can tweak and save.
- Empty state text for user templates section when none: "Your saved templates will show up here."

## Crafts

The app serves more than crochet. A **craft** is a plug-in module in its own files
(`js/<craft>.js` pure logic, `js/app-<craft>.js` UI, `css/<craft>.css`) that registers
itself with the shell at script time. Crochet is the shell itself: it is never
registered, it is the default, and its code paths are untouched by any of this.

The full contract — file list, script order, `App.registerCraft(def)` and its `ctx`
helpers, `#screen-craft`, the ⋯ menu rules, `BlobStore`, `PdfText.open`,
`ctx.pdfDropZone` and `Tour.register` — lives in **`docs/CRAFTS.md`**. The data model
half of it is:

```js
Project.craft: 'crochet' | 'crossstitch' | 'sewing'   // default 'crochet'; every old save migrates to it
Project.craftData: object                              // opaque to the shell, owned by the craft module
Template.craft: 'crochet' | 'crossstitch' | 'sewing'   // default 'crochet'
Template.craftData: object | null                      // seed craftData for projects made from it (deep-copied)
Settings.crafts: { [craftId]: object }                 // per-craft settings shared across projects
```

All five normalise on load and on import, so a save written before September 2026 comes
back as a crochet project with `craftData: {}` and `settings.crafts: {}`. When no module
is registered for a project's craft id, its `craftData` is kept byte for byte, so a craft
file that failed to load never costs the user their work.

Store API: `Store.registerCraft({ id, normalize, summary, templates })` (called by the
pure-logic module at script time), `Store.crafts()`, `Store.craftDef(id)`,
`Store.templates(craft?)`, `Store.createProject({ craft, craftData, … })`,
`Store.updateCraftData(projectId, patchOrFn)` (the only door a craft writes project state
through — undo snapshot, mutate, touch, debounced save), `Store.summaryFor(project)`,
`Store.craftSettings(id)`, `Store.setCraftSetting(id, key, value)`. Craft built-in
templates re-seed on load and again whenever a craft registers late. Nothing added for
crafts runs on the crochet tap path.

## Guided help (tours)

New file `js/tour.js` → `window.Tour`. A spotlight walkthrough engine plus declarative tour definitions. No dependencies.

```js
Tour.start(tourId, opts?)      // opts.onDone(); runs steps; Promise resolves when finished or skipped
Tour.stop()
Tour.list() → [{ id, title, blurb, seen: boolean }]
Tour.hasSeen(id) / Tour.markSeen(id)   // persisted via Store.settings().toursSeen (array of ids)
```
Engine: a fixed full-screen overlay that dims the page with a **cut-out** around the target element (use an SVG mask or four dim panels around the target rect; the target stays fully visible and CLICKABLE), an outline ring (`--accent-2`, 3px, `--radius-sm`) around it, and a small card (`--surface`, theme fonts) positioned below the target, or above when there is no room, clamped to the viewport with 12px margins; on phones the card may span the width. Card contains: step counter "2 of 7", title, 1–3 sentences, an optional "Try it: tap the button" hint, and buttons Back / Next (or "Done" on the last step) and a Skip link. Steps declare `{ target: selector|function → Element|null, title, body, tryIt?: string, before?: async fn (e.g. open a sheet, switch screen), placement?: 'auto'|'top'|'bottom', advanceOn?: 'click' }`. When `advanceOn: 'click'`, a real click/tap on the target advances the tour (and the app handles the click normally). Before showing a step: run `before`, scroll the target into view (`scrollIntoView({block:'center'})`), wait one frame, measure. Reposition on resize/scroll (throttled). A step whose target is missing is skipped. Escape = skip. Focus management: card gets focus; Tab stays within card. Respects `prefers-reduced-motion` (no animated spotlight moves).

Tours (write the copy warmly, short sentences, second person; every step teaches one thing):
- `home` "Around the home screen": New project button → project cards (what the summary line shows) → settings gear (themes live here) → finished shelf (mention statuses).
- `counter` "Counting a project" (requires a project open; if none exists, `before` creates a sample project "Tour sheep" from the Sheep template with a short amigurumi pattern on Body, e.g. `Rnd 1: 6 sc in MR (6)\nRnd 2: inc x6 (12)\nRnd 3: (sc, inc) x6 (18)\nRnd 4: (sc 2, inc) x6 (24)\nRnd 5-8: sc around (24)\nRnd 9: (sc 2, dec) x6 (18)`, opens it, and the final step offers "Delete the sample project" / "Keep it"): part tabs (tap to switch, tap again to edit; make-2 shows 0/2) → row counter and ± (rows vs rounds) → stitch button (`tryIt`: tap it three times; `advanceOn` not used, Next) → group readout and target (what `13 / 24` and `≈` mean, group size 0 = off) → pattern line (tap for the whole pattern, jump to a row) → Undo → Awake (keep screen on) → Alerts (buzz at stitch N) → Placing (placement notes) → timer chip → overflow menu (Import pattern, Checklist, Notes, History, Status, Save as template).
- `import` "Importing a pattern": `before` opens the Import pattern sheet for the open project (or the sample): textarea (paste straight from the PDF, mess is fine) → sections list (each becomes a part; edit names; make counts detected) → Create parts vs Put it all in → then closes the sheet; final step says where the pattern shows up and that ≈ means computed.
- `templates` "Templates and checklists": `before` opens Settings → Templates section (edit built-ins, reset, create your own) → then the project checklist (rename, reorder, reload from template) if a project is open.

Entry points (App): a **Help** item in the Settings sheet ("Help & tours" section: list from `Tour.list()` with ✓ for seen and a Replay/Start button each, plus 6 short FAQ answers: importing a pattern, what ≈ means, repeats, stitch alerts, group size 0, backups) and a **?** item in the project overflow menu that starts `counter`. First run: when the home screen is empty on first ever load (settings flag `welcomed` false), show a small welcome card in the empty state: "New here? Take the 2-minute tour" → starts `home` then chains into `counter` (sample project) then offers `import`. Set `welcomed` true regardless of choice. `Store.settings()` gains `toursSeen: string[]` and `welcomed: boolean` (migrate on load).

## PDF import (in-app)

New file `js/pdftext.js` → `window.PdfText`. Uses the vendored pdf.js 3.11.174 UMD build at `./js/vendor/pdf.min.js` (worker `./js/vendor/pdf.worker.min.js`), loaded lazily on first use via a dynamically inserted `<script>`; both files are precached by the service worker so it works offline. Everything runs on-device; no network besides loading the library.

```js
PdfText.extract(file, { onProgress(page, total) }) → Promise<{ text, pages, chars, columnsDetected: number }>
PdfText.isAvailable() → boolean   // false when the library cannot load (offline first run without cache)
```
Extraction rules (this is what makes the parser's life easy):
- Per page, group text items into lines by Y (tolerance 2.5 units), sort lines top→bottom, items left→right, join items with a space, collapse whitespace.
- **Column detection:** for pages with ≥ 12 lines, build the set of x-spans (start..end) of every item; if there is a vertical gap band ≥ 14 units wide located between 30% and 70% of the page width that no item spans, for ≥ 70% of lines, treat the page as two columns: emit all left-column lines (top→bottom) first, then all right-column lines. Same rule applied recursively at most once (3 columns max). Else emit single-column. Report how many pages were split in `columnsDetected`.
- Join fragments like `fi nished` / `stuf fi ng` (pdf ligature splits: a lone `fi`/`fl` token with spaces around it) back into the word.
- Insert `=== PAGE n ===` markers between pages (the parser treats them as notes).
- Drop lines that are only page furniture: pure page numbers (`3 of 6`, `Page 3`), `©`/`@ 20xx ... All Rights Reserved` lines, lines that are only single capital letters (photo labels).

Store: `Store.suggestChecklist(text) → string[]` — from the pasted/extracted text, collect imperative assembly steps: lines (or note paragraphs) in sections whose header is Assembly / Finishing / Construction / Sewing, plus any line anywhere that starts with `Sew`, `Attach`, `Stuff`, `Embroider`, `Weave in`, `Block`, `Insert (safety) eyes`, `Glue`, `Fasten off and sew`, `Join`, trimmed to ≤ 90 chars, de-duplicated, max 20. Uses `Patterns.parse` kinds/notes where helpful.

App (Import pattern sheet):
- A **drop zone** above the textarea: dashed border, icon, "Drop a pattern PDF here, or **choose a file**" (the whole zone is a button; `<input type="file" accept="application/pdf,.pdf">` hidden; on phones the button opens the file picker). Drag-over state highlights it. Accepts one PDF; non-PDF → toast "That isn't a PDF".
- While extracting: zone shows "Reading page 3 of 21…" with a slim progress bar; the sheet stays usable. On success: textarea is filled (replacing content, after a confirm if the textarea already had text), a line under the zone says "Read 9 pages · 2 columns untangled · 4,120 characters", and the sections list refreshes as usual. On failure: toast with the reason ("Couldn't read that PDF (it may be scanned images)").
- New **Checklist items found** block under the sections list: checkboxes (default on) for `Store.suggestChecklist(text)` results; "Create parts" and "Put it all in…" both also append the checked items to the project checklist (skipping duplicates by text, case-insensitive), and the toast mentions "+ 6 checklist items".
- Home empty state and the New project sheet get a short line: "Have a pattern PDF? Create the project, then use menu → Import pattern to drop it in."
- The import tour gets a first step on the drop zone ("Drop the PDF from your pattern shop right here, or paste text below").
- The `sw.js` PRECACHE list gains `./js/pdftext.js`, `./js/vendor/pdf.min.js`, `./js/vendor/pdf.worker.min.js`.

## Themes contract

`css/themes.css` defines, for each `html[data-theme="<id>"]`, ALL of these variables. `css/app.css` uses only these (plus its own layout numbers). Defaults for `:root` (no attribute) must equal `stardew-spring`.

```
--bg              page background color
--bg-image        page background: a CSS `background-image` value (subtle SVG data-URI pattern, or `none`)
--surface         cards / sheets
--surface-2       nested surfaces, inputs
--text            main text
--text-muted      secondary text
--border          1px border color
--primary         main button bg (the big stitch button)
--primary-text    text on primary
--primary-glow    box-shadow color for pressed/active primary
--accent          secondary button bg (row button)
--accent-text
--accent-2        highlights, progress bar fill, active tab
--danger          destructive
--success
--radius          card radius (e.g. 18px; pixel theme uses 0)
--radius-sm       small controls radius
--shadow          card box-shadow value
--font-body       font-family stack
--font-display    font-family for big numbers + headings
--counter-size    font-size of the big row number (e.g. 96px)
--tap-border      border shorthand for the big tap button (pixel theme: 4px solid ...)
--header-bg       app header background (may be a gradient)
--header-text
--mascot          `url("data:image/svg+xml,...")` — a small cute theme mascot SVG (junimo, stardrop, pumpkin, night fury, red dragon, pixel dragon) used as decoration in the header/empty state. ~64px.
--overlay         modal backdrop color (rgba)
--color-scheme    'light' or 'dark' (app.css does `color-scheme: var(--color-scheme)`)
```

Theme ids and directions:
| id | name | group | vibe |
|---|---|---|---|
| `stardew-spring` | Pelican Town Spring | stardew | cream/soft greens/peach, wooden accents, junimo mascot, rounded, light |
| `stardew-night` | Stardrop Night | stardew | deep navy/purple, stars bg, stardrop-purple primary, dark |
| `stardew-harvest` | Harvest Festival | stardew | warm autumn: pumpkin orange, mustard, barn red, wood brown; pumpkin/leaf mascot, light |
| `dragon-fury` | Night Fury | dragon | HTTYD Toothless: charcoal/black surfaces, toothless-green (#7bd389-ish) accents, soft round shapes, plasma-blue glow, dark |
| `dragon-throne` | Fire & Blood | dragon | GoT/Targaryen: parchment bg, deep crimson primary, black + gold accents, serif display font, subtle scale pattern, light |
| `dragon-pixel` | Pixel Wyrm | dragon | 8-bit: pixel font (Press Start 2P), 4px hard borders, radius 0, hard offset shadows, limited retro palette, image-rendering pixelated, dark |

Google Fonts are allowed (loaded from `<link>` in index.html); every family must have a system fallback. Suggested: Nunito (body, stardew), Fredoka (display, stardew), Cinzel (display, throne), Press Start 2P (pixel), Quicksand (fury).

`js/themes.js`:
```js
window.Themes = [ { id, name, group: 'stardew'|'dragon', tagline, emoji, swatches: [bg, primary, accent, accent2] }, ... ]
```

## Celebrate API (`window.Celebrate`)

```js
Celebrate.play(themeId, { kind: 'project'|'part'|'piece'|'row' })   // returns Promise resolved when done
Celebrate.stop()
```
Creates a fixed, full-screen, pointer-events:none overlay (`<div class="celebrate">`) and removes it when done. `kind: 'project'` is the big one (2.5–3.5s): junimos hopping + confetti (stardew-spring), stardrops + shooting stars (stardew-night), leaves + pumpkins (stardew-harvest), a Night Fury flying across with plasma glow (dragon-fury), fire + falling embers with a dragon silhouette (dragon-throne), pixel fire + pixel dragon sprite (dragon-pixel). `part`/`piece` is a smaller 1.2s burst of the theme's particle. `row` is not used by default (returns immediately). Everything inline SVG/CSS/JS, respects `prefers-reduced-motion` (shortened, no large movement).

## Feedback API (`window.Feedback`)

```js
Feedback.init(settingsGetter)   // function returning { haptics, sounds }
Feedback.tap()      // stitch: 10ms vibrate, short soft click
Feedback.group()    // group boundary: [15, 40, 15], slightly higher tone
Feedback.row()      // row done: [30, 50, 30], rising two-note
Feedback.alert()    // stitch alert: [60, 60, 60, 60, 60], alternating tone
Feedback.done()     // part/project done: longer pattern, little arpeggio
Feedback.undo()     // brief low tone
```
Uses `navigator.vibrate` when present (Android), WebAudio oscillator sounds synthesized on the fly (no audio files). AudioContext is created lazily on first user gesture and resumed if suspended (iOS).

## Screens (App)

1. **Home** (`#screen-home`): header (mascot + "Stitchkeeper" + settings gear). Empty state if no projects ("No projects yet" + New project button). Active/paused project cards: emoji, name, status pill, "Body · Rnd 12 · 24/30 sts" summary of active part, updated-ago, timer total. Tap card → open project. "Finished shelf" collapsible section listing finished/frogged projects. Floating "+ New" button.
2. **New/Edit project sheet**: name, emoji grid (🧶🐑🐄🐖🐔🐰🐉🐲🦖🐢🐙🐸🦊🐻🧣🧥🧸🌵🌙⭐), template picker (cards with emoji + part list preview; edit mode hides template), Rows/Rounds toggle, group size stepper (1–50), notes textarea. Save/Cancel. Delete project (edit mode; confirm).
3. **Project screen** (`#screen-project`): 
   - Header: back, emoji+name (tap → edit), timer chip (tap to start/stop; shows h:mm:ss), overflow menu (Parts, Checklist, Notes, History, Status, Export).
   - Part tabs: horizontal scroll chips; each shows name + `1/2` piece progress when makeCount>1 + ✓ when done. Last chip "＋ part". Tap active chip again → part editor.
   - Repeat readout (if enabled): "Repeat 2 of 6 · row 3 of 4".
   - Big row counter: label "ROW"/"ROUND", number in `--font-display` at `--counter-size`, `–` and `+` buttons; progress bar + "12 / 40" when targetRows.
   - Pattern line: current pattern row's text (from `Patterns.lineFor(lines, patternRow)`); tap → opens full pattern sheet with the line highlighted and scrolled into view. Hidden if no pattern.
   - Stitch section: HUGE tap button (min 45vh on phones) showing stitch count; below it "Group 3 of 12 · stitch 4 of 10" and, if target, "24 / 30" with a slim bar. `–1` button. Small "reset stitches" link.
   - Bottom bar: Undo, Keep awake toggle (sun icon), Alerts (bell, shows count), Placement notes (pin, shows if any).
   - Piece/part completed toasts: "Wing 1 of 2 done! Starting wing 2." Part done: "Body complete ✓". Project done → status finished + `Celebrate.play(theme,{kind:'project'})` + sheet "All parts done! 🎉 Assembly checklist →".
4. **Part editor sheet**: name, make count stepper, target rows, repeat (enable, start, end, times), stitch alerts (comma list), placement notes, pattern text (textarea, monospace-ish, shows "Parsed: 24 rows, targets found" using `Patterns.summary`), Reset counts, Delete part (not if only one).
5. **Pattern sheet**: full pattern with lines; current line highlighted; tapping a line with a row number jumps the counter to that row (confirm).
6. **Checklist sheet**: checkable items, "3 of 8 done", add item, ✕ delete, ▲▼ reorder, tap an item's text to rename it inline (Enter/blur saves, Escape cancels), "Clear completed" and "Clear all" (both confirm), and "Reload from <template>" (replaces the list with `Project.templateId`'s checklist; hidden when the project has no template or it no longer exists). Store: `renameChecklistItem`, `moveChecklistItem(projectId, itemId, delta)`, `clearChecklist(projectId, { completedOnly })`, `reloadChecklistFromTemplate(projectId)`.
7. **Notes sheet**: project notes textarea (autosaves).
8. **History sheet**: list of completed rows with time (newest first), "Clear".
9. **Settings sheet**: theme grid (6 cards with swatches, grouped Stardew / Dragon, current one highlighted; tap applies instantly), haptics toggle, sounds toggle, auto-advance toggle, Export (downloads `stitchkeeper-backup-YYYY-MM-DD.json` via Blob + `<a download>`; also uses `navigator.share` with a File when available on mobile), Import (file input), About/version.

Status change sheet: Active / Paused / Finished / Frogged with short explanations.

## UX rules
- Mobile first, 100dvh layouts, `env(safe-area-inset-*)` padding, `touch-action: manipulation`, `user-select: none` on tap surfaces, no 300ms delay, `-webkit-tap-highlight-color: transparent`.
- Big tap button: press-and-release counts. `pointerdown` takes pointer capture and shows the press state but counts nothing; `pointerup` counts one stitch if the pointer never moved more than 12px (`MOVE_TOLERANCE_SQ`), synchronously so it still feels instant. Move past the tolerance and the gesture becomes a **swipe that rotates the live 3D piece** (`handle.dragStart/dragMove/dragEnd`) and the lift counts nothing. Nothing is ever undone by the gesture. Keyboard activation (click with `detail === 0`) counts. Double tap on the button is two stitches, not a view reset.
- All state changes go through Store; App re-renders the current screen from state (simple `render()`; fine-grained updates optional for the counters to keep taps snappy).
- Sheets are bottom sheets on phones, centered dialogs ≥ 700px wide. Close on backdrop tap and Escape. `<dialog>` element is fine.
- Undo toast after destructive things (delete project → "Deleted. Undo" for 6s).
- Keep awake: `navigator.wakeLock.request('screen')` when toggled on AND project screen visible; re-acquire on `visibilitychange` visible. Hide toggle if unsupported.
- Theme applies via `document.documentElement.dataset.theme` and `<meta name="theme-color">` updated to `--header-bg` solid color.
- Accessible: buttons have aria-labels, live region announces "Row 13" for screen readers, focus-visible outlines.
- No external network calls except Google Fonts.

## PWA
- `manifest.webmanifest`: name "Stitchkeeper", short_name "Stitchkeeper", start_url "./", scope "./", display "standalone", background/theme colors, icons 192/512 (any + maskable).
- `sw.js`: precache app shell on install (`./`, `./index.html`, css, js, manifest, icons), cache-first for same-origin + fonts.googleapis/gstatic (opaque ok), network-first for `./index.html` navigation with cache fallback. Bump `CACHE_VERSION` on release; delete old caches on activate; `self.skipWaiting()` + `clients.claim()`.
- `index.html` has `<link rel="apple-touch-icon">`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style` = `black-translucent`, viewport `viewport-fit=cover`.


## Live 3D diagram (branch `feature/live-diagram`)

Goal: inside the big stitch button, show the piece being made as a **slowly rotating 3D model**, updated in real time as the user taps. A round-worked piece is a **stack of rings** (one ring per round, ring circumference = stitch count), which is a solid of revolution: sphere for increase-then-decrease, cone for a horn, tube for a body. Each stitch is a small bump on its ring, coloured by yarn. A row-worked piece is a gently curved sheet of stitch bumps. Colours come from the pattern (colour changes, colour prefixes, legends) or the user's yarn colour settings. The current round shows only the stitches tapped so far; future rounds from the pattern are faint wireframe ghosts. With no pattern, the model is built purely from what was actually tapped.

### Three work packages, three contracts

**1. Parser additions (`js/patterns.js`)**
```js
Patterns.colors(text) → {
  legend: { 'A': 'Almond', 'S': 'Sand' },          // from "( A = Almond )", "A = Almond", "MC = Main colour"
  names: ['Twilight','Almond','Sand','black','yellow','Color A','Color B'],  // every yarn colour name mentioned, first-seen order
}
Patterns.expand(lines, rowNumber, prevCount, state) → {
  stitches: [ { t: 'sc'|'hdc'|'dc'|'tr'|'inc'|'dec'|'sl'|'ch'|'bbl'|'puff'|'x', c: string|null } ],  // one entry per PRODUCED stitch; inc yields 2 entries (t:'inc'), dec yields 1 (t:'dec'); c = colour NAME or null (= row colour)
  color: string|null,          // the row's base colour name (state carried from previous rows), null if unknown
  height: number,              // 1 (sc/sl/x), 1.5 (hdc), 2 (dc), 2.5 (tr): dominant stitch of the row
  state: object                // opaque; pass back for the next row (tracks current colour, legend)
}
Patterns.colorHex(name) → '#rrggbb' | null
```
Rules: colour state flows row to row: `In Twilight :`, `In Color A`, `With MC`, `Using yellow` set the base colour (from notes attached to the row or header lines before it); `Colour change to black`, `change to Color B`, `switch to yellow` attached to row N sets the base from row N; `Fasten off Almond` ends a secondary colour; prefixes `A (Sc 5)`, `S (Dec x 12)`, `MC: sc 6`, `(in B) sc 3` colour just that group; `Rnd 5 (yellow): ...` colours the row. When a row cannot be evaluated but has a count, emit `count` × `{t:'x', c:null}`. Never throw; on any failure return `count` generic stitches. `colorHex` knows ~120 yarn colour words (black, white, cream, ivory, almond, sand, beige, tan, brown, chocolate, twilight → dark navy, navy, teal, sage, mint, forest, olive, lime, yellow, mustard, gold, orange, coral, peach, pink, blush, rose, red, burgundy, maroon, purple, lavender, lilac, plum, grey/gray, silver, charcoal, sky, baby blue, denim, turquoise, aqua, ...) and returns null for `Color A`, `MC`, `CC` and unknown words (the app maps those).

**2. Renderer (`js/diagram.js`, new, `window.Diagram`) — 3D, WebGL**
```js
Model = {
  mode: 'rounds' | 'rows',
  rounds: [ {                      // in work order; index 0 = first round/row
    count: number,                 // stitches this round will have (known or planned); 0 allowed
    done: number,                  // stitches completed so far (= count when finished)
    stitches: [ { t, c: '#hex'|null } ],   // may be shorter than count (then repeat last / generic)
    color: '#hex',                 // base colour for the round
    height: number,                // 1 = sc height
    ghost: boolean,                // planned from pattern, not started
  } ],
  current: number,                 // index of the round being worked
  defaultColor: '#hex',
}
Diagram.mount(canvas, { palette: { ghost, ink, glow, bg }, reducedMotion, interactive: false }) → handle
handle.setModel(model, { animate: 'stitch' | 'round' | 'none' })
handle.setPalette(palette); handle.resize(); handle.destroy()
handle.setInteractive(true|false)   // drag to rotate, wheel/pinch to zoom, double-tap resets (the expanded viewer)
handle.resetView()
handle.dragStart(); handle.dragMove(dxCssPx, dyCssPx); handle.dragEnd()
    // host-driven rotation for a canvas that cannot take pointer events itself
    // (the one under the stitch button is `pointer-events: none`). Works with
    // `interactive` off, shares every line of the pointer path, so the button
    // and the viewer can never disagree about direction or inertia.
handle.getStats() → { fps, frameMs, buildMs, triangles, drawCalls, chunks, verts,
                      yaw, pitch, userPitch, zoom, fitScale, dragging, running }
```
Implementation: raw WebGL 1 (no dependency; ~1 vertex + 1 fragment shader, Lambert + soft rim light, vertex colours). If raw WebGL proves too slow to write well, vendoring three.js r128 UMD (`three.min.js`, cdnjs) into `js/vendor/` is acceptable; say which you chose. Canvas 2D fallback (flat shaded silhouette) when WebGL is unavailable.
- **Geometry, rounds mode**: ring i has radius `R_i = max(R_min, count_i * SW / 2π)` and sits at height `y_i = -Σ height_k * SH` (round 1 at the top; the piece grows downward). Between consecutive rings build a triangle strip. Each stitch of a ring occupies an angular slice; subdivide each slice into 4 segments and displace the middle vertices outward (+bump) and the slice edges inward, so the surface reads as a knobby crochet texture; `inc` slices are wider, `dec` narrower, `sl`/`ch` flat. Vertex colour = stitch colour (or the round colour). Round 0/1 stitches (magic ring) = a small cap. The ring being worked: only `done` slices are solid; the remaining slices of that ring are drawn as a translucent wireframe **grid** in `palette.ghost` at alpha 0.72 (cells waiting to be filled), and every future round as a single bare **ring** at alpha 0.20 — a full grid on every planned round reads as a cage at button size. Close the top with a cap when round 1 is a magic ring; leave the bottom open (you see inside a tube slightly, which looks right).
  The stitch bump must taper to zero at the top and bottom edge of its band. Consecutive rounds have different stitch counts and different per-stitch amplitudes, so any bump left at the shared ring makes the two bands disagree about its radius and hairline cracks of background show between every round.
- **Rows mode**: rows stacked bottom-up as a sheet in the XZ plane tilted toward the camera, width = count × SW, row height by `height`; each stitch is a bump; odd/even rows offset half a stitch; current row partial from left (odd) or right (even); ghost rows wireframe. Gentle curvature (cylinder radius ≈ 3× width) so rotation shows depth.
- **Camera & motion**: perspective camera, slight downward pitch (~20°), auto-rotate around the vertical axis at ~12°/s (pauses for 1.5s after each model change or drag so the new stitch is seen, then resumes **from wherever the user left the yaw**), model auto-fit so the whole solid part (ghosts capped so they can't shrink the real piece below 45% of the view) fits with 8% margin; scale and camera distance ease over 200ms. `interactive`: pointer drag rotates (inertia), wheel/pinch zooms, double-tap resets. `reducedMotion`: no auto-rotate, no scale-in, no pitch return.
- **Rotation direction (never invert this)**: the model follows the finger like a physical ball. Drag right → the surface nearest the camera travels right (`yaw += dx·k`); drag down → the near surface travels down so more of the *top* comes into view (`userPitch += dy·k`). `k = π / canvas CSS width`, i.e. a full-width drag is half a revolution at any canvas size. Verify on screen with an identifiable feature (a colour panel, the unworked arc of the current round), never from the matrices. Flick inertia is real pointer velocity, capped at 3.5 rad/s. The user's yaw is kept; the user's pitch eases back to the default over ~1.7s once the 1.5s pause is over, so the piece never sits stuck at an awkward angle.
- **Material**: a warm wrapped key light, a cool bounce fill, and a two-lobe sheen (broad `pow(N·H, 7)` plus a faint tight lobe) tinted halfway toward the yarn colour — wool scatters, so a white specular blob turns it to plastic. Fresnel rim at 0.30. Baked crevice AO at the slice edges (17%) and band edges (7%). Per stitch, seeded noise moves lightness ±7.5%, warm/cool ±4.5% and bump amplitude ±10%, which is the difference between "extruded plastic" and "crocheted". The **wrong side** of the fabric (`dot(N, V) < 0`, i.e. the inside of an open tube) is darkened to 42% and loses most of its rim — ramped, not stepped, or the silhouette speckles where interpolated normals cross zero.
- **Grounding**: a soft elliptical contact shadow (a vertex-weighted disc, black premultiplied, drawn after the solids with `depthMask(false)`) sits on the plane where the finished piece will rest — the bottom of the whole model, which the ghost cage reaches down to — with the radius of the widest fabric that actually exists, clamped to the fitted radius so it can never be clipped. It fades in as the work grows down to that plane (`smoothstep(0.45, 0.92, grown)`) and fades out as the camera comes level with the piece, so it never appears when looking from below. Plain black, so it never clashes with a theme's `--primary`.
- **Animation**: `animate:'stitch'` → the newest bump scales in from 0 over 140ms with slight overshoot; `'round'` → the finished ring flashes once with `palette.glow`. Redraw only via requestAnimationFrame while something changes or auto-rotating; must stay ≤ 4ms/frame for 60 rounds × 60 stitches on a mid phone (cap 160 slices per ring; subsample beyond). DPR-aware, transparent clear colour so the button colour shows through.
- Deliver `test/diagram.test.html`: canvas + buttons for sample models (sphere 6→48→6, cone/horn, striped tube, bear head with a belly-panel colour run, a 30-row blanket), a "tap" button that advances `done` with animation, a "complete round" button, an interactive toggle, and a theme switcher for the background colour. Plus a **Gesture** panel: "Drag right/down" buttons that drive `dragStart/dragMove/dragEnd` in controlled steps and print yaw/pitch, a "Finish piece" button (the contact shadow only appears once the work reaches the ground plane) and a quadrant-coloured model whose four colour panels make the rotation direction unmistakable.

**3. App integration (`js/store.js`, `js/app.js`, `index.html`, `css/app.css`, `js/tour.js`)**
- `Part.rowStitches: number[]` (index = row number, 1-based; value = stitch count when that row was completed). `tapRow` records `part.stitch` (or the target when auto-advanced) before resetting; `untapRow` pops; `resetPart` clears; normalised on load.
- `Project.yarnColors: { [name]: '#hex' }` with reserved key `'*'` = main yarn colour (default warm cream `#f1e3c8`).
- `Store.diagramModel(part, project) → Model`: rows 1..max(part.row + 1, pattern maxRow, rowStitches.length); per row: if a pattern line exists → `Patterns.expand` (state carried row to row), colours resolved as `yarnColors[name] || Patterns.colorHex(name) || yarnColors['*']`; else if `rowStitches[row]` → that many generic stitches in the main colour; else if it is the current row → `count = max(part.stitch, target || 0)`; `done` from rowStitches / part.stitch; `ghost = row > current`. Cache per part (key: patternText, sizeIndex, yarnColors, row, rowStitches.length) and on the tap path only mutate the current round's `done`/`count`.
- App: `<canvas id="stitch-canvas">` inside `#stitch-btn` behind the caption/number (absolute, inset 0, `pointer-events:none`; number/caption get a soft text shadow), `Diagram.mount` when the project screen renders, `setModel(..., {animate:'stitch'})` on the tap fast path, `'round'` on row completion, `setPalette` on theme change, `destroy` when leaving. The canvas is `pointer-events: none`, so the stitch button's own pointer handlers drive rotation through `handle.dragStart/dragMove/dragEnd` once the pointer passes the 12px tolerance (see "UX rules"); the handle is also parked on the canvas element as `canvas.diagram` so `getStats()` can be read from a console. A small ⤢ button in the corner of the stitch section opens the **3D viewer sheet**: full-height canvas with `interactive: true`, the part name, round/stitch readout, and a Yarn colours button. Settings toggle **Live diagram** (default on; off removes the canvas). New sheet **Yarn colours** (project overflow menu + from the viewer): Main yarn plus every name from `Patterns.colors` across the project's parts, each with `<input type="color">` and the resolved swatch; edits update the model live.
- Tour: add one counter-tour step for the diagram ("This is your piece growing as you count. Tap ⤢ to spin it around.").
- Bump `CACHE_VERSION`, precache `./js/diagram.js` (and `three.min.js` if vendored).
