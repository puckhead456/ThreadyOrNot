# API: `window.Ocr` (wave K, ocr worker, proposal R4)

Status: BUILT (spike, wave K). Measurements and the ship recommendation: `docs/wave-k/ocr.md`.

`js/ocr.js` is an ES5 IIFE, one global `window.Ocr`. It is **not** in `index.html` or `sw.js`
PRECACHE_URLS by default: the shell may load it, but the
engine files under `js/vendor/tesseract/` are fetched **only** inside `Ocr.install()`, which the
maker starts by tapping a button. Feature-detect: `if (window.Ocr && Ocr.available()) …`.

All recognition runs in a Web Worker (tesseract.js v5 + LSTM-only WASM core). Nothing leaves the
device; no CDN, no telemetry. Same-origin files only.

## Install state
| call | returns |
|---|---|
| `Ocr.available()` | `boolean`: this browser can run it (Worker, WebAssembly, Cache Storage, fetch, Blob URLs). Sync. |
| `Ocr.downloadSize()` | `{ bytes, mb, label }`: what `install()` will fetch (from the manifest in `js/ocr.js`; `label` like `"about 5 MB"`). Sync. |
| `Ocr.installed()` | `Promise<boolean>`: every engine file is in the `thready-ocr-v1` cache. |
| `Ocr.install({onProgress, signal})` | `Promise<{bytes, ms}>`. Fetches each file same-origin (`cache: 'no-cache'`) into Cache Storage bucket `Ocr.CACHE` = `'thready-ocr-v1'`; `onProgress({loaded, total, file, fraction})`. Idempotent: files already cached are skipped; concurrent calls run one after the other. Rejects `.name === 'AbortError'` on cancel (a half-downloaded file is never stored; complete ones are kept and skipped next time). Size today: 5,150,817 bytes raw (one core variant), about 3.1 MB gzip on the wire. |
| `Ocr.remove()` | `Promise<boolean>`: terminates the worker and deletes every `thready-ocr-*` bucket. |
| `Ocr.storedBytes()` | `Promise<number>`: bytes in the bucket now (for "Text reader: 4.9 MB · Remove"); never creates the bucket. |
| `Ocr.hasSimd()` | `boolean`: which core variant this device gets. |
| `Ocr.CACHE` | `'thready-ocr-v1'` |
| `Ocr.VERSION` | the vendored tesseract.js version string |

After `install()` the engine never touches the network: the worker script, the WASM core and
`eng.traineddata` are read from Cache Storage and handed to the worker as Blob URLs / bytes. So it
works offline **without** any `sw.js` change, provided `sw.js` does not delete the bucket (see the
report's "For the owner of sw.js").

## Recognition
`Ocr.recognize(source, opts)` → `Promise<OcrResult>`
- `source`: `HTMLCanvasElement | ImageData | ImageBitmap | Blob` (a canvas is the common case:
  `handle.renderRegion(n, rect, {dpi: 200})`).
- `opts = { psm, whitelist, mode, rotate, onProgress, signal, dpi }`
  - `psm`: Tesseract page segmentation mode, default `3` (auto). `6` = one block, `11` = sparse text.
  - `mode`: `'text'` (default) | `'codes'` (floss keys: whitelist `0-9`, space and the letters of DMC,
    ANCHOR, B5200, E-codes, White, Blanc, Ecru; psm 11) | `'digits'` (whitelist `0-9 . , / -` and space; psm 6).
    The space must be in a whitelist or LSTM Tesseract runs the words together.
  - `rotate`: default true in text mode (false in codes / digits / whitelist runs). When the upright
    reading has mean confidence under 75, the picture is read turned 90 and 270 degrees too and the
    reading with clearly more good words (conf ≥ 60) wins; `result.rotation` says which (0 / 90 / 270)
    and every box is mapped back to the source picture's pixels. Costs up to 3 readings on a poor page.
  - `whitelist`: explicit `tessedit_char_whitelist`, wins over `mode`.
  - `onProgress({stage: 'loading'|'recognizing', fraction})`.
  - `dpi`: the render density; sets Tesseract's `user_defined_dpi` (unset: Tesseract estimates it).
    Boxes stay in canvas pixels; `toTextItems` converts them with `scale`. 200 is the recommended density.
- Starts the worker on first use (one worker, kept until `Ocr.terminate()` / `remove()`).
- Throws (rejects) `{name: 'NotInstalledError'}` when `install()` has not completed.

```
OcrResult = {
  words: [{ text, conf /*0..100*/, bbox: {x0, y0, x1, y1} /* canvas px, origin top-left */,
            line /* index into lines */ }],
  lines: [{ text, conf, bbox, words: [index…] }],
  text,          // lines joined with '\n'
  conf,          // mean word confidence 0..100
  rotation,      // 0 | 90 | 270: how the picture was turned to read it (boxes are in source pixels)
  ms,            // recognition wall time (worker, excluding first engine load)
  loadMs,        // engine start-up on this call (0 when already warm)
  size: { w, h } // pixels recognised
}
```
`Ocr.cancel()` → stops the current `recognize` (terminates the worker; the next call restarts it;
the pending promise rejects `AbortError`). `opts.signal` does the same for one call.
`Ocr.terminate()` → frees the worker's memory (WASM heap) without removing the files.

## Feeding the existing parsers: synthetic PdfText items
`Ocr.toTextItems(result, {pageWidth, pageHeight, scale, offsetX, offsetY, minConf})` → `PdfText`-shaped layout
lines for an image-only page, so readers that use `handle.layout(n).lines` / `textIn` can take them:
```
[{ i, text, box:{x0,y0,x1,y1} /* page units, points, top-left */, nbox /* 0..1 */,
   font: 'ocr', fontId: null, size /* box height in points */, margin,
   ocr: true, conf /* line mean */, words: [{text, conf, box, nbox}] }]
```
- `scale` = canvas px per page unit (e.g. `region.scale` from `renderRegion`, or `dpi / 72`);
  `offsetX`/`offsetY` = page units of the rendered region's top-left (`region.box.x0/y0`) for a crop.
- Words below `minConf` (default 0: keep all, the caller decides) are dropped; a line with no words
  left is dropped.
- `Ocr.toPlainText(result, {minConf, dropMargin})` → the text, one OCR line per line, for the line-based
  parsers (`Patterns.parse`, `Knits.parse`, `Sewing.parse`, `XStitch.parseKey`). **Pass `dropMargin: true`
  before any parser**: it drops lines in the top / bottom 8% and a lone page number (`126`, `[126]`)
  opening or closing the text block. Kept, the knitting parser took four Nicoll page numbers for counts.
- OCR line order is Tesseract's block order, not PdfText's column untangling: on two-column pages
  lines of the two columns can interleave. Give a parser one column (a `renderRegion` of it) at a time.

Every consumer must mark text from here as "read from a picture — check it" and force the
confidence banner to "check every row".

## Floss-code helper
`Ocr.codesFrom(result, {lexicon})` → `[{ text, code /*normalised*/, conf, bbox, sure }]`: words
shaped like floss codes (`/^(B5200|E\d{3,4}|\d{1,4}|White|Blanc|Ecru)$/i` after folding `O→0`,
`l/I→1` only inside digit runs). `sure` is `conf >= 80` **and** the token needed no folding **and** (when a `lexicon` array, Set or
object is given) the code is in it. Always pass the DMC lexicon: in the spike Satsuma's "727" once came
back as a confident "127", which only a lexicon catches. `Ocr._foldCode(text)` is the folding alone. An unsure code must be shown as unsure, never filled in.
