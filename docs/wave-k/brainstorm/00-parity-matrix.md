# Wave K brainstorm, lens 00: the parity matrix

Lens: a factual list of what crochet can do, and how far each other craft gets with the same
thing. I read `HANDOFF.md`, `docs/brainstorm/README.md` and its lenses 04, 05, 10 and 11, the wave E,
H and J reports, and the code. On 2026-11-12 I checked the main claims in the running app (wave1
server, own tab, private store key, everything removed afterwards), importing one real fixture
per craft through New project, the same way a user would:
- **crochet**: `bee.pdf`
- **knitting**: `knit-fromtheheart-magicloop-socks.pdf`, size 40 st
- **cross-stitch**: `xs-pacman.pdf`, key first, then "Try to read the grid (beta)", then "Use it"
- **sewing**: `sew-peppermint-apron.pdf`

States: **Y** has it · **P** partial · **N** missing · **n/a** does not apply to the craft.
Knitting shares crochet's counter screen. Where its cell says "shared", the crochet code serves both
crafts (`counterCraft()` app.js:1475, `parserOf()` :1489).

## 1. Parity matrix

### 1.1 Import and parsing
| Capability | Crochet | Knitting | Cross-stitch | Sewing |
|---|---|---|---|---|
| Import a PDF on the device | Y `importPicker` app.js:8016 | Y shared, read with `Knits` | Y `openImportSheet` AX:4092 | Y `openImportSheet` AS:2494 |
| Drop the file into New project | Y (bee: "From this PDF" card) | Y (socks: sections and sizes inline) | Y, but it goes to a second sheet ("Import a chart") | Y, but it goes to a second sheet ("What was found") |
| Paste text | Y "or paste pattern text" | Y shared | n/a for text; pasting a picture works (`imageFromClipboard` AX:5582) | Y "Paste instead" AS:2540 |
| Other sources | n/a | Plain text (4 PG `.txt` fixtures) | Y: OXS, picture of a chart, photo to chart, enter by hand | N |
| Parts / sections from the text | Y (bee: 3 sizes × Body, Wings ×2) | Y, but socks gave "Cuff (continued)" as a part name | n/a: one chart | Y: steps, cutting, notions, SA, sizes, fabric, units (`Sewing.parse` SW:3225) |
| Computed counts from the instructions | Y "10 counts computed ≈" | P: socks part 3 "3 with no count", part 4 "4 with no count"; vector chart rows give null | Y: stitch totals per colour from the grid | n/a; nearest thing is cut-piece totals (`cutTotals`) |
| Per-item confidence or check | Y: ≈ / ≠ / ? why badges, `countWhy` app.js:2274 | Y shared, plus "count unknown" | P: key band "Read the key cleanly"; wave J `checkCounts` only on picture reads; the vector grid path accepts at 80% colour agreement (xstitch.js:6064) | P: per-group "N found" and up to 20 ⚠ lines; no per-item reason |
| Honest "could not read" | Y: empty-pages line, glossary guard | Y: Sandnes lookbook is a negative test | Y: six plain messages (AX:4138…5796) | Y: "scanned images", "No numbered steps found…" |
| Image-only (scanned) pages | N (OCR not built) | N | N for keys (Tiny Modernist, Satsuma); Y for picture charts (wave J) | N (West End jacket; apron pp4–7) |
| Glossary or abbreviations from the pattern | N | Y `craftData.glossary`, ⋯ → 📖 Glossary | n/a | N |

### 1.2 Counting and navigation
| Capability | Crochet | Knitting | Cross-stitch | Sewing |
|---|---|---|---|---|
| Big primary tap | Y stitch button (12 px tolerance) | Y shared | Y `#xs-stitch-btn`, with block counting | Y STEP DONE `#sw-step-btn` |
| Second-level counter | Y row/round +/−, tap the number to set it | Y shared, plus RS/WS chip and short-row strip | Y: colour ‹ ›, 🎯 next stitch of this colour, Row by row | Y: quilt unit cards, cutting chips "N of M cut" |
| Repeats and groups | Y `repeatGroups`, "Group 1 of 6" | Y shared (`Knits.repeatGroups`) | Y: 10×10 block "block x,y · N left here" | n/a |
| Undo / −1 | Y | Y | Y −1 (500-tap history) plus Store undo | Y "↺ back a step" plus Undo |
| Jump to a place | Y go-to-row sheet, pattern sheet | Y shared | Y: crosshair, rulers, position label, 📄 page for this spot | Y `jumpToStep`, steps sheet |
| Placing notes and markers | Y placing notes | Y, plus a marker strip (markers do not move on increase rows) | Y parking notes (a list, not on the chart: 04 #16 open) | P: SA reminder per step; no per-step notes |
| Edit the instructions after import | Y part editor, pattern text | Y shared | Y colour editor, fabric sheet | P: split and merge only; one step's text cannot be edited (none found in AS) |
| Alerts at a stitch | Y 🔔 Alerts | Y shared | N | N |
| Two at a time | N | Y "Sock 1 \| +2" (two parts only) | n/a | n/a |

### 1.3 Sizes
| Capability | Crochet | Knitting | Cross-stitch | Sewing |
|---|---|---|---|---|
| Pick the size once | Y `Project.size`, "ROW · L" | Y (socks: "ROW · 40 st", chips at import) | n/a; fabric count and size table (`sizeTable`) | Y chosen size; fabric card follows it |
| Size groups (several complete versions) | Y bee: Keyring / Medium / Big tabs | Y: ebook patterns as groups, Sandnes halves | n/a | N (Samford "Sizes A–H / I–P" kept as printed) |
| Body measurements and fit | n/a | P: gauge card vs swatch (`Rows: 7% tight`) | n/a | P: "My measurements" and ease rows; no suggestion of a size (05 #12 open) |

### 1.4 Visual model
| Capability | Crochet | Knitting | Cross-stitch | Sewing |
|---|---|---|---|---|
| Live model in the tap button | Y 3D piece (`diagram.js` 1.6.0) | P: knit relief drawn; sock L, raglan and triangles asserted on **synthetic** references only; a sock in parts is never one sock | Y live chart preview (`makeLivePreview` AX:1647) | P: step ring SVG |
| Full-size viewer | Y ⤢ 3D viewer | Y shared | Y Chart sheet, rulers, 10×10 majors | P: cutting-table SVG (`buildCutTable` AS:2387); no piece or garment drawing |
| PDF page images kept | **N** | P: chart pages only (`p:<id>:chartpage:n`, max 12) | Y up to 40 pages, page viewer outlines the stitch | Y opt-in, step pages first, page viewer |
| Chart read cell by cell | n/a (Gosyo symbol charts unread) | P: vector charts read; rows rarely linked (`Line.chart`) | Y vector grid (KG-Chart), picture reader | n/a |
| Printable output | N | N | Y printable chart (`printableHTML`) | P: shopping list text |

### 1.5 Colours and materials
| Capability | Crochet | Knitting | Cross-stitch | Sewing |
|---|---|---|---|---|
| Colours from the pattern | Y yarn key to parts, colour strip, swatch on the row tag | Y shared (`updateYarnLine`) | Y the whole palette, DMC hexes, CIEDE2000 | N: no fabric colour or swatch |
| Amounts and shopping list | N (yarn amounts not read) | N | Y skein ranges, shopping list via `navigator.share` | Y fabric for the chosen size, notions, thread |
| Have-it ticks | N | N | Y floss "have" | Y notions ticks |
| Tool settings | N (hook not structured: 10 #6 open) | P: needle on the gauge card; mm/US/UK setting | Y fabric count, over 2, strands | Y machine settings and presets (none built in: 05 #16) |

### 1.6 Progress, targets and celebration
| Capability | Crochet | Knitting | Cross-stitch | Sewing |
|---|---|---|---|---|
| Targets from the import | Y every bee part got a target (10, 2, 17…) | **P: 3 of 4 sock parts had `targetRows: null`**, so no bar, no part-done and no celebration; the length chip is "never a target" | Y stitch totals per colour | Y step N of M |
| Progress bar and home card | Y "Keyring · Body · not started yet · 3 sizes" | Y shared ("Cuff · not started yet") | Y "0 of 10 colours · 22 chart pages · 0%" | Y "apron · step 1 of 16" |
| Celebrations (`Celebrate.play`) | Y piece / part / project | Y shared | P: colour done (`part`) and chart done (`project`) only (`noteMilestones` AX:1880) | P: every 10th step, a unit done, all cut (`piece`); all steps (`project`) |
| Haptics and sound (`Feedback`) | Y tap / group / row / alert / done / undo | Y shared | Y via `C.fb` | Y via `C.fb` |
| Finish flow (blocking parts, next size) | Y `finishProject(force)`, "Go on to the next size" | Y shared | P: auto-finished at 100% | P: auto-finished when every step is ticked |
| Share card for a finished piece | N | N | N | N |

### 1.7 Guidance
| Capability | Crochet | Knitting | Cross-stitch | Sewing |
|---|---|---|---|---|
| Tours | Y home 4, counter 11, import 6, templates 5; welcome chain on first run | P: one tour of 8 steps; not part of the welcome chain (`startWelcomeTour` :10001) | P: one tour of 6 steps | P: one tour of 7 steps |
| FAQ entries (Settings list) | 7 | 3 | 7 | 8 |
| Empty states in the craft's own words | Y | P: "Nothing on the hook right now"; `IMPORT_EMPTY` shows "Rnd 1: 6 sc in MR"; home blurb is about a sheep | Y "No colours yet…", "No chart yet…" | Y "No steps yet…", "No cutting list yet" |

### 1.8 Working / focus mode
| Capability | Crochet | Knitting | Cross-stitch | Sewing |
|---|---|---|---|---|
| Full-screen working mode | Y ⤢ Work in 3D: big numbers, next-row preview, keyboard, landscape, remembered (`settings.focusProjects`) | Y shared (seen: socks, RS? chip, marker strip, next row) | **N**: the Chart sheet is the nearest (04 #5 open) | **N** |
| Keep the screen awake | Y | Y | P: "☀️ Awake" bypasses `ctx.wake`, no `aria-pressed`, shown even when unsupported | Y `C.wake`, `aria-pressed` |

### 1.9 Data
| Capability | Crochet | Knitting | Cross-stitch | Sewing |
|---|---|---|---|---|
| Undo | Y (50 entries plus a byte cap) | Y | Y `updateCraftData`; view state `{undo:false}` | Y |
| `.thready` backup and one-project file | Y | Y, with chart pages | Y, with chart pages and `readsrc` | Y, with page images |
| Settings restored from a backup | N (known gap) | N | N | N |
| Built-in templates | 3 (sheep: 5 parts, 8 checklist items) | 6, with real pattern text and checklists | 3 (Sampler: 7 checklist items) | 3, each "1 part" with **no checklist and no steps** |
| Save as template / template editor | Y | Y (the Settings "＋ New template" editor always makes a crochet one, :7188) | **N** (⋯ menu has no "Save as template") | **N** |
| Export to another app | n/a | n/a | Y OXS | N |
| Checklist, notes, history, status, timer | Y | Y | Y (shell `craftMenuItems`) | Y (shell) |

### 1.10 Accessibility
| Capability | Crochet | Knitting | Cross-stitch | Sewing |
|---|---|---|---|---|
| Announcement policy (milestones, every 50th) | Y app.js:381 | Y, plus side, short-row and marker lines | P: every **100th** stitch of a colour (AX:1931), against the shared 50 | Y step position, cut and unit counts |
| Keyboard path on the main surface | Y Space/Enter/arrows in working mode, row number | Y shared | **N on the chart canvas** (UX sweep D1); the page viewer and the crop do have keys | Y step button, unit keys |
| Name/role/value on counters | P (07 #5 open) | P | P: canvas `role=img` with a label | Y `role=checkbox`, ring label |
| Per-craft settings section | n/a (global rows) | Y 🧣 Knitting (unit, needles) | **N** (`settingsFields` not registered; saved silently) | **N** |

### 1.11 Test depth and fixtures (HANDOFF test table; `tmp-pdf/` counted 2026-11-12)
| | Crochet | Knitting | Cross-stitch | Sewing |
|---|---|---|---|---|
| Parser assertions | patterns 1112 + fixtures 905 | knits 385 + fixtures 530 (+23 KNOWN) | xstitch 969 + fixtures 512 | sewing 963 + fixtures 789 |
| Other suites | templates 147, diagram 316, diagram-model 529 | knit-counter 317, knit-chart 151, diagram knit block 36 | xstitch-photo 131, xstitch-read 229 | none |
| Real fixtures | 38 PDFs (34 `crochet-*` + bear, bee, cardigan, cato) | 12 PDFs + 4 Gutenberg `.txt` | 34 PDFs + 1 OXS + 2 owner screenshots | 16 PDFs |
| App-level (counter / UI) suite | store-safety, templates | knit-counter 317 | crafts 159 (shared) | **none beyond crafts.test** |

Raw parser assertion counts are close. The difference is above the parser: crochet and knitting
have a counter suite, a 3D reference set and a gallery reviewer tool. Sewing has no UI suite, and
cross-stitch has only part of the crafts frame.

### 1.12 Audit depth (page-by-page ground truth)
| | Crochet | Knitting | Cross-stitch | Sewing |
|---|---|---|---|---|
| Text ground truth | Y wave E `crochet-audit.md`, every fixture part by part | Y `docs/research/knitting.md` (2,755 lines, 16 fixtures, hard-line IDs) | P: wave E keys, sizes and fabric for 34 + OXS; grid cells only for KG-Chart and the 21 wave J pages | Y wave E `sewing-audit.md`, all 16, line by line |
| Visual ground truth | Y ~40-part 3D reference table plus `diagram.gallery.html` | P: 5 gallery chips; shapes on synthetic references | N: no gallery of "what the app made beside the page" | N; the wave F pass had no screenshots |
| In-app QA pass | Y waves E/F/I | Y `knit-qa.md` (60 defects) | P: waves F/J | P: wave E at 375×812 for four files |

### 1.13 What the run turned up (2026-11-12)
- **Cross-stitch, pacman.** The grid read reported "64,512 stitches… 8 of 9 colours matched, 1
  symbol could not be matched", and "Use it" was offered as the main button. After using it,
  DMC 349 (176 sts) and DMC 3843 (4,824 sts) show "no count yet", and the chart holds **5,000 cells
  of −1**. The total reads 59,512 against the key's 64,512.
  - The test passes because it asserts the raw fill, not the mapped cells
    (`test/xstitch.fixtures.html` around line 1045: "two colours share one ink").
  - A stitcher would find 5,000 stitches missing from the chart with nothing on screen saying so.
  - This is the clearest parity gap in the run: crochet would show "≠ why" here.
- **Knitting, socks.** Only Gusset Decreases got a target (20). Cuff, Cuff (continued) and Foot did
  not, so on most of a sock the counter has no bar, no part-done and no celebration.
- **Sewing, apron.** It came in as "16 found (from paragraphs)" with four ⚠ lines, and the cutting
  list lives on the pattern sheet. A "📄 page 3" chip appears on step 1 even though I unticked
  "Keep the pages".
- **Crochet, bee.** Every claim held: size tabs, inferred ×2, placing notes, targets and the confidence line.

## 2. The 20 biggest parity gaps, ranked by what a maker would feel

**1. Cross-stitch: one truth for counts after a grid read** (04 #4 and #6, still open)
- *What the user sees*: when a key colour comes back with 0 stitches, or two key colours share
  one ink, the review says "2 colours could not be told apart: 5,000 stitches". The choices are
  "Show them on the chart" (outlined, like wave J's unsure squares), "Assign them" (pick a key row
  for the class), or "Keep the key's counts only". "Use it" is not the main button until each
  colour is accounted for.
- *Why*: the pacman run above. Wave J built exactly this check (`checkCounts`, verdicts
  exact / close / off / unchecked) for picture reads, but the vector path still accepts at 80% of
  colours agreeing (xstitch.js:6064).
- *How*: send `extractGrid`'s result through `XStitch.checkCounts` and the read-sheet table
  (`openReadSheet` AX:5965). Reuse "Which colour is this?" to split or assign a shared ink by
  position, using the key's printed counts as the constraint.
- *Effort*: M. *Risk*: the app has to split an ink that the PDF draws in one RGB. The honest
  default is to ask, not to guess.
- *Proof*: a pacman fixture assertion that mapped cells with −1 = 0 after "Assign", or that the
  sheet blocks with a verdict of "off". The other 6 KG-Chart fixtures stay exact.

**2. Cross-stitch: a full-screen working mode** (04 #5)
- *What*: ⤢ on the chart opens the crochet working-mode contract, with the chart as the surface:
  - tap anywhere counts
  - a big "3 / 12,711 · DMC 310", the block readout and the next block preview
  - big −1 / Undo / ‹ colour ›
  - Keep awake
  - keyboard: Space marks, arrows move the crosshair
- *Why*: the counter crafts got this in wave I. A stitcher holds a hoop in one hand, and today the
  button is under the key card at 375 px.
- *How*: a shell `workMode` contract (see §4). The craft supplies `surface`, `primary()`, `undo()`,
  `readout()`, `next()` and `keys`; the shell supplies the layout, wake, landscape and memory
  (`settings.focusProjects`).
- *Effort*: M. *Deps*: §4 contract. *Proof*: pane check at 375×812 and 375×640, 0 px overflow;
  a `crafts.test` frame test of the contract.

**3. Sewing: a working mode for the machine**
- *What*: the step card full screen, readable from arm's length (28 px text), with the step's page
  crop beside it in landscape. STEP DONE is the bottom half of the screen, "back a step" sits
  small, the SA reminder and machine settings are chips, and the screen stays awake.
- *Why*: no working mode exists (none found in AS). Sewists stand at a machine or an ironing board,
  away from the phone.
- *How*: the same shell contract. The surface is the step card and `primary()` is `advance`
  (AS:559).
- *Effort*: M. *Proof*: pane check; announcement "Step 4 of 6" on each advance.

**4. Knitting: targets for "work until it measures" parts**
- *What*: a part with no printed row count gets an offered target: "≈ 118 rows from your swatch
  (32 cm). Use as target?" Accepting it gives the bar, part-done and the celebration, all marked ≈.
- *Why*: 3 of 4 sock parts had no target in the run. The length chip already computes "≈ 118
  rows, not 110" and is deliberately "never a target". Crochet's wave F `untilRows` and ≈ targets
  are the precedent.
- *How*: `Store` sets `targetRows` with `targetSource: 'gauge'` only when the maker taps "Use"
  (consent keeps the accuracy rule). Recompute when the swatch changes.
- *Effort*: S/M. *Risk*: no swatch means nothing is offered (honest).
- *Proof*: a knit-counter test (swatch → offer → accept → done fires once); the socks fixture in
  the pane.

**5. Sewing: suggest my size from my measurements** (05 #12)
- *What*: in Size & alterations, "From your measurements: bust M, waist L, hip L. You are between
  M and L at the waist." Tapping a size picks it. It is never chosen silently.
- *Why*: "My measurements" and the body chart are both stored (AS:1715, `measureTable`), but
  nothing joins them. Choosing the size is the sewist's single biggest decision.
- *How*: compare per row, in dual units, using the chart's own rows. If no body chart exists, show
  nothing.
- *Effort*: S. *Proof*: sewing.test on Tiana's dual-unit chart and the bathers chart.

**6. Knitting: chart rows that count and point**
- *What*: "work Row 1 of Foot chart over 32 sts" gets 32 and the chart chip. Lace-book rows that
  say "See Chart C for Rows 38–56" get the chip. The Icelandic half charts get their mirror half.
- *Why*: these are HANDOFF's knitting residuals. Charted lace and colourwork is where a knitter
  most needs counting, and today those rows carry null.
- *How*: `Line.chart` recognises more phrasings in `knits.js`. `KnitChart` row widths become the
  count when the chart was read cell by cell. A mirror is generated only when the pattern says
  "mirror" or "reverse".
- *Effort*: M/L. *Proof*: the KNOWN lines in `knits.fixtures` move to passing, and no wrong count
  is added.

**7. Sewing: edit a step, and add a note to it**
- *What*: ✎ on the step card edits its text, and a per-step note ("used 1 cm here") shows under it.
- *Why*: crochet edits pattern text in the part editor. Sewing offers only split and merge, and
  steps "from paragraphs" (apron: all 16) need hand fixes.
- *How*: `S.editStep` / `stepNote` in craftData, one undo step. A re-import keeps the edit while
  the printed text is unchanged (the same rule as split).
- *Effort*: S. *Proof*: sewing.test round trip; a re-import keeps the edit.

**8. Sewing: say what was missed, per item**
- *What*: the review lists what it could not do and why:
  - "Steps 7 and 9 are missing from the numbering (page 4 is a picture)"
  - "Cutting list is on the pattern sheets"
  - "3 of 14 steps merged; check page 2"

  Each line has a 📄 link to the page.
- *Why*: today sewing gives "N found" plus ⚠ lines, with no per-item reason. The Riley Blake tote
  reads 11 of 14 steps silently. This is crochet's "≠ why" for sewing.
- *How*: the shared Check surface (§4). Sewing's rows come from printed step numbers
  (`printedSteps` SW:4118), `emptyPages`, and cutting totals against piece letters.
- *Effort*: M. *Proof*: sewing.fixtures assertions on the tote (gap named) and the apron (image
  pages named).

**9. Cross-stitch: the paper's own symbols**
- *What*: the app's key and chart use the same symbols as the printed chart, so a stitcher can
  read either one.
- *Why*: wave E "Still wrong" #1. Every KG-Chart and symbol-font fixture shows different symbols
  in the app than on paper.
- *How*: a KG-Chart position → glyph table, and font code → glyph tables for the two symbol fonts
  seen (wocs, foxy). Fall back to the app's own set.
- *Effort*: M. *Risk*: the V vs • disagreement noted in wave E needs a look first.
- *Proof*: fixture assertions per key row.

**10. Templates for cross-stitch and sewing**
- *What*: "Save as template" in the ⋯ menu for every craft, and a craft picker in "＋ New
  template". Sewing's built-ins get real checklists ("prewash", "press seams", "test the
  buttonhole"), and a quilt template gets block counters.
- *Why*: only counter crafts can save templates (app.js:9462). The editor always makes crochet
  (:7188). The sewing built-ins are bare.
- *How*: a craft hook `templateFrom(craftData)` that drops progress, and `Store.templateFromProject`
  routes to it.
- *Effort*: M. *Proof*: templates.test per craft; a backup round trip.

**11. Knitting: markers that move on increase rows**
- *What*: after "k to m, M1, sm, k1, M1", the marker strip shows the new section counts.
- *Why*: the marker strip says "Markers set on a 60-st row · this row makes 62" and stops there
  (knit-counter "left"). On raglans and shawls, markers are the work.
- *How*: walk `expand`'s `inc` / `dec` positions against the marker positions per row, only when
  the row's total is known.
- *Effort*: M. *Proof*: knit-counter tests on the Bernat raglan rows.

**12. Sewing: the step's own diagram, cropped**
- *What*: the step card shows the figure that goes with the step (the drawing beside "3. Sew the
  side seams"), the way knitting's chart chip crops the chart.
- *Why*: sewing has no visual model at all beyond the cutting table. Page images are opt-in and
  whole-page.
- *How*: the operator list gives image and vector-figure boxes per page. Pick the box nearest the
  step's text block, and render that region from the kept page. If nothing is close, show no crop.
- *Effort*: L. *Risk*: pages that put all figures together. *Proof*: a fixture table of step →
  figure box for two booklets, written by hand.

**13. Knitting 3D: one piece, not parts**
- *What*: a sock imported as Cuff / Leg / Heel / Foot is drawn as one sock. A raglan's sleeves
  join the yoke. Follow mode turns the foot toward you.
- *Why*: HANDOFF knitting 3D residuals. The shapes are asserted only on synthetic references.
- *How*: a project-level model that concatenates parts in order, with pick-up and divide joins.
- *Effort*: XL. *Proof*: reference rows for the socks and raglan fixtures read from the real PDFs.

**14. Cross-stitch: backstitch and knots from the PDF**
- *What*: a KG-Chart or Spriter chart's backstitch lines come in on the Back layer.
- *Why*: the grid reader reads full stitches only (HANDOFF small item 8). Many charts' outlines
  are backstitch.
- *How*: stroke paths in the operator list, snapped to the grid's half-stitch lattice and matched
  to the BS key rows.
- *Effort*: L. *Proof*: Ursa OXS backstitch counts as the truth pair, plus one KG-Chart with
  backstitch (owner fixture).

**15. Image-only patterns, all crafts (OCR on the device)**
- *What*: a scanned key, booklet or APL page reads like a text PDF. The ≈ / "unsure" mark is
  carried on every line OCR produced.
- *Why*: these are scan-only today:
  - cross-stitch: Tiny Modernist and Satsuma keys
  - sewing: the West End jacket and apron pp4–7
  - crochet and knitting: the APL books, and Nicoll after p2
- *How*: Tesseract.js in a worker, offline language data (eng), and the `ocrNoise` score PdfText
  already has.
- *Effort*: XL.
- *Owner decision*: a vendored Apache-2.0 library plus about 10 MB of data per language. It is a
  download that needs approval. It has no running cost.

**16. Cross-stitch accessibility parity**
- *What*: arrow keys move the crosshair on the chart canvas, Space marks, and + / − zoom. The
  Awake button uses `ctx.wake` with `aria-pressed`. Announcements every 50th stitch, per the
  shared policy.
- *Why*: UX sweep D1 is still open, AX:1931 announces every 100th, and Awake is AX:1326.
- *Effort*: S. *Proof*: crafts.test frame (key events, aria state); a screen-reader pass in the pane.

**17. Craft-aware first run and empty states**
- *What*: a knitter never reads "Nothing on the hook" or "Rnd 1: 6 sc in MR". The home blurb
  names all four crafts. After a first project in any craft, its tour is offered the way crochet's
  welcome chain is.
- *Why*: these strings are seen on every first run (app.js `IMPORT_EMPTY` :7469, :1794,
  index.html:54).
- *How*: per-craft `emptyCopy` on the registration.
- *Effort*: S. *Proof*: crafts.test string checks per craft.

**18. Per-craft settings, and settings that survive a backup**
- *What*:
  - Settings gets 🧵 Cross-stitch (default count and fabric, symbol set, skein length) and
    🪡 Sewing (cm / in, my measurements, machine presets with a few defaults).
  - Restoring a `.thready` brings these back, along with the theme.
- *Why*: cross-stitch and sewing register no `settingsFields`. The backup ignores `settings`
  (pinned as a known gap). 05 #16 is open.
- *Effort*: S/M. *Proof*: backup.test un-pins the gap.

**19. Sewing: quilts wear quilt chrome** (05 #17, #14)
- *What*:
  - A quilt project leads with blocks and cutting by fabric, and subcuts chain ("cut 6 WOF strips
    → 48 squares"). Ticking a strip advances its subcuts.
  - The STEP DONE button gives way to the unit counter when units are the work.
- *Why*: `detectKind` is never stored or shown, so the AGF and FreeSpirit quilts look like a
  garment.
- *How*: store `kind` in craftData and select the layout by kind.
- *Effort*: M. *Proof*: sewing.test on the AGF tables; pane check.

**20. Audit and fixture parity for cross-stitch and sewing**
- *What*: a `xstitch.gallery.html` and a `sewing.gallery.html`, like the 3D gallery. Each shows
  every fixture's import result beside its PDF page, with verdict buttons and a JSON export. Each
  craft's "what the app made" can then be reviewed by a person.
- *Why*: crochet's accuracy came from the reference table plus the gallery. Neither other craft
  has a visual ground truth, and sewing has no UI suite.
- *Effort*: M. *Proof*: the gallery exists and one review pass is recorded as rows in the audit
  docs.

## 3. Top 8, and the one thing

1. **One truth for cross-stitch counts.** No chart silently loses 5,000 stitches again.
2. **Cross-stitch working mode.** The hoop-in-one-hand screen that crochet already has.
3. **Sewing working mode.** STEP DONE readable from the machine.
4. **Knitting length targets, by consent.** Most of a sock gets a bar and a finish.
5. **Sewing size suggestion.** The two tables the app already stores, joined.
6. **Knitting chart rows count.** Lace and colourwork rows stop being null.
7. **Sewing: say what was missed.** "≠ why" for booklets.
8. **Templates for every craft.** "Save as template" no longer depends on the craft.

**The one thing**: build the shared Check surface (§4.1) and wire the cross-stitch grid path
into it first (gap 1). It is the one place where today's app is confidently wrong on a real
fixture. The surface then serves sewing (gap 8) and knitting's "count unknown" with no new UI.

## 4. Cross-craft shell work that lifts all three at once

1. **One Check surface.**
   - Shape: `Check = {rows: [{label, printed, read, verdict, why, page}], verdict}`. This is wave
     J's contract §3, generalised, with one sheet and one badge style (≈ / ≠ / ?).
   - Feeds: crochet `countReport`, knitting "count unknown", cross-stitch key against grid or
     picture, sewing printed numbering, empty pages and cutting totals.
2. **One working-mode contract.**
   - `def.workMode = {surface, primary, undo, readout, next, keys}`.
   - The shell owns the layout, landscape, wake, keyboard, memory and the announcement cadence.
   - Crochet and knitting already fit it, and cross-stitch and sewing get it.
3. **One share card.**
   - A canvas card for a finished project, sent with Web Share: name, craft, hours (from the
     timer), dates, and the craft's own picture (3D snapshot, chart thumbnail, step ring or quilt
     blocks).
   - No craft has one (wave 2 item 9, still open).
4. **Templates by craft hook** (gap 10). This includes a craft-aware template editor.
5. **One count-event helper.** `ctx.counted({n, total, unit})` applies the announcement policy and
   haptics, so no craft rolls its own cadence (cross-stitch's every 100th).
6. **One page viewer.** Cross-stitch's page viewer, sewing's viewer and knitting's chart viewer
   are three implementations of pinch, ‹ › and a region outline. Crochet has none, and it could
   keep its PDF pages through the same viewer.
7. **OCR as a shell service** (gap 15). It needs an owner decision.
8. **Craft-aware onboarding strings and settings sections** (gaps 17 and 18), plus settings
   restored from a backup.

### Where crochet is behind another craft (out of scope; one line each)
- Crochet keeps no PDF page images; cross-stitch, sewing and knitting charts do, so amigurumi
  assembly photos are lost.
- No glossary of the pattern's own abbreviations (knitting has 📖 Glossary).
- No stitch-marker strip (knitting); crochet uses markers too.
- No symbol-chart reader (knitting has `KnitChart`); the Gosyo doily charts are unread.
- No yarn amounts or shopping list (cross-stitch skeins, sewing fabric).
- No gauge-against-swatch card (knitting); the import's gauge chip is for other crafts only (app.js:8232).
- No hook or tool settings and no unit setting (knitting needles, sewing machine presets).
- No "copy as text" of the remaining rows (cross-stitch Row by row).
- No two-at-a-time for paired parts (knitting's "Sock 1 | +2" would suit sleeves and ears).
- No printable output (cross-stitch prints its chart).

## 5. Do not build
- **3D garments for sewing.** A booklet gives no geometry, so any model would be invented. The
  cutting table and the step's own figure are the honest visuals.
- **A "stitched look" 3D render for cross-stitch.** The chart is already the true model. The cost
  would be GPU time on phones for little counting value.
- **Silent knitting targets from length.** Only by consent and marked ≈ (gap 4). An unasked guess
  breaks the accuracy rule.
- **Sewing size picked automatically.** Suggest only (gap 5). Fit is a judgement call.
- **A cloud or LLM step for "read my booklet".** It is a per-user cost, and the owner ruled it out.
- **Four separate working-mode implementations.** Build the contract once (§4.2), or the four
  will drift the way the three page viewers have.
- **Milestone celebrations every 50 stitches in cross-stitch.** Charts run to 60,000 stitches, so
  that is noise. Celebrate a colour, a page or a 10×10 block row instead.

## 6. Asks for the owner
1. **Fixtures**:
   - the FlossCross PDF + OXS pair (still owed; it settles backstitch and fractional truth for
     gap 14)
   - a KG-Chart or Pattern-Keeper-style chart with backstitch
   - a text-layer indie garment booklet with a full cutting list (Helen's Closet or Closet Core;
     email-gated, so it needs your sign-up)
   - a knitting chart set in a symbol font
   - the real "Po Ta Toes" PDF
2. **Decision**: OCR (gap 15). Vendor Tesseract.js (Apache-2.0) plus the English data (~10 MB),
   downloaded once and precached? This needs approval for the download.
3. **Decision**: may a knitting part take a gauge-based ≈ target when the maker taps "Use" (gap 4)?
4. **Decision**: should the app reproduce printed KG-Chart symbols (gap 9), given the V vs •
   question?
5. **Decision**: should the shared Check surface block "Use it" when a verdict is "off" (gap 1),
   or only make it a second button?
