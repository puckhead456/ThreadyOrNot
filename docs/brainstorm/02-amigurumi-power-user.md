# Brainstorm 02 — the amigurumi power user

I imported `crochet-baphomet.pdf` through the New project sheet (7 parts, 3 make-2s, 12 checklist items — the parser did a genuinely good job) and worked it: Body/Head R1→R20, both Ears end to end, part switching, pattern sheet, placement notes, alerts, checklist, history, yarn colours, the 3D viewer and the timer. Counting itself feels right — press-and-release, auto-advance, undo, the ≈ marker, the piece-done toast are all correct and fast.

What breaks is everything *around* the count. A PDF import leaves `targetRows` null on all 7 parts, so progress bars, make-counts and celebrations are dead on arrival — and because `allPartsDone` ignores target-less parts, the moment I set a target on Ears and finished them the app declared the whole Baphomet finished and filed it on the shelf. Every colour-change line in this pattern (`CC to main color in last stitch of R12`, `Starting in secondary color`) is parsed as a floating note attached to nothing, so the one instruction you cannot recover from is the one the app silently drops. And the app knows exactly which round the safety eyes go in — it just never tells me when I get there.

The three things I'd pay for: targets that come with the import, colour changes and placements that interrupt me at the right round, and a group buzz that follows the row's own repeat instead of a fixed 10.

---

## Proposals, ranked by impact ÷ effort

### 1. Set `targetRows` from the imported section's `maxRow`
**Problem.** After importing the Baphomet, all 7 parts have `targetRows: null`. Consequences on the counter screen: no progress bar under the big ROUND number, no `piece 1 of 2` line, the `Arms 0/2` tab badge can never move, no piece-done / part-done toast, no celebration. The part editor sheet even prints "33 rounds (up to 33) · stitch counts found" directly above an empty **TARGET ROUNDS** field. `Patterns.summary()` already returns `maxRow` (Arms 11, Tail 42, Body/Head 33, Muzzle 5, Horns 14, Ears 6, Feet 8) — `importPatternSections` just never writes it. `applySuggestions` doesn't help because `suggestions.targetRows` only fires on "Repeat rows X-Y until N total rows", which no amigurumi pattern contains.
**Proposal.** In `Store.importPatternSections`, when creating a part (and when updating one whose `targetRows` is null), set `targetRows = section.maxRow` from `Patterns.summary(section.text)`. Show it in the import picker row ("×2 · 11 rounds · counts found · target 11") with a "don't set targets" escape in the sections list header. On an existing part with a target already set, leave it alone.
**Effort** S · **Impact** 5
**Risks.** A section whose last round is a cut-off page bleed would set a short target; the piece-done path then fires early. Mitigate by only setting it when the section's row numbers are contiguous from 1 to `maxRow`.

### 2. `allPartsDone` must not ignore parts without a target
**Problem.** I gave only Ears a `targetRows` (6) and crocheted both. On the 30th stitch of ear 2 the app showed "**All parts done! 🎉 Baphomet is off the hook. Time for assembly.**", played the project celebration, set `status: 'finished'`, and the home screen became "Nothing on the hook right now — everything you have made is on the shelf below." Five untouched parts, a project I'd have to dig out of a collapsed Finished shelf and re-status. `store.js:1284` skips every part with `!p.targetRows`, so one finished part out of seven ended the toy.
**Proposal.** In `allPartsDone`, a part with no `targetRows` and `row === 0 && piecesDone === 0` counts as not-started (blocks completion) rather than being skipped. Keep the current skip only for parts that are genuinely optional — better: require *every* part to be done, and offer "Finish anyway" in the project-done sheet. Pairs with #1, which makes the situation rare, but the guard is what stops it happening to hand-typed patterns.
**Effort** S · **Impact** 5
**Risks.** Someone who deliberately leaves a part open-ended (a scrap-yarn tail) would never get the celebration — hence the "Finish anyway" affordance, or a per-part "not counted toward finishing" flag.

### 3. Colour-change lines attach to nothing
**Problem.** Every colour instruction in this pattern parses as `kind: 'note', row: null, notes: []` — i.e. it shows in the pattern sheet as loose prose and **never appears on the counter**:
`Tail: "CC to main color in last stitch of R12"`, `Arms: "CC to main color in last stitch of R2"`, `Ears: "Cc to main color last st of R5"`, `Horns/Tail/Arms: "Starting in secondary color."`, `Ears: "Staring in secondary color"` (the author's typo). I crocheted all six rounds of both ears watching the pattern line and the colour change never once surfaced. In amigurumi that is a whole piece frogged.
**Proposal.** Three small parser changes in `js/patterns.js`: (a) add `cc`, `c c`, `cc to`, `mc`, `starting in`, `staring in`, `in secondary`, `in main`, `contrast` to the note-attachment keyword list; (b) when a note names a round (`last stitch of R12`, `of R5`, `in R2`), attach it to **that** round rather than to the next row, flagged `at: 'end'`; (c) a note with no round reference in a section's preamble attaches to row 1. In `js/app.js`, render a colour note as a distinct chip above the pattern line (swatch + text) rather than in the grey `· ·`-joined note run, and keep it visible for the whole round.
**Effort** S–M · **Impact** 5
**Risks.** `CC` is also "chain colour"/initials in some patterns; scope the match to lines that also contain `color`/`colour` or a known yarn word. The bee/cardigan fixtures must stay green.

### 4. Round-scoped heads-up for placement notes
**Problem.** Body/Head's placement notes hold "Attach safety eyes between R21&R22 leaving about 8 visible stitches between" and "Place arms so that tail is centered between arms". I counted from R1 to R20 and then jumped past 21 — nothing ever told me. The app knows the round: the text literally says R21&R22. The only way to see it is to remember to open the 📌 Placing sheet, and its row note is attached to **R33**, after the head is closed.
**Proposal.** Derive round references (`R21`, `R21&R22`, `rounds 5-9`, `between R27&R31`) from `Part.placementNotes` and from row notes at render time — no new data. When the working round is within the referenced range (or one before it), show a persistent amber banner between the round counter and the pattern line: `📌 Safety eyes go in here — R21&R22, ~8 sts apart` with a ✕ that dismisses it for that part+round. Buzz once with `Feedback.alert()` on the round you enter it.
**Effort** M · **Impact** 5
**Risks.** Placement notes are free text the user edits; the parse must never throw or eat the text. Dismissals need storing per part+round (small map in `craftData`-style project state or a transient in-memory set — transient is fine).

### 5. Group buzz from the row's own repeat, not a fixed 10
**Problem.** The readout under the stitch button says `Group 1 of ≈ 1 · stitch 0 of 10` on an 8-stitch magic ring, and `Group 1 of 3 · stitch 0 of 10` on `(3sc, inc)x6 [30]`. A fixed project-level group size of 10 is meaningless for amigurumi: rounds are 6–48 stitches and the unit you actually count in is the pattern's own repeat — 6 groups of 5 for `(3sc,inc)x6`, 9 groups of 3 for `(2sc, dec)x9`. The information already exists: `Patterns.expand(lines, 11, 36)` returns `sc,sc,dec,sc,sc,dec,…` — 27 typed stitches. Finding the smallest repeating unit of that array is three lines.
**Proposal.** Add `Patterns.rowRepeat(lines, row, prevCount) → { unit: ['sc','sc','dec'], times: 9, tail: 0 } | null` built on `expand`. When it's non-null and the setting **Follow the row's repeat** (Settings → Feedback, default on) is on, the readout becomes `Repeat 3 of 9 · next: dec` and `Feedback.group()` fires on each unit boundary instead of every `groupSize`. Fall back to `groupSize` when the row can't be expanded. Leave `groupSize` as the manual override.
**Effort** M · **Impact** 5
**Risks.** Must stay on the fast tap path — precompute the unit once per row, not per tap. `next: dec` is only right if the user hasn't gone off-pattern; word it as a hint, not an instruction.

### 6. Show position inside a round range
**Problem.** Body/Head R19–R28 is `48sc around (10 rounds)` — 480 taps where the big number goes 19, 20, 21… and the pattern line never changes. Tail R13–R42 is 30 identical rounds. There is nothing telling me I'm on round 2 of 10 in this stretch; I have to subtract in my head every time I pick the toy up. The `repeat-readout` element exists but only renders for a manually configured `Part.repeat`.
**Proposal.** When `Patterns.lineFor(lines, row)` returns a line with `rowEnd > row`, render into the existing `.repeat-readout` slot: `Round 2 of 10 in this stretch · 8 to go` with a slim bar. Pure derivation from `Line.row`/`Line.rowEnd` and `part.row`.
**Effort** S · **Impact** 4
**Risks.** None real; make sure it doesn't collide with a genuine `repeat.enabled` readout (prefer the explicit repeat when both exist).

### 7. Long-press the tap button to finish the round
**Problem.** The Tail is 30 rounds of `6sc around` = 180 taps of nothing. Lots of amigurumi makers count *rounds* only on plain stretches and use the pattern for the shaped ones. The `+` on the round counter does this, but it's a 62px control at the top of the screen that needs a second hand or a big thumb reach, and it records `rowStitches[n] = 0`.
**Proposal.** Long-press (500 ms) anywhere on the big tap button completes the current round: fill `stitch` to the row's target (so `rowStitches` and the diagram stay honest), run the normal `tapRow` path, `Feedback.row()`, and toast "Round 20 done — held to finish". Show the hint text under the number as `tap · hold to finish round` only when the round has a known target. Must not fight the existing 12px-move swipe-to-rotate gesture: cancel the long-press timer on the same movement threshold.
**Effort** S–M · **Impact** 4
**Risks.** Accidental long-presses while resting a thumb. 500 ms plus the move-tolerance cancel plus an undoable result makes it safe; the press state should visibly fill to signal it's arming.

### 8. Move the ⤢ 3D button off the tap surface
**Problem.** `elementFromPoint(331, 383)` returns `stitch-3d`. The ⤢ button is a 44×44 hole punched in the **top-right corner of the 347×256 tap button** — exactly where a right thumb arcs when you're tapping fast with a hook in the left hand. The cost of a mis-tap is a lost stitch plus a full-height modal to dismiss.
**Proposal.** Move ⤢ out of the button into the `.stitch-actions` row next to `–1` / `reset stitches`, or into the readout line as a small `3D ⤢` chip. If it must stay in the corner, shrink the hit area to 32px, inset it 8px from the button edge, and require a second confirming tap.
**Effort** S · **Impact** 3
**Risks.** Discoverability of the 3D viewer drops; the counter tour step already points at it, so keep that step and re-target it.

### 9. Scroll the active part tab into view
**Problem.** With 7 parts the tab strip is 731px wide inside a 347px viewport. I set Feet active, backed out and reopened the project: `tabs.scrollLeft === 0` while the active `Feet 0/2` chip sits at `x = 577` — 230px off-screen. The counter says Feet, the visible chips are Arms…Muzzle, and **nothing is highlighted**. Every time you resume a toy you have to guess which part you're on.
**Proposal.** After rendering the tab strip, `activeTab.scrollIntoView({ inline: 'center', block: 'nearest' })` (behaviour `auto`, or `instant` under `prefers-reduced-motion`). Add a fade/chevron on the overflowing edges so it reads as scrollable.
**Effort** S · **Impact** 3
**Risks.** None; guard against it stealing scroll from an open sheet.

### 10. One-tap "use the detected count" in the part editor
**Problem.** The part editor prints `33 rounds (up to 33) · stitch counts found` and then leaves **TARGET ROUNDS** blank with the hint "Leave blank for open-ended." No "Apply detected settings" button appears, because `suggestions` is null for amigurumi text. So I'm told the answer and made to type it, seven times.
**Proposal.** Next to the Target rounds input, a chip **Use 33** when `summary.maxRow` exists and differs from the current value. Same treatment for a detected repeat. Belt-and-braces for #1 and the only path for hand-pasted patterns.
**Effort** S · **Impact** 3
**Risks.** None.

### 11. Stop truncating checklist items mid-number
**Problem.** `Store.suggestChecklist` trims to 90 chars, which produced `"Attach safety eyes between R21&R22 leaving about 8"` — the sentence is cut exactly where the number I need lives ("…about 8 visible stitches between"). Also `"Sew muzzle onto front of head, centering between eyes. Using pins or stitch markers to"`. The full text survives in `placementNotes`; the checklist gets the mangled copy.
**Proposal.** Raise the cap to ~140 chars and break on a word boundary with an ellipsis; store the full sentence on the item and show it on tap (the item text is already a button for rename — make a long-press or a small ⓘ reveal the full text). Alternatively keep the item short and link it to its part's placement note.
**Effort** S · **Impact** 3
**Risks.** Longer items wrap to 3 lines on 375px; the checklist rows already stretch.

### 12. Home card should say how much of the toy is left
**Problem.** The card reads `Baphomet · active · Ears · Rnd 6 · 0 sts · just now`. With three toys on the go, "Ears · Rnd 6" tells me nothing about whether this one is nearly done. It also shows two identical 🧶 (project emoji and the crochet craft badge) side by side.
**Proposal.** Summary line becomes `3 of 7 parts · Ears rnd 6 of 6 · 4h 12m` (parts done counted as `piecesDone >= makeCount`), with a thin progress bar across the bottom of the card. Suppress the craft badge when it equals the project emoji, or when the install only has crochet projects.
**Effort** S · **Impact** 3
**Risks.** Parts-done is only meaningful once targets exist — ships with #1.

### 13. Default the count mode to Rounds when the PDF is worked in the round
**Problem.** Dropping the Baphomet PDF into New project auto-selects the "From this PDF" card, but the **COUNT** toggle stays on **Rows** (the synthetic PDF card carries no `countMode`, so the blank template's `rows` sticks — `app.js:1961/1978`). Every one of the 7 sections starts `R1: MR8` / `Mr6` / `MR4` and says `around`. I got a counter labelled ROW for a toy that is entirely rounds.
**Proposal.** When the PDF card is selected, set the mode from the parsed text: rounds if `magic ring`/`MR\d`/`Rnd`/`around` appear above a small threshold, else rows. Same signal could seed the project emoji.
**Effort** S · **Impact** 3
**Risks.** A pattern mixing a flat panel with a round body picks one; the user can still flip the toggle, and the label is cosmetic (counting is identical).

### 14. Offer the next unfinished part when one is done
**Problem.** After Ears 2/2 the counter kept a live TAP button on a finished part (round 7 of a 6-round ear, no target, no pattern line) and said nothing about what to do next. Finding the next part means scrolling a 731px tab strip. On a 7-part toy you do this six times.
**Proposal.** On `partDone`, the toast becomes actionable: `Ears complete ✓ — next: Feet ×2 →` and tapping it switches part. On a finished part, replace the big number's caption with `DONE ✓` and dim the tap button's press state (still tappable, so an extra round is possible, but clearly past the target).
**Effort** S–M · **Impact** 3
**Risks.** "Next" ordering is import order, not make order — see #18.

### 15. Auto-start and auto-pause the timer
**Problem.** The ⏱ chip is a 44×44 button showing only the icon until you start it. I counted ~100 stitches before noticing I'd never started it, so the toy's real time is lost. Amigurumi gets made in 10-minute sofa bursts; nobody remembers.
**Proposal.** Start the timer on the first stitch/round tap after it has been idle, and auto-pause after 5 minutes with no taps (subtracting the idle tail), all on-device. A setting **Time me automatically** (default on) in Settings → Feedback, and keep the manual chip for override. Show the running total in the chip even when stopped.
**Effort** S · **Impact** 3
**Risks.** Double-counting if the user leaves the app open — `visibilitychange` should pause too. Undo shouldn't rewind the timer.

### 16. Pace and time-remaining from history
**Problem.** The History sheet is a flat list — `Body/Head · Rnd 20 · 3:20 PM`, `Body/Head · Rnd 19 · 3:20 PM` — plus "Clear history". Every timestamp needed for "how fast do I crochet and how long is this toy going to take" is already stored, and none of it is used.
**Proposal.** Header on the History sheet: `≈1m 50s a round · 31 rounds left ≈ 57 min` using a median of the gaps below a 10-minute cutoff (so put-downs don't skew it), plus a tiny per-day sparkline of rounds completed. Show the per-part estimate as a muted line under the progress bar on the counter once ≥5 rounds exist.
**Effort** M · **Impact** 3
**Risks.** History is capped at 500 entries and jumped rounds don't write entries, so the sample can be thin — hide the estimate below 5 usable gaps.

### 17. `–1` disappears under the bottom bar on short phones
**Problem.** At 375×640 the `.stitch-actions` row (`–1`, `reset stitches`) renders at `y = 625` while the bottom bar starts at `y = 578`. The un-count button — the thing you reach for the instant you mis-tap — is behind the nav and needs a scroll. (Listed in HANDOFF as "the counter still overflowing below ~700px tall"; this is the part that actually hurts.)
**Proposal.** Below ~700px viewport height, move `–1` into the bottom bar (replacing or beside Undo) and drop `reset stitches` into the part editor / a long-press on `–1`. Or make the stitch button flex-shrink so the actions row always clears the bar.
**Effort** S · **Impact** 3
**Risks.** Two different bottom-bar layouts to keep consistent; the Undo/–1 distinction needs clear icons.

### 18. Let me reorder parts
**Problem.** Import order is PDF order: `Arms, Tail, Body/Head, Muzzle, Horns, Ears, Feet`. I make the body first. The Parts sheet lists all 7 but is navigation-only — no ▲▼, no drag — and the tab strip order is fixed forever. The checklist has ▲▼ reordering; parts don't.
**Proposal.** ▲▼ (or drag) in the Parts sheet, mirroring `Store.moveChecklistItem`. Also let the import picker reorder sections before Create, since that's where you first see the order.
**Effort** S · **Impact** 2
**Risks.** None; `Part` order is already just array order.

### 19. "Reload from 'Single piece'" silently offers to wipe 12 imported items
**Problem.** The Assembly checklist sheet shows `↻ Reload from "Single piece"` under my 12 imported items. The project was created from the `blank` template (because I picked "From this PDF"), and `blank` has an empty checklist — so that button replaces everything the import found with nothing. There's no confirm text naming the consequence.
**Proposal.** Hide the reload button when the referenced template's checklist is empty. When the New project sheet's "Also save as a template" toggle is used, point `templateId` at the saved template so reload does something sensible.
**Effort** S · **Impact** 2
**Risks.** None.

### 20. Checklist row: the checkbox is the smallest target, delete is the biggest
**Problem.** Measured on the Assembly checklist: `✓` 34×34, `▲`/`▼` 34×40, `✕ delete` **44×44**. During assembly your hands have stuffing and glue on them, and the one control you use constantly is the smallest while the destructive one is the largest and sits at the thumb-side edge.
**Proposal.** Checkbox to 44×44 and make the whole row (outside the text-rename button) toggle done. Collapse ▲▼✕ behind a single ⋯ per row, or only show them in an "Edit" mode toggled at the sheet header. Keep the existing undo toast on delete.
**Effort** S · **Impact** 2
**Risks.** Reordering becomes two taps instead of one — acceptable, reordering is rare and ticking is not.

### 21. A round-map mode in the ⤢ viewer
**Problem.** The 3D piece is lovely and I like watching it grow, but on a 48-stitch round it can't answer the question I actually have mid-round: *where do the increases fall and am I on the right one?* `Patterns.expand` already produces the exact answer (`sc,sc,dec` × 9 for R11) and it's thrown away except as bump widths.
**Proposal.** A segmented control in the 3D viewer sheet: **Piece** (today's model) / **Round**. Round draws a flat ring of `count` cells for the working round, inc cells wider, dec cells notched, the done ones filled, a marker at stitch 1 and a caret at the current stitch. Same data, a 2D canvas, no WebGL. Optionally a compact strip version under the readout on the counter.
**Effort** M · **Impact** 4
**Risks.** Scope creep next to the existing diagram; keep it read-only and derived, no new state.

### 22. Warn when a round needs a part I haven't made
**Problem.** Body/Head R6 is `12sc, Attach tail (3sc through both sides of Tail and into body), 21sc` and R13 attaches both arms. If I start with the body — which is what the counter's part order invites — I hit round 6 with no tail in existence and have to frog or stall. Nothing in the app connects "Attach tail" to the part named Tail.
**Proposal.** At import, scan each section's row text for `attach <word>` / `sew <word> ` where `<word>` matches another section's name, and store `Part.needs = [{ row: 6, partName: 'Tail' }]`. On the counter, when the working round has a `needs` entry and that part isn't finished, show a muted line under the pattern line: `Needs Tail finished — Tail is on rnd 0 of 42` tapping through to it. Also seed the Parts sheet with a suggested make order.
**Effort** M · **Impact** 3
**Risks.** Name matching is fuzzy ("other arm", "both sides of Tail"); keep it advisory, never blocking, and only match whole section names.

### 23. Name the generic colour roles
**Problem.** The Yarn colours sheet says "No colour names found in this pattern yet — the main yarn colours the whole piece", although the pattern says `main color` and `secondary color` on nearly every part and `CC to main color` four times. `Patterns.colors()` returns `{legend:{}, names:[]}` because it only recognises named yarns (Almond, Twilight). So the 3D diagram is monochrome and there's nowhere to record "secondary = mustard, DK, 2 balls".
**Proposal.** Recognise role words — `main colo(u)r`, `MC`, `secondary colo(u)r`, `contrast colo(u)r`, `CC`, `colo(u)r A/B/C` — as colour entries in `Patterns.colors().names`. They already map to `null` in `colorHex`, which is exactly the "app assigns it" case. The Yarn colours sheet then lists Main / Secondary with pickers, and #3's colour chip can show the right swatch.
**Effort** S–M · **Impact** 3
**Risks.** `MC`/`CC` false positives; require the word `colo(u)r` nearby or the token to appear ≥2 times.

### 24. De-duplicate notes in the pattern sheet
**Problem.** Scrolling Body/Head in the pattern sheet, "Stuff body and do NOT fasten off. Continue to head." appears twice (once as loose text after R14, once as R15's attached note), "Attach safety eyes… / Stuff head Firmly" twice around R32/R33, "Fasten off and close hole" twice at the end. The sheet is what you scroll while working; the duplication makes a 33-round part look longer and noisier than it is.
**Proposal.** When rendering, skip a standalone note line whose text is already shown as an attached note on a neighbouring row (normalised compare, ±2 lines). Cheap render-time fix, no parser change.
**Effort** S · **Impact** 2
**Risks.** Legitimately repeated instructions ("Fasten off") get collapsed — restrict to adjacent duplicates only.

### 25. Make-2 in parallel
**Problem.** `Ears 1 of 2 done! Starting ears 2.` is the right model for most people, but plenty of us work both ears (and all four legs) round-by-round together off two balls so they end up identical. Today that means either counting one and trusting memory for the other, or making a second part.
**Proposal.** A per-part toggle **Work all N together** in the part editor. When on, the round counter drives all pieces at once: `piecesDone` stays 0 until the target, the tab badge reads `×2 together`, and completing the last round sets `piecesDone = makeCount` and fires one part-done. Purely a change to `completeRow`'s piece branch.
**Effort** M · **Impact** 2
**Risks.** Niche; make sure the diagram and `rowStitches` semantics (one piece's worth) stay unchanged.

---

## Needs infrastructure (backend or paid service)

Nothing above needs a server; all of it is derivation from data the app already parses. For completeness, the things I wanted that genuinely can't be done under the no-per-user-cost rule:

- **Cross-device continuity.** I count on my phone on the sofa and plan on a tablet. Backup JSON export/import is the current answer and it's a manual file each time; real sync needs a hosted store per user. (A local-network or file-provider sync would dodge the cost but is a big build.)
- **Scanned / image-only PDFs.** Two of my own pattern PDFs are photographs of printed pages; `PdfText` returns nothing. Real OCR means either a service or shipping a multi-MB wasm model — worth a decision, not a quick win.
- **Photo of each finished part attached to the checklist**, surviving a backup. `BlobStore` holds images on-device only and the JSON backup does not include them; a zip export (item 10 in HANDOFF) fixes the backup locally, but sharing a project with a friend still needs hosting.
- **Yarn-stash / shopping integration** (does my stash have enough of the secondary colour) — needs a catalogue nobody ships for free.
