# API: sew-extras (`window.SewingExtras`, `js/app-sewing-extras.js`), wave K

Status: BUILT (wave K, batch 2). Owner: sew-extras. Feature-detect with
`window.SewingExtras && SewingExtras.version >= 1`. CSS: `css/sewing-extras.css` (theme variables
only; every class starts with `swx-`). Report: `docs/wave-k/sew-extras.md`.

## The fixed contract (BUILD.md "Craft screens are split in two")
```js
SewingExtras.version                       // 1
SewingExtras.menuItems(project) -> [{ id, label, icon, hint }]
     // only what applies to this project AND whose engine functions exist (Sewing.*, SewQuilt.*,
     // SewFigures.*, BlobStore); a missing engine function = the item is not listed.
SewingExtras.open(id, project, opts?) -> boolean   // false when the id is unknown / not available
     // opts = { ctx /* the shell ctx: openSheet, toast, … (default App.ctx) */, ...per sheet below }
     // Without a ctx the sheet opens in its own <dialog> with the shell's class names
     // (.sheet .sheet-inner .sheet-head .sheet-title .sheet-close .sheet-body), so it works in a
     // test page with no app.js. Focus moves in, Escape closes, focus returns to the opener.
SewingExtras.close()                       // closes the sheet this module has open (tests)
```
`project` may be a project object or a project id.

## Item ids, in menu order
| id | label | icon | listed when | `opts` |
|---|---|---|---|---|
| `board` | Cutting board | ✂️ | `Sewing.cuttingBoard` and at least one cutting row | `{ fabric: groupKey \| 'B' (a letter) }` scrolls to that fabric |
| `quilttop` | Quilt top | 🧩 | `Sewing.quiltTop` and a quilt (kind `quilt`, or units / quilt facts) | `{ block: label }` highlights a block |
| `quiltcalc` | Quilt calculators | 🧮 | `Sewing.quilt` + `Sewing.quiltFacts` and a quilt | `{ tool: 'binding'\|'backing'\|'batting'\|'hst'\|'geese'\|'resize'\|'units' }` |
| `fabric` | Fabric and shopping list | 🛍️ | `Sewing.fabricNeed` + `Sewing.shoppingListV2` | `{ view, all: true }` (`all`: the list across sewing projects) |
| `swatches` | Fabric colours | 🎨 | at least one fabric row | `{ fabric: index }` |
| `timer` | Press and fuse timer | ⏱️ | `Sewing.pressTimer` | `{ step: stepIndex }` (the step's own press / fuse wording) |
| `glossary` | Words in this pattern | 📖 | `Sewing.glossary` and pattern text or steps | `{ term }` |
| `fitting` | Fitting log | 📏 | `Sewing.addAlteration`, and not a quilt | `{ add: true }` opens the new-entry form |

## What I call on sew-app (all feature-detected on `window.SewingApp`; none is required)
- `SewingApp.repaint(projectId)` after I change craftData. Fallback: `ctx.render()`, else `App.render()`.
- `SewingApp.dataOf(project)` → normalised craftData. Fallback: `Sewing.normalize(project.craftData, project)`.
- `SewingApp.chosenSize(project)` → size label. Fallback: `craftData.size.chosen`.
- `SewingApp.currentStep(project)` → step index. Fallback: `craftData.currentStep`.
- `SewingApp.quiltModel(projectId)` → `Promise<{ model: QuiltModel, image: CanvasImageSource|null } | null>`
  (sew-visual's model, if sew-app keeps one from import; sew-app does not provide it yet). Without it the quilt top uses the stored
  layout page as a picture (honest "fills in as a whole"), or the text rows `Sewing.quiltTop` read.

## Where things are stored (all through `Store.updateCraftData`, one undo step per action)
- Cut ticks: `craftData.cutting[i].cutCount`. "Measured right" on a unit: `craftData.units[i].measured`.
- Fabric choices, usable width (WOF), units switch, fuse seconds: `craftData.fabricPrefs`
  (sew-core §3: `width`, `shrinkPct`, `nap`, `view`, `unit:'metric'|'imperial'`, `wof`, `fuseSeconds`).
- Fitting log: `craftData.fitting` via `Sewing.addAlteration`; a photo is a BlobStore blob
  `p:<projectId>:fit:<alterationId>` (the backup carries every `p:<id>:` blob).
- Colour chips the sewist sets: `craftData.swatchColours = { [fabricIndex]: '#rrggbb' }` when
  `Sewing.normalize` keeps that field (probed once); until it does, the craft setting
  `Store.craftSettings('sewing').extrasSwatches = { [projectId]: { [fabricIndex]: '#rrggbb' } }`.
  Captured booklet swatches (`SewFigures.captureSwatches`) live at `p:<id>:swatch:<i>`.

## Events (on `document`)
- `sewingextras:change` `{ detail: { projectId, id /* item id */, what: 'cut'|'prefs'|'fitting'|'swatch'|'unit' } }`
  after every write, so the step screen can repaint without polling.

## CSS hooks
`.swx-sheet` (on the sheet), `.swx-group`, `.swx-row`, `.swx-row.is-done`, `.swx-cut-btn`,
`.swx-approx` (every number the app worked out, prefixed "≈"), `.swx-flag-off`, `.swx-flag-close`,
`.swx-chip` (colour chip), `.swx-timer`, `.swx-list`.
- `SewingApp.captureSwatches(projectId)` → Promise (optional): when present the colours sheet offers
  "Read the swatches from the booklet" and then shows `p:<id>:swatch:<i>` blobs.
