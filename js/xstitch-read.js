'use strict';
/* =====================================================================
 * xstitch-read.js — window.XSRead
 *
 * Read a cross-stitch chart back out of a PICTURE of a chart (a
 * screenshot, an image file, a rendered PDF page): one square per stitch.
 * Classic image arithmetic only — no inference, no network, no model
 * weights, no dependency. Contract: docs/wave-j/CONTRACT.md §1 and §3.
 *
 * This is not the photo converter (js/xstitch-photo.js), which invents a
 * chart from any photo. This recovers the chart that is already drawn.
 *
 * Pipeline (all of it in XSReadCore, which runs in a Web Worker)
 *   locate    page ground = mode of the outer ring; mask of "not ground";
 *             closing + connected components on a coarse grid; the
 *             largest component's box, edges refined at full resolution
 *             (or the crop / lattice the caller gave)
 *   lattice   per axis: gradient-energy profile -> autocorrelation for the
 *             period, DFT magnitude for a sub-pixel pitch; then a comb fit
 *             (pitch +-1.2 %, origin +-1/4 pitch, the count of squares
 *             fixed) on the thresholded edge profile. With a declared size
 *             the pitch starts from the box; without one from the period.
 *   sample    every square's inner window (a quarter pitch in from each
 *             side), dominant colour = the densest Lab mode among its
 *             pixels (grid lines, symbol ink and anti-aliasing do not move
 *             it); coherence = the share of pixels in that mode
 *   cluster   Lab histogram -> leader clusters -> Ward agglomeration (to
 *             the key's colour count + fabric when there is a key, by a
 *             distance rule when there is not) -> blend clean-up -> a few
 *             Lloyd passes over every square
 *   match     fabric (the ground cluster: border share, or the key's
 *             unstitched count), then a one-to-one Hungarian assignment of
 *             classes to key entries, count agreement weighted heavily and
 *             CIEDE2000 lightly. When the key prints counts, candidate
 *             lattices (detected / declared, small origin shifts) are each
 *             read honestly and the one whose read agrees best wins.
 *   symbols   (mode 'symbol', or auto on a black-and-white chart) each
 *             square binarised and reduced to a 10 x 10 coverage
 *             descriptor, clustered by shape, classes matched to key
 *             entries by stitch count only; the rest stay unmatched with
 *             their glyph so the app can ask
 *   assemble  [main thread] palette (key entries, or nearest DMC), symbols,
 *             XStitch.normalize, the Check (§3), a flat preview
 *
 * Threading, cancel tokens and the main-thread fallback follow
 * xstitch-photo.js exactly: the worker source is String(XSReadCore) +
 * String(xsrWorkerBody) in a Blob URL; one worker, jobs queued; cancel()
 * terminates a running worker job outright; without Workers the same core
 * runs one step per setTimeout tick.
 *
 * NOTE: the worker source is produced with Function.prototype.toString.
 * If this file is ever minified, keep XSReadCore and xsrWorkerBody out of
 * the mangling (they reference nothing outside themselves on purpose).
 *
 * Nothing here throws across the promise boundary: failure resolves
 * { ok:false, reason, message } with a message the app can show as is.
 * ===================================================================== */
(function () {

  var W = typeof window !== 'undefined' ? window : self;
  var VERSION = '1.0.0';

  /* largest picture handed to the core; bigger sources are drawn down */
  var MAX_PIXELS = 16000000;

  /* ================================================================== *
   * 1. The core — pure numerics, stringified into the Worker
   * ================================================================== */

  function XSReadCore() {
    'use strict';

    var now = (typeof performance !== 'undefined' && performance && performance.now)
      ? function () { return performance.now(); }
      : function () { return Date.now(); };

    /* ---- colour maths ------------------------------------------------ */

    var LIN = new Float32Array(256);
    (function () {
      for (var i = 0; i < 256; i++) {
        var c = i / 255;
        LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      }
    })();
    var XN = 0.95047, ZN = 1.08883;
    var LEPS = 216 / 24389, LKAP = 24389 / 27;
    var cbrt = Math.cbrt || function (v) { return Math.pow(v, 1 / 3); };
    function labF(t) { return t > LEPS ? cbrt(t) : (LKAP * t + 16) / 116; }

    /* sRGB bytes -> Lab into out[o..o+2] */
    function labOf(r, g, b, out, o) {
      var R = LIN[r], G = LIN[g], B = LIN[b];
      var X = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B;
      var Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
      var Z = 0.0193339 * R + 0.1191920 * G + 0.9503041 * B;
      var fx = labF(X / XN), fy = labF(Y), fz = labF(Z / ZN);
      out[o] = 116 * fy - 16;
      out[o + 1] = 500 * (fx - fy);
      out[o + 2] = 200 * (fy - fz);
    }

    /* Lab -> sRGB bytes (for class hex values) */
    function labToRgb(L, a, b) {
      var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
      function inv(f) { var f3 = f * f * f; return f3 > LEPS ? f3 : (116 * f - 16) / LKAP; }
      var X = inv(fx) * XN, Y = inv(fy), Z = inv(fz) * ZN;
      var R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
      var G = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
      var B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
      function gam(c) {
        c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
        c = Math.round(c * 255);
        return c < 0 ? 0 : (c > 255 ? 255 : c);
      }
      return [gam(R), gam(G), gam(B)];
    }

    var DEG = Math.PI / 180;
    var POW25_7 = 6103515625;
    function hueDeg(b, ap) {
      if (ap === 0 && b === 0) return 0;
      var h = Math.atan2(b, ap) / DEG;
      return h < 0 ? h + 360 : h;
    }
    /* CIEDE2000, kL = kC = kH = 1 */
    function de2000(L1, a1, b1, L2, a2, b2) {
      var C1 = Math.sqrt(a1 * a1 + b1 * b1), C2 = Math.sqrt(a2 * a2 + b2 * b2);
      var Cbar7 = Math.pow((C1 + C2) / 2, 7);
      var G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + POW25_7)));
      var ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
      var Cp1 = Math.sqrt(ap1 * ap1 + b1 * b1), Cp2 = Math.sqrt(ap2 * ap2 + b2 * b2);
      var hp1 = hueDeg(b1, ap1), hp2 = hueDeg(b2, ap2);
      var dLp = L2 - L1, dCp = Cp2 - Cp1, dhp;
      if (Cp1 * Cp2 === 0) dhp = 0;
      else {
        dhp = hp2 - hp1;
        if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
      }
      var dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dhp * DEG / 2);
      var Lbp = (L1 + L2) / 2, Cbp = (Cp1 + Cp2) / 2, hbp;
      if (Cp1 * Cp2 === 0) hbp = hp1 + hp2;
      else if (Math.abs(hp1 - hp2) <= 180) hbp = (hp1 + hp2) / 2;
      else hbp = (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2;
      var T = 1 - 0.17 * Math.cos((hbp - 30) * DEG) + 0.24 * Math.cos(2 * hbp * DEG) +
        0.32 * Math.cos((3 * hbp + 6) * DEG) - 0.20 * Math.cos((4 * hbp - 63) * DEG);
      var dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
      var Cbp7 = Math.pow(Cbp, 7);
      var Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + POW25_7));
      var L50 = (Lbp - 50) * (Lbp - 50);
      var Sl = 1 + 0.015 * L50 / Math.sqrt(20 + L50);
      var Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
      var Rt = -Math.sin(2 * dTheta * DEG) * Rc;
      var tl = dLp / Sl, tc = dCp / Sc, th = dHp / Sh;
      return Math.sqrt(tl * tl + tc * tc + th * th + Rt * tc * th);
    }

    function d76(lab, i, cent, j) {
      var dL = lab[i] - cent[j], da = lab[i + 1] - cent[j + 1], db = lab[i + 2] - cent[j + 2];
      return Math.sqrt(dL * dL + da * da + db * db);
    }

    /* ---- small helpers ------------------------------------------------ */

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    function medianOf(arr, n) {
      var a = Array.prototype.slice.call(arr, 0, n);
      a.sort(function (x, y) { return x - y; });
      return a.length ? a[a.length >> 1] : 0;
    }

    /* ================================================================ *
     * Locate the chart rectangle
     * ================================================================ */

    function groundOf(d, w, h) {
      /* a wide ring: a phone screenshot often has a thin frame or a status
         bar at the very edge, and the page itself is what we want */
      var ring = Math.max(2, Math.round(Math.min(w, h) * 0.05));
      var hist = new Int32Array(4096);
      var sr = new Float64Array(4096), sg = new Float64Array(4096), sb = new Float64Array(4096);
      function add(x, y) {
        var o = (y * w + x) * 4;
        var k = ((d[o] >> 4) << 8) | ((d[o + 1] >> 4) << 4) | (d[o + 2] >> 4);
        hist[k]++; sr[k] += d[o]; sg[k] += d[o + 1]; sb[k] += d[o + 2];
      }
      var x, y;
      for (y = 0; y < h; y++) {
        if (y < ring || y >= h - ring) { for (x = 0; x < w; x++) add(x, y); }
        else { for (x = 0; x < ring; x++) { add(x, y); add(w - 1 - x, y); } }
      }
      var best = 0;
      for (var k = 1; k < 4096; k++) if (hist[k] > hist[best]) best = k;
      var n = hist[best] || 1;
      var total = 0;
      for (k = 0; k < 4096; k++) total += hist[k];
      return { r: sr[best] / n, g: sg[best] / n, b: sb[best] / n, share: hist[best] / Math.max(1, total) };
    }

    /**
     * locate(d, w, h, ground, sizeHint) -> { x, y, w, h, conf } | null
     * Coarse mask of "not page ground", closed, labelled; the biggest
     * component's box (plus whatever touches it), each edge then pulled in
     * past sparse furniture (ruler digits) and refined to a sub-pixel edge.
     */
    function locate(d, w, h, ground, sizeHint) {
      var b = Math.max(1, Math.ceil(Math.max(w, h) / 450));
      var bw = Math.ceil(w / b), bh = Math.ceil(h / b);
      var cnt = new Uint16Array(bw * bh);
      var gr = ground.r, gg = ground.g, gb = ground.b;
      var x, y, i, o;
      var st = b >= 2 ? 2 : 1;   /* a big picture is looked at every other pixel */
      var colBlk = new Int32Array(w);
      for (x = 0; x < w; x++) colBlk[x] = (x / b) | 0;
      var R0 = gr | 0, G0 = gg | 0, B0 = gb | 0;
      for (y = 0; y < h; y += st) {
        var row = ((y / b) | 0) * bw;
        o = y * w * 4;
        for (x = 0; x < w; x += st, o += 4 * st) {
          var e1 = d[o] - R0, e2 = d[o + 1] - G0, e3 = d[o + 2] - B0;
          if ((e1 < 0 ? -e1 : e1) + (e2 < 0 ? -e2 : e2) + (e3 < 0 ? -e3 : e3) > 30) cnt[row + colBlk[x]]++;
        }
      }
      var need = Math.max(1, Math.round(b * b / (4 * st * st)));
      var m = new Uint8Array(bw * bh);
      for (i = 0; i < m.length; i++) m[i] = cnt[i] >= need ? 1 : 0;

      /* closing, radius 2 blocks (separable max then min) */
      function morph(src, dilate, r) {
        var tmp = new Uint8Array(src.length), dst = new Uint8Array(src.length), xx, yy, k, v;
        for (yy = 0; yy < bh; yy++) {
          for (xx = 0; xx < bw; xx++) {
            v = dilate ? 0 : 1;
            for (k = -r; k <= r; k++) {
              var X = xx + k;
              var s = (X < 0 || X >= bw) ? (dilate ? 0 : 1) : src[yy * bw + X];
              if (dilate) { if (s) { v = 1; break; } } else if (!s) { v = 0; break; }
            }
            tmp[yy * bw + xx] = v;
          }
        }
        for (yy = 0; yy < bh; yy++) {
          for (xx = 0; xx < bw; xx++) {
            v = dilate ? 0 : 1;
            for (k = -r; k <= r; k++) {
              var Y = yy + k;
              var s2 = (Y < 0 || Y >= bh) ? (dilate ? 0 : 1) : tmp[Y * bw + xx];
              if (dilate) { if (s2) { v = 1; break; } } else if (!s2) { v = 0; break; }
            }
            dst[yy * bw + xx] = v;
          }
        }
        return dst;
      }
      var mc = morph(morph(m, true, 2), false, 2);

      /* components */
      var lab = new Int32Array(bw * bh);
      var comps = [];
      var stack = new Int32Array(bw * bh);
      for (i = 0; i < mc.length; i++) {
        if (!mc[i] || lab[i]) continue;
        var id = comps.length + 1;
        var c = { n: 0, x0: bw, y0: bh, x1: -1, y1: -1 };
        var sp = 0;
        stack[sp++] = i; lab[i] = id;
        while (sp) {
          var p = stack[--sp];
          var px = p % bw, py = (p / bw) | 0;
          c.n++;
          if (px < c.x0) c.x0 = px; if (px > c.x1) c.x1 = px;
          if (py < c.y0) c.y0 = py; if (py > c.y1) c.y1 = py;
          if (px > 0 && mc[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
          if (px < bw - 1 && mc[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
          if (py > 0 && mc[p - bw] && !lab[p - bw]) { lab[p - bw] = id; stack[sp++] = p - bw; }
          if (py < bh - 1 && mc[p + bw] && !lab[p + bw]) { lab[p + bw] = id; stack[sp++] = p + bw; }
        }
        comps.push(c);
      }
      if (!comps.length) return null;
      comps.sort(function (a, b2) { return b2.n - a.n; });
      var core = comps[0];
      var box = { x0: core.x0, y0: core.y0, x1: core.x1, y1: core.y1 };
      /* pull in pieces of the same chart separated by a gap (a white-fabric
         chart with no grid lines is many islands) */
      var marg = Math.max(3, Math.round(Math.max(bw, bh) * 0.01));
      var grown = true, used = [true];
      for (i = 1; i < comps.length; i++) used.push(false);
      while (grown) {
        grown = false;
        for (i = 1; i < comps.length; i++) {
          if (used[i]) continue;
          var q = comps[i];
          if (q.x1 < box.x0 - marg || q.x0 > box.x1 + marg || q.y1 < box.y0 - marg || q.y0 > box.y1 + marg) continue;
          /* a long thin thing outside the box (a rule line) never joins */
          var inside = q.x0 >= box.x0 && q.x1 <= box.x1 && q.y0 >= box.y0 && q.y1 <= box.y1;
          if (!inside && (q.y1 - q.y0 <= 2 || q.x1 - q.x0 <= 2)) continue;
          if (!inside && q.n < core.n * 0.002) continue;
          /* a frame drawn round the whole page (or the page itself) encloses
             the chart: it is not part of it */
          var qa = (q.x1 - q.x0 + 1) * (q.y1 - q.y0 + 1);
          if (!inside && (qa > (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1) * 0.8 || q.n < qa * 0.08)) continue;
          used[i] = true; grown = true;
          if (q.x0 < box.x0) box.x0 = q.x0; if (q.x1 > box.x1) box.x1 = q.x1;
          if (q.y0 < box.y0) box.y0 = q.y0; if (q.y1 > box.y1) box.y1 = q.y1;
        }
      }
      var fx0 = box.x0 * b, fy0 = box.y0 * b;
      var fx1 = Math.min(w, (box.x1 + 1) * b), fy1 = Math.min(h, (box.y1 + 1) * b);
      if (fx1 - fx0 < 8 || fy1 - fy0 < 8) return null;

      /* per column / row: share of "on" pixels inside the box */
      function onFrac(axis, pos, a0, a1) {
        var on = 0, tot = 0, t;
        for (t = a0; t < a1; t++) {
          var oo = axis === 'x' ? (t * w + pos) * 4 : (pos * w + t) * 4;
          var df2 = Math.abs(d[oo] - gr) + Math.abs(d[oo + 1] - gg) + Math.abs(d[oo + 2] - gb);
          if (df2 > 30) on++;
          tot++;
        }
        return tot ? on / tot : 0;
      }
      /* is the chart a filled block (fabric drawn as a colour), or lines and
         marks on the page ground? Only a filled block has edges that can
         be pulled in past rulers and rules; the other kind is left to the
         grid lines */
      var fills = [];
      for (var fc = 0; fc < 21; fc++) {
        var fxp = Math.floor(fx0 + (fx1 - fx0) * (0.25 + 0.5 * fc / 20));
        fills.push(onFrac('x', fxp, Math.floor(fy0 + (fy1 - fy0) * 0.25), Math.floor(fy0 + (fy1 - fy0) * 0.75)));
      }
      fills.sort(function (a, b) { return a - b; });
      var filled = fills[10] >= 0.8;
      function edgeOf(axis, lo, hi, a0, a1, fromLow) {
        /* trim sparse columns from the outside in (never past 15 %) */
        var len = hi - lo, k, fr = [], mx = 0;
        var aa = a0 + Math.round((a1 - a0) * 0.1), ab = a1 - Math.round((a1 - a0) * 0.1);
        var span = Math.max(4, Math.round(len * 0.15));
        for (k = 0; k < span; k++) {
          var pos = fromLow ? lo + k : hi - 1 - k;
          var f = onFrac(axis, pos, aa, ab);
          fr.push(f);
          if (f > mx) mx = f;
        }
        var thr = Math.max(0.2, mx * 0.5);
        /* the edge is a strong line with chart behind it, not a lone rule
           line (a title underline, a caption rule) with page behind it */
        for (k = 0; k < fr.length; k++) {
          if (fr[k] < thr) continue;
          var solid = true;
          for (var q2 = 1; q2 <= 8 && k + q2 < fr.length; q2++) if (fr[k + q2] < 0.3) { solid = false; break; }
          if (solid) break;
        }
        if (k >= fr.length || !filled) k = 0; else solidEdges++;
        /* sub-pixel: linear crossing of the half level between k-1 and k */
        var prev = k > 0 ? fr[k - 1] : 0, cur = fr[k];
        var t2 = cur > prev ? clamp((thr - prev) / (cur - prev), 0, 1) : 0.5;
        var off = k - 1 + t2 + 0.5;
        return fromLow ? lo + off : hi - off;
      }
      var solidEdges = 0;
      var ex0 = edgeOf('x', fx0, fx1, fy0, fy1, true);
      var ex1 = edgeOf('x', fx0, fx1, fy0, fy1, false);
      var ey0 = edgeOf('y', fy0, fy1, fx0, fx1, true);
      var ey1 = edgeOf('y', fy0, fy1, fx0, fx1, false);
      if (!(ex1 - ex0 > 8 && ey1 - ey0 > 8)) { ex0 = fx0; ex1 = fx1; ey0 = fy0; ey1 = fy1; }
      return {
        x: ex0, y: ey0, w: ex1 - ex0, h: ey1 - ey0,
        fill: core.n / Math.max(1, (core.x1 - core.x0 + 1) * (core.y1 - core.y0 + 1)),
        share: ((ex1 - ex0) * (ey1 - ey0)) / (w * h),
        /* all four edges are solid steps from page to chart: sub-pixel exact */
        solid: solidEdges === 4
      };
    }

    /* ================================================================ *
     * The lattice, one axis at a time
     * ================================================================ */

    /**
     * Edge-energy profile along one axis over the rectangle (padded).
     * G[i] is the colour change across the pixel EDGE at coordinate
     * origin + i (between pixels origin+i-1 and origin+i).
     * raw: plain sum; thr: only what clears the texture noise floor.
     */
    function axisProfile(d, w, h, rect, axis) {
      var pad = 3;
      var lo = Math.max(1, Math.floor(axis === 'x' ? rect.x : rect.y) - pad);
      var hi = Math.min(axis === 'x' ? w - 1 : h - 1, Math.ceil(axis === 'x' ? rect.x + rect.w : rect.y + rect.h) + pad);
      var plo = Math.max(0, Math.floor(axis === 'x' ? rect.y : rect.x));
      var phi = Math.min(axis === 'x' ? h : w, Math.ceil(axis === 'x' ? rect.y + rect.h : rect.x + rect.w));
      var L = hi - lo + 1;
      var raw = new Float32Array(L), thr = new Float32Array(L), freq = new Float32Array(L), rows = 0;
      var stepP = Math.max(1, Math.floor((phi - plo) / 600));
      /* noise floor from a sample */
      var samp = [], s, t, i, o, o2, df;
      for (s = 0; s < 4000; s++) {
        t = plo + ((s * 7919) % Math.max(1, phi - plo));
        i = lo + 1 + ((s * 104729) % Math.max(1, L - 1));
        if (axis === 'x') { o = (t * w + i) * 4; o2 = o - 4; } else { o = (i * w + t) * 4; o2 = o - w * 4; }
        samp.push(Math.abs(d[o] - d[o2]) + Math.abs(d[o + 1] - d[o2 + 1]) + Math.abs(d[o + 2] - d[o2 + 2]));
      }
      samp.sort(function (a, b) { return a - b; });
      var floor = samp[Math.floor(samp.length * 0.6)] * 2 + 6;
      var stride = axis === 'x' ? 4 : w * 4;
      /* edge frequency: in how many lines across the chart this edge shows.
         A grid line shows in nearly all of them, a symbol stroke in some */
      var fFloor = Math.max(14, samp[samp.length >> 1] * 1.5 + 6);
      for (t = plo; t < phi; t += stepP) {
        rows++;
        var base = axis === 'x' ? (t * w + lo) * 4 : (lo * w + t) * 4;
        for (i = 0; i < L; i++) {
          o = base + i * stride;
          o2 = o - stride;
          df = Math.abs(d[o] - d[o2]) + Math.abs(d[o + 1] - d[o2 + 1]) + Math.abs(d[o + 2] - d[o2 + 2]);
          raw[i] += df;
          if (df > floor) thr[i] += df - floor;
          if (df > fFloor) freq[i]++;
        }
      }
      for (i = 0; i < L; i++) freq[i] /= Math.max(1, rows);
      return { raw: raw, thr: thr, freq: freq, origin: lo, L: L, floor: floor };
    }

    /** Period from the autocorrelation of the raw profile, refined by DFT. */
    function periodOf(prof, maxP, sig) {
      var g = sig || prof.raw, L = prof.L, i, t;
      var mean = 0;
      for (i = 0; i < L; i++) mean += g[i];
      mean /= L;
      /* high-pass: subtract a running mean of width ~ 2 * maxP */
      var hw = Math.max(4, Math.round(maxP));
      var cs = new Float64Array(L + 1);
      for (i = 0; i < L; i++) cs[i + 1] = cs[i] + g[i];
      var x = new Float32Array(L);
      for (i = 0; i < L; i++) {
        var a = Math.max(0, i - hw), b = Math.min(L, i + hw + 1);
        x[i] = g[i] - (cs[b] - cs[a]) / (b - a);
      }
      var tmax = Math.min(Math.floor(maxP) + 2, L - 2);
      var R = new Float32Array(tmax + 2);
      var r0 = 0;
      for (i = 0; i < L; i++) r0 += x[i] * x[i];
      if (!(r0 > 0)) return null;
      for (t = 1; t <= tmax + 1 && t < L; t++) {
        var s = 0;
        for (i = 0; i + t < L; i++) s += x[i] * x[i + t];
        R[t] = s / r0 * L / (L - t);
      }
      var peaks = [], best = 0;
      for (t = 3; t <= tmax; t++) {
        if (R[t] > R[t - 1] && R[t] >= R[t + 1] && R[t] > 0.05) {
          peaks.push(t);
          if (R[t] > best) best = R[t];
        }
      }
      if (!peaks.length) return null;
      var pick = -1;
      for (i = 0; i < peaks.length; i++) {
        if (R[peaks[i]] >= best * 0.3) { pick = peaks[i]; break; }
      }
      if (pick < 0) return null;
      /* the smallest strong period; a multiple of the true pitch is ruled out
         later by looking at the squares themselves (overSegment) */
      /* parabolic sub-sample */
      var y0 = R[pick - 1], y1 = R[pick], y2 = R[pick + 1];
      var den = y0 - 2 * y1 + y2;
      var tau = pick + (den < 0 ? clamp(0.5 * (y0 - y2) / den, -0.5, 0.5) : 0);
      /* DFT magnitude search around tau */
      var bestP = tau, bestM = -1, p, re, im, ang, k;
      function dftMag(pp) {
        var re2 = 0, im2 = 0, w0 = 2 * Math.PI / pp;
        for (var kk = 0; kk < L; kk++) { var an = w0 * kk; re2 += x[kk] * Math.cos(an); im2 += x[kk] * Math.sin(an); }
        return re2 * re2 + im2 * im2;
      }
      /* coarse, then fine around the best */
      for (p = tau * 0.96; p <= tau * 1.04; p += tau * 0.002) { var mg = dftMag(p); if (mg > bestM) { bestM = mg; bestP = p; } }
      var c0 = bestP;
      for (p = c0 - tau * 0.002; p <= c0 + tau * 0.002; p += tau * 0.0002) { var mg2 = dftMag(p); if (mg2 > bestM) { bestM = mg2; bestP = p; } }
      var conf = clamp(R[pick], 0, 1);
      /* how strong the half and double periods are, for the alternatives */
      function rAt(tt) {
        var ti = Math.floor(tt), fr = tt - ti;
        if (ti < 1 || ti + 1 > tmax + 1) return 0;
        return R[ti] * (1 - fr) + R[ti + 1] * fr;
      }
      return { p: bestP, conf: conf, half: rAt(bestP / 2), dbl: rAt(bestP * 2), R: R };
    }

    /** Comb fit: n squares, origin and pitch, on the thresholded profile. */
    function combFit(prof, n, x0g, p0, xRange, pRange, useFreq) {
      var g = useFreq ? prof.freq : prof.thr, L = prof.L, org = prof.origin, i;
      /* [1 2 1] smoothing so sub-pixel teeth still land on energy */
      var s = new Float32Array(L);
      for (i = 0; i < L; i++) s[i] = (g[i] * 2 + (i > 0 ? g[i - 1] : 0) + (i < L - 1 ? g[i + 1] : 0)) / 4;
      function at(xc) {
        var u = xc - org;
        if (u < 0 || u > L - 1) return 0;
        var ui = Math.floor(u), fr = u - ui;
        return ui + 1 < L ? s[ui] * (1 - fr) + s[ui + 1] * fr : s[ui];
      }
      function score(x0, p) {
        var sum = 0;
        for (var k = 0; k <= n; k++) sum += at(x0 + k * p);
        return sum;
      }
      var best = { x0: x0g, p: p0, s: -1 };
      var pStep = Math.max(p0 * 0.0004, 0.0005), xStep = Math.max(0.05, p0 * 0.02);
      var pass, pa, pb, xa, xb, ps, xs;
      for (pass = 0; pass < 2; pass++) {
        if (pass === 0) {
          pa = p0 * (1 - pRange); pb = p0 * (1 + pRange); ps = pStep * 4;
          xa = x0g - xRange; xb = x0g + xRange; xs = xStep * 2;
        } else {
          pa = best.p - pStep * 6; pb = best.p + pStep * 6; ps = pStep;
          xa = best.x0 - xStep * 3; xb = best.x0 + xStep * 3; xs = xStep / 2;
        }
        for (var p = pa; p <= pb + 1e-9; p += ps) {
          for (var x0 = xa; x0 <= xb + 1e-9; x0 += xs) {
            var sc = score(x0, p);
            if (sc > best.s) best = { x0: x0, p: p, s: sc };
          }
        }
      }
      /* contrast: mean tooth energy vs mean profile energy */
      var tot = 0;
      for (i = 0; i < L; i++) tot += s[i];
      var meanE = tot / Math.max(1, L);
      best.contrast = meanE > 0 ? (best.s / (n + 1)) / meanE : 0;
      return best;
    }

    /**
     * lineExtent(prof, p) -> { a, b, n, mean, p } | null
     * On a chart with grid lines: the run of lattice lines (edge frequency
     * high at every tooth) along this axis. Its ends are the chart's own
     * edges, which is what tells a grid from a ruler band glued to it.
     */
    function lineExtent(prof, p) {
      var f = prof.freq, L = prof.L, org = prof.origin, i;
      if (!(p >= 2.5) || L < p * 4) return null;
      var s = new Float32Array(L);
      /* a bold 10-line is wide: its edges sit up to ~7 % of a square either
         side of the boundary, so a tooth looks that far */
      var rr = Math.max(1, Math.round(p * 0.08));
      for (i = 0; i < L; i++) {
        var mxv = 0;
        for (var q = -rr; q <= rr; q++) {
          var ii = i + q;
          if (ii < 0 || ii >= L) continue;
          var fv = f[ii] * (q === 0 ? 1 : (Math.abs(q) === 1 ? 0.9 : 0.8));
          if (fv > mxv) mxv = fv;
        }
        s[i] = mxv;
      }
      function at(xc) {
        var u = xc - org;
        if (u < 0 || u > L - 1) return 0;
        var ui = Math.floor(u), fr = u - ui;
        return ui + 1 < L ? s[ui] * (1 - fr) + s[ui + 1] * fr : s[ui];
      }
      var best = null, pp, x0, k, sc;
      var xs = Math.max(0.1, p / 60), ps = p * 0.0008;
      for (pp = p * 0.985; pp <= p * 1.015; pp += ps) {
        var nT = Math.floor((L - 1) / pp);
        for (x0 = org; x0 < org + pp; x0 += xs) {
          sc = 0;
          for (k = 0; k <= nT; k++) sc += at(x0 + k * pp);
          if (!best || sc > best.s) best = { s: sc, x0: x0, p: pp, nT: nT };
        }
      }
      if (!best) return null;
      var v = [];
      for (k = 0; k <= best.nT; k++) v.push(at(best.x0 + k * best.p));
      /* the longest run of strong teeth, one weak tooth allowed inside */
      var bs = -1, be = -1, cs = -1, weak = 0, lastStrong = -1;
      for (k = 0; k < v.length; k++) {
        if (v[k] >= 0.45) {
          if (cs < 0) { cs = k; weak = 0; }
          lastStrong = k;
          if (lastStrong - cs > be - bs) { bs = cs; be = lastStrong; }
        } else if (cs >= 0) {
          weak++;
          if (weak > 1 || k - lastStrong > 1) { cs = -1; weak = 0; }
        }
      }
      if (bs < 0 || be - bs < 3) return null;
      var sum = 0;
      for (k = bs; k <= be; k++) sum += v[k];
      return { a: best.x0 + bs * best.p, b: best.x0 + be * best.p, n: be - bs, mean: sum / (be - bs + 1), p: best.p, v: v.slice(bs, be + 1) };
    }

    /**
     * fitRun(ex, n): a run of lines a little longer than the declared count
     * (a ruler tick or a frame line that happens to sit one pitch out):
     * keep the n squares whose lines are strongest.
     */
    function fitRun(ex, n) {
      if (!ex || !ex.v || ex.n <= n || ex.n > n + 3) return ex;
      var best = -1, bs = 0;
      for (var s = 0; s + n <= ex.n; s++) {
        var sum = 0;
        for (var k = s; k <= s + n; k++) sum += ex.v[k];
        if (sum > best) { best = sum; bs = s; }
      }
      return { a: ex.a + bs * ex.p, b: ex.a + (bs + n) * ex.p, n: n, mean: best / (n + 1), p: ex.p, v: ex.v.slice(bs, bs + n + 1) };
    }

    /**
     * crossTrim(d, w, h, exA, exB, axis): a grid column is crossed by the
     * other axis's lines; a ruler band glued to the grid is not. Drops end
     * intervals of exA (along `axis`) that exB's lines do not cross.
     */
    function crossTrim(d, w, h, exA, exB, axis) {
      if (!exA || !exB) return exA;
      var frac = [], k, j;
      for (k = 0; k < exA.n; k++) {
        var mid = Math.round(exA.a + (k + 0.5) * exA.p - 0.5), hits = 0, tot = 0;
        for (j = 0; j <= exB.n; j += Math.max(1, Math.floor(exB.n / 60))) {
          var t = Math.round(exB.a + j * exB.p), best = 0;
          for (var u = t - 1; u <= t + 1; u++) {
            var x1, y1, x2, y2;
            if (axis === 'x') { x1 = x2 = mid; y1 = u; y2 = u - 1; } else { y1 = y2 = mid; x1 = u; x2 = u - 1; }
            if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0 || x1 >= w || x2 >= w || y1 >= h || y2 >= h) continue;
            var o1 = (y1 * w + x1) * 4, o2 = (y2 * w + x2) * 4;
            var df = Math.abs(d[o1] - d[o2]) + Math.abs(d[o1 + 1] - d[o2 + 1]) + Math.abs(d[o1 + 2] - d[o2 + 2]);
            if (df > best) best = df;
          }
          tot++;
          if (best > 30) hits++;
        }
        frac.push(tot ? hits / tot : 0);
      }
      var s = 0, e = exA.n - 1;
      while (s < e - 3 && frac[s] < 0.5) s++;
      while (e > s + 3 && frac[e] < 0.5) e--;
      if (s === 0 && e === exA.n - 1) return exA;
      return { a: exA.a + s * exA.p, b: exA.a + (e + 1) * exA.p, n: e - s + 1, mean: exA.mean, p: exA.p, trimmed: true };
    }

    /** mean colour difference between the chart and itself shifted by q px */
    function shiftDiff(d, w, h, rect, axis, q) {
      /* sub-pixel shift (linear interpolation): a pitch of 14.74 px must
         not be judged by a 15 px shift */
      var qi = Math.floor(q), f = q - qi;
      var x0 = Math.max(0, Math.ceil(rect.x)), x1 = Math.min(w, Math.floor(rect.x + rect.w));
      var y0 = Math.max(0, Math.ceil(rect.y)), y1 = Math.min(h, Math.floor(rect.y + rect.h));
      if (axis === 'x') x1 -= qi + 1; else y1 -= qi + 1;
      if (x1 <= x0 || y1 <= y0) return Infinity;
      var sy = Math.max(1, Math.floor((y1 - y0) / 300)), sx = Math.max(1, Math.floor((x1 - x0) / 600));
      var step = axis === 'x' ? 4 : w * 4;
      var off = qi * step, sum = 0, cnt = 0, g = 1 - f;
      for (var y = y0; y < y1; y += sy) {
        for (var x = x0; x < x1; x += sx) {
          var o = (y * w + x) * 4, o2 = o + off, o3 = o2 + step;
          sum += Math.abs(d[o] - (g * d[o2] + f * d[o3])) + Math.abs(d[o + 1] - (g * d[o2 + 1] + f * d[o3 + 1])) +
            Math.abs(d[o + 2] - (g * d[o2 + 2] + f * d[o3 + 2]));
          cnt++;
        }
      }
      return cnt ? sum / cnt : Infinity;
    }

    function wholeSquare(d, w, h, rect, axis, p) {
      var len = axis === 'x' ? rect.w : rect.h;
      var d1 = shiftDiff(d, w, h, rect, axis, p), ds = [d1, d1], m;
      for (m = 2; m <= 6; m++) {
        if (p * m > Math.min(80, len / 4)) break;
        ds.push(shiftDiff(d, w, h, rect, axis, p * m));
      }
      var top = ds.length - 1, mb = 0, dmin = Infinity;
      for (m = 2; m <= top; m++) if (ds[m] < dmin) { dmin = ds[m]; mb = m; }
      if (!mb || dmin >= d1 * 0.97) return p;
      /* a real dip, not a drift: clearly under the shifts either side of it
         (on a busy chart every shift differs a lot, so this is relative) */
      var left = ds[mb - 1], right = mb < top ? ds[mb + 1] : Infinity;
      if (dmin > 0.9 * Math.min(left, right) && dmin >= d1 * 0.75) return p;
      /* the smallest multiple that lands about as well (a pitch lands its
         own double just as well) */
      for (m = 2; m <= mb; m++) if (ds[m] <= dmin * 1.1 && mb % m === 0) return p * m;
      return p * mb;
    }

    /**
     * overSegment(d, w, h, lat, nx, ny) -> { x: { m, start }, y: { m, start } }
     * Read at a fraction of the true pitch, every true square becomes m
     * identical ones: the colour then only ever changes across one in m of
     * the column gaps. At the true pitch, changes fall on every gap.
     */
    function overSegment(d, w, h, lat, nx, ny) {
      var rs = Math.max(1, Math.floor(ny / 30)), cs = Math.max(1, Math.floor(nx / 30));
      var smp = sampleCells(d, w, h, lat, nx, ny, null, rs, cs), L = smp.lab;
      function test(axis) {
        var len = axis === 'x' ? nx : ny, other = axis === 'x' ? ny : nx;
        var res = { m: 1, start: 0 };
        if (len < 6) return res;
        var ch = new Float64Array(len - 1), c, t;
        for (c = 0; c < len - 1; c++) {
          for (t = 0; t < other; t += (axis === 'x' ? rs : cs)) {
            var i1 = axis === 'x' ? t * nx + c : c * nx + t;
            var i2 = axis === 'x' ? i1 + 1 : i1 + nx;
            var dL = L[i1 * 3] - L[i2 * 3], da = L[i1 * 3 + 1] - L[i2 * 3 + 1], db = L[i1 * 3 + 2] - L[i2 * 3 + 2];
            if (dL * dL + da * da + db * db > 100) ch[c]++;
          }
        }
        for (var m = 3; m >= 2; m--) {
          if (len < m * 3) continue;
          var sums = [], tot = 0, r;
          for (r = 0; r < m; r++) sums.push(0);
          for (c = 0; c < len - 1; c++) { sums[c % m] += ch[c]; tot += ch[c]; }
          var br = 0;
          for (r = 1; r < m; r++) if (sums[r] > sums[br]) br = r;
          /* a symbol stroke across the middle of a square still changes the
             colour now and then inside it: allow a fifth */
          if (sums[br] >= 12 && tot - sums[br] <= sums[br] * 0.2 * (m - 1)) {
            /* gaps c = br (mod m) are the true boundaries: squares start after them */
            res.m = m; res.start = (br + 1) % m;
            return res;
          }
        }
        return res;
      }
      return { x: test('x'), y: test('y'), smp: smp };
    }

    /**
     * Two fits per axis: one on edge energy (colour changes between
     * squares; the only signal on a stitched render), one on edge frequency
     * (grid lines run through every line of the chart; symbol strokes do
     * not). When the grid lines are there, they are the truth.
     */
    /**
     * refineByEdges: measure where the colour actually changes between
     * two neighbouring squares of different colours, on lines a seventh of
     * a square in from their top and bottom (clear of a centred symbol),
     * and move the lattice there. Medians near each end of the chart give
     * the origin and the pitch.
     */
    function refineByEdges(d, w, h, lat0, gw, gh, doX, doY, lim, smp0) {
      if (gw * gh > 250000) return lat0;
      var smp = smp0 || sampleCells(d, w, h, lat0, gw, gh, null), L = smp.lab, lat = lat0;
      var px = new Float32Array(3);
      function median(a) {
        if (!a.length) return null;
        a.sort(function (x, y) { return x - y; });
        return a[a.length >> 1];
      }
      function measure(axis) {
        var n = axis === 'x' ? gw : gh, third = Math.max(1, Math.floor(n / 3));
        var p = axis === 'x' ? lat.pitchX : lat.pitchY, q = axis === 'x' ? lat.pitchY : lat.pitchX;
        var o0 = axis === 'x' ? lat.x0 : lat.y0, q0 = axis === 'x' ? lat.y0 : lat.x0;
        var first = [], last = [], all = [];
        var budget = 6000;
        for (var a = 0; a < n - 1 && budget > 0; a++) {
          for (var b = 0; b < (axis === 'x' ? gh : gw) && budget > 0; b++) {
            var i1 = axis === 'x' ? b * gw + a : a * gw + b, i2 = axis === 'x' ? i1 + 1 : i1 + gw;
            var AL = L[i1 * 3], Aa = L[i1 * 3 + 1], Ab = L[i1 * 3 + 2];
            var BL = L[i2 * 3] - AL, Ba = L[i2 * 3 + 1] - Aa, Bb = L[i2 * 3 + 2] - Ab;
            var nn = BL * BL + Ba * Ba + Bb * Bb;
            if (nn < 625) continue;
            var edge = o0 + (a + 1) * p;
            for (var side = 0; side < 2; side++) {
              var line = Math.floor(q0 + (b + (side ? 0.86 : 0.14)) * q);
              var lo = Math.ceil(edge - 0.45 * p - 0.5), hi = Math.floor(edge + 0.45 * p - 0.5);
              var prevT = null, prevC = 0, bestX = null, bestDist = Infinity;
              for (var t = lo; t <= hi; t++) {
                var X = axis === 'x' ? t : line, Y = axis === 'x' ? line : t;
                if (X < 0 || Y < 0 || X >= w || Y >= h) { prevT = null; continue; }
                var o = (Y * w + X) * 4;
                labOf(d[o], d[o + 1], d[o + 2], px, 0);
                var tt = ((px[0] - AL) * BL + (px[1] - Aa) * Ba + (px[2] - Ab) * Bb) / nn;
                /* off the A-B line (a symbol stroke, a hole): not evidence */
                var eL = px[0] - AL - tt * BL, ea = px[1] - Aa - tt * Ba, eb = px[2] - Ab - tt * Bb;
                if (eL * eL + ea * ea + eb * eb > nn * 0.12) { prevT = null; continue; }
                var c = t + 0.5;
                if (prevT !== null && prevT < 0.5 && tt >= 0.5) {
                  var cross = prevC + (0.5 - prevT) / (tt - prevT) * (c - prevC);
                  if (Math.abs(cross - edge) < bestDist) { bestDist = Math.abs(cross - edge); bestX = cross; }
                }
                prevT = tt; prevC = c;
              }
              budget--;
              if (bestX === null) continue;
              var off = bestX - edge;
              all.push(off);
              if (a < third) first.push(off); else if (a >= n - 1 - third) last.push(off);
            }
          }
        }
        if (all.length < 8) return null;
        var mAll = median(all.slice());
        var m1 = first.length >= 8 ? median(first) : null, m2 = last.length >= 8 ? median(last) : null;
        if (m1 === null || m2 === null) return { x0: o0 + mAll, p: p };
        /* band centres, in boundaries counted from the origin */
        var c1 = third / 2 + 1, c2 = n - 1 - third / 2;
        var dp = (m2 - m1) / Math.max(1, c2 - c1);
        return { x0: o0 + m1 - dp * c1, p: p + dp };
      }
      /* twice: the second pass measures from where the first put it */
      for (var pass = 0; pass < 2; pass++) {
        var out = { x0: lat.x0, y0: lat.y0, pitchX: lat.pitchX, pitchY: lat.pitchY };
        if (doX) { var mx = measure('x'); if (mx && Math.abs(mx.p / lat0.pitchX - 1) < lim) { out.x0 = mx.x0; out.pitchX = mx.p; } }
        if (doY) { var my = measure('y'); if (my && Math.abs(my.p / lat0.pitchY - 1) < lim) { out.y0 = my.x0; out.pitchY = my.p; } }
        lat = out;
      }
      return lat;
    }

    function bestComb(prof, n, x0g, p0, tight) {
      /* a solid chart edge found to a fraction of a pixel pins the comb */
      var fe = tight ? combFit(prof, n, x0g, p0, p0 * 0.1, 0.002, false) : combFit(prof, n, x0g, p0, p0 * 0.3, 0.012, false);
      var ff = combFit(prof, n, x0g, p0, p0 * 0.3, 0.012, true);
      var meanTooth = ff.s / (n + 1);
      if (meanTooth >= 0.5 && ff.contrast >= 1.6) { ff.by = 'lines'; return ff; }
      fe.by = 'edges';
      return fe;
    }

    /**
     * lattice(img, rect, opts) -> { lat, size, sizeSource, conf, alternatives, why }
     */
    function findLattice(d, w, h, rect, size, userLat, quick) {
      if (userLat) {
        var uw = size ? size.w : Math.max(1, Math.round(rect.w / userLat.pitchX));
        var uh = size ? size.h : Math.max(1, Math.round(rect.h / userLat.pitchY));
        return {
          lat: { x0: userLat.x0, y0: userLat.y0, pitchX: userLat.pitchX, pitchY: userLat.pitchY },
          size: { w: uw, h: uh }, sizeSource: 'user', conf: 1, alternatives: [], why: null
        };
      }
      var px = axisProfile(d, w, h, rect, 'x');
      var py = axisProfile(d, w, h, rect, 'y');
      var maxPx = Math.min(80, rect.w / 3), maxPy = Math.min(80, rect.h / 3);
      var perX = periodOf(px, maxPx), perY = periodOf(py, maxPy);
      /* grid lines repeat far more cleanly than what is drawn between them */
      function widen(f) {
        /* a 1 px line is two edges 2 px apart: one bump, not two */
        var o = new Float32Array(f.length);
        for (var u = 0; u < f.length; u++) o[u] = Math.max(f[u], u > 0 ? f[u - 1] : 0, u < f.length - 1 ? f[u + 1] : 0);
        return o;
      }
      var lpX = periodOf(px, maxPx, widen(px.freq)), lpY = periodOf(py, maxPy, widen(py.freq));
      if (lpX && lpX.conf >= 0.5) perX = lpX;
      if (lpY && lpY.conf >= 0.5) perY = lpY;
      /* the picture compared with itself shifted by one pitch: a stitched X
         or a symbol across the middle of every square repeats at half the
         pitch in a profile (grid lines included: a "+" is a line too), but
         only the whole square lands on itself */
      var osDone = false;
      if (!size) {
        if (perX) perX = { p: wholeSquare(d, w, h, rect, 'x', perX.p), conf: perX.conf, half: perX.half, dbl: perX.dbl };
        if (perY) perY = { p: wholeSquare(d, w, h, rect, 'y', perY.p), conf: perY.conf, half: perY.half, dbl: perY.dbl };
        /* and a page that is itself drawn in half squares (each stitch as
           two rectangles, a seam down the middle) looks right even to that
           test: only the colours tell, as they change on whole squares only */
        for (var osi = 0; osi < 2 && perX && perY; osi++) {
          osDone = true;
          var pnx = Math.max(1, Math.round(rect.w / perX.p)), pny = Math.max(1, Math.round(rect.h / perY.p));
          if (pnx * pny <= 400000 && pnx >= 6 && pny >= 6) {
            var pfx = bestComb(px, pnx, rect.x, rect.w / pnx), pfy = bestComb(py, pny, rect.y, rect.h / pny);
            var os0 = overSegment(d, w, h, { x0: pfx.x0, y0: pfy.x0, pitchX: pfx.p, pitchY: pfy.p }, pnx, pny);
            if (os0.x.m > 1) perX = { p: pfx.p * os0.x.m, conf: perX.conf, half: perX.half, dbl: perX.dbl };
            if (os0.y.m > 1) perY = { p: pfy.p * os0.y.m, conf: perY.conf, half: perY.half, dbl: perY.dbl };
            if (os0.x.m === 1 && os0.y.m === 1) break;
          } else break;
        }
      }
      /* grid lines: where they run is where the chart is, which beats the
         box (a grey ruler band glued to the grid is inside the box) */
      var solidRect = !!rect.solid;
      rect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
      function guessP(per, len, n) {
        var pd = n ? len / n : 0;
        if (per && !pd) return per.p;
        /* the declared count says roughly how big a square is; the picture
           says exactly (a profile may have found half or a third of it) */
        if (per) for (var mm0 = 1; mm0 <= 4; mm0++) if (Math.abs(per.p * mm0 / pd - 1) < 0.15) return per.p * mm0;
        return pd || (per ? per.p : 0);
      }
      var exX = lineExtent(px, guessP(perX, rect.w, size ? size.w : 0));
      var exY = lineExtent(py, guessP(perY, rect.h, size ? size.h : 0));
      if (exX && exY && exX.mean >= 0.7 && exY.mean >= 0.7) {
        var tX = crossTrim(d, w, h, exX, exY, 'x'), tY = crossTrim(d, w, h, exY, exX, 'y');
        exX = tX; exY = tY;
      }
      var linesX = !!(exX && exX.mean >= 0.7 && (exX.b - exX.a) >= rect.w * 0.8);
      var linesY = !!(exY && exY.mean >= 0.7 && (exY.b - exY.a) >= rect.h * 0.8);
      if (linesX && size) exX = fitRun(exX, size.w);
      if (linesY && size) exY = fitRun(exY, size.h);
      if (linesX && (!size || exX.n === size.w)) { rect.x = exX.a; rect.w = exX.b - exX.a; } else linesX = false;
      if (linesY && (!size || exY.n === size.h)) { rect.y = exY.a; rect.h = exY.b - exY.a; } else linesY = false;
      var nx, ny, p0x, p0y, src, conf, alternatives = [];
      if (size) {
        nx = size.w; ny = size.h;
        p0x = rect.w / nx; p0y = rect.h / ny;
        src = 'declared';
        /* agreement of the declared pitch with what the picture shows */
        var ax = perX ? Math.abs(perX.p - p0x) / p0x : 1;
        var ay = perY ? Math.abs(perY.p - p0y) / p0y : 1;
        var agreeX = ax < 0.03 ? 1 : (perX && Math.abs(perX.p * 2 - p0x) / p0x < 0.03 ? 0.7 : 0.4);
        var agreeY = ay < 0.03 ? 1 : (perY && Math.abs(perY.p * 2 - p0y) / p0y < 0.03 ? 0.7 : 0.4);
        conf = Math.min(agreeX, agreeY);
      } else {
        if (!perX && !perY) return { lat: null, why: 'no-grid' };
        var ppx = perX ? perX.p : perY.p, ppy = perY ? perY.p : perX.p;
        /* squares are nearly square: if one axis found a multiple, use the other */
        if (perX && perY) {
          var r = ppx / ppy;
          for (var mm = 2; mm <= 3; mm++) {
            if (Math.abs(r / mm - 1) < 0.04 && !linesX) ppx = ppx / mm;
            else if (Math.abs(r * mm - 1) < 0.04 && !linesY) ppy = ppy / mm;
          }
        }
        nx = linesX ? exX.n : Math.max(1, Math.round(rect.w / ppx));
        ny = linesY ? exY.n : Math.max(1, Math.round(rect.h / ppy));
        p0x = rect.w / nx; p0y = rect.h / ny;
        src = 'detected';
        conf = Math.min(perX ? perX.conf : 0.2, perY ? perY.conf : 0.2);
        conf = clamp(conf * 1.6, 0, 1);
        var hx = perX ? perX.half : 0, hy = perY ? perY.half : 0;
        var dx = perX ? perX.dbl : 0, dy = perY ? perY.dbl : 0;
        alternatives.push({ w: nx * 2, h: ny * 2, confidence: Math.round(clamp(Math.min(hx, hy), 0, 1) * 100) / 100 });
        if (nx >= 4 && ny >= 4) {
          alternatives.push({ w: Math.round(nx / 2), h: Math.round(ny / 2), confidence: Math.round(clamp(Math.min(dx, dy) * 0.8, 0, 1) * 100) / 100 });
        }
      }
      if (p0x < 1 || p0y < 1) return { lat: null, why: 'too-small', pitch: Math.min(p0x, p0y) };
      var fx = bestComb(px, nx, rect.x, p0x, solidRect && !linesX);
      var fy = bestComb(py, ny, rect.y, p0y, solidRect && !linesY);
      var lat = { x0: fx.x0, y0: fy.x0, pitchX: fx.p, pitchY: fy.p }, reuse = null;
      if (src === 'detected' && !osDone && (!linesX || !linesY) && nx * ny <= 400000) {
        /* a fraction of the true pitch read as the pitch: whole columns
           (rows) of squares that never differ from their neighbour */
        var os = overSegment(d, w, h, lat, nx, ny);
        if (os.x.m > 1 && !linesX) {
          nx = Math.max(1, Math.round((nx - os.x.start) / os.x.m));
          fx = bestComb(px, nx, lat.x0 + os.x.start * lat.pitchX, lat.pitchX * os.x.m);
        }
        if (os.y.m > 1 && !linesY) {
          ny = Math.max(1, Math.round((ny - os.y.start) / os.y.m));
          fy = bestComb(py, ny, lat.y0 + os.y.start * lat.pitchY, lat.pitchY * os.y.m);
        }
        lat = { x0: fx.x0, y0: fy.x0, pitchX: fx.p, pitchY: fy.p };
        alternatives = [{ w: nx * 2, h: ny * 2, confidence: alternatives.length ? alternatives[0].confidence : 0 }];
        if (nx >= 4 && ny >= 4) alternatives.push({ w: Math.round(nx / 2), h: Math.round(ny / 2), confidence: 0 });
      }
      /* no grid lines on an axis: the edge comb can be pulled by symbol
         strokes, so measure where the colour really changes between
         neighbouring squares and settle origin and pitch there (detect, the
         cheap live preview, skips this) */
      if (!quick && (fx.by !== 'lines' || fy.by !== 'lines')) {
        var lim = solidRect ? 0.004 : 0.015;
        lat = refineByEdges(d, w, h, lat, nx, ny, fx.by !== 'lines', fy.by !== 'lines', lim, reuse);
      }
      /* contrast 1 = the teeth sit on no more edge than anywhere else */
      var combConf = clamp((Math.min(fx.contrast, fy.contrast) - 1) / 0.5, 0, 1);
      conf = Math.round(clamp(conf * (0.3 + 0.7 * combConf), 0, 1) * 100) / 100;
      return {
        lat: lat, size: { w: nx, h: ny }, sizeSource: src, conf: conf, alternatives: alternatives,
        rect: rect, why: null, perX: perX ? perX.p : null, perY: perY ? perY.p : null,
        linesX: linesX, linesY: linesY, exX: exX ? [exX.a, exX.b, exX.n, exX.mean] : null, exY: exY ? [exY.a, exY.b, exY.n, exY.mean] : null,
        combX: fx.contrast, combY: fy.contrast
      };
    }

    /* ================================================================ *
     * Sampling every square
     * ================================================================ */

    /**
     * sampleCells -> { lab: Float32Array(n*3), coh: Float32Array(n), ...style stats }
     * Dominant colour of each square's inner window: the densest Lab mode
     * (radius 12) among up to 49 of its pixels, averaged.
     */
    function sampleCells(d, w, h, lat, gw, gh, marginShare, rs, cs, ring) {
      var n = gw * gh;
      var lab = new Float32Array(n * 3);
      var coh = new Float32Array(n);
      var spread = new Float32Array(n), ink = new Float32Array(n);
      var tight = new Float32Array(n);
      var px = new Float32Array(64 * 3), cen = new Uint8Array(64);
      var tmp = new Float32Array(3);
      var cenOff = 0, cenN = 0, outOff = 0, outN = 0;
      /* small squares: stay well clear of the blurred edges; big ones: take
         most of the square so a symbol drawn in it stays a minority */
      var mshare = marginShare || (Math.min(lat.pitchX, lat.pitchY) >= 9 ? 0.14 : 0.25);
      /* ring mode (squares carrying a big symbol): only the band between the
         grid line and the symbol, where the square's own colour shows */
      if (ring) mshare = 0.12;
      var per = ring ? 8 : 5;
      var R2 = 12 * 12;
      var gridDiff = 0, gridN = 0;
      for (var cy = 0; cy < gh; cy++) {
        var ya = lat.y0 + cy * lat.pitchY, yb = ya + lat.pitchY;
        var my = Math.max(0.5, lat.pitchY * mshare);
        var py0 = Math.ceil(ya + my - 0.5), py1 = Math.floor(yb - my - 0.5);
        if (py1 < py0) { py0 = py1 = Math.floor((ya + yb) / 2); }
        for (var cx = 0; cx < gw; cx++) {
          if (rs && cy % rs && cx % cs) continue;   /* a lattice test needs only some lines of squares */
          var xa = lat.x0 + cx * lat.pitchX, xb = xa + lat.pitchX;
          var mx = Math.max(0.5, lat.pitchX * mshare);
          var px0 = Math.ceil(xa + mx - 0.5), px1 = Math.floor(xb - mx - 0.5);
          if (px1 < px0) { px0 = px1 = Math.floor((xa + xb) / 2); }
          var nxp = px1 - px0 + 1, nyp = py1 - py0 + 1;
          var sx = Math.max(1, Math.ceil(nxp / per)), sy = Math.max(1, Math.ceil(nyp / per));
          var ccx = (xa + xb) / 2, ccy = (ya + yb) / 2, hx = lat.pitchX * 0.25, hy = lat.pitchY * 0.25;
          var k = 0, x, y;
          for (y = py0; y <= py1; y += sy) {
            var yy = y < 0 ? 0 : (y >= h ? h - 1 : y);
            for (x = px0; x <= px1; x += sx) {
              var xx = x < 0 ? 0 : (x >= w ? w - 1 : x);
              var central = Math.abs(x + 0.5 - ccx) < hx && Math.abs(y + 0.5 - ccy) < hy;
              if (ring && central) continue;
              if (k >= 64) break;
              var o = (yy * w + xx) * 4;
              labOf(d[o], d[o + 1], d[o + 2], px, k * 3);
              cen[k] = central ? 1 : 0;
              k++;
            }
          }
          if (k === 0) {
            var oc = (Math.min(h - 1, Math.max(0, Math.floor(ccy))) * w + Math.min(w - 1, Math.max(0, Math.floor(ccx)))) * 4;
            labOf(d[oc], d[oc + 1], d[oc + 2], px, 0);
            cen[0] = 1;
            k = 1;
          }
          var ci = cy * gw + cx, bi = -1, bn = -1, i, j;
          if (k <= 2) {
            bi = 0; bn = k;
          } else {
            for (i = 0; i < k; i++) {
              var c = 0;
              for (j = 0; j < k; j++) {
                var dL = px[i * 3] - px[j * 3], da = px[i * 3 + 1] - px[j * 3 + 1], db = px[i * 3 + 2] - px[j * 3 + 2];
                if (dL * dL + da * da + db * db <= R2) c++;
              }
              if (c > bn) { bn = c; bi = i; }
            }
          }
          var sL = 0, sa = 0, sb = 0, m = 0;
          for (j = 0; j < k; j++) {
            var eL = px[j * 3] - px[bi * 3], ea = px[j * 3 + 1] - px[bi * 3 + 1], eb = px[j * 3 + 2] - px[bi * 3 + 2];
            if (k <= 2 || eL * eL + ea * ea + eb * eb <= R2) {
              sL += px[j * 3]; sa += px[j * 3 + 1]; sb += px[j * 3 + 2]; m++;
            }
          }
          /* tighten: on a clean render the mode's own pixels are identical
             and anti-aliased symbol edges only drag the mean; re-average
             what sits within 6 of it */
          var m12 = m;
          if (k > 2) {
            var m1L = sL / m, m1a = sa / m, m1b = sb / m, tL = 0, ta = 0, tb = 0, tm = 0;
            for (j = 0; j < k; j++) {
              var hL = px[j * 3] - m1L, ha = px[j * 3 + 1] - m1a, hb = px[j * 3 + 2] - m1b;
              if (hL * hL + ha * ha + hb * hb <= 36) { tL += px[j * 3]; ta += px[j * 3 + 1]; tb += px[j * 3 + 2]; tm++; }
            }
            if (tm >= 3 && tm >= m * 0.4) { sL = tL; sa = ta; sb = tb; m = tm; }
          }
          lab[ci * 3] = sL / m; lab[ci * 3 + 1] = sa / m; lab[ci * 3 + 2] = sb / m;
          coh[ci] = m12 / k;
          var tg = 0;
          for (j = 0; j < k; j++) {
            var gL = px[j * 3] - lab[ci * 3], ga = px[j * 3 + 1] - lab[ci * 3 + 1], gb = px[j * 3 + 2] - lab[ci * 3 + 2];
            var gd = gL * gL + ga * ga + gb * gb;
            if (k <= 2 || (px[j * 3] - px[bi * 3]) * (px[j * 3] - px[bi * 3]) + (px[j * 3 + 1] - px[bi * 3 + 1]) * (px[j * 3 + 1] - px[bi * 3 + 1]) + (px[j * 3 + 2] - px[bi * 3 + 2]) * (px[j * 3 + 2] - px[bi * 3 + 2]) <= R2) tg += Math.sqrt(gd);
          }
          tight[ci] = tg / m12;
          /* spread: how far the rest of the window sits from the mode */
          var sp = 0, inkN = 0;
          for (j = 0; j < k; j++) {
            var fL = px[j * 3] - lab[ci * 3], fa = px[j * 3 + 1] - lab[ci * 3 + 1], fb = px[j * 3 + 2] - lab[ci * 3 + 2];
            var fd = Math.sqrt(fL * fL + fa * fa + fb * fb);
            sp += fd;
            if (fd > 30) inkN++;
            if (cen[j]) { cenN++; if (fd > 30) cenOff++; } else { outN++; if (fd > 30) outOff++; }
          }
          spread[ci] = sp / k;
          ink[ci] = inkN / k;
          /* grid-line probe on a sparse subset: the boundary pixel vs centre */
          if ((ci % 7) === 0 && lat.pitchX >= 5) {
            var bx = Math.round(xa), by = Math.round((ya + yb) / 2 - 0.5);
            var cxp = Math.round((xa + xb) / 2 - 0.5);
            if (bx >= 0 && bx < w && by >= 0 && by < h && cxp >= 0 && cxp < w) {
              var ob = (by * w + bx) * 4;
              labOf(d[ob], d[ob + 1], d[ob + 2], tmp, 0);
              gridDiff += lab[ci * 3] - tmp[0];
              gridN++;
            }
          }
        }
      }
      /* the picture's own noise: how tight a square's main colour is */
      var ns = [], st2 = Math.max(1, Math.floor(n / 20000));
      for (var q = 0; q < n; q += st2) ns.push(tight[q]);
      ns.sort(function (a, b) { return a - b; });
      /* how far apart two squares of one colour read: neighbours that are
         nearly the same, median distance. This is the noise the clustering
         must forgive; per-pixel scatter averages out inside a square */
      var nd = [];
      for (var q3 = 0; q3 + 1 < n && nd.length < 40000; q3 += st2) {
        if ((q3 + 1) % gw === 0) continue;
        var e1 = lab[q3 * 3] - lab[q3 * 3 + 3], e2 = lab[q3 * 3 + 1] - lab[q3 * 3 + 4], e3 = lab[q3 * 3 + 2] - lab[q3 * 3 + 5];
        var ed = Math.sqrt(e1 * e1 + e2 * e2 + e3 * e3);
        if (ed < 8) nd.push(ed);
      }
      nd.sort(function (a, b) { return a - b; });
      var cellNoise = nd.length >= 20 ? nd[nd.length >> 2] / 1.556 : (ns.length ? ns[ns.length >> 1] : 0);
      var noise = ns.length ? ns[ns.length >> 1] : 0;
      return { lab: lab, coh: coh, spread: spread, ink: ink, noise: noise, cellNoise: cellNoise,
        centreInk: cenN ? cenOff / cenN : 0, ringInk: outN ? outOff / outN : 0, gridDark: gridN ? gridDiff / gridN : 0 };
    }

    /* ================================================================ *
     * Clustering
     * ================================================================ */

    /**
     * cluster(lab, n, opts) -> { cent: Float32Array(k*3), k, assign: Int16Array(n), counts }
     * opts.target: exact class count (key mode) or 0; opts.maxColors.
     */
    function cluster(lab, n, target, maxColors, noise, minExp, cellNoise) {
      /* how far apart two colours must be to stay two: from the noise */
      var MERGE_DE = clamp(1.5 + 3 * (noise || 0), 2, 9);
      /* with a key: only what is surely one colour is merged before the
         count of colours takes over */
      var SAME_DE = clamp(0.6 * (2 + 3 * (cellNoise || 0)), 1.5, 6);
      /* 1. histogram in 2-unit Lab bins */
      var bins = {}, keys = [], i, key;
      for (i = 0; i < n; i++) {
        var L = lab[i * 3], a = lab[i * 3 + 1], b = lab[i * 3 + 2];
        key = (Math.round(L / 2) + 10) * 65536 + (Math.round(a / 2) + 128) * 256 + (Math.round(b / 2) + 128);
        var bn = bins[key];
        if (!bn) { bn = bins[key] = { n: 0, L: 0, a: 0, b: 0 }; keys.push(key); }
        bn.n++; bn.L += L; bn.a += a; bn.b += b;
      }
      var list = [];
      for (i = 0; i < keys.length; i++) {
        var q = bins[keys[i]];
        list.push({ n: q.n, L: q.L / q.n, a: q.a / q.n, b: q.b / q.n, key: keys[i] });
      }
      list.sort(function (x, y) { return y.n - x.n || x.key - y.key; });

      /* 2. leader clustering, radius grows until <= 320 leaders */
      var RL = clamp(MERGE_DE / 2, 1.5, 4), leaders;
      for (;;) {
        leaders = [];
        for (i = 0; i < list.length; i++) {
          var it = list[i], bj = -1, bd = RL * RL;
          for (var j = 0; j < leaders.length; j++) {
            var ld = leaders[j];
            var dL = it.L - ld.L, da = it.a - ld.a, db = it.b - ld.b;
            var dd = dL * dL + da * da + db * db;
            if (dd < bd) { bd = dd; bj = j; }
          }
          if (bj < 0) leaders.push({ n: it.n, L: it.L, a: it.a, b: it.b, sL: it.L * it.n, sa: it.a * it.n, sb: it.b * it.n });
          else {
            var l2 = leaders[bj];
            l2.n += it.n; l2.sL += it.L * it.n; l2.sa += it.a * it.n; l2.sb += it.b * it.n;
          }
        }
        if (leaders.length <= 320 || RL > 40) break;
        RL *= 1.4;
      }
      var cl = [];
      for (i = 0; i < leaders.length; i++) {
        var le = leaders[i];
        cl.push({ n: le.n, L: le.sL / le.n, a: le.sa / le.n, b: le.sb / le.n, alive: true });
      }

      /* 3. agglomeration */
      function dist(p, q2) {
        var dL = p.L - q2.L, da = p.a - q2.a, db = p.b - q2.b;
        return Math.sqrt(dL * dL + da * da + db * db);
      }
      var alive = cl.length;
      var minN = Math.max(2, Math.round(n * 0.0004));
      function join(i1, i2) {
        var A = cl[i1], B = cl[i2], nn = A.n + B.n;
        A.L = (A.L * A.n + B.L * B.n) / nn;
        A.a = (A.a * A.n + B.a * B.n) / nn;
        A.b = (A.b * A.n + B.b * B.n) / nn;
        A.n = nn;
        B.alive = false;
        alive--;
      }
      /* the cheapest Ward merge, optionally only among pairs closer than maxD
         or only pairs that involve a cluster smaller than minN */
      function cheapest(maxD, smallOnly, smallN) {
        var sN = smallN || minN;
        var bi = -1, bj = -1, bc = Infinity;
        for (var i2 = 0; i2 < cl.length; i2++) {
          if (!cl[i2].alive) continue;
          for (var j3 = i2 + 1; j3 < cl.length; j3++) {
            if (!cl[j3].alive) continue;
            if (smallOnly && cl[i2].n >= sN && cl[j3].n >= sN) continue;
            var dd2 = dist(cl[i2], cl[j3]);
            if (dd2 >= maxD) continue;
            var cost = smallOnly ? dd2 : (cl[i2].n * cl[j3].n) / (cl[i2].n + cl[j3].n) * dd2 * dd2;
            if (cost < bc) { bc = cost; bi = i2; bj = j3; }
          }
        }
        return bi < 0 ? null : [bi, bj];
      }
      var pair, tooMany = false;
      if (target > 0) {
        /* key mode: exactly as many classes as the key has colours */
        /* the same colour seen through noise is one colour even here */
        while ((pair = cheapest(SAME_DE, false))) join(pair[0], pair[1]);
        /* specks far smaller than any colour the key lists go first, so the
           budget of classes is not spent on JPEG debris while two real
           colours a few dE apart get merged */
        var speck = minExp > 0 ? Math.max(minN, Math.floor(minExp * 0.3)) : minN;
        while (alive > target && (pair = cheapest(Infinity, true, speck))) join(pair[0], pair[1]);
        while (alive > target && (pair = cheapest(Infinity, false))) join(pair[0], pair[1]);
      } else {
        /* one colour seen through noise is one colour */
        while ((pair = cheapest(MERGE_DE, false))) join(pair[0], pair[1]);
        /* specks: a handful of squares of their own colour are edge blends */
        while ((pair = cheapest(MERGE_DE * 3, true))) join(pair[0], pair[1]);   /* (a lone square of a clearly different colour is a detail, kept) */
        if (alive > maxColors) {
          tooMany = true;
          while (alive > maxColors && (pair = cheapest(Infinity, false))) join(pair[0], pair[1]);
        }
      }
      var live = [];
      for (i = 0; i < cl.length; i++) if (cl[i].alive) live.push(cl[i]);
      var k = live.length;
      var cent = new Float32Array(k * 3);
      for (i = 0; i < k; i++) { cent[i * 3] = live[i].L; cent[i * 3 + 1] = live[i].a; cent[i * 3 + 2] = live[i].b; }

      /* 4. Lloyd passes over every square */
      var assign = new Int16Array(n), counts = new Int32Array(k);
      for (var it2 = 0; it2 < 3; it2++) {
        var sums = new Float64Array(k * 3);
        for (i = 0; i < k; i++) counts[i] = 0;
        for (i = 0; i < n; i++) {
          var best = 0, bd2 = Infinity;
          for (var c = 0; c < k; c++) {
            var e1 = lab[i * 3] - cent[c * 3], e2 = lab[i * 3 + 1] - cent[c * 3 + 1], e3 = lab[i * 3 + 2] - cent[c * 3 + 2];
            var dv = e1 * e1 + e2 * e2 + e3 * e3;
            if (dv < bd2) { bd2 = dv; best = c; }
          }
          assign[i] = best; counts[best]++;
          sums[best * 3] += lab[i * 3]; sums[best * 3 + 1] += lab[i * 3 + 1]; sums[best * 3 + 2] += lab[i * 3 + 2];
        }
        for (c = 0; c < k; c++) {
          if (!counts[c]) continue;
          cent[c * 3] = sums[c * 3] / counts[c];
          cent[c * 3 + 1] = sums[c * 3 + 1] / counts[c];
          cent[c * 3 + 2] = sums[c * 3 + 2] / counts[c];
        }
      }
      /* drop empty classes, order largest first */
      var order = [];
      for (c = 0; c < k; c++) if (counts[c] > 0) order.push(c);
      order.sort(function (x, y) { return counts[y] - counts[x] || x - y; });
      var remap = new Int16Array(k);
      for (c = 0; c < k; c++) remap[c] = -1;
      var cent2 = new Float32Array(order.length * 3), counts2 = new Int32Array(order.length);
      for (i = 0; i < order.length; i++) {
        remap[order[i]] = i;
        cent2[i * 3] = cent[order[i] * 3]; cent2[i * 3 + 1] = cent[order[i] * 3 + 1]; cent2[i * 3 + 2] = cent[order[i] * 3 + 2];
        counts2[i] = counts[order[i]];
      }
      for (i = 0; i < n; i++) assign[i] = remap[assign[i]];
      return { cent: cent2, k: order.length, assign: assign, counts: counts2, tooMany: tooMany };
    }

    /** Per-square confidence from the nearest / second-nearest class margin. */
    function confidences(lab, n, cent, k, assign, coh) {
      var conf = new Uint8Array(n), low = 0;
      for (var i = 0; i < n; i++) {
        var d1 = Infinity, d2 = Infinity;
        for (var c = 0; c < k; c++) {
          var e1 = lab[i * 3] - cent[c * 3], e2 = lab[i * 3 + 1] - cent[c * 3 + 1], e3 = lab[i * 3 + 2] - cent[c * 3 + 2];
          var dv = Math.sqrt(e1 * e1 + e2 * e2 + e3 * e3);
          if (dv < d1) { d2 = d1; d1 = dv; } else if (dv < d2) d2 = dv;
        }
        var margin = k > 1 ? (d2 - d1) / Math.max(d2, 1) : 1;
        var v = clamp(margin * 1.6, 0, 1) * (0.5 + 0.5 * (coh ? coh[i] : 1));
        conf[i] = Math.round(v * 255);
        if (conf[i] < LOW_CONF) low++;
      }
      return { conf: conf, low: low };
    }
    var LOW_CONF = 90;

    /* ================================================================ *
     * Matching classes to the key
     * ================================================================ */

    /** Hungarian (min-cost) on a square matrix, rows -> cols. */
    function hungarian(C, S) {
      var INF = 1e18;
      var u = new Float64Array(S + 1), v = new Float64Array(S + 1);
      var p = new Int32Array(S + 1), way = new Int32Array(S + 1);
      for (var i = 1; i <= S; i++) {
        p[0] = i;
        var j0 = 0;
        var minv = new Float64Array(S + 1), used = new Uint8Array(S + 1);
        for (var j = 0; j <= S; j++) minv[j] = INF;
        do {
          used[j0] = 1;
          var i0 = p[j0], delta = INF, j1 = 0;
          for (j = 1; j <= S; j++) {
            if (used[j]) continue;
            var cur = C[(i0 - 1) * S + (j - 1)] - u[i0] - v[j];
            if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
            if (minv[j] < delta) { delta = minv[j]; j1 = j; }
          }
          for (j = 0; j <= S; j++) {
            if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
          }
          j0 = j1;
        } while (p[j0] !== 0);
        do { var jn = way[j0]; p[j0] = p[jn]; j0 = jn; } while (j0);
      }
      var rowTo = new Int32Array(S);
      for (j = 1; j <= S; j++) if (p[j] > 0) rowTo[p[j] - 1] = j - 1;
      return rowTo;
    }

    function countCost(nRead, expected) {
      return Math.min(3, Math.abs(nRead - expected) / Math.max(expected, 10));
    }

    /**
     * matchKey(classes, entries, fabricOpt, total, border, assignOpt)
     * classes: [{ lab:[L,a,b], n, border }]; entries: [{ lab|null, count|null, use }]
     * -> { fabric: classIndex|-1, entry: Int32Array(k) (-1 none), how: [], dE: [], cost }
     */
    function matchKey(cls, entries, fabricOpt, total, assignOpt) {
      var k = cls.length, i, j;
      var entryOf = new Int32Array(k), how = [], dE = [];
      for (i = 0; i < k; i++) { entryOf[i] = -1; how.push(null); dE.push(null); }
      var takenE = {}, fixedFabric = -1;
      if (assignOpt) {
        for (var ck in assignOpt) {
          if (!assignOpt.hasOwnProperty(ck)) continue;
          var ci = +ck;
          if (!(ci >= 0 && ci < k)) continue;
          var av = assignOpt[ck];
          if (av === 'fabric') { fixedFabric = ci; continue; }
          var ei = +av;
          if (ei >= 0 && ei < entries.length && entries[ei].use) {
            entryOf[ci] = ei; how[ci] = 'user'; takenE[ei] = true;
            if (entries[ei].lab) dE[ci] = de2000(cls[ci].lab[0], cls[ci].lab[1], cls[ci].lab[2], entries[ei].lab[0], entries[ei].lab[1], entries[ei].lab[2]);
          }
        }
      }
      var keyTotal = 0, haveCounts = 0, nUse = 0;
      for (j = 0; j < entries.length; j++) {
        if (!entries[j].use) continue;
        nUse++;
        if (entries[j].count > 0) { keyTotal += entries[j].count; haveCounts++; }
      }
      var countsKnown = haveCounts > 0 && haveCounts === nUse;
      var fabricWant = countsKnown && keyTotal <= total ? total - keyTotal : -1;

      /* fabric candidates */
      var fabCands = [];
      if (fixedFabric >= 0) fabCands = [fixedFabric];
      else if (fabricOpt === 'none') fabCands = [-1];
      else if (fabricOpt && fabricOpt.lab) {
        var bestF = -1, bd = 25;
        for (i = 0; i < k; i++) {
          var dd = de2000(cls[i].lab[0], cls[i].lab[1], cls[i].lab[2], fabricOpt.lab[0], fabricOpt.lab[1], fabricOpt.lab[2]);
          if (dd < bd && entryOf[i] < 0) { bd = dd; bestF = i; }
        }
        fabCands = [bestF];
      } else {
        /* auto: the border-heavy big classes, and "no fabric" when the key
           says every square is a stitch */
        var byBorder = [];
        for (i = 0; i < k; i++) if (entryOf[i] < 0) byBorder.push(i);
        byBorder.sort(function (a, b) { return cls[b].border - cls[a].border || cls[b].n - cls[a].n; });
        for (i = 0; i < byBorder.length && i < 3; i++) fabCands.push(byBorder[i]);
        if (fabricWant >= 0 && fabricWant < total * 0.02) fabCands.push(-1);
        if (!fabCands.length) fabCands.push(-1);
      }

      function solve(cw) {
      var best = null;
      for (var fc = 0; fc < fabCands.length; fc++) {
        var fab = fabCands[fc];
        var rows = [], cols = [];
        for (i = 0; i < k; i++) if (i !== fab && entryOf[i] < 0) rows.push(i);
        for (j = 0; j < entries.length; j++) if (entries[j].use && !takenE[j]) cols.push(j);
        var S = Math.max(rows.length, cols.length);
        var cost = 0, rowTo = null, C = null;
        /* fabric's own cost */
        var fabCost = 0;
        if (fab >= 0) {
          if (fabricWant >= 0) fabCost = countCost(cls[fab].n, fabricWant) * 2;
          else fabCost = (1 - cls[fab].border) * 0.5;
        } else if (fabricWant > 0) fabCost = countCost(0, fabricWant) * 2;
        if (S > 0) {
          C = new Float64Array(S * S);
          for (var r = 0; r < S; r++) {
            for (var c = 0; c < S; c++) {
              var v;
              if (r >= rows.length || c >= cols.length) v = 1.2;      // unmatched
              else {
                var cl2 = cls[rows[r]], en = entries[cols[c]];
                var colourD = en.lab ? de2000(cl2.lab[0], cl2.lab[1], cl2.lab[2], en.lab[0], en.lab[1], en.lab[2]) : 25;
                if (en.count > 0) v = countCost(cl2.n, en.count) + cw * Math.min(2, colourD / 50);
                else v = Math.min(2, colourD / 25);
              }
              C[r * S + c] = v;
            }
          }
          rowTo = hungarian(C, S);
          for (r = 0; r < S; r++) cost += C[r * S + rowTo[r]];
        }
        cost += fabCost;
        if (!best || cost < best.cost - 1e-9) best = { cost: cost, fab: fab, rows: rows, cols: cols, rowTo: rowTo, S: S, C: C };
      }
      return best;
      }
      /* colour is weak evidence because the publisher's RGB is not the DMC
         table's; how weak, the picture tells: when the matched classes sit
         right on their key colours, colour may overrule a small count gap
         (two close colours whose read counts are a little off) */
      var best = solve(0.25);
      if (best.rowTo) {
        var des = [];
        for (var rr = 0; rr < best.rows.length; rr++) {
          var c3 = best.rowTo[rr];
          if (c3 >= best.cols.length) continue;
          /* each placed class's distance to its NEAREST key colour, so a
             count-driven swap cannot make colour look worse than it is */
          var k3 = cls[best.rows[rr]], nd3 = Infinity;
          for (var e4 = 0; e4 < entries.length; e4++) {
            var en4 = entries[e4];
            if (!en4.use || !en4.lab) continue;
            var dd4 = de2000(k3.lab[0], k3.lab[1], k3.lab[2], en4.lab[0], en4.lab[1], en4.lab[2]);
            if (dd4 < nd3) nd3 = dd4;
          }
          if (nd3 < Infinity) des.push(nd3);
        }
        des.sort(function (a, b) { return a - b; });
        var med = des.length ? des[des.length >> 1] : 99;
        var cw2 = 0.25 * clamp(8 / Math.max(med, 1), 1, 8);
        if (cw2 > 0.26) best = solve(cw2);
      }

      var fabric = best.fab;
      if (best.rowTo) {
        for (var r2 = 0; r2 < best.rows.length; r2++) {
          var cc = best.rowTo[r2];
          if (cc >= best.cols.length) continue;
          var ci2 = best.rows[r2], ej = best.cols[cc], en2 = entries[ej];
          var colour = en2.lab ? de2000(cls[ci2].lab[0], cls[ci2].lab[1], cls[ci2].lab[2], en2.lab[0], en2.lab[1], en2.lab[2]) : null;
          var cnt = en2.count > 0 ? countCost(cls[ci2].n, en2.count) : null;
          /* a match that neither the count nor the colour supports is a guess:
             leave it for the user */
          if (cnt !== null && cnt > 0.5 && (colour === null || colour > 20)) continue;
          if (cnt === null && colour !== null && colour > 30) continue;
          entryOf[ci2] = ej;
          dE[ci2] = colour;
          if (cnt !== null && cnt <= 0.1 && colour !== null && colour <= 20) how[ci2] = 'count+colour';
          else if (cnt !== null && (colour === null || cnt <= 0.1)) how[ci2] = 'count';
          else if (cnt !== null) how[ci2] = 'count+colour';
          else how[ci2] = 'colour';
        }
      }
      return { fabric: fabric, entry: entryOf, how: how, dE: dE, cost: best.cost };
    }

    /* ================================================================ *
     * Symbol charts: shape descriptors
     * ================================================================ */

    var DS = 10;   // descriptor side

    /**
     * symbolDescriptors -> { desc: Float32Array(n*DS*DS), ink: Float32Array(n), thr }
     * Luminance, global Otsu threshold, each square's inner 80 % resampled
     * to DS x DS coverage (box filter), lightly blurred.
     */
    function symbolDescriptors(d, w, h, lat, gw, gh) {
      var n = gw * gh, i, x, y;
      /* Otsu on a sample of the chart area's luminance */
      var hist = new Float64Array(256), tot = 0;
      var xa = Math.max(0, Math.floor(lat.x0)), xb = Math.min(w, Math.ceil(lat.x0 + gw * lat.pitchX));
      var ya = Math.max(0, Math.floor(lat.y0)), yb = Math.min(h, Math.ceil(lat.y0 + gh * lat.pitchY));
      var st = Math.max(1, Math.floor(Math.sqrt((xb - xa) * (yb - ya) / 400000)));
      for (y = ya; y < yb; y += st) {
        for (x = xa; x < xb; x += st) {
          var o = (y * w + x) * 4;
          hist[(d[o] * 77 + d[o + 1] * 150 + d[o + 2] * 29) >> 8]++; tot++;
        }
      }
      var sum = 0, sumB = 0, wB = 0, best = 0, thr = 128;
      for (i = 0; i < 256; i++) sum += i * hist[i];
      for (i = 0; i < 256; i++) {
        wB += hist[i]; if (!wB) continue;
        var wF = tot - wB; if (!wF) break;
        sumB += i * hist[i];
        var mB = sumB / wB, mF = (sum - sumB) / wF;
        var between = wB * wF * (mB - mF) * (mB - mF);
        if (between > best) { best = between; thr = i; }
      }
      var desc = new Float32Array(n * DS * DS), ink = new Float32Array(n);
      var acc = new Float32Array(DS * DS);
      var cap = Math.ceil(lat.pitchX + 2) * Math.ceil(lat.pitchY + 2);
      var sv = new Float32Array(cap), sxs = new Float32Array(cap), sys = new Float32Array(cap);
      for (var cy = 0; cy < gh; cy++) {
        for (var cx = 0; cx < gw; cx++) {
          var x0 = lat.x0 + cx * lat.pitchX, y0 = lat.y0 + cy * lat.pitchY;
          var mxp = lat.pitchX * 0.15, myp = lat.pitchY * 0.15;   /* clear of grid lines, bold ones too */
          var ax = x0 + mxp, bx = x0 + lat.pitchX - mxp, ay = y0 + myp, by = y0 + lat.pitchY - myp;
          for (i = 0; i < DS * DS; i++) acc[i] = 0;
          var ix0 = Math.max(0, Math.ceil(ax - 0.5)), ix1 = Math.min(w - 1, Math.floor(bx - 0.5));
          var iy0 = Math.max(0, Math.ceil(ay - 0.5)), iy1 = Math.min(h - 1, Math.floor(by - 0.5));
          /* soft ink per pixel, and its centroid: the glyph is registered on
             its own centre, so sub-pixel placement does not change it */
          var np2 = 0, sw = 0, mx = 0, my = 0;
          for (y = iy0; y <= iy1; y++) {
            for (x = ix0; x <= ix1; x++) {
              var o2 = (y * w + x) * 4;
              var lum = (d[o2] * 77 + d[o2 + 1] * 150 + d[o2 + 2] * 29) >> 8;
              var s = clamp((thr + 20 - lum) / 40, 0, 1);
              if (np2 < cap) { sv[np2] = s; sxs[np2] = x + 0.5; sys[np2] = y + 0.5; np2++; }
              sw += s; mx += s * (x + 0.5); my += s * (y + 0.5);
            }
          }
          var area = Math.max(1, (iy1 - iy0 + 1) * (ix1 - ix0 + 1));
          ink[cy * gw + cx] = sw / area;
          if (sw > 0) { mx /= sw; my /= sw; } else { mx = x0 + lat.pitchX / 2; my = y0 + lat.pitchY / 2; }
          /* keep the centre within a quarter square of the middle */
          mx = clamp(mx, x0 + lat.pitchX * 0.3, x0 + lat.pitchX * 0.7);
          my = clamp(my, y0 + lat.pitchY * 0.3, y0 + lat.pitchY * 0.7);
          var spanX = lat.pitchX * 0.7, spanY = lat.pitchY * 0.7;
          var binA = (spanX / DS) * (spanY / DS);
          for (var q = 0; q < np2; q++) {
            if (!sv[q]) continue;
            /* bilinear splat into the centred DS x DS grid */
            var fu = (sxs[q] - mx) / spanX * DS + DS / 2 - 0.5, fv = (sys[q] - my) / spanY * DS + DS / 2 - 0.5;
            var u0 = Math.floor(fu), v0 = Math.floor(fv), du = fu - u0, dv = fv - v0;
            for (var a2 = 0; a2 < 2; a2++) {
              var vv = v0 + a2;
              if (vv < 0 || vv >= DS) continue;
              var wv = a2 ? dv : 1 - dv;
              for (var b2 = 0; b2 < 2; b2++) {
                var uu = u0 + b2;
                if (uu < 0 || uu >= DS) continue;
                acc[vv * DS + uu] += sv[q] * wv * (b2 ? du : 1 - du);
              }
            }
          }
          var base = (cy * gw + cx) * DS * DS;
          for (i = 0; i < DS * DS; i++) desc[base + i] = Math.min(1, acc[i] / binA);
        }
      }
      /* 3x3 blur of each descriptor: a pixel of misregistration costs little */
      var tmpD = new Float32Array(DS * DS);
      for (var c = 0; c < n; c++) {
        var bb = c * DS * DS;
        for (y = 0; y < DS; y++) {
          for (x = 0; x < DS; x++) {
            var s2 = 0, nn = 0;
            for (var dy = -1; dy <= 1; dy++) {
              for (var dx = -1; dx <= 1; dx++) {
                var X = x + dx, Y = y + dy;
                if (X < 0 || Y < 0 || X >= DS || Y >= DS) continue;
                var wgt = (dx === 0 && dy === 0) ? 2 : 1;
                s2 += desc[bb + Y * DS + X] * wgt; nn += wgt;
              }
            }
            tmpD[y * DS + x] = s2 / nn;
          }
        }
        for (i = 0; i < DS * DS; i++) desc[bb + i] = tmpD[i];
      }
      return { desc: desc, ink: ink, thr: thr };
    }

    /**
     * clusterShapes -> { assign: Int16Array (-1 blank), k, counts, rep: Int32Array (cell index) }
     * Blank squares (ink under 3 %) are the fabric; the rest by leader
     * clustering on mean absolute descriptor difference, then merging
     * classes closer than the threshold, then a reassignment pass.
     */
    function clusterShapes(desc, ink, n, target, minExp) {
      var D = DS * DS, i, j, c;
      var assign = new Int16Array(n);
      var protos = [], pn = [];
      var TH = 0.015;
      function dist(cell, pbuf, pi) {
        var s = 0, b = cell * D, pb = pi * D;
        for (var t = 0; t < D; t++) s += Math.abs(desc[b + t] - pbuf[pb + t]);
        return s / D;
      }
      var P = new Float32Array(Math.min(n, 320) * D), np = 0;
      for (i = 0; i < n; i++) {
        if (ink[i] < 0.03) { assign[i] = -1; continue; }
        var bj = -1, bd = TH;
        for (j = 0; j < np; j++) {
          var dd = dist(i, P, j);
          if (dd < bd) { bd = dd; bj = j; }
        }
        if (bj < 0) {
          if (np >= 320) { bj = 0; bd = 0; for (j = 0; j < np; j++) { dd = dist(i, P, j); if (j === 0 || dd < bd) { bd = dd; bj = j; } } }
          else {
            for (var t = 0; t < D; t++) P[np * D + t] = desc[i * D + t];
            pn.push(1); bj = np; np++;
            assign[i] = bj;
            continue;
          }
        }
        /* running mean of the prototype */
        pn[bj]++;
        var f = 1 / pn[bj];
        for (t = 0; t < D; t++) P[bj * D + t] += (desc[i * D + t] - P[bj * D + t]) * f;
        assign[i] = bj;
      }
      /* merge: specks into their nearest, the same glyph seen through noise,
         and (with a key) down to the key's number of symbols */
      var alive = [];
      for (j = 0; j < np; j++) alive.push(true);
      var nAlive = np;
      var minN = Math.max(1, Math.round(n * 0.0003));
      var speck = minExp > 0 ? Math.max(minN, Math.floor(minExp * 0.3)) : minN;
      var SAME = 0.022;
      function pd(a, b) {
        var s = 0;
        for (var t2 = 0; t2 < D; t2++) s += Math.abs(P[a * D + t2] - P[b * D + t2]);
        return s / D;
      }
      var PD = new Float32Array(np * np);
      for (i = 0; i < np; i++) for (j = i + 1; j < np; j++) PD[i * np + j] = PD[j * np + i] = pd(i, j);
      for (;;) {
        var ba = -1, bb2 = -1, bc = Infinity, sa = -1, sb = -1, sc = Infinity, na = -1, nb = -1, nc = Infinity;
        for (i = 0; i < np; i++) {
          if (!alive[i]) continue;
          for (j = i + 1; j < np; j++) {
            if (!alive[j]) continue;
            var dd2 = PD[i * np + j];
            if (dd2 < nc) { nc = dd2; na = i; nb = j; }
            if (Math.min(pn[i], pn[j]) < speck && dd2 < sc) { sc = dd2; sa = i; sb = j; }
            var ward = pn[i] * pn[j] / (pn[i] + pn[j]) * dd2 * dd2;
            if (ward < bc) { bc = ward; ba = i; bb2 = j; }
          }
        }
        if (na < 0) break;
        var pa, pb;
        if (nc < SAME) { pa = na; pb = nb; }
        else if (target > 0) {
          if (nAlive <= target) break;
          if (sa >= 0) { pa = sa; pb = sb; } else { pa = ba; pb = bb2; }
        } else if (sa >= 0 && sc < SAME * 3) { pa = sa; pb = sb; }
        else break;
        var keep = pn[pa] >= pn[pb] ? pa : pb, drop = keep === pa ? pb : pa;
        var tn = pn[keep] + pn[drop];
        for (var t3 = 0; t3 < D; t3++) P[keep * D + t3] = (P[keep * D + t3] * pn[keep] + P[drop * D + t3] * pn[drop]) / tn;
        pn[keep] = tn; alive[drop] = false; nAlive--;
        for (j = 0; j < np; j++) if (alive[j] && j !== keep) PD[keep * np + j] = PD[j * np + keep] = pd(keep, j);
      }
      var live = [];
      for (j = 0; j < np; j++) if (alive[j]) live.push(j);
      /* reassign every inked square to its nearest live prototype */
      var counts = new Int32Array(live.length), rep = new Int32Array(live.length), repD = new Float32Array(live.length);
      for (c = 0; c < live.length; c++) { rep[c] = -1; repD[c] = 1e9; }
      for (i = 0; i < n; i++) {
        if (assign[i] < 0) continue;
        var bj2 = 0, bd2 = Infinity;
        for (c = 0; c < live.length; c++) {
          var d3 = dist(i, P, live[c]);
          if (d3 < bd2) { bd2 = d3; bj2 = c; }
        }
        assign[i] = bj2; counts[bj2]++;
        if (bd2 < repD[bj2]) { repD[bj2] = bd2; rep[bj2] = i; }
      }
      /* order by count */
      var order = [];
      for (c = 0; c < live.length; c++) if (counts[c] > 0) order.push(c);
      order.sort(function (a, b) { return counts[b] - counts[a] || a - b; });
      var remap = new Int16Array(live.length);
      for (c = 0; c < live.length; c++) remap[c] = -1;
      var counts2 = new Int32Array(order.length), rep2 = new Int32Array(order.length);
      for (c = 0; c < order.length; c++) { remap[order[c]] = c; counts2[c] = counts[order[c]]; rep2[c] = rep[order[c]]; }
      for (i = 0; i < n; i++) if (assign[i] >= 0) assign[i] = remap[assign[i]];
      return { assign: assign, k: order.length, counts: counts2, rep: rep2 };
    }

    /** Symbol classes -> key entries by stitch count only (unique, exact-ish). */
    function matchByCount(counts, k, entries, assignOpt) {
      var entryOf = new Int32Array(k), how = [], i, j;
      for (i = 0; i < k; i++) { entryOf[i] = -1; how.push(null); }
      var taken = {};
      if (assignOpt) {
        for (var ck in assignOpt) {
          if (!assignOpt.hasOwnProperty(ck)) continue;
          var ci = +ck, ev = +assignOpt[ck];
          if (ci >= 0 && ci < k && ev >= 0 && ev < entries.length && entries[ev].use) {
            entryOf[ci] = ev; how[ci] = 'user'; taken[ev] = true;
          }
        }
      }
      /* exact, unique counts first; then within 1 % when unambiguous */
      for (var pass = 0; pass < 2; pass++) {
        for (i = 0; i < k; i++) {
          if (entryOf[i] >= 0) continue;
          var cands = [];
          for (j = 0; j < entries.length; j++) {
            if (!entries[j].use || taken[j] || !(entries[j].count > 0)) continue;
            var tol = pass === 0 ? 0 : Math.max(2, entries[j].count * 0.01);
            if (Math.abs(entries[j].count - counts[i]) <= tol) cands.push(j);
          }
          if (cands.length !== 1) continue;
          /* and no other class claims the same entry */
          var rivals = 0;
          for (var i2 = 0; i2 < k; i2++) {
            if (i2 === i || entryOf[i2] >= 0) continue;
            var tol2 = pass === 0 ? 0 : Math.max(2, entries[cands[0]].count * 0.01);
            if (Math.abs(entries[cands[0]].count - counts[i2]) <= tol2) rivals++;
          }
          if (rivals) continue;
          entryOf[i] = cands[0]; taken[cands[0]] = true; how[i] = 'count';
        }
      }
      return { entry: entryOf, how: how };
    }

    /* ================================================================ *
     * Reading one lattice (colour mode)
     * ================================================================ */

    function borderShares(assign, gw, gh, k) {
      var b = new Float64Array(k), tot = 0, x, y, v;
      for (x = 0; x < gw; x++) {
        v = assign[x]; if (v >= 0) b[v]++;
        v = assign[(gh - 1) * gw + x]; if (v >= 0) b[v]++;
        tot += 2;
      }
      for (y = 1; y < gh - 1; y++) {
        v = assign[y * gw]; if (v >= 0) b[v]++;
        v = assign[y * gw + gw - 1]; if (v >= 0) b[v]++;
        tot += 2;
      }
      for (var c = 0; c < k; c++) b[c] /= Math.max(1, tot);
      return b;
    }

    function readColour(d, w, h, lat, gw, gh, o, ring) {
      var n = gw * gh;
      var tA = now();
      var smp = sampleCells(d, w, h, lat, gw, gh, null, 0, 0, ring);
      var tB = now();
      var nUse = 0;
      for (var j = 0; j < o.entries.length; j++) if (o.entries[j].use) nUse++;
      var target = nUse > 0 ? nUse + (o.fabric === 'none' ? 0 : 1) : 0;
      if (target > n) target = n;
      var minExp = 0;
      for (var j2 = 0; j2 < o.entries.length; j2++) {
        var ec = o.entries[j2];
        if (ec.use && ec.count > 0 && (!minExp || ec.count < minExp)) minExp = ec.count;
      }
      var cl = cluster(smp.lab, n, target, o.maxColors, smp.noise, minExp, smp.cellNoise);
      var tC = now();
      var res = matchAll(cl, gw, gh, o, n, nUse);
      if (nUse > 0) {
        /* the key asked for more colours than the picture has: a class the
           key could not place that sits within the noise of another class
           is that class (a fabric split in two, say), never a colour */
        var near = Math.max(5, 2 + 3 * (smp.noise || 0));
        for (var guard = 0; guard < 8; guard++) {
          var drop = -1, into = -1;
          for (var c = 0; c < cl.k && drop < 0; c++) {
            if (res.m.entry[c] >= 0 || c === res.m.fabric || (o.assign && o.assign[c] !== undefined)) continue;
            var bd = Infinity, bj = -1;
            for (var c2 = 0; c2 < cl.k; c2++) {
              if (c2 === c) continue;
              var dL = cl.cent[c * 3] - cl.cent[c2 * 3], da = cl.cent[c * 3 + 1] - cl.cent[c2 * 3 + 1], db = cl.cent[c * 3 + 2] - cl.cent[c2 * 3 + 2];
              var dd = Math.sqrt(dL * dL + da * da + db * db);
              if (dd < bd) { bd = dd; bj = c2; }
            }
            if (bj >= 0 && bd < near) { drop = c; into = bj; }
          }
          if (drop < 0) break;
          cl = mergeClass(cl, drop, into, n);
          res = matchAll(cl, gw, gh, o, n, nUse);
        }
      }
      var tD = now();
      return { smp: smp, cl: cl, cls: res.cls, m: res.m, t: { sample: tB - tA, cluster: tC - tB, match: tD - tC } };
    }

    function matchAll(cl, gw, gh, o, n, nUse) {
      var bs = borderShares(cl.assign, gw, gh, cl.k);
      var cls = [];
      for (var c = 0; c < cl.k; c++) {
        cls.push({ lab: [cl.cent[c * 3], cl.cent[c * 3 + 1], cl.cent[c * 3 + 2]], n: cl.counts[c], border: bs[c] });
      }
      var m;
      if (nUse > 0) m = matchKey(cls, o.entries, o.fabricLab ? { lab: o.fabricLab } : o.fabric, n, o.assign);
      else m = noKeyFabric(cls, o, n);
      return { cls: cls, m: m };
    }

    /** cluster result with class `drop` folded into class `into`, re-ordered largest first */
    function mergeClass(cl, drop, into, n) {
      var k = cl.k, cent = cl.cent, counts = cl.counts, i, c;
      var nn = counts[into] + counts[drop];
      var nc = new Float32Array(k * 3), cnt = new Int32Array(k);
      for (c = 0; c < k; c++) { nc[c * 3] = cent[c * 3]; nc[c * 3 + 1] = cent[c * 3 + 1]; nc[c * 3 + 2] = cent[c * 3 + 2]; cnt[c] = counts[c]; }
      for (var t = 0; t < 3; t++) nc[into * 3 + t] = (cent[into * 3 + t] * counts[into] + cent[drop * 3 + t] * counts[drop]) / Math.max(1, nn);
      cnt[into] = nn; cnt[drop] = 0;
      var order = [];
      for (c = 0; c < k; c++) if (cnt[c] > 0) order.push(c);
      order.sort(function (a, b) { return cnt[b] - cnt[a] || a - b; });
      var remap = new Int16Array(k);
      for (c = 0; c < k; c++) remap[c] = -1;
      var cent2 = new Float32Array(order.length * 3), counts2 = new Int32Array(order.length);
      for (i = 0; i < order.length; i++) {
        remap[order[i]] = i;
        cent2[i * 3] = nc[order[i] * 3]; cent2[i * 3 + 1] = nc[order[i] * 3 + 1]; cent2[i * 3 + 2] = nc[order[i] * 3 + 2];
        counts2[i] = cnt[order[i]];
      }
      remap[drop] = remap[into];
      var assign = new Int16Array(n);
      for (i = 0; i < n; i++) assign[i] = remap[cl.assign[i]];
      return { cent: cent2, k: order.length, assign: assign, counts: counts2, tooMany: cl.tooMany };
    }

    function noKeyFabric(cls, o, n) {
      var k = cls.length, entry = new Int32Array(k), how = [], dE = [], i;
      for (i = 0; i < k; i++) { entry[i] = -1; how.push(null); dE.push(null); }
      var fab = -1;
      var fixed = -1;
      if (o.assign) for (var ck in o.assign) if (o.assign.hasOwnProperty(ck) && o.assign[ck] === 'fabric') fixed = +ck;
      if (fixed >= 0 && fixed < k) fab = fixed;
      else if (o.fabric === 'none') fab = -1;
      else if (o.fabricLab) {
        var bd = 25;
        for (i = 0; i < k; i++) {
          var dd = de2000(cls[i].lab[0], cls[i].lab[1], cls[i].lab[2], o.fabricLab[0], o.fabricLab[1], o.fabricLab[2]);
          if (dd < bd) { bd = dd; fab = i; }
        }
      } else {
        /* the class that owns most of the border, when it owns a lot of it */
        var bb = -1, bv = 0;
        for (i = 0; i < k; i++) if (cls[i].border > bv) { bv = cls[i].border; bb = i; }
        if (bb >= 0 && bv >= 0.4 && cls[bb].n >= n * 0.1) fab = bb;
      }
      return { fabric: fab, entry: entry, how: how, dE: dE, cost: 0 };
    }

    /** How well a read agrees with the key's counts (lower is better). */
    function agreementCost(r, o, n) {
      var e = o.entries, cost = 0, any = false;
      var read = {};
      for (var c = 0; c < r.cls.length; c++) {
        var en = r.m.entry[c];
        if (en >= 0) read[en] = (read[en] || 0) + r.cls[c].n;
        else if (c !== r.m.fabric) cost += r.cls[c].n;   // stitches nobody claimed
      }
      for (var j = 0; j < e.length; j++) {
        if (!e[j].use || !(e[j].count > 0)) continue;
        any = true;
        cost += Math.abs((read[j] || 0) - e[j].count);
      }
      return any ? cost : null;
    }

    /* ================================================================ *
     * Style (reported; also routes 'auto' to the symbol reader)
     * ================================================================ */

    function styleOf(smp, cl, n, lat) {
      var cohSum = 0, spSum = 0, i;
      for (i = 0; i < n; i++) { cohSum += smp.coh[i]; spSum += smp.spread[i]; }
      var coh = cohSum / n, spread = spSum / n;
      /* achromatic two-tone with mixed squares: a symbol chart */
      var chroma = 0, big = 0;
      for (var c = 0; c < cl.k; c++) {
        if (cl.counts[c] < n * 0.01) continue;
        big++;
        var C = Math.sqrt(cl.cent[c * 3 + 1] * cl.cent[c * 3 + 1] + cl.cent[c * 3 + 2] * cl.cent[c * 3 + 2]);
        if (C > chroma) chroma = C;
      }
      /* a symbol chart: grey-only squares, and a good share of them carry
         dark marks over a light ground */
      var marked = 0;
      for (i = 0; i < n; i++) if (smp.ink[i] > 0.1 || (smp.lab[i * 3] < 50 && smp.coh[i] < 0.9)) marked++;
      /* classes come largest first: the ground must be paper-white (a
         chart of grey blocks, like a black-background game sprite, is a
         colour chart whose colours happen to be greys) */
      var paper = cl.k > 0 && cl.cent[0] > 85;
      if (chroma < 8 && paper && marked >= n * 0.03) return 'symbols-bw';
      if (spread > 6 && coh < 0.9 && lat.pitchX >= 4) {
        /* texture inside every square: stitched look, or symbols on colour */
        if (smp.gridDark > 12) return 'blocks-symbols';
        return 'stitched';
      }
      if (smp.gridDark > 8) return 'blocks-grid';
      if (spread > 4 && coh < 0.95) return 'blocks-symbols';
      return 'blocks';
    }

    /* ================================================================ *
     * The step machine
     * ================================================================ */

    var BANDS = { locate: [0, 15], lattice: [15, 35], sample: [35, 70], cluster: [70, 88], match: [88, 100] };
    function pctOf(phase, local) {
      var b = BANDS[phase] || [0, 100];
      return b[0] + (b[1] - b[0]) * clamp(local, 0, 1);
    }

    function fail(reason, message, extra) {
      var r = { ok: false, reason: reason, message: message };
      if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k];
      return r;
    }

    /**
     * createJob({ buf, w, h, opts }) -> { step() }
     * opts (already normalised on the main thread):
     *   kind 'read' | 'detect', crop, size, lattice, entries [{lab,count,use}],
     *   fabric 'auto'|'none', fabricLab, mode, maxColors, assign
     */
    function createJob(job) {
      var o = job.opts;
      var d = new Uint8ClampedArray(job.buf);
      var w = job.w, h = job.h;
      var st = {
        stage: 'locate', t0: now(), tPhase: now(),
        times: { locate: 0, lattice: 0, sample: 0, cluster: 0, match: 0 },
        warnings: []
      };
      function mark(phase) { var t = now(); st.times[phase] += t - st.tPhase; st.tPhase = t; }
      function addT(t) { if (!t) return; st.times.sample += t.sample; st.times.cluster += t.cluster; st.times.match += t.match; }
      function out(phase, local) { return { done: false, phase: phase, pct: pctOf(phase, local) }; }
      function done(res) {
        res.times = st.times;
        res.coreMs = now() - st.t0;
        res.warnings = st.warnings;
        st.stage = 'done';
        return { done: true, phase: 'match', pct: 100, result: res };
      }

      function step() {
        switch (st.stage) {
          case 'locate': {
            if (!(w > 0 && h > 0) || d.length < w * h * 4) return done(fail('no-image', 'There is no picture to read.'));
            if (w < 12 || h < 12) return done(fail('too-small', 'This picture is too small to read. Try a bigger picture of the chart.'));
            st.ground = groundOf(d, w, h);
            if (o.crop) {
              st.rect = { x: o.crop.x, y: o.crop.y, w: o.crop.w, h: o.crop.h };
              st.rectFrom = 'given';
            } else if (o.lattice && o.size) {
              st.rect = { x: o.lattice.x0, y: o.lattice.y0, w: o.lattice.pitchX * o.size.w, h: o.lattice.pitchY * o.size.h };
              st.rectFrom = 'lattice';
            } else {
              var rr = locate(d, w, h, st.ground, o.size);
              /* a full-bleed chart (no page around it): the whole picture */
              if (!rr || st.ground.share < 0.15) rr = { x: 0, y: 0, w: w, h: h, fill: 1, share: 1 };
              st.rect = rr;
              st.rectFrom = 'found';
              if (o.size && rr) {
                var aspD = o.size.w / o.size.h, aspR = rr.w / rr.h;
                if (Math.abs(aspR / aspD - 1) > 0.06) {
                  st.warnings.push('the chart area found is ' + Math.round(rr.w) + ' x ' + Math.round(rr.h) +
                    ' px, which does not have the shape of a ' + o.size.w + ' x ' + o.size.h + ' chart');
                  st.aspectOff = true;
                }
              }
            }
            mark('locate');
            st.stage = 'lattice';
            return out('locate', 1);
          }

          case 'lattice': {
            var L = findLattice(d, w, h, st.rect, o.size, o.lattice, o.kind === 'detect');
            if (!L.lat) {
              if (L.why === 'too-small') {
                return done(fail('too-small', 'The squares in this picture are too small to read (under 3 pixels each). Try a bigger picture, or zoom in on the chart before taking the screenshot.'));
              }
              return done(fail('no-grid', 'I could not find a grid of squares in this picture. Try cropping to just the chart, or type the chart size.'));
            }
            var pmin = Math.min(L.lat.pitchX, L.lat.pitchY);
            if (pmin < 3) {
              return done(fail('too-small', 'The squares in this picture are too small to read (about ' +
                (Math.round(pmin * 10) / 10) + ' pixels each). Try a bigger picture, or zoom in on the chart before taking the screenshot.',
                { crop: st.rect, lattice: L.lat, size: L.size }));
            }
            if (L.size.w * L.size.h > 1000000) {
              return done(fail('no-grid', 'The grid found would be ' + L.size.w + ' x ' + L.size.h + ' squares, which is not a real chart. Try cropping to just the chart, or type the chart size.'));
            }
            if (L.size.w < 2 || L.size.h < 2) {
              return done(fail('no-grid', 'I could not find a grid of squares in this picture. Try cropping to just the chart, or type the chart size.'));
            }
            if (st.aspectOff) L.conf = Math.round(L.conf * 0.6 * 100) / 100;
            st.L = L;
            if (st.rectFrom !== 'given') st.rect = { x: L.lat.x0, y: L.lat.y0, w: L.lat.pitchX * L.size.w, h: L.lat.pitchY * L.size.h };
            mark('lattice');
            if (o.kind === 'detect') {
              /* a quick style look on a thinned sample */
              var det = {
                ok: true, reason: null, message: null,
                crop: st.rect, lattice: L.lat, size: L.size, sizeSource: L.sizeSource,
                confidence: L.conf, alternatives: L.alternatives, style: 'unknown',
                debug: { perX: L.perX, perY: L.perY, combX: L.combX, combY: L.combY, ground: st.ground }
              };
              if (L.size.w * L.size.h <= 40000) {
                var sm = sampleCells(d, w, h, L.lat, L.size.w, L.size.h, null);
                var cq = cluster(sm.lab, L.size.w * L.size.h, 0, o.maxColors, sm.noise);
                det.style = styleOf(sm, cq, L.size.w * L.size.h, L.lat);
              }
              return done(det);
            }
            st.stage = 'sample';
            return out('lattice', 1);
          }

          case 'sample': {
            /* candidate lattices: the fitted one, and when the key prints
               counts, the same lattice nudged by a fraction of a square */
            var L2 = st.L, gw = L2.size.w, gh = L2.size.h;
            var cands = [L2.lat];
            var nUse = 0, counted = 0;
            for (var e = 0; e < o.entries.length; e++) {
              if (o.entries[e].use) { nUse++; if (o.entries[e].count > 0) counted++; }
            }
            st.counted = nUse > 0 && counted === nUse;
            /* a read that already agrees with the key to a few stitches in a
               thousand is not second-guessed by nudged lattices */
            var keyTot = 0;
            for (var e2 = 0; e2 < o.entries.length; e2++) if (o.entries[e2].use) keyTot += o.entries[e2].count || 0;
            st.okCost = Math.max(4, keyTot * 0.003);
            if (st.counted && L2.sizeSource !== 'user' && gw * gh <= 400000) {
              var fr = [-0.2, 0.2];
              for (var a = 0; a < fr.length; a++) {
                cands.push({ x0: L2.lat.x0 + fr[a] * L2.lat.pitchX, y0: L2.lat.y0, pitchX: L2.lat.pitchX, pitchY: L2.lat.pitchY });
                cands.push({ x0: L2.lat.x0, y0: L2.lat.y0 + fr[a] * L2.lat.pitchY, pitchX: L2.lat.pitchX, pitchY: L2.lat.pitchY });
              }
            }
            st.cands = cands;
            st.ci = 0;
            st.best = null;
            st.stage = 'readc';
            mark('sample');
            return out('sample', 0.05);
          }

          case 'readc': {
            var lat = st.cands[st.ci];
            var g2w = st.L.size.w, g2h = st.L.size.h;
            var useSymbols = o.mode === 'symbol';
            var r;
            if (!useSymbols) {
              r = readColour(d, w, h, lat, g2w, g2h, o);
              addT(r.t);
              r.lat = lat;
              r.style = styleOf(r.smp, r.cl, g2w * g2h, lat);
              /* a symbol in every square that covers its middle (a filled heart,
                 a bold diamond): read the square from the band round the
                 symbol instead. A stitched X has thread in the middle and
                 gaps at the sides, the other way about. */
              if (r.style !== 'symbols-bw' && Math.min(lat.pitchX, lat.pitchY) >= 9 &&
                  r.smp.centreInk > Math.max(0.08, r.smp.ringInk * 1.8)) {
                var rr2 = readColour(d, w, h, lat, g2w, g2h, o, true);
                addT(rr2.t);
                rr2.lat = lat; rr2.style = 'blocks-symbols'; rr2.ring = true;
                r = rr2;
              }
              if (o.mode === 'auto' && r.style === 'symbols-bw' && st.ci === 0) useSymbols = true;
            }
            if (useSymbols) {
              r = { lat: lat, symbols: true, style: 'symbols-bw' };
              st.symbolMode = true;
            }
            r.cost = (!r.symbols && st.counted) ? agreementCost(r, o, g2w * g2h) : null;
            if (!st.best || (r.cost !== null && st.best.cost !== null && r.cost < st.best.cost)) st.best = r;
            st.ci++;
            st.tPhase = now();
            if (st.symbolMode || st.ci >= st.cands.length || (st.best.cost !== null && st.best.cost <= st.okCost)) {
              st.stage = st.symbolMode ? 'symbols' : 'finish';
            }
            return out('sample', st.ci / st.cands.length);
          }

          case 'symbols': {
            var gw3 = st.L.size.w, gh3 = st.L.size.h, n3 = gw3 * gh3;
            var lat3 = st.best.lat;
            var sd = symbolDescriptors(d, w, h, lat3, gw3, gh3);
            var symN = 0, symMin = 0;
            for (var se = 0; se < o.entries.length; se++) {
              if (!o.entries[se].use) continue;
              symN++;
              if (o.entries[se].count > 0 && (!symMin || o.entries[se].count < symMin)) symMin = o.entries[se].count;
            }
            var cs = clusterShapes(sd.desc, sd.ink, n3, symN, symMin);
            if (cs.k > Math.max(o.maxColors, 1)) {
              return done(fail('too-many-colors', 'This chart seems to use ' + cs.k + ' different symbols, more than the ' + o.maxColors +
                ' I can sort out. Try a sharper or bigger picture.'));
            }
            var mm = matchByCount(cs.counts, cs.k, o.entries, o.assign);
            mark('cluster');
            var conf3 = new Uint8Array(n3), low3 = 0;
            for (var i3 = 0; i3 < n3; i3++) {
              var ik = sd.ink[i3];
              /* blank is sure when there is no ink at all; inked squares are
                 as sure as their ink is clear of the blank threshold */
              var v3 = cs.assign[i3] < 0 ? clamp(1 - ik / 0.03, 0, 1) : clamp((ik - 0.03) / 0.08, 0, 1);
              conf3[i3] = Math.round(v3 * 255);
              if (conf3[i3] < LOW_CONF) low3++;
            }
            var classes3 = [];
            for (var c3 = 0; c3 < cs.k; c3++) {
              classes3.push({ id: c3, count: cs.counts[c3], lab: null, entry: mm.entry[c3] >= 0 ? mm.entry[c3] : null,
                fabric: false, how: mm.how[c3], deltaE: null, rep: cs.rep[c3] });
            }
            var cells3 = new Int16Array(n3);
            for (i3 = 0; i3 < n3; i3++) cells3[i3] = cs.assign[i3];
            mark('match');
            return done({
              ok: true, mode: 'symbol', crop: st.rect, lattice: lat3, size: st.L.size, sizeSource: st.L.sizeSource,
              confidence: st.L.conf, alternatives: st.L.alternatives, style: 'symbols-bw',
              classOf: cells3, classes: classes3, fabricClass: -1, cellConf: conf3, lowCells: low3,
              ground: st.ground, glyphSrc: true
            });
          }

          case 'finish': {
            var b = st.best, gw4 = st.L.size.w, gh4 = st.L.size.h, n4 = gw4 * gh4;
            if (b.cl.tooMany) {
              return done(fail('too-many-colors', 'This picture has more than ' + o.maxColors + ' distinct colours, which is more than a chart' +
                ' usually has. If it is a photo, use "turn a photo into a chart" instead.'));

            }
            var cf = confidences(b.smp.lab, n4, b.cl.cent, b.cl.k, b.cl.assign, b.smp.coh);
            var classes = [];
            for (var c4 = 0; c4 < b.cl.k; c4++) {
              var rgb = labToRgb(b.cl.cent[c4 * 3], b.cl.cent[c4 * 3 + 1], b.cl.cent[c4 * 3 + 2]);
              /* the most typical square of the class, for its glyph */
              classes.push({
                id: c4, count: b.cl.counts[c4], rgb: rgb,
                lab: [b.cl.cent[c4 * 3], b.cl.cent[c4 * 3 + 1], b.cl.cent[c4 * 3 + 2]],
                entry: b.m.entry[c4] >= 0 ? b.m.entry[c4] : null,
                fabric: c4 === b.m.fabric, how: b.m.how[c4],
                deltaE: b.m.dE[c4] === null ? null : Math.round(b.m.dE[c4] * 10) / 10,
                rep: -1, border: b.cls[c4].border
              });
            }
            var repBest = new Float32Array(b.cl.k);
            for (var i4 = 0; i4 < n4; i4++) {
              var cc = b.cl.assign[i4];
              if (cf.conf[i4] >= repBest[cc]) {
                if (cf.conf[i4] > repBest[cc] || classes[cc].rep < 0) { repBest[cc] = cf.conf[i4]; classes[cc].rep = i4; }
              }
            }
            mark('match');
            return done({
              ok: true, mode: 'colour', crop: st.rect, lattice: b.lat, size: st.L.size, sizeSource: st.L.sizeSource,
              confidence: st.L.conf, alternatives: st.L.alternatives, style: b.style,
              classOf: b.cl.assign, classes: classes, fabricClass: b.m.fabric,
              cellConf: cf.conf, lowCells: cf.low, ground: st.ground,
              candidates: st.cands.length, candidateCost: b.cost, noise: b.smp.noise
            });
          }

          default:
            return done(fail('no-image', 'Nothing to read.'));
        }
      }
      return { step: step, state: st };
    }

    return {
      createJob: createJob,
      /* exposed for tests */
      labOf: labOf, labToRgb: labToRgb, de2000: de2000,
      groundOf: groundOf, locate: locate, axisProfile: axisProfile, periodOf: periodOf,
      combFit: combFit, lineExtent: lineExtent, crossTrim: crossTrim, fitRun: fitRun, bestComb: bestComb, findLattice: findLattice, sampleCells: sampleCells, cluster: cluster,
      wholeSquare: wholeSquare, shiftDiff: shiftDiff, overSegment: overSegment,
      hungarian: hungarian, matchKey: matchKey, symbolDescriptors: symbolDescriptors,
      clusterShapes: clusterShapes, matchByCount: matchByCount
    };
  }

  /* ================================================================== *
   * 2. The worker body — also stringified
   * ================================================================== */

  function xsrWorkerBody(core) {
    self.onmessage = function (ev) {
      var msg = ev.data || {};
      try {
        if (msg.t !== 'run') return;
        var job = core.createJob({ buf: msg.buf, w: msg.w, h: msg.h, opts: msg.opts });
        var r, lastPct = -1;
        for (;;) {
          r = job.step();
          var p = Math.round(r.pct);
          if (p !== lastPct) {
            lastPct = p;
            self.postMessage({ t: 'progress', id: msg.id, phase: r.phase, pct: p });
          }
          if (r.done) break;
        }
        var res = r.result, transfer = [];
        if (res.classOf && res.classOf.buffer) transfer.push(res.classOf.buffer);
        if (res.cellConf && res.cellConf.buffer) transfer.push(res.cellConf.buffer);
        self.postMessage({ t: 'done', id: msg.id, result: res }, transfer);
      } catch (e) {
        self.postMessage({ t: 'error', id: msg.id, error: (e && e.message) ? e.message : String(e) });
      }
    };
  }

  /* ================================================================== *
   * 3. Worker plumbing (as in xstitch-photo.js)
   * ================================================================== */

  var workerSrc = null, workerUrl = null, worker = null;
  var running = null, queue = [];

  function buildWorkerSrc() {
    if (workerSrc) return workerSrc;
    workerSrc = ["'use strict';", String(XSReadCore), String(xsrWorkerBody), 'xsrWorkerBody(XSReadCore());'].join('\n');
    return workerSrc;
  }

  function workerSupported() {
    return typeof W.Worker === 'function' && typeof W.Blob === 'function' && !!(W.URL && W.URL.createObjectURL);
  }

  function isAvailable() {
    return typeof document !== 'undefined' && typeof W.Uint8ClampedArray === 'function' && !!W.XStitch;
  }

  function getWorker() {
    if (worker) return worker;
    if (!workerSupported()) return null;
    try {
      if (!workerUrl) workerUrl = W.URL.createObjectURL(new W.Blob([buildWorkerSrc()], { type: 'text/javascript' }));
      worker = new W.Worker(workerUrl);
      worker.onmessage = onWorkerMessage;
      worker.onerror = onWorkerError;
    } catch (e) {
      worker = null;
      return null;
    }
    return worker;
  }

  function killWorker() {
    if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } }
    worker = null;
  }

  function onWorkerError() {
    var job = running;
    killWorker();
    running = null;
    if (job && !job.settled) job.failWorker('worker failed');
    else pump();
  }

  function onWorkerMessage(ev) {
    var msg = ev.data || {};
    var job = running;
    if (!job || job.id !== msg.id) return;
    if (msg.t === 'progress') { job.emitCore(msg.phase, msg.pct); return; }
    if (msg.t === 'done') { running = null; job.finish(msg.result); pump(); return; }
    if (msg.t === 'error') { running = null; job.failWorker(msg.error || 'worker error'); pump(); }
  }

  function pump() {
    if (running || !queue.length) return;
    var job = queue.shift();
    if (job.cancelled) { job.resolveCancelled(); pump(); return; }
    var wk = getWorker();
    if (!wk) { job.failWorker('no worker'); pump(); return; }
    running = job;
    try {
      /* the main-thread fallback needs the pixels if the worker dies, so
         post a copy rather than transferring the only one */
      var copy = job.px.buf.slice(0);
      wk.postMessage({ t: 'run', id: job.id, buf: copy, w: job.px.w, h: job.px.h, opts: job.core }, [copy]);
    } catch (e) {
      running = null;
      job.failWorker('postMessage failed');
      pump();
    }
  }

  /* ================================================================== *
   * 4. Decode (main thread)
   * ================================================================== */

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function numOr(v, dflt) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v !== '' && isFinite(+v)) return +v;
    return dflt;
  }
  function isCanvas(v) {
    return !!v && typeof v === 'object' &&
      ((typeof W.HTMLCanvasElement === 'function' && v instanceof W.HTMLCanvasElement) ||
       (typeof W.OffscreenCanvas === 'function' && v instanceof W.OffscreenCanvas) ||
       (typeof v.getContext === 'function' && typeof v.width === 'number'));
  }
  function isImageEl(v) { return !!v && typeof W.HTMLImageElement === 'function' && v instanceof W.HTMLImageElement; }
  function isBitmap(v) { return !!v && typeof W.ImageBitmap === 'function' && v instanceof W.ImageBitmap; }
  function isImageData(v) {
    return !!v && ((typeof W.ImageData === 'function' && v instanceof W.ImageData) ||
      (typeof v.width === 'number' && typeof v.height === 'number' && v.data && typeof v.data.length === 'number' && !v.getContext));
  }
  function isBlobLike(v) {
    return !!v && ((typeof W.Blob === 'function' && v instanceof W.Blob) || (typeof W.File === 'function' && v instanceof W.File));
  }

  /** source -> Promise<{ buf, w, h, scale }>: RGBA over white, drawn down past MAX_PIXELS */
  function toPixels(source) {
    return new Promise(function (resolve, reject) {
      if (!source) { reject(new Error('no-image')); return; }
      if (isImageData(source) && !isCanvas(source)) {
        var iw = source.width, ih = source.height;
        if (!iw || !ih) { reject(new Error('no-image')); return; }
        if (iw * ih <= MAX_PIXELS) {
          /* composite over white so transparency reads as paper */
          var src = source.data, out = new Uint8ClampedArray(iw * ih * 4);
          for (var i = 0; i < out.length; i += 4) {
            var a = src[i + 3];
            if (a === 255) { out[i] = src[i]; out[i + 1] = src[i + 1]; out[i + 2] = src[i + 2]; }
            else {
              var f = a / 255;
              out[i] = Math.round(src[i] * f + 255 * (1 - f));
              out[i + 1] = Math.round(src[i + 1] * f + 255 * (1 - f));
              out[i + 2] = Math.round(src[i + 2] * f + 255 * (1 - f));
            }
            out[i + 3] = 255;
          }
          resolve({ buf: out.buffer, w: iw, h: ih, scale: 1 });
          return;
        }
        var cv0 = document.createElement('canvas');
        cv0.width = iw; cv0.height = ih;
        cv0.getContext('2d').putImageData(source, 0, 0);
        draw(cv0, iw, ih);
        return;
      }
      if (isBitmap(source) || isCanvas(source)) {
        if (!source.width || !source.height) { reject(new Error('no-image')); return; }
        draw(source, source.width, source.height);
        return;
      }
      if (isImageEl(source)) {
        var nw = source.naturalWidth || source.width, nh = source.naturalHeight || source.height;
        if (!nw || !nh) { reject(new Error('no-image')); return; }
        draw(source, nw, nh);
        return;
      }
      if (isBlobLike(source)) {
        var name = source.name ? String(source.name) : '';
        /* servers and pickers often say octet-stream for an image: only a
           type that is clearly something else is refused up front */
        if (source.type && /^(application\/(pdf|json|zip|x-zip)|text\/)/i.test(String(source.type)) &&
            !/\.(png|jpe?g|gif|webp|bmp)$/i.test(name)) {
          reject(new Error('not-image'));
          return;
        }
        if (typeof W.createImageBitmap === 'function') {
          W.createImageBitmap(source).then(function (bmp) {
            try { draw(bmp, bmp.width, bmp.height); } finally { try { bmp.close(); } catch (e) { /* ignore */ } }
          }, function () { viaImg(source); });
          return;
        }
        viaImg(source);
        return;
      }
      reject(new Error('no-image'));

      function viaImg(blob) {
        var url;
        try { url = W.URL.createObjectURL(blob); } catch (e) { reject(new Error('decode')); return; }
        var img = new W.Image();
        img.onload = function () {
          try { draw(img, img.naturalWidth || img.width, img.naturalHeight || img.height); }
          finally { try { W.URL.revokeObjectURL(url); } catch (e2) { /* ignore */ } }
        };
        img.onerror = function () { try { W.URL.revokeObjectURL(url); } catch (e3) { /* ignore */ } reject(new Error('decode')); };
        img.src = url;
      }

      function draw(node, sw, sh) {
        if (!sw || !sh) { reject(new Error('no-image')); return; }
        var s = 1;
        if (sw * sh > MAX_PIXELS) s = Math.sqrt(MAX_PIXELS / (sw * sh));
        var tw = Math.max(1, Math.round(sw * s)), th = Math.max(1, Math.round(sh * s));
        var cv = document.createElement('canvas');
        cv.width = tw; cv.height = th;
        var ctx = cv.getContext('2d');
        if (!ctx) { reject(new Error('decode')); return; }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, tw, th);
        try { ctx.imageSmoothingEnabled = true; if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high'; } catch (e) { /* ignore */ }
        ctx.drawImage(node, 0, 0, sw, sh, 0, 0, tw, th);
        var id = ctx.getImageData(0, 0, tw, th);
        resolve({ buf: id.data.buffer, w: tw, h: th, scale: tw / sw });
      }
    });
  }

  /* ================================================================== *
   * 5. Options
   * ================================================================== */

  function hexToLabMain(hex) {
    var XS = W.XStitch;
    if (!hex || !XS || typeof XS.hexToLab !== 'function') return null;
    try {
      var l = XS.hexToLab(String(hex).replace(/^#?/, '#'));
      return l && isFinite(l[0]) ? [l[0], l[1], l[2]] : null;
    } catch (e) { return null; }
  }

  function entryHex(e) {
    var hx = e && e.hex ? String(e.hex).replace(/^#/, '') : '';
    if (/^[0-9a-fA-F]{6}$/.test(hx)) return hx.toLowerCase();
    var XS = W.XStitch;
    if (XS && typeof XS.hexFor === 'function' && e && e.code) {
      try {
        var h = XS.hexFor(e.brand || 'DMC', String(e.code));
        if (!h && /^0\d$/.test(String(e.code))) h = XS.hexFor(e.brand || 'DMC', String(e.code).replace(/^0/, ''));
        if (h) return String(h).replace(/^#/, '').toLowerCase();
      } catch (er) { /* ignore */ }
    }
    return null;
  }

  /** The key entries the reader matches against: full crosses only. */
  function isCrossEntry(e) {
    if (!isObj(e)) return false;
    var k = e.kind || e.section || 'cross';
    return k === 'cross' || k === 'full' || k === 'crosses';
  }

  function normOpts(raw, srcScale) {
    raw = isObj(raw) ? raw : {};
    var s = srcScale || 1;
    function scaleRect(c) {
      if (!isObj(c)) return null;
      var x = numOr(c.x, NaN), y = numOr(c.y, NaN), w = numOr(c.w, NaN), h = numOr(c.h, NaN);
      if (!(w > 0 && h > 0 && isFinite(x) && isFinite(y))) return null;
      return { x: x * s, y: y * s, w: w * s, h: h * s };
    }
    var size = null;
    if (isObj(raw.size)) {
      var sw = Math.round(numOr(raw.size.w, 0)), sh = Math.round(numOr(raw.size.h, 0));
      if (sw >= 2 && sh >= 2 && sw <= 2000 && sh <= 2000) size = { w: sw, h: sh };
    }
    var lattice = null;
    if (isObj(raw.lattice)) {
      var lx = numOr(raw.lattice.x0, NaN), ly = numOr(raw.lattice.y0, NaN);
      var lpx = numOr(raw.lattice.pitchX, NaN), lpy = numOr(raw.lattice.pitchY, NaN);
      if (isFinite(lx) && isFinite(ly) && lpx > 0 && lpy > 0) lattice = { x0: lx * s, y0: ly * s, pitchX: lpx * s, pitchY: lpy * s };
    }
    var entries = [], keyIn = Array.isArray(raw.key) ? raw.key : (isObj(raw.key) && Array.isArray(raw.key.entries) ? raw.key.entries : []);
    for (var i = 0; i < keyIn.length; i++) {
      var e = keyIn[i];
      var use = isCrossEntry(e);
      var hx = use ? entryHex(e) : null;
      var cnt = e && (e.stitchCount !== undefined ? e.stitchCount : e.stitches);
      cnt = numOr(cnt, 0);
      entries.push({ lab: hx ? hexToLabMain(hx) : null, count: cnt > 0 ? Math.round(cnt) : 0, use: use });
    }
    var fabric = 'auto', fabricLab = null;
    if (raw.fabric === 'none') fabric = 'none';
    else if (typeof raw.fabric === 'string' && /^#?[0-9a-fA-F]{6}$/.test(raw.fabric)) {
      fabric = 'colour';
      fabricLab = hexToLabMain(raw.fabric);
      if (!fabricLab) fabric = 'auto';
    }
    var mode = raw.mode === 'colour' || raw.mode === 'color' ? 'colour' : (raw.mode === 'symbol' ? 'symbol' : 'auto');
    var assign = null;
    if (isObj(raw.assign)) {
      assign = {};
      for (var k in raw.assign) {
        if (!raw.assign.hasOwnProperty(k)) continue;
        var v = raw.assign[k];
        if (v === 'fabric') assign[k] = 'fabric';
        else if (typeof v === 'number' && v >= 0) assign[k] = v;
        else if (typeof v === 'string' && /^\d+$/.test(v)) assign[k] = +v;
      }
    }
    var maxColors = Math.round(numOr(raw.maxColors, 60));
    if (maxColors < 2) maxColors = 2;
    if (maxColors > 256) maxColors = 256;
    return {
      crop: scaleRect(raw.crop), size: size, lattice: lattice, entries: entries,
      fabric: fabric, fabricLab: fabricLab, mode: mode, maxColors: maxColors, assign: assign,
      noWorker: !!raw.noWorker
    };
  }

  /* ================================================================== *
   * 6. Assembling the Result (main thread)
   * ================================================================== */

  function codeNorm(c) { return String(c == null ? '' : c).trim().toLowerCase().replace(/^0+(?=\d)/, ''); }
  function hex2(n) { var s = n.toString(16); return s.length < 2 ? '0' + s : s; }
  function rgbHex(rgb) { return hex2(rgb[0]) + hex2(rgb[1]) + hex2(rgb[2]); }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function unscaleRect(r, s) {
    if (!r) return null;
    return { x: r.x / s, y: r.y / s, w: r.w / s, h: r.h / s };
  }
  function unscaleLat(l, s) {
    if (!l) return null;
    return { x0: l.x0 / s, y0: l.y0 / s, pitchX: l.pitchX / s, pitchY: l.pitchY / s };
  }

  /** §3 Check, from per-entry read counts. */
  function buildCheck(keyIn, readByEntry, unmatchedClasses, readTotal) {
    var rows = [], hasCounts = false, expectedTotal = 0, unmatchedEntries = [];
    var exact = true, close = true, agreeSum = 0, i;
    var okN = 0, rowsWith = 0, worst = null;
    for (i = 0; i < keyIn.length; i++) {
      var e = keyIn[i];
      if (!isCrossEntry(e)) continue;
      var exp = numOr(e.stitchCount !== undefined ? e.stitchCount : e.stitches, NaN);
      exp = exp > 0 ? Math.round(exp) : null;
      var read = readByEntry[i] || 0;
      var row = {
        entry: i, code: String(e.code || ''), brand: e.brand || 'DMC', name: e.name || '',
        hex: entryHex(e), read: read, expected: exp, delta: null, pct: null, ok: null
      };
      if (exp !== null) {
        hasCounts = true;
        rowsWith++;
        expectedTotal += exp;
        row.delta = read - exp;
        row.pct = Math.round((read - exp) / exp * 1000) / 10;
        var tol = Math.max(2, exp * 0.01);
        row.ok = Math.abs(read - exp) <= tol;
        if (read !== exp) exact = false;
        if (!row.ok) close = false;
        if (row.ok) okN++;
        agreeSum += Math.min(read, exp);
        if (!row.ok && (!worst || Math.abs(row.delta) > Math.abs(worst.delta))) worst = row;
      }
      if (!read) unmatchedEntries.push(i);
      rows.push(row);
    }
    var verdict = !hasCounts ? 'unchecked' : (exact && !unmatchedClasses ? 'exact' : (close ? 'close' : 'off'));
    var summary;
    var label = function (r) { return (r.brand ? r.brand + ' ' : '') + r.code; };
    if (!hasCounts) {
      summary = 'Read ' + fmt(readTotal) + ' stitches. The key gives no stitch counts to check them against.';
    } else if (verdict === 'exact') {
      summary = 'All ' + rowsWith + ' colours match the key exactly (' + fmt(expectedTotal) + ' stitches).';
    } else if (verdict === 'close') {
      summary = 'All ' + rowsWith + ' colours are within 1% of the key (' + fmt(readTotal) + ' of ' + fmt(expectedTotal) + ' stitches).';
    } else {
      summary = okN + ' of ' + rowsWith + ' colours match' + (worst ? '; ' + label(worst) + ' reads ' + fmt(worst.read) + ' of ' + fmt(worst.expected) + '.' : '.');
    }
    if (unmatchedClasses) {
      summary += ' ' + unmatchedClasses + (unmatchedClasses === 1 ? ' colour in the picture is' : ' colours in the picture are') + ' not in the key yet.';
    }
    return {
      hasCounts: hasCounts, rows: rows, unmatchedEntries: unmatchedEntries, unmatchedClasses: unmatchedClasses,
      readTotal: readTotal, expectedTotal: hasCounts ? expectedTotal : null, exact: hasCounts && exact && !unmatchedClasses,
      agree: hasCounts && expectedTotal ? Math.round(agreeSum / expectedTotal * 1000) / 1000 : 0,
      verdict: verdict, summary: summary
    };
  }

  function glyphOf(px, cellIdx, gw, lat, size) {
    if (cellIdx < 0 || !px) return null;
    var cx = cellIdx % gw, cy = (cellIdx / gw) | 0;
    var x0 = lat.x0 + cx * lat.pitchX, y0 = lat.y0 + cy * lat.pitchY;
    var G = Math.max(4, Math.min(32, Math.round(Math.max(lat.pitchX, lat.pitchY))));
    var out = new Uint8ClampedArray(G * G * 4);
    var data = new Uint8ClampedArray(px.buf);
    for (var y = 0; y < G; y++) {
      for (var x = 0; x < G; x++) {
        var sx = Math.floor(x0 + (x + 0.5) / G * lat.pitchX), sy = Math.floor(y0 + (y + 0.5) / G * lat.pitchY);
        if (sx < 0) sx = 0; if (sy < 0) sy = 0; if (sx >= px.w) sx = px.w - 1; if (sy >= px.h) sy = px.h - 1;
        var o = (sy * px.w + sx) * 4, q = (y * G + x) * 4;
        out[q] = data[o]; out[q + 1] = data[o + 1]; out[q + 2] = data[o + 2]; out[q + 3] = 255;
      }
    }
    return { w: G, h: G, data: out };
  }

  function buildPreview(cells, w, h, palette) {
    var s = Math.max(1, Math.min(4, Math.floor(1200 / Math.max(w, h))));
    var pw = w * s, ph = h * s;
    var arr = new Uint8ClampedArray(pw * ph * 4);
    var rgb = [], i;
    for (i = 0; i < palette.length; i++) {
      var hx = palette[i].hex || '808080';
      rgb.push([parseInt(hx.slice(0, 2), 16), parseInt(hx.slice(2, 4), 16), parseInt(hx.slice(4, 6), 16)]);
    }
    for (var y = 0; y < ph; y++) {
      for (var x = 0; x < pw; x++) {
        var v = cells[((y / s) | 0) * w + ((x / s) | 0)];
        var c = (v >= 0 && rgb[v]) ? rgb[v] : [255, 255, 255];
        var o = (y * pw + x) * 4;
        arr[o] = c[0]; arr[o + 1] = c[1]; arr[o + 2] = c[2]; arr[o + 3] = 255;
      }
    }
    return { w: pw, h: ph, data: arr, scale: s };
  }

  function assemble(core, rawOpts, px, t) {
    var XS = W.XStitch;
    var s = px.scale || 1;
    var keyIn = Array.isArray(rawOpts.key) ? rawOpts.key : (isObj(rawOpts.key) && Array.isArray(rawOpts.key.entries) ? rawOpts.key.entries : []);
    var gw = core.size.w, gh = core.size.h, n = gw * gh, i;
    var warnings = (core.warnings || []).slice();
    var strands = 2;
    if (isObj(rawOpts.key) && rawOpts.key.strandsDefault) strands = rawOpts.key.strandsDefault;

    /* palette: every key entry first (index = entry index), then one per
       unmatched class (nearest DMC) */
    var palette = [], palOfClass = [], c;
    for (i = 0; i < keyIn.length; i++) {
      var e = keyIn[i] || {};
      palette.push({
        i: i, symbol: e.symbol || '', brand: e.brand || 'DMC', code: String(e.code || ''), name: e.name || '',
        hex: entryHex(e), strands: e.strands || strands, kind: isCrossEntry(e) ? 'cross' : (e.kind || 'cross'),
        stitchCount: 0, skeins: e.skeins || 0
      });
    }
    var classes = [];
    var takenCodes = {};
    for (i = 0; i < keyIn.length; i++) if (keyIn[i] && keyIn[i].code) takenCodes[codeNorm(keyIn[i].code)] = true;
    var unmatched = 0;
    for (c = 0; c < core.classes.length; c++) {
      var k = core.classes[c];
      var hex = k.rgb ? rgbHex(k.rgb) : null;
      var cl = {
        id: k.id, count: k.count, hex: hex, entry: k.entry, fabric: !!k.fabric, how: k.how || null,
        deltaE: k.deltaE === undefined ? null : k.deltaE, glyph: null
      };
      var pi = -1;
      if (cl.fabric) pi = -1;
      else if (cl.entry !== null && cl.entry !== undefined) pi = cl.entry;
      else {
        /* nothing in the key for it: name it by the nearest DMC that no key
           row and no other class has taken (two colours in the picture stay
           two flosses), never silently */
        var near = null;
        if (k.lab && XS && typeof XS.nearestFloss === 'function') {
          var list = [];
          try { list = XS.nearestFloss({ lab: k.lab }, { limit: 12 }) || []; } catch (er) { list = []; }
          for (var li = 0; li < list.length && !near; li++) if (!takenCodes[codeNorm(list[li].code)]) near = list[li];
          if (!near && list.length) near = list[0];
        }
        if (near) takenCodes[codeNorm(near.code)] = true;
        pi = palette.length;
        palette.push({
          i: pi, symbol: '', brand: 'DMC', code: near ? near.code : '', name: near ? near.name : 'Unknown colour',
          hex: near ? near.hex : (hex || '808080'), strands: strands, kind: 'cross', stitchCount: 0, skeins: 0
        });
        if (!keyIn.length) {
          cl.how = 'nearest-dmc';
          cl.deltaE = near ? Math.round(near.de * 10) / 10 : null;
        } else {
          unmatched++;
        }
        if (core.mode === 'symbol' && !near) palette[pi].name = 'Symbol ' + (c + 1);
      }
      palOfClass.push(pi);
      if (core.mode === 'symbol' || cl.entry === null || cl.entry === undefined) {
        cl.glyph = glyphOf(px, k.rep, gw, core.lattice, core.size);
      }
      classes.push(cl);
    }
    var cells = new Int16Array(n);
    var counts = [];
    for (i = 0; i < palette.length; i++) counts.push(0);
    for (i = 0; i < n; i++) {
      var cc = core.classOf[i];
      var p = cc >= 0 ? palOfClass[cc] : -1;
      cells[i] = p;
      if (p >= 0) counts[p]++;
    }
    for (i = 0; i < palette.length; i++) palette[i].stitchCount = counts[i];
    /* drop key-less placeholder rows nobody uses? No: the key's rows stay so
       indices line up; unused extra rows cannot exist (made on demand). */
    if (XS && typeof XS.assignSymbols === 'function') {
      var needSym = false;
      for (i = 0; i < palette.length; i++) if (!palette[i].symbol) needSym = true;
      if (needSym) {
        var keep = [];
        for (i = 0; i < palette.length; i++) keep.push(palette[i].symbol);
        XS.assignSymbols(palette);
        for (i = 0; i < palette.length; i++) if (keep[i]) palette[i].symbol = keep[i];
      }
    }
    var readTotal = 0;
    for (i = 0; i < n; i++) if (cells[i] >= 0) readTotal++;
    var readByEntry = {};
    for (i = 0; i < keyIn.length; i++) readByEntry[i] = counts[i] || 0;
    var check = buildCheck(keyIn, readByEntry, unmatched, readTotal);

    var data = null;
    if (XS && typeof XS.normalize === 'function') {
      try {
        data = XS.normalize({
          v: 1,
          design: { w: gw, h: gh, title: (isObj(rawOpts.key) && rawOpts.key.title) || '', designer: '', copyright: '' },
          fabric: (isObj(rawOpts.key) && isObj(rawOpts.key.fabric)) ? rawOpts.key.fabric : {},
          strandsDefault: strands,
          palette: palette,
          chart: { w: gw, h: gh, cells: XS.packCells(cells, gw, gh), part: [], back: [], knots: [] },
          source: { kind: 'picture', importedAt: Date.now(), warnings: warnings.slice(),
            check: { verdict: check.verdict, summary: check.summary, readTotal: check.readTotal, expectedTotal: check.expectedTotal } }
        }, null);
      } catch (e2) {
        warnings.push('the chart could not be packed (' + ((e2 && e2.message) || 'error') + ')');
        data = null;
      }
    }

    /* one Check for both producers: the key module's own checkCounts when it
       is there (it matches palette rows to key rows by code, and every extra
       palette row here has a code no key row uses), this file's otherwise */
    if (data && keyIn.length && XS && typeof XS.checkCounts === 'function') {
      try {
        var kc = XS.checkCounts(data, keyIn);
        if (kc && Array.isArray(kc.rows) && typeof kc.verdict === 'string') {
          check = kc;
          if (data.source) data.source.check = { verdict: kc.verdict, summary: kc.summary, readTotal: kc.readTotal, expectedTotal: kc.expectedTotal };
        }
      } catch (e3) { /* keep the local check */ }
    }

    if (core.lowCells > n * 0.05) warnings.push(fmt(core.lowCells) + ' squares are unsure');
    if (unmatched) warnings.push(unmatched + (unmatched === 1 ? ' colour is' : ' colours are') + ' not matched to the key');
    if (core.confidence < 0.5) warnings.push('the grid of squares is not clear in this picture');

    var preview = buildPreview(cells, gw, gh, data ? data.palette : palette);
    var times = core.times || {};
    var r1 = function (v) { return Math.round((v || 0) * 10) / 10; };
    return {
      ok: true, reason: null, message: null,
      crop: unscaleRect(core.crop, s), lattice: unscaleLat(core.lattice, s),
      size: { w: gw, h: gh }, sizeSource: core.sizeSource, confidence: core.confidence,
      alternatives: core.alternatives || [], style: core.style || 'unknown',
      ms: 0,
      data: data, cells: cells, classes: classes, check: check,
      cellConf: core.cellConf, lowCells: core.lowCells, preview: preview,
      stats: {
        ms: 0, worker: !!t.worker, colors: classes.length, mode: core.mode,
        phases: { decode: r1(t.decode), locate: r1(times.locate), lattice: r1(times.lattice), sample: r1(times.sample),
          cluster: r1(times.cluster), match: r1(times.match), assemble: 0 },
        candidates: core.candidates || 1, noise: core.noise === undefined ? null : Math.round(core.noise * 100) / 100, warnings: warnings, scale: s
      }
    };
  }

  /* ================================================================== *
   * 7. read() / detect()
   * ================================================================== */

  var seq = 0, jobs = {}, mainCore = null;

  function getMainCore() {
    if (!mainCore) mainCore = XSReadCore();
    return mainCore;
  }
  function nowMs() {
    return (typeof performance !== 'undefined' && performance && performance.now) ? performance.now() : Date.now();
  }

  var MSG = {
    'no-image': 'There is no picture to read.',
    'not-image': 'That file is not a picture. Choose a PNG, JPEG or WebP image of the chart.',
    'decode': 'That picture could not be opened. Try saving it as a PNG or JPEG and pick it again.',
    'cancelled': 'Stopped.'
  };

  function run(kind, source, opts, onProgress) {
    var raw = isObj(opts) ? opts : {};
    var token = raw.token ? String(raw.token) : ('xsr' + (++seq));
    var settle = null;
    var promise = new Promise(function (resolve) { settle = resolve; });
    promise.token = token;

    var job = {
      id: token, token: token, kind: kind, cancelled: false, settled: false,
      px: null, core: null, timer: null, t0: nowMs(), t: { decode: 0, worker: false },
      emit: function (phase, pct) {
        if (typeof onProgress !== 'function' || job.settled) return;
        try { onProgress({ phase: phase, pct: Math.max(0, Math.min(100, Math.round(pct))) }); } catch (e) { /* ignore */ }
      },
      emitCore: function (phase, pct) { job.emit(phase, 8 + pct * 0.88); },
      done: function (res) {
        if (job.settled) return;
        job.settled = true;
        delete jobs[token];
        res.token = token;
        settle(res);
      },
      resolveCancelled: function () { job.done({ ok: false, reason: 'cancelled', message: MSG.cancelled }); },
      fail: function (reason, message) {
        job.done({ ok: false, reason: reason, message: message || MSG[reason] || 'That picture could not be read.' });
      },
      failWorker: function (msg) {
        if (job.cancelled) { job.resolveCancelled(); return; }
        if (!job.px || !job.px.buf) { job.fail('no-image', 'That picture could not be read (' + msg + ').'); return; }
        job.workerNote = 'read on the main thread (' + msg + ')';
        job.t.worker = false;
        runOnMain(job);
      },
      finish: function (res) {
        if (job.cancelled) { job.resolveCancelled(); return; }
        try {
          var out = finishResult(job, res, raw);
          job.emit('match', 100);
          job.done(out);
        } catch (e) {
          job.fail('no-image', 'That picture could not be read (' + ((e && e.message) || 'error') + ').');
        }
      }
    };
    jobs[token] = job;

    if (!W.XStitch) { job.fail('no-image', 'The cross-stitch module is not loaded.'); return promise; }
    job.emit('decode', 1);
    toPixels(source).then(function (px) {
      if (job.cancelled) { job.resolveCancelled(); return; }
      job.px = px;
      job.t.decode = nowMs() - job.t0;
      var o = normOpts(raw, px.scale);
      o.kind = kind;
      job.core = o;
      job.emit('decode', 8);
      if (!o.noWorker && workerSupported() && getWorker()) {
        job.t.worker = true;
        queue.push(job);
        pump();
      } else {
        job.t.worker = false;
        runOnMain(job);
      }
    }, function (err) {
      if (job.cancelled) { job.resolveCancelled(); return; }
      var why = err && err.message;
      job.fail(why === 'not-image' ? 'no-image' : 'no-image', MSG[why] || MSG['no-image']);
    })['catch'](function (e) {
      job.fail('no-image', 'That picture could not be read (' + ((e && e.message) || 'error') + ').');
    });
    return promise;
  }

  function finishResult(job, res, raw) {
    var s = job.px.scale || 1;
    var ms = Math.round((nowMs() - job.t0) * 10) / 10;
    if (!res || !res.ok) {
      var f = { ok: false, reason: (res && res.reason) || 'no-grid', message: (res && res.message) || 'That picture could not be read.' };
      if (res && res.crop) f.crop = unscaleRect(res.crop, s);
      if (res && res.lattice) f.lattice = unscaleLat(res.lattice, s);
      if (res && res.size) f.size = res.size;
      f.ms = ms;
      return f;
    }
    if (job.kind === 'detect') {
      return {
        ok: true, reason: null, message: null,
        crop: unscaleRect(res.crop, s), lattice: unscaleLat(res.lattice, s),
        size: res.size, sizeSource: res.sizeSource, confidence: res.confidence,
        alternatives: res.alternatives || [], style: res.style, ms: ms,
        stats: { worker: !!job.t.worker, warnings: (res.warnings || []).slice(), debug: res.debug || null }
      };
    }
    var tA = nowMs();
    var out = assemble(res, raw, job.px, job.t);
    out.stats.phases.assemble = Math.round((nowMs() - tA) * 10) / 10;
    if (job.workerNote) out.stats.warnings.push(job.workerNote);
    out.ms = out.stats.ms = Math.round((nowMs() - job.t0) * 10) / 10;
    return out;
  }

  function runOnMain(job) {
    var core = getMainCore(), runner;
    try {
      runner = core.createJob({ buf: job.px.buf.slice(0), w: job.px.w, h: job.px.h, opts: job.core });
    } catch (e) {
      job.fail('no-image', 'That picture could not be read (' + ((e && e.message) || 'error') + ').');
      return;
    }
    function tick() {
      job.timer = null;
      if (job.cancelled) { job.resolveCancelled(); return; }
      var r;
      try { r = runner.step(); } catch (e) {
        job.fail('no-image', 'That picture could not be read (' + ((e && e.message) || 'error') + ').');
        return;
      }
      job.emitCore(r.phase, r.pct);
      if (r.done) { job.finish(r.result); return; }
      job.timer = W.setTimeout(tick, 0);
    }
    job.timer = W.setTimeout(tick, 0);
  }

  /**
   * cancel(token) -> boolean. No token cancels everything in flight. A
   * running worker job is terminated (the worker is rebuilt next time).
   */
  function cancel(token) {
    var ids = [];
    if (token === undefined || token === null || token === '') {
      for (var k in jobs) if (jobs.hasOwnProperty(k)) ids.push(k);
    } else {
      var t = (typeof token === 'object' && token && token.token) ? String(token.token) : String(token);
      if (jobs[t]) ids.push(t);
    }
    if (!ids.length) return false;
    for (var i = 0; i < ids.length; i++) {
      var job = jobs[ids[i]];
      if (!job || job.settled) continue;
      job.cancelled = true;
      if (job.timer) { W.clearTimeout(job.timer); job.timer = null; }
      if (running === job) { killWorker(); running = null; }
      for (var q = queue.length - 1; q >= 0; q--) if (queue[q] === job) queue.splice(q, 1);
      job.resolveCancelled();
    }
    pump();
    return true;
  }

  function read(source, opts, onProgress) {
    try { return run('read', source, opts, onProgress); }
    catch (e) { return Promise.resolve({ ok: false, reason: 'no-image', message: 'That picture could not be read.' }); }
  }
  function detect(source, opts) {
    try { return run('detect', source, opts, null); }
    catch (e) { return Promise.resolve({ ok: false, reason: 'no-image', message: 'That picture could not be read.' }); }
  }

  W.XSRead = {
    version: VERSION,
    isAvailable: isAvailable,
    read: read,
    detect: detect,
    cancel: cancel,

    /* test/debug surface — not part of the contract */
    _core: XSReadCore,
    _workerSrc: buildWorkerSrc,
    _normOpts: normOpts,
    _buildCheck: buildCheck,
    LOW_CONF: 90
  };

})();
