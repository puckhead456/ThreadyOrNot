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

   1.4.0 (wave E, docs/wave-e/3d-geometry.md) — lace and terraces.

   (10) LACE LOOPS STAND AS TALL AS THEY ARCH (`LOOP_W`, `loopReach`). A chain
   run at `Patterns.LOOP_CHAIN_W` is a loop whose chord is shorter than its
   length; it arches loopSag(n) past the stitch that closes it, so a round of
   sc + ch-3 loops reaches sc + 0.84 sc, not sc. Persian Tiles round 5 stopped
   being a frill. Chains themselves are spaces (h 0) and never vote on height.
   Increase SITES are placed by record width, not by the stitch count (a lace
   round has more records than stitches), a round whose count FELL or whose
   increase groups hold a chain run is never a "spread increase", and a spread
   round of a text-prior motif gets the motif's POLY_FLAT_TOL before it frills.

   (11) FANS AND FILLS (`fanFill`). A motif round past its own flat reach
   followed by one under GRANNY_FLAT is fans and the round that fills them;
   the pair shares its step by reach, the fan's ring moving in. Persian Tiles
   round 4 now steps out 2.15 instead of standing up as a dc-high wall.

   (12) TERRACES (`terraceSmooth`, 04 defect J). A 3-tap filter on the ring at
   each corner of a staircase of steps and 1-3-round plateaus, strength scaled
   by the stuffing slack, run ends / the widest ring / genuine steps pinned, and
   each run's rise handed back so no measured number moves. `classify(model,
   {terrace: false})` turns it off (the tests compare the two).

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
  var OPEN_TURN_IN = 0.8;   // ends at <= 80% of its widest: a body segment, filled

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

  /* ---------------------------------------------- 1.4.0 (wave E, see (10)-(12))
     LACE LOOPS STAND AS TALL AS THEY ARCH. `Patterns` gives a chain that closes
     into a loop — `ch 3, sc in next sp` — the width of its CHORD, LOOP_W of a
     stitch per chain (`Patterns.LOOP_CHAIN_W`, exported for this file), because
     a loop is slack: its two ends are closer than its length. The same slack
     that shortens the chord makes the chains ARCH outward past the stitches that
     anchor them, so a round of loops reaches further than its sc does. A
     circular arc of length L over a chord c has sagitta sqrt(3c(L - c)/8) to
     first order — 0.80 of a stitch width for a ch-3 loop. */
  var LOOP_W = 0.75;
  var LOOP_MIN_FRAC = 0.10;     // loops must be >= 10% of the round's width
  /* TERRACES ARE SMOOTHED (04 defect J, 06 defect 7). A count sequence that
     alternates a step with one to three straight rounds — the snowman hat's
     36,36,42,42,48,48, the cato horn's 5,5,5,10,10,10,15,15 — is honest about
     the counts and wrong about the fabric: each step round lies nearly flat and
     each straight round stands vertical, so the silhouette is a staircase. Yarn
     will not turn a sharper corner than the stitch that makes it (the same
     argument as FILLET_BEND), and stuffing pushes the fabric out to fill the
     re-entrant corner as well. So the ring at each corner of a terrace is moved
     toward the mean of its neighbours — the 3-tap filter [a/2, 1-a, a/2] —
     with a = TERRACE_ALPHA at full stuffing and TERRACE_YARN of that on an
     unstuffed piece. Only inside a monotone run with >= TERRACE_MIN_TREADS
     treads of 1..TERRACE_FLAT_MAX straight rounds: a longer plateau is a WALL
     and its shoulder is the fillet's business, and nothing that is a genuine
     step is ever touched — a ruffle or a flattened round (a hat brim, a flared
     cup rim), a polygon / oval / granny round, the widest ring, or the two ends
     of the run (a neck, a waist and a rim are all run ends by construction). */
  var TERRACE_ALPHA = 0.5;
  var TERRACE_YARN = 0.5;
  var TERRACE_FLAT_MAX = 3;
  var TERRACE_MIN_TREADS = 2;

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
    var hBest = 0, hMean = 0, wSum = 0, loopH = 0;

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
      var lp = loopReach(list);
      if (lp.w > 0 && perimeter > 0 && lp.w / perimeter >= LOOP_MIN_FRAC && lp.h > hBest) {
        loopH = lp.h;
        hBest = lp.h;
      }
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
      // > 0 when the round's height is its lace loops' reach, see LOOP_W
      loop: loopH,
      empty: count <= 0 || perimeter <= 0
    };
  }

  /** Sagitta of a loop of `n` chains whose chord is n * LOOP_W, in SW. */
  function loopSag(n) {
    var L = n, c = n * LOOP_W;
    return L > c ? Math.sqrt(3 * c * (L - c) / 8) : 0;
  }

  /**
   * How far a round of lace loops reaches (see LOOP_W). A loop is a run of
   * `ch` records at the loop width; it hangs from the stitch that closes it
   * (the one after the run, else the one before) and arches loopSag(n) past
   * that stitch's top. The round's loop reach is the width-weighted mean over
   * its loops, in sc heights so it compares with `h`.
   * @returns {{w:number, h:number}} total loop width, and the reach (0 = none)
   */
  function loopReach(list) {
    var i = 0, n = list.length, wSum = 0, hSum = 0;
    while (i < n) {
      var st = list[i] || {};
      if (st.t !== 'ch' || !isNum(st.w) || Math.abs(st.w - LOOP_W) > 1e-6) { i++; continue; }
      var j = i, w = 0;
      while (j < n && list[j] && list[j].t === 'ch' && isNum(list[j].w) &&
             Math.abs(list[j].w - LOOP_W) <= 1e-6) { w += list[j].w; j++; }
      var anchor = anchorH(list[j]) || anchorH(list[i - 1]) || 1;
      var reach = anchor + loopSag(j - i) / SH_SC;
      wSum += w;
      hSum += reach * w;
      i = j;
    }
    return { w: wSum, h: wSum > 0 ? hSum / wSum : 0 };
  }

  function anchorH(st) {
    if (!st || st.t === 'ch') return 0;
    var h = isNum(st.h) && st.h > 0 ? st.h : stitchH(st.t);
    return h > 0 ? h : 0;
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

  /**
   * Where a round's increase sites sit, measured along the round by the widths
   * of the records before them (1.4.0). `mod` is the round's own record width.
   * For a round of one-wide stitches this is exactly the old (index, count).
   * @returns {{pos:number[]|null, mod:number}}
   */
  function sitePositions(round, siteList) {
    var r = round || {};
    var list = arr(r.stitches);
    var count = Math.max(0, r.count | 0);
    if (!siteList || !list || !list.length) return { pos: siteList, mod: count };
    var cum = new Array(list.length + 1), i, w, lastW = 1;
    cum[0] = 0;
    for (i = 0; i < list.length; i++) {
      var st = list[i] || {};
      w = isNum(st.w) && st.w >= 0 ? st.w : stitchW(st.t);
      lastW = w;
      cum[i + 1] = cum[i] + w;
    }
    var mod = cum[list.length];
    if (count > list.length) mod += (count - list.length) * lastW;
    if (!(mod > 0)) return { pos: siteList, mod: count };
    var pos = [];
    for (i = 0; i < siteList.length; i++) {
      var s = siteList[i] | 0;
      pos.push(s >= 0 && s < list.length ? cum[s] : s);
    }
    return { pos: pos, mod: mod };
  }

  /**
   * How many of a round's increase groups have a chain run INSIDE them —
   * `inc … ch … inc+`, i.e. `(sc, ch 2, sc)` or `(3 dc, ch 3, 3 dc)` worked
   * into one place. Those chains are the next round's corner space, so such a
   * group is a corner, never one stitch of a spread increase.
   */
  function cornerGroups(round) {
    var list = arr(round && round.stitches);
    if (!list) return 0;
    var n = 0, i, inGroup = false, sawCh = false;
    for (i = 0; i < list.length; i++) {
      var t = (list[i] && list[i].t) || '';
      if (t === 'inc') { inGroup = true; sawCh = false; continue; }
      if (!inGroup) continue;
      if (t === 'ch') { sawCh = true; continue; }
      if (t === 'inc+') { if (sawCh) { n++; inGroup = false; } continue; }
      inGroup = false;
    }
    return n;
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
      // a round the store flagged as a misread line is not fabric (1.4.0)
      c = list[i] && list[i].outlier !== true ? Math.max(0, list[i].count | 0) : 0;
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
  function outlierFlags(rounds, mode, stepOnly) {
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
        /* Knitting (wave H) judges a row against the row before it, not the
           running median: a triangle knitted down to its point narrows row by
           row to a handful of stitches, which the median would bridge. */
        var med = stepOnly ? normal[normal.length - 1] : median(normal);
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
    /* ...but not one with a WALL (1.4.0): two or more straight rounds is the
       CUP_STRAIGHT evidence again, a tube that tapers — the bear Arms,
       6, 9, 9, 9, 8, 6 — not a brim. */
    if (stuffed === null && cp.rounds > 0 && cp.rounds <= BOWL_MAX_ROUNDS &&
        cp.inc > 0 && cp.straight < CUP_STRAIGHT &&
        last < max && last >= BOWL_MIN_END * max) return 'shallow-bowl';
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
    var lastP = 0, maxP = 0, pm;
    var seen = false;
    for (i = 0; i < rounds.length; i++) {
      c = rounds[i] && rounds[i].outlier !== true ? Math.max(0, rounds[i].count | 0) : 0;
      if (c <= 0) continue;
      if (!seen) { first = c; seen = true; }
      last = c;
      if (c > max) max = c;
      /* ...and the same by the fabric's own width, for lace (1.4.0): a round
         that trades stitches for chain spaces can fall in COUNT while its
         fabric grows — Persian Tiles reads 16, 24, 36, 19, 20, 31 stitches over
         16, 24, 48, 51, 69, 84 widths — and a flat motif was taken for a
         "shallow bowl" that turns back in. */
      pm = roundMetrics(rounds[i]).perimeter;
      lastP = pm;
      if (pm > maxP) maxP = pm;
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
    var openEnd = seen && (last >= max * 0.92 || (maxP > 0 && lastP >= maxP * 0.92));

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
    /* 06 defect 8 (1.4.0): a piece that grows and then turns back in by a fifth
       or more, with the text silent about stuffing, is a body segment — the same
       argument as `closesIn`, which only ever looked at the very last round. Its
       shape only holds when it is filled; silence is not "do not stuff" (that is
       `stuffed === false`, handled above). The bear Body — 18 → 40, five
       straight, back to 24, grown out of the head with no start ring — was drawn
       unstuffed at slack 0.05 by luck of its missing magic ring. */
    else if (form === 'open' && stuffed === null && cp.inc > 0 && cp.dec > 0 &&
             last <= OPEN_TURN_IN * max) slack = SLACK_STUFFED;
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
    /* Wave H: a knitted piece takes the knitting path (7c); nothing below it
       changes for crochet. */
    if (isKnit(m)) return mode === 'rows' ? classifyKnitRows(m, rounds) : classifyKnitRounds(m, rounds, o);
    var shape = shapeOf({ mode: mode, rounds: rounds, shape: m.shape });
    /* An explicit `opts.upsideDown` wins over the model's own flag, so a host
       can preview either way up without editing the store's shape. */
    var flip = o.upsideDown == null ? shape.upsideDown : o.upsideDown === true;
    return mode === 'rows'
      ? classifyRows(rounds, shape)
      : classifyRounds(rounds, shape, flip, o.terrace !== false);
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

  /* ------------------------------------------------ 7c. fans and fills (11)
     A motif round of FANS — Persian Tiles round 3, `* sc in next 3 sc, skip
     next sc, (3 dc, ch 3, 3 dc) all in next sc, skip next sc` — grows 24 widths
     over the 24 sc it sits on, 1.57x what a dc round can lay flat on a square.
     The surplus is not radius: the fans ARE the surplus, four scalloped petals
     whose tips stand one dc out while the sc between them stand one sc out. The
     next round FILLS them — `dc in next 3 sc` in the valleys, `ch 3` along each
     fan's flank, `(sc, ch 2, sc)` on its tip — and grows only 3 widths, 0.2 of
     its rate, because the length it needs was already made. Drawn one ring per
     round at perimeter / 2pi, the fan round took the pair's whole step and the
     fill round stood straight up out of it as a dc-high wall (HANDOFF, "Persian
     Tiles round 4 does not fan").
     So a fan round (over its own k-gon flat reach) followed by a fill round
     (under GRANNY_FLAT of its reach) whose PAIR is flat fabric (combined growth
     GRANNY_FLAT..POLY_FLAT_TOL of the combined reach) shares the pair's step in
     proportion to the two rounds' reaches. The fan's ring moves IN, never out,
     and the fill keeps its perimeter's ring: the Persian square's rings become
     3.82, 5.97, 8.12 (was 3.82, 7.64, 8.12), which is where 01 §1.4's height
     arithmetic puts a square of sc + dc + sc + dc rounds (inradius x 1.273:
     5.67 at the fan tips' base, 8.10 after the fill) — and round 4's own Σw of
     51 is exactly the square its heights predict (P = 8a = 51.9), so the widths
     were never the problem. A steady granny (hood, hex socks) has no fill round
     and is untouched; a plain ring has kf 1 and is never asked.
     ------------------------------------------------------------------------- */

  /**
   * Move each fan round's ring in so it and its fill share their step (above).
   * Mutates `ring`.
   * @returns {number[]} per round, how far its ring moved in (0 = not a fan)
   */
  function fanFill(ring, kfAt, met, bridged, slack) {
    var n = ring.length, fans = new Array(n), real = [], i, p;
    for (i = 0; i < n; i++) {
      fans[i] = 0;
      if (!met[i].empty && !bridged[i]) real.push(i);
    }
    var s1 = 1 - slack;
    for (p = 1; p + 1 < real.length; p++) {
      var a = real[p - 1], f = real[p], j = real[p + 1];
      if (!(kfAt[f] > 1) || !(kfAt[j] > 1)) continue;
      var rf = met[f].hw * kfAt[f], rj = met[j].hw * kfAt[j];
      if (!(rf > 0) || !(rj > 0)) continue;
      var over = s1 * (ring[f] - ring[a]) / rf;
      var under = s1 * (ring[j] - ring[f]) / rj;
      var pair = s1 * (ring[j] - ring[a]) / (rf + rj);
      if (!(over > 1) || !(under < GRANNY_FLAT)) continue;
      if (pair < GRANNY_FLAT || pair > POLY_FLAT_TOL) continue;
      var target = ring[a] + (ring[j] - ring[a]) * rf / (rf + rj);
      if (!(target < ring[f] - 1e-9)) continue;
      fans[f] = ring[f] - target;
      ring[f] = target;
    }
    return fans;
  }

  /* --------------------------------------------------- 7d. terraces (12)
     See TERRACE_*. Runs over the walked entries, before the loft. */

  function terraceReport(alpha) {
    return { applied: false, alpha: alpha, runs: 0, rings: 0, maxShift: 0 };
  }

  /**
   * Smooth the staircase out of a monotone run of steps and short plateaus.
   * Mutates `radius` / `meanRadius` / `dy` of the rings it moves (the widest
   * ring, the run's two ends and every genuine step never move) and gives each
   * run back exactly the rise it had, so `height` and every aspect in 01 §2 are
   * unchanged — only the staircase is.
   */
  function terraceSmooth(out, shape) {
    var alpha = TERRACE_ALPHA * (TERRACE_YARN + (1 - TERRACE_YARN) * stuffScale(shape.slack));
    var res = terraceReport(alpha);
    var list = realEntries(out), m = list.length, j, k;
    if (m < 4 || !(alpha > 0)) return res;
    var R = new Array(m), ok = new Array(m), sg = new Array(m), run = new Array(m);
    var rMax = 0;
    for (j = 0; j < m; j++) {
      var e = list[j];
      R[j] = e.radius;
      if (R[j] > rMax) rMax = R[j];
      /* a genuine step, or a round with its own cross-section: never a terrace */
      ok[j] = e.kind === 'ring' && !e.ruffle && !e.flattened && !e.granny && !e.fan;
      run[j] = -1;
    }
    sg[0] = 0;
    for (j = 1; j < m; j++) {
      var d = R[j] - R[j - 1];
      sg[j] = Math.abs(d) <= 1e-9 ? 0 : (d > 0 ? 1 : -1);
    }
    /* Segment the STEPS (step j joins ring j-1 to ring j) into runs: one sign,
       plateaus of at most TERRACE_FLAT_MAX straight rounds, every step between
       two ordinary rings. A plateau longer than that is a wall; it belongs to
       no run and ends the one before it. */
    var runs = [], cur = null, zeros = 0, zeroFrom = -1;
    function close(countTrailing) {
      if (cur && countTrailing && zeros > 0) cur.treads++;
      cur = null; zeros = 0; zeroFrom = -1;
    }
    for (j = 1; j < m; j++) {
      if (!ok[j] || !ok[j - 1]) { close(true); continue; }
      if (sg[j] === 0) {
        if (!cur) { cur = { dir: 0, treads: 0 }; runs.push(cur); }
        if (!zeros) zeroFrom = j;
        zeros++;
        run[j] = runs.length - 1;
        if (zeros > TERRACE_FLAT_MAX) {
          /* a wall: take the plateau back off the run, and skip the rest of it */
          for (k = zeroFrom; k <= j; k++) run[k] = -1;
          close(false);
          while (j + 1 < m && ok[j + 1] && sg[j + 1] === 0) j++;
        }
        continue;
      }
      if (cur && cur.dir !== 0 && sg[j] !== cur.dir) close(true);
      if (!cur) { cur = { dir: sg[j], treads: 0 }; runs.push(cur); }
      if (!cur.dir) cur.dir = sg[j];
      if (zeros > 0) { cur.treads++; zeros = 0; zeroFrom = -1; }
      run[j] = runs.length - 1;
    }
    close(true);

    /* The corners of each terrace: rings whose two steps are in the same run,
       exactly one of them a plateau. A ring between two steps is a ramp (the
       loft's business); a ring inside a plateau has nothing to move toward. */
    var shift = new Array(m), moved = {}, any = false;
    for (j = 0; j < m; j++) shift[j] = 0;
    for (j = 1; j < m - 1; j++) {
      var q = run[j];
      if (q < 0 || run[j + 1] !== q || runs[q].treads < TERRACE_MIN_TREADS) continue;
      if ((sg[j] === 0) === (sg[j + 1] === 0)) continue;
      if (R[j] >= rMax - 1e-9) continue;                // the widest ring
      shift[j] = alpha * ((R[j - 1] + R[j + 1]) / 2 - R[j]);
      if (Math.abs(shift[j]) > 1e-12) { moved[q] = true; any = true; }
    }
    if (!any) return res;

    /* New rings, new rises for every step of a moved run, and the run's own
       total rise handed back so the piece's height does not move. */
    var s1 = 1 - shape.slack;
    for (q = 0; q < runs.length; q++) {
      if (!moved[q]) continue;
      var steps = [], before = 0, after = 0;
      for (j = 1; j < m; j++) if (run[j] === q) steps.push(j);
      var dyNew = [];
      for (k = 0; k < steps.length; k++) {
        j = steps[k];
        var el = list[j];
        var hk = el.h * (el.kf > 0 ? el.kf : 1);
        var dr = Math.abs((R[j] + shift[j]) - (R[j - 1] + shift[j - 1]));
        var qq = hk > 0 ? Math.min(1, s1 * dr / hk) : 1;
        var dyj = el.h * Math.sqrt(Math.max(0, 1 - qq * qq));
        if (dyj < DY_MIN * el.h) dyj = DY_MIN * el.h;
        dyNew.push(dyj);
        before += el.dy;
        after += dyj;
      }
      var scale = after > 0 ? before / after : 1;
      for (k = 0; k < steps.length; k++) list[steps[k]].dy = dyNew[k] * scale;
      res.runs++;
    }
    for (j = 0; j < m; j++) {
      if (!shift[j]) continue;
      list[j].radius = list[j].meanRadius = R[j] + shift[j];
      list[j].terrace = shift[j];
      res.rings++;
      if (Math.abs(shift[j]) > res.maxShift) res.maxShift = Math.abs(shift[j]);
    }
    res.applied = true;
    return res;
  }

  function classifyRounds(rounds, shape, flip, terraceOn) {
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
      /* Sites are RECORD indices, so they are placed by the widths of the
         records before them, around the round's own record width — not by the
         stitch count, which leaves chain spaces out. On a lace round (Persian
         Tiles round 4: 19 stitches in 51 records) the count put four evenly
         spaced corners at a third of the way round each. */
      var sp = sitePositions(rounds[i], sit[i].inc);
      var pf = ripple[i] ? null : polygonFit(sp.pos, sp.mod);
      /* A CORNER takes a group — `(3 dc, ch 2, 3 dc) in the corner sp` — so a
         polygon gains at least two stitches per site per round. One extra
         stitch at k evenly spaced places is a SPREAD increase, i.e. a circle:
         that is what "+6 sc per round" is, and it is not a hexagon. This is
         the test that keeps every amigurumi sphere round — and it is a POSITIVE
         verdict about readable sites, so `spread[i]` records it and the text
         prior below is not allowed to overrule it.
         Two things are NOT a spread increase (1.4.0): a round whose count did
         not grow at all (a lace round swaps stitches for chain spaces, so its
         count can FALL while its fabric grows — Persian round 4 reads 36 -> 19),
         and a round whose increase groups carry a chain run inside them — `(sc,
         ch 2, sc) in the corner` is a corner by construction, because the chains
         are the next round's corner space. */
      spread.push(!!(pf && i > 0 && dn > 0 && dn / pf.sites < POLY_MIN_PER_SITE &&
        !cornerGroups(rounds[i])));
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

    /* The ring every round draws: its perimeter over 2pi, except where a FAN
       round's surplus is scallop that the next round fills (`fanFill`, (11)).
       Computed up front because the granny verdict below is about the piece. */
    var ovalStart = shape.start === 'chain-oval' && shape.chainLen > 0;
    var ring = new Array(n), kfAt = new Array(n);
    for (i = 0; i < n; i++) {
      ring[i] = Math.max(R_MIN, met[i].perimeter / TAU);
      /* the same kf the walk below picks, for the cases that have one */
      kfAt[i] = ripple[i] ? 1
        : polyK[i] ? polygonRatios(polyK[i]).flat
          : (!ovalStart && prior > 0 && !spread[i]) ? kfPrior : 1;
    }
    var fans = fanFill(ring, kfAt, met, bridged, shape.slack);

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
    var anyPoly = false;
    for (i = 0; i < n; i++) if (polyK[i]) anyPoly = true;
    if (prior > 0 || anyPoly) {
      var gr = [], rPrev = prevR;
      for (i = 0; i < n; i++) {
        if (met[i].empty || bridged[i]) continue;
        var rNow = ring[i];
        var kfi = kfAt[i];
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

      var rFlatCirc = ring[i];
      entry.radiusCount = Math.max(R_MIN, mt.perimeter / TAU);
      if (fans[i]) { entry.fan = true; entry.fanShift = fans[i]; }
      if (mt.loop) entry.loop = true;
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
      /* A spread round keeps the circle's rate — its own sites say circle — but
         it is still a round of a piece the TEXT calls a flat motif, so it gets
         the motif's allowance before it is called a frill (1.4.0). Persian
         Tiles round 2 is 24 sc around 16 dc, 1.34x the circle's sc rate, and it
         lies flat under the four rounds that square it off. */
      else if (prior > 0) priorRelax = true;
      entry.kf = kf;

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
    /* ...but first the TERRACES (TERRACE_*): a staircase of steps and short
       plateaus is smoothed into the slope the yarn actually makes, so the loft
       below sees one monotone run where it used to see five little ones. */
    var terrace = (prior > 0 || !terraceOn) ? terraceReport(0) : terraceSmooth(out, shape);
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
      terrace: terrace,
      fans: countTrue(fans),
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

  function classifyRows(rounds, shape, knit) {
    var n = rounds.length, i;
    var anchor = rowsAnchor(rounds);
    /* 07 D4: a row of 2 or 5 among rows of 405 is a line the parser misread,
       and laying it out at full width ratio tore the sheet into detached
       pieces. It is not fabric, so it is not in the width either. */
    var bridged = outlierFlags(rounds, 'rows', !!knit);
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

  /* ======================================================= 7c. knitting (1.5.0; 1.6.0 knit-3d-2: cables, wedges)

     Wave H (docs/wave-h/knit-3d.md). A knitted piece is the same fabric
     physics with a different stitch — a row 0.75 of a stitch width tall
     (stockinette, rib, lace, cables), 0.5 in garter — plus three shapes a
     crochet piece never has. Everything here is gated on `isKnit(model)`
     (`model.craft === 'knitting'`, or a round of unambiguous knitting
     records), so no crochet model reaches a line of it.

     HEIGHTS. `Knits.expand` gives `h` in STITCH WIDTHS (contract §2). The
     rounds/rows walk measures in sc units and multiplies by SH_SC, so a knit
     record is handed to it as h / SH_SC and comes out at exactly its own
     height: 0.75 per stockinette round, 0.5 per garter row.

     (13) A FLAT ROW INSIDE A ROUND IS A BEND, NOT A RING. A heel flap is
     rows worked back and forth on half a sock's stitches while the instep
     waits; a short-row heel turns on a few. Drawn as rings they pinched the
     tube to half its width. The row is kept at the ring's own width (the
     held stitches close it, `knitPartials`) and its height is spent as a
     BEND of the tube about the side that was not worked: the worked side
     grows by the rows' height and the held side by nothing, which is what
     turns a leg into a foot. The bend angle is the rows' height over the
     tube radius, never more than a right angle (`KNIT_BEND_MAX`). The
     mapping is a warp of the finished mesh (`warpPoint`), so the band
     builder and every crochet band are untouched. A toe-up sock (a closed
     toe cast-on) is turned so its LEG stands up; a top-down one already
     does. A row needs `side` or `shortRow` on the Model round to be read
     as flat; a model with none of either falls back to the heel's count
     signature (a run of >= 4 rows at <= 0.6 of the ring that comes back to
     >= 0.9 of it).

     (14) A RAGLAN YOKE IS NOT A CONE. Top-down, a yoke widens to the
     underarm, the sleeve stitches leave, and the body goes on narrower. The
     yoke's rings take a stadium cross-section whose round ends are the
     body's own radius, so the front and back run straight down into the
     body and only the sleeve tops step in — shoulders, not a shelf all the
     way round. The divide round rises by its own row height.

     (15) A SHORT ROW IN A FLAT PIECE THICKENS ONE SIDE. Rows mode lays rows
     at a uniform height; a row worked on part of the width (`shortRow`, and
     narrower than the full row before it) only raises the part it covers,
     so the next full row sits on a slope (a height field per column,
     `field`). It is anchored at the edge the last full row ended at.

     (16) A TRIANGLE GROWN FROM THE CENTRE. Increases at both edges and a
     centre spine make every row a chevron, not a straight line: the two
     halves are laid at the half-angle the rows' own width/height ratio
     gives (45° in garter, where the top edge is straight) and the shawl
     hangs from its start point (`chevron`).

     Knitted hats and other pieces that close at their LAST round and start
     open (brim-up) are shown with the crown up.

     1.6.0 (knit-3d-2, docs/wave-h/knit-3d-2.md):
     (17) CABLES ARE COLUMNS (`knitCables`): every crossing's two groups,
     a twist window that tiles the rows to the next crossing in the same
     columns, and the column pulled in to cable gauge from the panel's
     first plain row to its last. (18) SHORT ROWS ON A FEW ROWS OF A ROUND
     PIECE ARE A WEDGE: a back neck raised by German short rows tilts the
     neck, not the yoke below it (the longer stretch stays upright). (19) A
     yoke section may END at its divide (the body is its own part), and a
     yoke with a back-neck wedge lays its sleeves across the wedge.
     ===================================================================== */

  var KNIT_DETECT = {
    k: 1, k2tog: 1, ssk: 1, p2tog: 1, ssp: 1, kfb: 1, pfb: 1, m1: 1, m1l: 1, m1r: 1, m1p: 1,
    cable: 1, cdd: 1, k3tog: 1, p3tog: 1, sssk: 1, s2kp: 1, sk2p: 1, ktbl: 1, ptbl: 1
  };
  /* Default heights in STITCH WIDTHS for a knit record that carries none. */
  var KNIT_H = { co: 0.35, bo: 0.5 };
  var KNIT_ROW_H = 0.75;
  var KNIT_PARTIAL = 0.85;      // a flat row on <= 85% of the ring is a partial row
  var KNIT_FB_DROP = 0.6;       // fallback heel signature (no side info at all)
  var KNIT_FB_RUN = 4;
  var KNIT_FB_BACK = 0.9;
  var KNIT_BEND_MAX = Math.PI / 2;
  var KNIT_CLOSED_START = 32;   // a toe / crown cast on with this few stitches...
  var KNIT_CLOSED_FRAC = 0.45;  // ...and under this share of the widest round
  var KNIT_GRAFT_FRAC = 0.5;    // grafted shut, when it ends this far in
  var YOKE_MIN_INC = 3;         // increasing rounds before a divide
  var YOKE_GROWTH = 1.3;        // ...growing the ring by this much
  var YOKE_DIVIDE = 0.8;        // the divide drops to <= 80% in one round
  var YOKE_DROOP = 40 * Math.PI / 180;   // the sleeve tops' fall past the body
  var SHORT_ROW_FRAC = 0.9;     // rows mode: a short row is under 90% of the full one
  var FIELD_DX = 0.5;           // height-field column, SW
  var SHORT_ROW_TAPER = 2;      // SW over which a short row thins to its turn
  var SPINE_FRAC = 0.4;         // share of increasing rows that must be edge + spine
  var CHEVRON_MIN = 15 * Math.PI / 180, CHEVRON_MAX = 65 * Math.PI / 180;
  var KNIT_WEDGE_ROWS = 12;     // a run of partial rows this short is a wedge, not a heel (1.6.0)
  var KNIT_WEDGE_MAX = 30 * Math.PI / 180;

  /** True for a knitting Model: the craft says so, or a round holds knitting records. */
  function isKnit(model) {
    var m = model || {};
    if (m.craft === 'knitting') return true;
    if (m.craft) return false;
    var rs = arr(m.rounds) || [], i, j;
    for (i = 0; i < rs.length && i < 16; i++) {
      var l = arr(rs[i] && rs[i].stitches);
      if (!l) continue;
      for (j = 0; j < l.length && j < 48; j++) if (l[j] && KNIT_DETECT[l[j].t] === 1) return true;
    }
    return false;
  }

  function knitRecH(st) {
    // the store's generic `x` (a count with no records) is a plain knit row here
    if (st && st.t === 'x') return KNIT_ROW_H;
    if (st && isNum(st.h) && st.h > 0) return st.h;
    var t = st && st.t;
    return KNIT_H[t] != null ? KNIT_H[t] : KNIT_ROW_H;
  }
  function knitRecW(st) {
    /* a bound-off stitch is fabric in the row that binds it off (Knits gives
       it w 0: it is gone from the needle, not from the row) */
    if (st && st.t === 'bo') return 1;
    if (st && isNum(st.w) && st.w >= 0) return st.w;
    var span = knitSpan(st);
    return span > 1 ? span * 0.85 : 1;
  }
  /** Stitches one knit record stands for: a cable crosses several (`n`, else
      its width at 0.85 per stitch, contract §2). Everything else is one. */
  function knitSpan(st) {
    // Knits.expand writes a cable as one record PER STITCH (`span`, `at`)
    if (!st || st.t !== 'cable' || isNum(st.at)) return 1;
    if (isNum(st.n) && st.n >= 1) return Math.min(24, Math.floor(st.n));
    var w = isNum(st.w) && st.w > 0 ? st.w : 4 * 0.85;
    return clamp(Math.round(w / 0.85), 2, 24);
  }
  function knitPerimeter(r) {
    var l = arr(r && r.stitches), p = 0, i;
    if (!l || !l.length) return Math.max(0, (r && r.count) | 0) * SW;
    for (i = 0; i < l.length; i++) p += knitRecW(l[i]) * SW;
    return p;
  }
  function isFlatRound(r) {
    return !!r && (r.side === 'rs' || r.side === 'ws' || r.shortRow === true);
  }

  /* ---- cables (1.6.0, knit-3d-2) ------------------------------------------

     A crossing is not one shape. C4F / C6B swap two equal groups of knit
     stitches; a T3F (Patons' mock neck: "slip 2 to the cable needle, hold in
     front, P1, K2 from the cable needle") carries 2 knit stitches over 1
     purl; the boyfriend's T3F carries 1 twisted knit over a K1tbl and a P1;
     Cr7B moves 3 over 3 with a purl between. What the 3D needs is how wide
     the FRONT group is (always knit, always on top) and how many knit
     stitches the back group keeps (the rest of it is purl background). The
     store reads that off the pattern's own definition (`rec.cf`, `rec.cb`);
     with none, the name decides (`cableShapeOf`).

     A cable is a COLUMN of the fabric, not a crossing row: its knit stitches
     run between the crossings, and the whole column is pulled in (cable
     gauge — a cabled body is narrower than its stitch count in stockinette,
     contract §2's 0.85). And the twist of one crossing spans the rows around
     it up to half way to the next crossing in the same columns: a C4 every 6
     rows leans over 5 rows and runs straight for 1, a T3 every RS row tiles
     its rows exactly, so a travelling stitch draws one continuous diagonal.
     Columns are matched from row to row about the row's CENTRE (flat — so a
     sleeve's edge increases do not shift its panels) or as a FRACTION of the
     round (in the round, where a yoke decreases between its cables). */
  var CABLE_TW = 2;        // rows either side of a lone crossing that lean into it
  var CABLE_GAP = 16;      // crossings this close in overlapping columns are one cable column
  var CABLE_W = 0.85;      // a cable column's width per stitch (contract §2)
  var CABLE_PLAIN = { k: 1, p: 1, cable: 1, x: 1, ktbl: 1, ptbl: 1, sl: 1, slip: 1 };
  var CABLE_PULL = { k: 1, p: 1, x: 1, ktbl: 1, ptbl: 1, sl: 1, slip: 1 };

  /**
   * The crossing a cable's name stands for when the pattern does not define
   * it: `{f, kb}` of `n` stitches — `f` in the front group (knit, on top,
   * travelling left for an F / LC, right for a B / RC), `kb` knit stitches
   * in the back group (the rest of the back group is purl).
   */
  function cableShapeOf(name, n) {
    n = Math.max(2, n | 0);
    var nm = String(name || '').toLowerCase().replace(/\s+/g, ''), m, f, kb;
    if ((m = /^(\d+)\/(\d+)(?:l|r)(p?)(?:c|t)$/.exec(nm))) { f = +m[1]; kb = m[3] ? 0 : +m[2]; }
    else if (/^t\d+/.test(nm)) { f = n <= 2 ? 1 : Math.ceil(n / 2); kb = 0; }        // a twist over purls
    else if (/^c\d+[fblr]p$/.test(nm)) { f = n - 1; kb = 0; }                          // C3FP / C3BP
    else if (/^cr\d+/.test(nm)) { f = Math.floor(n / 2); kb = n - f; }
    else if (/^tw\d+/.test(nm)) { f = Math.floor(n / 2); kb = Math.max(0, n - f - 1); }
    else if (/^(?:rt|lt)$/.test(nm)) { f = 1; kb = 1; }
    else { f = Math.ceil(n / 2); kb = n - f; }                                           // C4F, C6B, C3FK
    f = clamp(f | 0, 1, n - 1);
    kb = clamp(kb | 0, 0, n - f);
    return { f: f, kb: kb };
  }
  function cableShape(rec, n) {
    var f = rec && isNum(rec.cf) ? rec.cf : NaN, kb = rec && isNum(rec.cb) ? rec.cb : NaN;
    if (f >= 1 && f <= n - 1 && kb >= 0 && kb <= n - f) return { f: Math.floor(f), kb: Math.floor(kb) };
    return cableShapeOf(rec && rec.name, n);
  }

  /**
   * Every cable crossing of a piece and what it does to the rows around it.
   * `{ tw, pull, crossings }` or null when the piece has none:
   *   tw[row][slot]   the twist a stitch slot (work order, a multi-stitch
   *                   record expanded) belongs to: `{phase, lo, len, sub, n,
   *                   cross, f, kb, uflip}` — rows from the crossing, the
   *                   window it spans (`lo` rows before it, `len` in all),
   *                   its physical column in the cable, the cable's width,
   *                   its direction (1 = F), its front group and back knits,
   *                   and whether the slot runs right to left (rows mode)
   *   pull[row][slot] 1 when the slot is in a cable column (drawn at
   *                   CABLE_W a stitch)
   *   crossings       `[{i, c0, n, cross, f, kb, lo, hi}]` in row order
   * `base` offsets the row index's parity (a caller holding one round).
   */
  function knitCables(rounds, mode, base) {
    var list = arr(rounds) || [], n = list.length, W = new Array(n), cab = [], byRow = {}, i, k;
    var rowsMode = mode === 'rows', b0 = base | 0;
    for (i = 0; i < n; i++) {
      var l = arr(list[i] && list[i].stitches) || [], c = 0;
      for (k = 0; k < l.length; k++) {
        var rk = l[k], sp = knitSpan(rk);
        if (rk && rk.t === 'cable') {
          var run = 0;
          if (!isNum(rk.at)) run = sp;
          else if (rk.at === 0) {
            // one record per stitch: the cable is the run that starts at `at` 0
            var span = isNum(rk.span) && rk.span >= 1 ? Math.min(24, rk.span | 0) : 1;
            run = 1;
            while (run < span && l[k + run] && l[k + run].t === 'cable' && l[k + run].at === run) run++;
          }
          if (run >= 2) {
            var sh = cableShape(rk, run);
            var K = { i: i, c0: c, n: run, cross: rk.cross === 'b' ? -1 : 1, f: sh.f, kb: sh.kb, lo: CABLE_TW, hi: CABLE_TW };
            cab.push(K);
            (byRow[i] = byRow[i] || []).push(K);
          }
        }
        c += sp;
      }
      W[i] = Math.max(c, list[i] ? Math.max(0, list[i].count | 0) : 0);
    }
    if (!cab.length) return null;
    function rtl(j) { return rowsMode && ((j + b0) & 1) === 1; }
    // physical start column of the crossing on its own row, then its centre
    // in row-independent coordinates (about the centre / as a fraction)
    cab.forEach(function (K) {
      K.p0 = rtl(K.i) ? W[K.i] - K.c0 - K.n : K.c0;
      K.x = rowsMode ? K.p0 + K.n / 2 - W[K.i] / 2 : (K.p0 + K.n / 2) / Math.max(1, W[K.i]);
    });
    function startOn(K, j) {
      return rowsMode ? Math.round(K.x + W[j] / 2 - K.n / 2) : Math.round(K.x * W[j] - K.n / 2);
    }
    function overlaps(A, B) {
      if (rowsMode) return Math.abs(A.x - B.x) < (A.n + B.n) / 2;
      var d = Math.abs(A.x - B.x);
      d = Math.min(d, 1 - d);
      return d * Math.max(1, W[A.i]) < (A.n + B.n) / 2;
    }
    function gapTo(K, dir) {
      for (var g = 1; g <= CABLE_GAP; g++) {
        var o = byRow[K.i + dir * g];
        if (!o) continue;
        for (var q = 0; q < o.length; q++) if (overlaps(K, o[q])) return g;
      }
      return Infinity;
    }
    // a row in the window that does lace, a bind-off or shaping in the
    // cable's columns ends the window there: the strands do not lean into it
    function plainIn(K, j) {
      if (j < 0 || j >= n || !(W[j] > 0)) return false;
      var l = arr(list[j] && list[j].stitches);
      if (!l || !l.length) return true;
      var p0 = startOn(K, j), slot = 0, q;
      for (q = 0; q < l.length; q++) {
        var sp = knitSpan(l[q]);
        for (var z = 0; z < sp; z++, slot++) {
          var col = rtl(j) ? W[j] - 1 - slot : slot;
          if (col < p0 || col >= p0 + K.n) continue;
          if (CABLE_PLAIN[(l[q] && l[q].t) || 'k'] !== 1) return false;
          // a ribbing below the panel (k/p pulled in to 0.8) is not part of the cable
          if (l[q] && l[q].t !== 'cable' && isNum(l[q].w) && l[q].w < CABLE_W - 1e-6) return false;
        }
      }
      return true;
    }
    var tw = new Array(n), pull = new Array(n), d, j, col;
    function mark(K, jj, phase) {
      if (!(W[jj] > 0)) return;
      var p0 = startOn(K, jj);
      for (col = Math.max(0, p0); col < Math.min(W[jj], p0 + K.n); col++) {
        var slot = rtl(jj) ? W[jj] - 1 - col : col;
        if (!tw[jj]) tw[jj] = new Array(W[jj]);
        var cur = tw[jj][slot];
        if (cur && Math.abs(cur.phase) <= Math.abs(phase)) continue;
        tw[jj][slot] = { phase: phase, lo: K.lo, len: K.lo + K.hi + 1, sub: col - p0, n: K.n, cross: K.cross,
          f: K.f, kb: K.kb, uflip: rtl(jj) };
      }
    }
    // crossings that follow one another in overlapping columns are ONE cable
    // column (a panel of travelling stitches is one, across its whole width)
    var up = cab.map(function (K, q) { K.q = q; return q; });
    function root(q) { while (up[q] !== q) { up[q] = up[up[q]]; q = up[q]; } return q; }
    cab.forEach(function (K) {
      var gp = gapTo(K, -1), gn = gapTo(K, 1);
      K.lo = gp <= CABLE_GAP ? Math.min(CABLE_TW, Math.floor((gp - 1) / 2)) : CABLE_TW;
      K.hi = gn <= CABLE_GAP ? Math.min(CABLE_TW, gn - 1 - Math.floor((gn - 1) / 2)) : CABLE_TW;
      for (d = 1; d <= K.lo; d++) if (!plainIn(K, K.i - d)) { K.lo = d - 1; break; }
      for (d = 1; d <= K.hi; d++) if (!plainIn(K, K.i + d)) { K.hi = d - 1; break; }
      for (var g = 0; g <= CABLE_GAP; g++) {
        var o = byRow[K.i + g];
        if (!o) continue;
        for (var q = 0; q < o.length; q++) if (o[q] !== K && overlaps(K, o[q])) up[root(o[q].q)] = root(K.q);
      }
    });
    cab.forEach(function (K) { for (d = -K.lo; d <= K.hi; d++) mark(K, K.i + d, d); });
    // each cable column is pulled in to cable gauge over its whole span
    var comps = {};
    cab.forEach(function (K) {
      var rq = root(K.q), half = rowsMode ? K.n / 2 : K.n / 2 / Math.max(1, W[K.i]);
      var cp = comps[rq] || (comps[rq] = { x0: Infinity, x1: -Infinity, r0: Infinity, r1: -Infinity, k: 0 });
      cp.x0 = Math.min(cp.x0, K.x - half); cp.x1 = Math.max(cp.x1, K.x + half);
      cp.r0 = Math.min(cp.r0, K.i - K.lo); cp.r1 = Math.max(cp.r1, K.i + K.hi);
      cp.k++;
    });
    /* ...from the panel's first plain row to its last: the cable column runs
       on before its first crossing and after its last one (to the bind-off,
       a shaping row or the rib below), not only between crossings */
    function colsOn(cp, jj) {
      return rowsMode
        ? [Math.round(cp.x0 + W[jj] / 2), Math.round(cp.x1 + W[jj] / 2)]
        : [Math.round(cp.x0 * W[jj]), Math.round(cp.x1 * W[jj])];
    }
    function compPlain(cp, jj) {
      if (jj < 0 || jj >= n || !(W[jj] > 0)) return false;
      var l = arr(list[jj] && list[jj].stitches);
      if (!l || !l.length) return false;
      var cc = colsOn(cp, jj), slot = 0, q;
      for (q = 0; q < l.length; q++) {
        var sp = knitSpan(l[q]);
        for (var z = 0; z < sp; z++, slot++) {
          var c2 = rtl(jj) ? W[jj] - 1 - slot : slot;
          if (c2 < cc[0] || c2 >= cc[1]) continue;
          if (CABLE_PLAIN[(l[q] && l[q].t) || 'k'] !== 1) return false;
          if (l[q] && l[q].t !== 'cable' && isNum(l[q].w) && l[q].w < CABLE_W - 1e-6) return false;
        }
      }
      return true;
    }
    for (var ck in comps) {
      if (!Object.prototype.hasOwnProperty.call(comps, ck)) continue;
      var cq = comps[ck];
      cq.r0 = Math.max(0, cq.r0); cq.r1 = Math.min(n - 1, cq.r1);
      while (cq.r0 > 0 && compPlain(cq, cq.r0 - 1)) cq.r0--;
      while (cq.r1 < n - 1 && compPlain(cq, cq.r1 + 1)) cq.r1++;
    }
    var columns = [];
    for (var key in comps) {
      if (!Object.prototype.hasOwnProperty.call(comps, key)) continue;
      var cp2 = comps[key];
      columns.push({ x0: cp2.x0, x1: cp2.x1, r0: Math.max(0, cp2.r0), r1: Math.min(n - 1, cp2.r1), crossings: cp2.k });
      for (j = Math.max(0, cp2.r0); j <= Math.min(n - 1, cp2.r1); j++) {
        if (!(W[j] > 0)) continue;
        var c0 = rowsMode ? Math.round(cp2.x0 + W[j] / 2) : Math.round(cp2.x0 * W[j]);
        var c1 = rowsMode ? Math.round(cp2.x1 + W[j] / 2) : Math.round(cp2.x1 * W[j]);
        if (!pull[j]) pull[j] = new Uint8Array(W[j]);
        for (col = Math.max(0, c0); col < Math.min(W[j], c1); col++) pull[j][rtl(j) ? W[j] - 1 - col : col] = 1;
      }
    }
    columns.sort(function (a, b) { return a.x0 - b.x0; });
    return {
      tw: tw, pull: pull, columns: columns,
      crossings: cab.map(function (K) {
        return { i: K.i, c0: K.c0, n: K.n, cross: K.cross, f: K.f, kb: K.kb, lo: K.lo, hi: K.hi, x: K.x, column: root(K.q) };
      })
    };
  }

  /**
   * Rows worked flat on part of a round's stitches (a heel flap, a short-row
   * heel), per round: `{ring, ringP, count, P}` — the ring they belong to,
   * its width, and the row's own count and width — or null. Null overall when
   * the piece has none. Rounds mode only; the renderer calls this too, so the
   * held stitches that close the ring are drawn where the geometry put them.
   */
  function knitPartials(rounds) {
    var list = arr(rounds) || [];
    var n = list.length, out = new Array(n), any = false, anySide = false, i, r, c;
    for (i = 0; i < n; i++) if (isFlatRound(list[i])) { anySide = true; break; }
    var ring = 0, ringP = 0;
    for (i = 0; i < n; i++) {
      out[i] = null;
      r = list[i] || {};
      c = Math.max(0, r.count | 0);
      if (c <= 0 || r.outlier === true) continue;
      if (anySide && isFlatRound(r) && ring > 0 && c <= KNIT_PARTIAL * ring) {
        out[i] = { ring: ring, ringP: ringP, count: c, P: knitPerimeter(r) };
        any = true;
        continue;
      }
      ring = c; ringP = knitPerimeter(r);
    }
    if (!anySide) {
      /* No row in the piece says it was worked flat: read the heel off the
         counts — a run of rows on a small share of the ring that comes back. */
      ring = 0; ringP = 0;
      i = 0;
      while (i < n) {
        r = list[i] || {};
        c = Math.max(0, r.count | 0);
        if (c <= 0 || r.outlier === true) { i++; continue; }
        if (ring > 0 && c <= KNIT_FB_DROP * ring) {
          var j = i;
          while (j < n && (Math.max(0, (list[j] || {}).count | 0)) > 0 &&
                 (list[j].count | 0) <= KNIT_FB_DROP * ring) j++;
          if (j - i >= KNIT_FB_RUN && j < n && (list[j].count | 0) >= KNIT_FB_BACK * ring) {
            for (var q = i; q < j; q++) {
              out[q] = { ring: ring, ringP: ringP, count: list[q].count | 0, P: knitPerimeter(list[q]) };
            }
            any = true;
          }
          i = j;
          continue;
        }
        ring = c; ringP = knitPerimeter(r);
        i++;
      }
    }
    if (!any) return null;
    /* The ring a run of partial rows is closed to walks from the round before
       it to the round after it: the stitches a gusset picks up along a heel
       flap's edges are fabric the flap's selvedges were making all along, so
       the tube widens over the heel instead of jumping (and frilling) at the
       pick-up round. A toe-up heel narrows back to the leg the same way. */
    i = 0;
    while (i < n) {
      if (!out[i]) { i++; continue; }
      var a = i;
      while (i < n && out[i]) i++;
      var g = i;
      while (g < n && !(Math.max(0, (list[g] || {}).count | 0) > 0 && list[g].outlier !== true)) g++;
      if (g >= n) continue;
      var L = i - a, cG = list[g].count | 0, pG = knitPerimeter(list[g]);
      var r0 = out[a].ring, p0 = out[a].ringP;
      for (var k = 0; k < L; k++) {
        var f = (k + 1) / (L + 1), e = out[a + k];
        e.ring = Math.max(e.count, Math.round(r0 + (cG - r0) * f));
        e.ringP = Math.max(e.P, p0 + (pG - p0) * f);
      }
    }
    return out;
  }

  /** A knit round as the walk wants it: heights in sc units, a partial row
      closed to its ring by its held stitches. */
  function knitGeoRound(r, part, pull) {
    var src = r || {}, c = {}, k;
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) c[k] = src[k];
    var l = arr(src.stitches) || [], st2 = [], i, rowH = 0, slot = 0;
    for (i = 0; i < l.length; i++) {
      var h = knitRecH(l[i]);
      if (h > rowH) rowH = h;
      /* a cable is one record over several stitches: spread its width over
         them, or the walk pads the round's count with phantom stitches */
      var span = knitSpan(l[i]), w = knitRecW(l[i]), t = (l[i] && l[i].t) || 'k';
      for (var q = 0; q < span; q++, slot++) {
        // a stitch in a cable column is drawn at cable gauge (1.6.0)
        var ws = w / span;
        if (pull && pull[slot] === 1 && CABLE_PULL[t] === 1 && ws > CABLE_W) ws = CABLE_W;
        st2.push({ t: t, h: h / SH_SC, w: ws });
      }
    }
    if (!(rowH > 0)) rowH = isNum(src.height) && src.height > 0 ? src.height : KNIT_ROW_H;
    if (part && part.ring > part.count) {
      var nHeld = part.ring - part.count;
      var wHeld = Math.max(0, part.ringP - part.P) / nHeld;
      for (i = 0; i < nHeld; i++) st2.push({ t: 'k', h: rowH / SH_SC, w: wHeld });
      c.count = part.ring;
      c.knitPartial = true;
    }
    c.stitches = st2;
    c.height = (isNum(src.height) && src.height > 0 ? src.height : rowH) / SH_SC;
    return c;
  }

  /**
   * Knitting shapes by "increase every other round" (a raglan's +8, 0, +8),
   * and a rib at 0.8 a stitch runs into stockinette at 1.0: as steps, the
   * walk reads every increase round as a frill and every plain one as a wall,
   * a staircase the fabric does not have. The ring a round is DRAWN at (its
   * record widths, scaled) is eased with its neighbours, two passes of a
   * 1-2-1 filter; the stitch counts are untouched. Never across a partial
   * row, an outlier, a jump of more than KNIT_EASE_JUMP (a yoke's divide, a
   * gusset's pick-up), or at the first and last rounds.
   */
  var KNIT_EASE_JUMP = 0.2;
  var KNIT_RUFFLE_RATE = 2;     // an increase round frills past 2x the flat rate...
  var KNIT_RUFFLE_FRAC = 0.25;  // ...or past a quarter of the round before it
  function knitEase(kr, parts) {
    var n = kr.length, i, pass, P = new Array(n);
    for (i = 0; i < n; i++) P[i] = knitPerimeter(kr[i]);
    function ok(j) {
      return j >= 0 && j < n && P[j] > 0 && !(parts && parts[j]) && kr[j].outlier !== true &&
        (kr[j].count | 0) > 0;
    }
    var cur = P.slice();
    for (pass = 0; pass < 2; pass++) {
      var nxt = cur.slice();
      for (i = 1; i < n - 1; i++) {
        if (!ok(i) || !ok(i - 1) || !ok(i + 1)) continue;
        if (Math.abs(cur[i - 1] - cur[i]) > KNIT_EASE_JUMP * cur[i] ||
            Math.abs(cur[i + 1] - cur[i]) > KNIT_EASE_JUMP * cur[i]) continue;
        nxt[i] = (cur[i - 1] + 2 * cur[i] + cur[i + 1]) / 4;
      }
      cur = nxt;
    }
    for (i = 0; i < n; i++) {
      if (!(P[i] > 0) || Math.abs(cur[i] - P[i]) < 1e-9) continue;
      var k = cur[i] / P[i], l = kr[i].stitches;
      for (var q = 0; q < l.length; q++) l[q].w *= k;
      kr[i].knitEased = k;
    }
  }

  /* ---- the warp: one mapping of the finished mesh, applied by the renderer */

  /** Rotate v about the axis through the origin that turns `u` (horizontal,
      unit) toward -y by `a`: u -> cos a·u - sin a·y, y -> sin a·u + cos a·y. */
  function bendRot(ux, uz, a, x, y, z, out) {
    var ca = Math.cos(a), sa = Math.sin(a);
    var pa = x * ux + z * uz;                     // along u
    var rx = x - pa * ux, rz = z - pa * uz;       // the untouched part
    var na = pa * ca + y * sa, ny = -pa * sa + y * ca;
    out[0] = rx + na * ux; out[1] = ny; out[2] = rz + na * uz;
    return out;
  }

  var _w = [0, 0, 0];
  /**
   * Where a point of the straight (walked) piece lands on the finished one.
   * `w` is `layout(...).warp`; `band` (optional) is the band the point
   * belongs to, for a rows height field. Pure; `out` is [x, y, z].
   */
  function warpPoint(w, band, x, y, z, out) {
    out = out || [0, 0, 0];
    if (!w) { out[0] = x; out[1] = y; out[2] = z; return out; }
    var f = band && band.field;
    if (f && f.bot && band.yTop > band.yBot) {
      var gx = (x - f.x0) / f.dx, j = Math.floor(gx), last = f.bot.length - 1;
      if (j < 0) j = 0; if (j > last - 1) j = Math.max(0, last - 1);
      var t = last > 0 ? clamp(gx - j, 0, 1) : 0;
      var fb = f.bot[j] + (f.bot[Math.min(j + 1, last)] - f.bot[j]) * t;
      var ft = f.top[j] + (f.top[Math.min(j + 1, last)] - f.top[j]) * t;
      var tt = (y - band.yBot) / (band.yTop - band.yBot);
      y = fb + tt * (ft - fb);
    }
    if (w.chevron) {
      var a = w.chevron.a, sa = Math.sin(a), ca = Math.cos(a), ta = sa / ca;
      // worked toward the apex: the same triangle, walked the other way (and
      // mirrored once more, so the map keeps its handedness)
      if (w.chevron.rev) { y = w.chevron.H - y; x = -x; }
      var sg = x < 0 ? 1 : -1, xa = Math.abs(x);
      var u = xa - y * ta;
      var nx = sg * (y * sa + u * ca);
      var ny = -(y * ca - u * sa);
      x = nx; y = ny;
    }
    /* the yoke's sleeve tops fall in the walked frame, before any bend
       (a back-neck wedge above the yoke tilts the yoke with it) */
    if (w.yoke && y >= w.yoke.y0 - 1e-9) {
      var ax = w.yoke.ax || 0;
      var over = (ax ? Math.abs(x * Math.cos(ax) + z * Math.sin(ax)) : Math.abs(x)) - w.yoke.rb;
      if (over > 0) y -= over * w.yoke.t;
    }
    if (w.bends && w.bends.length) {
      var y0 = y, px = x, py = y, pz = z, k, b;
      for (k = w.bends.length - 1; k >= 0; k--) {
        b = w.bends[k];
        if (y0 > b.y0) continue;
        if (y0 >= b.y1) {
          // inside the bend: a fan about the pivot, the row's height spent as angle
          var th = b.phi * (b.y0 - y0) / Math.max(b.y0 - b.y1, 1e-9);
          bendRot(b.ux, b.uz, th, x - b.px, 0, z - b.pz, _w);
        } else {
          bendRot(b.ux, b.uz, b.phi, px - b.px, py - b.y0 - (b.y1 - b.y0), pz - b.pz, _w);
        }
        px = _w[0] + b.px; py = _w[1] + b.y0; pz = _w[2] + b.pz;
      }
      x = px; y = py; z = pz;
    }
    if (w.disp) {
      var d = w.disp;
      bendRot(d.ux, d.uz, d.psi, x, y, z, _w);
      x = _w[0] + d.tx; y = _w[1] + d.ty; z = _w[2] + d.tz;
    }
    out[0] = x; out[1] = y; out[2] = z;
    return out;
  }

  /* ---- rounds */

  function classifyKnitRounds(m, rounds, o) {
    var n = rounds.length, i;
    var parts = knitPartials(rounds);
    var cables = knitCables(rounds, 'rounds', 0);
    var kr = [];
    for (i = 0; i < n; i++) kr.push(knitGeoRound(rounds[i], parts ? parts[i] : null, cables ? cables.pull[i] : null));
    knitEase(kr, parts);
    var sm = m.shape || {};
    var shape = shapeOf({ mode: 'rounds', rounds: kr, shape: sm });

    /* A knitted piece starts on a cast-on edge, which is open — unless the
       pattern names a closed toe cast-on (the store's `closedStart`), or it
       casts on a handful of stitches and increases at once: a toe or a
       crown worked from its tip. */
    var rises = false;
    for (i = 1; i < Math.min(n, 4); i++) if ((kr[i].count | 0) > shape.firstCount) rises = true;
    var closedStart = sm.closedStart === true || sm.start === 'magic-ring' ||
      (shape.firstCount > 0 && shape.firstCount <= KNIT_CLOSED_START &&
       shape.firstCount <= KNIT_CLOSED_FRAC * shape.maxCount && rises);
    shape.closedTop = !!closedStart;
    // a toe grafted shut (Kitchener) is closed too, not only a gathered crown
    if (sm.graft === true && shape.lastCount > 0 && shape.lastCount <= KNIT_GRAFT_FRAC * shape.maxCount) {
      shape.closedBottom = true;
    }
    shape.knit = true;
    /* A garment open at both ends (a sweater body, a cowl, a sleeve, a leg)
       has nothing in it to inflate: the turn-in rule would loft a yoke into a
       lampshade's dome. Only a stated stuffing or a closed end keeps a slack. */
    if (shape.stuffed !== true && !shape.closedTop && !shape.closedBottom) shape.slack = SLACK_OPEN;

    var flip;
    if (o.upsideDown != null) flip = o.upsideDown === true;
    else if (sm.upsideDownSource === 'part') flip = sm.upsideDown === true;
    else if (parts) flip = false;
    // a hat worked brim-up shows its crown up
    else if (shape.closedBottom && !shape.closedTop) flip = true;
    else flip = shape.upsideDown === true;

    var cls = classifyRounds(kr, shape, flip, o.terrace !== false);
    /* A round with no more stitches than the one before it adds no fabric:
       when its WIDTH still steps (a k2p2 rib at 0.8 a stitch going on in
       stockinette at 1.0) the fabric flares, and when it drops (a yoke's
       divide) it steps in — neither frills. */
    for (i = 1; i < n; i++) {
      var ek = cls.rounds[i];
      if (!ek || !ek.ruffle) continue;
      /* ...and an increase round frills only when it really outruns the
         fabric: a knitted ruffle doubles its stitches, while a raglan's +8
         after a rib or the last round before a divide is shaping */
      var dn = (kr[i].count | 0) - (kr[i - 1].count | 0);
      /* (1.6.0) ...and only past BOTH: an even increase round of 16 on 64
         after a rib (Sandnes ladies' neck) is 25% and flares, it does not frill */
      if (dn > 0 && dn > KNIT_RUFFLE_RATE * flatRate(ek.h / SH_SC, 1) && dn > KNIT_RUFFLE_FRAC * (kr[i - 1].count | 0)) continue;
      ek.ruffle = false; ek.prof = null; ek.lobes = 0; ek.kind = 'ring';
      ek.radiusDraw = ek.radius; ek.radiusMax = ek.radius; ek.radiusMin = ek.radius;
      cls.ruffles--;
    }
    var info = { partials: 0, bends: [], yoke: null, toeUp: false, cables: cables ? cables.crossings.length : 0 };
    if (parts) {
      for (i = 0; i < n; i++) if (parts[i]) { info.partials++; cls.rounds[i].partial = true; }
    }

    /* (17, 1.6.0) A few short rows on part of the round — the German short
       rows across a top-down sweater's back neck — are a WEDGE, not a heel:
       the worked side gains their height and the piece tilts by that much,
       not a right angle. A heel is a long run (a flap, a turn: 20+ rows). */
    var runs = [];
    if (parts) {
      i = 0;
      while (i < n) {
        if (!parts[i]) { i++; continue; }
        var a0 = i;
        while (i < n && parts[i]) i++;
        runs.push({ a: a0, b: i - 1, wedge: i - a0 <= KNIT_WEDGE_ROWS });
      }
    }
    var heels = runs.filter(function (u) { return !u.wedge; }).length;

    // a yoke goes on through a wedge (its partial rows are closed to the ring)
    var yoke = heels ? null : knitYoke(kr, cls);
    if (yoke) info.yoke = yoke;

    var warp = null;
    if (runs.length) {
      var bends = [];
      for (var ri = 0; ri < runs.length; ri++) {
        var a = runs[ri].a, b = runs[ri].b;
        var ea = cls.rounds[a], eb = cls.rounds[b];
        var top = ea.yTop, bot = eb.y;
        var L = top - bot;
        if (!(L > 0)) continue;
        var r = Math.max(ea.radius, R_MIN);
        /* A heel turns the tube; a wedge raises its worked side by the rows'
           own height across the tube's diameter. */
        var phi = runs[ri].wedge ? Math.min(KNIT_WEDGE_MAX, L / (2 * r)) : Math.min(KNIT_BEND_MAX, L / r);
        /* The worked stitches are drawn at the END of the ring (the renderer
           puts the held ones first, so they stay solid while the row fills),
           so the worked side is centred at 2π − π·f; the pivot is opposite. */
        var f = clamp(parts[a].P / Math.max(parts[a].ringP, 1e-9), 0.05, 1);
        var thc = TAU - Math.PI * f;
        var ux = Math.cos(thc), uz = Math.sin(thc);
        bends.push({ y0: top, y1: bot, phi: phi, ux: ux, uz: uz, px: -r * ux, pz: -r * uz, from: a, to: b, length: L,
          wedge: runs[ri].wedge, th: thc });
      }
      if (bends.length) {
        warp = { bends: bends, disp: null, chevron: null, field: false };
        info.bends = bends;
        var Phi = 0;
        for (i = 0; i < bends.length; i++) Phi += bends[i].phi;
        var lb = bends[bends.length - 1];
        if (shape.closedTop && !lb.wedge) {
          /* Toe-up: the walk starts at the toe, so the LEG is the last segment.
             Turn the whole piece so the leg stands up, cuff on top. */
          warp.disp = { psi: Math.PI - Phi, ux: lb.ux, uz: lb.uz, tx: 0, ty: 0, tz: 0 };
          info.toeUp = true;
        } else if (!heels) {
          /* Wedges only: the longer stretch after them (a yoke and its body
             below a back neck) stands upright, and the shorter one before
             them (the neck rib) carries the tilt — back higher than front. */
          // ...by the fabric each side holds (stitches × row height), not its rise
          var before = 0, after = 0;
          for (i = 0; i < bends[0].from; i++) before += (kr[i].count | 0) * (cls.rounds[i].h || 0);
          for (i = lb.to + 1; i < n; i++) after += (kr[i].count | 0) * (cls.rounds[i].h || 0);
          if (after > before) warp.disp = { psi: -Phi, ux: lb.ux, uz: lb.uz, tx: 0, ty: 0, tz: 0 };
          info.wedge = { rows: 0, phi: Phi, th: lb.th };
          for (i = 0; i < bends.length; i++) info.wedge.rows += bends[i].to - bends[i].from + 1;
        }
      }
    }
    if (yoke) {
      /* The sleeve tops of a yoke hang off the shoulders: past the body's own
         radius the yoke falls away at YOKE_DROOP, so its sides read as
         shoulders running into the arms, not as the brim of a lampshade.
         With a back-neck wedge the yoke's long axis (the sleeves) lies across
         the wedge, so the raised side is the back. */
      var ax = info.wedge ? info.wedge.th + Math.PI / 2 : 0;
      if (ax) knitYokeTurn(cls, yoke, ax);
      var yk = { rb: yoke.bodyRadius, t: Math.tan(YOKE_DROOP), y0: cls.rounds[yoke.divide].y, ax: ax };
      if (warp) warp.yoke = yk;
      else warp = { bends: null, disp: null, chevron: null, field: false, yoke: yk };
    }
    cls.warp = warp;
    cls.knit = info;
    return cls;
  }

  /** Turn a yoke's stadium so its long axis lies at angle `ax`. */
  function knitYokeTurn(cls, yoke, ax) {
    for (var i = yoke.from; i < yoke.divide; i++) {
      var e = cls.rounds[i];
      if (!e || e.kind !== 'yoke' || !e.prof) continue;
      var base = e.prof;
      var f = (function (g) { return function (th, t) { return g(th - ax, t); }; }(base));
      f.kind = base.kind; f.corners = base.corners || 0; f.straight = base.straight; f.endR = base.endR;
      f.sig = base.sig + Math.round(ax * 1000) * 7919;
      e.prof = f;
    }
    yoke.axis = ax;
  }

  /** (14) The raglan yoke: an increase run, then a one-round divide. */
  function knitYoke(kr, cls) {
    var n = kr.length, i, d = -1;
    for (i = 1; i < n; i++) {
      var c = kr[i].count | 0, p = kr[i - 1].count | 0;
      if (!(c > 0 && p > 0) || c > YOKE_DIVIDE * p) continue;
      // >= YOKE_MIN_INC increasing rounds before it, growing the ring >= 1.3x
      var j = i - 1, inc = 0, lo = p;
      while (j > 0 && (kr[j - 1].count | 0) > 0 && (kr[j - 1].count | 0) <= (kr[j].count | 0)) {
        if ((kr[j - 1].count | 0) < (kr[j].count | 0)) inc++;
        lo = kr[j - 1].count | 0;
        j--;
      }
      if (inc < YOKE_MIN_INC || p < YOKE_GROWTH * lo) continue;
      // and the body goes on: >= 2 rounds at about the divide's count
      var after = 0;
      for (var q = i + 1; q < n && after < 2; q++) {
        if ((kr[q].count | 0) >= 0.9 * c && (kr[q].count | 0) <= 1.1 * c) after++;
        else break;
      }
      /* ...or the part ends at the divide (a yoke section whose body is its
         own part: Sandnes' YOKE, Patons' Bottom Yoke) */
      if (after < 2 && !(q >= n && after === n - 1 - i)) continue;
      d = i;
      cls.yokeFrom = j;
      break;
    }
    if (d < 0) return null;
    var rs = cls.rounds, from = cls.yokeFrom;
    var body = rs[d];
    var rb = Math.max(body.radius, R_MIN);
    var Pb = rb * TAU;
    for (i = from; i < d; i++) {
      var e = rs[i];
      if (!e || e.empty || e.outlier) continue;
      var P = e.radius * TAU;
      if (P <= Pb * 1.001) continue;
      var straight = (P - Pb) / 2;
      e.prof = profileStadium(straight, rb, e.radius);
      e.kind = 'yoke';
      var rg = profileRange(e.prof);
      e.radiusDraw = e.radius;
      e.radiusMax = e.radius * rg.max;
      e.radiusMin = e.radius * rg.min;
    }
    /* The divide rises a row: front and back go straight down into the body;
       only the sleeve tops step in. */
    var dyWant = body.h, add = dyWant - body.dy;
    if (add > 0) {
      body.dy = dyWant;
      body.y -= add;
      for (i = d + 1; i < rs.length; i++) { rs[i].y -= add; rs[i].yTop -= add; }
      cls.height += add;
      cls.aspect = cls.maxRadius > 0 ? cls.height / (2 * cls.maxRadius) : 0;
    }
    var maxX = 0;
    for (i = 0; i < rs.length; i++) if (rs[i].radiusMax > maxX) maxX = rs[i].radiusMax;
    return { from: from, divide: d, bodyRadius: rb, width: 2 * maxX };
  }

  /* ---- rows */

  function classifyKnitRows(m, rounds) {
    var n = rounds.length, i;
    var kr = [];
    var cables = knitCables(rounds, 'rows', 0);
    for (i = 0; i < n; i++) kr.push(knitGeoRound(rounds[i], null, cables ? cables.pull[i] : null));
    var shape = shapeOf({ mode: 'rows', rounds: kr, shape: m.shape || {} });
    shape.knit = true;
    var cls = classifyRows(kr, shape, true);
    var info = { shortRows: 0, chevron: null, cables: cables ? cables.crossings.length : 0 };
    var field = knitShortRows(rounds, cls);
    if (field) info.shortRows = field;
    var chev = knitChevron(kr, cls);
    if (chev) info.chevron = chev;
    cls.warp = (field || chev) ? { bends: null, disp: null, chevron: chev, field: !!field } : null;
    cls.knit = info;
    return cls;
  }

  /** (15) Short rows: re-anchor them and lay every row on a height field. */
  function knitShortRows(rounds, cls) {
    var rs = cls.rounds, n = rs.length, i, lastFull = -1, nShort = 0;
    var isShort = new Array(n);
    for (i = 0; i < n; i++) {
      var e = rs[i];
      if (!e || e.outlier || !(e.width > 0)) continue;
      var src = rounds[i] || {};
      if (src.shortRow === true && lastFull >= 0 && e.width < SHORT_ROW_FRAC * rs[lastFull].width) {
        isShort[i] = true;
        nShort++;
        var full = rs[lastFull];
        /* Rows alternate direction (the renderer lays an even row left to
           right), so the last full row ended at its right edge when its index
           is even: the short rows start, turn and come back from there. */
        e.x0 = (lastFull & 1) === 0 ? full.x0 + full.width - e.width : full.x0;
        // ...and it turns at its other end, where the wrap tapers it to nothing
        e.turnX = (lastFull & 1) === 0 ? e.x0 : e.x0 + e.width;
        e.shortRow = true;
        continue;
      }
      /* The reference full row is the last one NOT marked as turning (a
         flagged row as wide as it does not replace it, or a run of short rows
         would shrink its own yardstick row by row); a piece whose every row
         says `turn` takes its first row. */
      if (src.shortRow !== true || lastFull < 0) lastFull = i;
    }
    if (!nShort) return 0;
    var xMin = Infinity, xMax = -Infinity;
    for (i = 0; i < n; i++) {
      if (!rs[i] || rs[i].outlier || !(rs[i].width > 0)) continue;
      xMin = Math.min(xMin, rs[i].x0); xMax = Math.max(xMax, rs[i].x0 + rs[i].width);
    }
    var cols = Math.max(2, Math.ceil((xMax - xMin) / FIELD_DX) + 1);
    var H = new Float64Array(cols), top = 0;
    for (i = 0; i < n; i++) {
      var r = rs[i];
      if (!r || r.outlier || !(r.width > 0)) {
        if (r) { r.y = top; r.yTop = top; }
        continue;
      }
      var j0 = Math.max(0, Math.floor((r.x0 - xMin) / FIELD_DX));
      var j1 = Math.min(cols - 1, Math.ceil((r.x0 + r.width - xMin) / FIELD_DX));
      var bot = [], tp = [], lo = Infinity, hi = -Infinity, j;
      var add = [];
      for (j = j0; j <= j1; j++) {
        var hj = r.h;
        if (r.shortRow && r.turnX != null) {
          hj *= clamp(Math.abs(xMin + j * FIELD_DX - r.turnX) / SHORT_ROW_TAPER, 0, 1);
        }
        add.push(hj);
        bot.push(H[j]); tp.push(H[j] + hj);
        if (H[j] < lo) lo = H[j];
        if (H[j] + hj > hi) hi = H[j] + hj;
      }
      for (j = j0; j <= j1; j++) H[j] += add[j - j0];
      r.field = { x0: xMin + j0 * FIELD_DX, dx: FIELD_DX, bot: bot, top: tp };
      r.y = lo; r.yTop = hi; r.dy = hi - lo;
      if (hi > top) top = hi;
    }
    cls.height = top;
    cls.aspect = cls.width > 0 ? top / cls.width : 0;
    return nShort;
  }

  /** (16) A triangle grown from a centre spine: rows are chevrons. */
  function knitChevron(kr, cls) {
    var rs = cls.rounds, n = rs.length, i;
    var first = 0, last = 0;
    /* Edge + spine shaping rows, for increases (grown from the centre of the
       top edge, top-down) and for decreases (worked from the two lower edges
       up to the neck point, like the Icelandic "Thórdís"): the same triangle,
       its rows walked the other way. */
    var tally = { inc: { rows: 0, tri: 0 }, dec: { rows: 0, tri: 0 } };
    for (i = 0; i < n; i++) {
      var r = kr[i], c = Math.max(1, r.count | 0);
      if (!rs[i] || rs[i].outlier || !(rs[i].width > 0)) continue;
      if (!first) first = c;
      last = c;
      var s = sites(r);
      ['inc', 'dec'].forEach(function (kind) {
        var list = s[kind];
        if (!list || !list.length) return;
        tally[kind].rows++;
        var edge = Math.max(1, Math.round(c * 0.1));
        var lo = false, hi = false, mid = false;
        for (var j = 0; j < list.length; j++) {
          var ix = list[j];
          if (ix <= edge) lo = true;
          else if (ix >= c - 1 - edge) hi = true;
          else if (Math.abs(ix - c / 2) <= Math.max(1, c * 0.12)) mid = true;
        }
        if (lo && hi && mid) tally[kind].tri++;
      });
    }
    var grow = tally.inc.tri >= 2 && tally.inc.tri >= SPINE_FRAC * tally.inc.rows && first <= 0.25 * last;
    var shrink = !grow && tally.dec.tri >= 2 && tally.dec.tri >= SPINE_FRAC * tally.dec.rows && last <= 0.25 * first;
    if (!grow && !shrink) return null;
    // tan(a) = (w/4)/y — y measured from the apex — least squares through it
    var H = cls.height, sxy = 0, syy = 0;
    for (i = 0; i < n; i++) {
      var e = rs[i];
      if (!e || e.outlier || !(e.width > 0)) continue;
      var y = (e.y + e.yTop) / 2;
      if (shrink) y = H - y;
      sxy += (e.width / 4) * y; syy += y * y;
    }
    if (!(syy > 0)) return null;
    var a = clamp(Math.atan(sxy / syy), CHEVRON_MIN, CHEVRON_MAX);
    return { a: a, rows: grow ? tally.inc.tri : tally.dec.tri, rev: !!shrink, H: H };
  }

  /** Band extents through the warp, for the fit (rad about the y axis). */
  function knitExtents(cls, bands) {
    var w = cls.warp, i, k, t, p = [0, 0, 0];
    var bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    var sig = 0;
    if (w && w.bends) for (i = 0; i < w.bends.length; i++) sig += w.bends[i].phi * 1000 + w.bends[i].y0 * 7;
    if (w && w.chevron) sig += w.chevron.a * 5000 + 17;
    if (w && w.disp) sig += w.disp.psi * 300 + 3;
    if (w && w.yoke) sig += w.yoke.rb * 100 + 29 + (w.yoke.ax || 0) * 333;
    function take(b, x, y, z) {
      warpPoint(w, b, x, y, z, p);
      if (p[0] < bx0) bx0 = p[0]; if (p[0] > bx1) bx1 = p[0];
      if (p[1] < by0) by0 = p[1]; if (p[1] > by1) by1 = p[1];
      if (p[2] < bz0) bz0 = p[2]; if (p[2] > bz1) bz1 = p[2];
      return p;
    }
    var exts = [];
    for (i = 0; i < bands.length; i++) {
      var b = bands[i];
      exts.push(null);
      if (!b) continue;
      var rad = 0, ymin = Infinity, ymax = -Infinity;
      if (cls.mode === 'rows') {
        for (t = 0; t < 2; t++) {
          for (k = 0; k <= 8; k++) {
            var xx = b.x0 + b.width * k / 8;
            take(b, xx, t ? b.yTop : b.yBot, 0);
            rad = Math.max(rad, Math.abs(p[0]));
            ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]);
          }
        }
      } else {
        for (t = 0; t < 2; t++) {
          var rr = t ? b.rBot : b.rTop, yy = t ? b.yBot : b.yTop;
          for (k = 0; k < 16; k++) {
            var th = k / 16 * TAU, mul = b.prof ? b.prof(th, t) : 1;
            take(b, rr * mul * Math.cos(th), yy, rr * mul * Math.sin(th));
            rad = Math.max(rad, Math.sqrt(p[0] * p[0] + p[2] * p[2]));
            ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]);
          }
        }
      }
      b.ext = { rad: rad, ymin: ymin, ymax: ymax };
      b.warpSig = Math.round(sig);
      exts[i] = b.ext;
    }
    return { x0: bx0, x1: bx1, y0: by0, y1: by1, z0: bz0, z1: bz1 };
  }

  /** Toe-up display: move the leg onto the y axis, the top to y = 0. */
  function knitPlace(cls, bands) {
    var w = cls.warp;
    if (!w || !w.disp) return;
    var last = -1, i;
    for (i = bands.length - 1; i >= 0; i--) if (bands[i]) { last = i; break; }
    if (last < 0) return;
    var p = warpPoint(w, null, 0, bands[last].yBot, 0, [0, 0, 0]);
    w.disp.tx = -p[0]; w.disp.tz = -p[2];
    var box = knitExtents(cls, bands);
    w.disp.ty = -box.y1;
  }

  /** Layout for a knitted piece: the shared bands, then the warp's extents. */
  function knitLayout(cls, bands) {
    if (cls.mode === 'rows') {
      for (var i = 0; i < bands.length; i++) {
        var e = cls.rounds[i];
        if (bands[i] && e && e.field) { bands[i].field = e.field; bands[i].sig += 7e6; }
        if (bands[i] && e && e.shortRow) bands[i].x0 = e.x0;
      }
    }
    if (!cls.warp) return;
    knitPlace(cls, bands);
    var box = knitExtents(cls, bands);
    cls.knit.box = box;
    cls.knit.extentHeight = box.y1 - box.y0;
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
    if (cls.knit) knitLayout(cls, bands);
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
    version: '1.6.0',

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
    OPEN_TURN_IN: OPEN_TURN_IN,
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
    LOOP: { w: LOOP_W, minFrac: LOOP_MIN_FRAC },
    TERRACE: {
      alpha: TERRACE_ALPHA, yarn: TERRACE_YARN,
      flatMax: TERRACE_FLAT_MAX, minTreads: TERRACE_MIN_TREADS
    },

    // stitch metrics
    stitchH: stitchH,
    stitchW: stitchW,
    roundMetrics: roundMetrics,
    flatRate: flatRate,
    loopSag: loopSag,

    // structure
    sites: sites,
    sitePositions: sitePositions,
    cornerGroups: cornerGroups,
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

    // knitting (1.5.0, wave H)
    KNIT: {
      rowH: KNIT_ROW_H, partial: KNIT_PARTIAL, bendMax: KNIT_BEND_MAX,
      closedStart: KNIT_CLOSED_START, closedFrac: KNIT_CLOSED_FRAC, graftFrac: KNIT_GRAFT_FRAC,
      yokeDivide: YOKE_DIVIDE, yokeGrowth: YOKE_GROWTH, shortRowFrac: SHORT_ROW_FRAC,
      fallbackDrop: KNIT_FB_DROP, fallbackRun: KNIT_FB_RUN,
      cableTw: CABLE_TW, cableGap: CABLE_GAP, cableW: CABLE_W, wedgeRows: KNIT_WEDGE_ROWS, wedgeMax: KNIT_WEDGE_MAX
    },
    isKnit: isKnit,
    knitPartials: knitPartials,
    knitSpan: knitSpan,
    warpPoint: warpPoint,
    // cables (1.6.0, knit-3d-2)
    knitCables: knitCables,
    cableShapeOf: cableShapeOf,

    // the two the renderer calls
    classify: classify,
    layout: layout,
    fit: fit
  };

}(typeof window !== 'undefined' ? window : this));
