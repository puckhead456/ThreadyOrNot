/* =====================================================================
   js/diagram-geo.js — crochet geometry for the live 3D diagram.

   Pure functions, no WebGL, no DOM. `js/diagram.js` consumes this for the
   layout / band / cap / fit code paths; `test/diagram.test.html` asserts it
   directly and `test/diagram.gallery.html` prints it.

   The physics is docs/brainstorm/3d/01-geometry-truth.md:

     N_flat = 2*pi*h/w                       stitches added per round to stay flat
     dy     = h*sqrt(1 - ((1-s)*|dr|/h)^2)   vertical rise, s = stuffing slack
     r      = (sum of stitch widths) / 2pi   ring radius from the real perimeter
     r = R*sin(phi), y = R*(1 - cos(phi))    the dome that slack lofts (§7a)

   so "+6 sc lies flat", "0 change is a cylinder" and "|dn| > N_flat ruffles"
   all fall out of one line instead of the old asin(R/Rmax) fudge.

   DEVIATION — the open-rim rule (`formOf`). 01 §1.3 reads "part ends at or
   near its maximum count => open rim => s = 0", which is right for a doily,
   a granny square and a sock leg and wrong for everything domed. A turtle
   shell (6->42 at +6, then 42, 42) and a snowman hat (6->36, straight, ->48,
   straight, flared brim) both END at their widest round, so the flat rule
   pressed them into discs: aspect 0.151 and 0.160 against photos of a full
   dome and a proper hat. The count sequence says which is which:

     increases, then >= 2 STRAIGHT rounds, then stop open   -> cup/dome/hat
     increases, then stop open (no straight rounds)         -> flat disc/bowl
     small, no stuffing hint, <= 8 rounds, slight decrease  -> shallow bowl

   The straight rounds are the evidence. A round that repeats its count adds
   no circumference, so it can only become WALL — it stands at right angles
   to the disc below it, and a piece with a wall is a vessel. That wall then
   holds an inflated dome up even when nothing is stuffed into it (a hat is
   held by a head, a shell by the belly it is sewn to), which is what slack
   models. Hence: a cup gets the stuffed slack when the text says stuff, and
   SLACK_SHAPED = 0.20 when it does not. A piece that stops open the moment
   its increases stop has no wall and nothing to hold: it stays at slack 0,
   and the sqrt alone then decides disc (dn at the flat rate) vs bowl (below
   it), so no extra knob is needed for that case. A small unstuffed piece
   that turns a little way back in — the panda ear, 6->18, 18, ->12 — has a
   cupped brim but only a hand's worth of body, so SLACK_BOWL = 0.10.
   `shapeOf().form` reports the pick; `test/diagram.test.html` asserts all
   four cases synthetically and against the fixture PDFs.

   Model v2 (from Store.diagramModel) is the input:
     { mode, rounds:[{ count, done, stitches:[{t,c,h,w}], color, height,
                       ghost, inc:[i], dec:[i], row, outlier }],
       current, defaultColor,
       shape:{ start, chainLen, ringCount, stuffed, corners, cornersSource },
       window, deviation }
   Everything past `mode` + `rounds[].count` is optional: Model v1 (no shape,
   no inc/dec, no per-stitch h/w, `height` = the old 1 / 1.5 / 2 / 2.5) still
   lays out, it just gets rings instead of polygons and a guessed cap.

   THREE GAPS CLOSED IN 1.1.0 (07-review-motifs-garments.md D1, D2, D4).

   (1) `shape.corners` as a POLYGON PRIOR. 01 §1.4.7 always specified a text
   fallback for k, because `Patterns.expand` returns no positioned `inc`
   markers for `(3 dc, ch 3, 3 dc) in corner sp` — so `polygonFit`, which is
   driven by increase-site indices, had nothing to fit and every granny
   square, hexagon and star in the corpus rendered as a solid of revolution.
   When the model carries `shape.corners` (3|4|6|8, `cornersSource` 'sites' or
   'text') the prior fills in the rounds the sites could not speak for:
     * the ROUNDS AFTER THE FIRST TWO get the k-gon cross-section — corners
       11% out and mid-sides 21% in for k = 4, derived per k by
       `polygonRatios`. Rounds 1–2 are a tiny ring worked into the start
       chain; the corners have not formed yet, so they stay circular.
     * the k-GON FLAT RATE `kf = k·tan(pi/k)/pi` applies to the WHOLE walk
       (01 §1.4's `N_flat,k / N_flat,circle`: 1.273 for a square, 1.103 for a
       hexagon). Without it round 2 of a square worked at its own flat rate
       is measured against the circle, |dr| > h, and a flat granny square
       ruffles. The prior says the fabric is a k-gon from the first stitch;
       only its visible corners arrive later.
     * a prior round may run up to POLY_FLAT_TOL past that flat rate and still
       be laid FLAT rather than frilled, because the text is independent
       evidence and the stitch height is the soft number (the hex socks'
       UK tr arrives as US dc, h 2.01 against the 2.68 its +18/round assumes).
   READABLE SITES STILL WIN. A round whose sites cluster into a k keeps that
   k, and a round whose sites are a SPREAD increase (k evenly spaced sites
   gaining < POLY_MIN_PER_SITE each, i.e. "+6 sc per round") keeps its circle
   — that is a positive verdict, not a gap, so the prior may not overrule it.

   (1b) A round 1 worked INTO A SMALL CHAIN RING opens out from the ring, not
   from its own circumference. The magic-ring case was already handled
   (`isFirstFromRing`); a `chain-ring` start whose ring is smaller than round
   1 is the same geometry — a ch-4 ring with 16 dc in it is a flat disc with a
   pinhole, not a cylinder — and treating it as `dr = 0` cost every motif a
   full stitch-height of rise it does not have. Guarded by `chainR < firstR`
   so the Stylecraft cowl (240 ch joined, round 1 parsed as 23) is untouched.

   (2) TWO FIT POLICIES (`purpose`). The height clamp was written for the
   sheet being COUNTED: a 405-stitch row fitted to the width is a hairline, so
   the scale is pushed up and the sheet overflows sideways with the worked row
   centred. That is right while counting and wrong for a FINISHED piece, where
   it meant no rows-mode rectangle in the corpus was ever seen as a rectangle
   (the wrap overflowed by 4.5x, the throw and the cardigan panels by 8x).
   `purpose: 'viewer'|'gallery'`, `finished: true`, or a model whose rounds are
   all worked, letterbox at the honest scale. `purpose: 'button'` (the default)
   keeps the counting clamp but is now bounded by FIT_MAX_WIDTH_FRAC, so the
   sheet overflows the frame by at most 50%, never 800%.

   (3) OUTLIER ROWS are bridged, not drawn. A row of 2 or 5 among rows of 405
   is a line the parser misread, and laying it out at full width ratio tore
   the fabric into detached pieces (the wrap's floating hairline, the cardigan
   swatch's capital T). A round flagged `outlier` by the store — or, absent the
   flag, a ROWS-mode row under OUTLIER_FRAC of the running median of the rows
   before it — gets no band, joins the rows above and below, and is left out
   of the piece's width, height and aspect. The fallback heuristic is rows-only
   and needs OUTLIER_MIN_BEFORE normal rows ahead of it, so a piece that grows
   from 3 stitches and a piece that tapers off the start are both safe.

   THREE AMIGURUMI DEFECTS CLOSED IN 1.2.0 (06-review-amigurumi.md 1, 2 and
   the honourable mention). All three are one mistake made three times: the
   stuffing slack was allowed to change the RISE and nothing else.

   (4) THE RUFFLE GATE SEES THE SLACK the rise spends. It tested the raw |dr|
   against h·kf while the rise spent (1 - s)·|dr|, so a piece that can stretch
   over |dr| up to h/(1 - 0.35) = 1.54h was cut off at 1.08h and every ordinary
   amigurumi shaping round (dn >= 7 sc) became a frill: 13 of the baphomet
   Body/Head's 33 rounds, the whole crown of the bear Head, the cato Head's
   gathered close, the fish Body's opening — two stacked tin cans with flat
   serrated lids instead of two spheres. Where there IS surplus past the
   slack-adjusted rate, STUFFED_FLAT_TOL decides what happens to it: a piece
   held out from inside (stuffed, or a cup sewn to the head it caps) presses it
   into the ball's own curve and the round goes FLAT — a wide annulus, still a
   ring — while a doily's picot round, with nothing pressing outward, buckles.

   (5) A MAGIC-RING SPIRAL IS A DOME, not a cone — `loftDomes`, §7a. Constant
   |dr| with constant h is a constant slope; the aspect can be spot on (panda
   Head 1.12 against 01's 1.11) while the object is an ice-cream cone. The rise
   is redistributed along each monotone run on the stuffed-sphere law
   (r = R·sin φ, y = R(1 - cos φ), cumulative fabric arc mapped to φ, R solved
   from the run's own r0, r1 and arc), keeping the run's total, so the height,
   the equator and every aspect in 01 §2 are unchanged and only the curvature
   is new. Blended by slack: 0 is the plain arc walk, 0.35 near-spherical.

   (6) ONE CLOSURE THRESHOLD, CLOSE_COUNT. `closedBottom` gathered at 6 while
   `closesIn` closed at 8, so a piece ending at 8 or 9 after a decrease run
   took the stuffed slack and then kept an open hole where the pattern says
   `pull to close` (the baphomet Body/Head at 8, the cato Head at 9).

   FOUR MORE IN 1.3.0 — "make a stuffed amigurumi READ as stuffed".

   (7) THE STUFFED PROFILE IS NOT A DRUM (06 defect 7, and defect 2 finished).
   With the ruffle gate and the dome loft in, the baphomet Body/Head still drew
   as two stacked TIN DRUMS: a nearly flat lid where the increases run past the
   flat rate, a dead-vertical wall where the counts repeat, and a hard shoulder
   where they meet. Its numbers were right (aspect 1.499, equator 0.71, closed,
   0 ruffles) and its curvature was wrong, which is the whole of this change:
   three passes that move the profile and NOT one number in 01 §2 —
     * a PROFILE FILLET that limits the meridian's bend radius to FILLET_BEND
       stitch heights by moving rings along y (a ring's radius is its stitch
       count over 2pi and stays fixed), borrowing the height from the straight
       run and giving it back;
     * a WALL BOW, declared cosmetic: the middle of a straight run gains up to
       WALL_BOW of radius on a sine, drawn and reserved for but never measured;
     * a LID DOME that gives a run past the flat rate the sagitta LID_SAG of a
       shallow spherical cap instead of lying dead flat.
   Gated on STUFF_MIN_SLACK and scaled by the slack, so slack 0 — a doily, a
   granny square, a sheet — is untouched. See the STUFF_* constants for the
   argument and `stuffProfile` / `bendProfile` for the code.

   (8) ORIENTATION. `layout(model, {upsideDown:true})`, or
   `model.shape.upsideDown` from text like "starting from the bottom of the
   body", flips a piece so ROUND 1 IS AT THE BOTTOM: `y` is mirrored about the
   piece's mid-height (so the piece still occupies [-height, 0]) and
   `closedTop` / `closedBottom` swap, because they name the piece's geometric
   ENDS. `shape.closedTop` / `shape.closedBottom` keep naming round 1's ring and
   the gathered close, which is what tells a renderer WHICH BAND each cap
   belongs to. Rows mode already walks upward, so a sheet is unaffected.

   (9) GRANNY CLUSTERS SPLAY (01 §1.4.5, `GRANNY_FLAT`). The other side of
   POLY_FLAT_TOL. A real granny square grows +12 TREBLE widths a round — four
   corners, three trebles a group — and lies FLAT, while the k = 4 flat rate at
   the height a treble arrives with is 15–16 widths a round. The arc walk spent
   the shortfall as rise, so the Stylecraft hood motif climbed into a cup at
   aspect 0.49 against 01 §2.2 #43's < 0.08 — and it did so at BOTH heights the
   UK/US conversion can hand it (0.79 of the rate as dc, 0.62 as tr).
   The arithmetic is right and the HEIGHT is wrong: three trebles worked into
   ONE chain space fan out, so a cluster round is shorter than a plain dc/tr
   row and +12 really does cover the rate. Rather than guess a second height
   table for clusters, read it off the growth — a k-gon round (a measured k, or
   the text prior's) growing at GRANNY_FLAT or more of its own flat rate is
   granny fabric and gets dy = 0 and `granny: true`. Below that it may still
   cup: a bowl deliberately worked in the round with stacked corners (+6 on a
   k = 4, 0.37 of the rate) is a real bowl and keeps its arc. Above
   POLY_FLAT_TOL it still ruffles. The verdict is also taken for the PIECE
   (`grannyFabric`, the median over its k-gon rounds), so the two circular
   rounds a motif starts with — the chain ring and the round around it, before
   the corners form — lie flat with the rest of the same fabric instead of
   standing the finished square up on a 4-stitch-high collar.
   A PLAIN RING IS NEVER ASKED: kf = 1 leaves `grannyRatio` unset, so no sphere,
   tube or disc round can reach the rule.

   No modules, no build step. Attaches window.DiagramGeo.
   ===================================================================== */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;

  /* ------------------------------------------------------------ constants */

  var SW = 1.0;        // stitch width, world units — the unit of everything
  var SH_SC = 0.95;    // sc height in SW units. 6/(2*pi) = 0.955 is the
                       // "+6 per round lies flat" rule; 0.95 is it, rounded.

  /* Per-type height / width in sc units, used only when the model does not
     carry per-stitch h/w (Model v1, or a round with no stitches). */
  var STITCH_H = {
    sc: 1, x: 1, inc: 1, 'inc+': 1, dec: 1,
    hdc: 1.34, dc: 2.01, tr: 2.68, dtr: 3.35,
    sl: 0.3, ch: 0, bbl: 1.68, puff: 1.79
  };
  var STITCH_W = {
    sc: 1, x: 1, inc: 1, 'inc+': 1, dec: 1,
    hdc: 1, dc: 1, tr: 1, dtr: 1,
    sl: 0.7, ch: 1, bbl: 1.15, puff: 1.15
  };

  /* Stuffing slack. 0 is the isometric (unstuffed) truth; 0.35 turns the flat
     discs of a closed amigurumi into the caps of a ball (01 §1.3).
     SLACK_OPEN is 0, not 0.05: the sqrt is near-vertical at the flat rate, so
     0.05 already lifts a "+6 flat disc" by 0.30*h per round and a doily or a
     granny square would dome. An open rim has nothing to inflate it. */
  var SLACK_STUFFED = 0.35;
  var SLACK_FIRM = 0.45;
  var SLACK_UNSTUFFED = 0.05;
  var SLACK_OPEN = 0.00;

  /* DEVIATION from 01 §1.3, which gives *every* open-rim piece slack 0.
     "Open rim" is not one shape, it is three, and only one of them is flat —
     see `formOf` below for the rule and the argument.
       cup / dome / hat : increases, then straight rounds, then stop open
       flat disc / bowl : increases, then stop open
       shallow bowl     : a small unstuffed piece that decreases a little */
  var SLACK_SHAPED = 0.20;  // shaped but not stuffed: a hat, an unstuffed dome
  var SLACK_BOWL = 0.10;    // a small ear/bowl: a hand's worth of body, no filling

  var CUP_STRAIGHT = 2;     // >= 2 straight rounds = a wall that stands up
  var BOWL_MAX_ROUNDS = 8;  // "small piece"
  var BOWL_MIN_END = 0.5;   // ends at >= half its widest = a SLIGHT decrease
  var FLAT_TOL = 0.85;      // an increase round is "at the flat rate" above this

  var RUFFLE_EPS = 0.08;    // |dr| over h by more than this and the round frills
  var RUFFLE_RISE = 0.12;   // a ruffled round still rises this fraction of h
  /* How far past the SLACK-ADJUSTED flat rate a piece that is held out from
     inside — stuffed, or a cup sewn onto the head it caps — may grow before it
     buckles into lobes (06 defect 1). Stuffing presses the surplus into the
     ball's own curve: the round goes flat (a wide annulus, still a RING), it
     does not frill. Nothing presses a doily's picot round outward, so that one
     still frills, and so does anything past 1.5x even on a stuffed piece. */
  var STUFFED_FLAT_TOL = 1.5;
  var DY_MIN = 0.02;        // never exactly 0, as a fraction of h
  var R_MIN = 0.42;         // smallest ring radius for a non-empty round
  var RING_START = 0.30;    // closed magic ring, absolute cap in SW
  var RING_START_FRAC = 0.34;
  /* ONE threshold for "the yarn was pulled shut" (06 honourable mention).
     `closedBottom` used GATHER_COUNT 6 while `closesIn` used CLOSE_COUNT 8, so
     a piece that ends at 8 or 9 after a decrease run — the baphomet Body/Head
     ends on `Dec x8` at 8, the cato Head at 9 — took the stuffed slack from
     `closesIn` and was then left with a 2.5-wide open hole in its skull,
     because `closedBottom` said no cap. 9 is the widest last round anything in
     the corpus gathers on (01 §1.6 "decreases back below ~8 stitches"). */
  var CLOSE_COUNT = 9;

  /* Dome loft (06 defect 2). A constant |dr| with a constant h gives every
     round of a magic-ring opening the same rise, i.e. a constant slope, i.e. a
     CONE — the panda head, the turtle shell and the bee bodies were all ice
     cream cones even where their aspect was exactly right. A stuffed sphere of
     radius R carries r = R*sin(phi), y = R*(1 - cos(phi)) with the fabric's own
     arc R*dphi per round, so the rise per round runs from ~0 at the pole (the
     surface is horizontal there) up to a full h at the equator (vertical)
     while |dr| stays constant. `loftDomes` redistributes each monotone run's
     rise on that law, keeping the run's TOTAL, and blends it in by slack. */
  var LOFT_BLEND_AT = SLACK_STUFFED;  // slack at which the loft is full strength
  var LOFT_MIN_RUN = 2;               // one round has nothing to redistribute
  var LOFT_ITERS = 48;                // bisection steps for a run's sphere R
  var LOFT_MAX_R = 1e4;               // past this the run is a flat annulus

  /* ------------------------------------ the stuffed profile (06 defect 7 and
     the amigurumi re-review). With the ruffle gate fixed and the domes lofted,
     a closed stuffed segment still came out as a DRUM: the fast-increase rounds
     form a nearly flat lid, the straight rounds a dead-vertical wall, and the
     two meet at a hard shoulder. The baphomet Body/Head is two stacked drums at
     aspect 1.499 — the right number on the wrong curve. Three things are
     missing and all three are the stuffing:

       1 PROFILE FILLET. A stuffed fabric corner cannot bend tighter than about
         1.2 stitch heights of radius — the yarn will not turn tighter than the
         stitch that makes it. So the meridian r(y) is filleted to that limit by
         moving rings ALONG y: a ring's radius is its stitch count over 2pi and
         is not negotiable, but WHERE that ring sits is. The height a corner
         needs is taken out of the straight run and given straight back, over
         about FILLET_SPAN rounds either side, so the segment's total height —
         and therefore every aspect in 01 §2 — does not move. Where height alone
         cannot round a corner (a waist, where the profile reverses radially) a
         radial ease of at most FILLET_EASE is allowed, and never on the widest
         ring, so the equator and the aspect stay where the counts put them.
       2 WALL BOW. A run of straight rounds under stuffing bows outward. The
         first and last round of the run are pinned by the shaping either side
         of it; the middle rounds gain up to WALL_BOW of radius on a sine over
         the run. This is yarn stretch, i.e. COSMETIC, so it is the one thing
         here that does NOT touch `radius`: it is a separate fraction, `bow`,
         which `radiusDraw` carries into the drawn bands and into the
         `radiusMax` the fit reserves. The piece's own `maxRadius` / `width` /
         `aspect` / equator keep measuring the ring the stitch count asks for.
       3 LID DOME. A run past the flat rate lies on no curved surface of
         revolution at all (`loftRadius` returns 0 — the run is flatter than a
         flat annulus), so the walk lays it flat and it reads as a tin lid.
         Stuffing pushes it out into a shallow spherical cap of sagitta LID_SAG
         of the lid's own radius; the rise that costs comes out of the straight
         run, so the segment's height is again unchanged. Rise only ever GROWS
         here, so a run the loft already domed is left exactly alone.

     All three are gated on STUFF_MIN_SLACK and scaled by the slack, so a doily,
     a granny square, a flat disc and every rows-mode sheet (slack 0) are
     untouched, and a cup at 0.20 gets a little over half of what a firmly
     stuffed ball at 0.35 gets. A frilled round is skipped throughout: a buckle
     is not a stuffed corner, and its own wave is already its shape. */
  var STUFF_MIN_SLACK = 0.20;
  var FILLET_BEND = 1.2;    // min meridian bend radius, in stitch heights
  var FILLET_SPAN = 2;      // rounds either side of a shoulder that share it
  var FILLET_ITERS = 24;    // relaxation passes per attempt
  var FILLET_RELAX = 0.6;   // ...each damped by this much
  var FILLET_TRIES = 2;     // relax, ease the corners left over, relax again
  var FILLET_EASE = 0.04;   // last-resort radial ease, fraction of the ring
  var FILLET_KEEP = 0.30;   // a donor round keeps at least this much of its h
  var WALL_BOW = 0.05;      // straight-run outward bow, fraction of radius
  var WALL_BOW_MIN = 3;     // ...over a run of at least this many rounds
  var LID_SAG = 0.15;       // flat-lid sagitta, fraction of the lid radius

  /* Polygon detection (01 §1.4). Candidate corner counts in priority order. */
  var POLY_KS = [4, 6, 8, 3];
  var POLY_RUN = 3;             // >= 3 consecutive rounds, same k, same phase
  var POLY_OCCUPANCY = 0.8;     // >= ceil(0.8k) of the k slots occupied
  var POLY_MIN_PER_SITE = 1.8;  // a corner takes a group, not one stitch
  /* The k a text prior is allowed to assert (01 §1.4.7 / js/app.js
     shapeName: Triangle / Square / Hexagon / Octagon motif). */
  var POLY_PRIOR_KS = [3, 4, 6, 8];
  /* Rounds 1 and 2 of a motif are the start ring and the round worked around
     it; the corners only become corners once there is a side between them. */
  var POLY_PRIOR_FROM = 2;
  /* How far past its own k-gon flat rate a TEXT-ASSERTED polygon may grow and
     still be laid flat instead of frilled. 01 §1.4.5 already says the rate test
     "only raises confidence, it does not veto" the k — and of the three numbers
     in `dn vs 2pi·h·kf/w` the stitch HEIGHT is the least reliable: the hex
     socks' UK tr arrives as US dc (h 2.01 where 01 §1.1 computes the +18/round
     flat rate from tr's 2.68, a factor of 1.33), and a repeat-expanded row can
     inherit sc 1.0 where the fabric is twice that. 1.5 covers both, and a
     genuine frill — a doily's picot round, 2x over — still frills. */
  var POLY_FLAT_TOL = 1.5;
  /* GRANNY CLUSTERS SPLAY (01 §1.4.5, the other side of POLY_FLAT_TOL).
     A real granny square grows +12 TREBLE-widths per round — four corners,
     three trebles per group — and lies FLAT. The k = 4 flat rate at the height
     a treble arrives with is 15–16 widths per round (2pi*h*kf: 15.3 at h 2.01,
     19.4 at h 2.55), so +12 is only 0.6–0.8 of it and the arc walk spends the
     shortfall as RISE: the Stylecraft hood motif walked up into a cup at
     aspect 0.49 where 01 §2.2 #43 wants < 0.08.
     The walk is not wrong about the arithmetic, it is wrong about the height.
     Three trebles worked into ONE chain space FAN OUT from that space; the
     round's effective height is lower than a plain dc/tr row's, so the same
     +12 covers the whole flat rate in the real object. Rather than guess a
     second height table for clusters, read it off the growth: fabric a k-gon
     that grows at GRANNY_FLAT or more of its own flat rate is granny fabric
     and LIES FLAT. Under that it may still cup — a bowl deliberately worked in
     the round with stacked corners (+6 on a k = 4, 0.37 of the rate) is a real
     bowl and keeps its rise. Over POLY_FLAT_TOL it still ruffles.
     0.55 sits between the two: the granny cases in the corpus measure 0.46
     (hood round 2 at tr height) … 0.98 and the bowl 0.39.
     A plain ring — every amigurumi sphere, tube and disc — has kf = 1 and is
     never asked this question. */
  var GRANNY_FLAT = 0.55;
  var SHARP_FLAT = 0.75;        // granny corners
  var SHARP_SOFT = 0.45;        // amigurumi darts
  var RIPPLE_AMP = 0.06;        // chevron: a gentle radial wave, still a ring
  var OVAL_MIN_END = 0.15;      // smallest end radius of a stadium

  var SHEET_CURVE = 3;          // rows: bend radius as a multiple of the width

  /* Outlier rows / rounds (07 D4). `round.outlier` from the store always wins;
     the fallback below is the same median test, run over the rows BEFORE this
     one so a piece that grows from 3 stitches is never caught by it. */
  var OUTLIER_FRAC = 0.20;      // under 20% of the running median = not fabric
  var OUTLIER_MIN_MED = 8;      // ...and only once the piece is wider than this
  /* ...with at least this many normal rows behind it. 1, not 2: the sparkling
     wrap's misread rows start at ROW 2 (405, 2, 5, 2, 405 …), so a 2-row lead-in
     would let the first of them through and the sheet would still tear. Row 1
     itself can never be flagged — there is nothing behind it — and the
     OUTLIER_MIN_MED floor covers the other end: a piece that grows from 3
     stitches is not measured against anything until it is 8 wide, by which time
     every later row is wider than the median, not narrower. */
  var OUTLIER_MIN_BEFORE = 1;

  /* Fit clamps. Scales are in frustum units: `halfW`/`halfH` are the visible
     half-extents at the model plane, so `scale*rad/halfW` is the fraction of
     the half-width the silhouette covers. */
  var FIT_MIN_RADIUS_FRAC = 0.035;   // a 42-round tail is never a hairline
  var FIT_MAX_OVERSCALE = 2.5;       // ...but it is never cropped to a stub
  var FIT_MIN_HEIGHT_FRAC = 0.40;    // a 400-stitch row fills 40% of the height
  var FIT_MAX_OVERSCALE_ROWS = 8;    // ...overflowing sideways to get there
  /* ...but never past half a frame of overflow. The wrap was 4.5 frames wide
     and the throw 8, so you saw 90 of 405 stitches and no end of the sheet. */
  var FIT_MAX_WIDTH_FRAC = 1.5;
  var FIT_PURPOSES = { button: 1, viewer: 1, gallery: 1 };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function arr(v) { return Array.isArray(v) ? v : null; }

  /* ----------------------------------------------------------- 1. stitches */

  /** Height of one stitch in sc units (sc 1, dc 2.01, a ch space 0). */
  function stitchH(t) {
    var h = STITCH_H[t];
    return h == null ? 1 : h;
  }
  /** Width of one stitch in sc units (1 everywhere but a slip stitch). */
  function stitchW(t) {
    var w = STITCH_W[t];
    return w == null ? 1 : w;
  }

  /**
   * One round's measurements.
   * perimeter = SUM of per-stitch widths (not count * SW) so a ch space and a
   * puff are the sizes they really are; h = the dominant stitch height, or the
   * width-weighted mean when no single height owns half the round.
   * @returns {{count:number,perimeter:number,h:number,hw:number,empty:boolean}}
   */
  function roundMetrics(round) {
    var r = round || {};
    var count = Math.max(0, r.count | 0);
    var list = arr(r.stitches);
    var perimeter = 0;
    var hBest = 0, hMean = 0, wSum = 0;

    if (list && list.length) {
      var tally = {}, keys = [], i, st, h, w, key;
      var lastW = 1, lastH = 1;
      /* Sum every record's width. A row can carry MORE records than its
         stitch count (chain spaces and shells share the width of what they
         are worked into, so their entries are fractions of a stitch wide);
         clamping to `count` threw those widths away and halved a mesh row.
         Padding by "repeat the last" only applies when there are FEWER
         records than the count. */
      var lim = list.length;
      for (i = 0; i < lim; i++) {
        st = list[i] || {};
        w = isNum(st.w) && st.w >= 0 ? st.w : stitchW(st.t);
        h = isNum(st.h) && st.h >= 0 ? st.h : stitchH(st.t);
        lastW = w; lastH = h;
        perimeter += w * SW;
        if (h > 0) {
          key = h.toFixed(3);
          if (tally[key] == null) { tally[key] = 0; keys.push(key); }
          tally[key] += w > 0 ? w : 1;
          hMean += h * (w > 0 ? w : 1);
          wSum += (w > 0 ? w : 1);
        }
      }
      // a round may carry fewer stitches than its count: repeat the last
      if (count > lim) {
        perimeter += (count - lim) * lastW * SW;
        if (lastH > 0) {
          key = lastH.toFixed(3);
          if (tally[key] == null) { tally[key] = 0; keys.push(key); }
          tally[key] += (count - lim);
          hMean += lastH * (count - lim);
          wSum += (count - lim);
        }
      }
      /* A row is as tall as its TALLEST stitch, not its commonest: a shell
         row of (sc, ch 3, tr, dc, hdc, sc) stands treble-high even though
         sc owns most of its width. Ignore heights that cover under 10% of
         the row (a lone bobble must not lift a whole sc round), and fall
         back to the commonest height when nothing clears that bar. */
      var best = 0, bestKey = null, tallest = 0;
      for (i = 0; i < keys.length; i++) {
        if (tally[keys[i]] > best) { best = tally[keys[i]]; bestKey = keys[i]; }
        if (wSum > 0 && tally[keys[i]] / wSum >= 0.10) {
          var hk = parseFloat(keys[i]);
          if (hk > tallest) tallest = hk;
        }
      }
      if (tallest > 0) hBest = tallest;
      else if (bestKey != null) hBest = parseFloat(bestKey);
    } else {
      perimeter = count * SW;
    }

    if (!(hBest > 0)) {
      // Model v1 / no stitches: the round's own dominant height, in sc units
      hBest = isNum(r.height) && r.height > 0 ? r.height : 1;
    }
    return {
      count: count,
      perimeter: perimeter,
      h: hBest,
      hw: hBest * SH_SC,
      empty: count <= 0 || perimeter <= 0
    };
  }

  /** Stitches added per round for this stitch to lie flat: 2*pi*h/w. */
  function flatRate(h, w) {
    return TAU * (h > 0 ? h : 1) / (w > 0 ? w : 1);
  }

  /* -------------------------------------------------- 2. increase sites */

  /**
   * Increase / decrease SITES for a round, adjacent runs collapsed to one.
   * `Patterns.expand` emits two adjacent `inc` entries per increase, so a
   * consumer counting sites has to merge runs (01 §1.4 rule 1).
   * @returns {{inc:number[], dec:number[]}}
   */
  function sites(round) {
    var r = round || {};
    var inc = collapse(arr(r.inc)) || null;
    var dec = collapse(arr(r.dec)) || null;
    if (!inc || !dec) {
      var list = arr(r.stitches);
      var fi = [], fd = [];
      if (list) {
        var prev = '';
        for (var i = 0; i < list.length; i++) {
          var t = (list[i] && list[i].t) || '';
          if ((t === 'inc' || t === 'inc+') && prev !== 'inc' && prev !== 'inc+') fi.push(i);
          if (t === 'dec' && prev !== 'dec') fd.push(i);
          prev = t;
        }
      }
      if (!inc) inc = fi;
      if (!dec) dec = fd;
    }
    return { inc: inc, dec: dec };
  }

  function collapse(list) {
    if (!list) return null;
    var out = [], i, v, prev = -99;
    for (i = 0; i < list.length; i++) {
      v = list[i] | 0;
      if (v !== prev + 1) out.push(v);
      prev = v;
    }
    return out;
  }

  /* --------------------------------------------------- 3. piece-level shape */

  /**
   * The count sequence's own profile: how many rounds grow, hold and shrink,
   * and how many of the growing ones grow at (or past) the flat rate. This is
   * everything `formOf` needs and it never touches the pattern text.
   * @returns {{rounds:number, inc:number, straight:number, dec:number,
   *            flatInc:number}}
   */
  function countProfile(rounds) {
    var list = arr(rounds) || [];
    var n = 0, nInc = 0, nStraight = 0, nDec = 0, nFlatInc = 0;
    var prev = 0, seen = false, i, c, dn, h, nf;
    for (i = 0; i < list.length; i++) {
      c = list[i] ? Math.max(0, list[i].count | 0) : 0;
      if (c <= 0) continue;          // an unparsed round is not a straight one
      n++;
      if (seen) {
        dn = c - prev;
        if (dn > 0) {
          nInc++;
          h = list[i] && isNum(list[i].height) && list[i].height > 0 ? list[i].height : 1;
          nf = flatRate(h * SH_SC, SW);
          if (dn >= FLAT_TOL * nf) nFlatInc++;
        } else if (dn < 0) nDec++;
        else nStraight++;
      }
      seen = true;
      prev = c;
    }
    return {
      rounds: n, inc: nInc, straight: nStraight, dec: nDec,
      flatInc: nFlatInc
    };
  }

  /**
   * Which rounds / rows are not real fabric (07 D4).
   *
   * `round.outlier === true` from the store always wins. Absent the flag, a
   * ROWS-mode row under OUTLIER_FRAC of the running median of the normal rows
   * before it is the same defect the store would have flagged: a line the
   * parser misread. Rows-only and backward-looking on purpose —
   *   * a piece that GROWS (3, 5, 5, 7 … 145) is never caught, because the
   *     median it is measured against is of the smaller rows behind it;
   *   * the first OUTLIER_MIN_BEFORE rows are never caught, so a piece cannot
   *     lose its own beginning;
   *   * rounds mode is left to the flag, because a round decreasing to 6 and
   *     closing is exactly what every amigurumi does.
   * @returns {boolean[]} one per round, true = bridge it
   */
  function outlierFlags(rounds, mode) {
    var list = arr(rounds) || [];
    var n = list.length, i, r, c;
    var flags = new Array(n);
    var normal = [];          // counts of the rows we have accepted so far
    for (i = 0; i < n; i++) {
      r = list[i] || {};
      c = Math.max(0, r.count | 0);
      if (r.outlier === true) { flags[i] = true; continue; }
      flags[i] = false;
      if (c <= 0) continue;                       // a zero is `empty`, not this
      if (mode === 'rows' && normal.length >= OUTLIER_MIN_BEFORE) {
        var med = median(normal);
        if (med >= OUTLIER_MIN_MED && c < OUTLIER_FRAC * med) { flags[i] = true; continue; }
      }
      normal.push(c);
    }
    return flags;
  }

  function median(list) {
    if (!list || !list.length) return 0;
    var s = list.slice().sort(function (a, b) { return a - b; });
    var h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  }

  /**
   * Which of the open-rim shapes this is (see the DEVIATION note at the top).
   * `stuffed` is the text's hint (true / false / null), `cp` a countProfile.
   * @returns {string} 'sheet'|'cup'|'disc'|'bowl'|'tube'|'closed'|'shallow-bowl'|'open'
   */
  function formOf(mode, cp, stuffed, openEnd, closesIn, last, max) {
    if (mode === 'rows') return 'sheet';
    if (openEnd) {
      /* Increases, then rounds that repeat their count. A repeated count adds
         no circumference, so the fabric can only go UP: it is wall, and a
         piece with a wall is a vessel that holds a dome — stuffed or simply
         sewn onto the body it caps. */
      if (cp.inc > 0 && cp.straight >= CUP_STRAIGHT) return 'cup';
      /* Stops open the moment the increases stop: nothing holds it. Flat when
         the increases ran at the flat rate, a bowl when they ran under it —
         a distinction the sqrt already makes on its own at slack 0. */
      if (cp.inc > 0) return cp.flatInc * 2 >= cp.inc ? 'disc' : 'bowl';
      return 'tube';                       // no increases at all: a cylinder
    }
    if (closesIn) return 'closed';
    /* A small piece with no stuffing hint that turns a little way back in:
       a cupped brim on a hand's worth of body. The panda ear. */
    if (stuffed === null && cp.rounds > 0 && cp.rounds <= BOWL_MAX_ROUNDS &&
        cp.inc > 0 && last < max && last >= BOWL_MIN_END * max) return 'shallow-bowl';
    return 'open';
  }

  /**
   * Normalised `Model.shape` plus the decisions that come out of it: the
   * shape `form`, the stuffing slack, and whether the top / bottom is closed.
   */
  function shapeOf(model) {
    var m = model || {};
    var s = m.shape || {};
    var rounds = arr(m.rounds) || [];
    var start = typeof s.start === 'string' ? s.start : 'unknown';
    var chainLen = isNum(s.chainLen) && s.chainLen > 0 ? Math.floor(s.chainLen) : 0;
    var ringCount = isNum(s.ringCount) && s.ringCount > 0 ? Math.floor(s.ringCount) : 0;
    var stuffed = s.stuffed === true ? true : (s.stuffed === false ? false : null);
    /* The store's reading of "starting from the bottom of the body", "start at
       the base", "worked from the bottom up": round 1 is the piece's BOTTOM.
       Only `true` counts — an absent or unparsed flag leaves the piece the way
       every other part is laid out, round 1 at the top. */
    var upsideDown = s.upsideDown === true;
    var firm = s.stuffed === 'firm';
    if (firm) stuffed = true;
    /* The polygon prior (01 §1.4.7). 0 = no prior; anything that is not one of
       POLY_PRIOR_KS is dropped rather than guessed at, so a store that starts
       emitting `corners: 5` or `corners: 'square'` cannot bend the geometry. */
    var corners = m.mode === 'rows' ? 0 : priorK(s.corners);
    var cornersSource = corners
      ? (s.cornersSource === 'sites' || s.cornersSource === 'text' ? s.cornersSource : 'text')
      : null;

    var first = 0, last = 0, max = 0, i, c;
    var seen = false;
    for (i = 0; i < rounds.length; i++) {
      c = rounds[i] ? Math.max(0, rounds[i].count | 0) : 0;
      if (c <= 0) continue;
      if (!seen) { first = c; seen = true; }
      last = c;
      if (c > max) max = c;
    }
    if (!ringCount && seen) ringCount = first;

    var cp = countProfile(rounds);

    /* Closed at the bottom: the piece decreases back to a handful of stitches
       and stops — `pull to close` (01 §1.6). ONE test, used for both halves of
       the question: the slack it takes ("this piece closes in, so it is a ball
       and something is inside it") and the cap that closes it. Splitting them
       across 6 and 8 is what left the baphomet Body/Head and the cato Head
       gathered but holed (06 honourable mention). A decrease run is required —
       a piece that was never wider than its last round is not gathered. */
    var closesIn = seen && max > 12 && last <= CLOSE_COUNT && cp.dec > 0;
    var closedBottom = closesIn;
    /* Open rim: the piece ends at (or within a round of) its widest — a hat, a
       cowl, a sock leg, a motif. Nothing inflates it. */
    var openEnd = seen && last >= max * 0.92;

    /* ...but "open rim" is three shapes, not one (see the DEVIATION note at
       the top of the file). Which one is in the count sequence. */
    var form = formOf(m.mode, cp, stuffed, openEnd, closesIn, last, max);

    var slack;
    if (m.mode === 'rows') slack = 0;
    else if (firm) slack = SLACK_FIRM;
    else if (stuffed === true) slack = SLACK_STUFFED;
    else if (stuffed === false) slack = SLACK_UNSTUFFED;
    /* a cup / dome / hat: the text would have said so if it were stuffed, and
       either way the wall stands the dome up. 0.20, not 0. */
    else if (form === 'cup') slack = SLACK_SHAPED;
    else if (closesIn) slack = SLACK_STUFFED;
    else if (openEnd) slack = SLACK_OPEN;
    else if (form === 'shallow-bowl') slack = SLACK_BOWL;
    else slack = SLACK_UNSTUFFED;

    /* The cap. 04 defect D: the old test was "has any stitches", so every
       sock, cuff, muzzle and tube grew a spike. Cap a magic ring only. */
    var closedTop;
    if (start === 'magic-ring') closedTop = true;
    else if (start === 'chain-ring' || start === 'chain-oval' || start === 'chain-row') closedTop = false;
    else closedTop = !chainLen && ringCount > 0 && ringCount <= CLOSE_COUNT && max > first;

    return {
      start: start, chainLen: chainLen, ringCount: ringCount, stuffed: stuffed,
      firm: firm, slack: slack, closedTop: !!closedTop, closedBottom: closedBottom,
      upsideDown: upsideDown,
      firstCount: first, lastCount: last, maxCount: max,
      form: form, openEnd: !!openEnd, counts: cp,
      corners: corners, cornersSource: cornersSource
    };
  }

  /**
   * The radius the FIRST band starts from.
   *   magic ring  -> the closed pinhole, so round 1 opens out from a point;
   *   chain ring  -> the ring's own circumference, when round 1 is worked INTO
   *                  it (a ch-4 ring with 16 dc in it: a flat disc with a
   *                  pinhole, not a cylinder). Guarded by chainR < firstR, so
   *                  the Stylecraft cowl's `make 240ch, join into a circle`
   *                  with round 1 parsed as 23 stitches is left alone;
   *   otherwise   -> round 1's own ring, i.e. no rise from nowhere.
   */
  function startRadius(shape, firstR) {
    if (shape.closedTop) return Math.min(RING_START * SW, firstR * RING_START_FRAC);
    if (shape.start === 'chain-ring' && shape.chainLen > 0) {
      var chainR = shape.chainLen * SW / TAU;
      if (chainR < firstR) return Math.max(chainR, RING_START * SW * 0.5);
    }
    return firstR;
  }

  /* ------------------------------------------------------ 4. cross-sections
     A profile is `f(theta) -> radius MULTIPLIER` about the mean radius
     P/2pi, so it is independent of the round's size and can be blended
     between two rounds. `f.kind`, `f.corners` and `f.sig` describe it. */

  function profileRing() { return null; }   // null = a circle, the fast path

  /**
   * The three numbers 01 §1.4 tabulates for a regular k-gon of the same
   * perimeter as the circle, derived rather than copied:
   *   corner = circumradius / circle radius = pi / (k·sin(pi/k))
   *   side   = inradius     / circle radius = pi / (k·tan(pi/k))
   *   flat   = N_flat,k / N_flat,circle     = k·tan(pi/k) / pi
   * k = 4 gives 1.111 / 0.785 / 1.273, k = 6 gives 1.047 / 0.907 / 1.103.
   * @returns {{k:number, corner:number, side:number, flat:number, swing:number}}
   */
  function polygonRatios(k) {
    var kk = Math.max(3, k | 0);
    var half = Math.PI / kk;
    var corner = Math.PI / (kk * Math.sin(half));
    var side = Math.PI / (kk * Math.tan(half));
    return {
      k: kk, corner: corner, side: side,
      flat: kk * Math.tan(half) / Math.PI,
      swing: side > 0 ? corner / side : 1
    };
  }

  /** Regular k-gon of the same perimeter, blended toward the circle. */
  function profilePolygon(k, phase, sharp) {
    var half = Math.PI / k;
    var seg = TAU / k;
    // inradius / circle radius for equal perimeter
    var inr = polygonRatios(k).side;
    var f = function (theta) {
      var u = (theta + phase) % seg;
      if (u < 0) u += seg;
      var m = inr / Math.cos(u - half);
      return 1 + sharp * (m - 1);
    };
    f.kind = 'polygon'; f.corners = k; f.phase = phase; f.sharp = sharp;
    f.sig = 1000 + k * 17 + Math.round(phase * 100) + Math.round(sharp * 10);
    return f;
  }

  /**
   * Stadium: a rectangle of length `straight` capped by two semicircles of
   * radius `endR`, as a multiplier about the equal-perimeter circle.
   * The long axis is x (theta = 0).
   */
  function profileStadium(straight, endR, rc) {
    var half = straight / 2;
    var f = function (theta) {
      var c = Math.abs(Math.cos(theta)), s = Math.abs(Math.sin(theta));
      var rho;
      var disc = half * half * c * c - half * half + endR * endR;
      if (disc >= 0) {
        rho = half * c + Math.sqrt(disc);
        if (rho * c >= half) return rho / rc;
      }
      rho = s > 1e-9 ? endR / s : half + endR;
      return rho / rc;
    };
    f.kind = 'oval'; f.corners = 0; f.straight = straight; f.endR = endR;
    f.sig = 2000 + Math.round(straight * 100) + Math.round(endR * 100);
    return f;
  }

  /** m-lobed radial wave: a chevron ripple, or a ruffle's buckled surplus. */
  function profileWave(m, eps) {
    var f = function (theta) { return 1 + eps * Math.cos(m * theta); };
    f.kind = 'wave'; f.corners = 0; f.lobes = m; f.eps = eps;
    f.sig = 3000 + m * 13 + Math.round(eps * 1000);
    return f;
  }

  /** Linear blend of two profiles (either may be null = circle). */
  function blendProfiles(a, b) {
    if (!a && !b) return null;
    if (a && a === b) return a;
    var fa = a, fb = b;
    var f = function (theta, t) {
      var va = fa ? fa(theta) : 1;
      var vb = fb ? fb(theta) : 1;
      return va + (vb - va) * (t == null ? 1 : t);
    };
    f.kind = (fb || fa).kind;
    f.corners = (fb || fa).corners || 0;
    f.sig = (fa ? fa.sig : 0) * 7 + (fb ? fb.sig : 0);
    f.blend = true;     // the renderer needs d/dt for its normals
    return f;
  }

  /** Largest / smallest multiplier a profile reaches (for extents). */
  function profileRange(f, samples) {
    if (!f) return { min: 1, max: 1 };
    var n = samples || 180, lo = Infinity, hi = -Infinity, i, v;
    for (i = 0; i < n; i++) {
      v = f(i / n * TAU, 1);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return { min: lo, max: hi };
  }

  /* ------------------------------------------------ 5. equal-arc-length slices

     A stitch occupies a fixed amount of FABRIC, so on a non-circular ring its
     angular width has to follow arc length, not angle — otherwise a granny
     square's corner stitches stretch and its side stitches bunch. */

  var ARC_SAMPLES = 720;

  /** Cumulative arc length of a profile (in mean-radius units). */
  function arcTable(f, samples) {
    var n = samples || ARC_SAMPLES;
    var cum = new Float64Array(n + 1);
    if (!f) {
      for (var q = 0; q <= n; q++) cum[q] = q / n * TAU;
      return cum;
    }
    var dth = TAU / n, i, th, m, dm, prev = 0, ds;
    var mPrev = f(0, 1);
    for (i = 1; i <= n; i++) {
      th = i * dth;
      m = f(th, 1);
      dm = (m - mPrev) / dth;
      // polar arc element sqrt(r^2 + r'^2) dtheta, midpoint-ish
      ds = Math.sqrt((m + mPrev) * (m + mPrev) / 4 + dm * dm) * dth;
      prev += ds;
      cum[i] = prev;
      mPrev = m;
    }
    return cum;
  }

  /** theta at a given cumulative arc length. */
  function thetaAt(cum, s) {
    var n = cum.length - 1;
    var total = cum[n];
    if (!(total > 0)) return 0;
    if (s <= 0) return 0;
    if (s >= total) return TAU;
    var lo = 0, hi = n, mid;
    while (hi - lo > 1) {
      mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    var span = cum[hi] - cum[lo] || 1;
    return (lo + (s - cum[lo]) / span) / n * TAU;
  }

  /**
   * Angular start + width for `n` slices whose fabric widths are `wt`,
   * distributed by arc length around `prof`.
   * @returns {{a0:Float64Array, aw:Float64Array}}
   */
  function arcSlices(prof, wt, n, a0Out, awOut) {
    var a0 = a0Out || new Float64Array(n);
    var aw = awOut || new Float64Array(n);
    var i, total = 0;
    for (i = 0; i < n; i++) total += wt && wt[i] > 0 ? wt[i] : 1;
    if (!(total > 0)) total = n || 1;
    if (!prof) {
      var acc = 0;
      for (i = 0; i < n; i++) {
        var w = (wt && wt[i] > 0 ? wt[i] : 1) / total * TAU;
        a0[i] = acc; aw[i] = w; acc += w;
      }
      return { a0: a0, aw: aw };
    }
    var cum = arcTable(prof);
    var L = cum[cum.length - 1];
    var run = 0, th0 = 0, th1;
    for (i = 0; i < n; i++) {
      run += (wt && wt[i] > 0 ? wt[i] : 1) / total;
      th1 = i === n - 1 ? TAU : thetaAt(cum, run * L);
      a0[i] = th0;
      aw[i] = th1 - th0;
      th0 = th1;
    }
    return { a0: a0, aw: aw };
  }

  /* --------------------------------------------------- 6. polygon scanning */

  /** A k a prior is allowed to assert, or 0. */
  function priorK(v) {
    var k = isNum(v) ? Math.round(v) : 0;
    for (var i = 0; i < POLY_PRIOR_KS.length; i++) if (POLY_PRIOR_KS[i] === k) return k;
    return 0;
  }

  /**
   * Best k for one round's increase sites, or 0.
   *
   * `prior` is `shape.corners` (01 §1.4.7's text fallback): when the sites are
   * missing or unreadable — fewer than three of them, or no k they cluster
   * into — the prior answers instead, with `prior: true` and a phase of 0 so
   * the caller can tell an asserted k from a measured one. Readable sites
   * always win, including when they say "spread increase, therefore circle":
   * that rejection lives in `classifyRounds`, which knows the round's dn.
   *
   * @param {number[]|null} siteList  increase-site indices, runs collapsed
   * @param {number} count            the round's stitch count
   * @param {number|object} [prior]    k, or `{corners:k}` / a normalised shape
   * @returns {{k:number, phase:number, dev:number, sites:number,
   *            prior:boolean}|null}
   */
  function polygonFit(siteList, count, prior) {
    var pk = priorK(prior && typeof prior === 'object' ? prior.corners : prior);
    var fallback = pk
      ? { k: pk, phase: 0, dev: 0, sites: 0, prior: true }
      : null;
    if (!siteList || siteList.length < 3 || count < 6) return fallback;
    var thetas = [], i;
    for (i = 0; i < siteList.length; i++) {
      thetas.push(((siteList[i] % count) + count) % count / count * TAU);
    }
    for (var ki = 0; ki < POLY_KS.length; ki++) {
      var k = POLY_KS[ki];
      if (thetas.length < Math.ceil(POLY_OCCUPANCY * k)) continue;
      if (thetas.length > k * 2) continue;       // too many sites for k corners
      var seg = TAU / k;
      // circular mean of the angles folded into one slice
      var sx = 0, sy = 0;
      for (i = 0; i < thetas.length; i++) {
        var u = thetas[i] % seg;
        sx += Math.cos(u * k); sy += Math.sin(u * k);
      }
      /* A weak resultant means the sites are spread across the slice, not
         clustered in it — e.g. 6 hexagon corners tested against k = 4. */
      if (Math.sqrt(sx * sx + sy * sy) / thetas.length < 0.5) continue;
      var mean = Math.atan2(sy, sx) / k;
      if (mean < 0) mean += seg;
      // deviation from the nearest slot, and which slots are occupied
      var tol = (Math.PI / k) / 3;
      var worst = 0, occupied = {}, nOcc = 0, ok = true;
      for (i = 0; i < thetas.length; i++) {
        var d = thetas[i] - mean;
        var slot = Math.round(d / seg);
        var dev = Math.abs(d - slot * seg);
        if (dev > tol) { ok = false; break; }
        if (dev > worst) worst = dev;
        var key = ((slot % k) + k) % k;
        if (!occupied[key]) { occupied[key] = 1; nOcc++; }
      }
      if (!ok) continue;
      if (nOcc < Math.ceil(POLY_OCCUPANCY * k)) continue;
      return { k: k, phase: -mean, dev: worst, sites: thetas.length, prior: false };
    }
    return fallback;
  }

  /* ------------------------------------------------------------ 7. classify */

  /**
   * Per-round shape class + the walked-out geometry of the whole piece.
   *
   * @param {object} model  Model v1 or v2
   * @returns {{mode:string, slack:number, closedTop:boolean,
   *            closedBottom:boolean, height:number, width:number,
   *            maxRadius:number, aspect:number, equatorFrac:number,
   *            corners:number, ruffles:number,
   *            rounds:Array<{kind:string, corners:number, chainLen:number,
   *              radius:number, perimeter:number, y:number, ruffle:boolean}>}}
   */
  function classify(model, opts) {
    var m = model || {};
    var o = opts || {};
    var mode = m.mode === 'rows' ? 'rows' : 'rounds';
    var rounds = arr(m.rounds) || [];
    var shape = shapeOf({ mode: mode, rounds: rounds, shape: m.shape });
    /* An explicit `opts.upsideDown` wins over the model's own flag, so a host
       can preview either way up without editing the store's shape. */
    var flip = o.upsideDown == null ? shape.upsideDown : o.upsideDown === true;
    return mode === 'rows'
      ? classifyRows(rounds, shape)
      : classifyRounds(rounds, shape, flip);
  }

  /* ------------------------------------------------------- 7a. the dome loft
     06 defect 2. Constant |dr| with constant h gives every round of a
     magic-ring opening the same rise — a constant slope, which is a CONE by
     construction. The panda Head came out at aspect 1.12 against 01's 1.11 and
     still read as an ice-cream cone with a needle apex; the turtle Shell, the
     bee bodies and the snowman Hat crown were cone frusta. Only a count
     plateau put any curvature in the picture.

     The curve the cone is missing is the stuffed sphere's. A sphere of radius R
     carries

         r = R*sin(phi)        y = R*(1 - cos(phi))

     and the FABRIC's own arc from one round to the next is R*dphi, so mapping
     cumulative arc to phi gives a rise per round of R*(cos(phi_prev) - cos(phi)):
     ~0 at the pole, where the surface is horizontal, growing to the round's
     full height at the equator, where it is vertical — all while |dr| stays
     constant. That is the dome.

     Which R? The one the fabric itself measures: a run of rounds that walks
     from ring radius r0 out to r1 spending `arc` of (slack-stretched) fabric is
     a section of the sphere with R*(asin(r1/R) - asin(r0/R)) = arc. So the loft
     takes nothing from outside the walk — the slack that already decides how
     much the fabric stretches decides the curvature too.

     Applied per MONOTONE RUN (pole -> equator, equator -> gathered close, and
     every shoulder between), with each run's TOTAL rise preserved, so the
     height, the equator and every aspect in 01 §2 stay exactly what the arc
     walk produced and only the distribution changes. Blended by slack:
     0 keeps the plain arc walk, 0.35 (a firmly stuffed part) is near-spherical.
     A ruffled round ends a run — a frill is not part of a dome. */

  /**
   * The arc a sphere of radius R spends walking from ring radius r0 out to r1.
   * Longest at R = r1 (the walk ends at the equator, a quarter turn), falling
   * monotonically to r1 - r0 as R grows (a flat annulus).
   */
  function sphereArc(r0, r1, R) {
    if (!(R > 0)) return 0;
    return R * (Math.asin(clamp(r1 / R, -1, 1)) - Math.asin(clamp(r0 / R, -1, 1)));
  }

  /**
   * The sphere a run is a section of: the R whose own arc from r0 to r1 is the
   * arc of fabric the run spends. Bisection, since `sphereArc` is monotone in R.
   * @returns {number} R; r1 when the fabric is stretched past a quarter turn,
   *   0 when no sphere fits at all (the run is flatter than a flat annulus —
   *   a disc, which has no dome to loft).
   */
  function loftRadius(r0, r1, arc) {
    if (!(r1 > r0) || !(arc > r1 - r0)) return 0;
    if (arc >= sphereArc(r0, r1, r1)) return r1;
    var lo = r1, hi = Math.min(LOFT_MAX_R, 2 * r1 + arc), k;
    while (hi < LOFT_MAX_R && sphereArc(r0, r1, hi) > arc) hi = Math.min(LOFT_MAX_R, hi * 2);
    for (k = 0; k < LOFT_ITERS; k++) {
      var mid = (lo + hi) / 2;
      if (sphereArc(r0, r1, mid) > arc) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /**
   * Redistribute one run's rise on the sphere law. `run.list` is in walk order
   * (top of the piece downward), `run.r0` the radius it starts from and
   * `run.dir` +1 for a run that grows, -1 for one that closes in — a closing
   * run is the same cap upside down, so it is walked from its own pole back up.
   */
  function loftRun(run, stretch, t) {
    var list = run.list, n = list.length, i;
    if (n < LOFT_MIN_RUN) return;
    var seq = run.dir > 0 ? list : list.slice().reverse();   // ascending radius
    var B = new Array(n + 1), a = new Array(n), arc = 0, total = 0;
    if (run.dir > 0) {
      B[0] = run.r0;
      for (i = 0; i < n; i++) B[i + 1] = seq[i].radius;
    } else {
      for (i = 0; i < n; i++) B[i] = seq[i].radius;
      B[n] = run.r0;
    }
    for (i = 0; i < n; i++) {
      a[i] = Math.max(0, seq[i].h) * stretch;
      arc += a[i];
      total += seq[i].dy;
    }
    if (!(arc > 0) || !(total > 0)) return;
    var R = loftRadius(B[0], B[n], arc);
    if (!(R > 0)) return;                    // flatter than a flat annulus
    var p0 = Math.asin(clamp(B[0] / R, -1, 1));
    var p1 = Math.asin(clamp(B[n] / R, -1, 1));
    var w = new Array(n), sum = 0, cum = 0, prev = p0;
    for (i = 0; i < n; i++) {
      cum += a[i];
      var phi = p0 + (p1 - p0) * (cum / arc);
      w[i] = Math.max(0, Math.cos(prev) - Math.cos(phi));
      sum += w[i];
      prev = phi;
    }
    if (!(sum > 0)) return;
    for (i = 0; i < n; i++) {
      var dy = (1 - t) * seq[i].dy + t * total * (w[i] / sum);
      seq[i].dy = Math.max(dy, DY_MIN * seq[i].h);
    }
  }

  /**
   * Split the walked rounds into monotone runs and loft each one.
   * Mutates `dy`; the caller re-walks `y` / `yTop` from it.
   */
  function loftDomes(out, shape, startR) {
    var t = clamp(shape.slack / LOFT_BLEND_AT, 0, 1);
    if (!(t > 0) || !out) return;
    var stretch = 1 / Math.max(0.1, 1 - shape.slack);
    var runs = monotoneRuns(realEntries(out), startR), i;
    for (i = 0; i < runs.length; i++) loftRun(runs[i], stretch, t);
  }

  /* ------------------------------------------------- 7b. the stuffed profile
     The three passes described at the STUFF_* constants, run in this order
     after the loft and before `y` is walked out:

       lidDomes  a run past the flat rate becomes a shallow cap  (rise only)
       wallBow   a straight run bows out            (radius only, COSMETIC)
       fillet    the meridian's bend radius is limited  (rise, then a bounded
                 radial ease where the corner is otherwise unavoidable)

     Every pass that spends height takes it back out of the straight run, and
     `stuffProfile` finishes by renormalising the rises onto the height the arc
     walk produced, so the piece's height is what it was to within floating
     point and `aspect` cannot move at all. */

  /** The entries that are real fabric: a zero-count or bridged round is not. */
  function realEntries(out) {
    var list = [], i;
    for (i = 0; i < (out ? out.length : 0); i++) {
      if (!out[i].empty && !out[i].outlier) list.push(out[i]);
    }
    return list;
  }

  /** How loudly the stuffing speaks: 0 at slack 0, 1 at SLACK_STUFFED. */
  function stuffScale(slack) { return clamp(slack / SLACK_STUFFED, 0, 1); }

  /**
   * The monotone runs of a fabric list, in walk order. `r0` is the ring each
   * run opens from, `dir` +1 for a run that grows and -1 for one that closes
   * in. A straight round or a frill ends a run: neither is part of a dome.
   */
  function monotoneRuns(list, startR) {
    var runs = [], cur = null, rPrev = startR, i, e, dir;
    for (i = 0; i < list.length; i++) {
      e = list[i];
      dir = 0;
      if (!e.ruffle) dir = e.radius > rPrev + 1e-9 ? 1 : (e.radius < rPrev - 1e-9 ? -1 : 0);
      if (dir && cur && cur.dir === dir) cur.list.push(e);
      else if (dir) { cur = { dir: dir, r0: rPrev, list: [e] }; runs.push(cur); }
      else cur = null;
      rPrev = e.radius;
    }
    return runs;
  }

  /**
   * The runs of rounds that REPEAT the ring above them — the WALL of a piece.
   * A repeated count adds no circumference, so the round can only become wall;
   * that is the height the fillet and the lid dome borrow from, and it is the
   * run the wall bow bows.
   */
  function straightRuns(list, startR) {
    var runs = [], cur = null, rPrev = startR, i, e;
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (!e.ruffle && Math.abs(e.radius - rPrev) < 1e-9) {
        if (cur) cur.push(e); else { cur = [e]; runs.push(cur); }
      } else cur = null;
      rPrev = e.radius;
    }
    return runs;
  }

  /** Depth of a spherical cap of sphere radius `rho`, at ring radius `r`. */
  function capDepth(rho, r) {
    var q = rho * rho - r * r;
    return rho - Math.sqrt(q > 0 ? q : 0);
  }

  /**
   * Take `want` of rise out of `pool`, in proportion to what each round has to
   * spare over FILLET_KEEP of its own stitch height — so a 0.95-tall wall round
   * lends and a 0.14-tall pole round does not.
   * @returns {number} what was actually taken; less than `want` if the pool ran dry
   */
  function takeRise(pool, want) {
    if (!(want > 0) || !pool || !pool.length) return 0;
    var s = [], spare = 0, i;
    for (i = 0; i < pool.length; i++) {
      s[i] = Math.max(0, pool[i].dy - FILLET_KEEP * Math.max(pool[i].h, 1e-6));
      spare += s[i];
    }
    if (!(spare > 0)) return 0;
    var take = Math.min(want, spare);
    for (i = 0; i < pool.length; i++) pool[i].dy -= take * (s[i] / spare);
    return take;
  }

  /**
   * Pay for `want` of extra rise somewhere else in the segment. The straight
   * run gives it up first — "compensate in the straight run": a wall has height
   * to lend, a pole and a frill do not — and anything else that is not `busy`
   * (i.e. not one of the rounds being paid for) covers the remainder.
   * @param {boolean[]} busy indexed like ctx.list
   * @returns {number} what was found
   */
  function payRise(ctx, want, busy) {
    if (!(want > 0)) return 0;
    var walls = [], rest = [], i;
    for (i = 0; i < ctx.list.length; i++) {
      if (busy && busy[i]) continue;
      if (ctx.list[i].ruffle) continue;       // a frill is slack, not tension
      if (ctx.isWall[i]) walls.push(ctx.list[i]); else rest.push(ctx.list[i]);
    }
    var got = takeRise(walls, want);
    if (got < want - 1e-12) got += takeRise(rest, want - got);
    return got;
  }

  /** Scale the rises back onto `target`, so the piece's height is exact. */
  function renormRise(list, target) {
    var sum = 0, i;
    for (i = 0; i < list.length; i++) sum += list[i].dy;
    if (!(sum > 0) || !(target > 0)) return 1;
    var k = target / sum;
    for (i = 0; i < list.length; i++) list[i].dy *= k;
    return k;
  }

  /**
   * 3 — THE LID DOME. A run that grows (or closes) past the flat rate has no
   * curved surface of revolution to lie on, so the walk lays it flat: the
   * baphomet Body/Head's 48 -> 36 close rises 0.019 of a 0.95 stitch and reads
   * as a serrated tin lid. Stuffing pushes such a lid into a shallow spherical
   * cap of sagitta LID_SAG of its own radius. Rise only ever grows: a run the
   * loft already domed is taller than the cap law and is skipped, so this pass
   * cannot flatten anything.
   */
  function lidDomes(ctx) {
    var res = { lids: 0, rise: 0, paid: 0 };
    if (!(ctx.sc > 0)) return res;
    var runs = monotoneRuns(ctx.list, ctx.startR), i, k;
    var busy = [];
    for (i = 0; i < runs.length; i++) {
      var run = runs[i], flat = false;
      for (k = 0; k < run.list.length; k++) if (run.list[k].flattened) flat = true;
      if (!flat) continue;
      var R = [run.r0];
      for (k = 0; k < run.list.length; k++) R.push(run.list[k].radius);
      var rOut = Math.max(R[0], R[R.length - 1]);
      var rIn = Math.min(R[0], R[R.length - 1]);
      var S = LID_SAG * ctx.sc * rOut;
      if (!(S > 0) || !(rOut > rIn)) continue;
      var rho = (rOut * rOut + S * S) / (2 * S);
      var want = Math.abs(capDepth(rho, rOut) - capDepth(rho, rIn));
      var have = 0;
      for (k = 0; k < run.list.length; k++) have += run.list[k].dy;
      if (!(want > have + 1e-9)) continue;    // already domed: leave it alone
      var got = 0;
      for (k = 0; k < run.list.length; k++) {
        var e = run.list[k];
        var d = Math.abs(capDepth(rho, R[k + 1]) - capDepth(rho, R[k]));
        e.dy = Math.max(d, DY_MIN * e.h);
        e.lid = true;
        busy[e.li] = true;
        got += e.dy;
      }
      res.lids++;
      res.rise += got - have;
    }
    if (res.rise > 0) res.paid = payRise(ctx, res.rise, busy);
    return res;
  }

  /**
   * 2 — THE WALL BOW. Yarn STRETCH, and COSMETIC by declaration, so it is the
   * one thing here that does not touch `radius`: a ring's radius is its stitch
   * count over 2pi and that is what the piece is measured by. The bow is a
   * separate fraction, `bow`, which `radiusDraw` carries into the bands that get
   * drawn and into the `radiusMax` the fit reserves — and into nothing else, so
   * `width`, `aspect`, the equator and every per-round radius the gallery prints
   * are exactly the numbers the stitch counts asked for.
   */
  function wallBow(ctx) {
    var res = { runs: 0, max: 0 };
    var amp = WALL_BOW * ctx.sc;
    if (!(amp > 0)) return res;
    var runs = ctx.straight, i, j;
    for (i = 0; i < runs.length; i++) {
      var run = runs[i], m = run.length;
      if (m < WALL_BOW_MIN) continue;
      res.runs++;
      for (j = 0; j < m; j++) {
        /* pinned at both ends of the run, a full sine bulge between them */
        var f = amp * Math.sin(Math.PI * (j / (m - 1)));
        if (!(f > 1e-12)) continue;
        run[j].bow = f;
        if (f > res.max) res.max = f;
      }
    }
    return res;
  }

  /**
   * 1 — THE PROFILE FILLET. Limit the meridian's bend radius to FILLET_BEND
   * stitch heights by moving rings along y, then — only where that cannot do it
   * — by a radial ease of at most FILLET_EASE.
   *
   * The relaxation: at every interior ring whose discrete bend radius
   * L / theta is under the limit, the two segments meeting there are short by
   * `FILLET_BEND * h * theta - L` between them. Asking for twice that (each
   * segment's length grows by at most the rise it gains) spread over the ring's
   * own two segments and FILLET_SPAN - 1 more either side both LENGTHENS the
   * segments and, because a longer segment is a steeper one, REDUCES the turn.
   * Damped by FILLET_RELAX and iterated, which is what makes a shoulder round
   * off over two rounds instead of jumping.
   */
  function fillet(ctx) {
    var list = ctx.list, m = list.length;
    var res = { passes: 0, corners: 0, eased: 0, easeMax: 0, rise: 0 };
    if (!(ctx.sc > 0) || m < 3) return res;
    var R = new Array(m + 1), Y = new Array(m + 1), d = new Array(m + 1);
    var req = new Array(m + 1), busy = new Array(m);
    var i, j, k;

    function rings() {
      R[0] = ctx.startR; Y[0] = 0;
      for (i = 0; i < m; i++) {
        R[i + 1] = list[i].radius;
        d[i + 1] = list[i].dy;
        Y[i + 1] = Y[i] - d[i + 1];
      }
    }
    /* Discrete bend radius at ring j, in that round's own stitch heights: the
       mean of the two segment lengths over the turn between them. */
    function bendAt(j) {
      var ax = R[j] - R[j - 1], ay = Y[j] - Y[j - 1];
      var bx = R[j + 1] - R[j], by = Y[j + 1] - Y[j];
      var la = Math.sqrt(ax * ax + ay * ay), lb = Math.sqrt(bx * bx + by * by);
      if (!(la > 0) || !(lb > 0)) return { r: Infinity, th: 0, L: 0 };
      var th = Math.acos(clamp((ax * bx + ay * by) / (la * lb), -1, 1));
      var L = (la + lb) / 2;
      return { r: th > 1e-6 ? L / th / Math.max(list[j - 1].h, 1e-6) : Infinity, th: th, L: L };
    }
    /* A frill is not a stuffed corner — it is a buckle whose radial jump no
       amount of height can round off — so a vertex either side of one is left
       to its own wave. */
    function skip(j) {
      return list[j - 1].ruffle || (j < m && list[j].ruffle);
    }

    var tries, sharp;
    for (tries = 0; tries < FILLET_TRIES; tries++) {
      var pass;
      for (pass = 0; pass < FILLET_ITERS; pass++) {
        rings();
        for (j = 0; j <= m; j++) req[j] = 0;
        for (j = 0; j < m; j++) busy[j] = false;
        sharp = 0;
        var total = 0;
        for (j = 1; j < m; j++) {
          if (skip(j)) continue;
          var b = bendAt(j);
          if (!(b.r < FILLET_BEND)) continue;
          sharp++;
          var need = FILLET_BEND * Math.max(list[j - 1].h, 1e-6) * b.th - b.L;
          if (!(need > 0)) continue;
          var ask = 2 * need * FILLET_RELAX;
          for (k = 1 - FILLET_SPAN; k <= FILLET_SPAN; k++) {
            var seg = j + k;
            if (seg < 1 || seg > m) continue;
            if (list[seg - 1].ruffle) continue;
            var w = (k === 0 || k === 1) ? 1 : 0.5;
            var v = ask * w / (2 * FILLET_SPAN - 1);
            if (v > req[seg]) req[seg] = v;
          }
        }
        if (!sharp) break;
        res.passes++;
        for (j = 1; j <= m; j++) {
          total += req[j];
          if (req[j] > 0) busy[j - 1] = true;
        }
        if (!(total > 0)) break;
        var found = payRise(ctx, total, busy);
        if (!(found > 1e-12)) break;          // nothing left to lend
        var scale = found / total;
        for (j = 1; j <= m; j++) {
          if (!(req[j] > 0)) continue;
          /* ...but never past the stretch ceiling: a round of h-tall stitches
             cannot rise more than h/(1 - s) however much the corner wants, which
             is the same limit 01 §1.1's sqrt spends on |dr|. Whatever the ceiling
             refuses, `renormRise` hands back to the piece at the end. */
          var e = list[j - 1];
          var room = Math.max(0, e.h * ctx.stretch - e.dy);
          e.dy += Math.min(req[j] * scale, room);
        }
        res.rise += found;
      }
      if (!sharp) break;
      if (tries + 1 >= FILLET_TRIES) break;
      /* Height alone cannot round a corner where the profile REVERSES radially
         — the baphomet's FLO waist turns 96 degrees at a 0.32-wide step — so
         ease the ring itself toward the chord its neighbours draw. Bounded by
         FILLET_EASE, slack-scaled, and never applied to the widest ring: the
         equator is what 01 §2's aspect is measured against and it is not
         negotiable, so the piece's measured width is still the one the stitch
         counts asked for. */
      rings();
      for (j = 1; j < m; j++) {
        var e = list[j - 1];
        if (skip(j) || e.ruffle) continue;
        if (!(bendAt(j).r < FILLET_BEND)) continue;
        if (Math.abs((e.radiusMax || e.radius) - ctx.maxR) < 1e-9) continue;
        var span = Y[j + 1] - Y[j - 1];
        if (!(Math.abs(span) > 1e-9)) continue;
        var tgt = R[j - 1] + (R[j + 1] - R[j - 1]) * ((Y[j] - Y[j - 1]) / span);
        var r0 = e.radius;
        var lim = FILLET_EASE * ctx.sc * Math.max(r0, R_MIN);
        var dr = clamp(tgt - r0, -lim, lim);
        if (!(Math.abs(dr) > 1e-9)) continue;
        e.radius = Math.max(R_MIN, r0 + dr);
        e.meanRadius = e.radius;
        e.ease = (e.ease || 0) + dr;
        res.eased++;
        /* measured against the ring the count asked for, so `easeMax` is
           directly comparable with FILLET_EASE */
        var frac = Math.abs(e.radius - r0) / Math.max(r0, 1e-6);
        if (frac > res.easeMax) res.easeMax = frac;
      }
    }

    rings();
    res.corners = 0;
    for (j = 1; j < m; j++) {
      if (skip(j)) continue;
      if (bendAt(j).r < FILLET_BEND) res.corners++;
    }
    return res;
  }

  /**
   * Run the three stuffed-profile passes over a walked-out round list.
   * Mutates `dy` and (for the bow and the ease) `radius`; the caller re-walks
   * `y` from the result. Returns the report `classify` publishes as `stuff`.
   */
  function stuffProfile(out, shape, startR, maxR) {
    var res = {
      applied: false, slack: shape.slack, scale: 0,
      lids: 0, lidRise: 0, bowRuns: 0, bowMax: 0,
      filletPasses: 0, filletRise: 0, corners: 0, eased: 0, easeMax: 0,
      renorm: 1
    };
    if (!out || shape.slack < STUFF_MIN_SLACK) return res;
    var list = realEntries(out), i;
    if (list.length < 2) return res;
    var ctx = {
      list: list, startR: startR, maxR: maxR,
      sc: stuffScale(shape.slack), isWall: [], straight: null,
      /* the most a round of h-tall stitches can rise, 01 §1.1's own ceiling */
      stretch: 1 / Math.max(0.1, 1 - shape.slack)
    };
    for (i = 0; i < list.length; i++) { list[i].li = i; ctx.isWall[i] = false; }
    ctx.straight = straightRuns(list, startR);
    for (i = 0; i < ctx.straight.length; i++) {
      for (var j = 0; j < ctx.straight[i].length; j++) ctx.isWall[ctx.straight[i][j].li] = true;
    }
    var height0 = 0;
    for (i = 0; i < list.length; i++) height0 += list[i].dy;

    var lid = lidDomes(ctx);
    var bow = wallBow(ctx);
    var fil = fillet(ctx);

    res.applied = true;
    res.scale = ctx.sc;
    res.lids = lid.lids; res.lidRise = lid.rise;
    res.bowRuns = bow.runs; res.bowMax = bow.max;
    res.filletPasses = fil.passes; res.filletRise = fil.rise;
    res.corners = fil.corners; res.eased = fil.eased; res.easeMax = fil.easeMax;
    res.renorm = renormRise(list, height0);
    return res;
  }

  /**
   * The meridian's tightest bend, in stitch heights, for a classified piece.
   * Vertices either side of a frill are excluded (`minAll` includes them), and
   * the first ring is the one `startRadius` opens from, at the first round's own
   * `yTop` — so the measurement is the same whichever way up the piece is.
   * @returns {{min:number, at:number, sharp:number, minAll:number, n:number}}
   */
  function bendProfile(cls) {
    var res = { min: Infinity, at: -1, sharp: 0, minAll: Infinity, n: 0 };
    if (!cls || cls.mode !== 'rounds') return res;
    var list = realEntries(cls.rounds || []);
    if (list.length < 2) return res;
    var R = [startRadius(cls.shape || {}, list[0].radius)];
    var Y = [list[0].yTop], H = [list[0].h], i;
    for (i = 0; i < list.length; i++) { R.push(list[i].radius); Y.push(list[i].y); H.push(list[i].h); }
    res.n = list.length;
    for (i = 1; i < list.length; i++) {
      var ax = R[i] - R[i - 1], ay = Y[i] - Y[i - 1];
      var bx = R[i + 1] - R[i], by = Y[i + 1] - Y[i];
      var la = Math.sqrt(ax * ax + ay * ay), lb = Math.sqrt(bx * bx + by * by);
      if (!(la > 0) || !(lb > 0)) continue;
      var th = Math.acos(clamp((ax * bx + ay * by) / (la * lb), -1, 1));
      if (!(th > 1e-6)) continue;
      var r = ((la + lb) / 2) / th / Math.max(H[i], 1e-6);
      if (r < res.minAll) res.minAll = r;
      if (list[i - 1].ruffle || (i < list.length && list[i].ruffle)) continue;
      if (r < res.min) { res.min = r; res.at = i; }
      if (r < FILLET_BEND) res.sharp++;
    }
    return res;
  }

  function classifyRounds(rounds, shape, flip) {
    var n = rounds.length, i;
    var met = [], sit = [], fit = [], spread = [];
    var bridged = outlierFlags(rounds, 'rounds');

    for (i = 0; i < n; i++) {
      met.push(roundMetrics(rounds[i]));
      sit.push(sites(rounds[i]));
    }

    /* chevron veto first: a round with k increase sites AND k decrease sites
       at net zero is rippled fabric, never a polygon (01 §1.4.6) */
    var ripple = [];
    for (i = 0; i < n; i++) {
      var prevCount = i > 0 ? met[i - 1].count : met[i].count;
      var dn = met[i].count - prevCount;
      var nInc = sit[i].inc ? sit[i].inc.length : 0;
      var nDec = sit[i].dec ? sit[i].dec.length : 0;
      var nf = flatRate(met[i].h, 1);
      ripple.push(nInc >= 2 && nDec >= 2 && Math.abs(dn) <= Math.max(1, 0.15 * nf));
      var pf = ripple[i] ? null : polygonFit(sit[i].inc, met[i].count);
      /* A CORNER takes a group — `(3 dc, ch 2, 3 dc) in the corner sp` — so a
         polygon gains at least two stitches per site per round. One extra
         stitch at k evenly spaced places is a SPREAD increase, i.e. a circle:
         that is what "+6 sc per round" is, and it is not a hexagon. This is
         the test that keeps every amigurumi sphere round — and it is a POSITIVE
         verdict about readable sites, so `spread[i]` records it and the text
         prior below is not allowed to overrule it. */
      spread.push(!!(pf && i > 0 && dn / pf.sites < POLY_MIN_PER_SITE));
      if (spread[i]) pf = null;
      fit.push(pf);
    }

    /* persistence: the same k with the same phase for >= POLY_RUN rounds */
    var polyK = new Array(n), polyPhase = new Array(n);
    i = 0;
    while (i < n) {
      if (!fit[i]) { i++; continue; }
      var k = fit[i].k, j = i + 1, sum = fit[i].phase, cnt = 1;
      var seg = TAU / k, tol = Math.PI / k;
      while (j < n && fit[j] && fit[j].k === k) {
        var d = fit[j].phase - fit[i].phase;
        d -= Math.round(d / seg) * seg;
        if (Math.abs(d) > tol / 2) break;
        sum += fit[i].phase + d; cnt++; j++;
      }
      if (j - i >= POLY_RUN) {
        var phase = sum / cnt;
        for (var q = i; q < j; q++) { polyK[q] = k; polyPhase[q] = phase; }
      }
      i = j > i ? j : i + 1;
    }

    /* The TEXT PRIOR (01 §1.4.7, 07 D1). `shape.corners` fills in every round
       the site scan could not speak for: no positioned `inc` markers at all
       (the granny-square case — `Patterns.expand` returns a flat count for
       `(3 dc, ch 3, 3 dc) in corner sp`), or sites that cluster into no k, or a
       k that could not hold a phase for POLY_RUN rounds. It does NOT overrule a
       measured k, a chevron, or a round whose sites positively say "spread
       increase, therefore circle". It starts at the third round worked: rounds
       1–2 are the start ring and the round around it, with no side between the
       corners yet. `kfPrior` then carries the k-gon flat rate across the WHOLE
       walk below — a square worked at 1.273x the circle's rate lies flat, and
       measuring its round 2 against the circle is what made it ruffle. */
    var prior = shape.corners || 0;
    var kfPrior = 1;
    var priorRounds = 0;
    var priorUsed = new Array(n);
    if (prior) {
      kfPrior = polygonRatios(prior).flat;
      /* One phase for the whole piece, so the prior rounds line their corners
         up with any round the sites did measure instead of twisting past it. */
      var priorPhase = 0;
      for (i = 0; i < n; i++) {
        if (polyK[i] === prior) { priorPhase = polyPhase[i]; break; }
        if (fit[i] && fit[i].k === prior && !fit[i].prior) { priorPhase = fit[i].phase; break; }
      }
      var ord = 0;
      for (i = 0; i < n; i++) {
        if (met[i].empty || bridged[i]) continue;   // not fabric: not a round
        ord++;
        if (polyK[i] || ripple[i] || spread[i]) continue;
        if (ord <= POLY_PRIOR_FROM) continue;
        var pfp = polygonFit(null, met[i].count, prior);
        if (!pfp) continue;
        polyK[i] = pfp.k; polyPhase[i] = priorPhase;
        priorUsed[i] = true;
        priorRounds++;
      }
    }

    /* a chain-oval start carries its stadium until the increases stop matching */
    var ovalOn = shape.start === 'chain-oval' && shape.chainLen > 0;
    var straight = ovalOn ? shape.chainLen * SW : 0;

    var out = [];
    var prevR = 0, maxR = 0, ruffles = 0, corners = 0, flattened = 0, grannies = 0;
    var firstR = 0, firstIdx = -1;
    for (i = 0; i < n; i++) {
      if (!met[i].empty && !bridged[i]) {
        firstR = Math.max(R_MIN, met[i].perimeter / TAU); firstIdx = i; break;
      }
    }
    prevR = startRadius(shape, firstR);

    /* GRANNY FABRIC (GRANNY_FLAT). Every ring radius is `perimeter / 2pi` and
       the start radius, so the whole growth series is known before any rise is
       walked — which is what lets the verdict be about the PIECE and not just
       the round in hand. `grannyRatio[i]` is the round's growth as a fraction
       of the k-gon flat rate it is measured against, for the rounds that carry
       a k-gon rate at all (a measured k, or the text prior's k across the whole
       walk); a plain ring, a chevron and an oval get none and are untouched.
       A round is granny fabric when its OWN ratio clears GRANNY_FLAT, or when
       the piece's does: the median over the piece is robust to the ring-opening
       round (the hood's round 1 grows out of a ch-6 ring, so its apparent
       growth is short by the ring) and to one corner space the parser counted
       differently, and the hood's rounds 1–2 — the start ring and the round
       around it, still circular because the corners have not formed yet — are
       the same granny fabric as round 3 whichever height the trebles arrive at.
       A deliberate bowl has no round over the bar and a low median, so it keeps
       every bit of its rise. */
    var grannyRatio = new Array(n);
    var grannyOn = false;
    var ovalStart = shape.start === 'chain-oval' && shape.chainLen > 0;
    var anyPoly = false;
    for (i = 0; i < n; i++) if (polyK[i]) anyPoly = true;
    if (prior > 0 || anyPoly) {
      var gr = [], rPrev = prevR;
      for (i = 0; i < n; i++) {
        if (met[i].empty || bridged[i]) continue;
        var rNow = Math.max(R_MIN, met[i].perimeter / TAU);
        /* the same kf the walk below picks, for the cases that have one */
        var kfi = ripple[i] ? 1
          : polyK[i] ? polygonRatios(polyK[i]).flat
            : (!ovalStart && prior > 0 && !spread[i]) ? kfPrior : 1;
        if (kfi > 1 && met[i].hw > 0 && rNow > rPrev) {
          grannyRatio[i] = (1 - shape.slack) * (rNow - rPrev) / (met[i].hw * kfi);
          gr.push(grannyRatio[i]);
        }
        rPrev = rNow;
      }
      if (gr.length) {
        gr.sort(function (a, b) { return a - b; });
        var mid = gr.length >> 1;
        var median = gr.length % 2 ? gr[mid] : (gr[mid - 1] + gr[mid]) / 2;
        grannyOn = median >= GRANNY_FLAT;
      }
    }

    for (i = 0; i < n; i++) {
      var mt = met[i];
      var h = mt.hw;
      var entry = {
        index: i, kind: 'ring', corners: 0, chainLen: 0, straight: 0, endR: 0,
        perimeter: mt.perimeter, radius: prevR, meanRadius: prevR,
        y: 0, yTop: 0, h: h, dy: 0, ruffle: false, empty: mt.empty,
        outlier: !!bridged[i],
        prof: null, lobes: 0, slack: shape.slack, count: mt.count
      };

      if (mt.empty || bridged[i]) {
        /* A zero count is a row the parser could not read; an OUTLIER is a row
           it read wrong (07 D4) — a round of 1 between rounds of 22. Neither is
           fabric: inherit the ring above so the rounds either side join,
           instead of pinching a hole (04 defect F) or tearing the piece. */
        entry.radius = entry.meanRadius = prevR;
        entry.dy = 0;
        out.push(entry);
        continue;
      }

      var rFlatCirc = Math.max(R_MIN, mt.perimeter / TAU);
      var dr = rFlatCirc - prevR;
      var adr = Math.abs(dr);
      var dy, ruffle = false;

      /* The cross-section first, because it changes the flat rate: a k-gon of
         the same perimeter absorbs 2k·tan(pi/k)/2pi times as many stitches per
         round as a circle and still lies flat (01 §1.4). A square worked at
         1.27× the circle rate IS flat; measured against the circle it would
         look like a ruffle.
         `kfPrior` then carries an ASSERTED k's flat rate across every round,
         including the first two that keep a circular cross-section: the fabric
         is a k-gon from the first stitch, only its corners arrive later. A
         round whose sites positively say "spread increase, therefore circle"
         opts out of the prior's rate as well as its shape. */
      var kf = 1;
      var kind = 'ring';
      var polyk = 0;
      var priorRelax = false;
      if (ripple[i]) kind = 'ripple';
      else if (polyK[i]) {
        kind = 'polygon';
        polyk = polyK[i];
        kf = polygonRatios(polyk).flat;
        priorRelax = prior > 0;
        entry.fromPrior = !!priorUsed[i];   // asserted by the text, not measured
      } else if (ovalOn) kind = 'oval';
      else if (prior > 0 && !spread[i]) { kf = kfPrior; priorRelax = true; }

      /* The first round is worked INTO the start ring, not wrapped around it
         from a previous round, so its apparent |dr| is whatever radius it opens
         out to. That is not a ruffle — it is the pole (a magic ring, covered by
         the cap) or the pinhole of a motif's chain ring. */
      var isFirstFromRing = i === firstIdx &&
        (shape.closedTop || (shape.start === 'chain-ring' && shape.chainLen > 0 &&
          shape.chainLen * SW / TAU < firstR));

      /* A round the TEXT says is a corner of a k-gon is allowed to be a little
         past its own flat rate and still lie flat (POLY_FLAT_TOL): the text is
         independent evidence and the stitch height is the soft number. Measured
         sites get no such allowance — if they say the fabric grows faster than
         it can lie flat, it frills. */
      /* 06 defect 1. The rise below spends (1 - slack)*|dr|, so the gate has to
         measure the SAME quantity: a firmly stuffed piece stretches over |dr|
         up to h/(1 - 0.35) = 1.54h before any surplus is left over, and gating
         the raw |dr| at 1.08h declared every ordinary amigurumi shaping round
         (dn >= 7 sc) a frill — 13 of the baphomet Body/Head's 33 rounds, the
         whole crown of the bear Head, the cato Head's gathered close. A
         decrease of -N_flat on a stuffed ball is a pole, not a frill.
         Where there IS surplus, STUFFED_FLAT_TOL decides whether it buckles:
         a piece held out from inside pushes it into the ball's own curve. */
      var adrEff = (1 - shape.slack) * adr;
      var reach = h * kf / Math.max(0.1, 1 - shape.slack);   // radius the fabric can span
      var flatTol = priorRelax ? POLY_FLAT_TOL : 1 + RUFFLE_EPS;
      if (shape.slack >= SLACK_STUFFED && STUFFED_FLAT_TOL > flatTol) flatTol = STUFFED_FLAT_TOL;
      var ruffleAt = h * kf * flatTol;
      if (!isFirstFromRing && adrEff > ruffleAt && h > 0) {
        /* No surface of revolution exists: the surplus buckles (01 §1.7).
           The ring keeps the radius its circumference demands — suppressing it
           to the flat-rate radius cascades into every later round — and the
           surplus goes into an m-lobed wave about it. */
        ruffle = true;
        var rFlat = prevR + (dr > 0 ? reach : -reach);
        if (rFlat < R_MIN) rFlat = R_MIN;
        var e = Math.max(0, rFlatCirc / rFlat - 1);
        var lobes = (sit[i].inc && sit[i].inc.length >= 3)
          ? sit[i].inc.length
          : clamp(Math.round(mt.count / 8), 5, 14);
        var eps = Math.min(0.55, (2 / lobes) * Math.sqrt(e));
        entry.radius = entry.meanRadius = rFlatCirc;
        entry.prof = profileWave(lobes, eps);
        entry.lobes = lobes;
        entry.ruffle = true;
        ruffles++;
        dy = RUFFLE_RISE * h;
      } else {
        entry.radius = entry.meanRadius = rFlatCirc;
        var q = h > 0 ? Math.min(1, adrEff / (h * kf)) : 1;
        /* past the flat rate its own slack can absorb, but held flat by the
           text prior or by the stuffing behind it: say so (`dy` goes to the
           DY_MIN floor here, and the loft below spreads the run's rise over
           this round too, so a flat shoulder no longer reads as a hard ledge) */
        if (adrEff > h * kf * (1 + RUFFLE_EPS)) { entry.flattened = true; flattened++; }
        /* GRANNY FABRIC (GRANNY_FLAT). A k-gon round growing at 0.55 or more of
           its own flat rate is a granny round: its clusters splay, so the height
           the arc walk is dividing by is too tall and the shortfall is not rise.
           Lay it flat. A ring never reaches here (kf = 1 leaves grannyRatio
           unset), and a bowl at 0.37 of the rate keeps its arc. */
        if (grannyRatio[i] != null && (grannyOn || grannyRatio[i] >= GRANNY_FLAT)) {
          entry.granny = true; grannies++;
          dy = 0;
        } else dy = h * Math.sqrt(Math.max(0, 1 - q * q));
      }
      if (dy < DY_MIN * h) dy = DY_MIN * h;

      /* the cross-section (a ruffle keeps its own buckling wave) */
      if (!ruffle) {
        if (kind === 'ripple') {
          entry.kind = 'ripple';
          entry.lobes = (sit[i].inc && sit[i].inc.length) || 0;
          if (entry.lobes >= 2) entry.prof = profileWave(entry.lobes, RIPPLE_AMP);
        } else if (kind === 'polygon') {
          var nfk = flatRate(mt.h * SH_SC, 1) * kf;
          var dnk = i > 0 ? mt.count - met[i - 1].count : mt.count;
          /* 01 §1.4's own words for SHARP_FLAT are "granny corners", so a round
             the granny rule laid flat takes them whatever the rate test makes of
             its height — otherwise the hood's cross-section changed shape when
             its trebles changed height, at the same flat fabric. */
          var sharp = entry.granny || Math.abs(dnk - nfk) <= 0.25 * nfk
            ? SHARP_FLAT : SHARP_SOFT;
          entry.kind = 'polygon';
          entry.corners = polyk;
          entry.prof = profilePolygon(polyk, polyPhase[i], sharp);
          if (polyk > corners) corners = polyk;
        } else if (kind === 'oval') {
          var endR = (mt.perimeter - 2 * straight) / TAU;
          if (endR >= OVAL_MIN_END) {
            entry.kind = 'oval';
            entry.straight = straight;
            entry.chainLen = shape.chainLen;
            entry.endR = endR;
            entry.prof = profileStadium(straight, endR, entry.radius);
          } else {
            // the ends have caught up with the straight run: it is a circle now
            ovalOn = false;
          }
        }
      }

      /* Consecutive rounds of the same class share one profile object, so a
         band's blend is a no-op and its hash is stable across rebuilds. */
      if (entry.prof && out.length) {
        var pp = out[out.length - 1].prof;
        if (pp && pp.sig === entry.prof.sig) entry.prof = pp;
      }

      entry.dy = dy;   // `y` / `yTop` are walked out below, after the loft
      var rng = profileRange(entry.prof);
      entry.radiusMax = entry.radius * rng.max;
      entry.radiusMin = entry.radius * rng.min;
      if (entry.radiusMax > maxR) maxR = entry.radiusMax;
      prevR = entry.radius;
      out.push(entry);
    }

    /* A DOME, not a cone (06 defect 2): redistribute each monotone run's rise
       on the stuffed-sphere law, then re-walk `y` from the new rises. The
       run totals are preserved, so `height`, the equator and every aspect in
       01 §2 are exactly what the arc walk produced. */
    var startR = startRadius(shape, firstR);
    loftDomes(out, shape, startR);

    /* ...and a STUFFED one is not a drum either (the STUFF_* note above): the
       flat lid domes, the straight wall bows, and no corner of the meridian
       bends tighter than the fabric can. Height in, height out, so `height`,
       the equator and every aspect in 01 §2 are still the arc walk's own. */
    var stuff = stuffProfile(out, shape, startR, maxR);

    var yWalk = 0;
    for (i = 0; i < out.length; i++) {
      out[i].yTop = yWalk;
      yWalk -= out[i].dy;
      out[i].y = yWalk;
    }
    var height = -yWalk;
    /* the equator is the CENTRE of the max-radius plateau (01 §1.6), still
       measured on the rings the counts asked for: the fillet's radial ease
       never touches the widest ring and the wall bow never touches `radius`
       at all, so this picks exactly the rounds it picked before */
    var first = -1, last = -1;
    for (i = 0; i < out.length; i++) {
      if (out[i].empty || out[i].outlier) continue;
      if (out[i].radiusMax >= maxR - 1e-9) { if (first < 0) first = i; last = i; }
    }
    var eqY = 0;
    if (first >= 0) eqY = -((out[first].y + out[last].y) / 2);

    /* THE RING THAT GETS DRAWN. `radius` is the fabric's own, from the stitch
       count; `radiusDraw` adds the cosmetic wall bow, and `radiusMax` /
       `radiusMin` — the reach the fit reserves and the renderer's `radMax` —
       follow it, so a bowed wall is never clipped. `maxRadius` above
       deliberately does not, which is why no aspect in 01 §2 moves. */
    for (i = 0; i < out.length; i++) {
      var rg = profileRange(out[i].prof);
      out[i].radiusDraw = out[i].radius * (1 + (out[i].bow || 0));
      out[i].radiusMax = out[i].radiusDraw * rg.max;
      out[i].radiusMin = out[i].radiusDraw * rg.min;
    }

    /* ORIENTATION (`layout(model, {upsideDown:true})`, `shape.upsideDown`).
       A part the text works from the bottom up — "starting from the bottom of
       the body", "start at the base" — is the same fabric the other way up, so
       nothing above changes: only the finished piece is mirrored. `y` is
       reflected about the piece's own mid-height, so it still occupies
       [-height, 0] and the fit, the contact shadow and the ghost cage need no
       special case; `closedTop` / `closedBottom` swap, because they name the
       piece's geometric ENDS rather than its rounds (`shape.closedTop` and
       `shape.closedBottom` keep naming round 1's ring and the gather, which is
       what the renderer needs to know WHICH BAND each cap belongs to); and the
       equator is still a fraction of the height measured from the top. */
    if (flip) {
      for (i = 0; i < out.length; i++) {
        out[i].yTop = -out[i].yTop - height;
        out[i].y = -out[i].y - height;
      }
      if (height > 0) eqY = height - eqY;
    }

    return {
      mode: 'rounds',
      rounds: out,
      slack: shape.slack,
      form: shape.form,
      shape: shape,
      upsideDown: !!flip,
      closedTop: flip ? shape.closedBottom : shape.closedTop,
      closedBottom: flip ? shape.closedTop : shape.closedBottom,
      height: height,
      maxRadius: maxR,
      width: 2 * maxR,
      aspect: maxR > 0 ? height / (2 * maxR) : 0,
      equatorFrac: height > 0 ? clamp(eqY / height, 0, 1) : 0,
      equatorRound: first >= 0 ? Math.round((first + last) / 2) : -1,
      stuff: stuff,
      corners: corners,
      cornersSource: corners ? (priorRounds > 0 && corners === prior ? shape.cornersSource || 'text' : 'sites') : null,
      priorK: prior,
      priorRounds: priorRounds,
      outliers: countTrue(bridged),
      flattened: flattened,
      granny: grannies,
      grannyFabric: grannyOn,
      ruffles: ruffles
    };
  }

  function countTrue(flags) {
    var k = 0;
    for (var i = 0; i < (flags ? flags.length : 0); i++) if (flags[i]) k++;
    return k;
  }

  /* ------------------------------------------------------------ rows mode */

  /**
   * Where a row grows. `anchor` is the direction of growth, so the OTHER edge
   * is the straight one: 'left' keeps the right edge straight, 'right' keeps
   * the left edge straight, 'center' grows both ways, 'spine' is a centre
   * increase every row (a triangle from a point).
   */
  function rowsAnchor(rounds) {
    var nLeft = 0, nRight = 0, nSpine = 0, nBoth = 0, i;
    for (i = 0; i < rounds.length; i++) {
      var r = rounds[i] || {};
      var count = Math.max(1, r.count | 0);
      var s = sites(r);
      if (!s.inc || !s.inc.length) continue;
      var edge = Math.max(1, Math.round(count * 0.1));
      var lo = false, hi = false, mid = false;
      for (var j = 0; j < s.inc.length; j++) {
        var ix = s.inc[j];
        if (ix <= edge) lo = true;
        else if (ix >= count - 1 - edge) hi = true;
        else if (Math.abs(ix - count / 2) <= Math.max(1, count * 0.12)) mid = true;
      }
      if (mid && !lo && !hi) nSpine++;
      else if (lo && hi) nBoth++;
      else if (lo) nLeft++;
      else if (hi) nRight++;
    }
    if (nSpine >= 2 && nSpine >= nLeft && nSpine >= nRight) return 'spine';
    if (nBoth >= nLeft && nBoth >= nRight && nBoth > 0) return 'center';
    if (nLeft > nRight) return 'left';
    if (nRight > nLeft) return 'right';
    return 'center';
  }

  function classifyRows(rounds, shape) {
    var n = rounds.length, i;
    var anchor = rowsAnchor(rounds);
    /* 07 D4: a row of 2 or 5 among rows of 405 is a line the parser misread,
       and laying it out at full width ratio tore the sheet into detached
       pieces. It is not fabric, so it is not in the width either. */
    var bridged = outlierFlags(rounds, 'rows');
    var met = [], maxW = 0;
    for (i = 0; i < n; i++) {
      var mt = roundMetrics(rounds[i]);
      met.push(mt);
      if (!bridged[i] && mt.perimeter > maxW) maxW = mt.perimeter;
    }
    if (!(maxW > 0)) maxW = SW;

    var out = [], y = 0, totalH = 0, rowCount = 0;
    for (i = 0; i < n; i++) {
      var w = met[i].perimeter;
      var h = met[i].hw;
      var x0;
      if (bridged[i]) {
        /* No band, no height, no width: the row above and the row below join
           across it. The entry stays in place so every index the model, the
           renderer and the store share still lines up. */
        out.push({
          index: i, kind: 'row', corners: 0, chainLen: 0,
          perimeter: w, width: 0, radius: 0, meanRadius: 0,
          radiusMax: 0, radiusMin: 0,
          h: 0, dy: 0, y: y, yTop: y, x0: 0, anchor: anchor,
          ruffle: false, empty: met[i].empty, outlier: true, prof: null,
          count: met[i].count
        });
        continue;
      }
      if (anchor === 'left') x0 = maxW / 2 - w;
      else if (anchor === 'right') x0 = -maxW / 2;
      else x0 = -w / 2;
      out.push({
        index: i, kind: 'row', corners: 0, chainLen: 0,
        perimeter: w, width: w, radius: w / 2, meanRadius: w / 2,
        radiusMax: w / 2, radiusMin: w / 2,
        h: h, dy: h, y: y, yTop: y + h, x0: x0, anchor: anchor,
        ruffle: false, empty: met[i].empty, outlier: false, prof: null,
        count: met[i].count
      });
      y += h;
      totalH += h;
      rowCount++;
    }
    return {
      mode: 'rows',
      rounds: out,
      slack: 0,
      form: shape.form,
      shape: shape,
      closedTop: false,
      closedBottom: false,
      /* Rows mode walks UPWARD already — row 1 sits at y = 0 and the sheet
         grows over it — so a sheet is worked from the bottom up by
         construction and `upsideDown` has nothing to flip. */
      upsideDown: false,
      anchor: anchor,
      height: totalH,
      width: maxW,
      maxRadius: maxW / 2,
      aspect: maxW > 0 ? totalH / maxW : 0,
      equatorFrac: 0,
      equatorRound: -1,
      corners: 0,
      cornersSource: null,
      priorK: 0,
      priorRounds: 0,
      outliers: countTrue(bridged),
      rowsDrawn: rowCount,
      flattened: 0,
      granny: 0,
      grannyFabric: false,
      stuff: null,
      ruffles: 0
    };
  }

  /* -------------------------------------------------------------- 8. layout */

  /**
   * Bands ready for the renderer. One band per round, in work order:
   *   rounds: { rTop, rBot, yTop, yBot, reach, prof(theta,t), sig, kind,
   *             corners, ruffle, radMax }
   *   rows:   { rTop, rBot, yTop, yBot, reach, Rc, x0, width, anchor, sig }
   * `prof` is a radius MULTIPLIER, blended from the ring above (t = 0) to the
   * round's own ring (t = 1); null means a circle.
   */
  function layout(model, opts) {
    var cls = classify(model, opts);
    var rounds = cls.rounds, i;
    var bands = [];

    if (cls.mode === 'rows') {
      var Rc = Math.max(cls.width * SHEET_CURVE, 8);
      for (i = 0; i < rounds.length; i++) {
        var r = rounds[i];
        /* A bridged row gets NO BAND. `js/diagram.js` already treats a missing
           band as "nothing to build and nothing to frame" (`bandExtent`
           returns null), so the misread row leaves the mesh, the chunk list and
           the fit extents in one move. */
        if (r.outlier) { bands.push(null); continue; }
        bands.push({
          rTop: Rc, rBot: Rc, yTop: r.yTop, yBot: r.y, reach: r.h, Rc: Rc,
          x0: r.x0, width: r.width, anchor: r.anchor, prof: null,
          kind: 'row', corners: 0, ruffle: false,
          radMax: cls.width / 2, sig: Math.round(r.width * 100) + (r.anchor === 'left' ? 1 : r.anchor === 'right' ? 2 : 0) * 1e6
        });
      }
    } else {
      var prevProf = null;
      var prevR = rounds.length ? rounds[0].radius : 0;
      // the ring the first band starts from (a closed magic ring, or its own)
      var firstR = 0;
      for (i = 0; i < rounds.length; i++) {
        if (!rounds[i].empty && !rounds[i].outlier) { firstR = rounds[i].radius; break; }
      }
      prevR = startRadius(cls.shape, firstR);
      for (i = 0; i < rounds.length; i++) {
        var e = rounds[i];
        if (e.outlier) { bands.push(null); continue; }   // bridged: see above
        var prof = blendProfiles(prevProf, e.prof);
        /* `radiusDraw` is the ring plus the cosmetic wall bow (1.3.0); it falls
           back to `radius` for a Model the stuffed profile never touched. */
        var rDraw = e.radiusDraw > 0 ? e.radiusDraw : e.radius;
        bands.push({
          rTop: prevR, rBot: rDraw, yTop: e.yTop, yBot: e.y, reach: e.h,
          prof: prof, kind: e.kind, corners: e.corners, ruffle: e.ruffle,
          radMax: Math.max(prevR, e.radiusMax || rDraw),
          sig: (prof && prof.sig ? prof.sig : 0)
        });
        prevR = rDraw;
        prevProf = e.prof;
      }
    }
    cls.bands = bands;
    return cls;
  }

  /* ----------------------------------------------------------------- 9. fit */

  /**
   * True when every round of a model has been worked — "the finished piece",
   * the state in which the counting clamp is the wrong answer (07 D2).
   * Ghost rounds and rounds with no readable count do not count against it.
   */
  function isFinished(model) {
    var rounds = arr(model && model.rounds);
    if (!rounds || !rounds.length) return false;
    var any = false;
    for (var i = 0; i < rounds.length; i++) {
      var r = rounds[i] || {};
      var c = Math.max(0, r.count | 0);
      if (c <= 0) continue;
      if (r.ghost) return false;
      any = true;
      if (!(isNum(r.done) ? r.done : 0) || r.done < c) return false;
    }
    return any;
  }

  /**
   * Fit scale for a piece. Two policies, not one (07 D2):
   *
   *   purpose 'button' (the default) — the piece is being COUNTED. A
   *     405-stitch row fitted to the width is a hairline, so the scale is
   *     pushed up until the fabric fills FIT_MIN_HEIGHT_FRAC of the height and
   *     the sheet overflows sideways with the worked row centred. Bounded by
   *     FIT_MAX_WIDTH_FRAC: the silhouette may overflow the frame by half,
   *     never by the 4.5x the wrap and the 8x the throw were getting, where
   *     you saw no end of the sheet and so never saw a rectangle.
   *   purpose 'viewer' / 'gallery', `finished: true`, or a model whose rounds
   *     are all worked — the piece is being LOOKED AT. Letterbox it at its
   *     honest scale: a rectangle is seen as a rectangle.
   *
   * A finished piece letterboxes in the button too — there is no current row
   * left to centre on — so "keep the counting behaviour for the button" means
   * while there is still counting to do. `purpose` and `letterbox` in the
   * result say which policy ran.
   *
   * @param {{rad:number, ymin:number, ymax:number, halfW:number, halfH:number,
   *          cp:number, sp:number, curY:number|null, mode:string,
   *          purpose:string, finished:boolean, model:object}} spec
   * @returns {{scale:number, base:number, clamp:string, cy:number,
   *            radFrac:number, heightFrac:number, purpose:string,
   *            finished:boolean, letterbox:boolean}}
   */
  function fit(spec) {
    var s = spec || {};
    var rad = Math.max(s.rad || 0, 1e-4);
    var ymin = s.ymin || 0, ymax = s.ymax || 0;
    var halfW = Math.max(s.halfW || 1, 1e-4);
    var halfH = Math.max(s.halfH || 1, 1e-4);
    var cp = s.cp == null ? 1 : s.cp;
    var sp = s.sp == null ? 0 : Math.abs(s.sp);
    var hy = Math.max((ymax - ymin) / 2, 0);

    var finished = s.finished === true ||
      (s.finished !== false && !!s.model && isFinished(s.model));
    var purpose = FIT_PURPOSES[s.purpose] ? s.purpose : 'button';
    var letterbox = purpose !== 'button' || finished;

    var sW = halfW / rad;
    var sH = halfH / Math.max(hy * cp + rad * sp, 1e-4);
    var base = Math.min(sW, sH);
    var scale = base, kind = '', cy = (ymin + ymax) / 2;

    /* (a) a 42-round tail: fits by height, but its silhouette must stay wide
       enough to be seen. Bounded so it is never cropped to a stub. */
    var needRad = FIT_MIN_RADIUS_FRAC * halfW / rad;
    if (needRad > scale) {
      scale = Math.min(needRad, base * FIT_MAX_OVERSCALE);
      kind = 'radius';
    }
    /* (b) a 400-stitch row BEING COUNTED: fitting the width makes the fabric a
       hairline, so clamp the scale and let the sheet overflow sideways, current
       row centred. The pitch-swing term is dropped here — overflow is the
       point. Rows only: a flat disc, a doily or a granny square is genuinely
       wide and flat, and cropping one to fill the height would be a bug, not a
       fix. Skipped entirely once the piece is finished or the caller is the
       viewer / the gallery — then the whole rectangle is the answer. */
    var needH = s.mode === 'rows' && !letterbox
      ? FIT_MIN_HEIGHT_FRAC * halfH / Math.max(hy * cp, 1e-4)
      : 0;
    if (needH > scale) {
      /* ...and never wider than FIT_MAX_WIDTH_FRAC frames, so the sheet still
         has ends. `sW` is the scale at which the silhouette exactly fills the
         half-width, so 1.5·sW is a 50% overflow. */
      scale = Math.min(needH, base * FIT_MAX_OVERSCALE_ROWS, FIT_MAX_WIDTH_FRAC * sW);
      if (scale > base) {
        kind = 'height';
        if (isNum(s.curY)) cy = s.curY;
      } else {
        scale = base;
      }
    }
    return {
      scale: scale, base: base, clamp: kind, cy: cy,
      radFrac: scale * rad / halfW,
      heightFrac: hy > 0 ? scale * hy * cp / halfH : 0,
      purpose: purpose, finished: finished, letterbox: letterbox
    };
  }

  /* --------------------------------------------------------------- exports */

  global.DiagramGeo = {
    version: '1.3.0',

    // constants (read-only by convention; the test page prints them)
    SW: SW,
    SH_SC: SH_SC,
    STITCH_H: STITCH_H,
    STITCH_W: STITCH_W,
    R_MIN: R_MIN,
    RING_START: RING_START,
    SHEET_CURVE: SHEET_CURVE,
    SLACK: {
      stuffed: SLACK_STUFFED, firm: SLACK_FIRM,
      unstuffed: SLACK_UNSTUFFED, open: SLACK_OPEN,
      shaped: SLACK_SHAPED, bowl: SLACK_BOWL
    },
    CUP_STRAIGHT: CUP_STRAIGHT,
    RUFFLE_EPS: RUFFLE_EPS,
    RUFFLE_RISE: RUFFLE_RISE,
    DY_MIN: DY_MIN,
    STUFFED_FLAT_TOL: STUFFED_FLAT_TOL,
    CLOSE_COUNT: CLOSE_COUNT,
    LOFT: { blendAt: LOFT_BLEND_AT, minRun: LOFT_MIN_RUN },
    STUFF: {
      minSlack: STUFF_MIN_SLACK,
      filletBend: FILLET_BEND, filletSpan: FILLET_SPAN, filletEase: FILLET_EASE,
      filletKeep: FILLET_KEEP,
      wallBow: WALL_BOW, wallBowMin: WALL_BOW_MIN, lidSag: LID_SAG
    },
    FIT: {
      minRadiusFrac: FIT_MIN_RADIUS_FRAC, maxOverscale: FIT_MAX_OVERSCALE,
      minHeightFrac: FIT_MIN_HEIGHT_FRAC, maxOverscaleRows: FIT_MAX_OVERSCALE_ROWS,
      maxWidthFrac: FIT_MAX_WIDTH_FRAC
    },
    POLY: {
      ks: POLY_KS, priorKs: POLY_PRIOR_KS, priorFrom: POLY_PRIOR_FROM,
      run: POLY_RUN, minPerSite: POLY_MIN_PER_SITE, flatTol: POLY_FLAT_TOL,
      grannyFlat: GRANNY_FLAT,
      sharpFlat: SHARP_FLAT, sharpSoft: SHARP_SOFT
    },
    OUTLIER: {
      frac: OUTLIER_FRAC, minMedian: OUTLIER_MIN_MED, minBefore: OUTLIER_MIN_BEFORE
    },

    // stitch metrics
    stitchH: stitchH,
    stitchW: stitchW,
    roundMetrics: roundMetrics,
    flatRate: flatRate,

    // structure
    sites: sites,
    countProfile: countProfile,
    formOf: formOf,
    shapeOf: shapeOf,
    startRadius: startRadius,
    polygonFit: polygonFit,
    polygonRatios: polygonRatios,
    outlierFlags: outlierFlags,
    sphereArc: sphereArc,
    loftRadius: loftRadius,
    capDepth: capDepth,
    monotoneRuns: monotoneRuns,
    straightRuns: straightRuns,
    bendProfile: bendProfile,
    isFinished: isFinished,
    rowsAnchor: rowsAnchor,

    // cross-sections
    profileRing: profileRing,
    profilePolygon: profilePolygon,
    profileStadium: profileStadium,
    profileWave: profileWave,
    blendProfiles: blendProfiles,
    profileRange: profileRange,
    arcTable: arcTable,
    arcSlices: arcSlices,

    // the two the renderer calls
    classify: classify,
    layout: layout,
    fit: fit
  };

}(typeof window !== 'undefined' ? window : this));
