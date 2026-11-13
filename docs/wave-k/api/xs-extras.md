# API: xs-extras (`window.XStitchExtras`, `js/app-xstitch-extras.js`), wave K

Status: BUILDING (wave K, batch 2). Owner: xs-extras. Feature-detect with
`window.XStitchExtras && XStitchExtras.version >= 1`. CSS: `css/xstitch-extras.css` (theme
variables only; every class starts with `xse-`). Report: `docs/wave-k/xs-extras.md`.

## The fixed contract (BUILD.md "Craft screens are split in two")
```js
XStitchExtras.version                     // 1
XStitchExtras.menuItems(project) -> [{ id, label, icon, hint }]
     // only what applies to this project AND whose engine functions exist on this device
     // (XStitch.*, XSRender.*, Store.*, ShareCard.*); a missing engine = the item is not listed.
XStitchExtras.open(id, project, opts?) -> boolean    // false when the id is unknown / not available
     // opts = { ctx /* the shell ctx: openSheet, toast, render, … */, app /* window.XStitchApp */,
     //          focus? /* see per-sheet below */ }
     // Without opts.ctx the sheet opens with its own <dialog> (same class names as the shell's
     // sheets: .sheet .sheet-inner .sheet-head .sheet-title .sheet-close .sheet-body .sheet-foot),
     // so it works in a test page with no app.js. Focus moves into the sheet, Escape closes it and
     // focus returns to what had it (the shell's showModal path does this; so does ours).
XStitchExtras.close()                     // closes the sheet this module has open (tests)
```

## Item ids, in menu order
| id | label | icon | listed when | needs from the project |
|---|---|---|---|---|
| `pace` | Stitching time and goals | ⏱️ | always (cross-stitch) | `Store.activity(id)`, `Store.pace`; chart / pages / palette for page, colour and total goals |
| `fabric` | Fabric, hoop and frame | 📐 | `XStitch.fabricPlan` and a design size (`design.w/h` or the chart) | `design`, `fabric` |
| `kit` | Floss stash and kit list | 🧵 | `XStitch.kitList` and `Store.profile` and a palette | `palette`, chart counts or `keyCount`; other cross-stitch projects (Store.projects()) |
| `brands` | Other brands and substitutes | 🎨 | `XStitch.convert` and `XStitch.brandTables` and a palette | `palette` |
| `grow` | Watch it grow | 🎞️ | `XSRender.timelapse` + `XSRender.mount` and a chart with at least one done stitch | chart, `progress.done`; `Store.readMarks(id)` when present |
| `framed` | Framed picture | 🖼️ | `XSRender.picture` and `ShareCard.draw` and a chart | chart, `fabric` |
| `print` | Print what's left | 🖨️ | `XStitch.printableHTML` and a chart | chart, `progress`, `parking`, `pages[].region` |
| `join` | Join with other files | 🧩 | `XStitch.joinCharts` and a chart | other cross-stitch projects with a chart; `Store.createProject` |

`opts.focus` (optional deep links): `pace` → `'goals'` scrolls to the goals; `kit` → `{ code, brand }`
highlights that row; `brands` → `{ index }` (a palette index) opens that colour's substitutes.

## What I call on xs-app (all feature-detected on `window.XStitchApp`, per docs/wave-k/api/xs-app.md)
- `XStitchApp.repaint(projectId, { cells: true })` after I change craftData (fabric count from the
  calculator "Use", a goal). Fallback: `opts.ctx.render()`, else `App.render()`.
- `XStitchApp.dataOf(project)` to read any cross-stitch project's normalised data. Fallback:
  `XStitch.normalize(project.craftData, project)`.
- `XStitchApp.picture(project, { size, frame })` for the framed picture. Fallback:
  `XSRender.picture(data, { size, frame })`.
- `XStitchApp.openSheet('fabric')` from the calculator's "Edit fabric" link, when present.

## Where things are stored
- **Goals**: `craftData.goals` (xs-core §0 shape `{ id, kind:'perDay'|'page'|'colour'|'total', n?,
  page?, color?, by?, createdAt }`) when `XStitch.normalize` keeps that field (probed once);
  otherwise, until it does, `Store.setGoal(projectId, …)` with `kind:'perDay'` (n) or
  `kind:'byDate'` (`until` = the date, or 9e14 = "no date") and `label: 'xs:<kind>:<arg>'`
  (`xs:total`, `xs:page:3`, `xs:colour:5`). Progress always comes from `XStitch.goalProgress`.
  One undo step per add / remove either way.
- **Per-project length unit** (the calculator's in / cm switch): craft setting
  `Store.craftSettings('crossstitch').extrasUnits = { [projectId]: 'in'|'cm' }`; default the
  profile's `units.length`, else inches (charts print sizes in inches).
- **Owned floss**: the profile (`Store.setFlossOwned`), never craftData. The kit list's allocation
  is computed every time (`XStitch.kitList`), never stored.

## Events I fire (on `document`)
- `xse:changed` `{ detail: { projectId, what: 'goals'|'fabric'|'stash'|'join' } }` after a write.
- `xse:closed` `{ detail: { id } }` when one of my sheets closes.

## Test hooks (test/xstitch-extras.test.html only)
`XStitchExtras.__test = { pure helpers (kept current below), lastSheet() -> { id, root } | null }`
- `fmtDate(ms)`, `approx(text)`, `parseLength(text, unit) -> { value, unit } | null` (accepts
  "5 cm", "2 in", "2\"", "50 mm", plain numbers in the current unit), `toUnit(inches, unit)`,
  `goalStore(project)`, `orderFromChunks(chunks, n) -> Int32Array | null`,
  `shoppingText(kit, title) -> string`, `storageLine(report) -> string`.
