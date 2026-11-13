# Wave K report: sew-extras

Owner of `js/app-sewing-extras.js` (`window.SewingExtras`, replaces the coordinator placeholder),
`css/sewing-extras.css`, NEW `test/sewing-extras.test.html`. Contract as built:
`docs/wave-k/api/sew-extras.md` (exact). sew-app already lists my items in ⋯ (checked in the real
app: "Cutting board … Words in this pattern" after its own items) and repaints on my
`sewingextras:change` event.

## Suites
| Suite | Baseline | Now |
|---|---|---|
| `test/sewing-extras.test.html` (new) | — | **121 / 0** (headless) |
| `test/sewing.test.html` | 1143 / 0 | 1143 / 0 (I change no sewing.js behaviour) |
| `test/sew-visual.test.html` | 161 / 3 (sew-visual mid-edit then) | 168 / 0 |
| `test/sw.test.html` | — | 59 / 0 (my files are wired in index.html and sw.js already) |

The test page builds five synthetic projects in code (a strip quilt, a quilt whose rows are listed
in words, a bag with two interfacing products, two makes of one dress), uses
`Store.__setKeyForTests('stitchkeeper-wavek-sewextras')`, never touches IndexedDB (headless-safe),
and deletes its projects and key at the end. `?demo=<id>&theme=<theme>&frame=375x812` leaves one
sheet open for a screenshot (headless Chrome will not make a window narrower than 500 px, so
`frame` puts the page in an iframe of the exact size).

## What the user sees, sheet by sheet (all from ⋯ on a sewing project)
| # | Sheet (id) | State | What it shows |
|---|---|---|---|
| P6 / S5 / P7 | Cutting board (`board`) | **done** | "12 of 32 pieces cut · 1 of 3 strips cut" (strips apart from finished cuts). Groups by fabric (Fabric A…, main, lining) then one group per interfacing **product** with how it goes on ("Fusible: iron it on…", "Sew-in: no iron. Stitch it…", or "the pattern does not say"), and where the product name came from. Each row: − / "n of q cut" (tap = one more) / "All" for big rows; mirrored pair, on the fold. Subcuts sit under their strip; each strip carries sew-core's check shown honestly: ≠ "Comes up short. 2 strips × 11 … = 22; the pattern needs 24 …", ≈ "Only just fits", ✓ "Adds up", ? "Not checked", each "(≈ worked out by the app at 40" usable)". A usable-width field (kept as `fabricPrefs.wof`) re-runs the checks. "Fuse before you sew" card quotes the pattern's own sentence with its pieces and page. "By piece" view ("Main Panel · cut 2 Exterior · 2 Lining · 2 Shape-flex SF101 (fusible)"). Inches / Centimetres switch (pattern's unit marked; cm shown ≈). "Drawn to scale" (SewQuilt.mountBoard, mounted only when opened; taps count cuts). Ticks feed `Store.counted` (unit `cut`) and `Sewing.milestones` ("Everything is cut ✂️"). |
| P11 / S2 | Quilt top (`quilttop`) | **done, honest fallbacks** | Units made / total. If sew-app ever offers `SewingApp.quiltModel(id)` → SewQuilt.mount with real block progress. Else rows listed in words (Catwalk-style "Row 1: B (3¼"), L, …") are drawn as an SVG of fabric letters, cells sized from the text, rows lighting in order, saying "≈ the pattern does not say which step makes which row". Else, with the layout page kept on the device, the page picture via SewQuilt picture mode ("fills in as a whole"). Else it says plainly where the layout picture is and that it does not draw a guess. Block labels listed with their unit's progress. |
| P8 + P9 | Quilt calculators (`quiltcalc`) | **done** | Finished size prefilled from the pattern (with page). Binding, backing, batting, HST (2/4/8) + QST, flying geese (1/4), resize; every result ≈ with its formula and "worked out by the app" (sew-core's formulas are not yet checked against two published calculators). Printed figures compared: ✓ matches / ≈ "Close, not exact. The pattern prints 190"; the app works out 192"" / ≠. Inputs take inches or cm ("101.6 cm"). "Measure your units": printed unfinished size, a "what yours measures" box (✓ right, ≈ within 1/8", ≠ "Off by 1/4". Check your seam allowance" / "Trim it"), and "Measured right ✓" kept on the unit. |
| P13 | Fabric and shopping list (`fabric`) | **done** | For the chosen size: my width (cm/in), shrinkage %, nap switch, view, unit switch, all kept in `fabricPrefs`. Lines from `fabricNeed`: the printed width used, never interpolated ("narrower than every width": measure); shrinkage "≈ … (worked out by the app)"; nap only when printed, else a sentence. Shopping list v2 with "already have" ticks on notions, Copy (clipboard, textarea fallback) and Share (Web Share when present). "All my sewing projects" merges every active sewing project's list ("Thread to match (×5)" with the project names). |
| P12 / S1 | Fabric colours (`swatches`) | **partly** | Per fabric row: the booklet's own swatch image when one is stored at `p:<id>:swatch:<i>` (sew-visual's capture), else a colour chip the sewist sets (colour picker, Clear). Colours flow into the cutting board chips, the to-scale drawing and the rows quilt top. Not done: capturing swatches after import needs the PDF (PageInfo); sew-app does not offer `captureSwatches(id)` (I show a button when it does). |
| P16 | Timer (`timer`) | **done** | The step's own wording ("Step 3 says to fuse"); no default time ("–:––", Start disabled) until the sewist types theirs (kept as `fabricPrefs.fuseSeconds`); Start / Pause / Reset, Date-based countdown, "Time is up" (vibrate + shell feedback), says it only counts while the screen is on, offers the shell's Keep awake. |
| P16 | Glossary (`glossary`) | **done** | "From the booklet" (its own symbol key, with page) first, then "Used in this pattern" with counts and the app's own short meanings (said so); a search box. |
| P17 | Fitting log (`fitting`) | **done** | One line per change (where · amount ± cm/in · piece · why/note · date), optional photo per entry (scaled to 1280 px JPEG, BlobStore `p:<id>:fit:<alterationId>`, so backups carry it), remove (one undo step). "Use n changes from “<other make of the same pattern>”" via `carryAlterations` (marked "from last time"). |

## Verified
- Headless suite at every step (121 / 0). Real app (one Browser-pane tab, closed): the board opens
  in the shell's own sheet (`sheet sheet-sewing swx-sheet`), focus moves in, a cut tap keeps focus
  on its chip, Escape closes; sew-app's ⋯ menu lists my 7 items for a quilt; every sheet opens;
  a fitting photo was stored in BlobStore as JPEG and shown (then deleted with the project).
  **Bug found there and fixed**: the shell's `ctx.wake.supported` is a boolean, not a function,
  so the timer threw in the real app; now handled and asserted.
- Screenshots at 375 × 812 / 375 × 640 (iframe-exact): board (Stardrop Night, Pelican Town Spring
  bag), quilt top rows (Pixel Wyrm), calculators (Stardrop Night, 640), fabric (Spring), timer
  (Pixel Wyrm, 640), fitting (Stardrop Night); desktop in the real app (fitting). First pass
  overflowed the sheet at 375 px (two segmented controls side by side, verdict box squeezed by the
  counter) and a missing arrow glyph; fixed (controls stack on phones, verdicts span the row).

## Left, and why
- P11 block-by-block reveal needs a QuiltModel, which only exists while the PDF is open; sew-app
  keeps none (its API says so), so the picture mode and text-rows mode are what users get.
- P12 swatch capture after import (same reason). Colour chips are the honest fallback.
- A removed fitting entry keeps its photo blob (so Undo brings the photo back); the boot sweep only
  removes blobs of deleted projects.

## For the owner of `js/sewing.js` (sew-core)
- Please keep `craftData.swatchColours = { [fabricIndex]: '#rrggbb' }` in `normalize`. Until it
  does, colours live in `Store.craftSettings('sewing').extrasSwatches[projectId]` (probed at run
  time; it switches by itself once normalize keeps the field).
- `quilt.binding().yards` comes back as e.g. 0.375; I show it as "3/8 yd".

## For the owner of `js/app-sewing.js` (sew-app)
- Optional: `SewingApp.quiltModel(id)` (e.g. build `SewQuilt.findLayout` at import and keep the
  model + page key) and `SewingApp.captureSwatches(id)` light up P11's per-block reveal and P12's
  booklet swatches with no change on my side.
- I call `SewingApp.repaint(id)` and also fire `sewingextras:change`; you repaint on both (harmless,
  but one of them is enough).

## Decisions for the coordinator
- None blocking. The "≈ worked out by the app" label is on every computed figure, including the
  strip checks, as sew-core asked.
