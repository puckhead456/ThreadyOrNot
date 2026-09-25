/* ==========================================================================
   Thready or Not — Live 3D diagram renderer
   --------------------------------------------------------------------------
   Renders a crochet piece in real time as a slowly rotating 3D solid.
   Raw WebGL 1 (no dependency): one vertex + one fragment shader, a wrapped
   warm key light, a cool bounce fill, a two-lobe yarn sheen, a Fresnel rim,
   a darkened wrong side and per-vertex colours with baked crevice AO plus
   per-stitch colour/amplitude noise. Canvas 2D silhouette fallback when WebGL
   is unavailable.

   Public API (see SPEC.md "Live 3D diagram" § 2 Renderer):
     Diagram.mount(canvas, { palette, reducedMotion, interactive }) -> handle
     handle.setModel(model, { animate: 'stitch'|'round'|'none' })
     handle.setPalette(palette)
     handle.setInteractive(bool)
     handle.setReducedMotion(bool)
     handle.resize()
     handle.resetView()
     handle.dragStart() / handle.dragMove(dx, dy) / handle.dragEnd()
         Host-driven rotation, in CSS pixels, for a canvas that cannot take
         its own pointer events (the one under the stitch button is
         `pointer-events: none`). Same code path as the viewer's own pointer
         handlers, so both agree on direction and inertia.
     handle.setSafeInsets({ top, right, bottom, left })   // CSS px
         Margins the piece must stay out of. The stitch button's number and
         pills own the middle of the canvas, and a round-worked solid is also a
         column down the middle, so the piece used to hide behind the caption
         (05 #1 / 02 #16). The fit box shrinks to what is left and the
         projection is shifted so the piece is centred in the free area.
     handle.isLive()     -> is there a working GL context on this canvas
     handle.getStats()   -> { fps, frameMs, submitMs, buildMs, triangles,
                              drawCalls, ghostAlpha, status, contexts,
                              yaw, pitch, zoom, ... }
         frameMs is the real rAF-to-rAF gap while animating; submitMs is the
         old `frameMs` — JS submit time only, which never waits on the GPU.
     handle.destroy({ release: true })
         `release` hands the GL context back to the browser. Pass it only when
         the <canvas> is being thrown away: a canvas whose context was lost can
         never be given another one. A page gets a handful of contexts, so the
         host closes the button's while the full-screen viewer is open.

   mount options: { palette: { ghost, ink, glow, alert, bg }, reducedMotion,
                    interactive, safeInsets, onStatus }
     onStatus({ webgl, status, message }) fires once per transition
     ('ok' | 'unavailable' | 'lost' | 'blank' | 'restored') so the host can put
     a one-line fallback message up instead of showing an empty rectangle.
     GHOST ALPHA IS THE RENDERER'S: pass an OPAQUE ghost colour. Any alpha on
     it is dropped, because the renderer multiplies by GHOST_ALPHA /
     PENDING_ALPHA and the two multiplications composed to 0.070 (02 #1).

   Rotation direction: the model follows the finger like a physical ball.
   Drag right -> the surface nearest the camera travels right (yaw += dx);
   drag down -> the near surface travels down, so more of the top comes into
   view (pitch += dy). Verified on screen, not on paper.

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
   - ghost rounds are drawn as bare rings (one line per stitch along the
     bottom of the band), not as a full grid: the grid read as a cage at
     button size. The current round's unworked slices keep the full grid and
     a much higher alpha, so "what I am working now" is the brightest wire.
   - a soft elliptical contact shadow sits under the piece so it is not
     floating in the middle of the button. It fades out as the camera comes
     level with the piece, and never reaches past the fitted radius.
   - the surface is tone-mapped (a Reinhard variant, white point 0.8) before a
     real sRGB encode, so a cream keeps its hue instead of clipping to white
     and a near-black keeps its detail (02 #3).
   - rounds are separated by a procedural crease and each stitch carries a V
     with a bar across its top, both in the FRAGMENT shader off a band-local uv
     (02 #3/#22). They fade out below ~2 device px per stitch, so the button
     never speckles. Nothing was added to the geometry.
   - the working round wears a highlight ring in `palette.glow` (05 #3), and
     stitches past the pattern's own count for that round render in
     `palette.alert` rather than confidently closing the ring (05 #6).
   ========================================================================== */

(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- tuning */

  var SW = 1.0;            // stitch width, world units
  /* Stitch HEIGHTS, ring radii, shape classes, caps and the fit clamps all
     live in js/diagram-geo.js now (window.DiagramGeo). The old SH = 1.5 was
     wrong by 57% (01 §1.2) and the asin(R/Rmax) slope heuristic that went
     with it is gone; see `geoLayout` below. */
  var BUMP = 0.20;         // outward bump at stitch centre, fraction of SW
  /* ...but never more than this fraction of the RING'S OWN radius (06 #6).
     BUMP alone is absolute, so the same 0.20 that reads as a stitch on a
     48-round (r 7.64, a 2.6% wave) was a 21% radial wave on a 6-stitch ring
     (r 0.95) and 31% on a 4-stitch one: the panda Tail came out as a stack of
     lampshades, the Ear as an 18-point cog, the turtle Feet as a star-lidded
     cake tin and the snowman Nose as a four-lobed paper bag. The per-stitch
     amplitude is now min(BUMP*SW, BUMP_R*R), so the wave can never exceed
     BUMP_R of the round it belongs to; the two meet at r = 3.33 (≈21 stitches),
     above which nothing changes and large rounds keep every bit of texture. */
  var BUMP_R = 0.06;
  var GROOVE = 0.03;       // inter-round crease, inward only (02 #2)
  var DIP = 0.17;          // vertical scallop ("v" shape) as a fraction of row height
  /* The scallop is a fraction of the STITCH height, which on a round the
     geometry compressed (a ruffle rises 0.12*h, a gathered close less) put the
     band's mid-row BELOW its own bottom ring — and wider than it, because the
     bump peaks on the same row. That is the "flared base overhanging the band
     below" of 06 #6: every round boundary grew a lip and the piece read as a
     stack of shells. Cap the scallop at this fraction of the band's own
     height so it can never reach past the shared ring. */
  var DIP_SPAN = 0.45;
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
  var GPS = SEGS;                  // ghost ring: just the band's bottom edge
  var GIDX = GPS * 2;              // 8 indices per slice
  // extruded (rows) slice: front grid + back grid + 2 side walls + 2 end walls
  var TPS_THICK = TPS * 2 + ROWS * 2 * 2 + SEGS * 2 * 2;   // 56 triangles
  var TIDX_THICK = TPS_THICK * 3;                          // 168 indices
  var THICK = 0.55;                // fabric thickness, fraction of SW
  var BACK_BUMP = 0.45;            // how much of the face texture the back keeps
  var FLOATS = 15;         // anchor3 + offset3 + normal3 + colour3 + slice1 + uv2

  var AO_EDGE = 0.17;      // darkening at slice edges
  var AO_BAND = 0.07;      // darkening at band edges
  var AO_DESAT = 0.22;     // desaturation mixed in at the crevices

  /* Procedural stitch / round texture (02 #3 + a light #22). The per-round
     BULGE is gone, so AO_BAND alone had to separate rounds and it did not: a
     tube read as one smooth sausage. These are FRAGMENT-shader amounts, keyed
     off the band-local uv the builder now emits, and they fade out with the
     projected stitch size so nothing aliases at button size. */
  var TEX_GROOVE = 0.30;   // inter-round crease darkening at the band edges
  var TEX_V = 0.20;        // the stitch's V legs + top bar
  var TEX_LIFT = 0.13;     // highlight just inside the crease, so it reads as relief
  var TEX_SEAM = 0.85;     // extra crease where the yarn colour changes
  var TEX_PX_OFF = 1.8;    // device px per stitch below which the texture is gone
  var TEX_PX_ON = 6.5;     // ... and above which it is at full strength

  /* Hand-made irregularity. Dyed yarn is never one flat colour and no two
     stitches are pulled to the same tension; a few percent of seeded noise per
     stitch is the difference between "extruded plastic" and "crocheted". */
  var JIT_LIGHT = 0.075;   // +/- lightness per stitch
  var JIT_HUE = 0.045;     // +/- warm/cool per stitch
  var JIT_AMP = 0.10;      // +/- bump amplitude per stitch

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
  var ROT_PAUSE = 1500;                 // ms after setModel or after a drag
  var PITCH_RETURN = 1.7;               // s for a user pitch to ease back home
  var PITCH_LIMIT = 1.1;                // rad of user pitch either way
  var FLICK_MAX = 3.5;                  // rad/s cap on throw inertia
  var FIT_EASE = 200;                   // ms
  var STITCH_ANIM = 140;                // ms
  var ROUND_ANIM = 620;                 // ms
  var FIT_MARGIN = 0.92;                // 8% margin
  var GHOST_FLOOR = 0.45;               // most the solid part is ever guaranteed
  var FLOOR_FROM = 0.15;                // no floor at all below this much progress
  var FLOOR_TO = 0.40;                  // full floor from this much progress up

  var GHOST_ALPHA = 0.20;    // future rounds: a calm ring each
  var PENDING_ALPHA = 0.72;  // the current round's unworked slices: full grid
  var MARKER_ALPHA = 0.60;   // the working round's highlight ring (05 #3)

  /* The surplus wedge (05 #6). The reviewer found it near-invisible: three
     stitches of twenty-four, on a black band, at 375 px. It was a 0.8 mix into
     the yarn's own colour and then went through the same lighting as the rest
     of the piece, so on a dark round its lit value stayed dark. Now the slice's
     colour is REPLACED by the alert tint and a flat, fully-lit lift of the same
     colour is blended over the shading, so the wedge keeps one predictable
     brightness whichever way it faces and whatever the yarn under it. */
  var ALERT_MIX = 1.0;       // alert tint replaces the surplus slice's yarn
  var ALERT_GLOW = 0.55;     // ... plus this much flat, unlit alert over the shading

  var SHADOW_SEGS = 30;
  var SHADOW_ALPHA = 0.38;   // centre of the contact shadow
  var SHADOW_GAP = 0.50;     // drop below the piece, fraction of SW
  var SHADOW_SPREAD = 1.35;  // disc radius vs the bottom ring radius
  var SHADOW_PITCH_IN = 0.07;  // rad of camera pitch where the shadow starts
  var SHADOW_PITCH_FULL = 0.34;

  var DEFAULT_PALETTE = {
    ghost: '#ffffff',
    ink: '#ffffff',
    glow: '#fff4c4',
    alert: '#d9603f',
    bg: null
  };
  var DEFAULT_YARN = '#f1e3c8';

  /* ------------------------------------------------------------- utilities */

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function r3(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v * 1000) / 1000 : v; }
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
    'attribute vec2 aUV;',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    'uniform mat3 uNormalMat;',
    'uniform float uAnimSlice;',
    'uniform float uAnimScale;',
    'varying vec3 vNormal;',
    'varying vec3 vColor;',
    'varying vec3 vView;',
    'varying vec2 vUV;',
    'void main() {',
    '  float s = abs(aSlice - uAnimSlice) < 0.5 ? uAnimScale : 1.0;',
    '  vec3 p = aAnchor + aOffset * s;',
    '  vec4 vp = uView * vec4(p, 1.0);',
    '  vView = vp.xyz;',
    '  vNormal = uNormalMat * aNormal;',
    '  vColor = aColor;',
    '  vUV = aUV;',
    '  gl_Position = uProj * vp;',
    '  gl_PointSize = 2.0;',
    '}'
  ].join('\n');

  function glsl(v) {
    var s = String(v);
    return s.indexOf('.') < 0 && s.indexOf('e') < 0 ? s + '.0' : s;
  }

  var FRAG_SRC = [
    'precision mediump float;',
    'varying vec3 vNormal;',
    'varying vec3 vColor;',
    'varying vec3 vView;',
    'varying vec2 vUV;',
    'uniform float uWire;',
    'uniform float uAlpha;',
    'uniform float uGlow;',
    'uniform float uShadow;',
    'uniform vec3 uFlat;',
    'uniform vec3 uGlowColor;',
    'uniform vec3 uRimColor;',
    /* Surplus stitches (05 #6 / 05-ux #12): the slices past the pattern's own
       count for this round are drawn in the alert tint instead of confidently
       closing the ring. uTintMix is 0 for every other draw. */
    'uniform vec3 uTint;',
    'uniform float uTintMix;',
    /* 0 when a stitch is too small on screen to texture (button size), 1 when
       it is big enough to read. Computed once per frame from the fit. */
    'uniform float uTex;',
    /* 1 on a round whose yarn colour differs from the round above it: the
       crease at its top edge is cut deeper so the change reads at button
       size instead of washing out (02 #7). */
    'uniform float uSeam;',
    'void main() {',
    // contact shadow: vColor.r carries the falloff weight, ink is plain black
    '  if (uShadow > 0.5) {',
    '    gl_FragColor = vec4(0.0, 0.0, 0.0, vColor.r * uAlpha);',
    '    return;',
    '  }',
    '  vec3 c;',
    '  if (uWire > 0.5) {',
    '    c = uFlat;',
    '  } else {',
    '    vec3 base = mix(vColor, uTint, uTintMix);',
    '    vec3 N = normalize(vNormal);',
    '    vec3 V = normalize(-vView);',
    '    float facing = dot(N, V);',
    // 1.0 where we are looking at the wrong side of the fabric: the inside of
    // an open tube. Real crochet is dark in there and it reads as depth.
    // A hard step here speckles the silhouette, where interpolated normals
    // cross zero; ramp it instead so only a properly turned-away surface goes
    // dark.
    '    float inside = 1.0 - smoothstep(-0.28, -0.02, facing);',
    '    N = facing < 0.0 ? -N : N;',
    '    vec3 K = normalize(vec3(-0.52, 0.74, 0.62));',  // key: upper-left, front
    '    vec3 F = normalize(vec3(0.30, -0.86, 0.22));',  // fill: from below
    '    float nk = dot(N, K);',
    '    float wrap = max((nk + 0.38) / 1.38, 0.0);',    // soft wrapped lambert
    '    float fill = max(dot(N, F), 0.0);',
    '    float nv = max(dot(N, V), 0.0);',
    '    float rim = pow(1.0 - nv, 3.0);',
    '    vec3 H = normalize(K + V);',
    '    float nh = max(dot(N, H), 0.0);',
    // Wool scatters, so the sheen is broad and carries the yarn colour; the
    // tight lobe is only a hint, otherwise the piece turns to plastic.
    '    float sheen = pow(nh, 7.0) * 0.13 + pow(nh, 44.0) * 0.022;',
    '    vec3 specTint = mix(vec3(1.0), base * 1.6, 0.5);',
    /* Fabric texture, in the fragment shader so it costs no geometry and
       filters itself out when a stitch is smaller than a couple of pixels.
       vUV.y = 0 at the top edge of the round, 1 at the bottom; vUV.x runs
       across one stitch. What real crochet has here is a CREASE between
       rounds and, inside each round, a V with a bar across its top. */
    '    float u = vUV.x, vv = vUV.y;',
    '    float crease = smoothstep(0.30, 0.0, vv) + smoothstep(0.70, 1.0, vv);',
    '    crease += smoothstep(0.42, 0.0, vv) * uSeam * ' + glsl(TEX_SEAM) + ';',
    '    float legs = abs(abs(u - 0.5) * 2.0 - vv);',
    '    float bar = smoothstep(0.17, 0.0, abs(vv - 0.86));',
    '    float vtex = smoothstep(0.26, 0.0, legs) * 0.62 + bar * 0.38;',
    '    float ridge = smoothstep(0.30, 0.52, vv) * (1.0 - smoothstep(0.52, 0.74, vv));',
    '    float shade = 1.0 - uTex * (' + glsl(TEX_GROOVE) + ' * min(crease, 1.4) +' +
    ' ' + glsl(TEX_V) + ' * vtex);',
    '    shade += uTex * ' + glsl(TEX_LIFT) + ' * ridge;',
    '    c = base * vec3(1.06, 0.99, 0.88) * (0.22 + 0.86 * wrap) * shade;',   // warm key
    '    c += base * vec3(0.44, 0.54, 0.76) * 0.30 * fill * shade;',           // cool bounce
    '    c += specTint * sheen * wrap * shade;',
    // a broad Fresnel in the yarn's OWN colour: the halo of stray fibres that
    // says "wool" rather than "plastic egg" (02 #18a). The white rim drops to
    // compensate, so a light yarn no longer reads as a shiny bead.
    '    c += base * pow(1.0 - nv, 1.6) * 0.20 * (1.0 - 0.6 * inside);',
    '    c += uRimColor * rim * 0.18 * (1.0 - 0.75 * inside);',
    '    c *= mix(1.0, 0.42, inside);',
    '    c = mix(c, uGlowColor, uGlow);',
    '  }',
    '  c = max(c, vec3(0.0));',
    /* Tone map BEFORE the encode (02 #3). Without it the default cream's key
       term alone reached 1.03 linear and clipped to a hue-less white, while a
       dark red crushed to black over half the piece. A Reinhard variant with a
       0.8 white point leaves mid-tones essentially where they were and rolls
       the top off, so light yarns keep their hue and dark ones keep detail. */
    '  c = c * (1.0 + c / 0.64) / (1.0 + c);',
    /* the real sRGB curve, not pow(1/2.2): the CPU-side decode uses the exact
       piecewise formula, so with the approximation a mid grey did not
       round-trip through the renderer. */
    '  vec3 hi = 1.055 * pow(c, vec3(0.41666667)) - 0.055;',
    '  c = mix(hi, c * 12.92, step(c, vec3(0.0031308)));',
    /* mediump (fp16) linear lighting + a gamma stretch of the darks bands
       badly on the three dark themes; one ordered-ish dither kills it. */
    '  c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;',
    '  c = clamp(c, 0.0, 1.0);',
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

  var imul = Math.imul || function (a, b) {
    return ((a >>> 16) * b << 16) + (a & 0xffff) * b | 0;
  };

  /* Deterministic per-stitch noise in [-1, 1]. Same seed + index always gives
     the same value, so the piece does not shimmer when a band is rebuilt. */
  function noise11(seed, i) {
    var h = (seed ^ imul(i + 1, 2654435761)) >>> 0;
    h = imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = imul(h ^ (h >>> 13), 3266489909) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 2147483648 - 1;
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
  function prepRound(round, defColor, prev, index) {
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
    /* A sampled mesh row (Store sets `truncated`) hands over more position
       records than it has countable stitches; spread the slices over the
       whole record list, not just its first `count` entries. */
    var recs = stitches && stitches.length > count ? stitches.length : count;
    var step = count > 0 ? recs / n : 1;
    var amp = new Float32Array(n);
    var wt = new Float32Array(n);
    var col = new Float32Array(n * 3);
    // one noise seed per round, so neighbouring rounds do not line up
    var seed = hashNum(hashStr(hashSeed, base), (index | 0) * 7 + 3);
    var h = hashSeed;
    h = hashNum(h, count);
    h = hashStr(h, base); h = hashNum(h, height);
    h = hashNum(h, ghost ? 1 : 0);
    h = hashNum(h, stitches ? stitches.length : 0);

    for (var i = 0; i < n; i++) {
      var si = count > 0 ? Math.min(recs - 1, Math.floor(i * step)) : 0;
      var st = null;
      if (stitches && stitches.length) {
        st = stitches[si < stitches.length ? si : stitches.length - 1];
      }
      var t = (st && st.t) || 'sc';
      var c = (st && st.c) || base;
      amp[i] = (STITCH_AMP[t] != null ? STITCH_AMP[t] : 1.0) *
        (1 + noise11(seed, i * 3) * JIT_AMP);
      /* Model v2 carries the stitch's real width; fall back to the type table
         (which also widens an `inc` slice a little for emphasis). */
      wt[i] = (st && typeof st.w === 'number' && isFinite(st.w) && st.w > 0)
        ? st.w
        : (STITCH_W[t] != null ? STITCH_W[t] : 1.0);
      var lin = linearOf(c, DEFAULT_YARN);
      // hand-dyed wobble: a little lightness, a little warm/cool
      var kl = 1 + noise11(seed, i * 3 + 1) * JIT_LIGHT;
      var kh = noise11(seed, i * 3 + 2) * JIT_HUE;
      col[i * 3] = Math.max(0, lin[0] * kl * (1 + kh));
      col[i * 3 + 1] = Math.max(0, lin[1] * kl);
      col[i * 3 + 2] = Math.max(0, lin[2] * kl * (1 - kh));
      h = hashStr(h, t); h = hashStr(h, c);
    }
    return {
      count: count, done: done, n: n,
      doneSlices: count > 0 ? Math.round(done / count * n) : 0,
      amp: amp, wt: wt, col: col,
      height: height, ghost: ghost,
      ref: stitches, base: base,
      hash: (h ^ seed) >>> 0
    };
  }

  function normalizeModel(model, prev) {
    var m = model || {};
    var mode = m.mode === 'rows' ? 'rows' : 'rounds';
    var src = m.rounds || [];
    var def = m.defaultColor || DEFAULT_YARN;
    var prevRounds = (prev && prev.mode === mode) ? prev.rounds : null;
    var rounds = [];
    var raw = [];      // the same rounds, unprepared, for DiagramGeo
    for (var i = 0; i < src.length; i++) {
      if (!src[i]) continue;
      rounds.push(prepRound(src[i], def, prevRounds ? prevRounds[rounds.length] : null, rounds.length));
      raw.push(src[i]);
    }
    var current = clamp(m.current == null ? rounds.length - 1 : m.current | 0, 0,
      Math.max(0, rounds.length - 1));
    /* `raw` is index-aligned with `rounds` (both skip falsy entries), so the
       geometry and the render attributes can never disagree about band i.
       The layout does not depend on `done`, and the tap path hands back the
       very same round objects with only `done` moved, so reuse it — a 60x60
       piece costs ~0.9 ms to classify and a tap must not pay that. */
    var shape = m.shape || null;
    var geo = (prev && sameGeoInput(prev, mode, raw, shape))
      ? prev.geo
      : geoLayout({
        mode: mode, rounds: raw, current: current, defaultColor: def,
        shape: shape, window: m.window || null, deviation: m.deviation || null
      });
    /* A round whose yarn differs from the round above it gets a hard seam in
       the shader (02 #7 / 05 #6): at button size a colour change used to wash
       out into a soft gradient, which is exactly the moment an amigurumi
       pattern most wants you to see. */
    for (i = 1; i < rounds.length; i++) {
      rounds[i].seam = rounds[i].base !== rounds[i - 1].base ? 1 : 0;
    }
    if (rounds.length) rounds[0].seam = 0;
    return {
      mode: mode, rounds: rounds, current: current, defaultColor: def,
      shape: shape, geo: geo, geoRaw: raw, geoShape: shape,
      geoCounts: countsOf(raw),
      finished: m.finished != null ? !!m.finished : finishedOf(rounds, current),
      deviation: m.deviation && typeof m.deviation === 'object' ? m.deviation : null
    };
  }

  /* Is every round of this model worked? (06 #5.) The host normally says so —
     `setModel(m, { finished: true })`, or `model.finished` — but the gallery and
     any other caller that just sets `current = rounds.length - 1` does not, and
     a finished piece must not wear the working-round glow: on the snowman Hat
     that painted the whole flared brim coral and on a 2-round bee wing it
     recoloured half the object. Derive it the same way DiagramGeo.isFinished
     does — a countable round that is not fully done, or any ghost round, means
     there is still work to do — and additionally require that `current` has
     reached the last countable round, so a host that rewinds the marker to an
     earlier round still sees its marker. */
  function finishedOf(rounds, current) {
    var any = false, lastCountable = -1;
    for (var i = 0; i < rounds.length; i++) {
      var r = rounds[i];
      if (!r || r.count <= 0) continue;    // count-less rounds do not hold it open
      if (r.ghost) return false;
      if (r.done < r.count) return false;
      any = true;
      lastCountable = i;
    }
    return any && current >= lastCountable;
  }

  function countsOf(raw) {
    var c = new Int32Array(raw.length);
    for (var i = 0; i < raw.length; i++) c[i] = raw[i].count | 0;
    return c;
  }

  /* Does this model describe the same GEOMETRY as the last one? `done` is
     deliberately not part of it: it is the only thing a tap moves, and it
     never changes the shape. Stitch arrays are compared by identity (Store
     hands the same array back), so this is O(rounds), never O(stitches) — a
     60 x 60 piece costs ~0.9 ms to classify and a tap must not pay that. */
  function sameGeoInput(prev, mode, raw, shape) {
    if (!prev.geo || prev.mode !== mode || !prev.geoRaw) return false;
    if (prev.geoShape !== shape) return false;
    if (prev.geoRaw.length !== raw.length) return false;
    var counts = prev.geoCounts;
    if (!counts || counts.length !== raw.length) return false;
    for (var i = 0; i < raw.length; i++) {
      var a = prev.geoRaw[i], b = raw[i];
      if (counts[i] !== (b.count | 0)) return false;
      if (a === b) continue;
      if (a.height !== b.height) return false;
      if (a.stitches !== b.stitches || a.inc !== b.inc || a.dec !== b.dec) return false;
    }
    return true;
  }

  /* ----------------------------------------------------------- band layout */

  /* All of it lives in js/diagram-geo.js: ring radius from the SUM of the
     per-stitch widths, the arc-length walk with an explicit stuffing slack
     (dy = h·sqrt(1 − ((1−s)|dr|/h)²), so "+6 lies flat" and "0 change is a
     cylinder" are exact), polygon / stadium / ripple cross-sections, the
     magic-ring test for the cap, and the rows anchor.

     DiagramGeo is a separate file, so index.html and sw.js have to load and
     precache it. Until they do, `fallbackGeo` keeps the app rendering with the
     same physics minus the shape classification — never with the old SH. */
  function geoOf() { return global.DiagramGeo || null; }

  function geoLayout(model) {
    var Geo = geoOf();
    if (Geo) {
      try { return Geo.layout(model); } catch (e) { /* fall through */ }
    }
    return fallbackGeo(model);
  }

  var FB_SH_SC = 0.95;
  var FB_SLACK = 0.2;
  function fallbackGeo(model) {
    var mode = model && model.mode === 'rows' ? 'rows' : 'rounds';
    var src = (model && model.rounds) || [];
    var bands = [], i, h, y = 0, w, maxW = 0;
    if (mode === 'rows') {
      for (i = 0; i < src.length; i++) maxW = Math.max(maxW, (src[i].count | 0) * SW);
      var Rc = Math.max(maxW * 3, 8);
      for (i = 0; i < src.length; i++) {
        h = (src[i].height > 0 ? src[i].height : 1) * FB_SH_SC;
        w = (src[i].count | 0) * SW;
        bands.push({ rTop: Rc, rBot: Rc, yTop: y + h, yBot: y, reach: h, Rc: Rc,
          x0: -w / 2, width: w, anchor: 'center', prof: null, sig: 0, radMax: maxW / 2 });
        y += h;
      }
      return { mode: mode, bands: bands, rounds: [], closedTop: false, closedBottom: false,
        height: y, width: maxW, maxRadius: maxW / 2, aspect: maxW > 0 ? y / maxW : 0,
        equatorFrac: 0, corners: 0, ruffles: 0, slack: 0 };
    }
    var r0 = src.length ? Math.max(R_MIN, (src[0].count | 0) * SW / TAU) : 0;
    var prevR = Math.min(0.30 * SW, r0 * 0.34), maxR = 0;
    for (i = 0; i < src.length; i++) {
      h = (src[i].height > 0 ? src[i].height : 1) * FB_SH_SC;
      var R = Math.max(R_MIN, (src[i].count | 0) * SW / TAU);
      var q = h > 0 ? Math.min(1, (1 - FB_SLACK) * Math.abs(R - prevR) / h) : 1;
      var dy = Math.max(0.02 * h, h * Math.sqrt(Math.max(0, 1 - q * q)));
      bands.push({ rTop: prevR, rBot: R, yTop: y, yBot: y - dy, reach: h,
        prof: null, sig: 0, radMax: Math.max(prevR, R), kind: 'ring', corners: 0, ruffle: false });
      prevR = R; y -= dy;
      if (R > maxR) maxR = R;
    }
    return { mode: mode, bands: bands, rounds: [], closedTop: true, closedBottom: false,
      height: -y, width: 2 * maxR, maxRadius: maxR, aspect: maxR > 0 ? -y / (2 * maxR) : 0,
      equatorFrac: 0, corners: 0, ruffles: 0, slack: FB_SLACK };
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
      /* The stitch bump must vanish at the top and bottom edge of its band.
         Consecutive rounds have different stitch counts (so different slice
         phases) and now different per-stitch amplitudes, and any bump left at
         the shared ring makes the two bands disagree about its radius — which
         shows up as hairline cracks of background between every round. With
         the taper the shared ring is exactly rBase + BLG for both, so the
         piece is watertight whatever the stitches do, and each round reads as
         its own row of V's with a groove between, like real fabric. */
      FT[t] = Math.sin(Math.PI * tt);
      DFT[t] = Math.PI * Math.cos(Math.PI * tt);
      /* The per-round BULGE is gone (02 #2). It put the band's mid-height at
         +0.084 SW and both its edges at −0.038 SW — a 0.12 SW radial swing at
         every round boundary, which is what made a horn read as a pinecone.
         What is left is a crease: zero through the middle of the band, dipping
         GROOVE inward at both edges. Both edges dip by the SAME amount, which
         is what keeps consecutive rounds watertight (see the note above), and
         the profile never swings outward at all. */
      BLG[t] = -GROOVE * SW * (1 - Math.sin(Math.PI * tt));
      DBLG[t] = GROOVE * SW * Math.PI * Math.cos(Math.PI * tt);
      DIPT[t] = Math.sin(Math.PI * tt);
      DDIPT[t] = Math.PI * Math.cos(Math.PI * tt);
    }
  }());

  /* Builds one band (one round / one row) into typed arrays.
     opts: n, a0[], aw[], amp[], col[], rBase[3], drdt, yBase[3], dydt, zOff,
           dipScale, anchorCol, thick, prof
     `prof(theta, t)` is an optional radius MULTIPLIER from DiagramGeo — the
     cross-section of a polygon motif, an oval/stadium or a ripple. Absent (the
     usual case) the ring is a circle and this costs nothing.
     `thick` > 0 extrudes the bump surface inward by that much and closes the
     four sides, so flat fabric has a real edge and never vanishes when it
     turns side-on. Rounds mode is a closed solid already and passes 0.
     `bumpAmp` is this band's per-stitch bump ceiling in world units; absent it
     falls back to the old absolute BUMP * SW. */
  function buildBand(o) {
    var n = o.n;
    var thick = o.thick || 0;
    var vps = thick ? VPS * 2 : VPS;
    var tidx = thick ? TIDX_THICK : TIDX;
    var verts = new Float32Array(n * vps * FLOATS);
    var tri = new Uint16Array(n * tidx);
    var lin = new Uint16Array(n * LIDX);
    var ring = new Uint16Array(n * GIDX);
    var a0 = o.a0, aw = o.aw, amp = o.amp, col = o.col;
    var rB = o.rBase, yB = o.yBase, drdt = o.drdt, dydt = o.dydt;
    var zOff = o.zOff, dipScale = o.dipScale;
    var anchorCol = o.anchorCol;
    var prof = o.prof || null;
    var PROF_EPS = 1e-3;
    var cosA = new Float64Array(COLS), sinA = new Float64Array(COLS);
    var px = new Float64Array(VPS), py = new Float64Array(VPS), pz = new Float64Array(VPS);
    var nx = new Float64Array(VPS), ny = new Float64Array(VPS), nz = new Float64Array(VPS);
    var bx = thick ? new Float64Array(VPS) : null;
    var bz = thick ? new Float64Array(VPS) : null;
    var j, k, t, vi, p, idx;

    var angA = new Float64Array(COLS);
    var blend = !!(prof && prof.blend);
    /* Per-stitch bump amplitude (06 #6). `bumpAmp` is the band's own ceiling —
       min(BUMP*SW, BUMP_R * its ring radius) — and the per-stitch weight in
       `amp[]` still scales it, so a bobble is still bigger than a slip stitch
       and a tiny round is still a circle. It is 0 at BOTH band edges (FT), so
       consecutive bands meet exactly at rBase + BLG whatever their stitch
       counts, phases and amplitudes: no lip and no crack. */
    var bumpAmp = o.bumpAmp != null ? o.bumpAmp : BUMP * SW;
    for (j = 0; j < n; j++) {
      var A = amp[j] * bumpAmp;
      var aStart = a0[j], aWidth = aw[j];
      for (k = 0; k < COLS; k++) {
        var ang0 = aStart + aWidth * (k / SEGS);
        angA[k] = ang0;
        cosA[k] = Math.cos(ang0); sinA[k] = Math.sin(ang0);
      }
      for (t = 0; t < VROWS; t++) {
        var ft = FT[t], dft = DFT[t];
        var ttv = t / ROWS;
        var rowR = rB[t] + BLG[t];
        var rowY = yB[t];
        var dr_dt_row = drdt + DBLG[t];
        var dipT = DIPT[t], ddipT = DDIPT[t];
        for (k = 0; k < COLS; k++) {
          vi = t * COLS + k;
          var ca = cosA[k], sa = sinA[k];
          /* non-circular cross-section: scale the base radius, and carry the
             profile's slope into both tangents or the normals go wrong at a
             polygon corner */
          var pm = 1, dpm_dth = 0, dpm_dt = 0;
          if (prof) {
            var ang = angA[k];
            pm = prof(ang, ttv);
            dpm_dth = (prof(ang + PROF_EPS, ttv) - prof(ang - PROF_EPS, ttv)) / (2 * PROF_EPS);
            if (blend) {
              var t1 = ttv < 1 ? ttv + 0.05 : 1, t0 = ttv > 0 ? ttv - 0.05 : 0;
              dpm_dt = t1 > t0 ? (prof(ang, t1) - prof(ang, t0)) / (t1 - t0) : 0;
            }
          }
          var rowRp = prof ? rB[t] * pm + BLG[t] : rowR;
          var r = rowRp + A * CU[k] * ft;
          var y = rowY + dipScale * DIPU[k] * dipT;
          px[vi] = r * ca;
          py[vi] = y;
          pz[vi] = r * sa + zOff;
          // tangents
          var dr_du = A * DCU[k] * ft + (prof ? rB[t] * dpm_dth * aWidth : 0);
          var dy_du = dipScale * DDIPU[k] * dipT;
          var tux = dr_du * ca - r * aWidth * sa;
          var tuy = dy_du;
          var tuz = dr_du * sa + r * aWidth * ca;
          var dr_dt = (prof ? drdt * pm + rB[t] * dpm_dt + DBLG[t] : dr_dt_row) + A * CU[k] * dft;
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
            var rb = rowRp - thick + A * CU[k] * ft * BACK_BUMP;
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
        var uvV = t / ROWS;
        for (k = 0; k < COLS; k++) {
          vi = t * COLS + k;
          var uvU = k / SEGS;
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
          verts[p + 13] = uvU; verts[p + 14] = uvV;
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
            // the wrong side keeps the crease but not the V: you are looking at
            // the back of the stitch, where the bar does not show
            verts[p + 13] = 0.5; verts[p + 14] = uvV;
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
      // ghost pass: only the bottom edge of the band, so a stack of future
      // rounds reads as a stack of rings instead of a wire cage
      idx = j * GIDX;
      for (k = 0; k < SEGS; k++) {
        ring[idx++] = base + ROWS * COLS + k; ring[idx++] = base + ROWS * COLS + k + 1;
      }
    }
    return { verts: verts, tri: tri, lin: lin, ring: ring, n: n, tps: tidx, lps: LIDX, gps: GIDX };
  }

  /* Small domed cap: the magic ring at the top of a round-worked piece
     (`dir` = 1), or the gathered close at the bottom (`dir` = −1). */
  function buildCap(radius, y, color, dir) {
    var n = 18;
    var d = dir < 0 ? -1 : 1;
    var verts = new Float32Array((n + 1) * FLOATS);
    var tri = new Uint16Array(n * 3);
    var lin = new Uint16Array(n * 2);
    var dome = radius * 0.55 * d;
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
      // mid-stitch, mid-band: no crease and no V on a gathered cap
      verts[p + 13] = 0.5; verts[p + 14] = 0.5;
    }
    put(0, 0, y + dome, 0, 0, d, 0, 1);
    for (var i = 0; i < n; i++) {
      var a = i / n * TAU;
      var ca = Math.cos(a), sa = Math.sin(a);
      put(i + 1, radius * ca, y, radius * sa, ca * 0.55, 0.83 * d, sa * 0.55, 0.86);
      tri[i * 3] = 0; tri[i * 3 + 1] = 1 + i; tri[i * 3 + 2] = 1 + ((i + 1) % n);
      lin[i * 2] = 1 + i; lin[i * 2 + 1] = 1 + ((i + 1) % n);
    }
    return {
      verts: verts, tri: tri, lin: lin, ring: lin, n: 1, isCap: true,
      triCount: n * 3, linCount: n * 2, ringCount: n * 2,
      tps: n * 3, lps: n * 2, gps: n * 2
    };
  }

  /* Soft elliptical contact shadow: a fan whose centre carries full weight and
     whose rim carries none. The shader reads that weight out of the colour
     attribute, so it needs no extra vertex format. */
  function buildShadow(radius, y) {
    var n = SHADOW_SEGS;
    var verts = new Float32Array((n + 1) * FLOATS);
    var tri = new Uint16Array(n * 3);
    function put(i, x, z, w) {
      var p = i * FLOATS;
      verts[p] = x; verts[p + 1] = y; verts[p + 2] = z;
      verts[p + 3] = 0; verts[p + 4] = 0; verts[p + 5] = 0;
      verts[p + 6] = 0; verts[p + 7] = 1; verts[p + 8] = 0;
      verts[p + 9] = w; verts[p + 10] = w; verts[p + 11] = w;
      verts[p + 12] = -9;
      verts[p + 13] = 0.5; verts[p + 14] = 0.5;
    }
    put(0, 0, 0, 1);
    for (var i = 0; i < n; i++) {
      var a = i / n * TAU;
      put(i + 1, radius * Math.cos(a), radius * Math.sin(a), 0);
      tri[i * 3] = 0; tri[i * 3 + 1] = 1 + i; tri[i * 3 + 2] = 1 + ((i + 1) % n);
    }
    return {
      verts: verts, tri: tri, lin: tri, ring: tri, n: 1, isShadow: true,
      triCount: n * 3, linCount: 0, ringCount: 0,
      tps: n * 3, lps: 0, gps: 0
    };
  }

  /* This band's per-stitch bump ceiling (06 #6): the smaller of the absolute
     BUMP and BUMP_R of the round's own ring radius. `rBot` IS that round's
     radius (the band spans from the round above's ring down to its own), so a
     6-stitch round gets 0.06 * 0.95 = 0.057 where it used to get 0.20, and a
     48-stitch round keeps the full 0.20. Rows-mode bands carry the cylinder
     radius, which is far past the crossover, so a sheet is untouched. */
  function bumpAmpOf(band) {
    if (!band) return BUMP * SW;
    var r = band.rBot > 0 ? band.rBot : Math.max(band.rTop, 0);
    return Math.min(BUMP * SW, BUMP_R * Math.max(R_MIN, r));
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
      /* A stitch is a fixed amount of fabric, so on a non-circular ring its
         angular width has to follow ARC LENGTH — otherwise a granny square's
         corner stitches stretch and its side stitches bunch. */
      var Geo = geoOf();
      if (band.prof && Geo && Geo.arcSlices) {
        Geo.arcSlices(band.prof, round.wt, n, a0, aw);
      } else {
        var acc = 0;
        for (j = 0; j < n; j++) {
          var w = round.wt[j] / total * TAU;
          a0[j] = acc; aw[j] = w; acc += w;
        }
      }
      /* The scallop may not reach past the band's own edges (06 #6): on a
         round the geometry compressed the mid-row would otherwise sit below
         the bottom ring AND wider than it, which is the overhanging lip. */
      var dyAbs = Math.abs(band.yBot - band.yTop);
      var dipReach = Math.min(band.reach, DIP_SPAN * dyAbs / DIP);
      return buildBand({
        n: n, a0: a0, aw: aw, amp: round.amp, col: round.col,
        rBase: [band.rTop, (band.rTop + band.rBot) / 2, band.rBot],
        drdt: band.rBot - band.rTop,
        yBase: [band.yTop, (band.yTop + band.yBot) / 2, band.yBot],
        dydt: band.yBot - band.yTop,
        zOff: 0,
        dipScale: dipReach * (band.yBot < band.yTop ? 1 : -1),
        anchorCol: 0,
        prof: band.prof || null,
        bumpAmp: bumpAmpOf(band)
      });
    }
    /* rows: a cylinder segment about a vertical axis behind the sheet, so
       world = ( r*sin(a), y, r*cos(a) - Rc ). The shared builder emits
       ( r*cos(A), y, r*sin(A) + zOff ), so A = PI/2 - a and zOff = -Rc.
       Slice 0 starts at the left on even rows and at the right on odd rows,
       which is the direction that row is worked — the in-progress row then
       fills from alternating ends with nothing but a draw-range change. */
    /* The row's extent comes from DiagramGeo: width = SUM of the stitch
       widths, and x0 from the part's anchor, so a shawl that increases at one
       edge only gets one straight edge instead of a symmetric wedge. */
    var Rc = band.Rc;
    var totalW = band.width > 0 ? band.width : n * SW;
    var left = band.x0 != null ? band.x0 : -totalW / 2;
    var rtl = (index & 1) === 1;
    var shift = rtl ? 0.25 * SW : -0.25 * SW;
    var x = (rtl ? left + totalW : left) + shift;
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

  /* ---- live GL contexts, module-wide (05 #7) ----
     A page gets a small number of WebGL contexts (8–16 in Chrome) and past
     that the browser silently drops the OLDEST one. That is exactly how the ⤢
     viewer came up blank after a handful of opens: every open mounted a second
     context beside the stitch button's, viewer canvases were detached without
     their context ever being released, and a canvas whose context has been
     taken away can never be given another one. So every mount registers here;
     a new mount first reaps the records whose canvas has left the document, and
     past MAX_LIVE the oldest is released explicitly — with the host told about
     it through `onStatus` — instead of dying at random. */
  var LIVE = [];
  var MAX_LIVE = 3;

  function attached(c) {
    if (!c) return false;
    if (typeof c.isConnected === 'boolean') return c.isConnected;
    var doc = c.ownerDocument;
    return !!(doc && doc.body && doc.body.contains(c));
  }

  function reapContexts(keep) {
    var i, rec;
    for (i = LIVE.length - 1; i >= 0; i--) {
      rec = LIVE[i];
      if (rec === keep) continue;
      if (rec.dead || !attached(rec.canvas)) {
        LIVE.splice(i, 1);
        try { rec.release('detached'); } catch (e) { /* ignore */ }
      }
    }
    while (LIVE.length > MAX_LIVE) {
      rec = LIVE.shift();
      if (rec === keep) { LIVE.push(rec); break; }
      try { rec.release('evicted'); } catch (e) { /* ignore */ }
    }
  }

  function unregisterLive(rec) {
    var i = LIVE.indexOf(rec);
    if (i >= 0) LIVE.splice(i, 1);
  }

  var STATUS_MSG = {
    ok: '',
    unavailable: "Showing a simple outline — 3D isn't available on this device.",
    lost: "Showing a simple outline — 3D stopped and had to be released.",
    blank: "Showing a simple outline — 3D isn't available right now.",
    restored: ''
  };

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
    gl.bindAttribLocation(p, 5, 'aUV');
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
        shadow: gl.getUniformLocation(p, 'uShadow'),
        flat: gl.getUniformLocation(p, 'uFlat'),
        glowColor: gl.getUniformLocation(p, 'uGlowColor'),
        rimColor: gl.getUniformLocation(p, 'uRimColor'),
        tint: gl.getUniformLocation(p, 'uTint'),
        tintMix: gl.getUniformLocation(p, 'uTintMix'),
        tex: gl.getUniformLocation(p, 'uTex'),
        seam: gl.getUniformLocation(p, 'uSeam')
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
      /* Which frame this canvas is: 'button' (the bounded clamp inside the
         stitch button), 'viewer' (the ⤢ sheet) or 'gallery' (a review card).
         `DiagramGeo.fit` owns what each one means; the renderer only says
         which one it is, and whether the piece is finished — a finished piece
         is letterboxed honestly instead of being over-scaled to fill the
         height with the worked row centred (07 finding 2). 'button' is the
         default, as it is in `DiagramGeo.fit`, so a host that says nothing
         keeps the counting behaviour it has always had. */
      fitPurpose: opts.fitPurpose === 'viewer' || opts.fitPurpose === 'gallery' ? opts.fitPurpose : 'button',
      fitFinished: !!opts.finished,
      chunks: [],          // per band GPU chunk
      capChunk: null,
      botChunk: null,      // the gathered close at the bottom, when there is one
      botHash: 0,
      botBand: -1,
      shadowChunk: null,
      shadowHash: 0,
      shadowFade: 0,
      hashes: [],
      bands: [],
      geo: null,
      fitClamp: '',
      destroyed: false,
      gl: null,
      prog: null,
      fallback2d: null,
      dpr: 1,
      w: 0, h: 0,
      /* CSS-pixel margins the piece must keep clear: the stitch button's
         number and pills live there (02 #16 / 05 #1). The fit box shrinks to
         what is left and the projection shifts so the piece is centred in it,
         rather than behind the caption. */
      insets: {
        top: Math.max(0, (opts.safeInsets && opts.safeInsets.top) || 0),
        right: Math.max(0, (opts.safeInsets && opts.safeInsets.right) || 0),
        bottom: Math.max(0, (opts.safeInsets && opts.safeInsets.bottom) || 0),
        left: Math.max(0, (opts.safeInsets && opts.safeInsets.left) || 0)
      },
      lost: false,          // the GL context went away and has not come back
      /* 'init' until the first frame proves one way or the other, so a host
         that put a fallback message up is always told when the piece is
         actually on screen again. */
      status: 'init',
      onStatus: typeof opts.onStatus === 'function' ? opts.onStatus : null,
      tex: 1,               // stitch-texture strength for this frame (LOD)
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
      stats: { fps: 0, frameMs: 0, submitMs: 0, buildMs: 0, triangles: 0,
        drawCalls: 0, chunks: 0, verts: 0 },
      frameAcc: 0, frameN: 0, fpsT0: 0, fpsFrames: 0,
      // real frame time: the rAF delta while something is actually animating
      deltaAcc: 0, deltaN: 0, lastDrawT: 0
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
      pal.alert = src.alert || DEFAULT_PALETTE.alert;
      pal.bg = src.bg || DEFAULT_PALETTE.bg;
      state.palette = pal;
      state.ghostLin = linearOf(pal.ghost, '#ffffff');
      /* THE RENDERER OWNS GHOST ALPHA (02 #1). The host used to pass
         rgba(--text, 0.35) and pass 2 multiplied it by GHOST_ALPHA again, so
         future rounds composed to 0.070 and were invisible in the app while
         the test page — which passes an opaque white — looked right. Any alpha
         on the supplied colour is dropped here; GHOST_ALPHA / PENDING_ALPHA are
         the only multiplication. */
      state.ghostLin = [state.ghostLin[0], state.ghostLin[1], state.ghostLin[2], 1];
      state.glowLin = linearOf(pal.glow, '#fff4c4');
      state.alertLin = linearOf(pal.alert, DEFAULT_PALETTE.alert);
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
        freeChunk(state.botChunk);
        freeChunk(state.shadowChunk);
      }
      state.chunks = [];
      state.capChunk = null;
      state.botChunk = null;
      state.botHash = 0;
      state.botBand = -1;
      state.shadowChunk = null;
      state.shadowHash = 0;
      state.hashes = [];
    }

    function freeChunk(c) {
      if (!c || !state.gl) return;
      var gl = state.gl;
      if (c.vbo) gl.deleteBuffer(c.vbo);
      if (c.tbo) gl.deleteBuffer(c.tbo);
      if (c.lbo) gl.deleteBuffer(c.lbo);
      if (c.rbo) gl.deleteBuffer(c.rbo);
    }

    function uploadChunk(geo, prev) {
      var gl = state.gl;
      var c = prev || {};
      if (!c.vbo) {
        c.vbo = gl.createBuffer(); c.tbo = gl.createBuffer();
        c.lbo = gl.createBuffer(); c.rbo = gl.createBuffer();
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, c.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, geo.verts, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.tbo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.tri, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.lbo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.lin, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.rbo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.ring || geo.lin, gl.STATIC_DRAW);
      c.n = geo.n;
      c.isCap = !!geo.isCap;
      c.tps = geo.tps != null ? geo.tps : TIDX;     // triangle indices per slice
      c.lps = geo.lps != null ? geo.lps : LIDX;     // line indices per slice
      c.gps = geo.gps != null ? geo.gps : GIDX;     // ghost-ring indices per slice
      c.triCount = geo.triCount != null ? geo.triCount : geo.n * c.tps;
      c.linCount = geo.linCount != null ? geo.linCount : geo.n * c.lps;
      c.ringCount = geo.ringCount != null ? geo.ringCount : geo.n * c.gps;
      c.verts = geo.verts.length / FLOATS;
      return c;
    }

    /* ---------------------------------------------------------- geometry */

    function rebuild(model) {
      var t0 = now();
      var mode = model.mode;
      var rounds = model.rounds;
      var geo = model.geo || geoLayout({ mode: mode, rounds: [] });
      var bands = geo.bands || [];
      state.bands = bands;
      state.geo = geo;
      /* what the per-band bump ceiling actually came out as, so getStats can
         report the numbers 06 #6 is about instead of the constant */
      var bLo = Infinity, bHi = -Infinity;
      for (var bi = 0; bi < bands.length; bi++) {
        if (!bands[bi] || !rounds[bi] || rounds[bi].count <= 0) continue;
        var ba = mode === 'rounds' ? bumpAmpOf(bands[bi]) : BUMP * SW;
        if (ba < bLo) bLo = ba;
        if (ba > bHi) bHi = ba;
      }
      state.bumpLo = bLo === Infinity ? 0 : bLo;
      state.bumpHi = bHi === -Infinity ? 0 : bHi;

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
        if (!b) { freeChunk(state.chunks[i]); state.chunks[i] = null; state.hashes[i] = 0; continue; }
        var h = r.hash;
        h = hashNum(h, b.rTop * 97); h = hashNum(h, b.rBot * 97);
        h = hashNum(h, b.yTop * 97); h = hashNum(h, b.yBot * 97);
        h = hashNum(h, mode === 'rows' ? 2 : 1);
        h = hashNum(h, i & 1);
        // the cross-section class, so a ring that becomes a polygon rebuilds
        h = hashNum(h, b.sig || 0);
        h = hashNum(h, (b.x0 || 0) * 97);
        if (state.hashes[i] === h && state.chunks[i]) continue;
        /* NOT `geo`: `var` is function-scoped, so the old name overwrote the
           layout `geo` above with this band's mesh — and a last round that
           builds nothing (the count-less working round the model appends past
           the end of a finished piece) left it null, so `geo.closedTop` below
           threw and setModel died before it ever applied the fit. The viewer
           then drew every finished amigurumi at scale 1, spilling off frame. */
        var bandGeo = buildRoundBand(mode, r, b, i);
        if (!bandGeo) { freeChunk(state.chunks[i]); state.chunks[i] = null; state.hashes[i] = h; continue; }
        state.chunks[i] = uploadChunk(bandGeo, state.chunks[i]);
        state.hashes[i] = h;
        built++;
      }

      /* The cap. 04 defect D: the old condition was `rounds[0].count > 0` —
         the comment said "magic ring", the code said "has any stitches", so
         every sock, cuff, sleeve and muzzle grew a spike. DiagramGeo decides
         now, from Model.shape.start. A piece that decreases to a handful of
         stitches and stops is gathered shut at the bottom as well. */
      if (mode === 'rounds' && rounds.length && geo.closedTop && bands[0] && rounds[0].count > 0) {
        var c0 = rounds[0];
        var capCol = [c0.col[0], c0.col[1], c0.col[2]];
        var capHash = hashNum(hashNum(c0.hash, bands[0].rTop * 997), capCol[0] * 255);
        if (state.capHash !== capHash || !state.capChunk) {
          state.capChunk = uploadChunk(buildCap(bands[0].rTop, bands[0].yTop, capCol, 1), state.capChunk);
          state.capHash = capHash;
          built++;
        }
      } else if (state.capChunk) {
        freeChunk(state.capChunk); state.capChunk = null; state.capHash = 0;
      }

      var lastSolid = -1;
      for (i = rounds.length - 1; i >= 0; i--) {
        if (rounds[i].count > 0) { lastSolid = i; break; }
      }
      if (mode === 'rounds' && geo.closedBottom && lastSolid >= 0 && bands[lastSolid]) {
        var cN = rounds[lastSolid];
        var bN = bands[lastSolid];
        var botCol = [cN.col[0], cN.col[1], cN.col[2]];
        var botHash = hashNum(hashNum(cN.hash, bN.rBot * 991), lastSolid * 7 + 1);
        if (state.botHash !== botHash || !state.botChunk) {
          state.botChunk = uploadChunk(buildCap(bN.rBot, bN.yBot, botCol, -1), state.botChunk);
          state.botHash = botHash;
          built++;
        }
        state.botBand = lastSolid;
      } else if (state.botChunk) {
        freeChunk(state.botChunk); state.botChunk = null; state.botHash = 0; state.botBand = -1;
      }

      /* contact shadow: a disc just under the lowest band, no wider than the
         fitted radius so it can never be clipped by the canvas edge */
      /* Contact shadow. The plane it lies on is the bottom of the piece as
         planned — the ghost cage reaches down to it — and its radius is the
         widest fabric that actually exists. A piece two rounds in is nowhere
         near that plane, so the shadow fades in as the work grows down to it
         rather than hanging under a speck. */
      var aY0 = Infinity, aY1 = -Infinity, aR = 0;
      var sY0 = Infinity, sR = 0, sAny = false;
      for (i = 0; i < rounds.length; i++) {
        if (!bandExtent(i, _ext)) continue;
        if (_ext.rad > aR) aR = _ext.rad;
        if (_ext.ymin < aY0) aY0 = _ext.ymin;
        if (_ext.ymax > aY1) aY1 = _ext.ymax;
        if (!rounds[i].ghost && rounds[i].doneSlices > 0) {
          sAny = true;
          if (_ext.rad > sR) sR = _ext.rad;
          if (_ext.ymin < sY0) sY0 = _ext.ymin;
        }
      }
      if (sAny && aR > 0 && aY1 > aY0) {
        var grown = (aY1 - sY0) / (aY1 - aY0);
        state.shadowFade = smoothstep(0.45, 0.92, grown);
        var shR = clamp(sR * SHADOW_SPREAD, aR * 0.35, aR);
        var shY = aY0 - SHADOW_GAP * SW;
        var sh = hashNum(hashNum(2166136261, shR * 97), shY * 97);
        if (state.shadowHash !== sh || !state.shadowChunk) {
          state.shadowChunk = uploadChunk(buildShadow(shR, shY), state.shadowChunk);
          state.shadowHash = sh;
          built++;
        }
      } else {
        state.shadowFade = 0;
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
      if (state.model.mode === 'rows') {
        var w = b.width > 0 ? b.width : r.n * SW;
        var x0 = b.x0 != null ? b.x0 : -w / 2;
        out.rad = Math.max(Math.abs(x0), Math.abs(x0 + w)) + THICK * SW;
      } else {
        // the same per-band bump the builder used, so the fit neither clips the
        // fabric nor reserves 0.20 of margin a tiny round no longer needs
        out.rad = (b.radMax > 0 ? b.radMax : Math.max(b.rTop, b.rBot)) + bumpAmpOf(b);
      }
      out.ymin = Math.min(b.yTop, b.yBot);
      out.ymax = Math.max(b.yTop, b.yBot);
      // the caps are geometry too, and the fit must not clip them
      if (i === 0 && state.capChunk) out.ymax += Math.abs(b.rTop) * 0.55;
      if (i === state.botBand && state.botChunk) out.ymin -= Math.abs(b.rBot) * 0.55;
      return out;
    }

    var _ext = { rad: 0, ymin: 0, ymax: 0 };
    var _half = { w: 1, h: 1, cp: 1, sp: 0, scale: 1, cy: 0 };
    var _box = { fw: 1, fh: 1, ndcX: 0, ndcY: 0 };

    /* The fraction of the canvas the piece may use, and where the centre of
       that free area sits in NDC. Everything else about the camera is
       unchanged, so a host that passes no insets renders exactly as before. */
    function insetBox() {
      var cssW = state.dpr > 0 ? state.w / state.dpr : state.w;
      var cssH = state.dpr > 0 ? state.h / state.dpr : state.h;
      _box.fw = 1; _box.fh = 1; _box.ndcX = 0; _box.ndcY = 0;
      if (!(cssW > 0) || !(cssH > 0)) return _box;
      var ins = state.insets;
      // never let the insets squeeze the piece below a third of the canvas
      var l = clamp(ins.left || 0, 0, cssW * 0.5);
      var r = clamp(ins.right || 0, 0, cssW * 0.5);
      var tp = clamp(ins.top || 0, 0, cssH * 0.5);
      var b = clamp(ins.bottom || 0, 0, cssH * 0.5);
      if (l + r > cssW * 0.66) { var kx = cssW * 0.66 / (l + r); l *= kx; r *= kx; }
      if (tp + b > cssH * 0.66) { var ky = cssH * 0.66 / (tp + b); tp *= ky; b *= ky; }
      _box.fw = (cssW - l - r) / cssW;
      _box.fh = (cssH - tp - b) / cssH;
      _box.ndcX = (l - r) / cssW;
      _box.ndcY = (b - tp) / cssH;
      return _box;
    }

    function setSafeInsets(ins) {
      var s = ins || {};
      var cur = state.insets;
      var t = Math.max(0, s.top || 0), r = Math.max(0, s.right || 0);
      var b = Math.max(0, s.bottom || 0), l = Math.max(0, s.left || 0);
      if (cur.top === t && cur.right === r && cur.bottom === b && cur.left === l) return;
      state.insets = { top: t, right: r, bottom: b, left: l };
      applyFit(computeFit(), false);
      kick();
    }

    /* Refreshed once per frame; frameFade then costs a handful of multiplies. */
    function updateFrameMetrics() {
      var box = insetBox();
      _half.h = CAM_DIST * Math.tan(FOV / 2) * box.fh;
      _half.w = CAM_DIST * Math.tan(FOV / 2) * (state.h > 0 ? state.w / state.h : 1) * box.fw;
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
      var box = insetBox();
      var halfH = CAM_DIST * Math.tan(FOV / 2) * FIT_MARGIN * box.fh;
      var halfW = CAM_DIST * Math.tan(FOV / 2) * FIT_MARGIN * aspect * box.fw;
      var cp = Math.cos(state.pitch), sp = Math.abs(Math.sin(state.pitch));

      /* y of the round being worked, so a clamped wide sheet stays centred on
         the row the user is actually counting.
         There is no row being counted on a FINISHED piece — the model's
         `current` is then the working round the builder appends past the end,
         which sits above the fabric and dragged the whole sheet down the frame
         (07 finding 2 / #7) — and in the button the sheet is centred in the
         free area rather than following the count at all. In both cases the
         geometry is asked for a fit with no current row. */
      var curY = null;
      var cb = state.bands[clamp(state.model.current, 0, Math.max(0, state.bands.length - 1))];
      if (cb) curY = (cb.yTop + cb.yBot) / 2;
      if (state.fitFinished || state.fitPurpose === 'button') curY = null;

      /* DiagramGeo.fit owns the two clamps: (a) a 42-round tail fits by height
         but must keep a visible silhouette, (b) a 405-stitch row must not be
         fitted to a hairline — it overflows sideways with the worked row
         centred. The renderer's job is to consume the answer honestly,
         including `clamp` and `cy`, instead of re-deriving either. */
      function geoFit(rad, ymin, ymax) {
        var Geo = geoOf();
        var spec = { rad: rad, ymin: ymin, ymax: ymax, halfW: halfW, halfH: halfH,
          cp: cp, sp: sp, curY: curY, mode: state.model.mode,
          purpose: state.fitPurpose, finished: !!state.fitFinished };
        var f = null;
        if (Geo && Geo.fit) {
          try { f = Geo.fit(spec); } catch (e) { f = null; }
        }
        if (!f || !(f.scale > 0)) {
          var hy = (ymax - ymin) / 2;
          f = { scale: Math.min(halfW / Math.max(rad, 1e-4),
            halfH / Math.max(hy * cp + rad * sp, 1e-4)), base: 0, clamp: '',
            cy: (ymin + ymax) / 2 };
        }
        return f;
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

      var allFit = geoFit(aR, aYmin, aYmax);
      var solidFit = geoFit(sR, sYmin, sYmax);
      var floorScale = solidFit.scale * floor;
      var scale = Math.max(allFit.scale, floorScale);
      var k = allFit.scale > 0 ? clamp((scale / allFit.scale - 1) * 2, 0, 1) : 0;
      var cy = lerp(allFit.cy, (sYmin + sYmax) / 2, k);
      /* A sheet the geometry clamped by height overflows sideways on purpose,
         and the one thing that must stay on screen is the row being counted —
         so the ghost floor is not allowed to drag the centre off it. `curY` is
         already null when there is no row to follow (finished, or the button). */
      if (allFit.clamp === 'height' && curY != null) cy = curY;
      state.fitClamp = floorScale > allFit.scale
        ? (allFit.clamp ? allFit.clamp + '+solid' : 'solid')
        : (allFit.clamp || '');
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
      { loc: 4, size: 1, off: 48 },
      { loc: 5, size: 2, off: 52 }
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
      /* Shift the whole projection so the piece sits in the middle of the free
         area rather than in the middle of the canvas. clip.w = -z here, so
         proj[8] / proj[9] add a constant NDC offset at any depth. */
      var box = insetBox();
      proj[8] = -box.ndcX;
      proj[9] = -box.ndcY;
      /* Stitch texture LOD: below ~2 device px per stitch the V and the crease
         are sampled under Nyquist and read as dirt, so they fade out and the
         piece keeps only its per-stitch colour. */
      var pxPerUnit = state.h / (2 * CAM_DIST * Math.tan(FOV / 2));
      var stitchPx = SW * state.fit.scale * state.zoom * pxPerUnit;
      state.tex = smoothstep(TEX_PX_OFF, TEX_PX_ON, stitchPx);
      state.stitchPx = stitchPx;
      gl.uniform1f(u.tex, state.tex);
      gl.uniform1f(u.seam, 0);
      gl.uniform1f(u.tintMix, 0);
      gl.uniform3f(u.tint, state.alertLin[0], state.alertLin[1], state.alertLin[2]);
      gl.uniformMatrix4fv(u.proj, false, proj);
      gl.uniformMatrix4fv(u.view, false, view);
      gl.uniformMatrix3fv(u.nrm, false, nrm);
      gl.uniform3f(u.glowColor, state.glowLin[0], state.glowLin[1], state.glowLin[2]);
      gl.uniform3f(u.rimColor, state.rimLin[0], state.rimLin[1], state.rimLin[2]);
      gl.uniform3f(u.flat, state.ghostLin[0], state.ghostLin[1], state.ghostLin[2]);

      for (var i = 0; i < ATTRS.length; i++) gl.enableVertexAttribArray(ATTRS[i].loc);

      var rounds = state.model.rounds;
      var draws = 0, tris = 0;

      /* The working round, and how much of it the pattern actually asked for.
         Slices past that are the stitches the counter is over by: they render
         in the alert tint instead of confidently closing the ring (05 #6). */
      var cur = clamp(state.model.current, 0, Math.max(0, rounds.length - 1));
      /* A FINISHED piece has no working round (06 #5): no marker bracelet and
         no pending grid. The host says so where it knows (`setModel`'s
         `finished`), and the model derives it otherwise. */
      var done = !!state.fitFinished || !!state.model.finished;
      state.markerOn = !done;
      var dev = state.model.deviation;
      var expSlices = -1;
      if (dev && typeof dev.expected === 'number' && dev.expected > 0 && rounds[cur]) {
        var rcur = rounds[cur];
        if (rcur.count > dev.expected && rcur.n > 0) {
          expSlices = clamp(Math.round(dev.expected / rcur.count * rcur.n), 0, rcur.n);
        }
      }

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
      gl.uniform1f(u.shadow, 0);
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
      /* the gathered close at the bottom, once that round is actually worked */
      if (state.botChunk && state.botBand >= 0 && rounds[state.botBand] &&
          !rounds[state.botBand].ghost && rounds[state.botBand].doneSlices >= rounds[state.botBand].n) {
        var bc = state.botChunk;
        bindChunk(gl, bc);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bc.tbo);
        gl.uniform1f(u.animSlice, -1);
        gl.uniform1f(u.animScale, 1);
        gl.uniform1f(u.glow, glowBand === state.botBand ? glowAmt : 0);
        gl.drawElements(gl.TRIANGLES, bc.triCount, gl.UNSIGNED_SHORT, 0);
        draws++; tris += bc.triCount / 3;
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
        gl.uniform1f(u.seam, r.seam ? 1 : 0);
        if (i === cur && expSlices >= 0 && solid > expSlices) {
          if (expSlices > 0) {
            gl.drawElements(gl.TRIANGLES, expSlices * c.tps, gl.UNSIGNED_SHORT, 0);
            draws++; tris += expSlices * c.tps / 3;
          }
          /* the surplus wedge, loud enough to read at button size (06 #12):
             the alert tint REPLACES the yarn and a flat, unlit lift of the same
             colour goes over the shading, so three stitches of twenty-four on a
             black band are still orange */
          gl.uniform1f(u.tintMix, ALERT_MIX);
          gl.uniform3f(u.glowColor, state.alertLin[0], state.alertLin[1], state.alertLin[2]);
          gl.uniform1f(u.glow, Math.max(glowBand === i ? glowAmt : 0, ALERT_GLOW));
          gl.drawElements(gl.TRIANGLES, (solid - expSlices) * c.tps, gl.UNSIGNED_SHORT,
            expSlices * c.tps * 2);
          gl.uniform1f(u.tintMix, 0);
          gl.uniform1f(u.glow, glowBand === i ? glowAmt : 0);
          gl.uniform3f(u.glowColor, state.glowLin[0], state.glowLin[1], state.glowLin[2]);
          draws++; tris += (solid - expSlices) * c.tps / 3;
        } else {
          gl.drawElements(gl.TRIANGLES, solid * c.tps, gl.UNSIGNED_SHORT, 0);
          draws++; tris += solid * c.tps / 3;
        }
      }
      gl.uniform1f(u.seam, 0);

      /* pass 1b: contact shadow. It lies on a horizontal plane, so it only
         makes sense while the camera is above the piece; it fades out as the
         view comes level and never appears when looking from below. */
      gl.depthMask(false);
      if (state.shadowChunk && state.shadowFade > 0) {
        var shA = SHADOW_ALPHA * state.shadowFade *
          smoothstep(SHADOW_PITCH_IN, SHADOW_PITCH_FULL, state.pitch + state.userPitch);
        if (shA > 0.004) {
          var sc = state.shadowChunk;
          bindChunk(gl, sc);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sc.tbo);
          gl.uniform1f(u.shadow, 1);
          gl.uniform1f(u.alpha, shA);
          gl.uniform1f(u.animSlice, -1);
          gl.uniform1f(u.animScale, 1);
          gl.uniform1f(u.glow, 0);
          gl.drawElements(gl.TRIANGLES, sc.triCount, gl.UNSIGNED_SHORT, 0);
          draws++; tris += sc.triCount / 3;
        }
        gl.uniform1f(u.shadow, 0);
      }

      /* pass 2: translucent wireframe (ghost rounds + the pending part of the
         ring in progress) */
      gl.uniform1f(u.wire, 1);
      gl.uniform1f(u.glow, 0);
      gl.uniform1f(u.animSlice, -1);
      gl.uniform1f(u.animScale, 1);
      var ghostA = state.ghostLin[3] != null ? state.ghostLin[3] : 1;
      for (i = 0; i < state.chunks.length; i++) {
        var cw = state.chunks[i];
        if (!cw) continue;
        var rw = rounds[i];
        // a finished piece has no round in progress, so no pending grid (06 #5)
        if (done && !rw.ghost) continue;
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
        // future rounds: bare rings. The round in progress: the full grid, so
        // the stitches still to work read as cells waiting to be filled.
        var per = rw.ghost ? cw.gps : cw.lps;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, rw.ghost ? cw.rbo : cw.lbo);
        gl.drawElements(gl.LINES, (cw.n - start) * per, gl.UNSIGNED_SHORT, start * per * 2);
        draws++;
      }

      /* pass 2b: the working round's bracelet (05 #3). A crocheter's first
         question at any zoom is "which round am I on", and the solid/ghost
         step is a 4 px feature halfway down a featureless tube. Both edges of
         the current band get a glow line — consecutive bands share a ring, so
         the band above's ring IS this round's top edge — and the line is drawn
         with the depth test on, so it wraps the piece instead of floating over
         it. No geometry: the ring index buffers already exist.
         On a FINISHED piece there is no working round, so there is no bracelet
         either (06 #5): the marker used to paint the snowman Hat's whole flared
         brim coral and half of a 2-round bee wing. */
      if (!done && rounds.length && state.chunks[cur]) {
        gl.uniform3f(u.flat, state.glowLin[0], state.glowLin[1], state.glowLin[2]);
        gl.uniform1f(u.alpha, MARKER_ALPHA);
        var cb2 = state.chunks[cur];
        var doneN = Math.min(rounds[cur].doneSlices, cb2.n);
        if (doneN > 0) {
          bindChunk(gl, cb2);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cb2.rbo);
          gl.drawElements(gl.LINES, doneN * cb2.gps, gl.UNSIGNED_SHORT, 0);
          draws++;
        }
        var above = cur > 0 ? state.chunks[cur - 1] : null;
        if (above && rounds[cur - 1] && !rounds[cur - 1].ghost) {
          bindChunk(gl, above);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, above.rbo);
          gl.drawElements(gl.LINES, above.n * above.gps, gl.UNSIGNED_SHORT, 0);
          draws++;
        }
        gl.uniform3f(u.flat, state.ghostLin[0], state.ghostLin[1], state.ghostLin[2]);
      }
      gl.depthMask(true);

      for (i = 0; i < ATTRS.length; i++) gl.disableVertexAttribArray(ATTRS[i].loc);

      var dt = now() - t0;
      var st = state.stats;
      st.drawCalls = draws;
      st.triangles = tris | 0;
      state.frameAcc += dt; state.frameN++;
      if (state.frameN >= 12) {
        // JS submit time only: it never waits on the GPU, so it is NOT frame time
        st.submitMs = state.frameAcc / state.frameN;
        state.frameAcc = 0; state.frameN = 0;
      }
      /* A real frame-time estimate: the wall-clock gap between two rendered
         frames while something is animating. `submitMs` read 0.12 ms at 57k
         triangles and every claim about this renderer's cost was made from it
         (02 #20); this is the number that can be compared with a 16.7 ms
         budget. Gaps over 100 ms are a throttled or backgrounded tab, not a
         slow frame, so they are dropped. */
      var wall = now();
      if (state.lastDrawT) {
        var gap = wall - state.lastDrawT;
        if (gap > 0 && gap < 100) {
          state.deltaAcc += gap; state.deltaN++;
          if (state.deltaN >= 10) {
            st.frameMs = state.deltaAcc / state.deltaN;
            state.deltaAcc = 0; state.deltaN = 0;
          }
        }
      }
      state.lastDrawT = wall;
    }

    function modelHasFabric() {
      var r = state.model.rounds;
      for (var i = 0; i < r.length; i++) if (r[i].count > 0) return true;
      return false;
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
          var w = b.width > 0 ? b.width : r.n * SW;
          var x0 = b.x0 != null ? b.x0 : -w / 2, x1 = x0 + w;
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
      // once the pause is over, auto-rotation and the pitch return both want
      // frames, and both are off under reduced motion
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

      /* The yaw the user left behind is theirs to keep — auto-rotation simply
         carries on from it. A pitch is different: held at an odd angle the
         piece reads as broken, so it eases home once the pause is over. */
      if (!state.dragging && !state.reducedMotion && state.userPitch !== 0 &&
          t >= state.pauseUntil && dt > 0) {
        state.userPitch *= Math.pow(0.02, dt / PITCH_RETURN);
        if (Math.abs(state.userPitch) < 0.002) state.userPitch = 0;
      }

      tickFit(t);
      state.dirty = false;
      render(t);

      /* An honest handle (05 #7): a frame that submitted nothing while the
         model has fabric in it means there is no piece on screen, whatever
         `mount` returned. The host puts its one-line fallback message up. */
      if (state.gl && state.w > 0) {
        report(state.stats.drawCalls === 0 && modelHasFabric() ? 'blank' : 'ok');
      }

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

    /* The viewer sheet mounts before its layout has settled, so the very first
       resize() found a 0-sized box, bailed, and the canvas stayed at its HTML
       default of 300 x 150 — the "blank viewer" of 05 #7 whenever nothing else
       ever nudged it. Retry on the next few frames until the box is real. */
    function ensureSize(tries) {
      if (state.destroyed || state.w > 0) return;
      resize();
      if (state.w > 0 || (tries || 0) >= 20) return;
      global.requestAnimationFrame(function () { ensureSize((tries || 0) + 1); });
    }

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

    /* The host gets told, once per transition, whether there is a 3D piece on
       screen at all. `mount` used to return a handle whatever happened, so the
       app's "The 3D view could not start." copy never fired and the user saw a
       silent empty rectangle (05 #7). */
    function report(status) {
      if (state.status === status) return;
      state.status = status;
      var cb = state.onStatus;
      if (!cb) return;
      try {
        cb({ webgl: !!state.gl, status: status, message: STATUS_MSG[status] || '' });
      } catch (e) { /* a host that throws must not stop the renderer */ }
    }

    function onLost(e) {
      if (e && e.preventDefault) e.preventDefault();
      state.gl = null;
      state.prog = null;
      state.chunks = [];
      state.capChunk = null;
      state.botChunk = null;
      state.shadowChunk = null;
      state.shadowHash = 0;
      state.hashes = [];
      state.lost = true;
      if (state.rafId) { global.cancelAnimationFrame(state.rafId); state.rafId = 0; }
      state.running = false;
      if (handle) handle.webgl = false;
      if (!state.destroyed) report('lost');
    }
    function onRestored() {
      if (state.destroyed) return;
      state.fallback2d = null;
      if (initGL()) {
        state.lost = false;
        state.hashes = [];
        if (handle) handle.webgl = true;
        rebuild(state.model);
        applyFit(computeFit(), true);
        report('restored');
        kick();
      }
    }
    canvas.addEventListener('webglcontextlost', onLost, false);
    canvas.addEventListener('webglcontextrestored', onRestored, false);

    /* Hand the context back to the browser. Called for a mount that is being
       thrown away (destroy({ release: true })), and by `reapContexts` for one
       whose canvas has left the document. */
    function releaseContext(reason) {
      liveRec.dead = true;
      var gl = state.gl;
      if (!gl) return;
      disposeChunks();
      if (state.prog) {
        try { gl.deleteProgram(state.prog.program); } catch (e) { /* ignore */ }
      }
      state.prog = null;
      state.gl = null;
      state.lost = true;
      if (handle) handle.webgl = false;
      if (state.rafId) { global.cancelAnimationFrame(state.rafId); state.rafId = 0; }
      state.running = false;
      try {
        var ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      } catch (e) { /* ignore */ }
      if (reason !== 'destroy' && !state.destroyed) report('lost');
    }
    var liveRec = { canvas: canvas, dead: false, release: releaseContext };

    /* ------------------------------------------------------- interaction */

    var pointers = {};
    var pinchDist = 0, lastTap = 0, dragMoved = 0;

    /* ---- shared rotation, used by the canvas's own pointer handlers AND by
       the host through handle.dragStart/dragMove/dragEnd. One implementation
       means the stitch button and the viewer sheet can never disagree about
       which way the model turns. ---- */

    /* Radians per CSS pixel: dragging the full width of the canvas turns the
       piece half a revolution, whatever size the canvas is, so it feels like
       the same physical ball in the button and in the sheet. */
    function dragScale() {
      var cssW = state.dpr > 0 ? state.w / state.dpr : state.w;
      return Math.PI / clamp(cssW || 320, 160, 900);
    }

    function dragBegin() {
      state.dragging = true;
      state.spinVel = 0;
      state.dragT = now();
      kick();
    }

    /* dx / dy are CSS pixels since the last move. Drag right -> the near face
       goes right; drag down -> the near face goes down and the top opens up. */
    function dragBy(dx, dy) {
      if (!state.dragging) dragBegin();
      var k = dragScale();
      state.yaw += dx * k;
      state.userPitch = clamp(state.userPitch + dy * k, -PITCH_LIMIT, PITCH_LIMIT);
      var t = now();
      var ms = t - state.dragT;
      state.dragT = t;
      if (ms > 0) state.spinVel = clamp(dx * k * 1000 / ms, -FLICK_MAX, FLICK_MAX);
      kick();
    }

    function dragFinish() {
      if (!state.dragging) return;
      state.dragging = false;
      state.pauseUntil = now() + ROT_PAUSE;
      kick();
    }

    function onPointerDown(e) {
      if (!state.interactive) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
      var n = countPointers();
      if (n === 1) {
        dragBegin();
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
        dragBy(dx, dy);
      }
      e.preventDefault();
      kick();
    }
    function onPointerUp(e) {
      if (!state.interactive) return;
      delete pointers[e.pointerId];
      if (countPointers() < 2) pinchDist = 0;
      if (countPointers() === 0) {
        dragFinish();
        if (dragMoved < 6) {
          var t = now();
          // double-tap resets the view — viewer sheet only; the stitch button
          // drives rotation through the drag API and never calls this, so a
          // double tap there is two stitches, not a view reset.
          if (t - lastTap < 320) { resetView(); lastTap = 0; }
          else lastTap = t;
          state.spinVel = 0;
        }
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
      /* The host may re-declare which frame this is and whether the piece is
         finished with every push: finishing the last round switches the
         viewer from "keep the worked row on screen" to "letterbox the whole
         piece honestly", and that has to take effect on the same push. */
      if (o && (o.fitPurpose === 'button' || o.fitPurpose === 'viewer' || o.fitPurpose === 'gallery')) {
        state.fitPurpose = o.fitPurpose;
      }
      if (o && o.finished !== undefined) state.fitFinished = !!o.finished;
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

    /**
     * @param {{release:boolean}} [o] `release: true` hands the GL context back
     *   to the browser (WEBGL_lose_context). Pass it when the <canvas> element
     *   itself is being thrown away — a canvas whose context has been lost can
     *   never get another one, so the app must NOT pass it for a canvas it
     *   intends to reuse.
     */
    function destroy(o) {
      if (state.destroyed) {
        if (o && o.release) { try { releaseContext('destroy'); } catch (e) { /* ignore */ } }
        return;
      }
      state.destroyed = true;
      state.onStatus = null;
      if (state.rafId) global.cancelAnimationFrame(state.rafId);
      state.rafId = 0;
      if (state.resumeTimer) { global.clearTimeout(state.resumeTimer); state.resumeTimer = 0; }
      bindInteraction(false);
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
      global.removeEventListener('resize', onWinResize);
      if (ro) { try { ro.disconnect(); } catch (e) { /* ignore */ } }
      disposeChunks();
      unregisterLive(liveRec);
      liveRec.dead = true;
      if (o && o.release) {
        releaseContext('destroy');
        state.fallback2d = null;
        return;
      }
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
    LIVE.push(liveRec);
    reapContexts(liveRec);
    resize();
    ensureSize(0);
    if (state.interactive) bindInteraction(true);
    kick();
    if (!ok) {
      /* asynchronously, so the host has its handle (and its DOM) before it is
         told to put a message up */
      global.setTimeout(function () { if (!state.destroyed) report('unavailable'); }, 0);
    }

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
      /* CSS-pixel margins the piece must stay out of (the stitch button's
         number and pills). The fit box shrinks to what is left and the
         projection shifts so the piece is centred in the free area. */
      setSafeInsets: setSafeInsets,
      /** true while there is a working GL context on this canvas. */
      isLive: function () { return !!state.gl; },
      /* Host-driven rotation for a canvas that cannot see pointers itself.
         Works whether or not `interactive` is on. */
      dragStart: function () { if (!state.destroyed) dragBegin(); },
      dragMove: function (dx, dy) { if (!state.destroyed) dragBy(dx || 0, dy || 0); },
      dragEnd: function () { if (!state.destroyed) dragFinish(); },
      getStats: function () {
        var s = state.stats;
        return {
          webgl: !!state.gl,
          status: state.status,
          lost: !!state.lost,
          fps: Math.round(s.fps * 10) / 10,
          /* Real frame time: the wall-clock gap between rendered frames while
             something is animating (02 #20). `submitMs` is the old `frameMs` —
             the JS submit loop, which never waits on the GPU and read 0.12 ms
             at 57k triangles. Both are here so nobody confuses them again. */
          frameMs: Math.round(s.frameMs * 100) / 100,
          submitMs: Math.round(s.submitMs * 100) / 100,
          buildMs: Math.round(s.buildMs * 100) / 100,
          rebuilt: s.rebuilt || 0,
          triangles: s.triangles,
          drawCalls: s.drawCalls,
          chunks: s.chunks,
          verts: s.verts,
          running: state.running,
          dpr: state.dpr,
          canvasPx: state.w + 'x' + state.h,
          stitchPx: r3(state.stitchPx || 0),
          tex: r3(state.tex),
          contexts: LIVE.length,
          /* the composed alpha future rounds and the pending grid actually
             render at — the number 02 #1 was about */
          ghostAlpha: {
            ghost: r3(GHOST_ALPHA * (state.ghostLin[3] == null ? 1 : state.ghostLin[3])),
            pending: r3(PENDING_ALPHA * (state.ghostLin[3] == null ? 1 : state.ghostLin[3])),
            marker: MARKER_ALPHA
          },
          /* Is this piece finished, and therefore was the working-round marker
             and the pending grid drawn at all? (06 #5.) `markerOn` is what the
             last frame really did, and is null until a frame has run. */
          finished: !!state.fitFinished || !!state.model.finished,
          markerOn: state.markerOn == null ? null : !!state.markerOn,
          /* the per-stitch bump the last rebuild actually used (06 #6): the
             absolute ceiling, the relative one, and the range over the bands */
          bump: {
            abs: r3(BUMP * SW), rel: BUMP_R,
            min: r3(state.bumpLo || 0), max: r3(state.bumpHi || 0)
          },
          alert: { mix: ALERT_MIX, glow: ALERT_GLOW },
          insets: {
            top: state.insets.top, right: state.insets.right,
            bottom: state.insets.bottom, left: state.insets.left
          },
          // camera, so a test can assert direction without reading pixels
          yaw: Math.round(state.yaw * 1000) / 1000,
          pitch: Math.round((state.pitch + state.userPitch) * 1000) / 1000,
          userPitch: Math.round(state.userPitch * 1000) / 1000,
          zoom: Math.round(state.zoom * 1000) / 1000,
          fitScale: Math.round(state.fit.scale * 1000) / 1000,
          fitClamp: state.fitClamp || '',
          fitPurpose: state.fitPurpose,
          fitFinished: !!state.fitFinished,
          fitCy: Math.round(state.fit.cy * 1000) / 1000,
          dragging: !!state.dragging,
          /* geometry, so a test or the gallery can assert the reference table
             without re-deriving it (01 ranked change 14) */
          geo: state.geo ? {
            height: r3(state.geo.height),
            width: r3(state.geo.width),
            maxRadius: r3(state.geo.maxRadius),
            aspect: r3(state.geo.aspect),
            equatorFrac: r3(state.geo.equatorFrac),
            corners: state.geo.corners || 0,
            ruffles: state.geo.ruffles || 0,
            slack: state.geo.slack,
            closedTop: !!state.geo.closedTop,
            closedBottom: !!state.geo.closedBottom,
            anchor: state.geo.anchor || null
          } : null
        };
      }
    };
    return handle;
  }

  /* The inter-round profile, as numbers a test can assert: the old BULGE put
     the mid-band at +0.084 SW and the edges at −0.038 SW. */
  var BLG_MAX = -Infinity, BLG_MIN = Infinity;
  (function () {
    for (var t = 0; t < VROWS; t++) {
      if (BLG[t] > BLG_MAX) BLG_MAX = BLG[t];
      if (BLG[t] < BLG_MIN) BLG_MIN = BLG[t];
    }
  }());

  global.Diagram = {
    mount: mount,
    version: '1.3.0',
    // exposed for tests / tuning
    _consts: {
      SW: SW, SH_SC: (global.DiagramGeo ? global.DiagramGeo.SH_SC : FB_SH_SC),
      MAX_SLICES: MAX_SLICES, BUMP: BUMP,
      /* 06 #6: the bump is min(BUMP*SW, BUMP_R*R), and the scallop may use at
         most DIP_SPAN of the band's own height, so neither can reach past the
         ring two bands share. */
      BUMP_R: BUMP_R, DIP: DIP, DIP_SPAN: DIP_SPAN,
      /* bump at the two ends of the useful range, as a fraction of the ring:
         a 6-stitch ring (r 0.95) and a 48-stitch one (r 7.64) */
      BUMP_AT_6: Math.round(Math.min(BUMP * SW, BUMP_R * 6 / TAU) / (6 / TAU) * 1e4) / 1e4,
      BUMP_AT_48: Math.round(Math.min(BUMP * SW, BUMP_R * 48 / TAU) / (48 / TAU) * 1e4) / 1e4,
      FT_EDGES_ZERO: FT[0] === 0 && Math.abs(FT[VROWS - 1]) < 1e-12,
      ALERT_MIX: ALERT_MIX, ALERT_GLOW: ALERT_GLOW,
      GROOVE: GROOVE,
      BLG_MAX: Math.round(BLG_MAX * 1e6) / 1e6,
      BLG_MIN: Math.round(BLG_MIN * 1e6) / 1e6,
      BLG_EDGES_EQUAL: Math.abs(BLG[0] - BLG[VROWS - 1]) < 1e-12,
      GHOST_ALPHA: GHOST_ALPHA, PENDING_ALPHA: PENDING_ALPHA,
      MARKER_ALPHA: MARKER_ALPHA,
      TEX_GROOVE: TEX_GROOVE, TEX_V: TEX_V, TEX_SEAM: TEX_SEAM,
      MAX_LIVE: MAX_LIVE,
      FLOATS: FLOATS,
      SHADOW_ALPHA: SHADOW_ALPHA, JIT_LIGHT: JIT_LIGHT, JIT_AMP: JIT_AMP,
      PITCH_RETURN: PITCH_RETURN, ROT_PAUSE: ROT_PAUSE,
      geo: global.DiagramGeo ? global.DiagramGeo.version : null
    }
  };

}(typeof window !== 'undefined' ? window : this));
