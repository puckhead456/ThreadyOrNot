# API: xs-read (`window.XSRead`, `js/xstitch-read.js`), version 2.0.0

Status: built (wave K, batch 1). Everything in docs/wave-j/CONTRACT.md §1 and §3 still holds; this
file lists exactly what version 2 adds or changes. Fields may be added later, never renamed.
Feature-detect with `typeof XSRead.readTiles === 'function'`.

## Changes to `detect(source, opts)` and `read(source, opts, onProgress)` results

Both results (when `ok`) now also carry:

```js
{
  regions: [Region],          // what the page holds; the chart read is first and chosen
  region: 'r0' | null,        // id of the chosen region
  sizeEvidence: [Evidence],   // the picture's own checks of the size
  sizeVerdict: 'checked'      // a declared size, and no evidence against it
             | 'consistent'   // no declared size, no evidence against it
             | 'doubtful',    // some evidence says the size or box is wrong (confidence is lowered)
  boldPhase: { x: 0..9 | null, y: 0..9 | null } | null,   // read only: where the thick every-10 lines fall in this picture's columns / rows
  rectified: null             // reserved (phone-photo straightening is not built yet; always null)
}

Region = {
  id: 'r0', kind: 'chart' | 'key' | 'photo' | 'text' | 'other',
  label: 'chart' | 'colour key' | 'picture' | 'text' | 'other',   // plain words for the UI
  box: { x, y, w, h },        // source pixels
  score: 0..1, pitch: { x, y } | null, chosen: boolean
}
Evidence = {
  kind: 'square' | 'edges' | 'bold10' | 'region',
  ok: true | false | null,    // null: this picture cannot say (e.g. no grid lines, no thick lines)
  detail: string              // plain sentence the UI can show as is
}
```

- `square`: "The squares are 16.9 x 15.8 pixels, not square: the box probably includes something that
  is not chart, or the size is wrong." (false when the pitches differ by more than 2.5 %).
- `edges`: whether grid lines go on one square past the box ("The grid lines go on past the top edge:
  the chart may be bigger than the box read.").
- `bold10`: whether the thick lines fall on multiples of 10 from an edge or from the centre.
- `region`: `ok: true` when an empty gridded margin outside a thick frame was left out (no declared
  size, the margin seen on at least three sides); `ok: false` when the box read holds a colour key, a
  picture or a text block besides the chart, or a block of squares the grid lines do not cross (a key
  panel printed over the grid, as on the WOCS robin page).
- `edges` is also `false` when the outermost two rows / columns read have no grid lines through them
  (a caption or margin read as squares).
- When the first box found draws an objection, the reader also tries the segmenter's chart region and
  the plain box and keeps the one with the fewest objections.
- **Render width**: draw a picture PDF page so a square is about 15–28 px (a Letter / A4 page about
  1,600–2,600 px wide). Satsuma stay-home reads 70 x 97 at 1,600, 1,800, 2,200 and 2,600 px; at 1,256 px
  and at 3,200 / 4,000 px it reads a wrong size, now flagged `doubtful`. Pictures over 16 MP are drawn
  down before reading.
- Rule for the app: `sizeVerdict === 'doubtful'` means the size may be wrong; demote "Use this chart".
- Every `ok: false` detail is also pushed to `stats.warnings`.
- `regions` is `[]` / chart-only when `opts.crop`, `opts.region` or `opts.lattice` is given.

## New failure reason

`{ ok: false, reason: 'looks-like-a-key', message, regions }`: the picture is a colour key (a column
of three or more swatches standing on the page, each with text to its right) and no chart lattice.
Message: "This looks like a colour key (N rows of colour swatches with text), not a chart. Add it as
the key, and read the chart from a picture of the chart itself."

## Key rows with no printed count (matching change)

A key entry's count is "missing" when `stitchCount` (or `stitches`) is absent, null or `''`; a printed
`0` is a count. When some rows have counts and some do not (a key read from a picture that missed a
count), the counted rows are placed first by count (as before); then each row with no count claims
the nearest leftover colour class by CIEDE2000 to its swatch / table colour, one to one, bigger
classes first, never a class that sits within 6 dE of an already placed colour (a noise split).
Such a class has `how: 'colour'`, and its Check row has `expected`, `ok`, `delta` and `pct` all
`null` (unverified, never invented agreement). With missing counts the speck size is not taken from
the key (the uncounted row may be the smallest colour).

## Option changes (read and detect)

| option | meaning |
|---|---|
| `region` | a `Region` (or a bare `{x,y,w,h}`) from an earlier `detect`: "read this one instead". Same as `crop`. |
| `segment` | `false` turns the page segmenter off (wave J box finding). Default on. |
| `maxColors` | **default changed**: no default number. Unset, a read with no key allows up to 256 colours when the squares are flat (neighbours are either the same colour or clearly different) on a confident lattice, and refuses with `too-many-colors` above 60 otherwise (a photo). With a key, the key's colour count decides. A number given is still a hard cap. Symbol charts: unset cap = max(60, key symbols + 10). |
| `symbols` | accepted and normalised (`[{ entry, glyph }]`, glyph `{w,h,data}` RGBA or the xs-keyread `{w,h,bits}`), **not used yet**: symbol matching by template is not built. |

`rectify` / `flatten` are accepted and ignored (not built).

## `XSRead.readTiles(sources, opts, onProgress) -> Promise<TilesResult>` (promise has `.token`)

A chart printed across several pages as pictures. `sources`: an array of anything `read` takes, in
reading order (left to right, top to bottom). Each page is read with no key (colours as printed),
classes are joined across pages by colour, the pages are placed, and the whole chart is matched to
the key with its counts.

```js
opts = {
  key, fabric, mode, maxColors, token,  // as read; the key's counts check the WHOLE chart
  layout: { cols } | null,               // pages per row when the user confirmed it; null = worked out
  size: { w, h } | null,                 // declared size of the whole design (decides between layouts)
  tileOpts: [opts | null]                // per-page read options (crop, size, region…), same index
}
onProgress({ phase: 'tiles', pct })

TilesResult = {
  ok, reason, message,   // a page that fails: its reason, message "Page N could not be read: …", plus tiles[]
  size: { w, h }, layout: { cols, rows },
  tiles: [{ index, ok, size: { w, h }, at: { x, y },   // chart column / row of the page's top-left square
            how: 'order' | 'overlap' | 'bold10' | 'from-overlap' | 'from-bold10', message: null }],
  seams: [{ a, b, axis: 'x' | 'y',     // pages a | b (b right of / below a)
            overlap,                   // squares the two pages share (0 = they only touch)
            cells,                     // squares compared in the overlap (0 when no evidence)
            agree,                     // share of those that agree, or null
            ok: true | false | null,   // null: this join could not be checked
            how: 'overlap'             // found by its repeated squares
               | 'bold10'              // from the thick-line phase of both pages
               | 'from-overlap' | 'from-bold10'   // taken from another join on the same column / row
               | 'order' }],           // no evidence: pages simply touch
  data, cells, classes, check, preview, cellConf, lowCells,   // as read, for the whole chart
  stats: { ms, warnings: [] }          // e.g. "2 of the joins between pages could not be checked …"
}
```
Also on `TilesResult`: `sizeVerdict` (`'doubtful'` when the joined size differs from `opts.size` or a
page's own size was doubtful), `sizeOff: { read, expected } | null`; when the size is off,
`check.verdict` is `'off'` and `check.summary` starts "The pages join to W x H, not the W x H the
pattern gives." Pages that fail to read, or read with confidence under 0.5 (a cover photo, a key page),
are **left out** (`tiles[i].ok: false, how: 'left-out', message: 'Left out: …'`, and a warning names
them); the join fails only when no page reads. With 3+ pages, a page read at a pitch more than 25 % off
the others' median is read again at the median pitch. Ruler numbers are not used.

Layout choice: every column count is tried; joins with repeated squares score, a declared `size`
that the joined pages match wins outright, otherwise the squarest page grid. Show the layout with
each seam's `agree` and ask "Is this the layout?"; pass `layout: { cols }` to fix it.

`XSRead.cancel(token)` cancels a running `readTiles` page read (token `<token>-<page>`).

## Test surface (not contract)
`XSRead._core()` exposes `segment`, `findSwatches`, `acPeak`; `XSRead._placeTiles`.
`detect().stats.debug` carries `segUsed`, `segNote`, `segMs`, `bold` (diagnostics only).
