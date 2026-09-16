/* Thready or Not — js/app-xstitch.js
 *
 * Cross-stitch UI. Registers with App.registerCraft({ id: 'crossstitch', … })
 * at script-evaluation time; the contract is in docs/CRAFTS.md and the screens
 * are specified in docs/research/cross-stitch.md §B4 and §B5.
 *
 * Everything here is presentation. All project state is read from
 * `project.craftData` (an XSData, see XStitch.normalize) and written back
 * through Store.updateCraftData, so the shell's Undo works for free. All
 * chart maths lives in js/xstitch.js.
 *
 * Contents
 *   1.  shell handles and small helpers
 *   2.  the per-project view model (cells, done bitmap, offscreen images)
 *   3.  the chart canvas (pan / pinch / mark tools)
 *   4.  the project screen
 *   5.  the tap button
 *   6.  sheets: chart, floss, fabric, pages, parking, colour editor
 *   7.  import: OXS, PDF, photo, by hand
 *   8.  export: OXS
 *   9.  help: FAQ + tour
 *   10. registration
 */
(function () {
  'use strict';

  var X = window.XStitch;
  if (!window.App || typeof window.App.registerCraft !== 'function') return;
  // Without the pure-logic module there is nothing to render; the shell's
  // "This project needs the Cross-stitch module" card is the right answer.
  if (!X || typeof X.normalize !== 'function') return;

  var App = window.App;
  var Store = window.Store;
  var CRAFT = 'crossstitch';

  /* ================================================================== *
   * 1. Shell handles and helpers
   * ================================================================== */

  /** The shell's ctx, captured from whichever entry point runs first. */
  var C = null;
  function useCtx(ctx) { if (ctx && ctx.el) C = ctx; return C; }

  function el(t, c, x) { return C.el(t, c, x); }
  function button(c, t, l) { return C.button(c, t, l); }
  function on(n, t, f) { return C.on(n, t, f); }
  function clear(n) { return C.clear(n); }
  function field(l, c, h) { return C.field(l, c, h); }
  function toast(m, o) { return C.toast(m, o); }
  function fb(k) { return C.fb(k); }

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  function clampInt(v, lo, hi, dflt) {
    var n = typeof v === 'number' ? v : parseInt(v, 10);
    if (!isFinite(n)) return dflt;
    n = Math.round(n);
    return n < lo ? lo : (n > hi ? hi : n);
  }

  function num(v, dflt) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : dflt;
  }

  function comma(n) {
    try { return Number(n).toLocaleString(); } catch (e) { return String(n); }
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  /** craftData for a project, always a full XSData. */
  function dataOf(p) {
    if (!p) return X.normalize(null, null);
    if (!isObj(p.craftData) || p.craftData.v !== 1) {
      return X.normalize(p.craftData, p);
    }
    return p.craftData;
  }

  function paletteLabel(e) {
    if (!e) return '';
    var code = (e.brand ? e.brand + ' ' : '') + e.code;
    return e.name ? code + ' · ' + e.name : code;
  }

  function swatchHex(e) { return '#' + ((e && e.hex) || '808080'); }

  var KIND_LABEL = {
    cross: '', back: 'backstitch', knot: 'French knot',
    bead: 'bead', half: 'half stitch', blend: 'blend'
  };

  /* ---- colour plumbing for the canvas ------------------------------- */

  var NAMED_FABRIC = {
    white: [252, 251, 248], 'antique white': [244, 240, 230], ecru: [240, 234, 218],
    cream: [247, 241, 226], ivory: [246, 242, 230], natural: [238, 230, 214],
    black: [32, 32, 32], navy: [40, 48, 72], 'light blue': [214, 228, 240],
    'summer khaki': [226, 214, 190], grey: [206, 206, 206], gray: [206, 206, 206]
  };

  function fabricRgb(data) {
    var c = (data && data.fabric && data.fabric.color) || 'White';
    var hex = X.hexToRgb(c);
    if (hex) return hex;
    var named = NAMED_FABRIC[String(c).trim().toLowerCase()];
    return named ? named.slice() : [250, 248, 243];
  }

  function mix(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)
    ];
  }

  /* ================================================================== *
   * 2. The view model
   *
   * One of these lives for as long as a cross-stitch project is on screen.
   * It owns the decoded cell grid, the live progress bitmap and the two
   * offscreen images every canvas blits from, so a tap is a handful of byte
   * writes rather than a re-render.
   * ================================================================== */

  var view = null;

  function freshView(p) {
    return {
      projectId: p.id,
      nodes: null,
      shape: null,         // 'cells' | 'pages' — which screen was built
      data: null,          // the live craftData, so draw() never re-reads Store
      charts: [],          // mounted chart canvases (strip + full sheet)
      live: null,          // the tap-button preview canvas
      cx: 0, cy: 0,        // crosshair (a view detail; taps persist their own)
      w: 0, h: 0,
      cells: null,
      cellsKey: null,
      bits: null,
      doneKey: null,
      // one bitsState per extra layer, indexed the same way as chart.back /
      // chart.knots / chart.part, so marking one is a single byte write
      backBits: null, backKey: null,
      knotBits: null, knotKey: null,
      partBits: null, partKey: null,
      tapLayer: 'cross',   // what the big button is counting right now
      tapLayerColour: -1,
      sizeBytes: null,     // cached X.dataSize; re-measured when the chart changes
      paletteKey: null,
      fabricKey: null,
      img: null, imgCanvas: null,        // chart look: pale swatches + done
      liveImg: null, liveCanvas: null,   // button preview: fabric + done only
      cursor: 0,
      isolate: false,
      sortMode: 'key',
      stats: null,
      pageUrl: null,
      pageKey: null,
      destroyed: false
    };
  }

  function currentEntry(data) {
    var pal = data.palette;
    if (!pal.length) return null;
    var i = clampInt(data.current.paletteIndex, 0, pal.length - 1, 0);
    return pal[i];
  }

  function hasChart(data) { return !!(data.chart && data.chart.w && data.chart.h); }

  /** Rebuild every cache from craftData. Cheap enough to call on any change. */
  function syncModel(data) {
    if (!view) return;
    view.data = data;
    var chart = data.chart;

    if (hasChart(data)) {
      var key = chart.cells.data;
      if (view.cellsKey !== key || view.w !== chart.w || view.h !== chart.h) {
        view.w = chart.w;
        view.h = chart.h;
        view.cells = X.unpackCells(chart.cells);
        view.cellsKey = key;
        view.img = null;
        view.stats = null;
        view.cursor = 0;
        view.sizeBytes = null;     // re-measure once, not on every tap
      }
      if (view.doneKey !== data.progress.done || !view.bits) {
        view.bits = X.bitsState(data.progress.done, view.w * view.h);
        view.doneKey = data.progress.done;
        view.img = null;
        view.stats = null;
      }
      /* The extra layers are tiny lists, so their bitmaps are decoded whole
         whenever the stored string changes. They are drawn as vectors over the
         cell image, so they never invalidate view.img. */
      if (view.backKey !== data.progress.doneBack || !view.backBits) {
        view.backBits = X.bitsState(data.progress.doneBack, chart.back.length);
        view.backKey = data.progress.doneBack;
        view.stats = null;
      }
      if (view.knotKey !== data.progress.doneKnots || !view.knotBits) {
        view.knotBits = X.bitsState(data.progress.doneKnots, chart.knots.length);
        view.knotKey = data.progress.doneKnots;
        view.stats = null;
      }
      if (view.partKey !== data.progress.donePart || !view.partBits) {
        view.partBits = X.bitsState(data.progress.donePart, chart.part.length);
        view.partKey = data.progress.donePart;
        view.stats = null;
      }
    } else {
      view.w = 0; view.h = 0; view.cells = null; view.bits = null;
      view.backBits = null; view.knotBits = null; view.partBits = null;
      view.backKey = null; view.knotKey = null; view.partKey = null;
      view.img = null; view.liveImg = null;
      view.stats = null;
    }

    var palKey = paletteSignature(data);
    var fabKey = String(data.fabric.color) + '|' + (view.isolate ? data.current.paletteIndex : 'x') +
      '|' + (view.isolate ? '1' : '0');
    if (view.paletteKey !== palKey || view.fabricKey !== fabKey) {
      view.paletteKey = palKey;
      view.fabricKey = fabKey;
      view.img = null;
      view.stats = null;
    }

    view.cx = clampInt(data.current.cx, 0, Math.max(0, view.w - 1), 0);
    view.cy = clampInt(data.current.cy, 0, Math.max(0, view.h - 1), 0);
    // progressStats walks every cell and decodes the whole bitmap, which is
    // 50,000 iterations on a 200x250 chart — far too much for a tap. The
    // single-cell paths keep the tallies up to date themselves (bumpStats)
    // and only bulk edits, imports and undo force a full recount.
    if (!view.stats) view.stats = X.progressStats(data);
    if (hasChart(data) && !view.img) buildImages(data);
  }

  /**
   * Keep view.stats in step with a one-item change, instead of recounting.
   * `layer` is 'cross' (the default), 'back', 'knots' or 'part'; `pis` is the
   * palette index, or an array of them for a fractional shared by two colours
   * (it counts towards each colour but only once in the totals).
   */
  function bumpStats(pis, delta, layer) {
    if (!view || !view.stats) return;
    layer = layer || 'cross';
    var s = view.stats;
    var list = typeof pis === 'number' ? [pis] : (pis || []);
    for (var k = 0; k < list.length; k++) {
      var c = s.byColor[list[k]];
      if (!c) continue;
      var t = layer === 'cross' ? c : c[layer];
      if (!t) continue;
      t.done = Math.max(0, Math.min(t.total || Infinity, t.done + delta));
      c.complete = colourComplete(c);
    }
    if (s.breakdown && s.breakdown[layer]) {
      var b = s.breakdown[layer];
      b.done = Math.max(0, Math.min(b.total || Infinity, b.done + delta));
    }
    s.done = Math.max(0, s.done + delta);
    s.pct = s.total > 0 ? Math.round(s.done / s.total * 100) : 0;
  }

  /** Every layer of one colour finished. */
  function colourComplete(c) {
    if (!c) return false;
    var t = c.total + c.back.total + c.knots.total + c.part.total;
    var d = c.done + c.back.done + c.knots.done + c.part.done;
    return t > 0 && d >= t;
  }

  /** The palette indexes a fractional stitch belongs to. */
  function partColours(p) {
    var out = [];
    if (!p) return out;
    if (p.a >= 0) out.push(p.a);
    if (p.b >= 0 && p.b !== p.a) out.push(p.b);
    return out;
  }

  function paletteSignature(data) {
    var out = [];
    for (var i = 0; i < data.palette.length; i++) out.push(data.palette[i].hex);
    return out.join(',');
  }

  /** The two offscreen images every canvas draws from. */
  function buildImages(data) {
    var w = view.w, h = view.h, n = w * h;
    if (!n) return;
    var ground = fabricRgb(data);
    var pal = data.palette;
    var cur = clampInt(data.current.paletteIndex, 0, Math.max(0, pal.length - 1), 0);

    // Per-palette-entry lookup tables: done colour and not-done pale colour.
    var doneR = new Uint8Array(pal.length), doneG = new Uint8Array(pal.length), doneB = new Uint8Array(pal.length);
    var paleR = new Uint8Array(pal.length), paleG = new Uint8Array(pal.length), paleB = new Uint8Array(pal.length);
    for (var k = 0; k < pal.length; k++) {
      var rgb = X.hexToRgb(pal[k].hex) || [128, 128, 128];
      var pale = mix(ground, rgb, view.isolate && k !== cur ? 0.12 : 0.34);
      doneR[k] = rgb[0]; doneG[k] = rgb[1]; doneB[k] = rgb[2];
      if (view.isolate && k !== cur) {
        var faded = mix(ground, rgb, 0.45);
        doneR[k] = faded[0]; doneG[k] = faded[1]; doneB[k] = faded[2];
      }
      paleR[k] = pale[0]; paleG[k] = pale[1]; paleB[k] = pale[2];
    }

    var img = new ImageData(w, h);
    var live = new ImageData(w, h);
    var d = img.data, l = live.data;
    var cells = view.cells, bits = view.bits.bytes;
    for (var i = 0; i < n; i++) {
      var o = i << 2;
      var v = cells[i];
      var doneBit = (bits[i >> 3] >> (i & 7)) & 1;
      l[o] = ground[0]; l[o + 1] = ground[1]; l[o + 2] = ground[2]; l[o + 3] = 255;
      if (v < 0 || v >= pal.length) {
        d[o] = ground[0]; d[o + 1] = ground[1]; d[o + 2] = ground[2]; d[o + 3] = 255;
        continue;
      }
      if (doneBit) {
        d[o] = doneR[v]; d[o + 1] = doneG[v]; d[o + 2] = doneB[v]; d[o + 3] = 255;
        l[o] = doneR[v]; l[o + 1] = doneG[v]; l[o + 2] = doneB[v];
      } else {
        d[o] = paleR[v]; d[o + 1] = paleG[v]; d[o + 2] = paleB[v]; d[o + 3] = 255;
      }
    }
    view.img = img;
    view.liveImg = live;
    view.imgCanvas = imageCanvas(img, view.imgCanvas);
    view.liveCanvas = imageCanvas(live, view.liveCanvas);
    view.paintTables = { doneR: doneR, doneG: doneG, doneB: doneB, paleR: paleR, paleG: paleG, paleB: paleB, ground: ground };
  }

  function imageCanvas(img, reuse) {
    var c = reuse;
    if (!c || c.width !== img.width || c.height !== img.height) {
      c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
    }
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
  }

  /** One cell changed: poke four bytes in each image instead of rebuilding. */
  function paintCell(i, doneBit) {
    if (!view || !view.img || !view.paintTables) return;
    var v = view.cells[i];
    if (v < 0) return;
    var t = view.paintTables;
    var o = i << 2;
    var d = view.img.data, l = view.liveImg.data;
    if (doneBit) {
      d[o] = t.doneR[v]; d[o + 1] = t.doneG[v]; d[o + 2] = t.doneB[v];
      l[o] = t.doneR[v]; l[o + 1] = t.doneG[v]; l[o + 2] = t.doneB[v];
    } else {
      d[o] = t.paleR[v]; d[o + 1] = t.paleG[v]; d[o + 2] = t.paleB[v];
      l[o] = t.ground[0]; l[o + 1] = t.ground[1]; l[o + 2] = t.ground[2];
    }
    var x = i % view.w, y = (i / view.w) | 0;
    view.imgCanvas.getContext('2d').putImageData(view.img, 0, 0, x, y, 1, 1);
    view.liveCanvas.getContext('2d').putImageData(view.liveImg, 0, 0, x, y, 1, 1);
  }

  function redrawAll() {
    for (var i = 0; i < view.charts.length; i++) view.charts[i].invalidate();
    if (view.live) view.live.invalidate();
  }

  /* ================================================================== *
   * 3. The chart canvas
   *
   * A 1px-per-cell offscreen image blitted with imageSmoothingEnabled=false,
   * so panning a 500x700 chart is one drawImage per frame. Gridlines and
   * symbols only appear once a cell is at least 8 CSS px wide.
   * ================================================================== */

  var GRID_MIN_PX = 8;

  /* Which half of a cell a fractional stitch fills. OXS `direction` 1-4 names
     one of the four corner triangles; when the part stitch carries a second
     palette index that colour takes the complementary half. */
  var TRI_UL = [[0, 0], [1, 0], [0, 1]], TRI_LR = [[1, 0], [1, 1], [0, 1]];
  var TRI_UR = [[0, 0], [1, 0], [1, 1]], TRI_LL = [[0, 0], [0, 1], [1, 1]];
  var PART_TRIS = {
    1: [TRI_UL, TRI_LR],
    2: [TRI_LR, TRI_UL],
    3: [TRI_UR, TRI_LL],
    4: [TRI_LL, TRI_UR]
  };

  function drawTri(g, x, y, z, d, half, style) {
    var pair = PART_TRIS[d] || PART_TRIS[1];
    var t = pair[half] || pair[0];
    g.beginPath();
    g.moveTo(x + t[0][0] * z, y + t[0][1] * z);
    g.lineTo(x + t[1][0] * z, y + t[1][1] * z);
    g.lineTo(x + t[2][0] * z, y + t[2][1] * z);
    g.closePath();
    g.fillStyle = style;
    g.fill();
  }

  function makeChartView(opts) {
    opts = opts || {};
    var wrap = el('div', 'xs-chart-wrap' + (opts.cls ? ' ' + opts.cls : ''));
    var canvas = document.createElement('canvas');
    canvas.className = 'xs-chart';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Chart');
    wrap.appendChild(canvas);

    var coord = el('div', 'xs-coord');
    wrap.appendChild(coord);

    var st = { z: 0, ox: 0, oy: 0, fitted: false };
    var pending = false;
    var ro = null;
    var pointers = {};
    var pinch = null;
    var painting = null;
    var lastTapAt = 0;
    var destroyed = false;

    function cssSize() {
      var r = canvas.getBoundingClientRect();
      return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    }

    function fit() {
      var s = cssSize();
      if (!view.w || !view.h) return;
      var z = Math.min(s.w / view.w, s.h / view.h);
      if (!(z > 0)) z = 1;
      st.z = z;
      st.ox = (s.w - view.w * z) / 2;
      st.oy = (s.h - view.h * z) / 2;
      st.fitted = true;
      invalidate();
    }

    function clampPan() {
      var s = cssSize();
      var cw = view.w * st.z, ch = view.h * st.z;
      if (cw <= s.w) st.ox = (s.w - cw) / 2;
      else st.ox = Math.min(0, Math.max(s.w - cw, st.ox));
      if (ch <= s.h) st.oy = (s.h - ch) / 2;
      else st.oy = Math.min(0, Math.max(s.h - ch, st.oy));
    }

    function invalidate() {
      if (pending || destroyed) return;
      pending = true;
      window.requestAnimationFrame(function () {
        pending = false;
        draw();
      });
    }

    function draw() {
      if (destroyed || !view || !view.imgCanvas) return;
      var s = cssSize();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var pw = Math.round(s.w * dpr), ph = Math.round(s.h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
        if (!st.fitted) fit();
      }
      var g = canvas.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.imageSmoothingEnabled = false;

      var ground = view.paintTables ? view.paintTables.ground : [250, 248, 243];
      g.fillStyle = 'rgb(' + ground[0] + ',' + ground[1] + ',' + ground[2] + ')';
      g.fillRect(0, 0, s.w, s.h);

      var z = st.z;
      g.drawImage(view.imgCanvas, 0, 0, view.w, view.h, st.ox, st.oy, view.w * z, view.h * z);

      if (z >= GRID_MIN_PX) drawGrid(g, s, z);
      if (z >= GRID_MIN_PX * 1.5) drawSymbols(g, s, z);
      if (z >= GRID_MIN_PX) drawExtras(g, s, z);
      drawCrosshair(g, z);
    }

    /**
     * Backstitch, knots/beads and fractionals, over the cell image. Same
     * visual language as the cells: done is the floss colour at full strength,
     * not-done is thinner and washed towards the fabric (a knot goes from
     * filled disc to open ring). Under 8 px per cell they are unreadable
     * scribble on a phone, so they simply do not appear.
     */
    function drawExtras(g, s, z) {
      var data = view.data;
      var chart = data && data.chart;
      if (!chart) return;
      var pal = data.palette;
      var ground = view.paintTables ? view.paintTables.ground : [250, 248, 243];
      var i;

      function ink(pi, done) {
        var rgb = (pi >= 0 && pi < pal.length && X.hexToRgb(pal[pi].hex)) || [24, 24, 24];
        if (done) return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
        var m = mix(ground, rgb, 0.38);
        return 'rgb(' + m[0] + ',' + m[1] + ',' + m[2] + ')';
      }

      var part = chart.part, pbits = view.partBits;
      for (i = 0; i < part.length; i++) {
        var p = part[i];
        var px = st.ox + p.x * z, py = st.oy + p.y * z;
        if (px + z < 0 || py + z < 0 || px > s.w || py > s.h) continue;
        var pd = pbits ? ((pbits.bytes[i >> 3] >> (i & 7)) & 1) : 0;
        drawTri(g, px, py, z, p.d, 0, ink(p.a, pd));
        if (p.b >= 0) drawTri(g, px, py, z, p.d, 1, ink(p.b, pd));
      }

      var back = chart.back, bbits = view.backBits;
      g.lineCap = 'round';
      for (i = 0; i < back.length; i++) {
        var b = back[i];
        var x1 = st.ox + b.x1 * z, y1 = st.oy + b.y1 * z;
        var x2 = st.ox + b.x2 * z, y2 = st.oy + b.y2 * z;
        if (Math.max(x1, x2) < 0 || Math.max(y1, y2) < 0 ||
            Math.min(x1, x2) > s.w || Math.min(y1, y2) > s.h) continue;
        var bd = bbits ? ((bbits.bytes[i >> 3] >> (i & 7)) & 1) : 0;
        g.beginPath();
        g.lineWidth = bd ? Math.max(2, z * 0.18) : Math.max(1, z * 0.085);
        g.strokeStyle = ink(b.i, bd);
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
      }

      var knots = chart.knots, kbits = view.knotBits;
      for (i = 0; i < knots.length; i++) {
        var k = knots[i];
        var kx = st.ox + k.x * z, ky = st.oy + k.y * z;
        if (kx < -z || ky < -z || kx > s.w + z || ky > s.h + z) continue;
        var kd = kbits ? ((kbits.bytes[i >> 3] >> (i & 7)) & 1) : 0;
        g.beginPath();
        g.arc(kx, ky, Math.max(2, z * 0.26), 0, Math.PI * 2);
        if (kd) {
          g.fillStyle = ink(k.i, 1);
          g.fill();
        } else {
          g.lineWidth = Math.max(1, z * 0.09);
          g.strokeStyle = ink(k.i, 0);
          g.stroke();
        }
      }
    }

    function drawGrid(g, s, z) {
      var x0 = Math.max(0, Math.floor(-st.ox / z));
      var x1 = Math.min(view.w, Math.ceil((s.w - st.ox) / z));
      var y0 = Math.max(0, Math.floor(-st.oy / z));
      var y1 = Math.min(view.h, Math.ceil((s.h - st.oy) / z));
      var x, y;
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(0,0,0,0.16)';
      g.beginPath();
      for (x = x0; x <= x1; x++) {
        if (x % 10 === 0) continue;
        var px = Math.round(st.ox + x * z) + 0.5;
        g.moveTo(px, Math.max(0, st.oy));
        g.lineTo(px, Math.min(s.h, st.oy + view.h * z));
      }
      for (y = y0; y <= y1; y++) {
        if (y % 10 === 0) continue;
        var py = Math.round(st.oy + y * z) + 0.5;
        g.moveTo(Math.max(0, st.ox), py);
        g.lineTo(Math.min(s.w, st.ox + view.w * z), py);
      }
      g.stroke();

      // 10x10 majors, aligned to the gridding on the fabric.
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.beginPath();
      for (x = x0 - (x0 % 10); x <= x1; x += 10) {
        var mx = Math.round(st.ox + x * z) + 0.5;
        g.moveTo(mx, Math.max(0, st.oy));
        g.lineTo(mx, Math.min(s.h, st.oy + view.h * z));
      }
      for (y = y0 - (y0 % 10); y <= y1; y += 10) {
        var my = Math.round(st.oy + y * z) + 0.5;
        g.moveTo(Math.max(0, st.ox), my);
        g.lineTo(Math.min(s.w, st.ox + view.w * z), my);
      }
      g.stroke();
    }

    function drawSymbols(g, s, z) {
      var data = view.data;
      if (!data) return;
      var pal = data.palette;
      var x0 = Math.max(0, Math.floor(-st.ox / z));
      var x1 = Math.min(view.w, Math.ceil((s.w - st.ox) / z));
      var y0 = Math.max(0, Math.floor(-st.oy / z));
      var y1 = Math.min(view.h, Math.ceil((s.h - st.oy) / z));
      g.font = Math.floor(z * 0.78) + 'px ' + 'ui-monospace, Menlo, Consolas, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (var y = y0; y < y1; y++) {
        for (var x = x0; x < x1; x++) {
          var i = y * view.w + x;
          var v = view.cells[i];
          if (v < 0 || v >= pal.length) continue;
          var e = pal[v];
          if (!e.symbol) continue;
          var doneBit = (view.bits.bytes[i >> 3] >> (i & 7)) & 1;
          g.fillStyle = doneBit
            ? (X.symbolInk(e.hex) === 'light' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)')
            : 'rgba(0,0,0,0.78)';
          g.fillText(e.symbol, st.ox + (x + 0.5) * z, st.oy + (y + 0.55) * z);
        }
      }
    }

    function drawCrosshair(g, z) {
      var cx = clampInt(view.cx, 0, Math.max(0, view.w - 1), 0);
      var cy = clampInt(view.cy, 0, Math.max(0, view.h - 1), 0);
      var x = st.ox + cx * z, y = st.oy + cy * z;
      var size = Math.max(z, 6);
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(255,60,60,0.95)';
      g.strokeRect(x - 1, y - 1, size + 2, size + 2);
    }

    /* ---- pointer handling ---- */

    /* `fx`/`fy` are the same point in fractional cell units: the backstitch
       lattice runs on the cell corners, so a hit test needs them. */
    function cellAt(clientX, clientY) {
      var r = canvas.getBoundingClientRect();
      var fx = (clientX - r.left - st.ox) / st.z;
      var fy = (clientY - r.top - st.oy) / st.z;
      var x = Math.floor(fx), y = Math.floor(fy);
      if (x < 0 || y < 0 || x >= view.w || y >= view.h) return null;
      return { x: x, y: y, i: y * view.w + x, fx: fx, fy: fy };
    }

    function showCoord(c) {
      coord.textContent = c ? ('col ' + (c.x + 1) + ' · row ' + (c.y + 1)) : '';
    }

    function ptrList() {
      var out = [];
      for (var k in pointers) out.push(pointers[k]);
      return out;
    }

    on(canvas, 'pointerdown', function (e) {
      if (!view.w) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      var list = ptrList();
      if (list.length === 2) {
        pinch = pinchState(list);
        painting = null;
      } else if (opts.interactive && opts.paintMode && opts.paintMode()) {
        painting = { last: -1 };
        var c0 = cellAt(e.clientX, e.clientY);
        if (c0) { opts.onPaint(c0); painting.last = c0.i; showCoord(c0); }
      }
      e.preventDefault();
    });

    function pinchState(list) {
      var dx = list[0].x - list[1].x, dy = list[0].y - list[1].y;
      var r = canvas.getBoundingClientRect();
      return {
        dist: Math.max(1, Math.sqrt(dx * dx + dy * dy)),
        z: st.z,
        mx: (list[0].x + list[1].x) / 2 - r.left,
        my: (list[0].y + list[1].y) / 2 - r.top,
        cx: ((list[0].x + list[1].x) / 2 - r.left - st.ox) / st.z,
        cy: ((list[0].y + list[1].y) / 2 - r.top - st.oy) / st.z
      };
    }

    on(canvas, 'pointermove', function (e) {
      var p = pointers[e.pointerId];
      if (!p) {
        if (!('ontouchstart' in window)) showCoord(cellAt(e.clientX, e.clientY));
        return;
      }
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.abs(e.clientX - p.sx) > 4 || Math.abs(e.clientY - p.sy) > 4) p.moved = true;

      var list = ptrList();
      if (list.length === 2 && pinch) {
        var ddx = list[0].x - list[1].x, ddy = list[0].y - list[1].y;
        var dist = Math.max(1, Math.sqrt(ddx * ddx + ddy * ddy));
        var z = Math.max(0.05, Math.min(64, pinch.z * (dist / pinch.dist)));
        st.z = z;
        st.ox = pinch.mx - pinch.cx * z;
        st.oy = pinch.my - pinch.cy * z;
        clampPan();
        invalidate();
        e.preventDefault();
        return;
      }
      if (painting) {
        var c = cellAt(e.clientX, e.clientY);
        // Crosses only need a new cell to be worth another call; the vector
        // layers hit-test off the exact point, so they want every move (they
        // de-duplicate on the item they hit).
        var every = opts.paintEvery && opts.paintEvery();
        if (c && (every || c.i !== painting.last)) {
          opts.onPaint(c);
          painting.last = c.i;
          showCoord(c);
        }
        e.preventDefault();
        return;
      }
      st.ox += dx;
      st.oy += dy;
      clampPan();
      invalidate();
      e.preventDefault();
    });

    function endPointer(e) {
      var p = pointers[e.pointerId];
      delete pointers[e.pointerId];
      if (ptrList().length < 2) pinch = null;
      if (painting && !ptrList().length) painting = null;
      if (!p) return;
      if (p.moved) return;

      var now = Date.now();
      if (now - lastTapAt < 320) {
        lastTapAt = 0;
        fit();
        return;
      }
      lastTapAt = now;

      var c = cellAt(e.clientX, e.clientY);
      if (!c) return;
      showCoord(c);
      if (opts.interactive && opts.onTap) opts.onTap(c);
      else if (opts.onMove) opts.onMove(c);
    }
    on(canvas, 'pointerup', endPointer);
    on(canvas, 'pointercancel', endPointer);

    on(canvas, 'wheel', function (e) {
      if (!view.w) return;
      e.preventDefault();
      var r = canvas.getBoundingClientRect();
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      var cx = (mx - st.ox) / st.z, cy = (my - st.oy) / st.z;
      var z = Math.max(0.05, Math.min(64, st.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      st.z = z;
      st.ox = mx - cx * z;
      st.oy = my - cy * z;
      clampPan();
      invalidate();
    });

    if (window.ResizeObserver) {
      ro = new window.ResizeObserver(function () {
        st.fitted = false;
        invalidate();
      });
      ro.observe(canvas);
    }

    var api = {
      node: wrap,
      canvas: canvas,
      coord: coord,
      state: st,
      fit: fit,
      invalidate: invalidate,
      zoomBy: function (f) {
        var s = cssSize();
        var cx = (s.w / 2 - st.ox) / st.z, cy = (s.h / 2 - st.oy) / st.z;
        st.z = Math.max(0.05, Math.min(64, st.z * f));
        st.ox = s.w / 2 - cx * st.z;
        st.oy = s.h / 2 - cy * st.z;
        clampPan();
        invalidate();
      },
      centerOn: function (x, y) {
        var s = cssSize();
        st.ox = s.w / 2 - (x + 0.5) * st.z;
        st.oy = s.h / 2 - (y + 0.5) * st.z;
        clampPan();
        invalidate();
      },
      destroy: function () {
        destroyed = true;
        if (ro) { try { ro.disconnect(); } catch (e) { /* ignore */ } ro = null; }
        var i = view ? view.charts.indexOf(api) : -1;
        if (i >= 0) view.charts.splice(i, 1);
      }
    };
    view.charts.push(api);
    return api;
  }

  /* ================================================================== *
   * 4. The project screen
   * ================================================================== */

  function renderProject(project, main, ctx) {
    useCtx(ctx);
    var data = dataOf(project);

    var shape = hasChart(data) ? 'cells' : 'pages';
    var rebuild = !view || view.projectId !== project.id || !view.nodes ||
      !view.nodes.bar || view.nodes.bar.parentNode !== main || view.shape !== shape;

    if (rebuild) {
      var keepIsolate = view && view.projectId === project.id ? view.isolate : false;
      var keepSort = view && view.projectId === project.id ? view.sortMode : 'key';
      destroyProject();
      view = freshView(project);
      view.isolate = keepIsolate;
      view.sortMode = keepSort;
      view.shape = shape;
      syncModel(data);
      clear(main);
      var n = buildScreen(project, data);
      // Appended straight into #craft-body so the shell's own .craft-body
      // rules — the scrolling column and the sticky bottom bar — apply.
      for (var s = 0; s < n.parts.length; s++) main.appendChild(n.parts[s]);
      // Canvases size themselves from layout, so fit after the first paint.
      window.requestAnimationFrame(function () {
        if (!view || view.destroyed) return;
        for (var i = 0; i < view.charts.length; i++) view.charts[i].fit();
        if (view.live) view.live.invalidate();
      });
    } else {
      syncModel(data);
    }
    syncScreen(project, data);
  }

  function destroyProject() {
    if (!view) return;
    view.destroyed = true;
    for (var i = view.charts.length - 1; i >= 0; i--) {
      try { view.charts[i].destroy(); } catch (e) { /* ignore */ }
    }
    if (view.pageUrl) {
      try { URL.revokeObjectURL(view.pageUrl); } catch (e2) { /* ignore */ }
    }
    view = null;
  }

  function buildScreen(project, data) {
    var n = { parts: [] };

    /* --- 1. chart strip (or page image, or a nudge to import) --- */
    n.chartCard = el('section', 'card xs-chart-card');
    if (hasChart(data)) {
      n.chart = makeChartView({
        cls: 'xs-strip',
        interactive: false,
        onMove: function (c) { setCrosshair(c.x, c.y); }
      });
      n.chartCard.appendChild(n.chart.node);
      var expand = button('xs-expand', '⤢', 'Open the full chart');
      on(expand, 'click', function () { openChartSheet(project.id); });
      n.chart.node.appendChild(expand);
    } else {
      n.pageFrame = el('div', 'xs-page-frame');
      n.pageImg = el('img', 'xs-page-img');
      n.pageImg.alt = 'Chart page';
      n.pageFrame.appendChild(n.pageImg);
      n.pageEmpty = el('div', 'xs-page-empty');
      n.pageFrame.appendChild(n.pageEmpty);
      n.chartCard.appendChild(n.pageFrame);
      n.pageBar = el('div', 'xs-pagebar');
      n.pagePrev = button('xs-page-nav', '‹', 'Previous page');
      n.pageLabel = el('span', 'xs-page-label');
      n.pageNext = button('xs-page-nav', '›', 'Next page');
      on(n.pagePrev, 'click', function () { stepPage(project.id, -1); });
      on(n.pageNext, 'click', function () { stepPage(project.id, 1); });
      n.pageBar.appendChild(n.pagePrev);
      n.pageBar.appendChild(n.pageLabel);
      n.pageBar.appendChild(n.pageNext);
      n.chartCard.appendChild(n.pageBar);
    }
    n.parts.push(n.chartCard);

    /* --- 2. current colour bar --- */
    n.colourBar = el('section', 'card xs-cb');
    n.cbPrev = button('xs-cb-nav', '‹', 'Previous colour');
    n.cbNext = button('xs-cb-nav', '›', 'Next colour');
    n.cbMain = button('xs-cb-main', null, 'Colour list');
    n.cbSwatch = el('span', 'xs-swatch');
    n.cbText = el('span', 'xs-cb-text');
    n.cbCode = el('span', 'xs-cb-code');
    n.cbSub = el('span', 'xs-cb-sub');
    n.cbText.appendChild(n.cbCode);
    n.cbText.appendChild(n.cbSub);
    n.cbMain.appendChild(n.cbSwatch);
    n.cbMain.appendChild(n.cbText);
    on(n.cbPrev, 'click', function () { stepColour(project.id, -1); });
    on(n.cbNext, 'click', function () { stepColour(project.id, 1); });
    on(n.cbMain, 'click', function () { openFlossSheet(project.id); });
    n.colourBar.appendChild(n.cbPrev);
    n.colourBar.appendChild(n.cbMain);
    n.colourBar.appendChild(n.cbNext);
    n.parts.push(n.colourBar);

    /* --- 3. the big tap button --- */
    var section = el('div', 'stitch-section');
    n.stitchBtn = button('stitch-btn has-diagram', null, 'Mark a stitch');
    n.stitchBtn.id = 'xs-stitch-btn';
    n.liveCanvas = document.createElement('canvas');
    n.liveCanvas.className = 'stitch-canvas xs-live';
    n.liveCanvas.setAttribute('aria-hidden', 'true');
    n.stitchBtn.appendChild(n.liveCanvas);
    n.stitchCap = el('span', 'stitch-caption', 'STITCHES');
    n.stitchNum = el('span', 'stitch-number', '0');
    n.stitchHint = el('span', 'stitch-hint', 'tap');
    n.stitchBtn.appendChild(n.stitchCap);
    n.stitchBtn.appendChild(n.stitchNum);
    n.stitchBtn.appendChild(n.stitchHint);
    section.appendChild(n.stitchBtn);
    bindStitchButton(n.stitchBtn, project.id);
    view.live = makeLivePreview(n.liveCanvas);

    n.readout = el('div', 'readout xs-readout');
    section.appendChild(n.readout);

    n.progress = el('div', 'progress slim');
    var barWrap = el('div', 'bar');
    n.barFill = el('div', 'bar-fill');
    barWrap.appendChild(n.barFill);
    n.progress.appendChild(barWrap);
    n.barLabel = el('div', 'bar-label');
    n.progress.appendChild(n.barLabel);
    section.appendChild(n.progress);

    var actions = el('div', 'xs-tap-actions');
    n.minus = button('btn ghost', '−1', 'Unmark the last stitch of this colour');
    on(n.minus, 'click', function () { unmarkOne(project.id); });
    n.reset = button('linkish', 'reset this colour');
    on(n.reset, 'click', function () { resetColour(project.id); });
    actions.appendChild(n.minus);
    actions.appendChild(n.reset);
    section.appendChild(actions);
    n.section = section;
    n.parts.push(section);

    /* --- 4. the colour key --- */
    n.keyCard = el('section', 'card xs-key-card');
    var keyHead = el('div', 'xs-key-head');
    keyHead.appendChild(el('h2', 'xs-h2', 'Colours'));
    var sortSeg = C.segmented(
      [{ id: 'key', label: 'Key' }, { id: 'left', label: 'Most left' }, { id: 'light', label: 'Lightness' }],
      view.sortMode,
      function (v) {
        view.sortMode = v;
        var p = Store.project(project.id);
        if (p) { buildKeyRows(p, dataOf(p)); syncScreen(p, dataOf(p)); }
      }
    );
    sortSeg.node.classList.add('xs-sort');
    keyHead.appendChild(sortSeg.node);
    n.keyCard.appendChild(keyHead);
    n.keyList = el('div', 'list xs-key-list');
    n.keyCard.appendChild(n.keyList);
    n.keyEmpty = el('p', 'muted xs-key-empty',
      'No colours yet. Use the ⋯ menu → Import pattern to drop in a PDF or an OXS chart, ' +
      'or add them by hand.');
    n.keyCard.appendChild(n.keyEmpty);
    var addBtn = button('btn ghost block', '＋ Add a colour');
    on(addBtn, 'click', function () { openColourEditor(project.id, -1); });
    n.keyCard.appendChild(addBtn);
    n.parts.push(n.keyCard);

    /* --- 5. bottom bar --- */
    var bar = el('div', 'bottombar');
    n.btnUndo = barButton('↶', 'Undo', function () {
      if (Store.undo()) {
        fb('undo');
        C.render();
        toast('Undone');
      } else {
        toast('Nothing to undo');
      }
    });
    n.btnWake = barButton('☀️', 'Awake', function () {
      var next = !Store.settings().keepAwake;
      Store.setSetting('keepAwake', next);
      C.render();
      toast(next ? 'Screen will stay awake' : 'Screen can sleep again');
    });
    n.btnChart = barButton('▦', 'Chart', function () { openChartSheet(project.id); });
    n.btnPages = barButton('📄', 'Pages', function () { openPagesSheet(project.id); });
    n.btnFloss = barButton('🧵', 'Floss', function () { openFlossSheet(project.id); });
    bar.appendChild(n.btnUndo);
    bar.appendChild(n.btnWake);
    bar.appendChild(n.btnChart);
    bar.appendChild(n.btnPages);
    bar.appendChild(n.btnFloss);
    n.bar = bar;
    n.parts.push(bar);

    view.nodes = n;
    buildKeyRows(project, data);
    return n;
  }

  function barButton(icon, label, run) {
    var b = button('bar-btn', null, label);
    b.appendChild(el('span', 'bar-icon', icon));
    b.appendChild(el('span', null, label));
    on(b, 'click', run);
    return b;
  }

  /* ---- the key list ------------------------------------------------- */

  function sortedPalette(data) {
    var idx = [];
    for (var i = 0; i < data.palette.length; i++) idx.push(i);
    if (view.sortMode === 'left') {
      var stats = view.stats || X.progressStats(data);
      idx.sort(function (a, b) {
        var la = leftOf(stats, a), lb = leftOf(stats, b);
        return lb - la || a - b;
      });
    } else if (view.sortMode === 'light') {
      idx.sort(function (a, b) {
        var la = X.hexToLab(data.palette[a].hex), lb = X.hexToLab(data.palette[b].hex);
        return (la ? la[0] : 50) - (lb ? lb[0] : 50) || a - b;
      });
    }
    return idx;
  }

  function leftOf(stats, i) {
    var c = stats.byColor[i];
    if (!c) return 0;
    return Math.max(0, c.total - c.done) +
      Math.max(0, c.back.total - c.back.done) +
      Math.max(0, c.knots.total - c.knots.done) +
      Math.max(0, c.part.total - c.part.done);
  }

  /**
   * '2 of 6 backstitch', '0 of 2 knots', '1 of 3 parts' — only for the layers
   * this colour actually has.
   */
  function extraBits(c) {
    var out = [];
    if (!c) return out;
    if (c.back && c.back.total) out.push(c.back.done + ' of ' + c.back.total + ' backstitch');
    if (c.knots && c.knots.total) out.push(c.knots.done + ' of ' + c.knots.total + ' knot' + (c.knots.total === 1 ? '' : 's'));
    if (c.part && c.part.total) out.push(c.part.done + ' of ' + c.part.total + ' part' + (c.part.total === 1 ? '' : 's'));
    return out;
  }

  function buildKeyRows(project, data) {
    var n = view.nodes;
    if (!n) return;
    clear(n.keyList);
    n.rows = [];
    n.keyEmpty.hidden = data.palette.length > 0;

    var order = sortedPalette(data);
    order.forEach(function (i) {
      var e = data.palette[i];
      var row = el('div', 'list-item xs-key-row');
      row.setAttribute('data-i', String(i));

      var mainBtn = button('xs-key-main', null, 'Work with ' + paletteLabel(e));
      var sw = el('span', 'xs-swatch', e.symbol || '');
      var text = el('span', 'xs-key-text');
      var code = el('span', 'xs-key-code');
      var sub = el('span', 'xs-key-sub');
      var prog = el('span', 'progress slim xs-key-prog');
      var pbar = el('span', 'bar');
      var pfill = el('span', 'bar-fill');
      pbar.appendChild(pfill);
      prog.appendChild(pbar);
      text.appendChild(code);
      text.appendChild(sub);
      text.appendChild(prog);
      mainBtn.appendChild(sw);
      mainBtn.appendChild(text);
      var tick = el('span', 'xs-key-tick', '✓');
      mainBtn.appendChild(tick);
      on(mainBtn, 'click', function () { setCurrentColour(project.id, i); });

      var iso = button('xs-key-iso', '◉', 'Isolate ' + paletteLabel(e) + ' on the chart');
      iso.setAttribute('aria-pressed', 'false');
      on(iso, 'click', function () { toggleIsolate(project.id, i); });

      var have = button('check xs-key-have', '', 'I own ' + paletteLabel(e));
      have.setAttribute('role', 'checkbox');
      have.setAttribute('aria-checked', e.have ? 'true' : 'false');
      on(have, 'click', function () { toggleHave(project.id, i); });

      var edit = button('xs-key-edit', '✎', 'Edit ' + paletteLabel(e));
      on(edit, 'click', function () { openColourEditor(project.id, i); });

      row.appendChild(mainBtn);
      row.appendChild(iso);
      row.appendChild(have);
      row.appendChild(edit);
      n.keyList.appendChild(row);
      n.rows.push({ i: i, row: row, sw: sw, code: code, sub: sub, fill: pfill, tick: tick, have: have, iso: iso });
    });
  }

  /* ---- syncing the screen from state -------------------------------- */

  function syncScreen(project, data) {
    var n = view.nodes;
    if (!n) return;
    var stats = view.stats || X.progressStats(data);
    var pal = data.palette;
    var cur = pal.length ? clampInt(data.current.paletteIndex, 0, pal.length - 1, 0) : -1;
    var e = cur >= 0 ? pal[cur] : null;

    /* rows may have gone stale (import, colour added) */
    if (!n.rows || n.rows.length !== pal.length) buildKeyRows(project, data);

    /* colour bar */
    if (e) {
      n.cbSwatch.textContent = e.symbol || '';
      n.cbSwatch.style.background = swatchHex(e);
      n.cbSwatch.style.color = X.symbolInk(e.hex) === 'light' ? '#fff' : '#111';
      n.cbCode.textContent = paletteLabel(e);
      var c = stats.byColor[cur] || { done: 0, total: 0 };
      var bits = [];
      if (c.total) bits.push(comma(c.total) + ' sts');
      bits.push(comma(Math.max(0, c.total - c.done)) + ' left');
      extraBits(c).forEach(function (b) { bits.push(b); });
      if (KIND_LABEL[e.kind]) bits.push(KIND_LABEL[e.kind]);
      n.cbSub.textContent = bits.join(' · ');
      n.colourBar.hidden = false;
    } else {
      n.cbSwatch.textContent = '';
      n.cbSwatch.style.background = 'transparent';
      n.cbCode.textContent = 'No colours yet';
      n.cbSub.textContent = 'Import a chart or add one by hand';
      n.colourBar.hidden = false;
    }

    /* tap button — its caption follows whatever this colour has left to do */
    var colourStat = cur >= 0 ? stats.byColor[cur] : null;
    var layer = cur >= 0 ? displayLayer(colourStat) : 'cross';
    var tally = layerTally(colourStat, layer) || { done: 0, total: 0 };
    if (cur >= 0 && (view.tapLayer !== layer || view.tapLayerColour !== cur)) {
      var switched = view.tapLayerColour === cur && view.tapLayer !== layer;
      view.tapLayer = layer;
      view.tapLayerColour = cur;
      if (switched) {
        C.announce(layer === 'cross'
          ? 'The button is counting stitches again'
          : 'Crosses done — the button is now counting ' + LAYER_NOUNS[layer]);
      }
    }
    n.stitchCap.textContent = X.tapCaption(layer);
    n.stitchNum.textContent = comma(tally.done);
    n.stitchBtn.disabled = cur < 0;
    n.stitchBtn.setAttribute('aria-label',
      e ? ('Mark a ' + LAYER_NOUN[layer] + ' of ' + paletteLabel(e) + ', ' + comma(tally.done) + ' done')
        : 'No colour selected');

    var group = clampInt(project.groupSize, 0, 50, 10);
    var readBits = [];
    if (layer === 'cross' && group > 0 && tally.done > 0) {
      readBits.push('Group ' + (Math.floor((tally.done - 1) / group) + 1) +
        ' · stitch ' + (((tally.done - 1) % group) + 1) + ' of ' + group);
    }
    if (tally.total) {
      readBits.push(comma(tally.done) + ' / ' + comma(tally.total) +
        (layer === 'cross' ? '' : ' ' + LAYER_NOUNS[layer]));
    }
    n.readout.textContent = readBits.join(' · ');
    n.readout.hidden = !readBits.length;

    var extras = stats.breakdown
      ? stats.breakdown.back.total + stats.breakdown.knots.total + stats.breakdown.part.total : 0;
    n.barFill.style.width = (stats.total ? Math.round(stats.done / stats.total * 100) : 0) + '%';
    n.barLabel.textContent = stats.total
      ? (comma(stats.done) + ' of ' + comma(stats.total) +
         (extras ? ' · ' : ' stitches · ') + stats.pct + '%')
      : 'No stitch counts yet';

    /* key rows */
    for (var r = 0; r < n.rows.length; r++) {
      var row = n.rows[r];
      var pe = pal[row.i];
      if (!pe) continue;
      var st = stats.byColor[row.i] ||
        { done: 0, total: 0, complete: false, back: { done: 0, total: 0 }, knots: { done: 0, total: 0 }, part: { done: 0, total: 0 } };
      row.sw.textContent = pe.symbol || '';
      row.sw.style.background = swatchHex(pe);
      row.sw.style.color = X.symbolInk(pe.hex) === 'light' ? '#fff' : '#111';
      row.code.textContent = paletteLabel(pe);
      var left = Math.max(0, st.total - st.done);
      var subBits = [];
      if (st.total) subBits.push(comma(left) + ' left of ' + comma(st.total));
      else if (st.done) subBits.push(comma(st.done) + ' done');
      extraBits(st).forEach(function (b) { subBits.push(b); });
      if (!subBits.length) subBits.push('no count yet');
      if (KIND_LABEL[pe.kind]) subBits.push(KIND_LABEL[pe.kind]);
      if (pe.strands) subBits.push(pe.strands + ' strand' + (pe.strands === 1 ? '' : 's'));
      row.sub.textContent = subBits.join(' · ');
      /* The bar and the ✓ cover every layer this colour has, so a colour with
         backstitch left is not ticked just because its crosses are done. */
      var allTotal = st.total + st.back.total + st.knots.total + st.part.total;
      var allDone = st.done + st.back.done + st.knots.done + st.part.done;
      row.fill.style.width = (allTotal ? Math.round(allDone / allTotal * 100) : 0) + '%';
      var complete = !!st.complete;
      row.tick.hidden = !complete;
      row.row.classList.toggle('current', row.i === cur);
      row.row.classList.toggle('complete', complete);
      row.row.classList.toggle('isolated', view.isolate && row.i === cur);
      var isolated = !!(view.isolate && row.i === cur);
      row.iso.classList.toggle('on', isolated);
      row.iso.setAttribute('aria-pressed', isolated ? 'true' : 'false');
      row.have.classList.toggle('on', !!pe.have);
      row.have.setAttribute('aria-checked', pe.have ? 'true' : 'false');
      row.have.textContent = pe.have ? '✓' : '';
    }

    /* image mode page strip */
    if (n.pageBar) syncPageStrip(project, data);

    /* bottom bar */
    n.btnWake.classList.toggle('on', !!Store.settings().keepAwake);
    /* The Pages sheet also holds the storage footer and the image-only escape
       hatch, so it stays reachable for an oversized chart that has no page
       images of its own. Measured once per chart, never on the tap path. */
    if (view.sizeBytes === null || view.sizeBytes === undefined) view.sizeBytes = X.dataSize(data);
    n.btnPages.disabled = !data.pages.length &&
      !(hasChart(data) && view.sizeBytes > X.SIZE_WARN_BYTES);
    n.btnChart.disabled = !hasChart(data);

    redrawAll();
  }

  function syncPageStrip(project, data) {
    var n = view.nodes;
    var pages = data.pages;
    if (!pages.length) {
      n.pageImg.hidden = true;
      n.pageEmpty.hidden = false;
      n.pageEmpty.textContent = 'No chart pages yet. Import a PDF or an OXS file from the ⋯ menu.';
      n.pageBar.hidden = true;
      return;
    }
    n.pageEmpty.hidden = true;
    n.pageBar.hidden = false;
    var idx = clampInt(data.current.page, 0, pages.length - 1, 0);
    var page = pages[idx];
    n.pageLabel.textContent = page.label + ' · ' + (idx + 1) + ' of ' + pages.length;
    n.pagePrev.disabled = idx <= 0;
    n.pageNext.disabled = idx >= pages.length - 1;

    if (view.pageKey === page.blobKey) return;
    view.pageKey = page.blobKey;
    n.pageImg.hidden = true;
    if (!window.BlobStore || !page.blobKey) {
      n.pageEmpty.hidden = false;
      n.pageEmpty.textContent = 'That page image is not on this device any more.';
      return;
    }
    window.BlobStore.get(page.blobKey).then(function (blob) {
      if (!view || view.destroyed || view.pageKey !== page.blobKey) return;
      if (view.pageUrl) { try { URL.revokeObjectURL(view.pageUrl); } catch (e) { /* ignore */ } }
      if (!blob) {
        n.pageImg.hidden = true;
        n.pageEmpty.hidden = false;
        n.pageEmpty.textContent = 'That page image is not on this device any more — re-import the PDF.';
        return;
      }
      view.pageUrl = URL.createObjectURL(blob);
      n.pageImg.src = view.pageUrl;
      n.pageImg.hidden = false;
      n.pageEmpty.hidden = true;
    });
  }

  /* ================================================================== *
   * 5. The tap button
   * ================================================================== */

  function makeLivePreview(canvas) {
    var pending = false;
    var api = {
      invalidate: function () {
        if (pending) return;
        pending = true;
        window.requestAnimationFrame(function () {
          pending = false;
          api.draw();
        });
      },
      draw: function () {
        if (!view || view.destroyed || !canvas.isConnected) return;
        var r = canvas.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var pw = Math.round(r.width * dpr), ph = Math.round(r.height * dpr);
        if (canvas.width !== pw || canvas.height !== ph) {
          canvas.width = pw;
          canvas.height = ph;
        }
        var g = canvas.getContext('2d');
        if (!g) return;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, pw, ph);
        if (!view.liveCanvas || !view.w) return;
        g.imageSmoothingEnabled = false;
        var pad = 10 * dpr;
        var z = Math.min((pw - pad * 2) / view.w, (ph - pad * 2) / view.h);
        if (!(z > 0)) return;
        var dw = view.w * z, dh = view.h * z;
        g.drawImage(view.liveCanvas, 0, 0, view.w, view.h,
          Math.round((pw - dw) / 2), Math.round((ph - dh) / 2), Math.round(dw), Math.round(dh));
      }
    };
    return api;
  }

  var MOVE_TOLERANCE_SQ = 12 * 12;

  function bindStitchButton(btn, projectId) {
    var tap = null;

    function end() {
      btn.classList.remove('pressed');
      if (tap) {
        try { btn.releasePointerCapture(tap.id); } catch (e) { /* ignore */ }
      }
      tap = null;
    }

    on(btn, 'pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (tap) return;
      tap = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false };
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      btn.classList.add('pressed');
      e.preventDefault();
    });

    on(btn, 'pointermove', function (e) {
      if (!tap || e.pointerId !== tap.id || tap.dragging) return;
      var dx = e.clientX - tap.x, dy = e.clientY - tap.y;
      if (dx * dx + dy * dy <= MOVE_TOLERANCE_SQ) return;
      // Past the tolerance this is a swipe, not a stitch. Nothing is counted
      // and nothing is undone — the same contract as the crochet button.
      tap.dragging = true;
      btn.classList.remove('pressed');
    });

    on(btn, 'pointerup', function (e) {
      if (!tap || e.pointerId !== tap.id) return;
      var counted = !tap.dragging;
      end();
      if (counted) advanceStitch(projectId);
    });
    on(btn, 'pointercancel', function () { end(); });
    on(btn, 'contextmenu', function (e) { e.preventDefault(); });
    // Keyboard activation (Enter/Space) arrives as a click with detail 0.
    on(btn, 'click', function (e) { if (e.detail === 0) advanceStitch(projectId); });
  }

  /** The next not-done cell of `pi` in reading order, or -1. */
  function nextCellFor(pi, from) {
    var cells = view.cells, bits = view.bits.bytes, n = cells.length;
    var start = clampInt(from, 0, n, 0);
    var i;
    for (i = start; i < n; i++) {
      if (cells[i] === pi && !((bits[i >> 3] >> (i & 7)) & 1)) return i;
    }
    for (i = 0; i < start; i++) {
      if (cells[i] === pi && !((bits[i >> 3] >> (i & 7)) & 1)) return i;
    }
    return -1;
  }

  /** The last done cell of `pi` in reading order, or -1. */
  function lastDoneCellFor(pi) {
    var cells = view.cells, bits = view.bits.bytes;
    for (var i = cells.length - 1; i >= 0; i--) {
      if (cells[i] === pi && ((bits[i >> 3] >> (i & 7)) & 1)) return i;
    }
    return -1;
  }

  /** The next not-done item of one extra layer for `pi`, in chart order. */
  function nextLayerItemFor(layer, pi) {
    var items = layerItems(view.data, layer);
    var state = view[LAYER_BITS[layer]];
    if (!state) return -1;
    for (var i = 0; i < items.length; i++) {
      if (((state.bytes[i >> 3] >> (i & 7)) & 1)) continue;
      if (layerColours(layer, items[i]).indexOf(pi) >= 0) return i;
    }
    return -1;
  }

  /** The last done item of one extra layer for `pi`, in chart order. */
  function lastLayerItemFor(layer, pi) {
    var items = layerItems(view.data, layer);
    var state = view[LAYER_BITS[layer]];
    if (!state) return -1;
    for (var i = items.length - 1; i >= 0; i--) {
      if (!((state.bytes[i >> 3] >> (i & 7)) & 1)) continue;
      if (layerColours(layer, items[i]).indexOf(pi) >= 0) return i;
    }
    return -1;
  }

  /**
   * What the button shows for one colour. `X.tapLayer` picks the next layer
   * with work left; when a colour is completely finished we keep showing the
   * layer it actually has, so a backstitch-only colour never reads "STITCHES 0".
   */
  function displayLayer(stat) {
    var l = X.tapLayer(stat);
    if (l) return l;
    if (!stat) return 'cross';
    if (stat.total > 0) return 'cross';
    if (stat.back.total > 0) return 'back';
    if (stat.knots.total > 0) return 'knots';
    if (stat.part.total > 0) return 'part';
    return 'cross';
  }

  /** The tally the button's big number is showing. */
  function layerTally(stat, layer) {
    if (!stat) return { done: 0, total: 0 };
    return layer === 'cross' ? { done: stat.done, total: stat.total } : stat[layer];
  }

  /** Which layer "−1" should take back: the most advanced one with work done. */
  function unmarkLayerFor(pi) {
    var c = view.stats && view.stats.byColor[pi];
    if (!c) return 'cross';
    if (c.part && c.part.done > 0) return 'part';
    if (c.knots && c.knots.done > 0) return 'knots';
    if (c.back && c.back.done > 0) return 'back';
    return 'cross';
  }

  function advanceStitch(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    if (!data.palette.length) {
      toast('Add a colour first');
      return;
    }
    var pi = clampInt(data.current.paletteIndex, 0, data.palette.length - 1, 0);
    var entry = data.palette[pi];
    var beforeByColor = snapshotByColor();
    var before = beforeByColor[pi] || { done: 0, total: 0 };

    if (hasChart(data) && data.progress.mode === 'cells') {
      /* Crosses first; when this colour has only backstitch, knots or
         fractionals left the same button walks those instead. */
      var stats = view.stats || X.progressStats(data);
      var layer = X.tapLayer(stats, pi);
      if (layer && layer !== 'cross') {
        var lidx = nextLayerItemFor(layer, pi);
        if (lidx >= 0) {
          // markLayerItem does its own feedback, re-sync and milestone check.
          markLayerItem(projectId, layer, lidx, true);
          return;
        }
      }
      var at = nextCellFor(pi, view.cursor);
      if (at < 0) {
        toast(paletteLabel(entry) + ' done ✓');
        fb('done');
        return;
      }
      X.setBit(view.bits, at, true);
      paintCell(at, 1);
      view.cursor = at + 1;
      var b64 = X.bitsB64(view.bits);
      var cx = at % view.w, cy = (at / view.w) | 0;
      Store.updateCraftData(projectId, function (cd) {
        cd.progress.done = b64;
        cd.progress.doneCount = (cd.progress.doneCount || 0) + 1;
        bumpPerColor(cd, pi, 1);
        cd.current.cx = cx;
        cd.current.cy = cy;
      });
      view.doneKey = b64;
      bumpStats(pi, 1);
    } else {
      if (entry.stitchCount && before.done >= entry.stitchCount) {
        toast(paletteLabel(entry) + ' done ✓');
        fb('done');
        return;
      }
      Store.updateCraftData(projectId, function (cd) {
        bumpPerColor(cd, pi, 1);
        cd.progress.doneCount = (cd.progress.doneCount || 0) + 1;
      });
      bumpStats(pi, 1);
    }

    afterCount(projectId, pi, before, beforeByColor);
  }

  function bumpPerColor(cd, pi, delta) {
    var list = cd.progress.perColor;
    for (var i = 0; i < list.length; i++) {
      if (list[i].i === pi) {
        list[i].done = Math.max(0, (list[i].done || 0) + delta);
        return;
      }
    }
    list.push({ i: pi, done: Math.max(0, delta) });
  }

  /**
   * A colour reaching its total, and the whole chart reaching its total, are
   * the two moments worth celebrating. Shared by the tap button and every
   * marking tool in the chart sheet.
   */
  function noteMilestones(projectId, beforeByColor) {
    var p = Store.project(projectId);
    if (!p || !view) return { colour: null, all: false };
    var data = view.data || dataOf(p);
    var stats = view.stats;
    var finishedColour = null;
    for (var i = 0; i < stats.byColor.length; i++) {
      var after = stats.byColor[i];
      var before = beforeByColor && beforeByColor[i] ? beforeByColor[i] : { done: 0, total: 0, complete: false };
      // "Finished" now means every layer of that colour: crosses, backstitch,
      // knots and fractionals.
      if (after.complete && !before.complete) {
        finishedColour = i;
        break;
      }
    }
    var finishedAll = stats.total > 0 && stats.done >= stats.total;

    if (finishedColour !== null) {
      var entry = data.palette[finishedColour];
      C.announce(paletteLabel(entry) + ' finished');
      toast(paletteLabel(entry) + ' done ✓');
      C.celebrate('part');
    }
    if (finishedAll && p.status !== 'finished') {
      Store.setStatus(projectId, 'finished');
      C.celebrate('project');
      toast('Every stitch is done 🎉');
      C.render();
    }
    return { colour: finishedColour, all: finishedAll };
  }

  /** Feedback, milestones and the narrow re-sync after one counted stitch. */
  function afterCount(projectId, pi, before, beforeByColor) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    syncModel(data);
    var stats = view.stats;
    var after = stats.byColor[pi] || { done: 0, total: 0, complete: false };
    var entry = data.palette[pi];
    var group = clampInt(p.groupSize, 0, 50, 10);

    var finishedColour = !!after.complete && !before.complete;
    if (finishedColour) fb('done');
    else if (group > 0 && after.done > 0 && after.done % group === 0) fb('group');
    else fb('tap');

    syncScreen(p, data);

    if (!finishedColour && after.total && after.done % 100 === 0) {
      C.announce(comma(after.done) + ' of ' + comma(after.total) + ' ' + (entry.name || entry.code));
    }
    noteMilestones(projectId, beforeByColor);
  }

  /** A deep-enough copy of the per-colour tallies to diff against later. */
  function snapshotByColor() {
    var out = [];
    if (!view || !view.stats) return out;
    for (var i = 0; i < view.stats.byColor.length; i++) {
      var c = view.stats.byColor[i];
      out.push({ done: c.done, total: c.total, complete: !!c.complete });
    }
    return out;
  }

  function unmarkOne(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    if (!data.palette.length) return;
    var pi = clampInt(data.current.paletteIndex, 0, data.palette.length - 1, 0);

    if (hasChart(data) && data.progress.mode === 'cells') {
      var undoLayer = unmarkLayerFor(pi);
      if (undoLayer !== 'cross') {
        var lidx = lastLayerItemFor(undoLayer, pi);
        if (lidx >= 0) {
          markLayerItem(projectId, undoLayer, lidx, false);
          fb('undo');
          return;
        }
      }
      var at = lastDoneCellFor(pi);
      if (at < 0) { toast('Nothing to undo'); return; }
      X.setBit(view.bits, at, false);
      paintCell(at, 0);
      view.cursor = at;
      var b64 = X.bitsB64(view.bits);
      Store.updateCraftData(projectId, function (cd) {
        cd.progress.done = b64;
        cd.progress.doneCount = Math.max(0, (cd.progress.doneCount || 0) - 1);
        bumpPerColor(cd, pi, -1);
        cd.current.cx = at % view.w;
        cd.current.cy = (at / view.w) | 0;
      });
      view.doneKey = b64;
      bumpStats(pi, -1);
    } else {
      var st = (view.stats.byColor[pi] || { done: 0 });
      if (st.done <= 0) { toast('Nothing to undo'); return; }
      Store.updateCraftData(projectId, function (cd) {
        bumpPerColor(cd, pi, -1);
        cd.progress.doneCount = Math.max(0, (cd.progress.doneCount || 0) - 1);
      });
      bumpStats(pi, -1);
    }
    fb('undo');
    var p2 = Store.project(projectId);
    var d2 = dataOf(p2);
    syncModel(d2);
    syncScreen(p2, d2);
  }

  function resetColour(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    if (!data.palette.length) return;
    var pi = clampInt(data.current.paletteIndex, 0, data.palette.length - 1, 0);
    var entry = data.palette[pi];
    C.confirmSheet({
      title: 'Reset ' + paletteLabel(entry) + '?',
      message: 'Every stitch you have marked in this colour goes back to not done.',
      confirmText: 'Reset',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      var p2 = Store.project(projectId);
      if (!p2) return;
      var d2 = dataOf(p2);
      if (hasChart(d2) && d2.progress.mode === 'cells') {
        var cells = view.cells;
        for (var i = 0; i < cells.length; i++) {
          if (cells[i] === pi) X.setBit(view.bits, i, false);
        }
        var b64 = X.bitsB64(view.bits);
        /* Backstitch, knots and fractionals of this colour go back too — the
           sheet says "every stitch you have marked in this colour". */
        var extras = {};
        ['back', 'knots', 'part'].forEach(function (layer) {
          var state = view[LAYER_BITS[layer]];
          var items = layerItems(d2, layer);
          if (!state || !items.length) return;
          for (var k = 0; k < items.length; k++) {
            if (layerColours(layer, items[k]).indexOf(pi) >= 0) X.setBit(state, k, false);
          }
          extras[layer] = X.bitsB64(state);
          view[LAYER_KEY[layer]] = extras[layer];
        });
        Store.updateCraftData(projectId, function (cd) {
          cd.progress.done = b64;
          cd.progress.doneCount = X.countBits(b64, view.w * view.h);
          Object.keys(extras).forEach(function (layer) {
            var f = LAYER_FIELD[layer];
            cd.progress[f[0]] = extras[layer];
            cd.progress[f[1]] = X.countBits(extras[layer], layerItems(cd, layer).length);
          });
          setPerColor(cd, pi, 0);
        });
        view.doneKey = b64;
        view.img = null;
        view.stats = null;
      } else {
        Store.updateCraftData(projectId, function (cd) { setPerColor(cd, pi, 0); });
        view.stats = null;
      }
      view.cursor = 0;
      fb('undo');
      C.render();
      toast('Reset ' + paletteLabel(entry));
    });
  }

  function setPerColor(cd, pi, value) {
    var list = cd.progress.perColor;
    for (var i = 0; i < list.length; i++) {
      if (list[i].i === pi) { list[i].done = value; return; }
    }
    list.push({ i: pi, done: value });
  }

  /* ---- small state changes ------------------------------------------ */

  function setCurrentColour(projectId, i) {
    Store.updateCraftData(projectId, function (cd) {
      cd.current.paletteIndex = i;
    });
    view.cursor = 0;
    var p = Store.project(projectId);
    var data = dataOf(p);
    if (view.isolate) view.img = null;
    syncModel(data);
    syncScreen(p, data);
    var e = data.palette[i];
    if (e) C.announce('Now stitching ' + paletteLabel(e));
  }

  function stepColour(projectId, delta) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    if (!data.palette.length) return;
    var n = data.palette.length;
    var next = (clampInt(data.current.paletteIndex, 0, n - 1, 0) + delta + n) % n;
    setCurrentColour(projectId, next);
  }

  function toggleIsolate(projectId, i) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    var cur = clampInt(data.current.paletteIndex, 0, Math.max(0, data.palette.length - 1), 0);
    if (view.isolate && cur === i) {
      view.isolate = false;
    } else {
      view.isolate = true;
      if (cur !== i) {
        setCurrentColour(projectId, i);
        view.isolate = true;
      }
    }
    view.img = null;
    var p2 = Store.project(projectId);
    var d2 = dataOf(p2);
    syncModel(d2);
    syncScreen(p2, d2);
  }

  function toggleHave(projectId, i) {
    Store.updateCraftData(projectId, function (cd) {
      var e = cd.palette[i];
      if (!e) return;
      e.have = !e.have;
      if (!cd.stash || typeof cd.stash !== 'object') cd.stash = {};
      if (e.have) cd.stash[e.code] = Math.max(1, clampInt(cd.stash[e.code], 0, 999, 0) || 1);
      else delete cd.stash[e.code];
    });
    var p = Store.project(projectId);
    var data = dataOf(p);
    syncModel(data);
    syncScreen(p, data);
  }

  /** Moving the crosshair is a view detail, so it never touches the undo stack. */
  function setCrosshair(x, y) {
    if (!view) return;
    view.cx = x;
    view.cy = y;
    redrawAll();
  }

  function stepPage(projectId, delta) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    if (!data.pages.length) return;
    var next = clampInt(data.current.page + delta, 0, data.pages.length - 1, 0);
    Store.updateCraftData(projectId, function (cd) { cd.current.page = next; });
    var p2 = Store.project(projectId);
    syncScreen(p2, dataOf(p2));
  }

  /* ================================================================== *
   * 6. Sheets
   * ================================================================== */

  /* ---- the full-screen chart ---------------------------------------- */

  var TOOLS = [
    { id: 'tap', label: 'Tap' },
    { id: 'paint', label: 'Drag' },
    { id: 'block', label: '10×10' },
    { id: 'page', label: 'Whole colour' }
  ];

  /* The four things a chart can hold. The switch decides what every mark tool
     acts on; layers the chart does not have are never offered. */
  /* Short labels: the theme font is Press Start 2P, which is a full em wide
     per character, so "Backstitch" alone would overflow 375 px. The hint under
     the chart always names the layer in full. */
  var LAYER_DEFS = [
    { id: 'cross', label: 'Crosses' },
    { id: 'back', label: 'Back' },
    { id: 'knots', label: 'Knots' },
    { id: 'part', label: 'Parts' }
  ];
  var LAYER_LIST = { back: 'back', knots: 'knots', part: 'part' };
  var LAYER_BITS = { back: 'backBits', knots: 'knotBits', part: 'partBits' };
  var LAYER_KEY = { back: 'backKey', knots: 'knotKey', part: 'partKey' };
  var LAYER_FIELD = {
    back: ['doneBack', 'doneBackCount'],
    knots: ['doneKnots', 'doneKnotsCount'],
    part: ['donePart', 'donePartCount']
  };
  var LAYER_NOUN = { cross: 'stitch', back: 'backstitch segment', knots: 'knot or bead', part: 'fractional' };
  var LAYER_NOUNS = { cross: 'stitches', back: 'backstitch segments', knots: 'knots and beads', part: 'fractionals' };

  function layerItems(data, layer) {
    var chart = data && data.chart;
    var name = LAYER_LIST[layer];
    if (!chart || !name) return [];
    return chart[name] || [];
  }

  function availableLayers(data) {
    var out = [LAYER_DEFS[0]];
    if (layerItems(data, 'back').length) out.push(LAYER_DEFS[1]);
    if (layerItems(data, 'knots').length) out.push(LAYER_DEFS[2]);
    if (layerItems(data, 'part').length) out.push(LAYER_DEFS[3]);
    return out;
  }

  /** Where on the grid one item of an extra layer lives, in cells. */
  function layerAnchor(layer, item) {
    if (layer === 'back') return { x: (item.x1 + item.x2) / 2, y: (item.y1 + item.y2) / 2 };
    if (layer === 'part') return { x: item.x + 0.5, y: item.y + 0.5 };
    return { x: item.x, y: item.y };
  }

  /** The palette indexes one item belongs to. */
  function layerColours(layer, item) {
    if (layer === 'part') return partColours(item);
    return item && item.i >= 0 ? [item.i] : [];
  }

  function openChartSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    if (!hasChart(data)) {
      toast('This project has no cell chart — import an OXS file or make one from a photo.');
      return;
    }
    var tool = 'tap';
    var layer = 'cross';
    var erase = false;
    var chart = null;

    C.openSheet({
      title: 'Chart',
      cls: 'sheet-chart',
      build: function (body) {
        var layers = availableLayers(data);
        var hint = el('p', 'muted xs-hint');

        function setHint() {
          hint.textContent = (layer === 'cross'
            ? 'Drag to pan, pinch or use the buttons to zoom, double-tap to fit. Symbols appear once the squares are big enough.'
            : 'Marking ' + LAYER_NOUNS[layer] + '. Tap one to mark it, or switch to Drag and sweep along them. ' +
              'Zoom in until the squares are big enough to see them.');
        }

        if (layers.length > 1) {
          var layerSeg = C.segmented(layers, layer, function (v) {
            layer = v;
            setHint();
            C.announce('Marking ' + LAYER_NOUNS[layer]);
          });
          layerSeg.node.classList.add('xs-layer-seg');
          body.appendChild(layerSeg.node);
        }

        var toolbar = el('div', 'xs-tools');
        var seg = C.segmented(TOOLS, tool, function (v) { tool = v; });
        seg.node.classList.add('xs-tool-seg');
        toolbar.appendChild(seg.node);
        var eraseBtn = button('btn ghost xs-erase', 'Unmark');
        eraseBtn.setAttribute('aria-pressed', 'false');
        on(eraseBtn, 'click', function () {
          erase = !erase;
          eraseBtn.classList.toggle('on', erase);
          eraseBtn.setAttribute('aria-pressed', erase ? 'true' : 'false');
        });
        toolbar.appendChild(eraseBtn);
        body.appendChild(toolbar);

        chart = makeChartView({
          cls: 'xs-full',
          interactive: true,
          paintMode: function () { return tool === 'paint'; },
          paintEvery: function () { return layer !== 'cross'; },
          onPaint: function (c) { paintAt(projectId, layer, c, !erase, true); },
          onTap: function (c) { applyTool(projectId, tool, layer, c, !erase); }
        });
        body.appendChild(chart.node);

        var zoomRow = el('div', 'xs-zoom');
        var zOut = button('btn ghost', '−', 'Zoom out');
        var zFit = button('btn ghost', 'Fit');
        var zIn = button('btn ghost', '+', 'Zoom in');
        on(zOut, 'click', function () { chart.zoomBy(1 / 1.4); });
        on(zFit, 'click', function () { chart.fit(); });
        on(zIn, 'click', function () { chart.zoomBy(1.4); });
        zoomRow.appendChild(zOut);
        zoomRow.appendChild(zFit);
        zoomRow.appendChild(zIn);
        body.appendChild(zoomRow);

        setHint();
        body.appendChild(hint);

        window.requestAnimationFrame(function () { if (chart) chart.fit(); });
      },
      footer: [
        {
          text: 'Undo',
          cls: 'btn ghost',
          onClick: function () {
            if (Store.undo()) {
              fb('undo');
              var p2 = Store.project(projectId);
              if (p2) {
                var d2 = dataOf(p2);
                view.img = null;
                syncModel(d2);
                syncScreen(p2, d2);
              }
              C.render();
            } else {
              toast('Nothing to undo');
            }
          }
        },
        { text: 'Done', cls: 'btn primary', onClick: function (api) { api.close(); } }
      ],
      onClose: function () {
        if (chart) chart.destroy();
        chart = null;
      }
    });
  }

  function applyTool(projectId, tool, layer, c, value) {
    if (tool === 'block') markBlock(projectId, layer, c, value);
    else if (tool === 'page') markWholeColour(projectId, layer, value);
    else paintAt(projectId, layer, c, value, false);
  }

  /**
   * One tap or one step of a drag, on whichever layer the switch is showing.
   * `sweeping` is true during a drag: a finger running along a line of
   * backstitch should catch the segments it actually crosses, so only their
   * midpoints count, while a deliberate tap is also allowed to land on an
   * endpoint (X.nearestBack's own rule).
   */
  function paintAt(projectId, layer, c, value, sweeping) {
    if (layer === 'cross') { markCell(projectId, c, value); return; }
    var chart = view.data && view.data.chart;
    if (!chart) return;
    var idx = -1;
    if (layer === 'back') idx = sweeping ? sweepBack(chart, c.fx, c.fy) : X.nearestBack(chart, c.fx, c.fy, X.HIT_TOL);
    else if (layer === 'knots') idx = X.nearestKnot(chart, c.fx, c.fy, X.HIT_TOL);
    else if (layer === 'part') idx = X.nearestPart(chart, c.fx, c.fy);
    if (idx < 0) {
      if (!sweeping) toast('No ' + LAYER_NOUN[layer] + ' there — zoom in and tap closer');
      return;
    }
    markLayerItem(projectId, layer, idx, value);
  }

  /** The nearest backstitch segment whose MIDPOINT the finger is on. */
  function sweepBack(chart, fx, fy) {
    var list = chart.back || [];
    var tol = X.HIT_TOL;
    var best = -1, bestD = tol * tol * (1 + 1e-9);
    for (var i = 0; i < list.length; i++) {
      var mx = (list[i].x1 + list[i].x2) / 2 - fx;
      var my = (list[i].y1 + list[i].y2) / 2 - fy;
      var d = mx * mx + my * my;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /**
   * Mark (or unmark) one backstitch segment, knot or fractional. Single-item
   * path: one bit flip, one base64 re-encode of a list that is hundreds long,
   * and an incremental tally bump — never a full recount.
   */
  function markLayerItem(projectId, layer, idx, value) {
    var state = view[LAYER_BITS[layer]];
    var items = layerItems(view.data, layer);
    var item = items[idx];
    if (!state || !item) return false;
    var was = ((state.bytes[idx >> 3] >> (idx & 7)) & 1) === 1;
    if (was === !!value) return false;

    var beforeByColor = snapshotByColor();
    X.setBit(state, idx, value);
    var b64 = X.bitsB64(state);
    var fields = LAYER_FIELD[layer];
    var delta = value ? 1 : -1;
    var at = layerAnchor(layer, item);
    var cx = clampInt(Math.floor(at.x), 0, Math.max(0, view.w - 1), 0);
    var cy = clampInt(Math.floor(at.y), 0, Math.max(0, view.h - 1), 0);

    Store.updateCraftData(projectId, function (cd) {
      cd.progress[fields[0]] = b64;
      cd.progress[fields[1]] = Math.max(0, (cd.progress[fields[1]] || 0) + delta);
      cd.current.cx = cx;
      cd.current.cy = cy;
    });
    view[LAYER_KEY[layer]] = b64;
    bumpStats(layerColours(layer, item), delta, layer);
    view.cx = cx;
    view.cy = cy;

    fb('tap');
    var p = Store.project(projectId);
    var data = dataOf(p);
    syncModel(data);
    syncScreen(p, data);
    if (value) noteMilestones(projectId, beforeByColor);
    return true;
  }

  /** Every item of one layer inside the tapped 10×10 block. */
  function markLayerBlock(projectId, layer, c, value) {
    var items = layerItems(view.data, layer);
    var state = view[LAYER_BITS[layer]];
    if (!state) return;
    var bx = Math.floor(c.x / 10) * 10, by = Math.floor(c.y / 10) * 10;
    var hit = [];
    for (var i = 0; i < items.length; i++) {
      var at = layerAnchor(layer, items[i]);
      if (at.x < bx || at.x > bx + 10 || at.y < by || at.y > by + 10) continue;
      hit.push(i);
    }
    var total = flipLayer(projectId, layer, hit, value, c);
    if (!total) { toast('That block has no ' + LAYER_NOUNS[layer] + ' left to ' + (value ? 'mark' : 'clear')); return; }
    toast((value ? 'Marked ' : 'Cleared ') + Math.abs(total) + ' ' + LAYER_NOUNS[layer] + ' in this 10×10 block');
  }

  /** Every item of one layer that belongs to the current colour. */
  function markLayerColour(projectId, layer, value) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    var pi = clampInt(data.current.paletteIndex, 0, Math.max(0, data.palette.length - 1), 0);
    var items = layerItems(data, layer);
    var hit = [];
    for (var i = 0; i < items.length; i++) {
      if (layerColours(layer, items[i]).indexOf(pi) >= 0) hit.push(i);
    }
    var total = flipLayer(projectId, layer, hit, value, null);
    if (!total) { toast('Nothing to change'); return; }
    toast((value ? 'Marked ' : 'Cleared ') + Math.abs(total) + ' ' + LAYER_NOUNS[layer] + ' of ' +
      paletteLabel(data.palette[pi]));
  }

  /** Bulk flip of a list of indexes in one layer. Returns the signed delta. */
  function flipLayer(projectId, layer, idxs, value, c) {
    var state = view[LAYER_BITS[layer]];
    var items = layerItems(view.data, layer);
    if (!state) return 0;
    var beforeByColor = snapshotByColor();
    var total = 0;
    for (var k = 0; k < idxs.length; k++) {
      var i = idxs[k];
      if (!items[i]) continue;
      var was = ((state.bytes[i >> 3] >> (i & 7)) & 1) === 1;
      if (was === !!value) continue;
      X.setBit(state, i, value);
      total += value ? 1 : -1;
    }
    if (!total) return 0;
    var b64 = X.bitsB64(state);
    var fields = LAYER_FIELD[layer];
    Store.updateCraftData(projectId, function (cd) {
      cd.progress[fields[0]] = b64;
      cd.progress[fields[1]] = Math.max(0, (cd.progress[fields[1]] || 0) + total);
      if (c) { cd.current.cx = c.x; cd.current.cy = c.y; }
    });
    view[LAYER_KEY[layer]] = b64;
    view.stats = null;                 // several colours moved: recount properly
    fb(total > 0 ? 'group' : 'undo');
    var p = Store.project(projectId);
    var data = dataOf(p);
    syncModel(data);
    syncScreen(p, data);
    if (total > 0) noteMilestones(projectId, beforeByColor);
    return total;
  }

  function markCell(projectId, c, value) {
    var was = X.getBit(view.bits, c.i) ? 1 : 0;
    if (was === (value ? 1 : 0)) return;
    var pi = view.cells[c.i];
    if (pi < 0) return;
    var beforeByColor = snapshotByColor();
    X.setBit(view.bits, c.i, value);
    paintCell(c.i, value ? 1 : 0);
    var b64 = X.bitsB64(view.bits);
    Store.updateCraftData(projectId, function (cd) {
      cd.progress.done = b64;
      cd.progress.doneCount = Math.max(0, (cd.progress.doneCount || 0) + (value ? 1 : -1));
      bumpPerColor(cd, pi, value ? 1 : -1);
      cd.current.cx = c.x;
      cd.current.cy = c.y;
    });
    view.doneKey = b64;
    bumpStats(pi, value ? 1 : -1);
    fb('tap');
    var p = Store.project(projectId);
    var data = dataOf(p);
    syncModel(data);
    syncScreen(p, data);
    if (value) noteMilestones(projectId, beforeByColor);
  }

  function markBlock(projectId, layer, c, value) {
    if (layer && layer !== 'cross') { markLayerBlock(projectId, layer, c, value); return; }
    var beforeByColor = snapshotByColor();
    var bx = Math.floor(c.x / 10) * 10, by = Math.floor(c.y / 10) * 10;
    var changed = {};
    var total = 0;
    for (var y = by; y < by + 10 && y < view.h; y++) {
      for (var x = bx; x < bx + 10 && x < view.w; x++) {
        var i = y * view.w + x;
        var pi = view.cells[i];
        if (pi < 0) continue;
        var was = (view.bits.bytes[i >> 3] >> (i & 7)) & 1;
        if (was === (value ? 1 : 0)) continue;
        X.setBit(view.bits, i, value);
        paintCell(i, value ? 1 : 0);
        changed[pi] = (changed[pi] || 0) + (value ? 1 : -1);
        total += value ? 1 : -1;
      }
    }
    if (!total) { toast('That block is already ' + (value ? 'done' : 'clear')); return; }
    commitBulk(projectId, changed, total, c, beforeByColor);
    toast((value ? 'Marked ' : 'Cleared ') + Math.abs(total) + ' stitches in this 10×10 block');
  }

  function markWholeColour(projectId, layer, value) {
    if (layer && layer !== 'cross') { markLayerColour(projectId, layer, value); return; }
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    var pi = clampInt(data.current.paletteIndex, 0, Math.max(0, data.palette.length - 1), 0);
    var beforeByColor = snapshotByColor();
    var cells = view.cells;
    var changed = {};
    var total = 0;
    for (var i = 0; i < cells.length; i++) {
      if (cells[i] !== pi) continue;
      var was = (view.bits.bytes[i >> 3] >> (i & 7)) & 1;
      if (was === (value ? 1 : 0)) continue;
      X.setBit(view.bits, i, value);
      changed[pi] = (changed[pi] || 0) + (value ? 1 : -1);
      total += value ? 1 : -1;
    }
    if (!total) { toast('Nothing to change'); return; }
    view.img = null;
    commitBulk(projectId, changed, total, null, beforeByColor);
    toast((value ? 'Marked ' : 'Cleared ') + comma(Math.abs(total)) + ' stitches of ' +
      paletteLabel(data.palette[pi]));
  }

  function commitBulk(projectId, changed, total, c, beforeByColor) {
    var b64 = X.bitsB64(view.bits);
    Store.updateCraftData(projectId, function (cd) {
      cd.progress.done = b64;
      cd.progress.doneCount = Math.max(0, (cd.progress.doneCount || 0) + total);
      Object.keys(changed).forEach(function (k) {
        bumpPerColor(cd, parseInt(k, 10), changed[k]);
      });
      if (c) { cd.current.cx = c.x; cd.current.cy = c.y; }
    });
    view.doneKey = b64;
    view.stats = null;                 // many colours moved: recount properly
    fb(total > 0 ? 'group' : 'undo');
    var p = Store.project(projectId);
    var data = dataOf(p);
    syncModel(data);
    syncScreen(p, data);
    if (total > 0) noteMilestones(projectId, beforeByColor);
  }

  /* ---- floss list ---------------------------------------------------- */

  function openFlossSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;

    C.openSheet({
      title: 'Floss',
      cls: 'sheet-floss',
      build: function (body) {
        var proj = Store.project(projectId);
        var data = dataOf(proj);
        var stats = X.progressStats(data);

        if (!data.palette.length) {
          body.appendChild(el('p', 'muted', 'No colours yet. Import a chart or add colours by hand.'));
          return;
        }

        var totals = { low: 0, high: 0, have: 0, need: 0 };
        var list = el('div', 'list xs-floss-list');
        data.palette.forEach(function (e, i) {
          var st = stats.byColor[i] || { done: 0, total: 0 };
          var count = st.total || e.stitchCount || 0;
          var range = X.skeinRange({
            stitchCount: count,
            count: data.fabric.count,
            over: data.fabric.over,
            strands: e.strands || data.strandsDefault
          });
          if (e.skeins) { range.low = Math.max(range.low, e.skeins); range.high = Math.max(range.high, e.skeins); }
          totals.low += range.low;
          totals.high += range.high;
          if (e.have) totals.have += 1; else if (range.high > 0) totals.need += 1;

          var row = el('div', 'list-item xs-floss-row');
          var sw = el('span', 'xs-swatch', e.symbol || '');
          sw.style.background = swatchHex(e);
          sw.style.color = X.symbolInk(e.hex) === 'light' ? '#fff' : '#111';
          var text = el('span', 'xs-floss-text');
          text.appendChild(el('span', 'xs-key-code', paletteLabel(e)));
          var sub = [];
          if (count) sub.push(comma(count) + ' sts');
          sub.push(range.low === range.high
            ? plural(range.high, 'skein')
            : range.low + '–' + range.high + ' skeins');
          sub.push((e.strands || data.strandsDefault) + ' strands');
          if (!e.hex || e.hex === '808080') sub.push('no colour data');
          text.appendChild(el('span', 'xs-key-sub', sub.join(' · ')));
          var have = button('check xs-key-have', e.have ? '✓' : '', 'I own ' + paletteLabel(e));
          have.setAttribute('role', 'checkbox');
          have.setAttribute('aria-checked', e.have ? 'true' : 'false');
          have.classList.toggle('on', !!e.have);
          on(have, 'click', function () {
            toggleHave(projectId, i);
            have.classList.toggle('on');
            var nowOn = have.classList.contains('on');
            have.textContent = nowOn ? '✓' : '';
            have.setAttribute('aria-checked', nowOn ? 'true' : 'false');
          });
          row.appendChild(sw);
          row.appendChild(text);
          row.appendChild(have);
          list.appendChild(row);
        });

        var summary = el('p', 'muted xs-floss-total',
          'About ' + (totals.low === totals.high
            ? plural(totals.high, 'skein')
            : (totals.low + '–' + totals.high + ' skeins')) + ' in all. ' +
          'Estimates assume ' + X.lengthPerStitchCm(data.fabric.count, data.fabric.over) +
          ' cm per stitch at ' + Math.round(data.fabric.count / data.fabric.over) +
          ' ct and 20% waste, so treat them as a range.');
        body.appendChild(summary);
        body.appendChild(list);

        var shop = button('btn block', '🛒 Shopping list');
        on(shop, 'click', function () { copyShoppingList(projectId); });
        body.appendChild(shop);

        body.appendChild(el('p', 'muted xs-disclaimer',
          'Screen colours are approximate — always check against a real shade card. ' +
          'DMC numbers and names are used only to identify threads.'));
      },
      footer: [{ text: 'Close', cls: 'btn primary', onClick: function (api) { api.close(); } }]
    });
  }

  function copyShoppingList(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    var stats = X.progressStats(data);
    var lines = [p.name + ' — floss to buy'];
    var n = 0;
    data.palette.forEach(function (e, i) {
      if (e.have) return;
      var st = stats.byColor[i] || { total: 0 };
      var range = X.skeinRange({
        stitchCount: st.total || e.stitchCount || 0,
        count: data.fabric.count, over: data.fabric.over,
        strands: e.strands || data.strandsDefault
      });
      if (!range.high) range.high = 1;
      lines.push((e.brand ? e.brand + ' ' : 'DMC ') + e.code +
        (e.name ? ' ' + e.name : '') + ' — ' + plural(range.high, 'skein'));
      n++;
    });
    if (!n) { toast('You already own everything on this list'); return; }
    var text = lines.join('\n');
    var done = function () { toast('Shopping list copied (' + plural(n, 'colour') + ')'); };
    if (navigator.share) {
      navigator.share({ title: 'Floss shopping list', text: text }).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { showTextSheet(text); });
    } else {
      showTextSheet(text);
    }
  }

  function showTextSheet(text) {
    C.openSheet({
      title: 'Copy this',
      build: function (body) {
        var ta = C.textArea(text, 'xs-copy-area');
        ta.readOnly = true;
        ta.rows = 12;
        body.appendChild(ta);
        ta.focus();
        try { ta.select(); } catch (e) { /* ignore */ }
      },
      footer: [{ text: 'Close', cls: 'btn primary', onClick: function (api) { api.close(); } }]
    });
  }

  /* ---- fabric and size ----------------------------------------------- */

  function openFabricSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    var draft = {
      count: data.fabric.count,
      kind: data.fabric.kind,
      over: data.fabric.over,
      color: data.fabric.color,
      strands: data.strandsDefault,
      w: data.design.w,
      h: data.design.h
    };
    var sizeBox;

    function renderSizes() {
      if (!sizeBox) return;
      clear(sizeBox);
      if (!draft.w || !draft.h) {
        sizeBox.appendChild(el('p', 'muted', 'Set the design size to see the finished measurements.'));
        return;
      }
      var fin = X.finishedSize({ w: draft.w, h: draft.h, count: draft.count, over: draft.over });
      sizeBox.appendChild(el('p', 'xs-size-main',
        fin.wIn + ' × ' + fin.hIn + ' in  (' + fin.wCm + ' × ' + fin.hCm + ' cm)'));
      sizeBox.appendChild(el('p', 'muted',
        'Fabric to buy, with a 3 in margin all round: ' +
        fin.fabricIn.w + ' × ' + fin.fabricIn.h + ' in (' + fin.fabricCm.w + ' × ' + fin.fabricCm.h + ' cm)'));
      var table = el('div', 'xs-size-table');
      X.sizeTable({ w: draft.w, h: draft.h, over: draft.over }, [11, 14, 16, 18]).forEach(function (r) {
        var row = el('div', 'xs-size-row');
        row.appendChild(el('span', null, r.count + ' ct'));
        row.appendChild(el('span', null, r.wIn + ' × ' + r.hIn + ' in'));
        table.appendChild(row);
      });
      sizeBox.appendChild(table);
    }

    C.openSheet({
      title: 'Fabric & size',
      build: function (body) {
        var countStep = C.stepper(draft.count, 6, 40, 'fabric count');
        body.appendChild(field('Fabric count (threads per inch)', countStep.node));
        on(countStep.node, 'input', function () { draft.count = countStep.get(); renderSizes(); });
        on(countStep.node, 'click', function () {
          window.setTimeout(function () { draft.count = countStep.get(); renderSizes(); }, 0);
        });

        var kindSeg = C.segmented(
          [{ id: 'aida', label: 'Aida' }, { id: 'evenweave', label: 'Evenweave' }, { id: 'linen', label: 'Linen' }],
          draft.kind,
          function (v) {
            draft.kind = v;
            if (v !== 'aida' && draft.over === 1) { draft.over = 2; overSwitch.querySelector('[role=switch]').setAttribute('aria-checked', 'true'); }
            renderSizes();
          }
        );
        body.appendChild(field('Fabric', kindSeg.node));

        var overSwitch = C.switchRow('Stitched over 2 threads',
          'Evenweave and linen are normally worked over two, which halves the effective count.',
          draft.over === 2,
          function (v) { draft.over = v ? 2 : 1; renderSizes(); });
        body.appendChild(overSwitch);

        var colorInput = C.textInput(draft.color, 'White');
        on(colorInput, 'input', function () { draft.color = colorInput.value; });
        body.appendChild(field('Fabric colour', colorInput, 'A name like “Antique White”, or a hex value like #F0EADA.'));

        var strandStep = C.stepper(draft.strands, 1, 6, 'strands');
        body.appendChild(field('Strands (default)', strandStep.node));

        var wIn = C.numInput(draft.w, 1, 20000);
        var hIn = C.numInput(draft.h, 1, 20000);
        var sizeRow = el('div', 'xs-two');
        sizeRow.appendChild(field('Width in stitches', wIn));
        sizeRow.appendChild(field('Height in stitches', hIn));
        on(wIn, 'input', function () { draft.w = clampInt(wIn.value, 1, 20000, null); renderSizes(); });
        on(hIn, 'input', function () { draft.h = clampInt(hIn.value, 1, 20000, null); renderSizes(); });
        if (hasChart(data)) {
          wIn.disabled = true;
          hIn.disabled = true;
        }
        body.appendChild(sizeRow);
        if (hasChart(data)) {
          body.appendChild(el('p', 'field-hint', 'The design size comes from the imported chart.'));
        }

        sizeBox = el('div', 'card xs-size-box');
        body.appendChild(sizeBox);
        renderSizes();

        var useDefault = button('linkish', 'Use this count and strands for new projects');
        on(useDefault, 'click', function () {
          Store.setCraftSetting(CRAFT, 'count', draft.count);
          Store.setCraftSetting(CRAFT, 'kind', draft.kind);
          Store.setCraftSetting(CRAFT, 'over', draft.over);
          Store.setCraftSetting(CRAFT, 'strands', strandStep.get());
          toast('Saved as your default');
        });
        body.appendChild(useDefault);

        // The +/- buttons set the input directly, so read them at save time.
        draft.strandsGet = strandStep.get;
        draft.countGet = countStep.get;
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        {
          text: 'Save',
          cls: 'btn primary',
          onClick: function (api) {
            if (draft.countGet) draft.count = draft.countGet();
            if (draft.strandsGet) draft.strands = draft.strandsGet();
            Store.updateCraftData(projectId, function (cd) {
              cd.fabric.count = draft.count;
              cd.fabric.countY = draft.count;
              cd.fabric.kind = draft.kind;
              cd.fabric.over = draft.over;
              cd.fabric.color = draft.color || 'White';
              cd.strandsDefault = draft.strands;
              if (!hasChart(cd)) {
                cd.design.w = draft.w;
                cd.design.h = draft.h;
              }
            });
            if (view) view.img = null;
            api.close();
            C.render();
            toast('Fabric saved');
          }
        }
      ]
    });
  }

  /* ---- pages --------------------------------------------------------- */

  function openPagesSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var urls = [];

    C.openSheet({
      title: 'Chart pages',
      cls: 'sheet-pages',
      build: function (body) {
        var proj = Store.project(projectId);
        var data = dataOf(proj);
        if (!data.pages.length) {
          body.appendChild(el('p', 'muted',
            'No chart page images yet. Import a PDF from the ⋯ menu and the pages are ' +
            'rendered and kept on this device.'));
          body.appendChild(storageFooter(projectId, data));
          return;
        }
        body.appendChild(el('p', 'muted',
          'Chart images are stored on this device only — they are not in your backup file. ' +
          'Keep the PDF and you can always re-import.' +
          (data.pages.length >= MAX_PAGES
            ? ' Only the first ' + MAX_PAGES + ' pages of a chart are saved.' : '')));

        var grid = el('div', 'xs-page-grid');
        data.pages.forEach(function (page, i) {
          var cell = button('xs-page-thumb', null, 'Open ' + page.label);
          var imgWrap = el('span', 'xs-thumb-img');
          cell.appendChild(imgWrap);
          var label = el('span', 'xs-thumb-label', page.label);
          cell.appendChild(label);
          var doneMark = el('span', 'xs-thumb-done', '✓');
          doneMark.hidden = !isPageDone(data, i);
          cell.appendChild(doneMark);
          on(cell, 'click', function () {
            Store.updateCraftData(projectId, function (cd) { cd.current.page = i; });
            C.render();
            toast('Showing ' + page.label);
          });
          var tick = button('btn ghost xs-thumb-tick', isPageDone(data, i) ? 'Done ✓' : 'Mark done');
          on(tick, 'click', function () {
            var next = !isPageDone(dataOf(Store.project(projectId)), i);
            Store.updateCraftData(projectId, function (cd) {
              var list = cd.progress.pageDone;
              for (var k = 0; k < list.length; k++) {
                if (list[k].page === i) { list[k].done = next; return; }
              }
              list.push({ page: i, done: next });
            });
            tick.textContent = next ? 'Done ✓' : 'Mark done';
            doneMark.hidden = !next;
            fb(next ? 'done' : 'undo');
          });
          var box = el('div', 'xs-page-box');
          box.appendChild(cell);
          box.appendChild(tick);
          grid.appendChild(box);

          if (window.BlobStore && page.blobKey) {
            window.BlobStore.get(page.blobKey).then(function (blob) {
              if (!blob) { imgWrap.textContent = '—'; return; }
              var url = URL.createObjectURL(blob);
              urls.push(url);
              var img = el('img');
              img.src = url;
              img.alt = page.label;
              imgWrap.appendChild(img);
            });
          }
        });
        body.appendChild(grid);

        if (!hasChart(data) && gridIsWorthTrying(keyFromPalette(data))) {
          var beta = button('btn ghost block xs-beta-btn', '🔍 Try to read the grid (beta)');
          on(beta, 'click', function () { openGridBetaSheet(projectId); });
          body.appendChild(beta);
          body.appendChild(el('p', 'muted xs-import-note',
            'Some chart PDFs draw every stitch as a coloured square. When they do, the whole ' +
            'grid can be read out of the file and you get stitch-by-stitch counting.'));
        }

        body.appendChild(storageFooter(projectId, data));
      },
      footer: [{ text: 'Close', cls: 'btn primary', onClick: function (api) { api.close(); } }],
      onClose: function () {
        urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } });
      }
    });
  }

  /**
   * What this project is actually using: the chart data in localStorage (which
   * is what the 1 MB guard watches) and the page images in IndexedDB, which
   * live under a far bigger quota but are device-only.
   */
  function storageFooter(projectId, data) {
    var box = el('div', 'xs-storage');
    var bytes = X.dataSize(data);
    var line = el('p', 'muted xs-storage-line',
      'Chart data: ' + fmtBytes(bytes) + ' of about ' + fmtBytes(X.SIZE_BUDGET_BYTES) +
      ' shared by every project.');
    box.appendChild(line);
    var pics = el('p', 'muted xs-storage-line', 'Page images: counting…');
    box.appendChild(pics);

    if (window.BlobStore && window.BlobStore.available()) {
      window.BlobStore.usage().then(function (u) {
        if (!pics.isConnected) return;
        pics.textContent = u
          ? ('Page images: ' + fmtBytes(u.bytes) + ' in ' + plural(u.count, 'image') + ' on this device.')
          : 'Page images: size unavailable on this device.';
      }, function () { pics.textContent = 'Page images: size unavailable on this device.'; });
    } else {
      pics.textContent = 'Page images: this browser cannot store them.';
    }

    if (hasChart(data) && bytes > X.SIZE_WARN_BYTES) {
      var drop = button('btn ghost block', 'Switch to image-only mode');
      on(drop, 'click', function () {
        C.confirmSheet({
          title: 'Switch to image-only?',
          message: 'The stitch grid goes, so counting becomes per colour rather than square ' +
            'by square. Your colour key and everything counted so far are kept' +
            (data.pages.length
              ? ', and so are the chart pages.'
              : '. This project has no chart pages, so keep the original file to stitch from.'),
          confirmText: 'Switch'
        }).then(function (ok) {
          if (!ok) return;
          C.closeAllSheets();
          switchToCountsMode(projectId);
        });
      });
      box.appendChild(drop);
    }
    return box;
  }

  function isPageDone(data, i) {
    var list = data.progress.pageDone;
    for (var k = 0; k < list.length; k++) if (list[k].page === i) return !!list[k].done;
    return false;
  }

  /* ---- parking notes -------------------------------------------------- */

  var CORNERS = [
    { id: 'tl', label: '↖' }, { id: 'tr', label: '↗' },
    { id: 'bl', label: '↙' }, { id: 'br', label: '↘' }
  ];

  function openParkingSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;

    C.openSheet({
      title: 'Parking notes',
      build: function (body, api) {
        function redraw() {
          clear(body);
          var proj = Store.project(projectId);
          var data = dataOf(proj);
          body.appendChild(el('p', 'muted',
            'Parking is leaving a thread dangling in the hole where that colour starts next. ' +
            'Note where each one is waiting.'));

          if (!data.parking.length) {
            body.appendChild(el('p', 'muted', 'Nothing parked yet.'));
          } else {
            var list = el('div', 'list');
            data.parking.forEach(function (park, i) {
              var row = el('div', 'list-item xs-park-row');
              var txt = el('span', 'xs-park-text');
              txt.appendChild(el('span', 'xs-key-code', (park.symbol || '•') + '  ' + (park.key || '—')));
              if (park.note) txt.appendChild(el('span', 'xs-key-sub', park.note));
              row.appendChild(el('span', 'xs-park-corner', cornerLabel(park.corner)));
              row.appendChild(txt);
              var del = button('xs-key-edit', '✕', 'Remove this parking note');
              on(del, 'click', function () {
                Store.updateCraftData(projectId, function (cd) { cd.parking.splice(i, 1); });
                redraw();
              });
              row.appendChild(del);
              list.appendChild(row);
            });
            body.appendChild(list);
          }

          var add = button('btn ghost block', '＋ Park a colour here');
          on(add, 'click', function () {
            var proj2 = Store.project(projectId);
            var d2 = dataOf(proj2);
            var e = currentEntry(d2);
            Store.updateCraftData(projectId, function (cd) {
              cd.parking.push({
                key: 'col ' + (cd.current.cx + 1) + ', row ' + (cd.current.cy + 1),
                symbol: e ? (e.symbol || e.code) : '',
                corner: 'tl',
                note: e ? paletteLabel(e) : ''
              });
            });
            fb('tap');
            redraw();
          });
          body.appendChild(add);
        }
        redraw();
      },
      footer: [{ text: 'Close', cls: 'btn primary', onClick: function (api) { api.close(); } }]
    });
  }

  function cornerLabel(id) {
    for (var i = 0; i < CORNERS.length; i++) if (CORNERS[i].id === id) return CORNERS[i].label;
    return '↖';
  }

  /* ---- colour editor -------------------------------------------------- */

  function openColourEditor(projectId, index) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    var isNew = index < 0;
    var e = isNew
      ? { symbol: '', brand: 'DMC', code: '', name: '', hex: '808080', strands: data.strandsDefault, bsStrands: 1, kind: 'cross', stitchCount: 0, skeins: 0, have: false }
      : data.palette[index];
    if (!e) return;
    var draft = {
      code: e.code, name: e.name, hex: e.hex, brand: e.brand || 'DMC',
      strands: e.strands, kind: e.kind, stitchCount: e.stitchCount
    };
    var swatch, nameInput;

    function applyCode() {
      var hex = X.hexFor(draft.brand, draft.code);
      var floss = X.flossFor(draft.brand, draft.code);
      if (hex) draft.hex = hex;
      if (floss && (!draft.name || isNew)) {
        draft.name = floss.name;
        if (nameInput) nameInput.value = floss.name;
      }
      if (swatch) {
        swatch.style.background = '#' + draft.hex;
        swatch.textContent = draft.hex === '808080' && !hex ? '?' : '';
      }
    }

    C.openSheet({
      title: isNew ? 'Add a colour' : 'Edit colour',
      build: function (body) {
        swatch = el('div', 'xs-swatch xs-swatch-big');
        swatch.style.background = '#' + draft.hex;
        body.appendChild(swatch);

        var brandSeg = C.segmented(
          [{ id: 'DMC', label: 'DMC' }, { id: 'Anchor', label: 'Anchor' }, { id: 'Madeira', label: 'Madeira' }],
          draft.brand,
          function (v) { draft.brand = v; applyCode(); }
        );
        body.appendChild(field('Brand', brandSeg.node));

        var codeInput = C.textInput(draft.code, '310');
        on(codeInput, 'input', function () { draft.code = codeInput.value.trim(); applyCode(); });
        body.appendChild(field('Code', codeInput, 'DMC codes fill in the name and colour for you.'));

        nameInput = C.textInput(draft.name, 'Black');
        on(nameInput, 'input', function () { draft.name = nameInput.value; });
        body.appendChild(field('Name', nameInput));

        var strandStep = C.stepper(draft.strands, 1, 6, 'strands');
        body.appendChild(field('Strands', strandStep.node));
        draft.strandsGet = strandStep.get;

        var kindSeg = C.segmented(
          [{ id: 'cross', label: 'Cross' }, { id: 'back', label: 'Back' },
           { id: 'knot', label: 'Knot' }, { id: 'bead', label: 'Bead' }, { id: 'half', label: 'Half' }],
          draft.kind,
          function (v) { draft.kind = v; }
        );
        body.appendChild(field('Stitch type', kindSeg.node));

        var countInput = C.numInput(draft.stitchCount || '', 0, 1e7, 'optional');
        on(countInput, 'input', function () { draft.stitchCount = clampInt(countInput.value, 0, 1e7, 0); });
        body.appendChild(field('Stitches in this colour', countInput,
          hasChart(data) ? 'Counted from the chart; editing this is only a label.' : 'Lets the counter show “412 left”.'));

        if (!isNew) {
          var del = button('btn danger block', 'Remove this colour');
          on(del, 'click', function () {
            C.confirmSheet({
              title: 'Remove ' + paletteLabel(e) + '?',
              message: hasChart(data)
                ? 'Its stitches stay on the chart but lose their colour.'
                : 'Its progress is removed too.',
              confirmText: 'Remove',
              danger: true
            }).then(function (ok) {
              if (!ok) return;
              Store.updateCraftData(projectId, function (cd) {
                cd.palette.splice(index, 1);
                for (var i = 0; i < cd.palette.length; i++) cd.palette[i].i = i;
                cd.current.paletteIndex = 0;
              });
              C.closeAllSheets();
              if (view) { view.img = null; view.paletteKey = null; }
              C.render();
              toast('Colour removed');
            });
          });
          body.appendChild(del);
        }
        applyCode();
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        {
          text: 'Save',
          cls: 'btn primary',
          onClick: function (api) {
            if (!draft.code) { toast('A colour needs a code'); return; }
            if (draft.strandsGet) draft.strands = draft.strandsGet();
            Store.updateCraftData(projectId, function (cd) {
              var target;
              if (isNew) {
                target = {
                  i: cd.palette.length, symbol: '', brand: draft.brand, code: draft.code,
                  name: draft.name, hex: draft.hex, strands: draft.strands, bsStrands: 1,
                  kind: draft.kind, blendWith: null, stitchCount: draft.stitchCount || 0,
                  skeins: 0, have: false
                };
                cd.palette.push(target);
                cd.progress.perColor.push({ i: target.i, done: 0 });
              } else {
                target = cd.palette[index];
                target.brand = draft.brand;
                target.code = draft.code;
                target.name = draft.name;
                target.hex = draft.hex;
                target.strands = draft.strands;
                target.kind = draft.kind;
                target.stitchCount = draft.stitchCount || 0;
              }
              X.assignSymbols(cd.palette);
            });
            if (view) { view.img = null; view.paletteKey = null; }
            api.close();
            C.render();
            toast(isNew ? 'Colour added' : 'Colour saved');
          }
        }
      ]
    });
  }

  /* ================================================================== *
   * 7. Import (docs/research/cross-stitch.md §B4)
   * ================================================================== */

  function openImportSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var zone = null;
    var previewBox = null;
    var pdfHandle = null;    // the open pdf.js document, destroyed on close

    function setPreview(node) {
      if (!previewBox) return;
      clear(previewBox);
      if (node) previewBox.appendChild(node);
      previewBox.hidden = !node;
    }

    C.openSheet({
      title: 'Import a chart',
      cls: 'sheet-xs-import',
      build: function (body, api) {
        zone = C.pdfDropZone({
          label: 'Drop a cross-stitch PDF or .oxs file here, or choose a file',
          accept: ['.pdf', '.oxs', '.xml'],
          icon: '🧵',
          ariaLabel: 'Choose a cross-stitch chart',
          tour: 'xs-import-drop',
          rejectMessage: 'That needs to be a PDF or an .oxs chart',
          onPages: function (handle) {
            pdfHandle = handle;
          },
          onText: function (res) {
            handlePdfText(projectId, res, pdfHandle, setPreview);
          },
          onFile: function (file) {
            readOxsFile(projectId, file, setPreview);
          },
          onError: function (err) {
            setPreview(el('p', 'muted', (err && err.message) ||
              'That PDF could not be read. It may be a scan — you can still add the colours by hand.'));
          }
        });
        body.appendChild(zone);

        previewBox = el('div', 'xs-preview');
        previewBox.hidden = true;
        body.appendChild(previewBox);

        var more = el('div', 'list xs-import-more');

        var photoItem = el('button', 'menu-item');
        photoItem.type = 'button';
        photoItem.appendChild(el('span', 'menu-icon', '📷'));
        photoItem.appendChild(el('span', null, 'Make one from a photo'));
        on(photoItem, 'click', function () { openPhotoSheet(projectId); });
        more.appendChild(photoItem);

        var handItem = el('button', 'menu-item');
        handItem.type = 'button';
        handItem.appendChild(el('span', 'menu-icon', '✎'));
        handItem.appendChild(el('span', null, 'Enter it by hand'));
        on(handItem, 'click', function () {
          api.close();
          openFabricSheet(projectId);
        });
        more.appendChild(handItem);

        body.appendChild(more);
        body.appendChild(el('p', 'muted xs-import-note',
          'Chart pages are rendered as images and kept on this device only; they are not in ' +
          'your backup file, so keep the PDF.'));
      },
      onClose: function () {
        if (zone && zone.destroy) zone.destroy();
        zone = null;
        if (pdfHandle && pdfHandle.destroy) {
          try { pdfHandle.destroy(); } catch (e) { /* ignore */ }
        }
        pdfHandle = null;
      }
    });
  }

  /* ---- OXS ------------------------------------------------------------ */

  function readOxsFile(projectId, file, setPreview) {
    var reader = new FileReader();
    setPreview(el('p', 'muted', 'Reading ' + file.name + '…'));
    reader.onload = function () {
      var res;
      try { res = X.parseOXS(String(reader.result || '')); } catch (e) { res = { ok: false, warnings: ['that file could not be read'] }; }
      if (!res.ok) {
        setPreview(warningList('That is not a chart we can read.', res.warnings));
        return;
      }
      var d = res.data;
      var card = el('div', 'card xs-preview-card');
      var bits = [];
      if (d.design.title) bits.push(d.design.title);
      bits.push(d.design.w + ' × ' + d.design.h);
      bits.push(plural(d.palette.length, 'colour'));
      bits.push(d.fabric.count + ' ct');
      if (d.chart.back.length) bits.push(plural(d.chart.back.length, 'backstitch segment'));
      if (d.chart.knots.length) {
        bits.push(d.chart.knots.length === 1 ? '1 knot or bead' : d.chart.knots.length + ' knots and beads');
      }
      if (d.chart.part.length) bits.push(plural(d.chart.part.length, 'fractional'));
      card.appendChild(el('h3', 'xs-h3', 'Ready to import'));
      card.appendChild(el('p', null, bits.join(' · ')));
      if (d.progress.doneCount) {
        card.appendChild(el('p', 'muted', comma(d.progress.doneCount) + ' stitches are already marked done in that file.'));
      }
      if (res.warnings.length) card.appendChild(warningList('Notes', res.warnings, true));

      var go = button('btn primary block', 'Import this chart');
      on(go, 'click', function () {
        applyOxs(projectId, d, res.warnings, file.name);
      });
      card.appendChild(go);
      setPreview(card);
    };
    reader.onerror = function () { setPreview(el('p', 'muted', 'That file could not be read.')); };
    reader.readAsText(file);
  }

  function applyOxs(projectId, d, warnings, fileName) {
    Store.updateCraftData(projectId, function (cd) {
      cd.design = d.design;
      cd.fabric.count = d.fabric.count;
      cd.fabric.countY = d.fabric.countY;
      cd.fabric.color = d.fabric.color;
      cd.palette = d.palette;
      cd.chart = d.chart;
      cd.strandsDefault = d.strandsDefault;
      cd.notesKey = d.notesKey;
      cd.progress.mode = 'cells';
      cd.progress.done = d.progress.done;
      cd.progress.doneCount = d.progress.doneCount;
      /* OXS has no "done" flag for backstitch, knots or fractionals, so a
         fresh import always starts those layers empty (see toOXS). */
      clearExtraProgress(cd);
      cd.progress.perColor = d.palette.map(function (e, i) { return { i: i, done: 0 }; });
      cd.current.paletteIndex = 0;
      cd.current.cx = 0;
      cd.current.cy = 0;
      cd.sizeWarnedAt = 0;
      cd.source = { kind: 'oxs', fileName: fileName || '', importedAt: Date.now(), warnings: warnings.slice(0, 12) };
      return X.normalize(cd, null);
    });
    forgetCaches();
    C.closeAllSheets();
    C.render();
    fb('done');
    toast('Imported ' + d.design.w + ' × ' + d.design.h + ' · ' + plural(d.palette.length, 'colour'));
    checkSize(projectId);
  }

  /** Reset the backstitch / knot / fractional bitmaps on a fresh import. */
  function clearExtraProgress(cd) {
    cd.progress.doneBack = '';
    cd.progress.doneBackCount = 0;
    cd.progress.donePart = '';
    cd.progress.donePartCount = 0;
    cd.progress.doneKnots = '';
    cd.progress.doneKnotsCount = 0;
  }

  /** Drop every decoded cache so the next render rebuilds from craftData. */
  function forgetCaches() {
    if (!view) return;
    view.img = null;
    view.cellsKey = null;
    view.doneKey = null;
    view.paletteKey = null;
    view.backKey = null;
    view.knotKey = null;
    view.partKey = null;
    view.backBits = null;
    view.knotBits = null;
    view.partBits = null;
    view.stats = null;
  }

  /* ---- the craftData size guard (research doc B9 risk #4) ------------- */

  function fmtBytes(n) {
    n = num(n, 0);
    if (n < 1024) return Math.round(n) + ' B';
    if (n < 1048576) return Math.round(n / 1024) + ' KB';
    return (Math.round(n / 1048576 * 10) / 10) + ' MB';
  }

  /**
   * localStorage gives the whole app about 5 MB, and every project shares it.
   * After an import or a grid read, check what this project now weighs and, if
   * it is over 1 MB, offer the way out. Once per project per import — the flag
   * lives in craftData so it survives a reload, and every import clears it.
   */
  function checkSize(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    var bytes = X.dataSize(data);
    if (bytes <= X.SIZE_WARN_BYTES || data.sizeWarnedAt) return;
    Store.updateCraftData(projectId, function (cd) { cd.sizeWarnedAt = Date.now(); });

    C.openSheet({
      title: 'This chart is large',
      cls: 'sheet-xs-size',
      build: function (body) {
        body.appendChild(el('p', null,
          'This chart is large (' + fmtBytes(bytes) + ' of ' + fmtBytes(X.SIZE_BUDGET_BYTES) +
          ' available). Keep the stitch grid, or switch to image-only mode ' +
          '(chart pages stay, per-stitch tracking is lost)?'));
        body.appendChild(el('p', 'muted',
          'Every project on this device shares that space. Image-only mode keeps the colour ' +
          'key, the chart pages and everything you have already counted — as per-colour ' +
          'totals rather than square by square — so no progress is lost.'));
      },
      footer: [
        {
          text: 'Switch to image-only',
          cls: 'btn ghost',
          onClick: function (api) { api.close(); switchToCountsMode(projectId); }
        },
        { text: 'Keep the stitch grid', cls: 'btn primary', onClick: function (api) { api.close(); } }
      ]
    });
  }

  function switchToCountsMode(projectId) {
    Store.updateCraftData(projectId, function (cd) { return X.toCountsMode(cd); });
    forgetCaches();
    C.render();
    fb('done');
    toast('Image-only mode · your per-colour totals were kept', { ms: 4200 });
  }

  function warningList(title, warnings, muted) {
    var box = el('div', 'xs-warnings');
    box.appendChild(el('p', muted ? 'muted' : null, title));
    if (warnings && warnings.length) {
      var ul = el('ul', 'xs-warn-list');
      warnings.slice(0, 8).forEach(function (w) { ul.appendChild(el('li', null, w)); });
      box.appendChild(ul);
    }
    return box;
  }

  /* ---- PDF ------------------------------------------------------------ */

  var MAX_PAGES = 40;

  function handlePdfText(projectId, res, handle, setPreview) {
    var key;
    try { key = X.parseKey(res.text || ''); } catch (e) { key = null; }
    if (!key) {
      setPreview(el('p', 'muted', 'That PDF could not be read.'));
      return;
    }
    var edits = { entries: key.entries.slice(), fabric: key.fabric, design: key.design, strands: key.strandsDefault };

    var card = el('div', 'card xs-preview-card');
    var band = el('div', 'xs-confidence');
    var level = key.confidence >= 0.7 ? 'good' : (key.confidence > 0 ? 'ok' : 'none');
    band.classList.add('xs-conf-' + level);
    if (level === 'good') {
      band.textContent = 'Read the key cleanly — ' + plural(key.entries.length, 'colour') + ' found.';
    } else if (level === 'ok') {
      band.textContent = 'Read some of the key (' + plural(key.entries.length, 'colour') +
        '). Check it before importing.';
    } else if ((res.chars || 0) < 60) {
      band.textContent = 'This PDF is a scan, so there is no text to read. The chart pages are ' +
        'here; add colours by hand or from a photo.';
    } else {
      band.textContent = 'I couldn’t find a colour key in this PDF. The chart pages are here; ' +
        'add colours by hand or from a photo.';
    }
    card.appendChild(band);

    var meta = el('p', 'muted');
    var mBits = [];
    if (key.design.w && key.design.h) mBits.push(key.design.w + ' × ' + key.design.h + ' stitches');
    if (key.fabric.count) mBits.push(key.fabric.count + ' ct' + (key.fabric.kind ? ' ' + key.fabric.kind : ''));
    if (key.fabric.over === 2) mBits.push('over 2');
    if (key.strandsDefault) mBits.push(key.strandsDefault + ' strands');
    if (key.stitchesUsed.length) mBits.push(key.stitchesUsed.join(', '));
    meta.textContent = mBits.join(' · ') || 'No fabric or size line found.';
    card.appendChild(meta);

    if (key.entries.length) {
      var list = el('div', 'list xs-key-preview');
      key.entries.slice(0, 60).forEach(function (e, i) {
        var row = el('div', 'list-item xs-preview-row');
        var sw = el('span', 'xs-swatch', e.symbol || '');
        sw.style.background = e.hex ? '#' + e.hex : 'transparent';
        if (e.hex) sw.style.color = X.symbolInk(e.hex) === 'light' ? '#fff' : '#111';
        var txt = el('span', 'xs-key-text');
        txt.appendChild(el('span', 'xs-key-code', (e.brand ? e.brand + ' ' : '') + e.code + (e.name ? ' · ' + e.name : '')));
        var sub = [];
        if (e.stitchCount) sub.push(comma(e.stitchCount) + ' sts');
        if (e.strands) sub.push(e.strands + ' strands');
        if (e.skeins) sub.push(plural(e.skeins, 'skein'));
        if (KIND_LABEL[e.kind]) sub.push(KIND_LABEL[e.kind]);
        if (!e.hex) sub.push('no colour data');
        txt.appendChild(el('span', 'xs-key-sub', sub.join(' · ')));
        row.appendChild(sw);
        row.appendChild(txt);
        var drop = button('xs-key-edit', '✕', 'Leave this row out');
        on(drop, 'click', function () {
          var at = edits.entries.indexOf(e);
          if (at >= 0) edits.entries.splice(at, 1);
          row.classList.toggle('dropped', at >= 0);
          if (at < 0) edits.entries.push(e);
        });
        row.appendChild(drop);
        list.appendChild(row);
      });
      card.appendChild(list);
      if (key.entries.length > 60) card.appendChild(el('p', 'muted', 'Showing the first 60 rows.'));
    }

    if (key.warnings.length) card.appendChild(warningList('Notes', key.warnings, true));

    var progressLine = el('p', 'muted xs-render-progress');
    progressLine.hidden = true;
    card.appendChild(progressLine);

    var go = button('btn primary block',
      key.entries.length ? 'Import the key and pages' : 'Import the pages only');
    on(go, 'click', function () {
      go.disabled = true;
      applyPdf(projectId, edits, key, handle, progressLine).then(function () {
        go.disabled = false;
      }, function () {
        go.disabled = false;
        toast('Something went wrong reading those pages');
      });
    });
    card.appendChild(go);

    /* The beta grid reader, offered only when the key has counts to check
       against and the PDF is still open. Failing costs the stitcher nothing. */
    if (handle && gridIsWorthTrying(key)) {
      var betaBox = el('div', 'xs-beta-box');
      betaBox.hidden = true;
      var beta = button('btn ghost block xs-beta-btn', '🔍 Try to read the grid (beta)');
      on(beta, 'click', function () {
        beta.disabled = true;
        go.disabled = true;
        runGridBeta(handle, key, betaBox, function (res) {
          applyPdf(projectId, edits, key, handle, progressLine, res);
        }).then(function () {
          beta.disabled = false;
          go.disabled = false;
        });
      });
      card.appendChild(beta);
      card.appendChild(betaBox);
      card.appendChild(el('p', 'muted xs-import-note',
        'Reading the grid gets you stitch-by-stitch counting instead of a count per colour. ' +
        'It only works on charts that draw every stitch as a coloured square.'));
    }

    setPreview(card);
  }

  function applyPdf(projectId, edits, key, handle, progressLine, grid) {
    var source = (grid && grid.ok && grid.palette) ? grid.palette : edits.entries;
    var palette = source.map(function (e, i) {
      return {
        i: i, symbol: e.symbol || '', brand: e.brand || 'DMC', code: e.code,
        name: e.name || '', hex: e.hex || '808080',
        strands: e.strands || edits.strands || 2, bsStrands: 1,
        kind: e.kind || 'cross', blendWith: null,
        stitchCount: e.stitchCount || 0, skeins: e.skeins || 0, have: false
      };
    });
    X.assignSymbols(palette);

    Store.updateCraftData(projectId, function (cd) {
      if (palette.length) {
        cd.palette = palette;
        cd.progress.perColor = palette.map(function (e, i) { return { i: i, done: 0 }; });
        cd.current.paletteIndex = 0;
      }
      if (key.design.w && key.design.h) {
        cd.design.w = key.design.w;
        cd.design.h = key.design.h;
      }
      if (key.design.title) cd.design.title = key.design.title;
      if (key.design.designer) cd.design.designer = key.design.designer;
      if (key.copyrightLines.length) cd.design.copyright = key.copyrightLines[0];
      if (key.fabric.count) { cd.fabric.count = key.fabric.count; cd.fabric.countY = key.fabric.count; }
      if (key.fabric.kind) cd.fabric.kind = key.fabric.kind;
      if (key.fabric.over) cd.fabric.over = key.fabric.over;
      if (key.fabric.color) cd.fabric.color = key.fabric.color;
      if (key.strandsDefault) cd.strandsDefault = key.strandsDefault;
      cd.progress.mode = 'counts';
      cd.progress.done = '';
      cd.progress.doneCount = 0;
      if (grid && grid.ok) {
        cd.design.w = grid.w;
        cd.design.h = grid.h;
        cd.chart = {
          w: grid.w, h: grid.h,
          cells: X.packCells(grid.cells, grid.w, grid.h),
          part: [], back: [], knots: []
        };
        cd.progress.mode = 'cells';
        cd.current.cx = 0;
        cd.current.cy = 0;
      }
      cd.notesKey = (key.sizes || []).map(function (s) {
        return s.count + ' ct: ' + s.wIn + ' × ' + s.hIn + ' in';
      }).join('\n');
      cd.source = {
        kind: 'pdf', fileName: '', importedAt: Date.now(),
        warnings: key.warnings.concat(grid && grid.ok ? ['grid read from the PDF by the beta reader'] : [])
          .slice(0, 12)
      };
      return X.normalize(cd, null);
    });

    if (view) { view.img = null; view.cellsKey = null; view.doneKey = null; view.paletteKey = null; }
    C.render();

    if (!handle || typeof handle.renderPage !== 'function') {
      C.closeAllSheets();
      toast('Imported ' + plural(palette.length, 'colour'));
      return Promise.resolve();
    }
    var totalPages = handle.numPages || 0;
    return renderPages(projectId, handle, key, progressLine).then(function (pages) {
      C.closeAllSheets();
      C.render();
      fb('done');
      var bits = ['Read ' + plural(pages, 'page')];
      if (palette.length) bits.push(plural(palette.length, 'colour'));
      if (grid && grid.ok) bits.push(grid.w + ' × ' + grid.h + ' stitches from the grid');
      else if (key.design.w) bits.push(key.design.w + ' × ' + key.design.h + ' stitches');
      toast(bits.join(' · '), { ms: totalPages > MAX_PAGES ? 5200 : 3200 });
      if (totalPages > MAX_PAGES) {
        // A 72-page chart would be ~20 MB of images, so only the first 40 are
        // kept. Say so plainly rather than quietly losing the rest.
        window.setTimeout(function () {
          toast('This chart has ' + totalPages + ' pages; the first ' + MAX_PAGES +
            ' are saved on this device. Keep the PDF for the rest.', { ms: 6000 });
        }, 900);
      }
    });
  }

  /**
   * Rasterise the chart pages into BlobStore, one at a time so a 30-page
   * chart never blocks the main thread for long.
   */
  function renderPages(projectId, handle, key, progressLine) {
    var total = Math.min(handle.numPages || 0, MAX_PAGES);
    if (!total || !window.BlobStore || !window.BlobStore.available()) return Promise.resolve(0);
    var pages = [];
    var chain = Promise.resolve();
    progressLine.hidden = false;

    var allPages = handle.numPages || 0;
    if (allPages > total) {
      progressLine.textContent = 'This chart has ' + allPages + ' pages; saving the first ' +
        total + '…';
    }

    function step(n) {
      return function () {
        progressLine.textContent = 'Rendering page ' + n + ' of ' + total +
          (allPages > total ? ' (of ' + allPages + ')' : '') + '…';
        return handle.renderPage(n, { maxWidth: 1400 }).then(function (canvas) {
          return new Promise(function (resolve) {
            var key2 = 'p:' + projectId + ':chartpage:' + (n - 1);
            var done = function (blob) {
              if (!blob) { resolve(); return; }
              window.BlobStore.put(key2, blob).then(function () {
                pages.push({
                  n: n - 1,
                  label: n === 1 ? 'Cover' : 'Page ' + n,
                  blobKey: key2,
                  w: canvas.width, h: canvas.height,
                  isChart: n > 1
                });
                resolve();
              }, resolve);
            };
            if (canvas.toBlob) canvas.toBlob(done, 'image/jpeg', 0.82);
            else done(null);
          });
        }, function () { /* one bad page should not stop the rest */ });
      };
    }
    for (var n = 1; n <= total; n++) chain = chain.then(step(n));

    return chain.then(function () {
      progressLine.hidden = true;
      if (!pages.length) return 0;
      pages.sort(function (a, b) { return a.n - b.n; });
      Store.updateCraftData(projectId, function (cd) {
        cd.pages = pages;
        cd.progress.pageDone = pages.map(function (pg) { return { page: pg.n, done: false }; });
        cd.current.page = 0;
      });
      if (handle.destroy) { try { handle.destroy(); } catch (e) { /* ignore */ } }
      return pages.length;
    });
  }

  /* ---- grid extraction beta (B3.4) ------------------------------------ */

  /** A parseKey-shaped object built back out of the palette we already have. */
  function keyFromPalette(data) {
    var entries = data.palette.map(function (e) {
      return {
        symbol: e.symbol || '', brand: e.brand || 'DMC', code: e.code, name: e.name || '',
        hex: e.hex || null, strands: e.strands || data.strandsDefault,
        stitchCount: e.stitchCount || null, skeins: e.skeins || null, kind: e.kind || 'cross'
      };
    });
    return {
      entries: entries, strandsDefault: data.strandsDefault,
      design: { w: data.design.w, h: data.design.h }
    };
  }

  function gridIsWorthTrying(key) {
    if (!key || !key.entries || key.entries.length < 2) return false;
    var withCounts = 0;
    for (var i = 0; i < key.entries.length; i++) {
      if (key.entries[i].stitchCount) withCounts++;
    }
    return withCounts >= Math.max(2, Math.ceil(key.entries.length * 0.6));
  }

  /**
   * Run the beta reader against an open pdf.js document and report into
   * `box`. `onUse` is called with the result when the stitcher accepts it.
   */
  function runGridBeta(handle, key, box, onUse) {
    clear(box);
    box.hidden = false;
    var line = el('p', 'muted xs-render-progress', 'Reading the chart pages…');
    box.appendChild(line);
    var t0 = Date.now();

    var doc = handle && handle.doc ? handle.doc : handle;
    return X.extractGrid(doc, null, {
      key: key,
      design: key && key.design,
      onProgress: function (n, total) {
        line.textContent = 'Reading page ' + n + ' of ' + total + '…';
      }
    }).then(function (res) {
      clear(box);
      var secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (!res || !res.ok) {
        box.appendChild(el('p', null,
          'Couldn’t read this chart’s grid — the pages are still here.'));
        if (res && res.warnings && res.warnings.length) {
          box.appendChild(warningList('Why', res.warnings.slice(0, 3), true));
        }
        fb('alert');
        return res;
      }
      var head = el('p', 'xs-beta-ok');
      head.textContent = 'Read ' + res.w + ' × ' + res.h + ' stitches, ' +
        res.matched + ' of ' + res.colors + ' colours matched.';
      box.appendChild(head);
      box.appendChild(el('p', 'muted',
        comma(res.filled || 0) + ' stitches in ' + secs + ' s. Using it replaces the colour ' +
        'key with the one read from the grid and switches counting to individual ' +
        'stitches, which starts from zero — any counts you have now are not carried over.'));
      if (res.warnings.length) box.appendChild(warningList('Notes', res.warnings.slice(0, 4), true));
      var use = button('btn primary block', 'Use it');
      on(use, 'click', function () { onUse(res); });
      box.appendChild(use);
      fb('done');
      return res;
    }, function () {
      clear(box);
      box.appendChild(el('p', null,
        'Couldn’t read this chart’s grid — the pages are still here.'));
      return null;
    });
  }

  function applyGrid(projectId, res) {
    var palette = res.palette.map(function (e, i) {
      return {
        i: i, symbol: e.symbol || '', brand: e.brand || 'DMC', code: e.code,
        name: e.name || '', hex: e.hex || '808080', strands: e.strands, bsStrands: 1,
        kind: e.kind || 'cross', blendWith: null,
        stitchCount: e.stitchCount || 0, skeins: e.skeins || 0, have: !!e.have
      };
    });
    X.assignSymbols(palette);

    Store.updateCraftData(projectId, function (cd) {
      cd.palette = palette;
      cd.design.w = res.w;
      cd.design.h = res.h;
      cd.chart = {
        w: res.w, h: res.h,
        cells: X.packCells(res.cells, res.w, res.h),
        part: [], back: [], knots: []
      };
      cd.progress.mode = 'cells';
      cd.progress.done = '';
      cd.progress.doneCount = 0;
      clearExtraProgress(cd);
      cd.progress.perColor = palette.map(function (e, i) { return { i: i, done: 0 }; });
      cd.current.paletteIndex = 0;
      cd.current.cx = 0;
      cd.current.cy = 0;
      cd.sizeWarnedAt = 0;
      var warn = (cd.source.warnings || []).slice(0);
      cd.source.warnings = warn.concat(['grid read from the PDF by the beta reader'])
        .concat(res.warnings || []).slice(0, 12);
      return X.normalize(cd, null);
    });
    forgetCaches();
    C.closeAllSheets();
    C.render();
    fb('done');
    toast('Grid read · ' + res.w + ' × ' + res.h + ' stitches · ' +
      plural(palette.length, 'colour'), { ms: 4200 });
    checkSize(projectId);
  }

  /** "Try to read the grid (beta)" from the Pages sheet: re-pick the PDF. */
  function openGridBetaSheet(projectId) {
    var proj = Store.project(projectId);
    if (!proj) return;
    var data = dataOf(proj);
    var key = keyFromPalette(data);
    var handle = null;

    C.openSheet({
      title: 'Read the grid (beta)',
      cls: 'sheet-xs-beta',
      build: function (body) {
        body.appendChild(el('p', 'muted',
          'Some chart PDFs draw every stitch as a coloured square, and when they do we can ' +
          'read the whole grid straight out of the file. Pick the same PDF again — it is not ' +
          'kept on this device — and I will try. Nothing is changed unless it works and you ' +
          'say so.'));
        if (!gridIsWorthTrying(key)) {
          body.appendChild(el('p', 'muted',
            'This project’s key has no stitch counts, so there is nothing to check a grid ' +
            'against. Import the PDF again first.'));
          return;
        }
        var box = el('div', 'xs-beta-box');
        box.hidden = true;

        var pick = document.createElement('input');
        pick.type = 'file';
        pick.accept = '.pdf,application/pdf';
        pick.className = 'sr-only';
        var go = button('btn primary block', 'Choose the chart PDF');
        on(go, 'click', function () { pick.click(); });
        on(pick, 'change', function () {
          var f = pick.files && pick.files[0];
          if (!f) return;
          if (!window.PdfText || !window.PdfText.isAvailable()) {
            toast('PDFs cannot be read here');
            return;
          }
          go.disabled = true;
          clear(box);
          box.hidden = false;
          box.appendChild(el('p', 'muted', 'Opening ' + f.name + '…'));
          window.PdfText.open(f).then(function (h) {
            handle = h;
            return runGridBeta(h, key, box, function (res) { applyGrid(projectId, res); });
          }, function () {
            clear(box);
            box.appendChild(el('p', 'muted', 'That PDF could not be opened.'));
          }).then(function () { go.disabled = false; });
        });
        body.appendChild(go);
        body.appendChild(pick);
        body.appendChild(box);
      },
      footer: [{ text: 'Close', cls: 'btn ghost', onClick: function (api) { api.close(); } }],
      onClose: function () {
        if (handle && handle.destroy) { try { handle.destroy(); } catch (e) { /* ignore */ } }
        handle = null;
      }
    });
  }

  /* ---- printable chart (B7) ------------------------------------------- */

  function openPrintable(html, title) {
    var w = null;
    try { w = window.open('', '_blank'); } catch (e) { w = null; }
    if (w && w.document) {
      try {
        w.document.open();
        w.document.write(html);
        w.document.close();
        if (w.focus) w.focus();
        return true;
      } catch (e) { /* fall through to the blob link */ }
    }
    var url;
    try {
      url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    } catch (e2) {
      toast('That chart could not be opened for printing');
      return false;
    }
    C.openSheet({
      title: 'Printable chart',
      build: function (body) {
        body.appendChild(el('p', 'muted',
          'Your browser blocked the new window, so here is the link instead. ' +
          'Open it, then use your browser’s Print command.'));
        var a = el('a', 'btn primary block', 'Open printable chart');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        body.appendChild(a);
        var save = el('a', 'linkish', 'or save it as a file');
        save.href = url;
        save.download = ((title || 'chart').replace(/[^\w -]+/g, '').trim() || 'chart') + '.html';
        body.appendChild(save);
      },
      footer: [{ text: 'Close', cls: 'btn ghost', onClick: function (api) { api.close(); } }],
      onClose: function () {
        window.setTimeout(function () {
          try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        }, 60000);
      }
    });
    return false;
  }

  function openPrintSheet(projectId) {
    var proj = Store.project(projectId);
    if (!proj) return;
    var data = dataOf(proj);
    if (!hasChart(data)) { toast('There is no chart grid to print yet'); return; }

    var settings = { color: true, spp: 60, key: true };
    var saved = Store.craftSettings(CRAFT);
    if (saved.printSpp) settings.spp = clampInt(saved.printSpp, 10, 200, 60);
    if (saved.printColor === false) settings.color = false;

    var estimate;
    function sppBox() { return { w: settings.spp, h: Math.round(settings.spp * 4 / 3) }; }
    function syncEstimate() {
      var box = sppBox();
      var n = Math.ceil(data.chart.w / box.w) * Math.ceil(data.chart.h / box.h);
      estimate.textContent = data.chart.w + ' × ' + data.chart.h + ' stitches · ' +
        box.w + ' × ' + box.h + ' per page · ' + plural(n + 1, 'page') + ' including the cover';
    }

    C.openSheet({
      title: 'Printable chart',
      cls: 'sheet-xs-print',
      build: function (body) {
        body.appendChild(el('p', 'muted',
          'A print-ready page opens in a new tab: a cover with the size table and floss list, ' +
          'then the chart tiled with 10 × 10 lines, margin numbers and the key on every page. ' +
          'Print it, or save it as a PDF.'));

        var colourSeg = C.segmented(
          [{ id: 'color', label: 'Colour' }, { id: 'bw', label: 'Black & white' }],
          settings.color ? 'color' : 'bw',
          function (v) { settings.color = v === 'color'; }
        );
        body.appendChild(field('Style', colourSeg.node,
          'Black and white prints faster and uses much less ink.'));

        var sppStep = C.stepper(settings.spp, 10, 120, 'stitches per page');
        body.appendChild(field('Stitches across a page', sppStep.node,
          'The page height follows at 4:3, the way most charts are tiled.'));
        on(sppStep.node, 'click', function () {
          window.setTimeout(function () { settings.spp = sppStep.get(); syncEstimate(); }, 0);
        });
        on(sppStep.node, 'input', function () { settings.spp = sppStep.get(); syncEstimate(); });

        body.appendChild(C.switchRow('Key on every chart page',
          'Just the colours used on that page.', settings.key,
          function (v) { settings.key = v; }));

        estimate = el('p', 'muted xs-print-estimate');
        body.appendChild(estimate);
        syncEstimate();
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        {
          text: 'Open printable chart',
          cls: 'btn primary',
          onClick: function (api) {
            var fresh = dataOf(Store.project(projectId));
            var html;
            try {
              html = X.printableHTML(fresh, {
                color: settings.color, key: settings.key, stitchesPerPage: sppBox()
              });
            } catch (e) { html = ''; }
            if (!html) { toast('That chart could not be prepared for printing'); return; }
            Store.setCraftSetting(CRAFT, 'printSpp', settings.spp);
            Store.setCraftSetting(CRAFT, 'printColor', settings.color);
            api.close();
            openPrintable(html, fresh.design.title || 'chart');
          }
        }
      ]
    });
  }

  /* ---- photo ---------------------------------------------------------- */

  function photoAvailable() {
    return !!(window.XStitchPhoto && typeof window.XStitchPhoto.isAvailable === 'function' &&
      window.XStitchPhoto.isAvailable() && typeof window.XStitchPhoto.convert === 'function');
  }

  function openPhotoSheet(projectId) {
    if (!photoAvailable()) {
      C.openSheet({
        title: 'Photo to chart',
        build: function (body) {
          body.appendChild(el('p', 'muted',
            'Turning a photo into a chart is coming soon. It runs entirely on your device — ' +
            'no upload, no account — but the module that does it is not available here yet.'));
        },
        footer: [{ text: 'Close', cls: 'btn primary', onClick: function (api) { api.close(); } }]
      });
      return;
    }

    var P = window.XStitchPhoto;
    var proj = Store.project(projectId);
    var data = dataOf(proj);

    var file = null;
    var token = null;        // the in-flight conversion, so sliders can cancel it
    var result = null;
    var timer = null;

    var opts = typeof P.defaults === 'function' ? P.defaults() : {};
    opts.stitchWidth = clampInt(opts.stitchWidth, 20, 500, 100);
    opts.maxColors = clampInt(opts.maxColors, 2, 64, 24);
    opts.count = data.fabric.count;
    opts.over = data.fabric.over;
    opts.strands = data.strandsDefault;
    opts.brand = 'DMC';

    var previewCanvas, statusLine, readout, runBtn, pickBtn, warnBox;

    /* ---- crop frame (B6) ---------------------------------------------- */
    var cropWrap, cropImg, cropBox, cropHint, cropReset, cropLockRow;
    var cropUrl = null, srcW = 0, srcH = 0;
    var crop = null;             // { x, y, w, h } in SOURCE pixels, null = all
    var aspectLock = false;
    var MIN_CROP = 20;
    var CORNER_IDS = ['tl', 'tr', 'bl', 'br'];

    function cropOpt() {
      if (!crop || !srcW || !srcH) return null;
      if (crop.x <= 0 && crop.y <= 0 && crop.w >= srcW && crop.h >= srcH) return null;
      return { x: Math.round(crop.x), y: Math.round(crop.y), w: Math.round(crop.w), h: Math.round(crop.h) };
    }

    function syncCropBox() {
      if (!cropBox || !srcW || !srcH || !crop) return;
      cropBox.style.left = (crop.x / srcW * 100) + '%';
      cropBox.style.top = (crop.y / srcH * 100) + '%';
      cropBox.style.width = (crop.w / srcW * 100) + '%';
      cropBox.style.height = (crop.h / srcH * 100) + '%';
      opts.crop = cropOpt();
      if (cropHint) {
        cropHint.textContent = opts.crop
          ? ('Cropping ' + Math.round(crop.w) + ' × ' + Math.round(crop.h) + ' of ' +
             srcW + ' × ' + srcH + ' pixels')
          : ('Using the whole photo, ' + srcW + ' × ' + srcH + ' pixels');
      }
      if (cropReset) cropReset.hidden = !opts.crop;
    }

    function resetCrop() {
      if (!srcW || !srcH) return;
      crop = { x: 0, y: 0, w: srcW, h: srcH };
      syncCropBox();
    }

    function clampCrop() {
      if (crop.w < MIN_CROP) crop.w = MIN_CROP;
      if (crop.h < MIN_CROP) crop.h = MIN_CROP;
      if (crop.w > srcW) crop.w = srcW;
      if (crop.h > srcH) crop.h = srcH;
      if (crop.x < 0) crop.x = 0;
      if (crop.y < 0) crop.y = 0;
      if (crop.x + crop.w > srcW) crop.x = srcW - crop.w;
      if (crop.y + crop.h > srcH) crop.y = srcH - crop.h;
    }

    function bindCrop() {
      var drag = null;

      function start(e, mode) {
        if (!crop || !srcW) return;
        var r = cropImg.getBoundingClientRect();
        if (!r.width || !r.height) return;
        drag = {
          mode: mode, px: e.clientX, py: e.clientY,
          sx: r.width / srcW, sy: r.height / srcH,
          x: crop.x, y: crop.y, w: crop.w, h: crop.h,
          ratio: crop.h > 0 ? crop.w / crop.h : 1
        };
        try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        e.preventDefault();
        e.stopPropagation();
      }

      function move(e) {
        if (!drag) return;
        var dx = (e.clientX - drag.px) / drag.sx;
        var dy = (e.clientY - drag.py) / drag.sy;
        var right = drag.x + drag.w, bottom = drag.y + drag.h;

        if (drag.mode === 'move') {
          crop.x = drag.x + dx;
          crop.y = drag.y + dy;
          crop.w = drag.w;
          crop.h = drag.h;
        } else {
          var nx = drag.x, ny = drag.y, nr = right, nb = bottom;
          if (drag.mode.charAt(1) === 'l') nx = Math.min(drag.x + dx, right - MIN_CROP);
          else nr = Math.max(right + dx, drag.x + MIN_CROP);
          if (drag.mode.charAt(0) === 't') ny = Math.min(drag.y + dy, bottom - MIN_CROP);
          else nb = Math.max(bottom + dy, drag.y + MIN_CROP);
          crop.x = nx; crop.y = ny; crop.w = nr - nx; crop.h = nb - ny;
          if (aspectLock && drag.ratio > 0) {
            /* keep the shape: the longer change wins, the anchored corner stays */
            var byW = crop.w / drag.ratio;
            var byH = crop.h * drag.ratio;
            if (Math.abs(byW - crop.h) < Math.abs(byH - crop.w)) crop.h = byW;
            else crop.w = byH;
            if (drag.mode.charAt(1) === 'l') crop.x = nr - crop.w;
            if (drag.mode.charAt(0) === 't') crop.y = nb - crop.h;
          }
        }
        clampCrop();
        syncCropBox();
        schedule();
        e.preventDefault();
      }

      function end() { if (drag) { drag = null; schedule(); } }

      on(cropBox, 'pointerdown', function (e) {
        if (e.target !== cropBox) return;
        start(e, 'move');
      });
      CORNER_IDS.forEach(function (id) {
        var handle = el('span', 'xs-crop-h xs-crop-' + id);
        handle.setAttribute('role', 'button');
        handle.setAttribute('aria-label', 'Drag the ' + id + ' corner of the crop');
        on(handle, 'pointerdown', function (e) { start(e, id); });
        on(handle, 'pointermove', move);
        on(handle, 'pointerup', end);
        on(handle, 'pointercancel', end);
        cropBox.appendChild(handle);
      });
      on(cropBox, 'pointermove', move);
      on(cropBox, 'pointerup', end);
      on(cropBox, 'pointercancel', end);
    }

    function loadSource(f) {
      if (cropUrl) { try { URL.revokeObjectURL(cropUrl); } catch (e) { /* ignore */ } }
      cropUrl = URL.createObjectURL(f);
      cropImg.src = cropUrl;
      cropWrap.hidden = true;
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(run, 250);
    }

    function setStatus(text) { if (statusLine) statusLine.textContent = text; }

    function run() {
      if (!file) return;
      // Jobs queue serially on one worker, so the old one has to go first.
      if (token) { try { P.cancel(token); } catch (e) { /* ignore */ } }
      setStatus('Working…');
      if (runBtn) runBtn.disabled = true;

      var pr;
      try {
        pr = P.convert(file, opts, function (p) {
          if (!p || p.token !== token) { /* progress from an older job */ }
          setStatus((p && p.phase ? p.phase : 'working') + ' · ' +
            Math.round(p && typeof p.pct === 'number' ? p.pct : 0) + '%');
        });
      } catch (e) {
        setStatus('That photo could not be converted.');
        if (runBtn) runBtn.disabled = false;
        return;
      }
      token = pr && pr.token ? pr.token : null;
      var mine = token;

      // convert() resolves with { ok:false, error } instead of rejecting.
      Promise.resolve(pr).then(function (r) {
        if (mine !== token) return;                 // superseded by a newer run
        if (runBtn) runBtn.disabled = false;
        if (!r || !r.ok) {
          if (r && r.cancelled) return;             // we cancelled it on purpose
          setStatus((r && r.error) ? ('Could not convert that photo: ' + r.error)
            : 'That photo could not be converted.');
          return;
        }
        result = r;
        drawPreview(r.preview);
        showReadout(r);
      }, function () {
        if (mine !== token) return;
        if (runBtn) runBtn.disabled = false;
        setStatus('That photo could not be converted.');
      });
    }

    function showReadout(r) {
      var d = r.data || {};
      var design = d.design || {};
      var w = design.w || opts.stitchWidth;
      var h = design.h || 0;
      var fin = X.finishedSize({ w: w, h: h, count: opts.count, over: opts.over });
      var s = r.stats || {};
      var bits = [w + ' × ' + h + ' stitches',
        fin.wIn + ' × ' + fin.hIn + ' in on ' + opts.count + ' ct'];
      bits.push(plural(s.colors || (d.palette ? d.palette.length : 0), 'colour'));
      if (s.skeinsTotal) bits.push('about ' + plural(s.skeinsTotal, 'skein'));
      if (s.confetti) {
        bits.push(comma(s.confetti.before) + ' → ' + comma(s.confetti.after) + ' confetti stitches');
      }
      readout.textContent = bits.join(' · ');

      var tail = [];
      if (typeof s.ms === 'number') tail.push('Done in ' + Math.round(s.ms) + ' ms');
      if (typeof s.meanDE === 'number') tail.push('colour match ΔE ' + s.meanDE.toFixed(1) + ' on average');
      if (s.mergedColors) tail.push(plural(s.mergedColors, 'colour') + ' merged onto the same floss');
      setStatus(tail.join(' · ') || 'Done');

      clear(warnBox);
      var warnings = (s.warnings || []).slice(0, 4);
      warnBox.hidden = !warnings.length;
      warnings.forEach(function (msg) { warnBox.appendChild(el('li', null, msg)); });
    }

    function drawPreview(imgData) {
      if (!previewCanvas || !imgData) return;
      // preview is exactly design.w x design.h, so it is blitted 1:1 and
      // scaled up with smoothing off — one stitch per pixel, no blur.
      var off = document.createElement('canvas');
      off.width = imgData.width;
      off.height = imgData.height;
      off.getContext('2d').putImageData(imgData, 0, 0);
      var r = previewCanvas.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      previewCanvas.width = Math.max(1, Math.round(r.width * dpr));
      previewCanvas.height = Math.max(1, Math.round(r.height * dpr));
      var g = previewCanvas.getContext('2d');
      g.imageSmoothingEnabled = false;
      var z = Math.min(previewCanvas.width / off.width, previewCanvas.height / off.height);
      var dw = off.width * z, dh = off.height * z;
      g.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      g.drawImage(off, 0, 0, off.width, off.height,
        Math.round((previewCanvas.width - dw) / 2), Math.round((previewCanvas.height - dh) / 2),
        Math.round(dw), Math.round(dh));
    }

    C.openSheet({
      title: 'Photo to chart',
      cls: 'sheet-photo',
      build: function (body) {
        var pick = document.createElement('input');
        pick.type = 'file';
        pick.accept = 'image/*';
        pick.className = 'sr-only';
        pickBtn = button('btn block', '📷 Choose a photo');
        on(pickBtn, 'click', function () { pick.click(); });
        on(pick, 'change', function () {
          file = pick.files && pick.files[0];
          if (!file) return;
          pickBtn.textContent = file.name;
          crop = null;
          opts.crop = null;
          loadSource(file);
          run();
        });
        body.appendChild(pickBtn);
        body.appendChild(pick);

        /* the source photo with a draggable crop frame */
        cropWrap = el('div', 'xs-crop');
        cropWrap.hidden = true;
        cropImg = el('img');
        cropImg.alt = 'The photo you picked';
        cropWrap.appendChild(cropImg);
        cropBox = el('div', 'xs-crop-box');
        cropBox.setAttribute('role', 'group');
        cropBox.setAttribute('aria-label', 'Crop frame — drag to move, drag a corner to resize');
        cropWrap.appendChild(cropBox);
        on(cropImg, 'load', function () {
          srcW = cropImg.naturalWidth || 0;
          srcH = cropImg.naturalHeight || 0;
          if (!srcW || !srcH) { cropWrap.hidden = true; return; }
          cropWrap.hidden = false;
          resetCrop();
        });
        on(cropImg, 'error', function () { cropWrap.hidden = true; });
        body.appendChild(cropWrap);
        bindCrop();

        var cropRow = el('div', 'xs-crop-row');
        cropHint = el('span', 'muted xs-crop-hint', '');
        cropRow.appendChild(cropHint);
        cropReset = button('linkish xs-crop-reset', 'Reset crop');
        cropReset.hidden = true;
        on(cropReset, 'click', function () { resetCrop(); schedule(); });
        cropRow.appendChild(cropReset);
        body.appendChild(cropRow);

        cropLockRow = C.switchRow('Keep the crop shape',
          'Locks the frame to its current shape while you drag a corner.',
          false, function (v) { aspectLock = v; });
        body.appendChild(cropLockRow);

        previewCanvas = document.createElement('canvas');
        previewCanvas.className = 'xs-photo-preview';
        body.appendChild(previewCanvas);

        statusLine = el('p', 'muted', 'Pick a photo to begin. Everything happens on this device.');
        body.appendChild(statusLine);
        readout = el('p', 'xs-photo-readout');
        body.appendChild(readout);
        warnBox = el('ul', 'xs-warn-list');
        warnBox.hidden = true;
        body.appendChild(warnBox);

        var widthStep = C.stepper(opts.stitchWidth, 20, 500, 'width in stitches');
        body.appendChild(field('Width in stitches', widthStep.node,
          'The height follows the photo. Charts are capped at 500 × 500.'));
        on(widthStep.node, 'click', function () {
          window.setTimeout(function () { opts.stitchWidth = widthStep.get(); schedule(); }, 0);
        });
        on(widthStep.node, 'input', function () { opts.stitchWidth = widthStep.get(); schedule(); });

        var colourStep = C.stepper(opts.maxColors, 2, 64, 'colours');
        body.appendChild(field('Colours', colourStep.node));
        on(colourStep.node, 'click', function () {
          window.setTimeout(function () { opts.maxColors = colourStep.get(); schedule(); }, 0);
        });
        on(colourStep.node, 'input', function () { opts.maxColors = colourStep.get(); schedule(); });

        var countStep = C.stepper(opts.count, 6, 40, 'fabric count');
        body.appendChild(field('Fabric count', countStep.node));
        on(countStep.node, 'click', function () {
          window.setTimeout(function () { opts.count = countStep.get(); schedule(); }, 0);
        });
        on(countStep.node, 'input', function () { opts.count = countStep.get(); schedule(); });

        var adv = el('details', 'xs-advanced');
        adv.appendChild(el('summary', null, 'Advanced'));
        adv.appendChild(C.switchRow('Dithering',
          'Off by default: every dithered cell is another thread change.',
          !!opts.dither, function (v) { opts.dither = v; schedule(); }));
        var cleanSeg = C.segmented(
          [{ id: '0', label: 'None' }, { id: '1', label: 'Light' }, { id: '2', label: 'Strong' }],
          String(opts.cleanup === undefined ? 1 : opts.cleanup),
          function (v) { opts.cleanup = parseInt(v, 10); schedule(); }
        );
        adv.appendChild(field('Confetti cleanup', cleanSeg.node,
          'Confetti is a single stitch with no neighbours of its own colour — the thing ' +
          'stitchers complain about most.'));
        body.appendChild(adv);

        runBtn = button('btn ghost block', 'Redo the conversion');
        on(runBtn, 'click', run);
        body.appendChild(runBtn);
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        {
          text: 'Use this chart',
          cls: 'btn primary',
          onClick: function (api) {
            if (!result || !result.data) { toast('Convert a photo first'); return; }
            applyPhoto(projectId, result, file);
            api.close();
          }
        }
      ],
      onClose: function () {
        if (timer) clearTimeout(timer);
        if (token) { try { P.cancel(token); } catch (e) { /* ignore */ } }
        token = null;
        if (cropUrl) { try { URL.revokeObjectURL(cropUrl); } catch (e) { /* ignore */ } }
        cropUrl = null;
      }
    });
  }

  /**
   * The photo module hands back a full XSData that has already been through
   * XStitch.normalize, so this is mostly a straight adoption plus a title.
   */
  function applyPhoto(projectId, result, file) {
    var d = result.data;
    var title = '';
    if (file && file.name) title = String(file.name).replace(/\.[a-z0-9]+$/i, '').slice(0, 60);

    Store.updateCraftData(projectId, function (cd) {
      var next = X.normalize(d, null);
      // Keep what the stitcher set up that the photo cannot know about.
      next.design.title = (d.design && d.design.title) || title || cd.design.title || '';
      next.design.designer = cd.design.designer;
      next.fabric.kind = cd.fabric.kind;
      next.fabric.color = cd.fabric.color;
      next.notesKey = cd.notesKey;
      next.pages = cd.pages;
      next.parking = [];
      next.stash = {};
      next.sizeWarnedAt = 0;
      return next;
    });
    forgetCaches();
    C.closeAllSheets();
    C.render();
    fb('done');
    var stats = result.stats || {};
    toast('Chart made from your photo · ' +
      plural(stats.colors || (d.palette ? d.palette.length : 0), 'colour'));
    checkSize(projectId);
  }

  /* ================================================================== *
   * 8. Export
   * ================================================================== */

  function exportOxs(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    if (!hasChart(data)) {
      toast('Only a cell chart can be exported as OXS');
      return;
    }
    var xml;
    try { xml = X.toOXS(data); } catch (e) { xml = ''; }
    if (!xml) { toast('That chart could not be written out'); return; }
    var name = (p.name || 'chart').replace(/[^\w\- ]+/g, '').trim() || 'chart';
    try {
      var blob = new Blob([xml], { type: 'application/xml' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name + '.oxs';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast('Saved ' + name + '.oxs');
    } catch (e2) {
      showTextSheet(xml);
    }
  }

  /* ================================================================== *
   * 9. Menu, new-project fields, summary, help
   * ================================================================== */

  function menuItems(project) {
    var data = dataOf(project);
    var items = [
      { icon: '▦', label: 'Chart', run: function () { openChartSheet(project.id); } },
      { icon: '🧵', label: 'Floss list', run: function () { openFlossSheet(project.id); } },
      { icon: '📐', label: 'Fabric & size', run: function () { openFabricSheet(project.id); } },
      { icon: '📌', label: 'Parking notes', run: function () { openParkingSheet(project.id); } }
    ];
    if (data.pages.length) {
      items.push({ icon: '📄', label: 'Chart pages', run: function () { openPagesSheet(project.id); } });
    }
    if (hasChart(data)) {
      items.push({ icon: '🖨', label: 'Printable chart', run: function () { openPrintSheet(project.id); } });
      items.push({ icon: '💾', label: 'Export as OXS', run: function () { exportOxs(project.id); } });
    }
    return items;
  }

  function newProjectFields(body, ctx) {
    useCtx(ctx);
    var saved = Store.craftSettings(CRAFT);
    var draft = {
      w: null, h: null,
      count: clampInt(saved.count, 6, 40, 14),
      kind: saved.kind === 'evenweave' || saved.kind === 'linen' ? saved.kind : 'aida',
      over: saved.over === 2 ? 2 : 1,
      strands: clampInt(saved.strands, 1, 6, 2)
    };

    var sizeRow = el('div', 'xs-two');
    var wIn = C.numInput('', 1, 20000, 'e.g. 89');
    var hIn = C.numInput('', 1, 20000, 'e.g. 74');
    on(wIn, 'input', function () { draft.w = clampInt(wIn.value, 1, 20000, null); });
    on(hIn, 'input', function () { draft.h = clampInt(hIn.value, 1, 20000, null); });
    sizeRow.appendChild(field('Width in stitches', wIn));
    sizeRow.appendChild(field('Height in stitches', hIn));
    body.appendChild(sizeRow);

    var countStep = C.stepper(draft.count, 6, 40, 'fabric count');
    body.appendChild(field('Fabric count', countStep.node, 'You can change all of this later.'));

    var kindSeg = C.segmented(
      [{ id: 'aida', label: 'Aida' }, { id: 'evenweave', label: 'Evenweave' }, { id: 'linen', label: 'Linen' }],
      draft.kind,
      function (v) { draft.kind = v; draft.over = v === 'aida' ? 1 : 2; }
    );
    body.appendChild(field('Fabric', kindSeg.node));

    return {
      get: function () {
        var count = countStep.get();
        Store.setCraftSetting(CRAFT, 'count', count);
        Store.setCraftSetting(CRAFT, 'kind', draft.kind);
        Store.setCraftSetting(CRAFT, 'over', draft.over);
        return {
          fabric: { count: count, countY: count, over: draft.over, kind: draft.kind, color: 'White' },
          design: { w: draft.w, h: draft.h, title: '', designer: '', copyright: '' },
          strandsDefault: draft.strands
        };
      }
    };
  }

  function summary(project) {
    try { return X.summary(project); } catch (e) { return 'Cross-stitch project'; }
  }

  function onTheme() {
    // The chart is painted in real floss and fabric colours, which do not
    // follow the theme; only the surrounding chrome does. A redraw keeps the
    // canvas crisp after a theme swap changes its size.
    if (view) redrawAll();
  }

  var FAQ = [
    {
      q: 'Why couldn’t it read my chart’s grid?',
      a: 'PDF charts draw their squares in hundreds of different ways, so reading the grid is never ' +
        'guaranteed. What we always read is the colour key, the fabric and the size — plain text on ' +
        'almost every chart — plus the chart pages as images you can pan and zoom. After a PDF ' +
        'import there is also a “Try to read the grid (beta)” button: on charts that draw every ' +
        'stitch as a coloured square it recovers the whole grid and checks it against the stitch ' +
        'counts in the key, and if those do not agree it tells you and changes nothing. You can ' +
        'also import an .oxs file (WinStitch, MacStitch, KXStitch, FlossCross and Cross Stitch Saga ' +
        'all export one) or make a chart from a photo.'
    },
    {
      q: 'Can I print my chart?',
      a: 'Yes, once the project has a real grid — from an .oxs file, a photo or the beta grid ' +
        'reader. “Printable chart” in the ⋯ menu opens a print-ready page in a new tab: a cover ' +
        'with the finished-size table and the full floss list, then the chart tiled with 10 × 10 ' +
        'lines, numbers down the margins, centre arrows and the key on every page. Choose colour ' +
        'or black and white, then print it or save it as a PDF. Charts you imported from someone ' +
        'else’s pattern are for your own use only.'
    },
    {
      q: 'What does “over 2” mean?',
      a: 'Aida has clear holes, so one stitch is one square. Evenweave and linen are woven much ' +
        'finer and are normally worked over two threads, which halves the effective count: 28 count ' +
        'linen over 2 gives the same stitch size as 14 count aida. Turn the “over 2” switch on in ' +
        'Fabric & size and the finished measurements follow.'
    },
    {
      q: 'How are skeins estimated?',
      a: 'One full cross takes about 2.5 cm of floss at 14 count, scaled by your fabric count, and a ' +
        'DMC skein is about 8 m of six-strand thread. Published figures range from roughly 960 to ' +
        '1,785 stitches per skein at 14 count with two strands, so we show a range rather than one ' +
        'confident number. Buy towards the top of it if the dye lot matters.'
    },
    {
      q: 'Where are my chart images stored?',
      a: 'On this device only, in the browser’s own storage — never uploaded. They are not in your ' +
        'backup file because they would make it enormous, so keep the original PDF: re-importing it ' +
        'brings the pages straight back. Your stitch progress and colour key are in the backup.'
    }
  ];

  function onInit(ctx) {
    useCtx(ctx);
    if (typeof ctx.addFaq === 'function') {
      FAQ.forEach(function (entry) {
        try { ctx.addFaq(entry); } catch (e) { /* ignore */ }
      });
    }
    registerTour();
  }

  /**
   * Started from Settings the user is on the home screen, where none of this
   * tour's targets exist — every step would be dropped and the tour would mark
   * itself seen without ever showing a card. Open a cross-stitch project first.
   * @returns {boolean} true when a cross-stitch project is on screen
   */
  function openACrossStitchProject() {
    try {
      if (C && typeof C.closeAllSheets === 'function') C.closeAllSheets();
      var all = Store.projects() || [];
      var open = null;
      for (var i = 0; i < all.length; i++) {
        if (all[i].craft !== 'crossstitch') continue;
        if (all[i].status === 'active') { open = all[i]; break; }
        if (!open) open = all[i];
      }
      if (!open) return false;
      Store.setActiveProject(open.id);
      if (C && typeof C.render === 'function') C.render();
      return true;
    } catch (e) {
      return false;
    }
  }

  function registerTour() {
    if (!window.Tour || typeof window.Tour.register !== 'function') return;
    try {
      window.Tour.register({
        id: 'crossstitch',
        title: 'Counting a cross-stitch chart',
        blurb: 'The chart, the current colour and the big button.',
        steps: function () {
          return [
            {
              target: '.xs-chart-card',
              before: function () { openACrossStitchProject(); },
              fallback: 'center',
              title: 'Your chart lives here',
              body: 'Drag to move around and pinch to zoom. Double-tap to fit the whole design. ' +
                'The heavy lines are every ten squares, the same as the gridding on your fabric.',
              fallbackTitle: 'Start a cross-stitch project first',
              fallbackBody: 'This one walks around the cross-stitch screen, so it needs a chart to ' +
                'point at. Tap ＋ New, choose Cross-stitch, then come back to this tour.'
            },
            {
              target: '.xs-cb',
              title: 'One colour at a time',
              body: 'This is the colour you are stitching. Tap ‹ and › to step through the key, or ' +
                'tap the middle to open the whole floss list.'
            },
            {
              target: '#xs-stitch-btn',
              title: 'Tap for every stitch',
              body: 'Each tap marks the next square of this colour and paints it into the little ' +
                'picture behind the number, so the design appears as you stitch.',
              tryIt: 'give it a tap.'
            },
            {
              target: '.xs-key-card',
              title: 'The colour key',
              body: 'Tap a row to make it the current colour, ◉ to dim everything else on the ' +
                'chart, and the box to tick off floss you already own.'
            },
            {
              target: '.craft-body .bottombar',
              title: 'Undo and the rest',
              body: 'Undo takes back the last thing you did. Chart opens the full-screen view with ' +
                'the marking tools, Pages shows the pages from your PDF, and Floss works out how ' +
                'many skeins you need.'
            }
          ];
        }
      });
    } catch (e) { /* a tour is optional */ }
  }

  /* ================================================================== *
   * 10. Registration
   * ================================================================== */

  App.registerCraft({
    id: CRAFT,
    name: 'Cross-stitch',
    emoji: '🧵',
    tagline: 'Charts, floss and progress.',
    renderProject: renderProject,
    destroyProject: destroyProject,
    menuItems: menuItems,
    openImportSheet: openImportSheet,
    newProjectFields: newProjectFields,
    summary: summary,
    onTheme: onTheme,
    onInit: onInit
  });

})();
