# Wave K report: sew-audit

Owner (after batch 2) of `js/app-sewing.js`, `css/sewing.css`, `js/app-sewing-extras.js`,
`css/sewing-extras.css`, `test/sewing-extras.test.html`, and NEW `test/sewing-app.test.html`,
`test/sewing.gallery.html`. Status: DONE for this pass (2026-11-13).

## Suites (headless, `bash tools/headless-suite.sh …`)
| Suite | Baseline (before my first edit) | Now |
|---|---|---|
| sewing.test | timed out (sew-core was saving `js/sewing.js`), then 1173 / 2 mid-edit | 1197 / 0 (sew-core's fixes landing; one transient red mid-save) |
| sewing-extras.test | 74 / 26 (same save), then 121 / 0 | **124 / 0** |
| sew-visual.test | 168 / 0 | 171 / 0 |
| crafts.test | 239 / 0 | 283 / 0 (shell-ui's additions) |
| workmode.test | 101 / 0 | 111 / 0 (shell-ui's additions) |
| checksheet.test | 58 / 0 | 58 / 0 |
| templates.test, sw.test | — | 159 / 0, 59 / 0 |
| **sewing-app.test (new)** | — | **171 / 0** (~20 s, real-time runner) |

`test/sewing-app.test.html` loads the real `index.html` in a 375 × 812 frame on its own key
(`stitchkeeper-wavek-sewapp-test`), builds synthetic projects in code (a garment imported by
paste, a chart with doubtful cells, a chart with body + finished rows, a bag, a quilt with units,
lettered units, figure refs, a nap booklet) and drives `SewingApp.__test` plus the real DOM:
import + check line, size advisor through the sheet (typed measurements → suggestion → Use 42 →
resolved numbers, ≈ conversion, "?" cells), the step card (chips, "Size 42 · …up the hem by 56 cm",
fold), Sewing mode (Space / ← / PageDown / Undo / remembered / Escape / 44 px buttons / whole step
text / buttons inside 375 px), edits + notes surviving a re-import, an "off" check demoting Import
behind a confirm, units on the big button (strip, −1, Step done above the button at 812 **and 640**),
kind chrome, the ⋯ menu with every extra opening and closing with focus back on ⋯, `step.fig`,
nap notes, swatch colours in craftData, unit-first seam allowances, the name guard, milestones.
It writes no page images (IndexedDB is only touched by the shell's own boot) and finishes in the
real-time runner. `test/sewing.gallery.html` is the review page (below).

## Verdicts per proposal (the bar is `docs/wave-k/brainstorm/03-sewing.md` / `04-visual…`)
| # | Verdict | Evidence |
|---|---|---|
| P1 step figure | **works but rough** | Sundress: 5 of 15 cards get a crop, the rest open the framed page. The step-1 crop on p6 holds **other steps' paragraphs and drawings** (it is a column chunk, not "just this step's drawings"): sew-visual's linker, see "For the owner". Was hidden by a too-small text box; now the text and figure sit side by side with "Show the whole step". Reads `step.fig` now. |
| P2 Sewing mode | **meets the bar (after fixes)** | Was cutting every step to **3 lines** (sundress step 1: "Sewing the Bodice: With right sides together align side…"), the seam allowance in inches first on a metric booklet, a tip that broke "‹ / › move" over two lines, and "Next" off the screen in Pixel Wyrm with a unit. All fixed and asserted. |
| P3 size advisor | **meets the bar** | Synthetic 97/79/104 → "Size 42, with 44 at the hip" with the designer's rule and its "only slightly different" rule quoted; Use 42 is one undo step; bathers 92/76/102 → M, 9 per-size items, 0 unresolved, ease −15 cm shown. Fixed: the chart table was **empty on first open** for any chart with body and finished rows (bathers, every Peppermint chart); resolved body / finished numbers were **unit-less** ("104"). |
| P4 transposed / dual charts | **meets the bar** (engine) | Bathers 13 sizes × 6 rows, check "exact"; a cm/in disagreement shows "… ?" with "not certain" for a screen reader. |
| P5 pattern sheets | **works but rough** | Margo A4: tiles 3 × 5 and 10 size layers right; but "3 pieces read" with one row merging two pieces ("Armhole Binding 2 × main + 1 on the fold …"), the test-square quote is a fragment ("…scale, so you will have to adjust the scale to a little larger."), and the print notes are broken lines. Engine (readSheet). |
| P6 cutting board | **works but rough → fixed one wrong count** | Mabel: products and fusible / sew-in right. Shannon robe: "Robe Front" listed three times (1, 2, 1) with **no way to tell "Curvy size only"** apart, so the board read as 4 robe fronts to cut. Row notes now shown (asserted). The board total still counts both alternatives (engine/data: no "one of these" model). |
| P7 strip maths | **meets the bar** | Checks with both numbers and "≈ worked out by the app". The note repeats "at 40" usable" twice (polish, open). |
| P8 calculators | **meets the bar** | Prefilled, ≈ with formula. |
| P9 finished / unit sizes | **meets the bar** | Quilt row "Finished 60" × 72"", unit size on the button hint (now not in capitals, so 6 1/2" x 12 1/2" reads right). |
| P10 / S3 units in their step | **meets the bar (after fixes)** | Was: Step done link at y 812–856 (below the fold) on Harmony, button under the bottom bar, units wrapping to 3 rows in Pixel Wyrm. Now: "✓ Step done" sits in the unit strip above the button, the strip is one line (chips scroll), the unit button is shorter; Harmony step 3 button 559–713 with the bar at 750 (812), synthetic 434–562 with the bar at 578 (640). |
| P11 / S2 quilt top | **works but rough** | Rows-in-words and the honest "does not draw a guess" both work in real time. Harmony keeps a vector model (sew-app). Not drawn block by block on any real quilt I imported. |
| P12 / S1 swatches | **works but rough** | Colour chips now live in `craftData.swatchColours` (asserted). Booklet swatches only while the PDF is in this session. |
| P13 fabric / shopping v2 | **works but rough** | Honest "no fabric amounts the app could read" for Albion. Two unit controls on one sheet (width-unit select and the inches / cm switch); now the one fabric sheet in ⋯, with the rows as printed, the nap sentences and "What I actually used". |
| P14 kind + name | **wrong → partly fixed** | Moda Charm Monday was renamed **"Binding 5/8 yard"** (the engine's `projectName`); now refused by the app (amounts and requirement headings are never names, asserted). Still wrong in the engine: BSB block 5 → "Paper", BSB block 4 → "Bella", Colette A0 → "Size Table" (the app now refuses "Size …"), and kinds: Moda Quick Sew **Bag reads as a quilt**, BSB block 4 (a quilt block) as a garment. A bag's review no longer lists "Sizes: none found", a garment's no "Block counters". |
| P15 set-up chips | **meets the bar** | SA in the pattern's own unit first everywhere (metric "1 cm (3/8")", Mabel "1/2" (1.3 cm)"), trims, press / fuse → timer, nap chip. |
| P16 timer + glossary | **meets the bar** | No invented time; booklet symbols first. |
| P17 fitting log | **meets the bar** | Form labels wrap to 3 lines at 375 (polish). |
| P18 OCR | **meets the bar (offer only)** | Westend: "Mostly pictures of text: 14 of 17 pages", Import demoted, the 5 MB offer shown, never downloaded by me. |
| P19 milestones | **meets the bar** | Asserted. |
| S4 figure in the button | **not built** (decided, see Decisions) | The crop already sits beside the step text above the button. |
| S5 to-scale board | **meets the bar** | Drawn on open. |
| Gap 7 edits / notes | **meets the bar** | Survive a re-import (asserted). The tools hid behind a **✂** glyph; now ✎. |
| Gap 8 what was missed | **works but rough** | Demotes and asks. Shannon robe's line reads "steps 2, 3, 4, 5 and 1 missing (page 2)" for a booklet whose numbering restarts per section (76 cards): an engine false alarm in the wording. |

## Defects found
| # | Where | What | State |
|---|---|---|---|
| 1 | size sheet | Chart table empty on first open when a chart has body and finished rows (`which` set after `openSheet` ran `build`) | **fixed**, asserted |
| 2 | step card | Long step = 148 px window on 641 px of text, `tabindex -1`, no cue | **fixed**: 6 lines (7 beside a figure, 5 on a unit step, fewer at 640) + "Show the whole step ▾ / Show less", asserted |
| 3 | Sewing mode | Step text clamped to 3 lines | **fixed** (`cls: 'sw-work'`, own scroll box up to 33vh, figure keeps the rest), asserted |
| 4 | unit step | Step done link below the fold; button under the bottom bar; strip 3 rows in Pixel | **fixed**, asserted at 812 and 640 |
| 5 | Sewing mode | "Next" off the right edge in Pixel Wyrm with −1 shown | **fixed** (words hidden when four buttons on ≤ 420 px; labels stay), asserted |
| 6 | everywhere | Seam allowance cm-first on inch patterns and inches-only in Sewing mode on metric ones | **fixed**, asserted |
| 7 | size sheet | Resolved body / finished numbers without a unit | **fixed**, asserted |
| 8 | step card / mode | "Size 42 · up the hem by 56 cm" read as an instruction | **fixed**: "…up the hem by 56 cm", asserted |
| 9 | import | Project renamed "Binding 5/8 yard" | **fixed in the app** (guard), engine note below |
| 10 | import review | "1. style", "Step N style", "1) style" jargon; bag "Sizes: none found"; toast "Imported 11 steps" while the screen says 8 | **fixed** (printed steps on N cards; kind-aware rows; toast counts printed steps) |
| 11 | cutting board | Alternative rows ("Curvy size only") indistinguishable | **fixed** (row notes shown), asserted in sewing-extras.test |
| 12 | extras | "Centimetr / es" broken mid-word in Pixel | **fixed** ("cm"), asserted |
| 13 | step screen | Grey strip of "Main… Main…" labels on every step | **fixed**: only on a cutting step; tour step moved to the Cutting row; asserted |
| 14 | step list | Edit / note / split behind "✂" | **fixed** (✎, FAQ updated) |
| 15 | step.fig | Coordinator: switch from `imageRef` | **done**, capture writes `step.fig`, old values read; asserted |
| 16 | size sheet | `slightlyText` | **done**, quoted on its own line; asserted |
| 17 | cutting / fabric | `napNotes` | **done**: "↕ Nap direction · the pattern says" with page chips; Shannon robe 4 sentences; asserted |
| 18 | Sewing mode | Tapping the step text no longer counts (it is now a scroll box) | decided: fine; the tips now say "Tap here when the step is done" (asserted) |
| 19 | sundress | P1 crop holds other steps' text | **open** (sew-visual) |
| 20 | Albion | "1 step was very long and got shortened" — text dropped from a card | **open** (engine) |
| 21 | menu | "Fabric" and "Fabric and shopping list" both in ⋯ | **fixed**: one item, the old sheet's rows / nap / "What I actually used" moved in first (asserted) |
| 22 | board | "at 40" usable" twice in one strip check | open (polish) |
| 23 | Pixel Wyrm | unit chips get ~60 px beside −1 and Step done (they scroll) | open (acceptable) |

## What I looked at
- **Gallery** (`test/sewing.gallery.html?card=<id>&theme=<t>&h=812|640`; index without `card`):
  22 cards (step, step-fig, step-unit, step-unit-fig, work, work-unit, size, size-chart, import,
  steps, cutting, notions, menu, bag, and the eight extras). Shot headless at 500 × h (the iframe
  is exactly 375 × h) in **Stardrop Night 812 and 640, Pixel Wyrm 812 (+ 640 for three), Pelican
  Town Spring 812 (+ 640 for three)**, three rounds (before fixes, after, after the 640 pass), every
  PNG read by me. Headless `--virtual-time-budget` never answers IndexedDB, so the two figure
  cards and the quilt-top picture only render in a real tab; I checked those in the Browser pane
  (step-unit-fig at 812 and 640, x-quilttop in Spring). The gallery sweeps keys / stand-in blobs
  left by earlier cards.
- **Real patterns in one pane tab** (private key, rAF shimmed in the tab), through the import
  sheet's own drop zone: sundress (pages + figures), bathers (pages, size advisor M), Mabel,
  Harmony (pages, unit step at 812), Moda Charm Monday, Westend (not imported: nothing to import),
  Albion, Shannon Cuddle Robe, Tiana's Margo A4 through ⋯ → Add the pattern sheets. Measured: text
  ready in 0.6 s (sundress) – 9 s (Albion); sundress import with 9 pages 10.4 s; Harmony with 17
  pages ≈ 45 s. Cleaned up: 9 projects, their `p:<id>:` blobs, both keys; tabs closed.
- **Engine probes** of Shannon wrap, cozy tote, quick-sew bag, BSB 4 / 5, cfac-love, Colette A0.

## For the owner of `js/sewing.js` (sew-core)
1. **FIXED by sew-core on 2026-11-13** (now asserted in sewing-app.test: the rule at the top of page
   2 is dated page 2). Original note: **`sizeRule` dated a rule that opens a page to the page before** (and so dropped its
   "slightly different" companion, because `slightly.page === hit.page` fails): the sentence page
   is found with `at[a].end >= m.index`, and `m.index` is the space after the previous page's last
   full stop. Effect: such a booklet suggests the larger size where the designer says "closest"
   (synthetic 97/79/104 → 44, not 42) and the page chip points one page early. Fix (~line 5212):
   ```js
   while ((m = re.exec(joined))) {
     var start = m.index + (m[0].length - m[0].replace(/^\s+/, '').length);
     var pg = 1;
     for (var a = 0; a < at.length; a++) { if (at[a].end > start) { pg = at[a].page; break; } }
   ```
   Test: `sizeRule('=== PAGE 1 ===\nIntro.\n=== PAGE 2 ===\nIf you are between sizes, choose the larger size. If your measurements are only slightly different, choose the closest size.\n')`
   → `{ page: 2, slightly: true }` (today `page: 1, slightly: false`; logged as KNOWN in sewing-app.test).
2. **"SIZE CHART (cm)" is reported "prints no unit; read as cm from their size"** (importCheck row
   "Size chart · Unit"); the heading states it.
3. **`projectName` returns non-names**: Charm Monday "Binding 5/8 yard", BSB block 5 "Paper",
   BSB block 4 "Bella", Colette A0 "Size Table". The app now refuses amounts and requirement
   headings (`patternNameOf`), but "Paper" / "Bella" get through.
4. **Kinds**: Moda Quick Sew Bag → `quilt` (its fabric lines "Bag & Straps: one yard", "Lining: 3/4
   yard" land in notions); BSB block 4 (a flying-geese block) → `garment`.
5. The interleave warning reads "(1 columns detected)" on a one-column file (Charm Monday's review).
6. Albion: "1 step was very long and got shortened" — please carry the rest to a "(continued)" card
   as the sundress does; a shortened step loses instructions.
7. importCheck on section-restarting booklets (Shannon robe: "steps 2, 3, 4, 5 and 1 missing").
8. Alternatives in the cutting list ("Curvy size only", Albion's long / short cuffs) are counted
   in `cutTotals` as if both were cut: an `alt` group or `onlyFor` on the row would let the board
   count one.

Paste-ready additions to `test/sewing.fixtures.html` (inside `waveK()`, after the Westend block;
each states what the booklet says, and fails today where marked):
```js
  on('sew-moda-charm-monday', 'the pattern\'s name is not a fabric line (P14)', function (got, t) {
    var n = S.projectName(S.parse(got.text), 'sew-moda-charm-monday.pdf');
    t(!/\d\s*\/?\s*\d*\s*(yard|yd)/i.test(n), 'the name is not an amount (today "' + n + '")');   // fails today
  });
  on('sew-moda-quick-sew-bag', 'a bag reads as a bag (P14)', function (got, t) {
    var p = S.parse(got.text);
    t(p.kind === 'bag', 'kind bag (today ' + p.kind + ')');                                     // fails today
    t(!p.notions.some(function (n) { return /:\s*(one yard|\d.*yard)/i.test(n.text); }), 'fabric amounts are not notions');  // fails today
  });
  on('sew-fqs-bsb-block4-flying-geese', 'a quilt block reads as a quilt (P14)', function (got, t) {
    t(S.parse(got.text).kind === 'quilt', 'kind quilt');                                          // fails today
  });
  on('sew-shannon-cozy-tote', 'bag with nap (P13, P14)', function (got, t) {
    var p = S.parse(got.text);
    t(p.kind === 'bag' && p.fabric.length === 2, 'a bag with its exterior and lining yardage');
    t(S.napNotes(p.sourceText).length >= 1, 'its nap sentence is quoted');
  });
  on('sew-moda-cfac-love', 'a picture-only block sheet says so (gap 8)', function (got, t) {
    var c = S.importCheck(S.parse(got.text), { emptyPages: got.emptyPages });
    t(c.verdict === 'off' && /pictures of text/.test(c.summary), 'pictures of text, said plainly');
  });
```
(The cozy-tote and cfac-love lines pass today; the others are the defects above.)

## For the owner of `js/sew-figures.js` (sew-visual)
- Sundress p6, step 1 ("Sewing the Bodice"): the `figure` crop (confidence 0.95) contains the
  drawings **and paragraphs of the next two steps** ("Press all seams open…", "With right sides
  together stitch the right side seam…"). A crop should stop at the next step's first line in its
  column (P1's own proof: "each band contains the step's first line and not the next step's").

## For the owner of `js/blobstore.js` (shell-data)
- `put` checks `instanceof Blob` in its own window, so a Blob made in a parent page (a test or
  gallery driving the app in an iframe) is silently refused (`false`). Not a user path; tests must
  rewrap in the frame's `Blob`. A duck-type check (`typeof v.arrayBuffer === 'function' && typeof v.size === 'number'`) would avoid the trap.

## For the owner of `index.html` / `sw.js` (shell-ui)
- Nothing new: no new runtime file.

## Decisions for the coordinator
Decided by the coordinator (2026-11-13) and done:
- **Tapping the step text in Sewing mode does not count** (it scrolls). The first tip (`spec.tip`)
  and the readout tip now say "Tap here when the step is done" (shown on the coloured space);
  the FAQ and tour say "the coloured space (not the text) or Next". Asserted: no "anywhere".
- **One fabric sheet**: ⋯ lists only "Fabric and shopping list". What only the old sheet showed is
  in it first: every row as printed (all sizes, Samford-style size groups, unread lines) in a closed
  "As the pattern prints it" group, the nap sentences, and "What I actually used" (still saved to
  the project notes) — `SewingApp.fabricOwnParts(node, id)` → `fabricOwnParts(…, {embedded})`.
  `SewingApp.openSheet('fabric')` opens it; the old sheet is only the fallback when the extras file
  is missing. Asserted (one fabric item, the rows, the notes field, the message said once).
- **`:has()` is not relied on**: Sewing mode's readout sets `.sw-work-four` on the HUD when −1 is
  shown, and the words drop by that class (the `:has()` rule stays as a second route). Asserted.
- **S4 (the step's picture in the big button): not built.** It would be small with `step.fig`, but
  the same crop already sits beside the step text one row above the button (and fills Sewing
  mode's free area), so it would show the drawing twice on one screen and put a busy white crop
  under the "STEP DONE ✓" label, whose contrast is checked per theme only against a flat colour.
- **The cutting bar shows only on cutting steps** (my call; it was on every step, truncated labels).

## What a real phone test still needs
- Touch: "Show the whole step" and the step text scroll in Sewing mode on iOS Safari (the HUD is
  `pointer-events: none`; only the text box takes touches), sideways scroll of the unit chips.
- A Bluetooth page-turner pedal (PageDown / arrows) on a real device.
- The bottom safe area on a notched phone with the unit step (measured only in emulation).
- The `.sw-work-four` class (narrow screens drop the button words) on a real Pixel Wyrm phone.
- Figure crops on a real phone GPU / memory with 15+ crops.
