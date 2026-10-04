# Wave F — 3d-follow: the piece turns with the taps

Owner of `js/diagram.js`, `js/diagram-geo.js` (unchanged), `test/diagram.test.html` (the new
`// follow` block), `test/diagram.gallery.html` (unchanged), and the 3D regions of `js/app.js`.

The owner's request, verbatim: *"the option to have the 3d rendering rotate with the taps. like say
theres 36 stitches on a round, to rotate 10 degrees each stitch. I want that option the default."*

## What the user sees

- **Rounds mode.** Each stitch tap turns the piece by 360°/count of the round being worked: 10° on
  a 36-stitch round, 30° on a 12. The stitch you just made stays at the front. Done stitches sit just
  right of the centre line, the unworked grid of the round is to the left, and the work travels right
  to left across the front, as it does under a right-handed hook. The turn eases over 150 ms and
  snaps under `prefers-reduced-motion`. 36 taps on 36 make exactly one turn. The next round carries
  on from the seam, with no spin back. Undo turns back one stitch. Un-tapping a row, finishing a row
  early, jumping to a row from the pattern sheet, and Undo of anything all re-aim from the absolute
  stitch index.
- **Swipe still spins.** A swipe on the button (or a drag in the viewer) moves the piece freely. The
  angle you leave is kept until the next tap, which blends back to the working stitch the short way.
  A longer swing gets up to 420 ms. Nothing snaps while a finger is down, and a recolour, a resize or
  opening the viewer never pulls back a piece you just spun.
- **No clock.** With follow on, the 12°/s auto-rotate is off in both the button and the viewer.
  Between taps nothing moves and **nothing is drawn**: the render loop stops, which saves battery.
  A finished piece stays still.
- **Rows mode.** The sheet faces the camera. If it is wider than the frame (the button's
  `clamp: 'height'` sheets overflow sideways by design), it slides so the working stitch stays
  centred, without ever showing empty space past the sheet's edge. A sheet that fits never moves.
- **Both mounts follow.** The button and the ⤢ viewer use the same rule. The viewer opens facing the
  working stitch. The over-count wedge and the working-round marker are part of the band geometry,
  so they turn with the piece. Checked on screen: the red wedge sits immediately right of the
  centre line.
- **Setting.** ⚙️ Settings → Feedback → **"3D follows your stitches"** ("Each tap turns the piece so
  the stitch you just made faces you."), on by default, directly under "Live diagram". The ⤢ viewer
  has the same switch as a fourth chip row, **Turn: Follows stitches / Free spin**, under Terms. The
  two stay in sync and both move the live canvases immediately. It is a device preference, not part
  of the project, so it has no Undo. "Free spin" brings back the old auto-rotate after the usual
  1.5 s pause.

## Contract

### Settings key
`Store.settings().crafts.crochet.diagramFollow`. Read and written only through
`Store.craftSettings('crochet')` and `Store.setCraftSetting('crochet', 'diagramFollow', bool)`.
**Absent means on**; only an explicit `false` turns it off. In `js/app.js` everything goes through
`diagramFollowOn()` / `setDiagramFollow(on)` (constant `DIAGRAM_FOLLOW_KEY`), so moving the key is a
two-line change (see "For the owner of js/store.js").

Why this bag: `Store.setSetting(key)` silently refuses any key that `defaultState()` does not
declare, and `normalizeState` drops unknown setting keys on load. The per-craft bag is the existing
preferences API that already persists (sewing and cross-stitch use it). No store change was needed.
Like `liveDiagram`, it is in `localStorage` on this device and travels inside a backup file,
because `exportJSON` writes the whole state.

### Diagram API (`js/diagram.js`, version string `'1.5.0'`)
- `Diagram.mount(canvas, { …, follow: true|false })`: default **off** in the renderer, so the
  gallery and the test page demo behave as before. The app passes the setting.
- `handle.setFollow(bool)`, `handle.getFollow()`. Turning it on eases to the working stitch.
  Turning it off slides a rows sheet home and restarts the auto-rotate after `ROT_PAUSE`.
- `handle.getStats().follow` → `{ on, angle, front, target, animating, userTurned, pan, key }`.
  `angle` is the working point on its ring (radians from stitch 0). `front` is the ring angle facing
  the camera now (yaw + π/2). `target` is the unwrapped yaw it is easing to. `pan` is the rows slide
  in world units.
- `Diagram.follow`: the pure maths, used by the renderer and the tests:
  `angle(index, count[, a0, aw])`, `yawFor(angle)`, `nearest(target, ref)`,
  `step(prevYaw, index, count[, a0, aw])`, `duration(deltaYaw)`,
  `ease(from, to, elapsedMs, durMs, reducedMotion)`, `pan(xWork, xMin, xMax, halfVisible)`,
  `rotation(yaw, pitch)` (the camera matrix `buildView` now calls), and constants
  `FRONT` (π/2), `MS` 150, `MAX_MS` 420, `PAN_MS` 180.
- Built bands, and so GPU chunks, carry their slice layout `a0` / `aw` (`withSlices`), so follow
  reads where the done fabric really ends from the arrays the mesh was built with.

### The angular convention (item 2 of the task), checked rather than assumed
- `buildRoundBand` lays stitch j from `a0[j]`, with `a0[0] = 0`, increasing from +x toward +z. Both
  the plain path and `DiagramGeo.arcSlices` (polygons, arc length) start at θ = 0. The marker ring,
  the over-count wedge and the stitch scale-in are those same slices, so they share one origin.
- `buildView`'s R = Rx(pitch)·Ry(yaw) puts a ring point at angle A at view depth
  `r·cos(pitch)·sin(A − yaw)`. The point nearest the camera is therefore at **A = yaw + π/2**, at
  any pitch.
- So **yaw = angle(k) − π/2** puts stitch k at the front. There was no offset to fix in the geometry.
  The old fixed start yaw of −0.35 simply put ring angle 70° at the front, which was arbitrary.
- `angle(index, count)` is exactly 2π·index/count for equal stitches. With the round's real slice
  layout it is walked through the slices: per-stitch widths, arc-length polygons and the 160-slice
  cap. A wide stitch then turns the piece further, and the front is where the fabric really ends.
  On a round where every third stitch is 2.2 wide, the plain formula would be off by up to 8.6°.
- The angle is **absolute**, never an accumulated delta. Only the choice of turn (+2πk) uses history:
  it is the turn nearest the previous follow target, or nearest the user's yaw after a swipe. Found
  and fixed during the in-app check: the first version measured from the yaw on screen. Under fast
  taps or a throttled tab that lags behind, so after 7 taps on a 12-stitch round it chose −150°
  instead of +210° and the piece swung backward. There is an assertion for this.

### Performance (item 5)
Follow is a camera change only. `setModel` on the tap path calls `syncFollow`, which costs a
`followTarget` (O(1); O(bands) for the rows extent) and sets an ease. **No band is rebuilt.**
Measured on a 2,394-stitch piece (48 rounds up to 60 around, colour bands, button size
341 × 209 CSS px, `mid` tier, 47,880 verts, 45,408 tris, 52 draws):

| measure | value |
|---|---|
| first `setModel` (full build) | 13.7 ms (`buildMs` 9.2) |
| `setModel` per tap, mean of 30 | **0.14 ms**, `rebuilt` 0 on every tap, `buildMs` 0 |
| 60 taps (one full turn) | 0 chunks rebuilt in total; `front` ends at 2π |
| `frameMs` while easing | 7.89 ms (desktop; rAF only runs in screenshot bursts in the pane) |
| `submitMs` | 0.18 ms |
| idle after the last ease | `running: false`, fps 0. The loop stops. |

`frameMs` / `submitMs` keep their meanings. Neither was touched. The ease is sampled from
`performance.now()`, so a skipped frame never stretches the move.

## Tests: `test/diagram.test.html`, `// follow` … `// /follow` block (after `// /renderer`)
Group **"Renderer — follow mode: the piece turns with the taps (wave F)"**, 11 assertions:
1. `angle(index, count)` = 2π·index/count (10° per stitch on 36, 9 = a quarter, 36 = a full turn,
   count 0 → 0, clamps outside the round)
2. stitch k faces the viewer: on a built 36-stitch band, through `Diagram.follow.rotation` (the
   matrix `buildView` uses), the frontmost slice after k taps is the one just made or the next one,
   done to the right and pending to the left, at pitch 0 and 20°. The working point is 3e-16 off the
   forward axis.
3. uneven stitch widths: the front follows the builder's real slices, not 2πk/n
4. accumulation: 36 taps on 36 = exactly one turn in 10° steps; the 48-round starts where it ended;
   12 of 48 = 90°; the owner's 12 taps on 12 = 360°
5. undo turns back one stitch; un-tapping a row lands on the end of the round before, without a spin
6. jumps are absolute: a 10-step walk of jumps, taps and swipe offsets never drifts; a jump takes
   the short way
7. a swipe is an offset the next tap blends back from
8. eased ~150 ms (up to 420 for half a turn); reduced motion snaps
9. rows: a sheet that fits never pans; a wider one centres the working stitch, clamped to its edges
10. a live handle (hidden canvas): 9 taps → 90° with **0 rebuilds**; a tap during a drag does not
    move the yaw; the next tap lands on the right stitch; finishing the piece moves nothing;
    `setFollow(false)`
11. taps that outrun the frames still turn forward (7 of 12 = +210°, not −150°)

**Results:** `test/diagram.test.html` **204 passed, 0 failed** (193 + 11); **241 passed, 0
failed** after "Load reference fixtures" (230 + 11). `test/sw.test.html` **29 / 0**: another wave F
agent raised it from 27, since it added `js/zip.js` to `PRECACHE_URLS`. **Nothing in PRECACHE
changes for this work** (both files are already precached; no new file). The gallery loads
`Diagram` 1.5.0 with no console errors and does not pass `follow`, so it is unchanged. No other
suite loads `js/diagram.js` or `js/app.js`.

## Verified in the pane (375 × 812, own tab)
Project created from the panda fixture. `tmp-pdf/panda 1 english.pdf` does not exist in this
worktree; the same pattern is `tmp-pdf/crochet-panda.pdf`. The import gave 7 parts, Head 21 rounds
(6 → 48).
- Head Rnd 2 (12): 3 real taps put `front` at 90°, and 11 taps put it at 330°. The 12th tap
  auto-advanced to Rnd 3 (18), and the piece went **forward** +30° to 360° ≡ 0, with no spin back.
  That is the owner's check: 12 taps on a 12-stitch round is one full turn.
- Jump from the pattern sheet to Rnd 9 (48): re-synced to stitch 0. 6 taps put `front` at 45°. On
  screen the six done stitches sit just right of the centre line at the front of the dome.
- Undo (bottom bar): back 7.5°. Swipe right across the button: yaw +83°, no stitch counted,
  `userTurned` set. The next tap blended back to stitch 6 exactly.
- ⤢ viewer: opened facing the working point, so the done arc of round 9 starts at the centre line
  and runs right to the seam, with the glow marker on the working round. Turn chip → Free spin:
  stored `false`, auto-rotate resumes after the pause. Back to Follows stitches: eased back to the
  working stitch.
- Settings: the switch reads on by default. Switching it off stored `false`, and the value survived
  a reload. In the button, the old behaviour came back (start yaw −0.35, slow drift). The viewer chip
  turned it back on, and the next tap turned 20°.
- Rows mode, on a button-sized canvas in the test tab with `fitPurpose: 'button'` and a 120-wide
  sheet (`fitClamp: 'height'`): pan −5.1 → +5.1 as the working stitch crosses an even row, reversing
  on the odd row, 0 rebuilds. A 14-wide sheet: pan 0 throughout.
- Over-count on a button-sized canvas (20 tapped on a round the pattern says is 18): the red wedge
  is the two stitches immediately right of centre, with the pending grid to the left.
- Screenshots were taken before and after at each step (button, viewer, settings). The pane was
  hidden part of the time, so later screenshots timed out and those checks used `getStats()`.
  The shared storage profile was also reset twice by other agents' suites mid-check, which is why
  the panda project was imported twice.

## What is left, and why
- **A part with no pattern count never turns.** Its working round's `count` is the stitches tapped
  so far (`max(stitch, target)`), so every tap closes the ring and the working point stays at the
  seam (2π·n/n). That is geometrically honest, since the work does end at the seam, but nothing
  moves. To fix it, the store would have to hand over the previous round's count as the expected
  size of a count-less round. That is a model question for `Store.diagramModel`, not the renderer.
- **The seam is a straight line.** Every round starts at angle 0, so the "spiral" is continuity of
  rotation across rounds, not a drifting jog. Real right-handed amigurumi jogs a little each round.
  Modelling that would move every reference fixture's stitch positions (`js/diagram-geo.js`) and
  is out of scope.
- **Handedness in the default view.** Top-down (magic ring at the top) shows the front travelling
  right to left with the working edge at the bottom. That is the mirror image of holding a real
  piece with its opening down. Bottom-up matches the hand exactly. Nobody has complained; noted for
  completeness.
- The 2D fallback (no WebGL) does not rotate at all, as before.
- Not felt on a real phone. The ease and the swipe-then-blend are tuned on desktop numbers.

## Decisions for the coordinator
1. **The viewer gains a fourth chip row** ("Turn"). At 375 × 812 the stage canvas is 347 px tall,
   about 58 px less than before. If that is too much, the row could move into the ⚙️ sheet only. The
   task asked for both, so both are in.
2. **A finished piece is still when follow is on** (no auto-rotate). That is my reading of "Finished
   pieces do not move". If the owner prefers a finished piece to keep turning slowly as a trophy,
   it is one condition in `needsFrame`/`frame`: allow the clock when `fitFinished`.
3. The setting lives in the crochet craft bag rather than as a first-class `settings` key (see
   below).

## For the owner of `js/store.js`
If you would rather have the setting first-class: add `diagramFollow: true` to `defaultState().settings`
and `diagramFollow: s.diagramFollow === undefined ? true : !!s.diagramFollow` to `normalizeState`,
mirroring `liveDiagram`. Then tell me, or whoever owns the 3D regions of app.js, to change
`diagramFollowOn()` / `setDiagramFollow()` to `Store.settings().diagramFollow !== false` and
`Store.setSetting('diagramFollow', on)`. A one-time read of the old bag value would keep anyone who
already switched it off. Not needed for correctness: the bag works today.

## For the owner of `SPEC.md` (docs agent)
"Live 3D diagram" § Camera & motion: auto-rotate is now the **Free spin** mode. The default is
**follow**: yaw = 2π·done/count − π/2 on the nearest turn, eased 150 ms (up to 420), snapped under
reduced motion; event-driven with no idle frames; a swipe offset is kept until the next tap; a
finished piece is still; rows mode slides a wider-than-frame sheet to the working stitch
(`followPan`). Renderer API additions are listed under "Contract" above, and `version` is `'1.5.0'`.
§ App integration: Settings toggle **"3D follows your stitches"** (default on,
`settings.crafts.crochet.diagramFollow`) and the viewer's **Turn: Follows stitches / Free spin**
chips. (Superseded by the follow-up below: the viewer has a header button instead of the chip
row, and a finished piece turns.)

---

## Follow-up: the coordinator's decisions, applied

The three decisions above came back as: (1) drop the chip row and use a header button,
(2) a finished piece turns as a trophy, (3) size count-less rounds from the counter's target.
Everything above still holds except where this section says otherwise.

### 1. Viewer: a header button instead of the fourth chip row
The **Turn** chip row is gone. In its place is one compact button in the ⤢ sheet header, between
the round readout and ✕: glyph **↻**, `aria-label` and `title` **"Turns with each stitch"**, and
`aria-pressed`. It is a one-button `.seg`, so it reuses the chips' own "on" styling (`--primary`
fill) with no new CSS. Inline sizing is 44 px minimum width and 46 px tall. It writes the same
setting as the ⚙️ switch, which stays, and `syncFollowButton()` keeps it in step. At 375 × 812 the
stage canvas is **400 px tall again** (347 px with the chip row). Verified: a real click toggles
`aria-pressed`, the stored value and both handles. Screenshots were taken in both states.

### 2. A finished piece turns as a trophy
With follow on, a finished piece (`fitFinished` or the model's own `finished`) turns at the old
auto-rotate rate after the usual pause. It still has no glow and no wedge. A working piece stays
still between taps, as before. In the renderer, `followTrophy()` gates `needsFrame`, the auto-rotate
branch of `frame()` and the resume timer. `getStats().follow` gains `trophy` (bool) and `reason`
(`''` / `'finished'` / `'no-count'`). Measured: a finished 8-round ball turned +42° in about 3.5 s
of frames, with `markerOn: false` and `wedgeFrom: −1`. Finishing never yanks the yaw: the turn
starts from where the last tap left it.

### 3. Parts with no pattern count (`js/store.js`, diagram-model section)
- `buildDiagramModel`: the working round with no parsed count is now sized from the **counter's
  own target for that row**: `targetFor(prt, patternRow)`, the number the readout shows through
  `Store.currentTarget`. That target also answers past the written rows from the repeat sentence,
  which the row index never sees. So taps there turn 360/target. Before this, such a round was
  "3 of 3", closed on every tap.
- With no target either, the round is still `max(stitch, 0)` long, but now carries
  **`countless: true`**. The key is present only on that working round, never on any other round,
  and is never `false`. The renderer's follow mode then does not turn: `getStats().follow.key` is
  **`'no-count'`** and `reason` is `'no-count'`.
- Found while asserting this: a countless round is always "full" (done = count), so both the
  renderer's derived `finished` (`finishedOf`) and the app's `modelFinished` were taking a
  pattern-less part's working round for a **finished piece**. That predates wave F: it dropped the
  working-round glow and would now have started the trophy turn. A countless round now holds the
  piece open in both places (`anyCountless` in `normalizeModel`; `if (r.countless) return false`
  in `modelFinished`).
- New model field for the SPEC: `Round.countless?: true`. It means the working round's `count` is
  only the stitches tapped so far, because nothing (no parsed count, no counter target) sized it.

### Tests and counts after the follow-up
| suite | before | now |
|---|---|---|
| `test/diagram.test.html` units | 204 | **205 / 0**. The live-handle assertion now also checks the trophy flag off while working, on when finished, and no wedge. New: "a working round with no count does not turn, `follow.key` 'no-count', not taken for a finished piece". |
| `test/diagram.test.html` + reference fixtures | 241 | **242 / 0** |
| `test/diagram-model.test.html` | 521 | **529 / 0**. Group **17h**, 8 assertions: the repeat-sentence target sizes the round (24 with 3 done, not 3 of 3) and it is not countless; no counts and no target gives `countless: true`, kept through the cached tap path; a part with no pattern is countless; a printed count is never countless and no round carries the key. |
| `test/store-safety.test.html` | 226 | **226 / 0** |
| `test/backup.test.html` | 104+ | **205 / 0** (raised by another wave F agent) |
| `test/templates.test.html` | 94+ | **117 / 0** (raised by another agent) |
| `test/crafts.test.html` | 124 | **124 / 0** |

One earlier diagram-model run showed 520 / 1: the Premier wrap's "builds in under 60 ms" timing
check read 67.8 ms while other agents' suites were running. That path never reaches the new
fallback, since its rounds have printed counts, and it passed on the next run.

