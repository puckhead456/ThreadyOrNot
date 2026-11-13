# Wave K: xs-audit report (the cross-stitch screens looked at, driven like a stitcher, fixed)

Status: DONE for this pass. Owner of `js/app-xstitch.js`, `css/xstitch.css`, `js/app-xstitch-extras.js`,
`css/xstitch-extras.css`, `test/xstitch-extras.test.html`, NEW `test/xstitch-app.test.html`, NEW
`test/xstitch.gallery.html`. Only those files were edited. Nothing committed.

## Suites (headless, `tools/headless-suite.sh`)
| page | baseline (before my first edit) | end |
|---|---|---|
| **xstitch-app.test (new)** | — | **241 / 0** (includes the 19 `selfCheck` checks; the potatoes group reads `tmp-pdf/` at runtime and skips without it) |
| xstitch-extras.test | 114 / 0 | 115 / 0 (+1: kit list prints "DMC B5200"; the pace seeding no longer fails between 00:00 and 01:00) |
| xstitch.test | 1118 / 2 on the first run, 1120 / 0 on re-run (a live xs-core save) | see "Final run" |
| xstitch-render.test | 62 / 0 | see "Final run" |
| crafts.test | 243 / 0 | 283 / 0 (shell-ui's additions; the cross-stitch group stays green) |
| workmode.test | 101 / 0 | 111 / 0 (shell-ui's `surfaceUnderHud`) |
| checksheet.test | 58 / 0 | 58 / 0 |
| xstitch.fixtures (TIMEOUT=600) | 581 / 1, 9 skipped (engine side) | see "Final run" |
| xstitch-read.test (TIMEOUT=600) | 286 / 6 (xs-read mid-edit; 292 / 0 per the coordinator after its fix) | see "Final run" |

Final run: recorded at the bottom of this file.

`xstitch.test` failed 1–2 assertions on two of six runs and passed on re-run every time: it does not load
any file I own (timing / a concurrent save).

## What I looked at, at which sizes and themes
- **Headless pictures** of `test/xstitch.gallery.html` cards, every PNG read by me: 26 cards
  (project screen, the screen scrolled to the key, the loupe on a 224 × 288 chart, Stitch mode, Stitch mode
  zoomed in over a busy chart, Stitch mode's Options, the full chart, Floss, Fabric & size, Pages,
  Parking, Row by row, Find my place, "Which colour are these?", the grid check, the "not told apart"
  band, the ⋯ menu, Share a picture, and the eight extras sheets) at **375 × 812**, with Stitch mode and
  the project screen also at **375 × 640**, in **Stardrop Night, Pixel Wyrm and Stardrop Spring** (light).
  The extras sheets were looked at in Stardrop Night only (xs-extras had covered the other two).
- **GPU:** `--enable-unsafe-swiftshader --use-angle=swiftshader --ignore-gpu-blocklist --enable-webgl`
  in headless Chrome gives the stitched-fabric renderer real WebGL: shaded thread crosses in the floss
  colours, the ghost of the stitches still to do, the next stitch boxed, the minimap. The **Canvas 2D
  fallback** (`&render=2d`, which passes `force2d`) draws flat crosses on a weave grid: it also reads as
  stitched fabric. Under `--disable-gpu` the renderer falls back by itself.
- How: the gallery card is the real app in a frame; my own CDP script (temp dir, never the repo) sets
  the viewport to the card size, waits for the title `ready:<card>` and takes the PNG. Headless Chrome's
  window cannot be under 500 px, so the device-metrics override is what makes 375 px exact.
- **Real charts in the Browser pane** (one tab, private key `stitchkeeper-wavek-xsaudit`, rAF shimmed in
  that tab only, files fed through the import sheet's own file input): see "Real charts" below. Every
  project, its BlobStore entries and the key were removed; the tab was closed. Screenshots in the pane
  were not used (DOM reads + the headless pictures).

## Defects found (and what was done)
Order: wrong colour / count / instruction first, then phone usability, then the open items, then polish.

| # | what | where seen | fixed? | assertion |
|---|---|---|---|---|
| D1 | **The stitch count in the tap button was invisible**: the caption, number and hint were loose in the button, so the stitched-picture canvas (and the flat preview) painted over the number. | gallery `main`, every theme | **fixed**: caption + number in the shell's pinned `.stitch-head` row (as crochet), renderer `safeInsets.top` measured from it | app 2: the row is positioned with z-index ≥ 1 |
| D2 | **Stitch mode's bottom row ran ~70 px off a 375 px screen**: "+1 Stitch" (the main button) was off-screen and "−1 Back" clipped. Six corner buttons with words do not fit. | gallery `stitchmode` | **fixed**: five buttons (‹ › ↶ −1 +1, no words), 54 px (46 px under 340 px wide), 🎯 moved into Options ▾ and the N key | app 3: every corner button inside 375 px; +1 present; every HUD button ≥ 44 × 44 |
| D3 | The grid read's head said "**9 of 9 colours matched**" right above "All **10** colours match the key exactly" (Pac-Man: the reader counts inks; two key colours share one ink). | Pac-Man in the pane | **fixed**: the head gives the size and the key colours ("…grid in 10 colours."); the check line is the one statement about the key | app 4 (four verdicts) |
| D4 | **Tile joining included a cover photo** and the whole join failed ("Page 1 could not be read: … more than 60 colours"): the first real run of #11, on the 5-page sampler. | pane | **fixed**: only pages whose squares match the found tile's (±20 % at page scale) are joined (`tilePages`) | app 16 |
| D5 | **A joined chart of the wrong size was offered as the primary "Use this chart"**: the sampler joined to 178 × 238 against the PDF's stated 138 × 172, with no key to check against. | pane | **fixed**: a joined size that differs from the PDF's stated size is said in plain words and demotes Use to "Use it anyway…" behind the confirm; seams are named by the PDF's page numbers (was the tile index: "Pages 1 and 2" for pages 2 and 3) | pane (DOM read); the engine fault is under xs-read |
| D6 | **Symbol soup as colour names**: the robin magazine key comes in as "DMC 954 · Zlnn9999MM", "DMC 3853 · 3Zlllnn9MMM", backstitch "fZZyYiiii", under a band that said "Read the key cleanly". | pane | **fixed in the app** (engine fault reported): a name with a digit, a 4-repeat or no vowel in a long word is replaced by the DMC table name (else empty), and the band says "… N names came out as chart symbols and were replaced …" instead of "cleanly" | app 18 |
| D7 | "Which colour are these?" would have said "key prints N" from `stitchCount`, which after a picture read can be the **read** count of a row the key printed nothing for. | code read while fixing the candidate line | **fixed**: only `keyCount` is "key prints" | app 5 |
| D8 | Kit list showed "DMC **b5200**" (the lookup key), and the shopping text the same. | gallery `x-kit` | **fixed** (extras): the chart's own spelling | extras: "DMC B5200" |
| D9 | Chart pages with a stitch range but no page picture (OXS, joined, synthetic) showed **empty dark boxes**. | gallery `pages` | **fixed**: the page's part of the chart is drawn as the thumbnail; "No page picture" when there is none | gallery (looked) |
| D10 | Floss: "**1 sts**". | gallery `floss` | fixed ("1 st") | — |
| D11 | Options ▾ in Stitch mode had a **78 px empty gap** under "TAP ON THE CHART" (the shell's label is sized for a row layout). | gallery `stitchmode-options` | fixed (CSS, scoped to `.xs-work-hud`) | looked |
| D12 | Stitch mode readout lines cut mid-word ("· islan…", "page 1 · 12 o…"). | gallery | fixed: two short lines (line clamp) | looked |
| D13 | Pixel Wyrm: "553 / 553" wrapped to two lines in the Stitch mode readout. | gallery Pixel Wyrm | fixed: theme-sized cell numbers (the theme already does this for `.work-big`) | looked |
| D14 | Key-row buttons ◉ / owned / ✎ were 40 × 44 px. | CSS read | fixed: 44 × 44 | — |
| D15 | "Watch it grow": the picture took 55 vh, so Play and the scrubber were below the fold. | gallery `x-grow` | fixed: 42 vh, controls visible at 812 | looked |
| D16 | "**This key has no stitch counts**" when no key was found at all (sampler join). | pane | fixed: "No colour key was found to check the read against" | — |
| D17 | A key read from a picture has no counts for 3 of the 6 potatoes rows (04, 310, 3827) and the sheet does not say "no count read" on those rows. | pane | **not fixed** (engine first: see xs-keyread); the chart read then marks them "not checked (no count printed)" correctly | — |
| D18 | Satsuma stay-home (picture PDF) reads **70 × 101** for a 70 × 97 chart, size not flagged doubtful. | pane | not mine (xs-read) | fixture assertion below |
| D19 | Robin (picture read): **107 × 141** squares and 1,103 stitches for a design the fixture notes give as 40 × 79; no counts, so "unchecked", not flagged. | pane | not mine (xs-read) | — |
| D20 | The grid check's footnote "1 colour on the chart **match** no key row" (grammar) in `CheckSheet.fromXStitch`. | gallery `gridcheck` | not mine (shell-ui) | — |
| D21 | `XStitch.normalize` turns `keyCount: 0` into **1** (`clampInt(0, 1, …)` clamps up), so a colour with keyCount 0 shows "1 st (from the key)". | gallery synthetic data | not mine (xs-core): one-line fix below | — |

## Open items from xs-app, now done
- **"Re-letter symbols"** (opt-in, #1): Floss shows "Re-letter symbols" with the reason ("4 pairs of colours
  share a symbol …") only when `XStitch.symbolCheck` says the palette repeats a family; it asks, re-letters
  with `assignSymbols({distinct})` ("?" kept on a colour still to choose, the pattern's own glyphs untouched)
  in **one undo step**. App 15.
- **A photo never replaces an imported key silently** (#1): "Use this chart" in the photo sheet asks
  "Replace this project's colours?" with what is lost ("This project already has 6 colours from its PDF key
  and a 144 × 85 chart. 120 stitches are marked, and the photo starts from zero. … The PDF pages stay. You
  can Undo it."), "Keep my key" / "Replace them". App 15 (the sentence); the confirm path itself was not
  driven through the photo converter.
- **Stitch mode under the HUD (85 % target)**: `surfaceUnderHud: true` on the spec (feature-detected
  through `api.underHud()`; an older shell ignores it). The chart canvas fills the screen; Fit, the pan
  limits, centring, the rulers, the position box and "keep the stitch just marked in view" all work in
  the free rectangle `api.insets()` reports (`makeChartView` gained an `opts.safe()`), so the current stitch
  is never parked under a panel. **Measured: the chart canvas is 375 × 812 = 100 % of the screen; the free
  rectangle Fit uses is ≈ 75 %** (it was 73 % for the whole canvas before). Readability over a busy chart,
  zoomed in, in all three themes: the readout panels are opaque enough to read on (theme primary at 82 %
  with blur), the corner buttons carry their own backgrounds; nothing reads worse than the crochet mode.
- **The reader's "no printed count" rows**: the picture-read count table shows such a row as
  "not checked (no count printed)" with no tick and no ±; the check sheet shows "?" "The key prints no
  count for this colour" (shell); never counted as off. **Owner's potatoes flow re-run** (key picture →
  "Use 6 colours" → chart picture): 144 × 85, 6 colours, 5,721 stitches; DMC 04 = **100** (was 413's),
  310 = 1,839, 745 = 305 ✓, 842 = 1,135 (key 1,134, ✓ +1), 3032 = 1,159 ✓, 3827 = 1,183 (key 1,184,
  unverified); "Use this chart" stays primary. App 17 asserts all of it, including all six colours within
  one stitch of the key after Use.
- **New**: when a chart picture holds its own key and no key is in hand, the read sheet offers
  "🔑 Read the colour key in this picture" (the key reader cropped to the segmenter's key region), and
  after "Use N colours" reads the same chart again against that key. Driven on Satsuma stay-home: 7 codes
  read, all 7 correct against the truth file (153 and six others outside the found box were not read);
  the chart re-read against them.

## Real charts, like a user (Browser pane, all through the import sheet's file input)
| chart | what happened | right? |
|---|---|---|
| Potatoes screenshot + key picture | above | 6 / 6 colours land right; two counts ±1, honestly shown |
| `xs-pacman.pdf` | key read cleanly (10 colours), grid read in 2.0 s, "All 10 colours match the key exactly (64,512 stitches)", Use it primary; 22 pages kept, page 9's region cols 107–159 · rows 78–154 (the printed tile); 10 / 10 clean designer glyphs; tap median **9.6 ms**, worst 16.2 ms in the pane (pane hidden, background tab); headless synthetic 224 × 288: median 2.9–4.4 ms, worst 3.9–9.2 ms | yes (D3 fixed) |
| `xs-pokemon-tl.pdf` (quadrant, 72 pages) | key 105 colours, grid read in 11.1 s, "All 105 colours match the key exactly (250,000 stitches)", Use primary. Not applied (564 KB of craftData) | yes |
| `xs-satsuma-stayhome-color.pdf` (picture PDF) | "This PDF is a scan" (it is an image page, not a scan of paper: wording); page pictures → 70 × **101**, 17 classes named "nearest DMC · change", key region left out → new key-in-picture flow above | size off by 4 rows (D18) |
| `xs-tinymodernist-autumn.pdf` | page pictures read started; my driver read the sheet mid-read, so no verdict recorded | not judged |
| `xs-wocs-robin.pdf` (magazine, triple key, backstitch, knots) | key 17 rows incl. backstitch / knot rows, names were symbol soup (D6, fixed); no vector grid, page pictures → 107 × 141 (D19) | key codes yes, names fixed; chart size doubtful |
| `xs-anchor-new-home.pdf` (Anchor-only key) | "I couldn't find a colour key in this PDF" with 72 × 66 / 14 ct read from the text: honest, nothing read | key not read (engine) |
| `xs-fqs-celebration-sampler.pdf` (138 × 172 over 5 pages, AuriFloss key) | no key found (AuriFloss); "each page holds part of the design" → Join → D4 then D5 (both fixed in the UI) | join wrong (engine), now said |
| `xs-fqs-current-mood.pdf` (picture-only) | "This PDF is a scan…", page pictures read started; not judged | — |

Silent / slow: page rendering after a PDF import runs ~5 s a page while the pane is hidden (pdf.js), so
Pac-Man's 22 pages took ~2 minutes with the import sheet open and "Rendering page N of 22…": not silent,
but a long wait the sheet does not estimate.

## Verdicts per proposal (02-cross-stitch #1..#21, 04 X1..X5, R1, R2, R5)
| # | verdict | evidence |
|---|---|---|
| 1 honesty | **meets the bar** (now) | one total everywhere (bar, Stitch mode ALL, floss), "counted from the key", pctText, distinct families on import, ≈ skeins, bulk confirm, 10×10 colour-scoped; Re-letter and the photo confirm added (app 15) |
| 2 stitch mode | **meets the bar on size, rough on keys** | 100 % canvas / ≈ 75 % free rectangle; Space / pedal / arrows / H F + − N J, Undo, remembered (app 3). The proposal's "arrows one stitch, Shift+arrows one block" is not what the shell's pedal map does (arrows = mark / take back); landscape not looked at |
| 3 parking | **works but rough** | sheet, assistant, corner triangles, park / unpark (app 7); long-press on a stitch not built |
| 4 pages | **meets the bar** | outlines + labels, "Mark page done" asks, marks + flag in one undo (app 6), Pac-Man p9 region exact |
| 5 sessions / pace | **meets the bar** | extras pace sheet (looked; extras tests), ≈ finish after 5 sessions |
| 6 symbol-font charts | **not built** | xs-app: `gridFromGlyphs` not wired |
| 7 key picture (R1) | **works but rough** | potatoes 6 / 6 codes, never a wrong code; 3 / 6 counts missing and not said per row (D17); Satsuma 7 / 7 codes right but the found box missed 7 rows |
| 8 busy page (R2) | **works but rough** | "left out: text, colour key" is right on Satsuma; size 70 × 101 vs 70 × 97 not flagged (D18) |
| 9 / R5 designer's symbols | **meets the bar** on Pac-Man (10 / 10 clean glyphs); not seen on wocs (no vector grid) |
| 10 backstitch from a PDF | **not seen working** | no fixture gave vector backstitch to the grid reader in this pass |
| 11 tiles | **wrong (engine), honest (UI)** | first real file: cover page sank it (fixed), then 178 × 238 for 138 × 172 (now demoted and said) |
| 12 / X1 stitched piece | **meets the bar** | looks like stitched fabric in WebGL and in the 2D fallback, three themes; the count now visible (D1) |
| 13 islands | **meets the bar** | "island 1/N · next ≈ … cm" (app 9); 🎯 still stitch by stitch |
| 14 row by row | **meets the bar** | scope, done runs, Row done recorded once (app 10) |
| 15 stash / kit | **meets the bar** | after D8 |
| 16 brands | **works but rough** | DMC only by design (owner decision pending) |
| 17 fabric calculator | **meets the bar** | extras sheet looked at |
| 18 join files / big charts | **works but rough** | join UI exists; cells still in localStorage (Pokémon not applied) |
| 19 print what's left | **meets the bar** | extras sheet looked at (the printed page itself not opened headless) |
| 20 kind switch | **meets the bar** | "What are you making?" → Diamond painting → caption DRILLS (app 11) |
| 21 find my place | **meets the bar** | keypad, plain errors, lands the crosshair (app 8) |
| X2 loupe | **meets the bar** | 224 × 288: loupe on the next stitch, minimap, number readable over it |
| X3 time-lapse | **works but rough** | honest "not your real order"; the picture is soft (3 px a stitch at phone size) |
| X4 framed / share | **meets the bar** | hoop picture in Share a picture and Framed picture |
| X5 backstitch / knots drawn | **meets the bar** (drawn on synthetic layers in the gallery) |

Headline: **15 meet the bar, 9 work but rough, 1 wrong (tiles, engine side, now honest), 2 not built / not seen (#6, #10).**

## Measured
- Stitch mode: canvas 100 % of 375 × 812 and of 375 × 640; free rectangle ≈ 75 % at 812.
- Tap on a 64,512-stitch chart: headless synthetic median 2.9–4.4 ms, worst 3.9–9.2 ms (four runs);
  Pac-Man in the hidden pane median 9.6 ms, worst 16.2 ms (background tab, so throttled; the earlier
  4.9 ms was a visible pane).
- Pac-Man grid read 2.0 s; Pokémon-tl 11.1 s; potatoes picture read ≈ 8 s from the drop to the review; key
  picture ≈ 4 s.

## For the owner of `js/xstitch.js` (xs-core)
- `normalize`: `keyCount: 0` becomes 1 (D21). Paste:
  `var kc = raw.keyCount > 0 ? clampInt(raw.keyCount, 1, 1e9, 0) : 0;` in place of
  `var kc = clampInt(raw.keyCount, 1, 1e9, 0);` (about line 1793).
- `parseKey` on `xs-wocs-robin.pdf`: names "Zlnn9999MM", "3Zlllnn9MMM", "9933399999MMM", backstitch
  "fZZyYiiii", "99ffyyYiiii", knot "YYiiiiQQQZnnnn nn" (the chart's symbol run). The app now replaces
  them, but the parser should not produce them.
- `kitList` / `flossNeeds` row `code` is the lower-case lookup key ("b5200"); the extras sheet now maps
  it back, but a `printed` code on the row would save every caller the lookup.
- **Fixture assertions for `test/xstitch.fixtures.html`** (key FIXTURES list; `eq`, `codesOf`, `byKind`
  are the page's own helpers):
```js
  { name: 'xs-wocs-robin', label: 'WOCS robin: DMC / Anchor / Madeira key, backstitch, knots',
    check: function (n, k) {
      eq(k.entries.filter(function (e) { return /\d/.test(e.name || ''); }).map(function (e) { return e.code; }), [],
        n + ': no colour name holds a digit (the chart symbols are not names)');
      eq(byKind(k, 'back').length, 2, n + ': two backstitch rows');
      eq(byKind(k, 'knot').length, 1, n + ': one French-knot row');
      eq(k.entries.length, 17, n + ': seventeen key rows');
    } },
  { name: 'xs-fqs-celebration-sampler', label: 'FQS sampler over 5 pages, AuriFloss key', noKey: true,
    check: function (n, k) {
      eq([k.design.w, k.design.h], [138, 172], n + ': the stated design size');
      eq([k.fabric.count, k.fabric.over], [32, 2], n + ': 32-count linen over two');
    } },
  { name: 'xs-anchor-new-home', label: 'Anchor-only key (4-digit numbers in a column)',
    check: function (n, k) {
      eq([k.design.w, k.design.h], [72, 66], n + ': the stated design size');
      /* KNOWN today: "no colour key found"; the key is a column of Anchor numbers with no symbols */
      log(k.entries.length > 0 && k.entries.every(function (e) { return e.brand === 'Anchor' && /^\d{1,4}$/.test(e.code); }),
        n + ': Anchor rows read (KNOWN: none today)');
    } },
```

## For the owner of `js/xstitch-read.js` (xs-read)
- `readTiles` on `xs-fqs-celebration-sampler.pdf` pages 2–5: 2 × 2 edge to edge = **178 × 238** for a
  stated 138 × 172 (each page's read box probably includes the overlap / an empty gridded margin). With
  `opts.size` given, a layout that misses it should be `ok:false` or carry `sizeOff`.
- `read` on Satsuma stay-home colour (page 1, whole page): **70 × 101** for 70 × 97, `sizeVerdict` not
  doubtful. On robin page 1: 107 × 141 squares, 1,103 stitches (fixture note: 40 × 79).
- The no-key summary "The key gives no stitch counts to check them against." is shown when there is no
  key at all; "No colour key to check them against." would be right.

## For the owner of `js/xstitch-keyread.js` (xs-keyread)
- Potatoes key picture: counts read for 745 / 842 / 3032 only; 04 (100), 310 (1,839), 3827 (1,184) come
  back with no count, and the row does not say it ("read from the picture" on all six). A per-row
  `countStatus: 'none' | 'read'` would let the sheet say "no count read" on those rows.

## For the owner of `js/checksheet.js` (shell-ui)
- `fromXStitch` note: "1 colour on the chart match no key row" → "matches".
- The PDF import says "This PDF is a scan" for born-digital picture PDFs (Satsuma, Tiny Modernist):
  "This PDF's pages are pictures" is true of both.

## What a real phone test still needs to check
- The stitched renderer's frame time and the tap cost on a mid phone (only desktop / headless here).
- Stitch mode under the HUD with a thumb: panning a zoomed chart under the floating panels, and the
  safe-area insets on a notched phone (env() values are 0 headless).
- Landscape Stitch mode (not looked at).
- Page rendering speed after a big PDF import with the screen on.
- The photo-replaces-key confirm, driven through the photo converter.

## Final run (2026-11-13, all headless, all green)
xstitch.test 1120 / 0 · xstitch-extras.test 115 / 0 · xstitch-render.test 62 / 0 · crafts.test 283 / 0 ·
workmode.test 111 / 0 · checksheet.test 58 / 0 · **xstitch-app.test 241 / 0** · xstitch.fixtures 582 / 0
(9 skipped) · xstitch-read.test 292 / 0.
