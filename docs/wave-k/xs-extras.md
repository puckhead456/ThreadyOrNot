# Wave K — xs-extras report (`js/app-xstitch-extras.js`, `css/xstitch-extras.css`, `test/xstitch-extras.test.html`)

Status: all eight sheets built; suite green. Nothing committed. API: `docs/wave-k/api/xs-extras.md`.

## Suites
| suite | baseline (before my first edit) | now |
|---|---|---|
| `test/xstitch-extras.test.html` (new) | n/a | **114 / 0** (headless, ~0.6 s; no IndexedDB loaded) |
| `test/xstitch.test.html` | 1103 / 0 | 1109 / 0 (xs-core's additions; I edit no engine file) |
| `test/xstitch-render.test.html` | 61 / 0 | not touched by me |

Run: `bash tools/headless-suite.sh xstitch-extras.test`.

## What the user sees (⋯ menu items, in order) — done / partly / not done
| # | item (id) | status | what is on it |
|---|---|---|---|
| 5 + 21 | ⏱️ Stitching time and goals (`pace`) | **done** | Today / this week / streak / ≈ stitches an hour; a 7-day bar strip (labelled for screen readers); "≈ between March and June 2027 … an estimate, not a promise" only after 5 sessions, else "appears after 5 sessions (N so far)"; ≈ a day on days you stitch; last stitched; session lines (`XStitch.sessionLines`); goals (per day, a page, a colour, the piece, optional date) with progress bars; a dated goal shows "≈ N a day" and a **Use ≈ N a day as a daily goal** button — it only becomes a target with that tap. Remove (one undo step). Data from `Store.activity` / `Store.pace` (shell-data), never XStitch. |
| 17 | 📐 Fabric, hoop and frame (`fabric`) | **done** | Count, over-two, margin (framing / hoop / my own: "5 cm", "2 in", "2\"", "50 mm" all accepted), inches / cm switch remembered per project; ≈ stitched size, ≈ cut size, fat eighth / quarter / half yard fit with ≈ spare, hoop, Q-snap, frame + ≈ mat opening; "Will it fit my frame?" for 9 counts. Changing the count changes nothing until **Use 18-count for this project**. |
| 15 | 🧵 Floss stash and kit list (`kit`) | **done** | Per colour: need ≈ N · you have N (profile stash) · N set aside for <other WIP> · buy N; −/+ edits the one stash (`Store.adjustFloss`), focus kept; "only what is left", "this project gets first pick" (default: other WIPs first, per the proposal); plain-text shopping list (≈ marked) with Copy / Share. Allocation computed every time (`XStitch.kitList`), never stored. |
| 16 | 🎨 Other brands and substitutes (`brands`) | **done, DMC only** | Lists the colour tables on the device with licence. With only DMC (the shipped state) it says plainly: "Only the DMC list is here … the app does not guess Anchor or Madeira matches yet." Per colour, "I am out of this" shows the 3 nearest in my stash, each "≈ close match · you have 2", and "Suggestions only: the chart keeps DMC 321". **Nothing is ever swapped.** If a table is ever registered (`XStitch.registerBrandTable`), conversions appear as "As <brand>: code · ≈ close match". Kept in the menu because the stash substitutes work without any other table. |
| X3 | 🎞️ Watch it grow (`grow`) | **done** | `XSRender.mount` + `timelapse`: Play / Pause, a labelled scrubber, the date being shown, Save this frame, Save a video where `canRecordVideo().ok` (else it says so). Order from `Store.readMarks` (shell-data's mark log); with no log, `tl.fallback` and the sheet says "Not your real order … a made-up order, not your history." Listed only when at least one stitch is done. Renderer destroyed on close. |
| X4 | 🖼️ Framed picture (`framed`) | **done** | In a hoop / mat and frame / just the stitching; "Card with the name" (ShareCard 1080 px, picture via `XStitchApp.picture` else `XSRender.picture`) or "Picture only" (2048 px); Share or save through `ShareCard.share`. |
| 19 | 🖨️ Print what's left (`print`) | **done** | The one total, "N of M printed pages still have stitches to do", options: shade done (hatched), only pages with stitches left, keep printed page numbers (p9 is p9), parked threads, key on every page, overlap 0–3, colour / B&W → `XStitch.printableHTML` in a new tab, else a blob link in the sheet. |
| 18 | 🧩 Join with other files (`join`) | **done (UI)** | Pick the other part projects; layout from `XStitch.quadrantLayout` (names tl/tr/bl/br, else two to a row) drawn as a labelled map with the joined size before joining; "Make the joined project" → `XStitch.joinCharts` → `Store.createProject` (originals untouched, overlap conflicts reported); a storage line from `Store.storageUsage` ("On this device: … ≈ 3% of the space the browser allows …"). Joining runs once on the main thread (one-off, with a "Joining…" status). |

Feature detection: every item checks its engine functions (`XStitch.*`, `XSRender.*`, `Store.*`, `ShareCard.*`) and is simply not listed when one is missing (asserted for `XSRender.timelapse` and `XStitch.kitList`).

## Accessibility
Sheets use the shell's `ctx.openSheet` when given (asserted: title, class, subject), else an own `<dialog>` with the same classes: focus moves to the close button, Escape closes, focus returns to the opener (asserted). Toggle groups are `aria-pressed` buttons with a labelled group; bars are `role=progressbar`; the day strip and join map are `role=img` with text labels; a polite live region speaks results.

## Verified where
- Headless suite (all numbers and DOM above), themes Stardrop Night, Pixel Wyrm (`dragon-pixel`) and Stardrop Spring: theme variables resolve (asserted), no hard-coded colours in the CSS.
- Looked at every sheet at **375 × 812** (pace, brands, grow, join in Stardrop Night; fabric, framed in Pixel Wyrm; kit, print in Stardrop Spring) and pace at **375 × 640** (Pixel Wyrm), headless, through the test page's phone frame: `test/xstitch-extras.test.html?phone=375x812&demo=<id>&theme=<theme>` (headless Chrome cannot make a window under 500 px, hence the iframe; `&widths=1` lists anything wider than the screen). No horizontal overflow; segmented controls wrap. Fixed from looking: the day strip's bars did not draw (percent height in a flex item), flex items shrinking in the sheet body, the storage line printing "null bytes", "1 other project take their share", and the sheet opening scrolled to a control (focus now goes to ✕, as the shell's sheets do).
- The time-lapse canvas is blank in headless screenshots: XSRender's shader compile is asynchronous and never finishes under virtual time (`getStats().compiling` stays true). The replay logic is asserted (fallback label, seek, play / pause); the picture itself needs one look in a real tab. Desktop width not looked at.

## Decisions taken (coordinator may overrule)
- **Goals storage**: `XStitch.normalize` drops `craftData.goals` today, so goals go to `Store.setGoal` (perDay → `perDay`; page / colour / total → `byDate` with `until` = date or 9e14 for "no date", `label: 'xs:page:3'`). If xs-core keeps `craftData.goals` later, the sheet switches to it automatically (probed). Progress always via `XStitch.goalProgress`.
- **Unit switch** lives in the craft settings bag `extrasUnits[projectId]` (craftData has no field for it); default the profile unit, else inches.
- Kit list: other WIPs take their share first by default (proposal text); one tick gives this project first pick.
- Fabric sizes are shown with ≈ (fabric counts vary in practice); hoop / frame sizes are product sizes, not ≈.

## For the owner of `js/app-xstitch.js` (xs-app)
- List `XStitchExtras.menuItems(project)` in ⋯ and call `XStitchExtras.open(id, project, { ctx, app: XStitchApp })` (already your contract).
- I call, feature-detected: `XStitchApp.repaint(id, { cells })`, `XStitchApp.dataOf(p)`, `XStitchApp.picture(p, { size, frame })`. All have fallbacks.
- For a real "Watch it grow" history, call `Store.logMarks(id, [[cell, 1|0], …])` on every mark / unmark (and `XStitch.markDiff` after bulk marks / undo); without it the replay is honestly labelled "not your real order".
- `Store.counted({ projectId, n, unit: 'stitch', part: 'DMC 310' })` after each mark feeds the pace sheet.
- Your old Fabric & size sheet still says "with a 3 in margin all round"; the calculator is the fuller version, you may link to it (`XStitchExtras.open('fabric', p)`).

## For the owner of `js/xstitch.js` (xs-core)
- Keep `goals` in `normalize` as your §0 promised (only when present); my sheet then stores goals in craftData without any change on my side.

## Left
- One look in a real tab at "Watch it grow" (the GPU picture) and at desktop width.
- Done since: while XSRender compiles (~2 s cold) the replay says "Getting the picture ready…" (asserted).
- No reorder control in Join beyond names / pick order.
