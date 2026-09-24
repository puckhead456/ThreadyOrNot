/* =====================================================================
   js/diagram-geo.js — crochet geometry for the live 3D diagram.

   Pure functions, no WebGL, no DOM. `js/diagram.js` consumes this for the
   layout / band / cap / fit code paths; `test/diagram.test.html` asserts it
   directly and `test/diagram.gallery.html` prints it.

   The physics is docs/brainstorm/3d/01-geometry-truth.md:

     N_flat = 2*pi*h/w                       stitches added per round to stay flat
     dy     = h*sqrt(1 - ((1-s)*|dr|/h)^2)   vertical rise, s = stuffing slack
     r      = (sum of stitch widths) / 2pi   ring radius from the real perimeter

   so "+6 sc lies flat", "0 change is a cylinder" and "|dn| > N_flat ruffles"
   all fall out of one line instead of the old asin(R/Rmax) fudge.

   Model v2 (from Store.diagramModel) is the input:
     { mode, rounds:[{ count, done, stitches:[{t,c,h,w}], color, height,
                       ghost, inc:[i], dec:[i], row }],
       current, defaultColor,
       shape:{ start, chainLen, ringCount, stuffed }, window, deviation }
   Everything past `mode` + `rounds[].count` is optional: Model v1 (no shape,
   no inc/dec, no per-stitch h/w, `height` = the old 1 / 1.5 / 2 / 2.5) still
   lays out, it just gets rings instead of polygons and a guessed cap.

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

  var RUFFLE_EPS = 0.08;    // |dr| over h by more than this and the round frills
  var RUFFLE_RISE = 0.12;   // a ruffled round still rises this fraction of h
  var DY_MIN = 0.02;        // never exactly 0, as a fraction of h
  var R_MIN = 0.42;         // smallest ring radius for a non-empty round
  var RING_START = 0.30;    // closed magic ring, absolute cap in SW
  var RING_START_FRAC = 0.34;
  var CLOSE_COUNT = 8;      // "decreases back below ~8 stitches" = closed
  var GATHER_COUNT = 6;     // closes to <= 6 and stops = gathered shut

  /* Polygon detection (01 §1.4). Candidate corner counts in priority order. */
  var POLY_KS = [4, 6, 8, 3];
  var POLY_RUN = 3;             // >= 3 consecutive rounds, same k, same phase
  var POLY_OCCUPANCY = 0.8;     // >= ceil(0.8k) of the k slots occupied
  var POLY_MIN_PER_SITE = 1.8;  // a corner takes a group, not one stitch
  var SHARP_FLAT = 0.75;        // granny corners
  var SHARP_SOFT = 0.45;        // amigurumi darts
  var RIPPLE_AMP = 0.06;        // chevron: a gentle radial wave, still a ring
  var OVAL_MIN_END = 0.15;      // smallest end radius of a stadium

  var SHEET_CURVE = 3;          // rows: bend radius as a multiple of the width

  /* Fit clamps. Scales are in frustum units: `halfW`/`halfH` are the visible
     half-extents at the model plane, so `scale*rad/halfW` is the fraction of
     the half-width the silhouette covers. */
  var FIT_MIN_RADIUS_FRAC = 0.035;   // a 42-round tail is never a hairline
  var FIT_MAX_OVERSCALE = 2.5;       // ...but it is never cropped to a stub
  var FIT_MIN_HEIGHT_FRAC = 0.40;    // a 400-stitch row fills 40% of the height
  var FIT_MAX_OVERSCALE_ROWS = 8;    // ...overflowing sideways to get there

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
      var lim = Math.min(list.length, count > 0 ? count : list.length);
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
      var best = 0, bestKey = null;
      for (i = 0; i < keys.length; i++) {
        if (tally[keys[i]] > best) { best = tally[keys[i]]; bestKey = keys[i]; }
      }
      if (bestKey != null) {
        hBest = wSum > 0 && best / wSum < 0.5 ? hMean / wSum : parseFloat(bestKey);
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
   * Normalised `Model.shape` plus the three decisions that come out of it:
   * the stuffing slack, and whether the top / bottom of the piece is closed.
   */
  function shapeOf(model) {
    var m = model || {};
    var s = m.shape || {};
    var rounds = arr(m.rounds) || [];
    var start = typeof s.start === 'string' ? s.start : 'unknown';
    var chainLen = isNum(s.chainLen) && s.chainLen > 0 ? Math.floor(s.chainLen) : 0;
    var ringCount = isNum(s.ringCount) && s.ringCount > 0 ? Math.floor(s.ringCount) : 0;
    var stuffed = s.stuffed === true ? true : (s.stuffed === false ? false : null);
    var firm = s.stuffed === 'firm';
    if (firm) stuffed = true;

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

    /* Closed at the bottom: the piece decreases back to a handful of stitches
       and stops — `pull to close` (01 §1.6). */
    var closedBottom = seen && max > 12 && last <= GATHER_COUNT;
    var closesIn = seen && max > 12 && last <= CLOSE_COUNT;
    /* Open rim: the piece ends at (or within a round of) its widest — a hat, a
       cowl, a sock leg, a motif. Nothing inflates it. */
    var openEnd = seen && last >= max * 0.92;

    var slack;
    if (m.mode === 'rows') slack = 0;
    else if (firm) slack = SLACK_FIRM;
    else if (stuffed === true) slack = SLACK_STUFFED;
    else if (stuffed === false) slack = SLACK_UNSTUFFED;
    else if (closesIn) slack = SLACK_STUFFED;
    else if (openEnd) slack = SLACK_OPEN;
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
      firstCount: first, lastCount: last, maxCount: max
    };
  }

  /* ------------------------------------------------------ 4. cross-sections
     A profile is `f(theta) -> radius MULTIPLIER` about the mean radius
     P/2pi, so it is independent of the round's size and can be blended
     between two rounds. `f.kind`, `f.corners` and `f.sig` describe it. */

  function profileRing() { return null; }   // null = a circle, the fast path

  /** Regular k-gon of the same perimeter, blended toward the circle. */
  function profilePolygon(k, phase, sharp) {
    var half = Math.PI / k;
    var seg = TAU / k;
    // inradius / circle radius for equal perimeter
    var inr = Math.PI / (k * Math.tan(half));
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

  /**
   * Best k for one round's increase sites, or 0.
   * @returns {{k:number, phase:number, dev:number}|null}
   */
  function polygonFit(siteList, count) {
    if (!siteList || siteList.length < 3 || count < 6) return null;
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
      return { k: k, phase: -mean, dev: worst, sites: thetas.length };
    }
    return null;
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
  function classify(model) {
    var m = model || {};
    var mode = m.mode === 'rows' ? 'rows' : 'rounds';
    var rounds = arr(m.rounds) || [];
    var shape = shapeOf({ mode: mode, rounds: rounds, shape: m.shape });
    return mode === 'rows'
      ? classifyRows(rounds, shape)
      : classifyRounds(rounds, shape);
  }

  function classifyRounds(rounds, shape) {
    var n = rounds.length, i;
    var met = [], sit = [], fit = [];

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
         the test that keeps every amigurumi sphere round. */
      if (pf && i > 0 && dn / pf.sites < POLY_MIN_PER_SITE) pf = null;
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

    /* a chain-oval start carries its stadium until the increases stop matching */
    var ovalOn = shape.start === 'chain-oval' && shape.chainLen > 0;
    var straight = ovalOn ? shape.chainLen * SW : 0;

    var out = [];
    var prevR = 0, prevY = 0, maxR = 0, ruffles = 0, corners = 0;
    var firstR = 0, firstIdx = -1;
    for (i = 0; i < n; i++) {
      if (!met[i].empty) { firstR = Math.max(R_MIN, met[i].perimeter / TAU); firstIdx = i; break; }
    }
    prevR = shape.closedTop
      ? Math.min(RING_START * SW, firstR * RING_START_FRAC)
      : firstR;

    for (i = 0; i < n; i++) {
      var mt = met[i];
      var h = mt.hw;
      var entry = {
        index: i, kind: 'ring', corners: 0, chainLen: 0, straight: 0, endR: 0,
        perimeter: mt.perimeter, radius: prevR, meanRadius: prevR,
        y: prevY, yTop: prevY, h: h, dy: 0, ruffle: false, empty: mt.empty,
        prof: null, lobes: 0, slack: shape.slack, count: mt.count
      };

      if (mt.empty) {
        // a zero count is a row the parser could not read, never real fabric:
        // inherit the ring above instead of pinching a hole (04 defect F)
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
         look like a ruffle. */
      var kf = 1;
      var kind = 'ring';
      var polyk = 0;
      if (ripple[i]) kind = 'ripple';
      else if (polyK[i]) {
        kind = 'polygon';
        polyk = polyK[i];
        kf = polyk * Math.tan(Math.PI / polyk) / Math.PI;
      } else if (ovalOn) kind = 'oval';

      /* The first round of a magic-ring piece is worked INTO the ring, not
         wrapped around it from a previous round, so its apparent |dr| is
         whatever radius it opens out to. That is not a ruffle — it is the
         pole, and the cap covers it. */
      var isFirstFromRing = shape.closedTop && i === firstIdx;

      if (!isFirstFromRing && adr > h * kf * (1 + RUFFLE_EPS) && h > 0) {
        /* No surface of revolution exists: the surplus buckles (01 §1.7).
           The ring keeps the radius its circumference demands — suppressing it
           to the flat-rate radius cascades into every later round — and the
           surplus goes into an m-lobed wave about it. */
        ruffle = true;
        var rFlat = prevR + (dr > 0 ? h * kf : -h * kf);
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
        var q = h > 0 ? Math.min(1, (1 - shape.slack) * adr / (h * kf)) : 1;
        dy = h * Math.sqrt(Math.max(0, 1 - q * q));
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
          var sharp = Math.abs(dnk - nfk) <= 0.25 * nfk ? SHARP_FLAT : SHARP_SOFT;
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

      entry.dy = dy;
      entry.yTop = prevY;
      prevY -= dy;
      entry.y = prevY;
      var rng = profileRange(entry.prof);
      entry.radiusMax = entry.radius * rng.max;
      entry.radiusMin = entry.radius * rng.min;
      if (entry.radiusMax > maxR) maxR = entry.radiusMax;
      prevR = entry.radius;
      out.push(entry);
    }

    var height = -prevY;
    /* the equator is the CENTRE of the max-radius plateau (01 §1.6) */
    var first = -1, last = -1;
    for (i = 0; i < out.length; i++) {
      if (out[i].empty) continue;
      if (out[i].radiusMax >= maxR - 1e-9) { if (first < 0) first = i; last = i; }
    }
    var eqY = 0;
    if (first >= 0) eqY = -((out[first].y + out[last].y) / 2);
    return {
      mode: 'rounds',
      rounds: out,
      slack: shape.slack,
      shape: shape,
      closedTop: shape.closedTop,
      closedBottom: shape.closedBottom,
      height: height,
      maxRadius: maxR,
      width: 2 * maxR,
      aspect: maxR > 0 ? height / (2 * maxR) : 0,
      equatorFrac: height > 0 ? clamp(eqY / height, 0, 1) : 0,
      equatorRound: first >= 0 ? Math.round((first + last) / 2) : -1,
      corners: corners,
      ruffles: ruffles
    };
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
    var met = [], maxW = 0;
    for (i = 0; i < n; i++) {
      var mt = roundMetrics(rounds[i]);
      met.push(mt);
      if (mt.perimeter > maxW) maxW = mt.perimeter;
    }
    if (!(maxW > 0)) maxW = SW;

    var out = [], y = 0, totalH = 0;
    for (i = 0; i < n; i++) {
      var w = met[i].perimeter;
      var h = met[i].hw;
      var x0;
      if (anchor === 'left') x0 = maxW / 2 - w;
      else if (anchor === 'right') x0 = -maxW / 2;
      else x0 = -w / 2;
      out.push({
        index: i, kind: 'row', corners: 0, chainLen: 0,
        perimeter: w, width: w, radius: w / 2, meanRadius: w / 2,
        radiusMax: w / 2, radiusMin: w / 2,
        h: h, dy: h, y: y, yTop: y + h, x0: x0, anchor: anchor,
        ruffle: false, empty: met[i].empty, prof: null, count: met[i].count
      });
      y += h;
      totalH += h;
    }
    return {
      mode: 'rows',
      rounds: out,
      slack: 0,
      shape: shape,
      closedTop: false,
      closedBottom: false,
      anchor: anchor,
      height: totalH,
      width: maxW,
      maxRadius: maxW / 2,
      aspect: maxW > 0 ? totalH / maxW : 0,
      equatorFrac: 0,
      equatorRound: -1,
      corners: 0,
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
  function layout(model) {
    var cls = classify(model);
    var rounds = cls.rounds, i;
    var bands = [];

    if (cls.mode === 'rows') {
      var Rc = Math.max(cls.width * SHEET_CURVE, 8);
      for (i = 0; i < rounds.length; i++) {
        var r = rounds[i];
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
        if (!rounds[i].empty) { firstR = rounds[i].radius; break; }
      }
      prevR = cls.closedTop
        ? Math.min(RING_START * SW, firstR * RING_START_FRAC)
        : firstR;
      for (i = 0; i < rounds.length; i++) {
        var e = rounds[i];
        var prof = blendProfiles(prevProf, e.prof);
        bands.push({
          rTop: prevR, rBot: e.radius, yTop: e.yTop, yBot: e.y, reach: e.h,
          prof: prof, kind: e.kind, corners: e.corners, ruffle: e.ruffle,
          radMax: Math.max(prevR, e.radiusMax || e.radius),
          sig: (prof && prof.sig ? prof.sig : 0)
        });
        prevR = e.radius;
        prevProf = e.prof;
      }
    }
    cls.bands = bands;
    return cls;
  }

  /* ----------------------------------------------------------------- 9. fit */

  /**
   * Fit scale for a piece, with the two clamps that keep a long thin tail and
   * a very wide sheet from collapsing to a hairline.
   *
   * @param {{rad:number, ymin:number, ymax:number, halfW:number, halfH:number,
   *          cp:number, sp:number, curY:number|null, mode:string}} spec
   * @returns {{scale:number, base:number, clamp:string, cy:number,
   *            radFrac:number, heightFrac:number}}
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
    /* (b) a 400-stitch row: fitting the width makes the fabric a hairline, so
       clamp the scale and let the sheet overflow sideways, current row centred.
       The pitch-swing term is dropped here — overflow is the point.
       Rows only: a flat disc, a doily or a granny square is genuinely wide and
       flat, and cropping one to fill the height would be a bug, not a fix. */
    var needH = s.mode === 'rows'
      ? FIT_MIN_HEIGHT_FRAC * halfH / Math.max(hy * cp, 1e-4)
      : 0;
    if (needH > scale) {
      scale = Math.min(needH, base * FIT_MAX_OVERSCALE_ROWS);
      kind = 'height';
      if (isNum(s.curY)) cy = s.curY;
    }
    return {
      scale: scale, base: base, clamp: kind, cy: cy,
      radFrac: scale * rad / halfW,
      heightFrac: hy > 0 ? scale * hy * cp / halfH : 0
    };
  }

  /* --------------------------------------------------------------- exports */

  global.DiagramGeo = {
    version: '1.0.0',

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
      unstuffed: SLACK_UNSTUFFED, open: SLACK_OPEN
    },
    RUFFLE_EPS: RUFFLE_EPS,
    RUFFLE_RISE: RUFFLE_RISE,
    FIT: {
      minRadiusFrac: FIT_MIN_RADIUS_FRAC, maxOverscale: FIT_MAX_OVERSCALE,
      minHeightFrac: FIT_MIN_HEIGHT_FRAC, maxOverscaleRows: FIT_MAX_OVERSCALE_ROWS
    },

    // stitch metrics
    stitchH: stitchH,
    stitchW: stitchW,
    roundMetrics: roundMetrics,
    flatRate: flatRate,

    // structure
    sites: sites,
    shapeOf: shapeOf,
    polygonFit: polygonFit,
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
