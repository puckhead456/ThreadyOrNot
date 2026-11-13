# API: xs-core (`window.XStitch`, `js/xstitch.js`), wave K additions

Status: **BUILT** (batch 1). Everything listed here exists and is unit-tested in
`test/xstitch.test.html`; fixture-tested where noted. Waves B–J still hold. Fields may be added,
never renamed. Feature-detect with `XStitch.WAVE_K === 1`.

All functions are pure (no DOM, no storage), never throw on bad input, and those that take a
`data` take a `normalize`d craftData (XSData). Functions that change data **return a new
normalized XSData**; wrap them in `Store.updateCraftData` yourself (one undo step). Cell index =
`y * w + x`, 0-based; x/y in chart cells. `now` arguments are ms (default `Date.now()`).

## 0. `normalize` (still the single gate). New fields, each kept ONLY when present
| field | shape |
|---|---|
| `kind` | `'diamond' \| 'needlepoint' \| 'filet' \| 'fusebead'` (absent = cross-stitch; `'cross'` is not stored) |
| `palette[i].keyCount` | the key's printed stitch count; a printed 0 stays 0, an absent or non-numeric count stays absent (audit D21) |
| `palette[i].unresolved` | `[paletteIndex…]` (≤ 16): a placeholder for squares a read could not name; the indices are the candidate key colours |
| `palette[i].glyph` | `{ w, h, bits, path, clean, source }` — same shape as XSKeyRead's Glyph. `bits`: base64, w·h bits row-major from the top (16 × 16 from a vector PDF); `path`: SVG path in a 100 × 100 box, y down, ≤ 1 KB, or null; `clean`: show the pattern's symbol only when true; `source`: `'pdf-path' \| 'pdf-font' \| 'picture' \| 'user'` |
| `parking[i].x / .y / .paletteIndex` | where a thread is parked (old `{ key, symbol, corner, note }` unchanged) |
| `progress.keyDone` | `{ [paletteIndex]: n }` taps on a colour the chart has no square of (see `totals`) |
| `goals` | `[{ id, kind:'perDay'\|'page'\|'colour'\|'total', createdAt, n?, page?, color?, by?, label?, done? }]` (≤ 50; a bad kind, a missing page, or a colour that is not in the palette is dropped). `goalProgress` reads these. `Store.setGoal` (project-level) also works; keep one place per project |

`parseKey` (follow-up): reads the old printed / OCR line shape `DMC Cotton 816 garnet` (a thread word —
Cotton, Coton, Mouliné, Stranded, Floss, Perle, Retors, Embroidery, Special — straight after the
brand) **only when the code is in the brand's table**; otherwise the row stays blank. A key in
J. & P. Coats numbers (the Orr books) gives no rows and the warning "the key gives J. & P. Coats
numbers; there is no colour table for that brand, so its rows are left blank". Feed it
`Ocr.toPlainText(result, { dropMargin: true })` of a cropped key.

`parseKey` (audit): a "name" made of chart-symbol glyphs (a word mixing letters and digits such as
`Zlnn9999MM`, or three of one character in a row) is never emitted: the entry gets `name: ''` and
`nameUnreadable: true` (show the floss table's name), with the warning "N colour names could not be
read (chart symbols where the name should be)". Anchor codes keep their printed leading zeros
(`code: '0400'`, `brand: 'Anchor'`); `flossId('Anchor', '0400')` is `'anchor:400'`, never a DMC id.
`kitList` rows also carry `printed` (the code as printed; `code` is the lookup key, e.g. `b5200`).

`palette[i].stitchCount` from `extractGrid` is now the chart's own count for a cross colour (0 when
the chart has none); the printed number is `keyCount`. Backstitch / knot rows keep the key's.

## 1. Grid reads tell the truth (parity gap 1)
`extractGrid(doc, page, opts)` result gains (all always present on a read with a key):
```
check:      Check (wave J §3) of the cells AS THEY END UP, against opts.key.entries
unresolved: [{ palette, ink, cells, candidates:[entryIndex], expected:[count|null], why }]
            why 'shared-ink' | 'tie' | 'unknown'
split:      [{ ink, by:'legend'|'glyph', into:[entryIndex] }]
legend:     { rows, used, page }       // the key page's swatch column (+ symbols), when it was trusted
classes:    number of colours after splitting (colors = distinct inks, as before)
graphics:   { segments:[{x1,y1,x2,y2,hex,width}], circles:[{x,y,r,hex}] }   // chart cells, for ornamentsFromGraphics;
            // segments only when the key has back / knot / bead rows, or opts.graphics: true (false: never)
mixedCells: squares whose KG quarters differ (fractional stitches the reader does not yet keep)
```
- `palette` = one entry per key entry, then one **placeholder per unresolved class**
  (`code: ''`, `brand: ''`, `name: 'DMC 349 or DMC 3843 (not told apart)'` or
  `'… (not in the key?)'`, `hex` = the ink, `unresolved: [candidates]`). No read square is −1.
- `ok` still means "a grid was read". **Demote "Use it"** when `check.verdict` is not `'exact'` /
  `'close'` or `unresolved.length > 0`, and show `check.summary` plus one row per `unresolved`.
- `XStitch.resolveClass(data, placeholderIndex, choice) -> data`
  - `choice` = a palette index: every square of the placeholder becomes that colour.
  - `choice` = `-1`: "these are fabric" (unstitched; an explicit user choice only).
  - `choice` = `{ cells: [cellIndex], to: paletteIndex | -1 }`: a hand split.
  - The placeholder is removed once empty; every index above it moves down one (cells, layers,
    parking, current colour, rowOpts.color, blendWith). Done bits stay with their squares.

## 2. Symbol-font charts from the text layer (#6)
- `XStitch.glyphCells(items, { maxSize, minSize, fonts, pitch }) -> [{ x, y, font, code, size }]` (+ `.pitch`)
  from pdf.js `getTextContent().items` (or PdfText `glyphs()` entries `{font, code|unicode, box}`).
  Use `maxSize: 8`-ish to leave the key's big symbols out.
- `XStitch.keySymbolCodes(items, entries, { minSize: 8 }) -> entries` (copies) with `symbolCode: { font, code }`.
- `XStitch.gridFromGlyphs(cells, key, { design }) -> { ok, w, h, cells:Int16Array, palette, check,
  unresolved, classes, glyphs, counts, how:['symbol'|'count'|null], filled, matched, missing:[entryIndex],
  pitch, warnings, source:'text' }` — matches by font + code, then the printed character, then counts;
  the rest are placeholders (same shape as §1). Fixture: foxy reads 68 × 68, 4 colours matched by
  symbol, 5 placeholders (its key prints no readable symbol for them).
  Only foxy of the Tiny Modernist files is a symbol-font chart (halloween / homestitchhome draw
  each symbol as an image, welcome is one picture).

## 3. Backstitch, knots, fractionals from graphics (#10)
`XStitch.ornamentsFromGraphics(g, palette, { maxDE: 25 }) -> { back, knots, part, unmatched, stats }`
`g = { segments, circles, polys:[{ pts:[x,y…], hex }] }` in chart cells (`extractGrid().graphics`).
Grid lines dropped by width; snapped to the half-cell lattice; split into unit / half steps;
de-duplicated; colour → nearest `back` / `knot` / `bead` entry, else `unmatched` (never guessed).
Quarter `d`: 1 tl, 2 tr, 3 bl, 4 br; half `d`: 1 "/", 2 "\" (unverified against a generator).
Output drops straight into `chart.back / knots / part` and round-trips through OXS.

## 4. Honesty sweep (#1)
- `XStitch.totals(data) -> { done, total, pct, pctText, crosses:{done,total}, fromKey:[i], text }`
  — THE total ("20 of 180 stitches · 11%"). Cross colours with no squares but a `keyCount` count from
  the key; their done is `progress.keyDone[i]`.
- `XStitch.pctText(done, total)` → `'0%' | '0.03%' | '<0.01%' | '64%' | '99%' | '100%'`.
- `XStitch.assignSymbols(palette, { distinct: true })`; `XStitch.symbolCheck(palette) -> { ok, repeats:[[i,j]], sameFamily:[[i,j]] }`.
- `XStitch.skeinRange(o)` → `{ low, high, mid }`; `XStitch.skeinPlan({ stitchCount, count, over, strands, have })
  -> { low, mid, high, have, buy, text }` ("56–125 skeins (buy 84)", "1–2 skeins (you have 1, buy 1)").
- `XStitch.bulkPlan(data, scope, { unmark }) -> { cells:Int32Array, count, already, total, confirm, text, label }`
  scope `{ color } | { page } | { page, color } | { block:{bx,by} } | { block, color } | { row, color? }`
  (bx/by 0-based, page = index into `data.pages`). `confirm` above `XStitch.CONFIRM_ABOVE` (1000).
  `cells` are exactly the bits to flip.

## 5. Parking (#3), pages (#4), islands (#13)
- `parkAt(data, { x, y, paletteIndex, corner:'tl'|'tr'|'bl'|'br', note }) -> data` (same thread on the same stitch moves, not doubles)
- `unpark(data, i) -> data`; `parkedAt(data, x, y) -> [parkingIndex]`
- `nextBlockFor(data, color, { x, y }, 'right'|'left'|'down'|'column') -> { x, y, bx, by, left } | null`
- `parkingOrder(data, { x, y }, dir) -> [{ i, x, y, paletteIndex, rank, distance }]`
- `cellsOfPage(data, pageIndex, { color }) -> Int32Array`
- `pageProgress(data) -> [{ page, n, label, region, done, total, pct, pctText, complete }]`
- `islands(data, color) -> { count, list:[{ id, n, done, x0, y0, x1, y1, first }], label:Int32Array }`
- `islandRoute(data, color, { x, y }, { carryCm: 2.5, todo: true, max: 400 }) -> { order, hops:[{ from, to, cells, cm, cut, at:{x,y} }], cm, cuts }`
- `islandAt(data, x, y, { carryCm }) -> { id, of, n, done, color, nextCm, nextCells, cut, text } | null`

## 6. Row by row v2 (#14), find my place and goals (#21)
- `writtenRows(data, opts)` new opts: `xFrom`, `xTo`, `chunk` (split runs at every N columns),
  `done: true` (each run gets `done`), `scope: { page } | { block:{bx,by} }` (result gains `scope:{x0,y0,x1,y1,label}`).
- `findPlace(data, text) -> { x, y, page?, block?, text } | { error }` ("col 134 row 57", "134, 57", "page 9", "p9", "block 13,6").
- `goalProgress(goal, data, activity, now) -> { done, target, left, pct, met, perDayNeeded, approx, text }`,
  goal `{ kind:'perDay', n } | { kind:'page', page, by } | { kind:'colour', color, by } | { kind:'total', by }`
  (`activity` = `Store.activity(id)`; `perDayNeeded` is ≈). Goals can live in `craftData.goals`
  (kept by normalize, §0) or in shell-data's `Store.setGoal`.

## 7. Sessions (#5) — shell-data owns the log, the pace and the finish date
- `sessionLines(activity, { unit:'stitch' }) -> [{ s, e, ms, n, colours, text }]` newest first
  ("Wed 11 Nov · 52 min · 318 stitches · DMC 310, 3843"). Pass `Store.counted({…, part: 'DMC 310'})`.
- `dayStrip(activity, days, now) -> [{ day:'YYYY-MM-DD', label:'Mon', n }]` oldest first.
- Pace / finish / streak: use `Store.pace(id, { unit: 'stitch', remaining: XStitch.totals(d).total - … })`.

## 8. Stash and brands (#15, #16)
- `flossId(brand, code) -> 'dmc:310'`
- `flossNeeds(data, { remaining }) -> { [brand]: { [code]: { skeins, stitches, name } } }` (feed to `Store.flossAllocation`)
- `kitList(projects:[{ id, title, data }], stash, { remaining:true }) -> { projects:[{ id, title, rows:[{ id, brand, code, name, need, allocated, buy, setAside:[{id,n}] }], buy }], buyTotal }`
  `stash` = `Store.profile().floss` or `Store.flossStash()`.
- `registerBrandTable({ brand, rows:['code|name|hex'], provenance:{ source, licence, url, approx } }) -> { ok, brand, n } | { ok:false, reason }`
- `brandTables() -> [{ brand, n, provenance }]` (only DMC ships)
- `convert(brand, code, toBrand) -> { brand, code, name, hex, deltaE, word, provenance } | { none:true, reason }`
  (`word`: 'very close' < 2, 'close' < 5, 'noticeable' < 10, else 'different')
- `substitutes(brand, code, stash, n) -> [{ brand, code, name, hex, deltaE, word, have }]`

## 9. Calculators (#17), printable (#19), join (#18), templates, heavy fields
- `fabricPlan({ w, h, count, over, margin:'frame'|'hoop'|inches }) -> { design, margin, cut, cuts:[{name,w,h,fits,spareIn}], hoop, qsnap, frame, text }`
- `frameFit({ w, h, over }, { wIn, hIn }, counts) -> [{ count, wIn, hIn, fits, spareIn }]`
- `printableHTML(data, { progress:true, pageNumbers:'original', parking:true, overlap:0..5, remaining:true })`:
  done squares in `<path class="done">` (hatched), parked threads `class="park"`, overlap `class="overlap"`,
  page tags `p9` from `pages[].region`, `remaining` skips finished pages. Defaults unchanged.
- `quadrantLayout(datas, names) -> [{ x, y }]`; `joinCharts([{ data, x, y }], { labels }) -> { data, w, h, maps, conflicts }`.
- `templateFromProject(project) -> { craftData }` (registered as the craft's `template.fromProject`).
- Registered `heavy: { fields: ['chart.cells.data', 'progress.done'], minBytes: 32768 }` (shell-data §4).

## 10. Adjacent grid crafts (#20)
`XStitch.KINDS[kind] -> { label, unit, units, material, fabric, strands, pageWord, pack? }`,
`kindOf(data)`, `materials(data, i) -> { amount, unit, packs?, approx, text }`, `filetRowText(row, data)`.

## 11. Mark log (X3) — shell-data stores it (`Store.logMarks / flushMarks / readMarks`)
- `markDiff(prevB64, nextB64, n) -> [[cellIndex, 1|0]]` (what a bulk mark / undo changed)
- `replayMarks(chunks, n, { perFrame }) -> { frames, bits:Uint8Array, next() -> { at, bits, changed } | null, reset() }`
  replays bit for bit. **Confirmed for xs-render:** `chunks` is exactly `Store.readMarks(id)`'s
  `[{ at, marks: [[cellIndex, 1|0], …] }]`, and every frame carries `bits` (a `Uint8Array` of `n`
  bytes, one per square, 1 = done) plus `at` and `changed` (the squares this frame flipped). `bits`
  is ONE shared array updated in place: copy it (`bits.slice()`) to keep a frame. `next()` returns
  `null` after the last chunk. Asserted in `test/xstitch.test.html`.

## Internals for tests only: `XStitch._grid` (`nameClasses`, `tileSigs`, `legendOf`, `shapeMask`, `maskDist`, `sigGroups`, `solveCluster`, `unitPolys`, …)
