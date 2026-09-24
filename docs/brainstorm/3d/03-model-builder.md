# 03 · The Model builder's correctness

**Lens:** does the Model that `Store.diagramModel` hands `Diagram.setModel` contain what a faithful render needs?

**Method.** Read `SPEC.md` → "Live 3D diagram", `js/store.js` `buildDiagramModel` / `diagramModel` / `diagramKey` / `applyLiveRound` / `linesFor` / `lineForRow` / `patternRowForRow` / `targetFor` / `makeColorResolver`, and `js/patterns.js` `expand` / `expandInstruction` / `expandSegment` / `stitchTok` / `VOCAB` / `dominantHeight` / `fitTo` / `colors` / `colorHex`. Then exercised both layers in the Browser pane: `test/patterns.fixtures.html` (all 43 fixtures extracted, `window.__pdfText`) for per-round `Patterns.expand` dumps, and the app at `http://localhost:8766` for `Store.diagramModel(part, project)` — snowman imported for real through **New project → PDF → Save** (project `ZD3_Snowman`, deleted afterwards; the other fixtures were driven through `diagramModel(prt, proj)` with in-memory parts carrying the same `Patterns.splitSections` text, to avoid trampling another wave-1 agent's projects in the shared `localStorage`).

**Verdict.** For one dialect — `Rnd 3: (2 sc, inc) x6 (24)` — the Model is genuinely good: counts, inc/dec **positions in order**, dc/hdc heights, legend colours. For every other dialect in the corpus it degrades in one of four ways that the renderer cannot recover from: **all stitches become `x`** (fish), **all inc/dec become plain `sc`** (panda, Persian Tiles), **`count: 0` rounds appear in the middle of the piece** (hex socks, Bernat basketweave, Premier wrap), or **the piece is the wrong topology** (snowman rendered as a flat sheet). Separately, two of the three worst bugs are in the store, not the parser: the long-pattern window is anchored to the wrong end, and the O(rows²) cost blamed on `lineFor` in HANDOFF 12 is actually `linesFor`'s cache key.

---

## Findings

### 1. The long-pattern window is anchored to the end of the pattern, not to the working round · **model is unrelated to the work**

`buildDiagramModel` windows with `start = Math.max(1, total - DIAGRAM_MAX_ROUNDS + 1)` where `total = max(workingRow, maxRow, rs.length-1)`. When the pattern is longer than 400 rounds and the user is near the beginning, `workingRow < start`, so `current < 0` falls through to `current = rounds.length - 1` — and then `applyLiveRound` writes the live stitch count onto that round.

600-round synthetic pattern (`Rnd 1: 48 sc in magic ring` + 599 × `sc in each st around. (48)`), user on round 5 with 7 stitches tapped:

```
mode=rounds rounds=400 current=399        // rounds 201..600 are in the model; 1..200 are gone
rounds[0]   cnt=48 done=0 ghost=1         // this is pattern round 201
rounds[399] cnt=48 done=7  ghost=0        // pattern round 600, wearing the user's 7 stitches
```

Every round the user has actually worked is off-screen, the whole visible piece is a ghost cage, and the current-round grid sits at the far end. `DIAGRAM_MAX_LIVE_ROWS` (250) keeps this out of the stitch button but **not** out of the ⤢ 3D viewer, which is exactly where a 900-round blanket gets opened.
**Expected:** a window centred on the working round (`start = clamp(workingRow - K, 1, …)`), and `current` must always be inside it.

### 2. HANDOFF 12 blames the wrong function: it is `linesFor`'s cache key, not `Patterns.lineFor`

Instrumented build of a 1,500-row pattern (54,390 chars), user on row 700:

| | calls | ms |
|---|---|---|
| whole `diagramModel` build | 1 | **434.2** |
| `Patterns.expand` | 1500 | 56.4 |
| `Patterns.parse` | 1 | 30.5 |
| `Patterns.lineFor` (timed inside) | 1500 | 4.5 |

340 ms is unaccounted for by any `Patterns.*` call. Timed directly on the same part:

```
Store.linesFor(prt)            × 1500  → 312.0 ms   (0.21 ms each, cache HIT every time)
Store.lineForRow(prt, i)       × 1500  → 303.5 ms
Patterns.lineFor(lines, i)     × 1500  →   6.2 ms   ← the actual line lookup
Store.targetFor(prt, i)        × 1500  → 329.6 ms
```

`linesFor` builds `var key = size + ' ' + text` and compares it *on every call* — a 54 KB concatenation + comparison 1,500 times. `buildDiagramModel` already holds `lines` in a local, then throws it away and calls `lineForRow(prt, …)`, which re-enters `linesFor`. So the quadratic term is string work in the cache key, and a row→line index (the HANDOFF's suggested fix) would leave most of it in place. Scaling measured: 100 rounds 9.3 ms · 250 rounds 26 ms · 500 rounds 67 ms · 1000 rounds 212 ms · 1500 rounds 406 ms.
The tap path is genuinely cheap — cached `diagramModel` is **0.009 ms** on the 1,500-row part (`diagramKey`'s full-text concat costs nothing measurable; V8 ropes it). Do not "optimise" `diagramKey`.

### 3. The long-form inc/dec dialect loses every increase and decrease

Panda head (`Store.diagramModel`, `mode: rounds`), the entire Yarnspirations / Red Heart house style:

```
[1] cnt=12 h=1 sts=12 | 12xsc      txt: Rnd 2: 2 sc in each st around. (12)
[2] cnt=18 h=1 sts=18 | 18xsc      txt: Rnd 3: (Sc in next st, 2 sc in next st) around. (18)
[7] cnt=48 h=1 sts=48 | 48xsc      txt: Rnd 8: Sc in next 3 sts, 2 sc in next st, (sc in next 6 sts, 2 sc in next st) 5 times, sc in next 3 sts. (48)
[16] cnt=42 h=1 sts=42 | 42xsc     txt: Rnd 17: … sc next 2 sts tog, (sc in next 6 sts, sc next 2 sts tog) 5 times …
```

Counts are right; **not one `inc` or `dec` entry exists**. `expandSegment`'s `R_N_IN_NEXT` branch (`2 sc in next st`) returns `emit(stitchTok('sc'), 2)` — two plain `sc` with `consumed = 1`. The count arithmetic is correct because `c` is right, but the *type* is a lie. Consequences: the spec's "`inc` slices are wider, `dec` narrower" texture never fires, and the increase **positions** — the only thing that distinguishes a sphere from a hexagon from an oval — are unrecoverable. Same for Persian Tiles `[2 sc in next dc, sc in next dc]`.
Compare the short dialect, which is perfect (snowman body, imported for real):

```
[4]  cnt=30 sts=30 | 3xsc 2xinc 3xsc 2xinc 3xsc 2xinc 3xsc 2xinc 3xsc 2xinc 3xsc 2xinc
[24] cnt=18 sts=18 | 2xsc dec 2xsc dec 2xsc dec 2xsc dec 2xsc dec 2xsc dec     ← the waist
[25] cnt=24 sts=24 | 2xsc 2xinc 2xsc 2xinc …                                   ← second sphere starts
```

### 4. A colour change written **on the row** is ignored — colour propagation is broken for the common case

```js
Patterns.expand on:
  ( A = Almond, S = Sand )
  Rnd 1: 6 sc in magic ring (6)
  Rnd 2: A (Sc 3), S (Sc 3) (6)
  In Twilight :
  Rnd 3: sc in each st around (6)
  Rnd 4 (yellow): sc in each st around (6)
  Rnd 5: Colour change to black, sc in each st around (6)
→ R1 rowColor=-        perStitch={-:6}
  R2 rowColor=-        perStitch={Almond:3, Sand:3}      ✓ legend + prefix groups work
  R3 rowColor=Twilight                                    ✓ note line works
  R4 rowColor=yellow                                      ✓ "(yellow)" works
  R5 rowColor=yellow   ← WRONG, should be black
```

```js
  Rnd 1: With white, 6 sc in magic ring (6)
  Rnd 3: Change to black. sc in each st (6)
→ R1 rowColor=-   R2 rowColor=-   R3 rowColor=-           ← nothing at all
```

`expand` calls `applyPhrases` on preceding `note`/`header` lines and on `line.notes`, **never on the row's own text**. `C_IN` is anchored at `^` anyway, so `Rnd 1: With white, …` could not match even if it were called. SPEC requires "`Colour change to black`, `change to Color B`, `switch to yellow` attached to row N sets the base from row N". This is why every panda head round reports `c=-` although round 1 says "With white" and the pattern is a black-and-white panda: a two-colour piece renders in one colour.

### 5. Rows the parser cannot count become `count: 0` rounds **inside** the model

`buildDiagramModel` has no "unknown" state: expand yields `[]`, `countOf(line)` is `null`, `rs[row]` is 0, the row is not the working row → `count = 0`, `stitches = []`. The renderer is handed a zero-circumference ring / zero-width row it must draw between two real ones.

Premier Sparkling Wrap (`mode: rows`, 46 rows):
```
[0] cnt=405 sts=405 | 405xx     Row 1 (RS): Sc in 2nd ch from hook and in each ch across; turn - 405 sc.
[1] cnt=0   sts=0   |           Row 2: Ch 1, sc in first sc, * ch 3, sk 3 sts, sc in next sc; rep
[2] cnt=405 sts=405 | 405xsc    Row 3: … (tr, dc, hdc, sc) in same ch-3 sp …
[3] cnt=405 sts=405 | 405xsc    Row 4: Ch 6, sc in 3rd ch of next ch-3 sp …
[4..43] cnt=0 sts=0 |           Rows 5-44: Rep Rows 3 and 4.
[44] cnt=0, [45] cnt=0
```
A 46-row wrap that is two real rows and 44 slivers — a comb, not a sheet.

Bernat basketweave (`mode: rows`): `[0] cnt=98 | dc 97xsc`, then `[1]..[4] cnt=0`.
Stylecraft hex socks (`mode: rounds`): **all 15 rounds `cnt=0 sts=0`** — the model is completely empty.
Persian Tiles First Square `[5] cnt=0` (Rnd 6, the picot/shell border round). Snowman hat `R12: FRONT LOOP ONLY: (sc, sc inc) around` → `cnt=0` as the final round of the hat.
Gosyo lace doily: chart-only text, no row lines at all → `rounds=1, cnt=0` (acceptable degradation, but it is indistinguishable from "a round of zero stitches").

**Expected:** `count: null` plus `unknown: true`, or carry the previous round's count forward with `estimated: true`, so the renderer can draw a plausible band or skip it instead of collapsing the solid.

### 6. Range lines that say "repeat row N" are never resolved

`Rows 5-44: Rep Rows 3 and 4.` and `Rnds 4-9: Rep Rnd 3. 9 x 3tr groups` / `Rnd 11: Rep Rnd 3. 11 x 3tr groups` are mapped to the right *row numbers* (the range expands — `lineFor` returns that line for rows 5…44) but `expand` cannot evaluate "Rep Rows 3 and 4", so they all come out empty (finding 5). Nothing in the Model or the parser carries "row 7 is a copy of row 3". Ranges that restate the instruction work fine — baphomet `R13-R42: 6sc around (30 rounds)` expands to 30 identical rounds, turtle `Rnd 7+8: 42 sc` to two, snowman `R12-R17`/`R31-R35` correctly.

### 7. `fitTo` pads with `sc` and then `dominantHeight` votes — a dc row reports sc height

```
Bernat basketweave [0]:  cnt=98  h=1  | dc 97xsc     1st row: (RS). 1 dc in 4th ch from …
Persian Tiles     [0]:  cnt=16  h=2  | 15xdc sc      Rnd 1: Ch 3, 15 dc in ring; join with a sl st to top of ch-3 - 16 sts.
```
`expand` produced one `dc`, `fitTo(list, 98)` padded 97 × `{t:'sc', h:1}`, and `dominantHeight` then elected **1**. A 98-stitch double-crochet row is handed to the renderer at single-crochet height — the whole basketweave blanket is drawn at 50 % of its height. The Persian Tiles case shows the same padding as the trailing `sc` (the `ch 3` join counted as a stitch) in an otherwise clean dc round.
**Expected:** pad with the row's dominant token, not `sc`; and take `height` from the *evaluated* stitches only, never from padding.

### 8. Per-stitch height is computed and then discarded

`stitchTok` returns `h` per token and every entry carries it through `expandInstruction`; the last line of `expand` throws it away: `res.stitches = list.map(e => ({ t: e.t, c: e.c }))`. The Model then has one `height` per round. So `Row 3: … (tr, dc, hdc, sc) in same ch-3 sp …` (Premier wrap), `Ch 3 (counts as 1 tr here and throughout)` (hex socks) and every mixed dc/sc round are flat. The renderer cannot recompute `h` from `t` either, because `t` has already lost the information (`inc`, `dec`, `x`, `bbl` and `puff` are all height-ambiguous, and `dec` from `dc2tog` is height 2 while `dec` from `sc2tog` is 1).

### 9. UK stitch heights are wrong

`stitchTok`'s height branch is `if (/hdc/) …else if (/dtr|treble|\btr\b/) …else if (/dc/) …`. `htr`, `ttr` and `trtr` contain `tr` but **not** as a whole word, and match nothing else, so they fall to the default `{t:'sc', h:1}`:

```
Rnd 4: htr in each st around (24)   → 24xsc  h=1     (UK half treble = US hdc, h 1.5)
Rnd 5: trtr in each st (24)         → 24xsc  h=1     (quadruple treble, h ≈ 3)
```
A UK pattern (King Cole festival, Stylecraft) renders every stitch one unit tall. Note that the *counts* are right — `06 #3`'s UK work fixed `stitchInfo`, but not `stitchTok`.

### 10. Post stitches collapse — the basketweave texture cannot exist

`fpdc` and `bpdc` both hit `/dc/` → `{t:'dc', h:2}`. `2nd row: *Dcfp around each …` and `3rd row: *Dcbp …` are the entire point of the Bernat basketweave blanket, and the Model has no way to say "this column stands in front of the fabric and that one behind". (They do not even get that far here — the rows fail to evaluate, finding 5 — but fixing 5 without fixing this yields four identical `dc` rows.)

### 11. Chain spaces, skips and slip-stitch joins leave no trace, and `t:'ch'` is dead code

```js
Rnd 3: ch 3, (dc in next st, ch 1, skip 1 st) around (12)  → 12xdc   h=2
```
Twelve produced stitches for a round that occupies **24 positions** of the previous round. `SPEC` gives ring radius `R = count * SW / 2π`, so every lace/filet round is drawn at half its true radius: the gosyo doily, Patons mesh cardigan, Premier wrap and hex socks are all mesh. `skip`/`miss`/`sk` are `(0 produced, 1 consumed)` and emit nothing; `sl st` joins are produced-1 so they *do* add a phantom stitch to the ring (Persian Tiles round 1's `16 sts`). And `stitchTok`'s `else if (/^ch/) { t = 'ch' }` is unreachable — `VOCAB` has no `ch` entry, so `stitchInfo` returns `null` first and the function bails. The `t: 'ch'` in the Model contract never occurs.
**Expected:** emit `{t:'ch', span:n}` and `{t:'skip'}` entries (or a per-round `consumed` total) so the renderer can size the ring by *positions* and leave holes.

### 12. One marker dialect (`1. Rnd:`) turns a whole piece into featureless `x`

Fish body, all 15 rounds, `Store.diagramModel`:

```
[0] cnt=9  h=1 | 9xx     1. Rnd: 2 ch, into the first ch: 9 sc (9)
[2] cnt=24 h=1 | 24xx    3. Rnd: (2 sc, inc) x6 (24)
[8] cnt=36 h=1 | 36xx    9. Rnd: dec, 13 sc, inc x4, 13 sc, dec (36)
[14] cnt=0     |         15. Rnd: dec x4, …
```
Root cause, isolated:
```js
Patterns.evaluate('(2 sc, inc) x6', 18)        → 24
Patterns.evaluate('3. Rnd: (2 sc, inc) x6', 18) → null
```
`instrOf` tries `detectMarker` → `detectNextRow` → `detectSetup` → `nameRowInfo` and none strips a trailing-dot numeral marker, so the instruction handed to `evaluate`/`expandInstruction` still begins `3. rnd:`; `expandSegment` returns `null` on that segment, `expandInstruction` bails, and `expand` falls back to `runOf('x', 1, target)` using the printed count. `lineFor` maps the rows correctly — only `instrOf` fails — so the fix is one marker in one function and it recovers a whole pattern (and the fish's asymmetric `dec, 13 sc, inc x4, 13 sc, dec` positions, which are what make it fish-shaped).

### 13. No shape hint: ovals, squares and hexagons are all drawn as circles

```js
R1: Ch12, start 2nd chain from hook: 10sc, 3sc in last, 10sc down other side, 2sc in same [25]
→ 25xx   (h=1, no chain length, no shape)
```
The baphomet body's foundation is an oval; the Model says "a ring of 25". Nothing carries `chainLen: 12`, the `3 sc in last` turn, or "this is an oval". Same for Persian Tiles (`[2] .. [4]` are four rounds of exactly `24xsc` — five identical rings, i.e. a **cylinder** where a flat square belongs) and hex socks (`9 x 3tr groups`, `10 x 3tr groups`, `11 x 3tr groups` — a hexagon whose corner count is printed in plain text and thrown away).

### 14. `mode` is a project setting, so a sphere can render as a sheet

`buildDiagramModel` takes `mode` from `proj.countMode`. The snowman imported through the real New-project flow came in as **`countMode: 'rows'`**, although every line reads `R12-R17: 66 sc around` and the piece is two spheres:

```
mode=rows rounds=42 current=0 default=#f1e3c8
[10] cnt=66 … [24] cnt=18 (waist) … [29] cnt=48 … [41] cnt=6
```
A perfect solid-of-revolution profile, handed to the renderer with instructions to draw a flat curved sheet. The converse matters too: one project legitimately mixes both (hex socks = hexagon rounds + `Top Of Leg Rib` rows; cardigan = rows `First Section` + rounds `Sleeves`), so `mode` belongs on the **round**, or at least on the part, and should be derived from the pattern (`Rnd`/`around`/`magic ring`/`join` ⇒ rounds; `Row`/`turn` ⇒ rows) rather than from the user's counting preference.

### 15. The 999-stitch guard silently corrupts counts

`for (var si = 0; si < list.length && si < 999; si++) … count = stitches.length;`

```js
Row 1: 1200 sc (1200) / Row 2: sc in each st across (1200) / Row 3: …
→ [0] cnt=999/999   [1] cnt=999/999   [2] cnt=999/999
```
The truncation is not just visual: `count` is set from the truncated array and then feeds `prevCount` for the next row, so the error propagates. A large afghan row or a C2C edge row is quietly wrong.

### 16. `done < count` on a finished round is indistinguishable from "in progress"

Turtle foot, round 2 completed with 9 stitches instead of the pattern's 12 (`rowStitches = [0,12,9]`, `row = 2`):

```
[0] cnt=12 done=12   [1] cnt=12 done=9   [2] cnt=12 done=0 (current)   [3] cnt=12 done=0 ghost=1
```
Round 1 is finished, yet the Model says 9 of 12. Per SPEC the renderer draws the unfinished slices as a translucent ghost **grid**, so a finished piece keeps a hole in it forever. There is no `finished` flag and `ghost` is false for both. (The inverse works: tapping 20 on a 12-stitch round gives `cnt=20 done=20 sts=12`, and the contract's "repeat last / generic" covers the 8 missing stitch records.)

### 17. Turning chains are counted as stitches

```
Snowman scarf  R2: sc in the 2nd chain from the hook: 70sc, ch1, turn   → cnt=71, 71xsc   (truth: 70)
Persian Tiles  Rnd 1: Ch 3, 15 dc in ring; join with a sl st … 16 sts   → cnt=16, 15xdc sc
```
The cardigan's First Section says it out loud — "Ch 1 (turning ch does not count as a st throughout)" — and nothing reads it; every row comes out `184xsc`. A one-stitch error per row is invisible on a ring of 405 and glaring on a ring of 6 (the baphomet tail, `6 sc` for 30 rounds).

### 18. Rows-mode edge increases lose their position

```js
Row 3: Ch 1, turn, 2 sc in first st, sc across to last st, 2 sc in last st. (20)
→ 20xsc
```
The count grows 18 → 20 but the two increases are plain `sc` in the middle of a uniform run. A shawl's shape is *where* it grows (both edges, one edge, a centre spine); the Model says only "two more than last time".

### 19. `yarnColorNames` offers the wrong colours — junk in, real colours out

```js
Store.yarnColorNames({parts:[{patternText: pandaHead}, {patternText: snowmanBody}]})
→ ["chain", "single crochet", "repeat"]
Store.yarnColorNames({parts:[{patternText: persianTilesFirstSquare}]}) → []
Store.yarnColorNames({parts:[{patternText: hexSocks}]})                → []
```
`LEGEND_RE` scrapes the "Terms used" block (`ch = chain`, `sc = single crochet`, `rep = repeat`) and `stitchInfo('chain')` / `stitchInfo('single crochet')` are `null` because `VOCAB` only knows the abbreviations — so the Yarn colours sheet offers `<input type="color">` for *chain* and *single crochet*, while Persian Tiles (a three-colour pattern using `CA`/`CB`) and the hex socks (two yarns) offer nothing. A second mismatch: `Rnd 4 (yellow)` **does** colour the round in `expand`, but `colors().names` has no rule for a parenthesised row colour, so "yellow" never reaches the sheet and the user cannot override it. The names `expand` uses and the names `colors` reports are two different sets.

### 20. Cache key: correct today, fragile by construction

`diagramKey` covers `sizeIndex | row | piecesDone | rowStitches.length | repeat | countMode | yarnSerial | text.length | text`. Yarn-colour edits do invalidate it (`yarnSerial`), and I could not build a stale-model sequence: `rowStitches` **values** are absent (only `.length`), but the single-slot-per-part cache plus `prt.row` covers the undo/redo paths I tried. It is still a latent hazard — any future "edit the count of a past row" affordance changes a value at constant length and `prt.row`, and the model goes stale. `applyLiveRound` mutates the cached object in place, which is fine, except that it trusts `model.current` (see finding 1). Two things genuinely missing from the key: the **size names** (`sizeIndex` is an index into a list that can change when the text does — covered by `text`, so safe) and nothing else. Leave the full-text concat alone; it measured 0.009 ms per cached call.

---

## Model contract v2

Additive and back-compatible: v1 consumers keep working; every new field is optional with the v1 behaviour as its default. `null` means "unknown" everywhere, and is never `0`.

```js
Model = {
  mode: 'rounds' | 'rows',          // v1; now only a fallback for rounds[i].kind
  rounds: [ {
    // --- v1 ---
    count: number|null,             // null = UNKNOWN (was silently 0); renderer may interpolate
    done: number,
    stitches: [ { t, c, h?, span?, post?, group? } ],
    color: '#hex',
    height: number,                 // still the dominant height, for cheap paths
    ghost: boolean,

    // --- v2: geometry the renderer cannot derive ---
    kind: 'ring'|'oval'|'polygon'|'row'|'cap',
    positions: number|null,         // slots consumed in the previous round: count + chains + skips.
                                    // Ring radius must use THIS, not count (finding 11)
    corners: number|null,           // 4 for a granny square, 6 for the hex sock, null for a ring
    cornerAt: number[]|null,        // stitch indices of the corners, in work order
    chainLen: number|null,          // foundation chain, for an oval/row start (finding 13)
    stitchHeights: number[]|null,   // per-stitch height, parallel to stitches; null = uniform
    join: 'spiral'|'slst'|'turn'|'tube'|null,   // spiral vs joined rounds; 'tube' = rows seamed
    turningCh: 0|1|2|3,             // how many of `count` are a turning chain, so the
                                    // renderer can drop it from the ring (finding 17)
    flatRate: number|null,          // net stitches gained per round: >0 grows outward as a flat
                                    // disc/square, 0 = straight wall, <0 closes. Drives whether a
                                    // ring steps out in radius or up in height.
    skew: {dx, dz}|null,            // centroid offset from the inc/dec angular distribution, so a
                                    // horn or a tail curves instead of coning (baphomet Horns:
                                    // one inc at index 0 for 14 rounds)
    estimated: boolean,             // count carried forward / interpolated, not read
    finished: boolean,              // this round is done even if done < count (finding 16)
    sameAs: number|null,            // "Rep Rows 3 and 4" → the index this round copies (finding 6)
    unknown: boolean,               // the parser could not read this row at all
  } ],
  current: number,                  // MUST index a round present in `rounds`
  window: { from: number, to: number },  // 1-based pattern rows this model covers
  defaultColor: '#hex',
  colorsUsed: string[],             // colour NAMES the model actually resolved, for the
                                    // Yarn colours sheet (finding 19)
}
```

Stitch entry v2: `{ t, c, h, span, post, group }` — `h` = this stitch's height (stop discarding it, finding 8); `span` = slots consumed (2 for `dec`, 0 for the second half of an `inc`, n for `ch n`, 1 for `skip`); `post: 'front'|'back'|null` for `fpdc`/`bpdc` (finding 10); `group` = an integer shared by the two halves of one `inc` and by the stitches of one shell, so the renderer can widen one slice rather than two (finding 3's ambiguity: `inc` produces two entries indistinguishable from two separate `inc`s).

**Where each field is computed.**

| Field | Layer | Why |
|---|---|---|
| `h`, `span`, `post`, `group`, `t` | **parser** (`stitchTok`, `expandSegment`, `expandInstruction`) | it is the only place that has the words |
| `positions`, `turningCh` | **parser** (`expand` already sums `consumed`; just return it) | derived from the same pass |
| `chainLen`, `kind:'oval'` | **parser** — a new `R_OVAL` branch in `expandSegment` for `ch N, … in 2nd ch …, 3 sc in last, … other side` | needs the raw text |
| `corners`, `cornerAt`, `kind:'polygon'` | **parser** for printed group counts (`9 x 3tr groups`, `(3tr, 2ch, 3tr) in next 2ch-sp`); **store** as a fallback by clustering `inc` indices across rounds | the printed form is unambiguous; the clustering needs several rounds, which only the store sees |
| `sameAs` | **parser** (`lineFor` already resolves the range; add `line.repeatOf`) | textual |
| `colorsUsed` | **parser** returns `state.used`; **store** unions across rounds into the Model | |
| `kind:'ring'\|'row'\|'cap'`, `join` | **store** — per round, from `line.kind`/notes plus the `mode` heuristic (finding 14) | needs project + part context |
| `flatRate`, `skew`, `estimated`, `finished`, `window`, `current` | **store** (`buildDiagramModel`) | they are functions of the *sequence* of rounds and of `rowStitches`/`prt.stitch` |

---

## Proposals (ranked)

**1. Centre the round window on the working row, and never let `current` fall outside it** · Evidence: finding 1 — a 600-round pattern at round 5 returns rounds 201–600 with `current = 399` and the live stitch count written onto pattern round 600. · Proposal: in `buildDiagramModel`, compute `workingRow` first, then `start = clamp(workingRow - Math.floor(DIAGRAM_MAX_ROUNDS * 0.75), 1, Math.max(1, total - DIAGRAM_MAX_ROUNDS + 1))` and `stop = start + DIAGRAM_MAX_ROUNDS - 1`; push rounds only for `start..stop`; assert `current >= 0` before returning and fall back to `emptyModel()` rather than to the last index. Add `window: {from, to}` to the Model. Make `applyLiveRound` a no-op when `model.rounds[model.current]` is a ghost with `row !== workingRow` (add a `row` field to each round while you are there). · Effort **S** · Impact **5** · Risks: the viewer's ghost tail gets shorter on long patterns — intended.

**2. Stop rebuilding the 54 KB `linesFor` cache key inside the loop** · Evidence: finding 2 — `Store.linesFor` 0.21 ms per *hit*, 312 ms per 1,500 calls; `Patterns.lineFor` on a parsed array is 0.004 ms. · Proposal: (a) in `buildDiagramModel`, use the `lines` local — `Patterns.lineFor(lines, patternRow)` and `Patterns.targetFor(lines, patternRow)` directly instead of `lineForRow(prt, …)` / `targetFor(prt, …)`; (b) change `linesFor`'s cache to `cached.text === text && cached.size === size` (reference equality on the same string is O(1); only differing strings pay a compare) and keep the parsed array; (c) build a `rowIndex = new Map(row → line)` once from `lines` and use it in the loop, which also removes `Patterns.lineFor`'s scan. Expect the 1,500-row build to go from ~434 ms to well under 100 ms, most of it `Patterns.expand`. Then relax `DIAGRAM_MAX_LIVE_ROWS` in `js/app.js` and delete `partIsHeavy`'s 60 ms memo. · Effort **S** · Impact **5** · Risks: (b) touches every pattern-bridge caller (`lineForRow`, `targetFor`, `patternSummary`, `sizeCount`, `setupLine`), so it needs `test/patterns.test.html` green; the win is worth it — `targetFor` alone costs 0.22 ms per call today and app.js calls it on every render.

**3. Emit `inc`/`dec` for the long-form dialect** · Evidence: finding 3 — panda head rounds 2–21 are `48xsc` with zero inc/dec; Persian Tiles `[2 sc in next dc, sc in next dc]` likewise. · Proposal: in `expandSegment`, the `R_N_IN_NEXT` branch (`N st in next/same st`) must synthesise an increase when `N >= 2` and the base stitch is plain: emit `N` entries of `{t: 'inc', group: g, h: st.h}` with `consumed = 1` (today: `emit(st, N)`, type `sc`). Add a `R_TOG_LONG` branch for `<st> next N sts tog` / `<st> in next N sts together` → one `{t:'dec', span:N}`. Guard with `stitchTok`'s `p/c` so counts are unchanged — this is a *type* fix, not a count fix, and `test/patterns.fixtures.html` counts must not move. · Effort **M** · Impact **5** · Risks: `2 sc in next st` inside a `(…)×6` group must still consume 1 per repeat; regression-test the panda/tiles counts.

**4. Apply colour phrases found on the row's own text** · Evidence: finding 4 — `Rnd 5: Colour change to black` leaves the colour at `yellow`; `Rnd 1: With white` sets nothing; panda head reports `c=-` for all 21 rounds. · Proposal: in `expand`, after `instrOf(line)` and the `(colour)` prefix strip, call `applyPhrases(line.text, st)` **before** expanding the instruction (currently only `line.notes` and preceding headers are fed). Relax `C_IN` from `^\s*(?:in|with|using…)` to also match after a row marker (`^(?:R(?:nd|ow)?\s*\d+[.:) ]*)?\s*(?:in|with|using|w\/)\b`) or simply run it against the marker-stripped instruction. Keep `C_CHANGE`/`C_OFF` global as they are. Add `state.used = {name: true}` and return it so Store can build `colorsUsed`. · Effort **S** · Impact **5** · Risks: false positives on "with the RS facing", "work in rounds" — `COLOR_STOP` and `looksLikeColor` already screen those; add `rs`, `ws`, `mm` to `COLOR_STOP`.

**5. Represent "unknown" instead of `count: 0`** · Evidence: finding 5 — hex socks all 15 rounds `cnt=0`; Premier wrap 42 of 46 rows; basketweave 4 of 5. · Proposal: in `buildDiagramModel`, when no source yields a count, set `count: null, unknown: true` and, if the previous round has a count, `count: prevCount, estimated: true` (crochet's overwhelming default is "same as last round"). The renderer draws an `estimated` band at reduced contrast and skips an `unknown` one without leaving a gap (`SPEC`'s ring stack already tolerates a missing band if the height accumulator skips it). Never let a `count: 0` round through unless `rowStitches[row] === 0` *and* the row is past. · Effort **S** · Impact **5** · Risks: an estimated band that is wrong is more misleading than a gap; gate it behind `estimated` so the renderer decides.

**6. Carry per-stitch height, and stop letting padding vote** · Evidence: findings 7 and 8 — basketweave row 1 is `dc + 97 sc` at `h=1`; the wrap's `(tr, dc, hdc, sc)` shell is flat. · Proposal: in `Patterns.expand`, keep `h` in the returned entries (`res.stitches = list.map(e => ({t, c, h}))`); compute `height` from the **pre-`fitTo`** list; make `fitTo` pad with the dominant token (`{t: dom.t, h: dom.h}`) instead of hard-coded `sc`, and mark padded entries `{pad: true}`. In `buildDiagramModel`, copy `h` through and build `stitchHeights` only when the row is mixed (`new Set(h).size > 1`) so the common case stays allocation-free. · Effort **S** · Impact **4** · Risks: `dominantHeight`'s tie-break already prefers the taller height; check `test/patterns.test.html` height assertions.

**7. Fix UK heights and keep post stitches distinguishable** · Evidence: findings 9 and 10 — `htr`/`ttr`/`trtr` → `{t:'sc', h:1}`; `fpdc` and `bpdc` both → `dc`. · Proposal: rewrite `stitchTok`'s height ladder as an explicit table keyed on the normalised token before the substring tests: `{htr: ['hdc',1.5], ttr: ['tr',3], trtr: ['tr',3], dtr: ['tr',2.75], tr: ['tr',2.5], dc: ['dc',2], hdc: ['hdc',1.5], sc: ['sc',1], sl: ['sl',0.3], ch: ['ch',0.5]}`; match `/^(fp|bp)(sc|hdc|dc|tr)$/` first and return `{t: base, h: baseH, post: m[1] === 'fp' ? 'front' : 'back'}`. Note `sl` should be shorter than `sc`, not equal — a slip-stitch round barely adds height. Respect `dialectHints` so a UK pattern's `dc` is not silently given US height. · Effort **S** · Impact **4** · Risks: changing `sl` height moves ring `y` positions in existing tests.

**8. Strip the `N. Rnd:` / `N.` marker in `instrOf`** · Evidence: finding 12 — the whole fish body is `x`; `evaluate('3. Rnd: (2 sc, inc) x6')` is `null` while `evaluate('(2 sc, inc) x6')` is 24. · Proposal: `instrOf` already tries four detectors; add the numeral-first form. Cleanest fix: have `parse()` record `line.instrStart` (it knows exactly where the instruction began, because it computed the count from it) and make `instrOf` return `line.text.slice(line.instrStart)`, falling back to today's re-detection for v1 lines. That removes a whole class of "the parser found the row but `expand` cannot read it" bugs rather than patching one dialect. · Effort **S** · Impact **4** · Risks: `instrStart` must survive the range/`sameAs` mapping; add a fixture assertion that `expand` produces no `x` entries for any fixture whose line has a computed count.

**9. Resolve "Rep Rows 3 and 4" / "Rep Rnd 3" into `sameAs`** · Evidence: finding 6 — Premier wrap rows 5–45 and hex socks rounds 4–15 are the bulk of both patterns and are empty. · Proposal: in `parse`, when a row line's instruction matches `/^(?:rep(?:eat)?)\s+(?:rows?|rnds?|rounds?)\s+(\d+)(?:\s*(?:and|&|,|-|to)\s*(\d+))?/i`, set `line.repeatOf = [n]` or `[n, m]`. `expand` then recurses: for row R with `repeatOf`, pick `repeatOf[(R - line.startRow) % repeatOf.length]` and expand *that* row with the current `prevCount`/`state`. Store copies the resulting round and sets `sameAs`. · Effort **M** · Impact **4** · Risks: recursion cycles (`Row 5: Rep Row 5`) — cap depth at 2 and fall back to today's behaviour; the referenced row's own `prevCount` differs, which is why the recursion must pass the *current* `prevCount`.

**10. Derive `kind` and `mode` per round from the pattern, not from `proj.countMode`** · Evidence: finding 14 — the real PDF import of the snowman produced `countMode: 'rows'`, so a two-sphere amigurumi is handed to the renderer as a flat sheet; hex socks and the cardigan legitimately mix both within one project. · Proposal: add `Store.diagramMode(prt)` → looks at `patternSummary(prt)` plus a scan of `lines` for `rnd|round|around|magic ring|join with|do not turn` vs `row|turn|across`, memoised per part in `lineCache`; `buildDiagramModel` sets `mode` from it and per-round `kind` from the round's own line (`row` vs `ring`). Keep `proj.countMode` as the tie-break and expose an explicit per-part override in the part editor. · Effort **M** · Impact **5** · Risks: a wrong guess is worse than a wrong default because it is silent — put the resolved mode in the 3D viewer's readout so it is visible and overridable.

**11. Size rings by positions, not by produced stitches; carry chain spaces and skips** · Evidence: finding 11 — `(dc in next st, ch 1, skip 1 st) around` gives 12 for a 24-position round, halving the radius of every lace round in the corpus. · Proposal: `expand` already accumulates `consumed`; return it as `positions` (and `res.consumed`). Emit `{t:'ch', span:n}` for chain segments (add `['ch(?:ain)?s?', 0, 0]` to `VOCAB` guarded so it does not break the existing `ch` handling in `parse`) and `{t:'skip', span:1}` for `skip`/`miss`/`sk`. `buildDiagramModel` copies `positions` and the renderer uses `max(count, positions)` for circumference while drawing `ch`/`skip` slices as open mesh. · Effort **L** · Impact **4** · Risks: `VOCAB` is load-bearing for `STITCH_ALT` and a dozen regexes; adding `ch` there is the riskiest change in this document. An alternative that is **S**: return `consumed` only, change nothing else, and let the renderer scale the radius — 80 % of the benefit.

**12. Add `finished`, and reconcile `count` with `rowStitches` for past rounds** · Evidence: finding 16 — a turtle foot finished with 9 of 12 keeps `done=9, count=12, ghost=false` forever, so the renderer draws a permanent hole. · Proposal: in `buildDiagramModel`, for `row < workingRow` set `finished: true` and, when `rs[row] > 0 && rs[row] !== count`, set `count = rs[row]` and truncate/pad `stitches` to match (the user's needle beats the PDF). Keep the pattern's count in `plannedCount` so the viewer can still say "the pattern said 12". · Effort **S** · Impact **4** · Risks: a pattern round the user under-tapped by accident now renders smaller — which is what the fabric actually looks like.

**13. Shape hints for ovals, squares and hexagons** · Evidence: finding 13 — the baphomet oval foundation is `25xx`; Persian Tiles is five identical 24-rings (a cylinder); hex socks prints its corner count in words. · Proposal: parser side, add `R_OVAL` in `expandSegment` for `ch N … (2nd|second) ch … 3 sc in (last|same) … (other|opposite) side` → `{kind:'oval', chainLen:N}` on the line, and recognise printed group counts (`(\d+)\s*x\s*\d*(?:tr|dc)\s*groups?`, `(3tr, 2ch, 3tr) in next ch-sp` = a corner) → `{kind:'polygon', corners, cornerAt}`. Store side, add `inferShape(rounds)` as the fallback: cluster `inc` indices per round and, if k evenly spaced clusters persist over ≥3 rounds, set `kind:'polygon', corners:k, cornerAt`. This is what makes a granny square look like a square without the parser understanding granny squares. · Effort **L** · Impact **5** · Risks: `inferShape` depends on proposal 3 landing first (no `inc` entries, nothing to cluster); false polygons on amigurumi where 6 increase points are a *sphere*, not a hexagon — require the increase count to stay constant **and** the count growth to be linear (a sphere's growth tapers, a flat square's does not) — i.e. use `flatRate`.

**14. `flatRate` and `skew`, so horns curve and discs lie flat** · Evidence: baphomet Horns — 14 rounds, each `Inc, Ns` with the single increase always at index 0; the renderer's concentric rings make a straight cone, while the real horn spirals. Persian Tiles/doily grow flat, not spherically. · Proposal: in `buildDiagramModel`, after the round loop, compute per round `flatRate = count - prevCount` and `skew` = the normalised vector sum of `exp(i·θ)` over the inc (positive) and dec (negative) stitch angles, where `θ = 2π·index/count`. A balanced 6-point increase gives `|skew| ≈ 0`; a single increase gives `|skew| = 1/count` pointing at it. The renderer offsets the ring centre by `skew · R · k`. Also lets the renderer choose "step outward in the plane" (`flatRate ≈ positions·(π-2)/…`, i.e. a flat disc) versus "step up" (`flatRate ≈ 0`, a wall). · Effort **M** · Impact **4** · Risks: pure geometry in the store, no parser change; needs `inc`/`dec` types (proposal 3) to be meaningful on the long-form dialect.

**15. Clean up the yarn-colour name pipeline** · Evidence: finding 19 — `["chain","single crochet","repeat"]` offered as yarn colours; Persian Tiles and hex socks offer none; `Rnd 4 (yellow)` is used but not listed. · Proposal: in `colors()`, reject a legend value when the key is a known stitch abbreviation (`stitchInfo(key)` — `ch`, `sc`, `rep`, `st`, `rnd`, `tog`, `blo`, `flo`, `yo`) even if the *value* is not, and reject values in a new `TERM_STOP` set (`chain, single crochet, double crochet, half double crochet, treble, slip stitch, stitch, round, row, repeat, together, skip, back loop, front loop`). Add a `C_ROWCOLOR` rule for `Rnd N (name):` so parenthesised row colours reach `names`. In `Store.yarnColorNames`, union `colors().names` with the `colorsUsed` the Model actually resolved, so the sheet always offers exactly what the diagram draws. And scan the project's `notes`/materials text as well as `patternText`, since import moves the materials block out of the parts (which is why the panda's *white* and *black* never appear). · Effort **M** · Impact **4** · Risks: `TERM_STOP` could reject a real yarn called "Chain" — accept the false negative.

**16. Do not count turning chains** · Evidence: finding 17 — scarf row 2 `cnt=71` for 70 sc; Persian Tiles round 1 `16 sts` for 15 dc; the cardigan states the rule in its own text and is ignored. · Proposal: add `turningCh` to the line: `parse` sets it from `^ch\s*(\d)\s*[,.]` at the start of a row instruction and from the pattern-level note `turning ch(ain)? does not count` (a sticky flag in `state`, as the cardigan's "throughout" implies); `expand` excludes it from `stitches` but reports it so `line.count` reconciliation still matches the printed number. Model carries `turningCh` so the renderer can keep the height contribution without the ring slot. Also treat `join with a sl st to top of ch-3` as a join, not a stitch (`join: 'slst'`). · Effort **M** · Impact **3** · Risks: printed counts frequently *include* the turning chain, so `fitTo` will now disagree with `line.count` by one — allow a ±1 tolerance rather than padding.

**17. Mark edge increases in rows mode** · Evidence: finding 18 — `2 sc in first st … 2 sc in last st` → `20xsc`, so a shawl's growth edges are invisible; `Row 1: Ch 19, sc in the 2nd ch …` is `18xx`. · Proposal: falls out of proposal 3 (`N st in first/last st` is the same `R_N_IN_NEXT` shape — extend the alternation to `first|last|same`), plus a `kind:'row'` round-level `growth: 'both'|'left'|'right'|'centre'|null` computed in the store from where the `inc` entries sit (first/last 10 % of the row vs the middle). The renderer offsets each row's left edge by half the growth so a triangular shawl reads as a triangle rather than a left-aligned staircase. · Effort **S** (after 3) · Impact **3** · Risks: none beyond proposal 3.

**18. Raise the 999-stitch cap and make truncation honest** · Evidence: finding 15 — a 1,200-stitch row becomes `count: 999` and poisons `prevCount`. · Proposal: in `buildDiagramModel`, keep `count = ex.stitches.length` (uncapped) and cap only the **stored** array: `STITCH_DETAIL_MAX = 2000` entries, with `stitchesTruncated: true` on the round so the renderer repeats the last colour run rather than assuming the array is complete. `prevCount` must always be the true produced count. The renderer already subsamples beyond 160 slices per ring, so long rows lose nothing visually. · Effort **S** · Impact **3** · Risks: memory — a 46-row × 405-stitch wrap is already 18,630 entries per build; consider a run-length `stitches` encoding (`[{t,c,h,n}]`) in v3 if this bites.

**19. Put `rowStitches` values in the cache key** · Evidence: finding 20 — only `.length` is keyed; nothing stale reproduces today, but any "edit a past row's count" affordance makes it stale instantly, and `applyLiveRound` only ever repairs the current round. · Proposal: in `diagramKey`, replace `rs.length` with `rs.length + ':' + rs.join(',')` (these arrays are a few hundred small integers; the key already carries the whole pattern text). Consider a two-slot cache per part so an undo/redo pair does not thrash. · Effort **S** · Impact **2** · Risks: none.

**20. A `test/diagram.model.test.html` that asserts the *shape* of the Model, not just its counts** · Evidence: every finding above is invisible to `test/patterns.fixtures.html`, which asserts counts — and the counts are almost all correct. The Model can be uniformly wrong while every count test passes (panda `48xsc`, fish `36xx`, hex socks `cnt=0`). · Proposal: a fixture-driven page that, for each of ~15 named pieces, asserts: no round has `count === 0` unless `unknown`; `current` is inside `rounds`; a round whose text contains an increase word has at least one `inc`; a `dc`/`tr` round has `height > 1`; `mode` matches a hand-labelled expectation; `rounds.length` for the range cases (baphomet Tail = 42, snowman body = 42, Premier wrap = 46); and a golden per-round `count/height/kind` profile for the snowman body and the turtle shell. Print a per-fixture "Model fidelity" score (fraction of rounds with a known count, a non-`x` stitch list, and a resolved colour) so a regression is one number. · Effort **M** · Impact **5** · Risks: golden files need updating as the parser improves — keep them coarse (profiles, not full stitch lists).
