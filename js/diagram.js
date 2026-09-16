/* ==========================================================================
   Thready or Not — Live 3D diagram renderer
   --------------------------------------------------------------------------
   Renders a crochet piece in real time as a slowly rotating 3D solid.
   Raw WebGL 1 (no dependency): one vertex + one fragment shader, Lambert with
   a wrapped key light, a cool bounce fill, a rim highlight and per-vertex
   colours with baked crevice AO. Canvas 2D silhouette fallback when WebGL is
   unavailable.

   Public API (see SPEC.md "Live 3D diagram" § 2 Renderer):
     Diagram.mount(canvas, { palette, reducedMotion, interactive }) -> handle
     handle.setModel(model, { animate: 'stitch'|'round'|'none' })
     handle.setPalette(palette)
     handle.setInteractive(bool)
     handle.setReducedMotion(bool)
     handle.resize()
     handle.getStats()   -> { fps, frameMs, buildMs, triangles, drawCalls, ... }
     handle.destroy()

   No modules, no build step. Attaches window.Diagram.

   Deliberate departures from SPEC.md:
   - rows mode turns a full circle like rounds mode, but with non-uniform
     angular speed: 6 deg/s while the sheet faces the camera (or its back),
     60 deg/s through the edge-on zone, eased between. The fabric is extruded
     so it has a real edge and never vanishes at 90 deg.
   - the solid part's minimum share of the frame ramps with progress (0 below
     15% of the planned height, 45% from 40% up) instead of being a flat 45%,
     and ghost rounds pushed past the canvas edge fade out. Nothing is ever
     drawn clipped.
   - crevice AO darkens slice edges by 17%, not 12%; 12% did not read at
     button size.
   ========================================================================== */

(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- tuning */

  var SW = 1.0;            // stitch width, world units
  var SH = 1.5;            // stitch height for height === 1
  var BUMP = 0.22;         // outward bump at stitch centre, fraction of SW
  var BULGE = 0.13;        // mid-band outward bulge / inter-round groove
  var DIP = 0.17;          // vertical scallop ("v" shape) as a fraction of row height
  var R_MIN = 0.42;        // smallest ring radius
  var MAX_SLICES = 160;    // per-ring slice cap (subsample beyond)
  var SEGS = 4;            // angular segments per stitch
  var ROWS = 2;            // vertical segments per band (3 vertex rows)
  var COLS = SEGS + 1;     // 5 vertex columns
  var VROWS = ROWS + 1;    // 3 vertex rows
  var VPS = COLS * VROWS;  // 15 vertices per slice
  var TPS = SEGS * ROWS * 2;       // 16 triangles per slice
  var TIDX = TPS * 3;              // 48 indices per slice
  var LPS = SEGS * 2 + 2;          // 10 wire lines per slice
  var LIDX = LPS * 2;              // 20 indices per slice
  // extruded (rows) slice: front grid + back grid + 2 side walls + 2 end walls
  var TPS_THICK = TPS * 2 + ROWS * 2 * 2 + SEGS * 2 * 2;   // 56 triangles
  var TIDX_THICK = TPS_THICK * 3;                          // 168 indices
  var THICK = 0.55;                // fabric thickness, fraction of SW
  var BACK_BUMP = 0.45;            // how much of the face texture the back keeps
  var FLOATS = 13;         // anchor3 + offset3 + normal3 + colour3 + slice1

  var AO_EDGE = 0.17;      // darkening at slice edges
  var AO_BAND = 0.07;      // darkening at band edges
  var AO_DESAT = 0.22;     // desaturation mixed in at the crevices

  var FOV = 30 * Math.PI / 180;
  var PITCH = 20 * Math.PI / 180;
  var CAM_DIST = 34;
  var ROT_SPEED = 12 * Math.PI / 180;   // rad/s, rounds mode
  // rows mode turns a full circle too, but dwells on the face and flicks
  // through the edge-on zone so the sheet is readable almost all the time
  var ROWS_SLOW = 6 * Math.PI / 180;    // rad/s while facing the camera
  var ROWS_FAST = 60 * Math.PI / 180;   // rad/s through edge-on
  var ROWS_FACE = 50 * Math.PI / 180;   // "facing" half-window
  var ROWS_EDGE = 85 * Math.PI / 180;   // fully edge-on by here
  var ROT_PAUSE = 1500;                 // ms after setModel
  var FIT_EASE = 200;                   // ms
  var STITCH_ANIM = 140;                // ms
  var ROUND_ANIM = 620;                 // ms
  var FIT_MARGIN = 0.92;                // 8% margin
  var GHOST_FLOOR = 0.45;               // most the solid part is ever guaranteed
  var FLOOR_FROM = 0.15;                // no floor at all below this much progress
  var FLOOR_TO = 0.40;                  // full floor from this much progress up

  var GHOST_ALPHA = 0.30;
  var PENDING_ALPHA = 0.62;

  var DEFAULT_PALETTE = {
    ghost: '#ffffff',
    ink: '#ffffff',
    glow: '#fff4c4',
    bg: null
  };
  var DEFAULT_YARN = '#f1e3c8';

  /* ------------------------------------------------------------- utilities */

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutCubic(t) { var u = 1 - t; return 1 - u * u * u; }
  function smoothstep(a, b, x) {
    var t = clamp((x - a) / (b - a || 1e-6), 0, 1);
    return t * t * (3 - 2 * t);
  }

  var now = (global.performance && global.performance.now)
    ? function () { return global.performance.now(); }
    : function () { return Date.now(); };

  /* Colour parsing -> { r, g, b, a } in sRGB 0..1 */
  var COLOR_CACHE = {};
  function parseColor(str, fallback) {
    if (str == null) return fallback;
    if (typeof str !== 'string') return fallback;
    var key = str;
    var hit = COLOR_CACHE[key];
    if (hit) return hit;
    var s = str.trim();
    var out = null;
    var m;
    if (s.charAt(0) === '#') {
      var h = s.slice(1);
      if (h.length === 3 || h.length === 4) {
        out = {
          r: parseInt(h.charAt(0) + h.charAt(0), 16) / 255,
          g: parseInt(h.charAt(1) + h.charAt(1), 16) / 255,
          b: parseInt(h.charAt(2) + h.charAt(2), 16) / 255,
          a: h.length === 4 ? parseInt(h.charAt(3) + h.charAt(3), 16) / 255 : 1
        };
      } else if (h.length === 6 || h.length === 8) {
        out = {
          r: parseInt(h.slice(0, 2), 16) / 255,
          g: parseInt(h.slice(2, 4), 16) / 255,
          b: parseInt(h.slice(4, 6), 16) / 255,
          a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
        };
      }
    } else if ((m = /^rgba?\(([^)]+)\)$/i.exec(s))) {
      var parts = m[1].split(/[,\s/]+/).filter(function (x) { return x.length; });
      if (parts.length >= 3) {
        out = {
          r: clamp(parseFloat(parts[0]) / 255, 0, 1),
          g: clamp(parseFloat(parts[1]) / 255, 0, 1),
          b: clamp(parseFloat(parts[2]) / 255, 0, 1),
          a: parts.length > 3 ? clamp(parseFloat(parts[3]), 0, 1) : 1
        };
      }
    }
    if (!out || isNaN(out.r) || isNaN(out.g) || isNaN(out.b)) return fallback;
    COLOR_CACHE[key] = out;
    return out;
  }

  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  var LIN_CACHE = {};
  function linearOf(str, fallbackHex) {
    var key = str || fallbackHex;
    var hit = LIN_CACHE[key];
    if (hit) return hit;
    var c = parseColor(str, parseColor(fallbackHex, { r: 1, g: 1, b: 1, a: 1 }));
    var lin = [srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b), c.a];
    LIN_CACHE[key] = lin;
    return lin;
  }

  /* ------------------------------------------------------------- mat4 math */

  function mat4() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  function perspective(out, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2);
    var nf = 1 / (near - far);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
    return out;
  }

  /* --------------------------------------------------------------- shaders */

  var VERT_SRC = [
    'attribute vec3 aAnchor;',
    'attribute vec3 aOffset;',
    'attribute vec3 aNormal;',
    'attribute vec3 aColor;',
    'attribute float aSlice;',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    'uniform mat3 uNormalMat;',
    'uniform float uAnimSlice;',
    'uniform float uAnimScale;',
    'varying vec3 vNormal;',
    'varying vec3 vColor;',
    'varying vec3 vView;',
    'void main() {',
    '  float s = abs(aSlice - uAnimSlice) < 0.5 ? uAnimScale : 1.0;',
    '  vec3 p = aAnchor + aOffset * s;',
    '  vec4 vp = uView * vec4(p, 1.0);',
    '  vView = vp.xyz;',
    '  vNormal = uNormalMat * aNormal;',
    '  vColor = aColor;',
    '  gl_Position = uProj * vp;',
    '  gl_PointSize = 2.0;',
    '}'
  ].join('\n');

  var FRAG_SRC = [
    'precision mediump float;',
    'varying vec3 vNormal;',
    'varying vec3 vColor;',
    'varying vec3 vView;',
    'uniform float uWire;',
    'uniform float uAlpha;',
    'uniform float uGlow;',
    'uniform vec3 uFlat;',
    'uniform vec3 uGlowColor;',
    'uniform vec3 uRimColor;',
    'void main() {',
    '  vec3 c;',
    '  if (uWire > 0.5) {',
    '    c = uFlat;',
    '  } else {',
    '    vec3 N = normalize(vNormal);',
    '    vec3 V = normalize(-vView);',
    '    if (dot(N, V) < 0.0) N = -N;',
    '    vec3 K = normalize(vec3(-0.52, 0.74, 0.62));',  // key: upper-left, front
    '    vec3 F = normalize(vec3(0.30, -0.86, 0.22));',  // fill: from below
    '    float nk = dot(N, K);',
    '    float wrap = max((nk + 0.38) / 1.38, 0.0);',    // soft wrapped lambert
    '    float fill = max(dot(N, F), 0.0);',
    '    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);',
    '    vec3 H = normalize(K + V);',
    '    float spec = pow(max(dot(N, H), 0.0), 24.0) * 0.10;',
    '    c = vColor * (0.20 + 0.92 * wrap);',
    '    c += vColor * vec3(0.46, 0.53, 0.70) * 0.26 * fill;',
    '    c += vec3(spec);',
    '    c += uRimColor * rim * 0.44;',
    '    c = mix(c, uGlowColor, uGlow);',
    '  }',
    '  c = max(c, vec3(0.0));',
    '  c = pow(c, vec3(0.45454545));',          // linear -> sRGB
    '  gl_FragColor = vec4(c * uAlpha, uAlpha);', // premultiplied
    '}'
  ].join('\n');

  /* ------------------------------------------------------ model normalising */

  function hashStr(h, s) {
    if (!s) return (h * 16777619) >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function hashNum(h, n) {
    h ^= (n * 1000 | 0);
    return (h * 16777619) >>> 0;
  }

  var STITCH_AMP = {
    sl: 0.22, ch: 0.20, x: 1.0, sc: 1.0, inc: 1.02, dec: 0.92,
    hdc: 1.06, dc: 1.12, tr: 1.16, bbl: 1.85, puff: 1.7
  };
  var STITCH_W = {
    sl: 0.72, ch: 0.85, x: 1.0, sc: 1.0, inc: 1.18, dec: 0.82,
    hdc: 1.0, dc: 1.0, tr: 1.0, bbl: 1.2, puff: 1.2
  };

  /* Build the render-side description of one round: slices (after the 160 cap),
     per-slice amplitude / width weight / colour, and the done slice count. */
  function prepRound(round, defColor, prev) {
    var count = Math.max(0, round.count | 0);
    var done = clamp(round.done | 0, 0, count);
    var stitches = round.stitches || null;
    var base = round.color || defColor || DEFAULT_YARN;
    var height = round.height > 0 ? round.height : 1;
    var ghost = !!round.ghost;
    var n = Math.min(count, MAX_SLICES);

    /* Fast path for the tap loop: the caller normally hands back the very same
       stitches array and only moves `done`, so nothing but the draw range
       changes. Reuse the prepared round instead of re-parsing every colour. */
    if (prev && prev.ref === stitches && prev.count === count && prev.base === base &&
        prev.height === height && prev.ghost === ghost) {
      prev.done = done;
      prev.doneSlices = count > 0 ? Math.round(done / count * n) : 0;
      return prev;
    }

    var hashSeed = 2166136261;
    var step = count > 0 ? count / n : 1;
    var amp = new Float32Array(n);
    var wt = new Float32Array(n);
    var col = new Float32Array(n * 3);
    var h = hashSeed;
    h = hashNum(h, count);
    h = hashStr(h, base); h = hashNum(h, height);
    h = hashNum(h, ghost ? 1 : 0);
    h = hashNum(h, stitches ? stitches.length : 0);

    for (var i = 0; i < n; i++) {
      var si = count > 0 ? Math.min(count - 1, Math.floor(i * step)) : 0;
      var st = null;
      if (stitches && stitches.length) {
        st = stitches[si < stitches.length ? si : stitches.length - 1];
      }
      var t = (st && st.t) || 'sc';
      var c = (st && st.c) || base;
      amp[i] = STITCH_AMP[t] != null ? STITCH_AMP[t] : 1.0;
      wt[i] = STITCH_W[t] != null ? STITCH_W[t] : 1.0;
      var lin = linearOf(c, DEFAULT_YARN);
      col[i * 3] = lin[0]; col[i * 3 + 1] = lin[1]; col[i * 3 + 2] = lin[2];
      h = hashStr(h, t); h = hashStr(h, c);
    }
    return {
      count: count, done: done, n: n,
      doneSlices: count > 0 ? Math.round(done / count * n) : 0,
      amp: amp, wt: wt, col: col,
      height: height, ghost: ghost,
      ref: stitches, base: base,
      hash: h >>> 0
    };
  }

  function normalizeModel(model, prev) {
    var m = model || {};
    var mode = m.mode === 'rows' ? 'rows' : 'rounds';
    var src = m.rounds || [];
    var def = m.defaultColor || DEFAULT_YARN;
    var prevRounds = (prev && prev.mode === mode) ? prev.rounds : null;
    var rounds = [];
    for (var i = 0; i < src.length; i++) {
      if (!src[i]) continue;
      rounds.push(prepRound(src[i], def, prevRounds ? prevRounds[rounds.length] : null));
    }
    var current = clamp(m.current == null ? rounds.length - 1 : m.current | 0, 0,
      Math.max(0, rounds.length - 1));
    return { mode: mode, rounds: rounds, current: current, defaultColor: def };
  }

  /* ----------------------------------------------------------- band layout */

  /* rounds mode.
     Ring radius comes straight from the stitch count. The vertical step is the
     interesting part: a literal arc-length walk (dy = sqrt(reach^2 - dR^2))
     turns "increase 6 every round" into a perfect cone, because in flat
     geometry that IS a cone. Real fabric cups, so instead we take the slope
     the same radius would have on a sphere of the piece's widest radius:
     phi = asin(R / Rmax). The step then has to cover dR horizontally, so
     its length is max(reach, dR / cos phi) — stuffing stretches the rounds
     near the equator exactly like that. Spheres read as balls, tubes stay
     straight, and a cone keeps its taper with a softly rounded tip. */
  var MAX_STRETCH = 2.6;

  function layoutRounds(rounds) {
    var i, n = rounds.length;
    var R = new Float64Array(n);
    var rMax = R_MIN;
    for (i = 0; i < n; i++) {
      R[i] = Math.max(R_MIN, rounds[i].count * SW / TAU);
      if (R[i] > rMax) rMax = R[i];
    }
    var bands = [];
    var prevR = n ? R[0] * 0.34 : 0, prevY = 0;
    for (i = 0; i < n; i++) {
      var reach = rounds[i].height * SH;
      var dR = Math.abs(R[i] - prevR);
      var t = clamp(((prevR + R[i]) / 2) / rMax, 0, 0.9995);
      var phi = Math.asin(t);
      var dy = Math.max(reach * Math.sin(phi), dR * Math.tan(phi));
      dy = clamp(dy, 0.06 * reach, MAX_STRETCH * reach);
      var y = prevY - dy;
      bands.push({ rTop: prevR, rBot: R[i], yTop: prevY, yBot: y, reach: reach });
      prevR = R[i]; prevY = y;
    }
    return bands;
  }

  /* rows mode: a gently curved sheet, rows stacked bottom-up. Flat fabric is
     not stretched over stuffing, so a row is only as tall as the stitch. */
  var SH_ROWS = 1.05;
  var SHEET_CURVE = 3;    // bend radius as a multiple of the sheet width

  function layoutRows(rounds) {
    var maxCount = 1, i;
    for (i = 0; i < rounds.length; i++) maxCount = Math.max(maxCount, rounds[i].count);
    var width = maxCount * SW;
    var Rc = Math.max(width * SHEET_CURVE, 8);
    var bands = [];
    var y = 0;
    for (i = 0; i < rounds.length; i++) {
      var r = rounds[i];
      var reach = r.height * SH_ROWS;
      bands.push({ rTop: Rc, rBot: Rc, yTop: y + reach, yBot: y, reach: reach, Rc: Rc });
      y += reach;
    }
    return bands;
  }

  /* ---------------------------------------------------------- band builder */

  /* Shared profile stamps: index k = angular column, t = vertical row. */
  var CU = new Float32Array(COLS);     // -cos(2*pi*u)  : -1 at the edges, +1 at the centre
  var DCU = new Float32Array(COLS);    // d/du of CU
  var EDGE = new Float32Array(COLS);   // 1 at the slice edges, 0 at the centre
  var FT = new Float32Array(VROWS);    // vertical taper of the bump
  var DFT = new Float32Array(VROWS);
  var DIPU = new Float32Array(COLS);   // vertical scallop
  var DDIPU = new Float32Array(COLS);
  var BLG = new Float32Array(VROWS);
  var DBLG = new Float32Array(VROWS);
  var DIPT = new Float32Array(VROWS);   // scallop tapers to 0 at the band edges
  var DDIPT = new Float32Array(VROWS);  // so consecutive rounds stay watertight
  (function initProfiles() {
    var k, t, u;
    for (k = 0; k < COLS; k++) {
      u = k / SEGS;
      CU[k] = -Math.cos(TAU * u);
      DCU[k] = TAU * Math.sin(TAU * u);
      EDGE[k] = (1 - CU[k]) / 2;
      DIPU[k] = -DIP * (1 + CU[k]) / 2;
      DDIPU[k] = -DIP * DCU[k] / 2;
    }
    for (t = 0; t < VROWS; t++) {
      var tt = t / ROWS;
      FT[t] = 0.34 + 0.66 * Math.sin(Math.PI * tt);
      DFT[t] = 0.66 * Math.PI * Math.cos(Math.PI * tt);
      BLG[t] = BULGE * SW * (1.35 * Math.sin(Math.PI * tt) - 0.42);
      DBLG[t] = BULGE * SW * 1.35 * Math.PI * Math.cos(Math.PI * tt);
      DIPT[t] = Math.sin(Math.PI * tt);
      DDIPT[t] = Math.PI * Math.cos(Math.PI * tt);
    }
  }());

  /* Builds one band (one round / one row) into typed arrays.
     opts: n, a0[], aw[], amp[], col[], rBase[3], drdt, yBase[3], dydt, zOff,
           dipScale, anchorCol, thick
     `thick` > 0 extrudes the bump surface inward by that much and closes the
     four sides, so flat fabric has a real edge and never vanishes when it
     turns side-on. Rounds mode is a closed solid already and passes 0. */
  function buildBand(o) {
    var n = o.n;
    var thick = o.thick || 0;
    var vps = thick ? VPS * 2 : VPS;
    var tidx = thick ? TIDX_THICK : TIDX;
    var verts = new Float32Array(n * vps * FLOATS);
    var tri = new Uint16Array(n * tidx);
    var lin = new Uint16Array(n * LIDX);
    var a0 = o.a0, aw = o.aw, amp = o.amp, col = o.col;
    var rB = o.rBase, yB = o.yBase, drdt = o.drdt, dydt = o.dydt;
    var zOff = o.zOff, dipScale = o.dipScale;
    var anchorCol = o.anchorCol;
    var cosA = new Float64Array(COLS), sinA = new Float64Array(COLS);
    var px = new Float64Array(VPS), py = new Float64Array(VPS), pz = new Float64Array(VPS);
    var nx = new Float64Array(VPS), ny = new Float64Array(VPS), nz = new Float64Array(VPS);
    var bx = thick ? new Float64Array(VPS) : null;
    var bz = thick ? new Float64Array(VPS) : null;
    var j, k, t, vi, p, idx;

    for (j = 0; j < n; j++) {
      var A = amp[j] * BUMP * SW;
      var aStart = a0[j], aWidth = aw[j];
      for (k = 0; k < COLS; k++) {
        var ang = aStart + aWidth * (k / SEGS);
        cosA[k] = Math.cos(ang); sinA[k] = Math.sin(ang);
      }
      for (t = 0; t < VROWS; t++) {
        var ft = FT[t], dft = DFT[t];
        var rowR = rB[t] + BLG[t];
        var rowY = yB[t];
        var dr_dt_row = drdt + DBLG[t];
        var dipT = DIPT[t], ddipT = DDIPT[t];
        for (k = 0; k < COLS; k++) {
          vi = t * COLS + k;
          var ca = cosA[k], sa = sinA[k];
          var r = rowR + A * CU[k] * ft;
          var y = rowY + dipScale * DIPU[k] * dipT;
          px[vi] = r * ca;
          py[vi] = y;
          pz[vi] = r * sa + zOff;
          // tangents
          var dr_du = A * DCU[k] * ft;
          var dy_du = dipScale * DDIPU[k] * dipT;
          var tux = dr_du * ca - r * aWidth * sa;
          var tuy = dy_du;
          var tuz = dr_du * sa + r * aWidth * ca;
          var dr_dt = dr_dt_row + A * CU[k] * dft;
          var tvx = dr_dt * ca;
          var tvy = dydt + dipScale * DIPU[k] * ddipT;
          var tvz = dr_dt * sa;
          var Nx = tuy * tvz - tuz * tvy;
          var Ny = tuz * tvx - tux * tvz;
          var Nz = tux * tvy - tuy * tvx;
          var len = Math.sqrt(Nx * Nx + Ny * Ny + Nz * Nz) || 1;
          Nx /= len; Ny /= len; Nz /= len;
          if (Nx * ca + Nz * sa < 0) { Nx = -Nx; Ny = -Ny; Nz = -Nz; }
          nx[vi] = Nx; ny[vi] = Ny; nz[vi] = Nz;
          if (thick) {
            var rb = rowR - thick + A * CU[k] * ft * BACK_BUMP;
            bx[vi] = rb * ca;
            bz[vi] = rb * sa + zOff;
          }
        }
      }

      // anchor: mid-height of the leading edge, so the stitch unfurls from its
      // neighbour rather than from thin air.
      var ai = 1 * COLS + anchorCol;
      var ax = px[ai], ay = py[ai], az = pz[ai];
      var cr = col[j * 3], cg = col[j * 3 + 1], cb = col[j * 3 + 2];
      var lum = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
      var base = j * vps;

      for (t = 0; t < VROWS; t++) {
        var edgeT = (t === 0 || t === VROWS - 1) ? 1 : 0;
        for (k = 0; k < COLS; k++) {
          vi = t * COLS + k;
          var ao = EDGE[k] * AO_EDGE + edgeT * AO_BAND;
          var mixv = ao * (AO_DESAT / (AO_EDGE + AO_BAND));
          var dark = 1 - ao;
          var fr = lerp(cr, lum * 0.62, mixv) * dark;
          var fg = lerp(cg, lum * 0.62, mixv) * dark;
          var fb = lerp(cb, lum * 0.62, mixv) * dark;
          p = (base + vi) * FLOATS;
          verts[p] = ax; verts[p + 1] = ay; verts[p + 2] = az;
          verts[p + 3] = px[vi] - ax; verts[p + 4] = py[vi] - ay; verts[p + 5] = pz[vi] - az;
          verts[p + 6] = nx[vi]; verts[p + 7] = ny[vi]; verts[p + 8] = nz[vi];
          verts[p + 9] = fr; verts[p + 10] = fg; verts[p + 11] = fb;
          verts[p + 12] = j;
          if (thick) {
            // the wrong side of the fabric: darker and flatter
            p = (base + VPS + vi) * FLOATS;
            verts[p] = ax; verts[p + 1] = ay; verts[p + 2] = az;
            verts[p + 3] = bx[vi] - ax; verts[p + 4] = py[vi] - ay; verts[p + 5] = bz[vi] - az;
            verts[p + 6] = -nx[vi]; verts[p + 7] = -ny[vi]; verts[p + 8] = -nz[vi];
            verts[p + 9] = lerp(fr, lum * 0.45, 0.38) * 0.52;
            verts[p + 10] = lerp(fg, lum * 0.45, 0.38) * 0.52;
            verts[p + 11] = lerp(fb, lum * 0.45, 0.38) * 0.52;
            verts[p + 12] = j;
          }
        }
      }

      idx = j * tidx;
      for (t = 0; t < ROWS; t++) {
        for (k = 0; k < SEGS; k++) {
          var v00 = base + t * COLS + k;
          var v10 = v00 + 1;
          var v01 = v00 + COLS;
          var v11 = v01 + 1;
          tri[idx++] = v00; tri[idx++] = v01; tri[idx++] = v10;
          tri[idx++] = v10; tri[idx++] = v01; tri[idx++] = v11;
        }
      }
      if (thick) {
        var B = base + VPS;
        for (t = 0; t < ROWS; t++) {           // back face
          for (k = 0; k < SEGS; k++) {
            var w00 = B + t * COLS + k;
            var w10 = w00 + 1;
            var w01 = w00 + COLS;
            var w11 = w01 + 1;
            tri[idx++] = w00; tri[idx++] = w10; tri[idx++] = w01;
            tri[idx++] = w10; tri[idx++] = w11; tri[idx++] = w01;
          }
        }
        for (var e = 0; e < 2; e++) {          // the two side walls (u edges)
          var ke = e === 0 ? 0 : SEGS;
          for (t = 0; t < ROWS; t++) {
            var f0 = base + t * COLS + ke, f1 = f0 + COLS;
            var b0 = B + t * COLS + ke, b1 = b0 + COLS;
            tri[idx++] = f0; tri[idx++] = b0; tri[idx++] = f1;
            tri[idx++] = f1; tri[idx++] = b0; tri[idx++] = b1;
          }
        }
        for (e = 0; e < 2; e++) {              // the two end walls (t edges)
          var te = e === 0 ? 0 : ROWS;
          for (k = 0; k < SEGS; k++) {
            var g0 = base + te * COLS + k, g1 = g0 + 1;
            var h0 = B + te * COLS + k, h1 = h0 + 1;
            tri[idx++] = g0; tri[idx++] = g1; tri[idx++] = h0;
            tri[idx++] = g1; tri[idx++] = h1; tri[idx++] = h0;
          }
        }
      }
      idx = j * LIDX;
      for (k = 0; k < SEGS; k++) {
        lin[idx++] = base + k; lin[idx++] = base + k + 1;
        lin[idx++] = base + ROWS * COLS + k; lin[idx++] = base + ROWS * COLS + k + 1;
      }
      for (t = 0; t < ROWS; t++) {
        lin[idx++] = base + t * COLS; lin[idx++] = base + (t + 1) * COLS;
      }
    }
    return { verts: verts, tri: tri, lin: lin, n: n, tps: tidx, lps: LIDX };
  }

  /* Small domed cap for the magic ring at the top of a round-worked piece. */
  function buildCap(radius, y, color) {
    var n = 18;
    var verts = new Float32Array((n + 1) * FLOATS);
    var tri = new Uint16Array(n * 3);
    var lin = new Uint16Array(n * 2);
    var dome = radius * 0.55;
    var lum = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
    function put(i, x, yy, z, nxv, nyv, nzv, shade) {
      var p = i * FLOATS;
      verts[p] = x; verts[p + 1] = yy; verts[p + 2] = z;
      verts[p + 3] = 0; verts[p + 4] = 0; verts[p + 5] = 0;
      verts[p + 6] = nxv; verts[p + 7] = nyv; verts[p + 8] = nzv;
      verts[p + 9] = lerp(color[0], lum * 0.62, (1 - shade) * 0.5) * shade;
      verts[p + 10] = lerp(color[1], lum * 0.62, (1 - shade) * 0.5) * shade;
      verts[p + 11] = lerp(color[2], lum * 0.62, (1 - shade) * 0.5) * shade;
      verts[p + 12] = -7;
    }
    put(0, 0, y + dome, 0, 0, 1, 0, 1);
    for (var i = 0; i < n; i++) {
      var a = i / n * TAU;
      var ca = Math.cos(a), sa = Math.sin(a);
      put(i + 1, radius * ca, y, radius * sa, ca * 0.55, 0.83, sa * 0.55, 0.86);
      tri[i * 3] = 0; tri[i * 3 + 1] = 1 + i; tri[i * 3 + 2] = 1 + ((i + 1) % n);
      lin[i * 2] = 1 + i; lin[i * 2 + 1] = 1 + ((i + 1) % n);
    }
    return {
      verts: verts, tri: tri, lin: lin, n: 1, isCap: true,
      triCount: n * 3, linCount: n * 2, tps: n * 3, lps: n * 2
    };
  }

  /* Turns one prepared round + its layout band into geometry. */
  function buildRoundBand(mode, round, band, index) {
    var n = round.n;
    if (n <= 0) return null;
    var a0 = new Float64Array(n), aw = new Float64Array(n);
    var total = 0, j;
    for (j = 0; j < n; j++) total += round.wt[j];
    if (total <= 0) total = n;

    if (mode === 'rounds') {
      var acc = 0;
      for (j = 0; j < n; j++) {
        var w = round.wt[j] / total * TAU;
        a0[j] = acc; aw[j] = w; acc += w;
      }
      return buildBand({
        n: n, a0: a0, aw: aw, amp: round.amp, col: round.col,
        rBase: [band.rTop, (band.rTop + band.rBot) / 2, band.rBot],
        drdt: band.rBot - band.rTop,
        yBase: [band.yTop, (band.yTop + band.yBot) / 2, band.yBot],
        dydt: band.yBot - band.yTop,
        zOff: 0,
        dipScale: band.reach * (band.yBot < band.yTop ? 1 : -1),
        anchorCol: 0
      });
    }
    /* rows: a cylinder segment about a vertical axis behind the sheet, so
       world = ( r*sin(a), y, r*cos(a) - Rc ). The shared builder emits
       ( r*cos(A), y, r*sin(A) + zOff ), so A = PI/2 - a and zOff = -Rc.
       Slice 0 starts at the left on even rows and at the right on odd rows,
       which is the direction that row is worked — the in-progress row then
       fills from alternating ends with nothing but a draw-range change. */
    var Rc = band.Rc;
    var totalW = n * SW;
    var rtl = (index & 1) === 1;
    var shift = rtl ? 0.25 * SW : -0.25 * SW;
    var x = (rtl ? totalW / 2 : -totalW / 2) + shift;
    var HALF_PI = Math.PI / 2;
    for (j = 0; j < n; j++) {
      var sw = round.wt[j] / total * totalW;
      var dx = rtl ? -sw : sw;
      a0[j] = HALF_PI - x / Rc;
      aw[j] = -dx / Rc;
      x += dx;
    }
    return buildBand({
      n: n, a0: a0, aw: aw, amp: round.amp, col: round.col,
      rBase: [Rc, Rc, Rc], drdt: 0,
      yBase: [band.yTop, (band.yTop + band.yBot) / 2, band.yBot],
      dydt: band.yBot - band.yTop,
      zOff: -Rc,
      dipScale: band.reach,
      anchorCol: 0,
      thick: THICK * SW
    });
  }

  /* ============================================================ WebGL core */

  function createGL(canvas) {
    var attrs = {
      alpha: true, premultipliedAlpha: true, antialias: true,
      depth: true, stencil: false, preserveDrawingBuffer: false,
      powerPreference: 'default', failIfMajorPerformanceCaveat: false
    };
    var gl = null;
    try { gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs); }
    catch (e) { gl = null; }
    return gl;
  }

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('Diagram shader: ' + log);
    }
    return s;
  }

  function makeProgram(gl) {
    var vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aAnchor');
    gl.bindAttribLocation(p, 1, 'aOffset');
    gl.bindAttribLocation(p, 2, 'aNormal');
    gl.bindAttribLocation(p, 3, 'aColor');
    gl.bindAttribLocation(p, 4, 'aSlice');
    gl.linkProgram(p);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error('Diagram program: ' + log);
    }
    return {
      program: p,
      u: {
        proj: gl.getUniformLocation(p, 'uProj'),
        view: gl.getUniformLocation(p, 'uView'),
        nrm: gl.getUniformLocation(p, 'uNormalMat'),
        animSlice: gl.getUniformLocation(p, 'uAnimSlice'),
        animScale: gl.getUniformLocation(p, 'uAnimScale'),
        wire: gl.getUniformLocation(p, 'uWire'),
        alpha: gl.getUniformLocation(p, 'uAlpha'),
        glow: gl.getUniformLocation(p, 'uGlow'),
        flat: gl.getUniformLocation(p, 'uFlat'),
        glowColor: gl.getUniformLocation(p, 'uGlowColor'),
        rimColor: gl.getUniformLocation(p, 'uRimColor')
      }
    };
  }

  /* ================================================================= mount */

  function mount(canvas, options) {
    if (!canvas) throw new Error('Diagram.mount: canvas required');
    var opts = options || {};

    var state = {
      canvas: canvas,
      palette: {},
      reducedMotion: !!opts.reducedMotion,
      interactive: !!opts.interactive,
      model: normalizeModel(null),
      chunks: [],          // per band GPU chunk
      capChunk: null,
      hashes: [],
      bands: [],
      destroyed: false,
      gl: null,
      prog: null,
      fallback2d: null,
      dpr: 1,
      w: 0, h: 0,
      // camera
      yaw: -0.35, pitch: PITCH,
      spinVel: 0,
      zoom: 1,
      userPitch: 0,
      pauseUntil: 0,
      fit: { scale: 1, cx: 0, cy: 0, cz: 0 },
      fitFrom: { scale: 1, cx: 0, cy: 0, cz: 0 },
      fitTo: { scale: 1, cx: 0, cy: 0, cz: 0 },
      fitT0: 0,
      anim: null,
      glowAnim: null,
      rafId: 0,
      running: false,
      lastT: 0,
      dirty: true,
      // stats
      stats: { fps: 0, frameMs: 0, buildMs: 0, triangles: 0, drawCalls: 0, chunks: 0, verts: 0 },
      frameAcc: 0, frameN: 0, fpsT0: 0, fpsFrames: 0
    };

    var proj = mat4(), view = mat4();
    var nrm = new Float32Array(9);

    setPalette(opts.palette);

    /* --------------------------------------------------------- palette */
    function setPalette(p) {
      var pal = {};
      var src = p || {};
      pal.ghost = src.ghost || DEFAULT_PALETTE.ghost;
      pal.ink = src.ink || DEFAULT_PALETTE.ink;
      pal.glow = src.glow || DEFAULT_PALETTE.glow;
      pal.bg = src.bg || DEFAULT_PALETTE.bg;
      state.palette = pal;
      state.ghostLin = linearOf(pal.ghost, '#ffffff');
      state.glowLin = linearOf(pal.glow, '#fff4c4');
      var g = state.glowLin;
      // rim: mostly white, warmed by the glow colour
      state.rimLin = [lerp(1, g[0], 0.35), lerp(1, g[1], 0.35), lerp(1, g[2], 0.35)];
      state.dirty = true;
      kick();
    }

    /* ------------------------------------------------------- GL lifecycle */

    function initGL() {
      var gl = createGL(canvas);
      if (!gl) { state.gl = null; state.fallback2d = canvas.getContext('2d'); return false; }
      state.gl = gl;
      try { state.prog = makeProgram(gl); }
      catch (e) {
        if (global.console) global.console.warn(e.message);
        state.gl = null;
        state.fallback2d = canvas.getContext('2d');
        return false;
      }
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      return true;
    }

    function disposeChunks() {
      var gl = state.gl;
      if (gl) {
        for (var i = 0; i < state.chunks.length; i++) freeChunk(state.chunks[i]);
        freeChunk(state.capChunk);
      }
      state.chunks = [];
      state.capChunk = null;
      state.hashes = [];
    }

    function freeChunk(c) {
      if (!c || !state.gl) return;
      var gl = state.gl;
      if (c.vbo) gl.deleteBuffer(c.vbo);
      if (c.tbo) gl.deleteBuffer(c.tbo);
      if (c.lbo) gl.deleteBuffer(c.lbo);
    }

    function uploadChunk(geo, prev) {
      var gl = state.gl;
      var c = prev || {};
      if (!c.vbo) { c.vbo = gl.createBuffer(); c.tbo = gl.createBuffer(); c.lbo = gl.createBuffer(); }
      gl.bindBuffer(gl.ARRAY_BUFFER, c.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, geo.verts, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.tbo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.tri, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.lbo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.lin, gl.STATIC_DRAW);
      c.n = geo.n;
      c.isCap = !!geo.isCap;
      c.tps = geo.tps != null ? geo.tps : TIDX;     // triangle indices per slice
      c.lps = geo.lps != null ? geo.lps : LIDX;     // line indices per slice
      c.triCount = geo.triCount != null ? geo.triCount : geo.n * c.tps;
      c.linCount = geo.linCount != null ? geo.linCount : geo.n * c.lps;
      c.verts = geo.verts.length / FLOATS;
      return c;
    }

    /* ---------------------------------------------------------- geometry */

    function rebuild(model) {
      var t0 = now();
      var mode = model.mode;
      var rounds = model.rounds;
      var bands = mode === 'rows' ? layoutRows(rounds) : layoutRounds(rounds);
      state.bands = bands;

      var gl = state.gl;
      var i;
      if (!gl) { state.stats.buildMs = now() - t0; return; }

      // drop chunks beyond the current round count
      for (i = rounds.length; i < state.chunks.length; i++) freeChunk(state.chunks[i]);
      state.chunks.length = rounds.length;
      state.hashes.length = rounds.length;

      var built = 0;
      for (i = 0; i < rounds.length; i++) {
        var r = rounds[i];
        var b = bands[i];
        var h = r.hash;
        h = hashNum(h, b.rTop * 97); h = hashNum(h, b.rBot * 97);
        h = hashNum(h, b.yTop * 97); h = hashNum(h, b.yBot * 97);
        h = hashNum(h, mode === 'rows' ? 2 : 1);
        h = hashNum(h, i & 1);
        if (state.hashes[i] === h && state.chunks[i]) continue;
        var geo = buildRoundBand(mode, r, b, i);
        if (!geo) { freeChunk(state.chunks[i]); state.chunks[i] = null; state.hashes[i] = h; continue; }
        state.chunks[i] = uploadChunk(geo, state.chunks[i]);
        state.hashes[i] = h;
        built++;
      }

      // magic-ring cap
      if (mode === 'rounds' && rounds.length && rounds[0].count > 0) {
        var c0 = rounds[0];
        var capCol = [c0.col[0], c0.col[1], c0.col[2]];
        var capHash = hashNum(hashNum(c0.hash, bands[0].rTop * 997), capCol[0] * 255);
        if (state.capHash !== capHash || !state.capChunk) {
          state.capChunk = uploadChunk(buildCap(bands[0].rTop, bands[0].yTop, capCol), state.capChunk);
          state.capHash = capHash;
          built++;
        }
      } else if (state.capChunk) {
        freeChunk(state.capChunk); state.capChunk = null; state.capHash = 0;
      }

      var stat = state.stats;
      stat.chunks = rounds.length;
      stat.buildMs = now() - t0;
      stat.rebuilt = built;
      var vtot = 0;
      for (i = 0; i < state.chunks.length; i++) if (state.chunks[i]) vtot += state.chunks[i].verts;
      stat.verts = vtot;
    }

    /* -------------------------------------------------------------- fit */

    /* Worst-case extent of one band under rotation: a radius about the
       vertical axis plus a y range. Shared by the fit and the ghost fade. */
    function bandExtent(i, out) {
      var r = state.model.rounds[i], b = state.bands[i];
      if (!b || !r || r.count <= 0) return null;
      out.rad = state.model.mode === 'rows'
        ? r.n * SW / 2 + THICK * SW
        : Math.max(b.rTop, b.rBot) + BUMP * SW;
      out.ymin = Math.min(b.yTop, b.yBot);
      out.ymax = Math.max(b.yTop, b.yBot);
      return out;
    }

    var _ext = { rad: 0, ymin: 0, ymax: 0 };
    var _half = { w: 1, h: 1, cp: 1, sp: 0, scale: 1, cy: 0 };

    /* Refreshed once per frame; frameFade then costs a handful of multiplies. */
    function updateFrameMetrics() {
      _half.h = CAM_DIST * Math.tan(FOV / 2);
      _half.w = _half.h * (state.h > 0 ? state.w / state.h : 1);
      var pitch = state.pitch + state.userPitch;
      _half.cp = Math.cos(pitch);
      _half.sp = Math.abs(Math.sin(pitch));
      _half.scale = state.fit.scale * state.zoom;
      _half.cy = state.fit.cy;
    }

    /* 1 - how far past the canvas edge this band reaches; ghosts fade out over
       the last 8% so nothing is ever drawn clipped. */
    function frameFade(i) {
      if (!bandExtent(i, _ext)) return 0;
      var s = _half.scale;
      var hx = _ext.rad * s;
      var hy = Math.max(Math.abs(_ext.ymax - _half.cy), Math.abs(_ext.ymin - _half.cy)) * s * _half.cp +
        _ext.rad * s * _half.sp;
      var f = Math.max(hx / _half.w, hy / _half.h);
      return 1 - smoothstep(FIT_MARGIN, 1.0, f);
    }

    function computeFit() {
      var rounds = state.model.rounds;
      var sR = 0, sYmin = Infinity, sYmax = -Infinity, sAny = false;
      var aR = 0, aYmin = Infinity, aYmax = -Infinity, aAny = false;
      for (var i = 0; i < rounds.length; i++) {
        if (!bandExtent(i, _ext)) continue;
        aAny = true;
        aR = Math.max(aR, _ext.rad);
        aYmin = Math.min(aYmin, _ext.ymin); aYmax = Math.max(aYmax, _ext.ymax);
        if (!rounds[i].ghost && rounds[i].doneSlices > 0) {
          sAny = true;
          sR = Math.max(sR, _ext.rad);
          sYmin = Math.min(sYmin, _ext.ymin); sYmax = Math.max(sYmax, _ext.ymax);
        }
      }
      if (!aAny) return { scale: 1, cx: 0, cy: 0, cz: 0 };
      if (!sAny) { sR = aR; sYmin = aYmin; sYmax = aYmax; }

      var aspect = state.h > 0 ? state.w / state.h : 1;
      var halfH = CAM_DIST * Math.tan(FOV / 2) * FIT_MARGIN;
      var halfW = halfH * aspect;
      var cp = Math.cos(state.pitch), sp = Math.abs(Math.sin(state.pitch));

      function fitScale(rad, ymin, ymax) {
        var hy = (ymax - ymin) / 2;
        var sW = halfW / Math.max(rad, 1e-4);
        var sH = halfH / Math.max(hy * cp + rad * sp, 1e-4);
        return Math.min(sW, sH);
      }
      /* Baseline: the WHOLE model (solids + ghosts) fits with the 8% margin.
         The minimum size guaranteed to the solid part then ramps with
         progress, so a piece two stitches in is framed as the plan it will
         become rather than as a speck inside an oversized cage. Once the
         floor does start to bite, ghost rounds pushed past the canvas edge
         fade out (see frameFade) instead of being drawn clipped. */
      var allH = aYmax - aYmin;
      var progress = allH > 1e-6 ? clamp((sYmax - sYmin) / allH, 0, 1) : 1;
      var floor = GHOST_FLOOR * smoothstep(FLOOR_FROM, FLOOR_TO, progress);

      var sAll = fitScale(aR, aYmin, aYmax);
      var sSolid = fitScale(sR, sYmin, sYmax);
      var scale = Math.max(sAll, sSolid * floor);
      var k = sAll > 0 ? clamp((scale / sAll - 1) * 2, 0, 1) : 0;
      var cy = lerp((aYmin + aYmax) / 2, (sYmin + sYmax) / 2, k);
      return { scale: scale, cx: 0, cy: cy, cz: 0 };
    }

    function applyFit(target, immediate) {
      var f = state.fit;
      if (immediate || (Math.abs(target.scale - f.scale) < 1e-4 && Math.abs(target.cy - f.cy) < 1e-3)) {
        state.fit = { scale: target.scale, cx: target.cx, cy: target.cy, cz: target.cz };
        state.fitTo = state.fit;
        state.fitT0 = 0;
        return;
      }
      state.fitFrom = { scale: f.scale, cx: f.cx, cy: f.cy, cz: f.cz };
      state.fitTo = target;
      state.fitT0 = now();
    }

    function tickFit(t) {
      if (!state.fitT0) return false;
      var u = clamp((t - state.fitT0) / FIT_EASE, 0, 1);
      var e = easeOutCubic(u);
      var a = state.fitFrom, b = state.fitTo;
      state.fit = {
        scale: lerp(a.scale, b.scale, e),
        cx: lerp(a.cx, b.cx, e),
        cy: lerp(a.cy, b.cy, e),
        cz: lerp(a.cz, b.cz, e)
      };
      if (u >= 1) { state.fitT0 = 0; return false; }
      return true;
    }

    /* ------------------------------------------------------------ render */

    function buildView() {
      var s = state.fit.scale * state.zoom;
      var yaw = state.yaw;
      var cy = Math.cos(yaw), sy = Math.sin(yaw);
      var pitch = state.pitch + state.userPitch;
      var cp = Math.cos(pitch), sp = Math.sin(pitch);

      // R = Rx(pitch) * Ry(yaw), row-major entries
      var r00 = cy, r01 = 0, r02 = sy;
      var r10 = sp * sy, r11 = cp, r12 = -sp * cy;
      var r20 = -cp * sy, r21 = sp, r22 = cp * cy;

      var cx = state.fit.cx, ccy = state.fit.cy, ccz = state.fit.cz;
      // view = T(0,0,-d) * R * S(s) * T(-c)
      var m = view;
      m[0] = r00 * s; m[1] = r10 * s; m[2] = r20 * s; m[3] = 0;
      m[4] = r01 * s; m[5] = r11 * s; m[6] = r21 * s; m[7] = 0;
      m[8] = r02 * s; m[9] = r12 * s; m[10] = r22 * s; m[11] = 0;
      var tx = -(r00 * cx + r01 * ccy + r02 * ccz) * s;
      var ty = -(r10 * cx + r11 * ccy + r12 * ccz) * s;
      var tz = -(r20 * cx + r21 * ccy + r22 * ccz) * s;
      m[12] = tx; m[13] = ty; m[14] = tz - CAM_DIST; m[15] = 1;

      nrm[0] = r00; nrm[1] = r10; nrm[2] = r20;
      nrm[3] = r01; nrm[4] = r11; nrm[5] = r21;
      nrm[6] = r02; nrm[7] = r12; nrm[8] = r22;
    }

    var ATTRS = [
      { loc: 0, size: 3, off: 0 },
      { loc: 1, size: 3, off: 12 },
      { loc: 2, size: 3, off: 24 },
      { loc: 3, size: 3, off: 36 },
      { loc: 4, size: 1, off: 48 }
    ];

    function bindChunk(gl, c) {
      gl.bindBuffer(gl.ARRAY_BUFFER, c.vbo);
      for (var i = 0; i < ATTRS.length; i++) {
        var a = ATTRS[i];
        gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, FLOATS * 4, a.off);
      }
    }

    function render(t) {
      var gl = state.gl;
      if (!gl) { render2d(); return; }
      if (state.w <= 0 || state.h <= 0) return;
      var t0 = now();
      var prog = state.prog, u = prog.u;

      gl.viewport(0, 0, state.w, state.h);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog.program);

      perspective(proj, FOV, state.h > 0 ? state.w / state.h : 1, 0.5, CAM_DIST * 6);
      buildView();
      updateFrameMetrics();
      gl.uniformMatrix4fv(u.proj, false, proj);
      gl.uniformMatrix4fv(u.view, false, view);
      gl.uniformMatrix3fv(u.nrm, false, nrm);
      gl.uniform3f(u.glowColor, state.glowLin[0], state.glowLin[1], state.glowLin[2]);
      gl.uniform3f(u.rimColor, state.rimLin[0], state.rimLin[1], state.rimLin[2]);
      gl.uniform3f(u.flat, state.ghostLin[0], state.ghostLin[1], state.ghostLin[2]);

      for (var i = 0; i < ATTRS.length; i++) gl.enableVertexAttribArray(ATTRS[i].loc);

      var rounds = state.model.rounds;
      var draws = 0, tris = 0;

      // animation uniforms
      var animBand = -1, animSlice = -1, animScale = 1;
      if (state.anim) {
        var au = clamp((t - state.anim.t0) / STITCH_ANIM, 0, 1);
        animScale = overshoot(au);
        animBand = state.anim.band;
        animSlice = state.anim.slice;
        if (au >= 1) { state.anim = null; animBand = -1; animSlice = -1; animScale = 1; }
      }
      var glowBand = -1, glowAmt = 0;
      if (state.glowAnim) {
        var gu = clamp((t - state.glowAnim.t0) / ROUND_ANIM, 0, 1);
        glowBand = state.glowAnim.band;
        glowAmt = Math.sin(gu * Math.PI) * 0.72;
        if (gu >= 1) { state.glowAnim = null; glowBand = -1; glowAmt = 0; }
      }

      /* pass 1: opaque solids */
      gl.depthMask(true);
      gl.uniform1f(u.wire, 0);
      gl.uniform1f(u.alpha, 1);

      if (state.capChunk && rounds.length && !rounds[0].ghost && rounds[0].doneSlices > 0) {
        var cc = state.capChunk;
        bindChunk(gl, cc);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cc.tbo);
        gl.uniform1f(u.animSlice, -1);
        gl.uniform1f(u.animScale, 1);
        gl.uniform1f(u.glow, glowBand === 0 ? glowAmt : 0);
        gl.drawElements(gl.TRIANGLES, cc.triCount, gl.UNSIGNED_SHORT, 0);
        draws++; tris += cc.triCount / 3;
      }

      for (i = 0; i < state.chunks.length; i++) {
        var c = state.chunks[i];
        if (!c) continue;
        var r = rounds[i];
        if (r.ghost) continue;
        var solid = Math.min(r.doneSlices, c.n);
        if (solid <= 0) continue;
        bindChunk(gl, c);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.tbo);
        gl.uniform1f(u.animSlice, animBand === i ? animSlice : -1);
        gl.uniform1f(u.animScale, animBand === i ? animScale : 1);
        gl.uniform1f(u.glow, glowBand === i ? glowAmt : 0);
        gl.drawElements(gl.TRIANGLES, solid * c.tps, gl.UNSIGNED_SHORT, 0);
        draws++; tris += solid * c.tps / 3;
      }

      /* pass 2: translucent wireframe (ghost rounds + the pending part of the
         ring in progress) */
      gl.depthMask(false);
      gl.uniform1f(u.wire, 1);
      gl.uniform1f(u.glow, 0);
      gl.uniform1f(u.animSlice, -1);
      gl.uniform1f(u.animScale, 1);
      var ghostA = state.ghostLin[3] != null ? state.ghostLin[3] : 1;
      for (i = 0; i < state.chunks.length; i++) {
        var cw = state.chunks[i];
        if (!cw) continue;
        var rw = rounds[i];
        var start = rw.ghost ? 0 : Math.min(rw.doneSlices, cw.n);
        if (start >= cw.n) continue;
        var a = (rw.ghost ? GHOST_ALPHA : PENDING_ALPHA) * ghostA;
        // a ghost round that no longer fits the frame fades out instead of
        // being drawn clipped at the canvas edge
        if (rw.ghost) {
          a *= frameFade(i);
          if (a < 0.004) continue;
        }
        gl.uniform1f(u.alpha, a);
        bindChunk(gl, cw);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cw.lbo);
        gl.drawElements(gl.LINES, (cw.n - start) * cw.lps, gl.UNSIGNED_SHORT, start * cw.lps * 2);
        draws++;
      }
      gl.depthMask(true);

      for (i = 0; i < ATTRS.length; i++) gl.disableVertexAttribArray(ATTRS[i].loc);

      var dt = now() - t0;
      var st = state.stats;
      st.drawCalls = draws;
      st.triangles = tris | 0;
      state.frameAcc += dt; state.frameN++;
      if (state.frameN >= 12) {
        st.frameMs = state.frameAcc / state.frameN;
        state.frameAcc = 0; state.frameN = 0;
      }
    }

    function overshoot(u) {
      // ease-out-back: 0 -> 1 with a small overshoot
      var c1 = 1.9, c3 = c1 + 1;
      var x = u - 1;
      return 1 + c3 * x * x * x + c1 * x * x;
    }

    /* --------------------------------------------------- 2D fallback draw */

    function render2d() {
      var ctx = state.fallback2d;
      if (!ctx || state.w <= 0) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, state.w, state.h);
      var rounds = state.model.rounds, bands = state.bands;
      if (!rounds.length) return;
      var mode = state.model.mode;
      var f = computeFit();
      var s = f.scale * state.zoom * (state.h / (2 * CAM_DIST * Math.tan(FOV / 2)));
      var cxp = state.w / 2, cyp = state.h / 2;
      var sp = Math.sin(state.pitch);
      var i;
      function px(x) { return cxp + x * s; }
      function py(y, z) { return cyp - (y - f.cy) * s * Math.cos(state.pitch) + (z || 0) * s * sp; }

      ctx.lineWidth = Math.max(1, state.dpr);
      for (i = 0; i < rounds.length; i++) {
        var r = rounds[i], b = bands[i];
        if (!b || r.count <= 0) continue;
        var frac = r.count > 0 ? r.done / r.count : 0;
        if (mode === 'rows') {
          var w = r.n * SW;
          var x0 = -w / 2, x1 = w / 2;
          if (!r.ghost && frac > 0) {
            var fw = w * frac;
            var lx = (i & 1) ? x1 - fw : x0;
            ctx.fillStyle = colStr(r, 0.92);
            ctx.fillRect(px(lx), py(Math.max(b.yTop, b.yBot)), fw * s, Math.abs(b.yTop - b.yBot) * s * Math.cos(state.pitch));
          }
          if (r.ghost || frac < 1) {
            ctx.strokeStyle = strokeStr(r.ghost ? GHOST_ALPHA : PENDING_ALPHA);
            ctx.strokeRect(px(x0), py(Math.max(b.yTop, b.yBot)), w * s, Math.abs(b.yTop - b.yBot) * s * Math.cos(state.pitch));
          }
          continue;
        }
        var rt = b.rTop, rb = b.rBot;
        var yt = py(b.yTop), yb = py(b.yBot);
        var ellT = rt * s * sp, ellB = rb * s * sp;
        if (!r.ghost && frac > 0) {
          ctx.fillStyle = colStr(r, 1);
          ctx.beginPath();
          ctx.ellipse(cxp, yt, rt * s, Math.max(0.5, ellT), 0, Math.PI, 0, true);
          ctx.lineTo(cxp + rb * s, yb);
          ctx.ellipse(cxp, yb, rb * s, Math.max(0.5, ellB), 0, 0, Math.PI, false);
          ctx.closePath();
          ctx.globalAlpha = frac >= 1 ? 1 : 0.35 + 0.65 * frac;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        if (r.ghost || frac < 1) {
          ctx.strokeStyle = strokeStr(r.ghost ? GHOST_ALPHA : PENDING_ALPHA);
          ctx.beginPath();
          ctx.ellipse(cxp, yb, rb * s, Math.max(0.5, ellB), 0, 0, TAU);
          ctx.stroke();
        }
      }
      function colStr(r, k) {
        var cr = Math.round(Math.pow(clamp(r.col[0], 0, 1), 0.4545) * 255 * k);
        var cg = Math.round(Math.pow(clamp(r.col[1], 0, 1), 0.4545) * 255 * k);
        var cb = Math.round(Math.pow(clamp(r.col[2], 0, 1), 0.4545) * 255 * k);
        return 'rgb(' + cr + ',' + cg + ',' + cb + ')';
      }
      function strokeStr(a) {
        var g = parseColor(state.palette.ghost, { r: 1, g: 1, b: 1, a: 1 });
        return 'rgba(' + Math.round(g.r * 255) + ',' + Math.round(g.g * 255) + ',' +
          Math.round(g.b * 255) + ',' + (a * (g.a == null ? 1 : g.a)) + ')';
      }
    }

    /* ------------------------------------------------------------- loop */

    /* Rounds mode turns at a constant 12 deg/s. Rows mode turns a full circle
       as well, but a flat sheet is only worth looking at near face-on, so it
       dwells there at 6 deg/s and flicks through the edge-on zone at 60. */
    function spinSpeed(yaw) {
      if (state.model.mode !== 'rows') return ROT_SPEED;
      var d = Math.asin(Math.min(1, Math.abs(Math.sin(yaw))));  // 0 = face/back on
      return lerp(ROWS_SLOW, ROWS_FAST, smoothstep(ROWS_FACE, ROWS_EDGE, d));
    }

    function needsFrame(t) {
      if (state.dirty) return true;
      if (state.fitT0) return true;
      if (state.anim || state.glowAnim) return true;
      if (state.dragging) return true;
      if (Math.abs(state.spinVel) > 0.0005) return true;
      if (!state.reducedMotion && t >= state.pauseUntil) return true;
      return false;
    }

    function frame(t) {
      state.rafId = 0;
      if (state.destroyed) return;
      var dt = state.lastT ? Math.min((t - state.lastT) / 1000, 0.1) : 0;
      state.lastT = t;

      // spin
      if (state.dragging) {
        // yaw driven by pointer handlers
      } else if (Math.abs(state.spinVel) > 0.0005) {
        state.yaw += state.spinVel * dt;
        state.spinVel *= Math.pow(0.06, dt);   // inertia decay
        if (Math.abs(state.spinVel) < 0.0005) state.spinVel = 0;
      } else if (!state.reducedMotion && t >= state.pauseUntil) {
        state.yaw += spinSpeed(state.yaw) * dt;
      }
      if (state.yaw > TAU) state.yaw -= TAU;
      if (state.yaw < -TAU) state.yaw += TAU;

      tickFit(t);
      state.dirty = false;
      render(t);

      // fps
      state.fpsFrames++;
      if (!state.fpsT0) state.fpsT0 = t;
      else if (t - state.fpsT0 >= 500) {
        state.stats.fps = state.fpsFrames * 1000 / (t - state.fpsT0);
        state.fpsT0 = t; state.fpsFrames = 0;
      }

      if (needsFrame(t)) { schedule(); return; }
      state.running = false; state.lastT = 0; state.fpsT0 = 0;
      state.fpsFrames = 0; state.stats.fps = 0;
      // idle during the post-tap rotation pause: wake up when it expires
      if (!state.reducedMotion && !state.dragging) {
        var wait = state.pauseUntil - now();
        if (wait > 0) {
          if (state.resumeTimer) global.clearTimeout(state.resumeTimer);
          state.resumeTimer = global.setTimeout(function () {
            state.resumeTimer = 0;
            if (!state.destroyed) kick();
          }, wait + 16);
        }
      }
    }

    function schedule() {
      if (state.destroyed || state.rafId) return;
      state.running = true;
      state.rafId = global.requestAnimationFrame(frame);
    }

    function kick() {
      state.dirty = true;
      if (!state.rafId) { state.lastT = 0; schedule(); }
    }

    /* ----------------------------------------------------------- resize */

    function resize() {
      if (state.destroyed) return;
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      var rect = canvas.getBoundingClientRect();
      var cssW = rect.width || canvas.clientWidth || 0;
      var cssH = rect.height || canvas.clientHeight || 0;
      if (cssW <= 0 || cssH <= 0) return;
      var w = Math.max(1, Math.round(cssW * dpr));
      var h = Math.max(1, Math.round(cssH * dpr));
      if (w === state.w && h === state.h && dpr === state.dpr) return;
      canvas.width = w; canvas.height = h;
      state.w = w; state.h = h; state.dpr = dpr;
      applyFit(computeFit(), true);
      kick();
    }

    var ro = null;
    if (global.ResizeObserver) {
      ro = new global.ResizeObserver(function () { resize(); });
      try { ro.observe(canvas); } catch (e) { ro = null; }
    }
    function onWinResize() { resize(); }
    global.addEventListener('resize', onWinResize);

    /* ------------------------------------------------------ context loss */

    function onLost(e) {
      e.preventDefault();
      state.gl = null;
      state.prog = null;
      state.chunks = [];
      state.capChunk = null;
      state.hashes = [];
      if (state.rafId) { global.cancelAnimationFrame(state.rafId); state.rafId = 0; }
      state.running = false;
    }
    function onRestored() {
      if (state.destroyed) return;
      state.fallback2d = null;
      if (initGL()) {
        state.hashes = [];
        rebuild(state.model);
        applyFit(computeFit(), true);
        kick();
      }
    }
    canvas.addEventListener('webglcontextlost', onLost, false);
    canvas.addEventListener('webglcontextrestored', onRestored, false);

    /* ------------------------------------------------------- interaction */

    var pointers = {};
    var pinchDist = 0, lastTap = 0, dragMoved = 0;

    function onPointerDown(e) {
      if (!state.interactive) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
      var n = countPointers();
      if (n === 1) {
        state.dragging = true;
        state.spinVel = 0;
        dragMoved = 0;
      } else if (n === 2) {
        pinchDist = twoPointerDist();
      }
      e.preventDefault();
      kick();
    }
    function countPointers() { var n = 0; for (var k in pointers) if (pointers.hasOwnProperty(k)) n++; return n; }
    function twoPointerDist() {
      var a = null, b = null;
      for (var k in pointers) {
        if (!pointers.hasOwnProperty(k)) continue;
        if (!a) a = pointers[k]; else if (!b) b = pointers[k];
      }
      if (!a || !b) return 0;
      var dx = a.x - b.x, dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    function onPointerMove(e) {
      if (!state.interactive) return;
      var p = pointers[e.pointerId];
      if (!p) return;
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      var n = countPointers();
      if (n >= 2) {
        var d = twoPointerDist();
        if (pinchDist > 0 && d > 0) {
          state.zoom = clamp(state.zoom * (d / pinchDist), 0.35, 5);
          pinchDist = d;
        }
      } else if (state.dragging) {
        dragMoved += Math.abs(dx) + Math.abs(dy);
        var k = 0.008;
        state.yaw += dx * k;
        state.userPitch = clamp(state.userPitch - dy * k, -1.1, 1.1);
        state.spinVel = dx * k * 26;
      }
      e.preventDefault();
      kick();
    }
    function onPointerUp(e) {
      if (!state.interactive) return;
      delete pointers[e.pointerId];
      if (countPointers() < 2) pinchDist = 0;
      if (countPointers() === 0) {
        state.dragging = false;
        if (dragMoved < 6) {
          var t = now();
          if (t - lastTap < 320) { resetView(); lastTap = 0; }
          else lastTap = t;
          state.spinVel = 0;
        }
        state.pauseUntil = now() + ROT_PAUSE;
      }
      kick();
    }
    function onWheel(e) {
      if (!state.interactive) return;
      e.preventDefault();
      var f = Math.exp(-e.deltaY * 0.0016);
      state.zoom = clamp(state.zoom * f, 0.35, 5);
      kick();
    }
    function onDblClick(e) { if (state.interactive) { e.preventDefault(); resetView(); } }

    function resetView() {
      state.zoom = 1;
      state.userPitch = 0;
      state.yaw = state.model && state.model.mode === 'rows' ? 0 : -0.35;
      state.spinVel = 0;
      state.pauseUntil = 0;
      applyFit(computeFit(), false);
      kick();
    }

    function bindInteraction(on) {
      var add = on ? 'addEventListener' : 'removeEventListener';
      if (global.PointerEvent) {
        canvas[add]('pointerdown', onPointerDown, false);
        canvas[add]('pointermove', onPointerMove, false);
        canvas[add]('pointerup', onPointerUp, false);
        canvas[add]('pointercancel', onPointerUp, false);
      }
      canvas[add]('wheel', onWheel, { passive: false });
      canvas[add]('dblclick', onDblClick, false);
      canvas.style.touchAction = on ? 'none' : '';
      canvas.style.cursor = on ? 'grab' : '';
    }

    /* ------------------------------------------------------------ public */

    function setModel(model, o) {
      if (state.destroyed) return;
      var animate = (o && o.animate) || 'none';
      var prev = state.model;
      var next = normalizeModel(model, prev);
      state.model = next;
      rebuild(next);
      applyFit(computeFit(), !prev.rounds.length);

      if (!state.reducedMotion && animate === 'stitch') {
        var ci = clamp(next.current, 0, Math.max(0, next.rounds.length - 1));
        var r = next.rounds[ci];
        if (r && r.doneSlices > 0) {
          state.anim = { band: ci, slice: r.doneSlices - 1, t0: now() };
        }
      }
      if (animate === 'round') {
        var gi = clamp(next.current, 0, Math.max(0, next.rounds.length - 1));
        // the ring that was just finished is normally the current one
        var gr = next.rounds[gi];
        if (gr && gr.doneSlices < gr.n && gi > 0) gi = gi - 1;
        state.glowAnim = { band: gi, t0: now() };
      }
      if (animate !== 'none') state.pauseUntil = now() + ROT_PAUSE;
      kick();
    }

    function destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      if (state.rafId) global.cancelAnimationFrame(state.rafId);
      state.rafId = 0;
      if (state.resumeTimer) { global.clearTimeout(state.resumeTimer); state.resumeTimer = 0; }
      bindInteraction(false);
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
      global.removeEventListener('resize', onWinResize);
      if (ro) { try { ro.disconnect(); } catch (e) { /* ignore */ } }
      disposeChunks();
      var gl = state.gl;
      if (gl && state.prog) gl.deleteProgram(state.prog.program);
      if (gl) {
        // clear the canvas but do NOT force context loss: the app reuses the
        // same <canvas> when it re-enters the project screen, and a lost
        // context can never be recreated on that element.
        try {
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        } catch (e) { /* ignore */ }
      }
      state.gl = null; state.prog = null; state.fallback2d = null;
    }

    /* ------------------------------------------------------------- start */

    var ok = initGL();
    resize();
    if (state.interactive) bindInteraction(true);
    kick();

    var handle = {
      webgl: ok,
      setModel: setModel,
      setPalette: setPalette,
      resize: resize,
      destroy: destroy,
      setInteractive: function (on) {
        on = !!on;
        if (on === state.interactive) return;
        bindInteraction(false);
        state.interactive = on;
        if (on) bindInteraction(true);
        else { state.zoom = 1; state.userPitch = 0; state.spinVel = 0; applyFit(computeFit(), false); }
        kick();
      },
      setReducedMotion: function (on) {
        state.reducedMotion = !!on;
        if (state.reducedMotion) { state.anim = null; state.spinVel = 0; }
        kick();
      },
      resetView: resetView,
      getStats: function () {
        var s = state.stats;
        return {
          webgl: !!state.gl,
          fps: Math.round(s.fps * 10) / 10,
          frameMs: Math.round(s.frameMs * 100) / 100,
          buildMs: Math.round(s.buildMs * 100) / 100,
          rebuilt: s.rebuilt || 0,
          triangles: s.triangles,
          drawCalls: s.drawCalls,
          chunks: s.chunks,
          verts: s.verts,
          running: state.running
        };
      }
    };
    return handle;
  }

  global.Diagram = {
    mount: mount,
    version: '1.0.0',
    // exposed for tests / tuning
    _consts: { SW: SW, SH: SH, MAX_SLICES: MAX_SLICES }
  };

}(typeof window !== 'undefined' ? window : this));
