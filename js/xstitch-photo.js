'use strict';
/* =====================================================================
 * xstitch-photo.js — window.XStitchPhoto
 *
 * On-device photo -> cross-stitch chart. No network, no build step, no
 * ES modules. Implements docs/research/cross-stitch.md §B6 with the
 * algorithm chain of §A3.2 and the budget of §A3.3.
 *
 * Pipeline
 *   decode      createImageBitmap (or <img> + object URL), optional crop,
 *               drawImage into a modest intermediate canvas, getImageData
 *   resample    area average in LINEAR light down to the stitch grid,
 *               then CIELAB (D65)                      [worker]
 *   quantize    k-means++ (deterministic seed) + Lloyd, dE76 inner loop,
 *               <= 20 iterations or convergence        [worker]
 *   match       centroids -> nearest DMC with CIEDE2000 (or dE76),
 *               centroids landing on the same floss are merged; then a
 *               final per-cell assignment to the chosen palette, with
 *               optional Floyd-Steinberg dithering in Lab  [worker]
 *   cleanup     0 none / 1 majority filter on isolated cells /
 *               2 = 1 + connected components under minRun  [worker]
 *   assemble    stitch counts, confetti before/after (XStitch.confetti),
 *               skeins (XStitch.skeinsFor), symbols (XStitch.assignSymbols),
 *               XSData built and run through XStitch.normalize   [main]
 *
 * Threading.  The worker source is the string form of two functions in
 * this file (XSPhotoCore + xspWorkerBody), turned into a Blob URL. One
 * worker is created lazily and reused; the DMC Lab table is posted into
 * it once. Jobs run one at a time on it (the UI re-runs on slider
 * release, so overlapping calls queue instead of fighting for the core).
 * The pixel buffer is transferred in and the Int16Array cells out.
 * When Workers are unavailable the same core runs on the main thread,
 * one step per setTimeout tick, so the UI still paints.
 *
 * NOTE: the worker source is produced with Function.prototype.toString.
 * If this file is ever minified, keep XSPhotoCore and xspWorkerBody
 * out of the mangling (they are self-contained and reference nothing
 * outside themselves on purpose).
 *
 * Cancellation.  convert() returns a Promise with a `.token` string
 * property; you may also pass your own id as opts.token. Either way
 * XStitchPhoto.cancel(token) makes the promise resolve
 * { ok:false, error:'cancelled', cancelled:true } promptly — a running
 * worker job is terminated outright, a main-thread job stops at its
 * next tick. cancel() with no argument cancels everything in flight.
 *
 * Nothing here ever throws across the promise boundary: bad input
 * resolves { ok:false, error }.
 * ===================================================================== */
(function () {

  var W = typeof window !== 'undefined' ? window : self;

  /* ================================================================== *
   * 1. Options
   * ================================================================== */

  var DEFAULTS = {
    stitchWidth: 100,     // 20..500 stitches across
    maxColors: 24,        // 2..64
    count: 14,            // fabric count (size + floss maths only)
    over: 1,              // 1 aida, 2 evenweave/linen over two
    brand: 'DMC',         // DMC only in v1
    dither: false,        // OFF by default: every dithered cell is a thread change
    ditherStrength: 1,    // 0..1 error strength when dither is on
    cleanup: 1,           // 0 none, 1 majority, 2 majority + components
    minRun: 1,            // cleanup 2: components smaller than this go (min 2)
    crop: null,           // { x, y, w, h } in SOURCE pixels
    metric: 'de2000',     // final centroid -> floss metric; inner loop is de76
    strands: 2,
    waste: 0.2,
    seed: 1234            // deterministic k-means++
  };

  var MAX_SIDE = 500;     // cap: 500 x 500 cells

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  function numOr(v, dflt) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v !== '' && isFinite(+v)) return +v;
    return dflt;
  }

  function clampNum(v, lo, hi, dflt) {
    var n = numOr(v, dflt);
    if (n < lo) n = lo;
    if (n > hi) n = hi;
    return n;
  }

  function clampInt(v, lo, hi, dflt) {
    return Math.round(clampNum(v, lo, hi, dflt));
  }

  function defaults() {
    var o = {}, k;
    for (k in DEFAULTS) if (DEFAULTS.hasOwnProperty(k)) o[k] = DEFAULTS[k];
    return o;
  }

  function normCrop(c) {
    if (!isObj(c)) return null;
    var x = numOr(c.x, 0), y = numOr(c.y, 0), w = numOr(c.w, 0), h = numOr(c.h, 0);
    if (!(w > 0) || !(h > 0)) return null;
    return { x: x, y: y, w: w, h: h };
  }

  function normOpts(raw, warnings) {
    raw = isObj(raw) ? raw : {};
    var brand = String(raw.brand == null ? 'DMC' : raw.brand).trim();
    if (brand && brand.toLowerCase() !== 'dmc') {
      warnings.push('only DMC is supported in v1; used DMC');
      brand = 'DMC';
    }
    if (!brand) brand = 'DMC';
    return {
      stitchWidth: clampInt(raw.stitchWidth, 20, MAX_SIDE, DEFAULTS.stitchWidth),
      maxColors: clampInt(raw.maxColors, 2, 64, DEFAULTS.maxColors),
      count: clampInt(raw.count, 1, 40, DEFAULTS.count),
      over: (raw.over === 2 || raw.over === '2') ? 2 : 1,
      brand: brand,
      dither: !!raw.dither,
      ditherStrength: clampNum(raw.ditherStrength, 0, 1, 1),
      cleanup: clampInt(raw.cleanup, 0, 2, DEFAULTS.cleanup),
      minRun: clampInt(raw.minRun, 1, 64, DEFAULTS.minRun),
      crop: normCrop(raw.crop),
      metric: raw.metric === 'de76' ? 'de76' : 'de2000',
      strands: clampInt(raw.strands, 1, 12, DEFAULTS.strands),
      waste: clampNum(raw.waste, 0, 5, DEFAULTS.waste),
      seed: clampInt(raw.seed, 0, 4294967295, DEFAULTS.seed),
      maxIter: clampInt(raw.maxIter, 1, 100, 20),
      noWorker: !!raw.noWorker
    };
  }

  /* ================================================================== *
   * 2. The core — pure numerics, stringified into the Worker
   *
   * Self-contained on purpose: it must survive String(fn) with no
   * closure references. It is also called directly for the
   * main-thread fallback.
   * ================================================================== */

  function XSPhotoCore() {
    'use strict';

    var now = (typeof performance !== 'undefined' && performance && performance.now)
      ? function () { return performance.now(); }
      : function () { return Date.now(); };

    /* ---- colour maths (mirrors XStitch's, in a worker-safe form) ---- */

    var LIN = new Float32Array(256);
    (function () {
      for (var i = 0; i < 256; i++) {
        var c = i / 255;
        LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      }
    })();

    var XN = 0.95047, YN = 1.00000, ZN = 1.08883;
    var LEPS = 216 / 24389, LKAP = 24389 / 27;

    function labF(t) {
      return t > LEPS ? Math.pow(t, 1 / 3) : (LKAP * t + 16) / 116;
    }

    /* linear-light RGB (0..1) -> Lab, written into out[o..o+2] */
    function labFromLinear(R, G, B, out, o) {
      var X = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B;
      var Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
      var Z = 0.0193339 * R + 0.1191920 * G + 0.9503041 * B;
      var fx = labF(X / XN), fy = labF(Y / YN), fz = labF(Z / ZN);
      out[o] = 116 * fy - 16;
      out[o + 1] = 500 * (fx - fy);
      out[o + 2] = 200 * (fy - fz);
    }

    var DEG = Math.PI / 180;
    var POW25_7 = 6103515625;

    function hueDeg(b, ap) {
      if (ap === 0 && b === 0) return 0;
      var h = Math.atan2(b, ap) / DEG;
      return h < 0 ? h + 360 : h;
    }

    /* CIEDE2000, kL = kC = kH = 1 (Sharma/Wu/Dalal). */
    function de2000(L1, a1, b1, L2, a2, b2) {
      var C1 = Math.sqrt(a1 * a1 + b1 * b1);
      var C2 = Math.sqrt(a2 * a2 + b2 * b2);
      var Cbar = (C1 + C2) / 2;
      var Cbar7 = Math.pow(Cbar, 7);
      var G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + POW25_7)));
      var ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
      var Cp1 = Math.sqrt(ap1 * ap1 + b1 * b1);
      var Cp2 = Math.sqrt(ap2 * ap2 + b2 * b2);
      var hp1 = hueDeg(b1, ap1), hp2 = hueDeg(b2, ap2);

      var dLp = L2 - L1;
      var dCp = Cp2 - Cp1;
      var dhp;
      if (Cp1 * Cp2 === 0) dhp = 0;
      else {
        dhp = hp2 - hp1;
        if (dhp > 180) dhp -= 360;
        else if (dhp < -180) dhp += 360;
      }
      var dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp / 2) * DEG);

      var Lbp = (L1 + L2) / 2;
      var Cbp = (Cp1 + Cp2) / 2;
      var hbp;
      if (Cp1 * Cp2 === 0) hbp = hp1 + hp2;
      else {
        var dh = Math.abs(hp1 - hp2);
        var sum = hp1 + hp2;
        if (dh <= 180) hbp = sum / 2;
        else if (sum < 360) hbp = (sum + 360) / 2;
        else hbp = (sum - 360) / 2;
      }

      var T = 1
        - 0.17 * Math.cos((hbp - 30) * DEG)
        + 0.24 * Math.cos((2 * hbp) * DEG)
        + 0.32 * Math.cos((3 * hbp + 6) * DEG)
        - 0.20 * Math.cos((4 * hbp - 63) * DEG);

      var dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
      var Cbp7 = Math.pow(Cbp, 7);
      var RC = 2 * Math.sqrt(Cbp7 / (Cbp7 + POW25_7));
      var lm = (Lbp - 50) * (Lbp - 50);
      var SL = 1 + (0.015 * lm) / Math.sqrt(20 + lm);
      var SC = 1 + 0.045 * Cbp;
      var SH = 1 + 0.015 * Cbp * T;
      var RT = -Math.sin((2 * dTheta) * DEG) * RC;

      var tL = dLp / SL, tC = dCp / SC, tH = dHp / SH;
      return Math.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH);
    }

    /* ---- deterministic RNG (mulberry32) ---------------------------- */

    function makeRng(seed) {
      var a = (seed >>> 0) || 1;
      return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    /* ---- the floss table, posted in once ---------------------------- */

    var FL = null;    // Float32Array(nf * 3) of Lab
    var NF = 0;

    function setFloss(labArray) {
      FL = labArray instanceof Float32Array ? labArray : new Float32Array(labArray);
      NF = (FL.length / 3) | 0;
    }

    function hasFloss() { return NF > 0; }

    /* ---- step 2: area average in linear light, then Lab ------------- */

    function resample(buf, iw, ih, gw, gh) {
      var px = new Uint8Array(buf);
      var n = gw * gh;
      var lab = new Float32Array(n * 3);

      var colMap = new Int32Array(iw);
      var x, y, g;
      for (x = 0; x < iw; x++) {
        g = (x * gw / iw) | 0;
        if (g >= gw) g = gw - 1;
        colMap[x] = g;
      }
      var rowStart = new Int32Array(gh + 1);
      for (y = 0; y <= gh; y++) {
        var v = Math.floor(y * ih / gh);
        if (v > ih) v = ih;
        rowStart[y] = v;
      }
      for (y = 0; y < gh; y++) {
        if (rowStart[y + 1] <= rowStart[y]) {
          rowStart[y + 1] = rowStart[y] + 1;
          if (rowStart[y + 1] > ih) { rowStart[y] = ih - 1; rowStart[y + 1] = ih; }
        }
      }

      var accR = new Float32Array(gw), accG = new Float32Array(gw), accB = new Float32Array(gw);
      var cnt = new Int32Array(gw);

      for (var gy = 0; gy < gh; gy++) {
        for (x = 0; x < gw; x++) { accR[x] = 0; accG[x] = 0; accB[x] = 0; cnt[x] = 0; }
        var y0 = rowStart[gy], y1 = rowStart[gy + 1];
        for (y = y0; y < y1; y++) {
          var o = y * iw * 4;
          for (x = 0; x < iw; x++, o += 4) {
            var gi = colMap[x];
            var al = px[o + 3];
            if (al === 255) {
              accR[gi] += LIN[px[o]];
              accG[gi] += LIN[px[o + 1]];
              accB[gi] += LIN[px[o + 2]];
            } else {
              /* composite over white so cut-outs read as fabric */
              var f = al / 255, w1 = 1 - f;
              accR[gi] += LIN[px[o]] * f + w1;
              accG[gi] += LIN[px[o + 1]] * f + w1;
              accB[gi] += LIN[px[o + 2]] * f + w1;
            }
            cnt[gi]++;
          }
        }
        var base = gy * gw;
        for (x = 0; x < gw; x++) {
          var c = cnt[x] || 1;
          labFromLinear(accR[x] / c, accG[x] / c, accB[x] / c, lab, (base + x) * 3);
        }
      }
      return lab;
    }

    /* ---- step 4: k-means++ seeding ---------------------------------- */

    function seedPlusPlus(lab, n, k, seed) {
      var rnd = makeRng(seed);
      var cent = new Float32Array(k * 3);
      var d2 = new Float32Array(n);
      var i, j, o;

      var first = (rnd() * n) | 0;
      if (first >= n) first = n - 1;
      cent[0] = lab[first * 3]; cent[1] = lab[first * 3 + 1]; cent[2] = lab[first * 3 + 2];
      for (i = 0; i < n; i++) d2[i] = Infinity;

      for (j = 1; j < k; j++) {
        var cx = cent[(j - 1) * 3], cy = cent[(j - 1) * 3 + 1], cz = cent[(j - 1) * 3 + 2];
        var total = 0;
        for (i = 0, o = 0; i < n; i++, o += 3) {
          var dL = lab[o] - cx, da = lab[o + 1] - cy, db = lab[o + 2] - cz;
          var d = dL * dL + da * da + db * db;
          if (d < d2[i]) d2[i] = d;
          total += d2[i];
        }
        var pick = -1;
        if (total > 0) {
          var r = rnd() * total, acc = 0;
          for (i = 0; i < n; i++) {
            acc += d2[i];
            if (acc >= r) { pick = i; break; }
          }
        }
        if (pick < 0) pick = (j * 2654435761 % n) | 0;   // degenerate image: spread out
        cent[j * 3] = lab[pick * 3];
        cent[j * 3 + 1] = lab[pick * 3 + 1];
        cent[j * 3 + 2] = lab[pick * 3 + 2];
      }
      return cent;
    }

    /* ---- step 4: one Lloyd iteration -------------------------------- */

    function lloydStep(lab, n, k, cent, assign, bestD) {
      var sums = new Float64Array(k * 3);
      var counts = new Int32Array(k);
      var i, j, o;

      for (i = 0, o = 0; i < n; i++, o += 3) {
        var L = lab[o], a = lab[o + 1], b = lab[o + 2];
        var bi = 0, bd = Infinity;
        for (j = 0; j < k; j++) {
          var c = j * 3;
          var dL = L - cent[c], da = a - cent[c + 1], db = b - cent[c + 2];
          var d = dL * dL + da * da + db * db;
          if (d < bd) { bd = d; bi = j; }
        }
        assign[i] = bi;
        bestD[i] = bd;
        counts[bi]++;
        var s = bi * 3;
        sums[s] += L; sums[s + 1] += a; sums[s + 2] += b;
      }

      /* empty clusters take the point furthest from its centroid */
      for (j = 0; j < k; j++) {
        if (counts[j]) continue;
        var far = -1, fd = -1;
        for (i = 0; i < n; i++) {
          if (bestD[i] > fd) { fd = bestD[i]; far = i; }
        }
        if (far < 0) break;
        var old = assign[far];
        if (counts[old] > 1) {
          counts[old]--;
          sums[old * 3] -= lab[far * 3];
          sums[old * 3 + 1] -= lab[far * 3 + 1];
          sums[old * 3 + 2] -= lab[far * 3 + 2];
          assign[far] = j;
          counts[j] = 1;
          sums[j * 3] = lab[far * 3];
          sums[j * 3 + 1] = lab[far * 3 + 1];
          sums[j * 3 + 2] = lab[far * 3 + 2];
          bestD[far] = 0;
        }
      }

      var move = 0;
      for (j = 0; j < k; j++) {
        var cc = counts[j];
        if (!cc) continue;
        var nx = sums[j * 3] / cc, ny = sums[j * 3 + 1] / cc, nz = sums[j * 3 + 2] / cc;
        var mx = nx - cent[j * 3], my = ny - cent[j * 3 + 1], mz = nz - cent[j * 3 + 2];
        var m = Math.sqrt(mx * mx + my * my + mz * mz);
        if (m > move) move = m;
        cent[j * 3] = nx; cent[j * 3 + 1] = ny; cent[j * 3 + 2] = nz;
      }
      return move;
    }

    /* ---- step 5: centroids -> DMC, merging duplicates ---------------- */

    var CAND = 6;           // runner-up flosses kept per centroid
    var JND = 2.3;          // dE76 just-noticeable difference (A3.2 step 3)
    var RUNNER_SLACK = 4;   // how much worse a runner-up floss may be

    function mapToFloss(cent, k, metric, sizes) {
      var use2000 = metric !== 'de76';
      var cand = new Int32Array(k * CAND);     // nearest flosses, best first
      var candD = new Float32Array(k * CAND);
      var j, f, m;

      for (j = 0; j < k; j++) {
        var L = cent[j * 3], a = cent[j * 3 + 1], b = cent[j * 3 + 2];
        for (m = 0; m < CAND; m++) { cand[j * CAND + m] = -1; candD[j * CAND + m] = Infinity; }
        for (f = 0; f < NF; f++) {
          var o = f * 3, d;
          if (use2000) {
            d = de2000(L, a, b, FL[o], FL[o + 1], FL[o + 2]);
          } else {
            var dL = L - FL[o], da = a - FL[o + 1], db = b - FL[o + 2];
            d = Math.sqrt(dL * dL + da * da + db * db);
          }
          if (d >= candD[j * CAND + CAND - 1]) continue;
          /* insertion sort into the short candidate list */
          for (m = CAND - 1; m > 0 && candD[j * CAND + m - 1] > d; m--) {
            candD[j * CAND + m] = candD[j * CAND + m - 1];
            cand[j * CAND + m] = cand[j * CAND + m - 1];
          }
          candD[j * CAND + m] = d;
          cand[j * CAND + m] = f;
        }
      }

      /* De-duplicate (A3.2 step 5). Biggest clusters choose first. When a
         cluster's best floss is taken we only merge into that slot if the
         two centroids are within a JND of each other — otherwise the two
         really are different colours and the newcomer takes its runner-up,
         provided the runner-up is not much worse. */
      var order = [];
      for (j = 0; j < k; j++) order.push(j);
      order.sort(function (x, y) {
        var sx = sizes ? sizes[x] : 0, sy = sizes ? sizes[y] : 0;
        return sy - sx || x - y;
      });

      var takenBy = {};                 // floss index -> palette slot
      var ownerCent = [];               // palette slot -> cluster that owns it
      var palFloss = [];
      var remap = new Int32Array(k);
      var merged = 0;

      for (var oi = 0; oi < order.length; oi++) {
        j = order[oi];
        var slot = -1, mergeInto = -1;
        var best = candD[j * CAND];
        for (m = 0; m < CAND; m++) {
          var fi = cand[j * CAND + m];
          if (fi < 0) break;
          if (!takenBy.hasOwnProperty(fi)) {
            if (m > 0 && candD[j * CAND + m] > best + RUNNER_SLACK) break;
            slot = palFloss.length;
            takenBy[fi] = slot;
            palFloss.push(fi);
            ownerCent.push(j);
            break;
          }
          var owner = ownerCent[takenBy[fi]];
          var dL2 = cent[j * 3] - cent[owner * 3];
          var da2 = cent[j * 3 + 1] - cent[owner * 3 + 1];
          var db2 = cent[j * 3 + 2] - cent[owner * 3 + 2];
          if (Math.sqrt(dL2 * dL2 + da2 * da2 + db2 * db2) < JND) {
            mergeInto = takenBy[fi];
            break;
          }
          if (mergeInto < 0) mergeInto = takenBy[fi];   // fallback if nothing is free
        }
        if (slot >= 0) {
          remap[j] = slot;
        } else {
          remap[j] = mergeInto >= 0 ? mergeInto : 0;
          merged++;
        }
      }

      var kk = palFloss.length;
      var palLab = new Float32Array(kk * 3);
      for (j = 0; j < kk; j++) {
        var s = palFloss[j] * 3;
        palLab[j * 3] = FL[s];
        palLab[j * 3 + 1] = FL[s + 1];
        palLab[j * 3 + 2] = FL[s + 2];
      }
      return { palFloss: palFloss, palLab: palLab, kk: kk, remap: remap, merged: merged };
    }

    function nearestPal(L, a, b, palLab, kk) {
      var bi = 0, bd = Infinity;
      for (var j = 0; j < kk; j++) {
        var o = j * 3;
        var dL = L - palLab[o], da = a - palLab[o + 1], db = b - palLab[o + 2];
        var d = dL * dL + da * da + db * db;
        if (d < bd) { bd = d; bi = j; }
      }
      return bi;
    }

    /* ---- final assignment, plain or dithered ------------------------ */

    function assignFlat(lab, n, palLab, kk) {
      var cells = new Int16Array(n);
      for (var i = 0, o = 0; i < n; i++, o += 3) {
        cells[i] = nearestPal(lab[o], lab[o + 1], lab[o + 2], palLab, kk);
      }
      return cells;
    }

    /* Floyd-Steinberg in Lab, serpentine, restricted to the palette. */
    function assignDither(lab, gw, gh, palLab, kk, strength) {
      var cells = new Int16Array(gw * gh);
      var cur = new Float32Array((gw + 2) * 3);
      var nxt = new Float32Array((gw + 2) * 3);
      var x, i;
      var s = strength;

      for (var y = 0; y < gh; y++) {
        for (i = 0; i < nxt.length; i++) { cur[i] = nxt[i]; nxt[i] = 0; }
        var rev = (y & 1) === 1;
        for (var step = 0; step < gw; step++) {
          x = rev ? (gw - 1 - step) : step;
          var o = (y * gw + x) * 3;
          var e = (x + 1) * 3;
          var L = lab[o] + cur[e];
          var a = lab[o + 1] + cur[e + 1];
          var b = lab[o + 2] + cur[e + 2];
          var p = nearestPal(L, a, b, palLab, kk);
          cells[y * gw + x] = p;
          var q = p * 3;
          var eL = (L - palLab[q]) * s;
          var ea = (a - palLab[q + 1]) * s;
          var eb = (b - palLab[q + 2]) * s;

          var fwd = rev ? -1 : 1;
          var rIdx = (x + 1 + fwd) * 3;         // 7/16 ahead on this row
          var dlIdx = (x + 1 - fwd) * 3;        // 3/16 behind on the next row
          var dIdx = (x + 1) * 3;               // 5/16 straight down
          var drIdx = (x + 1 + fwd) * 3;        // 1/16 ahead on the next row

          if (rIdx >= 0 && rIdx < cur.length) {
            cur[rIdx] += eL * 0.4375; cur[rIdx + 1] += ea * 0.4375; cur[rIdx + 2] += eb * 0.4375;
          }
          if (dlIdx >= 0 && dlIdx < nxt.length) {
            nxt[dlIdx] += eL * 0.1875; nxt[dlIdx + 1] += ea * 0.1875; nxt[dlIdx + 2] += eb * 0.1875;
          }
          nxt[dIdx] += eL * 0.3125; nxt[dIdx + 1] += ea * 0.3125; nxt[dIdx + 2] += eb * 0.3125;
          if (drIdx >= 0 && drIdx < nxt.length) {
            nxt[drIdx] += eL * 0.0625; nxt[drIdx + 1] += ea * 0.0625; nxt[drIdx + 2] += eb * 0.0625;
          }
        }
      }
      return cells;
    }

    /* ---- step 7a: majority filter on isolated cells ----------------- */

    function majorityPass(cells, lab, gw, gh, palLab, kk) {
      var src = new Int16Array(cells);
      var changed = 0;
      var tally = new Int32Array(kk);
      var x, y, dx, dy, j;

      for (y = 0; y < gh; y++) {
        for (x = 0; x < gw; x++) {
          var i = y * gw + x;
          var v = src[i];
          if (v < 0) continue;
          var same = 0, distinct = 0;
          for (j = 0; j < kk; j++) tally[j] = 0;
          for (dy = -1; dy <= 1; dy++) {
            var ny = y + dy;
            if (ny < 0 || ny >= gh) continue;
            for (dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              var nx = x + dx;
              if (nx < 0 || nx >= gw) continue;
              var nv = src[ny * gw + nx];
              if (nv < 0) continue;
              if (nv === v) { same++; continue; }
              if (tally[nv] === 0) distinct++;
              tally[nv]++;
            }
          }
          if (same > 0 || distinct === 0) continue;

          /* modal neighbour; ties broken by dE76 to the cell's own
             pre-quantization Lab so repeated passes do not drift */
          var best = -1, bestN = 0, bestD = Infinity;
          var o = i * 3, L = lab[o], a = lab[o + 1], b = lab[o + 2];
          for (j = 0; j < kk; j++) {
            var c = tally[j];
            if (!c) continue;
            var q = j * 3;
            var dL = L - palLab[q], da = a - palLab[q + 1], db = b - palLab[q + 2];
            var d = dL * dL + da * da + db * db;
            if (c > bestN || (c === bestN && d < bestD)) { best = j; bestN = c; bestD = d; }
          }
          if (best >= 0 && best !== v) { cells[i] = best; changed++; }
        }
      }
      return changed;
    }

    /* ---- step 7b: connected components smaller than minRun ---------- */

    function componentPass(cells, lab, gw, gh, palLab, kk, minRun) {
      var n = gw * gh;
      var seen = new Uint8Array(n);
      var stack = new Int32Array(n);
      var comp = new Int32Array(n);
      var border = new Int32Array(kk);
      var removed = 0;
      var x, y, dx, dy, j;

      for (var start = 0; start < n; start++) {
        if (seen[start]) continue;
        var v = cells[start];
        seen[start] = 1;
        if (v < 0) continue;

        var sp = 0, cn = 0;
        stack[sp++] = start;
        comp[cn++] = start;
        var touched = 0;
        for (j = 0; j < kk; j++) border[j] = 0;

        while (sp > 0) {
          var i = stack[--sp];
          x = i % gw; y = (i / gw) | 0;
          for (dy = -1; dy <= 1; dy++) {
            var ny = y + dy;
            if (ny < 0 || ny >= gh) continue;
            for (dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              var nx = x + dx;
              if (nx < 0 || nx >= gw) continue;
              var ni = ny * gw + nx;
              var nv = cells[ni];
              if (nv === v) {
                if (!seen[ni]) { seen[ni] = 1; stack[sp++] = ni; comp[cn++] = ni; }
              } else if (nv >= 0) {
                if (border[nv] === 0) touched++;
                border[nv]++;
              }
            }
          }
        }

        if (cn >= minRun || !touched) continue;

        /* dominant neighbour by shared boundary; ties by dE76 to the
           component's mean pre-quantization Lab */
        var mL = 0, mA = 0, mB = 0;
        for (j = 0; j < cn; j++) {
          var o = comp[j] * 3;
          mL += lab[o]; mA += lab[o + 1]; mB += lab[o + 2];
        }
        mL /= cn; mA /= cn; mB /= cn;

        var best = -1, bestN = 0, bestD = Infinity;
        for (j = 0; j < kk; j++) {
          var c = border[j];
          if (!c) continue;
          var q = j * 3;
          var dL = mL - palLab[q], da = mA - palLab[q + 1], db = mB - palLab[q + 2];
          var d = dL * dL + da * da + db * db;
          if (c > bestN || (c === bestN && d < bestD)) { best = j; bestN = c; bestD = d; }
        }
        if (best < 0 || best === v) continue;
        for (j = 0; j < cn; j++) cells[comp[j]] = best;
        removed++;
      }
      return removed;
    }

    /* ---- the step machine ------------------------------------------- */

    /* core-global percent bands per phase */
    var BANDS = {
      resample: [0, 15],
      quantize: [15, 62],
      match: [62, 80],
      cleanup: [80, 94],
      count: [94, 100]
    };

    function pctOf(phase, local) {
      var b = BANDS[phase] || [0, 100];
      if (local < 0) local = 0;
      if (local > 1) local = 1;
      return b[0] + (b[1] - b[0]) * local;
    }

    function createJob(job) {
      var opts = job.opts;
      var gw = job.gw, gh = job.gh, n = gw * gh;
      var maxIter = opts.maxIter || 20;

      var st = {
        stage: 'resample',
        iter: 0,
        lab: null,
        cent: null,
        k: 0,
        assign: null,
        bestD: null,
        palFloss: null,
        palLab: null,
        kk: 0,
        cells: null,
        before: null,
        times: { resample: 0, quantize: 0, match: 0, cleanup: 0, count: 0 },
        iters: 0,
        tPhase: now(),
        t0: now()
      };

      function mark(phase) {
        var t = now();
        st.times[phase] += t - st.tPhase;
        st.tPhase = t;
      }

      function out(phase, local) {
        return { done: false, phase: phase, pct: pctOf(phase, local), phasePct: Math.round(local * 100) };
      }

      function step() {
        switch (st.stage) {

          case 'resample': {
            st.lab = resample(job.buf, job.iw, job.ih, gw, gh);
            job.buf = null;
            mark('resample');
            st.stage = 'seed';
            return out('resample', 1);
          }

          case 'seed': {
            var k = opts.maxColors;
            if (k > n) k = n;
            if (k < 1) k = 1;
            st.k = k;
            st.cent = seedPlusPlus(st.lab, n, k, opts.seed);
            st.assign = new Int32Array(n);
            st.bestD = new Float32Array(n);
            mark('quantize');
            st.stage = 'lloyd';
            return out('quantize', 0.15);
          }

          case 'lloyd': {
            var move = lloydStep(st.lab, n, st.k, st.cent, st.assign, st.bestD);
            st.iter++;
            st.iters = st.iter;
            mark('quantize');
            if (move < 0.5 || st.iter >= maxIter) st.stage = 'match';
            return out('quantize', 0.15 + 0.85 * (st.iter / maxIter));
          }

          case 'match': {
            var sizes = new Int32Array(st.k);
            for (var si = 0; si < n; si++) sizes[st.assign[si]]++;
            var m = mapToFloss(st.cent, st.k, opts.metric, sizes);
            st.palFloss = m.palFloss;
            st.palLab = m.palLab;
            st.kk = m.kk;
            st.merged = m.merged;
            mark('match');
            st.stage = 'assign';
            return out('match', 0.5);
          }

          case 'assign': {
            if (opts.dither && opts.ditherStrength > 0) {
              st.cells = assignDither(st.lab, gw, gh, st.palLab, st.kk, opts.ditherStrength);
            } else {
              st.cells = assignFlat(st.lab, n, st.palLab, st.kk);
            }
            mark('match');
            st.before = new Int16Array(st.cells);
            st.stage = opts.cleanup > 0 ? 'clean1' : 'count';
            return out('match', 1);
          }

          case 'clean1': {
            var passes = 2, p;
            for (p = 0; p < passes; p++) {
              if (!majorityPass(st.cells, st.lab, gw, gh, st.palLab, st.kk)) break;
            }
            mark('cleanup');
            st.stage = opts.cleanup >= 2 ? 'clean2' : 'count';
            return out('cleanup', opts.cleanup >= 2 ? 0.5 : 1);
          }

          case 'clean2': {
            /* a component "smaller than 1" is impossible, so strong
               cleanup always means at least pairs */
            var thr = opts.minRun > 2 ? opts.minRun : 2;
            componentPass(st.cells, st.lab, gw, gh, st.palLab, st.kk, thr);
            majorityPass(st.cells, st.lab, gw, gh, st.palLab, st.kk);
            mark('cleanup');
            st.stage = 'count';
            return out('cleanup', 1);
          }

          case 'count': {
            var i, j;
            var counts = new Int32Array(st.kk);
            var sumDE = 0, maxDE = 0, nDE = 0;
            for (i = 0; i < n; i++) {
              var v = st.cells[i];
              if (v < 0) continue;
              counts[v]++;
              /* honest quality number: how far each cell's true colour is
                 from the floss it ended up as */
              var lo = i * 3, po = v * 3;
              var eL = st.lab[lo] - st.palLab[po];
              var eA = st.lab[lo + 1] - st.palLab[po + 1];
              var eB = st.lab[lo + 2] - st.palLab[po + 2];
              var de = Math.sqrt(eL * eL + eA * eA + eB * eB);
              sumDE += de; nDE++;
              if (de > maxDE) maxDE = de;
            }
            /* palette order = most stitches first (stable on index) */
            var order = [];
            for (j = 0; j < st.kk; j++) order.push(j);
            order.sort(function (a, b) { return counts[b] - counts[a] || a - b; });
            var remap = new Int32Array(st.kk);
            for (j = 0; j < st.kk; j++) remap[order[j]] = j;

            var palette = [];
            for (j = 0; j < st.kk; j++) {
              var src = order[j];
              palette.push({ floss: st.palFloss[src], stitchCount: counts[src] });
            }
            /* drop colours no cell uses (cleanup can empty one) */
            while (palette.length > 1 && palette[palette.length - 1].stitchCount === 0) {
              palette.pop();
            }
            for (i = 0; i < n; i++) {
              if (st.cells[i] >= 0) st.cells[i] = remap[st.cells[i]];
              if (st.before[i] >= 0) st.before[i] = remap[st.before[i]];
            }
            mark('count');

            st.lab = null;
            st.cent = null;
            st.assign = null;
            st.bestD = null;

            var res = {
              cells: st.cells,
              before: st.before,
              palette: palette,
              w: gw,
              h: gh,
              iters: st.iters,
              times: st.times,
              meanDE: nDE ? sumDE / nDE : 0,
              maxDE: maxDE,
              merged: st.merged || 0,
              coreMs: now() - st.t0
            };
            st.stage = 'done';
            return { done: true, phase: 'count', pct: 100, phasePct: 100, result: res };
          }

          default:
            return { done: true, phase: 'count', pct: 100, phasePct: 100, result: null };
        }
      }

      return { step: step, state: st };
    }

    return {
      setFloss: setFloss,
      hasFloss: hasFloss,
      createJob: createJob,
      de2000: de2000
    };
  }

  /* ================================================================== *
   * 3. The worker body — also stringified
   * ================================================================== */

  function xspWorkerBody(core) {
    self.onmessage = function (ev) {
      var msg = ev.data || {};
      try {
        if (msg.t === 'init') {
          core.setFloss(new Float32Array(msg.floss));
          self.postMessage({ t: 'ready' });
          return;
        }
        if (msg.t === 'run') {
          if (!core.hasFloss()) {
            self.postMessage({ t: 'error', id: msg.id, error: 'floss table missing' });
            return;
          }
          var job = core.createJob({
            buf: msg.buf, iw: msg.iw, ih: msg.ih, gw: msg.gw, gh: msg.gh, opts: msg.opts
          });
          var r;
          var lastPct = -1;
          for (;;) {
            r = job.step();
            var p = Math.round(r.pct);
            if (p !== lastPct) {
              lastPct = p;
              self.postMessage({ t: 'progress', id: msg.id, phase: r.phase, pct: p, phasePct: r.phasePct });
            }
            if (r.done) break;
          }
          var res = r.result;
          var transfer = [res.cells.buffer];
          if (res.before) transfer.push(res.before.buffer);
          self.postMessage({
            t: 'done', id: msg.id,
            cells: res.cells, before: res.before, palette: res.palette,
            w: res.w, h: res.h, iters: res.iters, times: res.times, meanDE: res.meanDE, maxDE: res.maxDE, merged: res.merged, coreMs: res.coreMs
          }, transfer);
        }
      } catch (e) {
        self.postMessage({ t: 'error', id: msg.id, error: (e && e.message) ? e.message : String(e) });
      }
    };
  }

  /* ================================================================== *
   * 4. Worker plumbing
   * ================================================================== */

  var workerSrc = null;
  var workerUrl = null;
  var worker = null;
  var workerReady = false;
  var flossLab = null;       // Float32Array, built once from XStitch.FLOSS.dmc
  var running = null;        // the job currently on the worker
  var queue = [];            // waiting jobs

  function buildWorkerSrc() {
    if (workerSrc) return workerSrc;
    workerSrc = [
      "'use strict';",
      String(XSPhotoCore),
      String(xspWorkerBody),
      'xspWorkerBody(XSPhotoCore());'
    ].join('\n');
    return workerSrc;
  }

  function buildFlossLab() {
    if (flossLab) return flossLab;
    var XS = W.XStitch;
    if (!XS || !XS.FLOSS || !XS.FLOSS.dmc) return null;
    var t = XS.FLOSS.dmc;
    var arr = new Float32Array(t.length * 3);
    for (var i = 0; i < t.length; i++) {
      var lab = XS.rgbToLab(t[i].r, t[i].g, t[i].b);
      arr[i * 3] = lab[0];
      arr[i * 3 + 1] = lab[1];
      arr[i * 3 + 2] = lab[2];
    }
    flossLab = arr;
    return flossLab;
  }

  function workerSupported() {
    return typeof W.Worker === 'function'
      && typeof W.Blob === 'function'
      && !!(W.URL && W.URL.createObjectURL);
  }

  function isAvailable() {
    return workerSupported() && typeof W.createImageBitmap === 'function';
  }

  function getWorker() {
    if (worker) return worker;
    if (!workerSupported()) return null;
    var lab = buildFlossLab();
    if (!lab) return null;
    try {
      if (!workerUrl) {
        workerUrl = W.URL.createObjectURL(new W.Blob([buildWorkerSrc()], { type: 'text/javascript' }));
      }
      worker = new W.Worker(workerUrl);
      workerReady = false;
      worker.onmessage = onWorkerMessage;
      worker.onerror = onWorkerError;
      /* posted once per worker; NOT transferred, so the copy on this side
         survives for the next worker */
      worker.postMessage({ t: 'init', floss: lab });
      workerReady = true;
    } catch (e) {
      worker = null;
      return null;
    }
    return worker;
  }

  function killWorker() {
    if (worker) {
      try { worker.terminate(); } catch (e) { /* ignore */ }
    }
    worker = null;
    workerReady = false;
  }

  function onWorkerError() {
    var job = running;
    killWorker();
    running = null;
    if (job && !job.settled) {
      job.failWorker('worker failed');
    } else {
      pump();
    }
  }

  function onWorkerMessage(ev) {
    var msg = ev.data || {};
    if (msg.t === 'ready') return;
    var job = running;
    if (!job || job.id !== msg.id) return;
    if (msg.t === 'progress') {
      job.emitCore(msg.phase, msg.pct, msg.phasePct);
      return;
    }
    if (msg.t === 'done') {
      running = null;
      job.finish({
        cells: msg.cells, before: msg.before, palette: msg.palette,
        w: msg.w, h: msg.h, iters: msg.iters, times: msg.times, meanDE: msg.meanDE, maxDE: msg.maxDE, merged: msg.merged, coreMs: msg.coreMs
      });
      pump();
      return;
    }
    if (msg.t === 'error') {
      running = null;
      job.failWorker(msg.error || 'worker error');
      pump();
    }
  }

  function pump() {
    if (running || !queue.length) return;
    var job = queue.shift();
    if (job.cancelled) { job.resolveCancelled(); pump(); return; }
    var wk = getWorker();
    if (!wk) { job.failWorker('no worker'); pump(); return; }
    running = job;
    try {
      wk.postMessage({
        t: 'run', id: job.id, buf: job.px.buf, iw: job.px.iw, ih: job.px.ih,
        gw: job.gw, gh: job.gh, opts: job.opts
      }, [job.px.buf]);
      job.px.buf = null;
    } catch (e) {
      running = null;
      job.failWorker('postMessage failed');
      pump();
    }
  }

  /* ================================================================== *
   * 5. Decode + intermediate downscale (main thread)
   * ================================================================== */

  var scratch = null;

  function getScratch(w, h) {
    if (!scratch) {
      if (typeof document === 'undefined') return null;
      scratch = document.createElement('canvas');
    }
    scratch.width = w;
    scratch.height = h;
    return scratch;
  }

  function isCanvas(v) {
    return !!v && typeof v === 'object'
      && ((typeof W.HTMLCanvasElement === 'function' && v instanceof W.HTMLCanvasElement)
        || (typeof W.OffscreenCanvas === 'function' && v instanceof W.OffscreenCanvas)
        || (typeof v.getContext === 'function' && typeof v.width === 'number'));
  }

  function isImageEl(v) {
    return !!v && typeof W.HTMLImageElement === 'function' && v instanceof W.HTMLImageElement;
  }

  function isBitmap(v) {
    return !!v && typeof W.ImageBitmap === 'function' && v instanceof W.ImageBitmap;
  }

  function isImageData(v) {
    return !!v && typeof W.ImageData === 'function' && v instanceof W.ImageData;
  }

  function isBlobLike(v) {
    return !!v && ((typeof W.Blob === 'function' && v instanceof W.Blob)
      || (typeof W.File === 'function' && v instanceof W.File));
  }

  /** Resolve any accepted source to a drawable with known dimensions. */
  function toDrawable(source) {
    return new Promise(function (resolve, reject) {
      if (!source) { reject(new Error('no image given')); return; }

      if (isBitmap(source) || isCanvas(source)) {
        if (!source.width || !source.height) { reject(new Error('image is empty')); return; }
        resolve({ node: source, w: source.width, h: source.height, own: false, name: '' });
        return;
      }

      if (isImageEl(source)) {
        var iw = source.naturalWidth || source.width;
        var ih = source.naturalHeight || source.height;
        if (!iw || !ih) { reject(new Error('image is not loaded yet')); return; }
        resolve({ node: source, w: iw, h: ih, own: false, name: '' });
        return;
      }

      if (isImageData(source)) {
        var cv = getScratch(source.width, source.height);
        if (!cv) { reject(new Error('no canvas available')); return; }
        var c2 = cv.getContext('2d');
        c2.putImageData(source, 0, 0);
        /* copy off the shared scratch so the later draw does not eat it */
        var copy = document.createElement('canvas');
        copy.width = source.width; copy.height = source.height;
        copy.getContext('2d').drawImage(cv, 0, 0);
        resolve({ node: copy, w: copy.width, h: copy.height, own: false, name: '' });
        return;
      }

      if (isBlobLike(source)) {
        var name = source.name ? String(source.name) : '';
        if (source.type && String(source.type).indexOf('image/') !== 0 && !/\.(png|jpe?g|gif|webp|bmp)$/i.test(name)) {
          reject(new Error('that file is not an image'));
          return;
        }
        if (typeof W.createImageBitmap === 'function') {
          W.createImageBitmap(source).then(function (bmp) {
            resolve({ node: bmp, w: bmp.width, h: bmp.height, own: true, name: name });
          }, function () {
            decodeViaImg(source, name, resolve, reject);
          });
          return;
        }
        decodeViaImg(source, name, resolve, reject);
        return;
      }

      reject(new Error('unsupported image source'));
    });
  }

  function decodeViaImg(blob, name, resolve, reject) {
    var url;
    try { url = W.URL.createObjectURL(blob); } catch (e) { reject(new Error('cannot read that file')); return; }
    var img = new W.Image();
    var done = false;
    img.onload = function () {
      if (done) return;
      done = true;
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (!w || !h) { try { W.URL.revokeObjectURL(url); } catch (e2) {} reject(new Error('image is empty')); return; }
      resolve({
        node: img, w: w, h: h, own: false, name: name,
        release: function () { try { W.URL.revokeObjectURL(url); } catch (e3) {} }
      });
    };
    img.onerror = function () {
      if (done) return;
      done = true;
      try { W.URL.revokeObjectURL(url); } catch (e4) {}
      reject(new Error('could not decode that image'));
    };
    img.src = url;
  }

  /** Grid size from the crop's aspect, capped at MAX_SIDE either way. */
  function gridFor(cw, ch, stitchWidth) {
    var gw = Math.round(clampNum(stitchWidth, 1, MAX_SIDE, 100));
    if (gw < 1) gw = 1;
    var gh = Math.round(gw * ch / cw);
    if (gh < 1) gh = 1;
    if (gh > MAX_SIDE) {
      gh = MAX_SIDE;
      gw = Math.round(MAX_SIDE * cw / ch);
      if (gw < 1) gw = 1;
      if (gw > MAX_SIDE) gw = MAX_SIDE;
    }
    return { gw: gw, gh: gh };
  }

  /**
   * Intermediate size: enough source detail for a clean box average
   * without paying for the full 12 MP. ~6x the grid, capped at 1600 and
   * never larger than the crop.
   */
  function interSize(cw, ch, gw, gh) {
    var want = gw * 6;
    if (want < 600) want = 600;
    if (want > 1600) want = 1600;
    var iw = Math.min(Math.round(cw), want);
    if (iw < gw) iw = gw;
    var ih = Math.round(iw * ch / cw);
    if (ih < gh) ih = gh;
    if (ih > 1600) {
      ih = 1600;
      iw = Math.round(ih * cw / ch);
      if (iw < gw) iw = gw;
    }
    return { iw: iw, ih: ih };
  }

  function drawToPixels(d, opts) {
    var cx = 0, cy = 0, cw = d.w, ch = d.h;
    if (opts.crop) {
      cx = Math.max(0, Math.min(d.w - 1, Math.round(opts.crop.x)));
      cy = Math.max(0, Math.min(d.h - 1, Math.round(opts.crop.y)));
      cw = Math.max(1, Math.min(d.w - cx, Math.round(opts.crop.w)));
      ch = Math.max(1, Math.min(d.h - cy, Math.round(opts.crop.h)));
    }
    var g = gridFor(cw, ch, opts.stitchWidth);
    var s = interSize(cw, ch, g.gw, g.gh);
    var cv = getScratch(s.iw, s.ih);
    if (!cv) throw new Error('no canvas available');
    var ctx = cv.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.clearRect(0, 0, s.iw, s.ih);
    try {
      ctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    } catch (e) { /* older engines */ }
    ctx.drawImage(d.node, cx, cy, cw, ch, 0, 0, s.iw, s.ih);
    var id = ctx.getImageData(0, 0, s.iw, s.ih);
    return {
      buf: id.data.buffer, iw: s.iw, ih: s.ih,
      gw: g.gw, gh: g.gh, srcW: d.w, srcH: d.h,
      cropW: cw, cropH: ch
    };
  }

  /* ================================================================== *
   * 6. Assembling the XSData result
   * ================================================================== */

  function hexToRgbTriple(hex) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16)
    ];
  }

  function buildPreview(cells, w, h, palette) {
    var n = w * h;
    var arr;
    try { arr = new Uint8ClampedArray(n * 4); } catch (e) { arr = new Uint8Array(n * 4); }
    var rgb = [], i;
    for (i = 0; i < palette.length; i++) rgb.push(hexToRgbTriple(palette[i].hex));
    for (i = 0; i < n; i++) {
      var v = cells[i];
      var c = (v >= 0 && rgb[v]) ? rgb[v] : [255, 255, 255];
      var o = i * 4;
      arr[o] = c[0]; arr[o + 1] = c[1]; arr[o + 2] = c[2]; arr[o + 3] = 255;
    }
    try {
      return new W.ImageData(arr, w, h);
    } catch (e2) {
      try {
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        var id = cv.getContext('2d').createImageData(w, h);
        for (var j = 0; j < arr.length; j++) id.data[j] = arr[j];
        return id;
      } catch (e3) {
        return null;
      }
    }
  }

  function assemble(core, opts, px, fileName, warnings, t) {
    var XS = W.XStitch;
    var cells = core.cells;
    var gw = core.w, gh = core.h;
    var n = gw * gh;

    /* palette */
    var palette = [], skeinsTotal = 0, i;
    for (i = 0; i < core.palette.length; i++) {
      var pe = core.palette[i];
      var f = XS.FLOSS.dmc[pe.floss] || { code: '', name: '', hex: '808080' };
      var sk = XS.skeinsFor({
        stitchCount: pe.stitchCount, count: opts.count, over: opts.over,
        strands: opts.strands, waste: opts.waste
      });
      skeinsTotal += sk;
      palette.push({
        i: i,
        symbol: '',
        brand: 'DMC',
        code: f.code,
        name: f.name,
        hex: f.hex,
        strands: opts.strands,
        bsStrands: 1,
        kind: 'cross',
        blendWith: null,
        stitchCount: pe.stitchCount,
        skeins: sk,
        have: false
      });
    }
    XS.assignSymbols(palette);

    /* confetti before/after, in the final palette index space */
    var before = core.before || cells;
    var cBefore = XS.confetti({ w: gw, h: gh, cells: before });
    var cAfter = opts.cleanup > 0 ? XS.confetti({ w: gw, h: gh, cells: cells }) : cBefore;

    var zero;
    try { zero = new Uint8Array(n); } catch (e) { zero = []; }
    var data = {
      v: 1,
      fabric: {
        count: opts.count,
        countY: opts.count,
        over: opts.over,
        kind: opts.over === 2 ? 'evenweave' : 'aida',
        color: 'White',
        widthIn: null,
        heightIn: null
      },
      design: { w: gw, h: gh, title: '', designer: '', copyright: '' },
      strandsDefault: opts.strands,
      palette: palette,
      chart: {
        w: gw, h: gh,
        cells: XS.packCells(cells, gw, gh),
        part: [], back: [], knots: []
      },
      pages: [],
      progress: {
        mode: 'cells',
        done: XS.packBits(zero, n),
        doneCount: 0,
        perColor: [],
        pageDone: [],
        blocks: {}
      },
      current: { paletteIndex: 0, page: 0, cx: 0, cy: 0, zoom: 1 },
      parking: [],
      stash: {},
      notesKey: '',
      source: {
        kind: 'photo',
        fileName: fileName || '',
        importedAt: Date.now(),
        warnings: warnings.slice()
      }
    };
    data = XS.normalize(data);

    var preview = buildPreview(cells, gw, gh, palette);

    var times = core.times || {};
    var phases = {
      decode: Math.round(t.decode * 10) / 10,
      resample: Math.round((times.resample || 0) * 10) / 10,
      quantize: Math.round((times.quantize || 0) * 10) / 10,
      match: Math.round((times.match || 0) * 10) / 10,
      cleanup: Math.round((times.cleanup || 0) * 10) / 10,
      count: Math.round((times.count || 0) * 10) / 10,
      assemble: 0,
      total: 0
    };

    return {
      ok: true,
      data: data,
      stats: {
        colors: palette.length,
        cells: n,
        confetti: { before: cBefore.total, after: cAfter.total },
        ms: 0,
        skeinsTotal: skeinsTotal,
        phases: phases,
        iterations: core.iters || 0,
        meanDE: Math.round((core.meanDE || 0) * 100) / 100,
        maxDE: Math.round((core.maxDE || 0) * 100) / 100,
        mergedColors: core.merged || 0,
        source: { w: px.srcW, h: px.srcH, cropW: px.cropW, cropH: px.cropH, sampledW: px.iw, sampledH: px.ih },
        worker: !!t.worker,
        warnings: warnings.slice()
      },
      preview: preview
    };
  }

  /* ================================================================== *
   * 7. convert()
   * ================================================================== */

  var seq = 0;
  var jobs = {};            // token -> job
  var mainCore = null;      // lazily built core for the fallback path

  function getMainCore() {
    if (mainCore) return mainCore;
    var lab = buildFlossLab();
    if (!lab) return null;
    mainCore = XSPhotoCore();
    mainCore.setFloss(lab);
    return mainCore;
  }

  function nowMs() {
    return (typeof performance !== 'undefined' && performance && performance.now)
      ? performance.now() : Date.now();
  }

  function convert(source, opts, onProgress) {
    var token = (isObj(opts) && opts.token) ? String(opts.token) : ('xsp' + (++seq));
    var warnings = [];
    var o;
    try {
      o = normOpts(opts, warnings);
    } catch (e) {
      o = normOpts(null, warnings);
    }

    var settle = null;
    var promise = new Promise(function (resolve) { settle = resolve; });
    promise.token = token;

    var job = {
      id: token,
      token: token,
      opts: o,
      cancelled: false,
      settled: false,
      px: null,
      gw: 0, gh: 0,
      timer: null,
      t: { decode: 0, worker: false },
      t0: nowMs(),
      fileName: '',
      emit: function (phase, pct, phasePct) {
        if (typeof onProgress !== 'function' || job.settled) return;
        try {
          onProgress({ phase: phase, pct: Math.max(0, Math.min(100, Math.round(pct))), phasePct: phasePct });
        } catch (e) { /* a broken callback must not kill the job */ }
      },
      /* the core reports 0..100 of its own work; decode owns 0..10 and the
         final assembly owns 95..100, so map it into 10..95 here */
      emitCore: function (phase, pct, phasePct) {
        job.emit(phase === 'count' ? 'symbols' : phase, 10 + pct * 0.85, phasePct);
      },
      done: function (res) {
        if (job.settled) return;
        job.settled = true;
        delete jobs[token];
        settle(res);
      },
      resolveCancelled: function () {
        job.done({ ok: false, error: 'cancelled', cancelled: true, token: token });
      },
      fail: function (msg) {
        job.done({ ok: false, error: String(msg || 'conversion failed'), token: token });
      },
      failWorker: function (msg) {
        /* the worker is gone or refused the job: finish on the main thread
           rather than failing the user's conversion */
        if (job.cancelled) { job.resolveCancelled(); return; }
        if (!job.px || !job.px.buf) { job.fail(msg); return; }
        warnings.push('worker unavailable (' + msg + '); converted on the main thread');
        job.t.worker = false;
        runOnMain(job);
      },
      finish: function (coreRes) {
        if (job.cancelled) { job.resolveCancelled(); return; }
        try {
          job.emit('symbols', 95, 0);
          var tA = nowMs();
          var res = assemble(coreRes, job.opts, job.px, job.fileName, warnings, job.t);
          res.stats.phases.assemble = Math.round((nowMs() - tA) * 10) / 10;
          res.stats.ms = Math.round((nowMs() - job.t0) * 10) / 10;
          res.stats.phases.total = res.stats.ms;
          res.token = token;
          job.emit('symbols', 100, 100);
          job.done(res);
        } catch (e) {
          job.fail((e && e.message) ? e.message : 'could not build the chart');
        }
      }
    };
    jobs[token] = job;

    if (!W.XStitch || !W.XStitch.FLOSS) {
      job.fail('xstitch.js is not loaded');
      return promise;
    }

    job.emit('decode', 1, 0);

    var drawable = null;
    toDrawable(source).then(function (d) {
      drawable = d;
      if (job.cancelled) { releaseDrawable(drawable); job.resolveCancelled(); return; }
      job.fileName = d.name || '';
      var px = drawToPixels(d, o);
      releaseDrawable(drawable);
      drawable = null;
      job.px = px;
      job.gw = px.gw;
      job.gh = px.gh;
      job.t.decode = Math.round((nowMs() - job.t0) * 10) / 10;
      job.emit('decode', 10, 100);

      if (job.cancelled) { job.resolveCancelled(); return; }

      if (!o.noWorker && workerSupported() && getWorker()) {
        job.t.worker = true;
        queue.push(job);
        pump();
      } else {
        job.t.worker = false;
        runOnMain(job);
      }
    }, function (err) {
      if (drawable) releaseDrawable(drawable);
      if (job.cancelled) { job.resolveCancelled(); return; }
      job.fail((err && err.message) ? err.message : 'could not read that image');
    })['catch'](function (err) {
      job.fail((err && err.message) ? err.message : 'conversion failed');
    });

    return promise;
  }

  function releaseDrawable(d) {
    if (!d) return;
    if (d.release) d.release();
    if (d.own && d.node && typeof d.node.close === 'function') {
      try { d.node.close(); } catch (e) { /* ignore */ }
    }
  }

  /** The fallback: one core step per setTimeout tick so the UI paints. */
  function runOnMain(job) {
    var core = getMainCore();
    if (!core) { job.fail('xstitch.js is not loaded'); return; }
    var runner;
    try {
      runner = core.createJob({
        buf: job.px.buf, iw: job.px.iw, ih: job.px.ih,
        gw: job.gw, gh: job.gh, opts: job.opts
      });
    } catch (e) {
      job.fail((e && e.message) ? e.message : 'could not start the conversion');
      return;
    }
    job.px.buf = null;

    function tick() {
      job.timer = null;
      if (job.cancelled) { job.resolveCancelled(); return; }
      var r;
      try {
        r = runner.step();
      } catch (e) {
        job.fail((e && e.message) ? e.message : 'conversion failed');
        return;
      }
      job.emitCore(r.phase, r.pct, r.phasePct);
      if (r.done) {
        job.finish(r.result);
        return;
      }
      job.timer = W.setTimeout(tick, 0);
    }
    job.timer = W.setTimeout(tick, 0);
  }

  /**
   * cancel(token) -> boolean
   * With no token, cancels everything in flight. A running worker job is
   * terminated (the worker is rebuilt for the next call) so cancellation
   * is immediate even mid-Lloyd.
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
      if (running === job) {
        killWorker();
        running = null;
      }
      for (var q = queue.length - 1; q >= 0; q--) {
        if (queue[q] === job) queue.splice(q, 1);
      }
      job.resolveCancelled();
    }
    pump();
    return true;
  }

  /* ================================================================== *
   * 8. Exports
   * ================================================================== */

  W.XStitchPhoto = {
    isAvailable: isAvailable,
    defaults: defaults,
    convert: convert,
    cancel: cancel,

    /* test/debug surface — not part of the §B6 contract */
    _core: XSPhotoCore,
    _workerSrc: buildWorkerSrc,
    _normOpts: function (o) { return normOpts(o, []); },
    _gridFor: gridFor,
    _interSize: interSize
  };

})();
