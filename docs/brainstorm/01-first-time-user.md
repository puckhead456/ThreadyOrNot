# 01 — The first-time user

*Persona: a hobby crocheter who tapped a link on her phone, has never seen the app, and has a
panda amigurumi PDF in her downloads. Driven at 375×812 in a real browser, cache cleared, from an
empty localStorage: welcome tour → the panda PDF through New project → first stitches → a finish and
a celebration → settings. Every number below is measured in the page.*

The first five minutes are **warm but slow, and they end with a project that can never finish.** The
empty state is charming and the copy throughout is the best-written thing here — but the welcome
"2-minute tour" is 21 steps, the New project sheet is 1,340 px of scroll before a PDF and 2,604 px
after (window: 612 px), and the PDF drop zone — the feature the home screen sells — sits 884 px down,
below a 274 px emoji grid. The import itself is the magic moment: 3 pages read in a few seconds,
seven parts with their rounds already in them. Then it quietly hands me seven parts with
`targetRows: null`, so there is no progress bar, no part-done, and — because a project only completes
when at least one part has a target — **no celebration is reachable at all from a PDF import.**
What would make me install it: the stitch button, the 3D piece growing, and the pattern line. What
almost made me abandon: dropping the wrong PDF and getting "Read 22 pages · 4,393 characters" and
nothing else. What stopped me telling a friend: after the celebration there is nothing to keep, and
nothing anywhere ever offered to put it on my home screen.

---

## Proposals, ranked by impact ÷ effort

### 1. Imported patterns never get a target row count · S · Impact 5
**Problem.** I dropped `crochet-panda.pdf` into New project and got 7 parts. Every one came out
`targetRows: null` (`Body ×1 target:null`, …), even though opening the part editor on Body shows the
app already knows: *"20 rows (up to 20) · stitch counts found"*. Consequences I hit in order: the big
counter has no progress bar and no "12 / 20"; no part ever reports done; and per `Store.tapRow`, a
`projectDone` needs at least one part with a `targetRows`, so **the celebration — the app's signature
moment — is unreachable on a PDF-imported project** until I hand-edit all seven parts. There is no
"Apply detected settings" button on this path either (it only appears when there is a repeat
suggestion).
**Proposal.** In `Store.importPatternSections` (`js/store.js:1698`), for each section run
`Patterns.summary(sec.text)` and set `targetRows = suggestions.targetRows || maxRow` when `maxRow >= 2`
and the rows are contiguous-ish. Show it in the picker row meta — `20 rows → target 20` — so it is
visible and correctable, and in the part editor put a one-tap chip under the blank TARGET ROWS field:
"Set to 20, from the pattern".
**Risks.** A section whose last row is a finishing note could over-set the target; the part editor
field stays editable and `resetPart` is unaffected, so the blast radius is one number.

### 2. Nothing anywhere offers to install it to the home screen · S · Impact 5
**Problem.** `grep -rn "beforeinstallprompt" js/ index.html` returns nothing. For a PWA whose entire
value proposition is "lives on your phone next to your hook and works offline", there is no install
bar, no iOS "Share → Add to Home Screen" hint, and the only mention of offline anywhere is the About
line at the bottom of a 4,190 px settings sheet: *"everything stays on this device."* I finished a
whole project in a browser tab and was never told the app could be an app.
**Proposal.** Capture `beforeinstallprompt`, stash it, and show a dismissible bar on the home screen
after the first completed row (not on first paint — earn it): "Add Thready or Not to your home screen
— it works with no signal." Tap → `prompt()`. On iOS Safari the event never fires, so detect
`navigator.standalone === false` + iOS UA and show the same bar with the Share-sheet instruction and a
small illustration. Remember the dismissal in `Settings`.
**Risks.** One more first-run interruption; gating it behind a completed row keeps it out of the first
30 seconds.

### 3. The suggested checklist is mostly broken fragments, all pre-ticked · S · Impact 4
**Problem.** The panda import pre-ticked five items and wrote all five into the project:
`Stuff head and sew to` (cut mid-sentence), `Stuff hand. (6)` (a stitch count leaked in),
`Sew arms to body on rnd 19` (good), `join with sl st in first st` (not an assembly step, lower-case
fragment), `Sew eyes 6 sts apart on rnds 10-14` (good). Two of five are usable. I accepted the
default, and my assembly checklist now contains "join with sl st in first st".
**Proposal.** In `Store.suggestChecklist`, reject a candidate that (a) ends in a preposition or
conjunction (`to`, `and`, `with`, `on`, `in`, `for`), (b) starts lower-case, (c) is under three words,
or (d) is a row-note that already lives on a part. Strip a trailing `(N)` / `(N sts)`. Anything that
survives only on a weak rule renders **unticked** rather than ticked. Better to offer two good items
than five with three wrong.
**Risks.** Fewer suggestions on sparse patterns — fine; the user can add items by hand and the sheet
already invites it.

### 4. The welcome "2-minute tour" is 21 steps · S · Impact 4
**Problem.** "Take the tour" runs `home` (4 steps) → a handoff card → `counter` (12 steps) → another
handoff → `import` (5 steps). Twenty-one cards before I have made anything of my own. Two of the four
home steps are `fallback: 'center'` cards describing things that do not exist yet on an empty first
run ("Once you start a project it shows up here…"), which is the right engineering and the wrong first
impression — I am reading about a screen I cannot see. And it ends by asking whether to delete the
sample sheep, after which the home screen is empty again: 21 steps, nothing to show.
**Proposal.** Split `counter` into `counter-basics` (5 steps: part tabs, row counter, stitch button
with the Try-it, pattern line, Undo) and `counter-more` (the rest: groups, alerts, placing, timer,
awake, 3D, ⋯). First run chains `counter-basics` only and finishes on the sample sheep with "Keep it
and carry on, or start your own →". Skip the `home` tour on an empty install entirely — offer it from
Settings, or auto-offer it after the first project exists, when its targets are real. Keep every
existing step; this is routing, not rewriting.
**Risks.** None to the copy; `Tour.list()` grows by one row in Settings.

### 5. The import picker will not let me say "make 2" · S · Impact 4
**Problem.** The panda gave me `Arm`, `Leg`, `Ear`, `Eye` — all ×1. I need two of each. The PDF never
writes "(make 2)": the extracted text says *"Sew arms to body on rnd 19."*, *"Sew ears on rnds 5-10"*,
*"Sew eyes 6 sts apart"* — plural nouns, no header count, so the parser is right to leave it at 1.
But the import row (`.imp-item` = checkbox + name input + meta) has **no make-count control at all**;
`js/app.js:3381` only *prints* `×N` when the parser already found one. So the one thing I know and the
app does not, I cannot tell it — I have to save, then open four part editors.
**Proposal.** Put the existing `stepper(1, 99, 'make count')` (already used at `js/app.js:2505` and
`:2794`) into each `.imp-item`, right of the name. Seed it with a cheap heuristic: if the section's own
placement prose or the assembly block refers to the part in the plural ("sew **arms**", "position
**legs**"), default the stepper to 2 and mark the meta `×2 · guessed`. The stepper makes the guess
safe, because it is one tap to undo.
**Risks.** A wrong guess of 2 doubles the work shown; the visible `guessed` tag plus the stepper
covers it. Wire the stepper first and ship the heuristic separately if it needs tuning.

### 6. The home empty state tells me to drop a PDF and is not a drop target · S · Impact 4
**Problem.** `#home-empty` reads *"Have a pattern PDF? Drop it into New project and the parts set
themselves up."* — and `#home-empty .dz` does not exist. On desktop my instinct was to drop the file
onto that sentence; nothing happens. The same block says *"Start a blanket, a blobby sheep, or a whole
dragon"*, so nothing on the first screen reveals that the app also does cross-stitch and sewing — that
fact lives at the bottom of Settings, 4,190 px down, under CRAFTS.
**Proposal.** (a) Make the whole empty-state card a drop target: a dropped PDF opens New project with
the file already read and the sections listed — one gesture from cold open to a parsed pattern.
(b) Replace the sentence with three tappable chips — 🧶 Crochet · 🧵 Cross-stitch · 🪡 Sewing — that open
New project with the craft preselected. The mascot and the "No projects yet" line stay.
**Risks.** Three chips on the first screen slightly dilute the single "New project" CTA; they are
smaller and secondary.

### 7. A PDF that yields nothing looks exactly like a success · M · Impact 5
**Problem.** I dropped `xs-pacman.pdf` into the crochet New project sheet (an easy mistake — the craft
picker sits *above* the drop zone and defaults to Crochet). The result line read
**"Read 22 pages · 4,393 characters"**, the drop zone returned to its idle state, and *nothing else
changed*: no "From this PDF" card, no sections list, no checklist, no warning, no toast. A confident
success message attached to a complete dead end, with no hint of what to do next and no way to clear
the file and start over.
**Proposal.** When `Patterns.splitSections` returns no section with rows, swap the success line for a
warning block: "We read 22 pages but found no rows or rounds in them." + the two likely causes
(scanned images, or a chart rather than written instructions) + a **"Paste the text yourself"** button
that expands the textarea pre-filled with the extracted text (it is already in memory, and the user
can then delete the junk) + a **"Clear this PDF"** link. When the extracted text matches another
craft's signature — a DMC/Anchor colour key, or a cutting list with fabric widths — add
"This looks like a cross-stitch chart. Switch the craft to Cross-stitch?" as a one-tap action that
flips the craft segment.
**Risks.** The craft sniff must be conservative (a DMC code *and* a symbol column, not the word "DMC");
a wrong suggestion is worse than none.

### 8. New project makes me scroll past 274 px of emoji to reach the feature it advertises · M · Impact 5
**Problem.** Measured in the sheet body (612 px tall): total content **1,340 px** before a PDF and
**2,604 px** after — 2.2 and 4.3 screenfuls. Order is Name → Emoji → Craft → Template → PDF → Count →
Group size → Notes. The emoji grid is 26 tiles, **274 px tall** (20 % of the whole sheet), sitting at
y 281–555 so it owns the entire first screenful under the name. The PDF drop zone — the thing the home
screen just told me to use — starts at `offsetTop 884`. The irreversible decision (craft, "it cannot
be changed later") is a 54 px segment in the middle with no explanation of the consequence.
**Proposal.** Reorder to: **Craft** (with the one-line "this cannot be changed later" under it) →
**PDF / paste** → **Name** (placeholder already takes the PDF file name — it does, nicely) →
**Template** → then a single collapsed **"More options"** holding emoji, rows/rounds, group size and
notes, with the chosen emoji shown as a 44 px button beside the name field so it is still one tap.
That puts every decision a first-timer actually makes on the first screenful, and the sections list
lands directly under the drop zone where it belongs.
**Risks.** Hiding rows/rounds behind a disclosure matters for blanket-vs-amigurumi people; the template
card already sets it, and it is one tap away.

### 9. With no pattern, the counter never offers to take one · S · Impact 3
**Problem.** Made "Doris" from the Sheep template with no PDF. `#pattern-line` is `hidden`, the layout
closes up neatly, and the screen offers no route to add a pattern at all. The only ways in are ⋯ →
Import pattern, or tapping the *already-active* part tab a second time — a gesture I only know because
the tour told me.
**Proposal.** When the active part has no `patternText`, render the pattern-line slot as a muted,
dashed, 44 px row: "＋ Add your pattern" → opens the Import pattern sheet for that part. Costs one row
of a screen that has spare height in exactly that state.
**Risks.** None; it occupies space the hidden element already reserved.

### 10. The tour describes the stitch button's gesture wrongly · S · Impact 3
**Problem.** Counter tour step 3 of 12: *"Tap anywhere on it to count a stitch — **it fires the moment
your finger lands**, and **a drag counts as a scroll** instead."* Both halves are wrong. Per the UX
rules and the code, `pointerdown` counts nothing and `pointerup` counts one stitch if the pointer moved
under 12 px; and a drag past the tolerance **spins the 3D piece**, it does not scroll. This is the most
important step in the most important tour, and it teaches a wrong mental model of the app's core
gesture — a user who believes "it fires on touchdown" will read the lift-off latency as lag.
**Proposal.** "Tap anywhere on it to count a stitch — it counts as you lift your finger, so a slip
never counts twice. Drag instead of tapping and you spin the piece around rather than counting."
**Risks.** None. One string in `js/tour.js`.

### 11. The checklist offers to delete itself · S · Impact 3
**Problem.** A project created from the "From this PDF" card is created from template `blank`, so the
Checklist sheet shows **"↻ Reload from "Single piece""** — and "Single piece" has an empty checklist.
Tapping it replaces my five imported assembly items with nothing. It is the most prominent action at
the bottom of the sheet, right next to "Clear all".
**Proposal.** Hide the reload row when the source template's checklist is empty. When it is not, make
the confirm say the arithmetic: "This replaces your 5 items with the 8 from Sheep."
**Risks.** None.

### 12. The project I just finished vanishes behind a collapsed shelf · S · Impact 3
**Problem.** Celebration → "All parts done! 🎉" → back to home, which now reads
*"Nothing on the hook right now — everything you have made is on the shelf below."* and a **collapsed**
`▸ Finished shelf (1)`. The one thing I have ever made in this app is invisible thirty seconds after
making it. (The empty-state copy itself is the L8 fix and is good — it is the collapse that deflates.)
**Proposal.** Auto-expand `#home-finished` when there are no active projects, and keep anything
finished in the last 7 days as a full card at the top of the list with a "Made it 🎉" pill instead of
demoting it immediately.
**Risks.** None; the section is already collapsible by the user.

### 13. A brand-new install is dark, and no theme says whether it is light or dark · S · Impact 3
**Problem.** Default theme is `stardew-night` — a dark app for someone who opened a link at noon. The
six cards are titled "Pelican Town Spring", "Stardrop Night", "Harvest Festival", "Night Fury",
"Fire & Blood", "Pixel Wyrm" with taglines like *"Plasma blasts and belly rubs"*. Delightful if you
know the references; if you do not, there is no way to tell which one is simply a readable light theme,
and no plain Light/Dark option at all. (Theme switching itself is instant and flawless — 
`data-theme` and `<meta name="theme-color">` both update.)
**Proposal.** On first load only, pick `stardew-spring` or `stardew-night` from
`matchMedia('(prefers-color-scheme: dark)')`. Add a small `LIGHT` / `DARK` tag to every theme card
(the data is already in the contract as `--color-scheme`). Do not rename the themes — the taglines are
half the charm — just label them.
**Risks.** Owner may want Stardrop Night as the deliberate brand first impression; if so, keep it and
ship the tags alone.

### 14. Settings shows me three crafts' worth of everything · S · Impact 3
**Problem.** The Settings sheet is **4,190 px** of scroll in a 679 px window — six screenfuls. It
contains 9 built-in template cards (6 of them for crafts I have never opened), **19 FAQ rows** of which
12 are cross-stitch and sewing ("What does 'over 2' mean?", "My pattern is a quilt. Where are the
block counters?"), and 6 tours. The CRAFTS section that would actually explain the app is the *last*
thing above About.
**Proposal.** Filter the Templates list and the Common-questions list to crafts the user has a project
in (default crochet on a fresh install), with a "Show all crafts" toggle at the end of each. Move the
CRAFTS block up to just under THEME on an install with fewer than two projects. The FAQ answers
themselves are excellent — this is purely about how many of them a beginner has to wade through.
**Risks.** A user who is *about* to start cross-stitch will not see its FAQ; the toggle handles it.

### 15. The finish has nothing to keep and nothing to share · M · Impact 4
**Problem.** The one screen a first-timer would show a friend is the finish, and it is a sheet reading
*"Mochi the panda is off the hook. Time for assembly."* with a single "Assembly checklist →" button.
The app is holding the elapsed timer, `history` (one entry per completed row, capped at 500), the part
count and the theme's celebration art, and uses none of it.
**Proposal.** Put the numbers on the finish sheet — "7 parts · 84 rounds · 6 h 12 m" — and add
**"Save a card"**: render a 1080×1350 canvas in the current theme with the mascot, the project emoji
and name, those three numbers, and hand it to `navigator.share({ files })` with a `<a download>`
fallback. Pure canvas, on-device, no network, no per-user cost. This is the cheapest thing on this list
that turns a finished project into a recommendation.
**Risks.** Canvas text layout across six themes and two fonts needs care; keep the card to one
centred column and it is a contained job.

### 16. The group readout contradicts the stitch target · S · Impact 2
**Problem.** On the panda's round 1 the stitch section read **"Group 1 of 1 · stitch 0 of 10"** directly
above **"0 / 6"**. Two numbers, "of 10" and "/ 6", six pixels apart, disagreeing about how many stitches
are in this round — because the default group size is 10 and round 1 wants 6. On Doris (no pattern) it
reads "Group 1 · stitch 0 of 10", where "Group" is undefined jargon on the busiest screen with no
explanation until the tour or the FAQ.
**Proposal.** Hide the group readout entirely when the row's target is smaller than the group size
(nothing useful to say), and make the line tappable: a one-line popover "A buzz every 10 stitches so
you can find your place. Change it in the part editor."
**Risks.** Hiding is state-dependent and could look flickery row to row on an increasing amigurumi;
alternatively clamp the displayed group to the row target.

### 17. The pattern sheet prints the last two lines twice · S · Impact 2
**Problem.** Body's pattern ends:
`Rnd 20: Sc in each st around, ≈18` / `leave long end for sewing,` / `fasten off. Stuff body.` /
`leave long end for sewing,` / `fasten off. Stuff body.` — the tail is duplicated verbatim. It is the
first thing I read when I tapped the pattern line to check my work, and it made me distrust the import.
**Proposal.** Trace it in `js/patterns.js`: almost certainly a wrapped-row continuation being both
merged into the row's `text` and re-emitted as its own `note` line. Add a fixture assertion on the
panda that no two consecutive lines are identical.
**Risks.** None; it is a de-duplication at render or a double-emit at parse.

### 18. "Body · Rnd 0 · 0 sts" is what a new project says about itself · S · Impact 2
**Problem.** The home card for a freshly created project reads `Body · Rnd 0 · 0 sts` under an `ACTIVE`
pill. Round zero is not a thing a crocheter counts, and the line reads like a bug report rather than an
invitation. (This is D9 from the September UX sweep, still open.)
**Proposal.** When `row === 0 && stitch === 0 && piecesDone === 0`, render "Not started yet" in place
of the whole summary; keep the existing shape once anything has been counted.
**Risks.** None.

### 19. The PDF drop zone exists for crochet only · L · Impact 5
**Problem.** Selecting **Cross-stitch** in the New project craft picker removes the drop zone entirely
and replaces it with WIDTH IN STITCHES / HEIGHT IN STITCHES / FABRIC COUNT / Aida-Evenweave-Linen — it
asks me to type by hand the exact three numbers the PDF would have told it. Same for Sewing. Yet the
home empty state promises "Have a pattern PDF? Drop it into New project" with no craft qualifier, and
`docs/CRAFTS.md` already exposes `ctx.pdfDropZone` to both craft modules — they just use it from their
own import sheets instead. A cross-stitcher's very first action in the app is therefore impossible, and
she has to create a blank project and go hunting in ⋯.
**Proposal.** Add a `newProjectImport` hook to the craft definition: a craft that implements it gets
the shared drop zone in New project plus a craft-owned results block (cross-stitch: colours found,
grid size, fabric count, page images; sewing: steps, cutting list, size chart) rendered where the
crochet sections list goes, and a `craftData` seed handed to `createProject` on Save. This is the one
L on the list; ranked last on ratio, but it is the largest single gap between what the app promises on
its first screen and what it does.
**Risks.** Real surface area in `js/app.js` plus both craft modules, and each craft's import already
has a review step (confidence banners, "Make steps from paragraphs") that has to fit inside the
creation sheet. A staged version — ship the zone and a "we'll import it right after you tap Save"
handoff into the existing craft import sheet — gets 80 % of the value at M.

---

## Needs infrastructure

Nothing above needs a backend, a paid service or a per-user token cost — every proposal runs against
state already in memory, `localStorage`, `BlobStore` or a canvas. Three adjacent things a first-timer
asked for that **would**:

- **Sync across devices / "I got a new phone".** Today the honest answer is Download backup, and the
  app never nudges the user to take one. A prompt after the first finished project ("Keep a copy?") is
  free and on-device; actual sync is not.
- **Scanned / image-only PDFs.** Two of the fixture-style failure modes are photographs of printed
  patterns. On-device OCR would mean shipping a WASM engine (tesseract ≈ 2–10 MB plus language data),
  which fights the offline-precache budget; a server OCR would be a per-user cost. Worth saying "we
  can't read scans" plainly rather than solving it.
- **Any "send this to a friend" that is not a file.** The share card in #15 is deliberately a local
  PNG through `navigator.share`; a real shared gallery, a public project link or a pattern marketplace
  all need hosting and accounts.
