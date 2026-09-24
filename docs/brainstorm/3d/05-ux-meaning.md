# 05 · What the piece should tell the crocheter

Lens: the live 3D diagram judged as a *companion while you count*, not as a demo. Session:
`ZD5_Baphomet` from `/tmp-pdf/crochet-baphomet.pdf` (7 parts) — Tail worked 0→42 rounds, Horns
through piece 1 into piece 2, Ears, Muzzle deliberately mis-counted; yarn colour changed live;
⤢ viewer opened repeatedly; themes swapped; then `ZD5_Wrap` from
`crochet-premier-sparkling-wrap.pdf` (rows, 405 sts × 46 rows) and a pattern-less freehand part.
Both projects deleted. Phone viewport 375×812.

## Five lines of actually using it

1. Out of the box the tail is a **flat blanket**: the PDF import left `countMode: 'rows'`, and
   `Store.diagramModel` picks rounds-vs-rows from that one project-level word, so every part of an
   amigurumi whose every line says `MR4` / `sc around` renders as a curved sheet. Flipping Edit
   project → Count → **Rounds** turned it, in one tap, into an unmistakable crocheted tail — a bulb
   with a long tapering tube, growing downward, ghost rings running on to the floor. That flip is
   the difference between the feature working and not working, and nothing anywhere hints at it.
2. At button size I could never answer a single question I actually had. Which round? Not shown.
   How far round? The working round's grid is a ~10 px scribble at the far tip. Am I on horn 1 or
   horn 2? The model resets to nothing and the finished twin is gone. Where does the colour change
   land? The whole toy is one cream (the parser finds no names in "secondary color" / "CC to main
   color"), so R12's change — the one thing a tail-shaped object needs to show — is invisible.
3. **The chrome sits on the piece.** `STITCHES`, a 90 px numeral and the `TAP` pill run straight
   down the vertical axis of a round-worked solid, which is exactly where the piece is. On the
   6-round Ear the entire model hid *behind* the `STITCHES` pill; on the finished Tail the numeral
   covered the middle third of the tube; on the 42-round Tail at round 13 the solid work was 36 %
   of the frame (`fitScale 0.357`) because the ghost cage of 29 unworked rounds owns the rest.
4. I tapped 29 stitches into a 24-stitch round. The model drew a **complete, happy, correctly
   closed ring of 29** and said nothing — `{count: 29, done: 29, ghost: false}`. The pattern's 24
   is right there in `Store.currentTarget`. The single most useful thing a live model could do —
   *that round is too big* — is the one thing it deliberately throws away.
5. Rows mode is worse than nothing. A 405-stitch row auto-fits to `fitScale 0.15`: in the button it
   is a **hairline** behind the numeral, and full-screen in the ⤢ viewer, after five rows, it is
   one thread across an empty green field. Separately, repeatedly opening the viewer eventually
   leaves it a silent blank rectangle (`getStats().webgl === false`, canvas stuck at its 300×150
   default) — the "could not start" copy never fires because `mount` returned a handle.

---

## Proposals, ranked by impact ÷ effort

### 1. Get the piece out from under the number
**What you saw.** On the finished Tail the `STITCHES` pill, the numeral and the `TAP` pill form a
vertical column down the exact centre of the button — and a round-worked solid of revolution is
also a vertical column down the exact centre. On the 6-round Ear the model was *entirely* behind
the `STITCHES` pill; on the Horn at round 4 only a 20 px cap peeked out above it.
**Proposal.** Give the model its own column. Move the numeral and its caption into the left two
thirds and let the piece occupy a right-hand band (or, on a wide button, mirror it for left-handed
users), with the model's fit box inset to that band rather than the whole canvas. Drop `STITCHES`
to a 10 px label pinned top-left, shrink `TAP` to a hairline underline that only appears before the
first tap of a session, and set the numeral to ~64 % opacity with the existing text shadow so the
piece reads through it rather than being cut by it.
**Effort** S · **Impact** 5 · **Risks.** The numeral is the primary readout and must stay the most
legible thing on screen; test at 200 % text zoom and in the two light themes where a cream yarn on
a cream numeral is the worst case.

### 2. Decide rounds vs rows per part, from the pattern, not per project
**What you saw.** `buildDiagramModel` reads `proj.countMode === 'rounds' ? 'rounds' : 'rows'`.
The Baphomet import set `'rows'`, so a tail that begins `R1: MR4` was modelled as a flat sheet —
solid work at the bottom, ghosts rising above it, upside down relative to how you hold it. One
project-level word decides the shape of seven different pieces, and a garment with a round yoke and
flat panels can never be right at all.
**Proposal.** Add `Part.shape: 'rounds' | 'rows' | 'auto'` defaulting to `'auto'`, resolved by
`Patterns`: a magic ring (`MR`/`magic ring`/`ch 2, 6 sc in 2nd ch`), the word `around`, `rnd`, or a
round-over-round increase run ⇒ rounds; `turn`, `ch 1, turn`, `RS`/`WS`, a starting chain longer
than 40 ⇒ rows. Fall back to `proj.countMode`. Surface it as a two-chip control in the part editor
("This piece: In rounds / In rows") so a wrong guess is one tap from fixed, and show the resolved
word in the 3D viewer header.
**Effort** S–M · **Impact** 5 · **Risks.** A wrong auto-guess is more confusing than a wrong
default because the user did not choose it; always show which way it went and make it overridable.

### 3. Mark the round you are on
**What you saw.** In every capture the boundary between solid fabric and ghost cage is the only
clue to which round is current, and on a 42-round tail that boundary is a 4 px step halfway down a
featureless tube. The viewer header says `Rnd 29 · 0 / 6` in text; the piece says nothing.
**Proposal.** Ring the working round. Draw the current band with a 1.5 px `palette.glow` edge at
its top and bottom and lift its bump amplitude 15 %, so the live round is a visible *bracelet* on
the piece at any zoom. In the viewer, float the round number beside that bracelet as a 2D label
drawn over the canvas (HTML, not GL — it must stay upright as the model turns). On row completion
the existing `'round'` flash then reads as the bracelet stepping down one round, which is the
motion a crocheter recognises.
**Effort** S · **Impact** 4 · **Risks.** A permanent glow competes with the `'round'` completion
flash; keep the bracelet at low contrast and let the flash be the bright event.

### 4. Stitch 1, and how far round you are
**What you saw.** `PENDING_ALPHA 0.72` draws the unworked slices of the current round as a grid —
correct, but at button size on a 6-stitch round it is a few faint cells at the tip of a tube, and
on a 30-stitch Ear round it is a smudge. Nothing marks stitch 1, so on a spiral you cannot see
where the round began, which is the actual question when you lose your place mid-round.
**Proposal.** Two marks on the working round only: a **stitch marker** — a small contrasting bead
sitting on slice 0, the colour of `palette.glow`, the same object crocheters clip on — and a
**progress arc**, a thin filled band on the outside of the ring covering `done/count` of the
circumference, starting at the marker and running in work direction. Together they answer "where
did this round start" and "how far round am I" in one glance and survive down to button size
because both are silhouette features, not surface detail.
**Effort** S · **Impact** 4 · **Risks.** The marker must not read as a stitch; make it float
slightly proud of the surface and skip it under `reducedMotion`-style minimal rendering.

### 5. Frame the work, not the cage
**What you saw.** `fitScale` was **0.357** on the Tail at round 13 (29 ghost rounds trailing below)
and **0.15** on the 405-stitch wrap. The spec caps ghosts so they cannot shrink the real piece
below 45 % of the view; in practice the ghost still owns most of a long thin piece and the fabric
you have actually made is a thumbnail.
**Proposal.** Fit to the **worked** geometry plus one round of context, and let the ghost cage run
out of frame, fading to zero alpha over the last 15 % of the canvas height so it reads as "this
continues" rather than as a cropped object. Keep the contact shadow on the true ground plane and
let it sit off-screen; when the work finally reaches the floor, the model eases back to a full fit
and the shadow slides into view — which is a real, earned "it is finished" moment. In the viewer
add a **Fit** double-tap that toggles worked-only / whole-plan.
**Effort** S · **Impact** 4 · **Risks.** The fit target changes every round, so ease it (the 200 ms
scale ease already exists) or the piece pulses on every completion.

### 6. Show the twin you already made
**What you saw.** Horns is `(make 2)`. Finishing horn 1 reset the model to nothing; at "4 / 14 ·
piece 2 of 2" the diagram showed a 4-round stub identical to the one I had at the start of horn 1.
The text line knows which piece I am on; the 3D piece — the part of the screen I was actually
watching — does not.
**Proposal.** When `piecesDone > 0`, render each completed piece as a **finished sibling**: the
same model at its final counts, translucent (~35 %), parked to the left of the live one and
slightly behind, no bumps, no ghost cage. Two horns on screen, one solid and growing and one done,
and you know exactly where you are without reading a word. It also makes "the second one came out
shorter" visible, which is the classic make-2 failure.
**Effort** S · **Impact** 4 · **Risks.** Halves the space for the live piece on a phone; only draw
the sibling when the part's aspect allows it, and never more than two.

### 7. Never render nothing
**What you saw.** After several open/close cycles the ⤢ viewer came up as a flat field of
`--primary` with no piece, no message and no way to tell anything was wrong — `getStats()` reported
`webgl:false, triangles:0` and the canvas backing store was still 300×150. `mount` had returned a
handle, so `'The 3D view could not start.'` never appeared, and the documented Canvas-2D silhouette
fallback drew nothing either. Reloading fixed it. A crocheter would conclude the feature is broken.
**Proposal.** Make the handle honest: if the first frame produces zero draw calls or the context is
lost, drop to the 2D silhouette path *and* show a one-line footer in the viewer ("Showing a simple
outline — 3D isn't available right now"). Release the GL context in `destroy()` via
`WEBGL_lose_context`, and have the viewer reuse the button's renderer instead of mounting a second
context, so the two canvases can never compete for one.
**Effort** S · **Impact** 4 · **Risks.** A shared renderer means the button's model and the
viewer's have to stay in sync; they already do — both are driven from the same `setModel` call.

### 8. Name the colour roles, then band the change
**What you saw.** `Patterns.colors()` returns `{legend:{}, names:[]}` for this pattern, so the Yarn
colours sheet offers exactly one swatch ("Main yarn") for a seven-part toy and says *"No colour
names found in this pattern yet"* — while the pattern text reads `Starting in secondary color`,
`CC to main color in last stitch of R12`, `Cc to main color last st of R5`. The R12 change on the
tail — the moment the piece stops being a tail-tip and becomes a body-coloured tube — never
appears. When I did force a colour, the whole 42 rounds changed together.
**Proposal.** Recognise the role words (02 #23) and then *use* them in the model: the round where a
role changes gets a hard colour boundary (no per-stitch blend across the band), and the counter
shows a small two-tone chip reading "→ main colour in 4 rounds" whenever a change is within five
rounds. The model then answers the highest-value question a colour-worked amigurumi has: *is the
change coming up, and did I make it in the right place?*
**Effort** S · **Impact** 4 · **Risks.** `MC`/`CC` false positives; gate on the word `colo(u)r`
nearby, and treat an unrecognised role as the main yarn rather than inventing a hue.

### 9. Auto-rotate that rests while you count
**What you saw.** I could not measure the rotation honestly (the Browser pane throttles rAF while
hidden, so `yaw` sat still and `fps` read 1–3), but the design question stands on its own: a piece
turning at 12°/s sits directly under the numeral you are reading thousands of times a session, and
the spec's only quiet mode is the global `reducedMotion`.
**Proposal.** Rotate on *events*, not on a clock. Give each tap a 25° eased nudge that decays to
rest in ~600 ms, and each completed round a slow 120° sweep; otherwise the piece is still. You get
the reward of the thing moving when you did something, the piece explores all sides over a session,
and nothing moves while you are staring at the number. Keep continuous auto-rotate as an option in
the viewer (where you are looking *at* it, not counting), and add a Settings row **Piece motion:
Still / On taps / Always**.
**Effort** S · **Impact** 3 · **Risks.** Some people will miss the calm continuous turn; that is
what "Always" is for. Battery: event-driven rendering is strictly cheaper.

### 10. Don't dim the piece while you are choosing its colour
**What you saw.** Opening **Yarn colours** from the viewer stacks a second sheet with a backdrop
scrim over the canvas: the cream tail went muddy brown while I was picking, so the swatch I chose
and the piece I saw disagreed. It updates live, which is lovely, and then the scrim ruins it.
**Proposal.** When the Yarn colours sheet is opened *from the viewer*, present it as a bottom
drawer over the lower third with **no backdrop** and no dimming, so the piece above stays true
while the picker is open. Add a preview row of six skein swatches (the project palette from
10-delight #1) above the `<input type="color">`, each previewing on the model on press and
committing on release.
**Effort** S · **Impact** 3 · **Risks.** No scrim means taps can fall through to the canvas; the
canvas is already inert behind a sheet, so scope the drawer to `pointer-events` on itself only.

### 11. Freehand needs a floor and a ruler
**What you saw.** A part with no pattern, 14 stitches tapped, renders as a single strip of 14 bumps
floating with no ground, no scale and no hint of what it will become. Honest, but it tells you only
what the numeral already told you.
**Proposal.** In the no-pattern case, give the model a permanent ground plane and shadow from the
first stitch (so the piece has somewhere to be), and mark every 10th stitch of the current round
with a subtle darker slice — a ruler you can count off visually. Once two rounds exist, project the
trend (increasing / level / decreasing) as three pale ghost rings continuing the curve, so freehand
counting still gets the "here is where this is heading" that a pattern gives.
**Effort** S · **Impact** 3 · **Risks.** A projected trend is a guess; keep it much fainter than a
pattern ghost and never let it change the fit box.

### 12. My count vs the pattern's count, on the piece
**What you saw.** 29 stitches tapped into `R1 … [24]` produced `{count: 29, done: 29, ghost:
false}` — a complete, well-formed, 21 %-oversized ring, drawn with exactly the same confidence as a
correct one. `Store.currentTarget(part)` returns 24 the whole time. The same applies in reverse: a
round finished short just becomes a narrower ring, which on a 42-round tail is indistinguishable
from an intentional decrease.
**Proposal.** Keep `expected` alongside `count` in each round of the Model. When `done > expected`,
draw the surplus slices in a desaturated warning tint and let the ring visibly bulge past the
pattern radius with a thin dashed **expected-radius ring** floating at the correct circumference —
the "my count vs pattern" overlay, literally a ring you have overflowed. When a *completed* round
came in under, leave that dashed ring outside the finished band so the notch is obvious when you
scroll back. Pair it with one line under the counter: "R1 should be 24 — you have 29."
**Effort** M · **Impact** 5 · **Risks.** False alarms on rounds the parser could not evaluate
(the Muzzle's R1 came back as 24 × `{t:'x'}`); only warn when the pattern stated an explicit
bracketed count, never on an inferred one.

### 13. Rows mode: a window on the fabric, not the whole blanket
**What you saw.** 405 stitches × 5 rows auto-fits to `fitScale 0.15`. In the button it is a
hairline behind the numeral; full-screen it is one thread across an empty field. No fit of a
81:1 rectangle into a 1:1.6 canvas will ever show a stitch.
**Proposal.** For rows mode, stop drawing the whole piece. Draw a **window**: roughly 40 stitches
wide centred on the working stitch and the last ~8 rows, at real stitch scale, with the fabric
running off both edges under a soft fade and a thin edge-of-work marker on whichever side the row
started. Above it, a 6 px **mini-map** bar showing the full row width with the window's position on
it and the turn direction. At button size that reads as actual crochet fabric with a travelling
cursor — which is something — where today's hairline reads as nothing. Keep the full-piece view as
the viewer's second mode for blankets and panels where the whole thing matters.
**Effort** M · **Impact** 4 · **Risks.** Two framing modes to maintain; derive the window purely
from `current`/`done` so it needs no new state.

### 14. Put the placement notes on the piece
**What you saw.** The pattern is full of spatial instructions the model is the ideal place for:
`R6: 12sc, Attach tail …, 21sc`, `R13` attaches both arms, "Fold ear in half and 3sc through both
sides", eye placement notes on the Body/Head. All of it lives as grey text under the counter, and
the 3D piece — the only thing on screen that has a *where* — shows none of it.
**Proposal.** Parse `attach|sew|place|embroider <thing>` with a round and, where given, a stitch
offset, into `Part.marks = [{row, stitch, label}]`. Render each as a small pin on the surface at
that ring and slice: pale and flat while the round is in the future, solid and labelled once you
reach it, permanent afterwards. Tapping a pin in the viewer scrolls the pattern to that line.
Suddenly the piece answers "where do the eyes go" and "which side is the tail on" — questions no
counter can answer.
**Effort** M · **Impact** 4 · **Risks.** Fuzzy phrasing ("both sides of Tail"); keep pins advisory
and stitch-offsets optional — a pin on the right *round* is already most of the value.

### 15. Ghost the finished thing, not just a cage
**What you saw.** The ghost is a stack of bare rings at `GHOST_ALPHA 0.20`. On the Tail it reads
well because a tail is a tube. On the 6-round Ear (6 → 30 sts) the ghost is a wide flat ellipse
that looks like a scuff on the button, and on dark themes it is essentially invisible. You cannot
tell from the cage what shape you are making.
**Proposal.** Keep the cage for the *next* three rounds, and behind it draw the remaining plan as a
single translucent **shell** — the same solid surface, no bumps, ~12 % alpha, one flat colour —
so the silhouette of the finished ear/horn/head is there from stitch one and you watch the solid
fabric fill it. Derive the shell alpha from the button's background luminance so it survives both
the cream themes and the near-black ones.
**Effort** M · **Impact** 4 · **Risks.** A shell around a long piece makes the fit problem worse;
it must be excluded from the fit box (see #5).

### 16. A round slider to scrub the piece's history
**What you saw.** `Part.rowStitches` already stores the count of every completed round
(`[0,4,6,7,9,11,11,13,15,15,12,9,6,…]`). The viewer offers nothing but rotate and a readout, so
that history is invisible — yet "when did it start going wrong" is the question you ask when a
piece has gone wrong.
**Proposal.** A slider under the viewer canvas from round 1 to the current round. Dragging it
rebuilds the model as it stood at that round (everything after becomes ghost), with the round
number and its count/expected pair in the label. Add one **Compare** toggle that overlays the
pattern's planned radius profile as a thin outline against the actual, which turns the whole
history into a single legible "you drifted here" picture.
**Effort** M · **Impact** 3 · **Risks.** Rebuilding per slider frame; slice the existing model
rather than re-running `buildDiagramModel`, and throttle to the round granularity.

### 17. Explode and cross-section in the viewer
**What you saw.** The Tail's bulb (rounds 1–12, 4→15→6) is a closed solid; you cannot see the
decrease rounds at all from outside, and the rounds you most want to inspect on amigurumi are
always the ones inside a curve.
**Proposal.** Two chips in the viewer: **Explode** spreads the rounds apart along the axis
proportionally to a slider, so every ring and its count are separately visible (with round numbers
floating beside them at full separation); **Cut** clips the model at the camera-facing half so you
see the profile — the silhouette that tells you whether your sphere is a sphere. Both are camera
and geometry only, no new data.
**Effort** M · **Impact** 3 · **Risks.** Feature creep in a sheet that must stay glanceable; hide
both behind a single "Inspect" chip rather than a permanent toolbar.

### 18. A material that knows the theme, and a yarn-vs-button contrast floor
**What you saw.** With the main yarn set to `#8b2f2f` and the Fire & Blood theme active, the piece
sat on a `#8b1e2b` button — same hue, same value, near-perfect camouflage; I could only find the
tail by its rim light. On Pelican Town Spring the same yarn was crisp. The ghost at 0.20 alpha
disappears entirely on the dark themes and reads as a smudge on the light ones.
**Proposal.** Before each `setPalette`, compute the yarn/background contrast; when it falls under a
floor, shift the *lighting* rather than the yarn — raise the rim to 0.45, add a 1 px dark
contact-outline on the silhouette — so the crocheter's chosen colour is never altered but the piece
never vanishes. Scale `GHOST_ALPHA` and `PENDING_ALPHA` off background luminance in the same pass,
and add the `u_style` per-theme material work from 10-delight #13 on the same uniform.
**Effort** M · **Impact** 3 · **Risks.** An automatic rim boost can look like a selection state;
ramp it, and verify on all six themes with both cream and near-black yarn.

### 19. Share the finished piece
**What you saw.** Finishing the Tail (42/42) changed the tab chip to `Tail ✓` and left the model
exactly as it was, still captioned `TAP`, still saying `0`. The most photogenic thing the app ever
makes gets no moment at all.
**Proposal.** On part completion, the viewer offers **Save image**: render the piece at 2× into an
offscreen canvas on a plain background with the part name, final round count and elapsed time, and
hand it to `canvas.toBlob` → `navigator.share` / download. No backend, no new geometry. It is the
only artefact of the counting session that anyone would want to keep or post.
**Effort** M · **Impact** 2 · **Risks.** `navigator.share` with files is patchy; fall back to a
download and say so.

### 20. Garment parts should carry the schematic's shape
**What you saw.** Not testable on this pattern set beyond the wrap, but the failure mode is already
visible in the wrap: a garment panel's meaning is its *outline* — shoulder slope, armhole curve,
where the decreases start — and the rows renderer knows only "count stitches, stack rows", so every
panel is the same rectangle regardless of shaping.
**Proposal.** In rows mode, let the per-row stitch count drive the sheet's silhouette (it already
does for width) and additionally mark shaping events on the edges: a notch where a row's count
drops at one end only (armhole/neck), a flag where it drops at both. Then a sleeve looks like a
sleeve at a glance and "am I decreasing on the right edge" becomes a visual question. Pair with a
part-level label from the pattern's schematic section when one was imported.
**Effort** L · **Impact** 3 · **Risks.** Requires knowing *which end* a decrease happened at,
which `Patterns.expand` does not track today; it may be a parser change before it is a renderer
change.

---

## Two smaller things worth writing down

- **The ⤢ button has already moved** out of the tap surface into `.stitch-actions` as a labelled
  "3D view" chip (02 #8 / 07 #7 landed). It works. Keep it there.
- **Horns increase at the same stitch every round** (`Inc, 4sc` … `Inc, 16sc`), which in real yarn
  produces a curved horn; the model draws a straight cone. Leaning the ring centres along the
  increase column would make a curled horn, a curled tail and a shaped foot all read correctly —
  genuinely lovely, genuinely **L** effort, and not worth it before anything above.
