# Wave J: app (reading a chart picture, and Row by row)

Files: `js/app-xstitch.js` (Edit only), `css/xstitch.css`, one line each in `index.html` (the script tag after
`js/xstitch-photo.js`) and `sw.js` (`./js/xstitch-read.js` in `PRECACHE_URLS`, `CACHE_VERSION` not touched), and a
new group 11 in `test/crafts.test.html`. Nothing committed.

## What the user sees

**Three ways in (feature-detected).** When `window.XSRead` is missing, none of this appears and the import surfaces
are exactly as before (asserted).
1. **A picture.** ⋯ → Import pattern takes PNG / JPEG / WebP by drop or file choice. There is also a new
   "🖼 Read a picture of a chart" item, and a pasted screenshot is read too (only while the import sheet is the top
   sheet). The New project drop zone takes pictures through `importAccept`, which is now a getter, so it is read when
   the zone mounts. A picture goes to `XSRead.detect` first. If the grid is confident (≥ 0.6, a known style), the
   check opens straight away. Otherwise the app asks **"Is this a chart or a photo?"** and offers "A chart, one square
   per stitch" or "A photo to turn into a chart". The second opens the existing photo converter with the photo
   already loaded (`openPhotoSheet(projectId, file)`). A picture is never sent to either one silently. If the project
   already has a key (for example from a key-only PDF import), that key and its design size are used.
2. **A PDF whose chart is a picture.** The import card shows "🖼 Read the chart from the page pictures":
   - at once when the vector grid reader is not offered (no counts, a scan, or no key);
   - otherwise only after the vector reader fails or matches fewer colours than it read.

   The app looks at up to 12 pages (each drawn about 1600 px long and run through `detect`). It prefers the page
   whose grid is the declared design size (an alternative size counts too), then redraws that page so a square is
   at least 8 px (capped at 4096 px a side and 16 MP) and opens the check with the parsed key and size. A page that
   holds only part of the design is named as such. In that case, or when the size does not match, the app says so
   and offers "Read page N as W × H anyway". The text under that button changes with whether the key has counts.
   "Use this chart" then saves the PDF pages exactly as a PDF import does. A Stop button cancels.
3. **No key.** Colours are named by nearest DMC. Each row has "change" (type a DMC number; the swatch and name show
   as you type) and a box to type the key's count. Two colours given the same number join into one row, and become
   one palette entry when the chart is used.

**The check ("Read a chart picture" sheet).**
- **Status line** (`role=status`): "Reading… sample 40%" while it runs, then "Read 144 × 85 squares · 6 colours ·
  5,721 stitches.", or the reader's own failure message.
- **The picture** with the grid that was found drawn over it: 10-lines and the outline with a light halo, single
  lines once a square is 4 px or more. **What was read** draws the read preview over the same area, aligned with
  the picture, with unsure squares outlined in `--danger`.
- **Viewing.** Pinch, wheel or drag to move and zoom, double-tap or Fit to frame the chart that was found, and
  `+` `−` `0` and the arrow keys from the keyboard. Redraws go through rAF and the reading runs in the reader's
  worker.
- **Verdict line** coloured by verdict (`check.summary`), then "N squares are unsure … Show them". Show them steps
  through the unsure squares, centred and zoomed ("Unsure square at column 123, row 46").
- **Count table** (a real `<table>` with a caption): swatch and symbol, code · name, Read, Key, then ✓, ✓ ±n
  (within tolerance), or ±n in red. A key colour with no printed count (`ok: null`) shows a box to type the count,
  never a ✗. Typed counts are checked again at once with `XStitch.checkCounts`, with no new read.
- **Unmatched kinds of square** each show their glyph and a choice: a key colour, fabric, or "Another DMC
  colour…" (adds it to the key). Choosing one reads again with `assign`. Nothing is guessed.
- **Adjust the read** (opens itself on a failure):
  - width and height steppers ("Size from the key / as you typed it / found in the picture");
  - Move the grid (← → ↑ ↓, an eighth of a square each);
  - Square size (Smaller / Bigger, 0.2 %), with "Each square is 6.01 × 6.00 pixels (moved by you)" and "Let it find
    the grid again";
  - Fabric: Find it / None / Tap it (tap a square of fabric on the picture);
  - Squares differ by: Either / Colour / Symbol;
  - "Match to this project's key";
  - Crop to the chart: the photo converter's crop frame, now shared as `makeCropFrame`.

  Every change reads again after a 300 ms pause and cancels the read in flight. Results from a superseded token are
  dropped.
- **Use this chart** (asks first when the verdict is "off"). This is one `Store.updateCraftData` step through
  `XStitch.normalize`. The key's own names, strands, printed counts and skeins are kept, and so are the project's
  fabric, pages and notes. The source picture goes to BlobStore (`p:<id>:readsrc:0`) with the read's details
  (`p:<id>:readsrc:meta`: the check, the options, the key, a fingerprint of the cells).

**On the project.** A band under the chart strip reads:
- "Read from a picture. All 6 colours are within a stitch or two of the key (5,721 of 5,721 stitches) …", or
- "Read from a picture. 2 colours are off; open the chart check.", or
- the unchecked wording.

Tapping it reopens the check with the saved picture, key and options. The band shows only while the chart is the
one that was read (the fingerprint), so Undo hides it.

**Row by row** appears on every project with a grid, once the key worker's functions exist. It opens from
"☰ Row by row" under the tap button (also the tour target), from ☰ in the chart sheet and from the ⋯ menu.
- **Options**, kept per project in view state plus as the last-used options: start from Top / Bottom, Left to right
  / Back and forth, All colours / One at a time (picked from swatches of the key), and Hide empty rows. A summary
  line sits on the collapsed details.
- **The row you are on** (the first one not done): a big "Row 7" in the display face, "of 85 · left to right → ·
  55 stitches", big run chips (swatch with symbol, count; "skip n" dashed and muted; a system face so the pixel
  themes fit; a long row scrolls inside the card), and the `rowText` sentence for screen readers.
  - **Row 7 done** (64 px) marks `XStitch.cellsOfRow` in the progress bitmap through the existing `commitBulk`: one
    undo step, with milestones.
  - A second tap reads "✓ Row 7 is done · tap to unmark" and unmarks.
  - ‹ Previous / Next › move between rows. After a row is done, Next becomes the primary button.
- **Copy all rows / Copy this colour**: the clipboard, falling back to the existing text sheet. A header line with
  the project name and size, then one `rowText(…, {names:'code+name'})` line per row.
- **The row list** scrolls on its own (shown 30 rows at a time with "Show earlier / more rows"). Each row is a
  button whose label is its `rowText`. Tapping it focuses that row and moves the chart's crosshair (and
  `current.cx/cy`, with no undo step) to the column where its first stitch is worked.
- Undo in the sheet's footer.

FAQ: "Can it read a picture of a chart?". Tour: a "Row by row" step before the key.

## Measured in the pane (real numbers)

**Acceptance case** (`xs-potatoes-preview.webp`, the six key colours from `xs-potatoes.key.json` →
`XStitch.parseKey` → the real key-only PDF import path, so the project holds the key and 144 × 85), dropped through
the import sheet's own zone (`.dz-wrap.take(file)`):

| colour | read | key |
|---|---|---|
| DMC 04 Tin - Dark | 100 | 100 |
| DMC 310 Black | 1,839 | 1,839 |
| DMC 745 Yellow - Light Pale | 305 | 305 |
| DMC 842 Beige Brown - Very Light | 1,135 | 1,134 (+1) |
| DMC 3032 Mocha Brown - Medium | 1,159 | 1,159 |
| DMC 3827 Golden Brown - Pale | 1,183 | 1,184 (−1) |
| total | 5,721 | 5,721 |

- The verdict is "close". 6 squares are unsure. Three reads in a row were identical, so the read is deterministic.
- One earlier run, while the reader's file was still changing, read 1,136 / 1,182 with 7 unsure squares.
- detect found 144 × 85 with no size given and opened the check directly.
- Use this chart gave 144 × 85 cells, the PDF names and counts, and `source.kind:'picture'`. The banner showed, and
  after a reload it came back from BlobStore. Chart viewer: the design with rulers and the crosshair.
- Row by row:
  - row 7 is the first row (55 stitches of DMC 310);
  - Row done gave doneCount 55, and `rowDone` was true;
  - Undo in the sheet gave 0;
  - a second tap gave done (55), then a third gave unmarked (0);
  - tapping row 9 moved the crosshair to (11, 8).
- Copy all rows (serpentine) gave "Row 8 (right to left): skip 12, 8 × DMC 310 Black, …".

**No key, same picture**:
- 7 colours. DMC 04 comes back as two clusters, 60 as DMC 413 and 40 as DMC 838.
- After renaming both to 04 and typing the six counts, the verdict is "close" (the same counts as above).
- Use: 6 colours, 04 = 100. One Undo took the project back to no chart.

**Image-only PDFs** (page pictures; the pane was shown so pdf.js could draw):
- `xs-satsuma-stayhome-color.pdf`:
  - The PDF has no text: the band said it is a scan, and the picture button was offered at once.
  - Page 1 was picked and drawn at about 13 px a square. It read **90 × 81 squares, 22 colours, 3,372 stitches,
    unchecked** (there is no key to check against).
  - The truth is **70 × 97** (wave E audit), so the size was wrong. The UI did not claim it was right.
  - With 70 × 97 typed: 24 colours, 3,161 stitches, squares of 16.86 × 15.78 px. Squares that are not square say
    the box found still includes the key panel, so the stitcher would need to crop. **Not trustworthy, and shown as
    unchecked.**
- `xs-tinymodernist-matryoshka.pdf`:
  - The PDF has no colour key, but its text gives 81 × 66.
  - Page 1's grid looked like 86 × 119. The UI said "The grid on page 1 looks like 86 × 119 squares, but the PDF says
    81 × 66" and offered "Read page 1 as 81 × 66 anyway".
  - Reading it anyway made the reader fail with "more than 60 distinct colours" (the page also carries a photo of
    the stitched piece and the key). The UI shows that message, suggests cropping to the chart, and opens the crop
    frame.

**Regression checks:**
- Photo to chart: picked through the question, with the crop frame refactored. Arrow keys on a corner change the
  crop and read again.
- PDF import and the chart sheet look as before.
- The tap button is unchanged.

**Sizes and themes:**
- 375 × 812, 375 × 640 (the frame shrinks to 34 vh) and 1280 × 800 (desktop), with no sideways scroll.
- Themes: Stardrop Night (`stardew-night`), Pixel Wyrm (`dragon-pixel`: the chips moved to a system face because
  Press Start 2P pushed Row done off the screen; Previous / Next shortened) and Pelican Town Spring (light).

## Suites (baseline → now)

| suite | baseline | now |
|---|---|---|
| xstitch | 752 | 945 (key worker's additions) |
| xstitch.fixtures | 493, 9 skipped | 512, 9 skipped |
| xstitch-photo | 131 | 131 |
| crafts | 124 | **159** (35 new in group 11) |
| sw | 29 | 29 |

All failures 0. Group 11 loads `app-xstitch.js` in a frame with a stub App and checks:
- `importAccept` with and without the reader;
- `isImageFile`;
- `pickPdfPage` (declared match, half-pitch alternative, tile, none);
- `pdfReadScale` (at least 8 px, and the caps);
- the banner, unsure and checkOff wording (`ok:null` is unchecked, not off);
- `codeKey` (04 = 4);
- `cellsPrint`;
- the Row by row option defaults and round trip;
- one-colour `writtenOptsFor`;
- `firstStitchX` on an rtl row;
- `rowsAvailable`.

## Contract changes / decisions
- `craftData.source = { kind:'picture', check:{verdict, summary, readTotal, expectedTotal, off, colours}, picture }`
  and `craftData.current.rowOpts` are written as the contract asks. However, `XStitch.normalize` strips both on the
  next load (`SOURCE_KINDS` has no 'picture'; `current` keeps only known keys), so:
  - the banner falls back to the BlobStore meta (checked against the cells' fingerprint);
  - Row by row falls back to `Store.craftSettings('crossstitch').rowOpts` (the last options used).

  Both work across a reload today.
- QA hooks: `window.XStitchApp.__test` (pure helpers plus `openReadSheet`, `openRowsSheet`, `reopenRead`,
  `handlePicture`, `applyKey`). It is the module's only global and is never called by app code.
- The unsure outline threshold is `XSRead.LOW_CONF` (90), and the count shown is the reader's `lowCells`.
- Row done stays on the row (so a second tap unmarks it, as the contract says) and makes Next the primary button. It
  does not move on by itself.

## Left
- Charts split over several pages, photos of paper charts taken at an angle, and backstitch: out of scope this wave,
  and the UI says so.
- (Answered in the follow-up below: a `.thready` backup carries the read picture.)
- On the PDF path, a key with no counts (Satsuma, Tiny Modernist) can only be checked if the stitcher types the
  counts.

## For the owner of `js/xstitch.js`
- Please add `picture` to `SOURCE_KINDS` and keep `source.check` (`{verdict, summary, readTotal, expectedTotal, off,
  colours}`) and `source.picture` (a BlobStore key). Please also keep `current.rowOpts` (`{from, dir, one,
  skipEmpty}`) in `normalize`. The app then reads them directly. Its fallbacks keep working either way.
- `checkCounts` summary grammar: when only some rows have counts and exactly one does, it reads "All 1 colours the
  key counts match the key exactly". Seen when one count was typed in the no-key path.

## For the owner of `js/app.js`
- The New project zone builds its label from `importAccept`, so cross-stitch now reads "Drop a cross-stitch PDF or
  .oxs / .png / .jpg / .jpeg / .webp file here". An optional `def.importLabel` would let the module say "a PDF, an
  .oxs file or a picture of a chart".

## For the owner of `js/xstitch-read.js`
- No key: the owner's DMC 04 (100 squares) comes back as two clusters (60 + 40). The app copes (renaming both to 04
  joins them), but one cluster would be better.
- Satsuma "Stay home" colour page: `detect` gave 90 × 81 for a 70 × 97 chart, and the box found seems to include
  the key panel (pitch 16.9 × 15.8 when forced to 70 × 97).
- Tiny Modernist matryoshka page: 86 × 119 for an 81 × 66 chart, because the page also has a photo and a key.

## Follow-up (after the key worker kept `source.check` / `source.picture` / `current.rowOpts`)

**1. craftData is the only source of truth.**
- The "Read from a picture" band reads only `craftData.source` (`kind:'picture'` plus `check`).
- Row by row reads and writes only `craftData.current.rowOpts`, through `saveViewState` with `{undo:false}`.
- I **removed** both device-storage fallbacks: the band's BlobStore lookup with its cells fingerprint, and the
  `craftSettings.rowOpts` "last used" options. Nothing outside my own test profiles was ever saved without the new
  fields. The feature is uncommitted, and those profiles were deleted.
- The BlobStore meta (`p:<id>:readsrc:meta`) is still written, but only so "open the chart check" can bring back the
  read's options and key. It is never used to decide what the band shows.
- `reopenRead` now finds the picture through `source.picture`, so after an import that re-keys the project (Store's
  `rekeyBlobs` rewrites that string) it follows the new id. The meta key is derived from the same name.
- A project in a pre-follow-up state shows no band (correct: there is no record in its craftData).
- The obsolete "For the owner of js/xstitch.js" request above (keep these fields) is done. The second note there (the
  `checkCounts` grammar) was also fixed by the key worker.

Verified in the pane, in private profiles, with the real potatoes flow (the key through the PDF key path, the picture
dropped, Use this chart, then Row by row options set to Bottom / Back and forth):

| check | result |
|---|---|
| reload | band shows the "within a stitch or two" verdict; options summary "From the bottom · back and forth · all colours · empty rows hidden"; current row "Row 6 · right to left" |
| `Store.exportJSON` → `importJSON` into an empty profile | `source.kind` picture, `check.verdict` close, `source.picture` kept, `rowOpts` {bottom, serpentine, one:false, skipEmpty:true}; band shows on the imported project |
| Undo (Row done: 12 stitches → Undo → 0) | band stays, `rowOpts` unchanged |
| Undo of "Use this chart" | the chart is gone, `source.kind` back to manual, no band |

Redo: the Store has no redo (`Store.redo` does not exist), so there is nothing to check. The options are view state
(`{undo:false}`, like zoom and crosshair): an Undo restores whatever options were in the snapshot it returns to.

**2. A `.thready` backup does carry the picture.** I checked this, not assumed it.
- `Store.exportThready` walks `BlobStore.entries('p:' + pid + ':')` for every project, and my keys
  `p:<id>:readsrc:0` / `p:<id>:readsrc:meta` already follow that convention. No key change was needed.
- The round trip:
  - export a `.thready` holding two projects, one read from a picture;
  - delete every BlobStore key of those projects;
  - switch to an empty profile, then `readBackupFile` → `importJSON` → `importPages`.
- The result:
  - `p:<id>:readsrc:0` came back as `image/webp`, **148,190 bytes, the same size as the original file**;
  - the meta came back (as `application/octet-stream`, which `readJsonBlob` reads as text);
  - the band showed;
  - tapping it reopened the check ("Read 144 × 85 squares · 6 colours · 5,721 stitches.").
- Not exercised: a "keep both" import that gives the project a new id. The code path (`rekeyBlobs` plus
  `importPages` copying under the new id, and `reopenRead` following `source.picture`) is in place but untested.

**3. The new `checkCounts` wording.** Nothing in `js/app-xstitch.js` matches summary text. The UI shows
`check.summary` as is and branches only on `verdict`, `ok`, `expected` and the counts. I searched the file for
"match the key", "within", "no stitch counts" and "prints no": the only hits are the app's own sentences. The band
shows the new summaries unchanged.

**Suites after the follow-up** (all 0 failed):
- xstitch 969
- xstitch.fixtures 512, 9 skipped
- xstitch-photo 131
- crafts 159
- backup 205
- sw 29

All my private profiles, their projects and their BlobStore keys (`readsrc` included) were removed afterwards.
