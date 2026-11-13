'use strict';
/* =====================================================================
 * xstitch-keyread.js — window.XSKeyRead
 *
 * Read a cross-stitch colour KEY that is a picture (a screenshot, an
 * image-only PDF page, a JPEG key panel) with no text-recognition engine.
 * Narrow and exact-or-blank: a row's floss code is given only when the
 * page's own glyphs, the floss table, the printed swatch and (when given)
 * the chart's own counts agree on it. Otherwise the row is a partial
 * ("9?5", candidates listed) or blank. Never a guessed code.
 * Contract: docs/wave-k/api/xs-keyread.md.
 *
 * Pipeline (XSKeyReadCore, run in a Web Worker)
 *   layout   paper colour = the mode; "not paper" mask; 8-connected
 *            components; the text height; swatches (filled or outlined
 *            blocks of one size), blobs (rules, pictures, overlays), glyphs
 *   rows     glyphs grouped into text lines by centre; x-overlapping parts
 *            merged (i, :, broken strokes); words by the page's own gap
 *            valley; one row per swatch (or per numbered line when the key
 *            has no swatches); columns by union of the words' x-ranges
 *   glyphs   each glyph -> a 16 x 16 coverage descriptor (aspect kept);
 *            clustered by shape and height: the same glyph is the same
 *            character everywhere on the page (one font)
 *   prior    every cluster scored against digits and letters drawn with
 *            fillText in common system faces at the glyph's size (built on
 *            the main thread, passed in): a prior, never the only evidence
 *   solve    the cluster -> digit mapping as a constraint problem, branch
 *            and bound over the clusters' plausible digits: every code a
 *            real code in the brand's table, codes distinct, the printed
 *            swatch near the code's colour, an index column 1..n, a count
 *            column summing to the chart's total and matching its classes,
 *            sorted keys. All solutions within a margin of the best are
 *            kept; a row is exact only when they all agree on it AND an
 *            independent check (swatch, count, name, strong glyph match)
 *            backs it; else the digits they agree on with '?' elsewhere
 *   names    with the codes fixed, the printed name's glyphs are matched
 *            against the table's own name, word by word (a cross-check)
 *   symbols  the row's symbol, from the symbol column or printed on the
 *            swatch, as a 16 x 16 1-bit bitmap with a "captured cleanly"
 *            flag
 *
 * Threading, cancel tokens and the main-thread fallback follow
 * xstitch-read.js: the worker source is String(XSKeyReadCore) +
 * String(xskWorkerBody) in a Blob URL; cancel() terminates a running job.
 * NOTE: if this file is ever minified, keep XSKeyReadCore and
 * xskWorkerBody out of the mangling (they reference nothing outside).
 * ===================================================================== */
(function () {

  var W = typeof window !== 'undefined' ? window : self;
  var VERSION = '1.0.0';
  var MAX_PIXELS = 12000000;

  /* ================================================================== *
   * 1. The core — pure numerics, stringified into the Worker
   * ================================================================== */

  function XSKeyReadCore() {
    'use strict';

    var D = 16, DD = 256;
    var DIGITS = '0123456789';

    /* ---- colour -------------------------------------------------------- */
    var LIN = new Float32Array(256);
    (function () {
      for (var i = 0; i < 256; i++) {
        var c = i / 255;
        LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      }
    })();
    function labF(t) { return t > 216 / 24389 ? Math.pow(t, 1 / 3) : ((24389 / 27) * t + 16) / 116; }
    function labOf(r, g, b) {
      var R = LIN[r], G = LIN[g], B = LIN[b];
      var X = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B;
      var Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
      var Z = 0.0193339 * R + 0.1191920 * G + 0.9503041 * B;
      var fx = labF(X / 0.95047), fy = labF(Y), fz = labF(Z / 1.08883);
      return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
    }
    var DEG = Math.PI / 180;
    function de2000(l1, l2) {
      var L1 = l1[0], a1 = l1[1], b1 = l1[2], L2 = l2[0], a2 = l2[1], b2 = l2[2];
      var C1 = Math.sqrt(a1 * a1 + b1 * b1), C2 = Math.sqrt(a2 * a2 + b2 * b2);
      var Cb7 = Math.pow((C1 + C2) / 2, 7);
      var G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 6103515625)));
      var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
      var C1p = Math.sqrt(a1p * a1p + b1 * b1), C2p = Math.sqrt(a2p * a2p + b2 * b2);
      var h1 = (a1p === 0 && b1 === 0) ? 0 : Math.atan2(b1, a1p) / DEG; if (h1 < 0) h1 += 360;
      var h2 = (a2p === 0 && b2 === 0) ? 0 : Math.atan2(b2, a2p) / DEG; if (h2 < 0) h2 += 360;
      var dL = L2 - L1, dC = C2p - C1p, dh = 0;
      if (C1p * C2p !== 0) { dh = h2 - h1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
      var dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(dh / 2 * DEG);
      var Lb = (L1 + L2) / 2, Cb = (C1p + C2p) / 2, hb;
      if (C1p * C2p === 0) hb = h1 + h2;
      else if (Math.abs(h1 - h2) <= 180) hb = (h1 + h2) / 2;
      else hb = (h1 + h2 < 360) ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
      var T = 1 - 0.17 * Math.cos((hb - 30) * DEG) + 0.24 * Math.cos(2 * hb * DEG) +
        0.32 * Math.cos((3 * hb + 6) * DEG) - 0.20 * Math.cos((4 * hb - 63) * DEG);
      var dT = 30 * Math.exp(-Math.pow((hb - 275) / 25, 2));
      var Cb7p = Math.pow(Cb, 7), RC = 2 * Math.sqrt(Cb7p / (Cb7p + 6103515625));
      var d50 = (Lb - 50) * (Lb - 50);
      var SL = 1 + 0.015 * d50 / Math.sqrt(20 + d50), SC = 1 + 0.045 * Cb, SH = 1 + 0.015 * Cb * T;
      var RT = -Math.sin(2 * dT * DEG) * RC;
      var t1 = dL / SL, t2 = dC / SC, t3 = dH / SH;
      return Math.sqrt(t1 * t1 + t2 * t2 + t3 * t3 + RT * t2 * t3);
    }
    function hex2(n) { var s = n.toString(16); return s.length < 2 ? '0' + s : s; }

    function median(a) {
      if (!a.length) return 0;
      var s = a.slice().sort(function (x, y) { return x - y; });
      return s[s.length >> 1];
    }
    function pctl(a, p) {
      if (!a.length) return 0;
      var s = a.slice().sort(function (x, y) { return x - y; });
      return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
    }

    /* ---- image ---------------------------------------------------------- */

    function makeImage(buf, w, h, crop) {
      var src = new Uint8ClampedArray(buf);
      var x0 = 0, y0 = 0, cw = w, ch = h;
      if (crop && crop.w > 4 && crop.h > 4) {
        x0 = Math.max(0, Math.min(w - 1, Math.floor(crop.x)));
        y0 = Math.max(0, Math.min(h - 1, Math.floor(crop.y)));
        cw = Math.max(1, Math.min(w - x0, Math.ceil(crop.w)));
        ch = Math.max(1, Math.min(h - y0, Math.ceil(crop.h)));
      }
      var n = cw * ch, R = new Uint8Array(n), G = new Uint8Array(n), B = new Uint8Array(n), Y = new Uint8Array(n);
      for (var y = 0; y < ch; y++) {
        var s = ((y0 + y) * w + x0) * 4, o = y * cw;
        for (var x = 0; x < cw; x++, s += 4, o++) {
          var r = src[s], g = src[s + 1], b = src[s + 2];
          R[o] = r; G[o] = g; B[o] = b;
          Y[o] = (r * 54 + g * 183 + b * 19) >> 8;
        }
      }
      return { w: cw, h: ch, ox: x0, oy: y0, R: R, G: G, B: B, Y: Y };
    }

    /** the paper: the most common colour (4 bits a channel), averaged */
    function paperOf(img) {
      var hist = new Int32Array(4096), n = img.w * img.h, step = n > 400000 ? 3 : 1, i;
      for (i = 0; i < n; i += step) hist[((img.R[i] >> 4) << 8) | ((img.G[i] >> 4) << 4) | (img.B[i] >> 4)]++;
      var best = 0;
      for (i = 1; i < 4096; i++) if (hist[i] > hist[best]) best = i;
      var sr = 0, sg = 0, sb = 0, c = 0;
      for (i = 0; i < n; i += step) {
        if ((((img.R[i] >> 4) << 8) | ((img.G[i] >> 4) << 4) | (img.B[i] >> 4)) !== best) continue;
        sr += img.R[i]; sg += img.G[i]; sb += img.B[i]; c++;
      }
      var r = Math.round(sr / c), g = Math.round(sg / c), b = Math.round(sb / c);
      return { r: r, g: g, b: b, y: (r * 54 + g * 183 + b * 19) >> 8, share: c * step / n };
    }

    function maskOf(img, paper, thr) {
      var n = img.w * img.h, m = new Uint8Array(n);
      var pr = paper.r, pg = paper.g, pb = paper.b, py = paper.y;
      for (var i = 0; i < n; i++) {
        var d = Math.max(Math.abs(img.R[i] - pr), Math.abs(img.G[i] - pg), Math.abs(img.B[i] - pb));
        if (d > thr || py - img.Y[i] > thr * 0.7) m[i] = 1;
      }
      return m;
    }

    /**
     * Clear long thin rules (table lines, underlines, grid lines) from a mask in place: a
     * pixel goes when it lies in a horizontal (vertical) run at least 5 text heights long and
     * its ink across the run is no thicker than a line. Swatches and glyphs stay whole.
     * Returns how many pixels were cleared.
     */
    function removeRules(mask, w, h, H) {
      var Lmin = Math.max(12, Math.round(5 * H)), t = Math.max(2, Math.round(0.14 * H)), cleared = 0;
      var kill = new Uint8Array(w * h), x, y, i, a, n;
      for (y = 0; y < h; y++) {
        x = 0;
        while (x < w) {
          if (!mask[y * w + x]) { x++; continue; }
          a = x;
          while (x < w && mask[y * w + x]) x++;
          if (x - a < Lmin) continue;
          for (i = a; i < x; i++) {
            n = 1;
            for (var u = y - 1; u >= 0 && mask[u * w + i] && n <= t; u--) n++;
            for (var d = y + 1; d < h && mask[d * w + i] && n <= t; d++) n++;
            if (n <= t) kill[y * w + i] = 1;
          }
        }
      }
      /* apply the horizontal cut first, so crossings with vertical rules go with them */
      for (i = 0; i < w * h; i++) if (kill[i]) { mask[i] = 0; kill[i] = 0; cleared++; }
      for (x = 0; x < w; x++) {
        y = 0;
        while (y < h) {
          if (!mask[y * w + x]) { y++; continue; }
          a = y;
          while (y < h && mask[y * w + x]) y++;
          if (y - a < Lmin) continue;
          for (i = a; i < y; i++) {
            n = 1;
            for (var l = x - 1; l >= 0 && mask[i * w + l] && n <= t; l--) n++;
            for (var r = x + 1; r < w && mask[i * w + r] && n <= t; r++) n++;
            if (n <= t) kill[i * w + x] = 1;
          }
        }
      }
      for (i = 0; i < w * h; i++) if (kill[i]) { mask[i] = 0; cleared++; }
      return cleared;
    }

    /** 8-connected components with box, size, colour sums and darkest luma */
    function components(img, mask) {
      var w = img.w, h = img.h, n = w * h;
      var lab = new Int32Array(n);
      var cap = 4096, par = new Int32Array(cap), next = 1;
      function find(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
      function uni(a, b) { a = find(a); b = find(b); if (a !== b) { if (a < b) par[b] = a; else par[a] = b; } return a < b ? a : b; }
      for (var y = 0; y < h; y++) {
        var row = y * w;
        for (var x = 0; x < w; x++) {
          var i = row + x;
          if (!mask[i]) continue;
          var l = 0, t;
          if (x > 0 && (t = lab[i - 1])) l = t;
          if (y > 0) {
            var up = i - w;
            if (x > 0 && (t = lab[up - 1])) l = l ? uni(l, t) : t;
            if ((t = lab[up])) l = l ? uni(l, t) : t;
            if (x < w - 1 && (t = lab[up + 1])) l = l ? uni(l, t) : t;
          }
          if (!l) {
            if (next >= cap) { var np = new Int32Array(cap * 2); np.set(par); par = np; cap *= 2; }
            par[next] = next; l = next++;
          }
          lab[i] = l;
        }
      }
      var map = new Int32Array(next), k = 0, id;
      for (id = 1; id < next; id++) { var r0 = find(id); if (r0 === id) map[id] = ++k; }
      for (id = 1; id < next; id++) map[id] = map[find(id)];
      var comps = new Array(k + 1);
      for (id = 1; id <= k; id++) comps[id] = { id: id, x0: 1e9, y0: 1e9, x1: -1, y1: -1, n: 0, sr: 0, sg: 0, sb: 0, minY: 255 };
      for (var j = 0; j < n; j++) {
        if (!lab[j]) continue;
        var cc = map[lab[j]];
        lab[j] = cc;
        var c = comps[cc], xx = j % w, yy = (j - xx) / w;
        if (xx < c.x0) c.x0 = xx; if (xx > c.x1) c.x1 = xx;
        if (yy < c.y0) c.y0 = yy; if (yy > c.y1) c.y1 = yy;
        c.n++; c.sr += img.R[j]; c.sg += img.G[j]; c.sb += img.B[j];
        if (img.Y[j] < c.minY) c.minY = img.Y[j];
      }
      var out = [];
      for (id = 1; id <= k; id++) {
        var q = comps[id];
        q.w = q.x1 - q.x0 + 1; q.h = q.y1 - q.y0 + 1;
        q.cx = (q.x0 + q.x1) / 2; q.cy = (q.y0 + q.y1) / 2;
        q.fill = q.n / (q.w * q.h);
        out.push(q);
      }
      return { lab: lab, comps: out, byId: comps };
    }

    /* ---- descriptors ---------------------------------------------------- */

    /**
     * 16 x 16 coverage of a w x h box, aspect kept, centred; val(x, y) is
     * the darkness 0..1 of a pixel inside the box. Exact box overlap, so it
     * works both up- and down-scaling. Returns { v (raw), z (zero mean,
     * unit norm) }.
     */
    function descOf(val, w, h, sideOverride) {
      var side = sideOverride || Math.max(w, h);
      var s = D / side, ox = (D - w * s) / 2, oy = (D - h * s) / 2;
      var out = new Float32Array(DD);
      var wx = spans(w, s, ox), wy = spans(h, s, oy);
      for (var y = 0; y < h; y++) {
        var ry = wy[y];
        for (var x = 0; x < w; x++) {
          var v = val(x, y);
          if (v <= 0) continue;
          var rx = wx[x];
          for (var a = 0; a < ry.length; a += 2) {
            var base = ry[a] * D, fy = ry[a + 1] * v;
            for (var b = 0; b < rx.length; b += 2) out[base + rx[b]] += fy * rx[b + 1];
          }
        }
      }
      return { v: out, z: zNorm(out) };
    }
    function spans(n, s, o) {
      var res = new Array(n);
      for (var p = 0; p < n; p++) {
        var a = p * s + o, b = (p + 1) * s + o, list = [];
        for (var t = Math.max(0, Math.floor(a)); t < Math.min(D, Math.ceil(b)); t++) {
          var ov = Math.min(b, t + 1) - Math.max(a, t);
          if (ov > 0) list.push(t, ov);
        }
        res[p] = list;
      }
      return res;
    }
    function zNorm(v) {
      var m = 0, i;
      for (i = 0; i < DD; i++) m += v[i];
      m /= DD;
      var z = new Float32Array(DD), ss = 0;
      for (i = 0; i < DD; i++) { z[i] = v[i] - m; ss += z[i] * z[i]; }
      ss = Math.sqrt(ss) || 1;
      for (i = 0; i < DD; i++) z[i] /= ss;
      return z;
    }
    function ncc(a, b, bo) {
      var s = 0; bo = bo || 0;
      for (var i = 0; i < DD; i++) s += a[i] * b[bo + i];
      return s;
    }

    /** darkness of a glyph made of components `ids` in its box */
    function glyphDesc(img, cc, paper, g) {
      var lab = cc.lab, w = img.w, ink = 255, i;
      for (i = 0; i < g.ids.length; i++) ink = Math.min(ink, cc.byId[g.ids[i]].minY);
      var span = Math.max(30, paper.y - ink);
      var own = {};
      for (i = 0; i < g.ids.length; i++) own[g.ids[i]] = 1;
      var x0 = g.x0, y0 = g.y0;
      return descOf(function (x, y) {
        var j = (y0 + y) * w + x0 + x, l = lab[j];
        if (l && !own[l]) return 0;
        var v = (paper.y - img.Y[j]) / span;
        return v <= 0.08 ? 0 : (v > 1 ? 1 : v);
      }, g.x1 - g.x0 + 1, g.y1 - g.y0 + 1);
    }

    /* ---- layout --------------------------------------------------------- */

    function textHeight(comps, imgH) {
      var hs = [];
      for (var i = 0; i < comps.length; i++) {
        var c = comps[i];
        if (c.n < 6 || c.h < 5 || c.h > imgH / 6) continue;
        if (c.w > 1.6 * c.h || c.w < 0.12 * c.h) continue;
        if (c.fill > 0.85 && c.w > 0.6 * c.h) continue;          // blocks
        hs.push(c.h);
      }
      if (hs.length < 4) return 0;
      return pctl(hs, 0.7);
    }

    /** swatches: filled or outlined blocks, one common size */
    function findSwatches(img, cc, H, paper, faint) {
      var cand = [], comps = cc.comps, i;
      function shape(c, src) {
        if (c.w < 0.55 * H || c.h < 0.55 * H || c.w > 7 * H || c.h > 7 * H) return false;
        var ar = c.w / c.h;
        if (ar < 0.55 || ar > 3.5) return false;
        if (c.fill >= 0.72) {
          /* a small dark block is ink (a bold letter, a filled symbol), not a swatch */
          if ((c.w < 0.9 * H || c.h < 0.9 * H) && c.n) {
            var mr = c.sr / c.n, mg = c.sg / c.n, mb = c.sb / c.n;
            var mx = Math.max(mr, mg, mb), mn = Math.min(mr, mg, mb);
            if (mx < 110 && mx - mn < 30) return false;
          }
          c.swKind = 'fill'; return true;
        }
        if (ar > 1.8) return false;
        if (c.fill < 0.6 && outlined(src, img.w, c)) { c.swKind = 'box'; return true; }
        return false;
      }
      for (i = 0; i < comps.length; i++) {
        var c0 = comps[i];
        if (shape(c0, cc)) { cand.push(c0); continue; }
        /* swatches printed edge to edge make one tall block: cut it where the colour changes */
        if (c0.fill >= 0.72 && c0.w >= 0.75 * H && c0.w <= 7 * H && c0.h >= 1.8 * c0.w) {
          splitStack(img, c0).forEach(function (p) { if (shape(p, cc)) cand.push(p); });
        }
      }
      /* pale swatches with no outline only show on the faint mask; only pale blocks are taken from it
         (dark symbols and text grow into blocks there) */
      if (faint) faint.comps.forEach(function (c) {
        var mr = c.sr / c.n, mg = c.sg / c.n, mb = c.sb / c.n;
        if (Math.max(Math.abs(mr - paper.r), Math.abs(mg - paper.g), Math.abs(mb - paper.b)) > 60) return;
        if (c.fill < 0.85 || !shape(c, faint)) return;
        for (var k = 0; k < cand.length; k++) {
          var d = cand[k];
          if (c.x0 <= d.x1 && d.x0 <= c.x1 && c.y0 <= d.y1 && d.y0 <= c.y1) return;
        }
        c.faint = true;
        cand.push(c);
      });
      if (cand.length < 2) return [];
      /* the swatch size: the size most candidates share, bigger sizes preferred (ink specks are small) */
      var mw = 0, mh = 0, bestScore = -1;
      cand.forEach(function (r) {
        var m = cand.filter(function (c) { return Math.abs(c.w - r.w) <= 0.3 * r.w && Math.abs(c.h - r.h) <= 0.3 * r.h; }).length;
        var sc = m * Math.sqrt(r.w * r.h);
        if (m >= 2 && sc > bestScore) { bestScore = sc; mw = r.w; mh = r.h; }
      });
      if (!mw) return [];
      var out = cand.filter(function (c) { return Math.abs(c.w - mw) <= 0.3 * mw && Math.abs(c.h - mh) <= 0.3 * mh; });
      if (out.length < 2) return [];
      /* the swatches of one key line up in a column (or a few) */
      var xs = {};
      out.forEach(function (c) { var k = Math.round(c.x0 / (0.5 * mw)); xs[k] = (xs[k] || 0) + 1; });
      out = out.filter(function (c) {
        var k = Math.round(c.x0 / (0.5 * mw));
        return (xs[k] || 0) + (xs[k - 1] || 0) + (xs[k + 1] || 0) >= 2;
      });
      /* one swatch per place: parts of one symbol or block found twice keep the bigger */
      out.sort(function (a, b) { return b.w * b.h - a.w * a.h; });
      var kept = [];
      out.forEach(function (c) {
        for (var k = 0; k < kept.length; k++) {
          var d = kept[k];
          if (Math.abs(c.cy - d.cy) < 0.5 * d.h && c.x0 < d.x1 + 0.4 * d.w && d.x0 < c.x1 + 0.4 * d.w) return;
        }
        kept.push(c);
      });
      out = kept;
      out.forEach(function (c) { swatchColour(img, cc, c, paper); });
      return out;
    }
    /** a tall block of stacked swatches -> one box per run of one colour */
    function splitStack(img, c) {
      var w = img.w, a = c.x0 + Math.round(c.w * 0.2), b = c.x1 - Math.round(c.w * 0.2);
      var rowsC = [], y, x;
      for (y = c.y0; y <= c.y1; y++) {
        var rs = [], gs = [], bs = [];
        for (x = a; x <= b; x++) { var j = y * w + x; rs.push(img.R[j]); gs.push(img.G[j]); bs.push(img.B[j]); }
        rowsC.push([median(rs), median(gs), median(bs)]);
      }
      function diff(p, q) { return Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2])); }
      /* k near-square boxes: each cut near its nominal place, where the colour changes most */
      var k = Math.round(c.h / c.w), cuts = [0], pitch = c.h / Math.max(1, k), off = Math.max(2, Math.round(0.08 * c.w));
      for (var i0 = 1; i0 < k; i0++) {
        var nom = Math.round(i0 * pitch), best = -1, bv = -1;
        for (var yy = Math.max(off, nom - Math.round(0.25 * pitch)); yy <= Math.min(rowsC.length - 1 - off, nom + Math.round(0.25 * pitch)); yy++) {
          var dv = diff(rowsC[yy - off], rowsC[yy + off]);
          if (dv > bv) { bv = dv; best = yy; }
        }
        if (best < 0 || bv < 24) return [];
        cuts.push(best);
      }
      cuts.push(rowsC.length);
      var out = [];
      for (var i = 0; i + 1 < cuts.length; i++) {
        var y0 = c.y0 + cuts[i], y1 = c.y0 + cuts[i + 1] - 1, hh = y1 - y0 + 1;
        if (hh < 0.6 * c.w || hh > 1.6 * c.w) continue;
        out.push({ id: c.id, x0: c.x0, x1: c.x1, y0: y0, y1: y1, w: c.w, h: hh, cx: c.cx, cy: (y0 + y1) / 2, n: c.w * hh, fill: 1, stacked: true });
      }
      return out;
    }

    function outlined(cc, w, c) {
      var lab = cc.lab, hit = 0, tot = 0, x, y, t = Math.max(1, Math.round(Math.min(c.w, c.h) * 0.12));
      function edge(x, y) {
        for (var d = 0; d < t; d++) {
          var xx = x, yy = y;
          if (y === c.y0) yy = c.y0 + d; else if (y === c.y1) yy = c.y1 - d;
          else if (x === c.x0) xx = c.x0 + d; else xx = c.x1 - d;
          if (lab[yy * w + xx] === c.id) return 1;
        }
        return 0;
      }
      for (x = c.x0; x <= c.x1; x++) { tot += 2; hit += edge(x, c.y0) + edge(x, c.y1); }
      for (y = c.y0 + 1; y < c.y1; y++) { tot += 2; hit += edge(c.x0, y) + edge(c.x1, y); }
      return hit / tot >= 0.88;
    }
    /** a swatch's colour: the densest colour in its inner part (symbol ink and borders do not move it) */
    function swatchColour(img, cc, c, paper) {
      /* the band between 6 % and 20 % in from the edge: inside a thin outline, outside a symbol
         drawn in the middle (a thick outline is the swatch colour itself) */
      var w = img.w, side = Math.min(c.w, c.h), o1 = Math.max(1, Math.round(side * 0.06)), o2 = Math.max(o1 + 1, Math.round(side * 0.2));
      var hist = {}, best = null, bn = 0, x, y;
      for (y = c.y0 + o1; y <= c.y1 - o1; y++) for (x = c.x0 + o1; x <= c.x1 - o1; x++) {
        var inX = Math.min(x - c.x0, c.x1 - x), inY = Math.min(y - c.y0, c.y1 - y);
        if (Math.min(inX, inY) >= o2) continue;
        var j = y * w + x, k = ((img.R[j] >> 3) << 10) | ((img.G[j] >> 3) << 5) | (img.B[j] >> 3);
        var e = hist[k] || (hist[k] = { n: 0, r: 0, g: 0, b: 0 });
        e.n++; e.r += img.R[j]; e.g += img.G[j]; e.b += img.B[j];
      }
      /* smooth over the 27 neighbouring bins so JPEG noise does not split the mode */
      for (var k2 in hist) {
        var kk = +k2, r5 = kk >> 10, g5 = (kk >> 5) & 31, b5 = kk & 31, tot = 0;
        for (var dr = -1; dr <= 1; dr++) for (var dg = -1; dg <= 1; dg++) for (var db = -1; db <= 1; db++) {
          var nb = hist[((r5 + dr) << 10) | ((g5 + dg) << 5) | (b5 + db)];
          if (nb && r5 + dr >= 0 && g5 + dg >= 0 && b5 + db >= 0) tot += nb.n;
        }
        if (tot > bn) { bn = tot; best = hist[k2]; }
      }
      if (!best) { c.rgb = [paper.r, paper.g, paper.b]; }
      else c.rgb = [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
      c.lab = labOf(c.rgb[0], c.rgb[1], c.rgb[2]);
      c.hex = hex2(c.rgb[0]) + hex2(c.rgb[1]) + hex2(c.rgb[2]);
      var pd = Math.max(Math.abs(c.rgb[0] - paper.r), Math.abs(c.rgb[1] - paper.g), Math.abs(c.rgb[2] - paper.b));
      c.paperLike = pd < 24;
    }

    /** text lines: core items grouped by centre, small marks attached */
    function buildLines(items, H) {
      var core = items.filter(function (c) { return c.h >= 0.5 * H; }).sort(function (a, b) { return a.cy - b.cy || a.x0 - b.x0; });
      var lines = [], cur = null;
      for (var i = 0; i < core.length; i++) {
        var c = core[i];
        if (cur && Math.abs(c.cy - cur.cyM) <= 0.45 * H) {
          cur.items.push(c); cur.cys.push(c.cy);
          if (cur.cys.length < 64 || cur.cys.length % 16 === 0) cur.cyM = median(cur.cys);
        } else {
          cur = { items: [c], cys: [c.cy], cyM: c.cy };
          lines.push(cur);
        }
      }
      lines.forEach(function (L) {
        L.y0 = 1e9; L.y1 = -1;
        L.items.forEach(function (c) { if (c.y0 < L.y0) L.y0 = c.y0; if (c.y1 > L.y1) L.y1 = c.y1; });
        L.top = median(L.items.map(function (c) { return c.y0; }));
        L.bot = median(L.items.map(function (c) { return c.y1; }));
      });
      var small = items.filter(function (c) { return c.h < 0.5 * H; });
      small.forEach(function (c) {
        var best = null, bd = 1e9;
        for (var k = 0; k < lines.length; k++) {
          var L = lines[k];
          if (c.cy < L.top - 0.3 * H || c.cy > L.bot + 0.35 * H) continue;
          var d = Math.abs(c.cy - L.cyM);
          if (d < bd) { bd = d; best = L; }
        }
        if (best) best.items.push(c);
      });
      return lines;
    }

    /** a line's items -> glyphs (x-overlapping parts merged), left to right */
    function lineGlyphs(L) {
      var it = L.items.slice().sort(function (a, b) { return a.x0 - b.x0 || a.y0 - b.y0; });
      var out = [];
      for (var i = 0; i < it.length; i++) {
        var c = it[i], g = out.length ? out[out.length - 1] : null;
        if (g) {
          var ov = Math.min(g.x1, c.x1) - Math.max(g.x0, c.x0) + 1;
          var mn = Math.min(g.x1 - g.x0 + 1, c.w);
          if (ov >= 0.6 * mn) {
            g.ids.push(c.id);
            g.x0 = Math.min(g.x0, c.x0); g.x1 = Math.max(g.x1, c.x1);
            g.y0 = Math.min(g.y0, c.y0); g.y1 = Math.max(g.y1, c.y1);
            continue;
          }
        }
        out.push({ ids: [c.id], x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1 });
      }
      return out;
    }

    /** the page's word-gap threshold, from the valley in the gap histogram */
    function wordGap(lines, H) {
      var hist = new Float32Array(60), n = 0;
      lines.forEach(function (L) {
        var g = L.glyphs;
        for (var i = 1; i < g.length; i++) {
          var gap = (g[i].x0 - g[i - 1].x1 - 1) / H;
          if (gap < 0 || gap >= 1.2) continue;
          hist[Math.min(59, Math.floor(gap / 0.02))]++; n++;
        }
      });
      if (n < 20) return 0.3 * H;
      var sm = new Float32Array(60);
      for (var i = 0; i < 60; i++) {
        var s = 0, c = 0;
        for (var d = -2; d <= 2; d++) if (i + d >= 0 && i + d < 60) { s += hist[i + d]; c++; }
        sm[i] = s / c;
      }
      var lo = 8, hi = 25, best = 15;
      for (var j = lo; j <= hi; j++) if (sm[j] < sm[best] - 1e-6) best = j;
      return (best + 0.5) * 0.02 * H;
    }

    function words(glyphs, gap) {
      var out = [], cur = null;
      for (var i = 0; i < glyphs.length; i++) {
        var g = glyphs[i];
        if (cur && g.x0 - cur.x1 - 1 <= gap) { cur.g.push(g); cur.x1 = Math.max(cur.x1, g.x1); cur.y0 = Math.min(cur.y0, g.y0); cur.y1 = Math.max(cur.y1, g.y1); }
        else { cur = { g: [g], x0: g.x0, x1: g.x1, y0: g.y0, y1: g.y1 }; out.push(cur); }
      }
      return out;
    }

    /* ---- clustering ------------------------------------------------------ */

    function clusterGlyphs(glyphs, H) {
      var order = glyphs.map(function (g, i) { return i; });
      var cl = [];
      for (var oi = 0; oi < order.length; oi++) {
        var g = glyphs[order[oi]], gh = g.y1 - g.y0 + 1, best = -1, bs = 0.88;
        for (var c = 0; c < cl.length; c++) {
          var k = cl[c];
          if (Math.abs(gh - k.h) > Math.max(1.5, 0.16 * k.h)) continue;
          var s = ncc(g.d.z, k.z);
          if (s > bs) { bs = s; best = c; }
        }
        if (best < 0) {
          cl.push({ id: cl.length, members: [order[oi]], sum: Float32Array.from(g.d.v), z: g.d.z, h: gh, hs: gh, w: g.x1 - g.x0 + 1, ws: g.x1 - g.x0 + 1 });
          g.cl = cl.length - 1;
        } else {
          var K = cl[best];
          K.members.push(order[oi]);
          for (var i = 0; i < DD; i++) K.sum[i] += g.d.v[i];
          K.z = zNorm(K.sum);
          K.hs += gh; K.h = K.hs / K.members.length;
          K.ws += g.x1 - g.x0 + 1; K.w = K.ws / K.members.length;
          g.cl = best;
        }
      }
      return cl;
    }

    /* ---- templates (from the main thread) -------------------------------- */

    /** score every cluster against every template character; tp: { chars, sizes, fonts, desc, hr } */
    function scoreClusters(cl, tp, Hd) {
      if (!tp || !tp.desc) return;
      var nc = tp.chars.length, nf = tp.fonts, ns = tp.sizes.length;
      /* the template size nearest the digit height */
      var si = 0;
      for (var s = 1; s < ns; s++) if (Math.abs(tp.sizes[s] - Hd) < Math.abs(tp.sizes[si] - Hd)) si = s;
      for (var c = 0; c < cl.length; c++) {
        var K = cl[c], sc = new Float32Array(nc), hr = K.h / Hd;
        for (var ch = 0; ch < nc; ch++) {
          var best = -2;
          for (var f = 0; f < nf; f++) {
            var idx = (si * nf + f) * nc + ch;
            var th = tp.hr[idx];
            if (!(th > 0)) continue;
            var v = ncc(K.z, tp.desc, idx * DD) - 0.55 * Math.abs(Math.log(hr / th));
            if (v > best) best = v;
          }
          sc[ch] = best;
        }
        K.tpl = sc;
        var bd = -2, bl = -2, bdc = 0;
        for (ch = 0; ch < nc; ch++) {
          if (ch < 10) { if (sc[ch] > bd) { bd = sc[ch]; bdc = ch; } }
          else if (sc[ch] > bl) bl = sc[ch];
        }
        K.bestDigit = bd; K.bestDigitCh = bdc; K.bestLetter = bl;
        K.digitness = bd - bl;
      }
    }
    function letterRank(K, tp, ch) {
      if (!K.tpl) return 99;
      var idx = tp.chars.indexOf(ch);
      if (idx < 0) return 99;
      var v = K.tpl[idx], r = 0;
      /* case pairs that share a shape count as one */
      var alt = ch.toLowerCase() === ch ? ch.toUpperCase() : ch.toLowerCase();
      var ai = tp.chars.indexOf(alt);
      if (ai >= 0 && 'cosvwxzCOSVWXZ'.indexOf(ch) >= 0) v = Math.max(v, K.tpl[ai]);
      for (var i = 10; i < tp.chars.length; i++) if (i !== idx && i !== ai && K.tpl[i] > v) r++;
      return r;
    }

    /* ---- the key -------------------------------------------------------- */

    /** build the key's rows: one per swatch, or one per line of a swatch-less key */
    function buildRows(lines, swatches, H, gap) {
      var rows = [];
      if (swatches.length >= 2) {
        /* assign swatches to lines */
        swatches.sort(function (a, b) { return a.cy - b.cy || a.x0 - b.x0; });
        swatches.forEach(function (s) {
          var best = null, bd = 1e9;
          lines.forEach(function (L) {
            var d = Math.abs(L.cyM - s.cy);
            if (d < Math.max(0.8 * s.h, 0.6 * H) && d < bd) { bd = d; best = L; }
          });
          s.line = best;
        });
        swatches.forEach(function (s, si) {
          var L = s.line, toks = [];
          if (L) {
            var onLine = swatches.filter(function (t) { return t.line === L; }).sort(function (a, b) { return a.x0 - b.x0; });
            var k = onLine.indexOf(s);
            var left = k > 0 ? onLine[k - 1].x1 : -1e9, right = k < onLine.length - 1 ? onLine[k + 1].x0 : 1e9;
            /* on a multi-column key the words left of a swatch belong to the entry before it */
            var leftLimit = k > 0 ? s.x0 - 4 * s.w : -1e9;
            /* words chained to the swatch: a big empty gap ends the row (a chart beside the key) */
            var rw = L.words.filter(function (wd) { return wd.x0 >= s.x1 && wd.x1 < right; }).sort(function (a, b) { return a.x0 - b.x0; });
            var lw = L.words.filter(function (wd) { return wd.x1 <= s.x0 && wd.x0 > Math.max(left, leftLimit); }).sort(function (a, b) { return b.x1 - a.x1; });
            var edge = s.x1;
            for (var q = 0; q < rw.length && rw[q].x0 - edge <= 40 * H; q++) { toks.push(rw[q]); edge = rw[q].x1; }
            edge = s.x0;
            for (q = 0; q < lw.length && edge - lw[q].x1 <= 8 * H; q++) { toks.push(lw[q]); edge = lw[q].x0; }
            toks.sort(function (a, b) { return a.x0 - b.x0; });
          }
          rows.push({ anchor: s, swatch: s, line: L, toks: toks, ax: s.x0 });
        });
        /* a row printed with no swatch (White on a white page) inside the block of swatch rows:
           kept as a candidate, placed into the columns the swatch rows make */
        var xs = swatches.map(function (s) { return s.x0; }), mx = median(xs);
        var oneCol = swatches.every(function (s) { return Math.abs(s.x0 - mx) < s.w; });
        var cys = rows.filter(function (r) { return r.line; }).map(function (r) { return r.line.cyM; }).sort(function (a, b) { return a - b; });
        if (oneCol && cys.length >= 2) {
          var pitches = [];
          for (var q = 1; q < cys.length; q++) pitches.push(cys[q] - cys[q - 1]);
          var pitch = median(pitches), lo = cys[0] - 1.3 * pitch, hi = cys[cys.length - 1] + 1.3 * pitch;
          /* only words inside the key's own x-span, and only in a slot where a row is missing */
          var kx0 = 1e9, kx1 = -1;
          rows.forEach(function (r) { r.toks.forEach(function (t) { kx0 = Math.min(kx0, t.x0); kx1 = Math.max(kx1, t.x1); }); kx0 = Math.min(kx0, r.anchor.x0); kx1 = Math.max(kx1, r.anchor.x1); });
          lines.forEach(function (L) {
            if (L.cyM < lo || L.cyM > hi || !L.words.length) return;
            if (swatches.some(function (s) { return s.line === L; })) return;
            if (cys.some(function (cy) { return Math.abs(cy - L.cyM) < 0.6 * pitch; })) return;
            var tk = L.words.filter(function (t) { return t.x0 >= kx0 - H && t.x1 <= kx1 + H; });
            if (!tk.length) return;
            rows.push({ anchor: null, swatch: null, line: L, toks: tk, ax: mx, extra: true });
          });
          rows.sort(function (a, b) { return (a.line ? a.line.cyM : a.anchor.cy) - (b.line ? b.line.cyM : b.anchor.cy); });
        }
        return rows;
      }
      /* no swatches: every line that holds a short word is a candidate row */
      lines.forEach(function (L) {
        if (!L.words.length || L.words.length > 12) return;
        rows.push({ anchor: null, swatch: null, line: L, toks: L.words.slice(), ax: 0 });
      });
      return rows;
    }

    /** columns by union of the words' x-ranges, relative to each row's anchor */
    function buildColumns(rows, H) {
      var items = [];
      rows.forEach(function (r, ri) {
        if (r.extra) return;
        r.toks.forEach(function (t) { items.push({ r: ri, t: t, a: t.x0 - r.ax, b: t.x1 - r.ax }); });
      });
      items.sort(function (p, q) { return p.a - q.a || p.b - q.b; });
      var cols = [], cur = null;
      items.forEach(function (it) {
        if (cur && it.a <= cur.b + 0.25 * H) { cur.items.push(it); if (it.b > cur.b) cur.b = it.b; }
        else { cur = { a: it.a, b: it.b, items: [it] }; cols.push(cur); }
      });
      cols.forEach(function (c, ci) {
        c.i = ci;
        c.byRow = {};
        rows.forEach(function (r, ri) {
          if (!r.extra) return;
          r.toks.forEach(function (t) {
            var a = t.x0 - r.ax, b = t.x1 - r.ax;
            if (a <= c.b && b >= c.a) c.items.push({ r: ri, t: t, a: a, b: b });
          });
        });
        c.items.forEach(function (it) { (c.byRow[it.r] || (c.byRow[it.r] = [])).push(it.t); });
        for (var k in c.byRow) c.byRow[k].sort(function (p, q) { return p.x0 - q.x0; });
        c.rows = Object.keys(c.byRow).length;
      });
      return cols;
    }

    function tokGlyphs(toks) {
      var g = [];
      toks.forEach(function (t) { g = g.concat(t.g); });
      return g;
    }

    /** split glyphs that are plainly two digits run together (a deep valley in the ink) */
    function splitWide(img, cc, paper, g, Hd) {
      var w = g.x1 - g.x0 + 1, h = g.y1 - g.y0 + 1;
      if (h < 0.7 * Hd) return [g];
      var hh = Math.max(h, 0.85 * Hd);            // the glyph's own height: a digit is never wider than it is tall
      if (w < 1.0 * hh) return [g];
      var parts = Math.round(w / (0.62 * hh));
      if (parts < 2) return [g];
      parts = Math.min(parts, 4);
      var prof = new Float32Array(w), lab = cc.lab, own = {}, i, x, y;
      g.ids.forEach(function (id) { own[id] = 1; });
      for (x = 0; x < w; x++) for (y = 0; y < h; y++) {
        var j = (g.y0 + y) * img.w + g.x0 + x;
        /* weighted by darkness: where two digits touch, the join is the grey anti-aliased part */
        if (own[lab[j]]) prof[x] += Math.max(0, Math.min(1, (paper.y - img.Y[j]) / Math.max(30, paper.y - 40)));
      }
      var mx = 0;
      for (x = 0; x < w; x++) if (prof[x] > mx) mx = prof[x];
      var cuts = [];
      for (var p = 1; p < parts; p++) {
        var c0 = Math.round(w * p / parts), best = -1, bv = 1e9;
        for (x = Math.max(1, c0 - Math.round(0.18 * Hd)); x <= Math.min(w - 2, c0 + Math.round(0.18 * Hd)); x++) {
          if (prof[x] < bv) { bv = prof[x]; best = x; }
        }
        if (best < 0 || bv > 0.45 * mx) return [g];
        cuts.push(best);
      }
      var out = [], last = 0;
      cuts.push(w);
      for (i = 0; i < cuts.length; i++) {
        var a = last, b = cuts[i] - 1;
        if (i < cuts.length - 1) b = cuts[i];
        var y0 = 1e9, y1 = -1;
        for (x = a; x <= b; x++) for (y = 0; y < h; y++) {
          if (own[lab[(g.y0 + y) * img.w + g.x0 + x]]) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (y1 < 0) return [g];
        out.push({ ids: g.ids, x0: g.x0 + a, x1: g.x0 + b, y0: g.y0 + y0, y1: g.y0 + y1, split: true });
        last = cuts[i] + 1;
      }
      return out;
    }

    /* ---- the solver ------------------------------------------------------ */

    /**
     * Branch and bound over cluster -> digit. P:
     *   L[c][d]       template log-prior (<= 0) per cluster, -Infinity outside the domain
     *   rows[r].toks  [{ kind, cl:[cluster ids] }]
     *   evalRow(r, strs) -> score, strs: decoded strings per token
     *   evalLeaf(asg)    -> score;  rowMax[r], leafMax: the best either can add
     *   same(a, b)    may two clusters be one digit (split by noise)?
     * Returns { leaves: [{ s, asg }], best, nodes, over }.
     */
    function bnb(P) {
      var same0 = P.same, sameM = {};
      P.same = function (a, b) { var k = a < b ? a + ',' + b : b + ',' + a; var v = sameM[k]; if (v === undefined) v = sameM[k] = !!same0(a, b); return v; };
      var nc = P.nc, order = P.order, pos = new Int32Array(nc), k;
      for (k = 0; k < order.length; k++) pos[order[k]] = k;
      var nOrd = order.length;
      var rowsAt = [];
      for (k = 0; k <= nOrd; k++) rowsAt.push([]);
      P.rows.forEach(function (row, r) {
        var last = -1;
        row.toks.forEach(function (t) { t.cl.forEach(function (c) { if (pos[c] > last) last = pos[c]; }); });
        rowsAt[last + 1 > 0 ? last : 0].push(r);
        row.at = last;
      });
      var restRow = new Float32Array(nOrd + 1), restL = new Float32Array(nOrd + 1);
      for (k = nOrd - 1; k >= 0; k--) {
        var c = order[k], mL = -1e9;
        for (var d = 0; d < 10; d++) if (P.L[c][d] > mL) mL = P.L[c][d];
        restL[k] = restL[k + 1] + mL;
        var rr = 0;
        rowsAt[k].forEach(function (r) { rr += P.rowMax[r]; });
        restRow[k] = restRow[k + 1] + rr;
      }
      var asg = new Int8Array(nc); for (k = 0; k < nc; k++) asg[k] = -1;
      var usedBy = []; for (k = 0; k < 10; k++) usedBy.push([]);
      var leaves = [], best = -1e18, nodes = 0, over = false;
      var KEEP = P.keep, BUDGET = P.budget;
      var domains = [];
      for (k = 0; k < nOrd; k++) {
        var cc = order[k], dl = [];
        for (var dd = 0; dd < 10; dd++) if (P.L[cc][dd] > -1e8) dl.push(dd);
        dl.sort(function (a, b) { return P.L[cc][b] - P.L[cc][a] || a - b; });
        domains.push(dl);
      }
      function decode(row) {
        var out = new Array(row.toks.length);
        for (var j = 0; j < row.toks.length; j++) {
          var t = row.toks[j], s = '';
          for (var i = 0; i < t.cl.length; i++) s += asg[t.cl[i]];
          out[j] = s;
        }
        return out;
      }
      function rec(k, score) {
        if (over) return;
        if (++nodes > BUDGET) { over = true; return; }
        if (k === nOrd) {
          var s = score + P.evalLeaf(asg);
          if (s >= best - KEEP) {
            leaves.push({ s: s, asg: Int8Array.from(asg) });
            if (s > best) {
              best = s;
              if (leaves.length > 4000) leaves = leaves.filter(function (l) { return l.s >= best - KEEP; });
            }
          }
          return;
        }
        var c = order[k], dom = domains[k];
        for (var i = 0; i < dom.length; i++) {
          var d = dom[i], pen = 0, u = usedBy[d];
          /* two clusters as one digit: free when they look alike (noise split them), costly when not */
          for (var j = 0; j < u.length; j++) if (!P.same(u[j], c)) pen += 5;
          asg[c] = d; u.push(c);
          var s2 = score + P.L[c][d] - pen;
          var rs = rowsAt[k];
          for (var q = 0; q < rs.length; q++) s2 += P.evalRow(rs[q], decode(P.rows[rs[q]]), asg);
          if (s2 + restL[k + 1] + restRow[k + 1] + P.leafMax >= best - KEEP) rec(k + 1, s2);
          if (P.undoRow) for (q = rs.length - 1; q >= 0; q--) P.undoRow(rs[q]);
          u.pop(); asg[c] = -1;
        }
      }
      if (rowsAt[0].length && nOrd === 0) { /* nothing to assign */ }
      rec(0, 0);
      leaves = leaves.filter(function (l) { return l.s >= best - KEEP; }).sort(function (a, b) { return b.s - a.s; });
      return { leaves: leaves, best: best, nodes: nodes, over: over };
    }

    /* ---- reading the key ------------------------------------------------- */

    var PEN = 7;          // a row whose code is not in the table, or a repeated code
    var MARGIN = 2.5;     // solutions this close to the best count as possible
    var LSCALE = 14;      // NCC -> log prior

    function readKey(img, o, tick) {
      var t0 = Date.now();
      var res = { ok: false, rows: [], columns: [], warnings: [], stats: {} };
      var paper = paperOf(img);
      if (paper.share < 0.2) res.warnings.push('the background is not one plain colour');
      var mask = maskOf(img, paper, 56);
      var cc = components(img, mask);
      tick('layout', 20);
      var H = textHeight(cc.comps, img.h);
      if (!H) { res.reason = 'no-key'; res.message = 'There is no text in this picture that looks like a colour key.'; return res; }
      /* ruled tables: long thin lines joined every swatch into one block; take them out */
      var mask2 = maskOf(img, paper, 14);
      var ruled = removeRules(mask, img.w, img.h, H) + removeRules(mask2, img.w, img.h, H);
      if (ruled) { cc = components(img, mask); res.stats.rules = ruled; }
      /* a chart (or a photo) on the same page: a big, dense block of ink. Nothing inside it is key text */
      var regions = cc.comps.filter(function (c) { return c.w > 15 * H && c.h > 15 * H && c.n / (c.w * c.h) > 0.12; }).filter(function (c) {
        var ink = 0, tot = 0;
        for (var y = c.y0; y <= c.y1; y += 2) for (var x = c.x0; x <= c.x1; x += 2) { tot++; if (mask[y * img.w + x]) ink++; }
        return ink / tot > 0.25;
      });
      res.stats.regions = regions.length;
      /* swatches on a fainter mask, so a pale swatch with no outline is still a block */
      var cc2 = components(img, mask2);
      var swatches = findSwatches(img, cc, H, paper, cc2);
      swatches = swatches.filter(function (s) {
        return !regions.some(function (R0) { return s.cx > R0.x0 && s.cx < R0.x1 && s.cy > R0.y0 && s.cy < R0.y1; });
      });
      var swIds = {};
      swatches.forEach(function (s) { if (!s.faint) swIds[s.id] = 1; });
      /* components inside a swatch's box are the swatch or its symbol, not text */
      var inBox = {};
      cc.comps.forEach(function (c) {
        for (var i = 0; i < swatches.length; i++) {
          var s = swatches[i];
          if (c.x0 >= s.x0 - 1 && c.x1 <= s.x1 + 1 && c.y0 >= s.y0 - 1 && c.y1 <= s.y1 + 1) { inBox[c.id] = s; return; }
        }
      });
      var items = cc.comps.filter(function (c) {
        if (swIds[c.id] || inBox[c.id]) return false;
        for (var ri0 = 0; ri0 < regions.length; ri0++) {
          var R0 = regions[ri0];
          if (c.cx > R0.x0 && c.cx < R0.x1 && c.cy > R0.y0 && c.cy < R0.y1) return false;
        }
        if (c.n < 2) return false;
        if (c.h > 3 * H || c.w > 12 * H) return false;          // rules, pictures, overlays
        if (c.fill > 0.9 && c.w > 1.2 * H && c.h > 1.2 * H) return false;
        return true;
      });
      var lines = buildLines(items, H);
      lines.forEach(function (L) { L.glyphs = lineGlyphs(L); });
      var gap = wordGap(lines, H);
      lines.forEach(function (L) { L.words = words(L.glyphs, gap); });
      var rows = buildRows(lines, swatches, H, gap);
      rows.forEach(function (r, i) { r.ri = i; });
      tick('layout', 35);
      if (rows.length < 1) { res.reason = 'no-key'; res.message = 'No key rows were found in this picture.'; return res; }

      /* glyph descriptors and clusters, over the key rows only */
      var glyphs = [];
      rows.forEach(function (r) { r.toks.forEach(function (t) { t.g.forEach(function (g) { g.d = glyphDesc(img, cc, paper, g); glyphs.push(g); }); }); });
      var cl = clusterGlyphs(glyphs, H);
      tick('glyphs', 50);

      /* digit height: the tallest common glyph height (digits are cap height) */
      var hs = glyphs.map(function (g) { return g.y1 - g.y0 + 1; });
      var Hd = pctl(hs, 0.75) || H;
      scoreClusters(cl, o.tpl, Hd);
      tick('glyphs', 60);

      splitBrandPrefix(rows, cl);
      if (!swatches.length) {
        /* a key with no swatches: only lines that hold a short number-like word */
        rows = rows.filter(function (r) {
          return r.toks.length <= 10 && r.toks.some(function (t) {
            if (t.g.length > 5) return false;
            var s = 0;
            t.g.forEach(function (g) { s += cl[g.cl].tpl ? cl[g.cl].digitness : 0; });
            return s / t.g.length > 0;
          });
        });
        rows.forEach(function (r, i) { r.ri = i; });
        if (!rows.length) { res.reason = 'no-key'; res.message = 'No key rows were found in this picture.'; return res; }
      }
      var cols = buildColumns(rows, H);
      cols.forEach(function (c) { typeColumn(c, cl, rows); });
      var plan = planColumns(cols, rows, swatches);
      res.stats.H = H; res.stats.Hd = Hd; res.stats.gap = Math.round(gap * 10) / 10;
      res.stats.clusters = cl.length;
      if (!plan.code) {
        res.reason = 'no-key';
        res.message = 'No column of floss numbers was found in this picture.';
        res.rows = rows.map(function (r) { return rowOut(r, img, cols, plan); });
        return res;
      }

      /* split run-together digits in the numeric columns, then re-cluster those */
      var numericCols = plan.numeric;
      var redo = false;
      numericCols.forEach(function (c) {
        for (var k in c.byRow) {
          if (rows[k] && rows[k].extra) continue;     // a header word is not run-together digits
          c.byRow[k].forEach(function (t) {
            var ng = [];
            t.g.forEach(function (g) {
              var parts = splitWide(img, cc, paper, g, Hd);
              if (parts.length > 1) { redo = true; parts.forEach(function (p) { p.d = glyphDesc(img, cc, paper, p); }); }
              ng = ng.concat(parts);
            });
            t.g = ng;
          });
        }
      });
      if (redo) {
        glyphs = [];
        rows.forEach(function (r) { r.toks.forEach(function (t) { t.g.forEach(function (g) { glyphs.push(g); }); }); });
        cl = clusterGlyphs(glyphs, H);
        scoreClusters(cl, o.tpl, Hd);
        res.stats.clusters = cl.length;
      }

      tick('solve', 65);
      var sol = solveKey(rows, cols, plan, cl, o, swatches, H);
      tick('solve', 90);
      /* the brand printed beside or above the numbers: only DMC can be checked against a table */
      var seen = brandSeen(img, cc, paper, rows, lines, plan, o.tpl, Hd, H);
      res.brandSeen = seen;
      if (seen && seen !== 'DMC') {
        sol.rows.forEach(function (rd) {
          rd.status = 'blank'; rd.code = null; rd.text = ''; rd.candidates = []; rd.confidence = 0;
          rd.evidence = ['brand ' + seen];
          rd.why = 'this key lists ' + seen + ' numbers; only DMC numbers can be read from a picture';
          rd.countRead = null; rd.countStatus = 'not-read'; rd.countWhy = 'not read: the key is not DMC';
        });
        res.warnings.push('The key lists ' + seen + ' numbers, which cannot be checked; only DMC keys are read from a picture.');
      }
      /* a left column that does not count 1..n is the symbol column after all */
      if (plan.index) {
        var seqOk = 0;
        sol.rows.forEach(function (rd, ri) { if (rd.cols && rd.cols.index === String(ri + 1)) seqOk++; });
        if (seqOk < 0.6 * rows.length) { plan.index.kind = 'symbol'; plan.symbol.unshift(plan.index); plan.index = null; }
      }

      /* names: the printed name against the table's own name */

      res.ok = true;
      res.H = H;
      res.paper = [paper.r, paper.g, paper.b];
      res.rows = [];
      rows.forEach(function (r, ri) {
        if (!swatches.length && !plan.code.byRow[ri]) return;      // not a key row
        if (r.extra && (!sol.rows[ri] || sol.rows[ri].status === 'blank')) return;   // a header or a note, not a row
        var ro = rowOut(r, img, cols, plan);
        ro.read = sol.rows[ri];
        ro.symbol = symbolOf(img, cc, paper, r, plan, H, swatches);
        res.rows.push(ro);
      });
      res.columns = cols.map(function (c) { return { kind: c.kind, x0: Math.round(c.a), x1: Math.round(c.b), rows: c.rows }; });
      res.solve = { nodes: sol.nodes, over: sol.over, leaves: sol.leaves, best: sol.best, codeCol: plan.code.i, mapping: sol.mapping, dbg: sol.dbg };
      res.stats.ms = Date.now() - t0;
      if (o.debug) res.dbg = { H: H, Hd: Hd, gap: gap, swatches: swatches.map(function (s) { return [s.x0, s.y0, s.w, s.h, s.hex, s.swKind, s.faint ? 1 : 0, s.stacked ? 1 : 0].join(" "); }), rows: rows.map(function (r) { return r.toks.map(function (t) { return t.g.map(function (g) { return g.cl + (g.x1 - g.x0 + 1 > g.y1 - g.y0 + 1 ? "[" + (g.x1 - g.x0 + 1) + "x" + (g.y1 - g.y0 + 1) + "]" : ""); }).join("."); }).join(" | "); }), cols: cols.map(function (c) { return c.kind + "@" + Math.round(c.a) + ".." + Math.round(c.b) + " n" + c.rows + " d" + Math.round(c.digitShare * 100); }) };
      return res;
    }

    /**
     * "DMC310" set too tight to split as words: when most rows' first word
     * right of the swatch starts with the same run of glyph shapes (>= 2),
     * that run is a brand label and the rest is its own word.
     */
    function splitBrandPrefix(rows, cl) {
      var firsts = [];
      rows.forEach(function (r) {
        var t = r.toks.filter(function (w) { return w.x0 >= r.ax; }).sort(function (a, b) { return a.x0 - b.x0; })[0];
        if (t) firsts.push({ r: r, t: t });
      });
      if (firsts.length < 2) return;
      var counts = {};
      firsts.forEach(function (f) {
        for (var n = 2; n <= Math.min(6, f.t.g.length - 1); n++) {
          var k = f.t.g.slice(0, n).map(function (g) { return g.cl; }).join(',');
          counts[k] = (counts[k] || 0) + 1;
        }
      });
      var best = '', bn = 0;
      for (var k in counts) {
        var len = k.split(',').length;
        if (counts[k] > bn || (counts[k] === bn && len > best.split(',').length)) { bn = counts[k]; best = k; }
      }
      if (!best || bn < Math.max(2, 0.6 * firsts.length)) return;
      var pre = best.split(',').map(Number), n0 = pre.length;
      /* only split when it is not already a word of its own */
      firsts.forEach(function (f) {
        var g = f.t.g;
        if (g.length <= n0) return;
        for (var i = 0; i < n0; i++) if (g[i].cl !== pre[i]) return;
        var a = g.slice(0, n0), b = g.slice(n0);
        var wa = { g: a, x0: a[0].x0, x1: a[a.length - 1].x1, y0: Math.min.apply(null, a.map(function (x) { return x.y0; })), y1: Math.max.apply(null, a.map(function (x) { return x.y1; })) };
        var wb = { g: b, x0: b[0].x0, x1: b[b.length - 1].x1, y0: Math.min.apply(null, b.map(function (x) { return x.y0; })), y1: Math.max.apply(null, b.map(function (x) { return x.y1; })) };
        var idx = f.r.toks.indexOf(f.t);
        f.r.toks.splice(idx, 1, wa, wb);
      });
    }

    /**
     * Which brand the key names, from its brand column ("DMC 310") or the header over the code
     * column ("DMC", "ANCHOR"). Letters are matched to font templates only, so a word is taken
     * only when every letter is a close match. 'DMC', 'Anchor', 'AuriFloss', ... or null.
     */
    var BRAND_WORDS = [['DMC', 'DMC'], ['dmc', 'DMC'], ['Anchor', 'Anchor'], ['ANCHOR', 'Anchor'], ['AuriFloss', 'AuriFloss'],
      ['Aurifloss', 'AuriFloss'], ['AURIFLOSS', 'AuriFloss'], ['Aurifil', 'Aurifil'], ['AURIFIL', 'Aurifil'], ['Madeira', 'Madeira'],
      ['MADEIRA', 'Madeira'], ['Cosmo', 'Cosmo'], ['COSMO', 'Cosmo']];
    function brandSeen(img, cc, paper, rows, lines, plan, tp, Hd, H) {
      if (!tp || !plan.code) return null;
      function word(gs) {
        if (!gs || gs.length < 3 || gs.length > 9) return null;
        var ks = gs.map(function (g) {
          if (!g.d) g.d = glyphDesc(img, cc, paper, g);
          return { z: g.d.z, h: g.y1 - g.y0 + 1 };
        });
        scoreClusters(ks, tp, Hd);
        for (var i = 0; i < BRAND_WORDS.length; i++) {
          var w = BRAND_WORDS[i][0];
          if (w.length !== gs.length) continue;
          var ok = true;
          for (var k = 0; k < w.length && ok; k++) if (letterRank(ks[k], tp, w.charAt(k)) > 3) ok = false;
          if (ok) return BRAND_WORDS[i][1];
        }
        return null;
      }
      var votes = {};
      if (plan.brand) {
        for (var k in plan.brand.byRow) {
          if (rows[k] && rows[k].extra) continue;
          var b = word(tokGlyphs(plan.brand.byRow[k]));
          if (b) votes[b] = (votes[b] || 0) + 1;
        }
      }
      /* the header line just above the first row, over the code column */
      var main = rows.filter(function (r) { return !r.extra && r.line; });
      if (main.length) {
        var r0 = main[0], above = null;
        lines.forEach(function (L) {
          if (L.cyM >= r0.line.cyM - 0.6 * H || L.cyM < r0.line.cyM - 4 * H) return;
          if (!above || L.cyM > above.cyM) above = L;
        });
        if (above) above.words.forEach(function (wd) {
          var a = wd.x0 - r0.ax, bb = wd.x1 - r0.ax;
          if (bb < plan.code.a - H || a > plan.code.b + H) return;
          var b2 = word(wd.g);
          if (b2) votes[b2] = (votes[b2] || 0) + 2;
        });
      }
      var best = null, bn = 0;
      for (var v in votes) if (votes[v] > bn) { bn = votes[v]; best = v; }
      return best;
    }

    /** a code written as a word: White, Blanc, Ecru */
    var WORD_CODES = [['White', 'White'], ['WHITE', 'White'], ['white', 'White'], ['Blanc', 'White'], ['BLANC', 'White'], ['blanc', 'White'],
      ['Ecru', 'Ecru'], ['ECRU', 'Ecru'], ['ecru', 'Ecru']];
    function wordCode(g, cl, tp) {
      if (!tp || g.length < 4 || g.length > 5) return null;
      var best = null;
      WORD_CODES.forEach(function (wc) {
        if (wc[0].length !== g.length || best) return;
        var worst = 0;
        for (var i = 0; i < g.length; i++) worst = Math.max(worst, letterRank(cl[g[i].cl], tp, wc[0].charAt(i)));
        if (worst <= 3) best = { word: wc[0], code: wc[1], worst: worst };
      });
      return best;
    }
    function letterish(g, cl) {
      if (g.length < 3) return false;
      var s = 0;
      g.forEach(function (x) { s += cl[x.cl].tpl ? cl[x.cl].digitness : 0; });
      return s / g.length < -0.04;
    }

    function typeColumn(c, cl, rows) {
      var dig = 0, n = 0, lens = [], seqs = {};
      var main = 0;
      for (var k in c.byRow) {
        if (rows[k] && rows[k].extra) continue;
        main++;
        var gl = tokGlyphs(c.byRow[k]);
        lens.push(gl.length);
        var key = gl.map(function (g) { return g.cl; }).join(',');
        seqs[key] = (seqs[key] || 0) + 1;
        gl.forEach(function (g) { var K = cl[g.cl]; if (K.tpl) { dig += K.digitness > -0.02 ? 1 : 0; n++; } });
      }
      c.digitShare = n ? dig / n : 0;
      c.maxLen = Math.max.apply(null, lens.concat([0]));
      c.medLen = median(lens);
      c.words = 0;
      for (var k2 in c.byRow) if (!(rows[k2] && rows[k2].extra)) c.words = Math.max(c.words, c.byRow[k2].length);
      var top = 0;
      for (var s in seqs) if (seqs[s] > top) top = seqs[s];
      c.main = main;
      c.constant = main >= 2 && top === main;
      c.numeric = c.digitShare >= 0.6 && c.maxLen <= 6 && c.words <= 2;
    }

    /** which column is which, for an anchored key */
    function planColumns(cols, rows, swatches) {
      var plan = { code: null, count: null, index: null, numeric: [], name: null, symbol: [], brand: null };
      var nRows = rows.filter(function (r) { return !r.extra; }).length || rows.length;
      var all = cols.filter(function (c) { return c.rows >= Math.max(swatches.length ? 1 : 2, 0.5 * nRows); }).sort(function (a, b) { return a.a - b.a; });
      var nums = all.filter(function (c) { return c.numeric && !c.constant; });
      /* a short first number column, leftmost of all, is the row number (1, 2, 3 ...) */
      if (nums.length >= 2 && nums[0] === all[0] && nums[0].maxLen <= 2) { plan.index = nums.shift(); plan.index.kind = 'index'; }
      /* the code: the first other number column (a brand word may sit before it) */
      if (nums.length) { plan.code = nums[0]; plan.code.kind = 'code'; }
      var codeAt = plan.code ? all.indexOf(plan.code) : -1, sawName = false;
      all.forEach(function (c, i) {
        if (c.kind) return;
        if (c.constant && !c.numeric) { c.kind = 'brand'; plan.brand = c; return; }
        if (c.numeric) {
          /* a number column after a name column is a stitch count; one right after the code is
             another brand's number (DMC / Anchor) */
          c.kind = (i > codeAt && sawName) ? 'count' : 'number';
          if (c.kind === 'count') plan.count = c;
          return;
        }
        if ((c.medLen <= 1 && c.maxLen <= 2) || (c.b < 0 && c.words <= 1 && c.medLen <= 3 && swatches.length)) { c.kind = 'symbol'; plan.symbol.push(c); return; }
        c.kind = 'name';
        if (i > codeAt) sawName = true;
        if (!plan.name || c.rows > plan.name.rows) plan.name = c;
      });
      /* only the last count column counts */
      var counts = all.filter(function (c) { return c.kind === 'count'; });
      counts.slice(0, -1).forEach(function (c) { c.kind = 'number'; });
      plan.count = counts.length ? counts[counts.length - 1] : null;
      cols.forEach(function (c) { if (!c.kind) c.kind = 'text'; });
      plan.numeric = cols.filter(function (c) { return c.kind === 'code' || c.kind === 'count' || c.kind === 'index' || c.kind === 'number'; });
      return plan;
    }

    function rowOut(r, img, cols, plan) {
      var cells = [];
      if (r.swatch) cells.push({ kind: 'swatch', box: bx(r.swatch, img) });
      cols.forEach(function (c) {
        var t = c.byRow[rows_indexOf(r)];
        if (!t) return;
        var x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        t.forEach(function (w) { x0 = Math.min(x0, w.x0); y0 = Math.min(y0, w.y0); x1 = Math.max(x1, w.x1); y1 = Math.max(y1, w.y1); });
        cells.push({ kind: c.kind, box: bx({ x0: x0, y0: y0, x1: x1, y1: y1 }, img) });
      });
      var X0 = 1e9, Y0 = 1e9, X1 = -1, Y1 = -1;
      cells.forEach(function (c) { X0 = Math.min(X0, c.box.x); Y0 = Math.min(Y0, c.box.y); X1 = Math.max(X1, c.box.x + c.box.w); Y1 = Math.max(Y1, c.box.y + c.box.h); });
      return {
        box: cells.length ? { x: X0, y: Y0, w: X1 - X0, h: Y1 - Y0 } : null,
        cells: cells,
        swatchHex: r.swatch && !r.swatch.paperLike ? r.swatch.hex : (r.swatch && r.swatch.swKind === 'box' ? r.swatch.hex : (r.swatch ? r.swatch.hex : null)),
        swatchKind: r.swatch ? r.swatch.swKind : null
      };
      function rows_indexOf(row) { return row.ri; }
    }
    function bx(c, img) { return { x: c.x0 + img.ox, y: c.y0 + img.oy, w: c.x1 - c.x0 + 1, h: c.y1 - c.y0 + 1 }; }

    /* ---- the key solve ---------------------------------------------------- */

    function solveKey(rows, cols, plan, cl, o, swatches, H) {
      rows.forEach(function (r, i) { r.ri = i; });
      var table = o.table || [];
      var valid = {};
      table.forEach(function (t, i) { if (/^\d+$/.test(t.code)) valid[t.code] = i; });
      /* 2017 colours print as '04' as well as '4' */
      table.forEach(function (t, i) { if (/^\d$/.test(t.code)) valid['0' + t.code] = i; });
      /* colour evidence only from a key printed in colour: a black-and-white sheet's "swatches" are symbols */
      var chromatic = swatches.filter(function (s) { return Math.sqrt(s.lab[1] * s.lab[1] + s.lab[2] * s.lab[2]) >= 12; }).length;
      var colourful = swatches.length >= 2 && chromatic >= Math.max(2, 0.5 * swatches.length);
      var chart = o.chart || null;

      /* the clusters that take part, and their priors */
      var used = {}, list = [];
      var tokOf = function (c, r) { var t = c.byRow[r]; return t ? tokGlyphs(t) : null; };
      /* a glyph seen once that is plainly a noisy copy of a common shape joins it (fewer unknowns) */
      var numG = [], seenN = {};
      plan.numeric.forEach(function (c) { for (var k in c.byRow) tokGlyphs(c.byRow[k]).forEach(function (g) { numG.push(g); seenN[g.cl] = (seenN[g.cl] || 0) + 1; }); });
      numG.forEach(function (g) {
        var K = cl[g.cl];
        if (seenN[g.cl] !== 1 || !K.tpl) return;
        var best = -1, bs = 0.86;
        for (var id in seenN) {
          var J = cl[+id];
          if (+id === g.cl || seenN[id] < 2 || !J.tpl || J.bestDigitCh !== K.bestDigitCh) continue;
          if (Math.abs(J.h - K.h) > 0.2 * J.h) continue;
          var s = ncc(K.z, J.z);
          if (s > bs) { bs = s; best = +id; }
        }
        if (best >= 0) { seenN[g.cl]--; g.cl = best; seenN[best]++; }
      });
      var solveRows = rows.map(function (r, ri) {
        var toks = [];
        plan.numeric.forEach(function (c) {
          var g = tokOf(c, ri);
          if (!g || !g.length) return;
          if (c.kind === 'code' && letterish(g, cl)) return;      // a word code, read apart
          if (g.length > 6 || (rows[ri].extra && g.length > 5)) return;   // prose, not a number
          var ids = g.map(function (x) { return x.cl; });
          toks.push({ kind: c.kind, col: c.i, cl: ids });
          ids.forEach(function (id) { if (!used[id]) { used[id] = 1; list.push(id); } });
        });
        return { toks: toks, ri: ri };
      });
      var nc = cl.length;
      var L = [];
      for (var c = 0; c < nc; c++) {
        var row = new Float32Array(10);
        for (var d = 0; d < 10; d++) row[d] = -1e9;
        var K = cl[c];
        if (used[c] && K.tpl) {
          var cand = [];
          for (d = 0; d < 10; d++) cand.push({ d: d, s: K.tpl[d] });
          cand.sort(function (a, b) { return b.s - a.s || a.d - b.d; });
          var top = cand[0].s;
          for (var q = 0; q < cand.length && q < 6; q++) {
            if (cand[q].s < top - 0.22 && q >= 2) break;
            row[cand[q].d] = LSCALE * (cand[q].s - top);
          }
        } else if (used[c]) {
          for (d = 0; d < 10; d++) row[d] = 0;
        }
        L.push(row);
      }
      /* order: the clusters of the code column first, most frequent first */
      var freq = {};
      solveRows.forEach(function (r) { r.toks.forEach(function (t) { t.cl.forEach(function (id) { freq[id] = (freq[id] || 0) + (t.kind === 'code' ? 10 : 1); }); }); });
      list.sort(function (a, b) { return freq[b] - freq[a] || a - b; });

      /* chart classes: count and colour */
      var classes = chart && chart.classes ? chart.classes : [];
      var total = o.total || (chart && chart.total) || null;

      var codeCount = {};
      var rowState = new Array(rows.length);
      var rowMax = rows.map(function (r, ri) {
        var m = 0;
        solveRows[ri].toks.forEach(function (t) {
          if (t.kind === 'index') m += 1;
          if (t.kind === 'count' && classes.length) m += 1.5;
        });
        return m;
      });
      var csCache = {};
      function codeScore(ri, s) {
        var ck = ri + ':' + s, hit = csCache[ck];
        if (hit) return hit;
        return (csCache[ck] = codeScore0(ri, s));
      }
      function codeScore0(ri, s) {
        var ti = valid[s];
        if (ti === undefined || (s.length > 1 && s.charAt(0) === '0' && s.length > 2)) return { ok: false, s: -PEN };
        var sc = 0, sw = rows[ri].swatch, dE = null;
        if (colourful && sw && !sw.paperLike && table[ti].lab) {
          dE = de2000(sw.lab, table[ti].lab);
          sc -= Math.min(4, Math.max(0, dE - 6) * 0.18);
        } else if (colourful && sw && sw.paperLike && table[ti].lab) {
          dE = de2000(sw.lab, table[ti].lab);
          sc -= Math.min(4, Math.max(0, dE - 6) * 0.18);
        }
        return { ok: true, s: sc, ti: ti, dE: dE };
      }
      function countMatch(ri, v) {
        if (!classes.length || !(v > 0)) return false;
        var sw = rows[ri].swatch;
        for (var i = 0; i < classes.length; i++) {
          var k = classes[i];
          if (Math.abs(k.count - v) > 1) continue;
          if (!sw || !k.lab || sw.paperLike || de2000(sw.lab, k.lab) < 20) return true;
        }
        return false;
      }
      var P = {
        nc: nc, order: list, L: L, rows: solveRows, rowMax: rowMax, keep: MARGIN + 3, budget: o.budget || 200000,
        leafMax: (total ? 6 : 0) + 1.5,
        same: function (a, b) {
          var A = cl[a], B = cl[b];
          return A.tpl && B.tpl && ncc(A.z, B.z) >= 0.8 && A.bestDigitCh === B.bestDigitCh;
        },
        evalRow: function (ri, strs) {
          var s = 0, toks = solveRows[ri].toks, st = { code: null };
          for (var i = 0; i < toks.length; i++) {
            var t = toks[i], v = strs[i];
            if (t.kind === 'code') {
              var cs = codeScore(ri, v);
              s += cs.s;
              if (cs.ok) {
                var key = table[cs.ti].code;
                if (codeCount[key]) s -= PEN;
                codeCount[key] = (codeCount[key] || 0) + 1;
                st.code = key;
              }
            } else {
              if (v.length > 1 && v.charAt(0) === '0') s -= 3;
              if (t.kind === 'index' && +v === ri + 1) s += 1;
              if (t.kind === 'count' && countMatch(ri, +v)) s += 1.5;
            }
          }
          rowState[ri] = st;
          return s;
        },
        undoRow: function (ri) {
          var st = rowState[ri];
          if (st && st.code) { codeCount[st.code]--; if (!codeCount[st.code]) delete codeCount[st.code]; }
          rowState[ri] = null;
        },
        evalLeaf: function (asg) {
          var s = 0;
          if (plan.count && total) {
            var sum = 0, all = true;
            rows.forEach(function (r, ri) {
              var t = plan.count.byRow[ri];
              if (!t && r.extra) return;
              if (!t) { all = false; return; }
              var str = tokGlyphs(t).map(function (g) { return asg[g.cl]; }).join('');
              sum += +str;
            });
            if (all && Math.abs(sum - total) <= rows.length) s += 6;
          }
          /* keys are often sorted by code */
          var prev = -1, sorted = true, n = 0;
          rows.forEach(function (r, ri) {
            var t = plan.code.byRow[ri];
            if (!t) return;
            var v = +tokGlyphs(t).map(function (g) { return asg[g.cl]; }).join('');
            if (v < prev) sorted = false;
            prev = v; n++;
          });
          if (sorted && n >= 4) s += 1.5;
          return s;
        }
      };
      var out = bnb(P);

      /* decide each row */
      var best = out.best, near = out.leaves.filter(function (l) { return l.s >= best - MARGIN; });
      var rowsRead = rows.map(function (r, ri) {
        var t = plan.code.byRow[ri];
        var rd = { status: 'blank', text: '', candidates: [], evidence: [], confidence: 0, code: null, swatchHex: r.swatch ? r.swatch.hex : null, countRead: null, dE: null };
        if (!t) { rd.why = 'no code in this row'; return rd; }
        var g = tokGlyphs(t);
        /* a code written as a word (White, Blanc, Ecru) */
        if (letterish(g, cl)) {
          var wc = wordCode(g, cl, o.tpl);
          if (!wc) { rd.why = 'a word, not a number'; return rd; }
          var wti = -1;
          table.forEach(function (e, i) { if (e.code === wc.code) wti = i; });
          if (wti < 0) return rd;
          var sw0 = r.swatch, light = colourful && sw0 && sw0.lab && sw0.lab[0] >= 85;
          if (light && wc.worst <= 2) {
            rd.status = 'pending'; rd.code = wc.code; rd.text = wc.word; rd.ti = wti; rd.indep = true;
            rd.evidence = ['word ' + wc.word, 'swatch light'];
            rd.dE = sw0 && table[wti].lab ? Math.round(de2000(sw0.lab, table[wti].lab) * 10) / 10 : null;
          } else {
            rd.status = 'partial'; rd.text = wc.word; rd.candidates = [wc.code]; rd.evidence = ['word ' + wc.word];
            rd.why = 'the word fits, but nothing else confirms it'; rd.confidence = 0.5;
          }
          return rd;
        }
        if (!near.length || g.length > 5) { rd.why = 'no reading fits'; return rd; }
        var codes = {}, strs = [];
        near.forEach(function (l) {
          var s = g.map(function (x) { return l.asg[x.cl]; }).join('');
          if (!codes.hasOwnProperty(s)) { codes[s] = l.s; strs.push(s); }
        });
        var validStrs = strs.filter(function (s) { return valid[s] !== undefined; });
        var bestStr = g.map(function (x) { return near[0].asg[x.cl]; }).join('');
        var bestValid = valid[bestStr] !== undefined;
        if (strs.length === 1 && bestValid) {
          var ti = valid[bestStr], ev = ['table'];
          var cs = codeScore(ri, bestStr);
          var indep = false;
          if (cs.dE !== null) { rd.dE = Math.round(cs.dE * 10) / 10; if (cs.dE <= 18) { ev.push('swatch dE ' + rd.dE); indep = true; } }
          if (plan.count && plan.count.byRow[ri]) {
            var cstr = tokGlyphs(plan.count.byRow[ri]).map(function (x) { return near[0].asg[x.cl]; }).join('');
            var allSame = near.every(function (l) { return tokGlyphs(plan.count.byRow[ri]).map(function (x) { return l.asg[x.cl]; }).join('') === cstr; });
            if (allSame && !(cstr.length > 1 && cstr.charAt(0) === '0')) {
              rd.countRead = +cstr;
              if (countMatch(ri, +cstr)) { ev.push('count ' + cstr + ' = chart'); indep = true; }
            }
          }
          /* every glyph a clear template match for its digit */
          var strong = g.every(function (x) {
            var K = cl[x.cl], d = near[0].asg[x.cl], sec = -2;
            if (!K.tpl) return false;
            for (var dd = 0; dd < 10; dd++) if (dd !== d && K.tpl[dd] > sec) sec = K.tpl[dd];
            return K.tpl[d] >= 0.6 && K.tpl[d] - sec >= 0.1;
          });
          if (strong) ev.push('template');
          var supported = out.supportShare;
          rd.code = table[ti].code;
          rd.text = bestStr;
          rd.ti = ti;
          rd.evidence = ev;
          rd.indep = indep; rd.strong = strong;
          rd.status = 'pending';
          return rd;
        }
        /* not unique: the digits all near solutions agree on */
        var pool = validStrs.length ? validStrs : strs;
        var len = pool[0].length, same = pool.every(function (s) { return s.length === len; });
        if (same) {
          var txt = '';
          for (var p = 0; p < len; p++) {
            var ch = pool[0].charAt(p);
            txt += pool.every(function (s) { return s.charAt(p) === ch; }) ? ch : '?';
          }
          if (/\d/.test(txt) && validStrs.length && validStrs.length <= 6) {
            rd.status = 'partial'; rd.text = txt; rd.candidates = validStrs.map(function (s) { return table[valid[s]].code; });
            rd.evidence = ['table'];
            rd.confidence = Math.round(100 / validStrs.length) / 100;
            return rd;
          }
        }
        rd.why = validStrs.length ? 'too many readings fit' : 'no reading fits';
        return rd;
      });

      /* how much of the key the best solution explains */
      var expl = 0, withCode = 0;
      rowsRead.forEach(function (rd) { if (rd.status !== 'blank' || rd.code) expl++; });
      rows.forEach(function (r, ri) { if (plan.code.byRow[ri]) withCode++; });
      var share = withCode ? rowsRead.filter(function (rd) { return rd.status === 'pending'; }).length / withCode : 0;
      /* row numbers 1, 2, 3 ... are real DMC codes since 2017: a column that counts up by one
         from 1 is a numbering, not a key, unless the swatches say otherwise */
      var pend = rowsRead.filter(function (rd) { return rd.status === 'pending'; });
      var counting = pend.length >= 3 && pend.every(function (rd, i) { return +rd.text === i + 1 || +rd.text === +pend[0].text + i; }) && +pend[0].text <= 2;
      rowsRead.forEach(function (rd) {
        if (rd.status !== 'pending') return;
        if (counting) { rd.indep = false; rd.strong = false; rd.whyNot = 'these count up 1, 2, 3: row numbers, not codes'; }
        /* a one- or two-digit code (DMC 1 to 35) needs the swatch or the count to back it */
        else if (/^\d{1,2}$/.test(rd.text)) rd.strong = false;
      });
      /* the printed name matching the table's own name for the code is a check of its own */
      if (plan.name && !counting) {
        checkNames(rows, plan.name, cl, o, { rows: rowsRead }, H);
        rowsRead.forEach(function (rd) { if (rd.status === 'pending' && rd.nameMatched) rd.indep = true; });
      }
      rowsRead.forEach(function (rd) {
        if (rd.status !== 'pending') return;
        /* exact needs an independent check, or strong glyphs in a key that is mostly explained */
        /* a search cut short by its budget may have missed a rival reading: then both checks are needed */
        if (out.over ? (rd.indep && rd.strong) : (rd.indep || (rd.strong && share >= 0.8 && withCode >= 3))) {
          rd.status = 'exact';
          rd.confidence = Math.min(0.99, 0.6 + (rd.indep ? 0.25 : 0) + (rd.strong ? 0.1 : 0) + share * 0.04);
        } else {
          rd.status = 'partial';
          rd.candidates = [rd.code];
          rd.text = rd.text.replace(/./g, function (ch, i) { return i === 0 ? ch : ch; });
          rd.why = rd.whyNot || 'one reading fits, but nothing else confirms it';
          rd.confidence = 0.5;
          rd.code = null;
        }
      });
      /* every row says what became of its stitch count: read, not read (and why), or no count column */
      rowsRead.forEach(function (rd, ri) {
        if (rows[ri].extra && rd.status === 'blank') return;
        if (!plan.count) { rd.countStatus = 'none'; rd.countWhy = 'the key prints no stitch counts'; rd.countRead = null; return; }
        var t = plan.count.byRow[ri];
        if (!t) { rd.countStatus = 'not-read'; rd.countWhy = 'no count was found on this row'; rd.countRead = null; return; }
        var g = tokGlyphs(t);
        if (rd.countRead == null && near.length && g.length <= 6) {
          var s0 = g.map(function (x) { return near[0].asg[x.cl]; }).join('');
          var same = near.every(function (l) { return g.map(function (x) { return l.asg[x.cl]; }).join('') === s0; });
          if (same && /^[1-9]\d*$/.test(s0)) rd.countRead = +s0;
        }
        if (rd.countRead != null) { rd.countStatus = 'read'; rd.countWhy = null; }
        else {
          rd.countStatus = 'not-read';
          rd.countWhy = g.length > 6 ? 'the count could not be cut into digits' : 'the count\'s digits could not be pinned down';
        }
      });
      /* the mapping that was used */
      var mapping = {};
      if (near.length) list.forEach(function (id) { mapping[id] = near[0].asg[id]; });
      /* every column's decoded strings in the best solution (index, count, other numbers) */
      rowsRead.forEach(function (rd, ri) {
        rd.cols = {};
        if (!near.length) return;
        plan.numeric.forEach(function (c) {
          var t = c.byRow[ri];
          if (!t) return;
          var g = tokGlyphs(t), agree = true;
          var s0 = g.map(function (x) { return near[0].asg[x.cl]; }).join('');
          near.forEach(function (l) { if (g.map(function (x) { return l.asg[x.cl]; }).join('') !== s0) agree = false; });
          rd.cols[c.kind + (c.kind === 'number' ? c.i : '')] = agree ? s0 : null;
        });
      });
      return { rows: rowsRead, nodes: out.nodes, over: out.over, leaves: out.leaves.length, best: Math.round(best * 100) / 100, mapping: mapping, share: share,
        dbg: list.map(function (id) { var d = ''; for (var k = 0; k < 10; k++) if (L[id][k] > -1e8) d += k; return id + ':' + cl[id].members.length + ':' + d + ':' + (cl[id].tpl ? cl[id].bestDigitCh : '-'); }).join(' ') };
    }

    /** the printed name against the table's name for the code, word by word */
    var SAME_SHAPE = 'iljI1|';   // letters one glyph shape may stand for at small sizes
    function checkNames(rows, col, cl, o, sol, H) {
      var tp = o.tpl, table = o.table || [];
      if (!tp) return;
      var votes = {};
      var pending = [];
      rows.forEach(function (r, ri) {
        var rd = sol.rows[ri];
        if (!rd || (rd.status !== 'exact' && rd.status !== 'pending') || rd.ti === undefined) return;
        var toks = col.byRow[ri];
        if (!toks) return;
        var name = String(table[rd.ti].name || '');
        var tw = name.split(/[^A-Za-z]+/).filter(Boolean);
        var pw = toks.map(function (t) {
          return t.g.filter(function (g) {
            var h = g.y1 - g.y0 + 1, w = g.x1 - g.x0 + 1;
            return !(h < 0.45 * H && w >= h) && h >= 3;          // hyphens and dots
          });
        }).filter(function (x) { return x.length; });
        pending.push({ ri: ri, tw: tw, pw: pw });
      });
      var H0 = 0;
      pending.forEach(function (p) {
        /* match printed words to table words of the same length */
        var usedT = {}, pairs = [], ok = true, soft = 0;
        p.pw.forEach(function (gs) {
          var hit = -1;
          for (var k = 0; k < p.tw.length; k++) {
            if (usedT[k] || p.tw[k].length !== gs.length) continue;
            var bad = 0;
            for (var q = 0; q < gs.length; q++) if (letterRank(cl[gs[q].cl], tp, p.tw[k].charAt(q)) > 7) bad++;
            if (bad <= Math.floor(gs.length / 4)) { hit = k; break; }
          }
          if (hit < 0) {
            /* letters run together by kerning (Ve, ry) or a broken one: a word one glyph off is allowed, unchecked */
            for (k = 0; k < p.tw.length; k++) if (!usedT[k] && Math.abs(p.tw[k].length - gs.length) === 1) { hit = k; break; }
            if (hit < 0) ok = false; else { usedT[hit] = 1; soft++; }
          } else { usedT[hit] = 1; pairs.push([gs, p.tw[hit]]); }
        });
        if (ok && pairs.length + soft === p.tw.length && pairs.length && pairs.length >= soft) {
          p.pairs = pairs;
          pairs.forEach(function (pr) {
            pr[0].forEach(function (g, q) {
              var v = votes[g.cl] || (votes[g.cl] = {});
              var ch = pr[1].charAt(q);
              v[ch] = (v[ch] || 0) + 1;
            });
          });
        }
      });
      /* one glyph shape is one letter across the whole key */
      pending.forEach(function (p) {
        var rd = sol.rows[p.ri];
        rd.nameMatched = false;
        if (!p.pairs) return;
        var conflict = false;
        p.pairs.forEach(function (pr) {
          pr[0].forEach(function (g, q) {
            var v = votes[g.cl], ch = pr[1].charAt(q), top = 0, tc = '';
            for (var k in v) if (v[k] > top) { top = v[k]; tc = k; }
            if (tc.toLowerCase() !== ch.toLowerCase() && v[tc] > (v[ch] || 0) && !(SAME_SHAPE.indexOf(tc) >= 0 && SAME_SHAPE.indexOf(ch) >= 0)) conflict = true;
          });
        });
        if (!conflict) { rd.nameMatched = true; rd.evidence.push('name'); }
      });
      void H0;
    }

    /** the row's symbol: from the symbol column, or printed on the swatch */
    function symbolOf(img, cc, paper, r, plan, H, swatches) {
      var cell = r.swatch ? Math.max(r.swatch.w, r.swatch.h) : Math.round(1.3 * H);
      var sep = null, on = null;
      plan.symbol.forEach(function (c) {
        if (sep) return;
        var t = c.byRow[r.ri];
        if (!t || !t.length) return;
        var x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, ids = [];
        t.forEach(function (w) { w.g.forEach(function (g) { x0 = Math.min(x0, g.x0); y0 = Math.min(y0, g.y0); x1 = Math.max(x1, g.x1); y1 = Math.max(y1, g.y1); ids = ids.concat(g.ids); }); });
        var parts = t.length;
        var own = {};
        ids.forEach(function (id) { own[id] = 1; });
        var ink = 255;
        ids.forEach(function (id) { ink = Math.min(ink, cc.byId[id].minY); });
        var span = Math.max(30, paper.y - ink);
        var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        var side = Math.max(cell, x1 - x0 + 3, y1 - y0 + 3);
        var bits = bitmap(function (x, y) {
          if (x < 0 || y < 0 || x >= img.w || y >= img.h) return 0;
          var j = y * img.w + x, l = cc.lab[j];
          if (l && !own[l]) return 0;
          return (paper.y - img.Y[j]) / span;
        }, cx, cy, side);
        sep = { bits: bits, box: { x: x0 + img.ox, y: y0 + img.oy, w: x1 - x0 + 1, h: y1 - y0 + 1 }, parts: parts, contrast: (paper.y - ink) / Math.max(1, paper.y) };
      });
      if (r.swatch && r.swatch.swKind === 'fill') {
        var s = r.swatch, sl = s.rgb, inset = Math.max(1, Math.round(0.1 * s.w));
        var cnt = 0, tot = 0;
        var f = function (x, y) {
          if (x < s.x0 + inset || x > s.x1 - inset || y < s.y0 + inset || y > s.y1 - inset) return 0;
          var j = y * img.w + x;
          var d = Math.max(Math.abs(img.R[j] - sl[0]), Math.abs(img.G[j] - sl[1]), Math.abs(img.B[j] - sl[2]));
          return (d - 40) / 80;
        };
        for (var y = s.y0 + inset; y <= s.y1 - inset; y++) for (var x = s.x0 + inset; x <= s.x1 - inset; x++) { tot++; if (f(x, y) > 0.5) cnt++; }
        if (cnt >= 4 && cnt < 0.8 * tot) on = { bits: bitmap(f, (s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, Math.max(s.w, s.h)), box: { x: s.x0 + img.ox, y: s.y0 + img.oy, w: s.w, h: s.h } };
      } else if (r.swatch && r.swatch.swKind === 'box') {
        var b = r.swatch, ids2 = [];
        cc.comps.forEach(function (c) { if (c.x0 > b.x0 && c.x1 < b.x1 && c.y0 > b.y0 && c.y1 < b.y1) ids2.push(c.id); });
        if (ids2.length) {
          var own2 = {}; ids2.forEach(function (id) { own2[id] = 1; });
          on = { bits: bitmap(function (x, y) {
            var j = y * img.w + x;
            if (x <= b.x0 + 1 || x >= b.x1 - 1 || y <= b.y0 + 1 || y >= b.y1 - 1) return 0;
            var l = cc.lab[j];
            if (l && !own2[l]) return 0;
            return (paper.y - img.Y[j]) / Math.max(30, paper.y - 40);
          }, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, Math.max(b.w, b.h)), box: { x: b.x0 + img.ox, y: b.y0 + img.oy, w: b.w, h: b.h } };
        }
      }
      var pick = sep || on;
      if (!pick) return null;
      var ink = 0;
      for (var i = 0; i < pick.bits.length; i++) ink += pick.bits[i];
      var clean = ink >= 3 && ink <= 0.85 * DD;
      if (sep) clean = clean && sep.parts === 1 && sep.contrast >= 0.35;
      if (sep && on) {
        var a = 0, u = 0;
        for (i = 0; i < DD; i++) { if (sep.bits[i] && on.bits[i]) a++; if (sep.bits[i] || on.bits[i]) u++; }
        var iou = u ? a / u : 0;
        if (iou < 0.45) clean = false;
        pick.agree = Math.round(iou * 100) / 100;
      }
      return { w: D, h: D, bits: Array.prototype.slice.call(pick.bits), clean: !!clean, box: pick.box, onSwatch: !sep, agree: pick.agree === undefined ? null : pick.agree };
    }
    /** a 16 x 16 1-bit picture of the square of `side` px centred on (cx, cy) */
    function bitmap(val, cx, cy, side) {
      var out = new Uint8Array(DD), x0 = cx - side / 2, y0 = cy - side / 2, st = side / D;
      var sub = Math.max(1, Math.min(4, Math.ceil(st)));
      for (var ty = 0; ty < D; ty++) for (var tx = 0; tx < D; tx++) {
        var s = 0, n = 0;
        for (var sy = 0; sy < sub; sy++) for (var sx = 0; sx < sub; sx++) {
          var x = Math.floor(x0 + (tx + (sx + 0.5) / sub) * st), y = Math.floor(y0 + (ty + (sy + 0.5) / sub) * st);
          var v = val(x, y);
          s += v > 1 ? 1 : (v < 0 ? 0 : v); n++;
        }
        out[ty * D + tx] = s / n >= 0.42 ? 1 : 0;
      }
      return out;
    }

    /* ---- numbers in boxes (rulers, count columns) ------------------------- */

    function readNumbers(img, boxes, o) {
      var paper = paperOf(img);
      var mask = maskOf(img, paper, 56);
      var cc = components(img, mask);
      var all = [], per = [];
      boxes.forEach(function (b, bi) {
        var x0 = b.x - img.ox, y0 = b.y - img.oy, x1 = x0 + b.w, y1 = y0 + b.h;
        var its = cc.comps.filter(function (c) { return c.n >= 2 && c.cx >= x0 && c.cx <= x1 && c.cy >= y0 && c.cy <= y1; });
        var L = { items: its };
        per.push(lineGlyphs(L));
      });
      var hs = [];
      per.forEach(function (gl) { gl.forEach(function (g) { hs.push(g.y1 - g.y0 + 1); }); });
      var Hd = median(hs) || 10;
      per = per.map(function (gl) {
        var out = [];
        gl.forEach(function (g) {
          if (g.y1 - g.y0 + 1 < 0.5 * Hd) return;               // dots, ticks
          var parts = splitWide(img, cc, paper, g, Hd);
          parts.forEach(function (p) { p.d = glyphDesc(img, cc, paper, p); out.push(p); all.push(p); });
        });
        return out;
      });
      var cl = clusterGlyphs(all, Hd);
      scoreClusters(cl, o.tpl, Hd);
      var used = {}, list = [];
      per.forEach(function (gl) { gl.forEach(function (g) { if (!used[g.cl]) { used[g.cl] = 1; list.push(g.cl); } }); });
      var Lm = cl.map(function (K, c) {
        var row = new Float32Array(10);
        for (var d = 0; d < 10; d++) row[d] = -1e9;
        if (!K.tpl) { for (d = 0; d < 10; d++) row[d] = 0; return row; }
        var cand = [];
        for (d = 0; d < 10; d++) cand.push({ d: d, s: K.tpl[d] });
        cand.sort(function (a, b) { return b.s - a.s || a.d - b.d; });
        for (var q = 0; q < 6; q++) { if (cand[q].s < cand[0].s - 0.22 && q >= 2) break; row[cand[q].d] = LSCALE * (cand[q].s - cand[0].s); }
        return row;
      });
      var expect = o.expect || null, step = o.step || null;
      var rowsP = per.map(function (gl) { return { toks: gl.length ? [{ kind: 'n', cl: gl.map(function (g) { return g.cl; }) }] : [] }; });
      var vals = new Array(per.length);
      var P = {
        nc: cl.length, order: list, L: Lm, rows: rowsP, rowMax: rowsP.map(function () { return 0; }), keep: MARGIN + 3, budget: o.budget || 2000000,
        leafMax: expect ? 1.5 * Math.max(0, boxes.length - 1) : 0,
        same: function (a, b) { return cl[a].tpl && cl[b].tpl && ncc(cl[a].z, cl[b].z) >= 0.8 && cl[a].bestDigitCh === cl[b].bestDigitCh; },
        evalRow: function (ri, strs) {
          if (!strs.length) return 0;
          var v = strs[0];
          var s = (v.length > 1 && v.charAt(0) === '0') ? -PEN : 0;
          if (o.min !== undefined && +v < o.min) s -= PEN;
          if (o.max !== undefined && +v > o.max) s -= PEN;
          vals[ri] = +v;
          return s;
        },
        evalLeaf: function (asg) {
          if (!expect) return 0;
          var seq = [];
          per.forEach(function (gl) { if (gl.length) seq.push(+gl.map(function (g) { return asg[g.cl]; }).join('')); });
          if (seq.length < 2) return 0;
          /* pair by pair, so one badly cut number does not void the whole ruler */
          var diffs = [], i;
          for (i = 1; i < seq.length; i++) diffs.push(seq[i] - seq[i - 1]);
          var st0 = step || median(diffs), s = 0;
          for (i = 0; i < diffs.length; i++) {
            var good = expect === 'step' ? diffs[i] === st0 && st0 > 0 : diffs[i] > 0;
            s += good ? 1.5 : -2.5;
          }
          return s;
        }
      };
      var out = bnb(P), near = out.leaves.filter(function (l) { return l.s >= out.best - MARGIN; });
      return boxes.map(function (b, bi) {
        var gl = per[bi], r = { box: b, text: '', value: null, status: 'blank', confidence: 0 };
        if (!gl.length || !near.length) return r;
        var strs = {}, list2 = [];
        near.forEach(function (l) { var s = gl.map(function (g) { return l.asg[g.cl]; }).join(''); if (!strs[s]) { strs[s] = 1; list2.push(s); } });
        var strong = gl.every(function (g) {
          var K = cl[g.cl], d = near[0].asg[g.cl], sec = -2;
          if (!K.tpl) return false;
          for (var dd = 0; dd < 10; dd++) if (dd !== d && K.tpl[dd] > sec) sec = K.tpl[dd];
          return K.tpl[d] >= 0.6 && K.tpl[d] - sec >= 0.1;
        });
        if (list2.length === 1 && (expect || strong)) {
          r.text = list2[0]; r.value = +list2[0]; r.status = 'exact';
          r.confidence = expect ? (strong ? 0.97 : 0.85) : 0.75;
          return r;
        }
        var len = list2[0].length;
        if (list2.every(function (s) { return s.length === len; })) {
          var txt = '';
          for (var p = 0; p < len; p++) { var ch = list2[0].charAt(p); txt += list2.every(function (s) { return s.charAt(p) === ch; }) ? ch : '?'; }
          if (/\d/.test(txt)) { r.text = txt; r.status = 'partial'; r.confidence = 0.3; r.candidates = list2.slice(0, 6); }
        }
        return r;
      });
    }

    /* ---- jobs ------------------------------------------------------------- */

    function createJob(arg) {
      var o = arg.opts || {}, phase = 'layout', pct = 0, done = false, result = null, stage = 0, img = null;
      function tick(ph, p) { phase = ph; pct = p; }
      return {
        step: function () {
          if (done) return { done: true, phase: phase, pct: 100, result: result };
          if (stage === 0) {
            img = makeImage(arg.buf, arg.w, arg.h, o.crop);
            stage = 1; tick('layout', 5);
            return { done: false, phase: phase, pct: pct };
          }
          if (o.kind === 'numbers') result = { ok: true, numbers: readNumbers(img, o.boxes || [], o) };
          else result = readKey(img, o, tick);
          done = true;
          return { done: true, phase: 'assemble', pct: 100, result: result };
        }
      };
    }

    return {
      createJob: createJob,
      descOf: descOf,
      labOf: labOf,
      de2000: de2000,
      _readKey: readKey, _paperOf: paperOf
    };
  }

  /* ================================================================== *
   * 2. The worker body — also stringified
   * ================================================================== */

  function xskWorkerBody(core) {
    self.onmessage = function (ev) {
      var msg = ev.data || {};
      try {
        if (msg.t !== 'run') return;
        var job = core.createJob({ buf: msg.buf, w: msg.w, h: msg.h, opts: msg.opts });
        var r, last = -1;
        for (;;) {
          r = job.step();
          var p = Math.round(r.pct);
          if (p !== last) { last = p; self.postMessage({ t: 'progress', id: msg.id, phase: r.phase, pct: p }); }
          if (r.done) break;
        }
        self.postMessage({ t: 'done', id: msg.id, result: r.result });
      } catch (e) {
        self.postMessage({ t: 'error', id: msg.id, error: (e && e.message) ? e.message : String(e) });
      }
    };
  }

  /* ================================================================== *
   * 3. Worker plumbing (as in xstitch-read.js)
   * ================================================================== */

  var workerSrc = null, workerUrl = null, worker = null, running = null, queue = [];

  function buildWorkerSrc() {
    if (!workerSrc) workerSrc = ["'use strict';", String(XSKeyReadCore), String(xskWorkerBody), 'xskWorkerBody(XSKeyReadCore());'].join('\n');
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
    } catch (e) { worker = null; return null; }
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
    var msg = ev.data || {}, job = running;
    if (!job || job.id !== msg.id) return;
    if (msg.t === 'progress') { job.emit(msg.phase, 10 + msg.pct * 0.85); return; }
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
      var copy = job.px.buf.slice(0);
      wk.postMessage({ t: 'run', id: job.id, buf: copy, w: job.px.w, h: job.px.h, opts: job.core }, [copy]);
    } catch (e) {
      running = null;
      job.failWorker('postMessage failed');
      pump();
    }
  }

  /* ================================================================== *
   * 4. Main thread: pixels, templates, the floss table
   * ================================================================== */

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isCanvas(v) {
    return !!v && typeof v === 'object' && (typeof v.getContext === 'function' && typeof v.width === 'number');
  }
  function isImageData(v) {
    return !!v && !isCanvas(v) && typeof v.width === 'number' && typeof v.height === 'number' && v.data && typeof v.data.length === 'number';
  }

  /** source -> Promise<{ buf, w, h, scale }> over white */
  function toPixels(source) {
    return new Promise(function (resolve, reject) {
      if (!source) { reject(new Error('no-image')); return; }
      if (isImageData(source)) {
        var iw = source.width, ih = source.height, src = source.data;
        if (!iw || !ih) { reject(new Error('no-image')); return; }
        if (iw * ih > MAX_PIXELS) {
          var c0 = document.createElement('canvas');
          c0.width = iw; c0.height = ih;
          c0.getContext('2d').putImageData(source, 0, 0);
          draw(c0, iw, ih);
          return;
        }
        var out = new Uint8ClampedArray(iw * ih * 4);
        for (var i = 0; i < out.length; i += 4) {
          var a = src[i + 3], f = a / 255;
          out[i] = Math.round(src[i] * f + 255 * (1 - f));
          out[i + 1] = Math.round(src[i + 1] * f + 255 * (1 - f));
          out[i + 2] = Math.round(src[i + 2] * f + 255 * (1 - f));
          out[i + 3] = 255;
        }
        resolve({ buf: out.buffer, w: iw, h: ih, scale: 1 });
        return;
      }
      if (isCanvas(source) || (typeof W.ImageBitmap === 'function' && source instanceof W.ImageBitmap)) {
        draw(source, source.width, source.height);
        return;
      }
      if (typeof W.HTMLImageElement === 'function' && source instanceof W.HTMLImageElement) {
        draw(source, source.naturalWidth || source.width, source.naturalHeight || source.height);
        return;
      }
      if (typeof W.Blob === 'function' && source instanceof W.Blob) {
        if (typeof W.createImageBitmap === 'function') {
          W.createImageBitmap(source).then(function (bmp) {
            try { draw(bmp, bmp.width, bmp.height); } finally { try { bmp.close(); } catch (e) { /* ignore */ } }
          }, function () { reject(new Error('decode')); });
          return;
        }
        var url = W.URL.createObjectURL(source), img = new W.Image();
        img.onload = function () { try { draw(img, img.naturalWidth, img.naturalHeight); } finally { W.URL.revokeObjectURL(url); } };
        img.onerror = function () { W.URL.revokeObjectURL(url); reject(new Error('decode')); };
        img.src = url;
        return;
      }
      reject(new Error('no-image'));

      function draw(node, sw, sh) {
        if (!sw || !sh) { reject(new Error('no-image')); return; }
        var s = sw * sh > MAX_PIXELS ? Math.sqrt(MAX_PIXELS / (sw * sh)) : 1;
        var tw = Math.max(1, Math.round(sw * s)), th = Math.max(1, Math.round(sh * s));
        var cv = document.createElement('canvas');
        cv.width = tw; cv.height = th;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, tw, th);
        ctx.drawImage(node, 0, 0, sw, sh, 0, 0, tw, th);
        resolve({ buf: ctx.getImageData(0, 0, tw, th).data.buffer, w: tw, h: th, scale: tw / sw });
      }
    });
  }

  /* Digit and letter templates drawn with fillText in common faces. Only
     faces the browser actually has differ from the fallback; identical
     renderings are dropped. A prior for the solve, never the evidence. */
  var TPL_FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Segoe UI', 'Calibri', 'Trebuchet MS', 'Century Gothic',
    'Franklin Gothic Medium', 'Gill Sans', 'Lucida Sans', 'Candara', 'Corbel', 'Roboto', 'Open Sans', 'sans-serif',
    'Times New Roman', 'Georgia', 'Cambria', 'Book Antiqua', 'serif', 'Courier New', 'Consolas', 'monospace'];
  var TPL_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  var TPL_SIZES = [9, 13, 18, 26, 38];
  var templates = null, mainCore = null;

  function getMainCore() { if (!mainCore) mainCore = XSKeyReadCore(); return mainCore; }

  function buildTemplates() {
    if (templates) return templates;
    var core = getMainCore();
    var cv = document.createElement('canvas');
    var big = 120;
    cv.width = big * 2; cv.height = big * 2;
    var ctx = cv.getContext('2d', { willReadFrequently: true }) || cv.getContext('2d');
    var fonts = [], seen = {};
    var perFont = [];
    TPL_FONTS.forEach(function (face) {
      /* fingerprint at one size: drop faces the browser does not have */
      var fp = renderGlyphs(face, 26, '0123456789agQR', true);
      if (!fp || seen[fp.key]) return;
      seen[fp.key] = 1;
      fonts.push(face);
    });
    var nc = TPL_CHARS.length, nf = fonts.length, ns = TPL_SIZES.length;
    var desc = new Float32Array(ns * nf * nc * 256), hr = new Float32Array(ns * nf * nc);
    TPL_SIZES.forEach(function (size, si) {
      fonts.forEach(function (face, fi) {
        var r = renderGlyphs(face, size, TPL_CHARS, false);
        for (var ch = 0; ch < nc; ch++) {
          var idx = (si * nf + fi) * nc + ch, g = r.glyphs[ch];
          if (!g) continue;
          desc.set(g.z, idx * 256);
          hr[idx] = g.h / r.digitH;
        }
      });
    });
    templates = { chars: TPL_CHARS, sizes: TPL_SIZES, fonts: nf, fontNames: fonts, desc: desc, hr: hr };
    return templates;

    function renderGlyphs(face, capH, chars, fingerprint) {
      var side = Math.ceil(capH * 2.8) + 12;
      if (cv.width !== side) { cv.width = side; cv.height = side; }
      big = Math.round(capH * 1.6) + 4;
      var px = Math.round(capH / 0.72);
      ctx.font = px + 'px "' + face + '"';
      if (face === 'sans-serif' || face === 'serif' || face === 'monospace') ctx.font = px + 'px ' + face;
      /* adjust the font size once so the digit '8' is capH tall */
      var g8 = one('8');
      if (g8 && g8.h > 0 && Math.abs(g8.h - capH) >= 1) {
        px = Math.max(4, Math.round(px * capH / g8.h));
        ctx.font = (face === 'sans-serif' || face === 'serif' || face === 'monospace') ? px + 'px ' + face : px + 'px "' + face + '"';
        g8 = one('8');
      }
      var digitH = g8 ? g8.h : capH;
      var out = [], key = '';
      for (var i = 0; i < chars.length; i++) {
        var g = one(chars.charAt(i));
        out.push(g);
        if (fingerprint && g) key += g.w + 'x' + g.h + ':' + Math.round(g.sum) + ';';
      }
      return { glyphs: out, digitH: digitH, key: key };
    }
    function one(ch) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#000';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(ch, Math.round(big * 0.25) + 2, big);
      var id = ctx.getImageData(0, 0, cv.width, cv.height), d = id.data, w = cv.width, h = cv.height;
      var x0 = w, y0 = h, x1 = -1, y1 = -1, sum = 0;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var v = 255 - d[(y * w + x) * 4];
        if (v > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; sum += v; }
      }
      if (x1 < 0) return null;
      var gw = x1 - x0 + 1, gh = y1 - y0 + 1;
      var r = core.descOf(function (x, y) { var v = (255 - d[((y0 + y) * w + x0 + x) * 4]) / 255; return v <= 0.08 ? 0 : v; }, gw, gh);
      return { z: r.z, w: gw, h: gh, sum: sum };
    }
  }

  var tableCache = {};
  function flossTable(brand) {
    var b = String(brand || 'DMC').toLowerCase();
    if (tableCache[b]) return tableCache[b];
    var XS = W.XStitch, t = XS && XS.FLOSS && XS.FLOSS[b];
    if (!t) return null;
    tableCache[b] = t.map(function (e) {
      return { code: String(e.code), name: e.name, hex: e.hex, lab: XS.rgbToLab(e.r, e.g, e.b) };
    });
    return tableCache[b];
  }

  /** a chart read (XSRead result, extractGrid result or { classes, total }) -> { classes: [{ lab, count }], total } */
  function chartOf(ch) {
    if (!isObj(ch)) return null;
    var XS = W.XStitch, out = [], total = null;
    var list = ch.classes || ch.palette || null;
    if (Array.isArray(list)) {
      list.forEach(function (k) {
        if (!k || k.fabric) return;
        var cnt = k.count !== undefined ? k.count : k.stitchCount;
        if (!(cnt > 0)) return;
        var hex = k.hex ? String(k.hex).replace(/^#/, '') : null;
        out.push({ count: Math.round(cnt), lab: hex && XS ? XS.hexToLab('#' + hex) : null });
      });
    }
    if (typeof ch.total === 'number') total = ch.total;
    else if (out.length) total = out.reduce(function (s, k) { return s + k.count; }, 0);
    return out.length ? { classes: out, total: total } : null;
  }

  /* ================================================================== *
   * 5. Assemble (main thread)
   * ================================================================== */

  function bitsB64(bits) {
    var bytes = '';
    for (var i = 0; i < bits.length; i += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | (bits[i + k] ? 1 : 0);
      bytes += String.fromCharCode(v);
    }
    try { return W.btoa(bytes); } catch (e) { return ''; }
  }

  function assemble(res, brand, scale) {
    var table = flossTable(brand) || [];
    var s = scale || 1;
    function un(b) { return b ? { x: Math.round(b.x / s), y: Math.round(b.y / s), w: Math.round(b.w / s), h: Math.round(b.h / s) } : null; }
    var entries = [], rows = [], ex = 0, pa = 0, bl = 0;
    (res.rows || []).forEach(function (r) {
      var rd = r.read || { status: 'blank', text: '', candidates: [], evidence: [] };
      var exact = rd.status === 'exact' && rd.code;
      var fl = exact ? table.filter(function (t) { return t.code === rd.code; })[0] : null;
      if (rd.status === 'exact') ex++; else if (rd.status === 'partial') pa++; else bl++;
      var cnt = rd.countRead !== undefined ? rd.countRead : null;
      var sym = r.symbol;
      entries.push({
        symbol: '',
        brand: brand,
        code: exact ? rd.code : null,
        name: exact && rd.nameMatched && fl ? fl.name : '',
        hex: exact && fl ? fl.hex : (r.swatchHex || null),
        strands: null,
        stitchCount: cnt !== null && rd.status !== 'blank' ? cnt : null,
        skeins: null,
        kind: 'cross',
        blendCode: null,
        symbolUnreadable: true,
        line: (exact ? brand + ' ' + rd.code : (rd.text ? brand + ' ' + rd.text : '?')) + ' (read from the picture)',
        glyph: sym ? { w: sym.w, h: sym.h, bits: bitsB64(sym.bits), clean: sym.clean, box: un(sym.box), onSwatch: sym.onSwatch, path: null } : null,
        read: {
          status: rd.status,
          confidence: rd.confidence || 0,
          text: rd.text || '',
          candidates: rd.candidates || [],
          evidence: rd.evidence || [],
          swatchHex: r.swatchHex || null,
          nameMatched: !!rd.nameMatched,
          countRead: cnt,
          countStatus: rd.countStatus || (cnt !== null ? 'read' : 'not-read'),
          countWhy: rd.countWhy || (cnt !== null ? null : 'the count was not read'),
          why: rd.why || null,
          dE: rd.dE === undefined ? null : rd.dE
        }
      });
      rows.push({ box: un(r.box), cells: (r.cells || []).map(function (c) { return { kind: c.kind, box: un(c.box) }; }) });
    });
    var counts = entries.map(function (e) { return e.read.countRead; });
    var totalStitches = counts.length && counts.every(function (c) { return c > 0; }) ? counts.reduce(function (a, b) { return a + b; }, 0) : null;
    var verdict = !entries.length ? 'none' : (ex === entries.length ? 'read' : (ex + pa > 0 ? 'check' : 'none'));
    return {
      ok: entries.length > 0, reason: entries.length ? null : (res.reason || 'no-key'),
      message: entries.length ? (verdict === 'read' ? null : 'Read from the picture: check the marked rows.') : (res.message || 'No key rows were found in this picture.'),
      verdict: verdict, brand: brand, brandSeen: res.brandSeen || null, entries: entries, rows: rows,
      columns: (res.columns || []).map(function (c) { return { kind: c.kind, x0: Math.round(c.x0 / s), x1: Math.round(c.x1 / s) }; }),
      totalStitches: totalStitches,
      stats: { exact: ex, partial: pa, blank: bl, rows: entries.length, glyphClusters: (res.stats && res.stats.clusters) || 0,
        H: res.stats && res.stats.H, solve: res.solve || null, warnings: (res.warnings || []).slice() }
    };
  }

  /* ================================================================== *
   * 6. read() / readNumbers() / cancel()
   * ================================================================== */

  var seq = 0, jobs = {};
  var MSG = {
    'no-image': 'There is no picture to read.',
    'decode': 'That picture could not be opened. Try saving it as a PNG or JPEG and pick it again.',
    'cancelled': 'Stopped.'
  };
  function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  function run(kind, source, opts, onProgress) {
    var raw = isObj(opts) ? opts : {};
    var token = raw.token ? String(raw.token) : ('xsk' + (++seq));
    var settle = null;
    var promise = new Promise(function (resolve) { settle = resolve; });
    promise.token = token;
    var brand = String(raw.brand || 'DMC');
    if (brand.toLowerCase() === 'dmc') brand = 'DMC';
    var job = {
      id: token, cancelled: false, settled: false, px: null, core: null, timer: null, t0: nowMs(), worker: false,
      emit: function (phase, pct) {
        if (typeof onProgress !== 'function' || job.settled) return;
        try { onProgress({ phase: phase, pct: Math.max(0, Math.min(100, Math.round(pct))) }); } catch (e) { /* ignore */ }
      },
      done: function (res) {
        if (job.settled) return;
        job.settled = true;
        delete jobs[token];
        res.token = token;
        res.ms = Math.round((nowMs() - job.t0) * 10) / 10;
        if (res.stats) { res.stats.ms = res.ms; res.stats.worker = job.worker; }
        settle(res);
      },
      resolveCancelled: function () { job.done({ ok: false, reason: 'cancelled', message: MSG.cancelled, verdict: 'none', entries: [], rows: [] }); },
      fail: function (reason, message) {
        job.done(kind === 'numbers' ? { ok: false, reason: reason, message: message, numbers: [] } :
          { ok: false, reason: reason, message: message || MSG[reason] || 'That picture could not be read.', verdict: 'none', entries: [], rows: [], stats: { warnings: [] } });
      },
      failWorker: function (msg) {
        if (job.cancelled) { job.resolveCancelled(); return; }
        job.worker = false;
        job.note = 'read on the main thread (' + msg + ')';
        runOnMain(job);
      },
      finish: function (res) {
        if (job.cancelled) { job.resolveCancelled(); return; }
        try {
          if (kind === 'numbers') {
            var s = job.px.scale || 1;
            var nums = (res.numbers || []).map(function (n, i) { n.box = raw.boxesIn[i]; return n; });
            void s;
            job.done({ ok: true, numbers: nums });
            return;
          }
          var out = assemble(res, brand, job.px.scale);
          out.box = raw.crop ? { x: raw.crop.x, y: raw.crop.y, w: raw.crop.w, h: raw.crop.h } : { x: 0, y: 0, w: Math.round(job.px.w / job.px.scale), h: Math.round(job.px.h / job.px.scale) };
          if (job.note) out.stats.warnings.push(job.note);
          out._raw = raw.debug ? res : undefined;
          job.emit('assemble', 100);
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
      var s = px.scale || 1, tpl;
      try { tpl = buildTemplates(); } catch (e) { tpl = null; }
      var table = flossTable(brand);
      var o = {
        kind: kind,
        tpl: tpl,
        table: table ? table.map(function (t) { return { code: t.code, name: t.name, lab: t.lab }; }) : [],
        chart: chartOf(raw.chart),
        total: typeof raw.total === 'number' ? raw.total : null,
        expectRows: raw.expectRows || null,
        budget: raw.budget || null, debug: !!raw.debug,
        crop: raw.crop ? { x: raw.crop.x * s, y: raw.crop.y * s, w: raw.crop.w * s, h: raw.crop.h * s } : null
      };
      if (o.chart && o.total === null) o.total = o.chart.total;
      if (kind === 'numbers') {
        o.boxes = (raw.boxesIn || []).map(function (b) { return { x: b.x * s, y: b.y * s, w: b.w * s, h: b.h * s }; });
        o.expect = raw.expect || null; o.step = raw.step || null;
        if (raw.min !== undefined) o.min = raw.min;
        if (raw.max !== undefined) o.max = raw.max;
      }
      job.core = o;
      job.emit('decode', 10);
      if (!raw.noWorker && workerSupported() && getWorker()) {
        job.worker = true;
        queue.push(job);
        pump();
      } else runOnMain(job);
    }, function (err) {
      if (job.cancelled) { job.resolveCancelled(); return; }
      job.fail('no-image', MSG[err && err.message] || MSG['no-image']);
    })['catch'](function (e) {
      job.fail('no-image', 'That picture could not be read (' + ((e && e.message) || 'error') + ').');
    });
    return promise;
  }

  function runOnMain(job) {
    var runner;
    try {
      runner = getMainCore().createJob({ buf: job.px.buf.slice(0), w: job.px.w, h: job.px.h, opts: job.core });
    } catch (e) { job.fail('no-image', 'That picture could not be read (' + ((e && e.message) || 'error') + ').'); return; }
    function tick() {
      job.timer = null;
      if (job.cancelled) { job.resolveCancelled(); return; }
      var r;
      try { r = runner.step(); } catch (e) { job.fail('no-image', 'That picture could not be read (' + ((e && e.message) || 'error') + ').'); return; }
      job.emit(r.phase, 10 + r.pct * 0.85);
      if (r.done) { job.finish(r.result); return; }
      job.timer = W.setTimeout(tick, 0);
    }
    job.timer = W.setTimeout(tick, 0);
  }

  function cancel(token) {
    var ids = [];
    if (token === undefined || token === null || token === '') { for (var k in jobs) if (jobs.hasOwnProperty(k)) ids.push(k); }
    else {
      var t = (typeof token === 'object' && token && token.token) ? String(token.token) : String(token);
      if (jobs[t]) ids.push(t);
    }
    if (!ids.length) return false;
    ids.forEach(function (id) {
      var job = jobs[id];
      if (!job || job.settled) return;
      job.cancelled = true;
      if (job.timer) { W.clearTimeout(job.timer); job.timer = null; }
      if (running === job) { killWorker(); running = null; }
      for (var q = queue.length - 1; q >= 0; q--) if (queue[q] === job) queue.splice(q, 1);
      job.resolveCancelled();
    });
    pump();
    return true;
  }

  function read(source, opts, onProgress) {
    try { return run('key', source, opts, onProgress); }
    catch (e) { return Promise.resolve({ ok: false, reason: 'no-image', message: 'That picture could not be read.', verdict: 'none', entries: [], rows: [] }); }
  }

  function readNumbers(source, boxes, opts) {
    var o = {};
    if (isObj(opts)) for (var k in opts) o[k] = opts[k];
    o.boxesIn = Array.isArray(boxes) ? boxes.filter(function (b) { return b && b.w > 0 && b.h > 0; }) : [];
    if (!o.boxesIn.length) return Promise.resolve({ ok: true, numbers: [] }).then(function (r) { return r.numbers; });
    try {
      return run('numbers', source, o, null).then(function (r) { return r.numbers || []; });
    } catch (e) { return Promise.resolve([]); }
  }

  W.XSKeyRead = {
    version: VERSION,
    isAvailable: isAvailable,
    read: read,
    readNumbers: readNumbers,
    cancel: cancel,
    /* test/debug surface, not part of the contract */
    _core: XSKeyReadCore,
    _workerSrc: buildWorkerSrc,
    _templates: buildTemplates
  };
})();
