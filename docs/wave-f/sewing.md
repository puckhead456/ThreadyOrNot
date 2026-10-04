# Wave F: sewing (`sewing`)

Files changed (all mine): `js/sewing.js`, `js/app-sewing.js`, `css/sewing.css`,
`test/sewing.test.html`, `test/sewing.fixtures.html`. No shell file was touched.

| Suite | Baseline | Now |
|---|---|---|
| sewing | 882 | **963 / 0** |
| sewing.fixtures | 755 | **789 / 0** (fresh extraction: session cache cleared, then re-run after the last edit) |
| crafts | 124 | **124 / 0** |
| templates | 94 (117 in the tree today) | **117 / 0** |

The app was checked at 375×812 in my own tab. Four projects were created the real way: New project → Sewing → the craft drop zone (fed the PDF through its file input) → the import review → Import. The four were the Peppermint Samford pants, the Swoon Mabel bag, the AGF Joyous Picnic quilt and the Pattern Runway sundress. They were deleted afterwards (their BlobStore prefixes too).

The Browser pane was hidden for the whole session, so no screenshots could be taken. Layout was checked by measuring the DOM instead:
- element rects;
- `scrollWidth` against `clientWidth` on the screen and on every sheet (always 375/375, so no horizontal scroll);
- the text that is actually rendered.

---

## 1. Split and merge a step after import (05 #1)

**What the user sees.**
- **In the step list**, every card has a **✂** button. It opens a panel under the card:
  - "Split here — start a new card at…", with one choice per sentence boundary (the same sentence list the import's paragraph picker uses);
  - **⤒ Merge with the next card**, with a preview of the next card.
- **After a split** both cards keep the printed step number. The list reads "1 · 1/2" and "1 · 2/2", the header chip reads "card 1 of 2", and announcements say "Step 1 of 15, card 1 of 2". This is exactly the wave E "(continued)" scheme, because the halves share `n`.
- **Toast and undo.** A toast says "Step 1 is now 2 cards" (or "Merged into step 1"), with **Undo**. Every split or merge is one `Store.updateCraftData` call, so ↶ Undo and the toast's Undo both put it back.
- **Focus.** Keyboard focus returns to the card's ✂ after the panel closes.
- **On the step card.** A card over 350 characters with more than one sentence shows **✂ Split this card** at its foot. It opens the step list with that card's panel already open and scrolled into view. At 375 px the link sits inside the card (29,365, 112×36), clear of the page and seam-allowance chips.
- **Merge rules.** A merge keeps the first card's number, section and page. The result is done only when both cards were. An optional extra never merges into a construction card.

**Figure references stay put.** `Sewing.sentences` now keeps a leading "(Figure 1)" on the sentence before it. Samford's "…and press. (Figure 1) Finally, …" no longer splits with the figure on the wrong card. Joining the sentences still gives the original text back exactly.

**Re-import keeps the split** (the risk named in 05 #1).
- A split or merged card carries `src`. This is a key over the whole text (`Sewing.textKey`) of the imported card(s) it came from, joined with `+` for a merge.
- `toCraftData` puts the sewist's cards back in place of the imported card(s) whenever those imported texts are unchanged. The cards keep their ticks and get fresh ids. A step whose text changed comes in as printed.
- **Partial matches.** Split X into three, then merge X3 with Y. The merge re-keys the whole run (X1, X2 and X3Y all share `x+y`), so a re-import returns all three cards.
- **Checked in the app** (Mabel): split card 1, tick it, ⋯ → Import pattern → same PDF → Import. The result was still 14 cards, with the split and the tick in place.

**Contract.**
- `Sewing.splitStep(data, index, at)`: `at` is a sentence index, 1..n-1. Returns a boolean and mutates the data.
- `Sewing.mergeSteps(data, index)`: returns a boolean and mutates the data.
- `Sewing.textKey(s)`.
- `StepRow.src`: an optional string matching `/^[a-z0-9.+]{3,400}$/`, dropped otherwise.
- Saved step text is now capped at **4,000** characters (`STEP_SAVED_CAP`), so a merged card is never cut. The parser still makes cards of at most 800.
- **＋ Add step** now inserts after the last construction card (before the optional extras), numbered after it.

## 2. Numeric cutting chips (05 #3, brainstorm numbering)

**What the user sees.**
- **Each row** has **−** and a chip reading **"0 of 4 cut"**:
  - Up to 6 pieces, a tap counts one more, and at the total it says "All 2 cut — use − to take one off". There is no more wrap to zero.
  - Above 6 (a quilt's 7, 56 or 160), the chip reads "0 of 56 cut ▸" with a dashed border. It opens a counter: −10, −1, +1 and +10, **None cut** and **All N cut**, saved once on Save.
- **Hints under the piece name** (`Sewing.cutHint`):
  - "2 mirrored = 1 pair: cut through two layers, or flip the pattern piece over for the second of each pair";
  - "on the fold: marked edge on the fabric fold — each cut opens out into one whole piece";
  - plus bias and crosswise lines.
- **Notes printed twice.** An "(on the fold)" note is no longer printed again beside the pill and the hint. A quilt piece named by its size no longer repeats the size underneath.
- **Counting pieces, not rows.**
  - The sheet header reads "7 of 112 pieces cut · 1 of 18 rows done".
  - The mini row reads "3 of 27 pieces cut".
  - The cutting-table aria label and the **home card** count pieces too: "step 1 of 16 · 7 of 112 cut" (AGF) and "0 of 27 cut" (Mabel), where they used to count rows.
- **Pairs in the text.** "Cut 1 pair of pockets" and "Pocket: cut 1 pair" are now 2 pieces with `grain: 'pair'`, so the hint says "1 pair".
- **Bug fixed on the way: re-import gave one count to every row with the same name.**
  - Found in the app: the Mabel bag cuts a "Main Panel" from three fabrics, and a re-import gave all three the count of the one that had been cut ("3 of 27").
  - Counts are now matched by piece, fabric and note. They fall back to the name only when it is unique on both sides, so a row whose fabric was changed in the editor keeps its count.

**Contract.**
- `Sewing.cutTotals(data)` → `{ cut, total, rows, rowsDone }`.
- `Sewing.cutHint(row)` → string.
- `Sewing.summary` uses pieces.

## 3. Pattern variation and hack pages go to a collapsed Optional group (05 #3, brainstorm #2)

**Parser.**
- **The gap.** Wave E already kept steps-block variations out of the count. It did not handle a variations or hack page printed **outside** the sewing instructions. Samford p4's "PATTERN HACK (OPTIONAL!)" sits under "Choosing your size", and it was simply lost.
- **The fix.** `parseSteps` now runs `optionalPages()` whenever the booklet has a real steps block:
  - A heading-shaped line naming a hack, variation, "make it your own" or customise section starts an optional run. Capitals, or Title Case of 6 words or fewer, count; prose such as "This pattern features two length variations: pants and" does not. "(OPTIONAL!)" is stripped from the name.
  - The run ends at the next heading, page break, block or the steps block.
  - It is cut into cards like a long step, de-duplicated against what the steps loop already parked, and pushed onto `variations`. Care, washing and social pages are not taken from outside the instructions.

**App.**
- The step list shows construction first.
- Extras sit in a collapsed **"Optional — 4 extras, not counted"** group, with a one-line explanation. It opens by itself when you are on an extra, and remembers when you open or close it.
- The sheet header reads "1 of 8 steps done · 4 optional extras", counted in printed steps.
- The import review reads "Steps 11 found (1. style · + 4 optional extras, not counted)", and ▸ lists them as "Optional (Pattern Variations): …".
- Bulleted and titled steps now say "(bullets)" and "(titled paragraphs)" instead of "(1. style)".

**Assertions.**
- **Sundress:**
  - exactly 4 optional variations under Pattern Variations, all from p9;
  - they travel together after the 11 construction cards;
  - the header still counts 8.
- **Samford:**
  - one optional extra named "Pattern Hack", whose text starts with the hack;
  - the SHORTEN/LENGTHEN section after it is not swept in;
  - still 15 printed steps.
- **Every fixture** (universal check): each optional extra sits under a variations, hack or care heading.
- **Pencil skirt:** no optional extras.

**Checked in the app** (sundress):
- the group is collapsed after the eight steps;
- tapping it shows the four "+" rows under PATTERN VARIATIONS;
- jumping to one gives "EXTRA / Optional extra 1 of 4";
- reopening the list opens the group.

## 4. Samford fabric expectation tightened

**The table.** The extractor now emits the p5 grid row by row:

```
TOP SHORTS PANTS / METERS YARDS ×3 / 140CM … / SIZES A-H / 113CM … / 140CM … / SIZES I-P / 113CM …
```

The "SIZES A-H" label sits in the middle of its group.

**The reader.** `gridFabric()` reads it in `parse()`:
- a header of 2–6 garment words;
- a units line of 1 or 2 units per column;
- rows of a width plus one number per unit;
- group labels anywhere between the rows.

The widths repeat once per group. It produces one row per garment and width, with one amount per group ("2.6 m / 2.85 yd"). Each row carries `groupLabels: ['A-H','I-P']`. When the booklet has a size chart whose labels the groups tile, the amounts are spread per size (unit-tested with A–P).

**Ground truth.** I rendered p5 in the pane and read it before the pane hid:

| Sizes | Width | Top | Shorts | Pants |
|---|---|---|---|---|
| A–H | 140 cm | 1.5 / 1.65 | 1.5 / 1.9 | 2.6 / 2.85 |
| A–H | 113 cm | 1.6 / 1.75 | 1.8 / 2 | 3 / 3.3 |
| I–P | 140 cm | 1.7 / 1.9 | 2.1 / 2.3 | 3 / 3.3 |
| I–P | 113 cm | 2 / 2.2 | 2.1 / 2.3 | 3.7 / 4 |

Values are metres / yards. The parse matches every cell.

**The fixture** now asserts:
- 6 rows;
- each garment's raw amounts, cell by cell, as above;
- the group labels;
- **no** "could not be read" warning.

The old "either read or reported unreadable" check is gone.

**App.** The Fabric sheet shows a chip per group ("Sizes A-H · 2.6 m / 2.85 yd"). It never spreads the amounts over sizes the booklet does not name in its text. `FabricRow.groupLabels` is kept by `normalize` only when it lines up with `rawAmounts`.

## 5. From the 05 lens: what else I built (in value order)

1. **Shopping list with fabric and thread (05 #5).**
   - `Sewing.shoppingList(data, { fabric, notions, thread })` puts the fabric first:
     - with a size chosen: the chosen size's amount per bolt width, e.g. "2.4 m / 3 yd — fabric, 115cm / 45" wide (size 42)";
     - with no size chosen: each size range with its amount ("36–40 2.3 m · 42–44 2.4 m");
     - for a grouped grid row: its groups.
   - Then come the notions not ticked off. A notion that only names a fabric already listed is left off ("Matching linings" beside the LINING row).
   - Then "Thread to match", unless thread is already listed. Duplicate lines are removed. The pattern's strings are kept verbatim and nothing is converted.
   - The Notions sheet has **Fabric / Notions / Thread** toggles, stored as `Settings.crafts.sewing.shopping` (`{fabric, notions, thread}`), plus a count line and a **Preview** list.
   - Copy is enabled whenever there is anything to copy, including a list that is fabric only.
2. **Cutting layout pages (05 #7).**
   - `Sewing.layoutPages(sourceText)` finds the layout pages:
     - "CUTTING LAYOUTS" (kerning-split too);
     - "Cutting layout", "fabric layout", "lay plan";
     - Pattern Runway's caption "Cutting layouts show approximate position…".
   - It skips a heading that is one of a stack of side headings (Samford p8 only names the layouts and points at "the next page"). A quilt's "Quilt Layout" is not a cutting layout.
   - The Cutting sheet shows "Cutting layouts 📄 page 9 📄 page 10":
     - the chips open the page viewer when that page image is stored;
     - otherwise they are plain chips, with a hint to keep the pages.
   - An import with no cutting list says "No cutting list was found in the instructions" plus one honest line, instead of "No pieces yet."
   - Fixtures: pencil skirt and sundress p5, Samford p9–10.
3. **Seam-allowance exception at the point of use (05 #15).**
   - `Sewing.saPhrases` takes the parts an exception names. For the sundress: neckline, armhole, pocket edge.
   - `Sewing.saReminder(data, stepText)` → `{ mm, inches, part, text }`.
   - The step card's chip on such a step reads **"Seam allowance 6 mm (1/4") · neckline"**, underlined in the accent colour. Its aria label is "This step mentions the neckline — the pattern sews those at 6 mm". At 375 px it measures 243×44 on one line beside "📄 page 6".
   - The Seam allowance sheet opens with "This step mentions the neckline. The pattern sews those at 6 mm (1/4") — check whether this seam is one of them." It is a reminder, never a rule.
   - Sundress fixture: the neckline and pocket-edge steps get it, every reminder is the 6 mm one, and at most 4 cards get one.
4. **Render the step pages first (05 #10).**
   - With "Keep the pages" ticked, the render queue runs:
     1. the construction step pages;
     2. the cutting-layout pages;
     3. the optional-extra pages;
     4. the rest in order.
   - "Stop — keep the pages so far" therefore keeps the diagrams.
   - **How far this was checked.** In the app the progress read "Rendering the step pages first — page 4 (1 of 16)…" for Samford. Page 4 is the hack page, which was first under the order before this one. I then moved the optional extras behind the layouts, so page 11 should come first now. That change was not re-run in the app, because the hidden pane stalls pdf.js renders; see below.
5. Small fixes:
   - the "Go back to …?" confirm uses the printed step number;
   - the FAQ has a new entry on splitting a step, and its cutting-counter and shopping-list answers were rewritten;
   - the tour's cutting text reads "0 of 2 cut".

---

## What is left, and why

- **Samford size letters.** The body chart's A–P column heads are image text, so there is still no size chart. "SIZES A-H / I-P" plus a 16-column chart would let the labels be inferred. I left that out: it would invent labels the text does not print. The fabric grid shows its groups as printed instead.
- **Samford's "Optional Tools"** (bodkin, scissors, iron, thread snips) are still read as notions, so they appear on the shopping list. That is a notions-parser change for another day.
- **Machine presets in the box (05 #16) and quilt-specific chrome (05 #17)** were not done.
  - #17 needs `kind` stored in `craftData`, which it is not today.
  - #16 is opinionated defaults.
- **No 375-px screenshots** this session, because the pane was hidden. Every layout claim above is from measured DOM rects. A visual pass with the pane shown is worth doing once.

## For the owner of `js/pdftext.js`

- **`handle.renderPage(n)` cannot be cancelled mid-page.**
  - With the Browser pane hidden, pdf.js's page render never settled (it waits for animation frames). "Stop — keep the pages so far" only takes effect between pages, so the import sheet sat on "page 4 (1 of 16)" until it was closed.
  - On a phone this is only the case for a page that is slow to render. Even so, a `renderPage(n, { signal })` that calls `RenderTask.cancel()` would make Stop immediate.
  - The sewing side would pass its `cancelled` flag through.

## Housekeeping

- My four test projects were deleted from the pane's storage, together with their page-image prefixes.
- Nothing was written to `tmp-pdf/` or to the repo root.
- The viewport emulation was reset to desktop.
