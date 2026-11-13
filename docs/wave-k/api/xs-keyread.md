# API: xs-keyread (`window.XSKeyRead`, `js/xstitch-keyread.js`)

Status: BUILT (wave K, batch 1). This file is exact: it describes the code as it is. Fields may be
added later, never renamed.

Reads a colour key that is a **picture** (a screenshot, an image-only PDF page, a JPEG key panel)
with no text-recognition engine. Narrow and exact-or-blank: a row's code is given only when the
page's own glyphs, the floss table, and an independent check agree on it. A row it cannot pin down
is a partial (`"9?5"` plus candidates) or blank, never a guess. DMC only (the only table we ship).

**Load order**: after `js/xstitch.js` (needs `XStitch.FLOSS`, `rgbToLab`, `hexToLab`, `hexFor`).
Not yet in `index.html` / `sw.js` (asked of shell-ui). Heavy work runs in a Web Worker built from
`String(fn)` like `js/xstitch-read.js`; without Workers the same core runs on `setTimeout` ticks.
Deterministic (worker and main thread give identical output). Nothing throws across the promise.

## `XSKeyRead.isAvailable() -> boolean`
True when there is a DOM, typed arrays and `window.XStitch`.

## `XSKeyRead.read(source, opts?, onProgress?) -> Promise<KeyRead>`
The promise carries `.token` (for `cancel`).

`source`: a canvas, `ImageData`, `ImageBitmap`, `HTMLImageElement`, or an image `Blob`/`File`.
Pictures over 12 MP are drawn down first; every box in the result is in **source** pixels.

`opts` (all optional):
| field | meaning |
|---|---|
| `crop` | `{x,y,w,h}` in source px: the key panel. **Strongly recommended for a whole PDF page** (see "Whole pages" below). Default: the whole picture. |
| `brand` | `'DMC'` (default). Only DMC codes can be confirmed. |
| `chart` | the chart's own read, to check a count column: an `XSRead.read` result (`classes`), an `extractGrid`/parseKey-style `palette`, or `{ classes: [{ hex, count }], total? }`. Fabric classes are skipped. |
| `total` | the chart's stitched total; a count column that sums to it (± one per row) is evidence |
| `token` | your own cancel token |
| `noWorker` | run on the main thread (tests) |
| `budget` | search node budget (default 200 000; tests only) |
| `debug` | adds `_raw` (the core's layout and solve) to the result |

`onProgress({ phase, pct })`: phases `decode`, `layout`, `glyphs`, `solve`, `assemble`.

### `KeyRead`
```
{
  ok: boolean,                 // false: nothing that looks like a key (reason/message say why)
  reason: null | 'no-image' | 'no-key' | 'cancelled',
  message: string | null,      // plain words, safe to show; null when verdict is 'read'
  verdict: 'read'              // every row exact
         | 'check'             // some rows exact or partial: ask the user to confirm the flagged rows
         | 'none',             // nothing usable
  brand: 'DMC',
  brandSeen: 'DMC' | 'Anchor' | 'AuriFloss' | 'Aurifil' | 'Madeira' | 'Cosmo' | null,  // the brand word printed in the key, if read
  entries: [Entry],            // printed order (top to bottom, then left to right in a multi-column key)
  rows:    [Row],              // same index as entries
  columns: [{ kind, x0, x1 }], // x relative to the swatch column's left edge (debug use)
  totalStitches: number|null,  // sum of the read count column, when every row's count was read
  box: {x,y,w,h},              // the region read (the crop, or the whole picture)
  stats: { exact, partial, blank, rows, glyphClusters, H, solve, warnings: [string], ms, worker },
  ms, token
}
```
Column kinds: `index` (row numbers), `symbol`, `brand` (a constant word such as DMC), `code`,
`number` (another brand's number, e.g. Anchor, right after the code), `name`, `count`, `text`.

`Entry` (the `XStitch.parseKey` entry shape, so the import flow can treat it like a text key):
```
{ symbol: '', brand: 'DMC',
  code: '310' | 'White' | null,   // non-null ONLY when read.status === 'exact'
  name: 'Black' | '',             // the TABLE's name, only when the printed name matched it
  hex: 'rrggbb' | null,           // the table colour when exact, else the printed swatch, else null
  strands: null, skeins: null, kind: 'cross', blendCode: null,
  stitchCount: number | null,     // = read.countRead (null unless read.countStatus is 'read')
  symbolUnreadable: true,         // there is no text symbol; see glyph
  line: 'DMC 310 (read from the picture)',
  glyph: Glyph | null,
  read: {
    status: 'exact' | 'partial' | 'blank',
    confidence: 0..1,
    text: '310' | '3?0' | 'White' | '',   // what to show; '?' marks a digit not pinned down
    candidates: ['310','340'],     // partial: the table codes still possible (<= 6); else []
    evidence: ['table', 'swatch dE 3.2', 'count 1839 = chart', 'name', 'template', 'word White', 'swatch light'],
    why: string | null,            // plain reason for a partial / blank
    swatchHex: 'rrggbb' | null,    // the printed swatch colour (null when the row has none)
    dE: number | null,             // CIEDE2000, swatch vs the code's table colour
    nameMatched: boolean,
    countRead: number | null,      // the printed stitch count, only when every near solution agrees
    countStatus: 'read'            // countRead is the printed count
               | 'not-read'        // the key prints counts but this row's was not read: say "count not read"
               | 'none',           // the key prints no stitch counts at all
    countWhy: string | null } }    // plain reason when not 'read': "no count was found on this row",
                                   // "the count's digits could not be pinned down", "the key prints no stitch counts"
```
When `status` is `partial`, show `text` with a one-tap confirm per candidate (or a box to type in);
when `blank`, a box to type in. Never write a partial's first candidate as the code.

What makes a row **exact**: the cluster-to-digit mapping is the same in every solution within the
margin of the best, the code is a real DMC code, AND at least one independent check holds: the
printed swatch is within CIEDE2000 18 of the code's colour (colour keys only), the count equals a
chart class of that colour (±1), the printed name matches the table's name, or (when the key is
mostly explained) every digit is a clear font-template match. A column counting 1, 2, 3 … is
treated as row numbers, never as codes; one- and two-digit codes (DMC 1–35) need the swatch,
count or name; a search cut short by its budget needs both checks.

`Row`: `{ box: {x,y,w,h}, cells: [{ kind, box }] }`, cell kinds as columns plus `swatch`.

`Glyph` (the designer's own symbol; proposal 02 #9 / R5):
```
{ w: 16, h: 16,
  bits: '<base64 of 32 bytes: 256 bits, row-major, MSB first, 1 = ink>',
  clean: boolean,     // isolated, high contrast, one piece, agrees with a second print on the swatch
  box: {x,y,w,h},     // where it was cropped from (source px)
  onSwatch: boolean,  // true when taken from inside the swatch (no separate symbol column)
  path: null }        // vector path: not available yet (needs per-path data from PdfText)
```
The bitmap is the symbol inside a square cell the size of the row's swatch, so relative size is
kept (a small dot stays small). Show the pattern's symbol only when `clean` (BUILD decision).

## Keys that are not read: Anchor-only, AuriFloss and other brands
Only DMC numbers can be checked (the app ships no other floss table). When the key's brand column
("Anchor 403") or the header over its number column ("ANCHOR", "AuriFloss") reads as another brand,
**every row comes back blank**, `code: null`, `brandSeen` set, `stats.warnings` says so, and each
row's `read.why` is the sentence to show, e.g. *"this key lists Anchor numbers; only DMC numbers can
be read from a picture"* (`read.evidence: ['brand Anchor']`, `countStatus: 'not-read'`). Brands
recognised this way: Anchor, AuriFloss, Aurifil, Madeira, Cosmo. A key that prints **no brand word
at all** is assumed DMC; a non-DMC key with no brand word can still yield rows, but each code must
pass the DMC table and an independent check (swatch colour, count, name), and keys in other
numbering (orr-book14's J. & P. Coats) came back all blank in testing. A key with DMC and Anchor
columns side by side is read by its DMC column (the Anchor column is typed `number`).

## `XSKeyRead.readNumbers(source, boxes, opts?) -> Promise<[NumberRead]>`
The same digit reader for ruler numbers and count columns. `boxes`: `[{x,y,w,h}]` in source px,
each holding one number. `opts`: `{ expect: 'step' | 'ascending' | null, step?: 10, min?, max?,
noWorker? }`. Returns one entry per box, in order:
```
NumberRead = { box, text: '120' | '1?0' | '', value: number | null,
               status: 'exact' | 'partial' | 'blank', confidence, candidates?: [string] }
```
With `expect`, the sequence pins the digits (each neighbouring pair scored, so one badly cut
number does not void the ruler). Without it, a number is exact only when every glyph is a clear
template match. An empty `boxes` resolves `[]`.

## `XSKeyRead.cancel(token?) -> boolean`
Cancels one job (or all, with no token): a running worker is terminated; the promise resolves
`{ ok:false, reason:'cancelled', message:'Stopped.', verdict:'none', entries:[], rows:[] }`.

## `XSKeyRead.version` — `'1.0.0'`

## Whole pages
Given a whole PDF page (chart + key + photo), the reader takes long thin rules out of the picture
and ignores big dense regions (the chart), but on the fixtures it still reads far fewer rows than
on a crop (see `docs/wave-k/xs-keyread.md`), and a 2400 × 3100 page takes 2–3.5 s. Pass `crop`
(from the user's drag box or a page segmenter) for the key panel; a crop reads in 0.1–0.4 s.
