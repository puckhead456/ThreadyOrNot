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
      tapHistory: [],      // cells the big button marked, newest last (for −1)
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
    if (!view.stats) view.stats = statsOf(data);
    if (hasChart(data) && !view.img) buildImages(data);
  }

  /**
   * #1 the honesty sweep: ONE total. progressStats over the chart, plus each
   * cross colour the chart holds no square of but whose key printed a count
   * (palette[i].keyCount): that colour is counted from the key ("counted from
   * the key, not on the chart"), its done from progress.keyDone, so the
   * header, the key row, the Floss sheet and the home card all agree with
   * XStitch.totals. Placeholders a read could not name are never counted twice.
   */
  function statsOf(data) {
    var st = X.progressStats(data);
    if (!hasChart(data) || data.progress.mode !== 'cells') return st;
    var kd = isObj(data.progress.keyDone) ? data.progress.keyDone : {};
    for (var i = 0; i < data.palette.length; i++) {
      var e = data.palette[i], c = st.byColor[i];
      if (!c || c.total > 0 || e.unresolved || !(e.keyCount > 0)) continue;
      if (e.kind !== 'cross' && e.kind !== 'blend') continue;
      c.fromKey = true;
      c.total = e.keyCount;
      c.done = Math.min(e.keyCount, clampInt(kd[i], 0, 1e9, 0));
      c.complete = colourComplete(c);
      st.total += c.total;
      st.done += c.done;
      if (st.breakdown && st.breakdown.cross) {
        st.breakdown.cross.total += c.total;
        st.breakdown.cross.done += c.done;
      }
    }
    st.pct = st.total > 0 ? Math.floor(st.done / st.total * 100) : 0;
    return st;
  }

  /** "0.03%", "41%": one decimal style everywhere (XStitch.pctText). */
  function pctOf(done, total) {
    if (typeof X.pctText === 'function') return X.pctText(done, total);
    return (total > 0 ? Math.round(done / total * 100) : 0) + '%';
  }

  function oneTotal(data, stats) {
    var st = stats || statsOf(data);
    return { done: st.done, total: st.total, pctText: pctOf(st.done, st.total) };
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
    s.pct = s.total > 0 ? Math.floor(s.done / s.total * 100) : 0;
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

  /* Ruler gutters (wave F, 04 #1), in CSS px. The left one widens for a
     four-digit row count (Pokémon quadrants are 1000 rows tall). */
  var RULER_T = 16, RULER_L = 26, RULER_L_WIDE = 32;
  var RULER_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  /* Theme colours for the rulers, read once per theme rather than per frame
     (getComputedStyle on every pan frame forces a style recalc). */
  var rulerTheme = null;
  function rulerColours() {
    if (rulerTheme) return rulerTheme;
    var cs = null;
    try { cs = window.getComputedStyle(document.documentElement); } catch (e) { cs = null; }
    function v(name, dflt) {
      if (!cs) return dflt;
      var s = C && C.cssVar ? C.cssVar(cs, name, dflt) : (cs.getPropertyValue(name) || '').trim();
      return s || dflt;
    }
    rulerTheme = {
      bg: v('--surface', '#ffffff'),
      text: v('--text', '#222222'),
      line: v('--border', '#cccccc'),
      mark: v('--primary', '#d23c3c'),
      centre: v('--danger', '#c0392b')
    };
    return rulerTheme;
  }

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

  /* ---- #9 / R5: the designer's own symbols -------------------------------
     A palette entry read cleanly from the pattern carries `glyph` (a 16 × 16
     bitmap, and a vector path for PDF charts). It is drawn instead of the
     app's symbol only when `glyph.clean`; a half-read symbol never is (BUILD
     decision). Settings → Cross-stitch "Symbols" switches back to the app's set. */
  function patternSymbols() {
    var s = Store.craftSettings ? Store.craftSettings(CRAFT) : null;
    return !(s && s.appSymbols === true);
  }

  var spriteCache = { key: '', map: {} };

  function glyphSprite(v, e, size, ink) {
    var gl = e && e.glyph;
    if (!gl || !gl.clean || !(gl.path || gl.bits)) return null;
    var sig = (view ? view.paletteKey : '') + '|' + (view ? view.projectId : '');
    if (spriteCache.key !== sig) spriteCache = { key: sig, map: {} };
    var k = v + '|' + size + '|' + ink;
    if (spriteCache.map[k] !== undefined) return spriteCache.map[k];
    var c = document.createElement('canvas');
    c.width = size; c.height = size;
    var g = c.getContext('2d');
    var ok = false;
    try {
      if (gl.path && window.Path2D) {
        g.save();
        g.scale(size / 100, size / 100);
        g.fillStyle = ink;
        g.fill(new window.Path2D(gl.path));
        g.restore();
        ok = true;
      } else if (gl.bits) {
        var raw = window.atob(gl.bits);
        var t = document.createElement('canvas');
        t.width = 16; t.height = 16;
        var tg = t.getContext('2d'), img = tg.createImageData(16, 16);
        for (var q = 0; q < 256; q++) {
          if ((raw.charCodeAt(q >> 3) >> (7 - (q & 7))) & 1) img.data[q * 4 + 3] = 255;
        }
        tg.putImageData(img, 0, 0);
        g.imageSmoothingEnabled = size < 16;
        g.drawImage(t, 0, 0, size, size);
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = ink;
        g.fillRect(0, 0, size, size);
        ok = true;
      }
    } catch (err) { ok = false; }
    spriteCache.map[k] = ok ? c : null;
    return spriteCache.map[k];
  }

  function makeChartView(opts) {
    opts = opts || {};
    var wrap = el('div', 'xs-chart-wrap' + (opts.cls ? ' ' + opts.cls : ''));
    var canvas = document.createElement('canvas');
    canvas.className = 'xs-chart';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Chart');
    wrap.appendChild(canvas);

    /* Wave F (04 #1): the position readout is permanent. Line 1 counts from
       the top-left like the rulers, line 2 from the centre arrows. It follows
       the crosshair (the tapped / current stitch); a mouse hovering over the
       chart shows the stitch under it until it leaves. */
    var coord = el('div', 'xs-coord');
    coord.setAttribute('aria-live', 'off');
    var coordGrid = el('span', 'xs-coord-grid');
    var coordCentre = el('span', 'xs-coord-centre');
    coord.appendChild(coordGrid);
    coord.appendChild(coordCentre);
    wrap.appendChild(coord);

    /* `laidOut`: fitted or restored for the canvas's current size.
       `userView`: the stitcher has zoomed or panned away from Fit, so a
       resize keeps the middle stitch in the middle instead of re-fitting. */
    var st = { z: 0, ox: 0, oy: 0, laidOut: false, userView: false, cw: 0, ch: 0, pendingView: null };
    var rulers = opts.rulers !== false;
    var pending = false;
    var ro = null;
    var pointers = {};
    var pinch = null;
    var painting = null;
    var lastTapAt = 0;
    var destroyed = false;
    var hover = null;
    var coordKey = '';

    function cssSize() {
      var r = canvas.getBoundingClientRect();
      return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    }

    /* The ruler gutters overlay the canvas, so Fit and the pan limits leave
       room for them: the first column and row are never hidden underneath. */
    function rulerIns() {
      if (!rulers) return { l: 0, t: 0 };
      return { l: view.h >= 1000 ? RULER_L_WIDE : RULER_L, t: RULER_T };
    }

    /* wave K (xs-audit): `opts.safe()` -> { l, t, r, b } is the part of the
       canvas a floating HUD covers (Stitch mode under the HUD). Fit, the pan
       limits, centring and the rulers work inside the free rectangle; the
       chart still paints the whole canvas, under the HUD's panels. */
    function safeIns() {
      var o = null;
      if (typeof opts.safe === 'function') { try { o = opts.safe(); } catch (e) { o = null; } }
      return o ? { l: o.l || 0, t: o.t || 0, r: o.r || 0, b: o.b || 0 } : { l: 0, t: 0, r: 0, b: 0 };
    }

    function insets() {
      var ru = rulerIns(), sf = safeIns();
      return { l: sf.l + ru.l, t: sf.t + ru.t, r: sf.r, b: sf.b };
    }

    function fitZ(s) {
      var ins = insets();
      var z = Math.min((s.w - ins.l - ins.r) / view.w, (s.h - ins.t - ins.b) / view.h);
      return z > 0 ? z : 1;
    }

    function fit(silent) {
      var s = cssSize();
      if (!view.w || !view.h) return;
      var ins = insets();
      var z = fitZ(s);
      st.z = z;
      st.ox = ins.l + (s.w - ins.l - ins.r - view.w * z) / 2;
      st.oy = ins.t + (s.h - ins.t - ins.b - view.h * z) / 2;
      st.laidOut = true;
      st.userView = false;
      st.cw = s.w; st.ch = s.h;
      invalidate();
      if (!silent) changed();
    }

    function clampPan() {
      var s = cssSize();
      var ins = insets();
      var cw = view.w * st.z, ch = view.h * st.z;
      var aw = s.w - ins.l - ins.r, ah = s.h - ins.t - ins.b;
      if (cw <= aw) st.ox = ins.l + (aw - cw) / 2;
      else st.ox = Math.min(ins.l, Math.max(s.w - ins.r - cw, st.ox));
      if (ch <= ah) st.oy = ins.t + (ah - ch) / 2;
      else st.oy = Math.min(ins.t, Math.max(s.h - ins.b - ch, st.oy));
    }

    /** The stitch (fractional) at the middle of the chart area. */
    function centreCell(s) {
      var ins = insets();
      return {
        x: (ins.l + (s.w - ins.l - ins.r) / 2 - st.ox) / st.z,
        y: (ins.t + (s.h - ins.t - ins.b) / 2 - st.oy) / st.z
      };
    }

    function placeCentre(s, x, y) {
      var ins = insets();
      st.ox = ins.l + (s.w - ins.l - ins.r) / 2 - x * st.z;
      st.oy = ins.t + (s.h - ins.t - ins.b) / 2 - y * st.z;
      clampPan();
    }

    /** Restore a saved { z, x, y }, never below Fit for this canvas. */
    function applyView(v) {
      var s = cssSize();
      if (!view.w || !view.h || !v) { fit(true); return; }
      var fz = fitZ(s);
      st.z = Math.max(fz, Math.min(X.VIEW_MAX_Z, v.z));
      placeCentre(s, v.x, v.y);
      st.laidOut = true;
      st.userView = st.z > fz * 1.001;
      st.cw = s.w; st.ch = s.h;
      invalidate();
    }

    /* Tell the owner the view moved (the chart sheet persists it). */
    function changed() {
      if (typeof opts.onViewChange === 'function') {
        try { opts.onViewChange(st.userView ? api.getView() : null); } catch (e) { /* ignore */ }
      }
    }

    function userMoved() {
      st.userView = true;
      changed();
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
      }
      if (!st.laidOut || st.cw !== s.w || st.ch !== s.h) relayout(s);
      var g = canvas.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.imageSmoothingEnabled = false;

      var ground = view.paintTables ? view.paintTables.ground : [250, 248, 243];
      g.fillStyle = 'rgb(' + ground[0] + ',' + ground[1] + ',' + ground[2] + ')';
      g.fillRect(0, 0, s.w, s.h);

      var z = st.z;
      g.drawImage(view.imgCanvas, 0, 0, view.w, view.h, st.ox, st.oy, view.w * z, view.h * z);

      if (z >= GRID_MIN_PX) drawGrid(g, s, z, true);
      /* Below 8 px a stitch the minor lines are noise, but the 10×10 blocks
         are how a stitcher counts, so they stay while a block is ~5 px. */
      else if (z * 10 >= 5) drawGrid(g, s, z, false);
      if (z >= GRID_MIN_PX * 1.5) drawSymbols(g, s, z);
      if (z >= GRID_MIN_PX) drawExtras(g, s, z);
      if (opts.pages !== false) drawPages(g, s, z);
      if (z >= GRID_MIN_PX) drawParking(g, s, z);
      drawCentreLines(g, s, z);
      drawCrosshair(g, z);
      if (rulers) drawRulers(g, s, z);
      syncCoord();
    }

    /* The canvas changed size (first paint, rotate, sheet resize): restore a
       pending saved view, keep the middle stitch in the middle of a zoomed
       view, or fit. */
    function relayout(s) {
      if (st.pendingView) {
        var v = st.pendingView;
        st.pendingView = null;
        applyView(v);
        return;
      }
      if (st.laidOut && st.userView && st.cw > 1 && st.ch > 1) {
        var ins = insets();
        var cx = (ins.l + (st.cw - ins.l - ins.r) / 2 - st.ox) / st.z;
        var cy = (ins.t + (st.ch - ins.t - ins.b) / 2 - st.oy) / st.z;
        st.z = Math.max(fitZ(s), st.z);
        st.cw = s.w; st.ch = s.h;
        placeCentre(s, cx, cy);
        return;
      }
      fit(true);
    }

    function syncCoord() {
      var c = hover || { x: clampInt(view.cx, 0, Math.max(0, view.w - 1), 0), y: clampInt(view.cy, 0, Math.max(0, view.h - 1), 0) };
      var key = c.x + ',' + c.y + ',' + view.w + ',' + view.h;
      if (key === coordKey) return;
      coordKey = key;
      var lab = X.positionLabel(c.x, c.y, view.w, view.h);
      coordGrid.textContent = lab.grid;
      coordCentre.textContent = lab.centre;
      coord.title = lab.text + ' · ' + lab.block;
      canvas.setAttribute('aria-label', 'Chart, ' + view.w + ' by ' + view.h + ' stitches. Current stitch ' +
        lab.text + '.');
    }

    /**
     * The design centre, the way paper charts mark it: a hairline across the
     * chart at floor-free w/2 and h/2 (between the two middle stitches of an
     * even count, through the middle of the centre stitch of an odd one).
     * The arrows themselves sit on the rulers.
     */
    function drawCentreLines(g, s, z) {
      var mx = st.ox + view.w / 2 * z, my = st.oy + view.h / 2 * z;
      var c = rulerColours();
      g.save();
      g.lineWidth = z >= GRID_MIN_PX ? 2 : 1;
      g.strokeStyle = c.centre;
      g.globalAlpha = 0.55;
      if (g.setLineDash) g.setLineDash([6, 4]);
      g.beginPath();
      if (mx > 0 && mx < s.w) { g.moveTo(Math.round(mx) + 0.5, Math.max(0, st.oy)); g.lineTo(Math.round(mx) + 0.5, Math.min(s.h, st.oy + view.h * z)); }
      if (my > 0 && my < s.h) { g.moveTo(Math.max(0, st.ox), Math.round(my) + 0.5); g.lineTo(Math.min(s.w, st.ox + view.w * z), Math.round(my) + 0.5); }
      g.stroke();
      g.restore();
    }

    /**
     * Sticky rulers in screen space (04 #1): a top strip numbering columns and
     * a left strip numbering rows, every 10 stitches (or 20, 50, 100 when ten
     * stitches are too narrow to label), counted from 1 like a printed chart.
     * The crosshair's column and row are highlighted on them and the centre
     * arrows (▼ / ▶) sit at the design centre at every zoom.
     */
    function drawRulers(g, s, z) {
      /* under a floating HUD the rulers frame the free rectangle */
      var sf = safeIns();
      if (!sf.l && !sf.t && !sf.r && !sf.b) { drawRulersIn(g, s, z); return; }
      var ox = st.ox, oy = st.oy;
      g.save();
      g.beginPath();
      g.rect(sf.l, sf.t, Math.max(0, s.w - sf.l - sf.r), Math.max(0, s.h - sf.t - sf.b));
      g.clip();
      g.translate(sf.l, sf.t);
      st.ox = ox - sf.l; st.oy = oy - sf.t;
      try { drawRulersIn(g, { w: s.w - sf.l - sf.r, h: s.h - sf.t - sf.b }, z); }
      finally { st.ox = ox; st.oy = oy; g.restore(); }
    }

    function drawRulersIn(g, s, z) {
      var c = rulerColours();
      var ins = rulerIns();
      var L = ins.l, T = ins.t;
      var step = X.rulerStep(z, 30);
      var x, y, px, py;

      g.save();
      /* opaque: symbols showing through made the row numbers hard to read */
      g.fillStyle = c.bg;
      g.fillRect(0, 0, s.w, T);
      g.fillRect(0, T, L, s.h - T);
      g.strokeStyle = c.line;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(L, T + 0.5); g.lineTo(s.w, T + 0.5);
      g.moveTo(L + 0.5, T); g.lineTo(L + 0.5, s.h);
      g.stroke();

      /* the crosshair's column and row, as a band on each ruler */
      var cx = clampInt(view.cx, 0, Math.max(0, view.w - 1), 0);
      var cy = clampInt(view.cy, 0, Math.max(0, view.h - 1), 0);
      g.fillStyle = c.mark;
      px = st.ox + cx * z;
      if (px + z > L && px < s.w) g.fillRect(Math.max(L, px), T - 4, Math.max(2, Math.min(z, s.w - px)), 4);
      py = st.oy + cy * z;
      if (py + z > T && py < s.h) g.fillRect(L - 4, Math.max(T, py), 4, Math.max(2, Math.min(z, s.h - py)));

      /* numbers, with a tick at each, and a short minor tick every 10 when
         the labels are further apart than that and ten stitches still show */
      g.font = '600 10px ' + RULER_FONT;
      g.fillStyle = c.text;
      g.strokeStyle = c.text;
      g.textBaseline = 'middle';
      /* a number under a centre arrow is skipped: the arrow wins */
      var amx = st.ox + view.w / 2 * z, amy = st.oy + view.h / 2 * z;
      var x0 = Math.max(0, Math.floor((L - st.ox) / z)), x1 = Math.min(view.w, Math.ceil((s.w - st.ox) / z));
      var y0 = Math.max(0, Math.floor((T - st.oy) / z)), y1 = Math.min(view.h, Math.ceil((s.h - st.oy) / z));
      g.beginPath();
      g.textAlign = 'center';
      for (x = Math.ceil(Math.max(1, x0) / step) * step; x <= x1; x += step) {
        px = Math.round(st.ox + x * z) + 0.5;
        if (px < L + 2 || px > s.w - 2) continue;
        g.moveTo(px, T - 5); g.lineTo(px, T);
        /* the label for stitch x sits over the line that ends stitch x */
        var lx = Math.min(s.w - 12, Math.max(L + 12, px));
        if (Math.abs(lx - amx) >= 14) g.fillText(String(x), lx, T / 2 - 1);
      }
      if (step > 10 && z * 10 >= 4) {
        for (x = Math.ceil(Math.max(1, x0) / 10) * 10; x <= x1; x += 10) {
          if (x % step === 0) continue;
          px = Math.round(st.ox + x * z) + 0.5;
          if (px < L + 2 || px > s.w) continue;
          g.moveTo(px, T - 2); g.lineTo(px, T);
        }
      }
      g.textAlign = 'right';
      for (y = Math.ceil(Math.max(1, y0) / step) * step; y <= y1; y += step) {
        py = Math.round(st.oy + y * z) + 0.5;
        if (py < T + 2 || py > s.h - 2) continue;
        g.moveTo(L - 5, py); g.lineTo(L, py);
        var ly = Math.min(s.h - 6, Math.max(T + 6, py));
        if (Math.abs(ly - amy) >= 9) g.fillText(String(y), L - 6, ly);
      }
      if (step > 10 && z * 10 >= 4) {
        for (y = Math.ceil(Math.max(1, y0) / 10) * 10; y <= y1; y += 10) {
          if (y % step === 0) continue;
          py = Math.round(st.oy + y * z) + 0.5;
          if (py < T + 2 || py > s.h) continue;
          g.moveTo(L - 2, py); g.lineTo(L, py);
        }
      }
      g.stroke();

      /* centre arrows */
      g.fillStyle = c.centre;
      var mx = st.ox + view.w / 2 * z, my = st.oy + view.h / 2 * z;
      if (mx >= L && mx <= s.w) {
        g.beginPath();
        g.moveTo(mx - 5, 1); g.lineTo(mx + 5, 1); g.lineTo(mx, T - 1);
        g.closePath(); g.fill();
      }
      if (my >= T && my <= s.h) {
        g.beginPath();
        g.moveTo(1, my - 5); g.lineTo(1, my + 5); g.lineTo(9, my);
        g.closePath(); g.fill();
      }
      /* the corner square, so the two strips read as one frame */
      g.fillStyle = c.bg;
      g.fillRect(0, 0, L, T);
      g.restore();
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

    /**
     * #4 the printed pages on the chart: a dashed outline round each page's
     * stitch range (pages[i].region, wave F) and its label ("p9"), so the
     * phone talks to the paper copy by page number. A finished page is solid.
     */
    function drawPages(g, s, z) {
      var data = view.data;
      var pages = data && data.pages;
      if (!pages || !pages.length) return;
      var c = rulerColours();
      g.save();
      g.lineWidth = 2;
      g.font = '700 ' + Math.max(10, Math.min(14, Math.round(z * 1.2))) + 'px ' + RULER_FONT;
      g.textBaseline = 'top';
      g.textAlign = 'left';
      for (var i = 0; i < pages.length; i++) {
        var r = pages[i] && pages[i].region;
        if (!r) continue;
        var x = st.ox + r.x * z, y = st.oy + r.y * z, w = r.w * z, h = r.h * z;
        if (x > s.w || y > s.h || x + w < 0 || y + h < 0) continue;
        var done = isPageDone(data, i);
        g.strokeStyle = c.mark;
        g.globalAlpha = done ? 0.9 : 0.7;
        if (g.setLineDash) g.setLineDash(done ? [] : [8, 5]);
        g.strokeRect(Math.round(x) + 1, Math.round(y) + 1, Math.max(0, Math.round(w) - 2), Math.max(0, Math.round(h) - 2));
        if (w >= 34 && h >= 18) {
          var lab = 'p' + (String(pages[i].label || '').match(/(\d+)\s*$/) || [0, pages[i].n + 1])[1] + (done ? ' ✓' : '');
          var tw = g.measureText(lab).width + 8;
          var lx = Math.max(x + 3, 30), ly = Math.max(y + 3, 18);
          if (lx + tw < x + w && ly + 16 < y + h) {
            g.globalAlpha = 0.92;
            g.fillStyle = c.bg;
            g.fillRect(lx, ly, tw, 16);
            g.fillStyle = c.text;
            g.fillText(lab, lx + 4, ly + 2);
          }
        }
      }
      g.restore();
    }

    /**
     * #3 parked threads: a corner triangle in the floss colour, in the corner
     * the stitcher chose, at 8 px a stitch and more.
     */
    function drawParking(g, s, z) {
      var data = view.data;
      var list = data && data.parking;
      if (!list || !list.length) return;
      var pal = data.palette;
      g.save();
      for (var i = 0; i < list.length; i++) {
        var pk = list[i];
        if (typeof pk.x !== 'number' || typeof pk.y !== 'number') continue;
        var x = st.ox + pk.x * z, y = st.oy + pk.y * z;
        if (x + z < 0 || y + z < 0 || x > s.w || y > s.h) continue;
        var e = pk.paletteIndex >= 0 ? pal[pk.paletteIndex] : null;
        var hex = '#' + ((e && e.hex) || '202020');
        var t = Math.max(5, z * 0.55);
        var cx = pk.corner === 'tr' || pk.corner === 'br' ? x + z : x;
        var cy = pk.corner === 'bl' || pk.corner === 'br' ? y + z : y;
        var sx = cx === x ? 1 : -1, sy = cy === y ? 1 : -1;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + sx * t, cy);
        g.lineTo(cx, cy + sy * t);
        g.closePath();
        g.fillStyle = hex;
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = X.symbolInk((e && e.hex) || '202020') === 'light' ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.85)';
        g.stroke();
      }
      g.restore();
    }

    function drawGrid(g, s, z, minor) {
      var x0 = Math.max(0, Math.floor(-st.ox / z));
      var x1 = Math.min(view.w, Math.ceil((s.w - st.ox) / z));
      var y0 = Math.max(0, Math.floor(-st.oy / z));
      var y1 = Math.min(view.h, Math.ceil((s.h - st.oy) / z));
      var x, y;
      if (minor) {
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
      }

      // 10x10 majors, aligned to the gridding on the fabric.
      g.lineWidth = minor ? 2 : 1;
      g.strokeStyle = minor ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.32)';
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
          var ink = doneBit
            ? (X.symbolInk(e.hex) === 'light' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)')
            : 'rgba(0,0,0,0.78)';
          var spr = patternSymbols() ? glyphSprite(v, e, Math.max(6, Math.floor(z * 0.8)), ink) : null;
          if (spr) {
            g.drawImage(spr, Math.round(st.ox + x * z + (z - spr.width) / 2), Math.round(st.oy + y * z + (z - spr.height) / 2));
            continue;
          }
          g.fillStyle = ink;
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

    /* A temporary readout (mouse hover, a drag in progress); null hands the
       chip back to the crosshair. */
    function showCoord(c) {
      hover = c ? { x: c.x, y: c.y } : null;
      syncCoord();
    }
    on(canvas, 'pointerleave', function () { if (hover) showCoord(null); });

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
        gestured = true;
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
      if (p.moved) gestured = true;
      invalidate();
      e.preventDefault();
    });

    var gestured = false;

    function endPointer(e) {
      var p = pointers[e.pointerId];
      delete pointers[e.pointerId];
      if (ptrList().length < 2) pinch = null;
      if (painting && !ptrList().length) { painting = null; showCoord(null); }
      if (gestured && !ptrList().length) { gestured = false; userMoved(); }
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
      showCoord(null);
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
      userMoved();
    });

    if (window.ResizeObserver) {
      // draw() notices the new size itself (st.cw / st.ch) and relayouts.
      ro = new window.ResizeObserver(function () { invalidate(); });
      ro.observe(canvas);
    }

    var api = {
      node: wrap,
      canvas: canvas,
      coord: coord,
      state: st,
      fit: function () { fit(); },
      invalidate: invalidate,
      zoomBy: function (f) {
        var s = cssSize();
        var c = centreCell(s);
        st.z = Math.max(0.05, Math.min(X.VIEW_MAX_Z, st.z * f));
        placeCentre(s, c.x, c.y);
        invalidate();
        userMoved();
      },
      /** Centre stitch (x, y); `minZ` zooms in to at least that many px a stitch. */
      centerOn: function (x, y, minZ) {
        var s = cssSize();
        if (minZ && st.z < minZ) st.z = Math.min(X.VIEW_MAX_Z, minZ);
        placeCentre(s, x + 0.5, y + 0.5);
        invalidate();
        userMoved();
      },
      /** { z, x, y }: zoom in CSS px a stitch and the stitch at the middle. */
      getView: function () {
        var s = st.laidOut ? { w: st.cw, h: st.ch } : cssSize();
        var c = centreCell(s);
        return { z: st.z, x: c.x, y: c.y };
      },
      /** Restore a saved view now, or on first layout if the canvas has no size yet. */
      setView: function (v) {
        if (!v) { if (st.laidOut) fit(true); return; }
        var r = canvas.getBoundingClientRect();
        if (!r.width || !r.height) { st.pendingView = v; st.laidOut = false; invalidate(); return; }
        applyView(v);
      },
      /** The stitch at the middle of the chart area (integer, clamped). */
      middleCell: function () {
        var c = centreCell(st.laidOut ? { w: st.cw, h: st.ch } : cssSize());
        return { x: clampInt(Math.floor(c.x), 0, Math.max(0, view.w - 1), 0), y: clampInt(Math.floor(c.y), 0, Math.max(0, view.h - 1), 0) };
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
      rulerTheme = null;              // the theme may have changed while away
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
      if (sm.chart && sm.projectId === project.id && view.charts.indexOf(sm.chart) < 0) view.charts.push(sm.chart);
      // Appended straight into #craft-body so the shell's own .craft-body
      // rules — the scrolling column and the sticky bottom bar — apply.
      for (var s = 0; s < n.parts.length; s++) main.appendChild(n.parts[s]);
      // Canvases size themselves from layout, so fit after the first paint.
      window.requestAnimationFrame(function () {
        if (!view || view.destroyed) return;
        for (var i = 0; i < view.charts.length; i++) view.charts[i].fit();
        if (view.live) view.live.invalidate();
        if (view.nodes && view.nodes.stitchCanvas && view.data) syncStitched(view.data);
      });
    } else {
      syncModel(data);
    }
    syncScreen(project, data);
  }

  function destroyProject() {
    if (!view) return;
    destroyStitched();
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
        onMove: function (c) {
          setCrosshair(c.x, c.y);
          // a view detail: remembered, never undoable
          saveViewState(project.id, { cx: c.x, cy: c.y });
        }
      });
      n.chartCard.appendChild(n.chart.node);
      var expand = button('xs-expand', '⤢', 'Open the full chart');
      on(expand, 'click', function () { openChartSheet(project.id); });
      n.chart.node.appendChild(expand);
      /* wave K #2: the chart full screen as the working surface */
      if (C.workMode && typeof C.workMode.open === 'function' && data.progress.mode === 'cells') {
        var sm0 = button('btn ghost xs-stitch-mode-btn', '⤢ Stitch mode', 'Stitch mode: the chart full screen');
        on(sm0, 'click', function () { C.workMode.open(); });
        n.chartCard.appendChild(sm0);
      }
      /* Wave J: a chart read from a picture says how its check went, and
         is the way back into that check. */
      n.readBand = button('xs-read-band', null, 'Open the chart check');
      n.readBand.hidden = true;
      n.readBandText = el('span', 'xs-read-band-text');
      n.readBandIcon = el('span', 'xs-read-band-icon', '🖼');
      n.readBand.appendChild(n.readBandIcon);
      n.readBand.appendChild(n.readBandText);
      n.readBand.appendChild(el('span', 'xs-read-band-go', '›'));
      on(n.readBand, 'click', function () {
        var pp = Store.project(project.id);
        var dd = pp ? dataOf(pp) : null;
        if (dd && dd.source && dd.source.kind === 'picture' && !unresolvedCount(dd)) reopenRead(project.id);
        else openGridCheck(project.id);
      });
      n.chartCard.appendChild(n.readBand);
    } else {
      n.pageFrame = el('div', 'xs-page-frame');
      n.pageImg = el('img', 'xs-page-img');
      n.pageImg.alt = 'Chart page';
      n.pageFrame.appendChild(n.pageImg);
      n.pageEmpty = el('div', 'xs-page-empty');
      n.pageFrame.appendChild(n.pageEmpty);
      /* Wave F (04 #14): the page full screen, pinch-zoomable. */
      n.pageExpand = button('xs-expand', '⤢', 'Open this page full screen');
      on(n.pageExpand, 'click', function () {
        var pp = Store.project(project.id);
        if (pp) openPageViewer(project.id, { page: clampInt(dataOf(pp).current.page, 0, 9999, 0) });
      });
      n.pageFrame.appendChild(n.pageExpand);
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
    /* wave K (X1 + X2): the stitched piece, shown once it has drawn */
    if (stitchedOk() && hasChart(data)) {
      n.stitchCanvas = document.createElement('canvas');
      n.stitchCanvas.className = 'stitch-canvas xs-live xs-stitched';
      n.stitchCanvas.setAttribute('aria-hidden', 'true');
      n.stitchCanvas.hidden = true;
      n.stitchBtn.appendChild(n.stitchCanvas);
    }
    n.stitchBtn.appendChild(n.liveCanvas);
    n.stitchCap = el('span', 'stitch-caption', 'STITCHES');
    n.stitchNum = el('span', 'stitch-number', '0');
    n.stitchHint = el('span', 'stitch-hint', 'tap');
    /* xs-audit: the caption and the number sit in the shell's pinned
       .stitch-head row (as on the crochet button), above the canvases; loose
       in the button they were painted under the stitched picture and the
       count could not be seen. */
    n.stitchHead = el('span', 'stitch-head');
    n.stitchHead.appendChild(n.stitchCap);
    n.stitchHead.appendChild(n.stitchNum);
    n.stitchBtn.appendChild(n.stitchHead);
    n.stitchBtn.appendChild(n.stitchHint);
    section.appendChild(n.stitchBtn);
    bindStitchButton(n.stitchBtn, project.id);
    view.live = makeLivePreview(n.liveCanvas);

    n.stitchNote = el('p', 'muted xs-stitch-note');
    n.stitchNote.hidden = true;
    section.appendChild(n.stitchNote);

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
    /* Wave J: the written instructions, for any project with a grid */
    n.rowsBtn = button('btn ghost xs-rows-btn', '☰ Row by row', 'Row by row: the chart written out a row at a time');
    n.rowsBtn.id = 'xs-rows-btn';
    n.rowsBtn.hidden = true;
    on(n.rowsBtn, 'click', function () { openRowsSheet(project.id); });
    actions.appendChild(n.minus);
    actions.appendChild(n.rowsBtn);
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
      'No colours yet. Use the ⋯ menu → Import pattern to drop in a PDF, an OXS chart or a picture of a chart, ' +
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
      var stats = view.stats || statsOf(data);
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

      var edit = button('xs-key-edit', e.unresolved ? '?' : '✎',
        e.unresolved ? 'Choose which colour these stitches are' : 'Edit ' + paletteLabel(e));
      on(edit, 'click', function () {
        var pp = Store.project(project.id);
        var pe2 = pp ? dataOf(pp).palette[i] : null;
        if (pe2 && pe2.unresolved) openResolveSheet(project.id, i);
        else openColourEditor(project.id, i);
      });
      if (e.unresolved) row.classList.add('unresolved');

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
    var stats = view.stats || statsOf(data);
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
    var KD = X.KINDS && typeof X.kindOf === 'function' ? X.KINDS[X.kindOf(data)] : null;
    n.stitchCap.textContent = layer === 'cross' && KD && KD.unit !== 'stitch' ? KD.units.toUpperCase() : X.tapCaption(layer);
    n.stitchNum.textContent = comma(tally.done);
    n.stitchBtn.disabled = cur < 0;
    n.stitchBtn.setAttribute('aria-label',
      e ? ('Mark a ' + LAYER_NOUN[layer] + ' of ' + paletteLabel(e) + ', ' + comma(tally.done) + ' done')
        : 'No colour selected');

    var group = clampInt(project.groupSize, 0, 50, 10);
    var readBits = [];
    if (layer === 'cross' && cur >= 0 && hasChart(data) && data.progress.mode === 'cells' && view.cells) {
      /* 04 #15: in cells mode the button works block by block, so say
         where: 'block 12,7 · 6 left here' (the crosshair's 10×10 block). */
      var bx = Math.floor(view.cx / 10) * 10, by = Math.floor(view.cy / 10) * 10, hereLeft = 0;
      var bb = view.bits.bytes;
      for (var yy = by; yy < by + 10 && yy < view.h; yy++) {
        for (var xx = bx; xx < bx + 10 && xx < view.w; xx++) {
          var ci = yy * view.w + xx;
          if (view.cells[ci] === cur && !((bb[ci >> 3] >> (ci & 7)) & 1)) hereLeft++;
        }
      }
      readBits.push(X.positionLabel(view.cx, view.cy, view.w, view.h).block + ' · ' +
        comma(hereLeft) + ' left here');
    } else if (layer === 'cross' && group > 0 && tally.done > 0) {
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
    n.barFill.style.width = (stats.total ? Math.min(100, stats.done / stats.total * 100) : 0) + '%';
    n.barLabel.textContent = stats.total
      ? (comma(stats.done) + ' of ' + comma(stats.total) +
         (extras ? ' · ' : ' ' + (KD ? KD.units : 'stitches') + ' · ') + pctOf(stats.done, stats.total))
      : 'No stitch counts yet';
    if (n.progress) {
      n.progress.setAttribute('role', 'progressbar');
      n.progress.setAttribute('aria-valuemin', '0');
      n.progress.setAttribute('aria-valuemax', String(stats.total || 0));
      n.progress.setAttribute('aria-valuenow', String(stats.done || 0));
      n.progress.setAttribute('aria-valuetext', n.barLabel.textContent);
    }

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
      var ksp = patternSymbols() && pe.glyph && pe.glyph.clean
        ? glyphSprite(row.i, pe, 18, X.symbolInk(pe.hex) === 'light' ? '#ffffff' : '#111111') : null;
      if (ksp) {
        row.sw.textContent = '';
        var kc = document.createElement('canvas');
        kc.width = 18; kc.height = 18;
        kc.className = 'xs-glyph';
        kc.setAttribute('aria-hidden', 'true');
        kc.getContext('2d').drawImage(ksp, 0, 0);
        row.sw.appendChild(kc);
      }
      row.code.textContent = paletteLabel(pe);
      var left = Math.max(0, st.total - st.done);
      var subBits = [];
      if (st.total) subBits.push(comma(left) + ' left of ' + comma(st.total));
      else if (st.done) subBits.push(comma(st.done) + ' done');
      extraBits(st).forEach(function (b) { subBits.push(b); });
      if (pe.unresolved) subBits.unshift('not told apart: tap ? to choose');
      else if (st.fromKey) {
        /* #1: a colour the grid found no square of is counted from the key */
        subBits.push('counted from the key, not on the chart');
      }
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
    if (n.rowsBtn) n.rowsBtn.hidden = !rowsAvailable(data);
    if (n.readBand) syncReadBand(project, data);
    if (n.stitchCanvas) syncStitched(data);

    redrawAll();
  }

  function syncPageStrip(project, data) {
    var n = view.nodes;
    var pages = data.pages;
    if (!pages.length) {
      n.pageImg.hidden = true;
      n.pageEmpty.hidden = false;
      n.pageEmpty.textContent = readerAvailable()
        ? 'No chart yet. Use the ⋯ menu → Import pattern to drop in a PDF, an OXS file or a picture of a chart.'
        : 'No chart pages yet. Import a PDF or an OXS file from the ⋯ menu.';
      n.pageBar.hidden = true;
      if (n.pageExpand) n.pageExpand.hidden = true;
      return;
    }
    if (n.pageExpand) n.pageExpand.hidden = false;
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

  /* ---- #2 Stitch mode: the chart IS the screen (wave K) -----------------
     On the shell's working-mode contract (docs/wave-k/api/shell-ui.md §1):
     the shell owns the full-screen layout, the header, Options ▾, Keep awake,
     the pedal keys, Escape, the remembered state (Store.focusMode, per
     project) and the announcements; this supplies the chart surface and the
     actions. Taps on the chart are the chart's own (the current tool). */

  var sm = { tool: 'tap', erase: false, chart: null, wrap: null, projectId: null };

  function smProject() {
    var p = C && C.currentProject ? C.currentProject() : null;
    return p && p.craft === CRAFT ? p : null;
  }

  function smPaint() {
    if (sm.chart) sm.chart.invalidate();
  }

  var STITCH_MODE = {
    label: 'Stitch mode',
    icon: '⤢',
    backTo: 'the project',
    tapSurface: false,
    /* wave K (xs-audit): the chart fills the whole screen and the HUD floats
       over it (shell-ui.md §1); Fit and the crosshair stay in the free
       rectangle api.insets() reports. A shell without the option ignores it. */
    surfaceUnderHud: true,
    surface: function (node, api) {
      var p = smProject();
      if (!p || !view || !hasChart(dataOf(p))) {
        node.appendChild(el('p', 'muted xs-work-empty', 'This project has no chart to stitch from yet.'));
        return {};
      }
      sm.projectId = p.id;
      var wrap = el('div', 'xs-work-chart');
      node.appendChild(wrap);
      sm.wrap = wrap;
      sm.chart = makeChartView({
        cls: 'xs-full xs-work',
        interactive: true,
        paintMode: function () { return sm.tool === 'paint'; },
        paintEvery: function () { return false; },
        safe: function () { return sm.safe; },
        onPaint: function (c) { if (sm.projectId) paintAt(sm.projectId, 'cross', c, !sm.erase, true); },
        onTap: function (c) {
          if (!sm.projectId) return;
          setCrosshair(c.x, c.y);
          applyTool(sm.projectId, sm.tool, 'cross', c, !sm.erase);
          api.refresh();
        },
        onViewChange: function () { /* the stitch-mode view is not remembered separately */ }
      });
      sm.chart.canvas.setAttribute('tabindex', '-1');
      wrap.appendChild(sm.chart.node);
      window.requestAnimationFrame(function () {
        if (!sm.chart) return;
        var d = view && view.data;
        var saved = d && d.current && d.current.view;
        if (saved) sm.chart.setView(saved); else sm.chart.fit();
      });
      return {
        destroy: function () {
          if (sm.chart) sm.chart.destroy();
          sm.chart = null;
          sm.wrap = null;
          sm.safe = null;
        },
        resize: function () { smPaint(); },
        insets: function (ins) {
          if (!sm.wrap) return;
          var under = !!(api && typeof api.underHud === 'function' && api.underHud());
          var l = Math.max(0, ins.left - 8), r = Math.max(0, ins.right - 8);
          if (under) {
            /* the canvas fills the screen; the free rectangle is its safe area */
            sm.wrap.style.top = sm.wrap.style.bottom = sm.wrap.style.left = sm.wrap.style.right = '0px';
            sm.safe = { l: l, t: ins.top, r: r, b: ins.bottom };
            sm.wrap.classList.add('xs-under-hud');
            /* the position readout sits in the free rectangle, not under the buttons */
            if (sm.chart && sm.chart.coord) {
              sm.chart.coord.style.bottom = (ins.bottom + 8) + 'px';
              sm.chart.coord.style.left = (l + 36) + 'px';
            }
          } else {
            sm.safe = null;
            sm.wrap.style.top = ins.top + 'px';
            sm.wrap.style.bottom = ins.bottom + 'px';
            sm.wrap.style.left = l + 'px';
            sm.wrap.style.right = r + 'px';
          }
          if (sm.chart && !sm.chart.state.userView) sm.chart.fit();
          smPaint();
        }
      };
    },
    primary: {
      label: 'Mark the next stitch of this colour',
      run: function (api) {
        var p = smProject();
        if (!p) return;
        advanceStitch(p.id);
        smCentre();
        api.refresh();
      }
    },
    /* xs-audit: five corner buttons fit 375 px (six, with words, ran ~70 px off
       the right edge and hid +1); 🎯 lives in Options ▾ and on the N key. */
    cls: 'xs-work-hud',
    back: {
      label: 'Take back the last stitch', glyph: '−1',
      run: function (api) {
        var p = smProject();
        if (p) unmarkOne(p.id);
        api.refresh();
      }
    },
    forward: {
      label: 'Mark the next stitch', glyph: '+1',
      run: function (api) { STITCH_MODE.primary.run(api); }
    },
    undo: true,
    secondary: [
      { id: 'prevColour', glyph: '‹', label: 'Previous colour', side: 'start',
        run: function (api) { var p = smProject(); if (p) stepColour(p.id, -1); api.refresh(); } },
      { id: 'nextColour', glyph: '›', label: 'Next colour', side: 'start',
        run: function (api) { var p = smProject(); if (p) stepColour(p.id, 1); api.refresh(); } }
    ],
    readout: function () {
      var p = smProject();
      if (!p || !view || !view.data) return { title: p ? p.name : 'Stitch mode' };
      return stitchModeReadout(p, view.data);
    },
    panel: function (body, api) {
      var p = smProject();
      if (!p) return;
      body.appendChild(el('div', 'work-panel-label', 'Tap on the chart'));
      var seg = C.segmented(TOOLS, sm.tool, function (v) { sm.tool = v; });
      seg.node.classList.add('xs-tool-seg');
      body.appendChild(seg.node);
      var acts = el('div', 'work-actions');
      var er = button('btn ghost xs-erase' + (sm.erase ? ' on' : ''), 'Unmark');
      er.setAttribute('aria-pressed', sm.erase ? 'true' : 'false');
      on(er, 'click', function () {
        sm.erase = !sm.erase;
        er.classList.toggle('on', sm.erase);
        er.setAttribute('aria-pressed', sm.erase ? 'true' : 'false');
      });
      acts.appendChild(er);
      var hl = button('btn ghost' + (view && view.isolate ? ' on' : ''), '◉ Highlight this colour');
      hl.setAttribute('aria-pressed', view && view.isolate ? 'true' : 'false');
      on(hl, 'click', function () {
        smHighlight(p.id);
        hl.classList.toggle('on', !!(view && view.isolate));
        hl.setAttribute('aria-pressed', view && view.isolate ? 'true' : 'false');
        api.refresh();
      });
      acts.appendChild(hl);
      var bs = button('btn ghost' + (blockScope === 'all' ? ' on' : ''), '10×10: whole block');
      bs.setAttribute('aria-pressed', blockScope === 'all' ? 'true' : 'false');
      bs.title = 'Off: 10×10 marks only the current colour in the block';
      on(bs, 'click', function () {
        blockScope = blockScope === 'all' ? 'colour' : 'all';
        bs.classList.toggle('on', blockScope === 'all');
        bs.setAttribute('aria-pressed', blockScope === 'all' ? 'true' : 'false');
      });
      acts.appendChild(bs);
      var near = button('btn ghost xs-work-near', '🎯 Nearest stitch to do');
      near.setAttribute('aria-label', 'Nearest stitch of this colour still to do');
      on(near, 'click', function () {
        if (sm.chart) findNextStitch(p.id, sm.chart, sm.seen || (sm.seen = {}));
        api.refresh();
      });
      acts.appendChild(near);
      var fit = button('btn ghost', 'Fit the chart');
      on(fit, 'click', function () { if (sm.chart) sm.chart.fit(); });
      acts.appendChild(fit);
      if (typeof X.findPlace === 'function') {
        var fp = button('btn ghost', '🔢 Find my place');
        on(fp, 'click', function () { openFindSheet(p.id); });
        acts.appendChild(fp);
      }
      body.appendChild(acts);
      body.appendChild(el('p', 'muted xs-work-keys',
        'Keys: Space marks the next stitch, arrows or a page-turner pedal mark and take back, ' +
        'H highlights, + and − zoom, F fits, N finds the nearest stitch, J finds a place.'));
    },
    keys: {
      h: function () { var p = smProject(); if (p) smHighlight(p.id); },
      H: function () { var p = smProject(); if (p) smHighlight(p.id); },
      f: function () { if (sm.chart) sm.chart.fit(); },
      '+': function () { if (sm.chart) sm.chart.zoomBy(1.4); },
      '=': function () { if (sm.chart) sm.chart.zoomBy(1.4); },
      '-': function () { if (sm.chart) sm.chart.zoomBy(1 / 1.4); },
      n: function () { var p = smProject(); if (p && sm.chart) findNextStitch(p.id, sm.chart, sm.seen || (sm.seen = {})); },
      j: function () { var p = smProject(); if (p && typeof X.findPlace === 'function') openFindSheet(p.id); }
    },
    onOpen: function () { sm.seen = {}; },
    onClose: function () { sm.seen = null; }
  };

  function smHighlight(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var d = dataOf(p);
    if (!d.palette.length) return;
    toggleIsolate(projectId, clampInt(d.current.paletteIndex, 0, d.palette.length - 1, 0));
    C.announce(view && view.isolate ? 'Highlighting ' + paletteLabel(currentEntry(d)) : 'Every colour shown');
  }

  /** Keep the stitch just marked in view (stitch mode follows the work). */
  function smCentre() {
    if (!sm.chart || !view) return;
    var st = sm.chart.state;
    var r = sm.chart.canvas.getBoundingClientRect();
    var px = st.ox + (view.cx + 0.5) * st.z, py = st.oy + (view.cy + 0.5) * st.z;
    var sf = sm.safe || { l: 0, t: 0, r: 0, b: 0 };
    /* keep the stitch just marked inside the free rectangle, never under the HUD */
    if (px < sf.l + 30 || py < sf.t + 20 || px > r.width - sf.r - 10 || py > r.height - sf.b - 10) sm.chart.centerOn(view.cx, view.cy, st.z);
    else sm.chart.invalidate();
  }

  /** The working-mode readout: this colour, the block, the one total. */
  function stitchModeReadout(p, data) {
    var stats = view.stats || statsOf(data);
    var pal = data.palette;
    var cur = pal.length ? clampInt(data.current.paletteIndex, 0, pal.length - 1, 0) : -1;
    var e = cur >= 0 ? pal[cur] : null;
    var c = cur >= 0 ? (stats.byColor[cur] || { done: 0, total: 0 }) : { done: 0, total: 0 };
    var where = '';
    if (view.cells && cur >= 0 && !c.fromKey) {
      var bx = Math.floor(view.cx / 10) * 10, by = Math.floor(view.cy / 10) * 10, here = 0;
      var bb = view.bits.bytes;
      for (var yy = by; yy < by + 10 && yy < view.h; yy++) {
        for (var xx = bx; xx < bx + 10 && xx < view.w; xx++) {
          var ci = yy * view.w + xx;
          if (view.cells[ci] === cur && !((bb[ci >> 3] >> (ci & 7)) & 1)) here++;
        }
      }
      where = X.positionLabel(view.cx, view.cy, view.w, view.h).block + ' · ' + comma(here) + ' left here';
    }
    var isl = islandLine(data, cur);
    var pg = pageLine(data);
    return {
      title: p.name,
      cells: [
        { cap: e ? paletteLabel(e).toUpperCase().slice(0, 28) : 'NO COLOUR', big: comma(c.done), of: '/ ' + comma(c.total),
          sub: [where, isl].filter(Boolean).join(' · '), cls: 'xs-work-cell',
          label: e ? paletteLabel(e) + ': ' + comma(c.done) + ' of ' + comma(c.total) + ' stitches' : 'No colour' },
        { cap: 'ALL', big: pctOf(stats.done, stats.total), of: '',
          sub: comma(stats.done) + ' of ' + comma(stats.total) + (pg ? ' · ' + pg : ''), cls: 'xs-work-cell xs-work-all' }
      ],
      tip: stats.done ? null : 'Tap a stitch to mark it · Options ▾ for tools',
      say: (e ? paletteLabel(e) + ', ' + comma(c.done) + ' of ' + comma(c.total) + '. ' : '') +
        comma(stats.done) + ' of ' + comma(stats.total) + ' stitches in all.'
    };
  }

  /* ---- #13 islands and travel: worked out when the stitcher pauses ------
     X.islandAt floods the colour and searches for the nearest other island,
     which is too much for every tap on a big chart, so the readout shows the
     last answer and asks again 400 ms after the crosshair settles. */
  var islandMemo = { key: '', text: '', timer: null };

  function islandLine(data, cur) {
    if (typeof X.islandAt !== 'function' || cur < 0 || !view || !view.cells) return '';
    var key = view.projectId + '|' + cur + '|' + view.cx + ',' + view.cy + '|' + view.cellsKey;
    if (islandMemo.key === key) return islandMemo.text;
    if (islandMemo.timer) window.clearTimeout(islandMemo.timer);
    islandMemo.timer = window.setTimeout(function () {
      islandMemo.timer = null;
      if (!view || !view.data) return;
      var cx = view.cx, cy = view.cy, at = cy * view.w + cx, txt = '';
      /* the island of the current colour nearest the crosshair */
      var pos = view.cells[at] === cur ? at
        : X.nearestCellOf(view.cells, view.w, view.h, cur, cx, cy, function () { return false; });
      if (pos >= 0) {
        var r = null;
        try { r = X.islandAt(view.data, pos % view.w, (pos / view.w) | 0); } catch (e) { r = null; }
        if (r) {
          txt = 'island ' + (r.id + 1) + '/' + r.of + (r.nextCm !== null && r.nextCm !== undefined
            ? ' · next ≈ ' + r.nextCm + ' cm' + (r.cut ? ', new thread' : '') : '');
        }
      }
      islandMemo.key = key;
      islandMemo.text = txt;
      if (C.workMode && typeof C.workMode.refresh === 'function') { try { C.workMode.refresh(); } catch (e2) { /* ignore */ } }
    }, 400);
    return islandMemo.text;
  }

  /** "page 9 · 1,204 of 4,081": the printed page under the crosshair (#4). */
  function pageLine(data) {
    if (!view || !view.cells || !data.pages.length || typeof X.pageForCell !== 'function') return '';
    var pi = X.pageForCell(data.pages, view.cx, view.cy);
    var pg = pi >= 0 ? data.pages[pi] : null;
    if (!pg || !pg.region) return '';
    var r = pg.region, bb = view.bits.bytes, done = 0, total = 0;
    for (var y = r.y; y < r.y + r.h && y < view.h; y++) {
      for (var x = r.x; x < r.x + r.w && x < view.w; x++) {
        var i = y * view.w + x;
        if (view.cells[i] < 0) continue;
        total++;
        if ((bb[i >> 3] >> (i & 7)) & 1) done++;
      }
    }
    return String(pg.label || ('Page ' + (pi + 1))).replace(/^Page/, 'page') + ' · ' + comma(done) + ' of ' + comma(total);
  }

  /**
   * #21 "Find my place": col 134 row 57 · 134, 57 · page 9 · block 13,6.
   * Lands the crosshair there (X.findPlace) and shows it on the chart.
   */
  function openFindSheet(projectId) {
    var p = Store.project(projectId);
    if (!p || typeof X.findPlace !== 'function') return;
    var input = null, msg = null;
    function go(api) {
      var pp = Store.project(projectId);
      if (!pp) return;
      var d = dataOf(pp);
      var r = X.findPlace(d, input.value || '');
      if (!r || r.error) {
        msg.textContent = (r && r.error) || 'I could not read that place.';
        msg.className = 'xs-find-msg is-off';
        fb('alert');
        return;
      }
      setCrosshair(r.x, r.y);
      saveViewState(projectId, { cx: r.x, cy: r.y, view: { z: 16, x: r.x + 0.5, y: r.y + 0.5 } });
      api.close();
      C.announce('Now at ' + (r.text || X.positionLabel(r.x, r.y, d.chart.w, d.chart.h).text));
      if (sm.chart && C.workMode && C.workMode.isOn && C.workMode.isOn()) {
        sm.chart.centerOn(r.x, r.y, 16);
        C.workMode.refresh();
      } else {
        openChartSheet(projectId);
      }
      toast(r.text || X.positionLabel(r.x, r.y, d.chart.w, d.chart.h).grid);
    }
    C.openSheet({
      title: 'Find my place',
      cls: 'sheet-xs-find',
      build: function (body, api) {
        body.appendChild(el('p', 'muted', 'Type where you are on your paper chart: a column and row ' +
          '(“col 134 row 57” or “134, 57”), a page (“page 9”) or a 10×10 block (“block 13,6”).'));
        input = C.textInput ? C.textInput('', 'col 134 row 57') : document.createElement('input');
        if (!C.textInput) { input.type = 'text'; input.className = 'input'; }
        input.setAttribute('inputmode', 'text');
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('aria-label', 'Your place on the chart');
        on(input, 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(api || findApi); } });
        body.appendChild(field('Where are you?', input));
        /* a keypad for one-handed entry at the hoop */
        var pad = el('div', 'xs-keypad');
        pad.setAttribute('role', 'group');
        pad.setAttribute('aria-label', 'Keypad');
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].forEach(function (k) {
          var b = button('btn ghost xs-key', k, k === '⌫' ? 'Delete' : k === ',' ? 'Comma' : k);
          on(b, 'click', function () {
            if (k === '⌫') input.value = input.value.slice(0, -1);
            else input.value += k === ',' ? ', ' : k;
            try { input.focus(); } catch (e) { /* ignore */ }
          });
          pad.appendChild(b);
        });
        body.appendChild(pad);
        var words = el('div', 'xs-find-words');
        ['col ', 'row ', 'page ', 'block '].forEach(function (w) {
          var b = button('btn ghost xs-key-word', w.trim());
          on(b, 'click', function () {
            input.value = (input.value && !/\s$/.test(input.value) ? input.value + ' ' : input.value) + w;
            try { input.focus(); } catch (e) { /* ignore */ }
          });
          words.appendChild(b);
        });
        body.appendChild(words);
        msg = el('p', 'xs-find-msg');
        msg.setAttribute('role', 'status');
        msg.setAttribute('aria-live', 'polite');
        body.appendChild(msg);
        /* goals live with the sessions sheet (js/app-xstitch-extras.js) */
        var XE = window.XStitchExtras;
        if (XE && typeof XE.menuItems === 'function' && typeof XE.open === 'function') {
          var its = [];
          try { its = XE.menuItems(pp0()) || []; } catch (e) { its = []; }
          its.forEach(function (it) {
            if (!it || !/goal|session/i.test(String(it.id) + ' ' + String(it.label))) return;
            var gb = button('linkish xs-goal-link', (it.icon ? it.icon + ' ' : '') + it.label);
            on(gb, 'click', function () { XE.open(it.id, pp0(), { ctx: C, app: window.XStitchApp }); });
            body.appendChild(gb);
          });
        }
        window.setTimeout(function () { try { input.focus(); } catch (e) { /* ignore */ } }, 50);
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        { text: 'Go there', cls: 'btn primary', onClick: function (api) { go(api); } }
      ]
    });
    var findApi = { close: function () { C.closeAllSheets(); } };
    function pp0() { return Store.project(projectId) || p; }
  }

  /* ---- X1 + X2: the stitched piece in the tap button (wave K) ----------
     docs/wave-k/api/xs-render.md "Wiring the tap button". The flat preview
     above stays on screen until the renderer has compiled and drawn, and
     comes back if its context is lost. One renderer per screen: the canvas
     is released when the screen goes. */

  function stitchedOk() {
    return !!(window.XSRender && window.XSRender.VERSION && typeof window.XSRender.mount === 'function');
  }

  function stitchedModel(data) {
    return {
      w: view.w, h: view.h, cells: view.cells, done: view.bits.bytes,
      palette: data.palette,
      part: data.chart.part || [], back: data.chart.back || [], knots: data.chart.knots || [],
      doneBack: view.backBits ? view.backBits.bytes : null,
      doneKnots: view.knotBits ? view.knotBits.bytes : null,
      donePart: view.partBits ? view.partBits.bytes : null,
      fabric: { color: data.fabric.color, count: data.fabric.count, over: data.fabric.over, kind: data.fabric.kind },
      strandsDefault: data.strandsDefault
    };
  }

  /** Mount (once) and keep the renderer in step with the view model. */
  function syncStitched(data) {
    var n = view && view.nodes;
    if (!n || !n.stitchCanvas) return;
    if (!stitchedOk() || !hasChart(data) || data.progress.mode !== 'cells' || !view.cells) {
      n.stitchCanvas.hidden = true;
      if (n.liveCanvas) n.liveCanvas.hidden = false;
      return;
    }
    var s = view.stitched;
    var r = n.stitchBtn.getBoundingClientRect();
    if (!s) {
      if (!r.width || !r.height) return;          // after the first layout
      var mode = window.XSRender.buttonView(view.w, view.h, r.width, r.height);
      s = view.stitched = { handle: null, mode: mode, key: '', bits: null, shown: false, status: 'ok', dirty: false };
      try {
        s.handle = window.XSRender.mount(n.stitchCanvas, {
          view: mode === 'whole' ? 'fit' : 'loupe', ghost: 0.28, symbols: false,
          /* the free area under the pinned count row */
          safeInsets: { top: n.stitchHead ? Math.max(34, Math.round(n.stitchHead.getBoundingClientRect().height) + 4) : 34, bottom: 8 },
          minimap: mode !== 'whole',
          reducedMotion: C.prefersReducedMotion ? !!C.prefersReducedMotion() : undefined,
          onStatus: function (st) {
            if (!view || view.stitched !== s) return;
            s.status = st && st.status;
            if (n.stitchNote) {
              n.stitchNote.hidden = !(st && st.status === 'fallback' && st.message);
              if (st && st.message) n.stitchNote.textContent = st.message;
            }
            if (st && st.status === 'lost') { s.shown = false; showStitched(false); }
            if (st && st.status === 'restored') { s.key = ''; syncStitched(view.data); }
          }
        });
      } catch (e) { s.handle = null; }
      if (!s.handle) { view.stitched = null; return; }
    }
    var key = view.cellsKey + '|' + view.paletteKey + '|' + data.fabric.color + '|' + data.fabric.count + '|' +
      data.fabric.kind + '|' + (data.chart.back || []).length + '|' + (data.chart.knots || []).length + '|' +
      (data.chart.part || []).length + '|' + view.backKey + '|' + view.knotKey + '|' + view.partKey;
    try {
      if (s.key !== key) {
        s.handle.setModel(stitchedModel(data), { keepView: !!s.key });
        s.key = key;
        s.bits = view.bits;
        s.dirty = false;
      } else if (s.bits !== view.bits) {
        s.handle.setProgress(view.bits.bytes);    // undo, a bulk mark, a reload
        s.bits = view.bits;
      }
      if (s.mode !== 'whole') {
        var pi = data.palette.length ? clampInt(data.current.paletteIndex, 0, data.palette.length - 1, 0) : -1;
        var nx = null;
        if (pi >= 0 && typeof X.nextStitchNear === 'function') {
          var bb = view.bits.bytes;
          var at = X.nextStitchNear(view.cells, view.w, view.h, pi, view.cx, view.cy, function (i) {
            return ((bb[i >> 3] >> (i & 7)) & 1) === 1;
          });
          if (at >= 0) nx = { x: at % view.w, y: (at / view.w) | 0 };
        }
        s.handle.setLoupe({ x: nx ? nx.x : view.cx, y: nx ? nx.y : view.cy, next: nx });
      }
    } catch (e2) { /* the flat preview stays */ }
    if (!s.shown) watchCompile(s);
  }

  /* Keep the flat preview until the GPU has compiled and drawn a frame. */
  function watchCompile(s) {
    if (s.watching) return;
    s.watching = true;
    var tries = 0;
    (function tick() {
      if (!view || view.stitched !== s || !s.handle) return;
      var st = null;
      try { st = s.handle.getStats(); } catch (e) { st = null; }
      if (st && !st.compiling && (st.frames > 0 || !st.webgl)) {
        s.watching = false;
        s.shown = true;
        showStitched(true);
        return;
      }
      if (++tries > 600) { s.watching = false; return; }   // ~10 s: the flat preview stays
      window.setTimeout(tick, 16);
    })();
  }

  function showStitched(on) {
    var n = view && view.nodes;
    if (!n || !n.stitchCanvas) return;
    n.stitchCanvas.hidden = !on;
    if (n.liveCanvas) n.liveCanvas.hidden = !!on;
  }

  /** The tap path: squares flipped by any tool reach the renderer at once. */
  function stitchedMarked(cells, on) {
    var s = view && view.stitched;
    if (!s || !s.handle) return;
    try {
      if (cells.length === 1) s.handle.setDone(cells[0], on ? 1 : 0, { animate: !!on });
      else if (cells.length) s.handle.setDoneMany(cells, on ? 1 : 0);
    } catch (e) { /* ignore */ }
  }

  function destroyStitched() {
    if (!view || !view.stitched) return;
    try { if (view.stitched.handle) view.stitched.handle.destroy({ release: true }); } catch (e) { /* ignore */ }
    view.stitched = null;
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

    var keyStat = hasChart(data) && data.progress.mode === 'cells' && view.stats ? view.stats.byColor[pi] : null;
    if (keyStat && keyStat.fromKey) {
      /* #1: a colour counted from the key (the chart has none of its
         squares) is counted like a counts-mode colour, in progress.keyDone. */
      if (keyStat.done >= keyStat.total) { toast(paletteLabel(entry) + ' done ✓'); fb('done'); return; }
      Store.updateCraftData(projectId, function (cd) {
        if (!isObj(cd.progress.keyDone)) cd.progress.keyDone = {};
        cd.progress.keyDone[pi] = clampInt(cd.progress.keyDone[pi], 0, 1e9, 0) + 1;
      });
      bumpStats(pi, 1);
      recordWork(projectId, 1, pi, null, true);
      afterCount(projectId, pi, before, beforeByColor);
      return;
    }

    if (hasChart(data) && data.progress.mode === 'cells') {
      /* Crosses first; when this colour has only backstitch, knots or
         fractionals left the same button walks those instead. */
      var stats = view.stats || statsOf(data);
      var layer = X.tapLayer(stats, pi);
      if (layer && layer !== 'cross') {
        var lidx = nextLayerItemFor(layer, pi);
        if (lidx >= 0) {
          // markLayerItem does its own feedback, re-sync and milestone check.
          markLayerItem(projectId, layer, lidx, true);
          return;
        }
      }
      /* Wave F (04 #15): the next stitch is in the block the stitcher is
         at (the crosshair), in reading order, then the nearest block with
         this colour left — not the next one along row 1. */
      var bitsNow = view.bits.bytes;
      var at = X.nextStitchNear(view.cells, view.w, view.h, pi, view.cx, view.cy, function (i) {
        return ((bitsNow[i >> 3] >> (i & 7)) & 1) === 1;
      });
      if (at < 0) {
        toast(paletteLabel(entry) + ' done ✓');
        fb('done');
        return;
      }
      X.setBit(view.bits, at, true);
      paintCell(at, 1);
      view.cursor = at + 1;
      view.tapHistory.push(at);
      if (view.tapHistory.length > 500) view.tapHistory.shift();
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
      recordWork(projectId, 1, pi, [at], true);
      if (data.parking.length) offerUnpark(projectId, cx, cy, pi);
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
      recordWork(projectId, 1, pi, null, true);
    }

    afterCount(projectId, pi, before, beforeByColor);
  }

  /* ---- wave K: every mark is recorded once (shell-data §5) --------------
     Sessions, pace and the mark log (time-lapse) fill themselves from
     Store.counted / Store.logMarks; the stitched preview and any listener
     (XStitchApp.onMarked, for xs-extras) hear about it from the same place.
     `cells` is the list of squares flipped (or null for a counts-mode tap or
     an extra layer); `n` the signed number of units moved. */
  var markListeners = [];

  function recordWork(projectId, n, pi, cells, on, unit) {
    if (!n) return;
    var d = view && view.projectId === projectId ? view.data : null;
    var e = d && pi >= 0 ? d.palette[pi] : null;
    if (typeof Store.counted === 'function') {
      try {
        var tot = d && view.stats ? oneTotal(d, view.stats) : null;
        Store.counted({ projectId: projectId, n: n, unit: unit || 'stitch',
          part: e ? ((e.brand ? e.brand + ' ' : '') + (e.code || e.name || '')).trim() || undefined : undefined,
          total: tot ? tot.total : undefined });
      } catch (err) { /* recording never breaks a mark */ }
    }
    if (cells && cells.length && typeof Store.logMarks === 'function') {
      try {
        var pairs = new Array(cells.length);
        for (var k = 0; k < cells.length; k++) pairs[k] = [cells[k], on ? 1 : 0];
        Store.logMarks(projectId, pairs);
      } catch (err2) { /* the time-lapse is a nicety */ }
    }
    if (cells && view && view.projectId === projectId) stitchedMarked(cells, on);
    for (var i = 0; i < markListeners.length; i++) {
      try {
        markListeners[i]({ projectId: projectId, n: n, cells: cells || null, on: !!on, colour: pi >= 0 ? pi : -1 });
      } catch (err3) { /* a listener's fault is its own */ }
    }
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
    var kind = finishedColour ? 'done' : (group > 0 && after.done > 0 && after.done % group === 0 ? 'group' : 'tap');

    syncScreen(p, data);

    if (finishedColour) {
      fb('done');
    } else if (typeof C.counted === 'function') {
      /* the shell's one policy (shell-ui §5): milestones only, every 50th
         when there is no grouping; finishing a colour is said by noteMilestones */
      C.counted({ n: after.done, total: after.total, unit: 'stitch', label: paletteLabel(entry),
        kind: 'tap', groupSize: 0, node: view && view.nodes ? view.nodes.stitchBtn : null,
        quiet: kind !== 'tap' });
      if (kind !== 'tap') fb(kind);
    } else {
      fb(kind);
      if (!finishedColour && after.total && after.done % 100 === 0) {
        C.announce(comma(after.done) + ' of ' + comma(after.total) + ' ' + (entry.name || entry.code));
      }
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

    var keyStat = hasChart(data) && data.progress.mode === 'cells' && view.stats ? view.stats.byColor[pi] : null;
    if (keyStat && keyStat.fromKey) {
      if (keyStat.done <= 0) { toast('Nothing to undo'); return; }
      Store.updateCraftData(projectId, function (cd) {
        if (!isObj(cd.progress.keyDone)) cd.progress.keyDone = {};
        cd.progress.keyDone[pi] = Math.max(0, clampInt(cd.progress.keyDone[pi], 0, 1e9, 0) - 1);
      });
      bumpStats(pi, -1);
      recordWork(projectId, -1, pi, null, false);
    } else if (hasChart(data) && data.progress.mode === 'cells') {
      var undoLayer = unmarkLayerFor(pi);
      if (undoLayer !== 'cross') {
        var lidx = lastLayerItemFor(undoLayer, pi);
        if (lidx >= 0) {
          markLayerItem(projectId, undoLayer, lidx, false);
          fb('undo');
          return;
        }
      }
      /* −1 takes back the stitch the button marked last, not whichever
         done stitch of this colour happens to be last in reading order. */
      var at = -1;
      while (view.tapHistory.length && at < 0) {
        var h = view.tapHistory.pop();
        if (view.cells[h] === pi && X.getBit(view.bits, h)) at = h;
      }
      if (at < 0) at = lastDoneCellFor(pi);
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
      recordWork(projectId, -1, pi, [at], false);
    } else {
      var st = (view.stats.byColor[pi] || { done: 0 });
      if (st.done <= 0) { toast('Nothing to undo'); return; }
      Store.updateCraftData(projectId, function (cd) {
        bumpPerColor(cd, pi, -1);
        cd.progress.doneCount = Math.max(0, (cd.progress.doneCount || 0) - 1);
      });
      bumpStats(pi, -1);
      recordWork(projectId, -1, pi, null, false);
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
        var cells = view.cells, gone = [];
        for (var i = 0; i < cells.length; i++) {
          if (cells[i] === pi && X.getBit(view.bits, i)) { X.setBit(view.bits, i, false); gone.push(i); }
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
          if (isObj(cd.progress.keyDone)) delete cd.progress.keyDone[pi];
        });
        view.doneKey = b64;
        view.img = null;
        view.stats = null;
        recordWork(projectId, -gone.length, pi, gone, false);
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
    /* Wave F (04 #2): the tool, the layer and the view come back as the
       stitcher left them. Unmark is deliberately not remembered: reopening a
       chart in erase mode would quietly undo the next tap. */
    var layers0 = availableLayers(data);
    var tool = TOOL_IDS[data.current.tool] ? data.current.tool : 'tap';
    var layer = 'cross';
    for (var li = 0; li < layers0.length; li++) if (layers0[li].id === data.current.layer) layer = data.current.layer;
    var erase = false;
    var chart = null;
    var viewTimer = null, pendingView;
    var findSeen = {};

    function flushView() {
      if (viewTimer) { window.clearTimeout(viewTimer); viewTimer = null; }
      if (pendingView === undefined) return;
      saveViewState(projectId, { view: pendingView });
      pendingView = undefined;
    }

    C.openSheet({
      title: 'Chart',
      cls: 'sheet-chart',
      build: function (body) {
        var layers = layers0;
        var hint = el('p', 'muted xs-hint');

        function setHint() {
          hint.textContent = (layer === 'cross'
            ? 'Drag to pan, pinch or use the buttons to zoom, double-tap to fit. 📄 shows the PDF page for this spot, 🎯 finds the nearest stitch of this colour still to do.'
            : 'Marking ' + LAYER_NOUNS[layer] + '. Tap one to mark it, or switch to Drag and sweep along them. ' +
              'Zoom in until the squares are big enough to see them.');
        }

        if (layers.length > 1) {
          var layerSeg = C.segmented(layers, layer, function (v) {
            layer = v;
            setHint();
            saveViewState(projectId, { layer: v });
            C.announce('Marking ' + LAYER_NOUNS[layer]);
          });
          layerSeg.node.classList.add('xs-layer-seg');
          body.appendChild(layerSeg.node);
        }

        var toolbar = el('div', 'xs-tools');
        var seg = C.segmented(TOOLS, tool, function (v) {
          tool = v;
          saveViewState(projectId, { tool: v });
        });
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
          onTap: function (c) { findSeen = {}; applyTool(projectId, tool, layer, c, !erase); },
          onViewChange: function (v) {
            pendingView = v ? { z: v.z, x: v.x, y: v.y } : null;
            if (viewTimer) window.clearTimeout(viewTimer);
            viewTimer = window.setTimeout(flushView, 300);
          }
        });
        body.appendChild(chart.node);

        var zoomRow = el('div', 'xs-zoom');
        var zOut = button('btn ghost', '−', 'Zoom out');
        var zFit = button('btn ghost', 'Fit');
        var zIn = button('btn ghost', '+', 'Zoom in');
        var zPage = button('btn ghost xs-see-page', '📄', 'See the PDF page for this spot');
        zPage.title = 'See the PDF page for this spot';
        var zNext = button('btn ghost xs-find-next', '🎯', 'Find the nearest stitch of this colour still to do');
        zNext.title = 'Nearest stitch of this colour still to do';
        on(zOut, 'click', function () { chart.zoomBy(1 / 1.4); });
        on(zFit, 'click', function () { chart.fit(); });
        on(zIn, 'click', function () { chart.zoomBy(1.4); });
        on(zPage, 'click', function () {
          var at = chartSpot(chart);
          openPageViewer(projectId, { x: at.x, y: at.y });
        });
        on(zNext, 'click', function () { findNextStitch(projectId, chart, findSeen); });
        zoomRow.appendChild(zOut);
        zoomRow.appendChild(zFit);
        zoomRow.appendChild(zIn);
        var proj0 = Store.project(projectId);
        if (proj0 && dataOf(proj0).pages.length) zoomRow.appendChild(zPage);
        zoomRow.appendChild(zNext);
        if (rowsAvailable(data)) {
          var zRows = button('btn ghost xs-find-next', '☰', 'Row by row');
          zRows.title = 'Row by row';
          on(zRows, 'click', function () { openRowsSheet(projectId); });
          zoomRow.appendChild(zRows);
        }
        body.appendChild(zoomRow);

        setHint();
        body.appendChild(hint);

        var saved = data.current.view;
        window.requestAnimationFrame(function () {
          if (!chart) return;
          if (saved) chart.setView(saved); else chart.fit();
        });
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
        flushView();
        if (chart) chart.destroy();
        chart = null;
      }
    });
  }

  var TOOL_IDS = { tap: 1, paint: 1, block: 1, page: 1 };

  /**
   * Write view details — the remembered zoom/pan, tool, layer, page, the
   * crosshair — into craftData.current WITHOUT an undo snapshot, through
   * Store.updateCraftData(id, fn, { undo: false }) (no snapshot, no updatedAt
   * bump, normal save path). A plain updateCraftData snapshots every call, so
   * a pan would flood the undo stack and Undo would start "undoing" zooms
   * instead of stitches. A view is not a piece of work (04 #2).
   */
  function saveViewState(projectId, patch) {
    var p = Store.project(projectId);
    if (!p || !isObj(p.craftData) || !isObj(p.craftData.current)) return false;
    var cur = p.craftData.current;
    var next = {};
    var changedAny = false;
    Object.keys(patch).forEach(function (k) {
      var v = patch[k];
      if (k === 'view' && v) {
        v = { z: Math.round(v.z * 1000) / 1000, x: Math.round(v.x * 100) / 100, y: Math.round(v.y * 100) / 100 };
      }
      if (JSON.stringify(cur[k]) === JSON.stringify(v)) return;
      next[k] = v;
      changedAny = true;
    });
    if (!changedAny) return false;
    Store.updateCraftData(projectId, function (cd) {
      if (!isObj(cd.current)) return;
      Object.keys(next).forEach(function (k) { cd.current[k] = next[k]; });
    }, { undo: false });
    return true;
  }

  /**
   * The stitch the chart is "at": the crosshair when it is on screen,
   * otherwise the stitch in the middle of the view.
   */
  function chartSpot(chart) {
    var st = chart.state, s = { w: st.cw, h: st.ch };
    var x = clampInt(view.cx, 0, Math.max(0, view.w - 1), 0);
    var y = clampInt(view.cy, 0, Math.max(0, view.h - 1), 0);
    var px = st.ox + (x + 0.5) * st.z, py = st.oy + (y + 0.5) * st.z;
    if (px >= 0 && py >= 0 && px <= s.w && py <= s.h) return { x: x, y: y };
    return chart.middleCell();
  }

  /**
   * 🎯 in the chart sheet: jump to the nearest stitch of the current colour
   * that is still to do (brainstorm 04 parking lot, "next stitch of this
   * colour"). Each press moves on to the next-nearest one it has not shown
   * yet, so two neighbours never ping-pong; a tap on the chart starts over.
   */
  function findNextStitch(projectId, chart, seen) {
    var p = Store.project(projectId);
    if (!p || !view || !view.cells) return;
    var data = dataOf(p);
    if (!data.palette.length) return;
    var pi = clampInt(data.current.paletteIndex, 0, data.palette.length - 1, 0);
    var entry = data.palette[pi];
    var bits = view.bits.bytes;
    function done(i) { return ((bits[i >> 3] >> (i & 7)) & 1) === 1; }
    var cx = clampInt(view.cx, 0, Math.max(0, view.w - 1), 0);
    var cy = clampInt(view.cy, 0, Math.max(0, view.h - 1), 0);
    var here = cy * view.w + cx;
    var at = X.nearestCellOf(view.cells, view.w, view.h, pi, cx, cy, function (i) {
      return done(i) || seen[i] || (i === here && view.cells[i] === pi && seen.started);
    });
    if (at < 0 && seen.started) {
      // every remaining stitch has been shown once: go round again
      Object.keys(seen).forEach(function (k) { delete seen[k]; });
      at = X.nearestCellOf(view.cells, view.w, view.h, pi, cx, cy, function (i) { return done(i) || i === here; });
      if (at < 0) at = X.nearestCellOf(view.cells, view.w, view.h, pi, cx, cy, done);
    }
    if (at < 0) {
      var any = false;
      for (var i = 0; i < view.cells.length; i++) if (view.cells[i] === pi) { any = true; break; }
      toast(any ? paletteLabel(entry) + ': every stitch is done ✓'
        : 'No ' + paletteLabel(entry) + ' stitches on this chart');
      fb(any ? 'done' : 'alert');
      return;
    }
    seen.started = true;
    seen[at] = true;
    var x = at % view.w, y = (at / view.w) | 0;
    setCrosshair(x, y);
    saveViewState(projectId, { cx: x, cy: y });
    chart.centerOn(x, y, 16);
    var lab = X.positionLabel(x, y, view.w, view.h);
    var left = view.stats && view.stats.byColor[pi] ? Math.max(0, view.stats.byColor[pi].total - view.stats.byColor[pi].done) : null;
    toast(paletteLabel(entry) + ' · ' + lab.grid + (left !== null ? ' · ' + comma(left) + ' left' : ''));
    C.announce(paletteLabel(entry) + ' at ' + lab.grid + ', ' + lab.centre);
    fb('tap');
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
    recordWork(projectId, delta, layerColours(layer, item)[0], null, !!value);
    if (view.stitched && view.stitched.handle && typeof view.stitched.handle.setLayerDone === 'function') {
      try { view.stitched.handle.setLayerDone(layer, idx, !!value); } catch (e) { /* ignore */ }
    }

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
    recordWork(projectId, total, -1, null, total > 0);
    if (view.stitched) view.stitched.dirty = true;
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
    recordWork(projectId, value ? 1 : -1, pi, [c.i], value);
    if (value && view.data && view.data.parking.length) offerUnpark(projectId, c.x, c.y, pi);
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
    var total = 0, flipped = [];
    /* 04 #13 (wave K, the owner's default): 10×10 means "this colour in this
       block", whether the colour is isolated or merely current — a parker who
       has done the black in a block has not done the other colours in it.
       The "Whole block" chip in the chart sheet marks every colour. */
    var only = -1;
    if ((view.isolate || blockScope !== 'all') && view.data && view.data.palette.length) {
      only = clampInt(view.data.current.paletteIndex, 0, view.data.palette.length - 1, 0);
    }
    for (var y = by; y < by + 10 && y < view.h; y++) {
      for (var x = bx; x < bx + 10 && x < view.w; x++) {
        var i = y * view.w + x;
        var pi = view.cells[i];
        if (pi < 0) continue;
        if (only >= 0 && pi !== only) continue;
        var was = (view.bits.bytes[i >> 3] >> (i & 7)) & 1;
        if (was === (value ? 1 : 0)) continue;
        X.setBit(view.bits, i, value);
        paintCell(i, value ? 1 : 0);
        changed[pi] = (changed[pi] || 0) + (value ? 1 : -1);
        total += value ? 1 : -1;
        flipped.push(i);
      }
    }
    var what = only >= 0 ? paletteLabel(view.data.palette[only]) + ' ' : '';
    if (!total) {
      toast(only >= 0 ? 'No ' + what + 'stitches left to ' + (value ? 'mark' : 'clear') + ' in that block'
        : 'That block is already ' + (value ? 'done' : 'clear'));
      return;
    }
    commitBulk(projectId, changed, total, c, beforeByColor, flipped, value, only);
    toast((value ? 'Marked ' : 'Cleared ') + Math.abs(total) + ' ' + what + 'stitches in this 10×10 block' +
      (only >= 0 ? ' (this colour only)' : ''));
  }

  /* 10×10 scope: 'colour' (the current colour, the default) or 'all' (every
     colour in the block). A view detail for this session, never undoable. */
  var blockScope = 'colour';

  function markWholeColour(projectId, layer, value) {
    if (layer && layer !== 'cross') { markLayerColour(projectId, layer, value); return; }
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    var pi = clampInt(data.current.paletteIndex, 0, Math.max(0, data.palette.length - 1), 0);
    /* #1: a whole-colour mark over XStitch.CONFIRM_ABOVE stitches asks first
       (21,207 Pokémon stitches in one tap was a silent disaster). */
    var plan = typeof X.bulkPlan === 'function' ? X.bulkPlan(data, { color: pi }, { unmark: !value }) : null;
    if (plan && plan.confirm) {
      C.confirmSheet({
        title: value ? 'Mark the whole colour?' : 'Unmark the whole colour?',
        message: plan.text + ' You can Undo it.',
        confirmText: value ? 'Mark ' + comma(plan.count) : 'Unmark ' + comma(plan.count),
        danger: !value
      }).then(function (ok) { if (ok) doWholeColour(projectId, pi, value); });
      return;
    }
    doWholeColour(projectId, pi, value);
  }

  function doWholeColour(projectId, pi, value) {
    var p = Store.project(projectId);
    if (!p || !view) return;
    var data = dataOf(p);
    var beforeByColor = snapshotByColor();
    var cells = view.cells;
    var changed = {};
    var total = 0, flipped = [];
    for (var i = 0; i < cells.length; i++) {
      if (cells[i] !== pi) continue;
      var was = (view.bits.bytes[i >> 3] >> (i & 7)) & 1;
      if (was === (value ? 1 : 0)) continue;
      X.setBit(view.bits, i, value);
      changed[pi] = (changed[pi] || 0) + (value ? 1 : -1);
      total += value ? 1 : -1;
      flipped.push(i);
    }
    if (!total) { toast('Nothing to change'); return; }
    view.img = null;
    commitBulk(projectId, changed, total, null, beforeByColor, flipped, value, pi);
    toast((value ? 'Marked ' : 'Cleared ') + comma(Math.abs(total)) + ' stitches of ' +
      paletteLabel(data.palette[pi]));
  }

  /** Mark (or unmark) a list of squares as one undo step (page, row, block). */
  function markCellList(projectId, list, value, colour, c) {
    if (!view || !view.bits) return 0;
    var beforeByColor = snapshotByColor();
    var changed = {}, total = 0, flipped = [];
    for (var k = 0; k < list.length; k++) {
      var i = list[k], pi = view.cells[i];
      if (pi < 0) continue;
      var was = (view.bits.bytes[i >> 3] >> (i & 7)) & 1;
      if (was === (value ? 1 : 0)) continue;
      X.setBit(view.bits, i, value);
      changed[pi] = (changed[pi] || 0) + (value ? 1 : -1);
      total += value ? 1 : -1;
      flipped.push(i);
    }
    if (!total) return 0;
    view.img = null;
    commitBulk(projectId, changed, total, c || null, beforeByColor, flipped, value, colour >= 0 ? colour : -1);
    return total;
  }

  function commitBulk(projectId, changed, total, c, beforeByColor, flipped, value, colour) {
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
    recordWork(projectId, total, typeof colour === 'number' ? colour : -1, flipped || null,
      value === undefined ? total > 0 : !!value);
    syncScreen(p, data);
    if (total > 0) noteMilestones(projectId, beforeByColor);
  }

  /* ---- Row by row (wave J): the chart as written instructions ---------- */

  /** Needs a grid and the key worker's written-rows functions in XStitch. */
  function rowsAvailable(data) {
    return !!(data && hasChart(data) && typeof X.writtenRows === 'function' &&
      typeof X.rowText === 'function' && typeof X.cellsOfRow === 'function' &&
      typeof X.rowDone === 'function');
  }

  /** The per-project Row by row options, with defaults. */
  function normRowOpts(v) {
    v = isObj(v) ? v : {};
    return {
      from: v.from === 'bottom' ? 'bottom' : 'top',
      dir: v.dir === 'serpentine' ? 'serpentine' : 'ltr',
      one: v.one === true,
      skipEmpty: v.skipEmpty !== false
    };
  }

  /** The project's own options (craftData.current.rowOpts, view state), else the defaults. */
  function rowOptsOf(data) {
    return normRowOpts(data && data.current && isObj(data.current.rowOpts) ? data.current.rowOpts : null);
  }

  /** XStitch.writtenRows options for these Row by row options. */
  function writtenOptsFor(ro, data) {
    var pi = data && data.palette.length
      ? clampInt(data.current.paletteIndex, 0, data.palette.length - 1, 0) : null;
    return { from: ro.from, dir: ro.dir, color: ro.one && pi !== null ? pi : null, skipEmpty: ro.skipEmpty };
  }

  function rowOptsLabel(ro, data) {
    var bits = [ro.from === 'bottom' ? 'From the bottom' : 'From the top',
      ro.dir === 'serpentine' ? 'back and forth' : 'every row left to right'];
    if (ro.one && data && data.palette.length) {
      bits.push('only ' + paletteLabel(data.palette[clampInt(data.current.paletteIndex, 0, data.palette.length - 1, 0)]));
    } else {
      bits.push('all colours');
    }
    if (ro.skipEmpty) bits.push('empty rows hidden');
    return bits.join(' · ');
  }

  /** The column of a row's first stitch (where the crosshair goes). */
  function firstStitchX(row) {
    var runs = row && row.runs ? row.runs : [];
    for (var i = 0; i < runs.length; i++) if (runs[i].p >= 0) return runs[i].x;
    return 0;
  }

  function stitchesWord(n) { return comma(n) + (n === 1 ? ' stitch' : ' stitches'); }

  /** Run chips: a swatch with the symbol, and the count; "skip n" muted. */
  function runChips(row, data, cap) {
    var wrap = el('span', 'xs-runs');
    wrap.setAttribute('aria-hidden', 'true');
    var runs = row.runs || [];
    var lim = cap && runs.length > cap ? cap : runs.length;
    for (var i = 0; i < lim; i++) {
      var r = runs[i];
      if (r.p < 0) {
        wrap.appendChild(el('span', 'xs-run xs-run-skip', 'skip ' + r.n));
        continue;
      }
      var e = data.palette[r.p] || {};
      var full = r.done !== undefined && r.done >= r.n, part = r.done !== undefined && r.done > 0 && !full;
      var chip = el('span', 'xs-run' + (full ? ' xs-run-done' : part ? ' xs-run-part' : ''));
      var sw = el('span', 'xs-run-sw', e.symbol || '');
      sw.style.background = swatchHex(e);
      sw.style.color = X.symbolInk(e.hex || '808080') === 'light' ? '#fff' : '#111';
      chip.appendChild(sw);
      /* #14: done stitches show inside the row: "✓5", or "3/5" part way */
      chip.appendChild(el('span', 'xs-run-n', full ? '✓' + r.n : part ? r.done + '/' + r.n : String(r.n)));
      wrap.appendChild(chip);
    }
    if (lim < runs.length) wrap.appendChild(el('span', 'xs-run xs-run-skip', '+' + (runs.length - lim) + ' more'));
    return wrap;
  }

  /* ---- #14 Row by row that fits a real chart ---------------------------- */

  /** The scope switch is offered when xs-core's writtenRows takes a scope
      and the chart is wide or has printed pages. */
  function rowsScopeAvailable(d) {
    return !!(X.WAVE_K && hasChart(d) && (d.chart.w > 40 || d.pages.some(function (pg) { return pg && pg.region; })));
  }

  /** writtenRows options for a scope: 'all' | 'page' | 'band' (around the crosshair). */
  function rowsOptsScoped(ro, d, scope) {
    var o = writtenOptsFor(ro, d);
    if (!X.WAVE_K) return o;
    o.done = true;
    if (d.chart.w > 40) o.chunk = 10;
    var cx = clampInt(d.current.cx, 0, Math.max(0, d.chart.w - 1), 0);
    var cy = clampInt(d.current.cy, 0, Math.max(0, d.chart.h - 1), 0);
    if (scope === 'page' && typeof X.pageForCell === 'function') {
      var pi = X.pageForCell(d.pages, cx, cy);
      if (pi >= 0) o.scope = { page: pi };
    } else if (scope === 'band') {
      o.xFrom = Math.floor(cx / 10) * 10;
      o.xTo = Math.min(d.chart.w - 1, o.xFrom + 9);
    }
    return o;
  }

  /** A row's done state from its runs (null when the runs carry no done counts). */
  function rowDoneByRuns(row) {
    var runs = row && row.runs;
    if (!runs || !runs.length || runs[0].done === undefined) return null;
    for (var i = 0; i < runs.length; i++) if (runs[i].p >= 0 && runs[i].done < runs[i].n) return false;
    return true;
  }

  /** The squares a written row covers (its runs, in its own band), or null. */
  function rowCellsByRuns(row, w) {
    var runs = row && row.runs;
    if (!runs || !runs.length || runs[0].done === undefined) return null;
    var out = [], base = row.y * w;
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
      if (r.p < 0) continue;
      for (var k = 0; k < r.n; k++) out.push(base + (row.rtl ? r.x - k : r.x + k));
    }
    return out;
  }

  function openRowsSheet(projectId) {
    var p0 = Store.project(projectId);
    if (!p0) return;
    var d0 = dataOf(p0);
    if (!rowsAvailable(d0)) {
      toast(hasChart(d0) ? 'Row by row is not available on this device yet'
        : 'Row by row needs a chart grid: import an .oxs file, read a chart picture or make one from a photo');
      return;
    }
    var ro = rowOptsOf(d0);
    var wr = null, focus = -1, lo = 0, hi = 0;
    var WINDOW = 30;
    var nd = {};
    /* #14: what part of the chart the rows cover — the whole chart, the
       printed page under the crosshair, or the 10-wide column band it is in
       (a session detail). Big rows are chunked at every 10 columns, and each
       run knows how many of its squares are done. */
    var scope = 'all';
    var scoped = rowsScopeAvailable(d0);

    function data() { return dataOf(Store.project(projectId)); }
    function wopts(d) { return rowsOptsScoped(ro, d, scope); }
    function live() { return !!(view && view.projectId === projectId && view.bits && view.cells); }

    function isDone(d, row) {
      if (!row || !row.stitches) return false;
      var byRuns = rowDoneByRuns(row);
      if (byRuns !== null) return byRuns;
      try { return !!X.rowDone(d, row.y, wopts(d)); } catch (e) { return false; }
    }

    function firstOpen(d) {
      for (var i = 0; i < wr.rows.length; i++) {
        if (wr.rows[i].stitches > 0 && !isDone(d, wr.rows[i])) return i;
      }
      return wr.rows.length ? wr.rows.length - 1 : -1;
    }

    function recompute(keepY) {
      var d = data();
      try { wr = X.writtenRows(d, wopts(d)); } catch (e) { wr = null; }
      if (!wr || !Array.isArray(wr.rows)) wr = { w: d.chart.w, h: d.chart.h, rows: [], totals: { rows: 0, stitches: 0, emptyRows: 0 } };
      var idx = -1;
      if (keepY !== null && keepY !== undefined) {
        for (var i = 0; i < wr.rows.length; i++) if (wr.rows[i].y === keepY) { idx = i; break; }
      }
      focus = idx >= 0 ? idx : firstOpen(d);
      placeWindow();
    }

    function placeWindow() {
      var f = Math.max(0, focus);
      if (f < lo || f >= hi || hi === 0) {
        lo = Math.max(0, f - 8);
        hi = Math.min(wr.rows.length, lo + WINDOW);
      }
    }

    function saveOpts() {
      saveViewState(projectId, { rowOpts: { from: ro.from, dir: ro.dir, one: ro.one, skipEmpty: ro.skipEmpty } });
    }

    function render() {
      var d = data();
      renderNow(d);
      renderColours(d);
      if (C.preserveFocus) C.preserveFocus(function () { renderList(d); });
      else renderList(d);
      nd.optsSummary.textContent = rowOptsLabel(ro, d);
      if (nd.scopeNote) {
        var sc = wr && wr.scope;
        nd.scopeNote.textContent = sc ? 'Columns ' + (sc.x0 + 1) + '–' + (sc.x1 + 1) + ', rows ' + (sc.y0 + 1) + '–' + (sc.y1 + 1) +
          (sc.label ? ' (' + sc.label + ')' : '') + '.'
          : (scope === 'band' ? (function () { var o2 = wopts(d); return 'Columns ' + (o2.xFrom + 1) + '–' + (o2.xTo + 1) + '.'; })()
            : (scope === 'page' ? 'The crosshair is not on a printed page; showing the whole chart.' : ''));
        nd.scopeNote.hidden = !nd.scopeNote.textContent;
      }
    }

    function renderNow(d) {
      clear(nd.now);
      var row = focus >= 0 ? wr.rows[focus] : null;
      if (!row) {
        nd.now.appendChild(el('p', 'muted', ro.one
          ? 'This colour has no stitches on the chart.'
          : 'There are no stitches on this chart.'));
        nd.done.hidden = true;
        nd.nav.hidden = true;
        return;
      }
      nd.done.hidden = false;
      nd.nav.hidden = false;
      var done = isDone(d, row);
      var head = el('div', 'xs-row-now-head');
      head.appendChild(el('span', 'xs-row-now-n', 'Row ' + row.n));
      head.appendChild(el('span', 'xs-row-now-sub', 'of ' + (wr.h || d.chart.h) + ' · ' +
        (row.rtl ? 'right to left ←' : 'left to right →') + ' · ' + stitchesWord(row.stitches)));
      nd.now.appendChild(head);
      var chips = runChips(row, d, 0);
      chips.classList.add('xs-runs-big');
      nd.now.appendChild(chips);
      var txt = '';
      try { txt = X.rowText(row, d, { names: 'code' }); } catch (e) { txt = ''; }
      var sr = el('p', 'sr-only', txt);
      nd.now.appendChild(sr);
      if (nd.now.parentNode) nd.now.parentNode.classList.toggle('done', done);

      nd.done.textContent = done ? '✓ Row ' + row.n + ' is done · tap to unmark' : 'Row ' + row.n + ' done';
      nd.done.setAttribute('aria-pressed', done ? 'true' : 'false');
      nd.done.classList.toggle('primary', !done);
      nd.done.classList.toggle('is-done', done);
      nd.next.classList.toggle('primary', done);
      nd.prev.disabled = focus <= 0;
      nd.next.disabled = focus >= wr.rows.length - 1;
      nd.done.disabled = !row.stitches;
    }

    function renderColours(d) {
      clear(nd.colours);
      nd.colours.hidden = !ro.one;
      if (!ro.one) return;
      var cur = clampInt(d.current.paletteIndex, 0, Math.max(0, d.palette.length - 1), 0);
      d.palette.forEach(function (e, i) {
        var b = button('xs-row-col' + (i === cur ? ' on' : ''), null, 'Only ' + paletteLabel(e));
        b.setAttribute('aria-pressed', i === cur ? 'true' : 'false');
        b.setAttribute('data-focus-key', 'rowcol-' + i);
        var sw = el('span', 'xs-swatch xs-swatch-sm', e.symbol || '');
        sw.style.background = swatchHex(e);
        sw.style.color = X.symbolInk(e.hex) === 'light' ? '#fff' : '#111';
        b.appendChild(sw);
        b.appendChild(el('span', 'xs-row-col-code', e.code));
        on(b, 'click', function () {
          if (live()) setCurrentColour(projectId, i);
          else Store.updateCraftData(projectId, function (cd) { cd.current.paletteIndex = i; }, { undo: false });
          recompute(null);
          render();
        });
        nd.colours.appendChild(b);
      });
    }

    function renderList(d) {
      clear(nd.list);
      if (!wr.rows.length) return;
      if (lo > 0) {
        var earlier = button('btn ghost block xs-row-more', 'Show earlier rows');
        earlier.setAttribute('data-focus-key', 'row-earlier');
        on(earlier, 'click', function () { lo = Math.max(0, lo - WINDOW); renderList(data()); });
        nd.list.appendChild(earlier);
      }
      for (var i = lo; i < hi; i++) nd.list.appendChild(rowItem(d, i));
      if (hi < wr.rows.length) {
        var later = button('btn ghost block xs-row-more', 'Show more rows');
        later.setAttribute('data-focus-key', 'row-later');
        on(later, 'click', function () { hi = Math.min(wr.rows.length, hi + WINDOW); renderList(data()); });
        nd.list.appendChild(later);
      }
    }

    function rowItem(d, i) {
      var row = wr.rows[i];
      var done = isDone(d, row);
      var b = button('xs-row-item' + (i === focus ? ' current' : '') + (done ? ' done' : ''));
      b.setAttribute('data-focus-key', 'row-' + row.y);
      var txt = '';
      try { txt = X.rowText(row, d, { names: 'code+name' }); } catch (e) { txt = 'Row ' + row.n; }
      b.setAttribute('aria-label', txt + '.' + (done ? ' Done.' : '') + (i === focus ? ' Current row.' : ''));
      if (i === focus) b.setAttribute('aria-current', 'step');
      var head = el('span', 'xs-row-item-head');
      head.appendChild(el('span', 'xs-row-item-n', 'Row ' + row.n + ' ' + (row.rtl ? '←' : '→')));
      head.appendChild(el('span', 'xs-row-item-sub', row.stitches ? stitchesWord(row.stitches) : 'empty'));
      if (done) head.appendChild(el('span', 'xs-key-tick', '✓'));
      b.appendChild(head);
      b.appendChild(runChips(row, d, 40));
      on(b, 'click', function () { setFocus(i); });
      return b;
    }

    /* The list scrolls on its own, so bringing the current row into view
       never pushes the row card or the options off the sheet. */
    function scrollListTo(item) {
      if (!item || !nd.list) return;
      var top = item.offsetParent === nd.list ? item.offsetTop : item.offsetTop - nd.list.offsetTop;
      var bottom = top + item.offsetHeight;
      if (top < nd.list.scrollTop) nd.list.scrollTop = Math.max(0, top - 4);
      else if (bottom > nd.list.scrollTop + nd.list.clientHeight) nd.list.scrollTop = bottom - nd.list.clientHeight + 4;
    }

    /** Focus a row: the current row card, and the chart's crosshair on it. */
    function setFocus(i) {
      if (i < 0 || i >= wr.rows.length) return;
      focus = i;
      placeWindow();
      var row = wr.rows[i];
      var x = firstStitchX(row);
      if (live()) setCrosshair(x, row.y);
      saveViewState(projectId, { cx: x, cy: row.y });
      render();
      var cur = nd.list.querySelector('.xs-row-item.current');
      scrollListTo(cur);
    }

    /** Row done (one undo step), or un-done when the row already is. */
    function toggleRow() {
      var d = data();
      var row = focus >= 0 ? wr.rows[focus] : null;
      if (!row) return;
      if (!live()) { toast('Open the project to mark rows'); return; }
      var o = wopts(d);
      var value = !isDone(d, row);
      var cells = rowCellsByRuns(row, d.chart.w);
      if (!cells) {
        try { cells = X.cellsOfRow(d, row.y, o) || []; } catch (e) { cells = []; }
      }
      var before = snapshotByColor();
      var changed = {};
      var total = 0;
      for (var k = 0; k < cells.length; k++) {
        var idx = cells[k];
        var pi = view.cells[idx];
        if (pi === undefined || pi < 0) continue;
        var was = (view.bits.bytes[idx >> 3] >> (idx & 7)) & 1;
        if (was === (value ? 1 : 0)) continue;
        X.setBit(view.bits, idx, value);
        changed[pi] = (changed[pi] || 0) + (value ? 1 : -1);
        total += value ? 1 : -1;
      }
      if (!total) { toast(value ? 'That row is already done' : 'Nothing to unmark in that row'); return; }
      view.img = null;                 // a whole row: rebuild the picture once
      var flippedRow = [];
      for (var q = 0; q < cells.length; q++) {
        if (view.cells[cells[q]] >= 0 && ((view.bits.bytes[cells[q] >> 3] >> (cells[q] & 7)) & 1) === (value ? 1 : 0)) flippedRow.push(cells[q]);
      }
      commitBulk(projectId, changed, total, { x: firstStitchX(row), y: row.y }, before, flippedRow, value,
        ro.one ? clampInt(d.current.paletteIndex, 0, Math.max(0, d.palette.length - 1), 0) : -1);
      recompute(row.y);
      C.announce(value ? 'Row ' + row.n + ' done' : 'Row ' + row.n + ' unmarked');
      render();
    }

    function copyRows(oneColour) {
      var d = data();
      var o = wopts(d);
      delete o.chunk;
      if (!oneColour) o.color = null;
      else o.color = clampInt(d.current.paletteIndex, 0, Math.max(0, d.palette.length - 1), 0);
      var all;
      try { all = X.writtenRows(d, o); } catch (e) { all = null; }
      if (!all || !all.rows) { toast('Those rows could not be written out'); return; }
      var p = Store.project(projectId);
      var lines = [];
      lines.push(((p && p.name) || d.design.title || 'Chart') + ' — ' + d.chart.w + ' × ' + d.chart.h + ' stitches');
      lines.push('Rows counted from the ' + (o.from === 'bottom' ? 'bottom' : 'top') + ', ' +
        (o.dir === 'serpentine' ? 'worked back and forth' : 'every row left to right') +
        (o.color !== null ? ', only ' + paletteLabel(d.palette[o.color]) : '') + '.');
      lines.push('');
      all.rows.forEach(function (r) {
        try { lines.push(X.rowText(r, d, { names: 'code+name' })); } catch (e) { /* skip */ }
      });
      var text = lines.join('\n');
      fallbackCopy(text, function () { toast('Copied ' + plural(all.rows.length, 'row') + ' as text'); });
    }

    function optionsChanged() {
      saveOpts();
      var keepY = focus >= 0 && wr.rows[focus] ? wr.rows[focus].y : null;
      lo = 0; hi = 0;
      recompute(keepY);
      render();
    }

    recompute(null);

    C.openSheet({
      title: 'Row by row',
      cls: 'sheet-xs-rows',
      build: function (body) {
        var opts = el('details', 'xs-advanced xs-row-opts');
        var sum = el('summary');
        sum.appendChild(el('span', null, 'Options'));
        nd.optsSummary = el('span', 'muted xs-row-opts-sum', '');
        sum.appendChild(nd.optsSummary);
        opts.appendChild(sum);
        var fromSeg = C.segmented([{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }], ro.from,
          function (v) { ro.from = v; optionsChanged(); });
        opts.appendChild(field('Start from', fromSeg.node, 'Row 1 is the top row, or the bottom one.'));
        var dirSeg = C.segmented([{ id: 'ltr', label: 'Left to right' }, { id: 'serpentine', label: 'Back and forth' }],
          ro.dir, function (v) { ro.dir = v; optionsChanged(); });
        opts.appendChild(field('Direction', dirSeg.node, 'Back and forth turns at the end of every row.'));
        var oneSeg = C.segmented([{ id: 'all', label: 'All colours' }, { id: 'one', label: 'One at a time' }],
          ro.one ? 'one' : 'all', function (v) { ro.one = v === 'one'; optionsChanged(); });
        opts.appendChild(field('Colours', oneSeg.node, 'One at a time lists just the colour you pick below.'));
        opts.appendChild(C.switchRow('Hide empty rows', 'Rows with nothing to stitch are left out.',
          ro.skipEmpty, function (v) { ro.skipEmpty = v; optionsChanged(); }));
        body.appendChild(opts);

        if (scoped) {
          var dS = data();
          var scopes = [{ id: 'all', label: 'Whole chart' }];
          if (dS.pages.some(function (pg) { return pg && pg.region; })) scopes.push({ id: 'page', label: 'This page' });
          if (dS.chart.w > 40) scopes.push({ id: 'band', label: '10 wide' });
          var scSeg = C.segmented(scopes, scope, function (v) { scope = v; lo = 0; hi = 0; recompute(null); render(); });
          scSeg.node.classList.add('xs-row-scope');
          body.appendChild(field('Rows across', scSeg.node,
            'This page: the printed page under the crosshair. 10 wide: the band of 10 columns the crosshair is in.'));
          nd.scopeNote = el('p', 'muted xs-read-note', '');
          body.appendChild(nd.scopeNote);
        }

        nd.colours = el('div', 'xs-row-cols');
        nd.colours.setAttribute('role', 'group');
        nd.colours.setAttribute('aria-label', 'Which colour');
        body.appendChild(nd.colours);

        var nowCard = el('section', 'xs-row-now');
        nowCard.setAttribute('aria-label', 'The row you are on');
        nd.now = el('div', 'xs-row-now-body');
        nowCard.appendChild(nd.now);
        nd.done = button('btn primary block xs-row-done', 'Row done');
        on(nd.done, 'click', toggleRow);
        nowCard.appendChild(nd.done);
        nd.nav = el('div', 'xs-row-nav');
        nd.prev = button('btn ghost', '‹ Previous', 'Previous row');
        nd.next = button('btn ghost', 'Next ›', 'Next row');
        on(nd.prev, 'click', function () { setFocus(focus - 1); });
        on(nd.next, 'click', function () { setFocus(focus + 1); });
        nd.nav.appendChild(nd.prev);
        nd.nav.appendChild(nd.next);
        nowCard.appendChild(nd.nav);
        body.appendChild(nowCard);

        var copyRow = el('div', 'xs-row-copy');
        var copyAll = button('btn ghost', 'Copy all rows', 'Copy every row as text');
        on(copyAll, 'click', function () { copyRows(false); });
        copyRow.appendChild(copyAll);
        var copyOne = button('btn ghost', 'Copy this colour', 'Copy the rows of the current colour as text');
        on(copyOne, 'click', function () { copyRows(true); });
        copyRow.appendChild(copyOne);
        body.appendChild(copyRow);

        nd.list = el('div', 'xs-row-list');
        nd.list.setAttribute('aria-label', 'Rows');
        body.appendChild(nd.list);
        body.appendChild(el('p', 'muted xs-read-note',
          'Tap a row to put the chart’s crosshair on it. Row done marks every stitch of that row ' +
          'on the chart (only the chosen colour when you work one at a time), and Undo takes it back.'));

        render();
        window.requestAnimationFrame(function () {
          var cur = nd.list.querySelector('.xs-row-item.current');
          scrollListTo(cur);
        });
      },
      footer: [
        {
          text: 'Undo',
          cls: 'btn ghost',
          onClick: function () {
            if (!Store.undo()) { toast('Nothing to undo'); return; }
            fb('undo');
            var p2 = Store.project(projectId);
            if (p2 && view && view.projectId === projectId) {
              var d2 = dataOf(p2);
              view.img = null;
              view.stats = null;
              syncModel(d2);
              syncScreen(p2, d2);
            }
            C.render();
            var keepY = focus >= 0 && wr.rows[focus] ? wr.rows[focus].y : null;
            recompute(keepY);
            render();
            toast('Undone');
          }
        },
        { text: 'Done', cls: 'btn primary', onClick: function (api) { api.close(); } }
      ]
    });
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
        var stats = statsOf(data);

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
          var kindNow = typeof X.kindOf === 'function' ? X.kindOf(data) : 'cross';
          if (kindNow !== 'cross' && typeof X.materials === 'function') {
            /* #20: drills, yarn, thread or beads in the kind's own terms (≈) */
            var mt = X.materials(data, i);
            sub.push(mt.text || '');
          } else {
            if (count) sub.push(comma(count) + (count === 1 ? ' st' : ' sts') + (st.fromKey ? ' (from the key)' : ''));
            /* #1: a range that informs: "56–125 skeins (buy 72)" (≈, a midpoint to act on) */
            if (typeof X.skeinPlan === 'function') {
              var sp = X.skeinPlan({ stitchCount: count, count: data.fabric.count, over: data.fabric.over,
                strands: e.strands || data.strandsDefault });
              totals.mid = (totals.mid || 0) + Math.max(sp.mid || 0, e.skeins || 0);
              sub.push('≈ ' + (e.skeins && e.skeins > sp.high ? plural(e.skeins, 'skein') + ' (from the key)' : sp.text));
            } else {
              sub.push(range.low === range.high
                ? plural(range.high, 'skein')
                : range.low + '–' + range.high + ' skeins');
            }
            sub.push((e.strands || data.strandsDefault) + ' strands');
          }
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
            : (totals.low + '–' + totals.high + ' skeins')) +
          (totals.mid && totals.low !== totals.high ? ' (buy ≈ ' + totals.mid + ')' : '') + ' in all. ' +
          'Estimates assume ' + X.lengthPerStitchCm(data.fabric.count, data.fabric.over) +
          ' cm per stitch at ' + Math.round(data.fabric.count / data.fabric.over) +
          ' ct and 20% waste, so treat them as a range.');
        body.appendChild(summary);
        body.appendChild(list);

        var shop = button('btn block', '🛒 Shopping list');
        on(shop, 'click', function () { copyShoppingList(projectId); });
        body.appendChild(shop);

        /* #1: "Re-letter symbols", opt-in, for a project whose symbols repeat a
           shape family (projects imported before wave K keep theirs until asked). */
        var why = reletterReason(data);
        if (why) {
            var rl = button('btn ghost block xs-reletter', 'Re-letter symbols');
            on(rl, 'click', function () { reletterSymbols(projectId); });
            body.appendChild(rl);
            body.appendChild(el('p', 'muted xs-reletter-why', why));
        }

        body.appendChild(el('p', 'muted xs-disclaimer',
          'Screen colours are approximate — always check against a real shade card. ' +
          'DMC numbers and names are used only to identify threads.'));
      },
      footer: [{ text: 'Close', cls: 'btn primary', onClick: function (api) { api.close(); } }]
    });
  }

  /** Why this palette would read better re-lettered, or null when it is fine. */
  function reletterReason(data) {
    if (!data || data.palette.length < 2 || typeof X.symbolCheck !== 'function') return null;
    var chk = null;
    try { chk = X.symbolCheck(data.palette); } catch (e) { chk = null; }
    if (!chk || chk.ok) return null;
    var rep = (chk.repeats || []).length, fam = (chk.sameFamily || []).length;
    return (rep ? plural(rep, 'pair') + ' of colours share a symbol' : plural(fam, 'pair') + ' of colours have look-alike symbols') +
      '. Re-lettering gives each colour a symbol from a different shape family; your paper chart’s symbols do not change, and you can Undo it.';
  }

  /** One undo step: every colour gets a distinct symbol ("?" stays on a colour still to choose). */
  function reletterSymbols(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    C.confirmSheet({
      title: 'Re-letter the symbols?',
      message: 'The app’s symbols for this chart change so no two colours look alike. The pattern’s own symbols, where they were read, are not touched. You can Undo it.',
      confirmText: 'Re-letter',
      cancelText: 'Keep them'
    }).then(function (ok) {
      if (!ok) return;
      Store.updateCraftData(projectId, function (cd) { letterPalette(cd.palette); });
      forgetCaches();
      C.closeAllSheets();
      C.render();
      toast('Symbols re-lettered · Undo from the bar');
    });
  }

  function copyShoppingList(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    var stats = statsOf(data);
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

        /* #20: the same chart engine for neighbouring grid crafts; only the
           words, the material maths and this sheet change */
        if (X.KINDS && typeof X.kindOf === 'function') {
          draft.craftKind = X.kindOf(data);
          var kinds = Object.keys(X.KINDS).map(function (k) { return { id: k, label: X.KINDS[k].label }; });
          var kindSel = document.createElement('select');
          kindSel.className = 'input xs-kind-select';
          kinds.forEach(function (k) {
            var op = document.createElement('option');
            op.value = k.id; op.textContent = k.label;
            if (k.id === draft.craftKind) op.selected = true;
            kindSel.appendChild(op);
          });
          on(kindSel, 'change', function () { draft.craftKind = kindSel.value; });
          body.insertBefore(field('What are you making?', kindSel,
            'Diamond painting counts drills in packs, needlepoint yarn by mesh, filet crochet meshes, fuse beads by the bead.'),
            body.firstChild);
        }

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
              if (draft.craftKind) {
                if (draft.craftKind === 'cross') delete cd.kind; else cd.kind = draft.craftKind;
              }
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
          'Chart images are saved with the project on this device, and Back up now includes them. ' +
          'Tap a page to open it full screen.' +
          (data.pages.length >= MAX_PAGES
            ? ' Only the first ' + MAX_PAGES + ' pages of a chart are saved.' : '')));

        var grid = el('div', 'xs-page-grid');
        data.pages.forEach(function (page, i) {
          var cell = button('xs-page-thumb', null, 'Open ' + page.label);
          var imgWrap = el('span', 'xs-thumb-img');
          cell.appendChild(imgWrap);
          var label = el('span', 'xs-thumb-label', page.label);
          cell.appendChild(label);
          if (page.region) cell.appendChild(el('span', 'xs-thumb-region', regionText(page.region)));
          var doneMark = el('span', 'xs-thumb-done', '✓');
          doneMark.hidden = !isPageDone(data, i);
          cell.appendChild(doneMark);
          /* Wave F: a thumbnail opens the page full screen (pinch, pan, ‹ ›),
             in chart mode as well, where it used to change a strip that is
             not on screen and so appeared to do nothing. */
          on(cell, 'click', function () {
            openPageViewer(projectId, { page: i });
          });
          var tick = button('btn ghost xs-thumb-tick', isPageDone(data, i) ? 'Done ✓' : 'Mark done');
          on(tick, 'click', function () {
            var next = !isPageDone(dataOf(Store.project(projectId)), i);
            markPageDone(projectId, i, next, function (now) {
              tick.textContent = now ? 'Done ✓' : 'Mark done';
              doneMark.hidden = !now;
            });
          });
          var box = el('div', 'xs-page-box');
          box.appendChild(cell);
          box.appendChild(tick);
          grid.appendChild(box);

          /* xs-audit: a page with a stitch range but no page picture (an OXS
             chart, a joined file) shows its part of the chart, not an empty box */
          function regionThumb() {
            if (!page.region || !view || view.projectId !== projectId || !view.imgCanvas) {
              imgWrap.appendChild(el('span', 'muted xs-thumb-none', 'No page picture'));
              return;
            }
            var r = page.region, k = Math.max(1, Math.min(150 / r.w, 110 / r.h));
            var cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(r.w * k)); cv.height = Math.max(1, Math.round(r.h * k));
            cv.className = 'xs-thumb-chart';
            cv.setAttribute('aria-hidden', 'true');
            var g = cv.getContext('2d');
            if (g) { g.imageSmoothingEnabled = false; g.drawImage(view.imgCanvas, r.x, r.y, r.w, r.h, 0, 0, cv.width, cv.height); }
            imgWrap.appendChild(cv);
          }
          if (!window.BlobStore || !page.blobKey) regionThumb();
          if (window.BlobStore && page.blobKey) {
            window.BlobStore.get(page.blobKey).then(function (blob) {
              if (!blob) { regionThumb(); return; }
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

  function setPageFlag(cd, i, next) {
    var list = cd.progress.pageDone;
    for (var k = 0; k < list.length; k++) {
      if (list[k].page === i) { list[k].done = next; return; }
    }
    list.push({ page: i, done: next });
  }

  /**
   * #4 "Mark page done" that really marks the page: on a chart whose pages
   * know their stitch range, it asks, then marks the page's stitches and the
   * flag in one undo step, so page progress and stitch progress agree. An
   * image-only project (no chart) keeps the flag alone. Un-marking a page
   * clears the flag and leaves the stitches as they are (said so).
   */
  function markPageDone(projectId, i, next, after) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    var pg = data.pages[i];
    var cellsMode = hasChart(data) && data.progress.mode === 'cells' && pg && pg.region &&
      typeof X.bulkPlan === 'function' && view && view.projectId === projectId && view.bits;
    function flagOnly() {
      Store.updateCraftData(projectId, function (cd) { setPageFlag(cd, i, next); });
      fb(next ? 'done' : 'undo');
      if (after) after(next);
      C.render();
    }
    if (!next || !cellsMode) {
      flagOnly();
      if (!next && cellsMode) toast('Page unticked · its stitches stay marked');
      return;
    }
    var plan = X.bulkPlan(data, { page: i });
    if (!plan.count) { flagOnly(); return; }
    C.confirmSheet({
      title: 'Mark ' + (pg.label || 'this page') + ' done?',
      message: plan.text + ' You can Undo it.',
      confirmText: 'Mark ' + comma(plan.count),
      cancelText: 'Cancel'
    }).then(function (ok) {
      if (!ok) return;
      var list = Array.prototype.slice.call(plan.cells);
      markCellList(projectId, list, true, -1, null);
      /* the flag rides in a second write; Undo takes back both */
      Store.updateCraftData(projectId, function (cd) { setPageFlag(cd, i, true); }, { undo: false });
      fb('done');
      toast('Marked ' + comma(plan.count) + ' stitches · ' + (pg.label || 'page') + ' done ✓');
      if (after) after(true);
      C.render();
    });
  }

  /** 'cols 54–106 · rows 1–77' for a page's chart region. */
  function regionText(r) {
    return 'cols ' + (r.x + 1) + '–' + (r.x + r.w) + ' · rows ' + (r.y + 1) + '–' + (r.y + r.h);
  }

  /** The page to open by default: the current one, else the first chart page. */
  function defaultPageIndex(data) {
    var pages = data.pages;
    if (!pages.length) return -1;
    var cur = clampInt(data.current.page, 0, pages.length - 1, 0);
    if (pages[cur] && pages[cur].isChart) return cur;
    for (var i = 0; i < pages.length; i++) if (pages[i].isChart) return i;
    return cur;
  }

  /* ---- the full-screen page viewer (wave F, 04 #3 and #14) ------------ */

  /**
   * One rendered PDF page, full screen: pinch / drag / wheel to zoom and pan,
   * double-tap to switch between Fit and close-up, ‹ › between pages, and
   * "Mark page done". Opened from the chart (📄, `focus = { x, y }`: the page
   * that printed that stitch, zoomed in on it with the stitch outlined), from
   * a Pages thumbnail (`focus = { page }`) and from the image-mode strip.
   */
  function openPageViewer(projectId, focus) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    var pages = data.pages;
    if (!pages.length) { toast('This project has no PDF pages. Import the PDF to keep them.'); return; }
    focus = focus || {};
    var cell = (typeof focus.x === 'number' && typeof focus.y === 'number') ? { x: focus.x, y: focus.y } : null;
    var idx = -1, linked = false;
    if (typeof focus.page === 'number') idx = clampInt(focus.page, 0, pages.length - 1, 0);
    else if (cell) {
      idx = X.pageForCell(pages, cell.x, cell.y);
      linked = idx >= 0;
    }
    if (idx < 0) idx = defaultPageIndex(data);
    var firstIdx = idx;

    var url = null;
    var st = { s: 1, tx: 0, ty: 0, iw: 0, ih: 0, fitS: 1 };
    var pointers = {}, pinch = null, lastTap = 0, loadToken = 0;
    var frame, stage, img, mark, label, prev, next, doneBtn, note, empty;

    function frameSize() {
      var r = frame.getBoundingClientRect();
      return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    }
    function apply() {
      stage.style.transform = 'translate(' + st.tx + 'px,' + st.ty + 'px) scale(' + st.s + ')';
      if (!mark.hidden) mark.style.borderWidth = Math.max(1, 2.5 / st.s) + 'px';
    }
    function clamp() {
      var f = frameSize();
      var w = st.iw * st.s, h = st.ih * st.s;
      st.tx = w <= f.w ? (f.w - w) / 2 : Math.min(0, Math.max(f.w - w, st.tx));
      st.ty = h <= f.h ? (f.h - h) / 2 : Math.min(0, Math.max(f.h - h, st.ty));
    }
    function fitPage() {
      if (!st.iw) return;
      var f = frameSize();
      st.fitS = Math.min(f.w / st.iw, f.h / st.ih);
      st.s = st.fitS;
      clamp();
      apply();
    }
    function zoomAt(factor, mx, my) {
      var px = (mx - st.tx) / st.s, py = (my - st.ty) / st.s;
      st.s = Math.max(st.fitS, Math.min(st.fitS * 12, st.s * factor));
      st.tx = mx - px * st.s;
      st.ty = my - py * st.s;
      clamp();
      apply();
    }
    /* Centre image point (ix, iy) at scale s. */
    function lookAt(ix, iy, s) {
      var f = frameSize();
      st.s = Math.max(st.fitS, Math.min(st.fitS * 12, s));
      st.tx = f.w / 2 - ix * st.s;
      st.ty = f.h / 2 - iy * st.s;
      clamp();
      apply();
    }

    /* Where `cell` sits on page `i`, in image px, or null. */
    function cellBox(i) {
      var r = pages[i] && pages[i].region;
      if (!cell || !r || r.fx === null || !st.iw) return null;
      if (cell.x < r.x || cell.y < r.y || cell.x >= r.x + r.w || cell.y >= r.y + r.h) return null;
      var cw = r.fw / r.w * st.iw, ch = r.fh / r.h * st.ih;
      return { x: (r.fx * st.iw) + (cell.x - r.x) * cw, y: (r.fy * st.ih) + (cell.y - r.y) * ch, w: cw, h: ch };
    }

    function describe(i) {
      var r = pages[i].region;
      var bits = [];
      if (cell && r && cell.x >= r.x && cell.y >= r.y && cell.x < r.x + r.w && cell.y < r.y + r.h) {
        bits.push(X.positionLabel(cell.x, cell.y, view && view.w ? view.w : r.x + r.w, view && view.h ? view.h : r.y + r.h).grid +
          ' is on this page' + (r.fx !== null ? ', outlined' : '') + '.');
      }
      if (cell && linked && r && !(cell.x >= r.x && cell.y >= r.y && cell.x < r.x + r.w && cell.y < r.y + r.h) &&
          i === firstIdx) {
        /* the page that printed it was past the MAX_PAGES cap, so it is not
           on this device; this is the nearest one that is */
        bits.push(X.positionLabel(cell.x, cell.y, view && view.w ? view.w : 1, view && view.h ? view.h : 1).grid +
          ' is on a page that was not kept on this device (only the first ' + MAX_PAGES +
          ' pages of a PDF are saved). This is the nearest page that was.');
      }
      if (r) bits.push('This page prints ' + regionText(r) + '.');
      else if (cell && !linked) {
        bits.push('This import does not record which page holds which stitches. Re-import the PDF ' +
          'and read the grid to link them, or find the spot with ‹ ›.');
      }
      return bits.join(' ');
    }

    function show(i) {
      idx = clampInt(i, 0, pages.length - 1, 0);
      var page = pages[idx];
      var d = dataOf(Store.project(projectId) || p);
      label.textContent = page.label + ' · ' + (idx + 1) + ' of ' + pages.length;
      prev.disabled = idx <= 0;
      next.disabled = idx >= pages.length - 1;
      doneBtn.textContent = isPageDone(d, idx) ? 'Page done ✓' : 'Mark page done';
      doneBtn.setAttribute('aria-pressed', isPageDone(d, idx) ? 'true' : 'false');
      note.textContent = describe(idx);
      saveViewState(projectId, { page: idx });
      mark.hidden = true;
      img.hidden = true;
      empty.hidden = true;
      var token = ++loadToken;
      if (!window.BlobStore || !page.blobKey) { empty.hidden = false; empty.textContent = 'That page image is not on this device any more — re-import the PDF.'; return; }
      window.BlobStore.get(page.blobKey).then(function (blob) {
        if (token !== loadToken || !frame.isConnected) return;
        if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } url = null; }
        if (!blob) { empty.hidden = false; empty.textContent = 'That page image is not on this device any more — re-import the PDF.'; return; }
        url = URL.createObjectURL(blob);
        img.onload = function () {
          if (token !== loadToken) return;
          st.iw = img.naturalWidth || page.w || 1;
          st.ih = img.naturalHeight || page.h || 1;
          stage.style.width = st.iw + 'px';
          stage.style.height = st.ih + 'px';
          img.hidden = false;
          fitPage();
          var box = cellBox(idx);
          if (box) {
            mark.hidden = false;
            mark.style.left = box.x + 'px';
            mark.style.top = box.y + 'px';
            mark.style.width = box.w + 'px';
            mark.style.height = box.h + 'px';
            // about 24 stitches across the frame: close enough to read symbols
            var f = frameSize();
            lookAt(box.x + box.w / 2, box.y + box.h / 2, Math.max(st.fitS * 2, f.w / (box.w * 24)));
          }
        };
        img.src = url;
      });
    }

    C.openSheet({
      title: 'Chart page',
      cls: 'sheet-xs-page',
      build: function (body) {
        frame = el('div', 'xs-pv-frame');
        frame.setAttribute('role', 'img');
        frame.setAttribute('aria-label', 'Chart page. Pinch or use the buttons to zoom, drag to pan.');
        stage = el('div', 'xs-pv-stage');
        img = el('img', 'xs-pv-img');
        img.alt = '';
        img.draggable = false;
        mark = el('div', 'xs-pv-mark');
        mark.hidden = true;
        stage.appendChild(img);
        stage.appendChild(mark);
        frame.appendChild(stage);
        empty = el('div', 'xs-page-empty');
        empty.hidden = true;
        frame.appendChild(empty);
        body.appendChild(frame);

        var bar = el('div', 'xs-pagebar xs-pv-bar');
        prev = button('xs-page-nav', '‹', 'Previous page');
        label = el('span', 'xs-page-label');
        next = button('xs-page-nav', '›', 'Next page');
        on(prev, 'click', function () { show(idx - 1); });
        on(next, 'click', function () { show(idx + 1); });
        bar.appendChild(prev);
        bar.appendChild(label);
        bar.appendChild(next);
        body.appendChild(bar);

        var zoomRow = el('div', 'xs-zoom');
        var zOut = button('btn ghost', '−', 'Zoom out');
        var zFit = button('btn ghost', 'Fit');
        var zIn = button('btn ghost', '+', 'Zoom in');
        on(zOut, 'click', function () { var f = frameSize(); zoomAt(1 / 1.5, f.w / 2, f.h / 2); });
        on(zFit, 'click', fitPage);
        on(zIn, 'click', function () { var f = frameSize(); zoomAt(1.5, f.w / 2, f.h / 2); });
        doneBtn = button('btn ghost xs-pv-done', 'Mark page done');
        on(doneBtn, 'click', function () {
          var nextDone = !isPageDone(dataOf(Store.project(projectId)), idx);
          markPageDone(projectId, idx, nextDone, function (now) {
            doneBtn.textContent = now ? 'Page done ✓' : 'Mark page done';
            doneBtn.setAttribute('aria-pressed', now ? 'true' : 'false');
          });
        });
        zoomRow.appendChild(zOut);
        zoomRow.appendChild(zFit);
        zoomRow.appendChild(zIn);
        body.appendChild(zoomRow);
        body.appendChild(doneBtn);
        note = el('p', 'muted xs-hint xs-pv-note');
        body.appendChild(note);

        /* gestures */
        on(frame, 'pointerdown', function (e) {
          pointers[e.pointerId] = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
          try { frame.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
          var ids = Object.keys(pointers);
          if (ids.length === 2) {
            var a = pointers[ids[0]], b = pointers[ids[1]], r = frame.getBoundingClientRect();
            pinch = {
              d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), s: st.s,
              mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top
            };
            pinch.px = (pinch.mx - st.tx) / st.s;
            pinch.py = (pinch.my - st.ty) / st.s;
          }
          e.preventDefault();
        });
        on(frame, 'pointermove', function (e) {
          var q = pointers[e.pointerId];
          if (!q) return;
          var dx = e.clientX - q.x, dy = e.clientY - q.y;
          q.x = e.clientX; q.y = e.clientY;
          if (Math.abs(e.clientX - q.sx) > 4 || Math.abs(e.clientY - q.sy) > 4) q.moved = true;
          var ids = Object.keys(pointers);
          if (ids.length === 2 && pinch) {
            var a = pointers[ids[0]], b = pointers[ids[1]];
            var d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
            st.s = Math.max(st.fitS, Math.min(st.fitS * 12, pinch.s * d / pinch.d));
            st.tx = pinch.mx - pinch.px * st.s;
            st.ty = pinch.my - pinch.py * st.s;
          } else {
            st.tx += dx; st.ty += dy;
          }
          clamp();
          apply();
          e.preventDefault();
        });
        function end(e) {
          var q = pointers[e.pointerId];
          delete pointers[e.pointerId];
          if (Object.keys(pointers).length < 2) pinch = null;
          if (!q || q.moved) return;
          var now = Date.now();
          if (now - lastTap < 320) {
            lastTap = 0;
            var r = frame.getBoundingClientRect();
            if (st.s > st.fitS * 1.05) fitPage();
            else zoomAt(3, e.clientX - r.left, e.clientY - r.top);
            return;
          }
          lastTap = now;
        }
        on(frame, 'pointerup', end);
        on(frame, 'pointercancel', end);
        on(frame, 'wheel', function (e) {
          e.preventDefault();
          var r = frame.getBoundingClientRect();
          zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
        });
        on(frame, 'keydown', function (e) {
          var f = frameSize();
          if (e.key === '+' || e.key === '=') { zoomAt(1.25, f.w / 2, f.h / 2); e.preventDefault(); }
          else if (e.key === '-') { zoomAt(0.8, f.w / 2, f.h / 2); e.preventDefault(); }
          else if (e.key === 'ArrowLeft') { st.tx += 40; clamp(); apply(); e.preventDefault(); }
          else if (e.key === 'ArrowRight') { st.tx -= 40; clamp(); apply(); e.preventDefault(); }
          else if (e.key === 'ArrowUp') { st.ty += 40; clamp(); apply(); e.preventDefault(); }
          else if (e.key === 'ArrowDown') { st.ty -= 40; clamp(); apply(); e.preventDefault(); }
        });
        frame.tabIndex = 0;

        window.requestAnimationFrame(function () { show(idx); });
      },
      footer: [{ text: 'Done', cls: 'btn primary', onClick: function (api) { api.close(); } }],
      onClose: function () {
        loadToken++;
        if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } url = null; }
        // the image-mode strip follows the page the stitcher was last on
        var pp = Store.project(projectId);
        if (pp && view && !view.destroyed && view.projectId === projectId && view.nodes) syncScreen(pp, dataOf(pp));
      }
    });
  }

  /* ---- parking notes -------------------------------------------------- */

  var CORNERS = [
    { id: 'tl', label: '↖' }, { id: 'tr', label: '↗' },
    { id: 'bl', label: '↙' }, { id: 'br', label: '↘' }
  ];

  /* #3 parking on the chart: the direction the stitcher works blocks in
     (a view detail for this session; 'right' = rows of blocks left to right). */
  var parkDir = 'right';
  var PARK_DIRS = [{ id: 'right', label: 'Blocks →' }, { id: 'left', label: 'Blocks ←' }, { id: 'column', label: 'Columns ↓' }];

  function parkingV2() {
    return typeof X.parkAt === 'function' && typeof X.unpark === 'function' &&
      typeof X.nextBlockFor === 'function' && typeof X.parkingOrder === 'function';
  }

  function openParkingSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    if (parkingV2() && hasChart(dataOf(p))) { openParkingSheetV2(projectId); return; }

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

  var CORNER_WORDS = { tl: 'top left', tr: 'top right', bl: 'bottom left', br: 'bottom right' };

  /** Move the crosshair to (x, y) and show it: stitch mode, else the chart sheet. */
  function goToStitch(projectId, x, y) {
    setCrosshair(x, y);
    saveViewState(projectId, { cx: x, cy: y, view: { z: 16, x: x + 0.5, y: y + 0.5 } });
    if (sm.chart && C.workMode && C.workMode.isOn && C.workMode.isOn()) {
      C.closeAllSheets();
      sm.chart.centerOn(x, y, 16);
      C.workMode.refresh();
    } else {
      C.closeAllSheets();
      openChartSheet(projectId);
    }
  }

  /**
   * #3 Parking that lives on the chart, with the parking assistant. Threads
   * are listed in the order the stitcher will meet them (X.parkingOrder from
   * the crosshair, in the chosen direction); each row jumps there, its corner
   * and note can be changed; "Park here" parks the current colour at the
   * crosshair in a chosen corner; the assistant names the next block in the
   * working direction that still has the current colour (X.nextBlockFor).
   */
  function openParkingSheetV2(projectId) {
    var corner = 'tl';
    C.openSheet({
      title: 'Parking',
      cls: 'sheet-xs-park',
      build: function (body) {
        function redraw() {
          clear(body);
          var proj = Store.project(projectId);
          if (!proj) return;
          var data = dataOf(proj);
          var e = currentEntry(data);
          var pi = data.palette.length ? clampInt(data.current.paletteIndex, 0, data.palette.length - 1, 0) : -1;
          var cx = clampInt(data.current.cx, 0, Math.max(0, data.chart.w - 1), 0);
          var cy = clampInt(data.current.cy, 0, Math.max(0, data.chart.h - 1), 0);
          body.appendChild(el('p', 'muted',
            'Parking: leave a thread in the hole where that colour starts next. Each one is marked on the ' +
            'chart with a small triangle in its corner.'));

          var dirSeg = C.segmented(PARK_DIRS, parkDir, function (v) { parkDir = v; redraw(); });
          dirSeg.node.classList.add('xs-park-dir');
          body.appendChild(field('I work', dirSeg.node));

          /* the assistant */
          if (e && pi >= 0) {
            var nb = X.nextBlockFor(data, pi, { x: cx, y: cy }, parkDir);
            var tip = el('div', 'card xs-park-tip');
            if (nb) {
              var lab = X.positionLabel(nb.x, nb.y, data.chart.w, data.chart.h);
              tip.appendChild(el('p', null, 'Next ' + paletteLabel(e) + ' in your direction: ' + lab.grid +
                ' (block ' + (nb.bx + 1) + ',' + (nb.by + 1) + ', ' + comma(nb.left) + ' to do there).'));
              var parkNext = button('btn ghost block', '📌 Park ' + (e.code ? (e.brand ? e.brand + ' ' : '') + e.code : 'it') + ' there');
              on(parkNext, 'click', function () {
                Store.updateCraftData(projectId, function (cd) {
                  return X.parkAt(cd, { x: nb.x, y: nb.y, paletteIndex: pi, corner: corner, note: '' });
                });
                fb('tap');
                C.announce('Parked ' + paletteLabel(e) + ' at ' + lab.grid);
                C.render();
                redraw();
              });
              tip.appendChild(parkNext);
            } else {
              tip.appendChild(el('p', 'muted', 'No other block has ' + paletteLabel(e) + ' left to do.'));
            }
            body.appendChild(tip);
          }

          /* park the current colour at the crosshair */
          var cornerRow = el('div', 'xs-park-corners');
          cornerRow.setAttribute('role', 'radiogroup');
          cornerRow.setAttribute('aria-label', 'Corner of the stitch');
          CORNERS.forEach(function (cn) {
            var b = button('btn ghost xs-park-corner-btn' + (cn.id === corner ? ' on' : ''), cn.label, CORNER_WORDS[cn.id]);
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', cn.id === corner ? 'true' : 'false');
            on(b, 'click', function () { corner = cn.id; redraw(); });
            cornerRow.appendChild(b);
          });
          body.appendChild(field('Corner', cornerRow));
          var note = C.textInput ? C.textInput('', 'Note (optional)') : el('input');
          note.setAttribute('aria-label', 'Note for this parked thread');
          note.className = (note.className ? note.className + ' ' : '') + 'xs-park-note';
          body.appendChild(note);
          var here = X.positionLabel(cx, cy, data.chart.w, data.chart.h);
          var add = button('btn primary block', e ? '📌 Park ' + paletteLabel(e) + ' at ' + here.grid : 'Pick a colour first');
          add.disabled = !e;
          on(add, 'click', function () {
            Store.updateCraftData(projectId, function (cd) {
              return X.parkAt(cd, { x: cx, y: cy, paletteIndex: pi, corner: corner, note: note.value || '' });
            });
            fb('tap');
            C.announce('Parked ' + paletteLabel(e) + ' at ' + here.grid + ', ' + CORNER_WORDS[corner]);
            C.render();
            redraw();
          });
          body.appendChild(add);

          /* the parked threads, in the order they will be met */
          var order = X.parkingOrder(data, { x: cx, y: cy }, parkDir);
          var old = [];
          data.parking.forEach(function (pk, i) { if (typeof pk.x !== 'number') old.push(i); });
          body.appendChild(el('h3', 'xs-h3', data.parking.length ? 'Parked threads, in the order you will meet them' : 'Nothing parked yet'));
          var list = el('div', 'list xs-park-list');
          order.forEach(function (o) {
            var pk = data.parking[o.i];
            var pe = typeof pk.paletteIndex === 'number' ? data.palette[pk.paletteIndex] : null;
            var row = el('div', 'list-item xs-park-row');
            var jump = button('xs-key-main', null, 'Go to ' + (pe ? paletteLabel(pe) : pk.key) + ' parked at col ' + (pk.x + 1) + ' row ' + (pk.y + 1));
            var sw = el('span', 'xs-swatch', pe ? pe.symbol || '' : '');
            sw.style.background = pe ? swatchHex(pe) : 'transparent';
            if (pe) sw.style.color = X.symbolInk(pe.hex) === 'light' ? '#fff' : '#111';
            jump.appendChild(sw);
            var t = el('span', 'xs-key-text');
            t.appendChild(el('span', 'xs-key-code', (pe ? paletteLabel(pe) : pk.key || '—')));
            t.appendChild(el('span', 'xs-key-sub', 'col ' + (pk.x + 1) + ' · row ' + (pk.y + 1) + ' · ' +
              CORNER_WORDS[pk.corner || 'tl'] + (pk.note ? ' · ' + pk.note : '')));
            jump.appendChild(t);
            on(jump, 'click', function () { goToStitch(projectId, pk.x, pk.y); });
            row.appendChild(jump);
            var turn = button('xs-key-edit', cornerLabel(pk.corner), 'Move to the next corner');
            on(turn, 'click', function () {
              var ids = ['tl', 'tr', 'br', 'bl'];
              var nx = ids[(ids.indexOf(pk.corner || 'tl') + 1) % 4];
              Store.updateCraftData(projectId, function (cd) { if (cd.parking[o.i]) cd.parking[o.i].corner = nx; });
              C.render();
              redraw();
            });
            row.appendChild(turn);
            var del = button('xs-key-edit', '✕', 'Unpark this thread');
            on(del, 'click', function () {
              Store.updateCraftData(projectId, function (cd) { return X.unpark(cd, o.i); });
              C.render();
              redraw();
            });
            row.appendChild(del);
            list.appendChild(row);
          });
          old.forEach(function (i) {
            var pk = data.parking[i];
            var row = el('div', 'list-item xs-park-row');
            var txt = el('span', 'xs-park-text');
            txt.appendChild(el('span', 'xs-key-code', (pk.symbol || '•') + '  ' + (pk.key || '—')));
            txt.appendChild(el('span', 'xs-key-sub', (pk.note ? pk.note + ' · ' : '') + 'a note from before; not on the chart'));
            row.appendChild(txt);
            var del = button('xs-key-edit', '✕', 'Remove this parking note');
            on(del, 'click', function () {
              Store.updateCraftData(projectId, function (cd) { return X.unpark(cd, i); });
              redraw();
            });
            row.appendChild(del);
            list.appendChild(row);
          });
          body.appendChild(list);
        }
        redraw();
      },
      footer: [{ text: 'Close', cls: 'btn primary', onClick: function (api) { api.close(); } }]
    });
  }

  /** Marking a parked stitch offers to unpark it (#3). */
  function offerUnpark(projectId, x, y, pi) {
    if (typeof X.parkedAt !== 'function' || !view || !view.data) return;
    var hits = X.parkedAt(view.data, x, y).filter(function (i) {
      var pk = view.data.parking[i];
      return pk && (pk.paletteIndex === pi || pk.paletteIndex === undefined);
    });
    if (!hits.length) return;
    toast('A thread is parked here', {
      actionText: 'Unpark', ms: 5000,
      onAction: function () {
        Store.updateCraftData(projectId, function (cd) {
          var d = cd;
          for (var k = hits.length - 1; k >= 0; k--) d = X.unpark(d, hits[k]);
          return d;
        });
        C.render();
      }
    });
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

    /* Wave J: a picture of a chart can be dropped, chosen or pasted here
       when the chart reader (js/xstitch-read.js) is on this device. */
    var pictures = readerAvailable();
    var pasteGuard = null;

    C.openSheet({
      title: 'Import a chart',
      cls: 'sheet-xs-import',
      build: function (body, api) {
        zone = C.pdfDropZone({
          label: pictures
            ? 'Drop a cross-stitch PDF, an .oxs file or a picture of a chart here, or choose a file'
            : 'Drop a cross-stitch PDF or .oxs file here, or choose a file',
          accept: importAcceptList(),
          icon: '🧵',
          ariaLabel: 'Choose a cross-stitch chart',
          tour: 'xs-import-drop',
          rejectMessage: pictures
            ? 'That needs to be a PDF, an .oxs chart or a picture (PNG, JPEG or WebP)'
            : 'That needs to be a PDF or an .oxs chart',
          onPages: function (handle) {
            pdfHandle = handle;
          },
          onText: function (res) {
            handlePdfText(projectId, res, pdfHandle, setPreview);
          },
          onFile: function (file) {
            if (pictures && isImageFile(file)) handlePicture(projectId, file, setPreview);
            else readOxsFile(projectId, file, setPreview);
          },
          onError: function (err) {
            setPreview(el('p', 'muted', (err && err.message) ||
              'That PDF could not be read. Its pages may be pictures — you can still add the colours by hand.'));
          }
        });
        body.appendChild(zone);

        previewBox = el('div', 'xs-preview');
        previewBox.hidden = true;
        body.appendChild(previewBox);

        var more = el('div', 'list xs-import-more');

        if (pictures) {
          var picPick = document.createElement('input');
          picPick.type = 'file';
          picPick.accept = 'image/*';
          picPick.className = 'sr-only';
          picPick.tabIndex = -1;
          picPick.setAttribute('aria-hidden', 'true');
          on(picPick, 'change', function () {
            var f = picPick.files && picPick.files[0];
            picPick.value = '';
            if (f) handlePicture(projectId, f, setPreview);
          });
          var picItem = el('button', 'menu-item xs-read-item');
          picItem.type = 'button';
          picItem.appendChild(el('span', 'menu-icon', '🖼'));
          var picText = el('span', 'xs-read-item-text');
          picText.appendChild(el('span', null, 'Read a picture of a chart'));
          picText.appendChild(el('span', 'muted xs-read-item-sub',
            'A screenshot or image with one square per stitch. You can also paste one here.'));
          picItem.appendChild(picText);
          on(picItem, 'click', function () { picPick.click(); });
          more.appendChild(picItem);
          more.appendChild(picPick);

          /* A pasted screenshot (Ctrl+V / long-press Paste) reads like a drop,
             but only while this sheet is the one on top. */
          pasteGuard = function (e) {
            var sheets = document.querySelectorAll('dialog.sheet');
            if (!sheets.length || sheets[sheets.length - 1] !== api.dialog) return;
            var f = imageFromClipboard(e);
            if (!f) return;
            e.preventDefault();
            handlePicture(projectId, f, setPreview);
          };
          document.addEventListener('paste', pasteGuard);
        }

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
          'Chart pages are rendered as images and saved with the project; Back up now includes them.'));
      },
      onClose: function () {
        if (pasteGuard) document.removeEventListener('paste', pasteGuard);
        pasteGuard = null;
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
      cd.current.view = null;           // a new chart opens at Fit
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

  /**
   * xs-audit: colour names never hold digits. On a magazine key the parser can
   * pick up the chart's symbol run as a name ("Zlnn9999MM"); such a name is
   * replaced with the floss table's name (or left empty, never shown).
   * Mutates `entries`; returns how many names were replaced.
   */
  function looksLikeSymbolSoup(name) {
    var s = String(name || '').trim();
    if (!s) return false;
    return /\d/.test(s) || /(.)\1\1\1/.test(s) || (s.length >= 6 && !/\s/.test(s) && !/[aeiouy]/i.test(s));
  }
  function cleanKeyNames(entries) {
    var n = 0;
    (entries || []).forEach(function (e) {
      if (!e || !looksLikeSymbolSoup(e.name)) return;
      var t = typeof X.flossFor === 'function' ? X.flossFor(e.brand || 'DMC', e.code) : null;
      e.name = t && t.name ? t.name : '';
      n++;
    });
    return n;
  }

  function handlePdfText(projectId, res, handle, setPreview) {
    var key;
    try { key = X.parseKey(res.text || ''); } catch (e) { key = null; }
    if (!key) {
      setPreview(el('p', 'muted', 'That PDF could not be read.'));
      return;
    }
    var soup = cleanKeyNames(key.entries);
    var edits = { entries: key.entries.slice(), fabric: key.fabric, design: key.design, strands: key.strandsDefault };

    var card = el('div', 'card xs-preview-card');
    var band = el('div', 'xs-confidence');
    var level = key.confidence >= 0.7 ? 'good' : (key.confidence > 0 ? 'ok' : 'none');
    /* xs-audit: a key whose names came back as chart-symbol soup was not read cleanly */
    if (level === 'good' && soup) level = 'ok';
    band.classList.add('xs-conf-' + level);
    if (level === 'good') {
      band.textContent = 'Read the key cleanly — ' + plural(key.entries.length, 'colour') + ' found.';
    } else if (level === 'ok' && soup) {
      band.textContent = 'Read the key (' + plural(key.entries.length, 'colour') + '), but ' + plural(soup, 'name') +
        ' came out as chart symbols and ' + (soup === 1 ? 'was' : 'were') + ' replaced with the DMC name. Check it before importing.';
    } else if (level === 'ok') {
      band.textContent = 'Read some of the key (' + plural(key.entries.length, 'colour') +
        '). Check it before importing.';
    } else if ((res.chars || 0) < 60) {
      band.textContent = 'These pages are pictures, so there is no text to read. The chart pages are ' +
        'here; ' + (handle && readerAvailable() ? 'read the chart from the page pictures below, or add colours by hand.' : 'add colours by hand or from a photo.');
    } else {
      band.textContent = 'I couldn’t find a colour key in this PDF. The chart pages are here; ' +
        (handle && readerAvailable() ? 'read the chart from the page pictures below, or add colours by hand.' : 'add colours by hand or from a photo.');
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
    /* Wave J: the page pictures, for a chart the vector reader cannot see
       (drawn as an image, or read far from the key's counts). Offered at
       once when the vector reader is not, and after it fails otherwise. */
    var picWrap = null;
    if (handle && readerAvailable()) {
      picWrap = el('div', 'xs-pdfpic');
      var picBox = el('div', 'xs-beta-box');
      picBox.hidden = true;
      var picBtn = button('btn ghost block xs-beta-btn', '🖼 Read the chart from the page pictures');
      on(picBtn, 'click', function () {
        picBtn.disabled = true;
        readPdfPictures(projectId, handle, key, edits, picBox, progressLine).then(function () {
          picBtn.disabled = false;
        });
      });
      picWrap.appendChild(picBtn);
      picWrap.appendChild(picBox);
      picWrap.appendChild(el('p', 'muted xs-import-note',
        'For charts that are a picture inside the PDF: finds the page that shows the whole design, ' +
        'reads it square by square on this device and checks it against the key’s stitch counts.'));
    }

    if (handle && gridIsWorthTrying(key)) {
      var betaBox = el('div', 'xs-beta-box');
      betaBox.hidden = true;
      var beta = button('btn ghost block xs-beta-btn', '🔍 Try to read the grid (beta)');
      on(beta, 'click', function () {
        beta.disabled = true;
        go.disabled = true;
        runGridBeta(handle, key, betaBox, function (res) {
          applyPdf(projectId, edits, key, handle, progressLine, res);
        }).then(function (res) {
          beta.disabled = false;
          go.disabled = false;
          if (picWrap && (!res || !res.ok || (res.colors && res.matched < res.colors))) picWrap.hidden = false;
        });
      });
      card.appendChild(beta);
      card.appendChild(betaBox);
      card.appendChild(el('p', 'muted xs-import-note',
        'Reading the grid gets you stitch-by-stitch counting instead of a count per colour. ' +
        'It only works on charts that draw every stitch as a coloured square.'));
      if (picWrap) picWrap.hidden = true;
    }
    if (picWrap) card.appendChild(picWrap);

    setPreview(card);
  }

  function applyPdf(projectId, edits, key, handle, progressLine, grid) {
    var source = (grid && grid.ok && grid.palette) ? grid.palette : edits.entries;
    var palette = source.map(function (e, i) {
      /* A backstitch or French-knot row takes the strands the sheet gives
         for that technique ('Backstitch in one strand'), not the
         cross-stitch default. */
      var own = e.kind === 'back' ? key.bsStrands : e.kind === 'knot' ? key.knotStrands : null;
      return {
        i: i, symbol: e.symbol || '', brand: e.brand || 'DMC', code: e.code,
        name: e.name || '', hex: e.hex || '808080',
        strands: e.strands || own || edits.strands || 2, bsStrands: key.bsStrands || 1,
        kind: e.kind || 'cross', blendWith: null,
        stitchCount: e.stitchCount || 0, skeins: e.skeins || 0, have: false
      };
    });
    if (grid && grid.ok) palette.forEach(function (pe, i) { keepReadFields(pe, source[i]); });
    letterPalette(palette);
    var gridInfo = grid && grid.ok ? gridSourceCheck(grid) : null;
    var orn = grid && grid.ok ? ornamentsOf(grid, palette) : null;

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
          part: orn ? orn.part : [], back: orn ? orn.back : [], knots: orn ? orn.knots : []
        };
        clearExtraProgress(cd);
        cd.progress.mode = 'cells';
        cd.current.cx = 0;
        cd.current.cy = 0;
        cd.current.view = null;
      }
      cd.notesKey = (key.sizes || []).map(function (s) {
        return s.count + ' ct: ' + s.wIn + ' × ' + s.hIn + ' in';
      }).join('\n');
      cd.source = {
        kind: 'pdf', fileName: '', importedAt: Date.now(),
        warnings: key.warnings.concat(grid && grid.ok ? ['grid read from the PDF by the beta reader'] : [])
          .slice(0, 12)
      };
      if (gridInfo) cd.source.check = gridInfo;
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
    /* Wave F (04 #3): the grid reader winning ADDS a chart; the page images
       are rendered and kept exactly as for a key-only import, and each one
       records which stitches it prints so the chart can flip to it. */
    return renderPages(projectId, handle, key, progressLine,
      grid && grid.ok ? grid.regions : null).then(function (pages) {
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
  /**
   * A re-import with fewer pages used to leave the old tail of page images
   * in IndexedDB with nothing pointing at them (04 #3: an orphan
   * `chartpage:0` was still there after the import). Anything under this
   * project's chartpage prefix that the new page list does not use goes.
   */
  function dropOrphanPages(projectId, pages) {
    if (!window.BlobStore || typeof window.BlobStore.keys !== 'function') return Promise.resolve(0);
    var keep = {};
    for (var i = 0; i < pages.length; i++) keep[pages[i].blobKey] = true;
    return window.BlobStore.keys('p:' + projectId + ':chartpage:').then(function (keys) {
      var gone = (keys || []).filter(function (k) { return !keep[k]; });
      return Promise.all(gone.map(function (k) { return window.BlobStore.delete(k); })).then(function () {
        return gone.length;
      });
    }, function () { return 0; });
  }

  /** pages[i].region for 1-based PDF page `n`, from extractGrid's regions. */
  function regionForPage(regions, n) {
    if (!regions) return null;
    for (var i = 0; i < regions.length; i++) if (regions[i].page === n) return regions[i].region;
    return null;
  }

  function renderPages(projectId, handle, key, progressLine, regions) {
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
                var reg = regionForPage(regions, n);
                pages.push({
                  n: n - 1,
                  // a one-page PDF (Tiny Modernist) is the chart, not a cover
                  label: n === 1 && allPages > 1 ? 'Cover' : 'Page ' + n,
                  blobKey: key2,
                  w: canvas.width, h: canvas.height,
                  isChart: regions ? !!reg : (n > 1 || allPages === 1),
                  region: reg
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
      dropOrphanPages(projectId, pages);
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

  /* ---- wave K: the grid read tells the truth (the pacman bug's UI half) -- */

  /** Carry what a read knows about a colour onto the palette entry we store:
      the key's printed count, the designer's symbol and "not told apart". */
  function keepReadFields(out, src) {
    if (!out || !src) return out;
    if (typeof src.keyCount === 'number' && src.keyCount > 0) out.keyCount = src.keyCount;
    if (src.glyph && typeof src.glyph === 'object') out.glyph = src.glyph;
    if (Array.isArray(src.unresolved)) {
      out.unresolved = src.unresolved.slice();
      out.code = '';
      out.brand = '';
      out.name = src.name || 'Unknown colour (not told apart)';
    }
    return out;
  }

  /** Symbols for a freshly imported palette: one per shape family before any
      family repeats (#1), and "?" on a colour the read could not name. */
  function letterPalette(palette) {
    try { X.assignSymbols(palette, { distinct: true }); } catch (e) { X.assignSymbols(palette); }
    for (var i = 0; i < palette.length; i++) if (palette[i].unresolved) palette[i].symbol = '?';
    return palette;
  }

  function sumOrNull(list) {
    if (!Array.isArray(list) || !list.length) return null;
    var s = 0;
    for (var i = 0; i < list.length; i++) {
      if (typeof list[i] !== 'number') return null;
      s += list[i];
    }
    return s;
  }

  var UNRESOLVED_WHY = {
    'shared-ink': 'These key colours are printed in the same ink, and no symbol on the chart told them apart.',
    tie: 'These key colours have the same stitch count and nothing else to tell them apart.',
    unknown: 'This ink matches no colour in the key.'
  };

  /** A CheckSheet Check for an extractGrid result: its count check, plus one row
      per class it could not name. Any unresolved class makes the check "off". */
  function gridCheckOf(res) {
    if (!res || !res.ok) return null;
    var base = null;
    if (res.check && C.check && typeof C.check.fromXStitch === 'function') {
      try { base = C.check.fromXStitch(res.check); } catch (e) { base = null; }
    }
    var c = base || { verdict: 'unchecked', title: 'Chart against the key', summary: '', rows: [] };
    var ur = Array.isArray(res.unresolved) ? res.unresolved : [];
    if (!ur.length) return c;
    var rows = (c.rows || []).slice(), n = 0;
    for (var i = ur.length - 1; i >= 0; i--) {
      var u = ur[i];
      n += u.cells || 0;
      var pe = res.palette && res.palette[u.palette];
      var exp = sumOrNull(u.expected);
      rows.unshift({
        label: (pe && pe.name) || 'Unknown colour',
        printed: exp, read: u.cells || 0, verdict: 'off',
        why: (UNRESOLVED_WHY[u.why] || UNRESOLVED_WHY.unknown) +
          (u.expected && u.expected.length > 1 && exp !== null
            ? ' The key prints ' + u.expected.map(comma).join(' and ') + ' for them.' : ''),
        hex: /^[0-9a-f]{6}$/i.test(u.ink || '') ? '#' + u.ink : undefined
      });
    }
    return {
      verdict: 'off',
      title: c.title || 'Chart against the key',
      summary: comma(n) + ' ' + (n === 1 ? 'stitch' : 'stitches') + ' could not be given a key colour. ' +
        'They come in marked “?” so you can choose. ' + (c.summary || ''),
      rows: rows,
      note: c.note
    };
  }

  /**
   * #10: backstitch, French knots and fractionals the PDF draws as lines and
   * shapes (extractGrid().graphics), matched to the key's backstitch / knot
   * rows by colour (XStitch.ornamentsFromGraphics). Nothing unmatched is guessed.
   * -> { back, knots, part, unmatched } | null
   */
  function ornamentsOf(res, palette) {
    if (!res || !res.graphics || typeof X.ornamentsFromGraphics !== 'function') return null;
    var g = res.graphics;
    if (!((g.segments && g.segments.length) || (g.circles && g.circles.length) || (g.polys && g.polys.length))) return null;
    var o = null;
    try { o = X.ornamentsFromGraphics(g, palette, {}); } catch (e) { o = null; }
    if (!o || !(o.back.length || o.knots.length || o.part.length)) return null;
    return o;
  }

  function ornamentWords(o) {
    if (!o) return '';
    var w = [];
    if (o.back.length) w.push(comma(o.back.length) + ' backstitch ' + (o.back.length === 1 ? 'segment' : 'segments'));
    if (o.knots.length) w.push(plural(o.knots.length, 'knot'));
    if (o.part.length) w.push(plural(o.part.length, 'part stitch'));
    return w.join(', ') + ' read from the PDF' + (o.unmatched && o.unmatched.length ? ' (' + comma(o.unmatched.length) + ' lines matched no key colour and were left out)' : '');
  }

  /** What craftData.source.check keeps of a grid read (the project's band). */
  function gridSourceCheck(res) {
    var c = gridCheckOf(res);
    if (!c) return null;
    var ur = Array.isArray(res.unresolved) ? res.unresolved : [];
    var off = 0;
    (c.rows || []).forEach(function (r) { if (r && r.verdict === 'off') off++; });
    return {
      verdict: c.verdict, summary: c.summary,
      readTotal: res.filled || null,
      expectedTotal: res.check && typeof res.check.expectedTotal === 'number' ? res.check.expectedTotal : null,
      off: off, colours: (res.palette || []).length - ur.length
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
      /* 04 #6: the rectangle is not the stitch count. xs-audit: the reader's
         own "9 of 9 colours matched" counts inks, not key colours, and sat
         right above "All 10 colours match the key" on Pac-Man; the check line
         below is the one statement about the key, so the head gives only the
         size and the number of key colours on the chart. */
      var gcheck0 = gridCheckOf(res);
      var nCol = (res.palette || []).filter(function (e) { return e && !e.unresolved; }).length;
      head.textContent = 'Read ' + comma(res.filled || 0) + ' stitches over a ' + res.w + ' × ' + res.h + ' grid' +
        (gcheck0 && C.check && typeof C.check.line === 'function'
          ? ' in ' + plural(nCol, 'colour') + '.'
          : ', ' + res.matched + ' of ' + res.colors + ' colours matched.');
      box.appendChild(head);
      box.appendChild(el('p', 'muted',
        'Read in ' + secs + ' s. Using it replaces the colour ' +
        'key with the one read from the grid and switches counting to individual ' +
        'stitches, which starts from zero — any counts you have now are not carried over. ' +
        'The PDF pages are kept: 📄 on the chart shows the page for any stitch, for the ' +
        'backstitch and notes the grid reader cannot see.'));
      /* Wave K: the read's own check, shown before "Use it" every time. An
         "off" check (counts that disagree, colours not told apart) demotes the
         button behind a plain confirm; it never blocks and never hides it. */
      var gcheck = gridCheckOf(res);
      var hasCheck = !!(gcheck && C.check && typeof C.check.line === 'function');
      if (hasCheck) {
        var cl = C.check.line(gcheck, {
          onOpen: function () { C.check.open(gcheck, { title: 'Chart against the key' }); }
        });
        cl.classList.add('xs-grid-check');
        box.appendChild(cl);
      }
      var ur = Array.isArray(res.unresolved) ? res.unresolved : [];
      if (ur.length) {
        box.appendChild(el('p', 'xs-grid-unresolved', ur.map(function (u) {
          var pe = res.palette[u.palette];
          return comma(u.cells) + ' ' + (u.cells === 1 ? 'stitch is' : 'stitches are') + ' ' +
            ((pe && pe.name) || 'an unknown colour').replace(/ \((not told apart|not in the key\?)\)$/, '') +
            ': not told apart.';
        }).join(' ') + ' Using it keeps them as their own colour marked “?” on the chart, and ' +
          'the key lets you choose which colour they are.'));
      }
      var orn0 = ornamentsOf(res, res.palette || []);
      if (orn0) box.appendChild(el('p', 'muted', ornamentWords(orn0) + '.'));
      if (res.warnings.length) box.appendChild(warningList('Notes', res.warnings.slice(0, 4), true));
      var off = !!(gcheck && gcheck.verdict === 'off');
      var use = button('btn primary block', off ? 'Use it anyway…' : 'Use it');
      if (hasCheck && typeof C.check.demote === 'function') C.check.demote(use, gcheck);
      else if (off) use.classList.remove('primary');
      on(use, 'click', function () {
        if (!off) { onUse(res); return; }
        C.confirmSheet({
          title: 'Use it with colours that are off?',
          message: (gcheck.summary || '') + ' The chart may be wrong where those colours are. ' +
            'You can fix them from the key afterwards.',
          confirmText: 'Use it anyway',
          cancelText: 'Go back'
        }).then(function (ok) { if (ok) onUse(res); });
      });
      box.appendChild(use);
      fb(off ? 'alert' : 'done');
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
    palette.forEach(function (pe, i) { keepReadFields(pe, res.palette[i]); });
    letterPalette(palette);
    var gridInfo = gridSourceCheck(res);
    var orn = ornamentsOf(res, palette);

    Store.updateCraftData(projectId, function (cd) {
      cd.palette = palette;
      cd.design.w = res.w;
      cd.design.h = res.h;
      cd.chart = {
        w: res.w, h: res.h,
        cells: X.packCells(res.cells, res.w, res.h),
        part: orn ? orn.part : [], back: orn ? orn.back : [], knots: orn ? orn.knots : []
      };
      cd.progress.mode = 'cells';
      cd.progress.done = '';
      cd.progress.doneCount = 0;
      clearExtraProgress(cd);
      cd.progress.perColor = palette.map(function (e, i) { return { i: i, done: 0 }; });
      cd.current.paletteIndex = 0;
      cd.current.cx = 0;
      cd.current.cy = 0;
      cd.current.view = null;
      cd.sizeWarnedAt = 0;
      /* Wave F (04 #3): the pages already in the project stay, and each one
         learns which stitches of the new chart it prints. */
      if (Array.isArray(cd.pages) && res.regions && res.regions.length) {
        cd.pages.forEach(function (pg) {
          var reg = regionForPage(res.regions, pg.n + 1);
          pg.region = reg;
          pg.isChart = !!reg;
        });
      }
      var warn = (cd.source.warnings || []).slice(0);
      cd.source.warnings = warn.concat(['grid read from the PDF by the beta reader'])
        .concat(res.warnings || []).slice(0, 12);
      if (gridInfo) { cd.source.check = gridInfo; cd.source.kind = 'pdf'; }
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

  /**
   * The crop frame (B6) over a picked picture: drag the frame or a corner,
   * arrow keys nudge the focused one (1%, Shift 5%). Shared by Photo to chart
   * and Read a chart picture (wave J). `onChange(crop)` gets { x, y, w, h }
   * in source pixels, or null for the whole picture, on every user change.
   */
  function makeCropFrame(o) {
    o = o || {};
    var MIN_CROP = 20;
    var CORNER_IDS = ['tl', 'tr', 'bl', 'br'];
    var noun = o.noun || 'photo';
    var url = null, srcW = 0, srcH = 0, crop = null, aspectLock = false, pendingSet = null;

    var wrap = el('div', 'xs-crop');
    wrap.hidden = true;
    var img = el('img');
    img.alt = o.alt || ('The ' + noun + ' you picked');
    wrap.appendChild(img);
    var box = el('div', 'xs-crop-box');
    wrap.appendChild(box);

    var row = el('div', 'xs-crop-row');
    var hint = el('span', 'muted xs-crop-hint', '');
    row.appendChild(hint);
    var reset = button('linkish xs-crop-reset', 'Reset crop');
    reset.hidden = true;
    row.appendChild(reset);

    var lockRow = C.switchRow('Keep the crop shape',
      'Locks the frame to its current shape while you drag a corner.',
      false, function (v) { aspectLock = v; });

    function get() {
      if (!crop || !srcW || !srcH) return null;
      if (crop.x <= 0 && crop.y <= 0 && crop.w >= srcW && crop.h >= srcH) return null;
      return { x: Math.round(crop.x), y: Math.round(crop.y), w: Math.round(crop.w), h: Math.round(crop.h) };
    }

    function sync() {
      if (!srcW || !srcH || !crop) return;
      box.style.left = (crop.x / srcW * 100) + '%';
      box.style.top = (crop.y / srcH * 100) + '%';
      box.style.width = (crop.w / srcW * 100) + '%';
      box.style.height = (crop.h / srcH * 100) + '%';
      var c = get();
      hint.textContent = c
        ? ('Cropping ' + Math.round(crop.w) + ' × ' + Math.round(crop.h) + ' of ' +
           srcW + ' × ' + srcH + ' pixels')
        : ('Using the whole ' + noun + ', ' + srcW + ' × ' + srcH + ' pixels');
      reset.hidden = !c;
    }

    function changed() {
      if (typeof o.onChange === 'function') {
        try { o.onChange(get()); } catch (e) { /* ignore */ }
      }
    }

    function resetCrop() {
      if (!srcW || !srcH) return;
      crop = { x: 0, y: 0, w: srcW, h: srcH };
      sync();
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

    var drag = null;

    function start(e, mode) {
      if (!crop || !srcW) return;
      var r = img.getBoundingClientRect();
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

    /* Move the frame, or one corner of it, by (dx, dy) source pixels from
       where it was at `base`. Shared by the pointer and the arrow keys. */
    function shift(base, mode, dx, dy) {
      var right = base.x + base.w, bottom = base.y + base.h;
      if (mode === 'move') {
        crop.x = base.x + dx;
        crop.y = base.y + dy;
        crop.w = base.w;
        crop.h = base.h;
      } else {
        var nx = base.x, ny = base.y, nr = right, nb = bottom;
        if (mode.charAt(1) === 'l') nx = Math.min(base.x + dx, right - MIN_CROP);
        else nr = Math.max(right + dx, base.x + MIN_CROP);
        if (mode.charAt(0) === 't') ny = Math.min(base.y + dy, bottom - MIN_CROP);
        else nb = Math.max(bottom + dy, base.y + MIN_CROP);
        crop.x = nx; crop.y = ny; crop.w = nr - nx; crop.h = nb - ny;
        if (aspectLock && base.ratio > 0) {
          /* keep the shape: the longer change wins, the anchored corner stays */
          var byW = crop.w / base.ratio;
          var byH = crop.h * base.ratio;
          if (Math.abs(byW - crop.h) < Math.abs(byH - crop.w)) crop.h = byW;
          else crop.w = byH;
          if (mode.charAt(1) === 'l') crop.x = nr - crop.w;
          if (mode.charAt(0) === 't') crop.y = nb - crop.h;
        }
      }
      clampCrop();
      sync();
      changed();
    }

    function move(e) {
      if (!drag) return;
      shift(drag, drag.mode, (e.clientX - drag.px) / drag.sx, (e.clientY - drag.py) / drag.sy);
      e.preventDefault();
    }

    var KEY_DIRS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    function nudge(e, mode) {
      var d = KEY_DIRS[e.key];
      if (!d || !crop || !srcW || !srcH) return;
      if (mode === 'move' && e.target !== box) return;
      var step = e.shiftKey ? 0.05 : 0.01;
      var base = { x: crop.x, y: crop.y, w: crop.w, h: crop.h,
        ratio: crop.h > 0 ? crop.w / crop.h : 1 };
      shift(base, mode, d[0] * Math.max(1, srcW * step), d[1] * Math.max(1, srcH * step));
      e.preventDefault();
      e.stopPropagation();
    }

    function end() { if (drag) { drag = null; changed(); } }

    on(box, 'pointerdown', function (e) {
      if (e.target !== box) return;
      start(e, 'move');
    });
    box.tabIndex = 0;
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Crop frame: arrow keys move it, Shift moves further');
    on(box, 'keydown', function (e) { nudge(e, 'move'); });
    var CORNER_NAMES = { tl: 'top-left', tr: 'top-right', bl: 'bottom-left', br: 'bottom-right' };
    CORNER_IDS.forEach(function (id) {
      var handle = el('span', 'xs-crop-h xs-crop-' + id);
      handle.setAttribute('role', 'button');
      handle.tabIndex = 0;
      handle.setAttribute('aria-label', 'The ' + CORNER_NAMES[id] +
        ' corner of the crop: drag it, or use the arrow keys');
      on(handle, 'keydown', function (e) { nudge(e, id); });
      on(handle, 'pointerdown', function (e) { start(e, id); });
      on(handle, 'pointermove', move);
      on(handle, 'pointerup', end);
      on(handle, 'pointercancel', end);
      box.appendChild(handle);
    });
    on(box, 'pointermove', move);
    on(box, 'pointerup', end);
    on(box, 'pointercancel', end);

    on(reset, 'click', function () { resetCrop(); changed(); });

    on(img, 'load', function () {
      srcW = img.naturalWidth || 0;
      srcH = img.naturalHeight || 0;
      if (!srcW || !srcH) { wrap.hidden = true; return; }
      wrap.hidden = false;
      resetCrop();
      if (pendingSet) {
        crop = { x: pendingSet.x, y: pendingSet.y, w: pendingSet.w, h: pendingSet.h };
        pendingSet = null;
        clampCrop();
        sync();
      }
    });
    on(img, 'error', function () { wrap.hidden = true; });

    return {
      wrap: wrap,
      row: row,
      lockRow: lockRow,
      /** Show a new picture (a Blob / File); the crop starts as the whole of it. */
      load: function (blob) {
        if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }
        url = URL.createObjectURL(blob);
        crop = null; srcW = 0; srcH = 0;
        img.src = url;
        wrap.hidden = true;
      },
      get: get,
      /** Put the frame back where it was (a saved crop); applied once loaded. */
      set: function (c) {
        if (!c) { resetCrop(); return; }
        if (!srcW) { pendingSet = c; return; }
        crop = { x: c.x, y: c.y, w: c.w, h: c.h };
        clampCrop();
        sync();
      },
      reset: resetCrop,
      destroy: function () {
        if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }
        url = null;
      }
    };
  }

  function openPhotoSheet(projectId, initialFile) {
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

    /* the crop frame (B6), shared with Read a chart picture */
    var cropper = makeCropFrame({
      noun: 'photo',
      onChange: function (c) { opts.crop = c; schedule(); }
    });

    function loadSource(f) { cropper.load(f); }

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
          var f = pick.files && pick.files[0];
          if (!f) return;
          takePhoto(f);
        });
        body.appendChild(pickBtn);
        body.appendChild(pick);

        /* the source photo with a draggable crop frame */
        body.appendChild(cropper.wrap);
        body.appendChild(cropper.row);
        body.appendChild(cropper.lockRow);

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

        /* Wave J: "A photo to turn into a chart" from the picture question
           arrives with the photo already chosen. */
        if (initialFile) takePhoto(initialFile);
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        {
          text: 'Use this chart',
          cls: 'btn primary',
          onClick: function (api) {
            if (!result || !result.data) { toast('Convert a photo first'); return; }
            /* #1: a photo never replaces an imported key or chart without asking */
            var pp = Store.project(projectId);
            var ask = pp ? photoReplaceText(dataOf(pp)) : null;
            if (!ask) { applyPhoto(projectId, result, file); api.close(); return; }
            C.confirmSheet({
              title: 'Replace this project’s colours?',
              message: ask,
              confirmText: 'Replace them',
              cancelText: 'Keep my key'
            }).then(function (ok) {
              if (!ok) return;
              applyPhoto(projectId, result, file);
              api.close();
            });
          }
        }
      ],
      onClose: function () {
        if (timer) clearTimeout(timer);
        if (token) { try { P.cancel(token); } catch (e) { /* ignore */ } }
        token = null;
        cropper.destroy();
      }
    });

    function takePhoto(f) {
      file = f;
      pickBtn.textContent = f.name || 'Pasted picture';
      opts.crop = null;
      loadSource(f);
      run();
    }
  }

  /**
   * The photo module hands back a full XSData that has already been through
   * XStitch.normalize, so this is mostly a straight adoption plus a title.
   */
  /**
   * xs-audit (#1): what a photo would throw away, in words, or null when the
   * project has nothing to lose (no colours yet).
   */
  function photoReplaceText(data) {
    var n = data && data.palette ? data.palette.length : 0;
    if (!n) return null;
    var st = statsOf(data);
    var bits = ['This project already has ' + plural(n, 'colour') +
      (data.source && data.source.kind === 'pdf' ? ' from its PDF key' : '') +
      (hasChart(data) ? ' and a ' + data.chart.w + ' × ' + data.chart.h + ' chart' : '') + '.'];
    if (st.done > 0) bits.push(comma(st.done) + ' ' + (st.done === 1 ? 'stitch is' : 'stitches are') + ' marked, and the photo starts from zero.');
    bits.push('The chart from the photo replaces the colours' + (hasChart(data) ? ' and the chart' : '') +
      (data.pages && data.pages.length ? '; the PDF pages stay' : '') + '. You can Undo it.');
    return bits.join(' ');
  }

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
   * 7b. Read a chart picture (wave J, docs/wave-j/CONTRACT.md §4)
   *
   * Recovers the chart that is already in a picture, one square per
   * stitch, through window.XSRead (js/xstitch-read.js, its own Web Worker).
   * Everything is feature-detected: without XSRead none of these entry
   * points appear and the module behaves exactly as before.
   * ================================================================== */

  var IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
  /** detect() confidence from which a picture opens the review directly. */
  var DETECT_SURE = 0.6;
  /** cellConf under this is drawn as unsure (the reader's own LOW_CONF wins). */
  var LOW_CONF_DEFAULT = 128;
  /** A PDF page is drawn at no less than this many px per stitch to read it. */
  var PDF_MIN_PX = 8;
  var PDF_MAX_SIDE = 4096, PDF_MAX_AREA = 16e6, PDF_MAX_CANDIDATES = 12;
  var readSeq = 0;

  function readerAvailable() {
    var R = window.XSRead;
    if (!R || typeof R.read !== 'function' || typeof R.detect !== 'function') return false;
    try { return typeof R.isAvailable !== 'function' || !!R.isAvailable(); } catch (e) { return false; }
  }

  function isImageFile(f) {
    if (!f) return false;
    var type = String(f.type || '').toLowerCase();
    if (/^image\//.test(type)) return type.indexOf('svg') < 0;
    var name = String(f.name || '').toLowerCase();
    for (var i = 0; i < IMAGE_EXTS.length; i++) {
      if (name.slice(-IMAGE_EXTS[i].length) === IMAGE_EXTS[i]) return true;
    }
    return false;
  }

  /** What the drop zones accept: pictures only while the reader is here. */
  function importAcceptList() {
    var base = ['.pdf', '.oxs', '.xml'];
    return readerAvailable() ? base.concat(IMAGE_EXTS) : base;
  }

  /** The first picture on a paste event's clipboard, as a File, or null. */
  function imageFromClipboard(e) {
    var cd = e && e.clipboardData;
    if (!cd) return null;
    var items = cd.items || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it && it.kind === 'file' && /^image\//i.test(it.type || '')) {
        var f = it.getAsFile && it.getAsFile();
        if (!f) continue;
        if (f.name) return f;
        try { return new File([f], 'pasted-picture.' + (String(it.type).split('/')[1] || 'png'), { type: it.type }); } catch (err) { return f; }
      }
    }
    var files = cd.files || [];
    for (var j = 0; j < files.length; j++) if (isImageFile(files[j])) return files[j];
    return null;
  }

  /** BlobStore keys for the picture a chart was read from and its details. */
  function readKeys(projectId) {
    return { pic: 'p:' + projectId + ':readsrc:0', meta: 'p:' + projectId + ':readsrc:meta' };
  }

  /**
   * A short fingerprint of a chart's cells. The stored read details are only
   * shown for the chart they describe: Undo puts the old chart back, and the
   * banner must not then claim it was read from a picture.
   */
  function cellsPrint(chart) {
    if (!chart || !chart.w || !chart.h || !chart.cells) return '';
    var s = String(chart.cells.data || '');
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul ? Math.imul(h, 16777619) : (h * 16777619) | 0;
    }
    return chart.w + 'x' + chart.h + ':' + (h >>> 0).toString(36) + ':' + s.length;
  }

  function copyEntry(e) {
    e = e || {};
    return {
      symbol: e.symbol || '', brand: e.brand || 'DMC', code: String(e.code || ''), name: e.name || '',
      hex: e.hex || null, strands: e.strands || null, stitchCount: e.stitchCount || null,
      skeins: e.skeins || null, kind: e.kind || 'cross'
    };
  }

  function codeKey(brand, code) {
    var c = String(code || '').trim().toUpperCase().replace(/^0+(?=\w)/, '');
    return String(brand || 'DMC').toUpperCase() + ' ' + c;
  }

  /** The project's own key, if it has one, for a picture dropped on its own. */
  function projectKey(data) {
    if (!data || !data.palette.length) return null;
    var k = keyFromPalette(data);
    return {
      entries: k.entries.map(copyEntry),
      meta: { title: data.design.title || '', strands: data.strandsDefault, design: { w: data.design.w, h: data.design.h } }
    };
  }

  function sizeMatches(a, b) {
    return !!(a && b && Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1);
  }

  /** A detect() result whose grid (or one of its alternatives) is the declared size. */
  function detectMatches(det, declared) {
    if (!det || !det.ok || !declared) return false;
    if (sizeMatches(det.size, declared)) return true;
    var alts = Array.isArray(det.alternatives) ? det.alternatives : [];
    for (var i = 0; i < alts.length; i++) if (sizeMatches(alts[i], declared)) return true;
    return false;
  }

  /**
   * Which PDF page to read: the one whose grid is the declared design size
   * (the whole-design preview page), else the most confident grid. `tile` is
   * a page that holds only part of the declared design.
   * @param {Array<{n, det}>} cands
   * @param {{w,h}|null} declared
   * @returns {{best, match: boolean, tile}}
   */
  function pickPdfPage(cands, declared) {
    var best = null, bestScore = -1, tile = null;
    (cands || []).forEach(function (c) {
      var d = c && c.det;
      if (!d || !d.ok || !d.size) return;
      var match = detectMatches(d, declared);
      var score = (match ? 10 : 0) + (d.confidence || 0);
      if (declared && !match && d.size.w <= declared.w + 1 && d.size.h <= declared.h + 1 &&
          d.size.w * d.size.h < declared.w * declared.h * 0.8 && (d.confidence || 0) >= 0.5 && !tile) {
        tile = c;
      }
      if (score > bestScore) { bestScore = score; best = c; }
    });
    return { best: best, match: !!(best && detectMatches(best.det, declared)), tile: tile };
  }

  /**
   * The pdf.js scale to draw a page at so a stitch is at least 8 px, given
   * the pitch seen at scale `s0`, capped at 4096 px a side and 16 MP.
   */
  /* xs-audit: the pages to join are the ones that look like the tile that
     was found (the same square size at page scale), not every page with a
     lattice: on a real 5-page sampler the cover photo "had a grid" and sank
     the whole join. */
  function tilePages(list, ref) {
    var rp = ref && ref.det && ref.det.lattice ? Math.min(ref.det.lattice.pitchX, ref.det.lattice.pitchY) / (ref.s0 || 1) : 0;
    return list.filter(function (c) {
      if (!c.det || !c.det.ok) return false;
      if (c === ref || !rp || !c.det.lattice) return true;
      var cp = Math.min(c.det.lattice.pitchX, c.det.lattice.pitchY) / (c.s0 || 1);
      return Math.abs(cp - rp) <= rp * 0.2;
    });
  }

  function pdfReadScale(base, pitchAtS0, s0) {
    var s = s0;
    if (pitchAtS0 > 0 && pitchAtS0 < PDF_MIN_PX * 1.05) s = s0 * (PDF_MIN_PX * 1.1) / pitchAtS0;
    var bw = Math.max(1, base.w), bh = Math.max(1, base.h);
    var cap = Math.min(PDF_MAX_SIDE / Math.max(bw, bh), Math.sqrt(PDF_MAX_AREA / (bw * bh)));
    return Math.max(0.1, Math.min(s, cap));
  }

  /** The scale to look for a chart at: about 2,000 px wide, within the caps. */
  function pdfLookScale(base) {
    var bw = Math.max(1, base.w), bh = Math.max(1, base.h);
    var cap = Math.min(PDF_MAX_SIDE / Math.max(bw, bh), Math.sqrt(PDF_MAX_AREA / (bw * bh)));
    return Math.max(0.1, Math.min(4, PDF_LOOK_W / bw, cap));
  }
  var PDF_LOOK_W = 2000;

  /** How many key colours a check says are off (an expected count not met). */
  function checkOff(check) {
    if (!check || !Array.isArray(check.rows)) return 0;
    var n = 0;
    for (var i = 0; i < check.rows.length; i++) {
      var r = check.rows[i];
      if (r && r.expected !== null && r.expected !== undefined && !r.ok) n++;
    }
    return n;
  }

  /** The line a project read from a picture shows above its chart. */
  function readBannerText(info, kind) {
    if (!info) return '';
    var head = kind === 'pdf' ? 'Read from the PDF’s grid. ' : 'Read from a picture. ';
    if (info.unresolved > 0) {
      return head + comma(info.unresolved) + ' ' + (info.unresolved === 1 ? 'stitch has' : 'stitches have') +
        ' no key colour yet (marked “?”); tap to choose.';
    }
    if (info.verdict === 'exact' || info.verdict === 'close') {
      return head + (info.summary || 'The colours match the key.');
    }
    if (info.verdict === 'off') {
      var off = info.off || 0;
      return head + (off > 0 ? plural(off, 'colour') + (off === 1 ? ' is' : ' are') + ' off'
        : 'Some colours do not match the key') + '; open the chart check.';
    }
    return head + 'The key gave no stitch counts to check it against; open the chart check.';
  }

  /** "37 squares are unsure" */
  function unsureText(n) {
    if (!n) return 'Every square was read clearly.';
    return comma(n) + (n === 1 ? ' square is' : ' squares are') + ' unsure. They are outlined on “What was read”.';
  }

  function readJsonBlob(blob) {
    if (!blob) return Promise.resolve(null);
    var p = typeof blob.text === 'function' ? blob.text() : new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { resolve(''); };
      fr.readAsText(blob);
    });
    return p.then(function (t) { try { return JSON.parse(t); } catch (e) { return null; } }, function () { return null; });
  }

  function canvasBlob(canvas, type) {
    return new Promise(function (resolve) {
      if (!canvas || !canvas.toBlob) { resolve(null); return; }
      try { canvas.toBlob(function (b) { resolve(b); }, type || 'image/png'); } catch (e) { resolve(null); }
    });
  }

  /* ---- entry point 1: a picture --------------------------------------- */

  /**
   * A dropped, chosen or pasted picture. A confident grid opens the review;
   * otherwise the stitcher says which they meant. Never routed silently.
   */
  function handlePicture(projectId, file, setPreview) {
    if (!readerAvailable()) {
      setPreview(el('p', 'muted', 'Pictures of charts cannot be read on this device.'));
      return;
    }
    var proj = Store.project(projectId);
    var pk = proj ? projectKey(dataOf(proj)) : null;
    var card = el('div', 'card xs-preview-card xs-pic-card');
    var line = el('p', 'muted', 'Looking at ' + (file.name || 'the picture') + '…');
    line.setAttribute('role', 'status');
    card.appendChild(line);
    setPreview(card);

    var p;
    try { p = window.XSRead.detect(file, { size: null }); } catch (e) { p = null; }
    Promise.resolve(p).then(function (det) { return det; }, function () { return null; }).then(function (det) {
      det = det || { ok: false, reason: 'no-image', message: 'That picture could not be opened.' };
      /* the import sheet was closed (or another file taken) while looking */
      if (!card.isConnected) return;
      if (det.reason === 'no-image') {
        clear(card);
        card.appendChild(el('p', null, det.message || 'That picture could not be opened.'));
        fb('alert');
        return;
      }
      var src = {
        blob: file, name: file.name || 'Pasted picture', detect: det,
        key: pk ? pk.entries : null, keyMeta: pk ? pk.meta : null, keyFrom: pk ? 'project' : null,
        size: pk && pk.meta.design.w && pk.meta.design.h ? { w: pk.meta.design.w, h: pk.meta.design.h } : null
      };
      if (det.ok && (det.confidence || 0) >= DETECT_SURE && det.style !== 'unknown') {
        clear(card);
        card.appendChild(el('p', 'muted', 'Found a chart grid of about ' + det.size.w + ' × ' +
          det.size.h + ' squares. Opening the check…'));
        openReadSheet(projectId, src);
        return;
      }
      clear(card);
      /* wave K (xs-read 2 + xs-keyread): a picture of the colour key is read as a key */
      if (det.reason === 'looks-like-a-key' && keyReadAvailable()) {
        card.appendChild(el('h3', 'xs-h3', 'This looks like a colour key'));
        card.appendChild(el('p', 'muted', det.message || 'It looks like the list of threads, not the chart.'));
        var asKey = button('btn primary block', 'Read the colour key');
        on(asKey, 'click', function () { openKeyReadSheet(projectId, { blob: file, name: file.name || 'Key picture' }); });
        card.appendChild(asKey);
        var asChart2 = button('btn block', 'No, it is a chart');
        on(asChart2, 'click', function () { openReadSheet(projectId, src); });
        card.appendChild(asChart2);
        try { asKey.focus(); } catch (e) { /* ignore */ }
        return;
      }
      card.appendChild(el('h3', 'xs-h3', 'Is this a chart or a photo?'));
      var why;
      if (det.ok) {
        why = 'It might be a chart: there seems to be a grid of about ' + det.size.w + ' × ' +
          det.size.h + ' squares, but I am not sure.';
      } else if (det.reason === 'too-small') {
        why = det.message || 'The squares are too small to read. A bigger picture would help.';
      } else {
        why = 'I could not find a chart grid in it.';
      }
      card.appendChild(el('p', 'muted', why));
      var asChart = button('btn primary block', 'A chart, one square per stitch');
      on(asChart, 'click', function () { openReadSheet(projectId, src); });
      var asPhoto = button('btn block', 'A photo to turn into a chart');
      on(asPhoto, 'click', function () { openPhotoSheet(projectId, file); });
      card.appendChild(asChart);
      card.appendChild(asPhoto);
      if (keyReadAvailable()) {
        var asKey3 = button('btn ghost block', 'The colour key (the list of threads)');
        on(asKey3, 'click', function () { openKeyReadSheet(projectId, { blob: file, name: file.name || 'Key picture' }); });
        card.appendChild(asKey3);
      }
      card.appendChild(el('p', 'muted xs-import-note',
        'A chart is read square by square and checked against its key. A photo is turned into a new ' +
        'chart of your own, with the colours you choose.'));
      try { asChart.focus(); } catch (e) { /* ignore */ }
    });
  }

  /* ---- entry point 2: the page pictures of a PDF ----------------------- */

  function readPdfPictures(projectId, handle, key, edits, box, progressLine) {
    clear(box);
    box.hidden = false;
    var line = el('p', 'muted xs-render-progress', 'Looking at the pages…');
    line.setAttribute('role', 'status');
    box.appendChild(line);
    var stop = { cancelled: false };
    var stopBtn = button('btn ghost block', 'Stop');
    on(stopBtn, 'click', function () { stop.cancelled = true; stopBtn.disabled = true; });
    box.appendChild(stopBtn);

    var R = window.XSRead;
    var doc = handle && handle.doc;
    var total = Math.min(handle && handle.numPages || 0, PDF_MAX_CANDIDATES);
    var declared = key && key.design && key.design.w && key.design.h ? { w: key.design.w, h: key.design.h } : null;
    var entries = (edits && edits.entries ? edits.entries : (key ? key.entries : [])).map(copyEntry);
    var keyMeta = {
      title: key && key.design && key.design.title || '',
      strands: key && key.strandsDefault || null,
      design: declared || {},
      fabric: key && key.fabric ? { count: key.fabric.count || null, kind: key.fabric.kind || null, over: key.fabric.over || null } : null
    };
    var cands = [];

    function baseSize(n) {
      if (!doc || typeof doc.getPage !== 'function') return Promise.resolve({ w: 612, h: 792 });
      return doc.getPage(n).then(function (pg) {
        var vp = pg.getViewport({ scale: 1 });
        return { w: vp.width, h: vp.height };
      });
    }

    function look(n) {
      return function () {
        if (stop.cancelled) return null;
        line.textContent = 'Looking for the chart: page ' + n + ' of ' + total + '…';
        return baseSize(n).then(function (base) {
          /* wave K (xs-read 2): a busy page is found far more reliably drawn
             about 2,000 px wide (Satsuma: 70 × 97 at 2,200 px, doubtful at 1,250) */
          var s0 = pdfLookScale(base);
          return handle.renderPage(n, { scale: s0, signal: stop }).then(function (canvas) {
            return Promise.resolve(R.detect(canvas, { size: null })).then(function (det) {
              cands.push({ n: n, det: det, base: base, s0: s0 });
              canvas.width = 0; canvas.height = 0;     // let the memory go
            });
          });
        }).then(null, function (err) {
          if (err && err.name === 'AbortError') stop.cancelled = true;
        });
      };
    }

    var chain = Promise.resolve();
    for (var n = 1; n <= total; n++) chain = chain.then(look(n));

    function finish(node) {
      clear(box);
      box.appendChild(node);
    }

    function proceed(c, forceSize) {
      var det = c.det;
      var pitch = det.lattice ? Math.min(det.lattice.pitchX, det.lattice.pitchY) : 0;
      if (forceSize && det.crop) pitch = Math.min(det.crop.w / forceSize.w, det.crop.h / forceSize.h);
      var s1 = Math.max(pdfReadScale(c.base, pitch, c.s0), c.s0);
      line.textContent = 'Drawing page ' + c.n + ' at full size…';
      return handle.renderPage(c.n, { scale: s1, signal: stop }).then(function (canvas) {
        return canvasBlob(canvas, 'image/png').then(function (blob) {
          var px = pitch * s1 / c.s0;
          var msg = el('div');
          msg.appendChild(el('p', 'xs-beta-ok', 'Page ' + c.n + ' shows the chart' +
            (declared ? ' (' + declared.w + ' × ' + declared.h + ' stitches)' : '') + '.'));
          msg.appendChild(el('p', 'muted', 'Drawn at about ' + Math.round(px) + ' pixels a square. ' +
            'The check opens on top of this; nothing is changed until you say so.'));
          finish(msg);
          openReadSheet(projectId, {
            blob: blob, canvas: canvas, name: 'Page ' + c.n, key: entries, keyMeta: keyMeta,
            size: forceSize || declared, pdf: { handle: handle, key: key, progressLine: progressLine, page: c.n }
          });
        });
      }, function (err) {
        finish(el('p', 'muted', err && err.name === 'AbortError'
          ? 'Stopped. Nothing was changed.'
          : 'Page ' + c.n + ' could not be drawn. Nothing was changed.'));
      });
    }

    /* #11: a chart printed across several pages as pictures (XSRead.readTiles).
       The layout and every seam's agreement are shown before anything is used. */
    function readPdfTiles(list) {
      if (!list.length) { finish(el('p', 'muted', 'No chart pages to join.')); return Promise.resolve(); }
      var canvases = [], i2 = 0;
      function drawNext() {
        if (stop.cancelled) return Promise.resolve();
        if (i2 >= list.length) return Promise.resolve();
        var c = list[i2++];
        var pitch = c.det.lattice ? Math.min(c.det.lattice.pitchX, c.det.lattice.pitchY) : 0;
        var s1 = Math.max(pdfReadScale(c.base, pitch, c.s0), c.s0);
        line.textContent = 'Drawing chart page ' + c.n + ' (' + i2 + ' of ' + list.length + ')…';
        return handle.renderPage(c.n, { scale: s1, signal: stop }).then(function (cv) {
          canvases.push(cv);
          return drawNext();
        });
      }
      return drawNext().then(function () {
        if (stop.cancelled) { finish(el('p', 'muted', 'Stopped. Nothing was changed.')); return; }
        line.textContent = 'Joining ' + plural(canvases.length, 'page') + '…';
        return Promise.resolve(window.XSRead.readTiles(canvases, { key: entries, size: declared })).then(function (tr) {
          var out = el('div');
          if (!tr || !tr.ok) {
            out.appendChild(el('p', null, (tr && tr.message) || 'The pages could not be joined.'));
            out.appendChild(el('p', 'muted', 'Nothing was changed. A picture of the whole design can be read instead.'));
            finish(out);
            fb('alert');
            return;
          }
          out.appendChild(el('p', 'xs-beta-ok', 'Joined ' + plural(tr.tiles.length, 'page') + ' as ' + tr.layout.cols +
            ' across × ' + tr.layout.rows + ' down: ' + tr.size.w + ' × ' + tr.size.h + ' squares. Is this the layout?'));
          /* xs-audit: the PDF's own design size is a check too (the first real
             join, a 5-page sampler, made 178 × 238 of a stated 138 × 172) */
          var sizeOff = !!(declared && tr.size && (tr.size.w !== declared.w || tr.size.h !== declared.h));
          if (sizeOff) {
            out.appendChild(el('p', 'xs-size-doubt', 'The PDF says the design is ' + declared.w + ' × ' + declared.h +
              ' stitches, but the joined pages make ' + tr.size.w + ' × ' + tr.size.h + '. The layout, or where a page’s ' +
              'chart starts and ends, is probably wrong.'));
          }
          function pageNo(i) { return list[i] && list[i].n ? list[i].n : i + 1; }
          var sl = el('ul', 'xs-tile-seams');
          (tr.seams || []).forEach(function (s) {
            sl.appendChild(el('li', s.ok === false ? 'is-off' : null, 'Pages ' + pageNo(s.a) + ' and ' + pageNo(s.b) +
              (s.axis === 'x' ? ' (side by side)' : ' (one above the other)') + ': ' +
              (s.cells ? Math.round((s.agree || 0) * 100) + '% of ' + comma(s.cells) + ' overlapping squares agree'
                : (s.overlap ? 'overlap not checked' : 'they meet edge to edge')) + (s.ok === false ? ' ≠' : '')));
          });
          out.appendChild(sl);
          var chk = tr.check || null;
          var cc = chk && C.check && C.check.fromXStitch ? C.check.fromXStitch(chk) : null;
          if (cc && C.check.line) out.appendChild(C.check.line(cc, { onOpen: function () { C.check.open(cc, {}); } }));
          var seamOff = (tr.seams || []).some(function (s) { return s.ok === false; });
          var off = seamOff || sizeOff || (cc && cc.verdict === 'off');
          var use = button('btn primary block', off ? 'Use it anyway…' : 'Use this chart');
          if (cc && C.check.demote) C.check.demote(use, seamOff || sizeOff ? { verdict: 'off', summary: seamOff ? 'A seam between pages disagrees.' : 'The joined size is not the size the PDF states.', rows: [] } : cc);
          if (off) use.classList.remove('primary');
          on(use, 'click', function () {
            var go = function () {
              applyRead(projectId, tr, { src: { name: 'Pages joined', blob: null, pdf: { handle: handle, key: key, progressLine: progressLine } },
                o: { key: entries, size: tr.size, fabric: 'auto', mode: 'auto', assign: {} }, renames: {}, typed: {},
                check: chk, keyMeta: keyMeta, data: tr.data });
            };
            if (!off) { go(); return; }
            C.confirmSheet({ title: 'Use it with parts that disagree?',
              message: ((cc && cc.summary) || '') + (seamOff ? ' A seam between pages disagrees.' : '') +
                (sizeOff ? ' The joined size is not the size the PDF states.' : '') +
                ' The joined chart may be wrong there.', confirmText: 'Use it anyway', cancelText: 'Go back' })
              .then(function (ok) { if (ok) go(); });
          });
          out.appendChild(use);
          finish(out);
          fb(off ? 'alert' : 'done');
        });
      }, function (err) {
        finish(el('p', 'muted', err && err.name === 'AbortError' ? 'Stopped. Nothing was changed.' : 'A page could not be drawn. Nothing was changed.'));
      });
    }

    return chain.then(function () {
      if (stop.cancelled) { finish(el('p', 'muted', 'Stopped. Nothing was changed.')); return; }
      var pick = pickPdfPage(cands, declared);
      if (!pick.best) {
        var why = el('div');
        var tooSmall = cands.filter(function (c) { return c.det && c.det.reason === 'too-small'; })[0];
        why.appendChild(el('p', null, 'Could not find a chart grid on ' +
          (total === 1 ? 'the page' : 'any of the first ' + total + ' pages') + '.'));
        why.appendChild(el('p', 'muted', tooSmall && tooSmall.det.message
          ? tooSmall.det.message
          : 'If the chart is a photo or a scan of paper, it cannot be read yet. A screenshot of the ' +
            'chart, zoomed in, can be: use “Read a picture of a chart”.'));
        finish(why);
        fb('alert');
        return;
      }
      if (declared && !pick.match) {
        var b = pick.tile || pick.best;
        var box2 = el('div');
        if (pick.tile) {
          box2.appendChild(el('p', null, 'Each chart page here seems to hold only part of the design ' +
            '(page ' + b.n + ' shows about ' + b.det.size.w + ' × ' + b.det.size.h + ' of the ' +
            declared.w + ' × ' + declared.h + ' squares).'));
          if (window.XSRead && typeof window.XSRead.readTiles === 'function') {
            box2.appendChild(el('p', 'muted', 'The pages can be read one by one and joined into one chart. ' +
              'This is new and has only been tried on made-up charts, so look closely at the check.'));
            var joinBtn = button('btn ghost block', 'Join the chart pages (new)');
            on(joinBtn, 'click', function () {
              joinBtn.disabled = true;
              clear(box);
              box.appendChild(line);
              readPdfTiles(tilePages(cands, b));
            });
            box2.appendChild(joinBtn);
          } else {
            box2.appendChild(el('p', 'muted', 'Reading a chart split across several pages is not something ' +
              'this can do yet, and one piece is not the whole chart. A picture of the whole design works.'));
          }
        } else {
          box2.appendChild(el('p', null, 'The grid on page ' + b.n + ' looks like ' + b.det.size.w + ' × ' +
            b.det.size.h + ' squares, but the PDF says ' + declared.w + ' × ' + declared.h + '.'));
        }
        var anyway = button('btn ghost block', 'Read page ' + b.n + ' as ' + declared.w + ' × ' + declared.h + ' anyway');
        on(anyway, 'click', function () {
          anyway.disabled = true;
          clear(box);
          box.appendChild(line);
          proceed(b, declared);
        });
        box2.appendChild(anyway);
        var counted = entries.some(function (e) { return e.stitchCount > 0; });
        box2.appendChild(el('p', 'muted xs-import-note', counted
          ? 'The check against the key’s stitch counts will say plainly whether that worked.'
          : (entries.length ? 'This key has no stitch counts' : 'No colour key was found') +
            ' to check the read against, so look closely at what was read.'));
        finish(box2);
        return;
      }
      return proceed(pick.best, null);
    });
  }

  /* ---- the review: Read a chart picture -------------------------------- */

  /** Theme colours for the review canvas, read once per sheet. */
  function readColours() {
    var cs = null;
    try { cs = window.getComputedStyle(document.documentElement); } catch (e) { cs = null; }
    function v(name, dflt) {
      if (!cs) return dflt;
      var s = C && C.cssVar ? C.cssVar(cs, name, dflt) : (cs.getPropertyValue(name) || '').trim();
      return s || dflt;
    }
    return { bg: v('--surface-2', '#eeeeee'), line: v('--primary', '#d23c3c'), warn: v('--danger', '#c0392b'), text: v('--text', '#222') };
  }

  /**
   * src = { blob, canvas?, name, key: KeyEntry[]|null, keyMeta, keyFrom,
   *         size: {w,h}|null, saved: stored options|null, pdf: {...}|null }
   */
  function openReadSheet(projectId, src) {
    if (!readerAvailable()) { toast('Reading a chart picture is not available on this device'); return; }
    var R = window.XSRead;
    if (!Store.project(projectId) || !src || !(src.blob || src.canvas)) return;
    var saved = isObj(src.saved) ? src.saved : {};
    var keyMeta = src.keyMeta || {};
    var o = {
      crop: saved.crop || null,
      size: saved.size || src.size || null,
      lattice: saved.lattice || null,
      key: src.key && src.key.length ? src.key.map(copyEntry) : null,
      fabric: typeof saved.fabric === 'string' ? saved.fabric : 'auto',
      mode: saved.mode === 'colour' || saved.mode === 'symbol' ? saved.mode : 'auto',
      maxColors: null,   // wave K: XSRead 2 decides by evidence (up to 256 flat colours)
      assign: isObj(saved.assign) ? JSON.parse(JSON.stringify(saved.assign)) : {}
    };
    var projectKeyEntries = src.keyFrom === 'project' && o.key ? o.key.slice() : null;
    var renames = isObj(saved.renames) ? JSON.parse(JSON.stringify(saved.renames)) : {};
    var typed = isObj(saved.typed) ? JSON.parse(JSON.stringify(saved.typed)) : {};
    var LOW = typeof R.LOW_CONF === 'number' ? R.LOW_CONF : LOW_CONF_DEFAULT;

    var res = null, lastGood = null, token = null, timer = null, closed = false;
    var resCounts = null, palSig = '';
    var pic = null, picW = 0, picH = 0, picUrl = null;
    var show = 'picture', pickFabric = false;
    var cols = readColours();
    var api = null;
    var n = {};
    var vs = { z: 1, ox: 0, oy: 0, laidOut: false, cw: 0, ch: 0 };
    var pending = false, previewOff = null, previewFor = null;

    function hasKey() { return !!(o.key && o.key.length); }

    /* -- the picture, decoded once for drawing -- */
    function decode() {
      if (src.canvas) {
        pic = src.canvas; picW = src.canvas.width; picH = src.canvas.height;
        invalidate();
        return;
      }
      var done = function (img, w, h) {
        if (closed) return;
        pic = img; picW = w; picH = h;
        vs.laidOut = false;
        invalidate();
      };
      if (typeof window.createImageBitmap === 'function') {
        window.createImageBitmap(src.blob).then(function (bm) { done(bm, bm.width, bm.height); }, viaImage);
      } else {
        viaImage();
      }
      function viaImage() {
        picUrl = URL.createObjectURL(src.blob);
        var im = new Image();
        im.onload = function () { done(im, im.naturalWidth, im.naturalHeight); };
        im.onerror = function () { setStatus('That picture could not be opened.', 'bad'); };
        im.src = picUrl;
      }
    }

    /* -- the canvas view: the picture with the grid over it, or the read -- */
    function invalidate() {
      if (pending || closed) return;
      pending = true;
      window.requestAnimationFrame(function () { pending = false; draw(); });
    }

    function fitView(w, h) {
      if (!picW || !picH) return;
      var fr = focusRect();
      vs.z = Math.min(w / fr.w, h / fr.h) * 0.98;
      vs.ox = (w - fr.w * vs.z) / 2 - fr.x * vs.z;
      vs.oy = (h - fr.h * vs.z) / 2 - fr.y * vs.z;
      vs.laidOut = true;
      vs.user = false;
      vs.cw = w; vs.ch = h;
    }

    /** What Fit frames: the chart found (or the crop), else the whole picture. */
    function focusRect() {
      var r = res || lastGood;
      if (r && r.crop && r.crop.w > 0) return r.crop;
      if (o.crop) return o.crop;
      return { x: 0, y: 0, w: picW, h: picH };
    }

    function lattice() {
      if (o.lattice) return o.lattice;
      var r = res || lastGood;
      return r && r.lattice ? r.lattice : null;
    }

    function gridSize() {
      var r = res || lastGood;
      if (r && r.size) return r.size;
      return o.size;
    }

    function previewCanvas() {
      if (!res || !res.preview) return null;
      if (previewFor === res) return previewOff;
      var pv = res.preview;
      var c = document.createElement('canvas');
      c.width = pv.w; c.height = pv.h;
      try {
        var id = new ImageData(new Uint8ClampedArray(pv.data), pv.w, pv.h);
        c.getContext('2d').putImageData(id, 0, 0);
      } catch (e) { return null; }
      previewOff = c; previewFor = res;
      return c;
    }

    function draw() {
      if (closed || !n.canvas) return;
      var cv = n.canvas;
      var r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var pw = Math.round(r.width * dpr), ph = Math.round(r.height * dpr);
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
      if (!vs.laidOut || vs.cw !== r.width || vs.ch !== r.height) fitView(r.width, r.height);
      var g = cv.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = cols.bg;
      g.fillRect(0, 0, r.width, r.height);
      if (!pic) return;
      var z = vs.z;
      var lat = lattice(), size = gridSize();
      var reading = show === 'read' && res && res.ok && lat && size;
      g.imageSmoothingEnabled = z < 1;
      g.globalAlpha = reading ? 0.22 : 1;
      g.drawImage(pic, 0, 0, picW, picH, vs.ox, vs.oy, picW * z, picH * z);
      g.globalAlpha = 1;
      if (reading) {
        var pc = previewCanvas();
        if (pc) {
          g.imageSmoothingEnabled = false;
          g.drawImage(pc, 0, 0, pc.width, pc.height,
            vs.ox + lat.x0 * z, vs.oy + lat.y0 * z, size.w * lat.pitchX * z, size.h * lat.pitchY * z);
        }
        drawUnsure(g, r, lat, size);
      } else if (lat && size) {
        drawGridOver(g, r, lat, size);
      }
    }

    function drawGridOver(g, r, lat, size) {
      var z = vs.z;
      var cellPx = Math.min(lat.pitchX, lat.pitchY) * z;
      var x0 = vs.ox + lat.x0 * z, y0 = vs.oy + lat.y0 * z;
      var W = size.w * lat.pitchX * z, H = size.h * lat.pitchY * z;
      var i, p;
      g.save();
      if (cellPx >= 4) {
        g.globalAlpha = 0.55;
        g.strokeStyle = cols.line;
        g.lineWidth = 1;
        g.beginPath();
        for (i = 1; i < size.w; i++) {
          if (i % 10 === 0) continue;
          p = Math.round(x0 + i * lat.pitchX * z) + 0.5;
          if (p < 0 || p > r.width) continue;
          g.moveTo(p, Math.max(0, y0)); g.lineTo(p, Math.min(r.height, y0 + H));
        }
        for (i = 1; i < size.h; i++) {
          if (i % 10 === 0) continue;
          p = Math.round(y0 + i * lat.pitchY * z) + 0.5;
          if (p < 0 || p > r.height) continue;
          g.moveTo(Math.max(0, x0), p); g.lineTo(Math.min(r.width, x0 + W), p);
        }
        g.stroke();
      }
      /* the 10-lines and the outline, with a pale halo so they read on any picture */
      g.globalAlpha = 1;
      function majors(count) {
        var a = [];
        for (var m = 0; m < count; m += 10) a.push(m);
        a.push(count);
        return a;
      }
      var mx = majors(size.w), my = majors(size.h);
      [['rgba(255,255,255,0.85)', 3], [cols.line, 1.5]].forEach(function (pass) {
        g.strokeStyle = pass[0];
        g.lineWidth = pass[1];
        g.beginPath();
        mx.forEach(function (c) { var q = x0 + c * lat.pitchX * z; g.moveTo(q, y0); g.lineTo(q, y0 + H); });
        my.forEach(function (c) { var q = y0 + c * lat.pitchY * z; g.moveTo(x0, q); g.lineTo(x0 + W, q); });
        g.stroke();
      });
      g.restore();
    }

    function drawUnsure(g, r, lat, size) {
      if (!res || !res.cellConf || !res.lowCells) return;
      var z = vs.z, conf = res.cellConf;
      var cw = lat.pitchX * z, chh = lat.pitchY * z;
      var x0 = vs.ox + lat.x0 * z, y0 = vs.oy + lat.y0 * z;
      var cx0 = Math.max(0, Math.floor(-x0 / cw)), cx1 = Math.min(size.w, Math.ceil((r.width - x0) / cw));
      var cy0 = Math.max(0, Math.floor(-y0 / chh)), cy1 = Math.min(size.h, Math.ceil((r.height - y0) / chh));
      g.save();
      g.strokeStyle = cols.warn;
      g.fillStyle = cols.warn;
      g.lineWidth = cw >= 6 ? 2 : 1;
      for (var y = cy0; y < cy1; y++) {
        for (var x = cx0; x < cx1; x++) {
          if (conf[y * size.w + x] >= LOW) continue;
          var px = x0 + x * cw, py = y0 + y * chh;
          if (cw >= 4) g.strokeRect(px + 1, py + 1, Math.max(1, cw - 2), Math.max(1, chh - 2));
          else g.fillRect(px, py, Math.max(1.5, cw), Math.max(1.5, chh));
        }
      }
      g.restore();
    }

    /* pan / pinch / wheel / double-tap, and the fabric pick */
    var ptrs = {}, pinch = null, lastTap = 0;
    function ptrList() { var a = []; for (var k in ptrs) a.push(ptrs[k]); return a; }
    function bindView(cv) {
      on(cv, 'pointerdown', function (e) {
        ptrs[e.pointerId] = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        var l = ptrList();
        if (l.length === 2) {
          var dx = l[0].x - l[1].x, dy = l[0].y - l[1].y, rr = cv.getBoundingClientRect();
          var mx = (l[0].x + l[1].x) / 2 - rr.left, my = (l[0].y + l[1].y) / 2 - rr.top;
          pinch = { d: Math.max(1, Math.sqrt(dx * dx + dy * dy)), z: vs.z, mx: mx, my: my,
            cx: (mx - vs.ox) / vs.z, cy: (my - vs.oy) / vs.z };
        }
        e.preventDefault();
      });
      on(cv, 'pointermove', function (e) {
        var p = ptrs[e.pointerId];
        if (!p) return;
        var dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        if (Math.abs(p.x - p.sx) > 4 || Math.abs(p.y - p.sy) > 4) p.moved = true;
        var l = ptrList();
        if (l.length === 2 && pinch) {
          var ddx = l[0].x - l[1].x, ddy = l[0].y - l[1].y;
          var d = Math.max(1, Math.sqrt(ddx * ddx + ddy * ddy));
          vs.z = Math.max(0.02, Math.min(40, pinch.z * d / pinch.d));
          vs.ox = pinch.mx - pinch.cx * vs.z;
          vs.oy = pinch.my - pinch.cy * vs.z;
          vs.user = true;
        } else {
          vs.ox += dx; vs.oy += dy;
          if (p.moved) vs.user = true;
        }
        invalidate();
        e.preventDefault();
      });
      function up(e) {
        var p = ptrs[e.pointerId];
        delete ptrs[e.pointerId];
        if (ptrList().length < 2) pinch = null;
        if (!p || p.moved) return;
        if (pickFabric) { sampleFabric(e.clientX, e.clientY); return; }
        var now = Date.now();
        if (now - lastTap < 320) { lastTap = 0; vs.laidOut = false; invalidate(); return; }
        lastTap = now;
      }
      on(cv, 'pointerup', up);
      on(cv, 'pointercancel', up);
      on(cv, 'wheel', function (e) {
        e.preventDefault();
        var rr = cv.getBoundingClientRect();
        var mx = e.clientX - rr.left, my = e.clientY - rr.top;
        var cx = (mx - vs.ox) / vs.z, cy = (my - vs.oy) / vs.z;
        vs.z = Math.max(0.02, Math.min(40, vs.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        vs.ox = mx - cx * vs.z; vs.oy = my - cy * vs.z;
        vs.user = true;
        invalidate();
      });
      cv.tabIndex = 0;
      on(cv, 'keydown', function (e) {
        var k = e.key, step = 40;
        if (k === '+' || k === '=') zoomBy(1.3);
        else if (k === '-' || k === '_') zoomBy(1 / 1.3);
        else if (k === '0') { vs.laidOut = false; invalidate(); }
        else if (k === 'ArrowLeft') { vs.ox += step; invalidate(); }
        else if (k === 'ArrowRight') { vs.ox -= step; invalidate(); }
        else if (k === 'ArrowUp') { vs.oy += step; invalidate(); }
        else if (k === 'ArrowDown') { vs.oy -= step; invalidate(); }
        else return;
        e.preventDefault();
      });
    }

    /** "Show them": the next unsure square, centred and big enough to see. */
    var unsureAt = -1;
    function focusUnsure() {
      var lat = lattice(), size = gridSize();
      if (!res || !res.cellConf || !lat || !size) return;
      var conf = res.cellConf, n0 = conf.length;
      for (var k = 1; k <= n0; k++) {
        var i = (unsureAt + k) % n0;
        if (conf[i] < LOW) { unsureAt = i; break; }
      }
      if (unsureAt < 0) return;
      var x = unsureAt % size.w, y = Math.floor(unsureAt / size.w);
      vs.z = Math.max(vs.z, 18 / Math.min(lat.pitchX, lat.pitchY));
      vs.ox = vs.cw / 2 - (lat.x0 + (x + 0.5) * lat.pitchX) * vs.z;
      vs.oy = vs.ch / 2 - (lat.y0 + (y + 0.5) * lat.pitchY) * vs.z;
      vs.user = true;
      invalidate();
      setStatus('Unsure square at column ' + (x + 1) + ', row ' + (y + 1) + '. “Show them” again for the next one.', 'busy');
      try { n.canvas.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
    }

    function zoomBy(f) {
      var cw = vs.cw / 2, ch = vs.ch / 2;
      var cx = (cw - vs.ox) / vs.z, cy = (ch - vs.oy) / vs.z;
      vs.z = Math.max(0.02, Math.min(40, vs.z * f));
      vs.ox = cw - cx * vs.z; vs.oy = ch - cy * vs.z;
      vs.user = true;
      invalidate();
    }

    function sampleFabric(clientX, clientY) {
      var rr = n.canvas.getBoundingClientRect();
      var sx = Math.floor((clientX - rr.left - vs.ox) / vs.z), sy = Math.floor((clientY - rr.top - vs.oy) / vs.z);
      if (!pic || sx < 0 || sy < 0 || sx >= picW || sy >= picH) { toast('Tap on the picture'); return; }
      var c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      var hex = null;
      try {
        var g = c.getContext('2d');
        g.drawImage(pic, sx, sy, 1, 1, 0, 0, 1, 1);
        var d = g.getImageData(0, 0, 1, 1).data;
        hex = '#' + [d[0], d[1], d[2]].map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join('');
      } catch (e) { hex = null; }
      pickFabric = false;
      n.canvas.classList.remove('picking');
      if (!hex) { toast('That colour could not be read'); return; }
      o.fabric = hex;
      syncFabric();
      setStatus('Fabric set to the colour you tapped. Reading again…', 'busy');
      schedule(0);
    }

    /* -- reading -- */
    function setStatus(text, kind) {
      if (!n.status) return;
      n.status.textContent = text;
      n.status.className = 'xs-read-status' + (kind ? ' is-' + kind : '');
    }

    function schedule(ms) {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(run, typeof ms === 'number' ? ms : 300);
    }

    function readOpts(tok) {
      return {
        crop: o.crop, size: o.size, lattice: o.lattice, key: hasKey() ? o.key : null,
        fabric: o.fabric, mode: o.mode, maxColors: o.maxColors,
        assign: Object.keys(o.assign).length ? o.assign : null, token: tok
      };
    }

    function run() {
      timer = null;
      if (closed) return;
      /* one reader worker: the run in flight goes first */
      if (token) { try { R.cancel(token); } catch (e) { /* ignore */ } }
      readSeq += 1;
      var mine = 'xsread-' + readSeq;
      token = mine;
      setStatus('Reading…', 'busy');
      setUse(false);
      var pr;
      try {
        pr = R.read(src.canvas || src.blob, readOpts(mine), function (p) {
          if (token !== mine || !p) return;
          var phase = p.phase ? String(p.phase) : '';
          var pct = typeof p.pct === 'number' ? ' ' + Math.round(p.pct) + '%' : '';
          setStatus('Reading… ' + phase + pct, 'busy');
        });
      } catch (e) {
        pr = Promise.resolve({ ok: false, reason: 'no-image', message: 'That picture could not be read.' });
      }
      Promise.resolve(pr).then(function (r) { return r; }, function () {
        return { ok: false, reason: 'no-image', message: 'That picture could not be read.' };
      }).then(function (r) {
        if (closed || token !== mine) return;          // superseded or closed
        token = null;
        if (r && r.reason === 'cancelled') return;
        adopt(r || { ok: false, reason: 'no-grid', message: '' });
      });
    }

    function adopt(r) {
      res = r;
      if (r.ok) {
        lastGood = r;
        var counts = null;
        try {
          var cells = X.unpackCells(r.data.chart.cells);
          counts = new Array(r.data.palette.length);
          for (var k = 0; k < counts.length; k++) counts[k] = 0;
          for (var i = 0; i < cells.length; i++) if (cells[i] >= 0 && cells[i] < counts.length) counts[cells[i]]++;
        } catch (e) { counts = null; }
        resCounts = counts;
        var sig = r.data.palette.map(function (e) { return e.code; }).join(',');
        if (sig !== palSig && palSig) {
          /* a different palette: per-colour fixes made for the old one would land on the wrong colours */
          if (!hasKey()) { renames = {}; typed = {}; }
        }
        palSig = sig;
        if (!o.size) syncSizeInputs(r.size);
        else syncSizeInputs(o.size);
        if (!vs.user) vs.laidOut = false;      /* frame the chart that was found, until the stitcher zooms */
      }
      renderResult();
      invalidate();
    }

    /* -- results -- */
    function entriesForCheck() {
      if (hasKey()) {
        return o.key.map(function (e, i) {
          var c = copyEntry(e);
          if (!c.stitchCount && typed['k' + i] > 0) c.stitchCount = typed['k' + i];
          return c;
        });
      }
      var pal = dataNow().palette;
      return pal.map(function (p, i) {
        /* a colour renamed to one already listed joins it: checkCounts adds
           a non-checked duplicate's squares to the first row with its code */
        var first = groupOf(pal, i) === i;
        return { brand: p.brand || 'DMC', code: p.code, name: p.name, hex: p.hex,
          stitchCount: first && typed['p' + i] > 0 ? typed['p' + i] : null, kind: first ? 'cross' : 'merged' };
      });
    }

    /** The first palette index with the same floss as entry i. */
    function groupOf(pal, i) {
      var k = codeKey(pal[i].brand, pal[i].code);
      for (var j = 0; j < i; j++) if (codeKey(pal[j].brand, pal[j].code) === k) return j;
      return i;
    }

    /** The read data with the stitcher's colour fixes (no-key path) applied. */
    function dataNow() {
      if (!res || !res.ok) return null;
      if (!Object.keys(renames).length) return res.data;
      var d = {};
      for (var k in res.data) d[k] = res.data[k];
      d.palette = res.data.palette.map(function (p, i) {
        var rn = renames['p' + i];
        if (!rn) return p;
        var q = {};
        for (var kk in p) q[kk] = p[kk];
        q.brand = rn.brand; q.code = rn.code; q.name = rn.name; q.hex = rn.hex;
        return q;
      });
      return d;
    }

    function checkNow() {
      if (!res || !res.ok) return null;
      var anyTyped = Object.keys(typed).some(function (k) { return typed[k] > 0; });
      var anyRename = Object.keys(renames).length > 0;
      if ((anyTyped || anyRename) && typeof X.checkCounts === 'function') {
        try {
          var c = X.checkCounts(dataNow(), entriesForCheck());
          if (c && c.verdict) return c;
        } catch (e) { /* fall back to the reader's own */ }
      }
      return res.check || null;
    }

    function renderResult() {
      clear(n.results);
      var r = res;
      if (!r) return;
      if (!r.ok) {
        var msg = r.message || 'Could not find a grid in this picture.';
        setStatus(msg, 'bad');
        var help = el('div', 'xs-read-fail');
        help.appendChild(el('p', null, r.reason === 'no-grid' || r.reason === 'not-a-chart'
          ? 'Could not find a grid: try a bigger picture, crop it to the chart, or type the size in stitches under “Adjust”.'
          : r.reason === 'too-small'
            ? 'The squares are too small to read. Try a bigger picture, or zoom in before taking the screenshot.'
            : r.reason === 'too-many-colors'
              ? 'If this is a chart, crop the picture to just the chart (Adjust the read → Crop to the chart): ' +
                'a photo or a printed key beside it adds colours a chart does not have.'
              : 'Try a bigger picture, or type the size in stitches under “Adjust”.'));
        n.results.appendChild(help);
        if (r.reason === 'looks-like-a-key' && keyReadAvailable()) {
          help.firstChild.textContent = 'This looks like a colour key, not a chart.';
          var kb = button('btn primary block', 'Read it as a colour key');
          on(kb, 'click', function () {
            var b2 = src.blob;
            api.close();
            openKeyReadSheet(projectId, { blob: b2, name: src.name, crop: o.crop || null });
          });
          help.appendChild(kb);
        }
        if (n.adjust) n.adjust.open = true;
        if (n.cropDetails && (r.reason === 'too-many-colors' || r.reason === 'not-a-chart')) n.cropDetails.open = true;
        fb('alert');
        setUse(false);
        return;
      }
      var chk = checkNow();
      var d = dataNow();
      var bits = [r.size.w + ' × ' + r.size.h + ' squares',
        plural(d.palette.length, 'colour'), comma(chk && chk.readTotal ? chk.readTotal : countAll()) + ' stitches'];
      setStatus('Read ' + bits.join(' · ') + '.', 'ok');

      var verdict = el('p', 'xs-verdict xs-verdict-' + (chk ? chk.verdict : 'unchecked'));
      verdict.setAttribute('role', 'status');
      verdict.textContent = chk && chk.summary ? chk.summary
        : 'The key gave no stitch counts, so this read cannot be checked. Type the counts from the key below if you have them.';
      n.results.appendChild(verdict);
      /* wave K (xs-read 2): a size the lattice's own evidence doubts is said
         plainly, with the reasons, and the size steppers opened to correct it */
      if (r.sizeVerdict === 'doubtful') {
        var dz = el('div', 'xs-size-doubt');
        dz.setAttribute('role', 'note');
        dz.appendChild(el('p', null, 'The size ' + r.size.w + ' × ' + r.size.h + ' may be wrong. If your chart says ' +
          'another size, type it under “Adjust the read”.'));
        (r.sizeEvidence || []).forEach(function (ev) {
          if (ev && ev.ok === false && ev.detail) dz.appendChild(el('p', 'muted xs-read-note', ev.detail));
        });
        n.results.appendChild(dz);
        if (n.adjust) n.adjust.open = true;
      }
      if (r.region && Array.isArray(r.regions) && r.regions.length > 1) {
        var left = r.regions.filter(function (g) { return !g.chosen && g.kind !== 'other'; })
          .map(function (g) { return g.label; });
        if (left.length) {
          n.results.appendChild(el('p', 'muted xs-read-note', 'Read the chart part of the picture; left out: ' +
            left.filter(function (v, i) { return left.indexOf(v) === i; }).join(', ') + '.'));
        }
        /* xs-audit (R1 + R2): the picture holds its own colour key and no key
           is in hand: read that key (the key reader, cropped to the region the
           segmenter found), then come back and read the chart against it. */
        var keyReg = r.regions.filter(function (g) { return g.kind === 'key' && g.box; })[0];
        if (keyReg && !hasKey() && keyReadAvailable() && (src.blob || src.canvas)) {
          var kb = button('btn ghost block xs-read-keyhere', '🔑 Read the colour key in this picture');
          on(kb, 'click', function () {
            var go = function (blob) {
              if (!blob) { toast('The picture could not be passed to the key reader'); return; }
              closed = true;
              C.closeAllSheets();
              openKeyReadSheet(projectId, { blob: blob, name: src.name || 'Chart picture', crop: keyReg.box,
                reread: { blob: blob, name: src.name || 'Chart picture', size: o.size } });
            };
            if (src.blob) go(src.blob);
            else canvasBlob(src.canvas, 'image/png').then(go, function () { go(null); });
          });
          n.results.appendChild(kb);
        }
      }
      if (chk && chk.verdict === 'unchecked' && chk.summary) {
        n.results.appendChild(el('p', 'muted xs-read-note',
          'Type the stitch counts from the key into the table to check the read.'));
      }

      var unsure = el('p', 'xs-unsure' + (r.lowCells ? ' has-unsure' : ''), unsureText(r.lowCells || 0));
      if (r.lowCells) {
        var seeIt = button('linkish', 'Show them');
        on(seeIt, 'click', function () { setShow('read'); focusUnsure(); });
        unsure.appendChild(document.createTextNode(' '));
        unsure.appendChild(seeIt);
      }
      n.results.appendChild(unsure);

      n.results.appendChild(countTable(chk, d));
      var un = unmatchedList();
      if (un) n.results.appendChild(un);

      var warn = (r.stats && r.stats.warnings) || [];
      if (warn.length) n.results.appendChild(warningList('Notes from the reader', warn.slice(0, 5), true));
      setUse(true);
      /* wave K: an "off" check demotes "Use this chart" (it still confirms first) */
      if (n.useBtn && C.check && typeof C.check.demote === 'function' && typeof C.check.fromXStitch === 'function') {
        try {
          var cc = C.check.fromXStitch(chk || { verdict: 'unchecked', rows: [] });
          if (!n.demoter) n.demoter = C.check.demote(n.useBtn, cc);
          else if (n.demoter.set) n.demoter.set(cc);
        } catch (e) { /* ignore */ }
      }
      if (chk && (chk.verdict === 'exact' || chk.verdict === 'close')) fb('done');
    }

    function countAll() {
      if (!resCounts) return 0;
      var t = 0;
      for (var i = 0; i < resCounts.length; i++) t += resCounts[i];
      return t;
    }

    function swatch(hex, symbol) {
      var sw = el('span', 'xs-swatch xs-swatch-sm', symbol || '');
      var h = String(hex || '').replace('#', '');
      sw.style.background = h ? '#' + h : 'transparent';
      if (h) sw.style.color = X.symbolInk(h) === 'light' ? '#fff' : '#111';
      return sw;
    }

    function countInput(keyName, label) {
      var inp = C.numInput(typed[keyName] || '', 0, 1e7, 'type it');
      inp.className = (inp.className ? inp.className + ' ' : '') + 'xs-count-in';
      inp.setAttribute('aria-label', 'Stitches the key prints for ' + label);
      on(inp, 'change', function () {
        typed[keyName] = clampInt(inp.value, 0, 1e7, 0);
        renderResult();
      });
      return inp;
    }

    function countTable(chk, d) {
      var wrap = el('div', 'xs-count-wrap');
      var t = el('table', 'xs-count-table');
      var cap = el('caption', 'sr-only', 'Stitches read for each colour, against the key');
      t.appendChild(cap);
      var thead = el('thead');
      var hr = el('tr');
      ['Colour', 'Read', 'Key', ''].forEach(function (h, i) {
        var th = el('th', i === 1 || i === 2 ? 'num' : null, h);
        th.setAttribute('scope', 'col');
        if (i === 3) th.appendChild(el('span', 'sr-only', 'Match'));
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      t.appendChild(thead);
      var tb = el('tbody');

      function row(hex, symbol, label, read, expected, inputKey, okState, extra) {
        var tr = el('tr', okState === true ? 'ok' : okState === false ? 'off' : null);
        var c1 = el('th', 'xs-count-name');
        c1.setAttribute('scope', 'row');
        c1.appendChild(swatch(hex, symbol));
        var nm = el('span', 'xs-count-label', label);
        c1.appendChild(nm);
        if (extra) c1.appendChild(extra);
        tr.appendChild(c1);
        tr.appendChild(el('td', 'num', comma(read)));
        var c3 = el('td', 'num');
        /* a count the stitcher typed stays editable */
        if (inputKey) c3.appendChild(countInput(inputKey, label));
        else if (expected !== null && expected !== undefined) c3.textContent = comma(expected);
        else c3.textContent = '—';
        tr.appendChild(c3);
        var c4 = el('td', 'xs-count-mark');
        if (okState === true) {
          var near = read - expected;
          c4.appendChild(el('span', 'xs-mark-ok', '✓'));
          if (near) {
            /* within a stitch or two: still say by how much */
            c4.appendChild(el('span', 'xs-mark-near', ' ' + (near > 0 ? '+' : '−') + comma(Math.abs(near))));
            c4.appendChild(el('span', 'sr-only', 'close: ' + comma(Math.abs(near)) + (near > 0 ? ' too many' : ' too few')));
          } else {
            c4.appendChild(el('span', 'sr-only', 'matches'));
          }
        } else if (okState === false) {
          var diff = read - expected;
          c4.textContent = (diff > 0 ? '+' : '−') + comma(Math.abs(diff));
          c4.setAttribute('aria-label', comma(Math.abs(diff)) + (diff > 0 ? ' too many' : ' too few'));
        }
        tr.appendChild(c4);
        tb.appendChild(tr);
      }

      if (hasKey() && chk && Array.isArray(chk.rows)) {
        chk.rows.forEach(function (cr) {
          var label = (cr.brand ? cr.brand + ' ' : '') + cr.code + (cr.name ? ' · ' + cr.name : '');
          var hasExp = cr.expected !== null && cr.expected !== undefined;
          var e = o.key[cr.entry] || {};
          /* ok is null when the key printed no count: unchecked, not wrong */
          var printed = hasExp && !(typed['k' + cr.entry] > 0);
          /* a key row with no printed count is claimed by colour only: say it
             is not checked, never a tick and never a mismatch */
          var unchecked = !hasExp && !(typed['k' + cr.entry] > 0)
            ? el('span', 'xs-count-sub xs-count-unchecked', 'not checked (no count printed)') : null;
          row(cr.hex || e.hex, e.symbol, label, cr.read || 0, hasExp ? cr.expected : null,
            printed ? null : 'k' + cr.entry, hasExp ? (cr.ok === true ? true : cr.ok === false ? false : null) : null, unchecked);
        });
      } else {
        /* the check entries are the palette itself, one to one by index */
        var byEntry = {};
        if (chk && Array.isArray(chk.rows)) chk.rows.forEach(function (cr) { byEntry[cr.entry] = cr; });
        d.palette.forEach(function (p, i) {
          var label = (p.brand ? p.brand + ' ' : '') + p.code + (p.name ? ' · ' + p.name : '');
          var first = groupOf(d.palette, i);
          var fix = button('linkish xs-fix', renames['p' + i] ? 'changed' : 'change', 'Change ' + label + ' to another DMC colour');
          on(fix, 'click', function () { openRename(i, p); });
          var extra = el('span', 'xs-count-sub', renames['p' + i] ? 'you chose this · ' : 'nearest DMC · ');
          extra.appendChild(fix);
          if (first !== i) {
            /* the same floss twice: one colour once the chart is used */
            extra.insertBefore(document.createTextNode('joins the row above with this number · '), extra.firstChild);
            row(p.hex, p.symbol, label, resCounts ? resCounts[i] : 0, null, null, null, extra);
            return;
          }
          var exp = typed['p' + i] > 0 ? typed['p' + i] : null;
          var rd = 0;
          for (var j = 0; j < d.palette.length; j++) if (resCounts && groupOf(d.palette, j) === i) rd += resCounts[j];
          var cr = byEntry[i];
          var ok = exp === null ? null : (cr && cr.ok !== null && cr.ok !== undefined ? cr.ok : Math.abs(rd - exp) <= Math.max(2, exp * 0.01));
          row(p.hex, p.symbol, label, rd, exp, 'p' + i, ok, extra);
        });
      }
      t.appendChild(tb);
      wrap.appendChild(t);
      if (chk && chk.unmatchedEntries && chk.unmatchedEntries.length && hasKey()) {
        wrap.appendChild(el('p', 'muted xs-read-note', plural(chk.unmatchedEntries.length, 'key colour') +
          ' had no squares in the picture.'));
      }
      return wrap;
    }

    /** No key: change a colour the reader named by nearest DMC. */
    function openRename(i, p) {
      C.openSheet({
        title: 'Which colour is this?',
        cls: 'sheet-xs-rename',
        build: function (body, sapi) {
          var row = el('div', 'xs-rename-head');
          row.appendChild(swatch(p.hex, p.symbol));
          row.appendChild(el('span', null, 'Read as ' + (p.brand || 'DMC') + ' ' + p.code + (p.name ? ' · ' + p.name : '') +
            (resCounts ? ' · ' + comma(resCounts[i]) + ' stitches' : '')));
          body.appendChild(row);
          var prev = swatch(null, '?');
          prev.classList.add('xs-swatch-big');
          var name = el('p', 'muted', 'Type the DMC number from the key.');
          var inp = C.textInput('', '310');
          inp.setAttribute('inputmode', 'text');
          var found = null;
          on(inp, 'input', function () {
            var code = inp.value.trim();
            var f = code ? X.flossFor('DMC', code) : null;
            found = f && f.hex ? { brand: 'DMC', code: f.code || code, name: f.name || '', hex: f.hex } : null;
            prev.style.background = found ? '#' + found.hex : 'transparent';
            prev.textContent = found ? '' : '?';
            name.textContent = found ? 'DMC ' + found.code + ' · ' + found.name : (code ? 'No DMC colour ' + code + ' here.' : 'Type the DMC number from the key.');
          });
          body.appendChild(prev);
          body.appendChild(field('DMC number', inp));
          body.appendChild(name);
          var use = button('btn primary block', 'Use this colour');
          on(use, 'click', function () {
            if (!found) { toast('Type a DMC number first'); return; }
            renames['p' + i] = found;
            sapi.close();
            renderResult();
          });
          body.appendChild(use);
          if (renames['p' + i]) {
            var back = button('btn ghost block', 'Go back to what was read');
            on(back, 'click', function () { delete renames['p' + i]; sapi.close(); renderResult(); });
            body.appendChild(back);
          }
          window.setTimeout(function () { try { inp.focus(); } catch (e) { /* ignore */ } }, 0);
        }
      });
    }

    function glyphCanvas(gl, hex) {
      if (!gl || !gl.w || !gl.h || !gl.data) return swatch(hex, '');
      var c = document.createElement('canvas');
      c.width = gl.w; c.height = gl.h;
      c.className = 'xs-glyph';
      c.setAttribute('aria-hidden', 'true');
      try { c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(gl.data), gl.w, gl.h), 0, 0); } catch (e) { return swatch(hex, ''); }
      return c;
    }

    /** Classes with no key colour (or that the stitcher assigned), each with a picker. */
    function unmatchedList() {
      if (!hasKey() || !res || !Array.isArray(res.classes)) return null;
      var list = res.classes.filter(function (c) {
        return (c.entry === null || c.entry === undefined || c.how === 'user') && !(c.fabric && c.how !== 'user');
      });
      if (!list.length) return null;
      var box = el('div', 'xs-unmatched');
      var open = list.filter(function (c) { return c.how !== 'user'; }).length;
      box.appendChild(el('h3', 'xs-h3', open
        ? (open === 1 ? 'One kind of square has no key colour' : open + ' kinds of square have no key colour')
        : 'Squares you matched by hand'));
      box.appendChild(el('p', 'muted xs-read-note', 'Say what each one is. Nothing is guessed.'));
      list.forEach(function (c) {
        var row = el('div', 'xs-um-row');
        row.appendChild(glyphCanvas(c.glyph, c.hex));
        var txt = el('span', 'xs-um-text');
        txt.appendChild(el('span', 'xs-um-n', comma(c.count) + (c.count === 1 ? ' square' : ' squares')));
        row.appendChild(txt);
        var sel = document.createElement('select');
        sel.className = 'xs-um-pick';
        sel.setAttribute('aria-label', 'What are these ' + comma(c.count) + ' squares?');
        function opt(v, label) { var op = document.createElement('option'); op.value = v; op.textContent = label; sel.appendChild(op); }
        opt('', 'Choose…');
        o.key.forEach(function (e, i) {
          opt('e' + i, (e.brand ? e.brand + ' ' : '') + e.code + (e.name ? ' · ' + e.name : '') +
            (e.stitchCount ? ' (' + comma(e.stitchCount) + ')' : ''));
        });
        opt('fabric', 'Fabric (not stitched)');
        opt('dmc', 'Another DMC colour…');
        var cur = o.assign[c.id];
        sel.value = cur === 'fabric' ? 'fabric' : (typeof cur === 'number' ? 'e' + cur : '');
        var extra = el('div', 'xs-um-dmc');
        extra.hidden = true;
        on(sel, 'change', function () {
          var v = sel.value;
          if (v === 'dmc') { extra.hidden = false; return; }
          extra.hidden = true;
          if (!v) delete o.assign[c.id];
          else o.assign[c.id] = v === 'fabric' ? 'fabric' : parseInt(v.slice(1), 10);
          schedule(0);
        });
        var inp = C.textInput('', 'DMC number');
        inp.setAttribute('aria-label', 'DMC number for these squares');
        var add = button('btn', 'Use');
        on(add, 'click', function () {
          var code = inp.value.trim();
          var f = code ? X.flossFor('DMC', code) : null;
          if (!f) { toast(code ? 'No DMC colour ' + code + ' here' : 'Type a DMC number'); return; }
          o.key.push({ symbol: '', brand: 'DMC', code: f.code || code, name: f.name || '', hex: f.hex || null,
            strands: null, stitchCount: null, skeins: null, kind: 'cross' });
          o.assign[c.id] = o.key.length - 1;
          schedule(0);
        });
        extra.appendChild(inp);
        extra.appendChild(add);
        row.appendChild(sel);
        box.appendChild(row);
        box.appendChild(extra);
      });
      return box;
    }

    /* -- controls -- */
    var wStep = null, hStep = null;
    function syncSizeInputs(s) {
      if (!s || !wStep) return;
      wStep.set(s.w);
      hStep.set(s.h);
      var r = res || lastGood;
      var how = o.size && src.size && sizeMatches(o.size, src.size) ? 'from the key'
        : o.size ? 'as you typed it' : r && r.sizeSource === 'detected' ? 'found in the picture' : '';
      if (n.sizeNote) n.sizeNote.textContent = how ? 'Size ' + how + '.' : '';
      syncLatticeNote();
    }

    function syncLatticeNote() {
      if (!n.latNote) return;
      var lat = lattice();
      n.latNote.textContent = lat
        ? 'Each square is ' + lat.pitchX.toFixed(2) + ' × ' + lat.pitchY.toFixed(2) + ' pixels' +
          (o.lattice ? ' (moved by you).' : '.')
        : '';
    }

    function sizeChanged() {
      var w = wStep.get(), h = hStep.get();
      if (o.size && o.size.w === w && o.size.h === h) return;
      o.size = { w: w, h: h };
      o.lattice = null;                // refit the grid to the new size
      syncSizeInputs(o.size);
      schedule();
    }

    function nudge(dx, dy, dp) {
      var lat = lattice();
      if (!lat) { toast('Nothing to move yet'); return; }
      var next = { x0: lat.x0, y0: lat.y0, pitchX: lat.pitchX, pitchY: lat.pitchY };
      next.x0 += dx * lat.pitchX / 8;
      next.y0 += dy * lat.pitchY / 8;
      if (dp) {
        next.pitchX *= 1 + dp * 0.002;
        next.pitchY *= 1 + dp * 0.002;
      }
      o.lattice = next;
      if (!o.size && (res || lastGood)) o.size = (res || lastGood).size;
      syncLatticeNote();
      invalidate();
      schedule();
    }

    function syncFabric() {
      if (!n.fabricNote) return;
      if (o.fabric === 'auto') n.fabricNote.textContent = 'The colour that fills the background is taken as unstitched fabric.';
      else if (o.fabric === 'none') n.fabricNote.textContent = 'Every square counts as a stitch.';
      else n.fabricNote.textContent = 'Fabric: the colour you tapped (' + o.fabric + ').';
      if (n.fabricSw) {
        n.fabricSw.hidden = !/^#/.test(o.fabric);
        n.fabricSw.style.background = /^#/.test(o.fabric) ? o.fabric : 'transparent';
      }
    }

    function setShow(v) {
      show = v;
      if (n.showSeg) n.showSeg.set(v);
      invalidate();
    }

    function setUse(ok) {
      if (!api) return;
      if (!n.useBtn) n.useBtn = api.dialog.querySelector('.sheet-foot .btn.primary');
      var b = n.useBtn;
      if (b) b.disabled = !ok;
    }

    function use() {
      if (!res || !res.ok || !res.data) { toast('Nothing has been read yet'); return; }
      var chk = checkNow();
      var go = function () {
        applyRead(projectId, res, {
          src: src, o: o, renames: renames, typed: typed, check: chk, keyMeta: keyMeta,
          data: dataNow(), statusTo: setStatus
        });
      };
      if (chk && chk.verdict === 'off') {
        C.confirmSheet({
          title: 'Use it with colours that are off?',
          message: (chk.summary || '') + ' The chart may be wrong where those colours are. You can come back ' +
            'to this check from the project.',
          confirmText: 'Use it anyway',
          cancelText: 'Keep checking'
        }).then(function (ok) { if (ok) go(); });
      } else {
        go();
      }
    }

    api = C.openSheet({
      title: 'Read a chart picture',
      cls: 'sheet-xs-read',
      build: function (body) {
        n.status = el('p', 'xs-read-status is-busy', 'Reading…');
        n.status.setAttribute('role', 'status');
        n.status.setAttribute('aria-live', 'polite');
        body.appendChild(n.status);

        n.showSeg = C.segmented([{ id: 'picture', label: 'The picture' }, { id: 'read', label: 'What was read' }],
          show, function (v) { show = v; invalidate(); });
        n.showSeg.node.classList.add('xs-read-seg');
        body.appendChild(n.showSeg.node);

        var frame = el('div', 'xs-read-frame');
        n.canvas = document.createElement('canvas');
        n.canvas.className = 'xs-read-canvas';
        n.canvas.setAttribute('role', 'img');
        n.canvas.setAttribute('aria-label', 'The picture with the grid that was found drawn over it. ' +
          'Drag to move, pinch or + and − to zoom, 0 to fit.');
        frame.appendChild(n.canvas);
        body.appendChild(frame);
        bindView(n.canvas);
        if (window.ResizeObserver) {
          n.ro = new window.ResizeObserver(function () { invalidate(); });
          n.ro.observe(n.canvas);
        }
        var zr = el('div', 'xs-zoom');
        var zo = button('btn ghost', '−', 'Zoom out');
        var zf = button('btn ghost', 'Fit');
        var zi = button('btn ghost', '+', 'Zoom in');
        on(zo, 'click', function () { zoomBy(1 / 1.4); });
        on(zf, 'click', function () { vs.laidOut = false; invalidate(); });
        on(zi, 'click', function () { zoomBy(1.4); });
        zr.appendChild(zo); zr.appendChild(zf); zr.appendChild(zi);
        body.appendChild(zr);

        n.results = el('div', 'xs-read-results');
        body.appendChild(n.results);

        /* adjust: size, grid, crop, fabric, how squares differ */
        var adj = el('details', 'xs-advanced xs-read-adjust');
        n.adjust = adj;
        adj.appendChild(el('summary', null, 'Adjust the read'));

        var two = el('div', 'xs-two');
        var s0 = o.size || { w: 100, h: 100 };
        wStep = C.stepper(s0.w, 1, 2000, 'width in stitches');
        hStep = C.stepper(s0.h, 1, 2000, 'height in stitches');
        two.appendChild(field('Width in stitches', wStep.node));
        two.appendChild(field('Height in stitches', hStep.node));
        adj.appendChild(two);
        [wStep, hStep].forEach(function (sp) {
          on(sp.node, 'click', function () { window.setTimeout(sizeChanged, 0); });
          on(sp.input, 'change', sizeChanged);
        });
        n.sizeNote = el('p', 'muted xs-read-note', '');
        adj.appendChild(n.sizeNote);

        var nudgeBox = el('div', 'xs-nudge');
        nudgeBox.setAttribute('role', 'group');
        nudgeBox.setAttribute('aria-label', 'Move the grid');
        [['←', 'Move the grid left', -1, 0, 0], ['→', 'Move the grid right', 1, 0, 0],
         ['↑', 'Move the grid up', 0, -1, 0], ['↓', 'Move the grid down', 0, 1, 0]]
          .forEach(function (b) {
            var btn = button('btn ghost', b[0], b[1]);
            btn.title = b[1];
            on(btn, 'click', function () { nudge(b[2], b[3], b[4]); });
            nudgeBox.appendChild(btn);
          });
        adj.appendChild(field('Move the grid', nudgeBox, 'If the lines sit between the squares instead of around them.'));
        var pitchBox = el('div', 'xs-nudge');
        pitchBox.setAttribute('role', 'group');
        pitchBox.setAttribute('aria-label', 'Square size');
        [['Smaller', 'Make the squares a little smaller', -1], ['Bigger', 'Make the squares a little bigger', 1]]
          .forEach(function (b) {
            var btn = button('btn ghost xs-nudge-word', b[0], b[1]);
            on(btn, 'click', function () { nudge(0, 0, b[2]); });
            pitchBox.appendChild(btn);
          });
        adj.appendChild(field('Square size', pitchBox, 'If the grid drifts off the squares towards one edge.'));
        n.latNote = el('p', 'muted xs-read-note', '');
        adj.appendChild(n.latNote);
        var resetGrid = button('linkish', 'Let it find the grid again');
        on(resetGrid, 'click', function () { o.lattice = null; syncLatticeNote(); schedule(0); });
        adj.appendChild(resetGrid);

        var fabSeg = C.segmented(
          [{ id: 'auto', label: 'Find it' }, { id: 'none', label: 'None' }, { id: 'pick', label: 'Tap it' }],
          /^#/.test(o.fabric) ? 'pick' : o.fabric,
          function (v) {
            if (v === 'pick') {
              pickFabric = true;
              n.canvas.classList.add('picking');
              setShow('picture');
              setStatus('Tap an unstitched square of fabric on the picture.', 'busy');
              try { n.canvas.focus(); } catch (e) { /* ignore */ }
              return;
            }
            pickFabric = false;
            n.canvas.classList.remove('picking');
            o.fabric = v;
            syncFabric();
            schedule(0);
          });
        var fabRow = el('div', 'xs-fabric-row');
        fabRow.appendChild(fabSeg.node);
        n.fabricSw = el('span', 'xs-swatch xs-swatch-sm');
        n.fabricSw.hidden = true;
        fabRow.appendChild(n.fabricSw);
        adj.appendChild(field('Fabric', fabRow));
        n.fabricNote = el('p', 'muted xs-read-note', '');
        adj.appendChild(n.fabricNote);

        var modeSeg = C.segmented(
          [{ id: 'auto', label: 'Either' }, { id: 'colour', label: 'Colour' }, { id: 'symbol', label: 'Symbol' }],
          o.mode, function (v) { o.mode = v; schedule(0); });
        adj.appendChild(field('Squares differ by', modeSeg.node,
          'Symbol is for black-and-white charts, where only the printed symbol tells colours apart.'));

        if (projectKeyEntries) {
          adj.appendChild(C.switchRow('Match to this project’s key',
            plural(projectKeyEntries.length, 'colour') + ' already in the project.', true, function (v) {
              o.key = v ? projectKeyEntries.map(copyEntry) : null;
              o.assign = {};
              schedule(0);
            }));
        }

        var cropBox = el('details', 'xs-read-crop');
        n.cropDetails = cropBox;
        cropBox.appendChild(el('summary', null, 'Crop to the chart'));
        n.cropper = makeCropFrame({
          noun: 'picture',
          onChange: function (c) { o.crop = c; o.lattice = null; schedule(); }
        });
        cropBox.appendChild(n.cropper.wrap);
        cropBox.appendChild(n.cropper.row);
        cropBox.appendChild(n.cropper.lockRow);
        adj.appendChild(cropBox);
        n.cropper.load(src.blob);
        if (o.crop) n.cropper.set(o.crop);

        body.appendChild(adj);
        body.appendChild(el('p', 'muted xs-import-note', 'Everything is read on this device. ' +
          'The colour key’s stitch counts are the check: when every colour matches, the chart is right.'));
        syncFabric();
        syncSizeInputs(o.size);
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (sa) { sa.close(); } },
        { text: 'Use this chart', cls: 'btn primary', onClick: function () { use(); } }
      ],
      onClose: function () {
        closed = true;
        if (timer) window.clearTimeout(timer);
        if (token) { try { R.cancel(token); } catch (e) { /* ignore */ } }
        token = null;
        if (n.ro) { try { n.ro.disconnect(); } catch (e) { /* ignore */ } }
        if (n.cropper) n.cropper.destroy();
        if (picUrl) { try { URL.revokeObjectURL(picUrl); } catch (e) { /* ignore */ } }
        if (pic && typeof pic.close === 'function' && pic !== src.canvas) { try { pic.close(); } catch (e) { /* ignore */ } }
      }
    });
    setUse(false);
    decode();
    schedule(0);
  }

  /**
   * "Use this chart": one undoable step through Store.updateCraftData, the
   * key's names / strands / printed counts kept, the source picture and the
   * read's details saved in BlobStore so the stitcher can come back to them.
   */
  function applyRead(projectId, res, x) {
    var d = x.data || res.data;
    var keyed = x.o.key && x.o.key.length ? x.o.key : null;
    var byCode = {};
    if (keyed) keyed.forEach(function (e) { byCode[codeKey(e.brand, e.code)] = e; });
    var chk = x.check || res.check || null;
    var pal = (d.palette || []).map(function (e, i) {
      var out = {};
      for (var k in e) out[k] = e[k];
      out.i = i;
      var ke = byCode[codeKey(out.brand, out.code)];
      if (ke) {
        if (ke.name) out.name = ke.name;                 // the PDF's own colour name
        if (ke.strands) out.strands = ke.strands;
        if (ke.stitchCount) out.stitchCount = ke.stitchCount;
        if (ke.skeins) out.skeins = ke.skeins;
        if (ke.kind) out.kind = ke.kind;
      } else if (!keyed && x.typed['p' + i] > 0) {
        out.stitchCount = x.typed['p' + i];
      }
      return out;
    });
    /* Two colours the stitcher named the same floss become one. */
    var seen = {}, remap = [], merged = [], dup = false;
    pal.forEach(function (e, i) {
      var k = codeKey(e.brand, e.code);
      if (seen[k] !== undefined) { remap[i] = seen[k]; dup = true; return; }
      seen[k] = merged.length;
      remap[i] = merged.length;
      e.i = merged.length;
      merged.push(e);
    });
    if (dup && d.chart && d.chart.cells) {
      var cellsArr = X.unpackCells(d.chart.cells);
      for (var ci = 0; ci < cellsArr.length; ci++) if (cellsArr[ci] >= 0) cellsArr[ci] = remap[cellsArr[ci]];
      var chart2 = {};
      for (var ck in d.chart) chart2[ck] = d.chart[ck];
      chart2.cells = X.packCells(cellsArr, d.chart.w, d.chart.h);
      var d2 = {};
      for (var dk in d) d2[dk] = d[dk];
      d2.chart = chart2;
      d = d2;
      pal = merged;
    }
    var info = {
      verdict: chk && chk.verdict ? chk.verdict : 'unchecked',
      summary: chk && chk.summary ? chk.summary : '',
      readTotal: chk && typeof chk.readTotal === 'number' ? chk.readTotal : null,
      expectedTotal: chk && typeof chk.expectedTotal === 'number' ? chk.expectedTotal : null,
      off: checkOff(chk),
      colours: pal.length
    };
    var keys = readKeys(projectId);
    var km = x.keyMeta || {};

    Store.updateCraftData(projectId, function (cd) {
      var raw = {};
      for (var k in d) raw[k] = d[k];
      raw.palette = pal;
      var next = X.normalize(raw, null);
      next.design.w = next.chart.w;
      next.design.h = next.chart.h;
      next.design.title = km.title || cd.design.title || (d.design && d.design.title) || '';
      next.design.designer = cd.design.designer;
      next.design.copyright = cd.design.copyright;
      next.fabric = cd.fabric;
      if (km.fabric && km.fabric.count) { next.fabric.count = km.fabric.count; next.fabric.countY = km.fabric.count; }
      if (km.fabric && km.fabric.kind) next.fabric.kind = km.fabric.kind;
      if (km.fabric && km.fabric.over) next.fabric.over = km.fabric.over;
      next.strandsDefault = km.strands || cd.strandsDefault;
      next.notesKey = cd.notesKey;
      next.pages = cd.pages;
      if (cd.progress && cd.progress.pageDone) next.progress.pageDone = cd.progress.pageDone;
      next.stash = cd.stash || {};
      next.parking = [];
      next.sizeWarnedAt = 0;
      next.source = {
        kind: 'picture', fileName: String(x.src.name || ''), importedAt: Date.now(),
        warnings: ((res.stats && res.stats.warnings) || []).slice(0, 12),
        check: info, picture: x.src.blob ? keys.pic : undefined
      };
      return next;
    });

    var after = Store.project(projectId);
    var meta = {
      v: 1, fileName: String(x.src.name || ''), savedAt: Date.now(),
      fp: after ? cellsPrint(dataOf(after).chart) : '',
      check: info,
      opts: {
        size: res.size || x.o.size || null, lattice: x.o.lattice || null, crop: x.o.crop || null,
        fabric: x.o.fabric, mode: x.o.mode, assign: x.o.assign, renames: x.renames, typed: x.typed
      },
      key: keyed, keyMeta: km
    };
    if (x.src.blob && window.BlobStore && window.BlobStore.available && window.BlobStore.available()) {
      var picBlob = x.src.blob;
      window.BlobStore.put(keys.pic, picBlob).then(function () {
        return window.BlobStore.put(keys.meta, new Blob([JSON.stringify(meta)], { type: 'application/json' }));
      }).then(null, function () { /* the chart itself is saved; only the look-back is lost */ });
    }

    forgetCaches();
    var dd = after ? dataOf(after) : null;
    var msg = 'Chart read from the picture · ' + (dd ? dd.chart.w + ' × ' + dd.chart.h + ' · ' : '') +
      plural(pal.length, 'colour');

    if (x.src.pdf && x.src.pdf.handle && typeof x.src.pdf.handle.renderPage === 'function') {
      /* keep the PDF's pages too, exactly as a PDF import does */
      C.render();
      if (x.statusTo) x.statusTo('Saving the PDF pages…', 'busy');
      var line = el('p');
      var pdf = x.src.pdf;
      renderPages(projectId, pdf.handle, pdf.key || { design: {} }, pdf.progressLine || line, null).then(function () {
        C.closeAllSheets();
        C.render();
        fb('done');
        toast(msg, { ms: 4200 });
        checkSize(projectId);
      }, function () {
        C.closeAllSheets();
        C.render();
        toast(msg, { ms: 4200 });
      });
      return;
    }
    C.closeAllSheets();
    C.render();
    fb('done');
    toast(msg, { ms: 4200 });
    checkSize(projectId);
  }

  /** Back into the review from the project's banner. */
  function reopenRead(projectId) {
    if (!readerAvailable()) { toast('Reading a chart picture is not available on this device'); return; }
    if (!window.BlobStore || !window.BlobStore.available || !window.BlobStore.available()) {
      toast('The picture is not kept on this device');
      return;
    }
    var keys = readKeys(projectId);
    /* craftData names the picture; an import that gave the project a new
       id re-keys that name (Store's rekeyBlobs), and the details sit beside it */
    var pr = Store.project(projectId);
    var named = pr && pr.craftData && pr.craftData.source ? String(pr.craftData.source.picture || '') : '';
    if (/:readsrc:0$/.test(named)) keys = { pic: named, meta: named.replace(/:readsrc:0$/, ':readsrc:meta') };
    Promise.all([window.BlobStore.get(keys.pic), window.BlobStore.get(keys.meta)]).then(function (r) {
      var blob = r[0];
      if (!blob) { toast('The picture this chart was read from is not on this device any more'); return null; }
      return readJsonBlob(r[1]).then(function (meta) {
        meta = meta || {};
        var p = Store.project(projectId);
        var pk = p ? projectKey(dataOf(p)) : null;
        openReadSheet(projectId, {
          blob: blob, name: meta.fileName || 'Picture',
          key: meta.key && meta.key.length ? meta.key : (pk ? pk.entries : null),
          keyMeta: meta.keyMeta || (pk ? pk.meta : {}),
          size: meta.opts && meta.opts.size ? meta.opts.size : null,
          saved: meta.opts || null
        });
      });
    }, function () { toast('The picture could not be loaded'); });
  }

  /* ---- #7 / R1: a colour key that is a picture (XSKeyRead) --------------
     docs/wave-k/api/xs-keyread.md. Exact-or-blank: a row's code is kept
     only when the reader pinned it down or the stitcher confirmed it (a tap
     on one of the possible codes, or typing it); a partial row's first
     candidate is never written as its code. On a whole page the stitcher is
     asked for a box round the key first. */

  function keyReadAvailable() {
    return !!(window.XSKeyRead && typeof window.XSKeyRead.read === 'function' &&
      (typeof window.XSKeyRead.isAvailable !== 'function' || window.XSKeyRead.isAvailable()));
  }

  /** The chart's own colour counts, for the reader's count check. */
  function chartCountsFor(data) {
    if (!hasChart(data)) return null;
    var st = (view && view.data === data && view.stats) || X.progressStats(data);
    var classes = [], total = 0;
    data.palette.forEach(function (e, i) {
      var c = st.byColor[i];
      var n2 = c && !c.fromKey ? c.total : 0;
      if (!n2) return;
      classes.push({ hex: e.hex, count: n2 });
      total += n2;
    });
    return classes.length ? { classes: classes, total: total } : null;
  }

  /** A typed or tapped code, checked against the floss table: { code, name, hex } | null. */
  function confirmCode(text) {
    var t = String(text || '').trim().replace(/^dmc\s*/i, '');
    if (!t) return null;
    var f = typeof X.flossFor === 'function' ? X.flossFor('DMC', t) : null;
    if (!f) return null;
    return { code: f.code || t, name: f.name || '', hex: f.hex || null };
  }

  /** KeyRead entries + the stitcher's choices -> parseKey-shaped entries to keep. */
  function keyEntriesFrom(res, choices) {
    var out = [], left = 0;
    (res && res.entries || []).forEach(function (e, i) {
      var pick = choices[i] ? confirmCode(choices[i]) : null;
      var exact = e.read && e.read.status === 'exact' && e.code;
      if (!pick && !exact) { left++; return; }
      var code = pick ? pick.code : e.code;
      var tab = confirmCode(code) || {};
      out.push({
        symbol: '', brand: 'DMC', code: code,
        name: pick ? pick.name : (e.name || tab.name || ''),
        hex: pick ? (pick.hex || e.hex) : (e.hex || tab.hex || null),
        strands: e.strands || null, stitchCount: e.stitchCount || null, skeins: null,
        kind: e.kind || 'cross', glyph: e.glyph && e.glyph.clean ? e.glyph : null,
        line: (pick ? 'DMC ' + code + ' (confirmed by you)' : e.line) || ''
      });
    });
    return { entries: out, left: left };
  }

  /** ⋯ → Read a key from a picture: choose the picture, then the key sheet. */
  function pickKeyPicture(projectId) {
    var pick = document.createElement('input');
    pick.type = 'file';
    pick.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';
    pick.className = 'sr-only';
    document.body.appendChild(pick);
    on(pick, 'change', function () {
      var f = pick.files && pick.files[0];
      if (pick.parentNode) pick.parentNode.removeChild(pick);
      if (f) openKeyReadSheet(projectId, { blob: f, name: f.name || 'Key picture', wholePage: (f.size || 0) > 600000 });
    });
    pick.click();
  }

  function openKeyReadSheet(projectId, src) {
    if (!keyReadAvailable()) { toast('Reading a key from a picture is not available on this device'); return; }
    var KR = window.XSKeyRead;
    var p = Store.project(projectId);
    if (!p || !src || !src.blob) return;
    var data0 = dataOf(p);
    var counts = chartCountsFor(data0);
    var crop = src.crop || null, res = null, token = null, timer = null, closed = false;
    var choices = {};
    var n = {};

    function setStatus(t, kind) {
      n.status.textContent = t;
      n.status.className = 'xs-read-status' + (kind ? ' is-' + kind : '');
    }

    function run() {
      timer = null;
      if (closed) return;
      if (token) { try { KR.cancel(token); } catch (e) { /* ignore */ } }
      setStatus('Reading the key…', 'busy');
      var pr;
      try {
        pr = KR.read(src.blob, { crop: crop, chart: counts, total: counts ? counts.total : null });
      } catch (e) { pr = null; }
      if (!pr) { setStatus('The key could not be read on this device.', 'bad'); return; }
      token = pr.token || null;
      Promise.resolve(pr).then(function (r) {
        if (closed || (r && r.reason === 'cancelled')) return;
        res = r;
        choices = {};
        ocrSugg = {};
        render();
      }, function () { if (!closed) setStatus('The key could not be read.', 'bad'); });
    }

    function schedule(ms) {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(run, typeof ms === 'number' ? ms : 300);
    }

    function glyphCanvas(g) {
      if (!g || !g.clean || !g.bits) return null;
      var c = document.createElement('canvas');
      c.width = 16; c.height = 16;
      c.className = 'xs-glyph';
      c.setAttribute('aria-hidden', 'true');
      try {
        var raw = window.atob(g.bits), ctx = c.getContext('2d'), img = ctx.createImageData(16, 16);
        for (var k = 0; k < 256; k++) {
          var on2 = (raw.charCodeAt(k >> 3) >> (7 - (k & 7))) & 1;
          img.data[k * 4 + 3] = on2 ? 255 : 0;
        }
        ctx.putImageData(img, 0, 0);
      } catch (e) { return null; }
      return c;
    }

    function render() {
      clear(n.results);
      var r = res;
      if (!r || !r.ok) {
        setStatus((r && r.message) || 'No colour key found in this picture.', 'bad');
        n.results.appendChild(el('p', 'muted', 'Drag the box round just the key (the list of threads) under ' +
          '“Crop to the key”, then it reads again.'));
        if (n.cropDetails) n.cropDetails.open = true;
        syncUse();
        return;
      }
      var st = r.stats || {};
      setStatus('Read ' + plural(r.entries.length, 'row') + ': ' + (st.exact || 0) + ' sure' +
        ((st.partial || 0) ? ', ' + st.partial + ' to check' : '') + ((st.blank || 0) ? ', ' + st.blank + ' blank' : '') + '.',
        r.verdict === 'read' ? 'ok' : 'warn');
      n.results.appendChild(el('p', 'muted xs-read-note', r.verdict === 'read'
        ? 'Every code was pinned down by the picture itself' + (counts ? ' and the chart’s own counts' : '') + '. Check them against your paper key anyway.'
        : 'Rows marked “check” need your eye: tap the right code or type it. Blank rows are left out unless you type them.'));
      var list = el('div', 'list xs-keyread-list');
      r.entries.forEach(function (e, i) {
        var rd = e.read || { status: 'blank', text: '', candidates: [] };
        var row = el('div', 'list-item xs-keyread-row is-' + rd.status);
        var sw = el('span', 'xs-swatch');
        var hx = rd.swatchHex || e.hex;
        sw.style.background = hx ? '#' + hx : 'transparent';
        var gc = glyphCanvas(e.glyph);
        if (gc) { sw.appendChild(gc); if (hx) sw.style.color = X.symbolInk(hx) === 'light' ? '#fff' : '#111'; }
        row.appendChild(sw);
        var txt = el('div', 'xs-key-text');
        var conf = choices[i] ? confirmCode(choices[i]) : null;
        var tabName = rd.status === 'exact' ? (e.name || (confirmCode(e.code) || {}).name || '') : '';
        var head = rd.status === 'exact'
          ? 'DMC ' + e.code + (tabName ? ' · ' + tabName : '')
          : conf ? 'DMC ' + conf.code + (conf.name ? ' · ' + conf.name : '') + ' (you chose)'
            : rd.status === 'partial' ? 'DMC ' + rd.text + ' · check' : 'Not read';
        txt.appendChild(el('span', 'xs-key-code', head));
        var sub = [];
        if (e.stitchCount) sub.push(comma(e.stitchCount) + ' sts');
        /* The key reader says, per row, whether the printed count was read. A
           count it looked for and could not read is said plainly, so a missing
           number never looks like "this colour has no count". */
        else if (rd.countStatus === 'not-read') sub.push('count not read' + (rd.countWhy ? ' (' + rd.countWhy + ')' : ''));
        if (rd.status === 'exact') sub.push('read from the picture');
        if (rd.why && rd.status !== 'exact') sub.push(rd.why);
        txt.appendChild(el('span', 'xs-key-sub', sub.join(' · ')));
        if (rd.status !== 'exact') {
          var fix = el('div', 'xs-keyread-fix');
          (rd.candidates || []).forEach(function (cd) {
            var f = confirmCode(cd);
            var b = button('btn ghost xs-keyread-cand' + (choices[i] === cd ? ' on' : ''), cd, 'It is DMC ' + cd + (f && f.name ? ', ' + f.name : ''));
            if (f && f.hex) { var dot = el('span', 'xs-swatch xs-swatch-sm'); dot.style.background = '#' + f.hex; b.insertBefore(dot, b.firstChild); }
            on(b, 'click', function () { choices[i] = cd; render(); });
            fix.appendChild(b);
          });
          if (ocrSugg[i] && choices[i] !== ocrSugg[i]) {
            var os = button('btn ghost xs-keyread-cand', ocrSugg[i] + ' ?', 'The text reader read DMC ' + ocrSugg[i] + ': tap to accept it');
            if (C.ocr && typeof C.ocr.mark === 'function') { try { C.ocr.mark(os, {}); } catch (e) { /* ignore */ } }
            on(os, 'click', function () { choices[i] = ocrSugg[i]; render(); });
            fix.appendChild(os);
          }
          var inp = C.textInput ? C.textInput(choices[i] && (rd.candidates || []).indexOf(choices[i]) < 0 ? choices[i] : '', 'Type the code') : el('input');
          inp.setAttribute('inputmode', 'text');
          inp.setAttribute('aria-label', 'Code for row ' + (i + 1));
          inp.className = (inp.className ? inp.className + ' ' : '') + 'xs-keyread-input';
          on(inp, 'change', function () {
            var v = inp.value.trim();
            if (!v) { delete choices[i]; render(); return; }
            if (!confirmCode(v)) { toast('DMC ' + v + ' is not a DMC code'); fb('alert'); return; }
            choices[i] = v;
            render();
          });
          fix.appendChild(inp);
          txt.appendChild(fix);
        }
        row.appendChild(txt);
        list.appendChild(row);
      });
      n.results.appendChild(list);
      /* the opt-in text reader (shell-ui.md §9): only for blank rows on a
         cropped key; what it reads is offered as a code to tap, never taken */
      if ((st.blank || 0) && crop && C.ocr && typeof C.ocr.available === 'function' && C.ocr.available() &&
          typeof C.ocr.offerButton === 'function') {
        var ob = C.ocr.offerButton({
          reason: 'to read the codes the key reader left blank',
          onReady: function (Ocr) { ocrBlankRows(Ocr); }
        });
        if (ob) n.results.appendChild(ob);
      }
      syncUse();
    }

    var ocrSugg = {};
    function ocrBlankRows(Ocr) {
      if (!res || !res.ok || !crop || !window.createImageBitmap) return;
      setStatus('Reading the blank rows with the text reader…', 'busy');
      window.createImageBitmap(src.blob).then(function (bmp) {
        var cv = document.createElement('canvas');
        cv.width = crop.w; cv.height = crop.h;
        cv.getContext('2d').drawImage(bmp, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
        if (bmp.close) bmp.close();
        return Ocr.recognize(cv, { mode: 'codes' });
      }).then(function (out) {
        var words = (out && out.words) || [], found = 0;
        res.entries.forEach(function (e, i) {
          if (!e.read || e.read.status !== 'blank' || choices[i]) return;
          var rb = res.rows && res.rows[i] && res.rows[i].box;
          if (!rb) return;
          for (var k = 0; k < words.length; k++) {
            var b = words[k].bbox, cy = (b.y0 + b.y1) / 2 + crop.y;
            if (cy < rb.y || cy > rb.y + rb.h) continue;
            var f = confirmCode(words[k].text);      // only a real code in the DMC table
            if (f) { ocrSugg[i] = f.code; found++; break; }
          }
        });
        if (typeof Ocr.terminate === 'function') { try { Ocr.terminate(); } catch (e2) { /* ignore */ } }
        render();
        setStatus(found ? 'The text reader suggests ' + plural(found, 'code') + ': tap each one to accept it.'
          : 'The text reader found no DMC codes in the blank rows.', found ? 'warn' : 'bad');
      }, function () { setStatus('The text reader could not read this key.', 'bad'); });
    }

    function syncUse() {
      if (!n.api) return;
      var b = n.useBtn || (n.useBtn = n.api.dialog.querySelector('.sheet-foot .btn.primary'));
      var kept = res && res.ok ? keyEntriesFrom(res, choices) : { entries: [], left: 0 };
      if (b) {
        b.disabled = !kept.entries.length;
        b.textContent = kept.entries.length ? 'Use ' + plural(kept.entries.length, 'colour') : 'Use this key';
      }
      if (n.leftNote) n.leftNote.textContent = kept.left ? plural(kept.left, 'row') + ' with no code will be left out.' : '';
    }

    function use() {
      if (!res || !res.ok) return;
      var kept = keyEntriesFrom(res, choices);
      if (!kept.entries.length) { toast('No row has a code yet'); return; }
      var pp = Store.project(projectId);
      if (!pp) return;
      var d = dataOf(pp);
      var key = {
        entries: kept.entries, design: { w: d.design.w || null, h: d.design.h || null, title: d.design.title || '' },
        fabric: { count: null, kind: null, over: null, color: null }, strandsDefault: null,
        stitchesUsed: [], warnings: ['key read from a picture' + (kept.left ? ' (' + plural(kept.left, 'row') + ' left out)' : '')],
        copyrightLines: [], sizes: [], confidence: 0.6
      };
      closed = true;
      if (hasChart(d) && d.source && d.source.kind === 'picture' && window.BlobStore && window.BlobStore.get) {
        /* a chart read from a picture: read it again against this key */
        var keys = readKeys(projectId);
        var named = d.source.picture ? String(d.source.picture) : '';
        if (/:readsrc:0$/.test(named)) keys = { pic: named };
        window.BlobStore.get(keys.pic).then(function (blob) {
          C.closeAllSheets();
          if (!blob) { toast('The chart picture is not on this device any more'); return; }
          openReadSheet(projectId, { blob: blob, name: 'Chart picture', key: kept.entries,
            keyMeta: { title: d.design.title || '', design: d.design.w ? { w: d.design.w, h: d.design.h } : {} },
            size: d.design.w && d.design.h ? { w: d.design.w, h: d.design.h } : null });
        }, function () { C.closeAllSheets(); toast('The chart picture could not be loaded'); });
        return;
      }
      if (hasChart(d)) {
        C.confirmSheet({
          title: 'Replace this chart’s colours?',
          message: 'This project already has a chart with its own colours. Using the key replaces the colour ' +
            'list and clears the chart. You can Undo it.',
          confirmText: 'Replace', danger: true
        }).then(function (ok) {
          if (!ok) return;
          applyPdf(projectId, { entries: kept.entries, fabric: key.fabric, design: key.design, strands: null }, key, null, el('p'));
        });
        return;
      }
      applyPdf(projectId, { entries: kept.entries, fabric: key.fabric, design: key.design, strands: null }, key, null, el('p'));
      toast('Key read from the picture · ' + plural(kept.entries.length, 'colour') +
        (kept.left ? ' · ' + plural(kept.left, 'row') + ' left out' : ''), { ms: 4200 });
      /* xs-audit: opened from a chart picture that holds this key: read that
         chart again, now against the key */
      if (src.reread && src.reread.blob) {
        C.closeAllSheets();
        openReadSheet(projectId, { blob: src.reread.blob, name: src.reread.name || 'Chart picture', key: kept.entries,
          keyMeta: { title: d.design.title || '', design: d.design.w ? { w: d.design.w, h: d.design.h } : {} },
          size: src.reread.size || null });
      }
    }

    n.api = C.openSheet({
      title: 'Read a colour key',
      cls: 'sheet-xs-keyread',
      build: function (body) {
        n.status = el('p', 'xs-read-status is-busy', 'Reading the key…');
        n.status.setAttribute('role', 'status');
        n.status.setAttribute('aria-live', 'polite');
        body.appendChild(n.status);
        var cropBox = el('details', 'xs-read-crop');
        n.cropDetails = cropBox;
        cropBox.appendChild(el('summary', null, 'Crop to the key'));
        cropBox.appendChild(el('p', 'muted xs-read-note', 'On a whole page, drag the box round just the key: ' +
          'it reads faster and does not mistake other text for codes.'));
        n.cropper = makeCropFrame({ noun: 'picture', onChange: function (c) { crop = c; schedule(); } });
        cropBox.appendChild(n.cropper.wrap);
        cropBox.appendChild(n.cropper.row);
        cropBox.appendChild(n.cropper.lockRow);
        body.appendChild(cropBox);
        n.cropper.load(src.blob);
        if (crop) n.cropper.set(crop);
        if (src.wholePage) cropBox.open = true;
        n.results = el('div', 'xs-read-results');
        body.appendChild(n.results);
        n.leftNote = el('p', 'muted xs-read-note', '');
        body.appendChild(n.leftNote);
        body.appendChild(el('p', 'muted xs-import-note', 'Read on this device, with no text-recognition engine: ' +
          'a code is only filled in when the picture’s own digits, the DMC list, the printed swatch' +
          (counts ? ' and the chart’s counts' : '') + ' agree.'));
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (sa) { sa.close(); } },
        { text: 'Use this key', cls: 'btn primary', onClick: function () { use(); } }
      ],
      onClose: function () {
        closed = true;
        if (timer) window.clearTimeout(timer);
        if (token) { try { KR.cancel(token); } catch (e) { /* ignore */ } }
        if (n.cropper) n.cropper.destroy();
      }
    });
    syncUse();
    schedule(0);
  }

  /** What the project's banner says, or null when this chart was not read from a picture. */
  function readInfo(data) {
    if (!hasChart(data)) return null;
    /* craftData is the one source of truth (XStitch.normalize keeps
       source.kind 'picture' and source.check since wave J), so the band
       follows Undo / redo, a reload and an export / import like the chart. */
    var so = data.source || {};
    var ur = unresolvedCount(data);
    if (so.kind === 'pdf' && isObj(so.check)) {
      /* a grid read is checked again now, so the band follows the stitcher's
         choices and Undo (the stored line is only the fallback) */
      var live = liveCheckOf(data);
      if (live) {
        var offRows = 0;
        (live.rows || []).forEach(function (r) { if (r && r.verdict === 'off') offRows++; });
        return { verdict: live.verdict, summary: live.summary, off: offRows, unresolved: ur };
      }
    }
    if ((so.kind === 'picture' || so.kind === 'pdf') && isObj(so.check)) {
      if (!ur) return so.check;
      var c = {};
      for (var k in so.check) c[k] = so.check[k];
      c.verdict = 'off';
      c.unresolved = ur;
      return c;
    }
    /* wave K: squares a read could not name stay visible however they came */
    return ur ? { verdict: 'off', summary: '', unresolved: ur, off: 0 } : null;
  }

  /** Stitches sitting on a placeholder colour (palette[i].unresolved). */
  function unresolvedCount(data) {
    var pal = data.palette || [], n = 0, any = false;
    for (var i = 0; i < pal.length; i++) if (pal[i].unresolved) { any = true; break; }
    if (!any || !hasChart(data)) return 0;
    var st = (view && view.data === data && view.stats) || statsOf(data);
    for (i = 0; i < pal.length; i++) {
      if (pal[i].unresolved && st.byColor[i]) n += st.byColor[i].total || 0;
    }
    return n;
  }

  function syncReadBand(project, data) {
    var n = view && view.nodes;
    if (!n || !n.readBand) return;
    var info = readInfo(data);
    if (info) {
      var kind = (data.source && data.source.kind) === 'picture' ? 'picture' : 'pdf';
      n.readBand.hidden = false;
      n.readBand.className = 'xs-read-band xs-verdict-' + (info.verdict || 'unchecked');
      n.readBandText.textContent = readBannerText(info, kind);
      n.readBandIcon.textContent = kind === 'picture' ? '🖼' : '🔍';
    } else {
      n.readBand.hidden = true;
    }
  }

  /**
   * The chart against its key, worked out now (so it follows Undo and the
   * stitcher's own choices): palette entries carry the key's printed count
   * as keyCount since wave K; placeholders the read could not name are rows
   * of their own, verdict off.
   */
  function liveCheckOf(data) {
    if (!hasChart(data) || typeof X.checkCounts !== 'function') return null;
    var pal = data.palette, entries = [], any = false, ur = [];
    for (var i = 0; i < pal.length; i++) {
      var e = pal[i];
      if (e.unresolved) { ur.push(i); continue; }
      if (e.keyCount > 0) any = true;
      entries.push({ brand: e.brand, code: e.code, name: e.name, hex: e.hex, kind: e.kind,
        stitchCount: e.keyCount > 0 ? e.keyCount : null });
    }
    if (!any && !ur.length) return null;
    var raw = null;
    try { raw = X.checkCounts(data, entries); } catch (err) { raw = null; }
    var st = (view && view.data === data && view.stats) || statsOf(data);
    var fake = { ok: true, check: raw, palette: pal, unresolved: ur.map(function (pi) {
      return { palette: pi, ink: pal[pi].hex, cells: st.byColor[pi] ? st.byColor[pi].total : 0,
        candidates: pal[pi].unresolved, expected: [], why: 'shared-ink' };
    }) };
    return gridCheckOf(fake);
  }

  /** The band's door for a chart read from the PDF grid (not a picture). */
  function openGridCheck(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var data = dataOf(p);
    var chk = liveCheckOf(data);
    C.openSheet({
      title: 'Chart against the key',
      cls: 'sheet-xs-gridcheck',
      build: function (body) {
        if (chk && C.check && typeof C.check.render === 'function') C.check.render(body, chk, {});
        else body.appendChild(el('p', 'muted', 'The key gave no stitch counts to check this chart against.'));
        var ur = [];
        data.palette.forEach(function (e, i) { if (e.unresolved) ur.push(i); });
        if (ur.length) {
          body.appendChild(el('h3', 'xs-h3', 'Colours to choose'));
          ur.forEach(function (i) {
            var b = button('btn ghost block xs-resolve-open', 'Choose for ' + data.palette[i].name);
            on(b, 'click', function () { openResolveSheet(projectId, i); });
            body.appendChild(b);
          });
        }
      },
      footer: [{ text: 'Close', cls: 'btn ghost', onClick: function (api) { api.close(); } }]
    });
  }

  /**
   * "Which colour are these?" for a placeholder the read could not name:
   * one of the candidates, any key colour, or "these are fabric". One undo
   * step through XStitch.resolveClass; never a silent guess.
   */
  function openResolveSheet(projectId, pi) {
    var p = Store.project(projectId);
    if (!p || typeof X.resolveClass !== 'function') return;
    var data = dataOf(p), e = data.palette[pi];
    if (!e || !e.unresolved) return;
    var st = view && view.stats ? view.stats : statsOf(data);
    var n = st.byColor[pi] ? st.byColor[pi].total : 0;
    function apply(choice, word) {
      Store.updateCraftData(projectId, function (cd) { return X.resolveClass(cd, pi, choice); });
      forgetCaches();
      C.closeAllSheets();
      C.render();
      fb('done');
      toast(comma(n) + ' ' + (n === 1 ? 'stitch' : 'stitches') + ' set to ' + word + ' · Undo from the bar', { ms: 4200 });
    }
    C.openSheet({
      title: 'Which colour are these?',
      cls: 'sheet-xs-resolve',
      build: function (body) {
        body.appendChild(el('p', 'muted', comma(n) + ' ' + (n === 1 ? 'stitch' : 'stitches') +
          ' could not be told apart when the chart was read: ' + e.name.replace(/ \((not told apart|not in the key\?)\)$/, '') +
          '. Look at your printed chart, then choose. You can undo it.'));
        var list = el('div', 'list xs-resolve-list');
        var cands = (e.unresolved || []).filter(function (q) { return data.palette[q] && !data.palette[q].unresolved; });
        var rest = [];
        data.palette.forEach(function (q, qi) {
          if (!q.unresolved && cands.indexOf(qi) < 0 && (q.kind === 'cross' || q.kind === 'blend' || q.kind === 'half')) rest.push(qi);
        });
        function row(qi) {
          var q = data.palette[qi];
          var b = button('list-item xs-resolve-row', null, 'They are ' + paletteLabel(q));
          var sw = el('span', 'xs-swatch', q.symbol || '');
          sw.style.background = swatchHex(q);
          sw.style.color = X.symbolInk(q.hex) === 'light' ? '#fff' : '#111';
          b.appendChild(sw);
          var t = el('span', 'xs-key-text');
          t.appendChild(el('span', 'xs-key-code', paletteLabel(q)));
          var sq = st.byColor[qi];
          var have = sq && !sq.fromKey ? sq.total : 0;
          /* only keyCount is the key's printed count: after a picture read,
             stitchCount can be the read count of a row the key gave none for */
          var printedN = q.keyCount || 0;
          t.appendChild(el('span', 'xs-key-sub', (printedN ? 'key prints ' + comma(printedN) + ' · ' : '') +
            (have ? comma(have) + ' on the chart now' : 'none on the chart yet')));
          b.appendChild(t);
          on(b, 'click', function () { apply(qi, paletteLabel(q)); });
          list.appendChild(b);
        }
        cands.forEach(row);
        body.appendChild(list);
        if (rest.length) {
          var more = el('details', 'xs-advanced');
          more.appendChild(el('summary', null, 'Another colour from the key'));
          var l2 = list;
          list = el('div', 'list xs-resolve-list');
          rest.forEach(row);
          more.appendChild(list);
          list = l2;
          body.appendChild(more);
        }
        var fab = button('btn ghost block', 'They are fabric (not stitched)');
        on(fab, 'click', function () { apply(-1, 'fabric'); });
        body.appendChild(fab);
      },
      footer: [{ text: 'Leave them for now', cls: 'btn ghost', onClick: function (api) { api.close(); } }]
    });
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
    if (rowsAvailable(data)) {
      items.push({ icon: '☰', label: 'Row by row', run: function () { openRowsSheet(project.id); } });
    }
    if (hasChart(data)) {
      items.push({ icon: '🖨', label: 'Printable chart', run: function () { openPrintSheet(project.id); } });
      items.push({ icon: '💾', label: 'Export as OXS', run: function () { exportOxs(project.id); } });
      if (data.progress.mode === 'cells' && typeof X.findPlace === 'function') {
        items.push({ icon: '🔢', label: 'Find my place', run: function () { openFindSheet(project.id); } });
      }
    }
    if (keyReadAvailable()) {
      items.push({ icon: '🔑', label: 'Read a key from a picture', run: function () { pickKeyPicture(project.id); } });
    }
    /* wave K: the self-contained sheets live in js/app-xstitch-extras.js
       (BUILD.md "Craft screens are split in two"); the app only lists them. */
    var XE = window.XStitchExtras;
    if (XE && typeof XE.menuItems === 'function' && typeof XE.open === 'function') {
      var extra = [];
      try { extra = XE.menuItems(project) || []; } catch (e) { extra = []; }
      extra.forEach(function (it) {
        if (!it || !it.id || !it.label) return;
        items.push({ icon: it.icon || '•', label: it.label, hint: it.hint, run: function () {
          var pp = Store.project(project.id) || project;
          try { XE.open(it.id, pp, { ctx: C, app: window.XStitchApp }); } catch (e2) { toast('That could not be opened'); }
        } });
      });
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
    // canvas crisp after a theme swap changes its size. The rulers do follow
    // the theme, so their colours are read again.
    rulerTheme = null;
    if (view && view.stitched && view.stitched.handle) {
      try { view.stitched.handle.setTheme(); } catch (e) { /* ignore */ }
    }
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
      q: 'How do I find my place on a big chart?',
      a: 'The chart has rulers numbered every 10 stitches, red ▼ ▶ arrows (and a dashed line) at the ' +
        'centre, and a box in the corner that reads "col 134 · row 57" and how far that is from the ' +
        'centre, the way a printed chart counts. The full chart opens where you left it, with the same ' +
        'tool. 🎯 jumps to the nearest stitch of your colour still to do, and 📄 shows the PDF page ' +
        'that stitch is printed on, outlined, for backstitch and notes. The big button works the 10×10 ' +
        'block you are in before moving on to the next block with that colour.'
    },
    {
      q: 'Can it read a picture of a chart?',
      a: 'Yes, when the picture shows one square per stitch: a screenshot of a chart, an image file, or ' +
        'a PDF whose chart is a picture. Drop it into ⋯ → Import pattern (or paste a screenshot there), ' +
        'or use “Read the chart from the page pictures” after opening the PDF. It finds the grid, reads ' +
        'each square’s colour or symbol, and checks the result against the stitch counts printed in the ' +
        'colour key: when every colour matches, the chart is right. When it is unsure it says so, outlines ' +
        'the squares it could not read, and lets you fix the size, move the grid, pick the fabric colour ' +
        'or say which colour a kind of square is. Everything happens on this device. It cannot yet read a ' +
        'photo of a paper chart taken at an angle, a chart split across several pages, or backstitch. ' +
        'Any project with a chart also has ☰ Row by row: the chart written out a row at a time ' +
        '(“skip 3, 5 × DMC 310, …”), with a big Row done button and Copy as text.'
    },
    {
      q: 'Where are my chart images stored?',
      a: 'In the browser’s own storage on this device — never uploaded. Back up now (Settings) and ' +
        '⋯ → Send this project make a .thready file that carries them, along with your stitch ' +
        'progress and colour key. An older .json backup has no page images; re-importing the PDF ' +
        'brings them back.'
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
              target: '#xs-rows-btn',
              title: 'Row by row',
              body: 'The chart written out one row at a time: how many of each colour, in order, the way ' +
                'you stitch it. A big Row done button marks the whole row on the chart, a second tap ' +
                'unmarks it, and you can copy every row as text.'
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

  var def = {
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
    onInit: onInit,
    // HANDOFF item 13: the quota banner's "Free up space" button appears when
    // a craft publishes this. Image-only mode keeps pages, key and tallies.
    freeUpSpace: function (projectId) { switchToCountsMode(projectId); },
    // wave K #9: Settings → Cross-stitch: the pattern's own symbols or the app's set
    settingsFields: function (body, ctx) {
      useCtx(ctx);
      body.appendChild(C.switchRow('The pattern’s own symbols',
        'When a chart’s symbols were read cleanly from the pattern, show those on the chart; otherwise the app’s set.',
        patternSymbols(), function (v) {
          Store.setCraftSetting(CRAFT, 'appSymbols', !v);
          if (view) redrawAll();
        }));
    },
    // wave K #2: Stitch mode on the shell's working-mode contract (shell-ui.md §1)
    workMode: STITCH_MODE,
    // wave K X4: the stitched piece for the shell's share card (shell-ui.md §3)
    sharePicture: function (p, o) { return stitchedPicture(p, { size: o && o.size, frame: 'hoop' }); },
    copy: {
      dropLabel: 'Drop a chart PDF, an .oxs file or a picture of a chart here, or choose a file',
      homeEmpty: 'No charts yet. Start a cross-stitch project and drop in its PDF.',
      allDone: 'Nothing in the hoop right now.'
    },
    // What the New project sheet's drop zone accepts for this craft before
    // handing the file to openImportSheet (the same list its own zone takes).
    importAccept: ['.pdf', '.oxs', '.xml']
  };
  /* Wave J: read when the New project sheet mounts its zone, so the picture
     types appear exactly when the chart reader is on this device. */
  try {
    Object.defineProperty(def, 'importAccept', {
      enumerable: true, configurable: true,
      get: function () { return importAcceptList(); }
    });
  } catch (e) { def.importAccept = importAcceptList(); }

  App.registerCraft(def);

  /* QA hooks (test/crafts.test.html and Browser-pane checks only; never
     called by app code). The pure helpers, and the real entry points so a
     walkthrough can feed a picture or a parsed key down the same path a
     drop or a PDF import takes. */
  /** X4: the stitched piece as a square canvas (share card, framed picture). */
  function stitchedPicture(p, o) {
    o = o || {};
    if (!stitchedOk() || typeof window.XSRender.picture !== 'function' || !p) return Promise.resolve(null);
    var d = dataOf(p);
    if (!hasChart(d)) return Promise.resolve(null);
    try {
      return Promise.resolve(window.XSRender.picture(d, {
        size: clampInt(o.size, 64, 4096, 1080), frame: o.frame || 'hoop', background: o.background || 'transparent', ghost: 0
      })).then(function (c) { return c || null; }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function screenProjectId() {
    return view && !view.destroyed ? view.projectId : null;
  }

  window.XStitchApp = {
    version: 1,
    current: function () {
      var id = screenProjectId();
      var p = id ? Store.project(id) : null;
      return p ? { projectId: id, project: p, data: dataOf(p) } : null;
    },
    dataOf: function (x) { return dataOf(typeof x === 'string' ? Store.project(x) : x); },
    cells: function (projectId) {
      if (!view || view.destroyed || !view.cells || (projectId && projectId !== view.projectId)) return null;
      return { w: view.w, h: view.h, cells: view.cells, done: view.bits ? view.bits.bytes : null };
    },
    repaint: function (projectId, o) {
      if (!view || (projectId && projectId !== view.projectId)) return;
      if (o && o.cells) forgetCaches();
      else view.stats = null;
      if (C) C.render();
    },
    centerOn: function (x, y) {
      var id = screenProjectId();
      if (!id) return;
      setCrosshair(clampInt(x, 0, Math.max(0, view.w - 1), 0), clampInt(y, 0, Math.max(0, view.h - 1), 0));
      saveViewState(id, { cx: view.cx, cy: view.cy });
      if (sm.chart) sm.chart.centerOn(view.cx, view.cy, 16);
    },
    openSheet: function (name, o) {
      var id = screenProjectId() || (o && o.projectId);
      if (!id) return false;
      var map = {
        chart: openChartSheet, floss: openFlossSheet, fabric: openFabricSheet, pages: openPagesSheet,
        parking: openParkingSheet, rows: openRowsSheet, find: openFindSheet, read: reopenRead
      };
      if (name === 'colour') { openColourEditor(id, clampInt(o && o.index, -1, 9999, -1)); return true; }
      if (!map[name]) return false;
      map[name](id);
      return true;
    },
    stitchMode: function () {
      return {
        isOn: !!(C && C.workMode && C.workMode.isOn && C.workMode.isOn()),
        open: function () { if (C && C.workMode) C.workMode.open(); },
        close: function () { if (C && C.workMode) C.workMode.close(); }
      };
    },
    picture: function (project, o) { return stitchedPicture(project, o); },
    onMarked: function (fn) {
      if (typeof fn !== 'function') return function () {};
      markListeners.push(fn);
      return function () {
        var i = markListeners.indexOf(fn);
        if (i >= 0) markListeners.splice(i, 1);
      };
    },
    __test: {
      gridCheckOf: function (res, ctx) { if (ctx) useCtx(ctx); return gridCheckOf(res); },
      gridSourceCheck: function (res, ctx) { if (ctx) useCtx(ctx); return gridSourceCheck(res); },
      keepReadFields: keepReadFields,
      letterPalette: letterPalette,
      statsOf: statsOf,
      pctOf: pctOf,
      liveCheckOf: function (data) { view = view || null; return liveCheckOf(data); },
      readInfo: readInfo,
      stitchModeSpec: STITCH_MODE,
      stitchModeReadout: function (p) {
        var d = dataOf(p);
        if (!view || view.projectId !== p.id) return null;
        return stitchModeReadout(p, d);
      },
      view: function () { return view; },
      markCellList: markCellList,
      markPageDone: markPageDone,
      openFindSheet: openFindSheet,
      openParkingSheet: openParkingSheet,
      openResolveSheet: openResolveSheet,
      openGridCheck: openGridCheck,
      pageLine: pageLine,
      blockScope: function (v) { if (v === 'all' || v === 'colour') blockScope = v; return blockScope; },
      stitched: function () { return view && view.stitched ? view.stitched : null; },
      runGridBeta: runGridBeta,
      applyGrid: applyGrid,
      /** Pure checks of the wave K app logic -> [{ name, ok, got }] (for test/xstitch.gallery.html). */
      selfCheck: function () {
        var out = [];
        function t(name, ok, got) { out.push({ name: name, ok: !!ok, got: got }); }
        var res = { ok: true, filled: 4, palette: [{ code: '310', hex: '000000' }, { name: 'DMC 349 or DMC 3843 (not told apart)', hex: 'cc6633', unresolved: [0, 1] }],
          check: { verdict: 'exact', rows: [] }, unresolved: [{ palette: 1, ink: 'cc6633', cells: 100, candidates: [0, 1], expected: [176, 4824], why: 'shared-ink' }] };
        var gc = gridCheckOf(res);
        t('an unresolved class makes the grid check off', gc && gc.verdict === 'off', gc && gc.verdict);
        t('the unresolved class is a row of its own, verdict off', gc && gc.rows[0] && gc.rows[0].verdict === 'off' && gc.rows[0].read === 100, gc && gc.rows[0]);
        t('the summary says how many stitches have no key colour', gc && /^100 stitches could not be given a key colour/.test(gc.summary), gc && gc.summary);
        var gs = gridSourceCheck(res);
        t('source.check keeps the off verdict', gs && gs.verdict === 'off' && gs.off >= 1, gs);
        var pe = keepReadFields({ code: '', name: '' }, { keyCount: 176, glyph: { clean: true }, unresolved: [0, 1], name: 'X (not told apart)' });
        t('keepReadFields keeps keyCount, glyph and unresolved', pe.keyCount === 176 && pe.glyph && pe.unresolved.length === 2, pe);
        var pal = letterPalette([{ hex: '000000', stitchCount: 9 }, { hex: 'ff0000', stitchCount: 5 }, { hex: '00ff00', stitchCount: 3, unresolved: [0] }]);
        t('an unresolved colour gets the symbol "?"', pal[2].symbol === '?', pal[2].symbol);
        t('the other colours get distinct symbols', pal[0].symbol && pal[1].symbol && pal[0].symbol !== pal[1].symbol, pal.map(function (e) { return e.symbol; }));
        var d = X.normalize({ v: 1, palette: [{ code: '310', hex: '000000', keyCount: 4 }, { code: '321', hex: 'ff0000', keyCount: 7 }],
          chart: { w: 2, h: 2, cells: X.packCells([0, 0, 0, 0], 2, 2), part: [], back: [], knots: [] }, progress: { mode: 'cells', keyDone: { 1: 3 } } }, null);
        var st = statsOf(d);
        t('one total: a colour with no squares is counted from the key', st.total === 11 && st.done === 3 && st.byColor[1].fromKey, [st.total, st.done]);
        if (typeof X.totals === 'function') t('statsOf agrees with XStitch.totals', X.totals(d).total === st.total, X.totals(d).total);
        t('pctOf under 1% keeps decimals', /^0\.\d+%$/.test(pctOf(20, 64512)), pctOf(20, 64512));
        var row = { y: 1, rtl: false, runs: [{ p: 0, n: 3, x: 2, done: 3 }, { p: -1, n: 2, x: 5, done: 0 }, { p: 1, n: 2, x: 7, done: 1 }] };
        t('a row with a part-done run is not done', rowDoneByRuns(row) === false);
        t('a row\'s squares come from its runs', JSON.stringify(rowCellsByRuns(row, 10)) === JSON.stringify([12, 13, 14, 17, 18]), rowCellsByRuns(row, 10));
        var rtl = { y: 0, rtl: true, runs: [{ p: 0, n: 2, x: 4, done: 2 }] };
        t('right-to-left runs walk left', JSON.stringify(rowCellsByRuns(rtl, 10)) === '[4,3]' && rowDoneByRuns(rtl) === true);
        t('runs without done counts fall back', rowDoneByRuns({ runs: [{ p: 0, n: 2, x: 0 }] }) === null);
        var kr = { ok: true, entries: [
          { code: '310', name: 'Black', hex: '000000', read: { status: 'exact', text: '310', candidates: [] } },
          { code: null, hex: 'aa0000', read: { status: 'partial', text: '3?1', candidates: ['321', '351'] } },
          { code: null, hex: null, read: { status: 'blank', text: '', candidates: [] } }] };
        var k0 = keyEntriesFrom(kr, {});
        t('a partial row\'s first candidate is never saved', k0.entries.length === 1 && k0.left === 2, k0);
        var k1 = keyEntriesFrom(kr, { 1: '321' });
        t('a confirmed candidate is kept with the table name', k1.entries.length === 2 && k1.entries[1].code === '321' && !!k1.entries[1].name, k1.entries[1]);
        t('a code that is not in the DMC list is refused', confirmCode('99999') === null && !!confirmCode('DMC 310'));
        var s = pdfLookScale({ w: 612, h: 792 });
        t('a busy page is drawn about 2,000 px wide', Math.abs(612 * s - 2000) < 2, Math.round(612 * s));
        t('Stitch mode is registered on def.workMode', def.workMode === STITCH_MODE && typeof STITCH_MODE.surface === 'function');
        return out;
      },
      /* xs-audit additions */
      photoReplaceText: photoReplaceText,
      tilePages: tilePages,
      looksLikeSymbolSoup: looksLikeSymbolSoup,
      cleanKeyNames: cleanKeyNames,
      reletterReason: reletterReason,
      reletterSymbols: reletterSymbols,
      openFlossSheet: openFlossSheet,
      openKeyReadSheet: openKeyReadSheet,
      keyEntriesFrom: keyEntriesFrom,
      confirmCode: confirmCode,
      keyReadAvailable: keyReadAvailable,
      pdfLookScale: pdfLookScale,
      rowsOptsScoped: rowsOptsScoped,
      rowDoneByRuns: rowDoneByRuns,
      rowCellsByRuns: rowCellsByRuns,
      readerAvailable: readerAvailable,
      isImageFile: isImageFile,
      importAcceptList: importAcceptList,
      pickPdfPage: pickPdfPage,
      pdfReadScale: pdfReadScale,
      readBannerText: readBannerText,
      unsureText: unsureText,
      checkOff: checkOff,
      cellsPrint: cellsPrint,
      codeKey: codeKey,
      normRowOpts: normRowOpts,
      writtenOptsFor: writtenOptsFor,
      rowOptsLabel: rowOptsLabel,
      firstStitchX: firstStitchX,
      rowsAvailable: rowsAvailable,
      def: def,
      handlePicture: function (projectId, file, setPreview) {
        handlePicture(projectId, file, setPreview || function () {});
      },
      openReadSheet: openReadSheet,
      openRowsSheet: openRowsSheet,
      reopenRead: reopenRead,
      /** A parsed key into the project exactly as a key-only PDF import applies it. */
      applyKey: function (projectId, key) {
        return applyPdf(projectId, { entries: key.entries.slice(), fabric: key.fabric, design: key.design,
          strands: key.strandsDefault }, key, null, el('p'));
      }
    }
  };

})();
