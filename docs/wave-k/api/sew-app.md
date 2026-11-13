# API: the sewing step screen (wave K, sew-app worker)

Status: BUILT (batch 2, 2026-11-12). File: `js/app-sewing.js` (`window.SewingApp`), styles `css/sewing.css`.
`window.SewingApp` exists once `js/app-sewing.js` has registered the craft (it needs `App`,
`Sewing` and `Store`; without them nothing is defined). Feature-detect every name.

Callers: the sew-extras worker (`js/app-sewing-extras.js`, `window.SewingExtras`) and the
galleries worker (`test/sewing-app.test.html`).

## Hooks for sew-extras and galleries

```js
SewingApp.version                    // '1.0.0'
SewingApp.currentProject() → Project | null   // the sewing project on screen (null on home / another craft)
SewingApp.size(project?) → ''|'42'           // the chosen size (craftData.size.chosen), '' when none
SewingApp.units(project?) → 'metric'|'imperial'   // the project's unit switch (craftData.fabricPrefs.unit),
                                             // else the pattern's own units, else the profile's
SewingApp.currentStep(project?) → number          // the step index (sew-extras' contract), 0 when none
SewingApp.chosenSize(project?) → ''|'42'          // same as size()
SewingApp.dataOf(project?) → normalised craftData | null
SewingApp.stepInfo(project?) → { index, step, where, setup, units:[unit], activeUnit } | null
     // where: 'Step 4 of 6'; setup: Sewing.stepSetup(step.text, craftData) (or null);
     // units: Sewing.unitsForStep; activeUnit: Sewing.activeUnit(craftData) ({unit, index} | null)
// The app listens for sew-extras' `sewingextras:change` event on document and repaints itself;
// repaint() and the event coalesce into ONE paint per tick.
SewingApp.quiltModel(projectId) → Promise<{ model: QuiltModel, image: HTMLImageElement|null, revoke?() } | null>
     // kept at import (a quilt with a layout page the text names): SewQuilt.fromShapes on that page,
     // else SewQuilt.pictureModel of the whole page; JSON at BlobStore 'p:<id>:quiltmodel'.
     // image = the stored page image (when the pages were kept); call revoke() when done with it.
SewingApp.captureSwatches(projectId) → Promise<[SwatchBitmap]>
     // the booklet's swatches captured cleanly at import (SewFigures.swatches + captureSwatches,
     // pages 1–4), blobs 'p:<id>:swatch:<i>', list at 'p:<id>:swatchinfo'; captures now when this
     // session still holds the imported PDF, else [].
// document event 'sewingapp:captured' { projectId, quilt: bool, swatches: n } after those captures.
SewingApp.repaint(projectId?)        // call after an extras sheet wrote craftData (Store.updateCraftData):
                                     // repaints the step screen and the working mode (cheap, safe any time)
SewingApp.openSheet(id, projectId?, opts?) → boolean
     // id: 'steps' | 'cutting' | 'notions' | 'size' | 'fabric' | 'machine' | 'seam' | 'pages' |
     //     'page' (opts.page = PDF page number) | 'sheet' (the pattern sheet) | 'addSheet' | 'import'
SewingApp.vocab(project?) → Sewing.vocab(kind)   // { unit, units, piece, pieces, sizeWord, … }
SewingApp.onChange(fn) → unsubscribe  // fn({ projectId, what: 'step'|'unit'|'cut'|'size'|'sheet'|'note'|'edit'|'import' })
                                      // after each write this file makes
```

What sew-extras gets from the app (no other coupling):
- the ⋯ menu lists `SewingExtras.menuItems(project)` as `{ icon, label, run: SewingExtras.open(id, project) }`,
  after the app's own items;
- a step whose text starts with "Cut" (or whose section is a cutting section) shows a chip that calls
  `SewingExtras.open(<the item whose id or label matches /cut/i, i.e. 'board'>, project, { from: 'step', step: index })`
  when such an item is listed, else the app's own cutting sheet;
- a press / fuse step shows "⏱ Press" / "⏱ Fuse" and calls
  `SewingExtras.open(<the item matching /timer|press|fuse/i, i.e. 'timer'>, project, { from: 'step', step: index, kind })` when listed;
- after an extras sheet changes craftData, call `SewingApp.repaint(project.id)`.

## Test hook (`SewingApp.__test`, test pages only)

```js
__test.state(projectId) → { at, where, total, done, size, unitBtn: { name, done, target } | null,
                            figure: 'crop'|'page'|'none', chips: [label] }
__test.advance(projectId)            // exactly the big button's tap (Step done, or +1 on the active unit)
__test.stepDone(projectId)           // Step done even when a unit is active (the link under the button)
__test.unitBump(projectId, delta)    // +1 / −1 on the active unit
__test.readout(projectId) → the working-mode readout object (shell-ui §1 shape)
__test.advice(projectId, mine?) → Sewing.suggestSize result for the project (mine defaults to the profile)
__test.chooseSize(projectId, size)   // the size sheet's "Use 42" (one undo step)
__test.resolved(projectId) → Sewing.resolveSize(craftData, chosen) | null
__test.menu(project) → [{ icon, label }]   // what ⋯ shows from this craft (own items + extras)
__test.figureRef(step) → { kind: 'crop', blobKey } | { kind: 'page', rect } | null   // decode step.imageRef
__test.importCheck(parse, opts) → Check     // what the import review shows
__test.milestones(before, after) → [label]  // the toasts P19 would show
```

## Stored data

Nothing new outside `craftData` (sew-core's `normalize` is the gate). The step's figure lives in
the existing `step.imageRef` string (≤ 120 chars), until sew-core keeps a `step.fig` object:
- `'p:<projectId>:fig:<page>:<hash>'` — a clean crop by `SewFigures.renderCrops` (mode `figure`);
- `'rect:<page>:<x0>,<y0>,<x1>,<y1>'` (normalised, 3 decimals) — no clean figure; the page viewer
  opens that page with this frame outlined (mode `page`).
Anything else is ignored. The step screen never shows a crop that is not mode `figure`.

## CSS hooks (`css/sewing.css`)
`.sw-fig` (the step's figure button on the card), `.sw-fig-img`, `.sw-yoursize` (per-size numbers
for the chosen size), `.sw-setup` / `.sw-setup-chip` (P15 chips), `.sw-unit-strip` /
`.sw-unit-chip`, `.sw-step-link` (Step done under a unit button), `.sw-note` (the sewist's note),
`.sw-advice` (size advisor card), `.sw-cell-unsure`, `.sw-sheet-*` (pattern sheet), `.sw-work-fig`
(the working-mode surface figure).

## Changes by sew-audit (2026-11-13)
- The figure is `step.fig` (sew-core's shape: `{kind:'crop', page, blobKey}` / `{kind:'page', page, rect}`);
  the capture writes it and clears `imageRef`; old `imageRef` strings are still read. `__test.figureRef`
  returns `{ kind:'crop', blobKey, page }` for a `step.fig` crop.
- On a unit step "✓ Step done" (`.sw-step-link`) is the last item of `.sw-unit-strip`, above the button;
  the chips sit in `.sw-unit-chips` (one line, scrolls sideways).
- Long step text: `.sw-text-more` ("Show the whole step ▾", `aria-expanded`), card classes
  `.sw-text-cut` / `.sw-text-open` / `.sw-unit-step`. Sewing mode's HUD carries `.sw-work`.
- The cutting bar `.sw-cuttable` shows only on a cutting step.
- New test hooks: `__test.patternName(parse, fileName)` (the guarded name, '' for amounts / headings),
  `__test.saLabel(projectId)` (the seam allowance in the pattern's own unit first).
- `SewingApp.fabricOwnParts(node, projectId)`: appends the rows as printed (closed `details.sw-fabric-printed`),
  the nap sentences (`.sw-nap`) and "What I actually used" (`[data-focus-key="fabric-used"]`); called by
  sew-extras' fabric sheet. ⋯ lists no app "Fabric" item when the extras' `fabric` item exists, and
  `openSheet('fabric')` opens the extras sheet. Sewing mode's HUD gets `.sw-work-four` while −1 is shown.
