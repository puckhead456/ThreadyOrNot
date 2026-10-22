# Wave G — size groups (`size-groups`)

Owner report (tmp-pdf/crochet-bee-sizes.pdf, the owner's "AmigurumiBeePatterns.pdf"): "It pulled the
pdf in no problem, just only gave me the large pattern instructions lol" and "What would be cool is if
when a pattern like this is imported, it imported each size as its own tab under the pattern?"

Cause: the parser already split the booklet into six sections (Body/Wings × 3), but nothing said which
size each belonged to, and `Store.importPatternSections` matches a section against existing parts **by
name** — so the Medium Body updated the Keyring Body, the Big Body updated that, and only the Big bee was
left. Both halves are fixed: sections carry their size, and a part only ever matches a part of its own
size.

## What the owner sees

- **New project → drop the bee PDF.** The sections list shows three tabs, **Keyring / Medium / Big**
  (underline tabs, arrow keys / Home / End move between them, `role=tablist`, `aria-selected`). Under the
  open tab: an **"Import this size"** tick (all on by default; an unticked size shows "· skipped" and its
  parts dim), then that size's parts with their rows, targets and confidence line, and — new under a size
  tab — the placing notes themselves (the eye placement differs per size). The Wings line says
  "in rows from row 3" for Medium and Big. The **"From this PDF"** template card reads
  "Keyring: Body, Wings ×2 · Medium: Body, Wings ×2 · Big: Body, Wings ×2".
- **The project.** Above the part chips, a size strip with one tab per size and a **⋯** for the open
  size. The chips below are the open size's parts. The counter header reads **"Medium · Body · ROUND"**
  (the size and part, then the word). A finished size gets a ✓ on its tab; its accessible name says
  "Medium size, 1 of 2 parts done".
- **⋯ on a size:** its progress ("0 of 2 parts done · 0 of 41 rows and rounds"), **Make this size a
  template** (opens the template editor with that size's parts as a plain one-size template,
  "Bee (Medium) template"), **Remove this size** (confirm, then a 6-second Undo toast; the last size is
  never removable).
- **Mixed wings.** The Medium/Big Wings count "ROUND" for rounds 1–2 and "ROW" from row 3 (the counter
  label, the pattern-line tag "Row 3", the "Row 3 done" announcement). Counts: 6, 12, 17, 23, 29, 35.
- **Eyes.** The EYES paragraph is no longer pasted into the Body's rounds as notes; it is the Body's
  "Where things go": "Eyes: I try to place the eyes in the 3rd round, 6 stitches appart." (+ the two
  advice paragraphs, each labelled "Eyes:").
- **Finishing.** Finishing the last part of a size (with other sizes still in the project) opens
  **"Keyring size done! 🎉"** — *Finish the project* (undoable), *Go on to Medium* (the next unfinished
  size), *Not now*. Finishing every kept size is the normal "All parts done!" flow. The "Finish anyway"
  list names parts with their size ("Medium · Wings").
- **Home card:** "Medium · Body · Rnd 3 of 17 · 0/18 sts" (the open size), and "just now · **3 sizes**"
  on the meta line. A finished size says "every Keyring part done".
- **⋯ → Parts** lists the parts under a heading per size.
- **Projects without groups:** no strip, no class, the part strip keeps `role=group`; the panda and the
  Wheat Stitch cardigan (size-once) import exactly as before (checked, below).

## Parser (`js/patterns.js`)

`Patterns.splitSections(text)` — every section now has **`group: {name, index} | null`** (null when the
document has no groups). There is no separate `parseSections`; this is the one entry point.

Group signals (`findGroups`, general rules only):
1. A line `"<Title> - <Suffix>"` (also `|` `:`) whose Title is printed with **two or more different
   suffixes**, at the top of a page (running head) or right above a part header
   ("Amigurumi Bee - Keyring / - Medium / - Big").
2. A size word or phrase on a line of its own **with a part header straight under it**: keyring, key
   chain, mini, tiny, small, medium, large, big, jumbo, giant, huge, baby, toddler, child, kid(s), adult,
   regular, standard, petite (+ up to two words: "SMALL BEE", "Large version"), "Size 1", "Version A",
   "Option B", "10 cm bee", "4 inch bee". "Small Wing (make 2)" over its own rounds is a part.
3. **Validation that keeps every other pattern as it was:** the same part header must be printed under
   two different groups, and each kept group must hold rows. "Leg (Make 2):" printed twice with no group
   heading is not grouped; "Bunny - Head / Bunny - Body" running heads (no repeated part) are not groups;
   "Safety eyes - small / - large" in the materials is not a group.

Rules that follow from groups:
- A group heading is page furniture (never a line, header or note) and resets the header queue, so a
  header can never name a part of the next size. (The Medium Body used to end with the running head
  "Amigurumi Bee - Medium" as a note.)
- In a grouped document a line is a running head only when it tops two pages — the same advice printed
  once per size ("Sometimes it takes a bit of guess work…") is not.
- Placement is handed out **per group** (assembly blocks and sentences only reach sections of their own
  size); "same as the first" (`inlineSameAs`) never reaches into another size.
- **Feature paragraphs** (new, general): a heading that is only a placed feature — `EYES`, `Eye
  placement`, `Safety eyes:`, `Nose`, `Mouth`, `Cheeks` — over prose (no rows) that contains a placing
  sentence naming a round/row/stitches becomes placing notes ("Eyes: …") on the section printed above it.
  "Eyes (make 2)" over rounds is still a part; EYES prose that names no round/stitch is left alone.
- **Rounds then rows** (new line field **`workedIn: 'rows'`**): after a note matching "instead of
  crocheting/working in the round" or "crocheting/working in 'rows'", the first row that turns (and is
  not joined) and every row after it in that section are marked. Counts are unchanged arithmetic.
- Label forms "6..Inc", "7.. Inc", "8-11..sc" and the "Colour change to black/yellow" lines already read
  correctly (asserted on the fixture).

`lines.meta` also gains `groups` (names in order), `groupAtLine(i)`, and `sections[].group`.

## Store (`js/store.js`)

Data (all additive with defaults, no backup migration; asserted through a backup round trip):
- **`Part.group`**: the size name or `null`.
- **`Project.groups`**: `[{name}]` in document order (`[]` for a one-size project). Normalisation rebuilds
  it from the parts if a save lost it and drops a size with no parts left.
- **`Project.activeGroup`**: the open size's name or `null`; repaired to the active part's size.
- **`Template.groups`** and **`Template.parts[].group`** — present only when a part has a size, so the
  built-ins and older templates are byte-identical.

API:
- `Store.splitSections(text)` → each section carries `group` (the name, or null).
- `importPatternSections(id, secs, {groups: [names]})` — `groups` limits the import to those sizes
  (omitted = all). Matching (content key, then name) is **within the section's own size**. Parts are
  ordered by size (shared parts first), then document order; the first imported size opens. Returns
  `groups` (the sizes imported).
- `Store.groupProgress(projectOrId, name)` → `{name, parts, partsDone, rows, rowsDone, done, started}`
  (rows count every piece: Wings ×2 is two pieces' rows), `null` for an unknown size.
- `Store.projectGroups(p)`, `Store.groupParts(p, name)` (size's parts + shared ones).
- `Store.setActiveGroup(id, name)` — view state like `setActivePart` (no undo step; a normal write, so
  revision/writerId/multi-tab rules apply); moves the active part to that size's first unfinished part.
  `setActivePart` moves the tab with the part; `addPart` joins the open size (`opts.group` overrides,
  `null` = shared).
- `Store.removeGroup(id, name)` — one undo step; refuses the last size standing; clears the removed parts'
  caches; returns `{removed, activeGroup}`.
- `Store.allPartsDone(p, group?)` (now exported) and `Store.blockingParts(p, group?)` scoped to a size
  (a part with no size counts for every size); unscoped in a multi-size project the names read
  "Medium · Wings". `completeRow` emits **`{event: 'groupDone', group, partName}`** when a part finishes
  its size and other sizes are open; `projectDone` when every kept part is done; `finishProject` still
  refuses while any kept size is open (Finish anyway / the groupDone sheet force it).
- `deletePart` stays in the part's size and drops a size whose last part went.
- `templateFromProject(id, {group})` — that size alone, as a plain template named "<project> (<size>)
  template"; without it the draft carries `groups` and each part's `group`. `saveTemplate` keeps
  `groups` when an edit does not mention them; `createProject` copies `Part.group` and `Project.groups`.
- `Store.rowWorkMode(prt, row, proj?)` → `'rounds'|'rows'` for one row (`workedIn`), the explicit
  Worked-in chip still wins for the whole piece.

## App (`js/app.js`, `css/app.css`; `index.html` unchanged)

`renderSizeTabs` (the strip, inserted before `#part-tabs`, which becomes its `tabpanel` with
`aria-labelledby`), `openSizeMenu`, `showGroupDoneSheet`, `rowModeAt / rowWordAt / shortRowWordAt`,
`groupPrefix`, `sectionsPreview` (also used for template cards), the import picker's
`renderGroupTabs` / `rowsFromOf` (`checkedSections()` skips unticked sizes and carries `group`), the
template editor carries `group` per part (a small size tag) and `groups` on save, New project's "Also save
as a template" carries them. CSS: `.size-tabs`, `.size-tab(.active/.off)`, `.size-tab-more`,
`.row-group-tag`, `.pc-sizes`, `.parts-group-head`, `.imp-place`, and `.project-body.has-sizes` gives
44 px of the big button's floor back so the counter fits.

## Verified in the pane (own tab, 375×812, storage key `ZW1_waveG_sizes`, removed afterwards)

- New project from `tmp-pdf/crochet-bee-sizes.pdf`: three tabs, Body + Wings ×2 in each (targets 10/2,
  17/3, 29/6); toast "Created AmigurumiBeePatterns · 6 parts · placing notes"; size strip
  Keyring / Medium / Big / ⋯; header "Keyring · Body · ROUND". Screenshots taken of the picker and the
  counter.
- Keyring Body with the counter at 4: strip "● Change to black", pattern line "Rnd 5 5. Sc in each st".
- Medium Wings: "ROUND" at rows 1–2, "Medium · Wings · ROW" + "Row 3 3. Ch1, turn (flip project) …" at
  row 3; row-number aria-label "Medium · Wings. Rounds done: 2 …".
- Medium Body "Placing" sheet: the three "Eyes: …" lines.
- Remove this size (Big): confirm sheet, 4 parts left, tabs Keyring / Medium, Undo toast → all six back.
- Finish flow: last Keyring part → "Keyring size done! 🎉" sheet, "Go on to Medium" opens Medium;
  "Finish the project" → finished, Undo → active again.
- Make this size a template: editor "AmigurumiBeePatterns (Medium) template", Body + Wings ×2, pattern
  attached. 3D viewer opens on a group part with its chips (Rounds/Rows, orientation, Terms).
- Keyboard: End on the first size tab opens Big and focuses it; picker tabs ArrowRight likewise.
- Home card "Medium · Body · Rnd 3 of 17 · 0/18 sts" / "just now · 3 sizes".
- Panda (no groups): Body/1/20, Head/1/21, Arm/2/11, Leg/2/9, Tail/1/3, Ear/2/5, Eye/2/2, no strip,
  `#part-tabs` role=group, label "ROUND", overflow 0. Wheat Stitch cardigan (size-once, picked 1X): 7
  parts as before, label "ROW · 1X", no strip, overflow 0.
- Counter height at 375×812: 0 px overflow on ordinary rows with the strip. The Medium Wings row 3 (a
  three-line instruction plus two notes) overflows 22 px; 11 px of that is the same row without any size
  strip (pre-existing long-row case), so the body scrolls a little there.
- No console errors (only `navigator.vibrate` blocked for synthetic clicks).

## Suites (all after the last edit)

| suite | before | now |
|---|---|---|
| patterns | 1009 | **1032 / 0** (+23; one wave A test now expects `group: null` on the bare section) |
| patterns.fixtures | 797 | **829 / 0** |
| patterns.fixtures `?heavy=1` | 812 | **844 / 0** (bee-sizes entry + pumpkins groups) |
| templates | 133 | **147 / 0** |
| store-safety | 236 | **266 / 0** |
| crafts | 124 | 124 / 0 |
| diagram-model | 529 | 529 / 0 |
| backup | 205 | 205 / 0 |
| diagram (+ reference fixtures) | 242 | 242 / 0 |
| sw / pdftext / sewing / xstitch | 27 / 86 / 882 / 700 | 29 / 97 / 963 / 752, all 0 failed (as found) |

## Decisions and things left

1. **Wing counts: 17 / 23 / 29 / 35, not 18 / 24 / 30 / 36.** The brief asked for row 3 = 18 … row 6 =
   36. The PDF prints no counts; its words are "(Inc, sc) x5, inc" = 5×3 + 2 = **17**, "(inc, 2sc) x5,
   inc, sc" = 5×4 + 2 + 1 = **23**, then 29 and 35. The pattern is self-consistent at those numbers: each
   row consumes exactly the stitches of the one before (row 3 works 11 of round 2's 12 — "Do not crochet
   in the st with st marker" — and row 4 works 5×3 + 1 + 1 = 17, row 5 5×4 + 1 + 2 = 23 …). 18 would need
   x6. Asserted as 17/23/29/35; the coordinator may want to confirm against the photos.
2. **King Cole pumpkins changed shape (for the better):** "Small / Medium / Large Pumpkin" headings over
   "Pumpkin Body" + "Stalk" are now three size groups, and the Medium/Large bodies are named "Pumpkin
   Body" (they used to be named after the group heading, "Medium Pumpkin"). Fixture expectation updated
   with the reason; each Stalk keeps its own "Sew stalk to top centre" note.
3. **Old bee projects** (imported before this wave as one ungrouped "Body"/"Wings") are not migrated; a
   re-import adds the three sizes beside them. Deleting the old parts is the owner's call.
4. The **3D model draws the mixed wings as a round piece** throughout (the counts are right; the shape
   after row 3 is not flat). `line.workedIn === 'rows'` / `Store.rowWorkMode` is there for the 3D owner.
5. Swiping the part strip sideways to change size is not done; the size strip scrolls sideways and the
   keyboard works. A size cannot be renamed or a part moved between sizes in the part editor yet.
6. Noticed, not fixed (out of scope, pre-existing): a part header without a colon printed directly after
   a counted round ("Rnd 2: inc x6 (12)" / "Leg (make 2)") is read as a note, so the next rounds open an
   unnamed part. Real PDFs in the corpus are unaffected; "Leg (Make 2):" works.

## Follow-up (coordinator round 2)

- **Wing counts confirmed** 17 / 23 / 29 / 35 (item 1 above is closed).
- **Item 6 fixed — part header with no colon after a counted round.** The cause was not the missing
  colon: "Leg (make 2)" printed twice is three words, so `findRunningHeads` counted it as a "wordy"
  repeated line, i.e. a running head, and both copies became notes. New rule (`startsPart`, general):
  a line of at most four words that is a part header by shape and either names a piece (`PART_NOUN_RE`:
  head, body, arm, leg, ear, eye, tail, wing, foot, hand, paw, horn, …, sleeve, cuff, stalk, motif,
  square, panel) or carries a make-count ("(make 2)", "x2"), with round 1 on the next line, is never a
  running head — it starts a section. Unit assertions: "Leg (make 2)" after "Rnd 6: sc around (18)"
  with and without the colon (Head / Leg ×2 / Body / Leg ×2), "Arms x2", and "Stuff firmly" printed
  the same way stays a note in the part above it and names nothing.
- **Item 6 of the pane check fixed — Medium Wings row 3 overflow.** The turning row now gets the same
  one-line strip as a colour change: "↻ Turn · rows from here" (aria "Turn: worked in rows from this row
  on"). When a row has both, they share the strip on one line ("● Change to black ↻ Turn · rows from
  here", 27 px, checked on a synthetic part). The switch sentence ("Now instead of crocheting in the
  round…") is dropped from that row's notes because the strip says it, and below 860 px of height the
  notes under an instruction clamp to two lines (one when the strip shows; the full text is in the
  pattern sheet). Measured at 375×812: **0 px overflow** on Medium Wings row 3 and on Keyring Body with
  the counter at 4 ("Change to black").
- Suites after these edits: patterns **1037 / 0**, patterns.fixtures **829 / 0**, heavy **844 / 0**,
  templates 147 / 0, crafts 124 / 0, store-safety 266 / 0.

## For the owner of `sw.js`
- `js/app.js`, `js/store.js`, `js/patterns.js`, `css/app.css` changed: regenerate the cache hash.

## For the owner of `js/diagram*.js` (3D)
- Parsed lines may carry `workedIn: 'rows'` (rows after a rounds→rows switch); `Store.rowWorkMode(prt,
  row)` resolves it with the owner's chip. The live piece / viewer could flatten from that row.

## For the docs agent (HANDOFF / SPEC)
- Contract above: `section.group`, `line.workedIn`, `Part.group`, `Project.groups`,
  `Project.activeGroup`, `Template.groups`, the Store functions and the `groupDone` event.
