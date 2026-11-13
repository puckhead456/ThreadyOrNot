/* ==========================================================================
   Thready or Not — stitched-fabric renderer for cross-stitch (wave K, X1–X5)
   --------------------------------------------------------------------------
   One renderer whose per-frame cost does not depend on the chart size: the
   chart and its progress live in textures (palette index + done bit + mark
   rank per cell), and one full-screen fragment pass draws the cloth (aida,
   evenweave, linen), two-leg crosses (bottom leg "/", top leg "\" — always),
   strand plies with twist and a sheen under a fixed light, per-stitch
   variation seeded by the holes so nothing looks stamped, the unstitched
   pattern as a faint printed tint or its symbols, half / quarter /
   three-quarter stitches, and the hoop or frame around it. Zoomed out it
   fades to a pre-filtered (mipmapped) colour image of the piece, so a
   500 x 500 chart neither aliases nor shimmers. Backstitch and French knots /
   beads are a second, small geometry pass on top.

   A tap is a sub-upload of the rows it touched, never a rebuild; a time-lapse
   is one uniform compared against the mark rank stored per cell. Idle when
   nothing changes. Context loss, DPR, resize and reduced motion are handled;
   with no WebGL it falls back to Canvas 2D flat stitched tiles and says so.

   Public API: docs/wave-k/api/xs-render.md. No modules, no build step, ES5.
   Attaches window.XSRender.
   ========================================================================== */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var MAX_LIVE = 4;            // button + viewer sheet + share picture, with one spare
  var NO_RANK = 65535;
  var BLOCK = 10;
  var GLYPH_COLS = 16, GLYPH_PX = 48, GLYPH_MAX = 256;
  var NEW_MS = 150;            // the newest stitch is drawn leg by leg in this long
  var PULSE_MS = 2400;         // how long the next-stitch marker breathes after a change
  var FALLBACK_LABEL = 'Not your real order: shown colour by colour, row by row';
  var STATUS_MSG = {
    ok: '',
    restored: '',
    fallback: 'Showing a simple stitched view: this device has no 3D graphics.',
    unavailable: 'Showing a simple stitched view: 3D graphics are not available right now.',
    lost: 'The stitched view stopped and had to be released.'
  };

  /* ================================================================ utils */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function num(v, d) { v = +v; return isFinite(v) ? v : d; }
  function now() { return (global.performance && global.performance.now) ? global.performance.now() : Date.now(); }
  function isObj(o) { return !!o && typeof o === 'object'; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  var NAMED_FABRIC = {
    white: [252, 251, 248], 'antique white': [244, 240, 230], ecru: [240, 234, 218],
    cream: [247, 241, 226], ivory: [246, 242, 230], natural: [238, 230, 214],
    black: [32, 32, 32], navy: [40, 48, 72], 'light blue': [214, 228, 240],
    'summer khaki': [226, 214, 190], grey: [206, 206, 206], gray: [206, 206, 206],
    'lambs wool': [242, 236, 222], "lamb's wool": [242, 236, 222], oatmeal: [226, 216, 196],
    red: [168, 32, 40], 'christmas red': [168, 32, 40], green: [40, 92, 60], pink: [244, 214, 220]
  };

  /** '#abc' | '#aabbcc' | 'aabbcc' | 'rgb(…)' | a fabric name -> [r, g, b] or null */
  function parseColor(c) {
    if (Array.isArray(c) && c.length >= 3) return [c[0] | 0, c[1] | 0, c[2] | 0];
    var s = String(c == null ? '' : c).trim();
    if (!s) return null;
    var m = /^#?([0-9a-f]{6})$/i.exec(s);
    if (m) {
      var v = parseInt(m[1], 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    }
    m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) {
      var h = m[1];
      return [parseInt(h.charAt(0) + h.charAt(0), 16), parseInt(h.charAt(1) + h.charAt(1), 16),
        parseInt(h.charAt(2) + h.charAt(2), 16)];
    }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
    if (m) return [clamp(Math.round(+m[1]), 0, 255), clamp(Math.round(+m[2]), 0, 255), clamp(Math.round(+m[3]), 0, 255)];
    var named = NAMED_FABRIC[s.toLowerCase()];
    return named ? named.slice() : null;
  }

  function lin(rgb) { // 0..255 sRGB -> approximately linear 0..1 (gamma 2, matches the shaders)
    return [Math.pow(rgb[0] / 255, 2), Math.pow(rgb[1] / 255, 2), Math.pow(rgb[2] / 255, 2)];
  }
  function cssRgb(rgb, a) {
    return a == null ? 'rgb(' + (rgb[0] | 0) + ',' + (rgb[1] | 0) + ',' + (rgb[2] | 0) + ')'
      : 'rgba(' + (rgb[0] | 0) + ',' + (rgb[1] | 0) + ',' + (rgb[2] | 0) + ',' + a + ')';
  }
  function mixRgb(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function luma(rgb) { return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255; }

  function bitOf(bytes, i) { return bytes && (i >> 3) < bytes.length ? (bytes[i >> 3] >> (i & 7)) & 1 : 0; }

  function prefersReduced() {
    try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }

  /* ======================================================= pure: textures */

  /* Cell texel layout (RGBA8, one texel per stitch):
       r = palette index low byte
       g = palette index bits 8-11 | done << 4 | part << 5 | empty << 6
       b, a = mark rank high, low byte (65535 = no rank)            */
  function packCellTexel(idx, done, flags, rank) {
    var f = flags || {};
    var empty = !(idx >= 0);
    var ix = empty ? 0 : (idx & 4095);
    var rk = rank == null || rank < 0 ? NO_RANK : clamp(rank | 0, 0, NO_RANK);
    return [ix & 255, ((ix >> 8) & 15) | (done ? 16 : 0) | (f.part ? 32 : 0) | (empty ? 64 : 0),
      (rk >> 8) & 255, rk & 255];
  }

  function unpackCellTexel(r, g, b, a) {
    return {
      idx: r + (g & 15) * 256, done: (g >> 4) & 1, part: (g >> 5) & 1, empty: (g >> 6) & 1,
      rank: (b << 8) | a
    };
  }

  /* Part texel: r = a low, g = a hi(4) | b hi(4) << 4, b = b low,
     a = (d-1) | done << 2 | hasB << 3 | present << 4 */
  function packPartTexel(p, done) {
    var a = p.a >= 0 ? p.a & 4095 : 0, b = p.b >= 0 ? p.b & 4095 : 0;
    return [a & 255, ((a >> 8) & 15) | (((b >> 8) & 15) << 4), b & 255,
      (clamp((p.d | 0) || 1, 1, 4) - 1) | (done ? 4 : 0) | (p.b >= 0 ? 8 : 0) | 16];
  }

  /** The whole cell texture for a model, rank optional (Uint16Array). */
  function packCells(model, rank) {
    var w = model.w, h = model.h, n = w * h;
    var out = new Uint8Array(n * 4);
    var cells = model.cells, done = model.done, np = model.palette.length;
    var partCell = model._partCell;
    for (var i = 0; i < n; i++) {
      var v = cells[i];
      var o = i << 2;
      var empty = !(v >= 0 && v < np);
      var ix = empty ? 0 : v;
      var dn = done ? (done[i >> 3] >> (i & 7)) & 1 : 0;
      var pt = partCell && partCell[i] >= 0 ? 32 : 0;
      var rk = rank ? rank[i] : NO_RANK;
      out[o] = ix & 255;
      out[o + 1] = ((ix >> 8) & 15) | (dn << 4) | pt | (empty ? 64 : 0);
      out[o + 2] = (rk >> 8) & 255;
      out[o + 3] = rk & 255;
    }
    return out;
  }

  function packParts(model) {
    var w = model.w, h = model.h, part = model.part;
    if (!part.length) return null;
    var out = new Uint8Array(w * h * 4);
    for (var k = 0; k < part.length; k++) {
      var p = part[k];
      if (!(p.x >= 0 && p.y >= 0 && p.x < w && p.y < h)) continue;
      var t = packPartTexel(p, bitOf(model.donePart, k));
      var o = ((p.y | 0) * w + (p.x | 0)) << 2;
      out[o] = t[0]; out[o + 1] = t[1]; out[o + 2] = t[2]; out[o + 3] = t[3];
    }
    return out;
  }

  var KIND_CODE = { cross: 0, half: 1, back: 2, knot: 3, bead: 4, blend: 5 };

  function sheenOf(e) {
    var code = String((e && e.code) || '');
    if (/^E\d/i.test(code) || /metallic|light effects|kreinik/i.test(String((e && e.name) || ''))) return 2;
    if (/^S\d/i.test(code) || /satin/i.test(String((e && e.name) || ''))) return 1;
    return 0;
  }

  /** Palette texture: n x 2 RGBA. Row 0 = sRGB + strands; row 1 = blend partner, sheen, kind. */
  function packPalette(model) {
    var pal = model.palette, n = Math.max(1, pal.length);
    var out = new Uint8Array(n * 2 * 4);
    for (var i = 0; i < pal.length; i++) {
      var e = pal[i];
      var rgb = e.rgb;
      var o = i * 4, o2 = (n + i) * 4;
      out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2];
      out[o + 3] = clamp(e.strands | 0, 0, 7) * 32;
      var bw = e.blendWith >= 0 && e.blendWith < pal.length ? e.blendWith : -1;
      out[o2] = bw >= 0 ? bw & 255 : 0;
      out[o2 + 1] = bw >= 0 ? (((bw >> 8) & 15) | 16) : 0;
      out[o2 + 2] = sheenOf(e) * 80;
      out[o2 + 3] = (KIND_CODE[e.kind] || 0) * 40;
    }
    return out;
  }

  /* ========================================================== pure: views */

  /** How much thread detail a given stitch size (device px) gets. */
  function lodFor(px) {
    px = num(px, 0);
    var detail = smooth(3.5, 9, px);
    return {
      tier: px >= 9 ? 'thread' : (px >= 3.5 ? 'blend' : 'colour'),
      detail: detail,
      weave: smooth(2.5, 7, px),
      fine: smooth(10, 22, px)
    };
  }

  /** Standard embroidery hoop for a design (inches across, radius in stitches). */
  var HOOPS = [3, 4, 5, 6, 7, 8, 9, 10, 12, 14];
  function hoopFor(w, h, count, over) {
    var cpi = Math.max(1, num(count, 14) / Math.max(1, num(over, 1)));
    var diag = Math.sqrt(w * w + h * h) / cpi;
    var need = diag + 1.0;
    var inches = 0;
    for (var i = 0; i < HOOPS.length; i++) { if (HOOPS[i] >= need) { inches = HOOPS[i]; break; } }
    var custom = !inches;
    if (custom) inches = Math.ceil(need);
    return { inches: inches, radius: inches / 2 * cpi, custom: custom, cpi: cpi };
  }

  /** Decoration geometry, in stitches: what is around the chart. */
  function decorGeo(w, h, frame, fabric) {
    var D = Math.max(w, h, 1);
    var cx = w / 2, cy = h / 2;
    var f = fabric || {};
    if (frame === 'hoop') {
      var hp = hoopFor(w, h, f.count, f.over);
      var R = hp.radius;
      var W = Math.max(0.42 * hp.cpi, R * 0.075);
      return { kind: 1, cx: cx, cy: cy, R: R, W: W, inches: hp.inches,
        x0: cx - R - W, y0: cy - R - W * 1.6, x1: cx + R + W, y1: cy + R + W };
    }
    if (frame === 'frame') {
      var pad = Math.max(2, 0.06 * D), mat = 0.2 * D, mould = 0.075 * D;
      var hx = w / 2 + pad, hy = h / 2 + pad, all = mat + mould;
      return { kind: 2, cx: cx, cy: cy, hx: hx, hy: hy, mat: mat, mould: mould,
        bevel: Math.max(0.2, 0.012 * D),
        x0: cx - hx - all, y0: cy - hy - all, x1: cx + hx + all, y1: cy + hy + all };
    }
    var m = Math.max(2, Math.round(0.035 * D));
    return { kind: 0, cx: cx, cy: cy, margin: m, x0: -m, y0: -m, x1: w + m, y1: h + m };
  }

  /** The view that shows the whole piece (and its decoration) in a viewport. */
  function fitView(w, h, vw, vh, o) {
    o = o || {};
    var g = o.geo || decorGeo(w, h, o.frame || 'none', o.fabric);
    var ins = o.insets || {};
    var l = num(ins.left, 0), r = num(ins.right, 0), t = num(ins.top, 0), b = num(ins.bottom, 0);
    var aw = Math.max(1, vw - l - r), ah = Math.max(1, vh - t - b);
    var bw = g.x1 - g.x0, bh = g.y1 - g.y0;
    var pad = num(o.pad, 0.04);
    var scale = Math.min(aw / (bw * (1 + pad * 2)), ah / (bh * (1 + pad * 2)));
    if (!(scale > 0)) scale = 1;
    // centre of the free area, mapped back to world
    var mx = (g.x0 + g.x1) / 2, my = (g.y0 + g.y1) / 2;
    var cx = mx - ((l + aw / 2) - vw / 2) / scale;
    var cy = my - ((t + ah / 2) - vh / 2) / scale;
    return { cx: cx, cy: cy, scale: scale };
  }

  /** Screen point (device px from the canvas's top-left) -> cell. */
  function hitTest(view, sx, sy, w, h) {
    var x = view.cx + (sx - view.vw / 2) / view.scale;
    var y = view.cy + (sy - view.vh / 2) / view.scale;
    var cx = Math.floor(x), cy = Math.floor(y);
    var inside = cx >= 0 && cy >= 0 && cx < w && cy < h;
    return { x: cx, y: cy, i: inside ? cy * w + cx : -1, inside: inside, wx: x, wy: y };
  }

  /** Cell corner (x, y) -> screen point in device px. */
  function screenOf(view, x, y) {
    return { sx: (x - view.cx) * view.scale + view.vw / 2, sy: (y - view.cy) * view.scale + view.vh / 2 };
  }

  /** The loupe's window: the 10 x 10 block holding (x, y) plus a margin. */
  function loupeWindow(w, h, x, y, o) {
    o = o || {};
    var b = Math.max(1, num(o.block, BLOCK) | 0);
    var m = Math.max(0, num(o.margin, 2));
    x = clamp(num(x, 0) | 0, 0, Math.max(0, w - 1));
    y = clamp(num(y, 0) | 0, 0, Math.max(0, h - 1));
    var bx = Math.floor(x / b), by = Math.floor(y / b);
    var bx0 = bx * b, by0 = by * b;
    var bx1 = Math.min(w, bx0 + b), by1 = Math.min(h, by0 + b);
    return { bx: bx, by: by, bx0: bx0, by0: by0, bx1: bx1, by1: by1,
      bw: bx1 - bx0, bh: by1 - by0,
      x0: bx0 - m, y0: by0 - m, x1: bx1 + m, y1: by1 + m };
  }

  /** The view a loupe window gets in a viewport (device px). */
  function loupeView(win, vw, vh, stitchPx, insets) {
    var ins = insets || {};
    var l = num(ins.left, 0), r = num(ins.right, 0), t = num(ins.top, 0), b = num(ins.bottom, 0);
    var aw = Math.max(1, vw - l - r), ah = Math.max(1, vh - t - b);
    var ww = win.x1 - win.x0, wh = win.y1 - win.y0;
    var fit = Math.min(aw / ww, ah / wh);
    var scale = Math.min(fit, Math.max(stitchPx * 2, fit * 0.5));
    scale = Math.max(scale, Math.min(fit, 4));
    var mx = (win.bx0 + win.bx1) / 2, my = (win.by0 + win.by1) / 2;
    return { cx: mx - ((l + aw / 2) - vw / 2) / scale, cy: my - ((t + ah / 2) - vh / 2) / scale, scale: scale };
  }

  /** The tap button: the whole chart when it fits at >= 5 CSS px a stitch, else the loupe. */
  function buttonView(w, h, cssW, cssH) {
    if (!(w > 0 && h > 0)) return 'whole';
    var z = Math.min((cssW - 20) / w, (cssH - 20) / h);
    return z >= 5 ? 'whole' : 'loupe';
  }

  /* ========================================================= pure: replay */

  /** Done cells, by palette order, then reading order. Never a history: label it. */
  function fallbackOrder(model) {
    var n = model.w * model.h, cells = model.cells, done = model.done, np = model.palette.length;
    var counts = new Int32Array(np + 1);
    var i, v;
    for (i = 0; i < n; i++) {
      v = cells[i];
      if (v >= 0 && v < np && bitOf(done, i)) counts[v + 1]++;
    }
    for (i = 1; i <= np; i++) counts[i] += counts[i - 1];
    var out = new Int32Array(counts[np]);
    var at = counts.slice ? counts.slice(0, np) : Array.prototype.slice.call(counts, 0, np);
    for (i = 0; i < n; i++) {
      v = cells[i];
      if (v >= 0 && v < np && bitOf(done, i)) out[at[v]++] = i;
    }
    return out;
  }

  /**
   * replayOrder(model, order) -> { order, fallback, label, before }
   * The last occurrence of a cell wins; cells no longer done are dropped;
   * done cells missing from the order were stitched before the log began and
   * show from the first frame (`before`), so the last frame is the live bitmap.
   */
  function replayOrder(model, order) {
    var n = model.w * model.h;
    var done = model.done, cells = model.cells, np = model.palette.length;
    var list = order && order.length != null ? order : null;
    if (list && list.length) {
      var last = new Int32Array(n);
      for (var k = 0; k < n; k++) last[k] = -1;
      for (var j = 0; j < list.length; j++) {
        var c = list[j] | 0;
        if (c >= 0 && c < n) last[c] = j;
      }
      var keep = [];
      for (j = 0; j < list.length; j++) {
        var ci = list[j] | 0;
        if (ci >= 0 && ci < n && last[ci] === j && bitOf(done, ci) && cells[ci] >= 0 && cells[ci] < np) keep.push(ci);
      }
      if (keep.length) {
        var before = 0;
        for (k = 0; k < n; k++) {
          if (cells[k] >= 0 && cells[k] < np && bitOf(done, k) && last[k] < 0) before++;
        }
        return { order: new Int32Array(keep), fallback: false, label: '', before: before };
      }
    }
    return { order: fallbackOrder(model), fallback: true, label: FALLBACK_LABEL, before: 0 };
  }

  /** What the texture stores: the order position, scaled to 16 bits when it must be. */
  function rankOf(order, n) {
    var rank = new Uint16Array(n);
    for (var i = 0; i < n; i++) rank[i] = NO_RANK;
    var m = order.length;
    var scale = m <= NO_RANK - 1 ? Math.max(1, m) : NO_RANK - 1;
    for (var k = 0; k < m; k++) {
      var c = order[k];
      if (c >= 0 && c < n) rank[c] = m <= NO_RANK - 1 ? k : Math.floor(k * (NO_RANK - 1) / m);
    }
    return { rank: rank, scale: scale, count: m };
  }

  /** Width of the "growing" front in reveal units, for `total` ranked cells. */
  function growWindow(total) { return clamp(24 / Math.max(1, total), 0.004, 0.08); }

  /** Cells that have started to appear at time-lapse position f (0..1). */
  function revealCount(f, total) {
    if (!(total > 0)) return 0;
    var win = growWindow(total);
    var r = clamp(f, 0, 1) * (1 + win);
    var scale = total <= NO_RANK - 1 ? total : NO_RANK - 1;
    // rank q is shown when (q + 0.5) / scale < r
    var q = Math.ceil(r * scale - 0.5);
    if (q <= 0) return 0;
    if (total <= NO_RANK - 1) return Math.min(total, q);
    return Math.min(total, Math.ceil(q * total / (NO_RANK - 1)));
  }

  /** XStitch.markLog (xs-core) -> plain order, when that API exists. */
  function orderFromMarkLog(log, n) {
    var ML = global.XStitch && global.XStitch.markLog;
    if (!ML || typeof ML.replay !== 'function' || !log) return null;
    var it;
    try { it = ML.replay(log, n); } catch (e) { return null; }
    if (!it || typeof it.next !== 'function') return null;
    var prev = new Uint8Array(Math.ceil(n / 8));
    var order = [];
    for (var guard = 0; guard < 1e6; guard++) {
      var fr;
      try { fr = it.next(); } catch (e2) { break; }
      if (!fr || fr.done === true) break;
      var bits = fr.bits || (fr.value && fr.value.bits);
      if (typeof bits === 'string' && global.XStitch.bitsState) bits = global.XStitch.bitsState(bits, n).bytes;
      if (!bits || !bits.length) continue;
      for (var b = 0; b < prev.length; b++) {
        var add = bits[b] & ~prev[b];
        if (add) {
          for (var k = 0; k < 8; k++) if (add & (1 << k)) { var ci = b * 8 + k; if (ci < n) order.push(ci); }
        }
        prev[b] = bits[b];
      }
    }
    return order.length ? new Int32Array(order) : null;
  }

  function canRecordVideo() {
    var C = global.HTMLCanvasElement;
    if (!C || !C.prototype || typeof C.prototype.captureStream !== 'function') {
      return { ok: false, mime: '', reason: 'Saving a video is not supported on this device.' };
    }
    if (typeof global.MediaRecorder !== 'function') {
      return { ok: false, mime: '', reason: 'Saving a video is not supported on this device.' };
    }
    var types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    for (var i = 0; i < types.length; i++) {
      try { if (global.MediaRecorder.isTypeSupported(types[i])) return { ok: true, mime: types[i], reason: '' }; }
      catch (e) { /* keep looking */ }
    }
    return { ok: false, mime: '', reason: 'Saving a video is not supported on this device.' };
  }

  /* ================================================================ model */

  function unpackXS(data) {
    var X = global.XStitch;
    var chart = data.chart || {};
    var w = chart.w | 0, h = chart.h | 0, n = w * h;
    var cells = null;
    if (chart.cells instanceof Int16Array || Array.isArray(chart.cells)) cells = chart.cells;
    else if (X && X.unpackCells && chart.cells) { try { cells = X.unpackCells(chart.cells); } catch (e) { cells = null; } }
    var pr = data.progress || {};
    function bits(b64, len) {
      if (b64 instanceof Uint8Array) return b64;
      if (!b64 || !X) return null;
      try {
        if (X.bitsState) return X.bitsState(b64, len).bytes;
        if (X.unpackBits) { // unpackBits returns one byte per bit
          var u = X.unpackBits(b64, len), out = new Uint8Array(Math.ceil(len / 8));
          for (var i = 0; i < len; i++) if (u[i]) out[i >> 3] |= 1 << (i & 7);
          return out;
        }
      } catch (e) { /* ignore */ }
      return null;
    }
    return {
      w: w, h: h, cells: cells || new Int16Array(n),
      done: bits(pr.done, n),
      palette: data.palette || [],
      part: chart.part || [], back: chart.back || [], knots: chart.knots || [],
      doneBack: bits(pr.doneBack, (chart.back || []).length),
      doneKnots: bits(pr.doneKnots, (chart.knots || []).length),
      donePart: bits(pr.donePart, (chart.part || []).length),
      fabric: data.fabric || {},
      strandsDefault: data.strandsDefault
    };
  }

  /** Normalise either an XSData or a raw model. Never throws. */
  function model(src) {
    src = isObj(src) ? src : {};
    var raw = (src.chart && !src.cells) ? unpackXS(src) : src;
    var w = Math.max(0, raw.w | 0), h = Math.max(0, raw.h | 0), n = w * h;
    var cells = raw.cells;
    if (!cells || cells.length < n) {
      var c2 = new Int16Array(n);
      for (var i = 0; i < n; i++) c2[i] = cells && i < cells.length ? cells[i] : -1;
      cells = c2;
    }
    var sd = clamp(num(raw.strandsDefault, 2) | 0, 1, 6);
    var palIn = Array.isArray(raw.palette) ? raw.palette : [];
    var palette = [];
    for (var p = 0; p < palIn.length; p++) {
      var e = palIn[p] || {};
      palette.push({
        hex: e.hex, rgb: parseColor(e.hex) || [128, 128, 128], symbol: e.symbol || '',
        strands: clamp(num(e.strands, sd) | 0, 1, 6), bsStrands: clamp(num(e.bsStrands, 1) | 0, 1, 6),
        kind: e.kind || 'cross', blendWith: e.blendWith == null ? -1 : (e.blendWith | 0),
        brand: e.brand || '', code: e.code == null ? '' : String(e.code), name: e.name || ''
      });
    }
    var done = raw.done instanceof Uint8Array ? raw.done : new Uint8Array(Math.ceil(n / 8));
    if (done.length < Math.ceil(n / 8)) { var d2 = new Uint8Array(Math.ceil(n / 8)); d2.set(done); done = d2; }
    var fab = isObj(raw.fabric) ? raw.fabric : {};
    var fabric = {
      color: fab.color || 'White', rgb: parseColor(fab.color) || [250, 248, 243],
      count: clamp(num(fab.count, 14), 6, 56), over: clamp(num(fab.over, 1) | 0, 1, 2),
      kind: fab.kind === 'evenweave' || fab.kind === 'linen' ? fab.kind : 'aida'
    };
    if (fab.over == null && fabric.kind !== 'aida' && fabric.count >= 22) fabric.over = 2;
    function list(a) { return Array.isArray(a) ? a : []; }
    var part = list(raw.part), back = list(raw.back), knots = list(raw.knots);
    var partCell = null;
    if (part.length && n) {
      partCell = new Int32Array(n);
      for (i = 0; i < n; i++) partCell[i] = -1;
      for (i = 0; i < part.length; i++) {
        var pp = part[i];
        if (pp && pp.x >= 0 && pp.y >= 0 && pp.x < w && pp.y < h) partCell[(pp.y | 0) * w + (pp.x | 0)] = i;
      }
    }
    function bitsFor(b, len) {
      var need = Math.ceil(len / 8);
      if (b instanceof Uint8Array && b.length >= need) return b;
      var out = new Uint8Array(Math.max(1, need));
      if (b instanceof Uint8Array) out.set(b.subarray(0, Math.min(b.length, out.length)));
      return out;
    }
    return {
      w: w, h: h, cells: cells, done: done, palette: palette, fabric: fabric,
      part: part, back: back, knots: knots,
      doneBack: bitsFor(raw.doneBack, back.length),
      doneKnots: bitsFor(raw.doneKnots, knots.length),
      donePart: bitsFor(raw.donePart, part.length),
      strandsDefault: sd,
      _partCell: partCell
    };
  }

  /* ============================================================== shaders */

  var VERT_QUAD = [
    'attribute vec2 aPos;',
    'void main() { gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var FRAG_HEAD = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'float B8(float v) { return floor(v * 255.0 + 0.5); }',
    'vec3 toLin(vec3 c) { return c * c; }',
    'vec3 toSrgb(vec3 c) { return sqrt(max(c, vec3(0.0))); }',
    'float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
    'vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }',
    'float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y); }',
    'float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0); }',
    // thread average brightness the colour pass uses, matched to shadeThread below
    'const float THREAD_AVG = 0.80;',
    'const float FAB_AVG = 0.86;',
    'float legHw(float strands, float countK) { return clamp((0.10 + 0.055 * strands) * countK, 0.09, 0.32); }',
    'float coverOf(float hw) { return clamp(5.08 * hw - 4.0 * hw * hw, 0.0, 0.95); }'
  ].join('\n');

  /* The per-cell colour image the far zoom shows, mipmapped. One texel a
     stitch, drawn on the GPU into a power-of-two texture whenever progress,
     the palette or the time-lapse position changes. */
  var FRAG_LOD = FRAG_HEAD + '\n' + [
    'uniform sampler2D uCells;',
    'uniform sampler2D uParts;',
    'uniform sampler2D uPal;',
    'uniform vec2 uChart;',
    'uniform float uPalW;',
    'uniform vec3 uFabric;',
    'uniform float uGhost;',
    'uniform float uReveal;',
    'uniform float uRankScale;',
    'uniform float uCountK;',
    'uniform float uHasParts;',
    'vec4 palAt(float i, float row) { return texture2D(uPal, vec2((i + 0.5) / uPalW, row)); }',
    'void main() {',
    '  vec2 c = floor(gl_FragCoord.xy);',
    '  vec4 t = texture2D(uCells, (c + 0.5) / uChart);',
    '  float R = B8(t.r), G = B8(t.g);',
    '  float idx = R + mod(G, 16.0) * 256.0;',
    '  float fl = floor(G / 16.0);',
    '  float done = mod(fl, 2.0);',
    '  float hasPart = mod(floor(fl / 2.0), 2.0);',
    '  float empty = mod(floor(fl / 4.0), 2.0);',
    '  float rank = B8(t.b) * 256.0 + B8(t.a);',
    '  if (uReveal >= 0.0 && rank < 65534.5) done = (rank + 0.5) / uRankScale < uReveal ? 1.0 : 0.0;',
    '  vec3 fab = uFabric * FAB_AVG;',
    '  vec3 col = fab;',
    '  if (hasPart > 0.5 && uHasParts > 0.5) {',
    '    vec4 pt = texture2D(uParts, (c + 0.5) / uChart);',
    '    float pr = B8(pt.r), pg = B8(pt.g), pb = B8(pt.b), pa = B8(pt.a);',
    '    float ia = pr + mod(pg, 16.0) * 256.0;',
    '    float ib = pb + floor(pg / 16.0) * 256.0;',
    '    float pdone = mod(floor(pa / 4.0), 2.0);',
    '    float hasB = mod(floor(pa / 8.0), 2.0);',
    '    vec4 ca = palAt(ia, 0.25); vec4 cb = palAt(ib, 0.25);',
    '    float hw = legHw(floor(ca.a * 255.0 / 32.0 + 0.5), uCountK);',
    '    vec3 la = toLin(ca.rgb), lb = toLin(cb.rgb);',
    '    if (pdone > 0.5) col = mix(fab, la * THREAD_AVG, coverOf(hw) * 0.62) + (hasB > 0.5 ? (lb * THREAD_AVG - fab) * coverOf(hw) * 0.25 : vec3(0.0));',
    '    else col = mix(fab, hasB > 0.5 ? mix(la, lb, 0.35) : la, uGhost * 0.75);',
    '  } else if (empty < 0.5) {',
    '    vec4 p0 = palAt(idx, 0.25);',
    '    vec4 p1 = palAt(idx, 0.75);',
    '    vec3 floss = toLin(p0.rgb);',
    '    float strands = floor(p0.a * 255.0 / 32.0 + 0.5);',
    '    float kind = floor(p1.a * 255.0 / 40.0 + 0.5);',
    '    if (mod(B8(p1.g), 32.0) >= 16.0) {',
    '      float bi = B8(p1.r) + mod(B8(p1.g), 16.0) * 256.0;',
    '      floss = mix(floss, toLin(palAt(bi, 0.25).rgb), 0.5);',
    '    }',
    '    float cov = coverOf(legHw(strands, uCountK)) * (kind > 0.5 && kind < 1.5 ? 0.55 : 1.0);',
    '    if (done > 0.5) col = mix(fab, floss * THREAD_AVG, cov);',
    '    else col = mix(fab, floss, uGhost);',
    '  }',
    '  gl_FragColor = vec4(toSrgb(col), 1.0);',
    '}'
  ].join('\n');

  var FRAG_MAIN = FRAG_HEAD + '\n' + [
    'uniform sampler2D uCells;',
    'uniform sampler2D uParts;',
    'uniform sampler2D uPal;',
    'uniform sampler2D uLod;',
    'uniform sampler2D uGlyph;',
    'uniform vec2 uChart;',
    'uniform vec2 uLodSize;',
    'uniform float uPalW;',
    'uniform vec2 uGlyphGrid;',
    'uniform vec2 uViewport;',
    'uniform vec2 uCenter;',
    'uniform float uScale;',
    'uniform vec3 uFabric;',
    'uniform float uWeave;',
    'uniform float uCountK;',
    'uniform float uGhost;',
    'uniform float uSymbols;',
    'uniform vec3 uInk;',
    'uniform float uReveal;',
    'uniform float uRankScale;',
    'uniform float uGrowWin;',
    'uniform vec3 uNew;',
    'uniform vec4 uNext;',
    'uniform vec4 uBlock;',
    'uniform float uDim;',
    'uniform vec4 uMini;',
    'uniform vec4 uMiniView;',
    'uniform vec4 uFrame;',
    'uniform vec4 uGeoA;',
    'uniform vec4 uGeoB;',
    'uniform vec3 uAccent;',
    'uniform vec4 uBg;',
    'uniform vec3 uEye;',
    'uniform float uDetail;',
    'uniform float uWeaveK;',
    'uniform float uFine;',
    'uniform float uHasParts;',
    '',
    'const vec3 LDIR = vec3(-0.4880, -0.5856, 0.6474);',  // from the top left, raised
    'vec4 palAt(float i, float row) { return texture2D(uPal, vec2((i + 0.5) / uPalW, row)); }',
    '',
    /* ---- the cloth ---- */
    'vec3 fabricAt(vec2 P, float aa) {',
    '  vec3 base = uFabric;',
    '  if (uWeaveK <= 0.001) return base * FAB_AVG;',
    '  vec3 col;',
    '  if (uWeave < 0.5) {',
    /* aida: a hole at every stitch corner, each square a slightly raised
       block of four threads, the threads turning a quarter from block to
       block like basketweave, with a fine gap between blocks */
    '    vec2 c = floor(P); vec2 uv = P - c;',
    '    vec2 d = min(uv, 1.0 - uv);',
    '    float rc = length(d);',
    '    float edge = min(d.x, d.y);',
    '    float hole = 1.0 - smoothstep(0.085 - aa, 0.085 + aa, rc);',
    '    float chk = mod(c.x + c.y, 2.0);',
    '    float a = chk < 0.5 ? uv.x : uv.y;',          // along the bundle on top
    '    float b = chk < 0.5 ? uv.y : uv.x;',          // across it
    '    float la = chk < 0.5 ? -LDIR.y : -LDIR.x;',
    '    float nb = (b - 0.5) / 0.45;',
    '    float cyl = sqrt(max(0.0, 1.0 - nb * nb));',
    '    float ends = smoothstep(0.0, 0.17, min(a, 1.0 - a));',
    '    float fib = sin(b * 28.27 + hash12(c) * 6.0) * uFine;',
    '    float topL = clamp(-nb * la * 0.55 + cyl * LDIR.z, 0.0, 1.0);',
    '    float top = (0.58 + 0.42 * topL) * (0.78 + 0.22 * ends) * (1.0 + 0.045 * fib);',
    '    float covA = smoothstep(0.03 - aa, 0.06 + aa, min(b, 1.0 - b));',
    '    float shade = mix(0.60, top, covA) + 0.12;',
    '    shade += (hash12(c) - 0.5) * 0.04;',
    '    col = base * shade;',
    '    col = mix(col, base * 0.20, hole);',
    '  } else {',
    /* evenweave / linen worked over two: single threads at half a stitch,
       over and under, a hole at every crossing gap; linen threads slub */
    '    vec2 t = P * 2.0; vec2 ti = floor(t); vec2 tf = t - ti - 0.5;',
    '    float aa2 = aa * 2.0;',
    '    float wH = 0.36, wV = 0.36;',
    '    if (uWeave > 1.5) {',
    '      wH += 0.11 * (vnoise(vec2(t.x * 0.45, ti.y * 7.31)) - 0.5);',
    '      wV += 0.11 * (vnoise(vec2(t.y * 0.45, ti.x * 5.17)) - 0.5);',
    '    }',
    '    float inH = 1.0 - smoothstep(wH - aa2, wH + aa2, abs(tf.y));',
    '    float inV = 1.0 - smoothstep(wV - aa2, wV + aa2, abs(tf.x));',
    '    float sh = sqrt(max(0.0, 1.0 - (tf.y * tf.y) / (wH * wH)));',
    '    float sv = sqrt(max(0.0, 1.0 - (tf.x * tf.x) / (wV * wV)));',
    '    vec3 cH = base * (0.70 + 0.30 * sh) * (0.96 + 0.08 * hash12(vec2(3.0, ti.y)));',
    '    vec3 cV = base * (0.70 + 0.30 * sv) * (0.96 + 0.08 * hash12(vec2(ti.x, 7.0)));',
    '    float hTop = mod(ti.x + ti.y, 2.0);',
    '    col = base * 0.26;',
    '    if (hTop > 0.5) { col = mix(col, cV * 0.88, inV); col = mix(col, cH, inH); }',
    '    else { col = mix(col, cH * 0.88, inH); col = mix(col, cV, inV); }',
    '  }',
    '  return mix(base * FAB_AVG, col, uWeaveK);',
    '}',
    '',
    /* ---- one leg of thread as a capsule: x = across (-1..1), y = along (0..1),
       z = coverage, w = signed distance to its edge ---- */
    'vec4 legGeom(vec2 p, vec2 A, vec2 Bp, float hw, float grow, float aa) {',
    '  vec2 AB = Bp - A; float L = length(AB); vec2 T = AB / L; vec2 N = vec2(-T.y, T.x);',
    '  vec2 q = p - A;',
    '  float t = dot(q, T) / L;',
    '  float g = max(grow, 0.0001);',
    '  float tc = clamp(t, 0.0, g);',
    '  float endk = min(tc, 1.0 - tc) * L;',
    '  float w = hw * (0.66 + 0.34 * smoothstep(0.0, hw * 0.8, endk));',
    '  float dist = length(p - (A + T * (tc * L))) - w;',
    '  float cov = (1.0 - smoothstep(-aa, aa, dist)) * step(0.001, grow);',
    '  return vec4(dot(q, N) / w, t, cov, dist);',
    '}',
    '',
    /* ---- the thread's look: plies, twist, a Kajiya-Kay sheen, diving into the holes ---- */
    'vec3 shadeThread(vec3 base, vec3 alt, float s, float t, float L, vec2 T2, float nStr, float phase, float sheen, vec3 V, float lift) {',
    '  s = clamp(s, -1.0, 1.0);',
    '  float q = (s * 0.5 + 0.5) * nStr;',
    '  float ply = min(floor(q), nStr - 1.0);',
    '  float f = (q - ply) * 2.0 - 1.0;',
    '  vec3 b = mod(ply, 2.0) > 0.5 ? alt : base;',
    '  vec2 N2 = vec2(-T2.y, T2.x);',
    '  float nx = mix(s, f, 0.55);',
    '  float nz = sqrt(max(0.0, 1.0 - nx * nx));',
    '  float endT = min(t, 1.0 - t);',
    '  float tilt = (1.0 - smoothstep(0.0, 0.22, endT)) * sign(t - 0.5) * 0.9;',
    '  vec3 n = normalize(vec3(N2 * nx + T2 * tilt, nz + lift));',
    '  float tw = sin((t * L * 7.0 - f * 0.85 + phase + ply * 1.7) * 6.2832);',
    '  float ang = 0.42;',
    '  vec3 Tf = normalize(vec3(T2 * cos(ang) + N2 * sin(ang), -tilt * 0.6));',
    '  float diff = clamp(dot(n, LDIR) * 0.6 + 0.4, 0.0, 1.0);',
    '  vec3 H = normalize(LDIR + V);',
    '  float th = dot(Tf, H);',
    '  float kk = sqrt(max(0.0, 1.0 - th * th));',
    '  float shin = sheen > 1.5 ? 90.0 : (sheen > 0.5 ? 60.0 : 28.0);',
    '  float specK = sheen > 1.5 ? 0.85 : (sheen > 0.5 ? 0.45 : 0.20);',
    '  float spec = pow(kk, shin) * specK * smoothstep(0.0, 0.6, nz);',
    '  float crease = smoothstep(0.70, 1.0, abs(f)) * step(1.5, nStr);',
    '  float stripe = 1.0 + 0.11 * tw * uFine;',
    '  float dive = 0.62 + 0.38 * smoothstep(0.0, 0.16, endT);',
    '  vec3 c = b * (0.34 + 0.78 * diff) * stripe * (1.0 - 0.30 * crease * (0.4 + 0.6 * uFine)) * dive;',
    '  vec3 sc = sheen > 1.5 ? mix(b, vec3(1.0), 0.35) : mix(vec3(1.0), b, 0.25);',
    '  return c + sc * spec * (0.6 + 0.4 * (tw * 0.5 + 0.5));',
    '}',
    '',
    /* ---- a full cross (or a half stitch) on cell c ---- */
    'vec3 shadeCross(vec3 fab, vec2 uv, vec2 c, vec3 floss, vec3 alt, float hw, float nStr, float sheen, float kind, float g1, float g2, vec3 V, float aa) {',
    '  float J = 0.05;',
    '  vec2 j00 = (hash22(c) - 0.5) * J;',
    '  vec2 j10 = (hash22(c + vec2(1.0, 0.0)) - 0.5) * J;',
    '  vec2 j01 = (hash22(c + vec2(0.0, 1.0)) - 0.5) * J;',
    '  vec2 j11 = (hash22(c + vec2(1.0, 1.0)) - 0.5) * J;',
    '  float E = 0.11;',
    '  float hv = hash12(c + 17.3);',
    '  float hwj = hw * (0.94 + 0.12 * hv);',
    '  vec2 A1 = vec2(E, 1.0 - E) + j01, B1 = vec2(1.0 - E, E) + j10;',   // bottom leg "/"
    '  vec2 A2 = vec2(E, E) + j00,       B2 = vec2(1.0 - E, 1.0 - E) + j11;', // top leg "\"
    '  float isHalf = (kind > 0.5 && kind < 1.5) ? 1.0 : 0.0;',
    '  if (isHalf > 0.5) g2 = 0.0;',
    '  vec4 l1 = legGeom(uv, A1, B1, hwj, g1, aa);',
    '  vec4 l2 = legGeom(uv, A2, B2, hwj * 1.03, g2, aa);',
    // drop shadow of the stitch onto the cloth, and contact darkening
    '  vec2 so = vec2(0.045, 0.06);',
    '  vec4 s1 = legGeom(uv - so, A1, B1, hwj, g1, aa);',
    '  vec4 s2 = legGeom(uv - so, A2, B2, hwj, g2, aa);',
    '  float shd = max(s1.z * step(0.001, g1), s2.z * step(0.001, g2));',
    '  float near = min(g1 > 0.001 ? l1.w : 1.0, g2 > 0.001 ? l2.w : 1.0);',
    '  vec3 col = fab * (1.0 - 0.30 * shd) * (1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.09, near)));',
    '  float ph = hv * 6.2832;',
    '  float bright = 0.95 + 0.10 * hash12(c + 3.7);',
    '  if (l1.z > 0.0) {',
    '    vec2 T1 = normalize(B1 - A1);',
    '    vec3 t1 = shadeThread(floss * bright, alt * bright, l1.x, l1.y, length(B1 - A1), T1, nStr, ph, sheen, V, 0.0);',
    // the top leg shades the bottom one where it crosses over it
    '    float occ = g2 > 0.001 ? (1.0 - smoothstep(0.0, hwj * 0.9, l2.w)) : 0.0;',
    '    t1 *= 1.0 - 0.42 * occ * (1.0 - l2.z);',
    '    col = mix(col, t1, l1.z);',
    '  }',
    '  if (l2.z > 0.0) {',
    '    vec2 T2 = normalize(B2 - A2);',
    '    float arch = 1.0 - abs(l2.y - 0.5) * 2.0;',
    '    vec3 t2 = shadeThread(floss * bright, alt * bright, l2.x, l2.y, length(B2 - A2), T2, nStr, ph + 2.1, sheen, V, 0.0);',
    '    t2 *= 0.97 + 0.08 * arch;',
    '    col = mix(col, t2, l2.z);',
    '  }',
    '  return col;',
    '}',
    '',
    'vec2 cornerOf(float d) {',
    '  return d < 0.5 ? vec2(0.0, 0.0) : (d < 1.5 ? vec2(1.0, 1.0) : (d < 2.5 ? vec2(1.0, 0.0) : vec2(0.0, 1.0)));',
    '}',
    '',
    /* ---- a fractional: colour a = three-quarter stitch (quarter leg from
       corner d, half leg on the other diagonal), colour b = quarter stitch
       from the opposite corner ---- */
    'vec3 shadePart(vec3 fab, vec2 uv, vec2 c, vec4 pt, float g, vec3 V, float aa) {',
    '  float pr = B8(pt.r), pg = B8(pt.g), pb = B8(pt.b), pa = B8(pt.a);',
    '  float ia = pr + mod(pg, 16.0) * 256.0;',
    '  float ib = pb + floor(pg / 16.0) * 256.0;',
    '  float d = mod(pa, 4.0);',
    '  float pdone = mod(floor(pa / 4.0), 2.0);',
    '  float hasB = mod(floor(pa / 8.0), 2.0);',
    '  vec4 ca = palAt(ia, 0.25); vec4 cb = palAt(ib, 0.25);',
    '  vec3 la = toLin(ca.rgb), lb = toLin(cb.rgb);',
    '  float nA = floor(ca.a * 255.0 / 32.0 + 0.5), nB = floor(cb.a * 255.0 / 32.0 + 0.5);',
    '  float hwA = legHw(nA, uCountK), hwB = legHw(nB, uCountK);',
    '  vec2 K = cornerOf(d);',
    '  vec2 O = vec2(1.0) - K;',
    '  float E = 0.11;',
    '  vec2 inset = (vec2(0.5) - K) * E * 2.0;',
    '  vec2 Ka = K + inset, Ob = O - inset;',
    '  vec2 mid = vec2(0.5) + (hash22(c) - 0.5) * 0.03;',
    // the half leg: the diagonal that does not touch K
    '  vec2 H1 = vec2(K.x, 1.0 - K.y); vec2 H2 = vec2(1.0 - K.x, K.y);',
    '  H1 += (vec2(0.5) - H1) * E * 2.0; H2 += (vec2(0.5) - H2) * E * 2.0;',
    '  if (pdone < 0.5) {',
    '    float side = dot(uv - vec2(0.5), K - vec2(0.5));',
    '    vec3 tint = (hasB > 0.5 && side < 0.0) ? lb : la;',
    '    return mix(fab, tint, uGhost);',
    '  }',
    '  vec4 lh = legGeom(uv, H1, H2, hwA, g, aa);',
    '  vec4 lq = legGeom(uv, Ka, mid, hwA, g, aa);',
    '  vec4 lo = legGeom(uv, Ob, mid, hwB, hasB * g, aa);',
    '  float near = min(min(lh.w, lq.w), hasB > 0.5 ? lo.w : 1.0);',
    '  vec3 col = fab * (1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.09, near)));',
    '  float ph = hash12(c) * 6.2832;',
    '  if (lh.z > 0.0) col = mix(col, shadeThread(la, la, lh.x, lh.y, length(H2 - H1), normalize(H2 - H1), nA, ph, 0.0, V, 0.0), lh.z);',
    '  if (lo.z > 0.0) col = mix(col, shadeThread(lb, lb, lo.x, lo.y, length(mid - Ob), normalize(mid - Ob), nB, ph + 1.3, 0.0, V, 0.0), lo.z);',
    '  if (lq.z > 0.0) col = mix(col, shadeThread(la, la, lq.x, lq.y, length(mid - Ka), normalize(mid - Ka), nA, ph + 2.6, 0.0, V, 0.0), lq.z);',
    '  return col;',
    '}',
    '',
    'vec3 woodAt(vec2 q, float along, float across, vec3 tone) {',
    '  float g = vnoise(vec2(along * 0.9, across * 9.0)) * 0.6 + vnoise(vec2(along * 3.1, across * 26.0)) * 0.4;',
    '  float ring = sin(across * 40.0 + g * 6.0) * 0.5 + 0.5;',
    '  return tone * (0.82 + 0.22 * g) * (0.93 + 0.07 * ring);',
    '}',
    '',
    'void main() {',
    '  vec2 sp = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y);',
    '  vec2 P = uCenter + (sp - 0.5 * uViewport) / uScale;',
    '  float aa = 0.75 / uScale;',
    // mipmapped lookups stay in uniform control flow
    '  vec4 lodS = texture2D(uLod, P / uLodSize);',
    '  vec2 mp = (sp - uMini.xy) / max(uMini.zw, vec2(1.0)) * uChart;',
    '  vec4 miniS = texture2D(uLod, mp / uLodSize);',
    '  vec2 cell = floor(P);',
    '  vec2 uv = P - cell;',
    '  bool inChart = P.x >= 0.0 && P.y >= 0.0 && P.x < uChart.x && P.y < uChart.y;',
    '  vec3 V = normalize(vec3(uEye.xy - P, uEye.z));',
    '  vec3 fab = fabricAt(P, aa);',
    '  vec3 col = fab;',
    '  if (inChart && uDetail > 0.001) {',
    '    vec4 ct = texture2D(uCells, (cell + 0.5) / uChart);',
    '    float R = B8(ct.r), G = B8(ct.g);',
    '    float idx = R + mod(G, 16.0) * 256.0;',
    '    float fl = floor(G / 16.0);',
    '    float done = mod(fl, 2.0);',
    '    float hasPart = mod(floor(fl / 2.0), 2.0);',
    '    float empty = mod(floor(fl / 4.0), 2.0);',
    '    float rank = B8(ct.b) * 256.0 + B8(ct.a);',
    '    float g1 = 1.0, g2 = 1.0;',
    '    if (uReveal >= 0.0 && rank < 65534.5) {',
    '      float rf = (rank + 0.5) / uRankScale;',
    '      float pr = clamp((uReveal - rf) / uGrowWin, 0.0, 1.0);',
    '      done = pr > 0.0 ? 1.0 : 0.0;',
    '      g1 = clamp(pr * 2.0, 0.0, 1.0); g2 = clamp(pr * 2.0 - 1.0, 0.0, 1.0);',
    '    }',
    '    if (uNew.z >= 0.0 && abs(cell.x - uNew.x) < 0.5 && abs(cell.y - uNew.y) < 0.5) {',
    '      g1 = clamp(uNew.z * 2.0, 0.0, 1.0); g2 = clamp(uNew.z * 2.0 - 1.0, 0.0, 1.0);',
    '    }',
    '    if (hasPart > 0.5 && uHasParts > 0.5) {',
    '      vec4 pt = texture2D(uParts, (cell + 0.5) / uChart);',
    '      col = shadePart(fab, uv, cell, pt, g1, V, aa);',
    '    } else if (empty < 0.5) {',
    '      vec4 p0 = palAt(idx, 0.25);',
    '      vec4 p1 = palAt(idx, 0.75);',
    '      vec3 floss = toLin(p0.rgb);',
    '      float strands = max(1.0, floor(p0.a * 255.0 / 32.0 + 0.5));',
    '      float kind = floor(p1.a * 255.0 / 40.0 + 0.5);',
    '      float sheen = floor(p1.b * 255.0 / 80.0 + 0.5);',
    '      vec3 alt = floss;',
    '      if (mod(B8(p1.g), 32.0) >= 16.0) {',
    '        float bi = B8(p1.r) + mod(B8(p1.g), 16.0) * 256.0;',
    '        alt = toLin(palAt(bi, 0.25).rgb);',
    '        strands = max(strands, 2.0);',
    '      }',
    '      if (done > 0.5) {',
    '        col = shadeCross(fab, uv, cell, floss, alt, legHw(strands, uCountK), strands, sheen, kind, g1, g2, V, aa);',
    '      } else {',
    '        col = mix(fab, floss, uGhost);',
    '        if (uSymbols > 0.001) {',
    '          vec2 gc = vec2(mod(idx, uGlyphGrid.x), floor(idx / uGlyphGrid.x));',
    '          vec2 guv = (gc + 0.08 + uv * 0.84) / uGlyphGrid;',
    '          float ga = texture2D(uGlyph, guv).a * step(idx, 255.5);',
    '          col = mix(col, uInk, ga * uSymbols * 0.9);',
    '        }',
    '      }',
    '    }',
    '  }',
    '  vec3 lodLin = toLin(lodS.rgb);',
    '  if (P.x < 0.0 || P.y < 0.0 || P.x > uLodSize.x || P.y > uLodSize.y) lodLin = uFabric * FAB_AVG;',
    '  col = mix(lodLin, col, uDetail);',
    '  if (!inChart && uDetail < 0.999) col = mix(uFabric * FAB_AVG, fab, uWeaveK);',
    // loupe: the block being worked, the rest a touch dimmer, the next stitch marked
    '  if (uBlock.z > uBlock.x) {',
    '    float db = sdBox(P - (uBlock.xy + uBlock.zw) * 0.5, (uBlock.zw - uBlock.xy) * 0.5);',
    '    float lw = max(1.6 / uScale, 0.035);',
    '    col *= mix(1.0, 0.80, uDim * smoothstep(0.0, aa * 2.0, db));',
    '    float line = 1.0 - smoothstep(lw - aa, lw + aa, abs(db));',
    '    col = mix(col, uAccent, line * 0.85);',
    '  }',
    '  if (uNext.w > 0.5) {',
    '    float grow = max(0.0, 4.0 / uScale - 0.5);',
    '    float dn = sdBox(P - (uNext.xy + 0.5), vec2(0.5 + grow));',
    '    float lw2 = max(1.8 / uScale, 0.07);',
    '    float ring = 1.0 - smoothstep(lw2 - aa, lw2 + aa, abs(dn + lw2));',
    '    col = mix(col, uAccent, ring * (0.55 + 0.45 * uNext.z));',
    '  }',
    // the decoration around the cloth
    '  float a = 1.0;',
    '  float shA = 0.0;',
    '  if (uFrame.x < 0.5) {',
    '    vec2 hc = uChart * 0.5;',
    '    float d = sdBox(P - hc, hc + uFrame.y);',
    '    a = 1.0 - smoothstep(-aa, aa, d);',
    '    col *= 1.0 - 0.10 * smoothstep(-uFrame.y * 0.6, 0.0, d);',
    '    float ds = sdBox(P - hc - vec2(0.3, 0.45) * uFrame.y * 0.35, hc + uFrame.y);',
    '    shA = 0.20 * (1.0 - smoothstep(0.0, max(uFrame.y * 0.5, 4.0 * aa), ds));',
    '  } else if (uFrame.x < 1.5) {',
    '    vec2 q = P - uGeoA.xy; float r = length(q); float Rr = uGeoA.z, W = uGeoA.w;',
    '    float inside = 1.0 - smoothstep(Rr - aa, Rr + aa, r);',
    '    col *= 1.0 - 0.16 * smoothstep(Rr - W * 1.6, Rr, r);',
    '    float ringT = (r - Rr) / W;',
    '    float ringM = smoothstep(Rr - aa, Rr + aa, r) * (1.0 - smoothstep(Rr + W - aa, Rr + W + aa, r));',
    '    float x = clamp(ringT * 2.0 - 1.0, -1.0, 1.0);',
    '    vec2 rd = q / max(r, 0.0001);',
    '    vec3 n = normalize(vec3(rd * x * 0.9, sqrt(max(0.0, 1.0 - x * x)) + 0.1));',
    '    float diff = clamp(dot(n, LDIR) * 0.7 + 0.35, 0.0, 1.2);',
    '    float ang = atan(q.y, q.x);',
    '    vec3 wood = woodAt(q, ang * Rr * 0.25, ringT, toLin(vec3(0.80, 0.62, 0.42)));',
    '    float seam = 1.0 - smoothstep(0.0, 0.05 + aa / W, abs(ringT - 0.42));',
    '    vec3 H = normalize(LDIR + vec3(0.0, 0.0, 1.0));',
    '    float spec = pow(max(dot(n, H), 0.0), 24.0) * 0.18;',
    '    vec3 ringC = wood * diff * (1.0 - 0.45 * seam) + spec;',
    // the brass clasp at the top
    '    vec2 cq = q - vec2(0.0, -(Rr + W * 0.55));',
    '    float clasp = 1.0 - smoothstep(-aa, aa, sdBox(cq, vec2(W * 0.75, W * 0.95)));',
    '    float screw = 1.0 - smoothstep(-aa, aa, sdBox(cq - vec2(0.0, -W * 0.9), vec2(W * 0.28, W * 0.7)));',
    '    vec3 brass = toLin(vec3(0.78, 0.64, 0.36)) * (0.6 + 0.5 * clamp(1.0 - cq.y / W, 0.0, 1.5) * 0.6) + vec3(0.12) * smoothstep(0.3, 0.0, abs(cq.x / W));',
    '    col = mix(col, ringC, ringM);',
    '    col = mix(col, brass, max(clasp, screw));',
    '    a = max(max(inside, ringM), max(clasp, screw));',
    '    float ds = length(q - vec2(0.25, 0.45) * W) - (Rr + W);',
    '    shA = 0.30 * (1.0 - smoothstep(0.0, W * 1.1, ds));',
    '  } else {',
    '    vec2 q = P - uGeoA.xy; vec2 hw = uGeoA.zw;',
    '    float mat = uGeoB.x, mould = uGeoB.y, bev = uGeoB.z;',
    '    float d0 = sdBox(q, hw);',
    '    float d1 = sdBox(q, hw + mat);',
    '    float d2 = sdBox(q, hw + mat + mould);',
    '    vec3 matC = toLin(vec3(0.95, 0.93, 0.88));',
    '    if (d0 < 0.0) {',
    '      col *= 1.0 - 0.38 * (1.0 - smoothstep(0.0, bev * 2.5, -d0)) * step(0.0, -d0);',
    '    } else if (d0 < bev) {',
    '      col = matC * 1.06 * (0.92 + 0.08 * dot(normalize(q), vec2(-0.6, -0.8)));',
    '    } else if (d1 < 0.0) {',
    '      col = matC * (0.97 + 0.03 * vnoise(P * 3.0));',
    '      col *= 1.0 - 0.10 * (1.0 - smoothstep(0.0, mould * 0.35, -d1));',
    '    } else {',
    '      float tt = clamp((d2 + mould) / mould, 0.0, 1.0);',
    '      vec2 ax = abs(q) - (hw + mat);',
    '      float horiz = ax.y > ax.x ? 1.0 : 0.0;',
    '      vec2 out2 = horiz > 0.5 ? vec2(0.0, sign(q.y)) : vec2(sign(q.x), 0.0);',
    '      float prof = sin(tt * 3.1416);',
    '      vec3 n = normalize(vec3(out2 * cos(tt * 3.1416) * 0.9, prof + 0.15));',
    '      float diff = clamp(dot(n, LDIR) * 0.75 + 0.35, 0.0, 1.2);',
    '      float along = horiz > 0.5 ? q.x : q.y;',
    '      vec3 wood = woodAt(q, along * 0.6, tt * 1.5, toLin(vec3(0.42, 0.28, 0.18)));',
    '      float mitre = 1.0 - smoothstep(0.0, aa * 1.5, abs(ax.x - ax.y));',
    '      col = wood * diff * (1.0 - 0.35 * mitre) + vec3(0.05) * pow(max(n.z, 0.0), 12.0);',
    '    }',
    '    a = 1.0 - smoothstep(-aa, aa, d2);',
    '    float ds = sdBox(q - vec2(0.25, 0.4) * mould * 0.5, hw + mat + mould);',
    '    shA = 0.32 * (1.0 - smoothstep(0.0, mould * 0.8, ds));',
    '  }',
    // the corner thumbnail with "you are here"
    '  if (uMini.z > 0.5) {',
    '    vec2 ml = sp - uMini.xy;',
    '    float bd = 2.0;',
    '    if (ml.x > -bd && ml.y > -bd && ml.x < uMini.z + bd && ml.y < uMini.w + bd) {',
    '      vec3 mc = toLin(miniS.rgb);',
    '      if (ml.x < 0.0 || ml.y < 0.0 || ml.x > uMini.z || ml.y > uMini.w) mc = uInk;',
    '      vec2 vr0 = uMiniView.xy / uChart * uMini.zw, vr1 = uMiniView.zw / uChart * uMini.zw;',
    '      float dv = sdBox(ml - (vr0 + vr1) * 0.5, max((vr1 - vr0) * 0.5, vec2(1.5)));',
    '      mc = mix(mc, uAccent, 1.0 - smoothstep(0.6, 1.6, abs(dv)));',
    '      col = mc; a = 1.0;',
    '    }',
    '  }',
    '  vec3 outc = toSrgb(col) * a;',
    '  float outa = a + shA * (1.0 - a);',
    '  if (uBg.w > 0.5) { outc = outc + uBg.rgb * (1.0 - outa); outa = 1.0; }',
    '  gl_FragColor = vec4(outc, outa);',
    '}'
  ].join('\n');

  /* Backstitch, knots and beads: a quad per item, expanded in the vertex shader. */
  var VERT_OVER = [
    'attribute vec4 aSeg;',
    'attribute vec2 aCorner;',
    'attribute vec4 aInfo;',      // palette index, done, kind (0 line, 1 knot, 2 bead), half-width
    'uniform vec2 uViewport;',
    'uniform vec2 uCenter;',
    'uniform float uScale;',
    'varying vec2 vP;',
    'varying vec4 vSeg;',
    'varying vec4 vInfo;',
    'varying float vHw;',
    'void main() {',
    '  vec2 A = aSeg.xy, B = aSeg.zw;',
    '  float px = 1.0 / uScale;',
    '  float hw = aInfo.w * (aInfo.y > 0.5 ? 1.0 : 0.42);',
    '  float hwE = max(hw, 0.6 * px);',
    '  float ext = hwE + 1.5 * px + 0.08;',
    '  vec2 pos;',
    '  if (aInfo.z < 0.5) {',
    '    vec2 D = B - A; float L = length(D);',
    '    vec2 T = L > 0.00001 ? D / L : vec2(1.0, 0.0); vec2 N = vec2(-T.y, T.x);',
    '    pos = A + T * (aCorner.x * L + (aCorner.x * 2.0 - 1.0) * ext) + N * aCorner.y * ext;',
    '  } else {',
    '    pos = A + vec2(aCorner.x * 2.0 - 1.0, aCorner.y) * ext;',
    '  }',
    '  vP = pos; vSeg = aSeg; vHw = hwE;',
    '  vInfo = vec4(aInfo.x, aInfo.y, aInfo.z, hw / hwE);',
    '  vec2 s = (pos - uCenter) * uScale + 0.5 * uViewport;',
    '  gl_Position = vec4(s.x / uViewport.x * 2.0 - 1.0, 1.0 - s.y / uViewport.y * 2.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FRAG_OVER = FRAG_HEAD + '\n' + [
    'uniform sampler2D uPal;',
    'uniform float uPalW;',
    'uniform vec3 uFabric;',
    'uniform float uScale;',
    'uniform vec2 uViewport;',
    'uniform float uGhostBack;',
    'uniform float uShow;',
    'uniform vec4 uMini;',
    'uniform float uFine;',
    'varying vec2 vP;',
    'varying vec4 vSeg;',
    'varying vec4 vInfo;',
    'varying float vHw;',
    'const vec3 LDIR = vec3(-0.4880, -0.5856, 0.6474);',
    'void main() {',
    '  vec2 sp = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y);',
    '  if (uMini.z > 0.5 && sp.x > uMini.x - 2.0 && sp.y > uMini.y - 2.0 && sp.x < uMini.x + uMini.z + 2.0 && sp.y < uMini.y + uMini.w + 2.0) discard;',
    '  float aa = 0.75 / uScale;',
    '  vec4 pc = texture2D(uPal, vec2((vInfo.x + 0.5) / uPalW, 0.25));',
    '  vec3 floss = toLin(pc.rgb);',
    '  float done = vInfo.y;',
    '  float kind = vInfo.z;',
    '  float hw = vHw;',
    '  vec2 so = vec2(0.035, 0.05);',
    '  float cov, scov; vec3 col;',
    '  if (kind < 0.5) {',
    '    vec2 A = vSeg.xy, B = vSeg.zw; vec2 D = B - A; float L = max(length(D), 0.00001);',
    '    vec2 T = D / L; vec2 N = vec2(-T.y, T.x);',
    '    vec2 q = vP - A; float t = clamp(dot(q, T), 0.0, L);',
    '    float d = length(q - T * t) - hw;',
    '    vec2 q2 = vP - so - A; float t2 = clamp(dot(q2, T), 0.0, L);',
    '    float d2 = length(q2 - T * t2) - hw;',
    '    cov = 1.0 - smoothstep(-aa, aa, d);',
    '    scov = (1.0 - smoothstep(-aa, hw * 0.8 + aa, d2)) * 0.35;',
    '    float s = clamp(dot(q, N) / hw, -1.0, 1.0);',
    '    float nz = sqrt(max(0.0, 1.0 - s * s));',
    '    vec3 n = normalize(vec3(N * s, nz));',
    '    float diff = clamp(dot(n, LDIR) * 0.6 + 0.4, 0.0, 1.0);',
    '    float tw = sin((dot(q, T) * 9.0 - s * 0.8) * 6.2832) * uFine;',
    '    vec3 Hh = normalize(LDIR + vec3(0.0, 0.0, 1.0));',
    '    vec3 Tf = normalize(vec3(T * 0.91 + N * 0.41, 0.0));',
    '    float th = dot(Tf, Hh);',
    '    float spec = pow(sqrt(max(0.0, 1.0 - th * th)), 28.0) * 0.22 * nz;',
    '    col = floss * (0.34 + 0.78 * diff) * (1.0 + 0.10 * tw) + vec3(spec);',
    '    if (done < 0.5) { col = mix(uFabric, floss, 0.55); scov = 0.0; }',
    '  } else {',
    '    vec2 q = vP - vSeg.xy; float r = length(q) / hw;',
    '    cov = 1.0 - smoothstep(1.0 - aa / hw, 1.0 + aa / hw, r);',
    '    scov = (1.0 - smoothstep(0.6, 1.2, length(q - so) / hw)) * 0.4;',
    '    float nz = sqrt(max(0.0, 1.0 - min(r * r, 1.0)));',
    '    vec3 n = normalize(vec3(q / hw, nz + 0.05));',
    '    float diff = clamp(dot(n, LDIR) * 0.65 + 0.4, 0.0, 1.1);',
    '    if (kind < 1.5) {',
    '      float wrap = sin(atan(q.y, q.x) * 3.0 + r * 7.0) * 0.5 + 0.5;',
    '      col = floss * (0.30 + 0.80 * diff) * (0.82 + 0.25 * wrap * (0.4 + 0.6 * uFine));',
    '      vec3 Hh = normalize(LDIR + vec3(0.0, 0.0, 1.0));',
    '      col += vec3(pow(max(dot(n, Hh), 0.0), 18.0) * 0.18);',
    '    } else {',
    '      col = floss * (0.25 + 0.7 * diff);',
    '      vec3 Hh = normalize(LDIR + vec3(0.0, 0.0, 1.0));',
    '      col += vec3(pow(max(dot(n, Hh), 0.0), 60.0) * 0.9);',
    '      col *= 0.55 + 0.45 * smoothstep(0.18, 0.32, r);',
    '    }',
    '    if (done < 0.5) {',
    '      col = mix(uFabric, floss, 0.6);',
    '      cov *= smoothstep(0.55 - aa / hw, 0.62 + aa / hw, r);',
    '      scov = 0.0;',
    '    }',
    '  }',
    '  float vis = done > 0.5 ? uShow : uGhostBack;',
    '  cov *= vis * vInfo.w;',
    '  scov *= vis * vInfo.w;',
    '  float a = cov + scov * (1.0 - cov);',
    '  gl_FragColor = vec4(toSrgb(col) * cov, a);',
    '}'
  ].join('\n');

  /* ============================================================= GL core */

  function createGL(canvas, preserve) {
    var attrs = {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: !!preserve, powerPreference: 'default', failIfMajorPerformanceCaveat: false
    };
    try { return canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs); }
    catch (e) { return null; }
  }

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      var log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('XSRender shader: ' + log);
    }
    return s;
  }

  /* Compiling and linking are split so a driver with KHR_parallel_shader_compile
     can do it off the main thread: the first compile in a fresh GPU process
     took ~1.4 s on this machine (D3D via ANGLE), warm ones ~35 ms. */
  function programStart(gl, vsrc, fsrc, attribs, uniforms) {
    var vs = gl.createShader(gl.VERTEX_SHADER), fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(vs, vsrc); gl.compileShader(vs);
    gl.shaderSource(fs, fsrc); gl.compileShader(fs);
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    for (var i = 0; i < attribs.length; i++) gl.bindAttribLocation(p, i, attribs[i]);
    gl.linkProgram(p);
    return { p: p, vs: vs, fs: fs, uniforms: uniforms, u: null };
  }

  function programReady(gl, pr, ext) {
    return !ext || !!gl.getProgramParameter(pr.p, ext.COMPLETION_STATUS_KHR);
  }

  function programFinish(gl, pr) {
    if (!gl.getProgramParameter(pr.p, gl.LINK_STATUS) && !gl.isContextLost()) {
      var log = gl.getShaderInfoLog(pr.fs) || gl.getShaderInfoLog(pr.vs) || gl.getProgramInfoLog(pr.p);
      throw new Error('XSRender shader: ' + log);
    }
    gl.deleteShader(pr.vs); gl.deleteShader(pr.fs);
    var u = {};
    for (var k = 0; k < pr.uniforms.length; k++) u[pr.uniforms[k]] = gl.getUniformLocation(pr.p, pr.uniforms[k]);
    pr.u = u;
    return pr;
  }

  var MAIN_UNIFORMS = ['uCells', 'uParts', 'uPal', 'uLod', 'uGlyph', 'uChart', 'uLodSize', 'uPalW', 'uGlyphGrid',
    'uViewport', 'uCenter', 'uScale', 'uFabric', 'uWeave', 'uCountK', 'uGhost', 'uSymbols', 'uInk', 'uReveal',
    'uRankScale', 'uGrowWin', 'uNew', 'uNext', 'uBlock', 'uDim', 'uMini', 'uMiniView', 'uFrame', 'uGeoA', 'uGeoB',
    'uAccent', 'uBg', 'uEye', 'uDetail', 'uWeaveK', 'uFine', 'uHasParts'];
  var LOD_UNIFORMS = ['uCells', 'uParts', 'uPal', 'uChart', 'uPalW', 'uFabric', 'uGhost', 'uReveal', 'uRankScale',
    'uCountK', 'uHasParts'];
  var OVER_UNIFORMS = ['uViewport', 'uCenter', 'uScale', 'uPal', 'uPalW', 'uFabric', 'uGhostBack', 'uShow', 'uMini', 'uFine'];

  function pot(n) { var p = 1; while (p < n) p <<= 1; return p; }

  function dataTex(gl, w, h, bytes, filter) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** Symbol atlas: palette symbols drawn white-on-transparent, 16 a row. */
  function glyphAtlas(palette) {
    var n = Math.min(GLYPH_MAX, Math.max(1, palette.length));
    var rows = Math.ceil(n / GLYPH_COLS);
    var c = document.createElement('canvas');
    c.width = GLYPH_COLS * GLYPH_PX; c.height = rows * GLYPH_PX;
    var g = c.getContext('2d');
    if (g) {
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = Math.round(GLYPH_PX * 0.72) + 'px system-ui, "Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols 2", sans-serif';
      for (var i = 0; i < n; i++) {
        var s = palette[i] && palette[i].symbol;
        if (!s) continue;
        g.fillText(String(s), (i % GLYPH_COLS + 0.5) * GLYPH_PX, (Math.floor(i / GLYPH_COLS) + 0.53) * GLYPH_PX);
      }
    }
    return { canvas: c, cols: GLYPH_COLS, rows: rows };
  }

  /* ---- the live-context registry (as js/diagram.js keeps for the 3D) ---- */
  var LIVE = [];
  function attached(c) {
    if (!c) return false;
    if (typeof c.isConnected === 'boolean') return c.isConnected;
    var d = c.ownerDocument;
    return !!(d && d.body && d.body.contains(c));
  }
  function reap(keep) {
    var i, rec;
    for (i = LIVE.length - 1; i >= 0; i--) {
      rec = LIVE[i];
      if (rec === keep || rec.offscreen) continue;
      if (rec.dead || !attached(rec.canvas)) {
        LIVE.splice(i, 1);
        try { rec.release('detached'); } catch (e) { /* ignore */ }
      }
    }
    while (LIVE.length > MAX_LIVE) {
      // the shared off-screen picture context goes first: it is cheap to remake
      var at = -1;
      for (i = 0; i < LIVE.length; i++) { if (LIVE[i] !== keep && LIVE[i].offscreen) { at = i; break; } }
      if (at < 0) for (i = 0; i < LIVE.length; i++) { if (LIVE[i] !== keep) { at = i; break; } }
      if (at < 0) break;
      rec = LIVE.splice(at, 1)[0];
      try { rec.release('evicted'); } catch (e2) { /* ignore */ }
    }
  }
  function unregister(rec) { var i = LIVE.indexOf(rec); if (i >= 0) LIVE.splice(i, 1); }

  /* ---- theme ---- */
  function readTheme(override) {
    var t = { accent: [210, 60, 60], bg: [255, 255, 255], text: [34, 34, 34], surface: [255, 255, 255] };
    var cs = null;
    try { cs = global.getComputedStyle && global.document ? global.getComputedStyle(global.document.documentElement) : null; }
    catch (e) { cs = null; }
    function v(name) { return cs ? parseColor((cs.getPropertyValue(name) || '').trim()) : null; }
    t.accent = v('--primary') || v('--accent') || t.accent;
    t.bg = v('--bg') || v('--surface') || t.bg;
    t.surface = v('--surface') || t.bg;
    t.text = v('--text') || t.text;
    if (isObj(override)) {
      if (parseColor(override.accent)) t.accent = parseColor(override.accent);
      if (parseColor(override.bg)) t.bg = parseColor(override.bg);
      if (parseColor(override.text)) t.text = parseColor(override.text);
      if (parseColor(override.surface)) t.surface = parseColor(override.surface);
    }
    return t;
  }

  /* ================================================================ mount */

  function mount(canvas, options) {
    if (!canvas) throw new Error('XSRender.mount: canvas required');
    var o = options || {};
    var t0 = now();

    var st = {
      mountT0: t0,
      canvas: canvas,
      m: model(null),
      mode: o.view === 'loupe' || o.view === 'free' ? o.view : 'fit',
      frame: o.frame === 'hoop' || o.frame === 'frame' ? o.frame : 'none',
      ghost: o.ghost == null ? 0.22 : clamp(num(o.ghost, 0.22), 0, 1),
      symbols: !!o.symbols,
      ghostBack: o.ghostBack !== false,
      interactive: !!o.interactive,
      reducedMotion: o.reducedMotion == null ? prefersReduced() : !!o.reducedMotion,
      background: o.background || 'transparent',
      themeOverride: o.theme || null,
      theme: null,
      minimap: o.minimap !== false,
      stitchPx: clamp(num(o.stitchPx, 12), 4, 64),
      insets: o.safeInsets || {},
      fixedSize: o.size ? { w: o.size.w || o.size, h: o.size.h || o.size } : null,
      onStatus: typeof o.onStatus === 'function' ? o.onStatus : null,
      onTap: typeof o.onTap === 'function' ? o.onTap : null,
      onView: typeof o.onView === 'function' ? o.onView : null,
      offscreen: !!o.offscreen,
      w: 0, h: 0, dpr: 1,
      view: { cx: 0, cy: 0, scale: 1 },
      tween: null,
      vel: null,
      loupe: { x: 0, y: 0, next: null },
      block: null,
      rank: null, rankScale: 1, rankCount: 0, rankFallback: false, rankLabel: '',
      reveal: null,
      newAnim: null,
      pulseUntil: 0,
      gl: null, prog: null, prog2d: null, lost: false, status: 'init', destroyed: false,
      tex: {}, fbo: null, lodSize: [1, 1], glyph: null,
      cellBytes: null, partBytes: null, dirtyRows: null, partDirty: false, palDirty: false,
      lodDirty: true, overBuf: null, overData: null, overCount: 0, overDirty: false,
      rafId: 0, lastT: 0,
      g2d: null, thumb: null, thumbImg: null, sprites: null, spriteSize: 0,
      stats: { frameMs: 0, cpuMs: 0, mountMs: 0, lastUpdateMs: 0, uploadMs: 0, frames: 0, textureBytes: 0 },
      deltaAcc: 0, deltaN: 0, prevFrameT: 0
    };
    var tl0 = now();
    st.theme = readTheme(st.themeOverride);
    st.stats.layoutMs = now() - tl0;

    var handle = null;
    var liveRec = { canvas: canvas, dead: false, offscreen: st.offscreen, release: releaseContext };

    function report(status) {
      if (st.status === status) return;
      st.status = status;
      if (st.onStatus) {
        try { st.onStatus({ webgl: !!st.gl, status: status, message: STATUS_MSG[status] || '' }); }
        catch (e) { /* a host that throws must not stop the renderer */ }
      }
    }

    /* ---------------------------------------------------------- GL setup */
    function initGL() {
      var tg = now();
      var gl = createGL(canvas, st.offscreen);
      st.stats.contextMs = now() - tg;
      var tp = now();
      if (!gl) return false;
      var par = null;
      try { par = gl.getExtension('KHR_parallel_shader_compile'); } catch (e0) { par = null; }
      st.compileT0 = now();
      st.prog = programStart(gl, VERT_QUAD, FRAG_MAIN, ['aPos'], MAIN_UNIFORMS);
      st.progLod = programStart(gl, VERT_QUAD, FRAG_LOD, ['aPos'], LOD_UNIFORMS);
      st.progOver = programStart(gl, VERT_OVER, FRAG_OVER, ['aSeg', 'aCorner', 'aInfo'], OVER_UNIFORMS);
      st.parExt = par;
      st.stats.startCompileMs = now() - tp;
      st.pending = true;
      st.gl = gl;
      if (!par && !finishPrograms()) { st.gl = null; return false; }
      st.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
      var vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      st.maxViewport = vp ? Math.min(vp[0], vp[1]) : 4096;
      st.quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, st.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      st.tex = {};
      st.overBuf = gl.createBuffer();
      uploadAll();
      return true;
    }

    /** true = programs ready, null = still compiling in parallel, false = broken.
        `force` waits for the driver (the off-screen picture and snapshots need a frame now). */
    function finishPrograms(force) {
      var gl = st.gl;
      if (!st.pending) return true;
      if (!gl) return false;
      if (!force && st.parExt && !(programReady(gl, st.prog, st.parExt) && programReady(gl, st.progLod, st.parExt) &&
          programReady(gl, st.progOver, st.parExt))) return null;
      try {
        programFinish(gl, st.prog); programFinish(gl, st.progLod); programFinish(gl, st.progOver);
      } catch (e) {
        if (global.console) global.console.error(e);
        st.pending = false; st.broken = true;
        report('unavailable');
        return false;
      }
      st.pending = false;
      st.stats.compileMs = now() - st.compileT0;
      return true;
    }

    function freeTextures() {
      var gl = st.gl;
      if (!gl) return;
      for (var k in st.tex) if (st.tex.hasOwnProperty(k) && st.tex[k]) { try { gl.deleteTexture(st.tex[k]); } catch (e) { /* ignore */ } }
      st.tex = {};
      if (st.fbo) { try { gl.deleteFramebuffer(st.fbo); } catch (e) { /* ignore */ } st.fbo = null; }
    }

    /** Every texture and buffer from the CPU copies (model change, restore). */
    function uploadAll() {
      var gl = st.gl;
      if (!gl) return;
      var m = st.m;
      var tu = now();
      freeTextures();
      var w = Math.max(1, m.w), h = Math.max(1, m.h);
      if (w > st.maxTex || h > st.maxTex) {
        report('unavailable');
      }
      st.tex.cells = dataTex(gl, w, h, st.cellBytes && m.w ? st.cellBytes : new Uint8Array(w * h * 4));
      st.tex.parts = st.partBytes ? dataTex(gl, w, h, st.partBytes) : dataTex(gl, 1, 1, new Uint8Array(4));
      var palB = packPalette(m);
      st.palW = Math.max(1, m.palette.length);
      st.tex.pal = dataTex(gl, st.palW, 2, palB);
      st.glyph = glyphAtlas(m.palette);
      st.tex.glyph = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, st.tex.glyph);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, st.glyph.canvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // the far-zoom colour image: power of two so it can be mipmapped
      var pw = Math.min(pot(w), st.maxTex), ph = Math.min(pot(h), st.maxTex);
      st.lodSize = [pw, ph];
      st.tex.lod = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, st.tex.lod);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, pw, ph, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.generateMipmap(gl.TEXTURE_2D);
      st.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, st.tex.lod, 0);
      var fab = lin(m.fabric.rgb);
      gl.clearColor(Math.sqrt(fab[0] * 0.86), Math.sqrt(fab[1] * 0.86), Math.sqrt(fab[2] * 0.86), 1);
      gl.viewport(0, 0, pw, ph);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      st.stats.textureBytes = w * h * 4 + (st.partBytes ? w * h * 4 : 4) + st.palW * 8 +
        st.glyph.canvas.width * st.glyph.canvas.height * 4 + Math.round(pw * ph * 4 * 4 / 3);
      // backstitch / knot buffer
      gl.bindBuffer(gl.ARRAY_BUFFER, st.overBuf);
      gl.bufferData(gl.ARRAY_BUFFER, st.overData || new Float32Array(10), gl.DYNAMIC_DRAW);
      st.overDirty = false;
      st.dirtyRows = null; st.partDirty = false; st.palDirty = false;
      st.lodDirty = true;
      st.stats.uploadMs = now() - tu;
    }

    /* ---------------------------------------------------- model plumbing */
    var FLOATS = 10, VPI = 6; // floats per vertex, vertices per item
    var CORNERS = [[0, -1], [1, -1], [0, 1], [0, 1], [1, -1], [1, 1]];

    function overHw(kind, e) {
      var cpiK = clamp(Math.sqrt(14 / (st.m.fabric.count / st.m.fabric.over)), 0.8, 1.25);
      if (kind === 0) return clamp((0.05 + 0.045 * (e ? e.bsStrands : 1)) * cpiK, 0.05, 0.22);
      if (kind === 2) return 0.24;
      return clamp(0.2 + 0.03 * (e ? e.strands : 2), 0.2, 0.36);
    }

    function buildOverlay() {
      var m = st.m, back = m.back, knots = m.knots;
      var n = back.length + knots.length;
      st.overCount = n;
      if (!n) { st.overData = null; return; }
      var d = new Float32Array(n * VPI * FLOATS);
      var k = 0, i, j, o;
      for (i = 0; i < back.length; i++, k++) {
        var b = back[i] || {};
        var e = m.palette[b.i];
        var hw = overHw(0, e);
        var dn = bitOf(m.doneBack, i);
        for (j = 0; j < VPI; j++) {
          o = (k * VPI + j) * FLOATS;
          d[o] = num(b.x1, 0); d[o + 1] = num(b.y1, 0); d[o + 2] = num(b.x2, 0); d[o + 3] = num(b.y2, 0);
          d[o + 4] = CORNERS[j][0]; d[o + 5] = CORNERS[j][1];
          d[o + 6] = clamp(b.i | 0, 0, 4095); d[o + 7] = dn; d[o + 8] = 0; d[o + 9] = hw;
        }
      }
      for (i = 0; i < knots.length; i++, k++) {
        var kn = knots[i] || {};
        var ke = m.palette[kn.i];
        var kind = kn.t === 'bead' || (ke && ke.kind === 'bead') ? 2 : 1;
        var hw2 = overHw(kind, ke);
        var dn2 = bitOf(m.doneKnots, i);
        for (j = 0; j < VPI; j++) {
          o = (k * VPI + j) * FLOATS;
          d[o] = num(kn.x, 0); d[o + 1] = num(kn.y, 0); d[o + 2] = d[o]; d[o + 3] = d[o + 1];
          d[o + 4] = CORNERS[j][0]; d[o + 5] = CORNERS[j][1];
          d[o + 6] = clamp(kn.i | 0, 0, 4095); d[o + 7] = dn2; d[o + 8] = kind; d[o + 9] = hw2;
        }
      }
      st.overData = d;
    }

    function setModel(src, opt) {
      if (st.destroyed) return;
      var tm = now();
      st.m = model(src);
      var m = st.m;
      if (st.rankOrder && st.rankOrder.length) applyOrder(st.rankOrder, true);
      else { st.rank = null; st.rankScale = 1; st.rankCount = 0; }
      st.cellBytes = m.w ? packCells(m, st.rank) : null;
      st.partBytes = m.w ? packParts(m) : null;
      buildOverlay();
      st.thumb = null; st.sprites = null;
      if (st.gl) uploadAll();
      st.stats.lastSetModelMs = now() - tm;
      if (!(opt && opt.keepView) || !st.w) applyView(false);
      kick();
    }

    /* ---- the tap path: one texel, the rows it is in ---- */
    function markRows(y0, y1) {
      if (!st.dirtyRows) st.dirtyRows = [y0, y1];
      else { if (y0 < st.dirtyRows[0]) st.dirtyRows[0] = y0; if (y1 > st.dirtyRows[1]) st.dirtyRows[1] = y1; }
      st.lodDirty = true;
    }

    function writeDone(i, on) {
      var m = st.m;
      if (on) m.done[i >> 3] |= 1 << (i & 7); else m.done[i >> 3] &= ~(1 << (i & 7));
      if (st.cellBytes) {
        var o = (i << 2) + 1;
        if (on) st.cellBytes[o] |= 16; else st.cellBytes[o] &= ~16;
      }
      if (st.thumbImg) paintThumb(i);
    }

    function setDone(i, on, opt) {
      var tu = now();
      var m = st.m, n = m.w * m.h;
      i = i | 0;
      if (i < 0 || i >= n) return;
      writeDone(i, !!on);
      var y = (i / m.w) | 0;
      markRows(y, y);
      if (on && (!opt || opt.animate !== false) && !st.reducedMotion) {
        st.newAnim = { x: i % m.w, y: y, t0: now() };
      }
      st.pulseUntil = now() + PULSE_MS;
      if (st.gl) flushNow();
      st.stats.lastUpdateMs = now() - tu;
      kick();
    }

    function setDoneMany(list, on) {
      var tu = now();
      var m = st.m, n = m.w * m.h;
      if (!list || !list.length) return;
      var y0 = Infinity, y1 = -1;
      for (var k = 0; k < list.length; k++) {
        var i = list[k] | 0;
        if (i < 0 || i >= n) continue;
        writeDone(i, !!on);
        var y = (i / m.w) | 0;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      if (y1 >= 0) markRows(y0, y1);
      if (st.gl) flushNow();
      st.stats.lastUpdateMs = now() - tu;
      kick();
    }

    function setProgress(bytes) {
      var tu = now();
      var m = st.m, n = m.w * m.h;
      if (!(bytes instanceof Uint8Array)) return;
      var need = Math.ceil(n / 8);
      // adopted by reference, like setModel's `done`, so the host's live bitmap and ours stay one
      var d = bytes;
      if (d.length < need) { d = new Uint8Array(need); d.set(bytes); }
      m.done = d;
      if (st.cellBytes) {
        var cb = st.cellBytes;
        for (var i = 0; i < n; i++) {
          var o = (i << 2) + 1;
          if ((d[i >> 3] >> (i & 7)) & 1) cb[o] |= 16; else cb[o] &= ~16;
        }
      }
      st.thumb = null;
      if (n) markRows(0, m.h - 1);
      if (st.gl) flushNow();
      st.stats.lastUpdateMs = now() - tu;
      kick();
    }

    function setLayerDone(layer, i, on) {
      var m = st.m;
      i = i | 0;
      var bits, list;
      if (layer === 'back') { bits = m.doneBack; list = m.back; }
      else if (layer === 'knots' || layer === 'knot') { bits = m.doneKnots; list = m.knots; }
      else if (layer === 'part') { bits = m.donePart; list = m.part; }
      else return;
      if (i < 0 || i >= list.length) return;
      if (on) bits[i >> 3] |= 1 << (i & 7); else bits[i >> 3] &= ~(1 << (i & 7));
      if (layer === 'part') {
        var p = list[i];
        if (st.partBytes && p && p.x >= 0 && p.y >= 0 && p.x < m.w && p.y < m.h) {
          var o = ((p.y | 0) * m.w + (p.x | 0)) * 4 + 3;
          if (on) st.partBytes[o] |= 4; else st.partBytes[o] &= ~4;
          st.partDirty = true; st.lodDirty = true;
        }
      } else if (st.overData) {
        var item = layer === 'back' ? i : m.back.length + i;
        for (var j = 0; j < VPI; j++) st.overData[(item * VPI + j) * FLOATS + 7] = on ? 1 : 0;
        st.overDirty = item;
      }
      if (st.gl) flushNow();
      kick();
    }

    /** Push pending CPU changes to the GPU (called on the tap path and per frame). */
    function flushNow() {
      var gl = st.gl;
      if (!gl || st.lost) return;
      var m = st.m;
      if (st.dirtyRows && st.cellBytes) {
        var y0 = st.dirtyRows[0], y1 = st.dirtyRows[1];
        gl.bindTexture(gl.TEXTURE_2D, st.tex.cells);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, m.w, y1 - y0 + 1, gl.RGBA, gl.UNSIGNED_BYTE,
          st.cellBytes.subarray(y0 * m.w * 4, (y1 + 1) * m.w * 4));
        st.dirtyRows = null;
      }
      if (st.partDirty && st.partBytes) {
        gl.bindTexture(gl.TEXTURE_2D, st.tex.parts);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, m.w, m.h, gl.RGBA, gl.UNSIGNED_BYTE, st.partBytes);
        st.partDirty = false;
      }
      if (st.overDirty !== false && st.overData) {
        gl.bindBuffer(gl.ARRAY_BUFFER, st.overBuf);
        if (st.overDirty === true) gl.bufferData(gl.ARRAY_BUFFER, st.overData, gl.DYNAMIC_DRAW);
        else {
          var off = st.overDirty * VPI * FLOATS;
          gl.bufferSubData(gl.ARRAY_BUFFER, off * 4, st.overData.subarray(off, off + VPI * FLOATS));
        }
        st.overDirty = false;
      }
    }

    /* ---- time-lapse ---- */
    function applyOrder(order, quiet) {
      var m = st.m, n = m.w * m.h;
      var ro = replayOrder(m, order);
      var r = rankOf(ro.order, n);
      st.rank = r.rank; st.rankScale = r.scale; st.rankCount = r.count;
      st.rankFallback = ro.fallback; st.rankLabel = ro.label; st.rankBefore = ro.before;
      if (!quiet && st.cellBytes) {
        var cb = st.cellBytes;
        for (var i = 0; i < n; i++) { var o = i << 2; cb[o + 2] = (r.rank[i] >> 8) & 255; cb[o + 3] = r.rank[i] & 255; }
        if (n) markRows(0, m.h - 1);
        if (st.gl) flushNow();
      }
      return ro;
    }

    function setOrder(order) {
      st.rankOrder = order && order.length ? order : null;
      var ro = applyOrder(st.rankOrder, false);
      kick();
      return { fallback: ro.fallback, label: ro.label, count: ro.order.length, before: ro.before };
    }

    function setReveal(f) {
      if (f == null || f === false) st.reveal = null;
      else {
        if (!st.rank) applyOrder(st.rankOrder, false);
        st.reveal = clamp(+f || 0, 0, 1);
      }
      st.lodDirty = true;
      st.thumb = null;
      kick();
    }

    /* ---------------------------------------------------------- views */
    function vp() { return { vw: st.w, vh: st.h }; }

    function insetsPx() {
      var d = st.dpr, s = st.insets || {};
      return { left: num(s.left, 0) * d, right: num(s.right, 0) * d, top: num(s.top, 0) * d, bottom: num(s.bottom, 0) * d };
    }

    function targetView() {
      var m = st.m;
      if (!st.w || !m.w) return { cx: m.w / 2, cy: m.h / 2, scale: 1 };
      if (st.mode === 'loupe') {
        var win = loupeWindow(m.w, m.h, st.loupe.x, st.loupe.y, {});
        st.block = win;
        return loupeView(win, st.w, st.h, st.stitchPx * st.dpr, insetsPx());
      }
      st.block = null;
      return fitView(m.w, m.h, st.w, st.h, { frame: st.mode === 'fit' ? st.frame : 'none', fabric: m.fabric, insets: insetsPx() });
    }

    function applyView(animate) {
      var to = targetView();
      if (st.mode === 'free' && st.freeSet) return;
      if (animate && !st.reducedMotion && st.w) {
        st.tween = { from: { cx: st.view.cx, cy: st.view.cy, scale: st.view.scale }, to: to, t0: now(), dur: 220 };
      } else {
        st.tween = null;
        st.view = to;
      }
      kick();
    }

    function setView(v) {
      v = v || {};
      if (v.mode === 'fit' || v.mode === 'loupe' || v.mode === 'free') {
        if (v.mode !== st.mode) st.freeSet = false;
        st.mode = v.mode;
      }
      if (v.x != null) st.loupe.x = v.x | 0;
      if (v.y != null) st.loupe.y = v.y | 0;
      if (v.next !== undefined) st.loupe.next = v.next;
      if (st.mode === 'free' && v.scale != null) {
        st.view = { cx: num(v.cx, st.view.cx), cy: num(v.cy, st.view.cy), scale: num(v.scale, st.view.scale) };
        st.freeSet = true;
        kick();
        return;
      }
      applyView(v.animate !== false);
    }

    function setLoupe(l) {
      l = l || {};
      var m = st.m;
      var prev = st.mode === 'loupe' ? loupeWindow(m.w, m.h, st.loupe.x, st.loupe.y, {}) : null;
      if (l.x != null) st.loupe.x = l.x | 0;
      if (l.y != null) st.loupe.y = l.y | 0;
      if (l.next !== undefined) st.loupe.next = l.next;
      if (l.symbols != null) st.symbols = !!l.symbols;
      st.pulseUntil = now() + PULSE_MS;
      st.mode = 'loupe';
      var cur = loupeWindow(m.w, m.h, st.loupe.x, st.loupe.y, {});
      if (!prev || prev.bx !== cur.bx || prev.by !== cur.by) applyView(!!prev);
      else kick();
    }

    function resetView() { st.freeSet = false; st.vel = null; applyView(true); if (st.onView) st.onView(getView()); }

    function getView() {
      return { mode: st.mode, cx: st.view.cx, cy: st.view.cy, scale: st.view.scale, vw: st.w, vh: st.h, dpr: st.dpr };
    }

    function clampFree() {
      var m = st.m;
      var fit = fitView(m.w, m.h, st.w, st.h, { frame: 'none', fabric: m.fabric });
      var minS = fit.scale * 0.6, maxS = 80 * st.dpr;
      st.view.scale = clamp(st.view.scale, minS, Math.max(minS, maxS));
      var mg = Math.max(4, 0.1 * Math.max(m.w, m.h));
      st.view.cx = clamp(st.view.cx, -mg, m.w + mg);
      st.view.cy = clamp(st.view.cy, -mg, m.h + mg);
    }

    function panBy(dxCss, dyCss) {
      if (st.mode !== 'free') { st.mode = 'free'; }
      st.freeSet = true;
      st.view.cx -= dxCss * st.dpr / st.view.scale;
      st.view.cy -= dyCss * st.dpr / st.view.scale;
      clampFree();
      kick();
    }

    function zoomBy(f, cssX, cssY) {
      if (st.mode !== 'free') { st.mode = 'free'; }
      st.freeSet = true;
      var sx = cssX == null ? st.w / 2 : cssX * st.dpr, sy = cssY == null ? st.h / 2 : cssY * st.dpr;
      var before = hitTest(viewObj(), sx, sy, st.m.w, st.m.h);
      st.view.scale *= f;
      clampFree();
      var after = hitTest(viewObj(), sx, sy, st.m.w, st.m.h);
      st.view.cx += before.wx - after.wx;
      st.view.cy += before.wy - after.wy;
      clampFree();
      kick();
    }

    function viewObj() { return { cx: st.view.cx, cy: st.view.cy, scale: st.view.scale, vw: st.w, vh: st.h }; }

    function hit(clientX, clientY) {
      var r = canvas.getBoundingClientRect();
      var sx = (clientX - r.left) * (st.w / Math.max(1, r.width));
      var sy = (clientY - r.top) * (st.h / Math.max(1, r.height));
      return hitTest(viewObj(), sx, sy, st.m.w, st.m.h);
    }

    /* --------------------------------------------------------- uniforms */
    function decor() {
      var m = st.m;
      return decorGeo(m.w, m.h, st.mode === 'fit' ? st.frame : 'none', m.fabric);
    }

    function drawGL(t, force) {
      var gl = st.gl;
      var m = st.m;
      if (!gl || st.lost || st.broken) return false;
      if (st.pending) {
        var ready = finishPrograms(force);
        if (ready !== true) { if (ready === null) { global.setTimeout(kick, 16); } return false; }
        if (!st.firstFrameMs) st.firstFrameMs = now() - st.mountT0;
      }
      flushNow();
      var revealU = -1;
      var win = growWindow(st.rankCount);
      if (st.reveal != null) revealU = st.reveal * (1 + win);
      var fabL = lin(m.fabric.rgb);
      var countK = clamp(Math.sqrt(14 / (m.fabric.count / m.fabric.over)), 0.8, 1.25);
      var weave = m.fabric.kind === 'linen' ? 2 : (m.fabric.kind === 'evenweave' || m.fabric.over === 2 ? 1 : 0);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);

      // 1. the far-zoom colour image, only when something in it changed
      if (st.lodDirty && m.w) {
        var pl = st.progLod;
        gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbo);
        gl.viewport(0, 0, m.w, m.h);
        gl.useProgram(pl.p);
        bindTex(0, st.tex.cells, pl.u.uCells);
        bindTex(1, st.tex.parts, pl.u.uParts);
        bindTex(2, st.tex.pal, pl.u.uPal);
        gl.uniform2f(pl.u.uChart, m.w, m.h);
        gl.uniform1f(pl.u.uPalW, st.palW);
        gl.uniform3f(pl.u.uFabric, fabL[0], fabL[1], fabL[2]);
        gl.uniform1f(pl.u.uGhost, st.ghost);
        gl.uniform1f(pl.u.uReveal, st.reveal != null ? st.reveal : -1);
        gl.uniform1f(pl.u.uRankScale, st.rankScale);
        gl.uniform1f(pl.u.uCountK, countK);
        gl.uniform1f(pl.u.uHasParts, st.partBytes ? 1 : 0);
        quad();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, st.tex.lod);
        gl.generateMipmap(gl.TEXTURE_2D);
        st.lodDirty = false;
      }

      // 2. the cloth and the crosses
      gl.viewport(0, 0, st.w, st.h);
      var bgOn = st.background !== 'transparent';
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      var p = st.prog;
      gl.useProgram(p.p);
      bindTex(0, st.tex.cells, p.u.uCells);
      bindTex(1, st.tex.parts, p.u.uParts);
      bindTex(2, st.tex.pal, p.u.uPal);
      bindTex(3, st.tex.lod, p.u.uLod);
      bindTex(4, st.tex.glyph, p.u.uGlyph);
      var v = st.view, lod = lodFor(v.scale);
      gl.uniform2f(p.u.uChart, Math.max(1, m.w), Math.max(1, m.h));
      gl.uniform2f(p.u.uLodSize, st.lodSize[0], st.lodSize[1]);
      gl.uniform1f(p.u.uPalW, st.palW);
      gl.uniform2f(p.u.uGlyphGrid, st.glyph.cols, st.glyph.rows);
      gl.uniform2f(p.u.uViewport, st.w, st.h);
      gl.uniform2f(p.u.uCenter, v.cx, v.cy);
      gl.uniform1f(p.u.uScale, v.scale);
      gl.uniform3f(p.u.uFabric, fabL[0], fabL[1], fabL[2]);
      gl.uniform1f(p.u.uWeave, weave);
      gl.uniform1f(p.u.uCountK, countK);
      gl.uniform1f(p.u.uGhost, st.ghost);
      var symK = st.symbols ? smooth(9, 14, v.scale) : 0;
      gl.uniform1f(p.u.uSymbols, symK);
      var ink = luma(m.fabric.rgb) > 0.5 ? [0.02, 0.02, 0.03] : [0.92, 0.92, 0.9];
      gl.uniform3f(p.u.uInk, ink[0], ink[1], ink[2]);
      gl.uniform1f(p.u.uReveal, revealU);
      gl.uniform1f(p.u.uRankScale, st.rankScale);
      gl.uniform1f(p.u.uGrowWin, win);
      var na = st.newAnim;
      var nt = -1;
      if (na) { nt = (t - na.t0) / NEW_MS; if (nt >= 1) { st.newAnim = null; nt = -1; } }
      gl.uniform3f(p.u.uNew, na ? na.x : -9, na ? na.y : -9, nt);
      var nx = st.loupe.next;
      var pulse = t < st.pulseUntil && !st.reducedMotion ? 0.5 + 0.5 * Math.cos((t % 1200) / 1200 * Math.PI * 2) : 1;
      gl.uniform4f(p.u.uNext, nx ? nx.x : -9, nx ? nx.y : -9, pulse, nx && st.mode !== 'fit' ? 1 : (nx && st.showNextInFit ? 1 : 0));
      var b = st.mode === 'loupe' && st.block ? st.block : null;
      if (b && (b.bw >= m.w && b.bh >= m.h)) b = null;
      gl.uniform4f(p.u.uBlock, b ? b.bx0 : 0, b ? b.by0 : 0, b ? b.bx1 : -1, b ? b.by1 : -1);
      gl.uniform1f(p.u.uDim, b ? 1 : 0);
      var mini = miniRect();
      gl.uniform4f(p.u.uMini, mini ? mini.x : 0, mini ? mini.y : 0, mini ? mini.w : 0, mini ? mini.h : 0);
      if (mini) {
        var x0 = v.cx - st.w / 2 / v.scale, y0 = v.cy - st.h / 2 / v.scale;
        gl.uniform4f(p.u.uMiniView, x0, y0, x0 + st.w / v.scale, y0 + st.h / v.scale);
      } else gl.uniform4f(p.u.uMiniView, 0, 0, 0, 0);
      var g = decor();
      gl.uniform4f(p.u.uFrame, g.kind, g.kind === 0 ? g.margin : 0, 0, 0);
      if (g.kind === 1) { gl.uniform4f(p.u.uGeoA, g.cx, g.cy, g.R, g.W); gl.uniform4f(p.u.uGeoB, 0, 0, 0, 0); }
      else if (g.kind === 2) { gl.uniform4f(p.u.uGeoA, g.cx, g.cy, g.hx, g.hy); gl.uniform4f(p.u.uGeoB, g.mat, g.mould, g.bevel, 0); }
      else { gl.uniform4f(p.u.uGeoA, 0, 0, 0, 0); gl.uniform4f(p.u.uGeoB, 0, 0, 0, 0); }
      var acc = lin(st.theme.accent);
      gl.uniform3f(p.u.uAccent, acc[0], acc[1], acc[2]);
      var bg = bgOn ? (st.background === 'theme' ? st.theme.bg : (parseColor(st.background) || st.theme.bg)) : [0, 0, 0];
      gl.uniform4f(p.u.uBg, bg[0] / 255, bg[1] / 255, bg[2] / 255, bgOn ? 1 : 0);
      var span = Math.sqrt(st.w * st.w + st.h * st.h) / v.scale;
      gl.uniform3f(p.u.uEye, v.cx - 0.15 * span, v.cy - 0.25 * span, 1.1 * span);
      gl.uniform1f(p.u.uDetail, lod.detail);
      var evenK = weave > 0 ? smooth(5, 13, v.scale) : lod.weave;
      gl.uniform1f(p.u.uWeaveK, evenK);
      gl.uniform1f(p.u.uFine, lod.fine);
      gl.uniform1f(p.u.uHasParts, st.partBytes ? 1 : 0);
      quad();

      // 3. backstitch, knots, beads
      if (st.overCount && st.overData) {
        var q = st.progOver;
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(q.p);
        bindTex(2, st.tex.pal, q.u.uPal);
        gl.uniform1f(q.u.uPalW, st.palW);
        gl.uniform2f(q.u.uViewport, st.w, st.h);
        gl.uniform2f(q.u.uCenter, v.cx, v.cy);
        gl.uniform1f(q.u.uScale, v.scale);
        gl.uniform3f(q.u.uFabric, fabL[0] * 0.86, fabL[1] * 0.86, fabL[2] * 0.86);
        var show = st.reveal != null ? smooth(0.96, 1.0, st.reveal) : 1;
        gl.uniform1f(q.u.uShow, show);
        gl.uniform1f(q.u.uGhostBack, st.ghostBack && st.ghost > 0 && st.reveal == null ? 0.75 : 0);
        gl.uniform4f(q.u.uMini, mini ? mini.x : 0, mini ? mini.y : 0, mini ? mini.w : 0, mini ? mini.h : 0);
        gl.uniform1f(q.u.uFine, lod.fine);
        gl.bindBuffer(gl.ARRAY_BUFFER, st.overBuf);
        gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(0, 4, gl.FLOAT, false, FLOATS * 4, 0);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, FLOATS * 4, 16);
        gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FLOATS * 4, 24);
        gl.drawArrays(gl.TRIANGLES, 0, st.overCount * VPI);
        gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
        gl.disable(gl.BLEND);
      }
    }

    function bindTex(unit, tex, loc) {
      var gl = st.gl;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc, unit);
    }

    function quad() {
      var gl = st.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, st.quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function miniRect() {
      var m = st.m;
      if (st.mode !== 'loupe' || !st.minimap || !m.w) return null;
      var v = st.view;
      if (m.w <= st.w / v.scale && m.h <= st.h / v.scale) return null; // the whole chart is already in view
      var maxS = Math.min(st.w, st.h) * 0.28;
      var k = maxS / Math.max(m.w, m.h);
      var mw = Math.max(8, Math.round(m.w * k)), mh = Math.max(8, Math.round(m.h * k));
      var pad = 6 * st.dpr;
      var ins = insetsPx();
      return { x: st.w - mw - pad - ins.right, y: st.h - mh - pad - ins.bottom, w: mw, h: mh };
    }

    /* ======================================================= Canvas 2D */
    function fabricCss(k) { return cssRgb(mixRgb([0, 0, 0], st.m.fabric.rgb, k == null ? 0.93 : k)); }

    function thumbColour(i) {
      var m = st.m, v = m.cells[i], pal = m.palette;
      var fab = mixRgb([0, 0, 0], m.fabric.rgb, 0.93);
      if (!(v >= 0 && v < pal.length)) {
        var pi = m._partCell ? m._partCell[i] : -1;
        if (pi >= 0) {
          var p = m.part[pi], ea = pal[p.a];
          if (!ea) return fab;
          return bitOf(m.donePart, pi) ? mixRgb(fab, ea.rgb, 0.6) : mixRgb(fab, ea.rgb, st.ghost);
        }
        return fab;
      }
      var e = pal[v];
      var dn = isDone(i);
      return dn ? mixRgb(fab, mixRgb([0, 0, 0], e.rgb, 0.92), 0.85) : mixRgb(fab, e.rgb, st.ghost);
    }

    function isDone(i) {
      if (st.reveal != null && st.rank && st.rank[i] !== NO_RANK) {
        return (st.rank[i] + 0.5) / st.rankScale < st.reveal * (1 + growWindow(st.rankCount));
      }
      return bitOf(st.m.done, i);
    }

    function buildThumb() {
      var m = st.m;
      if (!m.w) return;
      var c = st.thumb && st.thumb.width === m.w && st.thumb.height === m.h ? st.thumb : document.createElement('canvas');
      c.width = m.w; c.height = m.h;
      var g = c.getContext('2d');
      var img = g.createImageData(m.w, m.h), d = img.data;
      for (var i = 0, n = m.w * m.h; i < n; i++) {
        var rgb = thumbColour(i), o = i * 4;
        d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      st.thumb = c; st.thumbImg = img;
    }

    function paintThumb(i) {
      if (!st.thumb || !st.thumbImg) return;
      var rgb = thumbColour(i), d = st.thumbImg.data, o = i * 4;
      d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2];
      var x = i % st.m.w, y = (i / st.m.w) | 0;
      st.thumb.getContext('2d').putImageData(st.thumbImg, 0, 0, x, y, 1, 1);
    }

    /** A flat stitched tile per colour at the current size: two shaded legs. */
    function sprite(idx, s) {
      if (st.spriteSize !== s || !st.sprites) { st.sprites = {}; st.spriteSize = s; }
      var c = st.sprites[idx];
      if (c) return c;
      var e = st.m.palette[idx];
      c = document.createElement('canvas');
      c.width = c.height = s;
      var g = c.getContext('2d');
      var rgb = e ? e.rgb : [128, 128, 128];
      var lw = Math.max(1, s * (0.19 + 0.05 * ((e && e.strands) || 2)) * 0.95);
      var in0 = s * 0.1, in1 = s * 0.9;
      g.lineCap = 'round';
      function leg(x0, y0, x1, y1, k) {
        g.strokeStyle = cssRgb(mixRgb([0, 0, 0], rgb, 0.62 * k));
        g.lineWidth = lw;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        g.strokeStyle = cssRgb(mixRgb(rgb, [255, 255, 255], 0.12 * k));
        g.lineWidth = lw * 0.55;
        g.beginPath(); g.moveTo(x0 - lw * 0.08, y0 - lw * 0.08); g.lineTo(x1 - lw * 0.08, y1 - lw * 0.08); g.stroke();
      }
      leg(in0, in1, in1, in0, 0.92);
      if (!(e && e.kind === 'half')) leg(in0, in0, in1, in1, 1.05);
      st.sprites[idx] = c;
      return c;
    }

    function weavePattern(g, s) {
      if (st.weaveTile && st.weaveTileSize === s) return st.weavePat;
      var c = document.createElement('canvas');
      c.width = c.height = s;
      var t = c.getContext('2d');
      t.fillStyle = fabricCss(0.95);
      t.fillRect(0, 0, s, s);
      t.fillStyle = cssRgb(mixRgb([0, 0, 0], st.m.fabric.rgb, 0.80));
      t.fillRect(0, 0, s, Math.max(1, s * 0.06));
      t.fillRect(0, 0, Math.max(1, s * 0.06), s);
      t.fillStyle = cssRgb(mixRgb([0, 0, 0], st.m.fabric.rgb, 0.3));
      var r = Math.max(1, s * 0.09);
      t.beginPath(); t.arc(0, 0, r, 0, 6.3); t.arc(s, 0, r, 0, 6.3); t.arc(0, s, r, 0, 6.3); t.arc(s, s, r, 0, 6.3); t.fill();
      st.weaveTile = c; st.weaveTileSize = s;
      st.weavePat = g.createPattern(c, 'repeat');
      return st.weavePat;
    }

    function draw2d(t) {
      var g = st.g2d, m = st.m;
      if (!g) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, st.w, st.h);
      if (st.background !== 'transparent') {
        g.fillStyle = cssRgb(st.background === 'theme' ? st.theme.bg : (parseColor(st.background) || st.theme.bg));
        g.fillRect(0, 0, st.w, st.h);
      }
      if (!m.w) return;
      var v = st.view;
      var s = v.scale >= 6 ? Math.round(v.scale) : v.scale;
      var ox = Math.round(st.w / 2 - v.cx * s), oy = Math.round(st.h / 2 - v.cy * s);
      var gd = decor();
      g.save();
      // decoration and the cloth's outline
      g.shadowColor = 'rgba(0,0,0,0.25)'; g.shadowBlur = 12; g.shadowOffsetY = 4;
      if (gd.kind === 1) {
        g.beginPath(); g.arc(ox + gd.cx * s, oy + gd.cy * s, (gd.R + gd.W) * s, 0, Math.PI * 2);
        g.fillStyle = 'rgb(196,152,104)'; g.fill();
        g.shadowColor = 'transparent';
        g.beginPath(); g.arc(ox + gd.cx * s, oy + gd.cy * s, gd.R * s, 0, Math.PI * 2);
        g.fillStyle = fabricCss(); g.fill();
        g.clip();
      } else if (gd.kind === 2) {
        var all = gd.mat + gd.mould;
        g.fillStyle = 'rgb(104,70,46)';
        g.fillRect(ox + (gd.cx - gd.hx - all) * s, oy + (gd.cy - gd.hy - all) * s, (gd.hx + all) * 2 * s, (gd.hy + all) * 2 * s);
        g.shadowColor = 'transparent';
        g.fillStyle = 'rgb(242,238,226)';
        g.fillRect(ox + (gd.cx - gd.hx - gd.mat) * s, oy + (gd.cy - gd.hy - gd.mat) * s, (gd.hx + gd.mat) * 2 * s, (gd.hy + gd.mat) * 2 * s);
        g.beginPath(); g.rect(ox + (gd.cx - gd.hx) * s, oy + (gd.cy - gd.hy) * s, gd.hx * 2 * s, gd.hy * 2 * s);
        g.fillStyle = fabricCss(); g.fill(); g.clip();
      } else {
        g.fillStyle = fabricCss();
        g.fillRect(ox - gd.margin * s, oy - gd.margin * s, (m.w + 2 * gd.margin) * s, (m.h + 2 * gd.margin) * s);
        g.shadowColor = 'transparent';
      }
      g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
      var x0 = Math.max(0, Math.floor(-ox / s)), y0 = Math.max(0, Math.floor(-oy / s));
      var x1 = Math.min(m.w, Math.ceil((st.w - ox) / s)), y1 = Math.min(m.h, Math.ceil((st.h - oy) / s));
      if (s >= 6) {
        g.save(); g.translate(ox, oy);
        g.fillStyle = weavePattern(g, s);
        var mg = gd.kind === 0 ? gd.margin : Math.max(gd.R || 0, gd.hx || 0, gd.hy || 0) + 2;
        g.fillRect(-mg * s, -mg * s, (m.w + 2 * mg) * s, (m.h + 2 * mg) * s);
        g.restore();
        var pal = m.palette, ghostCss = [];
        for (var y = y0; y < y1; y++) {
          for (var x = x0; x < x1; x++) {
            var i = y * m.w + x, c = m.cells[i];
            if (c >= 0 && c < pal.length) {
              if (isDone(i)) g.drawImage(sprite(c, s), ox + x * s, oy + y * s);
              else if (st.ghost > 0) {
                if (!ghostCss[c]) ghostCss[c] = cssRgb(pal[c].rgb, st.ghost);
                g.fillStyle = ghostCss[c];
                g.fillRect(ox + x * s, oy + y * s, s, s);
              }
            }
          }
        }
        // fractionals as triangles of floss
        for (var k = 0; k < m.part.length; k++) {
          var pp = m.part[k];
          if (pp.x < x0 - 1 || pp.x > x1 || pp.y < y0 - 1 || pp.y > y1) continue;
          var ea = pal[pp.a], dn = bitOf(m.donePart, k);
          if (!ea) continue;
          g.fillStyle = cssRgb(ea.rgb, dn ? 1 : st.ghost);
          var K = [[0, 0], [1, 1], [1, 0], [0, 1]][clamp((pp.d | 0) || 1, 1, 4) - 1];
          g.beginPath();
          g.moveTo(ox + (pp.x + K[0]) * s, oy + (pp.y + K[1]) * s);
          g.lineTo(ox + (pp.x + K[0]) * s, oy + (pp.y + 1 - K[1]) * s);
          g.lineTo(ox + (pp.x + 1 - K[0]) * s, oy + (pp.y + K[1]) * s);
          g.fill();
        }
      } else {
        if (!st.thumb) buildThumb();
        g.imageSmoothingEnabled = true;
        try { g.imageSmoothingQuality = 'high'; } catch (e) { /* ignore */ }
        g.drawImage(st.thumb, ox, oy, m.w * s, m.h * s);
      }
      // backstitch and knots
      g.lineCap = 'round';
      for (var bi = 0; bi < m.back.length; bi++) {
        var b = m.back[bi], eb = m.palette[b.i];
        var bd = bitOf(m.doneBack, bi);
        if (!eb || (!bd && !(st.ghostBack && st.ghost > 0))) continue;
        g.strokeStyle = cssRgb(eb.rgb, bd ? 1 : 0.55);
        g.lineWidth = Math.max(1, s * (bd ? 0.16 : 0.07));
        g.beginPath(); g.moveTo(ox + b.x1 * s, oy + b.y1 * s); g.lineTo(ox + b.x2 * s, oy + b.y2 * s); g.stroke();
      }
      for (var ki = 0; ki < m.knots.length; ki++) {
        var kn = m.knots[ki], ek = m.palette[kn.i];
        var kd = bitOf(m.doneKnots, ki);
        if (!ek || (!kd && !(st.ghostBack && st.ghost > 0))) continue;
        g.beginPath(); g.arc(ox + kn.x * s, oy + kn.y * s, Math.max(1.5, s * 0.26), 0, Math.PI * 2);
        if (kd) { g.fillStyle = cssRgb(ek.rgb); g.fill(); }
        else { g.strokeStyle = cssRgb(ek.rgb, 0.6); g.lineWidth = Math.max(1, s * 0.07); g.stroke(); }
      }
      g.restore();
      // loupe block, next stitch, thumbnail
      var acc = cssRgb(st.theme.accent);
      if (st.mode === 'loupe' && st.block) {
        var bl = st.block;
        g.strokeStyle = acc; g.lineWidth = Math.max(1.5, 0.035 * s);
        g.strokeRect(ox + bl.bx0 * s, oy + bl.by0 * s, bl.bw * s, bl.bh * s);
      }
      var nx = st.loupe.next;
      if (nx && st.mode !== 'fit') {
        var grow = Math.max(0, 4 - s / 2);
        g.strokeStyle = acc; g.lineWidth = Math.max(1.8, 0.07 * s);
        g.strokeRect(ox + nx.x * s - grow, oy + nx.y * s - grow, s + grow * 2, s + grow * 2);
      }
      var mr = miniRect();
      if (mr) {
        if (!st.thumb) buildThumb();
        g.fillStyle = cssRgb(st.theme.text);
        g.fillRect(mr.x - 2, mr.y - 2, mr.w + 4, mr.h + 4);
        g.imageSmoothingEnabled = true;
        g.drawImage(st.thumb, mr.x, mr.y, mr.w, mr.h);
        var vx0 = v.cx - st.w / 2 / v.scale, vy0 = v.cy - st.h / 2 / v.scale;
        g.strokeStyle = acc; g.lineWidth = 1.5;
        g.strokeRect(mr.x + vx0 / m.w * mr.w, mr.y + vy0 / m.h * mr.h, st.w / v.scale / m.w * mr.w, st.h / v.scale / m.h * mr.h);
      }
    }

    /* ======================================================= frame loop */
    function needsFrame(t) {
      if (st.newAnim) return true;
      if (st.tween) return true;
      if (st.vel) return true;
      if (st.loupe.next && st.mode !== 'fit' && t < st.pulseUntil && !st.reducedMotion) return true;
      return false;
    }

    function stepAnim(t, dt) {
      if (st.tween) {
        var tw = st.tween, k = clamp((t - tw.t0) / tw.dur, 0, 1);
        var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        // zoom eases in log space so it feels even
        st.view = {
          cx: tw.from.cx + (tw.to.cx - tw.from.cx) * e,
          cy: tw.from.cy + (tw.to.cy - tw.from.cy) * e,
          scale: Math.exp(Math.log(tw.from.scale) + (Math.log(tw.to.scale) - Math.log(tw.from.scale)) * e)
        };
        if (k >= 1) { st.view = tw.to; st.tween = null; }
      }
      if (st.vel && !st.dragging) {
        st.view.cx -= st.vel.x * dt; st.view.cy -= st.vel.y * dt;
        var decay = Math.pow(0.04, dt);
        st.vel.x *= decay; st.vel.y *= decay;
        clampFree();
        if (Math.abs(st.vel.x) * st.view.scale < 4 && Math.abs(st.vel.y) * st.view.scale < 4) {
          st.vel = null;
          if (st.onView) st.onView(getView());
        }
      }
    }

    function renderNow(t, force) {
      var tc = now();
      t = t == null ? now() : t;
      if (st.gl && !st.lost) { if (drawGL(t, force) === false) return false; }
      else if (st.g2d) draw2d(t);
      st.stats.cpuMs = now() - tc;
      st.stats.frames++;
    }

    function frame(ts) {
      st.rafId = 0;
      if (st.destroyed) return;
      var t = now();
      var dt = st.lastT ? Math.min((t - st.lastT) / 1000, 0.1) : 0;
      if (st.lastT) { st.deltaAcc += t - st.lastT; st.deltaN++; if (st.deltaN >= 20) { st.stats.frameMs = st.deltaAcc / st.deltaN; st.deltaAcc = 0; st.deltaN = 0; } }
      st.lastT = t;
      stepAnim(t, dt);
      var drew = renderNow(t);
      if (drew !== false && st.gl && !st.lost) report(st.status === 'lost' ? 'restored' : 'ok');
      if (needsFrame(t)) schedule();
      else st.lastT = 0;
    }

    function schedule() {
      if (st.destroyed || st.rafId) return;
      st.rafId = global.requestAnimationFrame(frame);
    }

    function kick() { if (!st.offscreen) schedule(); }

    /* ---------------------------------------------------------- resize */
    function resize() {
      if (st.destroyed) return;
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      var w, h;
      if (st.fixedSize) { w = st.fixedSize.w; h = st.fixedSize.h; dpr = 1; }
      else {
        if (st.recording) return;
        var r = canvas.getBoundingClientRect();
        var cw = r.width || canvas.clientWidth || 0, ch = r.height || canvas.clientHeight || 0;
        if (cw <= 0 || ch <= 0) return;
        if (!st.gl) dpr = Math.min(dpr, 1.5);   // the 2D fallback draws per cell: keep it light
        w = Math.max(1, Math.round(cw * dpr)); h = Math.max(1, Math.round(ch * dpr));
      }
      if (st.gl && st.maxViewport) { w = Math.min(w, st.maxViewport); h = Math.min(h, st.maxViewport); }
      if (w === st.w && h === st.h && dpr === st.dpr) return;
      var oldDpr = st.dpr;
      canvas.width = w; canvas.height = h;
      st.w = w; st.h = h; st.dpr = dpr;
      if (st.mode === 'free' && st.freeSet) { st.view.scale *= dpr / oldDpr; clampFree(); }
      else applyView(false);
      kick();
    }

    function ensureSize(tries) {
      if (st.destroyed || st.w > 0) return;
      resize();
      if (st.w > 0 || (tries || 0) >= 20) return;
      global.requestAnimationFrame(function () { ensureSize((tries || 0) + 1); });
    }

    var ro = null;
    if (!st.fixedSize && global.ResizeObserver) {
      ro = new global.ResizeObserver(function () { resize(); });
      try { ro.observe(canvas); } catch (e) { ro = null; }
    }
    function onWinResize() { resize(); }
    if (!st.fixedSize) global.addEventListener('resize', onWinResize);

    /* ---------------------------------------------------- context loss */
    function onLost(e) {
      if (e && e.preventDefault) e.preventDefault();
      st.gl = null; st.tex = {}; st.fbo = null;
      st.lost = true;
      if (st.rafId) { global.cancelAnimationFrame(st.rafId); st.rafId = 0; }
      if (handle) handle.webgl = false;
      if (!st.destroyed) report('lost');
    }
    function onRestored() {
      if (st.destroyed) return;
      if (initGL()) {
        st.lost = false;
        if (handle) handle.webgl = true;
        report('restored');
        kick();
      }
    }
    canvas.addEventListener('webglcontextlost', onLost, false);
    canvas.addEventListener('webglcontextrestored', onRestored, false);

    function releaseContext(reason) {
      liveRec.dead = true;
      var gl = st.gl;
      if (!gl) return;
      freeTextures();
      try {
        gl.deleteProgram(st.prog.p); gl.deleteProgram(st.progLod.p); gl.deleteProgram(st.progOver.p);
        gl.deleteBuffer(st.quad); gl.deleteBuffer(st.overBuf);
      } catch (e) { /* ignore */ }
      st.gl = null; st.lost = true;
      if (handle) handle.webgl = false;
      if (st.rafId) { global.cancelAnimationFrame(st.rafId); st.rafId = 0; }
      try { var ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e2) { /* ignore */ }
      if (reason !== 'destroy' && !st.destroyed) report('lost');
    }

    /* ------------------------------------------------------ interaction */
    var pointers = {}, pinch = null, lastTap = { t: 0, x: 0, y: 0 }, drag = null;

    function cssPos(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function pcount() { var n = 0; for (var k in pointers) if (pointers.hasOwnProperty(k)) n++; return n; }
    function twoPointers() {
      var a = [];
      for (var k in pointers) if (pointers.hasOwnProperty(k)) a.push(pointers[k]);
      return a;
    }

    function onDown(e) {
      if (!st.interactive) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
      var p = cssPos(e);
      pointers[e.pointerId] = { x: p.x, y: p.y };
      st.vel = null; st.tween = null;
      if (pcount() === 2) {
        var two = twoPointers();
        pinch = { d: Math.max(10, Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y)), scale: st.view.scale,
          mx: (two[0].x + two[1].x) / 2, my: (two[0].y + two[1].y) / 2 };
        drag = null;
      } else {
        drag = { x: p.x, y: p.y, x0: p.x, y0: p.y, t: now(), moved: 0, samples: [] };
      }
      st.dragging = true;
      e.preventDefault();
    }

    function onMove(e) {
      if (!st.interactive || !pointers[e.pointerId]) return;
      var p = cssPos(e);
      pointers[e.pointerId] = { x: p.x, y: p.y };
      if (pinch && pcount() >= 2) {
        var two = twoPointers();
        var d = Math.max(10, Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y));
        var mx = (two[0].x + two[1].x) / 2, my = (two[0].y + two[1].y) / 2;
        var f = (pinch.scale * d / pinch.d) / st.view.scale;
        panBy(mx - pinch.mx, my - pinch.my);
        zoomBy(f, mx, my);
        pinch.mx = mx; pinch.my = my;
      } else if (drag) {
        var dx = p.x - drag.x, dy = p.y - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        drag.x = p.x; drag.y = p.y;
        if (drag.moved > 4) panBy(dx, dy);
        drag.samples.push({ t: now(), x: p.x, y: p.y });
        if (drag.samples.length > 6) drag.samples.shift();
      }
      e.preventDefault();
    }

    function onUp(e) {
      if (!pointers[e.pointerId]) return;
      delete pointers[e.pointerId];
      try { canvas.releasePointerCapture(e.pointerId); } catch (er) { /* ignore */ }
      if (pinch) { if (pcount() < 2) { pinch = null; drag = null; st.dragging = false; if (st.onView) st.onView(getView()); } return; }
      st.dragging = false;
      if (!drag) return;
      var tnow = now();
      if (drag.moved <= 6) {
        var p = cssPos(e);
        if (tnow - lastTap.t < 320 && Math.abs(p.x - lastTap.x) < 24 && Math.abs(p.y - lastTap.y) < 24) {
          lastTap.t = 0;
          resetView();
        } else {
          lastTap = { t: tnow, x: p.x, y: p.y };
          if (st.onTap) { try { st.onTap(hit(e.clientX, e.clientY)); } catch (er2) { /* ignore */ } }
        }
      } else if (!st.reducedMotion && drag.samples.length >= 2) {
        var a = drag.samples[0], b = drag.samples[drag.samples.length - 1];
        var dtm = (b.t - a.t) / 1000;
        if (dtm > 0 && tnow - b.t < 80) {
          st.vel = { x: (b.x - a.x) / dtm * st.dpr / st.view.scale, y: (b.y - a.y) / dtm * st.dpr / st.view.scale };
          kick();
        } else if (st.onView) st.onView(getView());
      } else if (st.onView) st.onView(getView());
      drag = null;
    }

    function onWheel(e) {
      if (!st.interactive) return;
      e.preventDefault();
      var p = cssPos(e);
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomBy(Math.exp(-dy * 0.0016), p.x, p.y);
      if (st.onView) st.onView(getView());
    }

    function setInteractive(on) {
      st.interactive = !!on;
      canvas.style.touchAction = on ? 'none' : '';
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    if (st.interactive) canvas.style.touchAction = 'none';

    /* ------------------------------------------------------ outputs */
    function snapshot(opt) {
      var type = (opt && opt.type) || 'image/png';
      renderNow(now(), true);
      return new Promise(function (resolve) {
        try { canvas.toBlob(function (b) { resolve(b); }, type); }
        catch (e) { resolve(null); }
      });
    }

    function benchmark(opt) {
      opt = opt || {};
      var frames = clamp(num(opt.frames, 60) | 0, 1, 2000);
      var times = [], cpu = 0;
      var gl = st.gl;
      var px = new Uint8Array(4);
      var v0 = { cx: st.view.cx, cy: st.view.cy, scale: st.view.scale };
      if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (var k = 0; k < frames; k++) {
        if (opt.pan !== false) st.view.cx = v0.cx + Math.sin(k / frames * 6.283) * 20 / v0.scale;
        if (opt.everyFrameLod) st.lodDirty = true;
        var ta = now();
        renderNow(ta, true);
        var tb = now();
        if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        var tc = now();
        cpu += tb - ta;
        times.push(tc - ta);
      }
      st.view = v0;
      renderNow(now());
      times.sort(function (a, b) { return a - b; });
      var sum = 0;
      for (k = 0; k < times.length; k++) sum += times[k];
      return { msPerFrame: sum / times.length, p95: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))],
        median: times[times.length >> 1], cpuMs: cpu / frames, frames: frames, w: st.w, h: st.h };
    }

    function getStats() {
      var lod = lodFor(st.view.scale);
      return {
        webgl: !!st.gl, status: st.status, frameMs: st.stats.frameMs, cpuMs: st.stats.cpuMs,
        mountMs: st.stats.mountMs, compileMs: st.stats.compileMs || 0, contextMs: st.stats.contextMs || 0, startCompileMs: st.stats.startCompileMs || 0, layoutMs: st.stats.layoutMs || 0, firstFrameMs: st.firstFrameMs || 0,
        compiling: !!st.pending, parallelCompile: !!st.parExt, lastUpdateMs: st.stats.lastUpdateMs, uploadMs: st.stats.uploadMs,
        setModelMs: st.stats.lastSetModelMs || 0,
        textureBytes: st.gl ? st.stats.textureBytes : 0, cellPx: st.view.scale, lod: lod.tier, detail: lod.detail,
        frames: st.stats.frames, contexts: LIVE.length, w: st.w, h: st.h, dpr: st.dpr,
        mode: st.mode, reveal: st.reveal, rankCount: st.rankCount, fallbackOrder: st.rankFallback
      };
    }

    function setOptions(op) {
      op = op || {};
      if (op.ghost != null) { st.ghost = clamp(+op.ghost || 0, 0, 1); st.lodDirty = true; st.thumb = null; }
      if (op.symbols != null) st.symbols = !!op.symbols;
      if (op.ghostBack != null) st.ghostBack = !!op.ghostBack;
      if (op.reducedMotion != null) st.reducedMotion = !!op.reducedMotion;
      if (op.minimap != null) st.minimap = !!op.minimap;
      if (op.background != null) st.background = op.background;
      if (op.stitchPx != null) { st.stitchPx = clamp(+op.stitchPx || 12, 4, 64); applyView(false); }
      if (op.safeInsets) { st.insets = op.safeInsets; applyView(false); }
      if (op.showNextInFit != null) st.showNextInFit = !!op.showNextInFit;
      kick();
    }

    function setFrame(f) {
      st.frame = f === 'hoop' || f === 'frame' ? f : 'none';
      if (st.mode === 'fit') applyView(true); else kick();
    }

    function setFabric(f) {
      f = f || {};
      var fab = st.m.fabric;
      if (f.color != null) { fab.color = f.color; fab.rgb = parseColor(f.color) || fab.rgb; }
      if (f.count != null) fab.count = clamp(num(f.count, 14), 6, 56);
      if (f.kind != null) fab.kind = f.kind === 'evenweave' || f.kind === 'linen' ? f.kind : 'aida';
      if (f.over != null) fab.over = clamp(f.over | 0, 1, 2);
      st.lodDirty = true; st.thumb = null; st.weaveTile = null; st.sprites = null;
      if (st.overData) { buildOverlay(); st.overDirty = true; }
      if (st.mode === 'fit') applyView(false);
      kick();
    }

    function setTheme(th) {
      if (th !== undefined) st.themeOverride = th;
      st.theme = readTheme(st.themeOverride);
      kick();
    }

    function destroy(op) {
      if (st.destroyed) { if (op && op.release) releaseContext('destroy'); return; }
      st.destroyed = true;
      if (st.rafId) { global.cancelAnimationFrame(st.rafId); st.rafId = 0; }
      if (ro) { try { ro.disconnect(); } catch (e) { /* ignore */ } }
      global.removeEventListener('resize', onWinResize);
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      unregister(liveRec);
      if (op && op.release) releaseContext('destroy');
    }

    /* --------------------------------------------------------- start */
    var glOk = false;
    if (!o.force2d) {
      reap(null);
      glOk = initGL();
      if (glOk) { LIVE.push(liveRec); reap(liveRec); }
    }
    if (!glOk) {
      try { st.g2d = canvas.getContext('2d'); } catch (e) { st.g2d = null; }
    }

    handle = {
      webgl: glOk,
      setModel: setModel, setDone: setDone, setDoneMany: setDoneMany, setProgress: setProgress,
      setLayerDone: setLayerDone, setView: setView, setLoupe: setLoupe, setFrame: setFrame,
      setFabric: setFabric, setOptions: setOptions, setTheme: setTheme, setOrder: setOrder,
      setReveal: setReveal, resetView: resetView, panBy: panBy, zoomBy: zoomBy, hit: hit,
      getView: getView, snapshot: snapshot, benchmark: benchmark, getStats: getStats,
      setInteractive: setInteractive, renderNow: function () { renderNow(now(), true); },
      resize: resize, isLive: function () { return !!st.gl && !st.lost; }, destroy: destroy,
      canvas: canvas,
      _state: st
    };

    var tl1 = now();
    resize();
    st.stats.layoutMs += now() - tl1;
    ensureSize(0);
    if (o.model) setModel(o.model);
    st.stats.mountMs = now() - t0;
    if (!glOk) {
      global.setTimeout(function () { if (!st.destroyed) report(o.force2d ? 'fallback' : 'fallback'); }, 0);
    }
    return handle;
  }

  /* ========================================================= time-lapse */

  function timelapse(handle, opt) {
    opt = opt || {};
    var dur = clamp(num(opt.durationMs, 10000), 500, 600000);
    var info = handle.setOrder(opt.order || null);
    var pos = 0, playing = false, raf = 0, last = 0, rec = null;
    handle.setReveal(0);
    var ctl = {
      fallback: info.fallback, label: info.label, count: info.count, before: info.before,
      get playing() { return playing; },
      get position() { return pos; },
      play: function () {
        if (playing) return;
        if (pos >= 1) pos = 0;
        playing = true; last = now();
        raf = global.requestAnimationFrame(tick);
      },
      pause: function () { playing = false; if (raf) global.cancelAnimationFrame(raf); raf = 0; },
      seek: function (f) { pos = clamp(+f || 0, 0, 1); handle.setReveal(pos); if (opt.onTick) opt.onTick(pos); },
      exportFrame: function () { return handle.snapshot({ type: 'image/png' }); },
      recordVideo: function (ro) {
        ro = ro || {};
        var cap = canRecordVideo();
        if (!cap.ok) return Promise.resolve({ ok: false, reason: cap.reason });
        var canvas = handle.canvas;
        var stream;
        try { stream = canvas.captureStream(clamp(num(ro.fps, 30), 10, 60)); }
        catch (e) { return Promise.resolve({ ok: false, reason: 'Saving a video is not supported on this device.' }); }
        var chunks = [];
        var mr;
        try { mr = new global.MediaRecorder(stream, { mimeType: cap.mime, videoBitsPerSecond: 6e6 }); }
        catch (e2) { return Promise.resolve({ ok: false, reason: 'Saving a video is not supported on this device.' }); }
        var vdur = clamp(num(ro.durationMs, 6000), 1000, 60000);
        var st = handle._state;
        return new Promise(function (resolve) {
          mr.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
          mr.onstop = function () {
            st.recording = false;
            var blob = new global.Blob(chunks, { type: cap.mime.split(';')[0] });
            if (!blob.size) resolve({ ok: false, reason: 'The video came out empty on this device. Save a picture instead.' });
            else resolve({ ok: true, blob: blob, mime: cap.mime });
          };
          st.recording = true;
          ctl.pause();
          pos = 0; handle.setReveal(0);
          var t0 = now();
          mr.start(250);
          (function step() {
            var k = clamp((now() - t0) / vdur, 0, 1);
            pos = k; handle.setReveal(k);
            if (opt.onTick) opt.onTick(k);
            if (k < 1) global.requestAnimationFrame(step);
            else global.setTimeout(function () { try { mr.stop(); } catch (e3) { resolve({ ok: false, reason: 'The recording stopped.' }); } }, 400);
          })();
        });
      },
      destroy: function () { ctl.pause(); handle.setReveal(null); }
    };
    function tick() {
      raf = 0;
      if (!playing) return;
      var t = now();
      pos = clamp(pos + (t - last) / dur, 0, 1);
      last = t;
      handle.setReveal(pos);
      if (opt.onTick) opt.onTick(pos);
      if (pos >= 1) { playing = false; if (opt.onEnd) opt.onEnd(); return; }
      raf = global.requestAnimationFrame(tick);
    }
    return ctl;
  }

  /* ====================================================== share picture */

  var shared = null;
  function picture(src, opt) {
    opt = opt || {};
    var size = clamp(num(opt.size, 2048) | 0, 64, 4096);
    return new Promise(function (resolve) {
      var doc = global.document;
      if (!shared || shared.size !== size || !shared.h.isLive()) {
        if (shared) { try { shared.h.destroy({ release: true }); } catch (e) { /* ignore */ } }
        var c = doc.createElement('canvas');
        c.width = size; c.height = size;
        var h = mount(c, { size: size, offscreen: true, view: 'fit', ghost: 0, background: opt.background || 'transparent' });
        shared = { c: c, h: h, size: size };
      }
      var hd = shared.h;
      hd.setOptions({ ghost: opt.ghost == null ? 0 : opt.ghost, background: opt.background || 'transparent', symbols: false });
      hd.setFrame(opt.frame || 'hoop');
      hd.setModel(src);
      hd.setView({ mode: 'fit', animate: false });
      hd.renderNow();
      var out = doc.createElement('canvas');
      out.width = size; out.height = size;
      var g = out.getContext('2d');
      g.drawImage(shared.c, 0, 0);
      resolve(out);
    });
  }

  /* ============================================================ exports */

  global.XSRender = {
    VERSION: VERSION,
    MAX_LIVE: MAX_LIVE,
    NO_RANK: NO_RANK,
    FALLBACK_LABEL: FALLBACK_LABEL,
    isSupported: function () {
      try {
        var c = global.document.createElement('canvas');
        var ok = !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
        return ok;
      } catch (e) { return false; }
    },
    mount: mount,
    model: model,
    picture: picture,
    timelapse: timelapse,
    packCellTexel: packCellTexel,
    unpackCellTexel: unpackCellTexel,
    packPartTexel: packPartTexel,
    packCells: function (m, rank) { return packCells(m && m._partCell !== undefined ? m : model(m), rank); },
    packPalette: function (m) { return packPalette(m && m.fabric && m.fabric.rgb ? m : model(m)); },
    lodFor: lodFor,
    fitView: fitView,
    decorGeo: decorGeo,
    hitTest: hitTest,
    screenOf: screenOf,
    loupeWindow: loupeWindow,
    loupeView: loupeView,
    buttonView: buttonView,
    replayOrder: function (m, order) { return replayOrder(m && m._partCell !== undefined ? m : model(m), order); },
    fallbackOrder: function (m) { return fallbackOrder(m && m._partCell !== undefined ? m : model(m)); },
    rankOf: rankOf,
    revealCount: revealCount,
    growWindow: growWindow,
    orderFromMarkLog: orderFromMarkLog,
    hoopFor: hoopFor,
    canRecordVideo: canRecordVideo,
    parseColor: parseColor,
    liveContexts: function () { return LIVE.length; }
  };
})(typeof window !== 'undefined' ? window : this);
